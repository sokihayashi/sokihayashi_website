// lab/gauss: 作品の写真を、奥行きを持った 3D ガウシアンの粒にして、指の軌跡で動かす試作。
// 描画は Spark(World Labs, MIT)。粒ごとの動きは、Spark の modifier(GLSL)で書く。
// 状態: 0 帯(軌跡に沿って並ぶ) / 1 立つ(作品が立体として起き上がる) / 2 塵(舞い上がる) / 3 砂(下に積もる)
import * as THREE from 'three';
import { SparkRenderer, SplatMesh, PackedSplats, dyno } from '@sparkjsdev/spark';

const M = 640; // 軌跡の点の数
const SP = 7; // 点の間隔(px)
const STEP = 3; // 写真から粒を取る間隔(px)
const NSTATE = 4;

type Work = { id: string; src: string; depth: string; flat: boolean };

function loadImg(src: string) {
  return new Promise<HTMLImageElement>((res, rej) => {
    const im = new Image();
    im.crossOrigin = 'anonymous';
    im.onload = () => res(im);
    im.onerror = rej;
    im.src = src;
  });
}
function pixels(im: HTMLImageElement, w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(im, 0, 0, w, h);
  return g.getImageData(0, 0, w, h).data;
}

export function mountGauss(root: HTMLElement) {
  const works: Work[] = JSON.parse(root.dataset.works || '[]');
  const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setClearColor(0x000000, 1);
  root.appendChild(renderer.domElement);
  renderer.domElement.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;touch-action:none;display:block;';
  const scene = new THREE.Scene();
  const spark = new SparkRenderer({ renderer });
  scene.add(spark);
  const FOV = 30;
  const camera = new THREE.PerspectiveCamera(FOV, 1, 10, 20000);
  let W = 1, H = 1;
  function resize() {
    W = root.clientWidth; H = root.clientHeight;
    renderer.setSize(W, H, false);
    camera.aspect = W / H;
    // 1 単位 = 1 CSS px になる距離(原点の面で)
    camera.position.set(0, 0, H / 2 / Math.tan((FOV * Math.PI) / 360));
    camera.updateProjectionMatrix();
  }
  resize();

  // ---- 軌跡(画面の px を、中心原点・上が +y の座標にして持つ)
  const pathData = new Float32Array(M * 2 * 4);
  const pathTex = new THREE.DataTexture(pathData, M, 2, THREE.RGBAFormat, THREE.FloatType);
  pathTex.needsUpdate = true;
  let K = 0; // 次に書く場所
  let last: [number, number] | null = null;
  
  function push(x: number, y: number, t: number) {
    const wx = x - W / 2, wy = H / 2 - y;
    if (last) {
      const dx = wx - last[0], dy = wy - last[1];
      const d = Math.hypot(dx, dy);
      if (d < SP) return false;
      const n = Math.floor(d / SP);
      for (let i = 1; i <= n; i++) {
        const px = last[0] + (dx * i) / n, py = last[1] + (dy * i) / n;
        const j = K % M;
        pathData.set([px, py, dx / d, dy / d], j * 4);
        pathData.set([t, 1, 0, 0], (M + j) * 4);
        K++;
      }
      last = [wx, wy];
    } else {
      last = [wx, wy];
    }
    pathTex.needsUpdate = true;
    return true;
  }

  // ---- 共通の値
  const uTime = dyno.dynoFloat(0);
  const uK = dyno.dynoFloat(0);
  const uPen = dyno.dynoVec3(new THREE.Vector3(0, 0, 0));
  const uFrom = dyno.dynoFloat(0);
  const uTo = dyno.dynoFloat(0);
  const uX = dyno.dynoFloat(0);
  const uW = dyno.dynoFloat(Math.min(innerWidth, 800) * 0.2);
  const uPath = dyno.dynoSampler2D(pathTex);
  const uHH = dyno.dynoFloat(400);

  const meshes: { mesh: SplatMesh; slot: ReturnType<typeof dyno.dynoFloat>; asp: number; off: ReturnType<typeof dyno.dynoFloat> }[] = [];
  // 帯の上での並び: 作品ごとに、縦横比の分だけ長さを取る。足りない所は、繰り返さずに空ける。
  function relayout() {
    const order = [...meshes].sort((a, b) => a.slot.value - b.slot.value);
    let acc = 0;
    for (const m of order) { m.off.value = acc; acc += m.asp + 0.12; }
  }
  const nW = works.length;

  function modifier(slot: ReturnType<typeof dyno.dynoFloat>, uAsp: ReturnType<typeof dyno.dynoFloat>, uOff: ReturnType<typeof dyno.dynoFloat>, uInv: ReturnType<typeof dyno.dynoVec2>) {
    return dyno.dynoBlock({ gsplat: dyno.Gsplat }, { gsplat: dyno.Gsplat }, ({ gsplat }) => {
      const d = new dyno.Dyno({
        inTypes: { gsplat: dyno.Gsplat, path: 'sampler2D', t: 'float', k: 'float', pen: 'vec3', from: 'float', to: 'float', x: 'float', bw: 'float', slot: 'float', hh: 'float', asp: 'float', off: 'float', inv: 'vec2' },
        outTypes: { gsplat: dyno.Gsplat },
        globals: () => [
          `
          float gh(float n){ return fract(sin(n * 12.9898) * 43758.5453); }
          vec4 pth(sampler2D p, float j){ return texelFetch(p, ivec2(int(mod(j, ${M}.0)), 0), 0); }
          vec4 pthB(sampler2D p, float j){ return texelFetch(p, ivec2(int(mod(floor(j), ${M}.0)), 1), 0); }
          // 点と点の間を、なめらかに補う(帯が縞にならないように)
          vec4 pthI(sampler2D p, float j){
            float f = fract(j); float j0 = floor(j);
            vec4 a = texelFetch(p, ivec2(int(mod(j0, ${M}.0)), 0), 0);
            vec4 b = texelFetch(p, ivec2(int(mod(j0 + 1.0, ${M}.0)), 0), 0);
            bool ok = texelFetch(p, ivec2(int(mod(j0 + 1.0, ${M}.0)), 1), 0).y > 0.5 && distance(a.xy, b.xy) < ${SP * 2}.0;
            return ok ? vec4(mix(a.xy, b.xy, f), normalize(mix(a.zw, b.zw, f) + vec2(1e-5, 0.0))) : a;
          }
          // 状態ごとの位置。l: 作品の中での位置(-0.5..0.5, 奥行き z)
          vec3 stPos(int s, vec3 l, float h, sampler2D p, float t, float k, vec3 pen, float bw, float slot, float hh, float asp, float off, out float sc){
            float span = bw * asp / ${SP}.0;
            float o0 = off * bw / ${SP}.0;
            float u = clamp(l.x + 0.5, 0.0, 1.0);
            float j = k - 1.0 - o0 - (1.0 - u) * span;
            vec4 a = pthI(p, j); vec4 b = pthB(p, j);
            float age = (o0 + (1.0 - u) * span) / ${M}.0;
            bool ok = b.y > 0.5 && (o0 + span) < k && (o0 + span) < ${M}.0;
            vec2 P = ok ? a.xy : pen.xy; vec2 T = ok ? a.zw : vec2(1.0, 0.0);
            vec2 N = vec2(-T.y, T.x);
            sc = ok ? 1.0 : 0.0;
            vec3 band = vec3(P + N * l.y * bw, l.z * bw * 0.6);
            if (s == 0) return band;
            if (s == 1) {
              // 立つ: 自分の区間の真ん中に、作品が立体として起き上がる。ゆっくり回る。
              float jm = k - 1.0 - o0 - span * 0.5;
              vec4 m = pth(p, jm);
              vec2 C = pthB(p, jm).y > 0.5 ? m.xy : pen.xy;
              float sz = bw * 1.9;
              float ang = sin(t * 0.6 + slot) * 0.7;
              vec3 q = vec3(l.x * sz * max(asp, 1.0), l.y * sz * min(1.0, 1.0 / asp) * max(asp, 1.0) / max(asp, 1.0), l.z * sz * 0.9);
              q = vec3(q.x * cos(ang) + q.z * sin(ang), q.y, -q.x * sin(ang) + q.z * cos(ang));
              sc = pthB(p, jm).y > 0.5 ? 1.0 : 0.0;
              return vec3(C, bw * 0.8) + q;
            }
            if (s == 2) {
              // 塵: 帯から、古い所ほど高く舞い上がって、渦を巻く。
              float a2 = age * 1.6;
              vec2 sw = vec2(sin(band.y * 0.011 + t * 0.9 + h * 6.0), cos(band.x * 0.012 + t * 0.7 + h * 5.0));
              return band + vec3(sw * bw * 1.4 * a2 + vec2((h - 0.3) * bw, bw * 3.0 * (0.3 + h)) * a2 * a2, bw * a2 * 2.0 * gh(h + 3.1));
            }
            // 砂: 下に落ちて、横の位置はそのままに、地層のように積もる。
            float tf = smoothstep(0.05, 0.3, age);
            float y = -hh * 0.9 + (1.0 - age) * hh * 0.55 + l.y * bw * 0.25 + sin(band.x * 0.01 + age * 30.0) * bw * 0.12 + (h - 0.5) * bw * 0.08;
            return vec3(band.x + (h - 0.5) * bw * 0.3 * tf, mix(band.y, y, tf), band.z * (1.0 - tf) + (h - 0.5) * bw * 0.5 * tf);
          }
          `,
        ],
        statements: ({ inputs, outputs }) => {
          const g = inputs.gsplat, o = outputs.gsplat;
          return [
            `${o} = ${g};`,
            `vec3 l = ${g}.center;`,
            `float h = gh(float(${g}.index) * 0.731 + ${inputs.slot} * 17.0);`,
            `float scA, scB;`,
            `vec3 pA = stPos(int(${inputs.from}), l, h, ${inputs.path}, ${inputs.t}, ${inputs.k}, ${inputs.pen}, ${inputs.bw}, ${inputs.slot}, ${inputs.hh}, ${inputs.asp}, ${inputs.off}, scA);`,
            `vec3 pB = stPos(int(${inputs.to}), l, h, ${inputs.path}, ${inputs.t}, ${inputs.k}, ${inputs.pen}, ${inputs.bw}, ${inputs.slot}, ${inputs.hh}, ${inputs.asp}, ${inputs.off}, scB);`,
            `float w = clamp(${inputs.x} * 1.6 - h * 0.6, 0.0, 1.0); w = w * w * (3.0 - 2.0 * w);`,
            `float arc = sin(3.14159 * w);`,
            `vec3 pos = mix(pA, pB, w) + vec3((gh(h + 1.0) - 0.5), (gh(h + 2.0) - 0.5), gh(h + 4.0)) * ${inputs.bw} * 0.9 * arc;`,
            `float sc = mix(scA, scB, w);`,
            `${o}.center = pos;`,
            `float dens = ${inputs.bw} * max(${inputs.inv}.y, ${inputs.inv}.x * ${inputs.asp}) * 0.85;`,
            `${o}.scales = vec3(dens, dens, dens * 0.4) * max(sc, 0.0001);`,
            `if (sc < 0.01) ${o}.rgba.a = 0.0;`,
          ];
        },
      });
      return {
        gsplat: d.apply({ gsplat, path: uPath, t: uTime, k: uK, pen: uPen, from: uFrom, to: uTo, x: uX, bw: uW, slot, hh: uHH, asp: uAsp, off: uOff, inv: uInv }).gsplat,
      };
    });
  }

  async function buildWork(wk: Work, slotIdx: number) {
    const [im, dm] = await Promise.all([loadImg(wk.src), loadImg(wk.depth)]);
    const w = Math.round(im.naturalWidth / STEP), h = Math.round(im.naturalHeight / STEP);
    const col = pixels(im, w, h);
    const dep = pixels(dm, w, h);
    const packed = new PackedSplats({ maxSplats: w * h });
    const c = new THREE.Vector3(), s = new THREE.Vector3(), q = new THREE.Quaternion(), clr = new THREE.Color();
    const big = Math.max(w, h);
    const sz = 0.75 / big; // 粒の大きさ(作品の長辺 = 1)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const dz = wk.flat ? 0 : (dep[i] / 255 - 0.5) * 0.35;
        // 帯: x は軌跡に沿う方向(0..1 を -0.5..0.5)、y は帯の幅方向(-0.5..0.5)
        c.set(x / w - 0.5, 0.5 - y / h, dz);
        s.set(sz, sz, sz * 0.35);
        clr.setRGB(col[i] / 255, col[i + 1] / 255, col[i + 2] / 255, THREE.SRGBColorSpace);
        packed.pushSplat(c, s, q, 1, clr);
      }
    }
    const slot = dyno.dynoFloat(slotIdx);
    const uAsp = dyno.dynoFloat(w / h);
    const uOff = dyno.dynoFloat(0);
    const uInv = dyno.dynoVec2(new THREE.Vector2(1 / w, 1 / h));
    const mesh = new SplatMesh({ packedSplats: packed });
    mesh.objectModifier = modifier(slot, uAsp, uOff, uInv);
    mesh.updateGenerator();
    scene.add(mesh);
    meshes.push({ mesh, slot, asp: w / h, off: uOff });
    relayout();
  }
  works.forEach((wk, i) => buildWork(wk, i).catch((e) => console.error('gauss work', wk.id, e)));

  // ---- 状態の並び(毎回ランダム、直前と同じは避ける)
  const seq = [0];
  const seqAt = (n: number) => {
    while (seq.length <= n) {
      const a = seq[seq.length - 1];
      let c = a;
      while (c === a) c = Math.floor(Math.random() * NSTATE);
      seq.push(c);
    }
    return seq[n];
  };
  let phase = 0;
  const HOLD = 0.55;
  const STATE_PX = 1100; // この長さ描くと、次の状態へ
  function onPhase() {
    const A = Math.floor(phase);
    const f = phase - A;
    uFrom.value = seqAt(A);
    uTo.value = seqAt(A + 1);
    uX.value = Math.max(0, (f - HOLD) / (1 - HOLD));
  }

  // ---- 入力
  let down = false;
  let px = W / 2, py = H / 2;
  const el = renderer.domElement;
  el.addEventListener('pointerdown', (e) => { down = true; last = null; px = e.offsetX; py = e.offsetY; });
  addEventListener('pointerup', () => { down = false; });
  el.addEventListener('pointermove', (e) => {
    const dx = e.offsetX - px, dy = e.offsetY - py;
    px = e.offsetX; py = e.offsetY;
    if (down || e.pointerType === 'mouse') {
      const d = Math.hypot(dx, dy);
      if (push(px, py, performance.now() / 1000)) { phase += d / STATE_PX; onPhase(); }
    }
  });

  // ---- 自動で描く(触っていないとき)
  let auto = true;
  let idle = 0;
  const t0 = performance.now();
  let raf = 0;
  function frame() {
    const t = (performance.now() - t0) / 1000;
    if (auto && !down) {
      idle += 1 / 60;
      if (idle > 1.2) {
        const tt = t * 0.55;
        const ax = W / 2 + W * 0.34 * Math.sin(tt * 1.1 + 0.4) + W * 0.06 * Math.sin(tt * 2.7);
        const ay = H / 2 + H * 0.3 * Math.sin(tt * 1.7) + H * 0.06 * Math.cos(tt * 3.3);
        const d = Math.hypot(ax - px, ay - py);
        px = ax; py = ay;
        if (push(ax, ay, t)) { phase += d / STATE_PX; onPhase(); }
      }
    }
    if (down) idle = 0;
    uTime.value = t;
    uK.value = K;
    uPen.value.set(px - W / 2, H / 2 - py, down ? 1 : 0);
    uW.value = Math.min(W, 900) * 0.16;
    uHH.value = H / 2;
    for (const m of meshes) m.mesh.updateVersion();
    renderer.render(scene, camera);
    raf = requestAnimationFrame(frame);
  }
  onPhase();
  raf = requestAnimationFrame(frame);
  const ro = new ResizeObserver(resize);
  ro.observe(root);

  (window as any).__gauss = {
    draw: (pts: [number, number][]) => { last = null; for (const p of pts) { px = p[0]; py = p[1]; push(p[0], p[1], (performance.now() - t0) / 1000); } },
    seq: (l: number[]) => { seq.length = 0; seq.push(...l); onPhase(); },
    phase: (v: number) => { phase = v; onPhase(); },
    auto: (on: boolean) => { auto = on; },
    get state() { return { phase, K, from: uFrom.value, to: uTo.value, x: uX.value, meshes: meshes.length }; },
  };

  return () => {
    cancelAnimationFrame(raf);
    ro.disconnect();
    for (const m of meshes) m.mesh.dispose();
    renderer.dispose();
    el.remove();
  };
}
