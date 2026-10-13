import * as THREE from 'three';
import { THREATS } from './systems.js';
import { G, clamp, fly, levelToward, fromBearingVec } from './flight.js';
import { makeThreat } from './threats.js';

// The WW2 era's aircraft (THREATS with `plane`) and their ordnance, as scripted attack roles after maxgfx's
// air.js (read only there: its slot formations and its dive, strafe and flare roles), in Echelon's Node-safe
// kinematics (flight.js fly: the velocity turns toward a wanted direction at a limited rate). ThreatAI hands
// every plane, bomb, rocket and Window cloud to this module. Roles (THREATS `role`, or the group's):
//   recon   a straight photo run at height over the field, then home
//   strafe  low gun passes: in at low level (or diving from a patrol height), a pop-up and a shallow dive
//           with the guns firing from about 1 km, a pull-out over the target, out a few km and round again
//           while it has `passes`; a gun pass hits the ground round its aim point (Sim.strafe)
//   dive    to a roll-in point at height, a dive of `dive` degrees at the target with the aim corrected for
//           the bombs' fall, release at `release` m over the ground, pull-out, then gun passes
//   rocket  the same with a salvo of RP-3 at `release` m, then gun passes
//   level   squadron boxes at height (THREATS bombs, the group's box): the leader flies the bomb run and
//           works out where its bombs would fall; every aircraft releases its stick when the leader does
//           (toggliers), then they rally and go home; a bomber below half its hit points falls out of the box
//           and goes home; the deputy takes over a box whose leader is lost; boxes with `window` throw chaff
//   escort  weaves over the wave's bombers, then strafes (or goes home) once they have bombed
// Flak spoils the aim: an aircraft under fire, hit or damaged releases with a larger error (`rattle`).
// `t.attack` is true on the attack run (the flak's alerts and the crews' priorities read it).

const _d = new THREE.Vector3();
const _p = new THREE.Vector3();
const _q = new THREE.Vector3();
const _v = new THREE.Vector3();
const _r = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

// Formations (x right, y up, z back, m). A squadron box of twelve (refs/ww2/b17 6.1, its game template):
// four flights of three in vees (wingmen 40 m out and 20 m back): the lead flight, the high flight 23 m up
// and 90 m right, the low flight 23 m down and 90 m left, the low-low flight 46 m down and 45 m left. An
// Invader box: three flights of three (refs/ww2/a26). Fighters in fingers of four.
const VEE = [[0, 0, 0], [-40, 0, 20], [40, 0, 20]];
const FLIGHTS = {
  b17: [[0, 0, 0], [90, 23, 30], [-90, -23, 30], [-45, -46, 60]],
  a26: [[0, 0, 0], [-80, -15, 40], [80, 15, 40], [0, -30, 80]],
};
const FINGER = [[0, 0, 0], [-60, 0, 30], [70, 0, 40], [130, 0, 70]];

function slotOf(type, k) {
  const fl = FLIGHTS[type];
  if (fl) {
    const f = fl[Math.floor(k / 3) % fl.length], v = VEE[k % 3];
    return new THREE.Vector3(f[0] + v[0], f[1] + v[1], f[2] + v[2] + Math.floor(k / (fl.length * 3)) * 120);
  }
  const f = FINGER[k % 4];
  return new THREE.Vector3(f[0] + Math.floor(k / 4) * 320, f[1], f[2] + Math.floor(k / 4) * 60);
}

// a formation's frame: forward (horizontal) and right of a heading vector
const rightOf = (f, out) => out.set(-f.z, 0, f.x).normalize();

export class Planes {
  constructor(sim) {
    this.sim = sim;
  }

