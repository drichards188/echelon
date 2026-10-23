import * as THREE from 'three';
import { SK, SIDE } from './figure44.js';
import { eyeSolve, look, eul, setIKv, POSES, GAITS, eyeOf, gripOnProp, spec, resetSpec, lerpSpec } from './pose44.js';

// The crews' jobs: for every WW2 gun rig (src/eras/ww2/models) and every crew spot in its anchors.crew, what
// the man does there (his pose, his prop, his gear, the kind of man), with the hands and eyes put on the rig's
// own parts, read every frame from its pivots: handwheel knobs that turn with the gun, the 88's breech as it
// elevates, the fuze setter's cups, the Kommandogeraet's eyepieces on the elevating tube, the Wuerzburg's
// scope hoods, the light guns' sights, loading tables and magazines. Sources: the crew sections of
// refs/ww2/flak88 (sec. 6), battery (1.6, 3.1), flak43, flakvierling and flak38 (sec. 6), their photos
// (flak88_crew_karow_01, _layers_karow_02, _loading_ba_06; markings_crew_laying_07, _loading_08,
// _crew_2cm_09; flak38_tower_21; flakvierling_rangefinder_17) and refs/ww2/markings 5 for who manned them.
//
// A job: { role, pose(ctx, m, S), prop?(ctx, m), kit?, busy?, gloves?, place?(h, m, dt), easy?(ctx, m, S), ease? }.
//   role   'gunner' | 'tech' (technical posts: half Luftwaffenhelfer) | 'helper' | 'carrier' (older men,
//          Hiwis) | 'nco' (gun and instrument commanders), weighted in ROLES
//   pose   fills the pose44.js specification S in the man's root space through ctx's helpers (below)
//   place  moves his root matrix m.W (world) before the pose: turning to the target, following the mount
//   ease   1/s: he eases into each pose rather than taking it at once (the drill men, see "the loading drills")
// Where a rig's spot does not fit the man, the crew layer corrects it here rather than in the rig (the guns'
// files belong to their builder): every spot is stood on the surface found under it (prepareRig raycasts the
// rig once, the median of five points under the feet: the Kommandogeraet's spots sit 0.1 m under its grating,
// the Flak 38 layer's 0.2 m under his seat, its range-taker 0.7 m inside the bank, the 88's commander and
// carriers 0.14 m over the floor beyond the decking, the Wuerzburg commander 0.45 m over the ground beside its
// platform); the Wuerzburg telephone man's spot faces away from the box (op4 turns to it); some ground spots
// face away from the gun (flak43 and flak38 gf, flak38 k3, flakvierling k4: faceGun, or the observers' turn
// to the target); the 88's K1, K2 and K5 step a little closer to the wheels and the cup.
//
// ctx (one per crew, rebound per man): ctx.p(obj, x, y, z, out) a point in obj's space to the man's root
// space; ctx.d(...) a direction; ctx.w(worldPoint, out); on a handwheel ctx.knob(name, out) (it turns with the
// wheel), ctx.rim(name, angle, out) and ctx.rimToward(name, dx, dy, dz, out) (the rim point toward a root-space
// direction, fixed for the man while the wheel turns), ctx.axle(name, out); ctx.aim(out) the bore's direction;
// ctx.far(out) where an observer looks (m.look, the crew's target, or 500 m along the bore); ctx.t the man's
// clock; ctx.library(name, t) a library pose (pose44.js POSES or JOB_POSES below).

export const ROLES = {
  gunner: { boy: 0.15, older: 0.12 },
  tech: { boy: 0.55, older: 0.05 },
  helper: { boy: 0.9, older: 0.0 },
  carrier: { boy: 0.15, older: 0.4, hiwi: 0.3 },
  nco: { boy: 0.0, older: 0.45 },
};

const V3 = THREE.Vector3, Q = THREE.Quaternion;
const TAU = Math.PI * 2;
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const lerp = (a, b, t) => a + (b - a) * t;
const wrapPi = (a) => { a = (a + Math.PI) % TAU; return (a < 0 ? a + TAU : a) - Math.PI; };
const ANK = SK.ANKLE_Y;
const P = Array.from({ length: 12 }, () => new V3()); // scratch points
const _q = new Q(), _q2 = new Q(), _e = new THREE.Euler(), _m = new THREE.Matrix4(), _m2 = new THREE.Matrix4(), _v = new V3(), _v2 = new V3(), _v3 = new V3(), _v4 = new V3();
const _up = new V3(0, 1, 0), _z = new V3(0, 0, 1);
const xf = (x, y, z, rx = 0, ry = 0, rz = 0) => new THREE.Matrix4().compose(new V3(x, y, z), new Q().setFromEuler(new THREE.Euler(rx, ry, rz)), new V3(1, 1, 1));

// ---------------------------------------------------------------- the rig's parts

// The handwheels the hands go on: the node that turns with the gun (by name), the unit wheel's orientation in
// it (axle +Z, knob at 90 degrees round the rim) and the radius, as the rigs build them (wheelSet calls).
const WHEELS = {
  flak88: { wheelAz: [0, Math.PI / 2, 0, 0.15], wheelEl: [0, Math.PI / 2, 0, 0.15], wheelFz: [0, Math.PI, 0, 0.11] },
  kdo40: { wheelAz: [0, -Math.PI / 2, 0, 0.16], wheelEl: [0, Math.PI / 2, 0, 0.16] },
  wurzburg: { wheelEl: [0, Math.PI / 2, 0, 0.14], wheelAz: [Math.PI / 2, 0, 0, 0.19], wheelRange: [0, Math.PI / 2, 0, 0.09] },
  flak43: { wheelEl: [0, Math.PI / 2, 0, 0.12], wheelTr: [Math.PI / 2, 0, 0, 0.12] },
  flakvierling: { wheelEl: [0, Math.PI / 2, 0, 0.11], wheelTr: [Math.PI / 2, 0, 0, 0.11] },
  'flakvierling-tower': { wheelEl: [0, Math.PI / 2, 0, 0.11], wheelTr: [Math.PI / 2, 0, 0, 0.11] },
  flak38: { wheelEl: [0, Math.PI / 2, 0, 0.13], wheelTr: [Math.PI / 2, 0, 0, 0.15] },
  flak128: { wheelEl: [0, 0, 0, 0.2], wheelAz: [0, 0, 0, 0.2] },
};
const KNOB = 0.31; // the knob's grip along the axle, in wheel radii (kit44.js handwheel)

const raycaster = new THREE.Raycaster();
// The standing (or seat) height under a spot, from the rig's own surfaces: the turret's for a spot that rides
// on it (the Kommandogeraet's platform), the whole rig's for one on the root (a bank outside the pit).
function surfaceUnder(rig, spot) {
  const seated = spot.userData.seated;
  // a spot on the ground stands on the emplacement or the gun's fixed base (not on the turning gun), so it may
  // look from higher up (a bank round the pit can be over a metre high there)
  const onRoot = spot.parent === rig.root, scope = onRoot ? rig.root : spot.parent, turret = rig.pivots.turret;
  const meshes = [];
  scope.traverse((o) => {
    if (!o.isMesh || o.isInstancedMesh || o.isSkinnedMesh) return;
    for (let p = o; p; p = p.parent) { if (p.visible === false) return; if (onRoot && p === turret) return; }
    meshes.push(o);
  });
  const base = spot.getWorldPosition(new V3());
  const up = seated ? 0.32 : onRoot ? 1.6 : 0.6, far = seated ? 0.6 : onRoot ? 2.2 : 1.2;
  // the highest upward-facing surface under each sample point; the median of the samples, so a jack's foot or a
  // pole under one toe does not lift a man off the floor
  const offs = seated ? [[0, 0]] : [[0, 0], [0.1, 0.06], [-0.1, 0.06], [0.08, -0.08], [-0.08, -0.08]];
  const ys = [];
  for (const [dx, dz] of offs) {
    raycaster.set(new V3(base.x + dx, base.y + up, base.z + dz), new V3(0, -1, 0));
    raycaster.far = far;
    let best = -Infinity;
    for (const hit of raycaster.intersectObjects(meshes, false)) {
      const n = hit.face ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld) : _up;
      if (n.y > 0.6 && hit.point.y > best) best = hit.point.y;
    }
    ys.push(best);
  }
  ys.sort((a, b) => a - b);
  const y = ys[Math.floor(ys.length / 2)];
  return y > -Infinity && Math.abs(y - base.y) < (seated ? 0.3 : onRoot ? 1.5 : 0.5) ? y - base.y : 0;
}

export function prepareRig(rig, kind) {
  const W = WHEELS[kind] || {};
  const wheels = {};
  for (const [name, [rx, ry, rz, R]] of Object.entries(W)) {
    const node = rig.root.getObjectByName(name);
    if (node) wheels[name] = { node, M: xf(0, 0, 0, rx, ry, rz), R };
  }
  const piv = rig.pivots;
  const nodes = [piv.turret, piv.elevation, piv.recoil, ...Object.values(wheels).map((w) => w.node), rig.anchors.sight, rig.anchors.breech, rig.anchors.feed, rig.anchors.magazine,
    ...(rig.anchors.fuzeCups || []), ...(rig.anchors.magazines || []), ...(rig.anchors.muzzles || []), ...(rig.anchors.drillNodes || []), ...(rig.anchors.breeches || [])].filter(Boolean);
  // the standing heights under the spots (once: the platforms turn with their spots)
  const dy = new Map();
  for (const spot of Object.values(rig.anchors.crew || {})) dy.set(spot, surfaceUnder(rig, spot));
  // this frame's matrices of the nodes the jobs read, each ancestor updated once (stamped with the frame)
  const stamp = new Map();
  let frame = 0;
  const upd = (o) => {
    if (stamp.get(o) === frame) return;
    if (o.parent) upd(o.parent);
    if (o.matrixAutoUpdate) o.updateMatrix();
    if (o.parent) o.matrixWorld.multiplyMatrices(o.parent.matrixWorld, o.matrix); else o.matrixWorld.copy(o.matrix);
    stamp.set(o, frame);
  };
  const R = {
    wheels, nodes, dy, kind,
    update() { frame++; for (const n of nodes) upd(n); upd(rig.root); for (const s of Object.values(rig.anchors.crew || {})) if (s.parent) upd(s.parent); },
    context: null,
  };
  R.context = makeContext(rig, R);
  return R;
}

