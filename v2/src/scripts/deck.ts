// 試作 /lab/deck/ : 手札の見本帳。
//
// 本人(2026-11-24):
//  「3Dやもろもろを、どうジェネラティブアートとして見せるかの手札が足りてないだけ」
//  「まずは僕が渡したリファレンスと、あなたが探したリファレンスを、今回の表現に落とし込んで全部実装」
//  「いいね!他のフリーの3D拾ってきて使ったり、帯と融合させたり帯に落とし込んだりしたら」
//  「タッチしないと次にいかないのは勿体無い。あとは指で動いたりって言うのも欲しい」
//
// 1枚の札 = 1つの見せ方。札の一覧は claude/deck-2026-11-24.md。
//  ・16拍ごとに、拍の頭で次の札へ切り替わる(順番は ばらばら)。叩いても次へ。左端で前へ。← → でも。
//  ・指(カーソル)でなぞると、形が回り、指のまわりで札ごとの反応が起きる。帯の札では、なぞった線が帯になる。
//  ・被写体は、札に入るたびに替わる: 帯、本人のペンダント、預かった像(点の札だけ)、パブリックドメインの立体6つ。
//  ・帯も被写体の1つ。どの札の見せ方も、帯に掛かる。
// 拍は 100BPM。uPulse は拍の頭で 1、次の拍までに 0 へ落ちる。
// /lab/morph/ と /lab/morph-sharp/ には触れていない。

import * as THREE from 'three';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { MeshSurfaceSampler } from 'three/addons/math/MeshSurfaceSampler.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

const BPM = 100;
const LEN = 16; // 1枚の札の長さ(拍)
const N = 40000; // 点の数(200 × 200)
const PAPER = 'vec3(0.957, 0.945, 0.914)';
// パブリックドメイン(CC0)の立体。出どころ: KhronosGroup/glTF-Sample-Assets。面を減らし、形だけにしてある。
const FREE = ['antiquecamera', 'boombox', 'fox', 'corset', 'sheenchair', 'glassvaseflowers'];

const NOISE = /* glsl */ `
float h31(vec3 p){ p = fract(p * vec3(0.1031, 0.1030, 0.0973)); p += dot(p, p.yxz + 33.33); return fract((p.x + p.y) * p.z); }
float n3(vec3 p){ vec3 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(mix(h31(i), h31(i+vec3(1,0,0)), f.x), mix(h31(i+vec3(0,1,0)), h31(i+vec3(1,1,0)), f.x), f.y),
             mix(mix(h31(i+vec3(0,0,1)), h31(i+vec3(1,0,1)), f.x), mix(h31(i+vec3(0,1,1)), h31(i+vec3(1,1,1)), f.x), f.y), f.z); }
float fbm(vec3 p){ return n3(p) * 0.6 + n3(p * 2.03 + 7.1) * 0.3 + n3(p * 4.1 + 3.3) * 0.1; }
vec3 flow(vec3 p, float t){ return vec3(n3(p + vec3(0.0, t, 9.1)) - n3(p + vec3(5.2, -t, 0.0)), n3(p + vec3(t, 3.3, 0.0)) - n3(p + vec3(0.0, 8.7, t)), n3(p + vec3(1.7, 0.0, -t)) - n3(p + vec3(-t, 4.4, 2.2))); }
vec2 cover(vec2 uv, float pa, float ta){ return pa > ta ? vec2(uv.x, (uv.y - 0.5) * ta / pa + 0.5) : vec2((uv.x - 0.5) * pa / ta + 0.5, uv.y); }
mat2 rot(float a){ float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }
// 指のまわりだけ 1 になる(d は指からの距離)。
float near(float d, float r){ return uTouchK * exp(-d * d / (r * r)); }
`;
// 頂点側だけ: 指の位置を、その形の座標に直す。
const TL = `vec3 touchL(){ return (inverse(modelMatrix) * vec4(uTouch, 1.0)).xyz; }\n`;

type Ctx = {
  t: number; dt: number; beat: number; pulse: number; bar: number; // bar: その札に入ってからの拍
  cam: THREE.PerspectiveCamera; asp: number; ptr: THREE.Vector2; touch: THREE.Vector3; touchK: number;
};
type Subject = { name: string; geo: THREE.BufferGeometry | null; p: Float32Array; n: Float32Array };
type Card = {
  id: string; name: string;
  obj?: THREE.Object3D;
  post?: THREE.ShaderMaterial; feedback?: boolean; noScene?: boolean;
  update?: (c: Ctx) => void;
  cam?: (c: Ctx) => void;
  pre?: (r: THREE.WebGLRenderer, c: Ctx) => void; // 描く前に回す計算(反応拡散など)
  subj?: (s: Subject) => void; // 被写体が替わったとき
  needsGeo?: boolean; // 面のある被写体だけ(像は点だけ)
  draw?: boolean; // なぞると、回す代わりに帯を描く札
  fill?: () => void;
};

