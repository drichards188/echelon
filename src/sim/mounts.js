import * as THREE from 'three';
import { SYSTEMS, THREATS } from './systems.js';
import { clamp, wrapPi, TAU } from './flight.js';
import { solveLead, reachOf, SHELLS, OWNER } from '../ballistics.js';
import { newTrack } from './sensors.js';
import { THREAT_AXIS } from '../deploy.js';

// Gun units of several mounts (SYSTEMS `mounts`; the WW2 era's flak, DESIGN.md "WW2 era"):
//   'platoon'  a Zug of three light or medium guns. Each gun is a part with its own turret and gun state
//              and fights on its own from its own pit: its crew holds the target in the gun's sight (by eye,
//              so a visual range by the target's size and line of sight from the pit), works out the lead
//              with the game's own fire control (FireUnits.gunEstimate, ballistics.js solveLead), lays the
//              gun by hand at its slew rates, and fires along the bore with the crew's wandering error and
//              the shells' dispersion; the feed (clips laid on a loading table, magazines changed by the
//              loaders) sets the practical rate. In auto every gun takes its own target, spread across the
//              guns unless `u.concentrate`; in manual all take the selection and fire while the trigger is
//              held, each once it is laid on its own solution (OUT OF RANGE holds it, as on the modern guns).
//   'battery'  a heavy battery (its guns 'gun', its own 2 cm 'close', which fight as a platoon's guns, in auto
//              in every mode but hold). Its predictor (the Kommandogeraet 40) holds one target, by its own
//              telescopes and rangefinder or with the range from the Wuerzburg, and its solution settles
//              over `predictor.settle` s; the guns are laid from it (each from its own pit, the parallax
//              taken out), loaded by hand, and fire together by salvo with time fuzes set for where the
//              target will be (Ballistics.fire `fuze`; the bursts in Sim.flakBurst). Window in the radar's
//              beam spoils the radar range; the optical range is immune but worse. Barrage fire
//              (`barrage`): every gun fires as fast as it is loaded into a fixed box on a formation's
//              course, from fixed data (no predictor needed).
// The solution's error is a game rule, not a model of the predictor: an offset at the target that wanders,
// its size set by the range source and the slant range and shrinking as the solution settles.

const _v = new THREE.Vector3();
const _d = new THREE.Vector3();
const _s = new THREE.Vector3();
const _from = new THREE.Vector3();
const _c = new THREE.Vector3();
const _r = new THREE.Vector3();
const _u = new THREE.Vector3();
const _p = new THREE.Vector3();
const _q = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

const bearingOfDir = (d) => (Math.atan2(d.x, -d.z) + TAU) % TAU;
const elevOfDir = (d) => Math.asin(clamp(d.y / (d.length() || 1), -1, 1));
const turretAz = (unit, bearing) => wrapPi(-bearing - unit.heading);
// roughly normal, sigma 1, from the battle's seeded random numbers
const gauss = (rng) => (rng() + rng() + rng() - 1.5) * 2;

// gun.hold reasons (as units.js's)
const OUT_OF_REACH = 'out of reach';
// the fire control's smoothed velocity lags the target by about this (s; units.js GUN_LAG)
const GUN_LAG = 0.6;
// the AI fires only while the bore is within this many metres of the lead at its range (units.js GUN_LAID)
const LAID_M = 4, LAID_MIN = 0.0025, LAID_MAX = 0.02;
// a heavy gun is laid when its pointers are covered: within this of the predictor's data (rad)
const LAID_HEAVY = 0.006;
// the classes the gun crews take (not the reporting service's plain echoes, nor Window)
const PLANE_CLS = new Set(['bomber', 'fighter', 'recon']);

// The per-gun state the render and the consoles read (DESIGN.md "WW2 era").
function newGun(def) {
  const f = def.feed;
  const g = {
    shell: def.shell, rounds: def.rounds, max: def.rounds,
    target: null, firing: false, burst: 0, cool: 0,
    aim: new THREE.Vector3(), aimOk: false, locked: false, lockT: 0, lockId: null, tof: 0, laid: false, hold: null,
    est: { id: null, n: 0, vel: new THREE.Vector3(), acc: new THREE.Vector3(), prev: new THREE.Vector3() },
    // the crew's wandering aim error (rad, right and up of the line of sight) and where it wanders to
    err: { x: 0, y: 0, tx: 0, ty: 0, t: 0 },
    // shots fired, s since the last one (-1 none yet: the recoil and the muzzle flash)
    shots: 0, recoil: -1, pickT: 0, eventT: 0,
    // feed: magazines (one per barrel: rounds in it, s left on its change, the rounds coming in), the
    // loading table (rounds on it, s left on the clip the loader is laying, its rounds), a hand-loaded
    // breech (a round in it; s left until the next is in; the fuze set on it)
    barrels: null, table: 0, load: 0, clip: 0, loaded: false, fuze: 0,
  };
  if (f.mag) {
    g.barrels = Array.from({ length: def.barrels }, () => ({ mag: f.mag, change: 0, next: 0, acc: 0 }));
    g.rounds -= f.mag * def.barrels;
  } else {
    g.barrels = [{ mag: 0, change: 0, next: 0, acc: 0 }];
    if (f.table) {
      g.table = f.table;
      g.rounds -= f.table;
    } else if (f.hand) {
      g.loaded = true;
      g.rounds -= 1;
      // the predictor's data at this gun (the follow-the-pointer dials): azimuth relative to the hull and
      // elevation (rad), fuze (s)
      g.order = { az: 0, el: 0.25, fuze: 0 };
    }
  }
  return g;
}

// rounds at a gun: in the pit and in its feed
const roundsOf = (g) => g.rounds + g.table + g.clip + (g.loaded ? 1 : 0) + g.barrels.reduce((a, b) => a + b.mag + b.next, 0);

