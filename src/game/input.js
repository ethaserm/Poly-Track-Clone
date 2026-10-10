// Keyboard, gamepad and touch input for driving.

const DRIVE_KEYS = {
  throttle: ['KeyW', 'ArrowUp'],
  brake: ['KeyS', 'ArrowDown', 'Space'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
};

const ACTION_KEYS = {
  respawn: ['Enter', 'KeyR', 'NumpadEnter'],
  restart: ['Backspace', 'KeyT', 'Delete'],
  camera: ['KeyC'],
  pause: ['Escape', 'KeyP'],
  mute: ['KeyM'],
  ghost: ['KeyG'],
};

// Standard gamepad mapping button indices.
const PAD_ACTIONS = {
  respawn: [0, 1], // A / B
  restart: [3, 8], // Y / Back
  camera: [2, 5], // X / RB
  pause: [9], // Start
};

const PREVENT = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'Backspace']);

function isTyping(e) {
  const t = e.target;
  return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
}

export class Input {
  constructor() {
    this.keys = new Set();
    this.queue = new Set();
    this.touch = { left: false, right: false, gas: false, brake: false };
    this.padPrev = [];
    this.enabled = true;
    this.lastDevice = 'keyboard';
    this._down = (e) => {
      if (isTyping(e)) return;
      if (this.enabled && PREVENT.has(e.code)) e.preventDefault();
      if (!e.repeat) {
        for (const [action, codes] of Object.entries(ACTION_KEYS)) if (codes.includes(e.code)) this.queue.add(action);
      }
      this.keys.add(e.code);
      this.lastDevice = 'keyboard';
    };
    this._up = (e) => this.keys.delete(e.code);
    this._blur = () => this.keys.clear();
    window.addEventListener('keydown', this._down);
    window.addEventListener('keyup', this._up);
    window.addEventListener('blur', this._blur);
  }

  any(codes) {
    for (const c of codes) if (this.keys.has(c)) return true;
    return false;
  }

  pollGamepad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const pad of pads) {
      if (!pad || !pad.connected) continue;
      const pressed = pad.buttons.map((b) => b.pressed);
      for (const [action, idx] of Object.entries(PAD_ACTIONS)) {
        for (const i of idx) if (pressed[i] && !this.padPrev[i]) this.queue.add(action);
      }
      this.padPrev = pressed;
      const rt = pad.buttons[7] ? pad.buttons[7].value : 0;
      const lt = pad.buttons[6] ? pad.buttons[6].value : 0;
      let sx = pad.axes[0] || 0;
      if (Math.abs(sx) < 0.12) sx = 0;
      const dpadL = pad.buttons[14]?.pressed ? 1 : 0;
      const dpadR = pad.buttons[15]?.pressed ? 1 : 0;
      if (rt > 0.05 || lt > 0.05 || sx !== 0 || dpadL || dpadR) this.lastDevice = 'gamepad';
      return { throttle: rt, brake: lt, steer: -sx + dpadL - dpadR };
    }
    return null;
  }

  /** Current driving input: { throttle, brake, steer } with steer > 0 = left. */
  drive() {
    if (!this.enabled) return { throttle: 0, brake: 0, steer: 0 };
    let throttle = this.any(DRIVE_KEYS.throttle) || this.touch.gas ? 1 : 0;
    let brake = this.any(DRIVE_KEYS.brake) || this.touch.brake ? 1 : 0;
    let steer = 0;
    if (this.any(DRIVE_KEYS.left) || this.touch.left) steer += 1;
    if (this.any(DRIVE_KEYS.right) || this.touch.right) steer -= 1;
    const pad = this.pollGamepad();
    if (pad) {
      throttle = Math.max(throttle, pad.throttle);
      brake = Math.max(brake, pad.brake);
      if (pad.steer !== 0) steer = Math.max(-1, Math.min(1, pad.steer));
    }
    return { throttle, brake, steer };
  }

  /** Edge-triggered actions since the last call. */
  consume(action) {
    if (this.queue.has(action)) {
      this.queue.delete(action);
      return true;
    }
    return false;
  }

  clearActions() {
    this.queue.clear();
  }

  /** On-screen buttons for touch devices. */
  attachTouch(root) {
    const el = document.createElement('div');
    el.className = 'touch-controls';
    el.innerHTML = `
      <div class="touch-pad left">
        <button data-k="left" aria-label="Steer left">◀</button>
        <button data-k="right" aria-label="Steer right">▶</button>
      </div>
      <div class="touch-pad right">
        <button data-k="brake" aria-label="Brake">▼</button>
        <button data-k="gas" aria-label="Accelerate">▲</button>
      </div>
      <div class="touch-top">
        <button data-a="respawn" aria-label="Respawn at checkpoint">⟲</button>
        <button data-a="pause" aria-label="Pause">❚❚</button>
      </div>`;
    const set = (btn, v) => {
      const k = btn.dataset.k;
      if (k) {
        this.touch[k] = v;
        btn.classList.toggle('active', v);
      }
    };
    el.querySelectorAll('button').forEach((btn) => {
      btn.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        btn.setPointerCapture?.(e.pointerId);
        if (btn.dataset.a) this.queue.add(btn.dataset.a);
        set(btn, true);
        this.lastDevice = 'touch';
      });
      const off = () => set(btn, false);
      btn.addEventListener('pointerup', off);
      btn.addEventListener('pointercancel', off);
      btn.addEventListener('lostpointercapture', off);
    });
    root.appendChild(el);
    this.touchEl = el;
    document.body.classList.add('touch');
    return el;
  }

  dispose() {
    window.removeEventListener('keydown', this._down);
    window.removeEventListener('keyup', this._up);
    window.removeEventListener('blur', this._blur);
  }
}

export const isTouchDevice = () => 'ontouchstart' in window || navigator.maxTouchPoints > 0;
