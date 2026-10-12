import * as THREE from 'three';
import { V, xf, box, yTube, zTube, xTube, rod, loft, mudguard, plane, scaleUV, Parts } from '../kit.js';
import { newRig, node, pivotAt, hb } from '../rig.js';
import { mudFlap } from '../trucks.js';
import { rb, kamazTyre, kamazHub } from './kamaz.js';
import { spinWheels } from './t22t6.js';
import { CONT, tunguskaContainer, containerCover, tunguskaMats, greyer } from './tunguska.js';
import { mark, span, swapper } from './swap.js';

// 2F77M transport-loading vehicle of the 2S6M Tunguska on the KamAZ-43101 6x6 (refs/tunguska/README.md
// section 7; photos tung_2f77m_11 the front with the data plate, _12 the rear from the left, _13 the left
// side, measured at 236 px/m with the 3.34 + 1.32 m wheelbase as the ruler). The data plate: crew of 2,
// 32 ammunition boxes and 8 9M311 missiles. The first-generation KamAZ cab (flat front, two-pane
// windscreen, the KAMAZ letters over a slatted grille, headlamps in the corners, a black bumper beam,
// black flares over the front wheels, horizontally ribbed rear quarters, the air intake pipe behind the
// left corner), the spare wheel standing across the frame behind the cab, a flat platform with low side
// beams carrying, front to rear: a box rack of ammunition under a tubular frame, the eight missile
// containers in two stacks of four along the sides, and racks of ammunition boxes in expanded-metal
// frames across the tail; between the stacks at the rear the crane: a slewing column with its winch and
// drive motors on top and a long trolley beam reaching forward over the platform, braced to the column
// and trussed above, a trolley with a two-claw grab under it. Paint as the Tunguska (tunguska.js).
//
// RECONSTRUCTED, not seen: the crane at work (no loading photo exists). The column is built telescopic,
// so the beam can rise over the launchers, and the grab takes one container or two one above the other.
//
// Pivots and rig extras (model space: front -Z, ground y = 0, origin at the middle of the 7.79 m length):
//   crane        rotation.y slew about the column (F77.crane); 0 = the beam reaching forward (-Z), + left.
//   craneColumn  the telescopic column: position.y = lift (0 stowed .. F77.lift).
//   craneTrolley position.z = -(reach along the beam from the column axis).
//   craneHook    the hook under the trolley: position.y = -(cable + F77.hook0).
//   craneRotator rotation.y of the grab relative to the slew.
//   anchors.craneLoad  on the claws (the underside of the load, between them): a container of
//                tunguska.js hung with its frame at (x, CONT.r [+ 0.22 for one above it], -(CONT.z0 +
//                CONT.z1) / 2) in this space lies level along -Z, its middle over the anchor.
//   setCrane({ slew, lift, reach, cable, rotate })  poses the crane.
//   solveCrane(p, yaw, out = {}, minLift = 0)  the pose that puts craneLoad at p (model space), the load's
//                mouth along the model-space heading yaw, the column up at least minLift; out.ok false
//                when out of reach (clamped).
//   craneTravel  the stowed pose: beam forward over the platform, column down, the grab hoisted.
//   setWheels(roll, steer)  roll: metres travelled, steer: the first axle's angle (rad, + left).
//   setLoaded(i, on)  the container in stack place i (0..3 the left stack bottom to top, 4..7 the right).
//   anchors.cargo[i]  each stack place's container frame (as tunguska.js launcher space: the tube from
//                CONT.z0, the mouth toward -Z, to CONT.z1).
//   anchors.boxes[i]  the tail racks' box places (the crew takes 30 mm ammunition boxes from there; the
//                racks stay full).
//   doorL, doorR  the cab doors (rotation.y, doorL opens negative).
//   anchors.eye, anchors.cabDoorL/R (on the ground by each door), anchors.operator (on the platform
//                by the column, the crane's levers).

const A1 = -2.415; // first axle; the rear pair 3.34 and 4.66 behind it
export const F77 = {
  R: 0.61, W: 0.4, track: 1.005,
  axles: [A1, A1 + 3.34, A1 + 4.66],
  cab: { zf: A1 - 1.1, zr: A1 + 0.82, bumper: A1 - 1.52, hw: 1.22, y0: 1.2, top: 2.68 },
  deck: 1.5,
  bed: { z0: A1 + 1.23, z1: A1 + 6.26, hw: 1.25 },
  rear: A1 + 6.31,
  stack: { x: 0.86, z: 3.3, y: [1.625, 1.84, 2.055, 2.27] }, // container columns, frames' z, rows bottom to top
  crane: { x: 0, z: 2.87 }, // column axis on the platform
  beam: { y: 2.96, L: 3.95 }, // beam (its underside's rail) above the ground with the column down; length ahead of the axis
  lift: 0.5, // the column's travel
  hook0: 0.62, // trolley rail to the claws' tips with the cable in
  pitch: 0.22, // a pair one above the other on the grab
};

// ---------------------------------------------------------------- cab

