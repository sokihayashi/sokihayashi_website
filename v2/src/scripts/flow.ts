// 試作 /lab/flow/ : 切らずに、つながって変わり続ける。
//
// 本人(2026-11-25):
//  「3Dのものが回転するだけ、というのは避けたい。基本は、シームレスに表現どうしが どんどん繋がって変わっていく、を目指したい」
//  「虹色のカメラ、めっちゃかっこよかった。これ、他の表現と混ぜるもできる。複数案を組み合わせて昇華する案もあると思う」
//
// 作り: 画面にあるのは、いつも同じ4万枚の小さな面。見本帳(/lab/deck/)の札を、3つの軸にほどいて、軸ごとに混ぜられるようにした。
//  ・並び: 帯 / うねる帯 / 写真の板 / 立体に巻く / 立体の表面 / 塊
//  ・面の形: 大きさ、丸さ、返り(スパンコール)、毛(面が立って伸びる)、高さ(明るさで浮く)、散り、溶け、網点
//  ・質感: 写真の色、虹、逆光、陰、模様、なめらかな面(立体そのもの)、残像、引きずり、ディザ
// 状態は、この3つの組み合わせ。状態から状態へは、4万枚が1枚ずつ ずれて移る。切り替えの瞬間は無い。
// 8拍ごとに次の状態へ向かいはじめ、5拍かけて移る(止まっているのは3拍だけ)。
// なぞる: 帯の状態なら、その線が帯になる。ほかの状態なら、視点が動く。指のまわりの面は、押されて返る。叩くと、すぐ次へ。
// /lab/morph/ ・ /lab/morph-sharp/ ・ /lab/deck/ には触れていない。

import * as THREE from 'three';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { MeshSurfaceSampler } from 'three/addons/math/MeshSurfaceSampler.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

const BPM = 100, PERIOD = 8, MOVE = 5;
const CU = 2500, CV = 16, N = CU * CV; // 帯に沿って 2500 × 幅に 16 = 4万枚
const BW = 0.3;
const PAPER = 'vec3(0.957, 0.945, 0.914)';
const FREE = ['antiquecamera', 'boombox', 'fox', 'corset', 'sheenchair', 'glassvaseflowers'];

const NOISE = /* glsl */ `
float h31(vec3 p){ p = fract(p * vec3(0.1031, 0.1030, 0.0973)); p += dot(p, p.yxz + 33.33); return fract((p.x + p.y) * p.z); }
float n3(vec3 p){ vec3 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(mix(h31(i), h31(i+vec3(1,0,0)), f.x), mix(h31(i+vec3(0,1,0)), h31(i+vec3(1,1,0)), f.x), f.y),
             mix(mix(h31(i+vec3(0,0,1)), h31(i+vec3(1,0,1)), f.x), mix(h31(i+vec3(0,1,1)), h31(i+vec3(1,1,1)), f.x), f.y), f.z); }
float fbm(vec3 p){ return n3(p) * 0.6 + n3(p * 2.03 + 7.1) * 0.3 + n3(p * 4.1 + 3.3) * 0.1; }
vec3 flow(vec3 p, float t){ return vec3(n3(p + vec3(0.0, t, 9.1)) - n3(p + vec3(5.2, -t, 0.0)), n3(p + vec3(t, 3.3, 0.0)) - n3(p + vec3(0.0, 8.7, t)), n3(p + vec3(1.7, 0.0, -t)) - n3(p + vec3(-t, 4.4, 2.2))); }
vec3 rainbow(float x){ return 0.5 + 0.5 * cos(6.2832 * (x + vec3(0.0, 0.33, 0.67))); }
// 質感は、面(4万枚)も、なめらかな立体も、同じ式で塗る。n: 面の向き(視点から見た) v: 視点への向き T: 溝の向き
vec3 shade(vec3 base, vec3 n, vec3 v, vec3 T, vec3 wp, float iri, float rim, float lit, float pat, float pulse, vec2 ptr, float tk, float beat, float time){
  // 立体を回す代わりに、光のほうが巡る(虹が、面の上を流れる)。指があれば、光は指についてくる。
  vec3 L = normalize(mix(vec3(sin(time * 0.9) * 1.3, 0.5 + 0.4 * sin(time * 0.53), 0.6 + 0.6 * cos(time * 0.9)), vec3(ptr * 1.8, 0.8), tk));
  vec3 H = normalize(L + v);
  float lam = 0.16 + 0.84 * pow(max(dot(n, L) * 0.6 + 0.4, 0.0), 1.5);
  vec3 col = base * mix(1.0, lam, lit);
  float two = step(0.52, fbm(wp * 1.7 + vec3(0.0, time * 0.12, 0.0)));
  col = mix(col, mix(vec3(0.13), ${PAPER}, two) * lam, pat);
  float band = pow(max(0.0, 1.0 - abs(dot(n, H) - 0.75) * 2.2), 2.0);
  vec3 ir = rainbow(dot(T, H) * 3.0 + time * 0.08) * (0.4 + 0.9 * band) * (0.45 + 0.75 * pow(1.0 - abs(dot(n, v)), 1.5)) + pow(max(dot(n, H), 0.0), 60.0) * 0.8 + 0.03;
  col = mix(col, ir * (1.0 + 0.35 * pulse), iri);
  // 逆光: 光は形の後ろにあり、指についてくる(向きは、視点から見た座標でそろえる)。
  vec3 lp = vec3(ptr.x * 2.2, ptr.y * 2.2, -1.6);
  vec3 l2 = normalize((viewMatrix * vec4(lp, 1.0)).xyz - (viewMatrix * vec4(wp, 1.0)).xyz);
  float back = pow(max(dot(-v, l2), 0.0), 2.0) * pow(1.0 - abs(dot(n, v)), 2.2) * 5.0 + pow(max(dot(n, l2) * 0.5 + 0.5, 0.0), 3.0) * 0.5;
  col = mix(col, vec3(back / (0.5 + dot(lp - wp, lp - wp) * 0.22) + 0.012), rim);
  return col;
}
`;

