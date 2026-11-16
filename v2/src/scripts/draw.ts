// 描く。
//
// 指(またはドラッグ)でなぞると、その軌跡が太い帯になり、帯の中に作品が順に現れる。
// 紙は「画面の長辺から28°」の向きにゆっくり流れ続けるので、描いた帯は斜めに流れて画面から出ていく。
// 帯の中の作品を押すと、その作品のページへ行く。
//
// スマホを基準にしている: 指で描くだけ。送る操作はない。
// 誰も触っていないあいだは、ペンがひとりでに描いて、何が起きる場所かを見せる。
// 写真は帯の形に裁つが、歪めない・透かさない。

import { navigate } from 'astro:transitions/client';

type Pt = { x: number; y: number };

interface Seg {
  pts: Pt[]; // 紙の上の座標
  len: number;
  work: number;
  pat: CanvasPattern | null;
  open: boolean; // まだ描いている途中
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

const ANGLE = 28; // 画面の長辺からの角度(度)

export function mountDraw(root: HTMLElement): () => void {
  const canvas = root.querySelector<HTMLCanvasElement>('[data-canvas]')!;
  const ctx = canvas.getContext('2d')!;
  const label = root.querySelector<HTMLElement>('[data-label]');
  const works = Array.from(root.querySelectorAll<HTMLAnchorElement>('[data-work]')).map((a) => {
    const img = new Image();
    img.decoding = 'async';
    img.src = a.dataset.src || '';
    return { title: a.textContent?.trim() || '', href: a.href, img };
  });
  const html = document.documentElement;
  const idleLabel = label?.textContent || '';

  let w = 0;
  let h = 0;
  let dpr = 1;
  let W = 120; // 帯の太さ
  let L = 180; // 作品1つぶんの長さ
  let dx = 0;
  let dy = -1;
  let offX = 0; // 紙のずれ(画面 = 紙 + ずれ)
  let offY = 0;
  let base = 36; // 紙の流れる速さ(px/秒)
  let boost = 0;
  let segs: Seg[] = [];
  let cur: Seg | null = null;
  let nextWork = 0;
  let raf = 0;
  let last = 0;
  let pointerDown = false;
  let moved = false;
  let downAt: Pt = { x: 0, y: 0 };
  let lastUser = -1e9;

  root.classList.add('is-live');
  html.classList.add('draw-on');

  function measure() {
    w = root.clientWidth;
    h = root.clientHeight;
    dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    const small = Math.min(w, h) < 640;
    W = small ? Math.round(Math.min(w, h) * 0.26) : 164;
    L = Math.round(W * 1.5);
    base = small ? 40 : 62;
    const a = (ANGLE * Math.PI) / 180;
    // 長辺から28°。縦長なら縦から、横長なら横から測る。紙は左上へ流れる。
    if (h > w) {
      dx = -Math.sin(a);
      dy = -Math.cos(a);
    } else {
      dx = -Math.cos(a);
      dy = -Math.sin(a);
    }
  }

  // ---- ペン ----
  function newSeg(p: Pt): Seg {
    const s: Seg = {
      pts: [p],
      len: 0,
      work: nextWork,
      pat: null,
      open: true,
      x0: p.x,
      y0: p.y,
      x1: p.x,
      y1: p.y,
    };
    nextWork = (nextWork + 1) % works.length;
    segs.push(s);
    if (segs.length > 90) segs.shift();
    return s;
  }

  // 帯の中の写真の置き場所を決める。歪めず、正立のまま、帯のまわりを覆う大きさで置く。
  function lock(s: Seg) {
    const img = works[s.work].img;
    if (!img.complete || !img.naturalWidth) return;
    const a = s.pts[0];
    const b = s.pts[s.pts.length - 1];
    const l = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const cx = a.x + ((b.x - a.x) / l) * (L / 2);
    const cy = a.y + ((b.y - a.y) / l) * (L / 2);
    const side = L + W;
    const k = side / Math.min(img.naturalWidth, img.naturalHeight);
    const pat = ctx.createPattern(img, 'repeat');
    if (!pat) return;
    pat.setTransform(
      new DOMMatrix([k, 0, 0, k, cx - (img.naturalWidth * k) / 2, cy - (img.naturalHeight * k) / 2])
    );
    s.pat = pat;
  }

  function penDown(p: Pt) {
    cur = newSeg(p);
  }
  function penMove(p: Pt) {
    if (!cur) return;
    const q = cur.pts[cur.pts.length - 1];
    const d = Math.hypot(p.x - q.x, p.y - q.y);
    if (d < 5) return;
    cur.pts.push(p);
    cur.len += d;
    cur.x0 = Math.min(cur.x0, p.x);
    cur.y0 = Math.min(cur.y0, p.y);
    cur.x1 = Math.max(cur.x1, p.x);
    cur.y1 = Math.max(cur.y1, p.y);
    if (!cur.pat && cur.len >= 24) lock(cur);
    if (label && cur.len >= 24) setLabel(works[cur.work].title);
    if (cur.len >= L) {
      cur.open = false;
      cur = newSeg(p);
    }
  }
  function penUp() {
    if (!cur) return;
    cur.open = false;
    // 点だけで終わったものは残さない。
    if (cur.pts.length < 2) {
      segs = segs.filter((s) => s !== cur);
      nextWork = (nextWork - 1 + works.length) % works.length;
    }
    cur = null;
  }

  let labelText = idleLabel;
  function setLabel(t: string) {
    if (!label || t === labelText) return;
    labelText = t;
    label.textContent = t;
  }

  // ---- 押した場所にある作品 ----
  function hit(x: number, y: number): Seg | null {
    const px = x - offX;
    const py = y - offY;
    for (let i = segs.length - 1; i >= 0; i--) {
      const s = segs[i];
      if (px < s.x0 - W / 2 || px > s.x1 + W / 2 || py < s.y0 - W / 2 || py > s.y1 + W / 2) continue;
      for (let j = 1; j < s.pts.length; j++) {
        const a = s.pts[j - 1];
        const b = s.pts[j];
        const vx = b.x - a.x;
        const vy = b.y - a.y;
        const t = Math.max(0, Math.min(1, ((px - a.x) * vx + (py - a.y) * vy) / (vx * vx + vy * vy || 1)));
        if (Math.hypot(px - (a.x + vx * t), py - (a.y + vy * t)) <= W / 2) return s;
      }
    }
    return null;
  }

  // ---- ひとりでに描くペン ----
  // 触られていないあいだだけ動く。ゆるく曲がりながら数作品ぶん描いて、離れ、別の場所からまた描く。
  let seed = 20261116;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const auto = { on: false, x: 0, y: 0, heading: 0, turn: 0, left: 0, wait: 0.35 };
  let autoSide = 1;
  function autoStep(dt: number, now: number) {
    if (pointerDown || now - lastUser < 3500) {
      if (auto.on) {
        penUp();
        auto.on = false;
        auto.wait = 0.4;
      }
      return;
    }
    if (!auto.on) {
      auto.wait -= dt;
      if (auto.wait > 0) return;
      // 流れを横切る向きに、ゆるい弧で描く。流れの上手(右下寄り)から描きはじめる。
      autoSide = -autoSide;
      const m0 = Math.min(w, h);
      auto.heading = Math.atan2(dy, dx) + (Math.PI / 2) * autoSide + (rnd() - 0.5) * 1.1;
      auto.x = w / 2 - Math.cos(auto.heading) * m0 * 0.36 - dx * m0 * (0.2 + rnd() * 0.25) + (rnd() - 0.5) * m0 * 0.2;
      auto.y = h / 2 - Math.sin(auto.heading) * m0 * 0.36 - dy * m0 * (0.2 + rnd() * 0.25) + (rnd() - 0.5) * m0 * 0.2;
      auto.turn = (rnd() - 0.5) * 1.1;
      auto.left = L * (2.4 + rnd() * 1.8);
      auto.on = true;
      penDown({ x: auto.x - offX, y: auto.y - offY });
      return;
    }
    const v = Math.min(w, h) * 0.62; // ペンの速さ(px/秒)
    // 帯が自分に重ならないよう、曲がりはゆるく保つ。
    auto.heading += auto.turn * dt;
    auto.turn += (rnd() - 0.5) * dt * 2;
    auto.turn = Math.max(-0.75, Math.min(0.75, auto.turn));
    auto.x += Math.cos(auto.heading) * v * dt;
    auto.y += Math.sin(auto.heading) * v * dt;
    auto.left -= v * dt;
    penMove({ x: auto.x - offX, y: auto.y - offY });
    const out = auto.x < -W || auto.x > w + W || auto.y < -W || auto.y > h + W;
    if (auto.left <= 0 || out) {
      penUp();
      auto.on = false;
      // 前の帯が流れて場所が空くまで待つ。
      auto.wait = 2.2 + rnd() * 1.2;
    }
  }

  // ---- 描画 ----
  function frame(now: number) {
    raf = requestAnimationFrame(frame);
    const dt = last ? Math.min(0.05, (now - last) / 1000) : 0.016;
    last = now;

    // 紙が流れる。
    boost *= Math.exp(-dt / 0.6);
    const sp = base + boost;
    offX += dx * sp * dt;
    offY += dy * sp * dt;

    autoStep(dt, now);

    // 画面の外へ出た帯は捨てる。
    segs = segs.filter(
      (s) =>
        s.open ||
        !(s.x1 + offX < -W || s.y1 + offY < -W || s.x0 + offX > w + W || s.y0 + offY > h + W)
    );

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(dpr, 0, 0, dpr, offX * dpr, offY * dpr);
    ctx.lineWidth = W;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'butt';
    for (const s of segs) {
      if (s.pts.length < 2) continue;
      if (!s.pat) lock(s);
      ctx.strokeStyle = s.pat || '#161614';
      ctx.beginPath();
      ctx.moveTo(s.pts[0].x, s.pts[0].y);
      for (let i = 1; i < s.pts.length; i++) ctx.lineTo(s.pts[i].x, s.pts[i].y);
      ctx.stroke();
    }
  }

  // ---- 入力 ----
  function onDown(e: PointerEvent) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if ((e.target as HTMLElement).closest('[data-keep]')) return;
    if (auto.on) {
      penUp();
      auto.on = false;
    }
    pointerDown = true;
    moved = false;
    downAt = { x: e.clientX, y: e.clientY };
    lastUser = performance.now();
    penDown({ x: e.clientX - offX, y: e.clientY - offY });
  }
  function onMove(e: PointerEvent) {
    if (!pointerDown) {
      // PC: 帯の上では、押せることを示す。
      if (e.pointerType === 'mouse') {
        const s = hit(e.clientX, e.clientY);
        root.classList.toggle('is-over', !!s);
        if (s) setLabel(works[s.work].title);
      }
      return;
    }
    if (Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 8) moved = true;
    lastUser = performance.now();
    penMove({ x: e.clientX - offX, y: e.clientY - offY });
  }
  function onUp(e: PointerEvent) {
    if (!pointerDown) return;
    pointerDown = false;
    lastUser = performance.now();
    const wasTap = !moved;
    if (wasTap && cur) {
      // 描かずに押しただけ: 点は残さない。
      segs = segs.filter((s) => s !== cur);
      nextWork = (nextWork - 1 + works.length) % works.length;
      cur = null;
    } else penUp();
    if (wasTap) {
      const s = hit(e.clientX, e.clientY);
      if (s) navigate(works[s.work].href);
    }
  }
  function onWheel(e: WheelEvent) {
    if (e.ctrlKey) return;
    e.preventDefault();
    // ホイールは、紙を速く流す。
    boost = Math.min(1600, boost + Math.abs(e.deltaY + e.deltaX) * 2.2);
  }
  function onResize() {
    measure();
  }

  measure();
  root.addEventListener('pointerdown', onDown);
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);
  root.addEventListener('wheel', onWheel, { passive: false });
  window.addEventListener('resize', onResize);
  raf = requestAnimationFrame(frame);

  return () => {
    cancelAnimationFrame(raf);
    root.removeEventListener('pointerdown', onDown);
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onUp);
    root.removeEventListener('wheel', onWheel);
    window.removeEventListener('resize', onResize);
    if (label) label.textContent = idleLabel;
    root.classList.remove('is-live', 'is-over');
    html.classList.remove('draw-on');
  };
}
