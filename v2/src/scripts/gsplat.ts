// ページの移り変わり(試作): いまある粒を、組み直す。
//
// ページを、丸いガウシアンの粒の集まりとして扱う。密に並んで元の大きさなら絵になり、縮むと点群になる。
// 押した場所から、いまのページの粒が縮んで点群になる。
// 次のページが分かったら、**同じ粒**が、次のページの絵を作る場所へ移り、元の大きさに戻って、絵になる。
// 粒は、自分の色に近い場所へ行く(明るい粒は明るい所へ、色のある粒は色のある所へ)。色は、着くまでに少しだけ合わせる。
// 視点は動かさない。次のページを別に用意して近づく、という作りはやめた。
//
// 呼ぶのは band.ts。いまは /lab/morph-sharp/ から出るときだけ使う。
// 確認用: window.__gs = { keep(), still(t1, t2, x, y), at(ms), clear() }

const CELL = 3; // 粒の間隔(px)
const T_LOOSE = 360; // 点群にほどけるまで(ms)
const T_BUILD = 900; // 組み直して、次のページになるまで(ms)
const SNAP = 0.5; // ページを写し取るときの縮尺

const VS = `#version 300 es
precision highp float;
layout(location=0) in vec2 aQ;
layout(location=1) in vec3 aI; // いまのページでの場所(px)、乱数
layout(location=2) in vec2 aT; // 次のページでの場所(px)
uniform vec2 uView, uO;
uniform float uT1, uT2, uTime, uReach, uCell, uLod0, uD;
uniform vec3 uBgA, uBgB;
uniform sampler2D uA, uB;
out vec2 vQ; out vec4 vCol;
float h(float n){ return fract(sin(n * 127.1) * 43758.5453); }
void main(){
  vec2 p0 = aI.xy; float sd = aI.z;
  // 押した場所から波が通って、点群にほどける。
  float d = length(p0 - uO) / uReach;
  float L = smoothstep(d * 0.62, d * 0.62 + 0.38, uT1);
  // 組み直し: 粒ごとに出発がずれる(押した場所に近い粒から)。行きは加速し、着く前に減速する。
  float st = 0.3 * h(sd + 3.0) + 0.22 * d;
  float u = clamp((uT2 - st) / 0.48, 0.0, 1.0);
  u = u * u * (3.0 - 2.0 * u);
  vec3 cA = textureLod(uA, p0 / uView, uLod0).rgb;
  vec3 cB = textureLod(uB, aT / uView, uLod0).rgb;
  // 地の色のままの粒(前でも後でも見えない粒)は描かない。
  float vis = smoothstep(0.03, 0.09, max(distance(cA, uBgA), distance(cB, uBgB)));
  float a = smoothstep(0.0, 0.06, L) * vis;
  if (a < 0.004) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vQ = vec2(0.0); vCol = vec4(0.0); return; }
  // 点でいるあいだは、その場で小さく揺れている(止まらない)。
  float loose = L * (1.0 - u);
  vec2 jit = vec2(sin(uTime * 2.3 + sd * 40.0), cos(uTime * 1.9 + sd * 31.0)) * uCell * 1.4 * loose;
  // 行き先へ。まっすぐではなく、粒ごとに少しふくらんだ弧で。
  vec2 dv = aT - p0;
  vec2 pos = mix(p0, aT, u) + vec2(-dv.y, dv.x) * sin(3.14159 * u) * (h(sd + 4.0) - 0.5) * 0.5 + jit;
  // 動いているあいだ、面から少し浮く(手前に来た粒は、大きく見える)。
  float lift = sin(3.14159 * u) * (0.06 + 0.26 * h(sd + 5.0)) * uD;
  float s = uD / (uD - lift);
  vec2 p = uView * 0.5 + (pos - uView * 0.5) * s;
  // 粒は丸いまま。点の大きさに縮み、着いたら元の大きさ(となりと重なって絵になる)に戻る。
  float pt = L * (1.0 - smoothstep(0.8, 1.0, u));
  float sig = max(min(uCell * mix(0.56, 0.34, pt) * s, 3.6), 0.62);
  vQ = aQ * 2.6;
  vec2 q = p + vQ * sig;
  gl_Position = vec4(q.x / uView.x * 2.0 - 1.0, 1.0 - q.y / uView.y * 2.0, 0.0, 1.0);
  // 色は、運んできた色から、着く場所の色へ。
  vCol = vec4(mix(cA, cB, smoothstep(0.35, 0.95, u)), a);
}`;

