import * as THREE from 'three';
import { DECK, LEVEL, TILE } from '../core/constants.js';
import { PIECES, PIECE_TYPES } from '../core/pieces.js';
import { decodeTrack, encodeTrack } from '../core/share.js';
import { occupiedCells } from '../core/track.js';
import { buildEnvironment, THEMES } from './environment.js';
import { createPieceObject, placePieceObject } from './trackView.js';
import { copyText, escapeHtml, h, openPanel, toast } from './ui.js';

const PALETTE = [
  'start',
  'straight',
  'turn',
  'wideTurn',
  'slope',
  'slopeLong',
  'checkpoint',
  'boost',
  'ramp',
  'loop',
  'platform',
  'finish',
];
const MAX_LEVEL = 40;
const MAX_CELL = 80;

let thumbCache = null;

/** Build grid drawn as a textured plane (robust on every GPU, unlike long GL lines). */
function makeGridPlane(anisotropy) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  g.clearRect(0, 0, 64, 64);
  g.fillStyle = 'rgba(255,255,255,1)';
  g.fillRect(0, 0, 64, 2);
  g.fillRect(0, 0, 2, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(120, 120);
  tex.anisotropy = anisotropy;
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(TILE * 120, TILE * 120).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({
      color: 0x1d2330,
      alphaMap: tex,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      fog: true,
    }),
  );
  mesh.renderOrder = 1;
  return mesh;
}

/** Renders a small picture of every piece type (once per session). */
function makeThumbnails(renderer) {
  if (thumbCache) return thumbCache;
  thumbCache = {};
  const size = 112;
  const rt = new THREE.WebGLRenderTarget(size, size);
  rt.texture.colorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8899aa, 1.6));
  const dir = new THREE.DirectionalLight(0xffffff, 2.2);
  dir.position.set(30, 60, 20);
  scene.add(dir);
  const cam = new THREE.PerspectiveCamera(32, 1, 0.1, 1000);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const buf = new Uint8Array(size * size * 4);
  const prevClear = renderer.getClearColor(new THREE.Color());
  const prevAlpha = renderer.getClearAlpha();
  for (const type of PIECE_TYPES) {
    const obj = createPieceObject({ t: type, x: 0, y: 0, z: 0, r: 0, m: 0 }, { withPillars: false, shadows: false });
    scene.add(obj);
    const box = new THREE.Box3().setFromObject(obj);
    const c = box.getCenter(new THREE.Vector3());
    const r = box.getSize(new THREE.Vector3()).length() * 0.5;
    const dist = r / Math.sin(THREE.MathUtils.degToRad(cam.fov / 2)) * 0.95;
    cam.position.copy(c).add(new THREE.Vector3(-0.75, 0.85, -0.65).normalize().multiplyScalar(dist));
    cam.lookAt(c);
    renderer.setRenderTarget(rt);
    renderer.setClearColor(0x000000, 0);
    renderer.clear();
    renderer.render(scene, cam);
    renderer.readRenderTargetPixels(rt, 0, 0, size, size, buf);
    const img = ctx.createImageData(size, size);
    for (let y = 0; y < size; y++) {
      const src = (size - 1 - y) * size * 4;
      img.data.set(buf.subarray(src, src + size * 4), y * size * 4);
    }
    ctx.putImageData(img, 0, 0);
    thumbCache[type] = canvas.toDataURL();
    scene.remove(obj);
  }
  renderer.setRenderTarget(null);
  renderer.setClearColor(prevClear, prevAlpha);
  rt.dispose();
  return thumbCache;
}

