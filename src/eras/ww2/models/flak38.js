import * as THREE from 'three';
import { V, DEG, box, rbox, yTube, zTube, xTube, rod, xf, loft, topProfile, Parts } from '../../../models/kit.js';
import { newRig, node, pivotAt, hb } from '../../../models/rig.js';
import { mulberry32 } from '../../../noise.js';
import { flakMats, setPaint, paintCarrier, add, build, wheelSet, panSeat, plankPit, clockNumbers, floorDisc, crewSpot } from './kit44.js';

// 2 cm Flak 38 on its triangular ground mount (Dreiecksbettung) in a plank-revetted light flak pit,
// the Sd.Anh. 51 taken away, no shield (refs/ww2/flak38, its "decision recorded"; photos
// flak38_museum_belgium_12, the ground mount from the rear left; flak38_museum_d_10, from the front left;
// flak38_crew_1943_02, two guns at high elevation on the base; flak38_crew_1944_01, Luftwaffenhelfer at a
// Flak 38 in a plank pit with its numbered boards). Modelled: the cast triangular base, its sides curved
// in, a levelling spindle and round foot at each corner (the rear one under the layer), the round
// turntable on its ball race; the small top carriage, two cheeks carrying the trunnions; the cradle with
// the big elevating ring round the trunnion on its left, the ribbed gear cover on its right; the gun: the slim receiver, the 20-round flat
// box magazine sticking out level from its LEFT side, the charging handle on the right, the 1.3 m barrel
// and its conical muzzle brake; the layer's seat with its back plate on a bracket behind the cradle, the
// two handwheels in front of him (elevation vertical on his right, traverse slanting), the foot pedal;
// the Flakvisier 38 computing sight on its arm on the LEFT of the cradle, linked to it by a rod. The pit
// (section 11): twelve plank panels on posts 4.6 m across, 1.25 m high, earth banked outside, the white
// numbers on black boards (12 at the model's front), the entrance at the rear, magazine boxes on the floor.
//
// Dimensions (section 2): firing height on the ground 0.76 m (G&C "Feuerhoehe abgesetzt"), gun 2.25 m long
// with the barrel 1.3 m, width on the mount 1.81 m, height 1.6 to 1.7 m; the base arms (not published)
// 0.92 m from the centre, so 1.81 m across the front pads (the published width on the mount).
//
// Rig (front -Z, right +X, ground y = 0):
//   pivots.turret     the top carriage on the turntable, (0, 0.2, 0). rotation.y = traverse, + to the left, 360.
//   pivots.elevation  the trunnions, turret space (0, 0.56, 0), 0.76 m above the ground. rotation.x =
//                     elevation, + raises the muzzle; -20 to +90 deg (-0.349 to 1.571).
//   pivots.recoil     the barrel and the breech's recoiling parts: position.z, 0 to 0.053; rig.setRecoil(m).
//   rig.setMagazine(on)  the magazine on the gun (off during a change).
//   anchors.muzzles   [the muzzle], -Z along the bore.   anchors.magazine  the magazine well (elevation group).
//   anchors.sight     the Flakvisier 38's eyepiece (kept level), -Z along the line of sight.
//   anchors.eye       camera focus (0, 0.95, 0.3) on the root.
//   anchors.crew      on the turret: k1 layer (seated); on the root: k2 range setter and k4 loader at the
//                     gun's left, k3 course setter (hands magazines with the Flakvisier 38), k5 range-taker
//                     with the 1 m rangefinder on the parapet, gf gun commander.
//   setPaint('yellow' | 'grey'): Dunkelgelb by default.

export const F38 = { turnY: 0.2, trunY: 0.56, muzzle: -1.78, pitR: 2.3 };

