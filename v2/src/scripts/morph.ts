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
// 立体(試し /lab/morph-3d/ だけ): 帯の面ひとつひとつの、立体の上での行き先(位置・向き)。
uniform highp sampler2D uObjP; uniform highp sampler2D uObjN; uniform highp sampler2D uShell; uniform highp sampler2D uObjE0; uniform highp sampler2D uObjE1; uniform highp sampler2D uObjE2; // 稜線の線分: いまの立体の A・B と、次の立体の A・B を 12 個の数に詰めた(37・38)
 // uShell: 立体の外形(角度×高さごとの、いちばん外側の半径)
uniform float uObjS, uObjCell, uNWk, uDeep; uniform vec4 uWrap; // uWrap: 立体の下端, 上端, 平均の半径, 巻くときの帯の幅(立体の単位)
uniform float uTwLim;      // 立体の紙: ねじりの強さの上限(幅 × ねじりの速さ)
uniform float uMap;        // 立体の紙: 写真の貼り方。0 = 窓(画面にまっすぐ)/ 1 = 帯に沿って貼る
uniform float uFold;       // 立体の紙: 急な折り返しで、紙を折る(試し。?fold=1)
uniform sampler2D uDAtlas; // 作品ごとの奥行きを1枚にまとめたもの
uniform vec3 uPen;   // 指(ペン)の位置と、あるかどうか
uniform vec3 uLight; // 光の位置(立体のとき)
uniform vec2 uCam;   // 視点の ずれ
uniform vec2 uTilt;  // 指の位置から決まる傾き(-1..1)
uniform vec2 uDev;           // 48 展開: その中の時刻(秒)と、何周目か
uniform float uPart, uPartT; // いまのパート(0 = 2D / 1 = 3D / 2 = 4D)と、そのパートに入ってからの秒数
out vec2 vQ; out vec2 vUV; out vec2 vCell; out vec2 vShape; out vec2 vRib;
out vec4 vMix;  // x: 丸さ / y: 不透明さ(1 = ふつうに重なる, 0 = 光として足す) / z: 線を引くか / w: 表(+) か 裏(-)
out vec4 vLit;  // x: 明るさ / y: 艶 / z: 写真の色を使う割合 / w: 糸の膨らみ
out vec4 vAlt;  // rgb: 写真を使わないときの色
out vec3 vTint; // 写真に掛ける色
out vec3 vLine; // 線の色
out float vPar;  // 立体写真の強さ
out vec2 vScr;   // 画面での位置(px)
out float vTrans; // 紙の裏から光が当たっている度合い
out vec4 vGl;     // xyz: 面の向き / w: ガラスとして塗る割合(ガラスの帯)
out float vClear; // 透明なガラスの割合
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
  if (uSharp > 0.5) {
    // 入れ替えた並び: 影のふちを ぼかす(外側にもう一回り、8か所)。紙に落ちる影が、角ばった灰色の四角に見えていた。
    const float F = 5.0 / 1024.0;
    for (int k = 0; k < 8; k++) {
      float a = float(k) * 0.7854 + 0.39;
      s += step(textureLod(uShadow, uv + vec2(cos(a), sin(a)) * F, 0.0).r + 0.014, m.z);
    }
    return s / 12.0;
  }
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
vec2 gUVs;       // 同じく、写真を帯に沿って貼る場合の位置
float gPhiQ;     // 立体の紙の傾き(この頂点の位置での値。跡と跡の間は なめらかにつなぐ)
float gPhiN;     // 同じく、となりの跡での値
int gJn;         // となりの跡
float gOk;       // となりの跡と つながっているか
float gFold;     // この面が、折り目の近くにあるか(立体の紙の試し)
float gYq;       // 折り目の効き(この頂点の位置での値)
float gFlen;     // その折り目の長さの半分
vec4 gF4;        // その折り目: 角の位置、折り目に直角な向き(角度)、角からの道のり

