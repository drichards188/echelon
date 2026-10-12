import * as THREE from 'three';
import { heightAt } from '../terrainHeight.js';
import { buildCrewman, CREW_GAITS } from '../models/v/crew.js';
import s400 from './reload/s400.js';
import buk from './reload/buk.js';
import strela from './reload/strela.js';
import shilka from './reload/shilka.js';
import osa from './reload/osa.js';
import tor from './reload/tor.js';
import pantsir from './reload/pantsir.js';
import tunguska from './reload/tunguska.js';

// Reload scenes: what the player sees while the sim reloads a vehicle. The sim (units.js startJob) keeps
// the reload as a job on one vehicle in `unit.reloads`: { id, type, part, from, slots, n, t, dur }; its
// clock `t` runs in sim time (time compression plays the scene faster) and the rounds count at `dur`.
// This module follows the jobs of every unit whose kind has a scene in RELOAD_SCENES and drives the
// scene module with the job's time; after the sim ends the job the scene runs on (its outro: the
// trucks leave) with the same time-compressed dt until it says it is done. A scene is a pure function
// of its time and the plan it made at the start, so dropped frames, fastForward and time compression
// all land on the same picture. Everything a scene shows is built once per unit (create) and reused.
//
// The scene API (DESIGN.md "Reload scenes"): a module per unit kind in ./reload/<kind>.js exporting
//   create(ctx)                 build the unit's pooled props (vehicles, crew, loads) into ctx.group;
//                               return the scene's state object
//   start(ctx, state, job)      a job began: plan it, return a play object (or null to show nothing)
//   update(ctx, state, play, t, job)  pose everything for scene time t (s since the job began); job is
//                               null once the sim has ended it (t keeps running); return false when the
//                               play is over
//   stop(ctx, state, play)      the play is cut short (unit or vehicle knocked out, new battle): put its
//                               props away at once
//   idle(ctx, state, dt)        optional, every frame after the plays
//   reset(ctx, state)           optional, a new battle with the same rigs: everything back to idle
//   dispose(ctx, state)         optional; ctx.group and its geometry are removed for the scene anyway
// and is registered below with one line in RELOAD_SCENES. ctx gives the scene:
//   ctx.unit       the sim unit (live object: read its parts, erect, turret, reloads)
//   ctx.rig(i)     the UnitViews rig of vehicle i (pivots, anchors, setLoaded...)
//   ctx.loaded(i)  UnitViews' copy of vehicle i's slots as the sim last set them (for restoring)
//   ctx.group      a THREE.Group in the scene for the unit's props
//   ctx.ground     heightAt(x, z)
//   ctx.frame(i, out)  vehicle i's frame as a Matrix4 (position on the ground, heading)
// and the kit exported here: Frame, Lane, Timeline, placeOnGround, Crewman, smooth, ramp, ease.

export const RELOAD_SCENES = {
  s400,
  buk,
  strela,
  shilka,
  osa,
  tor,
  pantsir,
  tunguska,
};

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();

export const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
/** 0..1 across [a, b] (linear). */
export const ramp = (t, a, b) => clamp01((t - a) / (b - a));
/** 0..1 across [a, b], eased in and out. */
export const smooth = (t, a, b) => {
  const k = ramp(t, a, b);
  return k * k * (3 - 2 * k);
};
/** Eased 0..1 for a 0..1 input. */
export const ease = (k) => (k <= 0 ? 0 : k >= 1 ? 1 : k * k * (3 - 2 * k));
const wrapPi = (a) => {
  a = (a + Math.PI) % (Math.PI * 2);
  return (a < 0 ? a + Math.PI * 2 : a) - Math.PI;
};

/**
 * A vehicle's frame on the ground: local (x right, z back, y up; three's model convention) to world.
 * Built from a sim part ({ pos, heading }); local headings add to `heading` (rotation.y).
 */
export class Frame {
  constructor(pos = new THREE.Vector3(), heading = 0) {
    this.pos = pos.clone();
    this.heading = heading;
    this.c = Math.cos(heading);
    this.s = Math.sin(heading);
  }

  set(pos, heading) {
    this.pos.copy(pos);
    this.heading = heading;
    this.c = Math.cos(heading);
    this.s = Math.sin(heading);
    return this;
  }

  /** World x, z of local (x, z) into out (y untouched). */
  xz(x, z, out) {
    out.x = this.pos.x + x * this.c + z * this.s;
    out.z = this.pos.z - x * this.s + z * this.c;
    return out;
  }

  /** World point of local (x, y, z); y is taken above the frame's ground height. */
  point(x, y, z, out) {
    this.xz(x, z, out);
    out.y = this.pos.y + y;
    return out;
  }

  /** Local x, z of a world point into out (out.y = height above the frame's origin). */
  toLocal(p, out) {
    const dx = p.x - this.pos.x, dz = p.z - this.pos.z;
    out.x = dx * this.c - dz * this.s;
    out.z = dx * this.s + dz * this.c;
    out.y = p.y - this.pos.y;
    return out;
  }
}

