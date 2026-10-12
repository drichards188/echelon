import * as THREE from 'three';
import { SHILKA } from '../../models/v/shilka.js';
import { KAMAZ5350 } from '../../models/v/kamaz5350.js';
import { buildVehicle } from '../../models/vehicles.js';
import { Parts, vehicleMats, box } from '../../models/kit.js';
import { placeOnGround } from '../reload.js';
import { Hand, ManPlan, LoadPlan, VFrame, smooth, wrapPi } from './handwork.js';

// Shilka-M4: the ammunition restock between raids. The sim has no reload for the Shilka (guns only,
// SYSTEMS.shilka reload 0): the director's supply column refills its rounds the moment a raid ends
// (units.js resupply, sim.unitsAI.resupply()). This scene is driven from that state, not from a job:
// idle() watches weapons.gun.rounds and plays the restock when they jump up (resupply), with its own
// clock (the time-compressed dt), while the guns stand idle.
//
// Sources (refs/shilka/README.md section 7): no photograph of a Shilka being restocked was found; the
// research gives "the crew loads ammunition by hand from the ground or from a supply truck ... soldiers
// pass ammunition boxes up from the ground to the men on the vehicle", belts of 50 rounds in boxes. All
// of what follows is a reconstruction:
//  - a KamAZ-5350 cargo truck (models/v/kamaz5350.js) brings the boxes, drives up the Shilka's right
//    side and parks with its body beside the turret, two men riding in the back on the load;
//  - the turret is laid fore and aft for it (the render lays it there while the scene runs and gives it
//    back to the sim after; the guns are idle between raids) and the loader opens the domed hatch over
//    the right cheek (taken here as the right magazine's loading hatch, an assumption);
//  - a chain of three: the man in the truck lifts each box over the drop side to the man on the ground,
//    who turns and hands it up to the loader kneeling on the turret roof, who lowers it into the hatch;
//  - a box stands for about 300 rounds (from two to eight boxes shown, by the rounds the column added).
// If the guns are wanted while it runs (a target, the turret slewed, firing) the crew stops after the
// box in hand: the loader goes back in, the man on the ground climbs into the truck and it drives off,
// and the turret goes back to the sim at once.

const RING = SHILKA.ring; // turret ring centre (hull frame)
const RY = SHILKA.roof; // turret roof above the ring face
const TX = 1.5 + 0.75 + KAMAZ5350.bed.hw; // the truck's centre line: 0.75 m clear of the Shilka's skirt
const TZ = 0.62; // its origin when parked (hull frame): the body beside the turret
const APPROACH = 55, ARRIVE = 11, LEAVE = 12;
const BOX = { L: 0.56, H: 0.28, W: 0.22 };
const NMAX = 8;
const ROUNDS_PER_BOX = 300;
// the hand-over places: T in the truck at its left side, H on the ground between, D kneeling on the
// turret roof by the domed hatch (turret frame)
const T_SPOT = { x: -0.9, z: -1.77 }; // truck frame
// in the truck's frame: where the boxes ride, in front of T's place (he faces the rear to pick one up):
// one row of four along the body, two layers, long axis across
const STACK = [];
for (const layer of [1, 0]) for (const z of [-1.31, -1.05, -0.79, -0.53]) STACK.push({ x: T_SPOT.x, y: KAMAZ5350.bed.y + BOX.H / 2 + layer * (BOX.H + 0.01), z, yaw: Math.PI, pitch: 0 });
const H_SPOT = { x: 1.72 - TX, z: -1.77 }; // truck frame (on the ground)
const D_SPOT = { x: 0.95, z: -1.05 }; // turret frame
const DOME = SHILKA.dome, HATCH = SHILKA.hatch;

const FACE = { back: 0, front: Math.PI, left: Math.PI / 2, right: -Math.PI / 2 };

// ---------------------------------------------------------------- props

