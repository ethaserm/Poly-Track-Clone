// In-race heads-up display (DOM overlay): timer, live delta, splits, analog speedometer,
// minimap, checkpoint counter, medal targets and messages.

export function formatTime(seconds, { sign = false } = {}) {
  if (seconds == null || !isFinite(seconds)) return '-:--.---';
  const neg = seconds < 0;
  const s = Math.abs(seconds);
  const m = Math.floor(s / 60);
  const rest = s - m * 60;
  const txt = `${m}:${rest.toFixed(3).padStart(6, '0')}`;
  if (sign) return (neg ? '-' : '+') + (m === 0 ? rest.toFixed(3) : txt);
  return (neg ? '-' : '') + txt;
}

export const MEDALS = [
  { key: 'author', label: 'Author', color: '#3fd0a5' },
  { key: 'gold', label: 'Gold', color: '#ffc928' },
  { key: 'silver', label: 'Silver', color: '#c8d1dc' },
  { key: 'bronze', label: 'Bronze', color: '#d98a4e' },
];

/** Best medal earned for a time, or null. */
export function medalFor(time, medals) {
  if (!medals || time == null) return null;
  for (const m of MEDALS) if (time <= medals[m.key]) return m;
  return null;
}

export function medalIcon(medal, size = 18) {
  if (!medal) return `<span class="medal-icon none" style="width:${size}px;height:${size}px"></span>`;
  return `<span class="medal-icon" title="${medal.label}" style="width:${size}px;height:${size}px;background:${medal.color}"></span>`;
}

export const UNITS = {
  kmh: { label: 'km/h', factor: 3.6, max: 400, major: 100, minor: 20 },
  mph: { label: 'mph', factor: 2.23694, max: 250, major: 50, minor: 10 },
};

const GEARS = [0, 13, 25, 37, 50, 64, 80];
/** Pseudo gearbox used by the HUD and engine sound: { gear 1..6, rpm 0..1 }. */
export function gearState(speed) {
  let gear = 0;
  while (gear < GEARS.length - 2 && speed > GEARS[gear + 1]) gear++;
  const lo = GEARS[gear];
  const hi = GEARS[gear + 1];
  return { gear: gear + 1, rpm: Math.min(1, Math.max(0, (speed - lo) / (hi - lo))) };
}

const ARC_START = 135;
const ARC_SWEEP = 270;