function makeContext(rig, R) {
  const c = {
    rig, R, h: null, m: null, t: 0, dt: 0, S: null,
    p(obj, x, y, z, out) { return out.set(x, y, z).applyMatrix4(obj.matrixWorld).applyMatrix4(c.m.inv); },
    d(obj, x, y, z, out) { return out.set(x, y, z).transformDirection(obj.matrixWorld).transformDirection(c.m.inv); },
    w(p, out) { return out.copy(p).applyMatrix4(c.m.inv); },
    // a handwheel's knob, its rim point at angle a (radians round from the knob), its axle (root space)
    knob(name, out) { return c.rim(name, 0, out, KNOB); },
    rim(name, a, out, z = 0) {
      const w = R.wheels[name];
      if (!w) return out.set(0, 1, -0.4);
      _m.multiplyMatrices(w.node.matrixWorld, w.M);
      return out.set(-Math.sin(a) * w.R, Math.cos(a) * w.R, z * w.R).applyMatrix4(_m).applyMatrix4(c.m.inv);
    },
    // the rim point toward a root-space direction from the hub (fixed for the man while the wheel turns)
    rimToward(name, dx, dy, dz, out) {
      const w = R.wheels[name];
      if (!w) return out.set(0, 1, -0.4);
      _m.multiplyMatrices(w.node.matrixWorld, w.M);
      const hub = _v.setFromMatrixPosition(_m).applyMatrix4(c.m.inv);
      const ax = _v2.set(0, 0, 1).transformDirection(_m).transformDirection(c.m.inv);
      const d = _v3.set(dx, dy, dz).addScaledVector(ax, -(dx * ax.x + dy * ax.y + dz * ax.z));
      if (d.lengthSq() < 1e-8) d.set(0, 1, 0);
      return out.copy(hub).addScaledVector(d.normalize(), w.R * c.m.st.invScale);
    },
    axle(name, out) {
      const w = R.wheels[name];
      if (!w) return out.set(0, 0, 1);
      _m.multiplyMatrices(w.node.matrixWorld, w.M);
      return out.set(0, 0, 1).transformDirection(_m).transformDirection(c.m.inv);
    },
    // the bore's direction (the first muzzle's -Z, else the elevation pivot's), root space
    aim(out) {
      const o = (rig.anchors.muzzles && rig.anchors.muzzles[0]) || rig.pivots.elevation || rig.root;
      return out.set(0, 0, -1).transformDirection(o.matrixWorld).transformDirection(c.m.inv);
    },
    // where an observer looks: the crew's target, else 500 m along the bore (root space point)
    far(out) {
      if (c.m.look) return c.w(c.m.look, out);
      if (c.h.target) return c.w(c.h.target, out);
      const o = (rig.anchors.muzzles && rig.anchors.muzzles[0]) || rig.pivots.elevation || rig.root;
      return out.set(0, 0, -500).applyMatrix4(o.matrixWorld).applyMatrix4(c.m.inv);
    },
    library(name, t) {
      if (POSES[name]) { POSES[name](c.S, t); return true; }
      const j = JOB_POSES[name];
      if (j) { j(c, c.m, c.S, t); return true; }
      return false;
    },
    finishHands(S) {
      const hd = c.m.hands;
      if (!hd) return;
      for (const [k, i] of [['L', 0], ['R', 1]]) if (hd[k]) { c.w(hd[k], _v); const a = S.arms[i]; a.ik = true; a.grip.copy(_v); if (a.fingers.lengthSq() < 1e-6) a.fingers.set(0, -0.3, -1); if (a.palm.lengthSq() < 1e-6) a.palm.set(-SIDE[i], 0, 0); if (a.pole.lengthSq() < 1e-6) a.pole.set(SIDE[i] * 0.5, -1, 0.5); }
    },
  };
  return function context(h, m, dt, S) { c.h = h; c.m = m; c.t = m.clock; c.dt = dt; c.S = S; m.st.invScale = 1.78 / m.outfit.height; return c; };
}

// ---------------------------------------------------------------- building blocks

// the ankles planted at (x, z) pairs, toes turned out a little, on a floor `y` (root space)
function plant(S, lx, lz, rx, rz, y = 0, out = 0.12) {
  S.feet[0].ankle.set(lx, ANK + y, lz); S.feet[0].rot.set(0, out, 0); S.feet[0].pole.set(-0.15, 0, -1);
  S.feet[1].ankle.set(rx, ANK + y, rz); S.feet[1].rot.set(0, -out, 0); S.feet[1].pole.set(0.15, 0, -1);
}
// a standing torso: lean forward (rad), hips height and set-back, a twist toward the work, breathing
function torsoStand(S, c, lean, hipY = 0.968, hipZ = 0.03, twist = 0) {
  const b = Math.sin((TAU * c.t) / 4.2 + c.m.seed * 9);
  S.hips.set(0.01 * Math.sin(c.t * 0.37 + c.m.seed * 20), hipY, hipZ + 0.24 * Math.sin(Math.max(0, lean)));
  eul(S.hipsQ, -lean * 0.4, twist * 0.25, 0);
  eul(S.spineQ, -lean * 0.32, twist * 0.35, 0);
  eul(S.chestQ, -lean * 0.28 + 0.012 * b, twist * 0.4, 0);
}
// seated on the root's origin (the seat point): hips just above it, the feet on their rests
function torsoSeat(S, c, lean, twist = 0, back = 0.03) {
  const b = Math.sin((TAU * c.t) / 4.0 + c.m.seed * 9);
  S.hips.set(0, 0.095, back);
  eul(S.hipsQ, -lean * 0.6 + 0.12, twist * 0.2, 0);
  eul(S.spineQ, -lean * 0.25, twist * 0.35, 0);
  eul(S.chestQ, -lean * 0.15 + 0.012 * b, twist * 0.45, 0);
}
function seatFeet(S, lx, ly, lz, rx, ry, rz) {
  S.feet[0].ankle.set(lx, ly + ANK, lz); S.feet[0].rot.set(0.1, 0.1, 0); S.feet[0].pole.set(-0.2, 0.5, -1);
  S.feet[1].ankle.set(rx, ry + ANK, rz); S.feet[1].rot.set(0.1, -0.1, 0); S.feet[1].pole.set(0.2, 0.5, -1);
}
// hand i on point p, fingers and palm directions, elbow toward pole (all root space)
function hand(S, i, p, fx, fy, fz, nx, ny, nz, px, py, pz) {
  setIKv(S.arms[i], p.x, p.y, p.z, fx, fy, fz, nx, ny, nz, px, py, pz);
}
// hand i round a handwheel's knob: fingers wrapped round the knob, the palm toward the wheel
function onKnob(S, c, i, name) {
  c.knob(name, P[10]); c.axle(name, P[11]);
  const s = SIDE[i];
  // fingers down and across the knob, the palm against it from outside
  setIKv(S.arms[i], P[10].x, P[10].y, P[10].z, 0, -1, -0.3, -P[11].x, -P[11].y, -P[11].z, s * 0.7, -1, 0.3);
}
// hand i on a handwheel's rim, on the side toward (dx, dy, dz) from the hub (root space)
function onRim(S, c, i, name, dx, dy, dz) {
  c.rimToward(name, dx, dy, dz, P[10]); c.axle(name, P[11]);
  const s = SIDE[i];
  setIKv(S.arms[i], P[10].x, P[10].y, P[10].z, 0, -0.6, -1, -P[11].x, -P[11].y, -P[11].z, s * 0.8, -1, 0.2);
}
// arms hanging, or resting: FK
function armDown(S, i, fwd = 0.05, out = 0.1, fa = 0.25) {
  const a = S.arms[i], s = SIDE[i];
  a.ik = false; a.ua.set(fwd, 0, s * out); a.fa = fa; a.hand.set(0.05, 0, s * 0.05);
}
// the face toward a root-space point (k of the way), or along a direction
function lookAt(S, p, k = 1) { eyeOf(S, _v4); _v4.subVectors(p, _v4); look(S, _v4, k); }
// idle glances: every few seconds a new small turn of the head on top of the job's look
function glance(S, c, m, amt = 1) {
  const st = m.st;
  if (st.gT == null || c.t > st.gT) {
    st.gT = c.t + 2.5 + m.rnd() * 5;
    st.gy1 = (m.rnd() - 0.5) * 1.1 * amt; st.gp1 = (m.rnd() - 0.35) * 0.35 * amt;
  }
  const k = 1 - Math.exp(-2.5 * Math.max(0.001, c.dt));
  st.gy = lerp(st.gy ?? 0, st.gy1, k); st.gp = lerp(st.gp ?? 0, st.gp1, k);
  _q.copy(S.headQ); eul(_q2, st.gp, st.gy, 0); S.headQ.copy(_q).multiply(_q2);
}
// the prop's pose (root space)
function propAt(S, p, q) { S.prop.on = true; S.prop.pos.copy(p); S.prop.q.copy(q); }
// a point and directions in prop space to root space
function propPt(S, x, y, z, out) { return out.set(x, y, z).multiplyScalar(S.prop.s).applyQuaternion(S.prop.q).add(S.prop.pos); }
function propDir(S, x, y, z, out) { return out.set(x, y, z).applyQuaternion(S.prop.q); }
function gripProp(S, i, x, y, z, f, n, pole) { gripOnProp(S, S.arms[i], x, y, z, f, n, pole); }
// a quaternion turning prop space's -Z onto dir with +Y as near `up` as it goes
function aimQ(out, dir, up = _up) {
  _v.copy(dir).normalize().negate(); // the prop's +Z
  _v2.crossVectors(up, _v);
  if (_v2.lengthSq() < 1e-6) _v2.set(1, 0, 0);
  _v2.normalize();
  _v3.crossVectors(_v, _v2);
  return out.setFromRotationMatrix(_m2.makeBasis(_v2, _v3, _v));
}
// turn the man's root toward a world direction round the vertical (an observer), at most `max` rad off his
// spot's facing, at `rate` rad/s; the turn is kept in m.st.yaw
function turnTo(h, m, dt, dirWorld, max = 2.6, rate = 1.3) {
  _v.copy(dirWorld); _v.y = 0;
  if (_v.lengthSq() < 1e-6) return;
  const e = m.W.elements;
  const base = Math.atan2(-e[8], -e[10]); // the spot's facing (world yaw of its -Z)
  const want = clamp(wrapPi(Math.atan2(-_v.x, -_v.z) - base), -max, max);
  const cur = m.st.yaw ?? want;
  m.st.yaw = cur + clamp(wrapPi(want - cur), -rate * dt, rate * dt);
  m.W.multiply(_m.makeRotationY(m.st.yaw));
}

// ---------------------------------------------------------------- shared poses

// binoculars at the eyes on the far point, elbows out and down (gun and instrument commanders)
// how far an observer leans back to look high (the head turns only so far up)
const leanBack = (p) => -clamp((Math.atan2(p.y - 1.6, Math.hypot(p.x, p.z)) - 0.55) * 0.55, 0, 0.4);
function binoUp(c, m, S, k = 1) {
  c.far(P[0]);
  torsoStand(S, c, leanBack(P[0]), 0.968, 0.0);
  S.hipsQ.multiply(eul(_q, 0.06, 0, 0)); // a little back on the heels to look up
  plant(S, -0.15, 0.04, 0.14, -0.06);
  eyeOf(S, P[1]);
  _v4.subVectors(P[0], P[1]);
  look(S, _v4, 1);
  eyeOf(S, P[1]);
  _v4.normalize();
  // the binoculars' eyepieces 3 cm in front of the eyes, the head's up as the prop's up
  _q.copy(S.hipsQ).multiply(S.spineQ).multiply(S.chestQ).multiply(S.neckQ).multiply(S.headQ);
  _v3.set(0, 1, 0).applyQuaternion(_q);
  propAt(S, P[2].copy(P[1]).addScaledVector(_v4, 0.03 * k), aimQ(_q2, _v4, _v3));
  gripProp(S, 0, -0.045, -0.012, -0.06, [0, -0.2, -1], [1, 0, 0], [-0.35, -1, -0.6]);
  gripProp(S, 1, 0.045, -0.012, -0.06, [0, -0.2, -1], [-1, 0, 0], [0.35, -1, -0.6]);
}
// a load cradled in front at the chest: the 88 round level, its nose to his left front (side -1: to his right)
function cradle88(c, m, S, side = 1) {
  POSES.carry(S, c.t / 4);
  torsoStand(S, c, -0.04, 0.962, 0.03);
  S.feet[0].ankle.set(-0.14, ANK, 0.0); S.feet[1].ankle.set(0.13, ANK, 0.05);
  propAt(S, P[0].set(side * 0.17, 1.04, -0.33), eul(_q, 0.05, side * 1.15, 0));
  // the hand at the base under the case, the other under the projectile
  gripProp(S, side > 0 ? 1 : 0, 0, -0.045, -0.12, [0, 0.3, -1], [0, 1, 0], [side, -1, 0.3]);
  gripProp(S, side > 0 ? 0 : 1, 0, -0.045, -0.6, [0, 0.3, -1], [0, 1, 0], [-side, -1, 0.3]);
  glance(S, c, m, 0.5);
}
// step the man's root forward (his -Z) by d metres: where the rig's spot is a little far from his work
const stepIn = (d, then = null) => (h, m, dt) => { m.W.multiply(_m.makeTranslation(0, 0, -d)); if (then) then(h, m, dt); };
// a 3.7 cm clip (or a 2 cm magazine) held flat in both hands at the belt
function cradleClip(c, m, S) {
  POSES.carry(S, c.t / 4);
  torsoStand(S, c, -0.03, 0.962, 0.03);
  propAt(S, P[0].set(0, 1.0, -0.33), eul(_q, 0.12, 0, 0));
  gripProp(S, 0, -0.17, -0.03, 0.0, [0, 0.2, -1], [0.2, 1, 0], [-1, -1, 0.3]);
  gripProp(S, 1, 0.17, -0.03, 0.0, [0, 0.2, -1], [-0.2, 1, 0], [1, -1, 0.3]);
  glance(S, c, m, 0.6);
}
// two 2 cm magazines carried, one in each hand, arms down
function carryMags(c, m, S) {
  POSES.stand(S, c.t / 4);
  torsoStand(S, c, 0.02, 0.968, 0.02);
  plant(S, -0.13, 0.02, 0.13, -0.02);
  armDown(S, 0, 0.08, 0.16, 0.2);
  // the right-hand magazine by its end, hanging at the thigh
  propAt(S, P[0].set(0.25, 0.62, -0.03), eul(_q, 0, Math.PI / 2, Math.PI / 2));
  gripProp(S, 1, 0.155, 0.0, 0.0, [0, -1, 0], [-1, 0, 0], [1, -0.3, 0.8]);
  glance(S, c, m, 0.8);
}
// at ease: feet apart, hands behind the back or in the coat
function atEase(c, m, S) {
  POSES.atEase(S, c.t / 4.5);
  glance(S, c, m, 1.2);
}
// seated at rest: hands on the knees
function sitEasy(c, m, S) {
  torsoSeat(S, c, -0.05);
  seatFeet(S, -0.16, -0.42, -0.42, 0.16, -0.42, -0.42);
  for (let i = 0; i < 2; i++) { const s = SIDE[i]; setIKv(S.arms[i], s * 0.14, 0.17, -0.36, 0, -0.5, -1, 0, -1, 0, s * 0.8, -1, 0.3); }
  glance(S, c, m, 1);
}

