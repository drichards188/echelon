import * as THREE from 'three';
import { ERA, ASSETS, partPlacements, setLoadout, setEra } from '../deploy.js';
import { mulberry32 } from '../noise.js';
import { Ballistics } from '../ballistics.js';
import { THREATS, MISSILES, DIFFICULTY, SYSTEMS } from './systems.js';
import { createUnits, FireUnits } from './units.js';
import { ThreatAI, resetIds } from './threats.js';
import { Interceptors, resetMissileIds } from './missiles.js';
import { Sensors } from './sensors.js';
import { Director } from './director.js';
import { bearingRange } from './flight.js';

// The whole game simulation, pure logic (plus ballistics.js tracers when given a scene). main.js wires
// `events` to the render layer, fx, audio, HUD and UI, and forwards the consoles' commands.
//
// Per step: director (spawns), threats, fire units (crews, engagements, guns, seeker), interceptors,
// shells, sensors (tracks and the picture), bookkeeping. `update` splits long frames into steps.

const STEP = 0.05;
const _v = new THREE.Vector3();

class Stats {
  constructor() {
    this.waves = [];
    this.fired = {};
    this.cur = null;
  }
  beginWave(n) {
    this.cur = { wave: n, spawned: {}, kills: {}, leaked: {}, fired: {}, assetDamage: {}, unitDamage: {} };
    this.fired = {};
    this.waves.push(this.cur);
  }
  endWave() {
    if (this.cur) this.cur.fired = { ...this.fired };
    this.cur = null;
  }
  add(key, sub, n = 1) {
    if (!this.cur) return;
    const o = this.cur[key];
    o[sub] = (o[sub] ?? 0) + n;
  }
}

export class Sim {
  constructor({ heightAt, los, scene = null, seed = 1 } = {}) {
    this.heightAt = heightAt;
    // terrain only blocks below the highest ground, so long rays to high targets are marched only
    // over their low end (a 200 km ray would otherwise cost a couple of thousand height samples)
    const TOP = 200;
    this.los = (ax, ay, az, bx, by, bz) => {
      if (ay > TOP && by > TOP) return true;
      if (by > TOP) {
        const k = (TOP - ay) / (by - ay);
        bx = ax + (bx - ax) * k;
        bz = az + (bz - az) * k;
        by = TOP;
      } else if (ay > TOP) {
        const k = (TOP - by) / (ay - by);
        ax = bx + (ax - bx) * k;
        az = bz + (az - bz) * k;
        ay = TOP;
      }
      return los(ax, ay, az, bx, by, bz);
    };
    this.events = {};
    this.seed = seed;
    // 1 clear, lower in rain, fog or dark: shortens the electro-optical channels (main sets it)
    this.visibility = 1;
    this.ballistics = new Ballistics(scene);
    this.unitsAI = new FireUnits(this);
    this.threatAI = new ThreatAI(this);
    this.interceptors = new Interceptors(this);
    this.sensors = new Sensors(this);
    this.director = new Director(this);
    this.newGame();
  }

  // scripted: a tutorial range. The director spawns nothing (the tutorial places its own threats with
  // threatAI.spawnOne), nothing is damaged or lost, the launchers start erected and interceptors hit
  // reliably so a lesson never stalls on bad luck. era: the era id (deploy.js setEra; a new era starts
  // on its default loadout); loadout: one kind per slot (deploy.js setLoadout); without them the era
  // and the units in deploy.js as they are.
  newGame({ difficulty = 'Normal', attract = false, scripted = false, seed = this.seed, loadout = null, era = null } = {}) {
    if (era) setEra(era);
    if (loadout) setLoadout(loadout);
    this.era = ERA.id;
    this.rng = mulberry32(seed);
    this.difficultyName = difficulty;
    this.difficulty = DIFFICULTY[difficulty] ?? DIFFICULTY.Normal;
    if (scripted) this.difficulty = { ...this.difficulty, hit: 2.5, damage: 0 };
    this.attract = attract;
    this.scripted = scripted;
    this.time = 0;
    this.acc = 0;
    resetIds();
    resetMissileIds();
    this.units = createUnits(this.heightAt, this.rng);
    if (scripted) for (const u of this.units) u.erect.fill(1);
    this.unitById = new Map(this.units.map((u) => [u.id, u]));
    this.loadout = this.units.map((u) => u.kind);
    // the area layer's unit (S-400 or Buk): it fuses the picture and carries the data link
    this.area = this.units.find((u) => SYSTEMS[u.kind].area) ?? null;
    this.assets = ASSETS.map((a) => ({ ...a, pos: new THREE.Vector3(a.x, this.heightAt(a.x, a.z), a.z), maxHp: a.hp, alive: true }));
    this.threats = [];
    this.threatById = new Map();
    this.shellCtx = null; // it holds the threat list, which a new game replaces
    this.missiles = [];
    this.missileById = new Map();
    this.picture = [];
    this.sensors.pictureMap.clear();
    this.engagedBy = new Map();
    this.link = true;
    this.score = { points: 0, kills: 0, cost: 0, leaks: 0, damage: 0 };
    this.stats = new Stats();
    this.groups = new Map();
    this.sayT = new Map();
    this.ballistics.clear();
    this.wave = 0;
    this.director.reset();
    this.state = scripted ? 'wave' : 'brief';
    this.events.state?.(this.state);
  }

