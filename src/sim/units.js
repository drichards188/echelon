import * as THREE from 'three';
import { UNITS, partPlacements } from '../deploy.js';
import { SYSTEMS, MISSILES, SLOTS, THREATS, PART_ROLE, CLS_TYPE } from './systems.js';
import { clamp, wrapPi, TAU } from './flight.js';
import { inEnvelope, makeMissile } from './missiles.js';
import { solveLead, reachOf, SHELLS, OWNER } from '../ballistics.js';
import { Mounts, initMounts } from './mounts.js';

// Fire units: state the UI and render layer read, the commands the player gives, and the AI crews.
// AI crews are competent but imperfect on purpose (slow to react, they fire on decoys, never go silent
// against radar-seeking missiles, use the big missiles on everything) so the player's choices count.
// What differs between the kinds comes from their SYSTEMS entry (fire-control channel, capabilities),
// not from checks on the kind. Gun units of several mounts (SYSTEMS `mounts`: the WW2 era's batteries and
// platoons) are run by sim/mounts.js, called from here.

const _v = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _from = new THREE.Vector3();
const _sum = new THREE.Vector3();
const _s = new THREE.Vector3();
const _g = new THREE.Vector3();
const _m = new THREE.Vector3();
const _e = new THREE.Vector3();
const _a = new THREE.Vector3();

// a launch waits for the launcher to be this close to its target (rad; 1.5 times that in elevation):
// the turret is on it, not still swinging onto it
const ALIGN = 0.02;
// the sector around the missiles' target inside which the guns of a gun-missile unit without a
// turret-mounted array of its own may take the turret off a round in flight (rad)
const GUN_SECTOR = 0.79;
// the guns' fire control: the crew fires only while the bore is within GUN_LAID metres of the lead at
// its range (an angle between the two limits, rad); the velocity it leads with is the channel's,
// smoothed over GUN_VEL seconds, and its rate of change, over GUN_ACC seconds, bends the lead
const GUN_LAID = 4, GUN_LAID_MIN = 0.0025, GUN_LAID_MAX = 0.02;
const GUN_VEL = 0.25, GUN_ACC = 0.5, GUN_ACC_MAX = 25, GUN_LAG = 0.6;
// gun.hold when a missile channel (or a designation) keeps the turret off the gun target
const TURRET_HELD = 'turret on the missile target';
// gun.hold when the shells cannot get to the target before they self-destruct
const OUT_OF_REACH = 'out of reach';

// the area unit crew's preference by track class, added to the time to impact (s): ballistic targets
// and aircraft first, drones and helicopters last
const AREA_PREF = { tbm: -250, aircraft: -100, arm: -50, drone: 150, helo: 150, atgm: 150 };

// bearing (radians, clockwise from north) and elevation of a world direction
const bearingOfDir = (d) => (Math.atan2(d.x, -d.z) + TAU) % TAU;
const elevOfDir = (d) => Math.asin(clamp(d.y / (d.length() || 1), -1, 1));
// turret azimuth relative to the hull (three's rotation.y, + = left) for a world bearing
const turretAz = (unit, bearing) => wrapPi(-bearing - unit.heading);
const live = (e) => e.state !== 'kill' && e.state !== 'miss';
const pending = (e) => e.state === 'aligning' || e.state === 'launch';
const sightDir = (s, out) => out.set(Math.sin(s.az) * Math.cos(s.el), Math.sin(s.el), -Math.cos(s.az) * Math.cos(s.el));

// rng: the battle's seeded random numbers (for the radar sweeps' and crews' start phases); without one
// the phases follow from the unit's index, so a battle is still the same every time
export function createUnits(heightAt, rng = null) {
  return UNITS.map((def, index) => {
    const sys = SYSTEMS[def.kind];
    const parts = partPlacements(def).map((p) => {
      const part = {
        kind: p.kind, role: sys.roles?.[p.kind] ?? PART_ROLE[p.kind] ?? 'main', heading: p.heading,
        // a part on a structure (`deck` m over the ground at the structure, deploy.js partPlacements: the flak
        // towers' guns)
        pos: new THREE.Vector3(p.x, p.deck != null ? heightAt(p.bx, p.bz) + p.deck : heightAt(p.x, p.z), p.z),
        slots: SLOTS[p.kind] ? new Array(SLOTS[p.kind]).fill(true) : [], rounds: 0, alive: true,
      };
      // a part's own name and letter (the WW2 battery's guns A to F)
      if (p.name) part.name = p.name;
      if (p.letter) part.letter = p.letter;
      if (p.deck != null) part.deck = p.deck;
      const hp = sys.dispersed?.[p.kind];
      if (hp) part.hp = part.maxHp = hp;
      // a Buk launcher vehicle turns and raises its own launcher; a TELAR also has its own radar channel
      if (part.role === 'telar' || part.role === 'loader') part.turret = { az: 0, el: sys.minEl ?? 0.1 };
      if (part.role === 'telar') Object.assign(part, { track: false, target: null, locked: false, idle: 0 });
      return part;
    });
    const stock = {};
    for (const [type, s] of Object.entries(sys.stocks)) {
      // held: rounds on a vehicle being reloaded (out of action until the job ends, not in `ready`);
      // job: the reload in progress (also listed in u.reloads), null when idle
      stock[type] = { type, ready: s.ready, reserve: s.reserve, max: s.ready, reload: 0, held: 0, job: null };
      if (sys.fc === 'telar') stock[type].reloadPart = -1;
    }
    const types = Object.keys(stock);
    const hp = sys.dispersed ? parts.reduce((a, p) => a + (p.maxHp ?? 0), 0) : sys.hp;
    const u = {
      id: def.id, index, slot: def.slot ?? index, kind: def.kind, name: def.name, callsign: def.callsign,
      pos: parts[0].pos.clone(), heading: parts[0].heading, parts,
      hp, maxHp: hp, alive: true,
      mode: 'auto',
      // (observers who scan by eye, search.optical, are no radar: radar.search stays false for them)
      radar: { search: !!sys.search && !sys.search.optical, track: false, sweep: (rng ? rng() : (index * 0.618) % 1) * TAU, range: sys.search?.range ?? 0 },
      tracks: [], trackMap: new Map(), linkMap: new Map(), selected: null,
      engagements: [],
      weapons: {
        stock, types, type: types[0] ?? null, missiles: stock[types[0]] ?? null, weapon: types.length ? 'missile' : 'gun',
        gun: sys.gun ? {
          rounds: sys.gun.rounds, max: sys.gun.rounds, shell: sys.gun.shell, firing: false, heat: 0, trigger: false, burst: 0, cool: 0,
          target: null, overheated: false, aim: new THREE.Vector3(), aimOk: false,
          // the fire control (guns()): locked, its channel holds the target; tof, the lead's time of
          // flight; laid, the guns have the turret this step; hold, why they cannot fire (or null);
          // est, its smoothed velocity and acceleration of the target
          locked: false, lockT: 0, lockId: null, tof: 0, laid: false, hold: null,
          est: { id: null, n: 0, vel: new THREE.Vector3(), acc: new THREE.Vector3(), prev: new THREE.Vector3() },
        } : null,
      },
      // the lead vehicle's turret (a Buk's first TELAR); the S-400 has none. trackEl: a tracking antenna
      // that elevates on its own (the Osa's)
      turret: parts[0].turret ?? (sys.antenna ? { az: 0, el: sys.restEl ?? 0.1, trackEl: sys.restEl ?? 0.1 } : { az: 0, el: sys.restEl ?? 0.1 }),
      erect: new Array(sys.erectors ?? 0).fill(0),
      sight: sys.sight || sys.eo ? {
        az: (def.bearing * Math.PI) / 180, el: 0.05, fov: sys.sight?.fov ?? 0.12, uncaged: false, lock: 0, tone: 0, targetId: null,
        src: sys.track ? 'radar' : 'eo',
      } : null,
      status: 'READY', alerts: [],
      // the fire-control channel: whether it holds a target right now (channelSees) and which
      channel: { locked: false, targetId: null },
      // AI crew
      aiT: rng ? rng() : (index * 0.382) % 1, aiNext: 0, launchT: 0, seen: new Map(), strelaT: 0,
      // the Strela: where the crew lays the launcher (world bearing and elevation, the sight looks along
      // it), the threat the AI crew is cued onto, and a launch waiting for the swing to the lead
      lay: sys.sight?.seeker ? { az: (def.bearing * Math.PI) / 180, el: 0.05 } : null, aiCueId: null, fire: null,
      // a Buk: the TELAR the player picked to fire (part index), null for the best available
      firePart: null,
      // the engagement rate cap (SYSTEMS targetGap): the targets this unit has launched at (id -> time of
      // its first round at it) and the time from which it may take on a new one
      fired: new Map(), nextTarget: 0,
      // the selected track handed to the tracking channel (designate): state null | 'queued' (every
      // channel guides a missile, or outside a busy turret's sector) | 'laying' (the radar it needs is
      // switched off: only the turret is laid) | 'held' (a channel has it) | 'engaged' (an engagement's
      // channel holds it); part: a Buk's TELAR taking it
      desig: { id: null, state: null, part: -1, uncaged: false },
      // radars the player switched off on purpose (a designation does not switch them back on)
      silent: { search: false, track: false },
      // the reload jobs in progress, one per missile type at most (startJob; render/reload.js plays them)
      reloads: [],
    };
    if (sys.fc === 'telar') {
      u.telars = parts.flatMap((p, i) => (p.role === 'telar' ? [i] : []));
      u.loader = parts.findIndex((p) => p.role === 'loader');
      // every launcher vehicle starts full
      for (const st of Object.values(stock)) for (const [i, n] of racksOf(u, st.type)) parts[i].rounds = n;
    }
    syncRounds(u);
    if (sys.mounts) initMounts(u);
    return u;
  });
}

// how the ready rounds of a type sit on the unit's vehicles: [part, rounds, rounds per slot]
function racksOf(u, type) {
  return SYSTEMS[u.kind].racks?.[type] ?? [[0, u.weapons.stock[type].max, 1]];
}

// the reload job filling vehicle i, or null
function jobOn(u, i) {
  for (const j of u.reloads) if (j.part === i) return j;
  return null;
}

// how long an S-400 TEL takes to raise its stack from the travel pose (s): staggered, so a battalion
// does not move as one
const erectTime = (i) => 16 + i * 3;

// Stacked racks (every kind but the Buk): the vehicle the next round of `type` leaves from, the last one
// in rack order with rounds that is not being reloaded, a raised one first (the S-400's stacks rise at
// different rates). -1 if none.
function firingVehicle(u, type) {
  let best = -1, bestUp = false;
  for (const [i] of racksOf(u, type)) {
    if (u.parts[i].rounds <= 0 || jobOn(u, i)) continue;
    const up = (u.erect[i] ?? 1) >= 1;
    if (up || !bestUp) {
      best = i;
      bestUp = up;
    }
  }
  return best;
}

// The rounds on each vehicle and the slots the render layer shows; every launcher vehicle keeps its own
// rounds. Stacked racks: `ready` counts the rounds on the vehicles that are not being reloaded (a reload
// job holds its vehicle's rounds in `held`); when `ready` drops (a launch) the rounds leave from
// firingVehicle, when it is raised from outside (the tutorials) they go to the first vehicles with room;
// a vehicle's slots fill from 0 and fire back from the highest. With fc 'telar' the stock adds the
// vehicles' rounds up, the rounds leave in slot order (0 first, the models' launch order) and the
// loader-launcher's slots after its launcher's show the reserve on its rack (`cradle` rounds at most).
function syncRounds(u) {
  const sys = SYSTEMS[u.kind];
  const own = sys.fc === 'telar';
  for (const st of Object.values(u.weapons.stock)) {
    const racks = racksOf(u, st.type);
    if (own) {
      st.ready = racks.reduce((a, [i]) => a + (u.parts[i].alive ? u.parts[i].rounds : 0), 0);
      for (const [i, n] of racks) {
        const p = u.parts[i];
        const rack = i === u.loader && p.alive ? Math.min(sys.cradle ?? 0, st.reserve) : 0;
        for (let k = 0; k < p.slots.length; k++) p.slots[k] = k < n ? k >= n - p.rounds : k - n < rack;
      }
      continue;
    }
    let have = 0;
    for (const [i] of racks) if (!jobOn(u, i)) have += u.parts[i].rounds;
    while (have > st.ready) {
      const i = firingVehicle(u, st.type);
      if (i < 0) break;
      u.parts[i].rounds--;
      have--;
    }
    for (const [i, n] of racks) {
      if (have >= st.ready) break;
      if (jobOn(u, i)) continue;
      const add = Math.max(0, Math.min(n - u.parts[i].rounds, st.ready - have));
      u.parts[i].rounds += add;
      have += add;
    }
    st.ready = have;
    for (const [i, , per = 1] of racks) {
      const p = u.parts[i];
      for (let k = 0; k < p.slots.length; k++) p.slots[k] = k * per < p.rounds;
    }
  }
}