let GEO = null;
function geometry() {
  if (GEO) return GEO;
  const P = new Parts(vehicleMats('green'));
  // a wooden ammunition box painted olive: lid seam, corner battens, rope handles at the ends, stencils
  const { L, H, W } = BOX;
  P.add('canister', box(L, H, W, 0, 0, 0), { tint: 0xb4b49a });
  P.add('canister', box(L + 0.01, 0.025, W + 0.01, 0, H / 2 - 0.06, 0), { tint: 0x8c8c78 });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) P.add('canister', box(0.03, H + 0.005, 0.03, sx * (L / 2 - 0.02), 0, sz * (W / 2 - 0.02)), { tint: 0x9a9a84 });
  for (const sx of [-1, 1]) {
    P.add('dark', box(0.02, 0.025, 0.11, sx * (L / 2 + 0.012), 0.04, 0));
    for (const sz of [-1, 1]) P.add('dark', box(0.03, 0.03, 0.02, sx * (L / 2 + 0.008), 0.04, sz * 0.055));
  }
  for (const sz of [-1, 1]) {
    P.add('white', box(0.2, 0.05, 0.004, -0.06, 0.02, sz * (W / 2 + 0.002)), { tint: 0xbdbdb0 });
    P.add('white', box(0.12, 0.035, 0.004, 0.12, -0.06, sz * (W / 2 + 0.002)), { tint: 0xbdbdb0 });
  }
  const out = {};
  for (const key of P.lists.keys()) {
    const g = P.merged(key);
    g.setAttribute('aH', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count).fill(2.5), 1));
    g.computeBoundingSphere();
    out[key] = g;
  }
  GEO = out;
  return GEO;
}

const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

class Boxes {
  constructor(group) {
    const G = geometry(), M = vehicleMats('green');
    this.meshes = Object.keys(G).map((k) => {
      const m = new THREE.InstancedMesh(G[k], M[k], NMAX);
      m.castShadow = m.receiveShadow = true;
      m.frustumCulled = false;
      for (let i = 0; i < NMAX; i++) m.setMatrixAt(i, ZERO);
      group.add(m);
      return m;
    });
  }

  set(i, m) {
    for (const x of this.meshes) x.setMatrixAt(i, m ?? ZERO);
  }

  commit() {
    for (const x of this.meshes) x.instanceMatrix.needsUpdate = true;
  }

  show(on) {
    for (const x of this.meshes) x.visible = on;
  }
}

// the dark holes under the two roof hatches (turret frame), seen while their lids stand open
function holes(group) {
  const dark = new THREE.MeshStandardMaterial({ color: 0x0c0d0b, roughness: 1, metalness: 0 });
  const mk = (geo) => {
    const m = new THREE.Mesh(geo, dark);
    m.matrixAutoUpdate = false;
    m.receiveShadow = true;
    m.visible = false;
    group.add(m);
    return m;
  };
  const crew = mk(new THREE.PlaneGeometry(0.72, 0.66).rotateX(-Math.PI / 2).translate(HATCH.x, RY + 0.052, HATCH.z));
  const dome = mk(new THREE.CircleGeometry(0.27, 20).rotateX(-Math.PI / 2).scale(1.08, 1, 0.95).translate(DOME.x, RY + 0.054, DOME.z));
  return { crew, dome };
}

// ---------------------------------------------------------------- the plan

const walkTime = (a, b, v = 1.2) => Math.max(0.4, Math.hypot(b.x - a.x, b.z - a.z) / v);
const grips = (load, list) => list.map(([side, x, y, z, kind]) => ({ side, load, p: [x, y, z], kind }));
// a box held by its end handles, across the man's body (box X is its length)
const ENDS = (j) => grips(j, [['L', -BOX.L / 2 - 0.01, 0.03, 0, 'side'], ['R', BOX.L / 2 + 0.01, 0.03, 0, 'side']]);
// ... the same, but its -X end toward his right (a man facing the other way)
const ENDS_R = (j) => grips(j, [['L', BOX.L / 2 + 0.01, 0.03, 0, 'side'], ['R', -BOX.L / 2 - 0.01, 0.03, 0, 'side']]);