  // ---------------------------------------------------------------- loop
  update(dt) {
    if (this.state === 'victory' || this.state === 'defeat') {
      // let the last missiles and wrecks finish
      if (dt > 0) this.step(Math.min(dt, STEP), true);
      return;
    }
    this.acc = Math.min(this.acc + dt, 2);
    while (this.acc >= STEP) {
      this.acc -= STEP;
      this.step(STEP);
    }
  }

  step(dt, over = false) {
    this.time += dt;
    if (!over) this.director.update(dt);
    this.threatAI.update(dt);
    this.unitsAI.update(dt);
    this.interceptors.update(dt);
    this.ballistics.update(dt, this.shellCtx ?? (this.shellCtx = this.makeShellCtx()));
    this.sensors.update(dt);
    this.bookkeeping();
    this.callouts();
  }

  command(unitId, name, args) {
    return this.unitsAI.command(this.unitById.get(unitId), name, args);
  }

  makeShellCtx() {
    return {
      targets: this.threats,
      hit: (t, p, kind, owner, dmg, unitIndex) => {
        if (!t.alive) return;
        this.events.detonate?.(p, kind, true);
        this.damageThreat(t, dmg, { unitId: this.units[unitIndex]?.id, weapon: kind });
      },
      groundAt: this.heightAt,
      ground: (p, kind) => this.events.shellGround?.(p, kind),
      expire: (p, kind) => this.events.shellExpire?.(p, kind),
    };
  }

  bookkeeping() {
    // drop finished threats and missiles
    let n = 0;
    for (const t of this.threats) {
      if (t.dead) {
        this.threatById.delete(t.id);
        this.events.removed?.(t);
      } else this.threats[n++] = t;
    }
    this.threats.length = n;
    n = 0;
    for (const m of this.missiles) {
      if (!m.alive) this.missileById.delete(m.id);
      else this.missiles[n++] = m;
    }
    this.missiles.length = n;
    // who is engaging what (the consoles mark engaged tracks)
    for (const list of this.engagedBy.values()) list.length = 0;
    const add = (id, uid) => {
      let l = this.engagedBy.get(id);
      if (!l) this.engagedBy.set(id, (l = []));
      if (!l.includes(uid)) l.push(uid);
    };
    for (const m of this.missiles) add(m.targetId, m.unitId);
    for (const u of this.units) {
      if (u.weapons.gun?.firing && u.weapons.gun.target) add(u.weapons.gun.target, u.id);
      for (const e of u.engagements) if (e.state === 'aligning' || e.state === 'launch') add(e.trackId, u.id);
    }
    for (const [id, l] of this.engagedBy) if (!l.length && !this.threatById.has(id)) this.engagedBy.delete(id);
  }

  // ---------------------------------------------------------------- radio
  radio(text, kind = 'info') {
    this.events.radio?.(text, kind);
  }

  // a unit's report, throttled per key so a held condition does not spam the log
  say(unit, text, kind = 'info', key = null) {
    if (this.attract) return;
    if (key) {
      const last = this.sayT.get(key) ?? -99;
      if (this.time - last < 6) return;
      this.sayT.set(key, this.time);
    }
    this.radio(`${unit.callsign}: ${text}`, kind);
  }

