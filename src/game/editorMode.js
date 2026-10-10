import * as THREE from 'three';
import { DECK, LEVEL, TILE, rotateXZ } from '../core/constants.js';
import { CATEGORIES, PIECES, PIECE_TYPES, buildPieceLocal } from '../core/pieces.js';
import { decodeTrack, encodeTrack } from '../core/share.js';
import { occupiedCells } from '../core/track.js';
import { buildEnvironment, THEMES } from './environment.js';
import { clearDraft, loadDraft, saveDraft } from './storage.js';
import { createPieceObject, placePieceObject } from './trackView.js';
import { copyText, escapeHtml, h, openPanel, toast } from './ui.js';

const MAX_LEVEL = 40;
const MAX_CELL = 80;
const TABS = [{ key: 'all', label: 'All' }, ...CATEGORIES];

let thumbCache = null;
/** Copied pieces survive between editor sessions. */
let clipboard = null;

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
    new THREE.MeshBasicMaterial({ color: 0x1d2330, alphaMap: tex, transparent: true, opacity: 0.55, depthWrite: false, fog: true }),
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
    const dist = (r / Math.sin(THREE.MathUtils.degToRad(cam.fov / 2))) * 0.95;
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

function centerlineLength(pc) {
  const pts = buildPieceLocal(pc.t, !!pc.m).centerline;
  let len = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1].p;
    const b = pts[i].p;
    const d = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    if (d < TILE) len += d;
  }
  return len;
}

export class EditorMode {
  constructor(app, track) {
    this.app = app;
    let restored = false;
    if (!track) {
      const draft = loadDraft();
      if (draft?.pieces?.length) {
        track = { ...draft, _dirty: true };
        restored = true;
      }
    }
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
    this.tab = 'all';
    this.tool = 'place'; // place | erase | select | paste
    this.rot = 0;
    this.mirror = 0;
    this.level = 0;
    this.hover = null;
    this.undoStack = [];
    this.redoStack = [];
    this.keys = new Set();
    this.selection = new Set();
    this.stampRot = 0;

    this.piecesGroup = new THREE.Group();
    this.scene.add(this.piecesGroup);
    this.objects = [];
    this.selBoxes = new THREE.Group();
    this.scene.add(this.selBoxes);

    this.grid = makeGridPlane(app.renderer.capabilities.getMaxAnisotropy());
    this.scene.add(this.grid);

    this.cursor = new THREE.Mesh(
      new THREE.BoxGeometry(TILE, 0.15, TILE),
      new THREE.MeshBasicMaterial({ color: 0x46c3ff, transparent: true, opacity: 0.25, depthWrite: false }),
    );
    this.scene.add(this.cursor);
    this.selRect = new THREE.Mesh(
      new THREE.BoxGeometry(1, 0.2, 1),
      new THREE.MeshBasicMaterial({ color: 0x35d6ff, transparent: true, opacity: 0.22, depthWrite: false }),
    );
    this.selRect.visible = false;
    this.scene.add(this.selRect);
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

    app.audio.playMusic('menu');
    this.buildEnv();
    this.rebuildAll();
    this.buildUI();
    this.setType(this.type);
    this.fitView();
    this.bindEvents();
    if (restored) toast(app.uiRoot, 'Restored your unsaved draft');
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
      quality: this.app.quality,
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
    // Drop selections that no longer exist (after undo/redo).
    this.selection = new Set([...this.selection].filter((pc) => this.track.pieces.includes(pc)));
    this.refreshSelection();
    this.updateStatus?.();
  }