/** Sets up a mounts unit made by units.js createUnits: every gun's turret and state, the predictor. */
export function initMounts(u) {
  const sys = SYSTEMS[u.kind];
  for (const p of u.parts) {
    const def = sys.guns[p.kind];
    if (def) {
      p.turret = { az: 0, el: 0.25 };
      p.gun = newGun(def);
    } else if (p.role === 'predictor' || p.role === 'radar') p.turret = { az: 0, el: 0.25 };
  }
  const guns = u.parts.filter((p) => p.gun);
  const first = guns.find((p) => p.role === 'gun') ?? guns[0];
  // the unit's summary of its guns (the modern consoles' and the bookkeeping's `weapons.gun`): totals, and
  // the fire control of the gun the camera rides (u.nextGun) or the predictor's
  u.weapons.gun = {
    shell: first.gun.shell, rounds: 0, max: 0, firing: false, heat: 0, overheated: false, trigger: false,
    target: null, aim: new THREE.Vector3(), aimOk: false, locked: false, tof: 0, laid: false, hold: null,
  };
  for (const p of guns) u.weapons.gun.max += roundsOf(p.gun);
  u.weapons.gun.rounds = u.weapons.gun.max;
  u.weapons.weapon = 'gun';
  u.turret = u.parts[0].turret;
  // auto: the guns spread over the targets (false) or all take the platoon's (true)
  u.concentrate = false;
  // the gun the camera rides: the one that fires next (sim.nextLauncher)
  u.nextGun = 0;
  u.nextGunT = 0;
  if (sys.radar) u.radar.track = true;
  if (sys.predictor) {
    // The predictor's state (the console reads it): target (track id), state 'idle' | 'acquiring' (pointing
    // at it, not yet held) | 'tracking' (held, the solution settling) | 'solution' (good enough to fire) |
    // 'barrage'; ranging: the range source the crew wants ('radar' the Wuerzburg, 'optical' the 4 m
    // rangefinder), source: the one in use (null: neither has the target); quality 0..1, t: s held; range
    // (slant m), fuze and tof (s), aim (the point the guns are laid on: the predicted burst with gravity's
    // aim-off), point (the predicted burst), valid (the burst inside the guns' reach), window (0..1, Window in
    // the radar's beam), hold (why it cannot fire, or null), salvos fired, lastSalvo (sim time), barrage
    // ({ center, along, until } or null).
    u.predictor = {
      target: null, state: 'idle', ranging: 'radar', source: null, quality: 0, t: 0, lostT: 0, range: 0, fuze: 0, tof: 0,
      aim: new THREE.Vector3(), point: new THREE.Vector3(), valid: false, window: 0, hold: null, salvos: 0, lastSalvo: -99,
      barrage: null, readyT: -1, fireNow: false, pickT: 0, jamT: 0,
      est: { id: null, n: 0, vel: new THREE.Vector3(), acc: new THREE.Vector3(), prev: new THREE.Vector3() }, locked: false,
      err: new THREE.Vector3(), errN: new THREE.Vector3(), errT: 0, sigma: 0, warmId: null,
    };
  }
}

export class Mounts {
  constructor(sim, units) {
    this.sim = sim;
    this.fu = units;
  }

  // ---------------------------------------------------------------- queries
  def(u, i) {
    return SYSTEMS[u.kind].guns[u.parts[i].kind];
  }

  // where a gun's bore is (its trunnion), into `out`
  mountPos(u, i, out) {
    const p = u.parts[i];
    return out.copy(p.pos).setY(p.pos.y + (this.def(u, i)?.height ?? 4));
  }

  // the bore of a part's turret
  boreDir(u, tu, out) {
    const h = u.heading + tu.az, e = tu.el;
    return out.set(-Math.sin(h) * Math.cos(e), Math.sin(e), -Math.cos(h) * Math.cos(e));
  }

  // line of sight from part i (its eye height) to a threat, cached a few steps (FireUnits.losTo's cache)
  losFrom(u, t, i, eye) {
    const sim = this.sim;
    const c = t.losCache ?? (t.losCache = {});
    const key = `m${u.id}/${i}`;
    const e = c[key];
    if (e && sim.time - e.t < 0.3) return e.v;
    const p = u.parts[i].pos;
    const v = sim.los(p.x, p.y + eye, p.z, t.pos.x, t.pos.y, t.pos.z);
    c[key] = { t: sim.time, v };
    return v;
  }

  // how far an eye sees an aircraft of this type: `range` for a visual size of 1, poor visibility shortening it
  eyeRange(range, t) {
    const vis = THREATS[t.type].vis ?? 0;
    return vis > 0 ? range * (0.3 + 0.7 * vis) * (0.4 + 0.6 * (this.sim.visibility ?? 1)) : 0;
  }

  // does gun i's crew hold the threat in its sight?
  gunSees(u, i, t) {
    const p = u.parts[i];
    if (!p.alive || !t?.alive) return false;
    const def = this.def(u, i);
    const r = this.eyeRange(def.sight, t);
    if (!r || this.mountPos(u, i, _s).distanceTo(t.pos) > r) return false;
    return this.losFrom(u, t, i, def.height + 1);
  }

  // the predictor's channel: its telescopes (optical) or the Wuerzburg (radar); which one sees the threat
  predictorSees(u, t) {
    const sys = SYSTEMS[u.kind];
    const P = sys.predictor;
    const kg = u.parts.findIndex((p) => p.role === 'predictor');
    const wz = u.parts.findIndex((p) => p.role === 'radar');
    let opt = false, rad = false;
    if (kg >= 0 && u.parts[kg].alive && THREATS[t.type].vis) {
      const d = u.parts[kg].pos.distanceTo(t.pos);
      opt = d < Math.min(P.range, this.eyeRange(P.range * 1.6, t)) && this.losFrom(u, t, kg, 4);
    }
    if (wz >= 0 && u.parts[wz].alive && u.radar.track) {
      const d = u.parts[wz].pos.distanceTo(t.pos);
      rad = d < sys.radar.range * (0.35 + 0.65 * THREATS[t.type].size) && this.losFrom(u, t, wz, 4);
    }
    return { opt, rad };
  }

  // can the unit's channels see this threat right now (Sensors refreshes their tracks)? A gun holding it, or
  // the predictor on it
  sees(u, t) {
    for (let i = 0; i < u.parts.length; i++) if (u.parts[i].gun?.target === t.id && this.gunSees(u, i, t)) return true;
    const pr = u.predictor;
    if (pr?.target === t.id) {
      const s = this.predictorSees(u, t);
      return s.opt || s.rad;
    }
    return false;
  }

  channelTargets(u) {
    const ids = [];
    for (const p of u.parts) if (p.gun?.target != null && !ids.includes(p.gun.target)) ids.push(p.gun.target);
    if (u.predictor?.target != null && !ids.includes(u.predictor.target)) ids.push(u.predictor.target);
    return ids;
  }

  // the gun the camera rides: { part, slot: -1 } (sim.nextLauncher)
  nextGun(u) {
    return { part: u.nextGun, slot: -1 };
  }

