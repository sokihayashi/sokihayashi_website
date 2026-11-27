// 操作の音(Web Audio)。
//
// 音の文法は、映像表現研究の「Topographic(等高線の地形)」のレシピ(RCP-20261107-003)から借りている:
//   - 触れると、短い「ポン」(高さで音程が上がる)
//   - つかむと、キースイッチのような短い雑音
//   - 引くと、引いた量に応じて半音ずつ上がる階段の音
//   - 全体は、音量を抑えてから、やわらかく頭を丸める(大きな音で割れないように)
// 数字は出発点として借りたもので、このサイトの音として決めたものではない(仮)。
//
// 音は、利用者が「音を出す」を押すまで鳴らさない(ブラウザの決まりでもある)。
//
// なぞりの音(展開の紙の間。2026-11-28 試作): 録音した素材は使わず、その場で作る(素材の権利の心配がない)。
//   - ペン(線・描き直し): 紙をこする音。雑音を帯域で絞り、なぞる速さで大きく・明るくなる。止めると消える。左右は指の位置
//   - 墨(しずく): 同じこすれを、暗く湿った音に
//   - 紙が鳴る(クラドニ図形): 指は弓。なぞる速さで板を擦って鳴らす。音程は いまの節の形(n, m)で決まる。離すと鳴り残って消える
//   - 押した瞬間: 紙は軽く叩いた音、板は指で弾いた音