function base(P) {
  const paint = (g, t = 0xffffff) => add(P, 'paint', g, t);
  // the cast triangular base (flak38_museum_belgium_12, _d_10): a plate whose sides curve in between the
  // three arms, each arm ending in a square pad over its levelling spindle and round foot
  const feet = [[0, 0.92], [0.8, -0.46], [-0.8, -0.46]]; // 1.81 m across the front pads (G&C width)
  const outline = [];
  for (let i = 0; i < 3; i++) {
    const [x0, z0] = feet[i], [x1, z1] = feet[(i + 1) % 3];
    const a0 = Math.atan2(x0, z0), a1 = Math.atan2(x1, z1);
    // the arm's end pad corners, then a concave arc to the next arm
    const r0 = Math.hypot(x0, z0), ca = Math.cos(a0), sa = Math.sin(a0);
    for (const [u, w] of [[-0.12, r0 - 0.1], [-0.12, r0 + 0.12], [0.12, r0 + 0.12], [0.12, r0 - 0.1]]) outline.push([sa * w + ca * u, ca * w - sa * u]);
    const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2, ml = Math.hypot(mx, mz);
    for (let k = 1; k < 8; k++) {
      const t = k / 8, px = x0 + (x1 - x0) * t, pz = z0 + (z1 - z0) * t;
      const pull = Math.sin(Math.PI * t) * (ml - 0.42); // the side bows in toward the centre
      outline.push([px - (mx / ml) * pull, pz - (mz / ml) * pull]);
    }
  }
  // topProfile's shape winds the other way round from this (x, z) order: reverse for a clean shape
  paint(topProfile(outline.reverse(), 0.04, 0.15));
  paint(topProfile(outline.map(([x, z]) => [x * 0.96, z * 0.96]), 0.15, 0.17), 0xd8d8d8);
  for (const [x, z] of feet) {
    paint(yTube(0.0, 0.025, 0.12, 0.12, 14, x, z), 0xbdbdbd);
    add(P, 'metal', yTube(0.02, 0.24, 0.022, 0.022, 8, x, z));
    add(P, 'metal', yTube(0.24, 0.27, 0.035, 0.035, 8, x, z), 0x9a9a9a);
    paint(yTube(0.15, 0.22, 0.06, 0.06, 10, x, z), 0xd0d0d0);
  }
  // the lifting eyes for the trailer's hooks on the two front corners, the round ball race
  for (const s of [-1, 1]) add(P, 'metal', new THREE.TorusGeometry(0.05, 0.015, 5, 10).applyMatrix4(xf(s * 0.55, 0.12, -0.4, 0, Math.PI / 2 - s * 0.5, 0)), 0xa0a0a0);
  paint(yTube(0.15, 0.2, 0.42, 0.42, 26));
}

function topCarriage(T) {
  const paint = (g, t = 0xffffff) => add(T, 'paint', g, t);
  const ty = F38.trunY;
  paint(yTube(-0.01, 0.06, 0.4, 0.4, 26)); // the turntable plate
  paint(rbox(0.5, 0.14, 0.52, 0.03, 0, 0.1, 0.05));
  // the two cheeks up to the trunnions, cut away so the receiver can swing down between them
  for (const s of [-1, 1]) {
    const ch = loft([[V(s * 0.17, 0.12, -0.32), V(s * 0.2, 0.12, -0.32), V(s * 0.2, 0.12, 0.38), V(s * 0.17, 0.12, 0.38)],
      [V(s * 0.17, ty + 0.08, -0.1), V(s * 0.2, ty + 0.08, -0.1), V(s * 0.2, ty + 0.08, 0.12), V(s * 0.17, ty + 0.08, 0.12)]], { crease: 0.5 });
    paint(ch);
    paint(xTube(s * 0.19, s * 0.25, 0.07, 0.07, 14, ty, 0), 0xe0e0e0);
  }
  // the seat bracket behind, the layer's seat and its back plate
  // (flak38_museum_belgium_12: the layer sits at the left rear behind the sight)
  paint(rod(V(-0.1, 0.12, 0.3), V(-0.28, 0.3, 0.72), 0.03, 8), 0xd0d0d0);
  panSeat(T, 'paint', -0.28, 0.06, 0.74, 0.3, 0.15, false);
  paint(rbox(0.32, 0.26, 0.03, 0.03, -0.28, 0.56, 0.9, 0.2, 0, 0), 0xdedede);
  // the gear housing and the two handwheels' shafts in front of him, the elevation wheel at his right
  paint(rbox(0.14, 0.2, 0.18, 0.02, 0.02, 0.4, 0.4));
  paint(rod(V(0.0, 0.3, 0.32), V(-0.25, 0.5, 0.42), 0.025, 6), 0xd8d8d8);
  // the foot pedal
  add(T, 'black', box(0.1, 0.02, 0.14, -0.15, 0.04, 0.55));
  // the sight bracket on the left cheek
  paint(rbox(0.12, 0.14, 0.18, 0.02, -0.33, ty + 0.05, 0.12), 0xd8d8d8);
  paint(rod(V(-0.2, 0.12, 0.2), V(-0.33, ty, 0.12), 0.03, 6), 0xd8d8d8);
}

