// 粒。
//
// 「描く」の帯を土台にした、最初の表現。
//   ・帯の画素が、そのまま粒になる(色も位置も、帯のまま始まる)
//   ・粒は少しのあいだ帯の形をとどめ、古い側からほどけて霧になる
//   ・次に描く線には、粒が集まる。線が伸びたぶんだけ、粒がその場所の画素として呼ばれて飛んでくる。
//     速く引いたところは細い筋、ゆっくり引いたところは帯の幅に広がって写真が読める
//   ・組み直すときは、細い筋が帯の幅に広がり、ほかの帯にも粒が戻る
//
// 粒の位置は「紙の上の座標」で持つ(帯と同じように、紙と一緒に流れる)。
// 描くのは WebGL の点。四角い点のまま使う(丸めない・ぼかさない)。

type Pt = { x: number; y: number };

export interface DotSeg {
  pts: Pt[];
  nrm: Pt[];
  cum: number[];
  len: number;
  work: number;
  nav: number;
  pat: unknown;
  k: number;
  tx: number;
  ty: number;
}

export interface DotsEnv {
  W: number; // 帯の太さ
  w: number;
  h: number;
  dpr: number;
  offX: number;
  offY: number;
  dx: number; // 紙の流れる向き
  dy: number;
}

// いま描いている線をつくる帯(行き先の区切りは含めない)。
export interface DotsPull {
  segs: DotSeg[];
  spread: number; // 0=細い筋 / 1=帯の幅いっぱい
}

export interface Dots {
  toDots(list: DotSeg[], env: DotsEnv, now: number): void;
  toBands(list: DotSeg[], env: DotsEnv, now: number, done: () => void): void;
  frame(dt: number, now: number, env: DotsEnv, pull: DotsPull | null): void;
  resize(w: number, h: number, dpr: number): void;
  dispose(): void;
}

const MAX = 30000;
const FOG = 9000; // 霧として最低限ただよわせておく粒の数
const FOG_ADD = 3500; // 帯が多いときにも足す、霧の粒の数
// 粒のふるまい
const HELD = 1; // 帯の形のまま、ほどけるのを待っている
const FREE = 2; // 霧
const HOMING = 3; // 帯の画素の場所へ戻っている
const DYING = 4; // 消えていく

const VERT = `
attribute vec2 a_pos;
attribute float a_size;
attribute vec4 a_col;
uniform vec2 u_res;
varying vec4 v_col;
void main() {
  vec2 p = a_pos / u_res * 2.0 - 1.0;
  gl_Position = vec4(p.x, -p.y, 0.0, 1.0);
  gl_PointSize = a_size;
  v_col = a_col;
}`;
const FRAG = `
precision mediump float;
varying vec4 v_col;
void main() {
  gl_FragColor = vec4(v_col.rgb * v_col.a, v_col.a);
}`;

