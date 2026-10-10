import { SURFACE } from './constants.js';

const STRIDE = 16; // ax ay az | e1 | e2 | n | surface | aabb(min y, max y) | spare
const EPS = 1e-5;

/**
 * Static triangle soup with a 3D spatial hash, plus an infinite ground plane at y = 0.
 * Supports one-sided raycasts (wheels) and sphere contacts (car body).
 */
export class CollisionWorld {
  constructor(cellSize = 4) {
    this.cellSize = cellSize;
    this.raw = [];
    this.count = 0;
    this.data = null;
    this.cells = new Map();
    this.stamp = null;
    this.query = 0;
    this.groundY = 0;
    this.hasGround = true;
    this.terrain = null; // optional { height(x,z), normal(x,z), surface(x,z) }
    this._candidates = [];
  }

  addTriangle(a, b, c, surface) {
    const e1x = b[0] - a[0], e1y = b[1] - a[1], e1z = b[2] - a[2];
    const e2x = c[0] - a[0], e2y = c[1] - a[1], e2z = c[2] - a[2];
    let nx = e1y * e2z - e1z * e2y;
    let ny = e1z * e2x - e1x * e2z;
    let nz = e1x * e2y - e1y * e2x;
    const l = Math.hypot(nx, ny, nz);
    if (l < 1e-9) return; // degenerate
    nx /= l; ny /= l; nz /= l;
    this.raw.push(a[0], a[1], a[2], e1x, e1y, e1z, e2x, e2y, e2z, nx, ny, nz, surface, 0, 0, 0);
    this.count++;
  }

  build() {
    this.data = new Float64Array(this.raw);
    this.raw = [];
    this.stamp = new Uint32Array(this.count);
    const cs = this.cellSize;
    const d = this.data;
    for (let i = 0; i < this.count; i++) {
      const o = i * STRIDE;
      const ax = d[o], ay = d[o + 1], az = d[o + 2];
      const bx = ax + d[o + 3], by = ay + d[o + 4], bz = az + d[o + 5];
      const cx = ax + d[o + 6], cy = ay + d[o + 7], cz = az + d[o + 8];
      const x0 = Math.floor(Math.min(ax, bx, cx) / cs), x1 = Math.floor(Math.max(ax, bx, cx) / cs);
      const y0 = Math.floor(Math.min(ay, by, cy) / cs), y1 = Math.floor(Math.max(ay, by, cy) / cs);
      const z0 = Math.floor(Math.min(az, bz, cz) / cs), z1 = Math.floor(Math.max(az, bz, cz) / cs);
      for (let x = x0; x <= x1; x++)
        for (let y = y0; y <= y1; y++)
          for (let z = z0; z <= z1; z++) {
            const k = key(x, y, z);
            let list = this.cells.get(k);
            if (!list) this.cells.set(k, (list = []));
            list.push(i);
          }
    }
    return this;
  }

  /** Collects unique triangle indices overlapping an AABB into this._candidates. */
  gather(minX, minY, minZ, maxX, maxY, maxZ) {
    const cs = this.cellSize;
    const out = this._candidates;
    out.length = 0;
    if (!this.count) return out;
    this.query = (this.query + 1) >>> 0;
    if (this.query === 0) {
      this.stamp.fill(0);
      this.query = 1;
    }
    const q = this.query;
    const x0 = Math.floor(minX / cs), x1 = Math.floor(maxX / cs);
    const y0 = Math.floor(minY / cs), y1 = Math.floor(maxY / cs);
    const z0 = Math.floor(minZ / cs), z1 = Math.floor(maxZ / cs);
    for (let x = x0; x <= x1; x++)
      for (let y = y0; y <= y1; y++)
        for (let z = z0; z <= z1; z++) {
          const list = this.cells.get(key(x, y, z));
          if (!list) continue;
          for (let i = 0; i < list.length; i++) {
            const t = list[i];
            if (this.stamp[t] !== q) {
              this.stamp[t] = q;
              out.push(t);
            }
          }
        }
    return out;
  }

