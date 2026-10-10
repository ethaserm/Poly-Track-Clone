import { DECK, DECK_THICKNESS, LEVEL, SURFACE, TILE, WALL_OUTER } from './constants.js';
import { COLORS, MeshBuilder, pathLength, roadProfile, sweep, sweepFrames } from './sweep.js';
import { smoothstep } from './vec.js';

const H = TILE / 2;

// ---------------------------------------------------------------------------
// Paths. Every piece is authored in local space: the anchor cell is centred on
// the origin, the car enters at z = -H travelling towards +Z, and y is measured
// from the base of the piece's level (the road surface sits at y = DECK).
// ---------------------------------------------------------------------------

const straightPath = (cells = 1) => (t) => [0, DECK, -H + TILE * cells * t];

const arcPath = (cx, cz, r) => (t) => {
  const a = Math.PI - (t * Math.PI) / 2;
  return [cx + r * Math.cos(a), DECK, cz + r * Math.sin(a)];
};

const slopePath = (cells, rise) => (t) => [0, DECK + rise * smoothstep(t), -H + TILE * cells * t];

const LOOP_R = 14;
const LOOP_Z = 10;
const LOOP_SHIFT = TILE;
const loopPath = (t) => {
  const a = t * Math.PI * 2;
  return [
    LOOP_SHIFT * smoothstep(t),
    DECK + LOOP_R * (1 - Math.cos(a)),
    LOOP_Z + LOOP_R * Math.sin(a),
  ];
};
const loopUp = (t) => {
  const a = t * Math.PI * 2;
  return [0, Math.cos(a), -Math.sin(a)];
};

const RAMP_RISE = 2.4;
const rampPath = (t) => [0, DECK + RAMP_RISE * t * t, -H + TILE * t];

// ---------------------------------------------------------------------------
// Piece catalogue
//   cells:  footprint in local cell coordinates [dx, dz]
//   height: levels occupied (for overlap checks in the editor)
//   exit:   where the road continues: next cell offset, level change, direction change
//   sweeps: road sections in driving order
// ---------------------------------------------------------------------------

export const PIECES = {
  start: {
    name: 'Start',
    category: 'Special',
    cells: [[0, 0]],
    height: 2,
    exit: { dx: 0, dz: 1, dl: 0, dd: 0 },
    sweeps: [{ path: straightPath(), segments: 4 }],
    gate: 'start',
  },
  finish: {
    name: 'Finish',
    category: 'Special',
    cells: [[0, 0]],
    height: 2,
    exit: { dx: 0, dz: 1, dl: 0, dd: 0 },
    sweeps: [{ path: straightPath(), segments: 4 }],
    gate: 'finish',
  },
  checkpoint: {
    name: 'Checkpoint',
    category: 'Special',
    cells: [[0, 0]],
    height: 2,
    exit: { dx: 0, dz: 1, dl: 0, dd: 0 },
    sweeps: [{ path: straightPath(), segments: 4 }],
    gate: 'checkpoint',
  },
  straight: {
    name: 'Straight',
    category: 'Road',
    cells: [[0, 0]],
    height: 1,
    exit: { dx: 0, dz: 1, dl: 0, dd: 0 },
    sweeps: [{ path: straightPath(), segments: 4 }],
  },
  turn: {
    name: 'Turn',
    category: 'Road',
    cells: [[0, 0]],
    height: 1,
    exit: { dx: 1, dz: 0, dl: 0, dd: 1 },
    sweeps: [{ path: arcPath(H, -H, H), segments: 8 }],
  },
  wideTurn: {
    name: 'Wide Turn',
    category: 'Road',
    cells: [
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 1],
    ],
    height: 1,
    exit: { dx: 2, dz: 1, dl: 0, dd: 1 },
    sweeps: [{ path: arcPath(TILE + H, -H, TILE + H), segments: 14 }],
  },
  slope: {
    name: 'Slope',
    category: 'Road',
    cells: [
      [0, 0],
      [0, 1],
    ],
    height: 3,
    exit: { dx: 0, dz: 2, dl: 2, dd: 0 },
    sweeps: [{ path: slopePath(2, LEVEL * 2), segments: 12 }],
  },
  slopeLong: {
    name: 'Long Slope',
    category: 'Road',
    cells: [
      [0, 0],
      [0, 1],
      [0, 2],
      [0, 3],
    ],
    height: 5,
    exit: { dx: 0, dz: 4, dl: 4, dd: 0 },
    sweeps: [{ path: slopePath(4, LEVEL * 4), segments: 20 }],
  },
  boost: {
    name: 'Booster',
    category: 'Special',
    cells: [[0, 0]],
    height: 1,
    exit: { dx: 0, dz: 1, dl: 0, dd: 0 },
    sweeps: [{ path: straightPath(), segments: 4, boost: true }],
  },
  ramp: {
    name: 'Ramp',
    category: 'Jump',
    cells: [[0, 0]],
    height: 2,
    exit: { dx: 0, dz: 1, dl: 0, dd: 0 },
    sweeps: [{ path: rampPath, segments: 8, solid: true }],
  },
  loop: {
    name: 'Loop',
    category: 'Jump',
    cells: [
      [0, 0],
      [0, 1],
      [0, 2],
      [1, 0],
      [1, 1],
      [1, 2],
    ],
    height: 13,
    exit: { dx: 1, dz: 3, dl: 0, dd: 0 },
    sweeps: [
      { path: (t) => [0, DECK, -H + (LOOP_Z + H) * t], segments: 4, capEnd: false },
      { path: loopPath, up: loopUp, segments: 56, capStart: false, capEnd: false, noPillars: true },
      {
        path: (t) => [LOOP_SHIFT, DECK, LOOP_Z + (TILE * 3 - H - LOOP_Z) * t],
        segments: 4,
        capStart: false,
      },
    ],
  },
  platform: {
    name: 'Platform',
    category: 'Road',
    cells: [[0, 0]],
    height: 1,
    exit: { dx: 0, dz: 1, dl: 0, dd: 0 },
    sweeps: [{ path: straightPath(), segments: 1, platform: true }],
  },
};

