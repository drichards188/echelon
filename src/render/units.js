import * as THREE from 'three';
import { buildVehicle } from '../models/vehicles.js';
import { buildAsset } from '../models/site.js';
import { headingFor } from '../deploy.js';
import { heightAt } from '../terrainHeight.js';
import { SYSTEMS } from '../sim/systems.js';
import { ReloadScenes } from './reload.js';

// The fire units and the airbase in the world, bound to the simulation's state: turrets, elevation,
// search antennas following `radar.sweep`, the S-400 erectors, which launcher slots still hold a
// round, and wrecks and fires once something is destroyed or hit hard. The rigs are built for the
// units in play and the buildings for the era's assets; `reset(sim)` rebuilds them when the loadout or
// the era changed (see DESIGN.md, "Loadout" and "Eras").

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

// The WW2 era's gun units of several mounts (SYSTEMS `mounts`, sim/mounts.js): every gun part laid from its
// own turret, recoiling and running out from its gun's `recoil` (s since its last shot), its feed shown
// (the 8.8 cm's breech, the 3.7 cm's loading table, the 2 cm's magazines and racks), the predictor's and the
// Wuerzburg's turrets following their target, the battery's data cables on the ground. RECOIL: the stroke
// (m) and the times of the stroke and of the run-out (s): the 8.8 cm 1.05 m at 0 degrees to 0.70 m at 85
// (rig.recoilLength), back fast and run out by its recuperator over most of a second; the 3.7 cm 0.127 m
// and the 2 cm 0.053 m (the Vierling's 0.085 m a gun) inside their cyclic periods (0.24 and 0.13 s).
const RECOIL = { flak88: [0, 0.06, 0.9], flak43: [0.127, 0.02, 0.14], flak38: [0.053, 0.012, 0.08], flakvierling: [0.085, 0.01, 0.07] };
RECOIL['flakvierling-tower'] = RECOIL.flakvierling;
// each model's elevation limits (rad, from its header)
const ELEV = { flak88: [-0.052, 1.484], flak43: [-0.175, 1.571], flak38: [-0.349, 1.571], flakvierling: [-0.175, 1.745], 'flakvierling-tower': [-0.175, 1.745], kdo40: [0, 1.571], wurzburg: [0, 1.571] };
// the sim's Vierling barrels (0 upper left, 1 upper right, 2 lower left, 3 lower right) on the model's guns
// (0 1L upper left, 1 2R upper right, 2 3R lower right, 3 4L lower left)
const VIER_GUN = [0, 1, 3, 2];
// one or two of the six heavy guns in Dunkelgelb, the rest Dunkelgrau (refs/ww2/markings 1.2), by letter
const YELLOW_GUNS = new Set(['B', 'E']);
// muzzle flashes (fx.muzzle size) and spent cases (fx.brass: diameter and length, m); the light guns'
// cases only with the camera within CASES_NEAR m
const FLASH44 = { flak43: 0.75, flak38: 0.42, flakvierling: 0.42 };
const CASE = { flak88: [0.105, 0.57], flak43: [0.05, 0.25], flak38: [0.03, 0.14], flakvierling: [0.03, 0.14] };
for (const t of [RECOIL, FLASH44, CASE]) t['flakvierling-tower'] = t.flakvierling;
const CASES_NEAR = 70;
// Distance levels of a gun position (each gun or instrument is 11 to 24 meshes, a draw call each and another
// for its shadow, and from the airfield the whole battery and the platoons are in view): its parts smaller
// than LOD[k][1] metres (bounding radius) are left out beyond LOD[k][0] m from the camera, and the whole
// position beyond RIG_FAR, where its pit is a couple of pixels across. Left out by moving the meshes to
// layer 1 (no camera renders it), as the models switch their own meshes' `visible`.
const LOD = [[600, 1], [1500, 2]];
const RIG_FAR = 3000;
// the stroke, then the run-out: 0..1 of the full stroke `t` s after the shot
const recoilCurve = (t, rise, back) => {
  if (t < 0) return 0;
  if (t < rise) return t / rise;
  const k = (t - rise) / back;
  return k >= 1 ? 0 : 1 - k * k * (3 - 2 * k);
};
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _q = new THREE.Quaternion();
let CABLE_MAT = null;

// The units' signature: a new one (another loadout) means new rigs.
const signature = (sim) => sim.units.map((u) => `${u.id}:${u.parts.map((p) => p.kind).join('+')}`).join(',');
// the assets' (another era): new buildings
const assetSignature = (sim) => sim.assets.map((a) => `${a.id}:${a.kind}:${a.x}:${a.z}:${a.bearing}`).join(',');

