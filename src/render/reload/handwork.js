import * as THREE from 'three';
import { heightAt } from '../../terrainHeight.js';
import { CREW_GAITS } from '../../models/v/crew.js';
import { Crewman } from '../reload.js';

// Hand work for the reload scenes where the crew carries the loads by hand (the Strela's containers, the
// Shilka's ammunition boxes). Everything is planned when the job starts, in the vehicle's frame (x right,
// y up from the vehicle's base, z back; headings are rotation.y relative to the vehicle), as segments on
// a time line:
//   a load's segment eases it from one pose { x, y, z, yaw, pitch } to another (ground: y above the
//     terrain), or asks the scene for its matrix (kind 'fn': a launcher rail that turns with the turret);
//   a man's segment moves his root from one place to another in a pose, with his hands on points of a
//     load (crew.js reach, IK). A move picks its gait from the way he goes relative to his facing (walk
//     forward or backward, step sideways, climb), and the gait's phase follows the distance, so the feet
//     stay planted whatever the time scale. A new pose fades in over FADE s from the last one.
// update() evaluates a plan for scene time t: a pure function of t and the plan, allocating nothing.

const FADE = 0.35;
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(0, 0, 0, 'YXZ');
const _p = new THREE.Vector3(), _w = new THREE.Vector3(), _f = new THREE.Vector3(), _n = new THREE.Vector3(), _o = new THREE.Vector3();
const ONE = new THREE.Vector3(1, 1, 1);
const lerp = (a, b, k) => a + (b - a) * k;
const smooth = (k) => (k <= 0 ? 0 : k >= 1 ? 1 : k * k * (3 - 2 * k));
const wrapPi = (a) => {
  a = (a + Math.PI) % (Math.PI * 2);
  return (a < 0 ? a + Math.PI * 2 : a) - Math.PI;
};
const GAIT_POSE = { walk: 'walk', carry: 'carryWalk', side: 'sidestep', climb: 'climb' };

/** A vehicle frame: local pose to world (the vehicle stands level, turned by `heading`). */
export class VFrame {
  constructor() {
    this.pos = new THREE.Vector3();
    this.heading = 0;
    this.m = new THREE.Matrix4();
    this.c = 1;
    this.s = 0;
  }

  set(pos, heading) {
    this.pos.copy(pos);
    this.heading = heading;
    this.c = Math.cos(heading);
    this.s = Math.sin(heading);
    this.m.makeRotationY(heading).setPosition(pos);
    return this;
  }

  /** world point of local (x, y, z); y above the base, or above the terrain when `ground` */
  point(x, y, z, ground, out) {
    out.x = this.pos.x + x * this.c + z * this.s;
    out.z = this.pos.z - x * this.s + z * this.c;
    out.y = ground ? heightAt(out.x, out.z) + y : this.pos.y + y;
    return out;
  }

  /** world matrix of a local pose { x, y, z, yaw, pitch, roll, ground } */
  matrix(pose, out) {
    this.point(pose.x, pose.y, pose.z, pose.ground, _w);
    _e.set(pose.pitch ?? 0, this.heading + (pose.yaw ?? 0), pose.roll ?? 0, 'YXZ');
    return out.compose(_w, _q.setFromEuler(_e), ONE);
  }
}

// ---------------------------------------------------------------- loads

/** A load's time line. Poses are plain objects; segments { t0, t1, a, b, fn, arg, hide }. */
export class LoadPlan {
  constructor(pose, t = 0) {
    this.segs = [];
    this.t = t;
    this.at = { ...pose };
    this.fr = null; // the frame new segments are in (a key of the scene's frames; null: the vehicle's)
    this.m = new THREE.Matrix4();
    this.visible = false;
  }

  /** from now on in frame `key` (with the pose given in it) */
  in(key, pose = this.at) {
    this.fr = key;
    this.at = { ...pose };
    return this;
  }

  /** stay where it is until t1 */
  hold(t1) {
    if (t1 > this.t) this.segs.push({ t0: this.t, t1, a: this.at, b: this.at, fr: this.fr });
    this.t = Math.max(this.t, t1);
    return this;
  }