const FS = `#version 300 es
precision highp float;
in vec2 vQ; in vec4 vCol;
out vec4 o;
void main(){
  // ガウシアンの山。四角の縁でちょうど 0 になるように引く。
  float g = (exp(-0.5 * dot(vQ, vQ)) - 0.034) / 0.966;
  float a = clamp(g, 0.0, 1.0) * vCol.a;
  o = vec4(vCol.rgb * a, a);
}`;

// いちばん下の層: ページの地の色の面(点のすき間から、下のページが見えないようにする)。
const BVS = `#version 300 es
layout(location=0) in vec2 aQ;
out vec2 vP;
void main(){ vP = aQ * 0.5 + 0.5; gl_Position = vec4(aQ, 0.0, 1.0); }`;
const BFS = `#version 300 es
precision highp float;
uniform vec2 uView, uO;
uniform float uT1, uT2, uReach;
uniform vec3 uBgA, uBgB;
in vec2 vP;
out vec4 o;
void main(){
  vec2 uv = vec2(vP.x, 1.0 - vP.y);
  float d = length(uv * uView - uO) / uReach * 0.62;
  float a = smoothstep(0.0, 0.1, smoothstep(d, d + 0.38, uT1));
  vec3 c = mix(uBgA, uBgB, smoothstep(0.2, 0.8, uT2));
  o = vec4(c * a, a);
}`;

interface GL {
  cv: HTMLCanvasElement;
  gl: WebGL2RenderingContext;
  prog: WebGLProgram;
  back: WebGLProgram;
  u: Record<string, WebGLUniformLocation | null>;
  bu: Record<string, WebGLUniformLocation | null>;
  texA: WebGLTexture;
  texB: WebGLTexture;
  vao: WebGLVertexArrayObject;
  inst: WebGLBuffer;
  targ: WebGLBuffer;
  n: number;
  w: number;
  h: number;
  cols: number;
  rows: number;
}
type Shot = { c: HTMLCanvasElement; bg: number[] };

let G: GL | null = null;
let bgA = [0, 0, 0], bgB = [0, 0, 0]; // 前のページと次のページの、地の色
let wrap: HTMLElement | null = null;
let raf = 0;
let safety = 0;
// t1: 点群にほどける波 / t2: 組み直しの進み / tm: 確認用の時刻(-1 なら実時間)
const S = { t1: 0, t2: 0, x: 0, y: 0, t0: 0, tm: -1 };

const ease = (x: number) => (x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2);

function build(): GL | null {
  const cv = document.createElement('canvas');
  const gl = cv.getContext('webgl2', { antialias: false, alpha: true, depth: false, premultipliedAlpha: true });
  if (!gl) return null;
  const mk = (vs: string, fs: string) => {
    const p = gl.createProgram()!;
    for (const [t, src] of [
      [gl.VERTEX_SHADER, vs],
      [gl.FRAGMENT_SHADER, fs],
    ] as const) {
      const s = gl.createShader(t)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) console.error('[gsplat]', gl.getShaderInfoLog(s));
      gl.attachShader(p, s);
    }
    gl.linkProgram(p);
    return p;
  };
  const prog = mk(VS, FS);
  const back = mk(BVS, BFS);
  const U = (p: WebGLProgram, names: string[]) => Object.fromEntries(names.map((n) => [n, gl.getUniformLocation(p, n)]));
  const names = ['uView', 'uO', 'uT1', 'uT2', 'uTime', 'uReach', 'uCell', 'uLod0', 'uD', 'uA', 'uB', 'uBgA', 'uBgB'];
  const vao = gl.createVertexArray()!;
  gl.bindVertexArray(vao);
  const quad = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  const inst = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, inst);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);
  gl.vertexAttribDivisor(1, 1);
  const targ = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, targ);
  gl.enableVertexAttribArray(2);
  gl.vertexAttribPointer(2, 2, gl.FLOAT, false, 0, 0);
  gl.vertexAttribDivisor(2, 1);
  const tex = () => {
    const t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  };
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  return { cv, gl, prog, back, u: U(prog, names), bu: U(back, names), texA: tex(), texB: tex(), vao, inst, targ, n: 0, w: 0, h: 0, cols: 0, rows: 0 };
}