// truck frame <-> turret frame while the truck stands parked and the turret is laid fore and aft
const truckToTurret = (p) => ({ ...p, x: p.x + TX, y: p.y - RING.y, z: p.z + TZ - RING.z });
const turretToTruck = (p) => ({ ...p, x: p.x - TX, y: p.y + RING.y, z: p.z - TZ + RING.z });

/**
 * Plan a restock of n boxes (plan time = seconds). `cut` (optional): the plan time the crew was told
 * to stop; the boxes started before it are finished, then everyone packs up. Returns { loads, men,
 * truck: { arrive, leave }, lids, turret: { lay, release }, end, starts (each box's start) }.
 */
function plan(n, cut = Infinity) {
  const loads = [];
  for (let i = 0; i < NMAX; i++) {
    const L = new LoadPlan(STACK[i]).in('truck');
    if (i >= n) L.hide(Infinity);
    loads.push(L);
  }
  // T and H ride in the back, crouched by the load; D is inside the turret
  const T = new ManPlan({ x: -0.15, y: KAMAZ5350.bed.y, z: -1.55, h: FACE.left, ground: false }).in('truck');
  const H = new ManPlan({ x: 0.55, y: KAMAZ5350.bed.y, z: -0.9, h: FACE.left, ground: false }).in('truck');
  const D = new ManPlan({ x: HATCH.x, y: RY - 1.05, z: HATCH.z - 0.05, h: FACE.back, ground: false }).in('turret');
  T.hold(ARRIVE + 0.4, 'crouch');
  H.hold(ARRIVE + 0.4, 'crouch');
  const lids = { crew: [3.2, 4.2, Infinity, Infinity], dome: [0, 0, Infinity, Infinity] };
  // D up out of the crew hatch, round to the domed hatch, opens it
  D.hide(4.0);
  D.move(2.0, { y: RY, ground: false }, { gait: 'climb' });
  D.move(0.8, { z: HATCH.z - 0.55, y: RY + 0.02 }, { pose: 'stand', gait: 'auto' });
  for (const [x, z] of [[0.45, D_SPOT.z], [D_SPOT.x, D_SPOT.z]]) D.move(walkTime(D.at, { x, z }), { x, z, y: RY + 0.03, h: Math.atan2(-(x - D.at.x), -(z - D.at.z)) });
  D.move(0.6, { h: FACE.front }, { pose: 'crouch', gait: 'none' });
  lids.dome[0] = D.t;
  lids.dome[1] = D.t + 1.0;
  D.hold(D.t + 1.1, 'crouch');
  D.move(0.6, { h: FACE.right }, { pose: 'crouch', gait: 'none' });
  // the truck parks: T stands at the left side of the body, H climbs down over it into the gap
  const parked = ARRIVE;
  T.hold(parked + 0.4, 'crouch');
  T.move(0.7, { y: KAMAZ5350.bed.y }, { pose: 'stand', gait: 'none' });
  T.move(walkTime(T.at, T_SPOT, 1.0), { x: T_SPOT.x, z: T_SPOT.z, h: FACE.left }, { pose: 'stand' });
  H.hold(parked + 0.6, 'crouch');
  H.move(0.6, { y: KAMAZ5350.bed.y }, { pose: 'stand', gait: 'none' });
  H.move(walkTime(H.at, { x: -0.95, z: H_SPOT.z }), { x: -0.95, z: H_SPOT.z, h: FACE.right });
  H.move(0.6, { x: -1.1, h: FACE.right }, { pose: 'crouch', gait: 'none' });
  const side = -KAMAZ5350.bed.hw - 0.32; // the climb's root, facing the truck's side
  H.move(0.9, { x: side, y: 0.75, ground: true, h: FACE.right }, { pose: 'climb', gait: 'none' });
  H.move(1.3, { y: 0, ground: true }, { gait: 'climb' });
  H.move(0.7, { x: H_SPOT.x, z: H_SPOT.z, h: FACE.right }, { pose: 'stand' });
  // ---- the chain: T fetches each box from the load, over the side to H, up to D, into the hatch.
  // A box held across a man's body lies along his left-right axis; `rel` is its yaw less his heading
  // (0: its +X end at his right, ENDS; PI: at his left, ENDS_R). It turns with him.
  const front = (m, d, y, rel) => ({ x: m.at.x - Math.sin(m.at.h) * d, y, z: m.at.z - Math.cos(m.at.h) * d, yaw: m.at.h + rel, pitch: 0 });
  const gr = (i, rel) => (Math.cos(rel) > 0 ? ENDS(i) : ENDS_R(i));
  const carryY = KAMAZ5350.bed.y + 1.07 + BOX.H / 2;
  const starts = [];
  let done = 0;
  for (let i = 0; i < n; i++) {
    const L = loads[i], st = STACK[i];
    if (T.t > cut) break; // told to stop before this one
    starts.push(T.t);
    done = i + 1;
    // T turns to the load behind him, steps up to the box, kneels, takes it by its handles, stands with
    // it, steps back and turns to the drop side
    const relT = wrapPi(st.yaw - FACE.front);
    T.move(0.5, { h: FACE.front }, { pose: 'stand', gait: 'none' });
    const zPick = st.z - 0.45;
    if (zPick - T.at.z > 0.12) T.move(walkTime(T.at, { x: T.at.x, z: zPick }, 0.9), { z: zPick }, { pose: 'stand' });
    T.move(0.6, {}, { pose: 'crouch', gait: 'none' });
    T.hold(T.t + 0.3, 'crouch', gr(i, relT));
    L.hold(T.t);
    T.move(0.7, {}, { pose: 'carry', gait: 'none', grips: gr(i, relT) });
    L.to(0.7, front(T, 0.36, carryY, relT));
    if (T.at.z - T_SPOT.z > 0.12) {
      const tw = walkTime(T.at, T_SPOT, 0.8);
      T.move(tw, { z: T_SPOT.z }, { pose: 'carry', grips: gr(i, relT) });
      L.to(tw, front(T, 0.36, carryY, relT), true);
    }
    T.move(0.6, { h: FACE.left }, { pose: 'carry', gait: 'none', grips: gr(i, relT) });
    L.to(0.6, front(T, 0.36, carryY, relT));
    // over the drop side, down into H's hands (H facing the truck, his hands up)
    const tGive = Math.max(T.t, H.t);
    T.hold(tGive, 'carry', gr(i, relT));
    H.hold(tGive, 'stand');
    L.hold(tGive);
    const over = { x: -KAMAZ5350.bed.hw - 0.24, y: KAMAZ5350.bed.y + 0.78, z: T_SPOT.z, yaw: FACE.left + relT, pitch: 0 };
    L.to(1.0, over);
    T.hold(L.t, 'carry', gr(i, relT));
    const relH = wrapPi(over.yaw - FACE.right);
    H.hold(L.t - 0.7, 'stand').hold(L.t, 'reachUp', gr(i, relH)); // his hands up as it comes over
    T.hold(L.t + 0.2, 'carry', gr(i, relT));
    L.hold(L.t + 0.2);
    H.hold(L.t, 'reachUp', gr(i, relH));
    T.move(0.5, {}, { pose: 'stand', gait: 'none' });
    // H turns round with it to the Shilka, holding it up (two quarter turns)
    H.move(0.55, { h: FACE.front }, { pose: 'reachUp', gait: 'none', grips: gr(i, relH) });
    L.to(0.55, front(H, 0.3, 2.12, relH));
    H.move(0.55, { h: FACE.left }, { pose: 'reachUp', gait: 'none', grips: gr(i, relH) });
    L.to(0.55, front(H, 0.3, 2.12, relH));
    // up to D, kneeling at the edge of the turret roof
    const tUp = Math.max(L.t, D.t);
    L.hold(tUp);
    H.hold(tUp, 'carry', gr(i, relH));
    D.hold(tUp, 'crouch');
    const up = front(H, 0.4, 2.34, relH);
    L.to(0.7, up);
    H.move(0.7, {}, { pose: 'reachUp', gait: 'none', grips: gr(i, relH) });
    const upT = truckToTurret(up);
    const relD = wrapPi(upT.yaw - FACE.right);
    D.hold(L.t - 0.35, 'crouch').hold(L.t, 'crouch', gr(i, relD));
    L.in('turret', upT);
    L.hold(L.t + 0.25);
    H.hold(L.t, 'reachUp', gr(i, relH));
    D.hold(L.t, 'crouch', gr(i, relD));
    // D turns to the open hatch with it and lowers it in; H turns back to the truck
    H.move(0.5, { h: FACE.front }, { pose: 'stand', gait: 'none' });
    H.move(0.5, { h: FACE.right }, { pose: 'stand', gait: 'none' });
    D.move(0.8, { h: FACE.front }, { pose: 'crouch', gait: 'none', grips: gr(i, relD) });
    L.to(0.8, front(D, 0.42, RY + 0.55, relD));
    L.to(0.7, { x: DOME.x, y: RY - 0.2, z: DOME.z, yaw: FACE.front + relD, pitch: 0 });
    D.hold(L.t, 'crouch', gr(i, relD));
    L.hide(Infinity);
    D.move(0.7, { h: FACE.right }, { pose: 'crouch', gait: 'none' });
  }
  // ---- pack up: D shuts the hatch and goes back in, H climbs into the truck, it drives off
  const tEnd = Math.max(T.t, H.t, D.t);
  D.move(0.6, { h: FACE.front }, { pose: 'crouch', gait: 'none' });
  lids.dome[2] = D.t;
  lids.dome[3] = D.t + 0.9;
  D.hold(D.t + 1.0, 'crouch');
  D.move(0.6, { y: RY + 0.03 }, { pose: 'stand', gait: 'none' });
  for (const [x, z] of [[0.45, D_SPOT.z], [HATCH.x, HATCH.z - 0.55]]) D.move(walkTime(D.at, { x, z }), { x, z, y: RY + 0.02, h: Math.atan2(-(x - D.at.x), -(z - D.at.z)) });
  D.move(0.6, { z: HATCH.z - 0.05, h: FACE.back }, { pose: 'stand', gait: 'none' });
  D.move(1.6, { y: RY - 1.05 }, { gait: 'climb' });
  D.hide(Infinity);
  const inside = D.segs[D.segs.length - 1].t0;
  lids.crew[2] = inside + 0.2;
  lids.crew[3] = inside + 1.2;
  H.hold(Math.max(H.t, tEnd), 'stand');
  H.move(0.6, { x: -KAMAZ5350.bed.hw - 0.32, z: H_SPOT.z, h: FACE.right }, { pose: 'stand' });
  H.move(1.3, { y: 0.75, ground: true }, { gait: 'climb' });
  H.move(0.9, { x: -1.0, y: KAMAZ5350.bed.y, ground: false }, { pose: 'crouch', gait: 'none' });
  H.move(walkTime(H.at, { x: 0.55, z: -0.9 }), { x: 0.55, z: -0.9, h: FACE.left }, { pose: 'stand' });
  H.move(0.6, { y: KAMAZ5350.bed.y }, { pose: 'crouch', gait: 'none' });
  T.hold(Math.max(T.t, tEnd), 'stand');
  T.move(walkTime(T.at, { x: -0.15, z: -1.55 }), { x: -0.15, z: -1.55, h: FACE.left }, { pose: 'stand' });
  T.move(0.6, { y: KAMAZ5350.bed.y }, { pose: 'crouch', gait: 'none' });
  const leave = Math.max(H.t, T.t) + 0.8;
  const end = Math.max(leave + LEAVE, inside + 2.5);
  for (const m of [T, H]) m.hold(end, 'crouch');
  for (const L of loads) if (L.t < end && L.t !== Infinity) L.hold(end);
  return { loads, men: [T, H, D], truck: { arrive: ARRIVE, leave }, lids, turret: { lay: [0.4, 2.8], release: inside + 0.3 }, end, starts, done };
}

