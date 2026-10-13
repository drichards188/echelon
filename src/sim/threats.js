import * as THREE from 'three';
import { THREATS } from './systems.js';
import { G, clamp, fly, levelToward, fromBearingVec } from './flight.js';
import { Planes } from './planes.js';

// Threat behaviour as scripted game paths: high flyers that launch standoff weapons and turn back,
// low terrain-hugging cruise missiles on dogleg routes, slow drone swarms, helicopters that pop up from
// behind cover, and a ballistic arc. Every enemy weapon in flight is a threat too, so it can be shot down.
// The WW2 era's aircraft, bombs, rockets and Window (THREATS `plane`, `ghost`) fly in sim/planes.js.

const _d = new THREE.Vector3();
const _p = new THREE.Vector3();

let nextId = 1;
export const resetIds = () => (nextId = 1);

export function makeThreat(type, pos, dir, extra = {}) {
  const def = THREATS[type];
  const t = {
    id: nextId++, type, pos: pos.clone(), fwd: dir.clone().normalize(), vel: new THREE.Vector3(), speed: extra.speed ?? def.speed,
    bank: 0, hp: def.hp, maxHp: def.hp, alive: true, falling: false, dead: false, size: def.size, rcs: def.size, ir: def.ir,
    radius: def.radius, target: null, phase: 'ingress', age: 0, route: [], wp: 0, agl: 40, alt: 0, role: null, weapons: 0,
    launchT: 0, parent: 0, aim: new THREE.Vector3(), lost: false, dmgBy: new Map(), lastHit: null, group: 0, spin: 0,
    ...extra,
  };
  t.vel.copy(t.fwd).multiplyScalar(t.speed);
  // never hit by shells or bursts (falling bombs, rockets, chaff)
  if (def.ghost) t.ghost = true;
  return t;
}

export class ThreatAI {
  constructor(sim) {
    this.sim = sim;
    this.planes = new Planes(sim);
  }

  // ---------------------------------------------------------------- spawning
  /**
   * spawn a group. g: { type, count, bearing (deg), range (m), alt, agl, role, weapons, target, spread (deg),
   * spacing (m), group }. target: 'assets' | 'radar' | 'short' | 'units' | 'any'.
   */
  spawnGroup(g) {
    if (THREATS[g.type]?.plane) return this.planes.spawnGroup(g);
    const sim = this.sim;
    const rng = sim.rng;
    const out = [];
    for (let i = 0; i < g.count; i++) {
      const b = g.bearing + (rng() - 0.5) * (g.spread ?? 6);
      const r = g.range + (rng() - 0.5) * (g.spacing ?? 3000);
      const target = sim.pickTarget(g.target ?? 'assets');
      if (!target) continue;
      const start = fromBearingVec(b, r, new THREE.Vector3());
      start.y = sim.heightAt(start.x, start.z);
      const t = this.spawnOne(g.type, start, target, g, i);
      if (t) out.push(t);
    }
    return out;
  }

  spawnOne(type, start, target, g = {}, i = 0) {
    const sim = this.sim;
    const rng = sim.rng;
    const dir = _d.subVectors(target.pos, start).setY(0).normalize();
    let t;
    switch (type) {
      case 'fighter':
      case 'decoy': {
        const alt = (g.alt ?? (type === 'decoy' ? 6000 : 8000)) + (rng() - 0.5) * 800;
        start.y = alt;
        t = makeThreat(type, start, dir, { target, alt, role: g.role ?? null, weapons: g.weapons ?? 0, group: g.group ?? 0, release: g.release ?? (g.role === 'sead' ? 75000 : 50000) });
        t.home = start.clone();
        t.launchT = 2 + rng() * 3;
        break;
      }
      case 'cruise':
      case 'drone': {
        const agl = type === 'cruise' ? 30 + rng() * 20 : (g.agl ?? 150) + rng() * 120;
        start.y += agl;
        t = makeThreat(type, start, dir, { target, agl, group: g.group ?? 0 });
        // a dogleg route: offset midpoint, then a point on the final approach, then the target
        const side = (rng() < 0.5 ? -1 : 1) * (0.12 + rng() * 0.2);
        const dist = start.distanceTo(target.pos);
        const mid = new THREE.Vector3().lerpVectors(start, target.pos, 0.45);
        mid.x += -dir.z * dist * side;
        mid.z += dir.x * dist * side;
        const fin = _p.subVectors(mid, target.pos).setY(0).normalize().multiplyScalar(type === 'cruise' ? 6000 : 2500).add(target.pos).clone();
        t.route = [mid, fin];
        t.phase = 'route';
        t.weave = rng() * 10;
        break;
      }
      case 'helo': {
        start.y += 25;
        t = makeThreat(type, start, dir, { target, agl: 25, weapons: g.weapons ?? 4, group: g.group ?? 0 });
        t.hold = this.holdPoint(start, target, g.standoff ?? 7000);
        t.home = start.clone();
        t.phase = 'transit';
        break;
      }
      case 'tbm': {
        // a ballistic arc from the ground at `start` to the target, apogee `alt`
        const apogee = g.alt ?? 38000;
        const vy = Math.sqrt(2 * G * apogee);
        const T = (2 * vy) / G;
        const h = _p.subVectors(target.pos, start).setY(0);
        const vh = h.length() / T;
        h.normalize();
        // start already climbing so it enters radar cover in flight
        const t0 = T * 0.12;
        const pos = start.clone().addScaledVector(h, vh * t0);
        pos.y = start.y + vy * t0 - 0.5 * G * t0 * t0;
        const vel = new THREE.Vector3(h.x * vh, vy - G * t0, h.z * vh);
        t = makeThreat(type, pos, vel.clone().normalize(), { target, speed: vel.length(), group: g.group ?? 0 });
        t.vel.copy(vel);
        t.phase = 'ballistic';
        break;
      }
      default:
        return THREATS[type]?.plane ? this.planes.spawnOne(type, start, target, g, i) : null;
    }
    sim.addThreat(t);
    return t;
  }

