import * as THREE from 'three';
import { GHOST_HZ } from '../core/constants.js';
import { b64ToFloats } from './storage.js';

// Recorded runs (ghosts and replays) are sampled at GHOST_HZ.
// v2 frame layout (stride 10): px py pz qx qy qz qw steer speed flags
// v1 (stride 7) had no steer/speed/flags and is still readable.

export const GHOST_STRIDE = 10;
export const FLAG_BRAKE = 1;
export const FLAG_BOOST = 2;
export const FLAG_REVERSE = 4;

export class GhostRecorder {
  constructor() {
    this.frames = [];
  }
  reset() {
    this.frames.length = 0;
  }
  push(car, flags) {
    const { pos, quat } = car;
    this.frames.push(pos.x, pos.y, pos.z, quat.x, quat.y, quat.z, quat.w, car.steerAngle, car.forwardSpeed, flags);
  }
  toArray() {
    return new Float32Array(this.frames);
  }
}

export function decodeGhost(record) {
  if (!record?.ghost) return null;
  try {
    const data = b64ToFloats(record.ghost);
    const stride = record.gv === 2 ? GHOST_STRIDE : 7;
    if (data.length < stride * 2) return null;
    return { data, stride, frames: data.length / stride };
  } catch {
    return null;
  }
}

const _qa = new THREE.Quaternion();
const _qb = new THREE.Quaternion();
const _v = new THREE.Vector3();

/**
 * Interpolated pose at time t (seconds). Writes into pos/quat and returns
 * { steer, speed, flags, done }.
 */
export function sampleGhost(g, t, pos, quat) {
  const { data, stride, frames } = g;
  const f = Math.max(0, Math.min(frames - 1, t * GHOST_HZ));
  const i = Math.floor(f);
  const j = Math.min(frames - 1, i + 1);
  const k = f - i;
  const a = i * stride;
  const b = j * stride;
  pos.set(data[a], data[a + 1], data[a + 2]).lerp(_v.set(data[b], data[b + 1], data[b + 2]), k);
  _qa.set(data[a + 3], data[a + 4], data[a + 5], data[a + 6]);
  _qb.set(data[b + 3], data[b + 4], data[b + 5], data[b + 6]);
  quat.slerpQuaternions(_qa, _qb, k);
  if (stride >= 10) {
    return {
      steer: data[a + 7] + (data[b + 7] - data[a + 7]) * k,
      speed: data[a + 8] + (data[b + 8] - data[a + 8]) * k,
      flags: data[a + 9],
      done: f >= frames - 1,
    };
  }
  // Legacy ghost: estimate speed from motion.
  const speed = Math.hypot(data[b] - data[a], data[b + 1] - data[a + 1], data[b + 2] - data[a + 2]) * GHOST_HZ;
  return { steer: 0, speed, flags: 0, done: f >= frames - 1 };
}

/**
 * Time at which the ghost was closest to `p`, searching near a hint frame.
 * Used for the live delta. Returns { time, index, dist }.
 */
export function ghostTimeAt(g, p, hint = 0) {
  const { data, stride, frames } = g;
  const lo = Math.max(0, hint - 20);
  const hi = Math.min(frames - 2, hint + 90);
  let best = hint;
  let bestD = Infinity;
  for (let i = lo; i <= hi; i++) {
    const o = i * stride;
    const d = (data[o] - p.x) ** 2 + (data[o + 1] - p.y) ** 2 + (data[o + 2] - p.z) ** 2;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  // Refine between best and its neighbour by projecting onto the segment.
  const o = best * stride;
  const n = (best + 1) * stride;
  const sx = data[n] - data[o];
  const sy = data[n + 1] - data[o + 1];
  const sz = data[n + 2] - data[o + 2];
  const len2 = sx * sx + sy * sy + sz * sz || 1;
  const u = Math.max(0, Math.min(1, ((p.x - data[o]) * sx + (p.y - data[o + 1]) * sy + (p.z - data[o + 2]) * sz) / len2));
  return { time: (best + u) / GHOST_HZ, index: best, dist: Math.sqrt(bestD) };
}