/** 画面の大きさに合わせて、粒を並べ直す。 */
function layout(g: GL) {
  const w = window.innerWidth, h = window.innerHeight;
  if (g.w === w && g.h === h) return;
  g.w = w;
  g.h = h;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  g.cv.width = Math.round(w * dpr);
  g.cv.height = Math.round(h * dpr);
  g.cols = Math.ceil(w / CELL);
  g.rows = Math.ceil(h / CELL);
  g.n = g.cols * g.rows;
  const a = new Float32Array(g.n * 3);
  for (let i = 0; i < g.n; i++) {
    a[i * 3] = ((i % g.cols) + 0.5) * CELL;
    a[i * 3 + 1] = (Math.floor(i / g.cols) + 0.5) * CELL;
    a[i * 3 + 2] = ((i + 1) * 0.61803) % 1;
  }
  g.gl.bindBuffer(g.gl.ARRAY_BUFFER, g.inst);
  g.gl.bufferData(g.gl.ARRAY_BUFFER, a, g.gl.STATIC_DRAW);
}

/**
 * 粒の並び順を作る: 明るさと色みの近いもの同士をまとめ、その中では場所の近い順に並べる。
 * 前のページと次のページを同じ決まりで並べ、同じ番目どうしを組にすると、
 * 明るい粒は明るい所へ、色のある粒は色のある所へ行く。
 */
function order(g: GL, c: HTMLCanvasElement): Uint32Array {
  const t = document.createElement('canvas');
  t.width = g.cols;
  t.height = g.rows;
  const x = t.getContext('2d', { willReadFrequently: true })!;
  x.drawImage(c, 0, 0, g.cols, g.rows);
  const d = x.getImageData(0, 0, g.cols, g.rows).data;
  const key = new Float64Array(g.n);
  const spread = (v: number) => {
    v &= 0x3ff;
    v = (v | (v << 8)) & 0x00ff00ff;
    v = (v | (v << 4)) & 0x0f0f0f0f;
    v = (v | (v << 2)) & 0x33333333;
    return (v | (v << 1)) & 0x55555555;
  };
  for (let i = 0; i < g.n; i++) {
    const r = d[i * 4], gg = d[i * 4 + 1], b = d[i * 4 + 2];
    const lum = (r * 77 + gg * 150 + b * 29) >> 12; // 0..15
    const sat = Math.min(3, (Math.max(r, gg, b) - Math.min(r, gg, b)) >> 5); // 0..3
    key[i] = (lum * 4 + sat) * 2097152 + (spread(i % g.cols) | (spread(Math.floor(i / g.cols)) << 1));
  }
  const idx = new Uint32Array(g.n);
  for (let i = 0; i < g.n; i++) idx[i] = i;
  return idx.sort((p, q) => key[p] - key[q]);
}

/** 粒ごとの行き先を決めて渡す。b が無ければ、行き先は今の場所(動かない)。 */
function setTargets(g: GL, a: HTMLCanvasElement, b: HTMLCanvasElement | null) {
  const t = new Float32Array(g.n * 2);
  const at = (i: number, j: number) => {
    t[i * 2] = ((j % g.cols) + 0.5) * CELL;
    t[i * 2 + 1] = (Math.floor(j / g.cols) + 0.5) * CELL;
  };
  if (b) {
    const oa = order(g, a), ob = order(g, b);
    for (let k = 0; k < g.n; k++) at(oa[k], ob[k]);
  } else for (let i = 0; i < g.n; i++) at(i, i);
  g.gl.bindBuffer(g.gl.ARRAY_BUFFER, g.targ);
  g.gl.bufferData(g.gl.ARRAY_BUFFER, t, g.gl.DYNAMIC_DRAW);
}

function upload(g: GL, tex: WebGLTexture, src: HTMLCanvasElement) {
  const gl = g.gl;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  try {
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
  } catch {
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));
  }
  gl.generateMipmap(gl.TEXTURE_2D);
}

function draw(g: GL) {
  const gl = g.gl;
  gl.viewport(0, 0, g.cv.width, g.cv.height);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.bindVertexArray(g.vao);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, g.texA);
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, g.texB);
  const reach = Math.max(Math.hypot(S.x, S.y), Math.hypot(g.w - S.x, S.y), Math.hypot(S.x, g.h - S.y), Math.hypot(g.w - S.x, g.h - S.y));
  const set = (p: WebGLProgram, u: Record<string, WebGLUniformLocation | null>) => {
    gl.useProgram(p);
    gl.uniform2f(u.uView, g.w, g.h);
    gl.uniform2f(u.uO, S.x, S.y);
    gl.uniform1f(u.uT1, S.t1);
    gl.uniform1f(u.uT2, S.t2);
    gl.uniform1f(u.uTime, S.tm >= 0 ? S.tm : (performance.now() - S.t0) / 1000);
    gl.uniform1f(u.uReach, reach);
    gl.uniform1f(u.uCell, CELL);
    gl.uniform1f(u.uLod0, Math.max(0, Math.log2(CELL * SNAP)));
    gl.uniform1f(u.uD, g.h * 1.2);
    gl.uniform3fv(u.uBgA, bgA);
    gl.uniform3fv(u.uBgB, bgB);
    gl.uniform1i(u.uA, 0);
    gl.uniform1i(u.uB, 1);
  };
  set(g.back, g.bu);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  set(g.prog, g.u);
  gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, g.n);
}

