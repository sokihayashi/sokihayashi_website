// ページの移り変わり(試作): ガウシアン。
//
// いまのページが、押した場所から、ぼやけた半透明の楕円の粒にほどける。
// 粒は細かい段から粗い段へ移り(同じ絵を、小さく密な粒でも、大きく疎らな粒でも表せる)、
// 流れの向きに伸びて、色を次のページのものに替え、細かい段へ戻って、次のページに締まる。
// 白い面で覆わない。
//
// 呼ぶのは band.ts。いまは /lab/morph-sharp/ から出るときだけ使う。
// 確認用: window.__gs = { keep(), still(t1, t2, mix, x, y), clear() }

const CELL = 4; // いちばん細かい粒の間隔(px)
const LV = 5; // 段の数(0 = 細かい、4 = 粗い)
const T_LOOSE = 440; // ほどけるまで(ms)
const T_MIX = 220; // 色が替わるまで(ms)
const T_TIGHT = 560; // 締まるまで(ms)
const SNAP = 0.5; // ページを写し取るときの縮尺

const VS = `#version 300 es
precision highp float;
layout(location=0) in vec2 aQ;
layout(location=1) in vec4 aI; // 粒の中心(px)、段、乱数
uniform vec2 uView, uO;
uniform float uT1, uT2, uMix, uTime, uReach, uCell, uLod0, uDpr;
uniform sampler2D uA, uB;
out vec2 vQ; out vec4 vCol;
float h(float n){ return fract(sin(n * 127.1) * 43758.5453); }
void main(){
  vec2 p0 = aI.xy; float k = aI.z, sd = aI.w;
  // 押した場所から、波が2回通る。1回目でほどけ、2回目で締まる。
  float d = length(p0 - uO) / uReach * 0.62;
  float s1 = smoothstep(d, d + 0.38, uT1);
  float s2 = smoothstep(d, d + 0.38, uT2);
  float L = s1 * (1.0 - s2);
  // ほどけるほど、細かい粒は間引かれ、粗い粒が入ってくる。そろえない: 大きい粒と小さい粒が、同時に居る。
  float f1 = k < 0.5 ? 0.05 : k < 1.5 ? 0.12 : k < 2.5 ? 0.28 : k < 3.5 ? 0.55 : 0.9;
  float f = k < 0.5 ? mix(1.0, f1, smoothstep(0.04, 0.7, L)) : f1 * smoothstep(0.0, 0.22 + 0.14 * k, L);
  float rr = h(sd + 6.0);
  float a = smoothstep(rr - 0.06, rr + 0.06, f * 1.12) * smoothstep(0.0, 0.06, L) * mix(1.0, 0.72 + 0.26 * h(sd + 7.0), L);
  if (a < 0.004) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vQ = vec2(0.0); vCol = vec4(0.0); return; }
  float sig = uCell * exp2(k) * mix(0.56, 0.4, L);
  // 流れの向き: 押した場所のまわりを巻く。場所と時間でゆっくり揺れる。
  vec2 r = p0 - uO;
  float th = atan(r.y, r.x) + 1.15 + 0.9 * sin(p0.x * 0.006 + p0.y * 0.004 + uTime * 0.5) + (h(sd + 2.0) - 0.5) * 0.9 * L;
  vec2 dir = vec2(cos(th), sin(th)), perp = vec2(-dir.y, dir.x);
  // 奥行き: 粒ごとに手前と奥に分かれる。手前の粒は大きく、押した場所から外へ速く動く。
  float z = 1.0 + L * (h(sd + 8.0) - 0.4) * 0.6;
  // 向きを持った楕円: 流れに沿って長く伸び、幅は痩せる。
  float along = sig * (1.0 + 2.0 * L * (0.3 + h(sd + 1.0))) * z;
  float across = sig * (1.0 - 0.3 * L) * z;
  // 流れに運ばれる。粗い粒ほど遠くへ。ほどけているあいだも、ゆっくり動き続ける。
  float go = L * uCell * exp2(k) * (1.1 * (h(sd + 3.0) - 0.3) + 0.45 * sin(uTime * 1.1 + sd * 6.283));
  vec2 p = uO + (p0 - uO) * z + dir * go + perp * L * sig * 1.2 * (h(sd + 4.0) - 0.5);
  vQ = aQ * 2.6;
  vec2 q = p + dir * vQ.x * along + perp * vQ.y * across;
  gl_Position = vec4(q.x / uView.x * 2.0 - 1.0, 1.0 - q.y / uView.y * 2.0, 0.0, 1.0);
  // 色は、粒の元の場所の色。粒の大きさより細かく拾う(となりの粒と色が混ざって、ただのぼかしにならないように)。
  vec2 uv = p0 / uView;
  float lod = max(0.0, uLod0 + k - 2.0 * L);
  float mh = h(sd + 5.0) * 0.5;
  float m = smoothstep(mh, mh + 0.5, uMix);
  vec3 c = mix(textureLod(uA, uv, lod).rgb, textureLod(uB, uv, lod).rgb, m);
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

// いちばん下の層: ページの地の色の面(粒のすき間から、下のページが見えないようにする。ぼけた絵は敷かない)。
const BVS = `#version 300 es
layout(location=0) in vec2 aQ;
out vec2 vP;
void main(){ vP = aQ * 0.5 + 0.5; gl_Position = vec4(aQ, 0.0, 1.0); }`;
const BFS = `#version 300 es
precision highp float;
uniform vec2 uView, uO;
uniform float uT1, uT2, uMix, uReach;
uniform vec3 uBgA, uBgB;
in vec2 vP;
out vec4 o;
void main(){
  vec2 uv = vec2(vP.x, 1.0 - vP.y);
  float d = length(uv * uView - uO) / uReach * 0.62;
  float L = smoothstep(d, d + 0.38, uT1) * (1.0 - smoothstep(d, d + 0.38, uT2));
  float a = smoothstep(0.0, 0.1, L);
  vec3 c = mix(uBgA, uBgB, smoothstep(0.2, 0.8, uMix));
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
}

