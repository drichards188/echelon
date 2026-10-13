import * as THREE from 'three';
import { BONES, NB, BI, PARENT, SK, JOINT, SIDE, GRIP } from './figure44.js';

// The flak crewman's pose solver (crew44.js drives it, figure44.js is the body it moves). The method is
// models/v/crew.js's (a pose fills a specification in the man's root space: torso angles, ankle targets, hand
// grips; two-bone IK solves the legs and the arms that hold something; wrists bend at most 57 degrees and
// twist at most 90, so a grip always lands and the hand's orientation gives way), extended for the guns:
// seated poses, an eye target (an eyepiece, a sight, a scope's hood) that the torso leans and the knees bend
// to reach, a head that looks along a direction, a free prop bone the hands hold, and per-man shoulders and
// hips (the build's girth). Root space: the man's spot, metres of a 1.78 m man (crew44.js scales the root by
// his height), facing -Z, right +X, the feet (or the seat, for seated poses) at y = 0.
//
//   const S = spec();                      a specification to fill (reuse it; nothing allocates per call)
//   resetSpec(S); POSES.stand(S, t);       a library pose, or fill S by hand; then
//   solve(S, body, blend)                  writes body.q (local bone quaternions), body.hips, body.prop
//   eyeSolve(S, E, D, mode)                lean (and bend the knees, or curl the back when seated) so the eyes
//                                          come to E looking along D (root space); returns the error left, m
//   look(S, D, k)                          neck and head turn the face along D (root space), k of the way
//   writeBones(body, out, o)               the 18 skinning matrices (3x4 rows, root space) into out[o..]
//   newBody(girth)                         a man's pose state (local quaternions, hips, prop, his shoulders)
// POSES: stand, atEase, walk, sidestep, carry, crouch, kneel, signal (more in crew44.js's jobs, built from
// these pieces). GAITS: stride and period of the cycles.

const V3 = THREE.Vector3, Q = THREE.Quaternion;
const TAU = Math.PI * 2;
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const lerp = (a, b, t) => a + (b - a) * t;
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const fract = (x) => x - Math.floor(x);
const { L_TH, L_SH, L_UA, L_FA, ANKLE_Y } = SK;

const J = Object.fromEntries(BONES.map((b) => [b, new V3(...JOINT[b])]));
// each bone's joint relative to its parent's in the bind pose
const OFF = Object.fromEntries(BONES.map((b) => [b, PARENT[b] ? J[b].clone().sub(J[PARENT[b]]) : J[b].clone()]));
// the eyes' midpoint from the head joint
export const EYE = new V3(0, 0.074, -0.087);
export const GAITS = { walk: { stride: 1.25, period: 0.98 }, sidestep: { stride: 0.4, period: 1.0 } };

// ---------------------------------------------------------------- the specification

export function spec() {
  const foot = () => ({ ankle: new V3(), rot: new THREE.Euler(0, 0, 0, 'YXZ'), pole: new V3() });
  // onProp: the grip is on the held prop (pg, pf, pn in prop space), so it follows the prop if a scene moves it
  const arm = () => ({ ik: false, grip: new V3(), fingers: new V3(), palm: new V3(), pole: new V3(), ua: new THREE.Euler(), fa: 0, hand: new THREE.Euler(), onProp: false, pg: new V3(), pf: new V3(), pn: new V3() });
  return {
    hips: new V3(), hipsQ: new Q(), spineQ: new Q(), chestQ: new Q(), neckQ: new Q(), headQ: new Q(), shrug: [0, 0],
    feet: [foot(), foot()], arms: [arm(), arm()], prop: { on: false, pos: new V3(), q: new Q(), s: 1 },
  };
}
const _e = new THREE.Euler(0, 0, 0, 'YXZ');
// Euler 'YXZ' (x < 0 leans forward) into a quaternion
export const eul = (q, x, y, z) => q.setFromEuler(_e.set(x, y, z, 'YXZ'));

