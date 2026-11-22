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

export function makeSfx() {
  let ctx: AudioContext | null = null;
  let out: AudioNode | null = null;
  let noise: AudioBuffer | null = null;
  let on = false;
  let lastStep = 0;

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
    dispose() {
      ctx?.close();
      ctx = null;
      on = false;
    },
  };
}
