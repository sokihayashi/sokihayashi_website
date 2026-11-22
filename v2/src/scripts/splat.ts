// 試作: 作品が、奥行きを持った粒になって立ち上がり、ほどけて、次の作品に組み直る。
//
// 画面にあるのは、約5.8万個の粒だけ。1つの作品の写真を、粒の格子で描く。
// 粒の奥行きは、写真から事前に推定した奥行き(Depth Anything V2 Small)で決まる。
// 映像としての流れ(1作品ぶん):
//   組み上がる(1.6秒) → 立っている(数秒。ゆっくり寄る) → 溜め(0.45秒。震えて縮む) → ほどける(1.5秒) → 漂う(0.4秒) → 次の作品
//   組み上がり方とほどけ方は、毎回変わる(奥から / 横に掃く / 中心から、など)。立っている長さも毎回変わる。
// 指(なぞる)だけが操作: なぞった所の粒が、指の向きに押し流され、浮き上がり、やがて戻る。
// たくさん描くと、溜まった力で早くほどける。指(カーソル)の位置で、視点が少しずれる。
//
// 確認用: window.__splat = { go(i), state }

import { makeSfx } from './sfx';

const GRID = 240; // 粒の格子の、正方形のときの一辺(作品の縦横比に合わせて変える)
const N = GRID * GRID;
const TRAIL = 40; // なぞった跡を覚えておく数

