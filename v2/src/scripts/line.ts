// 試作 /lab/line/ : 1本の線を中心に置く。
//
// 考え(本人、2026-11-24): 帯というより「線的なもの」を中心に置く。それがパイプになっても、細かい線の集合になってもいい。
// そこから派生で、持っている3Dデータを動かしてもいい。2Dと3Dは行き来したい(平面かと思ったものが、そのまま空間になる)。
//
// ここで試すこと:
//  ・画面にあるのは、点 P 個をつないだ1本の線だけ。形が変わっても、同じ1本(点の順番は変わらない)。
//  ・帯 = つぶしたコイル(真上から見ると、線が幅を行き来する平らな帯)。
//  ・パイプ = 同じコイルを、奥行きにふくらませたもの。真上からは帯と見分けがつかない。視点が傾いて、はじめて筒だと分かる。
//  ・線の束 = 同じ線が、道すじを何往復もする。
//  ・立体 = 同じ線が、3Dデータの外形を下から上へ巻く。
//  ・切り替わりは拍の上で起きる。描いている間は真上(平面)。離すと、次の拍から空間へ。
//
// /lab/morph/ と /lab/morph-sharp/ には触れていない。

const P = 60000; // 線の点の数(3Dデータの線と同じ: 240周 × 250)
const BPM = 100;
const BEAT = 60 / BPM;
const HOLD = 8; // 1カットの長さ(拍)
const MOVE = 2; // 形が移るのにかける拍

type Shape = 'band' | 'pipe' | 'bundle' | 'pend' | 'puck';
const ORDER: Shape[] = ['band', 'pipe', 'bundle', 'pend', 'pipe', 'puck', 'bundle'];

const VS = `#version 300 es
precision highp float;
layout(location=0) in vec3 aA;
layout(location=1) in vec3 aB;
uniform mat3 uMA, uMB;      // それぞれの形の向き(形ごとに、見る角度を持つ)
uniform float uX;           // 形の移り(0..1)
uniform vec2 uView;         // 画面の大きさ(CSS px)
uniform float uD;           // 視点までの距離
uniform float uR;           // 奥行きの目安(明るさの差に使う)
out float vL;
void main(){
  float s = float(gl_VertexID) / ${P - 1}.0;
  // 移りは、線に沿って先頭から伝わる(線が ほどけて、巻き直す)。
  float w = smoothstep(0.0, 1.0, clamp(uX * 1.7 - 0.7 * s, 0.0, 1.0));
  vec3 p = mix(uMA * aA, uMB * aB, w);
  float k = uD / (uD - p.z);
  gl_Position = vec4(p.xy * k / (uView * 0.5), 0.0, 1.0);
  // 手前は明るく、奥は暗く。
  vL = 0.22 + 0.78 * smoothstep(-uR, uR, p.z);
}`;
const FS = `#version 300 es
precision highp float;
in float vL;
uniform float uA;
out vec4 o;
void main(){ o = vec4(vec3(0.957, 0.945, 0.914) * vL * uA, 1.0); }`;

