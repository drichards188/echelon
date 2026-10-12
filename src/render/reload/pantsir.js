import * as THREE from 'three';
import { buildVehicle } from '../../models/vehicles.js';
import { TZM } from '../../models/v/tzmpantsir.js';
import { TUBE, pantsirTube, tubeCap } from '../../models/v/pantsir.js';
import { Parts, vehicleMats } from '../../models/kit.js';
import { SYSTEMS } from '../../sim/systems.js';
import { Frame, Lane, Timeline, Crewman, placeOnGround, smooth, ramp, ease } from '../reload.js';

// Pantsir-S1: its transport-loading vehicle (TZM, tzmpantsir.js: the Serbian KamAZ-6350 with the tilt and
// the crane at the tail) swaps the spent 57E6 containers for fresh ones.
//
// RECONSTRUCTED (refs/reload/README.md section 2: no photo or source shows a Pantsir being reloaded, its
// turret pose or how the containers go in; only the TZM itself is photographed): the combat module turns
// 90 degrees to the left with the blocks level (SYSTEMS.pantsir.reloadPose), both blocks' muzzles facing
// left. The TZM drives up from behind and stops alongside on the left, 4.3 m out, its tail crane level
// with the rear block; outriggers down, the rear part of the tilt bunches forward on its bows to open the
// racks. A container sits in a block of three rows, so it cannot come out from above: the containers
// slide along their axis on the block's rails. For each row of a block to be filled, the spent pair (or a
// single) slides out of the muzzles until its middle is clear, the crane's spreader takes it there,
// draws it clear, swings it back over the racks and lays it on the ground beyond the TZM; then the
// spreader takes a fresh pair from the top layer of the racks, turns it square to the TZM, lifts it to
// the row, lines it up with the empty cells, runs it in until the clamps reach the muzzle face and lets
// go, and the pair slides home. Crew: the crane operator at the column, a loader who climbs onto the
// platform beside the racks and steadies the pairs as they are lifted, a guide from the Pantsir's cabin
// under the blocks. The crane folds, the tilt closes, the outriggers come up, the crew boards; when the
// sim counts the rounds the TZM drives on and away. The spent containers lie where they were put until
// the Pantsir's next reload.

const POSE = SYSTEMS.pantsir.reloadPose;
// the TZM's place in the Pantsir's frame (x right, z back): parallel, its crane column 4.6 m left of the
// Pantsir's centre line and 2.2 m behind the turret ring
const XT = -4.6 - TZM.crane.x, ZT = 3.4 - TZM.crane.z;
const APPROACH = 55; // metres behind its place where the TZM appears
const ARRIVE = 11, BRAKE = 0.5, LEGS = 2.6, BOARD = 2.6, RETRACT = 2.6, LEAVE = 14;
const HANG = 0.12; // the spreader's load anchor above a container's axis (it holds a container by its middle)
const MID = (TUBE.z0 + TUBE.z1) / 2; // a container's middle in its frame
const SLIDE = TUBE.z0 - TUBE.z1 + 0.12; // a container's travel out of its cell until clear of the muzzle face
const GRIP = MID + 0.6 + 0.05 - TUBE.z1; // the travel at which the spreader's inner clamp is 5 cm off the muzzle face
const PILE = { x: -9.0, z: 2.0, dz: 0.66, per: 3, up: 2 * TUBE.r + 0.03 }; // the spent pile beyond the TZM (the Pantsir's frame)
const N = 24; // stand-in containers: 12 spent (by slot) and 12 fresh (12 + slot)

// ---------------------------------------------------------------- stand-in containers

