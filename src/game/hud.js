// In-race heads-up display (DOM overlay).

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

export class Hud {
  constructor(root) {
    this.root = document.createElement('div');
    this.root.className = 'hud';
    this.root.innerHTML = `
      <div class="hud-top-left">
        <div class="hud-track"></div>
        <div class="hud-medals"></div>
      </div>
      <div class="hud-timer">
        <div class="hud-time">0:00.000</div>
        <div class="hud-split"></div>
      </div>
      <div class="hud-top-right">
        <div class="hud-cp"></div>
        <div class="hud-best"></div>
      </div>
      <div class="hud-speed"><span class="hud-speed-num">0</span><span class="hud-speed-unit">km/h</span></div>
      <div class="hud-msg"></div>
      <div class="hud-hint"></div>`;
    root.appendChild(this.root);
    this.$ = (sel) => this.root.querySelector(sel);
    this.timeEl = this.$('.hud-time');
    this.speedEl = this.$('.hud-speed-num');
    this.splitEl = this.$('.hud-split');
    this.msgEl = this.$('.hud-msg');
    this.cpEl = this.$('.hud-cp');
    this.bestEl = this.$('.hud-best');
    this.hintEl = this.$('.hud-hint');
    this._lastTime = '';
    this._lastSpeed = -1;
  }

  setTrack(track, best) {
    this.$('.hud-track').textContent = track.name;
    const medalsEl = this.$('.hud-medals');
    if (track.medals) {
      medalsEl.innerHTML = MEDALS.map(
        (m) => `<div class="hud-medal-row">${medalIcon(m, 12)}<span>${formatTime(track.medals[m.key])}</span></div>`,
      ).join('');
    } else {
      medalsEl.innerHTML = '';
    }
    this.setBest(best);
  }

  setBest(best) {
    this.bestEl.innerHTML = best != null ? `<span class="label">PB</span> ${formatTime(best)}` : '';
  }

  setTime(t) {
    const s = formatTime(t);
    if (s !== this._lastTime) {
      this.timeEl.textContent = s;
      this._lastTime = s;
    }
  }

  setSpeed(kmh) {
    const v = Math.round(kmh);
    if (v !== this._lastSpeed) {
      this.speedEl.textContent = String(v);
      this._lastSpeed = v;
    }
  }

  setCheckpoints(n, total) {
    this.cpEl.innerHTML = total > 0 ? `<span class="label">CP</span> ${n}/${total}` : '';
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