export class FireUnits {
  constructor(sim) {
    this.sim = sim;
    // the units of several gun mounts (SYSTEMS `mounts`)
    this.mounts = new Mounts(sim, this);
  }

  // ---------------------------------------------------------------- queries
  // what each unit's tracking channels follow (they refresh those tracks every step)
  channelTargets(u) {
    if (SYSTEMS[u.kind].mounts) return this.mounts.channelTargets(u);
    const ids = [];
    // the designation (the Strela's channel is its seeker, which locks by its own rules)
    if (u.desig.state === 'held' && !u.lay) ids.push(u.desig.id);
    for (const e of u.engagements) if (live(e)) ids.push(e.trackId);
    if (u.weapons.gun?.target) ids.push(u.weapons.gun.target);
    if (SYSTEMS[u.kind].sight?.seeker && u.sight.targetId) ids.push(u.sight.targetId);
    return ids;
  }

  // how many targets the unit can engage at once (a Buk: one per TELAR still standing; the optical sight
  // holds one)
  channelCount(u) {
    const sys = SYSTEMS[u.kind];
    if (sys.fc === 'telar') return u.telars.filter((i) => u.parts[i].alive).length;
    return this.fcSource(u, 'missile') === 'eo' ? 1 : sys.channels;
  }

  // the unit's track of a threat: its own once measured, otherwise the linked one (null if neither)
  trackOf(u, id) {
    if (id == null) return null;
    const own = u.trackMap.get(id);
    return own?.n ? own : u.linkMap.get(id) ?? null;
  }

  // the sector (rad) around the turret's bore that the missile channel holds targets in: a
  // turret-mounted array's, the optical sight's free travel when the sight guides the missiles, a
  // gun-missile unit's default otherwise; 0 for none (nothing limits where the turret may turn)
  sectorOf(u) {
    const sys = SYSTEMS[u.kind];
    if (this.fcSource(u, 'missile') === 'eo' && u.sight) return sys.eo?.free ?? Math.PI / 2;
    return sys.track?.sector ?? (u.weapons.gun && u.weapons.missiles ? GUN_SECTOR : 0);
  }

  // is the threat inside the EO sight's field of view? (the sight looks from the guns' height)
  inSight(u, t) {
    const s = u.sight;
    _e.subVectors(t.pos, u.pos);
    _e.y -= SYSTEMS[u.kind].gun?.height ?? 3;
    const d = _e.length();
    return d > 0 && _e.dot(sightDir(s, _s)) > d * Math.cos(Math.max(s.fov * 0.6, 0.03));
  }

  // an EO sight turns on its own drive, but only so far from the bore
  clampSight(u) {
    const s = u.sight;
    const free = SYSTEMS[u.kind].eo?.free ?? Math.PI / 2;
    const bore = ((-(u.heading + u.turret.az) % TAU) + TAU) % TAU;
    const d = wrapPi(s.az - bore);
    if (Math.abs(d) > free) s.az = (bore + Math.sign(d) * free + TAU) % TAU;
  }

  // line of sight from the unit (or one of its vehicles) to a threat, cached a few steps per channel
  losTo(u, t, part = -1) {
    const sim = this.sim;
    const c = t.losCache ?? (t.losCache = {});
    const key = part < 0 ? u.id : `${u.id}/${part}`;
    const e = c[key];
    if (e && sim.time - e.t < 0.3) return e.v;
    const p = part < 0 ? u.pos : u.parts[part].pos;
    const v = sim.los(p.x, p.y + 6, p.z, t.pos.x, t.pos.y, t.pos.z);
    c[key] = { t: sim.time, v };
    return v;
  }

  // the EO channel's game range, shortened by poor visibility as much as the sight suffers from it
  eoRange(u) {
    const eo = SYSTEMS[u.kind].eo;
    return eo.range * (1 - (eo.vis ?? 0) * (1 - (this.sim.visibility ?? 1)));
  }

  // which channel lays the missiles (use 'missile') or the guns ('gun'): 'search', 'track', 'eo',
  // 'sight' or 'telar'
  fcSource(u, use = 'missile') {
    const sys = SYSTEMS[u.kind];
    if (sys.fc !== 'track') return sys.fc;
    if (use === 'missile' && sys.missileFc) return sys.missileFc;
    let src = u.sight?.src === 'eo' ? 'eo' : 'track';
    if (src === 'track' && sys.eoFallback && !u.radar.track) src = 'eo';
    return src;
  }

  // can this channel of the unit (`part`: which TELAR) see the threat right now?
  sees(u, t, src, part = -1) {
    const sys = SYSTEMS[u.kind];
    switch (src) {
      case 'search':
        return u.radar.search && u.pos.distanceTo(t.pos) < sys.search.range && this.losTo(u, t);
      case 'track':
        if (!u.radar.track || u.pos.distanceTo(t.pos) >= sys.track.range) return false;
        // a turret-mounted array holds targets only inside its sector around the bore
        if (sys.track.sector && Math.abs(wrapPi(turretAz(u, bearingOfDir(_s.subVectors(t.pos, u.pos))) - u.turret.az)) > sys.track.sector) return false;
        return this.losTo(u, t);
      case 'eo':
        // the optical channel holds only what is in the sight's field of view
        return u.pos.distanceTo(t.pos) < this.eoRange(u) && this.inSight(u, t) && this.losTo(u, t);
      case 'sight':
        return u.pos.distanceTo(t.pos) < sys.sight.range && this.losTo(u, t);
      case 'telar': {
        const p = u.parts[part];
        return !!p?.alive && p.track && p.pos.distanceTo(t.pos) < sys.track.range && this.losTo(u, t, part);
      }
    }
    return false;
  }

  // can the unit's fire-control channel see this threat right now? use: 'missile', 'gun' or 'any'
  // (they differ only where the missiles have a channel of their own); a Buk: the TELAR holding it
  channelSees(u, t, use = 'any') {
    const sys = SYSTEMS[u.kind];
    if (sys.mounts) return this.mounts.sees(u, t);
    if (sys.fc === 'telar') return u.parts.some((p, i) => p.target === t.id && this.sees(u, t, 'telar', i));
    const src = this.fcSource(u, use === 'gun' ? 'gun' : 'missile');
    if (this.sees(u, t, src)) return true;
    if (use !== 'any' || !sys.missileFc) return false;
    const gun = this.fcSource(u, 'gun');
    return gun !== src && this.sees(u, t, gun);
  }

  // a command-guided missile keeps flying true while its channel holds the target (a Buk round: the
  // TELAR that guides it); the area unit's radar also carries its own-seeker rounds (uplink)
  guides(u, t, m) {
    const sys = SYSTEMS[u.kind];
    if (!MISSILES[m.kind].command && !sys.uplink) return true;
    if (sys.fc === 'telar') return this.sees(u, t, 'telar', m.guide);
    return this.channelSees(u, t, 'missile');
  }

  // is the unit (or one of its vehicles) emitting? Radar-seeking missiles home on it while it is.
  emitting(u, part = -1) {
    if (!u.alive) return false;
    if (part < 0) return u.radar.search || u.radar.track;
    const p = u.parts[part];
    if (!p?.alive) return false;
    if (p.role === 'telar') return p.track;
    if (p.role === 'radar') return u.radar.search;
    return p.role === 'main' && (u.radar.search || u.radar.track);
  }

  // the vehicles a radar-seeking missile can go for right now
  emitters(u) {
    const out = [];
    u.parts.forEach((_, i) => this.emitting(u, i) && out.push(i));
    return out;
  }

  // can a missile of `type` do anything against a track of this class? (0 in its hit table: no)
  canHit(type, cls) {
    const k = CLS_TYPE[cls];
    return !k || (MISSILES[type].hit[k] ?? 0.5) > 0;
  }

  /**
   * Which vehicle (part index) and slot the next round of `type` leaves from: { part, slot }, with slot
   * -1 when no round is ready there (the vehicle that fires after the next reload). For a Buk
   * engagement `e` that is its TELAR, then the loader-launcher once the TELAR is empty; with no
   * engagement, the TELAR that would take the next target. null if the unit has no such missile.
   */
  nextLauncher(u, type = u.weapons.type, e = null) {
    // a battery or platoon: the gun that fires next
    if (SYSTEMS[u.kind].mounts) return this.mounts.nextGun(u);
    const st = type ? u.weapons.stock[type] : null;
    if (!st) return null;
    const racks = racksOf(u, type);
    if (SYSTEMS[u.kind].fc === 'telar') {
      // the engagement's TELAR, else the one the player picked (while it stands), else the best free one
      const pick = u.firePart != null && u.parts[u.firePart]?.alive ? u.firePart : null;
      let g = e?.guide ?? pick ?? this.freeTelar(u);
      if (g < 0) g = u.telars.find((i) => u.parts[i].alive) ?? u.telars[0];
      for (const i of [g, u.loader]) if (i >= 0 && this.canFire(u, i)) return { part: i, slot: this.capOf(u, type, i) - u.parts[i].rounds };
      return { part: g, slot: -1 };
    }
    // stacked racks: firingVehicle's highest loaded slot; with none ready, the vehicle a reload is
    // filling (or would fill next)
    const i = firingVehicle(u, type);
    if (i >= 0) return { part: i, slot: Math.floor((u.parts[i].rounds - 1) / (racks.find(([j]) => j === i)[2] ?? 1)) };
    const next = st.job ? st.job.part : this.emptiest(u, st);
    return { part: next >= 0 ? next : racks[0][0], slot: -1 };
  }

  // a Buk vehicle that can launch now: standing, rounds on its rails, not being reloaded (the
  // loader-launcher cannot fire while its crane is busy)
  canFire(u, i) {
    const p = u.parts[i];
    if (!p?.alive || p.rounds <= 0) return false;
    const st = u.weapons.missiles;
    return !(st.reload > 0 && (st.reloadPart === i || i === u.loader));
  }

  // the TELAR that would take a new target: standing and not guiding anything yet, one with rounds of
  // its own (or the loader-launcher's to fire) first, then the nearest. Against a track only one whose
  // radar has line of sight to it (-1 if none)
  freeTelar(u, tr = null) {
    let best = -1, bs = -Infinity;
    const spare = u.loader >= 0 && this.canFire(u, u.loader);
    for (const i of u.telars) {
      const p = u.parts[i];
      if (!p.alive || u.engagements.some((e) => e.guide === i && live(e))) continue;
      let s = this.canFire(u, i) ? 2 : spare ? 1 : 0;
      if (tr) {
        if (!this.sim.los(p.pos.x, p.pos.y + 6, p.pos.z, tr.pos.x, tr.pos.y, tr.pos.z)) continue;
        s -= p.pos.distanceTo(tr.pos) * 1e-7;
      }
      if (s > bs) {
        best = i;
        bs = s;
      }
    }
    return best;
  }

  vehicleName(u, i) {
    const p = u.parts[i];
    if (p.name) return p.name;
    if (p.role === 'telar') return `TELAR ${u.telars.indexOf(i) + 1}`;
    return { loader: 'loader-launcher', radar: 'search radar', cp: 'command post' }[p.role] ?? 'vehicle';
  }

