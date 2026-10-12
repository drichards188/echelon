import * as THREE from 'three';
import { buildVehicle } from '../../models/vehicles.js';
import { U, CONTAINER, containerParts } from '../../models/v/t9t244.js';
import { GM355 } from '../../models/v/gm355.js';
import { Parts, vehicleMats, box } from '../../models/kit.js';
import { SYSTEMS } from '../../sim/systems.js';
import { Frame, Lane, Timeline, Crewman, placeOnGround, smooth, ramp, ease } from '../reload.js';
import { CrewRoute, unwrap, wrapPi, keyPose, layKeys } from './lifts.js';

// Tor-M2: the 9T244 transloader lowers the rounds' containers into the vertical cells one by one
// (refs/tor/README.md section 7; photo tor_m2_06: the Ural backed up to the Tor's nose, the turret round
// as for the march with its search antenna folded and the tracking antenna laid back, a container
// hanging nose up from the crane over the turret roof, a crewman on the roof guiding it in). The truck
// reverses up to the Tor's nose and puts its rear stabilizers down; the turret is laid to the loading
// pose (SYSTEMS.tor.reloadPose: round, antenna back); its search antenna stops, turns to the front and
// folds. The crane takes a container from the bed by its top eye (it swings up off the bed about its
// foot until it hangs), carries it round over the left side, high enough to clear the turret, and
// lowers it into the cell, whose lid opens for it and shuts after. Crew: the crane operator on the ground
// at the truck's left rear with his control box, and a Tor crewman who comes round from behind the
// Tor, climbs its side onto the turret roof and steadies each container into its cell from the other
// row, and climbs down before the job ends (the turret moves then). Reconstructed: the order of the
// cells, the lids opening one at a time, the crewman's way up, the containers lying on the bed (none is
// visible loaded in the photos). Then the stabilizers come up and the truck drives off forward.

const GAP = 0.3; // the truck's tail to the Tor's nose
const Z244 = GM355.nose[0] - GAP - U.rear; // the truck's origin, Tor frame (same heading, on its centre line)
const APPROACH = 32;
const ARRIVE = 11, BRAKE = 0.6, LEGS = 2.2, CLEAR = 2.6, STOW = 3.6, LEAVE = 13;
const SLEW = 1.6; // rad/s nominal: the swings are quick, the lowering into the cell takes its time
const CARRY = 6.95; // hook height while carrying: the container's foot clears the turret and the folded antenna
const CABLE = 0.45;
const SEAT = 0.04; // a seated container's eye over its cell's top: the flange sits just inside, under the shut lid
const LC = CONTAINER.L + CONTAINER.top; // eye to foot
const BED_ORDER = [2, 1, 3, 0, 4, 5, 6, 7]; // containers taken from the bed nearest the crane first
const N = 8;

// ---------------------------------------------------------------- containers

let CGEO = null;
function containerGeometry() {
  if (CGEO) return CGEO;
  const P = new Parts(vehicleMats('green'));
  containerParts(P);
  const g = new THREE.Group();
  P.build(g, { dirt: 0.05, y0: 3 });
  CGEO = g.children.map((m) => ({ geometry: m.geometry, material: m.material }));
  return CGEO;
}