export function mountDeck(root: HTMLElement): () => void {
  const canvas = root.querySelector<HTMLCanvasElement>('[data-canvas]')!;
  const label = root.querySelector<HTMLElement>('[data-label]');
  const base = root.dataset.base ?? '';
  const photos: string[] = JSON.parse(root.dataset.photos ?? '[]');
  const q = new URLSearchParams(location.search);
  const autoOn = q.get('auto') !== '0';
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
    uTouch: { value: new THREE.Vector3() }, uTouchK: { value: 0 },
    tA: { value: null as THREE.Texture | null }, tB: { value: null as THREE.Texture | null }, tAtlas: { value: null as THREE.Texture | null },
    uAspA: { value: 0.8 }, uAspB: { value: 0.8 }, uAsp: { value: 1 }, uMeanA: { value: 0.5 }, uAtlasN: { value: 1 },
  };
  const HEAD = `uniform float uTime, uBeat, uPulse, uBar, uAspA, uAspB, uAsp, uMeanA, uTouchK, uAtlasN; uniform vec2 uRes, uPtr; uniform vec3 uTouch; uniform sampler2D tA, tB, tAtlas;\n${NOISE}`;
  const mat = (vs: string, fs: string, extra: Record<string, { value: unknown }> = {}, opt: THREE.ShaderMaterialParameters = {}) =>
    new THREE.ShaderMaterial({ uniforms: { ...S, ...extra }, vertexShader: HEAD + TL + vs, fragmentShader: HEAD + fs, ...opt });
  const ADD: THREE.ShaderMaterialParameters = { blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, transparent: true };
  const DS = { side: THREE.DoubleSide };
  const FSQ = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
  const attr = (a: Float32Array, n = 3) => new THREE.BufferAttribute(a, n);
  const smooth = (x: number) => { const v = Math.max(0, Math.min(1, x)); return v * v * (3 - 2 * v); };
  const rnd = new Float32Array(N).map(() => Math.random());
  const cards: Card[] = [];

  // ---- 写真(2枚ずつ使う)と、帯に並べる写真の帳面
  const loader = new THREE.TextureLoader();
  const tex: THREE.Texture[] = [];
  const blank = new THREE.DataTexture(new Uint8Array([40, 40, 40, 255]), 1, 1);
  blank.needsUpdate = true;
  S.tA.value = blank; S.tB.value = blank; S.tAtlas.value = blank;
  let photoAt = 0;
  const setPhotos = () => {
    if (!tex.length) return;
    const L = tex.length, i0 = ((photoAt % L) + L) % L;
    const a = tex[i0], b = tex[(i0 + 1) % L];
    S.tA.value = a; S.tB.value = b;
    S.uAspA.value = a.image.width / a.image.height; S.uAspB.value = b.image.width / b.image.height;
    S.uMeanA.value = a.userData.mean ?? 0.5;
  };
  const CW = 384, CH = 256; // 帯の1コマ(横長 1.5:1)
  const atlasCv = document.createElement('canvas');
  const atlasTex = new THREE.CanvasTexture(atlasCv);
  atlasTex.colorSpace = THREE.NoColorSpace; atlasTex.wrapS = THREE.RepeatWrapping; atlasTex.minFilter = THREE.LinearFilter; atlasTex.generateMipmaps = false;
  const NP = Math.max(1, Math.min(12, photos.length));
  atlasCv.width = CW * NP; atlasCv.height = CH; // 大きさは最初に決める(あとから変えると、貼り直しで失敗する)
  const buildAtlas = () => {
    const cx = atlasCv.getContext('2d')!;
    tex.forEach((t, i) => {
      const im = t.image as HTMLImageElement, a = im.width / im.height, pa = CW / CH;
      const sw = a > pa ? im.height * pa : im.width, sh = a > pa ? im.height : im.width / pa;
      cx.drawImage(im, (im.width - sw) / 2, (im.height - sh) / 2, sw, sh, i * CW, 0, CW, CH);
    });
    // まだ届いていないコマは、届いた写真を繰り返して埋める。
    for (let i = tex.length; i < NP; i++) cx.drawImage(atlasCv, (i % tex.length) * CW, 0, CW, CH, i * CW, 0, CW, CH);
    atlasTex.needsUpdate = true; S.tAtlas.value = atlasTex; S.uAtlasN.value = NP;
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
    buildAtlas();
    cards.forEach((c) => c.fill?.());
  }));

  // ---- 帯の道すじ(なぞった線)。既定は、画面いっぱいの ひと筆の輪。
  const BW = 0.3; // 帯の幅
  let path: number[][] = [];
  for (let i = 0; i <= 500; i++) { const a = (i / 500) * Math.PI * 2 * 0.94 + 0.2; path.push([0.82 * Math.sin(5 * a + 0.6), 1.12 * Math.sin(4 * a)]); }
  const PM = 500; // 道すじを均した点の数
  const px = new Float32Array(PM), py = new Float32Array(PM), pnx = new Float32Array(PM), pny = new Float32Array(PM);
  let pathLen = 1;
  function setPath(src: number[][]) {
    const acc = [0];
    for (let i = 1; i < src.length; i++) acc.push(acc[i - 1] + Math.hypot(src[i][0] - src[i - 1][0], src[i][1] - src[i - 1][1]));
    pathLen = Math.max(0.2, acc[acc.length - 1]);
    let j = 0;
    for (let i = 0; i < PM; i++) {
      const d = (i / (PM - 1)) * pathLen;
      while (j < src.length - 2 && acc[j + 1] < d) j++;
      const f = (d - acc[j]) / Math.max(1e-6, acc[j + 1] - acc[j]);
      px[i] = src[j][0] + (src[j + 1][0] - src[j][0]) * f; py[i] = src[j][1] + (src[j + 1][1] - src[j][1]) * f;
    }
    for (let pass = 0; pass < 3; pass++) { let ax = px[0], ay = py[0]; for (let i = 1; i < PM - 1; i++) { const bx = (ax + px[i] * 2 + px[i + 1]) / 4, by = (ay + py[i] * 2 + py[i + 1]) / 4; ax = px[i]; ay = py[i]; px[i] = bx; py[i] = by; } }
    for (let i = 0; i < PM; i++) { const a = Math.max(0, i - 2), b = Math.min(PM - 1, i + 2), tx = px[b] - px[a], ty = py[b] - py[a], l = Math.hypot(tx, ty) || 1; pnx[i] = -ty / l; pny[i] = tx / l; }
  }
  const pathAt = (s: number, out: number[]) => { const f = Math.max(0, Math.min(1, s)) * (PM - 1), j = Math.min(PM - 2, Math.floor(f)), g = f - j; out[0] = px[j] + (px[j + 1] - px[j]) * g; out[1] = py[j] + (py[j + 1] - py[j]) * g; out[2] = pnx[j] + (pnx[j + 1] - pnx[j]) * g; out[3] = pny[j] + (pny[j + 1] - pny[j]) * g; return out; };
  setPath(path);

  // ---- 被写体
  const subjects: Subject[] = [];
  let subjAt = 0;
  // 帯も被写体の1つ: 道すじに沿って、うねって ねじれる帯(面と、面の上の点)。
  const BS = 400, BV = 8;
  const bandGeo = new THREE.BufferGeometry();
  const bandSubj: Subject = { name: '帯', geo: bandGeo, p: new Float32Array(N * 3), n: new Float32Array(N * 3) };
  function bandFrame(s: number, v: number, o: number[], tmp: number[]) {
    pathAt(s, tmp);
    const z = 0.28 * Math.sin(s * 9.0 + 1.0) + 0.14 * Math.sin(s * 23.0), ph = 1.1 * Math.sin(s * 12.0 + 0.5) + 0.5 * Math.sin(s * 31.0);
    const c = Math.cos(ph), sn = Math.sin(ph);
    o[0] = tmp[0] + tmp[2] * v * BW * 1.25 * c; o[1] = tmp[1] + tmp[3] * v * BW * 1.25 * c; o[2] = z + v * BW * 1.25 * sn;
    o[3] = -tmp[2] * sn; o[4] = -tmp[3] * sn; o[5] = c; // 面の向き
  }
  function buildBand() {
    const pos = new Float32Array((BS + 1) * (BV + 1) * 3), idx: number[] = [], o = [0, 0, 0, 0, 0, 0], tmp = [0, 0, 0, 0];
    for (let i = 0; i <= BS; i++) for (let j = 0; j <= BV; j++) { bandFrame(i / BS, j / BV - 0.5, o, tmp); pos.set([o[0], o[1], o[2]], (i * (BV + 1) + j) * 3); }
    for (let i = 0; i < BS; i++) for (let j = 0; j < BV; j++) { const a = i * (BV + 1) + j, b = a + BV + 1; idx.push(a, b, a + 1, a + 1, b, b + 1); }
    bandGeo.setAttribute('position', attr(pos)); bandGeo.setIndex(idx); bandGeo.computeVertexNormals(); bandGeo.computeBoundingSphere();
    for (let i = 0; i < N; i++) { bandFrame(Math.random(), Math.random() - 0.5, o, tmp); bandSubj.p.set([o[0], o[1], o[2]], i * 3); bandSubj.n.set([o[3], o[4], o[5]], i * 3); }
  }
  buildBand();
  subjects.push(bandSubj);
  const applySubject = () => { const s = subjects[subjAt]; cards.forEach((c) => c.subj?.(s)); };
  const pickSubject = (needGeo: boolean) => {
    const ok = subjects.map((s, i) => i).filter((i) => (!needGeo || subjects[i].geo) && i !== subjAt);
    if (ok.length) subjAt = ok[Math.floor(Math.random() * ok.length)];
    applySubject();
  };
  fetch(`${base}/lab/deck/pendant.stl`).then((r) => r.arrayBuffer()).then((b) => {
    if (dead) return;
    let g = new STLLoader().parse(b);
    g.deleteAttribute('normal');
    g = mergeVertices(g, 1e-4);
    g.rotateX(-Math.PI / 2); // データの上(z)を、画面の上(y)に
    g.center(); g.computeBoundingBox();
    const k = 2.4 / (g.boundingBox!.max.y - g.boundingBox!.min.y);
    g.scale(k, k, k); g.computeVertexNormals();
    const s: Subject = { name: 'ペンダント', geo: g, p: new Float32Array(N * 3), n: new Float32Array(N * 3) };
    const sampler = new MeshSurfaceSampler(new THREE.Mesh(g)).build();
    const p = new THREE.Vector3(), n = new THREE.Vector3();
    for (let i = 0; i < N; i++) { sampler.sample(p, n); s.p.set([p.x, p.y, p.z], i * 3); s.n.set([n.x, n.y, n.z], i * 3); }
    subjects.push(s); if (subjAt === 0) applySubject(); // 帯の札は、ほかの立体が届いたら巻き直す
  });
  fetch(`${base}/lab/deck/puck.bin`).then((r) => r.arrayBuffer()).then((b) => {
    if (dead) return;
    const d = new Int16Array(b), s: Subject = { name: '像', geo: null, p: new Float32Array(N * 3), n: new Float32Array(N * 3) };
    for (let i = 0; i < N; i++) for (let k = 0; k < 3; k++) { s.p[i * 3 + k] = (d[i * 6 + k] / 32000) * 2.4; s.n[i * 3 + k] = d[i * 6 + 3 + k] / 32000; }
    subjects.push(s); if (subjAt === 0) applySubject(); // 帯の札は、ほかの立体が届いたら巻き直す
  });
  FREE.forEach((name) => fetch(`${base}/lab/deck/${name}.bin`).then((r) => r.arrayBuffer()).then((b) => {
    if (dead) return;
    const [nv, ni] = new Uint32Array(b, 0, 2);
    const v = new Int16Array(b, 8, nv * 3), ix = new Uint16Array(b, 8 + nv * 6, ni);
    let off = 8 + nv * 6 + ni * 2; if ((nv * 6 + ni * 2) % 4) off += 2;
    const d = new Int16Array(b, off, N * 6);
    const pos = new Float32Array(nv * 3); for (let i = 0; i < nv * 3; i++) pos[i] = (v[i] / 32000) * 1.25;
    const g = new THREE.BufferGeometry(); g.setAttribute('position', attr(pos)); g.setIndex(new THREE.BufferAttribute(new Uint16Array(ix), 1)); g.computeVertexNormals(); g.computeBoundingSphere();
    const s: Subject = { name, geo: g, p: new Float32Array(N * 3), n: new Float32Array(N * 3) };
    for (let i = 0; i < N; i++) for (let k = 0; k < 3; k++) { s.p[i * 3 + k] = (d[i * 6 + k] / 32000) * 1.25; s.n[i * 3 + k] = d[i * 6 + 3 + k] / 32000; }
    subjects.push(s); if (subjAt === 0) applySubject(); // 帯の札は、ほかの立体が届いたら巻き直す
  }));

  // 面の被写体を置く札の共通。被写体が替わると、形を差し替える。
  const subjMesh = (m: THREE.Material, into: THREE.Object3D) => { const o = new THREE.Mesh(bandGeo, m); o.frustumCulled = false; into.add(o); return (s: Subject) => { if (s.geo) o.geometry = s.geo; }; };
  const PV = /* glsl */ `varying vec3 vN, vP, vW, vV, vT; void main(){ vP = position; vT = touchL(); vN = normalize(normalMatrix * normal); vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; vec4 mv = viewMatrix * w; vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`;
  const PF = `varying vec3 vN, vP, vW, vV, vT;`;
  // 点の被写体を置く札の共通。
  const subjPoints = (g: THREE.BufferGeometry, pName = 'position') => (s: Subject) => { g.setAttribute(pName, attr(s.p)); g.setAttribute('aN', attr(s.n)); };

  // ======================================================================= W1 帯が、立体を巻く
  {
    const SEG = 1500, WS = 6, VN = (SEG + 1) * (WS + 1);
    const g = new THREE.BufferGeometry();
    const flat = new Float32Array(VN * 3), wrap = new Float32Array(VN * 3), sv = new Float32Array(VN * 2), idx: number[] = [];
    for (let i = 0; i <= SEG; i++) for (let j = 0; j <= WS; j++) sv.set([i / SEG, j / WS - 0.5], (i * (WS + 1) + j) * 2);
    for (let i = 0; i < SEG; i++) for (let j = 0; j < WS; j++) { const a = i * (WS + 1) + j, b = a + WS + 1; idx.push(a, b, a + 1, a + 1, b, b + 1); }
    g.setAttribute('position', attr(flat)); g.setAttribute('aWrap', attr(wrap)); g.setAttribute('aSV', attr(sv, 2)); g.setIndex(idx);
    const TH = 96, HH = 64, shell = new Float32Array(TH * HH);
    let cur: Subject = bandSubj;
    const m = mat(/* glsl */ `
      attribute vec3 aWrap; attribute vec2 aSV; uniform float uW, uRot, uRep; varying vec2 vUv; varying vec3 vW; varying float vK;
      void main(){
        // 巻き付きは、帯の端から順に進む。
        float w = smoothstep(0.0, 1.0, clamp(uW * 1.8 - 0.8 * aSV.x, 0.0, 1.0));
        vec3 b = aWrap; b.xz = rot(uRot) * b.xz;
        vec3 p = mix(position, b, w);
        p.z += sin(w * 3.1416) * (0.5 + 0.4 * sin(aSV.x * 40.0));          // 移る途中は、手前に浮く
        p += vec3(0.0, 0.0, 0.05) * uPulse * sin(aSV.x * 60.0 + uTime * 4.0) * (1.0 - w);
        float nf = near(distance(p, uTouch), 0.45); p.z += nf * 0.35;       // 指のまわりが、持ち上がる
        vUv = vec2(aSV.x * uRep, aSV.y + 0.5); vK = w;
        vec4 wp = modelMatrix * vec4(p, 1.0); vW = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`, /* glsl */ `varying vec2 vUv; varying vec3 vW; varying float vK;
      void main(){
        vec3 n = normalize(cross(dFdx(vW), dFdy(vW)));
        float lit = 0.55 + 0.45 * abs(dot(n, normalize(vec3(0.3, 0.5, 0.8))));
        vec3 c = texture2D(tAtlas, vec2(vUv.x / uAtlasN, vUv.y)).rgb;
        gl_FragColor = vec4(c * mix(1.0, lit, vK), 1.0);
      }`, { uW: { value: 0 }, uRot: { value: 0 }, uRep: { value: 20 } }, DS);
    const obj = new THREE.Mesh(g, m); obj.frustumCulled = false;
    const tmp = [0, 0, 0, 0];
    const layFlat = () => { // 平らな帯。あとから描いた所が、少し上に来る(重なりの順番)。
      for (let i = 0; i <= SEG; i++) { pathAt(i / SEG, tmp); for (let j = 0; j <= WS; j++) { const v = (j / WS - 0.5) * BW; flat.set([tmp[0] + tmp[2] * v, tmp[1] + tmp[3] * v, (i / SEG) * 0.2], (i * (WS + 1) + j) * 3); } }
      g.attributes.position.needsUpdate = true;
      m.uniforms.uRep.value = pathLen / (BW * 1.5);
    };
    const layWrap = () => {
      // 被写体の外形: 縦軸のまわりの角度と高さごとに、いちばん外の半径。
      shell.fill(0);
      const s = cur !== bandSubj ? cur : subjects.find((x) => x !== bandSubj) ?? cur;
      let lo = 1e9, hi = -1e9;
      for (let i = 0; i < N; i++) { const y = s.p[i * 3 + 1]; if (y < lo) lo = y; if (y > hi) hi = y; }
      for (let i = 0; i < N; i++) {
        const x = s.p[i * 3], y = s.p[i * 3 + 1], z = s.p[i * 3 + 2];
        const a = Math.min(TH - 1, Math.floor(((Math.atan2(z, x) / (Math.PI * 2) + 1) % 1) * TH)), h = Math.min(HH - 1, Math.floor(((y - lo) / (hi - lo + 1e-6)) * HH));
        const r = Math.hypot(x, z); if (r > shell[h * TH + a]) shell[h * TH + a] = r;
      }
      for (let pass = 0; pass < 3; pass++) { // 穴を埋めて、ならす
        const c = shell.slice();
        for (let h = 0; h < HH; h++) for (let a = 0; a < TH; a++) {
          let sum = 0, n = 0, mx = 0;
          for (let dh = -1; dh <= 1; dh++) for (let da = -1; da <= 1; da++) { const v = c[Math.max(0, Math.min(HH - 1, h + dh)) * TH + ((a + da + TH) % TH)]; if (v > 0) { sum += v; n++; if (v > mx) mx = v; } }
          shell[h * TH + a] = n ? (c[h * TH + a] > 0 ? (sum / n) * 0.5 + mx * 0.5 : sum / n) : 0;
        }
      }
      const R = (th: number, y: number) => {
        const fa = ((((th / (Math.PI * 2)) % 1) + 1) % 1) * TH, fh = Math.max(0, Math.min(HH - 1.001, ((y - lo) / (hi - lo + 1e-6)) * HH - 0.5));
        const a0 = Math.floor(fa) % TH, a1 = (a0 + 1) % TH, h0 = Math.floor(fh), h1 = Math.min(HH - 1, h0 + 1), ga = fa - Math.floor(fa), gh = fh - h0;
        return Math.max(0.06, (shell[h0 * TH + a0] * (1 - ga) + shell[h0 * TH + a1] * ga) * (1 - gh) + (shell[h1 * TH + a0] * (1 - ga) + shell[h1 * TH + a1] * ga) * gh) + 0.02;
      };
      // 巻き数は、帯の長さで決まる(長く描けば、たくさん巻く)。
      let mean = 0; for (let i = 0; i < 200; i++) mean += R(i * 0.7, lo + ((i % 20) / 19) * (hi - lo)); mean /= 200;
      const turns = Math.max(2, Math.min(14, pathLen / (Math.PI * 2 * mean)));
      for (let i = 0; i <= SEG; i++) {
        const u = i / SEG, th = u * turns * Math.PI * 2, y = lo + 0.04 + u * (hi - lo - 0.08);
        for (let j = 0; j <= WS; j++) {
          const yy = y + (j / WS - 0.5) * BW, r = R(th, yy);
          wrap.set([r * Math.cos(th), yy, r * Math.sin(th)], (i * (WS + 1) + j) * 3);
        }
      }
      g.attributes.aWrap.needsUpdate = true;
    };
    layFlat(); layWrap();
    cards.push({ id: 'W1', name: '帯が、立体を巻く(なぞると、その線が帯になる)', obj, draw: true,
      subj: (s) => { cur = s; layWrap(); },
      fill: () => { layFlat(); layWrap(); },
      update: (c) => {
        const k = smooth((c.bar - 3) / 4) * (1 - smooth((c.bar - 13) / 3));
        m.uniforms.uW.value = k; m.uniforms.uRot.value = c.t * 0.5;
      },
      cam: (c) => orbit(c, 0, 0, 5.2, true) });
  }

  // ======================================================================= A1 / W2 点にして、別の形へ移す(写真の板から/帯から)
  const morphCard = (fromBand: boolean) => {
    const g = new THREE.BufferGeometry();
    const src = new Float32Array(N * 3), uv = new Float32Array(N * 2);
    const lay = () => {
      const tmp = [0, 0, 0, 0];
      for (let i = 0; i < N; i++) {
        if (fromBand) { const s = i / N, v = rnd[(i * 7) % N] - 0.5; pathAt(s, tmp); src.set([tmp[0] + tmp[2] * v * BW, tmp[1] + tmp[3] * v * BW, 0], i * 3); uv.set([(s * pathLen) / (BW * 1.5), v + 0.5], i * 2); }
        else { const x = (i % 200) / 199, y = Math.floor(i / 200) / 199; src.set([(x - 0.5) * 1.9, (y - 0.5) * 2.375, 0], i * 3); uv.set([x, y], i * 2); }
      }
      g.setAttribute('position', attr(src)); g.setAttribute('aUv', attr(uv, 2));
    };
    lay();
    g.setAttribute('aR', attr(rnd, 1)); g.setAttribute('aB', attr(new Float32Array(N * 3)));
    const m = mat(/* glsl */ `
      attribute vec3 aB; attribute vec2 aUv; attribute float aR; uniform float uK, uRot; varying vec3 vC;
      void main(){
        float w = smoothstep(0.0, 1.0, clamp(uK * 1.6 - 0.6 * aR, 0.0, 1.0));
        vec3 b = aB; b.xz = rot(uRot) * b.xz;
        vec3 p = mix(position, b, w);
        p += flow(p * 1.3 + aR * 9.0, uTime * 0.3) * sin(w * 3.1416) * 0.9;
        vec3 d = p - uTouch; p += normalize(d + 1e-4) * near(length(d), 0.5) * 0.45;   // 指から逃げる
        vC = ${fromBand ? 'texture2D(tAtlas, vec2(aUv.x / uAtlasN, aUv.y)).rgb' : 'texture2D(tA, cover(aUv, 0.8, uAspA)).rgb'};
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_PointSize = uRes.y * ${fromBand ? '0.0085' : '0.0105'} / -mv.z * (1.0 + 0.5 * uPulse);
        gl_Position = projectionMatrix * mv;
      }`, `varying vec3 vC; void main(){ if (length(gl_PointCoord - 0.5) > 0.5) discard; gl_FragColor = vec4(vC, 1.0); }`, { uK: { value: 0 }, uRot: { value: 0 } });
    const obj = new THREE.Points(g, m); obj.frustumCulled = false;
    cards.push({ id: fromBand ? 'W2' : 'A1', name: fromBand ? '帯が点になって、立体に集まる' : '写真が点になって、立体に集まる', obj, draw: fromBand,
      subj: (s) => g.setAttribute('aB', attr(s === bandSubj ? (subjects.find((x) => x !== bandSubj) ?? s).p : s.p)),
      fill: fromBand ? lay : undefined,
      update: (c) => { m.uniforms.uK.value = smooth((c.bar - 2.5) / 3) * (1 - smooth((c.bar - 12.5) / 3)); m.uniforms.uRot.value = c.t * 0.5; },
      cam: (c) => orbit(c, 0, 0.03, 5.3, fromBand) });
  };
  morphCard(true); morphCard(false);

  // ======================================================================= A2 流れに乗せる
  {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', attr(new Float32Array(N * 3))); g.setAttribute('aR', attr(rnd, 1));
    const m = mat(/* glsl */ `
      attribute vec3 aN; attribute float aR; varying float vL;
      void main(){
        vec3 tl = touchL();
        float amp = 0.04 + 0.75 * uPulse * uPulse + 0.25 * (0.5 + 0.5 * sin(uBeat * 0.785)) + near(distance(position, tl), 0.6) * 0.9;
        vec3 p = position;
        for (int i = 0; i < 3; i++) p += flow(p * 1.6 + aR, uTime * 0.25 + float(i)) * amp * 0.5;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        vL = 0.25 + 0.75 * smoothstep(-6.4, -4.2, mv.z);
        gl_PointSize = uRes.y * 0.017 / -mv.z;
        gl_Position = projectionMatrix * mv;
      }`, `varying float vL; void main(){ float d = length(gl_PointCoord - 0.5); if (d > 0.5) discard; gl_FragColor = vec4(${PAPER} * vL * 0.55, 1.0); }`, {}, ADD);
    const obj = new THREE.Points(g, m); obj.frustumCulled = false;
    cards.push({ id: 'A2', name: '流れに乗せる', obj, subj: subjPoints(g), update: (c) => { obj.rotation.y = c.t * 0.3; } });
  }

  // ======================================================================= A3 形に吸い寄せる(粒で覆った塊が、分かれて、くっつく)
  {
    const g = new THREE.BufferGeometry();
    const d = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) { const y = 1 - (2 * (i + 0.5)) / N, r = Math.sqrt(1 - y * y), a = i * 2.39996; d.set([Math.cos(a) * r, y, Math.sin(a) * r], i * 3); }
    g.setAttribute('position', attr(d)); g.setAttribute('aR', attr(rnd, 1));
    const m = mat(/* glsl */ `
      attribute float aR; varying vec3 vC;
      vec3 c0, c1, c2, c3;
      float smin(float a, float b, float k){ float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0); return mix(b, a, h) - k * h * (1.0 - h); }
      float sdf(vec3 p){
        float d = smin(smin(length(p - c0) - 0.78, length(p - c1) - 0.62, 0.45), length(p - c2) - 0.54, 0.45);
        d = smin(d, length(p - c3) - 0.3 * uTouchK, 0.55);   // 指の所に玉が1つ生まれ、塊が そこへ伸びる
        return d + (fbm(p * 2.4 + uTime * 0.2) - 0.5) * 0.3;
      }
      vec3 grad(vec3 p){ vec2 e = vec2(0.02, 0.0); return normalize(vec3(sdf(p + e.xyy) - sdf(p - e.xyy), sdf(p + e.yxy) - sdf(p - e.yxy), sdf(p + e.yyx) - sdf(p - e.yyx))); }
      void main(){
        float sp = 0.15 + 0.85 * (0.5 - 0.5 * cos(uBeat * 0.3927)); // 8拍で 離れて、戻る
        c0 = vec3(sin(uTime * 0.5), cos(uTime * 0.4), 0.0) * 0.75 * sp;
        c1 = vec3(-sin(uTime * 0.45 + 1.0), 0.3, cos(uTime * 0.5)) * 0.8 * sp;
        c2 = vec3(0.2, -cos(uTime * 0.35), -sin(uTime * 0.55 + 2.0)) * 0.8 * sp;
        c3 = touchL();
        float pick = fract(aR * 3.0); vec3 c = aR < 0.4 ? c0 : (aR < 0.68 ? c1 : (aR < 0.9 || uTouchK < 0.3 ? c2 : c3));
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

  // ======================================================================= B1 スパンコール(小さな円盤が返って、絵が替わる)
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
        a += 3.1416 * near(distance(vec3(aOff, 0.0), touchL()), 0.3);   // 指でなでた所が返る
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
      cam: (c) => orbit(c, Math.sin(c.t * 0.3) * 0.22, Math.cos(c.t * 0.23) * 0.1, 5.0, true) });
  }

  // ======================================================================= B1b 表面に毛を生やす
  {
    const g = new THREE.BufferGeometry();
    const M = 30000, p = new Float32Array(M * 6), n = new Float32Array(M * 6), tip = new Float32Array(M * 2);
    for (let i = 0; i < M * 2; i++) tip[i] = i & 1;
    g.setAttribute('position', attr(p)); g.setAttribute('aN', attr(n)); g.setAttribute('aTip', attr(tip, 1));
    const m = mat(/* glsl */ `
      attribute vec3 aN; attribute float aTip; varying float vL;
      void main(){
        float wv = fbm(position * 1.4 + vec3(0.0, -uTime * 0.35, 0.0));
        float nf = near(distance(position, touchL()), 0.55);
        float len = (0.015 + 0.26 * smoothstep(0.4, 0.75, wv) + 0.3 * nf) * (1.0 + 0.8 * uPulse);
        vec3 p = position + (aN + flow(position * 2.0, uTime * 0.4) * 0.8) * len * aTip;
        vL = mix(0.05, 0.25 + 0.75 * max(smoothstep(0.4, 0.75, wv), nf), aTip);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      }`, `varying float vL; void main(){ gl_FragColor = vec4(${PAPER} * vL, 1.0); }`);
    const obj = new THREE.LineSegments(g, m); obj.frustumCulled = false;
    cards.push({ id: 'B1b', name: '表面に毛を生やす', obj,
      subj: (s) => { for (let i = 0; i < M; i++) for (let k = 0; k < 2; k++) { p.set(s.p.subarray(i * 3, i * 3 + 3), (i * 2 + k) * 3); n.set(s.n.subarray(i * 3, i * 3 + 3), (i * 2 + k) * 3); } g.attributes.position.needsUpdate = true; g.attributes.aN.needsUpdate = true; },
      update: (c) => { obj.rotation.y = c.t * 0.25; } });
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
        float nf = near(distance(vec3(aOff, 0.0), touchL()), 0.35);   // 指の下が、盛り上がる
        float h = 0.004 + rel * uH * (1.0 + 0.25 * uPulse) + nf * 0.45;
        vec3 p = position; p.z = (p.z + 0.5) * h;
        float lit = normal.z > 0.5 ? 1.0 : (0.35 + 0.25 * normal.x + 0.2 * normal.y);
        vC = c * lit;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p + vec3(aOff, 0.0), 1.0);
      }`, `varying vec3 vC; void main(){ gl_FragColor = vec4(vC, 1.0); }`, { uH: { value: 0 } });
    const obj = new THREE.Mesh(g, m); obj.frustumCulled = false;
    const e = (c: Ctx) => smooth((c.bar - 2.5) / 3) * (1 - smooth((c.bar - 12.5) / 3));
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
      vertexShader: FSQ,
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
    const obj = new THREE.Group(); const sub = subjMesh(m, obj);
    const disc = new THREE.Mesh(new THREE.CircleGeometry(0.62, 64), mat(`varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      /* glsl */ `varying vec2 vUv; uniform sampler2D tR; void main(){ vec2 q = vUv - 0.5; float v = texture2D(tR, vUv).g;
        vec2 g = fract(gl_FragCoord.xy / (uRes.y / 180.0)) - 0.5; float dot_ = step(length(g), 0.12 + 0.36 * smoothstep(0.1, 0.32, v)); gl_FragColor = vec4(${PAPER} * dot_ * smoothstep(0.5, 0.42, length(q)), 1.0); }`, { tR }));
    let init = true, lastBeat = -1, first = 9; // はじめに、種を9つ落とす
    const inv = new THREE.Matrix4(), tp = new THREE.Vector3();
    const run = (flatDisc: boolean) => (r: THREE.WebGLRenderer, c: Ctx) => {
      const b = Math.floor(c.beat);
      // 指の位置を、模様の座標に直す(指でなぞった所に、種が落ちる)。
      let tu = -1, tv = -1;
      if (c.touchK > 0.3) {
        if (flatDisc) { tu = c.touch.x / (0.62 * 2.4 * 2) + 0.5; tv = c.touch.y / (0.62 * 2.4 * 2) + 0.5; }
        else { tp.copy(c.touch).applyMatrix4(inv.copy(obj.matrixWorld).invert()); tu = Math.atan2(tp.z, tp.x) / (Math.PI * 2) + 0.5; tv = tp.y / 2.4 + 0.5; }
      }
      for (let i = 0; i < 16; i++) {
        sim.uniforms.tS.value = ra.texture; sim.uniforms.uInit.value = init ? 1 : 0;
        const byTouch = i === 8 && tu >= 0 && tu <= 1 && tv > 0 && tv < 1;
        sim.uniforms.uSeed.value.set(byTouch ? tu : Math.random(), byTouch ? tv : 0.1 + Math.random() * 0.8, (i < 3 && b !== lastBeat) || first > 0 || byTouch ? 1 : 0);
        r.setRenderTarget(rb); r.render(simScene, simCam);
        [ra, rb] = [rb, ra]; if (!init && first > 0) first--; init = false;
      }
      lastBeat = b;
      const reg = Math.floor(c.beat / 16) & 1; // 16拍ごとに、斑点と縞を入れ替える
      sim.uniforms.uF.value = reg ? 0.029 : 0.037; sim.uniforms.uK.value = reg ? 0.057 : 0.06;
      r.setRenderTarget(null); tR.value = ra.texture;
    };
    cards.push({ id: 'C1', name: '表面で模様を育てる(反応拡散)', obj, needsGeo: true, subj: sub, pre: run(false), update: (c) => { obj.rotation.y = c.t * 0.3; }, cam: (c) => orbit(c, 0, 0.12, 5.2) });
    const obj2 = new THREE.Group(); obj2.add(disc); disc.scale.setScalar(2.4);
    cards.push({ id: 'R7', name: '点の濃淡で、育つ模様を見せる', obj: obj2, pre: run(true), cam: (c) => orbit(c, 0, 0, 5.2, true) });
  }

  // ======================================================================= C2 溶かす・削る
  {
    const obj = new THREE.Group();
    const m = mat(PV, /* glsl */ `${PF} uniform float uP;
      void main(){
        float n = fbm(vP * 1.6) - near(distance(vP, vT), 0.5) * 0.45;   // 指のまわりから、先に削れる
        if (n < uP) discard;
        float edge = 1.0 - smoothstep(0.0, 0.045, n - uP);
        float lit = 0.12 + 0.88 * pow(max(dot(normalize(vN) * (gl_FrontFacing ? 1.0 : -1.0), normalize(vec3(0.4, 0.6, 0.7))), 0.0), 1.0);
        gl_FragColor = vec4(${PAPER} * (lit * 0.75 + edge * 1.6), 1.0);
      }`, { uP: { value: 0 } }, DS);
    const sub = subjMesh(m, obj);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', attr(new Float32Array(N * 3))); g.setAttribute('aN', attr(new Float32Array(N * 3))); g.setAttribute('aR', attr(rnd, 1));
    const pm = mat(/* glsl */ `attribute vec3 aN; attribute float aR; uniform float uP; varying float vA;
      void main(){
        float n = fbm(position * 1.6) - near(distance(position, touchL()), 0.5) * 0.45, k = max(0.0, uP - n);
        vec3 p = position + aN * k * 0.9 + vec3(0.0, k * k * 5.0, 0.0) + flow(position * 2.0 + aR, uTime * 0.3) * k * 1.4;
        vA = step(0.001, k) * (1.0 - smoothstep(0.0, 0.42, k));
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_PointSize = uRes.y * 0.018 / -mv.z;
        gl_Position = projectionMatrix * mv;
      }`, `varying float vA; void main(){ if (vA < 0.01 || length(gl_PointCoord - 0.5) > 0.5) discard; gl_FragColor = vec4(${PAPER} * vA * 0.8, 1.0); }`, { uP: m.uniforms.uP }, ADD);
    const pts = new THREE.Points(g, pm); pts.frustumCulled = false; obj.add(pts);
    const sp = subjPoints(g);
    cards.push({ id: 'C2', name: '溶かす・削る', obj, needsGeo: true, subj: (s) => { sub(s); sp(s); }, update: (c) => { m.uniforms.uP.value = 0.2 + 0.62 * (0.5 - 0.5 * Math.cos(c.bar * 0.3927)); obj.rotation.y = c.t * 0.25; } });
  }

  // ======================================================================= D1 水滴(くっつく形。下の写真を屈折させる)
  {
    const K = 40, blobs = new Float32Array(K * 3), seed = Array.from({ length: K }, () => [Math.random(), Math.random(), Math.random(), Math.random()]);
    const post = mat(FSQ, /* glsl */ `
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
        // 大きな1滴が、指についてくる。まわりの滴を吸う。
        blobs[0] = c.ptr.x * c.asp; blobs[1] = c.ptr.y; blobs[2] = 0.06 + 0.16 * c.touchK;
      } });
  }

  // ======================================================================= D2 形から形へ溶け移る(式で持つ形)
  {
    const post = mat(FSQ, /* glsl */ `
      varying vec2 vUv;
      float smin(float a, float b, float k){ float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0); return mix(b, a, h) - k * h * (1.0 - h); }
      float shape(vec3 p, float s){
        float a = length(vec2(length(p.xz) - 0.75, p.y)) - 0.3;                                  // 輪
        vec3 q = abs(p) - vec3(0.55); float b = length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0) - 0.12; // 箱
        vec3 t = p; t.xz = rot(p.y * 2.2) * t.xz; float c = length(vec2(length(t.xy) - 0.6, t.z)) - 0.22;        // ねじれた輪
        s = mod(s, 3.0); float k = smoothstep(0.0, 1.0, fract(s));
        return s < 1.0 ? mix(a, b, k) : (s < 2.0 ? mix(b, c, k) : mix(c, a, k));
      }
      float map(vec3 p){
        vec3 o = mix(vec3(sin(uTime * 0.9), cos(uTime * 0.7), sin(uTime * 0.5)) * 1.05, vec3(uPtr.x * uAsp, uPtr.y, 0.0) * 1.5 / min(uAsp * 1.7, 1.0), uTouchK); // 玉は、指についてくる
        float ball = length(p - o) - 0.26;
        p.xz = rot(uTime * 0.3) * p.xz; p.xy = rot(0.4) * p.xy;
        return smin(shape(p, uBeat / 8.0), ball, 0.5) - 0.05 * uPulse;
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
    const sub = subjMesh(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.55, metalness: 0.0, side: THREE.DoubleSide }), obj);
    const post = mat(FSQ, /* glsl */ `
      varying vec2 vUv; uniform sampler2D tScene; uniform float uCell;
      float bayer(vec2 p){ vec2 a = floor(mod(p, 4.0)); float i = a.x + a.y * 4.0;
        float m[16]; m[0]=0.;m[1]=8.;m[2]=2.;m[3]=10.;m[4]=12.;m[5]=4.;m[6]=14.;m[7]=6.;m[8]=3.;m[9]=11.;m[10]=1.;m[11]=9.;m[12]=15.;m[13]=7.;m[14]=13.;m[15]=5.;
        float v = 0.0; for (int k = 0; k < 16; k++) if (float(k) == i) v = m[k]; return (v + 0.5) / 16.0; }
      void main(){
        // 指のまわりだけ、点が細かくなる(元の絵が のぞく)。
        float cell = max(1.0, floor(uCell * (1.0 - 0.75 * near(distance((vUv - 0.5) * vec2(uAsp, 1.0) * 2.0, uPtr * vec2(uAsp, 1.0)), 0.45))));
        vec2 px = floor(gl_FragCoord.xy / cell);
        float l = dot(texture2D(tScene, (px + 0.5) * cell / uRes).rgb, vec3(0.299, 0.587, 0.114));
        gl_FragColor = vec4(${PAPER} * step(bayer(px), l * 1.15), 1.0);
      }`, { tScene: { value: null }, uCell: { value: 4 } });
    cards.push({ id: 'E1', name: '網点・ディザ', obj, post, needsGeo: true, subj: sub,
      update: (c) => { obj.rotation.y = c.t * 0.5; post.uniforms.uCell.value = [3, 5, 8, 5][Math.floor(c.bar / 4) % 4] * renderer.getPixelRatio(); } });
  }

  // ======================================================================= E2 線画(輪郭と、斜線の陰)
  {
    const obj = new THREE.Group();
    const sub = subjMesh(mat(PV, /* glsl */ `${PF}
      float ln(float c, float sp){ float f = abs(fract(c / sp) - 0.5) * sp; return 1.0 - smoothstep(0.5, 1.4, f); }
      void main(){
        vec3 n = normalize(vN) * (gl_FrontFacing ? 1.0 : -1.0);
        // 光は、指のある方から来る(触っていないときは、8拍で1周)。
        vec3 L = normalize(mix(vec3(cos(uBeat * 0.3927), 0.6, 0.6), vec3(uPtr * 1.6, 0.7), uTouchK));
        float Ld = dot(n, L);
        vec2 f = gl_FragCoord.xy / (uRes.y / 900.0);
        float h = 0.0;
        h = max(h, ln(f.x + f.y, 9.0) * step(Ld, 0.75));
        h = max(h, ln(f.x - f.y, 9.0) * step(Ld, 0.35));
        h = max(h, ln(f.x + f.y + 4.5, 9.0) * step(Ld, 0.0));
        float rim = 1.0 - smoothstep(0.18, 0.32, abs(dot(n, normalize(vV))));
        gl_FragColor = vec4(${PAPER} * max(h * 0.85, rim), 1.0);
      }`, {}, DS), obj);
    cards.push({ id: 'E2', name: '線画(輪郭と、斜線の陰)', obj, needsGeo: true, subj: sub, update: (c) => { obj.rotation.y = c.t * 0.35; } });
  }

  // ======================================================================= E3 残像・引きずり(データモッシュ)
  {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', attr(new Float32Array(N * 3))); g.setAttribute('aUv', attr(new Float32Array(N * 2).map((_, i) => (i & 1 ? Math.floor((i >> 1) / 200) / 199 : ((i >> 1) % 200) / 199)), 2));
    const m = mat(`attribute vec2 aUv; varying vec3 vC; void main(){ vC = texture2D(tA, cover(aUv, 0.8, uAspA)).rgb; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = uRes.y * 0.011 / -mv.z; gl_Position = projectionMatrix * mv; }`,
      `varying vec3 vC; void main(){ if (length(gl_PointCoord - 0.5) > 0.5) discard; gl_FragColor = vec4(vC * 1.2, 1.0); }`);
    const obj = new THREE.Points(g, m); obj.frustumCulled = false;
    const post = mat(FSQ, /* glsl */ `
      varying vec2 vUv; uniform sampler2D tScene, tPrev; uniform vec2 uVel;
      void main(){
        // 拍の頭で、前の絵を 四角い塊ごとに ずらして引きずる(動きの向きは塊ごと)。指を動かすと、その向きにも引きずる。
        vec2 blk = floor(vUv * vec2(18.0 * uAsp, 18.0));
        vec2 mv = (vec2(h31(vec3(blk, floor(uBeat))), h31(vec3(blk, floor(uBeat) + 7.0))) - 0.5) * 0.05 * uPulse;
        mv += (vUv - 0.5) * 0.006 + uVel * (0.4 + 0.6 * h31(vec3(blk, 3.0)));
        vec3 prev = texture2D(tPrev, vUv - mv).rgb;
        vec3 now = texture2D(tScene, vUv).rgb;
        float keep = mix(0.9, 0.985, max(uPulse, min(1.0, length(uVel) * 60.0)));
        gl_FragColor = vec4(max(now * (1.0 - 0.75 * uPulse), prev * keep), 1.0);
      }`, { tScene: { value: null }, tPrev: { value: null }, uVel: { value: new THREE.Vector2() } });
    const lastP = new THREE.Vector2();
    cards.push({ id: 'E3', name: '残像・引きずり(データモッシュ)', obj, post, feedback: true, subj: subjPoints(g),
      update: (c) => { obj.rotation.y = c.t * 0.9; obj.rotation.x = Math.sin(c.t * 0.5) * 0.4; (post.uniforms.uVel.value as THREE.Vector2).set((c.ptr.x - lastP.x) * 0.5, (c.ptr.y - lastP.y) * 0.5).multiplyScalar(c.touchK); lastP.copy(c.ptr); } });
  }

  // ======================================================================= E4 時間をずらす(スリットスキャン)
  {
    const obj = new THREE.Group();
    const sub = subjMesh(mat(/* glsl */ `varying vec3 vN, vV;
      void main(){
        // 高さごとに、違う時刻の動きを使う。動いているものを、細い横の隙間から少しずつ写したときの形になる。指を左右に動かすと、ずれの幅が変わる。
        float lag = 0.5 + 1.6 * mix(0.5 + 0.5 * sin(uBeat * 0.3927), uPtr.x * 0.5 + 0.5, uTouchK);
        float a = (uTime - (position.y + 1.2) * lag) * 1.6 + uPulse * 0.6 * sin(position.y * 5.0);
        vec3 p = position; p.xz = rot(a) * p.xz; p.x += 0.42 * sin(a * 1.1); p.z += 0.3 * cos(a * 0.8);
        vec3 n = normal; n.xz = rot(a) * n.xz;
        vN = normalize(normalMatrix * n); vec4 mv = modelViewMatrix * vec4(p, 1.0); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv;
      }`, /* glsl */ `varying vec3 vN, vV; void main(){ vec3 n = normalize(vN) * (gl_FrontFacing ? 1.0 : -1.0);
        float lit = 0.08 + 0.8 * pow(max(dot(n, normalize(vec3(0.5, 0.6, 0.6))), 0.0), 1.2) + 0.5 * pow(1.0 - abs(dot(n, normalize(vV))), 3.0);
        gl_FragColor = vec4(${PAPER} * lit, 1.0); }`, {}, DS), obj);
    cards.push({ id: 'E4', name: '時間をずらす(スリットスキャン)', obj, needsGeo: true, subj: sub });
  }

  // ======================================================================= E5 素材と光(溝の虹)
  {
    const obj = new THREE.Group();
    const sub = subjMesh(mat(PV, /* glsl */ `${PF}
      vec3 spec(float x){ return 0.5 + 0.5 * cos(6.2832 * (x + vec3(0.0, 0.33, 0.67))); }
      void main(){
        vec3 n = normalize(vN) * (gl_FrontFacing ? 1.0 : -1.0), v = normalize(vV);
        vec3 L = normalize(mix(vec3(sin(uBeat * 0.3927) * 1.2, 0.7, 0.8), vec3(uPtr * 1.8, 0.8), uTouchK)); // 光は、指についてくる
        vec3 T = normalize(cross(vec3(0.0, 1.0, 0.0), n) + 1e-4); // 軸のまわりの向き(溝の向き)
        float d = dot(T, normalize(L + v));
        float band = pow(max(0.0, 1.0 - abs(dot(n, normalize(L + v)) - 0.75) * 2.2), 2.0);
        vec3 col = spec(d * 2.4 + uTime * 0.05) * (0.25 + 0.75 * band) * (0.35 + 0.65 * pow(1.0 - abs(dot(n, v)), 1.5));
        col += vec3(1.0) * pow(max(dot(n, normalize(L + v)), 0.0), 60.0) * 0.8 + 0.02;
        gl_FragColor = vec4(col * (1.0 + 0.35 * uPulse), 1.0);
      }`, {}, DS), obj);
    cards.push({ id: 'E5', name: '素材と光(溝の虹)', obj, needsGeo: true, subj: sub, update: (c) => { obj.rotation.y = c.t * 0.4; obj.rotation.z = Math.sin(c.t * 0.3) * 0.25; } });
  }

  // ======================================================================= R5 逆光(光が指を追う。白黒と粒子)
  {
    const obj = new THREE.Group();
    const sub = subjMesh(mat(PV, /* glsl */ `${PF}
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
    cards.push({ id: 'R5', name: '逆光(光が指を追う)', obj, needsGeo: true, subj: sub, update: (c) => { obj.rotation.y = c.t * 0.15; }, cam: (c) => orbit(c, 0, 0.1, 4.6, true) });
  }

  // ======================================================================= R6 作品が板になって、空間に積まれる
  {
    const obj = new THREE.Group();
    const slabs: THREE.Mesh[] = [];
    const side = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.4 });
    cards.push({ id: 'R6', name: '作品が板になって、空間に積まれる', obj,
      // 指を上下に動かすと、積み重ねが ひらく。
      update: (c) => slabs.forEach((s, i) => { const gap = 0.42 + 0.3 * c.touchK * (c.ptr.y * 0.5 + 0.5); s.rotation.x = 1.15 + 0.22 * Math.sin(c.t * 0.4 + i); s.rotation.z = 0.5 * i + c.t * (0.05 + 0.02 * (i % 3)); s.position.y = (i - (slabs.length - 1) / 2) * gap + 0.06 * Math.sin(c.t * 0.7 + i * 2.0) + (i % 2 ? 1 : -1) * 0.1 * c.pulse; }),
      cam: (c) => orbit(c, c.t * 0.12, 0.35 + 0.25 * Math.sin(c.t * 0.2), 5.6),
      fill: () => {
        while (slabs.length < Math.min(tex.length, 9)) {
          const t = tex[slabs.length], a = t.image.width / t.image.height, w = a > 1 ? 1.5 : 1.5 * a, h = a > 1 ? 1.5 / a : 1.5;
          const face = new THREE.MeshBasicMaterial({ map: t });
          const s = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.07), [side, side, side, side, face, face]);
          slabs.push(s); obj.add(s);
        }
      } });
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
        // となりの線と、少しずつ違う輪。重なって面に見える。指の位置で、輪の重なり方が変わる。
        float a1 = 1.0 + 2.0 * sin(k * 1.1 + t + uPtr.x * uTouchK * 1.5), a2 = 2.0 + sin(k * 0.7 - t * 1.3 + uPtr.y * uTouchK * 1.5), a3 = 3.0;
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

  // ---- 視点。指でなぞると回る(離すと、ゆっくり元へ戻る)。fixed の札は回さない(正面から見る札)。
  let dYaw = 0, dPitch = 0, vYaw = 0, vPitch = 0;
  function orbit(c: Ctx, yaw: number, pitch: number, r: number, fixed = false) {
    const k = c.asp < 0.8 ? 1.0 + (0.8 - c.asp) * 0.9 : 1; // 縦長の画面では、少し引く
    const y = yaw + (fixed ? 0 : dYaw), p = Math.max(-1.4, Math.min(1.4, pitch + (fixed ? 0 : dPitch)));
    c.cam.position.set(Math.sin(y) * Math.cos(p) * r * k, Math.sin(p) * r * k, Math.cos(y) * Math.cos(p) * r * k);
    c.cam.lookAt(0, 0, 0);
  }

  // ---- 後処理(描いた絵を、もう一度加工する札のため)
  const quadScene = new THREE.Scene(), quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
  quad.frustumCulled = false; quadScene.add(quad);
  const blit = new THREE.ShaderMaterial({ uniforms: { t: { value: null } }, vertexShader: FSQ, fragmentShader: `varying vec2 vUv; uniform sampler2D t; void main(){ gl_FragColor = texture2D(t, vUv); }` });
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
    rtS = mkRT(vw * dpr, vh * dpr); rtA = mkRT(vw * dpr, vh * dpr); rtB = mkRT(vw * dpr, vh * dpr);
  }

  // ---- 進行
  let cur = -1, enterBeat = 0, t = 0, beat = 0, last = performance.now(), frozen: number | null = null;
  const ptr = new THREE.Vector2(0.3, 0.3);
  let touchK = 0, lastMove = -10, down = false, drawing = false, moved = false, downX = 0, downY = 0, lastX = 0, lastY = 0, downAt = 0;
  let pts: number[][] = [];
  const ctx: Ctx = { t: 0, dt: 0, beat: 0, pulse: 0, bar: 0, cam, asp: 1, ptr, touch: new THREE.Vector3(), touchK: 0 };
  let bag: number[] = [];
  const hist: number[] = [];
  function go(n: number, keepSubject = false) {
    const k = ((n % cards.length) + cards.length) % cards.length;
    if (cur >= 0 && cards[cur].obj) scene.remove(cards[cur].obj!);
    cur = k; enterBeat = Math.floor(beat + 1e-6); dYaw = dPitch = vYaw = vPitch = 0;
    if (cards[k].obj) scene.add(cards[k].obj!);
    if (!keepSubject) pickSubject(!!cards[k].needsGeo);
    if (label) label.textContent = `${String(k + 1).padStart(2, '0')} / ${cards.length}  ${cards[k].id}  ${cards[k].name}`;
    history.replaceState(null, '', `?c=${k + 1}${autoOn ? '' : '&auto=0'}`);
  }
  // 次の札: まだ出していない札から、ばらばらに選ぶ。
  function next() {
    if (!bag.length) bag = cards.map((_, i) => i).filter((i) => i !== cur).sort(() => Math.random() - 0.5);
    hist.push(cur); go(bag.pop()!);
  }
  const prev = () => { if (hist.length) go(hist.pop()!); };
  const ray = new THREE.Raycaster(), plane = new THREE.Plane(), fwd = new THREE.Vector3();
  function frame(now: number) {
    if (dead) return;
    const dt = Math.max(0, Math.min(0.05, (now - last) / 1000)); last = now;
    if (frozen === null) { t += dt; beat += (dt * BPM) / 60; }
    let c = cards[cur];
    // 16拍たったら、拍の頭で次の札へ(描いている間は、待つ)。
    if (autoOn && frozen === null && !drawing && beat - enterBeat >= LEN) { next(); c = cards[cur]; }
    ctx.t = t; ctx.dt = dt; ctx.beat = beat; ctx.bar = beat - enterBeat; ctx.pulse = Math.exp(-(beat - Math.floor(beat)) * 4.5); ctx.asp = vw / vh;
    // 指: 動かしている間は 1。止めると 1.5 秒ほどで 0 へ。
    const active = t - lastMove < 0.25 || down;
    touchK += ((active ? 1 : 0) - touchK) * Math.min(1, dt * (active ? 10 : 1.6));
    ctx.touchK = touchK;
    dYaw += vYaw; dPitch += vPitch; vYaw *= 0.92; vPitch *= 0.92;
    if (!down) { dYaw *= 1 - Math.min(1, dt * 0.6); dPitch *= 1 - Math.min(1, dt * 0.6); }
    if (c.cam) c.cam(ctx); else orbit(ctx, 0, 0.12, 5.2);
    cam.updateMatrixWorld();
    // 指の位置を、空間の点に直す(原点を通り、視線に垂直な面の上)。
    cam.getWorldDirection(fwd); plane.setFromNormalAndCoplanarPoint(fwd, scene.position);
    ray.setFromCamera(ptr, cam); ray.ray.intersectPlane(plane, ctx.touch);
    S.uTime.value = t; S.uBeat.value = beat; S.uPulse.value = ctx.pulse; S.uBar.value = ctx.bar; S.uPtr.value.copy(ptr); S.uTouch.value.copy(ctx.touch); S.uTouchK.value = touchK;
    const pa = Math.floor(beat / 16); if (pa !== photoAt) { photoAt = pa; setPhotos(); } // 写真は、16拍ごとに次へ
    c.update?.(ctx);
    scene.updateMatrixWorld();
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

  // ---- 入力
  //  叩く: 次の札(左端は前の札)。 なぞる: 形を回す。帯の札では、なぞった線が帯になる。 動かすだけ(PC): 指のまわりの反応。
  const setPtr = (e: PointerEvent) => { const r = root.getBoundingClientRect(); ptr.set(((e.clientX - r.left) / vw) * 2 - 1, -(((e.clientY - r.top) / vh) * 2 - 1)); lastMove = t; };
  const onDown = (e: PointerEvent) => {
    if ((e.target as HTMLElement).closest('a,button')) return;
    down = true; moved = false; drawing = false; downX = lastX = e.clientX; downY = lastY = e.clientY; downAt = performance.now(); setPtr(e);
  };
  const onMove = (e: PointerEvent) => {
    setPtr(e);
    if (!down) return;
    if (!moved && Math.hypot(e.clientX - downX, e.clientY - downY) > 10) {
      moved = true;
      if (cards[cur].draw) { drawing = true; pts = []; enterBeat = Math.floor(beat); } // 帯の札: 描きはじめ(平らな帯に戻る)
    }
    if (drawing) {
      // 画面の位置を、帯の面(z = 0)の上の点に直す。
      ray.setFromCamera(ptr, cam); const o = ray.ray.origin, d = ray.ray.direction, k = -o.z / (d.z || -1e-6), x = o.x + d.x * k, y = o.y + d.y * k;
      const l = pts[pts.length - 1];
      if (!l || Math.hypot(x - l[0], y - l[1]) > 0.03) { pts.push([x, y]); if (pts.length > 3) { setPath(pts); cards.forEach((c) => c.draw && c.fill?.()); enterBeat = Math.floor(beat); } }
    } else if (moved) { vYaw = -(e.clientX - lastX) * 0.006; vPitch = (e.clientY - lastY) * 0.006; }
    lastX = e.clientX; lastY = e.clientY;
  };
  const onUp = (e: PointerEvent) => {
    if (!down) return;
    down = false;
    if (drawing) { drawing = false; if (pts.length > 3) { path = pts; setPath(path); buildBand(); cards.forEach((c) => c.draw && c.fill?.()); applySubject(); enterBeat = Math.floor(beat) - 2; } }
    else if (!moved && performance.now() - downAt < 500) { if (e.clientX < vw * 0.2) prev(); else next(); }
  };
  const onKey = (e: KeyboardEvent) => { if (e.key === 'ArrowRight' || e.key === ' ') next(); if (e.key === 'ArrowLeft') prev(); };
  root.addEventListener('pointerdown', onDown);
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);
  window.addEventListener('keydown', onKey);
  window.addEventListener('resize', resize);
  resize();
  go((parseInt(q.get('c') ?? '1', 10) || 1) - 1, true);
  applySubject();
  requestAnimationFrame(frame);

  // 確認用: __deck.go(3) で4枚目へ。__deck.at(12.5) で、その札に入って 12.5 拍目の絵に止める(null で戻す)。
  // __deck.subject('fox') で被写体を指定。__deck.touch(x, y) で指を置く(-1..1)。
  (window as unknown as { __deck?: unknown }).__deck = {
    go: (n: number) => go(n, true), next,
    at(b: number | null) { frozen = b; if (b !== null) { beat = enterBeat + b; t = (beat * 60) / BPM; } },
    subject(name: string) { const i = subjects.findIndex((s) => s.name === name); if (i >= 0) { subjAt = i; applySubject(); } return i; },
    touch(x: number | null, y = 0) { if (x === null) { lastMove = -10; touchK = 0; } else { ptr.set(x, y); lastMove = 1e9; touchK = 1; } },
    get n() { return cards.length; }, get ids() { return cards.map((c) => c.id); }, get subjects() { return subjects.map((s) => s.name); },
    get ready() { return subjects.length >= 3 + FREE.length && tex.length >= 2; },
  };

  return () => {
    dead = true;
    root.removeEventListener('pointerdown', onDown);
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onUp);
    window.removeEventListener('keydown', onKey);
    window.removeEventListener('resize', resize);
    renderer.dispose();
  };
}
