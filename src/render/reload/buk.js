import * as THREE from 'three';
import { Parts, vehicleMats } from '../../models/kit.js';
import { addMissile9M317 } from '../../models/v/buk.js';
import { Timeline, Crewman, placeOnGround, smooth, ramp, ease } from '../reload.js';

// Buk-M2: the 9A316 loader-launcher reloads a 9A317 TELAR (refs/buk/README.md section E, a
// reconstruction: no photo of a Buk reload was found). The TELAR turns its launcher to the rear and
// lays it level (the sim's reloadPose; its rounds then lie along the hull, noses aft, as in travel);
// the loader-launcher turns its crane end to the rear (reloadPose.crane) and drives over from its own
// spot to park alongside the TELAR, on its right, 0.6 m between the tracks, its crane post level with
// the TELAR's rounds (both launchers point the same way); it raises its own launcher clear of its rack
// (the reference's "near vertical when reloading"), the crew get out: the crane operator at the control
// box on the loader's deck, the loader's third man on the ground ahead of the two vehicles, one of the
// TELAR's crew on its engine deck behind the noses; the crane unfolds and lifts the rounds one at a
// time from the rack, over onto the TELAR's empty rails (the jib's telescopic sections reach the far
// rail), each hanging level from the lifting beam and keeping its heading; it folds, the launcher comes
// down, the crew get back in and the loader-launcher pulls ahead 6.5 m, all inside the job, so the
// TELAR is free to turn when the rounds count. After the job it drives back to its spot. When it loads its
// own rails it does the same where it stands, its launcher level, rounds from the rack taken so none
// passes under a loaded rail. The loader-launcher's rack shows the reserve again once it is back.
//
// The loader-launcher is the battery's own rig (UnitViews places it; the scene moves it while it
// works and puts it back where the sim has it). Its crane joints, its launcher's elevation while the
// rounds go over and its rack slots are posed here; everything else follows the sim. Rounds in transit
// and on the TELAR until the sim counts them are this scene's (one instanced mesh, the same 9M317).

const GAP = 0.6; // m between the two vehicles' aprons
const HALF = 1.625; // their half width over the aprons (GM-569 and GM-577)
const APPROACH = 14; // m: the last straight in alongside the TELAR (the turn done before its front passes the TELAR's tail)
const PULL = 6.5; // m: pulled ahead before the job ends, clear of the TELAR's launcher when it turns
const HOME_IN = 8; // m: the last straight into its own spot
const TURN_R = 11; // m: the turning circle on the way
const SPEED = { cruise: 15, approach: 3.5, pull: 3.5, acc: 2.2, dec: 2.2, lat: 2.6 };
const AXLES = { front: -2.72, rear: 2.43, half: 1.37 }; // GM-577 first and last road wheels, track
const CARRY = 2.65; // turret-space height of a round's axis in the swing (clear of the TELAR's rounds, the operator)
const LOW = 1.6; // ... while it leaves the rack on the TELAR's side
const HOOK = 0.7; // cable below the tip at the carry height
const RAISE = 1.15; // the loader-launcher's own launcher while the crane takes rounds from under it
const EXT0 = 2.6, EXTK = 1.5; // the jib's telescope: out (EXTK per m) beyond EXT0 m from the boom hinge
const OP = [-0.22, 0.1, -2.62]; // the crane operator's place on the deck (turret space), by the control box
const TRAVEL = { s: 0, b: 0.18, j: -2.36, e: 0, d: 0.6, p: 0 };
const N = 4; // rounds in transit at most

// ---------------------------------------------------------------- small math

const TAU = Math.PI * 2;
const wrap = (a) => {
  a %= TAU;
  if (a < 0) a += TAU;
  return a > TAU - 1e-7 ? 0 : a;
};
const wrapPi = (a) => {
  a = (a + Math.PI) % TAU;
  return (a < 0 ? a + TAU : a) - Math.PI;
};
const unwrapNear = (a, b) => a + Math.round((b - a) / TAU) * TAU;
const lerp = (a, b, k) => a + (b - a) * k;
const fwdX = (h) => -Math.sin(h);
const fwdZ = (h) => -Math.cos(h);

// ---------------------------------------------------------------- driving

// A drive: straights and arcs in the world (x, z; headings are rotation.y, + turns left) driven from
// rest to rest with a speed profile (each piece's limit, acceleration and braking). at(s) is the pose
// after s metres, sAt(t) the metres after t s.
class Drive {
  constructor() {
    this.segs = [];
    this.len = 0;
    this.T = 0;
  }

  line(x, z, h, len, v) {
    if (len > 1e-3) this.segs.push({ arc: false, x, z, h, len, v, s0: this.len });
    this.len += Math.max(0, len);
    return this;
  }

  // round the circle centred (cx, cz) from heading h0 by dh (side +1 left, -1 right)
  arc(cx, cz, R, side, h0, dh, v) {
    const len = Math.abs(dh) * R;
    if (len > 1e-3) this.segs.push({ arc: true, cx, cz, R, side, h0, len, v, s0: this.len });
    this.len += len;
    return this;
  }

  profile() {
    const ds = 0.25, n = Math.max(2, Math.ceil(this.len / ds) + 1);
    const v = new Float32Array(n), t = new Float32Array(n);
    const step = this.len / (n - 1);
    for (let i = 0; i < n; i++) v[i] = this.limit(i * step);
    v[0] = 0;
    for (let i = 1; i < n; i++) v[i] = Math.min(v[i], Math.sqrt(v[i - 1] * v[i - 1] + 2 * SPEED.acc * step));
    v[n - 1] = 0;
    for (let i = n - 2; i >= 0; i--) v[i] = Math.min(v[i], Math.sqrt(v[i + 1] * v[i + 1] + 2 * SPEED.dec * step));
    for (let i = 1; i < n; i++) t[i] = t[i - 1] + step / Math.max(0.5 * (v[i - 1] + v[i]), 0.1);
    this.ts = t;
    this.step = step;
    this.T = this.len > 1e-3 ? t[n - 1] : 0;
    return this;
  }

