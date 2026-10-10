import { Matrix3, Matrix4, Quaternion, Vector3 } from 'three';
import { SURFACE } from './constants.js';

/**
 * Arcade raycast-vehicle physics.
 * Unit mass rigid body; four suspension rays; tyre friction solved with sequential impulses;
 * a handful of spheres for body collisions. Car local axes: +Z forward, +Y up, +X left.
 */
export const CAR = {
  gravity: 20,
  wheels: [
    { x: 0.82, z: 1.3, front: true },
    { x: -0.82, z: 1.3, front: true },
    { x: 0.82, z: -1.32, front: false },
    { x: -0.82, z: -1.32, front: false },
  ],
  restLength: 0.5,
  wheelRadius: 0.38,
  spring: 150,
  damper: 10,
  bumpStart: 0.3,
  bumpSpring: 1500,
  inertia: [1.7, 2.0, 0.95],
  engineAccel: 17,
  topSpeed: 82,
  reverseAccel: 9,
  reverseMax: 14,
  brakeAccel: 32,
  coastDecel: 2.2,
  airDrag: 0.0011,
  downforce: 0.012,
  boostAccel: 48,
  maxSteerLow: 0.55,
  maxSteerHigh: 0.13,
  steerFalloffSpeed: 55,
  gripFront: 1.75,
  gripRear: 1.65,
  wallFriction: 0.2,
  bodySpheres: [
    [0, 0.0, 1.45, 0.5],
    [0, 0.05, 0, 0.55],
    [0, 0.05, -1.45, 0.5],
    [0.55, 0.05, 1.5, 0.4],
    [-0.55, 0.05, 1.5, 0.4],
    [0.55, 0.05, -1.5, 0.4],
    [-0.55, 0.05, -1.5, 0.4],
    [0, 0.45, -0.3, 0.45],
  ],
};

const SURFACE_PROPS = {
  [SURFACE.ROAD]: { grip: 1, engine: 1, drag: 0 },
  [SURFACE.BOOST]: { grip: 1, engine: 1, drag: 0 },
  [SURFACE.WALL]: { grip: 0.9, engine: 1, drag: 0 },
  [SURFACE.GRASS]: { grip: 0.62, engine: 0.55, drag: 0.9 },
};

const _v1 = new Vector3();
const _v2 = new Vector3();
const _v3 = new Vector3();
const _m4 = new Matrix4();
const _rot = new Matrix3();
const _rotT = new Matrix3();
const _q = new Quaternion();
const _ea = new Vector3();
const _eb = new Vector3();
const _ia = new Vector3();
const _torque = new Vector3();
const _r = new Vector3();
const _tdir = new Vector3();
const _invD = new Matrix3().set(
  1 / CAR.inertia[0], 0, 0,
  0, 1 / CAR.inertia[1], 0,
  0, 0, 1 / CAR.inertia[2],
);

export class CarPhysics {
  constructor(world) {
    this.world = world;
    this.pos = new Vector3();
    this.vel = new Vector3();
    this.quat = new Quaternion();
    this.angVel = new Vector3();
    this.invInertia = new Matrix3();
    this.up = new Vector3(0, 1, 0);
    this.fwd = new Vector3(0, 0, 1);
    this.left = new Vector3(1, 0, 0);
    this.steerAngle = 0;
    this.wheels = CAR.wheels.map((w) => ({
      ...w,
      contact: false,
      comp: 0,
      prevComp: 0,
      load: 0,
      spin: 0,
      surface: SURFACE.ROAD,
      point: new Vector3(),
      normal: new Vector3(),
      fw: new Vector3(),
      sd: new Vector3(),
      r: new Vector3(),
      jLat: 0,
      jLong: 0,
      slip: 0,
    }));
    this.grounded = 0;
    this.onBoost = false;
    this.slip = 0;
    this.wallHit = 0;
    this._hit = {};
    this._contacts = [];
    this._pool = [];
  }

  reset(pos, quat, vel = null) {
    this.pos.copy(pos);
    this.quat.copy(quat);
    this.vel.set(0, 0, 0);
    if (vel) this.vel.copy(vel);
    this.angVel.set(0, 0, 0);
    this.steerAngle = 0;
    for (const w of this.wheels) {
      w.contact = false;
      w.comp = 0;
      w.prevComp = 0;
      w.load = 0;
    }
  }

  get speed() {
    return this.vel.length();
  }

  get forwardSpeed() {
    return this.vel.dot(this.fwd);
  }

  updateBasis() {
    this.up.set(0, 1, 0).applyQuaternion(this.quat);
    this.fwd.set(0, 0, 1).applyQuaternion(this.quat);
    this.left.set(1, 0, 0).applyQuaternion(this.quat);
    _m4.makeRotationFromQuaternion(this.quat);
    _rot.setFromMatrix4(_m4);
    _rotT.copy(_rot).transpose();
    this.invInertia.copy(_rot).multiply(_invD).multiply(_rotT);
  }

