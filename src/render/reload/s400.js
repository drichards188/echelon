import * as THREE from 'three';
import { buildVehicle } from '../../models/vehicles.js';
import { T22 } from '../../models/v/t22t6.js';
import { BAZ, TRAILER, CAN, canisterParts, coverParts, packParts, cellCoverParts, canisterMats } from '../../models/v/t5t58.js';
import { Parts, vehicleMats, box } from '../../models/kit.js';
import { Frame, Lane, Timeline, Crewman, placeOnGround, smooth, ramp, ease } from '../reload.js';

// S-400: a 22T6 transporter-loader reloads one TEL from a 5T58-2 transporter (refs/reload/README.md
// section 1, photos s400_22t6_ashuluk_*, s400_airdefexercise2017_*). The TEL lowers its stack (the sim:
// reloadPose.erect); the 22T6 and the tractor with its semitrailer drive up from behind on the TEL's
// left, the 22T6 alongside the TEL (rears level, as in airdefexercise2017_12) and the transporter
// beyond it; the outriggers go down; the crew gets out: the crane operator with his control box behind
// the 22T6, a guide at the TEL's tail, one at the transporter, one on the TEL's far side; the crane
// unfolds and lifts the spent canisters off the TEL a pair at a time over the TEL onto the ground on
// its far side (upper pair first), then takes the fresh ones from the transporter (upper layer first)
// and sets them on the TEL (lower pair first), covers on; it folds, the crew climbs back in, the
// outriggers come up, the job ends (the rounds count) and the trucks back out the way they came while
// the stack rises. The spent canisters stay on the ground until the TEL's next reload (or out of view).
//
// One set of props per TEL (vehicles, crew, eight canisters), hidden while idle. The TEL's own canister
// meshes are swapped for the scene's (identical) ones while the scene runs, so each canister can move;
// t5t58.js builds the same canister as tel.js. Layout in the TEL's frame (x right, z back, metres).

const X22 = -4.6; // 22T6 centre line
const Z22 = 0.25 + 0.4 - T22.rear; // its origin: the rear face 0.4 m behind the TEL's tail
const X58 = X22 - T22.body.hw - 2.3 - 1.45; // the transporter's centre line
const Z58 = -3.6 - (BAZ.kingpin + TRAILER.base + CAN.LIP / 2); // tractor origin: the cargo's middle at z -3.6
const APPROACH = 70; // m: where the trucks come from (behind, on their lanes)
const GROUND = { x: 3.3, z: -3.6, gap: 1.24, y: [0.65, 1.73] }; // the spent canisters' stack on the far side
const STATIONS = {
  operator: [X22 - 0.8, Z22 + T22.rear + 1.85],
  tel: [-1.15, 1.45],
  telNear: [-0.7, 0.85],
  trailer: [X58 + 0.3, Z58 + BAZ.kingpin + TRAILER.rear + 0.9],
  ground: [GROUND.x + 0.2, GROUND.z - CAN.LIP / 2 - 1.3],
};
const ARRIVE = 14, BRAKE = 0.8, LEGS = 3, LEAVE = 17;
const SLEW = 0.8; // rad/s, nominal

// ---------------------------------------------------------------- canisters

// Every set has eight canisters drawn as instanced parts: body (with rings and clamp bands), the dark
// mouth, the 48N6 dome, the 9M96 bulkhead and its four red cell covers. A canister's frame is its mouth
// (lip at 0, body along +Z), as the TEL's anchors.mouths and the transporter's anchors.cargo.
const N = 8;
let GEO = null;
function canisterGeometry() {
  if (GEO) return GEO;
  const mats = { ...vehicleMats('green'), ...canisterMats() };
  const take = (fill) => {
    const P = new Parts(mats);
    fill(P);
    const out = {};
    for (const key of P.lists.keys()) {
      const g = P.merged(key);
      const n = g.attributes.position.count;
      g.setAttribute('aH', new THREE.BufferAttribute(new Float32Array(n).fill(2.5), 1));
      g.computeBoundingSphere();
      out[key] = g;
    }
    return out;
  };
  GEO = {
    body: take((P) => canisterParts(P)),
    dome: take((P) => coverParts(P)).cover,
    pack: take((P) => packParts(P)),
    cells: [0, 1, 2, 3].map((k) => take((P) => cellCoverParts(P, k)).coverRed),
  };
  return GEO;
}

const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

class Canisters {
  constructor(group) {
    const G = canisterGeometry(), M = canisterMats();
    const mk = (geo, mat, n = N) => {
      const m = new THREE.InstancedMesh(geo, mat, n);
      m.castShadow = true;
      m.receiveShadow = true;
      m.frustumCulled = false;
      for (let i = 0; i < n; i++) m.setMatrixAt(i, ZERO);
      group.add(m);
      return m;
    };
    this.body = mk(G.body.canister, M.canister);
    this.mouth = mk(G.body.hole, M.hole);
    this.dome = mk(G.dome, M.cover);
    this.bulk = mk(G.pack.cover, M.cover);
    this.bores = mk(G.pack.hole, M.hole);
    this.cells = G.cells.map((g) => mk(g, M.coverRed));
    this.all = [this.body, this.mouth, this.dome, this.bulk, this.bores, ...this.cells];
  }