  rebuildPreview() {
    if (this.preview) this.scene.remove(this.preview);
    this.preview = null;
    if (this.tool === 'place') {
      this.preview = createPieceObject(
        { t: this.type, x: 0, y: 0, z: 0, r: this.rot, m: this.mirror },
        { material: this.previewMat, withPillars: false, shadows: false },
      );
    } else if (this.tool === 'paste' && clipboard) {
      this.preview = new THREE.Group();
      for (const p of this.stampPieces(0, 0, 0)) {
        const o = createPieceObject(p, { material: this.previewMat, withPillars: false, shadows: false });
        this.preview.add(o);
      }
    }
    if (!this.preview) return;
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

  /** Clipboard pieces, rotated by the stamp rotation and moved to (x, y, z). */
  stampPieces(x, y, z) {
    return clipboard.pieces.map((p) => {
      const [dx, dz] = rotateXZ(p.dx, p.dz, this.stampRot);
      return { t: p.t, x: x + dx, y: y + p.dy, z: z + dz, r: (p.r + this.stampRot) % 4, m: p.m };
    });
  }

  conflicts(pc, ignore = null) {
    const mine = occupiedCells(pc);
    const hits = [];
    this.track.pieces.forEach((other, i) => {
      if (ignore && ignore.has(other)) return;
      for (const a of mine)
        for (const b of occupiedCells(other))
          if (a.x === b.x && a.z === b.z && a.y0 < b.y1 && b.y0 < a.y1) {
            if (!hits.includes(i)) hits.push(i);
          }
    });
    return hits;
  }

  updatePreview() {
    const y = this.level * LEVEL;
    this.grid.position.set(
      Math.round(this.target.x / TILE) * TILE + TILE / 2,
      y + DECK - 0.02,
      Math.round(this.target.z / TILE) * TILE + TILE / 2,
    );
    this.cursor.visible = !!this.hover && this.tool !== 'select';
    if (this.hover) this.cursor.position.set(this.hover.x * TILE, y + DECK, this.hover.z * TILE);
    if (this.tool === 'erase') {
      const idx = this.hoverPiece;
      this.eraseBox.visible = idx != null;
      if (idx != null) this.eraseBox.setFromObject(this.objects[idx]);
      this.cursor.material.color.set(0xff4d4d);
      return;
    }
    this.eraseBox.visible = false;
    this.cursor.material.color.set(this.tool === 'paste' ? 0xffd23f : 0x46c3ff);
    if (!this.preview) return;
    this.preview.visible = !!this.hover;
    if (!this.hover) return;
    let bad = false;
    if (this.tool === 'place') {
      const pc = this.candidate();
      placePieceObject(this.preview, pc);
      bad = this.conflicts(pc).length > 0 || !this.inBounds(pc);
    } else if (this.tool === 'paste') {
      const pieces = this.stampPieces(this.hover.x, this.level, this.hover.z);
      pieces.forEach((p, i) => placePieceObject(this.preview.children[i], p));
      bad = pieces.some((p) => this.conflicts(p).length > 0 || !this.inBounds(p));
    }
    this.previewValid = !bad;
    this.previewMat.emissive.set(bad ? 0xff2020 : this.tool === 'paste' ? 0xffc21a : 0x00ff66);
    this.previewMat.opacity = bad ? 0.45 : 0.65;
  }

  inBounds(pc) {
    return occupiedCells(pc).every((c) => Math.abs(c.x) <= MAX_CELL && Math.abs(c.z) <= MAX_CELL && c.y0 >= 0 && c.y1 <= MAX_LEVEL + 13);
  }

  // --- Editing ------------------------------------------------------------------

  snapshot() {
    this.undoStack.push(JSON.stringify(this.track.pieces));
    if (this.undoStack.length > 200) this.undoStack.shift();
    this.redoStack.length = 0;
    this.changed();
  }

  /** Mark dirty and autosave a draft shortly after. */
  changed() {
    this.dirty = true;
    clearTimeout(this._draftTimer);
    this._draftTimer = setTimeout(() => saveDraft(this.track), 400);
  }

  undo() {
    if (!this.undoStack.length) return;
    this.redoStack.push(JSON.stringify(this.track.pieces));
    this.track.pieces = JSON.parse(this.undoStack.pop());
    this.selection.clear();
    this.changed();
    this.rebuildAll();
    this.updatePreview();
  }

  redo() {
    if (!this.redoStack.length) return;
    this.undoStack.push(JSON.stringify(this.track.pieces));
    this.track.pieces = JSON.parse(this.redoStack.pop());
    this.selection.clear();
    this.changed();
    this.rebuildAll();
    this.updatePreview();
  }

  addPiece(pc) {
    this.track.pieces.push(pc);
    const o = createPieceObject(pc, { shadows: this.app.quality.shadows });
    this.piecesGroup.add(o);
    this.objects.push(o);
  }

  removePiece(pc) {
    const i = this.track.pieces.indexOf(pc);
    if (i < 0) return;
    this.track.pieces.splice(i, 1);
    this.piecesGroup.remove(this.objects[i]);
    this.objects.splice(i, 1);
    this.selection.delete(pc);
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
      const old = this.track.pieces.find((p) => p.t === 'start');
      if (old) {
        this.removePiece(old);
        toast(this.app.uiRoot, 'Start moved (a track has one start)');
      }
    }
    this.addPiece(pc);
    this.app.audio.click();
    this.updateStatus();
    this.updatePreview();
  }

