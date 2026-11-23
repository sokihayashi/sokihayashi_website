// ページの移り変わり(試作): ガウシアン・スプラッティングの考え方で。
//
// ページを「3D空間に浮かぶ、粒でできた面」として扱う。粒は、位置・大きさ・色・不透明度を持つ、丸いガウシアン。
// 密に並んで元の大きさなら絵になり、縮むと点群になる(伸ばさない。粒は点のまま)。
//
// 押した場所から、いまのページの粒が縮んで点群になり、明るさに応じて前後に厚みを持つ。
// 視点が、押した場所へ向かって奥へ進む。いまのページの点は、視点の横を通り過ぎる。
// 奥には、次のページが点群で浮いている。近づくと、点が面に集まり、元の大きさに戻って、絵になる。
//
// 呼ぶのは band.ts。いまは /lab/morph-sharp/ から出るときだけ使う。
// 確認用: window.__gs = { keep(), still(t1, cam, t2, bin, x, y), clear() }

const CELL = 3; // 粒の間隔(px)
const T_LOOSE = 400; // 点群にほどけるまで(ms)
const T_TIGHT = 760; // 奥へ進んで、次のページに締まるまで(ms)
const CAM0 = 0.2; // ほどけ終わったときの、視点の進み(0 = いまのページ、1 = 次のページ)
const SNAP = 0.5; // ページを写し取るときの縮尺