  // ---------------------------------------------------------------- commands
  command(u, name, a = {}) {
    const sim = this.sim;
    const sys = SYSTEMS[u.kind];
    const pr = u.predictor;
    const g = u.weapons.gun;
    switch (name) {
      case 'mode':
        if (!['auto', 'manual', 'hold'].includes(a.mode)) return false;
        u.mode = a.mode;
        if (a.mode === 'hold') {
          g.trigger = false;
          for (const p of u.parts) if (p.gun) p.gun.target = null;
          if (pr) {
            pr.target = null;
            pr.barrage = null;
          }
        }
        return true;
      case 'select':
        // the selection is the platoon's target (in manual every gun takes it) or the predictor's
        u.selected = a.trackId ?? null;
        return true;
      case 'trigger':
        g.trigger = !!a.down;
        return true;
      case 'fire':
        // the heavy battery in manual: one salvo now from the guns that are loaded and laid
        if (!pr || u.mode !== 'manual') return false;
        pr.fireNow = true;
        return true;
      case 'cease': {
        const id = a.trackId ?? u.selected;
        g.trigger = false;
        for (const p of u.parts) if (p.gun?.target === id) p.gun.target = null;
        if (pr) {
          if (pr.target === id) pr.target = null;
          pr.barrage = null;
        }
        return true;
      }
      case 'radar':
      case 'track': {
        // the Wuerzburg D
        if (!sys.radar) return false;
        const wz = u.parts.find((p) => p.role === 'radar');
        if (a.on && !wz?.alive) {
          sim.say(u, 'unable, the Wuerzburg is knocked out', 'warn');
          return false;
        }
        u.radar.track = !!a.on;
        u.silent.track = !a.on;
        sim.say(u, a.on ? 'Wuerzburg on' : 'Wuerzburg off', 'info', 'radar' + u.id);
        return true;
      }
      case 'ranging':
        // the predictor's range: from the Wuerzburg ('radar') or its own 4 m rangefinder ('optical')
        if (!pr) return false;
        pr.ranging = a.source === 'optical' ? 'optical' : 'radar';
        sim.say(u, pr.ranging === 'optical' ? 'predictor ranging on its rangefinder' : 'predictor ranging on the Wuerzburg', 'info', 'rng' + u.id);
        return true;
      case 'barrage':
        if (!pr) return false;
        if (!a.on) {
          pr.barrage = null;
          return true;
        }
        return this.layBarrage(u, a.trackId ?? u.selected, a.point, true);
      case 'concentrate':
        if (pr) return false;
        u.concentrate = !!a.on;
        return true;
    }
    return false;
  }

  // Barrage fire (Sperrfeuer): a box on the formation's course, a few seconds ahead of where the shells
  // can meet it, at its height; fixed data, so it needs no predictor and no range. `point`: a world point
  // instead (the box along the threat axis's line through it).
  layBarrage(u, trackId, point, player = false) {
    const sim = this.sim;
    const pr = u.predictor;
    const tr = trackId != null ? this.fu.trackOf(u, trackId) : null;
    const centre = this.centre(u, _c);
    if (!centre) return false;
    // fired between `from` and `until` (sim time): with a formation, so the bursts come while it is in the box
    const box = { center: new THREE.Vector3(), along: new THREE.Vector3(), from: sim.time, until: sim.time + 60 };
    let arrive = -1;
    if (tr) {
      // where the formation will be once the shells can meet it, a few seconds on
      box.along.copy(tr.vel).setY(0);
      if (box.along.lengthSq() < 1) box.along.subVectors(centre, tr.pos).setY(0);
      box.along.normalize();
      let t = 12;
      for (let k = 0; k < 4; k++) {
        _p.copy(tr.pos).addScaledVector(tr.vel, t);
        const tof = solveLead(SHELLS['88mm'], centre, _p, _v.set(0, 0, 0), _q, null, 0.05, 8, 3);
        if (tof < 0) {
          t += 10;
          continue;
        }
        t = tof + 8;
      }
      box.center.copy(tr.pos).addScaledVector(tr.vel, t);
      arrive = t;
    } else if (point) {
      // inbound along the threat axis
      const b = (THREAT_AXIS * Math.PI) / 180;
      box.center.copy(point);
      box.along.set(-Math.sin(b), 0, Math.cos(b));
    } else {
      if (player) sim.say(u, 'unable, no track for the barrage', 'warn');
      return false;
    }
    const tofC = solveLead(SHELLS['88mm'], centre, box.center, _v.set(0, 0, 0), _q, null, 0.05, 8, 3);
    if (tofC < 0) {
      if (player) sim.say(u, 'unable, the barrage is out of reach', 'warn');
      return false;
    }
    if (arrive >= 0) {
      // the bursts from a few seconds before the formation reaches the box until it should be through it
      box.from = sim.time + Math.max(0, arrive - tofC - 5);
      box.until = sim.time + arrive - tofC + SYSTEMS[u.kind].predictor.box[0] * 2 / Math.max(50, tr.speed) + 5;
    }
    pr.barrage = box;
    const brg = String(Math.round((bearingOfDir(_d.subVectors(box.center, centre)) * 180) / Math.PI)).padStart(3, '0');
    sim.say(u, `barrage laid, bearing ${brg}, height ${Math.round(box.center.y / 100) * 100} m`, 'info');
    return true;
  }

  // the middle of the standing heavy guns (their trunnions): where the predictor's solution is worked from
  centre(u, out) {
    let n = 0;
    out.set(0, 0, 0);
    u.parts.forEach((p, i) => {
      if (!p.alive || p.role !== 'gun') return;
      out.add(this.mountPos(u, i, _s));
      n++;
    });
    return n ? out.divideScalar(n) : null;
  }

  // ---------------------------------------------------------------- per step
  update(u, dt) {
    const sim = this.sim;
    const sys = SYSTEMS[u.kind];
    // the crew notices each track some time after it first shows up (as FireUnits.crew)
    for (const tr of u.tracks) if (!u.seen.has(tr.id)) u.seen.set(tr.id, sim.time);
    for (const id of u.seen.keys()) if (!u.trackMap.has(id) && !u.linkMap.has(id)) u.seen.delete(id);
    if (u.selected != null && !sim.threatById.get(u.selected)?.alive) u.selected = null;
    if (sys.predictor) this.battery(u, dt);
    u.parts.forEach((p, i) => {
      if (!p.gun) return;
      if (p.gun.recoil >= 0) p.gun.recoil += dt;
      if (p.role !== 'gun' || !sys.predictor) this.lightGun(u, i, dt);
    });
    this.summary(u, dt);
  }