const VS = `#version 300 es
precision highp float;
precision highp int;
layout(location=0) in vec2 aQ;
uniform sampler2D uImg;   // いまの作品
uniform sampler2D uPrev;  // ひとつ前の作品(漂っている粒の色を、なめらかに切り替えるため)
uniform sampler2D uDepth;
uniform vec2 uView;
uniform vec2 uGrid;       // 格子の数(横, 縦)
uniform vec4 uRect;       // 作品を置く所(中心x, 中心y, 幅, 高さ)
uniform float uT, uForm, uBurst, uTens, uColMix, uZoom, uDepthAmt;
uniform vec2 uRot;        // 視点の回り込み(横, 縦)
uniform vec2 uStyle;      // 組み上がり方, ほどけ方
uniform vec4 uTrail[${TRAIL}]; // なぞった跡(x, y, 動きx, 動きy)
uniform float uTrailW[${TRAIL}];
out vec3 vCol;
out vec2 vQ;
out float vRest;
float hsh(uint n){ n = (n << 13U) ^ n; n = n * (n * n * 15731U + 789221U) + 1376312589U; return float(n & 0x7fffffffU) / 2147483647.0; }
void main(){
  int i = gl_InstanceID;
  int gw = int(uGrid.x); int gh = int(uGrid.y);
  int gx = i - (i / gw) * gw; int gy = i / gw;
  if (gy >= gh) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  vec2 uv = (vec2(float(gx), float(gy)) + 0.5) / uGrid;
  float h1 = hsh(uint(i)); float h2 = hsh(uint(i) + 7919U); float h3 = hsh(uint(i) * 3U + 17U);
  vec3 col = textureLod(uImg, uv, 0.0).rgb;
  vec3 pcol = textureLod(uPrev, uv, 0.0).rgb;
  float d = textureLod(uDepth, uv, 0.0).r;
  float W = uRect.z; float H = uRect.w;
  vec3 rest = vec3(uRect.x + (uv.x - 0.5) * W, uRect.y + (uv.y - 0.5) * H, (d - 0.45) * uDepthAmt);

  // ほどけた粒は、画面を大きく巡る1本の帯になって流れる(ねじれながら)。
  float R = max(uView.x, uView.y) * 0.85;
  float sl = fract(h1 + uT * 0.035 * (0.75 + 0.5 * h3));
  float an = sl * 6.2832;
  vec3 c0 = vec3(cos(an) * 0.62 + 0.16 * sin(2.0 * an + uT * 0.21), 0.30 * sin(1.5 * an + uT * 0.17), sin(an) * 0.55) * R;
  float an2 = an + 0.01;
  vec3 c1 = vec3(cos(an2) * 0.62 + 0.16 * sin(2.0 * an2 + uT * 0.21), 0.30 * sin(1.5 * an2 + uT * 0.17), sin(an2) * 0.55) * R;
  vec3 tg = normalize(c1 - c0);
  vec3 nb = normalize(cross(tg, vec3(0.0, 1.0, 0.0)) + vec3(0.0, 0.0, 1e-4));
  vec3 bn = cross(nb, tg);
  float tw = an * 2.0 + uT * 0.35;
  float wv = (h2 - 0.5) * R * 0.2;
  vec3 cloud = c0 + (nb * cos(tw) + bn * sin(tw)) * wv + (vec3(h3, h1, h2) - 0.5) * R * 0.025;
  cloud.xy += uView * 0.5;

  // 組み上がり方: 0 手前から / 1 左から掃く / 2 中心から / 3 下から積む
  float fd = uStyle.x < 0.5 ? 1.0 - d : uStyle.x < 1.5 ? uv.x : uStyle.x < 2.5 ? length(uv - 0.5) * 1.4 : 1.0 - uv.y;
  // ほどけ方: 0 外から / 1 上の行から剥がれる / 2 奥から / 3 右から掃く
  float bd = uStyle.y < 0.5 ? 1.0 - length(uv - 0.5) * 1.4 : uStyle.y < 1.5 ? uv.y : uStyle.y < 2.5 ? d : 1.0 - uv.x;
  const float S = 0.85;
  float fl = clamp(uForm * (1.0 + S) - S * (0.8 * fd + 0.2 * h1), 0.0, 1.0);
  float bl = clamp(uBurst * (1.0 + S) - S * (0.8 * bd + 0.2 * h2), 0.0, 1.0);
  fl = 1.0 - pow(1.0 - fl, 3.0);       // 着地は ゆっくり
  bl = bl * bl * (3.0 - 2.0 * bl);
  float a = fl * (1.0 - bl);

  // 溜め: 震えて、少し縮む。
  vec3 p = rest;
  p.xy += (vec2(sin(uT * 47.0 + h1 * 40.0), cos(uT * 53.0 + h2 * 40.0)) * 1.8 + (uRect.xy - p.xy) * 0.035) * uTens;
  p.z += uTens * uDepthAmt * 0.25 * (h3 - 0.3);

  // なぞった所: 指の向きに押し流され、浮き上がる。時間とともに戻る。
  vec3 disp = vec3(0.0);
  float rad = W * 0.09 + 26.0;
  for (int k = 0; k < ${TRAIL}; k++) {
    float w = uTrailW[k];
    if (w <= 0.001) continue;
    vec2 dd = rest.xy - uTrail[k].xy;
    float g = exp(-dot(dd, dd) / (rad * rad)) * w;
    disp.xy += uTrail[k].zw * g * 0.55 + normalize(dd + 0.001) * g * 6.0;
    disp.z += g * uDepthAmt * 0.9;
  }
  float dl = length(disp.xy);
  disp.xy *= min(1.0, W * 0.35 / max(dl, 1e-3));
  disp.z = min(disp.z, uDepthAmt * 0.8);
  p += disp * (0.6 + 0.8 * h3);

  // 雲から作品へ(と、その逆)。途中は少し ふくらんで飛ぶ。
  float arc = sin(3.14159 * a);
  vec3 bulge = vec3(h1 - 0.5, h2 - 0.5, h3 - 0.2) * vec3(W, H, uDepthAmt * 6.0) * 0.5 * arc;
  vec3 pos = mix(cloud, p, a) + bulge * (1.0 - a);

  // 視点: 作品の中心のまわりに回り込み、寄る。
  vec3 c = vec3(uView * 0.5, 0.0);
  vec3 q = pos - c;
  float cy = cos(uRot.x); float sy = sin(uRot.x);
  q = vec3(cy * q.x + sy * q.z, q.y, -sy * q.x + cy * q.z);
  float cx = cos(uRot.y); float sx = sin(uRot.y);
  q = vec3(q.x, cx * q.y - sx * q.z, sx * q.y + cx * q.z);
  q *= uZoom;
  const float F = 1600.0;
  float s = F / max(F - q.z, 60.0);
  vec2 sp = c.xy + q.xy * s;

  // 大きさ: 立っている時は、となりと重なって1枚の写真に見える。漂う時は小さな粒。
  float spacing = W / uGrid.x;
  float size = mix(mix(0.7, 2.0, h2 * h2), spacing * 0.78, a) * s * uZoom;
  size *= 1.0 + min(length(disp.xy) / (rad * 3.0), 0.5);
  vec2 corner = sp + aQ * size;
  gl_Position = vec4(corner.x / uView.x * 2.0 - 1.0, 1.0 - corner.y / uView.y * 2.0, clamp(-q.z / 4000.0, -0.99, 0.99), 1.0);

  vec3 cc = mix(pcol, col, uColMix);
  // 漂う粒は、少し暗く、ときどき強く光る(遠いほど暗い)。
  float far = clamp(1.0 - (q.z + R) / (2.0 * R), 0.0, 1.0);
  float spark = h1 > 0.97 ? 1.8 : mix(0.45, 1.0, h3);
  float shade = 0.78 + 0.32 * d;
  vCol = mix(cc * spark * mix(1.0, 0.35, far), col * shade, a);
  vQ = aQ;
  vRest = a;
}`;

