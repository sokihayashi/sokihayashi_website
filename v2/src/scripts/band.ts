// ページの移り変わり: 帯がひらく。
//
// 押した場所を通る28°の白い帯が、のびて、太って、画面を覆う。
// 覆っているあいだにページが替わり、帯は同じ線からふたつに割れて、次のページがあらわれる。
// サイトのどのリンクでも同じ動きになる(ヒーローで作品がひらくのと同じ文法)。
//
// [data-band] の付いた要素(帯の切れ端)から始まるときは、その帯の形から太りはじめる。

import { isBusy, lock, loosen, tighten } from './gsplat';

const ANGLE = 28; // 画面の長辺からの角度(度)
const COVER = 300; // 覆うまで(ms)
const OPEN = 420; // 割れてひらくまで(ms)

interface Origin {
  x: number;
  y: number;
  half: number; // 帯の長さの半分
  hw: number; // 帯の太さの半分
  at: number;
}

let origin: Origin | null = null;
let wipe: HTMLElement | null = null;
let geo = { cx: 0, cy: 0, dx: 1, dy: 0, nx: 0, ny: 1, reach: 0 };
let safety = 0;
let gs = false; // 粒の移り変わりの途中
// 引っぱって描いた帯から始めるとき、その軌跡(画面上の座標)と太さ。
let pulled: { pts: { x: number; y: number }[]; width: number; at: number } | null = null;

/** 次の移動を、いま描いた帯が太って覆う動きで始める(ヒーローの「引っぱって行く」用)。 */
export function coverFromStroke(pts: { x: number; y: number }[], width: number) {
  pulled = { pts, width, at: performance.now() };
}

const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function axis() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const a = (ANGLE * Math.PI) / 180;
  // 長辺から28°。縦長なら縦から、横長なら横から測る。
  const dx = h > w ? Math.sin(a) : Math.cos(a);
  const dy = h > w ? Math.cos(a) : Math.sin(a);
  return { w, h, dx, dy, nx: -dy, ny: dx, reach: Math.hypot(w, h) };
}

const quad = (cx: number, cy: number, dx: number, dy: number, nx: number, ny: number, half: number, hw: number) =>
  `polygon(${[
    [cx - dx * half + nx * hw, cy - dy * half + ny * hw],
    [cx + dx * half + nx * hw, cy + dy * half + ny * hw],
    [cx + dx * half - nx * hw, cy + dy * half - ny * hw],
    [cx - dx * half - nx * hw, cy - dy * half - ny * hw],
  ]
    .map(([x, y]) => `${x.toFixed(1)}px ${y.toFixed(1)}px`)
    .join(',')})`;

function remove() {
  window.clearTimeout(safety);
  wipe?.remove();
  wipe = null;
  document.documentElement.classList.remove('band-wiping');
}

/** 帯がのびて、太って、画面を覆う。 */
function cover(): Promise<void> {
  remove();
  const { w, h, dx, dy, nx, ny, reach } = axis();
  const fresh = origin && performance.now() - origin.at < 1500 ? origin : null;
  const cx = fresh ? fresh.x : w / 2;
  const cy = fresh ? fresh.y : h / 2;
  const half0 = fresh ? fresh.half : 0;
  const hw0 = fresh ? fresh.hw : 3;
  geo = { cx, cy, dx, dy, nx, ny, reach };

  const el = document.createElement('div');
  el.className = 'band-wipe';
  el.setAttribute('aria-hidden', 'true');
  // 覆う面(1枚)と、ひらくときの2枚。
  el.innerHTML = '<i class="band-full"></i><i class="band-half"></i><i class="band-half"></i>';
  document.documentElement.appendChild(el);
  document.documentElement.classList.add('band-wiping');
  wipe = el;
  // 何かあっても、画面を覆ったままにはしない。
  safety = window.setTimeout(remove, 4000);

  const full = el.querySelector<HTMLElement>('.band-full')!;
  const anim = full.animate(
    [
      { clipPath: quad(cx, cy, dx, dy, nx, ny, half0, hw0) },
      { clipPath: quad(cx, cy, dx, dy, nx, ny, reach * 1.2, hw0), offset: 0.36, easing: 'cubic-bezier(0.6, 0, 0.9, 0.5)' },
      { clipPath: quad(cx, cy, dx, dy, nx, ny, reach * 1.2, reach * 1.05) },
    ],
    { duration: COVER, easing: 'cubic-bezier(0.3, 0, 0.3, 1)', fill: 'forwards' }
  );
  return anim.finished.then(
    () => undefined,
    () => undefined
  );
}

