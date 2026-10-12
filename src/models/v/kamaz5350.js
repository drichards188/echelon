import * as THREE from 'three';
import { V, xf, box, yTube, zTube, xTube, rod, Parts, mudguard } from '../kit.js';
import { newRig, node, pivotAt, hb } from '../rig.js';
import { KAMAZ, rb, kamazCab, kamazFrame, kamazTyre, kamazHub } from './kamaz.js';
import { spinWheels } from './t22t6.js';
import { mudFlap } from '../trucks.js';

// KamAZ-5350 6x6 army cargo truck: the supply truck that brings the Shilka's ammunition between raids
// (refs/shilka/README.md section 7: "the crew loads ammunition by hand from the ground or from a supply
// truck"; no photo of the truck or of a Shilka being restocked was found, so this is a plausible
// general-purpose army truck, not a documented vehicle). The Mustang-family day cab of the KamAZ-6560
// (kamaz.js, the Pantsir's carrier, without the cab stars), three axles (the front one under the cab,
// a tandem at the rear), black disc wheels, a steel cargo body with drop sides, its tilt rolled up onto
// the front bows (open for loading). Dimensions are rounded KamAZ-5350 figures: about 8.4 m long, 2.5 m
// wide, 4.4 m from the front axle to the middle of the tandem. Plain olive. Model space: front -Z,
// ground y = 0, origin at the middle of the length.
//
// Rig:
//   sideL, sideR  the body's drop sides, hinged along the bottom edge: rotation.z, sideL opens with
//                 + (its top swings out and down to the left), sideR with -; about 1.65 lies down.
//   tailgate      hinged along its bottom edge: rotation.x + drops it.
//   setWheels(roll, steer)  roll: metres travelled; steer: front axle angle (rad, + = left).
//   anchors.eye, anchors.bed (the middle of the load floor).
// Exported KAMAZ5350: axles, R, track, bed { y, z0, z1, hw, side } for the reload scene.

export const KAMAZ5350 = {
  R: 0.62, W: 0.42, track: 1.025,
  axles: [-2.75, 0.94, 2.26],
  cab: { zf: -3.85, zr: -2.2, bumper: -4.07 },
  bed: { y: 1.45, z0: -2.02, z1: 3.55, hw: 1.25, side: 0.5 },
  rear: 3.62,
};

// axles, springs, the transfer case and the shafts (the wheels are instanced, see spinWheels)
function gear(P) {
  const { R, track, axles } = KAMAZ5350;
  axles.forEach((z, i) => {
    for (const s of [-1, 1]) {
      P.add('dark', xTube(s * (track - 0.2), s * (track - 0.38), 0.12, 0.1, 12, R, z)); // hub reduction
      P.add('dark', yTube(R - 0.06, R + 0.2, 0.07, 0.07, 8, s * (track - 0.42), z + 0.22)); // brake chamber
      if (i === 0) {
        P.add('dark', box(0.09, 0.07, 1.2, s * 0.52, R + 0.2, z));
        P.add('dark', box(0.09, 0.05, 0.85, s * 0.52, R + 0.27, z));
      }
    }
    P.add('dark', xTube(-track + 0.3, track - 0.3, 0.075, 0.075, 10, R, z));
    P.add('dark', new THREE.SphereGeometry(0.19, 12, 8).scale(1, 0.9, 1.1).translate(0, R, z)); // differential
    if (i === 0) P.add('dark', xTube(-track + 0.35, track - 0.35, 0.022, 0.022, 6, R - 0.05, z - 0.34)); // track rod
  });
  // the tandem's bogie: springs on a trunnion between the rear axles, torque rods
  const zb = (axles[1] + axles[2]) / 2;
  for (const s of [-1, 1]) {
    P.add('dark', box(0.1, 0.08, 1.5, s * 0.52, R + 0.18, zb));
    P.add('dark', box(0.1, 0.06, 1.05, s * 0.52, R + 0.26, zb));
    P.add('dark', xTube(s * 0.4, s * 0.62, 0.11, 0.11, 12, R + 0.3, zb));
    for (const zz of [axles[1], axles[2]]) P.add('dark', rod(V(s * 0.3, R + 0.05, zz), V(s * 0.3, R + 0.42, zb), 0.03, 6));
  }
  P.add('dark', zTube(axles[0] + 0.22, axles[1] - 0.22, 0.045, 0.045, 8, 0, R + 0.08));
  P.add('dark', zTube(axles[1] + 0.22, axles[2] - 0.22, 0.045, 0.045, 8, 0, R + 0.08));
  P.add('dark', box(0.55, 0.45, 0.7, 0, 0.95, -0.9)); // transfer case
}