function rrRing(hw, z0, z1, r, y, n = 3) {
  const out = [];
  const corners = [[hw - r, z0 + r, -90], [hw - r, z1 - r, 0], [-hw + r, z1 - r, 90], [-hw + r, z0 + r, 180]];
  for (const [cx, cz, a0] of corners) for (let k = 0; k < n; k++) {
    const a = ((a0 + (90 * k) / (n - 1)) * Math.PI) / 180;
    out.push(V(cx + Math.cos(a) * r, y, cz + Math.sin(a) * r));
  }
  return out;
}

// The first KamAZ cab (4310 family, photos 11 and 13): a squarish box with a near vertical front, two
// flat windscreen panes either side of a pillar, the panel under them with the KAMAZ letters, the
// slatted grille between the headlamps in their corner recesses, the black bumper beam with lamps at
// its ends, black flares over the front wheels, horizontal ribs pressed into the rear quarters, the
// roof with a vent between two black lamp domes, a spotlight on the left corner and the whip.
function cab4310(P) {
  const { zf, zr, bumper, hw, y0, top } = F77.cab, a1 = F77.axles[0];
  P.add('camo', loft([
    rrRing(hw, zf, zr, 0.08, y0),
    rrRing(hw, zf - 0.01, zr, 0.08, 1.94),
    rrRing(hw - 0.01, zf + 0.27, zr, 0.1, top - 0.05),
    rrRing(hw - 0.06, zf + 0.33, zr - 0.04, 0.14, top),
  ], { crease: 30 * Math.PI / 180 }));
  P.add('dark', box(2.2, 0.3, 1.5, 0, y0 - 0.12, (zf + zr) / 2)); // under the cab
  // windscreen (photo 13: raked well back above the vertical front): two flat panes either side of a
  // pillar, rubber surrounds, the wipers parked at the bottom
  const g0 = 1.98, g1 = 2.6, rake = Math.atan2(0.25, g1 - g0), gz = zf + 0.02 + (0.25 * 0.5);
  for (const s of [-1, 1]) {
    P.add('rubber', box(1.08, g1 - g0 + 0.07, 0.02, s * 0.56, (g0 + g1) / 2, gz + 0.008, rake));
    P.add('glass', box(1.02, g1 - g0, 0.02, s * 0.56, (g0 + g1) / 2, gz, rake));
    P.add('dark', box(0.02, 0.02, 0.06, s * 0.3, g0 - 0.03, zf + 0.02));
    P.add('dark', box(0.5, 0.018, 0.018, s * 0.52, g0 + 0.02, zf + 0.02, 0, 0, s * 0.15));
  }
  P.add('camo', box(0.07, g1 - g0 + 0.04, 0.05, 0, (g0 + g1) / 2, gz - 0.005, rake));
  // the panel under the screen: the KAMAZ letters on their strip, the explosive load placards
  P.add('dark', box(1.36, 0.06, 0.01, 0, 1.44, zf - 0.008));
  for (let i = 0; i < 5; i++) P.add('dark', box(0.13, 0.08, 0.012, -0.52 + i * 0.26, 1.44, zf - 0.012));
  P.add('white', box(0.3, 0.3, 0.01, -0.62, 1.72, zf - 0.008), { tint: 0xe8e8e0 });
  P.add('amber', box(0.42, 0.3, 0.01, -0.24, 1.72, zf - 0.008), { tint: 0xff9a30 });
  // grille: recess, five slats, headlamps in their corner recesses, the corner panels
  P.add('dark', box(1.32, 0.24, 0.03, 0, 1.3, zf - 0.005));
  for (let i = 0; i < 5; i++) P.add('camo', box(1.3, 0.025, 0.04, 0, 1.21 + i * 0.045, zf - 0.02));
  for (const s of [-1, 1]) {
    P.add('dark', zTube(zf + 0.03, zf - 0.02, 0.13, 0.13, 18, s * 0.84, 1.31));
    P.add('dark', zTube(zf - 0.02, zf - 0.04, 0.1, 0.1, 18, s * 0.84, 1.31));
    P.add('lens', zTube(zf - 0.04, zf - 0.05, 0.085, 0.085, 18, s * 0.84, 1.31));
    P.add('amber', rb(0.05, 0.07, 0.05, 0.01, s * (hw - 0.02), 1.55, zf - 0.005));
  }
  // bumper: a black box beam with lamps at its ends, the plate, tow hooks
  const bz = (bumper + zf + 0.02) / 2, bd = zf + 0.02 - bumper;
  P.add('dark', rb(2.38, 0.28, bd, 0.03, 0, 0.92, bz));
  for (const s of [-1, 1]) {
    P.add('dark', zTube(bumper + 0.01, bumper - 0.02, 0.055, 0.055, 12, s * 0.9, 0.93));
    P.add('red', zTube(bumper - 0.02, bumper - 0.03, 0.045, 0.045, 12, s * 0.9, 0.93), { tint: 0xd06040 });
    P.add('rubber', box(0.16, 0.12, 0.02, s * 0.6, 0.94, bumper - 0.005));
    P.add('steel', rod(V(s * 0.45, 0.72, bumper + 0.1), V(s * 0.45, 0.6, bumper + 0.02), 0.02, 6));
  }
  P.add('steel', rod(V(-0.95, 0.85, bumper + 0.05), V(-0.95, 0.62, bumper + 0.02), 0.012, 4)); // the hanging tow hook (photo 11)
  P.add('white', box(0.5, 0.11, 0.01, 0, 0.94, bumper - 0.012), { tint: 0xe2e2da });
  P.add('dark', box(0.42, 0.065, 0.008, -0.02, 0.94, bumper - 0.018));
  // black flares over the front wheels, from the cab's lower corner back over the wheel
  for (const s of [-1, 1]) {
    P.add('rubber', mudguard(F77.R, 0.24, s * (hw - 0.03), F77.R, a1, 12, 172, 0.12, 0.07));
    P.add('rubber', mudguard(F77.R, 0.45, s * (hw - 0.22), F77.R, a1, 25, 155, 0.1, 0.02));
    // the step under the door, behind the flare
    P.add('dark', box(0.08, 0.05, 0.36, s * (hw - 0.02), 0.95, zr - 0.2));
    P.add('steel', box(0.12, 0.03, 0.34, s * (hw + 0.01), 0.97, zr - 0.2));
    mudFlap(P, s * F77.track, F77.R, a1 + 0.8, 0.46, 0.4);
  }
  // sides: door seams, the side window frame, the ribbed rear quarter, the grab handle, mirrors
  for (const s of [-1, 1]) {
    const x = s * (hw + 0.002);
    P.add('dark', box(0.012, 1.35, 0.02, x, 1.9, zf + 0.32));
    P.add('dark', box(0.012, 1.35, 0.02, x, 1.9, zf + 1.1));
    for (let i = 0; i < 7; i++) P.add('camo', box(0.03, 0.035, zr - zf - 1.3, s * (hw + 0.008), 1.6 + i * 0.1, (zf + 1.15 + zr - 0.12) / 2)); // pressed ribs
    P.add('rubber', box(0.02, 0.36, 0.22, s * (hw + 0.003), 2.38, zr - 0.3));
    P.add('glass', box(0.02, 0.3, 0.16, s * (hw + 0.005), 2.38, zr - 0.3));
    P.add('steel', rod(V(s * (hw + 0.05), 1.5, zf + 1.18), V(s * (hw + 0.05), 2.3, zf + 1.18), 0.015, 6));
    const mx = s * (hw + 0.16), mz = zf + 0.08;
    P.add('dark', rod(V(s * hw, 2.42, zf + 0.25), V(mx, 2.44, mz), 0.016, 6));
    P.add('dark', rod(V(s * hw, 1.9, zf + 0.12), V(mx, 1.88, mz), 0.016, 6));
    P.add('dark', rod(V(mx, 1.88, mz), V(mx, 2.44, mz), 0.016, 6));
    P.add('dark', rb(0.06, 0.44, 0.2, 0.025, mx + s * 0.04, 2.14, mz, 0, s * 0.25, 0));
  }
  // roof: two black lamp domes, a vent, the spotlight on the left corner, the whip and its base
  for (const x of [0.85, -0.25]) {
    P.add('dark', yTube(top, top + 0.07, 0.1, 0.1, 12, x, zf + 1.3));
    P.add('dark', new THREE.SphereGeometry(0.1, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2).translate(x, top + 0.07, zf + 1.3));
  }
  // a grab rail frame on the roof's left rear (photo 13)
  for (const z of [zf + 1.15, zr - 0.15]) P.add('steel', rod(V(-0.95, top, z), V(-0.95, top + 0.14, z), 0.014, 5));
  P.add('steel', rod(V(-0.95, top + 0.14, zf + 1.15), V(-0.95, top + 0.14, zr - 0.15), 0.014, 5));
  P.add('camo', yTube(top - 0.02, top + 0.06, 0.16, 0.14, 14, 0.1, zf + 0.95));
  P.add('dark', yTube(top - 0.12, top + 0.06, 0.025, 0.025, 6, -(hw - 0.08), zf + 0.3));
  P.add('dark', zTube(zf + 0.36, zf + 0.2, 0.075, 0.08, 14, -(hw - 0.08), top + 0.12));
  P.add('lens', zTube(zf + 0.2, zf + 0.19, 0.068, 0.068, 14, -(hw - 0.08), top + 0.12));
  P.add('dark', yTube(top, top + 0.1, 0.04, 0.03, 8, 0.45, zr - 0.25));
  P.add('dark', yTube(top + 0.1, top + 1.7, 0.01, 0.005, 4, 0.45, zr - 0.25));
  P.add('dark', box(2.0, 0.35, 0.18, 0, y0 + 0.1, zr + 0.09)); // the cab's rear mount
}

