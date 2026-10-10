import { SURFACE } from '../core/constants.js';
import { gearState } from './hud.js';

// Procedural sound: a layered synthesised engine, tyre/surface noise, wind, scrapes,
// boost and landing effects, UI blips and a generative soundtrack (Web Audio API).

const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);

export class AudioFx {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.volume = 0.6;
    this.musicVolume = 0.35;
    this.engineOn = false;
  }

  /** Must be called from a user gesture at least once. */
  ensure() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return true;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    try {
      this.ctx = new AC();
    } catch {
      return false;
    }
    const ctx = this.ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.enabled ? 1 : 0;
    // Gentle bus compression keeps loud moments under control.
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.master.connect(comp).connect(ctx.destination);
    this.sfx = ctx.createGain();
    this.sfx.gain.value = this.volume;
    this.sfx.connect(this.master);
    this.musicBus = ctx.createGain();
    this.musicBus.gain.value = this.musicVolume;
    this.musicBus.connect(this.master);

    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    this.music = new Music(this);
    if (this.pendingMusic) this.music.start(this.pendingMusic);
    return true;
  }

  setEnabled(on) {
    this.enabled = on;
    if (this.master) this.master.gain.setTargetAtTime(on ? 1 : 0, this.ctx.currentTime, 0.05);
  }

  setVolume(v) {
    this.volume = v;
    if (this.sfx) this.sfx.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }

  setMusicVolume(v) {
    this.musicVolume = v;
    if (this.musicBus) this.musicBus.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }

  /** 'menu' | 'race' | null */
  playMusic(style) {
    this.pendingMusic = style;
    if (this.music) {
      if (style) this.music.start(style);
      else this.music.stop();
    }
  }

  noiseSource(loop = true) {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noise;
    s.loop = loop;
    return s;
  }

  // --- Engine & continuous layers -------------------------------------------------

  startEngine() {
    if (!this.ensure() || this.engineOn) return;
    const ctx = this.ctx;
    this.engineOn = true;
    const out = ctx.createGain();
    out.gain.value = 0;
    out.connect(this.sfx);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 800;
    filter.Q.value = 3;
    filter.connect(out);
    const osc = (type, gain) => {
      const o = ctx.createOscillator();
      o.type = type;
      const g = ctx.createGain();
      g.gain.value = gain;
      o.connect(g).connect(filter);
      o.start();
      return o;
    };
    const o1 = osc('sawtooth', 1);
    const o2 = osc('square', 0.35);
    const o3 = osc('triangle', 0.25);
    // Mechanical grit: noise band-passed around a multiple of the engine note.
    const grit = this.noiseSource();
    const gritFilter = ctx.createBiquadFilter();
    gritFilter.type = 'bandpass';
    gritFilter.Q.value = 5;
    const gritGain = ctx.createGain();
    gritGain.gain.value = 0;
    grit.connect(gritFilter).connect(gritGain).connect(out);
    grit.start();
    // Turbo whistle.
    const turbo = ctx.createOscillator();
    turbo.type = 'sine';
    const turboGain = ctx.createGain();
    turboGain.gain.value = 0;
    turbo.connect(turboGain).connect(this.sfx);
    turbo.start();

    const layer = (type, freq, q) => {
      const src = this.noiseSource();
      const f = ctx.createBiquadFilter();
      f.type = type;
      f.frequency.value = freq;
      f.Q.value = q;
      const g = ctx.createGain();
      g.gain.value = 0;
      src.connect(f).connect(g).connect(this.sfx);
      src.start();
      return { src, f, g };
    };
    const skid = layer('bandpass', 1500, 3.5);
    const gravel = layer('lowpass', 520, 0.8);
    const wind = layer('lowpass', 500, 0.5);
    const scrape = layer('bandpass', 2600, 6);
    const jet = layer('highpass', 2400, 0.7);

    this.engine = {
      out, filter, o1, o2, o3, gritFilter, gritGain, turbo, turboGain, skid, gravel, wind, scrape, jet,
      nodes: [o1, o2, o3, grit, turbo, skid.src, gravel.src, wind.src, scrape.src, jet.src],
      gear: 1, lastThrottle: 0, popUntil: 0, nextPop: 0, boost: 0, dip: 0,
    };
  }

  stopEngine() {
    if (!this.engineOn) return;
    this.engineOn = false;
    const e = this.engine;
    const t = this.ctx.currentTime;
    e.out.gain.setTargetAtTime(0, t, 0.05);
    for (const l of [e.skid, e.gravel, e.wind, e.scrape, e.jet]) l.g.gain.setTargetAtTime(0, t, 0.05);
    e.turboGain.gain.setTargetAtTime(0, t, 0.05);
    for (const n of e.nodes) n.stop(t + 0.3);
    this.engine = null;
  }

  /** state: { speed, throttle, grounded, slip, boost, scrape, surface } */
  updateEngine({ speed, throttle, grounded, slip, boost = 0, scrape = 0, surface = SURFACE.ROAD }) {
    if (!this.engineOn) return;
    const e = this.engine;
    const t = this.ctx.currentTime;
    const { gear, rpm } = gearState(speed);
    // Upshift: brief dip in volume, like a clutch kick.
    if (gear > e.gear) e.dip = t + 0.09;
    e.gear = gear;
    const free = grounded ? 0 : 0.25 * throttle; // engine revs up when the wheels leave the ground
    const r = Math.min(1, rpm + free);
    const freq = 58 + r * 105 + gear * 10;
    e.o1.frequency.setTargetAtTime(freq, t, 0.025);
    e.o2.frequency.setTargetAtTime(freq * 0.5, t, 0.025);
    e.o3.frequency.setTargetAtTime(freq * 2.01, t, 0.025);
    e.filter.frequency.setTargetAtTime(420 + throttle * 1500 + r * 900, t, 0.05);
    const dip = t < e.dip ? 0.35 : 1;
    e.out.gain.setTargetAtTime((0.055 + throttle * 0.075 + r * 0.02) * dip, t, 0.03);
    e.gritFilter.frequency.setTargetAtTime(freq * 4, t, 0.05);
    e.gritGain.gain.setTargetAtTime(0.05 + throttle * 0.12, t, 0.05);
    e.turbo.frequency.setTargetAtTime(1900 + r * 2600, t, 0.08);
    e.turboGain.gain.setTargetAtTime(throttle * r * 0.012, t, 0.1);

    // Backfire pops when lifting off at high revs.
    if (e.lastThrottle > 0.5 && throttle < 0.1 && r > 0.55 && speed > 15) e.popUntil = t + 0.45;
    e.lastThrottle = throttle;
    if (t < e.popUntil && t > e.nextPop) {
      this.pop(0.5 + Math.random() * 0.5);
      e.nextPop = t + 0.05 + Math.random() * 0.12;
    }

    // Tyres: squeal on tarmac, crunch on gravel / grass / snow / sand.
    const loose = surface === SURFACE.GRASS || surface === SURFACE.DIRT || surface === SURFACE.WATER;
    const squeal = grounded && !loose ? Math.min(1, Math.max(0, (slip - 2.5) / 7)) : 0;
    e.skid.g.gain.setTargetAtTime(squeal * 0.16, t, 0.04);
    e.skid.f.frequency.setTargetAtTime(1300 + slip * 30, t, 0.05);
    const crunch = grounded && loose ? Math.min(1, speed / 25) : 0;
    e.gravel.g.gain.setTargetAtTime(crunch * 0.22, t, 0.05);
    e.wind.g.gain.setTargetAtTime(Math.min(0.13, speed * 0.0017), t, 0.1);
    e.wind.f.frequency.setTargetAtTime(300 + speed * 12, t, 0.1);
    e.scrape.g.gain.setTargetAtTime(scrape > 2 ? Math.min(0.2, scrape * 0.012) : 0, t, 0.03);
    e.scrape.f.frequency.setTargetAtTime(2200 + Math.random() * 900, t, 0.02);

    // Boost: whoosh on entry and a jet hiss while it lasts.
    if (boost > 0.95 && e.boost < 0.5) this.whoosh();
    e.boost = boost;
    e.jet.g.gain.setTargetAtTime(boost * 0.07, t, 0.05);
  }

  // --- One-shots -------------------------------------------------------------------

  tone(freq, start, dur, type = 'sine', gain = 0.2, bus = this.sfx) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.setValueAtTime(0, start);
    g.gain.linearRampToValueAtTime(gain, start + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, start + dur);
    o.connect(g).connect(bus);
    o.start(start);
    o.stop(start + dur + 0.05);
  }

  noiseBurst({ start, dur, type = 'lowpass', freq = 800, q = 1, gain = 0.3, sweepTo = null }) {
    const ctx = this.ctx;
    const src = this.noiseSource(false);
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, start);
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, start + dur);
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(gain, start + Math.min(0.03, dur * 0.2));
    g.gain.exponentialRampToValueAtTime(0.001, start + dur);
    src.connect(f).connect(g).connect(this.sfx);
    src.start(start, Math.random());
    src.stop(start + dur + 0.05);
  }

  pop(strength = 1) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.noiseBurst({ start: t, dur: 0.07, type: 'lowpass', freq: 900, gain: 0.32 * strength });
    this.tone(70 + Math.random() * 30, t, 0.08, 'square', 0.08 * strength);
  }

  whoosh() {
    if (!this.ctx) return;
    this.noiseBurst({ start: this.ctx.currentTime, dur: 0.55, type: 'bandpass', freq: 400, q: 1.2, gain: 0.28, sweepTo: 3800 });
  }

  land(impact) {
    if (!this.ensure()) return;
    const t = this.ctx.currentTime;
    const k = Math.min(1, impact / 15);
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.frequency.setValueAtTime(110, t);
    o.frequency.exponentialRampToValueAtTime(38, t + 0.25);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.35 * k + 0.05, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
    o.connect(g).connect(this.sfx);
    o.start(t);
    o.stop(t + 0.4);
    this.noiseBurst({ start: t, dur: 0.22, freq: 600, gain: 0.2 * k + 0.03 });
  }

  checkpoint(faster = null) {
    if (!this.ensure()) return;
    const t = this.ctx.currentTime;
    const base = faster === false ? 660 : 880;
    this.tone(base, t, 0.15, 'triangle', 0.25);
    this.tone(base * 1.5, t + 0.08, 0.25, 'triangle', 0.25);
    if (faster) this.tone(base * 2, t + 0.16, 0.3, 'sine', 0.15);
  }

  finish(medal = false) {
    if (!this.ensure()) return;
    const t = this.ctx.currentTime;
    const notes = medal ? [523, 659, 784, 1047, 1319] : [523, 659, 784, 1047];
    notes.forEach((f, i) => this.tone(f, t + i * 0.09, 0.45, 'triangle', 0.22));
    if (medal) notes.forEach((f, i) => this.tone(f * 2, t + 0.5 + i * 0.06, 0.3, 'sine', 0.08));
    this.noiseBurst({ start: t, dur: 1.6, type: 'highpass', freq: 3000, gain: 0.06 }); // crowd-ish cheer
  }

  respawn() {
    if (!this.ensure()) return;
    const t = this.ctx.currentTime;
    this.tone(440, t, 0.12, 'square', 0.08);
    this.tone(660, t + 0.06, 0.16, 'square', 0.08);
  }

  click() {
    if (!this.ensure()) return;
    this.tone(1200, this.ctx.currentTime, 0.05, 'triangle', 0.08);
  }

  missing() {
    if (!this.ensure()) return;
    const t = this.ctx.currentTime;
    this.tone(220, t, 0.2, 'sawtooth', 0.12);
    this.tone(196, t + 0.15, 0.3, 'sawtooth', 0.12);
  }

  impact(strength) {
    if (!this.ensure()) return;
    const t = this.ctx.currentTime;
    this.noiseBurst({ start: t, dur: 0.25, freq: 400 + strength * 40, gain: Math.min(0.5, 0.05 + strength * 0.03) });
    this.tone(90, t, 0.15, 'square', Math.min(0.12, strength * 0.008));
  }
}

