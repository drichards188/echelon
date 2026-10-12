import * as THREE from 'three';
import { buildVehicle } from '../models/vehicles.js';
import { buildAsset } from '../models/site.js';
import { headingFor } from '../deploy.js';
import { ReloadScenes } from './reload.js';

// The fire units and the airbase in the world, bound to the simulation's state: turrets, elevation,
// search antennas following `radar.sweep`, the S-400 erectors, which launcher slots still hold a
// round, and wrecks and fires once something is destroyed or hit hard. The rigs are built for the
// units in play; `reset(sim)` rebuilds them when the loadout changed (see DESIGN.md, "Loadout").

const _p = new THREE.Vector3();
const _d = new THREE.Vector3();
const clamp = THREE.MathUtils.clamp;
const wrapPi = (a) => {
  a = (a + Math.PI) % (Math.PI * 2);
  return (a < 0 ? a + Math.PI * 2 : a) - Math.PI;
};
// an angle toward a goal by the wrapped difference, at most `rate` rad/s
const turnTo = (cur, goal, rate, dt) => wrapPi(cur + clamp(wrapPi(goal - cur), -rate * dt, rate * dt));
// a value toward a goal at most `rate` per second
const moveTo = (cur, goal, rate, dt) => cur + clamp(goal - cur, -rate * dt, rate * dt);
const live = (e) => e.state === 'aligning' || e.state === 'launch' || e.state === 'flying';

const DEPLOY_TIME = 7; // s: radars and masts rise at the start of a battle
const FOLD_TIME = 5; // s: and fold when the vehicle is knocked out
const SPIN_CATCH = 1.2; // rad/s: an antenna that starts to turn closes on the sweep's angle at this rate
const SECTOR = 0.7; // rad: the 92N6E turns only for a target this far off its facing
const SECTOR_RATE = 0.25; // rad/s: its slew
const HATCH_OPEN = 3; // s: a Tor cell's lid stays open after its round left
// the vehicles whose radars and masts stand up at the start of a battle (the others stand in action:
// the Buk launchers' travel locks stay folded)
const RAISED = new Set(['buk-radar', 'tor', 'tunguska', 'shilka']);

// The units' signature: a new one (another loadout) means new rigs.
const signature = (sim) => sim.units.map((u) => `${u.id}:${u.parts.map((p) => p.kind).join('+')}`).join(',');

export class UnitViews {
  constructor(scene, sim) {
    this.scene = scene;
    this.views = new Map();
    // the reload scenes (render/reload.js), built with the rigs and driven after them every frame
    this.reloads = new ReloadScenes(scene, this);
    this.build(sim);
    this.assets = new Map();
    for (const a of sim.assets) {
      const g = buildAsset(a);
      g.position.copy(a.pos);
      g.rotation.y = headingFor(a.bearing);
      scene.add(g);
      this.assets.set(a.id, g);
    }
    this.fireT = 0;
  }

  build(sim) {
    this.sig = signature(sim);
    for (const u of sim.units) {
      const rigs = u.parts.map((part) => {
        const rig = buildVehicle(part.kind);
        this.scene.add(rig.root);
        rig.loaded = [];
        return rig;
      });
      this.views.set(u.id, { rigs, dead: false, spin: 0 });
    }
    this.place(sim);
    this.reloads.build(sim);
  }

  // the rigs of the units no longer in play: off the scene, their geometry freed (materials and
  // textures are shared between the builds and stay)
  dispose() {
    this.reloads.dispose();
    for (const v of this.views.values()) {
      for (const rig of v.rigs) {
        this.scene.remove(rig.root);
        rig.root.traverse((o) => o.geometry?.dispose());
      }
    }
    this.views.clear();
  }

