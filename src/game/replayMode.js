import * as THREE from 'three';
import { GHOST_HZ } from '../core/constants.js';
import { insideTrigger } from '../core/track.js';
import { ChaseCamera } from './chaseCamera.js';
import { FLAG_BOOST, FLAG_BRAKE, FLAG_REVERSE, sampleGhost } from './ghost.js';
import { UNITS, formatTime } from './hud.js';
import { TrackScene } from './trackScene.js';
import { escapeHtml, h } from './ui.js';

const CAMS = ['TV', 'Chase', 'Orbit', 'Overhead'];
const SPEEDS = [0.25, 0.5, 1, 2];

/** Plays back a recorded run with broadcast-style cameras and a scrub bar. */
export class ReplayMode {
  constructor(app, track, replay, onExit) {
    this.app = app;
    this.track = track;
    this.replay = replay;
    this.onExit = onExit;
    this.ts = new TrackScene(app, track);
    this.camera = this.ts.camera;
    this.car = this.ts.createPlayerCar();
    this.chase = new ChaseCamera(this.camera);
    this.t = 0;
    this.speedIdx = 2;
    this.playing = true;
    this.cam = 0;
    this.pos = new THREE.Vector3();
    this.quat = new THREE.Quaternion();
    this.duration = replay.time ?? replay.frames / GHOST_HZ;
    this.buildSpots();
    this.buildUI();
    this.passed = new Set();
    this.sample(0);
    this.chase.snap(this.pos, this.quat);
    this.ts.view.setStartLights('green');
    app.audio.playMusic('race');
    this._key = (e) => {
      if (e.target?.tagName === 'INPUT') return;
      const k = e.code;
      if (k === 'Space') {
        e.preventDefault();
        this.togglePlay();
      } else if (k === 'ArrowLeft') this.seek(this.t - 2);
      else if (k === 'ArrowRight') this.seek(this.t + 2);
      else if (k === 'BracketLeft') this.setSpeed(this.speedIdx - 1);
      else if (k === 'BracketRight') this.setSpeed(this.speedIdx + 1);
      else if (k === 'KeyC') this.setCam(this.cam + 1);
      else if (k === 'Home') this.seek(0);
      else if (k === 'Escape') this.exit();
    };
    window.addEventListener('keydown', this._key);
  }

  /** Trackside camera spots placed every ~65 m along the recorded path. */
  buildSpots() {
    const { data, stride, frames } = this.replay;
    const terrain = this.ts.compiled.terrain;
    this.spots = [];
    let dist = 0;
    let lastIdx = 0;
    let side = 1;
    for (let i = 1; i < frames; i++) {
      const a = (i - 1) * stride;
      const b = i * stride;
      dist += Math.hypot(data[b] - data[a], data[b + 1] - data[a + 1], data[b + 2] - data[a + 2]);
      if (dist >= 65 || i === frames - 1) {
        const mid = Math.min(frames - 1, Math.round((lastIdx + i) / 2) + 6);
        const o = mid * stride;
        const n = Math.min(frames - 1, mid + 3) * stride;
        let dx = data[n] - data[o];
        let dz = data[n + 2] - data[o + 2];
        const l = Math.hypot(dx, dz) || 1;
        dx /= l;
        dz /= l;
        const off = 13 + ((this.spots.length * 7) % 9);
        const x = data[o] + dz * off * side;
        const z = data[o + 2] - dx * off * side;
        const ground = terrain ? terrain.height(x, z) : 0;
        const y = Math.max(data[o + 1] + 2.5 + ((this.spots.length * 5) % 6), ground + 2.5);
        this.spots.push({ from: lastIdx, pos: new THREE.Vector3(x, y, z) });
        side = -side;
        lastIdx = i;
        dist = 0;
      }
    }
  }