  limit(s) {
    for (const g of this.segs) if (s <= g.s0 + g.len + 1e-6) return g.v;
    return this.segs.length ? this.segs[this.segs.length - 1].v : 1;
  }

  sAt(t) {
    const ts = this.ts;
    if (!ts || t <= 0) return 0;
    if (t >= this.T) return this.len;
    let lo = 0, hi = ts.length - 1;
    while (hi - lo > 1) {
      const m = (lo + hi) >> 1;
      if (ts[m] <= t) lo = m;
      else hi = m;
    }
    return Math.min(this.len, (lo + (t - ts[lo]) / (ts[hi] - ts[lo])) * this.step);
  }

  at(s, out) {
    const segs = this.segs;
    if (!segs.length) return out;
    let g = segs[segs.length - 1];
    for (const x of segs) if (s <= x.s0 + x.len) { g = x; break; }
    const u = Math.min(Math.max(s - g.s0, 0), g.len);
    if (g.arc) {
      const h = g.h0 + (g.side * u) / g.R;
      out.x = g.cx + g.side * g.R * Math.cos(h);
      out.z = g.cz - g.side * g.R * Math.sin(h);
      out.h = h;
    } else {
      out.x = g.x + fwdX(g.h) * u;
      out.z = g.z + fwdZ(g.h) * u;
      out.h = g.h;
    }
    return out;
  }
}

// The shortest of the four turn-straight-turn paths (Dubins: LSL, RSR, LSR, RSL) from pose a to pose
// b ({ x, z, h }) with turning radius R that keeps clear of the obstacles (ok(x, z, h) says a pose is
// clear); the shortest overall when none is.
function dubins(drive, a, b, R, ok) {
  const cands = [];
  for (const [s1, s2] of [[1, 1], [-1, -1], [1, -1], [-1, 1]]) {
    // a circle's centre: left of the heading for a left turn (+1), right for a right one
    const c1x = a.x - s1 * R * Math.cos(a.h), c1z = a.z + s1 * R * Math.sin(a.h);
    const c2x = b.x - s2 * R * Math.cos(b.h), c2z = b.z + s2 * R * Math.sin(b.h);
    const dx = c2x - c1x, dz = c2z - c1z, d = Math.hypot(dx, dz);
    const hD = Math.atan2(-dx, -dz);
    let hl, lam;
    if (s1 === s2) {
      hl = hD;
      lam = d;
    } else {
      if (d < 2 * R + 1e-6) continue;
      lam = Math.sqrt(d * d - 4 * R * R);
      const del = Math.atan2(2 * R, lam);
      hl = s1 > 0 ? hD + del : hD - del;
    }
    const dh1 = s1 * wrap(s1 * (hl - a.h)), dh2 = s2 * wrap(s2 * (b.h - hl));
    cands.push({ s1, s2, c1x, c1z, c2x, c2z, hl, lam, dh1, dh2, L: R * (Math.abs(dh1) + Math.abs(dh2)) + lam });
  }
  cands.sort((p, q) => p.L - q.L);
  const vArc = Math.min(SPEED.cruise, Math.sqrt(SPEED.lat * R));
  const build = (c) => {
    const g = new Drive();
    g.arc(c.c1x, c.c1z, R, c.s1, a.h, c.dh1, vArc);
    const tx = c.c1x + c.s1 * R * Math.cos(c.hl), tz = c.c1z - c.s1 * R * Math.sin(c.hl);
    g.line(tx, tz, c.hl, c.lam, SPEED.cruise);
    g.arc(c.c2x, c.c2z, R, c.s2, c.hl, c.dh2, vArc);
    return g;
  };
  const pose = { x: 0, z: 0, h: 0 };
  for (const c of cands) {
    const g = build(c);
    let clear = true;
    for (let s = 0; s <= g.len && clear; s += 0.5) clear = ok(g.at(s, pose));
    if (clear) return append(drive, g);
  }
  return cands.length ? append(drive, build(cands[0])) : drive;
}

function append(drive, g) {
  for (const x of g.segs) {
    if (x.arc) drive.arc(x.cx, x.cz, x.R, x.side, x.h0, (x.side * x.len) / x.R, x.v);
    else drive.line(x.x, x.z, x.h, x.len, x.v);
  }
  return drive;
}

// Obstacles: the battery's other vehicles as boxes ({ x, z, h, x0, x1, z0, z1 } in their own frames);
// the loader-launcher as five discs along its length (they cover its corners).
function clearOf(boxes) {
  return (p) => {
    for (let k = -2; k <= 2; k++) {
      const cx = p.x + fwdX(p.h) * 1.7 * k, cz = p.z + fwdZ(p.h) * 1.7 * k;
      for (const b of boxes) {
        const dx = cx - b.x, dz = cz - b.z, c = Math.cos(b.h), s = Math.sin(b.h);
        // world to the box's frame (inverse of rotation.y)
        const lx = dx * c - dz * s, lz = dx * s + dz * c;
        const qx = lx - Math.min(Math.max(lx, b.x0), b.x1), qz = lz - Math.min(Math.max(lz, b.z0), b.z1);
        if (qx * qx + qz * qz < 1.9 * 1.9) return false;
      }
    }
    return true;
  };
}

// ---------------------------------------------------------------- the crane

// Two-link solution for the jib tip at reach r (from the slew axis) and h over the boom hinge: the
// telescope runs out with the distance, the boom stands up (elbow up), the jib reaches out.
function craneIK(C, r, h, out) {
  const d = Math.hypot(r, h);
  const e = Math.min(C.extMax, Math.max(0, (d - EXT0) * EXTK));
  const L = C.L2 + e;
  const dd = Math.min(Math.max(d, Math.abs(C.L1 - L) + 1e-4), C.L1 + L - 1e-4);
  const g = Math.acos(Math.min(1, Math.max(-1, (C.L1 * C.L1 + dd * dd - L * L) / (2 * C.L1 * dd))));
  const b = Math.atan2(h, r) + g;
  out.b = b;
  out.j = Math.atan2(h - C.L1 * Math.sin(b), r - C.L1 * Math.cos(b)) - b;
  out.e = e;
  return out;
}