  // raids are called out once they have been held a couple of seconds, with bearing, range and height
  callouts() {
    if (this.attract) return;
    for (const p of this.picture) {
      const t = this.threatById.get(p.id);
      if (!t) continue;
      const key = t.type === 'arm' || t.type === 'tbm' || t.type === 'atgm' ? `${t.type}${t.parent || t.id}` : `g${t.group}`;
      let g = this.groups.get(key);
      if (!g) this.groups.set(key, (g = { t0: this.time, done: false, reporter: p.reporter }));
      if (g.done || this.time - g.t0 < 2) continue;
      g.done = true;
      const members = this.picture.filter((q) => {
        const o = this.threatById.get(q.id);
        return o && (key[0] === 'g' ? o.group === t.group && o.type !== 'arm' && o.type !== 'atgm' : o === t);
      });
      if (!members.length) continue;
      let x = 0, z = 0, y = 0;
      for (const q of members) {
        x += q.pos.x;
        z += q.pos.z;
        y += q.pos.y;
      }
      x /= members.length;
      z /= members.length;
      y /= members.length;
      const [b, r] = bearingRange(0, 0, x, z);
      const reporter = this.unitById.get(g.reporter) ?? this.units[0];
      const brg = String(Math.round((b * 180) / Math.PI)).padStart(3, '0');
      const height = y - this.heightAt(x, z) < 300 ? 'low' : y > 6000 ? 'high' : 'medium';
      if (t.type === 'arm') this.say(reporter, `ARM launch, bearing ${brg}, ${Math.round(r / 1000)} km!`, 'alert');
      else if (t.type === 'tbm') this.say(reporter, `ballistic target, bearing ${brg}, ${Math.round(r / 1000)} km, descending!`, 'alert');
      else if (t.type === 'atgm') this.say(reporter, `missile launch from the helicopter, bearing ${brg}!`, 'alert');
      else this.say(reporter, `new raid, bearing ${brg}, ${Math.round(r / 1000)} km, ${members.length} track${members.length > 1 ? 's' : ''}, ${height}`, 'warn');
    }
  }

  // ---------------------------------------------------------------- threats
  addThreat(t) {
    this.threats.push(t);
    this.threatById.set(t.id, t);
    this.stats.add('spawned', t.type);
    this.events.spawn?.(t);
  }

  remove(t) {
    t.alive = false;
    t.falling = false;
    t.dead = true;
  }

  threatLaunched(t, from) {
    this.events.threatLaunch?.(t, from);
  }

  damageThreat(t, dmg, by) {
    if (!t.alive) return;
    t.hp -= dmg;
    if (by?.unitId) t.dmgBy.set(by.unitId, (t.dmgBy.get(by.unitId) ?? 0) + dmg);
    if (t.hp <= 0) this.destroy(t, by);
  }

  destroy(t, by, silent = false) {
    if (!t.alive) return;
    t.alive = false;
    const def = THREATS[t.type];
    // aircraft and slow flyers fall as burning wrecks; missiles and bombs break up in the air
    if (t.type === 'fighter' || t.type === 'helo' || t.type === 'drone' || t.type === 'cruise' || t.type === 'decoy') t.falling = true;
    else t.dead = true;
    if (silent || !by) return;
    if (!this.attract && !this.scripted && this.state !== 'victory' && this.state !== 'defeat') {
      this.score.points += def.points;
      this.score.kills++;
    }
    this.stats.add('kills', `${by.unitId}:${by.weapon}`);
    this.events.threatKilled?.(t, by);
    const u = this.unitById.get(by.unitId);
    const name = { fighter: 'fighter', decoy: 'decoy', cruise: 'cruise missile', drone: 'drone', arm: 'ARM', glide: 'glide bomb', helo: 'helicopter', atgm: 'ATGM', tbm: 'ballistic target' }[t.type];
    if (u) this.say(u, `target destroyed, ${name}`, 'kill');
  }

  // a threat or its weapon reaches its target or the ground
  arrive(t) {
    if (t.dead) return;
    const def = THREATS[t.type];
    if (!def.warhead) {
      // an aircraft that flew into the ground
      this.destroy(t, null, true);
      this.wreckImpact(t);
      return;
    }
    const victim = this.applyWarhead(t.pos, def.warhead[0], def.warhead[1]);
    if (victim) {
      this.score.leaks++;
      this.stats.add('leaked', t.type);
      if (!this.attract) this.score.points -= Math.round(def.points * 0.5);
    }
    t.alive = false;
    t.dead = true;
    this.events.impact?.(t, t.pos, victim);
  }

