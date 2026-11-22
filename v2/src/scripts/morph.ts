// 試作: 同じ物質が、姿を変え続ける。操作は、指一本(なぞる)だけ。
//
// 画面にあるのは、最初から最後まで同じ「小さな面」の集まり(約6万枚)。場面は切り替わらない。
// 面の並び方と、指の役割だけが変わっていく:
//   0 帯     … 指 = 筆。なぞった跡に並んで、平らな帯になる。帯の中に作品の写真が順に見える(写真は まっすぐ。帯が窓になる)
//   1 立体   … 指 = 光。帯が ねじれて奥行きを持ち、紙として光と艶が乗る。裏は紙の色。指を動かすと、奥行きが ずれて見える
//   2 粒子   … 指 = 渦。面が光の粒になり、なぞった線に沿って、撚り合わさりながら流れる(残像つき)。色は写真の色
//   3 作品   … 粒が集まり、1つの作品が奥行きを持った粒の像として立つ。視点が回り込む(写真は2層、平面の作品は紙)
//   → 0 帯   … 棒が、なぞった跡へ戻る
//
// 進めるのは時間ではなく、描いた長さ。手を止めると、その状態のまま漂う。
// 変わり目は、ペン先から帯の後ろへ向かって伝わる(1枚ずつ、決まった遅れで)。
// しばらく誰も触らないと、ペンがひとりでに描く(なので、放っておいても一周する)。
//
// 手札は 映像表現研究 から: 粒子列ロープ(輪になった記録で、尽きないように見せる / 撚りの見た目)、UzU(根元から順に、遅れて)、
// Ringwriter(1枚ごとの決まった しきい値)、網点(大きさで見せる)、Topographic(操作の音)。
//
// 確認用: window.__morph = { phase(v), auto(on), draw(pts), state }

import { makeSfx } from './sfx';

const M = 640; // なぞった跡を覚えておく数(輪になっていて、古いものから上書きする)
const SEG = 32; // 作品1つぶんの長さ(跡の数)
const NV = 64; // 帯の幅方向の枚数
const NU = M * 2; // 帯の長さ方向の枚数
const TILES = NU * NV;
const HOLD = 0.5; // 1つの状態のうち、変わらずにいる割合
const SPREAD = 1.5; // 変わり目が、帯の後ろへ伝わるのにかかる長さ
const STATE_LEN = 0.62; // 1つの状態ぶんの、描く長さ(帯の長さに対する割合)
const ACOLS = 6;
const AROWS = 5;
const CELL = 400;
const NAMES = ['Band', 'Solid', 'Particle', 'Work'];