// A crane key: slew s, hook heading p (the load's yaw in turret space), cable d below the tip, and
// either the joints (b boom, j jib, e telescope) or the task (r reach, y tip height over the hinge).
const key = (o) => ({ t: 0, dt: 0, joint: false, s: 0, r: 0, y: 0, d: HOOK, p: 0, b: 0, j: 0, e: 0, tag: null, L: null, ...o });

const _cr = { s: 0, b: 0, j: 0, e: 0, d: 0, p: 0 }, _ik = { b: 0, j: 0, e: 0 };
function cranePose(C, keys, t, out = _cr) {
  let i = 0;
  while (i < keys.length - 1 && keys[i + 1].t <= t) i++;
  const a = keys[i], b = keys[Math.min(i + 1, keys.length - 1)];
  const k = b === a || t <= a.t ? 0 : ease(Math.min(1, (t - a.t) / (b.t - a.t)));
  out.s = lerp(a.s, b.s, k);
  out.d = lerp(a.d, b.d, k);
  out.p = lerp(a.p, b.p, k);
  if ((a.joint && b.joint) || b === a) {
    out.b = lerp(a.b, b.b, k);
    out.j = lerp(a.j, b.j, k);
    out.e = lerp(a.e, b.e, k);
  } else {
    craneIK(C, lerp(a.r, b.r, k), lerp(a.y, b.y, k), _ik);
    out.b = _ik.b;
    out.j = _ik.j;
    out.e = _ik.e;
  }
  return out;
}

function setCrane(rig, c) {
  const p = rig.pivots;
  p.crane.rotation.y = c.s;
  p.craneBoom.rotation.x = c.b;
  p.craneJib.rotation.x = c.j;
  rig.setCraneExt?.(c.e);
  const hook = rig.anchors.craneHook;
  hook.position.y = -Math.max(0.6, c.d);
  hook.rotation.y = c.p - c.s;
}

// ---------------------------------------------------------------- props

let GEO = null;
function missileGeometry() {
  if (GEO) return GEO;
  const mats = vehicleMats('green');
  const P = new Parts(mats);
  addMissile9M317(P);
  const g = P.merged('white');
  g.setAttribute('aH', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count).fill(3), 1));
  g.computeBoundingSphere();
  GEO = { geometry: g, material: mats.white };
  return GEO;
}

const HIDE = new THREE.Matrix4().makeScale(0, 0, 0);

// ---------------------------------------------------------------- planning

const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _m = new THREE.Matrix4(), _o = { x: 0, z: 0, h: 0 };
const _dummy = new THREE.Object3D();

// what the rigs give the plan (measured once): the TELAR's rounds in the loading pose in its own frame,
// the loader-launcher's rack and launcher slots and its crane in turret space
function measure(ctx, st) {
  const u = ctx.unit;
  const T = ctx.rig(u.telars[0]), L = ctx.rig(u.loader);
  const keep = (rig) => [rig.pivots.turret.rotation.y, rig.pivots.elevation.rotation.x];
  const put = (rig, [a, e]) => {
    rig.pivots.turret.rotation.y = a;
    rig.pivots.elevation.rotation.x = e;
    rig.root.updateMatrixWorld(true);
  };
  // the TELAR's slots, turret at PI and launcher level, in the TELAR's root frame
  const kt = keep(T);
  put(T, [Math.PI, 0]);
  _m.copy(T.root.matrixWorld).invert();
  st.telarSlots = T.anchors.missileSlots.map((a) => a.getWorldPosition(new THREE.Vector3()).applyMatrix4(_m));
  put(T, kt);
  // the loader-launcher's slots in turret space (launcher level), its crane post in its root frame
  const kl = keep(L);
  put(L, [Math.PI, 0]);
  _m.copy(L.pivots.turret.matrixWorld).invert();
  st.loaderSlots = L.anchors.missileSlots.map((a) => a.getWorldPosition(new THREE.Vector3()).applyMatrix4(_m));
  _m.copy(L.root.matrixWorld).invert();
  st.postLocal = L.pivots.crane.getWorldPosition(new THREE.Vector3()).applyMatrix4(_m);
  put(L, kl);
  const p = L.pivots;
  st.crane = {
    x: p.crane.position.x, z: p.crane.position.z, hinge: p.crane.position.y + p.craneBoom.position.y,
    L1: -p.craneJib.position.z, L2: -p.craneHoist.position.z, extMax: L.craneExtMax ?? 0,
  };
  st.turret = { y: p.turret.position.y, z: p.turret.position.z };
  // where the loader-launcher parks in the TELAR's frame: alongside on the right, its crane post level
  // with the middle of the TELAR's rounds
  const rowZ = st.telarSlots.reduce((a, s) => a + s.z, 0) / st.telarSlots.length;
  st.park = { x: HALF + GAP + HALF, z: rowZ - st.postLocal.z };
}

// the loader-launcher's root matrix standing at (x, z) facing h, and its turret's (laid at PI)
function parkedTurret(ctx, st, x, z, h, out) {
  placeOnGround(_dummy, x, z, h, AXLES.front, AXLES.rear, AXLES.half, ctx.ground);
  _dummy.updateMatrix();
  out.copy(_dummy.matrix);
  _m.makeRotationY(Math.PI).setPosition(0, st.turret.y, st.turret.z);
  return out.multiply(_m);
}

// the battery's other vehicles as obstacles for the drive (target: the TELAR loaded, laid to the rear)
function obstacles(u, target) {
  const out = [];
  u.parts.forEach((p, i) => {
    if (i === u.loader) return;
    const B = (x0, x1, z0, z1) => out.push({ x: p.pos.x, z: p.pos.z, h: p.heading, x0, x1, z0, z1 });
    if (i === target) B(-1.75, 1.75, -5.3, 4.1);
    else if (p.role === 'telar') B(-4.7, 4.7, -5.6, 5.6);
    else if (p.role === 'radar') B(-2.7, 2.7, -5.3, 5.3);
    else B(-2.0, 2.0, -4.9, 4.9);
  });
  return out;
}