  // canister i at world matrix m (null hides it); pack: a 9M96 pack; covers: its covered cells (a 48N6
  // canister: > 0 is full)
  set(i, m, pack, covers) {
    const z = m ?? ZERO;
    this.body.setMatrixAt(i, z);
    this.mouth.setMatrixAt(i, z);
    this.dome.setMatrixAt(i, m && !pack && covers > 0 ? m : ZERO);
    this.bulk.setMatrixAt(i, m && pack ? m : ZERO);
    this.bores.setMatrixAt(i, m && pack ? m : ZERO);
    for (let k = 0; k < 4; k++) this.cells[k].setMatrixAt(i, m && pack && k < covers ? m : ZERO);
  }

  commit() {
    for (const m of this.all) m.instanceMatrix.needsUpdate = true;
  }

  show(on) {
    for (const m of this.all) m.visible = on;
  }
}

// ---------------------------------------------------------------- the TEL's own canisters

// The TEL rig draws its four canisters as one merged mesh on the erector (tel.js): while a scene runs
// they are hidden and the scene's stand in for them (the same geometry and paint).
function telOwn(rig) {
  const er = rig.pivots.erector;
  const meshes = er.children.filter((o) => o.isMesh && (o.name === 'canister' || o.name === 'hole'));
  const covers = er.children.filter((o) => o.isGroup && /^cover\d$/.test(o.name));
  const packs = er.children.find((o) => o.name === 'packs');
  return { er, meshes, covers, packs };
}

function hideTel(own) {
  for (const m of own.meshes) m.visible = false;
  for (const c of own.covers) c.visible = false;
  if (own.packs) own.packs.visible = false;
}

function showTel(own, rig, loaded, rounds) {
  for (const m of own.meshes) m.visible = true;
  // the covers as the sim has them now: setLoaded recomputes domes and packs, then each pack's cells
  // from the vehicle's rounds (as main's syncCovers sets them)
  const per = rig.perSlot ?? 1;
  for (let k = 0; k < 4; k++) {
    rig.setLoaded(k, loaded[k] ?? true);
    rig.setCovers?.(k, Math.max(0, Math.min(per, rounds - per * k)));
  }
}

// ---------------------------------------------------------------- props

const _m = new THREE.Matrix4(), _m2 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _p2 = new THREE.Vector3();
const _s = new THREE.Vector3(1, 1, 1), _e = new THREE.Euler(), _inv = new THREE.Matrix4(), _o = { x: 0, z: 0, heading: 0 };
const UP = new THREE.Vector3(0, 1, 0);

function createSet(ctx, part) {
  const group = new THREE.Group();
  group.name = 'reload-tel-' + part;
  ctx.group.add(group);
  const t22 = buildVehicle('22t6');
  const t58 = buildVehicle('5t58');
  group.add(t22.root, t58.root);
  t22.root.visible = t58.root.visible = false;
  // the crane operator's control box on its cable, in his hands while he works
  const pendant = new THREE.Mesh(box(0.22, 0.14, 0.32), vehicleMats('green').dark);
  pendant.castShadow = true;
  const crew = [
    new Crewman(group, { headgear: 'hardhat', vest: 'hiviz', skin: 1 }), // crane operator
    new Crewman(group, { headgear: 'hardhat', vest: 'hiviz', skin: 2 }), // guide at the TEL
    new Crewman(group, { headgear: 'cap' }), // at the transporter
    new Crewman(group, { headgear: 'cap', skin: 3 }), // on the far side, where the spent canisters go
  ];
  crew[0].fig.anchors.carry.add(pendant);
  pendant.position.set(0, 0.05, 0);
  const cans = new Canisters(group);
  cans.show(false);
  return { part, group, t22, t58, crew, cans, own: null, ground: [], groundT: -1, play: null, active: false, standing: false };
}

// the trucks back at their start, hidden, crane and outriggers stowed
function parkSet(set) {
  set.t22.root.visible = set.t58.root.visible = false;
  set.t22.setCrane(set.t22.craneTravel);
  set.t22.setOutriggers(0);
  for (const r of [set.t22, set.t58]) {
    r.pivots.doorL.rotation.y = 0;
    r.pivots.doorR.rotation.y = 0;
  }
  for (const c of set.crew) c.hide();
}

// ---------------------------------------------------------------- planning

