import * as THREE from 'three';
import { buildVehicle } from '../../models/vehicles.js';
import { F77 } from '../../models/v/t2f77m.js';
import { CONT, tunguskaContainer, containerCover, tunguskaMats } from '../../models/v/tunguska.js';
import { Parts, box, rbox, xTube } from '../../models/kit.js';
import { SYSTEMS } from '../../sim/systems.js';
import { Frame, Lane, Timeline, Crewman, placeOnGround, smooth, ramp, ease } from '../reload.js';

// 2S6M Tunguska: the 2F77M transloader (t2f77m.js, KamAZ-43101 with eight 9M311 containers in two stacks
// of four, racks of 30 mm ammunition boxes and the slewing trolley-beam crane at the rear of the bed)
// changes the spent containers on the launchers and its crew carries ammunition boxes to the guns.
//
// RECONSTRUCTED (refs/tunguska/README.md section 7: no loading photo exists; the vehicle, its load and
// crane are from photos tung_2f77m_11..13, the sequence and the poses are inferred): the 2F77M pulls up
// alongside on the Tunguska's left, its crane column level with the turret ring, 4.9 m out. The turret
// turns its front to the 2F77M with the guns raised out of the way (SYSTEMS.tunguska.reloadPose; the
// research suggests the rear, but the search antenna stands at the rear and the containers leave by
// their mouths). A container sits in clamp frames under the launcher's brackets and next to others, so
// it cannot come out upward: the containers slide along the launcher's rails. On each side the spent
// ones (one, the lower pair, the lower pair with the inner upper, or all four: those the sim refills)
// slide out of the mouths toward the 2F77M until the grab takes them by the middle, are drawn clear, and
// laid on the ground in front of the turret between the vehicles; then fresh containers come from the
// top of the stacks (a column of two one above the other, or one), are turned square to the launcher,
// run in rear end first to the grab's limit and slide home. The crane's operator works it with a
// pendant from the ground; the 2F77M's second man carries 30 mm ammunition boxes from the tail racks to
// the Tunguska's side and hands them up to a crewman on its engine deck, who puts them into the gun bay
// (the data plate: 32 boxes and 8 missiles); another of the Tunguska's crew guides the crane from the
// ground. The crew goes back in, the job ends (the rounds count) and the 2F77M drives on and away. The
// spent containers lie where they were put until the next reload.

const POSE = SYSTEMS.tunguska.reloadPose;
// the 2F77M's place in the Tunguska's frame (x right, z back): parallel, its crane column 4.9 m left of
// the centre line and level with the turret ring (z -0.85)
const XT = -4.9 - F77.crane.x, ZT = -0.85 - F77.crane.z;
const APPROACH = 40, ARRIVE = 9, BRAKE = 0.4, OUT = 1.0, BOARD = 3.0, LEAVE = 12;
const MIDZ = (CONT.z0 + CONT.z1) / 2; // a container's middle in its frame (launcher space)
const GRIP = 1.7; // slide out of the launcher at which the grab can take a container clear of the mouths
const LINE = 2.6; // slide at which a container is wholly out of the launcher's front clamp
const PITCH = 0.22; // rows on the grab (the launcher's)
const PILE = [[-2.35, -2.3], [-2.82, -2.3]]; // the spent units' places on the ground (the Tunguska's frame)
const N = 16; // stand-in containers: 8 spent (by slot) and 8 fresh (8 + slot)

// ---------------------------------------------------------------- stand-in containers and boxes

let GEO = null;
function geometry() {
  if (GEO) return GEO;
  const mats = tunguskaMats();
  const P = new Parts(mats), C = new Parts(mats), B = new Parts(mats);
  tunguskaContainer(P, 0, 0);
  C.add('canister', containerCover(0, 0), { tint: 0x7a7c70 });
  // a 30 mm ammunition box: steel, olive, the lid with its ribs and two clasps, a handle at each end
  B.add('camo', rbox(0.56, 0.24, 0.3, 0.015, 0, 0.12, 0), { tint: 0x9aa58a });
  B.add('dark', box(0.57, 0.02, 0.31, 0, 0.215, 0));
  for (const x of [-0.17, 0.17]) B.add('dark', box(0.05, 0.05, 0.02, x, 0.18, 0.155));
  for (const s of [-1, 1]) B.add('steel', xTube(s * 0.28, s * 0.3, 0.018, 0.018, 6, 0.15, 0));
  const out = [];
  for (const Q of [P, C, B]) for (const key of Q.lists.keys()) {
    const g = Q.merged(key);
    // the Tunguska's paint is a cool green-grey (tunguska.js greyer)
    if (key === 'camo' || key === 'paint') {
      const c = g.attributes.color;
      for (let i = 0; i < c.count; i++) c.setXYZ(i, c.getX(i) * 0.74, c.getY(i) * 0.85, c.getZ(i) * 1.55);
    }
    g.setAttribute('aH', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count).fill(2.5), 1));
    g.computeBoundingSphere();
    out.push({ g, mat: mats[key], part: Q === P ? 'body' : Q === C ? 'cover' : 'box' });
  }
  GEO = out;
  return GEO;
}