let GEO = null;
function tubeGeometry() {
  if (GEO) return GEO;
  const mats = vehicleMats('green');
  const P = new Parts(mats);
  pantsirTube(P, 0, 0, 1);
  const C = new Parts(mats);
  C.add('white', tubeCap(0, 0), { tint: 0x8e9484 });
  const out = [];
  for (const Q of [P, C]) for (const key of Q.lists.keys()) {
    const g = Q.merged(key);
    const n = g.attributes.position.count;
    // the Pantsir's paint is greyer than the shared scheme (pantsir.js greyer)
    if (key === 'camo' || key === 'paint') {
      const c = g.attributes.color;
      for (let i = 0; i < c.count; i++) c.setXYZ(i, c.getX(i) * 0.93, c.getY(i) * 0.95, c.getZ(i) * 1.1);
    }
    g.setAttribute('aH', new THREE.BufferAttribute(new Float32Array(n).fill(2.5), 1));
    g.computeBoundingSphere();
    out.push({ g, mat: mats[key], cap: Q === C });
  }
  GEO = out;
  return GEO;
}

const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

class Tubes {
  constructor(group) {
    this.meshes = tubeGeometry().map(({ g, mat, cap }) => {
      const m = new THREE.InstancedMesh(g, mat, N);
      m.castShadow = true;
      m.receiveShadow = true;
      m.frustumCulled = false;
      m.userData.cap = cap;
      for (let i = 0; i < N; i++) m.setMatrixAt(i, ZERO);
      group.add(m);
      return m;
    });
    this.show(false);
  }

  // container i at world matrix m (null hides it); cap: a fresh round's cap on its mouth
  set(i, m, cap) {
    for (const mesh of this.meshes) mesh.setMatrixAt(i, m && (cap || !mesh.userData.cap) ? m : ZERO);
  }

  clear() {
    for (let i = 0; i < N; i++) this.set(i, null, false);
  }

  commit() {
    for (const m of this.meshes) m.instanceMatrix.needsUpdate = true;
  }

  show(on) {
    for (const m of this.meshes) m.visible = on;
  }
}

// ---------------------------------------------------------------- scratch (nothing allocated per frame)

const _m = new THREE.Matrix4(), _p = new THREE.Vector3(), _q = new THREE.Vector3();
const _o = { x: 0, z: 0, heading: 0 }, _sol = { slew: 0, boom: 0, jib: 0, ext: 0, rotate: 0, hoist: 1, ok: true };
const _pose = { slew: 0, boom: 0, jib: 0, ext: 0, rotate: 0, hoist: 1 };
const JOINTS = ['slew', 'boom', 'jib', 'ext', 'rotate', 'hoist'];
const unwrap = (a, b) => a + Math.round((b - a) / (Math.PI * 2)) * Math.PI * 2;

// ---------------------------------------------------------------- props

function createSet(ctx) {
  const group = new THREE.Group();
  group.name = 'reload-pantsir';
  ctx.group.add(group);
  const tzm = buildVehicle('pantsir-tzm');
  group.add(tzm.root);
  const crew = [
    new Crewman(group, { headgear: 'cap', skin: 1 }), // crane operator
    new Crewman(group, { headgear: 'cap', skin: 2 }), // loader on the platform
    new Crewman(group, { headgear: 'helmet', vest: 'webbing', skin: 0 }), // guide from the Pantsir
  ];
  const tubes = new Tubes(group);
  return { group, tzm, crew, tubes, ground: [], groundDrawn: false, play: null };
}

function parkSet(set) {
  const { tzm } = set;
  tzm.root.visible = false;
  tzm.setCrane(tzm.craneTravel);
  tzm.setOutriggers(0);
  tzm.setTarp(0);
  tzm.pivots.doorL.rotation.y = 0;
  tzm.pivots.doorR.rotation.y = 0;
  for (let i = 0; i < 12; i++) tzm.setLoaded(i, true);
  for (const c of set.crew) c.hide();
}

// ---------------------------------------------------------------- planning

// The rig at the loading pose (as the sim lays it) while planning; restored after.
function withPose(rig, fn) {
  const tu = rig.pivots.turret, el = rig.pivots.elevation;
  const a = tu.rotation.y, e = el.rotation.x;
  tu.rotation.y = POSE.az;
  el.rotation.x = POSE.el;
  rig.root.updateMatrixWorld(true);
  const r = fn();
  tu.rotation.y = a;
  el.rotation.x = e;
  rig.root.updateMatrixWorld(true);
  return r;
}