// ---------------------------------------------------------------- chassis and platform

// Six wheels' worth of axles, springs, differentials and shafts (the wheels themselves turn, spinWheels).
function runningGear(P) {
  const { axles, R, track } = F77;
  axles.forEach((z, i) => {
    P.add('dark', xTube(-track + 0.3, track - 0.3, 0.07, 0.07, 10, R, z));
    P.add('dark', new THREE.SphereGeometry(0.19, 12, 8).applyMatrix4(xf(0, R, z, 0, 0, 0, V(1, 0.9, 1.1))));
    for (const s of [-1, 1]) {
      P.add('dark', xTube(s * (track - 0.18), s * (track - 0.36), 0.12, 0.1, 12, R, z)); // hub reduction
      if (i === 0) {
        P.add('dark', box(0.09, 0.07, 1.25, s * 0.5, R + 0.2, z));
        P.add('dark', box(0.09, 0.05, 0.9, s * 0.5, R + 0.27, z));
      }
    }
    if (i === 0) P.add('dark', xTube(-track + 0.35, track - 0.35, 0.022, 0.022, 6, R - 0.05, z - 0.36));
  });
  const zb = (axles[1] + axles[2]) / 2;
  for (const s of [-1, 1]) {
    P.add('dark', box(0.1, 0.08, 1.5, s * 0.5, R + 0.18, zb));
    P.add('dark', box(0.1, 0.06, 1.05, s * 0.5, R + 0.26, zb));
    P.add('dark', xTube(s * 0.38, s * 0.6, 0.11, 0.11, 12, R + 0.3, zb));
  }
  P.add('dark', zTube(axles[0] + 0.25, axles[1] - 0.25, 0.045, 0.045, 8, 0, R + 0.1));
  P.add('dark', zTube(axles[1] + 0.25, axles[2] - 0.25, 0.045, 0.045, 8, 0, R + 0.1));
  P.add('dark', box(0.5, 0.42, 0.62, 0, 0.95, axles[1] - 1.2)); // transfer case
  // frame rails from the cab to the tail, cross members
  for (const s of [-1, 1]) P.add('dark', box(0.1, 0.28, F77.rear - F77.cab.zf - 0.5, s * 0.47, 1.06, (F77.rear + F77.cab.zf + 0.4) / 2));
  for (let z = F77.cab.zf + 0.6; z < F77.rear; z += 1.3) P.add('dark', box(0.94, 0.1, 0.1, 0, 1.06, z));
}