// the steel cargo body: floor on runners, a tall front board, drop sides and tailgate with ribs and
// hinges, the bows and the rolled tilt at the front
function body(P, rig) {
  const { y, z0, z1, hw, side } = KAMAZ5350.bed;
  const L = z1 - z0, zc = (z0 + z1) / 2;
  P.add('dark', box(2.2, 0.12, L - 0.1, 0, y - 0.13, zc)); // runners and cross members
  for (let z = z0 + 0.3; z < z1; z += 0.62) P.add('dark', box(2.46, 0.1, 0.08, 0, y - 0.13, z));
  P.add('camo', box(hw * 2, 0.05, L, 0, y - 0.025, zc), { tint: 0xc8c8c8 }); // the floor
  // front board, taller than the sides, with a ladder rung row
  P.add('camo', box(hw * 2, 0.95, 0.05, 0, y + 0.475, z0 + 0.025));
  for (const x of [-0.8, 0, 0.8]) P.add('camo', box(0.05, 0.95, 0.03, x, y + 0.475, z0 - 0.015), { tint: 0xd0d0d0 });
  // the drop sides on their pivots, and the posts between them at the corners
  for (const s of [-1, 1]) {
    const pv = pivotAt(rig, rig.root, s < 0 ? 'sideL' : 'sideR', s * hw, y, 0);
    const S = new Parts(rig.mats);
    S.add('camo', box(0.04, side, L - 0.06, -s * 0.02, side / 2, zc));
    for (let k = 0; k < 7; k++) S.add('camo', box(0.03, side - 0.08, 0.05, s * 0.01, side / 2, z0 + 0.4 + (k * (L - 0.8)) / 6), { tint: 0xd0d0d0 }); // ribs
    S.add('camo', box(0.05, 0.05, L - 0.06, s * 0.005, side - 0.02, zc), { tint: 0xd8d8d8 }); // the top rail
    for (const z of [z0 + 0.5, zc, z1 - 0.5]) S.add('dark', box(0.06, 0.1, 0.12, s * 0.02, side - 0.1, z)); // latches
    S.build(pv, { y0: y });
    for (const z of [z0 + 0.8, zc, z1 - 0.8]) P.add('dark', zTube(z - 0.08, z + 0.08, 0.025, 0.025, 6, s * hw, y)); // hinges
  }
  const tg = pivotAt(rig, rig.root, 'tailgate', 0, y, z1);
  const T = new Parts(rig.mats);
  T.add('camo', box(hw * 2 - 0.06, side, 0.04, 0, side / 2, -0.02));
  for (const x of [-0.8, -0.4, 0, 0.4, 0.8]) T.add('camo', box(0.05, side - 0.08, 0.03, x, side / 2, 0.01), { tint: 0xd0d0d0 });
  T.add('camo', box(hw * 2 - 0.06, 0.05, 0.05, 0, side - 0.02, 0.005), { tint: 0xd8d8d8 });
  T.build(tg, { y0: y });
  // the bows of the tilt frame, and the tilt itself rolled up onto the front bows
  for (const z of [z0 + 0.35, zc - 0.4, zc + 0.9, z1 - 0.15]) {
    for (const s of [-1, 1]) P.add('dark', yTube(y + 0.4, y + 1.42, 0.022, 0.022, 6, s * (hw - 0.02), z));
    P.add('dark', xTube(-(hw - 0.02), hw - 0.02, 0.022, 0.022, 6, y + 1.44, z));
    for (const s of [-1, 1]) P.add('dark', rod(V(s * (hw - 0.02), y + 1.42, z), V(s * (hw - 0.45), y + 1.62, z), 0.022, 6));
    P.add('dark', xTube(-(hw - 0.45), hw - 0.45, 0.022, 0.022, 6, y + 1.62, z));
  }
  P.add('cloth', xTube(-(hw - 0.1), hw - 0.1, 0.17, 0.17, 14, y + 1.32, z0 + 0.55));
  P.add('cloth', xTube(-(hw - 0.4), hw - 0.4, 0.12, 0.12, 12, y + 1.6, z0 + 0.75));
  for (const x of [-0.9, 0, 0.9]) P.add('dark', box(0.04, 0.4, 0.36, x, y + 1.42, z0 + 0.62)); // the straps round the roll
}

