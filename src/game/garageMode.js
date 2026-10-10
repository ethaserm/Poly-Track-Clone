import * as THREE from 'three';
import { CarModel } from './carModel.js';
import { THEMES } from './environment.js';
import { themeEnvMap } from './renderer.js';
import { h } from './ui.js';

const BODY = ['#e8402f', '#ff8a1e', '#ffd23f', '#3ccf6e', '#1fb6d6', '#3a6df0', '#9a5cf0', '#f05ca8', '#f4f6fa', '#9aa3b5', '#2a2d36', '#0f5f4a'];
const ACCENT = ['#1d1f27', '#f4f6fa', '#ffd23f', '#e8402f', '#3a6df0', '#3ccf6e', '#ff8a1e', '#9a5cf0'];
const RIMS = ['#c9ced8', '#1d1f27', '#d4af37', '#f4f6fa', '#e8402f', '#3a6df0'];
const LIVERIES = [
  ['stripe', 'Racing stripe'],
  ['two-tone', 'Two-tone'],
  ['hood', 'Hood'],
  ['plain', 'Plain'],
];

/** Car customisation with a live 3D turntable preview. */
export class GarageMode {
  constructor(app) {
    this.app = app;
    const s = app.settings;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x1a1d26);
    this.scene.fog = new THREE.Fog(0x1a1d26, 14, 40);
    this.camera = new THREE.PerspectiveCamera(38, app.aspect, 0.1, 200);
    this.envMap = themeEnvMap(app.renderer, THEMES.summer, 'summer');

