import * as THREE from 'three';
import { Bot } from '../core/bot.js';
import { GHOST_HZ, PHYSICS_DT, PHYSICS_HZ } from '../core/constants.js';
import { RaceSim } from '../core/race.js';
import { compileTrack, occupiedCells } from '../core/track.js';
import { CarModel } from './carModel.js';
import { Effects, SpeedLines } from './effects.js';
import { CAMERA_MODES, ChaseCamera } from './chaseCamera.js';
import { THEMES, buildEnvironment, seedFrom } from './environment.js';
import { themeEnvMap } from './renderer.js';
import { Hud, MEDALS, formatTime, medalFor, medalIcon } from './hud.js';
import { isTouchDevice } from './input.js';
import { b64ToFloats, floatsToB64, loadRecord, saveRecord } from './storage.js';
import { TrackView } from './trackView.js';
import { escapeHtml, openPanel } from './ui.js';

const GHOST_EVERY = PHYSICS_HZ / GHOST_HZ;

export function occupiedSet(track) {
  const set = new Set();
  for (const pc of track.pieces) for (const c of occupiedCells(pc)) set.add(`${c.x},${c.z}`);
  return set;
}

/**
 * A playable race on one track (also used as the animated menu background in demo mode,
 * where the autopilot drives).
 */
export class RaceMode {
  constructor(app, track, { demo = false, fromEditor = null } = {}) {
    this.app = app;
    this.track = track;
    this.demo = demo;
    this.fromEditor = fromEditor;
    const settings = app.settings;
    const shadows = app.quality.shadows;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(70, app.aspect, 0.1, 5000);
    this.compiled = compileTrack(track);
    this.env = buildEnvironment(track.env, {
      compiled: this.compiled,
      occupied: occupiedSet(track),
      seed: seedFrom(track.name || 'track'),
      shadows,
      quality: app.quality,
    });
    this.scene.add(this.env.group);
    this.scene.fog = this.env.fog;

    this.view = new TrackView(this.compiled, { shadows });
    this.scene.add(this.view.group);

    this.envMap = themeEnvMap(app.renderer, THEMES[track.env] || THEMES.summer, track.env || 'summer');
    this.carModel = new CarModel({
      color: settings.carColor,
      accent: settings.accentColor,
      rim: settings.rimColor,
      livery: settings.livery,
      number: settings.carNumber,
      shadows,
      envMap: this.envMap,
    });
    this.scene.add(this.carModel.group);
    this.ghostModel = new CarModel({ ghost: true, color: '#ffffff', accent: '#9aa3b5', rim: '#ffffff', livery: 'plain' });
    this.ghostModel.group.visible = false;
    this.scene.add(this.ghostModel.group);

    this.sim = new RaceSim(this.compiled);
    this.chase = new ChaseCamera(this.camera);
    this.chase.setMode(demo ? 0 : settings.camera);
    this.chase.fovOffset = settings.fovOffset || 0;
    this.chase.shakeEnabled = settings.cameraShake && !demo;
    this.effects = new Effects(this.scene, { env: track.env, quality: app.quality.particles, skidmarks: settings.skidmarks });
    this.speedLines = new SpeedLines();
    this.scene.add(this.camera);
    this.camera.add(this.speedLines.lines);
    this.boostLevel = 0;

    this.prevPos = new THREE.Vector3();
    this.prevQuat = new THREE.Quaternion();
    this.acc = 0;
    this.paused = false;
    this.panel = null;
    this.impactCooldown = 0;
    this.finishOrbit = 0;

    if (demo) {
      this.bot = this.compiled.driveLine ? new Bot(this.compiled.driveLine) : null;
    } else {
      this.record = loadRecord(track);
      this.loadGhost();
      this.hud = new Hud(app.uiRoot);
      this.hud.setTrack(track, this.record?.time);
      if (isTouchDevice()) app.input.attachTouch(app.uiRoot);
      app.audio.startEngine();
      this._onVisibility = () => {
        if (document.hidden && !this.sim.finished) this.pause();
      };
      document.addEventListener('visibilitychange', this._onVisibility);
    }
    this.restart();
  }