  // ---------------------------------------------------------------- spawning
  // A group: a formation (`box`: the leader at the group's bearing and range, the others in their slots,
  // one aim point) or fighters in fingers of four, each with its own target.
  spawnGroup(g) {
    const sim = this.sim;
    const rng = sim.rng;
    const def = THREATS[g.type];
    const out = [];
    const b = g.bearing + (rng() - 0.5) * (g.spread ?? 4);
    const start = fromBearingVec(b, g.range, new THREE.Vector3());
    const shared = g.box ? sim.pickTarget(g.target ?? 'assets') : null;
    if (g.box && !shared) return out;
    const toward = new THREE.Vector3().subVectors(shared?.pos ?? _p.set(0, 0, 0), start).setY(0).normalize();
    const right = rightOf(toward, new THREE.Vector3());
    let lead = null;
    for (let i = 0; i < g.count; i++) {
      const target = shared ?? sim.pickTarget(g.target ?? 'assets');
      if (!target) continue;
      const s = slotOf(g.type, i);
      const pos = start.clone().addScaledVector(right, s.x).addScaledVector(toward, -s.z);
      pos.y = g.agl != null ? sim.heightAt(pos.x, pos.z) + g.agl : (g.alt ?? def.alt) + s.y;
      const t = this.spawnOne(g.type, pos, target, g, i);
      if (!t) continue;
      if (g.box) {
        t.box = g.group;
        t.slotI = i;
        t.slot = s;
        t.lead = lead ? lead.id : 0;
        if (!lead) lead = t;
      }
      out.push(t);
    }
    return out;
  }

  spawnOne(type, start, target, g = {}, i = 0) {
    const sim = this.sim;
    const def = THREATS[type];
    const dir = _d.subVectors(target.pos, start).setY(0).normalize();
    const role = g.escort ? 'escort' : g.role ?? def.role;
    const t = makeThreat(type, start, dir, {
      target, role, group: g.group ?? 0, alt: g.agl != null ? 0 : g.alt ?? def.alt, agl: g.agl ?? 0, wave: sim.wave,
      phase: role === 'escort' ? 'escort' : 'ingress', passes: g.passes ?? def.passes ?? 0, aimKind: g.target ?? 'assets',
      dive: ((g.dive ?? 50) * Math.PI) / 180, release: g.release ?? 800, bombs: g.bombs ?? def.bombs ?? 0, rockets: def.rockets ?? 0,
      bomb: g.bomb ?? def.bomb, lb: g.lb ?? def.lb ?? 500, window: !!g.window, windowT: 4 + sim.rng() * 4, attack: false, underFire: -99, hitT: -99,
      // for the models: the bomb doors (0..1, level bombers on the run) and drop tanks (escorts)
      doors: 0, tanks: role === 'escort',
      home: start.clone(), aimErr: new THREE.Vector3(), released: false, dropT: -1, stick: 0, stickT: 0, salvo: 0,
    });
    t.speed = def.speed;
    t.vel.copy(t.fwd).multiplyScalar(t.speed);
    sim.addThreat(t);
    return t;
  }

  // ---------------------------------------------------------------- per step
  update(t, dt) {
    const def = THREATS[t.type];
    if (t.type === 'gpbomb') return this.bomb(t, dt);
    if (t.type === 'rp3') return this.rocket(t, dt);
    if (def.chaff) return this.chaff(t, dt);
    t.attack = false;
    if (t.stick > 0) this.stickStep(t, dt);
    if (def.role === 'level') {
      // the doors open on the run (the last 20 km to the target) and close once the stick has gone
      const open = !t.released && t.bombs > 0 && t.phase !== 'straggle' && Math.hypot(t.pos.x - t.target.pos.x, t.pos.z - t.target.pos.z) < 20000;
      t.doors = clamp(t.doors + ((open || t.stick > 0 || t.dropT > 0) ? dt : -dt) / 4, 0, 1);
    }
    if (t.window) this.throwWindow(t, dt);
    switch (t.phase) {
      case 'egress': return this.egress(t, dt);
      case 'straggle': return this.straggle(t, dt);
    }
    switch (t.role) {
      case 'recon': return this.recon(t, dt);
      case 'strafe': return this.strafer(t, dt);
      case 'dive':
      case 'rocket': return this.diver(t, dt);
      case 'level': return this.level(t, dt);
      case 'escort': return this.escort(t, dt);
    }
    return this.egress(t, dt);
  }

  // how much flak spoils its aim (0 calm, up to 3): the light guns' tracer at it, heavy bursts close by, a
  // fresh hit, damage, and a box whose leader was lost on the run (the deputy has just taken over)
  rattle(t) {
    const now = this.sim.time;
    return clamp((now - t.underFire < 1.5 ? 0.5 : 0) + (now - (t.nearT ?? -99) < 4 ? 0.6 : 0) + (now - t.hitT < 3 ? 0.5 : 0) + (1 - t.hp / t.maxHp) * 2 +
      (now - (t.deputyT ?? -99) < 40 ? 0.6 : 0), 0, 3);
  }