  // ---------------------------------------------------------------- light and medium guns
  lightGun(u, i, dt) {
    const sim = this.sim;
    const p = u.parts[i];
    const g = p.gun;
    const def = this.def(u, i);
    if (!p.alive) {
      g.firing = false;
      g.target = null;
      g.aimOk = false;
      g.locked = false;
      g.laid = false;
      g.hold = null;
      return;
    }
    this.feed(u, i, dt);
    // the target: the player's selection in manual (the heavy battery's own 2 cm stay with their crews, in
    // auto unless the battery holds fire), the crew's pick otherwise
    const hold = u.mode === 'hold';
    const manual = u.mode === 'manual' && p.role !== 'close';
    if (hold) g.target = null;
    else if (manual) g.target = u.selected;
    else if ((g.pickT -= dt) <= 0) {
      g.pickT = 0.25;
      g.target = this.pick(u, i);
    }
    const t = g.target != null ? sim.threatById.get(g.target) : null;
    const own = t?.alive ? u.trackMap.get(g.target) : null;
    const from = this.mountPos(u, i, _from);
    g.locked = !!own?.n && sim.time - own.lastSeen < 0.6 && this.gunSees(u, i, t);
    this.fu.gunEstimate(g, own, dt);
    g.lockT = g.locked && g.lockId === g.target ? g.lockT + dt : 0;
    g.lockId = g.target;
    g.aimOk = false;
    g.tof = 0;
    const kind = SHELLS[def.shell];
    if (g.locked && from.distanceTo(own.pos) < reachOf(kind) * 1.5) {
      _v.copy(g.est.vel).addScaledVector(g.est.acc, GUN_LAG);
      const tof = solveLead(kind, from, own.pos, _v, g.aim, g.est.acc);
      g.aimOk = tof >= 0;
      g.tof = Math.max(tof, 0);
    }
    const tr = this.fu.trackOf(u, g.target);
    const dist = tr ? from.distanceTo(tr.pos) : 0;
    g.hold = g.target == null ? null : !t?.alive ? 'target lost' : !g.locked ? (dist > reachOf(kind) ? OUT_OF_REACH : 'no lock') : !g.aimOk ? OUT_OF_REACH : null;
    // the crew's aim wanders; it shrinks once they have watched their tracer a while
    this.wander(g, def.err * (0.55 + 0.45 * Math.exp(-g.lockT / 4)) * (sim.difficulty.aim ?? 1), dt);
    // lay on the lead (with that error), else on the target's track to bring it into the sight
    let aim = null;
    if (g.aimOk) {
      aim = _d.subVectors(g.aim, from);
      const len = aim.length();
      _r.crossVectors(aim, UP).normalize();
      _u.crossVectors(_r, aim).normalize();
      aim.addScaledVector(_r, g.err.x * len).addScaledVector(_u, g.err.y * len);
    } else if (tr) aim = _d.subVectors(tr.pos, from);
    if (aim) this.slew(u, p.turret, aim, def, dt);
    const bore = this.boreDir(u, p.turret, _s);
    g.laid = !!aim && g.aimOk && bore.dot(aim) > aim.length() * Math.cos(clamp(LAID_M / aim.length(), LAID_MIN, LAID_MAX));
    // fire: the crew in bursts while on the lead inside its opening range; the player's trigger wherever
    // the solution is, unless the shells cannot reach
    let want = false;
    if (!hold && !manual) {
      const agl = tr ? tr.pos.y - sim.heightAt(tr.pos.x, tr.pos.z) : Infinity;
      const on = g.laid && dist < def.range && agl < def.maxAlt && g.lockT >= def.settle;
      const k = on ? clamp(1.5 - dist / def.range, 0.5, 1) : 1;
      if (g.burst <= 0 && (g.cool -= dt) <= 0 && on) g.burst = def.burst * k;
      if (g.burst > 0 && on) {
        want = true;
        if ((g.burst -= dt) <= 0) g.cool = def.cool / k;
      }
    } else if (manual && u.weapons.gun.trigger && g.target != null) {
      // the trigger is the platoon leader's permission: each layer fires once his gun is on the lead
      want = g.hold !== OUT_OF_REACH && g.hold !== 'target lost' && g.laid;
    }
    // a strafing pass across the pit: the crew ducks for a moment (Sim.strafe)
    if (sim.time < (g.cover ?? 0)) want = false;
    g.firing = false;
    if (want) this.shoot(u, i, t, dt);
  }

  // Fire what the feed allows this step: every barrel with rounds in its magazine (or the loading table)
  // at its cyclic rate, along the bore with the shell's dispersion grown with the range to the lead.
  shoot(u, i, t, dt) {
    const sim = this.sim;
    const p = u.parts[i];
    const g = p.gun;
    const def = this.def(u, i);
    const shell = SHELLS[def.shell];
    const from = this.mountPos(u, i, _from);
    const km = (g.aimOk ? _v.subVectors(g.aim, from).length() : 0) / 1000;
    const spread = shell.spread * (def.spread ?? 1) * 2 * (1 + (shell.grow ?? 0) * km);
    const dmg = (def.dmg ?? 1) * (sim.difficulty?.hit ?? 1);
    const owner = u.mode === 'manual' ? OWNER.PLAYER : OWNER.AI;
    let n = 0;
    g.barrels.forEach((b, k) => {
      const have = () => (def.feed.table ? g.table : b.mag);
      if (b.change > 0 || have() <= 0) return;
      b.acc += def.rate * dt;
      while (b.acc >= 1 && have() > 0) {
        b.acc -= 1;
        if (def.feed.table) g.table--;
        else b.mag--;
        // the Vierling's guns sit a little apart on the cradle
        const side = def.barrels > 1 ? (k % 2 ? 0.28 : -0.28) : 0;
        const h = u.heading + p.turret.az;
        this.boreDir(u, p.turret, _d);
        _v.copy(from).addScaledVector(_d, def.muzzle).add(_q.set(Math.cos(h) * side, k < 2 ? 0.15 : -0.15, -Math.sin(h) * side));
        _d.x += (sim.rng() - 0.5) * spread;
        _d.y += (sim.rng() - 0.5) * spread;
        _d.z += (sim.rng() - 0.5) * spread;
        sim.ballistics.fire(def.shell, _v, _d.normalize(), owner, u.index, { dmg, rng: sim.rng });
        n++;
      }
    });
    if (!n) return;
    g.firing = true;
    g.shots += n;
    g.recoil = 0;
    sim.stats.fired[def.shell] = (sim.stats.fired[def.shell] ?? 0) + n;
    // the aircraft knows it is being shot at (its aim suffers, sim/planes.js)
    if (t?.alive && g.aimOk) t.underFire = sim.time;
    if ((g.eventT -= dt) <= 0) {
      g.eventT = 0.05;
      sim.events.muzzle?.(u, i, _v.copy(from).addScaledVector(this.boreDir(u, p.turret, _d), def.muzzle), _d, def.shell);
    }
  }