  buildUI() {
    const r = this.replay;
    this.el = h(`
      <div class="replay-ui">
        <div class="replay-top">
          <span class="rp-badge">REPLAY</span>
          <span class="rp-label">${escapeHtml(r.label || 'Run')} · ${escapeHtml(this.track.name)}</span>
          <span class="rp-speedo"></span>
        </div>
        <div class="replay-bar">
          <button class="btn icon" data-a="play" title="Play / pause (Space)">❚❚</button>
          <span class="rp-time">0:00.000</span>
          <input class="rp-scrub" type="range" min="0" max="1000" step="1" value="0" aria-label="Replay position" />
          <span class="rp-total">${formatTime(this.duration)}</span>
          <div class="seg">${SPEEDS.map((s, i) => `<button class="btn ${i === this.speedIdx ? 'on' : ''}" data-speed="${i}">${s}×</button>`).join('')}</div>
          <button class="btn" data-a="cam" title="Camera (C)">📷 <b>${CAMS[this.cam]}</b></button>
          <button class="btn" data-a="exit" title="Exit (Esc)">Exit</button>
        </div>
      </div>`);
    this.app.uiRoot.appendChild(this.el);
    this.timeEl = this.el.querySelector('.rp-time');
    this.scrub = this.el.querySelector('.rp-scrub');
    this.playBtn = this.el.querySelector('[data-a="play"]');
    this.speedoEl = this.el.querySelector('.rp-speedo');
    this.el.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      this.app.audio.click();
      if (b.dataset.a === 'play') this.togglePlay();
      else if (b.dataset.a === 'cam') this.setCam(this.cam + 1);
      else if (b.dataset.a === 'exit') this.exit();
      else if (b.dataset.speed) this.setSpeed(Number(b.dataset.speed));
    });
    this.scrub.addEventListener('input', () => {
      this.seek((this.scrub.value / 1000) * this.duration);
      this.scrubbing = true;
    });
    this.scrub.addEventListener('change', () => (this.scrubbing = false));
  }

  togglePlay() {
    if (!this.playing && this.t >= this.duration - 1e-3) this.seek(0);
    this.playing = !this.playing;
    this.playBtn.textContent = this.playing ? '❚❚' : '▶';
  }

  seek(t) {
    this.t = Math.max(0, Math.min(this.duration, t));
    this.refreshGates();
    this.sample(0);
    this.chase.snap(this.pos, this.quat);
    this.ts.effects?.clear();
  }

  setSpeed(i) {
    this.speedIdx = Math.max(0, Math.min(SPEEDS.length - 1, i));
    this.el.querySelectorAll('[data-speed]').forEach((b) => b.classList.toggle('on', Number(b.dataset.speed) === this.speedIdx));
  }

  setCam(i) {
    this.cam = ((i % CAMS.length) + CAMS.length) % CAMS.length;
    this.el.querySelector('[data-a="cam"] b').textContent = CAMS[this.cam];
    this.chase.snap(this.pos, this.quat);
  }

  exit() {
    this.onExit ? this.onExit() : this.app.showMenu();
  }

  /** Re-light checkpoint gates the car has already passed at the current time. */
  refreshGates() {
    this.passed = new Set();
    this.ts.view.resetCheckpoints();
    const { data, stride } = this.replay;
    const last = Math.floor(this.t * GHOST_HZ);
    for (let i = 0; i <= last; i++) this.markGates(data[i * stride], data[i * stride + 1], data[i * stride + 2]);
  }

  markGates(x, y, z) {
    for (const trig of this.ts.compiled.triggers) {
      if (trig.kind !== 'checkpoint' || this.passed.has(trig.id)) continue;
      if (insideTrigger(trig, x, y, z)) {
        this.passed.add(trig.id);
        this.ts.view.setCheckpoint(trig.id, true);
      }
    }
  }

  sample(dt) {
    const s = sampleGhost(this.replay, this.t, this.pos, this.quat);
    if (this.passed) this.markGates(this.pos.x, this.pos.y, this.pos.z);
    this.car.setPose(this.pos, this.quat);
    this.car.animateWheels(s.steer, s.speed, dt);
    this.car.setLights(
      { brake: s.flags & FLAG_BRAKE ? 1 : 0, reverse: !!(s.flags & FLAG_REVERSE), boost: s.flags & FLAG_BOOST ? 1 : 0 },
      dt,
    );
    this.state = s;
  }

  updateCamera(dt) {
    const cam = this.camera;
    const speed = Math.abs(this.state.speed);
    if (this.cam === 0) {
      const frame = this.t * GHOST_HZ;
      let spot = this.spots[0];
      for (const s of this.spots) if (s.from <= frame) spot = s;
      if (!spot) return;
      cam.position.copy(spot.pos);
      cam.up.set(0, 1, 0);
      cam.lookAt(this.pos);
      const d = spot.pos.distanceTo(this.pos);
      const fov = THREE.MathUtils.clamp((2 * Math.atan(6 / Math.max(1, d)) * 180) / Math.PI, 7, 60);
      cam.fov += (fov - cam.fov) * Math.min(1, dt * 6 + (this._tvSpot !== spot ? 1 : 0));
      this._tvSpot = spot;
      cam.updateProjectionMatrix();
    } else if (this.cam === 1) {
      this.chase.update(dt, this.pos, this.quat, speed, true);
    } else if (this.cam === 2) {
      this.chase.updateOrbit(dt, this.pos, 10, 3.2);
    } else {
      cam.position.set(this.pos.x + 6, this.pos.y + 38, this.pos.z + 6);
      cam.up.set(0, 1, 0);
      cam.lookAt(this.pos);
      if (cam.fov !== 50) {
        cam.fov = 50;
        cam.updateProjectionMatrix();
      }
    }
  }

  frame(dt) {
    const step = dt * SPEEDS[this.speedIdx];
    if (this.playing && !this.scrubbing) {
      this.t += step;
      if (this.t >= this.duration) {
        this.t = this.duration;
        this.playing = false;
        this.playBtn.textContent = '↻';
      }
    }
    this.sample(this.playing ? step : 0);
    this.updateCamera(dt);
    this.ts.update(this.playing ? step : 0, this.pos);
    this.timeEl.textContent = formatTime(this.t);
    if (!this.scrubbing) this.scrub.value = String(Math.round((this.t / this.duration) * 1000));
    const u = UNITS[this.app.settings.units] || UNITS.kmh;
    this.speedoEl.textContent = `${Math.round(Math.abs(this.state.speed) * u.factor)} ${u.label}`;
    // Tick the effect systems so particles left over from seeking fade out.
    this.ts.effects?.smoke.update(dt, this.ts.particleScale());
    this.ts.render(dt);
  }

  resize(aspect) {
    this.ts.resize(aspect);
  }

  dispose() {
    window.removeEventListener('keydown', this._key);
    this.el.remove();
    this.ts.dispose();
  }
}