  loadGhost() {
    this.ghost = null;
    if (this.record?.ghost) {
      try {
        this.ghost = b64ToFloats(this.record.ghost);
      } catch {
        this.ghost = null;
      }
    }
  }

  /** Let the autopilot drive this race (debug / testing aid: window.__app.mode.enableAutopilot()). */
  enableAutopilot() {
    if (!this.compiled.driveLine) return false;
    this.bot = new Bot(this.compiled.driveLine);
    this.autopilot = true;
    return true;
  }

  restart() {
    this.sim.restart();
    this.effects?.clear();
    this.view.resetCheckpoints();
    this.view.setStartLights('red');
    this.ghostRec = [];
    this.recordGhostFrame();
    this.acc = 0;
    this.prevPos.copy(this.sim.car.pos);
    this.prevQuat.copy(this.sim.car.quat);
    this.chase.snap(this.sim.car.pos, this.sim.car.quat);
    this.finishOrbit = 0;
    this.bot?.reset();
    this.closePanel();
    if (this.hud) {
      this.hud.setTime(0);
      this.hud.setCheckpoints(0, this.compiled.checkpointCount);
      this.hud.clearSplit();
      this.hud.clearMessage();
      const keys = this.app.input.lastDevice === 'gamepad' ? 'RT' : this.app.input.lastDevice === 'touch' ? '▲' : '↑ / W';
      this.hud.hint(
        this.compiled.finishCount === 0
          ? `This track has no finish yet · drive with ${keys}`
          : `Press <b>${keys}</b> to start`,
      );
    }
    this.app.input.clearActions();
  }

  recordGhostFrame() {
    const { pos, quat } = this.sim.car;
    this.ghostRec.push(pos.x, pos.y, pos.z, quat.x, quat.y, quat.z, quat.w);
  }

  respawn() {
    if (this.sim.finished) return;
    if (!this.sim.started) {
      this.restart();
      return;
    }
    this.sim.respawn();
    this.prevPos.copy(this.sim.car.pos);
    this.prevQuat.copy(this.sim.car.quat);
    this.chase.snap(this.sim.car.pos, this.sim.car.quat);
    this.effects.burst('respawn', this.sim.car.pos);
    this.app.gfx.pulse(0x7fd8ff, 0.25);
    this.app.audio.respawn();
  }

  // --- Panels -------------------------------------------------------------------

  closePanel() {
    if (this.panel) {
      const p = this.panel;
      this.panel = null;
      p.close();
    }
  }

  pause() {
    if (this.demo || this.panel || this.sim.finished) return;
    this.paused = true;
    const s = this.app.settings;
    const exitLabel = this.fromEditor ? 'Back to editor' : 'Quit to menu';
    this.panel = openPanel(
      this.app.uiRoot,
      `<h2>Paused</h2>
       <div class="panel-sub">${escapeHtml(this.track.name)}</div>
       <div class="btn-col">
         <button class="btn primary" data-action="resume">Resume</button>
         <button class="btn" data-action="restart">Restart <kbd>T</kbd></button>
         <button class="btn" data-action="camera">Camera: <b>${CAMERA_MODES[this.chase.mode].name}</b> <kbd>C</kbd></button>
         <button class="btn" data-action="ghost">Ghost: <b>${s.ghost ? 'On' : 'Off'}</b> <kbd>G</kbd></button>
         <button class="btn" data-action="sound">Sound: <b>${s.sound ? 'On' : 'Off'}</b> <kbd>M</kbd></button>
         <button class="btn" data-action="exit">${exitLabel}</button>
       </div>`,
      {
        className: 'pause-panel',
        focus: false,
        onAction: (a) => {
          this.app.audio.click();
          if (a === 'resume') this.resume();
          else if (a === 'restart') this.restart();
          else if (a === 'exit') this.exit();
          else {
            if (a === 'camera') this.cycleCamera();
            if (a === 'ghost') this.toggleGhost();
            if (a === 'sound') this.app.toggleSound();
            this.closePanel();
            this.pause();
          }
          this.app.input.clearActions();
        },
        onClose: () => {
          this.paused = false;
        },
      },
    );
  }

