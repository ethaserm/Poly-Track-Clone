import { add, cross, normalize, scale, sub } from './vec.js';
import { DECK_THICKNESS, ROAD_HALF, SURFACE, WALL_HEIGHT, WALL_OUTER } from './constants.js';

export const COLORS = {
  asphalt: [0.23, 0.25, 0.3],
  asphaltDark: [0.2, 0.22, 0.27],
  line: [0.93, 0.93, 0.95],
  kerbRed: [0.86, 0.2, 0.22],
  kerbWhite: [0.95, 0.95, 0.95],
  wallOuter: [0.62, 0.65, 0.72],
  under: [0.42, 0.44, 0.5],
  boost: [1.0, 0.55, 0.1],
  boostArrow: [1.0, 0.92, 0.2],
  platform: [0.55, 0.58, 0.66],
  platformTile: [0.6, 0.63, 0.71],
  post: [0.3, 0.32, 0.38],
};

/** Collects flat-shaded triangles plus collision triangles in a piece's local space. */
export class MeshBuilder {
  constructor() {
    this.positions = [];
    this.colors = [];
    this.tris = [];
  }

  tri(a, b, c, color, surface = null) {
    this.positions.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
    for (let i = 0; i < 3; i++) this.colors.push(color[0], color[1], color[2]);
    if (surface !== null) this.tris.push([a, b, c, surface]);
  }

  /** Quad with corners in counter-clockwise order (seen from the front). */
  quad(a, b, c, d, color, surface = null) {
    this.tri(a, b, c, color, surface);
    this.tri(a, c, d, color, surface);
  }

  /** Axis-aligned box, decorative unless a surface is given. */
  box(cx, cy, cz, hx, hy, hz, color, surface = null) {
    const p = (sx, sy, sz) => [cx + sx * hx, cy + sy * hy, cz + sz * hz];
    const shade = (k) => [color[0] * k, color[1] * k, color[2] * k];
    this.quad(p(-1, 1, -1), p(-1, 1, 1), p(1, 1, 1), p(1, 1, -1), color, surface); // top
    this.quad(p(-1, -1, -1), p(1, -1, -1), p(1, -1, 1), p(-1, -1, 1), shade(0.7), surface); // bottom
    this.quad(p(-1, -1, 1), p(1, -1, 1), p(1, 1, 1), p(-1, 1, 1), shade(0.9), surface); // +z
    this.quad(p(1, -1, -1), p(-1, -1, -1), p(-1, 1, -1), p(1, 1, -1), shade(0.9), surface); // -z
    this.quad(p(1, -1, 1), p(1, -1, -1), p(1, 1, -1), p(1, 1, 1), shade(0.85), surface); // +x
    this.quad(p(-1, -1, -1), p(-1, -1, 1), p(-1, 1, 1), p(-1, 1, -1), shade(0.85), surface); // -x
  }
}

/**
 * Samples a path into orthonormal frames.
 * T = tangent, S = side (left of travel), N = surface normal.
 */
export function sweepFrames(path, upFn, segments) {
  const frames = [];
  const e = 1e-4;
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const p = path(t);
    const p0 = path(Math.max(0, t - e));
    const p1 = path(Math.min(1, t + e));
    const T = normalize(sub(p1, p0));
    const U = upFn ? upFn(t) : [0, 1, 0];
    const S = normalize(cross(U, T));
    const N = cross(T, S);
    frames.push({ t, p, T, S, N });
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
 */
export function sweep(mb, frames, profile, opts = {}) {
  const { capStart = true, capEnd = true, groundY = 0 } = opts;
  const n = frames.length - 1;
  for (const strip of profile.strips) {
    for (let i = 0; i < n; i++) {
      const f0 = frames[i];
      const f1 = frames[i + 1];
      const A0 = sectionPoint(f0, strip.a[0], strip.a[1], groundY);
      const B0 = sectionPoint(f0, strip.b[0], strip.b[1], groundY);
      const A1 = sectionPoint(f1, strip.a[0], strip.a[1], groundY);
      const B1 = sectionPoint(f1, strip.b[0], strip.b[1], groundY);
      const color = typeof strip.color === 'function' ? strip.color(i) : strip.color;
      const surface = strip.surface ?? null;
      mb.tri(A0, A1, B0, color, surface);
      mb.tri(B0, A1, B1, color, surface);
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

const kerb = (i) => (i % 2 === 0 ? COLORS.kerbRed : COLORS.kerbWhite);

/** Standard walled road cross-section. */
export function roadProfile({
  roadColor = COLORS.asphalt,
  surface = SURFACE.ROAD,
  bottom = -DECK_THICKNESS,
  walls = true,
} = {}) {
  const R = ROAD_HALF;
  const O = WALL_OUTER;
  const W = WALL_HEIGHT;
  const L = 0.3; // painted edge line width
  if (!walls) {
    return {
      strips: [
        { a: [-O, bottom], b: [-O, 0], color: COLORS.wallOuter, surface: SURFACE.WALL },
        { a: [-O, 0], b: [-O + L, 0], color: COLORS.line, surface },
        { a: [-O + L, 0], b: [O - L, 0], color: roadColor, surface },
        { a: [O - L, 0], b: [O, 0], color: COLORS.line, surface },
        { a: [O, 0], b: [O, bottom], color: COLORS.wallOuter, surface: SURFACE.WALL },
        { a: [O, bottom], b: [-O, bottom], color: COLORS.under, surface: SURFACE.WALL },
      ],
      caps: [[-O, bottom, O, 0]],
    };
  }
  return {
    strips: [
      { a: [-O, bottom], b: [-O, W], color: COLORS.wallOuter, surface: SURFACE.WALL },
      { a: [-O, W], b: [-R, W], color: kerb, surface: SURFACE.WALL },
      { a: [-R, W], b: [-R, 0], color: kerb, surface: SURFACE.WALL },
      { a: [-R, 0], b: [-R + L, 0], color: COLORS.line, surface },
      { a: [-R + L, 0], b: [R - L, 0], color: roadColor, surface },
      { a: [R - L, 0], b: [R, 0], color: COLORS.line, surface },
      { a: [R, 0], b: [R, W], color: kerb, surface: SURFACE.WALL },
      { a: [R, W], b: [O, W], color: kerb, surface: SURFACE.WALL },
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