  agl(t) {
    return t.pos.y - this.sim.heightAt(t.pos.x, t.pos.z);
  }

  // cruise toward (x, z) at a height: absolute `alt`, or `agl` over the ground ahead (terrain following);
  // `weave`: evasive action, the heading swinging that far (rad) either way about every 10 s
  cruise(t, x, z, dt, speed, turn, { alt = 0, agl = 0, weave = 0 } = {}) {
    const sim = this.sim;
    let h = alt;
    if (agl) {
      let ground = sim.heightAt(t.pos.x, t.pos.z);
      for (const k of [1.5, 3, 5]) ground = Math.max(ground, sim.heightAt(t.pos.x + t.vel.x * k, t.pos.z + t.vel.z * k));
      h = ground + agl;
    }
    const dir = levelToward(t.pos, x, z, h, _d, agl ? 0.3 : 0.25, agl ? 300 : 0);
    if (weave) {
      const a = weave * Math.sin(t.age * 0.63 + t.id * 1.7), c = Math.cos(a), s = Math.sin(a);
      const dx = dir.x, dz = dir.z;
      dir.x = dx * c - dz * s;
      dir.z = dx * s + dz * c;
    }
    fly(t, dir, dt, turn, speed);
  }

  // fighters weave on their way in once they are inside the flak (the bombers fly straight on their run)
  weave(t, hd) {
    return hd > 3500 && hd < 16000 ? 0.3 : 0;
  }

  // home, away from the field; gone once well out (it no longer holds the raid open)
  egress(t, dt) {
    const def = THREATS[t.type];
    t.phase = 'egress';
    const k = 40000 / Math.max(1, Math.hypot(t.home.x, t.home.z));
    const alt = def.role === 'level' || t.role === 'recon' ? Math.max(t.pos.y, 2500) : Math.max(1500, Math.min(t.pos.y + 300, 3000));
    this.cruise(t, t.home.x * k, t.home.z * k, dt, def.speed * 1.05, def.turn * 0.8, { alt });
    if (Math.hypot(t.pos.x, t.pos.z) > 36000) this.sim.remove(t);
  }

  // ---------------------------------------------------------------- roles
  // a straight photo run over the target at height, 6 km on, then home
  recon(t, dt) {
    const def = THREATS[t.type];
    const tp = t.target.pos;
    if (!t.runDir) t.runDir = new THREE.Vector3().subVectors(tp, t.pos).setY(0).normalize();
    _p.copy(tp).addScaledVector(t.runDir, 30000);
    this.cruise(t, _p.x, _p.z, dt, def.speed, def.turn, { alt: t.alt });
    if (_q.subVectors(t.pos, tp).setY(0).dot(t.runDir) > 6000) {
      // and on, away from the field (not back over it)
      t.phase = 'egress';
      t.home = t.pos.clone().addScaledVector(t.runDir, 10000);
    }
  }