// the drive in: from the pose a to alongside the TELAR (b), the last APPROACH metres straight and slow
function driveIn(a, b, ok) {
  const d = new Drive();
  const pre = { x: b.x - fwdX(b.h) * APPROACH, z: b.z - fwdZ(b.h) * APPROACH, h: b.h };
  if (Math.hypot(a.x - pre.x, a.z - pre.z) > 0.5 || Math.abs(Math.sin((a.h - b.h) / 2)) > 0.02) dubins(d, a, pre, TURN_R, ok);
  d.line(pre.x, pre.z, b.h, APPROACH, SPEED.approach);
  return d.profile();
}

// back home from a: the turn-straight-turn, then HOME_IN metres straight in
function driveHome(a, home, ok) {
  const d = new Drive();
  const dist = Math.hypot(a.x - home.x, a.z - home.z);
  if (dist < 0.3 && Math.abs(Math.sin((a.h - home.h) / 2)) < 0.01) return d.profile();
  const pre = { x: home.x - fwdX(home.h) * HOME_IN, z: home.z - fwdZ(home.h) * HOME_IN, h: home.h };
  dubins(d, a, pre, TURN_R, ok);
  d.line(pre.x, pre.z, home.h, HOME_IN, SPEED.approach);
  return d.profile();
}

// a lift's nominal durations (scaled to the time the job leaves for the crane)
const T_MOVE = (ds, dr, dy) => 0.8 + Math.abs(ds) / 0.55 + Math.abs(dr) / 1.0 + Math.abs(dy) / 0.9;

/**
 * Plan a job: the drives, the time line, which rack round goes to which slot and the crane's keys.
 * play = { self (loading its own rails), a (where it starts), park (where it works), home, drives
 * [{ drive, t0, t1, k (time scale), from }], lifts [{ id, rack, slot, src, dst, yaw, tGrip, tCarry,
 * tRelease }], keys, tl, w0, w1 (the work window), end }; start() adds crew and raise.
 */
function plan(ctx, st, job) {
  const u = ctx.unit, Li = u.loader, lp = u.parts[Li];
  const self = job.part === Li;
  const C = st.crane;
  const home = { x: lp.pos.x, z: lp.pos.z, h: lp.heading };
  const a = { x: st.pose.x, z: st.pose.z, h: st.pose.h };
  const dur = job.dur;
  const play = { job, self, a, drives: [], lifts: [], keys: [], dur };
  const ok = clearOf(obstacles(u, job.part));
  // where it works
  let park = a;
  if (!self) {
    const tp = u.parts[job.part];
    const c = Math.cos(tp.heading), s = Math.sin(tp.heading);
    park = { x: tp.pos.x + st.park.x * c + st.park.z * s, z: tp.pos.z - st.park.x * s + st.park.z * c, h: tp.heading };
  }
  play.park = park;
  // the drives: in (sped up only if the job leaves too little for the crane), pulling ahead, home
  const n = job.slots.length;
  const minWork = 5.5 + 3.5 * n;
  let tWork0 = 0.6, tWork1 = dur - 0.2;
  if (!self) {
    const din = driveIn(a, park, ok);
    const pull = new Drive().line(park.x, park.z, park.h, PULL, SPEED.pull).profile();
    const budget = Math.max(6, dur - pull.T - 1.2 - minWork);
    const k = din.T > budget ? din.T / budget : 1;
    play.drives.push({ drive: din, t0: 0.4, t1: 0.4 + din.T / k, k, from: a });
    play.drives.push({ drive: pull, t0: dur - pull.T, t1: dur, k: 1, from: park });
    tWork0 = 0.4 + din.T / k + 0.5;
    tWork1 = dur - pull.T - 0.2;
    const back = { x: park.x + fwdX(park.h) * PULL, z: park.z + fwdZ(park.h) * PULL, h: park.h };
    const dh = driveHome(back, home, ok);
    play.drives.push({ drive: dh, t0: dur + 0.6, t1: dur + 0.6 + dh.T, k: 1, from: back });
    play.end = dur + 0.6 + dh.T + 0.2;
  } else {
    const dh = driveHome(a, home, ok);
    play.drives.push({ drive: dh, t0: dur + 0.6, t1: dur + 0.6 + dh.T, k: 1, from: a });
    play.end = dur + 0.6 + dh.T + 0.2;
  }
  play.home = home;
  // the target slots in turret space (where the loader-launcher works) and the rounds to take
  _m.copy(parkedTurret(ctx, st, park.x, park.z, park.h, new THREE.Matrix4())).invert();
  let dst;
  if (self) dst = job.slots.map((k) => ({ slot: k, p: st.loaderSlots[k].clone(), yaw: 0 }));
  else {
    const tp = u.parts[job.part];
    const tm = new THREE.Matrix4().makeRotationY(tp.heading).setPosition(tp.pos);
    // the TELAR's rounds lie noses aft like the rack's (both turrets at PI, same heading): yaw 0
    dst = job.slots.map((k) => ({ slot: k, p: st.telarSlots[k].clone().applyMatrix4(tm).applyMatrix4(_m), yaw: wrapPi(tp.heading - park.h) }));
  }
  const rack = rackOrder(ctx, st, self, job, n);
  for (let i = 0; i < n; i++) play.lifts.push({ id: i, rack: rack[i], src: st.loaderSlots[rack[i]], dst: dst[i].p, yaw: dst[i].yaw, slot: dst[i].slot, tGrip: 0, tRelease: 0 });
  // the time line inside the work window
  const tl = new Timeline();
  const fixed = tWork1 - tWork0 > 6.3 + 3 * n;
  tl.add('prep', 1.5, fixed).add('unfold', 1.8, fixed).add('lifts', 9 * n).add('stow', 1.8, fixed).add('crewIn', 1.2, fixed).fit(tWork0, tWork1);
  play.tl = tl;
  play.w0 = tWork0;
  play.w1 = tWork1;
  craneTrack(C, play);
  return play;
}