// ---------- ページを、色の地図として写し取る

// 読み上げ用に、見えないよう切り抜いてある要素(とその中身)は写さない。
const clipped = new WeakMap<Element, boolean>();
function isClipped(el: Element | null): boolean {
  if (!el || el === document.body) return false;
  const c = clipped.get(el);
  if (c !== undefined) return c;
  const cs = getComputedStyle(el);
  const r = /inset\(50%/.test(cs.clipPath) || (cs.clip !== 'auto' && cs.clip !== '') || el.classList.contains('astro-route-announcer') || isClipped(el.parentElement);
  clipped.set(el, r);
  return r;
}
const seen = (el: Element) => {
  if (isClipped(el)) return false;
  const cv = (el as HTMLElement & { checkVisibility?: (o: object) => boolean }).checkVisibility;
  return cv ? cv.call(el, { opacityProperty: true, visibilityProperty: true }) : true;
};
const solid = (c: string) => !!c && c !== 'transparent' && !/rgba\([^)]*,\s*0\)$/.test(c);

/** WebGL のキャンバスは、描いた直後でないと写せない。描き終わりを待って受け取る。 */
function morphCanvas(): Promise<HTMLCanvasElement | null> {
  const hook = (window as unknown as { __morphShot?: (fn: (cv: HTMLCanvasElement) => void) => void }).__morphShot;
  if (!hook) return Promise.resolve(null);
  const wait = (window as unknown as { __gsWait?: number }).__gsWait ?? 160;
  return new Promise((res) => {
    const copy = document.createElement('canvas');
    const t = window.setTimeout(() => res(null), wait);
    hook((cv) => {
      window.clearTimeout(t);
      copy.width = Math.max(1, Math.round(cv.clientWidth * SNAP));
      copy.height = Math.max(1, Math.round(cv.clientHeight * SNAP));
      copy.getContext('2d')!.drawImage(cv, 0, 0, copy.width, copy.height);
      res(copy);
    });
  });
}