  // every vehicle where the sim stands it, intact, its radars and masts folded for the march (they
  // rise at the start of the battle), launchers full
  place(sim) {
    this.reloads.reset(sim);
    for (const u of sim.units) {
      const v = this.views.get(u.id);
      v.dead = false;
      v.sector = 0;
      v.rigs.forEach((rig, i) => {
        rig.root.position.copy(u.parts[i].pos);
        rig.root.rotation.set(0, u.parts[i].heading, 0);
        rig.loaded.length = 0;
        rig.wreck = false;
        rig.clock = 0;
        rig.opened = [];
        rig.hatch = [];
        rig.spin = { a: 0, on: false };
        rig.track = { yaw: 0, nod: 0 };
        if (rig.pivots.searchRadar && rig.setDeploy) rig.pivots.searchRadar.rotation.y = 0;
        if (rig.pivots.trackRadar && rig.setDeploy) rig.pivots.trackRadar.rotation.y = 0;
        if (rig.pivots.trackRadarNod) rig.pivots.trackRadarNod.rotation.x = 0;
        if (rig.pivots.launcher) rig.pivots.launcher.rotation.x = 0;
        // staggered a little so a battery does not move as one
        rig.deploy = rig.setDeploy && RAISED.has(rig.root.name) ? -Math.random() * 1.5 / DEPLOY_TIME : 1;
        rig.deployed = null;
        this.deploy(rig, rig.deploy);
      });
    }
  }

  deploy(rig, v) {
    const k = clamp(v, 0, 1);
    if (rig.deployed === k || !rig.setDeploy) return;
    rig.deployed = k;
    rig.setDeploy(k);
  }

  // the camera anchor of one of the unit's vehicles (the first by default)
  eye(unitId, part = 0) {
    const rigs = this.views.get(unitId)?.rigs;
    return (rigs?.[part] ?? rigs?.[0])?.anchors.eye ?? null;
  }

  // world position of the unit's sight (Pantsir EO block, Strela operator sight), or its eye
  sightPos(unitId, out = _p) {
    const r = this.views.get(unitId)?.rigs[0];
    const a = r?.anchors.sight ?? r?.anchors.eye;
    if (!a) return null;
    a.updateWorldMatrix(true, false);
    return out.setFromMatrixPosition(a.matrixWorld);
  }

  muzzles(unitId) {
    return this.views.get(unitId)?.rigs[0].anchors.muzzles ?? [];
  }

  // the rig of one of the unit's vehicles (for a launch: its canister mouths and covers)
  launcher(unitId, part = 0) {
    return this.views.get(unitId)?.rigs[part] ?? null;
  }

  // what each launcher carries, from the sim's racks ({ type: [[part, rounds, per slot], ...] } per
  // system): a TEL whose canisters hold 9M96 packs shows a cover per cell instead of the 48N6 dome
  payloads(sim, systems) {
    for (const u of sim.units) {
      const racks = systems[u.kind]?.racks;
      if (racks) for (const [type, list] of Object.entries(racks)) for (const [i] of list) this.launcher(u.id, i)?.setPayload?.(type);
    }
  }

  // a new game: everything stands again; another loadout gets its own rigs. Returns true when the rigs
  // were rebuilt (the caller then patches the new materials and rebinds anything it took from them).
  reset(sim) {
    if (signature(sim) !== this.sig) {
      this.dispose();
      this.build(sim);
      return true;
    }
    this.place(sim);
    return false;
  }