// the 1 m rangefinder on its harness at the eyes, tube across, tilted up at the far point
function rangefinder(c, m, S) {
  c.far(P[0]);
  torsoStand(S, c, leanBack(P[0]), 0.968, 0.0);
  plant(S, -0.16, 0.05, 0.15, -0.05);
  eyeOf(S, P[1]);
  _v4.subVectors(P[0], P[1]);
  look(S, _v4, 0.85);
  eyeOf(S, P[1]);
  _v4.subVectors(P[0], P[1]).normalize();
  _q.copy(S.hipsQ).multiply(S.spineQ).multiply(S.chestQ).multiply(S.neckQ).multiply(S.headQ);
  _v3.set(0, 1, 0).applyQuaternion(_q);
  propAt(S, P[2].copy(P[1]).addScaledVector(_v4, 0.035), aimQ(_q2, _v4, _v3));
  gripProp(S, 0, -0.21, -0.035, -0.07, [0, 0.2, -1], [0, 1, 0], [-0.5, -1, -0.3]);
  gripProp(S, 1, 0.21, -0.035, -0.07, [0, 0.2, -1], [0, 1, 0], [0.5, -1, -0.3]);
}

// a commander: binoculars up on the target, then down, looking round, a hand raised now and then
function commander(c, m, S) {
  const st = m.st;
  if (st.phase == null || c.t > st.until) {
    st.phase = st.phase === 'up' ? (m.rnd() < 0.3 ? 'signal' : 'down') : 'up';
    st.until = c.t + (st.phase === 'up' ? 5 + m.rnd() * 8 : st.phase === 'signal' ? 2 + m.rnd() * 1.5 : 2.5 + m.rnd() * 4);
  }
  if (st.phase === 'up') { binoUp(c, m, S); return; }
  if (st.phase === 'signal') {
    POSES.signal(S, c.t * 0.6);
    c.far(P[0]); lookAt(S, P[0], 0.7);
    return;
  }
  POSES.stand(S, c.t / 4);
  torsoStand(S, c, 0.02, 0.968, 0.02);
  plant(S, -0.15, 0.03, 0.14, -0.04);
  c.far(P[0]); lookAt(S, P[0], 0.5);
  glance(S, c, m, 1);
  armDown(S, 0, 0.05, 0.12, 0.3);
  armDown(S, 1, 0.05, 0.12, 0.3);
}
// commanders carry the binoculars in the hand when they are up, on the chest otherwise
const binoProp = (c, m) => (m.st.phase === 'up' ? 'bino' : null);
const binoKit = ['binoChest', 'headset'];
// observers turn their whole body to keep the target in front of them
const turnObserver = (h, m, dt) => {
  const c = h.ctx(m, dt);
  m.inv.copy(m.W).invert();
  c.far(_v4).applyMatrix4(m.W).sub(_v2.setFromMatrixPosition(m.W));
  turnTo(h, m, dt, _v4);
};

// A standing man at a handwheel: the near hand on the knob, the other on the rim opposite the man, eyes on a
// dial (root space point `dial`).
function crank(c, m, S, wheel, side, dial, lean = 0.18, feetZ = 0) {
  POSES.stand(S, c.t / 4);
  c.rim(wheel, 0, P[0]);
  // stand square to the wheel at a comfortable distance (the spot is where the feet are)
  const h = P[0].y; // the wheel's height decides how far he bends
  const hipY = clamp(0.968 - Math.max(0, 0.88 - h) * 0.5, 0.82, 0.975);
  torsoStand(S, c, lean + Math.max(0, 0.9 - h) * 0.45, hipY, 0.03);
  plant(S, -0.15, 0.04 + feetZ, 0.15, -0.02 + feetZ);
  onKnob(S, c, side, wheel);
  // the other hand on the rim at the side away from the knob hand, a little below the hub
  onRim(S, c, 1 - side, wheel, side === 1 ? -1 : 1, -0.4, 0.3);
  lookAt(S, dial, 0.9);
}

// ---------------------------------------------------------------- the loading drills

// What a crew does between two shots, from its gun's drill clock (crew44.js setGun: h.drill). A drill job moves
// through key poses along a phase: keys [[p, fill], ...] in order, each fill an ordinary pose function; between
// two keys the man moves from one to the next (eased), before the first and after the last he holds them
// (keyed). A round, clip or magazine passes from hand to hand at a point both men work out the same way
// (between their spots): the key that takes it shows the prop there, the one that gives it hides it (pose44.js
// lerpSpec), so one is seen at a time. A man turns on his spot to face his work (S.turn) and steps toward it
// when it is out of reach. Sources: the 8.8 cm drill is refs/ww2/flak88 sec. 6 and 12 (K5 thrusts the round
// into the setter's cup and pulls it out when it is set, K4 takes it to the loader, K3 pushes it home by hand
// once the breech has thrown the case, steps clear and fires); the 12.8 cm twin's power rammer, its fixed 48 kg
// rounds from the hoist and "the left gun loads from the left" are refs/ww2/flak128 sec. 5, 8, 12 and 16; the
// 3.7 cm's clips onto the loading table and the 2 cm's magazine changes their sheets' sec. 6. The timing is
// the sim's: a drill is laid over the gun's own loading (h.drill.load) or magazine change (h.drill.change).
const SA = spec(), SB = spec();
const D8 = Array.from({ length: 8 }, () => new V3()); // the drills' scratch points
const ease = (t) => t * t * (3 - 2 * t);
function keyed(c, m, S, p, keys) {
  let i = 0;
  while (i < keys.length - 1 && p >= keys[i + 1][0]) i++;
  if (i === keys.length - 1 || p <= keys[i][0]) { keys[i][1](c, m, S); return; }
  const t = ease((p - keys[i][0]) / (keys[i + 1][0] - keys[i][0]));
  resetSpec(SA); SA.prop.s = S.prop.s; keys[i][1](c, m, SA);
  resetSpec(SB); SB.prop.s = S.prop.s; keys[i + 1][1](c, m, SB);
  lerpSpec(S, SA, SB, t);
}
// the turn (from his spot's facing) that puts root-space point W in front of him
const faceTurn = (c, W, max = 1.8) => (c.m.st.turn ?? 0) + clamp(Math.atan2(-W.x, -W.z), -max, max);
// A standing man working with his hands at root-space point W: turned to it, leaning and bending his knees
// the lower it is, a step toward it when it is out of reach; looks at it.
function workAt(c, m, S, W, { lean = 0.06, look: k = 0.85 } = {}) {
  POSES.stand(S, c.t / 4);
  const yaw = Math.atan2(-W.x, -W.z);
  S.turn = faceTurn(c, W);
  const low = clamp((1.12 - W.y) / 0.75, 0, 1);
  const far = clamp(Math.hypot(W.x, W.z) - 0.55, 0, 0.45);
  torsoStand(S, c, lean + 0.5 * low + 0.3 * far, 0.968 - 0.24 * low, 0.03 - 0.5 * far, clamp(yaw, -0.7, 0.7) * 0.4);
  plant(S, -0.16, 0.06 - 0.5 * far, 0.15, -0.06 - 0.9 * far);
  lookAt(S, W, k);
}
// down on his heels at root-space point W (taking something off the floor or out of a box)
function pickAt(c, m, S, W) {
  POSES.crouch(S, c.t / 4);
  S.turn = faceTurn(c, W);
  lookAt(S, W, 0.9);
}
// seated, reaching to root-space point W (a loader on the Vierling's seat)
function seatAt(c, m, S, W, lean = 0.25) {
  torsoSeat(S, c, lean + clamp((0.35 - W.y) * 0.8, 0, 0.45), clamp(Math.atan2(-W.x, -W.z), -0.8, 0.8) * 0.6, 0.03);
  seatFeet(S, -0.15, -0.4, -0.4, 0.15, -0.4, -0.4);
  S.turn = c.m.st.turn ?? 0;
  lookAt(S, W, 0.85);
}
// a hand hanging at the thigh, as an IK grip so that a drill can carry it to a grip and back
function restHand(S, i) { const s = SIDE[i]; setIKv(S.arms[i], s * 0.2, 0.83, 0.0, 0, -1, -0.1, -s, 0, 0, s * 0.5, -0.3, 1); }
const restHands = (S) => { restHand(S, 0); restHand(S, 1); };
// the round (its case head at the prop's origin, its nose along prop -Z) with its middle at W and its nose
// along D (root space); L its length, m. `toward`: where its +Y should face (else up)
function roundMid(S, W, D, L, toward = _up) {
  D8[7].copy(D).normalize();
  propAt(S, D8[6].copy(W).addScaledVector(D8[7], -0.5 * L * S.prop.s), aimQ(_q, D8[7], toward));
}
// both hands under a held round, r its radius: the hand on the side of its base at zBase from the case head,
// the other at zOther
function underRound(S, zBase, zOther, r) {
  propPt(S, 0, 0, zBase, D8[4]); propPt(S, 0, 0, zOther, D8[5]);
  const b = D8[4].x > D8[5].x ? 1 : 0;
  gripProp(S, b, 0, -r, zBase, [0, 0.3, -1], [0, 1, 0], [SIDE[b], -1, 0.3]);
  gripProp(S, 1 - b, 0, -r, zOther, [0, 0.3, -1], [0, 1, 0], [SIDE[1 - b], -1, 0.3]);
}
// a crew spot's place in its gun's turret frame (a man on the ground who follows the mount round keeps his
// place in that frame); the point k of the way from spot a to spot b, h m over the lower floor, root space;
// the level direction across the line from a to b (a load handed over lies across it, its nose to a's left)
function spotT(c, name, out) {
  const o = c.rig.anchors.crew[name], T = c.rig.pivots.turret;
  return o.parent === T ? out.copy(o.position) : out.copy(o.position).sub(T.position);
}
function between(c, a, b, k, h, out) {
  spotT(c, a, D8[0]); spotT(c, b, D8[1]);
  return c.p(c.rig.pivots.turret, lerp(D8[0].x, D8[1].x, k), Math.min(D8[0].y, D8[1].y) + h, lerp(D8[0].z, D8[1].z, k), out);
}
function across(c, a, b, out) {
  spotT(c, a, D8[0]); spotT(c, b, D8[1]);
  return c.d(c.rig.pivots.turret, D8[1].z - D8[0].z, 0, D8[0].x - D8[1].x, out).normalize();
}
// a point on a gun with its barrel run out (recoil pivot rc at rest; a an anchor on it, offsets in its space)
function atRest(c, rc, a, x, y, z, out) {
  return c.p(rc.parent, rc.position.x + a.position.x + x, rc.position.y + a.position.y + y, a.position.z + z, out);
}