  // ---------------------------------------------------------------- commands
  command(u, name, a = {}) {
    const sim = this.sim;
    if (!u || !u.alive) return false;
    const sys = SYSTEMS[u.kind];
    if (sys.mounts) return this.mounts.command(u, name, a);
    switch (name) {
      case 'radar':
        if (!sys.search) return false;
        if (a.on && u.parts.some((p) => p.role === 'radar' && !p.alive)) {
          sim.say(u, 'unable, search radar knocked out', 'warn');
          return false;
        }
        u.radar.search = !!a.on;
        u.silent.search = !a.on;
        sim.say(u, a.on ? 'search radar on' : 'search radar off, silent', 'info', 'radar' + u.id);
        return true;
      case 'track':
        if (!sys.track) return false;
        if (sys.fc === 'telar') {
          // one TELAR's radar (part) or all of them
          for (const i of u.telars) if ((a.part == null || a.part === i) && u.parts[i].alive) {
            u.parts[i].track = !!a.on;
            u.parts[i].silent = !a.on;
          }
          u.radar.track = u.telars.some((i) => u.parts[i].track);
          return true;
        }
        u.radar.track = !!a.on;
        u.silent.track = !a.on;
        return true;
      case 'mode':
        if (!['auto', 'manual', 'hold'].includes(a.mode)) return false;
        u.mode = a.mode;
        if (a.mode === 'hold') {
          for (const e of u.engagements) if (e.state === 'aligning') e.state = 'miss';
          if (u.weapons.gun) u.weapons.gun.target = null;
        }
        return true;
      case 'select':
        // the selection is designated to the tracking channel (designate); in manual it is also the
        // guns' target (they are laid on its lead once it is inside their reach)
        u.selected = a.trackId ?? null;
        if (u.weapons.gun && u.mode === 'manual') u.weapons.gun.target = u.selected;
        this.designate(u);
        return true;
      case 'engage':
        return this.engage(u, a.trackId ?? u.selected, a.salvo ?? 1, true, a.part !== undefined ? a.part : u.firePart);
      case 'firePart':
        // a Buk: the TELAR the next engagements fire from (null: the best available)
        if (sys.fc !== 'telar') return false;
        if (a.part != null && u.parts[a.part]?.role !== 'telar') return false;
        u.firePart = a.part ?? null;
        return true;
      case 'cease': {
        const id = a.trackId ?? u.selected;
        for (const e of u.engagements) {
          if (e.trackId !== id || !live(e)) continue;
          e.state = 'miss';
          for (const mid of e.missileIds) {
            const m = sim.missileById.get(mid);
            if (m?.alive) sim.selfDestruct(m);
          }
        }
        if (u.weapons.gun?.target === id) u.weapons.gun.target = null;
        return true;
      }
      case 'missileType':
        if (!u.weapons.stock[a.type]) return false;
        u.weapons.type = a.type;
        u.weapons.missiles = u.weapons.stock[a.type];
        return true;
      case 'reload':
        return this.startReload(u, true, u.weapons.missiles, a.part ?? null);
      case 'weapon':
        if (!u.weapons.gun) return false;
        u.weapons.weapon = a.weapon === 'gun' || !u.weapons.missiles ? 'gun' : 'missile';
        return true;
      case 'trigger':
        if (!u.weapons.gun) return false;
        u.weapons.gun.trigger = !!a.down;
        if (a.down && u.selected) u.weapons.gun.target = u.selected;
        return true;
      case 'trackSource':
        if (!sys.track || !sys.eo) return false;
        u.sight.src = a.source === 'eo' ? 'eo' : 'radar';
        return true;
      case 'slew':
        if (!u.sight) return false;
        u.manualSlewT = sim.time;
        if (u.lay) {
          // the Strela's sight looks along the launcher: a slew moves where the crew lays it and the
          // turret follows at its rates; `az`/`el` (world, radians) lay it on a designation
          const lay = u.lay;
          lay.az = (((a.az ?? lay.az + (a.daz ?? 0)) % TAU) + TAU) % TAU;
          lay.el = clamp(a.el ?? lay.el + (a.del ?? 0), -0.05, 1.4);
          return true;
        }
        u.sight.az = (u.sight.az + (a.daz ?? 0) + TAU) % TAU;
        u.sight.el = clamp(u.sight.el + (a.del ?? 0), -0.08, 1.45);
        this.clampSight(u);
        return true;
      case 'uncage':
        if (!sys.sight?.seeker) return false;
        u.sight.uncaged = !!a.on;
        if (!a.on) {
          u.sight.lock = 0;
          u.sight.targetId = null;
          u.fire = null;
        }
        return true;
      case 'fire':
        if (!sys.sight?.seeker) return false;
        return this.fireStrela(u, true);
      case 'zoom':
        if (!u.sight) return false;
        u.sight.fov = a.wide === false || (a.wide == null && u.sight.fov > 0.1) ? (sys.sight?.zoom ?? 0.05) : (sys.sight?.fov ?? 0.12);
        return true;
    }
    return false;
  }

  activeEngagements(u) {
    let n = 0;
    for (const e of u.engagements) if (live(e)) n++;
    return n;
  }

  // where the unit's missiles would leave from against a track (a Buk: the TELAR that would take it,
  // null when none is free with line of sight to it)
  launchPoint(u, tr, out = _from) {
    if (SYSTEMS[u.kind].fc !== 'telar') return out.copy(u.pos).setY(u.pos.y + 6);
    const g = this.freeTelar(u, tr);
    return g < 0 ? null : out.copy(u.parts[g].pos).setY(u.parts[g].pos.y + 6);
  }

  // inside the sector of a turret-mounted array (or of a gun-missile unit's missile channel) around
  // the bore, or the turret is free to turn to it: nothing else holds it. `guns`: the AI crew's own
  // rule, which also leaves the turret to its guns while they work a target in their range
  inSector(u, tr, guns = false) {
    const sec = this.sectorOf(u);
    if (!sec) return true;
    let busy = u.engagements.some(live);
    if (!busy && guns) {
      const g = u.weapons.gun;
      busy = !!g?.target && g.aimOk && (this.trackOf(u, g.target)?.range ?? Infinity) < SYSTEMS[u.kind].gun.range;
    }
    if (!busy) return true;
    return Math.abs(wrapPi(turretAz(u, bearingOfDir(_s.subVectors(tr.pos, u.pos))) - u.turret.az)) < sec * 0.8;
  }

  // queue a missile engagement against a track; `player` gets a radio reason when it cannot. part: the
  // TELAR to use (a Buk; otherwise the free one best placed)
  engage(u, trackId, salvo, player = false, part = null) {
    const sim = this.sim;
    const sys = SYSTEMS[u.kind];
    const fail = (why) => {
      if (player) sim.say(u, 'unable, ' + why, 'warn');
      return false;
    };
    if (sys.sight?.seeker) return this.fireStrela(u, player);
    if (!u.weapons.missiles) return fail('no missiles, guns only');
    if (u.mode === 'hold' && !player) return false;
    const tr = u.tracks.find((x) => x.id === trackId);
    if (!tr) return fail('no track');
    if (u.engagements.some((e) => e.trackId === trackId && pending(e))) return fail('already engaging');
    if (this.activeEngagements(u) >= this.channelCount(u)) return fail('all channels busy');
    const stock = u.weapons.missiles;
    if (stock.ready <= 0) return fail(stock.reload > 0 ? 'reloading' : 'no missiles ready');
    if (!this.canHit(stock.type, tr.cls)) return fail(`the ${stock.type} cannot take ${tr.cls === 'tbm' ? 'ballistic targets' : 'this target'}`);
    let guide;
    if (sys.fc === 'telar') {
      const d = u.desig;
      guide = part ?? (d.id === trackId && d.part >= 0 && (d.state === 'held' || d.state === 'laying') ? d.part : this.freeTelar(u, tr));
      const p = u.parts[guide];
      if (!p || p.role !== 'telar' || !p.alive) return fail('no TELAR free with line of sight to it');
      if (u.engagements.some((e) => e.guide === guide && live(e))) return fail(`${this.vehicleName(u, guide)} is busy`);
      if (!this.canFire(u, guide) && !this.canFire(u, u.loader)) return fail(stock.reload > 0 ? 'reloading' : 'no missiles ready');
      _from.copy(p.pos).y += 6;
      if (!inEnvelope(sim, stock.type, _from, tr.pos, tr.vel)) return fail('target outside the envelope');
      // the TELAR's crew switches its radar on to take the shot
      p.track = true;
      p.target = trackId;
      u.radar.track = true;
    } else {
      // the crew switches the tracking radar on to take the shot (the EO channel needs none)
      if (sys.fc === 'track' && this.fcSource(u, 'missile') === 'track') u.radar.track = true;
      _from.copy(u.pos).y += 6;
      if (!inEnvelope(sim, stock.type, _from, tr.pos, tr.vel)) return fail('target outside the envelope');
    }
    if (!this.inSector(u, tr)) return fail('target outside the radar sector');
    const n = Math.min(salvo, stock.ready);
    const wait = this.targetWait(u, trackId);
    u.engagements.push({ trackId, missileIds: [], state: 'aligning', salvo: n, launched: 0, nextT: 0, type: stock.type, t: sim.time, guide, wait });
    if (player) sim.say(u, `engaging track ${trackId}, ${stock.type} x${n}${guide != null ? `, ${this.vehicleName(u, guide)}` : ''}${wait > 0.5 ? `, next target in ${Math.ceil(wait)} s` : ''}`, 'info');
    return true;
  }

  // The engagement rate cap (SYSTEMS targetGap): how long (s) before this unit may launch at `id` when it
  // is a new target for it (none of its rounds has gone at it yet). A re-fire at a target it has already
  // launched at (its round missed) does not wait.
  targetWait(u, id) {
    if (!SYSTEMS[u.kind].targetGap || u.fired.has(id)) return 0;
    return Math.max(0, u.nextTarget - this.sim.time);
  }

  // ---------------------------------------------------------------- reloads
  // A reload is a job on ONE vehicle (u.reloads, st.job): it fills that vehicle's empty slots from the
  // reserve. The S-400 reloads its emptiest TEL of the missile type, a Buk's loader-launcher loads one
  // vehicle with its crane, a one-vehicle unit its launcher. The job's clock runs in sim time (time
  // compression plays the render's reload scene faster) and the rounds count at its end (the sim stays
  // authoritative). Meanwhile that vehicle does not fire (on stacked racks its rounds are `held`, out of
  // `ready`; a Buk's canFire) and takes its loading pose (SYSTEMS reloadPose: the S-400 lowers that
  // TEL's stack and raises it again after the job, inside the reload time; a turret is laid to its
  // loading position, see reloadPose()).
  startReload(u, player = false, st = u.weapons.missiles, part = null) {
    const sim = this.sim;
    const sys = SYSTEMS[u.kind];
    if (!st) {
      if (player) sim.say(u, 'no missiles to reload', 'warn');
      return false;
    }
    if (sys.fc === 'telar') return this.loadVehicle(u, st, player, part);
    const load = sys.stocks[st.type].load;
    const i = part ?? this.emptiest(u, st);
    if (st.job || st.reserve <= 0 || i < 0 || st.ready + st.held >= st.max) {
      if (player) sim.say(u, st.reserve <= 0 ? 'no reloads left' : st.job ? 'already reloading' : 'launchers full', 'warn');
      return false;
    }
    // reloading takes the launcher out of action, so only start when it is empty or the player orders it
    if (!player && st.ready > Math.max(0, st.max - load)) return false;
    return this.startJob(u, st, i);
  }

