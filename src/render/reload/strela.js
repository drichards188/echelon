import * as THREE from 'three';
import { STRELA, container, lid } from '../../models/v/strela.js';
import { MTLB } from '../../models/v/mtlb.js';
import { Parts, vehicleMats, box, xTube, yTube } from '../../models/kit.js';
import { SYSTEMS } from '../../sim/systems.js';
import { Hand, ManPlan, LoadPlan, VFrame, poseApply, smooth } from './handwork.js';

// Strela-10M3: the crew reloads the launcher by hand (refs/reload/README.md section 4; photos
// strela_10mn_mastering2018_02/03/04/10, which show the 10MN on the same hull). Three men, no crane:
// one on the roof by the launcher, two passing the containers up from the ground (mastering2018_04).
//
// What the photos show, and what is reconstructed:
//  - Seen: three men, one on the roof bent over the end of a container, two below with their arms up
//    holding it; the container passed lengthwise, its X-braced end toward the rear; an open door with
//    rack frames and stowed containers behind it (the photo is taken from behind: the closed door beside
//    it is hinged at its outer edge and the end of the track shows next to it, so these are the MT-LB's
//    two rear doors, not a side door); the launcher raised and the turret facing forward.
//  - Reconstructed: the launcher laid fore and aft and raised 0.33 rad (19 degrees,
//    SYSTEMS.strela.reloadPose) so its rails lead down over the rear of the roof, clear of the corner
//    rails, and a container lifted from behind slides up its rail (the rails are open topped, refs
//    section 4a); the spares stowed behind the left rear door on a 2 x 2 rack, rear ends out (the sim
//    keeps four in reserve, the more specific of the two sources; Wikipedia's eight would not fit the
//    rack); the crew getting out through the right rear door and the roof man climbing up the right side
//    (photo 03: "one climbing the side by the track guard"); each spent container (the sim's empty
//    slots) pulled back down its rail before its fresh one goes up, and laid on the ground beside the
//    vehicle (they lie there until the next reload).
//  - The order per slot: the roof man pulls the spent container back by its end, then from beside it;
//    the man behind takes its end and draws it down off the frame while the roof man lowers the front
//    and the second ground man takes it under the middle; they carry it to the pile. Then the two fetch
//    a fresh one from the rack (one pulls it out by the end, the other takes it under the middle), carry
//    it behind its rail, raise its front over the rear edge to the kneeling roof man, who lifts it onto
//    the rail's lower end; the man behind pushes it up the rail as far as he can reach, the roof man
//    shoves it on from beside it and home from behind its end, and latches it.
//
// Timing: a believable pace needs about 18 s a container plus about 8 s to get out and up (and the
// climb back after), about 80 s for four. The plan is made at that pace and squeezed to the job's
// time when the job is shorter (SYSTEMS.strela.reload is 20 s: four times too fast; see DESIGN.md).

const { TZ, TY, EY, XS } = STRELA;
const TRUN = TY + EY; // trunnion height above the ground
const ROOF = MTLB.roof;
const ZR = MTLB.rear;
const LEN = 2.26, HALF = 1.13; // container length, half
const RACK = [[-0.28, 1.33], [-0.66, 1.33], [-0.28, 0.92], [-0.66, 0.92]]; // spares: x, y of the axis, taken in this order
const RACK_Z = ZR + 0.012 - HALF - 0.012; // stowed: the rear ends just proud of the opening's plane
const PILE = [-2.25, -1.88, 1.82, 2.19]; // where each slot's spent container is laid (x), along the vehicle
const PILE_Z = 4.9;
const D_START = LEN; // rail travel: the container's front end on the rail's lower end
const D_REACH = 1.45; // as far up as the man behind can push it
const D_SIDE = 0.5; // the roof man's shove from beside it ends here; from behind the end it goes home
const N = 8; // containers drawn: 4 on the launcher, 4 spares

// ---------------------------------------------------------------- props

let GEO = null;
function geometry() {
  if (GEO) return GEO;
  const mats = vehicleMats('green');
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
  GEO = { body: take((P) => container(P, 0)), lid: take((P) => lid(P, 0)) };
  return GEO;
}

const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

class Containers {
  constructor(group) {
    const G = geometry(), M = vehicleMats('green');
    this.meshes = [];
    this.lids = [];
    const mk = (geo, mat, list) => {
      const m = new THREE.InstancedMesh(geo, mat, N);
      m.castShadow = true;
      m.receiveShadow = true;
      m.frustumCulled = false;
      for (let i = 0; i < N; i++) m.setMatrixAt(i, ZERO);
      group.add(m);
      list.push(m);
    };
    for (const k of Object.keys(G.body)) mk(G.body[k], M[k], this.meshes);
    for (const k of Object.keys(G.lid)) mk(G.lid[k], M[k], this.lids);
  }

