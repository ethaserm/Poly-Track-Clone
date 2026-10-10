import * as THREE from 'three';

// Procedural low-poly props: scenery (instanced), landmarks and trackside dressing.
// Everything is built from primitive geometry with per-face vertex colours.

export function colored(geom, color, jitter = 0, rng = Math.random) {
  const g = geom.index ? geom.toNonIndexed() : geom;
  const c = new THREE.Color(color);
  const n = g.attributes.position.count;
  const cols = new Float32Array(n * 3);
  for (let i = 0; i < n; i += 3) {
    const k = 1 + (rng() - 0.5) * jitter;
    for (let j = 0; j < 3; j++) {
      cols[(i + j) * 3] = c.r * k;
      cols[(i + j) * 3 + 1] = c.g * k;
      cols[(i + j) * 3 + 2] = c.b * k;
    }
  }
  g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  if (g.attributes.normal) g.deleteAttribute('normal');
  if (g.attributes.uv) g.deleteAttribute('uv');
  return g;
}

export function mergeColored(list) {
  let count = 0;
  for (const g of list) count += g.attributes.position.count;
  const pos = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);
  let o = 0;
  for (const g of list) {
    pos.set(g.attributes.position.array, o);
    col.set(g.attributes.color.array, o);
    o += g.attributes.position.array.length;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  out.computeVertexNormals();
  return out;
}

/** Small builder: add(geometry, colour, position, rotation, scale, jitter). */
class Parts {
  constructor() {
    this.list = [];
  }
  add(geom, color, [x = 0, y = 0, z = 0] = [], [rx = 0, ry = 0, rz = 0] = [], [sx = 1, sy = 1, sz = 1] = [], jitter = 0.08) {
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(x, y, z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)),
      new THREE.Vector3(sx, sy, sz),
    );
    geom.applyMatrix4(m);
    this.list.push(colored(geom, color, jitter));
    return this;
  }
  build() {
    return mergeColored(this.list);
  }
}

const cyl = (rt, rb, h, s = 7) => new THREE.CylinderGeometry(rt, rb, h, s);
const cone = (r, h, s = 7) => new THREE.ConeGeometry(r, h, s);
const ico = (r, d = 0) => new THREE.IcosahedronGeometry(r, d);
const dode = (r) => new THREE.DodecahedronGeometry(r, 0);
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);

/** Prism (triangular roof) along Z: width w, height h, length l. */
function roofPrism(w, h, l) {
  const shape = new THREE.Shape([new THREE.Vector2(-w / 2, 0), new THREE.Vector2(w / 2, 0), new THREE.Vector2(0, h)]);
  const g = new THREE.ExtrudeGeometry(shape, { depth: l, bevelEnabled: false });
  g.translate(0, 0, -l / 2);
  return g;
}

// ---------------------------------------------------------------------------------
// Instanced scenery
// ---------------------------------------------------------------------------------

