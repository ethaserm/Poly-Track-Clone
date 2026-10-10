import * as THREE from 'three';
import { TILE } from '../core/constants.js';

export const THEMES = {
  summer: {
    label: 'Summer',
    skyTop: 0x3f8fd8,
    skyHorizon: 0xcfe8fb,
    skyBottom: 0x9fc7e6,
    fog: 0xc6e2f7,
    ground: 0x79bf5a,
    groundAlt: 0x6db04f,
    hemiSky: 0xd8ecff,
    hemiGround: 0xb4c7a4,
    sun: 0xfff3dc,
    mountains: [0x6f9c6a, 0x5d8b62, 0x7aa572],
    decor: ['pine', 'roundTree', 'rock', 'pine', 'roundTree', 'bush'],
  },
  winter: {
    label: 'Winter',
    skyTop: 0x6d93c2,
    skyHorizon: 0xe9f1fa,
    skyBottom: 0xc7d8ea,
    fog: 0xdfe9f4,
    ground: 0xf1f5fa,
    groundAlt: 0xe4ecf5,
    hemiSky: 0xeaf2ff,
    hemiGround: 0xd5dee9,
    sun: 0xfff6ea,
    mountains: [0xdfe7f1, 0xc6d3e2, 0xb3c3d6],
    decor: ['snowPine', 'snowPine', 'iceRock', 'snowPine', 'snowman'],
  },
  desert: {
    label: 'Desert',
    skyTop: 0x4d97d6,
    skyHorizon: 0xfbe2bd,
    skyBottom: 0xe9caa0,
    fog: 0xf3dcb8,
    ground: 0xe7c48b,
    groundAlt: 0xdcb67c,
    hemiSky: 0xfff0d8,
    hemiGround: 0xd9c09c,
    sun: 0xffe6c2,
    mountains: [0xd08e5a, 0xc27b4b, 0xdba06b],
    decor: ['cactus', 'redRock', 'cactus', 'deadBush', 'redRock'],
  },
};

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seedFrom(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return h >>> 0;
}

// --- Geometry helpers (non-indexed, vertex coloured, flat shaded) --------------