// Under the platform (photo 13): fuel tank, battery box, two air spheres and a third under them on the
// left, the exhaust on the right, black guards over the rear pair, the rear lamps and the tow hitch.
function underGear(P) {
  const { axles, R, track, deck } = F77;
  P.add('dark', rb(0.45, 0.32, 0.55, 0.05, -0.95, 1.08, -1.55)); // fuel tank
  P.add('steel', box(0.05, 0.34, 0.04, -1.19, 1.08, -1.75));
  P.add('dark', rb(0.45, 0.32, 0.65, 0.03, -0.95, 1.05, -0.92)); // battery box
  // air spheres, three on each side (photos 12, 13)
  for (const s of [-1, 1]) for (const [z, y] of [[-0.45, 1.06], [-0.24, 1.06], [-0.34, 0.86]]) P.add('dark', new THREE.SphereGeometry(0.1, 12, 8).translate(s * 0.98, y, z + (s > 0 ? 0.55 : 0)));
  P.add('dark', rb(0.45, 0.28, 0.75, 0.03, -0.95, 1.12, 1.9)); // box behind the rear wheels' front
  P.add('dark', zTube(-1.6, -0.2, 0.09, 0.09, 10, 0.85, 0.95)); // exhaust
  P.add('dark', rb(0.4, 0.3, 0.6, 0.06, 0.95, 1.0, -0.9)); // silencer
  for (const s of [-1, 1]) {
    P.add('dark', box(0.5, 0.04, axles[2] - axles[1] + 1.4, s * track, R + 0.72, (axles[1] + axles[2]) / 2)); // flat guard over the pair
    for (const z of [axles[1] - 0.6, axles[2] + 0.6]) P.add('dark', box(0.05, 0.25, 0.05, s * (track - 0.1), R + 0.6, z));
    P.add('rubber', box(0.5, 0.62, 0.025, s * track, R + 0.32, axles[2] + 0.72)); // black flap behind the rear wheels
    P.add('dark', box(0.08, 0.5, 0.06, s * 1.15, deck - 0.45, F77.rear - 0.15)); // the rear lamp brackets
    P.add('dark', box(0.32, 0.12, 0.06, s * 0.95, deck - 0.6, F77.rear - 0.08));
    P.add('red', box(0.1, 0.07, 0.01, s * 0.88, deck - 0.6, F77.rear - 0.045), { tint: 0xd03020 });
    P.add('amber', box(0.08, 0.07, 0.01, s * 1.02, deck - 0.6, F77.rear - 0.045));
  }
  P.add('dark', box(2.2, 0.14, 0.12, 0, 0.82, F77.rear - 0.1)); // rear beam
  P.add('dark', box(0.3, 0.2, 0.18, 0, 0.8, F77.rear - 0.02));
  P.add('steel', yTube(0.68, 0.92, 0.03, 0.03, 8, 0, F77.rear + 0.04));
  P.add('white', box(0.48, 0.11, 0.01, -0.62, 0.84, F77.rear - 0.035), { tint: 0xd8d8d0 });
  P.add('steel', rod(V(-0.92, 0.75, F77.rear - 0.04), V(-0.92, 0.3, F77.rear - 0.04), 0.008, 4)); // the hanging chain (photo 12)
}