  // The loaders: an empty magazine is changed (each loader one at a time; between targets they top up those
  // below half), a clip is laid on the loading table whenever there is room for it (continuous fire as long
  // as the loader keeps up).
  feed(u, i, dt) {
    const sim = this.sim;
    const g = u.parts[i].gun;
    const f = this.def(u, i).feed;
    if (f.mag) {
      let busy = 0;
      g.barrels.forEach((b, k) => {
        if (b.change <= 0) return;
        if ((b.change -= dt) > 0) {
          busy++;
          return;
        }
        b.change = 0;
        b.mag += b.next;
        b.next = 0;
        sim.events.feed?.(u, i, 'magazine', k);
      });
      for (const b of g.barrels) {
        if (busy >= f.loaders || g.rounds <= 0) break;
        if (b.change > 0 || !(b.mag === 0 || (g.target == null && b.mag < f.mag / 2))) continue;
        // a part-empty magazine's rounds go back to the pit
        g.rounds += b.mag;
        b.mag = 0;
        b.next = Math.min(f.mag, g.rounds);
        g.rounds -= b.next;
        b.change = f.change;
        busy++;
      }
    } else if (f.table) {
      if (g.load > 0 && (g.load -= dt) <= 0) {
        g.load = 0;
        g.table += g.clip;
        g.clip = 0;
        sim.events.feed?.(u, i, 'clip', 0);
      }
      if (g.load <= 0 && g.rounds > 0 && g.table + f.clip <= f.table) {
        g.clip = Math.min(f.clip, g.rounds);
        g.rounds -= g.clip;
        g.load = f.load * (1 + (sim.rng() - 0.5) * 2 * (f.loadVar ?? 0));
      }
    }
  }

  // the crew's aim error wanders toward a new random offset every couple of seconds (rad, sigma `size`)
  wander(g, size, dt) {
    const rng = this.sim.rng;
    const e = g.err;
    if ((e.t -= dt) <= 0) {
      e.t = 1.5 + rng() * 1.5;
      e.tx = gauss(rng);
      e.ty = gauss(rng);
    }
    const k = 1 - Math.exp(-dt / 1.2);
    e.x += (e.tx * size - e.x) * k;
    e.y += (e.ty * size - e.y) * k;
  }

  // turn a gun (or the predictor's tube) toward world direction `d` at its hand-laid rates
  slew(u, tu, d, def, dt) {
    const az = turretAz(u, bearingOfDir(d));
    const el = clamp(elevOfDir(d), def.minEl ?? -0.05, def.maxEl ?? 1.48);
    tu.az = wrapPi(tu.az + clamp(wrapPi(az - tu.az), -def.turnAz * dt, def.turnAz * dt));
    tu.el += clamp(el - tu.el, -def.turnEl * dt, def.turnEl * dt);
  }

  // The crew's pick for gun i: the player's selection when it is one they would take, else the most urgent
  // aircraft it can see and reach, the one coming for this position first; another gun of the platoon on a
  // target counts against it (the guns spread over the targets) unless the platoon concentrates, and the
  // gun's own target is kept a little longer.
  pick(u, i) {
    const sim = this.sim;
    const def = this.def(u, i);
    const g = u.parts[i].gun;
    const from = this.mountPos(u, i, _from);
    // (a battery's selection is its predictor's: its own 2 cm guns work on their own)
    const sel = u.parts[i].role === 'close' ? null : u.selected;
    let best = null, bs = Infinity;
    for (const tr of u.tracks) {
      if (!PLANE_CLS.has(tr.cls)) continue;
      if (sim.time - (u.seen.get(tr.id) ?? sim.time) < SYSTEMS[u.kind].react && tr.id !== sel) continue;
      const t = sim.threatById.get(tr.id);
      if (!t?.alive) continue;
      const d = from.distanceTo(tr.pos);
      if (d > def.range * 1.3) continue;
      if (tr.pos.y - sim.heightAt(tr.pos.x, tr.pos.z) > def.maxAlt * 1.1) continue;
      if (!this.gunSees(u, i, t)) continue;
      // closing: how soon it is nearest to this gun
      _v.subVectors(tr.pos, from);
      const closing = -_v.dot(tr.vel) / Math.max(d, 1);
      let s = d - Math.max(0, closing) * 4;
      if (t.target?.id === u.id && t.attack) s -= 1500;
      if (tr.id === g.target) s -= 300;
      // the player's selection comes first for a gun that would take it (not so far that the guns all double
      // up on it: they still spread over the targets unless the platoon concentrates)
      if (tr.id === sel) s -= 500;
      if (!u.concentrate && u.parts.some((q, j) => j !== i && q.alive && q.gun?.target === tr.id)) s += 600;
      if (s < bs) {
        bs = s;
        best = tr;
      }
    }
    return best?.id ?? null;
  }