// slot k's container axis in the elevation pivot's space (pantsir.js: slot anchors at the mouths)
const slotXY = (rig, k) => rig.anchors.missileSlots[k].position;

function placeTZM(tzm, frame, ground) {
  frame.xz(XT, ZT, _p);
  placeOnGround(tzm.root, _p.x, _p.z, frame.heading, TZM.axles[0], TZM.axles[3], TZM.track, ground);
  tzm.root.updateMatrixWorld(true);
}

/**
 * Plan a job: group the slots into a block's rows (a pair, or a single), give each a rack place and a
 * place on the pile, and lay out the crane's path (load anchor points in the TZM's space).
 */
function plan(ctx, set, job) {
  const u = ctx.unit, rig = ctx.rig(0), part = u.parts[0];
  const frame = new Frame(part.pos, part.heading);
  // slots k and k + 2 are the two columns of one row of one block (pantsir.js slot order)
  const fill = new Set(job.slots);
  const groups = [];
  for (const k of job.slots) {
    if (groups.some((g) => g.includes(k))) continue;
    const col0 = Math.floor(k / 2) % 2 === 0, mate = col0 ? k + 2 : k - 2;
    groups.push(fill.has(mate) ? (col0 ? [k, mate] : [mate, k]) : [k]);
  }
  const tzm = set.tzm;
  placeTZM(tzm, frame, ctx.ground);
  const tzmW = tzm.root.matrixWorld.clone(), inv = tzmW.clone().invert();
  // rack places: pairs (2i, 2i + 1) across a layer; the crane stands at the right: the nearest first,
  // the top layer first
  const rackPairs = [[4, 5], [2, 3], [0, 1], [10, 11], [8, 9], [6, 7]];
  const free = new Set(Array.from({ length: 12 }, (_, i) => i));
  const takeRack = (n) => {
    if (n === 2) for (const pr of rackPairs) if (free.has(pr[0]) && free.has(pr[1])) { free.delete(pr[0]); free.delete(pr[1]); return pr; }
    for (const pr of rackPairs) for (const i of [pr[1], pr[0]]) if (free.has(i)) { free.delete(i); return [i]; }
    return null;
  };
  const el = rig.pivots.elevation;
  return withPose(rig, () => {
    el.updateWorldMatrix(true, false);
    const elW = el.matrixWorld.clone();
    // the load anchor (TZM space) for a group whose containers are s out of their cells
    const anchorAt = (g, s) => {
      let x = 0, y = 0;
      for (const k of g) { x += slotXY(rig, k).x; y += slotXY(rig, k).y; }
      return new THREE.Vector3(x / g.length, y / g.length + HANG, MID - s).applyMatrix4(elW).applyMatrix4(inv);
    };
    const d = new THREE.Vector3(0, 0, -1).transformDirection(elW).transformDirection(inv);
    const yawBlock = Math.atan2(-d.x, -d.z); // the blocks' mouths, TZM space (+90 degrees: to the left)
    // a point of the Pantsir's frame in TZM space at height y over the ground
    const P = (x, z, y) => {
      frame.xz(x, z, _p);
      _p.y = ctx.ground(_p.x, _p.z) + y;
      return _p.clone().applyMatrix4(inv);
    };
    const lifts = [];
    // a group's line (the Pantsir's z) as it comes out of its block
    const pz0 = (g) => {
      frame.toLocal(anchorAt(g, SLIDE).applyMatrix4(tzmW), _p);
      return _p.z;
    };
    groups.forEach((g, gi) => {
      let mx = 0;
      for (const k of g) mx += slotXY(rig, k).x;
      mx /= g.length;
      const sx = g.map((k) => slotXY(rig, k).x - mx); // where each hangs on the spreader (anchor space x)
      const out = anchorAt(g, SLIDE), grip = anchorAt(g, GRIP);
      // spent: slides out under the spreader, drawn clear, lifted over the Pantsir's tail to the pile
      const layer = Math.floor(gi / PILE.per), pz = PILE.z + (gi % PILE.per) * PILE.dz;
      const to = P(PILE.x, pz, TUBE.r + 0.02 + layer * PILE.up + HANG);
      const high = Math.max(out.y, grip.y) + 0.35;
      lifts.push({
        kind: 'spent', g, sx, gi, grip, out, to, yaw: yawBlock,
        path: [
          ['reach', 2.4, grip.clone().setY(grip.y + 0.3), yawBlock],
          ['down', 0.9, grip, yawBlock],
          ['grip', 1.8, grip, yawBlock], // the group slides out under it meanwhile
          ['pull', 1.6, out, yawBlock],
          ['lift', 0.8, out.clone().setY(high), yawBlock],
          ['clear', 1.5, P(-6.4, pz0(g), 0).setY(high), yawBlock], // back over the TZM's racks
          ['over', 1.8, P(PILE.x, pz, 0).setY(to.y + 1.6), yawBlock],
          ['lower', 1.5, to, yawBlock],
          ['release', 0.6, to, yawBlock],
          ['up', 0.8, to.clone().setY(to.y + 1.0), yawBlock],
        ],
      });
      // fresh: from the rack, turned square on its way over the racks' front, up to the row, in
      const rack = takeRack(g.length);
      if (!rack) return;
      const a = tzm.anchors.cargo[rack[0]].position, b = tzm.anchors.cargo[rack[rack.length - 1]].position;
      const from = new THREE.Vector3((a.x + b.x) / 2, a.y + HANG, a.z + MID);
      const turnAt = new THREE.Vector3(-0.2, 3.5, 0.9); // over the racks' front, clear of the column
      lifts.push({
        kind: 'fresh', g, sx, gi, rack, from, out, grip, yaw: yawBlock,
        path: [
          ['reach', 2.2, from.clone().setY(from.y + 0.6), 0],
          ['down', 1.0, from, 0],
          ['grip', 0.7, from, 0],
          ['up', 1.1, from.clone().setY(turnAt.y), 0],
          ['turn', 2.2, turnAt, yawBlock],
          ['carry', 1.8, out.clone().setY(out.y + 0.2), yawBlock],
          ['line', 0.7, out, yawBlock],
          ['in', 1.8, grip, yawBlock],
          ['release', 0.5, grip, yawBlock],
          ['clear', 0.9, grip.clone().lerp(out, 0.4).setY(grip.y + 0.25), yawBlock],
        ],
      });
    });
    return { frame, groups, lifts, tzmW, inv, yawBlock };
  });
}

