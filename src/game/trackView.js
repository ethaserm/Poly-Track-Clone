import * as THREE from 'three';
import { DECK, LEVEL, TILE, WALL_OUTER } from '../core/constants.js';
import { buildPieceLocal } from '../core/pieces.js';
import { mergeColored } from './environment.js';

// ---------------------------------------------------------------------------------
// Shared textures
// ---------------------------------------------------------------------------------

let grainTex = null;
/** Subtle asphalt grain: multiplied with the road's vertex colours. */
export function grainTexture() {
  if (grainTex) return grainTex;
  const size = 256;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const img = g.createImageData(size, size);
  let seed = 1234567;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < size * size; i++) {
    let v = 236 + rnd() * 19;
    if (rnd() < 0.035) v -= 26 + rnd() * 24; // dark aggregate
    if (rnd() < 0.01) v = 255; // light chips
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  // A few faint patches / tar seams.
  g.globalAlpha = 0.06;
  for (let k = 0; k < 14; k++) {
    g.fillStyle = k % 2 ? '#000' : '#fff';
    g.beginPath();
    g.ellipse(rnd() * size, rnd() * size, 10 + rnd() * 40, 6 + rnd() * 20, rnd() * 3, 0, Math.PI * 2);
    g.fill();
  }
  grainTex = new THREE.CanvasTexture(c);
  grainTex.wrapS = grainTex.wrapT = THREE.RepeatWrapping;
  grainTex.repeat.set(0.22, 0.22);
  grainTex.anisotropy = 8;
  grainTex.colorSpace = THREE.NoColorSpace;
  return grainTex;
}

const GATE_STYLE = {
  start: { label: 'START', bg: '#1f9d55', fg: '#ffffff', checker: false },
  checkpoint: { label: 'CHECKPOINT', bg: '#f5b700', fg: '#1d1f27', checker: false },
  checkpointDone: { label: 'CHECKPOINT', bg: '#2bb3e6', fg: '#ffffff', checker: false },
  finish: { label: 'FINISH', bg: '#ffffff', fg: '#1d1f27', checker: true },
};
const GATE_LIGHT = { start: 0x34ff7a, checkpoint: 0xffc21a, checkpointDone: 0x35d6ff, finish: 0xffffff };

const textureCache = new Map();
function gateTexture(kind) {
  if (textureCache.has(kind)) return textureCache.get(kind);
  const s = GATE_STYLE[kind];
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = s.bg;
  g.fillRect(0, 0, c.width, c.height);
  if (s.checker) {
    const sq = 32;
    for (let y = 0; y < 4; y++)
      for (let x = 0; x < 32; x++) {
        if ((x + y) % 2) continue;
        g.fillStyle = '#1d1f27';
        g.fillRect(x * sq, y * sq, sq, sq);
      }
    g.fillStyle = '#ffffff';
    g.fillRect(300, 18, 424, 92);
  } else {
    g.fillStyle = 'rgba(0,0,0,0.12)';
    for (let x = -128; x < c.width; x += 64) {
      g.beginPath();
      g.moveTo(x, 128);
      g.lineTo(x + 32, 128);
      g.lineTo(x + 96, 0);
      g.lineTo(x + 64, 0);
      g.fill();
    }
  }
  g.fillStyle = 'rgba(255,255,255,0.18)';
  g.fillRect(0, 0, c.width, 6);
  g.fillStyle = 'rgba(0,0,0,0.2)';
  g.fillRect(0, c.height - 6, c.width, 6);
  g.fillStyle = s.fg;
  g.font = '900 78px "Exo 2", "Trebuchet MS", sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(s.label, c.width / 2, c.height / 2 + 4);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  textureCache.set(kind, tex);
  return tex;
}

let chevronTex = null;
function chevronTexture() {
  if (chevronTex) return chevronTex;
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const g = c.getContext('2d');
  g.clearRect(0, 0, 128, 128);
  g.fillStyle = '#fff';
  // One chevron pointing "up" in texture space.
  g.beginPath();
  g.moveTo(8, 96);
  g.lineTo(64, 40);
  g.lineTo(120, 96);
  g.lineTo(120, 120);
  g.lineTo(64, 64);
  g.lineTo(8, 120);
  g.closePath();
  g.fill();
  chevronTex = new THREE.CanvasTexture(c);
  chevronTex.wrapS = chevronTex.wrapT = THREE.RepeatWrapping;
  chevronTex.repeat.set(1, 2.5);
  return chevronTex;
}

// ---------------------------------------------------------------------------------
// Materials & shared geometry
// ---------------------------------------------------------------------------------