const VS = `#version 300 es
precision highp float;
precision highp int;
layout(location=0) in vec2 aQ;
uniform sampler2D uPath;
uniform sampler2D uAtlas;
uniform highp sampler2D uShadow;
uniform vec2 uView;
uniform float uDp, uW, uTime, uPhase, uK, uTwK, uZK, uPass;
uniform float uAsp[30];
uniform float uPitch, uCols, uCells, uStep;
uniform float uFocus, uFocusAsp;
uniform sampler2D uSDep;  // 立つ作品の奥行き(r: 奥行き / g: 背景の奥行き / b: 被写体の切り抜き)
uniform sampler2D uSBg;   // 立つ作品の背景(被写体の所を埋めたもの)
uniform float uSFlat;     // 立つ作品が平面か
uniform vec2 uSwing;      // 立つ作品のまわりの回り込み
uniform vec3 uPen;   // 指(ペン)の位置と、あるかどうか
uniform vec3 uLight; // 光の位置(立体のとき)
uniform vec2 uCam;   // 視点の ずれ
out vec2 vQ; out vec2 vUV; out vec2 vCell; out vec2 vShape; out vec2 vRib;
out vec4 vMix;  // x: 丸さ / y: 不透明さ(1 = ふつうに重なる, 0 = 光として足す) / z: 線を引くか / w: 表(+) か 裏(-)
out vec4 vLit;  // x: 明るさ / y: 艶 / z: 立体の割合
out vec4 vAlt;  // rgb: 粒・棒の色 / a: それを使う割合
const float Mf = ${M}.0;
const int Mi = ${M};
const int NVi = ${NV};
const float HOLD = ${HOLD};
const float SP = ${SPREAD};
const float SEGf = ${SEG}.0;
const vec3 PAPER = vec3(0.957, 0.945, 0.918);
const vec2 AT = vec2(${ACOLS}.0, ${AROWS}.0);
float hsh(uint n){ n = (n << 13U) ^ n; n = n * (n * n * 15731U + 789221U) + 1376312589U; return float(n & 0x7fffffffU) / 2147483647.0; }
vec3 photo(float work, vec2 uv){
  vec2 c = vec2(mod(work, AT.x), floor(work / AT.x));
  return textureLod(uAtlas, (c + clamp(uv, vec2(0.004), vec2(0.996))) / AT, 0.0).rgb;
}
// 光から見て、床のどこに落ちるか(影の地図の位置)と、光からの近さ。
vec3 toShadow(vec3 p){
  float h = uLight.z;
  float z = min(p.z, h * 0.85);
  vec2 g = uLight.xy + (p.xy - uLight.xy) * h / (h - z);
  return vec3((g - uView * 0.5) / (uView * 2.0), 0.5 - z / (8.0 * uW));
}
float shadowAt(vec3 p){
  vec3 m = toShadow(p);
  vec2 uv = m.xy + 0.5;
  float s = 0.0;
  const float E = 1.4 / 1024.0;
  s += step(textureLod(uShadow, uv + vec2(E, 0.0), 0.0).r + 0.014, m.z);
  s += step(textureLod(uShadow, uv + vec2(-E, 0.0), 0.0).r + 0.014, m.z);
  s += step(textureLod(uShadow, uv + vec2(0.0, E), 0.0).r + 0.014, m.z);
  s += step(textureLod(uShadow, uv + vec2(0.0, -E), 0.0).r + 0.014, m.z);
  return s * 0.25;
}
void main(){
  int i = gl_InstanceID;
  int iu = i / NVi; int iv = i - iu * NVi;
  int j = iu / 2; float fr = float(iu - j * 2) * 0.5 + 0.25;
  float v = (float(iv) + 0.5) / float(NVi) - 0.5;
  vec4 r0 = texelFetch(uPath, ivec2(j, 0), 0);
  vec4 r1 = texelFetch(uPath, ivec2(j, 1), 0);
  vec4 r2 = texelFetch(uPath, ivec2(j, 2), 0);
  float age = mod(uK - 1.0 - float(j), Mf);
  float hd = age / Mf;
  float h1 = hsh(uint(i)); float h2 = hsh(uint(i) + 7919U); float h3 = hsh(uint(i) * 3U + 17U);
  vec2 P = r0.xy; vec2 T = r0.zw;
  // まだ描かれていない面は、ペン先に しまってある。
  if (r1.w < 0.5) { P = uPen.xy; T = vec2(1.0, 0.0); }
  vec2 N = vec2(-T.y, T.x);

  // この1枚が、いま どの状態と どの状態の間にいるか。
  float A = floor(uPhase); float f = uPhase - A;
  float x = clamp((f - HOLD) / (1.0 - HOLD), 0.0, 1.0);
  float w = clamp(x * (1.0 + SP) - SP * (0.72 * hd + 0.28 * h1), 0.0, 1.0);
  w = w * w * (3.0 - 2.0 * w);
  int a = int(mod(A, 4.0));
  vec4 wt = vec4(0.0);
  wt[a] = 1.0 - w; wt[(a + 1) % 4] += w;
  float dotw = wt.z + wt.w;

  // ---- 帯の面: 四隅を、それぞれの位置での芯から作る(となりの面と、ぴったり つながる)。
  float tq = (fr - 0.5) + aQ.x * 0.25;          // この跡の中心から見た、長さ方向の位置(-0.5〜0.5)
  float vc = v + aQ.y * (0.5 / float(NVi));     // 幅方向の位置
  int jn = tq < 0.0 ? (j == 0 ? Mi - 1 : j - 1) : (j + 1 == Mi ? 0 : j + 1);
  vec4 q0 = texelFetch(uPath, ivec2(jn, 0), 0);
  float seam = tq < 0.0 ? step(Mf - 1.5, age) : step(age, 0.5);
  float ok = r1.w * texelFetch(uPath, ivec2(jn, 1), 0).w * step(distance(q0.xy, P), uDp * 1.6) * (1.0 - seam);
  vec2 Pq; vec2 Tq;
  if (ok > 0.5) {
    if (tq < 0.0) { Pq = mix(q0.xy, P, tq + 1.0); Tq = mix(q0.zw, T, tq + 1.0); }
    else { Pq = mix(P, q0.xy, tq); Tq = mix(T, q0.zw, tq); }
  } else { Pq = P + T * tq * uDp; Tq = T; }
  Tq = normalize(Tq + vec2(1e-5, 0.0));
  vec2 Nq = vec2(-Tq.y, Tq.x);
  float uc = float(j) + 0.5 + tq;

  // ---- 0 帯
  vec3 X0 = vec3(Pq + Nq * vc * uW, 0.0);
  vec3 C0 = vec3(P + T * (fr - 0.5) * uDp + N * v * uW, 0.0);

  // ---- 1 立体: 床から浮き、芯のまわりに ねじれ、前後に波うつ。紙として光を受け、影を落とす。
  float th = uc * uTwK + uTime * 0.4;
  float cs = cos(th); float sn = sin(th);
  float zph = uc * uZK - uTime * 0.6;
  float zc = uW * (0.6 + 0.45 * sin(zph));
  vec3 X1 = vec3(Pq + Nq * vc * uW * cs, zc + vc * uW * sn);
  float thc = (float(j) + fr) * uTwK + uTime * 0.4;
  vec3 C1 = vec3(P + T * (fr - 0.5) * uDp + N * v * uW * cos(thc), uW * (0.6 + 0.45 * sin((float(j) + fr) * uZK - uTime * 0.6)) + v * uW * sin(thc));
  vec3 nrm = normalize(vec3(-Nq * sn, cs) - vec3(Tq, 0.0) * (cos(zph) * uW * 0.45 * uZK / uDp) * cs);
  float face = nrm.z;
  vec3 nn = face < 0.0 ? -nrm : nrm;
  vec3 Ld = uLight - X1;
  float dl2 = dot(Ld, Ld);
  vec3 L = Ld * inversesqrt(dl2);
  float R = max(uView.x, uView.y) * 0.55;
  float att = 1.0 / (1.0 + dl2 / (R * R));
  float sh = wt.y > 0.001 && uPass < 0.5 ? shadowAt(X1) : 0.0;
  float dif = max(dot(nn, L), 0.0);
  float spc = pow(max(dot(nn, normalize(L + vec3(0.0, 0.0, 1.0))), 0.0), 36.0);
  float rim = pow(1.0 - abs(nn.z), 3.0);
  float lit = 0.09 + (1.45 * dif * att + 0.1 * rim) * (1.0 - 0.82 * sh);
  float gloss = 0.4 * spc * att * (1.0 - sh);

  // ---- 2 粒子: なぞった線に沿って流れる、撚り合わさった光の束。
  float sj = float(j) + fr;
  float sr = mod(sj + uTime * mix(6.0, 24.0, h2), Mf);
  int ja = int(floor(sr)); int jb = ja + 1 == Mi ? 0 : ja + 1;
  float ff = sr - floor(sr);
  vec4 a0 = texelFetch(uPath, ivec2(ja, 0), 0);
  vec4 a1 = texelFetch(uPath, ivec2(ja, 1), 0);
  vec4 a2 = texelFetch(uPath, ivec2(ja, 2), 0);
  vec4 b0 = texelFetch(uPath, ivec2(jb, 0), 0);
  float bw = texelFetch(uPath, ivec2(jb, 1), 0).w;
  float contig = a1.w * bw * step(distance(a0.xy, b0.xy), uDp * 1.6);
  vec2 Pp = mix(a0.xy, b0.xy, ff * contig);
  vec2 Tp = normalize(mix(a0.zw, b0.zw, ff * contig) + vec2(1e-5, 0.0));
  vec2 Np = vec2(-Tp.y, Tp.x);
  float ageA = mod(uK - 1.0 - float(ja), Mf);
  float alive = a1.w * smoothstep(Mf, Mf - 22.0, ageA) * smoothstep(0.0, 0.2, uTime - a1.z);
  // 幅方向の位置ごとに、12本の筋に分ける。同じ筋の粒は、同じ うねり方をする(撚った束に見える)。少しだけ、はぐれた粒がいる。
  float sid = floor(float(iv) / 4.0);
  float stray = h1 < 0.1 ? 1.0 : 0.0;
  float amp = mix(mix(0.22, 1.0, fract(sid * 0.618)), 0.4 + 2.2 * h3, stray) + (h3 - 0.5) * 0.07;
  float ang = sr * mix(mix(0.17, 0.33, fract(sid * 0.37)), 0.1 + 0.4 * h2, stray) + sid * 0.5236 + h2 * 6.283 * stray + uTime * 0.45;
  vec2 pl = Pp + Np * (uW * 0.5 * amp * sin(ang));
  vec3 c2 = vec3(pl, uW * 0.5 * amp * cos(ang));
  // 指のまわりで、渦を巻く。
  vec2 dpn = uPen.xy - c2.xy; float dln = length(dpn) + 1.0;
  float sw = uPen.z * exp(-dln * dln / (uW * uW * 3.0));
  c2.xy += (vec2(-dpn.y, dpn.x) * 0.9 + dpn * 0.35) / dln * uW * 0.8 * sw;
  float r2d = mix(0.8, 1.9, h2 * h2) * (1.0 + sw);
  float aspA = uAsp[int(a2.w)];
  vec3 pcol = photo(a2.w, 0.5 + (pl - a2.xy) / vec2(a2.z, a2.z / aspA));
  pcol = (pcol * 0.9 + 0.05) * mix(0.1, 0.24, h1) * alive;

  // ---- 3 作品が立つ: 流れていた粒が集まり、1つの作品が奥行きを持った粒の像として立つ。
  //   写真の作品は2層(埋めた背景 + 手前の被写体)。平面の作品は紙として波打つ(奥行きは足さない)。
  float per = floor(float(${TILES}) * 0.5);
  float lay = float(i) < per ? 0.0 : 1.0;
  float jj = float(i) - lay * per;
  float gwf = max(8.0, floor(sqrt(per * uFocusAsp)));
  float ghf = floor(per / gwf);
  float gyy = floor(jj / gwf); float gxx = jj - gyy * gwf;
  vec2 suv = (vec2(gxx, gyy) + 0.5) / vec2(gwf, ghf);
  vec4 sdm = textureLod(uSDep, suv, 0.0);
  bool sfg = lay > 0.5;
  bool shide = gyy >= ghf || (sfg && (uSFlat > 0.5 || sdm.b < 0.5));
  float SW = min(uView.x * (uView.x > uView.y ? 0.7 : 0.86), uView.y * 0.7 * uFocusAsp);
  float SH = SW / uFocusAsp;
  float sDA = min(SW, SH) * 0.6;
  vec3 scol = sfg || uSFlat > 0.5 ? photo(uFocus, suv) : textureLod(uSBg, suv, 0.0).rgb;
  vec3 srest;
  if (uSFlat > 0.5) {
    float ph3 = suv.x * 3.4 + uTime * 0.35;
    srest = vec3((suv.x - 0.5) * SW, (suv.y - 0.5) * SH, sin(ph3) * SW * 0.16 + (suv.y - 0.5) * sin(ph3 * 0.5 + 1.3) * SW * 0.12);
    scol *= 0.8 + 0.2 * (1.0 - abs(cos(ph3) * 0.54)) + 0.08 * cos(ph3) * 0.54;
  } else {
    float dd3 = sfg ? sdm.r : sdm.g;
    srest = vec3((suv.x - 0.5) * SW, (suv.y - 0.5) * SH, (dd3 - 0.45) * sDA + (sfg ? sDA * 0.06 : -sDA * 0.04));
    scol *= 0.74 + 0.36 * dd3;
  }
  // 視点が、作品のまわりを回り込む。
  float cy3 = cos(uSwing.x); float sy3 = sin(uSwing.x);
  srest = vec3(cy3 * srest.x + sy3 * srest.z, srest.y, -sy3 * srest.x + cy3 * srest.z);
  float cx3 = cos(uSwing.y); float sx3 = sin(uSwing.y);
  srest = vec3(srest.x, cx3 * srest.y - sx3 * srest.z, sx3 * srest.y + cx3 * srest.z);
  vec3 c3 = srest + vec3(uView * 0.5, 0.0);
  float s3 = SW / gwf * 0.8;
  if (shide) { c3 = c2; s3 = 0.0; }

  // ---- まぜる(四隅と、面の中心)
  vec3 q2 = vec3(r2d * aQ, 0.0);
  vec3 q3 = vec3(aQ * s3, 0.0);
  vec3 wp = X0 * wt.x + X1 * wt.y + (c2 + q2) * wt.z + (c3 + q3) * wt.w;
  vec3 cc = C0 * wt.x + C1 * wt.y + c2 * wt.z + c3 * wt.w;
  // 変わる途中は、まっすぐ飛ばずに、少し ふくらんで動く。
  float arc = a == 0 ? 0.0 : sin(3.14159 * w);
  vec3 bulge = vec3((vec2(h2, h3) - 0.5) * uW * 1.1, (h1 - 0.5) * uW * 1.4) * arc;
  // 出てくるところ(ペン先)と、巻き取られるところ(いちばん古い所)。
  float sc = r1.w * smoothstep(0.0, 0.16, uTime - r1.z) * smoothstep(Mf, Mf - 22.0, age);
  sc = mix(sc, 1.0, dotw);
  wp = cc + (wp - cc) * sc + bulge;

  if (uPass > 0.5) {
    // 影の地図: 光から見た近さだけを書く。光の粒や棒は、影を落とさない。
    vec3 m = toShadow(wp);
    vQ = aQ; vShape = vec2(1.0); vMix = vec4(0.0, 1.0, 0.0, 1.0); vLit = vec4(1.0, 0.0, 0.0, 0.0); vAlt = vec4(0.0);
    vUV = vec2(0.5); vCell = vec2(0.0); vRib = vec2(10.0, 0.0);
    gl_Position = dotw > 0.5 || sc < 0.02 ? vec4(2.0, 2.0, 2.0, 1.0) : vec4(m.xy * 2.0, m.z * 2.0 - 1.0, 1.0);
    return;
  }
  const float F = 1500.0;
  vec2 ctr = uView * 0.5;
  vec2 sp = ctr + uCam + (wp.xy - ctr - uCam) * F / (F - wp.z);
  float depth = clamp(-(wp.z + (1.0 - hd) * 3.0) / 1600.0, -0.99, 0.99);
  gl_Position = vec4(sp.x / uView.x * 2.0 - 1.0, 1.0 - sp.y / uView.y * 2.0, mix(depth, 0.6, wt.z), 1.0);

  // 色: 帯のとき、その場所に見えていた写真。
  float asp = uAsp[int(r2.w)];
  vec2 fp = mix(X0.xy, C0.xy, dotw);
  vUV = 0.5 + (fp - r2.xy) / vec2(r2.z, r2.z / asp);
  vCell = vec2(mod(r2.w, AT.x), floor(r2.w / AT.x));
  vQ = aQ;
  vShape = vec2(r2d, r2d) * wt.z / max(dotw, 1e-4) + vec2(s3, s3) * wt.w / max(dotw, 1e-4);
  vMix = vec4(dotw, 1.0 - wt.z, wt.x + wt.y, mix(1.0, face, wt.y));
  vLit = vec4(mix(1.0, lit, wt.y), gloss * wt.y, wt.y, 0.0);
  vAlt = vec4((pcol * wt.z + scol * wt.w) / max(dotw, 1e-4), dotw);
  vRib = vec2((mod(float(j), SEGf) + 0.5 + tq) * uDp, vc * uW);
}`;

