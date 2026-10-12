import * as THREE from 'three';
import { buildVehicle } from '../../models/vehicles.js';
import { T217, BAY } from '../../models/v/t9t217.js';
import { HULL } from '../../models/v/baz5937.js';
import { OSA_PANEL, osaBlockParts } from '../../models/v/osa.js';
import { Parts, vehicleMats, box } from '../../models/kit.js';
import { SYSTEMS } from '../../sim/systems.js';
import { Frame, Lane, Timeline, Crewman, placeOnGround, smooth, ramp, ease } from '../reload.js';
import { CrewRoute, unwrap, wrapPi, keyPose, layKeys } from './lifts.js';

// Osa-AKM: the 9T217 transloader reloads the launcher in blocks of three containers (refs/reload/README.md
// section 3; photos osa_9t217_ntw_9_93, _polish, _warsaw_2013). Reconstructed where the research is
// unconfirmed: the 9T217 stops alongside on the launcher's right, its crane level with the turret (in
// ntw_9_93 the launcher stands on the transloader's left and the boom reaches across to it); the turret
// is turned to put the panels' rear ends, where the containers are loaded, toward it, and the panels are
// lowered level (SYSTEMS.osa.reloadPose); the search antenna is stopped facing forward, out of the
// crane's way. The tilt's roof opens (the half toward the launcher swings down the outside of the
// wall, the other half is raised, as in ntw_9_93); the crane lifts each spent block off its panel into
// the bay's right stack, then a fresh block from the left stack onto the panel (the block of three per
// handwiki's "sets of three"). A block whose remaining rounds are still in it goes back whole and a full
// one goes on, so the bay takes the rounds back. Crew: the crane operator in the bay with his control
// box, a man standing in the right cab hatch who signals, one who climbs out of the left hatch and down
// to the ground between the vehicles to marshal. The roof closes, the men get back in, the 9T217 backs
// out the way it came. One set of props per unit.

const X217 = 5.4; // the transloader's centre line in the Osa's frame (on its right)
const Z217 = OSA_PANEL.TZ - T217.PED.z; // its origin: the crane's pedestal level with the turret ring
const APPROACH = 60;
const ARRIVE = 12, BRAKE = 0.6, OPEN = 3, CLEAR = 2.5, STOW = 3.2, LEAVE = 15;
const HOVER_BAY = 2.95, CARRY = 3.3, LIFT = 0.45; // block centre heights: clear of the bay, carried; over a seat
const SLEW = 0.7; // rad/s, nominal
const ZC = (OSA_PANEL.Z0 + OSA_PANEL.Z1) / 2; // a block's middle along the panel (pan space)
const CENTRE = { [-1]: new THREE.Vector3(-OSA_PANEL.CX, OSA_PANEL.AX, ZC), [1]: new THREE.Vector3(OSA_PANEL.CX, OSA_PANEL.AX, ZC) };
const blockCentre = (s) => CENTRE[s < 0 ? -1 : 1]; // shared: do not modify

// ---------------------------------------------------------------- blocks

// The block geometry per side (osa.js osaBlockParts, the same as the launcher's), built once and shared.
let GEO = null;
function blockGeometry() {
  if (GEO) return GEO;
  const mats = vehicleMats('green');
  GEO = [-1, 1].map((s) => {
    const P = new Parts(mats);
    osaBlockParts(P, s);
    const g = new THREE.Group();
    P.build(g, { dirt: 0.1, y0: OSA_PANEL.TY + OSA_PANEL.EL_Y + OSA_PANEL.AX });
    return g.children.map((m) => ({ geometry: m.geometry, material: m.material }));
  });
  return GEO;
}

// A stand-in block of three: `outer` is the block frame (its middle; x across, z along, +z to the tails),
// placed by matrix; `inner` holds the pan-space geometry and the three front covers (the launcher's own
// cover meshes, shared).
function makeBlock(group, side, rig) {
  const outer = new THREE.Group();
  outer.matrixAutoUpdate = false;
  group.add(outer);
  const inner = new THREE.Group();
  inner.position.copy(blockCentre(side)).negate();
  outer.add(inner);
  for (const { geometry, material } of blockGeometry()[side < 0 ? 0 : 1]) {
    const m = new THREE.Mesh(geometry, material);
    m.castShadow = m.receiveShadow = true;
    inner.add(m);
  }
  const lids = [];
  for (let k = 0; k < 3; k++) {
    const lg = new THREE.Group();
    inner.add(lg);
    rig.lids[(side < 0 ? 0 : 3) + k]?.traverse((o) => {
      if (!o.isMesh) return;
      const m = new THREE.Mesh(o.geometry, o.material);
      m.castShadow = true;
      lg.add(m);
    });
    lids.push(lg);
  }
  outer.visible = false;
  return { outer, lids, side };
}