  resume() {
    this.closePanel();
    this.paused = false;
    this.app.input.clearActions();
  }

  exit() {
    this.closePanel();
    if (this.fromEditor) this.app.openEditor(this.fromEditor);
    else this.app.showMenu();
  }

  cycleCamera() {
    this.chase.setMode(this.chase.mode + 1);
    this.app.settings.camera = this.chase.mode;
    this.app.saveSettings();
    this.hud?.message(`Camera: ${CAMERA_MODES[this.chase.mode].name}`, 900, 'small');
  }

  toggleGhost() {
    this.app.settings.ghost = !this.app.settings.ghost;
    this.app.saveSettings();
    this.hud?.message(`Ghost ${this.app.settings.ghost ? 'on' : 'off'}`, 900, 'small');
  }

  onFinish() {
    const sim = this.sim;
    const time = sim.time;
    const splits = sim.splits.map((t) => t * PHYSICS_DT);
    this.recordGhostFrame();
    const prev = this.record;
    const isPB = !prev || time < prev.time;
    const medal = medalFor(time, this.track.medals);
    const prevMedal = prev ? medalFor(prev.time, this.track.medals) : null;
    if (isPB) {
      this.record = {
        time,
        splits,
        ghost: floatsToB64(new Float32Array(this.ghostRec)),
        date: Date.now(),
      };
      saveRecord(this.track, this.record);
      this.loadGhost();
      this.hud.setBest(time);
    }
    this.app.audio.finish(!!medal);
    this.hud.hint('');
    this.hud.clearSplit();

    let deltaHtml = '';
    if (!prev) deltaHtml = '<div class="finish-delta pb">First finish!</div>';
    else if (isPB)
      deltaHtml = `<div class="finish-delta pb">New personal best! <span class="faster">${formatTime(time - prev.time, { sign: true })}</span></div>`;
    else deltaHtml = `<div class="finish-delta"><span class="slower">${formatTime(time - prev.time, { sign: true })}</span> vs PB ${formatTime(prev.time)}</div>`;

    let medalHtml = '';
    if (this.track.medals) {
      medalHtml = `<div class="finish-medals">${MEDALS.map((m) => {
        const got = this.record && this.record.time <= this.track.medals[m.key];
        return `<div class="fm ${got ? 'got' : ''}">${medalIcon(m, 16)}<span>${m.label}</span><b>${formatTime(this.track.medals[m.key])}</b></div>`;
      }).join('')}</div>`;
      if (medal && (!prevMedal || MEDALS.indexOf(medal) < MEDALS.indexOf(prevMedal))) {
        medalHtml = `<div class="medal-earned" style="--medal:${medal.color}">${medalIcon(medal, 26)} ${medal.label} medal!</div>` + medalHtml;
      }
    }
    const next = !this.fromEditor && this.app.nextBuiltin(this.track);
    const exitLabel = this.fromEditor ? 'Back to editor' : 'Menu';
    setTimeout(() => {
      if (this.disposed || !this.sim.finished) return;
      this.panel = openPanel(
        this.app.uiRoot,
        `<h2>Finished</h2>
         <div class="panel-sub">${escapeHtml(this.track.name)}</div>
         <div class="finish-time">${formatTime(time)}</div>
         ${deltaHtml}
         ${medalHtml}
         <div class="btn-row">
           <button class="btn primary" data-action="retry">Retry <kbd>R</kbd></button>
           ${next ? '<button class="btn" data-action="next">Next track</button>' : ''}
           <button class="btn" data-action="exit">${exitLabel}</button>
         </div>`,
        {
          className: 'finish-panel',
          focus: false,
          onAction: (a) => {
            this.app.audio.click();
            if (a === 'retry') this.restart();
            else if (a === 'next') this.app.playTrack(next);
            else if (a === 'exit') this.exit();
          },
        },
      );
    }, 700);
  }

  // --- Main loop ------------------------------------------------------------------

