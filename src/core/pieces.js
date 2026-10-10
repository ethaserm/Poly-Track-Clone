import { DECK, DECK_THICKNESS, LEVEL, SURFACE, TILE, WALL_HEIGHT, WALL_OUTER } from './constants.js';
import { COLORS, MeshBuilder, addCenterDashes, frameAt, pathLength, roadProfile, sweep, sweepFrames } from './sweep.js';
import { add, normalize, scale, smoothstep } from './vec.js';

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

/** Bank angle that eases in and out over `ease` of the piece. */
const bankProfile = (maxBank, ease = 0.28) => (t) =>
  maxBank * smoothstep(Math.min(1, t / ease)) * smoothstep(Math.min(1, (1 - t) / ease));

/** Arc whose centre line rises so the inner edge stays at deck height while banked. */
const bankedArcPath = (cx, cz, r, bank) => {
  const arc = arcPath(cx, cz, r);
  return (t) => {
    const p = arc(t);
    return [p[0], p[1] + Math.sin(bank(t)) * WALL_OUTER, p[2]];
  };
};

const LOOP_R = 14;
const LOOP_Z = 10;
const LOOP_SHIFT = TILE;
const loopPath = (t) => {
  const a = t * Math.PI * 2;
  return [LOOP_SHIFT * smoothstep(t), DECK + LOOP_R * (1 - Math.cos(a)), LOOP_Z + LOOP_R * Math.sin(a)];
};
const loopUp = (t) => {
  const a = t * Math.PI * 2;
  return [0, Math.cos(a), -Math.sin(a)];
};

const RAMP_RISE = 2.4;
const rampPath = (t) => [0, DECK + RAMP_RISE * t * t, -H + TILE * t];

const chicanePath = (t) => [TILE * smoothstep(t), DECK, -H + TILE * 2 * t];

const BUMP_H = 0.42;
const bumpsPath = (t) => [0, DECK + BUMP_H * Math.sin(Math.PI * 3 * t) ** 2, -H + TILE * 2 * t];

const BANK = bankProfile(0.36);
const WALL_BANK = bankProfile(1.0, 0.5);
const WALL_R = TILE * 2 + H;
const SQUARE3 = [];
for (let x = 0; x < 3; x++) for (let z = 0; z < 3; z++) SQUARE3.push([x, z]);

// ---------------------------------------------------------------------------
// Piece catalogue
//   cells:  footprint in local cell coordinates [dx, dz]
//   height: levels occupied (for overlap checks in the editor)
//   exit:   where the road continues: next cell offset, level change, direction change
//   sweeps: road sections in driving order
// New types are appended at the end: share codes store the index into this list.
// ---------------------------------------------------------------------------

const ONE = [[0, 0]];
const TWO = [
  [0, 0],
  [0, 1],
];
const SQUARE2 = [
  [0, 0],
  [1, 0],
  [0, 1],
  [1, 1],
];