type Subject = { name: string; geo: THREE.BufferGeometry | null; p: Float32Array; n: Float32Array; area: number; hx: number; hz: number };
type Lay = 'band' | 'ribbon' | 'plane' | 'wrap' | 'surf' | 'blob';
const PK = ['size', 'round', 'flip', 'fur', 'relief', 'scat', 'half', 'photo', 'iri', 'rim', 'lit', 'pat', 'solid', 'blob', 'trail', 'mosh', 'dith'] as const;
type PKey = (typeof PK)[number];
type State = { id: string; lay: Lay; p: Partial<Record<PKey, number>>; cam: [number, number, number] };
// 状態 = 並び × 面の形 × 質感。見本帳の札を、組み合わせ直したもの。
const STATES: State[] = [
  { id: '帯', lay: 'band', p: { photo: 1 }, cam: [0, 0, 5.2] },
  { id: 'うねる帯', lay: 'ribbon', p: { photo: 1, lit: 0.7 }, cam: [0.5, 0.25, 5.2] },
  { id: 'スパンコールの帯', lay: 'band', p: { photo: 1, size: 0.95, round: 1, flip: 1, lit: 0.4 }, cam: [-0.3, 0.2, 4.6] },
  { id: '虹の帯', lay: 'ribbon', p: { iri: 1 }, cam: [-0.5, 0.2, 5.0] },
  { id: '毛の生えた帯', lay: 'ribbon', p: { photo: 1, fur: 1, lit: 0.3 }, cam: [0.3, -0.3, 4.8] },
  { id: '写真の板', lay: 'plane', p: { photo: 1 }, cam: [0, 0, 5.0] },
  { id: '高さになる板', lay: 'plane', p: { photo: 1, size: 0.9, relief: 1, lit: 0.3 }, cam: [0.7, -0.6, 5.2] },
  { id: '網点の板', lay: 'plane', p: { half: 1, round: 1, size: 1.3 }, cam: [0, 0, 4.4] },
  { id: '立体に巻く', lay: 'wrap', p: { photo: 1, lit: 0.6 }, cam: [0.3, 0.1, 5.2] },
  { id: '虹の立体', lay: 'surf', p: { iri: 1, solid: 1, round: 1 }, cam: [0.6, 0.15, 4.8] },
  { id: '虹の毛', lay: 'surf', p: { iri: 1, fur: 1 }, cam: [-0.4, 0.1, 5.0] },
  { id: '虹の鱗', lay: 'surf', p: { iri: 1, size: 1.5, round: 1, flip: 0.6 }, cam: [0.2, 0.3, 4.6] },
  { id: '虹を引きずる', lay: 'surf', p: { iri: 1, solid: 1, round: 1, trail: 0.94, mosh: 1 }, cam: [-0.7, 0.1, 4.8] },
  { id: '逆光の立体', lay: 'surf', p: { rim: 1, solid: 1, round: 1 }, cam: [0, 0.1, 4.6] },
  { id: '写真の色の点', lay: 'surf', p: { photo: 1, size: 0.55, round: 1 }, cam: [0.4, 0.05, 5.0] },
  { id: '流れる点', lay: 'surf', p: { photo: 1, size: 0.5, round: 1, scat: 1, trail: 0.88 }, cam: [-0.3, 0.2, 5.2] },
  { id: '模様の這う立体', lay: 'surf', p: { pat: 1, lit: 1, solid: 1, round: 1 }, cam: [0.5, 0.2, 4.8] },
  { id: '網点の立体', lay: 'surf', p: { lit: 1, solid: 1, round: 1, dith: 1 }, cam: [-0.5, 0.15, 4.8] },
  { id: '虹の塊', lay: 'blob', p: { iri: 1, blob: 1, size: 1.5, round: 1 }, cam: [0.3, 0.2, 5.4] },
  { id: '粒の塊', lay: 'blob', p: { pat: 1, lit: 1, blob: 1, size: 1.5, round: 1 }, cam: [-0.3, 0.25, 5.4] },
  { id: '毛の塊', lay: 'blob', p: { photo: 1, blob: 1, fur: 1, lit: 0.4 }, cam: [0, 0.2, 5.6] },
];
const DEF: Record<PKey, number> = { size: 1.04, round: 0, flip: 0, fur: 0, relief: 0, scat: 0, half: 0, photo: 0, iri: 0, rim: 0, lit: 0, pat: 0, solid: 0, blob: 0, trail: 0, mosh: 0, dith: 0 };

