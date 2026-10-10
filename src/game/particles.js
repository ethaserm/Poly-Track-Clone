import * as THREE from 'three';

// CPU-simulated, GPU-drawn point particles. Each system is one draw call.

const VERT = /* glsl */ `
  attribute float aSize;
  attribute vec4 aColor;
  attribute float aRot;
  uniform float uScale;
  varying vec4 vColor;
  varying float vRot;
  void main() {
    vColor = aColor;
    vRot = aRot;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * uScale / max(0.1, -mv.z);
    gl_Position = projectionMatrix * mv;
  }`;

const FRAG = /* glsl */ `
  uniform sampler2D uMap;
  varying vec4 vColor;
  varying float vRot;
  void main() {
    vec2 uv = gl_PointCoord - 0.5;
    float c = cos(vRot), s = sin(vRot);
    uv = mat2(c, -s, s, c) * uv + 0.5;
    float a = texture2D(uMap, uv).a * vColor.a;
    if (a < 0.004) discard;
    gl_FragColor = vec4(vColor.rgb, a);
    #include <colorspace_fragment>
  }`;

const textures = {};

export function particleTexture(kind) {
  if (textures[kind]) return textures[kind];
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  if (kind === 'square') {
    g.fillStyle = '#fff';
    g.fillRect(14, 22, 36, 20);
  } else if (kind === 'flake') {
    g.fillStyle = '#fff';
    g.beginPath();
    g.arc(32, 32, 14, 0, Math.PI * 2);
    g.fill();
  } else {
    const hard = kind === 'spark' ? 0.35 : 0;
    const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(hard || 0.25, 'rgba(255,255,255,0.75)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 64, 64);
  }
  const t = new THREE.CanvasTexture(c);
  textures[kind] = t;
  return t;
}

export class ParticleSystem {
  constructor(max, { additive = false, texture = 'soft', depthTest = true } = {}) {
    this.max = max;
    this.count = 0;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.col = new Float32Array(max * 4);
    this.size = new Float32Array(max);
    this.rot = new Float32Array(max);
    // Per-particle parameters: life, maxLife, size0, size1, a0, a1, gravity, drag, spin
    this.par = new Float32Array(max * 9);
    const geom = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.aCol = new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage);
    this.aSize = new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage);
    this.aRot = new THREE.BufferAttribute(this.rot, 1).setUsage(THREE.DynamicDrawUsage);
    geom.setAttribute('position', this.aPos);
    geom.setAttribute('aColor', this.aCol);
    geom.setAttribute('aSize', this.aSize);
    geom.setAttribute('aRot', this.aRot);
    geom.setDrawRange(0, 0);
    this.material = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 600 }, uMap: { value: particleTexture(texture) } },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      depthTest,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(geom, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 6 : 5;
  }

  /**
   * p: { x,y,z, vx,vy,vz, life, size, size1, r,g,b, a, a1, grav, drag, spin, rot }
   */
  emit(p) {
    if (this.count >= this.max) return;
    const i = this.count++;
    const i3 = i * 3;
    this.pos[i3] = p.x;
    this.pos[i3 + 1] = p.y;
    this.pos[i3 + 2] = p.z;
    this.vel[i3] = p.vx || 0;
    this.vel[i3 + 1] = p.vy || 0;
    this.vel[i3 + 2] = p.vz || 0;
    const i4 = i * 4;
    this.col[i4] = p.r ?? 1;
    this.col[i4 + 1] = p.g ?? 1;
    this.col[i4 + 2] = p.b ?? 1;
    this.col[i4 + 3] = p.a ?? 1;
    const k = i * 9;
    const life = p.life || 1;
    this.par[k] = life;
    this.par[k + 1] = life;
    this.par[k + 2] = p.size ?? 1;
    this.par[k + 3] = p.size1 ?? p.size ?? 1;
    this.par[k + 4] = p.a ?? 1;
    this.par[k + 5] = p.a1 ?? 0;
    this.par[k + 6] = p.grav ?? 0;
    this.par[k + 7] = p.drag ?? 0;
    this.par[k + 8] = p.spin ?? 0;
    this.rot[i] = p.rot ?? Math.random() * 6.28;
    this.size[i] = this.par[k + 2];
  }

  kill(i) {
    const last = --this.count;
    if (i === last) return;
    this.pos.copyWithin(i * 3, last * 3, last * 3 + 3);
    this.vel.copyWithin(i * 3, last * 3, last * 3 + 3);
    this.col.copyWithin(i * 4, last * 4, last * 4 + 4);
    this.par.copyWithin(i * 9, last * 9, last * 9 + 9);
    this.size[i] = this.size[last];
    this.rot[i] = this.rot[last];
  }

  update(dt, scale) {
    this.material.uniforms.uScale.value = scale;
    for (let i = this.count - 1; i >= 0; i--) {
      const k = i * 9;
      const life = (this.par[k] -= dt);
      if (life <= 0) {
        this.kill(i);
        continue;
      }
      const t = 1 - life / this.par[k + 1];
      const i3 = i * 3;
      const drag = Math.exp(-this.par[k + 7] * dt);
      this.vel[i3] *= drag;
      this.vel[i3 + 1] = this.vel[i3 + 1] * drag - this.par[k + 6] * dt;
      this.vel[i3 + 2] *= drag;
      this.pos[i3] += this.vel[i3] * dt;
      this.pos[i3 + 1] += this.vel[i3 + 1] * dt;
      this.pos[i3 + 2] += this.vel[i3 + 2] * dt;
      if (this.pos[i3 + 1] < 0.02 && this.par[k + 6] > 0) {
        this.pos[i3 + 1] = 0.02;
        this.vel[i3 + 1] *= -0.3;
      }
      this.size[i] = this.par[k + 2] + (this.par[k + 3] - this.par[k + 2]) * t;
      this.col[i * 4 + 3] = this.par[k + 4] + (this.par[k + 5] - this.par[k + 4]) * t;
      this.rot[i] += this.par[k + 8] * dt;
    }
    const g = this.points.geometry;
    g.setDrawRange(0, this.count);
    if (this.count) {
      this.aPos.needsUpdate = true;
      this.aCol.needsUpdate = true;
      this.aSize.needsUpdate = true;
      this.aRot.needsUpdate = true;
    }
  }

  clear() {
    this.count = 0;
    this.points.geometry.setDrawRange(0, 0);
  }

  dispose() {
    this.points.geometry.dispose();
    this.material.dispose();
  }
}