// world centre and mouth heading of a pair place: the TEL's rows (stowed), the transporter's layers,
// the ground stack's layers; for each slot of it the canister's mouth matrix
function telRow(set, rig, row, frame) {
  const own = set.own;
  const out = [];
  for (const k of [row * 2, row * 2 + 1]) {
    const a = rig.anchors.mouths[k];
    // the erector lies flat (0) while the crane works: mouth in the TEL's model space
    _p.copy(own.er.position).add(a.position);
    out.push({ k, x: _p.x, y: _p.y, z: _p.z });
  }
  return out;
}

// pose of the trucks at the work places (rigs placed there for the planning)
function placeTrucks(set, frame, ground) {
  frame.xz(X22, Z22, _p);
  placeOnGround(set.t22.root, _p.x, _p.z, frame.heading, T22.axles[0], T22.axles[3], T22.track, ground);
  frame.xz(X58, Z58, _p);
  placeOnGround(set.t58.root, _p.x, _p.z, frame.heading, BAZ.axles[0], BAZ.axles[2], BAZ.track, ground);
  set.t58.pivots.trailer.rotation.y = 0;
  set.t22.root.updateMatrixWorld(true);
  set.t58.root.updateMatrixWorld(true);
}

// A canister's mouth matrix in the world for a place: { at: 'tel', k } | { at: 'cargo', k } | { at: 'ground', layer, side }
function placeMatrix(set, rig, frame, ground, pl, out) {
  if (pl.at === 'tel') {
    const a = rig.anchors.mouths[pl.k];
    a.updateWorldMatrix(true, false);
    return out.copy(a.matrixWorld);
  }
  if (pl.at === 'cargo') {
    const a = set.t58.anchors.cargo[pl.k];
    a.updateWorldMatrix(true, false);
    return out.copy(a.matrixWorld);
  }
  // the ground stack: along the TEL, mouths forward, on sleepers
  const x = GROUND.x + pl.side * GROUND.gap / 2, z = GROUND.z - CAN.LIP / 2;
  frame.xz(x, z, _p2);
  _p2.y = ground(_p2.x, _p2.z + 0) + GROUND.y[pl.layer];
  _q.setFromAxisAngle(UP, frame.heading);
  return out.compose(_p2, _q, _s);
}

// the middle of a canister from its mouth matrix
const centreOf = (m, out) => out.set(0, 0, CAN.LIP / 2).applyMatrix4(m);

/**
 * Plan a job: which canisters go where, and when. Returns the play: lifts [{ objs: [{ id, side }],
 * src, dst }] and the crane keyframes, the timeline, the canisters' first places.
 */
function plan(ctx, set, job) {
  const u = ctx.unit, part = set.part, rig = ctx.rig(part), p = u.parts[part];
  const frame = new Frame(p.pos, p.heading);
  const pack = (rig.perSlot ?? 1) > 1;
  const per = pack ? 4 : 1;
  // what is on the TEL now: a body in each slot (unless an earlier reload took it away), how full
  const covers = (k) => Math.max(0, Math.min(per, p.rounds - k * per));
  const cans = [];
  for (let k = 0; k < 4; k++) cans.push({ place: set.present[k] ? { at: 'tel', k } : null, covers: covers(k) });
  for (let k = 0; k < 4; k++) cans.push({ place: { at: 'cargo', k }, covers: per });
  const fill = new Set(job.slots);
  const rows = [0, 1].filter((r) => fill.has(r * 2) || fill.has(r * 2 + 1));
  // spent canisters off: the upper row if anything is to go in (it blocks the lower), then the lower
  const lifts = [];
  let layer = 0;
  // side: where a canister hangs on the spreader (-1 left, +1 right of the load's mouth direction);
  // a TEL slot's own side, a transporter's place turned end for end
  // (a canister still full stays where it is; one in the upper row comes off anyway when the lower row
  // below it is to be filled: it is in the way)
  const removeRow = (r, all) => {
    const objs = [];
    for (const k of [r * 2, r * 2 + 1]) if (set.present[k] && (all || fill.has(k))) objs.push({ id: k, slot: k, side: k % 2 ? 1 : -1 });
    if (!objs.length) return;
    lifts.push({ objs, src: { at: 'tel', row: r }, dst: { at: 'ground', layer: layer++ } });
  };
  if (rows.length) {
    removeRow(1, rows.includes(0));
    if (rows.includes(0)) removeRow(0, false);
  }
  // fresh ones on: the lower row first; from the transporter's upper layer first
  const cargo = [2, 3, 0, 1];
  for (const r of rows) {
    const want = [r * 2, r * 2 + 1].filter((k) => fill.has(k));
    // a pair goes over as it sits on the transporter (turned end for end: its right comes to the TEL's
    // left); a single is taken from the side that lands on its slot
    const objs = [];
    for (const k of want) {
      // the transporter's left canister (even place) hangs on the spreader's right once turned round
      const side = k % 2 ? 1 : -1;
      let c = cargo.findIndex((g) => g >= 0 && (g % 2 === 0 ? 1 : -1) === side);
      if (c < 0) c = cargo.findIndex((g) => g >= 0);
      if (c < 0) break;
      const g = cargo[c];
      cargo[c] = -1;
      const s = g % 2 === 0 ? 1 : -1;
      objs.push({ id: 4 + g, slot: s < 0 ? r * 2 : r * 2 + 1, side: s });
    }
    if (!objs.length) continue;
    lifts.push({ objs, src: { at: 'cargo', layer: Math.floor((objs[0].id - 4) / 2) }, dst: { at: 'tel', row: r } });
  }
  return { frame, pack, per, cans, lifts };
}