export class EditorMode {
  constructor(app, track) {
    this.app = app;
    const { _dirty, ...rest } = track || {};
    this.track = track
      ? { ...rest, pieces: rest.pieces.map((p) => ({ ...p, m: p.m ? 1 : 0 })) }
      : { name: 'My Track', env: 'summer', pieces: [] };
    if (this.track.builtin) {
      // Editing a campaign track creates a copy.
      this.track = { name: this.track.name + ' (copy)', env: this.track.env, pieces: this.track.pieces };
    }
    this.dirty = _dirty ?? !!(track && !track.id);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(55, app.aspect, 0.5, 6000);
    this.target = new THREE.Vector3(0, 0, 0);
    this.yaw = Math.PI * 0.8;
    this.pitch = 0.75;
    this.distance = 95;

    this.type = 'straight';
    this.rot = 0;
    this.mirror = 0;
    this.level = 0;
    this.eraser = false;
    this.hover = null;
    this.undoStack = [];
    this.redoStack = [];
    this.keys = new Set();

    this.piecesGroup = new THREE.Group();
    this.scene.add(this.piecesGroup);
    this.objects = [];

    this.grid = makeGridPlane(app.renderer.capabilities.getMaxAnisotropy());
    this.scene.add(this.grid);

    this.cursor = new THREE.Mesh(
      new THREE.BoxGeometry(TILE, 0.15, TILE),
      new THREE.MeshBasicMaterial({ color: 0x46c3ff, transparent: true, opacity: 0.25, depthWrite: false }),
    );
    this.scene.add(this.cursor);
    this.eraseBox = new THREE.BoxHelper(undefined, 0xff4d4d);
    this.eraseBox.visible = false;
    this.scene.add(this.eraseBox);

    this.previewMat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      flatShading: true,
      transparent: true,
      opacity: 0.6,
      emissive: 0x00ff66,
      emissiveIntensity: 0.25,
      depthWrite: false,
    });

    this.buildEnv();
    this.rebuildAll();
    this.buildUI();
    this.setType(this.type);
    this.fitView();
    this.bindEvents();
  }

  // --- Scene ------------------------------------------------------------------

  buildEnv() {
    if (this.env) {
      this.scene.remove(this.env.group);
      this.env.dispose();
    }
    this.env = buildEnvironment(this.track.env, {
      bounds: { minX: -20, maxX: 20, minZ: -20, maxZ: 20 },
      seed: 7,
      shadows: this.app.quality.shadows,
      decorCount: 0,
    });
    this.scene.add(this.env.group);
    this.scene.fog = new THREE.Fog(this.env.theme.fog, 600, 3500);
  }

  rebuildAll() {
    for (const o of this.objects) this.piecesGroup.remove(o);
    this.objects = this.track.pieces.map((pc) => {
      const o = createPieceObject(pc, { shadows: this.app.quality.shadows });
      this.piecesGroup.add(o);
      return o;
    });
    this.updateStatus?.();
  }

  rebuildPreview() {
    if (this.preview) this.scene.remove(this.preview);
    this.preview = null;
    if (this.eraser) return;
    this.preview = createPieceObject(
      { t: this.type, x: 0, y: 0, z: 0, r: this.rot, m: this.mirror },
      { material: this.previewMat, withPillars: false, shadows: false },
    );
    this.preview.traverse((o) => {
      if (o.isMesh) o.renderOrder = 3;
    });
    this.scene.add(this.preview);
    this.updatePreview();
  }

  candidate() {
    if (!this.hover) return null;
    return { t: this.type, x: this.hover.x, y: this.level, z: this.hover.z, r: this.rot, m: this.mirror };
  }

  conflicts(pc) {
    const mine = occupiedCells(pc);
    const hits = [];
    this.track.pieces.forEach((other, i) => {
      for (const a of mine)
        for (const b of occupiedCells(other))
          if (a.x === b.x && a.z === b.z && a.y0 < b.y1 && b.y0 < a.y1) {
            if (!hits.includes(i)) hits.push(i);
          }
    });
    return hits;
  }

  updatePreview() {
    const pc = this.candidate();
    const y = this.level * LEVEL;
    this.grid.position.set(
      Math.round(this.target.x / TILE) * TILE + TILE / 2,
      y + DECK - 0.02,
      Math.round(this.target.z / TILE) * TILE + TILE / 2,
    );
    this.cursor.visible = !!this.hover;
    if (this.hover) this.cursor.position.set(this.hover.x * TILE, y + DECK, this.hover.z * TILE);
    if (this.eraser) {
      const idx = this.hoverPiece;
      this.eraseBox.visible = idx != null;
      if (idx != null) this.eraseBox.setFromObject(this.objects[idx]);
      this.cursor.material.color.set(0xff4d4d);
      return;
    }
    this.eraseBox.visible = false;
    this.cursor.material.color.set(0x46c3ff);
    if (!this.preview) return;
    this.preview.visible = !!pc;
    if (!pc) return;
    placePieceObject(this.preview, pc);
    const bad = this.conflicts(pc).length > 0 || !this.inBounds(pc);
    this.previewValid = !bad;
    this.previewMat.emissive.set(bad ? 0xff2020 : 0x00ff66);
    this.previewMat.opacity = bad ? 0.45 : 0.65;
  }

  inBounds(pc) {
    return occupiedCells(pc).every(
      (c) => Math.abs(c.x) <= MAX_CELL && Math.abs(c.z) <= MAX_CELL && c.y0 >= 0 && c.y1 <= MAX_LEVEL + 13,
    );
  }

  // --- Editing ------------------------------------------------------------------

  snapshot() {
    this.undoStack.push(JSON.stringify(this.track.pieces));
    if (this.undoStack.length > 200) this.undoStack.shift();
    this.redoStack.length = 0;
    this.dirty = true;
  }

  undo() {
    if (!this.undoStack.length) return;
    this.redoStack.push(JSON.stringify(this.track.pieces));
    this.track.pieces = JSON.parse(this.undoStack.pop());
    this.dirty = true;
    this.rebuildAll();
    this.updatePreview();
  }

  redo() {
    if (!this.redoStack.length) return;
    this.undoStack.push(JSON.stringify(this.track.pieces));
    this.track.pieces = JSON.parse(this.redoStack.pop());
    this.dirty = true;
    this.rebuildAll();
    this.updatePreview();
  }

  place() {
    const pc = this.candidate();
    if (!pc) return;
    if (!this.inBounds(pc)) {
      toast(this.app.uiRoot, 'Out of bounds');
      return;
    }
    if (this.conflicts(pc).length) {
      toast(this.app.uiRoot, 'Something is already there — erase it first (right-click)');
      return;
    }
    this.snapshot();
    if (pc.t === 'start') {
      const old = this.track.pieces.findIndex((p) => p.t === 'start');
      if (old >= 0) {
        this.track.pieces.splice(old, 1);
        this.piecesGroup.remove(this.objects[old]);
        this.objects.splice(old, 1);
        toast(this.app.uiRoot, 'Start moved (a track has one start)');
      }
    }
    this.track.pieces.push(pc);
    const o = createPieceObject(pc, { shadows: this.app.quality.shadows });
    this.piecesGroup.add(o);
    this.objects.push(o);
    this.app.audio.click();
    this.updateStatus();
    this.updatePreview();
  }

  eraseAt(index) {
    if (index == null || index < 0) return;
    this.snapshot();
    this.track.pieces.splice(index, 1);
    this.piecesGroup.remove(this.objects[index]);
    this.objects.splice(index, 1);
    this.hoverPiece = null;
    this.app.audio.click();
    this.updateStatus();
    this.updatePreview();
  }

  /** Piece under the mouse (by mesh raycast), or null. */
  pickPiece(ndc) {
    this.raycaster.setFromCamera(ndc, this.camera);
    const hits = this.raycaster.intersectObjects(this.objects, true);
    for (const hit of hits) {
      let o = hit.object;
      while (o && !o.userData.piece) o = o.parent;
      if (o) return this.objects.indexOf(o);
    }
    return null;
  }

  setType(type) {
    this.type = type;
    this.eraser = false;
    this.mirror = 0;
    this.paletteEl?.querySelectorAll('.pal-item').forEach((b) => b.classList.toggle('active', b.dataset.type === type));
    this.paletteEl?.querySelector('.pal-erase')?.classList.remove('active');
    this.rebuildPreview();
    this.updateStatus();
  }

  setEraser(on) {
    this.eraser = on;
    this.paletteEl.querySelectorAll('.pal-item').forEach((b) => b.classList.toggle('active', !on && b.dataset.type === this.type));
    this.paletteEl.querySelector('.pal-erase').classList.toggle('active', on);
    this.rebuildPreview();
    this.updateStatus();
  }

  rotate(dir = 1) {
    this.rot = (this.rot + dir + 4) % 4;
    if (this.preview) placePieceObject(this.preview, this.candidate() || { x: 0, y: 0, z: 0, r: this.rot });
    this.updatePreview();
    this.updateStatus();
  }

  flip() {
    this.mirror = this.mirror ? 0 : 1;
    this.rebuildPreview();
    this.updateStatus();
  }

  changeLevel(d) {
    this.level = Math.max(0, Math.min(MAX_LEVEL, this.level + d));
    this.updateHover();
    this.updateStatus();
  }

  fitView() {
    if (!this.track.pieces.length) {
      this.target.set(0, 0, 0);
      return;
    }
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const pc of this.track.pieces)
      for (const c of occupiedCells(pc)) {
        minX = Math.min(minX, c.x);
        maxX = Math.max(maxX, c.x);
        minZ = Math.min(minZ, c.z);
        maxZ = Math.max(maxZ, c.z);
      }
    this.target.set(((minX + maxX) / 2) * TILE, 0, ((minZ + maxZ) / 2) * TILE);
    this.distance = Math.min(600, Math.max(70, Math.max(maxX - minX, maxZ - minZ) * TILE * 1.1));
  }

  // --- UI -------------------------------------------------------------------------

  buildUI() {
    const root = this.app.uiRoot;
    const thumbs = makeThumbnails(this.app.renderer);
    const envOptions = Object.entries(THEMES)
      .map(([k, t]) => `<option value="${k}" ${k === this.track.env ? 'selected' : ''}>${t.label}</option>`)
      .join('');
    this.topEl = h(`
      <div class="editor-top">
        <button class="btn icon" data-action="back" title="Back to menu">←</button>
        <input class="ed-name" maxlength="40" value="${escapeHtml(this.track.name)}" aria-label="Track name" />
        <select class="ed-env" aria-label="Environment">${envOptions}</select>
        <div class="spacer"></div>
        <button class="btn" data-action="undo" title="Undo (Ctrl+Z)">↶</button>
        <button class="btn" data-action="redo" title="Redo (Ctrl+Y)">↷</button>
        <button class="btn" data-action="new" title="New track">New</button>
        <button class="btn" data-action="import" title="Import a track code">Import</button>
        <button class="btn" data-action="export" title="Export a track code">Export</button>
        <button class="btn" data-action="save" title="Save (Ctrl+S)">Save</button>
        <button class="btn primary" data-action="test" title="Test drive (Enter)">▶ Test</button>
        <button class="btn icon" data-action="help" title="Controls">?</button>
      </div>`);
    this.paletteEl = h(`
      <div class="editor-palette">
        ${PALETTE.map(
          (t, i) => `
          <button class="pal-item" data-type="${t}" title="${PIECES[t].name}${i < 10 ? ` (${(i + 1) % 10})` : ''}">
            <img src="${thumbs[t]}" alt="" draggable="false" />
            <span>${PIECES[t].name}</span>
            ${i < 10 ? `<kbd>${(i + 1) % 10}</kbd>` : ''}
          </button>`,
        ).join('')}
        <button class="pal-item pal-erase" title="Eraser (X)">
          <div class="erase-icon">✕</div><span>Eraser</span><kbd>X</kbd>
        </button>
      </div>`);
    this.statusEl = h(`<div class="editor-status"></div>`);
    this.hintEl = h(`
      <div class="editor-hint">
        <b>Left-click</b> place · <b>Right-click</b> erase · <b>Right-drag</b> orbit · <b>Middle-drag / WASD</b> pan ·
        <b>Wheel</b> zoom · <b>R</b> rotate · <b>F</b> flip · <b>Q/E</b> or <b>Shift+Wheel</b> height
      </div>`);
    root.append(this.topEl, this.paletteEl, this.statusEl, this.hintEl);

    this.topEl.addEventListener('click', (e) => {
      const a = e.target.closest('[data-action]');
      if (a) this.action(a.dataset.action);
    });
    this.topEl.querySelector('.ed-name').addEventListener('input', (e) => {
      this.track.name = e.target.value || 'Untitled';
      this.dirty = true;
    });
    this.topEl.querySelector('.ed-env').addEventListener('change', (e) => {
      this.track.env = e.target.value;
      this.dirty = true;
      this.buildEnv();
      e.target.blur();
    });
    this.paletteEl.addEventListener('click', (e) => {
      const b = e.target.closest('.pal-item');
      if (!b) return;
      if (b.classList.contains('pal-erase')) this.setEraser(!this.eraser);
      else this.setType(b.dataset.type);
    });
  }

  updateStatus() {
    if (!this.statusEl) return;
    const p = this.track.pieces;
    const starts = p.filter((x) => x.t === 'start').length;
    const finishes = p.filter((x) => x.t === 'finish').length;
    const cps = p.filter((x) => x.t === 'checkpoint').length;
    const tool = this.eraser ? 'Eraser' : `${PIECES[this.type].name}${this.mirror ? ' (flipped)' : ''}`;
    this.statusEl.innerHTML = `
      <div><span class="label">Tool</span> ${tool}</div>
      <div><span class="label">Height</span> ${this.level}</div>
      <div><span class="label">Rotation</span> ${this.rot * 90}°</div>
      <div><span class="label">Pieces</span> ${p.length}</div>
      <div class="${starts ? 'ok' : 'bad'}">${starts ? '✓' : '✗'} Start</div>
      <div class="${finishes ? 'ok' : 'bad'}">${finishes ? '✓' : '✗'} Finish</div>
      <div><span class="label">CPs</span> ${cps}</div>`;
  }

  async action(a) {
    const app = this.app;
    app.audio.click();
    switch (a) {
      case 'back':
        if (this.dirty && this.track.pieces.length && !confirm('Leave the editor? Unsaved changes will be lost.')) return;
        app.showMenu();
        break;
      case 'undo':
        this.undo();
        break;
      case 'redo':
        this.redo();
        break;
      case 'new':
        if (this.track.pieces.length && !confirm('Start a new empty track? Unsaved changes will be lost.')) return;
        this.snapshot();
        this.track = { name: 'My Track', env: this.track.env, pieces: [] };
        this.topEl.querySelector('.ed-name').value = this.track.name;
        this.dirty = false;
        this.rebuildAll();
        this.updatePreview();
        break;
      case 'save':
        this.save();
        break;
      case 'test':
        this.test();
        break;
      case 'export':
        this.exportPanel();
        break;
      case 'import':
        this.importPanel();
        break;
      case 'help':
        this.helpPanel();
        break;
    }
  }

  save() {
    const saved = this.app.saveCustom(this.track);
    this.track.id = saved.id;
    this.dirty = false;
    toast(this.app.uiRoot, `Saved “${saved.name}”`);
  }

  test() {
    if (!this.track.pieces.some((p) => p.t === 'start')) {
      toast(this.app.uiRoot, 'Place a Start piece first');
      return;
    }
    this.app.playTrack({ ...this.track, pieces: this.track.pieces.map((p) => ({ ...p })) }, {
      fromEditor: { ...this.track, _dirty: this.dirty },
    });
  }

  async exportPanel() {
    if (!this.track.pieces.length) {
      toast(this.app.uiRoot, 'Nothing to export yet');
      return;
    }
    const code = await encodeTrack(this.track);
    const link = `${location.origin}${location.pathname}#track=${code}`;
    this.panel = openPanel(
      this.app.uiRoot,
      `<h2>Export track</h2>
       <div class="panel-sub">Share this code — anyone can import it from the editor or the track list.</div>
       <textarea class="code" readonly rows="5">${code}</textarea>
       <div class="btn-row">
         <button class="btn primary" data-action="copy">Copy code</button>
         <button class="btn" data-action="link">Copy play link</button>
         <button class="btn" data-action="close">Close</button>
       </div>`,
      {
        dismissible: true,
        onAction: async (act) => {
          if (act === 'copy') toast(this.app.uiRoot, (await copyText(code)) ? 'Code copied' : 'Copy failed — select the text manually');
          if (act === 'link') toast(this.app.uiRoot, (await copyText(link)) ? 'Link copied' : 'Copy failed');
          if (act === 'close') this.panel.close();
        },
      },
    );
    this.panel.el.querySelector('textarea').select();
  }

  importPanel() {
    this.panel = openPanel(
      this.app.uiRoot,
      `<h2>Import track</h2>
       <div class="panel-sub">Paste a track code (starts with PT1).</div>
       <textarea class="code" rows="5" placeholder="PT1…" autofocus></textarea>
       <div class="panel-error"></div>
       <div class="btn-row">
         <button class="btn primary" data-action="load">Load into editor</button>
         <button class="btn" data-action="close">Cancel</button>
       </div>`,
      {
        dismissible: true,
        onAction: async (act) => {
          if (act === 'close') return this.panel.close();
          const text = this.panel.el.querySelector('textarea').value;
          try {
            const t = await decodeTrack(text);
            this.snapshot();
            this.track = { name: t.name, env: t.env, pieces: t.pieces };
            this.topEl.querySelector('.ed-name').value = t.name;
            this.topEl.querySelector('.ed-env').value = t.env;
            this.buildEnv();
            this.rebuildAll();
            this.fitView();
            this.panel.close();
            toast(this.app.uiRoot, `Imported “${t.name}” (${t.pieces.length} pieces)`);
          } catch (err) {
            this.panel.el.querySelector('.panel-error').textContent = 'Could not read that code: ' + err.message;
          }
        },
      },
    );
  }

  helpPanel() {
    this.panel = openPanel(
      this.app.uiRoot,
      `<h2>Editor controls</h2>
       <table class="keys">
         <tr><td>Left click</td><td>Place piece</td></tr>
         <tr><td>Right click</td><td>Erase piece under cursor</td></tr>
         <tr><td>Right drag</td><td>Orbit camera</td></tr>
         <tr><td>Middle drag · WASD / arrows</td><td>Pan camera</td></tr>
         <tr><td>Mouse wheel</td><td>Zoom</td></tr>
         <tr><td>Q / E · Shift + wheel</td><td>Build height down / up</td></tr>
         <tr><td>R / Shift+R</td><td>Rotate piece</td></tr>
         <tr><td>F</td><td>Flip (mirror) piece</td></tr>
         <tr><td>1 – 0</td><td>Select piece</td></tr>
         <tr><td>X</td><td>Eraser tool</td></tr>
         <tr><td>Alt + click</td><td>Pick piece from track</td></tr>
         <tr><td>Ctrl+Z / Ctrl+Y</td><td>Undo / redo</td></tr>
         <tr><td>Ctrl+S</td><td>Save</td></tr>
         <tr><td>Enter</td><td>Test drive</td></tr>
       </table>
       <p class="panel-sub">A track needs a <b>Start</b> and a <b>Finish</b>. Every <b>Checkpoint</b> must be passed (in any order) before the finish counts. Elevated pieces get support pillars automatically.</p>
       <div class="btn-row"><button class="btn primary" data-action="close">Got it</button></div>`,
      { dismissible: true, onAction: () => this.panel.close() },
    );
  }

  // --- Input -------------------------------------------------------------------------

  bindEvents() {
    const canvas = this.app.renderer.domElement;
    this.raycaster = new THREE.Raycaster();
    this.ndc = new THREE.Vector2();
    let drag = null;

    this._pointerDown = (e) => {
      if (e.target !== canvas) return;
      drag = { button: e.button, x: e.clientX, y: e.clientY, moved: false, shift: e.shiftKey, alt: e.altKey };
      canvas.setPointerCapture?.(e.pointerId);
    };
    this._pointerMove = (e) => {
      const rect = canvas.getBoundingClientRect();
      this.ndc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
      if (drag) {
        const dx = e.clientX - drag.x;
        const dy = e.clientY - drag.y;
        if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true;
        if (drag.moved) {
          if (drag.button === 2 || (drag.button === 0 && drag.alt)) {
            this.yaw -= (e.movementX || 0) * 0.006;
            this.pitch = Math.max(0.12, Math.min(1.5, this.pitch + (e.movementY || 0) * 0.005));
          } else if (drag.button === 1 || (drag.button === 0 && drag.shift)) {
            const k = this.distance * 0.0016;
            const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
            const rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);
            this.target.x += (-(e.movementX || 0) * rx + (e.movementY || 0) * fx) * k;
            this.target.z += (-(e.movementX || 0) * rz + (e.movementY || 0) * fz) * k;
          }
        }
      }
      this.updateHover();
    };
    this._pointerUp = (e) => {
      if (!drag) return;
      const d = drag;
      drag = null;
      if (d.moved || e.target !== canvas) return;
      if (d.button === 0 && d.alt) {
        const idx = this.pickPiece(this.ndc);
        if (idx != null) {
          const pc = this.track.pieces[idx];
          this.setType(pc.t);
          this.rot = pc.r;
          this.mirror = pc.m ? 1 : 0;
          this.level = pc.y;
          this.rebuildPreview();
          this.updateStatus();
        }
        return;
      }
      if (d.button === 0) {
        if (this.eraser) this.eraseAt(this.pickPiece(this.ndc));
        else this.place();
      } else if (d.button === 2) {
        this.eraseAt(this.pickPiece(this.ndc));
      }
    };
    this._wheel = (e) => {
      if (e.target !== canvas) return;
      e.preventDefault();
      if (e.shiftKey) {
        this.changeLevel(e.deltaY > 0 || e.deltaX > 0 ? -1 : 1);
      } else {
        this.distance = Math.max(15, Math.min(900, this.distance * Math.exp(e.deltaY * 0.0012)));
        this.updateHover();
      }
    };
    this._contextMenu = (e) => {
      if (e.target === canvas) e.preventDefault();
    };
    this._keyDown = (e) => {
      const tag = e.target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (this.panel && !this.panel.closed) {
        if (e.code === 'Escape') this.panel.close();
        return;
      }
      const ctrl = e.ctrlKey || e.metaKey;
      if (ctrl && e.code === 'KeyZ') {
        e.preventDefault();
        if (e.shiftKey) this.redo();
        else this.undo();
        return;
      }
      if (ctrl && e.code === 'KeyY') {
        e.preventDefault();
        this.redo();
        return;
      }
      if (ctrl && e.code === 'KeyS') {
        e.preventDefault();
        this.save();
        return;
      }
      if (ctrl) return;
      this.keys.add(e.code);
      switch (e.code) {
        case 'KeyR':
          this.rotate(e.shiftKey ? -1 : 1);
          break;
        case 'KeyF':
          this.flip();
          break;
        case 'KeyQ':
        case 'PageDown':
          this.changeLevel(-1);
          break;
        case 'KeyE':
        case 'PageUp':
          this.changeLevel(1);
          break;
        case 'KeyX':
          this.setEraser(!this.eraser);
          break;
        case 'Delete':
        case 'Backspace':
          this.eraseAt(this.pickPiece(this.ndc));
          break;
        case 'Enter':
          e.preventDefault();
          this.test();
          break;
        case 'Escape':
          if (this.eraser) this.setEraser(false);
          break;
        default: {
          const m = /^Digit(\d)$/.exec(e.code);
          if (m) {
            const i = (Number(m[1]) + 9) % 10;
            if (PALETTE[i]) this.setType(PALETTE[i]);
          }
        }
      }
    };
    this._keyUp = (e) => this.keys.delete(e.code);
    this._blur = () => this.keys.clear();

    canvas.addEventListener('pointerdown', this._pointerDown);
    window.addEventListener('pointermove', this._pointerMove);
    window.addEventListener('pointerup', this._pointerUp);
    canvas.addEventListener('wheel', this._wheel, { passive: false });
    canvas.addEventListener('contextmenu', this._contextMenu);
    window.addEventListener('keydown', this._keyDown);
    window.addEventListener('keyup', this._keyUp);
    window.addEventListener('blur', this._blur);
  }

  updateHover() {
    this.updateCamera();
    this.raycaster.setFromCamera(this.ndc, this.camera);
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -(this.level * LEVEL + DECK));
    const p = new THREE.Vector3();
    if (this.raycaster.ray.intersectPlane(plane, p)) {
      this.hover = { x: Math.round(p.x / TILE), z: Math.round(p.z / TILE) };
    } else {
      this.hover = null;
    }
    if (this.eraser) this.hoverPiece = this.pickPiece(this.ndc);
    this.updatePreview();
  }

  updateCamera() {
    const cp = Math.cos(this.pitch);
    this.camera.position.set(
      this.target.x + Math.sin(this.yaw) * cp * this.distance,
      this.target.y + this.level * LEVEL + Math.sin(this.pitch) * this.distance,
      this.target.z + Math.cos(this.yaw) * cp * this.distance,
    );
    this.camera.lookAt(this.target.x, this.target.y + this.level * LEVEL, this.target.z);
  }

  frame(dt) {
    // Keyboard panning.
    const k = this.keys;
    let fx = 0, rx = 0;
    if (k.has('KeyW') || k.has('ArrowUp')) fx += 1;
    if (k.has('KeyS') || k.has('ArrowDown')) fx -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) rx += 1;
    if (k.has('KeyA') || k.has('ArrowLeft')) rx -= 1;
    if (fx || rx) {
      const speed = this.distance * 0.9 * dt;
      const f = [-Math.sin(this.yaw), -Math.cos(this.yaw)];
      const r = [Math.cos(this.yaw), -Math.sin(this.yaw)];
      this.target.x += (f[0] * fx + r[0] * rx) * speed;
      this.target.z += (f[1] * fx + r[1] * rx) * speed;
      this.updateHover();
    }
    this.updateCamera();
    this.env.update(this.target, dt);
    this.app.render(this.scene, this.camera, dt);
  }

  resize(aspect) {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  dispose() {
    const canvas = this.app.renderer.domElement;
    canvas.removeEventListener('pointerdown', this._pointerDown);
    window.removeEventListener('pointermove', this._pointerMove);
    window.removeEventListener('pointerup', this._pointerUp);
    canvas.removeEventListener('wheel', this._wheel);
    canvas.removeEventListener('contextmenu', this._contextMenu);
    window.removeEventListener('keydown', this._keyDown);
    window.removeEventListener('keyup', this._keyUp);
    window.removeEventListener('blur', this._blur);
    this.panel?.close();
    this.topEl?.remove();
    this.paletteEl?.remove();
    this.statusEl?.remove();
    this.hintEl?.remove();
    this.env.dispose();
  }
}
