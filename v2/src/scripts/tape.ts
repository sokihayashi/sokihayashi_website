// Works の一覧「テープ」の版。
//
// 考え方(トップの「描く帯」と同じ):
//   - 列は1本ずつの、平らなテープ。幅は一定、伸びない、陰もない。作品は、テープを直角に切った面。
//   - テープの「通り道」は画面の上にある。ふだんは、まっすぐな縦の線。
//   - 指(PC ではカーソル)でつかめるのは、触れた1本だけ。指の通った跡が、その1本の通り道になる。
//     指の下のテープは指についてくる。うしろのテープは、指の通った跡をなぞって流れる(ひもを引くのと同じ)。
//   - となりのテープは、ぶつかられて初めて動く。押されて、よけて、自分のばねで戻る。だから1本ずつ動きが違う。
//   - テープは伸びないので、横へ引くと、上下のテープが指のほうへ たぐり寄せられる。
//   - 指を離すと、線は勢いで少し先まで伸び、そのあと、ばねで まっすぐへ戻る。そのあいだも作品は、曲がった通り道を流れ続ける。
//
// 作り:
//   - 通り道の横ずれは、テープごとに、画面の高さごとの値(場)で持つ。場は、ばね・張り・減衰で動く。
//   - 場から中心線をつくり、線に沿った長さで作品の位置を決める(伸びない)。面のふちは、中心線から直角に幅の半分。
//   - 動いているあいだ、写真・文字の面の地・線は、1枚の canvas に WebGL で描く。
//     (もとの写真を毎コマ裁ち直す作りは、機種によって CPU で描かれて詰まる。WebGL は、どの機種でも GPU で描かれる)
//     写真は、面ごと動かして回すだけ(歪めない)。文字は、もとの要素を動かして回す。
//   - 静まったら canvas をしまい、もとの写真と線に戻す。何も動かさない、ふつうの升目になる。
//
// 作品に触れると、画面全体が変わる(映像表現研究の手札から):
//   - 触れた作品の絵が、触れた点から波になって広がり、全部のテープがその1枚の絵の「短冊」になる
//     (nok の帯状コラージュ: 1枚の絵を、帯ごとに切り出して並べる)。
//   - 波のふちは、なめらかにぼかさず、小さな升目が ばらばらに切り替わる
//     (Ringwriter: 文字ごとの決まった しきい値で、点に崩れる / 網点: 段階で見せる)。
//   - 音は sfx.ts(Topographic の操作音の文法)。

import { makeSfx } from './sfx';

export type TapeGrid = {
  rows: HTMLElement[]; // 見えている作品(並び順)
  n: number;
  cols: number;
  cw: number; // テープの幅
  g: number; // テープのあいだ
  ph: number; // 写真の面の長さ
  rowH: number; // 写真の面 + 文字の面
  R: number; // 段の数
};

const SVGNS = 'http://www.w3.org/2000/svg';
type Dbg = { __tapeSlow?: number; __tapeForce?: boolean; __tapeKeep?: boolean };

