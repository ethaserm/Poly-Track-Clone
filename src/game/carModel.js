import * as THREE from 'three';
import { CAR } from '../core/physics.js';

// ---------------------------------------------------------------------------------------
// Body shape. The body is lofted through cross-sections ("stations") along the car's
// length. Each station is described by a handful of shape parameters; wheel arches are
// formed by pinching the lower body in around each axle while the fender flares out.
// Car axes: +Z forward, +Y up, +X left. The physics body centre is the origin.
// ---------------------------------------------------------------------------------------

const clamp01 = (v) => Math.min(1, Math.max(0, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (t) => t * t * (3 - 2 * t);

const FRONT_AXLE = CAR.wheels[0].z;
const REAR_AXLE = CAR.wheels[2].z;
const ARCH_HALF = 0.47;

function archMask(z, axle) {
  const d = Math.abs(z - axle);
  return clamp01((ARCH_HALF + 0.05 - d) / 0.1);
}

function bump(z, c, w) {
  const d = Math.abs(z - c) / w;
  return d >= 1 ? 0 : 0.5 + 0.5 * Math.cos(d * Math.PI);
}

/** Cabin height fraction: 0 at the base of the glass, 1 under the roof. */
function cabinFrac(z) {
  if (z >= 0.52) return 0;
  if (z >= -0.1) return smooth((0.52 - z) / 0.62);
  if (z >= -0.95) return 1;
  if (z >= -1.66) return smooth(1 - (-0.95 - z) / 0.71);
  return 0;
}

export function bodyParams(z) {
  const zn = clamp01((z - 1.72) / 0.5); // nose taper
  const zr = clamp01((-1.96 - z) / 0.2); // tail taper
  const arch = Math.max(archMask(z, FRONT_AXLE), archMask(z, REAR_AXLE));
  const fender = Math.max(bump(z, FRONT_AXLE, 0.66), bump(z, REAR_AXLE, 0.7));
  const bottom = -0.47 + zn * 0.13 + zr * 0.05;
  const sideW = 0.9 + 0.075 * fender - zn * zn * 0.24 - zr * 0.06;
  const shoulderY = lerp(0.04, 0.17, smooth(clamp01((0.9 - z) / 2.6))) + 0.07 * fender - zn * 0.17 + zr * 0.0;
  const f = cabinFrac(z);
  const roofY = shoulderY + 0.03 + f * (0.63 - shoulderY - 0.03);
  const roofW = lerp(sideW - 0.12, 0.62, f);
  const topY = roofY + (f > 0 ? 0.02 : 0.035);
  return {
    z,
    f,
    arch,
    pts: [
      [0, bottom],
      [lerp(0.84 - zn * 0.18, 0.5, arch), bottom],
      [lerp(sideW - 0.03, 0.55, arch), lerp(-0.22 + zn * 0.06, -0.01, arch)],
      [sideW, shoulderY - 0.1],
      [sideW - 0.05, shoulderY],
      [roofW, roofY],
      [roofW * 0.42, topY],
      [0, topY],
    ],
  };
}

function stations() {
  const zs = new Set([-2.17, -2.1, -1.98, -1.66, -0.95, -0.6, -0.3, -0.1, 0.2, 0.52, 1.72, 1.9, 2.05, 2.16, 2.24]);
  for (const axle of [FRONT_AXLE, REAR_AXLE]) {
    for (const o of [-0.62, -0.52, -0.42, -0.28, -0.14, 0, 0.14, 0.28, 0.42, 0.52, 0.62]) zs.add(+(axle + o).toFixed(3));
  }
  return [...zs].sort((a, b) => a - b);
}

/** Collects triangles into named buckets (one material each). */
class Buckets {
  constructor() {
    this.map = new Map();
  }
  tri(name, a, b, c) {
    if (!this.map.has(name)) this.map.set(name, []);
    this.map.get(name).push(...a, ...b, ...c);
  }
  geometries() {
    const out = {};
    for (const [name, arr] of this.map) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
      g.computeVertexNormals();
      out[name] = g;
    }
    return out;
  }
}

/** Adds a triangle making sure it faces away from `center`. */
function outwardTri(buckets, name, a, b, c, center) {
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
  const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  const nx = uy * vz - uz * vy;
  const ny = uz * vx - ux * vz;
  const nz = ux * vy - uy * vx;
  const mx = (a[0] + b[0] + c[0]) / 3 - center[0];
  const my = (a[1] + b[1] + c[1]) / 3 - center[1];
  const mz = (a[2] + b[2] + c[2]) / 3 - center[2];
  if (nx * mx + ny * my + nz * mz >= 0) buckets.tri(name, a, b, c);
  else buckets.tri(name, a, c, b);
}

function bandMaterial(band, s0, s1, livery) {
  const f = Math.min(s0.f, s1.f);
  const fMax = Math.max(s0.f, s1.f);
  const arch = Math.max(s0.arch, s1.arch);
  const zMid = (s0.z + s1.z) / 2;
  switch (band) {
    case 0:
      return 'trim';
    case 1:
      return arch > 0.5 ? 'trim' : 'accent';
    case 2:
      return arch > 0.5 ? 'paint' : livery === 'two-tone' ? 'accent' : 'paint';
    case 3:
      return 'paint';
    case 4:
      // Side windows between solid A- and C-pillars.
      return f > 0.12 && Math.min(s0.z, s1.z) > -1.5 && Math.max(s0.z, s1.z) < 0.5 ? 'glass' : 'paint';
    case 5:
      if (fMax > 0.05 && f < 0.999 && zMid > -1.5) return 'glass';
      return 'paint';
    case 6:
      if (fMax > 0.05 && f < 0.999 && zMid > -1.5) return 'glass';
      if (livery === 'stripe' || livery === 'two-tone') return 'accent';
      return zMid > 1.0 && livery === 'hood' ? 'accent' : 'paint';
    default:
      return 'paint';
  }
}

const geometryCache = new Map();

function buildBody(livery) {
  if (geometryCache.has(livery)) return geometryCache.get(livery);
  const b = new Buckets();
  const st = stations().map(bodyParams);
  const center = [0, 0.05, 0];
  for (let i = 0; i < st.length - 1; i++) {
    const s0 = st[i];
    const s1 = st[i + 1];
    for (let k = 0; k < s0.pts.length - 1; k++) {
      const name = bandMaterial(k, s0, s1, livery);
      for (const side of [1, -1]) {
        const a = [s0.pts[k][0] * side, s0.pts[k][1], s0.z];
        const b0 = [s0.pts[k + 1][0] * side, s0.pts[k + 1][1], s0.z];
        const c = [s1.pts[k][0] * side, s1.pts[k][1], s1.z];
        const d = [s1.pts[k + 1][0] * side, s1.pts[k + 1][1], s1.z];
        const ctr = [0, center[1], (s0.z + s1.z) / 2];
        outwardTri(b, name, a, c, b0, ctr);
        outwardTri(b, name, b0, c, d, ctr);
      }
    }
  }
  // End caps (fan from the middle of each end section).
  for (const [s, dir, name] of [
    [st[0], -1, 'trim'],
    [st[st.length - 1], 1, 'paint'],
  ]) {
    const cy = (s.pts[0][1] + s.pts[s.pts.length - 1][1]) / 2;
    const mid = [0, cy, s.z];
    for (const side of [1, -1]) {
      for (let k = 0; k < s.pts.length - 1; k++) {
        const a = [s.pts[k][0] * side, s.pts[k][1], s.z];
        const c = [s.pts[k + 1][0] * side, s.pts[k + 1][1], s.z];
        outwardTri(b, name, mid, a, c, [0, cy, s.z - dir]);
      }
    }
  }
  const geoms = b.geometries();
  geometryCache.set(livery, geoms);
  return geoms;
}

// --- Parts ---------------------------------------------------------------------------------

function box(w, h, d, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  if (rx || ry || rz) g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx, ry, rz)));
  g.translate(x, y, z);
  return g;
}