// Behind the cab: the spare wheel standing across the frame on the left (photo 13: its tread faces the
// side), the air filter and the intake pipe up the cab's left rear corner with its mushroom cap.
function behindCab(P) {
  const z = (F77.cab.zr + F77.bed.z0) / 2, sx = -0.55, sy = 1.72;
  const turn = xf(sx, sy, z, 0, Math.PI / 2, 0);
  P.add('tyre', kamazTyre(F77.R, F77.W, 14, 48).applyMatrix4(turn));
  const H = new Parts(P.mats);
  kamazHub(H, 0, 0, 0, 1, F77.R, F77.W);
  for (const key of ['dark', 'steel']) P.add(key, H.merged(key).applyMatrix4(turn));
  P.add('dark', box(1.0, 0.08, 0.4, sx, 1.06, z));
  for (const s of [-1, 1]) P.add('dark', rod(V(sx + s * 0.45, 1.06, z), V(sx + s * 0.3, sy + 0.4, z + 0.2), 0.025, 5));
  const ix = -(F77.cab.hw + 0.09), iz = F77.cab.zr - 0.22;
  P.add('dark', zTube(F77.cab.zr - 0.1, F77.cab.zr + 0.3, 0.18, 0.18, 14, -1.02, 1.6)); // air filter
  P.add('dark', rod(V(ix, 1.75, iz), V(-1.02, 1.62, F77.cab.zr + 0.05), 0.06, 8));
  P.add('dark', yTube(1.55, 2.92, 0.065, 0.065, 8, ix, iz)); // intake pipe up the cab's corner
  for (const y of [1.9, 2.5]) P.add('dark', box(0.1, 0.04, 0.12, ix + 0.05, y, iz));
  P.add('dark', yTube(2.92, 2.97, 0.13, 0.13, 14, ix, iz)); // its cap
  P.add('dark', yTube(2.97, 3.03, 0.13, 0.06, 14, ix, iz));
  P.add('dark', rb(0.5, 0.4, 0.4, 0.03, 0.75, 1.55, z)); // the battery box on the right
}

