// 描く。
//
// 指(またはドラッグ)でなぞると、その軌跡が太い帯になり、帯の中に作品が順に現れる。
// 紙は「画面の長辺から28°」の向きにゆっくり流れ続けるので、描いた帯は斜めに流れて画面から出ていく。
// 帯の中の作品を押すと、帯がその場でひらいて作品の全体になる(線が面になる)。もう一度押すと、その作品のページへ。
//
// 磨いたところ:
//   ・筆は指を少し遅れて追う。手の震えが消え、弧がなめらかになる
//   ・帯はひと続きの形として作る。作品の境目はまっすぐな切れ目になる
//   ・重なったところは細い黒の縁で分かれる(紙が重なって見える)
//   ・帯が増えすぎたら、古いものから巻き取られて消える
//
// スマホを基準にしている: 指で描くだけ。送る操作はない。
// 誰も触っていないあいだは、ペンがひとりでに描く。写真は歪めない・透かさない。

import { navigate } from 'astro:transitions/client';
import { coverFromStroke } from './band';

type Pt = { x: number; y: number };

interface Seg {
  pts: Pt[]; // 帯の芯(紙の上の座標)
  nrm: Pt[]; // 各点での、帯の幅の向き
  len: number;
  work: number;
  pat: CanvasPattern | null;
  big: boolean; // 大きい画像で塗っているか
  k: number; // 写真の倍率と位置(帯のとき)
  tx: number;
  ty: number;
  open: boolean; // まだ描いている途中
  trim: number; // 0→1 で、描きはじめの側から巻き取られる
  trimming: boolean;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

interface Bloom {
  seg: Seg;
  t: number; // 0=帯 / 1=作品の全体
  dir: 1 | -1;
  x: number; // ひらいたときの四角(紙の上の座標)
  y: number;
  w: number;
  h: number;
  k: number;
}

const ANGLE = 28; // 画面の長辺からの角度(度)
const PULL = 120; // 出口の帯を、これだけ引き伸ばして離すと移動する(px)

export function mountDraw(root: HTMLElement): () => void {
  const canvas = root.querySelector<HTMLCanvasElement>('[data-canvas]')!;
  const ctx = canvas.getContext('2d')!;
  const label = root.querySelector<HTMLElement>('[data-label]');
  const openLink = root.querySelector<HTMLAnchorElement>('[data-open]');
  const works = Array.from(root.querySelectorAll<HTMLAnchorElement>('[data-work]')).map((a) => {
    const img = new Image();
    img.decoding = 'async';
    img.src = a.dataset.src || '';
    return { title: a.textContent?.trim() || '', href: a.href, img, large: a.dataset.large || '', big: null as HTMLImageElement | null };
  });
  const html = document.documentElement;
  const idleLabel = label?.textContent || '';

  let w = 0;
  let h = 0;
  let dpr = 1;
  let W = 100; // 帯の太さ
  let L = 150; // 作品1つぶんの長さ
  let cap = 12; // 画面に残す帯の数(作品の数)
  let dx = 0;
  let dy = -1;
  let offX = 0; // 紙のずれ(画面 = 紙 + ずれ)
  let offY = 0;
  let base = 40; // 紙の流れる速さ(px/秒)
  let boost = 0;
  let segs: Seg[] = [];
  let cur: Seg | null = null;
  let bloom: Bloom | null = null;
  let nextWork = 0;
  let raf = 0;
  let last = 0;
  let lastUser = -1e9;

  // 指(目標)と筆(実際に描く位置)。筆は指を少し遅れて追う。
  let pointerDown = false;
  let moved = false;
  let releasing = false;
  let downAt: Pt = { x: 0, y: 0 };
  // ---- 出口の帯 ----
  // 右下の角の外に根があり、紙の流れと同じ向きに画面へ差し込まれている、ゴムのような白い帯。
  // つまんで引くと、根の形ごと伸びる(細くなる)。離すと、ぷるんと戻るか、太って次のページになる。
  const exit = root.querySelector<HTMLAnchorElement>('[data-band]');
  const exitWord = exit?.textContent?.trim() || '';
  const tape = {
    rx: 0, // 根(画面の外)
    ry: 0,
    hx: 0, // 休んでいるときの先端
    hy: 0,
    ux: 1, // 根から先端へ向かう向き
    uy: 0,
    len0: 240,
    wt: 46,
    x: 0, // 先端
    y: 0,
    vx: 0,
    vy: 0,
    mx: 0, // 胴の中ほど(先端より遅れて動く)
    my: 0,
    mvx: 0,
    mvy: 0,
    grab: false,
    gx: 0,
    gy: 0,
    moved: false,
    nudge: 3.2,
    gone: false,
  };
  let suppressClick = 0;
  const finger: Pt = { x: 0, y: 0 };
  const pen: Pt = { x: 0, y: 0 };

  root.classList.add('is-live');
  html.classList.add('draw-on');

  function measure() {
    w = root.clientWidth;
    h = root.clientHeight;
    dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    const small = Math.min(w, h) < 640;
    W = small ? Math.round(Math.min(w, h) * 0.27) : 168;
    L = Math.round(W * 1.5);
    cap = small ? 11 : 16;
    base = small ? 40 : 62;
    const a = (ANGLE * Math.PI) / 180;
    // 長辺から28°。縦長なら縦から、横長なら横から測る。紙は左上へ流れる。
    if (h > w) {
      dx = -Math.sin(a);
      dy = -Math.cos(a);
    } else {
      dx = -Math.cos(a);
      dy = -Math.sin(a);
    }
    // 出口の帯: 右の縁の下のほうから、紙の流れの向きへ差し込む。
    tape.ux = dx;
    tape.uy = dy;
    const ex = w;
    const ey = h - 52;
    tape.rx = ex - dx * 72;
    tape.ry = ey - dy * 72;
    tape.hx = tape.rx + dx * tape.len0;
    tape.hy = tape.ry + dy * tape.len0;
    if (!tape.grab) {
      tape.x = tape.hx;
      tape.y = tape.hy;
      tape.mx = (tape.rx + tape.hx) / 2;
      tape.my = (tape.ry + tape.hy) / 2;
      tape.vx = tape.vy = tape.mvx = tape.mvy = 0;
    }
  }

  // ---- ペン ----
  function newSeg(p: Pt, n: Pt): Seg {
    const s: Seg = {
      pts: [p],
      nrm: [n],
      len: 0,
      work: nextWork,
      pat: null,
      big: false,
      k: 1,
      tx: 0,
      ty: 0,
      open: true,
      trim: 0,
      trimming: false,
      x0: p.x,
      y0: p.y,
      x1: p.x,
      y1: p.y,
    };
    nextWork = (nextWork + 1) % works.length;
    segs.push(s);
    return s;
  }

  // 帯の中の写真の置き場所を決める。歪めず、正立のまま、帯のまわりを覆う大きさで置く。
  function lock(s: Seg) {
    const img = works[s.work].img;
    if (!img.complete || !img.naturalWidth) return;
    const a = s.pts[0];
    const b = s.pts[s.pts.length - 1];
    const l = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const cx = a.x + ((b.x - a.x) / l) * (L / 2);
    const cy = a.y + ((b.y - a.y) / l) * (L / 2);
    const side = L + W;
    s.k = side / Math.min(img.naturalWidth, img.naturalHeight);
    s.tx = cx - (img.naturalWidth * s.k) / 2;
    s.ty = cy - (img.naturalHeight * s.k) / 2;
    s.pat = ctx.createPattern(img, 'repeat');
    s.pat?.setTransform(new DOMMatrix([s.k, 0, 0, s.k, s.tx, s.ty]));
  }

  function penDown(p: Pt) {
    cur = newSeg(p, { x: 0, y: 0 });
  }
  function penMove(p: Pt) {
    if (!cur) return;
    const q = cur.pts[cur.pts.length - 1];
    const d = Math.hypot(p.x - q.x, p.y - q.y);
    if (d < 4) return;
    // 幅の向き(進む向きに直交)。前の点となじませて、縁をなめらかにする。
    let nx = -(p.y - q.y) / d;
    let ny = (p.x - q.x) / d;
    const pn = cur.nrm[cur.nrm.length - 1];
    if (pn.x || pn.y) {
      nx = nx * 0.6 + pn.x * 0.4;
      ny = ny * 0.6 + pn.y * 0.4;
      const l = Math.hypot(nx, ny) || 1;
      nx /= l;
      ny /= l;
    } else {
      // 描きはじめの点には、最初の向きをそのまま入れる。
      cur.nrm[cur.nrm.length - 1] = { x: nx, y: ny };
    }
    cur.pts.push(p);
    cur.nrm.push({ x: nx, y: ny });
    cur.len += d;
    cur.x0 = Math.min(cur.x0, p.x);
    cur.y0 = Math.min(cur.y0, p.y);
    cur.x1 = Math.max(cur.x1, p.x);
    cur.y1 = Math.max(cur.y1, p.y);
    if (!cur.pat && cur.len >= 20) lock(cur);
    if (cur.len >= 20) setLabel(works[cur.work].title);
    if (cur.len >= L) {
      // 作品の境目。次の帯は、同じ点・同じ向きから始める(切れ目がまっすぐになる)。
      cur.open = false;
      cur = newSeg(p, { x: nx, y: ny });
    }
  }
  function dropSeg(s: Seg) {
    segs = segs.filter((x) => x !== s);
    nextWork = (nextWork - 1 + works.length) % works.length;
  }
  function penUp() {
    if (!cur) return;
    cur.open = false;
    if (cur.pts.length < 2) dropSeg(cur); // 点だけで終わったものは残さない
    cur = null;
    // 増えすぎたら、古いものから巻き取る。
    let live = segs.filter((s) => !s.trimming).length;
    for (const s of segs) {
      if (live <= cap) break;
      if (s.trimming || s === bloom?.seg) continue;
      s.trimming = true;
      live--;
    }
  }

  let labelText = idleLabel;
  function setLabel(t: string) {
    if (!label || t === labelText) return;
    labelText = t;
    label.textContent = t;
  }

  // ---- 押した場所にある作品 ----
  function hit(x: number, y: number): Seg | null {
    const px = x - offX;
    const py = y - offY;
    for (let i = segs.length - 1; i >= 0; i--) {
      const s = segs[i];
      if (s.trimming) continue;
      if (px < s.x0 - W / 2 || px > s.x1 + W / 2 || py < s.y0 - W / 2 || py > s.y1 + W / 2) continue;
      for (let j = 1; j < s.pts.length; j++) {
        const a = s.pts[j - 1];
        const b = s.pts[j];
        const vx = b.x - a.x;
        const vy = b.y - a.y;
        const t = Math.max(0, Math.min(1, ((px - a.x) * vx + (py - a.y) * vy) / (vx * vx + vy * vy || 1)));
        if (Math.hypot(px - (a.x + vx * t), py - (a.y + vy * t)) <= W / 2) return s;
      }
    }
    return null;
  }
  const inBloom = (x: number, y: number) =>
    !!bloom &&
    x - offX >= bloom.x &&
    x - offX <= bloom.x + bloom.w &&
    y - offY >= bloom.y &&
    y - offY <= bloom.y + bloom.h;

  // ---- ひらく(線が面になる) ----
  function openBloom(s: Seg) {
    const wk = works[s.work];
    const img = wk.img;
    if (!img.naturalWidth) return;
    const ar = img.naturalWidth / img.naturalHeight;
    const bw = Math.min(w - 40, (h * 0.56) * ar, 860);
    const bh = bw / ar;
    // 帯の中心あたりにひらく。画面からはみ出さないよう寄せる。
    const cx = (s.x0 + s.x1) / 2 + offX;
    const cy = (s.y0 + s.y1) / 2 + offY;
    const x = Math.max(20, Math.min(w - 20 - bw, cx - bw / 2));
    const y = Math.max(76, Math.min(h - 150 - bh, cy - bh / 2));
    bloom = { seg: s, t: 0, dir: 1, x: x - offX, y: y - offY, w: bw, h: bh, k: bw / img.naturalWidth };
    setLabel(wk.title);
    if (openLink) {
      openLink.href = wk.href;
      openLink.textContent = `${wk.title}  →`;
    }
    // 大きい画像を読んでおく(ひらいたときに粗く見えないように)。
    if (!wk.big && wk.large) {
      const b = new Image();
      b.decoding = 'async';
      b.src = wk.large;
      wk.big = b;
    }
  }
  function closeBloom() {
    if (bloom) bloom.dir = -1;
  }

  // ---- ひとりでに描くペン ----
  let seed = 20261116;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const auto = { on: false, x: 0, y: 0, heading: 0, turn: 0, left: 0, wait: 0.15 };
  let autoSide = 1;
  function autoStep(dt: number, now: number) {
    if (pointerDown || releasing || bloom || tape.grab || now - lastUser < 3500) {
      if (auto.on) {
        penUp();
        auto.on = false;
        auto.wait = 0.4;
      }
      return;
    }
    if (!auto.on) {
      auto.wait -= dt;
      if (auto.wait > 0) return;
      // 流れを横切る向きに、ゆるい弧で描く。流れの上手(右下寄り)から描きはじめる。
      autoSide = -autoSide;
      const m0 = Math.min(w, h);
      auto.heading = Math.atan2(dy, dx) + (Math.PI / 2) * autoSide + (rnd() - 0.5) * 1.1;
      auto.x = w / 2 - Math.cos(auto.heading) * m0 * 0.36 - dx * m0 * (0.2 + rnd() * 0.25) + (rnd() - 0.5) * m0 * 0.2;
      auto.y = h / 2 - Math.sin(auto.heading) * m0 * 0.36 - dy * m0 * (0.2 + rnd() * 0.25) + (rnd() - 0.5) * m0 * 0.2;
      auto.turn = (rnd() - 0.5) * 1.1;
      auto.left = L * (2.4 + rnd() * 1.8);
      auto.on = true;
      penDown({ x: auto.x - offX, y: auto.y - offY });
      return;
    }
    const v = Math.min(w, h) * 0.62; // ペンの速さ(px/秒)
    auto.heading += auto.turn * dt;
    auto.turn += (rnd() - 0.5) * dt * 2;
    auto.turn = Math.max(-0.75, Math.min(0.75, auto.turn));
    auto.x += Math.cos(auto.heading) * v * dt;
    auto.y += Math.sin(auto.heading) * v * dt;
    auto.left -= v * dt;
    penMove({ x: auto.x - offX, y: auto.y - offY });
    const out = auto.x < -W || auto.x > w + W || auto.y < -W || auto.y > h + W;
    if (auto.left <= 0 || out) {
      penUp();
      auto.on = false;
      auto.wait = 2.2 + rnd() * 1.2;
    }
  }

  // ---- 描画 ----
  function outline(s: Seg, from: number) {
    const n = s.pts.length;
    const hw = W / 2;
    ctx.beginPath();
    ctx.moveTo(s.pts[from].x + s.nrm[from].x * hw, s.pts[from].y + s.nrm[from].y * hw);
    for (let i = from + 1; i < n; i++) ctx.lineTo(s.pts[i].x + s.nrm[i].x * hw, s.pts[i].y + s.nrm[i].y * hw);
    for (let i = n - 1; i >= from; i--) ctx.lineTo(s.pts[i].x - s.nrm[i].x * hw, s.pts[i].y - s.nrm[i].y * hw);
    ctx.closePath();
  }

  function paintSeg(s: Seg) {
    if (s.pts.length < 2) return;
    if (!s.pat) lock(s);
    const from = Math.min(s.pts.length - 2, Math.floor(s.trim * (s.pts.length - 1)));
    outline(s, from);
    ctx.fillStyle = s.pat || '#161614';
    ctx.fill('nonzero');
    // 細い黒の縁。重なりと境目を分ける。
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#000';
    ctx.stroke();
  }

  function paintBloom(b: Bloom) {
    const s = b.seg;
    const wk = works[s.work];
    // ひらいていくにつれ、写真は「帯の中の置き方」から「全体が見える置き方」へ移る。
    const e = 1 - Math.pow(1 - b.t, 3);
    const useBig = !!wk.big && wk.big.complete && wk.big.naturalWidth > 0;
    const img = useBig ? wk.big! : wk.img;
    const ratio = wk.img.naturalWidth / img.naturalWidth; // 小さい画像を基準にした倍率の補正
    const k = (s.k + (b.k - s.k) * e) * ratio;
    const tx = s.tx + (b.x - s.tx) * e;
    const ty = s.ty + (b.y - s.ty) * e;
    const pat = ctx.createPattern(img, 'repeat');
    if (!pat) return;
    pat.setTransform(new DOMMatrix([k, 0, 0, k, tx, ty]));
    // 塗るのは「作品の四角」と「いまの写真の範囲」が重なるところだけ(写真の外は塗らない)。
    const iw = img.naturalWidth * k;
    const ih = img.naturalHeight * k;
    const cx0 = Math.max(b.x, tx);
    const cy0 = Math.max(b.y, ty);
    const cx1 = Math.min(b.x + b.w, tx + iw);
    const cy1 = Math.min(b.y + b.h, ty + ih);
    if (cx1 <= cx0 || cy1 <= cy0) return;
    ctx.save();
    ctx.beginPath();
    ctx.rect(cx0, cy0, cx1 - cx0, cy1 - cy0);
    ctx.clip();
    // 帯が太って、作品の四角を満たしていく。
    const reach = Math.hypot(b.w, b.h);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.lineWidth = W + e * e * reach * 2.2;
    ctx.strokeStyle = pat;
    ctx.beginPath();
    ctx.moveTo(s.pts[0].x, s.pts[0].y);
    for (let i = 1; i < s.pts.length; i++) ctx.lineTo(s.pts[i].x, s.pts[i].y);
    ctx.stroke();
    ctx.restore();
  }

  // ---- 出口の帯: 動きと形 ----
  function stepTape(dt: number, now: number) {
    if (!exit || tape.gone) return;
    // 先端は、つまんでいる指(離していれば休む位置)へ、ばねで寄る。
    const tx = tape.grab ? finger.x + tape.gx : tape.hx;
    const ty = tape.grab ? finger.y + tape.gy : tape.hy;
    const k = tape.grab ? 520 : 150; // 離したときは柔らかく、ぷるんと戻る
    const c = tape.grab ? 38 : 9;
    tape.vx += ((tx - tape.x) * k - tape.vx * c) * dt;
    tape.vy += ((ty - tape.y) * k - tape.vy * c) * dt;
    tape.x += tape.vx * dt;
    tape.y += tape.vy * dt;
    // 胴は、根と先端のあいだの「根から出た向きに寄せた点」へ、遅れて寄る(しなりが出る)。
    const dist = Math.hypot(tape.x - tape.rx, tape.y - tape.ry);
    const cx = tape.rx + tape.ux * dist * 0.5;
    const cy = tape.ry + tape.uy * dist * 0.5;
    tape.mvx += ((cx - tape.mx) * 110 - tape.mvx * 8) * dt;
    tape.mvy += ((cy - tape.my) * 110 - tape.mvy * 8) * dt;
    tape.mx += tape.mvx * dt;
    tape.my += tape.mvy * dt;
    // 触られていないあいだは、ときどき少し伸びて「引ける」ことを見せる。
    if (!tape.grab && !pointerDown && now - lastUser > 2500) {
      tape.nudge -= dt;
      if (tape.nudge <= 0) {
        tape.nudge = 5.5;
        tape.vx += tape.ux * 520;
        tape.vy += tape.uy * 520;
      }
    }
  }

  // 帯の芯(根 → 先端)を、なめらかな弧として取り出す。
  function tapeSpine(n: number): Pt[] {
    // 胴の点を通るように、2次曲線の制御点を決める。
    const qx = 2 * tape.mx - (tape.rx + tape.x) / 2;
    const qy = 2 * tape.my - (tape.ry + tape.y) / 2;
    const pts: Pt[] = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const a = (1 - t) * (1 - t);
      const b = 2 * (1 - t) * t;
      const c2 = t * t;
      pts.push({ x: a * tape.rx + b * qx + c2 * tape.x, y: a * tape.ry + b * qy + c2 * tape.y });
    }
    return pts;
  }