  /** ease to `pose` over dur s (from the current time); `lin` keeps a constant speed */
  to(dur, pose, lin = false) {
    const b = { ...this.at, ...pose };
    this.segs.push({ t0: this.t, t1: this.t + dur, a: this.at, b, lin, fr: this.fr });
    this.at = b;
    this.t += dur;
    return this;
  }

  /** a stretch where the scene places it: fn(seg, k 0..1, out Matrix4) -> out, arg passed in seg.arg;
   *  `end` is its local pose at the end (for what follows) */
  fn(dur, fn, arg, end) {
    this.segs.push({ t0: this.t, t1: this.t + dur, fn, arg, a: this.at, b: end ?? this.at });
    if (end) this.at = { ...end };
    this.t += dur;
    return this;
  }

  /** gone (inside a vehicle, delivered) from now until t1 (Infinity: for good) */
  hide(t1 = Infinity) {
    this.segs.push({ t0: this.t, t1, hide: true, a: this.at, b: this.at });
    this.t = t1;
    return this;
  }

  /** the load's world matrix at t into this.m; false while hidden. frames: other frames by key */
  eval(t, frame, frames = null) {
    const segs = this.segs;
    let s = segs[0];
    for (let i = 0; i < segs.length; i++) {
      if (segs[i].t0 <= t) s = segs[i];
      else break;
    }
    if (!s) return (this.visible = false);
    if (s.hide && t < s.t1) return (this.visible = false);
    const k = s.t1 > s.t0 ? Math.min(1, Math.max(0, (t - s.t0) / (s.t1 - s.t0))) : 1;
    if (s.fn) s.fn(s, s.lin ? k : smooth(k), this.m);
    else {
      if (s.fr && frames) frame = frames[s.fr];
      const a = s.a, b = s.b, e = t >= s.t1 ? 1 : s.lin ? k : smooth(k);
      POSE.x = lerp(a.x, b.x, e);
      POSE.y = lerp(a.y, b.y, e);
      POSE.z = lerp(a.z, b.z, e);
      POSE.yaw = lerp(a.yaw ?? 0, (a.yaw ?? 0) + wrapPi((b.yaw ?? 0) - (a.yaw ?? 0)), e);
      POSE.pitch = lerp(a.pitch ?? 0, b.pitch ?? 0, e);
      POSE.roll = lerp(a.roll ?? 0, b.roll ?? 0, e);
      POSE.ground = e < 0.5 ? a.ground : b.ground;
      if (a.ground !== b.ground) {
        // between the terrain and the vehicle: blend the two heights
        const ya = a.ground ? heightAt(frame.point(POSE.x, 0, POSE.z, false, _o).x, _o.z) - frame.pos.y + a.y : a.y;
        const yb = b.ground ? heightAt(frame.point(POSE.x, 0, POSE.z, false, _o).x, _o.z) - frame.pos.y + b.y : b.y;
        POSE.y = lerp(ya, yb, e);
        POSE.ground = false;
      }
      frame.matrix(POSE, this.m);
    }
    return (this.visible = true);
  }
}
const POSE = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0, ground: false };

/** a local pose's point (load space -> vehicle space), for planning (a new vector unless `out`) */
export function poseApply(pose, lx, ly, lz, out = new THREE.Vector3()) {
  _e.set(pose.pitch ?? 0, pose.yaw ?? 0, pose.roll ?? 0, 'YXZ');
  out.set(lx, ly, lz).applyEuler(_e);
  out.x += pose.x;
  out.y += pose.y;
  out.z += pose.z;
  return out;
}

// ---------------------------------------------------------------- men

/**
 * A crewman's time line. State { x, y, z, h, ground } (local; h relative to the vehicle). Segments
 * { t0, t1, a, b, pose, gait, ph0, ph1, rate, grips, hide, ease }.
 */
export class ManPlan {
  constructor(at, t = 0) {
    this.segs = [];
    this.t = t;
    this.at = { ground: true, h: 0, y: 0, ...at };
    this.pose = 'stand';
    this.ph = 0;
    this.fr = null; // the frame new segments are in (null: the vehicle's)
  }

  /** from now on in frame `key`, standing at `at` in it */
  in(key, at = this.at) {
    this.fr = key;
    this.at = { ...this.at, ...at };
    return this;
  }

