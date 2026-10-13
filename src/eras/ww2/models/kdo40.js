import * as THREE from 'three';
import { V, DEG, box, rbox, yTube, zTube, xTube, rod, xf, Parts } from '../../../models/kit.js';
import { newRig, node, pivotAt, hb } from '../../../models/rig.js';
import { mulberry32 } from '../../../noise.js';
import { flakMats, setPaint, paintCarrier, add, build, noShadow, tubeAB, plankPit, floorDisc, crewSpot, pointerSet, wheelSet, cellQuad, DIAL_CELLS } from './kit44.js';

// Kommandogeraet 40, the heavy battery's predictor with its built-in 4 m stereoscopic rangefinder, in its
// own pit (refs/ww2/battery section 1; photos battery_kg40_01 to _06). The upper instrument turns as one
// on its pedestal: the round walk-round grating platform, the two-tier computing cabinet (the operators'
// sloped panel at the rear with three dial windows of two dials each, knobs on top, telephone headsets
// hanging on their cords, the trackers' black handwheels on both sides), the two trunnion brackets on the
// cabinet's top and the rangefinder tube across them: a fat central housing, the arms out to the
// rectangular end boxes with their entrance windows facing the target (4.8 m over all), the eyecup blocks
// on top (the trackers' telescopes just outboard of the brackets over their handwheels, azimuth on the left
// and elevation on the right, the rangetaker's stereo eyepiece out on the left arm, as kg40_01 shows them)
// and a U-shaped carrying handle on each half
// (battery_kg40_arm_05, battery_kg40_panel_04). Under the platform the transport mounting's four feet.
// The pit (battery_kg40_crew_06, Berlin-Karow 1943): round, plank-walled and low, the platform at floor
// level, posts round it carrying wires for a camouflage net overhead, the cable bundle to the guns leaving
// through a gap at the rear. Dimensions are the sheet's estimates scaled from the photos with the 4 m
// base (no drawing was found): tube axis 1.5 m above the ground, platform 2.6 m across.
//
// Rig (model space front -Z = the direction the rangefinder looks at zero traverse, ground y = 0):
//   pivots.turret     the upper instrument and its platform, (0, 0.1, 0). rotation.y = traverse, + to the
//                     left; full circle.
//   pivots.elevation  the rangefinder tube's trunnions, turret space (0, 1.4, 0). rotation.x = elevation,
//                     + raises the end windows' line of sight; 0 to +90 deg (0 to 1.571).
//   The trackers' handwheels turn with the pivots; the panel's dials follow the pivots and
//   rig.setData({ fuze }) (seconds).
//   anchors.eye       camera focus (0, 1.6, 0.4) on the root.
//   anchors.sight     the rangetaker's stereo eyepiece out on the left arm (elevation group), -Z along the
//                     line of sight: the rangefinder picture for a console.
//   anchors.cable     where the cable bundle to the battery leaves the pit (root), -Z along it.
//   anchors.crew      on the turret (they ride round with the platform): cmd commander, r1 rangetaker (at
//                     the eyepiece), r2 azimuth tracker (left), r3 elevation tracker (right), r4 course
//                     plotter and r5 corrections (at the rear panel), all standing; see kit44.js crewSpot.
//   setPaint('grey' | 'yellow'): Dunkelgrau by default, as the battery's guns.

const K = { platY: 0.1, axis: 1.38, half: 2.4, pitR: 3.1 };

