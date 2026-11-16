// 飛沫=作品。ヒーローを切ると、作品が画面いっぱいに飛び散る。
//
// 切る前は、小さな水滴として暗く漂っている。
// 切った瞬間、切り口から外へ弾かれ、ばねで戻りながら「水滴→画像」にひらく。
// その後は奥行きをもって漂い、ポインターを避け、スクロールに合わせて揺れる。

interface Drop {
  el: HTMLElement;
  hx: number; // 定位置(px)
  hy: number;
  z: number; // 奥行き 0(遠い)〜1(近い)
  w: number;
  h: number;
  x: number; // 定位置からのずれ(px)
  y: number;
  vx: number;
  vy: number;
  open: number; // 0=水滴 / 1=画像
  t0: number; // ひらき始める時刻
  seed: number;
  alpha: number;
  used: boolean;
}

export interface FieldEnv {
  vw: number;
  vh: number;
  dx: number;
  dy: number;
  nx: number;
  ny: number;
  travel: number;
  span: number;
  /** ヒーロー(水滴)が中央にいる度合い 1→0 */
  hero: number;
  px: number;
  py: number;
  hasPointer: boolean;
}

export interface Field {
  resize(vw: number, vh: number): void;
  burst(now: number, env: FieldEnv): void;
  /** スクロール入力で全体を揺らす。amount は進んだ量(px)。 */
  kick(amount: number, env: FieldEnv): void;
  frame(now: number, env: FieldEnv): void;
  readonly burstAt: number;
}