export function resetSpec(S) {
  S.hips.set(0, 0.972, 0);
  S.hipsQ.identity(); S.spineQ.identity(); S.chestQ.identity(); S.neckQ.identity(); S.headQ.identity();
  S.shrug[0] = S.shrug[1] = 0;
  for (let i = 0; i < 2; i++) {
    const s = SIDE[i], f = S.feet[i], a = S.arms[i];
    f.ankle.set(s * 0.115, ANKLE_Y, 0); f.rot.set(0, -s * 0.12, 0); f.pole.set(s * 0.15, 0, -1);
    a.ik = false; a.onProp = false; a.ua.set(0.03, 0, s * 0.1); a.fa = 0.2; a.hand.set(0, 0, 0);
  }
  S.prop.on = false;
  return S;
}

export function setIK(a, g, f, n, p) {
  a.ik = true; a.onProp = false; a.grip.copy(g); a.fingers.copy(f); a.palm.copy(n); a.pole.copy(p);
}
export function setIKv(a, gx, gy, gz, fx, fy, fz, nx, ny, nz, px, py, pz) {
  a.ik = true; a.onProp = false; a.grip.set(gx, gy, gz); a.fingers.set(fx, fy, fz); a.palm.set(nx, ny, nz); a.pole.set(px, py, pz);
}
/** Arm a's grip on S's prop, given in prop space (point, fingers, palm) and an elbow pole in root space. */
export function gripOnProp(S, a, px, py, pz, f, n, pole) {
  a.ik = true; a.onProp = true;
  a.pg.set(px, py, pz); a.pf.set(f[0], f[1], f[2]); a.pn.set(n[0], n[1], n[2]); a.pole.set(pole[0], pole[1], pole[2]);
  propGrips(S);
}
/** Put the prop-held grips where the prop now is (after a scene moved it). */
export function propGrips(S) {
  for (const a of S.arms) if (a.onProp) {
    a.grip.copy(a.pg).multiplyScalar(S.prop.s).applyQuaternion(S.prop.q).add(S.prop.pos);
    a.fingers.copy(a.pf).applyQuaternion(S.prop.q);
    a.palm.copy(a.pn).applyQuaternion(S.prop.q);
  }
}

// Ankle of a foot whose flat ankle would be at (x, z), pitched by p (> 0 toe up, rolling on the heel; < 0
// heel up, rolling on the toe), lifted by `lift` (crew.js).
export function ankleAt(out, x, z, p, lift = 0, y0 = 0) {
  const c = Math.cos(p), s = Math.sin(p);
  if (p >= 0) out.set(x, 0.09 * c + 0.07 * s, z + 0.07 + 0.09 * s - 0.07 * c);
  else out.set(x, 0.09 * c - 0.215 * s, z - 0.215 + 0.09 * s + 0.215 * c);
  out.y += lift + y0;
  return out;
}

// ---------------------------------------------------------------- forward kinematics of the torso

const _qh = new Q(), _qs = new Q(), _qc = new Q(), _qn = new Q(), _qd = new Q();
const _pS = new V3(), _pC = new V3(), _pN = new V3(), _pH = new V3(), _t = new V3();
// root-space chest and head frames of S (into the module scratch), returns the eye point into out
function torsoFK(S, out) {
  _qh.copy(S.hipsQ);
  _qs.copy(_qh).multiply(S.spineQ);
  _qc.copy(_qs).multiply(S.chestQ);
  _qn.copy(_qc).multiply(S.neckQ);
  _qd.copy(_qn).multiply(S.headQ);
  _pS.copy(OFF.spine).applyQuaternion(_qh).add(S.hips);
  _pC.copy(OFF.chest).applyQuaternion(_qs).add(_pS);
  _pN.copy(OFF.neck).applyQuaternion(_qc).add(_pC);
  _pH.copy(OFF.head).applyQuaternion(_qn).add(_pN);
  if (out) out.copy(EYE).applyQuaternion(_qd).add(_pH);
  return out;
}
/** The eye point of S (root space). */
export function eyeOf(S, out) { return torsoFK(S, out); }
/** The chest's root-space rotation of S. */
export function chestOf(S, out) { torsoFK(S, null); return out.copy(_qc); }
/** The shoulder joint of side i (0 left) in root space, for a body's girth. */
export function shoulderOf(S, i, g, out) {
  torsoFK(S, null);
  return out.set(SIDE[i] * SK.SH_X * g - SIDE[i] * S.shrug[i] * 0.3, OFF.upperArmR.y + S.shrug[i], OFF.upperArmR.z).applyQuaternion(_qc).add(_pC);
}