  update(dt, rawDt, sim, fx) {
    for (const u of sim.units) {
      const v = this.views.get(u.id);
      if (!v) continue;
      const lead = v.rigs[0];
      if (!u.alive && !v.dead) v.dead = true;
      // knocked out: the vehicle sags on broken suspension and burns (a dispersed unit's vehicles one by
      // one; those still whole when the unit is out of action stand abandoned)
      u.parts.forEach((part, i) => {
        const rig = v.rigs[i];
        if (!rig || rig.wreck) return;
        if (part.hp != null ? part.hp <= 0 : !u.alive) {
          rig.wreck = true;
          rig.root.rotation.z = (Math.random() - 0.5) * 0.12;
          rig.root.rotation.x = (Math.random() - 0.5) * 0.06;
          rig.root.position.y -= 0.25;
        }
      });
      for (const rig of v.rigs) rig.clock += dt;
      if (u.kind === 's400') this.s400(u, v, dt);
      else if (u.kind === 'buk') this.buk(u, v, dt);
      else if (u.kind === 'tor') this.tor(u, lead, dt);
      else if (u.kind === 'tunguska') this.tunguska(u, lead, dt);
      else if (u.kind === 'shilka') this.shilka(u, lead, dt);
      else {
        const p = lead.pivots;
        if (p.turret) p.turret.rotation.y = u.turret.az;
        if (p.elevation) p.elevation.rotation.x = u.turret.el;
        // the Osa's tracking antenna elevates on its own; the Pantsir's EO window turns to its sight
        if (p.trackRadar && u.turret.trackEl != null) p.trackRadar.rotation.x = u.turret.trackEl;
        if (p.eo && u.sight) p.eo.rotation.set(u.sight.el - u.turret.el, wrapPi(-u.sight.az - u.heading - u.turret.az), 0);
        // a search antenna on the turret turns against it so it points along the sweep
        if (p.searchRadar && u.radar.search && u.alive) p.searchRadar.rotation.y = -u.radar.sweep - u.heading - u.turret.az;
      }
      // rounds leaving their slots (a round going is a launch: a Tor opens that cell's lid)
      u.parts.forEach((part, i) => {
        const rig = v.rigs[i];
        part.slots.forEach((s, k) => {
          if (rig.loaded[k] === s) return;
          if (rig.loaded[k] === true && !s) rig.opened[k] = rig.clock;
          rig.loaded[k] = s;
          rig.setLoaded(k, s);
        });
      });
    }
    this.reloads.update(dt, sim);
    // wrecks and damaged buildings burn
    this.fireT -= rawDt;
    if (this.fireT > 0 || dt === 0) return;
    this.fireT = 0.1;
    for (const u of sim.units) {
      for (const part of u.parts) {
        // a dispersed unit's vehicles burn by their own damage, the others by the unit's
        const hp = part.hp ?? u.hp, max = part.maxHp ?? u.maxHp;
        const out = part.hp != null ? part.hp <= 0 : !u.alive;
        if (!out && (!u.alive || hp > max * 0.5)) continue;
        const k = out ? 1 : 0.5;
        fx.fire(_p.copy(part.pos).setY(part.pos.y + 2), k, k);
      }
    }
    for (const a of sim.assets) {
      if (a.hp > a.maxHp * 0.6) continue;
      const k = a.alive ? 0.8 : 1.6;
      const spread = a.kind === 'runway' ? 600 : 15;
      // a few fires scattered over the damaged area, steady per asset
      const n = a.kind === 'runway' ? 3 : 1;
      for (let i = 0; i < n; i++) {
        const s = Math.sin(i * 12.9898 + a.x) * 0.5;
        const b = (a.bearing * Math.PI) / 180;
        _p.set(a.pos.x + Math.sin(b) * s * spread, a.pos.y + 1, a.pos.z - Math.cos(b) * s * spread);
        fx.fire(_p, k, k);
      }
    }
  }

  // ---------------------------------------------------------------- shared pieces

  // Radars and masts stand up at the start of a battle and fold when the vehicle is knocked out; a
  // search antenna turns back to its travel position before it folds. Returns true while it stands in
  // action (raised and not knocked out).
  standUp(rig, up, antenna, dt) {
    if (!rig.setDeploy) return up;
    if (up) rig.deploy = Math.min(1, rig.deploy + dt / DEPLOY_TIME);
    else if (!antenna || Math.abs(antenna.rotation.y) < 0.03) rig.deploy = Math.max(0, rig.deploy - dt / FOLD_TIME);
    this.deploy(rig, rig.deploy);
    return up && rig.deploy >= 1;
  }

  // An antenna turning with the radar's sweep: when it starts (emitter on, radar raised) it takes up the
  // sweep's rate at once and closes the angle to it over a second or two, so it never jumps.
  spinWith(st, goal, dt) {
    if (!st.on) {
      st.on = true;
      st.off = wrapPi(st.a - goal);
    }
    st.off -= clamp(st.off, -SPIN_CATCH * dt, SPIN_CATCH * dt);
    st.a = wrapPi(goal + st.off);
    return st.a;
  }

