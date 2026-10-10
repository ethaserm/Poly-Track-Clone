// Procedural sound: synthesised engine, tyre squeal, wind and UI blips (Web Audio API).

const GEARS = [0, 13, 25, 37, 50, 64, 80];

export class AudioFx {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.volume = 0.6;
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
    this.master.gain.value = this.enabled ? this.volume : 0;
    this.master.connect(ctx.destination);

    // Shared noise buffer.
    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return true;
  }

  setEnabled(on) {
    this.enabled = on;
    if (this.master) this.master.gain.setTargetAtTime(on ? this.volume : 0, this.ctx.currentTime, 0.05);
  }

  setVolume(v) {
    this.volume = v;
    if (this.master && this.enabled) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }

  startEngine() {
    if (!this.ensure() || this.engineOn) return;
    const ctx = this.ctx;
    this.engineOn = true;
    const out = ctx.createGain();
    out.gain.value = 0;
    out.connect(this.master);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 800;
    filter.Q.value = 2;
    filter.connect(out);
    const o1 = ctx.createOscillator();
    o1.type = 'sawtooth';
    const o2 = ctx.createOscillator();
    o2.type = 'square';
    const g2 = ctx.createGain();
    g2.gain.value = 0.35;
    o1.connect(filter);
    o2.connect(g2).connect(filter);
    o1.start();
    o2.start();

    const skidSrc = ctx.createBufferSource();
    skidSrc.buffer = this.noise;
    skidSrc.loop = true;
    const skidFilter = ctx.createBiquadFilter();
    skidFilter.type = 'bandpass';
    skidFilter.frequency.value = 1400;
    skidFilter.Q.value = 3;
    const skidGain = ctx.createGain();
    skidGain.gain.value = 0;
    skidSrc.connect(skidFilter).connect(skidGain).connect(this.master);
    skidSrc.start();

    const windSrc = ctx.createBufferSource();
    windSrc.buffer = this.noise;
    windSrc.loop = true;
    const windFilter = ctx.createBiquadFilter();
    windFilter.type = 'lowpass';
    windFilter.frequency.value = 500;
    const windGain = ctx.createGain();
    windGain.gain.value = 0;
    windSrc.connect(windFilter).connect(windGain).connect(this.master);
    windSrc.start();

    this.engine = { out, filter, o1, o2, skidGain, windGain, windFilter, nodes: [o1, o2, skidSrc, windSrc] };
  }

  stopEngine() {
    if (!this.engineOn) return;
    this.engineOn = false;
    const e = this.engine;
    const t = this.ctx.currentTime;
    e.out.gain.setTargetAtTime(0, t, 0.05);
    e.skidGain.gain.setTargetAtTime(0, t, 0.05);
    e.windGain.gain.setTargetAtTime(0, t, 0.05);
    for (const n of e.nodes) n.stop(t + 0.3);
    this.engine = null;
  }

  updateEngine({ speed, throttle, grounded, slip }) {
    if (!this.engineOn) return;
    const e = this.engine;
    const t = this.ctx.currentTime;
    let gear = 0;
    while (gear < GEARS.length - 2 && speed > GEARS[gear + 1]) gear++;
    const lo = GEARS[gear];
    const hi = GEARS[gear + 1];
    const frac = Math.min(1, Math.max(0, (speed - lo) / (hi - lo)));
    const freq = 62 + frac * 95 + gear * 9 + (grounded ? 0 : 20 * throttle);
    e.o1.frequency.setTargetAtTime(freq, t, 0.03);
    e.o2.frequency.setTargetAtTime(freq * 0.5, t, 0.03);
    e.filter.frequency.setTargetAtTime(500 + throttle * 1400 + speed * 8, t, 0.05);
    e.out.gain.setTargetAtTime(0.07 + throttle * 0.07, t, 0.05);
    const skid = grounded ? Math.min(1, Math.max(0, (slip - 2.5) / 7)) : 0;
    e.skidGain.gain.setTargetAtTime(skid * 0.18, t, 0.04);
    e.windGain.gain.setTargetAtTime(Math.min(0.12, speed * 0.0016), t, 0.1);
    e.windFilter.frequency.setTargetAtTime(300 + speed * 12, t, 0.1);
  }

  tone(freq, start, dur, type = 'sine', gain = 0.2) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.setValueAtTime(0, start);
    g.gain.linearRampToValueAtTime(gain, start + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, start + dur);
    o.connect(g).connect(this.master);
    o.start(start);
    o.stop(start + dur + 0.05);
  }

  checkpoint(faster = null) {
    if (!this.ensure()) return;
    const t = this.ctx.currentTime;
    const base = faster === false ? 660 : 880;
    this.tone(base, t, 0.15, 'triangle', 0.25);
    this.tone(base * 1.5, t + 0.08, 0.25, 'triangle', 0.25);
  }

  finish(medal = false) {
    if (!this.ensure()) return;
    const t = this.ctx.currentTime;
    const notes = medal ? [523, 659, 784, 1047, 1319] : [523, 659, 784, 1047];
    notes.forEach((f, i) => this.tone(f, t + i * 0.09, 0.4, 'triangle', 0.22));
  }

  respawn() {
    if (!this.ensure()) return;
    const t = this.ctx.currentTime;
    this.tone(440, t, 0.12, 'square', 0.08);
    this.tone(330, t + 0.06, 0.12, 'square', 0.08);
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
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 400 + strength * 40;
    const g = ctx.createGain();
    g.gain.setValueAtTime(Math.min(0.5, 0.05 + strength * 0.03), t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
    src.connect(f).connect(g).connect(this.master);
    src.start(t);
    src.stop(t + 0.3);
  }
}
