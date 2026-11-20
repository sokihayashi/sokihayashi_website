// 試作: Works の一覧(枠と面)。
//
// 黒い地に、紙色の細い線で枠を引く。枠の中に、写真か文字が入る。動きはない。
//   data-curve があると、枠の線をまっすぐではなく、ゆるい曲線にする(写真も、その曲線で裁つ)。
//   曲線は場所で決まる(毎回同じ形)。長い波と短い波を重ねて、同じ形が繰り返して見えないようにしている。
// 分類(領域・立場)と並び替えで行が入れ替わるたびに、枠を引き直す。

type Pt = [number, number];

export function mountCells(root: HTMLElement): () => void {
  const curve = root.hasAttribute('data-curve');
  const svg = root.querySelector<SVGSVGElement>('[data-cl-lines]')!;
  const list = root.querySelector<HTMLElement>('[data-cl-list]')!;
  const all = Array.from(root.querySelectorAll<HTMLElement>('[data-row]'));
  const ctl = document.querySelector<HTMLElement>('[data-cl-ctl]');
  const count = document.querySelector<HTMLElement>('[data-cl-count]');
  let domain = 'all';
  let stance = 'all';
  let sort = 'order';

  function apply() {
    const rows = all.slice().sort((a, b) => {
      if (sort === 'title') return (a.dataset.title || '').localeCompare(b.dataset.title || '', 'ja');
      return Number(a.dataset.order) - Number(b.dataset.order);
    });
    let shown = 0;
    for (const r of rows) {
      const ok =
        (domain === 'all' || (r.dataset.domain || '').split(' ').includes(domain)) &&
        (stance === 'all' || r.dataset.stance === stance);
      r.hidden = !ok;
      if (ok) shown++;
      list.appendChild(r);
    }
    if (count) count.textContent = String(shown);
    layout();
  }

  function layout() {
    const rows = all.filter((r) => !r.hidden).sort((a, b) => a.offsetTop - b.offsetTop);
    const n = rows.length;
    const cs = getComputedStyle(root);
    const m = parseFloat(cs.getPropertyValue('--m')) || 28;
    const vm = parseFloat(cs.getPropertyValue('--vm')) || 24;
    const W = list.clientWidth;
    const rh = rows[0]?.offsetHeight || 0;
    const face0 = rows[0]?.querySelector<HTMLElement>('[data-face]');
    const sw = face0 ? face0.offsetWidth - m * 2 : W / 2;
    const H = n * rh;
    svg.setAttribute('width', String(W));
    svg.setAttribute('height', String(H));
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    if (!n) {
      svg.innerHTML = '';
      return;
    }
    const AV = curve ? m * 0.5 : 0; // 縦の線のゆれ幅
    const AH = curve ? vm * 0.34 : 0; // 横の線のゆれ幅
    const bx = [0, sw, W]; // 縦の線の、もとの位置
    // 縦の線 k の、高さ y での位置。
    const X = (k: number, y: number) =>
      bx[k] + AV * (0.62 * Math.sin(y / 260 + k * 1.9 + 0.4) + 0.38 * Math.sin(y / 97 + k * 4.1 + 1.3));
    // 横の線 i の、横位置 x での高さ。
    const Y = (i: number, x: number) =>
      i * rh + AH * (0.62 * Math.sin(x / 170 + i * 2.3) + 0.38 * Math.sin(x / 61 + i * 0.7 + 2));
    // 線の交点。
    const corner = (i: number, k: number): Pt => {
      const y = Y(i, X(k, i * rh));
      return [X(k, y), y];
    };
    const step = 10;
    const hEdge = (i: number, k0: number, k1: number): Pt[] => {
      const a = corner(i, k0);
      const b = corner(i, k1);
      const out: Pt[] = [a];
      const c = Math.max(1, Math.round((b[0] - a[0]) / step));
      for (let j = 1; j < c; j++) {
        const x = a[0] + ((b[0] - a[0]) * j) / c;
        out.push([x, Y(i, x)]);
      }
      out.push(b);
      return out;
    };
    const vEdge = (k: number, i0: number, i1: number): Pt[] => {
      const a = corner(i0, k);
      const b = corner(i1, k);
      const out: Pt[] = [a];
      const c = Math.max(1, Math.round((b[1] - a[1]) / step));
      for (let j = 1; j < c; j++) {
        const y = a[1] + ((b[1] - a[1]) * j) / c;
        out.push([X(k, y), y]);
      }
      out.push(b);
      return out;
    };
    const d = (pts: Pt[]) => 'M' + pts.map((p) => `${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join('L');
    let paths = '';
    for (let i = 0; i <= n; i++) paths += `<path d="${d(hEdge(i, 0, 2))}"/>`;
    for (let k = 0; k < 3; k++) {
      let pts: Pt[] = [];
      for (let i = 0; i < n; i++) pts = pts.concat(vEdge(k, i, i + 1).slice(i ? 1 : 0));
      paths += `<path d="${d(pts)}"/>`;
    }
    svg.innerHTML = paths;
    // 写真は、枠の形で裁つ(写真そのものは歪めない)。
    rows.forEach((r, i) => {
      const f = r.querySelector<HTMLElement>('[data-face]');
      if (!f) return;
      const poly = hEdge(i, 0, 1)
        .concat(vEdge(1, i, i + 1).slice(1))
        .concat(hEdge(i + 1, 0, 1).reverse().slice(1))
        .concat(vEdge(0, i, i + 1).reverse().slice(1, -1));
      f.style.clipPath = `polygon(${poly.map((p) => `${(p[0] + m).toFixed(1)}px ${(p[1] - i * rh + vm).toFixed(1)}px`).join(',')})`;
    });
  }

  function onClick(e: Event) {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button');
    if (!b || !ctl) return;
    const set = (attr: 'd' | 's' | 'sort', v: string) => {
      ctl.querySelectorAll<HTMLButtonElement>(`button[data-${attr}]`).forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      if (attr === 'd') domain = v;
      else if (attr === 's') stance = v;
      else sort = v;
    };
    if (b.dataset.d) set('d', b.dataset.d);
    else if (b.dataset.s) set('s', b.dataset.s);
    else if (b.dataset.sort) set('sort', b.dataset.sort);
    else return;
    apply();
  }
  let rt = 0;
  function onResize() {
    window.clearTimeout(rt);
    rt = window.setTimeout(layout, 80);
  }

  root.classList.add('is-live');
  ctl?.addEventListener('click', onClick);
  window.addEventListener('resize', onResize);
  window.addEventListener('load', layout);
  apply();

  return () => {
    ctl?.removeEventListener('click', onClick);
    window.removeEventListener('resize', onResize);
    window.removeEventListener('load', layout);
    window.clearTimeout(rt);
    root.classList.remove('is-live');
  };
}