// ---------------------------------------------------------------- the crane track

// Keyframes of raw crane joints along the time line (solved for load positions at plan time).
function craneTrack(set, play, ctx) {
  const { frame } = play;
  const rig = ctx.rig(set.part);
  const t22 = set.t22;
  placeTrucks(set, frame, ctx.ground);
  _inv.copy(t22.root.matrixWorld).invert();
  // the crane works over the stack laid flat: plan with the erector at 0 (UnitViews sets it every frame)
  const er = rig.pivots.erector, er0 = er.rotation.x;
  er.rotation.x = 0;
  rig.root.updateMatrixWorld(true);
  const sol = {};
  // a load place to the 22T6's model space: the middle of the pair and its mouth heading
  const where = (w) => {
    let mats;
    if (w.at === 'tel') mats = [w.row * 2, w.row * 2 + 1].map((k) => placeMatrix(set, rig, frame, ctx.ground, { at: 'tel', k }, new THREE.Matrix4()));
    else if (w.at === 'cargo') mats = [w.layer * 2, w.layer * 2 + 1].map((k) => placeMatrix(set, rig, frame, ctx.ground, { at: 'cargo', k }, new THREE.Matrix4()));
    else mats = [-1, 1].map((s) => placeMatrix(set, rig, frame, ctx.ground, { at: 'ground', layer: w.layer, side: s }, new THREE.Matrix4()));
    const c = centreOf(mats[0], new THREE.Vector3()).add(centreOf(mats[1], new THREE.Vector3())).multiplyScalar(0.5);
    const local = c.clone().applyMatrix4(_inv);
    // mouth direction (-Z of the mouth frame) in the 22T6's space
    const d = new THREE.Vector3(0, 0, -1).transformDirection(mats[0]).transformDirection(_inv);
    const yaw = Math.atan2(-d.x, -d.z);
    const half = Math.abs(new THREE.Vector3().setFromMatrixPosition(mats[0]).sub(new THREE.Vector3().setFromMatrixPosition(mats[1])).length()) / 2;
    return { p: local, yaw, mats, half };
  };
  // a key: the joints for a load place, and the load's heading (yaw, 22T6 space) it was solved for
  const solve = (p, yaw, post) => ({ ...t22.solveCrane(p, yaw, sol, post), yaw });
  const raw = (pose) => ({ ...pose, yaw: pose.slew + pose.rotate });
  const keys = [];
  const at = (dt, pose, tag = null) => keys.push({ dt, pose, tag });
  let prev = null;
  const hoverY = (y) => Math.max(y + 1.25, 4.75);
  const slewOf = (p) => Math.atan2(-p.x, -(p.z - T22.turntable.z));
  const move = (from, to) => 1.2 + Math.abs(unwrap(slewOf(to.p), slewOf(from.p)) - slewOf(from.p)) / SLEW;
  // unfold: travel, the column and boom up over the rear (still facing back), then out to the first hover
  const first = play.lifts.length ? where(play.lifts[0].src) : null;
  at(0, raw(t22.craneTravel), 'unfold0');
  at(2.2, raw({ ...t22.craneTravel, column: 0.15, boom: 0.25, rotate: Math.PI / 2 }));
  for (const L of play.lifts) {
    const S = where(L.src), D = where(L.dst);
    L.S = S;
    L.D = D;
    const sh = S.p.clone(), dh = D.p.clone();
    sh.y = hoverY(S.p.y);
    dh.y = hoverY(D.p.y);
    const hover = solve(sh, S.yaw, T22.post.min);
    at(prev ? move(prev, S) : 3.2, hover, 'reach');
    at(1.7, solve(S.p, S.yaw, T22.post.min + 0.25), 'down');
    at(0.9, solve(S.p, S.yaw, T22.post.min + 0.25), 'grip');
    at(1.3, solve(sh, S.yaw, T22.post.min), 'up');
    // carry: an arc around the crane at the carry height, turning the load to its new heading
    const carry = move(S, D) - 1.2 + 1.6;
    // the middle of the swing: half way round the crane at the mean reach, a little higher
    const a0 = slewOf(sh), a1 = unwrap(slewOf(dh), a0), am = (a0 + a1) / 2;
    const rm = (Math.hypot(sh.x, sh.z - T22.turntable.z) + Math.hypot(dh.x, dh.z - T22.turntable.z)) / 2;
    const mid = new THREE.Vector3(-Math.sin(am) * rm, Math.max(sh.y, dh.y) + 0.25, T22.turntable.z - Math.cos(am) * rm);
    // the load turns the same way as the crane slews (the short way round for the rotator)
    const dSlew = unwrap(slewOf(dh), slewOf(sh)) - slewOf(sh);
    let dYaw = unwrap(D.yaw, S.yaw) - S.yaw;
    for (const c of [dYaw - Math.PI * 2, dYaw + Math.PI * 2]) if (Math.abs(c - dSlew) < Math.abs(dYaw - dSlew)) dYaw = c;
    D.turn = S.yaw + dYaw;
    at(carry * 0.5, solve(mid, S.yaw + dYaw / 2, T22.post.min), 'carry');
    at(carry * 0.5, solve(dh, D.yaw, T22.post.min), 'over');
    at(2.1, solve(D.p, D.yaw, T22.post.min + 0.25), 'lower');
    at(0.8, solve(D.p, D.yaw, T22.post.min + 0.25), 'release');
    at(1.2, solve(dh, D.yaw, T22.post.min), 'clear');
    prev = D;
  }
  // stow: up and round to face the rear, fold
  at(prev ? 1.2 + Math.abs(unwrap(Math.PI, slewOf(prev.p)) - slewOf(prev.p)) / SLEW : 1, raw({ ...t22.craneTravel, column: 0.15, boom: 0.25, rotate: Math.PI / 2 }), 'stow0');
  at(2.4, raw(t22.craneTravel), 'stowed');
  // unwrap the slews so the crane takes the short way round, and the load's heading the same way
  // (in a carry the heading turns as planned above); the rotator is the difference
  for (let i = 1; i < keys.length; i++) {
    const a = keys[i - 1].pose, b = keys[i].pose;
    b.slew = unwrap(b.slew, a.slew);
    b.yaw = unwrap(b.yaw, a.yaw);
    // carries keep the turn they were planned with: pick the copy nearest the slew's change
    const ds = b.slew - a.slew;
    for (const c of [b.yaw - Math.PI * 2, b.yaw + Math.PI * 2]) if (Math.abs(c - a.yaw - ds) < Math.abs(b.yaw - a.yaw - ds) - 0.5) b.yaw = c;
  }
  for (const k of keys) k.pose.rotate = k.pose.yaw - k.pose.slew;
  er.rotation.x = er0;
  rig.root.updateMatrixWorld(true);
  return keys;
}