  // Gun passes. In low (or from a patrol height when the group has no `agl`), a pop-up about 1.7 km out and
  // a shallow dive at the target (a steep one from height), the guns firing from 1 km to 300 m while the nose
  // is on, the pull-out over it, out to 3 km and round again while passes are left.
  strafer(t, dt) {
    const sim = this.sim;
    const def = THREATS[t.type];
    if (!t.target || (t.target.kind === 'unit' && !sim.unitById.get(t.target.id)?.alive)) t.target = sim.pickTarget(t.aimKind) ?? t.target;
    const tp = t.target.pos;
    const hd = Math.hypot(t.pos.x - tp.x, t.pos.z - tp.z);
    const low = t.agl > 0;
    switch (t.phase) {
      case 'ingress':
        // a strafer coming from height descends on the way in (the escorts, the P-47s after their bombs)
        if (low) this.cruise(t, tp.x, tp.z, dt, def.speed, def.turn, { agl: t.agl, weave: this.weave(t, hd) });
        else this.cruise(t, tp.x, tp.z, dt, def.speed, def.turn, { alt: Math.max(t.alt, sim.heightAt(tp.x, tp.z) + 600), weave: this.weave(t, hd) });
        if (hd < (low ? 4000 : 2800)) {
          t.phase = 'run';
          t.aimErr.set((sim.rng() - 0.5) * 30, 0, (sim.rng() - 0.5) * 30);
        }
        break;
      case 'run': {
        t.attack = true;
        _p.copy(tp).add(t.aimErr);
        _p.y = sim.heightAt(_p.x, _p.z) + 1;
        if (low && hd > 1700) this.cruise(t, tp.x, tp.z, dt, def.fast, def.turn, { agl: 260 });
        else {
          _d.subVectors(_p, t.pos).normalize();
          fly(t, _d, dt, def.turn * 1.2, def.fast);
        }
        const slant = t.pos.distanceTo(_p);
        _d.subVectors(_p, t.pos).normalize();
        if (slant < 1000 && slant > 300 && t.fwd.dot(_d) > Math.cos(0.07)) this.guns(t, _p, slant, dt);
        if (slant < 300 || (this.agl(t) < 70 && t.vel.y < 0 && hd < 600)) {
          t.phase = 'pullout';
          t.phaseT = 0;
        }
        break;
      }
      case 'pullout':
        this.pullout(t, dt, 'extend');
        break;
      case 'extend':
        // out past the target, low, then round again
        _p.copy(t.fwd).setY(0).normalize().multiplyScalar(2000).add(t.pos);
        this.cruise(t, _p.x, _p.z, dt, def.speed, def.turn * 0.6, { agl: Math.max(t.agl, 120) });
        if (hd > 3000) {
          if (--t.passes > 0) {
            t.phase = 'ingress';
            t.target = sim.pickTarget(t.aimKind) ?? t.target;
            if (!low) t.agl = 120;
          } else t.phase = 'egress';
        }
        break;
      default:
        this.egress(t, dt);
    }
  }

  // a gun burst on the ground round the aim point every 0.2 s (Sim.strafe); flak spoils the aim
  guns(t, aim, slant, dt) {
    const sim = this.sim;
    if ((t.gunT = (t.gunT ?? 0) - dt) > 0) return;
    t.gunT = 0.2;
    const s = (6 + slant * 0.008) * (1 + this.rattle(t));
    _q.set(aim.x + (sim.rng() - 0.5) * 2 * s, 0, aim.z + (sim.rng() - 0.5) * 2 * s);
    _q.y = sim.heightAt(_q.x, _q.z);
    sim.strafe(t, _q, (THREATS[t.type].guns ?? 4) * 0.2);
  }

  // pull up out of a dive or a gun run, then the next phase
  pullout(t, dt, next) {
    const def = THREATS[t.type];
    t.phaseT = (t.phaseT ?? 0) + dt;
    _d.copy(t.fwd);
    _d.y = Math.max(_d.y + 0.6, 0.35);
    fly(t, _d.normalize(), dt, def.turn * 1.7, def.fast);
    if ((t.fwd.y > 0.15 && this.agl(t) > 150) || t.phaseT > 8) {
      t.phase = next;
      t.phaseT = 0;
    }
  }

