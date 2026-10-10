import * as THREE from 'three';
import { SURFACE } from '../core/constants.js';
import { ParticleSystem, SkidMarks } from './particles.js';

const DUST = {
  summer: [0.52, 0.44, 0.3],
  winter: [0.96, 0.97, 1.0],
  desert: [0.9, 0.77, 0.56],
};
const TRACKS = {
  summer: [0.28, 0.36, 0.18],
  winter: [0.74, 0.79, 0.86],
  desert: [0.68, 0.55, 0.37],
};
const CONFETTI = [
  [1, 0.82, 0.25],
  [0.25, 0.75, 1],
  [1, 0.35, 0.35],
  [0.4, 0.9, 0.45],
  [0.85, 0.45, 1],
  [1, 1, 1],
];

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const rnd = (a = 1) => (Math.random() * 2 - 1) * a;

/**
 * Turns physics state into visual effects: tyre smoke, off-road dust, skid marks,
 * wall sparks, boost exhaust, landing puffs, checkpoint/finish/respawn bursts.
 */
export class Effects {
  constructor(scene, { env = 'summer', quality = 1, skidmarks = true } = {}) {
    this.scene = scene;
    this.q = quality;
    this.env = env;
    this.smoke = new ParticleSystem(Math.round(1400 * quality), { texture: 'soft' });
    this.glow = new ParticleSystem(Math.round(1400 * quality), { additive: true, texture: 'spark' });
    this.confetti = new ParticleSystem(Math.round(700 * quality), { texture: 'square' });
    scene.add(this.smoke.points, this.glow.points, this.confetti.points);
    this.skids = skidmarks ? new SkidMarks(Math.round(2600 * Math.max(0.5, quality))) : null;
    if (this.skids) scene.add(this.skids.mesh);
    this.acc = new Map();
    this.lastLandings = 0;
    this.boostGlow = 0;
  }

  /** Emit `rate` particles per second for a named source (fractional accumulation). */
  rate(key, perSecond, dt, fn) {
    let a = (this.acc.get(key) || 0) + perSecond * this.q * dt;
    while (a >= 1) {
      fn();
      a -= 1;
    }
    this.acc.set(key, a);
  }

