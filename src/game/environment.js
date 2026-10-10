import * as THREE from 'three';
import { DIRS, LEVEL, TILE, rotateXZ } from '../core/constants.js';
import { WATER_LEVEL } from '../core/terrain.js';
import { ParticleSystem, particleTexture } from './particles.js';
import {
  barn,
  billboard,
  bird,
  cabin,
  colored,
  cottage,
  decorGeometry,
  grandstand,
  hotAirBalloon,
  igloo,
  mergeColored,
  rockArch,
  tent,
  tireWall,
  tumbleweed,
  windmill,
} from './props.js';

export { mergeColored };
export { seedFrom } from '../core/terrain.js';

export const THEMES = {
  summer: {
    label: 'Summer',
    skyTop: 0x3f8fd8,
    skyHorizon: 0xcfe8fb,
    skyBottom: 0x9fc7e6,
    fog: 0xc6e2f7,
    ground: 0x79bf5a,
    groundAlt: 0x6db04f,
    rock: 0x8b9184,
    peak: 0xa3a79c,
    lakeBed: 0xb9a57a,
    water: [0x1d5f8a, 0x7cc6e8],
    hemiSky: 0xd8ecff,
    hemiGround: 0xb4c7a4,
    sun: 0xfff3dc,
    mountains: [0x6f9c6a, 0x5d8b62, 0x7aa572],
    decor: { pine: 3, tallPine: 2, roundTree: 3, birch: 2, bush: 3, flowers: 2, grass: 3, rock: 2, hayBale: 1 },
    hillDecor: { pine: 4, tallPine: 3, roundTree: 2, rock: 1 },
  },
  winter: {
    label: 'Winter',
    skyTop: 0x6d93c2,
    skyHorizon: 0xe9f1fa,
    skyBottom: 0xc7d8ea,
    fog: 0xdfe9f4,
    ground: 0xf1f5fa,
    groundAlt: 0xe4ecf5,
    rock: 0x7d8897,
    peak: 0xf8fbff,
    lakeBed: 0xbcd2e6,
    water: [0x2a5f84, 0x9fd0ea],
    hemiSky: 0xeaf2ff,
    hemiGround: 0xd5dee9,
    sun: 0xfff6ea,
    mountains: [0xdfe7f1, 0xc6d3e2, 0xb3c3d6],
    decor: { snowPine: 4, snowPineTall: 3, bareTree: 2, iceRock: 2, snowman: 1, snowDrift: 3 },
    hillDecor: { snowPine: 4, snowPineTall: 4, iceRock: 1 },
  },
  desert: {
    label: 'Desert',
    skyTop: 0x4d97d6,
    skyHorizon: 0xfbe2bd,
    skyBottom: 0xe9caa0,
    fog: 0xf3dcb8,
    ground: 0xe7c48b,
    groundAlt: 0xdcb67c,
    rock: 0xc98a58,
    peak: 0xb8683a,
    lakeBed: 0xc7a36a,
    water: [0x1f6c84, 0x6fd0d8],
    hemiSky: 0xfff0d8,
    hemiGround: 0xd9c09c,
    sun: 0xffe6c2,
    mountains: [0xd08e5a, 0xc27b4b, 0xdba06b],
    decor: { cactus: 4, barrelCactus: 3, redRock: 2, smallRock: 3, deadBush: 3 },
    hillDecor: { smallRock: 3, redRock: 2, cactus: 1 },
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

function pickWeighted(weights, rng) {
  const entries = Object.entries(weights);
  const total = entries.reduce((s, [, w]) => s + w, 0);
  let r = rng() * total;
  for (const [k, w] of entries) {
    r -= w;
    if (r <= 0) return k;
  }
  return entries[0][0];
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
      sunDir: { value: SUN_DIR.clone() },
      sunCol: { value: new THREE.Color(theme.sun) },
    },
    vertexShader: `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww;
      }`,
    fragmentShader: `
      uniform vec3 top; uniform vec3 horizon; uniform vec3 bottom; uniform vec3 sunDir; uniform vec3 sunCol;
      varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        float h = d.y;
        vec3 c = h > 0.0 ? mix(horizon, top, pow(min(h * 1.6, 1.0), 0.8)) : mix(horizon, bottom, min(-h * 4.0, 1.0));
        float s = max(dot(d, sunDir), 0.0);
        c += sunCol * (pow(s, 900.0) * 4.0 + pow(s, 60.0) * 0.35 + pow(s, 8.0) * 0.08);
        gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}

const SUN_DIR = new THREE.Vector3(60, 120, 40).normalize();

function waterMaterial(theme) {
  return new THREE.ShaderMaterial({
    transparent: true,
    fog: true,
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uTime: { value: 0 },
        uDeep: { value: new THREE.Color(theme.water[0]) },
        uShallow: { value: new THREE.Color(theme.water[1]) },
        uSky: { value: new THREE.Color(theme.skyHorizon) },
        uSun: { value: SUN_DIR.clone() },
      },
    ]),
    vertexShader: `
      #include <fog_pars_vertex>
      varying vec3 vWorld;
      varying vec2 vLocal;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorld = wp.xyz;
        vLocal = position.xy;
        vec4 mvPosition = viewMatrix * wp;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: `
      #include <common>
      #include <fog_pars_fragment>
      uniform float uTime; uniform vec3 uDeep; uniform vec3 uShallow; uniform vec3 uSky; uniform vec3 uSun;
      varying vec3 vWorld;
      varying vec2 vLocal;
      void main() {
        vec3 V = normalize(cameraPosition - vWorld);
        float a = vWorld.x * 0.45 + uTime * 1.2;
        float b = vWorld.z * 0.38 - uTime * 0.9;
        float c = (vWorld.x - vWorld.z) * 0.8 + uTime * 1.9;
        vec3 N = normalize(vec3(cos(a) * 0.09 + cos(c) * 0.04, 1.0, cos(b) * 0.09 - cos(c) * 0.04));
        float fres = pow(1.0 - max(dot(N, V), 0.0), 4.0);
        float edge = smoothstep(0.55, 1.0, length(vLocal) / ${'${R}'});
        vec3 col = mix(uDeep, uShallow, edge * 0.7);
        col = mix(col, uSky, 0.15 + fres * 0.7);
        vec3 H = normalize(uSun + V);
        col += vec3(1.0, 0.97, 0.9) * pow(max(dot(N, H), 0.0), 160.0) * 2.5;
        gl_FragColor = vec4(col, 0.86);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  });
}

function iceTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(256, 256, 30, 256, 256, 256);
  grd.addColorStop(0, '#cfe9fb');
  grd.addColorStop(1, '#a9d1ee');
  g.fillStyle = grd;
  g.fillRect(0, 0, 512, 512);
  g.strokeStyle = 'rgba(255,255,255,0.75)';
  g.lineWidth = 2;
  let seed = 99;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let k = 0; k < 26; k++) {
    let x = 256 + (rnd() - 0.5) * 300;
    let y = 256 + (rnd() - 0.5) * 300;
    g.beginPath();
    g.moveTo(x, y);
    for (let i = 0; i < 6; i++) {
      x += (rnd() - 0.5) * 90;
      y += (rnd() - 0.5) * 90;
      g.lineTo(x, y);
    }
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Faceted terrain mesh coloured by height and slope. */
function terrainMesh(terrain, theme, cx, cz, size, seg, rng) {
  const g = new THREE.PlaneGeometry(size, size, seg, seg).rotateX(-Math.PI / 2);
  g.translate(cx, 0, cz);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) pos.setY(i, terrain.height(pos.getX(i), pos.getZ(i)));
  const ng = g.toNonIndexed();
  const p = ng.attributes.position;
  const cols = new Float32Array(p.count * 3);
  const ca = new THREE.Color(theme.ground);
  const cb = new THREE.Color(theme.groundAlt);
  const rock = new THREE.Color(theme.rock);
  const peak = new THREE.Color(theme.peak);
  const bed = new THREE.Color(theme.lakeBed);
  const tmp = new THREE.Color();
  const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3(), N = new THREE.Vector3();
  for (let i = 0; i < p.count; i += 3) {
    A.fromBufferAttribute(p, i);
    B.fromBufferAttribute(p, i + 1);
    C.fromBufferAttribute(p, i + 2);
    N.subVectors(B, A).cross(C.clone().sub(A)).normalize();
    const ny = Math.abs(N.y);
    const h = (A.y + B.y + C.y) / 3;
    tmp.copy(ca).lerp(cb, rng());
    if (h < -0.4) tmp.copy(bed).multiplyScalar(0.9 + rng() * 0.15);
    else if (ny < 0.82) tmp.lerp(rock, Math.min(1, (0.82 - ny) * 4));
    if (h > 55) tmp.lerp(peak, Math.min(1, (h - 55) / 25));
    const k = 0.96 + rng() * 0.08;
    for (let j = 0; j < 3; j++) {
      cols[(i + j) * 3] = tmp.r * k;
      cols[(i + j) * 3 + 1] = tmp.g * k;
      cols[(i + j) * 3 + 2] = tmp.b * k;
    }
  }
  ng.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  ng.computeVertexNormals();
  return new THREE.Mesh(ng, new THREE.MeshLambertMaterial({ vertexColors: true }));
}

/**
 * Builds sky, lights, terrain, water, scenery, landmarks, trackside dressing and ambient
 * life for a theme.
 *   compiled: compiled track (terrain, pieces) — omit for the editor's flat world.
 *   quality:  graphics preset (decor density, terrain resolution, shadow map size).
 */
export function buildEnvironment(
  envName,
  { compiled = null, bounds, occupied, seed = 1, shadows = true, quality = null, decorCount = null } = {},
) {
  const theme = THEMES[envName] || THEMES.summer;
  const q = quality || { decor: 1, terrainSegments: 160, shadowMapSize: 2048 };
  const group = new THREE.Group();
  const rng = mulberry32(seed);
  const animated = { spinners: [], birds: [], balloons: [], weeds: [], crowds: [], smokers: [] };

  const sky = new THREE.Mesh(new THREE.SphereGeometry(3000, 32, 16), skyMaterial(theme));
  sky.renderOrder = -1;
  sky.frustumCulled = false;
  group.add(sky);

  const hemi = new THREE.HemisphereLight(theme.hemiSky, theme.hemiGround, 1.35);
  group.add(hemi);
  const sun = new THREE.DirectionalLight(theme.sun, 2.3);
  sun.position.copy(SUN_DIR).multiplyScalar(140);
  sun.castShadow = shadows;
  sun.shadow.mapSize.set(q.shadowMapSize || 2048, q.shadowMapSize || 2048);
  const sc = sun.shadow.camera;
  sc.left = -85;
  sc.right = 85;
  sc.top = 85;
  sc.bottom = -85;
  sc.near = 1;
  sc.far = 420;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.03;
  group.add(sun);
  group.add(sun.target);

  const b = bounds || compiled?.bounds || { minX: -5, maxX: 5, minZ: -5, maxZ: 5 };
  const cx = ((b.minX + b.maxX) / 2) * TILE;
  const cz = ((b.minZ + b.maxZ) / 2) * TILE;
  const spanX = (b.maxX - b.minX + 1) * TILE;
  const spanZ = (b.maxZ - b.minZ + 1) * TILE;
  const radius = Math.max(spanX, spanZ) / 2 + 60;
  const terrain = compiled?.terrain || null;
  const heightAt = (x, z) => (terrain ? terrain.height(x, z) : 0);

  // --- Ground -------------------------------------------------------------------------
  if (terrain) {
    const size = Math.max(2400, radius * 2 + 1400);
    const ground = terrainMesh(terrain, theme, cx, cz, size, q.terrainSegments || 160, rng);
    ground.receiveShadow = shadows;
    group.add(ground);
    // Far skirt so the horizon never shows the terrain edge.
    const far = new THREE.Mesh(
      new THREE.RingGeometry(size * 0.5 - 2, 6000, 48, 1).rotateX(-Math.PI / 2),
      new THREE.MeshLambertMaterial({ color: theme.groundAlt }),
    );
    far.position.set(cx, -0.5, cz);
    group.add(far);
    for (const lake of terrain.lakes) {
      if (lake.kind === 'water') {
        const mat = waterMaterial(theme);
        mat.fragmentShader = mat.fragmentShader.replace('${R}', (lake.r * 1.25).toFixed(2));
        const w = new THREE.Mesh(new THREE.CircleGeometry(lake.r * 1.25, 48), mat);
        w.rotation.x = -Math.PI / 2;
        w.position.set(lake.x, WATER_LEVEL, lake.z);
        w.renderOrder = 1;
        group.add(w);
        animated.water = [...(animated.water || []), mat];
      } else {
        const ice = new THREE.Mesh(
          new THREE.CircleGeometry(lake.r, 40).rotateX(-Math.PI / 2),
          new THREE.MeshStandardMaterial({ map: iceTexture(), roughness: 0.12, metalness: 0.05 }),
        );
        ice.position.set(lake.x, 0.03, lake.z);
        ice.receiveShadow = shadows;
        group.add(ice);
      }
    }
  } else {
    const gg = new THREE.PlaneGeometry(2600, 2600, 40, 40).rotateX(-Math.PI / 2).toNonIndexed();
    const gpos = gg.attributes.position;
    const gcol = new Float32Array(gpos.count * 3);
    const ca = new THREE.Color(theme.ground);
    const cb = new THREE.Color(theme.groundAlt);
    const tmp = new THREE.Color();
    for (let i = 0; i < gpos.count; i += 3) {
      tmp.copy(ca).lerp(cb, rng());
      for (let j = 0; j < 3; j++) gcol.set([tmp.r, tmp.g, tmp.b], (i + j) * 3);
    }
    gg.setAttribute('color', new THREE.BufferAttribute(gcol, 3));
    gg.computeVertexNormals();
    const ground = new THREE.Mesh(gg, new THREE.MeshLambertMaterial({ vertexColors: true }));
    ground.position.set(cx, 0, cz);
    ground.receiveShadow = shadows;
    group.add(ground);
  }

  // --- Distant mountains --------------------------------------------------------------
  const mountainParts = [];
  const mCount = 46;
  for (let i = 0; i < mCount; i++) {
    const a = (i / mCount) * Math.PI * 2 + rng() * 0.1;
    const dist = Math.max(radius + 900, 1200) + rng() * 600;
    const h = 120 + rng() * 260;
    const r = 140 + rng() * 180;
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
    geom.translate(cx + Math.cos(a) * dist, -4, cz + Math.sin(a) * dist);
    mountainParts.push(colored(geom, color, 0.1, rng));
    if (envName !== 'desert' && h > 250) {
      const cap = new THREE.ConeGeometry(r * 0.32, h * 0.32, 5);
      cap.translate(cx + Math.cos(a) * dist, h * 0.84 - 4, cz + Math.sin(a) * dist);
      mountainParts.push(colored(cap, 0xf8fbff, 0.02, rng));
    }
  }
  group.add(new THREE.Mesh(mergeColored(mountainParts), new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true })));

  // --- Placement helpers ----------------------------------------------------------------
  const reserved = new Set(occupied ? [...occupied] : []);
  const cellFree = (x, z, pad = 1) => {
    const gx = Math.round(x / TILE);
    const gz = Math.round(z / TILE);
    for (let dx = -pad; dx <= pad; dx++) for (let dz = -pad; dz <= pad; dz++) if (reserved.has(`${gx + dx},${gz + dz}`)) return false;
    return true;
  };
  const reserve = (x, z, rCells = 1) => {
    const gx = Math.round(x / TILE);
    const gz = Math.round(z / TILE);
    for (let dx = -rCells; dx <= rCells; dx++) for (let dz = -rCells; dz <= rCells; dz++) reserved.add(`${gx + dx},${gz + dz}`);
  };
  const groundOk = (x, z, maxSlope = 0.55) => {
    if (!terrain) return true;
    const h = terrain.height(x, z);
    if (h < WATER_LEVEL + 0.2) return false;
    if (terrain.isFlat(x, z) && !terrain.buildable(x, z, 3)) return false;
    return 1 - terrain.normal(x, z)[1] < maxSlope * 0.35;
  };

  // --- Trackside dressing -----------------------------------------------------------------
  const props = new THREE.Group();
  group.add(props);
  const pieces = compiled?.track?.pieces || [];
  if (compiled && decorCount !== 0) {
    const placeFacingRoad = (obj, x, z, perp) => {
      obj.position.set(x, heightAt(x, z), z);
      obj.rotation.y = Math.atan2(-perp[0], -perp[2]);
      props.add(obj);
    };
    // Grandstand + pit tents beside the start, billboards near finish lines and checkpoints.
    const gates = pieces.filter((p) => ['start', 'finish', 'checkpoint'].includes(p.t));
    let stands = 0;
    let boards = 0;
    gates.forEach((pc, gi) => {
      if (pc.y > 3) return;
      const [fx, fz] = DIRS[pc.r];
      const perp = [fz, 0, -fx];
      for (const side of [1, -1]) {
        for (const dist of [2, 3]) {
          const x = pc.x * TILE + perp[0] * side * dist * TILE;
          const z = pc.z * TILE + perp[2] * side * dist * TILE;
          const along = [-1, 0, 1].map((k) => [x + fx * k * TILE, z + fz * k * TILE]);
          if (!along.every(([ax, az]) => cellFree(ax, az, 0) && groundOk(ax, az, 0.2))) continue;
          if (pc.t === 'start' && stands < 1) {
            const { group: gs, crowd } = grandstand(27, rng);
            placeFacingRoad(gs, x, z, [perp[0] * side, 0, perp[2] * side]);
            animated.crowds.push(crowd);
            for (const [ax, az] of along) reserve(ax, az, 0);
            stands++;
            // Pit tents on the far side.
            const tx = pc.x * TILE - perp[0] * side * 2 * TILE;
            const tz = pc.z * TILE - perp[2] * side * 2 * TILE;
            if (cellFree(tx, tz, 0) && groundOk(tx, tz, 0.2)) {
              for (const k of [-0.6, 0.6]) {
                const t = tent([0xe8402f, 0x2b6cd6, 0xffd23f][(gi + (k > 0 ? 1 : 0)) % 3]);
                placeFacingRoad(t, tx + fx * k * TILE, tz + fz * k * TILE, [-perp[0] * side, 0, -perp[2] * side]);
              }
              reserve(tx, tz, 0);
            }
            return;
          }
          if (boards < 5) {
            const bb = billboard(boards + gi);
            placeFacingRoad(bb, x, z, [perp[0] * side, 0, perp[2] * side]);
            reserve(x, z, 0);
            boards++;
            return;
          }
        }
      }
    });
    // Tyre walls around the outside of tight ground-level corners.
    for (const pc of pieces) {
      if (pc.t !== 'turn' || pc.y > 0) continue;
      const lx = pc.m ? 3.3 : -3.3;
      const [ox, oz] = rotateXZ(lx, 3.3, pc.r);
      const x = pc.x * TILE + ox;
      const z = pc.z * TILE + oz;
      const wall = tireWall(6);
      wall.position.set(x, 0, z);
      const [dx, dz] = rotateXZ(pc.m ? -1 : 1, 1, pc.r);
      wall.rotation.y = Math.atan2(dx, dz) + Math.PI / 2;
      props.add(wall);
    }
  }
  props.traverse((o) => {
    if (o.isMesh || o.isInstancedMesh) {
      o.castShadow = shadows;
      o.receiveShadow = shadows;
    }
  });

  // --- Scenery (instanced) ------------------------------------------------------------------
  const decorMat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.95 });
  const count = decorCount ?? Math.round(650 * (q.decor ?? 1));
  const buckets = new Map();
  const dummy = new THREE.Object3D();
  const near = { x0: b.minX * TILE - 150, x1: b.maxX * TILE + 150, z0: b.minZ * TILE - 150, z1: b.maxZ * TILE + 150 };
  let placed = 0;
  // Groves: clusters of the same kind of tree make the scenery feel natural.
  const groves = Array.from({ length: 14 }, () => ({
    x: near.x0 + rng() * (near.x1 - near.x0),
    z: near.z0 + rng() * (near.z1 - near.z0),
    r: 12 + rng() * 26,
    kind: pickWeighted(theme.hillDecor, rng),
  }));
  for (let tries = 0; tries < count * 8 && placed < count; tries++) {
    // ~45% in groves, ~30% scattered near the track, ~25% out on the hills.
    const roll = rng();
    const far = terrain && roll < 0.25;
    const grove = !far && roll < 0.7 ? groves[Math.floor(rng() * groves.length)] : null;
    let x, z;
    if (grove) {
      const a = rng() * Math.PI * 2;
      const d = Math.sqrt(rng()) * grove.r;
      x = grove.x + Math.cos(a) * d;
      z = grove.z + Math.sin(a) * d;
    } else if (far) {
      const a = rng() * Math.PI * 2;
      const d = radius + 80 + rng() * 520;
      x = cx + Math.cos(a) * d;
      z = cz + Math.sin(a) * d;
    } else {
      x = near.x0 + rng() * (near.x1 - near.x0);
      z = near.z0 + rng() * (near.z1 - near.z0);
    }
    if (!cellFree(x, z, 1) || !groundOk(x, z)) continue;
    const kind = grove && rng() < 0.8 ? grove.kind : pickWeighted(far ? theme.hillDecor : theme.decor, rng);
    dummy.position.set(x, heightAt(x, z) - 0.05, z);
    dummy.rotation.set(0, rng() * Math.PI * 2, 0);
    const s = (far ? 1.1 : 0.7) + rng() * 0.8;
    dummy.scale.set(s, s * (0.85 + rng() * 0.3), s);
    dummy.updateMatrix();
    if (!buckets.has(kind)) buckets.set(kind, []);
    buckets.get(kind).push(dummy.matrix.clone());
    placed++;
  }
  for (const [kind, mats] of buckets) {
    const inst = new THREE.InstancedMesh(decorGeometry(kind), decorMat, mats.length);
    mats.forEach((m, i) => inst.setMatrixAt(i, m));
    inst.castShadow = shadows;
    inst.receiveShadow = shadows;
    group.add(inst);
  }

  // --- Landmarks -------------------------------------------------------------------------
  if (compiled && decorCount !== 0) {
    const spot = (minD, maxD, padCells = 2) => {
      for (let i = 0; i < 60; i++) {
        const a = rng() * Math.PI * 2;
        const d = minD + rng() * (maxD - minD);
        const x = cx + Math.cos(a) * d;
        const z = cz + Math.sin(a) * d;
        if (cellFree(x, z, padCells) && groundOk(x, z, 0.25)) {
          reserve(x, z, padCells);
          return [x, z];
        }
      }
      return null;
    };
    const place = (obj, s, scale = 1) => {
      if (!s) return null;
      obj.position.set(s[0], heightAt(s[0], s[1]), s[1]);
      obj.rotation.y = rng() * Math.PI * 2;
      obj.scale.setScalar(scale);
      obj.traverse((o) => {
        if (o.isMesh) {
          o.castShadow = shadows;
          o.receiveShadow = shadows;
        }
      });
      group.add(obj);
      return obj;
    };
    if (envName === 'summer') {
      for (let i = 0; i < 2; i++) {
        const w = place(windmill(), spot(radius * 0.6, radius + 260));
        if (w) animated.spinners.push({ obj: w.userData.spin, speed: 0.6 + rng() * 0.4 });
      }
      place(barn(), spot(radius * 0.5, radius + 200));
      for (let i = 0; i < 2; i++) place(cottage(), spot(radius * 0.5, radius + 220));
      for (let i = 0; i < 3; i++) {
        const bl = hotAirBalloon([0xe8402f, 0xffd23f, 0x3a6df0][i]);
        const a = rng() * Math.PI * 2;
        bl.position.set(cx + Math.cos(a) * (radius + 120), 70 + rng() * 60, cz + Math.sin(a) * (radius + 120));
        group.add(bl);
        animated.balloons.push({ obj: bl, base: bl.position.clone(), phase: rng() * 6, drift: 0.6 + rng() * 0.6 });
      }
    } else if (envName === 'winter') {
      for (let i = 0; i < 3; i++) {
        const c = place(cabin(), spot(radius * 0.5, radius + 220));
        if (c) {
          c.updateMatrixWorld(true);
          animated.smokers.push(c.localToWorld(c.userData.chimney.clone()));
        }
      }
      for (let i = 0; i < 2; i++) place(igloo(), spot(radius * 0.4, radius + 150), 1.2);
    } else if (envName === 'desert') {
      for (let i = 0; i < 2; i++) place(rockArch(), spot(radius * 0.7, radius + 300), 1 + rng() * 0.5);
      // Palms around the oasis.
      for (const lake of terrain?.lakes || []) {
        for (let i = 0; i < 7; i++) {
          const a = (i / 7) * Math.PI * 2 + rng() * 0.5;
          const x = lake.x + Math.cos(a) * lake.r * 1.45;
          const z = lake.z + Math.sin(a) * lake.r * 1.45;
          if (!cellFree(x, z, 0)) continue;
          const palm = new THREE.Mesh(decorGeometry('palm'), decorMat);
          palm.position.set(x, heightAt(x, z), z);
          palm.rotation.y = rng() * 6.28;
          palm.scale.setScalar(0.9 + rng() * 0.5);
          palm.castShadow = shadows;
          group.add(palm);
        }
      }
      for (let i = 0; i < 5; i++) {
        const w = tumbleweed();
        w.castShadow = shadows;
        group.add(w);
        animated.weeds.push({ obj: w, x: cx + (rng() - 0.5) * spanX, z: cz + (rng() - 0.5) * spanZ, v: 4 + rng() * 5, phase: rng() * 6 });
      }
    }
    // Birds: a couple of circling flocks.
    for (let f = 0; f < 2; f++) {
      const flock = { center: new THREE.Vector3(cx + (rng() - 0.5) * spanX, 45 + rng() * 30, cz + (rng() - 0.5) * spanZ), r: 40 + rng() * 60, speed: 0.12 + rng() * 0.08, members: [] };
      for (let i = 0; i < 7; i++) {
        const bd = bird();
        bd.scale.setScalar(1.2);
        group.add(bd);
        flock.members.push({ obj: bd, off: new THREE.Vector3((rng() - 0.5) * 14, (rng() - 0.5) * 5, (rng() - 0.5) * 14), phase: rng() * 6 });
      }
      animated.birds.push(flock);
    }
  }

  // --- Clouds ---------------------------------------------------------------------------
  const clouds = new THREE.Group();
  const cloudMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, transparent: true, opacity: 0.94, emissive: 0x5a6a80, emissiveIntensity: 0.25 });
  for (let i = 0; i < 26; i++) {
    // One merged mesh per cloud keeps the draw-call count low.
    const n = 4 + Math.floor(rng() * 5);
    const puffs = [];
    for (let k = 0; k < n; k++) {
      const g = new THREE.IcosahedronGeometry(12 + rng() * 14, 0);
      g.scale(1, 0.55, 1);
      g.translate(k * 15 - n * 7.5, rng() * 7, rng() * 16 - 8);
      puffs.push(colored(g, 0xffffff, 0.04, rng));
    }
    const c = new THREE.Mesh(mergeColored(puffs), cloudMat);
    const a = rng() * Math.PI * 2;
    const d = 150 + rng() * 900;
    c.position.set(cx + Math.cos(a) * d, 160 + rng() * 140, cz + Math.sin(a) * d);
    c.rotation.y = rng() * Math.PI;
    clouds.add(c);
  }
  group.add(clouds);

  // --- Weather & smoke ------------------------------------------------------------------
  let snow = null;
  if (envName === 'winter' && compiled) {
    const n = Math.round(1800 * (q.decor ?? 1));
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = (rng() - 0.5) * 120;
      pos[i * 3 + 1] = rng() * 60;
      pos[i * 3 + 2] = (rng() - 0.5) * 120;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    snow = new THREE.Points(
      geo,
      new THREE.PointsMaterial({ size: 0.35, map: particleTexture('flake'), transparent: true, depthWrite: false, color: 0xffffff, opacity: 0.9 }),
    );
    snow.frustumCulled = false;
    group.add(snow);
  }
  let smoke = null;
  if (animated.smokers.length) {
    smoke = new ParticleSystem(300, { texture: 'soft' });
    group.add(smoke.points);
  }

  const fog = new THREE.Fog(theme.fog, 260, 2100);
  let time = 0;
  const m4 = new THREE.Matrix4();

  return {
    group,
    theme,
    sun,
    hemi,
    fog,
    sky,
    terrain,
    /** Excite the crowd (finish line). */
    cheer(seconds = 4) {
      this._cheer = seconds;
    },
    /** Keep the sun's shadow frustum centred on the action and animate ambient life. */
    update(target, dt = 0, camera = null) {
      time += dt;
      sun.position.copy(target).addScaledVector(SUN_DIR, 140);
      sun.target.position.copy(target);
      sky.position.copy(camera ? camera.position : target);
      clouds.children.forEach((c, i) => {
        c.position.x += dt * (1.5 + (i % 3));
      });
      for (const s of animated.spinners) s.obj.rotation.z += dt * s.speed;
      for (const m of animated.water || []) m.uniforms.uTime.value = time;
      for (const fl of animated.birds) {
        const a = time * fl.speed;
        for (const mb of fl.members) {
          const o = mb.obj;
          const ang = a + mb.phase * 0.05;
          o.position.set(fl.center.x + Math.cos(ang) * fl.r + mb.off.x, fl.center.y + mb.off.y + Math.sin(time + mb.phase) * 1.5, fl.center.z + Math.sin(ang) * fl.r + mb.off.z);
          o.rotation.y = -ang;
          const flap = Math.sin(time * 9 + mb.phase) * 0.6;
          o.userData.wings[0].rotation.z = flap;
          o.userData.wings[1].rotation.z = -flap;
        }
      }
      for (const bl of animated.balloons) {
        bl.obj.position.set(
          bl.base.x + Math.sin(time * 0.05 * bl.drift + bl.phase) * 60,
          bl.base.y + Math.sin(time * 0.3 + bl.phase) * 3,
          bl.base.z + Math.cos(time * 0.04 * bl.drift + bl.phase) * 60,
        );
      }
      for (const w of animated.weeds) {
        w.x += w.v * dt;
        if (Math.abs(w.x - target.x) > 160) {
          w.x = target.x - 150;
          w.z = target.z + (Math.random() - 0.5) * 200;
        }
        const hop = Math.abs(Math.sin(time * 2.2 + w.phase)) * 1.2;
        w.obj.position.set(w.x, heightAt(w.x, w.z) + 0.75 + hop, w.z);
        w.obj.rotation.z -= dt * w.v * 1.2;
      }
      if (animated.crowds.length) {
        this._cheer = Math.max(0, (this._cheer || 0) - dt);
        const amp = this._cheer > 0 ? 0.35 : 0.06;
        for (const cr of animated.crowds) {
          cr.spots.forEach((s, i) => {
            const y = Math.max(0, Math.sin(time * (this._cheer > 0 ? 9 : 2.5) + cr.phase[i])) * amp;
            m4.makeTranslation(s[0], s[1] + y, s[2]);
            cr.bodies.setMatrixAt(i, m4);
            cr.heads.setMatrixAt(i, m4);
          });
          cr.bodies.instanceMatrix.needsUpdate = true;
          cr.heads.instanceMatrix.needsUpdate = true;
        }
      }
      if (snow) {
        const p = snow.geometry.attributes.position;
        const base = camera ? camera.position : target;
        for (let i = 0; i < p.count; i++) {
          let y = p.getY(i) - dt * (2.2 + (i % 7) * 0.25);
          let x = p.getX(i) + Math.sin(time * 0.7 + i) * dt * 0.6;
          if (y < -5) y += 60;
          p.setXYZ(i, x, y, p.getZ(i));
        }
        p.needsUpdate = true;
        snow.position.set(Math.floor(base.x / 120) * 120, base.y - 20, Math.floor(base.z / 120) * 120);
        // Wrap flakes into a box that follows the camera.
        const ox = base.x - snow.position.x;
        const oz = base.z - snow.position.z;
        for (let i = 0; i < p.count; i += 1) {
          const x = p.getX(i);
          const z = p.getZ(i);
          if (x - ox > 60) p.setX(i, x - 120);
          else if (x - ox < -60) p.setX(i, x + 120);
          if (z - oz > 60) p.setZ(i, z - 120);
          else if (z - oz < -60) p.setZ(i, z + 120);
        }
      }
      if (smoke) {
        this._smokeAcc = (this._smokeAcc || 0) + dt * 6;
        while (this._smokeAcc > 1) {
          this._smokeAcc -= 1;
          for (const c of animated.smokers) {
            smoke.emit({ x: c.x, y: c.y, z: c.z, vx: 0.6 + Math.random() * 0.4, vy: 1.6, vz: (Math.random() - 0.5) * 0.4, life: 4, size: 1, size1: 4.5, r: 0.82, g: 0.84, b: 0.88, a: 0.45, a1: 0, grav: -0.1, drag: 0.4 });
          }
        }
        smoke.update(dt, camera ? 600 : 600);
      }
    },
    dispose() {
      group.traverse((o) => {
        if (o.geometry && !(o instanceof THREE.InstancedMesh)) o.geometry.dispose();
        if (o.material) o.material.dispose?.();
      });
    },
  };
}

export { LEVEL };