// ---------------------------------------------------------------------------------------
// Generative soundtrack: a four-chord synthwave loop with bass, pads, arpeggio and drums.
// Notes are scheduled slightly ahead of time with a look-ahead timer.
// ---------------------------------------------------------------------------------------

const PROGRESSIONS = [
  // A minor: Am F C G
  [
    [57, 60, 64],
    [53, 57, 60],
    [48, 52, 55],
    [55, 59, 62],
  ],
  // D minor: Dm Bb F C
  [
    [50, 53, 57],
    [46, 50, 53],
    [53, 57, 60],
    [48, 52, 55],
  ],
];

class Music {
  constructor(fx) {
    this.fx = fx;
    this.ctx = fx.ctx;
    this.style = null;
    this.timer = null;
    this.out = this.ctx.createGain();
    this.out.gain.value = 0;
    // Simple stereo-ish delay for space.
    const delay = this.ctx.createDelay(1);
    delay.delayTime.value = 0.33;
    const fb = this.ctx.createGain();
    fb.gain.value = 0.28;
    const wet = this.ctx.createGain();
    wet.gain.value = 0.25;
    this.out.connect(fx.musicBus);
    this.out.connect(delay);
    delay.connect(fb).connect(delay);
    delay.connect(wet).connect(fx.musicBus);
  }