const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

class Props {
  constructor(group) {
    this.meshes = geometry().map(({ g, mat, part }) => {
      const m = new THREE.InstancedMesh(g, mat, part === 'box' ? 2 : N);
      m.castShadow = true;
      m.receiveShadow = true;
      m.frustumCulled = false;
      m.userData.part = part;
      for (let i = 0; i < m.count; i++) m.setMatrixAt(i, ZERO);
      group.add(m);
      return m;
    });
    this.show(false);
  }

  // container i at world matrix m (null hides it); cover: a fresh round's front cover
  set(i, m, cover) {
    for (const mesh of this.meshes) {
      const p = mesh.userData.part;
      if (p === 'body' || (p === 'cover' && cover)) mesh.setMatrixAt(i, m ?? ZERO);
      else if (p === 'cover') mesh.setMatrixAt(i, ZERO);
    }
  }

  box(i, m) {
    for (const mesh of this.meshes) if (mesh.userData.part === 'box') mesh.setMatrixAt(i, m ?? ZERO);
  }

  clear() {
    for (const mesh of this.meshes) for (let i = 0; i < mesh.count; i++) mesh.setMatrixAt(i, ZERO);
  }

  commit() {
    for (const m of this.meshes) m.instanceMatrix.needsUpdate = true;
  }

  show(on) {
    for (const m of this.meshes) m.visible = on;
  }
}

// ---------------------------------------------------------------- scratch (nothing allocated per frame)

const _m = new THREE.Matrix4(), _m2 = new THREE.Matrix4(), _p = new THREE.Vector3(), _q = new THREE.Vector3();
const _o = { x: 0, z: 0, heading: 0 }, _sol = {};
const _pose = { slew: 0, reach: 0, lift: 0, cable: 0, rotate: 0 };
const unwrap = (a, b) => a + Math.round((b - a) / (Math.PI * 2)) * Math.PI * 2;

// ---------------------------------------------------------------- props

function createSet(ctx) {
  const group = new THREE.Group();
  group.name = 'reload-tunguska';
  ctx.group.add(group);
  const f77 = buildVehicle('2f77m');
  group.add(f77.root);
  // the crane operator's control box on its cable, in his hands while he works
  const P = new Parts(tunguskaMats());
  P.add('dark', box(0.2, 0.13, 0.3, 0, 0.05, 0));
  P.add('red', box(0.04, 0.02, 0.04, 0.05, 0.125, -0.08));
  const pendant = new THREE.Group();
  P.build(pendant, { dirt: 0 });
  const crew = [
    new Crewman(group, { headgear: 'cap', skin: 1 }), // crane operator (2F77M)
    new Crewman(group, { headgear: 'cap', skin: 2 }), // loader (2F77M)
    new Crewman(group, { headgear: 'helmet', skin: 0 }), // on the Tunguska's deck
    new Crewman(group, { headgear: 'helmet', skin: 3 }), // guide (Tunguska)
  ];
  crew[0].fig.anchors.carry.add(pendant);
  const props = new Props(group);
  return { group, f77, crew, props, ground: [], groundDrawn: false, play: null };
}

function parkSet(set) {
  const { f77 } = set;
  f77.root.visible = false;
  f77.setCrane(f77.craneTravel);
  f77.pivots.doorL.rotation.y = 0;
  f77.pivots.doorR.rotation.y = 0;
  for (let i = 0; i < 8; i++) f77.setLoaded(i, true);
  for (const c of set.crew) c.hide();
}

// ---------------------------------------------------------------- planning

// The rig at the loading pose (as the sim lays it) while planning; restored after.
function withPose(rig, fn) {
  const { turret, elevation, launcher } = rig.pivots;
  const a = turret.rotation.y, e = elevation.rotation.x, l = launcher.rotation.x;
  turret.rotation.y = POSE.az;
  elevation.rotation.x = POSE.el;
  launcher.rotation.x = 0;
  rig.root.updateMatrixWorld(true);
  const r = fn();
  turret.rotation.y = a;
  elevation.rotation.x = e;
  launcher.rotation.x = l;
  rig.root.updateMatrixWorld(true);
  return r;
}

// slot k's container axis in launcher space (tunguska.js: slot anchors at the mouths)
const slotXY = (rig, k) => rig.anchors.missileSlots[k].position;

function placeF77(f77, frame, ground) {
  frame.xz(XT, ZT, _p);
  placeOnGround(f77.root, _p.x, _p.z, frame.heading, F77.axles[0], F77.axles[2], F77.track, ground);
  f77.root.updateMatrixWorld(true);
}

