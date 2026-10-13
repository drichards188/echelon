import * as THREE from 'three';
import { V, DEG, box, rbox, yTube, zTube, xTube, rod, lathe, xf, loft, Parts } from '../../../models/kit.js';
import { newRig, node, pivotAt, hb } from '../../../models/rig.js';
import { mulberry32 } from '../../../noise.js';
import { flakMats, setPaint, paintCarrier, add, build, tubeAB, wheelSet, panSeat, ringBank, floorDisc, sandbagWall, crewSpot } from './kit44.js';

// 3,7 cm Flak 43 (Flak 43/1) on its triangular lower carriage in a shallow pit with an earth parapet
// (refs/ww2/flak43, its "decision recorded"; photos flak43_ldv_right_01, the 1944 manual's right side in
// action; flak43_moebelwagen_gun_03, the same gun from the rear left with its loading table; flak43_museum_delft_04,
// the gun on its triangle from the right rear). Modelled: the Lafettendreieck (two front arms and the rear
// arm, a levelling jack with a retractable handle at each end, the spirit level on the rear arm); the
// ball-race turntable and its round base plate; the box pedestal (Sockel); the big cradle drum
// (Wiegentrommel) on the RIGHT with the transverse slots the cases and empty clips leave by, the elevation
// scale on its cover; the weapon housing on the cradle, the L/57 barrel with its slotted muzzle brake and
// flash hider; on the LEFT the loading table (Ladetisch) on the trunnion axis, elevating with the gun, its
// guide rails and the swung-out extension, two 8-round clips lying on it, rounds parallel to the barrel and
// noses forward; the fold-down ammunition tray (Patronenablage) low at the front left with two more clips;
// the three-piece shield sloping back 30 deg (the centre piece with the barrel slot and the sight flap in
// its right half, the side panels folded back); on the right the laying gear housing with the vertical
// elevating and the horizontal traversing handwheels, the layer's seat with its back rest and the sight
// setter's swing-out seat beside it, the foot-pedal arm at the front of the pedestal, the clip catcher
// behind the seats; the Schwebedornvisier 43 on its swing arm over the handwheels, linked to the cradle,
// with its square backsight frame, the pendulum and the floating pin. No case catcher basket (the manual
// lists it for self-propelled mounts). The pit (section 11, an estimate: no source gives one): a round
// earth parapet 6.4 m across and 0.8 m high below the shield top, a sandbag-walled ammunition niche on the
// loader's side with clip boxes, the entrance at the rear.
//
// Dimensions (section 2): trunnion 0.76 m above the ground (CEOM), weapon 3.3 m with the muzzle device
// (barrel 2.106 m), length in action 3.49 m, width 1.78 m, shield 1.28 m tall, recoil 0.127 m; the triangle
// (not published) with the front feet 2.1 m apart 0.7 m ahead of the pivot and the rear foot 1.55 m behind it
// (scaled from the manual's figure against the shield).
//
// Rig (front -Z, right +X, ground y = 0):
//   pivots.turret     the upper carriage on the turntable, (0, 0.17, 0). rotation.y = traverse, + to the left,
//                     unlimited.
//   pivots.elevation  the trunnion (the drum's axis), turret space (0, 0.59, 0), 0.76 m above the ground.
//                     rotation.x = elevation, + raises the muzzle; -10 to +90 deg (-0.175 to 1.571). The loading
//                     table, the clips and the sight's link ride on it (the sight head stays level).
//   pivots.recoil     the weapon housing and barrel in the cradle: position.z = recoil (m), 0 to 0.127;
//                     rig.setRecoil(m).
//   rig.setRounds(n)  rounds on the loading table, 0 to 16: the clip against the feed (the right one) empties
//                     first, the clips walk right one round per shot and an empty clip leaves the table.
//   anchors.muzzles   [the muzzle], recoil group, -Z along the bore.
//   anchors.sight     the Schwebedornvisier's eyepiece (turret space, kept level while its arm follows the
//                     gun), -Z along the line of sight.
//   anchors.feed      where a new clip goes onto the table (the table's left end), elevation group.
//   anchors.eye       camera focus (0, 1.0, 0.3) on the root.
//   anchors.crew      on the turret: k1 layer (seated, both handwheels and the foot trigger), k2 sight setter
//                     (seated on the swing-out seat), k3 loader (standing at the table's left); on the root:
//                     k4 and k5 ammunition numbers (niche to the tray), gf gun commander behind the gun.
//   setPaint('yellow' | 'grey'): Dunkelgelb by default (the light and medium guns, refs/ww2/markings 1.2).