export const PIECE_TYPES = Object.keys(PIECES);

// ---------------------------------------------------------------------------
// Local geometry generation (cached per type + mirror flag)
// ---------------------------------------------------------------------------

const cache = new Map();

function mirrorPath(path) {
  return (t) => {
    const p = path(t);
    return [-p[0], p[1], p[2]];
  };
}

/**
 * Builds the local-space data for a piece:
 *   positions/colors  render triangles (non-indexed)
 *   tris              collision triangles [a, b, c, surface]
 *   centerline        driving line samples [{p, T, S, N}]
 *   gates             start/checkpoint/finish arch placements
 *   triggers          local trigger boxes
 *   spawn             car spawn (start piece)
 *   pillars           support points (local x, deck underside y, z)
 */
export function buildPieceLocal(type, mirror = false) {
  const key = `${type}|${mirror ? 1 : 0}`;
  if (cache.has(key)) return cache.get(key);
  const def = PIECES[type];
  if (!def) throw new Error(`Unknown piece type: ${type}`);

  const mb = new MeshBuilder();
  const centerline = [];
  const pillars = [];

  for (const sw of def.sweeps) {
    const path = mirror ? mirrorPath(sw.path) : sw.path;
    const up = sw.up ? (mirror ? (t) => { const u = sw.up(t); return [-u[0], u[1], u[2]]; } : sw.up) : null;
    const frames = sweepFrames(path, up, sw.segments);
    let profile;
    if (sw.platform) {
      profile = roadProfile({ walls: false, roadColor: COLORS.platform });
    } else if (sw.boost) {
      profile = roadProfile({ roadColor: COLORS.boost, surface: SURFACE.BOOST });
    } else if (sw.solid) {
      profile = roadProfile({ bottom: null });
    } else {
      profile = roadProfile();
    }
    sweep(mb, frames, profile, {
      capStart: sw.capStart !== false,
      capEnd: sw.capEnd !== false,
      groundY: 0,
    });
    for (const f of frames) centerline.push(f);

    if (!sw.noPillars) {
      const len = pathLength(path);
      for (let s = TILE / 2; s < len; s += TILE) {
        const p = path(s / len);
        pillars.push([p[0], p[1] - DECK_THICKNESS, p[2]]);
      }
    }

    if (sw.boost) addBoostArrows(mb, frames);
  }

  if (def.gate) addGatePosts(mb, def.gate);

  const data = {
    positions: new Float32Array(mb.positions),
    colors: new Float32Array(mb.colors),
    tris: mb.tris,
    centerline,
    gates: def.gate ? [{ kind: def.gate, pos: [0, DECK, 0] }] : [],
    triggers:
      def.gate && def.gate !== 'start'
        ? [{ kind: def.gate, center: [0, DECK + 3, 0], half: [WALL_OUTER, 3.5, 1.5] }]
        : [],
    spawn: def.gate === 'start' ? { pos: [0, DECK + 0.75, -2], dir: [0, 0, 1] } : null,
    pillars,
  };
  cache.set(key, data);
  return data;
}

function addBoostArrows(mb, frames) {
  const lift = 0.02;
  const f0 = frames[0];
  const f1 = frames[frames.length - 1];
  const len = f1.p[2] - f0.p[2];
  const y = f0.p[1] + lift;
  const upQuad = (a, b, c, d) => {
    // Ensure the decal faces +Y regardless of the corner order given.
    const ny = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]);
    if (ny >= 0) mb.quad(a, b, c, d, COLORS.boostArrow);
    else mb.quad(d, c, b, a, COLORS.boostArrow);
  };
  for (let k = 0; k < 3; k++) {
    const z = f0.p[2] + len * (0.15 + k * 0.28);
    const w = 2.6;
    const d = 1.8;
    const th = 0.9;
    // Chevron pointing +Z made of two slanted arms.
    upQuad([-w, y, z], [0, y, z + d], [0, y, z + d + th], [-w, y, z + th]);
    upQuad([w, y, z], [w, y, z + th], [0, y, z + d + th], [0, y, z + d]);
  }
}

function addGatePosts(mb, kind) {
  const postColor = COLORS.post;
  const x = WALL_OUTER + 0.4;
  mb.box(-x, DECK + 3, 0, 0.35, 3, 0.35, postColor);
  mb.box(x, DECK + 3, 0, 0.35, 3, 0.35, postColor);
  // Foot blocks
  mb.box(-x, DECK + 0.3, 0, 0.6, 0.3, 0.6, postColor);
  mb.box(x, DECK + 0.3, 0, 0.6, 0.3, 0.6, postColor);
  void kind;
}

/** Footprint, exit and occupancy after rotation/mirroring. */
export function pieceCells(type, mirror = false) {
  return PIECES[type].cells.map(([dx, dz]) => [mirror ? -dx : dx, dz]);
}

export function pieceExit(type, mirror = false) {
  const e = PIECES[type].exit;
  return mirror ? { dx: -e.dx, dz: e.dz, dl: e.dl, dd: -e.dd } : { ...e };
}
