import * as THREE from 'three';
import { V, DEG, box, rbox, yTube, zTube, xTube, rod, lathe, xf, loft, sideProfile, Parts } from '../../../models/kit.js';
import { newRig, node, pivotAt, hb } from '../../../models/rig.js';
import { mulberry32 } from '../../../noise.js';
import { flakMats, setPaint, paintCarrier, add, build, noShadow, tubeAB, panSeat, plankPit, clockNumbers,
  floorDisc, caseHead, crewSpot, pointerSet, wheelSet, cellQuad, DIAL_CELLS } from './kit44.js';

// 8,8 cm Flak 37 of a static home-defence heavy battery in its earth and timber gun pit (refs/ww2/flak88,
// the sheet's "decision recorded"): the Lafettenkreuz 36 with its side outriggers down on the levelling
// jacks, the Sd.Anh. 202 bogies off; the conical pedestal; the top carriage with its tall side walls and
// the trunnions at their rear; the trough cradle with the recoil brake under the barrel; the L/56 barrel
// (thin front tube stepping up to the jacket, no muzzle brake), the recuperator above it, the horizontal
// sliding wedge breech; the two spring equilibrators forward under the cradle; on the right the two
// Uebertragungsgeraet 37 receiver boxes (each a coarse and a fine dial with the director's pointer and the
// gun's follow pointer, flak88_receivers_09) above the traverse (front) and elevation (rear) handwheels
// and the pan seat between them (flak88_museum_right_10); on the left the Flak 37 fuze setter
// (Zuenderstellmaschine) with its two setting cups, its raised angled dial housing, the command handwheel
// at its front and the flywheel crank on its side, and the setter's seat in front of it (flak88_static_13);
// no shield (home-defence guns had none) and no rammer (removed in wartime, hand loading). The pit after
// the Karow and Bundesarchiv photos (flak88_pit_karow_03, flak88_loading_ba_06, flak88_crew_karow_01): a
// twelve-sided plank wall on posts, 8 m across and 1.4 m high, earth banked against it, white clock
// numbers on the top boards (12 at the model's front), five ammunition niches with rounds stacked bases
// out under hinged lids, log decking flush with the cross arms, the entrance at 6 o'clock (the rear), the
// cable from the rear arm's junction box running out through it.
//
// Dimensions: the sheet's section 2 (barrel 4.93 m, trunnion 1.58 m, bore axis at the trunnion, cross top
// 0.275 m, outriggers spanning 5.14 m, recoil 1.05 m at 0 deg and 0.70 m at 85 deg); the trunnions 0.78 m
// behind the pivot and the breech face 0.55 m behind the trunnions are what lets the breech clear the
// pedestal and the platform at 85 deg (the sheet: "close to the platform at 85 degrees"), checked on the
// Volgograd photo (flak88_museum_left_14). The pit floor is the ground (y = 0) and the pit is built up,
// as the Karow pits were, so the terrain never covers it.
//
// Rig (model space front -Z, right +X, ground y = 0; angles in three's conventions):
//   pivots.turret     the top carriage on the pedestal at (0, 0.8, 0). rotation.y = traverse relative to the
//                     cross, + turns the muzzle to the left; 0 = muzzle over the front arm (12 o'clock).
//                     Full circle (the real data cable stops it after two turns each way).
//   pivots.elevation  the trunnions, turret space (0, 0.78, 0.78) (1.58 m above the ground). rotation.x =
//                     quadrant elevation, + raises the muzzle; real limits -3 deg (-0.052) to +85 deg (1.484).
//   pivots.recoil     the recoiling mass (barrel, breech ring, recuperator, the kill rings and the letter)
//                     inside the cradle: position.z = recoil distance in metres, + toward the breech. Use
//                     rig.setRecoil(m); rig.recoilLength(el) gives the full stroke at an elevation.
//   pivots.breech     the sliding wedge in the breech ring: rig.setBreech(k), 0 closed .. 1 open (it slides
//                     0.14 m to the gun's right).
//   Handwheels (traverse, elevation, the fuze setter's) turn by themselves with the pivots (3.6 deg of
//   traverse and 2 deg of elevation per turn, the high gears); the receiver dials' follow pointers show
//   the gun's own angles, the director's pointers what rig.setOrder({ az, el, fuze }) last gave (az and el
//   in the pivots' conventions, fuze in seconds of running time); without an order they lie on each other.
//   anchors.muzzles   [the muzzle], in the recoil group, -Z along the bore.
//   anchors.breech    the chamber mouth behind the breech face (recoil group), -Z into the bore: where a
//                     round goes in.
//   anchors.sight     the ZF 20E direct-laying telescope at the front of the right wall; follows elevation.
//   anchors.eye       camera focus (0, 1.9, 0.3) on the root.
//   anchors.fuzeCups  [2] the setting cups' mouths on the fuze setter (turret space), +Y up.
//   anchors.rack      the ready-round rack's top slot on the setter housing (turret space): a round's middle there,
//                     its nose along -Z, is where the number takes the next round from.
//   anchors.niches    [5] the ammunition niches' openings on the pit wall (root), -Z into the niche.
//   anchors.cable     where the data cable from the rear arm's junction box leaves the pit (root, ground level).
//   anchors.crew      crew spots, see crewSpot in kit44.js (position = feet or seat point, -Z = facing):
//                     on the turret (they ride round with it): k1 elevation layer and k2 traverse layer
//                     (standing at the right handwheels), k6 fuze setter (seated), k3 loader (left rear of
//                     the breech), k4 and k5 ammunition numbers (at the setter's cups); on the root: gf gun
//                     commander (left rear), k7 and k8 ammunition carriers (at the niches).
//   setPaint('grey' | 'yellow'), setLetter('A'..'F' | 0..5), setKills(0..12).
// Paint: Dunkelgrau by default (refs/ww2/markings 1.2: grey heavy guns, one or two Dunkelgelb).
// Markings (markings44.js): the gun letter on both sides of the recuperator's front end; the kill rings
// are white bands painted round the thin front tube, from 0.45 m behind the muzzle back toward the step,
// 0.05 m wide on a 0.1 m pitch (flak88_loading_ba_06, markings_karow_emil_rings_02).

export const F88 = {
  pivotY: 0.72,
  trunnion: { y: 0.86, z: 0.53 }, // turret space
  bf: 0.55, // breech face behind the trunnions
  barrel: 4.93,
  // arm tips and their jacks (set back from the tips): the Volgograd solve, the TM's 5.14 m across the
  // outriggers and 5.79 m from the rear arm's end to the muzzle at 0 deg
  cross: { top: 0.275, front: 1.95, rear: 1.95, side: 2.5, hinge: 1.11, jack: { front: 1.8, rear: 1.8, side: 2.2 } },
  pit: { R: 4.4, H: 1.4, sides: 12, entrance: 6, niches: [0, 2, 4, 8, 10] },
  deck: 0.145, // top of the log decking laid on the pit floor round the cross (the crew's floor)
  recoil: [1.05, 0.7], // at 0 and 85 deg
};
const MUZ = F88.bf - F88.barrel; // muzzle z in the elevation / recoil frame (-4.38)
export const REC = { z0: -1.47, y: 0.215, r: 0.095 }; // the recuperator's front cap, in the recoil frame
const MAX_RINGS = 12;