// ---------------------------------------------------------------- the crane's path

// The lifts' points as keyframes (load anchor in TZM space, the spreader's yaw), with the joints solved
// for each (the unfold and the stow blend in joint space). Nominal durations, laid out by layKeys.
function craneKeys(play, tzm) {
  const keys = [];
  play.lifts.forEach((L, li) => {
    for (const [tag, dt, p, yaw] of L.path) keys.push({ tag, dt, p, yaw, li, t: 0 });
  });
  for (let i = 1; i < keys.length; i++) keys[i].yaw = unwrap(keys[i].yaw, keys[i - 1].yaw);
  for (const k of keys) {
    tzm.solveCrane(k.p, k.yaw, _sol);
    k.joints = { ..._sol };
  }
  for (let i = 1; i < keys.length; i++) {
    keys[i].joints.slew = unwrap(keys[i].joints.slew, keys[i - 1].joints.slew);
    keys[i].joints.rotate = unwrap(keys[i].joints.rotate, keys[i - 1].joints.rotate);
  }
  return keys;
}

const UNFOLD = 2.6, STOW = 2.6;
// lay the keys between t0 and t1, after an unfold and before a stow (all in proportion)
function layKeys(keys, t0, t1) {
  if (!keys.length) {
    Object.assign(keys, { t0, tUnfold: t0, tStow: t1, t1, scale: 1 });
    return;
  }
  const total = UNFOLD + STOW + keys.reduce((s, k) => s + k.dt, 0) - keys[0].dt;
  const k = (t1 - t0) / total;
  keys.t0 = t0;
  keys.tUnfold = t0 + UNFOLD * k;
  let t = keys.tUnfold;
  keys.forEach((key, i) => {
    if (i) t += key.dt * k;
    key.t = t;
  });
  keys.tStow = t;
  keys.t1 = t1;
  keys.scale = k;
}