function cradle(E) {
  const paint = (g, t = 0xffffff) => add(E, 'paint', g, t);
  // cradle body between the cheeks round the receiver
  paint(rbox(0.3, 0.16, 0.5, 0.03, 0, -0.02, 0.05));
  // the big elevating ring on the left round the trunnion (flak38_museum_d_10): a toothed ring on spokes
  paint(new THREE.TorusGeometry(0.27, 0.025, 6, 32).applyMatrix4(xf(-0.24, 0, 0.0, 0, Math.PI / 2, 0)), 0xd8d8d8);
  for (let i = 0; i < 4; i++) paint(rod(V(-0.24, 0, 0), V(-0.24, Math.sin(i * Math.PI / 2 + 0.4) * 0.26, Math.cos(i * Math.PI / 2 + 0.4) * 0.26), 0.015, 5), 0xd0d0d0);
  for (let i = 0; i < 40; i++) { const a = (i / 40) * Math.PI * 2; add(E, 'metal', box(0.03, 0.016, 0.016, -0.24, Math.sin(a) * 0.298, Math.cos(a) * 0.298, a, 0, 0), 0x909090); }
  // the ribbed round cover of the elevating gear on the right
  paint(xTube(0.2, 0.26, 0.13, 0.13, 18, -0.18, 0.12), 0xdcdcdc);
  for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; paint(box(0.015, 0.012, 0.2, 0.265, -0.18 + Math.sin(a) * 0.06, 0.12 + Math.cos(a) * 0.06, a, 0, 0), 0xd0d0d0); }
  // the receiver (the fixed parts of the weapon) and its cover, the charging handle on the right
  add(E, 'metal', rbox(0.1, 0.12, 0.9, 0.02, 0, 0.0, 0.14), 0x6e7276);
  add(E, 'metal', rbox(0.08, 0.03, 0.7, 0.01, 0, 0.07, 0.16), 0x7e8286);
  add(E, 'metal', box(0.04, 0.03, 0.08, 0.07, 0.02, 0.42), 0x8a8e92);
  // the case outlet on the right
  add(E, 'black', box(0.005, 0.04, 0.1, 0.051, 0.0, -0.02));
  // the sight link rod from the cradle
  paint(rod(V(-0.16, 0.05, 0.1), V(-0.36, 0.22, -0.02), 0.008, 4), 0xd0d0d0);
}