// -------- the 8.8 cm: K5 at the setter's cup, K4 between, K3 at the breech (refs/ww2/flak88 sec. 6, 12)
const R88 = 0.932;
// K3 at the breech: the round along the bore, its nose s m past the chamber mouth (-0.1 just short of it, R88
// home), the right hand at its base, the left under the case until it goes in, then on the breech ring
function k3Bore(c, m, S, s, has = true) {
  const rc = c.rig.pivots.recoil, br = c.rig.anchors.breech;
  const M = atRest(c, rc, br, 0, 0, 0, D8[2]), D = c.d(br, 0, 0, -1, D8[3]);
  roundMid(S, D8[4].copy(M).addScaledVector(D, (s - 0.5 * R88) * S.prop.s), D, R88);
  S.prop.on = has;
  workAt(c, m, S, propPt(S, 0, 0, -0.3, D8[5]), { lean: 0.1 });
  gripProp(S, 1, 0.0, -0.045, -0.06, [0, 0.3, -1], [0, 1, 0], [1, -1, 0.5]);
  if (s < 0.3) gripProp(S, 0, 0.0, -0.05, -0.45, [1, 0.2, 0], [0, 1, 0], [-1, -1, 0.2]);
  else hand(S, 0, atRest(c, rc, br, -0.24, 0.12, -0.2, D8[5]), 0, -1, -0.3, 0, -1, 0, -0.8, -1, 0.3);
  lookAt(S, atRest(c, rc, br, 0, 0, 0, D8[2]), 0.9);
}
// clear of the breech, the right hand on the firing lever at the cradle's rear left, eyes on the breech
function k3Lever(c, m, S) {
  const rc = c.rig.pivots.recoil, br = c.rig.anchors.breech;
  atRest(c, rc, br, -0.3, -0.06, -0.4, D8[2]);
  workAt(c, m, S, D8[2], { lean: 0.04 });
  hand(S, 1, D8[2], 0, -1, -0.2, -1, 0, 0, 0.8, -1, 0.3);
  restHand(S, 0);
  lookAt(S, atRest(c, rc, br, 0, 0, 0, D8[3]), 0.6);
}
// a round handed over between the men at spots a and b (halfway, 1 m up, across the line from a to b); this
// man's hands under it at zBase and zOther from the case head
function handed(c, m, S, a, b, L, r, zBase, zOther, has) {
  between(c, a, b, 0.5, 1.0, D8[2]);
  roundMid(S, D8[2], across(c, a, b, D8[3]), L);
  S.prop.on = has;
  workAt(c, m, S, between(c, a, b, 0.5, 1.0, D8[2]), { lean: 0.1 });
  underRound(S, zBase, zOther, r);
}
const K3_88 = [
  [0, k3Lever],
  [0.16, (c, m, S) => handed(c, m, S, 'k3', 'k4', R88, 0.05, -0.12, -0.42, false)],
  [0.28, (c, m, S) => handed(c, m, S, 'k3', 'k4', R88, 0.05, -0.12, -0.42, true)],
  [0.46, (c, m, S) => k3Bore(c, m, S, -0.1)],
  [0.6, (c, m, S) => k3Bore(c, m, S, 0)],
  [0.8, (c, m, S) => k3Bore(c, m, S, 0.62)],
  [0.89, (c, m, S) => k3Bore(c, m, S, R88)],
  [0.9, (c, m, S) => k3Bore(c, m, S, R88, false)],
  [0.98, k3Lever],
];
// K4: a round cradled, turned to the man he hands it to (or takes it from); empty-handed, turned to him
function k4Cradle(c, m, S, to) {
  between(c, 'k4', to, 0.5, 1.0, D8[6]);
  cradle88(c, m, S, -1);
  S.turn = faceTurn(c, D8[6]);
}
const k4Empty = (to) => (c, m, S) => { workAt(c, m, S, between(c, 'k4', to, 0.5, 1.0, D8[6])); restHands(S); };
const K4_88 = [
  [0, (c, m, S) => k4Cradle(c, m, S, 'k3')],
  [0.18, (c, m, S) => handed(c, m, S, 'k3', 'k4', R88, 0.05, -0.58, -0.8, true)],
  [0.28, (c, m, S) => handed(c, m, S, 'k3', 'k4', R88, 0.05, -0.58, -0.8, true)],
  [0.38, k4Empty('k5')],
  [0.46, (c, m, S) => handed(c, m, S, 'k5', 'k4', R88, 0.05, -0.14, -0.42, false)],
  [0.54, (c, m, S) => handed(c, m, S, 'k5', 'k4', R88, 0.05, -0.14, -0.42, true)],
  [0.7, (c, m, S) => k4Cradle(c, m, S, 'k3')],
];
// K5: the round nose down in the setter's outer cup, lifted `up` m out of it, his hands round the case
function k5Cup(c, m, S, up, has = true) {
  const cup = c.rig.anchors.fuzeCups ? c.rig.anchors.fuzeCups[1] : null;
  if (cup) c.p(cup, 0, -0.08 + up, 0, D8[2]); else D8[2].set(0, 1.0 + up, -0.6);
  c.d(cup || c.rig.root, 0, -1, 0, D8[3]);
  propAt(S, D8[4].copy(D8[2]).addScaledVector(D8[3], -R88 * S.prop.s), aimQ(_q, D8[3], _z));
  S.prop.on = has;
  POSES.stand(S, c.t / 4);
  torsoStand(S, c, 0.12, 0.968, 0.02, clamp(Math.atan2(-D8[2].x, -D8[2].z), -0.5, 0.5));
  S.turn = faceTurn(c, D8[2], 0.6);
  plant(S, -0.15, 0.02, 0.13, -0.08);
  gripProp(S, 1, 0.03, 0.05, -0.22, [-1, 0, 0], [0, -1, 0], [1, -0.6, 0.4]);
  gripProp(S, 0, -0.03, 0.05, -0.44, [1, 0, 0], [0, -1, 0], [-1, -0.6, 0.4]);
  lookAt(S, D8[2], 0.8);
}
// the ready rounds K5 draws from: the rack on the setter housing beside him (flak88.js anchors.rack); his
// hands under the round (`grip`) or still at his sides, the round shown in the slot or not (`has`)
function k5Basket(c, m, S, has, grip = true) {
  const rk = c.rig.anchors.rack;
  c.p(rk, 0, 0, 0, D8[2]);
  roundMid(S, D8[2], c.d(rk, 0, 0, -1, D8[3]), R88);
  S.prop.on = has;
  workAt(c, m, S, D8[2], { lean: 0.12 });
  if (grip) underRound(S, -0.12, -0.5, 0.05); else restHands(S);
}
const K5_88 = [
  [0, (c, m, S) => k5Cup(c, m, S, 0)],
  [0.38, (c, m, S) => k5Cup(c, m, S, 0)],
  [0.46, (c, m, S) => k5Cup(c, m, S, 0.45)],
  [0.54, (c, m, S) => handed(c, m, S, 'k5', 'k4', R88, 0.05, -0.55, -0.8, true)],
  [0.58, (c, m, S) => k5Basket(c, m, S, false, false)],
  [0.6, (c, m, S) => k5Basket(c, m, S, true, false)],
  [0.68, (c, m, S) => k5Basket(c, m, S, true, false)],
  [0.74, (c, m, S) => k5Basket(c, m, S, true)],
  [0.84, (c, m, S) => { cradle88(c, m, S, 1); S.turn = 0; }],
  [0.92, (c, m, S) => k5Cup(c, m, S, 0.45)],
  [0.98, (c, m, S) => k5Cup(c, m, S, 0)],
];