// a tapered box girder along z between two rectangular sections, flat shaded
function beam(z0, z1, w0, w1, top0, top1, bot0, bot1, x = 0) {
  const ring = (z, w, t, b) => [V(x - w / 2, b, z), V(x + w / 2, b, z), V(x + w / 2, t, z), V(x - w / 2, t, z)];
  return loft([ring(z0, w0, top0, bot0), ring(z1, w1, top1, bot1)], { crease: 0.5 });
}
const rotY = (g, a) => g.applyMatrix4(xf(0, 0, 0, 0, a, 0));

// ---------------------------------------------------------------- the cross, pedestal and pit

function cross(P) {
  const C = F88.cross, T = C.top, J = C.jack;
  const paint = (g, t = 0xffffff) => add(P, 'paint', g, t);
  // central body (cast box) and its side stubs to the outrigger hinges
  paint(rbox(1.1, 0.2, 1.1, 0.04, 0, T - 0.1, 0));
  for (const s of [-1, 1]) {
    // side stub, hinge knuckles and the outrigger, down on its jack
    paint(rotY(beam(0.5, C.hinge - 0.04, 0.34, 0.3, T, T - 0.01, T - 0.2, T - 0.18), s * -Math.PI / 2));
    for (const z of [-0.12, 0.12]) add(P, 'paint', zTube(z - 0.05, z + 0.05, 0.05, 0.05, 10, s * C.hinge, T - 0.08), 0xd8d8d8);
    paint(rotY(beam(C.hinge + 0.03, C.side - 0.02, 0.26, 0.18, T - 0.01, T - 0.05, T - 0.19, T - 0.12), s * -Math.PI / 2));
    tip(P, s * C.side, 0, s * -Math.PI / 2);
    jack(P, s * J.side, 0, s > 0 ? 0 : Math.PI);
  }
  // front and rear arms, long box girders tapering to their tips
  paint(beam(-0.53, -(C.front - 0.02), 0.38, 0.24, T, T - 0.04, T - 0.2, T - 0.12));
  paint(beam(0.53, C.rear - 0.02, 0.38, 0.24, T, T - 0.04, T - 0.2, T - 0.12));
  tip(P, 0, -C.front, Math.PI);
  tip(P, 0, C.rear, 0);
  jack(P, 0, -J.front, 0);
  jack(P, 0, J.rear, 0);
  // top plates along the arms, overhanging a little
  paint(box(0.42, 0.015, C.front - 0.62, 0, T + 0.006, -(C.front + 0.5) / 2), 0xe0e0e0);
  paint(box(0.42, 0.015, C.rear - 0.62, 0, T + 0.006, (C.rear + 0.5) / 2), 0xe0e0e0);
  // lifting arms with D-rings for the bogies, front and rear of the body
  for (const s of [-1, 1]) {
    paint(box(0.5, 0.1, 0.12, 0, T - 0.05, s * 0.6));
    for (const x of [-0.24, 0.24]) add(P, 'metal', new THREE.TorusGeometry(0.05, 0.012, 5, 10).applyMatrix4(xf(x, T + 0.03, s * 0.66, Math.PI / 2, 0, 0)), 0xb0b0b0);
  }
  // barrel rest (Rohrstuetze) folded down on the front arm, the tool box beside it
  for (const x of [-0.13, 0.13]) add(P, 'paint', tubeAB(V(x, T + 0.03, -0.78), V(x * 0.45, T + 0.03, -1.55), 0.022, 0.022, 7), 0xd0d0d0);
  add(P, 'paint', tubeAB(V(-0.13, T + 0.03, -0.78), V(0.13, T + 0.03, -0.78), 0.022, 0.022, 7), 0xd0d0d0);
  paint(box(0.2, 0.05, 0.14, 0, T + 0.04, -1.6));
  paint(rbox(0.22, 0.14, 0.55, 0.02, 0.3, T + 0.03, -1.15), 0xc8c8c8);
  // cable junction box with the tail lamp at the rear arm's end (the fire bell is inside the arm)
  paint(rbox(0.3, 0.22, 0.26, 0.02, 0, T + 0.05, C.rear - 0.55));
  add(P, 'black', zTube(C.rear - 0.42, C.rear - 0.37, 0.04, 0.04, 8, 0.07, T + 0.06));
  add(P, 'metal', zTube(C.rear - 0.42, C.rear - 0.39, 0.03, 0.03, 8, -0.08, T + 0.08), 0x8a2020);
}

// The end of an arm: a forged eye (the lug the bogie's winch hook takes) and the ground stake through it.
function tip(P, x, z, ry) {
  const T = F88.cross.top, M = xf(x, 0, z, 0, ry, 0);
  add(P, 'paint', box(0.2, 0.12, 0.12, 0, T - 0.1, -0.02).applyMatrix4(M), 0xd8d8d8);
  add(P, 'metal', new THREE.TorusGeometry(0.06, 0.02, 6, 12).applyMatrix4(xf(0, T - 0.1, 0.06, 0, Math.PI / 2, 0)).applyMatrix4(M), 0xa0a0a0);
  add(P, 'metal', rod(V(0.1, -0.06, -0.08), V(0.1, T + 0.05, -0.06), 0.018, 6).applyMatrix4(M), 0x9a9a9a);
  add(P, 'metal', yTube(T + 0.04, T + 0.07, 0.03, 0.03, 6, 0.1, -0.06).applyMatrix4(M), 0x9a9a9a);
}

// A levelling jack (Horizontierungsspindel) at an arm's end: square foot (Lafettenkreuz 36), screw, the
// spindle housing standing on the arm and its crank on top.
function jack(P, x, z, ry) {
  const T = F88.cross.top;
  add(P, 'paint', box(0.32, 0.035, 0.32, x, 0.0175, z), 0xbdbdbd);
  add(P, 'paint', box(0.16, 0.04, 0.16, x, 0.055, z), 0xbdbdbd);
  add(P, 'metal', yTube(0.07, T - 0.12, 0.03, 0.03, 8, x, z));
  add(P, 'paint', yTube(T - 0.14, T + 0.2, 0.055, 0.05, 10, x, z));
  add(P, 'paint', yTube(T + 0.2, T + 0.24, 0.035, 0.035, 8, x, z));
  const M = xf(x, T + 0.25, z, 0, ry, 0);
  add(P, 'metal', box(0.22, 0.02, 0.025, 0.08, 0, 0).applyMatrix4(M));
  add(P, 'black', yTube(0, 0.07, 0.012, 0.012, 6, 0.18, 0).applyMatrix4(M));
}