export const DECOR_BUILDERS = {
  pine: (p) =>
    p
      .add(cyl(0.35, 0.45, 2), 0x7a5232, [0, 1, 0])
      .add(cone(2.6, 4), 0x2f7d46, [0, 3.6, 0])
      .add(cone(2, 3.4), 0x37904f, [0, 5.6, 0])
      .add(cone(1.3, 2.6), 0x3fa159, [0, 7.4, 0]),
  tallPine: (p) =>
    p
      .add(cyl(0.3, 0.42, 3), 0x6e4a2e, [0, 1.5, 0])
      .add(cone(2.2, 4.2), 0x2a6e3f, [0, 4.4, 0])
      .add(cone(1.8, 3.8), 0x317a47, [0, 6.6, 0])
      .add(cone(1.3, 3.2), 0x37874f, [0, 8.7, 0])
      .add(cone(0.8, 2.2), 0x3d9356, [0, 10.4, 0]),
  roundTree: (p) =>
    p
      .add(cyl(0.35, 0.5, 2.6, 6), 0x7d5434, [0, 1.3, 0])
      .add(ico(2.4), 0x58a845, [0, 4.2, 0], [], [], 0.15)
      .add(ico(1.6), 0x67b850, [1.2, 5.2, 0.4], [], [], 0.15)
      .add(ico(1.3), 0x4f9a3c, [-1.1, 4.6, -0.6], [], [], 0.15),
  birch: (p) =>
    p
      .add(cyl(0.18, 0.26, 5.5, 6), 0xf2efe6, [0, 2.75, 0], [], [], 0.02)
      .add(box(0.2, 0.12, 0.05), 0x2b2b2b, [0, 1.6, 0.22])
      .add(box(0.2, 0.1, 0.05), 0x2b2b2b, [0.05, 2.9, -0.2])
      .add(box(0.16, 0.1, 0.05), 0x2b2b2b, [-0.2, 3.9, 0.1], [0, 1.2, 0])
      .add(ico(1.7), 0x9ccc4a, [0, 5.6, 0], [], [1, 1.25, 1], 0.12)
      .add(ico(1.1), 0xb0d85a, [0.8, 6.6, 0.3], [], [], 0.12),
  bush: (p) =>
    p
      .add(ico(1.2), 0x4f9a3c, [0, 0.7, 0], [], [], 0.2)
      .add(ico(0.9), 0x5aa944, [0.9, 0.6, 0.2], [], [], 0.2)
      .add(ico(0.7), 0x63b04a, [-0.7, 0.5, -0.4], [], [], 0.2),
  flowers: (p) => {
    p.add(cyl(1.4, 1.5, 0.12, 8), 0x5aa944, [0, 0.06, 0], [], [], 0.1);
    const cols = [0xff6fa8, 0xffe14a, 0xffffff, 0xb57bff, 0xff8a3d];
    for (let i = 0; i < 9; i++) {
      const a = i * 2.4;
      const r = 0.3 + (i % 3) * 0.4;
      p.add(ico(0.16), cols[i % cols.length], [Math.cos(a) * r, 0.32, Math.sin(a) * r], [], [], 0.05);
      p.add(cyl(0.02, 0.02, 0.3, 3), 0x3f7a2f, [Math.cos(a) * r, 0.16, Math.sin(a) * r]);
    }
    return p;
  },
  grass: (p) => {
    for (let i = 0; i < 6; i++) {
      const a = i * 1.05;
      p.add(cone(0.12, 0.9 + (i % 3) * 0.3, 3), 0x6cbf4f, [Math.cos(a) * 0.35, 0.45, Math.sin(a) * 0.35], [Math.sin(a) * 0.3, 0, Math.cos(a) * 0.3], [], 0.2);
    }
    return p;
  },
  rock: (p) => p.add(dode(1.4), 0x8c9096, [0, 0.7, 0], [0.3, 0.5, 0], [1, 0.75, 1.2], 0.2).add(dode(0.7), 0x9aa0a6, [1.2, 0.35, 0.4], [], [], 0.2),
  hayBale: (p) =>
    p
      .add(cyl(0.75, 0.75, 1.3, 10), 0xe5c56a, [0, 0.75, 0], [0, 0, Math.PI / 2], [], 0.12)
      .add(cyl(0.76, 0.76, 0.1, 10), 0xc9a74d, [0.3, 0.75, 0], [0, 0, Math.PI / 2], [], 0.05),
  fence: (p) => {
    for (const x of [-2.4, 0, 2.4]) p.add(box(0.18, 1.2, 0.18), 0x8a6844, [x, 0.6, 0]);
    p.add(box(5, 0.14, 0.08), 0xa47e54, [0, 0.95, 0]);
    p.add(box(5, 0.14, 0.08), 0xa47e54, [0, 0.55, 0]);
    return p;
  },
  snowPine: (p) =>
    p
      .add(cyl(0.35, 0.45, 2), 0x6b4a32, [0, 1, 0])
      .add(cone(2.6, 4), 0x2b5f45, [0, 3.6, 0])
      .add(cone(2.0, 3.2), 0x336b4f, [0, 5.5, 0])
      .add(cone(1.2, 1.6), 0xf4f8fc, [0, 7.6, 0], [], [], 0.02)
      .add(cone(2.1, 1.0), 0xf4f8fc, [0, 4.9, 0], [], [], 0.02)
      .add(cone(2.7, 0.7), 0xf4f8fc, [0, 2.95, 0], [], [], 0.02),
  snowPineTall: (p) =>
    p
      .add(cyl(0.3, 0.4, 3), 0x5e412d, [0, 1.5, 0])
      .add(cone(2.1, 4), 0x24543d, [0, 4.6, 0])
      .add(cone(1.6, 3.6), 0x2c6047, [0, 6.8, 0])
      .add(cone(1.0, 3), 0x336b4f, [0, 8.9, 0])
      .add(cone(0.6, 1.2), 0xf4f8fc, [0, 10.4, 0], [], [], 0.02)
      .add(cone(1.7, 0.8), 0xf4f8fc, [0, 5.9, 0], [], [], 0.02),
  bareTree: (p) =>
    p
      .add(cyl(0.22, 0.38, 4.5, 6), 0x5b4636, [0, 2.25, 0])
      .add(cyl(0.08, 0.14, 2.4, 5), 0x5b4636, [0.7, 4.3, 0], [0, 0, -0.7])
      .add(cyl(0.08, 0.14, 2.2, 5), 0x5b4636, [-0.6, 4.6, 0.2], [0.2, 0, 0.6])
      .add(cyl(0.06, 0.1, 1.8, 5), 0x5b4636, [0.1, 5.2, -0.6], [-0.6, 0, 0])
      .add(ico(0.5), 0xf4f8fc, [0, 4.6, 0], [], [1, 0.4, 1], 0.02),
  iceRock: (p) => p.add(dode(1.5), 0xb9d3ea, [0, 0.6, 0], [0.4, 0.2, 0], [1, 0.8, 1], 0.15).add(dode(0.8), 0xd7e8f6, [1.1, 0.5, -0.3], [], [], 0.1),
  snowDrift: (p) => p.add(ico(1.6, 1), 0xf6f9fd, [0, 0, 0], [], [1.6, 0.45, 1], 0.03),
  snowman: (p) =>
    p
      .add(ico(1.0, 1), 0xf7fafd, [0, 0.9, 0], [], [], 0.03)
      .add(ico(0.7, 1), 0xf7fafd, [0, 2.2, 0], [], [], 0.03)
      .add(ico(0.48, 1), 0xf7fafd, [0, 3.1, 0], [], [], 0.03)
      .add(cone(0.1, 0.5, 5), 0xf08a24, [0, 3.1, 0.6], [Math.PI / 2, 0, 0], [], 0)
      .add(cyl(0.4, 0.4, 0.5, 8), 0x22252c, [0, 3.6, 0], [], [], 0)
      .add(cyl(0.6, 0.6, 0.06, 8), 0x22252c, [0, 3.37, 0], [], [], 0)
      .add(box(1.4, 0.18, 0.18), 0xd8382f, [0, 2.65, 0.2], [0, 0, 0.1], [], 0),
  cactus: (p) =>
    p
      .add(cyl(0.45, 0.5, 4.4), 0x4c9a4d, [0, 2.2, 0])
      .add(ico(0.45), 0x4c9a4d, [0, 4.4, 0])
      .add(cyl(0.3, 0.3, 1.6, 6), 0x55a656, [1.0, 2.6, 0])
      .add(ico(0.3), 0x55a656, [1.0, 3.4, 0])
      .add(box(0.9, 0.5, 0.5), 0x55a656, [0.55, 1.7, 0])
      .add(cyl(0.28, 0.28, 1.4, 6), 0x55a656, [-0.95, 3.2, 0])
      .add(ico(0.28), 0x55a656, [-0.95, 3.9, 0])
      .add(box(0.8, 0.45, 0.45), 0x55a656, [-0.5, 2.6, 0]),
  barrelCactus: (p) =>
    p
      .add(cyl(0.7, 0.75, 1.0, 10), 0x4e9b52, [0, 0.5, 0], [], [], 0.12)
      .add(ico(0.7), 0x58a85b, [0, 1.0, 0], [], [1, 0.5, 1], 0.1)
      .add(ico(0.18), 0xff6fa8, [0, 1.38, 0], [], [], 0.05),
  palm: (p) => {
    for (let i = 0; i < 6; i++) p.add(cyl(0.28 - i * 0.02, 0.32 - i * 0.02, 1.4, 6), i % 2 ? 0x9a7046 : 0x8a6038, [i * 0.18, 0.7 + i * 1.3, 0], [0, 0, -0.1]);
    for (let k = 0; k < 7; k++) {
      const a = (k / 7) * Math.PI * 2;
      p.add(box(3.4, 0.08, 0.7), k % 2 ? 0x3f9a42 : 0x4aaa4a, [1.0 + Math.cos(a) * 1.6, 8.4, Math.sin(a) * 1.6], [0, -a, -0.35], [], 0.1);
    }
    return p.add(ico(0.35), 0x6b4a22, [1.0, 8.3, 0]);
  },
  redRock: (p) => p.add(cyl(2.2, 3, 4.5, 6), 0xc1703f, [0, 2.25, 0], [], [], 0.12).add(cyl(1.6, 2.2, 2, 6), 0xcf7f4a, [0.4, 5.5, 0.2], [], [], 0.12),
  smallRock: (p) => p.add(dode(0.9), 0xc98a58, [0, 0.4, 0], [0.4, 0.3, 0], [1.3, 0.7, 1], 0.2),
  deadBush: (p) =>
    p
      .add(ico(0.9), 0xa98a55, [0, 0.6, 0], [], [1, 0.8, 1], 0.25)
      .add(cyl(0.05, 0.08, 1.3, 4), 0x7d6440, [0.3, 0.9, 0], [0, 0, -0.5]),
};