// The platform with its side beams (a row of round holes, stake pockets), the front rack of ammunition
// boxes under its tubular frame, the cradles of the two container stacks, the tail racks of ammunition
// boxes in expanded-metal frames.
function platform(rig, P) {
  const { deck } = F77, { z0, z1, hw } = F77.bed, len = z1 - z0, zc = (z0 + z1) / 2;
  P.add('camo', box(hw * 2, 0.06, len, 0, deck - 0.03, zc));
  for (const s of [-1, 1]) {
    P.add('camo', box(0.06, 0.18, len, s * (hw - 0.03), deck - 0.06, zc));
    for (let z = z0 + 0.3; z < z1; z += 0.42) P.add('dark', xTube(s * hw, s * (hw + 0.005), 0.025, 0.025, 8, deck - 0.06, z));
    for (let z = z0 + 0.5; z < z1; z += 1.2) P.add('dark', box(0.05, 0.12, 0.08, s * (hw + 0.02), deck - 0.06, z));
  }
  P.add('camo', box(hw * 2, 0.18, 0.06, 0, deck - 0.06, z1 - 0.03));
  P.add('camo', box(hw * 2, 0.18, 0.06, 0, deck - 0.06, z0 + 0.03));
  P.add('dark', box(1.2, 0.14, len, 0, deck - 0.15, zc)); // subframe
  // the front rack: two ribbed cabinets of ammunition boxes, a hinged tube frame over them
  const fz0 = z0 + 0.12, fz1 = 0.72, fy = deck + 0.72;
  for (const [a, b] of [[fz0, (fz0 + fz1) / 2 - 0.02], [(fz0 + fz1) / 2 + 0.02, fz1]]) {
    P.add('camo', box(2.3, fy - deck, b - a, 0, (fy + deck) / 2, (a + b) / 2));
    for (const s of [-1, 1]) for (let z = a + 0.12; z < b - 0.05; z += 0.18) P.add('camo', box(0.03, fy - deck - 0.08, 0.05, s * 1.165, (fy + deck) / 2, z));
    P.add('dark', box(2.32, 0.03, b - a + 0.02, 0, fy, (a + b) / 2));
  }
  // its tube frame: hoops rising to carry the crane beam in travel, braces, the lid frame
  const hoop = (z, h) => {
    for (const s of [-1, 1]) P.add('paint', rod(V(s * 1.1, deck, z), V(s * 1.0, h - 0.12, z), 0.025, 6));
    for (const s of [-1, 1]) P.add('paint', rod(V(s * 1.0, h - 0.12, z), V(s * 0.75, h, z), 0.025, 6));
    P.add('paint', rod(V(-0.75, h, z), V(0.75, h, z), 0.025, 6));
  };
  hoop(fz0 + 0.12, F77.beam.y - 0.1);
  hoop(fz0 + 0.38, F77.beam.y - 0.1);
  for (const s of [-1, 1]) P.add('paint', rod(V(s * 0.75, F77.beam.y - 0.1, fz0 + 0.12), V(s * 0.75, F77.beam.y - 0.1, fz0 + 0.38), 0.02, 5));
  for (const s of [-1, 1]) P.add('paint', rod(V(s * 1.05, deck + 0.75, fz1 - 0.1), V(s * 0.8, deck + 1.3, fz0 + 0.5), 0.02, 5)); // diagonal braces
  P.add('paint', rod(V(-1.15, fy + 0.02, fz1), V(1.15, fy + 0.02, fz1), 0.02, 5));
  P.add('paint', rod(V(-0.9, deck + 0.95, fz1 + 0.05), V(0.9, deck + 0.5, fz1 + 1.0), 0.02, 5)); // the long diagonal over the stacks' front
  // the stacks' cradles: three frames of two posts with rubber saddles between the layers, the chains
  // that tie each stack down (open at the top, so the crane lifts the containers straight out)
  const { x: sx, y: rows } = F77.stack, zS = F77.stack.z;
  for (const z of [zS + CONT.z0 + 0.06, 1.17, 2.88]) for (const s of [-1, 1]) {
    for (const d of [-1, 1]) P.add('paint', box(0.05, rows[3] - deck + 0.14, 0.06, s * sx + d * 0.13, (rows[3] + deck) / 2 + 0.07, z));
    for (const y of rows) P.add('rubber', box(0.22, 0.025, 0.08, s * sx, y - CONT.r - 0.012, z));
    if (z > 1) P.add('dark', box(0.015, rows[3] - rows[0] + 0.2, 0.015, s * (sx + 0.15), (rows[3] + rows[0]) / 2, z + 0.04)); // chain
  }
  // tail racks: boxes in expanded-metal frames across the tail (photo 12: six frames, low)
  const tz0 = 3.35, tz1 = z1 - 0.06, ty = deck + 0.47;
  rig.anchors.boxes = [];
  for (let i = 0; i < 6; i++) {
    const x = -1.05 + i * 0.42;
    P.add('dark', box(0.36, ty - deck - 0.04, tz1 - tz0 - 0.04, x, (ty + deck) / 2, (tz0 + tz1) / 2)); // the boxes inside
    for (const d of [-1, 1]) P.add('paint', box(0.025, ty - deck, tz1 - tz0, x + d * 0.19, (ty + deck) / 2, (tz0 + tz1) / 2));
    for (const z of [tz0, tz1]) P.add('paint', box(0.4, ty - deck, 0.02, x, (ty + deck) / 2, z));
    rig.anchors.boxes.push(node(rig.root, 'box' + i, x, ty - 0.12, tz1));
  }
  // expanded metal: the radar lattice texture on the frames' faces (tail, the outer sides)
  const mesh = (w, h, x, y, z, ry) => {
    const g = plane(w, h, x, y, z, 0, ry, 0);
    scaleUV(g, w / 0.18, h / 0.18);
    P.add('array', g, { tint: new THREE.Color(2.0, 2.3, 1.7) });
  };
  for (let i = 0; i < 6; i++) mesh(0.36, ty - deck - 0.06, -1.05 + i * 0.42, (ty + deck) / 2, tz1 + 0.012, 0);
  for (const s of [-1, 1]) mesh(tz1 - tz0 - 0.04, ty - deck - 0.06, s * 1.27, (ty + deck) / 2, (tz0 + tz1) / 2, s * Math.PI / 2);
}

// ---------------------------------------------------------------- crane