  // A job on vehicle i of a stacked-rack unit. Returns false when there is nothing to put on it. The job
  // (read by the render, see DESIGN.md "Reload scenes"): { id, type, part (the vehicle loaded), from
  // (the vehicle whose crane works: the same here, a Buk's loader-launcher), slots (the slots that get
  // rounds, in the order they fill), n (rounds it adds), t (s elapsed), dur (s until the rounds count) }.
  startJob(u, st, i) {
    const sys = SYSTEMS[u.kind];
    const p = u.parts[i];
    const rack = racksOf(u, st.type).find(([j]) => j === i);
    if (!rack || !p?.alive) return false;
    const [, cap, per = 1] = rack;
    const n = Math.min(cap - p.rounds, st.reserve, sys.stocks[st.type].load);
    if (n <= 0) return false;
    const slots = [];
    for (let k = 0; k < p.slots.length; k++) if ((k + 1) * per > p.rounds && k * per < p.rounds + n) slots.push(k);
    // an S-400 TEL lowers its stack inside the job and raises it after: the reload time covers both. A
    // partial load takes its share of the reload time, not less than reloadMin (the crane and the
    // trucks need that long); without reloadMin every job takes the full time
    const raise = sys.reloadPose?.erect != null && i < u.erect.length ? erectTime(i) : 0;
    const share = sys.reloadMin != null ? Math.min(sys.reload, Math.max(sys.reloadMin, (sys.reload * n) / sys.stocks[st.type].load)) : sys.reload;
    const job = { id: (this.jobSeq = (this.jobSeq ?? 0) + 1), type: st.type, part: i, from: i, slots, n, t: 0, dur: Math.max(10, share - raise) };
    st.job = job;
    st.held = p.rounds;
    st.ready -= p.rounds;
    st.reload = job.dur;
    u.reloads.push(job);
    this.updateSlots(u);
    this.sim.say(u, 'reloading', 'info');
    return true;
  }

  // the job's rounds count: the vehicle's held rounds are ready again with the new ones
  endJob(u, st) {
    const job = st.job;
    if (SYSTEMS[u.kind].fc === 'telar') this.finishLoad(u, st);
    else {
      const p = u.parts[job.part];
      const n = Math.max(0, Math.min(this.capOf(u, st.type, job.part) - p.rounds, st.reserve, job.n));
      p.rounds += n;
      st.reserve -= n;
      st.ready += p.rounds;
    }
    this.dropJob(u, st);
  }

  // the job is over (done, or its vehicle is gone)
  dropJob(u, st) {
    const k = u.reloads.indexOf(st.job);
    if (k >= 0) u.reloads.splice(k, 1);
    st.job = null;
    st.held = 0;
    st.reload = 0;
  }

  // a turret vehicle being reloaded (loaded, or its crane working) is laid to the system's loading pose
  // (SYSTEMS reloadPose { az, el }, relative to the hull) at its slew rates and nothing else moves it.
  // True while it holds the turret.
  reloadPose(u, dt, i = 0, tu = u.turret) {
    const sys = SYSTEMS[u.kind];
    const job = u.reloads.find((j) => j.part === i || j.from === i);
    // the vehicle whose crane works for another takes reloadPose.crane when there is one
    const pose = job && job.part !== i ? sys.reloadPose?.crane ?? sys.reloadPose : sys.reloadPose;
    if (pose?.az == null || !job) return false;
    // a round the turret's channel still guides (command guidance) keeps the turret until it is done
    if (this.sim.missiles.some((m) => m.alive && m.unitId === u.id && (m.part ?? 0) === i && MISSILES[m.kind]?.command)) return false;
    // with `guns` the guns take the turret while they have a target (a gun unit fights on through a reload)
    if (pose.guns && u.weapons.gun?.target != null) return false;
    // with `free` the turret goes back where it was (job.az0, el0) in the job's last `free` seconds
    job.az0 ??= tu.az;
    job.el0 ??= tu.el;
    const back = pose.free && job.dur - job.t < pose.free;
    tu.az = wrapPi(tu.az + clamp(wrapPi((back ? job.az0 : pose.az) - tu.az), -sys.turnAz * dt, sys.turnAz * dt));
    tu.el += clamp((back ? job.el0 : pose.el ?? tu.el) - tu.el, -sys.turnEl * dt, sys.turnEl * dt);
    return true;
  }

  capOf(u, type, i) {
    return racksOf(u, type).find(([j]) => j === i)?.[1] ?? 0;
  }

  // the vehicle a reload fills next. Stacked racks: the launcher vehicle of that type with the fewest
  // rounds and room for more (the S-400's emptiest TEL, ties to the first; a one-vehicle unit its
  // launcher), -1 when every one is full or being reloaded. A Buk: the TELAR with the fewest rounds,
  // then the loader-launcher's own rails.
  emptiest(u, st) {
    if (SYSTEMS[u.kind].fc !== 'telar') {
      let best = -1;
      for (const [i, n] of racksOf(u, st.type)) {
        const p = u.parts[i];
        if (p.alive && p.rounds < n && !jobOn(u, i) && (best < 0 || p.rounds < u.parts[best].rounds)) best = i;
      }
      return best;
    }
    let best = -1;
    for (const i of u.telars) {
      const p = u.parts[i];
      if (p.alive && p.rounds < this.capOf(u, st.type, i) && (best < 0 || p.rounds < u.parts[best].rounds)) best = i;
    }
    if (best < 0 && u.loader >= 0 && u.parts[u.loader].alive && u.parts[u.loader].rounds < this.capOf(u, st.type, u.loader)) best = u.loader;
    return best;
  }

  // the loader-launcher's crane moves rounds from its cradles (the reserve) onto one vehicle; while it
  // works neither it nor that vehicle can launch
  loadVehicle(u, st, player, part) {
    const sim = this.sim;
    const sys = SYSTEMS[u.kind];
    const no = (why) => {
      if (player) sim.say(u, why, 'warn');
      return false;
    };
    if (!u.parts[u.loader]?.alive) return no('loader-launcher knocked out');
    if (st.reload > 0) return no('already reloading');
    if (st.reserve <= 0) return no('no reloads left');
    const i = part ?? this.emptiest(u, st);
    const p = u.parts[i];
    if (!p?.alive || p.rounds >= this.capOf(u, st.type, i)) return no('launchers full');
    st.reloadPart = i;
    // the job the render follows: the rails fill from the last empty one down (a Buk vehicle fires from
    // slot 0 up); the rounds count at the end (finishLoad). Loading a TELAR the loader-launcher drives
    // over to it first (reloadDrive m/s on the straight distance; it drives back after the job)
    const cap = this.capOf(u, st.type, i), n = Math.min(cap - p.rounds, st.reserve, sys.stocks[st.type].load);
    const slots = [];
    for (let k = cap - p.rounds - 1; k >= cap - p.rounds - n; k--) slots.push(k);
    const drive = i !== u.loader && sys.reloadDrive ? this.loaderDrive(u, st, p) / sys.reloadDrive : 0;
    st.job = { id: (this.jobSeq = (this.jobSeq ?? 0) + 1), type: st.type, part: i, from: u.loader, slots, n, t: 0, dur: sys.reload + drive };
    st.reload = st.job.dur;
    u.reloads.push(st.job);
    sim.say(u, `reloading ${this.vehicleName(u, i)}`, 'info');
    return true;
  }

  // metres the loader-launcher drives to vehicle p: from its own spot, or from where it is on its way
  // back from the vehicle it loaded last (st.loaderAt, it drives home at reloadDrive after a job)
  loaderDrive(u, st, p) {
    const lp = u.parts[u.loader].pos, at = st.loaderAt && u.parts[st.loaderAt.part];
    let x = lp.x, z = lp.z;
    if (at) {
      const back = Math.hypot(at.pos.x - lp.x, at.pos.z - lp.z) / SYSTEMS[u.kind].reloadDrive;
      const k = Math.min(1, (this.sim.time - st.loaderAt.t) / Math.max(back, 1e-3));
      x = at.pos.x + (lp.x - at.pos.x) * k;
      z = at.pos.z + (lp.z - at.pos.z) * k;
    }
    return Math.hypot(p.pos.x - x, p.pos.z - z);
  }

  finishLoad(u, st) {
    if (st.reloadPart !== u.loader) st.loaderAt = { part: st.reloadPart, t: this.sim.time };
    const p = u.parts[st.reloadPart];
    if (p?.alive) {
      const n = Math.min(this.capOf(u, st.type, st.reloadPart) - p.rounds, st.reserve, SYSTEMS[u.kind].stocks[st.type].load);
      p.rounds += n;
      st.reserve -= n;
    }
    st.reloadPart = -1;
  }

  // a vehicle of a dispersed unit is knocked out: its rounds are lost, a TELAR's engagements and the
  // rounds it guides are lost, the search radar goes dark, without the command post the link drops
  partDown(u, i) {
    const sim = this.sim;
    const p = u.parts[i];
    if (!p.alive) return;
    p.alive = false;
    p.hp = 0;
    p.rounds = 0;
    const st = u.weapons.missiles;
    if (st && st.reload > 0 && (st.reloadPart === i || i === u.loader)) {
      this.dropJob(u, st);
      st.reloadPart = -1;
    }
    if (p.role === 'telar') {
      p.track = false;
      p.target = null;
      p.locked = false;
      for (const e of u.engagements) if (e.guide === i && live(e)) {
        e.state = 'miss';
        e.endT = sim.time;
      }
      for (const m of sim.missiles) if (m.unitId === u.id && m.guide === i) m.blind = 99;
      u.radar.track = u.telars.some((j) => u.parts[j].track);
    }
    if (p.role === 'radar') u.radar.search = false;
    if (SYSTEMS[u.kind].mounts) this.mounts.partDown(u, i);
    syncRounds(u);
    sim.say(u, `${this.vehicleName(u, i)} knocked out`, 'alert');
    sim.events.partDestroyed?.(u, i);
  }

  // FIRE on the Strela: with a lock and the launcher on the target, the launcher swings to a small lead
  // and the round leaves about a second later (aimStrela)
  fireStrela(u, player) {
    const sim = this.sim;
    const st = u.weapons.missiles;
    const s = u.sight;
    const no = (why) => {
      if (player) sim.say(u, why, 'warn');
      return false;
    };
    if (st.ready <= 0) return no(st.reload > 0 ? 'reloading' : 'no missiles on the launcher');
    if (!s.uncaged || s.lock < 1 || !s.targetId) return no('no lock');
    if (u.fire || sim.time - u.launchT < SYSTEMS[u.kind].launchGap) return false;
    const t = sim.threatById.get(s.targetId);
    if (!t || !t.alive) return false;
    // the round leaves along the launcher
    if (!this.alignedTo(u, t.pos, 0.06)) return no('launcher not on the target');
    u.fire = { id: t.id, t: sim.time };
    return true;
  }

  // where the Strela's launcher swings on FIRE (world bearing and elevation into `out`): a couple of
  // degrees ahead along the target's motion, and up a little below 20 degrees elevation
  strelaLead(u, t, out) {
    _v.subVectors(t.pos, u.pos);
    const az = bearingOfDir(_v), el = elevOfDir(_v);
    _v.addScaledVector(t.vel, 0.8);
    out.az = (az + clamp(wrapPi(bearingOfDir(_v) - az), -0.05, 0.05) + TAU) % TAU;
    out.el = el + clamp(elevOfDir(_v) - el, -0.05, 0.05) + (el < 0.35 ? 0.035 : 0);
    return out;
  }

  // ---------------------------------------------------------------- launching
  launch(u, kind, t, e = null) {
    const sim = this.sim;
    const sys = SYSTEMS[u.kind];
    const st = u.weapons.stock[kind];
    const { part: partIndex, slot } = this.nextLauncher(u, kind, e);
    const part = u.parts[partIndex];
    if (sys.fc === 'telar') part.rounds--;
    else st.ready--;
    u.launchT = sim.time;
    _from.copy(part.pos);
    _from.y += sys.launchY;
    if (sys.vertical) _dir.set(0, 1, 0);
    else this.boreDir(u, _dir, part.turret ? partIndex : -1);
    const m = makeMissile(kind, u, t, _from, _dir, partIndex, slot);
    // which vehicle's channel guides it (a Buk: the engagement's TELAR, also for a loader-launcher round)
    m.guide = e?.guide ?? partIndex;
    // the first round at a new target starts the rate cap's clock (targetWait)
    if (sys.targetGap && !u.fired.has(t.id)) {
      for (const id of u.fired.keys()) if (!sim.threatById.get(id)?.alive) u.fired.delete(id);
      u.fired.set(t.id, sim.time);
      u.nextTarget = sim.time + sys.targetGap;
    }
    sim.addMissile(m);
    this.updateSlots(u);
    sim.events.launch?.(u, m, part);
    sim.stats.fired[kind] = (sim.stats.fired[kind] ?? 0) + 1;
    sim.score.cost += MISSILES[kind].cost;
    return m;
  }