const decorCache = new Map();
export function decorGeometry(kind) {
  if (!decorCache.has(kind)) {
    const builder = DECOR_BUILDERS[kind] || ((p) => p.add(box(1, 1, 1), 0xff00ff, [0, 0.5, 0]));
    decorCache.set(kind, builder(new Parts()).build());
  }
  return decorCache.get(kind);
}

// ---------------------------------------------------------------------------------
// Landmarks (animated parts are returned in userData)
// ---------------------------------------------------------------------------------

const propMat = () => new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.9 });

export function windmill() {
  const g = new THREE.Group();
  const body = new Parts()
    .add(cyl(1.6, 2.6, 12, 8), 0xf4f1ea, [0, 6, 0], [], [], 0.04)
    .add(cone(2.1, 2.6, 8), 0x9c3b2f, [0, 13.3, 0], [], [], 0.06)
    .add(box(1, 1.8, 0.2), 0x6b4a32, [0, 0.9, 2.3])
    .add(box(0.8, 0.8, 0.2), 0x2b3a4a, [0, 7, 2.05], [-0.22, 0, 0]);
  const mesh = new THREE.Mesh(body.build(), propMat());
  g.add(mesh);
  const rotor = new THREE.Group();
  rotor.position.set(0, 11.6, 2.2);
  const blades = new Parts().add(cyl(0.35, 0.35, 0.6, 8), 0x5b4636, [0, 0, 0], [Math.PI / 2, 0, 0]);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    blades.add(box(0.15, 7, 0.08), 0x6b4a32, [Math.sin(a) * 3.5, Math.cos(a) * 3.5, 0.2], [0, 0, -a]);
    blades.add(box(1.1, 5.4, 0.04), 0xece6d8, [Math.sin(a) * 4 + Math.cos(a) * 0.6, Math.cos(a) * 4 - Math.sin(a) * 0.6, 0.25], [0, 0, -a], [], 0.03);
  }
  rotor.add(new THREE.Mesh(blades.build(), propMat()));
  g.add(rotor);
  g.userData.spin = rotor;
  return g;
}

