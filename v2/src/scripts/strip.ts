// 試作: 連なり(Works の一覧)。
//
// 写真の面が、線を共有して縦に連なる。四角い部品は作品だけで、題名は文字と線。
//
//   sway … うねる。止まっているときはまっすぐ。スクロールの速さが変わると、指のあたりから連なりがしなり、
//          そのしなりが上下へ遅れて伝わる(決まった波の形は持たない)。題名も線も一緒に動く。
//          面の切れ目は、連なりの向きに直交する(トップの帯と同じ切り方)。写真は動かさず歪めない。
//   drum … 巻く(3D)。連なりを、奥へ曲がる面に載せる。面は四角のまま、上下の端ほど奥へ倒れる。
//          遠近がつくので、写真は歪んで見える(比べるための版)。

export function mountStrip(root: HTMLElement): () => void {
  const mode = root.dataset.strip || 'sway';
  const rows = Array.from(root.querySelectorAll<HTMLElement>('[data-row]'));
  const faces = rows.map((r) => r.querySelector<HTMLElement>('[data-face]')!);
  const texts = rows.map((r) => r.querySelector<HTMLElement>('.strip-text'));
  let raf = 0;
  let last = 0;
  let lastY = window.scrollY;
  let vel = 0; // ならしたスクロールの速さ(px/秒)
  let amp = 0; // いまの横ずれ(px)。指のあたりでの値
  let ampV = 0;
  let tops: number[] = []; // 各行の、ページの上からの位置
  let rowH = 0;
  let m = 0; // 面の左右にとってある余地(px)
  let vm = 0; // 面の上下にとってある余地(px)
  let sw = 0; // 面の幅(px)
  let listTop = 0;
  let calmAt = 0; // 横ずれが収まった時刻(しなりが端まで伝わりきるのを待つため)
  let fingerY = -1; // 指の位置(画面の上から)。分からなければ画面のまんなか

  // 横ずれの記録。しなりは、指のあたりから上下へ遅れて伝わる。
  const N = 180;
  const hT = new Float64Array(N);
  const hA = new Float32Array(N);
  let hi = 0;
  const SPEED = 1100; // しなりが伝わる速さ(px/秒)
  function ampAt(delay: number, now: number) {
    const t = now - delay * 1000;
    // 新しいほうから探す。
    for (let k = 0; k < N - 1; k++) {
      const a = (hi - 1 - k + N * 2) % N;
      if (hT[a] <= t || hT[a] === 0) return hA[a];
    }
    return 0;
  }

  function measure() {
    const y = window.scrollY;
    tops = rows.map((r) => r.getBoundingClientRect().top + y);
    rowH = rows[0]?.offsetHeight || 0;
    const cs = getComputedStyle(root);
    m = parseFloat(cs.getPropertyValue('--m')) || 28;
    vm = parseFloat(cs.getPropertyValue('--vm')) || 24;
    sw = faces[0] ? faces[0].offsetWidth - m * 2 : 0;
    listTop = root.getBoundingClientRect().top + y;
  }

  function sway(now: number) {
    const y0 = window.scrollY;
    const vh = window.innerHeight;
    const origin = y0 + (fingerY >= 0 ? fingerY : vh / 2);
    // ページの上からの位置 y での横ずれ。
    const xAt = (y: number) => {
      const d = Math.abs(y - origin);
      return ampAt(d / SPEED, now) * Math.exp(-d / 2400);
    };
    if (Math.abs(amp) >= 0.05 || Math.abs(ampV) >= 0.5) calmAt = now;
    const flat = now - calmAt > 1200;
    const n = 14; // 面の左右の辺を、いくつに割って曲げるか
    const maxTilt = (vm - 2) / (sw / 2); // 切れ目が余地からはみ出さない傾き
    for (let i = 0; i < rows.length; i++) {
      const top = tops[i];
      if (top + rowH < y0 - 60 || top > y0 + vh + 60) continue;
      const L: string[] = [];
      const R: string[] = [];
      let x0 = 0;
      for (let j = 0; j <= n; j++) {
        const y = top + (rowH * j) / n;
        const x = flat ? 0 : xAt(y);
        if (j === 0) x0 = x;
        // 連なりの向き(傾き)。切れ目と辺は、これに直交させる。
        let sl = flat ? 0 : (xAt(y + 8) - xAt(y - 8)) / 16;
        sl = Math.max(-maxTilt, Math.min(maxTilt, sl));
        const k = 1 / Math.hypot(1, sl);
        const hw = (sw / 2) * k;
        const cx = m + sw / 2 + x;
        // 面と面のあいだに、黒い線1本ぶんを空ける。
        const cy = vm + (rowH * j) / n + (j === 0 ? 1 : j === n ? -1 : 0);
        L.push(`${(cx - hw).toFixed(1)}px ${(cy + sl * hw).toFixed(1)}px`);
        R.push(`${(cx + hw).toFixed(1)}px ${(cy - sl * hw).toFixed(1)}px`);
      }
      faces[i].style.clipPath = `polygon(${L.join(',')},${R.reverse().join(',')})`;
      // 題名と区切りの線も、連なりと一緒に動く。
      const tx = texts[i];
      if (tx) tx.style.transform = flat ? '' : `translate3d(${x0.toFixed(1)}px,0,0)`;
    }
  }

  function drum() {
    const y0 = window.scrollY;
    const vh = window.innerHeight;
    const vc = y0 + vh / 2;
    const R = vh * 0.95; // 巻いている面の半径
    // 視点は、連なりの幅のまんなかに置く(面が左右に傾いて見えないように)。
    const cx = faces[0] ? faces[0].offsetLeft + m + sw / 2 : 0;
    root.style.perspectiveOrigin = `${cx.toFixed(0)}px ${(vc - listTop).toFixed(0)}px`;
    for (let i = 0; i < rows.length; i++) {
      const top = tops[i];
      if (top + rowH < y0 - vh * 0.4 || top > y0 + vh * 1.4) {
        rows[i].style.transform = '';
        continue;
      }
      const d = top + rowH / 2 - vc;
      const a = Math.max(-1.25, Math.min(1.25, d / R));
      const dy = R * Math.sin(a) - d; // 巻いた面の上での位置へ寄せる(行のすき間をふさぐ)
      const dz = -R * (1 - Math.cos(a));
      rows[i].style.transform = `translate3d(0, ${dy.toFixed(1)}px, ${dz.toFixed(1)}px) rotateX(${(-a).toFixed(4)}rad)`;
    }
  }

  function frame(now: number) {
    raf = requestAnimationFrame(frame);
    const dt = last ? Math.min(0.05, (now - last) / 1000) : 0.016;
    last = now;
    const y = window.scrollY;
    const v = (y - lastY) / dt;
    lastY = y;
    vel += (v - vel) * (1 - Math.exp(-dt / 0.1));
    if (mode === 'drum') {
      drum();
      return;
    }
    // 横ずれは、速さを少し遅れて追い、行きすぎてから戻る。
    const target = Math.max(-m, Math.min(m, vel * 0.03));
    ampV += ((target - amp) * 140 - ampV * 15) * dt;
    amp += ampV * dt;
    amp = Math.max(-m, Math.min(m, amp));
    if (Math.abs(amp) < 0.05 && Math.abs(ampV) < 0.5 && Math.abs(target) < 0.05) amp = 0;
    hT[hi] = now;
    hA[hi] = amp;
    hi = (hi + 1) % N;
    sway(now);
  }

  function onResize() {
    for (const r of rows) r.style.transform = '';
    measure();
  }
  function onTouch(e: TouchEvent) {
    const t = e.touches[0];
    if (t) fingerY = t.clientY;
  }
  function onPointer(e: PointerEvent) {
    if (e.pointerType === 'mouse') fingerY = e.clientY;
  }

  root.classList.add('is-live');
  measure();
  window.addEventListener('resize', onResize);
  window.addEventListener('load', onResize);
  window.addEventListener('touchstart', onTouch, { passive: true });
  window.addEventListener('touchmove', onTouch, { passive: true });
  window.addEventListener('pointermove', onPointer, { passive: true });
  raf = requestAnimationFrame(frame);

  return () => {
    cancelAnimationFrame(raf);
    window.removeEventListener('resize', onResize);
    window.removeEventListener('load', onResize);
    window.removeEventListener('touchstart', onTouch);
    window.removeEventListener('touchmove', onTouch);
    window.removeEventListener('pointermove', onPointer);
    root.classList.remove('is-live');
    root.style.perspectiveOrigin = '';
    for (const r of rows) r.style.transform = '';
    for (const f of faces) f.style.clipPath = '';
    for (const t of texts) if (t) t.style.transform = '';
  };
}