  wreckImpact(t) {
    if (t.dead) return;
    t.dead = true;
    t.falling = false;
    const def = THREATS[t.type];
    // a downed cruise missile or drone can still go off where it falls
    const victim = def.warhead ? this.applyWarhead(t.pos, def.warhead[0] * 0.4, def.warhead[1] * 0.6) : this.applyWarhead(t.pos, 8, 20);
    this.events.impact?.(t, t.pos, victim);
  }

  // damage everything within `radius`; returns the most damaged victim { kind, id } or null
  applyWarhead(pos, dmg, radius) {
    if (this.attract || this.scripted) return null;
    dmg *= this.difficulty.damage;
    let victim = null, most = 0;
    const fall = (d) => (d < radius * 0.25 ? 1 : 1 - (d - radius * 0.25) / (radius * 0.75));
    for (const u of this.units) {
      if (!u.alive) continue;
      let h = 0;
      if (SYSTEMS[u.kind].dispersed) {
        // each vehicle of a dispersed unit takes its own share and is knocked out on its own; the unit
        // is out with its last TELAR
        u.parts.forEach((p, i) => {
          if (!p.alive) return;
          const d = p.pos.distanceTo(pos);
          if (d >= radius) return;
          const hi = dmg * fall(d);
          p.hp -= hi;
          h += hi;
          if (p.hp <= 0) this.unitsAI.partDown(u, i);
        });
        if (h <= 0) continue;
        u.hp = u.parts.some((p) => p.alive && p.role === 'telar') ? u.parts.reduce((a, p) => a + (p.alive ? p.hp : 0), 0) : 0;
      } else {
        let d = Infinity;
        for (const p of u.parts) d = Math.min(d, p.pos.distanceTo(pos));
        if (d >= radius) continue;
        h = dmg * fall(d);
        u.hp -= h;
      }
      this.score.damage += h;
      this.stats.add('unitDamage', u.id, h);
      if (h > most) {
        most = h;
        victim = { kind: 'unit', id: u.id };
      }
      this.events.unitDamaged?.(u);
      if (u.hp <= 0) {
        u.hp = 0;
        u.alive = false;
        for (const m of this.missiles) if (m.unitId === u.id && MISSILES[m.kind].command) m.blind = 99;
        this.radio(`${u.callsign}: ${u.name} destroyed!`, 'alert');
        this.events.unitDestroyed?.(u);
      } else if (h > 5) this.say(u, 'hit, damage reported', 'alert', 'dmg' + u.id);
    }
    for (const a of this.assets) {
      if (!a.alive) continue;
      let d;
      if (a.kind === 'runway') {
        // distance to the runway rectangle
        const b = (a.bearing * Math.PI) / 180;
        const ux = Math.sin(b), uz = -Math.cos(b);
        const rx = pos.x - a.pos.x, rz = pos.z - a.pos.z;
        const along = rx * ux + rz * uz, across = -rx * uz + rz * ux;
        d = Math.hypot(Math.max(0, Math.abs(along) - a.length / 2), Math.max(0, Math.abs(across) - a.width / 2));
      } else d = Math.max(0, pos.distanceTo(a.pos) - 25);
      if (d >= radius) continue;
      const h = dmg * fall(d);
      a.hp -= h;
      this.score.damage += h;
      this.stats.add('assetDamage', a.id, h);
      if (h > most) {
        most = h;
        victim = { kind: 'asset', id: a.id };
      }
      this.events.assetDamaged?.(a);
      if (a.hp <= 0) {
        a.hp = 0;
        a.alive = false;
        this.radio(`Command: ${a.name} destroyed.`, 'alert');
      }
    }
    return victim;
  }