export const F43 = { turnY: 0.17, trunY: 0.59, bore: 0, pitR: 3.2, muzzle: -2.35, pitch: 0.049 };
const ROUND = { caseL: 0.263, caseR: 0.0245, projL: 0.105, projR: 0.0185 };

// one 37 mm round lying along -Z from its case head at (x, y, z)
function round37(add2, x, y, z) {
  const c = ROUND;
  add2('brass', zTube(z, z - c.caseL * 0.88, c.caseR, c.caseR * 0.96, 10, x, y));
  add2('brass', zTube(z - c.caseL * 0.88, z - c.caseL, c.caseR * 0.96, c.projR * 1.05, 10, x, y));
  add2('brass', zTube(z + 0.004, z - 0.004, c.caseR * 1.12, c.caseR * 1.12, 10, x, y));
  const z1 = z - c.caseL;
  add2('shell', zTube(z1, z1 - c.projL * 0.45, c.projR, c.projR, 10, x, y));
  add2('shell', zTube(z1 - c.projL * 0.45, z1 - c.projL, c.projR, c.projR * 0.3, 10, x, y));
}

function triangle(P) {
  const paint = (g, t = 0xffffff) => add(P, 'paint', g, t);
  const feet = [[-1.05, -0.7], [1.05, -0.7], [0, 1.55]]; // the rear arm long and low (flak43_ldv_right_01)
  // the three arms, pressed box sections from the centre plate to the jacks
  paint(yTube(0.04, 0.17, 0.55, 0.55, 24));
  for (const [x, z] of feet) {
    const L = Math.hypot(x, z), a = Math.atan2(x, z);
    const g = loft([[V(-0.16, 0.04, 0.3), V(0.16, 0.04, 0.3), V(0.16, 0.18, 0.3), V(-0.16, 0.18, 0.3)], [V(-0.1, 0.07, L), V(0.1, 0.07, L), V(0.1, 0.17, L), V(-0.1, 0.17, L)]], { crease: 0.5 });
    paint(g.applyMatrix4(xf(0, 0, 0, 0, a, 0)));
    // levelling jack with its retractable handle, the round foot
    paint(yTube(0.0, 0.025, 0.11, 0.11, 14, x, z), 0xbdbdbd);
    add(P, 'metal', yTube(0.025, 0.1, 0.022, 0.022, 8, x, z));
    paint(yTube(0.09, 0.3, 0.045, 0.04, 10, x, z));
    add(P, 'metal', box(0.18, 0.015, 0.02, x + 0.07, 0.31, z));
    add(P, 'black', yTube(0.31, 0.37, 0.01, 0.01, 6, x + 0.15, z));
  }
  // lifting trunnions and hooks on the front arms, the spirit level on the rear arm, the spares box on the left
  for (const s of [-1, 1]) paint(xTube(s * 0.62, s * 0.72, 0.035, 0.035, 8, 0.12, -0.38), 0xd0d0d0);
  add(P, 'glass', yTube(0.16, 0.18, 0.04, 0.04, 12, 0, 1.0));
  paint(yTube(0.15, 0.17, 0.05, 0.05, 12, 0, 1.0), 0xd8d8d8);
  paint(rbox(0.36, 0.14, 0.22, 0.02, -0.55, 0.2, 0.1, 0, 0.6, 0), 0xc8c8c8);
}