// _pose between two joint sets (the slew and the rotator the short way round)
function blendJoints(a, b, k) {
  for (const n of JOINTS) {
    const bv = n === 'slew' || n === 'rotate' ? unwrap(b[n], a[n]) : b[n];
    _pose[n] = a[n] + (bv - a[n]) * k;
  }
  return _pose;
}

// the crane's pose at t (into _pose)
function cranePose(tzm, keys, t) {
  const T = tzm.craneTravel;
  if (!keys.length) return Object.assign(_pose, T);
  if (t <= keys.tUnfold) return blendJoints(T, keys[0].joints, ease(ramp(t, keys.t0, keys.tUnfold)));
  if (t >= keys.tStow) return blendJoints(keys[keys.length - 1].joints, T, ease(ramp(t, keys.tStow, keys.t1)));
  let i = 0;
  while (i < keys.length - 2 && keys[i + 1].t <= t) i++;
  const a = keys[i], b = keys[i + 1];
  const k = ease((t - a.t) / (b.t - a.t));
  _p.lerpVectors(a.p, b.p, k);
  tzm.solveCrane(_p, a.yaw + (b.yaw - a.yaw) * k, _sol);
  for (const n of JOINTS) _pose[n] = _sol[n];
  _pose.slew = unwrap(_pose.slew, a.joints.slew);
  return _pose;
}

// cell k's container frame s out of the muzzle (follows the turret), and one on the spreader at sx
const inCell = (rig, k, s) => _m.makeTranslation(slotXY(rig, k).x, slotXY(rig, k).y, -s).premultiply(rig.pivots.elevation.matrixWorld);
const onHook = (hook, sx) => _m.makeTranslation(sx, -HANG, -MID).premultiply(hook.matrixWorld);

// ---------------------------------------------------------------- crew

const WALK = 1.25;

function route(pts, t0) {
  const legs = [];
  let total = 0;
  for (let i = 1; i < pts.length; i++) {
    const d = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z) / WALK;
    legs.push(d);
    total += d;
  }
  return { pts, legs, t0, back0: Infinity, total };
}

// walk a route at t (out from t0, back from back0): the place reached, or null while walking or gone
function walkRoute(c, r, t) {
  const { pts, legs } = r;
  if (t >= r.back0) {
    let tt = t - r.back0, acc = 0;
    for (let i = legs.length - 1; i >= 0; i--) {
      if (tt <= acc + legs[i]) {
        c.walk(pts[i + 1], pts[i], (tt - acc) / legs[i]);
        return null;
      }
      acc += legs[i];
    }
    c.hide();
    return null;
  }
  let tt = t - r.t0, acc = 0;
  if (tt < 0) {
    c.hide();
    return null;
  }
  for (let i = 0; i < legs.length; i++) {
    if (tt <= acc + legs[i]) {
      c.walk(pts[i], pts[i + 1], Math.max(0, tt - acc) / legs[i]);
      return null;
    }
    acc += legs[i];
  }
  return pts[pts.length - 1];
}

const CLIMB = 3.4; // s up (or down) the TZM's side