// The face turns along D (root space, any length): the head's -Z onto D with no roll, split between the
// neck (40 %) and the head, limited to a 1.4 rad turn and 1.1 rad of nod from the chest.
const _qa = new Q(), _qb = new Q(), _qi = new Q(), _d = new V3();
export function look(S, D, k = 1) {
  torsoFK(S, null);
  _d.copy(D).applyQuaternion(_qi.copy(_qc).invert()); // in chest space
  const len = _d.length();
  if (len < 1e-6) return;
  const yaw = clamp(Math.atan2(-_d.x, -_d.z), -1.4, 1.4), pitch = clamp(Math.asin(clamp(_d.y / len, -1, 1)), -1.0, 1.1);
  eul(_qa, pitch * 0.4 * k, yaw * 0.4 * k, 0);
  S.neckQ.copy(_qa); // the neck's share
  eul(_qb, pitch * 0.6 * k, yaw * 0.6 * k, 0);
  S.headQ.copy(_qb);
}

// ---------------------------------------------------------------- eye targeting

// Two-parameter Gauss-Newton with a numeric Jacobian: `set(S, p0, p1)` poses the torso, the residual is the
// eye's distance from E in the vertical and the horizontal (along f, the way the man leans); the face is kept
// along D at every step. Modes:
//   'stand'  p0 lean (rad, forward), p1 hip height (the legs bend under it)
//   'seat'   p0 lean from the hips, p1 curl of the back (the hips stay on the seat)
// Returns the residual distance (m). The parameters start from S's current values in `st` (kept per man so
// the solution follows the target smoothly from frame to frame).
const _E0 = new V3(), _E1 = new V3(), _f = new V3(), _r = new V3(), _tmp = new V3();
function poseLean(S, mode, a, b, yaw, hz0, hy0) {
  if (mode === 'stand') {
    eul(S.hipsQ, -a * 0.42, yaw * 0.25, 0);
    eul(S.spineQ, -a * 0.3, yaw * 0.35, 0);
    eul(S.chestQ, -a * 0.28, yaw * 0.4, 0);
    S.hips.y = b;
    S.hips.z = hz0 + 0.28 * Math.sin(Math.max(0, a)) - 0.0 * yaw;
  } else {
    // seated: the pelvis tips with the lean, the back curls on top of it
    eul(S.hipsQ, -a * 0.75 + b * 0.25, yaw * 0.2, 0);
    eul(S.spineQ, -b * 0.55, yaw * 0.35, 0);
    eul(S.chestQ, -b * 0.45, yaw * 0.45, 0);
    S.hips.y = hy0;
    S.hips.z = hz0;
  }
}
export function eyeSolve(S, E, D, mode, st, limits = null) {
  const hz0 = st.hz0 ?? S.hips.z, hy0 = st.hy0 ?? S.hips.y;
  const L = limits || (mode === 'stand' ? [-0.2, 1.3, 0.74, 0.99] : [-0.35, 0.9, -0.2, 0.9]);
  let a = clamp(st.a ?? 0.1, L[0], L[1]), b = clamp(st.b ?? (mode === 'stand' ? 0.95 : 0.1), L[2], L[3]);
  // turn the torso toward the target round the vertical
  const yaw = clamp(Math.atan2(-(E.x - S.hips.x), -(E.z - S.hips.z)), -0.7, 0.7) * (st.twist ?? 1);
  _f.set(-Math.sin(yaw), 0, -Math.cos(yaw));
  const res = (p0, p1, out) => {
    poseLean(S, mode, p0, p1, yaw, hz0, hy0);
    look(S, D, 1);
    torsoFK(S, out);
    out.sub(E);
    return out;
  };
  let err = 0;
  for (let it = 0; it < 3; it++) {
    res(a, b, _E0);
    const ey = _E0.y, ef = _E0.dot(_f);
    err = Math.hypot(ey, ef);
    if (err < 0.006) break;
    const h = 0.02;
    res(a + h, b, _E1); const ya = (_E1.y - ey) / h, fa = (_E1.dot(_f) - ef) / h;
    res(a, b + h, _E1); const yb = (_E1.y - ey) / h, fb = (_E1.dot(_f) - ef) / h;
    const det = ya * fb - yb * fa;
    if (Math.abs(det) < 1e-6) break;
    // solve [ya yb; fa fb] [da db] = -[ey ef]
    const da = (-ey * fb + ef * yb) / det, db = (-ya * ef + fa * ey) / det;
    a = clamp(a + clamp(da, -0.35, 0.35), L[0], L[1]);
    b = clamp(b + clamp(db, -0.25, 0.25), L[2], L[3]);
  }
  res(a, b, _E0);
  // what is left sideways: shift the hips a little (standing) or turn further (seated, the head does)
  _r.set(-_f.z, 0, _f.x); // right of the lean
  const side = _E0.dot(_r);
  if (mode === 'stand') { S.hips.x -= clamp(side, -0.12, 0.12); }
  st.a = a; st.b = b; st.hz0 = hz0; st.hy0 = hy0;
  torsoFK(S, _tmp);
  return _tmp.distanceTo(E);
}

