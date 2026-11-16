// トップのステージ。
//
// 核になる考え:
//   価値は最初からある。形だけがない。掬って、器に流し込むと、形になる。
//
// 画面で起きること:
//   ・はじめ  … 水滴(HYDRA)がひとつ。まわりに、案件名の札が付いた空の器が待っている
//   ・掬う    … 水滴を切ると、飛沫がそれぞれの器の口へ飛ぶ
//   ・満ちる  … 器に黒い液が上がり、満ちると澄んで作品が見える。器の線は外れる
//   ・進む    … 次の器が入ってくるたびに、同じことが起きる
//   ・最後    … 空の器がひとつ残っている。「次は、あなたの案件。」
//
// 決まりごと(合議で決めたもの):
//   ・1器=1案件。器は必ず題名を持ち、押すと詳細へ行く
//   ・飛沫には必ず行き先がある(器の口に着く)
//   ・文字は常に水平。動くのは位置だけ
//   ・戻る・共有・再訪では演出を飛ばし、満ちた状態で同じ器を出す(#w=3)
//
// PC … 斜めの軸に沿って並べ、自前で送る(mountDiagonal)
// スマホ … 真縦。ブラウザ本来のスクロールに任せ、1画面に1案件(mountFlow)

import { fly, makePour, pourAfter, pourReset, pourSet, prime, type Pour } from './pour';

type Kind = 'hero' | 'work' | 'vessel' | 'end';