    this.scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x2a2420, 1.2));
    const key = new THREE.DirectionalLight(0xffffff, 2.6);
    key.position.set(5, 9, 6);
    key.castShadow = app.quality.shadows;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.left = key.shadow.camera.bottom = -5;
    key.shadow.camera.right = key.shadow.camera.top = 5;
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0x8fb8ff, 1.6);
    rim.position.set(-6, 4, -7);
    this.scene.add(rim);

    // Turntable with a glowing edge and a backdrop of light strips.
    const table = new THREE.Mesh(
      new THREE.CylinderGeometry(4.2, 4.4, 0.3, 64),
      new THREE.MeshStandardMaterial({ color: 0x2b2f3a, roughness: 0.35, metalness: 0.4 }),
    );
    table.position.y = -0.98;
    table.receiveShadow = true;
    this.scene.add(table);
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(4.3, 0.04, 8, 96),
      new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0xffd23f, emissiveIntensity: 3 }),
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.y = -0.82;
    this.scene.add(ring);
    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(40, 64).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: 0x15171e, roughness: 0.6 }),
    );
    floor.position.y = -1.14;
    floor.receiveShadow = true;
    this.scene.add(floor);
    for (let i = 0; i < 9; i++) {
      const strip = new THREE.Mesh(
        new THREE.BoxGeometry(0.15, 6, 0.15),
        new THREE.MeshStandardMaterial({ color: 0x111111, emissive: i % 2 ? 0x35d6ff : 0xffffff, emissiveIntensity: 1.6 }),
      );
      const a = -0.9 + i * 0.22;
      strip.position.set(Math.sin(a) * 14, 1.8, -Math.cos(a) * 14);
      this.scene.add(strip);
    }

    this.turn = new THREE.Group();
    this.scene.add(this.turn);
    this.buildCar();

    this.yaw = 0.7;
    this.pitch = 0.22;
    this.dist = 9;
    this.autoSpin = true;
    this.buildUI();
    this.bindInput();
  }

  buildCar() {
    if (this.car) {
      this.turn.remove(this.car.group);
      this.car.dispose();
    }
    const s = this.app.settings;
    this.car = new CarModel({
      color: s.carColor,
      accent: s.accentColor,
      rim: s.rimColor,
      livery: s.livery,
      number: s.carNumber,
      envMap: this.envMap,
      shadows: true,
    });
    this.car.group.position.y = 0.0;
    this.car.wheels.forEach((w) => (w.pivot.position.y = -0.46));
    this.car.setLights({ brake: 0, reverse: false, boost: 0 });
    this.turn.add(this.car.group);
  }

  buildUI() {
    const s = this.app.settings;
    const swatches = (list, current, key) =>
      list
        .map((c) => `<button class="swatch ${c.toLowerCase() === String(current).toLowerCase() ? 'active' : ''}" data-key="${key}" data-color="${c}" style="background:${c}" aria-label="${c}"></button>`)
        .join('') + `<label class="swatch custom" title="Custom colour"><input type="color" data-key="${key}" value="${current}" /></label>`;
    this.el = h(`
      <div class="garage">
        <div class="garage-head">
          <button class="btn icon" data-g="back" title="Back">←</button>
          <h1>Garage</h1>
        </div>
        <div class="garage-panel">
          <h3>Body</h3><div class="swatches">${swatches(BODY, s.carColor, 'carColor')}</div>
          <h3>Accent</h3><div class="swatches">${swatches(ACCENT, s.accentColor, 'accentColor')}</div>
          <h3>Rims</h3><div class="swatches">${swatches(RIMS, s.rimColor, 'rimColor')}</div>
          <h3>Livery</h3>
          <div class="seg wrap">${LIVERIES.map(([k, l]) => `<button class="btn ${s.livery === k ? 'on' : ''}" data-livery="${k}">${l}</button>`).join('')}</div>
          <h3>Race number</h3>
          <div class="num-row">
            <button class="btn icon" data-g="num-">−</button>
            <input class="num-input" type="number" min="0" max="99" value="${s.carNumber}" />
            <button class="btn icon" data-g="num+">+</button>
          </div>
          <div class="specs">
            <div><span>Top speed</span><b>≈ 216 km/h</b></div>
            <div><span>0–100 km/h</span><b>2.1 s</b></div>
            <div><span>Drive</span><b>AWD</b></div>
          </div>
          <button class="btn primary big" data-g="back">Done</button>
        </div>
        <div class="garage-hint">Drag to rotate · scroll to zoom</div>
      </div>`);
    this.app.uiRoot.appendChild(this.el);
    this.el.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      const s = this.app.settings;
      if (b.dataset.g === 'back') {
        this.app.audio.click();
        this.app.showMenu();
        return;
      }
      if (b.dataset.color) {
        s[b.dataset.key] = b.dataset.color;
        this.applyColors();
        this.refreshSwatches();
      } else if (b.dataset.livery) {
        s.livery = b.dataset.livery;
        this.el.querySelectorAll('[data-livery]').forEach((x) => x.classList.toggle('on', x === b));
        this.buildCar();
      } else if (b.dataset.g === 'num-' || b.dataset.g === 'num+') {
        s.carNumber = (s.carNumber + (b.dataset.g === 'num+' ? 1 : 99)) % 100;
        this.el.querySelector('.num-input').value = s.carNumber;
        this.buildCar();
      }
      this.app.audio.click();
      this.app.saveSettings();
    });
    this.el.querySelectorAll('input[type=color]').forEach((inp) =>
      inp.addEventListener('input', () => {
        this.app.settings[inp.dataset.key] = inp.value;
        this.applyColors();
        this.refreshSwatches();
        this.app.saveSettings();
      }),
    );
    this.el.querySelector('.num-input').addEventListener('change', (e) => {
      const n = Math.max(0, Math.min(99, Math.round(Number(e.target.value) || 0)));
      e.target.value = n;
      this.app.settings.carNumber = n;
      this.app.saveSettings();
      this.buildCar();
    });
  }

  refreshSwatches() {
    const s = this.app.settings;
    this.el.querySelectorAll('.swatch[data-color]').forEach((b) => b.classList.toggle('active', b.dataset.color.toLowerCase() === String(s[b.dataset.key]).toLowerCase()));
  }

  applyColors() {
    const s = this.app.settings;
    this.car.setColors(s.carColor, s.accentColor, s.rimColor);
  }

  bindInput() {
    const canvas = this.app.renderer.domElement;
    let drag = null;
    this._down = (e) => {
      if (e.target !== canvas) return;
      drag = { x: e.clientX, y: e.clientY };
      this.autoSpin = false;
    };
    this._move = (e) => {
      if (!drag) return;
      this.yaw -= (e.clientX - drag.x) * 0.008;
      this.pitch = Math.max(0.02, Math.min(1.1, this.pitch + (e.clientY - drag.y) * 0.005));
      drag = { x: e.clientX, y: e.clientY };
    };
    this._up = () => {
      drag = null;
      clearTimeout(this._spinTimer);
      this._spinTimer = setTimeout(() => (this.autoSpin = true), 2500);
    };
    this._wheel = (e) => {
      if (e.target !== canvas) return;
      this.dist = Math.max(5, Math.min(16, this.dist * Math.exp(e.deltaY * 0.001)));
    };
    canvas.addEventListener('pointerdown', this._down);
    window.addEventListener('pointermove', this._move);
    window.addEventListener('pointerup', this._up);
    canvas.addEventListener('wheel', this._wheel, { passive: true });
  }

  frame(dt) {
    if (this.autoSpin) this.yaw += dt * 0.35;
    const c = this.camera;
    // Shift the car left of centre on wide screens so the panel doesn't cover it.
    const offset = this.app.aspect > 1.2 ? 1.6 : 0;
    c.position.set(Math.sin(this.yaw) * Math.cos(this.pitch) * this.dist, Math.sin(this.pitch) * this.dist + 0.2, Math.cos(this.yaw) * Math.cos(this.pitch) * this.dist);
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    c.position.addScaledVector(right, offset);
    c.lookAt(right.multiplyScalar(offset).add(new THREE.Vector3(0, -0.1, 0)));
    for (const w of this.car.wheels) w.spin.rotation.x += dt * 0.6;
    this.app.render(this.scene, this.camera, dt);
  }

  resize(aspect) {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  dispose() {
    const canvas = this.app.renderer.domElement;
    canvas.removeEventListener('pointerdown', this._down);
    window.removeEventListener('pointermove', this._move);
    window.removeEventListener('pointerup', this._up);
    canvas.removeEventListener('wheel', this._wheel);
    clearTimeout(this._spinTimer);
    this.el.remove();
    this.car.dispose();
  }
}
