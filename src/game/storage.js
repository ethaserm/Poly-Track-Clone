// localStorage helpers. Every access is guarded: storage can be unavailable
// (private mode, blocked site data) and the game must still run.

const PREFIX = 'polytrack-clone.';

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw == null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

function remove(key) {
  try {
    localStorage.removeItem(PREFIX + key);
  } catch {
    /* ignore */
  }
}

export const DEFAULT_SETTINGS = {
  carColor: '#e8402f',
  accentColor: '#1d1f27',
  rimColor: '#c9ced8',
  livery: 'stripe',
  carNumber: 7,
  ghost: true,
  sound: true,
  volume: 0.6,
  musicVolume: 0.35,
  camera: 0,
  quality: null,
  showFps: false,
  units: 'kmh',
  fovOffset: 0,
  cameraShake: true,
  speedEffects: true,
  minimap: true,
  skidmarks: true,
  playerName: 'Player',
};

export function loadSettings() {
  const s = { ...DEFAULT_SETTINGS, ...read('settings', {}) };
  if (!s.quality) {
    // First run: be gentle on phones and small screens.
    const touch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    s.quality = touch ? 'medium' : 'high';
  }
  delete s.shadows;
  return s;
}

export function saveSettings(s) {
  write('settings', s);
}

/** Stable key for best times: built-in id, or a hash of the layout for custom tracks. */
export function trackKey(track) {
  if (track.builtin) return 'b:' + track.id;
  const json = JSON.stringify(track.pieces.map((p) => [p.t, p.x, p.y, p.z, p.r, p.m ? 1 : 0]));
  let h = 0x811c9dc5;
  for (let i = 0; i < json.length; i++) {
    h ^= json.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return 'c:' + (h >>> 0).toString(36);
}

export function loadRecord(track) {
  return read('best.' + trackKey(track), null);
}

export function saveRecord(track, record) {
  if (!write('best.' + trackKey(track), record)) {
    // Probably out of quota: drop the ghost and keep the time.
    write('best.' + trackKey(track), { ...record, ghost: null });
  }
}

export function clearRecord(track) {
  remove('best.' + trackKey(track));
}

// --- Leaderboards (local top runs per track) -------------------------------------

export function loadRuns(track) {
  return read('runs.' + trackKey(track), []);
}

/** Adds a finished run; keeps the ten fastest. Returns the run's rank (1-based) or 0. */
export function addRun(track, run) {
  const list = loadRuns(track);
  list.push(run);
  list.sort((a, b) => a.time - b.time);
  const kept = list.slice(0, 10);
  write('runs.' + trackKey(track), kept);
  const i = kept.indexOf(run);
  return i >= 0 ? i + 1 : 0;
}

// --- Player statistics ---------------------------------------------------------

export const EMPTY_STATS = {
  racesStarted: 0,
  racesFinished: 0,
  distance: 0,
  driveTime: 0,
  respawns: 0,
  restarts: 0,
  topSpeed: 0,
  airTime: 0,
  longestJump: 0,
  checkpoints: 0,
  personalBests: 0,
  trackPlays: {},
};

export function loadStats() {
  return { ...EMPTY_STATS, ...read('stats', {}) };
}

/** Merge a delta into stats: numbers add, `max:` keys keep the maximum. */
export function updateStats(delta) {
  const s = loadStats();
  for (const [k, v] of Object.entries(delta)) {
    if (k === 'topSpeed' || k === 'longestJump') s[k] = Math.max(s[k] || 0, v);
    else if (k === 'trackPlay') s.trackPlays[v] = (s.trackPlays[v] || 0) + 1;
    else s[k] = (s[k] || 0) + v;
  }
  write('stats', s);
  return s;
}

export function resetProgress() {
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && k.startsWith(PREFIX) && (k.includes('best.') || k.includes('runs.') || k.endsWith('stats'))) localStorage.removeItem(k);
    }
  } catch {
    /* ignore */
  }
}

// --- Editor draft (autosave) ------------------------------------------------------

export function saveDraft(track) {
  write('editor.draft', { name: track.name, env: track.env, pieces: track.pieces, id: track.id || null, at: Date.now() });
}

export function loadDraft() {
  return read('editor.draft', null);
}

export function clearDraft() {
  remove('editor.draft');
}

// --- Custom tracks -----------------------------------------------------------

export function loadCustomTracks() {
  return read('custom', []);
}

export function saveCustomTrack(track) {
  const list = loadCustomTracks();
  const now = Date.now();
  const entry = {
    id: track.id || 'u' + now.toString(36) + Math.random().toString(36).slice(2, 6),
    name: track.name || 'Untitled',
    env: track.env || 'summer',
    pieces: track.pieces,
    updated: now,
  };
  const i = list.findIndex((t) => t.id === entry.id);
  if (i >= 0) list[i] = entry;
  else list.unshift(entry);
  write('custom', list);
  return entry;
}

export function deleteCustomTrack(id) {
  write(
    'custom',
    loadCustomTracks().filter((t) => t.id !== id),
  );
}

// --- Ghost encoding -----------------------------------------------------------

export function floatsToB64(arr) {
  const bytes = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

export function b64ToFloats(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Float32Array(bytes.buffer);
}