export const PIECES = {
  start: {
    name: 'Start',
    category: 'special',
    description: 'Where the car spawns. A track has exactly one.',
    cells: ONE,
    height: 2,
    exit: { dx: 0, dz: 1, dl: 0, dd: 0 },
    sweeps: [{ path: straightPath(), segments: 4, dashes: true }],
    gate: 'start',
  },
  finish: {
    name: 'Finish',
    category: 'special',
    description: 'Crossing it ends the run once every checkpoint is collected.',
    cells: ONE,
    height: 2,
    exit: { dx: 0, dz: 1, dl: 0, dd: 0 },
    sweeps: [{ path: straightPath(), segments: 4, dashes: true }],
    gate: 'finish',
  },
  checkpoint: {
    name: 'Checkpoint',
    category: 'special',
    description: 'Must be passed before finishing (any order). Respawns return here.',
    cells: ONE,
    height: 2,
    exit: { dx: 0, dz: 1, dl: 0, dd: 0 },
    sweeps: [{ path: straightPath(), segments: 4, dashes: true }],
    gate: 'checkpoint',
  },
  straight: {
    name: 'Straight',
    category: 'road',
    description: 'One cell of walled road.',
    cells: ONE,
    height: 1,
    exit: { dx: 0, dz: 1, dl: 0, dd: 0 },
    sweeps: [{ path: straightPath(), segments: 4, dashes: true }],
    lamps: true,
  },
  turn: {
    name: 'Turn',
    category: 'road',
    description: 'Tight 90° corner. Brake first!',
    cells: ONE,
    height: 1,
    exit: { dx: 1, dz: 0, dl: 0, dd: 1 },
    sweeps: [{ path: arcPath(H, -H, H), segments: 10, dashes: true }],
    signs: { cx: H, cz: -H, r: H, angles: [0.25, 0.5, 0.75] },
  },
  wideTurn: {
    name: 'Wide Turn',
    category: 'road',
    description: 'Fast sweeping 90° corner over 2×2 cells.',
    cells: SQUARE2,
    height: 1,
    exit: { dx: 2, dz: 1, dl: 0, dd: 1 },
    sweeps: [{ path: arcPath(TILE + H, -H, TILE + H), segments: 16, dashes: true }],
    signs: { cx: TILE + H, cz: -H, r: TILE + H, angles: [0.2, 0.4, 0.6, 0.8] },
  },
  slope: {
    name: 'Slope',
    category: 'slopes',
    description: 'Climbs two height steps over two cells. Expect air at speed.',
    cells: TWO,
    height: 3,
    exit: { dx: 0, dz: 2, dl: 2, dd: 0 },
    sweeps: [{ path: slopePath(2, LEVEL * 2), segments: 12, dashes: true }],
  },
  slopeLong: {
    name: 'Long Slope',
    category: 'slopes',
    description: 'Climbs four height steps over four cells.',
    cells: [
      [0, 0],
      [0, 1],
      [0, 2],
      [0, 3],
    ],
    height: 5,
    exit: { dx: 0, dz: 4, dl: 4, dd: 0 },
    sweeps: [{ path: slopePath(4, LEVEL * 4), segments: 20, dashes: true }],
  },
  boost: {
    name: 'Booster',
    category: 'special',
    description: 'Glowing pad that pushes the car forward hard.',
    cells: ONE,
    height: 1,
    exit: { dx: 0, dz: 1, dl: 0, dd: 0 },
    sweeps: [{ path: straightPath(), segments: 4, boost: true }],
  },
  ramp: {
    name: 'Ramp',
    category: 'jump',
    description: 'Kicker that launches the car. Leave a gap and a landing!',
    cells: ONE,
    height: 2,
    exit: { dx: 0, dz: 1, dl: 0, dd: 0 },
    sweeps: [{ path: rampPath, segments: 8, solid: true, hazard: true }],
  },
  loop: {
    name: 'Loop',
    category: 'jump',
    description: 'Full vertical loop. Needs about 60 km/h. F flips its direction.',
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
      { path: (t) => [0, DECK, -H + (LOOP_Z + H) * t], segments: 4, capEnd: false, dashes: true },
      { path: loopPath, up: loopUp, segments: 56, capStart: false, capEnd: false, noPillars: true, dashes: true },
      {
        path: (t) => [LOOP_SHIFT, DECK, LOOP_Z + (TILE * 3 - H - LOOP_Z) * t],
        segments: 4,
        capStart: false,
        dashes: true,
      },
    ],
  },
  platform: {
    name: 'Platform',
    category: 'blocks',
    description: 'Open square deck without walls. Good for landings.',
    cells: ONE,
    height: 1,
    exit: { dx: 0, dz: 1, dl: 0, dd: 0 },
    sweeps: [{ path: straightPath(), segments: 1, platform: true }],
  },
  // ---- added in v2 ---------------------------------------------------------
  bankTurn: {
    name: 'Banked Turn',
    category: 'road',
    description: 'Wide turn tilted into the corner — carry more speed.',
    cells: SQUARE2,
    height: 2,
    exit: { dx: 2, dz: 1, dl: 0, dd: 1 },
    sweeps: [{ path: bankedArcPath(TILE + H, -H, TILE + H, BANK), bank: BANK, segments: 20, dashes: true }],
    signs: { cx: TILE + H, cz: -H, r: TILE + H, angles: [0.3, 0.5, 0.7], bank: BANK },
  },
  wallTurn: {
    name: 'Wall Ride',
    category: 'road',
    description: 'Huge 3×3 corner that tilts up into a steep wall. Carry speed!',
    cells: SQUARE3,
    height: 4,
    exit: { dx: 3, dz: 2, dl: 0, dd: 1 },
    sweeps: [{ path: bankedArcPath(WALL_R, -H, WALL_R, WALL_BANK), bank: WALL_BANK, segments: 40, dashes: true, noPillars: true }],
    support: true,
  },
  chicane: {
    name: 'Chicane',
    category: 'road',
    description: 'S-bend that shifts one lane sideways over two cells.',
    cells: SQUARE2,
    height: 1,
    exit: { dx: 1, dz: 2, dl: 0, dd: 0 },
    sweeps: [{ path: chicanePath, segments: 16, dashes: true }],
  },
  bumps: {
    name: 'Bumps',
    category: 'slopes',
    description: 'Three humps that unsettle the car.',
    cells: TWO,
    height: 1,
    exit: { dx: 0, dz: 2, dl: 0, dd: 0 },
    sweeps: [{ path: bumpsPath, segments: 36, dashes: true }],
  },
  slopeShort: {
    name: 'Short Slope',
    category: 'slopes',
    description: 'Climbs one height step in a single cell.',
    cells: ONE,
    height: 2,
    exit: { dx: 0, dz: 1, dl: 1, dd: 0 },
    sweeps: [{ path: slopePath(1, LEVEL), segments: 8, dashes: true }],
  },
  ice: {
    name: 'Ice',
    category: 'surface',
    description: 'Slippery! Almost no grip and weak acceleration.',
    cells: ONE,
    height: 1,
    exit: { dx: 0, dz: 1, dl: 0, dd: 0 },
    sweeps: [{ path: straightPath(), segments: 4, surface: 'ice' }],
  },
  dirt: {
    name: 'Dirt',
    category: 'surface',
    description: 'Loose gravel road: less grip, a bit slower, throws up dust.',
    cells: ONE,
    height: 1,
    exit: { dx: 0, dz: 1, dl: 0, dd: 0 },
    sweeps: [{ path: straightPath(), segments: 4, surface: 'dirt' }],
  },
  tunnel: {
    name: 'Tunnel',
    category: 'road',
    description: 'Covered straight. Nice for building underpasses.',
    cells: ONE,
    height: 3,
    exit: { dx: 0, dz: 1, dl: 0, dd: 0 },
    sweeps: [{ path: straightPath(), segments: 4, dashes: true }],
    tunnel: true,
  },
  block: {
    name: 'Block',
    category: 'blocks',
    description: 'Solid drivable block, one height step tall. Stack them!',
    cells: ONE,
    height: 1,
    exit: { dx: 0, dz: 1, dl: 0, dd: 0 },
    sweeps: [],
    block: true,
  },
};

