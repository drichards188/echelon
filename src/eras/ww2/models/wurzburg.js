import * as THREE from 'three';
import { V, DEG, box, rbox, yTube, zTube, xTube, rod, lathe, xf, Parts, dish } from '../../../models/kit.js';
import { newRig, node, pivotAt, hb } from '../../../models/rig.js';
import { mulberry32 } from '../../../noise.js';
import { flakMats, setPaint, paintCarrier, add, build, tubeAB, wheelSet, ringBank, floorDisc, crewSpot } from './kit44.js';

// Wuerzburg D (FuMG 39 T D / FuMG 62 D), the heavy battery's gun-laying radar, set up beside the command
// post in a shallow earth revetment (refs/ww2/battery section 3.1, photo battery_wurzburg_10, Romania 1944).
// The sheet found no view of the D's mount; it is built after four Wikimedia Commons photos read for this
// model (not in refs/, see the report): the US War Department's annotated view "Wurzburg type D diagram"
// (public domain), Bundesarchiv Bild 101I-632-3797-08 and 101I-662-6660-27A (operators at work, the dish
// at about 35 deg; the aircraft silhouettes painted on that dish are not modelled), and the museum D
// "097 - 'Wurzburg C' Radar" (CC BY 2.0). What they show: a large round grating platform on its trailer
// frame and telescopic legs with foot plates; in its middle the turning column (the electronics cabinet)
// carrying at its top the horizontal axle of the 3 m solid paraboloid, held by a strut frame on the dish's
// back; the dish folds along its horizontal midline (hinges at the rim); the Quirl, the spinning offset
// dipole, in its drum housing on a short rod at the dish centre; on the column's left the operator's
// rounded "sidecar" seat tub with the azimuth wheel (a horizontal steering wheel) in front of him, the
// elevation handwheel at his side and the main presentation unit's hooded screen before his face; at the
// column's rear left the unit with three hooded CRTs and the range handwheel, worked standing. Dimensions scaled from those photos with the
// 3 m dish: platform 3.4 m across at 0.45 m, the elevation axle 2.1 m above the ground.
//
// Rig (model space front -Z = the dish's beam at zero, ground y = 0):
//   pivots.turret     the column and everything on it (seat tub, presentation unit, dish), (0, 0.45, 0) on
//                     the fixed platform. rotation.y = azimuth, + to the left; full circle.
//   pivots.elevation  the dish's axle at the column top, turret space (0, 1.65, -0.36), 2.1 m above the
//                     ground. rotation.x = elevation, + tilts the beam up; 0 to +90 deg (0 to 1.571); below 0
//                     the reflector's lower rim comes down on the platform.
//   pivots.quirl      the spinning dipole's rotor at the end of its rod (elevation group): rotation.z spins it
//                     (25 rev/s on the real set; rig.spin(t) sets it from a time).
//   anchors.eye       camera focus (0, 1.8, 0.4) on the root.
//   anchors.sight     the dish centre looking along the beam (elevation group), -Z out along the beam.
//   anchors.cable     where the cable to the predictor leaves the revetment (root), -Z along it.
//   anchors.crew      on the turret: op1 seated in the sidecar tub (azimuth and elevation wheels), op2 the
//                     range operator standing at the presentation unit (range handwheel), op3 beside him
//                     at the height scope; on the root: cmd the set's commander, op4 at the field telephone.
//   setPaint('grey' | 'yellow').

const W = { plat: 0.45, platR: 1.7, axis: 1.65, axZ: -0.36, R: 1.5, depth: 0.42 };

function platform(P) {
  const paint = (g, t = 0xffffff) => add(P, 'paint', g, t);
  // trailer frame (the cross of the Sd.Anh.) under the platform, its levelling jacks at the arm ends
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2, M = xf(0, 0, 0, 0, a, 0);
    paint(box(0.22, 0.2, 2.6, 0, W.plat - 0.2, -1.1).applyMatrix4(M), 0xd0d0d0);
    paint(yTube(0.04, W.plat - 0.1, 0.05, 0.05, 10, 0, -2.3).applyMatrix4(M), 0xd8d8d8);
    paint(box(0.26, 0.03, 0.26, 0, 0.015, -2.3).applyMatrix4(M), 0xbdbdbd);
    paint(box(0.28, 0.14, 0.24, 0, W.plat - 0.16, -2.42).applyMatrix4(M), 0xd8d8d8);
  }
  paint(yTube(0.15, W.plat - 0.02, 0.45, 0.45, 20));
  // the platform: grating sectors in a rim, on telescopic legs with foot plates round its edge
  add(P, 'grate', yTube(W.plat - 0.03, W.plat, W.platR, W.platR, 48), 0xffffff, 0.5);
  paint(new THREE.TorusGeometry(W.platR, 0.03, 4, 56).applyMatrix4(xf(0, W.plat - 0.015, 0, Math.PI / 2, 0, 0)), 0xd0d0d0);
  for (let i = 0; i < 6; i++) paint(box(0.05, 0.035, W.platR * 2, 0, W.plat - 0.012, 0).applyMatrix4(xf(0, 0, 0, 0, (i * Math.PI) / 6, 0)), 0xc8c8c8);
  for (let i = 0; i < 6; i++) {
    const a = ((i + 0.5) / 6) * Math.PI * 2, r = W.platR - 0.12, x = Math.sin(a) * r, z = -Math.cos(a) * r;
    paint(yTube(0.05, W.plat - 0.03, 0.035, 0.03, 8, x, z), 0xd8d8d8);
    paint(box(0.18, 0.025, 0.18, x, 0.0125, z), 0xbdbdbd);
  }
}