// Which rack round goes to which slot. To a TELAR: the rounds on the TELAR's side of the crane first
// (its own launcher is raised clear). To its own rails (launcher level): a rack round can only come up
// where the outer rail above it is empty, so they are matched to keep that true at every lift.
function rackOrder(ctx, st, self, job, n) {
  const shown = [];
  const ld = ctx.loaded(ctx.unit.loader);
  for (let k = 4; k < 8; k++) if (ld[k] ?? false) shown.push(k);
  for (let k = 4; shown.length < n && k < 8; k++) if (!shown.includes(k)) shown.push(k);
  const side = (k) => Math.sign(st.loaderSlots[k].x - st.crane.x);
  if (!self) return shown.sort((a, b) => side(b) - side(a) || Math.abs(st.loaderSlots[a].x - st.crane.x) - Math.abs(st.loaderSlots[b].x - st.crane.x)).slice(0, n);
  // own rails: the outer rail on each side (larger |x|) blocks the rack rounds on that side
  const outer = (s) => [0, 1, 2, 3].reduce((best, k) => (Math.sign(st.loaderSlots[k].x) === s && (best < 0 || Math.abs(st.loaderSlots[k].x) > Math.abs(st.loaderSlots[best].x)) ? k : best), -1);
  const loaded = new Set();
  for (let k = 0; k < 4; k++) if (ld[k] && !job.slots.includes(k)) loaded.add(k);
  const sideOf = (k) => Math.sign(st.loaderSlots[k].x);
  let best = null;
  const tryAll = (i, used, list, rails) => {
    if (best) return;
    if (i === n) {
      best = list.slice();
      return;
    }
    for (const r of shown) {
      if (used.has(r) || rails.has(outer(sideOf(r)))) continue;
      used.add(r);
      list.push(r);
      rails.add(job.slots[i]);
      tryAll(i + 1, used, list, rails);
      rails.delete(job.slots[i]);
      list.pop();
      used.delete(r);
    }
  };
  tryAll(0, new Set(), [], new Set(loaded));
  return best ?? shown.slice(0, n);
}

// The crane's keys for a play: unfold (joints), the lifts (task space, solved every frame), stow.
function craneTrack(C, play) {
  const { tl } = play;
  const keys = [];
  const reach = (x, z) => Math.hypot(x - C.x, z - C.z);
  const slewTo = (x, z) => Math.atan2(-(x - C.x), -(z - C.z));
  const tipY = (axisY, d) => axisY + d - C.hinge; // tip height over the hinge for a hook at axisY
  const travel = key({ ...TRAVEL, joint: true, tag: 'travel' });
  const ready = key({ s: 0, r: 1.1, y: tipY(CARRY, HOOK), d: HOOK, p: 0, joint: true, tag: 'ready' });
  craneIK(C, ready.r, ready.y, ready);
  // unfold
  const unfold = [travel, ready];
  // the lifts
  const lifts = [];
  let prev = ready;
  const sideOfPost = (x) => Math.sign(x - C.x);
  const toward = play.self ? 0 : sideOfPost(play.lifts[0]?.dst.x ?? C.x + 1);
  for (const L of play.lifts) {
    const S = L.src, D = L.dst;
    // the swing: loading itself the short way round; loading a TELAR always round the rear (slews kept
    // within (-PI, PI)): the front is its own raised launcher
    let ss = slewTo(S.x, S.z), sd = slewTo(D.x, D.z);
    if (play.self) {
      ss = unwrapNear(ss, prev.s);
      sd = unwrapNear(sd, ss);
    } else {
      ss = wrapPi(ss);
      sd = wrapPi(sd);
    }
    const rs = reach(S.x, S.z), rd = reach(D.x, D.z);
    // a round on the far side of the post from where it goes passes over the operator: high
    const low = !play.self && sideOfPost(S.x) === toward;
    const hs = low ? LOW : CARRY;
    const over = key({ s: ss, r: rs, y: tipY(hs, HOOK), d: HOOK, p: 0, tag: 'reach' });
    over.dt = T_MOVE(ss - prev.s, rs - prev.r, over.y - prev.y);
    const down = key({ ...over, d: HOOK + hs - S.y, tag: 'down', L });
    down.dt = 0.6 + (hs - S.y) / 1.0;
    const grip = key({ ...down, tag: 'grip', L });
    grip.dt = 0.6;
    const up = key({ s: ss, r: Math.max(rs, 1.5), y: tipY(CARRY, HOOK), d: HOOK, p: 0, tag: 'up', L });
    up.dt = 0.6 + (CARRY - S.y) / 0.9;
    lifts.push(over, down, grip, up);
    // where the round would lie along the boom (its yaw 0 against a slew of 0 or PI) it swings far out,
    // where the boom stands clear of it
    const along = [];
    const lo = Math.min(ss, sd), hi = Math.max(ss, sd);
    for (let m = Math.ceil(lo / Math.PI); m * Math.PI <= hi; m++) along.push(m * Math.PI);
    if (ss > sd) along.reverse();
    let from = up;
    for (const sv of along) {
      if (Math.abs(sv - ss) < 0.05 || Math.abs(sv - sd) < 0.05) continue;
      const via = key({ s: sv, r: Math.max(3.4, rs, rd), y: tipY(CARRY, HOOK), d: HOOK, p: 0, tag: 'via', L });
      via.dt = T_MOVE(sv - from.s, via.r - from.r, 0);
      lifts.push(via);
      from = via;
    }
    const carry = key({ s: sd, r: rd, y: tipY(CARRY, HOOK), d: HOOK, p: L.yaw, tag: 'carry', L });
    carry.dt = T_MOVE(sd - from.s, rd - from.r, 0);
    const lower = key({ ...carry, d: HOOK + CARRY - D.y, tag: 'lower', L });
    lower.dt = 0.6 + (CARRY - D.y) / 0.8;
    const rel = key({ ...lower, tag: 'release', L });
    rel.dt = 0.6;
    const clear = key({ ...carry, tag: 'clear', L });
    clear.dt = 0.5 + (CARRY - D.y) / 1.0;
    lifts.push(carry, lower, rel, clear);
    prev = clear;
  }
  // stow: back over the rear, fold
  const back = key({ ...ready, s: unwrapNear(0, prev.s), tag: 'ready2' });
  if (!play.self) back.s = 0;
  back.dt = T_MOVE(back.s - prev.s, back.r - prev.r, back.y - prev.y);
  const fold = key({ ...TRAVEL, s: back.s, joint: true, tag: 'stowed' });
  fold.dt = 1;
  // lay them out: unfold in its step, the lifts stretched over theirs, the stow in its own
  const lay = (list, t0, t1) => {
    const tot = list.reduce((s, k) => s + k.dt, 0) || 1;
    const sc = (t1 - t0) / tot;
    let t = t0;
    for (const k of list) {
      t += k.dt * sc;
      k.t = t;
    }
  };
  const U = tl.at('unfold'), W = tl.at('lifts'), S = tl.at('stow');
  travel.t = U.start;
  ready.t = U.end;
  if (lifts.length) lay(lifts, W.start, W.end);
  back.dt = 1.6;
  lay([back, fold], S.start, S.end);
  // a travel key at the start and the end keeps it folded outside
  keys.push(key({ ...travel, t: -1e3 }), ...unfold, ...lifts, back, fold, key({ ...fold, t: 1e6 }));
  // the moments a round is taken and set down
  for (const L of play.lifts) {
    L.tGrip = lifts.find((k) => k.tag === 'down' && k.L === L).t;
    L.tRelease = lifts.find((k) => k.tag === 'lower' && k.L === L).t;
    L.tCarry = lifts.find((k) => k.tag === 'carry' && k.L === L).t;
  }
  play.keys = keys;
}