interface StageNode {
  el: HTMLElement;
  kind: Kind;
  s: number; // 軸上の位置(px)
  off: number; // 軸に直交する方向のずらし(px)。0 が中央の列
  hw: number;
  hh: number;
  vh: number; // 器そのものの高さの半分(札を除く)
  used: boolean;
  pour: Pour | null;
  seed: number;
  x: number; // 画面上の中心(px)
  y: number;
  onScreen: boolean;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const isSmall = () =>
  Math.min(window.innerWidth, window.innerHeight) < 640 || window.innerWidth < 720;
const pad2 = (n: number) => String(n).padStart(2, '0');

function writeHash(w: number) {
  const url = w > 0 ? `#w=${w}` : location.pathname + location.search;
  if ((w > 0 ? url : '') === location.hash) return;
  history.replaceState(history.state, '', url);
}

export function mountStage(root: HTMLElement): () => void {
  let small = isSmall();
  let dispose = small ? mountFlow(root) : mountDiagonal(root);
  const onResize = () => {
    const now = isSmall();
    if (now === small) return;
    small = now;
    dispose();
    dispose = small ? mountFlow(root) : mountDiagonal(root);
  };
  window.addEventListener('resize', onResize);
  return () => {
    window.removeEventListener('resize', onResize);
    dispose();
  };
}

// ============================================================
// PC: 斜めの軸
//   軸の向き d = (cos a, sin a)。a は水平からの角度(度)。
//   進むと中身は左上へ流れ、次が右下から入ってくる。
// ============================================================
function mountDiagonal(root: HTMLElement): () => void {
  const hydra = root.querySelector<HTMLIFrameElement>('[data-hydra]');
  const beadBox = root.querySelector<HTMLElement>('[data-beads]');
  const counter = root.querySelector<HTMLElement>('[data-counter]');
  const cue = root.querySelector<HTMLElement>('[data-cue]');
  const reserves = Array.from(root.querySelectorAll<HTMLElement>('[data-reserve]'));
  const timers: number[] = [];

  const nodes: StageNode[] = Array.from(root.querySelectorAll<HTMLElement>('[data-node]')).map(
    (el, i) => ({
      el,
      kind: (el.dataset.node as Kind) || 'work',
      s: 0,
      off: 0,
      hw: 0,
      hh: 0,
      vh: 0,
      used: true,
      pour: el.querySelector('.vessel-fill img') ? makePour(el) : null,
      seed: i * 1.917,
      x: 0,
      y: 0,
      onScreen: false,
    })
  );
  const works = nodes.filter((n) => n.kind === 'work');
  const vessels = nodes.filter((n) => n.kind === 'vessel');
  const spine = nodes.filter((n) => n.kind !== 'vessel');

  const hash = new URLSearchParams(location.hash.replace(/^#/, ''));
  const angle = hash.has('a') ? clamp(Number(hash.get('a')), 0, 90) : Number(root.dataset.angle || 28);
  let dx = 1;
  let dy = 0;
  let nx = 0;
  let ny = 1;
  let vw = 0;
  let vh = 0;
  let span = 0; // 画面を軸方向に測った長さ
  let hold = 0; // ヒーローを留めておく送り量
  let maxPos = 0;
  let pos = 0;
  let target = 0;
  let drawn = -1;
  let raf = 0;
  let last = 0;
  let lastCut = 0;
  let cutAcc = 0;
  let lastScrollSent = -1;
  let burstAt = 0;
  let quiet = false; // 途中から開いた(演出を飛ばす)
  let paused = false;
  let focusIdx = 0;

  root.classList.add('is-live', 'pour-on');
  document.documentElement.classList.add('stage-on');

  function post(msg: unknown) {
    hydra?.contentWindow?.postMessage(msg, '*');
  }
  const sendScale = () => post({ hdwScale: 1.7 });

  function measure() {
    vw = root.clientWidth;
    vh = root.clientHeight;
    const a = (angle * Math.PI) / 180;
    dx = Math.cos(a);
    dy = Math.sin(a);
    nx = -dy;
    ny = dx;
    span = Math.abs(vw * dx) + Math.abs(vh * dy);
    hold = Math.round(clamp(Math.min(vw, vh) * 0.7, 300, 620));
    sendScale();
  }

  const alongD = (w: number, h: number) => Math.abs(w * dx) + Math.abs(h * dy);
  const alongN = (w: number, h: number) => Math.abs(w * nx) + Math.abs(h * ny);

  function layout() {
    for (const n of nodes) {
      n.hw = n.el.offsetWidth / 2;
      n.hh = n.el.offsetHeight / 2;
      const v = n.el.querySelector<HTMLElement>('.vessel');
      n.vh = v ? v.offsetHeight / 2 : n.hh;
    }
    const pad = clamp(Math.min(vw, vh) * 0.06, 28, 72);

    // 中央の列: 水滴 → 代表の案件 → 空の器(次の案件)
    // 隣り合う2つが重ならない最小の間隔で並べる。
    let cursor = 0;
    let prev: StageNode | undefined;
    let cardN = 0;
    for (const n of spine) {
      n.off = 0;
      if (n.kind === 'hero') {
        n.s = 0;
        continue;
      }
      if (!prev) {
        // 最初の器は、はじめの画面の右下に口を覗かせておく。
        cursor = span * 0.5;
      } else {
        const w = prev.hw + n.hw + pad;
        const h = prev.hh + n.hh + pad;
        const byX = Math.abs(dx) > 0.05 ? w / Math.abs(dx) : Infinity;
        const byY = Math.abs(dy) > 0.05 ? h / Math.abs(dy) : Infinity;
        cursor += Math.min(byX, byY);
      }
      n.s = cursor;
      prev = n;
      cardN = Math.max(cardN, alongN(n.hw * 2, n.hh * 2) / 2);
    }
    const endS = cursor;
    maxPos = hold + endS;

    // 外側の列: そのほかの案件。軸と平行な2本の列に、均等に置く。重ねない。
    const sample = vessels[0];
    const lanes: number[] = [];
    if (sample) {
      const vN = alongN(sample.hw * 2, sample.hh * 2);
      const off = Math.max(cardN, Math.min(vw, vh) * 0.3) + vN / 2 + pad * 0.8;
      if (off - vN / 2 < alongN(vw, vh) / 2) lanes.push(off, -off);
    }
    const start = -span * 0.42;
    const limit = endS + span * 0.3;
    const perLane = Math.max(1, Math.ceil(vessels.length / Math.max(1, lanes.length)));
    const step = (limit - start) / perLane;
    const zones = reserves.map((el) => el.getBoundingClientRect());
    const hits = (n: StageNode, s: number, off: number) => {
      const x = vw / 2 + dx * s + nx * off;
      const y = vh / 2 + dy * s + ny * off;
      return zones.some(
        (z) =>
          x + n.hw > z.left - 24 && x - n.hw < z.right + 24 && y + n.hh > z.top - 24 && y - n.hh < z.bottom + 24
      );
    };
    const cursors = lanes.map((_, i) => start + (i % 2) * step * 0.5);
    vessels.forEach((n, i) => {
      n.used = lanes.length > 0;
      n.el.classList.toggle('is-unused', !n.used);
      if (!n.used) return;
      const k = i % lanes.length;
      const ext = alongD(n.hw * 2, n.hh * 2);
      let s = cursors[k] + ext / 2;
      // はじめの画面の文字とは重ねない。
      let guard = 0;
      while (hits(n, s, lanes[k]) && guard++ < 40) s += 40;
      n.off = lanes[k];
      n.s = s;
      cursors[k] = Math.max(cursors[k] + step, s + ext / 2 + pad);
    });

    target = clamp(target, 0, maxPos);
    pos = clamp(pos, 0, maxPos);
    drawn = -1;
  }

  const heroActive = () => pos < hold + span * 0.5;

  // 送る向きで水滴を切る。
  function cutHero(sign: number, strength: number) {
    const now = performance.now();
    if (now - lastCut < 230) return;
    lastCut = now;
    const m = clamp(0.045 + strength * 0.03, 0.045, 0.09);
    // HYDRA は横向きが強いスワイプだけをカットとして受け取る。
    if (Math.abs(dx) >= Math.abs(dy)) {
      post({ hdwSwipe: { dx: -sign * dx * m, dy: -sign * dy * m * (vw / Math.max(1, vh)) } });
    } else {
      post({ hdwSwipe: { dx: -sign * m, dy: 0 } });
    }
  }

  // ---- 掬う(最初の一太刀) ----
  // 水滴が弾け、飛沫がそれぞれの器の口へ飛ぶ。届いた器から満ちていく。
  function burst(silent = false) {
    if (burstAt) return;
    burstAt = performance.now();
    root.classList.add('is-burst');
    cue?.classList.add('is-gone');
    if (silent) {
      quiet = true;
      return;
    }
    post({ hdwBurst: { nx: dy, ny: dx } });
    locate();
    const cx = vw / 2 - dx * Math.max(0, pos - hold);
    const cy = vh / 2 - dy * Math.max(0, pos - hold);
    const reach = Math.hypot(vw, vh) / 2;
    for (const n of nodes) {
      if (!n.pour || !n.used || !n.onScreen) continue;
      const mx = n.x;
      const my = n.y - n.hh + 6; // 器の口
      const dist = Math.hypot(mx - cx, my - cy);
      const dur = 460 + (dist / reach) * 520;
      fly(beadBox, cx, cy, mx, my, dur, n.seed, nx, ny);
      pourAfter(n.pour, dur - 80, timers);
    }
  }

  // ---- 入力 ----
  function advance(amount: number) {
    if (!amount) return;
    target = clamp(target + amount, 0, maxPos);
    if (heroActive()) {
      cutAcc += Math.abs(amount);
      if (cutAcc > 70) {
        if (!burstAt) burst();
        else cutHero(amount > 0 ? 1 : -1, clamp(cutAcc / 400, 0, 1));
        cutAcc = 0;
      }
    }
  }

  function onWheel(e: WheelEvent) {
    if (e.ctrlKey) return; // 拡大の操作は奪わない
    e.preventDefault();
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? vh : 1;
    advance((e.deltaY + e.deltaX * dx) * unit);
  }

  let drag: { x: number; y: number; sx: number; sy: number; t: number; v: number; moved: boolean } | null =
    null;
  let suppressClick = 0;

  function onPointerDown(e: PointerEvent) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    drag = { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t: performance.now(), v: 0, moved: false };
  }

  function onPointerMove(e: PointerEvent) {
    if (!drag) return;
    const mx = e.clientX - drag.x;
    const my = e.clientY - drag.y;
    if (Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) > 6) drag.moved = true;
    if (!drag.moved) return;
    const amount = -(mx * dx + my);
    const now = performance.now();
    const dt = Math.max(1, now - drag.t);
    drag.v = drag.v * 0.6 + (amount / dt) * 0.4;
    drag.t = now;
    target = clamp(target + amount, 0, maxPos);
    if (heroActive()) {
      if (!burstAt && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) > 36) burst();
      else post({ hdwSwipe: { dx: mx / Math.max(1, vw), dy: my / Math.max(1, vh) } });
    }
    drag.x = e.clientX;
    drag.y = e.clientY;
  }

