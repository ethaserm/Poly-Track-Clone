import { SURFACE, TILE } from './constants.js';

// Deterministic terrain shared by the renderer (mesh) and the collision world (ground).
// The area around the track is perfectly flat (height 0); hills rise beyond it.

/** Stable 32-bit seed from a string (track names). */
export function seedFrom(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return h >>> 0;
}

function hash2(x, z, seed) {
  let h = Math.imul(x, 374761393) ^ Math.imul(z, 668265263) ^ Math.imul(seed, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function valueNoise(x, z, seed) {
  const xi = Math.floor(x);
  const zi = Math.floor(z);
  const fx = x - xi;
  const fz = z - zi;
  const u = fx * fx * (3 - 2 * fx);
  const v = fz * fz * (3 - 2 * fz);
  const a = hash2(xi, zi, seed);
  const b = hash2(xi + 1, zi, seed);
  const c = hash2(xi, zi + 1, seed);
  const d = hash2(xi + 1, zi + 1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

export function fbm(x, z, seed, octaves = 4) {
  let sum = 0;
  let amp = 0.5;
  let f = 1;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += valueNoise(x * f, z * f, seed + i * 101) * amp;
    norm += amp;
    amp *= 0.5;
    f *= 2.03;
  }
  return sum / norm;
}

const smooth = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

const PROFILES = {
  summer: { amp: 46, scale: 0.0042, ridge: 0, lakes: 2, lakeKind: 'water' },
  winter: { amp: 95, scale: 0.0036, ridge: 0.6, lakes: 1, lakeKind: 'ice' },
  desert: { amp: 30, scale: 0.0055, ridge: 1, lakes: 1, lakeKind: 'water' },
};

export const WATER_LEVEL = -0.35;

/**
 * bounds: cell bounds of the track; occupied: Set of "x,z" cells used by the track.
 * Returns { height(x,z), normal(x,z), surface(x,z), lakes, flat }.
 */
export function createTerrain(env, bounds, seed = 1, occupied = null) {
  const prof = PROFILES[env] || PROFILES.summer;
  const margin = 70;
  const flat = {
    x0: bounds.minX * TILE - TILE / 2 - margin,
    x1: bounds.maxX * TILE + TILE / 2 + margin,
    z0: bounds.minZ * TILE - TILE / 2 - margin,
    z1: bounds.maxZ * TILE + TILE / 2 + margin,
  };
  const s = seed >>> 0;

  // Lakes: placed in the flat zone where no track is nearby.
  const lakes = [];
  let attempt = 0;
  while (lakes.length < prof.lakes && attempt < 200) {
    attempt++;
    const r = 18 + hash2(attempt, 7, s) * 16;
    const x = flat.x0 + 20 + hash2(attempt, 1, s) * (flat.x1 - flat.x0 - 40);
    const z = flat.z0 + 20 + hash2(attempt, 2, s) * (flat.z1 - flat.z0 - 40);
    let ok = true;
    if (occupied) {
      const reach = Math.ceil((r + 16) / TILE);
      const gx = Math.round(x / TILE);
      const gz = Math.round(z / TILE);
      for (let dx = -reach; dx <= reach && ok; dx++)
        for (let dz = -reach; dz <= reach && ok; dz++) if (occupied.has(`${gx + dx},${gz + dz}`)) ok = false;
    }
    for (const l of lakes) if (Math.hypot(l.x - x, l.z - z) < l.r + r + 20) ok = false;
    if (ok) lakes.push({ x, z, r, kind: prof.lakeKind });
  }

  function outside(x, z) {
    const dx = Math.max(flat.x0 - x, 0, x - flat.x1);
    const dz = Math.max(flat.z0 - z, 0, z - flat.z1);
    return Math.hypot(dx, dz);
  }

  function hills(x, z) {
    let n = fbm(x * prof.scale, z * prof.scale, s);
    if (prof.ridge) {
      const r = 1 - Math.abs(fbm(x * prof.scale * 1.7 + 9, z * prof.scale * 0.6, s + 77) * 2 - 1);
      n = n * (1 - prof.ridge * 0.5) + r * r * prof.ridge * 0.5;
    }
    return n;
  }

  function height(x, z) {
    let h = 0;
    const d = outside(x, z);
    if (d > 0) h = smooth(d / 160) * hills(x, z) * prof.amp * (0.6 + Math.min(1, d / 600) * 0.8);
    for (const l of lakes) {
      if (l.kind !== 'water') continue;
      const q = Math.hypot(x - l.x, z - l.z) / l.r;
      if (q < 1.25) h -= 2.2 * smooth(1 - q / 1.25) ** 0.8;
    }
    return h;
  }

  function normal(x, z) {
    const e = 1;
    const hx = height(x + e, z) - height(x - e, z);
    const hz = height(x, z + e) - height(x, z - e);
    const nx = -hx / (2 * e);
    const nz = -hz / (2 * e);
    const l = Math.hypot(nx, 1, nz);
    return [nx / l, 1 / l, nz / l];
  }

  function surface(x, z) {
    for (const l of lakes) {
      const q = Math.hypot(x - l.x, z - l.z) / l.r;
      if (l.kind === 'ice' && q < 1) return SURFACE.ICE;
      if (l.kind === 'water' && q < 1 && height(x, z) < WATER_LEVEL) return SURFACE.WATER;
    }
    return SURFACE.GRASS;
  }

  /** True when (x,z) is in the flat play area, away from lakes. */
  function buildable(x, z, pad = 0) {
    if (outside(x, z) > 0) return false;
    for (const l of lakes) if (Math.hypot(x - l.x, z - l.z) < l.r * 1.3 + pad) return false;
    return true;
  }

  return { env, height, normal, surface, lakes, flat, outside, buildable, isFlat: (x, z) => outside(x, z) === 0 };
}