  pasteStamp() {
    if (!clipboard || !this.hover) return;
    const pieces = this.stampPieces(this.hover.x, this.level, this.hover.z);
    if (pieces.some((p) => !this.inBounds(p) || this.conflicts(p).length)) {
      toast(this.app.uiRoot, "The pasted pieces don't fit there");
      return;
    }
    this.snapshot();
    const hasStart = pieces.some((p) => p.t === 'start');
    if (hasStart) {
      const old = this.track.pieces.find((p) => p.t === 'start');
      if (old) this.removePiece(old);
    }
    for (const p of pieces) this.addPiece(p);
    this.selection = new Set(pieces);
    this.refreshSelection();
    this.app.audio.click();
    this.updateStatus();
    this.updatePreview();
  }

  eraseAt(index) {
    if (index == null || index < 0) return;
    this.snapshot();
    this.removePiece(this.track.pieces[index]);
    this.hoverPiece = null;
    this.app.audio.click();
    this.refreshSelection();
    this.updateStatus();
    this.updatePreview();
  }

  // --- Selection & clipboard ------------------------------------------------------

  refreshSelection() {
    this.selBoxes.clear();
    for (const pc of this.selection) {
      const i = this.track.pieces.indexOf(pc);
      if (i < 0) continue;
      const helper = new THREE.BoxHelper(this.objects[i], 0x35d6ff);
      this.selBoxes.add(helper);
    }
    this.updateStatus?.();
  }

  selectRect(a, b, add = false) {
    const x0 = Math.min(a.x, b.x);
    const x1 = Math.max(a.x, b.x);
    const z0 = Math.min(a.z, b.z);
    const z1 = Math.max(a.z, b.z);
    if (!add) this.selection.clear();
    for (const pc of this.track.pieces) {
      if (occupiedCells(pc).some((c) => c.x >= x0 && c.x <= x1 && c.z >= z0 && c.z <= z1)) this.selection.add(pc);
    }
    this.refreshSelection();
  }

  copySelection(cut = false) {
    if (!this.selection.size) {
      toast(this.app.uiRoot, 'Select pieces first (B, then drag)');
      return;
    }
    const sel = [...this.selection];
    const minX = Math.min(...sel.map((p) => p.x));
    const minZ = Math.min(...sel.map((p) => p.z));
    const minY = Math.min(...sel.map((p) => p.y));
    clipboard = { pieces: sel.map((p) => ({ t: p.t, dx: p.x - minX, dy: p.y - minY, dz: p.z - minZ, r: p.r, m: p.m ? 1 : 0 })) };
    if (cut) this.deleteSelection();
    toast(this.app.uiRoot, `${cut ? 'Cut' : 'Copied'} ${sel.length} piece${sel.length > 1 ? 's' : ''} — Ctrl+V to paste`);
  }

  deleteSelection() {
    if (!this.selection.size) return;
    this.snapshot();
    for (const pc of [...this.selection]) this.removePiece(pc);
    this.selection.clear();
    this.refreshSelection();
    this.updateStatus();
  }

  startPaste() {
    if (!clipboard) {
      toast(this.app.uiRoot, 'Nothing copied yet');
      return;
    }
    this.stampRot = 0;
    this.setTool('paste');
  }

  // --- Tools ------------------------------------------------------------------------

