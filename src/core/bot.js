import { CAR, surfaceGrip } from './physics.js';

/**
 * Simple autopilot that follows a track's driving line. Used by the headless tests to prove
 * every built-in track can be finished, and to derive medal times. Also powers the
 * attract-mode demo on the menu.
 */
export class Bot {
  constructor(driveLine, { grip = 26, brake = 26, aggression = 1 } = {}) {
    this.pts = driveLine;
    this.grip = grip * aggression;
    this.brake = brake;
    const n = driveLine.length;
    this.s = new Float64Array(n);
    this.vmax = new Float64Array(n);
    for (let i = 1; i < n; i++) {
      const a = driveLine[i - 1].p;
      const b = driveLine[i].p;
      this.s[i] = this.s[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    }
    // Lateral curvature (ignores vertical curvature such as loops and slopes).
    this.gripAt = new Float64Array(n);
    for (let i = 0; i < n; i++) this.gripAt[i] = surfaceGrip(driveLine[i].surface ?? 0);
    for (let i = 0; i < n; i++) {
      const i0 = Math.max(0, i - 2);
      const i1 = Math.min(n - 1, i + 2);
      const k = this.lateralCurvature(i0, i, i1);
      this.vmax[i] = k > 1e-4 ? Math.sqrt((this.grip * this.gripAt[i]) / k) : 999;
    }
    // Backward pass: respect braking distance (less braking on slippery surfaces).
    for (let i = n - 2; i >= 0; i--) {
      const ds = this.s[i + 1] - this.s[i];
      this.vmax[i] = Math.min(this.vmax[i], Math.sqrt(this.vmax[i + 1] ** 2 + 2 * this.brake * this.gripAt[i] * ds));
    }
    this.idx = 0;
    this.stuck = 0;
    this.recover = 0;
  }

  lateralCurvature(i0, i, i1) {
    if (i1 - i0 < 2) return 0;
    const a = this.pts[i0].p;
    const b = this.pts[i].p;
    const c = this.pts[i1].p;
    const N = this.pts[i].N;
    const t1 = norm([b[0] - a[0], b[1] - a[1], b[2] - a[2]]);
    const t2 = norm([c[0] - b[0], c[1] - b[1], c[2] - b[2]]);
    const ds = (this.s[i1] - this.s[i0]) / 2;
    if (ds < 1e-3) return 0;
    const dt = [t2[0] - t1[0], t2[1] - t1[1], t2[2] - t1[2]];
    // Remove the component along the surface normal.
    const dn = dt[0] * N[0] + dt[1] * N[1] + dt[2] * N[2];
    const lat = [dt[0] - N[0] * dn, dt[1] - N[1] * dn, dt[2] - N[2] * dn];
    return Math.hypot(lat[0], lat[1], lat[2]) / ds;
  }

  reset() {
    this.idx = 0;
    this.stuck = 0;
    this.recover = 0;
  }

  nearest(pos) {
    const n = this.pts.length;
    let best = this.idx;
    let bestD = Infinity;
    const lo = Math.max(0, this.idx - 10);
    const hi = Math.min(n - 1, this.idx + 60);
    for (let i = lo; i <= hi; i++) {
      const p = this.pts[i].p;
      const d = (p[0] - pos.x) ** 2 + (p[1] - pos.y) ** 2 + (p[2] - pos.z) ** 2;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    this.idx = best;
    return { idx: best, dist: Math.sqrt(bestD) };
  }

  /** Re-acquire the line anywhere (after a respawn). */
  relocate(pos) {
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < this.pts.length; i++) {
      const p = this.pts[i].p;
      const d = (p[0] - pos.x) ** 2 + (p[1] - pos.y) ** 2 + (p[2] - pos.z) ** 2;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    this.idx = best;
  }

  pointAt(s) {
    const n = this.pts.length;
    let i = this.idx;
    while (i < n - 1 && this.s[i + 1] < s) i++;
    if (i >= n - 1) {
      // Extrapolate beyond the end.
      const a = this.pts[n - 2].p;
      const b = this.pts[n - 1].p;
      const len = this.s[n - 1] - this.s[n - 2] || 1;
      const k = (s - this.s[n - 1]) / len;
      return [b[0] + (b[0] - a[0]) * k, b[1] + (b[1] - a[1]) * k, b[2] + (b[2] - a[2]) * k];
    }
    const a = this.pts[i].p;
    const b = this.pts[i + 1].p;
    const k = (s - this.s[i]) / (this.s[i + 1] - this.s[i] || 1);
    return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
  }

  /** Returns driving input for the car. dt is used for stuck detection. */
  drive(car, dt = 1 / 240) {
    const { idx, dist } = this.nearest(car.pos);
    this.offLine = dist;
    const speed = Math.max(0, car.forwardSpeed);
    const look = 4 + speed * 0.32;
    const target = this.pointAt(this.s[idx] + look);
    const dx = target[0] - car.pos.x;
    const dy = target[1] - car.pos.y;
    const dz = target[2] - car.pos.z;
    const lx = dx * car.left.x + dy * car.left.y + dz * car.left.z;
    const lz = dx * car.fwd.x + dy * car.fwd.y + dz * car.fwd.z;
    const L2 = lx * lx + lz * lz;
    const curvature = (2 * lx) / Math.max(L2, 1);
    const wheelbase = CAR.wheels[0].z - CAR.wheels[2].z;
    const steerAngle = Math.atan(wheelbase * curvature);
    const k = Math.min(1, Math.max(0, car.forwardSpeed / CAR.steerFalloffSpeed));
    const maxSteer = CAR.maxSteerLow + (CAR.maxSteerHigh - CAR.maxSteerLow) * k;
    const steer = Math.max(-1, Math.min(1, steerAngle / maxSteer));

    // Speed target: the minimum allowed over a short window ahead.
    let vt = 999;
    const sNow = this.s[idx];
    for (let i = idx; i < this.pts.length && this.s[i] < sNow + 6; i++) vt = Math.min(vt, this.vmax[i]);
    let throttle = 1;
    let brake = 0;
    if (car.grounded === 0) {
      throttle = 1;
    } else if (speed > vt + 1.5) {
      throttle = 0;
      brake = 1;
    } else if (speed > vt) {
      throttle = 0;
    }
    // Stuck against something: back up for a moment with opposite lock.
    if (this.recover > 0) {
      this.recover -= dt;
      return { throttle: 0, brake: 1, steer: -Math.sign(steer || 1) };
    }
    if (throttle > 0 && Math.abs(car.forwardSpeed) < 1.5) this.stuck += dt;
    else this.stuck = 0;
    if (this.stuck > 1.2 || (lz < 0 && speed < 3)) {
      this.stuck = 0;
      this.recover = 0.8;
    }
    return { throttle, brake, steer };
  }

  get progress() {
    return this.s[this.idx] / this.s[this.s.length - 1];
  }
}

function norm(v) {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}