  handleActions() {
    const input = this.app.input;
    if (input.consume('pause')) {
      if (this.panel && !this.sim.finished) this.resume();
      else if (this.sim.finished) this.exit();
      else this.pause();
    }
    if (input.consume('mute')) this.app.toggleSound();
    if (input.consume('camera')) this.cycleCamera();
    if (input.consume('ghost')) this.toggleGhost();
    if (this.paused) {
      input.consume('restart');
      input.consume('respawn');
      return;
    }
    if (input.consume('restart')) this.restart();
    if (input.consume('respawn')) {
      if (this.sim.finished) this.restart();
      else this.respawn();
    }
  }

  step() {
    const sim = this.sim;
    const car = sim.car;
    this.prevPos.copy(car.pos);
    this.prevQuat.copy(car.quat);
    let input;
    if (this.demo || this.autopilot) input = this.bot ? this.bot.drive(car) : { throttle: 0, brake: 0, steer: 0 };
    else input = this.app.input.drive();
    this.lastInput = input;
    const events = sim.tick(input);
    if (sim.started && !sim.finished && sim.ticks % GHOST_EVERY === 0) this.recordGhostFrame();
    for (const e of events) this.handleEvent(e);
    if (this.demo && this.bot && sim.started && !sim.finished) {
      // Demo: recover if the autopilot ever falls off.
      if (this.bot.offLine > 12 && car.grounded) {
        sim.respawn();
        this.bot.relocate(car.pos);
      }
    }
  }

  handleEvent(e) {
    if (this.demo) {
      if (e.type === 'finish') setTimeout(() => !this.disposed && this.restart(), 2500);
      return;
    }
    const hud = this.hud;
    switch (e.type) {
      case 'start':
        hud.hint('');
        this.view.setStartLights('green');
        setTimeout(() => !this.disposed && this.sim.started && this.view.setStartLights('off'), 2500);
        break;
      case 'checkpoint': {
        this.view.setCheckpoint(e.id, true);
        const trig = this.compiled.triggers.find((t) => t.kind === 'checkpoint' && t.id === e.id);
        if (trig) this.effects.burst('checkpoint', { x: trig.center[0], y: trig.center[1] - 2, z: trig.center[2] });
        this.app.gfx.pulse(0x9fe8ff, 0.18);
        const t = e.ticks * PHYSICS_DT;
        const pb = this.record?.splits?.[e.index];
        const delta = pb != null ? t - pb : null;
        hud.showSplit(t, delta);
        hud.setCheckpoints(this.sim.collected.size, this.compiled.checkpointCount);
        this.app.audio.checkpoint(delta == null ? null : delta <= 0);
        break;
      }
      case 'missing':
        hud.message(`Missing ${e.remaining} checkpoint${e.remaining > 1 ? 's' : ''}!`, 1800, 'warn');
        this.app.audio.missing();
        break;
      case 'finish': {
        const trig = this.compiled.triggers.find((t) => t.kind === 'finish');
        if (trig) this.effects.burst('finish', { x: trig.center[0], y: trig.center[1] - 3, z: trig.center[2] });
        this.app.gfx.pulse(0xffffff, 0.3);
        this.view.celebrate();
        this.env.cheer(5);
        this.onFinish();
        break;
      }
    }
  }