// the angle equal to a (mod 2 pi) nearest to b
function unwrap(a, b) {
  return a + Math.round((b - a) / (Math.PI * 2)) * Math.PI * 2;
}

// lay the keyframes on the time line between t0 and t1 (stretched or squeezed to fit)
function layKeys(keys, t0, t1) {
  const total = keys.reduce((s, k) => s + k.dt, 0) || 1;
  const k = (t1 - t0) / total;
  let t = t0;
  for (const key of keys) {
    t += key.dt * k;
    key.t = t;
  }
  keys.scale = k;
}

const POSE = { slew: 0, column: 0, boom: 0, post: 0, rotate: 0 };
const JOINTS = Object.keys(POSE);
function cranePose(keys, t, out = POSE) {
  let i = 0;
  while (i < keys.length - 1 && keys[i + 1].t <= t) i++;
  const a = keys[i], b = keys[Math.min(i + 1, keys.length - 1)];
  const k = b === a || t <= a.t ? 0 : ease(Math.min(1, (t - a.t) / (b.t - a.t)));
  for (const n of JOINTS) out[n] = a.pose[n] + (b.pose[n] - a.pose[n]) * k;
  return out;
}

// ---------------------------------------------------------------- driving and the crew's walks

// a truck on its lane: up it over ARRIVE s, stood, backed out after the job
function drive(r, lane, t, dur, front, rear, half, ground) {
  const s = t < dur ? lane.length * ease(ramp(t, 0, ARRIVE)) : lane.length * (1 - ease(ramp(t, dur + 0.6, dur + LEAVE)));
  lane.at(s, _o);
  placeOnGround(r.root, _o.x, _o.z, _o.heading, front, rear, half, ground);
  return s;
}

const WALK = 1.25; // m/s