// -------- the 12.8 cm twin (flak128.js LOAD, LOAD_PHASES; refs/ww2/flak128 sec. 5, 8, 12; flak105 sec. 5):
// at each gun its ammunition number takes the next round as it comes up the hoist, carries it cradled and hands
// it to the loader, both men's hands on it; the loader lays it in the gun's loading tray at rest beside him and
// pulls the release lever; the tray swings the round in behind the breech, the rollers ram it home and the tray
// swings back empty. A round no hand holds lies in the tray or stands in the hoist: the rig's machine (rig.load)
// places it, so the men's props follow the machine exactly while it moves.
const R128 = 1.488, RAD128 = 0.075;
// side -1: the left gun's loader K3 and his number K5; +1: the right gun's K4 and K6
const T128 = { '-1': { me: 'k3', ammo: 'k5', gun: 0 }, 1: { me: 'k4', ammo: 'k6', gun: 1 } };
const g128 = (side) => T128[side].gun;
// a 12.8 cm round on a rig node: its middle at the node's local (0, dy, dz), its nose along the node's -Z
function roundOn(c, S, node, dz = 0, dy = 0) {
  c.p(node, 0, dy, dz, D8[2]); c.d(node, 0, 0, -1, D8[3]); c.d(node, 0, 1, 0, D8[4]);
  roundMid(S, D8[2], D8[3], R128, D8[4]);
}
// the round in its tray as the machine has it: swinging in, then rammed (its middle moves a round's length
// forward, base at the chamber mouth); `has`: shown
function roundInTray(c, S, side, has = true) {
  roundOn(c, S, c.rig.anchors.trays[g128(side)], -R128 * c.rig.load.ram);
  S.prop.on = has && c.rig.load.ram < 1;
}
// where the round is handed over: on the platform between the two men, 1 m up, a little inboard; it lies
// across their line, its nose inboard
function handOverAt(c, side, out) {
  spotT(c, T128[side].me, D8[0]); spotT(c, T128[side].ammo, D8[1]);
  return c.p(c.rig.pivots.turret, (D8[0].x + D8[1].x) / 2 - side * 0.08, D8[0].y + 1.0, (D8[0].z + D8[1].z) / 2, out);
}
function roundHanded(c, S, side) {
  handOverAt(c, side, D8[5]);
  c.d(c.rig.pivots.turret, -side, 0, 0, D8[1]);
  roundMid(S, D8[5], D8[1], R128);
}
// the ammunition number's hands under the base half of a round handed over, the loader's under the nose half
const giverHands = (S) => underRound(S, -0.28, -0.62, RAD128);
const takerHands = (S) => underRound(S, -0.86, -1.16, RAD128);
// K3/K4, the loader: facing the hand-over, empty-handed
function loaderReady(c, m, S, side) {
  workAt(c, m, S, handOverAt(c, side, D8[5]), { lean: 0.04 });
  restHands(S);
}
// reaching for the round the number holds out (has false: still the number's), or holding it with him
function loaderTake(c, m, S, side, has) {
  roundHanded(c, S, side);
  S.prop.on = has;
  workAt(c, m, S, propPt(S, 0, 0, -1.08, D8[5]), { lean: 0.1 });
  takerHands(S);
}
// the round over the tray at rest (up m above it) or in it: the base hand under the overhanging base end, the
// other on the round's top at its middle
function loaderLay(c, m, S, side, up, has = true) {
  roundOn(c, S, c.rig.anchors.trayRest[g128(side)], 0, up);
  S.prop.on = has;
  workAt(c, m, S, propPt(S, 0, 0, -0.4, D8[5]), { lean: 0.16 });
  propPt(S, 0, 0, -0.2, D8[4]); propPt(S, 0, 0, -0.75, D8[5]);
  const b = side < 0 ? 1 : 0; // the hand nearer the base end
  gripProp(S, b, 0, -RAD128, -0.16, [0, 0.3, -1], [0, 1, 0], [SIDE[b], -1, 0.3]);
  gripProp(S, 1 - b, 0, RAD128 * 0.9, -0.6, [-side, -0.3, 0], [0, -1, 0], [SIDE[1 - b], 0.3, 0.8]);
}
// his hand on the release lever's knob (the round in the tray, the machine's), the other at rest
function loaderLever(c, m, S, side, pull) {
  const lv = c.rig.anchors.levers[g128(side)];
  c.p(lv, side * 0.04 * pull, 0.05 - 0.06 * pull, 0.04 * pull, D8[6]);
  workAt(c, m, S, D8[6], { lean: 0.12 });
  const i = side < 0 ? 0 : 1; // the hand on the gun's side
  hand(S, i, D8[6], 0, -1, -0.2, -side, 0, 0, SIDE[i] * 0.6, -1, 0.3);
  restHand(S, 1 - i);
  roundInTray(c, S, side);
}
// clear of the swinging tray, watching the breech; the round the machine's while it is still out of the bore
function loaderWatch(c, m, S, side) {
  const br = c.rig.anchors.breeches[g128(side)];
  c.p(br, 0, 0, 0, D8[6]);
  workAt(c, m, S, c.p(c.rig.anchors.trayRest[g128(side)], 0, 0, 0, D8[5]), { lean: 0.02, look: 0 });
  restHands(S);
  lookAt(S, D8[6], 0.8);
  roundInTray(c, S, side);
}
const LOADER128 = Object.fromEntries([-1, 1].map((side) => [side, [
  [0, (c, m, S) => loaderReady(c, m, S, side)],
  [0.12, (c, m, S) => loaderTake(c, m, S, side, false)],
  [0.22, (c, m, S) => loaderTake(c, m, S, side, true)],
  [0.36, (c, m, S) => loaderLay(c, m, S, side, 0.14)],
  [0.44, (c, m, S) => loaderLay(c, m, S, side, 0)],
  [0.47, (c, m, S) => loaderLever(c, m, S, side, 0)],
  [0.53, (c, m, S) => loaderLever(c, m, S, side, 1)],
  [0.58, (c, m, S) => loaderWatch(c, m, S, side)],
  [0.9, (c, m, S) => loaderWatch(c, m, S, side)],
  [0.98, (c, m, S) => loaderReady(c, m, S, side)],
]]));
// K5/K6, the ammunition number: the round cradled across him at the waist, turned to the hand-over
function numberCradle(c, m, S, side) {
  POSES.carry(S, c.t / 4);
  torsoStand(S, c, -0.06, 0.94, 0.04);
  S.turn = faceTurn(c, handOverAt(c, side, D8[2]), 3.2);
  plant(S, -0.17, 0.02, 0.16, -0.04);
  roundMid(S, D8[2].set(0, 0.97, -0.3), D8[3].set(-side, 0, 0), R128);
  S.prop.on = true;
  underRound(S, -0.35, -1.1, RAD128);
  glance(S, c, m, 0.4);
}
// holding it out at the hand-over (has false: the loader has it now, his hands still near it)
function numberGive(c, m, S, side, has) {
  roundHanded(c, S, side);
  S.prop.on = has;
  workAt(c, m, S, propPt(S, 0, 0, -0.4, D8[5]), { lean: 0.1 });
  if (has) giverHands(S); else restHands(S);
}
// at the hoist: the round coming up it (the machine's, rig.load.rise), his hands on its upper part once he
// takes it (`grip`), lifted `up` m out of the mouth
function numberHoist(c, m, S, side, grip, up = 0) {
  const ho = c.rig.anchors.hoists[g128(side)];
  const drop = grip ? 0 : (1 - c.rig.load.rise) * 1.7;
  c.p(ho, 0, R128 / 2 - drop + up, 0, D8[2]);
  c.d(ho, 0, 1, 0, D8[3]);
  D8[4].set(-D8[2].x, 0, -D8[2].z).normalize(); // its +Y toward him
  roundMid(S, D8[2], D8[3], R128, D8[4]);
  S.prop.on = true;
  c.p(ho, 0, 1.0, 0, D8[5]);
  workAt(c, m, S, D8[5], { lean: 0.1 });
  if (grip) {
    gripProp(S, 1, 0.05, RAD128 * 0.8, -0.85, [-1, 0, 0], [0, -1, 0], [1, -0.6, 0.4]);
    gripProp(S, 0, -0.05, RAD128 * 0.8, -1.1, [1, 0, 0], [0, -1, 0], [-1, -0.6, 0.4]);
  } else restHands(S);
}
// turned away to the hoist, the round not up yet (nothing shown)
function numberToHoist(c, m, S, side) {
  workAt(c, m, S, c.p(c.rig.anchors.hoists[g128(side)], 0, 1.0, 0, D8[5]), { lean: 0.02 });
  restHands(S);
}
const AMMO128 = Object.fromEntries([-1, 1].map((side) => [side, [
  [0, (c, m, S) => numberCradle(c, m, S, side)],
  [0.12, (c, m, S) => numberGive(c, m, S, side, true)],
  [0.22, (c, m, S) => numberGive(c, m, S, side, true)],
  [0.26, (c, m, S) => numberGive(c, m, S, side, false)],
  [0.32, (c, m, S) => numberToHoist(c, m, S, side)],
  [0.33, (c, m, S) => numberHoist(c, m, S, side, false)],
  [0.47, (c, m, S) => numberHoist(c, m, S, side, false)],
  [0.52, (c, m, S) => numberHoist(c, m, S, side, true)],
  [0.62, (c, m, S) => numberHoist(c, m, S, side, true, 0.25)],
  [0.76, (c, m, S) => numberCradle(c, m, S, side)],
]]));

// -------- the 3.7 cm: the loader lays the clips on the table, the two ammunition numbers bring them in turn
// K3 with a clip over the table's left end, `down` of the way from 6 cm over it to laid on it
function k3Clip(c, m, S, down, has = true) {
  POSES.stand(S, c.t / 4);
  const feed = c.rig.anchors.feed;
  c.p(feed, -0.12 + 0.06 * down, 0.06 - 0.055 * down, 0.02, D8[2]);
  c.d(feed, 0, 0, -1, D8[3]); c.d(feed, 0, 1, 0, D8[4]);
  propAt(S, D8[2], aimQ(_q, D8[3], D8[4]));
  S.prop.on = has;
  propPt(S, 0, 0, 0, D8[5]);
  const low = clamp((1.1 - D8[5].y) / 0.5, 0, 1);
  torsoStand(S, c, 0.2 + 0.35 * low, 0.968 - 0.12 * low, 0.03, clamp(Math.atan2(-D8[5].x, -D8[5].z), -0.6, 0.6));
  S.turn = faceTurn(c, D8[5], 0.5);
  plant(S, -0.15, 0.06, 0.15, -0.06);
  gripProp(S, 0, -0.19, -0.03, 0.0, [0, 0.3, -1], [0.3, 1, 0], [-1, -1, 0.3]);
  gripProp(S, 1, 0.19, -0.03, 0.0, [0, 0.3, -1], [-0.3, 1, 0], [1, -1, 0.3]);
  lookAt(S, D8[5], 0.9);
}
// the ammunition number whose turn it is to hand the loader his next clip (they take turns)
const clipBy = (h) => (h.drill.loads % 2 ? 'k4' : 'k5');
// a clip handed to the loader by `from`: halfway between them 1 m up, the rounds' noses toward the loader; the
// giver holds it by its rear, the loader takes it by its front
function handedClip(c, m, S, from, giver, has) {
  spotT(c, 'k3', D8[0]); spotT(c, from, D8[1]);
  c.d(c.rig.pivots.turret, D8[0].x - D8[1].x, 0, D8[0].z - D8[1].z, D8[3]).normalize();
  propAt(S, between(c, 'k3', from, 0.5, 1.0, D8[2]), aimQ(_q, D8[3]));
  S.prop.on = has;
  workAt(c, m, S, D8[2], { lean: 0.08 });
  const z = giver ? 0.1 : -0.12, f = giver ? -1 : 1, x = giver ? 0.19 : -0.19;
  gripProp(S, 1, x, -0.03, z, [0, 0.3, f], [0, 1, 0], [1, -1, 0.3]);
  gripProp(S, 0, -x, -0.03, z, [0, 0.3, f], [0, 1, 0], [-1, -1, 0.3]);
}
const K3_37_LAY = [[0, (c, m, S) => k3Clip(c, m, S, 0)], [0.8, (c, m, S) => k3Clip(c, m, S, 1)]];
const K3_37_FETCH = [
  [0, (c, m, S) => k3Clip(c, m, S, 1, false)],
  [0.4, (c, m, S) => handedClip(c, m, S, clipBy(c.h), false, false)],
  [0.7, (c, m, S) => handedClip(c, m, S, clipBy(c.h), false, true)],
  [1.3, (c, m, S) => k3Clip(c, m, S, 0)],
];
// an ammunition number: a clip ready at his belt, turned to the loader; on his turn he hands it over and
// fetches the next from the ready box at his right
function clipReady(c, m, S) {
  between(c, 'k3', m.job, 0.5, 1.0, D8[6]);
  cradleClip(c, m, S);
  S.turn = faceTurn(c, D8[6]);
}
function clipBox(c, m, S, has) {
  propAt(S, D8[2].set(0.5, 0.32, -0.15), eul(_q, 0, -Math.PI / 2, 0));
  S.prop.on = has;
  pickAt(c, m, S, D8[2]);
  gripProp(S, 0, -0.17, -0.03, 0.0, [0, 0.3, -1], [0.2, 1, 0], [-1, -1, 0.3]);
  gripProp(S, 1, 0.17, -0.03, 0.0, [0, 0.3, -1], [-0.2, 1, 0], [1, -1, 0.3]);
}
const CARRIER_37 = [
  [0, clipReady],
  [0.4, (c, m, S) => handedClip(c, m, S, m.job, true, true)],
  [0.7, (c, m, S) => handedClip(c, m, S, m.job, true, true)],
  [0.85, (c, m, S) => { clipBox(c, m, S, false); POSES.stand(S, c.t / 4); torsoStand(S, c, 0.1, 0.96, 0.03); plant(S, -0.15, 0.04, 0.14, -0.06); restHands(S); }],
  [1.4, (c, m, S) => clipBox(c, m, S, false)],
  [1.55, (c, m, S) => clipBox(c, m, S, true)],
  [2.3, clipReady],
];