  // ---------------------------------------------------------------- the heavy battery
  battery(u, dt) {
    const sim = this.sim;
    const sys = SYSTEMS[u.kind];
    const P = sys.predictor;
    const pr = u.predictor;
    const kgI = u.parts.findIndex((p) => p.role === 'predictor');
    const wzI = u.parts.findIndex((p) => p.role === 'radar');
    const kgUp = kgI >= 0 && u.parts[kgI].alive;
    if (wzI >= 0 && !u.parts[wzI].alive) u.radar.track = false;
    const heavy = [];
    u.parts.forEach((p, i) => p.role === 'gun' && heavy.push(i));
    for (const i of heavy) this.loadHeavy(u, i, dt);
    const centre = this.centre(u, _c);
    if (!centre) {
      pr.state = 'idle';
      return;
    }
    // the barrage runs out (or the crew re-lays it)
    if (pr.barrage && sim.time > pr.barrage.until) pr.barrage = null;
    // the target: the player's selection in manual, the crew's pick in auto (without the predictor the
    // crew falls back on barrage fire at the bombers)
    if (u.mode === 'hold') {
      pr.target = null;
      pr.barrage = null;
    } else if (u.mode === 'manual') pr.target = u.selected;
    else if ((pr.pickT -= dt) <= 0) {
      pr.pickT = 0.5;
      pr.target = this.batteryPick(u, centre);
      if (!kgUp && !pr.barrage && pr.target != null) this.layBarrage(u, pr.target);
    }
    const t = pr.target != null ? sim.threatById.get(pr.target) : null;
    const own = t?.alive ? u.trackMap.get(pr.target) : null;
    const s = t?.alive ? this.predictorSees(u, t) : { opt: false, rad: false };
    pr.source = pr.ranging === 'radar' && s.rad ? 'radar' : s.opt ? 'optical' : s.rad ? 'radar' : null;
    const held = kgUp && !!own?.n && sim.time - own.lastSeen < 0.6 && pr.source != null;
    // the solution settles while the predictor holds the target; a short break (a few seconds) costs a little
    if (pr.est.id !== pr.target) {
      pr.t = 0;
      pr.jamT = 0;
    }
    if (held) {
      pr.t += dt;
      pr.lostT = 0;
    } else if ((pr.lostT += dt) > 3) pr.t = 0;
    else pr.t = Math.max(0, pr.t - dt * 2);
    pr.locked = held;
    this.fu.gunEstimate(pr, held ? own : null, dt);
    if (!held) {
      pr.est.id = pr.target;
      pr.warmId = null;
    }
    // Window in the Wuerzburg's beam round the target, inside its range gate, spoils the radar range
    let jam = 0;
    if (held && pr.source === 'radar') jam = this.chaffAt(u, wzI, own, dt);
    pr.window += (jam - pr.window) * Math.min(1, dt * 1.5);
    pr.quality = held ? 1 - Math.exp(-pr.t / (P.settle * (pr.source === 'optical' ? 1.3 : 1))) : 0;
    // the AI crew notices that Window spoils its range after a while and goes over to the rangefinder
    if (u.mode === 'auto' && pr.source === 'radar' && pr.window > 0.4) {
      if ((pr.jamT += dt) > 60 && s.opt) {
        pr.ranging = 'optical';
        sim.say(u, 'Window on the Wuerzburg, ranging by the rangefinder', 'info', 'rng' + u.id);
      }
    } else pr.jamT = Math.max(0, pr.jamT - dt);
    // the solution: the predicted burst for the battery's middle, flown through the game's own ballistics
    pr.valid = false;
    if (held) {
      pr.range = centre.distanceTo(own.pos);
      this.solutionError(u, dt);
      _p.copy(own.pos).add(pr.err);
      // followed from step to step: the last solution is the start of the next (a fresh target: the closed form)
      const warm = pr.warmId === pr.target;
      const tof = solveLead(SHELLS['88mm'], centre, _p, pr.est.vel, pr.aim, null, 0.05, warm ? 3 : 8, 3, warm);
      pr.warmId = tof >= 0 ? pr.target : null;
      pr.tof = Math.max(0, tof);
      pr.fuze = pr.tof;
      pr.point.copy(_p).addScaledVector(pr.est.vel, pr.tof);
      const el = elevOfDir(_d.subVectors(pr.aim, centre));
      // the trackers' limits: speed and angular rate (a low, fast target is beyond them)
      const rate = _v.crossVectors(_s.subVectors(own.pos, centre), pr.est.vel).length() / Math.max(pr.range * pr.range, 1);
      pr.valid = tof >= P.minFuze && el <= sys.guns.flak88.maxEl && pr.range > P.minRange && pr.est.vel.length() < P.maxSpeed && rate < P.rate;
    }
    pr.state = pr.barrage ? 'barrage' : !t?.alive ? 'idle' : !held ? 'acquiring' : pr.valid && pr.quality >= 0.55 ? 'solution' : 'tracking';
    pr.hold = !kgUp ? 'no predictor' : pr.target == null ? 'no target' : !held ? 'not held' : !pr.valid ? OUT_OF_REACH : pr.quality < 0.3 ? 'settling' : null;
    // laying: every gun on the predictor's data (the parallax taken out: each is laid at the aim point from
    // its own pit), or on the barrage box; with neither they hold where they are
    for (const i of heavy) {
      const p = u.parts[i];
      const g = p.gun;
      if (!p.alive) {
        g.laid = false;
        continue;
      }
      const from = this.mountPos(u, i, _from);
      let aim = null;
      if (pr.barrage) aim = _d.subVectors(pr.barrage.center, from);
      else if (held) aim = _d.subVectors(pr.aim, from);
      this.wander(g, this.def(u, i).err, dt);
      if (aim) {
        // the director's pointers at this gun, before its layers' own error
        g.order.az = turretAz(u, bearingOfDir(aim));
        g.order.el = elevOfDir(aim);
        _r.crossVectors(aim, UP).normalize();
        _u.crossVectors(_r, aim).normalize();
        aim.normalize().addScaledVector(_r, g.err.x).addScaledVector(_u, g.err.y);
        this.slew(u, p.turret, aim, this.def(u, i), dt);
        g.laid = this.boreDir(u, p.turret, _s).dot(aim.normalize()) > Math.cos(pr.barrage ? 0.03 : LAID_HEAVY);
      } else g.laid = false;
      g.target = pr.barrage ? null : pr.target;
      g.aimOk = held && pr.valid;
      if (g.aimOk) g.aim.copy(pr.aim);
      g.tof = pr.tof;
      g.fuze = held ? pr.fuze * (pr.aim.distanceTo(from) / Math.max(1, pr.aim.distanceTo(centre))) : g.fuze;
      if (held) g.order.fuze = g.fuze;
      g.hold = pr.hold ?? (!g.loaded ? 'loading' : !g.laid ? 'laying' : null);
      g.firing = false;
    }
    // the predictor's tube and the Wuerzburg's dish follow the target
    if (t?.alive) {
      for (const k of [kgI, wzI]) {
        if (k < 0 || !u.parts[k].alive) continue;
        _d.subVectors(t.pos, u.parts[k].pos);
        const tu = u.parts[k].turret;
        tu.az = turretAz(u, bearingOfDir(_d));
        tu.el = elevOfDir(_d);
      }
    }
    if (pr.barrage) return this.barrageFire(u, heavy, dt);
    // salvo fire: in auto once the solution has settled, in manual while the trigger is held (or one salvo on
    // `fire`) from the moment it holds the target; the battery fires together when `salvo` guns are ready,
    // or the first ready one has waited `wait` s
    const want = held && pr.valid && (u.mode === 'auto' ? pr.quality >= 0.55 : u.mode === 'manual' && (u.weapons.gun.trigger || pr.fireNow));
    const ready = heavy.filter((i) => u.parts[i].alive && u.parts[i].gun.loaded && u.parts[i].gun.laid && !(sim.time < (u.parts[i].gun.cover ?? 0)));
    if (!want || !ready.length) {
      pr.readyT = -1;
      if (!want) pr.fireNow = false;
      return;
    }
    if (pr.readyT < 0) pr.readyT = sim.time;
    const standing = heavy.filter((i) => u.parts[i].alive).length;
    if (!pr.fireNow && ready.length < Math.min(P.salvo, standing) && sim.time - pr.readyT < P.wait) return;
    pr.fireNow = false;
    pr.readyT = -1;
    for (const i of ready) this.fireHeavy(u, i, u.parts[i].gun.fuze, t);
    pr.salvos++;
    pr.lastSalvo = sim.time;
    sim.events.salvo?.(u, ready.length, pr.fuze);
  }