  // a hold point `standoff` from the target, toward the start, preferring one the target cannot see
  holdPoint(start, target, standoff) {
    const sim = this.sim;
    const base = Math.atan2(start.x - target.pos.x, -(start.z - target.pos.z));
    let best = null;
    for (let k = 0; k < 9; k++) {
      const a = base + (k - 4) * 0.12;
      const p = new THREE.Vector3(target.pos.x + Math.sin(a) * standoff, 0, target.pos.z - Math.cos(a) * standoff);
      p.y = sim.heightAt(p.x, p.z) + 25;
      const hidden = !sim.los(target.pos.x, target.pos.y + 5, target.pos.z, p.x, p.y, p.z);
      if (!best || (hidden && !best.hidden)) best = { p, hidden };
      if (hidden && k >= 4) break;
    }
    return best.p;
  }

  // weapons released by aircraft
  launchWeapon(type, from, target) {
    const sim = this.sim;
    const dir = _d.subVectors(target.pos, from.pos).normalize();
    const t = makeThreat(type, from.pos, type === 'glide' ? dir.setY(Math.min(dir.y, -0.02)).normalize() : dir, {
      target, parent: from.id, group: from.group, speed: type === 'atgm' ? 60 : from.speed,
    });
    t.pos.addScaledVector(t.fwd, from.radius + 2);
    t.aim.copy(target.pos);
    t.phase = 'flight';
    sim.addThreat(t);
    sim.threatLaunched(t, from);
    return t;
  }

  // ---------------------------------------------------------------- update
  update(dt) {
    const sim = this.sim;
    for (const t of sim.threats) {
      if (t.dead) continue;
      t.age += dt;
      if (!t.alive) {
        this.fall(t, dt);
        continue;
      }
      // the target may have been destroyed; aircraft and missiles carry on to where it was
      switch (t.type) {
        case 'fighter': this.fighter(t, dt); break;
        case 'decoy': this.decoy(t, dt); break;
        case 'cruise':
        case 'drone': this.lowFlyer(t, dt); break;
        case 'helo': this.helo(t, dt); break;
        case 'arm': this.arm(t, dt); break;
        case 'glide':
        case 'atgm': this.guided(t, dt); break;
        case 'tbm': this.ballistic(t, dt); break;
        default: this.planes.update(t, dt);
      }
      // (chaff never reaches the ground: it is gone first)
      if (t.dead || !t.alive || t.ghost && THREATS[t.type].chaff) continue;
      const gh = sim.heightAt(t.pos.x, t.pos.z);
      if (t.pos.y < gh) {
        t.pos.y = gh;
        sim.arrive(t);
      }
    }
  }