export function barn() {
  const p = new Parts()
    .add(box(9, 5, 12), 0xb43a2e, [0, 2.5, 0], [], [], 0.05)
    .add(roofPrism(10, 3.5, 12.6), 0x4a3b36, [0, 5, 0], [], [], 0.05)
    .add(box(3.2, 3.6, 0.2), 0xf4efe6, [0, 1.8, 6.05])
    .add(box(2.8, 3.2, 0.22), 0x8e2a22, [0, 1.7, 6.08])
    .add(box(0.2, 3.2, 0.24), 0xf4efe6, [0, 1.7, 6.1], [0, 0, 0.72])
    .add(box(0.2, 3.2, 0.24), 0xf4efe6, [0, 1.7, 6.1], [0, 0, -0.72])
    .add(box(1.2, 1.2, 0.2), 0xf4efe6, [0, 6, 6.05]);
  const mesh = new THREE.Mesh(p.build(), propMat());
  return mesh;
}

export function cottage() {
  const p = new Parts()
    .add(box(6, 3.6, 5), 0xf0e2c4, [0, 1.8, 0], [], [], 0.05)
    .add(roofPrism(6.2, 2.6, 6.8), 0x5b6b8c, [0, 3.6, 0], [0, Math.PI / 2, 0], [], 0.05)
    .add(box(1, 2, 0.15), 0x6b4a32, [0, 1, 2.55])
    .add(box(1, 0.9, 0.15), 0x9fd4ff, [-1.8, 2, 2.55])
    .add(box(1, 0.9, 0.15), 0x9fd4ff, [1.8, 2, 2.55])
    .add(box(0.7, 1.6, 0.7), 0x8a5a44, [1.8, 5, -0.8]);
  return new THREE.Mesh(p.build(), propMat());
}