const FS = `#version 300 es
precision highp float;
uniform sampler2D uAtlas;
uniform float uW;
in vec2 vQ; in vec2 vUV; in vec2 vCell; in vec2 vShape; in vec2 vRib;
in vec4 vMix; in vec4 vLit; in vec4 vAlt;
out vec4 o;
const vec3 PAPER = vec3(0.957, 0.945, 0.918);
void main(){
  // 形: 四角(帯・立体)から、丸や棒(粒子・網点)へ。丸や棒の ふちは、なめらかに。
  vec2 p = vQ * vShape;
  float r = min(vShape.x, vShape.y);
  vec2 q = max(abs(p) - (vShape - r), 0.0);
  float cov = mix(1.0, clamp(r - length(q) + 0.5, 0.0, 1.0), vMix.x);
  if (cov <= 0.002) discard;
  vec2 uv = clamp(vUV, vec2(0.004), vec2(0.996));
  vec3 col = texture(uAtlas, (vCell + uv) / vec2(${ACOLS}.0, ${AROWS}.0)).rgb;
  if (vMix.w < 0.0) col = PAPER;
  // 帯のふちと、作品の境目の線。
  float line = max(step(uW * 0.5 - 1.3, abs(vRib.y)), step(vRib.x, 1.3));
  col = mix(col, PAPER, line * step(0.98, vMix.z));
  // 光(立体のとき)。明るい所は、白く飛ばさずに丸める。
  vec3 lc = col * vLit.x + vLit.y;
  col = mix(lc, (1.0 - exp(-1.25 * lc)) * 1.22, vLit.z);
  col = mix(col, vAlt.rgb, vAlt.a);
  // 不透明さ 1 = ふつうに重なる / 0 = 光として足す。
  o = vec4(col * cov, vMix.y * cov);
}`;