export function makeSfx() {
  let ctx: AudioContext | null = null;
  let out: AudioNode | null = null;
  let noise: AudioBuffer | null = null;
  let on = false;
  let lastStep = 0;
  let noise2: AudioBuffer | null = null; // 2秒の雑音(こすれの音を くり返しに聞こえにくくする)
  let mon: MediaStreamAudioDestinationNode | null = null; // 確認用の録音口
  type Pen = { bp: BiquadFilterNode; lp: BiquadFilterNode; g: GainNode; pan: StereoPannerNode | null };
  type Plate = { osc: OscillatorNode[]; g: GainNode; hiss: GainNode; hbp: BiquadFilterNode; pan: StereoPannerNode | null; f0: number };
  let pen: Pen | null = null;
  let plate: Plate | null = null;
  const RATIO = [1, 1.506, 2.0, 2.63, 3.17], AMP = [1, 0.5, 0.32, 0.22, 0.13]; // 板の鳴り(整数倍でない倍音)

  function init() {
    if (ctx) return;
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    ctx = new AC({ latencyHint: 'interactive' });
    const master = ctx.createGain();
    master.gain.value = 0.42;
    // やわらかく頭を丸める: 0.7 までは そのまま、そこから先は ゆるやかに。
    const shaper = ctx.createWaveShaper();
    const curve = new Float32Array(2048);
    for (let i = 0; i < curve.length; i++) {
      const x = (i / (curve.length - 1)) * 2 - 1;
      const a = Math.abs(x);
      curve[i] = Math.sign(x) * (a < 0.7 ? a : 0.7 + 0.3 * Math.tanh((a - 0.7) / 0.3));
    }
    shaper.curve = curve;
    shaper.oversample = '2x';
    master.connect(shaper);
    shaper.connect(ctx.destination);
    out = master;
    noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    noise2 = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d2 = noise2.getChannelData(0);
    for (let i = 0; i < d2.length; i++) d2[i] = Math.random() * 2 - 1;
    // 確認用(?sfxrec): 出ている音を録れるように
    if (location.search.includes('sfxrec') && 'createMediaStreamDestination' in ctx) { mon = ctx.createMediaStreamDestination(); shaper.connect(mon); }
  }
  const mkPan = () => (ctx && 'createStereoPanner' in ctx ? ctx.createStereoPanner() : null);
  function loopNoise(): AudioBufferSourceNode | null {
    if (!ctx || !noise2) return null;
    const s = ctx.createBufferSource();
    s.buffer = noise2;
    s.loop = true;
    s.start(ctx.currentTime, Math.random() * 1.9);
    return s;
  }
  function ensurePen() {
    if (pen || !ctx || !out) return;
    const src = loopNoise();
    if (!src) return;
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 180;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1200; bp.Q.value = 0.8;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 9000;
    const g = ctx.createGain(); g.gain.value = 0;
    const pan = mkPan();
    src.connect(hp); hp.connect(bp); bp.connect(lp); lp.connect(g);
    if (pan) { g.connect(pan); pan.connect(out); } else g.connect(out);
    pen = { bp, lp, g, pan };
  }
  function ensurePlate(f0: number) {
    if (plate || !ctx || !out) return;
    const g = ctx.createGain(); g.gain.value = 0;
    const pan = mkPan();
    const osc = RATIO.map((r, i) => {
      const o = ctx!.createOscillator();
      o.type = i === 0 ? 'triangle' : 'sine';
      o.frequency.value = f0 * r;
      const a = ctx!.createGain(); a.gain.value = AMP[i] * 0.5;
      o.connect(a); a.connect(g);
      o.start();
      return o;
    });
    // 板の上で砂が跳ねる音(高い所の細かい雑音)
    const src = loopNoise();
    const hbp = ctx.createBiquadFilter(); hbp.type = 'bandpass'; hbp.frequency.value = 5200; hbp.Q.value = 1.1;
    const hiss = ctx.createGain(); hiss.gain.value = 0;
    if (src) { src.connect(hbp); hbp.connect(hiss); }
    if (pan) { g.connect(pan); hiss.connect(pan); pan.connect(out); } else { g.connect(out); hiss.connect(out); }
    plate = { osc, g, hiss, hbp, pan, f0 };
  }
  // 節の形(n, m)から、板の高さ。D の短調の5音に寄せる(音楽として濁らないように)
  function plateF(n: number, m: number) {
    const semi = 12 * Math.log2(Math.sqrt(n * n + m * m) / Math.sqrt(13));
    const scale = [0, 3, 5, 7, 10, 12, 15, 17, 19, 22, 24];
    let best = 0;
    for (const s of scale) if (Math.abs(s - semi) < Math.abs(best - semi)) best = s;
    return 146.83 * Math.pow(2, best / 12);
  }
  // 音量の山: すぐ立ち上がって、dec 秒で消える。
  function env(g: GainNode, peak: number, dec: number, t: number) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dec);
  }
  function tone(type: OscillatorType, f: number, peak: number, dec: number, lp = 0) {
    if (!ctx || !out) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = f;
    const g = ctx.createGain();
    env(g, peak, dec, t);
    if (lp) {
      const f1 = ctx.createBiquadFilter();
      f1.type = 'lowpass';
      f1.frequency.value = lp;
      o.connect(f1);
      f1.connect(g);
    } else o.connect(g);
    g.connect(out);
    o.start(t);
    o.stop(t + dec + 0.03);
  }

  return {
    get on() {
      return on;
    },
    // 音を出す / 止める。出すときは、押した操作の中で呼ぶ。
    set(v: boolean) {
      on = v;
      if (v) {
        init();
        ctx?.resume();
      }
    },
    // 触れた: 短い「ポン」。level(0〜1)が高いほど、最大で半音4つぶん高い。
    pon(level: number) {
      if (!on) return;
      const f = 392 * Math.pow(2, (4 * Math.max(0, Math.min(1, level))) / 12);
      tone(Math.random() < 0.5 ? 'sine' : 'triangle', f, 0.16, 0.16);
      tone('sine', f * 2, 0.03, 0.08);
    },
    // はじいた: テープごとに決まった音程(5音の並び)。
    pluck(col: number) {
      if (!on) return;
      const semi = [0, 2, 4, 7, 9][((col % 5) + 5) % 5] + 12 * Math.floor(col / 5);
      const f = 196 * Math.pow(2, semi / 12);
      tone('triangle', f, 0.2, 0.34);
      tone('sine', f * 2.01, 0.05, 0.18);
    },
    // つかんだ: キースイッチのような短い雑音。
    click() {
      if (!on || !ctx || !out || !noise) return;
      const t = ctx.currentTime;
      const s = ctx.createBufferSource();
      s.buffer = noise;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 2300;
      bp.Q.value = 1.3;
      const g = ctx.createGain();
      env(g, 0.22, 0.035, t);
      s.connect(bp);
      bp.connect(g);
      g.connect(out);
      s.start(t, Math.random() * 0.5, 0.06);
    },
    // 引いた量(0〜1)。半音の段が変わったときだけ、階段の音を1つ鳴らす。
    climb(value: number) {
      if (!on) return;
      const step = Math.round(Math.max(0, Math.min(1, value)) * 24);
      if (step === lastStep) return;
      lastStep = step;
      if (!step) return;
      const f = 82 * Math.pow(2, step / 12);
      tone('square', f, 0.05, 0.07, Math.max(260, f * 3.2));
      tone('sine', f, 0.07, 0.09);
    },
    // なぞりの音: 毎フレーム呼ぶ。kind: 0 なし / 1 ペン / 2 墨 / 3 板。down: 指が触れている。v: なぞる速さ(0〜1)。x: 指の左右(0〜1)。vy: 縦の向き(-1 上〜1 下)。nm: 板の節の形
    rub(kind: number, down: boolean, v: number, x: number, vy: number, nm: number[]) {
      if (!on || !ctx) return;
      const t = ctx.currentTime;
      const pn = Math.max(-0.8, Math.min(0.8, (x - 0.5) * 1.4));
      if (kind === 1 || kind === 2 || pen) {
        ensurePen();
        if (pen) {
          const live = (kind === 1 || kind === 2) && down;
          const wet = kind === 2;
          const vv = Math.pow(Math.max(0, Math.min(1, v)), 1.15);
          const grit = 0.72 + 0.56 * Math.random(); // 紙の目: 毎フレーム ばらつく
          const gain = live ? (wet ? 0.03 + 0.34 * vv : 0.02 + 0.3 * vv) * grit : 0;
          pen.g.gain.setTargetAtTime(gain, t, live ? 0.018 : 0.07);
          const up = 1 - 0.15 * Math.max(-1, Math.min(1, vy)); // 上へ払うと、少し明るい
          pen.bp.frequency.setTargetAtTime((wet ? 260 + 1100 * vv : 700 + 3800 * vv) * up, t, 0.03);
          pen.bp.Q.setTargetAtTime(wet ? 1.4 : 0.8, t, 0.05);
          pen.lp.frequency.setTargetAtTime(wet ? 2200 : 9000, t, 0.05);
          if (pen.pan) pen.pan.pan.setTargetAtTime(pn, t, 0.03);
        }
      }
      if (kind === 3 || plate) {
        const f0 = plateF(nm[0] || 2, nm[1] || 3);
        ensurePlate(f0);
        if (plate) {
          const live = kind === 3 && down;
          const vv = Math.max(0, Math.min(1, v));
          if (Math.abs(plate.f0 - f0) > 0.5) { plate.f0 = f0; plate.osc.forEach((o, i) => o.frequency.setTargetAtTime(f0 * RATIO[i], t, 0.12)); }
          plate.g.gain.setTargetAtTime(live ? 0.015 + 0.2 * vv : 0, t, live ? 0.06 : 0.9); // 離すと、鳴り残って消える
          plate.hiss.gain.setTargetAtTime(live ? 0.07 * vv : 0, t, live ? 0.03 : 0.15);
          if (plate.pan) plate.pan.pan.setTargetAtTime(pn, t, 0.05);
        }
      }
    },
    // 押した瞬間: 紙(1・2)は軽く叩いた音、板(3)は指で弾いた音
    tap(kind: number, x: number, nm: number[]) {
      if (!on || !ctx || !out || !noise) return;
      const t = ctx.currentTime;
      if (kind === 3) {
        const f0 = plateF(nm[0] || 2, nm[1] || 3);
        RATIO.forEach((r, i) => tone(i === 0 ? 'triangle' : 'sine', f0 * r, 0.09 * AMP[i], 1.1 - i * 0.15));
        return;
      }
      if (kind !== 1 && kind !== 2) return;
      const s = ctx.createBufferSource();
      s.buffer = noise;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = kind === 2 ? 700 : 1500;
      const g = ctx.createGain();
      env(g, 0.2, 0.05, t);
      const pan = mkPan();
      s.connect(lp); lp.connect(g);
      if (pan) { pan.pan.value = Math.max(-0.8, Math.min(0.8, (x - 0.5) * 1.4)); g.connect(pan); pan.connect(out); } else g.connect(out);
      s.start(t, Math.random() * 0.5, 0.08);
    },
    // 確認用(?sfxrec): 出ている音の流れ
    monitor() {
      return mon ? mon.stream : null;
    },
    dispose() {
      ctx?.close();
      ctx = null;
      pen = null;
      plate = null;
      on = false;
    },
  };
}