export function cabin() {
  const p = new Parts();
  for (let i = 0; i < 6; i++) p.add(cyl(0.3, 0.3, 7.2, 6), i % 2 ? 0x7a5236 : 0x6b4730, [0, 0.3 + i * 0.55, 2.4], [0, 0, Math.PI / 2]);
  for (let i = 0; i < 6; i++) p.add(cyl(0.3, 0.3, 7.2, 6), i % 2 ? 0x7a5236 : 0x6b4730, [0, 0.3 + i * 0.55, -2.4], [0, 0, Math.PI / 2]);
  for (let i = 0; i < 6; i++) p.add(cyl(0.3, 0.3, 5.4, 6), i % 2 ? 0x6b4730 : 0x7a5236, [3.3, 0.55 + i * 0.55, 0], [Math.PI / 2, 0, 0]);
  for (let i = 0; i < 6; i++) p.add(cyl(0.3, 0.3, 5.4, 6), i % 2 ? 0x6b4730 : 0x7a5236, [-3.3, 0.55 + i * 0.55, 0], [Math.PI / 2, 0, 0]);
  p.add(roofPrism(6.6, 2.8, 8.2), 0xf4f8fc, [0, 3.4, 0], [0, Math.PI / 2, 0], [], 0.03)
    .add(box(1, 1.8, 0.2), 0x4a3324, [0, 1, 2.75])
    .add(box(0.9, 0.8, 0.2), 0xffd27a, [2, 1.8, 2.75], [], [], 0)
    .add(box(0.8, 2.4, 0.8), 0x7d7f86, [2, 5.4, -1]);
  const mesh = new THREE.Mesh(p.build(), propMat());
  mesh.userData.chimney = new THREE.Vector3(2, 6.8, -1);
  return mesh;
}