// Column, head and beam (photos 12, 13). Built in the slew space (origin on the platform at the axis).
function crane(rig) {
  const { mats, root } = rig;
  const C = F77.crane, B = F77.beam, deck = F77.deck;
  const slew = pivotAt(rig, root, 'crane', C.x, deck, C.z);
  const S = new Parts(mats);
  S.add('camo', rb(0.42, 0.18, 0.42, 0.03, 0, 0.09, 0)); // the base on the platform
  S.add('camo', yTube(0.18, 1.0, 0.15, 0.15, 16, 0, 0)); // outer column
  S.add('dark', yTube(0.95, 1.02, 0.18, 0.18, 16, 0, 0));
  S.add('dark', box(0.08, 0.5, 0.08, 0.12, 0.6, 0.12)); // hose clamps, a cable run
  greyer(S.build(slew, { dirt: 0.25, y0: deck }));
  const col = pivotAt(rig, slew, 'craneColumn', 0, 0, 0);
  const K = new Parts(mats);
  const hy = B.y - deck; // the beam rail's height above the platform with the column down
  K.add('steel', yTube(0.6, 1.02, 0.12, 0.12, 14, 0, 0)); // the inner column, rising out of the outer
  K.add('camo', yTube(1.02, hy + 0.32, 0.12, 0.12, 14, 0, 0));
  // the head: a drum housing, motors sticking out to the rear and the sides, the slewing gear
  K.add('camo', yTube(hy + 0.32, hy + 0.42, 0.16, 0.12, 14, 0, 0));
  K.add('camo', rb(0.4, 0.28, 0.34, 0.04, 0, hy + 0.1, 0.12));
  K.add('dark', zTube(0.1, 0.62, 0.11, 0.11, 14, 0.0, hy + 0.12)); // winch drum and motor, rearward
  K.add('dark', zTube(0.62, 0.68, 0.08, 0.08, 12, 0.0, hy + 0.12));
  K.add('camo', xTube(-0.15, -0.5, 0.09, 0.09, 12, hy + 0.3, 0.2)); // drive motors
  K.add('camo', xTube(0.15, 0.42, 0.08, 0.08, 12, hy - 0.08, 0.25));
  K.add('dark', zTube(0.2, 0.55, 0.07, 0.07, 12, -0.32, hy - 0.12));
  for (const p of [[0.2, hy + 0.35, 0.3], [-0.25, hy - 0.2, 0.32]]) K.add('dark', rod(V(...p), V(p[0] * 0.5, hy - 0.4, 0.1), 0.02, 5)); // hoses
  // the beam: a channel rail from the head forward, the knee brace under its root, the mast and ties
  K.add('camo', box(0.11, 0.13, B.L + 0.2, 0, hy + 0.065, -(B.L - 0.2) / 2));
  K.add('dark', box(0.13, 0.02, B.L, 0, hy + 0.005, -B.L / 2 - 0.05)); // the trolley's running flanges
  K.add('camo', rod(V(0, hy - 0.4, -0.05), V(0, hy, -0.75), 0.05, 8));
  for (const s of [-1, 1]) K.add('camo', box(0.03, 0.4, 0.5, s * 0.07, hy - 0.05, -0.25, 0.6, 0, 0));
  // the light truss on the beam: posts and a rail carrying the cables (photo 13)
  for (let z = -0.45; z > -B.L; z -= 0.45) K.add('paint', yTube(hy + 0.13, hy + 0.27, 0.01, 0.01, 4, 0, z));
  K.add('paint', zTube(-0.3, -B.L + 0.1, 0.012, 0.012, 5, 0, hy + 0.27));
  K.add('paint', rod(V(0, hy + 0.42, -0.1), V(0, hy + 0.27, -0.75), 0.015, 5));
  K.add('paint', box(0.05, 0.12, 0.05, 0, hy - 0.06, -B.L + 0.05)); // the stop at the tip
  K.add('dark', rod(V(0, hy + 0.3, -0.3), V(0, hy + 0.2, -2.4), 0.008, 4)); // the cable along the beam
  greyer(K.build(col, { dirt: 0.1, y0: deck }));
  const tr = pivotAt(rig, col, 'craneTrolley', 0, hy, -1.5);
  const T = new Parts(mats);
  T.add('dark', box(0.2, 0.1, 0.24, 0, -0.06, 0));
  for (const z of [-0.08, 0.08]) T.add('dark', xTube(-0.11, 0.11, 0.035, 0.035, 8, -0.02, z));
  greyer(T.build(tr, { dirt: 0, y0: 3 }));
  const cable = new THREE.Group();
  tr.add(cable);
  const Cb = new Parts(mats);
  for (const x of [-0.035, 0.035]) Cb.add('dark', yTube(-1, 0, 0.008, 0.008, 4, x, 0));
  Cb.build(cable, { dirt: 0, y0: 3, shadow: false });
  const hk = pivotAt(rig, tr, 'craneHook', 0, -0.2, 0);
  const rt = pivotAt(rig, hk, 'craneRotator', 0, 0, 0);
  // the grab (photo 13 shows a hook with a small frame; the rest is reconstructed): a hook block, a bar
  // along the load, cross heads at its ends with a leg down each side ending in a claw that reaches
  // under the load from that side, so it takes one container, a pair side by side, two one above the
  // other or a block of four
  const G = new Parts(mats);
  G.add('dark', box(0.1, 0.1, 0.1, 0, -0.05, 0));
  G.add('paint', box(0.05, 0.05, 0.62, 0, -0.125, 0));
  for (const z of [-0.26, 0.26]) {
    G.add('paint', box(0.52, 0.04, 0.05, 0, -0.13, z));
    for (const s of [-1, 1]) {
      G.add('paint', box(0.035, 0.48, 0.045, s * 0.245, -0.37, z));
      G.add('paint', box(0.13, 0.025, 0.05, s * 0.19, -0.6125, z)); // the claw
    }
  }
  greyer(G.build(rt, { dirt: 0, y0: 3 }));
  rig.anchors.craneLoad = node(rt, 'craneLoad', 0, -0.6, 0);
  const st = { slew: 0, lift: 0, reach: 1.5, cable: 0.1, rotate: 0 };
  rig.crane = st;
  rig.setCrane = (o = {}) => {
    Object.assign(st, o);
    slew.rotation.y = st.slew;
    col.position.y = Math.max(0, Math.min(F77.lift, st.lift));
    tr.position.z = -Math.max(0.45, Math.min(B.L - 0.15, st.reach));
    const c = Math.max(0.02, st.cable);
    hk.position.y = -0.1 - c;
    cable.scale.y = c + 0.02;
    rt.rotation.y = st.rotate;
  };
  // the claws hang `hang` under the rail with the cable in; the column rises as far as needed to keep
  // at least 0.05 m of cable, and at least minLift (to carry the beam over something)
  const hang = 0.1 + 0.6;
  rig.solveCrane = (p, yaw, out = {}, minLift = 0) => {
    const dx = p.x - C.x, dz = p.z - C.z;
    out.slew = Math.atan2(-dx, -dz);
    const r = Math.hypot(dx, dz);
    out.reach = Math.max(0.45, Math.min(B.L - 0.15, r));
    const need = p.y + hang + 0.05 - B.y;
    out.lift = Math.max(0, Math.min(F77.lift, Math.max(minLift, need)));
    out.cable = B.y + out.lift - hang - p.y;
    out.ok = r === out.reach && out.cable >= 0.02 - 1e-6;
    out.rotate = yaw - out.slew;
    return out;
  };
  rig.craneTravel = { slew: 0, lift: 0, reach: 2.75, cable: 0.02, rotate: 0 };
}