function cabinet(T) {
  const paint = (g, t = 0xffffff) => add(T, 'paint', g, t);
  // (kg40_02: about 1.3 m wide and 1.24 m tall over the platform, the tube axis just above its top)
  // lower box and the upper tier, the operators' sloped panel at the rear of the upper tier
  paint(rbox(1.5, 0.78, 1.0, 0.03, 0, 0.42, 0));
  paint(rbox(1.54, 0.05, 1.04, 0.02, 0, 0.82, 0.0), 0xe0e0e0);
  paint(rbox(1.5, 0.4, 0.62, 0.03, 0, 1.04, -0.19));
  // (kg40_01, kg40_panel_04: the panel takes the right two thirds of the rear, a tall block with the
  // azimuth tracker's handwheel on its side the left third)
  paint(rbox(0.48, 0.42, 0.44, 0.03, -0.51, 1.03, 0.27));
  const panelM = xf(0.23, 1.02, 0.31, 0.72, 0, 0); // tilted to face up and back at the operators
  paint(rbox(1.02, 0.1, 0.42, 0.02, 0, -0.03, 0).applyMatrix4(panelM));
  // three dial windows' raised frames on the panel, a knob on each
  const wins = [];
  for (const x of [-0.32, 0, 0.32]) {
    paint(rbox(0.29, 0.03, 0.23, 0.02, x, 0.03, 0).applyMatrix4(panelM), 0xd8d8d8);
    add(T, 'black', yTube(0.0, 0.05, 0.022, 0.02, 10, x + 0.07, 0.1, -0.09).applyMatrix4(panelM));
    wins.push(x);
  }
  // the front face (toward the target): the big round black covers of the upper tier, doors below
  for (const x of [-0.35, 0.38]) add(T, 'black', zTube(-0.5, -0.55, 0.12, 0.12, 20, x, 1.02));
  paint(box(0.56, 0.5, 0.02, -0.35, 0.42, -0.505), 0xd6d6d6);
  paint(box(0.5, 0.32, 0.02, 0.35, 0.3, -0.505), 0xd6d6d6);
  for (const s of [-1, 1]) paint(box(0.02, 0.55, 0.7, s * 0.755, 0.42, 0.02), 0xd6d6d6);
  // the louvred inspection panel and the folding step at the rear
  paint(box(0.42, 0.5, 0.02, -0.35, 0.42, 0.505), 0xd6d6d6);
  for (let i = 0; i < 12; i++) add(T, 'black', zTube(0.515, 0.525, 0.024, 0.024, 8, -0.43 + (i % 3) * 0.08, 0.24 + Math.floor(i / 3) * 0.11));
  paint(box(0.45, 0.02, 0.22, 0.25, 0.08, 0.64), 0xcfcfcf);
  paint(box(0.38, 0.02, 0.08, 0.25, 0.7, 0.53), 0xcfcfcf);
  // telephone headsets hanging on their cords from the panel's lower edge
  const rnd = mulberry32(40);
  for (const x of [-0.55, -0.2, 0.22, 0.56]) {
    const top = V(x, 0.95, 0.5), bot = V(x + (rnd() - 0.5) * 0.06, 0.55 + rnd() * 0.12, 0.56);
    add(T, 'black', tubeAB(top, bot, 0.005, 0.005, 4));
    add(T, 'black', xTube(bot.x - 0.06, bot.x - 0.035, 0.04, 0.04, 10, bot.y, bot.z));
    add(T, 'black', xTube(bot.x + 0.035, bot.x + 0.06, 0.04, 0.04, 10, bot.y, bot.z));
    add(T, 'black', tubeAB(V(bot.x - 0.05, bot.y + 0.03, bot.z), V(bot.x + 0.05, bot.y + 0.03, bot.z), 0.008, 0.008, 4));
  }
  // the trunnion brackets on top at both ends, short C rings round the tube
  for (const s of [-1, 1]) {
    paint(rbox(0.14, 0.22, 0.3, 0.03, s * 0.64, 1.27, -0.02), 0xdcdcdc);
    paint(xTube(s * 0.58, s * 0.7, 0.21, 0.21, 22, K.axis, 0), 0xe4e4e4);
  }
  // the trackers' handwheels' gear housings on both sides of the upper tier
  for (const s of [-1, 1]) paint(rbox(0.1, 0.2, 0.2, 0.02, s * 0.79, 1.0, 0.2), 0xd8d8d8);
  return { panelM, wins };
}

