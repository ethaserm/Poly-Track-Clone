import { BUILTIN_TRACKS } from '../core/tracks.js';
import { decodeTrack, encodeTrack } from '../core/share.js';
import { THEMES } from './environment.js';
import { MEDALS, formatTime, medalFor, medalIcon } from './hud.js';
import { RaceMode } from './raceMode.js';
import { deleteCustomTrack, loadCustomTracks, loadRecord } from './storage.js';
import { copyText, escapeHtml, h, openPanel, toast } from './ui.js';

const CAR_COLORS = ['#e8402f', '#ff8a1e', '#ffd23f', '#3ccf6e', '#1fb6d6', '#3a6df0', '#9a5cf0', '#f05ca8', '#f4f6fa', '#2a2d36'];
const ACCENT_COLORS = ['#1d1f27', '#f4f6fa', '#ffd23f', '#e8402f', '#3a6df0', '#3ccf6e'];

const ENV_GRADIENT = {
  summer: 'linear-gradient(135deg,#5fb85a,#3f8fd8)',
  winter: 'linear-gradient(135deg,#dfe9f4,#6d93c2)',
  desert: 'linear-gradient(135deg,#e7c48b,#d08e5a)',
};

/** Main menu with an autopilot demo lap running in the background. */
export class MenuMode {
  constructor(app, screen = 'main') {
    this.app = app;
    const demoTrack = BUILTIN_TRACKS[Math.floor(Math.random() * BUILTIN_TRACKS.length)];
    this.demo = new RaceMode(app, demoTrack, { demo: true });
    this.el = h('<div class="menu"></div>');
    app.uiRoot.appendChild(this.el);
    this.el.addEventListener('click', (e) => {
      const a = e.target.closest('[data-action]');
      if (a) this.action(a.dataset.action, a);
    });
    this._key = (e) => {
      if (e.code === 'Escape' && this.screen !== 'main' && !this.panel) this.show('main');
    };
    window.addEventListener('keydown', this._key);
    this.show(screen);
  }

  show(screen) {
    this.screen = screen;
    const render = {
      main: () => this.mainScreen(),
      play: () => this.playScreen(),
      custom: () => this.customScreen(),
      settings: () => this.settingsScreen(),
      controls: () => this.controlsScreen(),
    }[screen];
    this.el.innerHTML = render();
    this.el.className = `menu screen-${screen}`;
    if (screen === 'settings') this.bindSettings();
  }

  mainScreen() {
    const medalCount = BUILTIN_TRACKS.reduce((n, t) => {
      const r = loadRecord(t);
      return n + (r && medalFor(r.time, t.medals) ? 1 : 0);
    }, 0);
    return `
      <div class="menu-main">
        <div class="logo">
          <div class="logo-poly">POLY</div><div class="logo-track">TRACK</div>
          <div class="logo-tag">low-poly time trial</div>
        </div>
        <div class="btn-col main-buttons">
          <button class="btn big primary" data-action="play">Play</button>
          <button class="btn big" data-action="editor">Track Editor</button>
          <button class="btn big" data-action="custom">My Tracks</button>
          <button class="btn" data-action="settings">Settings</button>
          <button class="btn" data-action="controls">Controls</button>
        </div>
        <div class="menu-footer">${medalCount}/${BUILTIN_TRACKS.length} tracks medalled · Fan-made recreation inspired by PolyTrack by Kodub</div>
      </div>`;
  }

  playScreen() {
    const cards = BUILTIN_TRACKS.map((t, i) => {
      const r = loadRecord(t);
      const medal = r ? medalFor(r.time, t.medals) : null;
      const [title, sub] = t.name.split(' · ');
      return `
        <button class="track-card" data-action="playBuiltin" data-index="${i}">
          <div class="tc-art" style="background:${ENV_GRADIENT[t.env]}"><span>${escapeHtml(title)}</span></div>
          <div class="tc-body">
            <div class="tc-name">${escapeHtml(sub || title)}</div>
            <div class="tc-meta">${medalIcon(medal, 14)}<span>${r ? formatTime(r.time) : 'Not finished'}</span></div>
            <div class="tc-medals">${MEDALS.map((m) => `<span title="${m.label}">${medalIcon(m, 8)}${formatTime(t.medals[m.key])}</span>`).join('')}</div>
          </div>
        </button>`;
    }).join('');
    return `
      <div class="menu-page">
        <div class="page-head">
          <button class="btn icon" data-action="main" title="Back">←</button>
          <h1>Campaign</h1>
        </div>
        <div class="track-grid">${cards}</div>
      </div>`;
  }