export function igloo() {
  const p = new Parts()
    .add(new THREE.SphereGeometry(2.6, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), 0xf4f8fc, [0, 0, 0], [], [], 0.04)
    .add(new THREE.CylinderGeometry(1, 1, 2, 8, 1, false, 0, Math.PI), 0xeef4fb, [0, 0, 2.6], [Math.PI / 2, 0, Math.PI / 2], [], 0.04)
    .add(box(1.2, 1.1, 0.2), 0x2c3440, [0, 0.55, 3.55]);
  return new THREE.Mesh(p.build(), propMat());
}

export function rockArch() {
  const p = new Parts()
    .add(cyl(2.4, 3.2, 10, 6), 0xc1703f, [-7, 5, 0], [], [], 0.12)
    .add(cyl(2.2, 3, 10, 6), 0xb8683a, [7, 5, 0], [], [], 0.12);
  for (let i = 0; i <= 8; i++) {
    const a = Math.PI * (i / 8);
    p.add(dode(2.4), i % 2 ? 0xcf7f4a : 0xc1703f, [-Math.cos(a) * 7, 10 + Math.sin(a) * 4.5, 0], [i, i * 0.5, 0], [1.1, 0.9, 1], 0.12);
  }
  return new THREE.Mesh(p.build(), propMat());
}

export function hotAirBalloon(color) {
  const g = new THREE.Group();
  const c = new THREE.Color(color);
  const env = new THREE.SphereGeometry(5, 12, 9);
  env.scale(1, 1.18, 1);
  const pos = env.attributes.position;
  const cols = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const a = Math.atan2(pos.getZ(i), pos.getX(i));
    const band = Math.floor(((a + Math.PI) / (Math.PI * 2)) * 12) % 2;
    const col = band ? c : new THREE.Color(0xffffff);
    cols.set([col.r, col.g, col.b], i * 3);
  }
  env.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  const envNI = env.toNonIndexed();
  envNI.computeVertexNormals();
  g.add(new THREE.Mesh(envNI, propMat()));
  const basket = new Parts()
    .add(box(1.6, 1.2, 1.6), 0x8a6038, [0, -8.6, 0])
    .add(cyl(0.03, 0.03, 3.4, 3), 0x3b3b3b, [0.7, -6.6, 0.7])
    .add(cyl(0.03, 0.03, 3.4, 3), 0x3b3b3b, [-0.7, -6.6, 0.7])
    .add(cyl(0.03, 0.03, 3.4, 3), 0x3b3b3b, [0.7, -6.6, -0.7])
    .add(cyl(0.03, 0.03, 3.4, 3), 0x3b3b3b, [-0.7, -6.6, -0.7])
    .add(cone(1.6, 1.4, 12), color, [0, -5.2, 0], [Math.PI, 0, 0]);
  g.add(new THREE.Mesh(basket.build(), propMat()));
  return g;
}

export function bird() {
  const g = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color: 0x2b2f38, side: THREE.DoubleSide });
  const wing = new THREE.BufferGeometry();
  wing.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0.3, 0, 0, -0.3, 1.3, 0, -0.1], 3));
  const l = new THREE.Mesh(wing, mat);
  const r = new THREE.Mesh(wing, mat);
  r.scale.x = -1;
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.14, 0.8), mat);
  g.add(l, r, body);
  g.userData.wings = [l, r];
  return g;
}

export function tumbleweed() {
  const p = new Parts();
  for (let i = 0; i < 9; i++) {
    p.add(new THREE.TorusGeometry(0.75, 0.05, 3, 9), i % 2 ? 0xa98a55 : 0x8f7445, [0, 0, 0], [i * 0.7, i * 1.3, i * 0.4], [], 0.1);
  }
  return new THREE.Mesh(p.build(), propMat());
}

// ---------------------------------------------------------------------------------
// Trackside dressing
// ---------------------------------------------------------------------------------

