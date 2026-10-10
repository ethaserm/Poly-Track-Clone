import { add, cross, normalize, scale, sub } from './vec.js';
import { DECK_THICKNESS, ROAD_HALF, SURFACE, WALL_HEIGHT, WALL_OUTER } from './constants.js';

export const COLORS = {
  asphalt: [0.23, 0.25, 0.3],
  asphaltDark: [0.2, 0.22, 0.27],
  line: [0.93, 0.93, 0.95],
  dash: [0.95, 0.93, 0.82],
  kerbRed: [0.86, 0.2, 0.22],
  kerbWhite: [0.95, 0.95, 0.95],
  wallOuter: [0.62, 0.65, 0.72],
  under: [0.42, 0.44, 0.5],
  boost: [0.95, 0.5, 0.08],
  boostArrow: [1.0, 0.92, 0.2],
  platform: [0.55, 0.58, 0.66],
  platformTile: [0.6, 0.63, 0.71],
  post: [0.3, 0.32, 0.38],
  ice: [0.72, 0.88, 0.97],
  iceEdge: [0.88, 0.96, 1.0],
  dirt: [0.55, 0.4, 0.26],
  dirtEdge: [0.45, 0.32, 0.2],
  hazardYellow: [1.0, 0.78, 0.08],
  hazardBlack: [0.1, 0.1, 0.12],
  signRed: [0.85, 0.15, 0.17],
  signWhite: [0.97, 0.97, 0.97],
  tunnel: [0.55, 0.57, 0.63],
  tunnelInner: [0.32, 0.34, 0.4],
  block: [0.66, 0.69, 0.76],
  blockTop: [0.75, 0.78, 0.85],
};

const NO_UV = [
  [0, 0],
  [0, 0],
  [0, 0],
];

/** Collects flat-shaded triangles plus collision triangles in a piece's local space. */
export class MeshBuilder {
  constructor() {
    this.positions = [];
    this.colors = [];
    this.uvs = [];
    this.tris = [];
  }

  tri(a, b, c, color, surface = null, uv = NO_UV) {
    this.positions.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
    for (let i = 0; i < 3; i++) this.colors.push(color[0], color[1], color[2]);
    this.uvs.push(uv[0][0], uv[0][1], uv[1][0], uv[1][1], uv[2][0], uv[2][1]);
    if (surface !== null) this.tris.push([a, b, c, surface]);
  }

  /** Quad with corners in counter-clockwise order (seen from the front). */
  quad(a, b, c, d, color, surface = null, uv = null) {
    if (uv) {
      this.tri(a, b, c, color, surface, [uv[0], uv[1], uv[2]]);
      this.tri(a, c, d, color, surface, [uv[0], uv[2], uv[3]]);
    } else {
      this.tri(a, b, c, color, surface);
      this.tri(a, c, d, color, surface);
    }
  }

  /** Quad whose winding is chosen so it faces direction `dir`. */
  quadToward(a, b, c, d, dir, color, surface = null, uv = null) {
    const n = cross(sub(b, a), sub(c, a));
    if (n[0] * dir[0] + n[1] * dir[1] + n[2] * dir[2] >= 0) this.quad(a, b, c, d, color, surface, uv);
    else this.quad(d, c, b, a, color, surface, uv ? [uv[3], uv[2], uv[1], uv[0]] : null);
  }

  /** Axis-aligned box, decorative unless a surface is given. */
  box(cx, cy, cz, hx, hy, hz, color, surface = null) {
    this.obox([cx, cy, cz], [1, 0, 0], [0, 1, 0], [0, 0, 1], hx, hy, hz, color, surface);
  }

  /** Oriented box with unit axes ax, ay, az (right-handed). */
  obox(c, ax, ay, az, hx, hy, hz, color, surface = null) {
    const p = (sx, sy, sz) => [
      c[0] + ax[0] * sx * hx + ay[0] * sy * hy + az[0] * sz * hz,
      c[1] + ax[1] * sx * hx + ay[1] * sy * hy + az[1] * sz * hz,
      c[2] + ax[2] * sx * hx + ay[2] * sy * hy + az[2] * sz * hz,
    ];
    const shade = (k) => [color[0] * k, color[1] * k, color[2] * k];
    this.quad(p(-1, 1, -1), p(-1, 1, 1), p(1, 1, 1), p(1, 1, -1), color, surface); // +y
    this.quad(p(-1, -1, -1), p(1, -1, -1), p(1, -1, 1), p(-1, -1, 1), shade(0.7), surface); // -y
    this.quad(p(-1, -1, 1), p(1, -1, 1), p(1, 1, 1), p(-1, 1, 1), shade(0.9), surface); // +z
    this.quad(p(1, -1, -1), p(-1, -1, -1), p(-1, 1, -1), p(1, 1, -1), shade(0.9), surface); // -z
    this.quad(p(1, -1, 1), p(1, -1, -1), p(1, 1, -1), p(1, 1, 1), shade(0.85), surface); // +x
    this.quad(p(-1, -1, -1), p(-1, -1, 1), p(-1, 1, 1), p(-1, 1, -1), shade(0.85), surface); // -x
  }
}