export function mountFlow(root: HTMLElement): () => void {
  const canvas = root.querySelector<HTMLCanvasElement>('[data-canvas]')!;
  const label = root.querySelector<HTMLElement>('[data-label]');
  const base = root.dataset.base ?? '';
  const photos: string[] = JSON.parse(root.dataset.photos ?? '[]');
  const q = new URLSearchParams(location.search);
  const planeOn = q.get('plane') === '1';
  let dead = false;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  renderer.setClearColor(0x000000, 1);
  const scene = new THREE.Scene();
  const cam = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
  const smooth = (x: number) => { const v = Math.max(0, Math.min(1, x)); return v * v * (3 - 2 * v); };

  // ---- 写真の帳面(帯に並べる。1コマ 1.5:1)
  const NP = Math.max(1, Math.min(12, photos.length)), CW = 384, CH = 256;
  const atlasCv = document.createElement('canvas'); atlasCv.width = CW * NP; atlasCv.height = CH;
  const atlas = new THREE.CanvasTexture(atlasCv);
  atlas.colorSpace = THREE.NoColorSpace; atlas.wrapS = THREE.RepeatWrapping; atlas.minFilter = THREE.LinearFilter; atlas.generateMipmaps = false;
  const imgs: HTMLImageElement[] = [];
  photos.slice(0, NP).forEach((src) => { const im = new Image(); im.onload = () => {
    if (dead) return; imgs.push(im);
    const cx = atlasCv.getContext('2d')!, pa = CW / CH;
    imgs.forEach((g, i) => { const a = g.width / g.height, sw = a > pa ? g.height * pa : g.width, sh = a > pa ? g.height : g.width / pa; cx.drawImage(g, (g.width - sw) / 2, (g.height - sh) / 2, sw, sh, i * CW, 0, CW, CH); });
    for (let i = imgs.length; i < NP; i++) cx.drawImage(atlasCv, (i % imgs.length) * CW, 0, CW, CH, i * CW, 0, CW, CH);
    atlas.needsUpdate = true;
  }; im.src = src; });

  // ---- 帯の道すじ
  let path: number[][] = [];
  for (let i = 0; i <= 500; i++) { const a = (i / 500) * Math.PI * 2 * 0.94 + 0.2; path.push([0.82 * Math.sin(5 * a + 0.6), 1.12 * Math.sin(4 * a)]); }
  const PM = 500, px = new Float32Array(PM), py = new Float32Array(PM), pnx = new Float32Array(PM), pny = new Float32Array(PM);
  let pathLen = 1;
  function setPath(src: number[][]) {
    const acc = [0];
    for (let i = 1; i < src.length; i++) acc.push(acc[i - 1] + Math.hypot(src[i][0] - src[i - 1][0], src[i][1] - src[i - 1][1]));
    pathLen = Math.max(0.2, acc[acc.length - 1]);
    let j = 0;
    for (let i = 0; i < PM; i++) { const d = (i / (PM - 1)) * pathLen; while (j < src.length - 2 && acc[j + 1] < d) j++; const f = (d - acc[j]) / Math.max(1e-6, acc[j + 1] - acc[j]); px[i] = src[j][0] + (src[j + 1][0] - src[j][0]) * f; py[i] = src[j][1] + (src[j + 1][1] - src[j][1]) * f; }
    for (let pass = 0; pass < 3; pass++) { let ax = px[0], ay = py[0]; for (let i = 1; i < PM - 1; i++) { const bx = (ax + px[i] * 2 + px[i + 1]) / 4, by = (ay + py[i] * 2 + py[i + 1]) / 4; ax = px[i]; ay = py[i]; px[i] = bx; py[i] = by; } }
    for (let i = 0; i < PM; i++) { const a = Math.max(0, i - 2), b = Math.min(PM - 1, i + 2), tx = px[b] - px[a], ty = py[b] - py[a], l = Math.hypot(tx, ty) || 1; pnx[i] = -ty / l; pny[i] = tx / l; }
  }
  const pathAt = (s: number, o: number[]) => { const f = Math.max(0, Math.min(1, s)) * (PM - 1), j = Math.min(PM - 2, Math.floor(f)), g = f - j; o[0] = px[j] + (px[j + 1] - px[j]) * g; o[1] = py[j] + (py[j + 1] - py[j]) * g; o[2] = pnx[j] + (pnx[j + 1] - pnx[j]) * g; o[3] = pny[j] + (pny[j + 1] - pny[j]) * g; return o; };
  setPath(path);

  // ---- 立体(被写体)
  const subjects: Subject[] = [];
  const areaOf = (g: THREE.BufferGeometry) => { const p = g.attributes.position.array as Float32Array, ix = g.index!.array; let s = 0; const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(); for (let i = 0; i < ix.length; i += 3) { a.fromArray(p, ix[i] * 3); b.fromArray(p, ix[i + 1] * 3); c.fromArray(p, ix[i + 2] * 3); s += b.sub(a).cross(c.sub(a)).length() * 0.5; } return s; };
  fetch(`${base}/lab/deck/pendant.stl`).then((r) => r.arrayBuffer()).then((b) => {
    if (dead) return;
    let g = new STLLoader().parse(b); g.deleteAttribute('normal'); g = mergeVertices(g, 1e-4); g.rotateX(-Math.PI / 2); g.center(); g.computeBoundingBox();
    const k = 2.4 / (g.boundingBox!.max.y - g.boundingBox!.min.y); g.scale(k, k, k); g.computeVertexNormals();
    const s: Subject = { name: 'ペンダント', geo: g, p: new Float32Array(N * 3), n: new Float32Array(N * 3), area: areaOf(g), hx: 0, hz: 0 };
    const sm = new MeshSurfaceSampler(new THREE.Mesh(g)).build(), p = new THREE.Vector3(), n = new THREE.Vector3();
    for (let i = 0; i < N; i++) { sm.sample(p, n); s.p.set([p.x, p.y, p.z], i * 3); s.n.set([n.x, n.y, n.z], i * 3); }
    for (let i = 0; i < N; i++) { s.hx = Math.max(s.hx, Math.abs(s.p[i * 3])); s.hz = Math.max(s.hz, Math.abs(s.p[i * 3 + 2])); } // 横の広がり(視点の距離を決める)
    subjects.push(s);
  });
  FREE.forEach((name) => fetch(`${base}/lab/deck/${name}.bin`).then((r) => r.arrayBuffer()).then((b) => {
    if (dead) return;
    const [nv, ni] = new Uint32Array(b, 0, 2), v = new Int16Array(b, 8, nv * 3), ix = new Uint16Array(b, 8 + nv * 6, ni);
    let off = 8 + nv * 6 + ni * 2; if ((nv * 6 + ni * 2) % 4) off += 2;
    const d = new Int16Array(b, off, N * 6), pos = new Float32Array(nv * 3); for (let i = 0; i < nv * 3; i++) pos[i] = (v[i] / 32000) * 1.25;
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setIndex(new THREE.BufferAttribute(new Uint16Array(ix), 1)); g.computeVertexNormals(); g.computeBoundingSphere();
    const s: Subject = { name, geo: g, p: new Float32Array(N * 3), n: new Float32Array(N * 3), area: areaOf(g), hx: 0, hz: 0 };
    for (let i = 0; i < N; i++) for (let k = 0; k < 3; k++) { s.p[i * 3 + k] = (d[i * 6 + k] / 32000) * 1.25; s.n[i * 3 + k] = d[i * 6 + 3 + k] / 32000; }
    for (let i = 0; i < N; i++) { s.hx = Math.max(s.hx, Math.abs(s.p[i * 3])); s.hz = Math.max(s.hz, Math.abs(s.p[i * 3 + 2])); } // 横の広がり(視点の距離を決める)
    subjects.push(s);
  }));

  // ---- 並び(4万枚それぞれの 位置・向き・溝の向き・写真の座標)
  type Slot = { p: Float32Array; n: Float32Array; t: Float32Array; uv: Float32Array; cell: THREE.Vector2; uvc: THREE.Vector2 };
  const mk = (): Slot => ({ p: new Float32Array(N * 3), n: new Float32Array(N * 3), t: new Float32Array(N * 3), uv: new Float32Array(N * 2), cell: new THREE.Vector2(), uvc: new THREE.Vector2() });
  const slot = [mk(), mk()];
  const tmp = [0, 0, 0, 0];
  const bandUv = (s: number, v: number, o: Float32Array, i: number) => { o[i * 2] = (s * pathLen) / (BW * 1.5) / NP; o[i * 2 + 1] = v + 0.5; };
  const order = new Uint32Array(N); // 立体の表面の点を、下から上へ並べ直す順番
  function fill(k: number, lay: Lay, subj: Subject | null) {
    const L = slot[k];
    L.uvc.set(0, 0);
    if (lay === 'band' || lay === 'ribbon') {
      for (let i = 0; i < N; i++) {
        const s = (Math.floor(i / CV) + 0.5) / CU, v = ((i % CV) + 0.5) / CV - 0.5; pathAt(s, tmp);
        const tx = tmp[3], ty = -tmp[2];
        if (lay === 'band') { L.p.set([tmp[0] + tmp[2] * v * BW, tmp[1] + tmp[3] * v * BW, s * 0.2], i * 3); L.n.set([0, 0, 1], i * 3); L.t.set([tx, ty, 0], i * 3); }
        else {
          const z = 0.28 * Math.sin(s * 9 + 1) + 0.14 * Math.sin(s * 23), ph = 1.1 * Math.sin(s * 12 + 0.5) + 0.5 * Math.sin(s * 31), c = Math.cos(ph), sn = Math.sin(ph);
          L.p.set([tmp[0] + tmp[2] * v * BW * c, tmp[1] + tmp[3] * v * BW * c, z + v * BW * sn], i * 3); L.n.set([-tmp[2] * sn, -tmp[3] * sn, c], i * 3); L.t.set([tx, ty, 0], i * 3);
        }
        bandUv(s, v, L.uv, i);
      }
      L.cell.set(pathLen / CU, BW / CV); L.uvc.set(pathLen / CU / (BW * 1.5) / NP, 1 / CV);
    } else if (lay === 'plane') {
      const W = 2.1, H = 1.4, k0 = Math.floor(Math.random() * NP);
      for (let i = 0; i < N; i++) { const x = ((i % 200) + 0.5) / 200, y = (Math.floor(i / 200) + 0.5) / 200; L.p.set([(x - 0.5) * W, (y - 0.5) * H, 0], i * 3); L.n.set([0, 0, 1], i * 3); L.t.set([1, 0, 0], i * 3); L.uv[i * 2] = (k0 + x) / NP; L.uv[i * 2 + 1] = y; }
      L.cell.set(W / 200, H / 200); L.uvc.set(1 / 200 / NP, 1 / 200);
    } else if (lay === 'blob') {
      for (let i = 0; i < N; i++) { const j = (i * 7919) % N, y = 1 - (2 * (j + 0.5)) / N, r = Math.sqrt(1 - y * y), a = j * 2.39996, x = Math.cos(a) * r, z = Math.sin(a) * r; L.p.set([x * 0.95, y * 0.95, z * 0.95], i * 3); L.n.set([x, y, z], i * 3); const l = Math.hypot(z, x) || 1; L.t.set([z / l, 0, -x / l], i * 3); bandUv((Math.floor(i / CV) + 0.5) / CU, ((i % CV) + 0.5) / CV - 0.5, L.uv, i); }
      L.cell.setScalar(Math.sqrt((4 * Math.PI * 0.9) / N) * 1.25);
    } else if (subj) {
      if (lay === 'surf') {
        const key = new Float32Array(N); for (let i = 0; i < N; i++) { order[i] = i; key[i] = subj.p[i * 3 + 1] + Math.atan2(subj.p[i * 3 + 2], subj.p[i * 3]) * 0.03; }
        order.sort((a, b) => key[a] - key[b]);
        for (let i = 0; i < N; i++) {
          // 帯の幅の中では ばらばらに(きれいな縞にならないように)、帯に沿っては 下から上へ。
          const j = order[Math.min(N - 1, Math.floor(i / CV) * CV + ((i * 7) % CV))];
          const nx = subj.n[j * 3], ny = subj.n[j * 3 + 1], nz = subj.n[j * 3 + 2]; let tx = nz, tz = -nx; const l = Math.hypot(tx, tz); if (l < 1e-3) { tx = 1; tz = 0; } else { tx /= l; tz /= l; }
          L.p.set([subj.p[j * 3], subj.p[j * 3 + 1], subj.p[j * 3 + 2]], i * 3); L.n.set([nx, ny, nz], i * 3); L.t.set([tx, 0, tz], i * 3);
          bandUv((Math.floor(i / CV) + 0.5) / CU, ((i % CV) + 0.5) / CV - 0.5, L.uv, i);
        }
        L.cell.setScalar(Math.sqrt(subj.area / N) * 1.9);
      } else { // wrap: 立体の外形に、下から上へ らせんに巻く
        const TH = 96, HH = 64, shell = new Float32Array(TH * HH);
        let lo = 1e9, hi = -1e9; for (let i = 0; i < N; i++) { const y = subj.p[i * 3 + 1]; if (y < lo) lo = y; if (y > hi) hi = y; }
        for (let i = 0; i < N; i++) { const x = subj.p[i * 3], y = subj.p[i * 3 + 1], z = subj.p[i * 3 + 2], a = Math.min(TH - 1, Math.floor(((Math.atan2(z, x) / (Math.PI * 2) + 1) % 1) * TH)), h = Math.min(HH - 1, Math.floor(((y - lo) / (hi - lo + 1e-6)) * HH)), r = Math.hypot(x, z); if (r > shell[h * TH + a]) shell[h * TH + a] = r; }
        for (let pass = 0; pass < 3; pass++) { const c = shell.slice(); for (let h = 0; h < HH; h++) for (let a = 0; a < TH; a++) { let sum = 0, n = 0, mx = 0; for (let dh = -1; dh <= 1; dh++) for (let da = -1; da <= 1; da++) { const v = c[Math.max(0, Math.min(HH - 1, h + dh)) * TH + ((a + da + TH) % TH)]; if (v > 0) { sum += v; n++; if (v > mx) mx = v; } } shell[h * TH + a] = n ? (c[h * TH + a] > 0 ? (sum / n) * 0.5 + mx * 0.5 : sum / n) : 0; } }
        const R = (th: number, y: number) => { const fa = ((((th / (Math.PI * 2)) % 1) + 1) % 1) * TH, fh = Math.max(0, Math.min(HH - 1.001, ((y - lo) / (hi - lo + 1e-6)) * HH - 0.5)), a0 = Math.floor(fa) % TH, a1 = (a0 + 1) % TH, h0 = Math.floor(fh), h1 = Math.min(HH - 1, h0 + 1), ga = fa - Math.floor(fa), gh = fh - h0; return Math.max(0.06, (shell[h0 * TH + a0] * (1 - ga) + shell[h0 * TH + a1] * ga) * (1 - gh) + (shell[h1 * TH + a0] * (1 - ga) + shell[h1 * TH + a1] * ga) * gh) + 0.02; };
        let mean = 0; for (let i = 0; i < 200; i++) mean += R(i * 0.7, lo + ((i % 20) / 19) * (hi - lo)); mean /= 200;
        const turns = Math.max(2, Math.min(14, pathLen / (Math.PI * 2 * mean)));
        for (let i = 0; i < N; i++) {
          const s = (Math.floor(i / CV) + 0.5) / CU, v = ((i % CV) + 0.5) / CV - 0.5, th = -s * turns * Math.PI * 2, y = lo + 0.04 + s * (hi - lo - 0.08) + v * BW, r = R(th, y), c = Math.cos(th), sn = Math.sin(th);
          L.p.set([r * c, y, r * sn], i * 3); L.n.set([c, 0, sn], i * 3); L.t.set([sn, 0, -c], i * 3); bandUv(s, v, L.uv, i);
        }
        L.cell.set((turns * Math.PI * 2 * mean) / CU, BW / CV); L.uvc.set(pathLen / CU / (BW * 1.5) / NP, 1 / CV);
      }
    }
    for (const a of ['p', 'n', 't', 'uv'] as const) { const at = geo.getAttribute(`a${a.toUpperCase()}${k}`) as THREE.InstancedBufferAttribute; at.needsUpdate = true; }
  }

  // ---- 4万枚の面
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]), 3));
  geo.setIndex([0, 1, 2, 0, 2, 3]);
  for (const k of [0, 1]) { geo.setAttribute(`aP${k}`, new THREE.InstancedBufferAttribute(slot[k].p, 3)); geo.setAttribute(`aN${k}`, new THREE.InstancedBufferAttribute(slot[k].n, 3)); geo.setAttribute(`aT${k}`, new THREE.InstancedBufferAttribute(slot[k].t, 3)); geo.setAttribute(`aUV${k}`, new THREE.InstancedBufferAttribute(slot[k].uv, 2)); }
  const key = new Float32Array(N); for (let i = 0; i < N; i++) key[i] = (Math.floor(i / CV) / CU) * 0.94 + Math.random() * 0.06;
  geo.setAttribute('aKey', new THREE.InstancedBufferAttribute(key, 1));
  geo.instanceCount = N;
  const U: Record<string, { value: unknown }> = {
    uTime: { value: 0 }, uBeat: { value: 0 }, uPulse: { value: 0 }, uX: { value: 1 }, uTo: { value: 0 }, uRes: { value: new THREE.Vector2(1, 1) },
    uPtr: { value: new THREE.Vector2() }, uTouch: { value: new THREE.Vector3() }, uTouchK: { value: 0 }, tAtlas: { value: atlas },
    uCell0: { value: slot[0].cell }, uCell1: { value: slot[1].cell }, uUvc0: { value: slot[0].uvc }, uUvc1: { value: slot[1].uvc },
  };
  PK.forEach((k) => (U[`u_${k}`] = { value: DEF[k] }));
  const UD = `uniform float uTime, uBeat, uPulse, uX, uTo, uTouchK, ${PK.map((k) => `u_${k}`).join(', ')}; uniform vec2 uRes, uPtr, uCell0, uCell1, uUvc0, uUvc1; uniform vec3 uTouch; uniform sampler2D tAtlas;\n${NOISE}`;
  const mat = new THREE.ShaderMaterial({ uniforms: U, side: THREE.DoubleSide,
    vertexShader: UD + /* glsl */ `
      attribute vec3 aP0, aN0, aT0, aP1, aN1, aT1; attribute vec2 aUV0, aUV1; attribute float aKey;
      varying vec2 vQ, vU0, vU1; varying vec3 vN, vT, vW, vV; varying float vWt, vFace;
      mat2 rot(float a){ float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }
      void main(){
        // 移りは、1枚ずつ ずれて進む(帯に沿って先頭から。少しだけ ばらつく)。
        float w1 = smoothstep(0.0, 1.0, clamp(uX * 3.2 - 2.2 * aKey, 0.0, 1.0));
        float w = uTo > 0.5 ? w1 : 1.0 - w1;   // 1 なら並び1、0 なら並び0
        vec3 P = mix(aP0, aP1, w), Nn = normalize(mix(aN0, aN1, w) + 1e-5), T = normalize(mix(aT0, aT1, w) + 1e-5);
        vec3 B = normalize(cross(Nn, T)); T = cross(B, Nn);
        vec2 cell = mix(uCell0, uCell1, w) * u_size;
        float arc = sin(w1 * 3.1416);
        P += flow(vec3(aKey * 5.0, 0.0, 0.0) + P * 0.25, uTime * 0.3) * arc * 0.5;                                   // 移る途中は、ふくらんで流れる
        P += Nn * (fbm(P * 1.5 + uTime * 0.25) - 0.45) * 0.55 * u_blob;                              // 塊: 表面が うねる
        vec3 c0 = texture2D(tAtlas, mix(aUV0, aUV1, step(0.5, w))).rgb; float lum = dot(c0, vec3(0.299, 0.587, 0.114));
        P += Nn * lum * 0.5 * u_relief * (1.0 + 0.25 * uPulse);                                        // 高さ: 明るい所が浮く
        for (int i = 0; i < 2; i++) P += flow(P * 1.6 + aKey, uTime * 0.25 + float(i)) * u_scat * (0.12 + 0.5 * uPulse * uPulse); // 散り
        float nf = uTouchK * exp(-dot(P - uTouch, P - uTouch) / 0.2);                                   // 指のまわり
        P += Nn * nf * 0.22;
        cell *= mix(1.0, 0.25 + 1.1 * (1.0 - lum), u_half);                                            // 網点: 暗い所ほど大きい点
        float fl = 3.1416 * (u_flip * (0.5 + 0.5 * sin(uTime * 1.1 + P.x * 3.0 + P.y * 2.0 + aKey * 6.0)) * (0.35 + 0.65 * uPulse) + nf); // 返り
        vec2 qd = position.xy;
        float fur = u_fur * (0.25 + 0.95 * smoothstep(0.35, 0.75, fbm(P * 1.4 + vec3(0.0, -uTime * 0.35, 0.0))) + nf) * (1.0 + 0.6 * uPulse);
        // 面の2辺。毛になると、1辺が面の向きへ立って伸び、もう1辺は細る。
        vec3 e1 = T * cell.x * mix(1.0, 0.3, min(1.0, fur * 2.0));
        vec3 e2 = mix(B * cell.y, (Nn + flow(P * 2.0, uTime * 0.4) * 0.6) * 0.22, min(1.0, fur));
        vec3 off = e1 * qd.x + e2 * (min(1.0, fur) > 0.01 ? qd.y + 0.5 * min(1.0, fur) : qd.y);
        // 返り: 溝の向きを軸に回る
        vec3 rB = B * cos(fl) + Nn * sin(fl), rN = Nn * cos(fl) - B * sin(fl);
        off = mix(off, T * cell.x * qd.x + rB * cell.y * qd.y, step(0.001, fl) * (1.0 - min(1.0, fur)));
        // なめらかな立体が現れている所では、面は消える(立体と入れ替わる)。
        float gone = step(fbm(P * 1.6), u_solid * 1.08 - 0.04) * step(0.5, u_solid + 0.49);
        vec4 wp = modelMatrix * vec4(P + off * (1.0 - gone), 1.0);
        vW = wp.xyz; vQ = qd; vWt = w; vU0 = aUV0 + qd * uUvc0; vU1 = aUV1 + qd * uUvc1;
        vec4 mv = viewMatrix * wp; vV = normalize(-mv.xyz);
        vN = normalize(normalMatrix * mix(Nn, rN, step(0.001, fl))); vT = normalize(normalMatrix * T); vFace = cos(fl);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: UD + /* glsl */ `
      varying vec2 vQ, vU0, vU1; varying vec3 vN, vT, vW, vV; varying float vWt, vFace;
      void main(){
        if (length(vQ) > mix(0.75, 0.5, u_round)) discard;
        vec3 n = normalize(vN) * (gl_FrontFacing ? 1.0 : -1.0);
        vec3 ph = mix(texture2D(tAtlas, vU0).rgb, texture2D(tAtlas, vU1).rgb, vWt);
        vec3 base = mix(${PAPER} * (0.55 + 0.45 * u_half), ph, u_photo * (1.0 - u_half));
        vec3 col = shade(base, n, normalize(vV), normalize(vT), vW, u_iri, u_rim, u_lit, u_pat, uPulse, uPtr, uTouchK, uBeat, uTime);
        col += pow(max(0.0, 1.0 - abs(vFace)), 6.0) * 0.6 * u_flip;   // 返る途中の きらめき
        gl_FragColor = vec4(col, 1.0);
      }` });
  const mesh = new THREE.Mesh(geo, mat); mesh.frustumCulled = false; scene.add(mesh);

  // ---- なめらかな立体(同じ質感の式で塗る。模様の しきい値で、面と入れ替わる)
  const solidMat = new THREE.ShaderMaterial({ uniforms: U, side: THREE.DoubleSide,
    vertexShader: UD + `varying vec3 vN, vT, vW, vV, vP; void main(){ vP = position; vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; vec4 mv = viewMatrix * w; vV = normalize(-mv.xyz); vN = normalize(normalMatrix * normal); vT = normalize(normalMatrix * normalize(cross(vec3(0.0, 1.0, 0.0), normal) + 1e-4)); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: UD + /* glsl */ `varying vec3 vN, vT, vW, vV, vP;
      void main(){
        float r = fbm(vP * 1.6), th = u_solid * 1.08 - 0.04;
        if (r > th) discard;
        vec3 n = normalize(vN) * (gl_FrontFacing ? 1.0 : -1.0);
        vec3 col = shade(${PAPER}, n, normalize(vV), normalize(vT), vW, u_iri, u_rim, max(u_lit, 1.0 - u_iri - u_rim - u_pat), u_pat, uPulse, uPtr, uTouchK, uBeat, uTime);
        col += (1.0 - smoothstep(0.0, 0.04, th - r)) * step(u_solid, 0.98) * 1.2;   // 現れる縁が光る
        gl_FragColor = vec4(col, 1.0);
      }` });
  const solid = new THREE.Mesh(new THREE.BufferGeometry(), solidMat); solid.frustumCulled = false; solid.visible = false; scene.add(solid);

  // ---- 後処理: 残像・引きずり → ディザ
  const FSQ = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
  const qScene = new THREE.Scene(), qCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1), quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2)); quad.frustumCulled = false; qScene.add(quad);
  const fb = new THREE.ShaderMaterial({ uniforms: { ...U, tS: { value: null }, tP: { value: null } }, vertexShader: FSQ, fragmentShader: UD + /* glsl */ `varying vec2 vUv; uniform sampler2D tS, tP;
    void main(){ vec2 blk = floor(vUv * vec2(18.0 * uRes.x / uRes.y, 18.0));
      vec2 mv = (vec2(h31(vec3(blk, floor(uBeat))), h31(vec3(blk, floor(uBeat) + 7.0))) - 0.5) * 0.05 * uPulse * u_mosh + (vUv - 0.5) * 0.005 * u_trail;
      vec3 now = texture2D(tS, vUv).rgb, prev = texture2D(tP, vUv - mv).rgb;
      gl_FragColor = vec4(max(now * (1.0 - 0.6 * uPulse * u_mosh), prev * u_trail), 1.0); }` });
  const fin = new THREE.ShaderMaterial({ uniforms: { ...U, tS: { value: null } }, vertexShader: FSQ, fragmentShader: UD + /* glsl */ `varying vec2 vUv; uniform sampler2D tS;
    float bayer(vec2 p){ vec2 a = floor(mod(p, 4.0)); float i = a.x + a.y * 4.0; float m[16]; m[0]=0.;m[1]=8.;m[2]=2.;m[3]=10.;m[4]=12.;m[5]=4.;m[6]=14.;m[7]=6.;m[8]=3.;m[9]=11.;m[10]=1.;m[11]=9.;m[12]=15.;m[13]=7.;m[14]=13.;m[15]=5.; float v = 0.0; for (int k = 0; k < 16; k++) if (float(k) == i) v = m[k]; return (v + 0.5) / 16.0; }
    void main(){ vec3 c = texture2D(tS, vUv).rgb; float cell = max(2.0, floor(uRes.y / 190.0)); vec2 px = floor(gl_FragCoord.xy / cell);
      float l = dot(texture2D(tS, (px + 0.5) * cell / uRes).rgb, vec3(0.299, 0.587, 0.114));
      gl_FragColor = vec4(mix(c, ${PAPER} * step(bayer(px), l * 1.15), u_dith), 1.0); }` });
  let rtS: THREE.WebGLRenderTarget, rtA: THREE.WebGLRenderTarget, rtB: THREE.WebGLRenderTarget;
  let vw = 1, vh = 1;
  function resize() {
    vw = root.clientWidth; vh = root.clientHeight; const dpr = Math.min(window.devicePixelRatio || 1, 2);
    renderer.setPixelRatio(dpr); renderer.setSize(vw, vh, false); cam.aspect = vw / vh; cam.updateProjectionMatrix();
    (U.uRes.value as THREE.Vector2).set(vw * dpr, vh * dpr);
    [rtS, rtA, rtB].forEach((r) => r?.dispose());
    const o = { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter };
    rtS = new THREE.WebGLRenderTarget(vw * dpr, vh * dpr, o); rtA = new THREE.WebGLRenderTarget(vw * dpr, vh * dpr, { ...o, depthBuffer: false }); rtB = new THREE.WebGLRenderTarget(vw * dpr, vh * dpr, { ...o, depthBuffer: false });
  }

  // ---- 進行: 状態から状態へ、つながって移る
  let from = STATES[0], to = STATES[0], toSlot = 0, x = 1, startBeat = 0, beat = 0, t = 0, last = performance.now(), frozen = false;
  let subjFrom: Subject | null = null, subjTo: Subject | null = null, swapped = true;
  const camNow = [0, 0, 5.2];
  fill(0, 'band', null); fill(1, 'band', null);
  const bag: State[] = [];
  function pick(): State {
    // 本人(2026-11-25):「平面の四角のまま見せる案は全部ダメかな」→ 板の状態(写真の板・高さになる板・網点の板)は巡回から外す。?plane=1 で戻せる。
    if (!bag.length) bag.push(...STATES.filter((s) => s !== to && (planeOn || s.lay !== 'plane')).sort(() => Math.random() - 0.5));
    // 立体がまだ届いていなければ、立体の要る状態は後回し。
    const i = bag.findIndex((s) => (s.lay !== 'surf' && s.lay !== 'wrap') || subjects.length > 0);
    return bag.splice(Math.max(0, i), 1)[0];
  }
  function goto(s: State, sub?: Subject) {
    from = to; to = s; subjFrom = subjTo;
    const needs = s.lay === 'surf' || s.lay === 'wrap';
    // 立体は、ときどき替える(立体から立体へ、面が飛び移る)。
    subjTo = needs ? (sub ?? (subjTo && from.lay !== 'band' && from.lay !== 'plane' && Math.random() < 0.45 ? subjTo : subjects[Math.floor(Math.random() * subjects.length)])) : subjTo;
    toSlot = 1 - toSlot; fill(toSlot, s.lay, subjTo);
    x = 0; startBeat = beat; swapped = false;
    U.uTo.value = toSlot;
    if (label) label.textContent = s.id;
  }
  const ptr = new THREE.Vector2(0.3, 0.3), touch = new THREE.Vector3();
  let touchK = 0, lastMove = -10, down = false, drawing = false, moved = false, downX = 0, downY = 0, lastX = 0, lastY = 0, downAt = 0, dYaw = 0, dPitch = 0, vYaw = 0, vPitch = 0, pts: number[][] = [], redraw = 0;
  const ray = new THREE.Raycaster(), plane = new THREE.Plane(), fwd = new THREE.Vector3();
  const P: Record<PKey, number> = { ...DEF };
  function frame(now: number) {
    if (dead) return;
    const dt = Math.max(0, Math.min(0.05, (now - last) / 1000)); last = now;
    if (!frozen) { t += dt; beat += (dt * BPM) / 60; if (!drawing && beat - startBeat >= PERIOD) goto(pick()); x = Math.min(1, (beat - startBeat) / MOVE); }
    const e = smooth(x), sameSubj = subjFrom === subjTo;
    PK.forEach((k) => { const a = from.p[k] ?? DEF[k], b = to.p[k] ?? DEF[k]; P[k] = a + (b - a) * e; });
    // なめらかな立体は、先に引っ込んでから並びが変わり、並びが整ってから現れる。
    const sa = from.p.solid ?? 0, sb = to.p.solid ?? 0, keep = sa > 0 && sb > 0 && sameSubj && from.lay === 'surf';
    P.solid = keep ? 1 : Math.max(sa * (1 - smooth(x / 0.3)), sb * smooth((x - 0.7) / 0.3));
    if (!swapped && (x > 0.5 || sa === 0)) { swapped = true; if (subjTo?.geo && sb > 0) solid.geometry = subjTo.geo; }
    solid.visible = P.solid > 0.01 && !!solid.geometry.attributes.position;
    PK.forEach((k) => (U[`u_${k}`].value = P[k]));
    const pulse = Math.exp(-(beat - Math.floor(beat)) * 4.5);
    U.uTime.value = t; U.uBeat.value = beat; U.uPulse.value = pulse; U.uX.value = x;
    // 視点も、状態から状態へ つながって動く。止まっている間も、ゆっくり流れる。
    for (let i = 0; i < 3; i++) camNow[i] = from.cam[i] + (to.cam[i] - from.cam[i]) * e;
    const active = t - lastMove < 0.25 || down; touchK += ((active ? 1 : 0) - touchK) * Math.min(1, dt * (active ? 10 : 1.6));
    dYaw += vYaw; dPitch += vPitch; vYaw *= 0.92; vPitch *= 0.92; if (!down) { dYaw *= 1 - Math.min(1, dt * 0.6); dPitch *= 1 - Math.min(1, dt * 0.6); }
    const flat = to.lay === 'band' && x > 0.9 ? 0 : 1; // 平らな帯のときは、真正面から(描けるように)
    const yaw = camNow[0] + (0.25 * Math.sin(t * 0.21) + dYaw) * flat, pitch = Math.max(-1.4, Math.min(1.4, camNow[1] + (0.1 * Math.sin(t * 0.17 + 1) + dPitch) * flat)), need = (rd: number) => (rd * 1.12) / (Math.tan((17.5 * Math.PI) / 180) * Math.min(1, vw / vh));
    const wide = (s: State, sb: Subject | null) => s.lay === 'plane' ? need(1.08 * Math.abs(Math.cos(yaw)) + 0.1) : ((s.lay === 'surf' || s.lay === 'wrap') && sb ? need(Math.abs(Math.cos(yaw)) * sb.hx + Math.abs(Math.sin(yaw)) * sb.hz + 0.12) : 0);
    const r = Math.max(camNow[2] * (vw / vh < 0.8 ? 1 + (0.8 - vw / vh) * 0.9 : 1), wide(from, subjFrom) * (1 - e) + wide(to, subjTo) * e);
    cam.position.set(Math.sin(yaw) * Math.cos(pitch) * r, Math.sin(pitch) * r, Math.cos(yaw) * Math.cos(pitch) * r); cam.lookAt(0, 0, 0); cam.updateMatrixWorld();
    cam.getWorldDirection(fwd); plane.setFromNormalAndCoplanarPoint(fwd, scene.position); ray.setFromCamera(ptr, cam); ray.ray.intersectPlane(plane, touch);
    (U.uPtr.value as THREE.Vector2).copy(ptr); (U.uTouch.value as THREE.Vector3).copy(touch); U.uTouchK.value = touchK;
    if (redraw && drawing && pts.length > 3) { redraw = 0; setPath(pts); fill(toSlot, 'band', null); }
    renderer.setRenderTarget(rtS); renderer.render(scene, cam);
    fb.uniforms.tS.value = rtS.texture; fb.uniforms.tP.value = rtA.texture; quad.material = fb; renderer.setRenderTarget(rtB); renderer.render(qScene, qCam);
    fin.uniforms.tS.value = rtB.texture; quad.material = fin; renderer.setRenderTarget(null); renderer.render(qScene, qCam);
    [rtA, rtB] = [rtB, rtA];
    requestAnimationFrame(frame);
  }

  // ---- 入力
  const setPtr = (e: PointerEvent) => { const r = root.getBoundingClientRect(); ptr.set(((e.clientX - r.left) / vw) * 2 - 1, -(((e.clientY - r.top) / vh) * 2 - 1)); lastMove = t; };
  const onDown = (e: PointerEvent) => { if ((e.target as HTMLElement).closest('a,button')) return; down = true; moved = false; drawing = false; downX = lastX = e.clientX; downY = lastY = e.clientY; downAt = performance.now(); setPtr(e); };
  const onMove = (e: PointerEvent) => {
    setPtr(e); if (!down) return;
    if (!moved && Math.hypot(e.clientX - downX, e.clientY - downY) > 10) { moved = true; if (to.lay === 'band' && x > 0.9) { drawing = true; pts = []; } }
    if (drawing) { ray.setFromCamera(ptr, cam); const o = ray.ray.origin, d = ray.ray.direction, k = -o.z / (d.z || -1e-6), X = o.x + d.x * k, Y = o.y + d.y * k, l = pts[pts.length - 1]; if (!l || Math.hypot(X - l[0], Y - l[1]) > 0.03) { pts.push([X, Y]); redraw = 1; startBeat = beat - MOVE; } }
    else if (moved) { vYaw = -(e.clientX - lastX) * 0.006; vPitch = (e.clientY - lastY) * 0.006; }
    lastX = e.clientX; lastY = e.clientY;
  };
  const onUp = () => { if (!down) return; down = false; if (drawing) { drawing = false; if (pts.length > 3) { path = pts; setPath(path); fill(toSlot, 'band', null); startBeat = beat - PERIOD + 2; } } else if (!moved && performance.now() - downAt < 500) goto(pick()); };
  const onKey = (e: KeyboardEvent) => { if (e.key === 'ArrowRight' || e.key === ' ') goto(pick()); };
  root.addEventListener('pointerdown', onDown); window.addEventListener('pointermove', onMove); window.addEventListener('pointerup', onUp); window.addEventListener('pointercancel', onUp); window.addEventListener('keydown', onKey); window.addEventListener('resize', resize);
  resize();
  if (label) label.textContent = to.id;
  void q;
  requestAnimationFrame(frame);

  // 確認用: __flow.set('虹の立体', 'antiquecamera') で その状態へ向かう。__flow.x(0.5) で移りの途中に止める(null で戻す)。
  (window as unknown as { __flow?: unknown }).__flow = {
    set(id: string, sub?: string) { const s = STATES.find((v) => v.id === id); if (s) goto(s, subjects.find((v) => v.name === sub)); return !!s; },
    x(v: number | null) { frozen = v !== null; if (v !== null) { x = v; beat = startBeat + v * MOVE; t = (beat * 60) / BPM; } },
    touch(a: number | null, b = 0) { if (a === null) { lastMove = -10; touchK = 0; } else { ptr.set(a, b); lastMove = 1e9; touchK = 1; } },
    get ids() { return STATES.map((s) => s.id); }, get ready() { return subjects.length >= 1 + FREE.length && imgs.length >= 2; },
  };

  return () => { dead = true; root.removeEventListener('pointerdown', onDown); window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); window.removeEventListener('pointercancel', onUp); window.removeEventListener('keydown', onKey); window.removeEventListener('resize', resize); renderer.dispose(); };
}