function polar(cx, cy, r, deg) {
  const a = (deg * Math.PI) / 180;
  return [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
}

function arcPath(cx, cy, r, a0, a1) {
  const [x0, y0] = polar(cx, cy, r, a0);
  const [x1, y1] = polar(cx, cy, r, a1);
  const large = a1 - a0 > 180 ? 1 : 0;
  return `M${x0.toFixed(2)} ${y0.toFixed(2)} A${r} ${r} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}

function speedometerSvg(units) {
  const u = UNITS[units] || UNITS.kmh;
  let ticks = '';
  for (let v = 0; v <= u.max; v += u.minor) {
    const major = v % u.major === 0;
    const a = ARC_START + (v / u.max) * ARC_SWEEP;
    const [x0, y0] = polar(100, 100, major ? 74 : 79, a);
    const [x1, y1] = polar(100, 100, 86, a);
    ticks += `<line x1="${x0.toFixed(1)}" y1="${y0.toFixed(1)}" x2="${x1.toFixed(1)}" y2="${y1.toFixed(1)}" class="${major ? 'tk-major' : 'tk-minor'}"/>`;
    if (major) {
      const [lx, ly] = polar(100, 100, 61, a);
      ticks += `<text x="${lx.toFixed(1)}" y="${(ly + 4).toFixed(1)}" class="tk-label">${v}</text>`;
    }
  }
  const redFrom = ARC_START + ARC_SWEEP * 0.8;
  return `
    <svg viewBox="0 0 200 200" class="speedo-svg" aria-hidden="true">
      <circle cx="100" cy="100" r="92" class="sp-bg"/>
      <path d="${arcPath(100, 100, 86, ARC_START, ARC_START + ARC_SWEEP)}" class="sp-track"/>
      <path d="${arcPath(100, 100, 86, redFrom, ARC_START + ARC_SWEEP)}" class="sp-red"/>
      ${ticks}
      <path d="${arcPath(100, 100, 46, ARC_START, ARC_START + ARC_SWEEP)}" class="sp-rpm-bg"/>
      <path d="${arcPath(100, 100, 46, ARC_START, ARC_START + ARC_SWEEP)}" class="sp-rpm" pathLength="100" stroke-dasharray="100" stroke-dashoffset="100"/>
      <g class="sp-needle"><polygon points="100,104 97,100 100,22 103,100" /><circle cx="100" cy="100" r="7"/></g>
      <text x="100" y="156" class="sp-num">0</text>
      <text x="100" y="172" class="sp-unit">${u.label}</text>
      <rect x="88" y="113" width="24" height="22" rx="5" class="sp-gear-bg"/>
      <text x="100" y="130" class="sp-gear">N</text>
    </svg>`;
}

export class Hud {
  constructor(root, { units = 'kmh', minimap = true } = {}) {
    this.units = UNITS[units] ? units : 'kmh';
    this.root = document.createElement('div');
    this.root.className = 'hud';
    this.root.innerHTML = `
      <div class="hud-top-left">
        <div class="hud-track"></div>
        <div class="hud-medals"></div>
      </div>
      <div class="hud-timer">
        <div class="hud-time">0:00.000</div>
        <div class="hud-live"></div>
        <div class="hud-split"></div>
      </div>
      <div class="hud-top-right">
        <div class="hud-cp"></div>
        <div class="hud-cp-bar"></div>
        <div class="hud-best"></div>
        <div class="hud-respawns"></div>
      </div>
      <div class="hud-speedo">${speedometerSvg(this.units)}</div>
      <canvas class="hud-minimap" width="180" height="180"></canvas>
      <div class="hud-msg"></div>
      <div class="hud-hint"></div>`;
    root.appendChild(this.root);
    this.$ = (sel) => this.root.querySelector(sel);
    this.timeEl = this.$('.hud-time');
    this.liveEl = this.$('.hud-live');
    this.splitEl = this.$('.hud-split');
    this.msgEl = this.$('.hud-msg');
    this.cpEl = this.$('.hud-cp');
    this.cpBar = this.$('.hud-cp-bar');
    this.bestEl = this.$('.hud-best');
    this.respawnEl = this.$('.hud-respawns');
    this.hintEl = this.$('.hud-hint');
    this.needle = this.$('.sp-needle');
    this.spNum = this.$('.sp-num');
    this.spGear = this.$('.sp-gear');
    this.spRpm = this.$('.sp-rpm');
    this.minimap = this.$('.hud-minimap');
    this.minimap.style.display = minimap ? '' : 'none';
    this._lastTime = '';
    this._lastSpeed = -1;
    this._lastGear = '';
  }

  setTrack(track, best) {
    this.$('.hud-track').textContent = track.name;
    const medalsEl = this.$('.hud-medals');
    if (track.medals) {
      medalsEl.innerHTML = MEDALS.map(
        (m) => `<div class="hud-medal-row" data-medal="${m.key}">${medalIcon(m, 12)}<span>${formatTime(track.medals[m.key])}</span></div>`,
      ).join('');
    } else {
      medalsEl.innerHTML = '';
    }
    this.medals = track.medals || null;
    this.setBest(best);
  }

  setBest(best) {
    this.best = best;
    this.bestEl.innerHTML = best != null ? `<span class="label">PB</span> ${formatTime(best)}` : '';
  }

  setTime(t) {
    const s = formatTime(t);
    if (s !== this._lastTime) {
      this.timeEl.textContent = s;
      this._lastTime = s;
      // Dim medal targets that are already out of reach.
      if (this.medals && !this._medalRows) this._medalRows = [...this.root.querySelectorAll('.hud-medal-row')];
      if (this._medalRows) for (const row of this._medalRows) row.classList.toggle('gone', t > this.medals[row.dataset.medal]);
    }
  }

  /** Live gap to the personal-best ghost (null hides it). */
  setLiveDelta(d) {
    if (d == null) {
      if (this._live !== null) {
        this.liveEl.className = 'hud-live';
        this._live = null;
      }
      return;
    }
    const txt = formatTime(d, { sign: true });
    if (txt !== this._live) {
      this.liveEl.textContent = txt;
      this.liveEl.className = `hud-live show ${d <= 0 ? 'faster' : 'slower'}`;
      this._live = txt;
    }
  }

  setSpeed(ms, gear = null) {
    const u = UNITS[this.units];
    const v = Math.abs(ms) * u.factor;
    const n = Math.round(v);
    if (n !== this._lastSpeed) {
      this.spNum.textContent = String(n);
      this._lastSpeed = n;
    }
    const a = (Math.min(v, u.max) / u.max) * ARC_SWEEP + ARC_START - 270; // needle drawn pointing up (270°)
    this.needle.setAttribute('transform', `rotate(${a.toFixed(1)} 100 100)`);
    if (gear) {
      const g = ms < -0.5 ? 'R' : ms < 0.5 && gear.gear === 1 ? 'N' : String(gear.gear);
      if (g !== this._lastGear) {
        this.spGear.textContent = g;
        this._lastGear = g;
      }
      this.spRpm.setAttribute('stroke-dashoffset', (100 - (0.15 + gear.rpm * 0.85) * 100).toFixed(1));
      this.spRpm.classList.toggle('redline', gear.rpm > 0.88);
    }
  }

  setCheckpoints(n, total) {
    this.cpEl.innerHTML = total > 0 ? `<span class="label">CP</span> ${n}/${total}` : '';
    this.cpBar.innerHTML = total > 0 ? Array.from({ length: total }, (_, i) => `<i class="${i < n ? 'on' : ''}"></i>`).join('') : '';
  }

  setRespawns(n) {
    this.respawnEl.textContent = n > 0 ? `⟲ ${n}` : '';
  }

  showSplit(time, delta) {
    clearTimeout(this._splitTimer);
    let html = `<span class="split-time">${formatTime(time)}</span>`;
    if (delta != null) {
      html += `<span class="split-delta ${delta <= 0 ? 'faster' : 'slower'}">${formatTime(delta, { sign: true })}</span>`;
    }
    this.splitEl.innerHTML = html;
    this.splitEl.classList.add('show');
    this._splitTimer = setTimeout(() => this.splitEl.classList.remove('show'), 2600);
  }

  clearSplit() {
    clearTimeout(this._splitTimer);
    this.splitEl.classList.remove('show');
  }

  message(text, ms = 1600, cls = '') {
    clearTimeout(this._msgTimer);
    this.msgEl.className = 'hud-msg show ' + cls;
    this.msgEl.innerHTML = text;
    if (ms > 0) this._msgTimer = setTimeout(() => this.msgEl.classList.remove('show'), ms);
  }

  clearMessage() {
    clearTimeout(this._msgTimer);
    this.msgEl.classList.remove('show');
  }

  hint(html) {
    this.hintEl.innerHTML = html;
    this.hintEl.classList.toggle('show', !!html);
  }

  setVisible(v) {
    this.root.style.display = v ? '' : 'none';
  }

  dispose() {
    clearTimeout(this._splitTimer);
    clearTimeout(this._msgTimer);
    this.root.remove();
  }
}

/**
 * Top-down minimap. The static track is drawn once into an offscreen canvas;
 * markers (checkpoints, ghost, car) are drawn every frame.
 */
export class Minimap {
  constructor(canvas, lines, { triggers = [], spawn = null } = {}) {
    this.canvas = canvas;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const css = 180;
    canvas.width = css * dpr;
    canvas.height = css * dpr;
    this.ctx = canvas.getContext('2d');
    this.dpr = dpr;
    this.size = css;
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const line of lines)
      for (const p of line) {
        minX = Math.min(minX, p[0]);
        maxX = Math.max(maxX, p[0]);
        minZ = Math.min(minZ, p[2]);
        maxZ = Math.max(maxZ, p[2]);
      }
    if (!isFinite(minX)) {
      minX = minZ = -10;
      maxX = maxZ = 10;
    }
    const pad = 14;
    const span = Math.max(maxX - minX, maxZ - minZ, 20);
    this.scale = (css - pad * 2) / span;
    this.ox = (maxX + minX) / 2;
    this.oz = (maxZ + minZ) / 2;
    this.triggers = triggers;
    this.spawn = spawn;
    // Static layer.
    this.base = document.createElement('canvas');
    this.base.width = canvas.width;
    this.base.height = canvas.height;
    const g = this.base.getContext('2d');
    g.scale(dpr, dpr);
    const drawLines = (width, color) => {
      g.strokeStyle = color;
      g.lineWidth = width;
      g.lineJoin = 'round';
      g.lineCap = 'round';
      for (const line of lines) {
        g.beginPath();
        line.forEach((p, i) => {
          const [x, y] = this.map(p[0], p[2]);
          if (i) g.lineTo(x, y);
          else g.moveTo(x, y);
        });
        g.stroke();
      }
    };
    drawLines(Math.max(4, 9 * this.scale) + 3, 'rgba(10,12,18,0.85)');
    drawLines(Math.max(4, 9 * this.scale), 'rgba(225,230,240,0.95)');
    if (spawn) {
      const [x, y] = this.map(spawn[0], spawn[2]);
      g.fillStyle = '#34d17a';
      g.fillRect(x - 3, y - 3, 6, 6);
    }
  }

  map(x, z) {
    const c = this.size / 2;
    return [c - (x - this.ox) * this.scale, c - (z - this.oz) * this.scale];
  }

  draw(car, ghost, collected) {
    const g = this.ctx;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, this.canvas.width, this.canvas.height);
    g.drawImage(this.base, 0, 0);
    g.scale(this.dpr, this.dpr);
    for (const t of this.triggers) {
      const [x, y] = this.map(t.center[0], t.center[2]);
      g.beginPath();
      g.arc(x, y, 4, 0, Math.PI * 2);
      g.fillStyle = t.kind === 'finish' ? '#ffffff' : collected?.has(t.id) ? '#35d6ff' : '#ffc21a';
      g.fill();
      g.lineWidth = 1.5;
      g.strokeStyle = '#11131a';
      g.stroke();
    }
    if (ghost) {
      const [x, y] = this.map(ghost.x, ghost.z);
      g.beginPath();
      g.arc(x, y, 3.5, 0, Math.PI * 2);
      g.fillStyle = 'rgba(255,255,255,0.75)';
      g.fill();
    }
    if (car) {
      const [x, y] = this.map(car.pos.x, car.pos.z);
      const a = Math.atan2(-car.fwd.x, car.fwd.z);
      g.save();
      g.translate(x, y);
      g.rotate(a);
      g.beginPath();
      g.moveTo(0, -7);
      g.lineTo(5, 5);
      g.lineTo(0, 2.5);
      g.lineTo(-5, 5);
      g.closePath();
      g.fillStyle = car.color || '#e8402f';
      g.fill();
      g.lineWidth = 1.5;
      g.strokeStyle = '#ffffff';
      g.stroke();
      g.restore();
    }
  }
}