/**
 * Samples a path into orthonormal frames.
 * T = tangent, S = side (left of travel), N = surface normal, s = arc length.
 * upFn may return an up hint; bankFn(t) rolls the frame around T (radians; positive tilts the
 * surface normal towards the left, i.e. the left edge drops — banking into a left turn).
 */
export function sweepFrames(path, upFn, segments, bankFn = null) {
  const frames = [];
  const e = 1e-4;
  let s = 0;
  let prev = null;
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const p = path(t);
    const p0 = path(Math.max(0, t - e));
    const p1 = path(Math.min(1, t + e));
    const T = normalize(sub(p1, p0));
    const U = upFn ? upFn(t) : [0, 1, 0];
    let S = normalize(cross(U, T));
    let N = cross(T, S);
    if (bankFn) {
      const b = bankFn(t);
      const c = Math.cos(b);
      const sn = Math.sin(b);
      const S2 = [S[0] * c - N[0] * sn, S[1] * c - N[1] * sn, S[2] * c - N[2] * sn];
      const N2 = [N[0] * c + S[0] * sn, N[1] * c + S[1] * sn, N[2] * c + S[2] * sn];
      S = S2;
      N = N2;
    }
    if (prev) s += Math.hypot(p[0] - prev[0], p[1] - prev[1], p[2] - prev[2]);
    prev = p;
    frames.push({ t, p, T, S, N, s });
  }
  return frames;
}

/** Approximate arc length of a path. */
export function pathLength(path, samples = 64) {
  let len = 0;
  let prev = path(0);
  for (let i = 1; i <= samples; i++) {
    const p = path(i / samples);
    len += Math.hypot(p[0] - prev[0], p[1] - prev[1], p[2] - prev[2]);
    prev = p;
  }
  return len;
}

/**
 * A point on a cross-section. v === null means "down to the ground plane of the piece"
 * (local y = groundY), used for solid ramps.
 */
function sectionPoint(frame, u, v, groundY) {
  const base = add(frame.p, scale(frame.S, u));
  if (v === null) return [base[0], groundY, base[2]];
  return add(base, scale(frame.N, v));
}

/**
 * Extrudes a profile along frames.
 * profile.strips: [{ a:[u,v], b:[u,v], color | (segmentIndex)=>color, surface }]
 *   Strips must be ordered clockwise in (u,v) space so faces point outwards.
 * profile.caps: rectangles [u0, v0, u1, v1] closing the ends.
 * UVs: x runs across the profile (metres), y along the path (arc length, metres).
 */
export function sweep(mb, frames, profile, opts = {}) {
  const { capStart = true, capEnd = true, groundY = 0, sOffset = 0 } = opts;
  const n = frames.length - 1;
  let across = 0;
  for (const strip of profile.strips) {
    const len = Math.hypot(strip.b[0] - strip.a[0], (strip.b[1] ?? 0) - (strip.a[1] ?? 0)) || 0.5;
    const ua = across;
    const ub = across + len;
    across = ub;
    for (let i = 0; i < n; i++) {
      const f0 = frames[i];
      const f1 = frames[i + 1];
      const A0 = sectionPoint(f0, strip.a[0], strip.a[1], groundY);
      const B0 = sectionPoint(f0, strip.b[0], strip.b[1], groundY);
      const A1 = sectionPoint(f1, strip.a[0], strip.a[1], groundY);
      const B1 = sectionPoint(f1, strip.b[0], strip.b[1], groundY);
      const color = typeof strip.color === 'function' ? strip.color(i, f0) : strip.color;
      const surface = strip.surface ?? null;
      const s0 = f0.s + sOffset;
      const s1 = f1.s + sOffset;
      mb.tri(A0, A1, B0, color, surface, [
        [ua, s0],
        [ua, s1],
        [ub, s0],
      ]);
      mb.tri(B0, A1, B1, color, surface, [
        [ub, s0],
        [ua, s1],
        [ub, s1],
      ]);
    }
  }
  const capColor = profile.capColor || COLORS.under;
  for (const [u0, v0, u1, v1] of profile.caps || []) {
    if (capEnd) {
      const f = frames[n];
      const a = sectionPoint(f, u0, v0, groundY);
      const b = sectionPoint(f, u1, v0, groundY);
      const c = sectionPoint(f, u1, v1, groundY);
      const d = sectionPoint(f, u0, v1, groundY);
      mb.quad(a, b, c, d, capColor, SURFACE.WALL);
    }
    if (capStart) {
      const f = frames[0];
      const a = sectionPoint(f, u0, v0, groundY);
      const b = sectionPoint(f, u1, v0, groundY);
      const c = sectionPoint(f, u1, v1, groundY);
      const d = sectionPoint(f, u0, v1, groundY);
      mb.quad(d, c, b, a, capColor, SURFACE.WALL);
    }
  }
}