  // between waves a supply column brings the reserves and the guns' ammunition back up to the full load
  resupply() {
    for (const u of this.sim.units) {
      if (!u.alive) continue;
      const sys = SYSTEMS[u.kind];
      for (const st of Object.values(u.weapons.stock)) st.reserve = Math.max(st.reserve, sys.stocks[st.type].reserve);
      if (u.weapons.gun) {
        u.weapons.gun.rounds = u.weapons.gun.max;
        u.weapons.gun.heat = 0;
      }
      if (sys.mounts) this.mounts.resupply(u);
      this.updateSlots(u);
    }
  }

  // after a change to the stocks (or, for a Buk, to a vehicle's rounds): rounds per vehicle and slots
  updateSlots(u) {
    syncRounds(u);
  }

  // ---------------------------------------------------------------- per frame
  update(dt) {
    const sim = this.sim;
    for (const u of sim.units) {
      if (!u.alive) {
        u.status = 'DESTROYED';
        u.alerts.length = 0;
        u.engagements.length = 0;
        u.radar.search = false;
        u.radar.track = false;
        u.channel.locked = false;
        u.channel.targetId = null;
        for (const p of u.parts) {
          p.alive = false;
          if (p.track) p.track = false;
          if (p.target) p.target = null;
          if (p.gun) p.gun.firing = false;
        }
        const g = u.weapons.gun;
        if (g) {
          g.firing = false;
          g.trigger = false;
          g.target = null;
          g.aimOk = false;
        }
        // a dead seeker gives no tone and no lock
        if (u.sight) {
          u.sight.uncaged = false;
          u.sight.lock = 0;
          u.sight.tone = 0;
          u.sight.targetId = null;
        }
        u.fire = null;
        // no reload goes on
        if (u.reloads.length) {
          u.reloads.length = 0;
          for (const st of Object.values(u.weapons.stock)) {
            st.job = null;
            st.held = 0;
            st.reload = 0;
          }
        }
        continue;
      }
      const sys = SYSTEMS[u.kind];
      // reloads: each job runs on its own clock and its rounds count at the end
      for (const st of Object.values(u.weapons.stock)) {
        const job = st.job;
        if (!job) continue;
        job.t += dt;
        st.reload = Math.max(0, job.dur - job.t);
        if (job.t < job.dur) continue;
        this.endJob(u, st);
        this.updateSlots(u);
        sim.say(u, 'reload complete', 'info');
      }
      // the S-400's stacks rise (at the start of a battle and after a reload); a TEL being reloaded
      // lowers its stack to the loading pose first (reloadPose.erect, in reloadPose.time seconds)
      const pose = sys.reloadPose;
      for (let i = 0; i < u.erect.length; i++) {
        if (pose?.erect != null && jobOn(u, i)) u.erect[i] = Math.max(pose.erect, u.erect[i] - dt / pose.time);
        else u.erect[i] = Math.min(1, u.erect[i] + dt / erectTime(i));
      }

      // a battery or platoon of gun mounts: sim/mounts.js
      if (sys.mounts) {
        this.mounts.update(u, dt);
        this.describe(u);
        continue;
      }
      this.designate(u);
      if (u.mode === 'auto') this.crew(u, dt);
      this.runEngagements(u, dt);
      if (u.weapons.gun) this.guns(u, dt);
      if (sys.sight?.seeker) this.seeker(u, dt);
      this.aimTurret(u, dt);
      // the guns fire along the bore the turret has just been laid on (not last step's)
      if (u.weapons.gun) this.fireGuns(u, dt);
      this.describe(u);
    }
  }

  runEngagements(u, dt) {
    const sim = this.sim;
    const sys = SYSTEMS[u.kind];
    const telar = sys.fc === 'telar';
    for (const e of u.engagements) {
      if (pending(e)) {
        const t = sim.threatById.get(e.trackId);
        const tr = this.trackOf(u, e.trackId);
        // the first round at a new target waits for the rate cap (targetWait); the launcher is laid on it
        e.wait = e.launched ? 0 : this.targetWait(u, e.trackId);
        if (!t || !t.alive || !tr || u.mode === 'hold' || (telar && !u.parts[e.guide].alive)) {
          e.state = e.launched ? 'flying' : 'miss';
          continue;
        }
        let L = null;
        if (telar) {
          // the TELAR points its radar and launcher at the target and holds it; a loader-launcher round
          // needs that launcher pointed too. A TELAR that cannot get the target (masked by terrain, its
          // radar switched off) gives it up after a while and is free again.
          if (!this.alignedTo(u, tr.pos, ALIGN, e.guide) || !this.sees(u, t, 'telar', e.guide)) {
            if (!e.launched && sim.time - e.t > sys.giveUp) e.state = 'miss';
            continue;
          }
          L = this.nextLauncher(u, e.type, e);
          e.state = 'launch';
          if (L.slot >= 0 && L.part !== e.guide && !this.alignedTo(u, tr.pos, ALIGN, L.part)) continue;
        } else {
          // short-range units must point the launcher and hold the target in a channel first (the round
          // leaves with the turret on it); vertical launchers need only the channel (the area unit
          // launches on its search track once erected). A turret crew that cannot get the target in
          // its channel gives it up after a while, so the guns are not kept off their targets.
          if (!sys.vertical) {
            const aligned = this.alignedTo(u, tr.pos, ALIGN);
            const held = this.channelSees(u, t, 'missile');
            if (!aligned || !held) {
              if (!e.launched && sim.time - e.t > (sys.giveUp ?? 12)) e.state = 'miss';
              // the channel lost the target between the rounds of a salvo: the rest stay on the launcher
              else if (e.launched && !held) e.state = 'flying';
              continue;
            }
          } else if (sys.fc !== 'search' && !this.channelSees(u, t, 'missile')) continue;
          // the vehicle the round leaves from must be fully raised (the TELs erect at different rates)
          if (sys.erectors && (u.erect[this.nextLauncher(u, e.type, e)?.part ?? 0] ?? 1) < 1) continue;
          e.state = 'launch';
        }
        const ready = () => (telar ? this.nextLauncher(u, e.type, e).slot >= 0 : u.weapons.stock[e.type].ready > 0);
        if (e.wait > 0) continue;
        if (sim.time - u.launchT >= sys.launchGap && e.launched < e.salvo && ready()) {
          const m = this.launch(u, e.type, t, e);
          e.missileIds.push(m.id);
          e.launched++;
        }
        if (e.launched >= e.salvo || !ready()) e.state = e.launched ? 'flying' : 'miss';
      } else if (e.state === 'flying') {
        if (!e.missileIds.some((id) => sim.missileById.get(id)?.alive)) {
          const t = sim.threatById.get(e.trackId);
          e.state = !t || !t.alive ? 'kill' : 'miss';
          e.endT = sim.time;
        }
      }
    }
    // keep finished engagements a few seconds for the consoles
    u.engagements = u.engagements.filter((e) => live(e) || sim.time - (e.endT ?? (e.endT = sim.time)) < 4);
    if (telar) {
      // each TELAR holds the target of its own engagement; the crew switches an idle radar off again
      for (const i of u.telars) {
        const p = u.parts[i];
        if (!p.alive) continue;
        const d = u.desig;
        p.target = u.engagements.find((e) => e.guide === i && live(e))?.trackId ?? (d.part === i && (d.state === 'held' || d.state === 'laying') ? d.id : null);
        if (u.mode === 'auto' && p.track && !p.target) {
          p.idle += dt;
          if (p.idle > 8) p.track = false;
        } else p.idle = 0;
      }
      u.radar.track = u.telars.some((i) => u.parts[i].track);
      return;
    }
    // the tracking radar goes quiet again when the AI crew has nothing in the air
    if (u.mode === 'auto' && sys.fc === 'track' && u.radar.track && this.activeEngagements(u) === 0 && !u.weapons.gun?.target && u.desig.state !== 'held') {
      u.trackIdle = (u.trackIdle ?? 0) + dt;
      if (u.trackIdle > 8) u.radar.track = false;
    } else u.trackIdle = 0;
  }

  // ---------------------------------------------------------------- designation
  // The selected track is handed to the unit's tracking channel, as an operator hands a target from the
  // search picture to the tracking radar: a free channel takes it, the turret (a Buk: the chosen or the
  // best free TELAR; the Strela: the launcher and sight) is laid on it and the channel locks. It is the
  // top priority in every mode (the crew in auto may engage it by its rules; in manual only the player
  // fires). A channel guiding a missile is never taken off it: while every channel guides one, or the
  // target lies outside a busy turret's sector, the designation waits ('queued') and is taken up when a
  // channel frees. The radar the channel needs is switched on, unless the player switched it off; then
  // only the turret is laid ('laying').
  designate(u) {
    const sim = this.sim;
    const sys = SYSTEMS[u.kind];
    const d = u.desig;
    if (d.id !== u.selected) {
      d.id = u.selected;
      d.state = null;
      d.part = -1;
      d.uncaged = false;
    }
    const prev = d.state;
    const t = d.id != null ? sim.threatById.get(d.id) : null;
    const tr = t?.alive ? this.trackOf(u, d.id) : null;
    let state = null, part = -1;
    if (tr) {
      const e = u.engagements.find((x) => live(x) && x.trackId === d.id);
      if (e) {
        state = 'engaged';
        part = e.guide ?? -1;
      } else if (sys.fc === 'telar') {
        // the TELAR the player picked (it waits while that one guides), else the best free one with line
        // of sight to it
        const pick = u.firePart != null && u.parts[u.firePart]?.alive ? u.firePart : -1;
        part = pick >= 0 ? (u.engagements.some((x) => x.guide === pick && live(x)) ? -1 : pick) : this.freeTelar(u, tr);
        state = part >= 0 ? 'held' : 'queued';
      } else if (u.lay) state = u.fire ? 'queued' : 'held';
      else if (u.weapons.missiles && (this.activeEngagements(u) >= this.channelCount(u) || !this.inSector(u, tr))) state = 'queued';
      else state = 'held';
      if (state === 'held') {
        // the radar the channel needs (none for an optical channel or the Strela)
        const need = sys.fc === 'search' ? 'search' : sys.fc === 'telar' ? 'telar' : sys.fc === 'track' && u.sight?.src !== 'eo' ? 'track' : null;
        const p = part >= 0 ? u.parts[part] : null;
        const on = need === 'search' ? u.radar.search : need === 'telar' ? p.track : need === 'track' ? u.radar.track : true;
        if (!on) {
          const silent = need === 'telar' ? p.silent : u.silent[need];
          if (silent || (need === 'search' && u.parts.some((x) => x.role === 'radar' && !x.alive))) state = 'laying';
          else if (need === 'search') u.radar.search = true;
          else if (need === 'telar') u.radar.track = p.track = true;
          else u.radar.track = true;
        }
      }
    }
    d.state = state;
    d.part = part;
    if (state === prev) return;
    if (state === 'queued') sim.say(u, 'channel busy, designation queued', 'info', 'desig' + u.id);
    else if (state === 'laying') sim.say(u, sys.fc === 'search' ? 'emitter off, designation not tracked' : 'radar off, laying on the designation only', 'info', 'desig' + u.id);
    else if (state === 'held' && prev === 'queued') sim.say(u, 'designated target taken up', 'info');
  }