const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
class Containers {
  constructor(group) {
    this.meshes = containerGeometry().map(({ geometry, material }) => {
      const m = new THREE.InstancedMesh(geometry, material, N);
      m.castShadow = m.receiveShadow = true;
      m.frustumCulled = false;
      for (let i = 0; i < N; i++) m.setMatrixAt(i, ZERO);
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

// ---------------------------------------------------------------- props

const _m = new THREE.Matrix4(), _inv = new THREE.Matrix4(), _p = new THREE.Vector3(), _h = new THREE.Vector3(), _d = new THREE.Vector3();
const _q = new THREE.Quaternion(), _s1 = new THREE.Vector3(1, 1, 1), _o = { x: 0, z: 0, heading: 0 }, DOWN = new THREE.Vector3(0, -1, 0), POSE = {};
const _hl = new THREE.Vector3(), _hr = new THREE.Vector3();

function createSet(ctx) {
  const t = buildVehicle('9t244');
  ctx.group.add(t.root);
  t.root.visible = false;
  const pendant = new THREE.Mesh(box(0.2, 0.12, 0.28), vehicleMats('green').dark);
  pendant.castShadow = true;
  const crew = [
    new Crewman(ctx.group, { headgear: 'cap', skin: 1 }), // crane operator
    new Crewman(ctx.group, { headgear: 'helmet', vest: 'webbing' }), // on the turret roof
  ];
  crew[0].fig.anchors.carry.add(pendant);
  pendant.position.set(0, 0.04, 0);
  const cans = new Containers(ctx.group);
  return { t, crew, cans, play: null };
}

function park(set) {
  set.t.root.visible = false;
  set.t.setCrane(set.t.craneTravel);
  set.t.setOutriggers(0);
  set.t.pivots.doorL.rotation.y = set.t.pivots.doorR.rotation.y = 0;
  for (const c of set.crew) c.hide();
  for (let i = 0; i < N; i++) set.cans.set(i, null);
  set.cans.commit();
  set.cans.show(false);
}

// the Tor's cell nodes (tor.js: 'cell' + i on the turret, the cap's foot)
const cellNode = (rig, i) => rig.pivots.turret.getObjectByName('cell' + i);

// ---------------------------------------------------------------- planning

/**
 * Plan a job: a container per slot from the bed (nearest the crane first) into the cell, in the job's
 * order; the crane's keys, when each lid opens and shuts, the crewman's places on the roof.
 */
function plan(ctx, set, job) {
  const u = ctx.unit, p = u.parts[0], rig = ctx.rig(0), T = set.t;
  const frame = new Frame(p.pos, p.heading);
  // the truck at its work place, and the cells' seats with the turret in the loading pose, in its space
  frame.xz(0, Z244, _p);
  placeOnGround(T.root, _p.x, _p.z, frame.heading, U.axles[0], U.axles[2], U.track, ctx.ground);
  T.root.updateMatrixWorld(true);
  _inv.copy(T.root.matrixWorld).invert();
  const tur = rig.pivots.turret, a0 = tur.rotation.y;
  tur.rotation.y = SYSTEMS.tor.reloadPose.az;
  rig.root.updateMatrixWorld(true);
  const seat = (i) => cellNode(rig, i).getWorldPosition(new THREE.Vector3()).applyMatrix4(_inv).add(new THREE.Vector3(0, SEAT, 0));
  const lifts = job.slots.slice(0, N).map((slot, k) => {
    const b = BED_ORDER[k];
    const a = T.anchors.cargo[b];
    return { k, slot, bed: b, E: a.position.clone(), C: seat(slot), cellX: cellNode(rig, slot).getWorldPosition(new THREE.Vector3()).applyMatrix4(_inv).x };
  });
  tur.rotation.y = a0;
  rig.root.updateMatrixWorld(true);
  const st = u.weapons.stock?.['9M338'] ?? u.weapons.missiles;
  const shown = Math.max(lifts.length, Math.min(N, st?.reserve ?? N));
  const dur = job.dur;
  // the crewman on the roof must be off the hull before the job ends (the turret is free then): the crane
  // lets go of the last container in time for him to walk back to his first place and climb down
  const roofer = roofRoute(ctx, frame, lifts);
  const tl = new Timeline().add('arrive', ARRIVE, true).add('brake', BRAKE, true).add('legs', LEGS, true).add('work', lifts.length * 9).add('clear', CLEAR, true).fit(0, dur);
  const cells = [];
  for (let i = 0; i < N; i++) cells.push(cellNode(rig, i));
  const play = { frame, lifts, shown, tl, dur, cells, roofer };
  play.keys = craneTrack(set, play);
  play.lane = new Lane(frame, [[0, Z244 - APPROACH], [0, Z244]]);
  play.routes = crewRoutes(ctx, set, play);
  play.leave = Math.max(dur + STOW + 0.4, play.routes.a.backEnd + 1.2);
  play.end = play.leave + LEAVE;
  return play;
}

// ---------------------------------------------------------------- the crane

// Keys of the crane's joints for the hook at given points (truck space), laid between the stabilizers
// going down and the end of the job; the stow after it. The carries go round over the left side.
function craneTrack(set, play) {
  const T = set.t, { tl, lifts } = play;
  const keys = [];
  const at = (dt, q, tag = null) => keys.push({ dt, pose: { slew: q.slew, boom: q.boom, jib: q.jib, ext: q.ext, cable: q.cable }, tag });
  const solve = (x, y, z, cable = CABLE) => T.solveCrane(_p.set(x, y, z), {}, cable);
  const slewOf = (x, z) => Math.atan2(-(x - U.col.x), -(z - U.col.z));
  at(0, T.craneTravel, 'travel');
  // the slews are set explicitly: loaded, the crane turns left round to the turret; empty, back the same
  // way (a key's slew is the copy of its angle nearest the reference given)
  const key = (dt, q, ref, tag) => { q.slew = unwrap(q.slew, ref); at(dt, q, tag); return q.slew; };
  const L0 = lifts[0];
  let bed = key(2.4, solve(L0 ? L0.E.x : 0, 4.2, L0 ? L0.E.z : 2.5), 0, 'unfold');
  for (const L of lifts) {
    const { E, C } = L;
    const sBed = unwrap(slewOf(E.x, E.z), bed), sCell = unwrap(slewOf(C.x, C.z), sBed + Math.PI);
    key(0.8 + Math.abs(sBed - keys[keys.length - 1].pose.slew) / SLEW, solve(E.x, E.y + 0.7, E.z), sBed, 'reach');
    key(0.8, solve(E.x, E.y + 0.02, E.z), sBed, 'down');
    key(0.5, solve(E.x, E.y + 0.02, E.z), sBed, 'grip');
    key(1.6, solve(E.x, E.y + LC + 0.12, E.z), sBed, 'tilt');
    key(0.8, solve(E.x, CARRY, E.z), sBed, 'up');
    // half way round over the left side at the mean reach
    const r0 = Math.hypot(E.x - U.col.x, E.z - U.col.z), r1 = Math.hypot(C.x - U.col.x, C.z - U.col.z), am = (sBed + sCell) / 2, rm = (r0 + r1) / 2;
    const half = 0.4 + Math.abs(sCell - sBed) / SLEW / 2;
    key(half, solve(U.col.x - Math.sin(am) * rm, CARRY + 0.15, U.col.z - Math.cos(am) * rm), am, 'carry');
    key(half, solve(C.x, CARRY, C.z), sCell, 'over');
    key(2.6, solve(C.x, C.y, C.z), sCell, 'lower');
    key(0.6, solve(C.x, C.y, C.z), sCell, 'release');
    key(0.8, solve(C.x, C.y + 1.3, C.z), sCell, 'clear');
    // back round the left, empty, over the bed
    key(half, solve(U.col.x - Math.sin(am) * rm, CARRY - 1.2, U.col.z - Math.cos(am) * rm), am, 'back');
    bed = sBed;
  }
  // back over the truck before the job ends (the turret moves then)
  key(1.6, solve(U.col.x + 0.2, 4.6, 1.6), bed, 'home');
  // laid from the stabilizers to the job's end, squeezed if needed so the last container is let go before
  // the crewman on the roof has to start back (he walks to his first place, 1.4 s, and climbs down)
  const g = tl.at('legs'), c = tl.at('clear'), t0 = g.start + 0.8;
  let t1 = c.end - 0.2;
  const total = keys.reduce((a, k) => a + k.dt, 0);
  let upTo = 0, before = 0;
  for (const k of keys) { upTo += k.dt; if (k.tag === 'release') before = upTo; }
  const r = play.roofer.route, latest = play.dur - 0.3 - (r.total - r.legs[0].d) - 1.4 - 0.4;
  if (before > 0) t1 = Math.min(t1, t0 + ((latest - t0) * total) / before);
  layKeys(keys, t0, t1);
  const last = keys[keys.length - 1].pose, tr = T.craneTravel;
  keys.push({ t: play.dur + STOW - 0.4, pose: { slew: unwrap(tr.slew, last.slew), boom: tr.boom, jib: tr.jib, ext: tr.ext, cable: tr.cable }, tag: 'stowed' });
  // grip, upright (hanging free), release
  let li = -1;
  keys.forEach((k, i) => {
    if (k.tag === 'grip') lifts[++li].tGrip = k.t - 0.5 * (k.t - keys[i - 1].t);
    if (k.tag === 'tilt') lifts[li].tHang = k.t;
    if (k.tag === 'over') lifts[li].tOver = k.t;
    if (k.tag === 'release') lifts[li].tRelease = k.t - 0.5 * (k.t - keys[i - 1].t);
  });
  return keys;
}

// ---------------------------------------------------------------- crew

// The Tor crewman's way onto the turret roof: from behind the Tor along its right side, up its side and
// the turret's onto the roof, to his first place (beside the first cell, on the other row). Timed later.
function roofRoute(ctx, frame, lifts) {
  const g0 = ctx.ground(frame.pos.x, frame.pos.z);
  const W = (x, y, z) => { const q = frame.xz(x, z, { x: 0, z: 0 }); q.y = g0 + y; return q; };
  const face = (dx, dz) => frame.heading + Math.atan2(-dx, -dz);
  const roofY = 3.51; // standing on the shut lids
  const placeX = (L) => (L.cellX > 0 ? -0.3 : 0.3);
  // his places on the roof: beside each cell from the other row, in the Tor's frame (truck z + Z244)
  const roof = lifts.map((L) => ({ x: placeX(L), z: L.C.z + Z244 }));
  const climbZ = -0.25, r0 = roof[0] ?? { x: 0.3, z: climbZ };
  const route = new CrewRoute([
    { to: W(2.4, 0, GM355.rear + 1.4) },
    { to: W(2.15, 0, climbZ), mode: 'walk' },
    { to: W(1.95, 2.25, climbZ), mode: 'climb', face: face(-1, 0) },
    { to: W(1.82, 2.97, climbZ), mode: 'climb', face: face(-1, 0) },
    { to: W(1.25, 2.97, climbZ), mode: 'walk' },
    { to: W(0.72, roofY, climbZ), mode: 'climb', face: face(-1, 0) },
    { to: W(r0.x, roofY, r0.z), mode: 'walk' },
  ], 0, 0, { climb: 0.75 });
  return { route, roof, roofY };
}

function crewRoutes(ctx, set, play) {
  const { frame, tl, dur, lifts } = play;
  const g0 = ctx.ground(frame.pos.x, frame.pos.z);
  const W = (x, y, z) => { const q = frame.xz(x, z, { x: 0, z: 0 }); q.y = g0 + y; return q; };
  const face = (dx, dz) => frame.heading + Math.atan2(-dx, -dz);
  const stop = tl.at('legs').start;
  // the operator: out of the left door, back along the truck to its left rear
  const zT = (z) => Z244 + z; // truck z to the Tor's frame (the truck on the centre line, same heading)
  const a = new CrewRoute([
    { to: W(-U.cab.hw - 0.45, 0, zT(U.cab.zf + 0.6)) },
    { to: W(-1.75, 0, zT(U.cab.zf + 1.4)), mode: 'walk' },
    { to: W(-1.85, 0, zT(2.7)), mode: 'walk' },
  ], stop + 0.6, dur + STOW - 0.6);
  // the crewman on the roof (roofRoute): he sets out at once and is off the hull 0.3 s before the job ends
  const { route: b, roof, roofY } = play.roofer;
  b.t0 = 2.5;
  b.tBack = Math.max(b.t0 + b.total, dur - 0.3 - (b.total - b.legs[0].d));
  b.backEnd = b.tBack + b.total;
  // the same places as world points (made once: the update allocates nothing)
  const roofW = roof.map((r) => W(r.x, roofY, r.z));
  return { a, b, roof, roofW, roofY, W, face };
}

// ---------------------------------------------------------------- the scene

export default {
  create(ctx) {
    const set = createSet(ctx);
    park(set);
    return { set };
  },

  start(ctx, state, job) {
    const set = state.set, rig = ctx.rig(0);
    if (!rig?.setHatch || !rig.pivots.turret || !cellNode(rig, 0)) return null;
    if (set.play) this.stop(ctx, state, set.play);
    const play = plan(ctx, set, job);
    play.set = set;
    play.job = job;
    play.handed = false;
    play.ant = null;
    set.play = play;
    for (let i = 0; i < N; i++) set.t.setLoaded(i, BED_ORDER.indexOf(i) < play.shown);
    set.t.setCrane(set.t.craneTravel);
    set.t.setOutriggers(0);
    set.t.root.visible = true;
    set.cans.show(true);
    return play;
  },

  update(ctx, state, play, t, job) {
    const set = play.set;
    if (set.play !== play) return false;
    const T = set.t, rig = ctx.rig(0), { tl, dur } = play;
    // ---- the truck: reversing up to the Tor's nose, stood, driven off forward after the job
    const L = play.lane.length;
    const s = t < play.leave ? L * ease(ramp(t, 0, ARRIVE)) : L * (1 - ease(ramp(t, play.leave, play.leave + LEAVE)));
    play.lane.at(s, _o);
    placeOnGround(T.root, _o.x, _o.z, _o.heading + Math.PI, U.axles[0], U.axles[2], U.track, ctx.ground);
    T.setWheels(-s, 0);
    // ---- stabilizers, doors
    const g = tl.at('legs');
    T.setOutriggers(ramp(t, g.start, g.end) * (1 - ramp(t, dur + STOW - 1.6, dur + STOW + 0.2)));
    const a = play.routes.a;
    const door = Math.max(smooth(t, a.t0 - 0.5, a.t0) * (1 - smooth(t, a.t0 + 1.6, a.t0 + 2.4)), smooth(t, a.backEnd - 1.6, a.backEnd - 1.0) * (1 - smooth(t, a.backEnd + 0.2, a.backEnd + 1.0)));
    T.pivots.doorL.rotation.y = -1.15 * door;
    // ---- crane
    T.setCrane(keyPose(play.keys, t, POSE));
    T.root.updateMatrixWorld(true);
    // ---- lids: each cell's opens as its container comes over, shuts after it is in
    for (const Lf of play.lifts) {
      const v = play.handed ? 0 : smooth(t, Lf.tOver - 1.6, Lf.tOver - 0.6) * (1 - smooth(t, Lf.tRelease + 0.6, Lf.tRelease + 1.6));
      rig.setHatch(Lf.slot, v);
    }
    // ---- containers
    this.containers(ctx, set, play, t);
    // ---- the search antenna: stopped, to the front, folded; up again after the job
    this.antenna(ctx, play, t);
    // ---- crew
    this.crew(ctx, set, play, t);
    if (!play.handed && t >= dur) play.handed = true; // the rig shows the rounds' caps from now on
    if (t >= play.end) {
      this.release(ctx, play);
      park(set);
      set.play = null;
      return false;
    }
    return true;
  },

  // each lift's container: on the bed (the truck's own), swinging up off the bed about its foot, hanging
  // from the hook, down in its cell (until the rig shows the round's cap)
  containers(ctx, set, play, t) {
    const T = set.t, rig = ctx.rig(0);
    const hook = T.anchors.craneHook;
    hook.updateWorldMatrix(true, false);
    _h.setFromMatrixPosition(hook.matrixWorld);
    _inv.copy(T.root.matrixWorld).invert();
    for (const L of play.lifts) {
      T.setLoaded(L.bed, t < L.tGrip);
      let m = null;
      if (t >= L.tGrip && t < L.tRelease) {
        // in the truck's space: the eye on the hook, the foot on the bed until it hangs free
        _p.copy(_h).applyMatrix4(_inv);
        const dy = _p.y - L.E.y;
        if (t < L.tHang && dy < LC) {
          _d.set(0, L.E.y - _p.y, -Math.sqrt(Math.max(0, LC * LC - dy * dy))).normalize();
          _q.setFromUnitVectors(DOWN, _d);
        } else _q.identity();
        m = _m.compose(_p, _q, _s1).premultiply(T.root.matrixWorld);
      } else if (t >= L.tRelease && !play.handed) {
        const c = play.cells[L.slot];
        c.updateWorldMatrix(true, false);
        m = _m.makeTranslation(0, SEAT, 0).premultiply(c.matrixWorld);
      }
      set.cans.set(L.k, m);
    }
    set.cans.commit();
  },

  // The search antenna: UnitViews spins it with the sweep (and keeps it raised) before this runs. From
  // the job's start it runs down to a stop, turns to the front and folds; after the job it unfolds and
  // the spin is handed back (UnitViews takes it up from where it stands, as when an emitter comes on).
  antenna(ctx, play, t) {
    const rig = ctx.rig(0), ant = rig.pivots.searchRadar;
    if (!ant || !rig.setDeploy) return;
    if (play.ant?.done) return;
    if (!play.ant) play.ant = { a0: ant.rotation.y, t0: t, w: (-Math.PI * 2) / SYSTEMS.tor.search.period };
    const A = play.ant, Tdn = 1.5;
    const tau = Math.min(Tdn, Math.max(0, t - A.t0));
    const stop = A.a0 + (A.w * Tdn) / 2, park = stop + wrapPi(0 - stop);
    ant.rotation.y = A.a0 + A.w * (tau - (tau * tau) / (2 * Tdn)) + (park - stop) * smooth(t, A.t0 + Tdn, A.t0 + Tdn + 1.4);
    const fold = smooth(t, A.t0 + Tdn + 1.4, A.t0 + Tdn + 4.4) * (1 - smooth(t, play.dur + 0.6, play.dur + 3.6));
    rig.setDeploy(1 - fold);
    if (t >= play.dur + 3.6) this.release(ctx, play);
  },

  // hand the antenna back to UnitViews: raised, and its spin taken up from where it stands
  release(ctx, play) {
    const rig = ctx.rig(0);
    if (!play.ant || play.ant.done || !rig?.setDeploy) return;
    play.ant.done = true;
    rig.setDeploy(rig.deployed ?? 1);
    if (rig.spin) {
      rig.spin.a = rig.pivots.searchRadar.rotation.y;
      rig.spin.on = false;
    }
  },

  crew(ctx, set, play, t) {
    const [a, b] = set.crew, { routes, lifts } = play;
    const hookW = set.t.anchors.craneHook.getWorldPosition(_p);
    // the operator at the truck's rear with his control box
    const pa = routes.a.pose(a, t);
    if (pa) a.at(pa.x, pa.z, Crewman.facing(pa.x, pa.z, hookW.x, hookW.z), 'operate', t * 0.3, pa.y);
    // the crewman: on the roof he moves from cell to cell along the rows, reaches for each container as
    // it comes down into its cell
    const pb = routes.b.pose(b, t);
    if (!pb || !lifts.length) return;
    let i = 0;
    while (i < lifts.length - 1 && t > lifts[i].tRelease + 0.3) i++;
    const cur = routes.roofW[i], first = routes.roofW[0];
    // before the route walks him down he goes back to the place it ends at (the first)
    if (t > routes.b.tBack - 1.4) {
      const k = ramp(t, routes.b.tBack - 1.4, routes.b.tBack - 0.1);
      if (k < 1 && cur !== first) b.walk(cur, first, k, 'walk', cur.y, first.y);
      else b.at(first.x, first.z, b.root.rotation.y, 'stand', 0, first.y);
      return;
    }
    const from = routes.roofW[Math.max(0, i - 1)], to = cur;
    const t0 = i > 0 ? lifts[i - 1].tRelease + 0.3 : -1, k = i > 0 ? ramp(t, t0, t0 + 1.2) : 1;
    if (k < 1) { b.walk(from, to, k, 'walk', from.y, to.y); return; }
    const L = lifts[i], cell = play.cells[L.slot].getWorldPosition(_d);
    b.at(to.x, to.z, Crewman.facing(to.x, to.z, cell.x, cell.z), 'stand', t * 0.5, to.y);
    // his hands on the container as it comes down into the cell: up at its foot while that is over his
    // head, then on its side at chest height (crew.js reach, root space: he faces it, 0.68 m away)
    if (t > L.tOver - 0.3 && t < L.tRelease + 0.15) {
      const foot = hookW.y - LC - to.y, k = smooth(t, L.tOver - 0.3, L.tOver + 0.5) * (1 - smooth(t, L.tRelease - 0.1, L.tRelease + 0.15));
      const h = Math.min(2.05, Math.max(1.15, foot + 0.05)), dz = h > 1.6 ? -0.62 : -0.54;
      b.fig.reach('L', _hl.set(-0.1, h, dz), k);
      b.fig.reach('R', _hr.set(0.1, h - 0.06, dz), k);
    }
  },

  stop(ctx, state, play) {
    const set = play?.set;
    if (!set) return;
    const rig = ctx.rig(0);
    if (rig?.setHatch) for (const L of play.lifts) rig.setHatch(L.slot, 0);
    this.release(ctx, play);
    set.play = null;
    park(set);
  },

  reset(ctx, state) {
    const set = state.set;
    if (set.play) this.stop(ctx, state, set.play);
    park(set);
  },
};