export const PIECE_TYPES = Object.keys(PIECES);

export const CATEGORIES = [
  { key: 'road', label: 'Road' },
  { key: 'slopes', label: 'Slopes' },
  { key: 'special', label: 'Special' },
  { key: 'jump', label: 'Jumps' },
  { key: 'surface', label: 'Surfaces' },
  { key: 'blocks', label: 'Blocks' },
];

// ---------------------------------------------------------------------------
// Local geometry generation (cached per type + mirror flag)
// ---------------------------------------------------------------------------

const cache = new Map();

function mirrorFn(fn) {
  return (t) => {
    const p = fn(t);
    return [-p[0], p[1], p[2]];
  };
}

function profileFor(sw) {
  if (sw.platform) return roadProfile({ walls: false, roadColor: COLORS.platform });
  if (sw.boost) return roadProfile({ roadColor: COLORS.boost, surface: SURFACE.BOOST });
  if (sw.solid) return roadProfile({ bottom: null });
  if (sw.surface === 'ice') return roadProfile({ roadColor: COLORS.ice, lineColor: COLORS.iceEdge, surface: SURFACE.ICE });
  if (sw.surface === 'dirt') return roadProfile({ roadColor: COLORS.dirt, lineColor: COLORS.dirtEdge, surface: SURFACE.DIRT });
  return roadProfile();
}