  /**
   * One-sided raycast (only hits faces whose normal opposes the ray).
   * Triangles whose surface equals `skipSurface` are ignored (wheels ignore walls).
   * Writes into `hit` = {dist, px, py, pz, nx, ny, nz, surface}; returns true on hit.
   */
  raycast(ox, oy, oz, dx, dy, dz, maxDist, hit, skipSurface = -1) {
    let best = maxDist;
    let found = false;
    const ex = ox + dx * maxDist, ey = oy + dy * maxDist, ez = oz + dz * maxDist;
    const cand = this.gather(
      Math.min(ox, ex), Math.min(oy, ey), Math.min(oz, ez),
      Math.max(ox, ex), Math.max(oy, ey), Math.max(oz, ez),
    );
    const d = this.data;
    for (let k = 0; k < cand.length; k++) {
      const o = cand[k] * STRIDE;
      if (d[o + 12] === skipSurface) continue;
      const nx = d[o + 9], ny = d[o + 10], nz = d[o + 11];
      if (nx * dx + ny * dy + nz * dz >= -1e-4) continue;
      const e1x = d[o + 3], e1y = d[o + 4], e1z = d[o + 5];
      const e2x = d[o + 6], e2y = d[o + 7], e2z = d[o + 8];
      const px = dy * e2z - dz * e2y;
      const py = dz * e2x - dx * e2z;
      const pz = dx * e2y - dy * e2x;
      const det = e1x * px + e1y * py + e1z * pz;
      if (Math.abs(det) < 1e-12) continue;
      const inv = 1 / det;
      const tx = ox - d[o], ty = oy - d[o + 1], tz = oz - d[o + 2];
      const u = (tx * px + ty * py + tz * pz) * inv;
      if (u < -1e-4 || u > 1 + 1e-4) continue;
      const qx = ty * e1z - tz * e1y;
      const qy = tz * e1x - tx * e1z;
      const qz = tx * e1y - ty * e1x;
      const v = (dx * qx + dy * qy + dz * qz) * inv;
      if (v < -1e-4 || u + v > 1 + 1e-4) continue;
      const t = (e2x * qx + e2y * qy + e2z * qz) * inv;
      if (t < 0 || t >= best) continue;
      best = t;
      found = true;
      hit.nx = nx; hit.ny = ny; hit.nz = nz;
      hit.surface = d[o + 12];
    }
    if (this.hasGround && dy < -1e-6) {
      const T = this.terrain;
      let t = ((T ? T.height(ox, oz) : this.groundY) - oy) / dy;
      let hx = ox;
      let hz = oz;
      if (T && t > 0) {
        // Refine once at the estimated hit point (rays are short and nearly vertical).
        hx = ox + dx * t;
        hz = oz + dz * t;
        t = (T.height(hx, hz) - oy) / dy;
      }
      if (t >= -0.5 && t < best) {
        best = Math.max(t, 0);
        found = true;
        if (T) {
          const n = T.normal(hx, hz);
          hit.nx = n[0]; hit.ny = n[1]; hit.nz = n[2];
          hit.surface = T.surface(hx, hz);
        } else {
          hit.nx = 0; hit.ny = 1; hit.nz = 0;
          hit.surface = SURFACE.GRASS;
        }
      }
    }
    if (found) {
      hit.dist = best;
      hit.px = ox + dx * best;
      hit.py = oy + dy * best;
      hit.pz = oz + dz * best;
    }
    return found;
  }