// 床: 立体のとき、指の光が床を照らし、帯の影が落ちる。
const FLOOR_FS = `#version 300 es
precision highp float;
uniform highp sampler2D uShadow;
uniform vec2 uView;
uniform vec3 uLight;
uniform float uSolid;
in vec2 vUv;
out vec4 o;
void main(){
  vec2 p = vec2(vUv.x, 1.0 - vUv.y) * uView;
  vec2 uv = (p - uView * 0.5) / (uView * 2.0) + 0.5;
  float s = 0.0;
  for (int k = 0; k < 16; k++) {
    float a = float(k) * 2.39996;
    float r = sqrt((float(k) + 0.5) / 16.0) * 3.2 / 1024.0;
    s += step(texture(uShadow, uv + vec2(cos(a), sin(a)) * r).r + 0.006, 0.5);
  }
  s /= 16.0;
  vec2 d = p - uLight.xy;
  float d2 = dot(d, d) + uLight.z * uLight.z;
  float R = max(uView.x, uView.y) * 0.55;
  float e = (1.0 / (1.0 + d2 / (R * R))) * (uLight.z * inversesqrt(d2));
  // 少しだけ粒を足して、なだらかな明るさが縞にならないようにする。
  float n = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5;
  vec3 c = vec3(0.150, 0.146, 0.140) * e * (1.0 - 0.86 * s) * uSolid + n * 0.006 * uSolid;
  o = vec4(max(c, 0.0), 1.0);
}`;