// The crew's routes (world x, z), made once per play with the TZM at its place.
function crewRoutes(play, set) {
  const { tl, frame } = play;
  const tzm = set.tzm;
  const T = (x, z) => new THREE.Vector3(x, 0, z).applyMatrix4(play.tzmW);
  const W = (x, z) => frame.xz(x, z, new THREE.Vector3());
  const out = tl.at('legs').start + 0.5, board = tl.at('board').start, retract = tl.at('retract').start;
  const cab = TZM.cab.zf + 0.95;
  // the operator: out of the right door, down the right side to the column
  const op = route([T(1.75, cab), T(1.95, 0.5), T(1.75, TZM.crane.z + 0.25)], out);
  // the loader: out of the left door, round the front, down the right side to the racks, up the side
  const ld = route([T(-1.75, cab), T(-1.4, TZM.cab.bumper - 0.8), T(1.4, TZM.cab.bumper - 0.8), T(1.85, -1.0), T(1.62, 2.55)], out + 0.4);
  // the guide: from the Pantsir's cabin (its door on the left) out between the blocks' lines
  const gd = route([W(-1.7, -0.75), W(-2.3, 0.2), W(-2.45, 1.25)], out + 0.2);
  const list = [op, ld, gd];
  for (const r of list) r.back0 = Math.min(board, retract - r.total - 0.3);
  ld.climb0 = ld.t0 + ld.total;
  ld.climb1 = ld.climb0 + CLIMB;
  ld.back0 = Math.min(board, retract - ld.total - CLIMB - 0.3);
  ld.down0 = ld.back0 - CLIMB;
  ld.foot = T(1.62, 2.55);
  ld.top = T(1.05, 2.55);
  void tzm;
  return list;
}

// ---------------------------------------------------------------- the scene