function pedestal(P) {
  const T = F88.cross.top, Y = F88.pivotY;
  add(P, 'paint', lathe([[0.001, T], [0.46, T], [0.46, T + 0.035], [0.38, T + 0.05], [0.27, Y - 0.05], [0.31, Y - 0.04], [0.31, Y - 0.005], [0.001, Y - 0.005]], 28));
  // the levelling gimbal's handwheel boxes on the body (top-carriage levelling, set once)
  for (const s of [-1, 1]) add(P, 'paint', rbox(0.14, 0.12, 0.14, 0.02, s * 0.45, T + 0.07, 0.36), 0xd0d0d0);
}

// log decking on the pit floor round the cross (flak88_loading_ba_06): in each quadrant poles laid along
// the quadrant's bisector out to the line joining the two arm tips, so the platform is a square standing
// on its corners at the arm tips (herringbone round the arms); the cross arms stand a little proud of it
function decking(P) {
  const C = F88.cross, rnd = mulberry32(29), r = 0.072, y = F88.deck - r, w = 0.24, pitch = 2 * r + 0.008;
  const tips = [[0, -C.front], [C.side, 0], [0, C.rear], [-C.side, 0]]; // clockwise from the front
  for (let q = 0; q < 4; q++) {
    const A = tips[q], B = tips[(q + 1) % 4];
    const mx = (A[0] + B[0]) / 2, mz = (A[1] + B[1]) / 2, ml = Math.hypot(mx, mz);
    const d = V(mx / ml, 0, mz / ml), n = V(-d.z, 0, d.x); // along the bisector, and across it
    // the far edge: the line A-B, as t along d for an offset s along n
    const ab = V(B[0] - A[0], 0, B[1] - A[1]);
    for (let s = -4; s <= 4; s += pitch) {
      // solve s n + t d = A + k ab for t (and k in [0, 1])
      const det = d.x * -ab.z - d.z * -ab.x;
      const rx = A[0] - s * n.x, rz = A[1] - s * n.z;
      const t1 = (rx * -ab.z - rz * -ab.x) / det, k = (d.x * rz - d.z * rx) / det;
      if (k < 0 || k > 1) continue;
      const t0 = Math.SQRT2 * w + Math.abs(s) * 1.0;
      if (t1 - 0.06 - t0 < 0.25) continue;
      const a0 = n.clone().multiplyScalar(s).addScaledVector(d, t0), a1 = n.clone().multiplyScalar(s).addScaledVector(d, t1 - 0.06 + (rnd() - 0.5) * 0.12);
      const rr = r * (0.9 + rnd() * 0.2);
      add(P, 'wood', tubeAB(V(a0.x, y, a0.z), V(a1.x, y + (rnd() - 0.5) * 0.01, a1.z), rr, rr * 0.95, 7), [0xc9b9a0, 0xb8a88f, 0xd2c4ab][Math.floor(rnd() * 3)], 1);
    }
  }
}

// an ammunition niche in a pit panel: timber-lined box in the bank, rounds stacked bases out, a hinged
// board propped open above it
function niche(P, pn, rnd, W = 1.0, y0 = 0.4, h = 0.62, D = 0.55) {
  const M = xf(pn.c.x, 0, pn.c.z, 0, -pn.a, 0); // local +Z into the pit, -Z into the bank
  const at = (g, t = 0xffffff, key = 'wood') => add(P, key, g.applyMatrix4(M), t, 1);
  at(box(W + 0.12, 0.05, D + 0.05, 0, y0 - 0.025, -D / 2 - 0.02), 0xbfb4a2); // floor
  at(box(W + 0.12, 0.05, D + 0.05, 0, y0 + h + 0.025, -D / 2 - 0.02), 0xbfb4a2); // roof
  at(box(0.04, h, D, -W / 2 - 0.02, y0 + h / 2, -D / 2), 0xb3a891);
  at(box(0.04, h, D, W / 2 + 0.02, y0 + h / 2, -D / 2), 0xb3a891);
  at(box(W, h, 0.04, 0, y0 + h / 2, -D - 0.02), 0x9c9280); // back
  // frame posts and lintel on the face
  at(box(0.08, h + 0.12, 0.08, -W / 2 - 0.04, y0 + h / 2, 0.0), 0xcbbfac);
  at(box(0.08, h + 0.12, 0.08, W / 2 + 0.04, y0 + h / 2, 0.0), 0xcbbfac);
  // the lid: a board hanging from a hinge on the lintel, propped open into the pit about 75 deg
  const L = xf(0, y0 + h + 0.08, 0.05, -1.3, 0, 0);
  at(box(W + 0.1, h + 0.08, 0.035, 0, -(h + 0.08) / 2, 0).applyMatrix4(L), 0xd6cdbd);
  const tip = new THREE.Vector3(W / 2 - 0.05, -(h + 0.04), 0).applyMatrix4(L);
  at(rod(V(W / 2 - 0.05, y0 + 0.02, 0.07), tip, 0.015, 5), 0xa89c88);
  // rounds lying bases out, five across and three high, in their racks; a gap where some were taken
  const cols = 5, rows = 3, pitch = W / cols;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    if (rnd() < 0.12) continue;
    const x = -W / 2 + pitch * (c + 0.5) + (r % 2 ? pitch * 0.15 : 0), y = y0 + 0.07 + r * 0.19;
    caseHead({ add: (k, gg, o) => P.add(k, gg.applyMatrix4(M), o) }, x, y, -0.07, 0.056, 0.4, Math.PI, 0, 'brass', rnd() < 0.3 ? 0x8f9a86 : 0xffffff);
  }
  at(box(W, 0.03, 0.06, 0, y0 + 0.01, -0.25), 0x8f8574); // rack battens
}

// ---------------------------------------------------------------- top carriage