  // a search antenna: spins with the sweep while emitting and raised; held where it is when silent;
  // back to its travel position (0) while it is lowered or folds
  searchAntenna(rig, ant, goal, emitting, deployed, dt) {
    const st = rig.spin;
    if (deployed && emitting) ant.rotation.y = this.spinWith(st, goal, dt);
    else {
      st.on = false;
      if (!deployed) ant.rotation.y = st.a = turnTo(ant.rotation.y, 0, 1.5, dt);
    }
  }

  // ---------------------------------------------------------------- per kind

  // S-400. The 92N6E faces a sector and holds it: it turns only when a live engagement's target (own or
  // linked track, also while aligning) falls outside about 40 degrees of its facing, then slews at a
  // fixed rate to the middle of the live targets, and stays there between engagements. The slab keeps
  // its working tilt whatever the emitter does (going silent is electronic).
  s400(u, v, dt) {
    const [t0, t1, t2, radar, search] = v.rigs;
    [t0, t1, t2].forEach((rig, i) => {
      if (rig.pivots.erector) rig.pivots.erector.rotation.x = (u.erect[i] ?? 0) * Math.PI * 0.5;
    });
    if (radar?.pivots.turret && u.alive) {
      const rp = u.parts[3];
      let sx = 0, sz = 0, out = false;
      // the live engagements and the designation a channel holds (or would, with the emitter off)
      const des = u.desig?.state === 'held' || u.desig?.state === 'laying' ? { trackId: u.desig.id, state: 'aligning' } : null;
      for (const e of des ? [...u.engagements, des] : u.engagements) {
        if (!live(e)) continue;
        const tr = u.trackMap.get(e.trackId) ?? u.linkMap.get(e.trackId);
        if (!tr) continue;
        // the bearing as a turntable angle (rotation.y relative to the hull, + = left)
        const a = wrapPi(-Math.atan2(tr.pos.x - rp.pos.x, -(tr.pos.z - rp.pos.z)) - rp.heading);
        sx += Math.cos(a);
        sz += Math.sin(a);
        if (Math.abs(wrapPi(a - v.sector)) > SECTOR) out = true;
      }
      if (out) v.sector = Math.atan2(sz, sx);
      const tur = radar.pivots.turret;
      tur.rotation.y = turnTo(tur.rotation.y, v.sector, SECTOR_RATE, dt);
      if (radar.pivots.elevation) radar.pivots.elevation.rotation.x = 0.32;
    }
    if (search?.pivots.searchRadar) this.searchAntenna(search, search.pivots.searchRadar, -u.radar.sweep - u.parts[4].heading, u.radar.search && u.alive, true, dt);
  }

  // Buk-M2 battery: each launcher vehicle turns and raises its own launcher, the search radar vehicle
  // raises its array and mast and spins it with the sweep; every vehicle is wrecked on its own. The
  // loader-launcher's drive, crane and the rounds it moves are the reload scene's (render/reload/buk.js).
  buk(u, v, dt) {
    u.parts.forEach((part, i) => {
      const rig = v.rigs[i];
      const p = rig.pivots;
      if (part.turret && !rig.wreck) {
        if (p.turret) p.turret.rotation.y = part.turret.az;
        if (p.elevation) p.elevation.rotation.x = part.turret.el;
      }
      if (part.kind === 'buk-radar' && p.searchRadar) {
        const up = this.standUp(rig, part.alive, p.searchRadar, dt);
        this.searchAntenna(rig, p.searchRadar, -u.radar.sweep - part.heading, u.radar.search && part.alive, up, dt);
      }
    });
  }

  // Tor-M2: the turret, the tracking antenna's tilt (laid back for the march until the vehicle has
  // deployed), the search antenna on its mast spinning with the sweep, a cell's lid opening as its round
  // leaves straight up.
  tor(u, rig, dt) {
    const p = rig.pivots;
    if (p.turret) p.turret.rotation.y = u.turret.az;
    const up = this.standUp(rig, u.alive, p.searchRadar, dt);
    if (p.trackRadar) {
      const k = clamp(rig.deploy, 0, 1);
      const travel = rig.trackTravel ?? 1.31;
      p.trackRadar.rotation.x = travel + (clamp(u.turret.el, -0.1, 1.45) - travel) * k;
    }
    if (p.searchRadar) this.searchAntenna(rig, p.searchRadar, -u.radar.sweep - u.heading - u.turret.az, u.radar.search && u.alive, up, dt);
    if (rig.setHatch) {
      for (let i = 0; i < (rig.hatches?.length ?? 0); i++) {
        const open = rig.opened[i] != null && rig.clock - rig.opened[i] < HATCH_OPEN;
        // a lid flies open with its round and swings shut a few seconds later
        const h = open ? 1 : moveTo(rig.hatch[i] ?? 0, 0, 1.5, dt);
        if (h !== rig.hatch[i]) rig.setHatch(i, (rig.hatch[i] = h));
      }
    }
  }