  function onPointerUp() {
    if (!drag) return;
    if (drag.moved) {
      target = clamp(target + drag.v * 260, 0, maxPos);
      suppressClick = performance.now();
    }
    drag = null;
  }

  function onClickCapture(e: MouseEvent) {
    if (performance.now() - suppressClick < 350) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if ((e.target as HTMLElement).closest('a, button')) return;
    if (heroActive()) {
      if (!burstAt) burst();
      else post({ hdwPoke: { x: e.clientX / Math.max(1, vw), y: e.clientY / Math.max(1, vh) } });
    }
  }

  // キーボード: 矢印で次/前の器へ。
  function stepTo(dir: 1 | -1) {
    const travel = Math.max(0, target - hold);
    const list = spine.filter((n) => n.kind !== 'hero').map((n) => n.s);
    if (dir > 0) {
      const next = list.find((s) => s > travel + 2);
      target = next === undefined ? maxPos : hold + next;
    } else {
      const prevs = list.filter((s) => s < travel - 2);
      target = prevs.length ? hold + prevs[prevs.length - 1] : 0;
    }
    if (heroActive()) {
      if (!burstAt) burst();
      else cutHero(dir, 0.6);
    }
  }

  function onKey(e: KeyboardEvent) {
    const t = e.target as HTMLElement;
    if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    switch (e.key) {
      case 'ArrowDown':
      case 'ArrowRight':
      case 'PageDown':
        e.preventDefault();
        stepTo(1);
        break;
      case 'ArrowUp':
      case 'ArrowLeft':
      case 'PageUp':
        e.preventDefault();
        stepTo(-1);
        break;
      case 'Home':
        e.preventDefault();
        target = 0;
        break;
      case 'End':
        e.preventDefault();
        target = maxPos;
        break;
    }
  }