// spare wheel upright behind the cab, the fuel tank and the battery box on the frame, side guards,
// the rear lamps and the mudguards over the tandem
function chassis(P) {
  const { R, W, axles, bed, rear } = KAMAZ5350;
  P.add('dark', box(0.4, 0.5, 0.5, 0, 1.25, -2.1)); // the frame behind the cab
  P.add('tyre', kamazTyre(R, W, 14, 40).applyMatrix4(xf(0, 1.0, -2.08, 0, Math.PI / 2, 0)));
  for (const s of [-1, 1]) {
    // fuel tank (right), battery box (left) on brackets under the body
    if (s > 0) P.add('camo', rb(0.55, 0.55, 1.1, 0.12, 1.0, 0.95, -0.7), { tint: 0xc8c8c8 });
    else P.add('dark', rb(0.5, 0.45, 0.7, 0.03, -1.0, 0.95, -0.85));
    P.add('steel', box(0.04, 0.04, 1.25, s * 1.22, 0.72, -0.35)); // side guard rail
    // the tandem's mudguards and flaps, the rear lamp bar
    P.add('camo', mudguard(R, W + 0.18, s * KAMAZ5350.track, R, axles[1], 15, 165, 0.12, 0.04));
    P.add('camo', mudguard(R, W + 0.18, s * KAMAZ5350.track, R, axles[2], 15, 165, 0.12, 0.04));
    mudFlap(P, s * 1.02, 0.66, axles[2] + 0.8, 0.5, 0.45);
    P.add('dark', box(0.32, 0.12, 0.08, s * 0.95, 1.12, rear - 0.05));
    P.add('red', box(0.12, 0.06, 0.01, s * 1.0, 1.13, rear - 0.005));
    P.add('amber', box(0.08, 0.06, 0.01, s * 0.86, 1.13, rear - 0.005));
  }
  P.add('dark', box(2.1, 0.08, 0.08, 0, 1.12, rear - 0.05));
  P.add('dark', box(0.25, 0.18, 0.2, 0, 0.92, rear - 0.05)); // the towing hitch
  P.add('steel', new THREE.TorusGeometry(0.07, 0.022, 6, 12).applyMatrix4(xf(0, 0.86, rear + 0.04, Math.PI / 2, 0, 0)));
}

export function buildKamaz5350() {
  const rig = newRig('green');
  const { P, root, mats } = rig;
  const { zf, zr, bumper } = KAMAZ5350.cab;
  kamazCab(P, { zf, zr, bumper, a1: KAMAZ5350.axles[0], star: false });
  kamazFrame(P, zr - 0.2, KAMAZ5350.rear - 0.1, 1.2, KAMAZ.rail);
  gear(P);
  chassis(P);
  body(P, rig);
  P.build(root, { dirt: 0.5 });
  const { R, W, track, axles } = KAMAZ5350;
  const wheels = spinWheels(root, mats, axles.flatMap((z, i) => [-1, 1].map((s) => ({ x: s * track, y: R, z, steer: i === 0 ? 1 : 0 }))), R, (Q, r) => {
    Q.add('tyre', kamazTyre(r, W));
    kamazHub(Q, 0, 0, 0, 1, r, W);
  });
  rig.setWheels = wheels.set;
  rig.anchors.eye = node(root, 'eye', 0, 2.2, 0);
  rig.anchors.bed = node(root, 'bed', 0, KAMAZ5350.bed.y, (KAMAZ5350.bed.z0 + KAMAZ5350.bed.z1) / 2);
  hb(rig, -1.25, 0.4, bumper, 1.25, 3.25, KAMAZ5350.rear);
  return rig;
}
