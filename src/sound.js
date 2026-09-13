/*!
 * 拖拉机大赛 网页版 — 音效（全部由 WebAudio 现场合成，不含任何第三方素材）
 * Copyright (c) 2026 TractorCard Project. All rights reserved. 版权所有，保留一切权利。
 */
let actx = null;
const state = { sound: true, music: false };
let musicTimer = null, musicGain = null;

function ctx() {
  if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)();
  if (actx.state === 'suspended') actx.resume();
  return actx;
}

function tone(freq, dur, { type = 'triangle', gain = 0.14, at = 0, sweep = 0 } = {}) {
  const a = ctx(), t0 = a.currentTime + at;
  const osc = a.createOscillator(), g = a.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (sweep) osc.frequency.exponentialRampToValueAtTime(Math.max(40, freq + sweep), t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(a.destination);
  osc.start(t0); osc.stop(t0 + dur + 0.02);
}

function noise(dur, gain = 0.09) {
  const a = ctx(), n = Math.floor(a.sampleRate * dur);
  const buf = a.createBuffer(1, n, a.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n) ** 2;
  const src = a.createBufferSource(), g = a.createGain(), f = a.createBiquadFilter();
  src.buffer = buf; f.type = 'highpass'; f.frequency.value = 1600; g.gain.value = gain;
  src.connect(f).connect(g).connect(a.destination); src.start();
}

export const sfx = {
  setSound(on) { state.sound = on; },
  setMusic(on) { state.music = on; on ? startMusic() : stopMusic(); },
  get sound() { return state.sound; },
  get music() { return state.music; },
  deal()    { if (state.sound) noise(0.06, 0.05); },
  play()    { if (state.sound) { noise(0.08, 0.09); tone(420, 0.07, { gain: 0.06, sweep: -120 }); } },
  select()  { if (state.sound) tone(880, 0.04, { type: 'sine', gain: 0.05 }); },
  invalid() { if (state.sound) { tone(180, 0.16, { type: 'square', gain: 0.07, sweep: -60 }); } },
  win()     { if (state.sound) { tone(660, 0.12, { gain: 0.1 }); tone(880, 0.16, { gain: 0.1, at: 0.1 }); } },
  lose()    { if (state.sound) { tone(330, 0.14, { gain: 0.09 }); tone(247, 0.22, { gain: 0.09, at: 0.12 }); } },
  declare() { if (state.sound) { tone(523, 0.1, { gain: 0.1 }); tone(784, 0.14, { gain: 0.1, at: 0.09 }); } },
  /** 升级 / 被升级，对应原版的 upgrade / beupgraded 提示。 */
  upgrade(up) {
    if (!state.sound) return;
    const notes = up ? [523, 659, 784, 1047] : [784, 659, 523, 392];
    notes.forEach((f, i) => tone(f, 0.2, { gain: 0.11, at: i * 0.13 }));
  },
};

/* 轻柔的循环背景音（程序生成的五声音阶琶音）。 */
const SCALE = [261.63, 293.66, 329.63, 392.0, 440.0, 523.25, 587.33, 659.25];
function startMusic() {
  stopMusic();
  const a = ctx();
  musicGain = a.createGain(); musicGain.gain.value = 0.035; musicGain.connect(a.destination);
  let step = 0;
  const tick = () => {
    if (!state.music) return;
    const f = SCALE[(step * 3 + (step % 5)) % SCALE.length] / (step % 8 < 4 ? 1 : 2);
    const t0 = a.currentTime;
    const osc = a.createOscillator(), g = a.createGain();
    osc.type = 'sine'; osc.frequency.value = f;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(1, t0 + 0.08);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.1);
    osc.connect(g).connect(musicGain); osc.start(t0); osc.stop(t0 + 1.2);
    step++;
  };
  tick();
  musicTimer = setInterval(tick, 620);
}
function stopMusic() {
  if (musicTimer) { clearInterval(musicTimer); musicTimer = null; }
  if (musicGain) { try { musicGain.disconnect(); } catch {} musicGain = null; }
}