  set(i, m, withLid) {
    const z = m ?? ZERO;
    for (const x of this.meshes) x.setMatrixAt(i, z);
    for (const x of this.lids) x.setMatrixAt(i, m && withLid ? m : ZERO);
  }

  commit() {
    for (const x of this.meshes) x.instanceMatrix.needsUpdate = true;
    for (const x of this.lids) x.instanceMatrix.needsUpdate = true;
  }

  show(on) {
    for (const x of this.meshes) x.visible = on;
    for (const x of this.lids) x.visible = on;
  }
}

// The dark compartment behind each rear door (seen while it stands open), the spares' rack frame in the
// left one. Drawn on the hull's rear face just proud of it: whatever is inside the hull behind it (the
// stowed containers, a man coming out) stays hidden until it comes through the plane.
function openings(group) {
  const dark = new THREE.MeshStandardMaterial({ color: 0x0c0d0b, roughness: 1, metalness: 0 });
  const steel = vehicleMats('green').white;
  const out = [];
  for (const s of [-1, 1]) {
    const g = new THREE.Group();
    g.name = 'strela-door-' + (s < 0 ? 'L' : 'R');
    g.matrixAutoUpdate = false;
    const q = new THREE.Mesh(new THREE.PlaneGeometry(0.86, 0.98), dark);
    q.position.set(s * 0.47, 1.18, ZR + 0.012);
    q.receiveShadow = true;
    g.add(q);
    if (s < 0) {
      // the rack: white uprights between the columns and a shelf between the rows (mastering2018_04)
      const P = new Parts(vehicleMats('green'));
      for (const x of [-0.85, -0.47, -0.09]) P.add('white', yTube(0.69, 1.67, 0.014, 0.014, 6, x, ZR + 0.02));
      for (const y of [0.73, 1.125, 1.52]) P.add('white', xTube(-0.88, -0.06, 0.012, 0.012, 6, y, ZR + 0.02));
      P.add('white', box(0.06, 0.08, 0.01, -0.06, 1.42, ZR + 0.022)); // the numbered plates
      P.add('white', box(0.06, 0.08, 0.01, -0.06, 1.0, ZR + 0.022));
      for (const m of P.build(g)) m.material = steel;
    }
    g.visible = false;
    group.add(g);
    out.push(g);
  }
  return out;
}

// ---------------------------------------------------------------- geometry of the work

// the reload pose (the sim lays the launcher there): elevation of the rails
const elOf = () => SYSTEMS.strela.reloadPose?.el ?? 0.33;

// a container on slot k's rail, d metres back from home (toward its rear end, down the rail)
function railPose(k, d, el) {
  return { x: XS[k], y: TRUN - Math.sin(el) * d, z: TZ + Math.cos(el) * d, yaw: 0, pitch: el };
}

// a grip point of a container in this pose, in the vehicle frame (a new vector: planning only)
const at = (pose, x, y, z) => poseApply(pose, x, y, z);

// hands: [side, x, y, z, kind] in the container's frame (mouth -Z, rear end +Z)
const grips = (load, list) => list.map(([side, x, y, z, kind]) => ({ side, load, p: [x, y, z], kind }));
// the man behind the rear end: hands on its sides, or pushing its lower half
const BEHIND = (j) => grips(j, [['L', -0.18, -0.03, 0.98, 'side'], ['R', 0.18, -0.03, 0.98, 'side']]);
const PUSH_END = (j) => grips(j, [['L', -0.1, -0.11, HALF + 0.03, 'end'], ['R', 0.1, -0.11, HALF + 0.03, 'end']]);
// a man beside it (s = +1 on its +x side, facing -x), hands under it about z0 (his right hand toward -z
// when he is on the +x side), or on its top
const UNDER = (j, s, z0, y = -0.17) => grips(j, [['L', 0, y, z0 + s * 0.19, 'under'], ['R', 0, y, z0 - s * 0.19, 'under']]);
const TOP = (j, s, z0) => grips(j, [['L', 0, 0.17, z0 + s * 0.2, 'top'], ['R', 0, 0.17, z0 - s * 0.2, 'top']]);

// a container along the vehicle at x with its front end resting at (fz, fy) and its rear end at height ry
// (ground: heights above the terrain)
function ends(x, fz, fy, ry, ground = false) {
  const dy = fy - ry, dz = Math.sqrt(LEN * LEN - dy * dy);
  return { x, y: (fy + ry) / 2, z: fz + dz / 2, yaw: 0, pitch: Math.atan2(dy, dz), ground };
}

