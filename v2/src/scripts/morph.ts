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
const RAMP = 64; // つなぎ方 4(描いた先から)で、前の表現から次の表現へ変わっていく継ぎ目の長さ(跡の数)
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
uniform float uFrom, uTo; // いま変わっている途中の、2つの表現の番号
uniform float uSty;       // つなぎ方: 0 ふくらんで入れ替わる / 1 古い所から順に / 2 一瞬で切り替わる / 3 指から外へ / 4 描いた先から
uniform float uSw, uNew, uOld, uRet; // 4 のとき: 切り替わった時刻、そのあと描いた跡の数、それより前の跡の数、古い帯の巻き取り(0..1)
uniform float uAsp[30];
uniform float uFocus, uFocusAsp;
uniform float uOpenW;      // 押してひらいた作品の番号(なければ -1)
uniform float uSharp;      // 入れ替えた並び(1)。つなぎ方と質感を、こちらだけ変える
uniform sampler2D uDAtlas; // 作品ごとの奥行きを1枚にまとめたもの
uniform vec3 uPen;   // 指(ペン)の位置と、あるかどうか
uniform vec3 uLight; // 光の位置(立体のとき)
uniform vec2 uCam;   // 視点の ずれ
uniform vec2 uTilt;  // 指の位置から決まる傾き(-1..1)
out vec2 vQ; out vec2 vUV; out vec2 vCell; out vec2 vShape; out vec2 vRib;
out vec4 vMix;  // x: 丸さ / y: 不透明さ(1 = ふつうに重なる, 0 = 光として足す) / z: 線を引くか / w: 表(+) か 裏(-)
out vec4 vLit;  // x: 明るさ / y: 艶 / z: 写真の色を使う割合 / w: 糸の膨らみ
out vec4 vAlt;  // rgb: 写真を使わないときの色
out vec3 vTint; // 写真に掛ける色
out vec3 vLine; // 線の色
out float vPar;  // 立体写真の強さ
out vec2 vScr;   // 画面での位置(px)
const float Mf = ${M}.0;
const int Mi = ${M};
const int NVi = ${NV};
const float HOLD = ${HOLD};
const float RAMP = ${RAMP.toFixed(1)}; // つなぎ方 4 の継ぎ目の長さ(跡の数)
const float SP = ${SPREAD};
const float SEGf = ${SEG}.0;
const vec3 PAPER = vec3(0.957, 0.945, 0.918);
const vec2 AT = vec2(${ACOLS}.0, ${AROWS}.0);
float hsh(uint n){ n = (n << 13U) ^ n; n = n * (n * n * 15731U + 789221U) + 1376312589U; return float(n & 0x7fffffffU) / 2147483647.0; }
float hs2(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
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

// ---- 1枚の面について、どの表現でも使う値(main で決める)
int gI, gIu, gIv, gJ;
float gFr, gV, gTq, gVc, gUc, gAge, gHd, h1, h2, h3;
vec2 gP, gT, gN, gPq, gTq2, gNq;
vec4 gR1, gR2;
vec3 gX0, gC0;   // 帯の四隅と中心
vec2 gUVp;       // 帯の中心での、写真の位置
vec2 gUVb;       // 帯の四隅での、写真の位置

// ---- 表現の出力
struct O {
  vec3 corner;  // 四隅のうち、この頂点
  vec3 centre;  // 面の中心
  vec3 col;     // 写真を使わないときの色
  float tex;    // 写真の色を使う割合
  vec3 tint;    // 写真に掛ける色
  vec2 shape;   // 丸や棒の大きさ(丸さ 1 のとき)
  float round;  // 丸さ
  float alpha;  // 1 = ふつうに重なる / 0 = 光として足す
  float lit;    // 明るさ
  float gloss;  // 艶
  float face;   // 表(+)か裏(-)
  float line;   // 帯のふちと作品の境目に線を引くか
  vec3 lineCol; // 線の色
  float ridge;  // 糸の膨らみ
  vec2 uv;      // 写真のどこを見せるか
  float work;   // どの作品の写真か
  float gate;   // 出てくる・消える大きさ(負なら、帯のふつうの決まりに従う)
  float par;    // 写真の奥行きで、平面の写真を立体に見せる強さ
};
O base(){
  O o;
  o.corner = gX0; o.centre = gC0; o.col = vec3(0.0); o.tex = 1.0; o.tint = vec3(1.0);
  o.shape = vec2(1.0); o.round = 0.0; o.alpha = 1.0; o.lit = 1.0; o.gloss = 0.0; o.face = 1.0;
  o.line = 0.0; o.lineCol = PAPER; o.ridge = 0.0;
  o.uv = gUVb; o.work = gR2.w; o.gate = -1.0; o.par = 0.0;
  return o;
}
// 向きのある細長い面(線・糸・札)
O ori(vec3 c, vec2 d, float L, float W, vec3 col){
  O o = base();
  vec2 e = vec2(-d.y, d.x);
  o.centre = c; o.corner = c + vec3(d * L * aQ.x + e * W * aQ.y, 0.0);
  o.col = col; o.tex = 0.0; o.shape = vec2(L, W);
  return o;
}
vec3 litBy(vec3 p, vec3 n){
  vec3 Ld = uLight - p; float dl2 = dot(Ld, Ld); vec3 L = Ld * inversesqrt(dl2);
  float R = max(uView.x, uView.y) * 0.55; float att = 1.0 / (1.0 + dl2 / (R * R));
  return vec3(max(dot(n, L), 0.0) * att, pow(max(dot(n, normalize(L + vec3(0.0, 0.0, 1.0))), 0.0), 30.0) * att, 0.0);
}
// 面の中心から、画面に正対した四角(または丸・棒)を作る。
O dotAt(vec3 c, vec2 hsz, vec3 col, float round, float alpha){
  O o = base();
  o.centre = c; o.corner = c + vec3(aQ * hsz, 0.0); o.col = col; o.tex = 0.0;
  o.shape = hsz; o.round = round; o.alpha = alpha;
  return o;
}

// 0 帯(アナログ): 平らな紙の帯。帯が窓になって、作品の写真が見える。
O sBand(){
  O o = base();
  o.line = 1.0;
  o.par = 1.0; // 帯のままでも、写真の中は立体に見える
  return o;
}
// 1 立体(アナログ): 床から浮いて、ねじれて波うつ紙。指の光を受けて、影を落とす。
O sSolid(){
  O o = base();
  float th = gUc * uTwK + uTime * 0.4;
  float cs = cos(th); float sn = sin(th);
  float zph = gUc * uZK - uTime * 0.6;
  float zc = uW * (0.6 + 0.45 * sin(zph));
  o.corner = vec3(gPq + gNq * gVc * uW * cs, zc + gVc * uW * sn);
  float thc = (float(gJ) + gFr) * uTwK + uTime * 0.4;
  o.centre = vec3(gP + gT * (gFr - 0.5) * uDp + gN * gV * uW * cos(thc), uW * (0.6 + 0.45 * sin((float(gJ) + gFr) * uZK - uTime * 0.6)) + gV * uW * sin(thc));
  vec3 nrm = normalize(vec3(-gNq * sn, cs) - vec3(gTq2, 0.0) * (cos(zph) * uW * 0.45 * uZK / uDp) * cs);
  o.face = nrm.z;
  vec3 nn = o.face < 0.0 ? -nrm : nrm;
  vec3 Ld = uLight - o.corner;
  float dl2 = dot(Ld, Ld);
  vec3 L = Ld * inversesqrt(dl2);
  float R = max(uView.x, uView.y) * 0.55;
  float att = 1.0 / (1.0 + dl2 / (R * R));
  float sh = uPass < 0.5 ? shadowAt(o.corner) : 0.0;
  float dif = max(dot(nn, L), 0.0);
  float spc = pow(max(dot(nn, normalize(L + vec3(0.0, 0.0, 1.0))), 0.0), 36.0);
  float rim = pow(1.0 - abs(nn.z), 3.0);
  o.lit = 0.09 + (1.45 * dif * att + 0.1 * rim) * (1.0 - 0.82 * sh);
  // 入れ替えた並びでは、影の側を真っ黒に落とさない(上を向いた面ほど、空の明るさを受ける)。
  if (uSharp > 0.5) o.lit = 0.17 + 0.09 * (nn.z * 0.5 + 0.5) + (1.38 * dif * att + 0.1 * rim) * (1.0 - 0.78 * sh);
  o.gloss = 0.4 * spc * att * (1.0 - sh);
  o.line = 1.0;
  return o;
}
// 2 粒子(デジタル): 描いた線に沿って流れる、撚った光の束。
O sParticle(){
  float sj = float(gJ) + gFr;
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
  float sid = floor(float(gIv) / 4.0);
  float stray = h1 < 0.1 ? 1.0 : 0.0;
  float amp = mix(mix(0.22, 1.0, fract(sid * 0.618)), 0.4 + 2.2 * h3, stray) + (h3 - 0.5) * 0.07;
  float ang = sr * mix(mix(0.17, 0.33, fract(sid * 0.37)), 0.1 + 0.4 * h2, stray) + sid * 0.5236 + h2 * 6.283 * stray + uTime * 0.45;
  vec2 pl = Pp + Np * (uW * 0.5 * amp * sin(ang));
  vec3 c = vec3(pl, uW * 0.5 * amp * cos(ang));
  vec2 dpn = uPen.xy - c.xy; float dln = length(dpn) + 1.0;
  float sw = uPen.z * exp(-dln * dln / (uW * uW * 3.0));
  c.xy += (vec2(-dpn.y, dpn.x) * 0.9 + dpn * 0.35) / dln * uW * 0.8 * sw;
  float r = mix(0.8, 1.9, h2 * h2) * (1.0 + sw);
  float aspA = uAsp[int(a2.w)];
  vec3 pc = photo(a2.w, 0.5 + (pl - a2.xy) / vec2(a2.z, a2.z / aspA));
  pc = (pc * 0.9 + 0.05) * mix(0.1, 0.24, h1) * alive;
  O o = dotAt(c, vec2(r), pc, 1.0, 0.0); o.gate = 1.0;
  return o;
}
// 3 浮き彫り(アナログとデジタルの間): 帯の表面が、写真の奥行きの分だけ盛り上がり、指の光を受ける。
O sRelief(){
  O o = base();
  vec2 cell = vec2(mod(gR2.w, AT.x), floor(gR2.w / AT.x));
  float asp = uAsp[int(gR2.w)];
  vec2 uv = clamp(0.5 + (gX0.xy - gR2.xy) / vec2(gR2.z, gR2.z / asp), vec2(0.004), vec2(0.996));
  float e = 0.012;
  float d = textureLod(uDAtlas, (cell + uv) / AT, 0.0).r;
  float dx = textureLod(uDAtlas, (cell + clamp(uv + vec2(e, 0.0), 0.004, 0.996)) / AT, 0.0).r - d;
  float dy = textureLod(uDAtlas, (cell + clamp(uv + vec2(0.0, e), 0.004, 0.996)) / AT, 0.0).r - d;
  float H = uW * 0.9;
  float lift = uW * 0.12 + d * H;
  o.corner.z = lift; o.centre.z = uW * 0.12 + textureLod(uDAtlas, (cell + clamp(gUVp, 0.004, 0.996)) / AT, 0.0).r * H;
  vec3 n = normalize(vec3(-dx * H / (e * gR2.z), -dy * H / (e * gR2.z / asp), 1.0));
  vec3 Ld = uLight - o.corner;
  float dl2 = dot(Ld, Ld);
  vec3 L = Ld * inversesqrt(dl2);
  float R = max(uView.x, uView.y) * 0.55;
  float att = 1.0 / (1.0 + dl2 / (R * R));
  o.lit = 0.18 + 1.35 * max(dot(n, L), 0.0) * att;
  o.gloss = 0.25 * pow(max(dot(n, normalize(L + vec3(0.0, 0.0, 1.0))), 0.0), 30.0) * att;
  o.line = 1.0;
  return o;
}
// 4 リソグラフ(アナログ): 紙の帯に、蛍光ピンクと青の2色の網点が、少しずれて刷られる。
O sRiso(){
  float cell = uW / float(NVi) * 3.2;
  int k = (gIu % 3) * 3 + (gIv % 3);
  if (k != 1 && k != 5) {
    O o = base();
    o.tex = 0.0; o.col = vec3(0.95, 0.925, 0.87) * (0.97 + 0.05 * h1); o.corner.z -= 1.0; o.centre.z -= 1.0;
    return o;
  }
  vec3 pc = photo(gR2.w, gUVp);
  bool pink = k == 1;
  float amt = pink ? 1.0 - pc.g * 0.9 : 1.0 - pc.r * 0.85;
  vec2 mis = pink ? vec2(2.2, 1.2) : vec2(-1.6, -2.0);
  vec3 ink = pink ? vec3(1.0, 0.28, 0.6) : vec3(0.0, 0.45, 0.78);
  vec3 c = gC0 + vec3(mis, pink ? 0.6 : 0.4);
  return dotAt(c, vec2(cell * 0.62 * sqrt(clamp(amt, 0.0, 1.0)) + 0.2), ink * (0.94 + 0.06 * h2), 1.0, 1.0);
}
// 5 フィルム(アナログ): 帯が35mmフィルムになる。ふちに送り穴、作品ごとにコマの境目。少し揺れる。
O sFilm(){
  O o = base();
  vec2 weave = gN * sin(uTime * 13.0 + floor(uTime * 6.0)) * 0.8;
  o.corner.xy += weave; o.centre.xy += weave;
  float av = abs(gVc);
  if (av > 0.34) {
    float m = mod(gUc, 4.0);
    bool hole = av > 0.38 && av < 0.47 && m > 1.1 && m < 2.9;
    o.tex = 0.0;
    o.col = hole ? vec3(0.0) : vec3(0.23, 0.11, 0.04) * (0.9 + 0.2 * h1);
  } else {
    o.tint = vec3(1.08, 0.97, 0.82);
    o.lit = 0.92;
  }
  o.line = 1.0; o.lineCol = vec3(0.05, 0.03, 0.02);
  return o;
}
// 6 刺繍(アナログ): 帯が、斜めに渡した糸の目になる。糸は写真の色。
O sStitch(){
  if ((gIu % 2) == 1 || (gIv % 2) == 1) return dotAt(gC0, vec2(0.0), vec3(0.0), 0.0, 1.0);
  float side = (gIv / 2) % 2 == 0 ? 1.0 : -1.0;
  float a = 0.62 * side;
  vec2 d = gT * cos(a) + gN * sin(a);
  vec2 e = vec2(-d.y, d.x);
  float L = uDp * 1.15; float Wd = uW / float(NVi) * 1.25;
  vec3 pc = photo(gR2.w, gUVp);
  pc = mix(pc, vec3(dot(pc, vec3(0.3, 0.59, 0.11))), 0.15) * (0.85 + 0.25 * h1);
  O o = dotAt(gC0 + vec3(0.0, 0.0, 1.0 + h2), vec2(L, Wd), pc, 1.0, 1.0);
  o.corner = o.centre + vec3(d * L * aQ.x + e * Wd * aQ.y, 0.0);
  o.ridge = 1.0;
  return o;
}
// 7 ピクセル(デジタル): 帯が、粗い升目に揃い、色の段数が減る。
O sPixel(){
  float g = uW / 4.5;
  vec2 cc = (floor(gC0.xy / g) + 0.5) * g;
  vec3 pc = photo(gR2.w, gUVp);
  pc = floor(pc * 4.0 + 0.5) / 4.0;
  float lift = hs2(floor(gC0.xy / g) + floor(uTime * 2.0)) > 0.93 ? g * 0.35 : 0.0;
  return dotAt(vec3(cc + vec2(0.0, -lift), lift * 0.5), vec2(g * 0.46), pc, 0.0, 1.0);
}
// 8 点群(デジタル): 立体の帯の形が、点の群れとして測られる。走査の光が通る。
O sScan(){
  float thc = (float(gJ) + gFr) * uTwK + uTime * 0.4;
  vec3 c = vec3(gP + gT * (gFr - 0.5) * uDp + gN * gV * uW * cos(thc), uW * (0.6 + 0.45 * sin((float(gJ) + gFr) * uZK - uTime * 0.6)) + gV * uW * sin(thc));
  float sweep = mod(uTime * 0.45, 1.6) - 0.3;
  float pos = dot(c.xy / uView, normalize(vec2(1.0, 0.35)));
  float band = exp(-pow((pos - sweep) * 18.0, 2.0));
  vec3 pc = photo(gR2.w, gUVp);
  float l = dot(pc, vec3(0.3, 0.59, 0.11));
  // 色は付け替えない(以前は青緑)。写真の色のまま、点の列になる。走査の光が通る所だけ白く光る。
  vec3 col = mix(pc * 1.05 + 0.02, vec3(1.0), band * 0.85);
  bool on = (gIu % 2) == 0;
  return dotAt(c, vec2(on ? 0.8 + band * 0.8 : 0.0), col, 1.0, 1.0);
}
// 9 グリッチ(デジタル): 帯の塊が、ずれる・色が割れる・止まる。
O sGlitch(){
  O o = base();
  float tq8 = floor(uTime * 9.0);
  vec2 blk = vec2(floor(gUc / 7.0), floor((gVc + 0.5) * 5.0));
  float r = hs2(blk + tq8 * 0.37);
  if (r > 0.72) {
    vec2 sh = gT * (r - 0.72) * uW * 4.0 * (hs2(blk + 3.1) > 0.5 ? 1.0 : -1.0);
    o.corner.xy += sh; o.centre.xy += sh;
  }
  float r2 = hs2(blk * 1.7 + tq8 * 0.11);
  if (r2 > 0.86) o.tint = r2 > 0.93 ? vec3(1.6, 0.15, 0.25) : vec3(0.1, 1.2, 1.4);
  if (r2 < 0.05) { o.tex = 0.0; o.col = vec3(hs2(blk) > 0.5 ? 0.95 : 0.0); }
  return o;
}

// ---- ここから、実例を帯に落とし込んだ表現(第1弾)
// 写真を1枚ずつの札にして、軌跡に並べる。upright: 正立して重なる / それ以外: 軌跡の向きに沿う。
O card(float K, float S, float upright, float zw){
  float k = floor(float(gIu) / K);
  int jc = int(k * K * 0.5) % Mi;
  vec4 c0 = texelFetch(uPath, ivec2(jc, 0), 0);
  vec4 c1 = texelFetch(uPath, ivec2(jc, 1), 0);
  vec4 c2 = texelFetch(uPath, ivec2(jc, 2), 0);
  if (c1.w < 0.5) { c0.xy = uPen.xy; c0.zw = vec2(1.0, 0.0); }
  float hk = fract(sin(k * 12.9898 + 4.1) * 43758.5453);
  float ra = (hk - 0.5) * 0.5;
  vec2 d = mix(normalize(c0.zw + vec2(1e-5, 0.0)), vec2(cos(ra), sin(ra)), upright);
  d = normalize(d);
  vec2 e = vec2(-d.y, d.x);
  float asp = uAsp[int(c2.w)];
  vec2 sz = asp > 1.0 ? vec2(S, S / asp) : vec2(S * asp, S);
  float u = (float(gIu) - k * K + 0.5 + aQ.x * 0.5) / K;
  float v = gVc + 0.5;
  float uc = (float(gIu) - k * K + 0.5) / K;
  float vc = gV + 0.5;
  float ageC = mod(uK - 1.0 - float(jc), Mf);
  float z = zw * sin(k * 0.7 - uTime * 2.2) + 2.0 * (1.0 - ageC / Mf);
  O o = base();
  o.corner = vec3(c0.xy + d * (u - 0.5) * sz.x + e * (v - 0.5) * sz.y, z);
  o.centre = vec3(c0.xy + d * (uc - 0.5) * sz.x + e * (vc - 0.5) * sz.y, z);
  o.uv = vec2(u, v); o.work = c2.w;
  o.gate = c1.w * smoothstep(0.0, 0.25, uTime - c1.z) * smoothstep(Mf, Mf - 30.0, ageC);
  return o;
}
// 10 札の蛇: 写真が1枚ずつの札になって、軌跡の向きに並び、波うつ。
O sSnake(){ return card(40.0, 20.0 * uDp * 0.82, 0.0, uW * 0.35); }
// 11 置いていく写真: 通った所に、写真が少し傾いて重なりながら置かれていく。
O sStamp(){ return card(28.0, 14.0 * uDp * 2.1, 1.0, 0.0); }
// 12 画素の落下: 古い所から、写真が大きな画素の箱に割れて、回りながら落ちる。
O sVoxel(){
  // 画素の雨: 写真が升目に揃った四角い画素になり、列ごとに順に、まっすぐ落ちて、下に積み上がる。回らない、デジタルの落ち方。
  if ((gIu % 3) != 0 || (gIv % 6) != 0) return dotAt(gC0, vec2(0.0), vec3(0.0), 0.0, 1.0);
  float g = uW / float(NVi) * 6.0;
  vec2 cell = floor(gC0.xy / g);
  vec2 snap = (cell + 0.5) * g;
  float delay = fract(cell.x * 0.137) * 0.35;
  float t = clamp((gHd - 0.18 - delay) / 0.4, 0.0, 1.0);
  float stackH = floor(fract(sin(cell.x * 12.7) * 4375.5) * 7.0 + 1.0) - floor(h1 * 3.0);
  float land = uView.y - g * (0.5 + max(stackH, 0.0));
  float y = mix(snap.y, max(snap.y, land), t * t);
  vec3 pc = photo(gR2.w, gUVp);
  pc = floor(pc * 6.0 + 0.5) / 6.0;
  return dotAt(vec3(snap.x, y, 0.0), vec2(g * 0.47), pc, 0.0, 1.0);
}
// 13 塵になる: 先は帯のまま。古い所から、細かな塵になって、舞い上がって消える。
O sDust(){
  float t = clamp((gHd - 0.25) / 0.6, 0.0, 1.0);
  if (t <= 0.0) { O o = base(); o.line = 1.0; return o; }
  vec2 sw = vec2(sin(gC0.y * 0.02 + uTime * 1.3 + h1 * 6.0), cos(gC0.x * 0.02 + uTime * 1.1 + h2 * 6.0));
  vec3 c = gC0 + vec3(sw * uW * 1.2 * t + vec2((h2 - 0.2) * uW * 2.5, -uW * 5.0 * (0.4 + h3)) * t * t, uW * t * h1 * 2.0);
  vec3 pc = photo(gR2.w, gUVp);
  pc = mix(pc, vec3(1.0, 0.62, 0.3) * 1.4, smoothstep(0.0, 0.25, t) * (1.0 - smoothstep(0.25, 0.6, t)) * 0.7);
  float r = mix(uW / float(NVi) * 0.9, 0.6, t) * (0.6 + 0.8 * h2);
  return dotAt(c, vec2(r), pc * (1.0 - t * 0.6), 1.0, 1.0);
}
// 14 蛇腹: 帯が、等間隔に山と谷に折られる。指の光で、山の面と谷の面の明るさが違う。
O sFold(){
  O o = base();
  float P = 7.0;
  float ph = fract(gUc / P);
  float tri = 1.0 - abs(ph * 2.0 - 1.0);
  float A = uW * 0.55 * (0.6 + 0.4 * sin(uTime * 0.8 + gUc * 0.02));
  o.corner.z = tri * A;
  float phc = fract((float(gJ) + gFr) / P);
  o.centre.z = (1.0 - abs(phc * 2.0 - 1.0)) * A;
  float sl = (ph < 0.5 ? 1.0 : -1.0) * 2.0 * A / (P * uDp);
  vec3 n = normalize(vec3(-gTq2 * sl, 1.0));
  vec3 l = litBy(o.corner, n);
  o.lit = 0.15 + 1.4 * l.x; o.gloss = 0.3 * l.y;
  o.line = 1.0;
  return o;
}
// 15 棒の街: 写真の明るさが、そのまま縦の棒の高さになる。
O sBars(){
  if ((gIu % 2) != 0 || (gIv % 4) != 0) return dotAt(gC0, vec2(0.0), vec3(0.0), 0.0, 1.0);
  vec3 pc = photo(gR2.w, gUVp);
  float l = dot(pc, vec3(0.3, 0.59, 0.11));
  float len = uW * (0.1 + 0.85 * l * l) * (0.85 + 0.3 * sin(uTime * 3.0 + gUc * 0.3));
  vec3 c = gC0 + vec3(0.0, -len, 0.0);
  O o = ori(c, vec2(0.0, 1.0), len, uDp * 0.42, pc * 1.1);
  return o;
}
// 16 糸に分かれる: 帯が、細い糸の束にほどけ、1本ずつ別々に揺れる。
O sThreads(){
  // 房になってほどける: 帯の縦糸がほどけ、帯から下へ垂れ下がる房になって、揺れる。
  if ((gIu % 4) != 0) return dotAt(gC0, vec2(0.0), vec3(0.0), 0.0, 1.0);
  float len = uW * (0.6 + 3.2 * smoothstep(0.05, 0.7, gHd)) * (0.7 + 0.6 * h2);
  float s = clamp(gV + 0.5, 0.0, 1.0);
  vec2 top = gP + gN * (-0.5) * uW;
  float sway = sin(uTime * 1.7 + float(gIu) * 0.05) * uW * 0.5 * s * s;
  vec2 c = top + vec2(sway, len * s);
  vec3 pc = photo(gR2.w, gUVp);
  O o = ori(vec3(c, 0.0), vec2(0.0, 1.0), len / float(NVi) * 0.6, uDp * 0.7, pc * 1.05);
  return o;
}
// 17 奥行きの点: 写真の奥行きの分だけ、点が浮いた立体の点群になる。視点が少し回る。
O sDepth(){
  if ((gIu % 2) != 0 || (gIv % 2) != 0) return dotAt(gC0, vec2(0.0), vec3(0.0), 0.0, 1.0);
  vec2 cell = vec2(mod(gR2.w, AT.x), floor(gR2.w / AT.x));
  float dd = textureLod(uDAtlas, (cell + clamp(gUVp, 0.004, 0.996)) / AT, 0.0).r;
  float ang = sin(uTime * 0.5) * 0.5;
  float z = dd * uW * 2.4;
  vec3 c = gC0 + vec3(sin(ang) * z * 0.9, -z * 0.35, z);
  vec3 pc = photo(gR2.w, gUVp);
  return dotAt(c, vec2(uW / float(NVi) * 1.5 * (0.7 + dd)), pc * (0.95 + 0.4 * dd), 1.0, 1.0);
}
// 18 透けて見える: ふだんは線だけの帯。指の近くと先だけ、写真が見える。
O sReveal(){
  O o = base();
  float dpen = distance(gX0.xy, uPen.xy);
  float rv = max(uPen.z * (1.0 - smoothstep(uW * 1.6, uW * 3.2, dpen)), 1.0 - smoothstep(0.04, 0.12, gHd));
  vec3 pc = photo(gR2.w, gUVb);
  float l = dot(pc, vec3(0.3, 0.59, 0.11));
  float ln = step(0.82, fract(gUc * 0.5)) + step(0.86, fract((gVc + 0.5) * 8.0));
  o.tex = rv;
  o.col = mix(vec3(0.02), vec3(0.5, 0.9, 1.0) * (0.25 + l), clamp(ln, 0.0, 1.0));
  o.line = 1.0; o.lineCol = vec3(0.5, 0.9, 1.0);
  o.corner.z += rv * uW * 0.25; o.centre.z += rv * uW * 0.25;
  return o;
}
// 19 垂れる: 帯が、列ごとに違う長さで、下へ垂れていく。
O sDrip(){
  // 溶けて垂れる: 列ごとに違う長さで、床まで垂れる。先ほど細く、写真は縦に引き伸ばされる。
  O o = base();
  float col = floor(gUc / 3.0);
  float hc = fract(sin(col * 91.7 + 3.3) * 43758.5453);
  float tip = uView.y - gX0.y;
  float amt = pow(hc, 1.6) * smoothstep(0.0, 0.45, gHd) * max(tip, 0.0) * 0.95 * (0.8 + 0.2 * sin(uTime * 1.3 + col));
  float s = clamp(gVc + 0.5, 0.0, 1.0), sc = clamp(gV + 0.5, 0.0, 1.0);
  float pull = s * s, pullc = sc * sc;
  float colX = (floor(gUc / 3.0) + 0.5) * 3.0;
  float thin = 1.0 - 0.75 * pull * min(amt / uW, 1.0);
  vec2 axisP = gPq + gTq2 * 0.0;
  o.corner.xy = vec2(mix(gX0.x, gX0.x, 1.0), gX0.y + amt * pull);
  o.corner.xy += gTq2 * (gUc - colX) * uDp * 0.5 * (thin - 1.0);
  o.centre.y += amt * pullc;
  o.uv = vec2(gUVb.x, gUVb.y - (gUVb.y - 0.5) * 0.7 * pull * min(amt / uW, 1.0));
  o.gloss = 0.35 * pull * min(amt / uW, 1.0);
  o.lit = 1.0 - 0.25 * pull * min(amt / uW, 1.0);
  o.line = 0.0;
  return o;
}
// 20 流れに乗る: 古い所ほど、見えない流れに運ばれて、渦を巻く。
O sFlow(){
  O o = base();
  vec2 p = gX0.xy; vec2 pc = gC0.xy;
  float amt = pow(gHd, 1.3) * uW * 1.1;
  for (int i = 0; i < 4; i++) {
    float a = sin(p.x * 0.006 + uTime * 0.2) * 2.0 + cos(p.y * 0.007 - uTime * 0.15) * 2.0;
    p += vec2(cos(a), sin(a)) * amt;
    float b = sin(pc.x * 0.006 + uTime * 0.2) * 2.0 + cos(pc.y * 0.007 - uTime * 0.15) * 2.0;
    pc += vec2(cos(b), sin(b)) * amt;
  }
  o.corner.xy = p; o.centre.xy = pc;
  return o;
}
// 21 筒: 帯が、軌跡を芯にした筒に巻かれ、ゆっくり回る。
O sTube(){
  O o = base();
  float R = uW * 0.42;
  float a = gVc * 6.2832 * 0.98 + uTime * 0.7 + gUc * 0.01;
  float ac = gV * 6.2832 * 0.98 + uTime * 0.7 + (float(gJ) + gFr) * 0.01;
  o.corner = vec3(gPq + gNq * cos(a) * R, R * 1.4 + sin(a) * R);
  o.centre = vec3(gP + gT * (gFr - 0.5) * uDp + gN * cos(ac) * R, R * 1.4 + sin(ac) * R);
  vec3 n = vec3(gNq * cos(a), sin(a));
  o.face = n.z;
  vec3 l = litBy(o.corner, o.face < 0.0 ? -n : n);
  o.lit = 0.12 + 1.5 * l.x; o.gloss = 0.35 * l.y;
  o.uv = vec2(gUVb.x, fract((a - uTime * 0.7) / 6.2832 + 0.5));
  return o;
}
// 22 割れる: 帯が大きな破片に割れ、指から遠ざかるように、回りながら飛び散る。古い所ほど遠くへ。
O sShatter(){
  O o = base();
  float bu = floor(float(gIu) / 10.0), bv = floor(float(gIv) / 16.0);
  float hb = fract(sin(bu * 37.1 + bv * 91.7) * 43758.5453), hb2 = fract(hb * 13.7 + 0.3);
  int jb = int(bu * 5.0 + 2.0) % Mi;
  vec4 b0 = texelFetch(uPath, ivec2(jb, 0), 0);
  vec2 bn = vec2(-b0.w, b0.z);
  vec3 bc = vec3(b0.xy + bn * ((bv * 16.0 + 8.0) / float(NVi) - 0.5) * uW, 0.0);
  vec2 away = normalize(bc.xy - uPen.xy + vec2(0.001));
  float t = smoothstep(0.2, 0.9, gHd) + uPen.z * (1.0 - smoothstep(0.0, uW * 3.0, distance(bc.xy, uPen.xy))) * 0.6;
  float ang = t * (hb - 0.5) * 5.0, tilt = t * (hb2 - 0.5) * 3.0;
  mat3 R = mat3(cos(ang), sin(ang), 0.0, -sin(ang), cos(ang), 0.0, 0.0, 0.0, 1.0) * mat3(1.0, 0.0, 0.0, 0.0, cos(tilt), sin(tilt), 0.0, -sin(tilt), cos(tilt));
  vec3 off = vec3(away * t * uW * (1.5 + 3.0 * hb), t * uW * 2.0 * hb2);
  o.corner = bc + R * (gX0 - bc) + off;
  o.centre = bc + R * (gC0 - bc) + off;
  vec3 n = R * vec3(0.0, 0.0, 1.0);
  o.face = n.z;
  vec3 l = litBy(o.corner, n.z < 0.0 ? -n : n);
  o.lit = mix(1.0, 0.25 + 1.3 * l.x, smoothstep(0.0, 0.2, t)); o.gloss = 0.3 * l.y * t;
  o.line = 1.0;
  return o;
}
// 23 ばね: 帯が細くなり、軌跡を芯にした ばねに巻かれる。
O sCoil(){
  O o = base();
  float R = uW * 0.55;
  float a = gUc * 0.45 - uTime * 2.0;
  float ac = (float(gJ) + gFr) * 0.45 - uTime * 2.0;
  float wd = uW * 0.22;
  o.corner = vec3(gPq + gNq * cos(a) * R + gTq2 * gVc * wd, R * 1.2 + sin(a) * R);
  o.centre = vec3(gP + gT * (gFr - 0.5) * uDp + gN * cos(ac) * R + gT * gV * wd, R * 1.2 + sin(ac) * R);
  vec3 n = vec3(gNq * cos(a), sin(a));
  o.face = 1.0;
  vec3 l = litBy(o.corner, n);
  o.lit = 0.15 + 1.45 * l.x; o.gloss = 0.4 * l.y;
  return o;
}
// 24 積もる: 古い所から下へ落ち、横の位置はそのままに、地層のように積み重なる。
O sPile(){
  O o = base();
  float t = smoothstep(0.08, 0.35, gHd);
  float floorY = uView.y * 0.94;
  float layer = (1.0 - gHd) * uView.y * 0.42;
  float y = floorY - layer + gVc * uW * 0.22 + sin(gX0.x * 0.01 + gHd * 30.0) * uW * 0.15;
  float yc = floorY - layer + gV * uW * 0.22 + sin(gC0.x * 0.01 + gHd * 30.0) * uW * 0.15;
  o.corner.y = mix(gX0.y, y, t); o.centre.y = mix(gC0.y, yc, t);
  o.line = 1.0;
  return o;
}
// 25 波紋: 帯の面に、指を中心にした波紋が広がる。光で、波の山と谷が見える。
O sRipple(){
  // 液体の面: 指(なければ描いている先)を中心に、帯の面いっぱいに波紋が走る。強い照り返しで、水銀のように見せる。
  O o = base();
  vec2 head = texelFetch(uPath, ivec2(int(mod(uK - 1.0, Mf)), 0), 0).xy;
  vec2 c = mix(head, uPen.xy, uPen.z);
  float d = distance(gX0.xy, c) + 1.0;
  float k = 0.032, sp = 4.2;
  float A = uW * 0.85 * exp(-d / (uW * 9.0));
  float ph = d * k - uTime * sp;
  o.corner.z = sin(ph) * A + A;
  float dc = distance(gC0.xy, c) + 1.0;
  o.centre.z = sin(dc * k - uTime * sp) * uW * 0.85 * exp(-dc / (uW * 9.0)) + A;
  vec2 g = (gX0.xy - c) / d * cos(ph) * A * k;
  vec3 n = normalize(vec3(-g, 1.0));
  vec3 l = litBy(o.corner, n);
  o.tint = vec3(0.62, 0.66, 0.72);
  o.lit = 0.08 + 1.7 * l.x; o.gloss = 1.3 * l.y + 0.25 * pow(1.0 - n.z, 2.0);
  o.par = 0.0;
  return o;
}
// 26 立体写真: 帯のまま、写真の中の奥行きで、平面の写真が立体に見える。指の位置で、のぞき込む向きが変わる。
O sPhoto3D(){
  O o = base();
  o.par = 1.0;
  o.line = 1.0;
  return o;
}
// 27 一枚を大きく: 帯がほどけて、いま描いている作品が画面いっぱいの立体写真になる。指で傾く。
O sBig(){
  O o = base();
  // 押してひらいた作品。なければ、いちばん新しく描いた所の作品
  float wk = uOpenW > -0.5 ? uOpenW : texelFetch(uPath, ivec2(int(mod(uK - 1.0, Mf)), 2), 0).w;
  float asp = max(uAsp[int(wk)], 0.2);
  vec2 box = uView * vec2(0.86, 0.72);
  vec2 sz = box.x / asp <= box.y ? vec2(box.x, box.x / asp) : vec2(box.y * asp, box.y);
  float u = (float(gIu) + 0.5 + aQ.x * 0.5) / float(${NU});
  float uc = (float(gIu) + 0.5) / float(${NU});
  float v = gVc + 0.5, vc = gV + 0.5;
  float rx = uTilt.y * 0.42, ry = -uTilt.x * 0.55;
  mat3 R = mat3(cos(ry), 0.0, -sin(ry), 0.0, 1.0, 0.0, sin(ry), 0.0, cos(ry)) * mat3(1.0, 0.0, 0.0, 0.0, cos(rx), sin(rx), 0.0, -sin(rx), cos(rx));
  vec3 C = vec3(uView * 0.5, uW * 0.6);
  o.corner = C + R * vec3((u - 0.5) * sz.x, (v - 0.5) * sz.y, 0.0);
  o.centre = C + R * vec3((uc - 0.5) * sz.x, (vc - 0.5) * sz.y, 0.0);
  o.uv = vec2(u, v); o.work = wk; o.gate = 1.0; o.par = 1.4;
  vec3 n = R * vec3(0.0, 0.0, 1.0);
  vec3 l = litBy(o.corner, n);
  o.lit = 0.75 + 0.45 * l.x; o.gloss = 0.12 * l.y;
  return o;
}
// 28 額縁(プロフィールを開いたとき): 帯が画面のふちに回り込んで、細い額になる。中に文字が入る。
O sFrame(){
  O o = base();
  float m = 14.0, top = 64.0;
  vec2 a = vec2(m, top), b = uView - vec2(m, m);
  vec2 sz = b - a;
  float per = 2.0 * (sz.x + sz.y);
  float bw = min(uW * 0.38, 34.0);
  float s = mod((float(gIu) + 0.5 + aQ.x * 0.5) / float(${NU}) * per + uTime * 18.0, per);
  float sc = mod((float(gIu) + 0.5) / float(${NU}) * per + uTime * 18.0, per);
  vec2 P, T, Pc;
  if (s < sz.x) { P = a + vec2(s, 0.0); T = vec2(1.0, 0.0); }
  else if (s < sz.x + sz.y) { P = vec2(b.x, a.y + s - sz.x); T = vec2(0.0, 1.0); }
  else if (s < 2.0 * sz.x + sz.y) { P = vec2(b.x - (s - sz.x - sz.y), b.y); T = vec2(-1.0, 0.0); }
  else { P = vec2(a.x, b.y - (s - 2.0 * sz.x - sz.y)); T = vec2(0.0, -1.0); }
  if (sc < sz.x) Pc = a + vec2(sc, 0.0);
  else if (sc < sz.x + sz.y) Pc = vec2(b.x, a.y + sc - sz.x);
  else if (sc < 2.0 * sz.x + sz.y) Pc = vec2(b.x - (sc - sz.x - sz.y), b.y);
  else Pc = vec2(a.x, b.y - (sc - 2.0 * sz.x - sz.y));
  vec2 N = vec2(-T.y, T.x);
  o.corner = vec3(P + N * gVc * bw, 0.0);
  o.centre = vec3(Pc + N * gV * bw, 0.0);
  float seg = per / 14.0;
  float wkf = floor(s / seg);
  o.work = mod(wkf * 7.0, 27.0);
  o.uv = vec2(fract(s / seg), gVc + 0.5);
  o.gate = 1.0; o.line = 1.0; o.par = 0.6;
  return o;
}
// 29 粒(デジタル。2 光の粒 の入れ替え): 帯が、細かい四角い粒になる。光として足さない(白く飛ばさない)。
//   速く引いた所は細い筋、ゆっくり引いた所は帯の幅(写真が粒で読める)。描いた直後は、まわりから粒が飛び込む。
//   古い所ほど、見えない流れに運ばれて ほどけ、霧になる。色は、最後まで写真の色。
O sGrain(){
  if (((gIu + gIv) % 2) != 0) return dotAt(gC0, vec2(0.0), vec3(0.0), 0.0, 1.0); // 市松に間引く(規則正しい網点になる)
  int jn2 = gJ + 1 == Mi ? 0 : gJ + 1;
  int jp2 = gJ == 0 ? Mi - 1 : gJ - 1;
  vec4 n1 = texelFetch(uPath, ivec2(jn2, 1), 0);
  vec4 p1 = texelFetch(uPath, ivec2(jp2, 1), 0);
  // 跡は等しい間隔で記録されるので、となりの跡との時間の差が、そこを引いた速さになる。
  float dtj = (n1.w > 0.5 && n1.z > gR1.z) ? n1.z - gR1.z : ((p1.w > 0.5 && gR1.z > p1.z) ? gR1.z - p1.z : 0.05);
  float speed = uDp / max(dtj, 0.004);
  float wide = 1.0 - smoothstep(260.0, 1100.0, speed);
  float tAge = uTime - gR1.z;
  float lat = gV * mix(0.07, 1.0, wide);
  // 帯の幅のときは、網点の並びを崩さない。細い筋のときだけ、少し散らす。
  vec2 p = gP + gT * (gFr - 0.5 + (h2 - 0.5) * 0.6 * (1.0 - wide)) * uDp + gN * (lat + (h3 - 0.5) * 0.02 * (1.0 - wide)) * uW;
  float inn = 1.0 - smoothstep(0.0, 0.32, tAge);
  float a0 = h2 * 6.2832;
  p += vec2(cos(a0), sin(a0)) * uW * (0.6 + 1.8 * h3) * inn * inn;
  float loose = smoothstep(0.10, 0.75, gHd);
  float amt = loose * loose * uW * (0.25 + 0.9 * h3);
  for (int i = 0; i < 5; i++) {
    float a = sin(p.x * 0.0058 + uTime * 0.17) * 2.1 + cos(p.y * 0.0066 - uTime * 0.13) * 2.1;
    p += vec2(cos(a), sin(a)) * amt;
  }
  vec3 pc = photo(gR2.w, gUVp);
  // 写真の色は落とさない。細い筋でも、ほどけて霧になっても、その場所の写真の色のまま。
  vec3 col = (pc * mix(1.22, 1.08, wide) + 0.03) * mix(1.0, 0.82, loose);
  float r = mix(mix(0.85, uW / float(NVi) * 0.72, wide), 0.7, loose);
  float alive = gR1.w * smoothstep(Mf, Mf - 22.0, gAge);
  O o = dotAt(vec3(p, 0.0), vec2(r * alive), col, 0.0, 1.0);
  o.gate = 1.0;
  return o;
}
// 30 割れる(22 の作り直し): 帯が、幅いっぱいの大きな破片に割れて、その場で ずれる。
//   飛び散らない・回りながら落ちない。切り口は帯の切れ目と同じく、まっすぐ。ペン先の近くは、まだ割れていない。少し古くなった所で、一気に割れる。
O sShards(){
  O o = base();
  float Ls = 26.0;
  float bu = floor((float(gIu) + 7.0 * sin(float(gIu) * 0.045)) / Ls); // 切り口は まっすぐ(帯の切れ目と同じ)。長さは不ぞろい
  float hb = fract(sin(bu * 37.1 + 1.7) * 43758.5453), hb2 = fract(hb * 13.7 + 0.3), hb3 = fract(hb * 7.3 + 0.61);
  int jb = int(mod((bu + 0.5) * Ls * 0.5, Mf));
  vec4 b0 = texelFetch(uPath, ivec2(jb, 0), 0);
  vec3 bc = vec3(b0.xy, 0.0);
  vec2 bn = vec2(-b0.w, b0.z);
  float ageB = mod(uK - 1.0 - float(jb), Mf) / Mf;
  float t = smoothstep(0.030 + 0.02 * hb3, 0.036 + 0.02 * hb3, ageB);
  float ang = t * (hb3 - 0.5) * 0.8;
  mat2 R = mat2(cos(ang), sin(ang), -sin(ang), cos(ang));
  vec2 off = (bn * (hb - 0.5) * 0.95 + b0.zw * (hb2 - 0.5) * 0.5) * uW * t;
  o.corner = vec3(bc.xy + R * (gX0.xy - bc.xy) + off, 0.0);
  o.centre = vec3(bc.xy + R * (gC0.xy - bc.xy) + off, 0.0);
  o.line = 1.0;
  return o;
}
O stateOf(int id){
  if (id == 0) return sBand();
  if (id == 1) return sSolid();
  if (id == 2) return sParticle();
  if (id == 3) return sRelief();
  if (id == 4) return sRiso();
  if (id == 5) return sFilm();
  if (id == 6) return sStitch();
  if (id == 7) return sPixel();
  if (id == 8) return sScan();
  if (id == 9) return sGlitch();
  if (id == 10) return sSnake();
  if (id == 11) return sStamp();
  if (id == 12) return sVoxel();
  if (id == 13) return sDust();
  if (id == 14) return sFold();
  if (id == 15) return sBars();
  if (id == 16) return sThreads();
  if (id == 17) return sDepth();
  if (id == 18) return sReveal();
  if (id == 19) return sDrip();
  if (id == 20) return sFlow();
  if (id == 21) return sTube();
  if (id == 22) return sShatter();
  if (id == 23) return sCoil();
  if (id == 24) return sPile();
  if (id == 25) return sRipple();
  if (id == 26) return sPhoto3D();
  if (id == 27) return sBig();
  if (id == 29) return sGrain();
  if (id == 30) return sShards();
  return sFrame();
}

void main(){
  gI = gl_InstanceID;
  gIu = gI / NVi; gIv = gI - gIu * NVi;
  gJ = gIu / 2; gFr = float(gIu - gJ * 2) * 0.5 + 0.25;
  gV = (float(gIv) + 0.5) / float(NVi) - 0.5;
  vec4 r0 = texelFetch(uPath, ivec2(gJ, 0), 0);
  gR1 = texelFetch(uPath, ivec2(gJ, 1), 0);
  gR2 = texelFetch(uPath, ivec2(gJ, 2), 0);
  gAge = mod(uK - 1.0 - float(gJ), Mf);
  gHd = gAge / Mf;
  h1 = hsh(uint(gI)); h2 = hsh(uint(gI) + 7919U); h3 = hsh(uint(gI) * 3U + 17U);
  gP = r0.xy; gT = r0.zw;
  // まだ描かれていない面は、ペン先に しまってある。
  if (gR1.w < 0.5) { gP = uPen.xy; gT = vec2(1.0, 0.0); }
  gN = vec2(-gT.y, gT.x);

  // この1枚が、いま どの表現と どの表現の間にいるか。
  float f = fract(uPhase);
  float x = clamp((f - HOLD) / (1.0 - HOLD), 0.0, 1.0);
  int sty = int(uSty + 0.5);
  float w;
  float keep = 1.0;
  if (sty == 1) w = smoothstep(gHd * 0.6, gHd * 0.6 + 0.4, x);
  else if (sty == 2) w = smoothstep(0.47, 0.53, x);
  else if (sty == 3) { float dd = distance(gP, uPen.xy) / max(uView.x, uView.y); w = smoothstep(dd * 0.75, dd * 0.75 + 0.3, x); }
  else if (sty == 4) {
    // 描いた先から: いまある帯は、前の表現のまま変えない。切り替わったあとに描いた分だけが、次の表現で出てくる。
    // 古い帯は、新しく描いた分だけ、いちばん古い所から巻き取られる。
    // 継ぎ目: 切り替わった所で ぶつ切りにしない。切り替わってから RAMP の跡ぶんは、前の表現から次の表現へ、帯に沿って少しずつ変わる。
    float idx = uNew - gAge; // 切り替わってから何番目の跡か(負なら、切り替わる前の跡)
    // 変わり具合は、面ごとではなく、面の四隅ごとに決める(となりの面と同じ値になるので、段々にならず、絵もずれない)。
    w = smoothstep(0.0, RAMP, idx + (gFr - 0.5) + aQ.x * 0.25);
    if (idx < RAMP) {
      // 前の帯と継ぎ目は、新しく描いた分だけ、いちばん古い所から巻き取られる。
      float rank = clamp((RAMP - idx) / max(1.0, uOld + RAMP), 0.0, 1.0); // 0 = 次の表現になりきる所、1 = いちばん古い
      float e = 1.0 - uRet * 1.1;
      keep = 1.0 - smoothstep(e, e + 0.1, rank);
    }
  }
  else {
    // 入れ替えた並びでは、面ごとの ばらつきを ほとんど無くす(変わり目が、帯の上を1本の線として走る)。
    float jit = mix(0.28, 0.03, uSharp);
    w = clamp(x * (1.0 + SP) - SP * ((1.0 - jit) * gHd + jit * h1), 0.0, 1.0); w = w * w * (3.0 - 2.0 * w);
  }
  float bulgeK = sty == 0 ? 1.0 : (sty == 3 ? 0.5 : (sty == 1 ? 0.25 : 0.0)); // 4 は 0(散らさない)

  // 帯の面: 四隅を、それぞれの位置での芯から作る(となりの面と、ぴったり つながる)。
  gTq = (gFr - 0.5) + aQ.x * 0.25;
  gVc = gV + aQ.y * (0.5 / float(NVi));
  int jn = gTq < 0.0 ? (gJ == 0 ? Mi - 1 : gJ - 1) : (gJ + 1 == Mi ? 0 : gJ + 1);
  vec4 q0 = texelFetch(uPath, ivec2(jn, 0), 0);
  float seam = gTq < 0.0 ? step(Mf - 1.5, gAge) : step(gAge, 0.5);
  float ok = gR1.w * texelFetch(uPath, ivec2(jn, 1), 0).w * step(distance(q0.xy, gP), uDp * 1.6) * (1.0 - seam);
  if (ok > 0.5) {
    if (gTq < 0.0) { gPq = mix(q0.xy, gP, gTq + 1.0); gTq2 = mix(q0.zw, gT, gTq + 1.0); }
    else { gPq = mix(gP, q0.xy, gTq); gTq2 = mix(gT, q0.zw, gTq); }
  } else { gPq = gP + gT * gTq * uDp; gTq2 = gT; }
  gTq2 = normalize(gTq2 + vec2(1e-5, 0.0));
  gNq = vec2(-gTq2.y, gTq2.x);
  gUc = float(gJ) + 0.5 + gTq;
  gX0 = vec3(gPq + gNq * gVc * uW, 0.0);
  gC0 = vec3(gP + gT * (gFr - 0.5) * uDp + gN * gV * uW, 0.0);
  float asp = uAsp[int(gR2.w)];
  gUVp = 0.5 + (gC0.xy - gR2.xy) / vec2(gR2.z, gR2.z / asp);
  gUVb = 0.5 + (gX0.xy - gR2.xy) / vec2(gR2.z, gR2.z / asp);

  int idA = int(uFrom + 0.5); int idB = int(uTo + 0.5);
  O A = stateOf(idA);
  O B = A;
  if (w > 0.0) B = stateOf(idB);
  if (w >= 1.0) A = B;

  // 変わる途中は、まっすぐ飛ばずに、少し ふくらんで動く。
  float arc = sin(3.14159 * w);
  vec3 bulge = vec3((vec2(h2, h3) - 0.5) * uW * 1.1, (h1 - 0.5) * uW * 1.4) * arc * bulgeK;
  // 入れ替えた並びでは、面を ばらばらに散らさない。帯が ひと続きのまま、少し浮いて うねる。
  if (uSharp > 0.5) bulge = vec3(gNq * sin(gUc * 0.19 + uTime * 1.6) * uW * 0.16, uW * 0.42) * arc * bulgeK;
  vec3 corner = mix(A.corner, B.corner, w);
  vec3 cc = mix(A.centre, B.centre, w);
  // 出てくるところ(ペン先)と、巻き取られるところ(いちばん古い所)。帯に乗る表現だけ。
  float sc0 = gR1.w * smoothstep(0.0, 0.16, uTime - gR1.z) * smoothstep(Mf, Mf - 22.0, gAge);
  float sc = mix(A.gate < 0.0 ? sc0 : A.gate, B.gate < 0.0 ? sc0 : B.gate, w) * keep;
  vec3 wp = cc + (corner - cc) * sc + bulge;

  float solidW = float(idA == 1) * (1.0 - w) + float(idB == 1) * w;
  float alpha = mix(A.alpha, B.alpha, w);
  if (uPass > 0.5) {
    // 影の地図: 光から見た近さだけを書く。立体の紙だけが影を落とす。
    vec3 m = toShadow(wp);
    vQ = aQ; vShape = vec2(1.0); vMix = vec4(0.0, 1.0, 0.0, 1.0); vLit = vec4(1.0, 0.0, 0.0, 0.0); vAlt = vec4(0.0);
    vUV = vec2(0.5); vCell = vec2(0.0); vRib = vec2(10.0, 0.0); vTint = vec3(1.0); vLine = PAPER; vPar = 0.0; vScr = vec2(0.0);
    gl_Position = solidW < 0.5 || sc < 0.02 ? vec4(2.0, 2.0, 2.0, 1.0) : vec4(m.xy * 2.0, m.z * 2.0 - 1.0, 1.0);
    return;
  }
  const float F = 1500.0;
  vec2 ctr = uView * 0.5;
  vec2 sp = ctr + uCam + (wp.xy - ctr - uCam) * F / (F - wp.z);
  vScr = sp;
  float depth = clamp(-(wp.z + (1.0 - gHd) * 3.0) / 1600.0, -0.99, 0.99);
  gl_Position = vec4(sp.x / uView.x * 2.0 - 1.0, 1.0 - sp.y / uView.y * 2.0, mix(0.6, depth, alpha), 1.0);

  // 写真の色: 帯の上で、その場所に見えていた写真。
  vec2 fp = mix(A.corner.xy, B.corner.xy, w);
  vUV = mix(A.uv, B.uv, w);
  float wk = w < 0.5 ? A.work : B.work;
  vCell = vec2(mod(wk, AT.x), floor(wk / AT.x));
  vQ = aQ;
  vShape = mix(A.shape, B.shape, w) * sc;
  vMix = vec4(mix(A.round, B.round, w), alpha, mix(A.line, B.line, w), mix(A.face, B.face, w));
  vLit = vec4(mix(A.lit, B.lit, w), mix(A.gloss, B.gloss, w), mix(A.tex, B.tex, w), mix(A.ridge, B.ridge, w));
  vAlt = vec4(mix(A.col, B.col, w), 1.0);
  vTint = mix(A.tint, B.tint, w);
  vPar = mix(A.par, B.par, w);
  vLine = mix(A.lineCol, B.lineCol, w);
  vRib = vec2((mod(float(gJ), SEGf) + 0.5 + gTq) * uDp, gVc * uW);
}`;

const FS = `#version 300 es
precision highp float;
uniform sampler2D uAtlas;
uniform float uW;
uniform float uSharp;
in vec2 vQ; in vec2 vUV; in vec2 vCell; in vec2 vShape; in vec2 vRib;
in vec4 vMix; in vec4 vLit; in vec4 vAlt; in vec3 vTint; in vec3 vLine; in float vPar; in vec2 vScr;
uniform sampler2D uDAtlas;
uniform sampler2D uBAtlas; // 被写体を抜いて補った背景
uniform vec3 uLight;
uniform vec2 uTilt;
out vec4 o;
const vec3 PAPER = vec3(0.957, 0.945, 0.918);
void main(){
  // 形: 四角から、丸や棒へ。丸や棒の ふちは、なめらかに。
  vec2 p = vQ * vShape;
  float r = min(vShape.x, vShape.y);
  vec2 q = max(abs(p) - (vShape - r), 0.0);
  float cov = mix(1.0, clamp(r - length(q) + 0.5, 0.0, 1.0), vMix.x);
  if (cov <= 0.002) discard;
  vec2 uv = clamp(vUV, vec2(0.004), vec2(0.996));
  float shade = 1.0;
  vec3 layC = vec3(-1.0);
  if (vPar > 0.01) {
    // 写真を立体に見せる。(1) のぞき込む向きの分だけ、奥行きをたどってずらす。
    // (2) 奥行きから面の向きを出し、指を光にして照らす。(3) 光の方へたどって、自分の影を落とす。
    // 奥行きが平らな作品(ロゴ・ポスター)は、明るさを高さにして、浮き彫りとして照らす。
    vec2 AT2 = vec2(${ACOLS}.0, ${AROWS}.0);
    float flatW = step(texture(uDAtlas, (vCell + vec2(0.5)) / AT2).r + texture(uDAtlas, (vCell + vec2(0.25, 0.7)) / AT2).r + texture(uDAtlas, (vCell + vec2(0.75, 0.3)) / AT2).r, 0.01);
    #define HGT(q) mix(texture(uDAtlas, (vCell + clamp(q, 0.004, 0.996)) / AT2).r, dot(texture(uAtlas, (vCell + clamp(q, 0.004, 0.996)) / AT2).rgb, vec3(0.3, 0.59, 0.11)) * 0.25, flatW)
    vec2 dir = uTilt * 0.08 * vPar * (1.0 - flatW * 0.6);
    const int NS = 12;
    float lay = 1.0 / float(NS);
    float cur = 1.0;
    vec2 q = uv + dir * 0.5;
    float hgt = HGT(q);
    for (int i = 0; i < NS; i++) {
      if (hgt >= cur) break;
      cur -= lay; q -= dir * lay;
      hgt = HGT(q);
    }
    uv = clamp(q, vec2(0.004), vec2(0.996));
    float e = 0.006;
    float hx = HGT(uv + vec2(e, 0.0)) - HGT(uv - vec2(e, 0.0));
    float hy = HGT(uv + vec2(0.0, e)) - HGT(uv - vec2(0.0, e));
    float S = mix(14.0, 22.0, flatW);
    vec3 nrm = normalize(vec3(-hx * S, -hy * S, 1.0));
    vec3 L = normalize(vec3(uLight.xy - vScr, 150.0));
    float dif = max(dot(nrm, L), 0.0);
    float spc = pow(max(dot(nrm, normalize(L + vec3(0.0, 0.0, 1.0))), 0.0), 40.0);
    // 自分の影: 光の方へ数歩たどって、手前に高い所があれば影。
    float sh = 0.0;
    vec2 ld = normalize(L.xy + vec2(1e-4)) * 0.012;
    float h0 = HGT(uv);
    for (int i = 1; i <= 8; i++) {
      float hi = HGT(uv + ld * float(i));
      sh = max(sh, clamp((hi - h0 - float(i) * 0.012) * 10.0, 0.0, 1.0));
    }
    float lit = 0.28 + 1.15 * dif - 0.5 * sh + 0.55 * spc;
    shade = mix(1.0, lit, clamp(vPar, 0.0, 1.0));
    // 全画面の写真(par>1.2): 被写体と背景を別の層にして、のぞき込む向きで逆に動かす(3D写真)。
    // 被写体がずれた跡には、補った背景が見える。被写体は背景に影を落とす。
    if (vPar > 1.2 && flatW < 0.5) {
      vec2 uv0 = clamp(vUV, 0.004, 0.996);
      vec2 sh = uTilt * 0.07;
      vec2 fq = clamp(uv0 - sh, 0.004, 0.996);
      float m = smoothstep(0.3, 0.7, texture(uDAtlas, (vCell + fq) / AT2).b);
      vec2 bq = clamp(uv0 + sh * 0.4, 0.004, 0.996);
      vec4 bg = texture(uBAtlas, (vCell + bq) / AT2);
      vec3 fgc = texture(uAtlas, (vCell + fq) / AT2).rgb;
      vec3 bgc = bg.a > 0.5 ? bg.rgb : texture(uAtlas, (vCell + bq) / AT2).rgb;
      float ms = smoothstep(0.3, 0.7, texture(uDAtlas, (vCell + clamp(uv0 - sh * 1.6 + normalize(vScr - uLight.xy + 1e-4) * 0.025, 0.004, 0.996)) / AT2).b);
      bgc *= 0.78 - 0.4 * ms;
      layC = mix(bgc, fgc * (0.9 + 0.35 * dif + 0.3 * spc), m);
    }
    #undef HGT
  }
  vec3 tc = layC.x >= 0.0 ? layC * vTint : texture(uAtlas, (vCell + uv) / vec2(${ACOLS}.0, ${AROWS}.0)).rgb * vTint * shade;
  // 紙の裏。入れ替えた並びでは、表の写真が透ける(薄い紙の裏から見た刷り。真っ白な穴にしない。写真の色を残す)。
  if (vMix.w < 0.0) tc = mix(PAPER, mix(PAPER * 0.97, tc, 0.4), uSharp);
  vec3 col = mix(vAlt.rgb, tc, vLit.z);
  // 帯のふちと、作品の境目の線。
  float line = max(step(uW * 0.5 - 1.3, abs(vRib.y)), step(vRib.x, 1.3));
  col = mix(col, vLine, line * step(0.98, vMix.z));
  // 光(立体のとき)。明るい所は、白く飛ばさずに丸める。
  vec3 lc = col * vLit.x + vLit.y;
  col = mix(lc, (1.0 - exp(-1.25 * lc)) * 1.22, step(0.001, vLit.y + abs(vLit.x - 1.0)) * 0.0 + clamp(abs(vLit.x - 1.0) * 4.0, 0.0, 1.0));
  // 糸の膨らみ
  col *= mix(1.0, 0.62 + 0.5 * (1.0 - vQ.y * vQ.y), vLit.w);
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

// 画面全体の質感。アナログ(1)では紙の粒子・周辺の落ち・わずかな暖かさ、デジタル(0)では走査線と色の割れ。
const POST_FS = `#version 300 es
precision highp float;
uniform sampler2D uImg;
uniform float uAnalog, uTime;
uniform vec2 uRes;
in vec2 vUv;
out vec4 o;
float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main(){
  float an = uAnalog; float dg = 1.0 - an;
  vec2 px = 1.0 / uRes;
  vec3 c = texture(uImg, vUv).rgb;
  // デジタル: 色が少し割れ、細い走査線が入る
  float sh = dg * 1.2;
  c.r = mix(c.r, texture(uImg, vUv + vec2(px.x * sh, 0.0)).r, dg);
  c.b = mix(c.b, texture(uImg, vUv - vec2(px.x * sh, 0.0)).b, dg);
  c *= 1.0 - dg * 0.07 * (0.5 + 0.5 * sin(gl_FragCoord.y * 3.14159 * 0.5));
  // アナログ: 粒子、周辺の落ち、黒の浮き、わずかな暖かさ
  float n = h(floor(gl_FragCoord.xy / 1.5) + fract(uTime * 7.0) * 91.0) - 0.5;
  c += n * 0.05 * an;
  vec2 q = vUv - 0.5;
  c *= mix(1.0, 1.0 - 0.45 * dot(q, q) * 2.0, an);
  c = mix(c, c * vec3(1.03, 1.0, 0.93) + 0.012, an);
  o = vec4(max(c, 0.0), 1.0);
}`;

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
  const post = build(FADE_VS, POST_FS)!;
  if (!prog || !fade || !floor) return () => {};
  gl.useProgram(floor);
  gl.uniform1i(gl.getUniformLocation(floor, 'uShadow'), 3);
  gl.useProgram(post);
  gl.uniform1i(gl.getUniformLocation(post, 'uImg'), 2);
  const pu = { analog: gl.getUniformLocation(post, 'uAnalog'), time: gl.getUniformLocation(post, 'uTime'), res: gl.getUniformLocation(post, 'uRes') };
  const fl = { view: gl.getUniformLocation(floor, 'uView'), light: gl.getUniformLocation(floor, 'uLight'), solid: gl.getUniformLocation(floor, 'uSolid') };
  gl.useProgram(fade);
  gl.uniform1i(gl.getUniformLocation(fade, 'uPrev'), 2);
  const uKeep = gl.getUniformLocation(fade, 'uKeep');
  gl.useProgram(prog);
  const U = (n: string) => gl.getUniformLocation(prog, n);
  const u = {
    view: U('uView'), dp: U('uDp'), w: U('uW'), time: U('uTime'), phase: U('uPhase'), k: U('uK'), twK: U('uTwK'), zK: U('uZK'),
    pass: U('uPass'), asp: U('uAsp'), pitch: U('uPitch'), cols: U('uCols'), cells: U('uCells'), step: U('uStep'),
    focus: U('uFocus'), focusAsp: U('uFocusAsp'), from: U('uFrom'), to: U('uTo'), openW: U('uOpenW'), sharp: U('uSharp'), pen: U('uPen'), light: U('uLight'), cam: U('uCam'), tilt: U('uTilt'), sty: U('uSty'), sw: U('uSw'), nw: U('uNew'), old: U('uOld'), ret: U('uRet'),
  };
  gl.uniform1i(U('uPath'), 0);
  gl.uniform1i(U('uAtlas'), 1);
  gl.uniform1i(U('uShadow'), 3);
  gl.uniform1i(U('uDAtlas'), 8);
  gl.uniform1i(U('uBAtlas'), 9);
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
  // 作品ごとの奥行きを1枚にまとめたもの(浮き彫りに使う)。
  const datlas = gl.createTexture();
  gl.activeTexture(gl.TEXTURE8);
  gl.bindTexture(gl.TEXTURE_2D, datlas);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, ACOLS * CELL, AROWS * CELL, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(ACOLS * CELL * AROWS * CELL * 4));
  for (const p of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D, p, gl.LINEAR);
  for (const p of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T]) gl.texParameteri(gl.TEXTURE_2D, p, gl.CLAMP_TO_EDGE);
  // 被写体を抜いて補った背景(全画面の3D写真で、被写体の後ろに見える層)。
  const batlas = gl.createTexture();
  gl.activeTexture(gl.TEXTURE9);
  gl.bindTexture(gl.TEXTURE_2D, batlas);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, ACOLS * CELL, AROWS * CELL, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(ACOLS * CELL * AROWS * CELL * 4));
  for (const p of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D, p, gl.LINEAR);
  for (const p of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T]) gl.texParameteri(gl.TEXTURE_2D, p, gl.CLAMP_TO_EDGE);
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
    // 奥行き(平面の作品は、平らのまま)
    if (a.dataset.depth && a.dataset.flat === undefined) {
      const dm = new Image();
      dm.onload = () => {
        if (dead) return;
        const c2 = document.createElement('canvas');
        c2.width = c2.height = CELL;
        const x2 = c2.getContext('2d')!;
        x2.filter = 'blur(2px)';
        x2.drawImage(dm, 0, 0, CELL, CELL);
        gl.activeTexture(gl.TEXTURE8);
        gl.bindTexture(gl.TEXTURE_2D, datlas);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, (k % ACOLS) * CELL, Math.floor(k / ACOLS) * CELL, gl.RGBA, gl.UNSIGNED_BYTE, c2);
      };
      dm.src = a.dataset.depth;
      if (a.dataset.bg) {
        const bm = new Image();
        bm.onload = () => {
          if (dead) return;
          const c3 = document.createElement('canvas');
          c3.width = c3.height = CELL;
          c3.getContext('2d')!.drawImage(bm, 0, 0, CELL, CELL);
          gl.activeTexture(gl.TEXTURE9);
          gl.bindTexture(gl.TEXTURE_2D, batlas);
          gl.texSubImage2D(gl.TEXTURE_2D, 0, (k % ACOLS) * CELL, Math.floor(k / ACOLS) * CELL, gl.RGBA, gl.UNSIGNED_BYTE, c3);
        };
        bm.src = a.dataset.bg;
      }
    }
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
    if (!auto) advance(dp * 0.6);
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
    const n = Math.max(0, Math.floor(phase));
    seqAt(n + 1);
    phase += len / (Lmax * STATE_LEN * lenOf[n]);
    hold4();
    onPhase();
  }
  // 表現の並び: 毎回ランダム(直前の2つは避ける)。最初は帯から。
  // 0 帯 / 1 立体の紙 / 2 光の粒 / 3 浮き彫り / 4 リソグラフ / 5 フィルム / 6 刺繍 / 7 ピクセル / 8 点群 / 9 グリッチ
  const KINDS = 31;
  const ANALOG = [1, 0.85, 0, 0.5, 1, 1, 1, 0, 0, 0, 0.4, 0.7, 0.1, 0.3, 0.9, 0, 0.8, 0.1, 0, 0.8, 0.5, 0.7, 0.4, 0.6, 0.8, 0.5, 0.6, 0.6, 0.8, 0.8, 0.8]; // アナログらしさ(29 粒 と 30 割れる は、色の割れを掛けない)(画面全体の質感に使う)
  // 見た目が似ているものは入れない(技術が違っても、見た目が近ければ同じ)。表面だけの違い、写真が並ぶだけの札、帯と見分けのつかない変形(垂れる・流れ・波紋・立体写真)、点の重複(画素の落下・奥行きの点)、白い線の重複(糸)、紙の立体の重複(筒)も外した: 3 浮き彫り / 4 リソグラフ / 5 フィルム / 6 刺繍 / 7 ピクセル / 8 点群 / 9 グリッチ
  const ACTIVE = [0, 1, 2, 12, 13, 14, 15, 16, 19, 22, 23, 24, 25, 27];
  // 系統: 近い表現が続かないように、直前2つと同じ系統は選ばない。
  const FAM: Record<number, string> = {
    0: 'band', 14: 'fold', 1: 'ribbon', 23: 'ribbon', 2: 'lines', 13: 'scatter', 22: 'scatter', 15: 'bars', 24: 'pile', 27: 'big',
    12: 'pixel', 16: 'fringe', 19: 'drip', 25: 'liquid',
    8: 'lines', 18: 'wire', 20: 'flow', 17: 'points', 29: 'grain', 30: 'scatter', 21: 'tube',
  };
  // 曲のように組む: 区間(イントロ / Aメロ / Bメロ / サビ / ドロップ / Cメロ)ごとに、使う表現・長さ・つなぎ方を変える。
  // 長さは「描く長さ」の倍率。ドロップは短く刻み、Cメロは長く伸ばす。区間の中では1つの表現が画面を占める。
  type Sec = { n: [number, number]; len: number; pool: number[]; sty: number[] };
  // 入れ替えた並び(data-set="sharp"。2026-11-23): 29表現を1つずつ見て、締まっているものに絞った。
  //   残す: 0 帯 / 1 立体の紙 / 17 奥行きの点 / 14 蛇腹 / 19 垂れる
  //   戻す: 8 点群の線 / 18 線だけの帯 / 20 流れに乗る
  //   入れ替え: 2 光の粒 → 29 粒、22 割れる → 30 割れる
  //   外す: 12 画素の落下 / 13 塵 / 15 棒の街 / 16 房 / 23 ばね / 24 積もる / 25 波紋 / 27 一枚を大きく(全面に写真を敷かない)
  //   本人の評価のあとで外した: 18 線だけの帯(写真の色を落として線にしている)/ 30 割れる(写真が分かれているだけ。割れる瞬間が無い)
  //   決まり: 写真が持っている色は落とさない(色を付け替える表現は、一段弱い)。8 は青緑をやめて、写真の色の点にした。
  const sharp = root.dataset.set === 'sharp';
  const SECS: Record<string, Sec> = sharp
    ? {
        intro: { n: [1, 1], len: 1.4, pool: [0], sty: [0] },
        // つなぎ方 4: いまある帯は変えず、描いた先から次の表現が出てくる(本人の案。ドロップの一撃だけは、帯ごと切り替える)。
        // 「描いた先から」(4)は、いったん外した: 帯の上に、変わりかけの状態が残り続け、切れ目や半端な絵が増えた(本人: 悪化)。仕組みは残してある。
        // 21 筒(3Dの管)を戻した。元の並びにも入っておらず、落ちていた。
        A: { n: [1, 2], len: 0.95, pool: [0, 1, 14, 21], sty: [0, 1, 3] },
        B: { n: [2, 3], len: 0.5, pool: [8, 29, 20, 17], sty: [1, 3, 2] },
        chorus: { n: [1, 2], len: 1.2, pool: [1, 17, 29, 21], sty: [3, 0] },
        drop: { n: [5, 8], len: 0.2, pool: [29, 8, 20, 19, 17, 14, 21], sty: [2] },
        P: { n: [1, 1], len: 3.2, pool: [28], sty: [1] },
        C: { n: [1, 1], len: 1.6, pool: [19, 20, 29], sty: [1] },
      }
    : {
        intro: { n: [1, 1], len: 1.4, pool: [0], sty: [0] },
        A: { n: [1, 2], len: 0.95, pool: [0, 14, 1, 23], sty: [0, 1, 3] },
        B: { n: [2, 3], len: 0.5, pool: [12, 15, 16, 2, 24], sty: [1, 3, 2] },
        chorus: { n: [1, 2], len: 1.2, pool: [27, 25, 22, 1], sty: [3, 0] },
        drop: { n: [5, 8], len: 0.2, pool: [13, 22, 12, 24, 19, 2, 15, 27, 25, 14], sty: [2] },
        P: { n: [1, 1], len: 3.2, pool: [28], sty: [1] },
        C: { n: [1, 1], len: 1.6, pool: [19, 16, 25], sty: [1] },
      };
  // ハイパーポップのMVやライブ演出の速さ: ドロップを多めに、プロフィール(P)も曲の中に置く。
  // 入れ替えた並びでは、プロフィールを曲の中に置かない(見ることと読むことを混ぜない。プロフィールは About のページへ)。
  const FORM = sharp
    ? ['intro', 'A', 'B', 'drop', 'chorus', 'B', 'drop', 'A', 'B', 'chorus', 'drop', 'C', 'drop', 'chorus']
    : ['intro', 'A', 'B', 'drop', 'chorus', 'P', 'B', 'drop', 'A', 'B', 'chorus', 'drop', 'C', 'drop', 'chorus', 'P'];
  const BEAT = 1.9; // 長さ1の区間が、触らずに進む秒数
  const LOOP = 1; // 2周目以降は Aメロから
  let formI = 0;
  const seq: number[] = [];
  const secOf: string[] = [];
  const lenOf: number[] = [];
  const styOf: number[] = [];
  const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)];
  const grow = () => {
    const name = FORM[formI];
    formI = formI + 1 < FORM.length ? formI + 1 : LOOP;
    const S = SECS[name];
    const cnt = S.n[0] + Math.floor(Math.random() * (S.n[1] - S.n[0] + 1));
    for (let i = 0; i < cnt; i++) {
      const a = seq.length ? seq[seq.length - 1] : -1;
      const b = seq.length > 1 ? seq[seq.length - 2] : -1;
      let c = pick(S.pool);
      let guard = 0;
      // 直前と同じ表現・同じ系統は避ける(区間の候補が少ないときは、同じ表現だけ避ける)。
      while (S.pool.length > 1 && (c === a || (guard < 60 && (FAM[c] === FAM[a] || c === b))) && guard++ < 200) c = pick(S.pool);
      seq.push(c);
      secOf.push(name);
      lenOf.push(S.len * (0.85 + Math.random() * 0.3));
      styOf.push(pick(S.sty));
    }
  };
  const seqAt = (n: number) => {
    while (seq.length <= n) grow();
    return seq[n];
  };
  const styAt = (n: number) => {
    seqAt(n);
    return styOf[n];
  };
  let secHook: (name: string, cut: boolean) => void = () => {};
  let frameW = 0; // 曲の中で、プロフィールの額になっている強さ
  let lastSec = '';
  let sFrom = 0;
  let sTo = 0;
  let analog = 1;
  // つなぎ方 4(描いた先から)の帳面: どの切り替わりの途中か、いつ切り替わったか、そのとき跡をいくつ書いていたか。
  let swN = -1;
  let swAt = 1e9;
  let swK = 0;
  // 継ぎ目のあと、新しくこれだけ描くと、前の表現の帯は巻き取られきる(跡の数)。切り替わるたびに決める。
  // 短すぎると、前の帯が一気に消えて、画面の帯が短くなりすぎる(本人の収録で確認)。前の帯の長さの半分にする。
  let RET = 110;
  /** 前の表現の帯が残っているうちは、次へ進まない(残したまま進むと、残りが一度に次の表現へ変わってしまう)。 */
  const hold4 = () => {
    if (swN >= 0 && K - swK < RET + RAMP) phase = Math.min(phase, swN + 0.999);
  };
  function onPhase() {
    const A = Math.max(0, Math.floor(phase));
    const f = phase - A;
    const x = Math.max(0, (f - HOLD) / (1 - HOLD));
    if (swN >= 0 && A !== swN) {
      // 切り替わり終わり: 前の表現の帯(もう巻き取られて見えない)を、しまう。
      // 継ぎ目(次の表現になりきる前の跡)も、いっしょにしまう。
      for (let k = Math.max(0, K - M); k < Math.min(K, swK + RAMP); k++) path[(M + (k % M)) * 4 + 3] = 0;
      swN = -1;
      swAt = 1e9;
    }
    if (swN < 0 && x > 0 && styAt(A) === 4) {
      swN = A;
      swAt = now;
      swK = K;
      RET = Math.max(110, Math.min(M / 2, 0.5 * Math.min(K, M)));
    }
    sFrom = seqAt(A);
    sTo = seqAt(A + 1);
    const wOf = (id: number) => (sFrom === id ? 1 - x : 0) + (sTo === id ? x : 0);
    trail = Math.max(sstep(0.15, 0.75, wOf(2)), sstep(0.3, 0.9, wOf(8)) * 0.8);
    solid = sstep(0.25, 1, wOf(1));
    frameW = wOf(28);
    // 入れ替えた並びでは、画面全体の仕上げを1つに揃える(色の割れと走査線は掛けない。細かい点が、色の雑音になるため)。
    analog = sharp ? 0.85 : ANALOG[sFrom] * (1 - x) + ANALOG[sTo] * x;
    const st = x > 0.5 ? sTo : sFrom;
    const si = x > 0.5 ? A + 1 : A;
    const sec = secOf[si] || 'A';
    if (st !== lastState || sec !== lastSec) {
      const cut = st !== lastState;
      lastState = st;
      lastSec = sec;
      if (cut) sfx.pon(ANALOG[st]);
      secHook(sec, cut);
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
  lbM.textContent = '開く';
  label.style.transition = 'opacity .2s';
  label.append(lbT, lbM);
  const snd = mk('button', `${FRAME}right:var(--pad);${BOTTOM}padding:.5rem .7rem;font-size:.66rem;letter-spacing:.08em;cursor:pointer;border-radius:0;`) as HTMLButtonElement;
  snd.type = 'button';
  const sndText = () => {
    snd.textContent = sfx.on ? '音あり' : '音なし';
    snd.setAttribute('aria-pressed', String(sfx.on));
  };
  sndText();
  snd.addEventListener('click', () => {
    sfx.set(!sfx.on);
    sndText();
    if (sfx.on) sfx.click();
  });
  ind.style.display = 'none'; // 状態の名前は出さない(講評で、デモっぽいと指摘)
  label.style.display = 'none';
  // ---------- プロフィール: 開くと、帯が画面のふちに回り込んで額になり、中に文字が入る。
  const base = (root.dataset.base || '').replace(/\/$/, '');
  const pf = mk('button', `${FRAME}right:calc(var(--pad) + 6.6rem);${BOTTOM}padding:.5rem .7rem;font-size:.66rem;letter-spacing:.08em;cursor:pointer;border-radius:0;`) as HTMLButtonElement;
  pf.type = 'button';
  pf.textContent = 'プロフィール';
  pf.setAttribute('aria-expanded', 'false');
  const panel = mk('section', 'position:absolute;z-index:2;left:calc(14px + 34px + 1.2rem);right:calc(14px + 34px + 1.2rem);top:calc(64px + 34px + 1rem);bottom:calc(14px + 34px + 1rem);overflow:auto;color:var(--fg);opacity:0;pointer-events:none;transition:opacity .35s;display:flex;flex-direction:column;justify-content:center;gap:1.1rem;');
  panel.dataset.panel = '';
  panel.setAttribute('aria-hidden', 'true');
  panel.innerHTML = `
    <h2 style="margin:0;font-size:clamp(1.6rem,7vw,2.6rem);font-weight:500;line-height:1.1">林 宋其<br><span style="font-size:.42em;letter-spacing:.08em;font-weight:400">Soki Hayashi</span></h2>
    <p style="margin:0;font-size:.8rem;line-height:1.7;color:var(--muted)">デザイナー / クリエイティブディレクター / 映像作家 / VJ<br>東京</p>
    <p style="margin:0;font-size:1rem;line-height:1.9;max-width:34em">世界観を作ります。<br>店やブランドに必要なのは、説明しきることではなく、想像させる入口を持つこと。小さなビジュアルの中に、その先の世界を予感させる。</p>
    <p style="margin:0;display:flex;gap:1.2rem;font-size:.8rem;letter-spacing:.06em"><a href="${base}/works/">作品一覧</a><a href="${base}/about/">プロフィール</a><a href="${base}/contact/">お問い合わせ</a></p>`;
  // ---------- 画面そのものも曲に合わせて動く: 文字の層、窓になる画面、ドロップの反転とナビの崩れ。
  const typeL = mk('div', 'position:absolute;inset:0;z-index:1;pointer-events:none;overflow:hidden;color:#fff;mix-blend-mode:difference;');
  typeL.dataset.type = '';
  typeL.setAttribute('aria-hidden', 'true');
  const big = document.createElement('div');
  big.className = 'mt-big';
  big.innerHTML = 'SOKI<br>HAYASHI';
  // 名前を大きく出すのはやめた(本人判断)。文字・図形は、名前ではなく画面の素材として使う方向で作り直す。
  big.style.display = 'none';
  typeL.append(big);
  root.append(typeL);
  const navA = [...document.querySelectorAll<HTMLElement>('.site-bar .mainnav a, .site-bar .logo')];
  const html = document.documentElement;
  const rnd = (a: number, b: number) => a + Math.random() * (b - a);
  secHook = (name, cut) => {
    if (panelOpen) return;
    html.dataset.sec = name;
    if (name === 'drop') {
      // 入れ替えた版では、ドロップの飾り(画面の明滅・色替え・拡大、大きな文字、メニューの散り)を出さない。
      // 本人: MV は「表現が切り替わるテンポと、表現の振れ幅」の話。画面の中の位置関係を崩すことではない。/lab/morph/ には残してある。
      if (cut && !sharp) {
        const fx = pick(['is-flash', 'is-hue', 'is-punch', 'is-flash', 'is-mono']);
        root.classList.add(fx);
        setTimeout(() => root.classList.remove(fx), fx === 'is-punch' ? 160 : 90);
        big.style.opacity = Math.random() < 0.35 ? '1' : '0';
        big.style.transform = `translate(${rnd(-30, 10)}vw, ${rnd(-20, 30)}vh) scale(${rnd(0.7, 1.6)}) rotate(${pick([0, 0, 90, -90])}deg)`;
        // 入れ替えた版では、上のメニューの文字とロゴを動かさない(本人: 位置が変わるのは微妙)。/lab/morph/ には残してある。
        for (const el of navA) el.style.transform = `translate(${rnd(-40, 40)}px, ${rnd(-10, 60)}px) rotate(${rnd(-25, 25)}deg)`;
      }
    } else {
      big.style.opacity = '';
      big.style.transform = '';
      for (const el of navA) el.style.transform = '';
    }
  };
  let panelOpen = false;
  let ovX = 0;
  let ovFrom = 0;
  const setPanel = (on: boolean) => {
    if (on === panelOpen) return;
    panelOpen = on;
    if (on) ovFrom = Math.max(0, (phase - Math.floor(phase) - HOLD) / (1 - HOLD)) > 0.5 ? sTo : sFrom;
    if (on) {
      html.dataset.sec = 'panel';
      big.style.transform = '';
      for (const el of navA) el.style.transform = '';
    } else secHook(lastSec, false);
    pf.textContent = on ? '閉じる' : 'プロフィール';
    pf.setAttribute('aria-expanded', String(on));
    panel.setAttribute('aria-hidden', String(!on));
    panel.style.pointerEvents = on ? 'auto' : 'none';
    if (on) { auto = false; drawing = false; }
  };
  pf.addEventListener('click', () => setPanel(!panelOpen));
  if (sharp) pf.style.display = 'none'; // プロフィールへは、上の About から行く

  // ---------- 押すとひらく(入れ替えた並びだけ): 帯の上の作品を押すと、その作品がひらく。もう一度押すと、作品のページへ。
  let openOn = false;
  let openWk = 0;
  let openX = 0;
  let openFrom = 0;
  let openAt = 0;
  const openBox = () => {
    const a = Math.max(asp[openWk] || 1, 0.2);
    const bw = vw * 0.86;
    const bh = vh * 0.72;
    const w = bw / a <= bh ? bw : bh * a;
    const h = bw / a <= bh ? bw / a : bh;
    return { x: (vw - w) / 2, y: (vh - h) / 2, w, h };
  };
  const setOpen = (w: number) => {
    const on = w >= 0;
    if (on) {
      if (!openOn) openFrom = Math.max(0, (phase - Math.floor(phase) - HOLD) / (1 - HOLD)) > 0.5 ? sTo : sFrom;
      openWk = w;
      openAt = now;
      lbT.textContent = works[w]?.textContent?.trim() || '';
      label.href = works[w]?.href || `${base}/works/`;
      auto = false;
      drawing = false;
      stroke = false;
    }
    openOn = on;
  };
  // 押した所に、いちばん近い帯の作品。帯から離れていれば -1。
  const workAt = (x: number, y: number) => {
    let best = -1;
    let bd = 1e9;
    for (let j = 0; j < M; j++) {
      if (path[(M + j) * 4 + 3] < 0.5) continue;
      const d = Math.hypot(path[j * 4] - x, path[j * 4 + 1] - y);
      if (d < bd) {
        bd = d;
        best = j;
      }
    }
    return best >= 0 && bd < W * 1.1 ? Math.round(path[(2 * M + best) * 4 + 3]) : -1;
  };
  addEventListener('keydown', (e) => { if (e.key === 'Escape') setOpen(-1); });
  addEventListener('keydown', (e) => { if (e.key === 'Escape') setPanel(false); });
  root.append(ind, label, snd, pf, panel);
  // 音のボタンの幅に合わせて、プロフィールのボタンを左に並べる。
  const placePf = () => { pf.style.right = `calc(var(--pad) + ${snd.offsetWidth}px + 0.5rem)`; };
  placePf();
  snd.addEventListener('click', placePf);

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
  const isUI = (t: EventTarget | null) => t instanceof Element && !!t.closest('a,button,[data-panel]');
  let downX = 0;
  let downY = 0;
  let downT = 0;
  let strayed = 0; // 押してから、指がどれだけ動いたか
  let waitMove = false;
  function onDown(e: PointerEvent) {
    if (isUI(e.target) || (e.pointerType === 'mouse' && e.button !== 0)) return;
    if (panelOpen) { setPanel(false); return; }
    const r = root.getBoundingClientRect();
    ptX = penX = e.clientX - r.left;
    ptY = penY = e.clientY - r.top;
    if (openOn) {
      // ひらいている作品を押すと、作品のページへ。外を押すと、閉じる。
      const b = openBox();
      if (ptX >= b.x && ptX <= b.x + b.w && ptY >= b.y && ptY <= b.y + b.h) label.click();
      else setOpen(-1);
      e.preventDefault();
      return;
    }
    downX = ptX;
    downY = ptY;
    downT = now;
    strayed = 0;
    drawing = true;
    auto = false;
    over = 1;
    // 入れ替えた並びでは、指が動いてから描きはじめる(押しただけでは、跡を使わない)。
    if (sharp) {
      stroke = false;
      waitMove = true;
    } else begin(penX, penY);
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
    if (drawing) strayed = Math.max(strayed, Math.hypot(ptX - downX, ptY - downY));
    if (drawing && waitMove && strayed >= 8) {
      waitMove = false;
      begin(downX, downY);
    }
  }
  function onUp() {
    if (!drawing) return;
    drawing = false;
    stroke = false;
    idle = 0.9;
    // 描かずに押しただけなら、そこの作品をひらく。
    if (sharp && strayed < 8 && now - downT < 0.45) {
      const w = workAt(downX, downY);
      if (w >= 0) setOpen(w);
    }
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
  let frozen = false; // 確認用: 曲を止める
  let raf = 0;
  let last = performance.now();
  const t0 = last;
  function tick(t: number) {
    raf = requestAnimationFrame(tick);
    const dt = Math.min(0.05, Math.max(0.001, (t - last) / 1000));
    last = t;
    now = (t - t0) / 1000;
    // 曲は時間でも進む(触らなくても動き続ける)。描くと、さらに速く進む。
    if (!panelOpen && !openOn && !frozen) {
      const n = Math.max(0, Math.floor(phase));
      seqAt(n + 1);
      phase += (dt / (BEAT * lenOf[n])) * (drawing ? 0.6 : 1);
      hold4();
      onPhase();
    }
    if (drawing) {
      const k = 1 - Math.exp(-dt / 0.03);
      penX += (ptX - penX) * k;
      penY += (ptY - penY) * k;
      lineTo(penX, penY);
    } else if (autoOn && !panelOpen && !openOn) {
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
    // プロフィールの額: 開くとき・閉じるときの動き
    ovX += ((panelOpen ? 1 : 0) - ovX) * (1 - Math.exp(-dt / 0.28));
    if (Math.abs(ovX - (panelOpen ? 1 : 0)) < 0.002) ovX = panelOpen ? 1 : 0;
    const pv = Math.max(0, (ovX - 0.55) / 0.45, (frameW - 0.6) / 0.4);
    panel.style.opacity = String(pv);
    panel.classList.toggle('is-shown', pv > 0.5);
    // ひらいた作品: ひらくとき・閉じるときの動き。しばらく触られなければ、閉じる。
    if (openOn && now - openAt > 9) setOpen(-1);
    openX += ((openOn ? 1 : 0) - openX) * (1 - Math.exp(-dt / 0.2));
    if (Math.abs(openX - (openOn ? 1 : 0)) < 0.002) openX = openOn ? 1 : 0;
    const opOn = openX > 0.001;
    const showLb = openOn && openX > 0.8;
    if (sharp) {
      label.style.display = opOn ? 'block' : 'none';
      label.style.opacity = showLb ? '1' : '0';
      label.style.pointerEvents = showLb ? 'auto' : 'none';
    }
    gl!.uniform1f(u.openW, opOn ? openWk : -1);
    gl!.uniform1f(u.sharp, sharp ? 1 : 0);
    const ovOn = ovX > 0.001 || opOn;
    if (opOn) {
      ovFrom = openFrom;
      ovX = Math.max(ovX, 0);
    }
    gl!.uniform1f(u.phase, opOn ? HOLD + openX * (1 - HOLD) : ovX > 0.001 ? HOLD + ovX * (1 - HOLD) : phase);
    gl!.uniform1f(u.k, Math.max(1, K));
    gl!.uniform1f(u.focus, focus);
    gl!.uniform1f(u.focusAsp, asp[focus]);
    gl!.uniform1f(u.from, opOn ? openFrom : ovOn ? ovFrom : sFrom);
    gl!.uniform1f(u.to, opOn ? 27 : ovOn ? 28 : sTo);
    gl!.uniform1f(u.sty, ovOn ? 1 : styAt(Math.max(0, Math.floor(phase))));
    gl!.uniform1f(u.sw, swAt);
    // 切り替わりの途中でなければ、「切り替わったあとの跡」は無い(すべて前の表現)。
    const nw4 = swN >= 0 ? K - swK : -1e6;
    gl!.uniform1f(u.nw, nw4);
    gl!.uniform1f(u.old, Math.max(1, Math.min(K, M) - Math.max(0, nw4)));
    gl!.uniform1f(u.ret, swN >= 0 ? Math.max(0, Math.min(1, (K - swK - RAMP) / RET)) : 0);
    gl!.uniform3f(u.pen, fx, fy, fon);
    gl!.uniform3f(u.light, lightX, lightY, W * 2.6);
    gl!.uniform2f(u.cam, (lightX - vw / 2) * 0.2, (lightY - vh / 2) * 0.2);
    gl!.uniform2f(u.tilt, Math.max(-1, Math.min(1, ((lightX - vw / 2) / vw) * 2.2)), Math.max(-1, Math.min(1, ((lightY - vh / 2) / vh) * 2.2)));

    // 0) 影の地図(立体が少しでもあるとき)
    const shadowOn = K > 0 && (sFrom === 1 || sTo === 1);
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
    // 4) 画面へ: アナログの表現では紙と粒子の質感、デジタルの表現では走査線と色の割れ。
    gl!.bindFramebuffer(gl!.FRAMEBUFFER, null);
    gl!.viewport(0, 0, cv.width, cv.height);
    gl!.disable(gl!.DEPTH_TEST);
    gl!.disable(gl!.BLEND);
    gl!.useProgram(post);
    gl!.activeTexture(gl!.TEXTURE2);
    gl!.bindTexture(gl!.TEXTURE_2D, keepTex);
    gl!.uniform1f(pu.analog, analog);
    gl!.uniform1f(pu.time, now);
    gl!.uniform2f(pu.res, cv.width, cv.height);
    gl!.drawArrays(gl!.TRIANGLE_STRIP, 0, 4);
    gl!.useProgram(prog);
    // 描いた直後の画面を渡す(ページの移り変わりが、この画面を粒にするため)。
    if (shotFn) {
      const f = shotFn;
      shotFn = null;
      f(cv);
    }
  }
  let shotFn: ((c: HTMLCanvasElement) => void) | null = null;
  (window as unknown as Record<string, unknown>).__morphShot = (fn: (c: HTMLCanvasElement) => void) => {
    shotFn = fn;
  };
  size(true);
  raf = requestAnimationFrame(tick);

  (window as unknown as Record<string, unknown>).__morph = {
    // 確認用: 表現の並びを指定する
    seq(list: number[], sec = 'A', len = 1, sty = -1) {
      seq.length = secOf.length = lenOf.length = styOf.length = 0;
      seq.push(...list);
      for (let i = 0; i < list.length; i++) {
        secOf.push(sec);
        lenOf.push(len);
        styOf.push(sty >= 0 ? sty : i % 4);
      }
      onPhase();
    },
    phase(v: number) {
      phase = v;
      onPhase();
    },
    // 確認用: 曲を止める(変わり目の途中を、止めて見るため)
    freeze(on: boolean) {
      frozen = on;
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
    // 確認用: 筆を離さずに、続きを描く。
    more(pts: number[][]) {
      stroke = true;
      for (const [x, y] of pts) lineTo(x, y);
      stroke = false;
    },
    focus(n: number) {
      focus = n;
    },
    get state() {
      return { phase, K, focus, trail, solid, sFrom, sTo, analog, seq: seq.slice(0, 12), openOn, openX, openWk, now };
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
    typeL.remove();
    delete document.documentElement.dataset.sec;
    for (const el of navA) el.style.transform = '';
    snd.remove();
    sfx.dispose();
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  };
}