  /**
   * Sphere contacts. Pushes {nx, ny, nz, depth, px, py, pz, surface} objects into `out`
   * (objects are taken from `pool` to avoid allocation). Returns the number added.
   */
  sphere(cx, cy, cz, r, out, pool) {
    let added = 0;
    const cand = this.gather(cx - r, cy - r, cz - r, cx + r, cy + r, cz + r);
    const d = this.data;
    const cp = this._cp || (this._cp = [0, 0, 0]);
    for (let k = 0; k < cand.length; k++) {
      const o = cand[k] * STRIDE;
      const ax = d[o], ay = d[o + 1], az = d[o + 2];
      const nx = d[o + 9], ny = d[o + 10], nz = d[o + 11];
      const sd = (cx - ax) * nx + (cy - ay) * ny + (cz - az) * nz;
      if (sd < 0 || sd > r) continue; // behind the face or too far from its plane
      closestPointOnTriangle(cx, cy, cz, d, o, cp);
      const vx = cx - cp[0], vy = cy - cp[1], vz = cz - cp[2];
      const dist2 = vx * vx + vy * vy + vz * vz;
      if (dist2 >= r * r) continue;
      const dist = Math.sqrt(dist2);
      const c = pool[out.length] || (pool[out.length] = {});
      if (dist > EPS) {
        c.nx = vx / dist; c.ny = vy / dist; c.nz = vz / dist;
      } else {
        c.nx = nx; c.ny = ny; c.nz = nz;
      }
      c.depth = r - dist;
      c.px = cp[0]; c.py = cp[1]; c.pz = cp[2];
      c.surface = d[o + 12];
      out.push(c);
      added++;
    }
    const gy = this.terrain ? this.terrain.height(cx, cz) : this.groundY;
    if (this.hasGround && cy - r < gy) {
      const c = pool[out.length] || (pool[out.length] = {});
      if (this.terrain) {
        const n = this.terrain.normal(cx, cz);
        c.nx = n[0]; c.ny = n[1]; c.nz = n[2];
        c.surface = this.terrain.surface(cx, cz);
      } else {
        c.nx = 0; c.ny = 1; c.nz = 0;
        c.surface = SURFACE.GRASS;
      }
      c.depth = (gy - (cy - r)) * c.ny;
      c.px = cx; c.py = gy; c.pz = cz;
      out.push(c);
      added++;
    }
    return added;
  }
}

function key(x, y, z) {
  return ((x + 4096) * 1024 + (y + 512)) * 8192 + (z + 4096);
}

// Ericson, Real-Time Collision Detection, 5.1.5
function closestPointOnTriangle(px, py, pz, d, o, out) {
  const ax = d[o], ay = d[o + 1], az = d[o + 2];
  const abx = d[o + 3], aby = d[o + 4], abz = d[o + 5];
  const acx = d[o + 6], acy = d[o + 7], acz = d[o + 8];
  const apx = px - ax, apy = py - ay, apz = pz - az;
  const d1 = abx * apx + aby * apy + abz * apz;
  const d2 = acx * apx + acy * apy + acz * apz;
  if (d1 <= 0 && d2 <= 0) {
    out[0] = ax; out[1] = ay; out[2] = az;
    return;
  }
  const bx = ax + abx, by = ay + aby, bz = az + abz;
  const bpx = px - bx, bpy = py - by, bpz = pz - bz;
  const d3 = abx * bpx + aby * bpy + abz * bpz;
  const d4 = acx * bpx + acy * bpy + acz * bpz;
  if (d3 >= 0 && d4 <= d3) {
    out[0] = bx; out[1] = by; out[2] = bz;
    return;
  }
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const v = d1 / (d1 - d3);
    out[0] = ax + abx * v; out[1] = ay + aby * v; out[2] = az + abz * v;
    return;
  }
  const cx = ax + acx, cy = ay + acy, cz = az + acz;
  const cpx = px - cx, cpy = py - cy, cpz = pz - cz;
  const d5 = abx * cpx + aby * cpy + abz * cpz;
  const d6 = acx * cpx + acy * cpy + acz * cpz;
  if (d6 >= 0 && d5 <= d6) {
    out[0] = cx; out[1] = cy; out[2] = cz;
    return;
  }
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const w = d2 / (d2 - d6);
    out[0] = ax + acx * w; out[1] = ay + acy * w; out[2] = az + acz * w;
    return;
  }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const w = (d4 - d3) / (d4 - d3 + (d5 - d6));
    out[0] = bx + (cx - bx) * w; out[1] = by + (cy - by) * w; out[2] = bz + (cz - bz) * w;
    return;
  }
  const denom = 1 / (va + vb + vc);
  const v = vb * denom;
  const w = vc * denom;
  out[0] = ax + abx * v + acx * w;
  out[1] = ay + aby * v + acy * w;
  out[2] = az + abz * v + acz * w;
}