/**
 * Grandstand facing +Z (the road is in front of it). Returns { group, crowd } where crowd
 * holds instanced people to animate.
 */
export function grandstand(length = 28, rng = Math.random) {
  const g = new THREE.Group();
  const rows = 6;
  const step = 1.15;
  const rise = 0.75;
  const p = new Parts();
  for (let r = 0; r < rows; r++) {
    p.add(box(length, rise * (r + 1), step), r % 2 ? 0x9aa1ad : 0xa9b0bb, [0, (rise * (r + 1)) / 2, -r * step], [], [], 0.03);
    p.add(box(length, 0.12, 0.35), r % 2 ? 0x2b6cd6 : 0xd83a3a, [0, rise * (r + 1) + 0.25, -r * step - 0.25], [], [], 0.04);
  }
  const back = -(rows - 0.5) * step;
  p.add(box(length, 8, 0.3), 0x6d7480, [0, 4, back - 0.3]);
  for (const x of [-length / 2 + 0.3, length / 2 - 0.3]) {
    p.add(box(0.3, 8.5, 0.3), 0x4a505b, [x, 4.25, back - 0.2]);
    p.add(box(0.3, 8.5, 0.3), 0x4a505b, [x, 4.25, 1.2]);
    p.add(box(0.3, rows * rise + 0.5, (rows + 0.6) * step), 0x7f8693, [x, (rows * rise) / 2, back / 2 + 0.5]);
  }
  p.add(box(length + 1, 0.3, rows * step + 2.4), 0xe8ebf0, [0, 8.6, back / 2 + 0.6], [0.08, 0, 0]);
  p.add(box(length + 1, 0.6, 0.15), 0xd83a3a, [0, 8.3, 1.85]);
  g.add(new THREE.Mesh(p.build(), propMat()));

  // Crowd: bodies (coloured shirts) and heads.
  const spots = [];
  for (let r = 0; r < rows; r++) {
    for (let x = -length / 2 + 0.8; x < length / 2 - 0.6; x += 0.85) {
      if (rng() < 0.28) continue;
      spots.push([x + (rng() - 0.5) * 0.2, rise * (r + 1), -r * step - 0.15]);
    }
  }
  const bodyGeom = new THREE.BoxGeometry(0.5, 0.75, 0.32).translate(0, 0.375, 0);
  const headGeom = new THREE.BoxGeometry(0.32, 0.32, 0.32).translate(0, 0.95, 0);
  const bodyMat = new THREE.MeshStandardMaterial({ flatShading: true, roughness: 0.9 });
  const headMat = new THREE.MeshStandardMaterial({ flatShading: true, roughness: 0.9 });
  const bodies = new THREE.InstancedMesh(bodyGeom, bodyMat, spots.length);
  const heads = new THREE.InstancedMesh(headGeom, headMat, spots.length);
  const shirts = [0xe8402f, 0x3a6df0, 0xffd23f, 0x3ccf6e, 0xf4f6fa, 0x9a5cf0, 0xff8a1e, 0x1d1f27];
  const skins = [0xf1c8a0, 0xd9a47c, 0xa8724f, 0x7a4e33, 0xffd9b8];
  const m = new THREE.Matrix4();
  const col = new THREE.Color();
  spots.forEach((s, i) => {
    m.makeTranslation(s[0], s[1], s[2]);
    bodies.setMatrixAt(i, m);
    heads.setMatrixAt(i, m);
    bodies.setColorAt(i, col.set(shirts[Math.floor(rng() * shirts.length)]));
    heads.setColorAt(i, col.set(skins[Math.floor(rng() * skins.length)]));
  });
  g.add(bodies, heads);
  return { group: g, crowd: { bodies, heads, spots, phase: spots.map(() => rng() * 6.28) } };
}

