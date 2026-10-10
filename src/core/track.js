import { CollisionWorld } from './collision.js';
import { DIRS, LEVEL, TILE, rotateXZ } from './constants.js';
import { PIECES, buildPieceLocal, pieceCells, pieceExit } from './pieces.js';
import { createTerrain, seedFrom } from './terrain.js';

/**
 * Track format (also what the editor saves / shares):
 *   { name, env: 'summer'|'winter'|'desert', pieces: [{ t, x, y, z, r, m }] }
 *   t = piece type, x/z = cell, y = level, r = rotation 0..3, m = mirrored
 * Built-in tracks additionally carry `route` (driving order, used by the autopilot)
 * and `medals`.
 */

export function pieceTransform(pc) {
  const ox = pc.x * TILE;
  const oy = pc.y * LEVEL;
  const oz = pc.z * TILE;
  return (p) => {
    const [x, z] = rotateXZ(p[0], p[2], pc.r);
    return [ox + x, oy + p[1], oz + z];
  };
}

export function rotateDir(v, r) {
  const [x, z] = rotateXZ(v[0], v[2], r);
  return [x, v[1], z];
}

/** World cells and level span occupied by a placed piece. */
export function occupiedCells(pc) {
  const def = PIECES[pc.t];
  return pieceCells(pc.t, !!pc.m).map(([dx, dz]) => {
    const [x, z] = rotateXZ(dx, dz, pc.r);
    return { x: pc.x + x, z: pc.z + z, y0: pc.y, y1: pc.y + def.height };
  });
}

export function overlaps(a, b) {
  const ca = occupiedCells(a);
  const cb = occupiedCells(b);
  for (const p of ca)
    for (const q of cb) if (p.x === q.x && p.z === q.z && p.y0 < q.y1 && q.y0 < p.y1) return true;
  return false;
}

/**
 * Turns a track description into everything the game needs:
 * merged render geometry, collision world, triggers, spawn, gates, pillars and (optionally)
 * the driving line for the autopilot.
 */
export function compileTrack(track) {
  const world = new CollisionWorld(4);
  let triCount = 0;
  for (const pc of track.pieces) triCount += buildPieceLocal(pc.t, !!pc.m).positions.length / 9;
  const positions = new Float32Array(triCount * 9);
  const colors = new Float32Array(triCount * 9);
  const uvs = new Float32Array(triCount * 6);
  let off = 0;
  let uvOff = 0;
  const boostPads = [];
  const lamps = [];
  const occupied = new Map();
  for (const pc of track.pieces) {
    for (const c of occupiedCells(pc)) {
      const k = `${c.x},${c.z}`;
      if (!occupied.has(k)) occupied.set(k, []);
      occupied.get(k).push([c.y0, c.y1]);
    }
  }

  const gates = [];
  const triggers = [];
  const pillars = [];
  let spawn = null;
  let checkpointCount = 0;
  let finishCount = 0;

  track.pieces.forEach((pc, index) => {
    const local = buildPieceLocal(pc.t, !!pc.m);
    const tf = pieceTransform(pc);
    const lp = local.positions;
    for (let i = 0; i < lp.length; i += 3) {
      const w = tf([lp[i], lp[i + 1], lp[i + 2]]);
      positions[off + i] = w[0];
      positions[off + i + 1] = w[1];
      positions[off + i + 2] = w[2];
    }
    colors.set(local.colors, off);
    off += lp.length;
    uvs.set(local.uvs, uvOff);
    uvOff += local.uvs.length;

    for (const pad of local.boostPads) boostPads.push({ center: tf(pad.center), size: pad.size, rot: pc.r });
    // Street lamps on every third straight, alternating sides, where nothing else is next door.
    if (local.lamps.length && (index % 3 === 0)) {
      const lamp = local.lamps[(pc.x + pc.z) & 1];
      const [nx, nz] = rotateXZ(Math.sign(lamp.pos[0]), 0, pc.r);
      const neighbour = occupied.get(`${pc.x + nx},${pc.z + nz}`) || [];
      const blocked = neighbour.some(([y0, y1]) => y0 < pc.y + 3 && pc.y - 1 < y1);
      if (!blocked) lamps.push({ pos: tf(lamp.pos), side: lamp.side, rot: pc.r });
    }

    for (const [a, b, c, s] of local.tris) world.addTriangle(tf(a), tf(b), tf(c), s);

    for (const g of local.gates) gates.push({ kind: g.kind, pos: tf(g.pos), rot: pc.r, piece: index });
    for (const tr of local.triggers) {
      const trig = {
        kind: tr.kind,
        center: tf(tr.center),
        half: tr.half,
        rot: pc.r,
        piece: index,
        id: tr.kind === 'checkpoint' ? checkpointCount : finishCount,
      };
      if (tr.kind === 'checkpoint') checkpointCount++;
      else finishCount++;
      triggers.push(trig);
    }
    if (local.spawn && !spawn) {
      spawn = { pos: tf(local.spawn.pos), dir: rotateDir(local.spawn.dir, pc.r) };
    }
    for (const p of local.pillars) {
      const w = tf(p);
      if (w[1] > 1.2) pillars.push(w);
    }
  });
  world.build();
  const bounds = trackBounds(track);
  const terrain = createTerrain(track.env || 'summer', bounds, seedFrom(track.name || 'track'), new Set(occupied.keys()));
  world.terrain = terrain;

  let driveLine = null;
  if (track.route) driveLine = buildDriveLine(track);

  return {
    terrain,
    track,
    positions,
    colors,
    uvs,
    boostPads,
    lamps,
    world,
    gates,
    triggers,
    pillars,
    spawn,
    checkpointCount,
    finishCount,
    driveLine,
    bounds,
  };
}