function column(T) {
  const paint = (g, t = 0xffffff) => add(T, 'paint', g, t);
  // turntable and the column (the electronics cabinet), doors and fittings, the bearing at its top
  paint(yTube(0.0, 0.08, 0.5, 0.5, 28));
  paint(rbox(0.86, 1.36, 0.78, 0.03, 0, 0.74, 0.04));
  for (const s of [-1, 1]) paint(box(0.02, 1.0, 0.6, s * 0.435, 0.72, 0.04), 0xd6d6d6);
  paint(box(0.66, 0.95, 0.02, 0, 0.7, 0.44), 0xd6d6d6);
  for (const y of [0.4, 1.0]) add(T, 'metal', box(0.04, 0.12, 0.03, 0.26, y, 0.455), 0xa0a0a0);
  paint(yTube(1.42, 1.52, 0.34, 0.34, 22), 0xe0e0e0);
  // the axle's bearing housings either side at the top front
  for (const s of [-1, 1]) {
    paint(rbox(0.16, 0.36, 0.3, 0.03, s * 0.33, W.axis - 0.1, W.axZ + 0.04));
    paint(xTube(s * 0.25, s * 0.42, 0.12, 0.12, 18, W.axis, W.axZ), 0xe4e4e4);
  }
  // the cable from the platform up the back of the column
  add(T, 'black', tubeAB(V(0.2, 0.05, 0.47), V(0.2, 1.3, 0.47), 0.025, 0.025, 6));
  // on the column's left (US manual view, Bundesarchiv 101I-632-3797-08, museum D): the "sidecar", the
  // antenna operator's rounded seat tub running fore and aft, its back rest at the rear, the azimuth
  // steering wheel (horizontal) in front of him, the elevation handwheel at his right on the tub's inner
  // side, the main presentation unit's hooded screen on the column in front of his face; a second
  // rounded housing ahead of the tub; at the column's rear left the unit with the three hooded CRTs and
  // the range handwheel, worked standing behind it
  const tub = (x, z, w, h, d) => paint(rbox(w, h, d, 0.16, x, h / 2 + 0.05, z));
  tub(-0.82, 0.22, 0.7, 0.72, 1.2);
  paint(rbox(0.56, 0.5, 0.06, 0.06, -0.82, 0.98, 0.8, 0.25, 0, 0), 0xdedede); // back rest
  add(T, 'black', rbox(0.46, 0.08, 0.42, 0.04, -0.82, 0.77, 0.5)); // seat cushion
  tub(-0.74, -0.62, 0.56, 0.6, 0.62);
  for (const z of [0.83, -0.94]) add(T, 'metal', zTube(z - 0.04, z + 0.04, 0.05, 0.05, 10, -0.82, 0.34), 0x9a9a9a);
  paint(rod(V(-0.46, 1.0, -0.25), V(-0.68, 1.06, -0.3), 0.04, 8), 0xd8d8d8);
  paint(rbox(0.22, 0.14, 0.22, 0.03, -0.72, 1.06, -0.3), 0xd0d0d0); // the bearing and indicator box under the wheel
  // main presentation unit: a flat box on the column's left face, its hooded screen toward the seat
  paint(rbox(0.36, 0.48, 0.56, 0.03, -0.6, 1.3, -0.2));
  add(T, 'black', lathe([[0.07, 0], [0.08, 0.04], [0.11, 0.2], [0.1, 0.21], [0.001, 0.21]], 14).applyMatrix4(xf(-0.66, 1.3, 0.08, Math.PI / 2, 0, 0)));
  // the CRT unit at the rear left, its three hoods toward the range operator behind it
  paint(rbox(0.5, 0.46, 0.34, 0.03, -0.22, 1.2, 0.6));
  for (const [x, y] of [[-0.33, 1.3], [-0.11, 1.3], [-0.22, 1.1]]) {
    add(T, 'black', lathe([[0.06, 0], [0.07, 0.04], [0.09, 0.2], [0.085, 0.21], [0.001, 0.21]], 14).applyMatrix4(xf(x, y, 0.77, Math.PI / 2, 0, 0)));
  }
  paint(rbox(0.4, 0.3, 0.24, 0.03, -0.22, 0.75, 0.56), 0xd8d8d8); // operating controls below it
  return {};
}