export function roadMaterial() {
  return new THREE.MeshStandardMaterial({
    vertexColors: true,
    flatShading: true,
    roughness: 0.86,
    metalness: 0.0,
    map: grainTexture(),
  });
}

const metalMat = new THREE.MeshStandardMaterial({ color: 0x3a3f4b, roughness: 0.55, metalness: 0.6, flatShading: true });
const lightHousingMat = new THREE.MeshStandardMaterial({ color: 0x1b1d23, roughness: 0.6, flatShading: true });
const pillarMat = new THREE.MeshStandardMaterial({ color: 0x8d93a1, flatShading: true, roughness: 0.9 });
const pillarCapMat = new THREE.MeshStandardMaterial({ color: 0x737a88, flatShading: true, roughness: 0.85 });
const lampPoleMat = new THREE.MeshStandardMaterial({ color: 0x59606d, roughness: 0.5, metalness: 0.7, flatShading: true });
const lampHeadMat = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0xfff0c8, emissiveIntensity: 3.2 });

const pillarGeometry = new THREE.BoxGeometry(1.3, 1, 1.3).translate(0, 0.5, 0);
const pillarCapGeometry = new THREE.BoxGeometry(1.9, 0.4, 1.9).translate(0, -0.2, 0);
const pillarFootGeometry = new THREE.BoxGeometry(2.3, 0.5, 2.3).translate(0, 0.25, 0);

function boxGeom(w, h, d, x, y, z, rx = 0, ry = 0, rz = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  if (rx || ry || rz) g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx, ry, rz)));
  return g.translate(x, y, z).toNonIndexed();
}

function mergePlain(list) {
  // Reuse the coloured merge with a neutral colour, then drop the colour attribute.
  for (const g of list) {
    if (!g.attributes.color) {
      const n = g.attributes.position.count;
      g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3).fill(1), 3));
    }
  }
  const m = mergeColored(list);
  m.deleteAttribute('color');
  return m;
}

const TOWER_X = WALL_OUTER + 0.8;
const GATE_TOP = 6.9;

let gateGeomCache = null;
function gateGeometry() {
  if (gateGeomCache) return gateGeomCache;
  const parts = [];
  const post = 0.09;
  for (const side of [1, -1]) {
    const cx = side * TOWER_X;
    // Corner posts
    for (const ox of [-0.32, 0.32])
      for (const oz of [-0.32, 0.32]) parts.push(boxGeom(post, GATE_TOP, post, cx + ox, GATE_TOP / 2, oz));
    // Horizontal rings and diagonal lacing
    for (let y = 0.6; y < GATE_TOP; y += 1.1) {
      parts.push(boxGeom(0.64, 0.06, 0.06, cx, y, 0.32), boxGeom(0.64, 0.06, 0.06, cx, y, -0.32));
      parts.push(boxGeom(0.06, 0.06, 0.64, cx + 0.32, y, 0), boxGeom(0.06, 0.06, 0.64, cx - 0.32, y, 0));
      parts.push(boxGeom(0.05, 1.25, 0.05, cx, y + 0.55, 0.32, 0, 0, side * 0.52));
      parts.push(boxGeom(0.05, 1.25, 0.05, cx, y + 0.55, -0.32, 0, 0, -side * 0.52));
    }
    parts.push(boxGeom(1.2, 0.3, 1.2, cx, 0.15, 0)); // foot
    parts.push(boxGeom(0.85, 0.12, 0.85, cx, GATE_TOP + 0.06, 0)); // cap
  }
  // Truss beam across the road.
  const span = TOWER_X * 2;
  for (const y of [GATE_TOP - 0.05, GATE_TOP - 1.25])
    for (const z of [-0.3, 0.3]) parts.push(boxGeom(span, 0.09, 0.09, 0, y, z));
  for (let x = -TOWER_X + 0.6; x < TOWER_X - 0.3; x += 1.2) {
    parts.push(boxGeom(0.05, 1.5, 0.05, x + 0.3, GATE_TOP - 0.65, 0.3, 0, 0, 0.75));
    parts.push(boxGeom(0.05, 1.5, 0.05, x + 0.3, GATE_TOP - 0.65, -0.3, 0, 0, -0.75));
  }
  gateGeomCache = mergePlain(parts);
  return gateGeomCache;
}