  // Dive-bombing (and the Typhoon's rocket dive): to the roll-in point on the far side of the dive line,
  // then the dive with the aim corrected for the bombs' or the rockets' fall, release, pull-out, gun passes.
  diver(t, dt) {
    const sim = this.sim;
    const def = THREATS[t.type];
    if (!t.target || (t.target.kind === 'unit' && !sim.unitById.get(t.target.id)?.alive)) t.target = sim.pickTarget(t.aimKind) ?? t.target;
    const tp = t.target.pos;
    const hd = Math.hypot(t.pos.x - tp.x, t.pos.z - tp.z);
    const rockets = t.role === 'rocket';
    switch (t.phase) {
      case 'ingress': {
        // the dive line: the roll-in point is where the target lies `dive` below the horizon
        const h = Math.max(300, t.alt - tp.y);
        const roll = h / Math.tan(t.dive);
        this.cruise(t, tp.x, tp.z, dt, def.speed, def.turn, { alt: t.alt, weave: hd > roll + 1500 ? this.weave(t, hd) : 0 });
        if (hd < roll + 150) {
          t.phase = 'dive';
          t.aimErr.set((sim.rng() - 0.5) * 16, 0, (sim.rng() - 0.5) * 16);
        }
        break;
      }
      case 'dive': {
        t.attack = true;
        _p.copy(tp).add(t.aimErr);
        _p.y = sim.heightAt(_p.x, _p.z);
        // where the bombs (or the rockets) would hit if they left now; aim so that comes onto the target
        const hit = rockets ? this.rocketImpact(t, _q) : this.bombImpact(t.pos, t.vel, _q);
        _v.subVectors(_p, hit).setY(0);
        if (_v.length() > 400) _v.setLength(400);
        _d.copy(_p).add(_v).sub(t.pos).normalize();
        // no steeper than the dive (it does not pull out of it to chase the aim point)
        if (_d.y < -Math.sin(t.dive) - 0.15) _d.y = -Math.sin(t.dive) - 0.15;
        fly(t, _d.normalize(), dt, def.turn * 1.3, def.fast);
        if (this.agl(t) < t.release || hd < 150) {
          if (rockets) t.salvo = t.rockets;
          else this.dropStick(t, 0.12, 14);
          t.phase = 'pullout';
          t.phaseT = 0;
        }
        break;
      }
      case 'pullout':
        if (t.salvo > 0) this.rocketSalvo(t, dt);
        this.pullout(t, dt, t.passes > 0 ? 'extend' : 'egress');
        if (t.phase === 'extend') {
          // the gun passes after the bombs or the rockets: a strafer from here on (this way out does not
          // count as one)
          t.role = 'strafe';
          t.agl = 100;
          t.passes++;
        }
        break;
      default:
        this.egress(t, dt);
    }
  }

  // Level bombers. The leader flies straight at the aim point at its height, its bombsight working out where
  // the bombs would fall (the cross-track error steered out); it releases as that point passes the aim point,
  // and every other aircraft of the box on its release (a moment later, each its own stick). Then the box
  // rallies off to the side and goes home. A bomber below half its hit points straggles.
  level(t, dt) {
    const sim = this.sim;
    const def = THREATS[t.type];
    if (t.phase === 'rally') {
      t.phaseT = (t.phaseT ?? 0) + dt;
      _d.copy(t.rallyDir);
      this.cruise(t, t.pos.x + _d.x * 4000, t.pos.z + _d.z * 4000, dt, def.speed, def.turn, { alt: t.alt - (t.type === 'a26' ? 300 : 0) });
      if (t.phaseT > 45) t.phase = 'egress';
      return;
    }
    if (t.hp < t.maxHp * 0.5 && t.phase !== 'straggle') {
      t.phase = 'straggle';
      sim.events.straggle?.(t);
      sim.say(this.reporter(), `${/^[AEIOU]/.test(def.name) ? 'an' : 'a'} ${def.name} is falling out of its formation`, 'info');
      return;
    }
    const lead = this.leaderOf(t);
    if (lead && lead !== t) {
      // hold the slot on the leader
      const f = _v.copy(lead.fwd).setY(0).normalize();
      const r = rightOf(f, _r);
      _p.copy(lead.pos).addScaledVector(r, t.slot.x - lead.slot.x).addScaledVector(f, -(t.slot.z - lead.slot.z));
      _p.y = lead.pos.y + (t.slot.y - lead.slot.y);
      const along = _q.subVectors(_p, t.pos).dot(f);
      _q.copy(_p).addScaledVector(f, 120);
      fly(t, _d.subVectors(_q, t.pos).normalize(), dt, def.turn * 1.5, clamp(lead.speed + along * 0.3, def.speed * 0.8, def.speed * 1.3));
      t.alt = lead.alt;
      // bombs away on the leader's release
      if (lead.released && !t.released) {
        t.released = true;
        t.dropT = sim.time + 0.3 + sim.rng() * 0.9;
        t.boxErr = lead.boxErr;
      }
      if (t.dropT > 0 && sim.time >= t.dropT) {
        t.dropT = -1;
        this.dropStick(t, 0.25, 25, t.boxErr);
      }
      if (lead.phase === 'rally' && t.released && t.dropT < 0) {
        t.phase = 'rally';
        t.phaseT = 0;
        t.rallyDir = lead.rallyDir;
      }
      return;
    }
    // the leader: the bomb run
    const tp = t.target.pos;
    _d.subVectors(tp, t.pos).setY(0);
    const hd = _d.length();
    _d.divideScalar(hd || 1);
    if (!t.released) {
      // the bombsight, a few times a second: where would a bomb dropped now fall?
      if ((t.sightT = (t.sightT ?? 0) - dt) <= 0) {
        t.sightT = 0.25;
        t.sight = this.bombImpact(t.pos, t.vel, t.sight ?? new THREE.Vector3(), THREATS.gpbomb.c);
      }
      const hit = t.sight;
      // the cross-track error of the fall, steered out; the along-track error says when to release
      const f = _v.copy(t.fwd).setY(0).normalize();
      const r = rightOf(f, _r);
      _q.subVectors(tp, hit);
      const along = _q.dot(f), across = _q.dot(r);
      _p.copy(tp).addScaledVector(r, clamp(across, -800, 800) * 0.8);
      this.cruise(t, _p.x, _p.z, dt, def.speed, def.turn, { alt: t.alt });
      if (hit && along < 0 && hd < 12000) {
        // bombs away: the lead bombardier's error, worse when the flak has hit or shaken his aircraft
        t.released = true;
        const s = 120 * (1 + this.rattle(t));
        t.boxErr = new THREE.Vector3((sim.rng() - 0.5) * 2 * s, 0, (sim.rng() - 0.5) * 2 * s);
        this.dropStick(t, 0.25, 0, t.boxErr);
        // rally off to one side
        const side = sim.rng() < 0.5 ? -1 : 1;
        t.rallyDir = new THREE.Vector3().copy(f).multiplyScalar(0.5).addScaledVector(r, side * 0.87).normalize();
      }
    } else if (t.stick <= 0) {
      t.phase = 'rally';
      t.phaseT = 0;
    } else this.cruise(t, t.pos.x + t.fwd.x * 3000, t.pos.z + t.fwd.z * 3000, dt, def.speed, def.turn, { alt: t.alt });
  }

