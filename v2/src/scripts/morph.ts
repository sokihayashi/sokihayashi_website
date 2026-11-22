// 試作: 同じ物質が、姿を変え続ける。
//
// 画面にあるのは、最初から最後まで同じ「小さな面」の集まり(約4万枚)。場面は切り替わらない。
// 面の並び方だけが変わっていく:
//   0 帯     … なぞった跡に並んで、平らな帯になる。帯の中に、作品の写真が順に見える(写真は まっすぐのまま、帯が窓になる)
//   1 立体   … 帯が ねじれて、奥行きを持つ。裏は紙の色
//   2 粒子   … 面が点に縮んで、帯のまわりに漂う。色は、もとの写真の色のまま
//   3 網点   … 点が画面全体の格子(28°)に並び、1枚の作品の写真を、点の大きさで描く
//   → 0 帯   … 点が、なぞった跡へ戻る
//
// 進めるのは時間ではなく、描いた長さ。手を止めると、その状態のまま漂う。
// 変わり目は、ペン先から帯の後ろへ向かって伝わる(1枚ずつ、決まった遅れで)。
// しばらく誰も触らないと、ペンがひとりでに描く(なので、放っておいても一周する)。
//
// 手札は 映像表現研究 から: 粒子列ロープ(尽きないように見える供給 = 輪になった記録)、UzU(根元から順に、遅れて)、
// Ringwriter(1枚ごとの決まった しきい値)、網点(段階の大きさで見せる)、Topographic(操作の音)。
//
// 確認用: window.__morph = { phase(v), auto(on) }

import { makeSfx } from './sfx';

const M = 640; // なぞった跡を覚えておく数(輪になっていて、古いものから上書きする)
const SEG = 32; // 作品1つぶんの長さ(跡の数)
const NV = 32; // 帯の幅方向の枚数
const NU = M * 2; // 帯の長さ方向の枚数
const TILES = NU * NV;
const HOLD = 0.42; // 1つの状態のうち、変わらずにいる割合
const SPREAD = 1.5; // 変わり目が、帯の後ろへ伝わるのにかかる長さ
const ACOLS = 6;
const AROWS = 5;
const CELL = 400;
const NAMES = ['Band', 'Solid', 'Particle', 'Halftone'];