// the units of one side: what goes out (one load) and what comes in (columns of two or singles)
function sideUnits(rig, slots) {
  if (!slots.length) return null;
  const xy = slots.map((k) => [k, slotXY(rig, k).x, slotXY(rig, k).y]);
  const ymin = Math.min(...xy.map((a) => a[2]));
  const low = xy.filter((a) => a[2] === ymin);
  const xm = low.reduce((s, a) => s + a[1], 0) / low.length;
  const out = { slots, lay: xy.map(([k, x, y]) => ({ k, x: x - xm, y: y - ymin + CONT.r })), xm, ymin };
  // in: by column, the lower first in each (a column of two goes in together)
  const cols = new Map();
  for (const [k, x, y] of xy) {
    const key = x.toFixed(3);
    if (!cols.has(key)) cols.set(key, []);
    cols.get(key).push({ k, x, y });
  }
  const ins = [...cols.values()].map((c) => c.sort((a, b) => a.y - b.y));
  return { out, ins };
}

/** Plan a job: the units, their crane keys (joint space) and the stand-ins' places. */
function plan(ctx, set, job) {
  const u = ctx.unit, rig = ctx.rig(0), part = u.parts[0];
  const frame = new Frame(part.pos, part.heading);
  const f77 = set.f77;
  placeF77(f77, frame, ctx.ground);
  const fW = f77.root.matrixWorld.clone(), inv = fW.clone().invert();
  const la = rig.pivots.launcher;
  return withPose(rig, () => {
    la.updateWorldMatrix(true, false);
    const laW = la.matrixWorld.clone();
    // the launchers' mouth heading in the 2F77M's space
    const d = new THREE.Vector3(0, 0, -1).transformDirection(laW).transformDirection(inv);
    const yawL = Math.atan2(-d.x, -d.z);
    // a point of launcher space in the 2F77M's space
    const L = (x, y, z) => new THREE.Vector3(x, y, z).applyMatrix4(laW).applyMatrix4(inv);
    // the load anchor (the claws, under the unit's lowest row, at its middle) with the unit s out
    const anchorAt = (xm, ymin, s) => L(xm, ymin - CONT.r, MIDZ - s);
    // sides: left launcher (even slots), right (odd)
    const sides = [0, 1].map((s) => sideUnits(rig, job.slots.filter((k) => k % 2 === s)));
    // stacks on the 2F77M: left 0..3, right 4..7 (bottom to top); the right one (nearer the Tunguska)
    // first, from the top
    const stack = [[], []];
    for (let i = 0; i < 4; i++) { stack[0].push(i); stack[1].push(4 + i); }
    const take = (n) => {
      for (const si of [1, 0]) if (stack[si].length >= n) return stack[si].splice(stack[si].length - n, n);
      const one = stack[1].length ? stack[1] : stack[0];
      return one.splice(one.length - 1, 1);
    };
    const lifts = [];
    let pile = 0;
    // the side nearer the 2F77M's front first (the left launcher points forward of the column)
    for (const si of [0, 1]) {
      const S = sides[si];
      if (!S) continue;
      const o = S.out;
      const grip = anchorAt(o.xm, o.ymin, GRIP), pull = anchorAt(o.xm, o.ymin, LINE);
      frame.xz(PILE[pile][0], PILE[pile][1], _p);
      const gy = ctx.ground(_p.x, _p.z);
      const pileP = new THREE.Vector3(_p.x, gy + 0.03, _p.z).applyMatrix4(inv);
      // the spent ones go down along the Tunguska (the 2F77M's z), turned the short way
      lifts.push({ kind: 'out', side: si, lay: o.lay, grip, pull, pile: pileP, yaw: yawL, yawPile: nearest(yawL, [0, Math.PI]), pileI: pile++ });
      for (const col of S.ins) {
        const src = take(col.length).sort((p, q) => (p % 4) - (q % 4));
        if (!src.length) continue;
        // the claws under the lowest of them
        const a = f77.anchors.cargo[src[0]].position;
        const from = new THREE.Vector3(a.x, a.y - CONT.r, a.z + MIDZ);
        const xm = slotXY(rig, col[0].k).x, ymin = col[0].y;
        lifts.push({
          kind: 'in', side: si, slots: col.map((c) => c.k), src,
          lay: col.map((c, j) => ({ k: c.k, x: 0, y: CONT.r + j * PITCH })), from,
          line: anchorAt(xm, ymin, LINE), rel: anchorAt(xm, ymin, GRIP), yaw: yawL,
        });
      }
    }
    return { frame, lifts, fW, inv, yawL, laInv: laW.clone().invert() };
  });
}

// the angle of the set nearest a (mod 2 pi)
function nearest(a, set) {
  let best = set[0], bd = Infinity;
  for (const b of set) {
    const d = Math.abs(unwrap(b, a) - a);
    if (d < bd) { bd = d; best = unwrap(b, a); }
  }
  return best;
}

// ---------------------------------------------------------------- the crane's path

// near the Tunguska (the beam over its turret front: the tracking antenna and the gun mounts) the
// column keeps the beam up a little
const nearT = (slew) => Math.abs(unwrap(slew, -Math.PI / 2) + Math.PI / 2) < 0.5;