  // The box's leader: its own, or the first aircraft of the box still in it (the deputy takes over)
  leaderOf(t) {
    const sim = this.sim;
    if (!t.box) return t;
    let lead = t.lead ? sim.threatById.get(t.lead) : t;
    if (lead?.alive && lead.phase !== 'straggle' && lead.phase !== 'egress') return lead;
    // a new leader: the first standing aircraft of the box (by slot), which keeps the old one's state
    let best = null;
    for (const o of sim.threats) {
      if (!o.alive || o.box !== t.box || o.type !== t.type || o.phase === 'straggle' || o.phase === 'egress') continue;
      if (!best || o.slotI < best.slotI) best = o;
    }
    if (!best) return t;
    if (best.lead) {
      const old = lead;
      best.lead = 0;
      best.deputyT = sim.time;
      if (old) {
        best.released = best.released || old.released;
        best.boxErr = old.boxErr;
        if (old.rallyDir) best.rallyDir = old.rallyDir;
      }
      sim.say(this.reporter(), `${THREATS[t.type].name} formation: the leader is down, the deputy takes over`, 'info', 'deputy' + t.box);
    }
    for (const o of sim.threats) if (o.alive && o.box === t.box && o !== best) o.lead = best.id;
    return best;
  }

  // a bomber below half its hit points: out of the box, down and home (its bombs kept, or already gone)
  straggle(t, dt) {
    const def = THREATS[t.type];
    const k = 40000 / Math.max(1, Math.hypot(t.home.x, t.home.z));
    this.cruise(t, t.home.x * k, t.home.z * k, dt, def.speed * 0.85, def.turn * 0.6, { alt: Math.max(1200, t.pos.y - 400) });
    if (Math.hypot(t.pos.x, t.pos.z) > 36000) this.sim.remove(t);
  }