// ---- 表現の出力
struct O {
  float trans;  // 紙の裏から光が当たっている度合い(透けて見える刷りの濃さに使う)
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
  vec3 nrm;     // 面の向き(ガラスの帯だけが使う。画面の座標で)
  float glass;  // ガラスとして塗る割合(ガラスの帯だけ 1)
  float clear;  // 透明なガラス(中に写真が屈折して見える)の割合
};
O base(){
  O o;
  o.trans = 0.0;
  o.corner = gX0; o.centre = gC0; o.col = vec3(0.0); o.tex = 1.0; o.tint = vec3(1.0);
  o.shape = vec2(1.0); o.round = 0.0; o.alpha = 1.0; o.lit = 1.0; o.gloss = 0.0; o.face = 1.0;
  o.line = 0.0; o.lineCol = PAPER; o.ridge = 0.0;
  o.uv = gUVb; o.work = gR2.w; o.gate = -1.0; o.par = 0.0;
  o.nrm = vec3(0.0, 0.0, 1.0); o.glass = 0.0; o.clear = 0.0;
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
// 紙の傾き(入れ替えた並び)は、跡ごとに先に計算して渡してある(下の bankPaper)。ここでは、それを読むだけ。
// 以前の版(元の並び)は、帯に沿って一定の割合でねじる。
float paperTw(float u, float phi){
  return uSharp < 0.5 ? u * uTwK + uTime * 0.4 : phi;
}
// 紙の高さ。入れ替えた並びでは、波を1つの周期にしない。床(高さ 0)より下には沈まない:
// 低い所では、平らな紙が床すれすれに寝る。立った所は、そのぶん持ち上がって、下のふちが床に乗る。
// (机に這うテープにした版は、本人「悪化した」。ねじれて浮く形に戻した。)
float paperZ(float u, float th){
  float zph = u * uZK - uTime * 0.6;
  if (uSharp < 0.5) return uW * (0.6 + 0.45 * sin(zph));
  return uW * (0.78 + 0.45 * sin(zph) + 0.28 * sin(zph * 0.37 + 1.7)) + 0.46 * uW * abs(sin(th));
}
// 折り目(試し): 急な折り返しでは、紙を折る。
// 紙は、自分の面の中では曲がれない。帯の向きを その場で変えるには、斜めに折って、裏を上にして進むしかない。
// 作り方: 折り目の線を通る、床に垂直な鏡を立てる。鏡の向こうへ はみ出した面は、鏡に映した位置へ移す。
// 鏡に映した形は、もとの形と寸法が同じなので、紙は伸びも縮みもしない(ねじれていても、そのまま成り立つ)。
// 面は1枚ごとに「映す・映さない」を決め、折り目の線で切りそろえる(線をまたぐ面は、となりと重ねて すき間を埋める)。
vec3 foldPt(vec3 X, vec2 cp, float g, float on, bool mirror, bool top, out float slope){
  float q = dot(X.xy - gF4.xy, cp);
  float q2 = max(mirror ? -q : q, 0.0);
  X.xy += (q2 - q) * cp * g * on;
  // 折って重なった側(上になる側)は、折り目から少し浮く。折り目は、鋭い筋ではなく、小さな丸みになる。
  slope = 0.0;
  if (top) {
    float t = q2 / (0.22 * uW);
    float off = 1.0 - smoothstep(0.9 * uW, 1.8 * uW, q2);
    X.z += 0.18 * uW * smoothstep(0.0, 1.0, t) * off * g;
    slope = 0.18 * g * off * 6.0 * t * (1.0 - min(t, 1.0)) / 0.22;
  }
  return X;
}
O sSolid(){
  O o = base();
  vec2 cP = gPq; vec2 cN = gNq; vec2 cT = gTq2;
  vec2 mP = gP; vec2 mT = gT;
  float thq = gPhiQ;
  bool own = false;
  if (gFold > 0.5) {
    // 紙の芯: 折り目のまわりでは、折る前後の腕を まっすぐにしたもの(3行目)。
    vec4 c0 = texelFetch(uPath, ivec2(gJ, 3), 0);
    mP = c0.xy; mT = c0.zw;
    own = gF4.w > 0.0;
    vec4 Fn = texelFetch(uPath, ivec2(gJn, 4), 0);
    bool across = Fn.w < 1e5 && distance(Fn.xy, gF4.xy) < 0.01 && (Fn.w > 0.0) != own;
    if (gOk > 0.5 && !across) {
      vec4 cn = texelFetch(uPath, ivec2(gJn, 3), 0);
      cP = mix(c0.xy, cn.xy, abs(gTq)); cT = normalize(mix(c0.zw, cn.zw, abs(gTq)) + vec2(1e-5, 0.0));
    } else {
      // となりが折り目の向こう側: 混ぜずに、自分の腕を まっすぐ延ばす(折り目の先は、あとで鏡に映る)。
      cP = c0.xy + c0.zw * gTq * uDp; cT = c0.zw;
      int jo = gTq < 0.0 ? (gJ + 1 == Mi ? 0 : gJ + 1) : (gJ == 0 ? Mi - 1 : gJ - 1);
      vec4 o1 = texelFetch(uPath, ivec2(jo, 1), 0);
      float d = o1.w > 0.5 ? (gTq < 0.0 ? o1.x - gR1.x : gR1.x - o1.x) : 0.0;
      thq = gR1.x + clamp(d, -0.3, 0.3) * gTq;
    }
    cN = vec2(-cT.y, cT.x);
  }
  float th = paperTw(gUc, thq);
  float cs = cos(th); float sn = sin(th);
  float zph = gUc * uZK - uTime * 0.6;
  float zc = paperZ(gUc, th);
  o.corner = vec3(cP + cN * gVc * uW * cs, zc + gVc * uW * sn);
  float thc = paperTw(float(gJ) + gFr, gR1.x);
  vec2 mN = vec2(-mT.y, mT.x);
  o.centre = vec3(mP + mT * (gFr - 0.5) * uDp + mN * gV * uW * cos(thc), paperZ(float(gJ) + gFr, thc) + gV * uW * sin(thc));
  vec3 nrm = normalize(vec3(-cN * sn, cs) - vec3(cT, 0.0) * ((cos(zph) * 0.45 + uSharp * 0.28 * 0.37 * cos(zph * 0.37 + 1.7)) * uW * uZK / uDp) * cs);
  if (gFold > 0.5) {
    vec2 cp = vec2(cos(gF4.z), sin(gF4.z));
    // 折り目は、帯を横切る長さしかない。線の延長の向こうにある面は、折り目とは関係がない(帯が、別の所で線をまたいだだけ)。
    float on = step(abs(dot(o.centre.xy - gF4.xy, vec2(-cp.y, cp.x))), gFlen * 1.15);
    bool mirror = on > 0.5 && dot(o.centre.xy - gF4.xy, cp) < 0.0;
    bool top = own != mirror;
    float slope; float s2;
    o.corner = foldPt(o.corner, cp, gYq, on, mirror, top, slope);
    o.centre = foldPt(o.centre, cp, gR1.y, on, mirror, top, s2);
    if (mirror && gR1.y > 0.5) { nrm.xy -= 2.0 * dot(nrm.xy, cp) * cp; nrm = -nrm; }
    nrm = normalize(nrm - vec3(cp * slope * sign(nrm.z + 1e-4), 0.0));
  }
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
  o.gloss = 0.4 * spc * att * (1.0 - sh);
  if (uSharp > 0.5 && uMap > 0.5) o.uv = gUVs;
  if (uSharp > 0.5) {
    // 紙として照らす(入れ替えた並び)。
    // ・光は、面の向きが少し外れても回り込む(紙は表面で光が散るので、陰の境目がやわらかい)。
    // ・光が裏から当たっている面は、紙を透けてきた光で、ほの明るい。
    // ・つやは、ほとんど無い(樹脂の板のような、鋭い照り返しを出さない)。
    float wrap = max((dot(nn, L) + 0.3) / 1.3, 0.0);
    float back = max(dot(-nn, L), 0.0);
    // 光の配分(2回目)。1回目は、指の光だけが頼りで、全体が暗く、指から遠い所と陰が黒く沈み、写真の色がくすんでいた。
    // ・部屋の明るさ(どこにも届く光)を大きく取る。こちらを向いた面は、それだけで写真の色が出る。
    // ・指の光は、その上に乗る「向きと近さ」の差。遠くでも消えきらない。
    // ・影は、黒く塗りつぶさない(紙は まわりの光を拾う)。
    float room = 0.52 + 0.12 * (nn.z * 0.5 + 0.5);
    float near = 0.4 + 0.6 * att;
    o.lit = room + (0.6 * wrap * near + 0.05 * rim) * (1.0 - 0.6 * sh) - 0.12 * sh + 0.3 * back * near;
    o.trans = smoothstep(0.05, 0.6, back) * near;
    o.gloss = 0.06 * pow(max(dot(nn, normalize(L + vec3(0.0, 0.0, 1.0))), 0.0), 7.0) * att * (1.0 - sh);
  }
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
// 立体の版(uDeep = 1)だけ: 筒に奥行きを持たせる(監査 2026-11-25: 筒の芯が、画面の面に 貼りついたままだった)。
// ペン先は 指の下(画面の面)のまま。そこから古い方へ、筒は 手前に弧を描いて浮き、奥へ遠ざかっていく。交わる所は、上と下に分かれる。
float tubeZ(float u){
  float age = mod(uK - 0.5 - u, Mf);
  return uDeep * (uW * 1.6 * (1.0 - cos(age * 0.045)) * smoothstep(0.0, 24.0, age) - 900.0 * smoothstep(30.0, 430.0, age));
}
O sTube(){
  O o = base();
  float R = uW * 0.42;
  float a = gVc * 6.2832 * 0.98 + uTime * 0.7 + gUc * 0.01;
  float ac = gV * 6.2832 * 0.98 + uTime * 0.7 + (float(gJ) + gFr) * 0.01;
  o.corner = vec3(gPq + gNq * cos(a) * R, R * 1.4 + sin(a) * R + tubeZ(gUc));
  o.centre = vec3(gP + gT * (gFr - 0.5) * uDp + gN * cos(ac) * R, R * 1.4 + sin(ac) * R + tubeZ(float(gJ) + gFr));
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
// ---- 立体(試し /lab/morph-3d/ だけ)。帯そのもの(太さ・表現・描いた長さで進む仕組み)は変えていない。帯の面が、そのまま立体へ移る。
vec3 gOp, gOn, gOt, gOb, gOl, gOln;
float oh(vec3 p){ p = fract(p * vec3(0.1031, 0.1030, 0.0973)); p += dot(p, p.yxz + 33.33); return fract((p.x + p.y) * p.z); }
float gMorph = 0.0;
void objFrame(highp sampler2D tp, highp sampler2D tn){
  vec3 p = texelFetch(tp, ivec2(gIu, gIv), 0).xyz, n = texelFetch(tn, ivec2(gIu, gIv), 0).xyz;
  gOl = p; gOln = n;
  // 立体は回さない。ゆっくり揺れるだけ(光のほうが巡る)。
  float a = 0.4 * sin(uTime * 0.23), c = cos(a), s = sin(a);
  p = vec3(c * p.x + s * p.z, p.y, -s * p.x + c * p.z); n = vec3(c * n.x + s * n.z, n.y, -s * n.x + c * n.z);
  gOn = normalize(vec3(n.x, -n.y, n.z) + vec3(0.0, 0.0, 1e-5));
  gOp = vec3(uView * 0.5 + vec2(p.x, -p.y) * uObjS, p.z * uObjS);
  gOt = normalize(cross(vec3(0.0, 1.0, 0.0), gOn) + vec3(1e-4, 0.0, 0.0)); gOb = cross(gOn, gOt);
}
// 光は、指(監査 2026-11-25: 立体が指に まったく反応していなかった。光が時計で回っていた)。指が無いときは、自動のペン先が光になる。
vec3 objLight(vec3 at){ return normalize(vec3(uLight.xy - at.xy, uLight.z + 0.22 * max(uView.x, uView.y) - at.z) + vec3(sin(uTime * 0.9), 0.4 * sin(uTime * 0.53), 0.0) * 30.0); }
// 帯の いちばん新しい所(ペン先から出たばかり)は、帯のまま見える。そこから、立体へ流れ込む(描いた線が、立体の材料になる)。
O feed(O o){
  float tc = gR1.w * (1.0 - smoothstep(40.0, 150.0, gAge - (gFr - 0.5)));
  float tq = gR1.w * (1.0 - smoothstep(40.0, 150.0, gAge - gTq));
  if (max(tc, tq) <= 0.001) return o;
  O b = sBand();
  b.corner = mix(o.corner, b.corner, tq); b.centre = mix(o.centre, b.centre, tc);
  if (tc < 0.5) { b.col = o.col; b.tex = o.tex; b.uv = o.uv; b.work = o.work; b.tint = o.tint; b.lit = o.lit; b.gloss = o.gloss; b.par = o.par; b.line = o.line; b.gate = o.gate; b.round = o.round; b.face = o.face; b.trans = o.trans; b.ridge = o.ridge; b.alpha = o.alpha; b.shape = o.shape; b.lineCol = o.lineCol; b.nrm = o.nrm; b.glass = o.glass; b.clear = o.clear; }
  return b;
}
O objQuad(){
  O o = base();
  // 向こうを向いた面は出さない(裏の面が すき間から見えて、形が読めなくなっていた)。
  float h = uObjCell * uObjS * 1.05 * smoothstep(-0.12, 0.05, gOn.z);
  // 指のまわりの面は、押されて浮き、返る。
  vec2 dd = gOp.xy - uPen.xy; float push = uPen.z * exp(-dot(dd, dd) / (uW * uW * 2.2)) * step(0.0, gOn.z);
  float fl = push * 3.1416;
  vec3 c = gOp + gOn * push * uW * 0.8, b2 = gOb * cos(fl) + gOn * sin(fl);
  o.centre = c; o.corner = c + (gOt * aQ.x + b2 * aQ.y) * h * (1.0 + push * 0.8);
  o.gate = 1.0; o.line = 0.0;
  return o;
}
// 31 虹の立体: 面の向きと光の向きで、溝の虹が出る。
O sObjIri(){
  objFrame(uObjP, uObjN); O o = objQuad();
  vec3 L = objLight(gOp), H = normalize(L + vec3(0.0, 0.0, 1.0));
  float band = pow(max(0.0, 1.0 - abs(dot(gOn, H) - 0.75) * 2.2), 2.0);
  // 虹の色は ゆっくり変える(細かく変えると 面ごとの色の粒になって、形が消える)。形は、光の当たり方(陰)で読ませる。
  float lam = 0.22 + 0.78 * pow(max(dot(gOn, L) * 0.6 + 0.4, 0.0), 1.6);
  vec3 ir = (0.5 + 0.5 * cos(6.2832 * (dot(gOt, H) * 1.2 + gOn.y * 0.35 + uTime * 0.08 + vec3(0.0, 0.33, 0.67)))) * (0.45 + 0.8 * band) * (0.5 + 0.7 * pow(1.0 - abs(gOn.z), 1.5)) * lam + pow(max(dot(gOn, H), 0.0), 40.0) * 0.7 + 0.02;
  o.col = ir; o.tex = 0.0;
  return feed(o);
}
// 32 貼り込んだ立体: 作品の写真を、四角(白フチ)・丸・ちぎり・斜めに抜いて、向きも大きさも ばらばらに、3層重ねて貼る。
O sObjStick(){
  objFrame(uObjP, uObjN); O o = objQuad();
  vec3 p = gOl, n = gOln, an = abs(n);
  vec3 tl = normalize(cross(vec3(0.0, 1.0, 0.0), n) + vec3(1e-4, 0.0, 0.0)), bl = cross(n, tl);
  vec3 pc = p + (tl * aQ.x - bl * aQ.y) * uObjCell;
  vec2 uv, uvc; float ax;
  if (an.x > an.y && an.x > an.z) { uv = vec2(-p.z * sign(n.x), p.y); uvc = vec2(-pc.z * sign(n.x), pc.y); ax = 0.0; }
  else if (an.y > an.z) { uv = p.xz; uvc = pc.xz; ax = 1.0; }
  else { uv = vec2(p.x * sign(n.z), p.y); uvc = vec2(pc.x * sign(n.z), pc.y); ax = 2.0; }
  float lam = 0.62 + 0.45 * max(dot(gOn, objLight(gOp)), 0.0);
  o.tex = 0.0; o.col = vec3(0.07);
  bool hit = false;
  for (int L = 2; L >= 0; L--) {
    float fl = float(L), sc = 1.05 + fl * 0.7;
    vec2 off = vec2(fl * 3.7, ax * 5.3 + fl * 1.9), q = uv * sc + off, qc = uvc * sc + off, g = floor(q);
    for (int j = 1; j >= -1; j--) for (int i = 1; i >= -1; i--) {
      if (hit) continue;
      vec2 c = g + vec2(float(i), float(j));
      vec3 sd = vec3(c, fl * 13.0 + ax * 29.0);
      float r0 = oh(sd), r1 = oh(sd + 1.3), r2 = oh(sd + 2.9), r3 = oh(sd + 4.1), r5 = oh(sd + 8.3), r6 = oh(sd + 9.9);
      vec2 ctr = c + 0.5 + (vec2(r0, r1) - 0.5) * 0.7;
      float a = (r2 - 0.5) * 1.6, cs = cos(a), sn = sin(a);
      vec2 d = q - ctr; d = vec2(cs * d.x - sn * d.y, sn * d.x + cs * d.y);
      vec2 dc = qc - ctr; dc = vec2(cs * dc.x - sn * dc.y, sn * dc.x + cs * dc.y);
      float wk = min(floor(r6 * uNWk), uNWk - 1.0), asp = max(uAsp[int(wk)], 0.3);
      float hw = 0.34 + 0.3 * r3, hh = hw / asp; if (hh > 0.6) { hh = 0.6; hw = hh * asp; }
      float kind = floor(r5 * 4.0), sdf, edge = 0.035;
      if (kind < 0.5) sdf = max(abs(d.x) - hw, abs(d.y) - hh);
      else if (kind < 1.5) sdf = length(d) - min(hw, hh) * 1.15;
      else if (kind < 2.5) { sdf = max(abs(d.x) - hw, abs(d.y) - hh) + (oh(vec3(floor(d * 14.0), r0 * 50.0)) - 0.5) * 0.09; edge = 0.0; }
      else { d.x -= d.y * 0.53; dc.x -= dc.y * 0.53; sdf = max(abs(d.x) - hw, abs(d.y) - hh); }
      if (sdf < 0.0) {
        hit = true;
        if (sdf > -edge) o.col = vec3(0.96) * lam;
        else { o.tex = 1.0; o.work = wk; o.uv = vec2(dc.x / hw, -dc.y / hh) * 0.5 + 0.5; o.tint = vec3(lam); }
      }
    }
  }
  return feed(o);
}
// 37 線の立体: 立体を、稜線(面の折れ目と縁)の線だけで描く。写真は使わない。
// 部品の細かい機材(カメラ・計算機・切替機)は、写真を貼ると塊に見えた(2026-11-26)。線なら、製図のように形が読める。
// 帯の面の半分(偶数の列)が稜線、残りの半分が 輪郭(面の向きが画面と直角になる所。なめらかな椅子は稜線が少ないので)。
vec3 objRot(vec3 p);
vec3 objProj(vec3 p){ p = objRot(p); return vec3(uView * 0.5 + vec2(p.x, -p.y) * uObjS, p.z * uObjS); }
O objEdge(float m){
  O o = base();
  vec4 e0 = texelFetch(uObjE0, ivec2(gIu, gIv), 0), e1 = texelFetch(uObjE1, ivec2(gIu, gIv), 0), e2 = texelFetch(uObjE2, ivec2(gIu, gIv), 0);
  vec3 a = e0.xyz, b = vec3(e0.w, e1.xy);
  if (m > 0.0) {
    // 次の立体の稜線へ。並び(下から上)どうしで対応させ、下から順に移る。途中は 外へ ふくらむ。
    vec3 a2 = vec3(e1.zw, e2.x), b2 = e2.yzw;
    float lag = float(gIu) / (Mf * 2.0), mm = smoothstep(lag * 0.45, lag * 0.45 + 0.55, m);
    vec3 mid = mix((a + b) * 0.5, (a2 + b2) * 0.5, mm); vec3 out_ = normalize(vec3(mid.x, 0.0, mid.z) + vec3(1e-4, 0.0, 0.0)) * sin(mm * 3.1416) * 0.3;
    a = mix(a, a2, mm) + out_; b = mix(b, b2, mm) + out_;
  }
  vec3 pa = objProj(a), pb = objProj(b);
  vec2 d = pb.xy - pa.xy; float dl = length(d); vec2 t = dl > 1e-4 ? d / dl : vec2(1.0, 0.0), nr = vec2(-t.y, t.x);
  vec2 c2 = (pa.xy + pb.xy) * 0.5, dd = c2 - uPen.xy; float near = uPen.z * exp(-dot(dd, dd) / (uW * uW * 3.0));
  float wd = 0.5 * max(1.0, uView.x / 390.0) * (1.0 + near * 1.8);
  vec3 c = (pa + pb) * 0.5;
  o.centre = c; o.corner = c + vec3(t * aQ.x * (dl * 0.5 + wd) + nr * aQ.y * wd, 0.0);
  o.gate = 1.0; o.col = vec3(0.92) + vec3(near * 0.4); o.tex = 0.0; o.line = 0.0;
  return o;
}
O objSil(float fade){
  O o = base();
  vec2 ns = gOn.xy; float nl = length(ns); ns = nl > 1e-4 ? ns / nl : vec2(1.0, 0.0);
  vec2 ts = vec2(-ns.y, ns.x);
  float sil = (1.0 - smoothstep(0.04, 0.14, abs(gOn.z))) * (gOn.z < 0.0 ? 0.3 : 1.0) * fade;
  float wd = 0.5 * max(1.0, uView.x / 390.0), len = uObjCell * uObjS * 1.7;
  o.centre = gOp; o.corner = gOp + vec3(ts * aQ.x * len + ns * aQ.y * wd, 0.0);
  o.gate = sil > 0.05 ? 1.0 : 0.0; o.col = vec3(0.92) * (0.5 + 0.5 * sil); o.tex = 0.0; o.line = 0.0;
  return o;
}
O sObjLine(){
  if ((gIv % 2) == 0) return feed(objEdge(0.0));
  objFrame(uObjP, uObjN); return feed(objSil(1.0));
}
// 38 線の立体が、次の立体へ形を移す。描くほど進み、端まで行くと戻る(いまの立体 ↔ 次の立体)。
O sObjMorph(){
  float t = fract(uK / 300.0 + uTime * 0.08), m = smoothstep(0.1, 0.9, 1.0 - abs(t * 2.0 - 1.0));
  if ((gIv % 2) == 0) return feed(objEdge(m));
  objFrame(uObjP, uObjN); return feed(objSil(1.0 - smoothstep(0.0, 0.25, m)));
}
// 33 立体に巻く: 帯は帯のまま(絵も、出方も、太さの比も)、立体の外形に、下から上へ らせんに巻きつく。
// 巻く長さは、描いた長さのぶんだけ。描くほど巻きが増えて、立体の形が現れる。
float shellR(float th, float y){
  float fa = fract(th / 6.2832) * 96.0, fh = clamp((y - uWrap.x) / (uWrap.y - uWrap.x) * 64.0 - 0.5, 0.0, 62.999);
  int a0 = int(fa) % 96, a1 = (a0 + 1) % 96, hA = int(fh), hB = hA + 1; float ga = fract(fa), gh = fract(fh);
  return max(0.06, mix(mix(texelFetch(uShell, ivec2(a0, hA), 0).r, texelFetch(uShell, ivec2(a1, hA), 0).r, ga), mix(texelFetch(uShell, ivec2(a0, hB), 0).r, texelFetch(uShell, ivec2(a1, hB), 0).r, ga), gh)) + 0.02;
}
vec3 objRot(vec3 p){ float a = 0.4 * sin(uTime * 0.23), c = cos(a), s = sin(a); return vec3(c * p.x + s * p.z, p.y, -s * p.x + c * p.z); }
vec3 wrapAt(float u, float v, out vec3 n){
  float cnt = min(uK, Mf);
  float turns = max(0.35, cnt * uDp / uW * uWrap.w / (6.2832 * uWrap.z));
  float th = -u * turns * 6.2832, y = uWrap.x + uWrap.w * 0.5 + u * (uWrap.y - uWrap.x - uWrap.w) + v * uWrap.w;
  n = vec3(cos(th), 0.0, sin(th));
  float r = shellR(th, y);
  vec3 p = objRot(vec3(r * n.x, y, r * n.z)); n = objRot(n);
  return vec3(uView * 0.5 + vec2(p.x, -p.y) * uObjS, p.z * uObjS);
}
O sObjWrap(){
  O o = sBand();
  float cnt = min(uK, Mf);
  vec3 n, nq;
  o.centre = wrapAt(clamp((cnt - gAge - 0.5 + (gFr - 0.5)) / cnt, 0.0, 1.0), gV, n);
  o.corner = wrapAt(clamp((cnt - gAge - 0.5 + gTq) / cnt, 0.0, 1.0), gVc, nq);
  o.tint *= 0.62 + 0.45 * max(dot(normalize(vec3(n.x, -n.y, n.z)), objLight(o.centre)), 0.0);
  return feed(o);
}
// ---- ガラス(立体の版だけ)。本人(2026-11-25、最初の版に):「上手く使えていないな。案を出して欲しい」→ 3案に「全部やってみて」。
//   35 A ガラスの線: 描いた線が、その場でガラスになる(球に巻かない)。ゆっくり描いた所は太い塊、速く描いた所は細い光の線。
//   34 B 巻き取られる: 帯が中心に巻き取られ、巻き方そのものが変わり続ける(球 → 輪 → らせんの皿 → 結び目)。描いた長さで次の形へ。指に引かれて、ほどける。
//   36 C 封じたガラス: 黒くしない。厚いガラスの中に 作品が屈折して見え、ふちにだけ 虹。指の下は、レンズのように膨らむ。
// 面は ひと続きなので、画素ごとに なめらかに塗れる。
float bornAt(int j){ j = ((j % Mi) + Mi) % Mi; vec4 r = texelFetch(uPath, ivec2(j, 1), 0); return r.w > 0.5 ? r.z : -1.0; }
// その場所を引いた遅さ(0 = 速い、1 = ゆっくり)。跡は等しい間隔で記録されるので、となりとの時間の差が速さになる。
// となり同士の差だけで測ると、1コマの中で まとめて記録された点は「速い」、コマをまたいだ点は「遅い」になり、太さが1点おきに入れ替わって ギザギザになる
// (本人の iPhone の画面で判明、2026-11-25)。前後6点ぶんの時間で ならす。
float slowAt(int j){
  float c = bornAt(j), a = bornAt(j - 6), b = bornAt(j + 6), n = 12.0;
  if (b < 0.0 || b < c) { b = c; n -= 6.0; }
  if (a < 0.0 || a > c) { a = c; n -= 6.0; }
  float dt = (n > 0.0 && b > a) ? (b - a) / n : 0.03;
  return 1.0 - smoothstep(220.0, 1000.0, uDp / max(dt, 0.004));
}
float slowQ(float t){ return mix(slowAt(gJ), slowAt(gJ + (t > 0.0 ? 1 : -1)), abs(t)); }
// 35 A ガラスの線。
O sGlassLine(){
  O o = base();
  float wq = slowQ(gTq), wc = slowQ(gFr - 0.5);
  float hq = uW * mix(0.07, 0.5, wq), tq = uW * mix(0.07, 0.3, wq), hc = uW * mix(0.07, 0.5, wc), tc = uW * mix(0.07, 0.3, wc);
  float a = gVc * 6.2832, ac = gV * 6.2832;
  o.corner = vec3(gPq + gNq * cos(a) * hq, tq * 1.2 + sin(a) * tq + tubeZ(gUc));
  o.centre = vec3(gP + gT * (gFr - 0.5) * uDp + gN * cos(ac) * hc, tc * 1.2 + sin(ac) * tc + tubeZ(float(gJ) + gFr));
  o.nrm = normalize(vec3(gNq * cos(a) / hq, sin(a) / tq));
  o.glass = 1.0; o.tex = 0.0; o.line = 0.0; o.face = 1.0;
  return o;
}
// 36 C 封じたガラス: 帯の上に、かまぼこ形の厚いガラスが載る(上の面だけ。写真は 帯のときと同じ場所に見える)。
O sGlassClear(){
  O o = base();
  float hw = uW * 0.5, ht = uW * 0.34;
  float a = (gVc + 0.5) * 3.14159, ac = (gV + 0.5) * 3.14159;
  o.corner = vec3(gPq - gNq * cos(a) * hw, sin(a) * ht);
  o.centre = vec3(gP + gT * (gFr - 0.5) * uDp - gN * cos(ac) * hw, sin(ac) * ht);
  o.nrm = normalize(vec3(-gNq * cos(a) / hw, sin(a) / ht + 0.02));
  o.glass = 1.0; o.clear = 1.0; o.tex = 1.0; o.line = 0.0; o.face = 1.0;
  return o;
}
// 34 B 巻き取られる。芯の線(形ごと)を決め、その上に 断面が楕円の帯を載せる。
vec3 formC(float k, float u, float turns, out vec3 N){
  float lon = u * turns * 6.2832;
  if (k < 0.5) { float lat = mix(-1.25, 1.25, u); N = vec3(cos(lat) * cos(lon), sin(lat), cos(lat) * sin(lon)); return N; }                                   // 球
  if (k < 1.5) { float th = u * 6.2832; N = vec3(cos(lon) * cos(th), sin(lon), cos(lon) * sin(th)); return vec3(0.7 * cos(th), 0.0, 0.7 * sin(th)) + N * 0.36; } // 輪(輪に巻きつく)
  if (k < 2.5) { float y = mix(-0.92, 0.92, u); N = vec3(0.0, 1.0, 0.0); return vec3(cos(lon), 0.0, sin(lon)) * (0.12 + 0.88 * sqrt(max(0.0, 1.0 - y * y))) + vec3(0.0, y, 0.0); } // らせんの皿
  float t = u * 6.2832; N = vec3(cos(3.0 * t) * cos(2.0 * t), sin(3.0 * t), cos(3.0 * t) * sin(2.0 * t)); return vec3(0.62 * cos(2.0 * t), 0.0, 0.62 * sin(2.0 * t)) + N * 0.3;   // 結び目
}
vec3 formMix(float u, float turns, out vec3 N){
  // 描いた長さで、次の形へ進む(触らなくても、自動のペン先が描くので進む)。
  float ph = uK / 300.0 + uTime * 0.015, k0 = mod(floor(ph), 4.0), k1 = mod(k0 + 1.0, 4.0), w = smoothstep(0.5, 1.0, fract(ph));
  vec3 n0, n1; vec3 c0 = formC(k0, u, turns, n0);
  if (w <= 0.0) { N = n0; return c0; }   // 形が移っている間だけ、次の形も計算する(軽くするため)
  vec3 c1 = formC(k1, u, turns, n1);
  N = mix(n0, n1, w);
  return mix(c0, c1, w);
}
vec3 glassRot(vec3 p){
  float a = uTime * 0.25, c = cos(a), s = sin(a); p = vec3(c * p.x + s * p.z, p.y, -s * p.x + c * p.z);
  float t = 0.45, ct = cos(t), st = sin(t); return vec3(p.x, ct * p.y - st * p.z, st * p.y + ct * p.z);
}
vec3 glassAt(float u, float v, out vec3 n){
  float cnt = min(uK, Mf);
  float R = 0.36 * min(uView.x, uView.y);
  float turns = clamp(cnt * uDp / (6.2832 * R * 0.72), 1.5, 9.0);
  float breathe = 0.5 + 0.5 * sin(uTime * 0.33);
  float hw = uW * mix(0.2, 0.55, breathe), ht = uW * mix(0.1, 0.2, breathe);
  vec3 N, Na;
  vec3 C = formMix(u, turns, N);
  vec3 T = normalize(formMix(u + 0.004, turns, Na) - C + vec3(1e-6, 0.0, 0.0));
  vec3 B = normalize(cross(N, T) + vec3(0.0, 1e-5, 0.0)); N = cross(T, B);
  float a = v * 6.2832, ca = cos(a), sa = sin(a);
  vec3 p = glassRot(C * R + B * ca * hw + N * sa * ht);
  vec3 nn = glassRot(normalize(B * ca / hw + N * sa / ht));
  n = vec3(nn.x, -nn.y, nn.z);
  vec3 sp = vec3(uView * 0.5 + vec2(p.x, -p.y), p.z);
  // 指に引かれる(テープを引き出すように、近い所が指へ伸びる)。
  vec2 d = uPen.xy - sp.xy; sp.xy += d * uPen.z * 0.6 * exp(-dot(d, d) / (uW * uW * 5.0));
  return sp;
}
O sGlass(){
  // 本人(2026-11-25):「この表現は帯に落とし込む系ではない」「帯から変形とかがいいな」
  // → ガラスの場面では、帯の全部が ひとつの立体に変形する(ペン先に線を残さない。描いた線の形や幅に縛られない)。
  //   帯 → 立体 の移りは、ほかの表現と同じく、帯の先頭から順に ほどけて形へ渡る。描いた長さで、次の形へ進む。指は、光と、引く力。
  O o = base();
  float cnt = min(uK, Mf);
  vec3 nq;
  // 面は ひと続きなので、四隅の位置だけ決めれば足りる(中心は計算しない。軽くするため)。まだ描かれていない所は、1点に畳む。
  o.corner = gR1.w > 0.5 ? glassAt(clamp((cnt - gAge - 0.5 + gTq) / cnt, 0.0, 1.0), gVc, nq) : vec3(uView * 0.5, 0.0);
  o.centre = o.corner;
  o.nrm = gR1.w > 0.5 ? nq : vec3(0.0, 0.0, 1.0); o.glass = 1.0; o.tex = 0.0; o.line = 0.0; o.face = 1.0; o.gate = gR1.w > 0.5 ? 1.0 : 0.0;
  return o;
}
// ---- 帯から育つ展開(2026-11-27。本人:「ベースは帯。案は帯の展開を発展させるために足している」)
// 見る向きを少し回す(帯の中に奥行きがあったと分かる)。指の位置で傾き、ゆっくり回り続ける。
vec3 viewRot(vec3 p, vec2 c, float amt){
  amt *= step(0.5, uPart);
  p.xy -= c;
  float ay = (uTilt.x * 0.8 + sin(uTime * 0.23) * 0.55) * amt, ax = (0.42 - uTilt.y * 0.6) * amt;
  p = vec3(p.x * cos(ay) + p.z * sin(ay), p.y, -p.x * sin(ay) + p.z * cos(ay));
  p = vec3(p.x, p.y * cos(ax) - p.z * sin(ax), p.y * sin(ax) + p.z * cos(ax));
  p.xy += c;
  return p;
}
// 39 写像の線 → 4次元: 帯と、帯を「4つめの軸」へずらした写しを、同じ場所どうし細い光の線で結ぶ。
// 立方体とその写しを頂点どうしで結ぶと、4次元の立方体(超立方体)になる。それと同じ作りを、描いた帯でやる。
// 4つめの軸には、作品を並べる(作品ごとに、4つめの軸の上の位置が違う)。=「描く(2D)→ 奥行き(3D)→ 中身の次元(4D)」の最後の段。
// 4次元の中で回すと、作品どうしが すり抜け、裏返り、形が内と外を入れ替える(3次元には無い動き)。それを3次元へ、さらに画面へ投影する。
// (Ayumu Nagamatsu「円と、座標変換した円の写像の頂点同士を結ぶ、という図形」2016 から。規則は1つ。変わるのは回り方だけ)
// 線の色は、その場所の写真の色(色は落とさない)。光として足すので、重なった所が光る。
vec3 proj4(vec4 p, float D4){ return p.xyz * (D4 / (D4 - p.w)); }
vec4 rot4(vec4 p, float a, float b, float g){
  // xw 面・zw 面・xy 面で回す
  p = vec4(p.x * cos(a) - p.w * sin(a), p.y, p.z, p.x * sin(a) + p.w * cos(a));
  p = vec4(p.x, p.y, p.z * cos(b) - p.w * sin(b), p.z * sin(b) + p.w * cos(b));
  p = vec4(p.x * cos(g) - p.y * sin(g), p.x * sin(g) + p.y * cos(g), p.z, p.w);
  return p;
}
O sMapLine(){
  // 線は間引く(幅方向8本に1本、長さ方向2枚に1枚)。全部引くと、重なって白く飛ぶ。
  if ((gIv % 8) != 3 || (gIu % 2) != 0) return dotAt(gC0, vec2(0.0), vec3(0.0), 0.0, 0.0);
  vec2 c = uView * 0.5;
  float S = max(uView.x, uView.y) * 0.5;
  float t = uTime * 0.28 + uK * 0.002;
  float nwk = uNWk > 0.5 ? uNWk : 27.0;
  float wk = (gR2.w / max(nwk - 1.0, 1.0)) - 0.5; // 作品の、4つめの軸の上の位置
  vec2 xy = (gC0.xy - c) / S;
  vec4 p0 = vec4(xy, -0.22, wk * 0.9 - 0.35);
  vec4 p1 = vec4(xy * 0.62, 0.22, wk * 0.9 + 0.35);
  float a = t * 0.9 + uTilt.x * 1.2, b = t * 0.63 + 0.7 - uTilt.y * 1.0, g = t * 0.21;
  vec3 A3 = proj4(rot4(p0, a, b, g), 2.4);
  vec3 B3 = proj4(rot4(p1, a, b, g), 2.4);
  vec3 A = viewRot(vec3(c + A3.xy * S, A3.z * S), c, 0.6);
  vec3 B = viewRot(vec3(c + B3.xy * S, B3.z * S), c, 0.6);
  vec3 P = mix(A, B, aQ.x * 0.5 + 0.5);
  vec2 d = B.xy - A.xy; float L = length(d); d = L > 1e-3 ? d / L : vec2(1.0, 0.0);
  O o = base();
  o.centre = (A + B) * 0.5;
  o.corner = P + vec3(vec2(-d.y, d.x) * 0.55 * aQ.y, 0.0);
  o.col = (photo(gR2.w, gUVp) * 0.2 + 0.012) * smoothstep(0.0, 1.8, uPartT); // 4D のパートの入り: 暗闇から線が現れる
  o.tex = 0.0; o.alpha = 0.0; o.shape = vec2(L * 0.5, 0.55);
  return o;
}
// 40 増える帯 → 空間: 帯が、時間差のついた何本かの帯に分かれる(それぞれ別の作品)。
// 分かれた帯の間は、はじめは平面の上の すき間。それが奥行きになり、視点が回って、帯の束が立体だったと分かる。
O sEcho(){
  const int K = 4;
  int k = gIv / (NVi / K);
  float lv = (float(gIv - k * (NVi / K)) + 0.5 + aQ.y * 0.5) / float(NVi / K) - 0.5;
  float kc = float(k) - float(K - 1) * 0.5;
  int lag = k * 5;
  int jk = gJ - lag; jk = jk < 0 ? jk + Mi : jk;
  int jk2 = jk + 1 == Mi ? 0 : jk + 1;
  vec4 r = texelFetch(uPath, ivec2(jk, 0), 0);
  vec4 r2 = texelFetch(uPath, ivec2(jk2, 0), 0);
  float okk = texelFetch(uPath, ivec2(jk, 1), 0).w;
  if (okk < 0.5) { r = vec4(gP, gT); r2 = r; }
  float fu = gFr + aQ.x * 0.25;
  vec2 Pp = mix(r.xy, r2.xy, clamp(fu, 0.0, 1.0) * step(distance(r.xy, r2.xy), uDp * 1.6));
  vec2 Tp = normalize(mix(r.zw, r2.zw, fu) + vec2(1e-5, 0.0));
  vec2 Np = vec2(-Tp.y, Tp.x);
  float breathe = 0.5 + 0.5 * sin(uTime * 0.31);
  // 3D のパートの入り: 平らに並んだ4本が、ゆっくり奥行きへ起き上がる。そのあとは呼吸する。
  float deep = smoothstep(0.3, 2.6, uPartT) * mix(0.55, 1.0, breathe) * step(0.5, uPart);
  vec2 c = uView * 0.5;
  vec3 X = vec3(Pp + Np * (lv * uW * 0.34 + kc * uW * mix(0.42, 0.75, breathe)), 0.0);
  X.z = kc * uW * 3.2 * deep - gHd * uW * 26.0 * deep;
  X = viewRot(X, c, deep);
  O o = base();
  o.corner = X;
  o.centre = viewRot(vec3(Pp + Np * kc * uW * mix(0.42, 0.75, breathe), kc * uW * 3.2 * deep - gHd * uW * 26.0 * deep), c, deep);
  float nwk = uNWk > 0.5 ? uNWk : 27.0;
  o.work = mod(gR2.w + float(k) * 7.0, nwk);
  o.uv = vec2(gUVs.x, lv + 0.5);
  o.line = 1.0;
  o.lit = 1.0 - 0.25 * deep * gHd;
  return o;
}

// 41 4次元のドーナツ(クリフォードトーラス): 帯の面を、4次元の球の上の平らなドーナツへ移す。
// 4次元で回して、立体射影で3次元へ落とすと、ドーナツが内と外を入れ替えながら裏返り続ける(3次元の物には無い動き)。
// 面には作品の写真を貼る(長さ方向に作品が並ぶ)。面の四隅を、それぞれの位置で計算するので、すき間なく1枚の面になる。
vec4 clifford(float u, float v){ return vec4(cos(u), sin(u), cos(v), sin(v)) * 0.70710678; }
vec3 stereo(vec4 p){ return p.xyz / max(1.0 - p.w, 0.22); }
O sClifford(){
  vec2 c = uView * 0.5;
  float S = min(uView.x, uView.y) * 0.5;
  float t = uTime * 0.22 + uK * 0.002;
  float a = t + uTilt.x * 1.1, b = t * 0.71 + 0.6 - uTilt.y * 0.9, g = t * 0.13;
  float uC = (float(gIu) + 0.5 + aQ.x * 0.5) / float(${NU}) * 6.2831853;
  float vC = (float(gIv) + 0.5 + aQ.y * 0.5) / float(NVi) * 6.2831853;
  float uM = (float(gIu) + 0.5) / float(${NU}) * 6.2831853;
  float vM = (float(gIv) + 0.5) / float(NVi) * 6.2831853;
  // 立体射影だと、極に近づいた所が画面いっぱいに膨らむ。ドーナツは遠近の射影(視点を4つめの軸の 1.7 に置く)で落とす。
  vec3 P = proj4(rot4(clifford(uC, vC), a, b, g), 1.7);
  vec3 M = proj4(rot4(clifford(uM, vM), a, b, g), 1.7);
  O o = base();
  o.corner = viewRot(vec3(c + P.xy * S, P.z * S), c, 0.35);
  o.centre = viewRot(vec3(c + M.xy * S, M.z * S), c, 0.35);
  float nwk = uNWk > 0.5 ? uNWk : 27.0;
  float fu = uC / 6.2831853 * nwk;
  o.work = mod(floor((uM / 6.2831853) * nwk), nwk);
  o.uv = vec2(fu - floor((uM / 6.2831853) * nwk), vC / 6.2831853);
  // 遠い所(射影で小さくなる所)ほど暗く
  o.lit = clamp(0.55 + 0.45 * (1.0 - length(M) / 4.0), 0.35, 1.1);
  o.gate = 1.0; // 描いた跡の長さに関わらず、面の全部を出す(この形は、跡ではなく4次元の式で決まる)
  return o;
}
// 42 ホップ・ファイブレーション: 4次元の球を、互いにくぐり合う円(ファイバー)の束としてほどく。
// 円の1本1本は、2次元の球の上の1点に対応する(ここでは緯度4段 × 経度16、計64本。帯の幅の64枚が、そのまま64本の円になる)。
// 4次元で回すと、円の束が流れて、入れ子のドーナツが ほどけたり締まったりする。線は光として足し、色は作品の写真から取る。
vec4 hopf(vec3 n, float t){
  float k = inversesqrt(max(2.0 * (1.0 + n.z), 1e-4));
  return k * vec4((1.0 + n.z) * cos(t), n.x * sin(t) - n.y * cos(t), n.x * cos(t) + n.y * sin(t), (1.0 + n.z) * sin(t));
}
O sHopf(){
  vec2 c = uView * 0.5;
  float S = min(uView.x, uView.y) * 0.16;
  float tm = uTime * 0.2 + uK * 0.002;
  float a = tm + uTilt.x * 1.1, b = tm * 0.67 + 0.4 - uTilt.y * 0.9, g = tm * 0.11;
  int ring = gIv / 16, lon = gIv - ring * 16;
  float lat = mix(-0.75, 0.95, (float(ring) + 0.5) / 4.0) + sin(uTime * 0.17 + float(ring)) * 0.08;
  float ph = (float(lon) + 0.5) / 16.0 * 6.2831853 + float(ring) * 0.4;
  vec3 n = vec3(cos(lat) * cos(ph), cos(lat) * sin(ph), sin(lat));
  float t0 = float(gIu) / float(${NU}) * 6.2831853;
  float t1 = float(gIu + 1) / float(${NU}) * 6.2831853;
  vec4 h0 = rot4(hopf(n, t0).yzwx, a, b, g), h1 = rot4(hopf(n, t1).yzwx, a, b, g);
  vec3 A3 = stereo(h0), B3 = stereo(h1);
  vec3 A = viewRot(vec3(c + A3.xy * S, A3.z * S), c, 0.35);
  vec3 B = viewRot(vec3(c + B3.xy * S, B3.z * S), c, 0.35);
  vec3 P = mix(A, B, aQ.x * 0.5 + 0.5);
  vec2 d = B.xy - A.xy; float L = length(d); d = L > 1e-3 ? d / L : vec2(1.0, 0.0);
  O o = base();
  o.centre = (A + B) * 0.5;
  o.corner = P + vec3(vec2(-d.y, d.x) * 0.6 * aQ.y, 0.0);
  float nwk = uNWk > 0.5 ? uNWk : 27.0;
  vec3 pc = photo(mod(float(gIv) * 5.0, nwk), vec2(t0 / 6.2831853, (float(ring) + 0.5) / 4.0));
  o.col = (pc * 0.55 + 0.03) * smoothstep(0.0, 1.8, uPartT);
  o.tex = 0.0; o.alpha = 0.0; o.shape = vec2(L * 0.5, 0.6);
  o.gate = 1.0;
  return o;
}

// 43 光の円錐(時空の光円錐): 描いた跡の点を「いつ・どこで起きた出来事」とみなし、そこから広がる光を、時間を奥行きにして描く。
// 時間を1つの軸にすると、広がる円は円錐になる(相対論の時空図と同じ作り)。点は描いた順に生まれ続け、円錐は育ちながら薄れて消える。
// 柔らかい光の円錐(zach lieberman)を元にした。色は、その点の作品の写真から取る。
O sCone(){
  const int NC = 40, NR = 32;
  int k = gIu / NR, ir = gIu - k * NR;
  float cnt = min(uK, Mf);
  float an = (float(k) + 0.5) / float(NC);
  int j = int(mod(uK - 1.0 - floor(an * max(cnt - 1.0, 0.0)), Mf));
  vec4 r0 = texelFetch(uPath, ivec2(j, 0), 0);
  float ok = texelFetch(uPath, ivec2(j, 1), 0).w;
  float wk = texelFetch(uPath, ivec2(j, 2), 0).w;
  if (ok < 0.5 || cnt < 2.0) return dotAt(gC0, vec2(0.0), vec3(0.0), 0.0, 0.0);
  float S = min(uView.x, uView.y);
  // 円錐の育ち(0 = 生まれた瞬間、1 = 消える)。描いた順に、ずれて生まれる。
  float g = fract(uTime * 0.07 + an * 1.0 + h1 * 0.0);
  float R = S * 0.62 * g, H = S * 0.9 * g;
  vec2 c = uView * 0.5;
  float rho = (float(ir) + 0.5 + aQ.x * 0.5) / float(NR);
  float rhoC = (float(ir) + 0.5) / float(NR);
  float ph = (float(gIv) + 0.5 + aQ.y * 0.5) / float(NVi) * 6.2831853;
  float phC = (float(gIv) + 0.5) / float(NVi) * 6.2831853;
  // 頂点(出来事)は奥(過去)、縁(いま)は手前の面
  vec3 P = vec3(r0.xy + vec2(cos(ph), sin(ph)) * R * rho, -H * (1.0 - rho));
  vec3 M = vec3(r0.xy + vec2(cos(phC), sin(phC)) * R * rhoC, -H * (1.0 - rhoC));
  float amt = 0.9;
  O o = base();
  o.corner = viewRot(P, c, amt);
  o.centre = viewRot(M, c, amt);
  vec3 pc = photo(wk, vec2(phC / 6.2831853, rhoC));
  // 柔らかさ: 縁ほど明るく、育つほど薄れる。頂点のまわりは淡く。
  float soft = smoothstep(0.0, 0.12, g) * pow(1.0 - g, 1.6) * (0.25 + 0.75 * rhoC * rhoC);
  o.col = (pc * 0.3 + 0.01) * soft * smoothstep(0.0, 1.8, uPartT);
  o.tex = 0.0; o.alpha = 0.0;
  o.gate = 1.0;
  return o;
}
// 44 4次元の立方体(超立方体): 24枚の正方形の面に、作品の写真を細かい升目で貼る。
// 4次元で回すと、内側の立方体が外へ裏返って出てくる。升目の すき間から、奥の面が透けて見える。
O sTess(){
  const int G = 58;
  int f = gI / (G * G), q = gI - f * G * G;
  if (f >= 24) return dotAt(gC0, vec2(0.0), vec3(0.0), 0.0, 0.0);
  int iu = q / G, iv = q - iu * G;
  int pr = f / 4, sg = f - pr * 4;
  // 自由に動く2軸(6通り)と、固定する2軸の符号(4通り)
  ivec2 ax = pr == 0 ? ivec2(0, 1) : pr == 1 ? ivec2(0, 2) : pr == 2 ? ivec2(0, 3) : pr == 3 ? ivec2(1, 2) : pr == 4 ? ivec2(1, 3) : ivec2(2, 3);
  ivec2 fx = pr == 0 ? ivec2(2, 3) : pr == 1 ? ivec2(1, 3) : pr == 2 ? ivec2(1, 2) : pr == 3 ? ivec2(0, 3) : pr == 4 ? ivec2(0, 2) : ivec2(0, 1);
  float shrink = 0.78;
  float s0 = ((float(iu) + 0.5) / float(G)) * 2.0 - 1.0, t0 = ((float(iv) + 0.5) / float(G)) * 2.0 - 1.0;
  float sv = s0 + aQ.x * shrink / float(G), tv = t0 + aQ.y * shrink / float(G);
  vec4 pv = vec4(0.0), pm = vec4(0.0);
  pv[ax.x] = sv; pv[ax.y] = tv; pm[ax.x] = s0; pm[ax.y] = t0;
  float fa = (sg & 1) == 1 ? 1.0 : -1.0, fb = (sg & 2) == 2 ? 1.0 : -1.0;
  pv[fx.x] = fa; pv[fx.y] = fb; pm[fx.x] = fa; pm[fx.y] = fb;
  pv *= 0.5; pm *= 0.5;
  float tm = uTime * 0.24 + uK * 0.002;
  // 4次元の回し(xw 面)を速めにして、内側の立方体が外へ出てくるのが数秒で見えるようにする
  float a = tm * 1.7 + uTilt.x * 1.1, b = tm * 0.69 + 0.5 - uTilt.y * 0.9, g = tm * 0.17;
  vec3 P = proj4(rot4(pv, a, b, g), 2.2);
  vec3 M = proj4(rot4(pm, a, b, g), 2.2);
  vec2 c = uView * 0.5;
  float S = min(uView.x, uView.y) * 0.4;
  O o = base();
  o.corner = viewRot(vec3(c + P.xy * S, P.z * S), c, 0.45);
  o.centre = viewRot(vec3(c + M.xy * S, M.z * S), c, 0.45);
  float nwk = uNWk > 0.5 ? uNWk : 27.0;
  o.work = mod(float(f) * 5.0 + 3.0, nwk);
  o.uv = vec2(s0 * 0.5 + 0.5, t0 * 0.5 + 0.5);
  o.lit = clamp(0.5 + 0.5 * (1.0 - length(M) / 3.0), 0.4, 1.1);
  o.gate = 1.0;
  return o;
}

// 45 箱の街(帯ではない): 画面いっぱいの床に、写真を升目に分けた箱が立ち並ぶ。箱の高さは写真の明るさ。
// 本人(2026-11-27):「入りが帯なのは固定。そこから先は全部違ってもいい」。指で押した所は、箱が沈んで波が広がる。
O sCity(){
  const int GX = 40, GY = 86, NB = GX * GY;
  int b = gI / 5, f = gI - b * 5;
  if (b >= NB) return dotAt(gC0, vec2(0.0), vec3(0.0), 0.0, 1.0);
  int by = b / GX, bx = b - by * GX;
  vec2 cell = uView / vec2(float(GX), float(GY));
  vec2 cen = (vec2(float(bx), float(by)) + 0.5) * cell;
  float nwk = uNWk > 0.5 ? uNWk : 27.0;
  float wk = mod(floor(uK / 120.0), nwk);
  vec2 uvC = cen / uView;
  // 写真は縦長の画面に合わせて、真ん中を切り出す
  vec3 pc = photo(wk, uvC);
  float l = dot(pc, vec3(0.2126, 0.7152, 0.0722));
  float H = min(uView.x, uView.y) * 0.18; // 高すぎると写真が読めない(0.32 で確認)
  float dpen = distance(cen, uPen.xy);
  float press = uPen.z * exp(-dpen * dpen / (uW * uW * 30.0));
  float wave = sin(dpen * 0.045 - uTime * 3.0) * uPen.z * exp(-dpen / (uW * 14.0)) * 0.25;
  float h = H * (0.06 + 0.94 * pow(l, 1.4)) * (1.0 - 0.8 * press + wave) * smoothstep(0.0, 1.6, uPartT);
  vec2 hs = cell * 0.5 * 0.86;
  vec3 P, M; float lit;
  if (f == 0) { P = vec3(cen + aQ * hs, h); M = vec3(cen, h); lit = 1.0; }
  else {
    // 横の面: f = 1..4 は、右・左・下・上
    vec2 nd = f == 1 ? vec2(1.0, 0.0) : f == 2 ? vec2(-1.0, 0.0) : f == 3 ? vec2(0.0, 1.0) : vec2(0.0, -1.0);
    vec2 td = vec2(-nd.y, nd.x);
    vec2 e = cen + nd * hs;
    P = vec3(e + td * hs * aQ.x, (aQ.y * 0.5 + 0.5) * h);
    M = vec3(e, h * 0.5);
    lit = f == 1 ? 0.62 : f == 2 ? 0.42 : f == 3 ? 0.78 : 0.5;
  }
  vec2 c = uView * 0.5;
  O o = base();
  o.corner = viewRot(P, c, 1.0);
  o.centre = viewRot(M, c, 1.0);
  o.work = wk;
  o.uv = f == 0 ? (P.xy / uView) : uvC;
  o.lit = lit * (0.85 + 0.25 * smoothstep(0.0, H, h));
  o.gate = 1.0;
  return o;
}

// 46 粒の竜巻(帯ではない): 傾いた床の上に、粒の円盤が並ぶ。粒が渦を巻いて立ち上がり、ふくらんだ塔になり、また円盤に崩れる。
// 塔の中には、粒どうしを結ぶ細い線が走る。床には、塔の影が伸びる。
// 元: Dan (@_nadiaru_) の TouchDesigner のパーティクル(2026-11-27)。本人:「クールでカッコよくて圧倒的な驚きがあれば、作品はあまり見えなくていい」。
const int TK = 9;
vec2 towerXZ(int k, float S){
  int gx = k % 3, gz = k / 3;
  vec2 j = vec2(hsh(uint(k) * 31U + 5U), hsh(uint(k) * 17U + 11U)) - 0.5;
  return (vec2(float(gx), float(gz)) - 1.0) * S * 0.62 + j * S * 0.16;
}
float towerH(int k, float Hb){ return Hb * (0.62 + 0.38 * hsh(uint(k) * 13U + 3U)); }
float riseOf(int k){
  float ph = fract(uTime / 8.0 + hsh(uint(k) * 7U + 1U) * 0.12);
  return smoothstep(0.06, 0.42, ph) * (1.0 - smoothstep(0.72, 0.97, ph));
}
vec3 grainW(int i, float S, float R, float Hb, out float tt, out float lift, out float side){
  int k = i % TK;
  float a1 = hsh(uint(i) * 2U + 101U), a2 = hsh(uint(i) * 5U + 7U), a3 = hsh(uint(i) * 11U + 3U);
  vec2 cp = towerXZ(k, S);
  float th = a1 * 6.2831853;
  // 床の円盤(真ん中に穴のあるドーナツ)
  float rd = R * (0.3 + 0.7 * sqrt(a2));
  vec3 pd = vec3(cp.x + cos(th) * rd, a3 * 3.0, cp.y + sin(th) * rd);
  // 塔: 高さ t、ふくらみが段になって重なる。上ほど速く回る
  tt = a2;
  float Hk = towerH(k, Hb);
  float y = tt * Hk;
  float ang = th + uTime * (0.5 + 1.1 * tt) + float(k);
  float rt = R * 0.5 * (0.72 + 0.34 * sin(y * 0.055 + float(k) * 1.7)) * (0.8 + 0.4 * a3);
  vec3 pt = vec3(cp.x + cos(ang) * rt, y, cp.y + sin(ang) * rt);
  float rise = riseOf(k);
  lift = smoothstep(tt * 0.45, tt * 0.45 + 0.55, rise);
  // 立ち上がる途中は、渦の外へ少し ふくらむ
  vec3 p = mix(pd, pt, lift);
  float mid = lift * (1.0 - lift) * 4.0;
  p.xz += vec2(cos(ang + 1.3), sin(ang + 1.3)) * R * 0.25 * mid;
  side = cos(ang - 2.4); // 光の来る向きとの角度(塔の側面の明暗)
  return p;
}
vec3 camW(vec3 p, vec2 c, float Y0){
  float ya = 0.55 + sin(uTime * 0.07) * 0.35 + uTilt.x * 0.9;
  float pi = 0.62 - uTilt.y * 0.35;
  float x1 = p.x * cos(ya) + p.z * sin(ya), z1 = -p.x * sin(ya) + p.z * cos(ya);
  float y2 = p.y * cos(pi) - z1 * sin(pi), z2 = p.y * sin(pi) + z1 * cos(pi);
  return vec3(c.x + x1, c.y + Y0 - y2, z2);
}
O sTwister(){
  const int NF = 64;
  int NG = ${NU} * NVi - NF * NF;
  vec2 c = uView * 0.5;
  float S = uView.x * 0.82, R = S * 0.2, Hb = uView.y * 0.42, Y0 = uView.y * 0.12;
  float appear = smoothstep(0.0, 1.0, uPartT);
  vec3 gray = vec3(0.80, 0.81, 0.84);
  if (gI >= NG) {
    // 床: 傾いた灰色の板。塔の影が、光と反対へ伸びる
    int q = gI - NG; int fz = q / NF, fx = q - fz * NF;
    vec2 cell = vec2(float(fx), float(fz)) / float(NF) - 0.5;
    vec2 cc = (vec2(float(fx), float(fz)) + 0.5) / float(NF) - 0.5;
    vec3 P = vec3((cell + (aQ * 0.5 + 0.5) / float(NF)) * S * 2.0, 0.0).xzy;
    vec3 M = vec3(cc * S * 2.0, 0.0).xzy;
    float sh = 0.0;
    vec2 Ld = normalize(vec2(0.75, 0.55));
    for (int k = 0; k < TK; k++) {
      vec2 b0 = towerXZ(k, S);
      float L = towerH(k, Hb) * 1.1 * riseOf(k) + R * 0.2;
      vec2 b1 = b0 + Ld * L;
      vec2 pa = M.xz - b0, ba = b1 - b0;
      float hh = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-3), 0.0, 1.0);
      float d = length(pa - ba * hh);
      sh = max(sh, (1.0 - smoothstep(R * 0.25, R * 0.75, d)) * (0.35 + 0.65 * riseOf(k)));
    }
    O o = base();
    o.corner = camW(P, c, Y0); o.centre = camW(M, c, Y0);
    o.col = vec3(0.30, 0.31, 0.34) * (1.0 - 0.72 * sh) * appear; o.tex = 0.0;
    o.gate = 1.0;
    return o;
  }
  float tt, lift, side;
  vec3 w = grainW(gI, S, R, Hb, tt, lift, side);
  vec3 sp = camW(w, c, Y0);
  float lit = mix(0.85, 0.42 + 0.6 * max(side, 0.0), lift) * (0.9 + 0.2 * h2);
  vec3 col = gray * lit * appear;
  // 粒どうしを結ぶ細い線(塔になっている間だけ)。12粒に1本
  if ((gI % 12) == 5 && lift > 0.3) {
    int j = gI + TK * (37 + int(h3 * 40.0));
    if (j < NG) {
      float t2, l2, s2;
      vec3 w2 = grainW(j, S, R, Hb, t2, l2, s2);
      vec3 sp2 = camW(w2, c, Y0);
      vec2 d = sp2.xy - sp.xy; float Ld = length(d);
      if (Ld > 2.0 && Ld < uView.x * 0.22) {
        O o = ori((sp + sp2) * 0.5, d / Ld, Ld * 0.5, 0.35, gray * 0.16 * lift * appear);
        o.alpha = 0.0; o.gate = 1.0;
        return o;
      }
    }
  }
  O o = dotAt(sp, vec2(1.55), col, 1.0, 1.0);
  o.gate = 1.0;
  return o;
}

// 47 生まれる形(帯ではない、2D): 紙の白の上に、黒い塊が生まれ、ふくらみ、くっつき、分かれ、消える。
// 塊のふちは縦の筋になってにじみ、ところどころ粗い升目に崩れる(1ビットの刷り)。塊は、描いた線の上から生まれる。
// 元: Soy Nando「Spontaneous Generation」(2026-11-27)。
O sSpawn(){
  const int GX = 160, GY = 512;
  int gy = gI / GX, gx = gI - gy * GX;
  vec2 cell = uView / vec2(float(GX), float(GY));
  vec2 p = (vec2(float(gx), float(gy)) + 0.5) * cell;
  float tq = floor(uTime * 12.0) / 12.0; // 12コマ/秒で進む(刷りもののコマ送り)
  float cnt = min(uK, Mf);
  float f = 0.0;
  for (int b = 0; b < 8; b++) {
    float hb = hsh(uint(b) * 977U + 13U), hc = hsh(uint(b) * 331U + 7U);
    float an = (float(b / 2) + 0.5) / 4.0;
    int j = int(mod(uK - 1.0 - floor(an * max(cnt - 1.0, 0.0)), Mf));
    vec4 r0 = texelFetch(uPath, ivec2(j, 0), 0);
    bool ok = texelFetch(uPath, ivec2(j, 1), 0).w > 0.5 && cnt > 2.0;
    vec2 base = ok ? r0.xy : uView * vec2(0.25 + 0.5 * hb, 0.2 + 0.6 * hc);
    // 2つずつ組: 同じ所から生まれて、離れたり くっついたりする
    float sgn = (b % 2 == 0) ? 1.0 : -1.0;
    float life = fract(tq / 7.0 + hb);
    float grow = smoothstep(0.0, 0.25, life) * (1.0 - smoothstep(0.8, 1.0, life));
    vec2 drift = vec2(sin(tq * (0.3 + hb * 0.4) + hc * 6.0), cos(tq * (0.25 + hc * 0.35) + hb * 6.0)) * uView.x * 0.12;
    vec2 split = vec2(cos(hb * 6.28), sin(hb * 6.28)) * sgn * uView.x * 0.07 * (0.5 + 0.5 * sin(tq * 0.6 + hc * 5.0));
    vec2 c = base + drift + split;
    float R = uView.x * (0.07 + 0.07 * hc) * grow;
    vec2 d = (p - c) * vec2(1.0, 1.15);
    f += R * R / (dot(d, d) + 1.0);
  }
  float colH = hsh(uint(gx) * 2654U + uint(tq * 12.0) * 7U);          // 列ごとのゆらぎ(縦の筋)
  float run = hsh(uint(gx) * 131U + uint(gy / 6) * 977U + uint(tq * 12.0));  // 縦に長い ひと続き
  float ink = 0.0;
  if (f > 1.0) {
    ink = 1.0;
    // 塊の中の、ふちに沿った白い輪(縦の筋で描く)
    float ring = abs(fract(f * 1.6) - 0.5);
    if (f < 2.6 && ring < 0.08 && colH > 0.35) ink = 0.0;
  } else if (f > 0.42) {
    // にじみ: 縦の筋。塊に近いほど濃い
    float k = (f - 0.42) / 0.58;
    ink = run < k * k * 0.95 ? 1.0 : 0.0;
  }
  // 粗い升目に崩れる所(1ビットの欠け)
  ivec2 blk = ivec2(gx / 5, gy / 8);
  float bh = hsh(uint(blk.x) * 7919U + uint(blk.y) * 104729U + uint(tq * 4.0) * 31U);
  if (f > 0.3 && f < 1.4 && bh < 0.05) ink = 1.0 - ink;
  vec3 paper = vec3(0.925, 0.918, 0.895), black = vec3(0.06, 0.06, 0.065);
  O o = dotAt(vec3(p, 0.0), cell * 0.5 + 0.05, mix(paper, black, ink), 0.0, 1.0);
  o.gate = 1.0;
  return o;
}

// ================================================================
// 48 展開(本人 2026-11-27:「最初の1カットからどんどん展開されていければ、僕の画像や帯は使わなくていい。もっと自由に」)
// 描いた帯(最初の1カット)から、止まらずに展開していく1本の流れ。表現を並べ替えるのではなく、同じ粒が形を変え続ける。
//   帯 → 墨の線(帯が細くなり、紙が広がる)→ 線が玉になる(しずく)→ 紙が傾いて床になる(2D → 3D)
//   → しずくが円盤になり、渦を巻いて塔になる → 塔の粒が空へ上がり、4次元のドーナツになる(3D → 4D)
//   → ドーナツが入れ子に分かれ、くぐり合う円の束になる → その中へ飛び込む → 線が描き直されて、紙に戻る(4D → 2D)→ また玉になる …
// 時刻は uDev.x(秒)。周が回ると、線の所(1.2秒)から続く。
const int DK = 9;
const vec3 D_INK = vec3(0.05, 0.05, 0.055);
const vec3 D_PAPER = vec3(0.925, 0.918, 0.895);
const vec3 D_GRAY = vec3(0.80, 0.81, 0.84);
float dsm(float a, float b, float t){ return smoothstep(a, b, t); }
vec2 dPath(float age){ int j = int(mod(uK - 1.0 - age, Mf)); return texelFetch(uPath, ivec2(j, 0), 0).xy; }
float dCnt(){ return max(min(uK, Mf), 2.0); }
// しずくの中心: 描いた線を9つに分けた、それぞれの真ん中。紙の上(2D)でだけ、12コマ/秒で ふらふら動く
vec2 dDropC(int k, float tq, float kt){
  vec2 c = dPath((float(k) + 0.5) / float(DK) * (dCnt() - 1.0));
  c += vec2(sin(tq * 0.7 + float(k) * 1.3), cos(tq * 0.55 + float(k) * 2.1)) * uView.x * 0.02 * (1.0 - kt);
  return c;
}
// しずくの大きさ: 線の墨の量から
float dDropR(int k){
  float hk = hsh(uint(k) * 53U + 5U);
  return clamp(sqrt(dCnt() * uDp * 7.0 / (float(DK) * 3.14159)), 14.0, uView.x * 0.1) * (0.75 + 0.55 * hk);
}
float dTowerH(int k){ return uView.y * (0.3 + 0.22 * hsh(uint(k) * 13U + 3U)); }
// 見る位置: kt = 0 で真上から(紙そのもの)、1 で斜め上から(床)。紙の座標(画面の座標)が、そのまま床の座標になる。
vec3 dCam(vec3 p, float kt){
  vec2 c = uView * 0.5;
  float pit = mix(1.5707963, 0.64 - uTilt.y * 0.22, kt);
  float yaw = kt * (0.5 + 0.3 * sin(uTime * 0.06) + uTilt.x * 0.8);
  float zm = mix(1.0, 0.6, kt);
  float Y0 = mix(0.0, uView.y * 0.1, kt);
  float x1 = p.x * cos(yaw) + p.z * sin(yaw), z1 = -p.x * sin(yaw) + p.z * cos(yaw);
  float y2 = p.y * cos(pit) - z1 * sin(pit), z2 = p.y * sin(pit) + z1 * cos(pit);
  return vec3(c.x + x1 * zm, c.y + Y0 - y2 * zm, z2 * zm);
}
struct DP { vec3 c; vec3 e; vec2 hs; float seg; float rnd; vec3 col; float a; };
DP dDot(vec3 c, vec2 hs, float rnd, vec3 col){ DP d; d.c = c; d.e = c; d.hs = hs; d.seg = 0.0; d.rnd = rnd; d.col = col; d.a = 1.0; return d; }
vec3 dCorner(DP d){
  if (d.seg < 0.5) return d.c + vec3(aQ * d.hs, 0.0);
  vec3 m = (d.c + d.e) * 0.5; vec2 dv = d.e.xy - d.c.xy; float L = length(dv); vec2 u = L > 1e-3 ? dv / L : vec2(1.0, 0.0);
  return m + vec3(u * L * 0.5 * aQ.x + vec2(-u.y, u.x) * d.hs.y * aQ.y, (d.e.z - d.c.z) * 0.5 * aQ.x);
}
vec3 dCentre(DP d){ return (d.c + d.e) * 0.5; }
vec2 dShape(DP d){ return d.seg < 0.5 ? d.hs : vec2(max(length(d.e.xy - d.c.xy) * 0.5, 0.3), d.hs.y); }
// この面(粒)の持ちもの
float dvA1, dvA2, dvA3, dvTh, dvRk, dvTt; int dvK; vec2 dvCk; vec2 dvLine; bool dvValid;
DP dLine(){
  vec2 c = uView * 0.5;
  return dDot(dCam(vec3(dvLine.x - c.x, 5.0, dvLine.y - c.y), 0.0), vec2(dvValid ? 1.35 : 0.0), 0.0, D_INK);
}
// しずく(1ビットの刷り): ふちは縦の筋ににじむ。3つに1つのしずくには、目のような白い輪
DP dDrop(float kt){
  vec2 c = uView * 0.5;
  float tq = floor(uTime * 12.0) / 12.0;
  bool halo = dvA3 < 0.16;
  float br = 1.0 + 0.07 * sin(tq * 2.1 + float(dvK) * 1.9);
  float rd = halo ? dvRk * br * (1.0 + 0.4 * dvA2) : dvRk * br * sqrt(dvA2);
  vec2 p = dvCk + vec2(cos(dvTh), sin(dvTh)) * rd;
  vec2 hs = vec2(1.35);
  if (halo) { hs = vec2(0.55, 1.5 + 4.5 * dvA1); p.y += (hsh(uint(gI) * 7U + uint(tq * 12.0)) - 0.5) * 4.0; }
  vec3 col = (dvK % 3 == 0 && !halo && dvA2 > 0.33 && dvA2 < 0.43) ? D_PAPER : D_INK;
  return dDot(dCam(vec3(p.x - c.x, 5.0, p.y - c.y), kt), hs, 0.0, col);
}
// 床の円盤(真ん中に穴): 紙が傾くと、しずくの真ん中が開く
DP dDisc(float t, float kt){
  vec2 c = uView * 0.5;
  float ang = dvTh + max(t - 8.0, 0.0) * 0.4;
  float rd = dvRk * 1.25 * (0.3 + 0.7 * sqrt(dvA2));
  vec3 w = vec3(dvCk.x - c.x + cos(ang) * rd, 3.0 + dvA3 * 4.0, dvCk.y - c.y + sin(ang) * rd);
  return dDot(dCam(w, kt), vec2(1.5), kt, mix(D_INK, D_GRAY * (0.8 + 0.2 * dvA1), kt));
}
float dTowerAng(float t){ return dvTh + max(t - 8.0, 0.0) * 0.4 + max(t - 11.5, 0.0) * 1.1 * dvTt; }
// 塔: 段にふくらんだ渦。上ほど速く回る。光は1灯
DP dTower(float t, float kt){
  vec2 c = uView * 0.5;
  float y = dvTt * dTowerH(dvK);
  float ang = dTowerAng(t);
  float rt = dvRk * 0.95 * (0.72 + 0.34 * sin(y * 0.05 + float(dvK) * 1.7)) * (0.8 + 0.4 * dvA3);
  vec3 w = vec3(dvCk.x - c.x + cos(ang) * rt, y, dvCk.y - c.y + sin(ang) * rt);
  vec3 col = D_GRAY * (0.42 + 0.6 * max(cos(ang - 2.4), 0.0)) * (0.9 + 0.2 * dvA1);
  return dDot(dCam(w, kt), vec2(1.5), 1.0, col);
}
// 4次元: 塔の輪の1本1本が、4次元の球の上の円(ホップ・ファイバー)になる。
// はじめは全部が赤道の上(= クリフォードトーラス、ドーナツ)。29秒から、高さごとに緯度が分かれて、入れ子のドーナツ → くぐり合う円の束。
// 37秒から、その中へ飛び込む。線は光として足す
DP d4D(float t){
  vec2 c = uView * 0.5;
  int lvl = min(6, int(dvTt * 7.0));
  float sp = dsm(29.0, 32.0, t);
  float lat = mix(0.0, mix(-0.85, 0.9, float(lvl) / 6.0), sp);
  float lon = mix(6.2831853 * float(dvK * 7 + lvl) / 63.0, 6.2831853 * float(dvK) / 9.0 + float(lvl) * 0.45, sp);
  vec3 nb = vec3(cos(lat) * cos(lon), cos(lat) * sin(lon), sin(lat));
  float t4 = max(t - 19.0, 0.0);
  float ra = t4 * 0.3 + uTilt.x * 1.2, rb = t4 * 0.19 + 0.4 - uTilt.y, rg = t4 * 0.08;
  float ang = dTowerAng(t);
  float S4 = min(uView.x, uView.y) * 0.17;
  vec3 P = stereo(rot4(hopf(nb, ang).yzwx, ra, rb, rg));
  vec3 Q = stereo(rot4(hopf(nb, ang + 0.06).yzwx, ra, rb, rg));
  float dv = dsm(37.0, 41.0, t);
  float zd = mix(1.0, 5.5, dv * dv);
  DP d;
  d.c = vec3(c + P.xy * S4 * zd, clamp(P.z * S4 * zd + dv * 500.0, -1400.0, 1000.0));
  d.e = vec3(c + Q.xy * S4 * zd, clamp(Q.z * S4 * zd + dv * 500.0, -1400.0, 1000.0));
  d.hs = vec2(0.0, 0.45); d.seg = 1.0; d.rnd = 0.0; d.a = 0.0;
  d.col = mix(vec3(1.0, 0.88, 0.76), vec3(0.74, 0.86, 1.0), float(lvl) / 6.0) * 0.075 * mix(1.0, 0.6, dv);
  return d;
}
// 指で押すと、その場所の粒が よける(墨が分かれる、塔の粒が割れる、光の線が曲がる)
O dPush(O o){
  vec2 d = o.centre.xy - uPen.xy; float L = length(d);
  float f = uPen.z * 46.0 * exp(-L * L / 4900.0);
  vec2 v = L > 1e-3 ? d / L * f : vec2(0.0);
  o.corner.xy += v; o.centre.xy += v;
  return o;
}
// 紙(= 床)。4096枚の升目。はじめは、描いた線から外へ広がる
O dPaper(float t, float first, int NG){
  vec2 c = uView * 0.5;
  if (first > 0.5 && t < 0.6) { O o = base(); o.corner = mix(gX0, gC0, dsm(0.0, 0.6, t)); return o; }
  int qi = gI - NG; int fz = qi / 64, fx = qi - fz * 64;
  float SQ = max(uView.x, uView.y) * 1.12;
  vec2 cc = ((vec2(float(fx), float(fz)) + 0.5) / 64.0 - 0.5) * SQ;
  vec2 cv = ((vec2(float(fx), float(fz)) + 0.5 + aQ * 0.51) / 64.0 - 0.5) * SQ;
  float cnt = dCnt();
  float dl = 1e9;
  for (int i = 0; i < 16; i++) dl = min(dl, distance(dPath((float(i) + 0.5) / 16.0 * (cnt - 1.0)) - c, cc));
  float maxD = length(uView);
  float f1 = first > 0.5 ? dsm(0.0, 1.0, (t - 0.35) * 1.4 - dl / (maxD * 0.5)) : 1.0;
  float f2 = dsm(0.0, 1.0, (t - 42.8) * 1.4 - dl / (maxD * 0.5));
  float fall = dsm(19.0, 23.0, t);
  float vis = t < 23.0 ? f1 : (t < 42.8 ? 0.0 : f2);
  float kc = t < 23.0 ? dsm(8.0, 10.5, t) : 0.0;
  float y = t < 23.0 ? -fall * uView.y * 1.5 : 0.0;
  // 塔の影: 光と反対へ伸びる
  float sh = 0.0;
  if (kc > 0.001) {
    vec2 Ld = normalize(vec2(0.75, 0.55));
    float rise = dsm(11.5, 15.0, t) * (1.0 - dsm(19.0, 21.0, t));
    for (int k = 0; k < DK; k++) {
      vec2 b0 = dDropC(k, 0.0, 1.0) - c;
      float R = dDropR(k);
      vec2 b1 = b0 + Ld * (dTowerH(k) * 1.1 * rise + R * 0.3);
      vec2 pa = cc - b0, ba = b1 - b0;
      float hh = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-3), 0.0, 1.0);
      sh = max(sh, (1.0 - smoothstep(R * 0.4, R * 1.1, length(pa - ba * hh))) * (0.3 + 0.7 * rise));
    }
  }
  vec3 Pc = dCam(vec3(cc.x, y, cc.y), kc);
  vec3 Pv = dCam(vec3(cv.x, y, cv.y), kc);
  O o = base();
  o.centre = Pc; o.corner = Pc + (Pv - Pc) * vis;
  o.col = mix(D_PAPER, vec3(0.30, 0.31, 0.34) * (1.0 - 0.7 * sh), kc) * (1.0 - fall * step(t, 23.0));
  o.tex = 0.0; o.gate = 1.0; o.round = 0.0; o.shape = vec2(1.0);
  return o;
}
O sDev(){
  float t = uDev.x;
  float first = 1.0 - step(0.5, uDev.y);
  int NG = ${NU} * NVi - 4096;
  if (gI >= NG) return dPaper(t, first, NG);
  float cnt = dCnt();
  dvValid = gR1.w > 0.5 && gAge < cnt;
  float q = dvValid ? gAge / cnt : h1;
  dvK = min(DK - 1, int(q * float(DK)));
  dvA1 = hsh(uint(gI) * 2U + 101U); dvA2 = hsh(uint(gI) * 5U + 7U); dvA3 = hsh(uint(gI) * 11U + 3U);
  dvTh = dvA1 * 6.2831853; dvTt = dvA2;
  float kt = dsm(8.0, 10.5, t);
  dvCk = dDropC(dvK, floor(uTime * 12.0) / 12.0, kt);
  dvRk = dDropR(dvK);
  dvLine = gP + gT * (gFr - 0.5) * uDp + gN * gV * 5.2;
  if (t < 1.2) {
    // 帯 → 墨の線: 帯の面のまま細くなり、写真が墨になる
    float b01 = dsm(0.0, 1.2, t);
    DP L = dLine();
    O o = base();
    o.corner = mix(gX0, dCorner(L), b01); o.centre = mix(gC0, L.c, b01);
    o.tex = 1.0 - dsm(0.0, 0.8, t); o.col = D_INK; o.shape = L.hs; o.round = 0.0;
    float sc0 = gR1.w * smoothstep(0.0, 0.16, uTime - gR1.z) * smoothstep(Mf, Mf - 22.0, gAge);
    o.gate = mix(sc0, dvValid ? 1.0 : 0.0, b01);
    return dPush(o);
  }
  DP A, B; float b = 0.0;
  if (t < 2.2) { A = dLine(); B = A; }
  else if (t < 4.2) { A = dLine(); B = dDrop(0.0); b = dsm(2.2 + dvA2 * 0.7, 3.5 + dvA2 * 0.7, t); }
  else if (t < 8.0) { A = dDrop(0.0); B = A; }
  else if (t < 10.5) { A = dDrop(kt); B = dDisc(t, kt); b = dsm(8.0, 10.5, t); }
  else if (t < 11.5) { A = dDisc(t, kt); B = A; }
  else if (t < 15.0) { A = dDisc(t, kt); B = dTower(t, kt); b = dsm(dvTt * 0.45, dvTt * 0.45 + 0.55, dsm(11.5, 15.0, t)); }
  else if (t < 19.0) { A = dTower(t, kt); B = A; }
  else if (t < 23.5) { A = dTower(t, kt); B = d4D(t); b = dsm(19.0 + (1.0 - dvTt) * 1.6, 21.6 + (1.0 - dvTt) * 1.6, t); } // 上の粒から先に、空へ
  else if (t < 42.0) { A = d4D(t); B = A; }
  else { A = d4D(t); B = dLine(); b = dsm(42.0 + q * 1.8, 44.4 + q * 1.8, t); } // 描いた順に、線が描き直される
  O o = base();
  o.corner = mix(dCorner(A), dCorner(B), b);
  o.centre = mix(dCentre(A), dCentre(B), b);
  // 重なる(不透明)⇔ 光として足す、が入れ替わる所では、明るさを いったん落としてから入れ替える
  if (A.a != B.a) o.col = b < 0.5 ? A.col * (1.0 - b * 1.6) : B.col * (0.2 + 1.6 * (b - 0.5));
  else o.col = mix(A.col, B.col, b);
  o.alpha = b < 0.5 ? A.a : B.a;
  o.tex = 0.0;
  o.shape = mix(dShape(A), dShape(B), b);
  o.round = mix(A.rnd, B.rnd, b);
  o.gate = 1.0;
  return dPush(o);
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
  if (id == 31) return sObjIri();
  if (id == 32) return sObjStick();
  if (id == 33) return sObjWrap();
  if (id == 34) return sGlass();
  if (id == 35) return sGlassLine();
  if (id == 36) return sGlassClear();
  if (id == 37) return sObjLine();
  if (id == 38) return sObjMorph();
  if (id == 39) return sMapLine();
  if (id == 40) return sEcho();
  if (id == 41) return sClifford();
  if (id == 42) return sHopf();
  if (id == 43) return sCone();
  if (id == 44) return sTess();
  if (id == 45) return sCity();
  if (id == 46) return sTwister();
  if (id == 47) return sSpawn();
  if (id == 48) return sDev();
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
  // ガラスの立体(34)との行き来は、「変形」にする: 変わり具合を 面ごとではなく 四隅ごとに決め、帯に沿って なめらかに進める。
  // 面が ばらばらにならず、帯が ひと続きのまま 曲がって、立体になる(本人 2026-11-25:「帯から変形とかがいいな」)。
  if (uDeep > 0.5 && (int(uFrom + 0.5) == 34 || int(uTo + 0.5) == 34) && sty != 2) {
    float hc = clamp((gAge - (gFr - 0.5) - aQ.x * 0.25) / max(1.0, min(uK, Mf)), 0.0, 1.0); // 0 = ペン先、1 = いちばん古い所
    w = smoothstep(hc * 0.55, hc * 0.55 + 0.45, x);
    bulgeK = 0.0; keep = 1.0;
  }

  // 帯の面: 四隅を、それぞれの位置での芯から作る(となりの面と、ぴったり つながる)。
  // 折り目(試し): 折り目の線をまたぐあたりの面は、2倍に広げて となりと重ねる(線で切りそろえたときの すき間を埋める)。
  float E = 1.0;
  gFold = 0.0; gF4 = vec4(0.0, 0.0, 0.0, 1e6);
  if (uFold > 0.5 && uSharp > 0.5 && gR1.w > 0.5 && gR1.y > 0.0 && (int(uFrom + 0.5) == 1 || int(uTo + 0.5) == 1)) {
    gF4 = texelFetch(uPath, ivec2(gJ, 4), 0);
    if (gF4.w < 1e5) {
      gFold = 1.0;
      vec4 c0 = texelFetch(uPath, ivec2(gJ, 3), 0);
      // 折り目の向き(角度)と長さは、1つの数に詰めてある。
      float lq = floor(gF4.z / 100.0 + 0.5);
      gF4.z -= 100.0 * lq; gFlen = lq / 50.0 * uW;
      vec2 ctr = c0.xy + c0.zw * (gFr - 0.5) * uDp + vec2(-c0.w, c0.z) * gV * uW * cos(gR1.x);
      if (abs(dot(ctr - gF4.xy, vec2(cos(gF4.z), sin(gF4.z)))) < 0.1 * uW) E = 2.0;
    }
  }
  gTq = (gFr - 0.5) + aQ.x * 0.25 * E;
  gVc = gV + aQ.y * (0.5 / float(NVi)) * E;
  int jn = gTq < 0.0 ? (gJ == 0 ? Mi - 1 : gJ - 1) : (gJ + 1 == Mi ? 0 : gJ + 1);
  vec4 q0 = texelFetch(uPath, ivec2(jn, 0), 0);
  float seam = gTq < 0.0 ? step(Mf - 1.5, gAge) : step(gAge, 0.5);
  vec4 q1 = texelFetch(uPath, ivec2(jn, 1), 0);
  float ok = gR1.w * q1.w * step(distance(q0.xy, gP), uDp * 1.6) * (1.0 - seam);
  gPhiQ = ok > 0.5 ? mix(gR1.x, q1.x, abs(gTq)) : gR1.x;
  gPhiN = q1.x; gJn = jn; gOk = ok;
  gYq = ok > 0.5 ? mix(gR1.y, q1.y, abs(gTq)) : gR1.y;
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
  // 帯に沿って貼る位置(立体の紙の確認用、?map=strip)。写真の横を帯の長さ方向に、縦を幅方向に合わせ、作品1つぶんの長さに1枚を収める。
  // (gUVb は「窓」: 写真は画面に対してまっすぐ置いてあり、帯はそれを帯の形に切り抜いている。)
  {
    float sm = mod(float(gJ), SEGf);
    vec2 q = vec2((sm + 0.5 + gTq) / SEGf - 0.5, gVc);
    int j0 = gJ - int(sm);
    if (texelFetch(uPath, ivec2(j0 < 0 ? j0 + Mi : j0, 0), 0).z < 0.0) q = -q; // 左向きに描いた作品は、逆さにならないよう半回転
    float A = SEGf * uDp / uW; // 作品1つぶんの帯の、長さ ÷ 幅
    gUVs = 0.5 + q * (A > asp ? vec2(1.0, asp / A) : vec2(A / asp, 1.0)); // ゆがめず、はみ出す分は裁つ
  }

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
    vUV = vec2(0.5); vCell = vec2(0.0); vRib = vec2(10.0, 0.0); vTint = vec3(1.0); vLine = PAPER; vPar = 0.0; vScr = vec2(0.0); vTrans = 0.0; vGl = vec4(0.0, 0.0, 1.0, 0.0); vClear = 0.0;
    gl_Position = solidW < 0.5 || sc < 0.02 ? vec4(2.0, 2.0, 2.0, 1.0) : vec4(m.xy * 2.0, m.z * 2.0 - 1.0, 1.0);
    return;
  }
  const float F = 1500.0;
  vec2 ctr = uView * 0.5;
  // 2D のパートでは、奥行きを使わない(どの表現も紙の上の絵になる)。3D に入ると、奥行きが効き始める。
  float zz = wp.z * smoothstep(0.0, 1.4, uPart > 0.5 ? uPartT + float(uPart > 1.5) * 9.0 : 0.0);
  vec2 sp = ctr + uCam + (wp.xy - ctr - uCam) * F / (F - zz);
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
  vAlt = vec4(mix(A.col, B.col, w), solidW); // a: 立体の紙である割合
  vTrans = mix(A.trans, B.trans, w);
  vTint = mix(A.tint, B.tint, w);
  vPar = mix(A.par, B.par, w);
  vLine = mix(A.lineCol, B.lineCol, w);
  vRib = vec2((mod(float(gJ), SEGf) + 0.5 + gTq) * uDp, gVc * uW);
  vGl = vec4(mix(A.nrm, B.nrm, w), mix(A.glass, B.glass, w));
  vClear = mix(A.clear, B.clear, w);
}`;

const FS = `#version 300 es
precision highp float;
uniform sampler2D uAtlas;
uniform float uW;
uniform float uSharp;
in vec2 vQ; in vec2 vUV; in vec2 vCell; in vec2 vShape; in vec2 vRib;
in vec4 vMix; in vec4 vLit; in vec4 vAlt; in vec3 vTint; in vec3 vLine; in float vPar; in vec2 vScr; in float vTrans;
in vec4 vGl; in float vClear;
uniform float uTime; uniform vec2 uView;
uniform sampler2D uDAtlas;
uniform sampler2D uBAtlas; // 被写体を抜いて補った背景
uniform vec3 uLight;
uniform vec2 uTilt;
out vec4 o;
const vec3 PAPER = vec3(0.957, 0.945, 0.918);
float ph21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float pnoise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(ph21(i), ph21(i + vec2(1.0, 0.0)), f.x), mix(ph21(i + vec2(0.0, 1.0)), ph21(i + vec2(1.0, 1.0)), f.x), f.y);
}
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
  // 立体の紙(入れ替えた並び)の質感。pw = 紙である割合。
  float pw = vAlt.a * uSharp;
  // 繊維: 帯の向きに少し長い むら と、細かい ざらつき。紙の上の場所で決まる(画面には貼りつかない)。
  float fib = pnoise(vRib * vec2(0.3, 1.5)) * 0.6 + pnoise(vRib * 2.4) * 0.4;
  // 紙の裏。入れ替えた並びでは、表の写真が透ける(薄い紙の裏から見た刷り。真っ白な穴にしない。写真の色を残す)。
  // 透け方は、繊維の薄い所と厚い所で むら がある。
  // 紙では、透けは光の現象として出す: 手前から照らされた裏は、ほぼ白い紙(刷りは うっすら)。
  // 裏から光が当たっている所だけ、刷りが光に透けて、はっきり浮かぶ(陰影と、透けた絵が、同じ濃さで混ざって見分けにくかった)。
  float thru = mix(0.4, 0.1 + 0.68 * vTrans, pw) + 0.16 * (fib - 0.5) * pw;
  if (vMix.w < 0.0) tc = mix(PAPER, mix(PAPER * 0.97, tc, thru), uSharp);
  vec3 col = mix(vAlt.rgb, tc, vLit.z);
  col *= 1.0 + pw * 0.08 * (fib - 0.5);
  // 帯のふちと、作品の境目の線。紙では引かない(刷った紙に、黒い縁取りは無い)。
  float line = max(step(uW * 0.5 - 1.3, abs(vRib.y)), step(vRib.x, 1.3));
  col = mix(col, vLine, line * step(0.98, vMix.z) * (1.0 - pw));
  // 紙の切り口: 厚みのぶん、ふちが細く明るい。
  col = mix(col, PAPER * 1.05, step(uW * 0.5 - 1.6, abs(vRib.y)) * pw * 0.8);
  // 光(立体のとき)。明るい所は、白く飛ばさずに丸める。
  vec3 lc = col * vLit.x + vLit.y;
  col = mix(lc, (1.0 - exp(-1.25 * lc)) * 1.22, step(0.001, vLit.y + abs(vLit.x - 1.0)) * 0.0 + clamp(abs(vLit.x - 1.0) * 4.0, 0.0, 1.0));
  // 糸の膨らみ
  col *= mix(1.0, 0.62 + 0.5 * (1.0 - vQ.y * vQ.y), vLit.w);
  // ガラスの帯(立体の版の 34 だけ。ほかでは vGl.w = 0 で、ここは通らない)。
  if (vGl.w > 0.001) {
    vec3 n = normalize(vGl.xyz); if (n.z < 0.0) n = -n;
    vec3 L = normalize(vec3(uLight.xy - vScr, uLight.z + 0.25 * max(uView.x, uView.y)));
    float fr = pow(1.0 - n.z, 2.5);
    vec3 r = reflect(vec3(0.0, 0.0, -1.0), n);
    // 映り込み: 帯状の光。指(光)の向きで動く。色ごとに少しずらして、屈折の にじみを作る。
    float sAx = dot(r.xy, normalize(L.xy + vec2(1e-3, 0.0))) * 1.4 + r.y * 0.8 + uTime * 0.07;
    float sBx = (r.x - r.y) * 0.9 + n.x * 0.6 - uTime * 0.05;
    // 細く明るい光の筋。色ごとに ずらす量を大きめにして、筋のふちに 虹の にじみを出す(芯は白い)。
    // 波長を7つに分けて足す(3色だけだと、赤・緑・青の縞に割れる)。
    vec3 str = vec3(0.0);
    for (int c = 0; c < 7; c++) {
      float t = float(c) / 6.0, k = 1.0 + (t - 0.5) * 0.3;
      float v = 1.7 * pow(0.5 + 0.5 * sin(sAx * 6.0 * k + 1.3), 14.0) + 1.1 * pow(0.5 + 0.5 * sin(sAx * 15.0 * k - 0.7), 22.0) + 0.9 * pow(0.5 + 0.5 * sin(sBx * 5.0 * k + 2.1), 12.0);
      str += v * max(vec3(0.0), 1.0 - abs(vec3(t - 1.0, t - 0.5, t)) * 2.2);
    }
    str /= vec3(1.9, 2.8, 1.9);
    vec3 film = 0.5 + 0.5 * cos(6.2832 * (fr * 1.3 + dot(n.xy, L.xy) * 0.7 + uTime * 0.05 + vec3(0.0, 0.33, 0.67)));
    float spc = pow(max(dot(n, normalize(L + vec3(0.0, 0.0, 1.0))), 0.0), 120.0);
    // 地は黒いガラス。筋・ふちの光・光源の映り込みだけが光る。
    vec3 g = str * (0.3 + 1.2 * fr) * mix(vec3(1.0), film, 0.35) + film * 0.1 * fr + vec3(1.0) * (pow(fr, 2.4) * 1.6 + spc * 1.6) + col * 0.05 * (1.0 - fr);
    if (vClear > 0.001) {
      // 透明なガラス: 中の写真が、面の向きのぶん ずれて見える(屈折)。色ごとに ずれが違うので、ふちにだけ虹が出る。指の下は、膨らんで大きく見える。
      vec2 fd = (vScr - uLight.xy) / (uW * 2.0); float lens = exp(-dot(fd, fd));
      vec2 bs = (uv - 0.5) * (1.0 - 0.28 * lens), off = vec2(n.x, -n.y) * 0.13;
      vec3 ph = vec3(0.0);
      for (int c = 0; c < 3; c++) ph[c] = texture(uAtlas, (vCell + clamp(0.5 + bs + off * (0.7 + 0.3 * float(c)), 0.004, 0.996)) / vec2(${ACOLS}.0, ${AROWS}.0))[c];
      vec3 gc = ph * vTint * (1.0 - 0.3 * fr) + film * pow(fr, 1.4) * 0.6 + str * 0.2 * fr + vec3(1.0) * (pow(fr, 3.0) * 0.9 + spc * 1.3);
      g = mix(g, gc, vClear);
    }
    col = mix(col, g, vGl.w);
  }
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
uniform float uDpr;   // 画面の1画素(CSS)あたりの実画素。粒の大きさを、画面の細かさに関わらず揃える
uniform vec3 uGrade; // パートごとのグレーディングの効き(2D 刷り / 3D 35mm / 4D 光)。立体の版だけ。
in vec2 vUv;
out vec4 o;
float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
// フィルムの粒: 画素ごとの白いノイズではなく、なめらかに つながった塊(値ノイズを2段)。
float hu(ivec2 q, int f){ uint x = uint(q.x) * 1597334677U ^ uint(q.y) * 3812015801U ^ uint(f) * 2654435769U; x ^= x >> 15; x *= 2246822519U; x ^= x >> 13; x *= 3266489917U; x ^= x >> 16; return float(x) / 4294967295.0; }
float vn(vec2 p, int f){
  vec2 i = floor(p), u = fract(p); u = u * u * (3.0 - 2.0 * u);
  ivec2 q = ivec2(i);
  return mix(mix(hu(q, f), hu(q + ivec2(1, 0), f), u.x), mix(hu(q + ivec2(0, 1), f), hu(q + ivec2(1, 1), f), u.x), u.y);
}
float grain(vec2 p, int f){ return ((vn(p, f) - 0.5) * 0.68 + (vn(p * 2.07 + 13.1, f + 7) - 0.5) * 0.32) * 2.6; }
// 粒の出方は明るさで変わる: 中間調でいちばん見え、深い黒と飛んだ白では消える(ネガの濃度の性質)。
float grainAmt(float l, float shadow){ return smoothstep(0.0, 0.18, l + shadow) * (1.0 - smoothstep(0.7, 1.0, l)) * (0.55 + 0.45 * (1.0 - abs(l * 2.0 - 0.9))); }
void main(){
  float an = uAnalog; float dg = 1.0 - an;
  vec2 px = 1.0 / uRes;
  float g2 = uGrade.x, g3 = uGrade.y, g4 = uGrade.z;
  // 3D(35mm): フィルムのゲートの揺れ。1画素に満たない、ゆっくりした縦横の揺れ。
  vec2 uv = vUv + vec2(sin(uTime * 1.7) * 0.35, sin(uTime * 2.3 + 1.0) * 0.55 + sin(uTime * 13.0) * 0.12) * px * g3;
  vec3 c = texture(uImg, uv).rgb;
  // デジタル: 色が少し割れ、細い走査線が入る
  float sh = dg * 1.2;
  c.r = mix(c.r, texture(uImg, vUv + vec2(px.x * sh, 0.0)).r, dg);
  c.b = mix(c.b, texture(uImg, vUv - vec2(px.x * sh, 0.0)).b, dg);
  c *= 1.0 - dg * 0.07 * (0.5 + 0.5 * sin(gl_FragCoord.y * 3.14159 * 0.5));
  // アナログ: 粒子、周辺の落ち、黒の浮き、わずかな暖かさ
  float n = h(floor(gl_FragCoord.xy / 1.5) + fract(uTime * 7.0) * 91.0) - 0.5;
  c += n * 0.05 * an * (1.0 - clamp(uGrade.x + uGrade.y + uGrade.z, 0.0, 1.0)); // 立体の版では、下のパートごとの粒に置き換える
  vec2 q = vUv - 0.5;
  c *= mix(1.0, 1.0 - 0.45 * dot(q, q) * 2.0, an);
  c = mix(c, c * vec3(1.03, 1.0, 0.93) + 0.012, an);

  // ---- パートごとのグレーディング(A24 の作品の、色の応答・粒子・ハレーション・ゲートの揺れ を参考に)
  // 写真の色相は変えない。変えるのは、明暗の応答・光のにじみ・粒の質感だけ。
  if (g2 + g3 + g4 > 0.001) {
    float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
    // 光のにじみ: 明るい所のまわりを、黄金角で12点拾う
    float th = mix(0.6, 0.22, g4);
    float R = uRes.y * mix(0.010, 0.016, g4);
    vec3 bl = vec3(0.0);
    for (int i = 0; i < 12; i++) {
      float a = float(i) * 2.39996 + uTime * 0.0;
      float r = (float(i) + 1.0) / 12.0 * R;
      vec3 s = texture(uImg, uv + vec2(cos(a), sin(a)) * r * px).rgb;
      float sl = dot(s, vec3(0.2126, 0.7152, 0.0722));
      bl += s * smoothstep(th, th + 0.25, sl);
    }
    bl /= 12.0;
    // にじみは、明るい所の「外側」にだけ出す(明るい所そのものの色、つまり写真の色は変えない)
    bl *= 1.0 - smoothstep(th - 0.1, th + 0.2, lum);
    // 2D(刷り): 黒が紙の上の墨のように少し浮き、ハイライトは紙の白で止まる。彩度をわずかに落とす。
    vec3 c2 = mix(c, vec3(lum), 0.07);
    c2 = 0.03 + c2 * 0.93;
    c2 = c2 / (1.0 + 0.12 * c2) * 1.1;
    // 3D(35mm): 肩と足のあるフィルムの応答、中間調をわずかに暖かく、赤いハレーション、粗めの粒子
    vec3 c3 = c * 0.72 + c * c * (3.0 - 2.0 * c) * 0.28;
    c3 = c3 / (1.0 + 0.18 * max(c3 - 0.6, 0.0));
    float mid = smoothstep(0.15, 0.45, lum) * (1.0 - smoothstep(0.55, 0.9, lum));
    c3 *= mix(vec3(1.0), vec3(1.035, 1.0, 0.965), mid);
    c3 += bl * vec3(1.0, 0.32, 0.1) * 0.4; // 強いと焦げた縁取りに見える(本人に見せた絵で確認)
    // 4D(光): 黒は沈めきる。光の線は、にじんで空気に溶ける。
    vec3 c4 = max(c - 0.012, 0.0) * 1.03;
    c4 += bl * vec3(0.85, 0.9, 1.0) * 0.6;
    c = c * (1.0 - g2 - g3 - g4) + c2 * g2 + c3 * g3 + c4 * g4;

    // ---- 粒(グレイン)。パートごとに、粒の大きさ・動き方・色の混ざり方を変える。
    vec2 cp = gl_FragCoord.xy / max(uDpr, 1.0); // CSS の画素で
    int fr = int(floor(uTime * 24.0));          // フィルムは毎秒24コマ。粒も24回だけ入れ替わる(60回だとデジタルのノイズに見える)
    float lc = dot(c, vec3(0.2126, 0.7152, 0.0722));
    vec3 gr = vec3(0.0);
    // 2D 刷り: 紙の目。動かない、細かい粒(刷った紙は、時間で粒が変わらない)
    if (g2 > 0.001) gr += vec3(grain(cp / 1.05, 3)) * 0.072 * (0.55 + 0.45 * grainAmt(lc, 0.08)) * smoothstep(0.02, 0.12, lc) * g2; // 紙の白にも目が残る(白で消えるのはフィルムの性質。紙は違う)
    // 3D 35mm: 細かめの粒が毎コマ入れ替わる。色の層ごとに、粒が少しずれる(カラーネガの3層)
    if (g3 > 0.001) {
      float m = grain(cp / 1.5, fr);
      vec3 ch = vec3(grain(cp / 1.5 + 31.7, fr + 101), grain(cp / 1.5 + 57.3, fr + 211), grain(cp / 1.5 + 83.9, fr + 307));
      gr += (vec3(m) * 0.78 + ch * 0.22) * 0.062 * grainAmt(lc, 0.03) * g3;
    }
    // 4D 16mm: 粗い粒。暗い所にも少し残り、闇そのものが ざらつく(夜の場面の増感した粒)
    if (g4 > 0.001) {
      float m = grain(cp / 2.7, fr);
      float cg = grain(cp / 2.7 + 41.3, fr + 409);
      gr += (vec3(m) + vec3(cg, -cg * 0.4, -cg * 0.6) * 0.18) * (0.075 * grainAmt(lc, 0.0) + 0.011) * g4;
    }
    c += gr;
  }
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
  const pu = { dpr: gl.getUniformLocation(post, 'uDpr'), grade: gl.getUniformLocation(post, 'uGrade'), analog: gl.getUniformLocation(post, 'uAnalog'), time: gl.getUniformLocation(post, 'uTime'), res: gl.getUniformLocation(post, 'uRes') };
  const fl = { view: gl.getUniformLocation(floor, 'uView'), light: gl.getUniformLocation(floor, 'uLight'), solid: gl.getUniformLocation(floor, 'uSolid') };
  gl.useProgram(fade);
  gl.uniform1i(gl.getUniformLocation(fade, 'uPrev'), 2);
  const uKeep = gl.getUniformLocation(fade, 'uKeep');
  gl.useProgram(prog);
  let dead = false;
  const U = (n: string) => gl.getUniformLocation(prog, n);
  const u = {
    view: U('uView'), dp: U('uDp'), w: U('uW'), time: U('uTime'), phase: U('uPhase'), k: U('uK'), twK: U('uTwK'), zK: U('uZK'),
    pass: U('uPass'), asp: U('uAsp'), pitch: U('uPitch'), cols: U('uCols'), cells: U('uCells'), step: U('uStep'),
    focus: U('uFocus'), focusAsp: U('uFocusAsp'), from: U('uFrom'), to: U('uTo'), openW: U('uOpenW'), sharp: U('uSharp'), twLim: U('uTwLim'), map: U('uMap'), fold: U('uFold'), pen: U('uPen'), light: U('uLight'), cam: U('uCam'), tilt: U('uTilt'), part: U('uPart'), partT: U('uPartT'), dev: U('uDev'), sty: U('uSty'), sw: U('uSw'), nw: U('uNew'), old: U('uOld'), ret: U('uRet'),
  };
  gl.uniform1i(U('uPath'), 0);
  gl.uniform1i(U('uAtlas'), 1);
  gl.uniform1i(U('uShadow'), 3);
  gl.uniform1i(U('uDAtlas'), 8);
  gl.uniform1i(U('uBAtlas'), 9);
  // 立体(試し /lab/morph-3d/ だけ)。ほかの版では、1×1 の空のテクスチャを置くだけで、使わない。
  const three = root.dataset.set === '3d';
  const uo = { s: U('uObjS'), cell: U('uObjCell'), wrap: U('uWrap'), nwk: U('uNWk'), deep: U('uDeep') };
  const OW = three ? NU : 1, OH = three ? NV : 1;
  const objDim = [[OW, OH], [OW, OH], [96, 64], [OW, OH], [OW, OH], [OW, OH]];
  const objArr = objDim.map(([a, b]) => new Float32Array(a * b * 4));
  const objTex = ['uObjP', 'uObjN', 'uShell', 'uObjE0', 'uObjE1', 'uObjE2'].map((name, i) => {
    const t = gl.createTexture();
    gl.activeTexture(gl.TEXTURE10 + i); gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, objDim[i][0], objDim[i][1], 0, gl.RGBA, gl.FLOAT, objArr[i]);
    for (const p of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D, p, gl.NEAREST);
    for (const p of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T]) gl.texParameteri(gl.TEXTURE_2D, p, gl.CLAMP_TO_EDGE);
    gl.uniform1i(U(name), 10 + i);
    return t;
  });
  gl.activeTexture(gl.TEXTURE0);
  type Subj = { p: Float32Array; n: Float32Array; order: Uint32Array; area: number; hx: number; hz: number; lo: number; hi: number; idx: number; e?: Float32Array };
  const subs: Subj[] = [];
  let objReady = false, objA = -1, objI = 0, objHalfW = 1, objHalfH = 1.25, objCell = 0.01, wrap = [-1.25, 1.25, 0.6, 0.42];
  // 表面: 帯に沿って、下から上へ(帯の先頭から順に、立体の下から貼りついていく)。
  const fillSurface = (sb: Subj, ap: Float32Array, an: Float32Array) => {
    const NPt = sb.p.length / 3, NT = NU * NV, mid = (sb.lo + sb.hi) / 2;
    for (let iu = 0; iu < NU; iu++) for (let iv = 0; iv < NV; iv++) {
      const j = sb.order[Math.min(NPt - 1, Math.floor(((iu * NV + iv) * NPt) / NT))], k = (iv * NU + iu) * 4;
      ap[k] = sb.p[j * 3]; ap[k + 1] = sb.p[j * 3 + 1] - mid; ap[k + 2] = sb.p[j * 3 + 2];
      an[k] = sb.n[j * 3]; an[k + 1] = sb.n[j * 3 + 1]; an[k + 2] = sb.n[j * 3 + 2];
    }
  };
  // 稜線の線分(37・38): いまの立体の A・B と、次の立体の A・B を、3枚の RGBA に詰める。帯の面 1枚につき 1本。
  const fillEdges = (sb: Subj, nx: Subj) => {
    const E = sb.e, F = nx.e ?? sb.e, NT = NU * NV; if (!E || !F) return;
    const NE = E.length / 6, m0 = (sb.lo + sb.hi) / 2, m1 = (nx.lo + nx.hi) / 2, [e0, e1, e2] = [objArr[3], objArr[4], objArr[5]];
    for (let iu = 0; iu < NU; iu++) for (let iv = 0; iv < NV; iv++) {
      const j = Math.min(NE - 1, Math.floor(((iu * NV + iv) * NE) / NT)) * 6, k = (iv * NU + iu) * 4;
      e0[k] = E[j]; e0[k + 1] = E[j + 1] - m0; e0[k + 2] = E[j + 2]; e0[k + 3] = E[j + 3];
      e1[k] = E[j + 4] - m0; e1[k + 1] = E[j + 5]; e1[k + 2] = F[j]; e1[k + 3] = F[j + 1] - m1;
      e2[k] = F[j + 2]; e2[k + 1] = F[j + 3]; e2[k + 2] = F[j + 4] - m1; e2[k + 3] = F[j + 5];
    }
  };
  const applySubject = (sb: Subj, nx: Subj = sb) => {
    const NPt = sb.p.length / 3, mid = (sb.lo + sb.hi) / 2;
    fillSurface(sb, objArr[0], objArr[1]);
    fillEdges(sb, nx);
    // 巻く: 立体の外形(高さ×角度ごとの いちばん外側)に、下から上へ らせん。
    const TH = 96, HH = 64, shell = new Float32Array(TH * HH), lo = sb.lo, hi = sb.hi;
    for (let i = 0; i < NPt; i++) { const x = sb.p[i * 3], y = sb.p[i * 3 + 1], z = sb.p[i * 3 + 2], a = Math.min(TH - 1, Math.floor(((Math.atan2(z, x) / (Math.PI * 2) + 1) % 1) * TH)), h = Math.min(HH - 1, Math.floor(((y - lo) / (hi - lo + 1e-6)) * HH)), r = Math.hypot(x, z); if (r > shell[h * TH + a]) shell[h * TH + a] = r; }
    for (let pass = 0; pass < 3; pass++) { const c = shell.slice(); for (let h = 0; h < HH; h++) for (let a = 0; a < TH; a++) { let sum = 0, n = 0, mx = 0; for (let dh = -1; dh <= 1; dh++) for (let da = -1; da <= 1; da++) { const v = c[Math.max(0, Math.min(HH - 1, h + dh)) * TH + ((a + da + TH) % TH)]; if (v > 0) { sum += v; n++; if (v > mx) mx = v; } } shell[h * TH + a] = n ? (c[h * TH + a] > 0 ? (sum / n) * 0.5 + mx * 0.5 : sum / n) : 0; } }
    let mean = 0, mn = 0; for (let i = 0; i < TH * HH; i++) { objArr[2][i * 4] = shell[i]; if (shell[i] > 0) { mean += shell[i]; mn++; } } mean /= Math.max(1, mn);
    objTex.forEach((t, i) => { gl.activeTexture(gl.TEXTURE10 + i); gl.bindTexture(gl.TEXTURE_2D, t); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, objDim[i][0], objDim[i][1], gl.RGBA, gl.FLOAT, objArr[i]); });
    gl.activeTexture(gl.TEXTURE0);
    objHalfW = sb.hx * 0.92 + sb.hz * 0.39 + 0.1; // 揺れ(±0.4rad)のぶんだけ見込む。奥行きの長い立体(狐)が、小さくなりすぎていた objHalfH = (hi - lo) / 2 + 0.05;
    objCell = Math.sqrt(sb.area / NPt) * 0.95; // 面の半分の大きさ(立体の単位)
    wrap = [lo - mid, hi - mid, mean, 0.42];
  };
  // 立体の選別(2026-11-25〜26、本人:「僕に関係ありそうなもの」「実際にある機種に近いもの」「レトロ機材も混ぜていい」)。
  // 今の機材(Sketchfab の CC BY。作者の表示は About の下)と、古い機材(Poly Haven の CC0)を交互に並べる。出どころは /lab/obj/SOURCES.md。
  if (three) ['red', 'camera01', 'mbp', 'television02', 'vr50', 'vintagevideocamera', 'a7m4', 'classiclaptop', 'genelec', 'filmstripprojector8mm', 'panton', 'plasticmonoblocchair01', 'eames'].forEach((name, idx) => fetch(`${root.dataset.base ?? ''}/lab/obj/${name}.bin`).then((r) => r.arrayBuffer()).then((b) => {
    if (dead) return;
    const [nv, ni] = new Uint32Array(b, 0, 2), v = new Int16Array(b, 8, nv * 3), ix = new Uint16Array(b, 8 + nv * 6, ni);
    let off = 8 + nv * 6 + ni * 2; if ((nv * 6 + ni * 2) % 4) off += 2;
    const NPt = 40000, d = new Int16Array(b, off, NPt * 6), K = 1.25 / 32000;
    let area = 0;
    for (let i = 0; i < ni; i += 3) { const a = ix[i] * 3, bb = ix[i + 1] * 3, c = ix[i + 2] * 3, ux = (v[bb] - v[a]) * K, uy = (v[bb + 1] - v[a + 1]) * K, uz = (v[bb + 2] - v[a + 2]) * K, wx = (v[c] - v[a]) * K, wy = (v[c + 1] - v[a + 1]) * K, wz = (v[c + 2] - v[a + 2]) * K; area += Math.hypot(uy * wz - uz * wy, uz * wx - ux * wz, ux * wy - uy * wx) * 0.5; }
    const sb: Subj = { p: new Float32Array(NPt * 3), n: new Float32Array(NPt * 3), order: new Uint32Array(NPt), area, hx: 0, hz: 0, lo: 1e9, hi: -1e9, idx };
    const key = new Float32Array(NPt);
    for (let i = 0; i < NPt; i++) { for (let k = 0; k < 3; k++) { sb.p[i * 3 + k] = d[i * 6 + k] * K; sb.n[i * 3 + k] = d[i * 6 + 3 + k] / 32000; } const y = sb.p[i * 3 + 1]; sb.lo = Math.min(sb.lo, y); sb.hi = Math.max(sb.hi, y); sb.hx = Math.max(sb.hx, Math.abs(sb.p[i * 3])); sb.hz = Math.max(sb.hz, Math.abs(sb.p[i * 3 + 2])); sb.order[i] = i; key[i] = y + Math.atan2(sb.p[i * 3 + 2], sb.p[i * 3]) * 0.03; }
    sb.order.sort((a, bb) => key[a] - key[bb]);
    return fetch(`${root.dataset.base ?? ''}/lab/obj/${name}.edges.bin`).then((r) => (r.ok ? r.arrayBuffer() : null)).catch(() => null).then((eb) => {
    if (dead) return;
    if (eb && eb.byteLength === 40000 * 12) { const ei = new Int16Array(eb), ef = new Float32Array(ei.length); for (let i = 0; i < ei.length; i++) ef[i] = ei[i] * K; sb.e = ef; }
    subs.push(sb);
    subs.sort((x, y) => x.idx - y.idx); // 届いた順ではなく、上の並び順で回す
    if (!objReady) { applySubject(sb); objReady = true; } else if (subs.length > 1) applySubject(subs[objI], subs[(objI + 1) % subs.length]);
    });
  }).catch(() => {})); // 届かなかった立体は、使わないだけ
  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.depthFunc(gl.LEQUAL);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  gl.clearColor(0, 0, 0, 1);

  // なぞった跡(輪): 3行。 0: x, y, 向き / 1: (空き), 生まれた時刻, 有効 / 2: 写真の中心, 写真の幅, 作品の番号
  const path = new Float32Array(M * 4 * 5); // 3行目・4行目は、立体の紙の折り目(試し)
  const pathTex = gl.createTexture();
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, pathTex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, M, 5, 0, gl.RGBA, gl.FLOAT, path);
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
    if (!auto) advance(dp * (three ? 1.6 : 0.6)); // 立体の版: 指を大きく動かすほど、はっきり先へ進む
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
  const ANALOG = [1, 0.85, 0, 0.5, 1, 1, 1, 0, 0, 0, 0.4, 0.7, 0.1, 0.3, 0.9, 0, 0.8, 0.1, 0, 0.8, 0.5, 0.7, 0.4, 0.6, 0.8, 0.5, 0.6, 0.6, 0.8, 0.8, 0.8, 0.8, 0.8, 0.8, 0.8, 0.8, 0.8, 0.3, 0.3, 0.2, 0.8, 0.6, 0.2, 0.4, 0.3, 0.6, 0.7, 0.6, 0.7]; // アナログらしさ(29 粒 と 30 割れる は、色の割れを掛けない)(画面全体の質感に使う)
  // 見た目が似ているものは入れない(技術が違っても、見た目が近ければ同じ)。表面だけの違い、写真が並ぶだけの札、帯と見分けのつかない変形(垂れる・流れ・波紋・立体写真)、点の重複(画素の落下・奥行きの点)、白い線の重複(糸)、紙の立体の重複(筒)も外した: 3 浮き彫り / 4 リソグラフ / 5 フィルム / 6 刺繍 / 7 ピクセル / 8 点群 / 9 グリッチ
  const ACTIVE = [0, 1, 2, 12, 13, 14, 15, 16, 19, 22, 23, 24, 25, 27];
  // 系統: 近い表現が続かないように、直前2つと同じ系統は選ばない。
  const FAM: Record<number, string> = {
    0: 'band', 14: 'fold', 1: 'ribbon', 23: 'ribbon', 2: 'lines', 13: 'scatter', 22: 'scatter', 15: 'bars', 24: 'pile', 27: 'big',
    12: 'pixel', 16: 'fringe', 19: 'drip', 25: 'liquid',
    8: 'lines', 18: 'wire', 20: 'flow', 17: 'points', 29: 'grain', 30: 'scatter', 21: 'tube',
    31: 'iri', 32: 'stick', 33: 'wrap', 34: 'glass', 35: 'glassline', 36: 'glassclear', 37: 'line3d', 38: 'morph3d', 39: 'mapline', 40: 'echo', 41: 'clifford', 42: 'hopf', 43: 'cone', 44: 'tess', 45: 'city', 46: 'twister', 47: 'spawn', 48: 'dev',
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
  const sharp = root.dataset.set === 'sharp' || three; // 立体の版も、帯そのものは「入れ替えた並び」と同じ
  // 立体の紙のねじりの強さ。塩梅を実機で探れるように、URL の ?tw=0.9 のように指定できる(既定 1.15。本人: 強めか、かなり強め)。
  const twLim = Math.max(0.2, Math.min(1.6, parseFloat(new URLSearchParams(location.search).get('tw') ?? '') || 1.15));
  // 既定は「帯に沿って貼る」(本人: よくて自然)。?map=window で、以前の「窓」。
  const mapStrip = new URLSearchParams(location.search).get('map') !== 'window';
  // 立体の紙: 急な折り返しで紙を折る(試し)。?fold=1 のときだけ。
  const foldOn = new URLSearchParams(location.search).get('fold') === '1';
  const flatDbg = new URLSearchParams(location.search).get('flat') === '1'; // 確かめ用: ねじれなし
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
  let onlyOn = false;
  let devOn = false; // 展開の流れ(48)。three で、?only も ?flow=parts もないとき
  if (three) {
    // 立体の表現を、当初の並びに足す(31 虹の立体 / 32 貼り込んだ立体 / 33 立体に巻く)。?only=31 のように指定すると、帯とその表現だけを行き来する(確かめ用)。
    SECS.A.pool.push(33, 31, 37); SECS.B.pool.push(32, 31, 38); // 37 線の立体 / 38 線の立体が次の立体へ移る(2026-11-26、本人:「モーフィング的に変わる、アウトライン表示、込みで広く」)
 // 本人(2026-11-25):「この表現(ガラス)は、帯に落とし込む系ではないと思う」→ 帯の線から作るガラス(35・36)は、並びから外した(?only=35 / 36 では見られる)。
    SECS.chorus.pool.push(31, 32, 33, 38); SECS.C.pool.push(32, 33, 37); // ドロップ(0.4秒の ぶつ切り)には入れない
    // 帯から育つ展開(2026-11-27): 39 写像の線(Ayumu Nagamatsu の図形から)/ 40 増える帯 → 空間
    // 次元が1つずつ増える(本人 2026-11-27:「2Dで描くという原初の動作から、次元が増えて3次元になり、コンテンツは1次元増えて4次元のような展開」):
    //   前半(イントロ・Aメロ・Bメロ)は平面の帯 → サビで帯が増えて奥行きになる(40)→ Cメロのあとに4次元(39、4つめの軸は作品)。
    // パートをはっきり分ける(本人 2026-11-27:「もっとはっきりパートを分けて欲しい」)。パートの中では、その次元の表現だけを使う。
    //   2D: 平らな帯の表現だけ(奥行きは画面の作りで切ってある)/ 3D: 帯が増えて起き上がる所から入る / 4D: 光の線だけ
    SECS.A2D = { n: [1, 2], len: 0.95, pool: [0, 29, 20, 19], sty: [0, 1, 3] };
    SECS.B2D = { n: [2, 3], len: 0.5, pool: [8, 29, 20, 19, 0], sty: [1, 3, 2] };
    SECS.drop2D = { n: [5, 8], len: 0.2, pool: [29, 20, 19, 8, 0], sty: [2] };
    SECS.up = { n: [1, 1], len: 2.6, pool: [40], sty: [0] };
    SECS.chorus.pool = [1, 17, 21, 31, 32, 33, 38, 40];
    SECS.B3 = { n: [2, 3], len: 0.6, pool: [1, 17, 21, 31, 37, 40], sty: [1, 3] };
    SECS.drop3 = { n: [5, 7], len: 0.25, pool: [17, 21, 1, 14, 31], sty: [2] };
    SECS.D4 = { n: [1, 1], len: 3.4, pool: [39], sty: [0] };
    const only = parseInt(new URLSearchParams(location.search).get('only') ?? '', 10);
    if (only >= 0) { onlyOn = true; for (const k of Object.keys(SECS)) if (k !== 'intro' && k !== 'P') SECS[k].pool = [only, 0]; }
    devOn = !onlyOn && new URLSearchParams(location.search).get('flow') !== 'parts';
  }
  // ハイパーポップのMVやライブ演出の速さ: ドロップを多めに、プロフィール(P)も曲の中に置く。
  // 入れ替えた並びでは、プロフィールを曲の中に置かない(見ることと読むことを混ぜない。プロフィールは About のページへ)。
  const FORM = sharp
    ? three
      ? ['intro', 'A2D', 'B2D', 'drop2D', 'A2D', 'B2D', 'up', 'chorus', 'B3', 'drop3', 'chorus', 'D4']
      : ['intro', 'A', 'B', 'drop', 'chorus', 'B', 'drop', 'A', 'B', 'chorus', 'drop', 'C', 'drop', 'chorus']
    : ['intro', 'A', 'B', 'drop', 'chorus', 'P', 'B', 'drop', 'A', 'B', 'chorus', 'drop', 'C', 'drop', 'chorus', 'P'];
  const BEAT = 1.9; // 長さ1の区間が、触らずに進む秒数
  const LOOP = 1; // 2周目以降は Aメロから
  let formI = 0;
  const seq: number[] = [];
  const secOf: string[] = [];
  const lenOf: number[] = [];
  const styOf: number[] = [];
  const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)];
  // 立体の版: パートごとに、そのパートの表現を「1回ずつ」並べる(本人 2026-11-27:「1表現が複数回出てきてしまってる？」)。
  //   2D: 帯から入り、平らな表現を1回ずつ / 3D: 4本の帯が起き上がって入り、立体の表現を1回ずつ(ガラスは、立体の紙と筒の間)/ 4D: 光の線
  // 周を重ねるたびに、パートの中の順番を入れ替える。
  let partI = 0;
  // これまで作った表現を、次元ごとに全部使う(本人 2026-11-27:「何回もリファレンスを投げて表現を増やしてきた。使える表現が5つってなんだ？」)。
  // 外したのは、本人が外すと言ったものだけ: 4 リソ・5 フィルム・6 刺繍(写真の色を変える/見た目だけの違い)、18 線だけの帯(色を落とす)、
  //   30 割れる(写真が分かれているだけ)、27 全画面(平面の四角)、28 プロフィール(About へ)、35・36 帯の線から作るガラス(帯に落とし込む系ではない)。
  // 2D: 平らな帯の上で起きる表現 / 3D: 面が立ち、奥行きで見せる表現(帯が4本に増えて起き上がる 40 から入る。ガラス 34 と立体は別に入れる)
  // 分け方は技術ではなく見え方(本人 2026-11-27:「3Dの技術を使っているかより、実際に3Dに見えるか平面に見えるかで分類」)。
  // 画面で1つずつ見て、平らに見えるもの / 立体に見えるもの に分けた。
  // 似すぎている表現は外す(本人 2026-11-27:「あまりにも似すぎてる表現は落とそう。重なった写真と、写真が連なるやつとか」)。
  // 外したもの(?only=N では見られる): 10 札の蛇・11 置いていく写真(写真の札が並ぶ。互いに同じ)、3 浮き彫り・26 立体写真(帯とほぼ同じに見える)、
  // 12 画素の落下(7 ピクセルと同じ)、17 奥行きの点(8 の縞のねじれと同じ)、24 積もる(25 波紋と同じ波)、31 虹の立体・37 線の立体(32・38 と同じ形)。
  const P2D = [2, 7, 9, 13, 14, 16, 19, 22, 29, 47];
  const P3D = [8, 15, 20, 23, 25, 45, 46];
  // 表現ごとの長さ(1 = BEAT 秒)。その表現が見えて読めるまでにかかる時間で決めた。
  const LEN: Record<number, number> = {
    0: 1.0, 2: 1.2, 3: 1.2, 7: 0.8, 9: 0.7, 10: 1.2, 11: 1.0, 12: 0.9, 13: 1.1, 14: 1.0, 16: 1.2, 19: 1.3, 22: 1.1, 26: 1.1, 29: 0.8,
    40: 2.6, 1: 1.4, 8: 1.6, 15: 1.1, 17: 1.3, 20: 1.3, 21: 1.4, 23: 1.4, 24: 1.4, 25: 1.3, 34: 4.4, 31: 1.8, 32: 1.8, 33: 1.8, 37: 1.8, 38: 2.4,
    39: 2.6, 41: 3.6, 42: 3.0, 43: 3.4, 44: 3.4, 45: 2.4, 46: 4.2, 47: 3.0,
  };
  const shuffle = <T,>(a: T[]) => { const b = a.slice(); for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; };
  const push1 = (c: number, sec: string, len: number, sty: number) => { seq.push(c); secOf.push(sec); lenOf.push(len * (0.92 + Math.random() * 0.16)); styOf.push(sty); };
  const growParts = () => {
    const P = partI % 3;
    partI++;
    if (P === 0) {
      push1(0, 'A2D', partI === 1 ? 1.4 : 1.0, 0);
      for (const c of shuffle(P2D)) push1(c, 'A2D', LEN[c] ?? 1, pick([0, 1, 3]));
    } else if (P === 1) {
      push1(40, 'up', LEN[40], 0);
      const others = shuffle([...P3D, ...(objReady ? [32, 33, 38] : [])]);
      const core = Math.random() < 0.5 ? [1, 34, 21] : [21, 34, 1];
      const at = Math.floor(Math.random() * (others.length + 1));
      const list = [...others.slice(0, at), ...core, ...others.slice(at)];
      for (const c of list) push1(c, 'B3', LEN[c] ?? 1.2, c === 34 ? 1 : pick([1, 3]));
    } else {
      // 4D: 写真の帯にこだわらない(本人 2026-11-27:「不必要でもっと違う表現があったら、写真入りの帯を途中から捨ててもいい」)
      for (const c of shuffle([39, 41, 42, 43, 44])) push1(c, 'D4', LEN[c] ?? 3, c === 39 ? 0 : 1);
    }
  };
  // 展開の流れ(48): 最初の1カットだけ帯。そこから先は、止まらずに展開していく(本人 2026-11-27:「最初の1カットからどんどん展開されていければ、
  // 僕の画像や帯は使わなくていい。もっと自由にやってみて」)。これまでのパートごとの並びは ?flow=parts で見られる。
  const growDev = () => {
    if (!seq.length) push1(0, 'intro', 2.2, 0);
    push1(48, 'DEV', 1e5, 0);
  };
  const grow = () => {
    if (devOn) return growDev();
    if (three && !onlyOn) return growParts();
    const name = FORM[formI];
    formI = formI + 1 < FORM.length ? formI + 1 : LOOP;
    const S0 = SECS[name];
    const S = !three || objReady ? S0 : { ...S0, pool: S0.pool.filter((c) => c < 31 || c >= 39) }; // 立体のデータが届くまでは、立体の表現を選ばない
    const cnt = S.n[0] + Math.floor(Math.random() * (S.n[1] - S.n[0] + 1));
    // ガラスの立体(34)は、サビに組み込む(本人 2026-11-25:「いいじゃん 組み込もう」)。
    // サビの頭は 必ず「帯 → ガラスの立体」。帯から変形して現れるように、直前に 短く帯を置く。ガラスは長く見せる(形が1〜2回 変わるくらい)。
    if (three && name === 'chorus' && !onlyOn) {
      for (const [c, len, sty] of [[0, 0.55, 0], [34, 4.4, 1]]) { seq.push(c); secOf.push(name); lenOf.push(len * (0.92 + Math.random() * 0.16)); styOf.push(sty); }
    }
    for (let i = 0; i < cnt; i++) {
      const a = seq.length ? seq[seq.length - 1] : -1;
      const b = seq.length > 1 ? seq[seq.length - 2] : -1;
      let c = pick(S.pool);
      if (three && a === 34) c = pick([1, 21]); // ガラスの次は、帯の仲間(立体の紙か筒)へ変形して戻る。粒へは行かない
      let guard = 0;
      // 直前と同じ表現・同じ系統は避ける(区間の候補が少ないときは、同じ表現だけ避ける)。
      while (!(three && a === 34) && S.pool.length > 1 && (c === a || (guard < 60 && (FAM[c] === FAM[a] || c === b))) && guard++ < 200) c = pick(S.pool);
      seq.push(c);
      secOf.push(name);
      lenOf.push(S.len * (0.85 + Math.random() * 0.3) * (c >= 31 ? 1.7 : 1)); // 立体の表現は、長めに見せる
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
  // パート: 2D(描く)→ 3D(帯が増えて奥行きになる)→ 4D(作品の軸を足して、4次元で回す)。立体の版だけ。それ以外の版は、ずっと 2D のまま(奥行きは今までどおり)。
  const PART: Record<string, number> = three ? { intro: 0, A2D: 0, B2D: 0, drop2D: 0, up: 1, chorus: 1, B3: 1, drop3: 1, D4: 2 } : {};
  // 展開(48)の時刻: 46.5秒で、線の所(1.2秒)へ戻って続く。パートは、その時刻で決まる(2D 紙 → 3D 床と塔 → 4D 光 → 2D 紙)。
  const DEV_END = 46.5, DEV_LOOP = 1.2;
  let devT = 0;
  let devHold = false;
  const devLoop = (t: number): [number, number] => (t <= DEV_END ? [t, 0] : [DEV_LOOP + ((t - DEV_LOOP) % (DEV_END - DEV_LOOP)), 1 + Math.floor((t - DEV_LOOP) / (DEV_END - DEV_LOOP))]);
  const devPart = (t: number) => (t < 8 ? 0 : t < 21 ? 1 : t < 46.3 ? 2 : 0);
  const devCanDraw = () => !devOn || devT <= 0 || devPart(devLoop(devT)[0]) === 0 && devLoop(devT)[0] < 8;
  let curPart = three ? 0 : 1;
  const grade = three ? [1, 0, 0] : [0, 0, 0]; // パートごとのグレーディング(移り変わりは、ゆっくり混ぜる)
  let gDt = 0.016;
  let partAt = 0;
  let numEl: HTMLElement | null = null;
  if (three && new URLSearchParams(location.search).get('num')) {
    numEl = document.createElement('div');
    numEl.style.cssText = 'position:fixed;left:12px;top:calc(env(safe-area-inset-top, 0px) + 12px);z-index:9999;font:600 28px/1 ui-monospace,Menlo,monospace;color:#fff;background:rgba(0,0,0,.6);padding:6px 10px;pointer-events:none';
    document.body.appendChild(numEl);
  }
  let analog = 1;
  /**
   * 立体の紙のねじれ角を、跡ごとに決める(入れ替えた並び)。
   *
   * 大きくねじるが、ねじりの速さは「幅 × 速さ ≤ twLim」に収める(既定 1.15)。
   * 同じ向きに回り続ける分と、行って戻る波を重ねる。回るのが止まって平らに寝る所と、上限いっぱいで返る所が、帯に沿って並ぶ。
   *
   * 経緯: この形(8226944)を、本人は「帯に沿って貼るはよくて自然」「ねじれが大きい方が見栄えはいい」と見た。
   * そのあと「急な折り返しと、1点に絞られる所が破綻に見える」と言われ、形の決まりごと変えた2つの版は、どちらも退けられた:
   *  ・曲がる所で紙を立たせる(a462de8)→「グチャグチャ」「あまり紙っぽくはない」(真上から見ると、立った紙は刃物のように尖る)
   *  ・幅を保って机に這わせる(a8f5808)→「悪化した」(ねじれが消えて、平らな帯に戻った。裏の白ばかりが見える)
   * なので、土台はこの形に固定する。破綻は、形の決まりを替えずに、その場所だけを直す。
   */
  const phi = new Float32Array(M);
  function bankPaper() {
    const n = Math.min(K, M);
    if (n < 2) return;
    const lim = (twLim * dp) / W; // ねじりの速さの上限(跡1つあたりの角度)
    const at = (i: number) => (((K - n + i) % M) + M) % M; // 古い順の i 番目が、輪のどこにあるか
    for (let i = 0; i < n; i++) {
      const u = K - n + i; // 描きはじめからの通し番号(輪を回っても途切れない)
      phi[i] = u * lim * 0.45 + now * 0.3 + 1.3 * Math.sin(u * lim * 0.25 + now * 0.21 + 0.7) + 0.5 * Math.sin(u * lim * 0.4 - now * 0.13 + 2.1);
      // 折り目の試し: 紙全体を同じ向きに回し続けない(折り目は平らに留まるので、回し続けると ねじれが巻き上がる)。行って戻る揺れにする。
      if (foldOn) phi[i] += 0.7 * Math.sin(now * 0.33) - now * 0.3;
      if (flatDbg) phi[i] = 0;
    }
    if (foldOn) foldPaper(n, at);
    for (let i = 0; i < n; i++) path[(M + at(i)) * 4] = phi[i];
  }
  /**
   * 折り目(試し。?fold=1): 急な折り返しを見つけて、そこで紙を折る。
   *
   * ・角: 跡の3つ前から3つ先までで、向きが 51° 以上変わる所(曲がりの半径が、幅の半分より小さい。ここでは、帯の内側が裏返って重なる)。
   * ・腕: 角の前後を、角から少し離れた所の向きで、まっすぐな2本の腕にする(離れるにつれて、描いた線に戻す)。
   * ・折り目: 2本の腕の向きを2等分する線。直角なら 45° の斜め、真後ろへの折り返しなら 帯に直角。
   * ・折り目から先は、ねじれ角の数え方が鏡写しになる(θ → π − θ)。平らな所なら、裏が上になる。
   */
  const smooth = (x: number) => { const v = Math.max(0, Math.min(1, x)); return v * v * (3 - 2 * v); };
  const fpx = new Float32Array(M), fpy = new Float32Array(M), ftau = new Float32Array(M);
  const frun = new Int32Array(M), fown = new Int32Array(M);
  const born = new Map<number, number>();
  function foldPaper(n: number, at: (i: number) => number) {
    let r = 0;
    for (let i = 0; i < n; i++) {
      const j = at(i);
      fpx[i] = path[j * 4]; fpy[i] = path[j * 4 + 1];
      const alive = path[(M + j) * 4 + 3] > 0.5;
      if (i > 0 && (!alive || Math.hypot(fpx[i] - fpx[i - 1], fpy[i] - fpy[i - 1]) > dp * 1.6)) r++;
      frun[i] = alive ? r : -1 - i;
      if (!alive) r++;
      fown[i] = -1;
      // 既定: 芯は描いた線のまま、折り目なし。
      path[(3 * M + j) * 4] = fpx[i]; path[(3 * M + j) * 4 + 1] = fpy[i];
      path[(3 * M + j) * 4 + 2] = path[j * 4 + 2]; path[(3 * M + j) * 4 + 3] = path[j * 4 + 3];
      path[(4 * M + j) * 4 + 3] = 1e6;
      path[(M + j) * 4 + 1] = 0;
    }
    // 角を探す。
    const cand: number[] = [];
    for (let i = 3; i < n - 4; i++) {
      ftau[i] = 0;
      if (frun[i - 3] < 0 || frun[i - 3] !== frun[i + 4]) continue;
      const ax = fpx[i] - fpx[i - 3], ay = fpy[i] - fpy[i - 3], bx = fpx[i + 3] - fpx[i], by = fpy[i + 3] - fpy[i];
      ftau[i] = Math.atan2(Math.abs(ax * by - ay * bx), ax * bx + ay * by);
      if (ftau[i] >= 0.9) cand.push(i);
    }
    cand.sort((a, b) => ftau[b] - ftau[a]);
    const SEP = Math.max(4, Math.round((0.6 * W) / dp));
    const cs: number[] = [];
    for (const c of cand) if (cs.every((a) => Math.abs(a - c) >= SEP)) cs.push(c);
    cs.sort((a, b) => a - b);
    const H = Math.max(3, Math.round((0.6 * W) / dp));
    const G = 2;
    const base = K - n;
    for (const k of born.keys()) if (k < base) born.delete(k);
    type Fold = { i: number; g: number; lo: number; hi: number; r1: number; k: number };
    const folds: Fold[] = [];
    for (let c = 0; c < cs.length; c++) {
      const ic = cs[c];
      // 腕を取れる範囲: 同じ筆の中で、となりの角との中ほどまで。
      let lo = ic, hi = ic;
      while (lo > 0 && frun[lo - 1] === frun[ic]) lo--;
      while (hi < n - 1 && frun[hi + 1] === frun[ic]) hi++;
      if (c > 0 && cs[c - 1] >= lo) lo = Math.ceil((cs[c - 1] + ic) / 2);
      if (c + 1 < cs.length && cs[c + 1] <= hi) hi = Math.floor((cs[c + 1] + ic) / 2);
      const a0 = Math.max(lo, ic - G - H), a1 = ic - G, b0 = ic + G, b1 = Math.min(hi, ic + G + H);
      if (a1 - a0 < 2 || b1 - b0 < 2) continue;
      let d1x = fpx[a1] - fpx[a0], d1y = fpy[a1] - fpy[a0], d2x = fpx[b1] - fpx[b0], d2y = fpy[b1] - fpy[b0];
      const l1 = Math.hypot(d1x, d1y) || 1, l2 = Math.hypot(d2x, d2y) || 1;
      d1x /= l1; d1y /= l1; d2x /= l2; d2y /= l2;
      const al = Math.acos(Math.max(-1, Math.min(1, d1x * d2x + d1y * d2y)));
      if (al < 0.8) continue;
      let cx = d1x + d2x, cy = d1y + d2y;
      const cl = Math.hypot(cx, cy);
      if (cl < 0.08) { cx = -d1y; cy = d1x; } else { cx /= cl; cy /= cl; }
      let qx = -cy, qy = cx;
      if (qx * (d2x - d1x) + qy * (d2y - d1y) < 0) { qx = -qx; qy = -qy; }
      const psi = Math.atan2(qy, qx);
      const key = base + ic;
      if (!born.has(key)) born.set(key, now);
      const g = smooth((now - born.get(key)!) / 0.3);
      const R1 = Math.max(0.45 * W, Math.min(1.3 * W, (0.5 * W) / Math.tan(al / 2) + 0.25 * W));
      const R2 = R1 + 0.7 * W;
      const px0 = (fpx[ic] + fpx[ic + 1]) / 2, py0 = (fpy[ic] + fpy[ic + 1]) / 2; // 角は、跡と跡の中ほどに置く
      for (let i = lo; i <= hi; i++) {
        const sI = (i - ic - 0.5) * dp;
        const room = (i <= ic ? ic - lo : hi - ic) * dp; // この側で、腕に使える長さ
        const r2 = Math.min(R2, room), r1 = Math.min(R1, r2 * 0.6);
        if (Math.abs(sI) > r2) continue;
        const j = at(i);
        const wt = (1 - smooth((Math.abs(sI) - r1) / Math.max(1e-3, r2 - r1))) * g;
        const dx = i <= ic ? d1x : d2x, dy = i <= ic ? d1y : d2y;
        const o3 = (3 * M + j) * 4;
        path[o3] = fpx[i] + (px0 + sI * dx - fpx[i]) * wt;
        path[o3 + 1] = fpy[i] + (py0 + sI * dy - fpy[i]) * wt;
        let tx2 = path[j * 4 + 2] + (dx - path[j * 4 + 2]) * wt, ty2 = path[j * 4 + 3] + (dy - path[j * 4 + 3]) * wt;
        const tl = Math.hypot(tx2, ty2) || 1;
        path[o3 + 2] = tx2 / tl; path[o3 + 3] = ty2 / tl;
        const o4 = (4 * M + j) * 4;
        path[o4] = px0; path[o4 + 1] = py0; path[o4 + 2] = psi + 100 * Math.round((0.5 / Math.sin(al / 2)) * 50); path[o4 + 3] = sI;
        path[(M + j) * 4 + 1] = wt; // 折り目の効き: 角のまわりで 1、腕の先へ向かって 0
      }
      const uc = base + ic, limc = (twLim * dp) / W;
      const spatial = uc * limc * 0.45 + 1.3 * Math.sin(uc * limc * 0.25 + 0.7) + 0.5 * Math.sin(uc * limc * 0.4 + 2.1);
      folds.push({ i: ic, g, lo, hi, r1: R1, k: Math.round(spatial / Math.PI) });
    }
    // 折り目のまわりは、平らに寝かせる(折り目は、平らな紙でこそ はっきり見える。ねじれは、折り目から離れた所に残す)。
    // 寝かせる向き(表が上か、裏が上か)は、場所だけで決める。時間で入れ替わらない。
    // 折り目から離れるほど、ねじれてよい角度が広がる(広がり方は、ねじりの速さの上限)。折り目のすぐ隣で、急にねじれない。
    {
      const lim = (twLim * dp) / W;
      // 近い折り目どうしは、同じ向きに寝かせる(間で半回転する余地がない)。
      for (let c = 1; c < folds.length; c++) {
        const a = folds[c - 1], b = folds[c];
        if (frun[a.i] === frun[b.i] && (b.i - a.i) * dp < a.r1 + b.r1 + (Math.PI * W) / twLim) b.k = a.k;
      }
      for (const f of folds) {
        const tgt = f.k * Math.PI;
        const flat = f.r1 / dp;
        for (let i = 0; i < n; i++) {
          if (frun[i] !== frun[f.i]) continue;
          const dev = lim * Math.max(0, Math.abs(i - f.i - 0.5) - flat) + (1 - f.g) * 12;
          if (dev > 14) continue;
          phi[i] = Math.max(tgt - dev, Math.min(tgt + dev, phi[i]));
        }
      }
    }
    // 折り目から先は、ねじれ角を鏡写しにする(その筆の終わりまで)。
    for (const f of folds) {
      const m = Math.round((2 * phi[f.i] - Math.PI) / (2 * Math.PI));
      for (let i = f.i + 1; i < n && frun[i] === frun[f.i]; i++) phi[i] += f.g * (Math.PI - 2 * phi[i] + 2 * Math.PI * m);
    }
  }
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
    // 確認用(?num=1): いま出ている表現の番号を左上に出す。短くて言葉にできない表現を、番号で指せるように。
    if (numEl) { const t = sFrom === sTo ? `${sFrom}` : `${sFrom} → ${sTo}`; if (numEl.textContent !== t) numEl.textContent = t; }
    // 立体は、帯から立体の表現に入るたびに替える。
    // (区間が替わった瞬間で、まだ立体が見えていないとき。順番に回す: 同じ立体が続かない。?only=31 でも替わる。)
    if (three && objReady && A !== objA) { objA = A; if (sFrom < 31 && sTo >= 31) { objI = (objI + 1) % subs.length; applySubject(subs[objI], subs[(objI + 1) % subs.length]); } }
    const wOf = (id: number) => (sFrom === id ? 1 - x : 0) + (sTo === id ? x : 0);
    trail = Math.max(sstep(0.15, 0.75, wOf(2)), sstep(0.3, 0.9, wOf(8)) * 0.8);
    solid = sstep(0.25, 1, wOf(1));
    frameW = wOf(28);
    // 入れ替えた並びでは、画面全体の仕上げを1つに揃える(色の割れと走査線は掛けない。細かい点が、色の雑音になるため)。
    analog = sharp ? 0.85 : ANALOG[sFrom] * (1 - x) + ANALOG[sTo] * x;
    const st = x > 0.5 ? sTo : sFrom;
    const si = x > 0.5 ? A + 1 : A;
    const sec = secOf[si] || 'A';
    const part = sec === 'DEV' ? devPart(devLoop(devT)[0]) : PART[sec] ?? (three ? 1 : 0);
    if (part !== curPart) { curPart = part; partAt = now; }
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
  let ptrMouse = false;
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
    } else if (devCanDraw()) begin(penX, penY);
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
    ptrMouse = e.pointerType === 'mouse';
    if (drawing) strayed = Math.max(strayed, Math.hypot(ptX - downX, ptY - downY));
    if (drawing && waitMove && strayed >= 8) {
      waitMove = false;
      if (devCanDraw()) begin(downX, downY);
    }
  }
  function onUp() {
    if (!drawing) return;
    drawing = false;
    stroke = false;
    idle = 0.9;
    // 描かずに押しただけなら、そこの作品をひらく。
    if (sharp && strayed < 8 && now - downT < 0.45 && !(three && (sFrom >= 31 || sTo >= 31))) { // 立体が出ている間は、見えていない帯の作品を ひらかない
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
    gDt = dt;
    last = t;
    now = (t - t0) / 1000;
    // 曲は時間でも進む(触らなくても動き続ける)。描くと、さらに速く進む。
    if (!panelOpen && !openOn && !frozen) {
      const n = Math.max(0, Math.floor(phase));
      seqAt(n + 1);
      phase += (dt / (BEAT * lenOf[n])) * (drawing && !three ? 0.6 : 1);
      hold4();
      onPhase();
    }
    if (devOn && (sTo === 48 || sFrom === 48) && !frozen && !devHold && !panelOpen && !openOn) devT += dt;
    if (drawing) {
      const k = 1 - Math.exp(-dt / 0.03);
      penX += (ptX - penX) * k;
      penY += (ptY - penY) * k;
      // 展開の途中(3D・4D)では、指は描かない。粒を よけさせ、見る向きを変える。
      if (devCanDraw()) {
        if (!stroke && !waitMove) begin(penX, penY);
        lineTo(penX, penY);
      } else stroke = false;
    } else if (autoOn && !panelOpen && !openOn && (!devOn || devT <= 0)) {
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
    if (sharp) bankPaper();
    gl!.texSubImage2D(gl!.TEXTURE_2D, 0, 0, 0, M, foldOn ? 5 : 3, gl!.RGBA, gl!.FLOAT, path);
    gl!.uniform1f(u.time, now);
    gl!.uniform1f(u.part, curPart);
    gl!.uniform1f(u.partT, now - partAt);
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
    gl!.uniform1f(uo.s, Math.min((vw * 0.46) / objHalfW, (vh * 0.32) / objHalfH)); gl!.uniform1f(uo.cell, objCell); gl!.uniform4f(uo.wrap, wrap[0], wrap[1], wrap[2], wrap[3]); gl!.uniform1f(uo.nwk, nW); gl!.uniform1f(uo.deep, three ? 1 : 0);
    gl!.uniform1f(u.twLim, twLim);
    gl!.uniform1f(u.map, mapStrip ? 1 : 0);
    gl!.uniform1f(u.fold, foldOn && sharp ? 1 : 0);
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
    gl!.uniform3f(u.pen, fx, fy, devOn && (sTo === 48 || sFrom === 48) ? (drawing ? 1 : ptrMouse ? over : 0) : fon);
    { const [dtl, dn] = devLoop(devT); gl!.uniform2f(u.dev, dtl, dn); }
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
        // 入れ替えた並びでは、床の明るさを抑える(紙になったとたんに、黒い地が急に明るくなるため)。影は、うっすら残る。
        gl!.uniform1f(fl.solid, sharp ? solid * 0.3 : solid);
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
    if (three) { const tg = [curPart === 0 ? 1 : 0, curPart === 1 ? 1 : 0, curPart === 2 ? 1 : 0]; for (let i = 0; i < 3; i++) grade[i] += (tg[i] - grade[i]) * Math.min(1, gDt * 1.4); }
    gl!.uniform3f(pu.grade, grade[0], grade[1], grade[2]);
    gl!.uniform1f(pu.dpr, cv.width / Math.max(1, vw));
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
    // 確認用: この先の並び(表現・区間・長さ)
    plan(n = 40) { seqAt(n); return seq.slice(0, n).map((c, i) => `${secOf[i]}:${c}:${lenOf[i].toFixed(2)}`); },
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
    // 確認用: 展開(48)の時刻を指定する。hold = true で、その時刻に止める
    dev(t: number, hold = true) {
      devT = t;
      devHold = hold;
    },
    get devT() { return devLoop(devT); },
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