// ---------------------------------------------------------------- crew routes

const CLIMB = 0.6, CLIMB_T = 1.0; // m per cycle, s per cycle

function crewPlan(ctx, st, play) {
  const u = ctx.unit, { tl, park, self } = play;
  const W = (frame, x, z) => {
    const c = Math.cos(frame.h), s = Math.sin(frame.h);
    return { x: frame.x + x * c + z * s, z: frame.z - x * s + z * c };
  };
  const out = {};
  const prep = tl.at('prep');
  const lastRel = play.lifts.reduce((m, L) => Math.max(m, L.tRelease), 0);
  // the loader's third man: down its right side, round its front to his place ahead of the two
  // vehicles (a TELAR job) or ahead of its own (loading itself); back the same way after the last round
  let spot;
  if (!self) {
    const tp = u.parts[play.job.part];
    spot = W({ x: tp.pos.x, z: tp.pos.z, h: tp.heading }, 2.25, -9.4);
  } else spot = W(park, 0.4, -8.4);
  const pts = [W(park, 2.0, -0.8), W(park, 2.15, -6.4), spot];
  const len = polyLen(pts), walk = len / WALK;
  const t0 = prep.start + 0.2, t1 = t0 + 1.0;
  // back in just before the loader-launcher moves off (or not out at all when the job is too short)
  const tBack = play.w1 - 0.3 - 1.0 - walk;
  if (tBack >= t1 + walk + 2) out.guide = { pts, back: pts.slice().reverse(), len, t0, t1, walk, tBack, heading: park.h + Math.PI / 2 };
  // one of the TELAR's crew: from behind its left, up its rear plate onto the engine deck behind the
  // noses, back down once the last round is on
  if (!self) {
    const tp = u.parts[play.job.part];
    const F = { x: tp.pos.x, z: tp.pos.z, h: tp.heading };
    const deck = 1.99; // GM-569 engine deck (deckRear 2.34 x 0.85)
    const g = [W(F, -2.4, 5.2), W(F, 0.6, 4.27)], d = [W(F, 0.6, 4.27), W(F, 0.6, 3.0)];
    const w = polyLen(g) / WALK, climb = (deck / CLIMB) * CLIMB_T, step = 1.0;
    const s0 = Math.max(0.6, prep.start - (w + climb + step));
    const s3 = s0 + w + climb + step;
    let b0 = Math.max(s3, lastRel + 1.0);
    if (b0 + step + climb + w > play.dur - 0.2) b0 = Math.max(s3, play.dur - 0.2 - (step + climb + w));
    out.telar = { g, gBack: g.slice().reverse(), d, dBack: d.slice().reverse(), y: tp.pos.y + deck, y0: tp.pos.y, h: tp.heading, w, climb, step, s0, b0 };
  }
  return out;
}

const WALK = 1.3; // m/s

// is t inside [lift[a] + da, lift[b] + db) for any lift (a round on its way, being set down...)
function during(lifts, t, a, da, b, db) {
  for (const lf of lifts) if (t >= lf[a] + da && t < lf[b] + db) return true;
  return false;
}
const polyLen = (pts) => {
  let l = 0;
  for (let i = 1; i < pts.length; i++) l += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
  return l;
};

// a figure d metres along a polyline (walking, or standing at the ends), at height y (null: the ground)
function along(c, pts, d, y = null) {
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i], l = Math.hypot(b.x - a.x, b.z - a.z);
    if (d <= l || i === pts.length - 1) return c.walk(a, b, l > 1e-6 ? d / l : 1, 'walk', y, y);
    d -= l;
  }
  return c;
}

// ---------------------------------------------------------------- the scene