export function createDots(root: HTMLElement, after: HTMLCanvasElement, images: HTMLImageElement[]): Dots | null {
  const canvas = document.createElement('canvas');
  canvas.className = 'draw-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  canvas.style.pointerEvents = 'none';
  after.after(canvas);
  const gl = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: true, antialias: false });
  if (!gl) {
    canvas.remove();
    return null;
  }
  const sh = (type: number, src: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    return s;
  };
  const prog = gl.createProgram()!;
  gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT));
  gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FRAG));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    canvas.remove();
    return null;
  }
  gl.useProgram(prog);
  const STRIDE = 7; // x, y, 大きさ, r, g, b, a
  const vbuf = new Float32Array(MAX * STRIDE);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, vbuf.byteLength, gl.DYNAMIC_DRAW);
  const aPos = gl.getAttribLocation(prog, 'a_pos');
  const aSize = gl.getAttribLocation(prog, 'a_size');
  const aCol = gl.getAttribLocation(prog, 'a_col');
  gl.enableVertexAttribArray(aPos);
  gl.enableVertexAttribArray(aSize);
  gl.enableVertexAttribArray(aCol);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, STRIDE * 4, 0);
  gl.vertexAttribPointer(aSize, 1, gl.FLOAT, false, STRIDE * 4, 8);
  gl.vertexAttribPointer(aCol, 4, gl.FLOAT, false, STRIDE * 4, 12);
  const uRes = gl.getUniformLocation(prog, 'u_res');
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  gl.clearColor(0, 0, 0, 0);

  // 粒
  let n = 0;
  const px = new Float32Array(MAX);
  const py = new Float32Array(MAX);
  const vx = new Float32Array(MAX);
  const vy = new Float32Array(MAX);
  const hx = new Float32Array(MAX); // 戻る場所(帯の画素)
  const hy = new Float32Array(MAX);
  const gx = new Float32Array(MAX); // 帯の幅いっぱいに広がったときの場所
  const gy = new Float32Array(MAX);
  const big = new Float32Array(MAX); // 画素として落ち着いたときの大きさ
  const capd = new Uint8Array(MAX); // いま描いている線に呼ばれた粒
  const sx = new Float32Array(MAX); // 戻りはじめた場所
  const sy = new Float32Array(MAX);
  const cr = new Float32Array(MAX);
  const cg = new Float32Array(MAX);
  const cb = new Float32Array(MAX);
  const tr = new Float32Array(MAX); // 戻った先の色
  const tg = new Float32Array(MAX);
  const tb = new Float32Array(MAX);
  const al = new Float32Array(MAX);
  const sz = new Float32Array(MAX);
  const t0 = new Float32Array(MAX); // ほどけはじめる時刻 / 戻りはじめる時刻
  const rnd1 = new Float32Array(MAX);
  const rnd2 = new Float32Array(MAX);
  const mode = new Uint8Array(MAX);
  let grid = 3; // 粒を置く間隔(px)。帯のままに見える点の大きさでもある
  let homing: { until: number; done: () => void } | null = null;
  let fed = new WeakMap<DotSeg, number>(); // 帯ごとに、どこまで粒を呼んだか(点の番号)
  let loose = 0; // まだ呼ばれていない粒の数
  let scan = 0;

  // 作品の画素。帯の中の写真の置き方(k, tx, ty)から、その場所の色を引く。
  type Tex = { w: number; h: number; d: Uint8ClampedArray; r: number };
  const cache: (Tex | null | undefined)[] = [];
  function tex(i: number): Tex | null {
    const c = cache[i];
    if (c !== undefined) return c;
    const img = images[i];
    if (!img || !img.complete || !img.naturalWidth) return null; // まだ読めていない。あとでもう一度引く
    const w = Math.min(260, img.naturalWidth);
    const h = Math.max(1, Math.round((img.naturalHeight * w) / img.naturalWidth));
    const cv = document.createElement('canvas');
    cv.width = w;
    cv.height = h;
    let t: Tex | null = null;
    try {
      const x = cv.getContext('2d', { willReadFrequently: true })!;
      x.drawImage(img, 0, 0, w, h);
      t = { w, h, d: x.getImageData(0, 0, w, h).data, r: w / img.naturalWidth };
    } catch {
      t = null;
    }
    cache[i] = t;
    return t;
  }
  const rgb = [40, 40, 38];
  function colorAt(s: DotSeg, x: number, y: number) {
    const t = s.pat ? tex(s.work) : null;
    if (!t) {
      rgb[0] = rgb[1] = rgb[2] = 38;
      return;
    }
    let u = Math.floor(((x - s.tx) / s.k) * t.r) % t.w;
    let v = Math.floor(((y - s.ty) / s.k) * t.r) % t.h;
    if (u < 0) u += t.w;
    if (v < 0) v += t.h;
    const i = (v * t.w + u) * 4;
    rgb[0] = t.d[i];
    rgb[1] = t.d[i + 1];
    rgb[2] = t.d[i + 2];
  }

  // 帯の中を、等しい間隔でなぞる(点 i0 から i1 まで)。芯の点・幅の向き・芯からのずれを渡す。
  function sample(
    s: DotSeg,
    W: number,
    step: number,
    i0: number,
    i1: number,
    cb: (cx: number, cy: number, nx: number, ny: number, v: number, along: number) => void
  ) {
    const hw = W / 2;
    for (let i = i0; i < i1; i++) {
      const a = s.pts[i];
      const b = s.pts[i + 1];
      const na = s.nrm[i].x || s.nrm[i].y ? s.nrm[i] : s.nrm[i + 1];
      const nb = s.nrm[i + 1];
      const d = Math.hypot(b.x - a.x, b.y - a.y);
      const m = Math.max(1, Math.round(d / step));
      for (let j = 0; j < m; j++) {
        const t = j / m;
        const cx = a.x + (b.x - a.x) * t;
        const cy = a.y + (b.y - a.y) * t;
        let nx = na.x + (nb.x - na.x) * t;
        let ny = na.y + (nb.y - na.y) * t;
        const l = Math.hypot(nx, ny) || 1;
        nx /= l;
        ny /= l;
        const along = (s.cum[i] + d * t) / Math.max(1, s.len);
        for (let v = -hw + step / 2; v < hw; v += step) cb(cx, cy, nx, ny, v, along);
      }
    }
  }
  const lineStep = (W: number) => Math.max(3, W / 34); // 描いている線に粒を呼ぶ間隔
  function stepFor(list: DotSeg[], W: number, room: number) {
    let area = 0;
    for (const s of list) area += s.len * W;
    return Math.max(3, Math.sqrt(area / Math.max(1, room)));
  }

  let seed = 20261123;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  function put(i: number, x: number, y: number, r: number, g: number, b: number) {
    px[i] = hx[i] = x;
    py[i] = hy[i] = y;
    vx[i] = vy[i] = 0;
    cr[i] = tr[i] = r;
    cg[i] = tg[i] = g;
    cb[i] = tb[i] = b;
    rnd1[i] = rnd();
    rnd2[i] = rnd();
    capd[i] = 0;
  }
  // 霧の粒を、画面のどこかに足す。色は紙の白を落とした灰。
  function addFog(env: DotsEnv, count: number, now: number) {
    for (let k = 0; k < count && n < MAX; k++) {
      const i = n++;
      put(i, rnd() * env.w - env.offX, rnd() * env.h - env.offY, 150, 147, 140);
      mode[i] = FREE;
      t0[i] = now - 9;
      al[i] = 0;
      sz[i] = 1.6;
      big[i] = 3.6;
      loose++;
      vx[i] = (rnd() - 0.5) * 30;
      vy[i] = (rnd() - 0.5) * 30;
    }
  }

  function toDots(list: DotSeg[], env: DotsEnv, now: number) {
    homing = null;
    fed = new WeakMap();
    n = 0;
    loose = 0;
    grid = stepFor(list, env.W, MAX - FOG_ADD - 500);
    list.forEach((s, order) => {
      sample(s, env.W, grid, 0, s.pts.length - 1, (cx, cy, nx, ny, v, along) => {
        if (n >= MAX) return;
        const i = n++;
        const x = cx + nx * v;
        const y = cy + ny * v;
        colorAt(s, x, y);
        put(i, x, y, rgb[0], rgb[1], rgb[2]);
        mode[i] = HELD;
        // 古い帯から、描きはじめの側から、少しずつほどける。
        t0[i] = now + 0.12 + order * 0.07 + along * 0.45 + rnd1[i] * 0.35;
        al[i] = 1;
        sz[i] = big[i] = grid + 0.6;
        loose++;
      });
    });
    addFog(env, Math.max(FOG - n, FOG_ADD), now);
  }

  // まだ呼ばれていない粒を1つ選ぶ。足りなければ、画面のどこかに新しく置く。
  function recruit(env: DotsEnv, now: number): number {
    if (loose > 0) {
      for (let k = 0; k < n; k++) {
        scan = (scan + 1) % n;
        if (!capd[scan] && (mode[scan] === FREE || mode[scan] === HELD)) {
          loose--;
          return scan;
        }
      }
      loose = 0;
    }
    if (n >= MAX) return -1;
    const i = n++;
    put(i, rnd() * env.w - env.offX, rnd() * env.h - env.offY, 150, 147, 140);
    al[i] = 0;
    sz[i] = 1.6;
    return i;
  }

  // 線が伸びたぶんだけ、粒を呼ぶ。粒は、その場所の画素になる。
  function feed(pull: DotsPull, env: DotsEnv, now: number) {
    const step = lineStep(env.W);
    for (const s of pull.segs) {
      if (!s.pat) continue; // 写真の置き場所が決まってから
      const i0 = fed.get(s) ?? 0;
      const i1 = s.pts.length - 1;
      if (i1 <= i0) continue;
      sample(s, env.W, step, i0, i1, (cx, cy, nx, ny, v) => {
        const i = recruit(env, now);
        if (i < 0) return;
        capd[i] = 1;
        mode[i] = FREE;
        gx[i] = cx + nx * v;
        gy[i] = cy + ny * v;
        // 速く引いたところは、芯に寄せる(細い筋になる)。
        hx[i] = cx + nx * v * pull.spread;
        hy[i] = cy + ny * v * pull.spread;
        colorAt(s, gx[i], gy[i]);
        tr[i] = rgb[0];
        tg[i] = rgb[1];
        tb[i] = rgb[2];
        big[i] = step + 0.6;
        t0[i] = now;
      });
      fed.set(s, i1);
    }
  }

  function toBands(list: DotSeg[], env: DotsEnv, now: number, done: () => void) {
    // 線に呼ばれていた粒は、帯の幅に広がる(細い筋が面になる)。
    let held = 0;
    for (let i = 0; i < n; i++) {
      if (!capd[i]) continue;
      held++;
      mode[i] = HOMING;
      sx[i] = px[i];
      sy[i] = py[i];
      hx[i] = gx[i];
      hy[i] = gy[i];
      t0[i] = now + rnd1[i] * 0.1;
    }
    // ほかの帯(まだ粒を呼んでいないところ)の画素を並べる。
    let area = 0;
    for (const s of list) area += s.len * env.W * (1 - (fed.get(s) ?? 0) / Math.max(1, s.pts.length - 1));
    const step = Math.max(lineStep(env.W), Math.sqrt(area / Math.max(1, MAX - held - 200)));
    const T: number[] = [];
    for (const s of list) {
      const i0 = fed.get(s) ?? 0;
      if (i0 >= s.pts.length - 1) continue;
      sample(s, env.W, step, i0, s.pts.length - 1, (cx, cy, nx, ny, v) => {
        const x = cx + nx * v;
        const y = cy + ny * v;
        colorAt(s, x, y);
        T.push(x, y, rgb[0], rgb[1], rgb[2]);
      });
    }
    const nt = T.length / 5;
    // 残りの粒と戻る先を、紙の流れる向きに沿った順に並べて対応させる(行き交いを減らす)。
    const key = (x: number, y: number) => x * env.dx + y * env.dy;
    const pi: number[] = [];
    for (let i = 0; i < n; i++) if (!capd[i] && (mode[i] === FREE || mode[i] === HELD)) pi.push(i);
    pi.sort((a, b) => key(px[a], py[a]) - key(px[b], py[b]));
    const ti = Array.from({ length: nt }, (_, i) => i).sort((a, b) => key(T[a * 5], T[a * 5 + 1]) - key(T[b * 5], T[b * 5 + 1]));
    const have = pi.length;
    for (let k = 0; k < Math.max(have, nt); k++) {
      if (k >= nt) {
        mode[pi[k]] = DYING;
        continue;
      }
      const t = ti[k] * 5;
      let i: number;
      if (k < have) i = pi[k];
      else {
        if (n >= MAX) continue;
        i = n++;
        if (have > 0) {
          // 粒が足りなければ、近い順位の粒の場所から増やす。
          const src = pi[Math.min(have - 1, Math.floor((k / nt) * have))];
          put(i, px[src], py[src], cr[src], cg[src], cb[src]);
          al[i] = al[src];
          sz[i] = sz[src];
        } else {
          put(i, T[t], T[t + 1], T[t + 2], T[t + 3], T[t + 4]);
          al[i] = 0;
          sz[i] = step;
        }
      }
      mode[i] = HOMING;
      sx[i] = px[i];
      sy[i] = py[i];
      hx[i] = T[t];
      hy[i] = T[t + 1];
      tr[i] = T[t + 2];
      tg[i] = T[t + 3];
      tb[i] = T[t + 4];
      big[i] = step + 0.6;
      t0[i] = now + rnd1[i] * 0.16;
    }
    loose = 0;
    homing = { until: now + 0.78, done };
  }

  function frame(dt: number, now: number, env: DotsEnv, pull: DotsPull | null) {
    if (homing && now >= homing.until) {
      homing.done();
      homing = null;
      fed = new WeakMap();
      n = 0;
    }
    if (pull && !homing && n) feed(pull, env, now);
    if (!n) {
      gl!.clear(gl!.COLOR_BUFFER_BIT);
      return;
    }
    const drawing = !!pull;
    const margin = 36;
    const spanX = env.w + margin * 2;
    const spanY = env.h + margin * 2;
    let o = 0;
    for (let i = 0; i < n; i++) {
      const m = mode[i];
      if (m === HELD) {
        if (now >= t0[i]) {
          mode[i] = FREE;
          const a = rnd1[i] * 6.2832 * 5;
          vx[i] = Math.cos(a) * (14 + 40 * rnd2[i]);
          vy[i] = Math.sin(a) * (14 + 40 * rnd2[i]);
        }
      } else if (m === FREE && capd[i]) {
        // 線に呼ばれた粒: 自分の画素の場所へ飛んで、落ち着く。
        const ex = hx[i] - px[i];
        const ey = hy[i] - py[i];
        const k = Math.exp(-dt * 15);
        vx[i] = (vx[i] + ex * 95 * dt) * k;
        vy[i] = (vy[i] + ey * 95 * dt) * k;
        px[i] += vx[i] * dt;
        py[i] += vy[i] * dt;
        const c = Math.min(1, dt * 10);
        cr[i] += (tr[i] - cr[i]) * c;
        cg[i] += (tg[i] - cg[i]) * c;
        cb[i] += (tb[i] - cb[i]) * c;
        const arrived = ex * ex + ey * ey < 90;
        sz[i] += ((arrived ? big[i] : 1.9) - sz[i]) * Math.min(1, dt * 14);
        al[i] += (1 - al[i]) * Math.min(1, dt * 8);
      } else if (m === FREE) {
        let x = px[i];
        let y = py[i];
        const q = (Math.sin(x * 0.0061 + now * 0.21) + Math.cos(y * 0.0073 - now * 0.17)) * 3.1416;
        let ax = Math.cos(q) * 46;
        let ay = Math.sin(q) * 46;
        // ほどけはじめは、まだ帯の形へ引かれている。
        const hold = 7 * Math.exp(-(now - t0[i]) / 0.9);
        if (hold > 0.05) {
          ax += (hx[i] - x) * hold;
          ay += (hy[i] - y) * hold;
        }
        const k = Math.exp(-dt * 1.4);
        vx[i] = (vx[i] + ax * dt) * k;
        vy[i] = (vy[i] + ay * dt) * k;
        x += vx[i] * dt;
        y += vy[i] * dt;
        // 霧は画面から出ていかない(端で反対側へ回る)。
        const scx = x + env.offX;
        const scy = y + env.offY;
        if (scx < -margin) x += spanX;
        else if (scx > env.w + margin) x -= spanX;
        if (scy < -margin) y += spanY;
        else if (scy > env.h + margin) y -= spanY;
        px[i] = x;
        py[i] = y;
        // ほどけた粒は小さくなる。線を描いているあいだは、霧を少し沈める(線が立つように)。
        const young = now - t0[i] < 0.5;
        sz[i] += ((young ? big[i] : 1.7) - sz[i]) * Math.min(1, dt * 3);
        al[i] += ((young ? 1 : drawing ? 0.32 : 0.5) - al[i]) * Math.min(1, dt * 4);
      } else if (m === HOMING) {
        const e0 = Math.max(0, Math.min(1, (now - t0[i]) / 0.56));
        const e = 1 - Math.pow(1 - e0, 3);
        px[i] = sx[i] + (hx[i] - sx[i]) * e;
        py[i] = sy[i] + (hy[i] - sy[i]) * e;
        const c = Math.min(1, dt * 9);
        cr[i] += (tr[i] - cr[i]) * c;
        cg[i] += (tg[i] - cg[i]) * c;
        cb[i] += (tb[i] - cb[i]) * c;
        // 飛んでいるあいだは小さい粒のまま。着くところで、帯の画素の大きさになる。
        const near = capd[i] || e0 > 0.82;
        sz[i] += ((near ? big[i] : 1.9) - sz[i]) * Math.min(1, dt * 16);
        al[i] += (1 - al[i]) * Math.min(1, dt * 10);
      } else if (m === DYING) {
        al[i] *= Math.exp(-dt * 9);
        px[i] += vx[i] * dt;
        py[i] += vy[i] * dt;
      } else continue;
      if (al[i] < 0.01) continue;
      vbuf[o] = (px[i] + env.offX) * env.dpr;
      vbuf[o + 1] = (py[i] + env.offY) * env.dpr;
      vbuf[o + 2] = sz[i] * env.dpr;
      vbuf[o + 3] = cr[i] / 255;
      vbuf[o + 4] = cg[i] / 255;
      vbuf[o + 5] = cb[i] / 255;
      vbuf[o + 6] = al[i];
      o += STRIDE;
    }
    gl!.clear(gl!.COLOR_BUFFER_BIT);
    if (!o) return;
    gl!.bufferSubData(gl!.ARRAY_BUFFER, 0, vbuf.subarray(0, o));
    gl!.drawArrays(gl!.POINTS, 0, o / STRIDE);
  }

  function resize(w: number, h: number, dpr: number) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    gl!.viewport(0, 0, canvas.width, canvas.height);
    gl!.uniform2f(uRes, canvas.width, canvas.height);
  }

  function dispose() {
    n = 0;
    homing = null;
    gl!.getExtension('WEBGL_lose_context')?.loseContext();
    canvas.remove();
  }

  return { toDots, toBands, frame, resize, dispose };
}