// ---------------------------------------------------------------- IK

const BEND = new Float64Array(1);
const _dd = new V3(), _pp = new V3(), _u = new V3(), _X = new V3(), _Y = new V3(), _Z = new V3(), _M = new THREE.Matrix4();
const XAXIS = new V3(1, 0, 0);
// Two-bone IK from joint A to target T (lengths l1, l2), the middle joint bent toward `pole`; the first bone's
// root-space rotation (rest direction -Y) to outQ, the bend to BEND[0]. s = +1 arms, -1 legs.
function solve2(A, T, l1, l2, pole, s, outQ) {
  _dd.subVectors(T, A);
  let d = _dd.length();
  if (d < 1e-6) { _dd.set(0, -1, 0); d = 1e-6; } else _dd.divideScalar(d);
  d = clamp(d, Math.abs(l1 - l2) + 1e-4, l1 + l2 - 1e-4);
  _pp.copy(pole).addScaledVector(_dd, -pole.dot(_dd));
  if (_pp.lengthSq() < 1e-8) _pp.set(0, 0, -s).addScaledVector(_dd, s * _dd.z);
  _pp.normalize();
  const ca = clamp((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d), -1, 1), sa = Math.sqrt(1 - ca * ca);
  _u.copy(_dd).multiplyScalar(ca).addScaledVector(_pp, sa);
  const cg = clamp((l1 * l1 + l2 * l2 - d * d) / (2 * l1 * l2), -1, 1);
  _Y.copy(_u).negate();
  _Z.copy(_pp).addScaledVector(_Y, -_pp.dot(_Y)).normalize().multiplyScalar(s);
  _X.crossVectors(_Y, _Z);
  outQ.setFromRotationMatrix(_M.makeBasis(_X, _Y, _Z));
  BEND[0] = Math.PI - Math.acos(cg);
}
function handBasis(f, n, s, outQ) {
  _Y.copy(f).negate().normalize();
  _X.copy(n).multiplyScalar(-s);
  _X.addScaledVector(_Y, -_X.dot(_Y)).normalize();
  _Z.crossVectors(_X, _Y);
  return outQ.setFromRotationMatrix(_M.makeBasis(_X, _Y, _Z));
}
const MAX_BEND = 1.0, MAX_TWIST = 1.6;
const _qw = new Q(), _qA = new Q(), _qB = new Q(), _qr = new Q(), _qt = new Q(), _qsw = new Q(), _qid = new Q(), _qx = new Q(), _pT = new V3();
// arm i onto its grip: local quaternions for upperArm, forearm and hand into TQ (chest rotation qC, shoulder sh)
function armIK(i, a, qC, sh, TQ) {
  const b = 5 + i * 3;
  handBasis(a.fingers, a.palm, SIDE[i], _qw);
  let beta = 0;
  for (let pass = 0; pass < 3; pass++) {
    _pT.copy(GRIP[i]).applyQuaternion(_qw);
    _pT.subVectors(a.grip, _pT);
    solve2(sh, _pT, L_UA, L_FA, a.pole, 1, _qA);
    beta = BEND[0];
    _qB.copy(_qA).multiply(_qx.setFromAxisAngle(XAXIS, beta));
    _qr.copy(_qB).invert().multiply(_qw);
    _qt.set(0, _qr.y, 0, _qr.w).normalize();
    let tw = 2 * Math.atan2(_qt.y, _qt.w);
    tw = tw > Math.PI ? tw - TAU : tw < -Math.PI ? tw + TAU : tw;
    _qsw.copy(_qr).multiply(_qi.copy(_qt).invert());
    const bend = 2 * Math.acos(Math.min(1, Math.abs(_qsw.w)));
    if (pass === 2 || (bend <= MAX_BEND + 0.01 && Math.abs(tw) <= MAX_TWIST + 0.01)) break;
    if (Math.abs(tw) > MAX_TWIST) _qt.setFromAxisAngle(_Y.set(0, 1, 0), Math.sign(tw) * MAX_TWIST);
    if (bend > MAX_BEND) { _qid.identity(); _qsw.copy(_qid.slerp(_qsw, MAX_BEND / bend)); }
    _qw.copy(_qB).multiply(_qsw).multiply(_qt);
  }
  TQ[b].copy(_qi.copy(qC).invert()).multiply(_qA);
  TQ[b + 1].setFromAxisAngle(XAXIS, beta);
  TQ[b + 2].copy(_qB.invert()).multiply(_qw);
}