  function paintTape() {
    if (!exit || tape.gone) return;
    const N = 30;
    const sp = tapeSpine(N);
    let len = 0;
    for (let i = 1; i <= N; i++) len += Math.hypot(sp[i].x - sp[i - 1].x, sp[i].y - sp[i - 1].y);
    // 伸びると細く、縮むと太くなる。先端(つまむところ)は太さを保つ。
    const f = Math.max(0.4, Math.min(1.25, Math.pow(len / tape.len0, -0.65)));
    const L1: Pt[] = [];
    const R1: Pt[] = [];
    for (let i = 0; i <= N; i++) {
      const a = sp[Math.max(0, i - 1)];
      const b = sp[Math.min(N, i + 1)];
      const l = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      const t = i / N;
      const e = Math.max(0, Math.min(1, (t - 0.5) / 0.5));
      const head = e * e * (3 - 2 * e);
      const hw = (tape.wt / 2) * (f + (1 - f) * head);
      L1.push({ x: sp[i].x - ((b.y - a.y) / l) * hw, y: sp[i].y + ((b.x - a.x) / l) * hw });
      R1.push({ x: sp[i].x + ((b.y - a.y) / l) * hw, y: sp[i].y - ((b.x - a.x) / l) * hw });
    }
    // 画面に固定された帯なので、紙のずれを打ち消して描く。
    ctx.save();
    ctx.translate(-offX, -offY);
    ctx.beginPath();
    ctx.moveTo(L1[0].x, L1[0].y);
    for (let i = 1; i <= N; i++) ctx.lineTo(L1[i].x, L1[i].y);
    for (let i = N; i >= 0; i--) ctx.lineTo(R1[i].x, R1[i].y);
    ctx.closePath();
    ctx.fillStyle = '#f4f1ea';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#000';
    ctx.stroke();
    // 行き先の名前は、先端のすぐ内側に、帯の向きに沿って置く。
    if (exitWord) {
      const i = N - 4;
      const a = sp[i - 1];
      const b = sp[i + 1];
      let ang = Math.atan2(a.y - b.y, a.x - b.x); // 先端から根へ向かって読む
      if (Math.cos(ang) < 0) ang += Math.PI;
      ctx.translate(sp[i].x, sp[i].y);
      ctx.rotate(ang);
      ctx.fillStyle = '#000';
      ctx.font = '500 14px "Helvetica Neue", Arial, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(exitWord, 0, 1);
    }
    ctx.restore();
  }

