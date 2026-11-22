// Works の一覧「テープ」の版。
//
// 考え方(トップの「描く帯」と同じ):
//   - 列は1本ずつの、平らなテープ。幅は一定、伸びない、陰もない。作品は、テープを直角に切った面。
//   - テープの「通り道」は画面の上にある。ふだんは、まっすぐな縦の線。
//   - 指(PC ではカーソル)を動かすと、指の通った跡が、そのまま通り道になる。
//     指の下のテープは指についてくる。うしろのテープは、指の通った跡をなぞって流れる(ひもを引くのと同じ)。
//   - テープは伸びないので、横へ引くと、上下のテープが指のほうへ たぐり寄せられる。
//   - 指を離すと、線は勢いで少し先まで伸び、そのあと、ばねで まっすぐへ戻る。そのあいだも作品は、曲がった通り道を流れ続ける。
//
// 作り:
//   - 通り道の横ずれは、画面の高さごとの値(場)で持つ。場は、ばね・張り・減衰で動く。指の下だけ、指の位置に合わせ続ける。
//   - 列ごとに、場から中心線をつくり、線に沿った長さで作品の位置を決める(伸びない)。面のふちは、中心線から直角に幅の半分。
//   - 写真と文字は、面ごと動かして回すだけ(歪めない)。写真は、面の形で裁つ。線は、作品ごとの小さな SVG。
//   - 静まったら、何も動かさない。ふつうの升目に戻る。

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