  // ---------------------------------------------------------------- AI crews
  // Each crew works its own layer: the area unit takes aircraft, ballistic and cruise targets, bombs
  // and radar-seeking missiles, and leaves drones and helicopters to the short-range units unless they
  // come for it; the short-range units take what nobody else is on yet, drones only once they are
  // close, and units with guns leave what is inside gun range to them. They stay wasteful on purpose:
  // slow to react, they fire on decoys until the track shows what it is, the battalion keeps the big
  // missile selected for everything and nobody switches a radar off.
  crew(u, dt) {
    const sim = this.sim;
    const sys = SYSTEMS[u.kind];
    u.aiT -= dt;
    if (u.aiT > 0) return;
    u.aiT = 0.25;
    const now = sim.time;
    // the crew notices each track some time after it first shows up
    for (const tr of u.tracks) if (!u.seen.has(tr.id)) u.seen.set(tr.id, now);
    for (const id of u.seen.keys()) if (!u.tracks.some((t) => t.id === id)) u.seen.delete(id);

    if (sys.sight?.seeker) return this.strelaCrew(u);

    this.crewReload(u);
    // guns only: guns() lays them
    if (!u.weapons.missiles) return;
    // the S-400 crew falls back to the other missile type while the selected one reloads
    if (u.weapons.missiles.ready === 0) {
      const other = u.weapons.types.find((k) => u.weapons.stock[k].ready > 0);
      if (other) this.command(u, 'missileType', { type: other });
    }
    if (this.activeEngagements(u) >= this.channelCount(u) || u.weapons.missiles.ready <= 0 || now < u.aiNext) return;
    // under a rate cap the crew starts no engagement while one at a new target still waits for its first round
    if (sys.targetGap && u.engagements.some((e) => pending(e) && !e.launched && !u.fired.has(e.trackId))) return;

    // the player's designation comes first; the rest by urgency
    const desig = u.desig.id;
    const cands = u.tracks.filter((tr) => this.wants(u, tr, now)).sort((a, b) => (b.id === desig) - (a.id === desig) || this.priority(u, a) - this.priority(u, b));
    const type = u.weapons.missiles.type;
    const tr = cands.find((c) => {
      // a new target only once the rate cap allows it (a re-fire at one its round missed at once)
      if (this.targetWait(u, c.id) > 0) return false;
      const from = this.launchPoint(u, c);
      return from && inEnvelope(sim, type, from, c.pos, c.vel) && this.inSector(u, c, true);
    });
    if (!tr) return;
    const big = tr.cls === 'aircraft' || tr.cls === 'tbm' || tr.cls === 'helo';
    if (this.engage(u, tr.id, sys.salvo ?? (big ? 2 : 1))) u.aiNext = now + sys.tempo;
  }

  // would this crew take the track (before the envelope check)?
  wants(u, tr, now) {
    const sys = SYSTEMS[u.kind];
    if (now - u.seen.get(tr.id) < sys.react && tr.id !== u.desig.id) return false;
    if (tr.cls === 'decoy' || (tr.cls === 'unknown' && tr.quality < 0.6)) return false;
    if (u.engagements.some((e) => e.trackId === tr.id && e.state !== 'miss')) return false;
    if (!this.canHit(u.weapons.missiles.type, tr.cls)) return false;
    const t = this.sim.threatById.get(tr.id);
    const mine = t?.target?.id === u.id;
    // somebody else is on it already: leave it, unless it is about to hit this unit
    if (tr.engagedBy.length && !(mine && tr.tti < 12)) return false;
    const slow = tr.cls === 'drone' || tr.cls === 'helo' || tr.cls === 'atgm' || tr.cls === 'unknown';
    if (sys.area) return !slow || mine || tr.range < sys.close;
    // short-range units take drones close in; units with guns leave the last stretch (inside the guns'
    // opening range, gun.range), and drones that come for them, to the guns while they can fire
    const g = u.weapons.gun;
    const guns = !!g && g.rounds > 0 && !g.overheated;
    if (tr.cls === 'drone') {
      if (mine ? guns : tr.range > sys.close) return false;
      if (u.weapons.missiles.ready <= (sys.keep ?? 0)) return false;
    }
    if (guns && tr.range < sys.gun.range && tr.alt < sys.gun.maxAlt) return false;
    return true;
  }

  // lower is more urgent: radar-seeking missiles and anything coming at this unit, then time to
  // impact; the area unit puts ballistic targets and aircraft first and drones last
  priority(u, tr) {
    const sys = SYSTEMS[u.kind];
    const t = this.sim.threatById.get(tr.id);
    let p = Math.min(tr.tti, 600);
    if (t?.target?.id === u.id) p -= 200;
    if (tr.cls === 'arm' && sys.armFirst) p -= 150;
    if (sys.area) p += AREA_PREF[tr.cls] ?? 0;
    return p;
  }

  // empty launchers (or down to the rounds kept back from drones) are reloaded at once, part-empty
  // ones between raids; a Buk's loader-launcher does one vehicle at a time
  crewReload(u) {
    const sys = SYSTEMS[u.kind];
    const lull = this.sim.state !== 'wave';
    if (sys.fc === 'telar') {
      const st = u.weapons.missiles;
      if (st.reload > 0 || st.reserve <= 0 || !u.parts[u.loader]?.alive) return;
      const i = this.emptiest(u, st);
      if (i >= 0 && (lull || u.parts[i].rounds <= (sys.keep ?? 0))) this.loadVehicle(u, st, false, i);
      return;
    }
    for (const st of Object.values(u.weapons.stock)) {
      if (st.job || st.reserve <= 0 || st.ready + st.held >= st.max) continue;
      const i = this.emptiest(u, st);
      if (i < 0) continue;
      const p = u.parts[i];
      // an empty launcher vehicle at once (the S-400's other TELs fight on meanwhile)
      if (p.rounds > 0) {
        if (lull) {
          // between raids (short): a job that takes a TEL out for the whole reload time only for one at
          // most half full; a one-vehicle launcher tops up (its job is as short as the rounds it loads)
          if (sys.reloadPose?.erect != null && p.rounds > this.capOf(u, st.type, i) / 2) continue;
        } else if (st.ready > (sys.keep ?? 0) || this.busyNear(u)) continue; // in a raid: down to the kept rounds, and nothing near worth a missile
      }
      this.startJob(u, st, i);
    }
  }

  // is the crew busy: a round in the air or about to leave, or a target its missile would take inside
  // its reach (drones, decoys and unclassified tracks do not count)?
  busyNear(u) {
    const type = u.weapons.missiles?.type;
    const range = type ? MISSILES[type].range : 0;
    for (const tr of u.tracks) if (tr.cls !== 'decoy' && tr.cls !== 'drone' && tr.cls !== 'unknown' && tr.range < range) return true;
    return u.engagements.some(live);
  }

  // The Strela crew lays the launcher on the nearest close threat, uncages the seeker once the launcher
  // is on it and fires on the lock. A round is fire and forget, so the crew then takes the next target
  // nobody has a round on, and comes back to the first only if its round misses.
  strelaCrew(u) {
    const sim = this.sim;
    const sys = SYSTEMS[u.kind];
    const s = u.sight;
    const now = sim.time;
    this.crewReload(u);
    if (u.fire) return;
    const mine = (id) => u.engagements.some((e) => e.trackId === id && e.state === 'flying');
    const cur = s.targetId ? sim.threatById.get(s.targetId) : null;
    if (cur?.alive && s.uncaged && !mine(cur.id)) {
      if (s.lock >= 1) this.fireStrela(u, false);
      return;
    }
    if (u.weapons.missiles.ready === 0) {
      s.uncaged = false;
      return;
    }
    // cue onto the nearest close threat (from the link picture or by eye), preferring one nobody
    // else is engaging
    const eye = u.eyeSeen ?? (u.eyeSeen = new Map());
    for (const id of eye.keys()) if (!sim.threatById.get(id)?.alive) eye.delete(id);
    let best = null, bd = Infinity;
    // the player's designation first, if the crew can see it and has no round on it yet
    const des = u.desig.state === 'held' ? sim.threatById.get(u.desig.id) : null;
    if (des?.alive && !mine(des.id) && u.pos.distanceTo(des.pos) < sys.sight.range && sim.los(u.pos.x, u.pos.y + 3, u.pos.z, des.pos.x, des.pos.y, des.pos.z)) {
      best = des;
      bd = -Infinity;
    }
    for (const t of sim.threats) {
      if (!t.alive || t.type === 'decoy' || mine(t.id)) continue;
      const d = u.pos.distanceTo(t.pos);
      if (d > sys.close) continue;
      if (!eye.has(t.id)) eye.set(t.id, now);
      if (now - eye.get(t.id) < sys.react) continue;
      const score = d + (sim.engagedBy.get(t.id)?.length ? 2500 : 0);
      if (score > bd) continue;
      if (!sim.los(u.pos.x, u.pos.y + 3, u.pos.z, t.pos.x, t.pos.y, t.pos.z)) continue;
      best = t;
      bd = score;
    }
    // nothing new: the seeker stays caged and the launcher on the last cue
    if (!best) {
      s.uncaged = false;
      return;
    }
    u.aiCueId = best.id;
    // the seeker locks on what the launcher points at, so it is uncaged once the launcher is on the cue
    s.uncaged = this.alignedTo(u, best.pos, sys.sight.seeker * 2);
  }

  // the Strela's seeker: uncaged, it locks onto the hottest target inside its small cone around the
  // launcher's axis (the seekers are caged along their containers); the lock builds faster on hot, close
  // targets, and once locked it holds the target in a wider cone while the launcher follows it. A game
  // rule, not a seeker model.
  seeker(u, dt) {
    const sim = this.sim;
    const s = u.sight;
    const sys = SYSTEMS[u.kind].sight;
    if (!s.uncaged) {
      s.lock = Math.max(0, s.lock - dt * 2);
      s.tone = s.lock * 0.3;
      s.targetId = null;
      return;
    }
    this.boreDir(u, _dir);
    let best = null, bestSig = 0;
    for (const t of sim.threats) {
      if (!t.alive) continue;
      _v.subVectors(t.pos, u.pos);
      const d = _v.length();
      if (d > sys.range) continue;
      const ang = Math.acos(clamp(_v.dot(_dir) / d, -1, 1));
      const cone = t.id === s.targetId && s.lock >= 1 ? sys.seeker * 2.5 : sys.seeker;
      if (ang > cone) continue;
      const sig = t.ir * (1 - d / sys.range) * (1 - ang / cone * 0.5);
      if (sig > bestSig && sim.los(u.pos.x, u.pos.y + 3, u.pos.z, t.pos.x, t.pos.y, t.pos.z)) {
        best = t;
        bestSig = sig;
      }
    }
    if (best) {
      if (best.id !== s.targetId) {
        s.targetId = best.id;
        s.lock = Math.min(s.lock, 0.3);
      }
      s.lock = Math.min(1, s.lock + dt * (0.35 + bestSig * 1.6));
      s.tone = 0.35 + 0.65 * Math.min(1, bestSig * 1.5);
    } else {
      s.lock = Math.max(0, s.lock - dt * 1.5);
      s.tone = Math.max(0.12, s.tone - dt);
      if (s.lock === 0) s.targetId = null;
    }
  }