/**
 * Builds the local-space data for a piece:
 *   positions/colors/uvs  render triangles (non-indexed)
 *   tris                  collision triangles [a, b, c, surface]
 *   centerline            driving line samples [{p, T, S, N, surface}]
 *   gates                 start/checkpoint/finish arch placements
 *   triggers              local trigger boxes
 *   spawn                 car spawn (start piece)
 *   pillars               support points (local x, deck underside y, z)
 *   boostPads             glowing overlays for boosters
 *   lamps                 candidate lamp-post spots
 */
export function buildPieceLocal(type, mirror = false) {
  const key = `${type}|${mirror ? 1 : 0}`;
  if (cache.has(key)) return cache.get(key);
  const def = PIECES[type];
  if (!def) throw new Error(`Unknown piece type: ${type}`);

  const mb = new MeshBuilder();
  const centerline = [];
  const pillars = [];
  const boostPads = [];

  for (const sw of def.sweeps) {
    const path = mirror ? mirrorFn(sw.path) : sw.path;
    const up = sw.up ? (mirror ? mirrorFn(sw.up) : sw.up) : null;
    // Mirroring flips which side is "left", so banking flips sign too.
    const bank = sw.bank ? (mirror ? (t) => -sw.bank(t) : sw.bank) : null;
    const frames = sweepFrames(path, up, sw.segments, bank);
    sweep(mb, frames, profileFor(sw), {
      capStart: sw.capStart !== false,
      capEnd: sw.capEnd !== false,
      groundY: 0,
    });
    const surf = sw.boost ? SURFACE.BOOST : sw.surface === 'ice' ? SURFACE.ICE : sw.surface === 'dirt' ? SURFACE.DIRT : SURFACE.ROAD;
    for (const f of frames) centerline.push({ ...f, surface: surf });

    if (sw.dashes) addCenterDashes(mb, frames);
    if (sw.hazard) addHazardStripes(mb, frames);
    if (sw.boost) boostPads.push({ center: [0, DECK + 0.02, 0], size: [ROAD_PAD_W, TILE] });

    if (!sw.noPillars) {
      const len = pathLength(path);
      for (let s = TILE / 2; s < len; s += TILE) {
        const p = path(s / len);
        pillars.push([p[0], p[1] - DECK_THICKNESS, p[2]]);
      }
    }
  }

  if (def.signs) addTurnSigns(mb, def.signs, mirror);
  if (def.tunnel) addTunnel(mb);
  if (def.block) {
    addBlock(mb);
    // Driving line across the top (used by the autopilot).
    for (const f of sweepFrames(straightPath(), null, 4)) centerline.push({ ...f, surface: SURFACE.ROAD });
  }
  if (def.support) addWallSupports(mb, def, mirror, pillars);

  const data = {
    positions: new Float32Array(mb.positions),
    colors: new Float32Array(mb.colors),
    uvs: new Float32Array(mb.uvs),
    tris: mb.tris,
    centerline,
    gates: def.gate ? [{ kind: def.gate, pos: [0, DECK, 0] }] : [],
    triggers:
      def.gate && def.gate !== 'start'
        ? [{ kind: def.gate, center: [0, DECK + 3, 0], half: [WALL_OUTER, 3.5, 1.5] }]
        : [],
    spawn: def.gate === 'start' ? { pos: [0, DECK + 0.75, -2], dir: [0, 0, 1] } : null,
    pillars,
    boostPads,
    lamps: def.lamps
      ? [
          { pos: [WALL_OUTER + 0.55, DECK, 0], side: 1 },
          { pos: [-(WALL_OUTER + 0.55), DECK, 0], side: -1 },
        ]
      : [],
  };
  cache.set(key, data);
  return data;
}