  /** hidden (inside the vehicle) until t1 */
  hide(t1) {
    this.segs.push({ t0: this.t, t1, a: this.at, b: this.at, hide: true, pose: 'stand', ph0: 0, ph1: 0, fr: this.fr });
    this.t = Math.max(this.t, t1);
    this.ph = 0;
    return this;
  }

  /** stay in `pose` until t1, hands on `grips` ([{ side, load, p: [x, y, z], kind }] in load space) */
  hold(t1, pose = this.pose, grips = null, rate = 0.25) {
    if (t1 <= this.t) return this;
    const ph0 = pose === this.pose ? this.ph : 0;
    this.segs.push({ t0: this.t, t1, a: this.at, b: this.at, pose, gait: null, ph0, ph1: ph0 + rate * (t1 - this.t), rate, grips, fr: this.fr });
    this.pose = pose;
    this.ph = ph0 + rate * (t1 - this.t);
    this.t = t1;
    return this;
  }

  /**
   * Go to `to` ({ x, z, y?, h?, ground? }) over dur s. opts: pose (held while standing still, or the
   * upper body when the gait is none), gait ('auto' picks walk / back / side from the move against the
   * facing; 'carry' the same with the carrying walk; 'climb'; 'none' slides the root, for small shifts
   * and turns in place), grips, ease (default true for 'none').
   */
  move(dur, to, { pose = this.pose, gait = 'auto', grips = null, ease = null, face = null } = {}) {
    const a = this.at, b = { ...a, ...to };
    if (face != null) b.h = face;
    const dx = b.x - a.x, dz = b.z - a.z, dist = Math.hypot(dx, dz);
    // the move in his own frame (the mean facing): forward is -Z, right +X
    const h = a.h + wrapPi(b.h - a.h) / 2, c = Math.cos(h), s = Math.sin(h);
    const fwd = -(dx * s + dz * c), right = dx * c - dz * s;
    let g = gait, name = pose, ph1 = 0, ph0 = 0;
    if (g === 'climb') {
      name = 'climb';
      ph0 = this.pose === 'climb' ? this.ph : 0;
      ph1 = ph0 + (b.y - a.y) / CREW_GAITS.climb.rise;
    } else if (g === 'stoop') {
      name = 'stoopWalk';
      ph0 = this.pose === name ? this.ph : 0;
      ph1 = ph0 + fwd / CREW_GAITS.stoopWalk.stride;
    } else if ((g === 'auto' || g === 'carry') && dist > 0.12) {
      if (Math.abs(right) > Math.abs(fwd) * 1.2) {
        name = 'sidestep';
        ph0 = this.pose === name ? this.ph : 0;
        ph1 = ph0 + right / CREW_GAITS.sidestep.stride;
      } else {
        name = g === 'carry' ? 'carryWalk' : 'walk';
        ph0 = this.pose === name ? this.ph : 0;
        ph1 = ph0 + fwd / CREW_GAITS[name].stride;
      }
    } else {
      g = 'none';
      ph0 = name === this.pose ? this.ph : 0;
      ph1 = ph0 + 0.25 * dur;
    }
    this.segs.push({ t0: this.t, t1: this.t + dur, a, b, pose: name, gait: g, ph0, ph1, grips, ease: ease ?? g === 'none', fr: this.fr });
    this.at = b;
    this.pose = name;
    this.ph = ph1;
    this.t += dur;
    return this;
  }
}

const SIDES = ['L', 'R'];

/**
 * A crewman of a scene: a Crewman (pattern mm14) and its current plan.
 */
export class Hand {
  constructor(group, opts) {
    this.c = new Crewman(group, opts);
    this.fig = this.c.fig;
    this.plan = null;
  }

  hide() {
    this.c.hide();
  }

