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
// ゴムの版(data-gum):
//   描く帯も、出口の帯と同じ「ゴム」でできている。速く引き出すと首が細り、少し遅れて太って落ち着く。
//   ゆっくり描けば、これまでどおりの硬い帯になる。先端(指がつまんでいるところ)は太さを保つ。
//
// 行き先の案(data-nav)。最初の画面に、帯や棒は置かない。
//   trace … なぞる。行き先の文字の上から描きはじめた線は白い線になり、離すとその線が太ってページになる
//   edge  … 引き切る。描いている線を行き先の文字の上で離すと、その線が太ってページになる
//   mix   … 混ざる。描いた帯の中に、作品に混じって白い区切り(行き先)が出る。押すとページになる。
//           画面に無い行き先は、次に描かれる線に先に出る(待たせない)。開いた直後は、ペンが続けて2本描く
//
// 紙の版(data-paper): 帯に、少しだけ物の感じを足す。
//   帯は、台の上にゆるく置いたリボン。平らに貼りついているのではなく、長さに沿って、浮いたところと
//   台についたところが交互にある(その山は、ゆっくり帯の上を移っていく)。
//   浮いたところは、少し手前に寄って幅がわずかに広がり、山の斜面に明るい側と暗い側ができる。
//   ほかの帯をまたぐところには影が落ちる(黒い地には影は見えない)。
//   描いているあいだ、先端は指に持ち上げられて浮く。離すと、すっと降りる。写真は歪めない。
//
// スマホを基準にしている: 指で描くだけ。送る操作はない。
// 誰も触っていないあいだは、ペンがひとりでに描く。写真は歪めない・透かさない。

import { navigate } from 'astro:transitions/client';
import { coverFromStroke } from './band';

type Pt = { x: number; y: number };

interface Seg {
  pts: Pt[]; // 帯の芯(紙の上の座標)
  nrm: Pt[]; // 各点での、帯の幅の向き
  cum: number[]; // 描きはじめからの長さ
  wf: number[]; // 各点の太さ(1 = もとの太さ)。ゴムの版で使う
  wv: number[]; // 太さの変わる速さ
  calm: boolean; // 太さが落ち着いた
  prev: Seg | null; // ひと続きに描いた、ひとつ前の帯
  nav: number; // 行き先の番号。作品の帯なら -1
  sid: number; // ひと筆の番号(同じ筆で描いた帯は、同じ番号)
  u0: number; // 筆の描きはじめから、この帯の始まりまでの長さ
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
// ゴムの細り方。出口の帯と描く帯で同じ式を使う(2倍に伸ばすと、約6割の太さ)。
const thin = (stretch: number) => Math.pow(Math.max(0.01, stretch), -0.65);

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
  const gum = root.hasAttribute('data-gum'); // 描く帯もゴムにする版
  const paper = root.hasAttribute('data-paper'); // 紙の版(浮きと影)
  let strokeId = 0;
  let liftSid = -1; // いま(または直前に)持ち上げている筆
  let lift = 0; // 先端の浮き(0〜1)
  let liftV = 0;
  const mode = root.dataset.nav || ''; // 行き先の案: '' | 'trace' | 'edge' | 'mix'
  const navBox = root.querySelector<HTMLElement>('[data-nav-box]');
  const navs = Array.from(root.querySelectorAll<HTMLAnchorElement>('[data-nav]')).map((a) => ({
    a,
    word: a.textContent?.trim() || '',
    href: a.href,
  }));
  const PAPER = '#f4f1ea'; // 行き先の帯の白
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
  // ---- 行き先 ----
  let strokeNav = -1; // いま描いている線の行き先(trace)。ふつうの線なら -1
  let stroke: Seg[] = []; // いま指で描いている線をつくる帯
  let aim = -1; // 指がいま乗っている行き先(edge)
  let sinceNav = 1; // 最後の行き先の区切りから、何個の作品を描いたか(mix)
  let opening = mode === 'mix' ? 2 : 0; // 開いた直後に、ペンが続けて描く本数(mix)
  let leaving = false;
  const finger: Pt = { x: 0, y: 0 };
  const pen: Pt = { x: 0, y: 0 };