function dishGroup(E) {
  const paint = (g, t = 0xffffff) => add(E, 'paint', g, t);
  const R = W.R, d = W.depth, F = (R * R) / (4 * d);
  // the solid reflector, its vertex 0.32 m ahead of the axle, opening toward -Z; the rolled rim
  const v0 = -0.65; // (museum D, Bundesarchiv 101I-662-6660-27A: the reflector stands out on its back frame)
  paint(dish(R, d, 0.03, 40).applyMatrix4(xf(0, 0, v0)), 0xe6e6e6);
  paint(new THREE.TorusGeometry(R, 0.035, 6, 48).applyMatrix4(xf(0, 0, v0 - d - 0.015)), 0xdadada);
  // the fold line across the middle: a seam strip following the face, the hinge brackets at the rim
  for (let i = -9; i <= 9; i++) {
    const x = (i / 9.5) * R, z = v0 - d * (x / R) ** 2 - 0.016;
    add(E, 'paint', box((R / 9.5) * 1.02, 0.03, 0.012, x, 0, z, 0, Math.atan(2 * d * x / (R * R)), 0), 0xc8c8c8);
  }
  for (const s of [-1, 1]) {
    paint(rbox(0.12, 0.12, 0.18, 0.02, s * (R + 0.03), 0, v0 - d + 0.03), 0xd0d0d0);
    paint(xTube(s * (R - 0.02), s * (R + 0.08), 0.025, 0.025, 8, 0, v0 - d + 0.03), 0xd8d8d8);
  }
  // the frame on the back: the axle's hub, a box girder up the back of the reflector and short struts
  paint(xTube(-0.25, 0.25, 0.11, 0.11, 16, 0, 0), 0xe0e0e0);
  paint(rbox(0.34, 0.5, 0.3, 0.03, 0, 0.0, -0.2), 0xdcdcdc);
  paint(rbox(0.14, 1.9, 0.12, 0.03, 0, 0.0, v0 + 0.08), 0xd4d4d4);
  for (const [x, y] of [[-0.75, 0.6], [0.75, 0.6], [-0.75, -0.6], [0.75, -0.6]]) {
    const r2 = (x * x + y * y) / (R * R); // the shell's back lies at v0 - d r^2 / R^2
    paint(rod(V(x * 0.2, y * 0.3, -0.25), V(x, y, v0 - d * r2 + 0.03), 0.022, 6), 0xd0d0d0);
  }
  // the Quirl: rod from the dish centre and the drum housing of the spinning dipole
  const qz = v0 - 0.62;
  paint(zTube(v0 - 0.02, qz + 0.12, 0.035, 0.03, 10, 0, 0), 0xd8d8d8);
  paint(zTube(qz + 0.12, qz - 0.06, 0.11, 0.12, 18, 0, 0), 0xe0e0e0);
  return { qz };
}