  // the hand loading drill: from the shot to the next round in the breech, its fuze set from the setter
  loadHeavy(u, i, dt) {
    const p = u.parts[i];
    const g = p.gun;
    if (!p.alive || g.loaded || g.rounds <= 0) return;
    if ((g.load -= dt) > 0) return;
    g.load = 0;
    g.loaded = true;
    g.rounds--;
    this.sim.events.feed?.(u, i, 'round', 0);
  }

  // one heavy round: along the gun's bore (laid on the data, with its own error) and the shell's dispersion,
  // the fuze the setter put on it (its own small error)
  fireHeavy(u, i, fuze, t = null, dir = null) {
    const sim = this.sim;
    const p = u.parts[i];
    const g = p.gun;
    const def = this.def(u, i);
    const shell = SHELLS[def.shell];
    const from = this.mountPos(u, i, _from);
    if (dir) _d.copy(dir);
    else this.boreDir(u, p.turret, _d);
    _v.copy(from).addScaledVector(_d, def.muzzle);
    const spread = shell.spread * 2;
    _d.x += (sim.rng() - 0.5) * spread;
    _d.y += (sim.rng() - 0.5) * spread;
    _d.z += (sim.rng() - 0.5) * spread;
    _d.normalize();
    const f = Math.max(shell.burst ? 1.5 : 0, fuze + gauss(sim.rng) * 0.04);
    sim.ballistics.fire(def.shell, _v, _d, u.mode === 'manual' ? OWNER.PLAYER : OWNER.AI, u.index, { dmg: sim.difficulty?.hit ?? 1, rng: sim.rng, fuze: f });
    g.loaded = false;
    g.load = def.feed.load * (1 + (sim.rng() - 0.5) * 2 * (def.feed.loadVar ?? 0));
    g.fuze = f;
    g.firing = true;
    g.shots++;
    g.recoil = 0;
    sim.stats.fired[def.shell] = (sim.stats.fired[def.shell] ?? 0) + 1;
    sim.events.muzzle?.(u, i, _v, _d, def.shell);
  }

  // Barrage: each gun fires as soon as it is loaded and laid on the box, at a point anywhere in it, its fuze
  // for that point (fixed data: no predictor)
  barrageFire(u, heavy, dt) {
    const sim = this.sim;
    const pr = u.predictor;
    const B = SYSTEMS[u.kind].predictor.box;
    const b = pr.barrage;
    if (u.mode === 'hold' || (u.mode === 'manual' && !u.weapons.gun.trigger && !pr.fireNow)) return;
    if (sim.time < b.from) return;
    const across = _r.crossVectors(b.along, UP).normalize();
    let n = 0;
    for (const i of heavy) {
      const g = u.parts[i].gun;
      if (!u.parts[i].alive || !g.loaded || !g.laid || sim.time < (g.cover ?? 0)) continue;
      const rng = sim.rng;
      _p.copy(b.center).addScaledVector(b.along, (rng() * 2 - 1) * B[0]).addScaledVector(across, (rng() * 2 - 1) * B[1]);
      _p.y += (rng() * 2 - 1) * B[2];
      const from = this.mountPos(u, i, _from);
      const tof = solveLead(SHELLS['88mm'], from, _p, _v.set(0, 0, 0), _q, null, 0.05, 8, 3);
      if (tof < 0) continue;
      this.fireHeavy(u, i, tof, null, _d.subVectors(_q, from).normalize());
      n++;
    }
    pr.fireNow = false;
    if (n) {
      pr.salvos++;
      pr.lastSalvo = sim.time;
      sim.events.salvo?.(u, n, 0);
    }
  }

  // The solution's error at the target (a game rule): an offset that wanders toward a new random one every
  // couple of seconds, of size a + b * slant range for the range source (refs/ww2/battery: the Wuerzburg
  // about 25 m in range, the rangefinder's spot readings worse), larger while the solution settles, with
  // Window's addition on a radar range; the AI crew's larger, and all of it scaled by the difficulty's `aim`.
  solutionError(u, dt) {
    const sim = this.sim;
    const pr = u.predictor;
    const P = SYSTEMS[u.kind].predictor;
    const [a, b] = P.err[pr.source === 'optical' ? 'optical' : 'radar'];
    let sigma = (a + b * pr.range) * (1 + 1.5 * (1 - pr.quality));
    if (pr.source === 'radar') sigma += pr.window * P.err.window;
    sigma *= (u.mode === 'auto' ? 1.3 : 1) * (sim.difficulty.heavyAim ?? sim.difficulty.aim ?? 1);
    pr.sigma = sigma;
    if ((pr.errT -= dt) <= 0) {
      pr.errT = 1.5 + sim.rng() * 1.5;
      pr.errN.set(gauss(sim.rng), gauss(sim.rng) * 0.7, gauss(sim.rng));
    }
    pr.err.lerp(_q.copy(pr.errN).multiplyScalar(sigma), 1 - Math.exp(-dt / 1.2));
  }

  // how much Window is in the Wuerzburg's beam round the target and inside its range gate (0..1); the
  // chaff it picks up there also shows as echoes in the battery's tracks
  chaffAt(u, wzI, own, dt) {
    const sim = this.sim;
    const R = SYSTEMS[u.kind].radar;
    const wz = u.parts[wzI].pos;
    _v.subVectors(own.pos, wz);
    const range = _v.length();
    _v.divideScalar(range || 1);
    let n = 0;
    for (const t of sim.threats) {
      if (!t.alive || !THREATS[t.type].chaff) continue;
      _s.subVectors(t.pos, wz);
      const d = _s.length();
      if (_s.dot(_v) < d * Math.cos(R.beam)) continue;
      if (Math.abs(d - range) < R.gate) n++;
      // an echo in the beam: a track in the battery's table
      let tr = u.trackMap.get(t.id);
      if (!tr) u.trackMap.set(t.id, (tr = newTrack(t.id, sim.time)));
      if (!tr.n || sim.time - tr.lastSeen > 1) sim.sensors.measure(u, tr, t, sim.time, 0.8);
    }
    return Math.min(1, n * 0.35);
  }