  function releaseTape() {
    if (!tape.grab) return;
    tape.grab = false;
    const pulled = Math.hypot(tape.x - tape.hx, tape.y - tape.hy);
    if (tape.moved && pulled >= PULL && exit) {
      // 伸びた帯そのものが太って、次のページになる。
      tape.gone = true;
      coverFromStroke(tapeSpine(30), tape.wt);
      navigate(exit.href);
    }
    // 足りなければ、ばねで戻る。
  }

  function frame(now: number) {
    raf = requestAnimationFrame(frame);
    const dt = last ? Math.min(0.05, (now - last) / 1000) : 0.016;
    last = now;

    // 紙が流れる。作品をひらいているあいだは、ゆっくりにする。
    boost *= Math.exp(-dt / 0.6);
    const sp = (base + boost) * (bloom ? 0.3 : 1);
    offX += dx * sp * dt;
    offY += dy * sp * dt;

    // 筆は指を少し遅れて追う。
    if (pointerDown || releasing) {
      const f = 1 - Math.exp(-dt / 0.07);
      pen.x += (finger.x - pen.x) * f;
      pen.y += (finger.y - pen.y) * f;
      if (moved) penMove({ x: pen.x - offX, y: pen.y - offY });
      if (releasing && Math.hypot(finger.x - pen.x, finger.y - pen.y) < 3) {
        releasing = false;
        penUp();
      }
    }
    autoStep(dt, now);
    stepTape(dt, now);

    // 巻き取り。
    for (const s of segs) if (s.trimming) s.trim = Math.min(1, s.trim + dt / 0.45);
    // 画面の外へ出た帯と、巻き取り終えた帯は捨てる。
    segs = segs.filter((s) => {
      if (s.open || s === bloom?.seg) return true;
      if (s.trim >= 1) return false;
      return !(s.x1 + offX < -W || s.y1 + offY < -W || s.x0 + offX > w + W || s.y0 + offY > h + W);
    });

    if (bloom) {
      bloom.t = Math.max(0, Math.min(1, bloom.t + (bloom.dir * dt) / (bloom.dir > 0 ? 0.62 : 0.34)));
      // 触られないまましばらく経ったら、閉じる。画面の外へ流れ出たときも閉じる。
      if (bloom.dir > 0 && (now - lastUser > 9000 || bloom.y + bloom.h + offY < 40)) bloom.dir = -1;
      if (bloom.dir < 0 && bloom.t <= 0) bloom = null;
    }

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(dpr, 0, 0, dpr, offX * dpr, offY * dpr);
    ctx.lineJoin = 'round';
    // ひらいている帯も、まず帯として描く。その上に、ひらいていく面を重ねる。
    for (const s of segs) paintSeg(s);
    if (bloom && bloom.t > 0.001) paintBloom(bloom);
    paintTape();

    // ひらいた作品の下に、題名と入口を出す。
    if (openLink) {
      const on = !!bloom && bloom.dir > 0 && bloom.t > 0.85;
      openLink.classList.toggle('is-on', on);
      if (bloom) {
        openLink.style.transform = `translate3d(${Math.round(bloom.x + offX)}px, ${Math.round(bloom.y + bloom.h + offY + 12)}px, 0)`;
      }
    }
    root.classList.toggle('is-open', !!bloom && bloom.dir > 0);
  }