const ROAD_PAD_W = 7.4;

/** Yellow/black warning stripes across the lip of a ramp. */
function addHazardStripes(mb, frames) {
  const end = frames[frames.length - 1].s;
  const depth = 1.1;
  const n = 12;
  const w = 8 / n;
  for (let k = 0; k < n; k++) {
    const color = k % 2 ? COLORS.hazardBlack : COLORS.hazardYellow;
    const u0 = -4 + k * w;
    const fa = frameAt(frames, end - depth);
    const fb = frameAt(frames, end - 0.02);
    const P = (f, u, skew) => add(add(f.p, scale(f.S, u + skew)), scale(f.N, 0.015));
    mb.quadToward(P(fa, u0, 0), P(fb, u0, 0.35), P(fb, u0 + w, 0.35), P(fa, u0 + w, 0), fa.N, color);
  }
}

/** Red/white marker boards along the outside wall of a corner. */
function addTurnSigns(mb, { cx, cz, r, angles, bank }, mirror) {
  const sx = mirror ? -1 : 1;
  for (const t of angles) {
    const a = Math.PI - (t * Math.PI) / 2;
    const b = bank ? bank(t) : 0;
    const rad = r + WALL_OUTER * Math.cos(b) - 0.3;
    // Banked corners raise the outer wall.
    const lift = bank ? Math.sin(b) * WALL_OUTER * 2 : 0;
    const x = (cx + rad * Math.cos(a)) * sx;
    const z = cz + rad * Math.sin(a);
    const inward = normalize([(cx * sx - x), 0, cz - z]);
    const up = [0, 1, 0];
    const side = [inward[2], 0, -inward[0]];
    const baseY = DECK + WALL_HEIGHT + lift;
    // Posts
    for (const o of [-0.65, 0.65]) {
      mb.obox(add([x, baseY + 0.45, z], scale(side, o)), side, up, inward, 0.05, 0.45, 0.05, COLORS.post);
    }
    // Board
    const c = [x, baseY + 1.15, z];
    mb.obox(c, side, up, inward, 0.9, 0.42, 0.05, COLORS.post);
    const n = 6;
    for (let k = 0; k < n; k++) {
      const u0 = -0.86 + (k * 1.72) / n;
      const u1 = u0 + 1.72 / n;
      const P = (u, v) => add(add(add(c, scale(side, u)), scale(up, v)), scale(inward, 0.056));
      const color = k % 2 ? COLORS.signWhite : COLORS.signRed;
      // Faces the inside of the corner (towards the driver).
      mb.quadToward(P(u1 - 0.12, -0.38), P(u1 + 0.12, 0.38), P(u0 + 0.12, 0.38), P(u0 - 0.12, -0.38), inward, color);
    }
  }
}

/** Tall walls and a roof over a straight. */
function addTunnel(mb) {
  const top = DECK + 5.6;
  const wallIn = 4.0;
  const wallOut = WALL_OUTER;
  for (const side of [1, -1]) {
    const xi = side * wallIn;
    const xo = side * wallOut;
    // Inner face (collision) from the kerb top to the roof.
    const a = [xi, DECK + WALL_HEIGHT, -H];
    const b = [xi, DECK + WALL_HEIGHT, H];
    const c = [xi, top, H];
    const d = [xi, top, -H];
    mb.quadToward(a, b, c, d, [-side, 0, 0], COLORS.tunnelInner, SURFACE.WALL);
    // Outer face.
    const e = [xo, DECK + WALL_HEIGHT, -H];
    const f = [xo, DECK + WALL_HEIGHT, H];
    const g = [xo, top + 0.6, H];
    const k = [xo, top + 0.6, -H];
    mb.quadToward(e, f, g, k, [side, 0, 0], COLORS.tunnel);
    // Pillar ribs at the ends.
    for (const z of [-H + 0.3, H - 0.3]) mb.box(side * (wallIn + 0.3), DECK + 3.3, z, 0.32, 2.5, 0.3, COLORS.tunnel);
  }
  // Roof: underside (collision) and top.
  mb.quadToward([-wallIn, top, -H], [-wallIn, top, H], [wallIn, top, H], [wallIn, top, -H], [0, -1, 0], COLORS.tunnelInner, SURFACE.WALL);
  mb.quadToward([-wallOut, top + 0.6, -H], [wallOut, top + 0.6, -H], [wallOut, top + 0.6, H], [-wallOut, top + 0.6, H], [0, 1, 0], COLORS.tunnel);
  for (const z of [-H, H]) {
    const q = (x, y) => [x, y, z];
    mb.quadToward(q(-wallOut, top), q(wallOut, top), q(wallOut, top + 0.6), q(-wallOut, top + 0.6), [0, 0, Math.sign(z)], COLORS.tunnel);
  }
  // Light strip
  mb.quadToward([-0.3, top - 0.01, -H + 0.5], [-0.3, top - 0.01, H - 0.5], [0.3, top - 0.01, H - 0.5], [0.3, top - 0.01, -H + 0.5], [0, -1, 0], [1, 0.96, 0.82]);
}