async function snap(): Promise<{ c: HTMLCanvasElement; bg: number[] }> {
  const w = window.innerWidth, h = window.innerHeight;
  const c = document.createElement('canvas');
  c.width = Math.ceil(w * SNAP);
  c.height = Math.ceil(h * SNAP);
  const g = c.getContext('2d')!;
  g.scale(SNAP, SNAP);
  const bodyBg = getComputedStyle(document.body).backgroundColor;
  const htmlBg = getComputedStyle(document.documentElement).backgroundColor;
  g.fillStyle = solid(bodyBg) ? bodyBg : solid(htmlBg) ? htmlBg : '#000';
  g.fillRect(0, 0, w, h);
  const px = g.getImageData(0, 0, 1, 1).data;
  const bg = [px[0] / 255, px[1] / 255, px[2] / 255];
  const live = document.querySelector<HTMLCanvasElement>('[data-morph-root] canvas[data-canvas]');
  const liveCopy = live ? await morphCanvas() : null;
  // ページに入るときの動き(下から上がってくる見出しなど)の途中で写すと、着いたときに二重に見える。
  // 写すあいだだけ、動き終わった位置に置いて測り、すぐ元に戻す(画面には出ない)。
  const rv = [...document.querySelectorAll<HTMLElement>('[data-reveal]')];
  const rvKeep = rv.map((el) => [el.style.transform, el.style.opacity, el.style.visibility]);
  for (const el of rv) {
    el.style.transform = 'none';
    el.style.opacity = '1';
    el.style.visibility = 'visible';
  }
  const inView = (r: DOMRect) => r.width >= 1 && r.height >= 1 && r.bottom > 0 && r.top < h && r.right > 0 && r.left < w;
  for (const el of document.body.querySelectorAll<HTMLElement>('*')) {
    if (el.closest('.band-wipe, .site-bar')) continue; // 上のメニューは粒にしない(その場に残す)
    const r = el.getBoundingClientRect();
    if (!inView(r) || !seen(el)) continue;
    const cs = getComputedStyle(el);
    if (solid(cs.backgroundColor)) {
      g.fillStyle = cs.backgroundColor;
      g.fillRect(r.left, r.top, r.width, r.height);
    }
    try {
      if (el instanceof HTMLImageElement && el.complete && el.naturalWidth) {
        // object-fit: cover のときは、同じ切り取りで描く。
        let sx = 0, sy = 0, sw = el.naturalWidth, sh = el.naturalHeight;
        if (cs.objectFit === 'cover') {
          const k = Math.max(r.width / sw, r.height / sh);
          const vw = r.width / k, vh = r.height / k;
          sx = (sw - vw) / 2;
          sy = (sh - vh) / 2;
          sw = vw;
          sh = vh;
        }
        g.drawImage(el, sx, sy, sw, sh, r.left, r.top, r.width, r.height);
      } else if (el instanceof HTMLCanvasElement) {
        if (el === live) {
          if (liveCopy) g.drawImage(liveCopy, r.left, r.top, r.width, r.height);
        } else g.drawImage(el, r.left, r.top, r.width, r.height);
      } else if (el instanceof HTMLVideoElement && el.readyState >= 2) {
        g.drawImage(el, r.left, r.top, r.width, r.height);
      }
    } catch {
      /* 写せない要素は飛ばす */
    }
  }
  // 文字。1行なら文字として、複数行なら行の帯として置く(粒の細かさでは、ほぼ同じに見える)。
  const tw = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  for (let n = tw.nextNode(); n; n = tw.nextNode()) {
    const txt = (n.textContent || '').trim();
    const el = n.parentElement;
    if (!txt || !el || el.closest('.band-wipe, .site-bar, script, style, noscript') || !seen(el)) continue;
    range.selectNodeContents(n);
    const rects = [...range.getClientRects()].filter(inView);
    if (!rects.length) continue;
    const cs = getComputedStyle(el);
    g.fillStyle = cs.color;
    const fs = parseFloat(cs.fontSize) || 14;
    const up = cs.textTransform === 'uppercase';
    const raw = n.textContent || '';
    g.font = `${cs.fontStyle} ${cs.fontWeight} ${fs}px ${cs.fontFamily}`;
    (g as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = cs.letterSpacing === 'normal' ? '0px' : cs.letterSpacing;
    g.textBaseline = 'alphabetic';
    // 行の箱の中での、文字の基準線の位置(書体の上端・下端から求める)。
    const mt = g.measureText('Mg') as TextMetrics & { fontBoundingBoxAscent?: number; fontBoundingBoxDescent?: number };
    const asc = mt.fontBoundingBoxAscent ?? fs * 0.8, dsc = mt.fontBoundingBoxDescent ?? fs * 0.2;
    const base = (top: number, hh: number) => top + (hh - (asc + dsc)) / 2 + asc;
    if (rects.length === 1) {
      const r = rects[0];
      g.fillText(up ? txt.toUpperCase() : txt, r.left, base(r.top, r.height));
    } else if (raw.length <= 700) {
      // 複数行: 1文字ずつ位置を見て、行に分ける。
      let line = '', lx = 0, ly = -1e9, lh = 0;
      const flush = () => {
        if (line.trim()) g.fillText(up ? line.toUpperCase() : line, lx, base(ly, lh));
        line = '';
      };
      for (let i = 0; i < raw.length; i++) {
        range.setStart(n, i);
        range.setEnd(n, i + 1);
        const r = range.getBoundingClientRect();
        if (!r.width && !r.height) continue;
        if (Math.abs(r.top - ly) > r.height * 0.5) {
          flush();
          lx = r.left;
          ly = r.top;
          lh = r.height;
        }
        line += raw[i];
      }
      flush();
    } else {
      g.globalAlpha = 0.35;
      for (const r of rects) g.fillRect(r.left, r.top + r.height * 0.35, r.width, r.height * 0.3);
      g.globalAlpha = 1;
    }
  }
  rv.forEach((el, i) => {
    [el.style.transform, el.style.opacity, el.style.visibility] = rvKeep[i];
  });
  return { c, bg };
}

// ---------- 動き

function mount(g: GL) {
  if (!wrap) {
    wrap = document.createElement('div');
    wrap.className = 'band-wipe gs-wipe'; // 位置と重なり順は、帯の面と同じ決まりを使う
    wrap.setAttribute('aria-hidden', 'true');
    g.cv.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block';
    wrap.appendChild(g.cv);
  }
  wrap.getAnimations().forEach((a) => a.cancel());
  if (!wrap.isConnected) document.documentElement.appendChild(wrap);
  document.documentElement.classList.add('band-wiping', 'gs-on');
}

function clear() {
  cancelAnimationFrame(raf);
  window.clearTimeout(safety);
  wrap?.remove();
  document.documentElement.classList.remove('band-wiping', 'gs-on');
}

function run(dur: number, step: (x: number) => void): Promise<void> {
  return new Promise((res) => {
    const a = performance.now();
    const f = () => {
      const x = Math.min(1, (performance.now() - a) / dur);
      step(x);
      if (G) draw(G);
      if (x < 1) raf = requestAnimationFrame(f);
      else res();
    };
    cancelAnimationFrame(raf);
    f();
  });
}

/** 次のページを待つあいだも、点はその場で揺れている。 */
function idle() {
  const f = () => {
    if (G) draw(G);
    raf = requestAnimationFrame(f);
  };
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(f);
}

let shotA: Shot | null = null;

/** いまのページが、(x, y) から点群にほどける。 */
export async function loosen(x: number, y: number): Promise<boolean> {
  G ??= build();
  if (!G) return false;
  const g = G;
  layout(g);
  const a = await snap();
  shotA = a;
  upload(g, g.texA, a.c);
  upload(g, g.texB, a.c);
  setTargets(g, a.c, null);
  bgA = bgB = a.bg;
  Object.assign(S, { t1: 0, t2: 0, x, y, t0: performance.now(), tm: -1 });
  mount(g);
  safety = window.setTimeout(clear, 6000); // 何かあっても、覆ったままにはしない
  await run(T_LOOSE, (p) => (S.t1 = ease(p)));
  idle();
  return true;
}

/** 同じ粒が、次のページの絵を作る場所へ移り、元の大きさに戻って、次のページになる。 */
export async function tighten() {
  const g = G;
  if (!g || !wrap || !shotA) return;
  mount(g); // ページが替わると <html> の class が置き換わる。付け直す
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  // 画面内の画像が出そろうのを、少しだけ待つ。
  const h = window.innerHeight;
  const imgs = [...document.images].filter((i) => {
    const r = i.getBoundingClientRect();
    return r.bottom > 0 && r.top < h && !i.complete;
  });
  await Promise.race([Promise.all(imgs.map((i) => i.decode().catch(() => undefined))), new Promise((r) => setTimeout(r, 350))]);
  const b = await snap();
  upload(g, g.texB, b.c);
  setTargets(g, shotA.c, b.c);
  bgB = b.bg;
  await run(T_BUILD, (p) => (S.t2 = p));
  // 粒の絵から、本物のページへ。
  await wrap.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 110, fill: 'forwards' }).finished.catch(() => undefined);
  clear();
}

