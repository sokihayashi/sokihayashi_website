// 試作 /lab/deck/ : 手札の見本帳。
//
// 本人(2026-11-24):「3Dやもろもろを、どうジェネラティブアートとして見せるかの手札が足りてないだけ」
// 「まずは僕が渡したリファレンスと、あなたが探したリファレンスを、今回の表現に落とし込んで全部実装」
//
// 1枚の札 = 1つの見せ方。叩く(または ← →)で次の札へ。札の一覧は claude/generative-3d-hand.md。
// 素材は3つだけ: 本人のペンダント(STL)、預かった像(点にしたもの)、作品の写真。
// 拍は 100BPM。どの札も、拍で何かが動く(uPulse は拍の頭で 1、次の拍までに 0 へ落ちる)。
// /lab/morph/ と /lab/morph-sharp/ には触れていない。

import * as THREE from 'three';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { MeshSurfaceSampler } from 'three/addons/math/MeshSurfaceSampler.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

const BPM = 100;
const N = 40000; // 点の数(200 × 200)
const PAPER = 'vec3(0.957, 0.945, 0.914)';

const NOISE = /* glsl */ `
float h31(vec3 p){ p = fract(p * vec3(0.1031, 0.1030, 0.0973)); p += dot(p, p.yxz + 33.33); return fract((p.x + p.y) * p.z); }
float n3(vec3 p){ vec3 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(mix(h31(i), h31(i+vec3(1,0,0)), f.x), mix(h31(i+vec3(0,1,0)), h31(i+vec3(1,1,0)), f.x), f.y),
             mix(mix(h31(i+vec3(0,0,1)), h31(i+vec3(1,0,1)), f.x), mix(h31(i+vec3(0,1,1)), h31(i+vec3(1,1,1)), f.x), f.y), f.z); }
float fbm(vec3 p){ return n3(p) * 0.6 + n3(p * 2.03 + 7.1) * 0.3 + n3(p * 4.1 + 3.3) * 0.1; }
vec3 flow(vec3 p, float t){ return vec3(n3(p + vec3(0.0, t, 9.1)) - n3(p + vec3(5.2, -t, 0.0)), n3(p + vec3(t, 3.3, 0.0)) - n3(p + vec3(0.0, 8.7, t)), n3(p + vec3(1.7, 0.0, -t)) - n3(p + vec3(-t, 4.4, 2.2))); }
vec2 cover(vec2 uv, float pa, float ta){ return pa > ta ? vec2(uv.x, (uv.y - 0.5) * ta / pa + 0.5) : vec2((uv.x - 0.5) * pa / ta + 0.5, uv.y); }
mat2 rot(float a){ float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }
`;

type Ctx = {
  t: number; dt: number; beat: number; pulse: number; bar: number; // bar: その札に入ってからの拍
  cam: THREE.PerspectiveCamera; asp: number; ptr: THREE.Vector2;
};
type Card = {
  id: string; name: string;
  obj?: THREE.Object3D;
  post?: THREE.ShaderMaterial; feedback?: boolean; noScene?: boolean;
  update?: (c: Ctx) => void;
  cam?: (c: Ctx) => void;
  pre?: (r: THREE.WebGLRenderer, c: Ctx) => void; // 描く前に回す計算(反応拡散など)
};