// The crew's routes in the world, made once per play: from the cab doors round the trucks to their
// places (and back the same way, timed to be in before the outriggers come up).
function crewRoutes(play) {
  const { frame, tl } = play;
  const W = (x, z) => frame.xz(x, z, { x: 0, z: 0 });
  const out = tl.at('legs').start + 0.6, back = tl.at('board').start, retract = tl.at('retract').start;
  const door22L = W(X22 - T22.cab.w / 2 - 0.5, Z22 + T22.cab.zf + 0.7);
  const door58L = W(X58 - BAZ.cab.w / 2 - 0.5, Z58 + BAZ.cab.zf + 0.85), door58R = W(X58 + BAZ.cab.w / 2 + 0.5, Z58 + BAZ.cab.zf + 0.85);
  const mk = (pts, t0, back0) => {
    const legs = [];
    let total = 0;
    for (let i = 1; i < pts.length; i++) {
      const d = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z) / WALK;
      legs.push(d);
      total += d;
    }
    return { pts, legs, t0, back0: Math.min(back0, retract - total - 0.2) };
  };
  const lastGround = play.lifts.reduce((m, L) => (L.dst.at === 'ground' ? Math.max(m, L.tRelease) : m), 0);
  return {
    out,
    telNear: W(...STATIONS.telNear),
    list: [
      // the operator: round behind the 22T6 to his place, the control box in his hands
      mk([door22L, W(X22 - 3.0, Z22 + T22.cab.zf + 0.7), W(X22 - 3.0, Z22 + T22.rear + 1.85), W(...STATIONS.operator)], out, back - 2.5),
      // the guide: the same way round, then to the TEL's tail
      mk([door22L, W(X22 - 3.0, Z22 + T22.cab.zf + 1.4), W(X22 - 3.0, Z22 + T22.rear + 2.6), W(STATIONS.tel[0], Z22 + T22.rear + 2.6), W(...STATIONS.tel)], out + 1.2, back - 1.5),
      // between the trucks to the transporter's tail
      mk([door58R, W(X58 + 1.85, Z58 + BAZ.kingpin + TRAILER.rear + 0.9), W(...STATIONS.trailer)], out + 0.4, back - 1.5),
      // round the TEL's front to its far side, back once the spent canisters are down
      mk([door58L, W(X58 - 2.2, Z58 + BAZ.cab.zf - 1.5), W(2.6, -15.2), W(...STATIONS.ground)], out + 0.2, Math.max(lastGround + 1.5, out + 20)),
    ],
  };
}

// walk a route at time t: returns the place reached (stood there), or null while walking or gone
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

// the lift with its load on the hook at t (a little after the release too)
function liftAt(lifts, t, before, after) {
  for (const L of lifts) if (t > L.tGrip - before && t < L.tRelease + after) return L;
  return null;
}

// ---------------------------------------------------------------- the scene

