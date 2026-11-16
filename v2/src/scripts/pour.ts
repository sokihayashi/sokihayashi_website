// 注ぐ。
// 空の器に黒い液が上がり(.is-pouring)、満ちると澄んで中身が見える(.is-full)。
// 見た目は global.css の「器」にある。ここは順番と時間だけを決める。

export interface Pour {
  el: HTMLElement; // クラスを付ける要素(中に .vessel がある)
  img: HTMLImageElement | null;
  state: 0 | 1 | 2; // 0=空 / 1=注いでいる / 2=満ちた
  queued: boolean;
}

const RISE = 1450; // 液が上がりきるまで(ms)。CSS の 1.4s と合わせる

export function makePour(el: HTMLElement): Pour {
  return { el, img: el.querySelector<HTMLImageElement>('.vessel-fill img'), state: 0, queued: false };
}

/** 画像を先に読んでおく(空のまま満ちないように)。 */
export function prime(p: Pour) {
  if (p.img && p.img.loading !== 'eager') p.img.loading = 'eager';
}

/** delay ミリ秒後に注ぎはじめる。画像が届くまでは澄まない(液が読み込み表示を兼ねる)。 */
export function pourAfter(p: Pour, delay: number, timers: number[]) {
  if (p.state || p.queued) return;
  p.queued = true;
  prime(p);
  timers.push(
    window.setTimeout(() => {
      p.state = 1;
      p.el.classList.add('is-pouring');
      timers.push(
        window.setTimeout(() => {
          const done = () => {
            p.state = 2;
            p.el.classList.add('is-full');
            p.el.classList.remove('is-pouring');
          };
          if (p.img && !p.img.complete) {
            p.img.addEventListener('load', done, { once: true });
            p.img.addEventListener('error', done, { once: true });
          } else done();
        }, RISE)
      );
    }, Math.max(0, delay))
  );
}

/** 演出なしで、満ちた状態にする(戻る・共有・再訪)。 */
export function pourSet(p: Pour) {
  if (p.state === 2) return;
  prime(p);
  p.queued = true;
  p.state = 2;
  p.el.classList.add('is-full', 'is-set');
  p.el.classList.remove('is-pouring');
}

export function pourReset(p: Pour) {
  p.state = 0;
  p.queued = false;
  p.el.classList.remove('is-pouring', 'is-full', 'is-set');
}

/** 飛沫を1つ飛ばす。必ず器の口に着いて消える。box の左上が原点。 */
export function fly(
  box: HTMLElement | null,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  dur: number,
  seed: number,
  nx = 0,
  ny = -1
) {
  if (!box) return;
  const b = document.createElement('i');
  b.className = 'bead';
  const size = 12 + Math.abs(Math.sin(seed * 7.3)) * 14;
  b.style.width = b.style.height = `${size.toFixed(0)}px`;
  box.appendChild(b);
  // 切り口の外へ一度ふくらんでから、器の口へ落ちる。
  const side = (x1 - x0) * nx + (y1 - y0) * ny >= 0 ? 1 : -1;
  const bulge = 40 + Math.abs(Math.sin(seed * 3.1)) * 70;
  const mx = (x0 + x1) / 2 + nx * side * bulge;
  const my = (y0 + y1) / 2 + ny * side * bulge - 36;
  const at = (x: number, y: number, sc: number) =>
    `translate3d(${(x - size / 2).toFixed(1)}px, ${(y - size / 2).toFixed(1)}px, 0) scale(${sc})`;
  const anim = b.animate(
    [
      { transform: at(x0, y0, 0.3), opacity: 0 },
      { transform: at(mx, my, 1.2), opacity: 1, offset: 0.42 },
      { transform: at(x1, y1, 0.75), opacity: 1 },
    ],
    { duration: dur, easing: 'cubic-bezier(0.3, 0.55, 0.35, 1)', fill: 'forwards' }
  );
  anim.onfinish = () => b.remove();
  anim.oncancel = () => b.remove();
}

/** ふつうの縦のページ用: 画面に入った器から順に注ぐ。 */
export function mountPour(root: HTMLElement): () => void {
  const timers: number[] = [];
  const pours = Array.from(root.querySelectorAll<HTMLElement>('[data-pour]')).map(makePour);
  root.classList.add('pour-on');
  const io = new IntersectionObserver(
    (entries) => {
      let k = 0;
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        const p = pours.find((x) => x.el === e.target);
        if (p) pourAfter(p, 80 + k++ * 220, timers);
        io.unobserve(e.target);
      }
    },
    { threshold: 0.25 }
  );
  pours.forEach((p) => io.observe(p.el));
  return () => {
    io.disconnect();
    timers.forEach((t) => clearTimeout(t));
    pours.forEach(pourReset);
    root.classList.remove('pour-on');
  };
}