  // ---------------------------------------------------------------- guns (Pantsir, Tunguska, Shilka)
  // The guns' fire control. The gun target is the crew's pick in auto (the most urgent track coming into
  // gun range that the guns may have the turret for: while a missile channel or a designation keeps it,
  // only inside 80 % of the channel's sector around that), the player's selection in manual. The guns'
  // channel (the tracking radar or the EO sight) holds it (`locked`), and only then is there a lead,
  // worked out from that channel's own measured track (velocity smoothed, its rate of change bending the
  // lead) by flying a shell through the game's own ballistics (solveLead). aimTurret lays the guns on the
  // lead all the time, before, during and between bursts (`laid` while they have the turret); fireGuns
  // fires after the turret has moved, the crew only while the bore is on the lead. `hold` says why the
  // guns cannot fire on their target (null when they can).
  guns(u, dt) {
    const sim = this.sim;
    const sys = SYSTEMS[u.kind];
    const g = u.weapons.gun;
    const gs = sys.gun;
    g.heat = Math.max(0, g.heat - dt / 14);
    if (g.overheated && g.heat < 0.55) g.overheated = false;
    // the AI takes the most urgent target coming into gun range and opens fire inside it (further out
    // the shells slow down and the crew would only waste them)
    if (u.mode === 'auto') {
      const may = (tr) => this.gunsMay(u, tr, this.turretBase(u, _m, tr.id));
      // the player's designation is their target whenever it is one they would take
      const des = u.desig.state === 'held' ? this.trackOf(u, u.desig.id) : null;
      if (des && des.range <= gs.range * 1.2 && des.alt <= gs.maxAlt && des.cls !== 'decoy' && may(des)) g.target = des.id;
      const cur = this.trackOf(u, g.target);
      if (!cur || cur.range > gs.range * 1.3 || !sim.threatById.get(g.target)?.alive || !may(cur)) {
        g.target = null;
        let best = null;
        for (const tr of u.tracks) {
          if (tr.range > gs.range * 1.2 || tr.alt > gs.maxAlt || tr.cls === 'unknown' || tr.cls === 'decoy') continue;
          if (sim.time - (u.seen.get(tr.id) ?? sim.time) < sys.react) continue;
          if (!may(tr)) continue;
          if (!best || this.priority(u, tr) < this.priority(u, best)) best = tr;
        }
        g.target = best?.id ?? null;
      }
    } else if (u.mode === 'hold') g.target = null;

    const t = g.target != null ? sim.threatById.get(g.target) : null;
    // the tracking radar comes on for the guns' channel, unless the player switched it off (the Shilka
    // then lays its guns by the optical sight)
    if (t?.alive && sys.track && u.sight?.src !== 'eo' && !u.radar.track && !u.silent.track) u.radar.track = true;
    _from.copy(u.pos);
    _from.y += gs.height;
    // the fire control works from its channel's own fresh measurement of the target, nothing else
    const own = t?.alive ? u.trackMap.get(g.target) : null;
    g.locked = !!own?.n && sim.time - own.lastSeen < 0.4 && this.channelSees(u, t, 'gun');
    this.gunEstimate(g, own, dt);
    // how long the channel has held this target without a break (the crew's solution settles over it)
    g.lockT = g.locked && g.lockId === g.target ? g.lockT + dt : 0;
    g.lockId = g.target;
    g.aimOk = false;
    g.tof = 0;
    const kind = SHELLS[gs.shell];
    if (g.locked && _from.distanceTo(own.pos) < reachOf(kind) * 1.5) {
      // the smoothed velocity lags the target's by about GUN_LAG s: its rate of change brings it up to date
      _v.copy(g.est.vel).addScaledVector(g.est.acc, GUN_LAG);
      const tof = solveLead(kind, _from, own.pos, _v, g.aim, g.est.acc);
      g.aimOk = tof >= 0;
      g.tof = Math.max(tof, 0);
    }
    // (aimTurret adds 'turret on the missile target' when the missile channel keeps the turret)
    // (unlocked, a target beyond the shells' straight-line reach is out of reach as well)
    const far = !g.locked && (this.trackOf(u, g.target)?.range ?? 0) > reachOf(kind);
    g.hold = g.target == null ? null : !t?.alive ? 'target lost' : !g.locked ? (far ? OUT_OF_REACH : 'no lock') : !g.aimOk ? OUT_OF_REACH : null;
  }

  // The fire control's estimate of the target's motion from the channel's track: the velocity smoothed
  // over GUN_VEL s (no jumps when the channel re-measures), and its rate of change smoothed over GUN_ACC s
  // and capped (a turning, diving or speeding target bends the lead). It starts afresh on a new target
  // and whenever the channel has lost it.
  gunEstimate(g, own, dt) {
    const e = g.est;
    if (!g.locked) {
      e.n = 0;
      return;
    }
    if (e.id !== g.target || !e.n) {
      e.id = g.target;
      e.n = 1;
      e.vel.copy(own.vel);
      e.acc.set(0, 0, 0);
      return;
    }
    e.n++;
    _a.copy(e.vel);
    e.vel.lerp(own.vel, 1 - Math.exp(-dt / GUN_VEL));
    _a.subVectors(e.vel, _a).divideScalar(dt);
    e.acc.lerp(_a, 1 - Math.exp(-dt / GUN_ACC));
    if (e.acc.lengthSq() > GUN_ACC_MAX * GUN_ACC_MAX) e.acc.setLength(GUN_ACC_MAX);
  }

  // where a missile channel (missileAim) or a designation that is not the guns' target keeps the turret:
  // the direction from the unit into `out`, or null when nothing does
  turretBase(u, out, gunTarget = u.weapons.gun?.target) {
    const des = this.desigTrack(u);
    if (this.missileAim(u, out, des)) return out;
    return des && des.id !== gunTarget ? out.subVectors(des.pos, u.pos) : null;
  }

  // may the guns have the turret for track `tr` while `base` (turretBase) keeps it? Only inside 80 % of
  // the channel's sector around it, and never while a round is about to leave
  gunsMay(u, tr, base) {
    if (!base) return true;
    if (u.engagements.some(pending)) return false;
    return Math.abs(wrapPi(bearingOfDir(_s.subVectors(tr.pos, u.pos)) - bearingOfDir(base))) < this.sectorOf(u) * 0.8;
  }

  // is the bore on the lead, within GUN_LAID metres of it at its range? (`_from`: the guns' mount)
  onLead(u, g) {
    _e.subVectors(g.aim, _from);
    const d = _e.length();
    return this.boreDir(u, _s).dot(_e) > d * Math.cos(clamp(GUN_LAID / d, GUN_LAID_MIN, GUN_LAID_MAX));
  }

  // The guns fire along the bore the turret was laid on this step: the crew in bursts with pauses (a
  // fire-control computer re-laying between them), and only while the bore is on the lead (a burst stops
  // when it is not and goes on once it is back); the player while the trigger is held, wherever the guns
  // point, unless the missile channel keeps the turret off the gun target.
  fireGuns(u, dt) {
    const sim = this.sim;
    const sys = SYSTEMS[u.kind];
    const g = u.weapons.gun;
    const gs = sys.gun;
    _from.copy(u.pos);
    _from.y += gs.height;
    let want = false;
    if (u.mode === 'auto') {
      const tr = g.laid && g.aimOk ? this.trackOf(u, g.target) : null;
      const on = !!tr && tr.range < gs.range && g.lockT >= (gs.settle ?? 0) && this.onLead(u, g);
      // fire discipline: full bursts and pauses inside half the opening range; farther out, where the
      // shells take long to arrive and scatter, shorter bursts and longer pauses (half and twice at gun.range)
      const k = on ? clamp(1.5 - tr.range / gs.range, 0.5, 1) : 1;
      if (g.burst <= 0 && (g.cool -= dt) <= 0 && on) g.burst = gs.burst * k;
      if (g.burst > 0 && on) {
        want = true;
        if ((g.burst -= dt) <= 0) g.cool = gs.cool / k;
      }
    } else if (u.mode === 'manual' && g.trigger) {
      // the player's trigger too holds while the shells cannot reach the target (the console greys it out)
      want = g.hold !== TURRET_HELD && g.hold !== OUT_OF_REACH;
      if (g.hold === TURRET_HELD) sim.say(u, 'guns held: the turret is on the missile target', 'warn', 'gunheld' + u.id);
      else if (g.hold === OUT_OF_REACH) sim.say(u, 'guns held: the target is out of range', 'warn', 'gunfar' + u.id);
    }
    g.firing = want && g.rounds > 0 && !g.overheated;
    if (!g.firing) return;

    const n = Math.min(g.rounds, Math.round(gs.rate * dt + sim.rng() * 0.5));
    const heading = u.heading + u.turret.az;
    // the dispersion grows with the range to the lead (or the target): the shell's `grow` per km, a game
    // value for the rounds' own scatter and the fire control's errors building up over a long flight
    const shell = SHELLS[gs.shell];
    const km = (g.aimOk ? _e.subVectors(g.aim, _from).length() : g.target != null ? this.trackOf(u, g.target)?.range ?? 0 : 0) / 1000;
    const spread = shell.spread * (gs.spread ?? 1) * 2 * (1 + (shell.grow ?? 0) * km);
    // what a hit does: the gun's own scale, and the difficulty's, as it scales the missiles' hit chances
    const dmg = (gs.dmg ?? 1) * (sim.difficulty?.hit ?? 1);
    for (let i = 0; i < n; i++) {
      const side = (g.rounds + i) % 2 ? 1 : -1;
      _v.set(Math.cos(heading) * side * gs.side, 0, -Math.sin(heading) * side * gs.side).add(_from);
      // the barrels follow the turret; the shells go where the guns point, with dispersion
      this.boreDir(u, _dir);
      _dir.x += (sim.rng() - 0.5) * spread;
      _dir.y += (sim.rng() - 0.5) * spread;
      _dir.z += (sim.rng() - 0.5) * spread;
      sim.ballistics.fire(gs.shell, _v, _dir.normalize(), u.mode === 'manual' ? OWNER.PLAYER : OWNER.AI, u.index, { dmg, rng: sim.rng });
    }
    g.rounds -= n;
    g.heat = Math.min(1, g.heat + dt / 9);
    if (g.heat >= 1) {
      g.overheated = true;
      sim.say(u, 'guns overheated', 'warn', 'heat' + u.id);
    }
    u.gunEventT = (u.gunEventT ?? 0) - dt;
    if (u.gunEventT <= 0) {
      u.gunEventT = 0.05;
      sim.events.gun?.(u, _from, this.boreDir(u, _dir));
    }
  }

  // the bore of the unit's turret (or of one Buk launcher vehicle's)
  boreDir(u, out, part = -1) {
    const tu = part >= 0 ? u.parts[part].turret : u.turret;
    const h = u.heading + tu.az, e = tu.el;
    return out.set(-Math.sin(h) * Math.cos(e), Math.sin(e), -Math.cos(h) * Math.cos(e));
  }

  // is the launcher (of the unit, or one Buk vehicle) on the point within `tol` (rad; 1.5 times that in
  // elevation, inside the launcher's limits)? A tracking antenna of its own must be on it too.
  alignedTo(u, p, tol, part = -1) {
    const sys = SYSTEMS[u.kind];
    if (sys.vertical) return true;
    const tu = part >= 0 ? u.parts[part].turret : u.turret;
    _v.subVectors(p, part >= 0 ? u.parts[part].pos : u.pos);
    const az = turretAz(u, bearingOfDir(_v));
    const el = elevOfDir(_v);
    const lel = clamp(el, sys.minEl ?? -1, sys.maxEl ?? 1.4);
    if (sys.antenna && part < 0 && Math.abs(el - tu.trackEl) > tol * 1.5) return false;
    return Math.abs(wrapPi(az - tu.az)) < tol && Math.abs(lel - tu.el) < tol * 1.5;
  }

  // turn a turret toward world direction `d` (from its vehicle) at the system's slew rates, inside its
  // elevation limits
  slewTo(sys, u, tu, d, dt, minEl = sys.minEl ?? -0.05, maxEl = sys.maxEl ?? 1.4) {
    const az = turretAz(u, bearingOfDir(d));
    const el = clamp(elevOfDir(d), minEl, maxEl);
    tu.az = wrapPi(tu.az + clamp(wrapPi(az - tu.az), -sys.turnAz * dt, sys.turnAz * dt));
    tu.el += clamp(el - tu.el, -sys.turnEl * dt, sys.turnEl * dt);
  }

  // the engagement whose target the missile channel holds first: one about to launch, else one in flight
  firstLive(u) {
    return u.engagements.find(pending) ?? u.engagements.find((e) => e.state === 'flying') ?? null;
  }