function topCarriage(T, rig) {
  const tz = F88.trunnion.z, ty = F88.trunnion.y;
  const paint = (g, t = 0xffffff) => add(T, 'paint', g, t);
  // turntable on the pedestal and the base frame
  paint(yTube(-0.01, 0.07, 0.36, 0.36, 28));
  paint(yTube(0.07, 0.1, 0.33, 0.33, 24), 0xdddddd);
  paint(rbox(0.72, 0.12, 0.9, 0.03, 0, 0.14, -0.08));
  // the side walls: tall plates whose upper edge rises in a convex sweep from the front of the base to
  // the trunnion bearings near their rear, and a concave rear edge back down to the base
  // (flak88_museum_left_14, flak88_static_13)
  const wall = [[-0.5, 0.08], [-0.56, 0.3], [-0.52, 0.48], [-0.4, 0.64], [-0.2, 0.8], [0.05, 0.92], [0.3, 0.99], [tz, 1.03], [0.68, 0.99], [0.75, ty],
    [0.72, 0.72], [0.62, 0.56], [0.52, 0.38], [0.45, 0.2], [0.42, 0.08]];
  for (const s of [-1, 1]) {
    paint(sideProfile(wall, 0.035).applyMatrix4(xf(s * 0.35, 0, 0)));
    // edge flange along the base and a stiffening rib
    paint(box(0.08, 0.025, 0.9, s * 0.35, 0.13, -0.04), 0xd6d6d6);
    paint(rod(V(s * 0.37, 0.16, -0.38), V(s * 0.37, 0.8, 0.4), 0.02, 6), 0xd6d6d6);
    // trunnion bearing: a toothed ring round the bearing cap (flak88_museum_left_14), bolted
    add(T, 'paint', xTube(s * 0.367, s * 0.4, 0.15, 0.15, 24, ty, tz), 0xe2e2e2);
    for (let i = 0; i < 20; i++) { const q = (i / 20) * Math.PI * 2; add(T, 'paint', box(0.03, 0.03, 0.03, s * 0.385, ty + Math.sin(q) * 0.155, tz + Math.cos(q) * 0.155, q, 0, 0), 0xe2e2e2); }
    add(T, 'paint', xTube(s * 0.4, s * 0.44, 0.09, 0.08, 18, ty, tz), 0xe8e8e8);
    for (let i = 0; i < 6; i++) { const q = (i / 6) * Math.PI * 2; add(T, 'metal', xTube(s * 0.4, s * 0.415, 0.012, 0.012, 6, ty + Math.sin(q) * 0.12, tz + Math.cos(q) * 0.12)); }
  }
  // the box between the walls in front (traverse gear), the junction box at the front of the carriage
  paint(rbox(0.66, 0.34, 0.42, 0.03, 0, 0.32, -0.34));
  paint(rbox(0.2, 0.16, 0.14, 0.02, 0.0, 0.56, -0.52), 0xcfcfcf);
  // the equilibrators: two spring cylinders under the cradle, pointing forward to 1.2 m ahead of the pivot
  // at 1.1 m above the ground (Volgograd)
  const ey = 1.11 - F88.pivotY;
  for (const x of [-0.17, 0.17]) {
    paint(zTube(-0.3, -1.04, 0.088, 0.085, 16, x, ey));
    paint(zTube(-1.04, -1.1, 0.07, 0.06, 14, x, ey), 0xdcdcdc);
    add(T, 'metal', zTube(-1.1, -1.2, 0.032, 0.032, 8, x, ey));
    paint(box(0.05, 0.1, 0.08, x, ey, -1.22), 0xd0d0d0);
    paint(zTube(-0.3, -0.4, 0.1, 0.1, 16, x, ey), 0xd8d8d8);
  }
  paint(box(0.56, 0.12, 0.1, 0, ey, -0.3));

  // ---- right side: the laying station (flak88_museum_right_10, read against the barrel jacket): the two
  // receiver boxes side by side 0.2 m below the bore line, elevation (rear) and azimuth (front); 0.5 m below
  // them the handwheels, 0.3 m across, elevation under its receiver and traverse further forward; the
  // pan seat low between them
  const hy = 0.95 - F88.pivotY, ry = 1.43 - F88.pivotY;
  const W = { el: 0.2, az: -0.47 };
  paint(rbox(0.2, 0.2, 0.2, 0.03, 0.47, hy + 0.02, W.el));
  paint(rbox(0.2, 0.2, 0.2, 0.03, 0.47, hy, W.az));
  paint(rbox(0.12, 0.42, 0.14, 0.02, 0.43, hy + 0.3, W.el), 0xd8d8d8); // gear column up to the elevating pinion
  paint(rod(V(0.43, hy + 0.1, W.az + 0.05), V(0.4, hy + 0.25, -0.2), 0.04, 8), 0xd8d8d8);
  paint(xTube(0.57, 0.64, 0.032, 0.028, 10, hy + 0.02, W.el), 0xd0d0d0);
  paint(xTube(0.57, 0.64, 0.032, 0.028, 10, hy, W.az), 0xd0d0d0);
  for (const [z, y] of [[W.el, hy + 0.02], [W.az, hy]]) add(T, 'metal', rod(V(0.58, y + 0.07, z + 0.08), V(0.62, y + 0.17, z + 0.11), 0.01, 5));
  const recv = [];
  for (const z of [-0.195, 0.195]) {
    paint(rbox(0.1, 0.19, 0.27, 0.015, 0.47, ry, z), 0xd8d8d8);
    paint(box(0.1, 0.08, 0.06, 0.41, ry - 0.12, z), 0xc8c8c8);
    paint(yTube(ry + 0.08, ry + 0.14, 0.035, 0.035, 10, 0.47, z + 0.08), 0xd0d0d0); // cable gland on top
    recv.push(z);
  }
  // the junction box at the front of the station, cables up to the receivers
  paint(rbox(0.12, 0.14, 0.14, 0.02, 0.45, ry + 0.02, -0.45), 0xcfcfcf);
  paint(xTube(0.5, 0.53, 0.05, 0.05, 12, ry + 0.02, -0.45), 0xdedede);
  add(T, 'black', tubeAB(V(0.45, ry + 0.1, -0.45), V(0.47, ry + 0.14, -0.12), 0.012, 0.012, 6));
  add(T, 'black', tubeAB(V(0.47, ry + 0.14, -0.12), V(0.47, ry + 0.15, 0.27), 0.012, 0.012, 6));
  panSeat(T, 'paint', 0.74, hy - 0.45, -0.13, 0.22, 0.14);
  paint(rod(V(0.37, 0.1, -0.13), V(0.74, hy - 0.3, -0.13), 0.022, 6), 0xd0d0d0);
  // the ZF 20E bracket at the front of the wall (the telescope rides on the sight group)
  paint(rbox(0.1, 0.14, 0.1, 0.02, 0.45, ry + 0.16, -0.5), 0xd4d4d4);
  // elevation scale (quadrant) by the trunnion
  paint(xTube(0.42, 0.44, 0.09, 0.09, 16, ty - 0.2, tz - 0.14), 0xd8d8d8);

  // ---- left side: the Flak 37 fuze setter and its seat (flak88_static_13: a tall box at the front of the
  // left wall, its top a little above the carriage base, the pan seat in front of it)
  const Lx = -0.37, sy = 1.02 - F88.pivotY; // setter housing top about 1.02 m above the ground
  paint(rbox(0.36, 0.62, 0.44, 0.03, Lx - 0.2, sy - 0.31, -0.38)); // housing
  paint(rbox(0.36, 0.05, 0.5, 0.02, Lx - 0.2, sy, -0.38), 0xdedede);
  // the two setting cups standing vertically on its top (a round goes in nose first)
  const cups = [];
  for (const x of [Lx - 0.11, Lx - 0.29]) {
    paint(yTube(sy - 0.06, sy + 0.15, 0.072, 0.072, 16, x, -0.5));
    paint(yTube(sy + 0.13, sy + 0.16, 0.083, 0.083, 16, x, -0.5), 0xdcdcdc);
    add(T, 'black', yTube(sy + 0.15, sy + 0.161, 0.058, 0.058, 14, x, -0.5));
    cups.push(V(x, sy + 0.16, -0.5));
  }
  // the raised, angled dial housing (the fuze receiver) behind the cups, facing the setter in front
  const dialM = xf(Lx - 0.2, sy + 0.2, -0.25, -0.6, 0, 0);
  paint(rbox(0.32, 0.24, 0.12, 0.02, 0, 0, 0).applyMatrix4(dialM));
  paint(box(0.22, 0.14, 0.16, Lx - 0.2, sy + 0.08, -0.24), 0xd8d8d8);
  // the flywheel and crank on the outboard face, the fire bell above
  add(T, 'paint', xTube(Lx - 0.38, Lx - 0.44, 0.15, 0.15, 22, sy - 0.25, -0.36), 0xd0d0d0);
  add(T, 'metal', xTube(Lx - 0.44, Lx - 0.47, 0.04, 0.04, 10, sy - 0.25, -0.36));
  add(T, 'metal', box(0.02, 0.2, 0.03, Lx - 0.47, sy - 0.18, -0.36));
  add(T, 'black', xTube(Lx - 0.47, Lx - 0.56, 0.013, 0.013, 6, sy - 0.09, -0.36));
  add(T, 'metal', lathe([[0.001, 0.0], [0.06, 0.0], [0.055, 0.03], [0.035, 0.06], [0.001, 0.065]], 14).applyMatrix4(xf(Lx - 0.05, sy + 0.36, -0.1)), 0xb09040);
  paint(rod(V(Lx - 0.05, sy + 0.1, -0.1), V(Lx - 0.05, sy + 0.36, -0.1), 0.012, 5), 0xd0d0d0);
  // the ready-round rack bolted to the setter housing's outer face (E: a stand-in; the references show the
  // ready rounds in the pit's niches, carried to the gun): two rails with saddles, two rounds lying in it nose
  // forward, a third slot on top where the number takes the next (rig.anchors.rack); brass and steel under the
  // set's metal so the rack costs no draw call
  const rx = Lx - 0.62, ry0 = -0.08;
  for (const z of [-0.42, 0.18]) {
    paint(box(0.42, 0.04, 0.05, rx, ry0, z), 0xd0d0d0);
    for (const x of [rx - 0.11, rx + 0.11]) paint(box(0.03, 0.06, 0.05, x, ry0 + 0.04, z), 0xd0d0d0);
  }
  paint(box(0.04, 0.04, 0.7, rx - 0.2, ry0 - 0.01, -0.12), 0xc8c8c8);
  paint(box(0.04, 0.04, 0.7, rx + 0.2, ry0 - 0.01, -0.12), 0xc8c8c8);
  paint(box(0.24, 0.05, 0.05, (Lx - 0.38 + rx + 0.2) / 2, ry0, -0.42), 0xc8c8c8); // the bracket to the housing
  paint(box(0.24, 0.05, 0.05, (Lx - 0.38 + rx + 0.2) / 2, ry0, 0.05), 0xc8c8c8);
  for (const x of [rx - 0.06, rx + 0.06]) {
    const y = ry0 + 0.07, z0 = 0.34; // base end at z0, nose toward -z
    add(T, 'metal', zTube(z0 - 0.57, z0, 0.052, 0.052, 12, x, y), 0xd9b25e); // the case
    add(T, 'metal', zTube(z0 - 0.93, z0 - 0.57, 0.012, 0.046, 12, x, y), 0x8d917c); // the projectile and fuze
  }
  const rack = V(rx, ry0 + 0.15, 0.34 - 0.466);
  // the setter's seat in front, its footrest
  panSeat(T, 'paint', Lx - 0.2, -0.4, -0.95, 0.5, 0.13, true, Math.PI);
  paint(rod(V(Lx - 0.1, -0.2, -0.6), V(Lx - 0.2, 0.04, -0.95), 0.022, 6), 0xd0d0d0);
  paint(box(0.3, 0.03, 0.08, Lx - 0.2, -0.32, -1.22), 0xd0d0d0);
  paint(rod(V(Lx - 0.2, -0.32, -1.19), V(Lx - 0.2, -0.1, -0.97), 0.015, 5), 0xd0d0d0);
  return { recv, cups, dialM, hy, ry, sy, W, rack };
}

