// 表面を突破する(/lab/depth/)。
//
// なぞった線は「切り口」になる。切った長さがその面の張りを超えると、切れ目が縁まで走って面が割れ、
// 割れた面は落ち、視点は次の層へ潜る。奥ほど「作る前」に戻る:
//   L0 写真の紙(継ぎ目から、いちばん奥の一覧の光が漏れる)
//   L1 物の厚み(切ると帯がめくれて巻き、写真の筒になる)
//   L2 光(ガラス。切った線はガラスの棒になる。割れると、破片ごと空間へ落ちる)
//   V3 設計の線(機材の稜線が、次の機材へ形を移す。床は一覧の裏)
//   F  一覧(床が裏返ると、Works の一覧そのものになる)
// 通り過ぎた層は、画面の上の端に紙の束の小口として畳まれる。
// 触らないあいだは、自動のペンが切る。

import * as T from 'three';

type V2 = { x: number; y: number };

const FOV = 40;
const HC = 1 / Math.tan(((FOV / 2) * Math.PI) / 180); // この距離で、画面の高さ = 2
const D = 0.8; // 層の間隔
const DV = 2.6; // ガラスから床までの空間
const TILT = 0.22; // 真上から少しだけ倒す(ラジアン)
const A28 = (28 * Math.PI) / 180;
const DIR28 = { x: Math.sin(A28), y: -Math.cos(A28) }; // 落ちて滑る向き
const LIGHT = new T.Vector3(-0.35, 0.55, 0.76).normalize();
const OBJS = ['red', 'camera01', 'mbp', 'television02', 'vr50', 'vintagevideocamera', 'a7m4', 'classiclaptop', 'genelec', 'filmstripprojector8mm', 'panton', 'plasticmonoblocchair01', 'eames'];
const NSEG = 40000;

