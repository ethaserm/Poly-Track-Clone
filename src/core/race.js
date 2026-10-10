import { Quaternion, Vector3 } from 'three';
import { PHYSICS_DT } from './constants.js';
import { CarPhysics } from './physics.js';
import { insideTrigger } from './track.js';

const Y_AXIS = new Vector3(0, 1, 0);

/**
 * Deterministic race session shared by the game and the headless tests:
 * physics stepping, timer, checkpoints, respawns and finish detection.
 */
export class RaceSim {
  constructor(compiled) {
    this.compiled = compiled;
    this.car = new CarPhysics(compiled.world);
    const sp = compiled.spawn || { pos: [0, 1, 0], dir: [0, 0, 1] };
    this.spawnPos = new Vector3(...sp.pos);
    this.spawnQuat = new Quaternion().setFromAxisAngle(Y_AXIS, Math.atan2(sp.dir[0], sp.dir[2]));
    this.restart();
  }

  restart() {
    this.car.reset(this.spawnPos, this.spawnQuat);
    this.ticks = 0;
    this.started = false;
    this.finished = false;
    this.finishTicks = 0;
    this.collected = new Set();
    this.splits = []; // ticks at each checkpoint collection, in order
    this.lastCheckpoint = null;
    this.respawns = 0;
    this.events = [];
  }

  respawn() {
    if (this.finished) return;
    if (!this.lastCheckpoint) {
      // No checkpoint yet: back to the start line without restarting the clock.
      this.car.reset(this.spawnPos, this.spawnQuat);
    } else {
      const s = this.lastCheckpoint;
      this.car.reset(s.pos, s.quat, s.vel);
    }
    this.respawns++;
  }

  get time() {
    return (this.finished ? this.finishTicks : this.ticks) * PHYSICS_DT;
  }

  /** Advance one physics tick. Returns events produced during the tick. */
  tick(input) {
    const events = (this.events = []);
    if (!this.started && !this.finished) {
      if (input.throttle > 0 || input.brake > 0 || Math.abs(input.steer) > 0) {
        this.started = true;
        events.push({ type: 'start' });
      }
    }
    const drive = this.started && !this.finished ? input : { throttle: 0, brake: this.finished ? 0.4 : 0, steer: 0 };
    this.car.step(drive, PHYSICS_DT);
    if (this.started && !this.finished) {
      this.ticks++;
      const { x, y, z } = this.car.pos;
      for (const trig of this.compiled.triggers) {
        if (!insideTrigger(trig, x, y, z)) continue;
        if (trig.kind === 'checkpoint' && !this.collected.has(trig.id)) {
          this.collected.add(trig.id);
          this.splits.push(this.ticks);
          this.lastCheckpoint = this.car.snapshot();
          events.push({ type: 'checkpoint', id: trig.id, ticks: this.ticks, index: this.splits.length - 1 });
        } else if (trig.kind === 'finish') {
          if (this.collected.size >= this.compiled.checkpointCount) {
            this.finished = true;
            this.finishTicks = this.ticks;
            events.push({ type: 'finish', ticks: this.ticks });
            break;
          } else if (!this._warned) {
            this._warned = true;
            events.push({ type: 'missing', remaining: this.compiled.checkpointCount - this.collected.size });
          }
        }
      }
      if (this._warned && !this.compiled.triggers.some((t) => t.kind === 'finish' && insideTrigger(t, x, y, z))) {
        this._warned = false;
      }
    }
    return events;
  }
}
