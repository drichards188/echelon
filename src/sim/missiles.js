import * as THREE from 'three';
import { MISSILES } from './systems.js';
import { clamp, turnToward, G } from './flight.js';

// Interceptors as a game: a speed profile (boost, then slowing), a turn-rate limit, steering toward
// where the target will be, and a hit decided by a game table once the missile gets close. Missiles
// guided by their unit fly blind when that unit loses the track; the S-400's and the Tor's rounds rise
// out of the canister or cell for a moment before they light and turn.

const _aim = new THREE.Vector3();
const _d = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

let nextId = 1;
export const resetMissileIds = () => (nextId = 1);

export function makeMissile(kind, unit, target, pos, dir, part = 0, slot = 0) {
  const def = MISSILES[kind];
  const m = {
    id: nextId++, kind, unitId: unit.id, targetId: target.id, pos: pos.clone(), vel: new THREE.Vector3(), fwd: dir.clone().normalize(),
    speed: def.eject ? def.ejectSpeed ?? 28 : 60, phase: def.eject ? 'eject' : 'boost', motor: !def.eject, age: 0, alive: true,
    aim: target.pos.clone(), guided: true, blind: 0, prevDist: Infinity, homing: false, part, slot, bank: 0,
  };
  m.vel.copy(m.fwd).multiplyScalar(m.speed);
  return m;
}

export class Interceptors {
  constructor(sim) {
    this.sim = sim;
  }

  update(dt) {
    const sim = this.sim;
    for (const m of sim.missiles) {
      if (!m.alive) continue;
      const def = MISSILES[m.kind];
      m.age += dt;
      const t = sim.threatById.get(m.targetId);
      const unit = sim.unitById.get(m.unitId);

      // phases and speed
      if (m.phase === 'eject') {
        m.speed = Math.max(m.speed - G * dt, 8);
        if (m.age >= def.eject) {
          m.phase = 'boost';
          m.motor = true;
          sim.events.ignite?.(m);
        }
      } else if (m.phase === 'boost') {
        m.speed = Math.min(def.speed, m.speed + def.accel * dt);
        if (m.age - def.eject >= def.burn) {
          m.phase = 'coast';
          m.motor = false;
        }
      } else m.speed -= def.decel * dt;

      // guidance: the unit's track, the missile's own seeker near the end, or nothing
      let info = null;
      if (t && t.alive) {
        const dist = m.pos.distanceTo(t.pos);
        if (def.seeker && dist < def.seeker) m.homing = true;
        if (m.homing || (unit && unit.alive && sim.guides(unit, t, m))) info = t;
      }
      if (info) {
        m.blind = 0;
        m.guided = true;
        // lead: where the target will be when the missile gets there
        const dist = m.pos.distanceTo(info.pos);
        const tgo = clamp(dist / Math.max(m.speed + 150, 200), 0, 25);
        m.aim.copy(info.pos).addScaledVector(info.vel, tgo);
        // loft long shots a little so they fly in thinner air (a look, not a model)
        if (def.loft) m.aim.y += Math.min(dist * 0.12, 9000) * clamp((dist - 15000) / 30000, 0, 1);
      } else {
        m.guided = false;
        m.blind += dt;
      }

      if (m.phase === 'eject') {
        m.fwd.lerp(UP, 0.2).normalize();
      } else {
        _d.subVectors(m.aim, m.pos).normalize();
        // fresh out of the canister they pitch over hard; slow missiles turn less
        const pitchOver = def.eject && m.age < def.eject + 2.5 ? 1.4 : 0;
        const turn = Math.max(pitchOver, def.turn * clamp((m.speed / def.speed) * 1.5, 0.3, 1));
        if (m.guided || m.blind < 0.3) turnToward(m.fwd, _d, turn, dt);
      }
      m.vel.copy(m.fwd).multiplyScalar(m.speed);
      m.pos.addScaledVector(m.vel, dt);

      // the hit is resolved at the closest approach inside the fuze distance
      if (t && t.alive) {
        // closest approach during this step, relative motion treated as linear (fast closings
        // cover tens of metres a step)
        const rx1 = t.pos.x - m.pos.x, ry1 = t.pos.y - m.pos.y, rz1 = t.pos.z - m.pos.z;
        const ex = (t.vel.x - m.vel.x) * dt, ey = (t.vel.y - m.vel.y) * dt, ez = (t.vel.z - m.vel.z) * dt;
        const rx0 = rx1 - ex, ry0 = ry1 - ey, rz0 = rz1 - ez;
        const el = ex * ex + ey * ey + ez * ez;
        const f = el > 1e-9 ? clamp(-(rx0 * ex + ry0 * ey + rz0 * ez) / el, 0, 1) : 1;
        const d = Math.hypot(rx0 + ex * f, ry0 + ey * f, rz0 + ez * f);
        const close = d < def.fuze;
        const passing = d > m.prevDist && m.prevDist < def.fuze * 3;
        if (close || passing) {
          sim.resolveHit(m, t, close ? 1 : 0.35);
          continue;
        }
        m.prevDist = d;
      }
      // self-destruct: lost too long, too slow, out of time, target gone, or into the ground
      const gone = !t || !t.alive;
      if ((def.command && m.blind > 3) || (m.phase === 'coast' && m.speed < def.minSpeed) || m.age > def.life || (gone && m.age > 1.5)) {
        sim.selfDestruct(m);
        continue;
      }
      if (m.phase !== 'eject' && m.pos.y < sim.heightAt(m.pos.x, m.pos.z)) {
        m.pos.y = sim.heightAt(m.pos.x, m.pos.z);
        sim.selfDestruct(m, true);
      }
    }
  }
}

/**
 * Can a missile of `kind` fired from `from` reach a target at track position `pos` moving at `vel`?
 * A game envelope: predicted intercept inside range and altitude band, and reachable in its flight time.
 */
export function inEnvelope(sim, kind, from, pos, vel) {
  const def = MISSILES[kind];
  const avg = def.speed * 0.7;
  let t = from.distanceTo(pos) / avg;
  _aim.copy(pos).addScaledVector(vel, t);
  t = from.distanceTo(_aim) / avg;
  _aim.copy(pos).addScaledVector(vel, t);
  const r = from.distanceTo(_aim);
  if (r > def.range || r < def.minRange || t > def.life * 0.9) return false;
  const agl = _aim.y - sim.heightAt(_aim.x, _aim.z);
  return agl >= def.minAlt * 0.5 && _aim.y <= def.maxAlt;
}