function trackBounds(track) {
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity, maxY = 0;
  for (const pc of track.pieces) {
    for (const c of occupiedCells(pc)) {
      minX = Math.min(minX, c.x);
      maxX = Math.max(maxX, c.x);
      minZ = Math.min(minZ, c.z);
      maxZ = Math.max(maxZ, c.z);
      maxY = Math.max(maxY, c.y1);
    }
  }
  if (!track.pieces.length) return { minX: -5, maxX: 5, minZ: -5, maxZ: 5, maxY: 0 };
  return { minX, maxX, minZ, maxZ, maxY };
}

/** Ordered world-space centreline points [{p, N}] following track.route. */
export function buildDriveLine(track) {
  const pts = [];
  for (const step of track.route) {
    const pc = track.pieces[step.i];
    const tf = pieceTransform(pc);
    const frames = buildPieceLocal(pc.t, !!pc.m).centerline;
    const list = step.rev ? [...frames].reverse() : frames;
    for (const f of list) {
      const p = tf(f.p);
      const N = rotateDir(f.N, pc.r);
      const last = pts[pts.length - 1];
      if (last && Math.hypot(p[0] - last.p[0], p[1] - last.p[1], p[2] - last.p[2]) < 0.05) continue;
      pts.push({ p, N, piece: step.i, surface: f.surface });
    }
  }
  return pts;
}

/** Is a world point inside a trigger box? */
export function insideTrigger(trig, x, y, z) {
  const dx = x - trig.center[0];
  const dy = y - trig.center[1];
  const dz = z - trig.center[2];
  const [lx, lz] = rotateXZ(dx, dz, (4 - trig.rot) % 4);
  return Math.abs(lx) <= trig.half[0] && Math.abs(dy) <= trig.half[1] && Math.abs(lz) <= trig.half[2];
}

// ---------------------------------------------------------------------------
// Chain builder: author tracks as a sequence of connected pieces.
// ---------------------------------------------------------------------------

export class TrackChain {
  constructor(name, env = 'summer', start = { x: 0, y: 0, z: 0, d: 0 }) {
    this.track = { name, env, pieces: [], route: [] };
    this.cur = { ...start };
  }

  _add(pc, rev) {
    for (const other of this.track.pieces) {
      if (overlaps(pc, other)) {
        throw new Error(
          `${this.track.name}: ${pc.t} at (${pc.x},${pc.y},${pc.z}) overlaps ${other.t} at (${other.x},${other.y},${other.z})`,
        );
      }
    }
    this.track.route.push({ i: this.track.pieces.length, rev });
    this.track.pieces.push(pc);
  }

  /** Place a piece driving through it forwards (entry -> exit). */
  piece(t, mirror = false) {
    const { x, y, z, d } = this.cur;
    const e = pieceExit(t, mirror);
    const pc = { t, x, y, z, r: d, m: mirror ? 1 : 0 };
    this._add(pc, false);
    const [ex, ez] = rotateXZ(e.dx, e.dz, d);
    this.cur = { x: x + ex, y: y + e.dl, z: z + ez, d: (d + e.dd + 4) % 4 };
    return this;
  }

  /** Place a piece driving through it backwards (exit -> entry). */
  reversed(t, mirror = false) {
    const { x, y, z, d } = this.cur;
    const e = pieceExit(t, mirror);
    const dd = (e.dd + 4) % 4;
    const r = (d - dd - 2 + 8) % 4;
    const lastLocal = [e.dx - DIRS[dd][0], e.dz - DIRS[dd][1]];
    const [lx, lz] = rotateXZ(lastLocal[0], lastLocal[1], r);
    const ax = x - lx;
    const az = z - lz;
    const ay = y - e.dl;
    const pc = { t, x: ax, y: ay, z: az, r, m: mirror ? 1 : 0 };
    this._add(pc, true);
    const [bx, bz] = rotateXZ(0, -1, r);
    this.cur = { x: ax + bx, y: ay, z: az + bz, d: (r + 2) % 4 };
    return this;
  }

  repeat(n, fn) {
    for (let i = 0; i < n; i++) fn(this);
    return this;
  }

  start() { return this.piece('start'); }
  finish() { return this.piece('finish'); }
  cp() { return this.piece('checkpoint'); }
  straight(n = 1) { return this.repeat(n, (c) => c.piece('straight')); }
  platform(n = 1) { return this.repeat(n, (c) => c.piece('platform')); }
  boost(n = 1) { return this.repeat(n, (c) => c.piece('boost')); }
  left() { return this.piece('turn'); }
  right() { return this.reversed('turn'); }
  wideLeft() { return this.piece('wideTurn'); }
  wideRight() { return this.reversed('wideTurn'); }
  up() { return this.piece('slope'); }
  down() { return this.reversed('slope'); }
  longUp() { return this.piece('slopeLong'); }
  longDown() { return this.reversed('slopeLong'); }
  ramp() { return this.piece('ramp'); }
  loop(mirror = false) { return this.piece('loop', mirror); }

  /** Skip cells (for jumps). Optionally change level of the landing. */
  gap(n, dl = 0) {
    const [dx, dz] = DIRS[this.cur.d];
    this.cur = { ...this.cur, x: this.cur.x + dx * n, z: this.cur.z + dz * n, y: this.cur.y + dl };
    return this;
  }

  /** Lift the cursor (e.g. build an elevated section straight away). */
  level(dl) {
    this.cur = { ...this.cur, y: this.cur.y + dl };
    return this;
  }

  build(extra = {}) {
    return { ...this.track, ...extra };
  }
}