  // The battery crew's pick: the player's selection when it is one the crew would take, else the nearest
  // aircraft at height it can follow and reach, bombers first; it keeps its target while it can (all guns on
  // one aircraft, salvo after salvo).
  batteryPick(u, centre) {
    const sim = this.sim;
    const sys = SYSTEMS[u.kind];
    const P = sys.predictor;
    const pr = u.predictor;
    const ok = (tr) => {
      if (!PLANE_CLS.has(tr.cls)) return false;
      const agl = tr.pos.y - sim.heightAt(tr.pos.x, tr.pos.z);
      if (agl < 700 || tr.speed > P.maxSpeed) return false;
      const d = centre.distanceTo(tr.pos);
      if (d > P.range) return false;
      // a target going away beyond the guns' reach is let go
      _v.subVectors(tr.pos, centre);
      return d < 11000 || _v.dot(tr.vel) < 0;
    };
    // the player's selection first, when it is one the crew would take
    const sel = u.selected != null ? this.fu.trackOf(u, u.selected) : null;
    if (sel && ok(sel) && sim.threatById.get(sel.id)?.alive) return sel.id;
    const cur = pr.target != null ? this.fu.trackOf(u, pr.target) : null;
    if (cur && ok(cur) && sim.threatById.get(cur.id)?.alive) return cur.id;
    let best = null, bs = Infinity;
    for (const tr of u.tracks) {
      if (sim.time - (u.seen.get(tr.id) ?? sim.time) < sys.react) continue;
      if (!ok(tr)) continue;
      const s = centre.distanceTo(tr.pos) - (tr.cls === 'bomber' ? 3000 : 0);
      if (s < bs) {
        bs = s;
        best = tr;
      }
    }
    return best?.id ?? null;
  }

  // ---------------------------------------------------------------- the unit's summary, the camera's gun
  summary(u, dt) {
    const sim = this.sim;
    const g = u.weapons.gun;
    const pr = u.predictor;
    let rounds = 0, firing = false;
    for (const p of u.parts) {
      if (!p.gun) continue;
      rounds += roundsOf(p.gun);
      if (p.gun.firing && (p.role === 'gun' || !pr)) firing = true;
    }
    g.rounds = rounds;
    // a heavy battery is in action while its last salvo's shells are still flying
    g.firing = pr ? sim.time - pr.lastSalvo < Math.max(4, pr.tof) : firing;
    // the gun the camera rides: the battery's guns fire together, so its first standing gun in letter order
    // (gun A while it stands); a platoon's gun that is firing, else one with a solution, kept for a while
    if (pr) u.nextGun = Math.max(0, u.parts.findIndex((p) => p.role === 'gun' && p.alive));
    else {
      const score = (p) => (!p.alive || !p.gun ? -1 : p.gun.firing ? 3 : p.gun.aimOk ? 2 : p.gun.target != null ? 1 : 0);
      let best = u.nextGun, bs = score(u.parts[best]);
      u.parts.forEach((p, i) => {
        const s = score(p);
        if (s > bs) {
          best = i;
          bs = s;
        }
      });
      u.nextGunT += dt;
      const cur = score(u.parts[u.nextGun]);
      if (best !== u.nextGun && (cur < 0 || (bs > cur && u.nextGunT > 2))) {
        u.nextGun = best;
        u.nextGunT = 0;
      }
    }
    // the fire control the consoles show: the predictor's, or the camera's gun's
    const src = pr ?? u.parts[u.nextGun]?.gun;
    if (pr) {
      g.target = pr.target;
      g.aim.copy(pr.aim);
      g.aimOk = pr.valid && pr.locked;
      g.locked = pr.locked;
      g.tof = pr.tof;
      g.laid = u.parts.some((p) => p.role === 'gun' && p.alive && p.gun.laid);
      g.hold = pr.hold;
    } else if (src) {
      g.target = u.mode === 'manual' ? u.selected : src.target;
      g.aim.copy(src.aim);
      g.aimOk = src.aimOk;
      g.locked = src.locked;
      g.tof = src.tof;
      g.laid = src.laid;
      g.hold = src.hold;
    }
  }

  // between raids the supply column brings the guns' ammunition back up; magazines and tables full
  resupply(u) {
    const sys = SYSTEMS[u.kind];
    u.parts.forEach((p) => {
      if (!p.gun || !p.alive) return;
      const fresh = newGun(sys.guns[p.kind]);
      const g = p.gun;
      g.rounds = fresh.rounds;
      g.table = fresh.table;
      g.clip = 0;
      g.load = 0;
      if (fresh.loaded) g.loaded = true;
      g.barrels.forEach((b, k) => Object.assign(b, fresh.barrels[k], { acc: 0 }));
    });
  }

  // a gun knocked out: it stops, and its ammunition is lost
  partDown(u, i) {
    const p = u.parts[i];
    if (!p.gun) return;
    const g = p.gun;
    g.firing = false;
    g.target = null;
    g.aimOk = false;
    g.laid = false;
    g.rounds = 0;
    g.table = 0;
    g.clip = 0;
    g.loaded = false;
    for (const b of g.barrels) b.mag = b.next = b.change = 0;
  }

  // the alerts and status of a mounts unit, after FireUnits.describe
  alerts(u) {
    const sim = this.sim;
    const sys = SYSTEMS[u.kind];
    const pr = u.predictor;
    const a = u.alerts;
    // optical units have no radar to be silent with
    if (u.status === 'SILENT' && !sys.radar) u.status = u.tracks.length ? 'TRACKING' : 'READY';
    if (pr?.barrage && u.mode !== 'hold') u.status = 'BARRAGE';
    for (const t of sim.threats) {
      if (!t.alive || !t.attack || t.target?.id !== u.id) continue;
      if (t.pos.distanceTo(u.pos) < 5000 && !a.includes('ATTACK')) a.push('ATTACK');
    }
    if (pr) {
      if (u.tracks.some((tr) => tr.cls === 'bomber' && tr.range < 25000) && !a.includes('BOMBERS')) a.push('BOMBERS');
      if (pr.source === 'radar' && pr.window > 0.3) a.push('WINDOW');
      if (pr.barrage) a.push('BARRAGE');
      const wz = u.parts.find((p) => p.role === 'radar');
      if (wz?.alive && !u.radar.track) a.push('RADAR OFF');
      if (!sim.link && !a.includes('NO LINK')) a.push('NO LINK');
    }
  }
}