function colored(geom, color, jitter = 0, rng = Math.random) {
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
  g.deleteAttribute('normal');
  g.deleteAttribute('uv');
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

function decorGeometry(kind) {
  const parts = [];
  const add = (geom, color, x = 0, y = 0, z = 0, jitter = 0.08) => {
    geom.translate(x, y, z);
    parts.push(colored(geom, color, jitter));
  };
  switch (kind) {
    case 'pine':
      add(new THREE.CylinderGeometry(0.35, 0.45, 2, 6), 0x7a5232, 0, 1, 0);
      add(new THREE.ConeGeometry(2.6, 4, 7), 0x2f7d46, 0, 3.6, 0);
      add(new THREE.ConeGeometry(2, 3.4, 7), 0x37904f, 0, 5.6, 0);
      add(new THREE.ConeGeometry(1.3, 2.6, 7), 0x3fa159, 0, 7.4, 0);
      break;
    case 'roundTree':
      add(new THREE.CylinderGeometry(0.35, 0.5, 2.6, 6), 0x7d5434, 0, 1.3, 0);
      add(new THREE.IcosahedronGeometry(2.4, 0), 0x58a845, 0, 4.2, 0, 0.15);
      add(new THREE.IcosahedronGeometry(1.6, 0), 0x67b850, 1.2, 5.2, 0.4, 0.15);
      break;
    case 'bush':
      add(new THREE.IcosahedronGeometry(1.2, 0), 0x4f9a3c, 0, 0.7, 0, 0.2);
      add(new THREE.IcosahedronGeometry(0.9, 0), 0x5aa944, 0.9, 0.6, 0.2, 0.2);
      break;
    case 'rock':
      add(new THREE.DodecahedronGeometry(1.4, 0), 0x8c9096, 0, 0.7, 0, 0.2);
      break;
    case 'snowPine':
      add(new THREE.CylinderGeometry(0.35, 0.45, 2, 6), 0x6b4a32, 0, 1, 0);
      add(new THREE.ConeGeometry(2.6, 4, 7), 0x2b5f45, 0, 3.6, 0);
      add(new THREE.ConeGeometry(2.0, 3.2, 7), 0x336b4f, 0, 5.5, 0);
      add(new THREE.ConeGeometry(1.2, 1.6, 7), 0xf4f8fc, 0, 7.6, 0, 0.02);
      add(new THREE.ConeGeometry(2.1, 1.0, 7), 0xf4f8fc, 0, 4.9, 0, 0.02);
      break;
    case 'iceRock':
      add(new THREE.DodecahedronGeometry(1.5, 0), 0xb9d3ea, 0, 0.6, 0, 0.15);
      break;
    case 'snowman':
      add(new THREE.IcosahedronGeometry(1.0, 1), 0xf7fafd, 0, 0.9, 0, 0.03);
      add(new THREE.IcosahedronGeometry(0.7, 1), 0xf7fafd, 0, 2.2, 0, 0.03);
      add(new THREE.IcosahedronGeometry(0.48, 1), 0xf7fafd, 0, 3.1, 0, 0.03);
      add(new THREE.ConeGeometry(0.1, 0.5, 5).rotateX(Math.PI / 2), 0xf08a24, 0, 3.1, 0.6, 0);
      add(new THREE.CylinderGeometry(0.4, 0.4, 0.5, 8), 0x22252c, 0, 3.6, 0, 0);
      break;
    case 'cactus':
      add(new THREE.CylinderGeometry(0.45, 0.5, 4.4, 7), 0x4c9a4d, 0, 2.2, 0);
      add(new THREE.CylinderGeometry(0.3, 0.3, 1.6, 6), 0x55a656, 1.0, 2.6, 0);
      add(new THREE.BoxGeometry(0.9, 0.5, 0.5), 0x55a656, 0.55, 1.7, 0);
      add(new THREE.CylinderGeometry(0.28, 0.28, 1.4, 6), 0x55a656, -0.95, 3.2, 0);
      add(new THREE.BoxGeometry(0.8, 0.45, 0.45), 0x55a656, -0.5, 2.6, 0);
      break;
    case 'redRock':
      add(new THREE.CylinderGeometry(2.2, 3, 4.5, 6), 0xc1703f, 0, 2.25, 0, 0.12);
      add(new THREE.CylinderGeometry(1.6, 2.2, 2, 6), 0xcf7f4a, 0.4, 5.5, 0.2, 0.12);
      break;
    case 'deadBush':
      add(new THREE.IcosahedronGeometry(0.9, 0), 0xa98a55, 0, 0.6, 0, 0.25);
      break;
    default:
      add(new THREE.BoxGeometry(1, 1, 1), 0xff00ff, 0, 0.5, 0);
  }
  return mergeColored(parts);
}

const decorCache = new Map();
function getDecor(kind) {
  if (!decorCache.has(kind)) decorCache.set(kind, decorGeometry(kind));
  return decorCache.get(kind);
}

function skyMaterial(theme) {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    fog: false,
    uniforms: {
      top: { value: new THREE.Color(theme.skyTop) },
      horizon: { value: new THREE.Color(theme.skyHorizon) },
      bottom: { value: new THREE.Color(theme.skyBottom) },
    },
    vertexShader: `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww;
      }`,
    fragmentShader: `
      uniform vec3 top; uniform vec3 horizon; uniform vec3 bottom;
      varying vec3 vDir;
      void main() {
        float h = vDir.y;
        vec3 c = h > 0.0 ? mix(horizon, top, pow(min(h * 1.6, 1.0), 0.8)) : mix(horizon, bottom, min(-h * 4.0, 1.0));
        gl_FragColor = vec4(c, 1.0);
        #include <colorspace_fragment>
      }`,
  });
}