// ---------------------------------------------------------------- cradle and barrel

function cradle(E) {
  const paint = (g, t = 0xffffff) => add(E, 'paint', g, t);
  // the trough under the barrel, with the recoil brake cylinder in it
  // (Volgograd: a riveted box girder under the barrel from the trunnions forward, the brake's cylinder
  // standing out of its front end 2.7 m behind the muzzle)
  const cz0 = -1.6, cz1 = 0.28, cl = cz1 - cz0;
  paint(box(0.32, 0.04, cl, 0, -0.28, (cz0 + cz1) / 2));
  for (const s of [-1, 1]) {
    paint(box(0.03, 0.24, cl, s * 0.158, -0.15, (cz0 + cz1) / 2));
    for (let i = 0; i < 14; i++) add(E, 'paint', xTube(s * 0.172, s * 0.18, 0.008, 0.008, 5, -0.065, cz0 + 0.1 + i * 0.12), 0xd0d0d0);
  }
  paint(zTube(cz0 - 0.12, cz1, 0.062, 0.062, 14, 0, -0.19), 0xe0e0e0);
  paint(zTube(cz0 - 0.16, cz0 - 0.12, 0.05, 0.05, 12, 0, -0.19), 0xd0d0d0);
  // front guide collar and rear guide
  paint(zTube(cz0 - 0.04, cz0 + 0.1, 0.15, 0.15, 20, 0, 0.0), 0xe4e4e4);
  paint(box(0.32, 0.12, 0.14, 0, -0.1, cz0 + 0.03));
  paint(zTube(0.12, 0.26, 0.145, 0.145, 20, 0, 0.0), 0xe4e4e4);
  // trunnion pins out to the bearings
  for (const s of [-1, 1]) paint(xTube(s * 0.17, s * 0.37, 0.07, 0.07, 14, 0, 0), 0xdadada);
  // the elevating arc on the right: a toothed sector round the trunnion
  const R0 = 0.37, R1 = 0.48, a0 = -23 * DEG, a1 = 65 * DEG;
  const sh = new THREE.Shape();
  const pt = (r, a) => new THREE.Vector2(r * Math.sin(a), -r * Math.cos(a)); // (z, y): a from straight down toward the rear
  sh.moveTo(...pt(R0, a0).toArray());
  for (let i = 0; i <= 12; i++) sh.lineTo(...pt(R1, a0 + (a1 - a0) * (i / 12)).toArray());
  for (let i = 12; i >= 0; i--) sh.lineTo(...pt(R0, a0 + (a1 - a0) * (i / 12)).toArray());
  const arc = new THREE.ExtrudeGeometry(sh, { depth: 0.035, bevelEnabled: false });
  arc.rotateY(-Math.PI / 2); // shape (z, y) into the YZ plane, extruded along -x
  paint(arc.translate(0.235, 0, 0), 0xd8d8d8);
  for (let i = 0; i <= 34; i++) {
    const a = a0 + (a1 - a0) * (i / 34), p = pt(R1 + 0.012, a);
    add(E, 'metal', box(0.03, 0.022, 0.014, 0.218, p.y, p.x).applyMatrix4(xf(0, 0, 0)), 0xaaaaaa);
  }
  paint(rod(V(0.2, -0.12, 0.2), V(0.2, -0.3, 0.36), 0.02, 6), 0xd0d0d0);
  // the firing lever on the left of the cradle and the recoil indicator
  add(E, 'metal', box(0.02, 0.16, 0.03, -0.19, -0.06, 0.1));
  add(E, 'black', xTube(-0.19, -0.27, 0.012, 0.012, 6, 0.02, 0.1));
  paint(rbox(0.06, 0.08, 0.2, 0.01, -0.19, -0.2, -0.3), 0xd0d0d0);
}

