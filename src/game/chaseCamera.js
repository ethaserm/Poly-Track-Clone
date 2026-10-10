import * as THREE from 'three';

export const CAMERA_MODES = [
  { name: 'Chase', dist: 7.6, height: 2.7, look: 2.2, lookUp: 1.0, fov: 70 },
  { name: 'Close', dist: 5.4, height: 1.8, look: 3.0, lookUp: 0.8, fov: 72 },
  { name: 'Hood', hood: true, fov: 82 },
];

const _v = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _up = new THREE.Vector3();
const _target = new THREE.Vector3();

/** Smoothed third-person / hood camera that rolls with the car through loops. */
export class ChaseCamera {
  constructor(camera) {
    this.camera = camera;
    this.mode = 0;
    this.fwd = new THREE.Vector3(0, 0, 1);
    this.up = new THREE.Vector3(0, 1, 0);
    this.fov = 70;
    this.orbit = 0;
  }

  setMode(i) {
    this.mode = ((i % CAMERA_MODES.length) + CAMERA_MODES.length) % CAMERA_MODES.length;
  }

  snap(pos, quat) {
    this.fwd.set(0, 0, 1).applyQuaternion(quat);
    this.up.set(0, 1, 0).applyQuaternion(quat);
    this.update(1, pos, quat, 0, true, true);
  }

  update(dt, pos, quat, speed, grounded, snap = false) {
    const m = CAMERA_MODES[this.mode];
    _fwd.set(0, 0, 1).applyQuaternion(quat);
    _up.set(0, 1, 0).applyQuaternion(quat);
    const cam = this.camera;

    if (m.hood) {
      cam.position.copy(pos).addScaledVector(_up, 0.95).addScaledVector(_fwd, -0.4);
      cam.up.copy(_up);
      _target.copy(cam.position).addScaledVector(_fwd, 10).addScaledVector(_up, -0.4);
      cam.lookAt(_target);
    } else {
      const kf = snap ? 1 : 1 - Math.exp(-dt * (grounded ? 7 : 2.2));
      const ku = snap ? 1 : 1 - Math.exp(-dt * (grounded ? 4.5 : 1.2));
      this.fwd.lerp(_fwd, kf).normalize();
      this.up.lerp(_up, ku).normalize();
      // Keep fwd perpendicular-ish to up for a stable rig.
      _v.copy(this.fwd).addScaledVector(this.up, -this.fwd.dot(this.up) * 0.5).normalize();
      cam.position.copy(pos).addScaledVector(_v, -m.dist).addScaledVector(this.up, m.height);
      cam.up.copy(this.up);
      _target.copy(pos).addScaledVector(_v, m.look).addScaledVector(this.up, m.lookUp);
      cam.lookAt(_target);
    }

    // Portrait screens get a wider vertical FOV so the road stays visible.
    const portrait = cam.aspect < 1 ? Math.min(22, (1 / cam.aspect - 1) * 18) : 0;
    const targetFov = m.fov + portrait + Math.min(24, Math.max(0, speed - 15) * 0.22);
    this.fov += (targetFov - this.fov) * (snap ? 1 : 1 - Math.exp(-dt * 3));
    if (Math.abs(cam.fov - this.fov) > 0.01) {
      cam.fov = this.fov;
      cam.updateProjectionMatrix();
    }
  }

  /** Slow cinematic orbit around a point (finish screen, menu demo). */
  updateOrbit(dt, pos, radius = 9, height = 3.2) {
    this.orbit += dt * 0.35;
    const cam = this.camera;
    cam.position.set(pos.x + Math.cos(this.orbit) * radius, pos.y + height, pos.z + Math.sin(this.orbit) * radius);
    cam.up.set(0, 1, 0);
    cam.lookAt(pos.x, pos.y + 0.6, pos.z);
    if (Math.abs(cam.fov - 60) > 0.01) {
      cam.fov = 60;
      this.fov = 60;
      cam.updateProjectionMatrix();
    }
  }
}