const FACE = { back: 0, front: Math.PI, left: Math.PI / 2, right: -Math.PI / 2 }; // facing -z, +z, -x, +x
const sideFace = (s) => (s > 0 ? FACE.left : FACE.right); // beside it on side s, facing it
const walkTime = (a, b, v = 1.25) => Math.max(0.5, Math.hypot(b.x - a.x, b.z - a.z) / v);
// walk through waypoints [x, z] (on the ground), facing along the way, the last one facing h
const via = (m, pts, h, opts = {}) => {
  for (let i = 0; i < pts.length; i++) {
    const to = { x: pts[i][0], z: pts[i][1], y: 0, ground: true };
    const last = i === pts.length - 1;
    const hh = last && h != null ? h : Math.atan2(-(to.x - m.at.x), -(to.z - m.at.z));
    m.move(walkTime(m.at, to), { ...to, h: hh }, opts);
  }
  return m;
};

/**
 * Plan a job at the natural pace (plan time = seconds at that pace). Returns { loads (LoadPlans: 0..3
 * the launcher's containers, 4..7 the spares), men [roof, behind, beside], lidOn, final (where each load
 * ends: 'rail', 'ground', 'rack'), work (the last container latched), board (the crew is back in), end, doors }.
 */
function plan(job, reserve) {
  const el = elOf();
  const rail = (k, d) => railPose(k, d, el);
  const loads = [];
  // the launcher's containers sit on their rails (following the launcher as it is laid) until moved
  for (let k = 0; k < 4; k++) loads.push(new LoadPlan(rail(k, 0)));
  for (let j = 0; j < 4; j++) {
    const L = new LoadPlan({ x: RACK[j][0], y: RACK[j][1], z: RACK_Z, yaw: 0, pitch: 0 });
    if (j >= reserve) L.hide(Infinity);
    loads.push(L);
  }
  const railTo = (L, k, dur, d0, d1) => L.fn(dur, 'rail', { slot: k, d0, d1 }, rail(k, d1));
  const railHold = (L, k, t1, d) => (t1 > L.t ? railTo(L, k, t1 - L.t, d, d) : L);
  const lidOn = [true, true, true, true, true, true, true, true];
  for (const k of job.slots) lidOn[k] = false;
  const final = ['rail', 'rail', 'rail', 'rail', 'rack', 'rack', 'rack', 'rack'];
  const slotOf = [0, 1, 2, 3, -1, -1, -1, -1]; // the rail each load ends on
  // the roof man R, the man behind G1, the man beside G2; all start inside, behind the right rear door
  const inside = (x) => ({ x, y: 0.55, z: ZR - 0.6, h: FACE.front, ground: false });
  const R = new ManPlan(inside(0.5)), G1 = new ManPlan(inside(0.42)), G2 = new ManPlan(inside(0.38));
  // out of the right rear door (stooping through it), then through waypoints clear of the open leaves
  const out = (m, t0, pts, h) => {
    m.hide(t0);
    m.move(1.0, { x: 0.47, y: 0.0, z: ZR + 0.3, ground: true, h: FACE.front }, { gait: 'stoop' });
    via(m, [[0.47, ZR + 0.75], ...pts], h);
  };
  const doors = { R: [0.3, 1.3], L: [0, 0], closeR: [0, 0], openR2: [0, 0], closeL: [0, 0], closeR2: [0, 0] };
  // the left door: G1 swings it open standing clear of its leaf's sweep (and of the right one's)
  const atDoorL = { x: -0.1, z: ZR + 1.15 };
  out(G1, 1.2, [[atDoorL.x, atDoorL.z]], FACE.back);
  doors.L = [G1.t, G1.t + 1.2];
  G1.hold(G1.t + 1.2, 'stand');
  out(G2, 2.0, [[0.3, ZR + 1.4]], FACE.left);
  // R up the right side: round the open right door to the foot of the side, climb, over the edge
  const climbX = MTLB.W + 0.32, climbZ = 2.55;
  out(R, 2.8, [[0.65, ZR + 1.25], [climbX, ZR + 1.25], [climbX, climbZ]], FACE.left);
  doors.closeR = [R.t - 0.6, R.t + 0.4]; // the right door is pulled to behind them
  R.move(1.2, { y: 0.48, ground: true }, { gait: 'climb' });
  R.move(1.0, { x: 1.2, y: ROOF, z: climbZ, ground: false }, { pose: 'crouch', gait: 'none' });
  R.move(0.7, { x: 1.0 }, { pose: 'stand', gait: 'none' });
  const onRoof = (m, to, pose = 'stand', g = null) => m.move(walkTime(m.at, to, 1.0), { y: ROOF, ground: false, ...to }, { pose, grips: g });

  // the carrying places behind a rail: out of the open left door's sweep (its leaf stands out 0.9 m)
  const Cc = (XK) => ({ x: XK, y: 1.15, z: 5.3, yaw: 0, pitch: 0 });
  const C2 = (XK) => ({ x: XK, y: 1.55, z: 4.35, yaw: 0, pitch: 0.35 });
  const I = (XK) => ({ x: XK, y: 2.0, z: 3.6, yaw: 0, pitch: 0.25 });
  const side = (k) => (XS[k] < 0 ? 1 : -1); // the inboard side, where the roof man and the second man work
  const xRof = (k) => XS[k] + side(k) * 0.42;
  const xG1of = (k) => (Math.abs(XS[k]) > 0.7 ? XS[k] + side(k) * 0.15 : XS[k]); // behind the end, clear of the door
  const zEnd = (k, d) => at(rail(k, d), 0, -0.05, HALF + 0.03).z + 0.45; // R behind the end, pushing
  const endAt = (k, d) => at(rail(k, d), 0, -0.11, HALF + 0.03);
  const PULL = [0, 0.17, 0.88]; // where R's hands go on top of a container he draws back from beside it
  const zB = 2.25; // R beside a rail, out of the way of a neighbour still home (its end is at 2.0)
  const stepB = 0.9; // the first draw from beside it, then he steps back and draws it to D_REACH
  const pullAt = (k, d) => at(rail(k, d), ...PULL);
  const gripPull = (j, s) => grips(j, [['L', PULL[0], PULL[1], PULL[2] + s * 0.18, 'top'], ['R', PULL[0], PULL[1], PULL[2] - s * 0.18, 'top']]);
  let t = 0;

  // ---- A: the spent containers off, the inner rails first (the roof man then stands in a cleared
  // rail's place for an outer one); each is drawn back by the roof man and dragged away by one man on
  // the ground (an empty container is light), the two taking turns
  const inner = job.slots.filter((k) => k === 1 || k === 2), outer = job.slots.filter((k) => k === 0 || k === 3);
  const orderA = [...inner.sort((a, b) => b - a), ...outer.sort((a, b) => a - b)];
  const draggers = [G1, G2];
  orderA.forEach((k, n) => {
    const L = loads[k], s = side(k), xR = xRof(k);
    const G = draggers[n % 2];
    // R beside it, unlatches it and draws it back in two pulls
    const z1 = pullAt(k, 0).z + 0.45;
    onRoof(R, { x: xR, z: Math.max(zB, z1), h: sideFace(s) });
    R.hold(R.t + 0.5, 'carry', gripPull(k, s));
    railHold(L, k, R.t, 0);
    railTo(L, k, 1.2, 0, stepB);
    R.hold(L.t, 'carry', gripPull(k, s));
    R.move(0.6, { z: pullAt(k, stepB).z + 0.4 }, { pose: 'stand' });
    R.hold(R.t + 0.3, 'carry', gripPull(k, s));
    railHold(L, k, R.t, stepB);
    // the man behind is there with his hands up as it comes
    const eR = endAt(k, D_REACH);
    via(G, [[xG1of(k), Math.max(4.6, G.at.z)], [xG1of(k), eR.z + 0.36]], FACE.back);
    G.hold(Math.max(G.t, L.t + 0.2), 'stand');
    G.hold(Math.max(G.t + 0.5, L.t + 0.9), 'reachUp');
    railHold(L, k, G.t - 0.9, stepB);
    railTo(L, k, 0.9, stepB, D_REACH);
    R.hold(L.t, 'carry', gripPull(k, s));
    // he draws it down off the frame and back over the rear edge; its front end drops to the deck,
    // slides to the edge and down to the ground; he drags it to the pile beside the vehicle
    const XK = XS[k];
    railTo(L, k, 1.2, D_REACH, D_START);
    G.move(1.2, { z: endAt(k, D_START).z + 0.33 }, { pose: 'reachUp', grips: PUSH_END(k) });
    // (each pose from where its front end rests and the height of its rear end in his hands)
    const D1 = ends(XK, 2.8, ROOF + 0.17, 1.9);
    const D2 = ends(XK, ZR + 0.03, ROOF + 0.17, 1.62);
    const D3 = ends(XK - s * 0.2, ZR + 0.45, 0.2, 1.12, true);
    L.to(0.8, D1).to(1.0, D2).to(1.0, D3);
    G.hold(G.t + 0.3, 'reachUp', BEHIND(k));
    G.move(0.8, { z: at(D1, 0, 0, 0.98).z + 0.42 }, { pose: 'reachUp', grips: BEHIND(k) });
    G.move(1.0, { z: at(D2, 0, 0, 0.98).z + 0.42 }, { pose: 'carry', grips: BEHIND(k) });
    G.move(0.7, { x: D3.x, z: at(D3, 0, 0, 0.98).z + 0.45 }, { pose: 'carry', grips: BEHIND(k) });
    // dragged out to the pile, laid down
    const Pd = ends(PILE[k], PILE_Z - HALF + 0.25, 0.2, 1.12, true);
    const Pg = { x: PILE[k], y: 0.17, z: PILE_Z, yaw: 0, pitch: 0, ground: true };
    const lat = Math.hypot(Pd.x - D3.x, Pd.z - D3.z) / 0.7 + 0.3;
    L.to(lat, Pd, true).to(1.0, Pg);
    G.move(lat, { x: PILE[k], z: at(Pd, 0, 0, 0.98).z + 0.45 }, { pose: 'carry', grips: BEHIND(k) });
    G.move(1.0, { z: at(Pg, 0, 0, 0.98).z + 0.45 }, { pose: 'crouch', gait: 'none', grips: BEHIND(k) });
    G.move(0.6, { z: G.at.z }, { pose: 'stand', gait: 'none' });
    final[k] = 'ground';
    t = Math.max(t, L.t);
  });
  t = Math.max(t, R.t);

  // ---- B: the fresh ones, an outer rail before its inner neighbour (the roof man shoves an outer one
  // from the inner rail's place); the side the roof man is on first
  const lastSide = orderA.length ? side(orderA[orderA.length - 1]) : -1;
  const sideSlots = (sd) => job.slots.filter((k) => side(k) === sd).sort((a, b) => (Math.abs(XS[b]) - Math.abs(XS[a])));
  const orderB = [...sideSlots(lastSide), ...sideSlots(-lastSide)];
  let spare = 0;
  for (const k of orderB) {
    const jr = spare++;
    if (jr >= reserve) break;
    const XK = XS[k], s = side(k), xR = xRof(k), xG2 = XK + s * 0.4, xG1 = xG1of(k);
    const j = 4 + jr, F = loads[j], rj = RACK[jr];
    final[j] = 'rail';
    slotOf[j] = k;
    const rack = { x: rj[0], y: rj[1], z: RACK_Z, yaw: 0, pitch: 0 };
    const pulled = { x: rj[0], y: Math.max(1.0, rj[1]), z: RACK_Z + 2.42, yaw: 0, pitch: 0 };
    const fS = at(rail(k, D_START), 0, -0.17, -0.85), fI = at(I(XK), 0, -0.17, -0.85), gI = at(I(XK), 0, -0.17, -0.3);
    const zTop = (d) => at(rail(k, d), 0, 0.17, 0.75).z;
    const zR = (zTop(D_SIDE) + zTop(D_REACH)) / 2; // R beside it, hands on its top
    // G1 at the door, hands on its end; G2 to its inboard side
    const zPull = at(rack, 0, 0, 0.98).z + 0.45;
    via(G1, [[rj[0], Math.max(4.6, G1.at.z)], [rj[0], zPull]], FACE.back);
    const gP = at(pulled, 0, -0.17, -0.3);
    via(G2, [[rj[0] + s * 0.4, Math.max(4.9, G2.at.z)], [rj[0] + s * 0.4, gP.z]], sideFace(s));
    const t3 = Math.max(G1.t, G2.t - 1.5);
    G1.hold(t3, 'stand').hold(t3 + 0.4, 'carry', BEHIND(j));
    F.hold(t3 + 0.4).to(2.2, pulled, true);
    G1.move(2.2, { z: at(pulled, 0, 0, 0.98).z + 0.45 }, { pose: 'carry', grips: BEHIND(j) });
    G2.hold(Math.max(G2.t, F.t - 0.4), 'stand').hold(Math.max(G2.t, F.t) + 0.3, 'carry', UNDER(j, s, -0.3));
    G1.hold(G2.t, 'carry', BEHIND(j));
    F.hold(G2.t);
    // across and back behind its rail, at carrying height
    const lat = Math.max(1.2, Math.hypot(XK - rj[0], 5.3 - pulled.z) / 0.65);
    F.to(lat, Cc(XK), true);
    G1.move(lat, { x: xG1, z: at(Cc(XK), 0, 0, 0.98).z + 0.45 }, { pose: 'carry', grips: BEHIND(j) });
    G2.move(lat, { x: xG2, z: at(Cc(XK), 0, -0.17, -0.3).z }, { pose: 'carry', grips: UNDER(j, s, -0.3) });
    // R kneels at the rear of the roof beside the rail as its front comes up
    onRoof(R, { x: xR, z: fI.z, h: sideFace(s) });
    const t4 = Math.max(F.t, R.t + 1.1 - 2.2);
    R.hold(t4 + 2.2 - 1.1, 'stand');
    R.move(0.6, { z: fI.z }, { pose: 'crouch', gait: 'none' });
    F.hold(t4);
    G1.hold(t4, 'carry', BEHIND(j));
    G2.hold(t4, 'carry', UNDER(j, s, -0.3));
    // its front up over the rear edge: G2 lifts it high, G1 walks it in
    F.to(1.1, C2(XK)).to(1.1, I(XK));
    G1.move(1.1, { z: at(C2(XK), 0, 0, 0.98).z + 0.45 }, { pose: 'carry', grips: BEHIND(j) }).move(1.1, { z: at(I(XK), 0, 0, 0.98).z + 0.42 }, { pose: 'reachUp', grips: BEHIND(j) });
    G2.move(1.1, { z: at(C2(XK), 0, -0.17, -0.3).z }, { pose: 'reachUp', grips: UNDER(j, s, -0.3) }).move(1.1, { z: gI.z }, { pose: 'reachUp', grips: UNDER(j, s, -0.3) });
    R.hold(F.t - 0.5, 'crouch').hold(F.t, 'crouch', UNDER(j, s, -0.85));
    // R takes it, stands and lifts the front onto the rail's lower end as G1 walks it in; G2 lets go
    F.to(1.3, rail(k, D_START));
    R.move(0.5, { z: R.at.z }, { pose: 'carry', gait: 'none', grips: UNDER(j, s, -0.85) });
    R.move(0.8, { z: fS.z }, { pose: 'carry', grips: UNDER(j, s, -0.85) });
    G1.move(1.3, { z: at(rail(k, D_START), 0, 0, 0.98).z + 0.42 }, { pose: 'reachUp', grips: BEHIND(j) });
    G2.move(1.0, { z: G2.at.z + 0.7 }, { pose: 'stand' });
    // G1 changes his grip to its end; R lets go and steps back beside it
    G1.hold(F.t + 0.4, 'reachUp', PUSH_END(j));
    railHold(F, k, F.t + 0.4, D_START);
    R.move(0.8, { z: zR }, { pose: 'stand' });
    // G1 pushes it up the rail as far as he reaches
    const eR = endAt(k, D_REACH);
    railTo(F, k, 1.3, D_START, D_REACH);
    G1.move(1.3, { z: eR.z + 0.36 }, { pose: 'reachUp', grips: PUSH_END(j) });
    R.hold(F.t - 0.3, 'stand').hold(F.t, 'carry', TOP(j, s, 0.75));
    // R shoves it on from beside it while G1 steps back
    railTo(F, k, 1.2, D_REACH, D_SIDE);
    R.hold(F.t, 'carry', TOP(j, s, 0.75));
    G1.move(0.9, { z: G1.at.z + 0.7 }, { pose: 'stand', face: FACE.back });
    // round behind its end and home, then the latch
    R.move(0.8, { x: XK, z: zEnd(k, D_SIDE), h: FACE.back }, { pose: 'stand' });
    R.hold(R.t + 0.25, 'carry', PUSH_END(j));
    railHold(F, k, R.t, D_SIDE);
    railTo(F, k, 1.1, D_SIDE, 0);
    R.move(1.1, { z: zEnd(k, 0) }, { pose: 'carry', grips: PUSH_END(j) });
    R.hold(R.t + 0.5, 'carry', grips(j, [['R', 0.0, 0.17, 0.95, 'top']]));
    railHold(F, k, R.t, 0);
    R.move(0.6, { z: R.at.z + 0.35 }, { pose: 'stand', gait: 'none' });
    t = R.t;
  }
  const work = t; // the last container latched: the sim may count the rounds from here
  // ---- everyone back in: R down the right side, all through the right rear door
  R.move(walkTime(R.at, { x: 1.0, z: climbZ }, 1.0), { x: 1.0, y: ROOF, z: climbZ, h: FACE.right, ground: false });
  R.move(0.7, { x: 1.2 }, { pose: 'crouch', gait: 'none', face: FACE.left });
  R.move(1.0, { x: climbX, y: 0.48, z: climbZ, ground: true }, { pose: 'climb', gait: 'none' });
  R.move(1.2, { y: 0, ground: true }, { gait: 'climb' });
  via(R, [[climbX, ZR + 1.3]], FACE.back);
  // G1 shuts the left door, G2 opens the right one for them
  const tIn = Math.max(t, G1.t, G2.t);
  via(G1, [[G1.at.x, Math.max(G1.at.z, 4.5)], [atDoorL.x, atDoorL.z]], FACE.back);
  G1.hold(Math.max(G1.t, tIn), 'stand');
  doors.closeL = [G1.t, G1.t + 1.1];
  G1.hold(G1.t + 1.1, 'stand');
  via(G2, [[G2.at.x, Math.max(G2.at.z, 4.8)], [0.3, ZR + 1.45]], FACE.back);
  doors.openR2 = [Math.max(G2.t, tIn), Math.max(G2.t, tIn) + 1.0];
  const goIn = (m, t0, pts) => {
    m.hold(t0, 'stand');
    via(m, [...pts, [0.47, ZR + 0.75]], FACE.back);
    m.move(1.0, { x: 0.47, y: 0.55, z: ZR - 0.6, ground: false, h: FACE.back }, { gait: 'stoop' });
    m.hide(Infinity);
  };
  goIn(G2, doors.openR2[1], []);
  goIn(G1, Math.max(G1.t, doors.openR2[1] + 0.8), [[0.3, ZR + 1.3]]);
  goIn(R, Math.max(R.t, doors.openR2[1] + 1.6), [[0.65, ZR + 1.3]]);
  const board = Math.max(...[R, G1, G2].map((m) => m.segs[m.segs.length - 1].t0));
  doors.closeR2 = [board + 0.1, board + 1.1];
  const end = board + 1.2;
  loads.forEach((L, i) => {
    if (final[i] === 'rail') railHold(L, slotOf[i], end, 0);
    else if (L.t < end && L.t !== Infinity) L.hold(end);
  });
  return { loads, men: [R, G1, G2], lidOn, final, work, board, end, doors };
}