/** Solid block whose top is flush with roads on the same level. */
function addBlock(mb) {
  const hx = H;
  const top = DECK;
  const bottom = DECK - LEVEL;
  const c = [0, (top + bottom) / 2, 0];
  const hy = (top - bottom) / 2;
  const p = (sx, sy, sz) => [c[0] + sx * hx, c[1] + sy * hy, c[2] + sz * hx];
  const uv = [
    [0, 0],
    [0, TILE],
    [TILE, TILE],
    [TILE, 0],
  ];
  mb.quad(p(-1, 1, -1), p(-1, 1, 1), p(1, 1, 1), p(1, 1, -1), COLORS.blockTop, SURFACE.ROAD, uv);
  mb.quad(p(-1, -1, 1), p(1, -1, 1), p(1, 1, 1), p(-1, 1, 1), COLORS.block, SURFACE.WALL);
  mb.quad(p(1, -1, -1), p(-1, -1, -1), p(-1, 1, -1), p(1, 1, -1), COLORS.block, SURFACE.WALL);
  mb.quad(p(1, -1, 1), p(1, -1, -1), p(1, 1, -1), p(1, 1, 1), COLORS.block, SURFACE.WALL);
  mb.quad(p(-1, -1, -1), p(-1, -1, 1), p(-1, 1, 1), p(-1, 1, -1), COLORS.block, SURFACE.WALL);
  // Edge trim
  for (const [x, z, w, d] of [
    [0, -hx + 0.1, hx, 0.1],
    [0, hx - 0.1, hx, 0.1],
    [-hx + 0.1, 0, 0.1, hx],
    [hx - 0.1, 0, 0.1, hx],
  ]) {
    mb.box(x, top + 0.01, z, w, 0.01, d, COLORS.line);
  }
}

/** Buttresses holding up the outside of a wall-ride. */
function addWallSupports(mb, def, mirror, pillars) {
  const sx = mirror ? -1 : 1;
  const cx = WALL_R;
  const cz = -H;
  for (const t of [0.2, 0.35, 0.5, 0.65, 0.8]) {
    const a = Math.PI - (t * Math.PI) / 2;
    const b = WALL_BANK(t);
    const r = WALL_R + WALL_OUTER * Math.cos(b) + 0.5;
    const x = (cx + r * Math.cos(a)) * sx;
    const z = cz + r * Math.sin(a);
    const h = DECK + Math.sin(b) * WALL_OUTER * 2;
    pillars.push([x, h, z]);
  }
}

/** Footprint, exit and occupancy after rotation/mirroring. */
export function pieceCells(type, mirror = false) {
  return PIECES[type].cells.map(([dx, dz]) => [mirror ? -dx : dx, dz]);
}

export function pieceExit(type, mirror = false) {
  const e = PIECES[type].exit;
  return mirror ? { dx: -e.dx, dz: e.dz, dl: e.dl, dd: -e.dd } : { ...e };
}