/** Full gate: lattice towers, truss, banners, lights and a glowing timing line. */
function createGate(kind) {
  const g = new THREE.Group();
  const frame = new THREE.Mesh(gateGeometry(), metalMat);
  frame.castShadow = true;
  g.add(frame);

  const mat = new THREE.MeshBasicMaterial({ map: gateTexture(kind), toneMapped: false });
  const plane = new THREE.PlaneGeometry(TOWER_X * 2 - 1.1, 1.05);
  const banner = new THREE.Group();
  const front = new THREE.Mesh(plane, mat);
  front.rotation.y = Math.PI; // faces cars arriving from -Z
  front.position.z = -0.34;
  const back = new THREE.Mesh(plane, mat);
  back.position.z = 0.34;
  banner.add(front, back);
  banner.position.y = GATE_TOP - 0.65;
  banner.material = mat;
  g.add(banner);

  // Glowing line across the road.
  const lineMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(GATE_LIGHT[kind]).multiplyScalar(2.2),
    transparent: true,
    opacity: 0.85,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const line = new THREE.Mesh(new THREE.PlaneGeometry(8, 0.35).rotateX(-Math.PI / 2), lineMat);
  line.position.y = 0.03;
  line.renderOrder = 2;
  g.add(line);

  // LED strips on the inside faces of the towers.
  const ledMat = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: GATE_LIGHT[kind], emissiveIntensity: 2.6 });
  for (const side of [1, -1]) {
    const led = new THREE.Mesh(new THREE.BoxGeometry(0.08, GATE_TOP - 1.6, 0.12), ledMat);
    led.position.set(side * (TOWER_X - 0.38), (GATE_TOP - 1.6) / 2 + 0.3, 0);
    g.add(led);
  }

  // Waving flags on top of the towers.
  const flags = [];
  const flagGeom = new THREE.PlaneGeometry(1.1, 0.7, 6, 1).translate(0.55, 0, 0);
  const flagMat = new THREE.MeshStandardMaterial({
    color: kind === 'finish' ? 0xffffff : kind === 'start' ? 0x1f9d55 : 0xf5b700,
    side: THREE.DoubleSide,
    flatShading: true,
    map: kind === 'finish' ? gateTexture('finish') : null,
  });
  for (const side of [1, -1]) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.8, 6), metalMat);
    pole.position.set(side * TOWER_X, GATE_TOP + 0.9, 0);
    g.add(pole);
    const flag = new THREE.Mesh(flagGeom.clone(), flagMat);
    flag.position.set(side * TOWER_X, GATE_TOP + 1.45, 0);
    flag.userData.base = flag.geometry.attributes.position.array.slice();
    flag.userData.phase = side * 1.7;
    g.add(flag);
    flags.push(flag);
  }

  // Start lights: five lamps hanging under the truss.
  const lamps = [];
  if (kind === 'start') {
    for (let i = 0; i < 5; i++) {
      const x = (i - 2) * 0.9;
      const housing = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.62, 0.3), lightHousingMat);
      housing.position.set(x, GATE_TOP - 1.75, -0.12);
      g.add(housing);
      const lm = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0xff2020, emissiveIntensity: 3 });
      const bulb = new THREE.Mesh(new THREE.CircleGeometry(0.2, 14), lm);
      bulb.rotation.y = Math.PI;
      bulb.position.set(x, GATE_TOP - 1.75, -0.28);
      g.add(bulb);
      lamps.push(lm);
    }
  }

  g.userData = { banner, kind, flags, lamps, ledMat, lineMat };
  return g;
}

function setGateColor(gate, kind) {
  const u = gate.userData;
  u.banner.material.map = gateTexture(kind);
  u.banner.material.needsUpdate = true;
  u.ledMat.emissive.set(GATE_LIGHT[kind]);
  u.lineMat.color.set(GATE_LIGHT[kind]).multiplyScalar(2.2);
}

function animateFlags(gate, time) {
  for (const flag of gate.userData.flags) {
    const pos = flag.geometry.attributes.position;
    const base = flag.userData.base;
    for (let i = 0; i < pos.count; i++) {
      const x = base[i * 3];
      pos.array[i * 3 + 2] = Math.sin(time * 6 + x * 3.2 + flag.userData.phase) * 0.14 * x;
    }
    pos.needsUpdate = true;
  }
}