export class UnitViews {
  constructor(scene, sim) {
    this.scene = scene;
    this.views = new Map();
    // the reload scenes (render/reload.js), built with the rigs and driven after them every frame
    this.reloads = new ReloadScenes(scene, this);
    this.build(sim);
    this.assets = new Map();
    this.buildAssets(sim);
    this.fireT = 0;
    this.killT = 0;
  }

  // the era's buildings (models/site.js), standing where the sim has them
  buildAssets(sim) {
    for (const g of this.assets.values()) {
      this.scene.remove(g);
      g.traverse((o) => o.geometry?.dispose());
    }
    this.assets.clear();
    this.assetSig = assetSignature(sim);
    for (const a of sim.assets) {
      const g = buildAsset(a);
      g.position.copy(a.pos);
      g.rotation.y = headingFor(a.bearing);
      this.scene.add(g);
      this.assets.set(a.id, g);
    }
  }

  build(sim) {
    this.sig = signature(sim);
    for (const u of sim.units) {
      const rigs = u.parts.map((part) => {
        const rig = buildVehicle(part.kind);
        this.scene.add(rig.root);
        rig.loaded = [];
        // (the Wuerzburg's rig.spin(t) turns its dipole; rig.spin is the antennas' state here)
        if (typeof rig.spin === 'function') rig.quirl = rig.spin;
        if (SYSTEMS[u.kind]?.mounts) {
          rig.root.updateMatrixWorld(true);
          rig.lodParts = [];
          rig.root.traverse((o) => {
            if (!o.isMesh) return;
            o.geometry.boundingSphere ?? o.geometry.computeBoundingSphere();
            o.matrixWorld.decompose(_a, _q, _c);
            rig.lodParts.push({ mesh: o, r: o.geometry.boundingSphere.radius * Math.max(_c.x, _c.y, _c.z) });
          });
          rig.lodLevel = 0;
        }
        // a heavy gun's letter and paint (the WW2 battery)
        if (part.letter) {
          rig.setLetter?.(part.letter);
          if (YELLOW_GUNS.has(part.letter)) rig.setPaint?.('yellow');
        }
        return rig;
      });
      this.views.set(u.id, { rigs, dead: false, spin: 0, kills: 0, cables: null });
    }
    this.place(sim);
    for (const u of sim.units) if (SYSTEMS[u.kind]?.mounts) this.views.get(u.id).cables = this.cables(u, this.views.get(u.id).rigs);
    this.reloads.build(sim);
    this.crewUp(sim);
  }