/**
 * Builds sky, lights, ground and scenery for a theme around the track bounds.
 * occupied: Set of "x,z" cell keys covered by track pieces (scenery avoids them).
 */
export function buildEnvironment(envName, { bounds, occupied, seed = 1, shadows = true, decorCount = 220 } = {}) {
  const theme = THEMES[envName] || THEMES.summer;
  const group = new THREE.Group();
  const rng = mulberry32(seed);

  const sky = new THREE.Mesh(new THREE.SphereGeometry(3000, 24, 12), skyMaterial(theme));
  sky.renderOrder = -1;
  sky.frustumCulled = false;
  group.add(sky);

  const hemi = new THREE.HemisphereLight(theme.hemiSky, theme.hemiGround, 1.35);
  group.add(hemi);
  const sun = new THREE.DirectionalLight(theme.sun, 2.3);
  sun.position.set(60, 120, 40);
  sun.castShadow = shadows;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = -80;
  sc.right = 80;
  sc.top = 80;
  sc.bottom = -80;
  sc.near = 1;
  sc.far = 400;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.03;
  group.add(sun);
  group.add(sun.target);

  // Centre of the play area.
  const b = bounds || { minX: -5, maxX: 5, minZ: -5, maxZ: 5 };
  const cx = ((b.minX + b.maxX) / 2) * TILE;
  const cz = ((b.minZ + b.maxZ) / 2) * TILE;
  const spanX = (b.maxX - b.minX + 1) * TILE;
  const spanZ = (b.maxZ - b.minZ + 1) * TILE;
  const radius = Math.max(spanX, spanZ) / 2 + 60;

  // Ground: low-poly faceted plane with subtle tint variation.
  const groundSize = 2600;
  const gg = new THREE.PlaneGeometry(groundSize, groundSize, 52, 52).rotateX(-Math.PI / 2).toNonIndexed();
  const gpos = gg.attributes.position;
  const gcol = new Float32Array(gpos.count * 3);
  const ca = new THREE.Color(theme.ground);
  const cb = new THREE.Color(theme.groundAlt);
  const tmp = new THREE.Color();
  for (let i = 0; i < gpos.count; i += 3) {
    tmp.copy(ca).lerp(cb, rng());
    for (let j = 0; j < 3; j++) {
      gcol[(i + j) * 3] = tmp.r;
      gcol[(i + j) * 3 + 1] = tmp.g;
      gcol[(i + j) * 3 + 2] = tmp.b;
    }
  }
  gg.setAttribute('color', new THREE.BufferAttribute(gcol, 3));
  gg.computeVertexNormals();
  const ground = new THREE.Mesh(
    gg,
    new THREE.MeshLambertMaterial({ vertexColors: true }),
  );
  ground.position.set(cx, 0, cz);
  ground.receiveShadow = shadows;
  group.add(ground);

  // Distant mountains / mesas.
  const mountainParts = [];
  const mCount = 46;
  for (let i = 0; i < mCount; i++) {
    const a = (i / mCount) * Math.PI * 2 + rng() * 0.1;
    const dist = Math.max(radius + 380, 700) + rng() * 500;
    const h = 60 + rng() * 160;
    const r = 80 + rng() * 120;
    const color = theme.mountains[i % theme.mountains.length];
    let geom;
    if (envName === 'desert' && rng() < 0.6) {
      geom = new THREE.CylinderGeometry(r * 0.6, r, h * 0.6, 6);
      geom.translate(0, h * 0.3, 0);
    } else {
      geom = new THREE.ConeGeometry(r, h, 5 + Math.floor(rng() * 3));
      geom.translate(0, h / 2, 0);
    }
    geom.rotateY(rng() * Math.PI);
    geom.translate(cx + Math.cos(a) * dist, -2, cz + Math.sin(a) * dist);
    mountainParts.push(colored(geom, color, 0.1, rng));
    if (envName !== 'desert' && h > 140) {
      const cap = new THREE.ConeGeometry(r * 0.32, h * 0.32, 5);
      cap.translate(cx + Math.cos(a) * dist, h * 0.84 - 2, cz + Math.sin(a) * dist);
      mountainParts.push(colored(cap, 0xf8fbff, 0.02, rng));
    }
  }
  const mountains = new THREE.Mesh(
    mergeColored(mountainParts),
    new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }),
  );
  group.add(mountains);

  // Scenery scattered around the track, avoiding track cells.
  const decorMat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.95 });
  const kinds = theme.decor;
  const buckets = new Map(kinds.map((k) => [k, []]));
  const dummy = new THREE.Object3D();
  const x0 = b.minX * TILE - 140;
  const x1 = b.maxX * TILE + 140;
  const z0 = b.minZ * TILE - 140;
  const z1 = b.maxZ * TILE + 140;
  let placed = 0;
  for (let tries = 0; tries < decorCount * 6 && placed < decorCount; tries++) {
    const x = x0 + rng() * (x1 - x0);
    const z = z0 + rng() * (z1 - z0);
    const gx = Math.round(x / TILE);
    const gz = Math.round(z / TILE);
    let blocked = false;
    for (let dx = -1; dx <= 1 && !blocked; dx++)
      for (let dz = -1; dz <= 1 && !blocked; dz++) if (occupied && occupied.has(`${gx + dx},${gz + dz}`)) blocked = true;
    if (blocked) continue;
    const kind = kinds[Math.floor(rng() * kinds.length)];
    dummy.position.set(x, 0, z);
    dummy.rotation.set(0, rng() * Math.PI * 2, 0);
    const s = 0.7 + rng() * 0.8;
    dummy.scale.set(s, s * (0.85 + rng() * 0.3), s);
    dummy.updateMatrix();
    buckets.get(kind).push(dummy.matrix.clone());
    placed++;
  }
  for (const [kind, mats] of buckets) {
    if (!mats.length) continue;
    const inst = new THREE.InstancedMesh(getDecor(kind), decorMat, mats.length);
    mats.forEach((m, i) => inst.setMatrixAt(i, m));
    inst.castShadow = shadows;
    inst.receiveShadow = shadows;
    group.add(inst);
  }

  // Clouds.
  const clouds = new THREE.Group();
  const cloudMat = new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true, transparent: true, opacity: 0.92 });
  for (let i = 0; i < 18; i++) {
    const c = new THREE.Group();
    const n = 3 + Math.floor(rng() * 4);
    for (let k = 0; k < n; k++) {
      const m = new THREE.Mesh(new THREE.IcosahedronGeometry(12 + rng() * 14, 0), cloudMat);
      m.position.set(k * 16 - n * 8, rng() * 6, rng() * 14 - 7);
      m.scale.y = 0.55;
      c.add(m);
    }
    const a = rng() * Math.PI * 2;
    const d = 150 + rng() * 650;
    c.position.set(cx + Math.cos(a) * d, 140 + rng() * 120, cz + Math.sin(a) * d);
    c.rotation.y = rng() * Math.PI;
    clouds.add(c);
  }
  group.add(clouds);

  const fog = new THREE.Fog(theme.fog, 250, 1900);

  return {
    group,
    theme,
    sun,
    hemi,
    fog,
    sky,
    /** Keep the sun's shadow frustum centred on the action. */
    update(target, dt = 0) {
      sun.position.set(target.x + 60, target.y + 120, target.z + 40);
      sun.target.position.copy(target);
      sky.position.copy(target);
      clouds.children.forEach((c, i) => {
        c.position.x += dt * (1.5 + (i % 3));
      });
    },
    dispose() {
      group.traverse((o) => {
        if (o.geometry && !(o instanceof THREE.InstancedMesh)) o.geometry.dispose();
        if (o.material) o.material.dispose?.();
      });
    },
  };
}