  /** pose for scene time t; loads: the scene's LoadPlans (already evaluated for t); frames: other
   *  frames by key (a segment's `fr`) */
  eval(t, frame, loads, frames = null) {
    const plan = this.plan;
    if (!plan) return this.c.hide();
    const segs = plan.segs;
    let i = -1;
    for (let j = 0; j < segs.length; j++) {
      if (segs[j].t0 <= t) i = j;
      else break;
    }
    if (i < 0) return this.c.hide();
    const s = segs[i];
    if (s.hide && t < s.t1) return this.c.hide();
    if (s.fr && frames) frame = frames[s.fr];
    const raw = s.t1 > s.t0 ? Math.min(1, Math.max(0, (t - s.t0) / (s.t1 - s.t0))) : 1;
    const k = s.ease ? smooth(raw) : raw;
    const a = s.a, b = s.b;
    const x = lerp(a.x, b.x, k), z = lerp(a.z, b.z, k);
    const h = a.h + wrapPi(b.h - a.h) * k;
    // the root: on the terrain or on the vehicle (a climb blends the two)
    let y;
    frame.point(x, 0, z, false, _w);
    const gy = heightAt(_w.x, _w.z) - frame.pos.y;
    const ya = a.ground ? gy + (a.y ?? 0) : a.y, yb = b.ground ? gy + (b.y ?? 0) : b.y;
    y = lerp(ya, yb, k);
    const ph = s.ph0 + (s.ph1 - s.ph0) * (t >= s.t1 ? 1 : k);
    const c = this.c;
    c.root.visible = true;
    c.root.position.set(_w.x, frame.pos.y + y, _w.z);
    c.root.rotation.set(0, frame.heading + h, 0);
    // fade in from the last segment's pose
    const prev = i > 0 ? segs[i - 1] : null;
    const fade = prev && !prev.hide && prev.pose !== s.pose ? Math.min(1, (t - s.t0) / Math.min(FADE, Math.max(0.05, s.t1 - s.t0))) : 1;
    if (fade < 1) {
      this.fig.pose(prev.pose, prev.ph1, 1);
      this.fig.pose(s.pose, ph, smooth(fade));
    } else this.fig.pose(s.pose, ph, 1);
    // hands on the loads (the grips fade in with the pose)
    const grips = s.grips;
    if (grips) {
      c.root.updateMatrix();
      for (const g of grips) {
        const L = loads[g.load];
        if (!L || !L.visible) continue;
        _p.set(g.p[0], g.p[1], g.p[2]).applyMatrix4(L.m);
        toRoot(c.root, _p, _p);
        handDirs(g.kind, L.m, c.root, g.side);
        const blend = prev && prev.grips ? 1 : smooth(Math.min(1, (t - s.t0) / Math.min(FADE, Math.max(0.05, s.t1 - s.t0))));
        this.fig.reach(g.side, _p, blend, _f, _n, null);
      }
    }
  }
}

// world point to a figure's root space (position + rotation.y)
function toRoot(root, p, out) {
  const dx = p.x - root.position.x, dz = p.z - root.position.z, h = root.rotation.y, c = Math.cos(h), s = Math.sin(h);
  out.set(dx * c - dz * s, p.y - root.position.y, dx * s + dz * c);
  return out;
}

// a world direction to root space
function dirToRoot(root, d, out) {
  const h = root.rotation.y, c = Math.cos(h), s = Math.sin(h);
  return out.set(d.x * c - d.z * s, d.y, d.x * s + d.z * c);
}

// finger and palm directions (root space) for a grip kind: 'under' palms up under a load, 'top' palms
// down on it, 'side' palms in against its side (the hand's side of the man), 'end' palms forward on an
// end face, 'lip' fingers over an edge
function handDirs(kind, lm, root, side) {
  const sgn = side === 'L' || side === 0 ? -1 : 1;
  switch (kind) {
    case 'top':
      _f.set(0, -0.35, -1);
      _n.set(0, -1, 0.15);
      break;
    case 'side':
      _f.set(0, -0.2, -1);
      _n.set(-sgn, 0, 0);
      break;
    case 'end':
      _f.set(0, 1, -0.2);
      _n.set(0, 0, -1);
      break;
    case 'up':
      // overhead, palms up under the load
      _f.set(0, 0.4, -1);
      _n.set(-sgn * 0.3, 1, 0);
      break;
    default:
      // under: palms up and in
      _f.set(0, -0.1, -1);
      _n.set(-sgn * 0.6, 0.8, 0);
  }
  return lm;
}

export { SIDES, smooth, lerp, wrapPi };