// ---------------------------------------------------------------- the body state and the solve

/** A man's pose state: local (parent-relative) quaternions, the hips, the prop, his shoulders and hips. */
export function newBody(girth = 1) {
  const q = Array.from({ length: NB }, () => new Q());
  return { q, hips: new V3(0, 0.972, 0), prop: { on: false, pos: new V3(), q: new Q(), s: 1 }, shrug: [0, 0], g: girth, P: Array.from({ length: NB }, () => new V3()), R: Array.from({ length: NB }, () => new Q()) };
}

const TQ = Array.from({ length: NB }, () => new Q());
const _sh = new V3(), _pA = new V3(), _qL = new Q(), _hx = new V3();
/** Solve S into the body (blend < 1 moves that fraction of the way from its current pose). */
export function solve(S, body, blend = 1) {
  const g = body.g;
  TQ[0].copy(S.hipsQ); TQ[1].copy(S.spineQ); TQ[2].copy(S.chestQ); TQ[3].copy(S.neckQ); TQ[4].copy(S.headQ);
  torsoFK(S, null);
  // legs (the hip joints at the body's own width)
  for (let i = 0; i < 2; i++) {
    const f = S.feet[i], b = 11 + i * 3;
    _pA.set(SIDE[i] * SK.HIP_X * g, OFF.thighR.y, OFF.thighR.z).applyQuaternion(_qh).add(S.hips);
    solve2(_pA, f.ankle, L_TH, L_SH, f.pole, -1, _qA);
    const beta = BEND[0];
    TQ[b].copy(_qi.copy(_qh).invert()).multiply(_qA);
    TQ[b + 1].setFromAxisAngle(XAXIS, -beta);
    _qB.copy(_qA).multiply(TQ[b + 1]);
    _qx.setFromEuler(f.rot);
    TQ[b + 2].copy(_qB.invert()).multiply(_qx);
  }
  // arms
  for (let i = 0; i < 2; i++) {
    const a = S.arms[i], b = 5 + i * 3;
    if (a.ik) {
      _sh.set(SIDE[i] * SK.SH_X * g - SIDE[i] * S.shrug[i] * 0.3, OFF.upperArmR.y + S.shrug[i], OFF.upperArmR.z).applyQuaternion(_qc).add(_pC);
      armIK(i, a, _qc, _sh, TQ);
    } else {
      TQ[b].setFromEuler(a.ua);
      TQ[b + 1].setFromAxisAngle(XAXIS, a.fa);
      TQ[b + 2].setFromEuler(a.hand);
    }
  }
  const k = clamp(blend, 0, 1);
  for (let i = 0; i < NB - 1; i++) { if (k >= 1) body.q[i].copy(TQ[i]); else body.q[i].slerp(TQ[i], k); }
  body.hips.lerp(S.hips, k);
  body.shrug[0] = lerp(body.shrug[0], S.shrug[0], k); body.shrug[1] = lerp(body.shrug[1], S.shrug[1], k);
  body.prop.on = S.prop.on; body.prop.s = S.prop.s;
  if (k >= 1) { body.prop.pos.copy(S.prop.pos); body.prop.q.copy(S.prop.q); } else { body.prop.pos.lerp(S.prop.pos, k); body.prop.q.slerp(S.prop.q, k); }
  fk(body);
}