/**
 * A drive path: a polyline of local points [x, z] (in a Frame) with arc-length sampling. at(s, out)
 * gives the world x, z and the heading (rotation.y of a vehicle whose front follows the path toward
 * increasing s) at distance s; curvature(s) the turn per metre (for steering).
 */
export class Lane {
  constructor(frame, pts) {
    this.frame = frame;
    this.pts = pts.map(([x, z]) => frame.xz(x, z, new THREE.Vector3()));
    this.cum = [0];
    for (let i = 1; i < this.pts.length; i++) this.cum.push(this.cum[i - 1] + Math.hypot(this.pts[i].x - this.pts[i - 1].x, this.pts[i].z - this.pts[i - 1].z));
    this.length = this.cum[this.cum.length - 1];
  }

  seg(s) {
    let i = 1;
    while (i < this.cum.length - 1 && this.cum[i] < s) i++;
    return i;
  }

  at(s, out) {
    const i = this.seg(s), a = this.pts[i - 1], b = this.pts[i];
    const L = this.cum[i] - this.cum[i - 1] || 1;
    const k = (s - this.cum[i - 1]) / L; // extrapolates past the ends along the first and last legs
    out.x = a.x + (b.x - a.x) * k;
    out.z = a.z + (b.z - a.z) * k;
    out.heading = Math.atan2(-(b.x - a.x), -(b.z - a.z));
    return out;
  }

  /** Heading change per metre around s (0 on a straight). */
  curvature(s, d = 2) {
    const h0 = this.at(s - d, { x: 0, z: 0 }).heading, h1 = this.at(s + d, { x: 0, z: 0 }).heading;
    return wrapPi(h1 - h0) / (2 * d);
  }
}

/**
 * Stand a vehicle rig on the terrain at world (x, z) facing `heading`: height and pitch from the
 * ground under its front and rear axles (model z `front`, `rear`), roll from the ground under its
 * left and right wheels (`half` the track).
 */
export function placeOnGround(root, x, z, heading, front, rear, half = 1.0, ground = heightAt) {
  const s = Math.sin(heading), c = Math.cos(heading);
  // model -Z (forward) in world: (-s, -c); model +X (right): (c, -s)
  const fx = x + s * front, fz = z + c * front; // model z `front` (negative) is ahead
  const rx = x + s * rear, rz = z + c * rear;
  const yF = ground(fx, fz), yR = ground(rx, rz);
  const yL = ground(x - c * half, z + s * half), yRt = ground(x + c * half, z - s * half);
  root.position.set(x, (yF + yR) / 2 + ((yL + yRt) / 2 - (yF + yR) / 2) * 0.5, z);
  root.rotation.set(Math.atan2(yF - yR, rear - front), heading, Math.atan2(yRt - yL, 2 * half), 'YXZ');
  return root;
}

/**
 * A time plan: named steps of nominal durations laid end to end, then stretched or squeezed to fit.
 *   const tl = new Timeline().add('drive', 12).add('outriggers', 3) ... ; tl.fit(0, dur)
 *   tl.k('drive', t)  0..1 through that step (0 before, 1 after); tl.at('drive') { start, end }
 *   tl.step(t)        the name of the step t is in
 */
export class Timeline {
  constructor() {
    this.steps = [];
    this.map = new Map();
  }

  add(name, dur, fixed = false) {
    const st = { name, dur, start: 0, end: 0, fixed };
    this.steps.push(st);
    this.map.set(name, st);
    return this;
  }

  /** Lay the steps out from t0 so they end at t1; fixed steps keep their length. */
  fit(t0, t1) {
    let flex = 0, fixed = 0;
    for (const s of this.steps) (s.fixed ? (fixed += s.dur) : (flex += s.dur));
    const k = flex > 0 ? Math.max(0.1, (t1 - t0 - fixed) / flex) : 1;
    let t = t0;
    for (const s of this.steps) {
      s.start = t;
      t += s.fixed ? s.dur : s.dur * k;
      s.end = t;
    }
    this.scale = k;
    return this;
  }

  at(name) {
    return this.map.get(name);
  }

  k(name, t) {
    const s = this.map.get(name);
    return s ? ramp(t, s.start, s.end) : 0;
  }

  step(t) {
    for (const s of this.steps) if (t < s.end) return s.name;
    return null;
  }

  get end() {
    return this.steps.length ? this.steps[this.steps.length - 1].end : 0;
  }
}

/**
 * One crew figure for a scene (crew.js buildCrewman, Ukrainian 'mm14' pattern by default): placed on
 * the terrain, posed every frame, hidden while off duty. walk(a, b, k) moves it along a straight line
 * between two world points with the walk cycle following the distance covered.
 */
export class Crewman {
  constructor(group, opts = {}) {
    this.fig = buildCrewman({ pattern: 'mm14', ...opts });
    this.root = this.fig.root;
    this.root.visible = false;
    group.add(this.root);
    this.pose = 'stand';
  }

  hide() {
    this.root.visible = false;
  }

  /** Stand at world (x, z) on the ground (or at height y if given), facing `heading`, in pose name at phase t. */
  at(x, z, heading, name = 'stand', t = 0, y = null, blend = 1) {
    this.root.visible = true;
    this.root.position.set(x, y ?? heightAt(x, z), z);
    this.root.rotation.set(0, heading, 0);
    this.fig.pose(name, t, blend);
    this.pose = name;
    return this;
  }

