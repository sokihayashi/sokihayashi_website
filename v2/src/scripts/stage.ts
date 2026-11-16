// 斜めスクロールのステージ。
//
// 考え方:
//   ・ページはブラウザのスクロールを使わず、1本の軸(斜め)に沿って「世界」を動かす。
//   ・スクロール=スワイプ=「切る」。ヒーロー(HYDRA)には、その向きのカットを送る。
//   ・文字は常に水平。動くのは位置だけ。
//
// 軸の向き d = (cos a, sin a)。a は水平からの角度(度)。
//   a = 90 … 縦(ふつうのスクロール)
//   a = 28 … 斜め(既定)
//   a = 0  … 横
// 進む方向にスクロールすると、中身は左上へ流れ、次の中身が右下から入ってくる。

import { createField, type FieldEnv } from './field';
import { createLiquid } from './liquid';

type Kind = 'hero' | 'text' | 'work' | 'end';

interface StageNode {
  el: HTMLElement;
  kind: Kind;
  s: number; // 軸上の現在位置(px)
  sTarget: number; // 軸上の目標位置(px)
  off: number; // 軸に直交する方向のずらし(px)
  hw: number; // 幅の半分(px)
  hh: number; // 高さの半分(px)
  shown: boolean; // タグ絞り込みで残っているか
  domain: string[];
  stance: string;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function mountStage(root: HTMLElement): () => void {
  const hydra = root.querySelector<HTMLIFrameElement>('[data-hydra]');
  const fx = root.querySelector<HTMLCanvasElement>('[data-fx]');
  const counter = root.querySelector<HTMLElement>('[data-counter]');
  const cue = root.querySelector<HTMLElement>('[data-cue]');
  const fieldBox = root.querySelector<HTMLElement>('[data-field]');
  const fine = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  const liquid = fx ? createLiquid(fx, fine) : null;
  const field = fieldBox ? createField(fieldBox) : null;
  root.classList.toggle('has-liquid-cursor', fine && !!liquid);

  const nodes: StageNode[] = Array.from(root.querySelectorAll<HTMLElement>('[data-node]')).map(
    (el) => ({
      el,
      kind: (el.dataset.node as Kind) || 'text',
      s: 0,
      sTarget: 0,
      off: 0,
      hw: 0,
      hh: 0,
      shown: true,
      domain: (el.dataset.domain || '').split(' ').filter(Boolean),
      stance: el.dataset.stance || '',
    })
  );
  const works = nodes.filter((n) => n.kind === 'work');

  // ---- 状態 ----
  let angle = Number(root.dataset.angle || 28);
  let dx = 1;
  let dy = 0; // 軸 d
  let nx = 0;
  let ny = 1; // 法線 n
  let vw = 0;
  let vh = 0;
  let span = 0; // 画面を軸方向に測った長さ
  let hold = 0; // ヒーローを留めておくスクロール量
  let maxPos = 0;
  let pos = 0;
  let target = 0;
  let raf = 0;
  let filterDomain = 'all';
  let filterStance = 'all';
  let lastCut = 0;
  let cutAcc = 0;
  let lastScrollSent = -1;
  let first = true;
  const pointer = { x: 0, y: 0, has: false, hot: false };
  let burstDone = false;

  root.classList.add('is-live');
  document.documentElement.classList.add('stage-on');

  // ---- 配置 ----
  function measure() {
    vw = root.clientWidth;
    vh = root.clientHeight;
    const a = (angle * Math.PI) / 180;
    dx = Math.cos(a);
    dy = Math.sin(a);
    nx = -dy;
    ny = dx;
    span = Math.abs(vw * dx) + Math.abs(vh * dy);
    hold = Math.round(clamp(Math.min(vw, vh) * 0.7, 320, 620));
    root.style.setProperty('--dx', dx.toFixed(4));
    root.style.setProperty('--dy', dy.toFixed(4));
    root.style.setProperty('--nx', nx.toFixed(4));
    root.style.setProperty('--ny', ny.toFixed(4));
    root.style.setProperty('--angle', `${angle}deg`);

    liquid?.resize(vw, vh);
    field?.resize(vw, vh);
  }

  function env(): FieldEnv {
    return {
      vw,
      vh,
      dx,
      dy,
      nx,
      ny,
      travel: Math.max(0, pos - hold),
      span,
      hero: clamp(1 - Math.max(0, pos - hold) / (span * 0.5), 0, 1),
      px: pointer.x,
      py: pointer.y,
      hasPointer: pointer.has && fine,
    };
  }

  // カード同士が重ならない最小の間隔を、角度から求める。
  function workGap(): number {
    const sample = works[0]?.el;
    const w = sample ? sample.offsetWidth : 320;
    const h = sample ? sample.offsetHeight : 380;
    const pad = clamp(Math.min(vw, vh) * 0.06, 28, 72);
    const byX = Math.abs(dx) > 0.05 ? (w + pad) / Math.abs(dx) : Infinity;
    const byY = Math.abs(dy) > 0.05 ? (h + pad) / Math.abs(dy) : Infinity;
    return Math.min(byX, byY);
  }

  function layout(immediate: boolean) {
    const gap = workGap();
    // 斜めのときだけ、軸の左右に少し振ってリズムを作る。
    const sway = Math.abs(dx) > 0.2 && Math.abs(dy) > 0.2 ? clamp(Math.min(vw, vh) * 0.05, 14, 46) : 0;
    let cursor = 0;
    let i = 0;
    let prev: Kind = 'hero';
    for (const n of nodes) {
      n.hw = n.el.offsetWidth / 2;
      n.hh = n.el.offsetHeight / 2;
      if (n.kind === 'hero') {
        n.sTarget = 0;
        n.off = 0;
      } else if (n.kind === 'text') {
        cursor += span * 0.72;
        n.sTarget = cursor;
        n.off = 0;
        prev = 'text';
      } else if (n.kind === 'work') {
        if (!n.shown) continue;
        cursor += prev === 'work' ? gap : span * 0.62;
        n.sTarget = cursor;
        n.off = i % 2 === 0 ? -sway : sway;
        i++;
        prev = 'work';
      } else {
        cursor += span * 0.66;
        n.sTarget = cursor;
        n.off = 0;
      }
      if (immediate) n.s = n.sTarget;
    }
    maxPos = hold + cursor;
    target = clamp(target, 0, maxPos);
    if (immediate) pos = clamp(pos, 0, maxPos);
    setHalves();
  }

  // カードを軸の向きで2つに割るための切り抜き(clip-path)を用意する。
  function setHalves() {
    const L = 4000;
    for (const n of works) {
      const box = n.el.querySelector<HTMLElement>('[data-halves]');
      if (!box) continue;
      const w = box.offsetWidth;
      const h = box.offsetHeight;
      const cx = w / 2;
      const cy = h / 2;
      const poly = (sign: number) => {
        // 継ぎ目に隙間が出ないよう、0.5px だけ重ねる。
        const ox = cx - nx * sign * 0.5;
        const oy = cy - ny * sign * 0.5;
        const p = [
          [ox - dx * L, oy - dy * L],
          [ox + dx * L, oy + dy * L],
          [ox + dx * L + nx * sign * L, oy + dy * L + ny * sign * L],
          [ox - dx * L + nx * sign * L, oy - dy * L + ny * sign * L],
        ];
        return p.map(([x, y]) => `${x.toFixed(1)}px ${y.toFixed(1)}px`).join(', ');
      };
      box.style.setProperty('--poly-a', poly(1));
      box.style.setProperty('--poly-b', poly(-1));
    }
  }

  // ---- HYDRA(ヒーロー)への橋渡し ----
  const post = (msg: unknown) => hydra?.contentWindow?.postMessage(msg, '*');

  function heroActive() {
    return pos < hold + span * 0.5;
  }

  // スクロールの向きでヒーローを切る。
  function cutHero(sign: number, strength: number) {
    const now = performance.now();
    if (now - lastCut < 230) return;
    lastCut = now;
    const m = clamp(0.045 + strength * 0.03, 0.045, 0.09);
    // HYDRA は横向きが強いスワイプだけをカットとして受け取る。
    // 画面の縦横比で向きが変わらないよう、ピクセルの比に直して送る。
    if (Math.abs(dx) >= Math.abs(dy)) {
      post({ hdwSwipe: { dx: -sign * dx * m, dy: -sign * dy * m * (vw / Math.max(1, vh)) } });
    } else {
      post({ hdwSwipe: { dx: -sign * m, dy: 0 } });
    }
  }

  // ---- 液体の切り跡 ----
  // 入力のあった場所から、軸の向きに水滴を飛ばす。
  function spray(x: number, y: number, amount: number) {
    if (!liquid) return;
    const sgn = amount > 0 ? -1 : 1;
    const power = clamp(Math.abs(amount) / 60, 0.4, 3.2);
    const n = Math.round(clamp(power * 2, 1, 6));
    for (let i = 0; i < n; i++) {
      const sp = (4 + Math.random() * 9) * power;
      const side = (Math.random() - 0.5) * 2.4;
      liquid.bead(
        x + nx * side * 4,
        y + ny * side * 4,
        dx * sgn * sp + nx * side,
        dy * sgn * sp + ny * side,
        5 + Math.random() * 6 * Math.min(power, 2),
        0.9 + Math.random() * 0.05
      );
    }
  }

  // 画面全体を一太刀で横切る線(最初のカットと、タグ切り替えのとき)。
  function slash() {
    liquid?.slash(vw / 2, vh / 2, dx, dy, Math.hypot(vw, vh) * 1.05);
  }

  // 最初の一太刀。ヒーローが弾け、作品が飛沫として画面に散る。
  function burst() {
    if (burstDone) return;
    burstDone = true;
    root.classList.add('is-burst');
    post({ hdwBurst: { nx: dy, ny: dx } });
    slash();
    field?.burst(performance.now(), env());
  }

  // ---- 入力 ----
  function advance(amount: number, px?: number, py?: number) {
    if (!amount) return;
    target = clamp(target + amount, 0, maxPos);
    if (cue && target > 12) cue.classList.add('is-gone');

    // 入力のあった位置から、軸の向きに水滴を飛ばす。
    const ox = px ?? (pointer.has ? pointer.x : vw / 2);
    const oy = py ?? (pointer.has ? pointer.y : vh / 2);
    spray(ox, oy, amount);
    field?.kick(amount, env());

    if (heroActive()) {
      cutAcc += Math.abs(amount);
      if (cutAcc > 70) {
        if (!burstDone) burst();
        else cutHero(amount > 0 ? 1 : -1, clamp(cutAcc / 400, 0, 1));
        cutAcc = 0;
      }
    }
  }

  function onWheel(e: WheelEvent) {
    e.preventDefault();
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? vh : 1;
    // 縦ホイールはそのまま進む量に。横成分は軸の横向きぶんだけ足す。
    advance((e.deltaY + e.deltaX * dx) * unit, e.clientX, e.clientY);
  }

  let drag: { x: number; y: number; sx: number; sy: number; t: number; v: number; moved: boolean } | null =
    null;

  function onPointerDown(e: PointerEvent) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const el = e.target as HTMLElement;
    if (el.closest('[data-stage-ui]')) return;
    drag = { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t: performance.now(), v: 0, moved: false };
  }