// ---------------------------------------------------------------- props

const _m = new THREE.Matrix4(), _m2 = new THREE.Matrix4(), _inv = new THREE.Matrix4(), _p = new THREE.Vector3(), _q = new THREE.Quaternion();
const _s1 = new THREE.Vector3(1, 1, 1), _o = { x: 0, z: 0, heading: 0 }, UP = new THREE.Vector3(0, 1, 0), POSE = {};
const ROT_PI = new THREE.Matrix4().makeRotationY(Math.PI);

function createSet(ctx) {
  const rig = ctx.rig(0);
  const t = buildVehicle('9t217');
  ctx.group.add(t.root);
  t.root.visible = false;
  // the operator's control box on its cable
  const pendant = new THREE.Mesh(box(0.2, 0.12, 0.28), vehicleMats('green').dark);
  pendant.castShadow = true;
  const crew = [
    new Crewman(ctx.group, { headgear: 'helmet', skin: 1 }), // crane operator in the bay
    new Crewman(ctx.group, { headgear: 'helmet' }), // in the right hatch, signalling
    new Crewman(ctx.group, { headgear: 'helmet', vest: 'webbing', skin: 2 }), // on the ground between the vehicles
  ];
  crew[0].fig.anchors.carry.add(pendant);
  pendant.position.set(0, 0.04, 0);
  // stand-ins: per side the block coming off (spent) and the one going on (fresh)
  const blocks = { [-1]: [makeBlock(ctx.group, -1, rig), makeBlock(ctx.group, -1, rig)], [1]: [makeBlock(ctx.group, 1, rig), makeBlock(ctx.group, 1, rig)] };
  return { t, crew, blocks, play: null };
}

function park(set) {
  set.t.root.visible = false;
  set.t.setCrane(set.t.craneTravel);
  set.t.setRoof(0);
  set.t.pivots.hatchL.rotation.x = set.t.pivots.hatchR.rotation.x = 0;
  for (const c of set.crew) c.hide();
  for (const s of [-1, 1]) for (const b of set.blocks[s]) b.outer.visible = false;
}

// the launcher's own blocks and covers (hidden while the stand-ins work)
function showOwn(ctx, sides, on) {
  const rig = ctx.rig(0);
  if (!rig?.blocks) return;
  const loaded = ctx.loaded(0);
  for (const s of sides) {
    rig.blocks[s < 0 ? 0 : 1].visible = on;
    for (let k = 0; k < 3; k++) {
      const i = (s < 0 ? 0 : 3) + k;
      if (on) rig.setLoaded(i, loaded[i] ?? true);
      else rig.lids[i].visible = false;
    }
  }
}

// ---------------------------------------------------------------- planning

// the work places in the transloader's model space: its rig placed at the end of its lane, the launcher's
// turret and panels set to the loading pose for the moment, each panel's block frame read back
function workPlaces(ctx, set, frame) {
  const rig = ctx.rig(0), t = set.t, pose = SYSTEMS.osa.reloadPose;
  frame.xz(X217, Z217, _p);
  placeOnGround(t.root, _p.x, _p.z, frame.heading, HULL.axles[0], HULL.axles[2], HULL.track, ctx.ground);
  t.root.updateMatrixWorld(true);
  _inv.copy(t.root.matrixWorld).invert();
  const tur = rig.pivots.turret, el = rig.pivots.elevation, a0 = tur.rotation.y, e0 = el.rotation.x;
  tur.rotation.y = pose.az;
  el.rotation.x = pose.el;
  rig.root.updateMatrixWorld(true);
  const pan = rig.blocks[0].parent, out = {};
  for (const s of [-1, 1]) {
    _m.makeTranslation(blockCentre(s)).premultiply(pan.matrixWorld).premultiply(_inv);
    const p = new THREE.Vector3().setFromMatrixPosition(_m);
    const z = new THREE.Vector3(0, 0, 1).transformDirection(_m);
    out[s] = { p, yaw: Math.atan2(z.x, z.z) };
  }
  tur.rotation.y = a0;
  el.rotation.x = e0;
  rig.root.updateMatrixWorld(true);
  return out;
}

