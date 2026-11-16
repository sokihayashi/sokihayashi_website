// 断つ。
//
// 画面は、作品の紙が重なった束。
// 指(またはドラッグ)で引いた線で、いちばん上の紙が切れる。
// 切れ端は「画面の長辺から28°」の向きに滑り落ち、下の作品が出る。
//
// スマホを基準にしている: スワイプ1回 = 一太刀 = 1枚めくれる。
// PC は同じ仕組みに、ホイールと矢印キー(28°の切り込みが自動で入る)を足しただけ。
// 引かずに押せば、その作品の詳細へ行く。

type Pt = { x: number; y: number };

const ANGLE = 28; // 画面の長辺からの角度(度)

/** 画面の四角を、線 pts(中にある点の列)で2つに分ける。 */
function split(w: number, h: number, pts: Pt[]): [Pt[], Pt[]] | null {
  if (pts.length < 2) return null;
  const P = 2 * (w + h);
  // 線の両端を、進んできた向きのまま画面の縁まで延ばす。
  const edge = (p: Pt, ux: number, uy: number): Pt => {
    const tx = ux > 0 ? (w - p.x) / ux : ux < 0 ? -p.x / ux : Infinity;
    const ty = uy > 0 ? (h - p.y) / uy : uy < 0 ? -p.y / uy : Infinity;
    const t = Math.max(0, Math.min(tx, ty));
    return { x: p.x + ux * t, y: p.y + uy * t };
  };
  const unit = (a: Pt, b: Pt) => {
    const l = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    return [(b.x - a.x) / l, (b.y - a.y) / l] as const;
  };
  const k = Math.min(4, pts.length - 1);
  const [sx, sy] = unit(pts[k], pts[0]);
  const [ex, ey] = unit(pts[pts.length - 1 - k], pts[pts.length - 1]);
  const b0 = edge(pts[0], sx, sy);
  const b1 = edge(pts[pts.length - 1], ex, ey);
  // 縁の上の位置を、左上から時計回りの長さで表す。
  const along = (p: Pt) => {
    const e = 0.5;
    if (p.y <= e) return p.x;
    if (p.x >= w - e) return w + p.y;
    if (p.y >= h - e) return w + h + (w - p.x);
    return 2 * w + h + (h - p.y);
  };
  const t0 = along(b0);
  const t1 = along(b1);
  if (Math.abs(t0 - t1) < 8) return null;
  const corners: [number, Pt][] = [
    [0, { x: 0, y: 0 }],
    [w, { x: w, y: 0 }],
    [w + h, { x: w, y: h }],
    [2 * w + h, { x: 0, y: h }],
  ];
  const path = [b0, ...pts, b1];
  const cw = (P + t0 - t1) % P;
  const a = corners
    .map(([t, p]) => [(P + t - t1) % P, p] as const)
    .filter(([t]) => t > 0 && t < cw)
    .sort((x, y) => x[0] - y[0])
    .map(([, p]) => p);
  const ccw = (P + t1 - t0) % P;
  const b = corners
    .map(([t, p]) => [(P + t1 - t) % P, p] as const)
    .filter(([t]) => t > 0 && t < ccw)
    .sort((x, y) => x[0] - y[0])
    .map(([, p]) => p);
  return [
    [...path, ...a],
    [...path, ...b],
  ];
}

const centroid = (poly: Pt[]): Pt => ({
  x: poly.reduce((s, p) => s + p.x, 0) / poly.length,
  y: poly.reduce((s, p) => s + p.y, 0) / poly.length,
});