function upper(T, rnd) {
  const paint = (g, t = 0xffffff) => add(T, 'paint', g, t);
  const ty = F43.trunY;
  // turntable plate and the box pedestal under the trunnion bearing on the right (the weapon swings down
  // beside it at high elevation)
  paint(yTube(-0.01, 0.06, 0.46, 0.46, 24));
  paint(rbox(0.34, 0.44, 0.52, 0.03, 0.27, 0.28, 0.02));
  paint(rbox(0.16, 0.2, 0.44, 0.03, 0.27, 0.53, 0.0), 0xd8d8d8); // the bearing bracket under the drum
  // equilibrator housing at the front of the pedestal and the foot-pedal swing arm
  paint(rbox(0.22, 0.3, 0.26, 0.04, 0.0, 0.32, -0.36));
  paint(rod(V(0.12, 0.18, -0.3), V(0.38, 0.1, -0.05), 0.02, 6), 0xd0d0d0);
  add(T, 'black', box(0.12, 0.02, 0.08, 0.42, 0.11, 0.02)); // firing pedal
  add(T, 'black', box(0.1, 0.02, 0.06, 0.3, 0.12, 0.08)); // foot rest
  // the laying gear housing on the right in front of the drum: vertical (elevation) and horizontal
  // (traverse) handwheels for one man
  paint(rbox(0.2, 0.26, 0.24, 0.03, 0.42, 0.42, -0.28));
  paint(yTube(0.55, 0.62, 0.03, 0.03, 8, 0.48, -0.08), 0xd0d0d0);
  // the layer's seat with its back rest, the sight setter's swing-out seat beside it on its arm
  panSeat(T, 'paint', 0.5, -0.17, 0.32, 0.55, 0.14, true, Math.PI);
  paint(rod(V(0.27, 0.2, 0.15), V(0.5, 0.2, 0.32), 0.02, 6), 0xd0d0d0);
  panSeat(T, 'paint', 0.98, -0.17, 0.3, 0.5, 0.13, false);
  paint(rod(V(0.5, 0.15, 0.32), V(0.98, 0.15, 0.3), 0.02, 6), 0xd0d0d0);
  // the clip catcher (Rahmenfaenger) behind the seats: a curved chute
  paint(rbox(0.36, 0.06, 0.4, 0.02, 0.5, 0.18, 0.62, -0.5, 0, 0), 0xc8c8c8);
  // the fold-down ammunition tray (Patronenablage) low at the front left on the base plate, two clips on it
  paint(rbox(0.5, 0.03, 0.42, 0.01, -0.5, 0.14, -0.26), 0xc8c8c8);
  for (const s of [-1, 1]) paint(box(0.5, 0.06, 0.02, -0.5, 0.17, -0.26 + s * 0.21), 0xc8c8c8);
  // the travel lock on the left pedestal wall
  paint(rbox(0.08, 0.2, 0.12, 0.02, -0.25, 0.35, -0.12), 0xd0d0d0);
  // the shield: centre piece sloping back 30 deg with the barrel slot, the sight flap in its right half,
  // the side panels folded back; camouflage loops on the face; the setter's foot holder at the bottom
  // 1.28 m tall (vertically: 1.48 m up the slope), its top 1.62 m up, the published height in action
  const S = { z: -0.84, y0: 0.34 - F43.turnY, h: 1.48, slope: 30 * DEG };
  const shM = xf(0, S.y0, S.z, S.slope, 0, 0); // panel local: x across, y up the slope (leaning back), -z out the front
  const plate = (x0, x1, h, t = 0xffffff, M = shM) => paint(box(x1 - x0, h, 0.009, (x0 + x1) / 2, h / 2, 0).applyMatrix4(M), t);
  plate(-0.5, -0.08, S.h); plate(0.08, 0.5, S.h); plate(-0.08, 0.08, 0.32); plate(-0.08, 0.08, 0.16, 0xffffff, shM.clone().multiply(xf(0, S.h - 0.16, 0)));
  for (const s of [-1, 1]) {
    // a side panel hinged on the centre piece's edge, folded back about 40 deg
    const hm = shM.clone().multiply(xf(s * 0.5, 0, 0, 0, -s * 0.7, 0));
    paint(box(0.5, S.h * 0.92, 0.008, s * 0.25, S.h * 0.46, 0).applyMatrix4(hm));
    for (const y of [0.25, 0.9]) add(T, 'metal', yTube(y - 0.05, y + 0.05, 0.012, 0.012, 6, 0, 0).applyMatrix4(shM.clone().multiply(xf(s * 0.5, 0, 0))));
    // camouflage loops on the face
    for (const y of [0.4, 0.95]) add(T, 'metal', new THREE.TorusGeometry(0.025, 0.004, 4, 8).applyMatrix4(shM.clone().multiply(xf(s * 0.3, y, -0.012))));
  }
  add(T, 'paint', box(0.16, 0.12, 0.012, 0.28, 0.88, -0.004).applyMatrix4(shM), 0xd8d8d8); // the sight flap, closed in its upper half
  add(T, 'black', box(0.12, 0.08, 0.004, 0.28, 0.76, -0.006).applyMatrix4(shM)); // sight window
  paint(box(0.12, 0.02, 0.1, 0.42, 0.02, -0.06).applyMatrix4(shM), 0xd0d0d0); // foot holder
  // shield brackets back to the pedestal
  for (const s of [-1, 1]) paint(rod(V(s * 0.35, 0.05, -0.5), V(s * 0.2, 0.25, -0.2), 0.02, 6), 0xd0d0d0);
  return { shM };
}