  customScreen() {
    const list = loadCustomTracks();
    const rows = list.length
      ? list
          .map((t) => {
            const r = loadRecord(t);
            return `
          <div class="custom-row">
            <div class="cr-env" style="background:${ENV_GRADIENT[t.env] || ENV_GRADIENT.summer}"></div>
            <div class="cr-info">
              <div class="cr-name">${escapeHtml(t.name)}</div>
              <div class="cr-meta">${THEMES[t.env]?.label || ''} · ${t.pieces.length} pieces · PB ${r ? formatTime(r.time) : '—'}</div>
            </div>
            <div class="cr-actions">
              <button class="btn primary" data-action="playCustom" data-id="${t.id}">Play</button>
              <button class="btn" data-action="editCustom" data-id="${t.id}">Edit</button>
              <button class="btn" data-action="exportCustom" data-id="${t.id}">Share</button>
              <button class="btn danger" data-action="deleteCustom" data-id="${t.id}" title="Delete">✕</button>
            </div>
          </div>`;
          })
          .join('')
      : `<div class="empty">No saved tracks yet. Build one in the Track Editor, or import a code.</div>`;
    return `
      <div class="menu-page">
        <div class="page-head">
          <button class="btn icon" data-action="main" title="Back">←</button>
          <h1>My Tracks</h1>
          <div class="spacer"></div>
          <button class="btn" data-action="import">Import code</button>
          <button class="btn primary" data-action="editor">New track</button>
        </div>
        <div class="custom-list">${rows}</div>
      </div>`;
  }

  settingsScreen() {
    const s = this.app.settings;
    const swatches = (list, current, name) =>
      list
        .map(
          (c) =>
            `<button class="swatch ${c.toLowerCase() === current.toLowerCase() ? 'active' : ''}" data-${name}="${c}" style="background:${c}" aria-label="${c}"></button>`,
        )
        .join('');
    return `
      <div class="menu-page narrow">
        <div class="page-head">
          <button class="btn icon" data-action="main" title="Back">←</button>
          <h1>Settings</h1>
        </div>
        <div class="settings">
          <div class="set-row"><label>Car colour</label><div class="swatches" data-group="carColor">${swatches(CAR_COLORS, s.carColor, 'color')}</div></div>
          <div class="set-row"><label>Accent</label><div class="swatches" data-group="accentColor">${swatches(ACCENT_COLORS, s.accentColor, 'color')}</div></div>
          <div class="set-row"><label>Ghost of best run</label><button class="btn toggle ${s.ghost ? 'on' : ''}" data-toggle="ghost">${s.ghost ? 'On' : 'Off'}</button></div>
          <div class="set-row"><label>Sound</label><button class="btn toggle ${s.sound ? 'on' : ''}" data-toggle="sound">${s.sound ? 'On' : 'Off'}</button></div>
          <div class="set-row"><label>Volume</label><input type="range" min="0" max="1" step="0.05" value="${s.volume}" data-range="volume" /></div>
          <div class="set-row"><label>Shadows</label><button class="btn toggle ${s.shadows ? 'on' : ''}" data-toggle="shadows">${s.shadows ? 'On' : 'Off'}</button></div>
          <div class="set-row"><label>Camera</label>
            <div class="seg">${['Chase', 'Close', 'Hood'].map((n, i) => `<button class="btn ${s.camera === i ? 'on' : ''}" data-camera="${i}">${n}</button>`).join('')}</div>
          </div>
        </div>
      </div>`;
  }

  bindSettings() {
    const s = this.app.settings;
    this.el.querySelectorAll('.swatches').forEach((group) => {
      group.addEventListener('click', (e) => {
        const b = e.target.closest('.swatch');
        if (!b) return;
        s[group.dataset.group] = b.dataset.color;
        this.app.saveSettings();
        this.demo.carModel.setColors(s.carColor, s.accentColor);
        this.show('settings');
      });
    });
    this.el.querySelectorAll('[data-toggle]').forEach((b) =>
      b.addEventListener('click', () => {
        const k = b.dataset.toggle;
        if (k === 'sound') this.app.toggleSound();
        else {
          s[k] = !s[k];
          this.app.saveSettings();
        }
        if (k === 'shadows') this.app.renderer.shadowMap.enabled = s.shadows;
        this.show('settings');
      }),
    );
    this.el.querySelector('[data-range="volume"]').addEventListener('input', (e) => {
      s.volume = Number(e.target.value);
      this.app.audio.setVolume(s.volume);
      this.app.saveSettings();
    });
    this.el.querySelectorAll('[data-camera]').forEach((b) =>
      b.addEventListener('click', () => {
        s.camera = Number(b.dataset.camera);
        this.app.saveSettings();
        this.show('settings');
      }),
    );
  }

