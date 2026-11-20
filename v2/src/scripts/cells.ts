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
  const page = root.closest<HTMLElement>('.cl-page');
  // 動きの種類(升目の版だけ)。sheet: 1枚の網がしなる / bands: 列ごとの帯がしなる。動きを減らす設定のときは、動かさない。
  const live = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? '' : root.dataset.live || '';
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

  // 線の網。bx は縦の線の、by は横の線の、もとの位置。AV / AH は、ゆれ幅。
  function mesh(bx: number[], by: number[], AV: number, AH: number, ph = 0) {
    // 縦の線 k の、高さ y での位置。
    const X = (k: number, y: number) =>
      bx[k] + AV * (0.62 * Math.sin(y / 260 + k * 1.9 + 0.4 + ph) + 0.38 * Math.sin(y / 97 + k * 4.1 + 1.3 - ph * 1.7));
    // 横の線 i の、横位置 x での高さ。
    const Y = (i: number, x: number) =>
      by[i] + AH * (0.62 * Math.sin(x / 170 + i * 2.3 + ph * 0.8) + 0.38 * Math.sin(x / 61 + i * 0.7 + 2 - ph));
    // 線の交点。
    const corner = (i: number, k: number): Pt => {
      const y = Y(i, X(k, by[i]));
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
    // 縦の線 k を、横の線 i0 から i1 まで、ひと続きで。
    const vRun = (k: number, i0: number, i1: number): Pt[] => {
      let pts: Pt[] = [];
      for (let i = i0; i < i1; i++) pts = pts.concat(vEdge(k, i, i + 1).slice(i > i0 ? 1 : 0));
      return pts;
    };
    return { hEdge, vEdge, vRun };
  }
  const d = (pts: Pt[]) => 'M' + pts.map((p) => `${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join('L');
  const sizeSvg = (W: number, H: number) => {
    svg.setAttribute('width', String(W));
    svg.setAttribute('height', String(H));
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  };

  function layout() {
    if (page?.hasAttribute('data-grid')) layoutGrid();
    else layoutRows();
  }

  // 最初の版: 1行が「写真の面 | 文字の面」。
  function layoutRows() {
    const rows = all.filter((r) => !r.hidden).sort((a, b) => a.offsetTop - b.offsetTop);
    const n = rows.length;
    const cs = getComputedStyle(root);
    const m = parseFloat(cs.getPropertyValue('--m')) || 28;
    const vm = parseFloat(cs.getPropertyValue('--vm')) || 24;
    const W = list.clientWidth;
    const rh = rows[0]?.offsetHeight || 0;
    const face0 = rows[0]?.querySelector<HTMLElement>('[data-face]');
    const sw = face0 ? face0.offsetWidth - m * 2 : W / 2;
    sizeSvg(W, n * rh);
    if (!n) {
      svg.innerHTML = '';
      return;
    }
    const by = Array.from({ length: n + 1 }, (_, i) => i * rh);
    const { hEdge, vEdge, vRun } = mesh([0, sw, W], by, curve ? m * 0.5 : 0, curve ? vm * 0.34 : 0);
    let paths = '';
    for (let i = 0; i <= n; i++) paths += `<path d="${d(hEdge(i, 0, 2))}"/>`;
    for (let k = 0; k < 3; k++) paths += `<path d="${d(vRun(k, 0, n))}"/>`;
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

  // 升目の版: 1つの作品が「写真の面」と、その下の「文字の面」。横に cols 列。
  // 横の線は1段につき2本(写真の上、文字の上)。最後の段が欠けるときは、作品のあるところまでしか線を引かない。
  // 升目の寸法(行の入れ替えや、画面の幅が変わるたびに測り直す)。
  type Grid = { rows: HTMLElement[]; n: number; cols: number; cw: number; g: number; m: number; vm: number; ph: number; rowH: number; R: number; by: number[] };
  let G: Grid | null = null;

  function layoutGrid() {
    const rows = all.filter((r) => !r.hidden);
    const n = rows.length;
    const W = list.clientWidth;
    const lcs = getComputedStyle(list);
    const cols = Math.max(1, lcs.gridTemplateColumns.split(' ').filter(Boolean).length);
    const g = parseFloat(lcs.columnGap) || 0; // 列のあいだ(帯の版だけ、すき間がある)
    const cw = (W - g * (cols - 1)) / cols;
    page!.style.setProperty('--cw', `${cw}px`);
    const cs = getComputedStyle(root);
    const m = parseFloat(cs.getPropertyValue('--m')) || 20;
    const vm = parseFloat(cs.getPropertyValue('--vm')) || 18;
    const ph = cw * (parseFloat(cs.getPropertyValue('--ar')) || 1.3);
    const rowH = rows[0]?.getBoundingClientRect().height || 0; // 端数のまま使う(丸めると、下の段ほど線がずれる)
    const R = Math.ceil(n / cols);
    sizeSvg(W, R * rowH);
    const by: number[] = [];
    for (let r = 0; r < R; r++) by.push(r * rowH, r * rowH + ph);
    by.push(R * rowH);
    G = { rows, n, cols, cw, g, m, vm, ph, rowH, R, by };
    if (!n) {
      svg.innerHTML = '';
      return;
    }
    drawGrid(() => (live ? 0 : 1), 0, 0, R);
  }

  // 升目を描く。amp(c) は列 c のゆれの強さ(-1〜1)、phase は波の位置、r0〜r1 は描く段の範囲。
  function drawGrid(amp: (c: number) => number, phase: number, r0: number, r1: number) {
    if (!G || !G.n) return;
    if (live === 'bands') drawBands(amp, phase, r0, r1);
    else drawSheet(amp(0), phase, r0, r1);
  }

  // 1枚の網: となりの面と線を共有する。
  function drawSheet(a: number, phase: number, r0: number, r1: number) {
    const { rows, n, cols, cw, m, vm, rowH, R, by } = G!;
    const inRow = (r: number) => Math.min(cols, n - r * cols); // その段にある作品の数
    const bx = Array.from({ length: cols + 1 }, (_, k) => k * cw);
    const AV = live ? m * 0.5 * a : curve ? m * 0.32 : 0;
    const AH = live ? vm * 0.3 * a : curve ? vm * 0.25 : 0;
    const { hEdge, vEdge, vRun } = mesh(bx, by, AV, AH, phase);
    let paths = '';
    for (let r = r0; r < r1; r++) {
      paths += `<path d="${d(hEdge(2 * r, 0, r ? inRow(r - 1) : inRow(0)))}"/>`;
      paths += `<path d="${d(hEdge(2 * r + 1, 0, inRow(r)))}"/>`;
    }
    paths += `<path d="${d(hEdge(2 * r1, 0, inRow(r1 - 1)))}"/>`;
    for (let k = 0; k <= cols; k++) {
      let last = R;
      while (last > 0 && inRow(last - 1) < k) last--;
      last = Math.min(last, r1);
      if (last > r0) paths += `<path d="${d(vRun(k, 2 * r0, 2 * last))}"/>`;
    }
    svg.innerHTML = paths;
    for (let idx = r0 * cols; idx < Math.min(n, r1 * cols); idx++) {
      const f = rows[idx].querySelector<HTMLElement>('[data-face]');
      if (!f) continue;
      const r = Math.floor(idx / cols);
      const c = idx % cols;
      const poly = hEdge(2 * r, c, c + 1)
        .concat(vEdge(c + 1, 2 * r, 2 * r + 1).slice(1))
        .concat(hEdge(2 * r + 1, c, c + 1).reverse().slice(1))
        .concat(vEdge(c, 2 * r, 2 * r + 1).reverse().slice(1, -1));
      f.style.clipPath = `polygon(${poly.map((p) => `${(p[0] - c * cw + m).toFixed(1)}px ${(p[1] - r * rowH + vm).toFixed(1)}px`).join(',')})`;
    }
  }

  // 列ごとの帯: 列が1本ずつの帯で、面はその帯を横に切ったもの。帯は幅を変えずに横へしなり、切り口は帯に直角。
  function drawBands(amp: (c: number) => number, phase: number, r0: number, r1: number) {
    const { rows, n, cols, cw, g, m, vm, rowH, R, by } = G!;
    const A = m * 0.7;
    const step = 10;
    let paths = '';
    for (let c = 0; c < cols; c++) {
      const a = amp(c);
      const last = Math.min(r1, Math.ceil((n - c) / cols)); // この帯にある段の数(描く範囲まで)
      if (last <= r0 || n <= c) continue;
      const xL = c * (cw + g);
      const xR = xL + cw;
      // 帯の横ずれと、その傾き。
      const off = (y: number) =>
        A * a * (0.62 * Math.sin(y / 260 + c * 0.9 + phase) + 0.38 * Math.sin(y / 97 + c * 2.3 - phase * 1.7));
      const slope = (y: number) =>
        A * a * ((0.62 / 260) * Math.cos(y / 260 + c * 0.9 + phase) + (0.38 / 97) * Math.cos(y / 97 + c * 2.3 - phase * 1.7));
      // 切り口 j の、左右の端。
      const cut = (j: number): [Pt, Pt] => {
        const t = (cw / 2) * slope(by[j]);
        const yl = by[j] + t;
        const yr = by[j] - t;
        return [
          [xL + off(yl), yl],
          [xR + off(yr), yr],
        ];
      };
      // 帯のふちを、切り口 j0 から j1 まで。side 0: 左 / 1: 右。
      const edge = (side: 0 | 1, j0: number, j1: number): Pt[] => {
        const p0 = cut(j0)[side];
        const p1 = cut(j1)[side];
        const x0 = side ? xR : xL;
        const out: Pt[] = [p0];
        const k = Math.max(1, Math.round((p1[1] - p0[1]) / step));
        for (let i = 1; i < k; i++) {
          const y = p0[1] + ((p1[1] - p0[1]) * i) / k;
          out.push([x0 + off(y), y]);
        }
        out.push(p1);
        return out;
      };
      for (const side of [0, 1] as const) {
        let pts: Pt[] = [];
        for (let j = 2 * r0; j < 2 * last; j++) pts = pts.concat(edge(side, j, j + 1).slice(j > 2 * r0 ? 1 : 0));
        paths += `<path d="${d(pts)}"/>`;
      }
      for (let j = 2 * r0; j <= 2 * last; j++) paths += `<path d="${d(cut(j))}"/>`;
      for (let r = r0; r < last; r++) {
        const row = rows[r * cols + c];
        const f = row?.querySelector<HTMLElement>('[data-face]');
        if (!f) continue;
        const top = cut(2 * r);
        const poly = [top[0]]
          .concat(edge(1, 2 * r, 2 * r + 1))
          .concat(edge(0, 2 * r, 2 * r + 1).reverse().slice(0, -1));
        f.style.clipPath = `polygon(${poly.map((p) => `${(p[0] - xL + m).toFixed(1)}px ${(p[1] - r * rowH + vm).toFixed(1)}px`).join(',')})`;
        // 文字も、帯と一緒に動く。
        const tx = row.querySelector<HTMLElement>('.cl-text');
        if (tx) {
          const o = off(by[2 * r + 1] + (by[2 * r + 2] - by[2 * r + 1]) * 0.4);
          tx.style.transform = Math.abs(o) > 0.05 ? `translate3d(${o.toFixed(1)}px,0,0)` : '';
        }
      }
    }
    svg.innerHTML = paths;
    void R;
  }

  // 動き: 止まっているあいだは直線。送っているあいだだけ、送る速さに応じて線がしなり、止まるとばねで直線へ戻る。
  const K = 120;
  const C = 13;
  const DELAY = 70; // 帯の版で、となりの列が遅れて動く時間(ms)
  let raf = 0;
  let lastT = 0;
  let lastY = 0;
  let a = 0;
  let va = 0;
  let calm = 0;
  let hist: [number, number][] = [];
  const ampAt = (t: number) => {
    for (let i = hist.length - 1; i >= 0; i--) if (hist[i][0] <= t) return hist[i][1];
    return 0;
  };
  function tick(t: number) {
    raf = 0;
    if (!G || !G.n) return;
    const dt = Math.min(0.05, Math.max(0.001, (t - lastT) / 1000));
    lastT = t;
    const y = window.scrollY;
    const vel = (y - lastY) / dt;
    lastY = y;
    const target = Math.max(-1, Math.min(1, vel / 1500));
    va += (K * (target - a) - C * va) * dt;
    a += va * dt;
    hist.push([t, a]);
    root.dataset.amp = a.toFixed(2); // 確認用
    while (hist.length > 2 && hist[1][0] < t - 1000) hist.shift();
    const quiet = Math.abs(target) < 0.004 && Math.abs(a) < 0.01 && Math.abs(va) < 0.08;
    calm = quiet ? calm + dt * 1000 : 0;
    if (calm > (live === 'bands' ? G.cols * DELAY : 0) + 80) {
      // 落ち着いたら、全体を直線で描き直して止める。
      a = 0;
      va = 0;
      hist = [];
      root.dataset.amp = '0';
      drawGrid(() => 0, 0, 0, G.R);
      return;
    }
    const top = list.getBoundingClientRect().top;
    const r0 = Math.max(0, Math.min(G.R - 1, Math.floor(-top / G.rowH) - 1));
    const r1 = Math.max(r0 + 1, Math.min(G.R, Math.ceil((window.innerHeight - top) / G.rowH) + 1));
    drawGrid((c) => (live === 'bands' ? ampAt(t - c * DELAY) : a), y / 420, r0, r1);
    raf = requestAnimationFrame(tick);
  }
  function onScroll() {
    if (raf || !G) return;
    if (!hist.length) {
      lastT = performance.now() - 16;
      lastY = window.scrollY;
    }
    raf = requestAnimationFrame(tick);
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
  if (live) window.addEventListener('scroll', onScroll, { passive: true });
  apply();

  return () => {
    ctl?.removeEventListener('click', onClick);
    ctl?.removeEventListener('change', onChange);
    document.removeEventListener('click', onDocClick);
    document.removeEventListener('keydown', onKey);
    window.removeEventListener('resize', onResize);
    window.removeEventListener('scroll', onScroll);
    cancelAnimationFrame(raf);
    window.removeEventListener('load', layout);
    window.clearTimeout(rt);
    root.classList.remove('is-live');
    page?.style.removeProperty('--cw');
  };
}