export function buildWurzburg() {
  const rig = newRig('green');
  const mats = flakMats('grey');
  rig.mats = mats;
  const root = rig.root, rnd = mulberry32(62);

  // ---- the revetment (rig.emplacement): a low earth bank round the set, open toward the command post
  const emp = new THREE.Group();
  emp.name = 'emplacement';
  root.add(emp);
  rig.emplacement = emp;
  const P = new Parts(mats);
  ringBank(P, { R: 4.2, H: 0.95, bank: 2.0, crown: 0.6, seg: 40, gaps: [[Math.PI, 0.32]], rnd, inner: 0.6 });
  floorDisc(P, 4.0, 0.004);
  const cab = new THREE.CatmullRomCurve3([V(0, 0.04, 0.4), V(0.4, 0.03, 2.0), V(0.5, 0.03, 3.8), V(0.55, 0.02, 5.6), V(0.6, -0.15, 7.0)]);
  add(P, 'black', new THREE.TubeGeometry(cab, 30, 0.03, 6, false), 0xffffff, 0);
  // the field telephone box on a post by the gap
  add(P, 'wood', yTube(0, 1.0, 0.05, 0.05, 7, 1.4, 3.2), 0xc8bca8);
  add(P, 'paint', rbox(0.26, 0.3, 0.16, 0.02, 1.4, 1.05, 3.1), 0x9aa08a);
  build(P, emp, 0, 0.3);

  // ---- the fixed platform on its trailer frame and legs
  const X = new Parts(mats);
  platform(X);
  build(X, root, 0, 0.3);

  // ---- the turning column
  const tur = pivotAt(rig, root, 'turret', 0, W.plat, 0);
  const T = new Parts(mats);
  column(T);
  build(T, tur, W.plat, 0.15);
  // the handwheels: elevation on the tub's inner side (vertical, axle along x), azimuth the steering
  // wheel (horizontal) over the tub, range at the presentation unit's rear
  const hwEl = node(tur, 'wheelEl', -0.44, 0.86, 0.12), hwAz = node(tur, 'wheelAz', -0.72, 1.14, -0.3), hwRg = node(tur, 'wheelRange', -0.49, 1.36, 0.66);
  wheelSet(root, [[hwEl, xf(0, 0, 0, 0, Math.PI / 2, 0), 0.14], [hwAz, xf(0, 0, 0, Math.PI / 2, 0, 0), 0.19], [hwRg, xf(0, 0, 0, 0, Math.PI / 2, 0), 0.09]].map(([node, M, R]) => ({ node, M, R })), mats.black);
  hwEl.updateMatrix = function () { this.rotation.x = -(el.rotation.x / (6 * DEG)) * Math.PI * 2; THREE.Object3D.prototype.updateMatrix.call(this); };
  hwAz.updateMatrix = function () { this.rotation.y = (tur.rotation.y / (12 * DEG)) * Math.PI * 2; THREE.Object3D.prototype.updateMatrix.call(this); };

  // ---- the dish
  const el = pivotAt(rig, tur, 'elevation', 0, W.axis, W.axZ);
  const E = new Parts(mats);
  const dg = dishGroup(E);
  build(E, el, W.plat + W.axis, 0);
  const q = pivotAt(rig, el, 'quirl', 0, 0, dg.qz - 0.06);
  const Q = new Parts(mats);
  add(Q, 'metal', zTube(0, -0.05, 0.05, 0.05, 12, 0.04, 0), 0xb0b0b0);
  add(Q, 'metal', rod(V(0.04, 0, -0.03), V(0.04, 0.0, -0.18), 0.01, 5).applyMatrix4(xf(0, 0, 0)), 0xb0b0b0);
  add(Q, 'metal', box(0.22, 0.012, 0.012, 0.04, 0, -0.18), 0xc0c0c0); // the dipole across the rod's tip
  build(Q, q, W.plat + W.axis, 0);
  rig.spin = (t) => { q.rotation.z = (t * 25 * Math.PI * 2) % (Math.PI * 2); };

  // ---- anchors
  rig.anchors.eye = node(root, 'eye', 0, 1.8, 0.4);
  rig.anchors.sight = node(el, 'beam', 0, 0, -0.4);
  rig.anchors.cable = node(root, 'cable', 0.6, 0, 7.0, 0, Math.PI, 0);
  const P0 = 0.0;
  rig.anchors.crew = {
    op1: crewSpot(tur, 'op1', -0.82, 0.81, 0.45, 0, { label: 'antenna operator in the sidecar seat (azimuth and elevation wheels)', pose: 'sit', seated: true, hands: V(-0.72, 1.14, -0.3) }),
    op2: crewSpot(tur, 'op2', -0.22, P0, 1.15, 0, { label: 'range operator at the CRT unit (range handwheel)', pose: 'scope', hands: V(-0.49, 1.36, 0.66) }),
    op3: crewSpot(tur, 'op3', 0.45, P0, 0.95, 30, { label: 'height and elevation scope operator', pose: 'scope' }),
    cmd: crewSpot(root, 'cmd', 1.8, W.plat, 1.2, -60, { label: 'radar commander' }),
    op4: crewSpot(root, 'op4', 1.4, 0, 3.6, 180, { label: 'data and telephone man' }),
  };

  hb(rig, -W.platR, 0, -W.platR, W.platR, W.plat, W.platR);
  hb(rig, -1.2, W.plat, -0.95, 0.45, W.plat + 1.5, 0.85);
  hb(rig, -1.5, W.plat + 0.6, -1.2, 1.5, W.plat + 3.4, 0.0);

  let paint = 'grey';
  paintCarrier(root);
  rig.setPaint = (s) => { if (s !== paint && (s === 'grey' || s === 'yellow')) { paint = s; setPaint(root, s); } };
  return rig;
}