// ---------------------------------------------------------------- the scene

const _t = new THREE.Matrix4();
const kOf = (tp, [a, b]) => (b > a ? smooth((tp - a) / (b - a)) : 0);

export default {
  create(ctx) {
    const group = new THREE.Group();
    group.name = 'reload-strela';
    ctx.group.add(group);
    const cans = new Containers(group);
    cans.show(false);
    const doorsIn = openings(group);
    const crew = [
      new Hand(group, { headgear: 'helmet', vest: 'webbing', skin: 1 }), // on the roof
      new Hand(group, { headgear: 'cap', skin: 0 }), // behind
      new Hand(group, { headgear: 'cap', skin: 2 }), // beside
    ];
    for (const c of crew) c.hide();
    const state = { group, cans, doorsIn, crew, frame: new VFrame(), play: null, ground: [], elW: new THREE.Matrix4() };
    // a container on its rail turns and rises with the launcher: the elevation pivot's world matrix and
    // the slot's place on it, d back from home
    state.rail = (seg, k, out) => {
      const a = seg.arg;
      return out.copy(state.elW).multiply(_t.makeTranslation(XS[a.slot], 0, a.d0 + (a.d1 - a.d0) * k));
    };
    return state;
  },

  start(ctx, state, job) {
    const rig = ctx.rig(job.part);
    if (!rig?.containers || !rig.pivots.elevation) return null;
    if (state.play) this.stop(ctx, state, state.play);
    const p = ctx.unit.parts[job.part];
    state.frame.set(p.pos, p.heading);
    // the spares: the sim's reserve before this job takes its rounds from it (at most four on the rack)
    const reserve = Math.min(4, Math.max(job.slots.length, ctx.unit.weapons.stock?.['9M37']?.reserve ?? 4));
    const pl = plan(job, reserve);
    for (const L of pl.loads) for (const sg of L.segs) if (sg.fn === 'rail') sg.fn = state.rail;
    // when a spare leaves the rack (it is drawn on the rack only while the left door stands open)
    pl.leave = pl.loads.map((L) => L.segs.find((sg) => sg.a !== sg.b)?.t0 ?? Infinity);
    pl.job = job;
    pl.part = job.part;
    pl.rig = rig;
    // a job shorter than the natural pace squeezes the plan so the last container is home when the sim
    // counts (the crew climbs down and goes in after, as the launcher is laid again: the roof man is
    // then behind its sweep); a longer one keeps the pace and the launcher waits at its loading pose
    pl.scale = Math.max(1, pl.work / Math.max(1, job.dur - 0.3));
    pl.handed = false;
    state.play = pl;
    state.ground.length = 0;
    // the launcher's own containers and lids give way to the scene's
    rig.containers.visible = false;
    for (const l of rig.lids ?? []) l.visible = false;
    state.cans.show(true);
    state.crew.forEach((h, i) => {
      h.plan = pl.men[i];
      h.hide();
    });
    for (const g of state.doorsIn) {
      g.matrix.copy(state.frame.m);
      g.matrixWorldNeedsUpdate = true;
    }
    return pl;
  },

  update(ctx, state, play, t, job) {
    if (state.play !== play) return false;
    const rig = play.rig, d = play.doors;
    const tp = t * play.scale; // plan time
    // the rear doors
    const dL = kOf(tp, d.L) * (1 - kOf(tp, d.closeL));
    const dR = kOf(tp, d.R) * (1 - kOf(tp, d.closeR)) + kOf(tp, d.openR2) * (1 - kOf(tp, d.closeR2));
    rig.pivots.doorRL.rotation.y = -1.75 * dL;
    rig.pivots.doorRR.rotation.y = 1.75 * dR;
    state.doorsIn[0].visible = dL > 0.01;
    state.doorsIn[1].visible = dR > 0.01;
    // the containers (from the sim's count on the launcher draws its own, whatever is on its rails)
    rig.pivots.elevation.updateWorldMatrix(true, false);
    state.elW.copy(rig.pivots.elevation.matrixWorld);
    const handed = job == null || t >= play.job.dur;
    if (handed && !play.handed) this.handBack(ctx, state, play);
    for (let i = 0; i < N; i++) {
      const L = play.loads[i];
      let on = L.eval(tp, state.frame);
      if (on && handed && play.final[i] === 'rail') on = false;
      if (on && i >= 4 && tp < play.leave[i] && dL < 0.02) on = false; // a spare behind the shut door
      state.cans.set(i, on ? L.m : null, play.lidOn[i]);
    }
    state.cans.commit();
    // the crew
    for (const h of state.crew) if (h.plan) h.eval(tp, state.frame, play.loads);
    if (tp >= play.end && handed) {
      this.finish(ctx, state, play);
      return false;
    }
    return true;
  },

  // the sim has counted the rounds: the launcher shows its own containers and lids again
  handBack(ctx, state, play) {
    play.handed = true;
    const rig = play.rig;
    rig.containers.visible = true;
    const loaded = ctx.loaded(play.part);
    (rig.lids ?? []).forEach((l, k) => (l.visible = loaded[k] ?? true));
  },

  // the play is over: the spent containers stay on the ground, the rest goes
  finish(ctx, state, play) {
    if (!play.handed) this.handBack(ctx, state, play);
    state.ground.length = 0;
    play.loads.forEach((L, i) => {
      if (play.final[i] === 'ground' && L.visible) state.ground.push(L.m.clone());
    });
    this.park(play);
    state.play = null;
  },

  park(play) {
    const rig = play?.rig;
    if (rig?.pivots.doorRL) rig.pivots.doorRL.rotation.y = 0;
    if (rig?.pivots.doorRR) rig.pivots.doorRR.rotation.y = 0;
  },

  stop(ctx, state, play) {
    if (!play) return;
    if (!play.handed) this.handBack(ctx, state, play);
    this.park(play);
    for (const g of state.doorsIn) g.visible = false;
    for (const h of state.crew) {
      h.plan = null;
      h.hide();
    }
    state.play = null;
  },

  // between reloads: the spent containers lying beside the vehicle, nothing else
  idle(ctx, state) {
    if (state.play) return;
    for (const g of state.doorsIn) g.visible = false;
    for (const h of state.crew) h.hide();
    const n = state.ground.length;
    state.cans.show(n > 0);
    if (!n) return;
    for (let i = 0; i < N; i++) state.cans.set(i, i < n ? state.ground[i] : null, false);
    state.cans.commit();
  },

  reset(ctx, state) {
    if (state.play) this.stop(ctx, state, state.play);
    state.ground.length = 0;
    state.cans.show(false);
    const rig = ctx.rig(0);
    if (rig?.containers) rig.containers.visible = true;
    if (rig?.pivots.doorRL) rig.pivots.doorRL.rotation.y = 0;
    if (rig?.pivots.doorRR) rig.pivots.doorRR.rotation.y = 0;
  },
};
// the plan alone (pure, runs in Node), for checking the timings headless
export { plan as planStrela };