function cradle(E) {
  const paint = (g, t = 0xffffff) => add(E, 'paint', g, t);
  // the drum on the right: round housing on the trunnion, cover with the elevation scale, the slots
  paint(xTube(0.2, 0.36, 0.37, 0.37, 32, 0, 0));
  paint(xTube(0.36, 0.38, 0.33, 0.33, 30, 0, 0), 0xdcdcdc);
  paint(xTube(0.38, 0.41, 0.09, 0.08, 16, 0, 0), 0xe4e4e4);
  add(E, 'black', box(0.02, 0.05, 0.36, 0.385, 0.12, 0.0)); // the long slot (cases out)
  add(E, 'black', box(0.02, 0.05, 0.18, 0.385, -0.08, 0.05)); // the short slot (empty clips)
  add(E, 'white', box(0.004, 0.012, 0.3, 0.386, 0.25, -0.02, 0, 0, 0), 0xd0d0c8); // elevation scale arc
  paint(box(0.06, 0.04, 0.24, 0.38, 0.3, -0.06, 0.4, 0, 0), 0xd8d8d8); // the deflector on the cover
  // the cradle (recuperator housing) under the weapon, on the trunnion axis, toothed elevating arc below
  paint(rbox(0.22, 0.14, 1.1, 0.02, 0.06, -0.05, -0.05));
  paint(box(0.04, 0.24, 0.5, 0.18, -0.2, 0.05), 0xd8d8d8);
  for (let i = 0; i < 16; i++) { const a = (-30 + i * 6) * DEG; add(E, 'metal', box(0.03, 0.025, 0.02, 0.17, -0.33 * Math.cos(a), 0.33 * Math.sin(a) + 0.05, a, 0, 0)); }
  // the barrel guard plate (Rohrblende) on the housing, covering the shield slot at low elevation
  paint(box(0.18, 0.3, 0.012, 0.02, 0.04, -0.6), 0xd0d0d0);
  // the loading table on the left, on the trunnion axis: deck, two guide rails, the stops, the swung-out
  // extension (Ladetischverlaengerung), the release lever at its rear
  const T0 = { x0: -0.18, x1: -0.98, y: 0.035, z0: -0.25, z1: 0.17 };
  paint(box(T0.x0 - T0.x1, 0.025, T0.z1 - T0.z0, (T0.x0 + T0.x1) / 2, T0.y - 0.0125, (T0.z0 + T0.z1) / 2), 0xd8d8d8);
  for (const z of [-0.12, 0.05]) paint(box(T0.x0 - T0.x1 + 0.3, 0.02, 0.025, (T0.x0 + T0.x1) / 2 - 0.15, T0.y + 0.01, z), 0xc8c8c8);
  paint(box(T0.x0 - T0.x1, 0.06, 0.02, (T0.x0 + T0.x1) / 2, T0.y + 0.03, T0.z1 + 0.01), 0xd0d0d0); // the rear ridge stop
  paint(box(0.3, 0.02, T0.z1 - T0.z0, T0.x1 - 0.15, T0.y - 0.012, (T0.z0 + T0.z1) / 2), 0xc8c8c8); // extension
  paint(rod(V(T0.x1 - 0.3, T0.y - 0.01, T0.z0), V(T0.x1 - 0.3, T0.y - 0.01, T0.z1), 0.012, 5), 0xd0d0d0);
  paint(rod(V(-0.6, T0.y, T0.z1 + 0.02), V(-0.62, T0.y + 0.12, T0.z1 + 0.12), 0.01, 5), 0xd0d0d0);
  // the sight's control rod from the cradle to the sight arm
  return { T0 };
}