  // Tab で器に入ったら、その器を中央へ。
  function onFocusIn(e: FocusEvent) {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-node]');
    const n = nodes.find((x) => x.el === el);
    if (n && n.kind !== 'hero') {
      if (!burstAt) burst(true);
      target = clamp(hold + n.s, 0, maxPos);
    }
  }

  function locate() {
    const travel = Math.max(0, pos - hold);
    const cx = vw / 2;
    const cy = vh / 2;
    for (const n of nodes) {
      const rel = n.s - travel;
      n.x = cx + dx * rel + nx * n.off;
      n.y = cy + dy * rel + ny * n.off;
      n.onScreen =
        n.used && n.x + n.hw > 0 && n.x - n.hw < vw && n.y + n.hh > 0 && n.y - n.hh < vh;
    }
    return travel;
  }

  function frame(now: number) {
    raf = requestAnimationFrame(frame);
    // 経過時間で追従させる(120Hz でも同じ速さ)。
    const dt = last ? Math.min(64, now - last) : 16;
    last = now;
    pos += (target - pos) * (1 - Math.exp(-dt / 140));
    if (Math.abs(target - pos) < 0.05) pos = target;
    if (pos === drawn) return; // 止まっているあいだは何も書かない
    const resting = pos === target;
    drawn = pos;

    const travel = locate();
    let focus: StageNode | undefined;
    let focusDist = Infinity;

    for (const n of nodes) {
      if (n.kind === 'hero' || !n.used) continue;
      const dist = Math.abs(n.s - travel);
      const far = !n.onScreen && dist > span * 0.8;
      if (far) {
        if (n.el.style.visibility !== 'hidden') n.el.style.visibility = 'hidden';
      } else {
        if (n.el.style.visibility !== 'visible') n.el.style.visibility = 'visible';
        if (n.pour) prime(n.pour); // 近づいた器の画像は先に読む
        const x = n.x - n.hw;
        const y = n.y - n.hh;
        // 止まっているときは整数の位置に置く(文字をにじませない)。
        n.el.style.transform = resting
          ? `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0)`
          : `translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, 0)`;
      }
      // 掬ったあとは、画面に入ってきた器から満ちる。
      if (n.pour && burstAt && n.onScreen && !n.pour.queued) {
        if (quiet) pourSet(n.pour);
        else pourAfter(n.pour, 120 + Math.abs(Math.sin(n.seed)) * 200, timers);
      }
      if (n.kind === 'work' && dist < focusDist) {
        focusDist = dist;
        focus = n;
      }
    }
    quiet = false;

    // 水滴は世界と一緒に左上へ流れる。画面の外に出たら描画を止める。
    if (hydra) {
      const gone = travel > span * 1.05;
      if (gone !== paused) {
        paused = gone;
        post({ hdwPause: gone });
        hydra.style.visibility = gone ? 'hidden' : 'visible';
      }
      if (!gone) {
        hydra.style.transform = `translate3d(${(-dx * travel).toFixed(1)}px, ${(-dy * travel).toFixed(1)}px, 0)`;
        const sp = Math.round(clamp(pos / Math.max(1, hold), 0, 1) * 100) / 100;
        if (sp !== lastScrollSent) {
          lastScrollSent = sp;
          post({ hdwScroll: 0.5 + sp * 0.5 });
        }
      }
    }

    for (const n of nodes) {
      if (n.kind !== 'hero') continue;
      const f = clamp(1 - pos / Math.max(1, hold * 0.8), 0, 1);
      n.el.style.opacity = f.toFixed(3);
      n.el.style.visibility = f <= 0 ? 'hidden' : 'visible';
    }

    // 現在地。「03 / 08 案件名」。URL にも残す。
    const inWorks = !!focus && focusDist < span * 0.45 && travel > span * 0.25;
    const idx = inWorks && focus ? works.indexOf(focus) + 1 : 0;
    if (idx !== focusIdx) {
      focusIdx = idx;
      if (counter) {
        counter.textContent = idx
          ? `${pad2(idx)} / ${pad2(works.length)}  ${focus!.el.dataset.title || ''}`
          : '';
      }
    }
    if (resting) writeHash(focusIdx);
    root.classList.toggle('in-works', travel > span * 0.25);
  }

  function onResize() {
    if (isSmall()) return; // スマホ用への切り替えは mountStage が行う
    measure();
    layout();
  }

  // ---- 起動 ----
  measure();
  layout();
  // #w=3 … 3番目の案件から、満ちた状態で始める(戻る・共有・再訪)。
  // #p=1800 … 確認用。位置を直接指定する。
  const w = Number(hash.get('w') || 0);
  if (w >= 1 && w <= works.length) {
    pos = target = clamp(hold + works[w - 1].s, 0, maxPos);
    burst(true);
  } else if (hash.has('p')) {
    pos = target = clamp(Number(hash.get('p')), 0, maxPos);
    if (pos > 0) burst(true);
  }
  hydra?.addEventListener('load', sendScale);
  [400, 1200, 2600].forEach((ms) => timers.push(window.setTimeout(sendScale, ms)));
  // 何もしない人にも見せる: しばらく待って、自動で掬う。
  timers.push(window.setTimeout(() => burst(), 6000));

  root.addEventListener('wheel', onWheel, { passive: false });
  root.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('pointercancel', onPointerUp);
  root.addEventListener('click', onClickCapture, true);
  root.addEventListener('focusin', onFocusIn);
  window.addEventListener('keydown', onKey);
  window.addEventListener('resize', onResize);
  // 書体や画像で器の大きさが変わったら並べ直す。
  const ro = new ResizeObserver(() => layout());
  works.forEach((n) => ro.observe(n.el));

  raf = requestAnimationFrame(frame);

  return () => {
    cancelAnimationFrame(raf);
    ro.disconnect();
    timers.forEach((t) => clearTimeout(t));
    hydra?.removeEventListener('load', sendScale);
    root.removeEventListener('wheel', onWheel);
    root.removeEventListener('pointerdown', onPointerDown);
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('pointercancel', onPointerUp);
    root.removeEventListener('click', onClickCapture, true);
    root.removeEventListener('focusin', onFocusIn);
    window.removeEventListener('keydown', onKey);
    window.removeEventListener('resize', onResize);
    beadBox?.replaceChildren();
    post({ hdwPause: false });
    for (const n of nodes) {
      n.el.style.transform = '';
      n.el.style.visibility = '';
      n.el.style.opacity = '';
      n.el.classList.remove('is-unused');
      if (n.pour) pourReset(n.pour);
    }
    if (hydra) {
      hydra.style.transform = '';
      hydra.style.visibility = '';
    }
    if (counter) counter.textContent = '';
    root.classList.remove('is-live', 'pour-on', 'is-burst', 'in-works');
    document.documentElement.classList.remove('stage-on');
  };
}