// -------- the 2 cm: a magazine change (the empty one off, a full one into the well), then the next to hand
// which way gun i's magazine sticks out from its well (the Flak 38's to its left; the Vierling's outboard)
const magSide = (c, i) => (c.rig.anchors.magazines ? (i === 0 || i === 3 ? -1 : 1) : -1);
// the middle of gun i's magazine in its well, `out` m further out along it (root space); the well's frame into
// D8[3] (forward) and D8[4] (up)
function magPoint(c, i, out, out3) {
  const a = c.rig.anchors.magazines ? c.rig.anchors.magazines[i] : c.rig.anchors.magazine;
  c.d(a, 0, 0, -1, D8[3]); c.d(a, 0, 1, 0, D8[4]);
  return c.p(a, magSide(c, i) * ((c.rig.anchors.magazines ? 0.15 : 0.2) + out), -0.01, 0, out3);
}
// stage 0: the left hand on the empty magazine (in it: mag20L), the full one held low; 1: the empty one pulled
// away and dropped; 2: the full one at the well's mouth; 3: home in the well. Standing, or seated.
function magChange(c, m, S, i, stage, seated) {
  if (stage >= 2) {
    const W = magPoint(c, i, stage >= 3 ? 0 : 0.3, D8[2]);
    propAt(S, W, aimQ(_q, D8[3], D8[4]));
    S.prop.on = true;
    if (seated) seatAt(c, m, S, W); else workAt(c, m, S, W, { lean: 0.1 });
    const s = magSide(c, i);
    gripProp(S, s < 0 ? 0 : 1, s * 0.13, 0.04, 0.0, [s, -0.4, 0], [0, -1, 0], [SIDE[s < 0 ? 0 : 1], -1, 0.3]);
    gripProp(S, s < 0 ? 1 : 0, s * 0.02, 0.0, 0.05, [0, -0.3, -1], [0, 0, -1], [SIDE[s < 0 ? 1 : 0], -1, 0.3]);
    return;
  }
  const W = magPoint(c, i, 0, D8[2]);
  if (seated) seatAt(c, m, S, W); else workAt(c, m, S, W, { lean: 0.1 });
  S.prop.on = true;
  if (seated) { propAt(S, D8[5].set(0, 0.26, -0.4), eul(_q, 0, 0, 0)); gripProp(S, 1, 0.13, 0.04, 0.0, [0, -0.3, -1], [-0.3, -0.2, 1], [1, -1, 0.3]); }
  else { propAt(S, D8[5].set(0.25, 0.62, -0.03), eul(_q, 0, Math.PI / 2, Math.PI / 2)); gripProp(S, 1, 0.155, 0.0, 0.0, [0, -1, 0], [-1, 0, 0], [1, -0.3, 0.8]); }
  if (stage === 0) hand(S, 0, W, 0, -1, 0, 0, 0, 1, -0.8, -1, 0.3);
  else hand(S, 0, D8[6].set(-0.5, seated ? 0.15 : 0.6, -0.05), 0, -1, 0, 1, 0, 0, -1, -0.3, 0.6);
}
// the change keys (the magazine prop: mag20pair while he has the empty one, see magProp) and after it: the
// hands off the well, then the next full one from the box at his feet (standing) or the rack in front (seated)
const MAG_DROP = 0.33;
const magProp = (h, i) => (h.drill.change[i] >= 0 && h.drill.change[i] < MAG_DROP ? 'mag20pair' : 'mag20');
const changeKeys = (i, seated) => [
  [0, (c, m, S) => magChange(c, m, S, i, 0, seated)],
  [0.3, (c, m, S) => magChange(c, m, S, i, 1, seated)],
  [0.38, (c, m, S) => magChange(c, m, S, i, 1, seated)],
  [0.55, (c, m, S) => magChange(c, m, S, i, 2, seated)],
  [0.85, (c, m, S) => magChange(c, m, S, i, 3, seated)],
];
function magFetch(c, m, S, seated, has) {
  if (seated) {
    // the rack on the platform in front of his seat (flakvierling.js: eight a side, lips down)
    c.p(c.rig.pivots.turret, (m.job === 'k2' ? -1 : 1) * 0.8, 0.31, 0.08, D8[2]);
    propAt(S, D8[2], eul(_q, 0, Math.PI / 2, Math.PI / 2));
    seatAt(c, m, S, D8[2], 0.4);
  } else {
    propAt(S, D8[2].set(-0.35, 0.18, 0.2), eul(_q, 0, 0, 0));
    pickAt(c, m, S, D8[2]);
  }
  S.prop.on = has;
  gripProp(S, 0, -0.12, 0.05, 0.0, [0, -0.3, -1], [0, -1, 0], [-1, -1, 0.3]);
  gripProp(S, 1, 0.12, 0.05, 0.0, [0, -0.3, -1], [0, -1, 0], [1, -1, 0.3]);
}
const afterKeys = (i, seated, ready) => [
  [0, (c, m, S) => { magChange(c, m, S, i, 3, seated); S.prop.on = false; }],
  [0.35, (c, m, S) => { magFetch(c, m, S, seated, false); if (!seated) { POSES.stand(S, c.t / 4); torsoStand(S, c, 0.1, 0.96, 0.03); plant(S, -0.15, 0.04, 0.14, -0.06); restHands(S); } }],
  [0.75, (c, m, S) => magFetch(c, m, S, seated, false)],
  [0.9, (c, m, S) => magFetch(c, m, S, seated, true)],
  [1.5, (c, m, S) => { ready(c, m, S); S.turn = 0; }],
];

// -------- how the men take a shot: at the heavy guns all of them flinch from the blast (the head ducks, the
// shoulders come up) for a moment, a man at the binoculars or the rangefinder less; at the light guns the layer
// is shaken by the gun while it fires
const blast = (s) => (s < 0.06 ? s / 0.06 : Math.exp(-(s - 0.06) / 0.3));
function flinch(c, m, S) {
  const d = c.h.drill;
  if (!(d.since < 1.6)) return;
  const k = blast(d.since) * (m.propNow === 'bino' || m.propNow === 'rangefinder' ? 0.3 : 1);
  S.shrug[0] += 0.035 * k; S.shrug[1] += 0.035 * k;
  S.headQ.multiply(eul(_q, -0.3 * k, (m.seed > 0.5 ? 0.15 : -0.15) * k, 0));
  S.chestQ.multiply(eul(_q, -0.06 * k, 0, 0));
  S.hips.y -= 0.025 * k;
}
function shaken(c, m, S) {
  const d = c.h.drill;
  if (m.job !== 'k1' || !(d.since < 0.2)) return;
  const k = 1 - d.since / 0.2, ph = c.t * 70;
  S.hips.x += 0.006 * k * Math.sin(ph); S.hips.z += 0.008 * k * Math.sin(ph * 1.3);
  S.headQ.multiply(eul(_q, 0.02 * k * Math.sin(ph * 0.9), 0.015 * k * Math.sin(ph * 1.1), 0));
}
export const REACT = { flak88: flinch, flak128: flinch, flak43: shaken, flak38: shaken, flakvierling: shaken, 'flakvierling-tower': shaken };

// ---------------------------------------------------------------- the jobs, by rig kind

// turret-space points of the 88's right-side receivers (dial faces) and the fuze receiver
const F88P = {
  recvEl: [0.53, 0.71, 0.195], recvAz: [0.53, 0.71, -0.195], fuzeDial: [-0.57, 0.48, -0.31], crank: [-0.915, 0.21, -0.36],
};

const flak88 = {
  // K1, K2: the layers standing at the right-side handwheels, headsets on, eyes on their receivers
  k1: {
    role: 'tech', kit: ['headset'], place: stepIn(0.07),
    pose(c, m, S) { crank(c, m, S, 'wheelEl', 1, c.p(c.rig.pivots.turret, ...F88P.recvEl, P[1])); },
    easy: atEase,
  },
  k2: {
    role: 'tech', kit: ['headset'], place: stepIn(0.07),
    pose(c, m, S) { crank(c, m, S, 'wheelAz', 1, c.p(c.rig.pivots.turret, ...F88P.recvAz, P[1])); },
    easy: atEase,
  },
  // K6: the fuze setter on his seat at the front of the setter, the left hand on the command handwheel, the
  // right on the flywheel crank, eyes on the fuze receiver; his knees either side of the setter's housing
  k6: {
    role: 'tech', kit: ['headset'],
    pose(c, m, S) {
      const T = c.rig.pivots.turret;
      torsoSeat(S, c, 0.32, -0.08, 0.02);
      const fl = c.p(T, 0, -0.575, 0, P[0]).y; // the deck under him
      seatFeet(S, -0.27, fl, -0.43, 0.29, fl, -0.43);
      S.feet[0].pole.set(-0.6, 0.5, -1); S.feet[1].pole.set(0.6, 0.5, -1);
      onKnob(S, c, 0, 'wheelFz');
      c.p(T, ...F88P.crank, P[1]);
      hand(S, 1, P[1], 0, -1, 0, -1, 0, 0, 1, -0.5, 0);
      lookAt(S, c.p(T, ...F88P.fuzeDial, P[2]), 1);
    },
    easy: sitEasy,
  },
  // K3 the loader at the left rear of the breech (a thick loading glove, LeMO Bienert), K4 between the setter
  // and him, K5 at the setter's outer cup: the loading drill (K3_88, K4_88, K5_88), one cycle per round
  k3: { role: 'gunner', busy: true, gloves: true, ease: 14, prop: () => 'round88', pose: (c, m, S) => keyed(c, m, S, c.h.drill.load, K3_88), easy: atEase },
  k4: { role: 'gunner', busy: true, ease: 14, prop: () => 'round88', pose: (c, m, S) => keyed(c, m, S, c.h.drill.load, K4_88), easy: atEase },
  k5: { role: 'tech', busy: true, ease: 14, prop: () => 'round88', place: stepIn(0.22), pose: (c, m, S) => keyed(c, m, S, c.h.drill.load, K5_88), easy: atEase },
  // the gun commander, at the pit's left rear, headset and binoculars
  gf: { role: 'nco', kit: binoKit, prop: binoProp, pose: commander, place: turnObserver, easy: atEase },
  // K7, K8: the ammunition carriers at their niches: one kneels to draw a round, the other holds one ready
  k7: {
    role: 'carrier', busy: true, gloves: true, prop: (c, m) => (niche(c, m) ? null : 'round88'),
    pose(c, m, S) { if (niche(c, m)) { POSES.kneel(S, c.t / 5); kneelReach(c, m, S); } else cradle88(c, m, S); },
    easy: atEase,
  },
  k8: {
    role: 'carrier', busy: true, gloves: true, prop: (c, m) => (niche(c, m, 0.5) ? null : 'round88'),
    pose(c, m, S) { if (niche(c, m, 0.5)) { POSES.kneel(S, c.t / 5); kneelReach(c, m, S); } else cradle88(c, m, S); },
    easy: atEase,
  },
};
// the carriers take turns at the niche (about 9 s kneeling, 14 s holding a round)
const niche = (c, m, off = 0) => ((c.t / 23 + off + m.seed) % 1) < 0.4;
function kneelReach(c, m, S) {
  // both hands into the niche's rack in front of him
  for (let i = 0; i < 2; i++) { const s = SIDE[i]; setIKv(S.arms[i], s * 0.12, 0.62, -0.62, 0, -0.2, -1, 0, -1, 0, s * 0.8, -1, 0.3); }
  lookAt(S, P[0].set(0, 0.6, -0.9), 1);
}

// the Kommandogeraet 40 (battery sec. 1.6): commander and five, standing on the platform that turns with it
const KG = { panelM: xf(0.23, 1.02, 0.31, 0.72, 0, 0), wins: [-0.32, 0, 0.32] };
const kgKnob = (c, k, out) => out.set(KG.wins[k] + 0.07, 0.12, -0.09).applyMatrix4(KG.panelM).applyMatrix4(c.rig.pivots.turret.matrixWorld).applyMatrix4(c.m.inv);
const kgWin = (c, k, out) => out.set(KG.wins[k], 0.06, 0).applyMatrix4(KG.panelM).applyMatrix4(c.rig.pivots.turret.matrixWorld).applyMatrix4(c.m.inv);
function tracker(c, m, S, side, wheel, ex) {
  POSES.stand(S, c.t / 4);
  const el = c.rig.pivots.elevation;
  c.p(el, ex, 0.235, 0.27, P[0]); // the telescope's eyecups
  c.d(el, 0, 0, -1, P[1]);
  plant(S, -0.15, 0.06, 0.15, -0.02);
  eyeSolve(S, P[0], P[1], 'stand', m.st);
  onKnob(S, c, side, wheel);
  // the other hand on the tube's carrying handle (or the cabinet's top edge)
  c.p(el, ex * 1.55, 0.26, 0.02, P[2]);
  hand(S, 1 - side, P[2], 0, -1, 0.3, 0, -1, 0, SIDE[1 - side] * 0.6, -1, 0.4);
}
const kdo40 = {
  cmd: { role: 'nco', kit: binoKit, prop: binoProp, pose: commander, easy: atEase },
  // No. 1, the rangetaker, at the stereo eyepiece out on the left arm, hands on the tube
  r1: {
    role: 'tech', kit: ['headset'],
    pose(c, m, S) {
      POSES.stand(S, c.t / 4);
      const el = c.rig.pivots.elevation;
      c.p(c.rig.anchors.sight, 0, 0, 0.05, P[0]);
      c.d(c.rig.anchors.sight, 0, 0, -1, P[1]);
      plant(S, -0.16, 0.06, 0.14, -0.02);
      eyeSolve(S, P[0], P[1], 'stand', m.st);
      hand(S, 0, c.p(el, -1.95, 0.04, 0.12, P[2]), 0, -0.4, -1, 0.3, 0, 1, -0.7, -1, 0.3);
      hand(S, 1, c.p(el, -1.38, 0.04, 0.14, P[3]), 0, -0.4, -1, -0.3, 0, 1, 0.7, -1, 0.3);
    },
    easy: atEase,
  },
  r2: { role: 'tech', kit: ['headset'], pose: (c, m, S) => tracker(c, m, S, 0, 'wheelAz', -0.88), easy: atEase },
  r3: { role: 'tech', kit: ['headset'], pose: (c, m, S) => tracker(c, m, S, 1, 'wheelEl', 0.88), easy: atEase },
  // Nos. 4 and 5 at the sloped panel: a knob in each hand, eyes on their window
  r4: { role: 'tech', kit: ['headset'], pose: (c, m, S) => panelMan(c, m, S, 0), easy: atEase },
  r5: { role: 'tech', kit: ['headset'], pose: (c, m, S) => panelMan(c, m, S, 2), easy: atEase },
};
function panelMan(c, m, S, k) {
  POSES.stand(S, c.t / 4);
  kgWin(c, k, P[0]);
  const lean = clamp((1.25 - P[0].y) * 0.9, 0.05, 0.6);
  torsoStand(S, c, lean, 0.965, 0.03, clamp(Math.atan2(-P[0].x, -P[0].z), -0.5, 0.5));
  plant(S, -0.14, 0.04, 0.14, -0.02);
  kgKnob(c, k, P[1]);
  const press = Math.max(0, Math.sin(c.t * 2.1 + m.seed * 7)) ** 6 * 0.012;
  hand(S, 1, P[1].addScaledVector(_v.set(0, -1, 0), press), 0, -0.7, -0.7, 0, -1, 0, 0.7, -1, 0.3);
  // the other hand rests on the panel's edge beside his window
  P[2].copy(P[0]).add(_v.set(-0.17, -0.02, 0.1));
  hand(S, 0, P[2], 0, -0.7, -0.7, 0, -1, 0, -0.7, -1, 0.3);
  lookAt(S, P[0], 1);
}