export function buildFlak38() {
  const rig = newRig('green');
  const mats = flakMats('yellow');
  rig.mats = mats;
  const root = rig.root, rnd = mulberry32(381);

  // ---- the pit (rig.emplacement)
  const emp = new THREE.Group();
  emp.name = 'emplacement';
  root.add(emp);
  rig.emplacement = emp;
  const P = new Parts(mats);
  const pit = plankPit(P, { R: F38.pitR, H: 1.25, sides: 12, open: [6], bank: 1.8, crown: 0.5, planks: 6, rnd });
  floorDisc(P, F38.pitR + 0.1, 0.004);
  // black marker boards behind the white numbers on the top boards (flak38_crew_1944_01)
  for (const pn of pit.panels) if (!pn.open && pn.i % 2 === 0) add(P, 'black', box(0.3, 0.19, 0.01, 0, pit.H - pit.top / 2, 0.024).applyMatrix4(xf(pn.c.x, 0, pn.c.z, 0, -pn.a, 0)), 0x303030, 0);
  const pit2 = { ...pit, panels: pit.panels.filter((pn) => pn.i % 2 === 0) };
  clockNumbers(P, pit2, 0.15);
  // magazine boxes and an ammunition box on the floor by the wall at the gun's left
  for (let i = 0; i < 4; i++) add(P, 'wood', rbox(0.4, 0.2, 0.3, 0.02, -1.75 + (i % 2) * 0.05, 0.1 + Math.floor(i / 2) * 0.21, -0.5 + (i % 2) * 0.35, 0, 0.3, 0), i === 3 ? 0x9aa070 : 0x8f9a6a, 1);
  build(P, emp, 0, 0.3);
  const X = new Parts(mats);
  base(X);
  build(X, root, 0, 0.3);

  // ---- top carriage
  const tur = pivotAt(rig, root, 'turret', 0, F38.turnY, 0);
  const T = new Parts(mats);
  topCarriage(T);
  build(T, tur, F38.turnY, 0.12);
  const hwE = node(tur, 'wheelEl', 0.1, 0.42, 0.44), hwT = node(tur, 'wheelTr', -0.26, 0.55, 0.44);
  hwT.rotation.x = -0.9;
  wheelSet(root, [[hwE, xf(0, 0, 0, 0, Math.PI / 2, 0), 0.13], [hwT, xf(0, 0, 0, Math.PI / 2, 0, 0), 0.15]].map(([node, M, R]) => ({ node, M, R })), mats.metal);

  // ---- cradle, gun, magazine
  const el = pivotAt(rig, tur, 'elevation', 0, F38.trunY, 0);
  const E = new Parts(mats);
  cradle(E);
  build(E, el, F38.turnY + F38.trunY, 0);
  const rc = pivotAt(rig, el, 'recoil', 0, 0, 0);
  const R = new Parts(mats);
  add(R, 'metal', zTube(-0.31, -0.5, 0.034, 0.034, 14, 0, 0), 0x6e7276);
  add(R, 'metal', zTube(-0.5, -1.62, 0.018, 0.015, 12, 0, 0), 0x52565a);
  add(R, 'metal', zTube(-1.62, F38.muzzle, 0.024, 0.032, 12, 0, 0), 0x50545a);
  for (let i = 0; i < 4; i++) { const a = (i / 4) * Math.PI * 2 + 0.4; add(R, 'black', box(0.008, 0.008, 0.06, Math.cos(a) * 0.03, Math.sin(a) * 0.03, -1.7, 0, 0, a)); }
  add(R, 'black', new THREE.CircleGeometry(0.011, 8).applyMatrix4(xf(0, 0, F38.muzzle - 0.001, 0, Math.PI, 0)));
  build(R, rc, F38.turnY + F38.trunY, 0);
  const M = new Parts(mats);
  add(M, 'metal', loft([[V(-0.05, -0.065, -0.1), V(-0.05, 0.055, -0.1), V(-0.05, 0.055, 0.02), V(-0.05, -0.065, 0.02)],
    [V(-0.36, -0.085, -0.085), V(-0.36, 0.035, -0.085), V(-0.36, 0.035, 0.005), V(-0.36, -0.085, 0.005)]], { crease: 0.4 }), 0x5a5e5a);
  for (let i = 0; i < 5; i++) add(M, 'metal', box(0.012, 0.13, 0.004, -0.09 - i * 0.06, -0.015, 0.012), 0x666a66); // ribs
  const mag = new THREE.Group();
  mag.name = 'magazine';
  el.add(mag);
  build(M, mag, F38.turnY + F38.trunY, 0);

  // ---- the Flakvisier 38 on its arm on the left (kept level), linked to the cradle
  const arm = node(tur, 'sightArm', -0.36, F38.trunY + 0.08, 0.12);
  const Sa = new Parts(mats);
  add(Sa, 'paint', box(0.04, 0.4, 0.04, 0, 0.2, 0), 0xd0d0d0);
  build(Sa, arm, F38.turnY + F38.trunY, 0);
  const head = node(arm, 'sightHead', 0, 0.42, 0.0);
  const Sh = new Parts(mats);
  add(Sh, 'paint', rbox(0.16, 0.16, 0.26, 0.02, -0.02, 0.0, 0.0), 0xd8d8d8);
  add(Sh, 'paint', xTube(-0.1, 0.06, 0.06, 0.06, 14, -0.03, 0.12), 0xe0e0e0); // the computing drum
  add(Sh, 'glass', box(0.12, 0.1, 0.004, -0.02, 0.12, -0.08, -0.75, 0, 0));
  add(Sh, 'black', zTube(0.13, 0.17, 0.022, 0.026, 10, -0.02, 0.03));
  build(Sh, head, F38.turnY + F38.trunY + 0.5, 0);
  arm.updateMatrix = function () { this.rotation.x = -0.25 + el.rotation.x * 0.25; THREE.Object3D.prototype.updateMatrix.call(this); };
  head.updateMatrix = function () { this.rotation.x = 0.25 - el.rotation.x * 0.25; THREE.Object3D.prototype.updateMatrix.call(this); };
  hwE.updateMatrix = function () { this.rotation.x = -(el.rotation.x / (6 * DEG)) * Math.PI * 2; THREE.Object3D.prototype.updateMatrix.call(this); };
  hwT.updateMatrix = function () { this.rotation.y = (tur.rotation.y / (10 * DEG)) * Math.PI * 2; THREE.Object3D.prototype.updateMatrix.call(this); };

  // ---- anchors
  rig.anchors.eye = node(root, 'eye', 0, 0.95, 0.3);
  rig.anchors.muzzles.push(node(rc, 'muzzle0', 0, 0, F38.muzzle));
  rig.anchors.magazine = node(el, 'magazineWell', -0.06, 0, -0.04);
  rig.anchors.sight = node(head, 'eyepiece', -0.02, 0.03, 0.17);
  rig.anchors.crew = {
    k1: crewSpot(tur, 'k1', -0.28, 0.16, 0.74, 0, { label: 'K1 layer (seated, both handwheels, the pedal)', pose: 'sit', seated: true, hands: V(-0.1, 0.5, 0.44) }),
    k2: crewSpot(root, 'k2', -0.75, 0, 0.55, -60, { label: 'K2 range setter (at the sight, left)', pose: 'stand' }),
    k3: crewSpot(root, 'k3', -1.35, 0, 1.0, -120, { label: 'K3 course setter / magazines', pose: 'carry' }),
    k4: crewSpot(root, 'k4', -0.85, 0, -0.35, -90, { label: 'K4 loader (magazine at the gun\'s left)', pose: 'load' }),
    k5: crewSpot(root, 'k5', 3.0, 0, 2.2, -40, { label: 'K5 range-taker with the 1 m rangefinder, outside the pit', pose: 'rangefinder' }),
    gf: crewSpot(root, 'gf', 0.9, 0, 1.2, 150, { label: 'Geschuetzfuehrer (gun commander)', pose: 'stand' }),
  };

  hb(rig, -1.0, 0, -0.7, 1.0, 1.1, 1.2);

  let paint = 'yellow';
  paintCarrier(root);
  rig.setPaint = (s) => { if (s !== paint && (s === 'grey' || s === 'yellow')) { paint = s; setPaint(root, s); } };
  rig.setRecoil = (m) => { rc.position.z = Math.min(0.053, Math.max(0, m)); };
  rig.setMagazine = (on) => { mag.visible = !!on; };
  return rig;
}