/** Interpolated point/frame at arc length s along frames. */
export function frameAt(frames, s) {
  let i = 0;
  while (i < frames.length - 2 && frames[i + 1].s < s) i++;
  const f0 = frames[i];
  const f1 = frames[i + 1] || f0;
  const k = f1.s > f0.s ? Math.min(1, Math.max(0, (s - f0.s) / (f1.s - f0.s))) : 0;
  const mix = (a, b) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
  return { p: mix(f0.p, f1.p), S: normalize(mix(f0.S, f1.S)), N: normalize(mix(f0.N, f1.N)), T: normalize(mix(f0.T, f1.T)) };
}

/** Painted dashed centre line, following the path. */
export function addCenterDashes(mb, frames, { dash = 2.4, gap = 2.6, width = 0.2, lift = 0.012, color = COLORS.dash, phase = 0.6 } = {}) {
  const total = frames[frames.length - 1].s;
  const step = Math.max(0.6, dash / 3);
  for (let s0 = phase; s0 < total - 0.3; s0 += dash + gap) {
    const s1 = Math.min(total - 0.2, s0 + dash);
    for (let a = s0; a < s1 - 1e-3; a += step) {
      const b = Math.min(s1, a + step);
      const fa = frameAt(frames, a);
      const fb = frameAt(frames, b);
      const P = (f, u) => add(add(f.p, scale(f.S, u)), scale(f.N, lift));
      mb.quadToward(P(fa, -width / 2), P(fb, -width / 2), P(fb, width / 2), P(fa, width / 2), fa.N, color);
    }
  }
}

const kerb = (i) => (i % 2 === 0 ? COLORS.kerbRed : COLORS.kerbWhite);

/** Standard walled road cross-section. */
export function roadProfile({
  roadColor = COLORS.asphalt,
  lineColor = COLORS.line,
  surface = SURFACE.ROAD,
  bottom = -DECK_THICKNESS,
  walls = true,
  wallHeight = WALL_HEIGHT,
  kerbColor = kerb,
} = {}) {
  const R = ROAD_HALF;
  const O = WALL_OUTER;
  const W = wallHeight;
  const L = 0.3; // painted edge line width
  if (!walls) {
    return {
      strips: [
        { a: [-O, bottom], b: [-O, 0], color: COLORS.wallOuter, surface: SURFACE.WALL },
        { a: [-O, 0], b: [-O + L, 0], color: lineColor, surface },
        { a: [-O + L, 0], b: [O - L, 0], color: roadColor, surface },
        { a: [O - L, 0], b: [O, 0], color: lineColor, surface },
        { a: [O, 0], b: [O, bottom], color: COLORS.wallOuter, surface: SURFACE.WALL },
        { a: [O, bottom], b: [-O, bottom], color: COLORS.under, surface: SURFACE.WALL },
      ],
      caps: [[-O, bottom, O, 0]],
    };
  }
  return {
    strips: [
      { a: [-O, bottom], b: [-O, W], color: COLORS.wallOuter, surface: SURFACE.WALL },
      { a: [-O, W], b: [-R, W], color: kerbColor, surface: SURFACE.WALL },
      { a: [-R, W], b: [-R, 0], color: kerbColor, surface: SURFACE.WALL },
      { a: [-R, 0], b: [-R + L, 0], color: lineColor, surface },
      { a: [-R + L, 0], b: [R - L, 0], color: roadColor, surface },
      { a: [R - L, 0], b: [R, 0], color: lineColor, surface },
      { a: [R, 0], b: [R, W], color: kerbColor, surface: SURFACE.WALL },
      { a: [R, W], b: [O, W], color: kerbColor, surface: SURFACE.WALL },
      { a: [O, W], b: [O, bottom], color: COLORS.wallOuter, surface: SURFACE.WALL },
      { a: [O, bottom], b: [-O, bottom], color: COLORS.under, surface: SURFACE.WALL },
    ],
    caps: [
      [-O, bottom, O, 0],
      [-O, 0, -R, W],
      [R, 0, O, W],
    ],
  };
}