const VS = `#version 300 es
precision highp float;
precision highp int;
layout(location=0) in vec2 aQ;
uniform sampler2D uPath;
uniform sampler2D uAtlas;
uniform vec2 uView;
uniform float uDp, uW, uTime, uPhase, uK, uTwK, uZK;
uniform vec2 uHalf;
uniform float uAsp[30];
uniform float uPitch, uCols, uCells, uStep;
uniform float uFocus, uFocusAsp;
uniform vec3 uPen;
out vec2 vQ; out vec2 vUV; out vec2 vCell; out float vRound; out float vFace; out float vShade;
out vec3 vDot; out float vDotW; out vec2 vRib; out float vLine;
const float Mf = ${M}.0;
const int NVi = ${NV};
const float HOLD = ${HOLD};
const float SP = ${SPREAD};
const vec3 PAPER = vec3(0.957, 0.945, 0.918);
float hsh(uint n){ n = (n << 13U) ^ n; n = n * (n * n * 15731U + 789221U) + 1376312589U; return float(n & 0x7fffffffU) / 2147483647.0; }
void main(){
  int i = gl_InstanceID;
  int iu = i / NVi; int iv = i - iu * NVi;
  int j = iu / 2; float fr = float(iu - j * 2) * 0.5 + 0.25;
  float v = (float(iv) + 0.5) / float(NVi) - 0.5;
  vec4 r0 = texelFetch(uPath, ivec2(j, 0), 0);
  vec4 r1 = texelFetch(uPath, ivec2(j, 1), 0);
  vec4 r2 = texelFetch(uPath, ivec2(j, 2), 0);
  float age = mod(uK - 1.0 - float(j), Mf);
  vec2 P = r0.xy; vec2 T = r0.zw;
  // まだ描かれていない面は、ペン先に しまってある。
  if (r1.w < 0.5) { P = uPen.xy; T = vec2(1.0, 0.0); }
  // 曲がり目で すき間が開かないように、となりの跡の向きへ少し寄せ、外側の面は長くする。
  float side = fr < 0.5 ? -1.0 : 1.0;
  int jn = int(mod(float(j) + side + Mf, Mf));
  vec4 n0 = texelFetch(uPath, ivec2(jn, 0), 0);
  float nok = texelFetch(uPath, ivec2(jn, 1), 0).w * r1.w * ((side > 0.0 && age < 0.5) || (side < 0.0 && age > Mf - 1.5) ? 0.0 : 1.0);
  nok *= step(distance(n0.xy, P), uDp * 1.6);
  vec2 Tn = mix(T, n0.zw, nok);
  float bend = abs(T.x * Tn.y - T.y * Tn.x);
  T = normalize(mix(T, Tn, 0.25) + vec2(1e-5, 0.0));
  vec2 N = vec2(-T.y, T.x);
  float hd = age / Mf;
  float h1 = hsh(uint(i)); float h2 = hsh(uint(i) + 7919U); float h3 = hsh(uint(i) * 3U + 17U);

  // この1枚が、いま どの状態と どの状態の間にいるか。
  float A = floor(uPhase); float f = uPhase - A;
  float x = clamp((f - HOLD) / (1.0 - HOLD), 0.0, 1.0);
  float w = clamp(x * (1.0 + SP) - SP * (0.72 * hd + 0.28 * h1), 0.0, 1.0);
  w = w * w * (3.0 - 2.0 * w);
  int a = int(mod(A, 4.0));
  vec4 wt = vec4(0.0);
  wt[a] = 1.0 - w; wt[(a + 1) % 4] += w;

  float sj = float(j) + fr;
  vec2 hx = T * (uHalf.x + abs(v) * uW * bend * 0.6); vec2 hy = N * uHalf.y;
  // 0 帯
  vec2 rib = P + T * (fr - 0.5) * uDp + N * v * uW;
  vec3 c0 = vec3(rib, 0.0);
  // 1 立体: 芯のまわりに ねじれる。芯そのものも、前後に ゆるく波うつ。
  float th = sj * uTwK + uTime * 0.45;
  float cs = cos(th); float sn = sin(th);
  float zc = sin(sj * uZK - uTime * 0.7) * uW * 0.75;
  vec3 c1 = vec3(P + T * (fr - 0.5) * uDp + N * v * uW * cs, zc + v * uW * sn);
  // 2 粒子: 帯のまわりに漂う。
  vec2 q = rib * 0.0045;
  vec2 off = vec2(sin(q.y * 1.7 + uTime * 0.6 + h1 * 6.283) + sin(q.x * 2.3 - uTime * 0.4 + h2 * 6.283),
                  cos(q.x * 1.9 + uTime * 0.5 + h2 * 6.283) + sin(q.y * 1.3 + uTime * 0.7 + h3 * 6.283));
  float amp = uW * (0.3 + 2.6 * h3 * h3);
  vec3 c2 = vec3(rib + off * amp, sin(q.x * 1.3 + q.y * 0.7 + uTime * 0.5 + h2 * 6.283) * uW * 1.7 * h3);
  float r2d = mix(1.0, 3.1, h2 * h2);
  // 3 網点: 画面全体の格子(28°)。1枚の作品を、点の大きさで描く。
  uint cell = (uint(i) * uint(uStep)) % uint(uCells);
  float cx = float(cell % uint(uCols)); float cy = float(cell / uint(uCols));
  vec2 lp = (vec2(cx, cy) + 0.5 - uCols * 0.5) * uPitch;
  const float c28 = 0.8829476; const float s28 = 0.4694716;
  vec2 g = vec2(lp.x * c28 - lp.y * s28, lp.x * s28 + lp.y * c28) + uView * 0.5;
  float fs = max(uView.x / uFocusAsp, uView.y);
  vec2 fuv = clamp(0.5 + (g - uView * 0.5) / (vec2(uFocusAsp, 1.0) * fs), vec2(0.004), vec2(0.996));
  vec2 fcell = vec2(mod(uFocus, ${ACOLS}.0), floor(uFocus / ${ACOLS}.0));
  vec3 fcol = textureLod(uAtlas, (fcell + fuv) / vec2(${ACOLS}.0, ${AROWS}.0), 0.0).rgb;
  float lum = dot(fcol, vec3(0.299, 0.587, 0.114));
  float lev = lum < 0.2 ? 0.13 : lum < 0.45 ? 0.38 : lum < 0.72 ? 0.66 : 0.95;
  lev *= 1.0 + 0.09 * sin(dot(lp, vec2(0.011, 0.007)) - uTime * 1.3);
  float lens = uPen.z * smoothstep(uW * 1.25, uW * 0.45, distance(g, uPen.xy));
  float r3 = uPitch * 0.5 * mix(lev, 1.0, lens);
  vec3 c3 = vec3(g, 0.0);

  vec3 c = c0 * wt.x + c1 * wt.y + c2 * wt.z + c3 * wt.w;
  vec3 e1 = vec3(hx, 0.0) * (wt.x + wt.y) + vec3(r2d, 0.0, 0.0) * wt.z + vec3(r3, 0.0, 0.0) * wt.w;
  vec3 e2 = vec3(hy, 0.0) * wt.x + vec3(hy * cs, uHalf.y * sn) * wt.y + vec3(0.0, r2d, 0.0) * wt.z + vec3(0.0, r3, 0.0) * wt.w;
  // 変わる途中は、まっすぐ飛ばずに、少し ふくらんで動く。
  float arc = a == 0 ? 0.0 : sin(3.14159 * w);
  c.xy += arc * (vec2(h2, h3) - 0.5) * uW * 1.1;
  c.z += arc * (h1 - 0.5) * uW * 1.4;

  // 出てくるところ(ペン先)と、巻き取られるところ(いちばん古い所)。
  float sc = r1.w * smoothstep(0.0, 0.16, uTime - r1.z) * smoothstep(Mf, Mf - 22.0, age);
  sc = mix(sc, 1.0, wt.w);
  vec3 wp = c + (e1 * aQ.x + e2 * aQ.y) * sc;
  const float F = 1100.0;
  vec2 ctr = uView * 0.5;
  vec2 sp = ctr + (wp.xy - ctr) * F / (F - wp.z);
  gl_Position = vec4(sp.x / uView.x * 2.0 - 1.0, 1.0 - sp.y / uView.y * 2.0, clamp(-(wp.z + (1.0 - hd) * 3.0) / 1600.0, -0.99, 0.99), 1.0);

  // 色: 帯のとき、その場所に見えていた写真(写真は まっすぐ。帯が窓になる)。
  float dotw = wt.z + wt.w;
  float asp = uAsp[int(r2.w)];
  vec2 fp = rib + (hx * aQ.x + hy * aQ.y) * (1.0 - dotw);
  vUV = 0.5 + (fp - r2.xy) / vec2(r2.z, r2.z / asp);
  vCell = vec2(mod(r2.w, ${ACOLS}.0), floor(r2.w / ${ACOLS}.0));
  vQ = aQ;
  vRound = dotw;
  float face = mix(1.0, cs, wt.y);
  vFace = face;
  vShade = mix(1.0, 0.62 + 0.38 * abs(cs), wt.y);
  vDot = mix(PAPER, fcol, lens);
  vDotW = wt.w;
  vRib = vec2((mod(float(j), ${SEG}.0) + fr) * uDp + aQ.x * uHalf.x, v * uW + aQ.y * uHalf.y);
  vLine = wt.x + wt.y;
}`;