  /**
   * Per-frame update from the car. state: { throttle, brake, boost (0..1), camera, scale }
   * Returns { landing: impact speed or 0, scrape: speed } for camera shake / audio.
   */
  update(dt, car, state) {
    const out = { landing: 0, scrape: car.scrape };
    const speed = car.speed;
    const dust = DUST[this.env] || DUST.summer;
    const tracks = TRACKS[this.env] || TRACKS.summer;

    car.wheels.forEach((w, i) => {
      const id = 'w' + i;
      if (!w.contact) {
        this.skids?.lift(id);
        return;
      }
      const onGround = w.surface === SURFACE.GRASS;
      const p = w.point;
      // Tyre marks: dark rubber on tarmac when sliding, ruts in grass/snow/sand while rolling.
      if (this.skids) {
        const slide = Math.min(1, Math.max(0, (w.slip - 3) / 6));
        const brakeMark = state.brake > 0 && speed > 6 ? 0.5 : 0;
        if (onGround && speed > 2) {
          this.skids.add(id, p.x, p.y, p.z, w.normal.x, w.normal.y, w.normal.z, w.sd.x, w.sd.y, w.sd.z, 0.32, tracks[0], tracks[1], tracks[2], 0.45);
        } else if (!onGround && (slide > 0 || brakeMark)) {
          this.skids.add(id, p.x, p.y, p.z, w.normal.x, w.normal.y, w.normal.z, w.sd.x, w.sd.y, w.sd.z, 0.3, 0.06, 0.06, 0.07, Math.max(slide, brakeMark) * 0.6);
        } else {
          this.skids.lift(id);
        }
      }
      // Tyre smoke on tarmac.
      if (!onGround && w.slip > 3.5) {
        this.rate('smoke' + i, (w.slip - 3.5) * 7, dt, () =>
          this.smoke.emit({
            x: p.x + rnd(0.2), y: p.y + 0.15, z: p.z + rnd(0.2),
            vx: car.vel.x * 0.15 + rnd(1.2), vy: 0.8 + Math.random(), vz: car.vel.z * 0.15 + rnd(1.2),
            life: 1.2 + Math.random() * 0.9, size: 0.7, size1: 3.6,
            r: 0.86, g: 0.87, b: 0.9, a: 0.32, a1: 0, grav: -0.4, drag: 1.6, spin: rnd(1),
          }),
        );
      }
      // Off-road dust / snow / sand.
      if (onGround && speed > 3 && !w.front) {
        this.rate('dust' + i, Math.min(60, speed * 1.4), dt, () =>
          this.smoke.emit({
            x: p.x + rnd(0.3), y: p.y + 0.1, z: p.z + rnd(0.3),
            vx: -car.vel.x * 0.05 + rnd(1.5), vy: 1 + Math.random() * 2, vz: -car.vel.z * 0.05 + rnd(1.5),
            life: 0.9 + Math.random() * 0.8, size: 0.5, size1: 2.6,
            r: dust[0] * (0.9 + Math.random() * 0.2), g: dust[1], b: dust[2], a: 0.55, a1: 0, grav: 1.5, drag: 1.8,
          }),
        );
      }
    });

    // Sparks (or dirt) where the body slides along walls or the ground.
    if (car.scrape > 2.5) {
      const sp = car.scrapePoint;
      const isGround = car.scrapeSurface === SURFACE.GRASS;
      this.rate('scrape', Math.min(160, car.scrape * 9), dt, () => {
        if (isGround) {
          this.smoke.emit({
            x: sp.x, y: sp.y + 0.1, z: sp.z, vx: rnd(2), vy: 1.5 + Math.random() * 2, vz: rnd(2),
            life: 0.8, size: 0.6, size1: 2.2, r: dust[0], g: dust[1], b: dust[2], a: 0.6, a1: 0, grav: 2, drag: 2,
          });
        } else {
          this.glow.emit({
            x: sp.x, y: sp.y, z: sp.z,
            vx: car.vel.x * 0.6 + rnd(4), vy: 1.5 + Math.random() * 4, vz: car.vel.z * 0.6 + rnd(4),
            life: 0.25 + Math.random() * 0.35, size: 0.16, size1: 0.05,
            r: 1, g: 0.62 + Math.random() * 0.3, b: 0.25, a: 1, a1: 0.4, grav: 18, drag: 0.6,
          });
        }
      });
    }

    // Exhaust: boost flames and blue afterburn particles; little puffs when pulling away.
    const q = car.quat;
    const boost = state.boost || 0;
    for (const x of [0.3, -0.3]) {
      _v.set(x, -0.33, -2.35).applyQuaternion(q).add(car.pos);
      _w.set(0, 0, -1).applyQuaternion(q);
      if (boost > 0.05) {
        this.rate('flame' + x, 70 * boost, dt, () =>
          this.glow.emit({
            x: _v.x, y: _v.y, z: _v.z,
            vx: car.vel.x * 0.9 + _w.x * 6 + rnd(0.6), vy: car.vel.y * 0.9 + _w.y * 6 + rnd(0.6), vz: car.vel.z * 0.9 + _w.z * 6 + rnd(0.6),
            life: 0.18 + Math.random() * 0.12, size: 0.5, size1: 0.15,
            r: 0.35, g: 0.6, b: 1, a: 0.9, a1: 0, drag: 3,
          }),
        );
      } else if (state.throttle > 0 && speed < 10 && car.grounded) {
        this.rate('puff' + x, 9, dt, () =>
          this.smoke.emit({
            x: _v.x, y: _v.y, z: _v.z, vx: _w.x * 1.5 + rnd(0.3), vy: 0.4, vz: _w.z * 1.5 + rnd(0.3),
            life: 0.8, size: 0.2, size1: 0.9, r: 0.55, g: 0.56, b: 0.6, a: 0.22, a1: 0, grav: -0.3, drag: 1.5,
          }),
        );
      }
    }

    // Landing after a jump.
    if (car.landings !== this.lastLandings) {
      this.lastLandings = car.landings;
      if (car.landImpact > 3) {
        out.landing = car.landImpact;
        const onGround = car.wheels.some((w) => w.contact && w.surface === SURFACE.GRASS);
        const c = onGround ? dust : [0.8, 0.8, 0.82];
        const n = Math.min(40, 10 + car.landImpact * 2);
        for (let i = 0; i < n * this.q; i++) {
          const a = (i / n) * Math.PI * 2;
          const s = 3 + Math.random() * 3 + car.landImpact * 0.2;
          this.smoke.emit({
            x: car.pos.x + Math.cos(a) * 1.2, y: car.pos.y - 0.7, z: car.pos.z + Math.sin(a) * 1.8,
            vx: Math.cos(a) * s + car.vel.x * 0.3, vy: 0.6 + Math.random(), vz: Math.sin(a) * s + car.vel.z * 0.3,
            life: 0.9 + Math.random() * 0.6, size: 0.8, size1: 3.2, r: c[0], g: c[1], b: c[2], a: 0.45, a1: 0, drag: 2.5, grav: -0.2,
          });
        }
      }
    }

    this.smoke.update(dt, state.scale);
    this.glow.update(dt, state.scale);
    this.confetti.update(dt, state.scale);
    return out;
  }