  // Escort fighters weave over the wave's bombers (high above them, a little to the side); once none of
  // them is still on its way in, they go down and strafe while they have passes, else home.
  escort(t, dt) {
    const sim = this.sim;
    const def = THREATS[t.type];
    let charge = t.charge ? sim.threatById.get(t.charge) : null;
    const inbound = (o) => o.alive && o.wave === t.wave && THREATS[o.type].role === 'level' && !o.released && o.phase !== 'straggle' && o.phase !== 'egress';
    if (!charge || !inbound(charge)) {
      charge = null;
      let bd = Infinity;
      for (const o of sim.threats) {
        if (!inbound(o)) continue;
        const d = o.pos.distanceTo(t.pos);
        if (d < bd) {
          bd = d;
          charge = o;
        }
      }
      t.charge = charge?.id ?? 0;
    }
    if (!charge) {
      // the bombers are not up yet: on toward the field at height
      if (t.age < 120 && !sim.threats.some((o) => o.wave === t.wave && THREATS[o.type].role === 'level')) {
        this.cruise(t, t.target.pos.x, t.target.pos.z, dt, def.speed * 0.8, def.turn, { alt: t.alt });
        return;
      }
      // the drop tanks go before the fight
      t.tanks = false;
      if (t.passes > 0) {
        t.role = 'strafe';
        t.phase = 'ingress';
        t.agl = 80;
        t.target = sim.pickTarget(t.aimKind) ?? t.target;
      } else t.phase = 'egress';
      return;
    }
    // weave: an S across the bombers' course
    const f = _v.copy(charge.fwd).setY(0).normalize();
    const r = rightOf(f, _r);
    const w = Math.sin(sim.time * 0.25 + t.id) * 700;
    _p.copy(charge.pos).addScaledVector(r, w).addScaledVector(f, 600);
    fly(t, levelToward(t.pos, _p.x, _p.z, charge.pos.y + 800, _d), dt, def.turn, Math.max(charge.speed + 25, def.speed * 0.8));
  }

  // ---------------------------------------------------------------- ordnance
  // Where a bomb released at `pos` with `vel` would hit the ground (the same fall as bomb(); c: its drag).
  bombImpact(pos, vel, out, c = 0) {
    const sim = this.sim;
    let px = pos.x, py = pos.y, pz = pos.z, vx = vel.x, vy = vel.y, vz = vel.z;
    const dt = 0.1;
    for (let i = 0; i < 1200; i++) {
      if (c) {
        const sp = Math.sqrt(vx * vx + vy * vy + vz * vz), k = 1 / (1 + c * sp * dt);
        vx *= k;
        vy *= k;
        vz *= k;
      }
      vy -= G * dt;
      px += vx * dt;
      py += vy * dt;
      pz += vz * dt;
      if (i % 4 === 0 || py < 400) {
        const gh = sim.heightAt(px, pz);
        if (py <= gh) return out.set(px, gh, pz);
      }
    }
    return out.set(px, sim.heightAt(px, pz), pz);
  }

  // A stick of the aircraft's bombs, `gap` s apart, with its aimer's error `s` m (and a box error shared by
  // the box: the lead bombardier's), the impact shifted by the error through the release velocity.
  dropStick(t, gap, s, boxErr = null) {
    if (t.bombs <= 0) return;
    t.stick = t.bombs;
    t.stickT = 0;
    t.stickGap = gap;
    t.stickErr = new THREE.Vector3((this.sim.rng() - 0.5) * 2 * s * (1 + this.rattle(t)), 0, (this.sim.rng() - 0.5) * 2 * s * (1 + this.rattle(t)));
    if (boxErr) t.stickErr.add(boxErr);
  }

  stickStep(t, dt) {
    if ((t.stickT -= dt) > 0) return;
    t.stickT = t.stickGap;
    t.stick--;
    t.bombs--;
    const sim = this.sim;
    // the error enters as a velocity change over the fall (about how long it takes)
    const fall = Math.sqrt((2 * Math.max(50, this.agl(t))) / G) + 0.5;
    const b = makeThreat('gpbomb', t.pos, t.fwd, { target: t.target, parent: t.id, group: t.group, speed: t.speed, warhead: t.bomb, lb: t.lb });
    b.vel.copy(t.vel).addScaledVector(t.stickErr, 1 / fall);
    b.vel.y -= 1;
    b.pos.y -= 2;
    b.phase = 'fall';
    sim.addThreat(b);
    sim.threatLaunched(b, t);
  }

  bomb(t, dt) {
    const c = THREATS.gpbomb.c;
    const sp = t.vel.length();
    t.vel.multiplyScalar(1 / (1 + c * sp * dt));
    t.vel.y -= G * dt;
    t.pos.addScaledVector(t.vel, dt);
    t.speed = t.vel.length();
    if (t.speed > 1) t.fwd.copy(t.vel).divideScalar(t.speed);
  }