// ---------------------------------------------------------------- load

// The eight containers in their stacks, merged with the platform's parts (setLoaded takes one away).
function load(rig, P) {
  const spans = [];
  rig.anchors.cargo = [];
  const { x: sx, y: rows, z: zS } = F77.stack;
  for (let i = 0; i < 8; i++) {
    const s = i < 4 ? -1 : 1, y = rows[i % 4];
    const m = mark(P);
    const T = new Parts(P.mats);
    tunguskaContainer(T, 0, 0);
    T.add('canister', containerCover(0, 0), { tint: 0x7a7c70 });
    for (const [key, list] of T.lists) {
      if (!P.lists.has(key)) P.lists.set(key, []);
      for (const g of list) P.lists.get(key).push(g.applyMatrix4(xf(s * sx, y, zS)));
    }
    spans[i] = span(P, m);
    rig.anchors.cargo.push(node(rig.root, 'cargo' + i, s * sx, y, zS));
  }
  return spans;
}

// ---------------------------------------------------------------- assembly

export function build2F77M() {
  const rig = newRig('green');
  rig.mats = tunguskaMats();
  rig.P = new Parts(rig.mats);
  const { P, root, mats } = rig;
  cab4310(P);
  runningGear(P);
  underGear(P);
  behindCab(P);
  platform(rig, P);
  const spans = load(rig, P);
  const meshes = greyer(P.build(root, { dirt: 0.5 }));
  const cargo = swapper(meshes, spans);
  rig.setLoaded = (i, on) => cargo.set(i, on);
  rig.slots = [];
  crane(rig);
  rig.setCrane(rig.craneTravel);
  // the cab doors over the seams on the shell: panel, window, handle
  const { zf, hw } = F77.cab, d0 = zf + 0.32, d1 = zf + 1.1;
  for (const s of [-1, 1]) {
    const dp = pivotAt(rig, root, s < 0 ? 'doorL' : 'doorR', s * (hw + 0.012), 0, d0);
    const D = new Parts(mats);
    D.add('camo', box(0.025, 1.33, d1 - d0 - 0.02, 0, 1.9, (d1 - d0) / 2));
    D.add('rubber', box(0.03, 0.52, d1 - d0 - 0.12, 0, 2.33, (d1 - d0) / 2 + 0.01));
    D.add('glass', box(0.035, 0.46, d1 - d0 - 0.18, 0, 2.33, (d1 - d0) / 2 + 0.01));
    D.add('steel', box(0.035, 0.03, 0.12, s * 0.015, 1.72, d1 - d0 - 0.14));
    greyer(D.build(dp, { dirt: 0.4 }));
  }
  const wheels = spinWheels(root, mats, F77.axles.flatMap((z, i) => [-1, 1].map((s) => ({ x: s * F77.track, y: F77.R, z, steer: i === 0 ? 1 : 0 }))), F77.R, (Q, R) => {
    Q.add('tyre', kamazTyre(R, F77.W));
    kamazHub(Q, 0, 0, 0, 1, R, F77.W);
  });
  rig.setWheels = wheels.set;
  rig.wheelR = F77.R;
  rig.axles = F77.axles;
  rig.anchors.eye = node(root, 'eye', 0, 2.2, 0);
  rig.anchors.cabDoorL = node(root, 'cabDoorL', -1.7, 0, zf + 0.9);
  rig.anchors.cabDoorR = node(root, 'cabDoorR', 1.7, 0, zf + 0.9);
  rig.anchors.operator = node(root, 'operator', 0.45, F77.deck, F77.crane.z + 0.15);
  hb(rig, -1.3, 0, F77.cab.bumper, 1.3, 3.0, F77.rear);
  return rig;
}