  function onPointerMove(e: PointerEvent) {
    pointer.x = e.clientX;
    pointer.y = e.clientY;
    pointer.has = true;
    pointer.hot = !!(e.target as HTMLElement | null)?.closest?.('a, button');
    if (e.pointerType === 'mouse') liquid?.pointer(e.clientX, e.clientY, pointer.hot);
    if (!drag) return;
    const mx = e.clientX - drag.x;
    const my = e.clientY - drag.y;
    if (Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) > 6) drag.moved = true;
    if (!drag.moved) return;
    // 指の動きを軸に写す。縦に動かしても必ず進むようにしてある。
    const amount = -(mx * dx + my);
    const now = performance.now();
    const dt = Math.max(1, now - drag.t);
    drag.v = drag.v * 0.6 + (amount / dt) * 0.4;
    drag.t = now;

    target = clamp(target + amount, 0, maxPos);
    if (cue && target > 12) cue.classList.add('is-gone');
    // 指の通ったところに水の筋を残す。
    const steps = Math.max(1, Math.round(Math.hypot(mx, my) / 9));
    for (let i = 0; i < steps; i++) {
      const t = i / steps;
      liquid?.bead(drag.x + mx * t, drag.y + my * t, mx * 0.06, my * 0.06, 7 + Math.random() * 5, 0.9);
    }
    field?.kick(amount, env());
    if (heroActive()) {
      if (!burstDone && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) > 40) burst();
      // ヒーローには実際のドラッグの向きを送る(横向きが強ければカットになる)。
      else post({ hdwSwipe: { dx: mx / Math.max(1, vw), dy: my / Math.max(1, vh) } });
    }
    drag.x = e.clientX;
    drag.y = e.clientY;
  }

  function onPointerUp() {
    if (!drag) return;
    if (drag.moved) {
      // 指を離したあとの余韻。
      target = clamp(target + drag.v * 260, 0, maxPos);
      suppressClick = performance.now();
    }
    drag = null;
  }

  let suppressClick = 0;
  function onClickCapture(e: MouseEvent) {
    // ドラッグ直後のクリック(リンクの誤作動)を止める。
    if (performance.now() - suppressClick < 350) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    const el = e.target as HTMLElement;
    if (el.closest('a, button, [data-stage-ui]')) return;
    // 何もない場所のタップは、ヒーローを弾く。
    if (heroActive()) post({ hdwPoke: { x: e.clientX / Math.max(1, vw), y: e.clientY / Math.max(1, vh) } });
  }

  // キーボード: 矢印で次/前の要素へ。
  function stepTo(dir: 1 | -1) {
    const travel = Math.max(0, target - hold);
    const list = nodes.filter((n) => n.kind !== 'work' || n.shown).map((n) => n.sTarget);
    if (dir > 0) {
      const next = list.find((s) => s > travel + 2);
      target = next === undefined ? maxPos : hold + next;
    } else {
      const prevs = list.filter((s) => s < travel - 2);
      target = prevs.length ? hold + prevs[prevs.length - 1] : 0;
    }
    if (cue) cue.classList.add('is-gone');
    slashLocal(dir);
  }
  function slashLocal(dir: number) {
    liquid?.slash(vw / 2, vh / 2, dx, dy, Math.min(vw, vh) * 0.7);
    field?.kick(dir * 120, env());
    if (heroActive()) {
      if (!burstDone) burst();
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

  // Tab でカードに入ったら、そのカードを中央へ。
  function onFocusIn(e: FocusEvent) {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-node]');
    const n = nodes.find((x) => x.el === el);
    if (n && n.kind !== 'hero') target = clamp(hold + n.sTarget, 0, maxPos);
  }

  // ---- タグの絞り込み ----
  function applyFilter() {
    const before = works.filter((n) => n.shown).length;
    for (const n of works) {
      const okD = filterDomain === 'all' || n.domain.includes(filterDomain);
      const okS = filterStance === 'all' || n.stance === filterStance;
      n.shown = okD && okS;
      n.el.classList.toggle('is-cut', !n.shown);
      n.el.toggleAttribute('inert', !n.shown);
    }
    const after = works.filter((n) => n.shown).length;
    root.classList.toggle('is-empty', after === 0);
    slash();
    layout(false);
    // いまの位置が列の外に出ないよう、先頭の作品へ寄せる。
    const firstShown = works.find((n) => n.shown);
    if (firstShown && (before !== after || target > maxPos)) {
      target = clamp(hold + firstShown.sTarget, 0, maxPos);
    }
  }

  function onUiClick(e: MouseEvent) {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('button');
    if (!btn) return;
    if (btn.dataset.filterDomain !== undefined) {
      filterDomain = btn.dataset.filterDomain;
      syncPressed('[data-filter-domain]', (b) => b.dataset.filterDomain === filterDomain);
      applyFilter();
    } else if (btn.dataset.filterStance !== undefined) {
      filterStance = btn.dataset.filterStance;
      syncPressed('[data-filter-stance]', (b) => b.dataset.filterStance === filterStance);
      applyFilter();
    } else if (btn.dataset.setAngle !== undefined) {
      setAngle(Number(btn.dataset.setAngle));
    }
  }

  function syncPressed(sel: string, on: (b: HTMLButtonElement) => boolean) {
    root.querySelectorAll<HTMLButtonElement>(sel).forEach((b) => {
      b.setAttribute('aria-pressed', on(b) ? 'true' : 'false');
    });
    placeBlobs();
  }

  // 選択中のボタンの下に、白い水のかたまりを流し込む。
  // 先頭と尾を別の速さで動かし、フィルターでつなぐので、移動のあいだ水が伸びる。
  function placeBlobs() {
    root.querySelectorAll<HTMLElement>('[data-chips]').forEach((group) => {
      const goo = group.querySelector<HTMLElement>('[data-goo]');
      const on = group.querySelector<HTMLElement>('button[aria-pressed="true"]');
      if (!goo || !on) return;
      const pad = 10; // goo レイヤーのはみ出し分
      goo.querySelectorAll<HTMLElement>('i').forEach((b) => {
        b.style.transform = `translate3d(${on.offsetLeft + pad}px, ${on.offsetTop + pad}px, 0)`;
        b.style.width = `${on.offsetWidth}px`;
        b.style.height = `${on.offsetHeight}px`;
      });
    });
  }

  function setAngle(a: number) {
    // 角度を変えても、同じ作品を見続けられるようにする。
    const travel = Math.max(0, pos - hold);
    let anchor: StageNode | undefined;
    let best = Infinity;
    for (const n of nodes) {
      if (n.kind === 'work' && !n.shown) continue;
      const dist = Math.abs(n.s - travel);
      if (dist < best) {
        best = dist;
        anchor = n;
      }
    }
    const wasHero = pos < hold;
    angle = a;
    measure();
    layout(true);
    if (!wasHero && anchor) {
      pos = target = clamp(hold + anchor.s, 0, maxPos);
    } else {
      pos = target = clamp(pos, 0, maxPos);
    }
    syncPressed('[data-set-angle]', (b) => Number(b.dataset.setAngle) === angle);
    slash();
  }

  // ---- 毎フレーム ----
  function frame(now: number) {
    raf = requestAnimationFrame(frame);
    pos += (target - pos) * (first ? 1 : 0.11);
    first = false;
    if (Math.abs(target - pos) < 0.05) pos = target;
    const travel = Math.max(0, pos - hold);
    const cx = vw / 2;
    const cy = vh / 2;
    let resting = pos === target;

    let focus: StageNode | undefined;
    let focusDist = Infinity;

    for (const n of nodes) {
      n.s += (n.sTarget - n.s) * 0.14;
      if (Math.abs(n.sTarget - n.s) < 0.05) n.s = n.sTarget;
      else resting = false;
    }

    for (const n of nodes) {
      const rel = n.s - travel;
      const dist = Math.abs(rel);

      if (n.kind === 'hero') continue;

      const far = dist > span * 1.15;
      if (far && n.el.style.visibility !== 'hidden') n.el.style.visibility = 'hidden';
      if (far) continue;
      if (n.el.style.visibility !== 'visible') n.el.style.visibility = 'visible';

      const x = cx + dx * rel + nx * n.off - n.hw;
      const y = cy + dy * rel + ny * n.off - n.hh;
      // 止まっているときは整数の位置に置く(文字と継ぎ目をにじませない)。
      n.el.style.transform = resting
        ? `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0)`
        : `translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, 0)`;
      const f = clamp(1 - dist / (span * 0.62), 0, 1);
      n.el.style.setProperty('--f', f.toFixed(3));

      if (n.kind === 'work' && n.shown && dist < focusDist) {
        focusDist = dist;
        focus = n;
      }
    }

    // ヒーローは世界と一緒に左上へ流れ、離れたら止める。
    if (hydra) {
      const gone = travel > span * 1.1;
      if (gone) {
        if (hydra.style.visibility !== 'hidden') hydra.style.visibility = 'hidden';
      } else {
        if (hydra.style.visibility !== 'visible') hydra.style.visibility = 'visible';
        hydra.style.transform = `translate3d(${(-dx * travel).toFixed(1)}px, ${(-dy * travel).toFixed(1)}px, 0)`;
        hydra.style.opacity = clamp(1 - travel / (span * 0.9), 0, 1).toFixed(3);
      }
      // スクロール量をロゴの傾きとして渡す。
      const sp = Math.round(clamp(pos / Math.max(1, hold), 0, 1) * 100) / 100;
      if (!gone && sp !== lastScrollSent) {
        lastScrollSent = sp;
        post({ hdwScroll: 0.5 + sp * 0.5 });
      }
    }

    for (const n of nodes) {
      if (n.kind !== 'hero') continue;
      const f = clamp(1 - pos / Math.max(1, hold * 0.8), 0, 1);
      n.el.style.opacity = f.toFixed(3);
      n.el.style.visibility = f <= 0 ? 'hidden' : 'visible';
    }

    if (counter) {
      const shown = works.filter((n) => n.shown);
      const idx = focus ? shown.indexOf(focus) + 1 : 0;
      const inWorks = focus && focusDist < span * 0.6;
      const text = inWorks
        ? `${String(idx).padStart(2, '0')} / ${String(shown.length).padStart(2, '0')}`
        : '';
      if (counter.textContent !== text) counter.textContent = text;
    }
    root.classList.toggle('in-works', travel > span * 0.9);

    field?.frame(now, env());
    liquid?.frame();
  }

  // ---- 起動 ----
  function onResize() {
    measure();
    layout(true);
    placeBlobs();
  }

  function onLeave() {
    pointer.has = false;
    liquid?.leave();
  }

  // 確認用: #a=40&p=1800&f=branding&s=client で、角度・位置・絞り込みを指定して開ける。
  const hash = new URLSearchParams(location.hash.replace(/^#/, ''));
  if (hash.has('a')) angle = clamp(Number(hash.get('a')), 0, 90);

  measure();
  layout(true);
  if (hash.has('p')) pos = target = clamp(Number(hash.get('p')), 0, maxPos);
  if (hash.has('b') || (hash.has('p') && pos > 0)) burst();
  if (hash.has('p') && cue) cue.classList.add('is-gone');
  syncPressed('[data-set-angle]', (b) => Number(b.dataset.setAngle) === angle);
  if (hash.has('f') || hash.has('s')) {
    filterDomain = hash.get('f') || 'all';
    filterStance = hash.get('s') || 'all';
    syncPressed('[data-filter-domain]', (b) => b.dataset.filterDomain === filterDomain);
    syncPressed('[data-filter-stance]', (b) => b.dataset.filterStance === filterStance);
    applyFilter();
    if (hash.has('p')) target = clamp(Number(hash.get('p')), 0, maxPos);
  }

  const ui = root.querySelector<HTMLElement>('[data-stage-ui]');
  root.addEventListener('wheel', onWheel, { passive: false });
  root.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('pointercancel', onPointerUp);
  document.documentElement.addEventListener('pointerleave', onLeave);
  root.addEventListener('click', onClickCapture, true);
  root.addEventListener('focusin', onFocusIn);
  ui?.addEventListener('click', onUiClick);
  window.addEventListener('keydown', onKey);
  window.addEventListener('resize', onResize);
  // 画像やフォントでカードの大きさが変わったら並べ直す。
  const ro = new ResizeObserver(() => layout(false));
  if (works[0]) ro.observe(works[0].el);

  raf = requestAnimationFrame(frame);

  return () => {
    cancelAnimationFrame(raf);
    ro.disconnect();
    root.removeEventListener('wheel', onWheel);
    root.removeEventListener('pointerdown', onPointerDown);
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('pointercancel', onPointerUp);
    document.documentElement.removeEventListener('pointerleave', onLeave);
    root.removeEventListener('click', onClickCapture, true);
    root.removeEventListener('focusin', onFocusIn);
    ui?.removeEventListener('click', onUiClick);
    window.removeEventListener('keydown', onKey);
    window.removeEventListener('resize', onResize);
    root.classList.remove('is-live', 'is-burst', 'has-liquid-cursor');
    document.documentElement.classList.remove('stage-on');
  };
}