// the barrel, breech ring and recuperator (all recoil); returns the kill-ring parts collector and data
function barrel(B, K) {
  const paint = (g, t = 0xffffff) => add(B, 'paint', g, t);
  const m = MUZ;
  // muzzle swell, thin front tube, the step and the jacket
  paint(zTube(m, m + 0.08, 0.073, 0.073, 20), 0xd8d8d8);
  paint(zTube(m + 0.08, m + 0.12, 0.073, 0.067, 20), 0xd8d8d8);
  paint(zTube(m + 0.12, m + 1.68, 0.067, 0.071, 20), 0xd8d8d8);
  paint(zTube(m + 1.68, m + 1.76, 0.071, 0.077, 20), 0xd8d8d8);
  paint(zTube(m + 1.76, m + 1.96, 0.077, 0.104, 20), 0xd8d8d8);
  paint(zTube(m + 1.96, -0.05, 0.104, 0.11, 20), 0xdedede);
  paint(zTube(-1.55, -1.5, 0.114, 0.114, 20), 0xe2e2e2);
  paint(zTube(-0.05, 0.2, 0.125, 0.125, 20), 0xe2e2e2);
  add(B, 'metal', new THREE.RingGeometry(0.0, 0.044, 16).applyMatrix4(xf(0, 0, m - 0.0005, 0, Math.PI, 0)), 0x1a1a1a);
  add(B, 'metal', new THREE.RingGeometry(0.044, 0.073, 20).applyMatrix4(xf(0, 0, m - 0.001, 0, Math.PI, 0)), 0x5a5a5a); // soot-darkened face
  // breech ring: square block with the horizontal wedge slot, the cocking lever on top
  add(B, 'paint', rbox(0.34, 0.31, 0.35, 0.03, 0, 0, 0.375), 0xc8c8c8);
  add(B, 'metal', box(0.3, 0.135, 0.36, 0, 0, 0.375), 0x9a9a9a); // the wedge's slot, oiled
  add(B, 'metal', box(0.04, 0.05, 0.14, 0.0, 0.17, 0.42), 0x808080);
  add(B, 'metal', box(0.05, 0.04, 0.03, 0.0, 0.2, 0.48), 0x2a2a2a);
  // recuperator above the barrel, its end cap at the front, the rod lug onto the breech ring, clamp bands
  // (Volgograd: the cap 2.9 m behind the muzzle, flak88_killrings_sc195643_08: a plain domed cap)
  paint(zTube(REC.z0 + 0.04, 0.12, 0.095, 0.095, 18, 0, 0.215));
  paint(zTube(REC.z0, REC.z0 + 0.04, 0.086, 0.095, 18, 0, 0.215), 0xe8e8e8);
  paint(rbox(0.12, 0.16, 0.12, 0.02, 0, 0.17, 0.16), 0xd8d8d8);
  for (const z of [-1.02, -0.3]) paint(rbox(0.06, 0.38, 0.24, 0.02, 0, 0.11, z), 0xdcdcdc);
  // the panoramic telescope's holder on top over the pivot
  paint(rbox(0.1, 0.06, 0.14, 0.015, 0, 0.33, -F88.trunnion.z), 0xd0d0d0);
  paint(yTube(0.36, 0.42, 0.03, 0.03, 10, 0, -F88.trunnion.z), 0xd0d0d0);
  // the kill rings: open bands on the thin tube, muzzle end first (drawRange shows the first n)
  for (let i = 0; i < MAX_RINGS; i++) {
    const d0 = 0.45 + i * 0.1, z0 = m + d0, z1 = z0 + 0.05;
    const r = (d) => (d < 0.12 ? 0.073 : 0.067 + ((d - 0.12) / 1.56) * 0.004) + 0.0018;
    K.add('ring', zTube(z0, z1, r(d0), r(d0 + 0.05), 20, 0, 0, true), { uv: true });
  }
}

// ---------------------------------------------------------------- the rig

