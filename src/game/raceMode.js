import * as THREE from 'three';
import { Bot } from '../core/bot.js';
import { GHOST_HZ, PHYSICS_DT, PHYSICS_HZ } from '../core/constants.js';
import { RaceSim } from '../core/race.js';
import { CAMERA_MODES, ChaseCamera } from './chaseCamera.js';
import { SpeedLines } from './effects.js';
import { FLAG_BOOST, FLAG_BRAKE, FLAG_REVERSE, GHOST_STRIDE, GhostRecorder, decodeGhost, ghostTimeAt, sampleGhost } from './ghost.js';
import { Hud, MEDALS, Minimap, UNITS, formatTime, gearState, medalFor, medalIcon } from './hud.js';
import { isTouchDevice } from './input.js';
import { addRun, floatsToB64, loadRecord, loadRuns, saveRecord, trackKey, updateStats } from './storage.js';
import { TrackScene, trackLines } from './trackScene.js';
import { escapeHtml, openPanel } from './ui.js';

export { occupiedSet } from './trackScene.js';

const GHOST_EVERY = PHYSICS_HZ / GHOST_HZ;
const _gp = new THREE.Vector3();
const _gq = new THREE.Quaternion();
const _v = new THREE.Vector3();

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

    this.ts = new TrackScene(app, track);
    this.scene = this.ts.scene;
    this.camera = this.ts.camera;
    this.compiled = this.ts.compiled;
    this.view = this.ts.view;
    this.effects = this.ts.effects;
    this.carModel = this.ts.createPlayerCar();
    this.ghostModel = this.ts.createGhostCar();

    this.sim = new RaceSim(this.compiled);
    this.chase = new ChaseCamera(this.camera);
    this.chase.setMode(demo ? 0 : settings.camera);
    this.chase.fovOffset = settings.fovOffset || 0;
    this.chase.shakeEnabled = settings.cameraShake && !demo;
    this.speedLines = new SpeedLines();
    this.camera.add(this.speedLines.lines);

    this.rec = new GhostRecorder();
    this.prevPos = new THREE.Vector3();
    this.prevQuat = new THREE.Quaternion();
    this.acc = 0;
    this.paused = false;
    this.panel = null;
    this.impactCooldown = 0;
    this.finishOrbit = 0;
    this.boostLevel = 0;
    this.ghostHint = 0;
    this.liveTimer = 0;
    this.stat = this.freshStats();

    if (demo) {
      this.bot = this.compiled.driveLine ? new Bot(this.compiled.driveLine) : null;
      this.demoCam = { mode: 0, t: 0, pos: new THREE.Vector3() };
    } else {
      this.record = loadRecord(track);
      this.ghost = decodeGhost(this.record);
      this.hud = new Hud(app.uiRoot, { units: settings.units, minimap: settings.minimap });
      this.hud.setTrack(track, this.record?.time);
      this.minimap = new Minimap(this.hud.minimap, trackLines(track), {
        triggers: this.compiled.triggers,
        spawn: this.compiled.spawn?.pos,
      });
      if (isTouchDevice()) app.input.attachTouch(app.uiRoot);
      app.audio.startEngine();
      app.audio.playMusic('race');
      this._onVisibility = () => {
        if (document.hidden && !this.sim.finished) this.pause();
      };
      document.addEventListener('visibilitychange', this._onVisibility);
    }
    this.restart();
  }

  freshStats() {
    return { distance: 0, driveTime: 0, airTime: 0, respawns: 0, checkpoints: 0, topSpeed: 0, longestJump: 0 };
  }

  /** Push accumulated driving stats into the persistent player stats. */
  flushStats(extra = {}) {
    if (this.demo) return;
    const s = this.stat;
    updateStats({
      distance: s.distance,
      driveTime: s.driveTime,
      airTime: s.airTime,
      respawns: s.respawns,
      checkpoints: s.checkpoints,
      topSpeed: s.topSpeed,
      longestJump: s.longestJump,
      ...extra,
    });
    this.stat = this.freshStats();
  }

  /** Let the autopilot drive this race (debug / testing aid: window.__app.mode.enableAutopilot()). */
  enableAutopilot() {
    if (!this.compiled.driveLine) return false;
    this.bot = new Bot(this.compiled.driveLine);
    this.autopilot = true;
    return true;
  }

  restart() {
    if (!this.demo && this.sim.started && !this.sim.finished) this.flushStats({ restarts: 1 });
    this.sim.restart();
    this.effects?.clear();
    this.view.resetCheckpoints();
    this.view.setStartLights('red');
    this.rec.reset();
    this.recordGhostFrame();
    this.acc = 0;
    this.prevPos.copy(this.sim.car.pos);
    this.prevQuat.copy(this.sim.car.quat);
    this.chase.snap(this.sim.car.pos, this.sim.car.quat);
    this.finishOrbit = 0;
    this.ghostHint = 0;
    this.runTopSpeed = 0;
    this.bot?.reset();
    this.closePanel();
    if (this.hud) {
      this.hud.setTime(0);
      this.hud.setLiveDelta(null);
      this.hud.setCheckpoints(0, this.compiled.checkpointCount);
      this.hud.setRespawns(0);
      this.hud.clearSplit();
      this.hud.clearMessage();
      const keys = this.app.input.lastDevice === 'gamepad' ? 'RT' : this.app.input.lastDevice === 'touch' ? '▲' : '↑ / W';
      this.hud.hint(
        this.compiled.finishCount === 0 ? `This track has no finish yet · drive with ${keys}` : `Press <b>${keys}</b> to start`,
      );
    }
    this.app.input.clearActions();
  }

  recordGhostFrame() {
    const input = this.lastInput || { brake: 0 };
    const fwd = this.sim.car.forwardSpeed;
    let flags = 0;
    if (input.brake > 0 && fwd > 0.5) flags |= FLAG_BRAKE;
    if (input.brake > 0 && fwd < -0.3) flags |= FLAG_REVERSE;
    if (this.sim.car.onBoost) flags |= FLAG_BOOST;
    this.rec.push(this.sim.car, flags);
  }

  respawn() {
    if (this.sim.finished) return;
    if (!this.sim.started) {
      this.restart();
      return;
    }
    this.sim.respawn();
    this.stat.respawns++;
    this.hud?.setRespawns(this.sim.respawns);
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
       <div class="panel-sub">${escapeHtml(this.track.name)} · ${formatTime(this.sim.time)}</div>
       <div class="btn-col">
         <button class="btn primary" data-action="resume">Resume</button>
         <button class="btn" data-action="restart">Restart <kbd>T</kbd></button>
         <button class="btn" data-action="camera">Camera: <b>${CAMERA_MODES[this.chase.mode].name}</b> <kbd>C</kbd></button>
         <button class="btn" data-action="ghost">Ghost: <b>${s.ghost ? 'On' : 'Off'}</b> <kbd>G</kbd></button>
         <button class="btn" data-action="sound">Sound: <b>${s.sound ? 'On' : 'Off'}</b> <kbd>M</kbd></button>
         ${this.ghost ? '<button class="btn" data-action="replay">Watch best run</button>' : ''}
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
          else if (a === 'replay') this.watchReplay(this.ghost, this.record.time, 'Personal best');
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
    else this.app.showMenu(this.track.builtin ? 'play' : 'custom');
  }

  watchReplay(ghost, time, label) {
    const track = this.track;
    const opts = { fromEditor: this.fromEditor };
    this.app.watchReplay(track, { ...ghost, time, label }, () => this.app.playTrack(track, opts));
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
    const runData = this.rec.toArray();
    this.lastRun = { data: runData, stride: GHOST_STRIDE, frames: runData.length / GHOST_STRIDE };
    this.flushStats({ racesFinished: 1, personalBests: isPB ? 1 : 0 });
    const topSpeed = this.runTopSpeed || 0;
    const run = { time, date: Date.now(), respawns: sim.respawns, topSpeed };
    const rank = addRun(this.track, run);
    if (isPB) {
      this.record = { time, splits, ghost: floatsToB64(runData), gv: 2, date: Date.now(), topSpeed, respawns: sim.respawns };
      saveRecord(this.track, this.record);
      this.ghost = decodeGhost(this.record);
      this.hud.setBest(time);
    }
    this.app.audio.finish(!!medal);
    this.hud.hint('');
    this.hud.clearSplit();
    this.hud.setLiveDelta(null);

    let deltaHtml = '';
    if (!prev) deltaHtml = '<div class="finish-delta pb">First finish!</div>';
    else if (isPB)
      deltaHtml = `<div class="finish-delta pb">New personal best! <span class="faster">${formatTime(time - prev.time, { sign: true })}</span></div>`;
    else
      deltaHtml = `<div class="finish-delta"><span class="slower">${formatTime(time - prev.time, { sign: true })}</span> vs PB ${formatTime(prev.time)}</div>`;

    let medalHtml = '';
    if (this.track.medals) {
      const best = isPB ? time : prev.time;
      medalHtml = `<div class="finish-medals">${MEDALS.map((m) => {
        const got = best <= this.track.medals[m.key];
        return `<div class="fm ${got ? 'got' : ''}">${medalIcon(m, 16)}<span>${m.label}</span><b>${formatTime(this.track.medals[m.key])}</b></div>`;
      }).join('')}</div>`;
      if (medal && (!prevMedal || MEDALS.indexOf(medal) < MEDALS.indexOf(prevMedal))) {
        medalHtml = `<div class="medal-earned" style="--medal:${medal.color}">${medalIcon(medal, 26)} ${medal.label} medal!</div>` + medalHtml;
      }
    }

    // Sector table: each checkpoint plus the finish, compared with the previous best.
    const marks = [...splits, time];
    const pbMarks = prev?.splits && prev.splits.length === splits.length ? [...prev.splits, prev.time] : null;
    const rows = marks
      .map((t, i) => {
        const sector = t - (i ? marks[i - 1] : 0);
        const pbSector = pbMarks ? pbMarks[i] - (i ? pbMarks[i - 1] : 0) : null;
        const d = pbSector != null ? sector - pbSector : null;
        const label = i === marks.length - 1 ? 'Finish' : `CP ${i + 1}`;
        return `<tr><td>${label}</td><td>${formatTime(t)}</td><td>${formatTime(sector)}</td><td class="${d == null ? '' : d <= 0 ? 'faster' : 'slower'}">${d == null ? '—' : formatTime(d, { sign: true })}</td></tr>`;
      })
      .join('');
    const u = UNITS[this.app.settings.units] || UNITS.kmh;
    const runs = loadRuns(this.track).slice(0, 5);
    const board = runs
      .map(
        (r, i) =>
          `<li class="${r.date === run.date ? 'me' : ''}"><span class="rk">${i + 1}</span><span class="rt">${formatTime(r.time)}</span><span class="rd">${new Date(r.date).toLocaleDateString()}</span></li>`,
      )
      .join('');
    const next = !this.fromEditor && this.app.nextBuiltin(this.track);
    const exitLabel = this.fromEditor ? 'Back to editor' : 'Menu';
    setTimeout(() => {
      if (this.disposed || !this.sim.finished) return;
      this.panel = openPanel(
        this.app.uiRoot,
        `<h2>Finished</h2>
         <div class="panel-sub">${escapeHtml(this.track.name)}</div>
         <div class="finish-grid">
           <div class="finish-main">
             <div class="finish-time">${formatTime(time)}</div>
             ${deltaHtml}
             ${medalHtml}
             <table class="sectors"><thead><tr><th></th><th>Time</th><th>Sector</th><th>vs PB</th></tr></thead><tbody>${rows}</tbody></table>
             <div class="finish-stats">
               <div><span>Top speed</span><b>${Math.round(topSpeed * u.factor)} ${u.label}</b></div>
               <div><span>Respawns</span><b>${sim.respawns}</b></div>
               <div><span>Rank</span><b>${rank ? '#' + rank : '—'}</b></div>
             </div>
           </div>
           <div class="finish-board"><h3>Best runs</h3><ol>${board}</ol></div>
         </div>
         <div class="btn-row">
           <button class="btn primary" data-action="retry">Retry <kbd>R</kbd></button>
           <button class="btn" data-action="replay">Watch replay</button>
           ${next ? '<button class="btn" data-action="next">Next track</button>' : ''}
           <button class="btn" data-action="exit">${exitLabel}</button>
         </div>`,
        {
          className: 'finish-panel wide',
          focus: false,
          onAction: (a) => {
            this.app.audio.click();
            if (a === 'retry') this.restart();
            else if (a === 'replay') this.watchReplay(this.lastRun, time, 'Your run');
            else if (a === 'next') this.app.playTrack(next);
            else if (a === 'exit') this.exit();
          },
        },
      );
    }, 900);
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
    if (sim.started && !sim.finished) {
      if (sim.ticks % GHOST_EVERY === 0) this.recordGhostFrame();
      const st = this.stat;
      st.distance += car.speed * PHYSICS_DT;
      st.driveTime += PHYSICS_DT;
      st.topSpeed = Math.max(st.topSpeed, car.speed);
      this.runTopSpeed = Math.max(this.runTopSpeed || 0, car.speed);
      if (!car.grounded) {
        st.airTime += PHYSICS_DT;
        st.longestJump = Math.max(st.longestJump, car.airTime);
      }
    }
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
      if (e.type === 'start') this.view.setStartLights('green');
      if (e.type === 'checkpoint') this.view.setCheckpoint(e.id, true);
      if (e.type === 'finish') {
        this.view.celebrate();
        this.ts.env.cheer(4);
        setTimeout(() => !this.disposed && this.restart(), 3000);
      }
      return;
    }
    const hud = this.hud;
    switch (e.type) {
      case 'start':
        hud.hint('');
        this.view.setStartLights('green');
        updateStats({ racesStarted: 1, trackPlay: this.track.builtin ? this.track.id : trackKey(this.track) });
        setTimeout(() => !this.disposed && this.sim.started && this.view.setStartLights('off'), 2500);
        break;
      case 'checkpoint': {
        this.view.setCheckpoint(e.id, true);
        const trig = this.compiled.triggers.find((t) => t.kind === 'checkpoint' && t.id === e.id);
        if (trig) this.effects.burst('checkpoint', { x: trig.center[0], y: trig.center[1] - 2, z: trig.center[2] });
        this.app.gfx.pulse(0x9fe8ff, 0.18);
        this.stat.checkpoints++;
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
        this.ts.env.cheer(5);
        this.onFinish();
        break;
      }
    }
  }

  updateDemoCamera(dt, pos, quat, car) {
    const dc = this.demoCam;
    dc.t += dt;
    if (dc.t > 7) {
      dc.t = 0;
      dc.mode = (dc.mode + 1) % 3;
      if (dc.mode === 1) {
        // Trackside camera placed ahead of the car.
        _v.set(0, 0, 1).applyQuaternion(quat);
        const side = new THREE.Vector3(_v.z, 0, -_v.x).normalize().multiplyScalar(Math.random() < 0.5 ? 9 : -9);
        dc.pos.copy(pos).addScaledVector(_v, Math.max(25, car.speed * 2.2)).add(side).add(new THREE.Vector3(0, 2.5, 0));
      }
      this.chase.snap(pos, quat);
    }
    if (dc.mode === 0) this.chase.update(dt, pos, quat, car.speed, car.grounded > 0);
    else if (dc.mode === 1) {
      this.camera.position.copy(dc.pos);
      this.camera.up.set(0, 1, 0);
      this.camera.lookAt(pos);
      const d = dc.pos.distanceTo(pos);
      this.camera.fov = THREE.MathUtils.clamp(2400 / Math.max(10, d), 18, 60);
      this.camera.updateProjectionMatrix();
      if (d > 120) dc.t = 99;
    } else this.chase.updateOrbit(dt * 1.6, pos, 11, 3.5);
  }

  frame(dt) {
    if (!this.demo) this.handleActions();
    const sim = this.sim;
    const car = sim.car;
    const settings = this.app.settings;

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
      const fx = this.effects.update(dt, car, { throttle: input.throttle, brake: input.brake, boost: this.boostLevel, scale: this.ts.particleScale() });
      if (fx.landing) {
        this.chase.addTrauma(Math.min(0.55, fx.landing * 0.035));
        if (!this.demo) this.app.audio.land?.(fx.landing);
      }
      if (car.wallHit > 5) this.chase.addTrauma(Math.min(0.4, car.wallHit * 0.02));
    }

    // Ghost playback.
    const showGhost = !this.demo && settings.ghost && this.ghost;
    this.ghostModel.group.visible = !!showGhost;
    let ghostPos = null;
    if (showGhost) {
      const g = sampleGhost(this.ghost, sim.time, _gp, _gq);
      this.ghostModel.setPose(_gp, _gq);
      this.ghostModel.animateWheels(g.steer, g.speed, dt);
      const d = _gp.distanceTo(this.carModel.group.position);
      this.ghostModel.setOpacity(Math.min(0.38, Math.max(0.08, (d - 1.5) * 0.08)));
      ghostPos = _gp;
    }

    // Camera.
    const pos = this.carModel.group.position;
    const quat = this.carModel.group.quaternion;
    if (this.demo) this.updateDemoCamera(dt, pos, quat, car);
    else if (sim.finished) {
      this.finishOrbit += dt;
      if (this.finishOrbit > 0.6) this.chase.updateOrbit(dt, pos);
      else this.chase.update(dt, pos, quat, car.speed, car.grounded > 0);
    } else this.chase.update(dt, pos, quat, car.speed, car.grounded > 0);
    this.ts.update(dt, pos);

    const speedFx = !this.demo && settings.speedEffects ? car.speed : 0;
    this.speedLines.update(dt, speedFx);
    this.app.gfx.setSpeedEffect(Math.min(1, Math.max(0, (speedFx - 48) / 40)) * 0.7);

    if (this.hud) {
      this.hud.setTime(sim.time);
      this.hud.setSpeed(fwdSpeed, gearState(Math.abs(fwdSpeed)));
      // Live gap to the PB ghost, refreshed ten times a second.
      this.liveTimer -= dt;
      if (this.liveTimer <= 0) {
        this.liveTimer = 0.1;
        if (this.ghost && sim.started && !sim.finished && sim.time > 0.5) {
          const m = ghostTimeAt(this.ghost, car.pos, this.ghostHint);
          this.ghostHint = m.index;
          this.hud.setLiveDelta(m.dist < 25 ? sim.time - m.time : null);
        } else if (!sim.finished) this.hud.setLiveDelta(null);
      }
      if (settings.minimap) this.minimap.draw({ pos: car.pos, fwd: car.fwd, color: settings.carColor }, ghostPos, sim.collected);
    }

    // Audio.
    if (!this.demo) {
      const audio = this.app.audio;
      audio.updateEngine({
        speed: Math.abs(fwdSpeed),
        throttle: this.paused ? 0 : input.throttle || 0,
        grounded: car.grounded > 0,
        slip: car.slip,
        boost: this.boostLevel,
        scrape: car.scrape,
        surface: car.wheels.find((w) => w.contact)?.surface ?? 0,
      });
      this.impactCooldown -= dt;
      if (car.wallHit > 6 && this.impactCooldown <= 0) {
        audio.impact(car.wallHit);
        this.impactCooldown = 0.25;
      }
    }

    this.ts.render(dt);
  }

  resize(aspect) {
    this.ts.resize(aspect);
  }

  dispose() {
    this.disposed = true;
    if (!this.demo && this.sim.started && !this.sim.finished) this.flushStats();
    this.closePanel();
    this.hud?.dispose();
    if (!this.demo) {
      this.app.audio.stopEngine();
      document.removeEventListener('visibilitychange', this._onVisibility);
    }
    this.app.input.touchEl?.remove();
    this.app.input.touchEl = null;
    document.body.classList.remove('touch');
    this.speedLines.dispose();
    this.app.gfx.setSpeedEffect(0);
    this.ts.dispose();
  }
}