// the Wuerzburg D (battery sec. 3.1): the antenna operator in the sidecar seat, the range and height operators
// standing at the CRT unit, the set's commander, the telephone man at the box on its post
const WZ = { hood: [-0.66, 1.3, 0.32], crt: [[-0.33, 1.3, 1.0], [-0.11, 1.3, 1.0], [-0.22, 1.1, 1.0]], phone: [1.4, 1.05, 3.1] };
const wurzburg = {
  op1: {
    role: 'tech', kit: ['headset'],
    pose(c, m, S) {
      const T = c.rig.pivots.turret;
      torsoSeat(S, c, 0.15, 0, 0.0);
      // inside the tub: the feet on its floor
      const fl = c.p(T, 0, 0.06, 0, P[0]).y;
      seatFeet(S, -0.14, fl, -0.32, 0.14, fl, -0.32);
      c.p(T, ...WZ.hood, P[1]);
      _v.set(0, 0, -1).transformDirection(T.matrixWorld).transformDirection(c.m.inv);
      eyeSolve(S, P[1], _v, 'seat', m.st);
      // the left hand on the azimuth wheel's rim nearest him, the right on the elevation wheel
      onRim(S, c, 0, 'wheelAz', -1, 0, 0.7);
      onRim(S, c, 1, 'wheelEl', 0, 0.7, 0.7);
    },
    easy: sitEasy,
  },
  op2: { role: 'tech', kit: ['headset'], pose: (c, m, S) => crtMan(c, m, S, 0, true), easy: atEase },
  op3: { role: 'tech', kit: ['headset'], pose: (c, m, S) => crtMan(c, m, S, 1, false), easy: atEase },
  cmd: { role: 'nco', kit: binoKit, prop: binoProp, pose: commander, place: turnObserver, easy: atEase },
  // the telephone man: the spot faces away from the box, so he turns to it; handset at the left ear
  op4: {
    role: 'tech', prop: () => 'handset',
    place(h, m) {
      // face the telephone box on its post (rig space WZ.phone)
      const e = m.W.elements, p = _v.set(...WZ.phone).applyMatrix4(h.rig.root.matrixWorld);
      const yaw = Math.atan2(-(p.x - e[12]), -(p.z - e[14])), base = Math.atan2(-e[8], -e[10]);
      m.W.multiply(_m.makeRotationY(wrapPi(yaw - base)));
    },
    pose(c, m, S) {
      POSES.stand(S, c.t / 4);
      torsoStand(S, c, 0.08, 0.968, 0.02);
      plant(S, -0.14, 0.03, 0.14, -0.03);
      eyeOf(S, P[0]);
      // the handset at the left ear, the earpiece on it, the mouthpiece at the chin
      propAt(S, P[1].set(-0.1, P[0].y - 0.02, P[0].z + 0.08), eul(_q, 0.25, 0.35, -0.2));
      gripProp(S, 0, 0.02, -0.09, -0.035, [0, 0.3, -1], [1, 0, 0], [-1, -0.7, 0.2]);
      // the right hand on the box (turning the magneto now and then)
      c.w(_v.set(...WZ.phone).applyMatrix4(c.rig.root.matrixWorld), P[2]);
      const turn = (c.t * 0.25 + m.seed) % 1 < 0.15 ? c.t * 9 : 0;
      P[2].x += 0.15 + 0.03 * Math.cos(turn); P[2].y += -0.03 + 0.03 * Math.sin(turn); P[2].z += 0.08;
      hand(S, 1, P[2], 0, -0.5, -1, -1, 0, 0, 1, -1, 0.3);
      lookAt(S, P[2], 0.6);
      glance(S, c, m, 0.4);
    },
    easy: atEase,
  },
};
function crtMan(c, m, S, k, wheel) {
  POSES.stand(S, c.t / 4);
  const T = c.rig.pivots.turret;
  c.p(T, ...WZ.crt[k], P[0]);
  _v.set(0, -0.3, -1).normalize().transformDirection(T.matrixWorld).transformDirection(c.m.inv);
  plant(S, -0.15, 0.06, 0.15, -0.02);
  eyeSolve(S, P[0], _v, 'stand', m.st);
  if (wheel) {
    onKnob(S, c, 0, 'wheelRange');
    hand(S, 1, c.p(T, 0.03, 1.43, 0.62, P[3]), 0, -1, -0.3, 0, -1, 0, 0.7, -1, 0.3);
  } else {
    // the height operator leans in from the unit's right: his left hand on its top edge, the right on its side
    hand(S, 0, c.p(T, -0.02, 1.43, 0.72, P[2]), -0.3, -1, -0.3, 0, -1, 0, -0.7, -1, 0.3);
    hand(S, 1, c.p(T, 0.05, 1.22, 0.66, P[3]), -1, -0.3, 0, -1, 0, 0, 0.8, -1, 0.2);
  }
}

// the 3.7 cm Flak 43 (flak43 sec. 6): the layer and the sight setter seated on the right, the loader standing
// at the table on the left, two ammunition numbers, the gun commander behind
const flak43 = {
  k1: {
    role: 'gunner',
    pose(c, m, S) {
      const T = c.rig.pivots.turret;
      torsoSeat(S, c, 0.4, 0, 0.04);
      // the right foot on the firing pedal, the left on its rest (turret space)
      c.p(T, 0.42, 0.12, 0.02, P[0]); c.p(T, 0.3, 0.13, 0.08, P[1]);
      seatFeet(S, P[1].x, P[1].y - ANK, P[1].z, P[0].x, P[0].y - ANK, P[0].z);
      c.p(c.rig.anchors.sight, 0, 0, 0.06, P[2]);
      c.d(c.rig.anchors.sight, 0, 0, -1, P[3]);
      eyeSolve(S, P[2], P[3], 'seat', m.st);
      // both handwheels at once: the right hand the vertical (elevation), the left the horizontal (traverse)
      onKnob(S, c, 1, 'wheelEl');
      onKnob(S, c, 0, 'wheelTr');
    },
    easy: sitEasy,
  },
  k2: {
    role: 'gunner',
    pose(c, m, S) {
      torsoSeat(S, c, 0.42, 0.25, 0.03);
      seatFeet(S, -0.16, -0.3, -0.34, 0.16, -0.3, -0.34);
      // leaning over to the sight on his left: the left hand on its flight direction knob, the right on his knee
      c.p(c.rig.anchors.sight, 0.05, -0.02, -0.06, P[0]);
      hand(S, 0, P[0], 0, -1, 0, 0, -1, 0, -0.7, -1, 0.3);
      setIKv(S.arms[1], 0.15, 0.17, -0.36, 0, -0.5, -1, 0, -1, 0, 0.8, -1, 0.3);
      c.p(c.rig.anchors.sight, 0, 0, 0, P[1]);
      lookAt(S, P[1], 1);
    },
    easy: sitEasy,
  },
  // K3: lays the 8-round clips on the table's left end as it empties, and takes the next from an ammunition
  // number (K3_37_LAY while the gun is loading, K3_37_FETCH after)
  k3: {
    role: 'gunner', busy: true, gloves: true, ease: 14, prop: () => 'clip37',
    pose: (c, m, S) => (c.h.drill.loading ? keyed(c, m, S, c.h.drill.load, K3_37_LAY) : keyed(c, m, S, c.h.drill.done, K3_37_FETCH)),
    easy: atEase,
  },
  // K4 and K5 hand him the clips in turn, keeping their places as the mount turns
  k4: { role: 'carrier', busy: true, gloves: true, ease: 14, prop: () => 'clip37', pose: carrier37, place: followMount, easy: atEase },
  k5: { role: 'carrier', busy: true, gloves: true, ease: 14, prop: () => 'clip37', pose: carrier37, place: followMount, easy: atEase },
  gf: { role: 'nco', kit: binoKit, prop: binoProp, pose: commander, place: turnObserver, easy: atEase },
};
function carrier37(c, m, S) {
  if (clipBy(c.h) === m.job) keyed(c, m, S, c.h.drill.done, CARRIER_37); else clipReady(c, m, S);
  stepping(c, m, S);
}
// a man on the ground near the gun faces the mount (the rigs' facings for some of these point away)
function faceGun(h, m) {
  const e = m.W.elements, p = _v.setFromMatrixPosition(h.rig.pivots.turret.matrixWorld);
  const yaw = Math.atan2(-(p.x - e[12]), -(p.z - e[14])), base = Math.atan2(-e[8], -e[10]);
  m.W.multiply(_m.makeRotationY(wrapPi(yaw - base)));
}