function createBoostPad(pad) {
  const tex = chevronTexture().clone();
  tex.needsUpdate = true;
  const mat = new THREE.MeshBasicMaterial({
    map: tex,
    color: new THREE.Color(2.6, 1.45, 0.25),
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const geo = new THREE.PlaneGeometry(pad.size[0] - 1.2, pad.size[1] - 0.6).rotateX(-Math.PI / 2).rotateY(Math.PI);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = 2;
  return mesh;
}

let lampGeom = null;
function lampGeometries() {
  if (lampGeom) return lampGeom;
  const pole = mergePlain([
    new THREE.CylinderGeometry(0.1, 0.14, 7.6, 8).translate(0, 3.8, 0).toNonIndexed(),
    boxGeom(2.1, 0.12, 0.12, -1.0, 7.45, 0),
    boxGeom(0.06, 0.9, 0.06, -0.45, 7.1, 0, 0, 0, -0.9),
    boxGeom(0.7, 0.16, 0.36, -1.95, 7.38, 0),
    boxGeom(0.5, 0.25, 0.5, 0, 0.12, 0),
  ]);
  const head = boxGeom(0.56, 0.05, 0.28, -1.95, 7.28, 0);
  lampGeom = { pole, head };
  return lampGeom;
}

// ---------------------------------------------------------------------------------
// Race view
// ---------------------------------------------------------------------------------

/** Full race view of a compiled track: merged road mesh, gates, pads, lamps and pillars. */
export class TrackView {
  constructor(compiled, { shadows = true } = {}) {
    this.group = new THREE.Group();
    this.time = 0;
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(compiled.positions, 3));
    geom.setAttribute('color', new THREE.BufferAttribute(compiled.colors, 3));
    geom.setAttribute('uv', new THREE.BufferAttribute(compiled.uvs, 2));
    geom.computeVertexNormals();
    geom.computeBoundingSphere();
    this.road = new THREE.Mesh(geom, roadMaterial());
    this.road.castShadow = shadows;
    this.road.receiveShadow = shadows;
    this.group.add(this.road);

    this.gates = [];
    this.checkpointGates = new Map();
    for (const gate of compiled.gates) {
      const obj = createGate(gate.kind);
      obj.position.set(...gate.pos);
      obj.rotation.y = (gate.rot * Math.PI) / 2;
      this.group.add(obj);
      this.gates.push(obj);
      if (gate.kind === 'checkpoint') {
        const trig = compiled.triggers.find((t) => t.piece === gate.piece && t.kind === 'checkpoint');
        if (trig) this.checkpointGates.set(trig.id, obj);
      }
      if (gate.kind === 'start') this.startGate = obj;
      if (gate.kind === 'finish') (this.finishGates ||= []).push(obj);
    }

    this.pads = compiled.boostPads.map((pad) => {
      const m = createBoostPad(pad);
      m.position.set(...pad.center);
      m.rotation.y = (pad.rot * Math.PI) / 2;
      this.group.add(m);
      return m;
    });

    if (compiled.lamps.length) {
      const lg = lampGeometries();
      const poles = new THREE.InstancedMesh(lg.pole, lampPoleMat, compiled.lamps.length);
      const heads = new THREE.InstancedMesh(lg.head, lampHeadMat, compiled.lamps.length);
      const m = new THREE.Matrix4();
      const q = new THREE.Quaternion();
      const up = new THREE.Vector3(0, 1, 0);
      compiled.lamps.forEach((l, i) => {
        // Geometry's arm points along -X: towards the road for lamps on the +X side.
        const yaw = (l.rot * Math.PI) / 2 + (l.side > 0 ? 0 : Math.PI);
        q.setFromAxisAngle(up, yaw);
        m.compose(new THREE.Vector3(...l.pos), q, new THREE.Vector3(1, 1, 1));
        poles.setMatrixAt(i, m);
        heads.setMatrixAt(i, m);
      });
      poles.castShadow = shadows;
      this.group.add(poles, heads);
    }

    if (compiled.pillars.length) {
      const n = compiled.pillars.length;
      const shafts = new THREE.InstancedMesh(pillarGeometry, pillarMat, n);
      const caps = new THREE.InstancedMesh(pillarCapGeometry, pillarCapMat, n);
      const feet = new THREE.InstancedMesh(pillarFootGeometry, pillarCapMat, n);
      const m = new THREE.Matrix4();
      compiled.pillars.forEach((p, i) => {
        m.makeScale(1, p[1], 1).setPosition(p[0], 0, p[2]);
        shafts.setMatrixAt(i, m);
        m.makeTranslation(p[0], p[1], p[2]);
        caps.setMatrixAt(i, m);
        m.makeTranslation(p[0], 0, p[2]);
        feet.setMatrixAt(i, m);
      });
      for (const im of [shafts, caps, feet]) {
        im.castShadow = shadows;
        im.receiveShadow = shadows;
        this.group.add(im);
      }
    }
    this.setStartLights('red');
    this.strobe = 0;
  }

  /** 'red' (waiting), 'green' (go), 'off'. */
  setStartLights(state) {
    this.startState = state;
    if (!this.startGate) return;
    for (const lm of this.startGate.userData.lamps) {
      lm.emissive.set(state === 'green' ? 0x30ff60 : 0xff2020);
      lm.emissiveIntensity = state === 'off' ? 0 : 3;
    }
  }

  setCheckpoint(id, done) {
    const gate = this.checkpointGates.get(id);
    if (gate) setGateColor(gate, done ? 'checkpointDone' : 'checkpoint');
  }

  resetCheckpoints() {
    for (const id of this.checkpointGates.keys()) this.setCheckpoint(id, false);
    this.strobe = 0;
  }

  /** Finish-line strobe celebration. */
  celebrate() {
    this.strobe = 3;
  }

  update(dt) {
    this.time += dt;
    for (const pad of this.pads) pad.material.map.offset.y -= dt * 1.6;
    for (const gate of this.gates) animateFlags(gate, this.time);
    if (this.finishGates) {
      this.strobe = Math.max(0, this.strobe - dt);
      const on = this.strobe > 0 && Math.floor(this.time * 12) % 2 === 0;
      for (const g of this.finishGates) g.userData.ledMat.emissiveIntensity = this.strobe > 0 ? (on ? 6 : 0.5) : 2.6;
    }
  }

  dispose() {
    const shared = new Set([pillarGeometry, pillarCapGeometry, pillarFootGeometry, gateGeomCache, lampGeom?.pole, lampGeom?.head]);
    const sharedMat = new Set([pillarMat, pillarCapMat, metalMat, lightHousingMat, lampPoleMat, lampHeadMat]);
    this.group.traverse((o) => {
      if (o.geometry && !shared.has(o.geometry)) o.geometry.dispose();
      if (o.material && !sharedMat.has(o.material)) {
        if (o.material.map && o.material.map !== grainTex && ![...textureCache.values()].includes(o.material.map)) o.material.map.dispose();
        o.material.dispose?.();
      }
    });
  }
}

// --- Editor: one object per placed piece ---------------------------------------

const pieceGeomCache = new Map();
function pieceGeometry(type, mirror) {
  const key = `${type}|${mirror ? 1 : 0}`;
  if (!pieceGeomCache.has(key)) {
    const local = buildPieceLocal(type, mirror);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(local.positions, 3));
    g.setAttribute('color', new THREE.BufferAttribute(local.colors, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(local.uvs, 2));
    g.computeVertexNormals();
    g.computeBoundingBox();
    g.computeBoundingSphere();
    pieceGeomCache.set(key, g);
  }
  return pieceGeomCache.get(key);
}

const sharedRoadMaterial = roadMaterial();

export function placePieceObject(obj, pc) {
  obj.position.set(pc.x * TILE, pc.y * LEVEL, pc.z * TILE);
  obj.rotation.set(0, (pc.r * Math.PI) / 2, 0);
}

/** A standalone object for a single piece (editor and thumbnails). */
export function createPieceObject(pc, { material = sharedRoadMaterial, withPillars = true, shadows = true } = {}) {
  const group = new THREE.Group();
  const mesh = new THREE.Mesh(pieceGeometry(pc.t, !!pc.m), material);
  mesh.castShadow = shadows;
  mesh.receiveShadow = shadows;
  group.add(mesh);
  const local = buildPieceLocal(pc.t, !!pc.m);
  for (const gate of local.gates) {
    const obj = createGate(gate.kind);
    obj.position.set(...gate.pos);
    group.add(obj);
  }
  for (const pad of local.boostPads) {
    const m = createBoostPad(pad);
    m.position.set(...pad.center);
    group.add(m);
  }
  if (withPillars) {
    const baseY = pc.y * LEVEL;
    for (const p of local.pillars) {
      const h = baseY + p[1];
      if (h < 1.2) continue;
      const pillar = new THREE.Mesh(pillarGeometry, pillarMat);
      pillar.scale.set(1, h, 1);
      pillar.position.set(p[0], -baseY, p[2]);
      pillar.castShadow = shadows;
      const cap = new THREE.Mesh(pillarCapGeometry, pillarCapMat);
      cap.position.set(p[0], p[1], p[2]);
      const foot = new THREE.Mesh(pillarFootGeometry, pillarCapMat);
      foot.position.set(p[0], -baseY, p[2]);
      group.add(pillar, cap, foot);
    }
  }
  placePieceObject(group, pc);
  group.userData.piece = pc;
  return group;
}

export { DECK };