// ============================================================
// スマホ: 真縦。ブラウザ本来のスクロール。1画面に1案件。
//   水滴の下に、最初の器の口が覗いている。
//   送ると水滴が切れ、飛沫が下の器へ落ちる。
// ============================================================
function mountFlow(root: HTMLElement): () => void {
  const html = document.documentElement;
  const hydra = root.querySelector<HTMLIFrameElement>('[data-hydra]');
  const beadBox = root.querySelector<HTMLElement>('[data-beads]');
  const counter = root.querySelector<HTMLElement>('[data-counter]');
  const cue = root.querySelector<HTMLElement>('[data-cue]');
  const hero = root.querySelector<HTMLElement>('[data-node="hero"]');
  const workEls = Array.from(root.querySelectorAll<HTMLElement>('[data-node="work"]'));
  const pours = workEls.map(makePour);
  const timers: number[] = [];

  let burstAt = 0;
  let lastY = window.scrollY;
  let cutAcc = 0;
  let paused = false;
  let current = 0;

  root.classList.add('is-flow', 'pour-on');
  html.classList.add('flow-on');

  function post(msg: unknown) {
    hydra?.contentWindow?.postMessage(msg, '*');
  }
  // 水滴は画面幅の6〜7割に。
  const sendScale = () => post({ hdwScale: 2.9 });

  function burst(silent = false) {
    if (burstAt) return;
    burstAt = performance.now();
    root.classList.add('is-burst');
    cue?.classList.add('is-gone');
    if (silent) return;
    post({ hdwBurst: { nx: 1, ny: 0 } });
    // 飛沫は、下で待っている最初の器の口へ落ちる。
    const first = workEls[0]?.querySelector<HTMLElement>('.vessel');
    if (first && hero && pours[0]) {
      const box = root.getBoundingClientRect();
      const h = hero.getBoundingClientRect();
      const v = first.getBoundingClientRect();
      const x0 = h.left + h.width / 2 - box.left;
      const y0 = h.top + h.height / 2 - box.top;
      const y1 = v.top - box.top + 8;
      [-0.22, 0.05, 0.28].forEach((k, i) => {
        fly(beadBox, x0, y0, v.left + v.width * (0.5 + k) - box.left, y1, 620 + i * 110, i + 1.3, 1, 0);
      });
      pourAfter(pours[0], 560, timers);
    }
  }

  function onScroll() {
    const y = window.scrollY;
    const d = y - lastY;
    lastY = y;
    const vh = window.innerHeight;
    if (y < vh) {
      cutAcc += Math.abs(d);
      if (!burstAt && y > 12) burst();
      else if (cutAcc > 90) {
        cutAcc = 0;
        post({ hdwSwipe: { dx: (d > 0 ? -1 : 1) * 0.07, dy: 0 } });
      }
    }
    // 水滴が画面の外に出たら、描画を止める。
    const gone = y > vh * 1.02;
    if (gone !== paused) {
      paused = gone;
      post({ hdwPause: gone });
    }
    root.classList.toggle('in-works', y > vh * 0.45);
    if (y < vh * 0.3 && current) setCurrent(0);
  }

  function onClick(e: MouseEvent) {
    if ((e.target as HTMLElement).closest('a, button')) return;
    if (window.scrollY < window.innerHeight * 0.5) {
      if (!burstAt) burst();
      else post({ hdwPoke: { x: e.clientX / window.innerWidth, y: e.clientY / window.innerHeight } });
    }
  }

  function setCurrent(i: number) {
    current = i;
    if (counter) {
      counter.textContent = i
        ? `${pad2(i)} / ${pad2(workEls.length)}  ${workEls[i - 1].dataset.title || ''}`
        : '';
    }
    writeHash(i);
  }

  // 画面に入った器から満ちる。真ん中に来た器が「いまの案件」。
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        const i = workEls.indexOf(e.target as HTMLElement);
        if (i < 0) continue;
        if (e.isIntersecting && e.intersectionRatio >= 0.35) {
          if (!burstAt) burst(true);
          pourAfter(pours[i], 140, timers);
        }
        if (e.isIntersecting && e.intersectionRatio >= 0.7) setCurrent(i + 1);
      }
    },
    { threshold: [0.35, 0.7] }
  );

  // #w=3 … 3番目の案件から、満ちた状態で始める。
  const hash = new URLSearchParams(location.hash.replace(/^#/, ''));
  const w = Number(hash.get('w') || 0);
  if (w >= 1 && w <= workEls.length) {
    burst(true);
    for (let i = 0; i < w; i++) pourSet(pours[i]);
    html.classList.add('flow-jump');
    workEls[w - 1].scrollIntoView({ block: 'center' });
    timers.push(window.setTimeout(() => html.classList.remove('flow-jump'), 60));
  }
  workEls.forEach((el) => io.observe(el));
  if (pours[0]) prime(pours[0]);

  hydra?.addEventListener('load', sendScale);
  sendScale();
  [400, 1200, 2600].forEach((ms) => timers.push(window.setTimeout(sendScale, ms)));
  timers.push(window.setTimeout(() => burst(), 6000));
  window.addEventListener('scroll', onScroll, { passive: true });
  root.addEventListener('click', onClick);
  onScroll();

  return () => {
    io.disconnect();
    timers.forEach((t) => clearTimeout(t));
    hydra?.removeEventListener('load', sendScale);
    window.removeEventListener('scroll', onScroll);
    root.removeEventListener('click', onClick);
    beadBox?.replaceChildren();
    post({ hdwPause: false });
    pours.forEach(pourReset);
    if (counter) counter.textContent = '';
    root.classList.remove('is-flow', 'pour-on', 'is-burst', 'in-works');
    html.classList.remove('flow-on', 'flow-jump');
  };
}