// a key: the joints for a load point (2F77M space) and the load's heading
function key(f77, tag, dt, p, yaw, li) {
  f77.solveCrane(p, yaw, _sol, 0);
  if (nearT(_sol.slew)) f77.solveCrane(p, yaw, _sol, 0.14);
  return { tag, dt, li, t: 0, j: { slew: _sol.slew, reach: _sol.reach, lift: _sol.lift, cable: _sol.cable, yaw }, ok: _sol.ok };
}

// the time a move takes: by the slew and the trolley's travel
const moveT = (a, b) => 0.5 + Math.abs(unwrap(b.slew, a.slew) - a.slew) / 1.1 + Math.abs(b.reach - a.reach) / 1.6 + Math.abs(b.cable - a.cable) / 1.4;

function craneKeys(play, f77) {
  const keys = [];
  const up = (p, dy) => new THREE.Vector3(p.x, p.y + dy, p.z);
  let prev = { ...f77.craneTravel, yaw: f77.craneTravel.slew + f77.craneTravel.rotate };
  const push = (k) => {
    // the short way round, but never forward over the cab and the front rack (slew 0): the long way
    // then, behind the column over the tail racks
    k.j.slew = unwrap(k.j.slew, prev.slew);
    const lo = Math.min(prev.slew, k.j.slew), hi = Math.max(prev.slew, k.j.slew), z0 = Math.ceil(lo / (Math.PI * 2)) * Math.PI * 2;
    if (keys.length && z0 > lo + 0.05 && z0 < hi - 0.05) k.j.slew += k.j.slew > prev.slew ? -Math.PI * 2 : Math.PI * 2;
    k.j.yaw = unwrap(k.j.yaw, prev.yaw);
    if (k.dt === 'move') k.dt = moveT(prev, k.j);
    keys.push(k);
    prev = k.j;
  };
  // over a stack the grab comes down and goes up clear of the cradles' posts (2F77M space y)
  const POSTS = F77.stack.y[3] + 0.2;
  play.lifts.forEach((L, li) => {
    if (L.kind === 'out') {
      push(key(f77, 'reach', 'move', up(L.grip, 0.3), L.yaw, li));
      push(key(f77, 'down', 0.6, L.grip, L.yaw, li));
      push(key(f77, 'grip', 0.4, L.grip, L.yaw, li));
      push(key(f77, 'pull', 1.0, L.pull, L.yaw, li));
      push(key(f77, 'lift', 0.6, up(L.pull, 0.2), L.yaw, li));
      push(key(f77, 'carry', 'move', up(L.pile, 2.6), L.yawPile, li));
      push(key(f77, 'lower', 1.2, L.pile, L.yawPile, li));
      push(key(f77, 'release', 0.3, L.pile, L.yawPile, li));
      push(key(f77, 'up', 0.6, up(L.pile, 0.9), L.yawPile, li));
    } else {
      push(key(f77, 'reach', 'move', up(L.from, Math.max(0.4, POSTS + 0.1 - L.from.y)), 0, li));
      push(key(f77, 'down', 0.6, L.from, 0, li));
      push(key(f77, 'grip', 0.3, L.from, 0, li));
      push(key(f77, 'up', 0.7, up(L.from, Math.max(0.3, POSTS - L.from.y)), 0, li));
      push(key(f77, 'carry', 'move', up(L.line, 0.12), L.yaw, li));
      push(key(f77, 'line', 0.4, L.line, L.yaw, li));
      push(key(f77, 'in', 0.8, L.rel, L.yaw, li));
      push(key(f77, 'release', 0.3, L.rel, L.yaw, li));
      push(key(f77, 'clear', 0.5, up(L.rel, 0.3), L.yaw, li));
    }
  });
  return keys;
}

const UNFOLD = 1.6, STOW = 2.2;
function layKeys(keys, t0, t1) {
  if (!keys.length) return Object.assign(keys, { t0, tUnfold: t0, tStow: t1, t1, scale: 1 });
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
  return keys;
}

// _pose between two joint sets (a key's j, or the travel pose: its load heading is slew + rotate)
function blendJoints(T, a, b, k) {
  const as = a.slew, ay = a.yaw ?? T.slew + T.rotate;
  const bs = unwrap(b.slew, as), by = unwrap(b.yaw ?? T.slew + T.rotate, ay);
  _pose.slew = as + (bs - as) * k;
  _pose.reach = a.reach + (b.reach - a.reach) * k;
  _pose.lift = a.lift + (b.lift - a.lift) * k;
  _pose.cable = a.cable + (b.cable - a.cable) * k;
  _pose.rotate = ay + (by - ay) * k - _pose.slew;
  return _pose;
}