  controlsScreen() {
    return `
      <div class="menu-page narrow">
        <div class="page-head">
          <button class="btn icon" data-action="main" title="Back">←</button>
          <h1>Controls</h1>
        </div>
        <table class="keys">
          <tr><td><kbd>W</kbd> <kbd>↑</kbd></td><td>Accelerate</td></tr>
          <tr><td><kbd>S</kbd> <kbd>↓</kbd> <kbd>Space</kbd></td><td>Brake / reverse</td></tr>
          <tr><td><kbd>A</kbd> <kbd>D</kbd> <kbd>←</kbd> <kbd>→</kbd></td><td>Steer</td></tr>
          <tr><td><kbd>Enter</kbd> <kbd>R</kbd></td><td>Respawn at last checkpoint</td></tr>
          <tr><td><kbd>Backspace</kbd> <kbd>T</kbd></td><td>Restart track</td></tr>
          <tr><td><kbd>C</kbd></td><td>Change camera</td></tr>
          <tr><td><kbd>G</kbd></td><td>Toggle ghost</td></tr>
          <tr><td><kbd>M</kbd></td><td>Mute</td></tr>
          <tr><td><kbd>Esc</kbd> <kbd>P</kbd></td><td>Pause</td></tr>
          <tr><td>Gamepad</td><td>RT/LT drive · stick steers · A respawn · Y restart · X camera</td></tr>
        </table>
        <p class="panel-sub">The clock starts on your first input. Pass every checkpoint (any order) then cross the finish. Beat the author time for the green medal.</p>
      </div>`;
  }

  async action(a, el) {
    const app = this.app;
    app.audio.ensure();
    app.audio.click();
    switch (a) {
      case 'main':
      case 'play':
      case 'custom':
      case 'settings':
      case 'controls':
        this.show(a);
        break;
      case 'editor':
        app.openEditor(null);
        break;
      case 'playBuiltin':
        app.playTrack(BUILTIN_TRACKS[Number(el.dataset.index)]);
        break;
      case 'playCustom': {
        const t = loadCustomTracks().find((x) => x.id === el.dataset.id);
        if (!t) return;
        if (!t.pieces.some((p) => p.t === 'start')) {
          toast(app.uiRoot, 'This track has no Start piece — open it in the editor');
          return;
        }
        app.playTrack(t);
        break;
      }
      case 'editCustom': {
        const t = loadCustomTracks().find((x) => x.id === el.dataset.id);
        if (t) app.openEditor(t);
        break;
      }
      case 'exportCustom': {
        const t = loadCustomTracks().find((x) => x.id === el.dataset.id);
        if (!t) return;
        const code = await encodeTrack(t);
        const ok = await copyText(code);
        this.panel = openPanel(
          app.uiRoot,
          `<h2>Share “${escapeHtml(t.name)}”</h2>
           <textarea class="code" readonly rows="5">${code}</textarea>
           <div class="panel-sub">${ok ? 'Copied to clipboard.' : 'Select and copy the code above.'}</div>
           <div class="btn-row"><button class="btn primary" data-action="close">Done</button></div>`,
          { dismissible: true, onAction: () => this.panel.close(), onClose: () => (this.panel = null) },
        );
        break;
      }
      case 'deleteCustom': {
        const t = loadCustomTracks().find((x) => x.id === el.dataset.id);
        if (t && confirm(`Delete “${t.name}”? This cannot be undone.`)) {
          deleteCustomTrack(t.id);
          this.show('custom');
        }
        break;
      }
      case 'import':
        this.panel = openPanel(
          app.uiRoot,
          `<h2>Import track</h2>
           <div class="panel-sub">Paste a track code (starts with PT1).</div>
           <textarea class="code" rows="5" placeholder="PT1…" autofocus></textarea>
           <div class="panel-error"></div>
           <div class="btn-row">
             <button class="btn primary" data-action="play">Play</button>
             <button class="btn" data-action="save">Save to My Tracks</button>
             <button class="btn" data-action="close">Cancel</button>
           </div>`,
          {
            dismissible: true,
            onClose: () => (this.panel = null),
            onAction: async (act) => {
              if (act === 'close') return this.panel.close();
              try {
                const t = await decodeTrack(this.panel.el.querySelector('textarea').value);
                if (act === 'play') {
                  if (!t.pieces.some((p) => p.t === 'start')) throw new Error('track has no Start piece');
                  this.panel.close();
                  app.playTrack(t);
                } else {
                  app.saveCustom(t);
                  this.panel.close();
                  this.show('custom');
                  toast(app.uiRoot, `Saved “${t.name}”`);
                }
              } catch (err) {
                this.panel.el.querySelector('.panel-error').textContent = 'Could not read that code: ' + err.message;
              }
            },
          },
        );
        break;
    }
  }

  frame(dt) {
    this.demo.frame(dt);
  }

  resize(aspect) {
    this.demo.resize(aspect);
  }

  dispose() {
    window.removeEventListener('keydown', this._key);
    this.panel?.close();
    this.el.remove();
    this.demo.dispose();
  }
}