const BRANDS = [
  { name: 'POLYFUEL', bg: '#ff8a1e', fg: '#1d1f27', sub: 'high-octane triangles' },
  { name: 'LOWPOLY', bg: '#1d1f27', fg: '#ffd23f', sub: 'TYRES · grip in every face' },
  { name: 'VERTEX', bg: '#2b6cd6', fg: '#ffffff', sub: 'ENERGY DRINK' },
  { name: 'FLATSHADE', bg: '#d83a3a', fg: '#ffffff', sub: 'COLA · zero gradients' },
  { name: 'GRIDBOX', bg: '#2fae5c', fg: '#ffffff', sub: 'RACING TEAM' },
  { name: 'NORMALS', bg: '#f4f6fa', fg: '#2b3442', sub: 'MOTOR OIL · always outward' },
];

const brandTex = new Map();
function brandTexture(i) {
  if (brandTex.has(i)) return brandTex.get(i);
  const b = BRANDS[i % BRANDS.length];
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = b.bg;
  g.fillRect(0, 0, 512, 256);
  g.fillStyle = 'rgba(255,255,255,0.12)';
  g.beginPath();
  g.moveTo(0, 256);
  g.lineTo(200, 0);
  g.lineTo(290, 0);
  g.lineTo(90, 256);
  g.fill();
  g.fillStyle = b.fg;
  g.font = 'italic 900 104px "Exo 2", "Trebuchet MS", sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(b.name, 256, 112);
  g.font = '700 30px "Exo 2", "Trebuchet MS", sans-serif';
  g.fillText(b.sub.toUpperCase(), 256, 196);
  g.strokeStyle = b.fg;
  g.lineWidth = 8;
  g.strokeRect(10, 10, 492, 236);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  brandTex.set(i, t);
  return t;
}

/** Billboard facing +Z. */
export function billboard(brandIndex) {
  const g = new THREE.Group();
  const frame = new Parts()
    .add(box(0.3, 6, 0.3), 0x4a505b, [-3.2, 3, -0.2])
    .add(box(0.3, 6, 0.3), 0x4a505b, [3.2, 3, -0.2])
    .add(box(8.6, 4.4, 0.2), 0x2b2f38, [0, 4.6, -0.25]);
  g.add(new THREE.Mesh(frame.build(), propMat()));
  const face = new THREE.Mesh(
    new THREE.PlaneGeometry(8.2, 4.1),
    new THREE.MeshStandardMaterial({ map: brandTexture(brandIndex), roughness: 0.6 }),
  );
  face.position.set(0, 4.6, -0.13);
  g.add(face);
  return g;
}

/** Tyre barrier: a row of stacked tyres along X. */
export function tireWall(count = 6) {
  const p = new Parts();
  for (let i = 0; i < count; i++) {
    for (let k = 0; k < 3; k++) {
      p.add(new THREE.TorusGeometry(0.38, 0.16, 5, 10), k === 2 && i % 2 ? 0xd83a3a : 0x23252b, [i * 0.95 - (count - 1) * 0.475, 0.16 + k * 0.3, 0], [Math.PI / 2, 0, 0], [], 0.05);
    }
  }
  return new THREE.Mesh(p.build(), propMat());
}

/** Small pit tent / gazebo. */
export function tent(color) {
  const p = new Parts()
    .add(cone(3.4, 1.6, 4), color, [0, 3.4, 0], [0, Math.PI / 4, 0], [], 0.04)
    .add(box(4.8, 0.4, 4.8), 0xf4f6fa, [0, 2.45, 0], [], [], 0.02);
  for (const [x, z] of [
    [-2.3, -2.3],
    [2.3, -2.3],
    [-2.3, 2.3],
    [2.3, 2.3],
  ])
    p.add(cyl(0.06, 0.06, 2.4, 5), 0xc9ced8, [x, 1.2, z]);
  p.add(box(2, 0.8, 1), 0x6d7480, [0, 0.4, -1.2]).add(box(1, 1.2, 0.6), 0xd83a3a, [1.4, 0.6, 0.6]);
  return new THREE.Mesh(p.build(), propMat());
}
