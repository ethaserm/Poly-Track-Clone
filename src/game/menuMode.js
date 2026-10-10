import { BUILTIN_TRACKS } from '../core/tracks.js';
import { decodeTrack, encodeTrack } from '../core/share.js';
import { THEMES } from './environment.js';
import { decodeGhost } from './ghost.js';
import { MEDALS, UNITS, formatTime, medalFor, medalIcon } from './hud.js';
import { RaceMode } from './raceMode.js';
import { trackPreview } from './trackScene.js';
import { QUALITY_PRESETS } from './renderer.js';
import { deleteCustomTrack, loadCustomTracks, loadRecord, loadRuns, loadStats, resetProgress } from './storage.js';
import { confirmPanel, copyText, escapeHtml, h, openPanel, toast } from './ui.js';

const ENV_GRADIENT = {
  summer: 'linear-gradient(135deg,#5fb85a,#3f8fd8)',
  winter: 'linear-gradient(135deg,#dfe9f4,#6d93c2)',
  desert: 'linear-gradient(135deg,#e7c48b,#d08e5a)',
};

const GROUPS = [
  { key: 'summer', label: 'Summer', match: (t) => t.id.startsWith('summer') },
  { key: 'winter', label: 'Winter', match: (t) => t.id.startsWith('winter') },
  { key: 'desert', label: 'Desert', match: (t) => t.id.startsWith('desert') },
  { key: 'finale', label: 'Finale', match: (t) => !/^(summer|winter|desert)/.test(t.id) },
];

function medalCounts() {
  const counts = { author: 0, gold: 0, silver: 0, bronze: 0 };
  for (const t of BUILTIN_TRACKS) {
    const r = loadRecord(t);
    const m = r ? medalFor(r.time, t.medals) : null;
    if (!m) continue;
    // Earning author also counts as gold, silver and bronze.
    for (const k of MEDALS.slice(MEDALS.indexOf(m)).map((x) => x.key)) counts[k]++;
  }
  return counts;
}