  // where the missile channels want the turret, into `out` (from the unit; false with nothing live): the
  // target of an engagement about to launch (the round leaves along the bore), else the middle of the
  // live engagements for a turret-mounted array that holds several inside its sector (vertical
  // launchers only turn the array, so always the middle), else the one in flight
  missileAim(u, out, des = null) {
    const sys = SYSTEMS[u.kind];
    if (!sys.vertical || !sys.track?.sector) {
      const e = this.firstLive(u);
      const tr = e && (pending(e) || !sys.track?.sector) ? this.trackOf(u, e.trackId) : null;
      if (tr) {
        out.subVectors(tr.pos, u.pos);
        return true;
      }
    }
    if (!sys.track?.sector) return false;
    _sum.set(0, 0, 0);
    for (const e of u.engagements) {
      const tr = live(e) ? this.trackOf(u, e.trackId) : null;
      if (tr) _sum.add(_s.subVectors(tr.pos, u.pos).normalize());
    }
    if (_sum.lengthSq() === 0) return false;
    // a designation a free channel holds inside the sector joins the middle
    if (des) _sum.add(_s.subVectors(des.pos, u.pos).normalize());
    out.copy(_sum);
    return true;
  }

  // the designated track the turret is laid on (a channel holds it, or its radar is off), or null
  desigTrack(u) {
    const d = u.desig;
    return d.state === 'held' || d.state === 'laying' ? this.trackOf(u, d.id) : null;
  }

  // Turrets follow the missile channels first: a round leaves with the turret on its target, and a
  // command-guided round in flight needs the tracking channel (and so the turret) on its target. Then
  // the player's designation (designate: a free channel holds it, inside the sector when the turret is
  // busy; the guns' lead when it is their target and inside their reach). The guns take the turret off
  // either only for a target inside the channel's sector around it, and not while a round is about to
  // leave. Then the gun target (its lead inside the guns' reach, the target itself beyond), then an EO
  // sight the player is slewing; with nothing to follow they hold where they are (releasing the trigger
  // or losing the target never swings them back). The Osa's tracking antenna elevates on its own and
  // follows only while its radar emits; the Strela has its own (aimStrela).
  aimTurret(u, dt) {
    const sim = this.sim;
    const sys = SYSTEMS[u.kind];
    if (sys.fc === 'telar') return this.aimLaunchers(u, dt);
    if (!sys.turnAz) return;
    const g = u.weapons.gun;
    if (g) g.laid = false;
    if (this.reloadPose(u, dt)) return;
    if (u.lay) return this.aimStrela(u, dt);
    const slewing = u.mode === 'manual' && sim.time - (u.manualSlewT ?? -9) <= 3;
    // the guns, from their mount: on the lead while the fire control has one, else on the target's track
    // (to bring it into the channel)
    let gun = false;
    const gtr = g?.target != null ? this.trackOf(u, g.target) : null;
    if (gtr) {
      _from.copy(u.pos);
      _from.y += sys.gun.height;
      gun = !!_g.subVectors(g.aimOk ? g.aim : gtr.pos, _from);
    }
    const des = this.desigTrack(u);
    // a missile channel or a designation keeps the turret; the guns take it off them only with a lead,
    // for a target inside the channel's sector around it (gunsMay)
    const base = this.turretBase(u, _m);
    let aim = base;
    if (gun && (!base || (g.aimOk && this.gunsMay(u, gtr, base)))) aim = _g;
    if (!aim && u.sight && slewing) aim = sightDir(u.sight, _v);
    if (g) {
      g.laid = gun && aim === _g;
      if (gun && !g.laid && !g.hold) g.hold = TURRET_HELD;
    }
    if (sys.antenna) {
      // with its radar off the antenna holds where it is, and the turret with it, unless a round is
      // about to leave or the player designates a target (then the turret alone is laid on it)
      const laying = !!des && aim === _m && !u.engagements.some(live);
      if (aim && !u.radar.track && !u.engagements.some(pending) && !laying) aim = null;
      if (aim && u.radar.track) u.turret.trackEl += clamp(elevOfDir(aim) - u.turret.trackEl, -sys.turnEl * dt, sys.turnEl * dt);
    }
    if (!aim && sys.restEl != null) {
      // with nothing to engage the Osa crew holds its launcher panels raised, as the real one stands ready
      u.turret.el += clamp(sys.restEl - u.turret.el, -sys.turnEl * dt, sys.turnEl * dt);
    }
    if (aim) this.slewTo(sys, u, u.turret, aim, dt);
    // an EO sight holds the missile channel's target first (an optical channel guides the rounds with
    // it), then the designation, then the gun target; with none it looks along the bore, and the
    // player's slew overrides it
    if (sys.eo && !slewing) {
      const s = u.sight;
      const tr = this.trackOf(u, this.firstLive(u)?.trackId ?? (des ? u.desig.id : g?.target));
      let az, el;
      if (tr) {
        _v.subVectors(tr.pos, u.pos);
        _v.y -= sys.gun?.height ?? 3;
        az = bearingOfDir(_v);
        el = elevOfDir(_v);
      } else {
        az = (-(u.heading + u.turret.az) % TAU + TAU) % TAU;
        el = u.turret.el;
      }
      const k = 3 * dt;
      s.az = (s.az + clamp(wrapPi(az - s.az), -k, k) + TAU) % TAU;
      s.el += clamp(el - s.el, -k, k);
      this.clampSight(u);
    }
  }

  // The Strela: the sight looks along the launcher (its head prism is linked to the cradle), so the crew
  // aims the whole launcher. It is laid on `u.lay`, which the player moves with `slew` and the AI crew
  // puts on its cue; a designation lays it on the designated track (once it is on it the seeker is
  // uncaged, once: U still cages it), a locked seeker drags it along with its target, and on FIRE it
  // swings to a small lead, brakes, and the round leaves.
  aimStrela(u, dt) {
    const sim = this.sim;
    const sys = SYSTEMS[u.kind];
    const s = u.sight;
    const lay = u.lay;
    const ft = u.fire ? sim.threatById.get(u.fire.id) : null;
    if (u.fire && (!ft?.alive || !s.uncaged || s.lock < 1 || u.mode === 'hold')) u.fire = null;
    const cur = s.targetId ? sim.threatById.get(s.targetId) : null;
    const cue = u.mode === 'auto' && u.aiCueId != null ? sim.threatById.get(u.aiCueId) : null;
    // the designation, unless the crew in auto already has a round on it and has moved on
    const d = u.desig;
    const des = d.state === 'held' ? sim.threatById.get(d.id) : null;
    const desOn = des?.alive && !(u.mode === 'auto' && u.engagements.some((e) => e.trackId === d.id && e.state === 'flying'));
    if (u.fire) this.strelaLead(u, ft, lay);
    else if (desOn) {
      _v.subVectors(des.pos, u.pos);
      lay.az = bearingOfDir(_v);
      lay.el = elevOfDir(_v);
    } else if (cur?.alive && s.lock >= 1) {
      _v.subVectors(cur.pos, u.pos);
      lay.az = bearingOfDir(_v);
      lay.el = elevOfDir(_v);
    } else if (cue?.alive) {
      _v.subVectors(cue.pos, u.pos);
      lay.az = bearingOfDir(_v);
      lay.el = elevOfDir(_v);
    }
    this.slewTo(sys, u, u.turret, sightDir(lay, _v), dt);
    s.az = (-(u.heading + u.turret.az) % TAU + TAU) % TAU;
    s.el = u.turret.el;
    if (desOn && !d.uncaged && u.mode !== 'hold' && u.weapons.missiles.ready > 0 && this.alignedTo(u, des.pos, sys.sight.seeker * 2)) {
      s.uncaged = true;
      d.uncaged = true;
    }
    if (!u.fire) return;
    const since = sim.time - u.fire.t;
    const on = Math.abs(wrapPi(turretAz(u, lay.az) - u.turret.az)) < 0.01 && Math.abs(clamp(lay.el, -0.05, 1.4) - u.turret.el) < 0.01;
    if ((on && since > 0.5) || since > 1.1) {
      const st = u.weapons.missiles;
      const m = this.launch(u, st.type, ft);
      u.engagements.push({ trackId: ft.id, missileIds: [m.id], state: 'flying', salvo: 1, launched: 1, nextT: 0, type: st.type, t: sim.time });
      u.fire = null;
    }
  }

  // a Buk: every TELAR turns to the target of its own engagement while its radar emits (its radar is
  // on the turret: switched off, it holds where it is), the loader-launcher to the one it fires for
  // next; otherwise they hold where they are
  aimLaunchers(u, dt) {
    const sys = SYSTEMS[u.kind];
    u.parts.forEach((p, i) => {
      if (!p.turret || !p.alive) return;
      if (this.reloadPose(u, dt, i, p.turret)) return;
      let tr = null;
      // (with its radar off it still lays its turret on a designation it takes)
      if (p.role === 'telar') tr = p.track || (p.target != null && p.target === u.desig.id) ? this.trackOf(u, p.target) : null;
      else {
        const e = u.engagements.find((x) => pending(x) && this.nextLauncher(u, x.type, x).part === i);
        tr = e ? this.trackOf(u, e.trackId) : null;
      }
      if (tr) this.slewTo(sys, u, p.turret, _v.subVectors(tr.pos, p.pos), dt, sys.minEl);
    });
  }

  describe(u) {
    const sim = this.sim;
    const sys = SYSTEMS[u.kind];
    const st = u.weapons.missiles;
    // the channel holds an engagement's target first, then the gun target, then the Strela seeker's; a
    // Buk: the first TELAR holding its target (each TELAR says whether it holds its own in `locked`)
    const c = u.channel;
    c.locked = false;
    c.targetId = null;
    if (sys.fc === 'telar') {
      for (const i of u.telars) {
        const p = u.parts[i];
        const t = p.target ? sim.threatById.get(p.target) : null;
        p.locked = !!t?.alive && this.sees(u, t, 'telar', i);
        if (p.locked && !c.locked) {
          c.locked = true;
          c.targetId = p.target;
        }
      }
    } else {
      // the missile channels first (they keep the turret), then the guns', then the Strela seeker's
      for (const id of this.channelTargets(u)) {
        const t = sim.threatById.get(id);
        if (!t?.alive || !this.channelSees(u, t)) continue;
        c.locked = true;
        c.targetId = id;
        break;
      }
    }
    const engaging = this.activeEngagements(u) > 0 || u.weapons.gun?.firing;
    u.status = u.mode === 'hold' ? 'HOLD FIRE'
      : engaging ? 'ENGAGING'
      : st?.reload > 0 ? 'RELOADING'
      : (sys.search || sys.track) && !u.radar.search && !u.radar.track ? 'SILENT'
      : u.tracks.length ? 'TRACKING' : 'READY';
    const a = u.alerts;
    a.length = 0;
    for (const t of sim.threats) {
      if (!t.alive || t.target?.id !== u.id) continue;
      if (t.type === 'arm' && !a.includes('ARM INBOUND')) a.push('ARM INBOUND');
      if (t.type === 'atgm' && !a.includes('ATGM INBOUND')) a.push('ATGM INBOUND');
      if ((t.type === 'cruise' || t.type === 'drone') && t.pos.distanceTo(u.pos) < 6000 && !a.includes('INBOUND')) a.push('INBOUND');
    }
    const total = Object.values(u.weapons.stock).reduce((s, x) => s + x.ready + x.reserve, 0);
    const max = Object.values(sys.stocks).reduce((s, x) => s + x.ready + x.reserve, 0);
    if (max > 0 ? total <= max * 0.25 : u.weapons.gun && u.weapons.gun.rounds <= u.weapons.gun.max * 0.25) a.push('LOW AMMO');
    if (u.hp < u.maxHp * 0.5) a.push('DAMAGED');
    if (!sim.link && !sys.area) a.push('NO LINK');
    if (u.weapons.gun?.overheated) a.push('OVERHEAT');
    for (const p of u.parts) {
      if (p.alive || p.hp == null) continue;
      const k = { telar: 'TELAR DOWN', loader: 'LOADER DOWN', radar: 'RADAR DOWN', cp: 'CP DOWN', gun: 'GUN DOWN', close: 'GUN DOWN', predictor: 'PREDICTOR DOWN' }[p.role];
      if (k && !a.includes(k)) a.push(k);
    }
    if (sys.mounts) this.mounts.alerts(u);
  }
}

export { THREATS };