const clamp = (v: number, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
const sstep = (a: number, b: number, v: number) => {
  const t = clamp((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const eio = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------- GLSL の共通部品
const GLASS = /* glsl */ `
vec3 seeThrough(sampler2D s, vec2 uv, vec2 off) {
  return vec3(texture2D(s, uv + off).r, texture2D(s, uv + off * 1.22).g, texture2D(s, uv + off * 1.46).b);
}
`;

// ---------------------------------------------------------------- 切り口
type Kind = 'photo' | 'board' | 'glass' | 'floor';
type Cut = {
  xs: number[];
  ys: number[];
  ss: number[];
  bs: number[];
  len: number;
  w: number; // ひらく幅の半分(最大)
  crack: boolean;
  t0: number; // ひびが走り始めた時刻
  dur: number;
  heal: number;
  strip?: { update(len: number): void; push(x: number, y: number, s: number, b: number, tx: number, ty: number): void };
  rod?: { update(len: number): void; push(x: number, y: number, s: number, b: number, tx: number, ty: number): void };
};

const newCut = (w: number, crack = false): Cut => ({ xs: [], ys: [], ss: [], bs: [], len: 0, w, crack, t0: 0, dur: 0, heal: 1 });
const lens = (u: number) => Math.pow(Math.max(0, Math.sin(Math.PI * clamp(u))), 0.5);

export function mountDepth(root: HTMLElement, onDone: () => void): () => void {
  const canvas = root.querySelector<HTMLCanvasElement>('[data-canvas]')!;
  const edgeEl = root.querySelector<HTMLElement>('[data-edge]')!;
  const land = document.querySelector<HTMLElement>('[data-land]')!;
  const base = root.dataset.base || '';
  const qs = new URLSearchParams(location.search);

  const renderer = new T.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  const DPR = Math.min(window.devicePixelRatio || 1, 2);
  renderer.setPixelRatio(DPR);
  renderer.setClearColor(0x000000, 1);
  let W = root.clientWidth || innerWidth;
  let H = root.clientHeight || innerHeight;
  renderer.setSize(W, H, false);
  const aspect = W / H;
  const VW = 2 * aspect;
  const VH = 2;
  const SW = VW * 1.5 + 0.3;
  const SH = VH * 1.35;
  const camera = new T.PerspectiveCamera(FOV, aspect, 0.01, 60);
  const scene = new T.Scene();
  const res = new T.Vector2(W * DPR, H * DPR);

  // 下の空間(V3)を写す板。ガラスが屈折で覗く。
  const rtScene = new T.WebGLRenderTarget(Math.round(W * DPR * 0.75), Math.round(H * DPR * 0.75), {
    depthBuffer: true,
  });

  // ---------------------------------------------------------------- 時計(確認用に止められる)
  let now = 0;
  let frozen = false;
  let autoOn = !qs.has('noauto');
  let last = performance.now();

  // ---------------------------------------------------------------- 素材(写真)
  const picEls = [...root.querySelectorAll<HTMLElement>('[data-pic]')];
  const pics: { img: HTMLImageElement; r: number; tex?: T.Texture; col?: [number, number, number] }[] = picEls.map((el) => {
    const img = new Image();
    img.decoding = 'async';
    img.src = el.dataset.pic!;
    return { img, r: parseFloat(el.dataset.r || '1.5') };
  });
  const loaded = Promise.all(pics.map((p) => p.img.decode().catch(() => undefined)));

  const blank = new T.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1);
  blank.needsUpdate = true;

  // L0 の紙: 作品の写真を、継ぎ目を残して敷き詰める(継ぎ目は透明=光が漏れる所)。
  const photoCv = document.createElement('canvas');
  photoCv.width = 1200;
  photoCv.height = Math.round((1200 * SH) / SW);
  const photoTex = new T.CanvasTexture(photoCv);
  photoTex.anisotropy = 4;
  const paintPhoto = (cv = photoCv, tex: T.Texture = photoTex, seed = 7, rmin = 150, rspan = 120) => {
    const g = cv.getContext('2d')!;
    const cw = cv.width;
    const ch = cv.height;
    g.clearRect(0, 0, cw, ch);
    const R = rng(seed);
    const order = pics.filter((p) => p.img.naturalWidth > 0).sort(() => R() - 0.5);
    if (!order.length) return;
    const seam = 4;
    let y = 0;
    let k = 0;
    while (y < ch) {
      const rh = Math.round(rmin + R() * rspan);
      let x = -Math.round(R() * 120);
      while (x < cw) {
        const p = order[k++ % order.length];
        const pw = Math.round(rh * Math.min(1.8, Math.max(0.7, p.r)));
        cover(g, p.img, x, y, pw - seam, rh - seam);
        x += pw;
      }
      y += rh;
    }
    tex.needsUpdate = true;
  };
  const cover = (g: CanvasRenderingContext2D, img: HTMLImageElement, x: number, y: number, w: number, h: number) => {
    const iw = img.naturalWidth;
    const ih = img.naturalHeight;
    if (!iw || !ih) return;
    const s = Math.max(w / iw, h / ih);
    const sw = w / s;
    const sh = h / s;
    g.drawImage(img, (iw - sw) / 2, (ih - sh) / 2, sw, sh, x, y, w, h);
  };

  // L1 の板: 黒い紙の重なり。表は紙の繊維、断面は重ねた写真の色の縞。
  const boardCv = document.createElement('canvas');
  boardCv.width = boardCv.height = 256;
  {
    const g = boardCv.getContext('2d')!;
    const d = g.createImageData(256, 256);
    const R = rng(3);
    for (let i = 0; i < 256 * 256; i++) {
      const v = 70 + R() * 22;
      d.data[i * 4] = v;
      d.data[i * 4 + 1] = v * 0.96;
      d.data[i * 4 + 2] = v * 0.9;
      d.data[i * 4 + 3] = 255;
    }
    g.putImageData(d, 0, 0);
    g.globalAlpha = 0.12;
    for (let i = 0; i < 160; i++) {
      g.strokeStyle = R() < 0.5 ? '#000' : '#fff';
      g.beginPath();
      const x = R() * 256;
      const y = R() * 256;
      g.moveTo(x, y);
      g.lineTo(x + (R() - 0.5) * 40, y + (R() - 0.5) * 10);
      g.stroke();
    }
  }
  const boardTex = new T.CanvasTexture(boardCv);
  boardTex.wrapS = boardTex.wrapT = T.RepeatWrapping;
  const strataData = new Uint8Array(64 * 4);
  const strataTex = new T.DataTexture(strataData, 64, 1);
  const paintStrata = () => {
    const sc = document.createElement('canvas');
    sc.width = sc.height = 1;
    const g = sc.getContext('2d', { willReadFrequently: true })!;
    pics.forEach((p) => {
      if (!p.img.naturalWidth) return;
      g.drawImage(p.img, 0, 0, 1, 1);
      const c = g.getImageData(0, 0, 1, 1).data;
      p.col = [c[0], c[1], c[2]];
    });
    const cols = pics.filter((p) => p.col).map((p) => p.col!);
    const R = rng(11);
    for (let i = 0; i < 64; i++) {
      const gap = i % 3 === 2;
      const c = cols.length ? cols[Math.floor(R() * cols.length)] : [200, 200, 200];
      const k = gap ? 0.12 : 1.15;
      strataData[i * 4] = Math.min(255, c[0] * k);
      strataData[i * 4 + 1] = Math.min(255, c[1] * k);
      strataData[i * 4 + 2] = Math.min(255, c[2] * k);
      strataData[i * 4 + 3] = 255;
    }
    strataTex.needsUpdate = true;
  };
  const picTex = (i: number) => {
    const p = pics[((i % pics.length) + pics.length) % pics.length];
    if (!p.tex) {
      p.tex = new T.Texture(p.img);
      p.tex.wrapS = T.RepeatWrapping;
      p.tex.needsUpdate = p.img.naturalWidth > 0;
    }
    return p.tex;
  };

  // ---------------------------------------------------------------- 一覧の写し(結末の絵合わせ用)
  const snapCv = document.createElement('canvas');
  const snapTex = new T.CanvasTexture(snapCv);
  const backCv = document.createElement('canvas');
  const backTex = new T.CanvasTexture(backCv);
  const snapshot = () => {
    snapCv.width = Math.round(W * DPR);
    snapCv.height = Math.round(H * DPR);
    backCv.width = Math.round(W);
    backCv.height = Math.round(H);
    const g = snapCv.getContext('2d')!;
    const b = backCv.getContext('2d')!;
    g.setTransform(DPR, 0, 0, DPR, 0, 0);
    const bodyBg = getComputedStyle(document.body).backgroundColor || '#000';
    g.fillStyle = bodyBg;
    g.fillRect(0, 0, W, H);
    b.fillStyle = '#060606';
    b.fillRect(0, 0, W, H);
    const inView = (r: DOMRect) => r.bottom > 0 && r.top < H && r.right > 0 && r.left < W && r.width > 0 && r.height > 0;
    land.querySelectorAll<HTMLElement>('*').forEach((el) => {
      const r = el.getBoundingClientRect();
      if (!inView(r)) return;
      const cs = getComputedStyle(el);
      const rad = parseFloat(cs.borderTopLeftRadius) || 0;
      const bg = cs.backgroundColor;
      if (bg && bg !== 'transparent' && !bg.startsWith('rgba(0, 0, 0, 0)')) {
        g.fillStyle = bg;
        g.beginPath();
        g.roundRect(r.left, r.top, r.width, r.height, rad);
        g.fill();
      }
      const bw = parseFloat(cs.borderTopWidth) || 0;
      if (bw > 0 && cs.borderTopStyle !== 'none') {
        g.strokeStyle = cs.borderTopColor;
        g.lineWidth = bw;
        g.beginPath();
        g.roundRect(r.left + bw / 2, r.top + bw / 2, r.width - bw, r.height - bw, rad);
        g.stroke();
      }
      if (el instanceof HTMLImageElement && el.naturalWidth) {
        g.save();
        g.beginPath();
        const pr = el.parentElement!.getBoundingClientRect();
        const prad = parseFloat(getComputedStyle(el.parentElement!).borderTopLeftRadius) || 0;
        g.roundRect(pr.left, pr.top, pr.width, pr.height, prad);
        g.clip();
        cover(g, el, r.left, r.top, r.width, r.height);
        g.restore();
      }
      // 床の裏: 一覧の区切りの所が、継ぎ目(光の漏れる所)になる。
      if (el.classList.contains('thumb') || el.classList.contains('chip') || el.classList.contains('page-title')) {
        b.clearRect(r.left - 1, r.top - 1, r.width + 2, 1.5);
        b.clearRect(r.left - 1, r.bottom - 0.5, r.width + 2, 1.5);
        b.clearRect(r.left - 1, r.top - 1, 1.5, r.height + 2);
        b.clearRect(r.right - 0.5, r.top - 1, 1.5, r.height + 2);
      }
    });
    // 文字: 1字ずつ、置かれている場所に描く。
    const walker = document.createTreeWalker(land, NodeFilter.SHOW_TEXT);
    const range = document.createRange();
    g.textBaseline = 'alphabetic';
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const txt = n.textContent || '';
      const pe = n.parentElement!;
      if (!txt.trim() || pe.closest('[hidden]')) continue;
      const cs = getComputedStyle(pe);
      if (cs.visibility === 'collapse') continue;
      const fs = parseFloat(cs.fontSize);
      g.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
      g.fillStyle = cs.color;
      const up = cs.textTransform === 'uppercase';
      for (let i = 0; i < txt.length; i++) {
        const ch = txt[i];
        if (/\s/.test(ch)) continue;
        range.setStart(n, i);
        range.setEnd(n, i + 1);
        const r = range.getBoundingClientRect();
        if (!inView(r)) continue;
        const m = g.measureText(up ? ch.toUpperCase() : ch);
        const asc = m.fontBoundingBoxAscent ?? fs * 0.8;
        const desc = m.fontBoundingBoxDescent ?? fs * 0.2;
        const y = r.top + (r.height - (asc + desc)) / 2 + asc;
        g.fillText(up ? ch.toUpperCase() : ch, r.left, y);
      }
    }
    snapTex.needsUpdate = true;
    backTex.needsUpdate = true;
  };

  // ---------------------------------------------------------------- 面(切れる紙・板・床)
  const maskMat = (px: number, sag: number) =>
    new T.ShaderMaterial({
      uniforms: { uPx: { value: px }, uSag: { value: sag } },
      vertexShader: /* glsl */ `
        attribute float aD; attribute float aHW;
        varying float vD; varying float vHW;
        void main(){ vD = aD; vHW = aHW; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform float uPx; uniform float uSag;
        varying float vD; varying float vHW;
        void main(){
          float d = abs(vD);
          float r = clamp(0.5 + (vHW - d) / (3.0 * uPx), 0.0, 1.0);
          float g = clamp(1.0 - (d - vHW) / uSag, 0.0, 1.0);
          gl_FragColor = vec4(r, g, 0.0, 1.0);
        }`,
      blending: T.CustomBlending,
      blendEquation: T.MaxEquation,
      blendSrc: T.OneFactor,
      blendDst: T.OneFactor,
      depthTest: false,
      depthWrite: false,
      side: T.DoubleSide,
    });

  const SURF = /* glsl */ `
    uniform sampler2D uMap; uniform sampler2D uMask; uniform sampler2D uStrata; uniform sampler2D uSnap; uniform sampler2D uScene;
    uniform vec3 uCamL; uniform vec2 uSize; uniform float uThick; uniform int uKind; uniform float uTime;
    uniform float uGlow; uniform float uRep; uniform float uAlpha; uniform vec2 uRes; uniform vec2 uAxis; uniform float uFront;
    uniform vec3 uLight;
    varying vec2 vUv; varying vec3 vL; varying vec3 vWN;
    ${GLASS}
    vec3 surf(vec2 uv){
      if (uKind == 1) {
        vec3 c = texture2D(uMap, uv * uRep).rgb;
        return c;
      }
      vec4 t = texture2D(uMap, uv);
      vec3 glow = vec3(0.86, 0.93, 1.0) * uGlow;
      return mix(glow, t.rgb, t.a);
    }
    vec3 wall(float k, vec2 uv){
      if (uKind == 0) {
        vec3 core = vec3(0.93, 0.92, 0.89);
        vec3 em = texture2D(uMap, uv).rgb * 0.85;
        vec3 c = k < 0.16 ? em : core;
        return c * (1.0 - 0.5 * k);
      }
      if (uKind == 1) return texture2D(uStrata, vec2(k * 0.98 + 0.01, 0.5)).rgb * (1.0 - 0.55 * k);
      if (uKind == 3) return vec3(0.75, 0.82, 0.9) * (1.0 - 0.3 * k);
      return vec3(0.8, 0.95, 1.0);
    }
  `;
  const sheetVert = /* glsl */ `
    uniform float uTime; uniform float uWave; uniform vec4 uPress[4];
    uniform float uPeel; uniform vec2 uPeelDir; uniform float uPeelR;
    uniform sampler2D uMask; uniform vec2 uSize; uniform float uLift;
    varying vec2 vUv; varying vec3 vL; varying vec3 vWN;
    // 面の高さ: いつも少し波打ち、押すとへこみ、離すと波紋が広がって揺れ戻る。
    float hgt(vec2 p){
      float h = uWave * (sin(p.x * 3.1 + uTime * 0.9) * sin(p.y * 2.3 - uTime * 0.7) * 0.6 + sin((p.x + p.y) * 5.0 - uTime * 1.6) * 0.25);
      // 切り口のまわりは、紙がめくれ上がって、風に揺れる
      vec4 mk = texture2D(uMask, p / uSize + 0.5);
      h += mk.g * (1.0 - step(0.5, mk.r)) * uLift * (0.75 + 0.25 * sin(uTime * 3.1 + p.x * 9.0 + p.y * 7.0));
      for (int i = 0; i < 4; i++) {
        vec4 q = uPress[i];
        if (q.z <= 0.0) continue;
        float r = length(p - q.xy);
        if (q.w < 0.0) {
          h -= q.z * exp(-r * r / 0.012);
        } else {
          float t = uTime - q.w;
          h -= q.z * exp(-r * r / 0.012) * exp(-t * 5.0) * cos(t * 16.0);
          float front = smoothstep(0.0, 0.08, t * 0.55 - r);
          h += q.z * 0.55 * sin(r * 42.0 - t * 11.0) * exp(-t * 1.3) * exp(-r * 1.4) * front;
        }
      }
      return h;
    }
    void main(){
      vUv = uv; vL = position;
      vec2 p = position.xy;
      float e = 0.004;
      float h = hgt(p);
      vec3 n = normalize(vec3(-(hgt(p + vec2(e, 0.0)) - hgt(p - vec2(e, 0.0))) / (2.0 * e), -(hgt(p + vec2(0.0, e)) - hgt(p - vec2(0.0, e))) / (2.0 * e), 1.0));
      vec3 q = vec3(p, h);
      // はがす: 折り目の線より先は、筒に巻きながら手前へ返る
      float s = dot(p, uPeelDir) - uPeel;
      if (s > 0.0) {
        float th = s / uPeelR;
        vec2 base = p - uPeelDir * s;
        if (th < 3.14159) {
          q = vec3(base + uPeelDir * uPeelR * sin(th), h + uPeelR * (1.0 - cos(th)));
          n = vec3(-uPeelDir * sin(th), cos(th));
        } else {
          q = vec3(base - uPeelDir * (s - 3.14159 * uPeelR), h + 2.0 * uPeelR + 0.002);
          n = vec3(0.0, 0.0, -1.0);
        }
      }
      vWN = normalize(mat3(modelMatrix) * n);
      gl_Position = projectionMatrix * modelViewMatrix * vec4(q, 1.0);
    }`;
  const sheetFrag = /* glsl */ `
    ${SURF}
    void main(){
      // 床の表(裏返ったあと): 一覧の写し。
      if (uKind == 3 && !gl_FrontFacing) {
        vec2 p = (vUv - 0.5) * uSize;
        vec2 q = vec2(-p.x, p.y); // 28° の軸で裏返し、-56° ねじると、左右だけ入れ替わった位置に収まる
        vec3 c = texture2D(uSnap, q / uSize + 0.5).rgb;
        gl_FragColor = vec4(c * uFront, 1.0);
        return;
      }
      vec4 m = texture2D(uMask, vUv);
      vec3 V = normalize(uCamL - vL);
      vec2 per = (-V.xy / max(V.z, 0.08)) / uSize;
      float fw = max(fwidth(m.r), 1e-3);
      float aH = smoothstep(0.5 - fw, 0.5 + fw, m.r);
      vec3 nw = gl_FrontFacing ? vWN : -vWN;
      float lam = 0.62 + 0.38 * max(dot(nw, uLight), 0.0);
      // 裏(はがれて返った所): 紙は白、板は黒
      if (!gl_FrontFacing) {
        if (aH > 0.5) discard;
        vec3 bk = uKind == 0 ? vec3(0.9, 0.89, 0.86) : vec3(0.1);
        gl_FragColor = vec4(bk * lam, uAlpha);
        return;
      }
      vec3 top = surf(vUv) * lam;
      // 動く光が、紙の波に沿って滑る
      vec3 lm = normalize(vec3(cos(uTime * 0.35) * 0.6, sin(uTime * 0.27) * 0.6, 0.8));
      vec3 hh = normalize(lm + vec3(0.0, -0.2, 1.0));
      float shine = pow(max(dot(nw, hh), 0.0), uKind == 1 ? 18.0 : 70.0) * (uKind == 1 ? 0.06 : 0.28);
      top += shine * (1.0 - aH);
      top *= 1.0 - 0.18 * m.g * m.g;                      // 切れ目のまわりの陰
      top += smoothstep(0.2, 0.5, m.r) * (1.0 - aH) * 0.25; // 切り口の縁は光る
      if (uKind == 0) top *= 1.0 - 0.22 * length((vUv - vec2(0.35, 0.7)) * vec2(1.0, 0.6));
      vec4 under = vec4(0.0);
      if (aH > 0.0) {
        float hit = -1.0;
        for (int i = 1; i <= 12; i++) {
          float t = uThick * float(i) / 12.0;
          if (texture2D(uMask, vUv + per * t).r < 0.5) { hit = t; break; }
        }
        if (hit >= 0.0) under = vec4(wall(hit / uThick, vUv + per * hit), 1.0);
        else if (uKind == 3) under = vec4(vec3(0.85, 0.92, 1.0) * (0.6 + uGlow), 1.0); // 床の切れ目は光
      }
      float a = mix(1.0, under.a, aH);
      vec3 c = (top * (1.0 - aH) + under.rgb * under.a * aH) / max(a, 1e-3);
      if (a < 0.003) discard;
      gl_FragColor = vec4(c, a * uAlpha);
    }`;
  const glassFrag = /* glsl */ `
    ${SURF}
    void main(){
      vec4 m = texture2D(uMask, vUv);
      vec3 V = normalize(uCamL - vL);
      vec2 per = (-V.xy / max(V.z, 0.08)) / uSize;
      float fw = max(fwidth(m.r), 1e-3);
      float aH = smoothstep(0.5 - fw, 0.5 + fw, m.r);
      vec2 suv = gl_FragCoord.xy / uRes;
      // 縦溝のガラス(溝は 28° の向き)。溝の丸みで、下の線がずれて割れて見える。
      vec2 dp = vec2(cos(${A28.toFixed(5)}), sin(${A28.toFixed(5)}));
      float q = dot(vL.xy, dp) * 15.0;
      float f = fract(q) * 2.0 - 1.0;
      float slope = f / sqrt(max(1.0 - f * f, 0.04));
      vec2 off = dp * slope * 0.012 + vec2(0.0, 0.0);
      vec3 c = seeThrough(uScene, suv, off * (1.0 - aH));
      float sp = pow(max(0.0, 1.0 - abs(f + 0.55) * 4.0), 4.0) * 0.35;
      c = c * vec3(0.86, 0.93, 0.95) + sp + vec3(0.02, 0.03, 0.035);
      c *= 1.0 - 0.45 * m.g * m.g;
      if (aH > 0.0) {
        float hit = -1.0;
        for (int i = 1; i <= 10; i++) {
          float t = uThick * float(i) / 10.0;
          if (texture2D(uMask, vUv + per * t).r < 0.5) { hit = t; break; }
        }
        vec3 inner = seeThrough(uScene, suv, vec2(0.0));
        if (hit >= 0.0) {
          float k = hit / uThick;
          vec3 rb = 0.5 + 0.5 * cos(6.2831 * (k * 1.3 + vec3(0.0, 0.33, 0.67)));
          inner = mix(vec3(0.75, 0.95, 0.92), rb, 0.45) * (1.1 - 0.4 * k);
        }
        c = mix(c, inner, aH);
      }
      gl_FragColor = vec4(c, 1.0);
    }`;

  class Sheet {
    kind: Kind;
    w: number;
    h: number;
    thick: number;
    group = new T.Group();
    mesh: T.Mesh;
    mat: T.ShaderMaterial;
    rt: T.WebGLRenderTarget;
    mScene = new T.Scene();
    mCam: T.OrthographicCamera;
    mGeo = new T.BufferGeometry();
    cuts: Cut[] = [];
    fills: V2[][] = [];
    presses: { x: number; y: number; a: number; tr: number }[] = [];
    energy = 0;
    wave0 = 0;
    tension = 0;
    dirty = true;
    gone = false;
    cap = 0;
    pos = new Float32Array(0);
    ad = new Float32Array(0);
    ahw = new Float32Array(0);
    idx = new Uint32Array(0);
    constructor(kind: Kind, z: number, w: number, h: number, thick: number, map: T.Texture, order: number) {
      this.kind = kind;
      this.w = w;
      this.h = h;
      this.thick = thick;
      const MW = kind === 'floor' ? 512 : 720;
      const MH = Math.round((MW * h) / w);
      this.rt = new T.WebGLRenderTarget(MW, MH, { depthBuffer: false, minFilter: T.LinearFilter, magFilter: T.LinearFilter });
      const px = w / MW;
      this.mCam = new T.OrthographicCamera(-w / 2, w / 2, h / 2, -h / 2, -1, 1);
      const mm = new T.Mesh(this.mGeo, maskMat(px, kind === 'board' ? 0.06 : kind === 'glass' ? 0.02 : 0.035));
      mm.frustumCulled = false;
      this.mScene.add(mm);
      this.mat = new T.ShaderMaterial({
        uniforms: {
          uMap: { value: map },
          uMask: { value: this.rt.texture },
          uStrata: { value: strataTex },
          uSnap: { value: snapTex },
          uScene: { value: rtScene.texture },
          uCamL: { value: new T.Vector3() },
          uSize: { value: new T.Vector2(w, h) },
          uThick: { value: thick },
          uKind: { value: kind === 'photo' ? 0 : kind === 'board' ? 1 : kind === 'glass' ? 2 : 3 },
          uTime: { value: 0 },
          uGlow: { value: 0.4 },
          uRep: { value: (w / 0.6) },
          uAlpha: { value: 1 },
          uRes: { value: res },
          uAxis: { value: new T.Vector2(DIR28.x, DIR28.y) },
          uFront: { value: 0.6 },
          uLight: { value: LIGHT },
          uWave: { value: kind === 'photo' ? 0.012 : kind === 'board' ? 0.007 : kind === 'floor' ? 0.006 : 0 },
          uPress: { value: [0, 1, 2, 3].map(() => new T.Vector4()) },
          uPeel: { value: 99 },
          uPeelDir: { value: new T.Vector2(1, 0) },
          uPeelR: { value: 0.11 },
          uLift: { value: kind === 'photo' ? 0.03 : kind === 'floor' ? 0.012 : kind === 'board' ? 0.012 : 0 },
        },
        vertexShader: sheetVert,
        fragmentShader: kind === 'glass' ? glassFrag : sheetFrag,
        transparent: kind !== 'glass',
        side: kind === 'glass' ? T.FrontSide : T.DoubleSide,
      });
      const seg = kind === 'glass' ? 1 : 110;
      this.mesh = new T.Mesh(new T.PlaneGeometry(w, h, seg, Math.round((seg * h) / w)), this.mat);
      this.mesh.frustumCulled = false;
      this.mesh.renderOrder = order;
      this.group.add(this.mesh);
      this.group.position.z = z;
      scene.add(this.group);
    }
    get z() {
      return this.group.position.z;
    }
    clear() {
      renderer.setRenderTarget(this.rt);
      renderer.setClearColor(0x000000, 0);
      renderer.clear();
      renderer.setClearColor(0x000000, 1);
      renderer.setRenderTarget(null);
    }
    hw(c: Cut, i: number) {
      if (c.crack) {
        const vis = c.len * clamp((now - c.t0) / c.dur);
        if (c.ss[i] > vis) return -1;
        return Math.max(0.0012, c.w * clamp((vis - c.ss[i]) / 0.08)) * c.heal;
      }
      const u = c.len > 1e-4 ? c.ss[i] / c.len : 0;
      const age = now - c.bs[i];
      const open = this.kind === 'board' ? sstep(0.08, 0.68, age) : 1 - Math.exp(-age * 5);
      const scale = Math.min(1, c.len / 0.45);
      return Math.max(0.0011, c.w * lens(u) * scale * open) * c.heal;
    }
    // 切れ目の帯を作り直して、面の型(どこが切れているか)に描く。
    paint() {
      let nv = 0;
      for (const c of this.cuts) nv += c.xs.length * 2;
      for (const f of this.fills) nv += f.length + 2;
      if (nv > this.cap || !this.cap) {
        this.cap = Math.max(nv, this.cap * 2, 2048);
        this.pos = new Float32Array(this.cap * 3);
        this.ad = new Float32Array(this.cap);
        this.ahw = new Float32Array(this.cap);
        this.idx = new Uint32Array(this.cap * 3);
        this.mGeo.setAttribute('position', new T.BufferAttribute(this.pos, 3));
        this.mGeo.setAttribute('aD', new T.BufferAttribute(this.ad, 1));
        this.mGeo.setAttribute('aHW', new T.BufferAttribute(this.ahw, 1));
        this.mGeo.setIndex(new T.BufferAttribute(this.idx, 1));
      }
      const sag = this.kind === 'board' ? 0.06 : this.kind === 'glass' ? 0.02 : 0.035;
      let v = 0;
      let k = 0;
      for (const c of this.cuts) {
        const n = c.xs.length;
        if (n < 2) continue;
        const v0 = v;
        for (let i = 0; i < n; i++) {
          const a = Math.max(0, i - 1);
          const b = Math.min(n - 1, i + 1);
          let tx = c.xs[b] - c.xs[a];
          let ty = c.ys[b] - c.ys[a];
          const tl = Math.hypot(tx, ty) || 1;
          tx /= tl;
          ty /= tl;
          let hw = this.hw(c, i);
          const vis = hw >= 0;
          if (!vis) hw = 0;
          const ext = vis ? hw + sag : 0;
          for (let s = 0; s < 2; s++) {
            const sg = s ? 1 : -1;
            this.pos[v * 3] = c.xs[i] - ty * ext * sg;
            this.pos[v * 3 + 1] = c.ys[i] + tx * ext * sg;
            this.pos[v * 3 + 2] = 0;
            this.ad[v] = ext * sg;
            this.ahw[v] = vis ? hw : -1;
            v++;
          }
        }
        for (let i = 0; i < n - 1; i++) {
          const a = v0 + i * 2;
          this.idx[k++] = a;
          this.idx[k++] = a + 1;
          this.idx[k++] = a + 3;
          this.idx[k++] = a;
          this.idx[k++] = a + 3;
          this.idx[k++] = a + 2;
        }
      }
      // くり抜いた所(面ごと穴)
      for (const f of this.fills) {
        if (f.length < 3) continue;
        const v0 = v;
        for (const p of f) {
          this.pos[v * 3] = p.x;
          this.pos[v * 3 + 1] = p.y;
          this.pos[v * 3 + 2] = 0;
          this.ad[v] = 0;
          this.ahw[v] = 1;
          v++;
        }
        const tris = T.ShapeUtils.triangulateShape(f.map((p) => new T.Vector2(p.x, p.y)), []);
        for (const t of tris) {
          this.idx[k++] = v0 + t[0];
          this.idx[k++] = v0 + t[1];
          this.idx[k++] = v0 + t[2];
        }
      }
      (this.mGeo.attributes.position as T.BufferAttribute).needsUpdate = true;
      (this.mGeo.attributes.aD as T.BufferAttribute).needsUpdate = true;
      (this.mGeo.attributes.aHW as T.BufferAttribute).needsUpdate = true;
      this.mGeo.index!.needsUpdate = true;
      this.mGeo.setDrawRange(0, k);
      renderer.setRenderTarget(this.rt);
      renderer.setClearColor(0x000000, 0);
      renderer.clear();
      if (k) renderer.render(this.mScene, this.mCam);
      renderer.setClearColor(0x000000, 1);
      renderer.setRenderTarget(null);
    }
    animating() {
      for (const c of this.cuts) {
        if (c.crack && now - c.t0 < c.dur + 0.1) return true;
        if (!c.crack && c.bs.length && now - c.bs[c.bs.length - 1] < 1.2) return true;
        if (c.heal < 1 && c.heal > 0) return true;
      }
      return false;
    }
    update() {
      const cl = this.mat.uniforms.uCamL.value as T.Vector3;
      cl.copy(camera.position);
      this.mesh.worldToLocal(cl);
      this.mat.uniforms.uTime.value = now;
      if (!this.wave0) this.wave0 = this.mat.uniforms.uWave.value || 1e-6;
      this.energy *= 0.965;
      this.mat.uniforms.uWave.value = this.wave0 * (1 + Math.min(this.energy, 5));
      const pu = this.mat.uniforms.uPress.value as T.Vector4[];
      this.presses = this.presses.filter((q) => q.tr < 0 || now - q.tr < 3.5);
      for (let i = 0; i < 4; i++) {
        const q = this.presses[this.presses.length - 1 - i];
        if (q) pu[i].set(q.x, q.y, q.a, q.tr);
        else pu[i].set(0, 0, 0, 0);
      }
      if (this.dirty || this.animating()) {
        this.paint();
        this.dirty = false;
      }
    }
    dispose() {
      scene.remove(this.group);
      this.rt.dispose();
      this.mGeo.dispose();
      this.mesh.geometry.dispose();
      this.mat.dispose();
    }
  }

  // ---------------------------------------------------------------- 帯がめくれて巻く(L1)
  const RS = 18;
  const MAXP = 600;
  class Strip {
    geo = new T.BufferGeometry();
    mesh: T.Mesh;
    mat: T.ShaderMaterial;
    aP = new Float32Array(MAXP * RS * 3);
    aT = new Float32Array(MAXP * RS * 2);
    aS = new Float32Array(MAXP * RS);
    aB = new Float32Array(MAXP * RS);
    n = 0;
    constructor(parent: T.Object3D, width: number, photo: T.Texture, sheet: Sheet) {
      const aU = new Float32Array(MAXP * RS);
      for (let i = 0; i < MAXP; i++) for (let j = 0; j < RS; j++) aU[i * RS + j] = j / (RS - 1) - 0.5;
      const idx = new Uint32Array((MAXP - 1) * (RS - 1) * 6);
      let k = 0;
      for (let i = 0; i < MAXP - 1; i++)
        for (let j = 0; j < RS - 1; j++) {
          const a = i * RS + j;
          idx[k++] = a;
          idx[k++] = a + RS;
          idx[k++] = a + 1;
          idx[k++] = a + 1;
          idx[k++] = a + RS;
          idx[k++] = a + RS + 1;
        }
      this.geo.setAttribute('position', new T.BufferAttribute(this.aP, 3));
      this.geo.setAttribute('aT', new T.BufferAttribute(this.aT, 2));
      this.geo.setAttribute('aU', new T.BufferAttribute(aU, 1));
      this.geo.setAttribute('aS', new T.BufferAttribute(this.aS, 1));
      this.geo.setAttribute('aB', new T.BufferAttribute(this.aB, 1));
      this.geo.setIndex(new T.BufferAttribute(idx, 1));
      this.geo.setDrawRange(0, 0);
      this.mat = new T.ShaderMaterial({
        uniforms: {
          uTime: { value: 0 },
          uLen: { value: 0.001 },
          uW: { value: width },
          uPhoto: { value: photo },
          uBoard: { value: boardTex },
          uRep: { value: sheet.mat.uniforms.uRep.value },
          uSize: { value: new T.Vector2(sheet.w, sheet.h) },
          uLight: { value: LIGHT },
        },
        vertexShader: /* glsl */ `
          attribute vec2 aT; attribute float aU; attribute float aS; attribute float aB;
          uniform float uTime; uniform float uLen; uniform float uW; uniform vec2 uSize;
          varying vec3 vN; varying vec3 vW; varying vec2 vFlat; varying vec2 vPh; varying float vC;
          void main(){
            float u = clamp(aS / uLen, 0.0, 1.0);
            float lensv = pow(max(sin(3.14159 * u), 0.0), 0.5);
            float W = max(uW * lensv * min(1.0, uLen / 0.45), 1e-4);
            float c = smoothstep(0.08, 0.7, uTime - aB);
            c *= 1.0 - 0.07 * (0.5 + 0.5 * sin(uTime * 1.5 + aS * 7.0));
            float k = c * 6.2831853 / W * 0.985;
            float a = aU * W;
            vec2 N = vec2(-aT.y, aT.x);
            float x = k < 1e-3 ? a : sin(k * a) / k;
            float z = k < 1e-3 ? 0.0 : (1.0 - cos(k * a)) / k;
            z += 0.0015 - c * 0.35 * W / 6.2831853 * lensv;
            vec3 p = position + vec3(N * x, z);
            vec3 nt = vec3(-N * sin(k * a), cos(k * a));
            vN = normalize(mat3(modelMatrix) * nt);
            vec4 wp = modelMatrix * vec4(p, 1.0);
            vW = wp.xyz;
            vFlat = (position.xy + N * a) / uSize + 0.5;
            vPh = vec2(aS / (uW * 1.6), aU + 0.5);
            vC = c;
            gl_Position = projectionMatrix * viewMatrix * wp;
          }`,
        fragmentShader: /* glsl */ `
          uniform sampler2D uPhoto; uniform sampler2D uBoard; uniform float uRep; uniform vec3 uLight;
          varying vec3 vN; varying vec3 vW; varying vec2 vFlat; varying vec2 vPh; varying float vC;
          void main(){
            vec3 V = normalize(cameraPosition - vW);
            bool top = dot(vN, V) > 0.0;
            vec3 n = top ? vN : -vN;
            float lam = 0.62 + 0.38 * max(dot(n, uLight), 0.0);
            vec3 c;
            if (top) {
              c = texture2D(uBoard, vFlat * uRep).rgb * lam;
              c *= 1.0 - 0.45 * vC * (1.0 - max(n.z, 0.0));
            } else {
              c = texture2D(uPhoto, vPh).rgb * (0.45 + 0.65 * max(dot(n, uLight), 0.0));
              vec3 h = normalize(uLight + V);
              c += pow(max(dot(n, h), 0.0), 40.0) * 0.35;
            }
            gl_FragColor = vec4(c, 1.0);
          }`,
        side: T.DoubleSide,
      });
      this.mesh = new T.Mesh(this.geo, this.mat);
      this.mesh.frustumCulled = false;
      this.mesh.renderOrder = 3;
      parent.add(this.mesh);
    }
    push(x: number, y: number, s: number, b: number, tx: number, ty: number) {
      if (this.n >= MAXP) return;
      const i = this.n++;
      for (let j = 0; j < RS; j++) {
        const v = i * RS + j;
        this.aP[v * 3] = x;
        this.aP[v * 3 + 1] = y;
        this.aP[v * 3 + 2] = 0;
        this.aT[v * 2] = tx;
        this.aT[v * 2 + 1] = ty;
        this.aS[v] = s;
        this.aB[v] = b;
      }
      if (i > 0) {
        // 1つ前の点の向きを、前後の中間に直す
        for (let j = 0; j < RS; j++) {
          const v = (i - 1) * RS + j;
          const px = this.aT[v * 2];
          const py = this.aT[v * 2 + 1];
          const mx = px + tx;
          const my = py + ty;
          const l = Math.hypot(mx, my) || 1;
          this.aT[v * 2] = mx / l;
          this.aT[v * 2 + 1] = my / l;
        }
      }
      for (const k of ['position', 'aT', 'aS', 'aB']) (this.geo.attributes[k] as T.BufferAttribute).needsUpdate = true;
      this.geo.setDrawRange(0, Math.max(0, this.n - 1) * (RS - 1) * 6);
    }
    update(len: number) {
      this.mat.uniforms.uTime.value = now;
      this.mat.uniforms.uLen.value = Math.max(len, 0.001);
    }
  }

  // ---------------------------------------------------------------- ガラスの棒(L2)
  const RR = 14;
  class Rod {
    geo = new T.BufferGeometry();
    mesh: T.Mesh;
    mat: T.ShaderMaterial;
    aP = new Float32Array(MAXP * RR * 3);
    aT = new Float32Array(MAXP * RR * 2);
    aS = new Float32Array(MAXP * RR);
    aB = new Float32Array(MAXP * RR);
    n = 0;
    constructor(parent: T.Object3D, radius: number) {
      const aA = new Float32Array(MAXP * RR);
      for (let i = 0; i < MAXP; i++) for (let j = 0; j < RR; j++) aA[i * RR + j] = (j / (RR - 1)) * Math.PI * 2;
      const idx = new Uint32Array((MAXP - 1) * (RR - 1) * 6);
      let k = 0;
      for (let i = 0; i < MAXP - 1; i++)
        for (let j = 0; j < RR - 1; j++) {
          const a = i * RR + j;
          idx[k++] = a;
          idx[k++] = a + 1;
          idx[k++] = a + RR;
          idx[k++] = a + 1;
          idx[k++] = a + RR + 1;
          idx[k++] = a + RR;
        }
      this.geo.setAttribute('position', new T.BufferAttribute(this.aP, 3));
      this.geo.setAttribute('aT', new T.BufferAttribute(this.aT, 2));
      this.geo.setAttribute('aA', new T.BufferAttribute(aA, 1));
      this.geo.setAttribute('aS', new T.BufferAttribute(this.aS, 1));
      this.geo.setAttribute('aB', new T.BufferAttribute(this.aB, 1));
      this.geo.setIndex(new T.BufferAttribute(idx, 1));
      this.geo.setDrawRange(0, 0);
      this.mat = new T.ShaderMaterial({
        uniforms: { uTime: { value: 0 }, uLen: { value: 0.001 }, uR: { value: radius }, uScene: { value: rtScene.texture }, uRes: { value: res }, uLight: { value: LIGHT } },
        vertexShader: /* glsl */ `
          attribute vec2 aT; attribute float aA; attribute float aS; attribute float aB;
          uniform float uTime; uniform float uLen; uniform float uR;
          varying vec3 vN; varying vec3 vW;
          void main(){
            float u = clamp(aS / uLen, 0.0, 1.0);
            float r = uR * pow(max(sin(3.14159 * u), 0.0), 0.35) * min(1.0, uLen / 0.3) * smoothstep(0.0, 0.25, uTime - aB);
            vec2 N = vec2(-aT.y, aT.x);
            vec3 nn = vec3(N * cos(aA), sin(aA));
            vec3 p = position + nn * r + vec3(0.0, 0.0, r * 0.85);
            vN = normalize(mat3(modelMatrix) * nn);
            vec4 wp = modelMatrix * vec4(p, 1.0);
            vW = wp.xyz;
            gl_Position = projectionMatrix * viewMatrix * wp;
          }`,
        fragmentShader: /* glsl */ `
          uniform sampler2D uScene; uniform vec2 uRes; uniform vec3 uLight;
          varying vec3 vN; varying vec3 vW;
          ${GLASS}
          void main(){
            vec3 n = normalize(vN);
            vec3 V = normalize(cameraPosition - vW);
            float ndv = max(dot(n, V), 0.0);
            float fr = pow(1.0 - ndv, 3.0);
            vec2 suv = gl_FragCoord.xy / uRes;
            vec3 c = seeThrough(uScene, suv, -n.xy * 0.07);
            vec3 rb = 0.5 + 0.5 * cos(6.2831 * (ndv * 1.6 + vec3(0.0, 0.33, 0.67)));
            c = c * 0.9 + vec3(0.05, 0.06, 0.07) + fr * mix(vec3(1.0), rb, 0.75) * 1.3 + pow(1.0 - ndv, 8.0) * 0.6;
            vec3 h = normalize(uLight + V);
            c += pow(max(dot(n, h), 0.0), 70.0) * 0.9;
            gl_FragColor = vec4(c, 1.0);
          }`,
      });
      this.mesh = new T.Mesh(this.geo, this.mat);
      this.mesh.frustumCulled = false;
      this.mesh.renderOrder = 3;
      parent.add(this.mesh);
    }
    push(x: number, y: number, s: number, b: number, tx: number, ty: number) {
      if (this.n >= MAXP) return;
      const i = this.n++;
      for (let j = 0; j < RR; j++) {
        const v = i * RR + j;
        this.aP[v * 3] = x;
        this.aP[v * 3 + 1] = y;
        this.aP[v * 3 + 2] = 0;
        this.aT[v * 2] = tx;
        this.aT[v * 2 + 1] = ty;
        this.aS[v] = s;
        this.aB[v] = b;
      }
      for (const k of ['position', 'aT', 'aS', 'aB']) (this.geo.attributes[k] as T.BufferAttribute).needsUpdate = true;
      this.geo.setDrawRange(0, Math.max(0, this.n - 1) * (RR - 1) * 6);
    }
    update(len: number) {
      this.mat.uniforms.uTime.value = now;
      this.mat.uniforms.uLen.value = Math.max(len, 0.001);
    }
  }

  // ---------------------------------------------------------------- 割れた面の破片
  type Piece = {
    mesh: T.Mesh;
    vel: T.Vector3;
    axis: T.Vector3;
    spin: number;
    delay: number;
    t: number;
    z0: number;
    mats: T.ShaderMaterial[];
    g: number;
  };
  const pieceVert = /* glsl */ `
    uniform vec2 uCenter; uniform vec2 uSize;
    varying vec2 vUv; varying vec3 vWN; varying vec3 vW; varying float vZ; varying vec3 vON;
    void main(){
      vUv = (position.xy + uCenter) / uSize + 0.5;
      vON = normal; vZ = position.z;
      vWN = normalize(mat3(modelMatrix) * normal);
      vec4 wp = modelMatrix * vec4(position, 1.0); vW = wp.xyz;
      gl_Position = projectionMatrix * viewMatrix * wp;
    }`;
  const pieceFrag = /* glsl */ `
    uniform sampler2D uMap; uniform sampler2D uStrata; uniform sampler2D uScene; uniform vec2 uRes;
    uniform int uKind; uniform float uRep; uniform float uThick; uniform float uGlow; uniform float uAlpha; uniform vec3 uLight;
    varying vec2 vUv; varying vec3 vWN; varying vec3 vW; varying float vZ; varying vec3 vON;
    ${GLASS}
    void main(){
      vec3 n = normalize(vWN);
      vec3 V = normalize(cameraPosition - vW);
      float lam = 0.55 + 0.45 * max(dot(n, uLight), 0.0);
      float k = clamp(0.5 - vZ / uThick, 0.0, 1.0);
      vec3 c;
      vec2 suv = gl_FragCoord.xy / uRes;
      if (uKind == 2) {
        float fr = pow(1.0 - abs(dot(n, V)), 2.0);
        c = seeThrough(uScene, suv, n.xy * 0.05) * vec3(0.85, 0.93, 0.95);
        vec3 rb = 0.5 + 0.5 * cos(6.2831 * (fr * 1.5 + vec3(0.0, 0.33, 0.67)));
        c += fr * rb * 0.3 + fr * 0.25;
        if (abs(vON.z) < 0.5) c = mix(vec3(0.78, 0.95, 0.93), rb, 0.28) * (1.05 - 0.4 * k);
        vec3 h = normalize(uLight + V);
        c += pow(max(dot(n, h), 0.0), 60.0) * 0.8;
      } else if (vON.z > 0.5) {
        if (uKind == 1) c = texture2D(uMap, vUv * uRep).rgb;
        else { vec4 t = texture2D(uMap, vUv); c = mix(vec3(0.86, 0.93, 1.0) * uGlow, t.rgb, t.a); }
        c *= lam;
      } else if (vON.z < -0.5) {
        c = (uKind == 0 ? vec3(0.9, 0.89, 0.86) : vec3(0.08)) * lam;
      } else {
        if (uKind == 0) c = (k < 0.16 ? texture2D(uMap, vUv).rgb * 0.85 : vec3(0.93, 0.92, 0.89)) * lam;
        else c = texture2D(uStrata, vec2(k * 0.98 + 0.01, 0.5)).rgb * lam;
      }
      gl_FragColor = vec4(c, uAlpha);
    }`;
  let pieces: Piece[] = [];

  // 切れ目(ひびを含む)で、面をいくつかの破片に分ける。
  // 輪郭(面の座標)から、厚みのある破片を1つ作る
  const makePiece = (sh: Sheet, pts: V2[], cx: number, cy: number, vel: T.Vector3, axis: T.Vector3, spin: number, delay: number, g = 2.8): Piece => {
    const shape = new T.Shape(pts.map((p) => new T.Vector2(p.x - cx, p.y - cy)));
    const geo = new T.ExtrudeGeometry(shape, { depth: sh.thick, bevelEnabled: false, curveSegments: 1 });
    geo.translate(0, 0, -sh.thick / 2);
    const kind = sh.kind === 'board' ? 1 : sh.kind === 'glass' ? 2 : 0;
    const mat = new T.ShaderMaterial({
      uniforms: {
        uCenter: { value: new T.Vector2(cx, cy) },
        uSize: { value: new T.Vector2(sh.w, sh.h) },
        uMap: { value: sh.mat.uniforms.uMap.value },
        uStrata: { value: strataTex },
        uScene: { value: rtScene.texture },
        uRes: { value: res },
        uKind: { value: kind },
        uRep: { value: sh.mat.uniforms.uRep.value },
        uThick: { value: sh.thick },
        uGlow: { value: sh.mat.uniforms.uGlow.value },
        uAlpha: { value: 1 },
        uLight: { value: LIGHT },
      },
      vertexShader: pieceVert,
      fragmentShader: pieceFrag,
      transparent: true,
    });
    const mesh = new T.Mesh(geo, mat);
    mesh.position.set(cx, cy, sh.z - sh.thick / 2);
    mesh.renderOrder = 6;
    if (sh.kind === 'floor') mesh.layers.set(1);
    scene.add(mesh);
    return { mesh, mats: [mat], vel, axis, spin, delay, t: 0, z0: sh.z, g };
  };
  const inPoly = (x: number, y: number, P: V2[]) => {
    let c = false;
    for (let i = 0, j = P.length - 1; i < P.length; j = i++)
      if (P[i].y > y !== P[j].y > y && x < ((P[j].x - P[i].x) * (y - P[i].y)) / (P[j].y - P[i].y) + P[i].x) c = !c;
    return c;
  };
  const shatter = (sh: Sheet, from: V2, opt: { speed: number; spin: number; g: number }) => {
    const GW = 112;
    const cell = sh.w / GW;
    const GH = Math.ceil(sh.h / cell);
    const grid = new Int32Array(GW * GH);
    const stamp = (x: number, y: number, r: number) => {
      const gx = (x + sh.w / 2) / cell;
      const gy = (y + sh.h / 2) / cell;
      const rr = r / cell + 0.5;
      for (let j = Math.floor(gy - rr); j <= Math.ceil(gy + rr); j++)
        for (let i = Math.floor(gx - rr); i <= Math.ceil(gx + rr); i++) {
          if (i < 0 || j < 0 || i >= GW || j >= GH) continue;
          if ((i + 0.5 - gx) ** 2 + (j + 0.5 - gy) ** 2 <= rr * rr) grid[j * GW + i] = -1;
        }
    };
    for (const c of sh.cuts) {
      for (let i = 0; i < c.xs.length - 1; i++) {
        const h0 = sh.hw(c, i);
        if (h0 < 0) break;
        const dx = c.xs[i + 1] - c.xs[i];
        const dy = c.ys[i + 1] - c.ys[i];
        const l = Math.hypot(dx, dy);
        const st = Math.max(1, Math.ceil(l / (cell * 0.35)));
        for (let s = 0; s <= st; s++) stamp(c.xs[i] + (dx * s) / st, c.ys[i] + (dy * s) / st, Math.max(h0, cell * 0.55));
      }
    }
    for (const f of sh.fills)
      for (let j = 0; j < GH; j++)
        for (let i = 0; i < GW; i++) if (inPoly((i + 0.5) * cell - sh.w / 2, (j + 0.5) * cell - sh.h / 2, f)) grid[j * GW + i] = -1;
    // 4近傍でつながった所を、ひとつの破片とみなす
    let lab = 0;
    const stack: number[] = [];
    const info: { n: number; sx: number; sy: number }[] = [{ n: 0, sx: 0, sy: 0 }];
    for (let s = 0; s < GW * GH; s++) {
      if (grid[s] !== 0) continue;
      lab++;
      info.push({ n: 0, sx: 0, sy: 0 });
      grid[s] = lab;
      stack.push(s);
      while (stack.length) {
        const q = stack.pop()!;
        const i = q % GW;
        const j = (q / GW) | 0;
        info[lab].n++;
        info[lab].sx += i + 0.5;
        info[lab].sy += j + 0.5;
        const nb = [i > 0 ? q - 1 : -1, i < GW - 1 ? q + 1 : -1, j > 0 ? q - GW : -1, j < GH - 1 ? q + GW : -1];
        for (const r of nb)
          if (r >= 0 && grid[r] === 0) {
            grid[r] = lab;
            stack.push(r);
          }
      }
    }
    const out: Piece[] = [];
    const R = rng(Math.floor(now * 1000) + sh.cuts.length);
    for (let L = 1; L <= lab; L++) {
      if (info[L].n < 6) continue;
      // 境界をたどる(セルの辺を反時計回りにつなぐ)
      const next = new Map<number, number[]>();
      const key = (i: number, j: number) => j * (GW + 1) + i;
      const add = (a: number, b: number) => {
        const l = next.get(a);
        if (l) l.push(b);
        else next.set(a, [b]);
      };
      for (let j = 0; j < GH; j++)
        for (let i = 0; i < GW; i++) {
          if (grid[j * GW + i] !== L) continue;
          const at = (ii: number, jj: number) => ii >= 0 && jj >= 0 && ii < GW && jj < GH && grid[jj * GW + ii] === L;
          if (!at(i, j - 1)) add(key(i, j), key(i + 1, j));
          if (!at(i + 1, j)) add(key(i + 1, j), key(i + 1, j + 1));
          if (!at(i, j + 1)) add(key(i + 1, j + 1), key(i, j + 1));
          if (!at(i - 1, j)) add(key(i, j + 1), key(i, j));
        }
      let best: number[] = [];
      while (next.size) {
        const start = next.keys().next().value as number;
        const loop: number[] = [start];
        let cur = start;
        for (let guard = 0; guard < 200000; guard++) {
          const l = next.get(cur);
          if (!l || !l.length) break;
          const nx = l.pop()!;
          if (!l.length) next.delete(cur);
          if (nx === start) break;
          loop.push(nx);
          cur = nx;
        }
        if (loop.length > best.length) best = loop;
      }
      if (best.length < 8) continue;
      let pts = best.map((q) => ({ x: (q % (GW + 1)) * cell - sh.w / 2, y: Math.floor(q / (GW + 1)) * cell - sh.h / 2 }));
      // 角をとる
      for (let it = 0; it < 2; it++) {
        const np: V2[] = [];
        for (let i = 0; i < pts.length; i++) {
          const a = pts[i];
          const b = pts[(i + 1) % pts.length];
          np.push({ x: a.x * 0.75 + b.x * 0.25, y: a.y * 0.75 + b.y * 0.25 }, { x: a.x * 0.25 + b.x * 0.75, y: a.y * 0.25 + b.y * 0.75 });
        }
        pts = np;
      }
      const step = Math.max(1, Math.floor(pts.length / 260));
      pts = pts.filter((_, i) => i % step === 0);
      const cx = (info[L].sx / info[L].n) * cell - sh.w / 2;
      const cy = (info[L].sy / info[L].n) * cell - sh.h / 2;
      const ox = cx - from.x;
      const oy = cy - from.y;
      const ol = Math.hypot(ox, oy) || 1;
      const out2 = { x: cx / (Math.hypot(cx, cy) + 0.3), y: cy / (Math.hypot(cx, cy) + 0.3) };
      out.push(
        makePiece(
          sh,
          pts,
          cx,
          cy,
          new T.Vector3(
            (DIR28.x * (0.7 + R() * 0.5) + out2.x * 0.6) * opt.speed,
            (DIR28.y * (0.7 + R() * 0.5) + out2.y * 0.6) * opt.speed,
            -0.2 - R() * 0.3
          ),
          new T.Vector3(-oy / ol, ox / ol, (R() - 0.5) * 0.4).normalize(),
          (0.9 + R() * 1.4) * opt.spin * (R() < 0.5 ? -1 : 1),
          Math.min(0.5, ol * 0.25) * (0.6 + R() * 0.4)
        )
      );
    }
    return out;
  };

  // ---------------------------------------------------------------- 機材の稜線(V3)と床
  let floorZ = -2 * D - DV;
  const floor = new Sheet('floor', floorZ, VW, VH, 0.02, backTex, 1);
  floor.mesh.layers.set(1);
  floor.mat.uniforms.uGlow.value = 0.35;
  const lineGeo = new T.InstancedBufferGeometry();
  lineGeo.setAttribute('position', new T.BufferAttribute(new Float32Array(12), 3));
  lineGeo.setAttribute('corner', new T.BufferAttribute(new Float32Array([0, -1, 1, -1, 1, 1, 0, 1]), 2));
  lineGeo.setIndex([0, 1, 2, 0, 2, 3]);
  const iA = new Float32Array(NSEG * 3);
  const iB = new Float32Array(NSEG * 3);
  const iA2 = new Float32Array(NSEG * 3);
  const iB2 = new Float32Array(NSEG * 3);
  const attA = new T.InstancedBufferAttribute(iA, 3);
  const attB = new T.InstancedBufferAttribute(iB, 3);
  const attA2 = new T.InstancedBufferAttribute(iA2, 3);
  const attB2 = new T.InstancedBufferAttribute(iB2, 3);
  lineGeo.setAttribute('iA', attA);
  lineGeo.setAttribute('iB', attB);
  lineGeo.setAttribute('iA2', attA2);
  lineGeo.setAttribute('iB2', attB2);
  lineGeo.instanceCount = 0;
  const lineMat = new T.ShaderMaterial({
    uniforms: { uM: { value: 0 }, uRes: { value: res }, uPx: { value: 0.65 * DPR }, uFlat: { value: 0 }, uAlpha: { value: 0.6 }, uN: { value: NSEG } },
    vertexShader: /* glsl */ `
      attribute vec2 corner; attribute vec3 iA; attribute vec3 iB; attribute vec3 iA2; attribute vec3 iB2;
      uniform float uM; uniform vec2 uRes; uniform float uPx; uniform float uFlat; uniform float uN;
      varying float vF;
      void main(){
        // 形の移し方: 今の機材は上から床に寝て図面になり(3D → 2D)、図面のまま次の機材の図面へ移り、下から立ち上がる(2D → 3D)。
        float lag = float(gl_InstanceID) / uN;
        float dn = smoothstep((1.0 - lag) * 0.4, (1.0 - lag) * 0.4 + 0.6, smoothstep(0.0, 0.42, uM));
        float xy = smoothstep(0.4, 0.6, uM);
        float up = smoothstep(lag * 0.4, lag * 0.4 + 0.6, smoothstep(0.58, 1.0, uM));
        // 図面どうしは、28° の線が床を掃くところで入れ替わる(線は飛ばない)
        float pr = dot((iA.xy + iB.xy) * 0.5, vec2(0.883, 0.469)) / 1.4 + 0.5;
        float sw = step(pr, mix(-0.05, 1.05, xy));
        vec3 a = sw < 0.5 ? vec3(iA.xy, iA.z * (1.0 - dn)) : vec3(iA2.xy, iA2.z * up);
        vec3 b = sw < 0.5 ? vec3(iB.xy, iB.z * (1.0 - dn)) : vec3(iB2.xy, iB2.z * up);
        a.z = max(a.z, 0.002); b.z = max(b.z, 0.002);
        a.z *= 1.0 - uFlat; b.z *= 1.0 - uFlat;
        vec4 ca = projectionMatrix * modelViewMatrix * vec4(a, 1.0);
        vec4 cb = projectionMatrix * modelViewMatrix * vec4(b, 1.0);
        vec2 sa = ca.xy / ca.w * uRes * 0.5;
        vec2 sb = cb.xy / cb.w * uRes * 0.5;
        vec2 d = sb - sa;
        float L = length(d);
        d = L > 1e-4 ? d / L : vec2(1.0, 0.0);
        vec2 nrm = vec2(-d.y, d.x);
        vec4 c = mix(ca, cb, corner.x);
        float near = clamp(1.6 / c.w, 0.6, 2.2);
        c.xy += nrm * corner.y * uPx * near * c.w / (uRes * 0.5);
        gl_Position = c;
        vF = near;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uAlpha; varying float vF;
      void main(){ gl_FragColor = vec4(vec3(0.92, 0.96, 1.0) * uAlpha * (0.55 + 0.45 * vF), 1.0); }`,
    transparent: true,
    blending: T.AdditiveBlending,
    depthWrite: false,
  });
  const lines = new T.Mesh(lineGeo, lineMat);
  lines.frustumCulled = false;
  lines.layers.set(1);
  lines.renderOrder = 2;
  floor.group.add(lines);
  const objs: (Float32Array | null)[] = OBJS.map(() => null);
  let objI = 0;
  let morph = 0;
  let morphs = 0;
  const loadObj = (i: number) =>
    fetch(`${base}/lab/obj/${OBJS[i]}.edges.bin`)
      .then((r) => r.arrayBuffer())
      .then((buf) => {
        if (buf.byteLength !== NSEG * 12) return;
        const s16 = new Int16Array(buf);
        const out = new Float32Array(NSEG * 6);
        let lo = Infinity;
        let hi = -Infinity;
        let mx = 0;
        for (let k = 0; k < NSEG * 2; k++) {
          const y = (s16[k * 3 + 1] * 1.25) / 32000;
          lo = Math.min(lo, y);
          hi = Math.max(hi, y);
          mx = Math.max(mx, Math.abs((s16[k * 3] * 1.25) / 32000), Math.abs((s16[k * 3 + 2] * 1.25) / 32000));
        }
        const sc = Math.min(0.62 / mx, 1.25 / (hi - lo));
        for (let k = 0; k < NSEG * 2; k++) {
          const x = (s16[k * 3] * 1.25) / 32000;
          const y = (s16[k * 3 + 1] * 1.25) / 32000;
          const z = (s16[k * 3 + 2] * 1.25) / 32000;
          out[k * 3] = x * sc;
          out[k * 3 + 1] = -z * sc;
          out[k * 3 + 2] = (y - lo) * sc + 0.002;
        }
        objs[i] = out;
        if (i === 0 || i === 1) setObj();
      })
      .catch(() => undefined);
  const setObj = () => {
    const a = objs[objI % OBJS.length];
    const b = objs[(objI + 1) % OBJS.length] || a;
    if (!a || !b) return;
    for (let k = 0; k < NSEG; k++) {
      iA.set(a.subarray(k * 6, k * 6 + 3), k * 3);
      iB.set(a.subarray(k * 6 + 3, k * 6 + 6), k * 3);
      iA2.set(b.subarray(k * 6, k * 6 + 3), k * 3);
      iB2.set(b.subarray(k * 6 + 3, k * 6 + 6), k * 3);
    }
    attA.needsUpdate = attB.needsUpdate = attA2.needsUpdate = attB2.needsUpdate = true;
    lineGeo.instanceCount = NSEG;
  };
  OBJS.forEach((_, i) => {
    if (i < 4) loadObj(i);
    else setTimeout(() => loadObj(i), 1500 + i * 120);
  });

  // ---------------------------------------------------------------- 層(一周ごとに、並び・写真の割り付け・落ち方を変える)
  let cycle = 0;
  let sheets: Sheet[] = [];
  const photoTexFor = (cy: number): T.Texture => {
    if (cy === 0) return photoTex;
    const cv = document.createElement('canvas');
    cv.width = photoCv.width;
    cv.height = photoCv.height;
    const tex = new T.CanvasTexture(cv);
    tex.anisotropy = 4;
    paintPhoto(cv, tex, 7 + cy * 13, cy % 2 ? 260 : 110, cy % 2 ? 200 : 90);
    return tex;
  };
  const V3T = new T.Vector3(0, 0, floorZ + 0.32);
  const buildCycle = (z0: number) => {
    sheets.forEach((sh) => sh.dispose());
    const order: ('photo' | 'board')[] = cycle % 2 === 0 ? ['photo', 'board'] : ['board', 'photo'];
    sheets = [
      ...order.map((k, i) => new Sheet(k, z0 - i * D, SW, SH, k === 'photo' ? 0.014 : 0.07, k === 'photo' ? photoTexFor(cycle) : boardTex, i === 0 ? 5 : 3)),
      new Sheet('glass', z0 - 2 * D, SW, SH, 0.045, blank, 1),
    ];
    sheets.forEach((sh) => sh.clear());
    floorZ = z0 - 2 * D - DV;
    floor.group.position.z = floorZ;
    floor.group.quaternion.identity();
    floor.cuts = [];
    floor.fills = [];
    floor.presses = [];
    floor.tension = 0;
    floor.dirty = true;
    floor.mesh.visible = true;
    V3T.z = floorZ + 0.32;
    lineMat.uniforms.uFlat.value = 0;
    lineMat.uniforms.uAlpha.value = 0.6;
  };
  buildCycle(0);
  floor.clear();

  // stage: 0〜2 面 / 3 線の空間 / 4 裏返り / 5 おわり
  let stage = 0;
  let phase: 'cut' | 'crack' | 'fall' = 'cut';
  let mode: 'shatter' | 'peel' | 'sink' | 'floor' = 'shatter';
  let phaseT = 0;
  const LIMIT = [2.2, 2.0, 1.9, 2.6];
  const setSec = (x: string) => (document.documentElement.dataset.sec = x);
  setSec('A');
  let flash = 0;
  const camFrom = new T.Vector3();
  const lookFrom = new T.Vector3();
  const sinkP: V2 = { x: 0, y: 0 };
  let edgeN = 0;
  const addEdge = (col: string) => {
    const i = document.createElement('i');
    i.style.top = `${edgeN * 3}px`;
    i.style.background = col;
    edgeEl.appendChild(i);
    edgeN++;
  };
  const activeSheet = (): Sheet | null => (stage <= 2 ? sheets[stage] : stage === 3 ? floor : null);

  // ---------------------------------------------------------------- 視点
  const sway = new T.Vector2();
  const swayT = new T.Vector2();
  const kick = (x: number, y: number) => {
    swayT.x = clamp(swayT.x + x, -0.16, 0.16);
    swayT.y = clamp(swayT.y + y, -0.13, 0.13);
  };
  let orbit = 0;
  let orbitV = 0;
  const camPose = (z: number, pos: T.Vector3, look: T.Vector3, ox = 0, oy = 0) => {
    look.set(ox + sway.x * 0.3, oy + sway.y * 0.3, z);
    pos.set(ox + sway.x, oy - Math.sin(TILT) * HC + sway.y, z + Math.cos(TILT) * HC);
  };
  const v3Pose = (phi: number, dist: number, pos: T.Vector3, look: T.Vector3) => {
    const th = -Math.PI / 2 + orbit + Math.sin(now * 0.17) * 0.35;
    look.copy(V3T);
    pos.set(V3T.x + dist * Math.sin(phi) * Math.cos(th), V3T.y + dist * Math.sin(phi) * Math.sin(th), V3T.z + dist * Math.cos(phi));
  };
  const tmpP = new T.Vector3();
  const tmpL = new T.Vector3();
  const upA = new T.Vector3(0, 1, 0);
  const upB = new T.Vector3(0, 0, 1);
  const placeCamera = () => {
    sway.lerp(swayT, 0.07);
    swayT.multiplyScalar(0.965);
    swayT.x += Math.sin(now * 0.31) * 0.0009;
    swayT.y += Math.cos(now * 0.23) * 0.0007;
    camera.up.copy(upA);
    if (stage <= 2) {
      const sh = sheets[stage];
      const zTo = stage < 2 ? sheets[stage + 1].z : sh.z;
      if (phase !== 'fall') camPose(sh.z, tmpP, tmpL);
      else if (sh.kind === 'glass') {
        // ガラスが割れて、空間へ落ちる(2D → 3D)
        const k2 = eio(clamp((phaseT - 0.1) / 1.8));
        const dist0 = sh.z + HC - V3T.z;
        v3Pose(mix(TILT, 0.95, k2), mix(dist0, 2.9, k2), tmpP, tmpL);
        tmpL.lerpVectors(lookFrom, V3T, clamp(k2 * 1.6));
        camera.up.copy(upA).lerp(upB, sstep(0.2, 0.9, k2)).normalize();
      } else if (mode === 'sink') {
        // 切れ目が広がり、その穴へ吸い込まれる
        const k = eio(clamp((phaseT - 0.35) / 1.2));
        const back = sstep(0.55, 1, k);
        camPose(mix(sh.z, zTo, k), tmpP, tmpL, sinkP.x * (1 - back), sinkP.y * (1 - back));
        if (camera.position.z < sh.z + 0.06) sh.group.visible = false;
      } else {
        const k = eio(clamp((phaseT - (mode === 'peel' ? 0.6 : 0.25)) / 1.0));
        camPose(mix(sh.z, zTo, k), tmpP, tmpL);
      }
    } else if (stage === 3 && phase === 'fall') {
      // 床が割れて、次の周の最初の面へ
      const k = eio(clamp((phaseT - 0.2) / 1.6));
      camPose(sheets[0].z, tmpP, tmpL);
      tmpP.lerpVectors(camFrom, tmpP, k);
      tmpL.lerpVectors(lookFrom, tmpL, k);
      camera.up.copy(upB).lerp(upA, sstep(0.1, 0.8, k)).normalize();
    } else if (stage === 3) {
      orbit += orbitV;
      orbitV *= 0.92;
      v3Pose(0.95, 2.9, tmpP, tmpL);
      camera.up.copy(upB);
    } else {
      // 裏返り: 斜めの空間から、真上へ
      const k = eio(clamp(phaseT / 1.7));
      v3Pose(0.95, 2.9, camFrom, lookFrom);
      tmpP.lerpVectors(camFrom, new T.Vector3(0, 0, floorZ + HC), k);
      tmpL.lerpVectors(lookFrom, new T.Vector3(0, 0, floorZ), k);
      camera.up.copy(upB).lerp(upA, sstep(0.1, 0.85, k)).normalize();
    }
    camera.position.copy(tmpP);
    camera.lookAt(tmpL);
  };

  // ---------------------------------------------------------------- 切る
  const ray = new T.Raycaster();
  const ndc = new T.Vector2();
  const hitPlane = (cx: number, cy: number, z: number): V2 | null => {
    ndc.set((cx / W) * 2 - 1, -(cy / H) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const p = new T.Vector3();
    const pl = new T.Plane(new T.Vector3(0, 0, 1), -z);
    if (!ray.ray.intersectPlane(pl, p)) return null;
    return { x: p.x, y: p.y };
  };
  const R0 = rng(5);
  const startCut = () => {
    const sh = activeSheet();
    if (!sh || phase !== 'cut') return null;
    const w = sh.kind === 'photo' ? 0.032 : sh.kind === 'board' ? 0.095 : sh.kind === 'glass' ? 0.007 : 0.008;
    const c = newCut(w);
    if (sh.kind === 'board') c.strip = new Strip(sh.group, 0.19, picTex(Math.floor(R0() * pics.length)), sh);
    if (sh.kind === 'glass') c.rod = new Rod(sh.group, 0.036);
    sh.cuts.push(c);
    return c;
  };
  const extend = (c: Cut, p: V2) => {
    const sh = activeSheet();
    if (!sh || phase !== 'cut') return;
    const n = c.xs.length;
    if (n) {
      const d = Math.hypot(p.x - c.xs[n - 1], p.y - c.ys[n - 1]);
      if (d < 0.008) return;
      if (d > 0.03) {
        const st = Math.ceil(d / 0.02);
        const x0 = c.xs[n - 1];
        const y0 = c.ys[n - 1];
        for (let i = 1; i < st; i++) extend(c, { x: x0 + ((p.x - x0) * i) / st, y: y0 + ((p.y - y0) * i) / st });
        if (phase !== 'cut') return;
      }
    }
    const m = c.xs.length;
    const d = m ? Math.hypot(p.x - c.xs[m - 1], p.y - c.ys[m - 1]) : 0;
    if (m && d < 0.004) return;
    c.len += d;
    c.xs.push(p.x);
    c.ys.push(p.y);
    c.ss.push(c.len);
    c.bs.push(now);
    const tx = m ? (p.x - c.xs[m - 1]) / (d || 1) : 1;
    const ty = m ? (p.y - c.ys[m - 1]) / (d || 1) : 0;
    c.strip?.push(p.x, p.y, c.len, now, tx, ty);
    c.rod?.push(p.x, p.y, c.len, now, tx, ty);
    sh.tension += d;
    sh.dirty = true;
    if (stage === 3) morph += d * 0.9;
    checkTension(sh, p);
  };
  const checkTension = (sh: Sheet, p: V2) => {
    if (sh.tension < LIMIT[stage] || phase !== 'cut') return;
    if (gest) gest = null;
    act = null;
    beginTransition(sh, p);
  };

  // 円(くり抜き・打ち抜き)の輪郭
  const ring = (x: number, y: number, r: number, n = 22, jag = 0, R = Math.random): V2[] =>
    Array.from({ length: n }, (_, i) => {
      const a = (i / n) * Math.PI * 2;
      const rr = r * (1 + (R() - 0.5) * jag);
      return { x: x + Math.cos(a) * rr, y: y + Math.sin(a) * rr };
    });
  const outline = (sh: Sheet, pts: V2[], w = 0.004) => {
    const c = newCut(w);
    const P = [...pts, pts[0]];
    let len = 0;
    P.forEach((p, i) => {
      if (i) len += Math.hypot(p.x - P[i - 1].x, p.y - P[i - 1].y);
      c.xs.push(p.x);
      c.ys.push(p.y);
      c.ss.push(len);
      c.bs.push(now);
    });
    c.len = len;
    sh.cuts.push(c);
  };
  const radial = (sh: Sheet, x: number, y: number, r0: number, n: number, lmin: number, lspan: number, R: () => number) => {
    for (let i = 0; i < n; i++) {
      const a = ((i + R() * 0.7) / n) * Math.PI * 2;
      const k = newCut(sh.kind === 'glass' ? 0.0025 : 0.003, true);
      let dx = Math.cos(a);
      let dy = Math.sin(a);
      let px = x + dx * r0;
      let py = y + dy * r0;
      const L = lmin + R() * lspan;
      let sAcc = 0;
      while (sAcc < L) {
        k.xs.push(px);
        k.ys.push(py);
        k.ss.push(sAcc);
        k.bs.push(now);
        const b = (R() - 0.5) * (sh.kind === 'glass' ? 0.1 : 0.6);
        const ndx = dx * Math.cos(b) - dy * Math.sin(b);
        const ndy = dx * Math.sin(b) + dy * Math.cos(b);
        dx = ndx;
        dy = ndy;
        px += dx * 0.012;
        py += dy * 0.012;
        sAcc += 0.012;
      }
      k.len = sAcc;
      k.t0 = now;
      k.dur = 0.08 + L * 0.9;
      sh.cuts.push(k);
    }
  };
  // タップ: 穴があき、ちぎれた丸がはじけて、穴へ落ちる。長押しのあとは大きく押し抜く。
  const punch = (sh: Sheet, p: V2, size: number) => {
    const R = rng(Math.floor(now * 997) + 1);
    const r = (sh.kind === 'glass' ? 0.018 : sh.kind === 'board' ? 0.04 : 0.032) * size;
    const hole = ring(p.x, p.y, r, 22, sh.kind === 'glass' ? 0.5 : 0.25, R);
    sh.fills.push(hole);
    outline(sh, hole);
    radial(sh, p.x, p.y, r, sh.kind === 'glass' ? 8 : 5, sh.kind === 'glass' ? 0.08 * size : 0.02 * size, sh.kind === 'glass' ? 0.25 * size : 0.06 * size, R);
    const nChip = sh.kind === 'glass' ? 4 : 1;
    for (let i = 0; i < nChip; i++) {
      const cp = nChip === 1 ? hole : ring(p.x + (R() - 0.5) * r, p.y + (R() - 0.5) * r, r * 0.45, 5, 0.6, R);
      const c = nChip === 1 ? p : { x: cp.reduce((a, q) => a + q.x, 0) / cp.length, y: cp.reduce((a, q) => a + q.y, 0) / cp.length };
      pieces.push(
        makePiece(
          sh,
          cp,
          c.x,
          c.y,
          new T.Vector3((R() - 0.5) * 0.5, (R() - 0.5) * 0.5, 0.9 + 0.5 * size + R() * 0.3),
          new T.Vector3(R() - 0.5, R() - 0.5, 0).normalize(),
          (5 + R() * 5) * (R() < 0.5 ? -1 : 1),
          0,
          4.2
        )
      );
    }
    sh.tension += 0.28 * size;
    sh.energy = Math.min(6, sh.energy + 1.2 * size);
    sh.dirty = true;
    kick((R() - 0.5) * 0.04 * size, (R() - 0.5) * 0.04 * size);
    checkTension(sh, p);
  };
  // 囲む: 囲んだ形がくり抜かれ、跳ねて、穴から落ちる。
  const cutout = (sh: Sheet, c: Cut) => {
    const pts: V2[] = [];
    for (let i = 0; i < c.xs.length; i += 2) pts.push({ x: c.xs[i], y: c.ys[i] });
    if (pts.length < 6) return;
    const cx = pts.reduce((a, q) => a + q.x, 0) / pts.length;
    const cy = pts.reduce((a, q) => a + q.y, 0) / pts.length;
    sh.fills.push(pts);
    const R = rng(Math.floor(now * 991));
    pieces.push(makePiece(sh, pts, cx, cy, new T.Vector3(0, 0, 1.25), new T.Vector3(R() - 0.5, R() - 0.5, 0).normalize(), 3.2, 0.06, 3.4));
    sh.tension += c.len * 0.5;
    sh.energy = Math.min(6, sh.energy + 2);
    sh.dirty = true;
    kick(0, -0.05);
  };
  // はじく: 切れ目の帯がちぎれて、指の向きへ飛ぶ。
  const tear = (sh: Sheet, c: Cut, speed: number) => {
    const n = c.xs.length;
    if (n < 4) return;
    c.heal = 1.7;
    sh.dirty = true;
    const L: V2[] = [];
    const Rt: V2[] = [];
    for (let i = 0; i < n; i++) {
      const a = Math.max(0, i - 1);
      const b = Math.min(n - 1, i + 1);
      let tx = c.xs[b] - c.xs[a];
      let ty = c.ys[b] - c.ys[a];
      const tl = Math.hypot(tx, ty) || 1;
      tx /= tl;
      ty /= tl;
      const hw = c.w * lens(c.ss[i] / c.len) * Math.min(1, c.len / 0.45) * 1.6;
      L.push({ x: c.xs[i] - ty * hw, y: c.ys[i] + tx * hw });
      Rt.push({ x: c.xs[i] + ty * hw, y: c.ys[i] - tx * hw });
    }
    const poly = [...L, ...Rt.reverse()];
    const cx = c.xs.reduce((a, q) => a + q, 0) / n;
    const cy = c.ys.reduce((a, q) => a + q, 0) / n;
    const dx = (c.xs[n - 1] - c.xs[0]) / (c.len || 1);
    const dy = (c.ys[n - 1] - c.ys[0]) / (c.len || 1);
    const v = Math.min(1.6, speed * 0.18);
    pieces.push(makePiece(sh, poly, cx, cy, new T.Vector3(dx * v, dy * v, 1.5), new T.Vector3(dx, dy, 0).normalize(), 9, 0, 3));
    sh.energy = Math.min(6, sh.energy + 2.5);
    sh.tension += c.len * 0.4;
    kick(dx * 0.06, dy * 0.05);
  };

  // ---------------------------------------------------------------- 指の動きの読み分け(人の指も、自動のペンも同じ道を通る)
  type Press = { x: number; y: number; a: number; tr: number };
  type Gest = { t0: number; p0: V2; moved: boolean; cut: Cut | null; press: Press; drag: Press | null; lastP: V2; lastT: number; lastRip: number };
  let gest: Gest | null = null;
  const gDown = (p: V2) => {
    const sh = activeSheet();
    if (!sh || phase !== 'cut') return;
    const press = { x: p.x, y: p.y, a: 0.004, tr: -1 };
    sh.presses.push(press);
    gest = { t0: now, p0: p, moved: false, cut: null, press, drag: null, lastP: p, lastT: now, lastRip: now };
  };
  const gMove = (p: V2) => {
    const g = gest;
    if (!g) return;
    const sh = activeSheet();
    if (!sh || phase !== 'cut') return;
    if (!g.moved && Math.hypot(p.x - g.p0.x, p.y - g.p0.y) > 0.02) {
      g.moved = true;
      g.press.tr = now;
      g.press.a = Math.max(g.press.a, 0.01);
      g.cut = startCut();
      if (g.cut) extend(g.cut, g.p0);
      g.drag = { x: p.x, y: p.y, a: 0.016, tr: -1 };
      sh.presses.push(g.drag);
    }
    if (g.moved && g.cut && gest === g) {
      extend(g.cut, p);
      // 指の通り道: 面が指について波打ち、速く動かすほど面全体が揺れる
      const dtt = Math.max(1 / 120, now - g.lastT);
      const v = Math.hypot(p.x - g.lastP.x, p.y - g.lastP.y) / dtt;
      sh.energy = Math.min(6, sh.energy + v * dtt * 1.4);
      if (g.drag) {
        g.drag.x = p.x;
        g.drag.y = p.y;
        g.drag.a = Math.min(0.03, 0.01 + v * 0.006);
      }
      if (now - g.lastRip > 0.22 && v > 0.3) {
        sh.presses.push({ x: p.x, y: p.y, a: Math.min(0.025, 0.008 + v * 0.004), tr: now });
        if (g.drag) {
          // ドラッグのへこみを最後尾に保つ
          const i = sh.presses.indexOf(g.drag);
          if (i >= 0) sh.presses.splice(i, 1);
          sh.presses.push(g.drag);
        }
        g.lastRip = now;
      }
      g.lastP = p;
      g.lastT = now;
    }
  };
  const gUp = () => {
    const g = gest;
    gest = null;
    if (!g) return;
    if (g.press.tr < 0) g.press.tr = now;
    if (g.drag) g.drag.tr = now;
    const sh = activeSheet();
    if (!sh || phase !== 'cut') return;
    const dur = now - g.t0;
    if (!g.moved) {
      if (dur < 0.3) punch(sh, g.p0, 1);
      else if (dur > 1.1) punch(sh, g.p0, 2.4);
      else {
        sh.tension += 0.15;
        checkTension(sh, g.p0);
      }
      return;
    }
    const c = g.cut;
    if (!c || c.xs.length < 2) return;
    const n = c.xs.length;
    const gap = Math.hypot(c.xs[0] - c.xs[n - 1], c.ys[0] - c.ys[n - 1]);
    const speed = c.len / Math.max(dur, 0.05);
    if (c.len > 0.35 && gap < Math.max(0.09, c.len * 0.14)) cutout(sh, c);
    else if (speed > 2.0 && c.len > 0.18 && (sh.kind === 'photo' || sh.kind === 'floor')) tear(sh, c, speed);
    checkTension(sh, { x: c.xs[n - 1], y: c.ys[n - 1] });
  };

  // ---------------------------------------------------------------- 入力(指)
  let down = false;
  let lastX = 0;
  let lastY = 0;
  let lastInput = -10;
  const toPlane = (e: PointerEvent) => {
    const sh = activeSheet();
    if (!sh) return null;
    const r = canvas.getBoundingClientRect();
    return hitPlane(e.clientX - r.left, e.clientY - r.top, sh.z);
  };
  const onDown = (e: PointerEvent) => {
    if (stage >= 4) return;
    down = true;
    lastInput = now;
    act = null;
    if (gest) {
      gest.press.tr = now;
      gest = null;
    }
    lastX = e.clientX;
    lastY = e.clientY;
    root.setPointerCapture?.(e.pointerId);
    const p = toPlane(e);
    if (p) gDown(p);
  };
  const onMove = (e: PointerEvent) => {
    if (down) kick((e.clientX - lastX) * 0.0007, -(e.clientY - lastY) * 0.0006);
    lastY = e.clientY;
    if (!down) {
      lastX = e.clientX;
      return;
    }
    lastInput = now;
    if (stage === 3) orbitV += (e.clientX - lastX) * 0.00004;
    lastX = e.clientX;
    const p = toPlane(e);
    if (p) gMove(p);
  };
  const onUp = () => {
    if (!down) return;
    down = false;
    lastInput = now;
    gUp();
  };
  root.addEventListener('pointerdown', onDown);
  root.addEventListener('pointermove', onMove);
  root.addEventListener('pointerup', onUp);
  root.addEventListener('pointercancel', onUp);

  // ---------------------------------------------------------------- 自動のペン: 引く・はじく・叩く・押す・囲むを、毎回ちがう順で混ぜる
  type Act = { pts: V2[]; t0: number; dur: number; hold: number; i: number; downed: boolean };
  let act: Act | null = null;
  let autoN = 0;
  const KINDS = ['stroke', 'tap', 'loop', 'flick', 'taps', 'hold', 'stroke', 'flick', 'loop', 'scribble'];
  const makeAuto = () => {
    const R = rng(100 + autoN * 7 + stage * 31 + cycle * 101);
    const kind = KINDS[(autoN * 3 + stage * 2 + cycle * 5 + Math.floor(R() * 3)) % KINDS.length];
    autoN++;
    const sc = stage === 3 ? 0.85 : 1;
    const hw = (VW / 2) * 0.85 * sc;
    const hh = (VH / 2) * 0.75 * sc;
    const rp = (): V2 => ({ x: (R() * 2 - 1) * hw * 0.8, y: (R() * 2 - 1) * hh * 0.8 });
    let pts: V2[] = [];
    let dur = 0.9;
    let hold = 0;
    if (kind === 'stroke' || kind === 'scribble') {
      const side = R() < 0.5 ? -1 : 1;
      const p0 = { x: side * hw * (0.4 + R() * 0.6), y: (R() * 2 - 1) * hh };
      const p3 = { x: -side * hw * (0.3 + R() * 0.6), y: (R() * 2 - 1) * hh };
      const p1 = { x: p0.x * 0.2 + (R() - 0.5) * 0.6, y: p0.y + (R() - 0.5) * 1.2 };
      const p2 = { x: p3.x * 0.2 + (R() - 0.5) * 0.6, y: p3.y + (R() - 0.5) * 1.2 };
      for (let i = 0; i <= 60; i++) {
        const t = i / 60;
        const u = 1 - t;
        const zig = kind === 'scribble' ? Math.sin(i * 1.7) * 0.06 : 0;
        pts.push({
          x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x + zig,
          y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y + zig * 0.6,
        });
      }
      dur = kind === 'scribble' ? 1.2 : 0.95;
    } else if (kind === 'flick') {
      const a = rp();
      const ang = R() * Math.PI * 2;
      const L = 0.45 + R() * 0.35;
      for (let i = 0; i <= 10; i++) pts.push({ x: a.x + Math.cos(ang) * L * (i / 10), y: a.y + Math.sin(ang) * L * (i / 10) });
      dur = 0.13;
    } else if (kind === 'loop') {
      const c = rp();
      const r = 0.14 + R() * 0.12;
      const ex = 0.8 + R() * 0.5;
      for (let i = 0; i <= 40; i++) {
        const a = (i / 40) * Math.PI * 2.04;
        pts.push({ x: c.x + Math.cos(a) * r * ex, y: c.y + Math.sin(a) * r });
      }
      dur = 0.85;
    } else if (kind === 'hold') {
      pts = [rp()];
      dur = 0.05;
      hold = 1.25;
    } else {
      pts = [rp()];
      dur = 0.05;
      hold = 0.04;
    }
    act = { pts, t0: now, dur, hold, i: 0, downed: false };
    // 叩くのは、続けて何回か
    if (kind === 'taps') tapsLeft = 3 + Math.floor(R() * 3);
  };
  let tapsLeft = 0;
  const runAuto = () => {
    const a = act;
    if (!a) return;
    if (!a.downed) {
      a.downed = true;
      gDown(a.pts[0]);
    }
    const k = clamp((now - a.t0) / a.dur);
    const upto = Math.floor(k * (a.pts.length - 1));
    while (act === a && a.i <= upto) gMove(a.pts[a.i++]);
    if (act === a && now - a.t0 >= a.dur + a.hold) {
      gUp();
      act = null;
      lastInput = now - (tapsLeft > 0 ? 1.15 : 0.85);
      if (tapsLeft > 0) {
        tapsLeft--;
        const R = rng(autoN * 13 + tapsLeft);
        act = { pts: [{ x: (R() * 2 - 1) * VW * 0.32, y: (R() * 2 - 1) * VH * 0.32 }], t0: now + 0.12, dur: 0.05, hold: 0.04, i: 0, downed: false };
      }
    }
  };

  // ---------------------------------------------------------------- 落ち方(毎回ちがう)
  const MODES: ('shatter' | 'peel' | 'sink')[][] = [
    ['shatter', 'sink'],
    ['shatter', 'peel'],
  ];
  const beginTransition = (sh: Sheet, p: V2) => {
    act = null;
    if (stage === 3) {
      if (cycle >= 1) return startFlip();
      mode = 'floor';
      return startCrack(sh, p);
    }
    if (sh.kind === 'glass') {
      mode = 'shatter';
      return startCrack(sh, p);
    }
    let m = MODES[cycle % 2][stage] ?? 'shatter';
    if (m === 'peel' && sh.kind !== 'photo') m = 'sink';
    mode = m;
    if (m === 'shatter') return startCrack(sh, p);
    sinkP.x = p.x;
    sinkP.y = p.y;
    startFall();
  };
  let crackFrom: V2 = { x: 0, y: 0 };
  const startCrack = (sh: Sheet, p: V2) => {
    phase = 'crack';
    phaseT = 0;
    crackFrom = p;
    const R = rng(stage * 13 + cycle * 7 + 3);
    const cracks: Cut[] = [];
    for (const c of sh.cuts) {
      if (c.crack || c.len < 0.12) continue;
      for (const end of [0, 1]) {
        const n = c.xs.length;
        const i = end ? n - 1 : 0;
        const j = end ? Math.max(0, n - 6) : Math.min(n - 1, 5);
        let dx = c.xs[i] - c.xs[j];
        let dy = c.ys[i] - c.ys[j];
        const l = Math.hypot(dx, dy) || 1;
        dx /= l;
        dy /= l;
        const k = newCut(sh.kind === 'glass' ? 0.003 : 0.0035, true);
        let x = c.xs[i];
        let y = c.ys[i];
        let s2 = 0;
        const jag = sh.kind === 'glass' ? 0.0 : 0.006;
        while (Math.abs(x) < sh.w / 2 + 0.05 && Math.abs(y) < sh.h / 2 + 0.05 && s2 < 6) {
          k.xs.push(x);
          k.ys.push(y);
          k.ss.push(s2);
          k.bs.push(now);
          const a = (R() - 0.5) * (sh.kind === 'glass' ? 0.05 : 0.5);
          const ndx = dx * Math.cos(a) - dy * Math.sin(a);
          const ndy = dx * Math.sin(a) + dy * Math.cos(a);
          dx = dx * 0.8 + ndx * 0.2;
          dy = dy * 0.8 + ndy * 0.2;
          const ll = Math.hypot(dx, dy);
          dx /= ll;
          dy /= ll;
          x += dx * 0.02 + (R() - 0.5) * jag;
          y += dy * 0.02 + (R() - 0.5) * jag;
          s2 += 0.02;
        }
        k.len = s2;
        k.t0 = now + R() * 0.08;
        k.dur = 0.32 + s2 * 0.05;
        cracks.push(k);
      }
    }
    // 切れ目が少ないとき(叩いた穴だけ等)は、穴から縁へひびを走らせる
    if (!cracks.length) radial(sh, p.x, p.y, 0.02, 5, 2, 0.5, R);
    sh.cuts.push(...cracks);
    sh.dirty = true;
  };
  const startFall = () => {
    const sh = activeSheet()!;
    phase = 'fall';
    phaseT = 0;
    const glass = sh.kind === 'glass';
    camFrom.copy(camera.position);
    lookFrom.copy(tmpL);
    if (mode === 'shatter' || mode === 'floor') {
      pieces.push(...shatter(sh, crackFrom, glass ? { speed: 0.6, spin: 1.6, g: 3.2 } : { speed: 1.0, spin: 1.1, g: 2.6 }));
      sh.mesh.visible = false;
      if (mode === 'shatter') sh.group.userData.fall = { t: 0 };
    }
    if (mode === 'peel') {
      const corner = [
        [1, 1],
        [-1, 1],
        [1, -1],
        [-1, -1],
      ][cycle % 4];
      const dv = new T.Vector2(corner[0] * sh.w, corner[1] * sh.h).normalize();
      sh.mat.uniforms.uPeelDir.value.copy(dv);
      sh.group.userData.peel = { from: Math.abs(dv.x) * sh.w * 0.5 + Math.abs(dv.y) * sh.h * 0.5 };
      sh.mat.uniforms.uPeel.value = sh.group.userData.peel.from;
    }
    if (mode === 'floor') {
      lines.visible = false;
      cycle++;
      buildCycle(floorZ - D);
    }
    flash = glass ? 3 : 2;
    setSec(glass ? 'drop' : 'chorus');
    addEdge(sh.kind === 'photo' ? 'rgba(236,233,226,0.9)' : sh.kind === 'board' ? 'rgba(150,140,130,0.9)' : sh.kind === 'glass' ? 'rgba(170,230,240,0.9)' : 'rgba(220,235,255,0.9)');
  };
  const fallDur = () => (mode === 'floor' ? 1.9 : activeSheet()?.kind === 'glass' ? 1.9 : mode === 'peel' ? 1.7 : mode === 'sink' ? 1.6 : 1.3);
  const endFall = () => {
    if (mode === 'floor') {
      stage = 0;
      lines.visible = true;
      floor.mesh.visible = true;
    } else {
      const sh = sheets[stage];
      sh.gone = true;
      sh.mesh.visible = false;
      if (mode !== 'shatter') sh.group.visible = false;
      stage++;
    }
    phase = 'cut';
    phaseT = 0;
    lastInput = now - 0.6;
    setSec(stage === 3 ? 'C' : stage % 2 ? 'B' : 'A');
    if (stage === 3) snapshot();
  };
  // 結末: 床が裏返る。線は床に寝て(3D → 2D)、裏返った床の下へ。
  const startFlip = () => {
    stage = 4;
    phase = 'fall';
    phaseT = 0;
    setSec('C');
    snapshot();
    addEdge('rgba(220,235,255,0.9)');
  };
  const flipQ = new T.Quaternion();
  const zAxis = new T.Vector3(0, 0, 1);
  const flipAxis = new T.Vector3(DIR28.x, DIR28.y, 0).normalize();

  // ---------------------------------------------------------------- 毎フレーム
  let raf = 0;
  let finished = false;
  const frame = (dt: number) => {
    now += dt;
    phaseT += dt;
    // 押している間、へこみが深くなる
    if (gest && !gest.moved && gest.press.tr < 0) gest.press.a = Math.min(0.055, 0.004 + (now - gest.t0) * 0.05);
    if (autoOn && !down && !act && phase === 'cut' && stage <= 3 && now - lastInput > (now < 2 ? 1.1 : 1.25)) makeAuto();
    if (act && now >= act.t0) runAuto();
    if (stage === 3 || stage === 2) {
      morph += dt * 0.07;
      if (morph >= 1) {
        morph = 0;
        morphs++;
        objI = (objI + 1) % OBJS.length;
        setObj();
      }
      lineMat.uniforms.uM.value = morph;
    }
    lines.rotation.z += dt * 0.12;
    if (phase === 'crack' && phaseT > (activeSheet()?.kind === 'glass' ? 0.42 : 0.55)) startFall();

    // はがす
    for (const sh of sheets) {
      const pe = sh.group.userData.peel as { from: number } | undefined;
      if (!pe || phase !== 'fall') continue;
      const k = eio(clamp(phaseT / 1.5));
      sh.mat.uniforms.uPeel.value = mix(pe.from, -pe.from - 0.6, k);
    }
    // 吸い込まれる: 切れ目と穴が、大きく開く
    if (phase === 'fall' && mode === 'sink' && stage <= 2) {
      const w = 1 + 7 * sstep(0.0, 0.7, phaseT);
      for (const c of sheets[stage].cuts) c.heal = w;
      sheets[stage].dirty = true;
    }

    placeCamera();
    scene.updateMatrixWorld();
    sheets.forEach((sh, i) => {
      if (!sh.gone && !sh.group.userData.fall && !(phase === 'fall' && i === stage && mode !== 'peel' && mode !== 'sink')) sh.mesh.visible = i <= stage + 1 || stage === 3;
      if (!sh.gone && sh.mesh.visible) sh.update();
    });
    floor.update();
    for (const sh of sheets) if (sh.kind === 'photo') sh.mat.uniforms.uGlow.value = 0.32 + 0.12 * Math.sin(now * 1.4);
    floor.mat.uniforms.uGlow.value = 0.3 + 0.1 * Math.sin(now * 1.4);
    for (const sh of sheets)
      for (const c of sh.cuts) {
        c.strip?.update(c.len);
        c.rod?.update(c.len);
      }

    // 落ちる面に付いている帯・棒
    for (const sh of sheets) {
      const f = sh.group.userData.fall as { t: number } | undefined;
      if (!f) continue;
      f.t += dt;
      const t = Math.max(0, f.t - 0.15);
      sh.group.position.z = (sh.group.userData.z0 ?? (sh.group.userData.z0 = sh.group.position.z)) - 1.3 * t * t - 0.2 * t;
      sh.group.position.x = DIR28.x * t * 0.9;
      sh.group.position.y = DIR28.y * t * 0.9;
      sh.group.rotation.z = t * 0.25;
      if (f.t > 3) {
        sh.group.visible = false;
        delete sh.group.userData.fall;
      }
    }
    // 破片
    pieces = pieces.filter((p) => {
      p.t += dt;
      const t = p.t - p.delay;
      if (t < 0) return true;
      p.vel.z -= p.g * dt;
      p.mesh.position.addScaledVector(p.vel, dt);
      p.mesh.quaternion.premultiply(new T.Quaternion().setFromAxisAngle(p.axis, p.spin * dt));
      const below = p.z0 - p.mesh.position.z;
      const isGlass = p.mats[0].uniforms.uKind.value === 2;
      const a = isGlass ? 1 - sstep(DV * 0.75, DV * 1.05, below) : 1 - sstep(D * 0.3, D * 0.8, below);
      for (const m of p.mats) m.uniforms.uAlpha.value = clamp(a);
      if (t > 5 || a <= 0) {
        scene.remove(p.mesh);
        p.mesh.geometry.dispose();
        p.mats.forEach((m) => m.dispose());
        return false;
      }
      return true;
    });
    if (phase === 'fall' && stage <= 3 && phaseT > fallDur()) endFall();

    // 裏返り
    if (stage === 4) {
      const k = eio(clamp((phaseT - 0.15) / 1.5));
      flipQ.setFromAxisAngle(flipAxis, Math.PI * k);
      floor.group.quaternion.setFromAxisAngle(zAxis, -2 * A28 * k).multiply(flipQ);
      lineMat.uniforms.uFlat.value = sstep(0.0, 0.45, phaseT);
      lineMat.uniforms.uAlpha.value = 0.6 * (1 - sstep(0.3, 0.9, phaseT));
      for (const c of floor.cuts) c.heal = 1 - sstep(0.0, 0.7, phaseT);
      floor.fills = phaseT > 0.4 ? [] : floor.fills;
      floor.dirty = true;
      floor.mat.uniforms.uFront.value = mix(0.55, 1.0, sstep(1.2, 1.9, phaseT));
      if (phaseT > 2.0 && !finished) {
        finished = true;
        stage = 5;
        finish();
      }
    }

    // 下の空間を写す(ガラスが見えている間)
    const gi = sheets.findIndex((sh) => sh.kind === 'glass');
    const glassSeen = (stage <= 2 && gi >= 0 && !sheets[gi].gone && stage >= gi - 1) || pieces.some((p) => p.mats[0].uniforms.uKind.value === 2);
    if (glassSeen) {
      camera.layers.set(1);
      renderer.setRenderTarget(rtScene);
      renderer.clear();
      renderer.render(scene, camera);
      renderer.setRenderTarget(null);
    }
    camera.layers.set(0);
    if (stage >= 3 || (stage === 2 && phase === 'fall')) camera.layers.enable(1);
    renderer.render(scene, camera);
    if (flash > 0) {
      root.classList.add('is-flash');
      flash--;
    } else root.classList.remove('is-flash');
  };
  const loop = () => {
    raf = requestAnimationFrame(loop);
    const t = performance.now();
    const dt = Math.min(0.05, (t - last) / 1000);
    last = t;
    if (!frozen) frame(dt);
  };

  // 結末: 動く絵を、本物の一覧に置き換える(絵合わせしてあるので、見た目は動かない)。
  const finish = () => {
    setTimeout(
      () => {
        onDone();
        root.classList.remove('is-live');
        edgeEl.replaceChildren();
      },
      frozen ? 0 : 60
    );
  };

  // 始める: 写真がそろってから(遅くても 2.5 秒で始める)。
  let started = false;
  const start = () => {
    if (started) return;
    started = true;
    paintPhoto();
    paintStrata();
    pics.forEach((p) => p.tex && (p.tex.needsUpdate = true));
    document.fonts?.ready.then(() => snapshot());
    last = performance.now();
    raf = requestAnimationFrame(loop);
  };
  loaded.then(start);
  const guard = setTimeout(start, 2500);

  // 確認用: 時計を止めて、決まった手順で進められる。
  (window as any).__depth = {
    freeze: (b: boolean) => (frozen = b),
    auto: (b: boolean) => (autoOn = b),
    step: (n = 1, dt = 1 / 60) => {
      for (let i = 0; i < n; i++) frame(dt);
    },
    jump: (to: number) => {
      for (let i = 0; i < to && i < 3; i++) {
        sheets[i].gone = true;
        sheets[i].mesh.visible = false;
        sheets[i].group.visible = false;
      }
      stage = to;
      phase = 'cut';
      phaseT = 0;
      lastInput = now;
      if (to >= 3) snapshot();
    },
    dbg: () => ({ scene, floor, sheets, camera, pieces, snapCv, backCv, lineMat }),
    state: () => ({ stage, cycle, phase, mode, phaseT, now, tension: activeSheet()?.tension ?? 0, pieces: pieces.length, objI, morph }),
    ready: () => loaded,
  };

  return () => {
    cancelAnimationFrame(raf);
    clearTimeout(guard);
    root.removeEventListener('pointerdown', onDown);
    root.removeEventListener('pointermove', onMove);
    root.removeEventListener('pointerup', onUp);
    root.removeEventListener('pointercancel', onUp);
    sheets.forEach((sh) => sh.dispose());
    floor.dispose();
    pieces.forEach((p) => scene.remove(p.mesh));
    rtScene.dispose();
    renderer.dispose();
    delete document.documentElement.dataset.sec;
  };
}