  start(style) {
    if (this.style === style && this.timer) return;
    this.style = style;
    this.bpm = style === 'race' ? 124 : 104;
    this.prog = PROGRESSIONS[style === 'race' ? 1 : 0];
    this.step = 0;
    this.next = this.ctx.currentTime + 0.1;
    this.out.gain.cancelScheduledValues(this.ctx.currentTime);
    this.out.gain.setTargetAtTime(style === 'race' ? 0.55 : 0.8, this.ctx.currentTime, 0.6);
    if (!this.timer) this.timer = setInterval(() => this.schedule(), 30);
  }

  stop() {
    if (!this.timer) return;
    this.out.gain.setTargetAtTime(0, this.ctx.currentTime, 0.3);
    const timer = this.timer;
    this.timer = null;
    setTimeout(() => {
      if (!this.timer) clearInterval(timer);
    }, 1200);
    this.style = null;
  }

  schedule() {
    if (!this.style) return;
    const sixteenth = 60 / this.bpm / 4;
    while (this.next < this.ctx.currentTime + 0.15) {
      this.playStep(this.step, this.next, sixteenth);
      this.next += sixteenth;
      this.step = (this.step + 1) % 256;
    }
  }

  voice(freq, start, dur, { type = 'sawtooth', gain = 0.1, cutoff = 1800, attack = 0.01, detune = 0 } = {}) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    o.detune.value = detune;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = cutoff;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(gain, start + attack);
    g.gain.setValueAtTime(gain, start + Math.max(attack, dur * 0.6));
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    o.connect(f).connect(g).connect(this.out);
    o.start(start);
    o.stop(start + dur + 0.05);
  }

  drum(kind, start) {
    const ctx = this.ctx;
    if (kind === 'kick') {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.setValueAtTime(140, start);
      o.frequency.exponentialRampToValueAtTime(42, start + 0.12);
      g.gain.setValueAtTime(0.0001, start);
      g.gain.exponentialRampToValueAtTime(0.5, start + 0.005);
      g.gain.exponentialRampToValueAtTime(0.0001, start + 0.28);
      o.connect(g).connect(this.out);
      o.start(start);
      o.stop(start + 0.3);
      return;
    }
    const src = this.fx.noiseSource(false);
    const f = ctx.createBiquadFilter();
    f.type = kind === 'hat' ? 'highpass' : 'bandpass';
    f.frequency.value = kind === 'hat' ? 7000 : 1800;
    const g = ctx.createGain();
    const dur = kind === 'hat' ? 0.04 : 0.16;
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(kind === 'hat' ? 0.07 : 0.22, start + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    src.connect(f).connect(g).connect(this.out);
    src.start(start, Math.random());
    src.stop(start + dur + 0.02);
  }

  playStep(step, t, s16) {
    const bar = Math.floor(step / 16);
    const inBar = step % 16;
    const chord = this.prog[bar % 4];
    const race = this.style === 'race';
    // Pads on each bar.
    if (inBar === 0) {
      for (const n of chord) {
        this.voice(midi(n), t, s16 * 16, { gain: race ? 0.022 : 0.032, cutoff: 1400, attack: 0.4, detune: -7 });
        this.voice(midi(n), t, s16 * 16, { gain: race ? 0.022 : 0.032, cutoff: 1400, attack: 0.4, detune: 7 });
      }
    }
    // Bass: driving eighths.
    if (inBar % 2 === 0) {
      const root = chord[0] - 24;
      const n = inBar % 8 === 6 ? root + 12 : root;
      this.voice(midi(n), t, s16 * 1.8, { gain: 0.09, cutoff: 600 + (race ? 400 : 0) });
    }
    // Arpeggio.
    if (race || bar % 2 === 1) {
      const arp = [0, 1, 2, 1, 0, 2, 1, 2];
      const n = chord[arp[inBar % 8]] + (inBar >= 8 ? 12 : 0) + 12;
      this.voice(midi(n), t, s16 * 0.9, { type: 'square', gain: race ? 0.028 : 0.02, cutoff: 3200 });
    }
    // Drums.
    if (race) {
      if (inBar % 4 === 0) this.drum('kick', t);
      if (inBar === 4 || inBar === 12) this.drum('snare', t);
      if (inBar % 2 === 1) this.drum('hat', t);
    } else if (inBar === 0 || inBar === 8) {
      this.drum('kick', t);
    }
  }
}