  fighter(t, dt) {
    const sim = this.sim;
    t.launchT -= dt;
    if (t.phase === 'ingress') {
      const base = t.target.pos;
      fly(t, levelToward(t.pos, base.x, base.z, t.alt), dt, 0.12, 260);
      const dBase = Math.hypot(t.pos.x, t.pos.z);
      // radar hunters fire once they are `release` from the base, at the battalion's radar if it is on
      if (t.role === 'sead' && t.weapons > 0 && t.launchT <= 0 && dBase < t.release) {
        const victim = sim.pickEmitter(t.pos, t.release + 30000);
        if (victim) {
          this.launchWeapon('arm', t, victim);
          t.weapons--;
          t.launchT = 3 + sim.rng() * 2;
        } else t.launchT = 1;
      }
      if (t.role === 'glide' && t.weapons > 0 && t.launchT <= 0 && t.pos.distanceTo(base) < t.release) {
        this.launchWeapon('glide', t, sim.pickTarget('assets') ?? t.target);
        t.weapons--;
        t.launchT = 2.5;
      }
      if (t.weapons <= 0 || dBase < 45000) t.phase = 'egress';
    } else {
      fly(t, levelToward(t.pos, t.home.x * 1.6, t.home.z * 1.6, t.alt + 1500), dt, 0.15, 290);
      if (Math.hypot(t.pos.x, t.pos.z) > 165000) sim.remove(t);
    }
  }

  decoy(t, dt) {
    const tp = t.target.pos;
    const d = Math.hypot(t.pos.x - tp.x, t.pos.z - tp.z);
    if (d > 9000) fly(t, levelToward(t.pos, tp.x, tp.z, t.alt), dt, 0.15, 230);
    else {
      // orbit the target until the fuel runs out
      const a = Math.atan2(t.pos.x - tp.x, t.pos.z - tp.z) + 0.6;
      fly(t, levelToward(t.pos, tp.x + Math.sin(a) * 8000, tp.z + Math.cos(a) * 8000, t.alt), dt, 0.2, 230);
    }
    if (t.age > 360) this.sim.destroy(t, null, true);
  }

  lowFlyer(t, dt) {
    const sim = this.sim;
    const cruise = t.type === 'cruise';
    const tp = t.target.pos;
    const dTarget = t.pos.distanceTo(tp);
    let goal = t.wp < t.route.length ? t.route[t.wp] : tp;
    if (t.wp < t.route.length && Math.hypot(t.pos.x - goal.x, t.pos.z - goal.z) < (cruise ? 1500 : 500)) t.wp++;
    goal = t.wp < t.route.length ? t.route[t.wp] : tp;

    if (cruise && t.wp >= t.route.length && dTarget < 4500) t.phase = dTarget < 2600 ? 'dive' : 'popup';
    if (!cruise && dTarget < 1400) t.phase = 'dive';

    if (t.phase === 'dive') {
      _d.subVectors(tp, t.pos).normalize();
      fly(t, _d, dt, cruise ? 0.9 : 0.6, t.speed * (cruise ? 1.0 : 1.15));
    } else {
      // terrain following: hold the clearance over the highest ground a few seconds ahead
      let ground = sim.heightAt(t.pos.x, t.pos.z);
      for (const k of [1.5, 3, 5]) ground = Math.max(ground, sim.heightAt(t.pos.x + t.vel.x * k, t.pos.z + t.vel.z * k));
      const agl = t.phase === 'popup' ? 280 : t.agl + (cruise ? 0 : Math.sin(t.age * 0.3 + t.weave) * 40);
      const lat = cruise ? 0 : Math.sin(t.age * 0.5 + t.weave) * 0.25;
      const dir = levelToward(t.pos, goal.x, goal.z, ground + agl, _d, cruise ? 0.25 : 0.3, 300);
      if (lat) {
        const x = dir.x, z = dir.z;
        dir.x = x - z * lat;
        dir.z = z + x * lat;
        dir.normalize();
      }
      fly(t, dir, dt, cruise ? 0.35 : 0.5, THREATS[t.type].speed);
    }
    if (dTarget < Math.max(20, t.speed * dt * 1.5)) sim.arrive(t);
  }