  // ---------------------------------------------------------------- targets for the attackers
  pickTarget(kind) {
    const rng = this.rng;
    const pick = (list, w) => {
      let sum = 0;
      for (const x of list) sum += w(x);
      let r = rng() * sum;
      for (const x of list) if ((r -= w(x)) <= 0) return x;
      return list[list.length - 1];
    };
    const assetTarget = () => {
      const alive = this.assets.filter((a) => a.alive);
      const list = alive.length ? alive : this.assets;
      const a = pick(list, (x) => ({ runway: 3, command: 2, shelter: 1, fuel: 1, tower: 0.5 })[x.kind] ?? 1);
      const pos = a.pos.clone();
      if (a.kind === 'runway') {
        const b = (a.bearing * Math.PI) / 180, s = (rng() - 0.5) * a.length * 0.8;
        pos.x += Math.sin(b) * s;
        pos.z -= Math.cos(b) * s;
        pos.y = this.heightAt(pos.x, pos.z);
      }
      return { kind: 'asset', id: a.id, pos };
    };
    const unitTarget = (filter) => {
      const list = this.units.filter((u) => u.alive && filter(u));
      if (!list.length) return null;
      const u = pick(list, (x) => (SYSTEMS[x.kind].area ? 2 : 1));
      const standing = u.parts.filter((p) => p.alive);
      const p = standing[Math.floor(rng() * standing.length)];
      return { kind: 'unit', id: u.id, part: u.parts.indexOf(p), pos: p.pos.clone().setY(p.pos.y + 2) };
    };
    switch (kind) {
      case 'radar': {
        // the area unit's radar vehicle: raids are planned against its site, so they keep going there
        // even after a dispersed unit's radar vehicle has been knocked out
        const s = this.area;
        if (s?.alive) {
          const i = Math.max(0, s.parts.findIndex((p) => p.role === 'radar'));
          return { kind: 'unit', id: s.id, part: i, pos: s.parts[i].pos.clone().setY(s.parts[i].pos.y + 4) };
        }
        return unitTarget(() => true) ?? assetTarget();
      }
      case 'short':
        return unitTarget((u) => !SYSTEMS[u.kind].area) ?? assetTarget();
      case 'units':
        return unitTarget(() => true) ?? assetTarget();
      case 'any':
        return rng() < 0.5 ? unitTarget(() => true) ?? assetTarget() : assetTarget();
      default:
        return assetTarget();
    }
  }

  // an emitting unit for a radar-seeking missile, the area unit first, and which of its vehicles (a
  // Buk: the search radar or any TELAR with its radar on)
  pickEmitter(from, range) {
    let best = null, bw = 0;
    for (const u of this.units) {
      if (!this.unitsAI.emitting(u)) continue;
      const d = from.distanceTo(u.pos);
      if (d > range) continue;
      const w = (SYSTEMS[u.kind].area ? 3 : 1) + this.rng();
      if (w > bw) {
        best = u;
        bw = w;
      }
    }
    if (!best) return null;
    const list = this.unitsAI.emitters(best);
    const i = list.length > 1 ? list[Math.floor(this.rng() * list.length)] : list[0] ?? 0;
    const p = best.parts[i].pos;
    return { kind: 'unit', id: best.id, part: i, pos: _v.copy(p).setY(p.y + 5).clone() };
  }

  // the data link stands while the area unit does (a dispersed one: while its command post stands)
  linkUp() {
    const a = this.area;
    if (!a?.alive) return false;
    const cp = a.parts.find((p) => p.role === 'cp');
    return !cp || cp.alive;
  }

  // ---------------------------------------------------------------- interceptors
  addMissile(m) {
    this.missiles.push(m);
    this.missileById.set(m.id, m);
  }

  resolveHit(m, t, factor) {
    const def = MISSILES[m.kind];
    const u = this.unitById.get(m.unitId);
    let chance = (def.hit[t.type] ?? 0.5) * this.difficulty.hit * factor * (m.guided ? 1 : 0.4);
    // the player's own shots are a little better than the AI crews' (they chose the shot)
    if (u && u.mode === 'manual') chance = Math.min(0.97, chance * 1.1);
    else if (u) chance *= 0.85;
    const hit = this.rng() < chance;
    m.alive = false;
    this.events.detonate?.(m.pos, m.kind, hit);
    if (hit) this.damageThreat(t, 3, { unitId: m.unitId, weapon: m.kind });
  }

  selfDestruct(m, ground = false) {
    m.alive = false;
    this.events.detonate?.(m.pos, m.kind, false, ground);
  }

  // ---------------------------------------------------------------- unit queries (used by the modules)
  emitting(u, part = -1) { return this.unitsAI.emitting(u, part); }
  channelTargets(u) { return this.unitsAI.channelTargets(u); }
  channelSees(u, t) { return this.unitsAI.channelSees(u, t); }
  guides(u, t, m) { return this.unitsAI.guides(u, t, m); }
  /**
   * Which vehicle (part index) and slot the next round of `type` (default: the selected type) leaves
   * from, { part, slot } with slot -1 when none is ready there; null for a unit without missiles.
   * `unit` is a unit or its id. The camera rides this vehicle.
   */
  nextLauncher(unit, type) {
    const u = typeof unit === 'string' ? this.unitById.get(unit) : unit;
    return u ? this.unitsAI.nextLauncher(u, type ?? u.weapons.type) : null;
  }
}

export { partPlacements };