  setTool(tool) {
    this.tool = tool;
    this.selRect.visible = false;
    this.paletteEl?.querySelectorAll('.pal-item').forEach((b) => {
      const isTool = b.dataset.tool;
      b.classList.toggle('active', isTool ? b.dataset.tool === tool : tool === 'place' && b.dataset.type === this.type);
    });
    this.rebuildPreview();
    this.updateStatus?.();
  }

  setType(type) {
    this.type = type;
    this.mirror = 0;
    this.setTool('place');
  }

  setTab(tab) {
    this.tab = tab;
    this.renderPalette();
  }

  rotate(dir = 1) {
    if (this.tool === 'paste') {
      this.stampRot = (this.stampRot + dir + 4) % 4;
      this.rebuildPreview();
      return;
    }
    this.rot = (this.rot + dir + 4) % 4;
    this.rebuildPreview();
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

  toggleTopView() {
    if (this.savedPitch != null) {
      this.pitch = this.savedPitch;
      this.savedPitch = null;
    } else {
      this.savedPitch = this.pitch;
      this.pitch = 1.52;
      this.yaw = Math.round(this.yaw / (Math.PI / 2)) * (Math.PI / 2);
    }
    this.updateHover();
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
    this.thumbs = makeThumbnails(this.app.renderer);
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
        <button class="btn" data-action="top" title="Top view (V)">Top view</button>
        <button class="btn" data-action="info" title="Track info (I)">Info</button>
        <button class="btn" data-action="new" title="New track">New</button>
        <button class="btn" data-action="import" title="Import a track code">Import</button>
        <button class="btn" data-action="export" title="Export a track code">Export</button>
        <button class="btn" data-action="save" title="Save (Ctrl+S)">Save</button>
        <button class="btn primary" data-action="test" title="Test drive (Enter)">▶ Test</button>
        <button class="btn icon" data-action="help" title="Controls">?</button>
      </div>`);
    this.paletteWrap = h(`<div class="editor-palette-wrap"><div class="editor-tabs"></div><div class="editor-palette"></div></div>`);
    this.tabsEl = this.paletteWrap.querySelector('.editor-tabs');
    this.paletteEl = this.paletteWrap.querySelector('.editor-palette');
    this.statusEl = h(`<div class="editor-status"></div>`);
    this.hintEl = h(`
      <div class="editor-hint">
        <b>Left-click</b> place · <b>Right-click</b> erase · <b>Right-drag</b> orbit · <b>Middle-drag / WASD</b> pan ·
        <b>Wheel</b> zoom · <b>R</b> rotate · <b>F</b> flip · <b>Q/E</b> height · <b>B</b> select · <b>Ctrl+C/V</b> copy/paste
      </div>`);
    root.append(this.topEl, this.paletteWrap, this.statusEl, this.hintEl);
    this.renderPalette();

    this.topEl.addEventListener('click', (e) => {
      const a = e.target.closest('[data-action]');
      if (a) this.action(a.dataset.action);
    });
    this.topEl.querySelector('.ed-name').addEventListener('input', (e) => {
      this.track.name = e.target.value || 'Untitled';
      this.changed();
    });
    this.topEl.querySelector('.ed-env').addEventListener('change', (e) => {
      this.track.env = e.target.value;
      this.changed();
      this.buildEnv();
      e.target.blur();
    });
    this.tabsEl.addEventListener('click', (e) => {
      const b = e.target.closest('[data-tab]');
      if (b) this.setTab(b.dataset.tab);
    });
    this.paletteEl.addEventListener('click', (e) => {
      const b = e.target.closest('.pal-item');
      if (!b) return;
      if (b.dataset.tool) this.setTool(this.tool === b.dataset.tool ? 'place' : b.dataset.tool);
      else this.setType(b.dataset.type);
    });
  }

  paletteTypes() {
    return PIECE_TYPES.filter((t) => this.tab === 'all' || PIECES[t].category === this.tab);
  }

  renderPalette() {
    this.tabsEl.innerHTML = TABS.map((t) => `<button class="tab ${t.key === this.tab ? 'on' : ''}" data-tab="${t.key}">${t.label}</button>`).join('');
    const types = this.paletteTypes();
    this.paletteEl.innerHTML =
      types
        .map(
          (t, i) => `
        <button class="pal-item ${this.tool === 'place' && t === this.type ? 'active' : ''}" data-type="${t}" title="${PIECES[t].name} — ${escapeHtml(PIECES[t].description || '')}">
          <img src="${this.thumbs[t]}" alt="" draggable="false" />
          <span>${PIECES[t].name}</span>
          ${i < 10 ? `<kbd>${(i + 1) % 10}</kbd>` : ''}
        </button>`,
        )
        .join('') +
      `<button class="pal-item tool ${this.tool === 'select' ? 'active' : ''}" data-tool="select" title="Box select (B): drag to select, then Ctrl+C / Ctrl+X / Delete">
         <div class="tool-icon">⬚</div><span>Select</span><kbd>B</kbd>
       </button>
       <button class="pal-item tool pal-erase ${this.tool === 'erase' ? 'active' : ''}" data-tool="erase" title="Eraser (X)">
         <div class="tool-icon erase">✕</div><span>Eraser</span><kbd>X</kbd>
       </button>`;
  }

  updateStatus() {
    if (!this.statusEl) return;
    const p = this.track.pieces;
    const starts = p.filter((x) => x.t === 'start').length;
    const finishes = p.filter((x) => x.t === 'finish').length;
    const cps = p.filter((x) => x.t === 'checkpoint').length;
    const tool =
      this.tool === 'erase'
        ? 'Eraser'
        : this.tool === 'select'
          ? `Select (${this.selection.size})`
          : this.tool === 'paste'
            ? `Paste ${clipboard?.pieces.length || 0}`
            : `${PIECES[this.type].name}${this.mirror ? ' (flipped)' : ''}`;
    this.statusEl.innerHTML = `
      <div><span class="label">Tool</span> ${tool}</div>
      <div><span class="label">Height</span> ${this.level}</div>
      <div><span class="label">Rotation</span> ${(this.tool === 'paste' ? this.stampRot : this.rot) * 90}°</div>
      <div><span class="label">Pieces</span> ${p.length}</div>
      <div class="${starts ? 'ok' : 'bad'}">${starts ? '✓' : '✗'} Start</div>
      <div class="${finishes ? 'ok' : 'bad'}">${finishes ? '✓' : '✗'} Finish</div>
      <div><span class="label">CPs</span> ${cps}</div>
      ${this.dirty ? '<div class="muted">● unsaved</div>' : ''}`;
  }

  async action(a) {
    const app = this.app;
    app.audio.click();
    switch (a) {
      case 'back':
        if (this.dirty && this.track.pieces.length && !confirm('Leave the editor? Your work stays as an autosaved draft until you save or start a new track.')) return;
        app.showMenu();
        break;
      case 'undo':
        this.undo();
        break;
      case 'redo':
        this.redo();
        break;
      case 'top':
        this.toggleTopView();
        break;
      case 'info':
        this.infoPanel();
        break;
      case 'new':
        if (this.track.pieces.length && !confirm('Start a new empty track? Unsaved changes will be lost.')) return;
        this.snapshot();
        this.track = { name: 'My Track', env: this.track.env, pieces: [] };
        this.topEl.querySelector('.ed-name').value = this.track.name;
        this.dirty = false;
        clearDraft();
        this.selection.clear();
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
    clearDraft();
    this.updateStatus();
    toast(this.app.uiRoot, `Saved “${saved.name}”`);
  }

  test() {
    if (!this.track.pieces.some((p) => p.t === 'start')) {
      toast(this.app.uiRoot, 'Place a Start piece first');
      return;
    }
    saveDraft(this.track);
    this.app.playTrack(
      { ...this.track, pieces: this.track.pieces.map((p) => ({ ...p })) },
      { fromEditor: { ...this.track, _dirty: this.dirty } },
    );
  }

  infoPanel() {
    const p = this.track.pieces;
    const byCat = {};
    for (const pc of p) {
      const c = PIECES[pc.t].category;
      byCat[c] = (byCat[c] || 0) + 1;
    }
    const length = p.reduce((s, pc) => s + centerlineLength(pc), 0);
    const maxLevel = p.reduce((m, pc) => Math.max(m, pc.y), 0);
    const issues = [];
    if (!p.some((x) => x.t === 'start')) issues.push('No Start piece — the track cannot be driven.');
    if (!p.some((x) => x.t === 'finish')) issues.push('No Finish piece — runs can never end.');
    if (!p.some((x) => x.t === 'checkpoint')) issues.push('No checkpoints — respawning sends you back to the start.');
    if (p.some((x) => x.t === 'ramp') && !p.some((x) => x.t === 'platform' || x.t === 'block')) issues.push('Ramps but no Platform/Block landing pads.');
    const cats = CATEGORIES.map((c) => `<div><span>${c.label}</span><b>${byCat[c.key] || 0}</b></div>`).join('');
    this.panel = openPanel(
      this.app.uiRoot,
      `<h2>Track info</h2>
       <div class="panel-sub">${escapeHtml(this.track.name)} · ${THEMES[this.track.env]?.label}</div>
       <div class="info-grid">
         <div><span>Pieces</span><b>${p.length}</b></div>
         <div><span>Road length</span><b>${(length / 1000).toFixed(2)} km</b></div>
         <div><span>Highest point</span><b>${(maxLevel * LEVEL).toFixed(1)} m</b></div>
         <div><span>Checkpoints</span><b>${p.filter((x) => x.t === 'checkpoint').length}</b></div>
         ${cats}
       </div>
       ${issues.length ? `<ul class="issues">${issues.map((i) => `<li>${i}</li>`).join('')}</ul>` : '<p class="ok-msg">✓ Ready to race</p>'}
       <div class="btn-row"><button class="btn primary" data-action="close">Close</button></div>`,
      { dismissible: true, onAction: () => this.panel.close() },
    );
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
       <div class="panel-sub">Share this code — anyone can import it from the editor or My Tracks.</div>
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
            this.selection.clear();
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
         <tr><td>Right click · X (eraser)</td><td>Erase piece</td></tr>
         <tr><td>Right drag</td><td>Orbit camera</td></tr>
         <tr><td>Middle drag · WASD / arrows</td><td>Pan camera</td></tr>
         <tr><td>Mouse wheel</td><td>Zoom</td></tr>
         <tr><td>Q / E · Shift + wheel</td><td>Build height down / up</td></tr>
         <tr><td>R / Shift+R</td><td>Rotate piece (or paste stamp)</td></tr>
         <tr><td>F</td><td>Flip (mirror) piece</td></tr>
         <tr><td>1 – 0 · Tab</td><td>Pick piece · next category</td></tr>
         <tr><td>B</td><td>Box select (drag; Shift adds)</td></tr>
         <tr><td>Ctrl+A · Ctrl+C · Ctrl+X · Ctrl+V</td><td>Select all · copy · cut · paste</td></tr>
         <tr><td>Delete</td><td>Delete selection / piece under cursor</td></tr>
         <tr><td>Alt + click</td><td>Pick piece from track</td></tr>
         <tr><td>V · I</td><td>Top view · track info</td></tr>
         <tr><td>Ctrl+Z / Ctrl+Y · Ctrl+S</td><td>Undo / redo · save</td></tr>
         <tr><td>Enter</td><td>Test drive</td></tr>
       </table>
       <p class="panel-sub">A track needs a <b>Start</b> and a <b>Finish</b>. Every <b>Checkpoint</b> must be passed (in any order) before the finish counts. Elevated pieces get support pillars automatically. Your work is autosaved as a draft.</p>
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
      drag = { button: e.button, x: e.clientX, y: e.clientY, moved: false, shift: e.shiftKey, alt: e.altKey, cell: this.hover ? { ...this.hover } : null };
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
            this.pitch = Math.max(0.12, Math.min(1.52, this.pitch + (e.movementY || 0) * 0.005));
            this.savedPitch = null;
          } else if (drag.button === 1 || (drag.button === 0 && drag.shift && this.tool !== 'select')) {
            const k = this.distance * 0.0016;
            const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
            const rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);
            this.target.x += (-(e.movementX || 0) * rx + (e.movementY || 0) * fx) * k;
            this.target.z += (-(e.movementX || 0) * rz + (e.movementY || 0) * fz) * k;
          }
        }
      }
      this.updateHover();
      // Selection rectangle while dragging with the select tool.
      if (drag && drag.button === 0 && this.tool === 'select' && drag.cell && this.hover) {
        const a = drag.cell;
        const b = this.hover;
        const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x);
        const z0 = Math.min(a.z, b.z), z1 = Math.max(a.z, b.z);
        this.selRect.visible = true;
        this.selRect.scale.set((x1 - x0 + 1) * TILE, 1, (z1 - z0 + 1) * TILE);
        this.selRect.position.set(((x0 + x1) / 2) * TILE, this.level * LEVEL + DECK, ((z0 + z1) / 2) * TILE);
      }
    };
    this._pointerUp = (e) => {
      if (!drag) return;
      const d = drag;
      drag = null;
      if (this.tool === 'select' && d.button === 0) {
        this.selRect.visible = false;
        if (d.moved && d.cell && this.hover) this.selectRect(d.cell, this.hover, d.shift);
        else if (!d.moved) {
          const idx = this.pickPiece(this.ndc);
          if (!d.shift) this.selection.clear();
          if (idx != null) {
            const pc = this.track.pieces[idx];
            if (this.selection.has(pc)) this.selection.delete(pc);
            else this.selection.add(pc);
          }
          this.refreshSelection();
        }
        return;
      }
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
        if (this.tool === 'erase') this.eraseAt(this.pickPiece(this.ndc));
        else if (this.tool === 'paste') this.pasteStamp();
        else this.place();
      } else if (d.button === 2) {
        if (this.tool === 'paste') this.setTool('place');
        else this.eraseAt(this.pickPiece(this.ndc));
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
      if (ctrl) {
        const k = e.code;
        if (k === 'KeyZ') e.shiftKey ? this.redo() : this.undo();
        else if (k === 'KeyY') this.redo();
        else if (k === 'KeyS') this.save();
        else if (k === 'KeyC') this.copySelection(false);
        else if (k === 'KeyX') this.copySelection(true);
        else if (k === 'KeyV') this.startPaste();
        else if (k === 'KeyA') {
          this.selection = new Set(this.track.pieces);
          this.setTool('select');
          this.refreshSelection();
        } else return;
        e.preventDefault();
        return;
      }
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
          this.setTool(this.tool === 'erase' ? 'place' : 'erase');
          break;
        case 'KeyB':
          this.setTool(this.tool === 'select' ? 'place' : 'select');
          break;
        case 'KeyV':
          this.toggleTopView();
          break;
        case 'KeyI':
          this.infoPanel();
          break;
        case 'Tab': {
          e.preventDefault();
          const i = TABS.findIndex((t) => t.key === this.tab);
          this.setTab(TABS[(i + (e.shiftKey ? TABS.length - 1 : 1)) % TABS.length].key);
          break;
        }
        case 'Delete':
        case 'Backspace':
          if (this.selection.size) this.deleteSelection();
          else this.eraseAt(this.pickPiece(this.ndc));
          break;
        case 'Enter':
          e.preventDefault();
          this.test();
          break;
        case 'Escape':
          if (this.tool !== 'place') this.setTool('place');
          else if (this.selection.size) {
            this.selection.clear();
            this.refreshSelection();
          }
          break;
        default: {
          const m = /^Digit(\d)$/.exec(e.code);
          if (m) {
            const i = (Number(m[1]) + 9) % 10;
            const types = this.paletteTypes();
            if (types[i]) {
              this.setType(types[i]);
              this.renderPalette();
            }
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
    if (this.tool === 'erase') this.hoverPiece = this.pickPiece(this.ndc);
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
    clearTimeout(this._draftTimer);
    if (this.dirty && this.track.pieces.length) saveDraft(this.track);
    this.panel?.close();
    this.topEl?.remove();
    this.paletteWrap?.remove();
    this.statusEl?.remove();
    this.hintEl?.remove();
    this.env.dispose();
  }
}