export function buildFlak88() {
  const rig = newRig('green');
  const mats = flakMats('grey');
  rig.mats = mats;
  const root = rig.root;
  const C = F88.cross, rnd = mulberry32(88);

  // ---- the emplacement (its own group: rig.emplacement, hide it to show the gun alone) and the cross
  const emp = new THREE.Group();
  emp.name = 'emplacement';
  root.add(emp);
  rig.emplacement = emp;
  const P = new Parts(mats);
  const pit = plankPit(P, { R: F88.pit.R, H: F88.pit.H, sides: F88.pit.sides, open: [F88.pit.entrance], holes: F88.pit.niches.map((i) => ({ i, w: 1.0, y0: 0.4, h: 0.62 })), bank: 2.9, crown: 0.9, rnd });
  floorDisc(P, F88.pit.R + 0.15, 0.005);
  clockNumbers(P, pit, 0.17);
  const niches = [];
  for (const i of F88.pit.niches) {
    const pn = pit.panels[i];
    niche(P, pn, rnd);
    const o = node(root, 'niche' + i, pn.c.x, 0.71, pn.c.z, 0, -pn.a + Math.PI, 0);
    niches.push(o);
  }
  decking(P);
  // the data cable from the junction box out through the entrance into its trench
  const cab = new THREE.CatmullRomCurve3([V(0, C.top + 0.02, C.rear - 0.45), V(0.05, 0.03, C.rear + 0.1), V(0.35, 0.03, 3.2), V(0.5, 0.03, 4.6), V(0.55, 0.02, 6.0), V(0.6, -0.15, 7.2)]);
  add(P, 'black', new THREE.TubeGeometry(cab, 40, 0.022, 6, false), 0xffffff, 0);
  // wicker baskets of three rounds stacked by the entrance, a couple opened
  for (let i = 0; i < 6; i++) {
    const x = 1.6 + (i % 3) * 0.42, y = 0.07 + Math.floor(i / 3) * 0.145, z = 3.05 + (rnd() - 0.5) * 0.05;
    add(P, 'wood', rbox(0.37, 0.14, 0.98, 0.04, x, y, z, 0, (rnd() - 0.5) * 0.06, 0), 0x9a7a4c, 1);
    add(P, 'metal', box(0.38, 0.05, 0.12, x, y + 0.02, z - 0.46), 0x7a7a6a);
  }
  build(P, emp, 0, 0.3);
  const X = new Parts(mats);
  cross(X);
  pedestal(X);
  build(X, root, 0, 0.3);

  // ---- top carriage
  const tur = pivotAt(rig, root, 'turret', 0, F88.pivotY, 0);
  const T = new Parts(mats);
  const tc = topCarriage(T, rig);
  build(T, tur, F88.pivotY, 0.15);
  // the dial faces: two receivers on the right wall (each a plate with a coarse and a fine dial), the fuze
  // receiver on the setter's angled housing
  const D = new Parts(mats);
  for (const z of tc.recv) D.add('dial', cellQuad(0.27, 0.186, DIAL_CELLS.plate).applyMatrix4(xf(0.522, tc.ry, z, 0, Math.PI / 2, 0)), { uv: true });
  D.add('dial', cellQuad(0.27, 0.186, DIAL_CELLS.plate).applyMatrix4(tc.dialM.clone().multiply(xf(0, 0, -0.062, 0, Math.PI, 0))), { uv: true });
  for (const m of build(D, tur, F88.pivotY, 0)) noShadow(m);
  // handwheels: traverse (front) and elevation (rear) on the right, the setter's command wheel at its front
  const hwAz = node(tur, 'wheelAz', 0.65, tc.hy, tc.W.az), hwEl = node(tur, 'wheelEl', 0.65, tc.hy + 0.02, tc.W.el);
  const hwFz = node(tur, 'wheelFz', -0.57, tc.sy - 0.22, -0.61);
  const wheelList = [[hwAz, Math.PI / 2, 0.15], [hwEl, Math.PI / 2, 0.15], [hwFz, Math.PI, 0.11]].map(([node, ry, R]) => ({ node, R, M: xf(0, 0, 0, 0, ry, 0) }));

  // ---- cradle (elevation), barrel (recoil), wedge (breech)
  const el = pivotAt(rig, tur, 'elevation', 0, F88.trunnion.y, F88.trunnion.z);
  const E = new Parts(mats);
  cradle(E);
  build(E, el, F88.pivotY + F88.trunnion.y, 0);
  const rc = pivotAt(rig, el, 'recoil', 0, 0, 0);
  const B = new Parts(mats), K = new Parts({ ...mats, ring: mats.white });
  barrel(B, K);
  build(B, rc, F88.pivotY + F88.trunnion.y, 0);
  const [rings] = build(K, rc, F88.pivotY + F88.trunnion.y, 0);
  noShadow(rings);
  const ringVerts = rings.geometry.attributes.position.count / MAX_RINGS;
  const wedge = pivotAt(rig, rc, 'breech', 0, 0, 0.4);
  const Wd = new Parts(mats);
  add(Wd, 'metal', box(0.3, 0.13, 0.22, 0, 0, 0), 0xb0b0b0);
  add(Wd, 'metal', new THREE.CircleGeometry(0.048, 14).applyMatrix4(xf(-0.0, 0, 0.111)), 0x2a2a2a);
  add(Wd, 'metal', box(0.03, 0.05, 0.05, 0.16, 0.0, 0.08), 0x909090);
  build(Wd, wedge, F88.pivotY + F88.trunnion.y, 0);

  // ---- sight: the ZF 20E telescope on its bracket, following the elevation
  const sight = node(tur, 'sight', 0.45, tc.ry + 0.22, -0.48);
  const S = new Parts(mats);
  add(S, 'paint', zTube(-0.2, 0.16, 0.035, 0.035, 12), 0xc8c8c8);
  add(S, 'paint', zTube(0.16, 0.22, 0.03, 0.025, 10), 0x303030);
  add(S, 'paint', zTube(-0.26, -0.2, 0.045, 0.045, 12), 0xc8c8c8);
  build(S, sight, F88.pivotY + tc.ry, 0);
  sight.updateMatrix = function () {
    this.rotation.x = el.rotation.x;
    THREE.Object3D.prototype.updateMatrix.call(this);
  };

  // ---- the hand wheels follow the gun (high gears: 3.6 deg traverse, 2 deg elevation per turn)
  const ord = { order: null };
  hwAz.updateMatrix = function () { this.rotation.x = (tur.rotation.y / (3.6 * DEG)) * Math.PI * 2; THREE.Object3D.prototype.updateMatrix.call(this); };
  hwEl.updateMatrix = function () { this.rotation.x = -(el.rotation.x / (2 * DEG)) * Math.PI * 2; THREE.Object3D.prototype.updateMatrix.call(this); };
  // the fuze setter's command wheel follows the fuze receiver (one turn per 10 fuze units, 0.9 s)
  const fuzeNow = () => (ord.order ? ord.order.fuze : 12);
  hwFz.updateMatrix = function () { this.rotation.z = (fuzeNow() / 0.9) * Math.PI * 2; THREE.Object3D.prototype.updateMatrix.call(this); };

  // ---- dial pointers: per receiver a coarse and a fine dial, each the director's thin pointer and the gun's
  // broad follow pointer; the fuze receiver the same. The plate cell puts the coarse dial at its left
  // (toward the gun's front for the right-hand boxes) and the fine dial at its right.
  const slots = [], fn = [];
  const plateDial = (parent, M, kind, which) => {
    // dial centres on the 0.27 x 0.15 plate: coarse at u 0.33, fine at u 0.72 of the plate width
    // (the plate cell: the coarse dial centred at u 0.31, the fine one at u 0.71, both at mid height)
    const cu = which === 'coarse' ? -0.051 : 0.057, len = which === 'coarse' ? 0.045 : 0.056;
    const c = new THREE.Vector3(cu, 0.0, 0.004).applyMatrix4(M), n = new THREE.Vector3(0, 0, 1).transformDirection(M);
    slots.push({ parent, pos: c.toArray(), face: n.toArray(), len, width: 0.005, color: 0xf2f0e4 }); fn.push([kind, which, 'order']);
    slots.push({ parent, pos: c.clone().addScaledVector(n, 0.002).toArray(), face: n.toArray(), len: len * 0.8, width: 0.014, color: 0x9a9c94 }); fn.push([kind, which, 'gun']);
  };
  tc.recv.forEach((z, i) => {
    const M = xf(0.522, tc.ry, z, 0, Math.PI / 2, 0);
    plateDial(tur, M, i === 0 ? 'az' : 'el', 'coarse');
    plateDial(tur, M, i === 0 ? 'az' : 'el', 'fine');
  });
  const fM = tc.dialM.clone().multiply(xf(0, 0, -0.062, 0, Math.PI, 0));
  plateDial(tur, fM, 'fz', 'coarse');
  plateDial(tur, fM, 'fz', 'fine');
  // per kind: the value in degrees (or fuze seconds) and the turns per unit of the coarse and fine dials
  const PER = { az: [360, 36], el: [100, 10], fz: [30, 3] };
  wheelSet(root, wheelList, mats.metal);
  pointerSet(root, slots, (out) => {
    const o = ord.order, gunAz = -tur.rotation.y / DEG, gunEl = el.rotation.x / DEG;
    for (let i = 0; i < fn.length; i++) {
      const [kind, which, who] = fn[i];
      let v;
      if (kind === 'fz') v = o ? o.fuze : 12;
      else if (who === 'order' && o) v = kind === 'az' ? -o.az / DEG : o.el / DEG;
      else v = kind === 'az' ? gunAz : gunEl;
      if (kind === 'fz' && who === 'gun') v = fuzeNow();
      out[i] = (v / PER[kind][which === 'coarse' ? 0 : 1]) * Math.PI * 2;
    }
  });

  // ---- anchors
  rig.anchors.eye = node(root, 'eye', 0, 1.9, 0.3);
  rig.anchors.muzzles.push(node(rc, 'muzzle0', 0, 0, MUZ));
  rig.anchors.breech = node(rc, 'breechMouth', 0, 0, F88.bf + 0.05);
  rig.anchors.sight = node(sight, 'sightEye', 0, 0, 0.22);
  rig.anchors.fuzeCups = tc.cups.map((p, i) => node(tur, 'cup' + i, p.x, p.y, p.z));
  rig.anchors.rack = node(tur, 'rack', tc.rack.x, tc.rack.y, tc.rack.z); // the top slot's round middle, -Z its nose
  rig.anchors.drillNodes = [rig.anchors.rack];
  rig.anchors.niches = niches;
  rig.anchors.cable = node(root, 'cable', 0.6, 0, 7.2); // where the data cable leaves the pit (to the battery's junction box)
  const deckT = F88.deck - F88.pivotY;
  rig.anchors.crew = {
    k1: crewSpot(tur, 'k1', 1.02, deckT, tc.W.el + 0.05, 90, { label: 'K1 elevation layer', pose: 'crank', hands: V(0.7, tc.hy + 0.02, tc.W.el) }),
    k2: crewSpot(tur, 'k2', 1.02, deckT, tc.W.az - 0.05, 90, { label: 'K2 traverse layer', pose: 'crank', hands: V(0.7, tc.hy, tc.W.az) }),
    k6: crewSpot(tur, 'k6', -0.57, 0.1, -0.98, 180, { label: 'K6 fuze setter', pose: 'sit', seated: true }),
    k3: crewSpot(tur, 'k3', -0.78, deckT, 1.6, -56, { label: 'K3 loader', pose: 'load' }),
    k4: crewSpot(tur, 'k4', -1.12, deckT, 0.15, -42, { label: 'K4 ammunition (setter to loader)', pose: 'carry' }),
    k5: crewSpot(tur, 'k5', -1.28, deckT, -0.62, -90, { label: 'K5 ammunition (rounds into the cups)', pose: 'carry' }),
    gf: crewSpot(root, 'gf', -2.45, F88.deck, 2.25, -47, { label: 'Geschuetzfuehrer (gun commander)', pose: 'stand' }),
    k7: crewSpot(root, 'k7', niches[1].position.x * 0.8, F88.deck, niches[1].position.z * 0.8, 0, { label: 'K7 ammunition carrier', pose: 'carry' }),
    k8: crewSpot(root, 'k8', niches[3].position.x * 0.8, F88.deck, niches[3].position.z * 0.8, 0, { label: 'K8 ammunition carrier', pose: 'carry' }),
  };
  // K7 and K8 face their niches
  for (const k of ['k7', 'k8']) { const o = rig.anchors.crew[k]; o.rotation.y = Math.atan2(o.position.x, o.position.z); }

  // ---- hit boxes: the gun and its cross (the pit walls are not the gun)
  hb(rig, -0.9, 0, -1.4, 0.9, 2.3, 1.6);
  hb(rig, -C.side, 0, -0.3, C.side, 0.5, 0.3);
  hb(rig, -0.3, 0, -C.front, 0.3, 0.5, C.rear);

  // ---- state
  let paint = 'grey';
  paintCarrier(root);
  rig.setPaint = (s) => { if (s !== paint && (s === 'grey' || s === 'yellow')) { paint = s; setPaint(root, s); } };
  rig.paint = () => paint;
  rig.setKills = (n) => { rings.geometry.setDrawRange(0, Math.max(0, Math.min(MAX_RINGS, n | 0)) * ringVerts); };
  rig.setKills(0);
  rig.recoilLength = (elev) => F88.recoil[0] + (F88.recoil[1] - F88.recoil[0]) * Math.min(1, Math.max(0, elev / (85 * DEG)));
  rig.setRecoil = (m) => { rc.position.z = Math.max(0, m); };
  rig.setBreech = (k) => { wedge.position.x = 0.14 * Math.min(1, Math.max(0, k)); };
  rig.setOrder = (o) => { ord.order = o ? { az: o.az ?? 0, el: o.el ?? 0, fuze: o.fuze ?? 12 } : null; };
  rig.setLetter = (L) => letterSwap(rig, L);
  return rig;
}

// The gun letter decals (markings44.js 'ww2' set, types 'A' to 'F', the MARKINGS entry carries 'A'):
// swap the UVs of this rig's own copies to another letter's atlas cell.
export const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];
export function letterSwap(rig, L) {
  const want = typeof L === 'number' ? LETTERS[L] : String(L).toUpperCase();
  if (!LETTERS.includes(want)) return;
  rig.root.traverse((o) => {
    if (!o.isMesh || !o.name.startsWith('marking-') || !LETTERS.includes(o.name.slice(8)) && !o.userData.letter) return;
    if (!o.userData.letter) { o.userData.letter = o.name.slice(8); o.userData.uv0 = o.geometry.attributes.uv.array.slice(); o.geometry = o.geometry.clone(); }
    const du = (LETTERS.indexOf(want) - LETTERS.indexOf(o.userData.letter)) * LETTER_STEP;
    const uv = o.geometry.attributes.uv, a = o.userData.uv0;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, a[i * 2] + du, a[i * 2 + 1]);
    uv.needsUpdate = true;
  });
}
// the letters' atlas cells are LETTER_PX apart in the 1024 px wide markings atlas (markings44.js)
export const LETTER_PX = 130;
const LETTER_STEP = LETTER_PX / 1024;