  // the rigs of the units no longer in play: off the scene, their geometry freed (materials and
  // textures are shared between the builds and stay)
  dispose() {
    this.reloads.dispose();
    this.crews?.clear();
    for (const v of this.views.values()) {
      for (const rig of v.rigs) {
        this.scene.remove(rig.root);
        rig.root.traverse((o) => o.geometry?.dispose());
      }
      if (v.cables) {
        this.scene.remove(v.cables);
        v.cables.geometry.dispose();
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
      v.kills = 0;
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
        rig.ww = null;
        if (rig.pivots.turret) rig.pivots.turret.rotation.z = 0;
        rig.setKills?.(0);
        if (rig.crew?.down) {
          rig.crew.down = false;
          rig.crew.setVisible(true);
        }
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
  sightPos(unitId, out = _p, part = 0) {
    const r = this.views.get(unitId)?.rigs[part];
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

  // a new game: everything stands again; another loadout gets its own rigs, another era's assets their
  // own buildings. Returns true when the rigs or the buildings were rebuilt (the caller then patches the
  // new materials and rebinds anything it took from them).
  reset(sim) {
    const era = assetSignature(sim) !== this.assetSig;
    if (era) this.buildAssets(sim);
    if (signature(sim) !== this.sig) {
      this.dispose();
      this.build(sim);
      return true;
    }
    this.place(sim);
    return era;
  }

  update(dt, rawDt, sim, fx, camera = null) {
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
          if (SYSTEMS[u.kind]?.mounts) {
            // a gun knocked out in its pit (the earth walls stand): the mount knocked askew, the barrel down
            if (rig.pivots.turret) rig.pivots.turret.rotation.z = (Math.random() - 0.5) * 0.2;
            if (rig.pivots.elevation) rig.pivots.elevation.rotation.x = ELEV[part.kind]?.[0] ?? 0;
            return;
          }
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
      else if (SYSTEMS[u.kind]?.mounts) this.mounts(u, v, dt, sim, fx, camera);
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
    if (this.crews && camera) this.crewUpdate(dt, sim, camera);
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
        // (a WW2 gun burns in its pit only once it is knocked out: its ready ammunition)
        if (!out && SYSTEMS[u.kind]?.mounts) continue;
        const k = out ? (SYSTEMS[u.kind]?.mounts ? 0.6 : 1) : 0.5;
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

  // ---------------------------------------------------------------- the WW2 era's flak

  // A gun unit of several mounts (a heavy battery or a platoon): every part from its own sim state. The
  // muzzle flashes, the 8.8 cm's blast and the spent cases are spawned here, where the rigs' muzzles are,
  // from the shots each gun (each barrel of a 2 cm) fired since the last frame.
  mounts(u, v, dt, sim, fx, camera) {
    const pr = u.predictor;
    const near = camera ? (p) => camera.position.distanceToSquared(p) < CASES_NEAR * CASES_NEAR : () => false;
    u.parts.forEach((part, i) => {
      const rig = v.rigs[i];
      if (!rig) return;
      if (camera) this.lod(rig, camera.position.distanceTo(rig.root.position));
      const p = rig.pivots;
      const lim = ELEV[part.kind];
      if (part.turret && !rig.wreck) {
        if (p.turret) p.turret.rotation.y = part.turret.az;
        if (p.elevation) p.elevation.rotation.x = lim ? clamp(part.turret.el, lim[0], lim[1]) : part.turret.el;
      }
      // the Wuerzburg's dipole spins while it emits; the predictor's dials show its fuze
      if (rig.quirl && part.alive && u.radar.track) rig.quirl(rig.clock);
      if (part.kind === 'kdo40' && rig.setData && pr?.valid) rig.setData({ fuze: pr.fuze });
      const g = part.gun;
      if (!g) return;
      const st = rig.ww ?? (rig.ww = { shots: g.shots, since: -1, mags: g.barrels.map((b) => b.mag), age: g.barrels.map(() => -1), breech: 0, table: -1, rack: -1, mag: [], order: 0 });
      const R = RECOIL[part.kind];
      const fresh = g.shots - st.shots;
      st.shots = g.shots;
      if (part.kind === 'flak88') {
        // the recoil and the run-out; the wedge drops open at the end of the run-out and throws the case
        // out, and closes on the next round
        if (fresh > 0) st.since = 0;
        else if (st.since >= 0) st.since += dt;
        const el = p.elevation?.rotation.x ?? 0;
        rig.setRecoil?.(rig.recoilLength(el) * recoilCurve(g.recoil, R[1], R[2]));
        const open = !g.loaded && st.since > R[1] + R[2] * 0.8;
        const was = st.breech;
        st.breech = moveTo(st.breech, open ? 1 : 0, open ? 9 : 6, dt);
        if (st.breech !== was) rig.setBreech?.(st.breech);
        if (was < 0.5 && st.breech >= 0.5 && rig.anchors.breech) this.ejectCase(rig.anchors.breech, CASE.flak88, fx, 3);
        if ((st.order -= dt) <= 0) {
          st.order = 0.1;
          rig.setOrder?.(g.order);
        }
        if (fresh > 0 && dt > 0) this.flash(rig, 0, fx, 'flak88', part.pos);
        return;
      }
      if (part.kind === 'flak43') {
        rig.setRecoil?.(R[0] * recoilCurve(g.recoil, R[1], R[2]));
        if (g.table !== st.table) rig.setRounds?.((st.table = g.table));
        if (fresh > 0 && dt > 0) {
          for (let k = 0; k < Math.min(fresh, 2); k++) this.flash(rig, 0, fx, part.kind, null, k === 0 && Math.random() < 0.5);
          if (near(part.pos)) this.ejectCase(rig.anchors.muzzles[0], CASE.flak43, fx, 2, 2.6);
        }
        return;
      }
      // the 2 cm: each barrel from its own magazine (a shot is a round gone from it)
      g.barrels.forEach((b, k) => {
        const m = rig.setMagazine ? (part.kind === 'flak38' ? -1 : VIER_GUN[k] ?? k) : null;
        const on = !(b.change > 0);
        if (st.mag[k] !== on) {
          st.mag[k] = on;
          if (m === -1) rig.setMagazine(on);
          else if (m != null) rig.setMagazine(m, on);
        }
        const shot = b.mag < st.mags[k] && b.change <= 0;
        st.mags[k] = b.mag;
        if (shot) st.age[k] = 0;
        else if (st.age[k] >= 0) st.age[k] += dt;
        const r = R[0] * recoilCurve(st.age[k], R[1], R[2]);
        if (part.kind === 'flak38') rig.setRecoil?.(r);
        else rig.setRecoil?.(VIER_GUN[k] ?? k, r);
        if (shot && dt > 0) {
          const gun = part.kind === 'flak38' ? 0 : VIER_GUN[k] ?? k;
          this.flash(rig, gun, fx, part.kind, null, Math.random() < 0.25);
          if (near(part.pos)) this.ejectCase(rig.anchors.muzzles[gun], CASE.flak38, fx, 1.5, 1.6);
        }
      });
      // the racks: the full magazines the ammunition numbers keep ready (one in a loader's hands while he changes)
      if (rig.setRack) {
        const n = clamp(Math.floor(g.rounds / 20) - g.barrels.filter((b) => b.change > 0).length, 0, 12);
        if (n !== st.rack) rig.setRack((st.rack = n));
      }
    });
    // the battery's kill rings: one per aircraft its 8.8 cm brought down this battle, on every gun
    if (pr && (this.killT -= dt) <= 0) {
      this.killT = 1;
      let n = 0;
      for (const w of sim.stats.waves) n += w.kills[`${u.id}:88mm`] ?? 0;
      if (n !== v.kills) {
        v.kills = n;
        u.parts.forEach((part, i) => part.role === 'gun' && !v.rigs[i].wreck && v.rigs[i].setKills?.(n));
      }
    }
  }

  // a gun position's distance level (LOD, RIG_FAR)
  lod(rig, d) {
    rig.root.visible = d < RIG_FAR;
    if (!rig.lodParts) return;
    let k = 0;
    while (k < LOD.length && d > LOD[k][0]) k++;
    if (k === rig.lodLevel) return;
    rig.lodLevel = k;
    const r = k ? LOD[k - 1][1] : 0;
    for (const p of rig.lodParts) p.mesh.layers.set(p.r < r ? 1 : 0);
  }

  // a gun's flash at muzzle anchor k (along its bore): the 8.8 cm's blast with its dust off the pit, a
  // light gun's flash and now and then its smoke
  flash(rig, k, fx, kind, base = null, smoke = false) {
    const a = rig.anchors.muzzles[k];
    if (!a) return;
    a.updateWorldMatrix(true, false);
    _a.setFromMatrixPosition(a.matrixWorld);
    _b.set(0, 0, -1).transformDirection(a.matrixWorld);
    if (kind === 'flak88') fx.cannon(_a, _b, base ?? _a, 1);
    else fx.muzzle(_a, _b, FLASH44[kind] ?? 0.5, smoke);
  }

  // a spent case thrown from `anchor` (its frame: -Z along the bore): back out of the breech and down, or
  // (side > 0) out to the right as a 2 cm drops them or the 3.7 cm's drum lets them out
  ejectCase(anchor, [d, len], fx, speed, side = 0) {
    anchor.updateWorldMatrix(true, false);
    _a.setFromMatrixPosition(anchor.matrixWorld);
    _b.set(0, 0, 1).transformDirection(anchor.matrixWorld);
    _c.set(1, 0, 0).transformDirection(anchor.matrixWorld);
    if (side) _a.addScaledVector(_b, side);
    _b.multiplyScalar(side ? 0.3 : speed * (0.8 + Math.random() * 0.4)).addScaledVector(_c, side ? speed * (0.7 + Math.random() * 0.6) : (Math.random() - 0.5) * 0.6);
    _b.y -= side ? 0.5 : 0.8;
    fx.brass(_a, _b, d, len);
  }

  // The heavy battery's data cables: from the Kommandogeraet's pit to a junction box outside the ring of
  // guns and on to each gun's pit, and from the Wuerzburg's revetment to the predictor, laid on the ground
  // with a little slack (dark ribbons, one mesh for the battery).
  cables(u, rigs) {
    const kg = u.parts.findIndex((p) => p.role === 'predictor');
    if (kg < 0 || !rigs[kg]?.anchors.cable) return null;
    for (const r of rigs) r.root.updateMatrixWorld(true);
    const at = (i) => rigs[i]?.anchors.cable?.getWorldPosition(new THREE.Vector3()) ?? null;
    const from = at(kg);
    const guns = u.parts.map((p, i) => (p.role === 'gun' ? i : -1)).filter((i) => i >= 0);
    const centre = new THREE.Vector3();
    for (const i of guns) centre.add(u.parts[i].pos);
    centre.divideScalar(guns.length || 1);
    const junction = centre.clone().add(_a.subVectors(from, centre).setY(0).normalize().multiplyScalar(46));
    const runs = [[from, junction]];
    for (const i of guns) {
      const e = at(i);
      if (e) runs.push([junction, e]);
    }
    const wz = u.parts.findIndex((p) => p.role === 'radar');
    const w = wz >= 0 ? at(wz) : null;
    if (w) runs.push([w, from]);
    const pos = [], idx = [], W = 0.025;
    let seed = 1;
    for (const [a, b] of runs) {
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      const n = Math.max(2, Math.ceil(len / 1.5));
      const dx = (b.x - a.x) / len, dz = (b.z - a.z) / len;
      // a lazy wander off the straight line, none at the ends
      const amp = Math.min(1.2, len * 0.02), ph = (seed++ * 2.39) % 6.28, f = Math.max(1, Math.round(len / 25));
      const base = pos.length / 3;
      for (let k = 0; k <= n; k++) {
        const t = k / n, off = Math.sin(t * Math.PI) * amp * Math.sin(t * f * Math.PI + ph);
        const x = a.x + (b.x - a.x) * t - dz * off, z = a.z + (b.z - a.z) * t + dx * off;
        const y = heightAt(x, z) + 0.03;
        pos.push(x - dz * W, y, z + dx * W, x + dz * W, y, z - dx * W);
        if (k) {
          const q = base + (k - 1) * 2;
          idx.push(q, q + 2, q + 1, q + 1, q + 2, q + 3);
        }
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(new Float32Array(pos.length).fill(0).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
    geo.setIndex(idx);
    const mesh = new THREE.Mesh(geo, CABLE_MAT ?? (CABLE_MAT = new THREE.MeshStandardMaterial({ color: 0x1f1e1b, roughness: 0.75, metalness: 0, side: THREE.DoubleSide })));
    mesh.name = 'cables';
    mesh.receiveShadow = true;
    this.scene.add(mesh);
    return mesh;
  }

  // ---------------------------------------------------------------- the WW2 crews (eras/ww2/models/crew44.js)
  // The gun crews are the WW2 era's own module, fetched with a dynamic import the first time a gun unit of
  // several mounts is built (the modern game never downloads it); until it has loaded the guns stand
  // unmanned. A man per crew spot of every rig, stood at ease between raids, looking at his gun's target.
  crewUp(sim) {
    if (!sim.units.some((u) => SYSTEMS[u.kind]?.mounts)) return;
    if (!this.crewing) {
      this.crewing = import('../eras/ww2/models/crew44.js')
        .then((m) => {
          this.crews = new m.Crew44(this.scene);
          return true;
        })
        .catch((e) => {
          console.warn('WW2 crews unavailable:', e.message);
          return false;
        });
    }
    this.crewing.then((ok) => {
      if (!ok || !this.crews) return;
      this.crews.clear();
      for (const u of sim.units) {
        if (!SYSTEMS[u.kind]?.mounts) continue;
        const v = this.views.get(u.id);
        v?.rigs.forEach((rig, i) => {
          if (!rig.anchors.crew) return;
          try {
            rig.crew = this.crews.place(rig, u.parts[i].kind);
          } catch (e) {
            console.warn('crew', u.parts[i].kind, e.message);
          }
        });
      }
      this.stance = null;
    });
  }

  crewUpdate(dt, sim, camera) {
    const easy = sim.state !== 'wave';
    const stance = easy ? 'easy' : 'action';
    for (const u of sim.units) {
      if (!SYSTEMS[u.kind]?.mounts) continue;
      const v = this.views.get(u.id);
      u.parts.forEach((part, i) => {
        const h = v?.rigs[i]?.crew;
        if (!h) return;
        if (stance !== this.stance) h.setStance(stance);
        if (!part.alive && !h.down) {
          h.down = true;
          h.setVisible(false);
        }
        const id = part.gun?.target ?? (part.role === 'predictor' || part.role === 'radar' ? u.predictor?.target : null);
        h.setTarget(id != null ? sim.threatById.get(id)?.pos ?? null : null);
      });
    }
    this.stance = stance;
    this.crews.update(dt, camera);
  }
}