  frame(dt) {
    if (!this.demo) this.handleActions();
    const sim = this.sim;
    const car = sim.car;

    if (!this.paused) {
      this.acc += Math.min(dt, 0.1);
      while (this.acc >= PHYSICS_DT) {
        this.step();
        this.acc -= PHYSICS_DT;
      }
    }
    const alpha = this.paused ? 1 : this.acc / PHYSICS_DT;
    this.carModel.syncPhysics(car, alpha, this.prevPos, this.prevQuat);
    const input = this.lastInput || { throttle: 0, brake: 0 };
    this.boostLevel = car.onBoost ? 1 : Math.max(0, this.boostLevel - dt * 1.6);
    const fwdSpeed = car.forwardSpeed;
    this.carModel.setLights(
      { brake: input.brake > 0 && fwdSpeed > 0.5 ? 1 : 0, reverse: input.brake > 0 && fwdSpeed < -0.3, boost: this.boostLevel },
      dt,
    );
    if (!this.paused) {
      const scale = this.app.gfx.renderer.getDrawingBufferSize(_tmpV2).y / (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)));
      const fx = this.effects.update(dt, car, { throttle: input.throttle, brake: input.brake, boost: this.boostLevel, scale });
      if (fx.landing) this.chase.addTrauma(Math.min(0.55, fx.landing * 0.035));
      if (car.wallHit > 5) this.chase.addTrauma(Math.min(0.4, car.wallHit * 0.02));
    }
    const speedFx = !this.demo && this.app.settings.speedEffects ? car.speed : 0;
    this.speedLines.update(dt, speedFx);
    this.app.gfx.setSpeedEffect(Math.min(1, Math.max(0, (speedFx - 48) / 40)) * 0.7);

    // Ghost playback.
    const showGhost = !this.demo && this.app.settings.ghost && this.ghost && this.ghost.length >= 14;
    this.ghostModel.group.visible = !!showGhost;
    if (showGhost) {
      const frames = this.ghost.length / 7;
      const f = Math.min(frames - 1, sim.time * GHOST_HZ);
      const i = Math.floor(f);
      const j = Math.min(frames - 1, i + 1);
      const k = f - i;
      const g = this.ghost;
      const p = this.ghostModel.group.position;
      p.set(g[i * 7], g[i * 7 + 1], g[i * 7 + 2]).lerp(_tmpV.set(g[j * 7], g[j * 7 + 1], g[j * 7 + 2]), k);
      _qa.set(g[i * 7 + 3], g[i * 7 + 4], g[i * 7 + 5], g[i * 7 + 6]);
      _qb.set(g[j * 7 + 3], g[j * 7 + 4], g[j * 7 + 5], g[j * 7 + 6]);
      this.ghostModel.group.quaternion.slerpQuaternions(_qa, _qb, k);
      // Fade the ghost when it overlaps the player.
      const d = p.distanceTo(this.carModel.group.position);
      const op = Math.min(0.38, Math.max(0.08, (d - 1.5) * 0.08));
      this.ghostModel.setOpacity(op);
    }

    // Camera.
    const pos = this.carModel.group.position;
    const quat = this.carModel.group.quaternion;
    if (sim.finished && !this.demo) {
      this.finishOrbit += dt;
      if (this.finishOrbit > 0.6) this.chase.updateOrbit(dt, pos);
      else this.chase.update(dt, pos, quat, car.speed, car.grounded > 0);
    } else {
      this.chase.update(dt, pos, quat, car.speed, car.grounded > 0);
    }
    this.env.update(pos, dt, this.camera);
    this.view.update(dt);

    if (this.hud) {
      this.hud.setTime(sim.time);
      this.hud.setSpeed(car.speed * 3.6);
    }

    // Audio.
    if (!this.demo) {
      const audio = this.app.audio;
      audio.updateEngine({
        speed: car.speed,
        throttle: this.paused ? 0 : this.lastInput?.throttle || 0,
        grounded: car.grounded > 0,
        slip: car.slip,
      });
      this.impactCooldown -= dt;
      if (car.wallHit > 6 && this.impactCooldown <= 0) {
        audio.impact(car.wallHit);
        this.impactCooldown = 0.25;
      }
    }

    this.app.render(this.scene, this.camera, dt);
  }

  resize(aspect) {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  dispose() {
    this.disposed = true;
    this.closePanel();
    this.hud?.dispose();
    if (!this.demo) {
      this.app.audio.stopEngine();
      document.removeEventListener('visibilitychange', this._onVisibility);
    }
    this.app.input.touchEl?.remove();
    this.app.input.touchEl = null;
    document.body.classList.remove('touch');
    this.view.dispose();
    this.effects.dispose();
    this.speedLines.dispose();
    this.app.gfx.setSpeedEffect(0);
    this.env.dispose();
    this.carModel.dispose();
    this.ghostModel.dispose();
  }
}

const _tmpV = new THREE.Vector3();
const _tmpV2 = new THREE.Vector2();
const _qa = new THREE.Quaternion();
const _qb = new THREE.Quaternion();