  /** Effective inverse mass along direction n at offset r. */
  effMass(r, n) {
    _ea.crossVectors(r, n).applyMatrix3(this.invInertia);
    _eb.crossVectors(_ea, r);
    return 1 + _eb.dot(n);
  }

  applyImpulse(r, dir, j) {
    this.vel.addScaledVector(dir, j);
    _ia.crossVectors(r, dir).multiplyScalar(j).applyMatrix3(this.invInertia);
    this.angVel.add(_ia);
  }

  pointVelocity(r, out) {
    return out.crossVectors(this.angVel, r).add(this.vel);
  }

  /**
   * Advances the simulation by dt.
   * input: { throttle 0..1, brake 0..1, steer -1..1 (positive = left) }
   */
  step(input, dt) {
    const world = this.world;
    this.updateBasis();
    const up = this.up;
    const fwd = this.fwd;
    const left = this.left;
    const fwdSpeed = this.vel.dot(fwd);
    const speed = this.vel.length();

    // Steering: speed-sensitive maximum angle, smoothed.
    const k = Math.min(1, Math.max(0, fwdSpeed / CAR.steerFalloffSpeed));
    const maxSteer = CAR.maxSteerLow + (CAR.maxSteerHigh - CAR.maxSteerLow) * k;
    const target = input.steer * maxSteer;
    this.steerAngle += (target - this.steerAngle) * Math.min(1, dt * 14);

    const force = _v3.set(0, -CAR.gravity, 0);
    const torque = _torque.set(0, 0, 0);
    const hit = this._hit;
    const rayLen = CAR.restLength + CAR.wheelRadius;
    this.grounded = 0;
    this.onBoost = false;

    // --- Suspension -------------------------------------------------------
    for (const w of this.wheels) {
      w.r.set(w.x, 0, w.z).applyQuaternion(this.quat);
      const mx = this.pos.x + w.r.x;
      const my = this.pos.y + w.r.y;
      const mz = this.pos.z + w.r.z;
      if (world.raycast(mx, my, mz, -up.x, -up.y, -up.z, rayLen, hit, SURFACE.WALL)) {
        const comp = rayLen - hit.dist;
        const compVel = (comp - w.prevComp) / dt;
        w.prevComp = comp;
        w.comp = comp;
        let f = CAR.spring * comp + CAR.damper * compVel;
        if (comp > CAR.bumpStart) f += CAR.bumpSpring * (comp - CAR.bumpStart);
        f = Math.max(0, f);
        w.load = f;
        w.contact = true;
        w.surface = hit.surface;
        w.point.set(hit.px, hit.py, hit.pz);
        w.normal.set(hit.nx, hit.ny, hit.nz);
        force.addScaledVector(up, f);
        _v1.copy(up).multiplyScalar(f);
        _v2.crossVectors(w.r, _v1);
        torque.add(_v2);
        this.grounded++;
        if (hit.surface === SURFACE.BOOST) this.onBoost = true;
      } else {
        w.contact = false;
        w.prevComp = 0;
        w.comp = 0;
        w.load = 0;
      }
    }

    // --- Drive forces -----------------------------------------------------
    const throttle = input.throttle || 0;
    const brake = input.brake || 0;
    let engine = 0;
    if (throttle > 0) {
      const v = Math.max(0, fwdSpeed);
      engine = throttle * CAR.engineAccel * Math.max(0, 1 - v / CAR.topSpeed);
    }
    let braking = false;
    if (brake > 0) {
      if (fwdSpeed > 1) braking = true;
      else if (fwdSpeed > -CAR.reverseMax) engine -= brake * CAR.reverseAccel;
    }

    for (const w of this.wheels) {
      if (!w.contact) continue;
      const n = w.normal;
      // Wheel heading (front wheels steer).
      if (w.front) {
        const c = Math.cos(this.steerAngle);
        const s = Math.sin(this.steerAngle);
        _v1.copy(fwd).multiplyScalar(c).addScaledVector(left, s);
      } else {
        _v1.copy(fwd);
      }
      w.fw.copy(_v1).addScaledVector(n, -_v1.dot(n)).normalize();
      w.sd.crossVectors(n, w.fw).normalize();
      // Tyre forces act near the centre-of-mass height to keep the car from tripping over.
      w.r.copy(w.point).sub(this.pos);
      w.r.addScaledVector(up, -w.r.dot(up) * 0.85);

      const props = SURFACE_PROPS[w.surface] || SURFACE_PROPS[SURFACE.ROAD];
      const drive = (engine * props.engine) / 4;
      if (drive !== 0) {
        _v2.copy(w.fw).multiplyScalar(drive);
        force.add(_v2);
        torque.add(_v1.crossVectors(w.r, _v2));
      }
      if (w.surface === SURFACE.BOOST) {
        _v2.copy(fwd).addScaledVector(n, -fwd.dot(n)).normalize().multiplyScalar(CAR.boostAccel / 4);
        force.add(_v2);
      }
      if (props.drag > 0) force.addScaledVector(this.vel, -props.drag / 4);
    }

    if (this.grounded > 0) {
      force.addScaledVector(up, -CAR.downforce * speed * speed * (this.grounded / 4));
    }
    force.addScaledVector(this.vel, -CAR.airDrag * speed);

    // --- Integrate external forces ---------------------------------------
    this.vel.addScaledVector(force, dt);
    _v1.copy(torque).applyMatrix3(this.invInertia);
    this.angVel.addScaledVector(_v1, dt);

    // --- Tyre friction (sequential impulses) -----------------------------
    for (const w of this.wheels) {
      w.jLat = 0;
      w.jLong = 0;
    }
    let slipSum = 0;
    for (let iter = 0; iter < 4; iter++) {
      for (const w of this.wheels) {
        if (!w.contact) continue;
        const props = SURFACE_PROPS[w.surface] || SURFACE_PROPS[SURFACE.ROAD];
        const mu = (w.front ? CAR.gripFront : CAR.gripRear) * props.grip;
        const maxJ = mu * w.load * dt;
        const vp = this.pointVelocity(w.r, _v2);

        // Lateral
        const vLat = vp.dot(w.sd);
        let j = -vLat / this.effMass(w.r, w.sd);
        const old = w.jLat;
        w.jLat = Math.max(-maxJ, Math.min(maxJ, old + j));
        j = w.jLat - old;
        this.applyImpulse(w.r, w.sd, j);

        // Longitudinal (brakes, coasting resistance)
        const vp2 = this.pointVelocity(w.r, _v2);
        const vLong = vp2.dot(w.fw);
        const decel = braking ? CAR.brakeAccel * brake : throttle > 0 ? 0.15 : CAR.coastDecel;
        const maxL = Math.min(maxJ, (decel * dt) / 4);
        let jl = -vLong / this.effMass(w.r, w.fw);
        const oldL = w.jLong;
        w.jLong = Math.max(-maxL, Math.min(maxL, oldL + jl));
        jl = w.jLong - oldL;
        this.applyImpulse(w.r, w.fw, jl);
      }
    }
    for (const w of this.wheels) {
      if (!w.contact) {
        w.slip = 0;
        continue;
      }
      const vp = this.pointVelocity(w.r, _v2);
      w.slip = Math.abs(vp.dot(w.sd));
      slipSum += w.slip;
      w.spin += (vp.dot(w.fw) / CAR.wheelRadius) * dt;
    }
    this.slip = slipSum / 4;

    // --- Body collisions ---------------------------------------------------
    this.wallHit = 0;
    const contacts = this._contacts;
    for (const s of CAR.bodySpheres) {
      contacts.length = 0;
      _v1.set(s[0], s[1], s[2]).applyQuaternion(this.quat);
      const cx = this.pos.x + _v1.x;
      const cy = this.pos.y + _v1.y;
      const cz = this.pos.z + _v1.z;
      world.sphere(cx, cy, cz, s[3], contacts, this._pool);
      for (const c of contacts) {
        const n = _v3.set(c.nx, c.ny, c.nz);
        // Positional correction
        this.pos.addScaledVector(n, c.depth * 0.8);
        const r = _r.set(c.px - this.pos.x, c.py - this.pos.y, c.pz - this.pos.z);
        const vp = this.pointVelocity(r, _v2);
        const vn = vp.dot(n);
        if (vn < 0) {
          const jn = (-(1 + 0.1) * vn) / this.effMass(r, n);
          this.applyImpulse(r, n, jn);
          if (vn < -2) this.wallHit = Math.max(this.wallHit, -vn);
          // Friction
          const vp2 = this.pointVelocity(r, _v2);
          const vt = vp2.addScaledVector(n, -vp2.dot(n));
          const vtl = vt.length();
          if (vtl > 1e-4) {
            const tdir = _tdir.copy(vt).multiplyScalar(1 / vtl);
            const jt = Math.min(vtl / this.effMass(r, tdir), CAR.wallFriction * jn);
            this.applyImpulse(r, tdir, -jt);
          }
        }
      }
    }

    // --- Integrate position / orientation ----------------------------------
    this.pos.addScaledVector(this.vel, dt);
    const damp = Math.exp(-(this.grounded > 0 ? 2.2 : 0.4) * dt);
    this.angVel.multiplyScalar(damp);
    const ax = this.angVel.x * dt * 0.5;
    const ay = this.angVel.y * dt * 0.5;
    const az = this.angVel.z * dt * 0.5;
    _q.set(ax, ay, az, 0).multiply(this.quat);
    this.quat.x += _q.x;
    this.quat.y += _q.y;
    this.quat.z += _q.z;
    this.quat.w += _q.w;
    this.quat.normalize();
  }

  /** Snapshot for checkpoint respawns. */
  snapshot() {
    return {
      pos: this.pos.clone(),
      quat: this.quat.clone(),
      vel: this.vel.clone(),
    };
  }
}