function tube(E) {
  const paint = (g, t = 0xffffff) => add(E, 'paint', g, t);
  // central housing with its bosses and caps, the arms, collars, the end boxes with their windows
  paint(xTube(-0.54, 0.54, 0.17, 0.17, 24, 0, 0));
  paint(rbox(0.7, 0.18, 0.34, 0.03, 0, 0.12, 0.04), 0xe0e0e0);
  for (const x of [-0.3, 0.1]) paint(zTube(0.16, 0.2, 0.05, 0.05, 14, x, 0.06), 0xe8e8e8);
  for (const s of [-1, 1]) {
    paint(xTube(s * 0.54, s * 0.72, 0.19, 0.19, 24, 0, 0), 0xd0d0d0); // collar at the bracket
    paint(xTube(s * 0.72, s * 1.15, 0.15, 0.125, 22, 0, 0));
    paint(xTube(s * 1.15, s * 1.2, 0.135, 0.135, 20, 0, 0), 0xd8d8d8);
    paint(xTube(s * 1.2, s * 1.95, 0.12, 0.115, 20, 0, 0));
    paint(rbox(0.5, 0.33, 0.3, 0.03, s * 2.15, 0.0, 0.0));
    paint(box(0.1, 0.3, 0.27, s * 2.37, 0.0, 0.0), 0xd8d8d8);
    add(E, 'glass', box(0.16, 0.14, 0.01, s * 2.15, 0.0, -0.152)); // entrance window
    add(E, 'black', box(0.18, 0.16, 0.008, s * 2.15, 0.0, -0.149));
    // U-shaped carrying handle
    for (const x of [s * 1.35, s * 1.65]) add(E, 'metal', rod(V(x, 0.1, 0), V(x, 0.26, 0.02), 0.012, 6), 0xb0b0b0);
    add(E, 'metal', rod(V(s * 1.35, 0.26, 0.02), V(s * 1.65, 0.26, 0.02), 0.012, 6), 0xb0b0b0);
    // the tracker's telescope eyecup block on this half, just outboard of the bracket over his handwheel
    // (azimuth on the left, elevation on the right; kg40_01)
    eyecups(E, s * 0.88, 0.11, 0.06);
  }
  // the rangetaker's stereo eyepiece out on the left arm (kg40_01, kg40_arm_05)
  eyecups(E, -1.65, 0.11, 0.06, 0.22);
}
// an eyecup block (kg40_arm_05): a housing on the tube with two big black rubber cups raised toward the rear
function eyecups(E, x, y, z, w = 0.2) {
  add(E, 'paint', rbox(w + 0.04, 0.1, 0.18, 0.02, x, y, z), 0xd0d0d0);
  for (const dx of [-w * 0.27, w * 0.27]) {
    add(E, 'black', zTube(z + 0.05, z + 0.12, 0.035, 0.042, 12, x + dx, y + 0.08));
    add(E, 'black', box(0.085, 0.09, 0.05, x + dx, y + 0.12, z + 0.12, 0.3, 0, 0));
  }
}