/** Ribbon-style tyre marks laid on the road surface, recycled as a ring buffer. */
export class SkidMarks {
  constructor(maxSegments = 2400) {
    this.max = maxSegments;
    this.next = 0;
    this.positions = new Float32Array(maxSegments * 6 * 3);
    this.colors = new Float32Array(maxSegments * 6 * 4);
    const g = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage);
    this.aCol = new THREE.BufferAttribute(this.colors, 4).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.aPos);
    g.setAttribute('color', this.aCol);
    this.mesh = new THREE.Mesh(
      g,
      new THREE.MeshBasicMaterial({
        vertexColors: true,
        transparent: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -4,
        polygonOffsetUnits: -4,
      }),
    );
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
    this.last = new Map();
  }

  /** Continue (or start) the mark for wheel `id`. side = unit vector across the tyre. */
  add(id, px, py, pz, nx, ny, nz, sx, sy, sz, width, r, g, b, a) {
    const lift = 0.025;
    const x = px + nx * lift;
    const y = py + ny * lift;
    const z = pz + nz * lift;
    const hw = width / 2;
    const L = [x + sx * hw, y + sy * hw, z + sz * hw];
    const R = [x - sx * hw, y - sy * hw, z - sz * hw];
    const prev = this.last.get(id);
    this.last.set(id, { L, R, a });
    if (!prev) return;
    const d2 = (prev.L[0] - L[0]) ** 2 + (prev.L[1] - L[1]) ** 2 + (prev.L[2] - L[2]) ** 2;
    if (d2 > 25) return; // teleported
    const seg = this.next;
    this.next = (this.next + 1) % this.max;
    const o = seg * 18;
    const verts = [prev.L, prev.R, L, prev.R, R, L];
    for (let i = 0; i < 6; i++) {
      this.positions[o + i * 3] = verts[i][0];
      this.positions[o + i * 3 + 1] = verts[i][1];
      this.positions[o + i * 3 + 2] = verts[i][2];
    }
    const c = seg * 24;
    const alphas = [prev.a, prev.a, a, prev.a, a, a];
    for (let i = 0; i < 6; i++) {
      this.colors[c + i * 4] = r;
      this.colors[c + i * 4 + 1] = g;
      this.colors[c + i * 4 + 2] = b;
      this.colors[c + i * 4 + 3] = alphas[i];
    }
    this.aPos.needsUpdate = true;
    this.aCol.needsUpdate = true;
  }

  /** End the current mark of a wheel (next add starts a new one). */
  lift(id) {
    this.last.delete(id);
  }

  clear() {
    this.positions.fill(0);
    this.colors.fill(0);
    this.aPos.needsUpdate = true;
    this.aCol.needsUpdate = true;
    this.last.clear();
    this.next = 0;
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}