const FS = `#version 300 es
precision highp float;
in vec3 vCol; in vec2 vQ; in float vRest;
out vec4 o;
void main(){
  float r2 = dot(vQ, vQ);
  if (r2 > 1.0) discard;
  // 立っている時は、ほとんど平ら(写真として見せる)。漂う時は、丸い粒に見えるよう ふちを落とす。
  float edge = mix(1.0 - 0.55 * r2, 1.0 - 0.12 * r2, vRest);
  o = vec4(vCol * edge, 1.0);
}`;

type Work = { title: string; href: string; src: string; depth: string; img?: WebGLTexture; dep?: WebGLTexture; aspect: number; ready: boolean };

export function mountSplat(root: HTMLElement) {
  const cv = root.querySelector<HTMLCanvasElement>('[data-canvas]')!;
  const gl = cv.getContext('webgl2', { antialias: true, alpha: false, powerPreference: 'high-performance' });
  if (!gl) return () => {};
  const works: Work[] = [...root.querySelectorAll<HTMLAnchorElement>('a[data-work]')].map((a) => ({
    title: a.textContent?.trim() || '',
    href: a.href,
    src: a.dataset.src || '',
    depth: a.dataset.depth || '',
    aspect: 1,
    ready: false,
  }));
  if (!works.length) return () => {};

  // ---------- GL
  const prog = gl.createProgram()!;
  for (const [type, src] of [
    [gl.VERTEX_SHADER, VS],
    [gl.FRAGMENT_SHADER, FS],
  ] as const) {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) console.error('splat shader', gl.getShaderInfoLog(s));
    gl.attachShader(prog, s);
  }
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    console.error('splat link', gl.getProgramInfoLog(prog));
    return () => {};
  }
  gl.useProgram(prog);
  const U = (n: string) => gl.getUniformLocation(prog, n);
  const u = {
    view: U('uView'), grid: U('uGrid'), rect: U('uRect'), t: U('uT'), form: U('uForm'), burst: U('uBurst'), tens: U('uTens'),
    colMix: U('uColMix'), zoom: U('uZoom'), depthAmt: U('uDepthAmt'), rot: U('uRot'), style: U('uStyle'),
    trail: U('uTrail'), trailW: U('uTrailW'),
  };
  gl.uniform1i(U('uImg'), 0);
  gl.uniform1i(U('uPrev'), 1);
  gl.uniform1i(U('uDepth'), 2);
  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.enable(gl.DEPTH_TEST);
  gl.depthFunc(gl.LEQUAL);
  gl.clearColor(0, 0, 0, 1);

  const texFrom = (src: TexImageSource, linear: boolean) => {
    const t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
    const f = linear ? gl.LINEAR : gl.NEAREST;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, f);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, f);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  };
  const black = texFrom(new ImageData(new Uint8ClampedArray([12, 12, 12, 255]), 1, 1), false);
  let dead = false;
  const loading = new Set<number>();
  function load(k: number) {
    const w = works[k];
    if (w.ready || loading.has(k)) return;
    loading.add(k);
    const a = new Image();
    const b = new Image();
    a.decoding = b.decoding = 'async';
    let n = 0;
    const done = () => {
      if (++n < 2 || dead) return;
      gl!.activeTexture(gl!.TEXTURE3);
      w.img = texFrom(a, true);
      w.dep = texFrom(b, true);
      w.aspect = a.naturalWidth / a.naturalHeight;
      w.ready = true;
      loading.delete(k);
    };
    a.onload = b.onload = done;
    a.onerror = b.onerror = () => loading.delete(k);
    a.src = w.src;
    b.src = w.depth;
  }

  // ---------- 大きさ
  let vw = 0;
  let vh = 0;
  function size() {
    vw = root.clientWidth;
    vh = root.clientHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(6.6e6 / (vw * vh)));
    cv.width = Math.round(vw * dpr);
    cv.height = Math.round(vh * dpr);
    gl!.viewport(0, 0, cv.width, cv.height);
  }

  // ---------- 流れ(1作品ぶん)
  type Phase = 'form' | 'hold' | 'tens' | 'burst' | 'gap';
  let cur = 0;
  let prev = -1;
  let phase: Phase = 'form';
  let pt = 0; // この段に入ってからの秒
  let holdLen = 4.5;
  let style = [0, 0];
  let energy = 0; // なぞって溜まった力
  let colMix = 1;
  let zoom = 1;
  let sweepDir = 1;
  const DUR = { form: 1.7, tens: 0.45, burst: 1.5, gap: 0.45 };
  const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)];
  function enter(p: Phase) {
    phase = p;
    pt = 0;
    if (p === 'form') {
      style = [pick([0, 1, 2, 3]), pick([0, 1, 2, 3])];
      holdLen = pick([3.2, 4.6, 6.8]);
      sweepDir = Math.random() < 0.5 ? -1 : 1;
      showLabel(false);
      sfx.pon(0.2 + 0.6 * Math.random());
    }
    if (p === 'hold') showLabel(true);
    if (p === 'tens') showLabel(false);
    if (p === 'burst') sfx.pluck(Math.floor(Math.random() * 10));
    if (p === 'gap') {
      prev = cur;
      cur = (cur + 1) % works.length;
      colMix = 0;
      load((cur + 1) % works.length);
    }
  }

  // ---------- 文字(仮): 立っている間だけ、左下に作品名。右下に音。
  const sfx = makeSfx();
  const mk = (tag: string, css: string) => {
    const e = document.createElement(tag);
    e.style.cssText = css;
    return e;
  };
  const FRAME = 'position:absolute;z-index:3;box-sizing:border-box;border:1px solid var(--fg);background:#000;color:var(--fg);font:inherit;';
  const BOTTOM = 'bottom:calc(1.1rem + env(safe-area-inset-bottom));';
  const label = mk('a', `${FRAME}left:var(--pad);${BOTTOM}max-width:min(calc(100vw - var(--pad)*2 - 7rem),26rem);padding:.6rem .75rem .65rem;text-decoration:none;opacity:0;transition:opacity .4s;pointer-events:none;`) as HTMLAnchorElement;
  const lbT = mk('span', 'display:block;font-size:.9rem;line-height:1.4;');
  const lbM = mk('span', 'display:block;margin-top:.2rem;font-size:.66rem;letter-spacing:.06em;color:var(--muted);');
  lbM.textContent = 'Open';
  label.append(lbT, lbM);
  const snd = mk('button', `${FRAME}right:var(--pad);${BOTTOM}padding:.5rem .7rem;font-size:.66rem;letter-spacing:.08em;cursor:pointer;border-radius:0;`) as HTMLButtonElement;
  snd.type = 'button';
  const sndText = () => {
    snd.textContent = sfx.on ? 'Sound on' : 'Sound off';
    snd.setAttribute('aria-pressed', String(sfx.on));
  };
  sndText();
  snd.addEventListener('click', () => {
    sfx.set(!sfx.on);
    sndText();
    if (sfx.on) sfx.click();
  });
  root.append(label, snd);
  function showLabel(on: boolean) {
    if (on) {
      lbT.textContent = works[cur].title;
      label.href = works[cur].href;
    }
    label.style.opacity = on ? '1' : '0';
    label.style.pointerEvents = on ? 'auto' : 'none';
  }

  // ---------- 入力(指一本)
  const trail = new Float32Array(TRAIL * 4);
  const trailW = new Float32Array(TRAIL);
  const trailAge = new Float32Array(TRAIL).fill(99);
  let tk = 0;
  let drawing = false;
  let lastX = 0;
  let lastY = 0;
  let lastT = 0;
  let ptX = 0.5; // 指(カーソル)の位置(0〜1)
  let ptY = 0.5;
  const isUI = (t: EventTarget | null) => t instanceof Element && !!t.closest('a,button');
  function addTrail(x: number, y: number, vx: number, vy: number) {
    const k = tk++ % TRAIL;
    trail[k * 4] = x;
    trail[k * 4 + 1] = y;
    const m = Math.hypot(vx, vy);
    const cap = Math.min(m, 2400) / (m || 1);
    trail[k * 4 + 2] = vx * cap * 0.06;
    trail[k * 4 + 3] = vy * cap * 0.06;
    trailAge[k] = 0;
    energy += Math.min(m, 2400) * 0.00012;
  }
  function onDown(e: PointerEvent) {
    if (isUI(e.target) || (e.pointerType === 'mouse' && e.button !== 0)) return;
    const r = root.getBoundingClientRect();
    drawing = true;
    lastX = e.clientX - r.left;
    lastY = e.clientY - r.top;
    lastT = performance.now();
    try {
      root.setPointerCapture(e.pointerId);
    } catch {}
    e.preventDefault();
  }
  function onMove(e: PointerEvent) {
    const r = root.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    ptX = x / vw;
    ptY = y / vh;
    if (!drawing) return;
    const now = performance.now();
    const dt = Math.max(8, now - lastT) / 1000;
    const d = Math.hypot(x - lastX, y - lastY);
    if (d < 6) return;
    addTrail(x, y, (x - lastX) / dt, (y - lastY) / dt);
    sfx.climb(Math.min(1, energy));
    lastX = x;
    lastY = y;
    lastT = now;
  }
  function onUp() {
    drawing = false;
  }
  root.addEventListener('pointerdown', onDown);
  root.addEventListener('pointermove', onMove);
  root.addEventListener('pointerup', onUp);
  root.addEventListener('pointercancel', onUp);
  window.addEventListener('resize', size);

  // ---------- 毎コマ
  let raf = 0;
  let last = performance.now();
  const t0 = last;
  let rotX = 0;
  let rotY = 0;
  const ease = (x: number) => x * x * (3 - 2 * x);
  function tick(t: number) {
    raf = requestAnimationFrame(tick);
    const dt = Math.min(0.05, Math.max(0.001, (t - last) / 1000));
    last = t;
    const now = (t - t0) / 1000;
    const w = works[cur];
    if (!w.ready) {
      load(cur);
      if (phase === 'form' && pt === 0) {
        gl!.clear(gl!.COLOR_BUFFER_BIT | gl!.DEPTH_BUFFER_BIT);
        return;
      }
    }
    pt += dt;
    energy = Math.max(0, energy - dt * 0.18);
    let form = 1;
    let burst = 0;
    let tens = 0;
    if (phase === 'form') {
      form = Math.min(1, pt / DUR.form);
      if (pt >= DUR.form) enter('hold');
    } else if (phase === 'hold') {
      if ((pt >= holdLen || (energy > 1.2 && pt > 1.2)) && works[(cur + 1) % works.length].ready) {
        energy = 0;
        enter('tens');
      }
    } else if (phase === 'tens') {
      tens = ease(Math.min(1, pt / DUR.tens));
      if (pt >= DUR.tens) enter('burst');
    } else if (phase === 'burst') {
      burst = Math.min(1, pt / DUR.burst);
      if (pt >= DUR.burst) enter('gap');
    } else {
      form = 0;
      if (pt >= DUR.gap && works[cur].ready) enter('form');
    }
    if (phase === 'gap' || phase === 'form') colMix = Math.min(1, colMix + dt / 0.9);
    // 視点: ゆっくり漂い、指(カーソル)のほうへ少し回り込む。立っている間は、ゆっくり寄る。ほどける瞬間に引く。
    // 立っている間は、カメラが作品のまわりを大きく回り込む(向きは毎回変わる)。
    const sweep = phase === 'hold' ? sweepDir * (-0.42 + 0.84 * ease(Math.min(1, pt / holdLen))) : phase === 'tens' ? sweepDir * 0.42 : phase === 'form' ? -sweepDir * 0.42 * (1 - ease(Math.min(1, pt / DUR.form))) - sweepDir * 0.42 * ease(Math.min(1, pt / DUR.form)) * 0 : 0;
    const tx = sweep + 0.06 * Math.sin(now * 0.13) + (ptX - 0.5) * 0.3;
    const ty = 0.12 * Math.sin(now * 0.11 + 1) + (ptY - 0.5) * 0.2;
    rotX += (tx - rotX) * (1 - Math.exp(-dt / 0.6));
    rotY += (ty - rotY) * (1 - Math.exp(-dt / 0.6));
    const zt = phase === 'hold' ? 1 + 0.05 * Math.min(1, pt / holdLen) : phase === 'tens' ? 1.06 : phase === 'burst' ? 0.94 : 1;
    zoom += (zt - zoom) * (1 - Math.exp(-dt / (phase === 'burst' ? 0.25 : 1.2)));
    // なぞった跡は、1.3秒で消える。
    for (let k = 0; k < TRAIL; k++) {
      trailAge[k] += dt;
      trailW[k] = Math.max(0, 1 - trailAge[k] / 1.3) ** 2;
    }

    // 作品を置く所: 画面の中央に、縦横比を保って大きく。
    const cw = works[cur];
    const a = cw.aspect;
    const maxW = vw * (vw > vh ? 0.7 : 0.86);
    const maxH = vh * 0.7;
    let W = maxW;
    let H = W / a;
    if (H > maxH) {
      H = maxH;
      W = H * a;
    }
    const gw = Math.max(8, Math.round(Math.sqrt(N * a)));
    const gh = Math.min(Math.floor(N / gw), Math.round(gw / a));

    gl!.useProgram(prog);
    gl!.uniform2f(u.view, vw, vh);
    gl!.uniform2f(u.grid, gw, gh);
    gl!.uniform4f(u.rect, vw / 2, vh / 2, W, H);
    gl!.uniform1f(u.t, now);
    gl!.uniform1f(u.form, form);
    gl!.uniform1f(u.burst, burst);
    gl!.uniform1f(u.tens, tens);
    gl!.uniform1f(u.colMix, colMix);
    gl!.uniform1f(u.zoom, zoom);
    gl!.uniform1f(u.depthAmt, Math.min(W, H) * 0.6);
    gl!.uniform2f(u.rot, rotX, rotY);
    gl!.uniform2f(u.style, style[0], style[1]);
    gl!.uniform4fv(u.trail, trail);
    gl!.uniform1fv(u.trailW, trailW);
    gl!.activeTexture(gl!.TEXTURE0);
    gl!.bindTexture(gl!.TEXTURE_2D, cw.img || black);
    gl!.activeTexture(gl!.TEXTURE1);
    gl!.bindTexture(gl!.TEXTURE_2D, (prev >= 0 && works[prev].img) || cw.img || black);
    gl!.activeTexture(gl!.TEXTURE2);
    gl!.bindTexture(gl!.TEXTURE_2D, cw.dep || black);
    gl!.clear(gl!.COLOR_BUFFER_BIT | gl!.DEPTH_BUFFER_BIT);
    gl!.drawArraysInstanced(gl!.TRIANGLE_STRIP, 0, 4, N);
  }
  size();
  load(0);
  load(1);
  enter('form');
  raf = requestAnimationFrame(tick);

  (window as unknown as Record<string, unknown>).__splat = {
    // 確認用: 段を指定して止める(p: 'form' | 'hold' | 'tens' | 'burst' | 'gap', t: その段での秒)
    at(p: Phase, sec: number, s?: number[]) {
      phase = p;
      pt = sec;
      if (s) style = s;
      if (p === 'hold') holdLen = 999;
      if (p === 'gap' || p === 'form') colMix = 1;
    },
    go(i: number) {
      cur = i % works.length;
      load(cur);
      enter('form');
    },
    draw(pts: number[][]) {
      for (let k = 1; k < pts.length; k++) addTrail(pts[k][0], pts[k][1], (pts[k][0] - pts[k - 1][0]) * 60, (pts[k][1] - pts[k - 1][1]) * 60);
    },
    get state() {
      return { cur, phase, pt, style, energy, ready: works.map((w) => w.ready).filter(Boolean).length };
    },
  };

  return () => {
    dead = true;
    cancelAnimationFrame(raf);
    root.removeEventListener('pointerdown', onDown);
    root.removeEventListener('pointermove', onMove);
    root.removeEventListener('pointerup', onUp);
    root.removeEventListener('pointercancel', onUp);
    window.removeEventListener('resize', size);
    label.remove();
    snd.remove();
    sfx.dispose();
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  };
}