// 乱数は固定の種から作る(リサイズや再読み込みで配置が変わらないように)。
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export function createField(box: HTMLElement): Field {
  const els = Array.from(box.querySelectorAll<HTMLElement>('[data-drop]'));
  const drops: Drop[] = els.map((el, i) => ({
    el,
    hx: 0,
    hy: 0,
    z: 0,
    w: 0,
    h: 0,
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    open: 0,
    t0: Infinity,
    seed: i * 12.9898,
    alpha: 1,
    used: true,
  }));
  // 画像の形。ar=元の比率のまま / sq=正方形に裁つ / round=丸く裁つ(水滴の形のまま)。
  // 確認用に #c=ar などで切り替えられる。
  const want = new URLSearchParams(location.hash.replace(/^#/, '')).get('c') || box.dataset.crop || 'ar';
  const crop = want === 'sq' || want === 'round' ? want : 'ar';
  box.dataset.crop = crop;
  let burstAt = 0;
  let hot: Drop | null = null;
  let shown = true;
  let last = 0;

  function resize(vw: number, vh: number) {
    const small = Math.min(vw, vh) < 640;
    // 小さい画面では数を減らす。
    const count = small ? Math.min(34, drops.length) : drops.length;
    const r = rng(20261116);
    const cols = Math.max(3, Math.round(Math.sqrt((count * vw) / vh)));
    const rows = Math.ceil(count / cols);
    const cw = (vw * 1.16) / cols;
    const ch = (vh * 1.16) / rows;
    const wFar = small ? 40 : 60;
    const wNear = small ? 150 : 270;

    // マス目をかき混ぜて、近い/遠いが偏らないようにする。
    const cells = Array.from({ length: cols * rows }, (_, i) => i);
    for (let i = cells.length - 1; i > 0; i--) {
      const j = Math.floor(r() * (i + 1));
      [cells[i], cells[j]] = [cells[j], cells[i]];
    }

    drops.forEach((d, i) => {
      d.used = i < count;
      d.el.style.display = d.used ? '' : 'none';
      if (!d.used) return;
      const c = cells[i];
      const cx = c % cols;
      const cy = Math.floor(c / cols);
      d.z = Math.pow(r(), 0.85);
      d.hx = -vw * 0.08 + (cx + 0.5 + (r() - 0.5) * 0.7) * cw;
      d.hy = -vh * 0.08 + (cy + 0.5 + (r() - 0.5) * 0.7) * ch;
      // ヒーローでは画像を裁ってよい。crop が sq / round のときは、形を正方形にそろえる。
      const ar = crop === 'ar' ? Number(d.el.dataset.ar) || 1.5 : 1;
      let w = lerp(wFar, wNear, Math.pow(d.z, 1.5));
      if (crop !== 'ar') w *= 0.86; // 面積をそろえる
      if (ar < 0.9) w *= Math.sqrt(ar / 0.9); // 縦長は少し小さく
      d.w = Math.round(w);
      d.h = Math.round(w / ar);
      d.alpha = 0.2 + 0.8 * Math.pow(d.z, 1.25);
      d.el.style.width = `${d.w}px`;
      d.el.style.height = `${d.h}px`;
      d.el.style.zIndex = String(Math.round(d.z * 100));
      d.el.style.setProperty('--a', d.alpha.toFixed(3));
      // 遠いものはぼかして、奥行きを出す。
      d.el.classList.toggle('is-far', d.z < 0.3);
      d.el.classList.toggle('is-mid', d.z >= 0.3 && d.z < 0.5);
    });
  }

  function burst(now: number, env: FieldEnv) {
    if (burstAt) return;
    burstAt = now;
    const cx = env.vw / 2;
    const cy = env.vh / 2;
    const diag = Math.hypot(env.vw, env.vh);
    const r = rng(77);
    for (const d of drops) {
      if (!d.used) continue;
      const rx = d.hx - cx;
      const ry = d.hy - cy;
      // 切り口(軸に沿った線)からの距離。近いものから順にひらく。
      const sd = rx * env.nx + ry * env.ny;
      const side = sd >= 0 ? 1 : -1;
      d.t0 = now + (Math.abs(sd) / diag) * 620 + r() * 140;
      // いったん切り口の近くへ寄せてから、外へ弾き飛ばす。
      const along = rx * env.dx + ry * env.dy;
      const fromX = cx + env.dx * along * 0.35 + env.nx * side * 12;
      const fromY = cy + env.dy * along * 0.35 + env.ny * side * 12;
      d.x = fromX - d.hx;
      d.y = fromY - d.hy;
      const sp = (0.55 + d.z * 0.9) * (16 + r() * 16);
      d.vx = env.nx * side * sp + env.dx * (r() - 0.5) * 14;
      d.vy = env.ny * side * sp + env.dy * (r() - 0.5) * 14;
    }
  }

  function kick(amount: number, env: FieldEnv) {
    if (!burstAt) return;
    const k = clamp(amount, -160, 160) * 0.035;
    for (const d of drops) {
      if (!d.used) continue;
      const f = k * (0.3 + d.z);
      d.vx -= env.dx * f;
      d.vy -= env.dy * f;
    }
  }

  function frame(now: number, env: FieldEnv) {
    const dt = clamp((now - (last || now)) / 16.67, 0.5, 2.5);
    last = now;

    // 先へ進むと、作品は軸に沿って流れ去る。
    const fade = clamp(1 - env.travel / (env.span * 0.8), 0, 1);
    const vis = fade > 0.002;
    if (vis !== shown) {
      shown = vis;
      box.style.visibility = vis ? 'visible' : 'hidden';
    }
    if (!vis) return;
    box.style.opacity = fade.toFixed(3);

    const cx = env.vw / 2;
    const cy = env.vh / 2;
    // ヒーローの水滴がいる間は、中央を空けておく。
    const clear = Math.min(env.vw, env.vh) * 0.36 * env.hero;
    let nextHot: Drop | null = null;

    for (const d of drops) {
      if (!d.used) continue;

      // ひらき具合
      if (burstAt && now >= d.t0 && d.open < 1) {
        d.open = clamp((now - d.t0) / 760, 0, 1);
      }
      const e = d.open < 1 ? 1 - Math.pow(1 - d.open, 3) : 1;

      // ばねで定位置へ戻る(少し行き過ぎて揺れる)。
      const k = 0.022;
      const damp = 0.9;
      d.vx = (d.vx - d.x * k * dt) * Math.pow(damp, dt);
      d.vy = (d.vy - d.y * k * dt) * Math.pow(damp, dt);
      d.x += d.vx * dt;
      d.y += d.vy * dt;

      // ゆっくり漂う。
      const t = now * 0.00022 * (0.6 + d.z);
      const fx = Math.sin(t + d.seed) * 9 * (0.4 + d.z);
      const fy = Math.cos(t * 0.8 + d.seed * 1.7) * 9 * (0.4 + d.z);

      let x = d.hx + d.x + fx;
      let y = d.hy + d.y + fy;

      // ポインターの動きに対する視差(近いものほど大きく動く)。
      if (env.hasPointer) {
        x += (0.5 - env.px / env.vw) * 54 * d.z;
        y += (0.5 - env.py / env.vh) * 54 * d.z;
      }

      // 先へ進むと、近いものほど速く左上へ流れる。
      const flow = env.travel * (0.5 + d.z * 1.1);
      x -= env.dx * flow;
      y -= env.dy * flow;

      // 中央(水滴)を避ける。
      if (clear > 0) {
        const rx = x - cx;
        const ry = y - cy;
        const dist = Math.hypot(rx, ry) || 1;
        const need = clear + Math.max(d.w, d.h) * 0.5;
        if (dist < need) {
          const push = (need - dist) * 0.9;
          x += (rx / dist) * push;
          y += (ry / dist) * push;
        }
      }

      // ポインターを水面のように避ける。
      let lift = 0;
      if (env.hasPointer && d.open >= 1) {
        const rx = x - env.px;
        const ry = y - env.py;
        const dist = Math.hypot(rx, ry);
        const inside = Math.abs(rx) < d.w * 0.5 && Math.abs(ry) < d.h * 0.5;
        if (inside && (!nextHot || d.z > nextHot.z)) nextHot = d;
        const R = 190;
        if (dist < R && !inside) {
          const f = Math.pow(1 - dist / R, 2) * 22 * (0.3 + d.z);
          x += (rx / (dist || 1)) * f;
          y += (ry / (dist || 1)) * f;
        }
        if (d === hot) lift = 0.1;
      }

      // 水滴(小さく丸い)→ 画像(等倍の四角)。
      const bead = 0.1 + 0.1 * d.z;
      const sc = lerp(bead * (150 / Math.max(d.w, d.h)) + 0.05, 1 + lift, e);
      d.el.style.transform = `translate3d(${(x - d.w / 2).toFixed(1)}px, ${(y - d.h / 2).toFixed(1)}px, 0) scale(${sc.toFixed(3)})`;
      if (d.open < 1 || d.el.dataset.o !== '1') {
        d.el.style.setProperty('--o', e.toFixed(3));
        d.el.dataset.o = d.open >= 1 ? '1' : '0';
      }
    }

    if (nextHot !== hot) {
      hot?.el.classList.remove('is-hot');
      nextHot?.el.classList.add('is-hot');
      hot = nextHot;
      box.classList.toggle('is-focusing', !!hot);
    }
  }

  return {
    resize,
    burst,
    kick,
    frame,
    get burstAt() {
      return burstAt;
    },
  };
}