export function mountDeck(root: HTMLElement): () => void {
  const canvas = root.querySelector<HTMLCanvasElement>('[data-canvas]')!;
  const label = root.querySelector<HTMLElement>('[data-label]');
  const base = root.dataset.base ?? '';
  const photos: string[] = JSON.parse(root.dataset.photos ?? '[]');
  let dead = false;

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace; // 写真の色を、そのまま出す(変換しない)
  renderer.setClearColor(0x000000, 1);
  const scene = new THREE.Scene();
  const cam = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
  const sun = new THREE.DirectionalLight(0xffffff, 2.6);
  sun.position.set(2, 3, 4);
  scene.add(sun, new THREE.AmbientLight(0xffffff, 0.25));

  // ---- どの札も使う値
  const S = {
    uTime: { value: 0 }, uBeat: { value: 0 }, uPulse: { value: 0 }, uBar: { value: 0 },
    uRes: { value: new THREE.Vector2(1, 1) }, uPtr: { value: new THREE.Vector2(0, 0) },
    tA: { value: null as THREE.Texture | null }, tB: { value: null as THREE.Texture | null },
    uAspA: { value: 0.8 }, uAspB: { value: 0.8 }, uAsp: { value: 1 }, uMeanA: { value: 0.5 },
  };
  const HEAD = `uniform float uTime, uBeat, uPulse, uBar, uAspA, uAspB, uAsp, uMeanA; uniform vec2 uRes, uPtr; uniform sampler2D tA, tB;\n${NOISE}`;
  const mat = (vs: string, fs: string, extra: Record<string, { value: unknown }> = {}, opt: THREE.ShaderMaterialParameters = {}) =>
    new THREE.ShaderMaterial({ uniforms: { ...S, ...extra }, vertexShader: HEAD + vs, fragmentShader: HEAD + fs, ...opt });
  const ADD: THREE.ShaderMaterialParameters = { blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, transparent: true };

  // ---- 写真
  const loader = new THREE.TextureLoader();
  const tex: THREE.Texture[] = [];
  const blank = new THREE.DataTexture(new Uint8Array([40, 40, 40, 255]), 1, 1);
  blank.needsUpdate = true;
  S.tA.value = blank; S.tB.value = blank;
  let photoAt = 0;
  const setPhotos = () => {
    if (!tex.length) return;
    const L = tex.length, i0 = ((photoAt % L) + L) % L;
    const a = tex[i0], b = tex[(i0 + 1) % L];
    S.tA.value = a; S.tB.value = b;
    S.uAspA.value = a.image.width / a.image.height; S.uAspB.value = b.image.width / b.image.height;
    S.uMeanA.value = a.userData.mean ?? 0.5;
  };
  photos.slice(0, 12).forEach((src) => loader.load(src, (t) => {
    if (dead) return;
    t.colorSpace = THREE.NoColorSpace; t.minFilter = THREE.LinearFilter; t.generateMipmaps = false;
    try { // 平均の明るさ(白地の写真か、暗い写真か)
      const cv = document.createElement('canvas'); cv.width = cv.height = 16;
      const cx = cv.getContext('2d')!; cx.drawImage(t.image, 0, 0, 16, 16);
      const d = cx.getImageData(0, 0, 16, 16).data; let m = 0;
      for (let i = 0; i < d.length; i += 4) m += (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) / 255;
      t.userData.mean = m / 256;
    } catch { t.userData.mean = 0.5; }
    tex.push(t);
    if (tex.length <= 2) setPhotos();
    cards.forEach((c) => c.id === 'R6' && (c as Card & { fill?: () => void }).fill?.());
  }));

  // ---- 形(ペンダント、像の点)
  let pend: THREE.BufferGeometry | null = null;
  const pPend = new Float32Array(N * 3), nPend = new Float32Array(N * 3);
  const pPuck = new Float32Array(N * 3), nPuck = new Float32Array(N * 3);
  const ready = { pend: false, puck: false };
  const waiters: (() => void)[] = [];
  const whenReady = (f: () => void) => { if (ready.pend && ready.puck) f(); else waiters.push(f); };
  const flush = () => { if (ready.pend && ready.puck) waiters.splice(0).forEach((f) => f()); };
  fetch(`${base}/lab/deck/pendant.stl`).then((r) => r.arrayBuffer()).then((b) => {
    if (dead) return;
    let g = new STLLoader().parse(b);
    g.deleteAttribute('normal');
    g = mergeVertices(g, 1e-4);
    g.rotateX(-Math.PI / 2); // データの上(z)を、画面の上(y)に
    g.center();
    g.computeBoundingBox();
    const k = 2.4 / (g.boundingBox!.max.y - g.boundingBox!.min.y);
    g.scale(k, k, k);
    g.computeVertexNormals();
    pend = g;
    const sampler = new MeshSurfaceSampler(new THREE.Mesh(g)).build();
    const p = new THREE.Vector3(), n = new THREE.Vector3();
    for (let i = 0; i < N; i++) { sampler.sample(p, n); pPend.set([p.x, p.y, p.z], i * 3); nPend.set([n.x, n.y, n.z], i * 3); }
    ready.pend = true; flush();
  });
  fetch(`${base}/lab/deck/puck.bin`).then((r) => r.arrayBuffer()).then((b) => {
    if (dead) return;
    const q = new Int16Array(b);
    for (let i = 0; i < N; i++) for (let k = 0; k < 3; k++) { pPuck[i * 3 + k] = (q[i * 6 + k] / 32000) * 2.4; nPuck[i * 3 + k] = q[i * 6 + 3 + k] / 32000; }
    ready.puck = true; flush();
  });
  const attr = (a: Float32Array, n = 3) => new THREE.BufferAttribute(a, n);
  const rnd = new Float32Array(N).map(() => Math.random());

  // ペンダントを置く札の共通: 準備ができたら、材質を付けて group に入れる。
  const pendMesh = (m: THREE.Material, into: THREE.Object3D) => whenReady(() => { const o = new THREE.Mesh(pend!, m); o.name = 'pend'; into.add(o); });
  const PV = /* glsl */ `varying vec3 vN, vP, vW, vV; void main(){ vP = position; vN = normalize(normalMatrix * normal); vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; vec4 mv = viewMatrix * w; vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`;
  const PF = `varying vec3 vN, vP, vW, vV;`;
  const DS = { side: THREE.DoubleSide };

  const cards: Card[] = [];

  // ======================================================================= A1 点にして、別の形へ移す
  {
    const g = new THREE.BufferGeometry();
    const plane = new Float32Array(N * 3), uv = new Float32Array(N * 2);
    for (let i = 0; i < N; i++) {
      const x = (i % 200) / 199, y = Math.floor(i / 200) / 199;
      plane.set([(x - 0.5) * 1.9, (y - 0.5) * 2.375, 0], i * 3); uv.set([x, y], i * 2);
    }
    g.setAttribute('position', attr(plane)); g.setAttribute('aUv', attr(uv, 2)); g.setAttribute('aR', attr(rnd, 1));
    whenReady(() => { g.setAttribute('aB', attr(pPend)); g.setAttribute('aC', attr(pPuck)); });
    const m = mat(/* glsl */ `
      attribute vec3 aB, aC; attribute vec2 aUv; attribute float aR; uniform float uStage; varying vec3 vC;
      vec3 at(float s){ s = mod(s, 3.0); return s < 0.5 ? position : (s < 1.5 ? aB : aC); }
      void main(){
        float st = floor(uStage), k = fract(uStage);
        float w = smoothstep(0.0, 1.0, clamp(k * 1.6 - 0.6 * aR, 0.0, 1.0));
        vec3 p = mix(at(st), at(st + 1.0), w);
        p += (flow(p * 1.3 + aR * 9.0, uTime * 0.3)) * sin(w * 3.1416) * 0.9;
        vC = texture2D(tA, cover(aUv, 0.8, uAspA)).rgb;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_PointSize = uRes.y * 0.0105 / -mv.z * (1.0 + 0.5 * uPulse);
        gl_Position = projectionMatrix * mv;
      }`, `varying vec3 vC; void main(){ if (length(gl_PointCoord - 0.5) > 0.5) discard; gl_FragColor = vec4(vC, 1.0); }`, { uStage: { value: 0 } });
    const obj = new THREE.Points(g, m); obj.frustumCulled = false;
    cards.push({ id: 'A1', name: '点にして、別の形へ移す', obj,
      update: (c) => { const s = c.bar / 6; m.uniforms.uStage.value = Math.floor(s) + Math.min(1, (s - Math.floor(s)) * 3); },
      cam: (c) => orbit(c, Math.sin(c.t * 0.25) * 0.5, 0.05, 5.4) });
  }

  // ======================================================================= A2 流れに乗せる
  {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', attr(new Float32Array(N * 3))); g.setAttribute('aR', attr(rnd, 1));
    whenReady(() => { g.setAttribute('position', attr(pPend)); g.setAttribute('aN', attr(nPend)); });
    const m = mat(/* glsl */ `
      attribute vec3 aN; attribute float aR; varying float vL;
      void main(){
        float amp = 0.04 + 0.75 * uPulse * uPulse + 0.25 * (0.5 + 0.5 * sin(uBeat * 0.785));
        vec3 p = position;
        for (int i = 0; i < 3; i++) p += flow(p * 1.6 + aR, uTime * 0.25 + float(i)) * amp * 0.5;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        vL = 0.25 + 0.75 * smoothstep(-6.4, -4.2, mv.z);
        gl_PointSize = uRes.y * 0.0034 / -mv.z * 5.0;
        gl_Position = projectionMatrix * mv;
      }`, `varying float vL; void main(){ float d = length(gl_PointCoord - 0.5); if (d > 0.5) discard; gl_FragColor = vec4(${PAPER} * vL * 0.55, 1.0); }`, {}, ADD);
    const obj = new THREE.Points(g, m); obj.frustumCulled = false;
    cards.push({ id: 'A2', name: '流れに乗せる', obj, update: (c) => { obj.rotation.y = c.t * 0.3; } });
  }

  // ======================================================================= A3 / R1 形に吸い寄せる(粒で覆った塊が、分かれて、くっつく)
  {
    const g = new THREE.BufferGeometry();
    const d = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) { const y = 1 - (2 * (i + 0.5)) / N, r = Math.sqrt(1 - y * y), a = i * 2.39996; d.set([Math.cos(a) * r, y, Math.sin(a) * r], i * 3); }
    g.setAttribute('position', attr(d)); g.setAttribute('aR', attr(rnd, 1));
    const m = mat(/* glsl */ `
      attribute float aR; varying vec3 vC;
      vec3 c0, c1, c2;
      float smin(float a, float b, float k){ float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0); return mix(b, a, h) - k * h * (1.0 - h); }
      float sdf(vec3 p){
        float d = smin(smin(length(p - c0) - 0.78, length(p - c1) - 0.62, 0.45), length(p - c2) - 0.54, 0.45);
        return d + (fbm(p * 2.4 + uTime * 0.2) - 0.5) * 0.3;
      }
      vec3 grad(vec3 p){ vec2 e = vec2(0.02, 0.0); return normalize(vec3(sdf(p + e.xyy) - sdf(p - e.xyy), sdf(p + e.yxy) - sdf(p - e.yxy), sdf(p + e.yyx) - sdf(p - e.yyx))); }
      void main(){
        float sp = 0.15 + 0.85 * (0.5 - 0.5 * cos(uBeat * 0.3927)); // 8拍で 離れて、戻る
        c0 = vec3(sin(uTime * 0.5), cos(uTime * 0.4), 0.0) * 0.75 * sp;
        c1 = vec3(-sin(uTime * 0.45 + 1.0), 0.3, cos(uTime * 0.5)) * 0.8 * sp;
        c2 = vec3(0.2, -cos(uTime * 0.35), -sin(uTime * 0.55 + 2.0)) * 0.8 * sp;
        // いちばん近い玉の中心から外へ向かって置き、表面まで寄せる。
        float pick = fract(aR * 3.0); vec3 c = aR < 0.44 ? c0 : (aR < 0.74 ? c1 : c2);
        vec3 p = c + position * 0.5;
        for (int i = 0; i < 5; i++) p -= grad(p) * sdf(p);
        vec3 n = grad(p);
        p += n * 0.03 * uPulse;
        float two = step(0.52, fbm(p * 1.7 + vec3(0.0, uTime * 0.12, 0.0)));
        float lit = 0.3 + 0.9 * pow(max(dot(normalize(normalMatrix * n), normalize(vec3(0.5, 0.8, 0.6))) * 0.6 + 0.4, 0.0), 1.4);
        vC = mix(vec3(0.16), ${PAPER}, two) * lit;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_PointSize = uRes.y * 0.05 / -mv.z * (0.7 + 0.6 * pick);
        gl_Position = projectionMatrix * mv;
      }`, `varying vec3 vC; void main(){ vec2 q = gl_PointCoord - 0.5; float d = length(q); if (d > 0.5) discard; gl_FragColor = vec4(vC * (1.0 - d * 1.1 + 0.25 * (0.5 - q.y)), 1.0); }`);
    const obj = new THREE.Points(g, m); obj.frustumCulled = false;
    cards.push({ id: 'A3', name: '形に吸い寄せる(粒の塊が分かれて、くっつく)', obj, cam: (c) => orbit(c, c.t * 0.2, 0.2, 5.6) });
  }

  // ======================================================================= B1 / R2 スパンコール(小さな円盤が返って、絵が替わる)
  {
    const cols = 64, rows = 96, cell = 2.0 / cols;
    const base0 = new THREE.CircleGeometry(cell * 0.62, 14);
    const g = new THREE.InstancedBufferGeometry();
    g.index = base0.index; g.setAttribute('position', base0.getAttribute('position'));
    const off = new Float32Array(cols * rows * 2), uv = new Float32Array(cols * rows * 2);
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
      const i = y * cols + x, ox = (x + (y & 1) * 0.5 - cols / 2) * cell, oy = (y - rows / 2) * cell * 0.87;
      off.set([ox, oy], i * 2); uv.set([(x + 0.5) / cols, (y + 0.5) / rows], i * 2);
    }
    g.setAttribute('aOff', new THREE.InstancedBufferAttribute(off, 2)); g.setAttribute('aUv', new THREE.InstancedBufferAttribute(uv, 2));
    g.instanceCount = cols * rows;
    const m = mat(/* glsl */ `
      attribute vec2 aOff, aUv; uniform vec2 uOrg; uniform float uProg; varying vec3 vC;
      void main(){
        float w = clamp(uProg * 3.4 - length(aOff - uOrg) * 1.1 - h31(vec3(aOff * 40.0, 1.0)) * 0.25, 0.0, 1.0);
        float a = 3.1416 * w + 0.35 * sin(uTime * 1.3 + aOff.x * 6.0 + aOff.y * 4.0) * (0.25 + uPulse * 0.5);
        vec3 p = position; p.yz = rot(a) * p.yz;
        float face = cos(a);
        vec3 ca = texture2D(tA, cover(aUv, 0.766, uAspA)).rgb, cb = texture2D(tB, cover(aUv, 0.766, uAspB)).rgb;
        float spec = pow(max(0.0, sin(a) * 0.9 + 0.1), 12.0);
        vC = mix(cb, ca, step(0.0, face)) * (0.35 + 0.65 * abs(face)) + spec * 0.9;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p + vec3(aOff, 0.0), 1.0);
      }`, `varying vec3 vC; void main(){ gl_FragColor = vec4(vC, 1.0); }`, { uOrg: { value: new THREE.Vector2() }, uProg: { value: 0 } }, DS);
    const obj = new THREE.Mesh(g, m); obj.frustumCulled = false;
    let turn = -1;
    cards.push({ id: 'B1', name: 'スパンコール(円盤が返って、絵が替わる)', obj,
      update: (c) => {
        const s = c.bar / 8, n = Math.floor(s);
        if (n !== turn) { turn = n; m.uniforms.uOrg.value.set((Math.random() - 0.5) * 1.6, (Math.random() - 0.5) * 2.2); }
        const k = Math.min(1, (s - n) * 1.6);
        m.uniforms.uProg.value = n & 1 ? 1 - k : k;
      },
      cam: (c) => orbit(c, Math.sin(c.t * 0.3) * 0.22, Math.cos(c.t * 0.23) * 0.1, 5.0) });
  }

  // ======================================================================= B1' 表面に毛を生やす
  {
    const g = new THREE.BufferGeometry();
    whenReady(() => {
      const M = 30000, p = new Float32Array(M * 6), n = new Float32Array(M * 6), tip = new Float32Array(M * 2);
      for (let i = 0; i < M; i++) for (let k = 0; k < 2; k++) { p.set(pPend.subarray(i * 3, i * 3 + 3), (i * 2 + k) * 3); n.set(nPend.subarray(i * 3, i * 3 + 3), (i * 2 + k) * 3); tip[i * 2 + k] = k; }
      g.setAttribute('position', attr(p)); g.setAttribute('aN', attr(n)); g.setAttribute('aTip', attr(tip, 1));
    });
    const m = mat(/* glsl */ `
      attribute vec3 aN; attribute float aTip; varying float vL;
      void main(){
        float wv = fbm(position * 1.4 + vec3(0.0, -uTime * 0.35, 0.0));
        float len = (0.015 + 0.26 * smoothstep(0.4, 0.75, wv)) * (1.0 + 0.8 * uPulse);
        vec3 p = position + (aN + flow(position * 2.0, uTime * 0.4) * 0.8) * len * aTip;
        vL = mix(0.05, 0.25 + 0.75 * smoothstep(0.4, 0.75, wv), aTip);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      }`, `varying float vL; void main(){ gl_FragColor = vec4(${PAPER} * vL, 1.0); }`);
    const obj = new THREE.LineSegments(g, m); obj.frustumCulled = false;
    cards.push({ id: 'B1b', name: '表面に毛を生やす', obj, update: (c) => { obj.rotation.y = c.t * 0.25; } });
  }

  // ======================================================================= B2 画像を、箱の高さにする
  {
    const cols = 60, rows = 75, cell = 1.9 / cols;
    const g = new THREE.InstancedBufferGeometry();
    const b = new THREE.BoxGeometry(cell * 0.92, cell * 0.92, 1);
    g.index = b.index; g.setAttribute('position', b.getAttribute('position')); g.setAttribute('normal', b.getAttribute('normal'));
    const off = new Float32Array(cols * rows * 2), uv = new Float32Array(cols * rows * 2);
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) { const i = y * cols + x; off.set([(x + 0.5 - cols / 2) * cell, (y + 0.5 - rows / 2) * cell], i * 2); uv.set([(x + 0.5) / cols, (y + 0.5) / rows], i * 2); }
    g.setAttribute('aOff', new THREE.InstancedBufferAttribute(off, 2)); g.setAttribute('aUv', new THREE.InstancedBufferAttribute(uv, 2));
    g.instanceCount = cols * rows;
    const m = mat(/* glsl */ `
      attribute vec2 aOff, aUv; uniform float uH; varying vec3 vC;
      void main(){
        vec2 u0 = cover(aUv, 0.8, uAspA); vec3 c = texture2D(tA, u0).rgb;
        // 高さは、まわりも含めて ならした明るさで決める(1画素ごとの ばらつきで、針の山にならないように)。
        vec3 sm = (c + texture2D(tA, u0 + vec2(0.02, 0.0)).rgb + texture2D(tA, u0 - vec2(0.02, 0.0)).rgb + texture2D(tA, u0 + vec2(0.0, 0.02)).rgb + texture2D(tA, u0 - vec2(0.0, 0.02)).rgb) * 0.2;
        float lum = dot(sm, vec3(0.299, 0.587, 0.114));
        // 白地の写真では、暗い所(図柄)を高くする。暗い写真では、明るい所を高くする。
        float rel = uMeanA > 0.55 ? 1.0 - lum : lum;
        float h = 0.004 + rel * uH * (1.0 + 0.25 * uPulse);
        vec3 p = position; p.z = (p.z + 0.5) * h;
        float lit = normal.z > 0.5 ? 1.0 : (0.35 + 0.25 * normal.x + 0.2 * normal.y);
        vC = c * lit;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p + vec3(aOff, 0.0), 1.0);
      }`, `varying vec3 vC; void main(){ gl_FragColor = vec4(vC, 1.0); }`, { uH: { value: 0 } });
    const obj = new THREE.Mesh(g, m); obj.frustumCulled = false;
    const e = (c: Ctx) => { const s = (c.bar % 12) / 12; return smooth((s - 0.12) / 0.2) * (1 - smooth((s - 0.78) / 0.18)); };
    cards.push({ id: 'B2', name: '画像を、箱の高さにする', obj,
      update: (c) => { m.uniforms.uH.value = 0.5 * e(c); },
      cam: (c) => { const k = e(c); orbit(c, 0.75 * k * Math.sin(c.t * 0.4 + 1), -0.75 * k, 5.4); } });
  }

  // ======================================================================= C1 / R7 表面で模様を育てる(反応拡散)
  {
    const SZ = 256;
    const opt = { type: THREE.HalfFloatType, format: THREE.RGBAFormat, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, wrapS: THREE.RepeatWrapping, wrapT: THREE.ClampToEdgeWrapping, depthBuffer: false };
    let ra = new THREE.WebGLRenderTarget(SZ, SZ, opt), rb = new THREE.WebGLRenderTarget(SZ, SZ, opt);
    const simScene = new THREE.Scene(), simCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const sim = new THREE.ShaderMaterial({ uniforms: { tS: { value: null }, uSeed: { value: new THREE.Vector3(0, 0, 0) }, uF: { value: 0.037 }, uK: { value: 0.06 }, uInit: { value: 1 } },
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
      fragmentShader: /* glsl */ `
        varying vec2 vUv; uniform sampler2D tS; uniform vec3 uSeed; uniform float uF, uK, uInit;
        void main(){
          if (uInit > 0.5) { gl_FragColor = vec4(1.0, 0.0, 0.0, 1.0); return; }
          vec2 e = vec2(1.0 / ${SZ}.0, 0.0);
          vec2 c = texture2D(tS, vUv).rg;
          vec2 lap = (texture2D(tS, vUv + e.xy).rg + texture2D(tS, vUv - e.xy).rg + texture2D(tS, vUv + e.yx).rg + texture2D(tS, vUv - e.yx).rg) * 0.2
                   + (texture2D(tS, vUv + e.xx).rg + texture2D(tS, vUv - e.xx).rg + texture2D(tS, vUv + vec2(e.x, -e.x)).rg + texture2D(tS, vUv + vec2(-e.x, e.x)).rg) * 0.05 - c;
          float r = c.r * c.g * c.g;
          vec2 n = c + vec2(1.0 * lap.r - r + uF * (1.0 - c.r), 0.5 * lap.g + r - (uF + uK) * c.g);
          vec2 d = vUv - uSeed.xy; d.x -= floor(d.x + 0.5);
          if (uSeed.z > 0.5 && length(d) < 0.03) n.g = 0.9;
          gl_FragColor = vec4(clamp(n, 0.0, 1.0), 0.0, 1.0);
        }` });
    simScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), sim));
    const tR = { value: ra.texture as THREE.Texture };
    const m = mat(PV, /* glsl */ `${PF} uniform sampler2D tR;
      void main(){
        vec2 uv = vec2(atan(vP.z, vP.x) / 6.2832 + 0.5, vP.y / 2.4 + 0.5);
        float v = texture2D(tR, uv).g;
        float lit = 0.3 + 0.7 * pow(max(dot(normalize(vN) * (gl_FrontFacing ? 1.0 : -1.0), normalize(vec3(0.4, 0.6, 0.7))), 0.0), 0.9);
        gl_FragColor = vec4(mix(vec3(0.11), ${PAPER}, smoothstep(0.16, 0.26, v)) * lit, 1.0);
      }`, { tR }, DS);
    const obj = new THREE.Group(); pendMesh(m, obj);
    // 平らな円でも見せる(dialog( ) のキービジュアルの系統)。
    const disc = new THREE.Mesh(new THREE.CircleGeometry(0.62, 64), mat(`varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      /* glsl */ `varying vec2 vUv; uniform sampler2D tR; void main(){ vec2 q = vUv - 0.5; float v = texture2D(tR, vUv).g;
        vec2 g = fract(gl_FragCoord.xy / 5.0) - 0.5; float dot_ = step(length(g), 0.12 + 0.36 * smoothstep(0.1, 0.32, v)); gl_FragColor = vec4(${PAPER} * dot_ * smoothstep(0.5, 0.42, length(q)), 1.0); }`, { tR }));
    let init = true, lastBeat = -1, first = 9; // はじめに、種を9つ落とす
    cards.push({ id: 'C1', name: '表面で模様を育てる(反応拡散)', obj,
      pre: (r, c) => {
        const b = Math.floor(c.beat);
        for (let i = 0; i < 16; i++) {
          sim.uniforms.tS.value = ra.texture; sim.uniforms.uInit.value = init ? 1 : 0;
          sim.uniforms.uSeed.value.set(Math.random(), 0.1 + Math.random() * 0.8, (i < 3 && b !== lastBeat) || first > 0 ? 1 : 0);
          r.setRenderTarget(rb); r.render(simScene, simCam);
          [ra, rb] = [rb, ra]; if (!init && first > 0) first--; init = false;
        }
        lastBeat = b;
        const reg = Math.floor(c.bar / 16) & 1; // 16拍ごとに、斑点と縞を入れ替える
        sim.uniforms.uF.value = reg ? 0.029 : 0.037; sim.uniforms.uK.value = reg ? 0.057 : 0.06;
        r.setRenderTarget(null); tR.value = ra.texture;
      },
      update: (c) => { obj.rotation.y = c.t * 0.3; },
      cam: (c) => orbit(c, 0, 0.12, 5.2) });
    const obj2 = new THREE.Group(); obj2.add(disc); disc.scale.setScalar(2.4);
    cards.push({ id: 'R7', name: '点の濃淡で、育つ模様を見せる', obj: obj2, pre: (r, c) => cards.find((x) => x.id === 'C1')!.pre!(r, c), cam: (c) => orbit(c, 0, 0, 5.2) });
  }

  // ======================================================================= C2 溶かす・削る
  {
    const obj = new THREE.Group();
    const m = mat(PV, /* glsl */ `${PF} uniform float uP;
      void main(){
        float n = fbm(vP * 1.6);
        if (n < uP) discard;
        float edge = 1.0 - smoothstep(0.0, 0.045, n - uP);
        float lit = 0.12 + 0.88 * pow(max(dot(normalize(vN) * (gl_FrontFacing ? 1.0 : -1.0), normalize(vec3(0.4, 0.6, 0.7))), 0.0), 1.0);
        gl_FragColor = vec4(${PAPER} * (lit * 0.75 + edge * 1.6), 1.0);
      }`, { uP: { value: 0 } }, DS);
    pendMesh(m, obj);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', attr(new Float32Array(N * 3))); g.setAttribute('aR', attr(rnd, 1));
    whenReady(() => { g.setAttribute('position', attr(pPend)); g.setAttribute('aN', attr(nPend)); });
    const pm = mat(/* glsl */ `attribute vec3 aN; attribute float aR; uniform float uP; varying float vA;
      void main(){
        float n = fbm(position * 1.6), k = max(0.0, uP - n);
        vec3 p = position + aN * k * 0.9 + vec3(0.0, k * k * 5.0, 0.0) + flow(position * 2.0 + aR, uTime * 0.3) * k * 1.4;
        vA = step(0.001, k) * (1.0 - smoothstep(0.0, 0.42, k));
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_PointSize = uRes.y * 0.006 / -mv.z * 3.0;
        gl_Position = projectionMatrix * mv;
      }`, `varying float vA; void main(){ if (vA < 0.01 || length(gl_PointCoord - 0.5) > 0.5) discard; gl_FragColor = vec4(${PAPER} * vA * 0.8, 1.0); }`, { uP: m.uniforms.uP }, ADD);
    const pts = new THREE.Points(g, pm); pts.frustumCulled = false; obj.add(pts);
    cards.push({ id: 'C2', name: '溶かす・削る', obj, update: (c) => { m.uniforms.uP.value = 0.2 + 0.62 * (0.5 - 0.5 * Math.cos(c.bar * 0.3927)); obj.rotation.y = c.t * 0.25; } });
  }

  // ======================================================================= D1 / R3 水滴(くっつく形。下の写真を屈折させる)
  {
    const K = 40, blobs = new Float32Array(K * 3), seed = Array.from({ length: K }, () => [Math.random(), Math.random(), Math.random(), Math.random()]);
    const post = mat(`varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`, /* glsl */ `
      varying vec2 vUv; uniform vec3 uB[${K}];
      float f(vec2 p){ float s = 0.0; for (int i = 0; i < ${K}; i++){ vec2 d = p - uB[i].xy; float q = uB[i].z * uB[i].z / (dot(d, d) + 1e-4); s += q * q; } return s; }
      void main(){
        vec2 p = (vUv - 0.5) * vec2(uAsp, 1.0) * 2.0;
        float v = f(p), e = 0.012;
        vec2 g = vec2(f(p + vec2(e, 0.0)) - v, f(p + vec2(0.0, e)) - v) / e;
        float in_ = smoothstep(0.92, 1.08, v);
        float h = clamp((v - 1.0) * 0.35, 0.0, 1.0); // しずくの厚み
        vec2 n = -g / (length(g) + 1e-3) * (1.0 - h) * in_;
        vec2 uv = cover(vUv, uAsp, uAspA);
        vec3 bg = texture2D(tA, uv).rgb * 0.5;
        vec3 inside = texture2D(tA, uv - n * 0.045).rgb * 1.15;
        float sh = smoothstep(0.55, 1.0, f(p + vec2(0.035, 0.05))) * (1.0 - in_); // 落ちる影
        float spec = pow(max(dot(normalize(vec3(n * 1.4, 0.6)), normalize(vec3(-0.5, 0.6, 0.62))), 0.0), 26.0) * in_;
        float rim = smoothstep(0.35, 1.0, length(n)) * in_;
        gl_FragColor = vec4(mix(bg * (1.0 - 0.45 * sh), inside * (1.0 - 0.3 * rim), in_) + spec * 0.9, 1.0);
      }`, { uB: { value: blobs } });
    cards.push({ id: 'D1', name: '水滴(くっつく形が、下の写真を屈折させる)', post, noScene: true,
      update: (c) => {
        for (let i = 0; i < K; i++) {
          const s = seed[i], a = c.t * (0.12 + s[2] * 0.2) + s[3] * 6.28;
          blobs[i * 3] = ((s[0] - 0.5) * 2 * c.asp) + Math.sin(a) * 0.16;
          blobs[i * 3 + 1] = (s[1] - 0.5) * 2 + Math.cos(a * 1.3) * 0.16;
          blobs[i * 3 + 2] = (0.05 + 0.12 * s[2] * s[2]) * (1 + 0.14 * c.pulse);
        }
      } });
  }

  // ======================================================================= D2 形から形へ溶け移る(式で持つ形)
  {
    const post = mat(`varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`, /* glsl */ `
      varying vec2 vUv;
      float smin(float a, float b, float k){ float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0); return mix(b, a, h) - k * h * (1.0 - h); }
      float shape(vec3 p, float s){
        float a = length(vec2(length(p.xz) - 0.75, p.y)) - 0.3;                                  // 輪
        vec3 q = abs(p) - vec3(0.55); float b = length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0) - 0.12; // 箱
        vec3 t = p; t.xz = rot(p.y * 2.2) * t.xz; float c = length(vec2(length(t.xy) - 0.6, t.z)) - 0.22 + 0.0;     // ねじれた輪
        s = mod(s, 3.0); float k = smoothstep(0.0, 1.0, fract(s));
        return s < 1.0 ? mix(a, b, k) : (s < 2.0 ? mix(b, c, k) : mix(c, a, k));
      }
      float map(vec3 p){
        p.xz = rot(uTime * 0.3) * p.xz; p.xy = rot(0.4) * p.xy;
        float d = shape(p, uBar / 8.0);
        vec3 o = vec3(sin(uTime * 0.9), cos(uTime * 0.7), sin(uTime * 0.5)) * 1.05;
        d = smin(d, length(p - o) - 0.26, 0.5);
        return d - 0.05 * uPulse;
      }
      void main(){
        vec2 p = (vUv - 0.5) * vec2(uAsp, 1.0) * 2.0;
        vec3 ro = vec3(0.0, 0.0, 4.2 / min(uAsp * 1.7, 1.0)), rd = normalize(vec3(p * 0.62, -1.0));
        float t = 0.0, d = 1.0;
        for (int i = 0; i < 64; i++){ d = map(ro + rd * t); if (d < 0.002 || t > 14.0) break; t += d * 0.9; }
        vec3 col = vec3(0.0);
        if (d < 0.01) {
          vec3 q = ro + rd * t; vec2 e = vec2(0.004, 0.0);
          vec3 n = normalize(vec3(map(q + e.xyy) - map(q - e.xyy), map(q + e.yxy) - map(q - e.yxy), map(q + e.yyx) - map(q - e.yyx)));
          float lit = pow(max(dot(n, normalize(vec3(0.5, 0.7, 0.5))), 0.0), 1.1), rim = pow(1.0 - max(dot(n, -rd), 0.0), 3.0);
          col = ${PAPER} * (0.06 + 0.8 * lit + 0.5 * rim);
        }
        gl_FragColor = vec4(col, 1.0);
      }`);
    cards.push({ id: 'D2', name: '形から形へ溶け移る', post, noScene: true });
  }

  // ======================================================================= E1 網点・ディザ
  {
    const obj = new THREE.Group();
    pendMesh(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.55, metalness: 0.0, side: THREE.DoubleSide }), obj);
    const post = mat(`varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`, /* glsl */ `
      varying vec2 vUv; uniform sampler2D tScene; uniform float uCell;
      float bayer(vec2 p){ vec2 a = floor(mod(p, 4.0)); float i = a.x + a.y * 4.0;
        float m[16]; m[0]=0.;m[1]=8.;m[2]=2.;m[3]=10.;m[4]=12.;m[5]=4.;m[6]=14.;m[7]=6.;m[8]=3.;m[9]=11.;m[10]=1.;m[11]=9.;m[12]=15.;m[13]=7.;m[14]=13.;m[15]=5.;
        float v = 0.0; for (int k = 0; k < 16; k++) if (float(k) == i) v = m[k]; return (v + 0.5) / 16.0; }
      void main(){
        vec2 px = floor(gl_FragCoord.xy / uCell);
        float l = dot(texture2D(tScene, (px + 0.5) * uCell / uRes).rgb, vec3(0.299, 0.587, 0.114));
        gl_FragColor = vec4(${PAPER} * step(bayer(px), l * 1.15), 1.0);
      }`, { tScene: { value: null }, uCell: { value: 4 } });
    cards.push({ id: 'E1', name: '網点・ディザ', obj, post,
      update: (c) => { obj.rotation.y = c.t * 0.5; post.uniforms.uCell.value = [3, 5, 8, 5][Math.floor(c.bar / 4) % 4] * renderer.getPixelRatio(); } });
  }

  // ======================================================================= E2 線画(輪郭と、斜線の陰)
  {
    const obj = new THREE.Group();
    pendMesh(mat(PV, /* glsl */ `${PF}
      float ln(float c, float sp){ float f = abs(fract(c / sp) - 0.5) * sp; return 1.0 - smoothstep(0.5, 1.4, f); }
      void main(){
        vec3 n = normalize(vN) * (gl_FrontFacing ? 1.0 : -1.0);
        float L = dot(n, normalize(vec3(cos(uBeat * 0.3927), 0.6, 0.6)));
        vec2 f = gl_FragCoord.xy / (uRes.y / 900.0);
        float h = 0.0;
        h = max(h, ln(f.x + f.y, 9.0) * step(L, 0.75));
        h = max(h, ln(f.x - f.y, 9.0) * step(L, 0.35));
        h = max(h, ln(f.x + f.y + 4.5, 9.0) * step(L, 0.0));
        float rim = 1.0 - smoothstep(0.18, 0.32, abs(dot(n, normalize(vV))));
        gl_FragColor = vec4(${PAPER} * max(h * 0.85, rim), 1.0);
      }`, {}, DS), obj);
    cards.push({ id: 'E2', name: '線画(輪郭と、斜線の陰)', obj, update: (c) => { obj.rotation.y = c.t * 0.35; } });
  }

  // ======================================================================= E3 残像・引きずり(データモッシュ)
  {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', attr(new Float32Array(N * 3))); g.setAttribute('aUv', attr(new Float32Array(N * 2).map((_, i) => (i & 1 ? Math.floor((i >> 1) / 200) / 199 : ((i >> 1) % 200) / 199)), 2));
    whenReady(() => g.setAttribute('position', attr(pPend)));
    const m = mat(`attribute vec2 aUv; varying vec3 vC; void main(){ vC = texture2D(tA, cover(aUv, 0.8, uAspA)).rgb; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = uRes.y * 0.011 / -mv.z; gl_Position = projectionMatrix * mv; }`,
      `varying vec3 vC; void main(){ if (length(gl_PointCoord - 0.5) > 0.5) discard; gl_FragColor = vec4(vC * 1.2, 1.0); }`);
    const obj = new THREE.Points(g, m); obj.frustumCulled = false;
    const post = mat(`varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`, /* glsl */ `
      varying vec2 vUv; uniform sampler2D tScene, tPrev;
      void main(){
        // 拍の頭で、前の絵を 四角い塊ごとに ずらして引きずる(動きの向きは塊ごと)。
        vec2 blk = floor(vUv * vec2(18.0 * uAsp, 18.0));
        vec2 mv = (vec2(h31(vec3(blk, floor(uBeat))), h31(vec3(blk, floor(uBeat) + 7.0))) - 0.5) * 0.05 * uPulse;
        mv += (vUv - 0.5) * 0.006;
        vec3 prev = texture2D(tPrev, vUv - mv).rgb;
        vec3 now = texture2D(tScene, vUv).rgb;
        float keep = mix(0.9, 0.985, uPulse);
        gl_FragColor = vec4(max(now * (1.0 - 0.75 * uPulse), prev * keep), 1.0);
      }`, { tScene: { value: null }, tPrev: { value: null } });
    cards.push({ id: 'E3', name: '残像・引きずり(データモッシュ)', obj, post, feedback: true, update: (c) => { obj.rotation.y = c.t * 0.9; obj.rotation.x = Math.sin(c.t * 0.5) * 0.4; } });
  }

  // ======================================================================= E4 時間をずらす(スリットスキャン)
  {
    const obj = new THREE.Group();
    pendMesh(mat(/* glsl */ `varying vec3 vN, vV;
      void main(){
        // 高さごとに、違う時刻の回転を使う。回っているものを、細い横の隙間から少しずつ写したときの形になる。
        float a = (uTime - (position.y + 1.2) * (0.5 + 1.6 * (0.5 + 0.5 * sin(uBeat * 0.3927)))) * 1.6 + uPulse * 0.6 * sin(position.y * 5.0);
        vec3 p = position; p.xz = rot(a) * p.xz; p.x += 0.42 * sin(a * 1.1); p.z += 0.3 * cos(a * 0.8);
        vec3 n = normal; n.xz = rot(a) * n.xz;
        vN = normalize(normalMatrix * n); vec4 mv = modelViewMatrix * vec4(p, 1.0); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv;
      }`, /* glsl */ `varying vec3 vN, vV; void main(){ vec3 n = normalize(vN) * (gl_FrontFacing ? 1.0 : -1.0);
        float lit = 0.08 + 0.8 * pow(max(dot(n, normalize(vec3(0.5, 0.6, 0.6))), 0.0), 1.2) + 0.5 * pow(1.0 - abs(dot(n, normalize(vV))), 3.0);
        gl_FragColor = vec4(${PAPER} * lit, 1.0); }`, {}, DS), obj);
    cards.push({ id: 'E4', name: '時間をずらす(スリットスキャン)', obj });
  }

  // ======================================================================= E5 / R4 素材と光(円盤の虹)
  {
    const obj = new THREE.Group();
    pendMesh(mat(PV, /* glsl */ `${PF}
      vec3 spec(float x){ return 0.5 + 0.5 * cos(6.2832 * (x + vec3(0.0, 0.33, 0.67))); }
      void main(){
        vec3 n = normalize(vN) * (gl_FrontFacing ? 1.0 : -1.0), v = normalize(vV);
        vec3 L = normalize(vec3(sin(uBeat * 0.3927) * 1.2, 0.7, 0.8));
        vec3 T = normalize(cross(vec3(0.0, 1.0, 0.0), n) + 1e-4); // 軸のまわりの向き(溝の向き)
        float d = dot(T, normalize(L + v));
        float band = pow(max(0.0, 1.0 - abs(dot(n, normalize(L + v)) - 0.75) * 2.2), 2.0);
        vec3 col = spec(d * 2.4 + uTime * 0.05) * (0.25 + 0.75 * band) * (0.35 + 0.65 * pow(1.0 - abs(dot(n, v)), 1.5));
        col += vec3(1.0) * pow(max(dot(n, normalize(L + v)), 0.0), 60.0) * 0.8 + 0.02;
        gl_FragColor = vec4(col * (1.0 + 0.35 * uPulse), 1.0);
      }`, {}, DS), obj);
    cards.push({ id: 'E5', name: '素材と光(溝の虹)', obj, update: (c) => { obj.rotation.y = c.t * 0.4; obj.rotation.z = Math.sin(c.t * 0.3) * 0.25; } });
  }

  // ======================================================================= R5 逆光(光が指を追う。白黒と粒子)
  {
    const obj = new THREE.Group();
    pendMesh(mat(PV, /* glsl */ `${PF}
      void main(){
        vec3 n = normalize(vN) * (gl_FrontFacing ? 1.0 : -1.0), v = normalize(vV);
        vec3 lp = vec3(uPtr.x * 2.2 * uAsp, uPtr.y * 2.2, -1.6 + 0.4 * uPulse); // 光は、形の後ろにある
        vec3 l = normalize((viewMatrix * vec4(lp, 1.0)).xyz - (viewMatrix * vec4(vW, 1.0)).xyz);
        float dist = length(lp - vW);
        float back = pow(max(dot(-v, l), 0.0), 2.0) * pow(1.0 - abs(dot(n, v)), 2.2) * 5.0;
        float wrap = pow(max(dot(n, l) * 0.5 + 0.5, 0.0), 3.0) * 0.5;
        float g = (h31(vec3(gl_FragCoord.xy, uTime * 60.0)) - 0.5) * 0.09;
        gl_FragColor = vec4(vec3((back + wrap) / (0.5 + dist * dist * 0.22) + 0.012 + g), 1.0);
      }`, {}, DS), obj);
    cards.push({ id: 'R5', name: '逆光(光が指を追う)', obj, update: (c) => { obj.rotation.y = c.t * 0.15; }, cam: (c) => orbit(c, 0, 0.1, 4.6) });
  }

  // ======================================================================= R6 作品が板になって、空間に積まれる
  {
    const obj = new THREE.Group();
    const slabs: THREE.Mesh[] = [];
    const side = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.4 });
    const card: Card & { fill?: () => void } = { id: 'R6', name: '作品が板になって、空間に積まれる', obj,
      update: (c) => slabs.forEach((s, i) => { s.rotation.x = 1.15 + 0.22 * Math.sin(c.t * 0.4 + i); s.rotation.z = 0.5 * i + c.t * (0.05 + 0.02 * (i % 3)) ; s.position.y = (i - (slabs.length - 1) / 2) * 0.42 + 0.06 * Math.sin(c.t * 0.7 + i * 2.0) + (i % 2 ? 1 : -1) * 0.1 * c.pulse; }),
      cam: (c) => orbit(c, c.t * 0.12, 0.35 + 0.25 * Math.sin(c.t * 0.2), 5.6) };
    card.fill = () => {
      while (slabs.length < Math.min(tex.length, 9)) {
        const t = tex[slabs.length], a = t.image.width / t.image.height, w = a > 1 ? 1.5 : 1.5 * a, h = a > 1 ? 1.5 / a : 1.5;
        const face = new THREE.MeshBasicMaterial({ map: t });
        const s = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.07), [side, side, side, side, face, face]);
        slabs.push(s); obj.add(s);
      }
    };
    cards.push(card);
  }

  // ======================================================================= R8 細い線の束が、立体を成す
  {
    const K = 260, SEG = 180;
    const g = new THREE.BufferGeometry();
    const a = new Float32Array(K * SEG * 2 * 2);
    let o = 0;
    for (let k = 0; k < K; k++) for (let s = 0; s < SEG; s++) for (let e = 0; e < 2; e++) { a[o++] = k / K; a[o++] = (s + e) / SEG; }
    g.setAttribute('position', attr(new Float32Array(K * SEG * 2 * 3))); g.setAttribute('aKS', attr(a, 2));
    const m = mat(/* glsl */ `attribute vec2 aKS; varying float vL;
      void main(){
        float k = aKS.x, s = aKS.y * 6.2832, t = uTime * 0.12;
        // となりの線と、少しずつ違う輪。重なって面に見える。
        float a1 = 1.0 + 2.0 * sin(k * 1.1 + t), a2 = 2.0 + sin(k * 0.7 - t * 1.3), a3 = 3.0;
        vec3 p = vec3(sin(s + k * 2.4 + t) * (0.7 + 0.5 * sin(k * 3.1416 * a1 * 0.5)),
                      sin(s * 2.0 + k * 1.3 * a2) * 0.9 * cos(k * 3.1416),
                      cos(s * a3 * 0.3333 + k * 4.0 - t) * (0.5 + 0.6 * k));
        p *= 1.0 + 0.12 * uPulse * sin(k * 20.0);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        vL = 0.2 + 0.8 * smoothstep(-6.6, -4.0, mv.z);
        gl_Position = projectionMatrix * mv;
      }`, `varying float vL; void main(){ gl_FragColor = vec4(${PAPER} * vL * 0.2, 1.0); }`, {}, ADD);
    const obj = new THREE.LineSegments(g, m); obj.frustumCulled = false;
    cards.push({ id: 'R8', name: '細い線の束が、立体を成す', obj, update: (c) => { obj.rotation.y = c.t * 0.2; obj.rotation.x = 0.3; }, cam: (c) => orbit(c, 0, 0.1, 5.6) });
  }

  // ---- 視点
  const smooth = (x: number) => { const v = Math.max(0, Math.min(1, x)); return v * v * (3 - 2 * v); };
  function orbit(c: Ctx, yaw: number, pitch: number, r: number) {
    const k = c.asp < 0.8 ? 1.0 + (0.8 - c.asp) * 0.9 : 1; // 縦長の画面では、少し引く
    c.cam.position.set(Math.sin(yaw) * Math.cos(pitch) * r * k, Math.sin(pitch) * r * k, Math.cos(yaw) * Math.cos(pitch) * r * k);
    c.cam.lookAt(0, 0, 0);
  }

  // ---- 後処理(描いた絵を、もう一度加工する札のため)
  const quadScene = new THREE.Scene(), quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
  quad.frustumCulled = false; quadScene.add(quad);
  const blit = new THREE.ShaderMaterial({ uniforms: { t: { value: null } }, vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`, fragmentShader: `varying vec2 vUv; uniform sampler2D t; void main(){ gl_FragColor = texture2D(t, vUv); }` });
  let rtS: THREE.WebGLRenderTarget, rtA: THREE.WebGLRenderTarget, rtB: THREE.WebGLRenderTarget;
  const mkRT = (w: number, h: number) => new THREE.WebGLRenderTarget(w, h, { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });

  let vw = 1, vh = 1;
  function resize() {
    vw = root.clientWidth; vh = root.clientHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    renderer.setPixelRatio(dpr); renderer.setSize(vw, vh, false);
    cam.aspect = vw / vh; cam.updateProjectionMatrix();
    S.uRes.value.set(vw * dpr, vh * dpr); S.uAsp.value = vw / vh;
    [rtS, rtA, rtB].forEach((r) => r?.dispose());
    rtS = mkRT(vw * dpr, vh * dpr); rtS.depthBuffer = true; rtA = mkRT(vw * dpr, vh * dpr); rtB = mkRT(vw * dpr, vh * dpr);
  }

  // ---- 進行
  let cur = -1, enterBeat = 0, t = 0, beat = 0, last = performance.now(), frozen: number | null = null;
  const ptr = new THREE.Vector2(0.3, 0.3);
  const ctx: Ctx = { t: 0, dt: 0, beat: 0, pulse: 0, bar: 0, cam, asp: 1, ptr };
  function go(n: number) {
    const k = ((n % cards.length) + cards.length) % cards.length;
    if (cur >= 0 && cards[cur].obj) scene.remove(cards[cur].obj!);
    cur = k; enterBeat = beat;
    if (cards[k].obj) scene.add(cards[k].obj!);
    if (label) label.textContent = `${String(k + 1).padStart(2, '0')} / ${cards.length}  ${cards[k].id}  ${cards[k].name}`;
    history.replaceState(null, '', `?c=${k + 1}`);
  }
  function frame(now: number) {
    if (dead) return;
    const dt = Math.max(0, Math.min(0.05, (now - last) / 1000)); last = now;
    if (frozen === null) { t += dt; beat += (dt * BPM) / 60; }
    const c = cards[cur];
    ctx.t = t; ctx.dt = dt; ctx.beat = beat; ctx.bar = beat - enterBeat; ctx.pulse = Math.exp(-(beat - Math.floor(beat)) * 4.5); ctx.asp = vw / vh;
    S.uTime.value = t; S.uBeat.value = beat; S.uPulse.value = ctx.pulse; S.uBar.value = ctx.bar; S.uPtr.value.copy(ptr);
    // 写真は、16拍ごとに次へ。
    const pa = Math.floor(beat / 16); if (pa !== photoAt) { photoAt = pa; setPhotos(); }
    if (c.cam) c.cam(ctx); else orbit(ctx, 0, 0.12, 5.2);
    c.update?.(ctx);
    c.pre?.(renderer, ctx);
    if (!c.post) { renderer.setRenderTarget(null); renderer.render(scene, cam); }
    else {
      if (!c.noScene) { renderer.setRenderTarget(rtS); renderer.render(scene, cam); if (c.post.uniforms.tScene) c.post.uniforms.tScene.value = rtS.texture; }
      quad.material = c.post;
      if (c.feedback) {
        c.post.uniforms.tPrev.value = rtA.texture;
        renderer.setRenderTarget(rtB); renderer.render(quadScene, quadCam);
        blit.uniforms.t.value = rtB.texture; quad.material = blit;
        renderer.setRenderTarget(null); renderer.render(quadScene, quadCam);
        [rtA, rtB] = [rtB, rtA];
      } else { renderer.setRenderTarget(null); renderer.render(quadScene, quadCam); }
    }
    requestAnimationFrame(frame);
  }

  // ---- 入力: 叩くと次の札。← → でも。指の位置は、光を動かす札で使う。
  let downX = 0, downY = 0;
  const onDown = (e: PointerEvent) => { if ((e.target as HTMLElement).closest('a,button')) { downX = -1e6; return; } downX = e.clientX; downY = e.clientY; };
  const onMove = (e: PointerEvent) => { const r = root.getBoundingClientRect(); ptr.set(((e.clientX - r.left) / vw) * 2 - 1, -(((e.clientY - r.top) / vh) * 2 - 1)); };
  const onUp = (e: PointerEvent) => { if (Math.hypot(e.clientX - downX, e.clientY - downY) < 12) go(cur + (e.clientX < vw * 0.25 ? -1 : 1)); };
  const onKey = (e: KeyboardEvent) => { if (e.key === 'ArrowRight' || e.key === ' ') go(cur + 1); if (e.key === 'ArrowLeft') go(cur - 1); };
  root.addEventListener('pointerdown', onDown);
  window.addEventListener('pointermove', onMove);
  root.addEventListener('pointerup', onUp);
  window.addEventListener('keydown', onKey);
  window.addEventListener('resize', resize);
  resize();
  const start = parseInt(new URLSearchParams(location.search).get('c') ?? '1', 10) || 1;
  go(start - 1);
  requestAnimationFrame(frame);

  // 確認用: __deck.go(3) で4枚目へ。__deck.at(12.5) で、その札に入って 12.5 拍目の絵に止める。null で戻す。
  (window as unknown as { __deck?: unknown }).__deck = {
    go, at(b: number | null) { frozen = b; if (b !== null) { beat = enterBeat + b; t = (beat * 60) / BPM; } },
    get n() { return cards.length; }, get ids() { return cards.map((c) => c.id); }, get ready() { return ready.pend && ready.puck && tex.length >= 2; },
  };

  return () => {
    dead = true;
    root.removeEventListener('pointerdown', onDown);
    window.removeEventListener('pointermove', onMove);
    root.removeEventListener('pointerup', onUp);
    window.removeEventListener('keydown', onKey);
    window.removeEventListener('resize', resize);
    renderer.dispose();
  };
}