let G: GL | null = null;
let bgA = [0, 0, 0], bgB = [0, 0, 0]; // 前のページと次のページの、地の色
let wrap: HTMLElement | null = null;
let raf = 0;
let safety = 0;
const S = { t1: 0, t2: 0, mix: 0, x: 0, y: 0, t0: 0 };

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
  const names = ['uView', 'uO', 'uT1', 'uT2', 'uMix', 'uTime', 'uReach', 'uCell', 'uLod0', 'uDpr', 'uA', 'uB', 'uBgA', 'uBgB'];
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
  gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 0, 0);
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
  return { cv, gl, prog, back, u: U(prog, names), bu: U(back, names), texA: tex(), texB: tex(), vao, inst, n: 0, w: 0, h: 0 };
}

/** 画面の大きさに合わせて、粒を並べ直す。粗い段から先に描く(細かい段が上に乗る)。 */
function layout(g: GL) {
  const w = window.innerWidth, h = window.innerHeight;
  if (g.w === w && g.h === h) return;
  g.w = w;
  g.h = h;
  const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
  g.cv.width = Math.round(w * dpr);
  g.cv.height = Math.round(h * dpr);
  const a: number[] = [];
  let seed = 1;
  for (let k = LV - 1; k >= 0; k--) {
    const step = CELL * 2 ** k;
    for (let y = 0; y < h + step; y += step) {
      for (let x = 0; x < w + step; x += step) {
        a.push(x + step / 2, y + step / 2, k, (seed++ * 0.61803) % 1);
      }
    }
  }
  g.n = a.length / 4;
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
  const set = (p: WebGLProgram, u: Record<string, WebGLUniformLocation | null>) => {
    gl.useProgram(p);
    gl.uniform2f(u.uView, g.w, g.h);
    gl.uniform2f(u.uO, S.x, S.y);
    gl.uniform1f(u.uT1, S.t1);
    gl.uniform1f(u.uT2, S.t2);
    gl.uniform1f(u.uMix, S.mix);
    gl.uniform1f(u.uTime, (performance.now() - S.t0) / 1000);
    gl.uniform1f(u.uReach, reach);
    gl.uniform1f(u.uCell, CELL);
    gl.uniform1f(u.uLod0, Math.log2(CELL * SNAP));
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

const seen = (el: Element) => {
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
    if (rects.length === 1) {
      const r = rects[0];
      const fs = parseFloat(cs.fontSize) || 14;
      g.font = `${cs.fontStyle} ${cs.fontWeight} ${fs}px ${cs.fontFamily}`;
      (g as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = cs.letterSpacing === 'normal' ? '0px' : cs.letterSpacing;
      g.textBaseline = 'alphabetic';
      const s = cs.textTransform === 'uppercase' ? txt.toUpperCase() : txt;
      g.fillText(s, r.left, r.top + r.height / 2 + fs * 0.35);
    } else {
      g.globalAlpha = 0.5;
      for (const r of rects) g.fillRect(r.left, r.top + r.height * 0.3, r.width, r.height * 0.4);
      g.globalAlpha = 1;
    }
  }
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

/** 止まっているあいだも、粒はゆっくり流れ続ける。 */
function idle() {
  const f = () => {
    if (G) draw(G);
    raf = requestAnimationFrame(f);
  };
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(f);
}

/** いまのページが、(x, y) から粒にほどける。ほどけきったら戻る。 */
export async function loosen(x: number, y: number): Promise<boolean> {
  G ??= build();
  if (!G) return false;
  const g = G;
  layout(g);
  const a = await snap();
  upload(g, g.texA, a.c);
  upload(g, g.texB, a.c);
  bgA = bgB = a.bg;
  Object.assign(S, { t1: 0, t2: 0, mix: 0, x, y, t0: performance.now() });
  mount(g);
  safety = window.setTimeout(clear, 6000); // 何かあっても、覆ったままにはしない
  await run(T_LOOSE, (p) => (S.t1 = ease(p)));
  idle();
  return true;
}

/** 次のページの色に替わり、同じ場所から締まって、次のページになる。 */
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
  await run(T_MIX + T_TIGHT, (p) => {
    const ms = p * (T_MIX + T_TIGHT);
    S.mix = Math.min(1, ms / T_MIX);
    S.t2 = ease(Math.max(0, (ms - T_MIX * 0.45) / (T_MIX * 0.55 + T_TIGHT)));
  });
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
    async still(t1: number, t2: number, mix: number, x = window.innerWidth * 0.7, y = 40) {
      G ??= build();
      if (!G) return false;
      layout(G);
      const b = await snap();
      upload(G, G.texA, (kept ?? b).c);
      upload(G, G.texB, b.c);
      bgA = (kept ?? b).bg;
      bgB = b.bg;
      Object.assign(S, { t1, t2, mix, x, y, t0: performance.now() - 900 });
      mount(G);
      cancelAnimationFrame(raf);
      draw(G);
      return true;
    },
    clear,
  };
}