/**
 * Plan a job: the blocks that change (a panel with any slot in job.slots), the lifts (spent block to
 * the bay's right stack, lower place first; then a fresh one from the left stack, upper first), the
 * covers each stand-in shows, the time line, the crane's keys and the crew's routes.
 */
function plan(ctx, set, job) {
  const u = ctx.unit, p = u.parts[0];
  const frame = new Frame(p.pos, p.heading);
  const loaded = ctx.loaded(0).slice();
  const fill = new Set(job.slots);
  const sides = [];
  for (const k of job.slots) { const s = k < 3 ? -1 : 1; if (!sides.includes(s)) sides.push(s); }
  const work = workPlaces(ctx, set, frame);
  const bay = (i) => ({ p: new THREE.Vector3(BAY[i].x, BAY[i].y, BAY[i].z), yaw: Math.PI });
  // where each stand-in starts and goes: places { at: 'panel', s } | { at: 'bay', i }
  const lifts = [], stands = [];
  const spare = [0, 1]; // fresh blocks, upper left first
  const empty = [2, 3]; // where the spent ones go, lower right first
  for (const s of sides) {
    const [spent, fresh] = set.blocks[s];
    const fi = spare.shift(), ei = empty.shift();
    stands.push({ b: spent, at: { at: 'panel', s }, covers: [0, 1, 2].map((k) => !!loaded[(s < 0 ? 0 : 3) + k]) });
    stands.push({ b: fresh, at: { at: 'bay', i: fi }, covers: [0, 1, 2].map((k) => { const i = (s < 0 ? 0 : 3) + k; return !!loaded[i] || fill.has(i); }) });
    lifts.push({ b: spent, src: { at: 'panel', s }, dst: { at: 'bay', i: ei }, S: work[s], D: bay(ei) });
    lifts.push({ b: fresh, src: { at: 'bay', i: fi }, dst: { at: 'panel', s }, S: bay(fi), D: work[s] });
  }
  // a fresh block not needed stays in the bay as the spare
  for (const i of spare) {
    const s = sides.includes(-1) ? 1 : -1;
    stands.push({ b: set.blocks[s][1], at: { at: 'bay', i }, covers: [true, true, true] });
  }
  const dur = job.dur;
  const tl = new Timeline().add('arrive', ARRIVE, true).add('brake', BRAKE, true).add('open', OPEN, true).add('work', lifts.length * 9).add('clear', CLEAR, true).fit(0, dur);
  const play = { frame, sides, lifts, stands, tl, dur, work };
  play.keys = craneTrack(set, play);
  play.lane = new Lane(frame, [[X217, Z217 + APPROACH], [X217, Z217]]);
  play.end = dur + STOW + 0.5;
  play.routes = crewRoutes(ctx, set, play);
  play.end = Math.max(play.end, play.routes.c.backEnd + 0.5) + LEAVE;
  play.leave = play.end - LEAVE;
  return play;
}

// ---------------------------------------------------------------- the crane