export function buildKdo40() {
  const rig = newRig('green');
  const mats = flakMats('grey');
  rig.mats = mats;
  const root = rig.root, rnd = mulberry32(41);

  // ---- the pit (rig.emplacement)
  const emp = new THREE.Group();
  emp.name = 'emplacement';
  root.add(emp);
  rig.emplacement = emp;
  const P = new Parts(mats);
  const pit = plankPit(P, { R: K.pitR, H: 0.95, sides: 16, open: [8], bank: 2.0, crown: 0.6, planks: 5, rnd });
  floorDisc(P, K.pitR + 0.1, 0.005);
  // posts round the pit carrying the wires for the camouflage net, the net slung over part of them
  const posts = [];
  for (let i = 0; i < 6; i++) {
    const a = ((i + 0.5) / 6) * Math.PI * 2, r = K.pitR + 0.7;
    const p = V(Math.sin(a) * r, 0, -Math.cos(a) * r);
    add(P, 'wood', yTube(-0.1, 2.6 + rnd() * 0.2, 0.045, 0.04, 7, p.x, p.z), 0xcabda8);
    posts.push(p.setY(2.6));
  }
  for (let i = 0; i < 6; i++) for (const j of [(i + 1) % 6, (i + 3) % 6]) if (j > i || j === (i + 3) % 6 && i < 3) {
    const a = posts[i], b = posts[j], mid = a.clone().add(b).multiplyScalar(0.5).setY(2.35);
    add(P, 'metal', tubeAB(a, mid, 0.004, 0.004, 3), 0x707070, 0);
    add(P, 'metal', tubeAB(mid, b, 0.004, 0.004, 3), 0x707070, 0);
  }
  // the cable bundle to the guns: from the pedestal across the floor and out through the gap
  const cab = new THREE.CatmullRomCurve3([V(0, 0.05, 0.3), V(0.1, 0.03, 1.5), V(0.15, 0.03, 2.8), V(0.2, 0.02, 4.2), V(0.25, -0.15, 5.6)]);
  add(P, 'black', new THREE.TubeGeometry(cab, 30, 0.035, 6, false), 0xffffff, 0);
  build(P, emp, 0, 0.3);

  // ---- the fixed base: the transport mounting's feet under the platform, the pedestal
  const X = new Parts(mats);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    add(X, 'paint', box(0.16, 0.08, 1.1, 0, 0.04, -0.55).applyMatrix4(xf(0, 0, 0, 0, a, 0)), 0xcfcfcf);
    add(X, 'paint', box(0.22, 0.03, 0.22, 0, 0.015, -1.05).applyMatrix4(xf(0, 0, 0, 0, a, 0)), 0xbdbdbd);
  }
  add(X, 'paint', yTube(0, K.platY, 0.4, 0.38, 20));
  build(X, root, 0, 0.3);

  // ---- the upper instrument on its platform
  const tur = pivotAt(rig, root, 'turret', 0, K.platY, 0);
  const T = new Parts(mats);
  add(T, 'grate', yTube(0.0, 0.03, 1.3, 1.3, 40).applyMatrix4(xf(0, 0, 0)), 0xffffff, 0.5);
  add(T, 'paint', new THREE.TorusGeometry(1.3, 0.025, 4, 48).applyMatrix4(xf(0, 0.015, 0, Math.PI / 2, 0, 0)), 0xd0d0d0);
  for (let i = 0; i < 4; i++) add(T, 'paint', box(0.05, 0.03, 2.5, 0, 0.016, 0).applyMatrix4(xf(0, 0, 0, 0, (i * Math.PI) / 4, 0)), 0xc8c8c8);
  const cb = cabinet(T);
  build(T, tur, K.platY, 0.15);
  // dial faces (three windows of two dials) and the pointers
  const D = new Parts(mats);
  for (const x of cb.wins) D.add('dial', cellQuad(0.25, 0.172, DIAL_CELLS.plate).applyMatrix4(cb.panelM.clone().multiply(xf(x, 0.062, 0, -Math.PI / 2, 0, 0))), { uv: true });
  for (const m of build(D, tur, K.platY, 0)) noShadow(m);
  // trackers' handwheels on the sides (azimuth left, elevation right)
  const hwL = node(tur, 'wheelAz', -0.86, 1.0, 0.2), hwR = node(tur, 'wheelEl', 0.86, 1.0, 0.2);
  wheelSet(root, [hwL, hwR].map((node, i) => ({ node, R: 0.13, M: xf(0, 0, 0, 0, (Math.PI / 2) * (i ? 1 : -1), 0) })), mats.black, { spokes: 4 });

  // ---- the rangefinder tube
  const el = pivotAt(rig, tur, 'elevation', 0, K.axis, 0);
  const E = new Parts(mats);
  tube(E);
  build(E, el, K.platY + K.axis, 0);

  // ---- the handwheels and dials follow the instrument
  hwL.updateMatrix = function () { this.rotation.x = (tur.rotation.y / (20 * DEG)) * Math.PI * 2; THREE.Object3D.prototype.updateMatrix.call(this); };
  hwR.updateMatrix = function () { this.rotation.x = -(el.rotation.x / (10 * DEG)) * Math.PI * 2; THREE.Object3D.prototype.updateMatrix.call(this); };
  const data = { fuze: 12 };
  const slots = [], fn = [];
  cb.wins.forEach((x, k) => {
    const M = cb.panelM.clone().multiply(xf(x, 0.063, 0, -Math.PI / 2, 0, 0));
    for (const [cu, len, per] of [[-0.047, 0.038, 0], [0.053, 0.05, 1]]) {
      const c = V(cu, 0, 0.003).applyMatrix4(M), n = V(0, 0, 1).transformDirection(M);
      slots.push({ parent: tur, pos: c.toArray(), face: n.toArray(), len, width: 0.006, color: 0xf2f0e4 });
      fn.push([k, per]);
    }
  });
  const PER = [[360, 36], [100, 10], [30, 3]]; // azimuth, elevation, fuze: degrees (s) per turn, coarse and fine
  pointerSet(root, slots, (out) => {
    const v = [-tur.rotation.y / DEG, el.rotation.x / DEG, data.fuze];
    for (let i = 0; i < fn.length; i++) { const [k, per] = fn[i]; out[i] = (v[k] / PER[k][per]) * Math.PI * 2; }
  });

  // ---- anchors
  rig.anchors.eye = node(root, 'eye', 0, 1.6, 0.4);
  rig.anchors.sight = node(el, 'eyepiece', -1.65, 0.21, 0.25);
  rig.anchors.cable = node(root, 'cable', 0.22, 0.0, 4.6, 0, Math.PI, 0);
  const P0 = -K.platY + 0.03; // platform top, turret space
  rig.anchors.crew = {
    cmd: crewSpot(tur, 'cmd', 0.7, P0, 1.05, -20, { label: 'battery officer / KG commander' }),
    r1: crewSpot(tur, 'r1', -1.65, P0, 0.45, 0, { label: 'No. 1 rangetaker (stereo eyepiece)', pose: 'eyepiece' }),
    r2: crewSpot(tur, 'r2', -0.95, P0, 0.5, 0, { label: 'No. 2 azimuth tracker (left telescope, handwheel)', pose: 'crank', hands: V(-0.92, 1.0, 0.2) }),
    r3: crewSpot(tur, 'r3', 0.95, P0, 0.5, 0, { label: 'No. 3 elevation tracker (right telescope, handwheel)', pose: 'crank', hands: V(0.92, 1.0, 0.2) }),
    r4: crewSpot(tur, 'r4', -0.42, P0, 0.9, 0, { label: 'No. 4 course plotter (panel)', pose: 'panel' }),
    r5: crewSpot(tur, 'r5', 0.42, P0, 0.9, 0, { label: 'No. 5 corrections and switches (panel)', pose: 'panel' }),
  };

  hb(rig, -0.76, 0, -0.52, 0.76, 1.35, 0.58);
  hb(rig, -2.4, 1.2, -0.2, 2.4, 1.65, 0.2);
  hb(rig, -1.3, 0, -1.3, 1.3, 0.15, 1.3);

  let paint = 'grey';
  paintCarrier(root);
  rig.setPaint = (s) => { if (s !== paint && (s === 'grey' || s === 'yellow')) { paint = s; setPaint(root, s); } };
  rig.setData = (d) => { if (d && d.fuze != null) data.fuze = d.fuze; };
  return rig;
}