function weapon(R) {
  const paint = (g, t = 0xffffff) => add(R, 'paint', g, t);
  // weapon housing (Waffengehaeuse) with the breech and the cover, the cocking crank on it
  // (most of it ahead of the trunnion: at +90 deg its rear end must stay clear of the base)
  paint(rbox(0.17, 0.2, 1.06, 0.03, 0.0, 0.1, -0.03));
  paint(rbox(0.13, 0.05, 0.86, 0.02, 0.0, 0.215, 0.0), 0xd8d8d8);
  add(R, 'metal', xTube(0.085, 0.13, 0.04, 0.04, 10, 0.17, 0.3));
  add(R, 'metal', box(0.02, 0.1, 0.02, 0.13, 0.21, 0.3));
  // barrel (dark, blued) and the muzzle brake with its six long ports, the flash hider cone
  add(R, 'metal', zTube(-0.56, -1.95, 0.034, 0.028, 16, 0.0, 0.08), 0x6a6e72);
  add(R, 'metal', zTube(-0.56, -0.68, 0.05, 0.05, 16, 0.0, 0.08), 0x7a7e82);
  const mz = F43.muzzle;
  add(R, 'metal', zTube(-1.95, mz + 0.18, 0.045, 0.045, 18, 0, 0.08), 0x5a5e62);
  for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; add(R, 'black', box(0.012, 0.012, 0.12, Math.cos(a) * 0.046, 0.08 + Math.sin(a) * 0.046, -2.1, 0, 0, a)); }
  add(R, 'metal', zTube(mz + 0.18, mz, 0.045, 0.06, 18, 0, 0.08), 0x5a5e62);
  add(R, 'black', new THREE.CircleGeometry(0.02, 12).applyMatrix4(xf(0, 0.08, mz - 0.001, 0, Math.PI, 0)));
}