export function mountTape(root: HTMLElement, list: HTMLElement, animate: boolean) {
  let G: TapeGrid | null = null;
  type Cl = { f: HTMLElement | null; tx: HTMLElement | null; cap: SVGPathElement; pho: SVGPathElement };
  let cls: Cl[] = [];
  const dirty = new Set<number>(); // まっすぐでない形で描いてある作品

  // ---------- 場(通り道の横ずれ。画面の高さ −PAD 〜 画面の下 +PAD)
  const HS = 16; // 場のきざみ
  const PAD = 420;
  const OMEGA = 4.3; // まっすぐへ戻る ばね の速さ
  const ZETA = 0.7; // 減衰(1 より小さいと、少し行きすぎてから戻る)
  let LSP = 86; // 指の先で、通り道がなめらかにつながる長さ(テープの幅に合わせる)
  const ETA = 1900; // 細かい折れをならす
  let SIG = 27; // 指の太さ(同上)
  const SMAX = 0.95; // 面の傾きの上限(約 43 度)
  let FX = new Float32Array(0); // 横ずれ
  let FV = new Float32Array(0); // その速さ
  let FP = new Float32Array(0); // そこを書いたときの、指の横位置(一覧の左端から)
  let fN = 0;
  let vh = 0;
  function ensureField() {
    vh = window.innerHeight;
    // 場の長さは、増やすだけ(スマホは送るたびに画面の高さが変わる。そのたびに作り直すと、動きが途切れる)。
    const n = Math.ceil((Math.max(vh, window.screen?.height || 0) + PAD * 2) / HS) + 1;
    if (n > fN) {
      const grow = (a: Float32Array) => {
        const b = new Float32Array(n);
        b.set(a);
        return b;
      };
      FX = grow(FX);
      FV = grow(FV);
      FP = grow(FP);
      fN = n;
    }
  }
  // 点のあいだは、なめらかな曲線でつなぐ。
  const fieldAt = (y: number) => {
    const f = Math.max(0, Math.min(fN - 1, (y + PAD) / HS));
    const i = Math.min(fN - 2, Math.floor(f));
    const t = f - i;
    const p0 = FX[i > 0 ? i - 1 : 0];
    const p1 = FX[i];
    const p2 = FX[i + 1];
    const p3 = FX[i + 2 < fN ? i + 2 : fN - 1];
    return p1 + 0.5 * t * (p2 - p0 + t * (2 * p0 - 5 * p1 + 4 * p2 - p3 + t * (3 * (p1 - p2) + p3 - p0)));
  };
  const penXAt = (y: number) => {
    const f = Math.max(0, Math.min(fN - 1, (y + PAD) / HS));
    const i = Math.min(fN - 2, Math.floor(f));
    return FP[i] + (FP[i + 1] - FP[i]) * (f - i);
  };
  // 高さ y のまわりを、横へ d だけ動かす。速さは vel にそろえる。w は効かせる強さ(0〜1)。
  function push(y: number, d: number, vel: number, penX: number, w0: number) {
    const c = Math.round((y + PAD) / HS);
    const span = Math.ceil((SIG * 2.6) / HS);
    for (let j = Math.max(0, c - span); j <= Math.min(fN - 1, c + span); j++) {
      const w = Math.exp(-(((j * HS - PAD - y) / SIG) ** 2)) * w0;
      FX[j] += d * w;
      FV[j] += (vel - FV[j]) * w;
      FP[j] += (penX - FP[j]) * w;
    }
  }

  // ---------- 列ごとの通り道
  const DYP = 8;
  let K = 0;
  let pX = new Float32Array(0); // 中心線の横位置(一覧の左端から)
  let pS = new Float32Array(0); // 傾き
  let pL = new Float32Array(0); // テープの上の位置(一覧の上端からの長さ)
  let pA = new Float32Array(0); // 作業用
  let pB = new Float32Array(0);
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
  let Y0 = 0;
  let qx = 0;
  let qy = 0;
  let qs = 0;
  function buildPath(c: number, listTop: number, anchorY: number) {
    const { cw, g } = G!;
    const hx = c * (cw + g) + cw / 2;
    const lim = cw * 0.62; // 横へ動ける幅(端は壁にせず、近づくほど ゆるやかに)
    const sw = 1.25 * (cw + g);
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
      const y = Y0 + i * DYP;
      const f = fieldAt(y);
      if (f > -0.02 && f < 0.02) {
        pX[i] = hx;
        continue;
      }
      bent = true;
      // 指に近い列ほど、よく動く(列ごとに少しずつ違う動きになる)。
      const dxp = (hx - penXAt(y)) / sw;
      pX[i] = hx + lim * Math.tanh(f / lim) * (0.64 + 0.36 * Math.exp(-dxp * dxp));
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

  // ---------- 描画
  const eL: number[] = [];
  const eR: number[] = [];
  const loc: number[] = [];
  // テープの la〜lb のふち(左と右)。中心線から、直角に幅の半分。
  function edges(la: number, lb: number, listTop: number) {
    const half = G!.cw / 2;
    eL.length = 0;
    eR.length = 0;
    const k = Math.max(1, Math.round((lb - la) / 12));
    for (let i = 0; i <= k; i++) {
      ptAt(la + ((lb - la) * i) / k);
      const q = 1 / Math.sqrt(1 + qs * qs);
      const y = qy - listTop;
      eL.push(qx - half * q, y + half * qs * q);
      eR.push(qx + half * q, y - half * qs * q);
    }
  }
  const ring = (ox: number, oy: number) => {
    let d = '';
    for (let i = 0; i < eL.length; i += 2) d += `${i ? 'L' : 'M'}${(eL[i] - ox).toFixed(1)} ${(eL[i + 1] - oy).toFixed(1)}`;
    for (let i = eR.length - 2; i >= 0; i -= 2) d += `L${(eR[i] - ox).toFixed(1)} ${(eR[i + 1] - oy).toFixed(1)}`;
    return d + 'Z';
  };
  function restCell(idx: number) {
    const el = cls[idx];
    if (!el || !G) return;
    const { cw, ph, rowH } = G;
    const f1 = (v: number) => v.toFixed(1);
    el.pho.setAttribute('d', `M0 0L${f1(cw)} 0L${f1(cw)} ${f1(ph)}L0 ${f1(ph)}Z`);
    el.cap.setAttribute('d', `M0 ${f1(ph)}L${f1(cw)} ${f1(ph)}L${f1(cw)} ${f1(rowH)}L0 ${f1(rowH)}Z`);
    if (el.f) {
      el.f.style.transform = '';
      el.f.style.clipPath = '';
    }
    if (el.tx) el.tx.style.transform = '';
  }
  function drawCell(idx: number, r: number, c: number, listTop: number) {
    const el = cls[idx];
    if (!el) return;
    const { cw, g, ph, rowH } = G!;
    const hx = c * (cw + g) + cw / 2;
    const l0 = r * rowH;
    const l1 = l0 + ph;
    const l2 = l0 + rowH;
    const ox0 = c * (cw + g);
    // 写真の面
    ptAt(l0);
    const ax = qx;
    const ay = qy - listTop;
    ptAt(l1);
    const bx = qx;
    const by = qy - listTop;
    ptAt(l2);
    const cx = qx;
    const cy = qy - listTop;
    edges(l0, l1, listTop);
    el.pho.setAttribute('d', ring(ox0, l0));
    if (el.f) {
      const mx = (ax + bx) / 2;
      const my = (ay + by) / 2;
      const phi = Math.atan2(bx - ax, by - ay);
      const cs = Math.cos(phi);
      const sn = Math.sin(phi);
      const bw = cw * 1.18; // 写真の箱は、面より少し大きい(回したり曲がったりしても、面を覆えるように)
      const bh = ph * 1.1;
      // 面の形を、写真の箱の中の位置に直す。箱からはみ出すぶんは、写真を少し大きくして覆う(歪めない)。
      loc.length = 0;
      let sc = 1;
      const add = (x: number, y: number) => {
        const vx = x - mx;
        const vy = y - my;
        const lx = vx * cs - vy * sn;
        const ly = vx * sn + vy * cs;
        loc.push(lx, ly);
        const need = Math.max(Math.abs(lx) / (bw / 2), Math.abs(ly) / (bh / 2));
        if (need > sc) sc = need;
      };
      for (let i = 0; i < eL.length; i += 2) add(eL[i], eL[i + 1]);
      for (let i = eR.length - 2; i >= 0; i -= 2) add(eR[i], eR[i + 1]);
      sc = Math.min(1.6, sc > 1 ? sc * 1.01 : 1);
      let poly = '';
      for (let i = 0; i < loc.length; i += 2) poly += `${i ? ',' : ''}${(loc[i] / sc + bw / 2).toFixed(1)}px ${(loc[i + 1] / sc + bh / 2).toFixed(1)}px`;
      el.f.style.clipPath = `polygon(${poly})`;
      el.f.style.transform = `translate3d(${(mx - hx).toFixed(2)}px,${(my - (l0 + ph / 2)).toFixed(2)}px,0) rotate(${(-phi).toFixed(4)}rad)${sc > 1 ? ` scale(${sc.toFixed(4)})` : ''}`;
    }
    // 文字の面
    edges(l1, l2, listTop);
    el.cap.setAttribute('d', ring(ox0, l0));
    if (el.tx) {
      const mx = (bx + cx) / 2;
      const my = (by + cy) / 2;
      const phi = Math.atan2(cx - bx, cy - by);
      el.tx.style.transform = `translate3d(${(mx - hx).toFixed(2)}px,${(my - (l1 + (rowH - ph) / 2)).toFixed(2)}px,0) rotate(${(-phi).toFixed(4)}rad)`;
    }
  }
  function drawAll(listTop: number, anchorY: number) {
    const { n, cols, rowH, R } = G!;
    const seen = new Set<number>();
    for (let c = 0; c < cols; c++) {
      buildPath(c, listTop, anchorY);
      const r0 = Math.max(0, Math.floor(lamAtY(-160) / rowH));
      const r1 = Math.min(R - 1, Math.floor(lamAtY(vh + 160) / rowH));
      for (let r = r0; r <= r1; r++) {
        const idx = r * cols + c;
        if (idx >= n) break;
        drawCell(idx, r, c, listTop);
        seen.add(idx);
      }
    }
    // 画面の外へ出た作品は、まっすぐに戻しておく。
    dirty.forEach((idx) => {
      if (!seen.has(idx)) restCell(idx);
    });
    dirty.clear();
    seen.forEach((idx) => dirty.add(idx));
  }

  // ---------- 入力と動き
  let raf = 0;
  let lastT = 0;
  let penX = 0; // 指 / カーソル(画面の中)
  let penY = -1;
  let touching = false;
  let grab = 0; // つかんだ瞬間の、そこの横ずれ
  let startX = 0;
  let target = 0; // 指の下を、いま置きたい横ずれ
  let prevTarget = 0;
  let holdUntil = 0; // トラックパッドとマウスは、横に動かしているあいだ(と、その直後)だけ、持っている扱い
  let lastMX: number | null = null;
  let tvx = 0; // 指の速さ(px/秒)
  let tvy = 0;
  let lastTX = 0;
  let lastTY = 0;
  let lastTT = 0;
  // 指を離したあと、線は勢いで少し先まで伸びる(見えないペンが、離したときの速さで進み、すぐ弱まる)。
  const GHOST = 0.3;
  let ghost = 0; // 残り時間(秒)
  let gx = 0;
  let gy = 0;
  let gvx = 0;
  let gvy = 0;
  let anchorY = -1;
  const GAIN_TOUCH = 1.3;
  const GAIN_WHEEL = 0.9;
  const GAIN_MOUSE = 0.6;

  function tick(t: number) {
    raf = 0;
    if (!G || !G.n) return;
    const t0 = performance.now();
    // 確認用: window.__tapeSlow に数を入れると、その倍だけ ゆっくり動く(連続写真を撮るため)。
    const dt = Math.min(0.05, Math.max(0.001, (t - lastT) / 1000)) / ((window as unknown as { __tapeSlow?: number }).__tapeSlow || 1);
    lastT = t;
    ensureField();
    const rect = list.getBoundingClientRect();
    const now = performance.now();
    const maxT = G.cw * 0.62 * 1.7;
    if (penY < 0) penY = vh * 0.5;
    if (anchorY < 0) anchorY = penY;
    // いま持っている点
    let hold = 0;
    let hy = penY;
    let hx = penX;
    if (touching) hold = 1;
    else if (ghost > 0) {
      const k = Math.exp(-dt / 0.13);
      gx += gvx * dt;
      gy += gvy * dt;
      target = Math.max(-maxT, Math.min(maxT, target + gvx * GAIN_TOUCH * dt));
      gvx *= k;
      gvy *= k;
      hold = Math.max(0, ghost / GHOST) ** 1.5;
      hy = gy;
      hx = gx;
      ghost -= dt;
    } else if (now < holdUntil) hold = 1;
    const vT = (target - prevTarget) / dt;
    // 場を進める
    const k0 = OMEGA * OMEGA;
    const c0 = 2 * ZETA * OMEGA;
    const sub = Math.max(1, Math.ceil((OMEGA * LSP * dt) / (0.5 * HS)));
    const h = dt / sub;
    const k2 = (k0 * LSP * LSP) / (HS * HS);
    const e2 = ETA / (HS * HS);
    let maxV = 0;
    let maxX = 0;
    for (let s = 0; s < sub; s++) {
      if (hold > 0) push(hy, prevTarget + ((target - prevTarget) * (s + 1)) / sub - fieldAt(hy), vT, hx - rect.left, hold);
      let xm = FX[0];
      let vm = FV[0];
      for (let i = 0; i < fN; i++) {
        const ip = i + 1 < fN ? i + 1 : i;
        const xi = FX[i];
        const vi = FV[i];
        FV[i] = vi + (k2 * (xm - 2 * xi + FX[ip]) + e2 * (vm - 2 * vi + FV[ip]) - c0 * vi - k0 * xi) * h;
        xm = xi;
        vm = vi;
      }
      maxV = 0;
      maxX = 0;
      for (let i = 0; i < fN; i++) {
        FX[i] += FV[i] * h;
        const av = FV[i] < 0 ? -FV[i] : FV[i];
        const ax = FX[i] < 0 ? -FX[i] : FX[i];
        if (av > maxV) maxV = av;
        if (ax > maxX) maxX = ax;
      }
    }
    prevTarget = target;
    // テープを たぐる 中心は、指のある高さ(指の下の作品は、指についてくる)。
    if (touching) anchorY = penY;
    else if (ghost <= 0) anchorY += (penY - anchorY) * (1 - Math.exp(-dt / 0.12));
    root.dataset.amp = fieldAt(hy).toFixed(1); // 確認用
    if (hold <= 0 && maxV < 1 && maxX < 0.15) {
      // 静まった。まっすぐに戻して、止める。
      FX.fill(0);
      FV.fill(0);
      root.dataset.amp = '0';
      dirty.forEach(restCell);
      dirty.clear();
      return;
    }
    drawAll(rect.top, anchorY);
    root.dataset.ms = (performance.now() - t0).toFixed(1); // 確認用: 1コマの計算にかかった時間
    raf = requestAnimationFrame(tick);
  }
  function kick() {
    if (raf || !G || !animate) return;
    lastT = performance.now() - 16;
    raf = requestAnimationFrame(tick);
  }
  // トラックパッドとマウス: 横に d だけ動かした。カーソルの下を、そのぶん引く。
  // leak: マウスは、ゆっくり動かすあいだは ほとんど引かない(作品を押そうとして狙うとき、的が逃げないように)。速く払うと、大きく引く。
  let lastNudge = 0;
  function nudge(d: number, leak: boolean) {
    if (!G) return;
    const now = performance.now();
    if (now >= holdUntil || ghost > 0) {
      ensureField();
      grab = fieldAt(penY); // いまある位置からつかむ
      target = prevTarget = grab;
      ghost = 0;
    }
    if (leak) target *= Math.exp(-Math.min(0.2, (now - lastNudge) / 1000) / 0.16);
    lastNudge = now;
    const m = G.cw * 0.62 * (leak ? 0.75 : 1.7);
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
      const sp = Math.hypot(tvx, tvy);
      if (sp > 120 && now - lastTT < 80) {
        ghost = GHOST;
        gx = penX;
        gy = penY;
        gvx = tvx;
        gvy = tvy;
      }
      kick();
      return;
    }
    const tc = e.touches[0];
    if (e.type === 'touchstart' || !touching) {
      ensureField();
      touching = true;
      ghost = 0;
      holdUntil = 0;
      penX = tc.clientX;
      penY = tc.clientY;
      startX = tc.clientX;
      grab = fieldAt(penY); // 触れた点を、いまある位置からつかむ
      target = prevTarget = grab;
      tvx = tvy = 0;
    } else {
      const dt = Math.max(0.004, (now - lastTT) / 1000);
      tvx += ((tc.clientX - lastTX) / dt - tvx) * 0.4;
      tvy += ((tc.clientY - lastTY) / dt - tvy) * 0.4;
      penX = tc.clientX;
      penY = tc.clientY;
      const m = G.cw * 0.62 * 1.7;
      target = Math.max(-m, Math.min(m, grab + (tc.clientX - startX) * GAIN_TOUCH));
    }
    lastTX = tc.clientX;
    lastTY = tc.clientY;
    lastTT = now;
    kick();
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
      root.dataset.amp = '0';
      G = grid;
      SIG = Math.max(27, grid.cw * 0.17);
      LSP = Math.max(86, grid.cw * 0.42);
      cancelAnimationFrame(raf);
      raf = 0;
      FX.fill(0);
      FV.fill(0);
      ghost = 0;
      holdUntil = 0;
      dirty.clear();
      cls = grid.rows.map((li) => {
        let o = li.querySelector<SVGSVGElement>('svg[data-tape]');
        if (!o) {
          o = document.createElementNS(SVGNS, 'svg') as SVGSVGElement;
          o.setAttribute('data-tape', '');
          o.setAttribute('aria-hidden', 'true');
          o.style.cssText = 'position:absolute;left:0;top:0;width:1px;height:1px;overflow:visible;pointer-events:none;z-index:1';
          for (const fill of ['#000', 'none']) {
            const p = document.createElementNS(SVGNS, 'path');
            p.style.cssText = `fill:${fill};stroke:var(--fg);stroke-width:1px;stroke-linejoin:round`;
            o.appendChild(p);
          }
          li.appendChild(o);
        }
        const ps = o.querySelectorAll('path');
        return {
          f: li.querySelector<HTMLElement>('[data-face]'),
          tx: li.querySelector<HTMLElement>('.cl-text'),
          cap: ps[0],
          pho: ps[1],
        };
      });
      for (let i = 0; i < cls.length; i++) restCell(i);
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
      for (let i = 0; i < cls.length; i++) restCell(i);
    },
  };
}
