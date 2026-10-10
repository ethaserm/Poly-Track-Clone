import * as THREE from 'three';
import { buildPieceLocal } from '../core/pieces.js';
import { compileTrack, occupiedCells, pieceTransform } from '../core/track.js';
import { CarModel } from './carModel.js';
import { Effects } from './effects.js';
import { THEMES, buildEnvironment, seedFrom } from './environment.js';
import { themeEnvMap } from './renderer.js';
import { TrackView } from './trackView.js';

export function occupiedSet(track) {
  const set = new Set();
  for (const pc of track.pieces) for (const c of occupiedCells(pc)) set.add(`${c.x},${c.z}`);
  return set;
}

/** World-space centre lines of every piece (for the minimap). */
export function trackLines(track) {
  return track.pieces.map((pc) => {
    const tf = pieceTransform(pc);
    return buildPieceLocal(pc.t, !!pc.m).centerline.map((f) => tf(f.p));
  });
}

const _size = new THREE.Vector2();
const previewCache = new Map();

/** Small top-down drawing of a track's layout (data URL), used on track cards. */
export function trackPreview(track, w = 220, h = 86) {
  const key = track.id || track.name;
  if (previewCache.has(key)) return previewCache.get(key);
  const lines = trackLines(track);
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const l of lines)
    for (const p of l) {
      minX = Math.min(minX, p[0]);
      maxX = Math.max(maxX, p[0]);
      minZ = Math.min(minZ, p[2]);
      maxZ = Math.max(maxZ, p[2]);
    }
  const dpr = 2;
  const c = document.createElement('canvas');
  c.width = w * dpr;
  c.height = h * dpr;
  const g = c.getContext('2d');
  g.scale(dpr, dpr);
  const pad = 10;
  const s = Math.min((w - pad * 2) / Math.max(1, maxX - minX), (h - pad * 2) / Math.max(1, maxZ - minZ));
  const ox = (w - (maxX - minX) * s) / 2;
  const oy = (h - (maxZ - minZ) * s) / 2;
  const map = (p) => [ox + (maxX - p[0]) * s, oy + (maxZ - p[2]) * s];
  for (const [width, color] of [
    [5, 'rgba(10,12,18,0.45)'],
    [2.6, 'rgba(255,255,255,0.95)'],
  ]) {
    g.strokeStyle = color;
    g.lineWidth = width;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    for (const l of lines) {
      g.beginPath();
      l.forEach((p, i) => (i ? g.lineTo(...map(p)) : g.moveTo(...map(p))));
      g.stroke();
    }
  }
  const url = c.toDataURL();
  previewCache.set(key, url);
  return url;
}

/**
 * Everything needed to show a track: compiled data, environment, track meshes,
 * effects, camera. Shared by races, replays and the menu's demo lap.
 */
export class TrackScene {
  constructor(app, track, { effects = true } = {}) {
    this.app = app;
    this.track = track;
    const q = app.quality;
    const shadows = q.shadows;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(70, app.aspect, 0.1, 6000);
    this.scene.add(this.camera);
    this.compiled = compileTrack(track);
    this.env = buildEnvironment(track.env, {
      compiled: this.compiled,
      occupied: occupiedSet(track),
      seed: seedFrom(track.name || 'track'),
      shadows,
      quality: q,
    });
    this.scene.add(this.env.group);
    this.scene.fog = this.env.fog;
    this.view = new TrackView(this.compiled, { shadows });
    this.scene.add(this.view.group);
    this.envMap = themeEnvMap(app.renderer, THEMES[track.env] || THEMES.summer, track.env || 'summer');
    this.effects = effects
      ? new Effects(this.scene, { env: track.env, quality: q.particles, skidmarks: app.settings.skidmarks })
      : null;
    this.cars = [];
  }

  /** The player's car in their chosen colours. */
  createPlayerCar() {
    const s = this.app.settings;
    return this.addCar(
      new CarModel({
        color: s.carColor,
        accent: s.accentColor,
        rim: s.rimColor,
        livery: s.livery,
        number: s.carNumber,
        shadows: this.app.quality.shadows,
        envMap: this.envMap,
      }),
    );
  }

  createGhostCar() {
    const g = this.addCar(new CarModel({ ghost: true, color: '#ffffff', accent: '#9aa3b5', rim: '#ffffff', livery: 'plain' }));
    g.group.visible = false;
    return g;
  }

  addCar(model) {
    this.scene.add(model.group);
    this.cars.push(model);
    return model;
  }

  /** Pixel scale for world-sized particles. */
  particleScale() {
    return this.app.gfx.renderer.getDrawingBufferSize(_size).y / (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)));
  }

  update(dt, focus) {
    this.env.update(focus, dt, this.camera);
    this.view.update(dt);
  }

  render(dt) {
    this.app.render(this.scene, this.camera, dt);
  }

  resize(aspect) {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  dispose() {
    this.view.dispose();
    this.env.dispose();
    this.effects?.dispose();
    for (const c of this.cars) c.dispose();
  }
}