export default {
  create(ctx) {
    const set = createSet(ctx);
    parkSet(set);
    return { set };
  },

  start(ctx, state, job) {
    const set = state.set;
    const rig = ctx.rig(0);
    if (!rig?.setContainer) return null;
    if (set.play) this.stop(ctx, state, set.play);
    const play = plan(ctx, set, job);
    play.set = set;
    play.job = job;
    const dur = job.dur;
    const tl = new Timeline().add('arrive', ARRIVE, true).add('brake', BRAKE, true).add('legs', LEGS, true)
      .add('crane', 40).add('board', BOARD, true).add('retract', RETRACT, true).fit(0, dur);
    play.tl = tl;
    play.keys = craneKeys(play, set.tzm);
    const c = tl.at('crane');
    layKeys(play.keys, c.start, c.end);
    // each lift's grip and release times, and its containers' slides
    for (let i = 0; i < play.keys.length; i++) {
      const k = play.keys[i], prev = play.keys[i - 1], L = play.lifts[k.li];
      if (k.tag === 'grip') {
        if (L.kind === 'spent') {
          L.tGrip = k.t;
          L.tSlide0 = Math.min(prev.t, k.t - 0.6);
        } else L.tGrip = prev.t + (k.t - prev.t) * 0.4;
      }
      if (k.tag === 'release') {
        L.tRelease = prev.t + (k.t - prev.t) * 0.5;
        if (L.kind === 'fresh') L.tSlide1 = L.tRelease + 1.6 * Math.max(0.6, Math.min(1, play.keys.scale));
      }
    }
    // the TZM: up from behind on its lane, away ahead after the job
    play.laneIn = new Lane(play.frame, [[XT, ZT + APPROACH], [XT, ZT]]);
    play.laneOut = new Lane(play.frame, [[XT, ZT], [XT, ZT - 80]]);
    play.end = dur + LEAVE;
    play.routes = crewRoutes(play, set);
    play.hook = set.tzm.anchors.craneLoad;
    // the spent containers' places on the pile (world), made now
    for (const L of play.lifts) if (L.kind === 'spent') {
      L.groundM = L.sx.map((sx) => {
        const yaw = L.yaw;
        return new THREE.Matrix4().makeRotationY(yaw).setPosition(L.to).premultiply(play.tzmW)
          .multiply(new THREE.Matrix4().makeTranslation(sx, -HANG, -MID));
      });
    }
    // the cells being refilled: the rig's containers there give way to stand-ins until the end
    play.slots = job.slots.slice();
    for (const k of play.slots) rig.setContainer(k, false);
    set.play = play;
    set.ground = [];
    set.groundDrawn = false;
    set.tubes.show(true);
    for (let i = 0; i < 12; i++) set.tzm.setLoaded(i, true);
    set.tzm.root.visible = true;
    return play;
  },

  update(ctx, state, play, t) {
    const set = state.set;
    if (set.play !== play) return false;
    const rig = ctx.rig(0), tzm = set.tzm, tl = play.tl, dur = play.job.dur;
    // ---- the TZM: up its lane, stands, away after the job
    let s, lane;
    if (t < dur) {
      lane = play.laneIn;
      s = lane.length * ease(ramp(t, 0, ARRIVE));
    } else {
      lane = play.laneOut;
      s = lane.length * ease(ramp(t, dur + 0.8, dur + LEAVE));
    }
    lane.at(s, _o);
    placeOnGround(tzm.root, _o.x, _o.z, _o.heading, TZM.axles[0], TZM.axles[3], TZM.track, ctx.ground);
    tzm.setWheels(t < dur ? s : play.laneIn.length + s, 0);
    // ---- outriggers, tilt, doors
    tzm.setOutriggers(tl.k('legs', t) * (1 - tl.k('retract', t)));
    tzm.setTarp(smooth(t, tl.at('legs').start + 0.3, tl.at('legs').end + 1.4) * (1 - smooth(t, tl.at('board').start - 0.6, tl.at('retract').end)));
    const out0 = tl.at('legs').start, back = tl.at('board').start;
    const door = Math.max(smooth(t, out0, out0 + 0.7) * (1 - smooth(t, out0 + 2.2, out0 + 2.9)), smooth(t, back, back + 0.7) * (1 - smooth(t, back + 2.0, back + 2.6)));
    tzm.pivots.doorL.rotation.y = -1.1 * door;
    tzm.pivots.doorR.rotation.y = 1.1 * door;
    // ---- crane
    tzm.setCrane(cranePose(tzm, play.keys, t));
    tzm.root.updateMatrixWorld(true);
    // ---- containers, crew
    this.containers(set, play, rig, t);
    this.crew(ctx, set, play, t);
    if (t >= dur && !play.handed) this.handBack(ctx, set, play);
    if (t >= play.end) {
      parkSet(set);
      set.play = null;
      return false;
    }
    return true;
  },

  // every stand-in at t: spent ones in their cells, sliding out, on the spreader, on the pile; fresh
  // ones on the spreader (the TZM's racks show them until then), sliding in, in their cells
  containers(set, play, rig, t) {
    const tubes = set.tubes, el = rig.pivots.elevation;
    el.updateWorldMatrix(true, false);
    play.hook.updateWorldMatrix(true, false);
    tubes.clear();
    const hook = play.hook;
    for (const L of play.lifts) {
      for (let j = 0; j < L.g.length; j++) {
        const k = L.g[j];
        if (L.kind === 'spent') {
          if (t < L.tGrip) tubes.set(k, inCell(rig, k, GRIP * smooth(t, L.tSlide0, L.tGrip)), false);
          else if (t < L.tRelease) tubes.set(k, onHook(hook, L.sx[j]), false);
          else tubes.set(k, L.groundM[j], false);
          continue;
        }
        set.tzm.setLoaded(L.rack[Math.min(j, L.rack.length - 1)], t < L.tGrip);
        if (play.handed || t < L.tGrip) continue;
        if (t < L.tRelease) tubes.set(12 + k, onHook(hook, L.sx[j]), true);
        else tubes.set(12 + k, inCell(rig, k, GRIP * (1 - smooth(t, L.tRelease, L.tSlide1))), true);
      }
    }
    tubes.commit();
  },

  // the crew: out of the cabs to their places, working, back in (routes made in start)
  crew(ctx, set, play, t) {
    const { routes, frame } = play;
    const op = set.crew[0], ld = set.crew[1], gd = set.crew[2];
    if (t < routes[0].t0 - 0.5 || t > play.job.dur) {
      for (const c of set.crew) c.hide();
      return;
    }
    const hookP = play.hook.getWorldPosition(_q);
    let L = null;
    for (const x of play.lifts) if (t > x.tGrip - 3.2 && t < x.tRelease + 1.0) L = x;
    const h = set.tzm.root.rotation.y;
    // the operator at the column, working the levers, watching the load
    let p = walkRoute(op, routes[0], t);
    if (p) op.at(p.x, p.z, Crewman.facing(p.x, p.z, hookP.x, hookP.z), 'operate', t * 0.3);
    // the loader: round to the right side, up onto the platform beside the racks; steadies each fresh
    // pair as it comes up
    const r = routes[1];
    if (t >= r.climb0 && t < r.climb1) this.climb(ctx, ld, r, ramp(t, r.climb0, r.climb1), h);
    else if (t >= r.down0 && t < r.back0) this.climb(ctx, ld, r, 1 - ramp(t, r.down0, r.back0), h);
    else if (t >= r.climb1 && t < r.down0) {
      const y = set.tzm.root.position.y + TZM.deck;
      const fresh = L && L.kind === 'fresh' && t < L.tGrip + 1.6;
      ld.at(r.top.x, r.top.z, fresh ? Crewman.facing(r.top.x, r.top.z, hookP.x, hookP.z) : h + Math.PI / 2,
        fresh ? (t > L.tGrip - 1.0 ? 'crouch' : 'signal') : 'stand', t * 0.5, y);
    } else {
      p = walkRoute(ld, r, t);
      if (p) ld.at(p.x, p.z, h + Math.PI / 2, 'stand', 0);
    }
    // the guide signals while a group moves at the blocks
    p = walkRoute(gd, routes[2], t);
    if (p) gd.at(p.x, p.z, L ? Crewman.facing(p.x, p.z, hookP.x, hookP.z) : frame.heading + Math.PI / 2, L ? 'signal' : 'stand', t * 0.5);
  },

  // up (k 0..1) the TZM's right side at the racks, facing it; the last part steps in over the side board
  climb(ctx, c, r, k, h) {
    const y0 = ctx.ground(r.foot.x, r.foot.z), y1 = y0 + TZM.deck;
    const kk = ramp(k, 0, 0.82);
    if (k < 0.82) c.at(r.foot.x, r.foot.z, h + Math.PI / 2, 'climb', kk * (TZM.deck / 0.6), y0 + (y1 - y0) * kk);
    else {
      const s = ramp(k, 0.82, 1);
      _p.lerpVectors(r.foot, r.top, s);
      c.at(_p.x, _p.z, h + Math.PI / 2, 'walk', s * 0.5, y1);
    }
  },

  // the sim has counted the rounds: the rig shows its own containers again (and its caps by the sim's slots)
  handBack(ctx, set, play) {
    play.handed = true;
    const rig = ctx.rig(0);
    for (const k of play.slots) rig.setContainer(k, true);
    set.ground = [];
    for (const L of play.lifts) if (L.kind === 'spent') for (const m of L.groundM) set.ground.push(m);
  },

  stop(ctx, state, play) {
    const set = play?.set ?? state.set;
    const rig = ctx.rig(0);
    if (rig?.setContainer) for (let k = 0; k < 12; k++) rig.setContainer(k, true);
    set.play = null;
    set.ground = [];
    parkSet(set);
    set.tubes.show(false);
  },

  // between plays: the spent containers lying on the ground
  idle(ctx, state) {
    const set = state.set;
    if (set.play || set.groundDrawn) return;
    set.groundDrawn = true;
    set.tubes.show(set.ground.length > 0);
    set.tubes.clear();
    for (let i = 0; i < set.ground.length; i++) set.tubes.set(i, set.ground[i], false);
    set.tubes.commit();
  },

  reset(ctx, state) {
    this.stop(ctx, state, null);
  },
};