// the crane's joints at t (into _pose)
function cranePose(f77, keys, t) {
  const T = f77.craneTravel;
  if (!keys.length) return Object.assign(_pose, T);
  if (t <= keys.tUnfold) return blendJoints(T, T, keys[0].j, ease(ramp(t, keys.t0, keys.tUnfold)));
  if (t >= keys.tStow) return blendJoints(T, keys[keys.length - 1].j, T, ease(ramp(t, keys.tStow, keys.t1)));
  let i = 0;
  while (i < keys.length - 2 && keys[i + 1].t <= t) i++;
  const a = keys[i], b = keys[i + 1];
  return blendJoints(T, a.j, b.j, ease((t - a.t) / (b.t - a.t)));
}

// cell k's container frame s out of the mouth (follows the turret), and one on the grab at c ({ x, y })
const inCell = (rig, k, s) => _m.makeTranslation(slotXY(rig, k).x, slotXY(rig, k).y, -s).premultiply(rig.pivots.launcher.matrixWorld);
const onHook = (hook, c) => _m.makeTranslation(c.x, c.y, -MIDZ).premultiply(hook.matrixWorld);

// ---------------------------------------------------------------- crew

const WALK = 1.25, CARRY = 0.85;

function route(pts, t0, speed = WALK) {
  const legs = [];
  let total = 0;
  for (let i = 1; i < pts.length; i++) {
    const d = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z) / speed;
    legs.push(d);
    total += d;
  }
  return { pts, legs, t0, back0: Infinity, total };
}