  // 2S6M Tunguska: turret and guns, the missile launchers raised to the turret's elevation while a
  // missile engagement runs (level otherwise: the sim lays one elevation for both), the tracking dish
  // tilting with it, the search antenna standing up and spinning with the sweep.
  tunguska(u, rig, dt) {
    const p = rig.pivots;
    if (p.turret) p.turret.rotation.y = u.turret.az;
    if (p.elevation) p.elevation.rotation.x = clamp(u.turret.el, -0.17, 1.52);
    if (p.launcher && u.alive) {
      const goal = u.engagements.some(live) ? clamp(u.turret.el, 0, 1.25) : 0;
      p.launcher.rotation.x = moveTo(p.launcher.rotation.x, goal, 1.2, dt);
    }
    if (p.trackRadar && u.alive) p.trackRadar.rotation.x = moveTo(p.trackRadar.rotation.x, u.radar.track ? clamp(u.turret.el, -0.2, 1.4) : 0, 1.5, dt);
    const up = this.standUp(rig, u.alive, p.searchRadar, dt);
    if (p.searchRadar) this.searchAntenna(rig, p.searchRadar, -u.radar.sweep - u.heading - u.turret.az, u.radar.search && u.alive, up, dt);
  }

  // ZSU-23-4M4 Shilka-M4: turret and guns; its one radar searches (the dish spins with the sweep) and
  // tracks (it faces the guns' aim while the tracking radar is on or the fire control holds a lead).
  shilka(u, rig, dt) {
    const p = rig.pivots;
    if (p.turret) p.turret.rotation.y = u.turret.az;
    if (p.elevation) p.elevation.rotation.x = clamp(u.turret.el, -0.07, 1.48);
    const yawP = p.trackRadar, nodP = p.trackRadarNod;
    const up = this.standUp(rig, u.alive, yawP, dt);
    if (!yawP) return;
    const st = rig.spin, tk = rig.track;
    const g = u.weapons.gun;
    let yaw = null, nod = 0;
    if (!up || !u.alive) {
      yaw = 0;
      nod = 0;
    } else if (u.radar.track || g?.aimOk) {
      // the lead point the fire control lays the guns on, else the target track, else over the guns
      let at = g?.aimOk ? g.aim : null;
      if (!at) {
        const id = g?.target ?? u.selected;
        at = (id != null ? u.trackMap.get(id) ?? u.linkMap.get(id) : null)?.pos ?? null;
      }
      if (at) {
        yawP.getWorldPosition(_p);
        _d.subVectors(at, _p);
        const b = Math.atan2(_d.x, -_d.z);
        yaw = wrapPi(-b - u.heading - u.turret.az);
        nod = Math.atan2(_d.y, Math.hypot(_d.x, _d.z));
      } else {
        yaw = 0;
        nod = u.turret.el;
      }
    }
    if (yaw === null && u.radar.search) {
      yawP.rotation.y = this.spinWith(st, -u.radar.sweep - u.heading - u.turret.az, dt);
      tk.nod = moveTo(tk.nod, 0.08, 1, dt);
    } else if (yaw !== null) {
      st.on = false;
      yawP.rotation.y = st.a = turnTo(yawP.rotation.y, yaw, 4, dt);
      tk.nod = moveTo(tk.nod, clamp(nod, -0.1, 1.3), 2, dt);
    } else st.on = false;
    if (nodP) nodP.rotation.x = up ? tk.nod : (tk.nod = moveTo(tk.nod, 0, 2, dt));
  }
}