/** 描いた帯そのものが太って、画面を覆う。 */
function coverStroke(st: { pts: { x: number; y: number }[]; width: number }): Promise<void> {
  remove();
  const { w, h, dx, dy, nx, ny, reach } = axis();
  geo = { cx: w / 2, cy: h / 2, dx, dy, nx, ny, reach };
  const el = document.createElement('div');
  el.className = 'band-wipe';
  el.setAttribute('aria-hidden', 'true');
  const d = st.pts.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join('');
  el.innerHTML =
    `<svg class="band-stroke" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><path d="${d}" fill="none" stroke-linejoin="round" stroke-linecap="round"/></svg>` +
    '<i class="band-full" style="display:none"></i><i class="band-half"></i><i class="band-half"></i>';
  document.documentElement.appendChild(el);
  document.documentElement.classList.add('band-wiping');
  wipe = el;
  safety = window.setTimeout(remove, 4000);
  const path = el.querySelector<SVGPathElement>('path')!;
  const anim = path.animate(
    [{ strokeWidth: `${st.width}px` }, { strokeWidth: `${(reach * 2.4).toFixed(0)}px` }],
    { duration: COVER + 60, easing: 'cubic-bezier(0.6, 0, 0.9, 0.45)', fill: 'forwards' }
  );
  const done = () => {
    // 覆い終えたら、ただの白い面に置き換える(割れる動きにつなぐ)。
    const full = el.querySelector<HTMLElement>('.band-full');
    if (full) full.style.display = 'block';
  };
  return anim.finished.then(done, done);
}

/** 同じ線からふたつに割れて、次のページがあらわれる。 */
function open() {
  const el = wipe;
  if (!el) return;
  const { cx, cy, dx, dy, nx, ny, reach } = geo;
  const full = el.querySelector<HTMLElement>('.band-full')!;
  const halves = el.querySelectorAll<HTMLElement>('.band-half');
  const R = reach * 1.2;
  halves.forEach((hEl, i) => {
    const s = i === 0 ? 1 : -1;
    // 線の片側だけの面。
    hEl.style.clipPath = `polygon(${[
      [cx - dx * R, cy - dy * R],
      [cx + dx * R, cy + dy * R],
      [cx + dx * R + nx * R * s, cy + dy * R + ny * R * s],
      [cx - dx * R + nx * R * s, cy - dy * R + ny * R * s],
    ]
      .map(([x, y]) => `${x.toFixed(1)}px ${y.toFixed(1)}px`)
      .join(',')})`;
    hEl.style.display = 'block';
  });
  full.style.display = 'none';
  el.querySelector<SVGElement>('.band-stroke')?.remove();
  let left = halves.length;
  halves.forEach((hEl, i) => {
    const s = i === 0 ? 1 : -1;
    const a = hEl.animate(
      [
        { transform: 'translate3d(0,0,0)' },
        { transform: `translate3d(${(nx * reach * 1.05 * s).toFixed(1)}px, ${(ny * reach * 1.05 * s).toFixed(1)}px, 0)` },
      ],
      { duration: OPEN, easing: 'cubic-bezier(0.55, 0, 0.2, 1)', fill: 'forwards' }
    );
    a.onfinish = a.oncancel = () => {
      if (--left === 0 && wipe === el) remove();
    };
  });
}

if (typeof window !== 'undefined' && !(window as any).__band) {
  (window as any).__band = true;

  // 押した場所を覚えておく。帯の切れ端から押したときは、その帯の形も。
  document.addEventListener(
    'pointerdown',
    (e) => {
      const t = (e.target as HTMLElement | null)?.closest<HTMLElement>('[data-band]');
      if (t) {
        const r = t.getBoundingClientRect();
        origin = {
          x: r.left + r.width / 2,
          y: r.top + r.height / 2,
          half: t.offsetWidth / 2,
          hw: t.offsetHeight / 2,
          at: performance.now(),
        };
      } else {
        origin = { x: e.clientX, y: e.clientY, half: 0, hw: 3, at: performance.now() };
      }
    },
    true
  );

  // ページを読みに行くあいだに、帯で覆う。
  document.addEventListener('astro:before-preparation', (ev) => {
    if (reduced()) return;
    const e = ev as Event & { loader: () => Promise<void> };
    // 粒で移っている途中の、次の移動は受けない。
    if (isBusy()) {
      e.preventDefault();
      return;
    }
    const load = e.loader;
    // 試作: /lab/morph-sharp/ から出るときだけ、帯の代わりに ガウシアンの粒でほどけて移る。
    if (document.querySelector('[data-morph-root][data-set="sharp"]')) {
      const o = origin && performance.now() - origin.at < 1500 ? origin : null;
      lock(); // ここから着くまで、押しても何も起きない
      e.loader = async () => {
        const [, ok] = await Promise.all([load(), loosen(o ? o.x : window.innerWidth / 2, o ? o.y : window.innerHeight / 2)]);
        gs = ok;
      };
      return;
    }
    e.loader = async () => {
      const st = pulled && performance.now() - pulled.at < 1500 ? pulled : null;
      pulled = null;
      await Promise.all([load(), st ? coverStroke(st) : cover()]);
    };
  });

  // 替わったら、ひらく。
  document.addEventListener('astro:after-swap', () => {
    if (gs) {
      gs = false;
      void tighten();
      return;
    }
    if (!wipe) return;
    // ページが替わると <html> の class は新しいページのものに置き換わる。付け直して、
    // 下で起きるフェードを止める(止めないと、帯が割れる動きがフェードの陰に隠れる)。
    document.documentElement.classList.add('band-wiping');
    if (!wipe.isConnected) document.documentElement.appendChild(wipe);
    // 新しいページが1コマ描かれてからひらく。
    requestAnimationFrame(() => requestAnimationFrame(open));
  });
}