// ---------------------------------------------------------------- the scene

const _p = new THREE.Vector3(), _m = new THREE.Matrix4();
const kOf = (t, a, b) => (b > a ? smooth((t - a) / (b - a)) : t >= a ? 1 : 0);

export default {
  create(ctx) {
    const group = new THREE.Group();
    group.name = 'reload-shilka';
    ctx.group.add(group);
    const truck = buildVehicle('kamaz-5350');
    truck.root.visible = false;
    group.add(truck.root);
    const boxes = new Boxes(group);
    boxes.show(false);
    const crew = [
      new Hand(group, { headgear: 'cap', skin: 1 }), // in the truck
      new Hand(group, { headgear: 'cap', skin: 3 }), // on the ground
      new Hand(group, { headgear: 'helmet', skin: 0 }), // the Shilka's loader
    ];
    for (const c of crew) c.hide();
    const hull = new VFrame(), frames = { truck: new VFrame(), turret: new VFrame() };
    const g = ctx.unit.weapons.gun;
    return { group, truck, boxes, crew, hull, frames, holes: holes(group), play: null, prev: g?.rounds ?? 0, pending: null };
  },

  // the sim's reload jobs never come for the Shilka; everything happens in idle()
  start() {
    return null;
  },

  update() {
    return false;
  },

  stop(ctx, state) {
    this.end(ctx, state);
  },

  idle(ctx, state, dt) {
    const u = ctx.unit, g = u.weapons.gun;
    if (!g) return;
    if (!u.alive) {
      if (state.play) this.end(ctx, state);
      state.pending = null;
      state.prev = g.rounds;
      return;
    }
    // the supply column refilled the guns: the restock (the rounds are already counted by the sim)
    if (g.rounds > state.prev + 20 && !state.play) state.pending = { added: g.rounds - state.prev, wait: 0 };
    state.prev = g.rounds;
    const busy = g.target != null || g.firing;
    if (state.pending && !state.play) {
      state.pending.wait += dt;
      if (!busy) this.begin(ctx, state, state.pending.added);
      else if (state.pending.wait > 15) state.pending = null;
    }
    const play = state.play;
    if (!play) return;
    play.t += dt;
    // wanted for the guns: finish the box in hand, pack up, give the turret back at once
    if (play.cut === Infinity && (busy || Math.abs(wrapPi(u.turret.az - play.az0)) > 0.03)) this.stopWork(state, play);
    this.pose(ctx, state, play);
    if (play.t >= play.p.end) this.end(ctx, state);
  },

  begin(ctx, state, added) {
    const u = ctx.unit, p = u.parts[0], rig = ctx.rig(0);
    if (!rig?.pivots.turret) return;
    state.pending = null;
    state.hull.set(p.pos, p.heading);
    const n = Math.max(2, Math.min(NMAX, Math.round(added / ROUNDS_PER_BOX)));
    const play = { t: 0, n, cut: Infinity, az0: u.turret.az, rig, p: plan(n), release: null };
    play.release = play.p.turret.release;
    state.play = play;
    state.crew.forEach((h, i) => (h.plan = play.p.men[i]));
    state.truck.root.visible = true;
    state.boxes.show(true);
  },

  // the guns are wanted: re-plan with the boxes already started (the same plan up to now)
  stopWork(state, play) {
    play.cut = play.t;
    play.p = plan(play.n, play.t);
    play.release = Math.min(play.p.turret.release, play.t + 0.2);
    state.crew.forEach((h, i) => (h.plan = play.p.men[i]));
  },

  pose(ctx, state, play) {
    const t = play.t, pl = play.p, rig = play.rig, u = ctx.unit;
    const hull = state.hull, F = state.frames;
    // ---- the turret: laid fore and aft while the crew works on it, then back to the sim's
    const w = kOf(t, pl.turret.lay[0], pl.turret.lay[1]) * (1 - kOf(t, play.release, play.release + 2.2));
    const azr = wrapPi(u.turret.az) * (1 - w);
    rig.pivots.turret.rotation.y = azr;
    if (rig.pivots.elevation) rig.pivots.elevation.rotation.x = u.turret.el * (1 - w) + 0.04 * w;
    if (rig.pivots.hatch) rig.pivots.hatch.rotation.x = 1.8 * kOf(t, pl.lids.crew[0], pl.lids.crew[1]) * (1 - kOf(t, pl.lids.crew[2], pl.lids.crew[3]));
    const dome = kOf(t, pl.lids.dome[0], pl.lids.dome[1]) * (1 - kOf(t, pl.lids.dome[2], pl.lids.dome[3]));
    if (rig.pivots.ammoHatch) rig.pivots.ammoHatch.rotation.x = 1.75 * dome;
    // the turret's frame (ring centre, turned with it)
    hull.point(0, RING.y, RING.z, false, _p);
    F.turret.set(_p, hull.heading + azr);
    // holes under the open lids
    _m.makeRotationY(F.turret.heading).setPosition(F.turret.pos);
    this.hole(state.holes.crew, rig.pivots.hatch?.rotation.x > 0.05);
    this.hole(state.holes.dome, dome > 0.03);
    // ---- the truck: up the lane from behind, parked, off forward
    const tr = state.truck, A = KAMAZ5350.axles;
    let z, roll;
    if (t < pl.truck.leave) {
      const q = 1 - Math.min(1, t / ARRIVE), k = 1 - q * q; // arrives at speed and brakes
      z = TZ + APPROACH * (1 - k);
      roll = APPROACH * k;
    } else {
      const k = Math.min(1, (t - pl.truck.leave) / LEAVE);
      const s = 65 * k * k;
      z = TZ - s;
      roll = APPROACH + s;
    }
    hull.point(TX, 0, z, false, _p);
    placeOnGround(tr.root, _p.x, _p.z, hull.heading, A[0], A[2], KAMAZ5350.track, ctx.ground);
    tr.setWheels(roll, 0);
    _p.y = tr.root.position.y;
    F.truck.set(_p, hull.heading);
    tr.pivots.sideL.rotation.z = 0;
    // ---- the boxes and the crew
    for (let i = 0; i < NMAX; i++) {
      const L = pl.loads[i];
      state.boxes.set(i, L.eval(t, hull, F) ? L.m : null);
    }
    state.boxes.commit();
    for (const h of state.crew) if (h.plan) h.eval(t, hull, pl.loads, F);
  },

  // a hole under an open lid, on the turret (_m: the turret's frame)
  hole(mesh, open) {
    mesh.visible = open;
    if (!open) return;
    mesh.matrix.copy(_m);
    mesh.matrixWorldNeedsUpdate = true;
  },

  // the restock is over (or cut short): the props go, the turret is the sim's again
  end(ctx, state) {
    const play = state.play;
    state.play = null;
    state.truck.root.visible = false;
    state.boxes.show(false);
    state.holes.crew.visible = state.holes.dome.visible = false;
    for (const h of state.crew) {
      h.plan = null;
      h.hide();
    }
    const rig = play?.rig;
    if (rig?.pivots.hatch) rig.pivots.hatch.rotation.x = 0;
    if (rig?.pivots.ammoHatch) rig.pivots.ammoHatch.rotation.x = 0;
  },

  reset(ctx, state) {
    this.end(ctx, state);
    state.pending = null;
    state.prev = ctx.unit.weapons.gun?.rounds ?? 0;
  },
};

// the plan alone (pure, runs in Node), for checking the timings headless
export { plan as planShilka };