// walk a route at t (out from t0, back from back0): the place reached, or null while walking or gone
function walkRoute(c, r, t, gait = 'walk') {
  const { pts, legs } = r;
  if (t >= r.back0) {
    let tt = t - r.back0, acc = 0;
    for (let i = legs.length - 1; i >= 0; i--) {
      if (tt <= acc + legs[i]) {
        c.walk(pts[i + 1], pts[i], (tt - acc) / legs[i], gait);
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
      c.walk(pts[i], pts[i + 1], Math.max(0, tt - acc) / legs[i], gait);
      return null;
    }
    acc += legs[i];
  }
  return pts[pts.length - 1];
}

const HATCH = [-0.45, 1.3], DECK = 1.96, RISE = 2.0; // the Tunguska's rear deck hatch; deck height; out of it
const TRIP = { take: 0.9, turn: 0.4, hand: 1.0 }; // the loader's box trip: at the rack, turning, handing up

// The crew's routes and the box trips (world x, z), made once per play with the vehicles at their places.
function crewPlan(play, set, ctx) {
  const { tl, frame } = play;
  const F = (x, z) => new THREE.Vector3(x, 0, z).applyMatrix4(play.fW);
  const W = (x, z) => frame.xz(x, z, new THREE.Vector3());
  const out = tl.at('crew').start + 0.4, back = tl.at('board').start;
  const doorR = F(F77.cab.hw + 0.5, F77.cab.zf + 0.9);
  const R = {};
  // operator: out of the right door down the gap to his place, pendant in hand
  R.op = route([doorR, W(-3.35, -3.6), W(-3.35, -1.15)], out);
  // loader: out of the right door, down the gap to behind the 2F77M, at its tail racks
  R.ld = route([doorR, W(-3.45, -3.0), W(-3.6, 0.6), F(0.4, F77.rear + 0.55)], out + 0.7);
  // the Tunguska's two: up out of the rear deck hatch; the guide down the left side to the gap
  R.hatch = W(...HATCH);
  R.deck = W(-1.05, 1.45); // where the deck man takes the boxes
  R.bay = W(0.55, 1.05); // where he puts them in (the gun bay on the turret's flank, behind the plate)
  R.gdTop = W(-1.3, 2.4);
  R.gdFoot = W(-1.95, 2.4);
  R.gd = route([R.gdFoot, W(-3.1, 1.6), W(-3.25, 0.9)], out + RISE + 0.6 + 3.2);
  R.dm0 = out + 0.3; // the deck man rises out of the hatch
  // back: the 2F77M's men in time to climb in before the job ends; the Tunguska's back down the hatch
  R.op.back0 = back - R.op.total + 0.6;
  R.ld.back0 = back - R.ld.total + 0.9;
  R.gd.back0 = back - R.gd.total - 3.2 - RISE - 0.4;
  R.dmBack = back + 0.2;
  // box trips from the rack to the deck man, as many as fit before the loader heads back
  const rack = F(0.4, F77.rear + 0.55), hand = W(-1.95, 1.45);
  const walk = Math.hypot(hand.x - rack.x, hand.z - rack.z);
  const trip = TRIP.take + TRIP.turn + walk / CARRY + TRIP.hand + walk / WALK;
  R.trips = [];
  for (let t0 = R.ld.t0 + R.ld.total + 0.3; t0 + trip < R.ld.back0 - 0.2; t0 += trip + 0.3) R.trips.push(t0);
  Object.assign(R, { rack, hand, walk, trip });
  void ctx;
  return R;
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
    if (!rig?.setContainer || !rig.pivots.launcher) return null;
    if (set.play) this.stop(ctx, state, set.play);
    const play = plan(ctx, set, job);
    play.set = set;
    play.job = job;
    const dur = job.dur;
    const tl = new Timeline().add('arrive', ARRIVE, true).add('brake', BRAKE, true).add('crew', OUT, true)
      .add('crane', 30).add('board', BOARD, true).fit(0, dur);
    play.tl = tl;
    play.keys = layKeys(craneKeys(play, set.f77), tl.at('crane').start, tl.at('crane').end);
    // each lift's grip and release; the slides
    for (let i = 0; i < play.keys.length; i++) {
      const k = play.keys[i], prev = play.keys[i - 1], L = play.lifts[k.li];
      if (k.tag === 'reach') L.tReach = prev ? prev.t : play.keys.tUnfold - 0.5;
      if (k.tag === 'down') L.tDown = k.t;
      if (k.tag === 'grip') L.tGrip = L.kind === 'out' ? prev.t : prev.t + (k.t - prev.t) * 0.5;
      if (k.tag === 'release') {
        L.tRelease = prev.t + (k.t - prev.t) * 0.5;
        if (L.kind === 'in') L.tHome = L.tRelease + 1.3 * Math.max(0.6, Math.min(1, play.keys.scale));
      }
    }
    // the spent units' places on the ground (world), from the crane at its release pose
    for (const L of play.lifts) if (L.kind === 'out') {
      const k = play.keys.find((x) => x.li === play.lifts.indexOf(L) && x.tag === 'release');
      cranePose(set.f77, play.keys, k.t);
      set.f77.setCrane(_pose);
      placeF77(set.f77, play.frame, ctx.ground);
      set.f77.anchors.craneLoad.updateWorldMatrix(true, false);
      const a = set.f77.anchors.craneLoad.matrixWorld;
      L.groundM = L.lay.map((c) => new THREE.Matrix4().makeTranslation(c.x, c.y, -MIDZ).premultiply(a));
    }
    set.f77.setCrane(set.f77.craneTravel);
    play.laneIn = new Lane(play.frame, [[XT, ZT + APPROACH], [XT, ZT]]);
    play.laneOut = new Lane(play.frame, [[XT, ZT], [XT, ZT - 70]]);
    play.end = dur + LEAVE;
    play.crew = crewPlan(play, set, ctx);
    play.hook = set.f77.anchors.craneLoad;
    play.slots = job.slots.slice();
    for (const k of play.slots) rig.setContainer(k, false);
    set.play = play;
    set.ground = [];
    set.groundDrawn = false;
    set.props.show(true);
    for (let i = 0; i < 8; i++) set.f77.setLoaded(i, true);
    set.f77.root.visible = true;
    return play;
  },

  update(ctx, state, play, t) {
    const set = state.set;
    if (set.play !== play) return false;
    const rig = ctx.rig(0), f77 = set.f77, tl = play.tl, dur = play.job.dur;
    // ---- the 2F77M: up its lane, stands, on and away after the job
    let s, lane;
    if (t < dur) {
      lane = play.laneIn;
      s = lane.length * ease(ramp(t, 0, ARRIVE));
    } else {
      lane = play.laneOut;
      s = lane.length * ease(ramp(t, dur + 0.6, dur + LEAVE));
    }
    lane.at(s, _o);
    placeOnGround(f77.root, _o.x, _o.z, _o.heading, F77.axles[0], F77.axles[2], F77.track, ctx.ground);
    f77.setWheels(t < dur ? s : play.laneIn.length + s, 0);
    // ---- doors: open while the two get out and back in
    const o0 = tl.at('crew').start, b0 = tl.at('board').start + BOARD - 1.6;
    const door = Math.max(smooth(t, o0, o0 + 0.6) * (1 - smooth(t, o0 + 1.8, o0 + 2.4)), smooth(t, b0 - 0.4, b0 + 0.2) * (1 - smooth(t, b0 + 1.0, b0 + 1.6)));
    f77.pivots.doorR.rotation.y = 1.1 * door;
    // ---- crane
    f77.setCrane(cranePose(f77, play.keys, t));
    f77.root.updateMatrixWorld(true);
    // ---- containers, boxes, crew
    set.props.clear();
    this.containers(set, play, rig, t);
    this.crew(ctx, set, play, t);
    set.props.commit();
    if (t >= dur && !play.handed) this.handBack(ctx, set, play);
    if (t >= play.end) {
      parkSet(set);
      set.play = null;
      return false;
    }
    return true;
  },

  // the stand-ins at t: spent ones in their cells, sliding out, on the grab, on the ground; fresh ones on
  // the grab (the 2F77M's stacks show them until then), sliding home, in their cells
  containers(set, play, rig, t) {
    const props = set.props, la = rig.pivots.launcher;
    la.updateWorldMatrix(true, false);
    play.hook.updateWorldMatrix(true, false);
    const hook = play.hook;
    for (const L of play.lifts) {
      if (L.kind === 'out') {
        for (let j = 0; j < L.lay.length; j++) {
          const c = L.lay[j];
          if (t < L.tGrip) props.set(c.k, inCell(rig, c.k, GRIP * smooth(t, L.tReach, L.tDown)), false);
          else if (t < L.tRelease) props.set(c.k, onHook(hook, c), false);
          else props.set(c.k, L.groundM[j], false);
        }
        continue;
      }
      for (let j = 0; j < L.lay.length; j++) {
        const c = L.lay[j];
        if (j < L.src.length) set.f77.setLoaded(L.src[j], t < L.tGrip);
        if (play.handed || t < L.tGrip) continue;
        if (t < L.tRelease) props.set(8 + c.k, onHook(hook, c), true);
        else props.set(8 + c.k, inCell(rig, c.k, GRIP * (1 - smooth(t, L.tRelease, L.tHome))), true);
      }
    }
  },

  // the crew: out to their places, working, back in (plan made in start)
  crew(ctx, set, play, t) {
    const C = play.crew, op = set.crew[0], ld = set.crew[1], dm = set.crew[2], gd = set.crew[3];
    const hookP = play.hook.getWorldPosition(_q);
    const h = play.frame.heading;
    let L = null;
    for (const x of play.lifts) if (t > (x.tReach ?? 0) && t < x.tRelease + 0.8) L = x;
    // operator: at his place facing the load, the pendant in his hands
    let p = walkRoute(op, C.op, t);
    if (p) op.at(p.x, p.z, Crewman.facing(p.x, p.z, hookP.x, hookP.z), 'operate', t * 0.3);
    // guide: out of the hatch (with the deck man), down the side, to the gap; signals while a load moves
    const footY = ctx.ground(C.gdFoot.x, C.gdFoot.z);
    const deckY = ctx.unit.parts[0].pos.y + DECK;
    const gUp = C.dm0 + RISE + 0.3; // on the deck
    if (t < C.dm0 + 0.5 || t > C.dmBack + RISE + 0.5) gd.hide();
    else if (t < gUp) gd.at(C.hatch.x, C.hatch.z, h + Math.PI / 2, 'climb', ramp(t, C.dm0 + 0.5, gUp) * 1.2, deckY - 1.2 + 1.2 * ramp(t, C.dm0 + 0.5, gUp));
    else if (t < gUp + 0.6) gd.walk(C.hatch, C.gdTop, ramp(t, gUp, gUp + 0.6), 'walk', deckY, deckY);
    else if (t < C.gd.t0) {
      // down the side, facing the hull
      const k = ramp(t, gUp + 0.6, C.gd.t0);
      gd.at(C.gdFoot.x, C.gdFoot.z, h - Math.PI / 2, 'climb', (1 - k) * 3.2, footY + (deckY - footY) * (1 - k));
    } else if (t >= C.gd.back0 + C.gd.total) {
      // back up the side, along the deck and down the hatch
      const t1 = C.gd.back0 + C.gd.total, t2 = t1 + 3.2, t3 = t2 + 0.6;
      if (t < t2) gd.at(C.gdFoot.x, C.gdFoot.z, h - Math.PI / 2, 'climb', ramp(t, t1, t2) * 3.2, footY + (deckY - footY) * ramp(t, t1, t2));
      else if (t < t3) gd.walk(C.gdTop, C.hatch, ramp(t, t2, t3), 'walk', deckY, deckY);
      else if (t < t3 + RISE) gd.at(C.hatch.x, C.hatch.z, h + Math.PI / 2, 'climb', (1 - ramp(t, t3, t3 + RISE)) * 1.2, deckY - 1.2 * ramp(t, t3, t3 + RISE));
      else gd.hide();
    } else {
      p = walkRoute(gd, C.gd, t);
      if (p) gd.at(p.x, p.z, L ? Crewman.facing(p.x, p.z, hookP.x, hookP.z) : h + Math.PI / 2, L ? 'signal' : 'stand', t * 0.5);
    }
    this.boxes(ctx, set, play, t, ld, dm, deckY);
  },

  // the loader's trips with the ammunition boxes and the deck man who takes them in
  boxes(ctx, set, play, t, ld, dm, deckY) {
    const C = play.crew, h = play.frame.heading, props = set.props;
    // the deck man: out of the hatch, at his place, back down at the end
    const up0 = C.dm0, up1 = C.dm0 + RISE;
    let dmBusy = false;
    if (t < up0 || t > C.dmBack + RISE) dm.hide();
    else if (t < up1) dm.at(C.hatch.x, C.hatch.z, h + Math.PI / 2, 'climb', ramp(t, up0, up1) * 1.2, deckY - 1.2 + 1.2 * ramp(t, up0, up1));
    else if (t > C.dmBack) dm.at(C.hatch.x, C.hatch.z, h + Math.PI / 2, 'climb', (1 - ramp(t, C.dmBack, C.dmBack + RISE)) * 1.2, deckY - 1.2 * ramp(t, C.dmBack, C.dmBack + RISE));
    else dmBusy = true;
    // the loader: his walk out and back; between them the trips
    const r = C.ld, walkHand = C.walk / CARRY, walkBack = C.walk / WALK;
    let trip = -1;
    for (let i = 0; i < C.trips.length; i++) if (t >= C.trips[i] && t < C.trips[i] + C.trip) trip = i;
    const atRack = t >= r.t0 + r.total && t < r.back0;
    const rackFace = h; // facing the rack: the 2F77M's front
    const towardT = Crewman.facing(C.rack.x, C.rack.z, C.hand.x, C.hand.z);
    let handT = -1; // time into the hand-up, or -1
    if (trip < 0) {
      const p = walkRoute(ld, r, t);
      if (p || atRack) ld.at(C.rack.x, C.rack.z, rackFace, 'stand', t * 0.3);
    } else {
      const tt = t - C.trips[trip], bi = trip % 2;
      const a = TRIP.take, b = a + TRIP.turn, c = b + walkHand, d = c + TRIP.hand;
      if (tt < a) {
        ld.at(C.rack.x, C.rack.z, rackFace, 'reachUp', tt * 0.5);
        if (tt > a * 0.55) this.boxOn(props, bi, ld);
      } else if (tt < b) {
        const k = ease((tt - a) / TRIP.turn);
        ld.at(C.rack.x, C.rack.z, rackFace + (unwrap(towardT, rackFace) - rackFace) * k, 'carry', 0);
        this.boxOn(props, bi, ld);
      } else if (tt < c) {
        ld.walk(C.rack, C.hand, (tt - b) / walkHand, 'carryWalk');
        this.boxOn(props, bi, ld);
      } else if (tt < d) {
        ld.at(C.hand.x, C.hand.z, h - Math.PI / 2, 'reachUp', (tt - c) * 0.4);
        handT = tt - c;
        if (handT < TRIP.hand * 0.55) this.boxOn(props, bi, ld);
      } else ld.walk(C.hand, C.rack, (tt - d) / walkBack);
    }
    if (!dmBusy) return;
    // the deck man: takes the box from the loader, carries it to the bay, puts it in, back to his place
    let done = false;
    for (let i = 0; i < C.trips.length && !done; i++) {
      const tH = C.trips[i] + TRIP.take + TRIP.turn + walkHand; // the hand-up begins
      const tt = t - tH, bi = i % 2;
      const toBay = Math.hypot(C.bay.x - C.deck.x, C.bay.z - C.deck.z) / CARRY;
      if (tt < -1.2 || tt > TRIP.hand + toBay + 1.2 + toBay * 0.75) continue;
      done = true;
      if (tt < TRIP.hand) {
        dm.at(C.deck.x, C.deck.z, h + Math.PI / 2, tt < 0 ? 'stand' : 'crouch', tt * 0.4, deckY);
        if (tt >= TRIP.hand * 0.55) this.boxOn(props, bi, dm);
      } else if (tt < TRIP.hand + toBay) {
        dm.walk(C.deck, C.bay, (tt - TRIP.hand) / toBay, 'carryWalk', deckY, deckY);
        this.boxOn(props, bi, dm);
      } else if (tt < TRIP.hand + toBay + 1.2) {
        const k = tt - TRIP.hand - toBay;
        dm.at(C.bay.x, C.bay.z, h, k < 0.25 ? 'carry' : 'crouch', k * 0.5, deckY);
        if (k < 0.8) this.boxOn(props, bi, dm);
      } else dm.walk(C.bay, C.deck, (tt - TRIP.hand - toBay - 1.2) / (toBay * 0.75), 'walk', deckY, deckY);
    }
    if (!done) dm.at(C.deck.x, C.deck.z, h + Math.PI / 2, 'stand', t * 0.3, deckY);
  },

  // box i in a man's hands (on his carry anchor; the box's length along the anchor's x)
  boxOn(props, i, c) {
    const a = c.fig.anchors.carry;
    a.updateWorldMatrix(true, false);
    props.box(i, _m2.copy(a.matrixWorld));
  },

  // the sim has counted the rounds: the rig shows its own containers again (its covers by the sim's slots)
  handBack(ctx, set, play) {
    play.handed = true;
    const rig = ctx.rig(0);
    for (const k of play.slots) rig.setContainer(k, true);
    set.ground = [];
    for (const L of play.lifts) if (L.kind === 'out') for (const m of L.groundM) set.ground.push(m);
  },

  stop(ctx, state, play) {
    const set = play?.set ?? state.set;
    const rig = ctx.rig(0);
    if (rig?.setContainer) for (let k = 0; k < 8; k++) rig.setContainer(k, true);
    set.play = null;
    set.ground = [];
    set.groundDrawn = false;
    parkSet(set);
    set.props.show(false);
  },

  // between plays: the spent containers lying on the ground
  idle(ctx, state) {
    const set = state.set;
    if (set.play || set.groundDrawn) return;
    set.groundDrawn = true;
    set.props.show(set.ground.length > 0);
    set.props.clear();
    for (let i = 0; i < set.ground.length; i++) set.props.set(i, set.ground[i], false);
    set.props.commit();
  },

  reset(ctx, state) {
    this.stop(ctx, state, null);
  },
};