export function buildFlak43() {
  const rig = newRig('green');
  const mats = flakMats('yellow');
  rig.mats = mats;
  const root = rig.root, rnd = mulberry32(43);

  // ---- the pit (rig.emplacement)
  const emp = new THREE.Group();
  emp.name = 'emplacement';
  root.add(emp);
  rig.emplacement = emp;
  const P = new Parts(mats);
  ringBank(P, { R: F43.pitR, H: 0.8, bank: 1.8, crown: 0.5, seg: 40, gaps: [[Math.PI, 0.3], [-Math.PI / 2, 0.22]], rnd, inner: 0.55 });
  floorDisc(P, F43.pitR + 0.1, 0.004);
  // the ammunition niche on the loader's side (left), sandbag-walled with a plank roof, clip boxes in it
  const nx = -F43.pitR - 0.15;
  sandbagWall(P, -0.55, 0.55, 0, 4, { ry: Math.PI / 2, ox: nx - 0.7, oz: 0, rnd });
  for (const s of [-1, 1]) sandbagWall(P, -0.35, 0.35, 0, 4, { ry: 0, ox: nx - 0.35, oz: s * 0.62, rnd });
  for (let i = 0; i < 7; i++) add(P, 'wood', box(1.05, 0.04, 0.2, nx - 0.35, 0.68, -0.62 + i * 0.2 + 0.02), 0xc8bca8, 1);
  for (let i = 0; i < 5; i++) add(P, 'wood', rbox(0.5, 0.18, 0.28, 0.02, nx - 0.4 + (i % 2) * 0.05, 0.09 + Math.floor(i / 2) * 0.19, -0.3 + (i % 3) * 0.3), 0x8f9a6a, 1);
  build(P, emp, 0, 0.3);

  // ---- the triangle (fixed)
  const X = new Parts(mats);
  triangle(X);
  build(X, root, 0, 0.3);

  // ---- the upper carriage
  const tur = pivotAt(rig, root, 'turret', 0, F43.turnY, 0);
  const T = new Parts(mats);
  const up = upper(T, rnd);
  build(T, tur, F43.turnY, 0.1);
  const hwE = node(tur, 'wheelEl', 0.54, 0.44, -0.3), hwT = node(tur, 'wheelTr', 0.42, 0.63, -0.08);
  wheelSet(root, [[hwE, xf(0, 0, 0, 0, Math.PI / 2, 0)], [hwT, xf(0, 0, 0, Math.PI / 2, 0, 0)]].map(([node, M]) => ({ node, M, R: 0.12 })), mats.metal);

  // ---- the cradle, the loading table and the clips
  const el = pivotAt(rig, tur, 'elevation', 0, F43.trunY, 0);
  const E = new Parts(mats);
  const cr = cradle(E);
  build(E, el, F43.turnY + F43.trunY, 0);
  // the two clips: each its plate and eight rounds, the one against the feed (right) first
  const clips = [];
  for (let c = 0; c < 2; c++) {
    const g = new THREE.Group();
    g.name = 'clip' + c;
    el.add(g);
    const C = new Parts(mats), x0 = -0.215 - c * 8 * F43.pitch;
    const a2 = (k, geo) => add(C, k, geo, 0xffffff, 0);
    a2('metal', box(8 * F43.pitch - 0.004, 0.006, 0.3, x0 - 3.5 * F43.pitch, cr.T0.y + 0.003, -0.05).applyMatrix4(xf(0, 0, 0)));
    // rounds from the left end of the clip first (drawRange keeps the left ones)
    for (let i = 7; i >= 0; i--) round37(a2, x0 - i * F43.pitch, cr.T0.y + 0.03, 0.13);
    const [m] = build(C, g, F43.turnY + F43.trunY, 0);
    clips.push({ g, m, plate: 0, n: 8 });
  }
  // vertex counts per round (each clip mesh: the plate, then 8 rounds)
  const vPlate = 36, vRound = (clips[0].m.geometry.attributes.position.count - vPlate) / 8;
  // the weapon (recoils)
  const rc = pivotAt(rig, el, 'recoil', 0, 0, 0);
  const R = new Parts(mats);
  weapon(R);
  build(R, rc, F43.turnY + F43.trunY, 0);

  // ---- the sight: its swing arm follows the cradle (a parallelogram), the sight head stays level
  const arm = node(tur, 'sightArm', 0.36, F43.trunY + 0.05, -0.05);
  const Sa = new Parts(mats);
  add(Sa, 'paint', box(0.03, 0.03, 0.4, 0, 0, -0.1), 0xd0d0d0);
  build(Sa, arm, F43.turnY + F43.trunY, 0);
  const head = node(arm, 'sightHead', 0, 0.06, -0.28);
  const Sh = new Parts(mats);
  // the Schwebedornvisier 43: carrier with the eyecup, the small square backsight frame, the pendulum
  // with the pin holder and a floating pin, the speed scales, the flight direction knob
  add(Sh, 'paint', rbox(0.08, 0.1, 0.16, 0.015, 0, 0.05, 0.06), 0xd8d8d8);
  add(Sh, 'black', zTube(0.14, 0.18, 0.022, 0.026, 10, 0, 0.08));
  add(Sh, 'metal', box(0.07, 0.004, 0.004, 0, 0.16, 0.0), 0x909090);
  add(Sh, 'metal', box(0.07, 0.004, 0.004, 0, 0.09, 0.0), 0x909090);
  add(Sh, 'metal', box(0.004, 0.07, 0.004, 0.035, 0.125, 0.0), 0x909090);
  add(Sh, 'metal', box(0.004, 0.07, 0.004, -0.035, 0.125, 0.0), 0x909090);
  add(Sh, 'paint', box(0.012, 0.18, 0.012, 0, 0.03, -0.12), 0xd0d0d0); // pendulum
  add(Sh, 'metal', box(0.03, 0.012, 0.012, 0, 0.12, -0.12), 0xa0a0a0); // pin holder on its dovetail
  add(Sh, 'white', rod(V(0, 0.125, -0.12), V(0.05, 0.13, -0.3), 0.003, 4), 0xd8c24a); // the floating pin (yellow: 90 to 140 m/s)
  add(Sh, 'black', yTube(0.1, 0.13, 0.02, 0.02, 10, 0.05, 0.04)); // flight direction knob
  build(Sh, head, F43.turnY + F43.trunY + 0.1, 0);
  arm.updateMatrix = function () { this.rotation.x = el.rotation.x; THREE.Object3D.prototype.updateMatrix.call(this); };
  head.updateMatrix = function () { this.rotation.x = -el.rotation.x; THREE.Object3D.prototype.updateMatrix.call(this); };
  // the control rod from the cradle to the arm
  hwE.updateMatrix = function () { this.rotation.x = -(el.rotation.x / (8 * DEG)) * Math.PI * 2; THREE.Object3D.prototype.updateMatrix.call(this); };
  hwT.updateMatrix = function () { this.rotation.y = (tur.rotation.y / (10 * DEG)) * Math.PI * 2; THREE.Object3D.prototype.updateMatrix.call(this); };

  // ---- anchors
  rig.anchors.eye = node(root, 'eye', 0, 1.0, 0.3);
  rig.anchors.muzzles.push(node(rc, 'muzzle0', 0, 0.08, F43.muzzle));
  rig.anchors.sight = node(head, 'eyepiece', 0, 0.125, 0.12);
  rig.anchors.feed = node(el, 'feed', cr.T0.x1 - 0.1, cr.T0.y + 0.05, -0.05);
  const tY = -F43.turnY;
  rig.anchors.crew = {
    k1: crewSpot(tur, 'k1', 0.5, 0.38, 0.32, 0, { label: 'K1 layer (both handwheels, foot trigger)', pose: 'sit', seated: true, hands: V(0.5, 0.55, -0.2) }),
    k2: crewSpot(tur, 'k2', 0.98, 0.33, 0.3, 20, { label: 'K2 sight setter (swing-out seat)', pose: 'sit', seated: true }),
    k3: crewSpot(tur, 'k3', -1.25, tY, 0.15, -90, { label: 'K3 loader (lays the clips on the table)', pose: 'load' }),
    k4: crewSpot(root, 'k4', -2.2, 0, -0.3, -80, { label: 'K4 ammunition number (niche to the tray)', pose: 'carry' }),
    k5: crewSpot(root, 'k5', -2.0, 0, 0.8, -110, { label: 'K5 ammunition number', pose: 'carry' }),
    gf: crewSpot(root, 'gf', 0.8, 0, 2.0, 160, { label: 'Geschuetzfuehrer (gun commander)', pose: 'stand' }),
  };

  hb(rig, -1.0, 0, -0.85, 1.1, 1.6, 1.6);
  hb(rig, -0.15, 0.6, -2.35, 0.15, 1.0, -0.5);

  // ---- state
  let paint = 'yellow';
  paintCarrier(root);
  rig.setPaint = (s) => { if (s !== paint && (s === 'grey' || s === 'yellow')) { paint = s; setPaint(root, s); } };
  rig.setRecoil = (m) => { rc.position.z = Math.min(0.13, Math.max(0, m)); };
  rig.setRounds = (n) => {
    n = Math.max(0, Math.min(16, n | 0));
    const a = Math.max(0, n - 8), b = Math.min(8, n);
    // the clips walk right one round per shot fired
    const off = (16 - n) * F43.pitch;
    clips[0].g.position.x = off;
    clips[1].g.position.x = off;
    clips[0].g.visible = a > 0;
    clips[0].m.geometry.setDrawRange(0, vPlate + a * vRound);
    clips[1].m.geometry.setDrawRange(0, vPlate + b * vRound);
    clips[1].g.visible = n > 0;
  };
  rig.setRounds(16);
  return rig;
}