// Keys of the crane's joints (solved at plan time for the load's middle) laid on the time line between
// the roof opening and the end of the job; the stow after it.
function craneTrack(set, play) {
  const t = set.t, { tl, lifts } = play;
  const keys = [];
  const at = (dt, q, tag = null) => keys.push({ dt, pose: { slew: q.slew, luff: q.luff, ext: q.ext, rotate: q.rotate, yaw: q.slew + q.rotate }, tag });
  const solve = (p, yaw) => t.solveCrane(p, yaw, {});
  const slewOf = (p) => Math.atan2(-p.x, -(p.z - T217.PED.z));
  const move = (a, b) => 1.0 + Math.abs(wrapPi(slewOf(b.p) - slewOf(a.p))) / SLEW; // a, b: { p }
  const hover = (w, h) => { const q = w.p.clone(); q.y = Math.max(q.y + LIFT, h); return q; };
  at(0, t.craneTravel, 'travel');
  // out of the rest place first (the travel pose's spreader sits in the lower right place)
  const rest = new THREE.Vector3(BAY[2].x, HOVER_BAY, BAY[2].z);
  at(1.4, solve(rest, Math.PI), 'unrest');
  let prev = { p: rest };
  for (const L of lifts) {
    const S = L.S, D = L.D, sh = hover(S, L.src.at === 'bay' ? HOVER_BAY : 0), dh = hover(D, L.dst.at === 'bay' ? HOVER_BAY : 0);
    at(move(prev, S), solve(sh, S.yaw), 'reach');
    at(1.4, solve(S.p, S.yaw), 'down');
    at(0.7, solve(S.p, S.yaw), 'grip');
    at(1.3, solve(sh, S.yaw), 'up');
    // the carry: up to the carry height, round the crane, the block turning with the boom
    const mid = new THREE.Vector3().addVectors(sh, dh).multiplyScalar(0.5);
    const a0 = slewOf(sh), a1 = a0 + wrapPi(slewOf(dh) - a0), am = (a0 + a1) / 2;
    const rm = (Math.hypot(sh.x, sh.z - T217.PED.z) + Math.hypot(dh.x, dh.z - T217.PED.z)) / 2;
    mid.set(-Math.sin(am) * rm, CARRY, T217.PED.z - Math.cos(am) * rm);
    const yawMid = S.yaw + wrapPi(D.yaw - S.yaw) / 2;
    const carry = move(S, D) + 0.6;
    at(carry * 0.5, solve(mid, yawMid), 'carry');
    at(carry * 0.5, solve(dh, D.yaw), 'over');
    at(1.6, solve(D.p, D.yaw), 'lower');
    at(0.7, solve(D.p, D.yaw), 'release');
    at(1.1, solve(dh, D.yaw), 'clear');
    prev = D;
  }
  // back over the bay before the job ends (the launcher's turret moves then)
  const restAt = play.restPlace = restPlace(play);
  const rh = new THREE.Vector3(BAY[restAt].x, HOVER_BAY + 0.2, BAY[restAt].z);
  at(move(prev, { p: rh }), solve(rh, Math.PI), 'home');
  // unwrap the slews and yaws so every move takes the short way, the rotator the difference
  for (let i = 1; i < keys.length; i++) {
    const a = keys[i - 1].pose, b = keys[i].pose;
    b.slew = unwrap(b.slew, a.slew);
    b.yaw = unwrap(b.yaw, a.yaw);
  }
  for (const k of keys) k.pose.rotate = k.pose.yaw - k.pose.slew;
  // laid from the roof opening to the job's end, squeezed so the spreader is up off the last block before
  // the sim hands the turret back (reloadPose.free s before the end: the turret turns away under it)
  const o = tl.at('open'), c = tl.at('clear'), t0 = o.start + 0.8, free = SYSTEMS.osa.reloadPose?.free ?? 0;
  let t1 = c.end - 0.2, upTo = 0, before = 0;
  const total = keys.reduce((a, k) => a + k.dt, 0);
  for (const k of keys) { upTo += k.dt; if (k.tag === 'clear') before = upTo; }
  if (before > 0) t1 = Math.min(t1, t0 + ((play.dur - free - 0.3 - t0) * total) / before);
  layKeys(keys, t0, t1);
  // the stow after the job: down into the rest place (the outro)
  const last = keys[keys.length - 1].pose, q = solve(new THREE.Vector3(BAY[restAt].x, BAY[restAt].y, BAY[restAt].z), Math.PI);
  const slew = unwrap(q.slew, last.slew), yaw = unwrap(q.slew + q.rotate, last.yaw);
  keys.push({ t: play.dur + 2.2, pose: { slew, luff: q.luff, ext: q.ext, rotate: yaw - slew, yaw }, tag: 'stowed' });
  // when each lift grips and lets go
  let li = -1;
  keys.forEach((k, i) => {
    if (k.tag === 'grip') lifts[++li].tGrip = k.t - 0.5 * (k.t - keys[i - 1].t);
    if (k.tag === 'release') lifts[li].tRelease = k.t - 0.5 * (k.t - keys[i - 1].t);
  });
  return keys;
}

// the bay place the spreader rests in after the job: the lowest empty one
function restPlace(play) {
  const full = new Set();
  for (const s of play.stands) if (s.at.at === 'bay') full.add(s.at.i);
  for (const L of play.lifts) {
    if (L.src.at === 'bay') full.delete(L.src.i);
    if (L.dst.at === 'bay') full.add(L.dst.i);
  }
  // a place is free to rest in when it and the place above it are empty (lower places 1, 2 under 0, 3)
  for (const i of [1, 2]) if (!full.has(i) && !full.has(i === 1 ? 0 : 3)) return i;
  for (const i of [0, 3]) if (!full.has(i)) return i;
  return 0;
}

// ---------------------------------------------------------------- crew