  /** One-shot bursts. kind: 'checkpoint' | 'finish' | 'respawn' | 'boost' */
  burst(kind, pos, opts = {}) {
    const q = this.q;
    if (kind === 'checkpoint') {
      const col = opts.color || [0.3, 0.85, 1];
      for (let i = 0; i < 70 * q; i++) {
        const a = Math.random() * Math.PI * 2;
        const s = 4 + Math.random() * 8;
        this.glow.emit({
          x: pos.x + rnd(4), y: pos.y + Math.random() * 5, z: pos.z + rnd(4),
          vx: Math.cos(a) * s, vy: rnd(4) + 2, vz: Math.sin(a) * s,
          life: 0.5 + Math.random() * 0.6, size: 0.45, size1: 0.05, r: col[0], g: col[1], b: col[2], a: 1, a1: 0, drag: 2, grav: 2,
        });
      }
    } else if (kind === 'finish') {
      for (let i = 0; i < 420 * q; i++) {
        const c = CONFETTI[i % CONFETTI.length];
        this.confetti.emit({
          x: pos.x + rnd(5), y: pos.y + 6 + Math.random() * 1.5, z: pos.z + rnd(1),
          vx: rnd(7), vy: 3 + Math.random() * 8, vz: rnd(7),
          life: 3 + Math.random() * 2.5, size: 0.42, size1: 0.42, r: c[0], g: c[1], b: c[2], a: 1, a1: 0.8,
          grav: 4, drag: 1.4, spin: rnd(9),
        });
      }
      this.burst('checkpoint', pos, { color: [1, 0.85, 0.3] });
    } else if (kind === 'respawn') {
      for (let i = 0; i < 50 * q; i++) {
        const a = Math.random() * Math.PI * 2;
        this.glow.emit({
          x: pos.x + Math.cos(a) * 1.4, y: pos.y - 0.5 + Math.random() * 2, z: pos.z + Math.sin(a) * 2.2,
          vx: Math.cos(a) * 0.5, vy: 2 + Math.random() * 3, vz: Math.sin(a) * 0.5,
          life: 0.6 + Math.random() * 0.5, size: 0.35, size1: 0.02, r: 0.5, g: 0.85, b: 1, a: 1, a1: 0, drag: 1,
        });
      }
    }
  }

  clear() {
    this.smoke.clear();
    this.glow.clear();
    this.confetti.clear();
    this.skids?.clear();
    this.acc.clear();
  }

  dispose() {
    this.smoke.dispose();
    this.glow.dispose();
    this.confetti.dispose();
    this.skids?.dispose();
  }
}

/** Streaks rushing past the camera at high speed. Attach `lines` to the camera. */
export class SpeedLines {
  constructor(count = 46) {
    this.count = count;
    this.data = Array.from({ length: count }, () => this.spawn({}, true));
    this.positions = new Float32Array(count * 6);
    const g = new THREE.BufferGeometry();
    this.attr = new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.attr);
    this.material = new THREE.LineBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
    });
    this.lines = new THREE.LineSegments(g, this.material);
    this.lines.frustumCulled = false;
    this.lines.renderOrder = 10;
  }

  spawn(d, initial = false) {
    const a = Math.random() * Math.PI * 2;
    const r = 2.2 + Math.random() * 3.5;
    d.x = Math.cos(a) * r;
    d.y = Math.sin(a) * r * 0.65;
    d.z = initial ? -Math.random() * 40 : -40 - Math.random() * 10;
    return d;
  }

  update(dt, speed) {
    const k = Math.min(1, Math.max(0, (speed - 42) / 30));
    this.material.opacity = k * 0.5;
    this.lines.visible = k > 0;
    if (!k) return;
    const len = 1 + speed * 0.06;
    this.data.forEach((d, i) => {
      d.z += speed * 1.4 * dt;
      if (d.z > 1) this.spawn(d);
      const o = i * 6;
      this.positions[o] = d.x;
      this.positions[o + 1] = d.y;
      this.positions[o + 2] = d.z;
      this.positions[o + 3] = d.x;
      this.positions[o + 4] = d.y;
      this.positions[o + 5] = d.z - len;
    });
    this.attr.needsUpdate = true;
  }

  dispose() {
    this.lines.geometry.dispose();
    this.material.dispose();
  }
}