  root.classList.add('is-live');
  html.classList.add('draw-on');
  html.classList.toggle('draw-navs', !!mode);

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
  function newSeg(p: Pt, n: Pt, f = 1, v = 0, prev: Seg | null = null): Seg {
    const s: Seg = {
      pts: [p],
      nrm: [n],
      cum: [0],
      wf: [f],
      wv: [v],
      calm: !gum,
      prev,
      nav: -1,
      sid: prev ? prev.sid : ++strokeId,
      u0: prev ? prev.u0 + prev.len : 0,
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
    if (strokeNav >= 0) {
      // 行き先の文字から描きはじめた線は、ずっと白い。
      s.nav = strokeNav;
    } else if (mode === 'mix' && (sinceNav >= 1 || !prev) && missingNav() >= 0) {
      // 画面に無い行き先を、線の頭か、作品のあいだにはさむ(白が2つ続かないように)。
      s.nav = missingNav();
      sinceNav = 0;
    } else {
      nextWork = (nextWork + 1) % works.length;
      sinceNav++;
    }
    segs.push(s);
    if (pointerDown || releasing) stroke.push(s);
    return s;
  }
  // 画面に出ていない行き先(mix)。全部出ていれば -1。
  function navShown(i: number) {
    return segs.some(
      (s) =>
        s.nav === i &&
        !s.trimming &&
        s.x1 + offX > 24 &&
        s.x0 + offX < w - 24 &&
        s.y1 + offY > 70 &&
        s.y0 + offY < h - 24
    );
  }
  function missingNav() {
    for (let i = 0; i < navs.length; i++) if (!navShown(i)) return i;
    return -1;
  }
  const nameOf = (s: Seg) => (s.nav >= 0 ? navs[s.nav].word : works[s.work].title);
  // 帯1つぶんの長さ。行き先の区切りは短い。
  // なぞった行き先の線は、切れ目のない1本にする。
  const spanOf = (s: Seg) => (s.nav < 0 ? L : mode === 'mix' ? Math.round(L * 0.72) : Infinity);

  // 線(帯の並び)を、画面の座標の点の列にする。ページ移動の「太る線」に渡す。
  function strokePts(list: Seg[]): Pt[] {
    const all: Pt[] = [];
    for (const s of list) for (const p of s.pts) all.push({ x: p.x + offX, y: p.y + offY });
    const step = Math.max(1, Math.ceil(all.length / 40));
    const out = all.filter((_, i) => i % step === 0);
    if (all.length && out[out.length - 1] !== all[all.length - 1]) out.push(all[all.length - 1]);
    return out;
  }
  // 線が太って、行き先のページになる。
  function leave(list: Seg[], href: string) {
    if (leaving) return;
    leaving = true;
    const pts = strokePts(list);
    // 線が短すぎるときは、ふつうのページ移動(押した場所から帯が伸びる)に任せる。
    if (pts.length >= 2) coverFromStroke(pts, W);
    navigate(href);
  }
  // 指がいま乗っている行き先(edge)。文字のまわりに少し余白を取る。
  function navAt(x: number, y: number) {
    for (let i = 0; i < navs.length; i++) {
      const r = navs[i].a.getBoundingClientRect();
      if (x >= r.left - 22 && x <= r.right + 22 && y >= r.top - 22 && y <= r.bottom + 22) return i;
    }
    return -1;
  }
  function setAim(i: number) {
    if (i === aim) return;
    aim = i;
    navBox?.classList.toggle('is-aiming', i >= 0);
    navs.forEach((n, j) => n.a.classList.toggle('is-aim', j === i));
  }

  // 帯の中の写真の置き場所を決める。歪めず、正立のまま、帯のまわりを覆う大きさで置く。
  function lock(s: Seg) {
    if (s.nav >= 0) return;
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

  // 筆が指から遅れている長さ(=ゴムが伸びている長さ)から、いま描く点の太さを決める。
  const stretchAt = (lag: number) => Math.max(0.42, Math.min(1, thin(1 + lag / (W * 0.4))));

  function penDown(p: Pt) {
    cur = newSeg(p, { x: 0, y: 0 });
    liftSid = cur.sid;
  }
  function penMove(p: Pt, f = 1) {
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
      if (strokeNav >= 0) {
        // なぞる: 線は文字の手前から始める(文字がまるごと線の中に入る)。
        const back = W * 0.5;
        q.x -= ((p.x - q.x) / d) * back;
        q.y -= ((p.y - q.y) / d) * back;
        cur.x0 = Math.min(cur.x0, q.x);
        cur.y0 = Math.min(cur.y0, q.y);
        cur.x1 = Math.max(cur.x1, q.x);
        cur.y1 = Math.max(cur.y1, q.y);
      }
    }
    cur.pts.push(p);
    cur.nrm.push({ x: nx, y: ny });
    cur.len += d;
    cur.cum.push(cur.len);
    cur.wf.push(f);
    cur.wv.push(0);
    if (gum) cur.calm = false;
    cur.x0 = Math.min(cur.x0, p.x);
    cur.y0 = Math.min(cur.y0, p.y);
    cur.x1 = Math.max(cur.x1, p.x);
    cur.y1 = Math.max(cur.y1, p.y);
    if (!cur.pat && cur.len >= 20) lock(cur);
    if (cur.len >= 20 && strokeNav < 0) setLabel(nameOf(cur));
    if (cur.len >= spanOf(cur)) {
      // 作品の境目。次の帯は、同じ点・同じ向きから始める(切れ目がまっすぐになる)。
      cur.open = false;
      cur = newSeg(p, { x: nx, y: ny }, f, 0, cur);
    }
  }

  // ---- ゴム: 帯の太さ ----
  // 先端(指がつまんでいるところ)から、この長さまでは太さを保つ。
  const headLen = () => W * 0.55;
  // 先端からの長さ s にある点の、つまみによる太さの持ち上げ(0〜1)。
  function headAt(s: number) {
    const e = Math.max(0, Math.min(1, 1 - s / headLen()));
    return e * e * (3 - 2 * e);
  }
  // 描いている帯の先端から、点 i までの長さ。先端に関係ない帯なら -1。
  function fromTip(s: Seg, i: number) {
    if (!cur) return -1;
    if (s === cur) return cur.len - s.cum[i];
    if (s === cur.prev) return cur.len + s.len - s.cum[i];
    return -1;
  }
  function widthAt(s: Seg, i: number) {
    let f = s.wf[i];
    if (!gum) return f;
    const d = fromTip(s, i);
    if (d >= 0 && f < 1) f += (1 - f) * headAt(d);
    return f;
  }
  // 細った首が、少し遅れて太り、行きすぎてから落ち着く。
  function stepGum(dt: number) {
    for (const s of segs) {
      if (s.calm) continue;
      let still = !s.open;
      for (let i = 0; i < s.wf.length; i++) {
        s.wv[i] += ((1 - s.wf[i]) * 70 - s.wv[i] * 6) * dt;
        s.wf[i] += s.wv[i] * dt;
        if (Math.abs(1 - s.wf[i]) > 0.002 || Math.abs(s.wv[i]) > 0.01) still = false;
      }
      if (still) {
        s.wf.fill(1);
        s.wv.fill(0);
        s.calm = true;
      }
    }
  }
  // 指を離したとき: 先端の太さをそのまま帯に移し、端を「ぷるん」と揺らす。
  function settleTip() {
    if (!gum || !cur) return;
    const reach = headLen() * 1.6;
    for (const s of [cur, cur.prev]) {
      if (!s) continue;
      for (let i = 0; i < s.wf.length; i++) {
        const d = fromTip(s, i);
        if (d < 0 || d > reach) continue;
        s.wf[i] = widthAt(s, i);
        s.wv[i] = 1.8 * (1 - d / reach);
      }
      s.calm = false;
    }
  }
  function dropSeg(s: Seg) {
    segs = segs.filter((x) => x !== s);
    if (s.nav >= 0) {
      if (strokeNav < 0) sinceNav = 1;
    } else {
      nextWork = (nextWork - 1 + works.length) % works.length;
      sinceNav = Math.max(0, sinceNav - 1);
    }
  }
  function penUp() {
    if (!cur) return;
    settleTip();
    cur.open = false;
    if (cur.pts.length < 2) dropSeg(cur); // 点だけで終わったものは残さない
    cur = null;
    // 増えすぎたら、古いものから巻き取る。
    let live = segs.filter((s) => !s.trimming).length;
    for (const s of segs) {
      if (live <= cap) break;
      if (s.trimming || s === bloom?.seg || (mode === 'mix' && s.nav >= 0)) continue; // 行き先は巻き取らない
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
      // 行き先が画面から無くなったら、すぐ描き足す(mix)。
      if (mode === 'mix' && auto.wait > 0.4 && missingNav() >= 0) auto.wait = 0.4;
      auto.wait -= dt;
      if (auto.wait > 0) return;
      // 流れを横切る向きに、ゆるい弧で描く。流れの上手(右下寄り)から描きはじめる。
      autoSide = -autoSide;
      const m0 = Math.min(w, h);
      auto.heading = Math.atan2(dy, dx) + (Math.PI / 2) * autoSide + (rnd() - 0.5) * 1.1;
      auto.x = w / 2 - Math.cos(auto.heading) * m0 * 0.36 - dx * m0 * (0.2 + rnd() * 0.25) + (rnd() - 0.5) * m0 * 0.2;
      auto.y = h / 2 - Math.sin(auto.heading) * m0 * 0.36 - dy * m0 * (0.2 + rnd() * 0.25) + (rnd() - 0.5) * m0 * 0.2;
      auto.turn = (rnd() - 0.5) * 1.1;
      auto.left = opening > 0 ? L * 2.6 : L * (2.4 + rnd() * 1.8);
      auto.on = true;
      penDown({ x: auto.x - offX, y: auto.y - offY });
      return;
    }
    // ペンの速さ(px/秒)。ゴムの版では、ひと筆のなかで緩急をつける(速いところで首が細る)。
    let v = Math.min(w, h) * 0.62;
    if (gum) v *= 0.55 + 1.5 * Math.pow(Math.sin(auto.left / (L * 0.9)), 2);
    if (opening > 0) v *= 2; // 開いた直後は、速く描く
    auto.heading += auto.turn * dt;
    auto.turn += (rnd() - 0.5) * dt * 2;
    auto.turn = Math.max(-0.75, Math.min(0.75, auto.turn));
    auto.x += Math.cos(auto.heading) * v * dt;
    auto.y += Math.sin(auto.heading) * v * dt;
    auto.left -= v * dt;
    penMove({ x: auto.x - offX, y: auto.y - offY }, gum ? stretchAt(v * 0.12) : 1);
    const out = auto.x < -W || auto.x > w + W || auto.y < -W || auto.y > h + W;
    if (auto.left <= 0 || out) {
      penUp();
      auto.on = false;
      auto.wait = opening > 1 ? 0.25 : 2.2 + rnd() * 1.2;
      opening = Math.max(0, opening - 1);
    }
  }

  // ---- 描画 ----
  // ---- 紙: 浮き ----
  // 持ち上げている筆の、各帯の終わりから筆の先端までの長さ。
  const tail = new Map<Seg, number>();
  function measureTail() {
    tail.clear();
    let acc = 0;
    for (let i = segs.length - 1; i >= 0; i--) {
      const s = segs[i];
      if (s.sid !== liftSid) continue;
      tail.set(s, acc);
      acc += s.len;
    }
  }
  let clock = 0; // 浮きの山を動かす時計(ミリ秒)
  // 帯の点 i の、台からの高さ(px)。0 は台についている。
  function heightAt(s: Seg, i: number) {
    // 長さに沿って、浮いた山と、台についた谷が交互に来る。山は、ゆっくり帯の上を移っていく。
    const u = s.u0 + s.cum[i];
    const a = u / (W * 0.62) + s.sid * 2.1 + clock / 4200;
    const b = u / (W * 1.7) - s.sid * 0.7 - clock / 9000; // 山の高さを不ぞろいにする、長い波
    const w = Math.max(0, Math.sin(a));
    let hgt = W * 0.17 * w * w * (0.55 + 0.45 * Math.sin(b));
    if (s.sid === liftSid && lift > 0.002) {
      // 先端は、指に持ち上げられている。
      const d = (tail.get(s) || 0) + (s.len - s.cum[i]);
      const e = Math.max(0, 1 - d / (W * 2.4));
      hgt += lift * W * 0.2 * e * e * (3 - 2 * e);
    }
    return hgt;
  }

  // 帯の輪郭。kind: 0=そのまま / 1=紙の帯(浮いたぶん手前に寄り、わずかに広がる) / 2=その影。
  // 計算した左右の縁と高さは、陰影をつけるために残しておく。
  let EL: Pt[] = [];
  let ER: Pt[] = [];
  let EH: number[] = [];
  function outline(s: Seg, from: number, kind = 0) {
    const n = s.pts.length;
    EL = [];
    ER = [];
    EH = [];
    for (let i = from; i < n; i++) {
      let hw = (W / 2) * widthAt(s, i);
      let ox = 0;
      let oy = 0;
      let hgt = 0;
      if (kind) {
        hgt = heightAt(s, i);
        hw *= 1 + hgt / (W * 2.6);
        // 浮いた帯は流れの下手(左上)へ寄り、影は上手(右下)へ落ちる。
        const k = kind === 1 ? 0.45 : -0.75;
        ox = dx * hgt * k;
        oy = dy * hgt * k;
      }
      EL.push({ x: s.pts[i].x + s.nrm[i].x * hw + ox, y: s.pts[i].y + s.nrm[i].y * hw + oy });
      ER.push({ x: s.pts[i].x - s.nrm[i].x * hw + ox, y: s.pts[i].y - s.nrm[i].y * hw + oy });
      EH.push(hgt);
    }
    ctx.beginPath();
    ctx.moveTo(EL[0].x, EL[0].y);
    for (let k = 1; k < EL.length; k++) ctx.lineTo(EL[k].x, EL[k].y);
    for (let k = ER.length - 1; k >= 0; k--) ctx.lineTo(ER[k].x, ER[k].y);
    ctx.closePath();
  }
  function paintShadow(s: Seg) {
    if (s.pts.length < 2) return;
    const from = Math.min(s.pts.length - 2, Math.floor(s.trim * (s.pts.length - 1)));
    outline(s, from, 2);
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fill('nonzero');
  }
  // 山の斜面の陰影。上りの斜面は明るく、下りの斜面は暗くする(台についたところは、そのまま)。
  // 帯1つを、長さに沿った1枚のぼかしで塗る(小分けに塗ると、継ぎ目に筋が出る)。直前に作った輪郭をそのまま使う。
  const tone = (l: number) => (l > 0 ? `rgba(255,255,255,${(l * 0.16).toFixed(3)})` : `rgba(0,0,0,${(-l * 0.34).toFixed(3)})`);
  const clear = (l: number) => (l > 0 ? 'rgba(255,255,255,0)' : 'rgba(0,0,0,0)');
  function paintShade(s: Seg, from: number) {
    const m = EL.length;
    const lit: number[] = [];
    let any = false;
    for (let k = 0; k < m; k++) {
      const a = Math.max(0, k - 1);
      const b = Math.min(m - 1, k + 1);
      const du = s.cum[from + b] - s.cum[from + a] || 1;
      const l = Math.max(-1, Math.min(1, ((EH[b] - EH[a]) / du) * 3.2));
      lit.push(Math.abs(l) < 0.015 ? 0 : l);
      if (lit[k]) any = true;
    }
    if (!any) return;
    const ax = (EL[0].x + ER[0].x) / 2;
    const ay = (EL[0].y + ER[0].y) / 2;
    const bx = (EL[m - 1].x + ER[m - 1].x) / 2;
    const by = (EL[m - 1].y + ER[m - 1].y) / 2;
    const len2 = (bx - ax) ** 2 + (by - ay) ** 2 || 1;
    const g = ctx.createLinearGradient(ax, ay, bx, by);
    let tPrev = 0;
    for (let k = 0; k < m; k++) {
      const mx = (EL[k].x + ER[k].x) / 2;
      const my = (EL[k].y + ER[k].y) / 2;
      let t = ((mx - ax) * (bx - ax) + (my - ay) * (by - ay)) / len2;
      t = Math.max(tPrev, Math.min(1, t));
      if (k > 0 && lit[k - 1] * lit[k] < 0) {
        // 明るい側と暗い側の境目は、いったん無色にする。
        const z = tPrev + (t - tPrev) * (Math.abs(lit[k - 1]) / (Math.abs(lit[k - 1]) + Math.abs(lit[k])));
        g.addColorStop(z, clear(lit[k - 1]));
        g.addColorStop(z, clear(lit[k]));
      }
      g.addColorStop(t, lit[k] ? tone(lit[k]) : clear(k > 0 && lit[k - 1] ? lit[k - 1] : lit[Math.min(m - 1, k + 1)] || 1));
      tPrev = t;
    }
    ctx.fillStyle = g;
    ctx.fill('nonzero');
  }

  function paintSeg(s: Seg) {
    if (s.pts.length < 2) return;
    if (!s.pat) lock(s);
    const from = Math.min(s.pts.length - 2, Math.floor(s.trim * (s.pts.length - 1)));
    outline(s, from, paper ? 1 : 0);
    ctx.fillStyle = s.nav >= 0 ? PAPER : s.pat || '#161614';
    ctx.fill('nonzero');
    if (paper) paintShade(s, from);
    // 細い黒の縁。重なりと境目を分ける。
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#000';
    ctx.stroke();
    // 行き先の区切り(mix)には、帯の向きに沿って名前を置く。
    if (s.nav >= 0 && mode === 'mix' && s.trim === 0 && s.len > 56) {
      const i = Math.floor(s.pts.length / 2);
      const a = s.pts[Math.max(0, i - 2)];
      const b = s.pts[Math.min(s.pts.length - 1, i + 2)];
      let ang = Math.atan2(b.y - a.y, b.x - a.x);
      if (Math.cos(ang) < 0) ang += Math.PI;
      ctx.save();
      ctx.translate(s.pts[i].x, s.pts[i].y);
      ctx.rotate(ang);
      ctx.fillStyle = '#000';
      ctx.font = '500 16px "Helvetica Neue", Arial, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(navs[s.nav].word, 0, 1);
      ctx.restore();
    }
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
    const f = Math.max(0.4, Math.min(1.25, thin(len / tape.len0)));
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
    // 行き先の文字をなぞっているあいだは、紙を止める(線が文字からずれないように)。
    const sp = strokeNav >= 0 ? 0 : (base + boost) * (bloom ? 0.3 : 1);
    offX += dx * sp * dt;
    offY += dy * sp * dt;

    // 筆は指を少し遅れて追う。
    if (pointerDown || releasing) {
      const f = 1 - Math.exp(-dt / (gum ? 0.1 : 0.07)); // ゴムの版は、少しねばる
      pen.x += (finger.x - pen.x) * f;
      pen.y += (finger.y - pen.y) * f;
      if (moved) {
        const lag = Math.hypot(finger.x - pen.x, finger.y - pen.y);
        penMove({ x: pen.x - offX, y: pen.y - offY }, gum ? stretchAt(lag) : 1);
      }
      if (releasing && Math.hypot(finger.x - pen.x, finger.y - pen.y) < 3) {
        releasing = false;
        penUp();
      }
    }
    autoStep(dt, now);
    if (paper) {
      // 先端の浮き。描いているあいだは上がり、離すと少し沈みすぎてから落ち着く。
      liftV += (((cur ? 1 : 0) - lift) * 90 - liftV * 11) * dt;
      lift += liftV * dt;
    }
    if (mode === 'mix') root.dataset.navOn = navs.map((_, i) => (navShown(i) ? '1' : '0')).join('');
    stepTape(dt, now);
    if (gum) stepGum(dt);

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
    if (paper) {
      // 筆ごとに、先に影を落としてから帯を描く(影は、先に描かれた帯の上にだけ見える)。
      measureTail();
      clock = now;
      let i = 0;
      while (i < segs.length) {
        let j = i;
        while (j < segs.length && segs[j].sid === segs[i].sid) j++;
        for (let k = i; k < j; k++) paintShadow(segs[k]);
        for (let k = i; k < j; k++) paintSeg(segs[k]);
        i = j;
      }
    } else {
      for (const s of segs) paintSeg(s);
    }
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
    if (leaving) return;
    if (auto.on) {
      penUp();
      auto.on = false;
    }
    if (releasing) {
      releasing = false;
      penUp();
    }
    // なぞる: 行き先の文字の上から描きはじめた線は、その行き先の線になる。
    const na = (e.target as HTMLElement).closest('[data-nav]');
    strokeNav = mode === 'trace' && na ? navs.findIndex((n) => n.a === na) : -1;
    stroke = [];
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
          if (s) setLabel(nameOf(s));
        }
      }
      return;
    }
    finger.x = e.clientX;
    finger.y = e.clientY;
    lastUser = performance.now();
    if (mode === 'edge' && moved) setAim(navAt(e.clientX, e.clientY));
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
      suppressClick = performance.now(); // 描いたあとの誤クリックは止める
      const len = stroke.reduce((a, s) => a + s.len, 0);
      // なぞる: 行き先の線を離すと、その線が太ってページになる。
      if (strokeNav >= 0) {
        const href = navs[strokeNav].href;
        strokeNav = -1;
        penUp();
        leave(stroke, href);
        return;
      }
      // 引き切る: 行き先の文字の上で離すと、その線が太ってページになる。
      if (mode === 'edge' && aim >= 0 && len > 80) {
        const href = navs[aim].href;
        penUp();
        leave(stroke, href);
        return;
      }
      setAim(-1);
      strokeNav = -1;
      releasing = true; // 筆が指の離れた場所に追いつくまで描く
      return;
    }
    strokeNav = -1;
    // 描かずに押しただけ。
    if (bloom && bloom.dir > 0) {
      if (inBloom(e.clientX, e.clientY)) navigate(works[bloom.seg.work].href);
      else closeBloom();
      return;
    }
    const s = hit(e.clientX, e.clientY);
    if (!s || s.open) return;
    // 混ざる: 行き先の区切りを押すと、その帯が太ってページになる。
    if (s.nav >= 0) leave([s], navs[s.nav].href);
    else openBloom(s);
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
    setAim(-1);
    html.classList.remove('draw-on', 'draw-navs');
  };
}
