// 試作: Works の一覧(枠と面)。
//
// 黒い地に、紙色の細い線で枠を引く。枠の中に、写真か文字が入る。動きはない。
//   data-curve があると、枠の線をまっすぐではなく、ゆるい曲線にする(写真も、その曲線で裁つ)。
//   曲線は場所で決まる(毎回同じ形)。長い波と短い波を重ねて、同じ形が繰り返して見えないようにしている。
// 分類(領域・立場)と並び替えで行が入れ替わるたびに、枠を引き直す。
// 分類の欄は4通り(面を並べる / 端末の選択メニュー / 面が下へ伸びる / 1つにたたむ)。どれも data-k と値で、同じ状態を書き換える。

type Pt = [number, number];

export function mountCells(root: HTMLElement): () => void {
  const curve = root.hasAttribute('data-curve');
  const svg = root.querySelector<SVGSVGElement>('[data-cl-lines]')!;
  const list = root.querySelector<HTMLElement>('[data-cl-list]')!;
  const all = Array.from(root.querySelectorAll<HTMLElement>('[data-row]'));
  const ctl = document.querySelector<HTMLElement>('[data-cl-ctl]');
  const count = document.querySelector<HTMLElement>('[data-cl-count]');
  type Group = { key: string; label: string; opts: [string, string][] };
  const groups: Group[] = ctl?.dataset.groups ? JSON.parse(ctl.dataset.groups) : [];
  const state: Record<string, string> = { d: 'all', s: 'all', sort: 'order' };
  const labelOf = (k: string, v: string) => groups.find((g) => g.key === k)?.opts.find((o) => o[0] === v)?.[1] ?? v;
  const match = (r: HTMLElement, d: string, st: string) =>
    (d === 'all' || (r.dataset.domain || '').split(' ').includes(d)) && (st === 'all' || r.dataset.stance === st);
  // その値を選んだら、何件になるか(もう片方の分類は、いまのまま)。
  const countFor = (k: string, v: string) =>
    all.filter((r) => match(r, k === 'd' ? v : state.d, k === 's' ? v : state.s)).length;

  function apply() {
    const rows = all.slice().sort((a, b) => {
      if (state.sort === 'title') return (a.dataset.title || '').localeCompare(b.dataset.title || '', 'ja');
      return Number(a.dataset.order) - Number(b.dataset.order);
    });
    let shown = 0;
    for (const r of rows) {
      const ok = match(r, state.d, state.s);
      r.hidden = !ok;
      if (ok) shown++;
      list.appendChild(r);
    }
    if (count) count.textContent = String(shown);
    sync();
    layout();
  }

  // 分類の欄を、いまの状態に合わせる(選択中の面、いまの値、件数、選べない値)。
  function sync() {
    if (!ctl) return;
    ctl.querySelectorAll<HTMLButtonElement>('button[data-k]').forEach((b) => {
      const k = b.dataset.k!;
      const v = b.dataset.val!;
      const on = state[k] === v;
      b.setAttribute('aria-pressed', String(on));
      if (k !== 'sort') {
        const n = countFor(k, v);
        b.disabled = n === 0 && !on;
        const tag = b.querySelector<HTMLElement>('[data-n]');
        if (tag) tag.textContent = String(n);
      }
    });
    ctl.querySelectorAll<HTMLSelectElement>('select[data-k]').forEach((sel) => {
      const k = sel.dataset.k!;
      for (const o of Array.from(sel.options)) {
        const on = state[k] === o.value;
        if (k !== 'sort') {
          const n = countFor(k, o.value);
          o.textContent = `${labelOf(k, o.value)} (${n})`;
          o.disabled = n === 0 && !on;
        }
      }
      sel.value = state[k];
    });
    ctl.querySelectorAll<HTMLElement>('[data-v]').forEach((el) => {
      el.textContent = labelOf(el.dataset.v!, state[el.dataset.v!]);
    });
    const sum = ctl.querySelector<HTMLElement>('[data-sum]');
    if (sum) {
      const parts = [state.d !== 'all' ? labelOf('d', state.d) : '', state.s !== 'all' ? labelOf('s', state.s) : ''].filter(Boolean);
      sum.textContent = (parts.length ? parts : ['すべて']).concat(labelOf('sort', state.sort)).join(' / ');
    }
  }

  // menu 版: 開いている面は1つだけ。
  function openPop(k: string | null, refocus = false) {
    if (!ctl) return;
    ctl.querySelectorAll<HTMLButtonElement>('[data-open]').forEach((b) => {
      const pop = ctl.querySelector<HTMLElement>(`[data-pop="${b.dataset.open}"]`);
      const was = b.getAttribute('aria-expanded') === 'true';
      const on = b.dataset.open === k;
      b.setAttribute('aria-expanded', String(on));
      if (pop) pop.hidden = !on;
      if (was && !on && refocus) b.focus();
    });
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
    if (b.dataset.open) {
      openPop(b.getAttribute('aria-expanded') === 'true' ? null : b.dataset.open);
      return;
    }
    if (b.hasAttribute('data-fold-btn')) {
      const body = ctl.querySelector<HTMLElement>('.cl-fold-body');
      const on = b.getAttribute('aria-expanded') !== 'true';
      b.setAttribute('aria-expanded', String(on));
      if (body) body.hidden = !on;
      return;
    }
    if (!b.dataset.k || b.dataset.val === undefined) return;
    state[b.dataset.k] = b.dataset.val;
    if (b.closest('[data-pop]')) openPop(null, true);
    apply();
  }
  function onChange(e: Event) {
    const sel = e.target as HTMLSelectElement;
    if (!sel.matches?.('select[data-k]')) return;
    state[sel.dataset.k!] = sel.value;
    apply();
  }
  // 欄の外を押すか Esc で、開いている面を閉じる。
  function onDocClick(e: Event) {
    if (ctl && !ctl.contains(e.target as Node)) openPop(null);
  }
  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') openPop(null, true);
  }
  let rt = 0;
  function onResize() {
    window.clearTimeout(rt);
    rt = window.setTimeout(layout, 80);
  }

  root.classList.add('is-live');
  ctl?.addEventListener('click', onClick);
  ctl?.addEventListener('change', onChange);
  document.addEventListener('click', onDocClick);
  document.addEventListener('keydown', onKey);
  window.addEventListener('resize', onResize);
  window.addEventListener('load', layout);
  apply();

  return () => {
    ctl?.removeEventListener('click', onClick);
    ctl?.removeEventListener('change', onChange);
    document.removeEventListener('click', onDocClick);
    document.removeEventListener('keydown', onKey);
    window.removeEventListener('resize', onResize);
    window.removeEventListener('load', layout);
    window.clearTimeout(rt);
    root.classList.remove('is-live');
  };
}