// root-space positions and rotations of every bone from the body's local quaternions
function fk(body) {
  const { q, P, R, g } = body;
  P[0].copy(body.hips); R[0].copy(q[0]);
  for (let b = 1; b < NB - 1; b++) {
    const p = BI[PARENT[BONES[b]]];
    _hx.copy(OFF[BONES[b]]);
    if (b === 5 || b === 8) { const i = b === 5 ? 0 : 1; _hx.x = SIDE[i] * SK.SH_X * g - SIDE[i] * body.shrug[i] * 0.3; _hx.y += body.shrug[i]; }
    else if (b === 11 || b === 14) _hx.x = SIDE[b === 11 ? 0 : 1] * SK.HIP_X * g;
    P[b].copy(_hx).applyQuaternion(R[p]).add(P[p]);
    R[b].copy(R[p]).multiply(q[b]);
  }
  P[NB - 1].copy(body.prop.pos); R[NB - 1].copy(body.prop.q);
}

/** A root-space point of bone b (bind-pose coordinates, e.g. a hand's grip) in root space. */
export function boneToRoot(body, b, p, out) {
  return out.copy(p).sub(J[BONES[b]]).applyQuaternion(body.R[b]).add(body.P[b]);
}

/** The skinning matrices (three rows of 4 per bone, M = T(P) R T(-J), in the man's root space; crew44.js puts
 *  his root in the instance matrix) into out from offset o. The prop keeps its real size (body.prop.s). */
export function writeBones(body, out, o) {
  for (let b = 0; b < NB; b++) {
    const q = body.R[b], p = body.P[b], j = J[BONES[b]], sc = b === NB - 1 ? body.prop.s : 1;
    const x = q.x, y = q.y, z = q.z, w = q.w, x2 = x + x, y2 = y + y, z2 = z + z;
    const xx = x * x2, xy = x * y2, xz = x * z2, yy = y * y2, yz = y * z2, zz = z * z2, wx = w * x2, wy = w * y2, wz = w * z2;
    const m00 = (1 - (yy + zz)) * sc, m01 = (xy - wz) * sc, m02 = (xz + wy) * sc;
    const m10 = (xy + wz) * sc, m11 = (1 - (xx + zz)) * sc, m12 = (yz - wx) * sc;
    const m20 = (xz - wy) * sc, m21 = (yz + wx) * sc, m22 = (1 - (xx + yy)) * sc;
    const k = o + b * 12;
    out[k] = m00; out[k + 1] = m01; out[k + 2] = m02; out[k + 3] = p.x - (m00 * j.x + m01 * j.y + m02 * j.z);
    out[k + 4] = m10; out[k + 5] = m11; out[k + 6] = m12; out[k + 7] = p.y - (m10 * j.x + m11 * j.y + m12 * j.z);
    out[k + 8] = m20; out[k + 9] = m21; out[k + 10] = m22; out[k + 11] = p.z - (m20 * j.x + m21 * j.y + m22 * j.z);
  }
}

// ---------------------------------------------------------------- gaits and library poses

// One foot of a walking gait at its own phase: stance (heel strike, flat, heel off) then swing.
function gaitFoot(f, ph, stride, duty, x, yaw, lift) {
  const A = (stride * duty) / 2;
  let z, p, l = 0;
  if (ph < duty) {
    const k = ph / duty;
    z = -A + 2 * A * k;
    p = k < 0.16 ? 0.3 * (1 - sstep(0, 0.16, k)) : k > 0.58 ? -0.72 * ((k - 0.58) / 0.42) ** 1.5 : 0;
  } else {
    const k = (ph - duty) / (1 - duty);
    z = A - 2 * A * sstep(0.02, 0.98, k);
    p = lerp(-0.72, 0.3, sstep(0.0, 0.85, k));
    l = lift * Math.sin(Math.PI * Math.min(1, k * 1.1)) ** 0.8;
  }
  ankleAt(f.ankle, x, z, p, l);
  f.rot.set(p, yaw, 0);
}