export function mountLine(root: HTMLElement): () => void {
  const canvas = root.querySelector<HTMLCanvasElement>('[data-canvas]')!;
  const gl = canvas.getContext('webgl2', { antialias: true, alpha: false })!;
  const base = root.dataset.base ?? '';
  let vw = 1, vh = 1, dpr = 1, R = 40, D = 1000;
  let dead = false;

  const sh = (t: number, src: string) => {
    const s = gl.createShader(t)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) console.error(gl.getShaderInfoLog(s));
    return s;
  };
  const prog = gl.createProgram()!;
  gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS));
  gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS));
  gl.linkProgram(prog);
  gl.useProgram(prog);
  const U = (n: string) => gl.getUniformLocation(prog, n);
  const u = { ma: U('uMA'), mb: U('uMB'), x: U('uX'), view: U('uView'), d: U('uD'), r: U('uR'), a: U('uA') };

  const data: Record<Shape, Float32Array> = {
    band: new Float32Array(P * 3), pipe: new Float32Array(P * 3), bundle: new Float32Array(P * 3),
    pend: new Float32Array(P * 3), puck: new Float32Array(P * 3),
  };
  const buf = {} as Record<Shape, WebGLBuffer>;
  (Object.keys(data) as Shape[]).forEach((k) => {
    buf[k] = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, buf[k]);
    gl.bufferData(gl.ARRAY_BUFFER, data[k], gl.DYNAMIC_DRAW);
  });
  const push = (k: Shape) => {
    gl.bindBuffer(gl.ARRAY_BUFFER, buf[k]);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, data[k]);
  };

  // ---- 3Dデータ(線にしてある: 外形を下から上へ巻く1本)
  const raw: Partial<Record<'pend' | 'puck', Int16Array>> = {};
  const loaded: Record<string, boolean> = { band: true, pipe: true, bundle: true };
  const fitObj = (k: 'pend' | 'puck') => {
    const q = raw[k];
    if (!q) return;
    const H = Math.min(vh * 0.62, vw * 1.25);
    const d = data[k];
    for (let i = 0; i < P; i++) {
      d[i * 3] = (q[i * 3] / 32000) * H;
      d[i * 3 + 1] = (q[i * 3 + 2] / 32000) * H; // データの上(z)を、画面の上(y)に
      d[i * 3 + 2] = (q[i * 3 + 1] / 32000) * H;
    }
    push(k);
    loaded[k] = true;
  };
  (['pend', 'puck'] as const).forEach((k) => {
    fetch(`${base}/lab/line/${k}.bin`).then((r) => r.arrayBuffer()).then((b) => {
      if (dead) return;
      raw[k] = new Int16Array(b);
      fitObj(k);
    }).catch(() => {});
  });

  // ---- 道すじ(描いた線)。Q 個に均して持つ。
  const Q = 400;
  const cx = new Float32Array(Q), cy = new Float32Array(Q), nx = new Float32Array(Q), ny = new Float32Array(Q);
  let pathLen = 1;
  let pts: number[][] = [];
  function setPath(src: number[][]) {
    // 長さで均す
    const acc = [0];
    for (let i = 1; i < src.length; i++) acc.push(acc[i - 1] + Math.hypot(src[i][0] - src[i - 1][0], src[i][1] - src[i - 1][1]));
    pathLen = Math.max(1, acc[acc.length - 1]);
    let j = 0;
    for (let i = 0; i < Q; i++) {
      const t = (i / (Q - 1)) * pathLen;
      while (j < src.length - 2 && acc[j + 1] < t) j++;
      const f = (t - acc[j]) / Math.max(1e-6, acc[j + 1] - acc[j]);
      cx[i] = src[j][0] + (src[j + 1][0] - src[j][0]) * f;
      cy[i] = src[j][1] + (src[j + 1][1] - src[j][1]) * f;
    }
    // ならす(手の震えを取る)
    for (let pass = 0; pass < 3; pass++) {
      let px = cx[0], py = cy[0];
      for (let i = 1; i < Q - 1; i++) {
        const ax = (px + cx[i] * 2 + cx[i + 1]) / 4, ay = (py + cy[i] * 2 + cy[i + 1]) / 4;
        px = cx[i]; py = cy[i]; cx[i] = ax; cy[i] = ay;
      }
    }
    for (let i = 0; i < Q; i++) {
      const a = Math.max(0, i - 2), b = Math.min(Q - 1, i + 2);
      const tx = cx[b] - cx[a], ty = cy[b] - cy[a], l = Math.hypot(tx, ty) || 1;
      nx[i] = -ty / l; ny[i] = tx / l;
    }
  }
  function defaultPath() {
    // 既定: 斜め28度の、ゆるい S 字。
    const out: number[][] = [];
    const a = (-28 * Math.PI) / 180;
    const L = Math.min(Math.hypot(vw, vh) * 0.72, (vw * 0.86) / Math.cos(a)); // 縦長の画面でも、端からはみ出さない
    for (let i = 0; i <= 80; i++) {
      const t = i / 80 - 0.5;
      const x = t * L, y = Math.sin(t * Math.PI * 2) * Math.min(vw, vh) * 0.16;
      out.push([x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)]);
    }
    return out;
  }
  const hash = (n: number) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
  function build(which: Shape[]) {
    const turns = Math.max(40, pathLen / 3.2); // コイルの巻き数(線と線の間 約3px)
    const K = 48; // 束の本数
    const per = P / K;
    for (const k of which) {
      const d = data[k];
      for (let i = 0; i < P; i++) {
        let s = i / (P - 1);
        if (k === 'bundle') {
          const st = Math.floor(i / per);
          s = (i - st * per) / (per - 1);
          if (st & 1) s = 1 - s; // 行って戻る(1本のまま、道すじを何往復もする)
          const f = s * (Q - 1), j = Math.min(Q - 2, Math.floor(f)), g = f - j;
          const x = cx[j] + (cx[j + 1] - cx[j]) * g, y = cy[j] + (cy[j + 1] - cy[j]) * g;
          const mx = nx[j] + (nx[j + 1] - nx[j]) * g, my = ny[j] + (ny[j + 1] - ny[j]) * g;
          const h1 = hash(st), h2 = hash(st + 71.3), h3 = hash(st + 13.7);
          const ang = h1 * 6.283 + 2.6 * Math.sin(6.283 * (s * (0.6 + h2) + h3));
          const rad = R * (0.25 + 1.5 * (0.5 + 0.5 * Math.sin(6.283 * (s * (1.2 + h3 * 1.6) + h2))) * (0.4 + 0.6 * h1));
          d[i * 3] = x + mx * rad * Math.cos(ang);
          d[i * 3 + 1] = y + my * rad * Math.cos(ang);
          d[i * 3 + 2] = rad * Math.sin(ang);
          continue;
        }
        const f = s * (Q - 1), j = Math.min(Q - 2, Math.floor(f)), g = f - j;
        const x = cx[j] + (cx[j + 1] - cx[j]) * g, y = cy[j] + (cy[j + 1] - cy[j]) * g;
        const mx = nx[j] + (nx[j + 1] - nx[j]) * g, my = ny[j] + (ny[j + 1] - ny[j]) * g;
        const ph = s * turns * 6.283;
        d[i * 3] = x + mx * R * Math.cos(ph);
        d[i * 3 + 1] = y + my * R * Math.cos(ph);
        d[i * 3 + 2] = k === 'pipe' ? R * Math.sin(ph) : 0;
      }
      push(k);
    }
  }

  function resize() {
    vw = root.clientWidth; vh = root.clientHeight;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(vw * dpr); canvas.height = Math.round(vh * dpr);
    gl.viewport(0, 0, canvas.width, canvas.height);
    R = Math.max(28, Math.min(vw, vh) * 0.085);
    D = Math.max(vw, vh) * 1.6;
    if (!pts.length) setPath(defaultPath());
    build(['band', 'pipe', 'bundle']);
    fitObj('pend'); fitObj('puck');
  }

  // ---- 向き(形ごとに持つ)。帯は真上。ほかは、カットに入ってからの時間で視点が回り込む。
  const m3 = new Float32Array(9);
  const ease = (x: number) => { const v = Math.max(0, Math.min(1, x)); return v * v * (3 - 2 * v); };
  function pose(k: Shape, tIn: number, out: Float32Array) {
    // tIn: そのカットに入ってからの拍数
    let pitch = 0, yaw = 0, spin = 0;
    const e = ease((tIn - 0.5) / 3); // 入って半拍は真上のまま。そこから3拍で回り込む。
    if (k === 'pipe') { pitch = -1.02 * e; spin = 0.5 * e + 0.05 * Math.max(0, tIn - 3.5); }
    else if (k === 'bundle') { pitch = -0.8 * e; spin = -0.45 * e - 0.05 * Math.max(0, tIn - 3.5); }
    else if (k === 'pend' || k === 'puck') { pitch = 0.2; yaw = -0.7 + tIn * 0.3; }
    const cp = Math.cos(pitch), sp = Math.sin(pitch);
    if (k === 'pend' || k === 'puck') {
      const c = Math.cos(yaw), s = Math.sin(yaw); // Rx(pitch) * Ry(yaw)
      out.set([c, sp * s, -cp * s, 0, cp, sp, s, -sp * c, cp * c]);
    } else {
      const c = Math.cos(spin), s = Math.sin(spin); // Rx(pitch) * Rz(spin)。画面の y は下向きなので、あとで上下を返す。
      out.set([c, cp * s, sp * s, -s, cp * c, sp * c, 0, -sp, cp]);
    }
    return out;
  }

  // ---- 進行: 拍で数える
  let beat = 0; // いまの拍(小数)
  let cut = 0; // いまのカット(ORDER の番号)
  let cutAt = 0; // そのカットに入った拍
  let from: Shape = 'band';
  let fromAt = 0; // 前のカットに入った拍(向きを続けるため)
  let drawing = false;
  let manual: { k: Shape; t: number; x: number } | null = null;
  let last = performance.now();
  const nextCut = (at: number) => {
    let n = cut;
    for (let i = 0; i < ORDER.length; i++) { n = (n + 1) % ORDER.length; if (loaded[ORDER[n]]) break; }
    from = ORDER[cut]; fromAt = cutAt; cut = n; cutAt = at;
  };
  const yflip = new Float32Array([1, 0, 0, 0, -1, 0, 0, 0, 1]);
  const mul = (a: Float32Array, b: Float32Array, o: Float32Array) => {
    for (let c = 0; c < 3; c++) for (let r = 0; r < 3; r++) o[c * 3 + r] = a[r] * b[c * 3] + a[3 + r] * b[c * 3 + 1] + a[6 + r] * b[c * 3 + 2];
    return o;
  };
  const MA = new Float32Array(9), MB = new Float32Array(9), tmp = new Float32Array(9);
  const flat = (k: Shape) => k === 'band' || k === 'pipe' || k === 'bundle';
  const mat = (k: Shape, tIn: number, o: Float32Array) => {
    pose(k, tIn, tmp);
    // 道すじの形は、画面の座標(y 下向き)で作ってある。向きを掛ける前に、上下を返す。
    return flat(k) ? mul(tmp, yflip, o) : (o.set(tmp), o);
  };
  function bind(a: Shape, b: Shape) {
    gl.bindBuffer(gl.ARRAY_BUFFER, buf[a]);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf[b]);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);
  }
  function frame(now: number) {
    if (dead) return;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    beat += dt / BEAT;
    if (!drawing && !manual && beat - cutAt >= HOLD) nextCut(Math.floor(beat));
    let a = from, b = ORDER[cut], x = ease((beat - cutAt) / MOVE), ta = beat - fromAt, tb = beat - cutAt;
    if (manual) { a = manual.k; b = manual.k; x = 1; ta = tb = manual.t; }
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    bind(a, b);
    gl.uniformMatrix3fv(u.ma, false, mat(a, ta, MA));
    gl.uniformMatrix3fv(u.mb, false, mat(b, tb, MB));
    gl.uniform1f(u.x, x);
    gl.uniform2f(u.view, vw, vh);
    gl.uniform1f(u.d, D);
    gl.uniform1f(u.r, Math.min(vw, vh) * 0.3);
    gl.uniform1f(u.a, 0.62);
    gl.drawArrays(gl.LINE_STRIP, 0, P);
    requestAnimationFrame(frame);
  }

  // ---- 入力: なぞると線を描く(描いている間は帯・真上)。離すと、次の拍から空間へ。軽く叩くと、次のカットへ。
  let downX = 0, downY = 0, moved = false, down = false;
  const local = (e: PointerEvent) => { const r = root.getBoundingClientRect(); return [e.clientX - r.left - vw / 2, e.clientY - r.top - vh / 2]; };
  const onDown = (e: PointerEvent) => {
    if ((e.target as HTMLElement).closest('a,button')) return;
    down = true; moved = false; [downX, downY] = local(e);
  };
  const onMove = (e: PointerEvent) => {
    if (!down) return;
    const [x, y] = local(e);
    if (!moved && Math.hypot(x - downX, y - downY) > 10) {
      moved = true; drawing = true; pts = [[downX, downY]];
      // 帯(真上)へ戻す
      from = ORDER[cut]; fromAt = cutAt; cut = 0; cutAt = beat - MOVE * 0.5;
    }
    if (moved) {
      const l = pts[pts.length - 1];
      if (Math.hypot(x - l[0], y - l[1]) > 4) {
        pts.push([x, y]);
        if (pts.length > 2) { setPath(pts); build(['band']); }
      }
    }
  };
  const onUp = () => {
    if (!down) return;
    down = false;
    if (moved) {
      drawing = false;
      if (pts.length > 2) { setPath(pts); build(['band', 'pipe', 'bundle']); }
      cutAt = Math.ceil(beat) - HOLD + 1; // 次の拍で、次のカットへ
    } else {
      nextCut(beat); // 叩いた瞬間に切り替える
    }
  };
  root.addEventListener('pointerdown', onDown);
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);
  window.addEventListener('resize', resize);
  resize();
  requestAnimationFrame(frame);

  // 確認用: window.__line.at('pipe', 4) で、その形の「入ってから4拍目」を止めて見る。null で戻す。
  (window as unknown as { __line?: unknown }).__line = {
    at(k: Shape | null, t = 0) { manual = k ? { k, t, x: 1 } : null; },
    draw(p: number[][]) { pts = p; setPath(p); build(['band', 'pipe', 'bundle']); },
    get loaded() { return { ...loaded }; },
  };

  return () => {
    dead = true;
    root.removeEventListener('pointerdown', onDown);
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onUp);
    window.removeEventListener('resize', resize);
  };
}