// ---------- 確認用
if (typeof window !== 'undefined') {
  let kept: Shot | null = null;
  (window as unknown as Record<string, unknown>).__gs = {
    /** いまのページを「前のページ」として覚える。 */
    async keep() {
      kept = await snap();
    },
    /** 途中の1コマを止めて出す(t1: ほどけ、t2: 組み直し)。 */
    async still(t1: number, t2: number, x = window.innerWidth * 0.7, y = 40) {
      G ??= build();
      if (!G) return false;
      layout(G);
      const b = await snap();
      const a = kept ?? b;
      upload(G, G.texA, a.c);
      upload(G, G.texB, b.c);
      setTargets(G, a.c, b.c);
      bgA = a.bg;
      bgB = b.bg;
      Object.assign(S, { t1, t2, x, y, t0: performance.now() - 900, tm: -1 });
      mount(G);
      cancelAnimationFrame(raf);
      draw(G);
      return true;
    },
    /** 動きの ms ミリ秒目の1コマ(待ち時間なしで通したとき)。先に still() を1回呼んでおく。 */
    at(ms: number) {
      if (!G) return false;
      Object.assign(S, { tm: ms / 1000, t1: ms < T_LOOSE ? ease(ms / T_LOOSE) : 1, t2: ms < T_LOOSE ? 0 : Math.min(1, (ms - T_LOOSE) / T_BUILD) });
      draw(G);
      return true;
    },
    clear,
  };
}