export function mountCut(root: HTMLElement): () => void {
  const sheets = Array.from(root.querySelectorAll<HTMLElement>('[data-sheet]'));
  const label = root.querySelector<HTMLElement>('[data-label]');
  const line = root.querySelector<SVGPolylineElement>('[data-line]');
  const guide = root.querySelector<SVGLineElement>('[data-guide]');
  const svg = root.querySelector<SVGSVGElement>('[data-overlay]');
  const html = document.documentElement;

  let w = 0;
  let h = 0;
  let dx = 1;
  let dy = 0;
  let top = 0; // いちばん上にある紙
  let busy = false;
  let stroke: Pt[] | null = null;
  let moved = false;
  let suppressClick = 0;
  let lastAuto = 0;
  const running: Animation[] = [];

  root.classList.add('is-live');
  html.classList.add('cut-on');

  function measure() {
    w = root.clientWidth;
    h = root.clientHeight;
    const a = (ANGLE * Math.PI) / 180;
    // 長辺から28°。縦長の画面なら縦から、横長の画面なら横から測る。
    if (h > w) {
      dx = Math.sin(a);
      dy = Math.cos(a);
    } else {
      dx = Math.cos(a);
      dy = Math.sin(a);
    }
    svg?.setAttribute('viewBox', `0 0 ${w} ${h}`);
    // 切り取り線。最初の1枚にだけ出る、28°の破線。
    if (guide) {
      const L = Math.hypot(w, h);
      guide.setAttribute('x1', String(w / 2 - dx * L));
      guide.setAttribute('y1', String(h / 2 - dy * L));
      guide.setAttribute('x2', String(w / 2 + dx * L));
      guide.setAttribute('y2', String(h / 2 + dy * L));
    }
  }

  function show() {
    sheets.forEach((s, i) => {
      const order = (i - top + sheets.length) % sheets.length;
      s.style.zIndex = String(sheets.length - order);
      // 上の2枚だけ描く(いちばん上と、切ったときに下から出る1枚)。
      s.style.visibility = order < 2 ? 'visible' : 'hidden';
      s.toggleAttribute('inert', order !== 0);
      const img = s.querySelector('img');
      if (img && order < 3) img.loading = 'eager';
    });
    const cur = sheets[top];
    if (label) label.textContent = cur.dataset.title || '';
    root.classList.toggle('on-cover', top === 0);
  }

  function cut(pts: Pt[]) {
    if (busy) return;
    const pieces = split(w, h, pts);
    if (!pieces) return;
    busy = true;
    const cur = sheets[top];
    const reach = Math.hypot(w, h) * 1.15;
    // 切り口に直交する向き(切れ端どうしが離れていく向き)。
    const c0 = centroid(pieces[0]);
    const c1 = centroid(pieces[1]);
    const first = c0.x * dx + c0.y * dy >= c1.x * dx + c1.y * dy ? 0 : 1; // 先に落ちる側
    const made: HTMLElement[] = [];
    let left = pieces.length;
    pieces.forEach((poly, i) => {
      const el = cur.cloneNode(true) as HTMLElement;
      el.removeAttribute('data-sheet');
      el.classList.add('piece');
      el.setAttribute('aria-hidden', 'true');
      el.setAttribute('tabindex', '-1');
      el.style.zIndex = String(sheets.length + 2);
      el.style.visibility = 'visible';
      el.style.clipPath = `polygon(${poly.map((p) => `${p.x.toFixed(1)}px ${p.y.toFixed(1)}px`).join(',')})`;
      root.appendChild(el);
      made.push(el);
      const me = i === 0 ? c0 : c1;
      const other = i === 0 ? c1 : c0;
      const ox = me.x - other.x;
      const oy = me.y - other.y;
      const ol = Math.hypot(ox, oy) || 1;
      const away = 26;
      const rot = (i === first ? 1 : -1) * 2.2;
      const anim = el.animate(
        [
          { transform: 'translate3d(0,0,0) rotate(0deg)' },
          {
            transform: `translate3d(${((ox / ol) * away).toFixed(1)}px, ${((oy / ol) * away).toFixed(1)}px, 0) rotate(${(rot * 0.2).toFixed(2)}deg)`,
            offset: 0.18,
          },
          {
            transform: `translate3d(${(dx * reach + (ox / ol) * away).toFixed(1)}px, ${(dy * reach + (oy / ol) * away).toFixed(1)}px, 0) rotate(${rot}deg)`,
          },
        ],
        {
          duration: i === first ? 680 : 820,
          delay: i === first ? 0 : 110,
          easing: 'cubic-bezier(0.5, 0, 0.85, 0.35)',
          fill: 'forwards',
        }
      );
      running.push(anim);
      anim.onfinish = anim.oncancel = () => {
        el.remove();
        if (--left === 0) busy = false;
      };
    });
    // 元の紙は切れ端に置き換わったので、束のいちばん下へ回す。
    top = (top + 1) % sheets.length;
    show();
  }

  // 28°の切り込みを自動で入れる(ホイール、矢印キー)。
  function autoCut() {
    const now = performance.now();
    if (busy || now - lastAuto < 500) return;
    lastAuto = now;
    const off = (Math.random() - 0.5) * Math.min(w, h) * 0.3;
    const cx = w / 2 - dy * off;
    const cy = h / 2 + dx * off;
    const pts = [
      { x: cx - dx * 60, y: cy - dy * 60 },
      { x: cx + dx * 60, y: cy + dy * 60 },
    ];
    flash(pts);
    cut(pts);
  }

  function draw(pts: Pt[]) {
    line?.setAttribute('points', pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' '));
  }
  // 切り口の線を一瞬だけ見せる。
  function flash(pts: Pt[]) {
    const pieces = split(w, h, pts);
    if (pieces) draw(pieces[0].slice(0, pts.length + 2));
    window.setTimeout(() => draw([]), 220);
  }

  function onDown(e: PointerEvent) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if ((e.target as HTMLElement).closest('[data-keep]')) return;
    stroke = [{ x: e.clientX, y: e.clientY }];
    moved = false;
  }
  function onMove(e: PointerEvent) {
    if (!stroke) return;
    const p = { x: Math.min(w, Math.max(0, e.clientX)), y: Math.min(h, Math.max(0, e.clientY)) };
    const lastP = stroke[stroke.length - 1];
    if (Math.hypot(p.x - lastP.x, p.y - lastP.y) < 8) return;
    stroke.push(p);
    if (Math.hypot(p.x - stroke[0].x, p.y - stroke[0].y) > 10) moved = true;
    if (moved) draw(stroke);
  }
  function onUp() {
    if (!stroke) return;
    const pts = stroke;
    stroke = null;
    if (!moved) return;
    suppressClick = performance.now();
    const len = Math.hypot(pts[pts.length - 1].x - pts[0].x, pts[pts.length - 1].y - pts[0].y);
    window.setTimeout(() => draw([]), 200);
    if (len > 56) cut(pts);
  }
  function onClick(e: MouseEvent) {
    // 引いた直後のクリック(リンクの誤作動)は止める。
    if (performance.now() - suppressClick < 350) {
      e.preventDefault();
      e.stopPropagation();
    }
  }
  function onWheel(e: WheelEvent) {
    if (e.ctrlKey) return;
    e.preventDefault();
    if (Math.abs(e.deltaY) + Math.abs(e.deltaX) > 6) autoCut();
  }
  function onKey(e: KeyboardEvent) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (['ArrowDown', 'ArrowRight', 'PageDown', ' '].includes(e.key)) {
      e.preventDefault();
      autoCut();
    }
  }
  function onResize() {
    measure();
  }

  measure();
  show();
  root.addEventListener('pointerdown', onDown);
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);
  root.addEventListener('click', onClick, true);
  root.addEventListener('wheel', onWheel, { passive: false });
  window.addEventListener('keydown', onKey);
  window.addEventListener('resize', onResize);

  return () => {
    running.forEach((a) => a.cancel());
    root.querySelectorAll('.piece').forEach((p) => p.remove());
    root.removeEventListener('pointerdown', onDown);
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onUp);
    root.removeEventListener('click', onClick, true);
    root.removeEventListener('wheel', onWheel);
    window.removeEventListener('keydown', onKey);
    window.removeEventListener('resize', onResize);
    sheets.forEach((s) => {
      s.style.zIndex = '';
      s.style.visibility = '';
      s.removeAttribute('inert');
    });
    root.classList.remove('is-live', 'on-cover');
    html.classList.remove('cut-on');
  };
}