// 残像: 前のコマを少し暗くして、下に敷く。
const FADE_VS = `#version 300 es
layout(location=0) in vec2 aQ;
out vec2 vUv;
void main(){ vUv = aQ * 0.5 + 0.5; gl_Position = vec4(aQ, 0.0, 1.0); }`;
const FADE_FS = `#version 300 es
precision highp float;
uniform sampler2D uPrev;
uniform float uKeep;
in vec2 vUv;
out vec4 o;
void main(){ o = vec4(max(texture(uPrev, vUv).rgb * uKeep - 0.006, 0.0), 1.0); }`;

export function mountMorph(root: HTMLElement) {
  const cv = root.querySelector<HTMLCanvasElement>('[data-canvas]')!;
  const gl = cv.getContext('webgl2', { antialias: false, alpha: false, depth: false, powerPreference: 'high-performance' });
  if (!gl) return () => {};
  const works = [...root.querySelectorAll<HTMLAnchorElement>('a[data-work]')];
  const nW = Math.min(works.length, ACOLS * AROWS);
  if (!nW) return () => {};

  // ---------- GL
  const build = (vs: string, fs: string) => {
    const p = gl.createProgram()!;
    for (const [type, src] of [
      [gl.VERTEX_SHADER, vs],
      [gl.FRAGMENT_SHADER, fs],
    ] as const) {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) console.error('morph shader', gl.getShaderInfoLog(s));
      gl.attachShader(p, s);
    }
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      console.error('morph link', gl.getProgramInfoLog(p));
      return null;
    }
    return p;
  };
  const prog = build(VS, FS);
  const fade = build(FADE_VS, FADE_FS);
  const floor = build(FADE_VS, FLOOR_FS);
  if (!prog || !fade || !floor) return () => {};
  gl.useProgram(floor);
  gl.uniform1i(gl.getUniformLocation(floor, 'uShadow'), 3);
  const fl = { view: gl.getUniformLocation(floor, 'uView'), light: gl.getUniformLocation(floor, 'uLight'), solid: gl.getUniformLocation(floor, 'uSolid') };
  gl.useProgram(fade);
  gl.uniform1i(gl.getUniformLocation(fade, 'uPrev'), 2);
  const uKeep = gl.getUniformLocation(fade, 'uKeep');
  gl.useProgram(prog);
  const U = (n: string) => gl.getUniformLocation(prog, n);
  const u = {
    view: U('uView'), dp: U('uDp'), w: U('uW'), time: U('uTime'), phase: U('uPhase'), k: U('uK'), twK: U('uTwK'), zK: U('uZK'),
    pass: U('uPass'), asp: U('uAsp'), pitch: U('uPitch'), cols: U('uCols'), cells: U('uCells'), step: U('uStep'),
    focus: U('uFocus'), focusAsp: U('uFocusAsp'), sFlat: U('uSFlat'), swing: U('uSwing'), pen: U('uPen'), light: U('uLight'), cam: U('uCam'),
  };
  gl.uniform1i(U('uPath'), 0);
  gl.uniform1i(U('uAtlas'), 1);
  gl.uniform1i(U('uShadow'), 3);
  gl.uniform1i(U('uSDep'), 5);
  gl.uniform1i(U('uSBg'), 6);
  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.depthFunc(gl.LEQUAL);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  gl.clearColor(0, 0, 0, 1);

  // なぞった跡(輪): 3行。 0: x, y, 向き / 1: (空き), 生まれた時刻, 有効 / 2: 写真の中心, 写真の幅, 作品の番号
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
  // 立つ作品の奥行きと背景(必要になった作品だけ読む)。
  const stand: ({ dep: WebGLTexture; bg: WebGLTexture } | null)[] = [];
  const standLoading = new Set<number>();
  const one = gl.createTexture()!;
  gl.activeTexture(gl.TEXTURE5);
  gl.bindTexture(gl.TEXTURE_2D, one);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([128, 128, 0, 255]));
  function loadStand(k: number) {
    if (stand[k] || standLoading.has(k)) return;
    const a = works[k];
    if (!a?.dataset.depth) return;
    standLoading.add(k);
    const d = new Image();
    const b = new Image();
    let n = 0;
    const done = () => {
      if (++n < 2 || dead) return;
      const mk = (im: HTMLImageElement) => {
        const t = gl!.createTexture()!;
        gl!.activeTexture(gl!.TEXTURE7);
        gl!.bindTexture(gl!.TEXTURE_2D, t);
        gl!.texImage2D(gl!.TEXTURE_2D, 0, gl!.RGBA, gl!.RGBA, gl!.UNSIGNED_BYTE, im);
        gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_MIN_FILTER, gl!.LINEAR);
        gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_MAG_FILTER, gl!.LINEAR);
        gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_WRAP_S, gl!.CLAMP_TO_EDGE);
        gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_WRAP_T, gl!.CLAMP_TO_EDGE);
        return t;
      };
      stand[k] = { dep: mk(d), bg: mk(b) };
      standLoading.delete(k);
    };
    d.onload = b.onload = done;
    d.onerror = b.onerror = () => standLoading.delete(k);
    d.src = a.dataset.depth || '';
    b.src = a.dataset.bg || '';
  }
  // 網点に向く写真かどうか(色が鮮やかで、明暗の幅があるほど高い)。
  const score = new Float32Array(30);
  const tiny = document.createElement('canvas');
  tiny.width = tiny.height = 16;
  const tinyCtx = tiny.getContext('2d', { willReadFrequently: true })!;
  const vivid = (im: HTMLImageElement) => {
    tinyCtx.drawImage(im, 0, 0, 16, 16);
    const d = tinyCtx.getImageData(0, 0, 16, 16).data;
    let sat = 0;
    let m = 0;
    let m2 = 0;
    for (let i = 0; i < d.length; i += 4) {
      const mx = Math.max(d[i], d[i + 1], d[i + 2]) / 255;
      const mn = Math.min(d[i], d[i + 1], d[i + 2]) / 255;
      sat += mx - mn;
      m += mx;
      m2 += mx * mx;
    }
    const n = d.length / 4;
    return sat / n + 1.5 * Math.sqrt(Math.max(0, m2 / n - (m / n) ** 2));
  };
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
      score[k] = vivid(im);
      cellCtx.drawImage(im, 0, 0, CELL, CELL); // 升目いっぱいに引き伸ばして持つ(見せるときに、もとの比率へ戻す)
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, atlas);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, (k % ACOLS) * CELL, Math.floor(k / ACOLS) * CELL, gl.RGBA, gl.UNSIGNED_BYTE, cellCv);
      gl.useProgram(prog);
      gl.uniform1fv(u.asp, asp);
    };
    im.src = a.dataset.src || '';
  });
  gl.uniform1fv(u.asp, asp);

  // 描く先: いったん別の面に描いてから、画面へ写す(残像を残すため。ふちを なめらかにするため)。
  const drawFbo = gl.createFramebuffer();
  const drawCol = gl.createRenderbuffer();
  const drawDep = gl.createRenderbuffer();
  const keepFbo = gl.createFramebuffer();
  const keepTex = gl.createTexture();
  function targets(w: number, h: number, samples: number) {
    gl!.bindRenderbuffer(gl!.RENDERBUFFER, drawCol);
    gl!.renderbufferStorageMultisample(gl!.RENDERBUFFER, samples, gl!.RGBA8, w, h);
    gl!.bindRenderbuffer(gl!.RENDERBUFFER, drawDep);
    gl!.renderbufferStorageMultisample(gl!.RENDERBUFFER, samples, gl!.DEPTH_COMPONENT24, w, h);
    gl!.bindFramebuffer(gl!.FRAMEBUFFER, drawFbo);
    gl!.framebufferRenderbuffer(gl!.FRAMEBUFFER, gl!.COLOR_ATTACHMENT0, gl!.RENDERBUFFER, drawCol);
    gl!.framebufferRenderbuffer(gl!.FRAMEBUFFER, gl!.DEPTH_ATTACHMENT, gl!.RENDERBUFFER, drawDep);
    gl!.activeTexture(gl!.TEXTURE2);
    gl!.bindTexture(gl!.TEXTURE_2D, keepTex);
    gl!.texImage2D(gl!.TEXTURE_2D, 0, gl!.RGBA8, w, h, 0, gl!.RGBA, gl!.UNSIGNED_BYTE, null);
    for (const p of [gl!.TEXTURE_MIN_FILTER, gl!.TEXTURE_MAG_FILTER]) gl!.texParameteri(gl!.TEXTURE_2D, p, gl!.NEAREST);
    for (const p of [gl!.TEXTURE_WRAP_S, gl!.TEXTURE_WRAP_T]) gl!.texParameteri(gl!.TEXTURE_2D, p, gl!.CLAMP_TO_EDGE);
    gl!.bindFramebuffer(gl!.FRAMEBUFFER, keepFbo);
    gl!.framebufferTexture2D(gl!.FRAMEBUFFER, gl!.COLOR_ATTACHMENT0, gl!.TEXTURE_2D, keepTex, 0);
    gl!.clear(gl!.COLOR_BUFFER_BIT);
  }

  // 影の地図(光から見た近さ)。立体のときだけ描く。
  const SHADOW = 1024;
  const shTex = gl.createTexture();
  gl.activeTexture(gl.TEXTURE3);
  gl.bindTexture(gl.TEXTURE_2D, shTex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT24, SHADOW, SHADOW, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null);
  for (const p of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D, p, gl.NEAREST);
  for (const p of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T]) gl.texParameteri(gl.TEXTURE_2D, p, gl.CLAMP_TO_EDGE);
  const shFbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, shFbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, shTex, 0);
  gl.drawBuffers([gl.NONE]);
  gl.readBuffer(gl.NONE);
  gl.clearDepth(1);
  gl.clear(gl.DEPTH_BUFFER_BIT);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);

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
    // 画素が粗い画面だけ、ふちを なめらかにする(細かい画面では要らないし、重い)。
    targets(cv.width, cv.height, dpr < 1.5 ? Math.min(4, gl!.getParameter(gl!.MAX_SAMPLES) as number) : 0);
    gl!.useProgram(prog);
    gl!.uniform2f(u.view, vw, vh);
    if (!reset) return;
    W = Math.max(64, Math.min(132, Math.min(vw, vh) * 0.2));
    Lmax = Math.max(2600, Math.min(7000, 2.4 * (vw + vh)));
    dp = Lmax / M;
    // 網点の格子: 1色あたりの面の数で、画面を ちょうど埋める。
    pitch = Math.max(5, Math.sqrt((vw * vh) / (TILES / 3)));
    let cols = 0;
    let rows = 0;
    let cells = 0;
    for (;;) {
      cols = Math.ceil(vw / pitch) + 1;
      rows = Math.ceil(vh / pitch) + 1;
      cells = cols * rows;
      if (cells <= TILES / 3) break;
      pitch *= 1.01;
    }
    // 格子の升目へ、面を まんべんなく配るための歩幅(升目の数と互いに素)。
    let step = Math.max(3, Math.round(cells * 0.618));
    const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
    while (gcd(step, cells) !== 1) step++;
    gl!.uniform1f(u.dp, dp);
    gl!.uniform1f(u.w, W);
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
    lightX = vw / 2;
    lightY = vh / 2;
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
  let first = false;
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
  const shown = new Set<number>();
  let lastState = 0;
  let trail = 0; // 残像の強さ(粒子のとき 1)
  let solid = 0; // 立体の強さ(床と影を出す)
  const sstep = (a: number, b: number, v: number) => {
    const t = Math.max(0, Math.min(1, (v - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };
  function advance(len: number) {
    phase += len / (Lmax * STATE_LEN);
    onPhase();
  }
  function onPhase() {
    const A = Math.floor(phase);
    const f = phase - A;
    const a = ((A % 4) + 4) % 4;
    const x = Math.max(0, (f - HOLD) / (1 - HOLD));
    // 網点に描く作品は、粒子から網点へ変わりはじめた時に、ペン先にあった作品。
    if (a === 2 && x <= 0) {
      // 直近に描いた4作品のうち、網点に いちばん向くもの。
      // 直近に描いた4作品から、まだ立たせていない作品を選ぶ(写真の作品を優先)。
      let best = curWork;
      let bs = -1;
      for (let k = 0; k < 4; k++) {
        const w = (((workN - 1 - k) % nW) + nW) % nW;
        if (workN - 1 - k < 0) continue;
        const sc = (works[w].dataset.flat === undefined ? 2 : 0) + (shown.has(w) ? 0 : 3) + score[w] * 0.5;
        if (sc > bs) {
          bs = sc;
          best = w;
        }
      }
      focus = best;
      shown.add(best);
      if (shown.size >= nW) shown.clear();
      loadStand(best);
    }
    trail = a === 1 ? sstep(0.15, 0.75, x) : a === 2 ? 1 - sstep(0.8, 1, x) : 0;
    solid = a === 0 ? sstep(0.25, 1, x) : a === 1 ? 1 - sstep(0, 0.15, x) : 0;
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
  ind.style.display = 'none'; // 状態の名前は出さない(講評で、デモっぽいと指摘)
  root.append(ind, label, snd);

  // ---------- 入力(指一本)
  let drawing = false;
  let ptX = 0; // 指(カーソル)の位置
  let ptY = 0;
  let penX = 0; // ペン(指を、ごくわずかに遅れて追う)
  let penY = 0;
  let over = 0; // カーソルが画面の中にある
  let idle = 0.25; // ひとりでに描きはじめるまでの秒
  let auto = false;
  let autoOn = true;
  let tau = Math.random() * 20;
  let swingX = 0;
  let swingY = 0;
  let lightX = 0; // 光と視点(指を、ゆっくり追う)
  let lightY = 0;
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
    // 指のある所(なければペン、それもなければ そのまま)。
    const held = drawing || auto;
    const fx = held ? penX : ptX;
    const fy = held ? penY : ptY;
    const fon = held ? 1 : over;
    if (fon) {
      const k = 1 - Math.exp(-dt / 0.22);
      lightX += (fx - lightX) * k;
      lightY += (fy - lightY) * k;
    }

    gl!.useProgram(prog);
    gl!.activeTexture(gl!.TEXTURE0);
    gl!.bindTexture(gl!.TEXTURE_2D, pathTex);
    gl!.texSubImage2D(gl!.TEXTURE_2D, 0, 0, 0, M, 3, gl!.RGBA, gl!.FLOAT, path);
    gl!.uniform1f(u.time, now);
    gl!.uniform1f(u.phase, phase);
    gl!.uniform1f(u.k, Math.max(1, K));
    gl!.uniform1f(u.focus, focus);
    gl!.uniform1f(u.focusAsp, asp[focus]);
    {
      const A = Math.floor(phase);
      const a4 = ((A % 4) + 4) % 4;
      const fr = phase - A;
      // 作品が立っている間、視点が端から端へ回り込む。指(カーソル)の位置で少し足す。
      const sw = a4 === 3 ? -0.42 + 0.84 * sstep(0, 1, fr) : a4 === 2 ? -0.42 : 0.42;
      swingX += (sw + (ptX / Math.max(1, vw) - 0.5) * 0.3 - swingX) * (1 - Math.exp(-dt / 0.5));
      swingY += (0.1 * Math.sin(now * 0.2) + (ptY / Math.max(1, vh) - 0.5) * 0.2 - swingY) * (1 - Math.exp(-dt / 0.5));
      gl!.uniform2f(u.swing, swingX, swingY);
      const st = stand[focus];
      gl!.uniform1f(u.sFlat, works[focus].dataset.flat !== undefined ? 1 : 0);
      gl!.activeTexture(gl!.TEXTURE5);
      gl!.bindTexture(gl!.TEXTURE_2D, st ? st.dep : one);
      gl!.activeTexture(gl!.TEXTURE6);
      gl!.bindTexture(gl!.TEXTURE_2D, st ? st.bg : one);
    }
    gl!.uniform3f(u.pen, fx, fy, fon);
    gl!.uniform3f(u.light, lightX, lightY, W * 2.6);
    gl!.uniform2f(u.cam, (lightX - vw / 2) * 0.2, (lightY - vh / 2) * 0.2);

    // 0) 影の地図(立体が少しでもあるとき)
    const shadowOn = K > 0 && ((((Math.floor(phase) % 4) + 4) % 4 === 1) || solid > 0);
    gl!.bindFramebuffer(gl!.FRAMEBUFFER, shFbo);
    gl!.viewport(0, 0, SHADOW, SHADOW);
    gl!.enable(gl!.DEPTH_TEST);
    gl!.disable(gl!.BLEND);
    gl!.clear(gl!.DEPTH_BUFFER_BIT);
    if (shadowOn) {
      // 描いている地図を、同時に読めるようにしておくと、描画そのものが拒否される。描く間だけ外す。
      gl!.activeTexture(gl!.TEXTURE3);
      gl!.bindTexture(gl!.TEXTURE_2D, null);
      gl!.uniform1f(u.pass, 1);
      gl!.drawArraysInstanced(gl!.TRIANGLE_STRIP, 0, 4, TILES);
      gl!.bindTexture(gl!.TEXTURE_2D, shTex);
    }
    gl!.uniform1f(u.pass, 0);

    // 1) 前のコマを薄くして敷く(粒子のときだけ残る)
    gl!.bindFramebuffer(gl!.FRAMEBUFFER, drawFbo);
    gl!.viewport(0, 0, cv.width, cv.height);
    gl!.disable(gl!.DEPTH_TEST);
    gl!.disable(gl!.BLEND);
    const keep = trail * Math.pow(0.9, dt * 60);
    if (keep > 0.01) {
      gl!.useProgram(fade);
      gl!.uniform1f(uKeep, keep);
      gl!.depthMask(false);
      gl!.drawArrays(gl!.TRIANGLE_STRIP, 0, 4);
      gl!.depthMask(true);
      gl!.clear(gl!.DEPTH_BUFFER_BIT);
      gl!.useProgram(prog);
    } else {
      gl!.clear(gl!.COLOR_BUFFER_BIT | gl!.DEPTH_BUFFER_BIT);
      if (solid > 0.01) {
        // 床: 指の光と、帯の影
        gl!.useProgram(floor);
        gl!.uniform2f(fl.view, vw, vh);
        gl!.uniform3f(fl.light, lightX, lightY, W * 2.6);
        gl!.uniform1f(fl.solid, solid);
        gl!.depthMask(false);
        gl!.drawArrays(gl!.TRIANGLE_STRIP, 0, 4);
        gl!.depthMask(true);
        gl!.useProgram(prog);
      }
    }
    // 2) 面を描く
    if (K > 0) {
      gl!.enable(gl!.DEPTH_TEST);
      gl!.enable(gl!.BLEND);
      gl!.drawArraysInstanced(gl!.TRIANGLE_STRIP, 0, 4, TILES);
    }
    // 3) 残像用に取っておき、画面へ写す
    gl!.bindFramebuffer(gl!.READ_FRAMEBUFFER, drawFbo);
    gl!.bindFramebuffer(gl!.DRAW_FRAMEBUFFER, keepFbo);
    gl!.blitFramebuffer(0, 0, cv.width, cv.height, 0, 0, cv.width, cv.height, gl!.COLOR_BUFFER_BIT, gl!.NEAREST);
    gl!.bindFramebuffer(gl!.READ_FRAMEBUFFER, keepFbo);
    gl!.bindFramebuffer(gl!.DRAW_FRAMEBUFFER, null);
    gl!.blitFramebuffer(0, 0, cv.width, cv.height, 0, 0, cv.width, cv.height, gl!.COLOR_BUFFER_BIT, gl!.NEAREST);
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
    focus(n: number) {
      focus = n;
    },
    get state() {
      return { phase, K, focus, trail, solid };
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