export function mountTape(root: HTMLElement, list: HTMLElement, animate: boolean) {
  let G: TapeGrid | null = null;
  type Cl = {
    f: HTMLElement | null;
    img: HTMLImageElement | null;
    tx: HTMLElement | null;
    o: SVGSVGElement;
    hid: boolean; // もとの写真と線を隠して、canvas に描いている
    cov: boolean; // 文字を隠している(上に絵が出ている)
  };
  let cls: Cl[] = [];
  const dirty = new Set<number>();
  // 線の色(紙色)。CSS の --fg(#rrggbb)を、0〜1 の数にして持つ。
  const hex = (getComputedStyle(root).getPropertyValue('--fg').trim().match(/^#([0-9a-f]{6})$/i) || ['', 'f4f1ea'])[1];
  const paperRGB = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);

  // ---------- 場(テープごとの、通り道の横ずれ。画面の高さ −PAD 〜 画面の下 +PAD)
  const HS = 16; // 場のきざみ
  const PAD = 420;
  const OMEGA = 4.3; // まっすぐへ戻る ばね の速さ
  const ZETA = 0.7; // 減衰(1 より小さいと、少し行きすぎてから戻る)
  const ETA = 1900; // 細かい折れをならす
  const SMAX = 0.95; // 面の傾きの上限(約 43 度)
  const KC = 520; // テープどうしが ぶつかったときに押し返す強さ
  let LSP = 86; // 指の先で、通り道がなめらかにつながる長さ(テープの幅に合わせる)
  let SIG = 27; // 指の太さ(同上)
  let FX: Float32Array[] = []; // 横ずれ
  let FV: Float32Array[] = []; // その速さ
  let fN = 0;
  let vh = 0;
  function ensureField() {
    vh = window.innerHeight;
    const cols = G ? G.cols : 0;
    // 場の長さは、増やすだけ(スマホは送るたびに画面の高さが変わる。そのたびに作り直すと、動きが途切れる)。
    const n = Math.max(fN, Math.ceil((Math.max(vh, window.screen?.height || 0) + PAD * 2) / HS) + 1);
    if (n !== fN || FX.length !== cols) {
      const grow = (a?: Float32Array) => {
        const b = new Float32Array(n);
        if (a) b.set(a);
        return b;
      };
      FX = Array.from({ length: cols }, (_, c) => grow(FX[c]));
      FV = Array.from({ length: cols }, (_, c) => grow(FV[c]));
      fN = n;
    }
  }
  // 点のあいだは、なめらかな曲線でつなぐ。
  const fieldAt = (c: number, y: number) => {
    const A = FX[c];
    const f = Math.max(0, Math.min(fN - 1, (y + PAD) / HS));
    const i = Math.min(fN - 2, Math.floor(f));
    const t = f - i;
    const p0 = A[i > 0 ? i - 1 : 0];
    const p1 = A[i];
    const p2 = A[i + 1];
    const p3 = A[i + 2 < fN ? i + 2 : fN - 1];
    return p1 + 0.5 * t * (p2 - p0 + t * (2 * p0 - 5 * p1 + 4 * p2 - p3 + t * (3 * (p1 - p2) + p3 - p0)));
  };
  // テープ c の、高さ y のまわりを、横へ d だけ動かす。速さは vel にそろえる。w0 は効かせる強さ(0〜1)。
  function push(c: number, y: number, d: number, vel: number, w0: number) {
    const X = FX[c];
    const V = FV[c];
    const at = Math.round((y + PAD) / HS);
    const span = Math.ceil((SIG * 2.6) / HS);
    for (let j = Math.max(0, at - span); j <= Math.min(fN - 1, at + span); j++) {
      const w = Math.exp(-(((j * HS - PAD - y) / SIG) ** 2)) * w0;
      X[j] += d * w;
      V[j] += (vel - V[j]) * w;
    }
  }

  // ---------- テープごとの通り道
  const DYP = 8;
  let K = 0;
  let pX = new Float32Array(0); // 中心線の横位置(一覧の左端から)
  let pS = new Float32Array(0); // 傾き
  let pL = new Float32Array(0); // テープの上の位置(一覧の上端からの長さ)
  let pA = new Float32Array(0); // 作業用
  let pB = new Float32Array(0);
  let Y0 = 0;
  let qx = 0;
  let qy = 0;
  let qs = 0;
  // ならす(箱形の平均を3回 ≒ 山形の重み)。src → dst、半径は r 点ぶん。tmp は作業用。
  function blur(src: Float32Array, dst: Float32Array, tmp: Float32Array, r: number) {
    const box = (a: Float32Array, o: Float32Array) => {
      let sum = 0;
      for (let i = -r; i <= r; i++) sum += a[i < 0 ? 0 : i >= K ? K - 1 : i];
      for (let i = 0; i < K; i++) {
        o[i] = sum / (2 * r + 1);
        const add = i + r + 1;
        const sub = i - r;
        sum += a[add >= K ? K - 1 : add] - a[sub < 0 ? 0 : sub];
      }
    };
    box(src, tmp);
    box(tmp, dst);
    box(dst, tmp);
    dst.set(tmp);
  }
  const maxCurv = (x: Float32Array) => {
    let m = 0;
    for (let i = 1; i < K - 1; i++) {
      const c = Math.abs(x[i + 1] - 2 * x[i] + x[i - 1]);
      if (c > m) m = c;
    }
    return m / (DYP * DYP);
  };
  const limOf = (cw: number) => cw * 0.62; // 横へ動ける幅(端は壁にせず、近づくほど ゆるやかに)
  function buildPath(c: number, listTop: number, anchorY: number) {
    const { cw, g } = G!;
    const hx = c * (cw + g) + cw / 2;
    const lim = limOf(cw);
    Y0 = -PAD + HS;
    const k = Math.floor((vh + PAD * 2 - HS * 2) / DYP) + 1;
    if (k !== K) {
      K = k;
      pX = new Float32Array(k);
      pS = new Float32Array(k);
      pL = new Float32Array(k);
      pA = new Float32Array(k);
      pB = new Float32Array(k);
    }
    let bent = false;
    for (let i = 0; i < K; i++) {
      const f = fieldAt(c, Y0 + i * DYP);
      if (f > -0.02 && f < 0.02) {
        pX[i] = hx;
        continue;
      }
      bent = true;
      pX[i] = hx + lim * Math.tanh(f / lim);
    }
    if (bent) {
      // 平らなテープは、きつくは曲がれない。幅に応じてならし、それでも きつい所は、さらに ならした線へ寄せる。
      blur(pX, pA, pB, Math.max(2, Math.round((0.2 * cw) / DYP)));
      const k1 = maxCurv(pA);
      const kMax = 1 / (0.95 * cw); // 曲がりの半径は、幅の 0.95 倍まで
      if (k1 > kMax) {
        blur(pA, pX, pB, Math.max(3, Math.round((0.42 * cw) / DYP)));
        const k2 = maxCurv(pX);
        const beta = Math.max(0, Math.min(1, (k1 - kMax) / (k1 - k2 + 1e-9)));
        for (let i = 0; i < K; i++) pX[i] = pA[i] + (pX[i] - pA[i]) * beta;
      } else pX.set(pA);
    }
    // 線に沿った長さ。anchorY(指のある高さ)で、ふつうの送りの位置と一致させる。
    pL[0] = 0;
    for (let i = 1; i < K; i++) pL[i] = pL[i - 1] + Math.hypot(DYP, pX[i] - pX[i - 1]);
    const fa = Math.max(0, Math.min(K - 1.001, (anchorY - Y0) / DYP));
    const ia = Math.floor(fa);
    const base = anchorY - listTop - (pL[ia] + (pL[ia + 1] - pL[ia]) * (fa - ia));
    for (let i = 0; i < K; i++) {
      pL[i] += base;
      const s = (pX[i + 1 < K ? i + 1 : i] - pX[i > 0 ? i - 1 : i]) / (DYP * (i > 0 && i + 1 < K ? 2 : 1));
      pS[i] = s > SMAX ? SMAX : s < -SMAX ? -SMAX : s;
    }
  }
  // テープの上の位置 lam にある点(中心線の上)。結果は qx, qy(画面の高さ), qs(傾き)。
  function ptAt(lam: number) {
    if (lam <= pL[0]) {
      qx = pX[0];
      qy = Y0 - (pL[0] - lam);
      qs = 0;
      return;
    }
    if (lam >= pL[K - 1]) {
      qx = pX[K - 1];
      qy = Y0 + (K - 1) * DYP + (lam - pL[K - 1]);
      qs = 0;
      return;
    }
    let lo = 0;
    let hi = K - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (pL[mid] <= lam) lo = mid;
      else hi = mid;
    }
    const t = (lam - pL[lo]) / (pL[hi] - pL[lo]);
    qx = pX[lo] + (pX[hi] - pX[lo]) * t;
    qy = Y0 + (lo + t) * DYP;
    qs = pS[lo] + (pS[hi] - pS[lo]) * t;
  }
  const lamAtY = (y: number) => {
    const f = (y - Y0) / DYP;
    if (f <= 0) return pL[0] + (y - Y0);
    if (f >= K - 1) return pL[K - 1] + (y - Y0 - (K - 1) * DYP);
    const i = Math.floor(f);
    return pL[i] + (pL[i + 1] - pL[i]) * (f - i);
  };

  // ---------- canvas(動いているあいだの描画先。画面の幅 × 画面の高さ + 上下の余白。一覧と一緒に送られる場所に置く)
  const CM = 150;
  let cv: HTMLCanvasElement | null = null;
  let gl: WebGLRenderingContext | null = null;
  let glFail = false;
  let cvD = 1;
  let cvW = 0;
  let cvH = 0;
  let cvOn = false;
  let uSize: WebGLUniformLocation | null = null;
  let uOrg: WebGLUniformLocation | null = null;
  let uKind: WebGLUniformLocation | null = null;
  let uCol: WebGLUniformLocation | null = null;
  const U: Record<string, WebGLUniformLocation | null> = {};
  const tex = new Map<string, { t: WebGLTexture; w: number; h: number }>();
  function initGL(): boolean {
    if (gl) return true;
    if (glFail) return false;
    cv = document.createElement('canvas');
    cv.setAttribute('aria-hidden', 'true');
    cv.style.cssText = 'position:absolute;left:0;top:0;z-index:1;pointer-events:none;display:none;will-change:transform';
    const opt = { alpha: true, antialias: true, premultipliedAlpha: true, powerPreference: 'high-performance' as const };
    gl = (cv.getContext('webgl2', opt) || cv.getContext('webgl', opt)) as WebGLRenderingContext | null;
    if (!gl) {
      glFail = true;
      cv = null;
      return false;
    }
    const sh = (type: number, src: string) => {
      const o = gl!.createShader(type)!;
      gl!.shaderSource(o, src);
      gl!.compileShader(o);
      return o;
    };
    const prog = gl.createProgram()!;
    // p: 一覧の左上を原点にした位置(px)。org: canvas の左上の、同じ座標での位置。
    gl.attachShader(
      prog,
      sh(
        gl.VERTEX_SHADER,
        'attribute vec2 p;attribute vec2 uv;uniform vec2 size;uniform vec2 org;varying vec2 vuv;' +
          'void main(){vuv=uv;vec2 q=p-org;gl_Position=vec4(q.x/size.x*2.-1.,1.-q.y/size.y*2.,0.,1.);}'
      )
    );
    // kind 0: 写真の面 / 1: 線(col の色) / 2: 文字の面の地(黒)。
    // 触れた作品の絵(tu: いま全体に出ている絵 / to: 広がってくる絵)は、画面いっぱいの1枚として読む。
    // 広がる波の内側かどうかは、小さな升目ごとに、決まった乱数のしきい値で決める(ふちが升目で崩れる)。
    gl.attachShader(
      prog,
      sh(
        gl.FRAGMENT_SHADER,
        'precision highp float;uniform sampler2D t;uniform sampler2D tu;uniform sampler2D to;' +
          'uniform float kind;uniform vec4 col;uniform vec2 view;uniform vec2 cvs;uniform float dpr;uniform float top;' +
          'uniform float hasU;uniform float hasO;uniform float ua;uniform float oa;uniform vec2 fc;uniform float fr;uniform float band;uniform float cell;' +
          'varying vec2 vuv;' +
          'vec2 cover(vec2 px,float a){float s=max(view.x/a,view.y);return .5+(px-view*.5)/(vec2(a,1.)*s);}' +
          'void main(){' +
          'if(kind>.5&&kind<1.5){gl_FragColor=col;return;}' +
          'vec3 base=kind<.5?texture2D(t,vuv).rgb:vec3(0.);' +
          'if(hasU+hasO<.5){gl_FragColor=vec4(base,1.);return;}' +
          'vec2 px=vec2(gl_FragCoord.x,cvs.y-gl_FragCoord.y)/dpr-vec2(0.,top);' +
          'vec2 ce=floor(px/cell);float h=fract(sin(dot(ce,vec2(127.1,311.7)))*43758.5453);' +
          'float on=step(distance((ce+.5)*cell,fc),fr+(h-.5)*band);' +
          'vec3 cu=hasU>.5?texture2D(tu,cover(px,ua)).rgb:base;' +
          'vec3 co=hasO>.5?texture2D(to,cover(px,oa)).rgb:base;' +
          'gl_FragColor=vec4(mix(cu,co,on),1.);}'
      )
    );
    gl.bindAttribLocation(prog, 0, 'p');
    gl.bindAttribLocation(prog, 1, 'uv');
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      glFail = true;
      gl = null;
      cv = null;
      return false;
    }
    gl.useProgram(prog);
    uSize = gl.getUniformLocation(prog, 'size');
    uOrg = gl.getUniformLocation(prog, 'org');
    uKind = gl.getUniformLocation(prog, 'kind');
    uCol = gl.getUniformLocation(prog, 'col');
    for (const n of ['view', 'cvs', 'dpr', 'top', 'hasU', 'hasO', 'ua', 'oa', 'fc', 'fr', 'band', 'cell']) U[n] = gl.getUniformLocation(prog, n);
    gl.uniform1i(gl.getUniformLocation(prog, 't'), 0);
    gl.uniform1i(gl.getUniformLocation(prog, 'tu'), 1);
    gl.uniform1i(gl.getUniformLocation(prog, 'to'), 2);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.enableVertexAttribArray(0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 16, 0);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 16, 8);
    gl.disable(gl.DEPTH_TEST);
    gl.clearColor(0, 0, 0, 0);
    cv.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      glFail = true; // 描く先を失ったら、動かすのをやめて、ふつうの升目のままにする
    });
    root.appendChild(cv);
    return true;
  }
  function sizeCanvas() {
    const w = document.documentElement.clientWidth;
    const h = vh + CM * 2;
    const d = Math.min(window.devicePixelRatio || 1, 3, Math.sqrt(6.6e6 / (w * h)));
    const pw = Math.round(w * d);
    const phx = Math.round(h * d);
    if (cv!.width !== pw || cv!.height !== phx) {
      cv!.width = pw;
      cv!.height = phx;
      cv!.style.width = `${w}px`;
      cv!.style.height = `${h}px`;
    }
    cvD = d;
    cvW = w;
    cvH = h;
  }
  function showCanvas(on: boolean) {
    if (!cv || cvOn === on) return;
    cvOn = on;
    cv.style.display = on ? 'block' : 'none';
  }
  // 写真を GPU に渡す。最初に動かす瞬間に つかえないよう、手の空いたときに前もって渡しておく。
  function texOf(img: HTMLImageElement) {
    const key = img.currentSrc || img.src;
    const hit = tex.get(key);
    if (hit) return hit;
    if (!gl || !img.complete || !img.naturalWidth) return null;
    try {
      const t = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      const o = { t, w: img.naturalWidth, h: img.naturalHeight };
      tex.set(key, o);
      return o;
    } catch {
      return null;
    }
  }
  let warmAt = 0;
  let warmId = 0;
  function warm() {
    warmId = 0;
    if (!G || !initGL()) return;
    let made = 0;
    while (warmAt < cls.length && made < 2) {
      const img = cls[warmAt].img;
      if (img && !tex.has(img.currentSrc || img.src)) {
        if (!img.complete) break; // まだ届いていない写真は、あとで
        if (texOf(img)) made++;
      }
      warmAt++;
    }
    if (warmAt < cls.length) warmId = window.setTimeout(warm, made ? 60 : 400);
  }

  // ---------- 触れた作品の絵を、画面全体に広げる
  type FImg = { t: WebGLTexture; a: number } | null;
  let fU: FImg = null; // いま全体に出ている絵(null: ふつうの一覧)
  let fUidx = -1;
  let fO: FImg = null; // 広がってくる絵(null: ふつうの一覧へ戻る波)
  let fOidx = -1;
  let fT = -1; // 波が始まってからの秒(負: 波は出ていない)
  let fcx = 0; // 波の中心(画面の中)
  let fcy = 0;
  let fRad = 0;
  const F_DUR = 0.85;
  const F_BAND = 240; // 波のふちで、升目が ばらばらに切り替わる幅
  const big = new Map<string, { t: WebGLTexture; a: number }>(); // 大きい版の写真(触れたときに読む)
  const focusOn = () => fU !== null || fO !== null || fT >= 0;
  const focusIdx = () => (fT >= 0 ? fOidx : fUidx);
  // 画面の位置 (x, y) に、いま絵が出ているか(文字を隠すかどうかに使う)。
  const imageAt = (x: number, y: number) => (fT >= 0 && Math.hypot(x - fcx, y - fcy) < fRad ? fO !== null : fU !== null);
  function focusTex(idx: number): FImg {
    const img = cls[idx]?.img;
    if (!img || !gl) return null;
    const src = img.dataset.large || '';
    const hit = big.get(src);
    if (hit) return hit;
    // 大きい版が届くまでは、小さい版を引き伸ばして出す。届いたら、同じ位置のまま差し替える。
    if (src) {
      const L = new Image();
      L.decoding = 'async';
      L.onload = () => {
        if (!gl || glFail) return;
        const t = gl.createTexture()!;
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, t);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, L);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        const o = { t, a: L.naturalWidth / L.naturalHeight };
        big.set(src, o);
        // 持ちすぎない(古いものから捨てる)。
        if (big.size > 5) {
          const k = big.keys().next().value as string;
          const old = big.get(k)!;
          if (old !== fU && old !== fO) {
            gl.deleteTexture(old.t);
            big.delete(k);
          }
        }
        if (fOidx === idx && fO) fO = o;
        if (fUidx === idx && fU) fU = o;
      };
      L.src = src;
    }
    const sm = texOf(img);
    return sm ? { t: sm.t, a: sm.w / sm.h } : null;
  }
  // 作品 idx の絵を、(x, y) から広げる。idx が負なら、ふつうの一覧へ戻す波。
  function focus(idx: number, x: number, y: number) {
    if (!spread || !G || !animate || glFail || !initGL()) return;
    if (idx === focusIdx()) return;
    if (fT >= 0) {
      // 波の途中で次へ移ったら、広がりかけの絵を「いま出ている絵」として、その上に次の波を重ねる。
      fU = fO;
      fUidx = fOidx;
    }
    fO = idx >= 0 ? focusTex(idx) : null;
    fOidx = idx >= 0 && fO ? idx : -1;
    fT = 0;
    fRad = 0;
    fcx = x;
    fcy = y;
    showLabel(fOidx);
    if (fOidx >= 0) sfx.pon(1 - y / Math.max(1, window.innerHeight));
    kick();
  }

  // ---------- 描画
  const eL: number[] = [];
  const eR: number[] = [];
  const fL: number[] = [];
  const fR: number[] = [];
  let listLeft = 0; // 一覧の左端の、画面の中での位置(このコマ)
  let vb = new Float32Array(4096);
  let vn = 0;
  const need = (n: number) => {
    if (vn + n > vb.length) {
      const b = new Float32Array(Math.max(vb.length * 2, vn + n));
      b.set(vb);
      vb = b;
    }
  };
  // テープの la〜lb のふち(左と右)。中心線から、直角に幅の半分。一覧の左上を原点にした位置で返す。
  function edges(la: number, lb: number, listTop: number, L: number[], Rr: number[]) {
    const half = G!.cw / 2;
    L.length = 0;
    Rr.length = 0;
    const k = Math.max(1, Math.round((lb - la) / 12));
    for (let i = 0; i <= k; i++) {
      ptAt(la + ((lb - la) * i) / k);
      const q = 1 / Math.sqrt(1 + qs * qs);
      const y = qy - listTop;
      L.push(qx - half * q, y + half * qs * q);
      Rr.push(qx + half * q, y - half * qs * q);
    }
  }
  // 太さ 1px の線(細い四角の連なり)。
  function line(x0: number, y0: number, x1: number, y1: number) {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len = Math.hypot(dx, dy) || 1;
    const nx = (-dy / len) * 0.5;
    const ny = (dx / len) * 0.5;
    need(24);
    const v = vb;
    let k = vn;
    v[k++] = x0 + nx; v[k++] = y0 + ny; k += 2;
    v[k++] = x0 - nx; v[k++] = y0 - ny; k += 2;
    v[k++] = x1 + nx; v[k++] = y1 + ny; k += 2;
    v[k++] = x0 - nx; v[k++] = y0 - ny; k += 2;
    v[k++] = x1 - nx; v[k++] = y1 - ny; k += 2;
    v[k++] = x1 + nx; v[k++] = y1 + ny; k += 2;
    vn = k;
  }
  function outline(L: number[], Rr: number[]) {
    const n = L.length;
    for (let i = 0; i + 2 < n; i += 2) {
      line(L[i], L[i + 1], L[i + 2], L[i + 3]);
      line(Rr[i], Rr[i + 1], Rr[i + 2], Rr[i + 3]);
    }
    line(L[0], L[1], Rr[0], Rr[1]);
    line(L[n - 2], L[n - 1], Rr[n - 2], Rr[n - 1]);
  }
  function restCell(idx: number) {
    const el = cls[idx];
    if (!el) return;
    if (el.hid) {
      el.hid = false;
      if (el.img) el.img.style.visibility = '';
      el.o.style.visibility = '';
    }
    if (el.f) el.f.style.transform = '';
    if (el.tx) {
      el.tx.style.transform = '';
      if (el.cov) {
        el.cov = false;
        el.tx.style.opacity = '';
      }
    }
  }
  function drawCell(idx: number, r: number, c: number, listTop: number) {
    const el = cls[idx];
    if (!el || !gl) return;
    const { cw, g, ph, rowH } = G!;
    const hx = c * (cw + g) + cw / 2;
    const l0 = r * rowH;
    const l1 = l0 + ph;
    const l2 = l0 + rowH;
    ptAt(l0);
    const ax = qx;
    const ay = qy - listTop;
    ptAt(l1);
    const bx = qx;
    const by = qy - listTop;
    ptAt(l2);
    const cx = qx;
    const cy = qy - listTop;
    edges(l0, l1, listTop, eL, eR); // 写真の面
    edges(l1, l2, listTop, fL, fR); // 文字の面
    const mx = (ax + bx) / 2;
    const my = (ay + by) / 2;
    const phi = Math.atan2(bx - ax, by - ay);
    const t = el.img ? texOf(el.img) : null;
    vn = 0;
    // 1) 文字の面の地(黒)。となりのテープと重なったとき、下のテープを隠す。
    const nF = fL.length;
    need(nF * 4);
    for (let i = 0; i < nF; i += 2) {
      vb[vn] = fL[i]; vb[vn + 1] = fL[i + 1];
      vb[vn + 4] = fR[i]; vb[vn + 5] = fR[i + 1];
      vn += 8;
    }
    const capEnd = vn;
    // 2) 写真: 面の形の帯。写真は、面ごと動かして回すだけ(歪めない)。箱からはみ出すぶんは、少し大きくして覆う。
    const nE = eL.length;
    need(nE * 4);
    const cs = Math.cos(phi);
    const sn = Math.sin(phi);
    const bw = cw * 1.18; // 写真の箱は、面より少し大きい(CSS の --m, --vm と合わせる)
    const bh = ph * 1.1;
    let sc = 1;
    for (let i = 0; i < nE; i += 2)
      for (const E of [eL, eR]) {
        const vx = E[i] - mx;
        const vy = E[i + 1] - my;
        const nd = Math.max(Math.abs(vx * cs - vy * sn) / (bw / 2), Math.abs(vx * sn + vy * cs) / (bh / 2));
        if (nd > sc) sc = nd;
      }
    sc = Math.min(1.6, sc);
    // object-fit: cover と同じ切り取り。
    let fu = 1;
    let fv = 1;
    if (t) {
      const ab = bw / bh;
      const ai = t.w / t.h;
      if (ai > ab) fu = ab / ai;
      else fv = ai / ab;
    }
    for (let i = 0; i < nE; i += 2)
      for (const E of [eL, eR]) {
        const x = E[i];
        const y = E[i + 1];
        const vx = x - mx;
        const vy = y - my;
        vb[vn] = x;
        vb[vn + 1] = y;
        vb[vn + 2] = 0.5 + ((vx * cs - vy * sn) / sc / bw) * fu;
        vb[vn + 3] = 0.5 + ((vx * sn + vy * cs) / sc / bh) * fv;
        vn += 4;
      }
    const phoEnd = vn;
    // 3) 線
    outline(eL, eR);
    outline(fL, fR);
    gl.bufferData(gl.ARRAY_BUFFER, vb.subarray(0, vn), gl.DYNAMIC_DRAW);
    gl.uniform1f(uKind, 2);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, capEnd / 4);
    if (t) {
      gl.uniform1f(uKind, 0);
      gl.bindTexture(gl.TEXTURE_2D, t.t);
    }
    gl.drawArrays(gl.TRIANGLE_STRIP, capEnd / 4, (phoEnd - capEnd) / 4);
    gl.uniform1f(uKind, 1);
    gl.uniform4f(uCol, paperRGB[0], paperRGB[1], paperRGB[2], 1);
    gl.drawArrays(gl.TRIANGLES, phoEnd / 4, (vn - phoEnd) / 4);
    // もとの要素: 写真と線は隠す。写真の面は、押せる場所を合わせるために動かす。文字は、面ごと動かして回す。
    if (!el.hid) {
      el.hid = true;
      if (el.img) el.img.style.visibility = 'hidden';
      el.o.style.visibility = 'hidden';
    }
    if (el.f) el.f.style.transform = `translate3d(${(mx - hx).toFixed(2)}px,${(my - (l0 + ph / 2)).toFixed(2)}px,0) rotate(${(-phi).toFixed(4)}rad)`;
    if (el.tx) {
      const tmx = (bx + cx) / 2;
      const tmy = (by + cy) / 2;
      const tphi = Math.atan2(cx - bx, cy - by);
      el.tx.style.transform = `translate3d(${(tmx - hx).toFixed(2)}px,${(tmy - (l1 + (rowH - ph) / 2)).toFixed(2)}px,0) rotate(${(-tphi).toFixed(4)}rad)`;
      // 絵が出ている所では、文字を隠す。
      const cov = imageAt(tmx + listLeft, tmy + listTop);
      if (cov !== el.cov) {
        el.cov = cov;
        el.tx.style.opacity = cov ? '0' : '';
      }
    }
  }
  function drawAll(listRect: DOMRect, anchorY: number) {
    const { n, cols, rowH, R } = G!;
    if (!initGL() || !cv || !gl) return;
    sizeCanvas();
    // canvas は、画面の左上から CM だけ上に置く。一覧の中の要素なので、送りには一覧と一緒についていく。
    const rr = root.getBoundingClientRect();
    cv.style.transform = `translate3d(${(-rr.left).toFixed(2)}px,${(-rr.top - CM).toFixed(2)}px,0)`;
    gl.viewport(0, 0, cv.width, cv.height);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform2f(uSize, cvW, cvH);
    gl.uniform2f(uOrg, -listRect.left, -listRect.top - CM);
    listLeft = listRect.left;
    // 触れた作品の絵(画面いっぱいの1枚)と、広がる波。
    gl.uniform2f(U.view, cvW, vh);
    gl.uniform2f(U.cvs, cv.width, cv.height);
    gl.uniform1f(U.dpr, cvD);
    gl.uniform1f(U.top, CM);
    gl.uniform1f(U.hasU, fU ? 1 : 0);
    gl.uniform1f(U.hasO, fT >= 0 && fO ? 1 : fT < 0 && fU ? 1 : 0);
    gl.uniform1f(U.ua, fU ? fU.a : 1);
    gl.uniform1f(U.oa, fT >= 0 ? (fO ? fO.a : 1) : fU ? fU.a : 1);
    gl.uniform2f(U.fc, fcx, fcy);
    gl.uniform1f(U.fr, fT >= 0 ? fRad : 1e6);
    gl.uniform1f(U.band, F_BAND);
    gl.uniform1f(U.cell, 7);
    gl.activeTexture(gl.TEXTURE1);
    if (fU) gl.bindTexture(gl.TEXTURE_2D, fU.t);
    gl.activeTexture(gl.TEXTURE2);
    const over = fT >= 0 ? fO : fU;
    if (over) gl.bindTexture(gl.TEXTURE_2D, over.t);
    gl.activeTexture(gl.TEXTURE0);
    const seen = new Set<number>();
    for (let c = 0; c < cols; c++) {
      buildPath(c, listRect.top, anchorY);
      // canvas に入る範囲の作品を描く(画面の上下に、少し余分に)。
      const r0 = Math.max(0, Math.floor(lamAtY(-CM + 24) / rowH));
      const r1 = Math.min(R - 1, Math.floor(lamAtY(vh + CM - 24) / rowH));
      for (let r = r0; r <= r1; r++) {
        const idx = r * cols + c;
        if (idx >= n) break;
        drawCell(idx, r, c, listRect.top);
        seen.add(idx);
      }
    }
    // canvas の外へ出た作品は、もとの写真と線に戻す。
    dirty.forEach((idx) => {
      if (!seen.has(idx)) restCell(idx);
    });
    dirty.clear();
    seen.forEach((idx) => dirty.add(idx));
    showCanvas(true);
  }

  // ---------- 入力と動き
  let raf = 0;
  let lastT = 0;
  let gapN = 0; // 動き始めてからのコマ数
  let gapAvg = 16; // コマの間隔(ms)の、ならした値
  let penX = 0; // 指 / カーソル(画面の中)
  let penY = -1;
  let pyS = -1; // ならした高さ(入力の届く間隔のムラを、そのまま見せない)
  let gc = 0; // つかんでいるテープ
  let touching = false;
  let grab = 0; // つかんだ瞬間の、そこの横ずれ
  let startX = 0;
  let target = 0; // 指の下を、いま置きたい横ずれ
  let tS = 0; // ならした target
  let prevTS = 0;
  let holdUntil = 0; // トラックパッドとマウスは、横に動かしているあいだ(と、その直後)だけ、持っている扱い
  let lastMX: number | null = null;
  let lastNudge = 0;
  let tvx = 0; // 指の速さ(px/秒)
  let tvy = 0;
  let lastTX = 0;
  let lastTY = 0;
  let lastTT = 0;
  // 指を離したあと、線は勢いで少し先まで伸びる(見えないペンが、離したときの速さで進み、すぐ弱まる)。
  const GHOST = 0.3;
  let ghost = 0; // 残り時間(秒)
  let gy = 0;
  let gvx = 0;
  let gvy = 0;
  let anchorY = -1;
  const GAIN_TOUCH = 1.3;
  const GAIN_WHEEL = 0.9;
  const GAIN_MOUSE = 0.6;
  const dbg = window as unknown as Dbg;

  // 画面の位置 (x, y) に、いちばん近いテープ。
  function colAt(x: number, y: number) {
    const { cols, cw, g } = G!;
    const left = list.getBoundingClientRect().left;
    const lim = limOf(cw);
    let best = 0;
    let bd = Infinity;
    for (let c = 0; c < cols; c++) {
      const d = Math.abs(left + c * (cw + g) + cw / 2 + lim * Math.tanh(fieldAt(c, y) / lim) - x);
      if (d < bd) {
        bd = d;
        best = c;
      }
    }
    return best;
  }

  function tick(t: number) {
    raf = 0;
    if (!G || !G.n) return;
    const t0 = performance.now();
    // 遅い機械への備え: 動かし始めてから コマの間隔が長いまま(1秒に 18 コマ未満)なら、動かすのをやめて、ふつうの升目に戻す。
    // (GPU が使えず、WebGL が CPU で描かれる環境。カクカク動くより、動かないほうがよい)
    gapN++;
    if (gapN > 2) gapAvg += (t - lastT - gapAvg) * 0.15;
    if (gapN > 14 && gapAvg > 55 && !dbg.__tapeKeep && !dbg.__tapeSlow && !dbg.__tapeForce) {
      glFail = true;
      for (let c = 0; c < G.cols; c++) {
        FX[c].fill(0);
        FV[c].fill(0);
      }
      root.dataset.amp = '0';
      root.dataset.tape = 'off'; // 確認用
      dirty.forEach(restCell);
      dirty.clear();
      showCanvas(false);
      return;
    }
    // 確認用: window.__tapeSlow に数を入れると、その倍だけ ゆっくり動く(連続写真を撮るため)。
    const dt = Math.min(0.05, Math.max(0.001, (t - lastT) / 1000)) / (dbg.__tapeSlow || 1);
    lastT = t;
    ensureField();
    const rect = list.getBoundingClientRect();
    const { cols, cw, g } = G;
    const lim = limOf(cw);
    const maxT = lim * 1.7;
    if (penY < 0) penY = vh * 0.5;
    if (pyS < 0) pyS = penY;
    if (anchorY < 0) anchorY = penY;
    const ease = 1 - Math.exp(-dt / 0.028);
    pyS += (penY - pyS) * ease;
    // いま持っている点
    let hold = 0;
    let hy = pyS;
    if (touching) hold = 1;
    else if (ghost > 0) {
      const k = Math.exp(-dt / 0.13);
      gy += gvy * dt;
      target = Math.max(-maxT, Math.min(maxT, target + gvx * GAIN_TOUCH * dt));
      gvx *= k;
      gvy *= k;
      hold = Math.max(0, ghost / GHOST) ** 1.5;
      hy = gy;
      ghost -= dt;
    } else if (performance.now() < holdUntil) hold = 1;
    tS += (target - tS) * ease;
    const vT = (tS - prevTS) / dt;
    // 場を進める
    const k0 = OMEGA * OMEGA;
    const sub = Math.max(1, Math.ceil((OMEGA * 1.1 * LSP * dt) / (0.5 * HS)));
    const h = dt / sub;
    const e2 = ETA / (HS * HS);
    const gmin = g * 0.45; // これより近づいたら、ぶつかっている
    let maxV = 0;
    let maxX = 0;
    for (let s = 0; s < sub; s++) {
      if (hold > 0) push(gc, hy, prevTS + ((tS - prevTS) * (s + 1)) / sub - fieldAt(gc, hy), vT, hold);
      for (let c = 0; c < cols; c++) {
        const X = FX[c];
        const V = FV[c];
        // テープごとに、ばねの速さを少し変える(戻り方がそろわないように)。
        const om = 1 + 0.09 * Math.sin(c * 2.4 + 0.5);
        const kk = k0 * om * om;
        const cc = 2 * ZETA * OMEGA * om;
        const k2 = (kk * LSP * LSP) / (HS * HS);
        let xm = X[0];
        let vm = V[0];
        for (let i = 0; i < fN; i++) {
          const ip = i + 1 < fN ? i + 1 : i;
          const xi = X[i];
          const vi = V[i];
          V[i] = vi + (k2 * (xm - 2 * xi + X[ip]) + e2 * (vm - 2 * vi + V[ip]) - cc * vi - kk * xi) * h;
          xm = xi;
          vm = vi;
        }
      }
      // となりどうしが ぶつかったら、押し合う。
      for (let c = 0; c + 1 < cols; c++) {
        const Xa = FX[c];
        const Xb = FX[c + 1];
        const Va = FV[c];
        const Vb = FV[c + 1];
        for (let i = 0; i < fN; i++) {
          if (Xa[i] - Xb[i] <= g - gmin) continue; // 離れている
          const sep = g + lim * Math.tanh(Xb[i] / lim) - lim * Math.tanh(Xa[i] / lim);
          if (sep >= gmin) continue;
          const rel = Vb[i] - Va[i];
          const f = (KC * (gmin - sep) - (rel < 0 ? 16 * rel : 0)) * h;
          Vb[i] += f;
          Va[i] -= f;
        }
      }
      maxV = 0;
      maxX = 0;
      for (let c = 0; c < cols; c++) {
        const X = FX[c];
        const V = FV[c];
        for (let i = 0; i < fN; i++) {
          X[i] += V[i] * h;
          const av = V[i] < 0 ? -V[i] : V[i];
          const ax = X[i] < 0 ? -X[i] : X[i];
          if (av > maxV) maxV = av;
          if (ax > maxX) maxX = ax;
        }
      }
    }
    prevTS = tS;
    // 引いた量に応じて、階段の音。
    if (hold > 0) sfx.climb(Math.abs(fieldAt(gc, hy)) / lim);
    // 絵の波を進める。
    if (fT >= 0) {
      fT += dt;
      const u = Math.min(1, fT / F_DUR);
      const rMax = Math.hypot(Math.max(fcx, document.documentElement.clientWidth - fcx), Math.max(fcy, vh - fcy)) + F_BAND;
      fRad = rMax * (1 - Math.pow(1 - u, 3)) - F_BAND * 0.5 * (1 - u);
      if (u >= 1) {
        fU = fO;
        fUidx = fOidx;
        fO = null;
        fOidx = -1;
        fT = -1;
      }
    }
    // テープを たぐる 中心は、指のある高さ(指の下の作品は、指についてくる)。
    if (touching) anchorY = pyS;
    else if (ghost <= 0) anchorY += (pyS - anchorY) * (1 - Math.exp(-dt / 0.12));
    root.dataset.amp = fieldAt(gc, hy).toFixed(1); // 確認用
    if (hold <= 0 && maxV < 1 && maxX < 0.15 && !dbg.__tapeForce && !focusOn()) {
      // 静まった。まっすぐに戻して、止める。
      for (let c = 0; c < cols; c++) {
        FX[c].fill(0);
        FV[c].fill(0);
      }
      root.dataset.amp = '0';
      dirty.forEach(restCell);
      dirty.clear();
      showCanvas(false);
      return;
    }
    drawAll(rect, anchorY);
    root.dataset.ms = (performance.now() - t0).toFixed(1); // 確認用: 1コマの計算と描画の指示にかかった時間
    raf = requestAnimationFrame(tick);
  }
  function kick() {
    if (raf || !G || !animate || glFail) return;
    lastT = performance.now() - 16;
    gapN = 0;
    gapAvg = 16;
    raf = requestAnimationFrame(tick);
  }
  // つかみ直す: 触れた点を、いまある位置から。
  function regrab(x: number, y: number) {
    ensureField();
    gc = colAt(x, y);
    grab = fieldAt(gc, y);
    target = tS = prevTS = grab;
    pyS = y;
    ghost = 0;
    sfx.pluck(gc); // つかんだテープの音
  }
  // トラックパッドとマウス: 横に d だけ動かした。カーソルの下のテープを、そのぶん引く。
  // leak: マウスは、ゆっくり動かすあいだは ほとんど引かない(作品を押そうとして狙うとき、的が逃げないように)。速く払うと、大きく引く。
  function nudge(d: number, leak: boolean) {
    if (!G) return;
    const now = performance.now();
    // 持っていなければ、つかむ。カーソルが となりのテープへ移ったら、そちらへ持ち替える(横へ払うと、1本ずつ順に はじく)。
    if (now >= holdUntil || ghost > 0 || colAt(penX, penY) !== gc) regrab(penX, penY);
    if (leak) target *= Math.exp(-Math.min(0.2, (now - lastNudge) / 1000) / 0.16);
    lastNudge = now;
    const m = limOf(G.cw) * (leak ? 0.75 : 1.7);
    target = Math.max(-m, Math.min(m, target + d));
    holdUntil = now + 130; // 動かすのをやめたら、すぐ離す
    kick();
  }
  function onMouse(e: MouseEvent) {
    const d = lastMX === null ? 0 : (e.clientX - lastMX) * GAIN_MOUSE;
    lastMX = e.clientX;
    if (touching) return;
    penX = e.clientX;
    penY = e.clientY;
    if (d) nudge(d, true);
  }
  function onWheel(e: WheelEvent) {
    if (e.ctrlKey || touching) return;
    penX = e.clientX;
    penY = e.clientY;
    // 2本指を右へ動かすと deltaX は負(標準の設定)。指の向きにテープが動くようにする。
    if (e.deltaX) nudge(-e.deltaX * (e.deltaMode === 1 ? 16 : 1) * GAIN_WHEEL, false);
  }
  function onTouch(e: TouchEvent) {
    if (!G) return;
    const now = performance.now();
    if (!e.touches.length) {
      if (!touching) return;
      touching = false;
      // 離した。線は、そのときの勢いで少し伸びる。
      if (Math.hypot(tvx, tvy) > 120 && now - lastTT < 80) {
        ghost = GHOST;
        gy = pyS;
        gvx = tvx;
        gvy = tvy;
      }
      kick();
      return;
    }
    const tc = e.touches[0];
    penX = tc.clientX;
    penY = tc.clientY;
    if (e.type === 'touchstart' || !touching) {
      touching = true;
      holdUntil = 0;
      startX = tc.clientX;
      regrab(penX, penY);
      tvx = tvy = 0;
    } else {
      const dt = Math.max(0.004, (now - lastTT) / 1000);
      tvx += ((tc.clientX - lastTX) / dt - tvx) * 0.4;
      tvy += ((tc.clientY - lastTY) / dt - tvy) * 0.4;
      const m = limOf(G.cw) * 1.7;
      target = Math.max(-m, Math.min(m, grab + (tc.clientX - startX) * GAIN_TOUCH));
    }
    lastTX = tc.clientX;
    lastTY = tc.clientY;
    lastTT = now;
    kick();
  }

  // ---------- 音
  const sfx = makeSfx();
  // 作品に触れると絵が広がる版かどうか(/lab/cells-strip/)。そうでなければ、名前の枠も音のボタンも出さない。
  const spread = root.dataset.spread !== undefined;

  // ---------- 触れた作品の名前(左下)と、音の切り替え(右下)。見た目は仮。
  const mk = (tag: string, css: string) => {
    const e = document.createElement(tag);
    e.style.cssText = css;
    return e;
  };
  const FRAME = 'position:fixed;z-index:6;box-sizing:border-box;border:1px solid var(--fg);background:#000;color:var(--fg);font:inherit;';
  const label = mk('a', `${FRAME}left:var(--pad);bottom:1.1rem;display:none;max-width:min(calc(100vw - var(--pad)*2 - 6.2rem),26rem);padding:.6rem .75rem .65rem;text-decoration:none;`) as HTMLAnchorElement;
  const lbT = mk('span', 'display:block;font-size:.9rem;line-height:1.4;');
  const lbM = mk('span', 'display:block;margin-top:.2rem;font-size:.66rem;letter-spacing:.06em;color:var(--muted);');
  label.append(lbT, lbM);
  const snd = mk('button', `${FRAME}right:var(--pad);bottom:1.1rem;padding:.5rem .7rem;font-size:.66rem;letter-spacing:.08em;cursor:pointer;border-radius:0;`) as HTMLButtonElement;
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
  if (animate && spread) root.append(label, snd);
  function showLabel(idx: number) {
    const el = idx >= 0 ? cls[idx] : null;
    const li = idx >= 0 && G ? G.rows[idx] : null;
    if (!el || !li) {
      label.style.display = 'none';
      return;
    }
    lbT.textContent = li.dataset.title || '';
    lbM.textContent = `${li.querySelector('.cl-meta')?.textContent?.trim() || ''}  —  Open`;
    label.href = (el.f as HTMLAnchorElement | null)?.href || '#';
    label.style.display = 'block';
  }

  // マウス: 作品の上で少し止まると、その絵が広がる。一覧の外へ出ると、戻る。
  // 指: 1回目のタップで絵が広がり、同じ作品をもう1回(または左下の名前を)押すと、作品のページへ行く。
  let ptr = 'mouse';
  let dwell = 0;
  const rowOf = (t: EventTarget | null) => (t instanceof Element ? t.closest<HTMLElement>('[data-row]') : null);
  function onOver(e: PointerEvent) {
    if (e.pointerType !== 'mouse' || !G) return;
    const li = rowOf(e.target);
    clearTimeout(dwell);
    const idx = li ? G.rows.indexOf(li) : -1;
    const x = e.clientX;
    const y = e.clientY;
    dwell = window.setTimeout(() => focus(idx, x, y), idx >= 0 ? 170 : 260);
  }
  function onLeave(e: PointerEvent) {
    if (e.pointerType !== 'mouse') return;
    clearTimeout(dwell);
    const x = e.clientX;
    const y = e.clientY;
    dwell = window.setTimeout(() => focus(-1, x, y), 260);
  }
  function onDown(e: PointerEvent) {
    ptr = e.pointerType;
  }
  function onClickCap(e: MouseEvent) {
    if (ptr === 'mouse' || !G || glFail) return;
    const t = e.target as Element | null;
    if (t && (label.contains(t) || snd.contains(t))) return;
    const li = rowOf(t);
    if (!li) {
      if (focusOn()) focus(-1, e.clientX, e.clientY);
      return;
    }
    const idx = G.rows.indexOf(li);
    if (idx >= 0 && idx !== focusIdx()) {
      e.preventDefault();
      e.stopPropagation();
      focus(idx, e.clientX, e.clientY);
    }
  }
  function onKeyEsc(e: KeyboardEvent) {
    if (e.key === 'Escape' && focusOn()) focus(-1, window.innerWidth / 2, window.innerHeight / 2);
  }

  const html = document.documentElement;
  const prevOver = html.style.overscrollBehaviorX;
  if (animate) {
    html.style.overscrollBehaviorX = 'none'; // 横へ指を動かしても、前のページへ戻らないようにする
    window.addEventListener('mousemove', onMouse, { passive: true });
    window.addEventListener('wheel', onWheel, { passive: true });
    window.addEventListener('touchstart', onTouch, { passive: true });
    window.addEventListener('touchmove', onTouch, { passive: true });
    window.addEventListener('touchend', onTouch, { passive: true });
    window.addEventListener('touchcancel', onTouch, { passive: true });
    if (spread) {
      list.addEventListener('pointerover', onOver);
      list.addEventListener('pointerleave', onLeave);
      window.addEventListener('pointerdown', onDown, { passive: true });
      document.addEventListener('click', onClickCap, true);
      document.addEventListener('keydown', onKeyEsc);
    }
  }

  return {
    // 並びや幅が変わったとき。線の入れ物を用意して、まっすぐに描く。
    layout(grid: TapeGrid) {
      // 寸法も並びも同じなら、何もしない(スマホは、送るたびに画面の高さが変わって、ここを通る。動きを止めない)。
      if (
        G &&
        G.n === grid.n &&
        G.cols === grid.cols &&
        Math.abs(G.cw - grid.cw) < 0.01 &&
        Math.abs(G.rowH - grid.rowH) < 0.01 &&
        G.rows.every((r, i) => r === grid.rows[i])
      )
        return;
      for (let i = 0; i < cls.length; i++) restCell(i); // 前の並びで動かしていたものを、戻しておく
      showCanvas(false);
      root.dataset.amp = '0';
      G = grid;
      SIG = Math.max(27, grid.cw * 0.17);
      LSP = Math.max(86, grid.cw * 0.42);
      cancelAnimationFrame(raf);
      raf = 0;
      FX = [];
      FV = [];
      ensureField();
      ghost = 0;
      holdUntil = 0;
      touching = false;
      fU = fO = null;
      fUidx = fOidx = -1;
      fT = -1;
      label.style.display = 'none';
      dirty.clear();
      const { cw, ph, rowH } = grid;
      const f1 = (v: number) => v.toFixed(1);
      cls = grid.rows.map((li) => {
        let o = li.querySelector<SVGSVGElement>('svg[data-tape]');
        if (!o) {
          o = document.createElementNS(SVGNS, 'svg') as SVGSVGElement;
          o.setAttribute('data-tape', '');
          o.setAttribute('aria-hidden', 'true');
          o.style.cssText = 'position:absolute;left:0;top:0;width:1px;height:1px;overflow:visible;pointer-events:none;z-index:1';
          const p = document.createElementNS(SVGNS, 'path');
          p.style.cssText = 'fill:none;stroke:var(--fg);stroke-width:1px';
          o.appendChild(p);
          li.appendChild(o);
        }
        // 止まっているあいだの線(まっすぐな枠)。
        o.querySelector('path')!.setAttribute(
          'd',
          `M0 0L${f1(cw)} 0L${f1(cw)} ${f1(rowH)}L0 ${f1(rowH)}ZM0 ${f1(ph)}L${f1(cw)} ${f1(ph)}`
        );
        return {
          f: li.querySelector<HTMLElement>('[data-face]'),
          img: li.querySelector<HTMLImageElement>('[data-face] img'),
          tx: li.querySelector<HTMLElement>('.cl-text'),
          o,
          hid: false,
          cov: false,
        };
      });
      for (let i = 0; i < cls.length; i++) restCell(i);
      if (animate) {
        warmAt = 0;
        clearTimeout(warmId);
        warmId = window.setTimeout(warm, 300);
      }
      if (dbg.__tapeForce) kick();
    },
    dispose() {
      cancelAnimationFrame(raf);
      html.style.overscrollBehaviorX = prevOver;
      window.removeEventListener('mousemove', onMouse);
      window.removeEventListener('wheel', onWheel);
      window.removeEventListener('touchstart', onTouch);
      window.removeEventListener('touchmove', onTouch);
      window.removeEventListener('touchend', onTouch);
      window.removeEventListener('touchcancel', onTouch);
      list.removeEventListener('pointerover', onOver);
      list.removeEventListener('pointerleave', onLeave);
      window.removeEventListener('pointerdown', onDown);
      document.removeEventListener('click', onClickCap, true);
      document.removeEventListener('keydown', onKeyEsc);
      clearTimeout(dwell);
      label.remove();
      snd.remove();
      sfx.dispose();
      for (let i = 0; i < cls.length; i++) restCell(i);
      clearTimeout(warmId);
      cv?.remove();
    },
  };
}