function crewRoutes(ctx, set, play) {
  const { frame, tl, dur } = play;
  const f217 = new Frame(frame.xz(X217, Z217, new THREE.Vector3()), frame.heading);
  const g0 = ctx.ground(f217.pos.x, f217.pos.z); // heights are above the ground under the transloader
  const W = (x, y, z) => { const q = f217.xz(x, z, { x: 0, z: 0 }); q.y = g0 + y; return q; };
  const o = tl.at('open').start, top = HULL.top, h = T217.hatch;
  const face = (dx, dz) => frame.heading + Math.atan2(-dx, -dz); // a heading in the vehicles' frame
  // the man on the ground: up out of the left hatch, over the edge in front of the bay, down the side,
  // round to his place between the vehicles (beside the launcher's left panel, clear of the turret)
  const c = new CrewRoute([
    { to: W(-h.x, 0.55, h.z + 0.05), mode: 'rise' },
    { to: W(-h.x, top, h.z + 0.05), mode: 'climb', face: face(0, 1) },
    { to: W(-1.12, top, -2.3), mode: 'walk' },
    { to: W(-1.72, 1.45, -2.3), mode: 'climb', face: face(1, 0) },
    { to: W(-1.72, 0, -2.3), mode: 'climb', face: face(1, 0) },
    { to: W(-2.5, 0, -1.6), mode: 'walk' },
    { to: W(-2.5, 0, 0.95), mode: 'walk' },
  ], o + 0.6, dur + 0.3);
  return {
    c,
    // the operator stands on the bay floor right of the pedestal (out from under the boom)
    a: W(0.8, T217.bay.floor, T217.PED.z - 0.05),
    // the hatch man stands on his seat, out to the waist
    b: W(h.x, top - 1.05, h.z + 0.05),
    face,
  };
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
    if (!rig?.blocks || !rig.lids) return null;
    if (set.play) this.stop(ctx, state, set.play);
    const play = plan(ctx, set, job);
    play.set = set;
    play.job = job;
    play.handed = false;
    play.ant = null;
    set.play = play;
    // the stand-ins take over from the launcher's own blocks for the panels that change
    showOwn(ctx, play.sides, false);
    for (const st of play.stands) for (let k = 0; k < 3; k++) st.b.lids[k].visible = st.covers[k];
    set.t.setCrane(set.t.craneTravel);
    set.t.setRoof(0);
    set.t.root.visible = true;
    return play;
  },

  update(ctx, state, play, t, job) {
    const set = play.set;
    if (set.play !== play) return false;
    const T = set.t, { tl, dur } = play;
    // ---- the transloader: up its lane, stood, backed out after the job
    const L = play.lane.length;
    const s = t < play.leave ? L * ease(ramp(t, 0, ARRIVE)) : L * (1 - ease(ramp(t, play.leave, play.leave + LEAVE)));
    play.lane.at(s, _o);
    placeOnGround(T.root, _o.x, _o.z, _o.heading, HULL.axles[0], HULL.axles[2], HULL.track, ctx.ground);
    T.setWheels(s, 0);
    // ---- roof, hatches
    const o = tl.at('open').start;
    T.setRoof(ramp(t, o + 0.2, o + 2.9) * (1 - ramp(t, dur + 0.6, dur + STOW)));
    const back = play.routes.c;
    const hl = Math.max(smooth(t, o + 0.1, o + 0.6) * (1 - smooth(t, o + 3.4, o + 4.0)), smooth(t, back.backEnd - 4, back.backEnd - 3.4) * (1 - smooth(t, back.backEnd, back.backEnd + 0.6)));
    T.pivots.hatchL.rotation.x = -1.75 * hl;
    T.pivots.hatchR.rotation.x = -1.75 * smooth(t, o, o + 0.6) * (1 - smooth(t, dur + STOW - 0.2, dur + STOW + 0.4));
    // ---- crane
    T.setCrane(keyPose(play.keys, t, POSE));
    T.root.updateMatrixWorld(true);
    // ---- blocks
    this.blocks(ctx, set, play, t);
    // ---- the launcher's search antenna: slowed and stopped facing forward, handed back after the job
    this.antenna(ctx, play, t);
    // ---- crew
    this.crew(ctx, set, play, t);
    if (!play.handed && t >= dur) {
      // the sim has counted the rounds: the launcher's own blocks and covers again
      play.handed = true;
      showOwn(ctx, play.sides, true);
    }
    if (t >= play.end) {
      park(set);
      set.play = null;
      return false;
    }
    return true;
  },

  // every stand-in where it is at t: on its panel (following the turret), on the spreader, in the bay
  blocks(ctx, set, play, t) {
    const rig = ctx.rig(0), pan = rig.blocks[0].parent;
    pan.updateWorldMatrix(true, false);
    const hook = set.t.anchors.craneLoad;
    hook.updateWorldMatrix(true, false);
    for (const st of play.stands) {
      let pl = st.at;
      for (const L of play.lifts) if (L.b === st.b && t >= L.tGrip) pl = t < L.tRelease ? 'hook' : L.dst;
      const b = st.b;
      if (pl === 'hook') b.outer.matrix.copy(hook.matrixWorld);
      else if (pl.at === 'panel') {
        if (play.handed) { b.outer.visible = false; continue; }
        b.outer.matrix.makeTranslation(blockCentre(pl.s)).premultiply(pan.matrixWorld);
      } else {
        const q = BAY[pl.i];
        b.outer.matrix.makeTranslation(q.x, q.y, q.z).multiply(ROT_PI).premultiply(set.t.root.matrixWorld);
      }
      b.outer.visible = true;
      b.outer.matrixWorldNeedsUpdate = true;
    }
  },

  // The search antenna (UnitViews spins it with the sweep every frame before this): from the job's start
  // it runs down over 2 s and turns to face forward, holds while the crane works, and after the job
  // catches up with the sweep again (the offset frozen when the job ends, faded out).
  antenna(ctx, play, t) {
    const ant = ctx.rig(0)?.pivots.searchRadar;
    if (!ant) return;
    const live = ant.rotation.y;
    if (!play.ant) play.ant = { a0: live, t0: t, w: (-Math.PI * 2) / SYSTEMS.osa.search.period };
    const A = play.ant, Tdn = 2;
    if (!play.handed || t < play.dur) {
      const tau = Math.min(Tdn, Math.max(0, t - A.t0));
      const a = A.a0 + A.w * (tau - (tau * tau) / (2 * Tdn));
      const stop = A.a0 + (A.w * Tdn) / 2, park = stop + wrapPi(0 - stop);
      ant.rotation.y = a + (park - stop) * smooth(t, A.t0 + Tdn, A.t0 + Tdn + 1.6);
      A.last = ant.rotation.y;
      return;
    }
    if (A.off == null) A.off = wrapPi(A.last - live);
    ant.rotation.y = live + A.off * (1 - smooth(t, play.dur, play.dur + 2.2));
  },

  crew(ctx, set, play, t) {
    const [a, b, c] = set.crew, { routes, tl, dur, frame } = play;
    const o = tl.at('open').start;
    const hook = set.t.anchors.craneLoad.getWorldPosition(_p);
    // a block is over the launcher (signal) while a lift that goes to or comes from a panel carries it
    let busy = false;
    for (const L of play.lifts) if (t > L.tGrip - 1 && t < L.tRelease + 0.5) busy = true;
    // the operator, while the roof is open
    if (t > o + 0.5 && t < dur + STOW - 0.3) a.at(routes.a.x, routes.a.z, Crewman.facing(routes.a.x, routes.a.z, hook.x, hook.z), 'operate', t * 0.3, routes.a.y);
    else a.hide();
    // the hatch man rises with the lid open and sinks back before it shuts
    const up = smooth(t, o + 0.4, o + 1.4) * (1 - smooth(t, dur + STOW - 1.2, dur + STOW - 0.3));
    if (up > 0.01) b.at(routes.b.x, routes.b.z, busy ? Crewman.facing(routes.b.x, routes.b.z, hook.x, hook.z) : frame.heading + Math.PI / 2, busy && up > 0.99 ? 'signal' : 'stand', t * 0.5, routes.b.y - 1.0 * (1 - up));
    else b.hide();
    // the marshal on the ground
    const p = routes.c.pose(c, t);
    if (p) c.at(p.x, p.z, busy ? Crewman.facing(p.x, p.z, hook.x, hook.z) : routes.face(-1, 0), busy ? 'signal' : 'stand', t * 0.5, p.y);
  },

  stop(ctx, state, play) {
    const set = play?.set;
    if (!set) return;
    if (!play.handed) showOwn(ctx, play.sides, true);
    set.play = null;
    park(set);
  },

  reset(ctx, state) {
    const set = state.set;
    if (set.play) this.stop(ctx, state, set.play);
    park(set);
  },
};