export default {
  create(ctx) {
    const u = ctx.unit;
    const st = { pose: { x: 0, z: 0, h: 0 }, play: null, ret: null, hidden: [false, false, false, false, false, false, false, false], seen: [] };
    if (u.loader == null || u.loader < 0 || !u.telars?.length) return st;
    measure(ctx, st);
    const G = missileGeometry();
    st.rounds = new THREE.InstancedMesh(G.geometry, G.material, N);
    st.rounds.name = 'buk-rounds';
    st.rounds.castShadow = true;
    st.rounds.receiveShadow = true;
    st.rounds.frustumCulled = false;
    for (let i = 0; i < N; i++) st.rounds.setMatrixAt(i, HIDE);
    st.rounds.visible = false;
    ctx.group.add(st.rounds);
    st.crew = {
      op: new Crewman(ctx.group, { headgear: 'cap', skin: 1 }),
      guide: new Crewman(ctx.group, { headgear: 'cap', skin: 2 }),
      telar: new Crewman(ctx.group, { headgear: 'cap', skin: 0 }),
    };
    this.reset(ctx, st);
    return st;
  },

  start(ctx, st, job) {
    const u = ctx.unit;
    if (!st.rounds || job.from !== u.loader) return null;
    const L = ctx.rig(u.loader);
    if (!L?.pivots.crane || !u.parts[u.loader].alive || L.wreck) return null;
    // a play still driving home (or a return after a stop) hands the loader-launcher over from where it is
    if (st.play) st.play.over = true;
    st.ret = null;
    this.showRack(ctx, st);
    const play = plan(ctx, st, job);
    play.crew = crewPlan(ctx, st, play);
    // the loader-launcher's own launcher: up clear of the rack while the crane takes rounds for a
    // TELAR, down again before it pulls ahead (the sim leaves its elevation alone in the job)
    const prep = play.tl.at('prep'), crewIn = play.tl.at('crewIn');
    play.raise = play.self ? null : { t0: prep.start + 0.4, t1: prep.end, t2: play.tl.at('stow').start + 0.6, t3: crewIn.end };
    st.play = play;
    st.rounds.visible = true;
    return play;
  },

  update(ctx, st, play, t, job) {
    if (play.over || st.play !== play) return false;
    const u = ctx.unit, Li = u.loader, L = ctx.rig(Li);
    // knocked out on the way: the wreck stands where the sim has it
    if (!u.parts[Li].alive || L.wreck) {
      this.stop(ctx, st, play);
      return false;
    }
    // ---- the loader-launcher: drive, stand, pull ahead, drive home (the last drive started holds it)
    let d = null;
    for (const x of play.drives) if (t >= x.t0) d = x;
    if (d && d.drive.segs.length) d.drive.at(d.drive.sAt(Math.min(t - d.t0, d.t1 - d.t0) * d.k), _o);
    else {
      const p = d ? d.from : play.a;
      _o.x = p.x;
      _o.z = p.z;
      _o.h = p.h;
    }
    this.place(ctx, st, L, _o.x, _o.z, _o.h);
    // ---- its launcher
    const el = L.pivots.elevation, base = u.parts[Li].turret?.el ?? el.rotation.x;
    if (play.raise) {
      const r = play.raise;
      const k = smooth(t, r.t0, r.t1) * (1 - smooth(t, r.t2, r.t3));
      el.rotation.x = lerp(base, RAISE, k);
    }
    // ---- the crane
    setCrane(L, cranePose(st.crane, play.keys, t));
    L.root.updateMatrixWorld(true);
    // ---- the rounds
    this.rounds(ctx, st, play, t, job, L);
    // ---- the crew
    this.crew(ctx, st, play, t, L);
    if (t >= play.end) {
      this.home(ctx, st, L);
      this.showRack(ctx, st);
      st.play = null;
      st.rounds.visible = false;
      return false;
    }
    return true;
  },

  place(ctx, st, L, x, z, h) {
    placeOnGround(L.root, x, z, h, AXLES.front, AXLES.rear, AXLES.half, ctx.ground);
    st.pose.x = x;
    st.pose.z = z;
    st.pose.h = h;
  },

  // the loader-launcher back on its own spot exactly as UnitViews stands it
  home(ctx, st, L) {
    const p = ctx.unit.parts[ctx.unit.loader];
    if (L.wreck) {
      L.root.position.set(p.pos.x, p.pos.y - 0.25, p.pos.z);
      L.root.rotation.y = p.heading;
    } else {
      L.root.position.copy(p.pos);
      L.root.rotation.set(0, p.heading, 0);
    }
    st.pose.x = p.pos.x;
    st.pose.z = p.pos.z;
    st.pose.h = p.heading;
  },

  // where each round is: on the rack (the rig's), on the hook, on the target slot (until the sim
  // counts them), then the rig's again
  rounds(ctx, st, play, t, job, L) {
    const target = ctx.rig(play.job.part);
    const hook = L.anchors.craneHook;
    for (const lf of play.lifts) {
      // the rig's rack round is gone once the hook has it
      this.hideRack(ctx, st, L, lf.rack, t >= lf.tGrip);
      let m = null;
      if (t >= lf.tGrip && t < lf.tRelease) {
        hook.updateWorldMatrix(true, false);
        m = hook.matrixWorld;
      } else if (t >= lf.tRelease && job) {
        const a = target.anchors.missileSlots[lf.slot];
        a.updateWorldMatrix(true, false);
        m = a.matrixWorld;
      }
      st.rounds.setMatrixAt(lf.id, m ?? HIDE);
    }
    for (let i = play.lifts.length; i < N; i++) st.rounds.setMatrixAt(i, HIDE);
    st.rounds.instanceMatrix.needsUpdate = true;
  },

  // UnitViews sets a rack slot again when the sim's reserve changes: the lifted ones stay off
  hideRack(ctx, st, L, k, hide) {
    const want = hide;
    const ld = L.loaded[k] ?? false;
    if (st.hidden[k] === want && st.seen[k] === ld) return;
    st.hidden[k] = want;
    st.seen[k] = ld;
    L.setLoaded(k, want ? false : ld);
  },

  // the rack as the sim has it
  showRack(ctx, st) {
    const L = ctx.rig(ctx.unit.loader);
    if (!L) return;
    for (let k = 4; k < 8; k++) {
      if (!st.hidden[k]) continue;
      st.hidden[k] = false;
      L.setLoaded(k, L.loaded[k] ?? false);
    }
  },

  crew(ctx, st, play, t, L) {
    const { op, guide, telar } = st.crew;
    const R = play.crew, tl = play.tl;
    const prep = tl.at('prep'), crewIn = tl.at('crewIn');
    const hook = L.anchors.craneHook.getWorldPosition(_w);
    const carrying = during(play.lifts, t, 'tGrip', -1.5, 'tRelease', 0);
    // the crane operator: up out of the deck by the control box, works the crane, back down
    const up0 = prep.start + 0.1, dn1 = crewIn.start + 1.4;
    if (t < up0 || t > dn1 || t > play.w1) op.hide();
    else {
      _v.set(OP[0], OP[1], OP[2]);
      L.pivots.turret.localToWorld(_v);
      const k = Math.min(ramp(t, up0, up0 + 1.2), 1 - ramp(t, crewIn.start + 0.2, dn1));
      const face = Crewman.facing(_v.x, _v.z, hook.x, hook.z);
      if (k < 1) op.at(_v.x, _v.z, face, 'climb', (k * 1.1) / CLIMB, _v.y - 1.1 * (1 - k));
      else op.at(_v.x, _v.z, face, 'operate', t * 0.4, _v.y);
    }
    // the loader's third man: down the side, out to his place, guiding while a round is on the hook
    const g = R.guide;
    if (!g) guide.hide();
    else {
      const p0 = g.pts[0], yA = ctx.ground(p0.x, p0.z), tUp = g.tBack + g.walk;
      if (t < g.t0 || t > Math.min(tUp + 1.0, play.w1)) guide.hide();
      else if (t < g.t1) guide.at(p0.x, p0.z, g.heading, 'climb', (1 - ramp(t, g.t0, g.t1)) / CLIMB, yA + 1.0 * (1 - ramp(t, g.t0, g.t1)));
      else if (t < g.t1 + g.walk) along(guide, g.pts, (t - g.t1) * WALK);
      else if (t < g.tBack) {
        const q = g.pts[g.pts.length - 1];
        guide.at(q.x, q.z, Crewman.facing(q.x, q.z, hook.x, hook.z), carrying ? 'signal' : 'stand', t * 0.5);
      } else if (t < tUp) along(guide, g.back, (t - g.tBack) * WALK);
      else guide.at(p0.x, p0.z, g.heading, 'climb', ramp(t, tUp, tUp + 1.0) / CLIMB, yA + ramp(t, tUp, tUp + 1.0));
    }
    // the TELAR's man
    const T = R.telar;
    if (!T) {
      telar.hide();
      return;
    }
    const s1 = T.s0 + T.w, s2 = s1 + T.climb, s3 = s2 + T.step;
    const b1 = T.b0 + T.step, b2 = b1 + T.climb, b3 = b2 + T.w;
    const q1 = T.g[1], q2 = T.d[1];
    const lowering = during(play.lifts, t, 'tCarry', -1.0, 'tRelease', 0.4);
    if (t < T.s0 || t > b3 || t > play.dur) telar.hide();
    else if (t < s1) along(telar, T.g, (t - T.s0) * WALK, T.y0);
    else if (t < s2) telar.at(q1.x, q1.z, T.h, 'climb', (t - s1) / CLIMB_T, T.y0 + (T.y - T.y0) * ramp(t, s1, s2));
    else if (t < s3) telar.walk(T.d[0], q2, ramp(t, s2, s3), 'walk', T.y, T.y);
    else if (t < T.b0) telar.at(q2.x, q2.z, T.h, lowering ? 'signal' : 'stand', t * 0.5, T.y);
    else if (t < b1) telar.walk(q2, T.d[0], ramp(t, T.b0, b1), 'walk', T.y, T.y);
    else if (t < b2) telar.at(q1.x, q1.z, T.h, 'climb', (b2 - t) / CLIMB_T, T.y0 + (T.y - T.y0) * (1 - ramp(t, b1, b2)));
    else along(telar, T.gBack, (t - b2) * WALK, T.y0);
  },

  stop(ctx, st, play) {
    const L = ctx.rig(ctx.unit.loader);
    if (play) play.over = true;
    st.play = null;
    if (st.crew) for (const c of Object.values(st.crew)) c.hide();
    if (st.rounds) {
      for (let i = 0; i < N; i++) st.rounds.setMatrixAt(i, HIDE);
      st.rounds.instanceMatrix.needsUpdate = true;
      st.rounds.visible = false;
    }
    if (!L) return;
    setCrane(L, TRAVEL);
    this.showRack(ctx, st);
    const p = ctx.unit.parts[ctx.unit.loader];
    // knocked out (or the battery is out): the wreck goes back where the sim has it; otherwise it
    // drives home from where it is
    if (!p.alive || L.wreck || !ctx.unit.alive) this.home(ctx, st, L);
    else {
      const ok = clearOf(obstacles(ctx.unit, -1));
      const d = driveHome(st.pose, { x: p.pos.x, z: p.pos.z, h: p.heading }, ok);
      st.ret = d.T > 0 ? { drive: d, t: 0 } : null;
      if (!st.ret) this.home(ctx, st, L);
    }
  },

  // a return after a stop: driven here with the frame's dt
  idle(ctx, st, dt) {
    if (!st.ret || st.play) return;
    const L = ctx.rig(ctx.unit.loader);
    const p = ctx.unit.parts[ctx.unit.loader];
    if (!L || !p.alive || L.wreck) {
      st.ret = null;
      if (L) this.home(ctx, st, L);
      return;
    }
    st.ret.t += dt;
    const d = st.ret.drive;
    d.at(d.sAt(st.ret.t), _o);
    this.place(ctx, st, L, _o.x, _o.z, _o.h);
    if (st.ret.t >= d.T) {
      st.ret = null;
      this.home(ctx, st, L);
    }
  },

  reset(ctx, st) {
    const u = ctx.unit, L = ctx.rig(u.loader);
    st.play = null;
    st.ret = null;
    if (st.crew) for (const c of Object.values(st.crew)) c.hide();
    if (st.rounds) {
      for (let i = 0; i < N; i++) st.rounds.setMatrixAt(i, HIDE);
      st.rounds.instanceMatrix.needsUpdate = true;
      st.rounds.visible = false;
    }
    if (!L) return;
    for (let k = 4; k < 8; k++) st.hidden[k] = false;
    setCrane(L, TRAVEL);
    const p = u.parts[u.loader];
    st.pose.x = p.pos.x;
    st.pose.z = p.pos.z;
    st.pose.h = p.heading;
  },
};