const VS = `#version 300 es
precision highp float;
layout(location=0) in vec2 aQ;
layout(location=1) in vec3 aI; // 粒の元の場所(px)、乱数
uniform vec2 uView, uO, uV, uOff;
uniform float uT1, uT2, uCam, uBin, uTime, uReach, uCell, uLod0, uLayer, uD, uZb, uDpr, uRoll;
uniform sampler2D uA, uB;
out vec2 vQ; out vec4 vCol;
float h(float n){ return fract(sin(n * 127.1) * 43758.5453); }
void main(){
  vec2 p0 = aI.xy; float sd = aI.z;
  bool isB = uLayer > 0.5;
  // 押した場所から波が通る。いまのページは波でほどけ、次のページは波で締まる。
  float d = length(p0 - uO) / uReach * 0.62;
  float L = isB ? 1.0 - smoothstep(d, d + 0.38, uT2) : smoothstep(d, d + 0.38, uT1);
  vec2 uv = p0 / uView;
  vec3 c = isB ? textureLod(uB, uv, uLod0).rgb : textureLod(uA, uv, uLod0).rgb;
  float lum = dot(c, vec3(0.299, 0.587, 0.114));
  // 奥行き: ほどけると、面が厚みを持つ。明るい所が手前。粒ごとに少し前後する。
  float zw = (isB ? uZb : 0.0) - ((lum - 0.5) * 0.26 + (h(sd + 1.0) - 0.5) * 0.045) * uD * L;
  // 点は、まっすぐ動かない。押した場所のまわりを巻き(点ごとに速さが違う)、見えない流れに揺られる。
  // いまのページは巻きながら出ていき、次のページは同じ回り方で巻き戻りながら、元の場所に着く。
  vec2 r0 = p0 - uO;
  float rr = length(r0) / uReach;
  float th = L * (0.55 + 0.9 * (h(sd + 2.0) - 0.5) + 0.35 * sin(rr * 5.0 - uTime * 1.4)) * (isB ? -1.0 : 1.0);
  vec2 pw = uO + mat2(cos(th), sin(th), -sin(th), cos(th)) * r0;
  vec3 flow = vec3(
    sin(p0.y * 0.011 + uTime * 1.9 + sd * 2.0) + 0.5 * sin(p0.x * 0.027 - uTime * 2.7),
    sin(p0.x * 0.013 - uTime * 1.6 + sd * 2.0) + 0.5 * sin(p0.y * 0.031 + uTime * 2.3),
    sin((p0.x + p0.y) * 0.009 + uTime * 1.3 + sd * 3.0));
  pw += flow.xy * 0.035 * uD * L;
  zw += flow.z * 0.05 * uD * L;
  float depth = uD + zw - uCam * uZb; // 視点からの距離
  float a = (isB ? uBin : smoothstep(0.0, 0.06, L)) * smoothstep(0.1, 0.38, depth / uD);
  if (depth < 0.08 * uD || a < 0.004) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vQ = vec2(0.0); vCol = vec4(0.0); return; }
  // 透視。視点は、まっすぐ奥へ進まない: 横へ弧を描いて回り込み(uOff)、傾き(uRoll)、向かう先(uV)も弧を描いて動く。
  // はじまりと終わりでは、ずれも傾きも 0 になり、ページはそのままの位置に重なる。
  float s = uD / depth;
  vec2 rel = pw - uV - uOff;
  rel = mat2(cos(uRoll), sin(uRoll), -sin(uRoll), cos(uRoll)) * rel;
  vec2 p = uV + rel * s;
  // 粒は丸いまま。元の大きさ(となりと重なって絵になる)から、点の大きさへ縮む。近づけば大きく見えるが、上限を置く。
  float sig = min(uCell * mix(0.56, 0.34, L) * s, 3.6);
  sig = max(sig, 0.62);
  vQ = aQ * 2.6;
  vec2 q = p + vQ * sig;
  gl_Position = vec4(q.x / uView.x * 2.0 - 1.0, 1.0 - q.y / uView.y * 2.0, 0.0, 1.0);
  vCol = vec4(c, a);
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
uniform float uT1, uT2, uCam, uReach;
uniform vec3 uBgA, uBgB;
in vec2 vP;
out vec4 o;
void main(){
  vec2 uv = vec2(vP.x, 1.0 - vP.y);
  float d = length(uv * uView - uO) / uReach * 0.62;
  float a = smoothstep(0.0, 0.1, smoothstep(d, d + 0.38, uT1));
  vec3 c = mix(uBgA, uBgB, smoothstep(0.3, 0.8, uCam));
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
  n: number;
  w: number;
  h: number;
  dpr: number;
}

let G: GL | null = null;
let bgA = [0, 0, 0], bgB = [0, 0, 0]; // 前のページと次のページの、地の色
let wrap: HTMLElement | null = null;
let raf = 0;
let safety = 0;
// t1: いまのページがほどける波 / cam: 視点の進み / t2: 次のページが締まる波 / bin: 次のページの現れ
const S = { t1: 0, cam: 0, t2: 0, bin: 0, x: 0, y: 0, t0: 0, tm: -1 };

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
  const names = ['uView', 'uO', 'uV', 'uOff', 'uRoll', 'uT1', 'uT2', 'uCam', 'uBin', 'uTime', 'uReach', 'uCell', 'uLod0', 'uLayer', 'uD', 'uZb', 'uDpr', 'uA', 'uB', 'uBgA', 'uBgB'];
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
  return { cv, gl, prog, back, u: U(prog, names), bu: U(back, names), texA: tex(), texB: tex(), vao, inst, n: 0, w: 0, h: 0, dpr: 1 };
}

/** 画面の大きさに合わせて、粒を並べ直す。 */
function layout(g: GL) {
  const w = window.innerWidth, h = window.innerHeight;
  if (g.w === w && g.h === h) return;
  g.w = w;
  g.h = h;
  g.dpr = Math.min(window.devicePixelRatio || 1, 2);
  g.cv.width = Math.round(w * g.dpr);
  g.cv.height = Math.round(h * g.dpr);
  const a: number[] = [];
  let seed = 1;
  for (let y = CELL / 2; y < h; y += CELL) {
    for (let x = CELL / 2; x < w; x += CELL) a.push(x, y, (seed++ * 0.61803) % 1);
  }
  g.n = a.length / 3;
  g.gl.bindBuffer(g.gl.ARRAY_BUFFER, g.inst);
  g.gl.bufferData(g.gl.ARRAY_BUFFER, new Float32Array(a), g.gl.STATIC_DRAW);
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
  const D = g.h * 1.2; // 視点から面までの距離
  // 視点の道すじ。向かう先は、押した場所から画面のまん中へ、弧を描いて移る。
  // 視点そのものは、横へふくらんで回り込み(ねじを巻くような道)、途中で傾く。進みが 0 と 1 では、どれも 0。
  const c = Math.min(1, Math.max(0, S.cam));
  const arc = Math.sin(Math.PI * c);
  const tx = g.w / 2 - S.x, ty = g.h * 0.45 - S.y;
  const tl = Math.hypot(tx, ty) || 1;
  const side = S.x > g.w / 2 ? 1 : -1; // 押した側と反対へふくらむ
  const vx = S.x + tx * c + (-ty / tl) * side * g.h * 0.16 * arc;
  const vy = S.y + ty * c + (tx / tl) * side * g.h * 0.16 * arc;
  const ph = Math.atan2(ty, tx) + side * (1.2 + 3.4 * c);
  const ox = Math.cos(ph) * D * 0.2 * arc, oy = Math.sin(ph) * D * 0.2 * arc;
  const roll = side * 0.5 * arc;
  const set = (p: WebGLProgram, u: Record<string, WebGLUniformLocation | null>) => {
    gl.useProgram(p);
    gl.uniform2f(u.uView, g.w, g.h);
    gl.uniform2f(u.uO, S.x, S.y);
    gl.uniform2f(u.uV, vx, vy);
    gl.uniform2f(u.uOff, ox, oy);
    gl.uniform1f(u.uRoll, roll);
    gl.uniform1f(u.uT1, S.t1);
    gl.uniform1f(u.uT2, S.t2);
    gl.uniform1f(u.uCam, S.cam);
    gl.uniform1f(u.uBin, S.bin);
    gl.uniform1f(u.uTime, S.tm >= 0 ? S.tm : (performance.now() - S.t0) / 1000);
    gl.uniform1f(u.uReach, reach);
    gl.uniform1f(u.uCell, CELL);
    gl.uniform1f(u.uLod0, Math.max(0, Math.log2(CELL * SNAP)));
    gl.uniform1f(u.uD, D);
    gl.uniform1f(u.uZb, D * 1.5); // 次のページは、この距離だけ奥にある
    gl.uniform1f(u.uDpr, g.dpr);
    gl.uniform3fv(u.uBgA, bgA);
    gl.uniform3fv(u.uBgB, bgB);
    gl.uniform1i(u.uA, 0);
    gl.uniform1i(u.uB, 1);
  };
  set(g.back, g.bu);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  set(g.prog, g.u);
  // 奥(次のページ)から先に描き、手前(いまのページ)を上に重ねる。
  gl.uniform1f(g.u.uLayer, 1);
  if (S.bin > 0.004) gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, g.n);
  gl.uniform1f(g.u.uLayer, 0);
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
    if (el.closest('.band-wipe')) continue;
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
    if (!txt || !el || el.closest('.band-wipe, script, style, noscript') || !seen(el)) continue;
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
  document.documentElement.classList.add('band-wiping');
}

function clear() {
  cancelAnimationFrame(raf);
  window.clearTimeout(safety);
  wrap?.remove();
  document.documentElement.classList.remove('band-wiping');
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

const phase1 = (p: number) => ({ t1: ease(p), cam: CAM0 * p * p });
const phase2 = (p: number, cam0: number) => ({
  bin: Math.min(1, p / 0.22),
  cam: cam0 + (1 - cam0) * ease(Math.min(1, p / 0.86)),
  t2: ease(Math.max(0, (p - 0.42) / 0.58)),
});

/** 次のページを待つあいだも、視点はゆっくり進み続ける(止まらない)。 */
function idle() {
  const a = performance.now();
  const f = () => {
    S.cam = CAM0 + 0.12 * (1 - Math.exp(-(performance.now() - a) / 900));
    if (G) draw(G);
    raf = requestAnimationFrame(f);
  };
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(f);
}

/** いまのページが、(x, y) から点群にほどけ、視点が奥へ進みはじめる。 */
export async function loosen(x: number, y: number): Promise<boolean> {
  G ??= build();
  if (!G) return false;
  const g = G;
  layout(g);
  const a = await snap();
  upload(g, g.texA, a.c);
  upload(g, g.texB, a.c);
  bgA = bgB = a.bg;
  Object.assign(S, { t1: 0, cam: 0, t2: 0, bin: 0, x, y, t0: performance.now(), tm: -1 });
  mount(g);
  safety = window.setTimeout(clear, 6000); // 何かあっても、覆ったままにはしない
  await run(T_LOOSE, (p) => Object.assign(S, phase1(p)));
  idle();
  return true;
}

/** 奥に次のページが点群で現れ、視点がそこまで進み、点が面に集まって、次のページになる。 */
export async function tighten() {
  const g = G;
  if (!g || !wrap) return;
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
  bgB = b.bg;
  const cam0 = S.cam;
  await run(T_TIGHT, (p) => Object.assign(S, phase2(p, cam0)));
  // 粒の絵から、本物のページへ。
  await wrap.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 110, fill: 'forwards' }).finished.catch(() => undefined);
  clear();
}

// ---------- 確認用
if (typeof window !== 'undefined') {
  let kept: { c: HTMLCanvasElement; bg: number[] } | null = null;
  (window as unknown as Record<string, unknown>).__gs = {
    /** いまのページを「前のページ」として覚える。 */
    async keep() {
      kept = await snap();
    },
    /** 途中の1コマを止めて出す。 */
    async still(t1: number, cam: number, t2: number, bin: number, x = window.innerWidth * 0.7, y = 40) {
      G ??= build();
      if (!G) return false;
      layout(G);
      const b = await snap();
      upload(G, G.texA, (kept ?? b).c);
      upload(G, G.texB, b.c);
      bgA = (kept ?? b).bg;
      bgB = b.bg;
      Object.assign(S, { t1, cam, t2, bin, x, y, t0: performance.now() - 900, tm: -1 });
      mount(G);
      cancelAnimationFrame(raf);
      draw(G);
      return true;
    },
    /** 動きの ms ミリ秒目の1コマ(待ち時間なしで通したとき)。先に still() を1回呼んでおく。 */
    at(ms: number) {
      if (!G) return false;
      Object.assign(S, { t1: 1, t2: 0, bin: 0, tm: ms / 1000 }, ms < T_LOOSE ? phase1(ms / T_LOOSE) : phase2(Math.min(1, (ms - T_LOOSE) / T_TIGHT), CAM0));
      draw(G);
      return true;
    },
    clear,
  };
}