/** Main menu with an autopilot demo lap running in the background. */
export class MenuMode {
  constructor(app, screen = 'main') {
    this.app = app;
    const demoTrack = BUILTIN_TRACKS[Math.floor(Math.random() * BUILTIN_TRACKS.length)];
    this.demo = new RaceMode(app, demoTrack, { demo: true });
    app.audio.playMusic('menu');
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
      stats: () => this.statsScreen(),
      settings: () => this.settingsScreen(),
      controls: () => this.controlsScreen(),
    }[screen] || (() => this.mainScreen());
    this.el.innerHTML = render();
    this.el.className = `menu screen-${screen}`;
    if (screen === 'settings') this.bindSettings();
  }

  mainScreen() {
    const c = medalCounts();
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
          <div class="btn-grid">
            <button class="btn" data-action="garage">Garage</button>
            <button class="btn" data-action="stats">Stats</button>
            <button class="btn" data-action="settings">Settings</button>
            <button class="btn" data-action="controls">Controls</button>
          </div>
        </div>
        <div class="menu-footer">
          <span class="medal-tally">${MEDALS.map((m) => `${medalIcon(m, 12)} ${c[m.key]}`).join(' &nbsp; ')}</span>
          <span>${BUILTIN_TRACKS.length} campaign tracks · Fan-made recreation inspired by PolyTrack by Kodub</span>
        </div>
      </div>`;
  }

  trackCard(t, i) {
    const r = loadRecord(t);
    const medal = r ? medalFor(r.time, t.medals) : null;
    const [title, sub] = t.name.split(' · ');
    const hasGhost = !!r?.ghost;
    return `
      <div class="track-card">
        <button class="tc-play" data-action="playBuiltin" data-index="${i}" aria-label="Play ${escapeHtml(t.name)}">
          <div class="tc-art" style="background:${ENV_GRADIENT[t.env]}"><img class="tc-map" src="${trackPreview(t)}" alt="" /><span>${escapeHtml(title)}</span>${medal ? `<span class="tc-medal">${medalIcon(medal, 22)}</span>` : ''}</div>
          <div class="tc-body">
            <div class="tc-name">${escapeHtml(sub || title)}</div>
            <div class="tc-meta">${medalIcon(medal, 14)}<span>${r ? formatTime(r.time) : 'Not finished'}</span></div>
            <div class="tc-medals">${MEDALS.map((m) => `<span title="${m.label}">${medalIcon(m, 8)}${formatTime(t.medals[m.key])}</span>`).join('')}</div>
          </div>
        </button>
        <div class="tc-actions">
          <button class="btn mini" data-action="board" data-index="${i}">Leaderboard</button>
          <button class="btn mini" data-action="replayPB" data-index="${i}" ${hasGhost ? '' : 'disabled'}>Replay PB</button>
        </div>
      </div>`;
  }

  playScreen() {
    const sections = GROUPS.map((g) => {
      const tracks = BUILTIN_TRACKS.map((t, i) => ({ t, i })).filter(({ t }) => g.match(t));
      const done = tracks.filter(({ t }) => {
        const r = loadRecord(t);
        return r && medalFor(r.time, t.medals);
      }).length;
      return `
        <section class="track-group">
          <div class="group-head"><h2>${g.label}</h2><span>${done}/${tracks.length} medalled</span></div>
          <div class="track-grid">${tracks.map(({ t, i }) => this.trackCard(t, i)).join('')}</div>
        </section>`;
    }).join('');
    return `
      <div class="menu-page">
        <div class="page-head">
          <button class="btn icon" data-action="main" title="Back">←</button>
          <h1>Campaign</h1>
        </div>
        ${sections}
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
              <div class="cr-meta">${THEMES[t.env]?.label || ''} · ${t.pieces.length} pieces · PB ${r ? formatTime(r.time) : '—'} · edited ${new Date(t.updated || Date.now()).toLocaleDateString()}</div>
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

  statsScreen() {
    const s = loadStats();
    const u = UNITS[this.app.settings.units] || UNITS.kmh;
    const c = medalCounts();
    const dist = this.app.settings.units === 'mph' ? `${(s.distance / 1609.34).toFixed(1)} mi` : `${(s.distance / 1000).toFixed(1)} km`;
    const hours = Math.floor(s.driveTime / 3600);
    const mins = Math.floor((s.driveTime % 3600) / 60);
    const fav = Object.entries(s.trackPlays || {}).sort((a, b) => b[1] - a[1])[0];
    const favName = fav ? BUILTIN_TRACKS.find((t) => t.id === fav[0])?.name || 'A custom track' : '—';
    const tile = (label, value, sub = '') => `<div class="stat-tile"><span>${label}</span><b>${value}</b>${sub ? `<em>${sub}</em>` : ''}</div>`;
    const finishRate = s.racesStarted ? Math.round((s.racesFinished / s.racesStarted) * 100) : 0;
    return `
      <div class="menu-page">
        <div class="page-head">
          <button class="btn icon" data-action="main" title="Back">←</button>
          <h1>Stats</h1>
          <div class="spacer"></div>
          <button class="btn danger" data-action="resetProgress">Reset progress</button>
        </div>
        <div class="stat-grid">
          ${tile('Distance driven', dist)}
          ${tile('Time behind the wheel', `${hours}h ${mins}m`)}
          ${tile('Races started', s.racesStarted)}
          ${tile('Races finished', s.racesFinished, `${finishRate}% finish rate`)}
          ${tile('Personal bests set', s.personalBests)}
          ${tile('Top speed', `${Math.round(s.topSpeed * u.factor)} ${u.label}`)}
          ${tile('Air time', `${s.airTime.toFixed(1)} s`, `longest jump ${s.longestJump.toFixed(2)} s`)}
          ${tile('Checkpoints', s.checkpoints)}
          ${tile('Respawns', s.respawns)}
          ${tile('Restarts', s.restarts)}
          ${tile('Most played', escapeHtml(favName), fav ? `${fav[1]} runs` : '')}
          ${tile('Medals', MEDALS.map((m) => `${medalIcon(m, 12)}${c[m.key]}`).join(' '), `of ${BUILTIN_TRACKS.length} tracks each`)}
        </div>
      </div>`;
  }

  settingsScreen() {
    const s = this.app.settings;
    const toggle = (key, label) =>
      `<div class="set-row"><label>${label}</label><button class="btn toggle ${s[key] ? 'on' : ''}" data-toggle="${key}">${s[key] ? 'On' : 'Off'}</button></div>`;
    const range = (key, label, min, max, step, fmt = (v) => v) =>
      `<div class="set-row"><label>${label}</label><div class="range-wrap"><input type="range" min="${min}" max="${max}" step="${step}" value="${s[key]}" data-range="${key}" /><output>${fmt(s[key])}</output></div></div>`;
    const seg = (key, label, options) =>
      `<div class="set-row"><label>${label}</label><div class="seg">${options
        .map(([v, l]) => `<button class="btn ${String(s[key]) === String(v) ? 'on' : ''}" data-seg="${key}" data-value="${v}">${l}</button>`)
        .join('')}</div></div>`;
    return `
      <div class="menu-page narrow">
        <div class="page-head">
          <button class="btn icon" data-action="main" title="Back">←</button>
          <h1>Settings</h1>
        </div>
        <div class="settings">
          <h3>Graphics</h3>
          ${seg('quality', 'Quality', Object.entries(QUALITY_PRESETS).map(([k, p]) => [k, p.label]))}
          <p class="set-help">Low: no shadows or post-processing · Medium: shadows · High: bloom & full scenery · Ultra: denser scenery, sharper shadows. Takes effect on the next track.</p>
          ${toggle('showFps', 'Show FPS')}
          ${toggle('speedEffects', 'Speed effects (blur, streaks)')}
          ${toggle('cameraShake', 'Camera shake')}
          ${toggle('skidmarks', 'Skid marks')}
          <h3>Gameplay</h3>
          ${seg('camera', 'Default camera', [[0, 'Chase'], [1, 'Close'], [2, 'Hood']])}
          ${range('fovOffset', 'Field of view', -10, 20, 1, (v) => `${v > 0 ? '+' : ''}${v}°`)}
          ${seg('units', 'Speed units', [['kmh', 'km/h'], ['mph', 'mph']])}
          ${toggle('ghost', 'Ghost of best run')}
          ${toggle('minimap', 'Minimap')}
          <h3>Audio</h3>
          ${toggle('sound', 'Sound')}
          ${range('volume', 'Effects volume', 0, 1, 0.05, (v) => `${Math.round(v * 100)}%`)}
          ${range('musicVolume', 'Music volume', 0, 1, 0.05, (v) => `${Math.round(v * 100)}%`)}
        </div>
      </div>`;
  }

  bindSettings() {
    const s = this.app.settings;
    const app = this.app;
    this.el.querySelectorAll('[data-toggle]').forEach((b) =>
      b.addEventListener('click', () => {
        const k = b.dataset.toggle;
        if (k === 'sound') app.toggleSound();
        else {
          s[k] = !s[k];
          app.saveSettings();
        }
        if (k === 'showFps') app.applyFpsVisibility();
        this.show('settings');
      }),
    );
    this.el.querySelectorAll('[data-range]').forEach((input) =>
      input.addEventListener('input', () => {
        const k = input.dataset.range;
        s[k] = Number(input.value);
        input.nextElementSibling.textContent =
          k === 'fovOffset' ? `${s[k] > 0 ? '+' : ''}${s[k]}°` : `${Math.round(s[k] * 100)}%`;
        if (k === 'volume') app.audio.setVolume(s.volume);
        if (k === 'musicVolume') app.audio.setMusicVolume(s.musicVolume);
        app.saveSettings();
      }),
    );
    this.el.querySelectorAll('[data-seg]').forEach((b) =>
      b.addEventListener('click', () => {
        const k = b.dataset.seg;
        const v = b.dataset.value;
        if (k === 'quality') {
          app.setQuality(v);
          toast(app.uiRoot, `Graphics: ${QUALITY_PRESETS[v].label}`);
        } else {
          s[k] = k === 'camera' ? Number(v) : v;
          app.saveSettings();
        }
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
          <tr><td>Replays</td><td><kbd>Space</kbd> play/pause · <kbd>←</kbd><kbd>→</kbd> seek · <kbd>[</kbd><kbd>]</kbd> speed · <kbd>C</kbd> camera</td></tr>
        </table>
        <p class="panel-sub">The clock starts on your first input. Pass every checkpoint (any order) then cross the finish. Boost pads push you forward, ice has almost no grip, dirt is loose, and wall rides need speed. Beat the author time for the green medal.</p>
      </div>`;
  }

  leaderboard(track) {
    const runs = loadRuns(track);
    const u = UNITS[this.app.settings.units] || UNITS.kmh;
    const rows = runs.length
      ? runs
          .map(
            (r, i) =>
              `<tr><td>${i + 1}</td><td><b>${formatTime(r.time)}</b></td><td>${medalIcon(medalFor(r.time, track.medals), 12)}</td><td>${r.respawns ?? 0}</td><td>${Math.round((r.topSpeed || 0) * u.factor)}</td><td>${new Date(r.date).toLocaleString()}</td></tr>`,
          )
          .join('')
      : '<tr><td colspan="6" class="empty-cell">No finished runs yet.</td></tr>';
    this.panel = openPanel(
      this.app.uiRoot,
      `<h2>Leaderboard</h2>
       <div class="panel-sub">${escapeHtml(track.name)} · your ten fastest runs on this device</div>
       <table class="board-table"><thead><tr><th>#</th><th>Time</th><th></th><th>Respawns</th><th>Top ${u.label}</th><th>Date</th></tr></thead><tbody>${rows}</tbody></table>
       <div class="btn-row"><button class="btn primary" data-action="close">Close</button></div>`,
      { className: 'wide', dismissible: true, onAction: () => this.panel.close(), onClose: () => (this.panel = null) },
    );
  }

  async action(a, el) {
    const app = this.app;
    app.audio.ensure();
    app.audio.click();
    switch (a) {
      case 'main':
      case 'play':
      case 'custom':
      case 'stats':
      case 'settings':
      case 'controls':
        this.show(a);
        break;
      case 'garage':
        app.openGarage();
        break;
      case 'editor':
        app.openEditor(null);
        break;
      case 'playBuiltin':
        app.playTrack(BUILTIN_TRACKS[Number(el.dataset.index)]);
        break;
      case 'board':
        this.leaderboard(BUILTIN_TRACKS[Number(el.dataset.index)]);
        break;
      case 'replayPB': {
        const t = BUILTIN_TRACKS[Number(el.dataset.index)];
        const rec = loadRecord(t);
        const g = decodeGhost(rec);
        if (g) app.watchReplay(t, { ...g, time: rec.time, label: 'Personal best' }, () => app.showMenu('play'));
        break;
      }
      case 'resetProgress':
        this.panel = confirmPanel(app.uiRoot, {
          title: 'Reset progress?',
          message: 'Erase all best times, ghosts, leaderboards and stats? Saved tracks and settings are kept.',
          ok: 'Erase',
          danger: true,
          onClose: () => (this.panel = null),
          onConfirm: () => {
            resetProgress();
            this.show('stats');
            toast(app.uiRoot, 'Progress reset');
          },
        });
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
        if (!t) return;
        this.panel = confirmPanel(app.uiRoot, {
          title: 'Delete track?',
          message: `Delete “${t.name}”? This cannot be undone.`,
          ok: 'Delete',
          danger: true,
          onClose: () => (this.panel = null),
          onConfirm: () => {
            deleteCustomTrack(t.id);
            this.show('custom');
          },
        });
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