export const POSES = {
  // at attention-ish, the weight on one leg (t: breathing)
  stand(S, t) {
    const b = Math.sin(TAU * t);
    S.hips.set(0.012, 0.972, 0.004);
    eul(S.hipsQ, 0, 0.02, 0.02); eul(S.spineQ, -0.02, 0, -0.012); eul(S.chestQ, 0.02 + 0.012 * b, -0.02, -0.01);
    eul(S.neckQ, 0.05, 0, 0); eul(S.headQ, -0.05, 0.03, 0.01);
    S.feet[0].ankle.set(-0.125, ANKLE_Y, 0.02); S.feet[1].ankle.set(0.115, ANKLE_Y, -0.02);
    for (let i = 0; i < 2; i++) { const s = SIDE[i], a = S.arms[i]; a.ua.set(0.04 + 0.01 * b, 0, s * 0.11); a.fa = 0.22; a.hand.set(0.05, 0, s * 0.06); }
  },
  // feet apart, weight back, hands clasped behind (a commander between salvoes)
  atEase(S, t) {
    const b = Math.sin(TAU * t);
    S.hips.set(0, 0.965, 0.02);
    eul(S.hipsQ, 0.02, 0, 0); eul(S.spineQ, 0.0, 0, 0); eul(S.chestQ, 0.03 + 0.01 * b, 0, 0);
    S.feet[0].ankle.set(-0.17, ANKLE_Y, 0.0); S.feet[1].ankle.set(0.17, ANKLE_Y, 0.0);
    S.feet[0].rot.set(0, 0.2, 0); S.feet[1].rot.set(0, -0.2, 0);
    for (let i = 0; i < 2; i++) setIKv(S.arms[i], SIDE[i] * 0.04, 0.95, 0.19, 0, -0.3, 1, -SIDE[i] * 0.3, 0, 1, SIDE[i] * 1, 0, 0.5);
  },
  walk(S, t) {
    const c = Math.cos(TAU * t), c2 = Math.cos(2 * TAU * t), sn = Math.sin(TAU * t);
    S.hips.set(-0.016 * sn, 0.944 - 0.022 * c2, 0);
    eul(S.hipsQ, -0.03, -0.07 * c, -0.035 * sn); eul(S.spineQ, -0.02, 0.04 * c, 0.02 * sn); eul(S.chestQ, 0, 0.06 * c, 0.015 * sn);
    eul(S.neckQ, 0.03, -0.03 * c, 0); eul(S.headQ, -0.03 + 0.015 * c2, 0, 0);
    for (let i = 0; i < 2; i++) {
      const s = SIDE[i];
      gaitFoot(S.feet[i], fract(t + (i ? 0.5 : 0)), GAITS.walk.stride, 0.6, s * 0.085, -s * 0.08, 0.075);
      S.feet[i].pole.set(s * 0.12, 0, -1);
      const a = S.arms[i], sw = s * 0.36 * c;
      a.ua.set(sw, 0, s * 0.1); a.fa = 0.28 + 0.22 * Math.max(0, sw / 0.36); a.hand.set(0.1, 0, s * 0.05);
    }
  },
  // stepping sideways to the right (run t backwards for the left), arms free
  sidestep(S, t) {
    const L = GAITS.sidestep.stride, duty = 0.66, A = (L * duty) / 2, c2 = Math.cos(2 * TAU * t);
    let w = 0;
    for (let i = 0; i < 2; i++) {
      const s = SIDE[i], ph = fract(t + (i ? 0 : 0.5));
      let x, lift = 0;
      if (ph < 1 - duty) { const k = ph / (1 - duty); x = -A + 2 * A * sstep(0, 1, k); lift = 0.07 * Math.sin(Math.PI * k); w += s * 0.5; } else x = A - (2 * A * (ph - 1 + duty)) / duty;
      S.feet[i].ankle.set(s * 0.17 + x, ANKLE_Y + lift, i ? -0.01 : 0.02);
      S.feet[i].rot.set(0.12 * lift / 0.07, -s * 0.12, 0);
      S.feet[i].pole.set(s * 0.25, 0, -1);
    }
    S.hips.set(-0.02 * w, 0.952 - 0.012 * c2, 0.01);
    eul(S.hipsQ, -0.02, 0, 0.03 * w); eul(S.spineQ, -0.02, 0, -0.02 * w); eul(S.chestQ, 0, 0, -0.01 * w);
    for (let i = 0; i < 2; i++) { const s = SIDE[i], a = S.arms[i]; a.ua.set(0.1, 0, s * 0.16); a.fa = 0.45; a.hand.set(0.05, 0, s * 0.05); }
  },
  // a load held in front at the chest (the prop placed by the caller), feet planted
  carry(S, t) {
    const b = Math.sin(TAU * t);
    S.hips.set(0, 0.962, 0.03);
    eul(S.hipsQ, 0.05, 0, 0); eul(S.spineQ, 0.04, 0, 0); eul(S.chestQ, 0.02 + 0.008 * b, 0, 0); eul(S.neckQ, 0.04, 0, 0); eul(S.headQ, 0.06, 0, 0);
    S.feet[0].ankle.set(-0.13, ANKLE_Y, 0.0); S.feet[1].ankle.set(0.13, ANKLE_Y, 0.04);
  },
  // squatting on the heels, reaching low in front
  crouch(S, t) {
    const b = Math.sin(TAU * t);
    S.hips.set(0.02, 0.535, 0.1);
    eul(S.hipsQ, -0.32, 0.12, 0); eul(S.spineQ, -0.16 - 0.01 * b, -0.05, 0); eul(S.chestQ, -0.06, -0.04, 0); eul(S.neckQ, 0.08, 0, 0); eul(S.headQ, 0.1, 0, 0);
    S.feet[0].ankle.set(-0.2, ANKLE_Y, -0.26); S.feet[0].rot.set(0, 0.3, 0); S.feet[0].pole.set(-0.6, 0.3, -1);
    ankleAt(S.feet[1].ankle, 0.12, 0.62, -1.2, 0.015); S.feet[1].rot.set(-1.2, -0.05, 0); S.feet[1].pole.set(0.05, -1, -0.3);
  },
  // the right knee down, the left foot forward
  kneel(S, t) {
    const b = Math.sin(TAU * t);
    S.hips.set(0.04, 0.6, 0.18);
    eul(S.hipsQ, -0.12, 0.08, 0); eul(S.spineQ, -0.1 - 0.01 * b, -0.03, 0); eul(S.chestQ, -0.05, -0.02, 0); eul(S.neckQ, 0.06, 0, 0); eul(S.headQ, 0.08, 0, 0);
    S.feet[0].ankle.set(-0.16, ANKLE_Y, -0.22); S.feet[0].rot.set(0, 0.15, 0); S.feet[0].pole.set(-0.2, 0.3, -1);
    ankleAt(S.feet[1].ankle, 0.13, 0.62, -1.25, 0.012); S.feet[1].rot.set(-1.25, -0.05, 0); S.feet[1].pole.set(0.05, -1, -0.2);
  },
  // the right arm raised (t: the hand waves forward and back)
  signal(S, t) {
    const a = TAU * t, b = Math.sin(a);
    S.hips.set(0, 0.972, 0);
    eul(S.hipsQ, 0, 0.04, -0.015); eul(S.spineQ, 0.02, 0, -0.02); eul(S.chestQ, 0.03, 0.02, -0.03); eul(S.neckQ, -0.04, 0, 0); eul(S.headQ, -0.14, 0.05, 0);
    S.shrug[1] = 0.035;
    S.feet[0].ankle.set(-0.15, ANKLE_Y, 0.02); S.feet[1].ankle.set(0.15, ANKLE_Y, -0.01);
    setIKv(S.arms[1], 0.24, 1.98 + 0.03 * b, -0.12 + 0.06 * b, 0.05, 1, -0.2, 0, 0, -1, 1, 0, 0.35);
    const l = S.arms[0];
    l.ua.set(0.02, 0, -0.1); l.fa = 0.2; l.hand.set(0, 0, -0.05);
  },
};