function merge(geoms) {
  let count = 0;
  const parts = geoms.map((g) => (g.index ? g.toNonIndexed() : g));
  for (const g of parts) count += g.attributes.position.count;
  const pos = new Float32Array(count * 3);
  let o = 0;
  for (const g of parts) {
    pos.set(g.attributes.position.array, o);
    o += g.attributes.position.array.length;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.computeVertexNormals();
  return out;
}

const topAt = (z) => bodyParams(z).pts[7][1];

let partCache = null;
function parts() {
  if (partCache) return partCache;
  const wingY = 0.7;
  const wingZ = -1.92;
  const trim = merge([
    box(1.62, 0.04, 0.36, 0, -0.43, 2.12), // splitter
    box(0.05, 0.12, 0.3, 0.78, -0.38, 2.06), // splitter end fences
    box(0.05, 0.12, 0.3, -0.78, -0.38, 2.06),
    box(1.36, 0.17, 0.26, 0, -0.37, -2.14), // diffuser
    ...[-0.45, -0.15, 0.15, 0.45].map((x) => box(0.03, 0.2, 0.32, x, -0.37, -2.14)),
    box(0.22, 0.012, 0.4, 0.34, topAt(1.25) - 0.005, 1.25, -0.08), // hood vents
    box(0.22, 0.012, 0.4, -0.34, topAt(1.25) - 0.005, 1.25, -0.08),
    box(0.012, 0.012, 0.36, 0, topAt(-1.1) + 0.18, -1.15, 0, 0, 0), // antenna
    box(0.06, 0.05, 0.06, 0, topAt(-1.1) + 0.01, -1.15),
    // Wing mounts (swan neck)
    box(0.04, 0.46, 0.1, 0.42, 0.44, -1.88, 0.25),
    box(0.04, 0.46, 0.1, -0.42, 0.44, -1.88, 0.25),
    // Mirror stalks
    box(0.14, 0.03, 0.04, 0.84, 0.25, 0.32),
    box(0.14, 0.03, 0.04, -0.84, 0.25, 0.32),
  ]);
  const wing = merge([
    box(1.9, 0.05, 0.42, 0, wingY, wingZ, -0.12),
    box(1.9, 0.07, 0.03, 0, wingY + 0.04, wingZ - 0.21, 0),
    box(0.03, 0.3, 0.56, 0.96, wingY - 0.04, wingZ - 0.02),
    box(0.03, 0.3, 0.56, -0.96, wingY - 0.04, wingZ - 0.02),
  ]);
  const mirrors = merge([box(0.2, 0.11, 0.12, 0.95, 0.27, 0.31, 0, 0.12), box(0.2, 0.11, 0.12, -0.95, 0.27, 0.31, 0, -0.12)]);
  const headlights = merge([
    box(0.36, 0.07, 0.16, 0.55, -0.075, 2.07, -0.5, 0.3),
    box(0.36, 0.07, 0.16, -0.55, -0.075, 2.07, -0.5, -0.3),
    box(0.5, 0.025, 0.05, 0, -0.27, 2.19, 0, 0, 0), // lower light strip
  ]);
  const tail = merge([box(0.46, 0.07, 0.04, 0.56, 0.06, -2.165), box(0.46, 0.07, 0.04, -0.56, 0.06, -2.165), box(0.5, 0.03, 0.03, 0, 0.1, -2.16)]);
  const reverse = merge([box(0.1, 0.05, 0.03, 0.24, -0.02, -2.17), box(0.1, 0.05, 0.03, -0.24, -0.02, -2.17)]);
  const exhaust = new THREE.CylinderGeometry(0.065, 0.07, 0.22, 10).rotateX(Math.PI / 2);
  const exhausts = merge([exhaust.clone().translate(0.3, -0.33, -2.18), exhaust.clone().translate(-0.3, -0.33, -2.18)]);
  const exhaustHoles = merge([
    new THREE.CircleGeometry(0.045, 10).rotateY(Math.PI).translate(0.3, -0.33, -2.295),
    new THREE.CircleGeometry(0.045, 10).rotateY(Math.PI).translate(-0.3, -0.33, -2.295),
  ]);
  const interior = merge([
    box(1.2, 0.26, 1.8, 0, 0.06, -0.55), // tub
    box(1.1, 0.12, 0.3, 0, 0.22, 0.2, -0.3), // dashboard
    box(0.3, 0.05, 0.05, 0, 0.3, 0.02, 0.3), // steering wheel
  ]);
  const helmet = merge([
    new THREE.IcosahedronGeometry(0.16, 1).translate(0, 0.36, -0.55),
    box(0.5, 0.18, 0.3, 0, 0.12, -0.62),
  ]);
  const visor = box(0.2, 0.07, 0.04, 0, 0.37, -0.42);
  const flame = new THREE.ConeGeometry(0.07, 0.55, 8).rotateX(-Math.PI / 2).translate(0, 0, -0.27);
  partCache = { trim, wing, mirrors, headlights, tail, reverse, exhausts, exhaustHoles, interior, helmet, visor, flame };
  return partCache;
}

let wheelCache = null;
function wheelParts() {
  if (wheelCache) return wheelCache;
  const r = CAR.wheelRadius;
  const profile = [
    [0.255, -0.16],
    [0.33, -0.165],
    [0.365, -0.14],
    [r, -0.1],
    [r, 0.1],
    [0.365, 0.14],
    [0.33, 0.165],
    [0.255, 0.16],
  ].map(([x, y]) => new THREE.Vector2(x, y));
  // Lathe around Y, then turn the axle onto X.
  const tyre = new THREE.LatheGeometry(profile, 18).rotateZ(Math.PI / 2);
  const tread = merge(
    Array.from({ length: 18 }, (_, i) => {
      const a = (i / 18) * Math.PI * 2;
      return box(0.24, 0.02, 0.07, 0, Math.cos(a) * (r + 0.004), Math.sin(a) * (r + 0.004), a);
    }),
  );
  const barrel = new THREE.CylinderGeometry(0.255, 0.255, 0.3, 16, 1, true).rotateZ(Math.PI / 2);
  // Rim face with five spokes (outer side is +X; mirrored for right-hand wheels).
  const spokes = merge([
    new THREE.CylinderGeometry(0.075, 0.075, 0.05, 10).rotateZ(Math.PI / 2).translate(0.12, 0, 0),
    ...Array.from({ length: 5 }, (_, i) => {
      const a = (i / 5) * Math.PI * 2;
      return box(0.035, 0.2, 0.06, 0.12, Math.cos(a) * 0.14, Math.sin(a) * 0.14, a);
    }),
    new THREE.TorusGeometry(0.235, 0.022, 4, 18).rotateY(Math.PI / 2).translate(0.13, 0, 0),
  ]);
  const disc = new THREE.CylinderGeometry(0.2, 0.2, 0.035, 18).rotateZ(Math.PI / 2).translate(-0.02, 0, 0);
  const caliper = box(0.09, 0.15, 0.13, 0.03, 0.12, -0.12, 0.6);
  wheelCache = { tyre, tread, barrel, spokes, disc, caliper };
  return wheelCache;
}

function numberTexture(n, color) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#ffffff';
  g.beginPath();
  g.arc(64, 64, 60, 0, Math.PI * 2);
  g.fill();
  g.lineWidth = 6;
  g.strokeStyle = color;
  g.stroke();
  g.fillStyle = '#16181f';
  g.font = '900 78px "Exo 2", "Trebuchet MS", sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(String(n), 64, 70);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/**
 * Detailed low-poly race car.
 * Options: color, accent, rim, livery ('stripe' | 'two-tone' | 'hood' | 'plain'), number,
 * ghost (translucent, no lights), envMap (reflections for paint/glass/chrome).
 */
export class CarModel {
  constructor({
    color = '#e8402f',
    accent = '#1d1f27',
    rim = '#c9ced8',
    livery = 'stripe',
    number = 7,
    ghost = false,
    shadows = true,
    envMap = null,
  } = {}) {
    this.ghost = ghost;
    const body = buildBody(livery);
    const p = parts();
    const w = wheelParts();
    this.group = new THREE.Group();
    this.chassis = new THREE.Group();
    this.group.add(this.chassis);

    const ghostOpts = ghost ? { transparent: true, opacity: 0.38, depthWrite: false } : {};
    const std = (o) => new THREE.MeshStandardMaterial({ flatShading: true, envMap, ...o, ...ghostOpts });
    this.paint = std({ color, roughness: 0.32, metalness: 0.35, envMapIntensity: 1.1 });
    this.accentMat = std({ color: accent, roughness: 0.4, metalness: 0.25, envMapIntensity: 0.9 });
    this.trimMat = std({ color: 0x17191f, roughness: 0.75, metalness: 0.1, envMapIntensity: 0.4 });
    this.glassMat = std({
      color: 0x0b1220,
      roughness: 0.05,
      metalness: 0.5,
      envMapIntensity: 1.3,
      transparent: true,
      opacity: ghost ? 0.3 : 0.84,
    });
    this.chromeMat = std({ color: 0xa9afba, roughness: 0.3, metalness: 1, envMapIntensity: 0.8 });
    this.tyreMat = std({ color: 0x1e2026, roughness: 0.92, metalness: 0, side: THREE.DoubleSide });
    this.rimMat = std({ color: rim, roughness: 0.28, metalness: 0.85, envMapIntensity: 1.2 });
    this.discMat = std({ color: 0x8c929c, roughness: 0.5, metalness: 0.8 });
    this.caliperMat = std({ color: 0xe8402f, roughness: 0.4, metalness: 0.2 });
    const emissive = (color, intensity) =>
      new THREE.MeshStandardMaterial({
        color: 0x111111,
        emissive: color,
        emissiveIntensity: ghost ? 0 : intensity,
        roughness: 0.3,
        ...ghostOpts,
      });
    this.headMat = emissive(0xfff3d6, 3.2);
    this.tailMat = emissive(0xff1e2e, 1.6);
    this.reverseMat = emissive(0xffffff, 0);

    const add = (geom, mat, parent = this.chassis) => {
      const m = new THREE.Mesh(geom, mat);
      parent.add(m);
      return m;
    };
    if (body.paint) add(body.paint, this.paint);
    if (body.accent) add(body.accent, this.accentMat);
    if (body.trim) add(body.trim, this.trimMat);
    if (body.glass) add(body.glass, this.glassMat).renderOrder = 1;
    add(p.trim, this.trimMat);
    add(p.wing, this.accentMat);
    add(p.mirrors, this.paint);
    add(p.headlights, this.headMat);
    add(p.tail, this.tailMat);
    add(p.reverse, this.reverseMat);
    add(p.exhausts, this.chromeMat);
    add(p.exhaustHoles, this.trimMat);
    if (!ghost) {
      add(p.interior, this.trimMat);
      add(p.helmet, std({ color: accent === '#f4f6fa' ? color : '#f4f6fa', roughness: 0.3 }));
      add(p.visor, this.glassMat);
      // Race numbers on the roof and doors.
      const numMat = new THREE.MeshStandardMaterial({ map: numberTexture(number, color), roughness: 0.4, transparent: true, polygonOffset: true, polygonOffsetFactor: -2 });
      this.numberMat = numMat;
      const roofZ = -0.5;
      const roof = new THREE.Mesh(new THREE.CircleGeometry(0.22, 20), numMat);
      roof.rotation.x = -Math.PI / 2;
      roof.position.set(0, topAt(roofZ) + 0.004, roofZ);
      this.chassis.add(roof);
      const sp = bodyParams(-0.25).pts;
      for (const side of [1, -1]) {
        const door = new THREE.Mesh(new THREE.CircleGeometry(0.17, 20), numMat);
        door.rotation.y = side * Math.PI / 2;
        door.position.set(side * (sp[3][0] + 0.006), -0.08, -0.25);
        this.chassis.add(door);
      }
      // Exhaust flames (shown when boosting or on backfire).
      const flameMat = new THREE.MeshBasicMaterial({
        color: 0xffa040,
        transparent: true,
        opacity: 0.85,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      this.flameMat = flameMat;
      this.flames = [0.3, -0.3].map((x) => {
        const f = new THREE.Mesh(p.flame, flameMat);
        f.position.set(x, -0.33, -2.28);
        f.visible = false;
        this.chassis.add(f);
        return f;
      });
    }

    this.wheels = CAR.wheels.map((def) => {
      const side = def.x > 0 ? 1 : -1;
      const pivot = new THREE.Group();
      pivot.position.set(def.x, -CAR.restLength + 0.05, def.z);
      const spin = new THREE.Group();
      spin.add(new THREE.Mesh(w.tyre, this.tyreMat));
      spin.add(new THREE.Mesh(w.tread, this.tyreMat));
      spin.add(new THREE.Mesh(w.barrel, this.trimMat));
      const spokes = new THREE.Mesh(w.spokes, this.rimMat);
      spokes.scale.x = side;
      spin.add(spokes);
      pivot.add(spin);
      const disc = new THREE.Mesh(w.disc, this.discMat);
      disc.scale.x = side;
      pivot.add(disc);
      const cal = new THREE.Mesh(w.caliper, this.caliperMat);
      cal.scale.x = side;
      pivot.add(cal);
      this.group.add(pivot);
      return { pivot, spin, def };
    });

    this.group.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = shadows && !ghost && o.material !== this.flameMat;
        o.receiveShadow = false;
        if (ghost) o.renderOrder = 2;
      }
    });
    this.flicker = 0;
  }

  setColors(color, accent, rim) {
    this.paint.color.set(color);
    if (accent) this.accentMat.color.set(accent);
    if (rim) this.rimMat.color.set(rim);
  }

  /** Light states: brake (0..1), reverse (bool), boost (0..1, exhaust flames). */
  setLights({ brake = 0, reverse = false, boost = 0 } = {}, dt = 1 / 60) {
    if (this.ghost) return;
    this.tailMat.emissiveIntensity = 1.6 + brake * 4.5;
    this.reverseMat.emissiveIntensity = reverse ? 3 : 0;
    if (this.flames) {
      this.flicker += dt * 40;
      const on = boost > 0.02;
      for (const [i, f] of this.flames.entries()) {
        f.visible = on;
        if (on) {
          const s = boost * (0.75 + 0.35 * Math.sin(this.flicker * (1.3 + i * 0.4)) * Math.sin(this.flicker * 0.7));
          f.scale.set(0.8 + s * 0.4, 0.8 + s * 0.4, Math.max(0.2, s * 1.6));
        }
      }
      this.flameMat.color.setHSL(0.07 + 0.05 * Math.sin(this.flicker), 1, 0.55);
    }
  }

  /** Sync with physics state (wheels, suspension and steering). */
  syncPhysics(car, alpha = 1, prevPos = null, prevQuat = null) {
    if (prevPos && alpha < 1) {
      this.group.position.lerpVectors(prevPos, car.pos, alpha);
      this.group.quaternion.slerpQuaternions(prevQuat, car.quat, alpha);
    } else {
      this.group.position.copy(car.pos);
      this.group.quaternion.copy(car.quat);
    }
    car.wheels.forEach((w, i) => {
      const view = this.wheels[i];
      const ext = w.contact ? CAR.restLength - w.comp : CAR.restLength;
      view.pivot.position.y += (-ext - view.pivot.position.y) * 0.6;
      view.pivot.rotation.y = w.front ? car.steerAngle : 0;
      view.spin.rotation.x = w.spin;
    });
    // Subtle body roll/pitch from suspension compression differences.
    const w = car.wheels;
    const roll = (w[0].comp + w[2].comp - w[1].comp - w[3].comp) * 0.25;
    const pitch = (w[2].comp + w[3].comp - w[0].comp - w[1].comp) * 0.2;
    this.chassis.rotation.z += (roll - this.chassis.rotation.z) * 0.3;
    this.chassis.rotation.x += (pitch - this.chassis.rotation.x) * 0.3;
  }

  /** Pose from raw transform (ghosts / replays). */
  setPose(pos, quat) {
    this.group.position.copy(pos);
    this.group.quaternion.copy(quat);
  }

  /** Replay/ghost wheel animation from recorded steering and speed. */
  animateWheels(steer, speed, dt) {
    for (const v of this.wheels) {
      v.pivot.rotation.y = v.def.front ? steer : 0;
      v.spin.rotation.x += (speed / CAR.wheelRadius) * dt;
      v.pivot.position.y = -CAR.restLength + 0.08;
    }
  }

  setOpacity(op) {
    this.group.traverse((o) => {
      if (o.isMesh) o.material.opacity = o.material === this.glassMat ? op * 0.8 : op;
    });
  }

  dispose() {
    const seen = new Set();
    this.group.traverse((o) => {
      if (o.isMesh && o.material && !seen.has(o.material)) {
        seen.add(o.material);
        o.material.map?.dispose();
        o.material.dispose();
      }
    });
  }
}