  // where a salvo of RP-3 fired now would hit (the same flight as rocket(), a coarse step)
  rocketImpact(t, out) {
    const sim = this.sim;
    const def = THREATS.rp3;
    let px = t.pos.x, py = t.pos.y, pz = t.pos.z, vx = t.vel.x, vy = t.vel.y, vz = t.vel.z;
    const fx = t.fwd.x, fy = t.fwd.y, fz = t.fwd.z;
    const dt = 0.1, a = def.speed / def.burn;
    for (let i = 0; i < 150; i++) {
      if (i * dt < def.burn) {
        vx += fx * a * dt;
        vy += fy * a * dt;
        vz += fz * a * dt;
      }
      vy -= G * dt;
      px += vx * dt;
      py += vy * dt;
      pz += vz * dt;
      // (the ground only matters near it: the highest is about 150 m)
      if (py < 400) {
        const gh = sim.heightAt(px, pz);
        if (py <= gh) return out.set(px, gh, pz);
      }
    }
    return out.set(px, sim.heightAt(px, pz), pz);
  }

  // the rockets leave in pairs 0.1 s apart along the aircraft's axis, each a little off
  rocketSalvo(t, dt) {
    const sim = this.sim;
    if ((t.salvoT = (t.salvoT ?? 0) - dt) > 0) return;
    t.salvoT = 0.1;
    const s = 0.008 * (1 + this.rattle(t));
    for (let k = 0; k < 2 && t.salvo > 0; k++) {
      t.salvo--;
      t.rockets--;
      _d.copy(t.fwd);
      _d.x += (sim.rng() - 0.5) * 2 * s;
      _d.y += (sim.rng() - 0.5) * 2 * s;
      _d.z += (sim.rng() - 0.5) * 2 * s;
      const r = makeThreat('rp3', t.pos, _d.normalize(), { target: t.target, parent: t.id, group: t.group, speed: t.speed });
      r.vel.copy(t.vel);
      r.pos.addScaledVector(r.fwd, 4);
      r.phase = 'boost';
      sim.addThreat(r);
      sim.threatLaunched(r, t);
    }
  }

  rocket(t, dt) {
    const def = THREATS.rp3;
    if (t.age < def.burn) t.vel.addScaledVector(t.fwd, (def.speed / def.burn) * dt);
    else t.phase = 'coast';
    t.vel.y -= G * dt;
    t.pos.addScaledVector(t.vel, dt);
    t.speed = t.vel.length();
    if (t.speed > 1) t.fwd.copy(t.vel).divideScalar(t.speed);
  }

  // A box with Window throws chaff from one of its aircraft every few seconds on its way in and over the
  // target; a cloud drifts with the wind, falls slowly and is gone after a while.
  throwWindow(t, dt) {
    const sim = this.sim;
    if (t.box && t.lead) return; // the box's leader times it for the box
    if (t.phase === 'egress' || t.phase === 'straggle' || (t.phase === 'rally' && t.phaseT > 20)) return;
    if (Math.hypot(t.pos.x, t.pos.z) > 30000) return;
    if ((t.windowT -= dt) > 0) return;
    t.windowT = 3 + sim.rng() * 2;
    let from = t;
    if (t.box) {
      const list = sim.threats.filter((o) => o.alive && o.box === t.box && o.phase !== 'straggle');
      if (list.length) from = list[Math.floor(sim.rng() * list.length)];
    }
    const w = makeThreat('window', from.pos, from.fwd, { group: 0, parent: from.id, speed: 0 });
    w.pos.y -= 10;
    w.vel.copy(from.vel).multiplyScalar(0.25);
    w.phase = 'fall';
    sim.addThreat(w);
  }

  chaff(t, dt) {
    const def = THREATS[t.type];
    // the strips lose their speed at once and fall slowly, drifting on the wind (from the west)
    t.vel.multiplyScalar(Math.exp(-dt * 1.5));
    t.pos.addScaledVector(t.vel, dt);
    t.pos.x += 6 * dt;
    t.pos.y -= def.fall * dt;
    if (t.age > def.life || t.pos.y < 400) this.sim.remove(t);
  }

  // who reports what the bombers do: the heavy battery (or the first unit)
  reporter() {
    return this.sim.area ?? this.sim.units[0];
  }
}
