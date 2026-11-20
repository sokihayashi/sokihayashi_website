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
    touched.forEach(clearCell);
    touched = [];
    cellCache = null;
    slack = 0;
    if (glc) glc.style.display = 'none';
    if (live === 'trace') {
      // 並びや幅が変わったら、描いた形は消す。高さが同じなら残す(スマホは、送るたびに画面の高さが変わって、ここを通る)。
      const len = Math.ceil((R * rowH) / STEP) + 2;
      if (trace.length !== len) trace = new Float32Array(len);
      prevYl = null;
      regrab = true;
    }
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
    if (live === 'trace') drawTrace(0, G.R, true);
    else if (live === 'bands') drawBands(amp, phase, r0, r1);
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
      // trace 版では、形は式ではなく、送りながら手で描いた記録(traceAt)から取る。どの列も同じ形。
      const off =
        live === 'trace'
          ? traceAt
          : (y: number) => A * a * (0.62 * Math.sin(y / 260 + c * 0.9 + phase) + 0.38 * Math.sin(y / 97 + c * 2.3 - phase * 1.7));
      const slope =
        live === 'trace'
          ? (y: number) => (traceAt(y + 4) - traceAt(y - 4)) / 8
          : (y: number) =>
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
  // たぐる版: 送ったぶんの一部が「たるみ」として溜まり、少し遅れて抜ける。
  // たるみは、画面の上半分(戻すときは下半分)で、くしゃっとした しわ になって畳まれる。
  // しわの筋は横一直線ではなく、布(一覧)の上の決まった場所を、曲がりくねって走る。
  // 写真は、動いているあいだだけ canvas(WebGL)に細かい網として描き、網の点を しわ の形に動かす。文字の面と枠の線は、同じ写しで動かす。
  const LAMBDA = 118; // しわの間隔(px)
  let slack = 0;
  let still = 0;
  let touched: number[] = [];
  type Cell = { img: HTMLImageElement | null; text: HTMLElement | null };
  let cellCache: Cell[] | null = null;
  const cellOf = (idx: number): Cell => {
    if (!cellCache) cellCache = [];
    return (cellCache[idx] ??= {
      img: G!.rows[idx].querySelector<HTMLImageElement>('[data-face] img'),
      text: G!.rows[idx].querySelector<HTMLElement>('.cl-text'),
    });
  };
  function clearCell(idx: number) {
    if (!G || !G.rows[idx]) return;
    const c = cellOf(idx);
    if (c.img) c.img.style.visibility = '';
    if (c.text) {
      c.text.style.transform = '';
      c.text.style.backgroundColor = '';
    }
  }

  // --- WebGL(写真を網として描く)
  let glc: HTMLCanvasElement | null = null;
  let gl: WebGLRenderingContext | null = null;
  let glOK = true;
  let gl2 = false;
  let vbuf: WebGLBuffer | null = null;
  let ibuf: WebGLBuffer | null = null;
  let uSize: WebGLUniformLocation | null = null;
  let meshKey = '';
  let idxN = 0;
  let verts = new Float32Array(0);
  const texBySrc = new Map<string, { tex: WebGLTexture; w: number; h: number }>();
  function initGL(): boolean {
    if (gl) return true;
    if (!glOK) return false;
    glc = document.createElement('canvas');
    glc.className = 'cl-gl';
    glc.setAttribute('aria-hidden', 'true');
    const opt = { alpha: true, antialias: true, premultipliedAlpha: true };
    gl = (glc.getContext('webgl2', opt) || glc.getContext('webgl', opt)) as WebGLRenderingContext | null;
    if (!gl) {
      glOK = false;
      glc = null;
      return false;
    }
    gl2 = typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext;
    const sh = (type: number, src: string) => {
      const o = gl!.createShader(type)!;
      gl!.shaderSource(o, src);
      gl!.compileShader(o);
      return o;
    };
    const prog = gl.createProgram()!;
    gl.attachShader(
      prog,
      sh(
        gl.VERTEX_SHADER,
        'attribute vec2 p;attribute vec2 uv;attribute float sh;uniform vec2 size;varying vec2 vuv;varying float vsh;' +
          'void main(){vuv=uv;vsh=sh;gl_Position=vec4(p.x/size.x*2.-1.,1.-p.y/size.y*2.,0.,1.);}'
      )
    );
    gl.attachShader(
      prog,
      sh(
        gl.FRAGMENT_SHADER,
        'precision mediump float;uniform sampler2D t;varying vec2 vuv;varying float vsh;' +
          'void main(){vec3 c=texture2D(t,vuv).rgb;c=vsh>0.?mix(c,vec3(1.),vsh*.34):mix(c,vec3(0.),-vsh*.72);gl_FragColor=vec4(c,1.);}'
      )
    );
    gl.bindAttribLocation(prog, 0, 'p');
    gl.bindAttribLocation(prog, 1, 'uv');
    gl.bindAttribLocation(prog, 2, 'sh');
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      glOK = false;
      gl = null;
      glc = null;
      return false;
    }
    gl.useProgram(prog);
    uSize = gl.getUniformLocation(prog, 'size');
    vbuf = gl.createBuffer();
    ibuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbuf);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibuf);
    gl.enableVertexAttribArray(0);
    gl.enableVertexAttribArray(1);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 20, 0);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 20, 8);
    gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 20, 16);
    root.appendChild(glc);
    return true;
  }
  function texFor(img: HTMLImageElement) {
    const key = img.currentSrc || img.src;
    const hit = texBySrc.get(key);
    if (hit) return hit;
    if (!img.complete || !img.naturalWidth) return null;
    try {
      const tex = gl!.createTexture()!;
      gl!.bindTexture(gl!.TEXTURE_2D, tex);
      gl!.texImage2D(gl!.TEXTURE_2D, 0, gl!.RGBA, gl!.RGBA, gl!.UNSIGNED_BYTE, img);
      gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_WRAP_S, gl!.CLAMP_TO_EDGE);
      gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_WRAP_T, gl!.CLAMP_TO_EDGE);
      gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_MAG_FILTER, gl!.LINEAR);
      if (gl2) {
        gl!.generateMipmap(gl!.TEXTURE_2D);
        gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_MIN_FILTER, gl!.LINEAR_MIPMAP_LINEAR);
      } else gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_MIN_FILTER, gl!.LINEAR);
      const o = { tex, w: img.naturalWidth, h: img.naturalHeight };
      texBySrc.set(key, o);
      return o;
    } catch {
      return null;
    }
  }

  // しわの場(画面の上か下の帯)の中だけ、横 DX・縦 DY きざみで表を作る。
  let tabF = new Float32Array(0); // もとの高さ → 描く高さ
  let tabT = new Float32Array(0); // 面の傾き(陰)
  let tabI = new Float32Array(0);
  function drawGather() {
    const { n, cols, cw, ph, rowH, R, by } = G!;
    const vh = window.innerHeight;
    const atTop = slack > 0;
    const zh = Math.min(250, vh * 0.3); // しわが寄る場所の、半分の高さ
    const zc = atTop ? zh + 10 : vh - zh - 10;
    const z0 = zc - zh;
    const z1 = zc + zh;
    const listTop = list.getBoundingClientRect().top;
    const W = list.clientWidth;
    const DX = 12;
    const nx = Math.ceil(W / DX) + 1;
    const ny = Math.ceil((z1 - z0) / 4) + 1;
    const DY = (z1 - z0) / (ny - 1);
    if (tabF.length !== nx * ny) {
      tabF = new Float32Array(nx * ny);
      tabT = new Float32Array(nx * ny);
      tabI = new Float32Array(nx);
    }
    // 1) 縮みやすさ c と、しわの山のどちら側か t。しわの筋は2組(ほぼ横と、斜め)で、どちらも曲がりくねる。
    const TAU = Math.PI * 2;
    let Imin = Infinity;
    for (let xi = 0; xi < nx; xi++) {
      const x = xi * DX;
      let I = 0;
      let prev = 0;
      for (let yi = 0; yi < ny; yi++) {
        const v = z0 + yi * DY;
        const yp = v - listTop; // 布の上の位置
        const e = 0.5 - 0.5 * Math.cos((Math.PI * yi) / (ny - 1) * 2);
        const f1 =
          yp / LAMBDA +
          0.78 * Math.sin(x / 96 + 1.7 * Math.sin(yp / 230) + 0.6) +
          0.4 * Math.sin(x / 43 - yp / 170 + 2.1) +
          0.13 * Math.sin(x / 21 + yp / 53);
        const f2 = yp / (LAMBDA * 1.55) - x / 150 + 0.45 * Math.sin(x / 67 + yp / 120 + 4);
        const q1 = 0.5 - 0.5 * Math.cos(TAU * f1);
        const q2 = 0.5 - 0.5 * Math.cos(TAU * f2);
        const q = 0.62 * q1 + 0.38 * q2;
        const c = e * q;
        const t =
          (0.62 * q1 * Math.cos(Math.PI * (f1 - Math.floor(f1))) + 0.38 * q2 * Math.cos(Math.PI * (f2 - Math.floor(f2)))) / (q + 1e-4);
        tabF[xi * ny + yi] = c;
        tabT[xi * ny + yi] = t;
        if (yi) I += ((c + prev) / 2) * DY;
        prev = c;
      }
      tabI[xi] = I;
      if (I < Imin) Imin = I;
    }
    // 2) たるみは、どの列でも同じ量だけ畳む(場の外では、布がまっすぐに戻るように)。
    const S = Math.min(Math.abs(slack), 0.88 * Imin);
    for (let xi = 0; xi < nx; xi++) {
      const A = tabI[xi] > 0 ? S / tabI[xi] : 0;
      const o = xi * ny;
      if (atTop) {
        let next = tabF[o + ny - 1];
        tabT[o + ny - 1] *= Math.sqrt(Math.max(0, 1 - (1 - A * next) ** 2));
        tabF[o + ny - 1] = z1;
        for (let yi = ny - 2; yi >= 0; yi--) {
          const c = tabF[o + yi];
          tabT[o + yi] *= Math.sqrt(Math.max(0, 1 - (1 - A * c) ** 2));
          tabF[o + yi] = tabF[o + yi + 1] - (1 - (A * (c + next)) / 2) * DY;
          next = c;
        }
      } else {
        let prev = tabF[o];
        tabT[o] *= Math.sqrt(Math.max(0, 1 - (1 - A * prev) ** 2));
        tabF[o] = z0;
        for (let yi = 1; yi < ny; yi++) {
          const c = tabF[o + yi];
          tabT[o + yi] *= Math.sqrt(Math.max(0, 1 - (1 - A * c) ** 2));
          tabF[o + yi] = tabF[o + yi - 1] + (1 - (A * (c + prev)) / 2) * DY;
          prev = c;
        }
      }
    }
    const look = (tab: Float32Array, x: number, v: number) => {
      const fx = Math.max(0, Math.min(nx - 1.001, x / DX));
      const xi = Math.floor(fx);
      const ax = fx - xi;
      const fy = Math.max(0, Math.min(ny - 1.001, (v - z0) / DY));
      const yi = Math.floor(fy);
      const ay = fy - yi;
      const a = tab[xi * ny + yi] + (tab[xi * ny + yi + 1] - tab[xi * ny + yi]) * ay;
      const b = tab[(xi + 1) * ny + yi] + (tab[(xi + 1) * ny + yi + 1] - tab[(xi + 1) * ny + yi]) * ay;
      return a + (b - a) * ax;
    };
    // もとの高さ v(画面の中での高さ)が、どこに描かれるか。
    const map = (x: number, v: number) => {
      if (v >= z1) return atTop ? v : v - S;
      if (v <= z0) return atTop ? v + S : v;
      return look(tabF, x, v);
    };
    const tilt = (x: number, v: number) => (v >= z1 || v <= z0 ? 0 : look(tabT, x, v));

    const r0 = Math.max(0, Math.min(R - 1, Math.floor((-S - listTop) / rowH)));
    const r1 = Math.max(r0 + 1, Math.min(R, Math.ceil((vh + S - listTop) / rowH)));
    // 3) 写真: 網にして canvas へ。canvas は一覧と一緒に送られる場所に置く(送りに遅れても、写真と枠がずれない)。
    const M = 220;
    const Hc = vh + M * 2;
    const useGL = initGL();
    if (useGL && glc && gl) {
      const dpr = Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(6e6 / (W * Hc)));
      const pw = Math.round(W * dpr);
      const phx = Math.round(Hc * dpr);
      if (glc.width !== pw || glc.height !== phx) {
        glc.width = pw;
        glc.height = phx;
        glc.style.width = `${W}px`;
        glc.style.height = `${Hc}px`;
      }
      glc.style.display = '';
      glc.style.transform = `translate3d(0,${(-listTop - M).toFixed(1)}px,0)`;
      gl.viewport(0, 0, pw, phx);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.uniform2f(uSize, W, Hc);
      const mx = Math.min(40, Math.max(4, Math.ceil(cw / 13)));
      const my = Math.min(64, Math.max(6, Math.ceil(ph / 7)));
      if (meshKey !== `${mx}x${my}`) {
        meshKey = `${mx}x${my}`;
        const ix = new Uint16Array(mx * my * 6);
        let k = 0;
        for (let j = 0; j < my; j++)
          for (let i = 0; i < mx; i++) {
            const a = j * (mx + 1) + i;
            ix[k++] = a;
            ix[k++] = a + 1;
            ix[k++] = a + mx + 1;
            ix[k++] = a + 1;
            ix[k++] = a + mx + 2;
            ix[k++] = a + mx + 1;
          }
        idxN = k;
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, ix, gl.STATIC_DRAW);
        verts = new Float32Array((mx + 1) * (my + 1) * 5);
      }
      for (let idx = r0 * cols; idx < Math.min(n, r1 * cols); idx++) {
        const c = cellOf(idx);
        const t = c.img ? texFor(c.img) : null;
        if (!t || !c.img) continue;
        const r = Math.floor(idx / cols);
        const x0 = (idx % cols) * cw;
        const top = listTop + r * rowH;
        // object-fit: cover と同じ切り取り。
        const ab = cw / ph;
        const ai = t.w / t.h;
        const fu = ai > ab ? ab / ai : 1;
        const fv = ai > ab ? 1 : ai / ab;
        let k = 0;
        for (let j = 0; j <= my; j++) {
          const v = top + (ph * j) / my;
          for (let i = 0; i <= mx; i++) {
            const x = x0 + (cw * i) / mx;
            verts[k++] = x;
            verts[k++] = map(x, v) + M;
            verts[k++] = 0.5 + (i / mx - 0.5) * fu;
            verts[k++] = 0.5 + (j / my - 0.5) * fv;
            verts[k++] = tilt(x, v);
          }
        }
        gl.bindTexture(gl.TEXTURE_2D, t.tex);
        gl.bufferData(gl.ARRAY_BUFFER, verts, gl.DYNAMIC_DRAW);
        gl.drawElements(gl.TRIANGLES, idxN, gl.UNSIGNED_SHORT, 0);
        c.img.style.visibility = 'hidden';
      }
    }
    // 4) 文字の面: 面ごと、しわに合わせて縮めて傾ける。
    const now: number[] = [];
    for (let idx = r0 * cols; idx < Math.min(n, r1 * cols); idx++) {
      now.push(idx);
      const c = cellOf(idx);
      if (!c.text) continue;
      const r = Math.floor(idx / cols);
      const x0 = (idx % cols) * cw;
      const t0 = listTop + r * rowH + ph;
      const t1 = listTop + (r + 1) * rowH;
      const a = map(x0, t0);
      const b = map(x0 + cw, t0);
      const c2 = map(x0, t1);
      const d2 = map(x0 + cw, t1);
      const skew = (b - a + (d2 - c2)) / 2 / cw;
      const sy = (c2 - a + (d2 - b)) / 2 / (t1 - t0);
      c.text.style.transform =
        Math.abs(a - t0) < 0.05 && Math.abs(sy - 1) < 0.002 && Math.abs(skew) < 0.001
          ? ''
          : `matrix(1,${skew.toFixed(4)},0,${sy.toFixed(4)},0,${(a - t0).toFixed(2)})`;
      const tl = tilt(x0 + cw / 2, (t0 + t1) / 2);
      c.text.style.backgroundColor = tl > 0.01 ? `rgba(244,241,234,${(tl * 0.18).toFixed(3)})` : '';
    }
    for (const idx of touched) if (idx < r0 * cols || idx >= r1 * cols) clearCell(idx);
    touched = now;
    // 5) 枠の線も、同じ写しで引き直す。
    const inRow = (r: number) => Math.min(cols, n - r * cols);
    const hLine = (j: number, span: number) => {
      const xe = cw * span;
      const v = listTop + by[j];
      let out = '';
      for (let x = 0; x < xe; x += DX) out += `${out ? 'L' : 'M'}${x.toFixed(1)} ${(map(x, v) - listTop).toFixed(1)}`;
      return `<path d="${out}L${xe.toFixed(1)} ${(map(xe, v) - listTop).toFixed(1)}"/>`;
    };
    let paths = '';
    for (let r = r0; r < r1; r++) {
      paths += hLine(2 * r, r ? inRow(r - 1) : inRow(0));
      paths += hLine(2 * r + 1, inRow(r));
    }
    paths += hLine(2 * r1, inRow(r1 - 1));
    for (let k = 0; k <= cols; k++) {
      let last = R;
      while (last > 0 && inRow(last - 1) < k) last--;
      last = Math.min(last, r1);
      if (last <= r0) continue;
      const x = k * cw;
      let out = '';
      for (let j = 2 * r0; j <= 2 * last; j++) out += `${out ? 'L' : 'M'}${x.toFixed(1)} ${(map(x, listTop + by[j]) - listTop).toFixed(1)}`;
      paths += `<path d="${out}"/>`;
    }
    svg.innerHTML = paths;
  }
  function tickGather(t: number) {
    raf = 0;
    if (!G || !G.n) return;
    const dt = Math.min(0.5, Math.max(0.001, (t - lastT) / 1000)); // 描くのが遅い機械でも、たるみが抜ける時間は同じにする
    lastT = t;
    const y = window.scrollY;
    const moved = y - lastY;
    lastY = y;
    const max = Math.min(150, window.innerHeight * 0.19);
    slack = Math.max(-max, Math.min(max, slack + moved * 0.6)) * Math.exp(-dt / 0.34);
    still = moved === 0 ? still + dt * 1000 : 0;
    root.dataset.amp = slack.toFixed(1); // 確認用
    if (Math.abs(slack) < 0.8 && still > 60) {
      // たるみが抜けたら、もとの直線へ戻して止める。
      slack = 0;
      root.dataset.amp = '0';
      touched.forEach(clearCell);
      touched = [];
      if (glc) glc.style.display = 'none';
      drawGrid(() => 0, 0, 0, G.R);
      return;
    }
    drawGather();
    raf = requestAnimationFrame(tickGather);
  }

  // 描く版(trace): 帯は、置いたところに留まる紐。指(PC ではカーソル)の下の一点を、横の動きで直接ひっぱる。
  //   - ひっぱった点は、その場ですぐ動く(遅れない)。まわりは、帯が折れない範囲で一緒についてくる。
  //   - 指を置いたまま送るあいだ、指の下の点は変わらない。離して流れているあいだは、指のあった高さを通る帯に書き込まれる。
  //   - 形は残る。ペンは少しずつ中央へ戻るので、動かさずに送った所は、まっすぐへ寄っていく。
  const STEP = 6; // 記録のきざみ(px、一覧の上からの位置)
  let trace = new Float32Array(0);
  const rawAt = (i: number) => trace[i < 0 ? 0 : i >= trace.length ? trace.length - 1 : i];
  // 描くときは、角を丸めて読む(前後 24px をならす)。
  const traceAt = (y: number) => {
    if (!trace.length) return 0;
    const f = Math.max(0, Math.min(trace.length - 1, y / STEP));
    const i = Math.floor(f);
    const k = f - i;
    const at = (j: number) => (rawAt(j - 4) + 4 * rawAt(j - 2) + 6 * rawAt(j) + 4 * rawAt(j + 2) + rawAt(j + 4)) / 16;
    return at(i) + (at(i + 1) - at(i)) * k;
  };
  // 描く版の描画。線は作品ごとに1本の path にして、形が変わった段だけ書き換える(毎コマ全部を作り直さない)。
  // 帯の形はどの列も同じなので、段ごとに1回だけ計算して、列のぶん横へずらす。
  let cellPaths: SVGPathElement[] = [];
  let cellEls: { f: HTMLElement | null; tx: HTMLElement | null }[] = [];
  function drawTrace(r0: number, r1: number, rebuild: boolean) {
    const { rows, n, cols, cw, g, m, vm, rowH, R, by } = G!;
    if (rebuild) {
      svg.innerHTML = rows.map(() => '<path/>').join('');
      cellPaths = Array.from(svg.querySelectorAll('path'));
      cellEls = rows.map((row) => ({ f: row.querySelector<HTMLElement>('[data-face]'), tx: row.querySelector<HTMLElement>('.cl-text') }));
      r0 = 0;
      r1 = R;
    }
    const slope = (y: number) => (traceAt(y + 4) - traceAt(y - 4)) / 8;
    // 切り口 j の、左右の端(列0の位置で)。切り口は帯に直角。
    const cut = (j: number): [Pt, Pt] => {
      const t = (cw / 2) * slope(by[j]);
      return [
        [traceAt(by[j] + t), by[j] + t],
        [cw + traceAt(by[j] - t), by[j] - t],
      ];
    };
    const edge = (x0: number, p0: Pt, p1: Pt): Pt[] => {
      const out: Pt[] = [p0];
      const k = Math.max(1, Math.round((p1[1] - p0[1]) / 10));
      for (let i = 1; i < k; i++) {
        const y = p0[1] + ((p1[1] - p0[1]) * i) / k;
        out.push([x0 + traceAt(y), y]);
      }
      out.push(p1);
      return out;
    };
    const str = (pts: Pt[], dx: number) => pts.map((q) => `${(q[0] + dx).toFixed(1)} ${q[1].toFixed(1)}`).join('L');
    for (let r = Math.max(0, r0); r < Math.min(R, r1); r++) {
      const [L0, R0] = cut(2 * r);
      const [L1, R1] = cut(2 * r + 1);
      const [L2, R2] = cut(2 * r + 2);
      const right = edge(cw, R0, R1).concat(edge(cw, R1, R2).slice(1));
      const left = edge(0, L0, L1).concat(edge(0, L1, L2).slice(1));
      const photo = [L0].concat(edge(cw, R0, R1)).concat(edge(0, L0, L1).reverse().slice(0, -1));
      const clip = `polygon(${photo.map((q) => `${(q[0] + m).toFixed(1)}px ${(q[1] - r * rowH + vm).toFixed(1)}px`).join(',')})`;
      const o = traceAt(by[2 * r + 1] + (by[2 * r + 2] - by[2 * r + 1]) * 0.4);
      const tf = Math.abs(o) > 0.05 ? `translate3d(${o.toFixed(1)}px,0,0)` : '';
      for (let c = 0; c < cols; c++) {
        const idx = r * cols + c;
        if (idx >= n) break;
        const dx = c * (cw + g);
        const end = idx + cols >= n; // この帯の最後の面(下の切り口も引く)
        cellPaths[idx]?.setAttribute(
          'd',
          `M${str([L0], dx)}L${str(right, dx)}${end ? 'L' : 'M'}${str(left.slice().reverse(), dx)}M${str([L1, R1], dx)}`
        );
        const el = cellEls[idx];
        if (el?.f) el.f.style.clipPath = clip;
        if (el?.tx) el.tx.style.transform = tf;
      }
    }
  }
  // ペンの横位置 px は、3つの入力の「横に動いたぶん」を足し込んだもの:
  //   指(スマホ)の横の動き / トラックパッドの2本指の横の動き(wheel の deltaX) / マウスのカーソルの横の動き
  let px = 0;
  let pBase = 0; // ゆっくり px を追う基準。px - pBase がペンの横ずれ
  let penY = -1; // ペンの高さ(画面の中。指やカーソルのある高さ)
  let lastMX: number | null = null;
  let lastTX: number | null = null;
  let lastTT = 0;
  let lastTY = 0;
  let vx = 0; // 指の横の速さ(px/秒、倍率こみ)
  let vy = 0; // 指の縦の速さ(px/秒)
  let lean = 0; // 指を離したときの、線の向き(縦に1進むあいだに横へ進む量)。流れているあいだ、この向きに少し伸びる
  let touching = false;
  let regrab = true; // 次の一手で、ペンを「いま帯がある位置」から始める(帯を飛ばさない)
  let prevYl: number | null = null;
  let prevPen = 0;
  let quietT = 0;
  const GAIN_TOUCH = 1.25; // ほぼ指の動きどおり(大きくしすぎると、すぐ端に当たって、指についてこなくなる)
  const GAIN_WHEEL = 1.3;
  const GAIN_MOUSE = 0.55;
  const penAt = () => (penY < 0 ? window.innerHeight * 0.5 : penY) - list.getBoundingClientRect().top;
  function tickTrace(t: number) {
    raf = 0;
    if (!G || !G.n) return;
    const dt = Math.min(0.1, Math.max(0.001, (t - lastT) / 1000));
    lastT = t;
    const y = window.scrollY;
    const moved = y - lastY;
    lastY = y;
    const max = G.m - 6;
    const yl = penAt();
    if (regrab) {
      // ペンを、いま帯がある位置から始める(帯を飛ばさない)。
      const at = Math.max(-0.98, Math.min(0.98, traceAt(yl) / max));
      pBase = px - max * 0.5 * Math.log((1 + at) / (1 - at));
      prevYl = null;
      regrab = false;
    }
    // ペンが帯の上を進んだ長さ。帯は、手か送りが動いたぶんしか変わらない(時間では動かさない)。
    const slid = prevYl === null ? 0 : Math.min(80, Math.abs(yl - prevYl));
    if (!touching && slid) {
      px += lean * slid; // はじいた向きへ、少し伸びる
      lean *= Math.exp(-slid / 200);
      pBase = px - (px - pBase) * Math.exp(-slid / 520); // 進むにつれて、中央へ戻る
    }
    // 端は壁にしない。遠くへ引くほど、ゆるやかに動かなくなる。
    let raw = px - pBase;
    if (Math.abs(raw) > max * 1.7) {
      raw = Math.sign(raw) * max * 1.7;
      pBase = px - raw;
    }
    const pen = max * Math.tanh(raw / max);
    const last = trace.length - 1;
    let cLo = Infinity;
    let cHi = -Infinity;
    const put = (i: number, v: number) => {
      if (Math.abs(trace[i] - v) > 0.02) {
        if (i < cLo) cLo = i;
        if (i > cHi) cHi = i;
      }
      trace[i] = v;
    };
    if (yl >= 0 && yl <= last * STEP) {
      const from = prevYl === null ? yl : prevYl;
      const iA = Math.max(0, Math.round(Math.min(from, yl) / STEP));
      const iB = Math.min(last, Math.round(Math.max(from, yl) / STEP));
      for (let i = iA; i <= iB; i++) {
        const f = yl === from ? 1 : Math.max(0, Math.min(1, (i * STEP - from) / (yl - from)));
        put(i, prevPen + (pen - prevPen) * f);
      }
      // まわりは、帯が折れない傾きまで、ついてくる。
      const lim = 0.26 * STEP;
      for (let i = iB + 1; i <= last; i++) {
        if (trace[i] > trace[i - 1] + lim) put(i, trace[i - 1] + lim);
        else if (trace[i] < trace[i - 1] - lim) put(i, trace[i - 1] - lim);
        else break;
      }
      for (let i = iA - 1; i >= 0; i--) {
        if (trace[i] > trace[i + 1] + lim) put(i, trace[i + 1] + lim);
        else if (trace[i] < trace[i + 1] - lim) put(i, trace[i + 1] - lim);
        else break;
      }
      prevYl = yl;
      prevPen = pen;
    } else prevYl = null;
    root.dataset.amp = pen.toFixed(1); // 確認用
    if (cHi >= cLo) {
      // 形が変わった所にかかる段だけ、描き直す。
      const yA = cLo * STEP - 40 - G.vm;
      const yB = cHi * STEP + 40 + G.vm;
      drawTrace(Math.floor(yA / G.rowH), Math.floor(yB / G.rowH) + 1, false);
    }
    quietT = moved || cHi >= cLo ? 0 : quietT + dt * 1000;
    if (quietT > 200 && !touching) {
      regrab = true;
      return;
    }
    raf = requestAnimationFrame(tickTrace);
  }
  function kickTrace() {
    quietT = 0;
    if (raf || !G) return;
    lastT = performance.now() - 16;
    lastY = window.scrollY;
    raf = requestAnimationFrame(tickTrace);
  }
  function onPointer(e: MouseEvent | TouchEvent) {
    if (!('touches' in e)) {
      if (lastMX !== null) px += (e.clientX - lastMX) * GAIN_MOUSE;
      lastMX = e.clientX;
      if (Math.abs(e.clientY - penY) > 2) prevYl = null; // ペンの高さが変わったら、あいだは埋めない
      penY = e.clientY;
      return;
    }
    if (!e.touches.length) {
      // 指を離した。線の向きを覚えておく(流れているあいだ、その向きに少し伸びる)。
      touching = false;
      lastTX = null;
      lean = Math.abs(vy) > 150 ? Math.max(-0.4, Math.min(0.4, vx / Math.abs(vy))) : 0;
      kickTrace();
      return;
    }
    const x = e.touches[0].clientX;
    const now = performance.now();
    penY = e.touches[0].clientY;
    if (e.type === 'touchstart' || lastTX === null) {
      vx = 0;
      vy = 0;
      lean = 0;
      touching = true;
      regrab = true; // 触れた点を、いまある位置からつかむ
    } else {
      const d = (x - lastTX) * GAIN_TOUCH;
      px += d;
      const dt = Math.max(0.004, (now - lastTT) / 1000);
      vx += (d / dt - vx) * 0.35;
      vy += ((e.touches[0].clientY - lastTY) / dt - vy) * 0.35;
      kickTrace(); // 横に動かしただけでも、帯は動く
    }
    lastTX = x;
    lastTY = e.touches[0].clientY;
    lastTT = now;
  }
  function onWheel(e: WheelEvent) {
    if (e.ctrlKey) return;
    if (Math.abs(e.clientY - penY) > 2) prevYl = null;
    penY = e.clientY;
    if (!e.deltaX) return;
    // 2本指を右へ動かすと deltaX は負(標準の設定)。指の向きに帯が動くようにする。
    px -= e.deltaX * (e.deltaMode === 1 ? 16 : 1) * GAIN_WHEEL;
    kickTrace();
  }

  function onScroll() {
    if (live === 'trace') {
      kickTrace();
      return;
    }
    if (raf || !G) return;
    if (live === 'gather') {
      if (slack === 0) {
        lastT = performance.now() - 16;
        lastY = window.scrollY;
      }
      raf = requestAnimationFrame(tickGather);
      return;
    }
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
  if (live === 'trace') {
    window.addEventListener('mousemove', onPointer, { passive: true });
    window.addEventListener('wheel', onWheel, { passive: true });
    window.addEventListener('touchstart', onPointer, { passive: true });
    window.addEventListener('touchmove', onPointer, { passive: true });
    window.addEventListener('touchend', onPointer, { passive: true });
    window.addEventListener('touchcancel', onPointer, { passive: true });
  }
  apply();

  return () => {
    ctl?.removeEventListener('click', onClick);
    ctl?.removeEventListener('change', onChange);
    document.removeEventListener('click', onDocClick);
    document.removeEventListener('keydown', onKey);
    window.removeEventListener('resize', onResize);
    window.removeEventListener('scroll', onScroll);
    window.removeEventListener('mousemove', onPointer);
    window.removeEventListener('wheel', onWheel);
    window.removeEventListener('touchstart', onPointer);
    window.removeEventListener('touchmove', onPointer);
    window.removeEventListener('touchend', onPointer);
    window.removeEventListener('touchcancel', onPointer);
    cancelAnimationFrame(raf);
    window.removeEventListener('load', layout);
    window.clearTimeout(rt);
    root.classList.remove('is-live');
    page?.style.removeProperty('--cw');
    glc?.remove();
  };
}