const FS = `#version 300 es
precision highp float;
uniform sampler2D uAtlas;
uniform float uW;
in vec2 vQ; in vec2 vUV; in vec2 vCell; in float vRound; in float vFace; in float vShade;
in vec3 vDot; in float vDotW; in vec2 vRib; in float vLine;
out vec4 o;
const vec3 PAPER = vec3(0.957, 0.945, 0.918);
void main(){
  float d = mix(max(abs(vQ.x), abs(vQ.y)), length(vQ), vRound);
  if (d > 1.0) discard;
  vec2 uv = clamp(vUV, vec2(0.004), vec2(0.996));
  vec3 col = texture(uAtlas, (vCell + uv) / vec2(${ACOLS}.0, ${AROWS}.0)).rgb;
  if (vFace < 0.0) col = PAPER;
  // 帯のふちと、作品の境目の線。
  float line = max(step(uW * 0.5 - 1.3, abs(vRib.y)), step(vRib.x, 1.3));
  col = mix(col, PAPER, line * step(0.98, vLine));
  col *= vShade;
  col = mix(col, vDot, vDotW);
  o = vec4(col, 1.0);
}`;

export function mountMorph(root: HTMLElement) {
  const cv = root.querySelector<HTMLCanvasElement>('[data-canvas]')!;
  const gl = cv.getContext('webgl2', { antialias: true, alpha: false, depth: true, powerPreference: 'high-performance' });
  if (!gl) return () => {};
  const works = [...root.querySelectorAll<HTMLAnchorElement>('a[data-work]')];
  const nW = Math.min(works.length, ACOLS * AROWS);
  if (!nW) return () => {};

  // ---------- GL
  const sh = (type: number, src: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) console.error('morph shader', gl.getShaderInfoLog(s));
    return s;
  };
  const prog = gl.createProgram()!;
  gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS));
  gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    console.error('morph link', gl.getProgramInfoLog(prog));
    return () => {};
  }
  gl.useProgram(prog);
  const U = (n: string) => gl.getUniformLocation(prog, n);
  const u = {
    view: U('uView'), dp: U('uDp'), w: U('uW'), time: U('uTime'), phase: U('uPhase'), k: U('uK'), twK: U('uTwK'), zK: U('uZK'),
    half: U('uHalf'), asp: U('uAsp'), pitch: U('uPitch'), cols: U('uCols'), cells: U('uCells'), step: U('uStep'),
    focus: U('uFocus'), focusAsp: U('uFocusAsp'), pen: U('uPen'),
  };
  gl.uniform1i(U('uPath'), 0);
  gl.uniform1i(U('uAtlas'), 1);
  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.enable(gl.DEPTH_TEST);
  gl.depthFunc(gl.LEQUAL);
  gl.clearColor(0, 0, 0, 1);

  // なぞった跡(輪): 3行。 0: x, y, 向き / 1: 幅の向き, 生まれた時刻, 有効 / 2: 写真の中心, 写真の幅, 作品の番号
  const path = new Float32Array(M * 4 * 3);
  const pathTex = gl.createTexture();
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, pathTex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, M, 3, 0, gl.RGBA, gl.FLOAT, path);
  for (const p of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D, p, gl.NEAREST);
  for (const p of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T]) gl.texParameteri(gl.TEXTURE_2D, p, gl.CLAMP_TO_EDGE);

  // 作品の写真を1枚にまとめたもの。届くまでは、暗い灰色。
  const atlas = gl.createTexture();
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, atlas);
  const blank = new Uint8Array(ACOLS * CELL * AROWS * CELL * 4).fill(30);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, ACOLS * CELL, AROWS * CELL, 0, gl.RGBA, gl.UNSIGNED_BYTE, blank);
  for (const p of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D, p, gl.LINEAR);
  for (const p of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T]) gl.texParameteri(gl.TEXTURE_2D, p, gl.CLAMP_TO_EDGE);
  const asp = new Float32Array(30).fill(1);
  let dead = false;
  const cellCv = document.createElement('canvas');
  cellCv.width = cellCv.height = CELL;
  const cellCtx = cellCv.getContext('2d')!;
  works.slice(0, nW).forEach((a, k) => {
    const im = new Image();
    im.decoding = 'async';
    im.onload = () => {
      if (dead) return;
      asp[k] = im.naturalWidth / im.naturalHeight;
      cellCtx.drawImage(im, 0, 0, CELL, CELL); // 升目いっぱいに引き伸ばして持つ(見せるときに、もとの比率へ戻す)
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, atlas);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, (k % ACOLS) * CELL, Math.floor(k / ACOLS) * CELL, gl.RGBA, gl.UNSIGNED_BYTE, cellCv);
      gl.uniform1fv(u.asp, asp);
    };
    im.src = a.dataset.src || '';
  });
  gl.uniform1fv(u.asp, asp);

  // ---------- 大きさ
  let vw = 0;
  let vh = 0;
  let W = 100; // 帯の幅
  let dp = 6; // 跡と跡の間
  let Lmax = 4000; // 帯の長さ(これを超えると、古い所から巻き取られる)
  let pitch = 8;
  function size(force: boolean) {
    const w = root.clientWidth;
    const h = root.clientHeight;
    const reset = force || w !== vw || Math.abs(h - vh) > 120;
    vw = w;
    vh = h;
    const dpr = Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(6.6e6 / (w * h)));
    cv.width = Math.round(w * dpr);
    cv.height = Math.round(h * dpr);
    gl!.viewport(0, 0, cv.width, cv.height);
    gl!.uniform2f(u.view, vw, vh);
    if (!reset) return;
    W = Math.max(64, Math.min(132, Math.min(vw, vh) * 0.2));
    Lmax = Math.max(2600, Math.min(7000, 2.4 * (vw + vh)));
    dp = Lmax / M;
    const diag = Math.hypot(vw, vh);
    pitch = Math.max(7, Math.sqrt((diag * diag) / (TILES * 0.97)));
    const cols = Math.ceil(diag / pitch) + 1;
    const cells = cols * cols;
    // 格子の升目へ、面を まんべんなく配るための歩幅(升目の数と互いに素)。
    let step = Math.max(3, Math.round(cells * 0.618));
    const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
    while (gcd(step, cells) !== 1) step++;
    gl!.uniform1f(u.dp, dp);
    gl!.uniform1f(u.w, W);
    gl!.uniform2f(u.half, dp / 4 + 0.6, W / NV / 2 + 0.6);
    gl!.uniform1f(u.twK, (2 * Math.PI * Math.max(1, Math.round(Lmax / (W * 7)))) / M);
    gl!.uniform1f(u.zK, (2 * Math.PI * Math.max(1, Math.round(Lmax / (W * 11)))) / M);
    gl!.uniform1f(u.pitch, pitch);
    gl!.uniform1f(u.cols, cols);
    gl!.uniform1f(u.cells, cells);
    gl!.uniform1f(u.step, step);
    // 大きさが変わったら、描いた帯は消える(跡の間隔が変わるので)。
    path.fill(0);
    K = 0;
    segK = 0;
    stroke = false;
  }

  // ---------- なぞった跡を書く
  let K = 0; // これまでに書いた跡の数
  let segK = 0; // いまの作品が始まった所
  let workN = 0;
  let curWork = 0;
  let bx0 = 0;
  let by0 = 0;
  let bx1 = 0;
  let by1 = 0;
  let stroke = false; // ひと筆の途中
  let lx = 0; // 最後に跡を書いた位置
  let ly = 0;
  let tx = 1; // なめらかにした向き
  let ty = 0;
  let phase = 0;
  let now = 0;
  function begin(x: number, y: number) {
    // ひと筆ごとに、作品の境目から始める(残りの跡は、使わずに飛ばす)。
    while (K % SEG) {
      path[(M + (K % M)) * 4 + 3] = 0;
      K++;
    }
    lx = x;
    ly = y;
    stroke = true;
    first = true;
  }
  let first = false;
  function slot(x: number, y: number) {
    const j = K % M;
    if (K % SEG === 0) {
      segK = K;
      curWork = workN++ % nW;
      bx0 = by0 = 1e9;
      bx1 = by1 = -1e9;
    }
    path[j * 4] = x;
    path[j * 4 + 1] = y;
    path[j * 4 + 2] = tx;
    path[j * 4 + 3] = ty;
    path[(M + j) * 4] = -ty;
    path[(M + j) * 4 + 1] = tx;
    path[(M + j) * 4 + 2] = now;
    path[(M + j) * 4 + 3] = 1;
    // この作品の写真は、帯のこの区間を ちょうど覆う大きさで、まっすぐに置く。
    const pad = W * 0.62;
    bx0 = Math.min(bx0, x - pad);
    by0 = Math.min(by0, y - pad);
    bx1 = Math.max(bx1, x + pad);
    by1 = Math.max(by1, y + pad);
    const a = asp[curWork];
    const dw = Math.max(bx1 - bx0, (by1 - by0) * a);
    for (let k = segK; k <= K; k++) {
      const o = (2 * M + (k % M)) * 4;
      path[o] = (bx0 + bx1) / 2;
      path[o + 1] = (by0 + by1) / 2;
      path[o + 2] = dw;
      path[o + 3] = curWork;
    }
    K++;
    advance(dp);
  }
  function lineTo(x: number, y: number) {
    if (!stroke) return;
    let dx = x - lx;
    let dy = y - ly;
    let d = Math.hypot(dx, dy);
    while (d >= dp) {
      const ux = dx / d;
      const uy = dy / d;
      if (first) {
        tx = ux;
        ty = uy;
        first = false;
      } else {
        // 向きは、少し ならす(幅の向きが、手の震えで暴れないように)。位置は ならさない。
        const mx = tx * 0.72 + ux * 0.28;
        const my = ty * 0.72 + uy * 0.28;
        const ml = Math.hypot(mx, my) || 1;
        tx = mx / ml;
        ty = my / ml;
      }
      lx += ux * dp;
      ly += uy * dp;
      slot(lx, ly);
      dx = x - lx;
      dy = y - ly;
      d = Math.hypot(dx, dy);
    }
  }

  // ---------- 状態を進める(描いた長さで)
  let focus = 0;
  let lastState = 0;
  function advance(len: number) {
    phase += len / (Lmax * 0.36);
    onPhase();
  }
  function onPhase() {
    const A = Math.floor(phase);
    const f = phase - A;
    const a = ((A % 4) + 4) % 4;
    const x = Math.max(0, (f - HOLD) / (1 - HOLD));
    // 網点に描く作品は、粒子から網点へ変わりはじめた時に、ペン先にあった作品。
    if (a === 2 && x <= 0) focus = curWork;
    const st = x > 0.5 ? (a + 1) % 4 : a;
    if (st !== lastState) {
      lastState = st;
      ind.textContent = `${st + 1}/4  ${NAMES[st]}`;
      sfx.pon(st / 3);
      const on = st === 3;
      label.style.display = on ? 'block' : 'none';
      if (on) {
        const w = works[focus];
        lbT.textContent = w.textContent?.trim() || '';
        label.href = w.href;
      }
    }
    sfx.climb(f);
  }

  // ---------- 画面の文字(仮): 左下に いまの状態、網点のときは作品名。右下に音。
  const sfx = makeSfx();
  const mk = (tag: string, css: string) => {
    const e = document.createElement(tag);
    e.style.cssText = css;
    return e;
  };
  const FRAME = 'position:absolute;z-index:3;box-sizing:border-box;border:1px solid var(--fg);background:#000;color:var(--fg);font:inherit;';
  const BOTTOM = 'bottom:calc(1.1rem + env(safe-area-inset-bottom));';
  const ind = mk('p', `position:absolute;z-index:3;left:var(--pad);${BOTTOM}margin:0;font-size:.66rem;letter-spacing:.08em;color:var(--fg);pointer-events:none;font-variant-numeric:tabular-nums;white-space:pre;`);
  ind.textContent = `1/4  ${NAMES[0]}`;
  const label = mk('a', `${FRAME}left:var(--pad);bottom:calc(2.9rem + env(safe-area-inset-bottom));display:none;max-width:min(calc(100vw - var(--pad)*2),26rem);padding:.6rem .75rem .65rem;text-decoration:none;`) as HTMLAnchorElement;
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
  root.append(ind, label, snd);

  // ---------- 入力
  let drawing = false;
  let ptX = 0; // 指(カーソル)の位置
  let ptY = 0;
  let penX = 0; // ペン(指を、ごくわずかに遅れて追う)
  let penY = 0;
  let over = 0; // カーソルが画面の中にある(網点のレンズに使う)
  let idle = 2.2; // ひとりでに描きはじめるまでの秒
  let auto = false;
  let autoOn = true;
  let tau = Math.random() * 20;
  const isUI = (t: EventTarget | null) => t instanceof Element && !!t.closest('a,button');
  function onDown(e: PointerEvent) {
    if (isUI(e.target) || (e.pointerType === 'mouse' && e.button !== 0)) return;
    const r = root.getBoundingClientRect();
    ptX = penX = e.clientX - r.left;
    ptY = penY = e.clientY - r.top;
    drawing = true;
    auto = false;
    over = 1;
    begin(penX, penY);
    sfx.pluck(K / SEG);
    try {
      root.setPointerCapture(e.pointerId);
    } catch {}
    e.preventDefault();
  }
  function onMove(e: PointerEvent) {
    const r = root.getBoundingClientRect();
    ptX = e.clientX - r.left;
    ptY = e.clientY - r.top;
    if (e.pointerType === 'mouse') over = 1;
  }
  function onUp() {
    if (!drawing) return;
    drawing = false;
    stroke = false;
    idle = 3.5;
  }
  function onLeave(e: PointerEvent) {
    if (e.pointerType === 'mouse' && !drawing) over = 0;
  }
  root.addEventListener('pointerdown', onDown);
  root.addEventListener('pointermove', onMove);
  root.addEventListener('pointerup', onUp);
  root.addEventListener('pointercancel', onUp);
  root.addEventListener('pointerleave', onLeave);
  const onResize = () => size(false);
  window.addEventListener('resize', onResize);

  // ひとりでに描くペンの通り道(なめらかに、画面の中を さまよう)。
  const autoAt = (t: number) => [
    vw * (0.5 + 0.34 * Math.sin(0.9 * t + 1.0) + 0.1 * Math.sin(2.3 * t)),
    vh * (0.52 + 0.27 * Math.sin(1.3 * t) + 0.1 * Math.cos(3.1 * t + 0.5)),
  ];

  // ---------- 毎コマ
  let raf = 0;
  let last = performance.now();
  const t0 = last;
  function tick(t: number) {
    raf = requestAnimationFrame(tick);
    const dt = Math.min(0.05, Math.max(0.001, (t - last) / 1000));
    last = t;
    now = (t - t0) / 1000;
    if (drawing) {
      const k = 1 - Math.exp(-dt / 0.03);
      penX += (ptX - penX) * k;
      penY += (ptY - penY) * k;
      lineTo(penX, penY);
    } else if (autoOn) {
      idle -= dt;
      if (idle <= 0) {
        if (!auto) {
          auto = true;
          [penX, penY] = autoAt(tau);
          begin(penX, penY);
        }
        const [ax, ay] = autoAt(tau);
        const [bx, by] = autoAt(tau + 0.01);
        tau += (430 * dt * 0.01) / Math.max(1, Math.hypot(bx - ax, by - ay));
        [penX, penY] = autoAt(tau);
        lineTo(penX, penY);
      }
    }
    gl!.activeTexture(gl!.TEXTURE0);
    gl!.bindTexture(gl!.TEXTURE_2D, pathTex);
    gl!.texSubImage2D(gl!.TEXTURE_2D, 0, 0, 0, M, 3, gl!.RGBA, gl!.FLOAT, path);
    gl!.uniform1f(u.time, now);
    gl!.uniform1f(u.phase, phase);
    gl!.uniform1f(u.k, Math.max(1, K));
    gl!.uniform1f(u.focus, focus);
    gl!.uniform1f(u.focusAsp, asp[focus]);
    const lensOn = drawing || auto ? 1 : over;
    gl!.uniform3f(u.pen, drawing || auto ? penX : ptX, drawing || auto ? penY : ptY, lensOn);
    gl!.clear(gl!.COLOR_BUFFER_BIT | gl!.DEPTH_BUFFER_BIT);
    if (K > 0) gl!.drawArraysInstanced(gl!.TRIANGLE_STRIP, 0, 4, TILES);
  }
  size(true);
  raf = requestAnimationFrame(tick);

  (window as unknown as Record<string, unknown>).__morph = {
    phase(v: number) {
      phase = v;
      onPhase();
    },
    auto(on: boolean) {
      autoOn = on;
      if (!on) {
        auto = false;
        stroke = drawing;
      }
    },
    // 確認用: 点の並びを、ひと筆として一気に描く。
    draw(pts: number[][]) {
      begin(pts[0][0], pts[0][1]);
      for (const [x, y] of pts) lineTo(x, y);
      stroke = false;
    },
    get state() {
      return { phase, K, focus };
    },
  };

  return () => {
    dead = true;
    cancelAnimationFrame(raf);
    root.removeEventListener('pointerdown', onDown);
    root.removeEventListener('pointermove', onMove);
    root.removeEventListener('pointerup', onUp);
    root.removeEventListener('pointercancel', onUp);
    root.removeEventListener('pointerleave', onLeave);
    window.removeEventListener('resize', onResize);
    ind.remove();
    label.remove();
    snd.remove();
    sfx.dispose();
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  };
}