  helo(t, dt) {
    const sim = this.sim;
    const ground = sim.heightAt(t.pos.x, t.pos.z);
    const tp = t.target.pos;
    let speedT = 70, goal = t.hold, aglT = 25;
    t.phaseT = (t.phaseT ?? 0) + dt;
    switch (t.phase) {
      case 'transit':
        if (Math.hypot(t.pos.x - goal.x, t.pos.z - goal.z) < 300) {
          t.phase = 'popup';
          t.phaseT = 0;
        }
        break;
      case 'popup':
        speedT = 0;
        aglT = 95;
        if (t.pos.y - ground > 85) {
          t.phase = 'fire';
          t.phaseT = 0;
          t.launchT = 1.5;
        }
        break;
      case 'fire':
        speedT = 0;
        aglT = 95;
        t.launchT -= dt;
        if (t.launchT <= 0 && t.weapons > 0) {
          if (sim.los(t.pos.x, t.pos.y, t.pos.z, tp.x, tp.y + 3, tp.z)) {
            this.launchWeapon('atgm', t, t.target);
            t.weapons--;
            t.launchT = 3.5;
          } else aglT = 150;
        }
        // stays up while its missiles fly, then masks
        if (t.phaseT > 14 || (t.weapons % 2 === 0 && t.launchT < 0 && t.phaseT > 9)) {
          t.phase = t.weapons > 0 ? 'mask' : 'egress';
          t.phaseT = 0;
        }
        break;
      case 'mask':
        speedT = 0;
        if (t.phaseT > 12) {
          t.phase = 'popup';
          t.phaseT = 0;
          t.target = sim.pickTarget('short') ?? t.target;
        }
        break;
      case 'egress':
        goal = t.home;
        speedT = 75;
        if (Math.hypot(t.pos.x, t.pos.z) > 30000 || t.pos.distanceTo(t.home) < 400) sim.remove(t);
        break;
    }
    // helicopters fly horizontally and climb directly
    const look = speedT > 0 ? goal : tp;
    _d.set(look.x - t.pos.x, 0, look.z - t.pos.z).normalize();
    const y = t.pos.y;
    fly(t, _d, dt, 0.5, speedT, 0.5);
    t.pos.y = y + clamp(ground + aglT - y, -7 * dt, 7 * dt);
    t.vel.y = (t.pos.y - y) / Math.max(dt, 1e-4);
    t.spin += dt * 30;
  }

  arm(t, dt) {
    const sim = this.sim;
    const unit = sim.unitById.get(t.target.id);
    // the vehicle it was fired at (a Buk: the search radar or one TELAR) must keep emitting
    const emitting = unit && unit.alive && sim.emitting(unit, t.target.part ?? -1);
    if (emitting) {
      t.aim.copy(t.target.pos);
      t.lost = false;
    } else if (!t.lost) {
      // a game rule: switching off before the last few km leaves the missile with a stale aim point
      t.lost = true;
      const far = t.pos.distanceTo(t.aim) > 8000;
      const r = far ? 150 + sim.rng() * 500 : 25 + sim.rng() * 90;
      const a = sim.rng() * Math.PI * 2;
      t.aim.x += Math.sin(a) * r;
      t.aim.z += Math.cos(a) * r;
      t.aim.y = sim.heightAt(t.aim.x, t.aim.z);
    }
    _d.subVectors(t.aim, t.pos).normalize();
    fly(t, _d, dt, 0.55, 700, 0.5);
    if (t.pos.distanceTo(t.aim) < 15) sim.arrive(t);
  }

  guided(t, dt) {
    const sim = this.sim;
    // an ATGM needs its helicopter to keep guiding it
    const parent = t.parent ? sim.threatById.get(t.parent) : null;
    const guided = t.type !== 'atgm' || (parent && parent.alive);
    if (guided) t.aim.copy(t.target.pos);
    _d.subVectors(t.aim, t.pos).normalize();
    const speed = THREATS[t.type].speed;
    fly(t, _d, dt, guided ? (t.type === 'atgm' ? 0.6 : 0.25) : 0, speed, t.type === 'atgm' ? 2 : 0.3);
    if (t.pos.distanceTo(t.aim) < 10) sim.arrive(t);
    if (t.age > 400) sim.destroy(t, null, true);
  }

  ballistic(t, dt) {
    t.vel.y -= G * dt;
    t.pos.addScaledVector(t.vel, dt);
    t.speed = t.vel.length();
    t.fwd.copy(t.vel).divideScalar(t.speed);
  }

  // killed aircraft fall burning until they hit the ground
  fall(t, dt) {
    const sim = this.sim;
    if (!t.falling) return;
    t.vel.y -= G * dt;
    t.vel.multiplyScalar(1 - dt * 0.05);
    t.pos.addScaledVector(t.vel, dt);
    t.speed = t.vel.length();
    if (t.speed > 1) t.fwd.copy(t.vel).divideScalar(t.speed);
    t.bank += dt * (t.type === 'helo' ? 3 : 1.4);
    t.spin += dt * 10;
    const gh = sim.heightAt(t.pos.x, t.pos.z);
    if (t.pos.y <= gh) {
      t.pos.y = gh;
      sim.wreckImpact(t);
    }
  }
}
