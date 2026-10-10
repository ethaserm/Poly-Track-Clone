import * as THREE from 'three';
import { BUILTIN_TRACKS } from './core/tracks.js';
import { decodeTrack } from './core/share.js';
import { AudioFx } from './game/audio.js';
import { EditorMode } from './game/editorMode.js';
import { Input } from './game/input.js';
import { MenuMode } from './game/menuMode.js';
import { RaceMode } from './game/raceMode.js';
import { loadSettings, saveCustomTrack, saveSettings } from './game/storage.js';
import { toast } from './game/ui.js';
import './style.css';

class App {
  constructor() {
    this.container = document.getElementById('app');
    this.uiRoot = document.getElementById('ui');
    this.settings = loadSettings();

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = this.settings.shadows;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.container.appendChild(this.renderer.domElement);

    this.input = new Input();
    this.audio = new AudioFx();
    this.audio.enabled = this.settings.sound;
    this.audio.volume = this.settings.volume;
    const unlock = () => this.audio.ensure();
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });

    this.mode = null;
    this.resize();
    window.addEventListener('resize', () => this.resize());
    this.last = performance.now();
    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);
  }

  get aspect() {
    return this.width / this.height;
  }

  resize() {
    this.width = window.innerWidth;
    this.height = window.innerHeight;
    this.renderer.setSize(this.width, this.height);
    this.mode?.resize?.(this.aspect);
  }

  setMode(mode) {
    const old = this.mode;
    this.mode = null;
    old?.dispose();
    this.mode = mode();
    this.mode.resize?.(this.aspect);
  }

  showMenu(screen = 'main') {
    this.setMode(() => new MenuMode(this, screen));
  }

  playTrack(track, opts = {}) {
    if (history.replaceState && location.hash) history.replaceState(null, '', location.pathname + location.search);
    this.setMode(() => new RaceMode(this, track, opts));
  }

  openEditor(track) {
    this.setMode(() => new EditorMode(this, track));
  }

  nextBuiltin(track) {
    if (!track.builtin) return null;
    const i = BUILTIN_TRACKS.findIndex((t) => t.id === track.id);
    return BUILTIN_TRACKS[i + 1] || null;
  }

  saveCustom(track) {
    return saveCustomTrack(track);
  }

  saveSettings() {
    saveSettings(this.settings);
  }

  toggleSound() {
    this.settings.sound = !this.settings.sound;
    this.audio.setEnabled(this.settings.sound);
    this.saveSettings();
    toast(this.uiRoot, this.settings.sound ? 'Sound on' : 'Sound off', 900);
  }

  loop(now) {
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    try {
      this.mode?.frame(dt);
    } catch (err) {
      console.error(err);
    }
    requestAnimationFrame(this.loop);
  }
}

async function boot() {
  const testCanvas = document.createElement('canvas');
  if (!testCanvas.getContext('webgl2') && !testCanvas.getContext('webgl')) {
    document.getElementById('ui').innerHTML =
      '<div class="fatal">This game needs WebGL. Please try a different browser or enable hardware acceleration.</div>';
    return;
  }
  // Gate banners are drawn into canvases, so give the web font a moment to arrive first.
  if (document.fonts?.load) {
    await Promise.race([
      document.fonts.load('900 64px "Exo 2"').catch(() => {}),
      new Promise((r) => setTimeout(r, 1500)),
    ]);
  }
  const app = new App();
  window.__app = app;
  const m = /#track=([A-Za-z0-9_-]+)/.exec(location.hash);
  if (m) {
    try {
      const track = await decodeTrack(m[1]);
      if (track.pieces.some((p) => p.t === 'start')) {
        app.playTrack(track);
        return;
      }
    } catch (err) {
      console.warn('Bad track link', err);
    }
  }
  app.showMenu();
}

boot();
