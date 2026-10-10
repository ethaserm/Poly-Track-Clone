import * as THREE from 'three';
import { CAR } from '../core/physics.js';

/**
 * Extrudes a convex side profile (points as [z, y]) across the car's width.
 * halfWidth(y) lets the shape taper towards the top.
 */
function extrudeProfile(points, halfWidth) {
  const pos = [];
  const v = (z, y, side) => [side * halfWidth(y, z), y, z];
  const tri = (a, b, c) => pos.push(...a, ...b, ...c);
  const n = points.length;
  // Side faces (fan triangulation; profile is convex and ordered counter-clockwise seen from +X).
  for (let i = 1; i < n - 1; i++) {
    const [z0, y0] = points[0];
    const [z1, y1] = points[i];
    const [z2, y2] = points[i + 1];
    tri(v(z0, y0, 1), v(z1, y1, 1), v(z2, y2, 1));
    tri(v(z0, y0, -1), v(z2, y2, -1), v(z1, y1, -1));
  }
  // Band around the outline.
  for (let i = 0; i < n; i++) {
    const [za, ya] = points[i];
    const [zb, yb] = points[(i + 1) % n];
    const a1 = v(za, ya, 1);
    const b1 = v(zb, yb, 1);
    const a0 = v(za, ya, -1);
    const b0 = v(zb, yb, -1);
    tri(a1, a0, b0);
    tri(a1, b0, b1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

function fixWinding(g) {
  // Ensure outward-facing triangles: flip any triangle whose normal points towards the centre.
  const p = g.attributes.position.array;
  const c = new THREE.Vector3();
  g.computeBoundingBox();
  g.boundingBox.getCenter(c);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), d = new THREE.Vector3(), n = new THREE.Vector3(), m = new THREE.Vector3();
  for (let i = 0; i < p.length; i += 9) {
    a.fromArray(p, i);
    b.fromArray(p, i + 3);
    d.fromArray(p, i + 6);
    n.subVectors(b, a).cross(m.subVectors(d, a));
    m.copy(a).add(b).add(d).multiplyScalar(1 / 3).sub(c);
    if (n.dot(m) < 0) {
      for (let k = 0; k < 3; k++) {
        const t = p[i + 3 + k];
        p[i + 3 + k] = p[i + 6 + k];
        p[i + 6 + k] = t;
      }
    }
  }
  g.attributes.position.needsUpdate = true;
  g.computeVertexNormals();
  return g;
}

const BODY_PROFILE = [
  [-2.1, -0.42],
  [2.05, -0.42],
  [2.18, -0.2],
  [1.98, 0.0],
  [0.45, 0.12],
  [-1.75, 0.18],
  [-2.12, 0.12],
];

const CABIN_PROFILE = [
  [0.55, 0.08],
  [-0.08, 0.55],
  [-0.95, 0.56],
  [-1.7, 0.14],
];

let shared = null;
function sharedGeometry() {
  if (shared) return shared;
  const body = fixWinding(extrudeProfile(BODY_PROFILE, (y, z) => (z > 1.6 ? 0.88 : 0.96) - (y < -0.3 ? 0.04 : 0)));
  const cabin = fixWinding(extrudeProfile(CABIN_PROFILE, (y) => (y > 0.4 ? 0.6 : 0.84)));
  const wing = new THREE.BoxGeometry(1.9, 0.08, 0.42);
  const strut = new THREE.BoxGeometry(0.08, 0.3, 0.2);
  const wheel = new THREE.CylinderGeometry(CAR.wheelRadius, CAR.wheelRadius, 0.32, 10).rotateZ(Math.PI / 2);
  const rim = new THREE.CylinderGeometry(0.2, 0.2, 0.34, 6).rotateZ(Math.PI / 2);
  const light = new THREE.BoxGeometry(0.42, 0.1, 0.06);
  const stripe = new THREE.BoxGeometry(0.34, 0.02, 2.2);
  shared = { body, cabin, wing, strut, wheel, rim, light, stripe };
  return shared;
}

/**
 * Low-poly race car. Use `update(pos, quat, physics?)` each frame.
 * Ghost cars are translucent and ignore wheel animation details.
 */
export class CarModel {
  constructor({ color = '#e8402f', accent = '#1d1f27', ghost = false, shadows = true } = {}) {
    const g = sharedGeometry();
    this.group = new THREE.Group();
    const opts = ghost ? { transparent: true, opacity: 0.38, depthWrite: false } : {};
    this.bodyMat = new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.45, metalness: 0.1, ...opts });
    this.accentMat = new THREE.MeshStandardMaterial({ color: accent, flatShading: true, roughness: 0.6, ...opts });
    const glassMat = new THREE.MeshStandardMaterial({ color: 0x1b2433, flatShading: true, roughness: 0.15, metalness: 0.3, ...opts });
    const tyreMat = new THREE.MeshStandardMaterial({ color: 0x23252b, flatShading: true, roughness: 0.9, ...opts });
    const rimMat = new THREE.MeshStandardMaterial({ color: 0xc9ced8, flatShading: true, roughness: 0.4, metalness: 0.5, ...opts });
    const headMat = new THREE.MeshBasicMaterial({ color: 0xfff6d6, ...opts });
    const tailMat = new THREE.MeshBasicMaterial({ color: 0xff2a3a, ...opts });

    const body = new THREE.Mesh(g.body, this.bodyMat);
    const cabin = new THREE.Mesh(g.cabin, glassMat);
    const stripe = new THREE.Mesh(g.stripe, this.accentMat);
    stripe.position.set(0, 0.13, 0.9);
    stripe.rotation.x = -0.075;
    const wing = new THREE.Mesh(g.wing, this.accentMat);
    wing.position.set(0, 0.52, -1.88);
    const s1 = new THREE.Mesh(g.strut, this.accentMat);
    s1.position.set(0.55, 0.33, -1.85);
    const s2 = s1.clone();
    s2.position.x = -0.55;
    const hl1 = new THREE.Mesh(g.light, headMat);
    hl1.position.set(0.55, -0.08, 2.06);
    hl1.rotation.x = -0.6;
    const hl2 = hl1.clone();
    hl2.position.x = -0.55;
    const tl1 = new THREE.Mesh(g.light, tailMat);
    tl1.position.set(0.6, 0.05, -2.12);
    const tl2 = tl1.clone();
    tl2.position.x = -0.6;
    this.chassis = new THREE.Group();
    this.chassis.add(body, cabin, stripe, wing, s1, s2, hl1, hl2, tl1, tl2);
    this.group.add(this.chassis);

    this.wheels = CAR.wheels.map((w) => {
      const pivot = new THREE.Group();
      pivot.position.set(w.x, -CAR.restLength + 0.05, w.z);
      const spin = new THREE.Group();
      const tyre = new THREE.Mesh(g.wheel, tyreMat);
      const rim = new THREE.Mesh(g.rim, rimMat);
      spin.add(tyre, rim);
      pivot.add(spin);
      this.group.add(pivot);
      return { pivot, spin, def: w };
    });

    this.group.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = shadows && !ghost;
        o.receiveShadow = false;
        if (ghost) o.renderOrder = 2;
      }
    });
  }

  setColors(color, accent) {
    this.bodyMat.color.set(color);
    if (accent) this.accentMat.color.set(accent);
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
  }

  /** Pose from raw transform (ghosts / replays). */
  setPose(pos, quat) {
    this.group.position.copy(pos);
    this.group.quaternion.copy(quat);
  }

  dispose() {
    this.group.traverse((o) => {
      if (o.isMesh && o.material) o.material.dispose();
    });
  }
}
