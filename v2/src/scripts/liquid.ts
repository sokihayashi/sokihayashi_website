// 液体のカーソルと切り跡。
//
// 白い円をキャンバスに描き、CSS 側の SVG フィルター(#goo: ぼかし→しきい値)を
// かけることで、近づいた円どうしが水滴のようにくっつく。
// キャンバスは mix-blend-mode: difference なので、下の絵や文字を反転させて見せる。

interface Bead {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  decay: number;
}

export interface Liquid {
  resize(w: number, h: number): void;
  /** ポインターの位置。hot はリンクやボタンの上にいるとき。 */
  pointer(x: number, y: number, hot: boolean): void;
  /** ポインターが画面から出た/タッチが終わった。 */
  leave(): void;
  /** 水滴を1つ飛ばす。 */
  bead(x: number, y: number, vx: number, vy: number, r: number, decay?: number): void;
  /** 画面を横切る一太刀。線が水滴にちぎれて消える。 */
  slash(cx: number, cy: number, dx: number, dy: number, len: number): void;
  frame(): void;
}

export function createLiquid(canvas: HTMLCanvasElement, fine: boolean): Liquid {
  const ctx = canvas.getContext('2d')!;
  let w = 0;
  let h = 0;
  const beads: Bead[] = [];
  // カーソルは「先頭」と「尾」の2つの円。速く動かすと尾が遅れて、しずくの形に伸びる。
  const head = { x: -99, y: -99, r: 0 };
  const tail = { x: -99, y: -99 };
  const want = { x: -99, y: -99, r: 0, on: false };
  let dirty = true;

  return {
    resize(nw, nh) {
      w = nw;
      h = nh;
      // フィルターの負荷を抑えるため、等倍で描く(ぼかすので粗さは見えない)。
      canvas.width = Math.round(w);
      canvas.height = Math.round(h);
      dirty = true;
    },
    pointer(x, y, hot) {
      if (!fine) return;
      if (!want.on) {
        head.x = tail.x = x;
        head.y = tail.y = y;
      }
      want.x = x;
      want.y = y;
      want.r = hot ? 30 : 10;
      want.on = true;
    },
    leave() {
      want.on = false;
      want.r = 0;
    },
    bead(x, y, vx, vy, r, decay = 0.93) {
      beads.push({ x, y, vx, vy, r, decay });
      if (beads.length > 140) beads.splice(0, beads.length - 140);
    },
    slash(cx, cy, dx, dy, len) {
      const n = Math.round(len / 19);
      for (let i = 0; i <= n; i++) {
        const t = (i / n - 0.5) * len;
        const j = (Math.random() - 0.5) * 6;
        this.bead(
          cx + dx * t - dy * j,
          cy + dy * t + dx * j,
          dx * (Math.random() - 0.5) * 3 - dy * (Math.random() - 0.5) * 1.6,
          dy * (Math.random() - 0.5) * 3 + dx * (Math.random() - 0.5) * 1.6,
          10 + Math.random() * 11,
          0.9 + Math.random() * 0.05
        );
      }
    },
    frame() {
      head.x += (want.x - head.x) * 0.34;
      head.y += (want.y - head.y) * 0.34;
      head.r += (want.r - head.r) * 0.18;
      tail.x += (head.x - tail.x) * 0.16;
      tail.y += (head.y - tail.y) * 0.16;

      const moving =
        beads.length > 0 ||
        head.r > 0.3 ||
        Math.abs(want.x - head.x) > 0.2 ||
        Math.abs(head.x - tail.x) > 0.2 ||
        Math.abs(head.y - tail.y) > 0.2;
      if (!moving && !dirty) return;
      dirty = moving;

      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = '#fff';

      for (let i = beads.length - 1; i >= 0; i--) {
        const b = beads[i];
        b.x += b.vx;
        b.y += b.vy;
        b.vx *= 0.9;
        b.vy *= 0.9;
        b.r *= b.decay;
        if (b.r < 1.2) {
          beads.splice(i, 1);
          continue;
        }
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.r, 0, 6.2832);
        ctx.fill();
      }

      if (head.r > 0.3) {
        ctx.beginPath();
        ctx.arc(head.x, head.y, head.r, 0, 6.2832);
        ctx.fill();
        // 先頭と尾のあいだを小さな円でつなぐ(フィルターで1本の水の筋になる)。
        const dx = tail.x - head.x;
        const dy = tail.y - head.y;
        const dist = Math.hypot(dx, dy);
        const steps = Math.min(8, Math.floor(dist / 7));
        for (let s = 1; s <= steps; s++) {
          const t = s / (steps + 1);
          ctx.beginPath();
          ctx.arc(head.x + dx * t, head.y + dy * t, head.r * (1 - t * 0.45), 0, 6.2832);
          ctx.fill();
        }
        ctx.beginPath();
        ctx.arc(tail.x, tail.y, head.r * 0.55, 0, 6.2832);
        ctx.fill();
      }
    },
  };
}