  // ---- 入力 ----
  function onDown(e: PointerEvent) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    // 出口の帯をつまむ。
    if (exit && (e.target as HTMLElement).closest('[data-band]') === exit) {
      if (auto.on) {
        penUp();
        auto.on = false;
      }
      tape.grab = true;
      tape.moved = false;
      tape.gx = tape.x - e.clientX;
      tape.gy = tape.y - e.clientY;
      finger.x = downAt.x = e.clientX;
      finger.y = downAt.y = e.clientY;
      lastUser = performance.now();
      return;
    }
    if ((e.target as HTMLElement).closest('[data-keep]')) return;
    if (auto.on) {
      penUp();
      auto.on = false;
    }
    if (releasing) {
      releasing = false;
      penUp();
    }
    pointerDown = true;
    moved = false;
    downAt = { x: e.clientX, y: e.clientY };
    finger.x = pen.x = e.clientX;
    finger.y = pen.y = e.clientY;
    lastUser = performance.now();
  }
  function onMove(e: PointerEvent) {
    if (tape.grab) {
      finger.x = e.clientX;
      finger.y = e.clientY;
      lastUser = performance.now();
      if (Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 8) tape.moved = true;
      return;
    }
    if (!pointerDown) {
      // PC: 帯の上では、押せることを示す。
      if (e.pointerType === 'mouse') {
        const over = inBloom(e.clientX, e.clientY) || !!hit(e.clientX, e.clientY);
        root.classList.toggle('is-over', over);
        if (!bloom) {
          const s = hit(e.clientX, e.clientY);
          if (s) setLabel(works[s.work].title);
        }
      }
      return;
    }
    finger.x = e.clientX;
    finger.y = e.clientY;
    lastUser = performance.now();
    if (!moved && Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 8) {
      // 描きはじめる。ひらいていた作品は帯に戻る。
      moved = true;
      closeBloom();
      penDown({ x: pen.x - offX, y: pen.y - offY });
    }
  }
  function onUp(e: PointerEvent) {
    if (tape.grab) {
      lastUser = performance.now();
      // 引いたあとの誤クリックは止める。押しただけなら、ふつうのリンクとして移動する。
      if (tape.moved) suppressClick = performance.now();
      releaseTape();
      return;
    }
    if (!pointerDown) return;
    pointerDown = false;
    lastUser = performance.now();
    if (moved) {
      releasing = true; // 筆が指の離れた場所に追いつくまで描く
      return;
    }
    // 描かずに押しただけ。
    if (bloom && bloom.dir > 0) {
      if (inBloom(e.clientX, e.clientY)) navigate(works[bloom.seg.work].href);
      else closeBloom();
      return;
    }
    const s = hit(e.clientX, e.clientY);
    if (s && !s.open) openBloom(s);
  }
  function onClickCapture(e: MouseEvent) {
    if (performance.now() - suppressClick < 400) {
      e.preventDefault();
      e.stopPropagation();
    }
  }
  function onWheel(e: WheelEvent) {
    if (e.ctrlKey) return;
    e.preventDefault();
    // ホイールは、紙を速く流す。
    boost = Math.min(1600, boost + Math.abs(e.deltaY + e.deltaX) * 2.2);
    if (bloom) closeBloom();
  }
  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') closeBloom();
  }
  function onResize() {
    measure();
  }

  measure();
  root.addEventListener('click', onClickCapture, true);
  root.addEventListener('pointerdown', onDown);
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);
  root.addEventListener('wheel', onWheel, { passive: false });
  window.addEventListener('keydown', onKey);
  window.addEventListener('resize', onResize);
  raf = requestAnimationFrame(frame);

  return () => {
    cancelAnimationFrame(raf);
    root.removeEventListener('click', onClickCapture, true);
    root.removeEventListener('pointerdown', onDown);
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onUp);
    root.removeEventListener('wheel', onWheel);
    window.removeEventListener('keydown', onKey);
    window.removeEventListener('resize', onResize);
    if (label) label.textContent = idleLabel;
    openLink?.classList.remove('is-on');
    root.classList.remove('is-live', 'is-over', 'is-open');
    html.classList.remove('draw-on');
  };
}