  /** Face from (x, z) toward world (tx, tz). */
  static facing(x, z, tx, tz) {
    return Math.atan2(-(tx - x), -(tz - z));
  }

  /**
   * Walk from world a to b ({ x, z }), k of the way (0..1); the gait follows the distance (stride per
   * cycle), facing along the way. At k <= 0 or >= 1 it stands at the end facing along the way.
   */
  walk(a, b, k, gait = 'walk', y0 = null, y1 = null) {
    const d = Math.hypot(b.x - a.x, b.z - a.z);
    const h = d > 0.01 ? Math.atan2(-(b.x - a.x), -(b.z - a.z)) : this.root.rotation.y;
    const kk = clamp01(k);
    const x = a.x + (b.x - a.x) * kk, z = a.z + (b.z - a.z) * kk;
    const y = y0 != null ? y0 + ((y1 ?? y0) - y0) * kk : null;
    const moving = k > 0 && k < 1;
    const stride = CREW_GAITS[gait]?.stride ?? 1.25;
    return this.at(x, z, h, moving ? gait : 'stand', moving ? (d * kk) / stride : 0, y);
  }
}

/** The world position of an Object3D (its world matrix brought up to date). */
export function worldOf(obj, out = _v) {
  obj.updateWorldMatrix(true, false);
  return out.setFromMatrixPosition(obj.matrixWorld);
}

// ---------------------------------------------------------------- the driver

export class ReloadScenes {
  constructor(scene, views) {
    this.scene = scene;
    this.views = views;
    this.units = new Map();
  }

  /** Build every scene for the units in play (after UnitViews has built their rigs). */
  build(sim) {
    this.dispose();
    for (const u of sim.units) {
      const def = RELOAD_SCENES[u.kind];
      if (!def) continue;
      const v = this.views.views.get(u.id);
      if (!v) continue;
      const group = new THREE.Group();
      group.name = 'reload-' + u.id;
      this.scene.add(group);
      const frames = new Map();
      const ctx = {
        unit: u, group, ground: heightAt,
        rig: (i) => v.rigs[i] ?? null,
        loaded: (i) => v.rigs[i]?.loaded ?? [],
        frame: (i, out = new THREE.Matrix4()) => {
          const p = ctx.unit.parts[i];
          return out.makeRotationY(p.heading).setPosition(p.pos);
        },
        partFrame: (i) => {
          let f = frames.get(i);
          const p = ctx.unit.parts[i];
          if (!f) frames.set(i, (f = new Frame(p.pos, p.heading)));
          else f.set(p.pos, p.heading);
          return f;
        },
      };
      const state = def.create(ctx);
      this.units.set(u.id, { def, ctx, state, plays: new Map() });
    }
  }

  /** A new battle with the same rigs: stop every play, everything back to idle. */
  reset(sim) {
    for (const [id, e] of this.units) {
      e.ctx.unit = sim.units.find((u) => u.id === id) ?? e.ctx.unit;
      for (const p of e.plays.values()) e.def.stop(e.ctx, e.state, p.play);
      e.plays.clear();
      e.def.reset?.(e.ctx, e.state);
    }
  }

  dispose() {
    for (const e of this.units.values()) {
      for (const p of e.plays.values()) e.def.stop(e.ctx, e.state, p.play);
      e.def.dispose?.(e.ctx, e.state);
      this.scene.remove(e.ctx.group);
      e.ctx.group.traverse((o) => o.geometry?.dispose());
    }
    this.units.clear();
  }

  /** Every frame after UnitViews.update; dt is the time-compressed sim dt (0 while paused). */
  update(dt, sim) {
    for (const e of this.units.values()) {
      const u = e.ctx.unit;
      // a unit out of the battle: its scenes stop where they are
      if (!u.alive) {
        for (const p of e.plays.values()) e.def.stop(e.ctx, e.state, p.play);
        e.plays.clear();
        e.def.idle?.(e.ctx, e.state, dt);
        continue;
      }
      for (const job of u.reloads) {
        if (e.plays.has(job.id)) continue;
        const play = e.def.start(e.ctx, e.state, job);
        e.plays.set(job.id, { job, play, t: job.t, live: true });
      }
      for (const [id, p] of e.plays) {
        if (p.live && !u.reloads.includes(p.job)) {
          p.live = false;
          // dropped before its time: the vehicle was knocked out, the scene stops
          if (p.job.t < p.job.dur - 1e-6) {
            if (p.play) e.def.stop(e.ctx, e.state, p.play);
            e.plays.delete(id);
            continue;
          }
        }
        p.t = p.live ? p.job.t : p.t + dt;
        if (!p.play || e.def.update(e.ctx, e.state, p.play, p.t, p.live ? p.job : null) === false) e.plays.delete(id);
      }
      e.def.idle?.(e.ctx, e.state, dt);
    }
  }

  /** The props of a unit's scene (tests and captures). */
  stateOf(unitId) {
    return this.units.get(unitId)?.state ?? null;
  }
}