// the 2 cm Flakvierling 38 (flakvierling sec. 6): the layer and two loaders seated on the mount, the commander
// standing on its left half, the range setter, the range-taker and two ammunition numbers on the ground
function vierlingLayer(c, m, S) {
  const T = c.rig.pivots.turret;
  torsoSeat(S, c, 0.3, 0, 0.03);
  c.p(T, -0.12, 0.21, 0.85, P[0]); c.p(T, 0.12, 0.21, 0.85, P[1]);
  seatFeet(S, P[0].x, P[0].y - ANK + 0.01, P[0].z, P[1].x, P[1].y - ANK + 0.01, P[1].z);
  c.p(c.rig.anchors.sight, 0, 0, 0.06, P[2]);
  c.d(c.rig.anchors.sight, 0, 0, -1, P[3]);
  eyeSolve(S, P[2], P[3], 'seat', m.st);
  onKnob(S, c, 1, 'wheelEl');
  onKnob(S, c, 0, 'wheelTr');
}
// a loader on his seat: a full magazine ready on his knees, facing his guns
function vierlingLoader(c, m, S) {
  torsoSeat(S, c, 0.25, 0, 0.03);
  seatFeet(S, -0.15, -0.4, -0.4, 0.15, -0.4, -0.4);
  propAt(S, P[0].set(0, 0.26, -0.4), eul(_q, 0.0, 0.0, 0));
  gripProp(S, 0, -0.13, 0.04, 0.0, [0, -0.3, -1], [0.3, -0.2, 1], [-1, -1, 0.3]);
  gripProp(S, 1, 0.13, 0.04, 0.0, [0, -0.3, -1], [-0.3, -0.2, 1], [1, -1, 0.3]);
  // looking at his guns' magazines
  const mags = c.rig.anchors.magazines;
  if (mags) { c.p(mags[m.job === 'k2' ? 0 : 1], 0, 0, 0, P[1]); lookAt(S, P[1], 0.8); }
  glance(S, c, m, 0.3);
}
// the loaders change their guns' magazines as they empty: K2 the left guns 1L and 4L, K3 the right 2R and 3R
const VLOAD = { k2: [0, 3], k3: [1, 2] };
// which of his guns the loader is busy with: one being changed, else the one changed last
function vGun(h, job) {
  const d = h.drill, [a, b] = VLOAD[job];
  if (d.change[a] >= 0) return a;
  if (d.change[b] >= 0) return b;
  return (d.after[a] ?? Infinity) <= (d.after[b] ?? Infinity) ? a : b;
}
const V_CHANGE = [0, 1, 2, 3].map((i) => changeKeys(i, true)), V_AFTER = [0, 1, 2, 3].map((i) => afterKeys(i, true, vierlingLoader));
function vierlingDrill(c, m, S) {
  const i = vGun(c.h, m.job), d = c.h.drill;
  if (d.change[i] >= 0) keyed(c, m, S, d.change[i], V_CHANGE[i]); else keyed(c, m, S, d.after[i] ?? Infinity, V_AFTER[i]);
}
const vLoader = { role: 'gunner', busy: true, gloves: true, ease: 14, prop: (c, m) => magProp(c.h, vGun(c.h, m.job)), pose: vierlingDrill, easy: sitEasy };
const vierling = {
  k1: { role: 'gunner', pose: vierlingLayer, easy: sitEasy },
  k2: vLoader,
  k3: vLoader,
  gf: { role: 'nco', kit: binoKit, prop: binoProp, pose: commander, easy: atEase },
  k4: {
    role: 'tech', place: faceGun,
    pose(c, m, S) {
      // calls the ranges up to the sight: standing, now and then a hand to the mouth
      POSES.stand(S, c.t / 4);
      torsoStand(S, c, 0.04, 0.968, 0.02);
      plant(S, -0.15, 0.03, 0.14, -0.04);
      c.p(c.rig.anchors.sight, 0, 0, 0, P[0]); lookAt(S, P[0], 0.8);
      armDown(S, 0, 0.05, 0.12, 0.3);
      if ((c.t * 0.3 + m.seed) % 1 < 0.3) { eyeOf(S, P[1]); hand(S, 1, P[1].add(_v.set(0.04, -0.09, -0.05)), 0, 0.3, -1, -1, 0, 0, 1, -1, 0); } else armDown(S, 1, 0.05, 0.12, 0.3);
      glance(S, c, m, 0.5);
    },
    easy: atEase,
  },
  k5: { role: 'tech', prop: () => 'rangefinder', pose: rangefinder, place: turnObserver, easy: atEase },
  k6: { role: 'carrier', busy: true, gloves: true, prop: () => 'mag20pair', pose: carryMags, place: faceGun, easy: atEase },
  k7: { role: 'carrier', busy: true, gloves: true, prop: () => 'mag20pair', pose: carryMags, place: faceGun, easy: atEase },
};

// the 2 cm Flak 38 (flak38 sec. 6): the layer seated, the range setter and the loader standing at the gun's
// left (they keep their places by the gun as it turns), the course setter with magazines, the range-taker
// outside the pit, the gun commander
function followMount(h, m, dt) {
  // carried round the mount axis with the top carriage, walking (sidestepping) to keep up
  const T = h.rig.pivots.turret;
  const yawT = T.rotation.y;
  const st = m.st;
  if (st.phi == null) st.phi = yawT;
  const r = Math.max(0.5, Math.hypot(m.spot.position.x, m.spot.position.z));
  const step = clamp(wrapPi(yawT - st.phi), -(1.6 / r) * dt, (1.6 / r) * dt);
  st.phi += step;
  st.walk = (st.walk ?? 0) + (step * r) / GAITS.sidestep.stride;
  st.moving = lerp(st.moving ?? 0, Math.abs(step) > 1e-4 ? 1 : 0, 1 - Math.exp(-6 * dt));
  // rotate his spot's world matrix about the mount's vertical axis by phi
  const o = _v.setFromMatrixPosition(T.matrixWorld);
  _m.makeTranslation(o.x, 0, o.z).multiply(_m2.makeRotationY(st.phi)).multiply(_m2.makeTranslation(-o.x, 0, -o.z));
  m.W.premultiply(_m);
}
function stepping(c, m, S) {
  // blend the stance toward a sidestep while he is moving round with the gun
  const st = m.st;
  if ((st.moving ?? 0) < 0.15) return;
  P[6].copy(S.feet[0].ankle); P[7].copy(S.feet[1].ankle);
  POSES.sidestep(S, -st.walk);
  S.feet[0].ankle.lerp(P[6], 1 - st.moving); S.feet[1].ankle.lerp(P[7], 1 - st.moving);
}
const flak38 = {
  k1: {
    role: 'helper',
    pose(c, m, S) {
      const T = c.rig.pivots.turret;
      torsoSeat(S, c, 0.3, 0, 0.03);
      c.p(T, -0.15, 0.05, 0.55, P[0]); c.p(T, -0.4, 0.05, 0.55, P[1]);
      seatFeet(S, P[1].x, P[1].y - ANK, P[1].z, P[0].x, P[0].y - ANK, P[0].z);
      c.p(c.rig.anchors.sight, 0, 0, 0.05, P[2]);
      c.d(c.rig.anchors.sight, 0, 0, -1, P[3]);
      eyeSolve(S, P[2], P[3], 'seat', m.st);
      onKnob(S, c, 1, 'wheelEl');
      onKnob(S, c, 0, 'wheelTr');
    },
    easy: sitEasy,
  },
  // the range setter at the sight on the gun's left: his right hand on the sight's range drum
  k2: {
    role: 'helper', place: followMount,
    pose(c, m, S) {
      POSES.stand(S, c.t / 4);
      c.p(c.rig.anchors.sight, -0.09, -0.01, -0.12, P[0]);
      torsoStand(S, c, 0.12, 0.968, 0.03, clamp(Math.atan2(-P[0].x, -P[0].z), -0.6, 0.6));
      plant(S, -0.15, 0.04, 0.14, -0.04);
      stepping(c, m, S);
      hand(S, 1, P[0], 0, -1, 0, -1, 0, 0, 0.8, -1, 0.3);
      armDown(S, 0, 0.05, 0.12, 0.3);
      c.p(c.rig.anchors.sight, 0, 0, 0, P[1]); lookAt(S, P[1], 0.9);
    },
    easy: atEase,
  },
  k3: { role: 'helper', busy: true, prop: () => 'mag20pair', pose: carryMags, place: faceGun, easy: atEase },
  // the loader at the gun's left: a full magazine held ready beside the one on the gun; he changes it as it
  // empties (CHANGE_38) and takes the next from the box at his feet (AFTER_38)
  k4: {
    role: 'helper', busy: true, gloves: true, ease: 14, prop: (c) => magProp(c.h, 0), place: followMount,
    pose(c, m, S) {
      const d = c.h.drill;
      if (d.change[0] >= 0) keyed(c, m, S, d.change[0], CHANGE_38); else keyed(c, m, S, d.after[0] ?? Infinity, AFTER_38);
      stepping(c, m, S);
    },
    easy: atEase,
  },
  k5: { role: 'helper', prop: () => 'rangefinder', pose: rangefinder, place: turnObserver, easy: atEase },
  gf: { role: 'nco', kit: binoKit, prop: binoProp, pose: commander, place: turnObserver, easy: atEase },
};
// the Flak 38 loader's ready pose: the next magazine held just behind the one on the gun
function k4Mag38(c, m, S) {
  POSES.stand(S, c.t / 4);
  const mg = c.rig.anchors.magazine;
  // the magazine on the gun sticks out to the left from the well; hold the next one just behind it
  c.p(mg, -0.2, 0.0, 0.18, P[0]);
  c.d(mg, -1, 0, 0, P[1]); c.d(mg, 0, 1, 0, P[2]);
  _v3.crossVectors(P[1], P[2]); // the gun's magazine's -Z
  propAt(S, P[0], aimQ(_q, _v3, P[2]));
  propPt(S, 0, 0, 0, P[3]);
  const low = clamp((1.05 - P[3].y) / 0.5, 0, 1);
  torsoStand(S, c, 0.15 + 0.3 * low, 0.968 - 0.1 * low, 0.03, clamp(Math.atan2(-P[3].x, -P[3].z), -0.6, 0.6));
  plant(S, -0.15, 0.04, 0.14, -0.05);
  gripProp(S, 0, -0.12, 0.06, 0.0, [0, -1, 0], [0, 0, -1], [-1, -1, 0.3]);
  gripProp(S, 1, 0.1, -0.06, 0.0, [0, 1, 0], [0, 0, -1], [1, -1, 0.3]);
  c.p(mg, 0, 0, 0, P[4]); lookAt(S, P[4], 0.9);
}
const CHANGE_38 = changeKeys(0, false), AFTER_38 = afterKeys(0, false, k4Mag38);

// the flak tower's 12.8 cm twin (flak128.js): the layers K1 and K2 seated at the right wall, each with his
// handwheel and his eyes on his receiver's dial (follow the pointer); beside each gun its loader at the tray and
// behind him on the platform his ammunition number at the hoist (the left gun's K3 and K5, the right's K4 and
// K6: LOADER128, AMMO128), the gun commander on the left platform
const layer128 = (wheel, dz) => ({
  role: 'tech', kit: ['headset'],
  pose(c, m, S) {
    torsoSeat(S, c, 0.32, 0, 0.04);
    seatFeet(S, -0.15, -0.42, -0.3, 0.15, -0.42, -0.3);
    onKnob(S, c, 1, wheel);
    onRim(S, c, 0, wheel, 0, 0.6, 0.6);
    lookAt(S, c.p(c.rig.pivots.turret, 1.47, 1.6, dz, P[1]), 0.9);
  },
  easy: sitEasy,
});
const loader128 = (side) => ({ role: 'gunner', busy: true, gloves: true, ease: 12, prop: () => 'round128', pose: (c, m, S) => keyed(c, m, S, c.h.drill.loading ? c.h.drill.load : 1, LOADER128[side]), easy: atEase });
const ammo128 = (side) => ({ role: 'carrier', busy: true, gloves: true, ease: 12, prop: () => 'round128', pose: (c, m, S) => keyed(c, m, S, c.h.drill.loading ? c.h.drill.load : 1, AMMO128[side]), easy: atEase });
const flak128 = {
  k1: layer128('wheelEl', -0.85), k2: layer128('wheelAz', -0.45),
  k3: loader128(-1), k4: loader128(1), k5: ammo128(-1), k6: ammo128(1),
  gf: { role: 'nco', kit: binoKit, prop: binoProp, pose: commander, place: turnObserver, easy: atEase },
};

export const JOBS = {
  flak88, kdo40, wurzburg, flak43, flakvierling: vierling, 'flakvierling-tower': vierling, flak38, flak128,
};

// poses a scene can ask for by name (m.pose = { name }) besides pose44.js's POSES
export const JOB_POSES = {
  binoculars: (c, m, S) => binoUp(c, m, S),
  cradle88: (c, m, S) => cradle88(c, m, S),
  cradleClip: (c, m, S) => cradleClip(c, m, S),
  carryMags: (c, m, S) => carryMags(c, m, S),
  atEase: (c, m, S) => atEase(c, m, S),
  sitEasy: (c, m, S) => sitEasy(c, m, S),
  rangefinder: (c, m, S) => rangefinder(c, m, S),
};