export default {
  create(ctx) {
    const sets = new Map();
    ctx.unit.parts.forEach((p, i) => {
      if (p.role !== 'launcher') return;
      const set = createSet(ctx, i);
      set.present = [true, true, true, true];
      parkSet(set);
      sets.set(i, set);
    });
    return { sets };
  },

  start(ctx, state, job) {
    const set = state.sets.get(job.part);
    if (!set) return null;
    const rig = ctx.rig(set.part);
    if (!rig?.pivots.erector) return null;
    if (set.play) this.stop(ctx, state, set.play);
    set.own = set.own ?? telOwn(rig);
    const play = plan(ctx, set, job);
    play.set = set;
    play.job = job;
    // the spent canisters of the last reload are carried off before this one lands its own there
    set.ground.length = 0;
    // the time line: drive up, outriggers, the crane's work (stretched to fit), crew back, outriggers up
    const dur = job.dur;
    const tl = new Timeline().add('arrive', ARRIVE, true).add('brake', BRAKE, true).add('legs', LEGS, true).add('crane', 40).add('board', 3.2, true).add('retract', LEGS, true).fit(0, dur);
    play.tl = tl;
    play.keys = craneTrack(set, play, ctx);
    const c = tl.at('crane');
    layKeys(play.keys, c.start, c.end);
    // when each lift grips and lets go (canister places follow from these)
    let li = -1;
    for (const k of play.keys) {
      if (k.tag === 'grip') play.lifts[++li].tGrip = k.t - 0.6 * (k.t - play.keys[play.keys.indexOf(k) - 1].t);
      if (k.tag === 'release') play.lifts[li].tRelease = k.t - 0.5 * (k.t - play.keys[play.keys.indexOf(k) - 1].t);
    }
    play.end = dur + LEAVE;
    // every place a canister takes, made once (nothing is allocated per frame)
    for (const L of play.lifts) for (const o of L.objs) {
      o.hook = { at: 'hook', L, o };
      o.dest = L.dst.at === 'tel' ? { at: 'tel', k: o.slot } : { at: 'ground', layer: L.dst.layer, side: o.side ?? 0 };
    }
    play.place = new Array(N).fill(null);
    play.routes = crewRoutes(play);
    // lanes: from APPROACH m behind, straight up to the work places (backed out again afterwards)
    play.lane22 = new Lane(play.frame, [[X22, Z22 + APPROACH], [X22, Z22]]);
    play.lane58 = new Lane(play.frame, [[X58, Z58 + APPROACH], [X58, Z58]]);
    set.play = play;
    set.active = true;
    hideTel(set.own);
    set.cans.show(true);
    set.t22.setPayload?.(play.pack ? '9M96' : '48N6');
    set.t58.setPayload(play.pack ? '9M96' : '48N6');
    for (let k = 0; k < 4; k++) set.t58.setLoaded(k, true);
    set.t22.root.visible = set.t58.root.visible = true;
    return play;
  },

  update(ctx, state, play, t, job) {
    const set = play.set;
    if (set.play !== play) return false;
    const rig = ctx.rig(set.part);
    const { tl, frame } = play;
    const dur = play.job.dur;
    // ---- the trucks: drive up, stand, back out
    const s22 = drive(set.t22, play.lane22, t, dur, T22.axles[0], T22.axles[3], T22.track, ctx.ground);
    set.t22.setWheels(s22, 0);
    const s58 = drive(set.t58, play.lane58, t, dur, BAZ.axles[0], BAZ.axles[2], BAZ.track, ctx.ground);
    set.t58.setWheels(s58, 0);
    set.t58.setTrailerWheels(s58 * (BAZ.R / TRAILER.R));
    // ---- outriggers down after the brakes, up at the end
    const legs = tl.k('legs', t) * (1 - tl.k('retract', t));
    set.t22.setOutriggers(legs);
    // ---- crane
    set.t22.setCrane(cranePose(play.keys, t));
    // ---- doors: open while the crew gets out and back in
    const out0 = tl.at('legs').start, back = tl.at('board').start;
    const door = Math.max(smooth(t, out0, out0 + 0.8) * (1 - smooth(t, out0 + 2.5, out0 + 3.3)), smooth(t, back + 0.4, back + 1.2) * (1 - smooth(t, back + 2.4, back + 3.2)));
    set.t22.pivots.doorL.rotation.y = -1.1 * door;
    set.t58.pivots.doorL.rotation.y = -1.1 * door;
    set.t58.pivots.doorR.rotation.y = 1.1 * door;
    set.t22.root.updateMatrixWorld(true);
    set.t58.root.updateMatrixWorld(true);
    // ---- canisters
    this.canisters(ctx, set, play, rig, t);
    // ---- crew
    this.crew(ctx, set, play, t);
    if (t >= dur && set.active) {
      // the sim has counted the rounds: the TEL draws its own canisters again where all four stand
      this.handBack(ctx, set);
    }
    if (t >= play.end) {
      parkSet(set);
      set.play = null;
      return false;
    }
    return true;
  },

  // where every canister is at time t: on the TEL, on the hook, on the transporter, on the ground
  canisters(ctx, set, play, rig, t) {
    const cans = play.cans;
    const place = play.place;
    for (let i = 0; i < N; i++) place[i] = cans[i].place;
    for (const L of play.lifts) {
      if (t < L.tGrip) break;
      for (const o of L.objs) place[o.id] = t < L.tRelease ? o.hook : o.dest;
    }
    const handedBack = !set.active && set.present.every(Boolean);
    // the TEL's slots: present bodies (for the hand-back), the trailer's cargo shown by the rig itself
    for (let k = 0; k < 4; k++) set.t58.setLoaded(k, place[4 + k]?.at === 'cargo');
    const hookM = set.t22.anchors.craneLoad;
    hookM.updateWorldMatrix(true, false);
    for (let i = 0; i < N; i++) {
      const pl = place[i];
      let m = null;
      if (pl && pl.at === 'tel' && handedBack) m = null;
      else if (pl && pl.at === 'tel') {
        rig.anchors.mouths[pl.k].updateWorldMatrix(true, false);
        m = _m.copy(rig.anchors.mouths[pl.k].matrixWorld);
      } else if (pl && pl.at === 'ground') {
        m = placeMatrix(set, rig, play.frame, ctx.ground, pl, _m);
      } else if (pl && pl.at === 'hook') {
        // on the spreader: across at the source's spacing turning to the destination's, mouth forward
        const L = pl.L;
        const k = smooth(t, L.tGrip, L.tRelease);
        const half = L.S.half + (L.D.half - L.S.half) * k;
        _p.set(pl.o.side * half, 0, -CAN.LIP / 2);
        m = _m.makeTranslation(_p.x, _p.y, _p.z).premultiply(hookM.matrixWorld);
      }
      set.cans.set(i, m, play.pack, cans[i].covers);
    }
    set.cans.commit();
  },

  // the crew: out of the cabs to their places, working, back in (routes made in start)
  crew(ctx, set, play, t) {
    const { frame, routes } = play;
    if (t < routes.out || t > play.job.dur) {
      for (const c of set.crew) c.hide();
      return;
    }
    const hookP = set.t22.anchors.craneLoad.getWorldPosition(_p2);
    for (let i = 0; i < 4; i++) {
      const c = set.crew[i], r = routes.list[i];
      const p = walkRoute(c, r, t);
      if (!p) continue;
      const look = Crewman.facing(p.x, p.z, hookP.x, hookP.z);
      let L;
      if (i === 0) c.at(p.x, p.z, look, 'operate', t * 0.3);
      else if (i === 1) {
        // the guide at the TEL's tail: signals, reaches up to a pair coming down on the lower row
        L = liftAt(play.lifts, t, 0, 0.5);
        const near = L && L.dst.at === 'tel' && L.dst.row === 0 && t > L.tRelease - 3.2;
        const q = near ? routes.telNear : p;
        c.at(q.x, q.z, near ? frame.heading : Crewman.facing(q.x, q.z, hookP.x, hookP.z), near ? 'reachUp' : L ? 'signal' : 'stand', t * 0.5);
      } else if (i === 2) {
        // at the transporter's tail: signals while it is unloaded
        L = null;
        for (const x of play.lifts) if (x.src.at === 'cargo' && t > x.tGrip - 4 && t < x.tGrip + 3) L = x;
        c.at(p.x, p.z, L ? look : frame.heading + Math.PI / 2, L ? 'signal' : 'stand', t * 0.5);
      } else {
        // on the far side: reaches up as the spent ones come down
        L = null;
        for (const x of play.lifts) if (x.dst.at === 'ground' && t > x.tGrip && t < x.tRelease + 0.6) L = x;
        c.at(p.x, p.z, look, L && t > L.tRelease - 2.5 ? 'reachUp' : L ? 'signal' : 'stand', t * 0.5);
      }
    }
  },

  // after the job: the TEL takes its own canisters back where it has all four
  handBack(ctx, set) {
    const play = set.play;
    set.active = false;
    const rig = ctx.rig(set.part);
    // which slots now have a body: those filled, those never touched
    const present = [false, false, false, false];
    for (let k = 0; k < 4; k++) present[k] = set.present[k];
    for (const L of play.lifts) {
      if (L.src.at === 'tel') for (const o of L.objs) present[o.slot] = false;
      if (L.dst.at === 'tel') for (const o of L.objs) present[o.slot] = true;
    }
    set.present = present;
    // the spent ones stay on the ground
    set.ground = play.lifts.filter((L) => L.dst.at === 'ground').flatMap((L) => L.objs.map((o) => ({ at: 'ground', layer: L.dst.layer, side: o.side ?? 0, covers: play.cans[o.id].covers })));
    set.groundFrame = play.frame;
    set.groundPack = play.pack;
    if (present.every(Boolean)) showTel(set.own, rig, ctx.loaded(set.part), ctx.unit.parts[set.part].rounds);
  },

  stop(ctx, state, play) {
    const set = play?.set;
    if (!set) return;
    const rig = ctx.rig(set.part);
    if (set.own && rig) showTel(set.own, rig, ctx.loaded(set.part), ctx.unit.parts[set.part].rounds);
    set.present = [true, true, true, true];
    set.active = false;
    set.play = null;
    set.ground.length = 0;
    parkSet(set);
    set.cans.show(false);
  },

  // between plays: the spent canisters lying on the ground, the TEL's bodies where a short reload left
  // gaps (stand-ins follow its erector)
  idle(ctx, state) {
    for (const set of state.sets.values()) {
      if (set.play) continue;
      const rig = ctx.rig(set.part);
      const gaps = !set.present.every(Boolean);
      const any = gaps || set.ground.length > 0;
      set.cans.show(any);
      if (!any || !rig) continue;
      let i = 0;
      const p = ctx.unit.parts[set.part];
      if (gaps) {
        for (let k = 0; k < 4; k++) {
          if (!set.present[k]) continue;
          rig.anchors.mouths[k].updateWorldMatrix(true, false);
          const per = (rig.perSlot ?? 1) > 1 ? 4 : 1;
          set.cans.set(i++, rig.anchors.mouths[k].matrixWorld, per > 1, Math.max(0, Math.min(per, p.rounds - k * per)));
        }
      }
      for (const g of set.ground) set.cans.set(i++, placeMatrix(set, rig, set.groundFrame, ctx.ground, g, _m), set.groundPack, g.covers);
      while (i < N) set.cans.set(i++, null, false, 0);
      set.cans.commit();
    }
  },

  reset(ctx, state) {
    for (const set of state.sets.values()) {
      const rig = ctx.rig(set.part);
      if (set.own && rig) showTel(set.own, rig, ctx.loaded(set.part), ctx.unit.parts[set.part].rounds);
      set.present = [true, true, true, true];
      set.ground.length = 0;
      set.play = null;
      set.active = false;
      parkSet(set);
      set.cans.show(false);
    }
  },
};
