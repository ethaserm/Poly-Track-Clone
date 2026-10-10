import * as THREE from 'three';
import { LEVEL, TILE, WALL_OUTER } from '../core/constants.js';
import { buildPieceLocal } from '../core/pieces.js';

const GATE_STYLE = {
  start: { label: 'START', bg: '#1f9d55', fg: '#ffffff', checker: false },
  checkpoint: { label: 'CHECKPOINT', bg: '#f5b700', fg: '#1d1f27', checker: false },
  checkpointDone: { label: 'CHECKPOINT', bg: '#2bb3e6', fg: '#ffffff', checker: false },
  finish: { label: 'FINISH', bg: '#ffffff', fg: '#1d1f27', checker: true },
};

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

const roadMaterial = () =>
  new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.85, metalness: 0.0 });

const pillarGeometry = new THREE.BoxGeometry(1.3, 1, 1.3).translate(0, 0.5, 0);
const pillarMaterial = new THREE.MeshStandardMaterial({ color: 0x8d93a1, flatShading: true, roughness: 0.9 });

/** Banner + crossbeam for a gate, in the gate's local frame (centre of the road at deck height). */
function createGate(kind) {
  const g = new THREE.Group();
  const width = (WALL_OUTER + 0.75) * 2;
  const beam = new THREE.Mesh(
    new THREE.BoxGeometry(width, 0.35, 0.5),
    new THREE.MeshStandardMaterial({ color: 0x30343f, flatShading: true }),
  );
  beam.position.y = 6.2;
  g.add(beam);
  // Two single-sided planes so the text reads correctly from both directions.
  const mat = new THREE.MeshBasicMaterial({ map: gateTexture(kind), toneMapped: false });
  const plane = new THREE.PlaneGeometry(width - 0.9, 1.25);
  const banner = new THREE.Group();
  const front = new THREE.Mesh(plane, mat);
  front.rotation.y = Math.PI; // faces cars arriving from -Z
  front.position.z = -0.02;
  const back = new THREE.Mesh(plane, mat);
  back.position.z = 0.02;
  banner.add(front, back);
  banner.position.y = 5.4;
  banner.material = mat;
  g.add(banner);
  g.userData.banner = banner;
  g.userData.kind = kind;
  return g;
}

/** Full race view of a compiled track: merged road mesh, gates and pillars. */
export class TrackView {
  constructor(compiled, { shadows = true } = {}) {
    this.group = new THREE.Group();
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(compiled.positions, 3));
    geom.setAttribute('color', new THREE.BufferAttribute(compiled.colors, 3));
    geom.computeVertexNormals();
    geom.computeBoundingSphere();
    this.road = new THREE.Mesh(geom, roadMaterial());
    this.road.castShadow = shadows;
    this.road.receiveShadow = shadows;
    this.group.add(this.road);

    this.checkpointGates = new Map();
    for (const gate of compiled.gates) {
      const obj = createGate(gate.kind);
      obj.position.set(...gate.pos);
      obj.rotation.y = (gate.rot * Math.PI) / 2;
      this.group.add(obj);
      if (gate.kind === 'checkpoint') {
        const trig = compiled.triggers.find((t) => t.piece === gate.piece && t.kind === 'checkpoint');
        if (trig) this.checkpointGates.set(trig.id, obj);
      }
    }

    if (compiled.pillars.length) {
      const inst = new THREE.InstancedMesh(pillarGeometry, pillarMaterial, compiled.pillars.length);
      const m = new THREE.Matrix4();
      compiled.pillars.forEach((p, i) => {
        m.makeScale(1, p[1], 1).setPosition(p[0], 0, p[2]);
        inst.setMatrixAt(i, m);
      });
      inst.castShadow = shadows;
      inst.receiveShadow = shadows;
      this.group.add(inst);
    }
  }

  setCheckpoint(id, done) {
    const gate = this.checkpointGates.get(id);
    if (!gate) return;
    gate.userData.banner.material.map = gateTexture(done ? 'checkpointDone' : 'checkpoint');
    gate.userData.banner.material.needsUpdate = true;
  }

  resetCheckpoints() {
    for (const id of this.checkpointGates.keys()) this.setCheckpoint(id, false);
  }

  dispose() {
    this.group.traverse((o) => {
      if (o.geometry && o.geometry !== pillarGeometry) o.geometry.dispose();
      if (o.material && o.material !== pillarMaterial) o.material.dispose();
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
  if (withPillars) {
    const baseY = pc.y * LEVEL;
    for (const p of local.pillars) {
      const h = baseY + p[1];
      if (h < 1.2) continue;
      const pillar = new THREE.Mesh(pillarGeometry, pillarMaterial);
      pillar.scale.set(1, h, 1);
      pillar.position.set(p[0], -baseY, p[2]);
      pillar.castShadow = shadows;
      group.add(pillar);
    }
  }
  placePieceObject(group, pc);
  group.userData.piece = pc;
  return group;
}

