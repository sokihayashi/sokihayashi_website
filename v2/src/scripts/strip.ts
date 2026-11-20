// 試作: 連なり(Works の一覧)。
//
// 写真の面が、線を共有して縦に連なる。四角い部品は作品だけで、題名は文字と線。
//
//   sway … うねる。止まっているときはまっすぐ。スクロールすると、速さに応じて連なり全体がしなり、
//          止まるとまっすぐに戻る。写真は動かさず歪めず、面(窓)の形だけが曲がる。
//   drum … 巻く(3D)。連なりを、奥へ曲がる面に載せる。面は四角のまま、上下の端ほど奥へ倒れる。
//          遠近がつくので、写真は歪んで見える(比べるための版)。

export function mountStrip(root: HTMLElement): () => void {
  const mode = root.dataset.strip || 'sway';
  const rows = Array.from(root.querySelectorAll<HTMLElement>('[data-row]'));
  const faces = rows.map((r) => r.querySelector<HTMLElement>('[data-face]')!);
  let raf = 0;
  let last = 0;
  let lastY = window.scrollY;
  let vel = 0; // ならしたスクロールの速さ(px/秒)
  let amp = 0; // いまのしなりの大きさ(px)
  let ampV = 0;
  let tops: number[] = []; // 各行の、ページの上からの位置
  let rowH = 0;
  let m = 0; // 面の左右にとってある、しなりの余地(px)
  let sw = 0; // 面の幅(px)
  let listTop = 0;

  function measure() {
    const y = window.scrollY;
    tops = rows.map((r) => r.getBoundingClientRect().top + y);
    rowH = rows[0]?.offsetHeight || 0;
    const cs = getComputedStyle(root);
    m = parseFloat(cs.getPropertyValue('--m')) || 28;
    sw = faces[0] ? faces[0].offsetWidth - m * 2 : 0;
    listTop = root.getBoundingClientRect().top + y;
  }

  // ページの上からの位置 y での、連なりの横ずれ。
  const WAVE = 230; // 波の長さの目安(px。1周は約 1450px)
  const xAt = (y: number) => amp * Math.sin(y / WAVE);

  function sway() {
    const y0 = window.scrollY;
    const vh = window.innerHeight;
    const n = 6; // 面の左右の辺を、いくつに割って曲げるか
    for (let i = 0; i < rows.length; i++) {
      const top = tops[i];
      if (top + rowH < y0 - 40 || top > y0 + vh + 40) continue;
      const L: string[] = [];
      const R: string[] = [];
      for (let j = 0; j <= n; j++) {
        const t = j / n;
        const x = Math.abs(amp) < 0.05 ? 0 : xAt(top + rowH * t);
        L.push(`${(m + x).toFixed(1)}px ${(t * 100).toFixed(1)}%`);
        R.push(`${(m + sw + x).toFixed(1)}px ${(t * 100).toFixed(1)}%`);
      }
      faces[i].style.clipPath = `polygon(${L.join(',')},${R.reverse().join(',')})`;
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
    // しなりは、速さを少し遅れて追い、行きすぎてから戻る。
    const target = Math.max(-m, Math.min(m, vel * 0.03));
    ampV += ((target - amp) * 140 - ampV * 15) * dt;
    amp += ampV * dt;
    amp = Math.max(-m, Math.min(m, amp));
    if (Math.abs(amp) < 0.05 && Math.abs(ampV) < 0.5 && Math.abs(target) < 0.05) amp = 0;
    sway();
  }

  function onResize() {
    for (const r of rows) r.style.transform = '';
    measure();
  }

  root.classList.add('is-live');
  measure();
  window.addEventListener('resize', onResize);
  window.addEventListener('load', onResize);
  raf = requestAnimationFrame(frame);

  return () => {
    cancelAnimationFrame(raf);
    window.removeEventListener('resize', onResize);
    window.removeEventListener('load', onResize);
    root.classList.remove('is-live');
    root.style.perspectiveOrigin = '';
    for (const r of rows) r.style.transform = '';
    for (const f of faces) f.style.clipPath = '';
  };
}
