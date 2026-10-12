import * as THREE from 'three';
import { V, xf, box, rbox, yTube, zTube, xTube, sphere, rod, lathe, sideProfile, frontProfile, addLamp, Parts } from '../kit.js';
import { newRig, node, pivotAt, hb } from '../rig.js';
import { rb } from './ural.js';
import { mudFlap, extinguisher, hose, ladder } from '../trucks.js';
import { spinWheels, heavyWheel } from './t22t6.js';

// 9T244 transloader of the Tor-M2 on the Ural-4320 6x6 (refs/tor/README.md section 7; photos
// tor_9t244_14 (front right, the crane folded over the cab), _15 (left side and the rear with the crane
// column), _16 (rear right) and tor_m2_06 (a reload: the truck backed up to the Tor's nose, a container
// hanging nose up from the crane and lowered into a cell)). The Ural-4320 (bonnet with the slatted
// grille, the broad flat wings with the head lamps in their fronts, the all-steel cab with its tubular
// roof rack, the big air cleaner on the right wing, a deep black bumper box with two tow hooks on top),
// a drop-side bed with perforated side panels and lockers under it, and behind the bed the crane's
// platform: the slewing pedestal and the tall box column at the rear left, the control cabinet beside it,
// a hose reel each side, stabilizer legs at the rear corners and a ladder at the right. The crane is a
// knuckle crane: the boom off the column's top, the jib with a telescopic inner section, rams on both, a
// sheave head at the tip and the hook on its cable. Dimensions from the published Ural-4320 figures
// (3.525 + 1.4 m wheelbase, 2.0 m track, 1.2 m tyres, cab roof 2.87 m) and the photos for the rest.
// The containers (9M338 rounds' transport-launch containers, 3.0 m) lie on the bed in a row of eight,
// top ends to the rear by the crane. Model space: front -Z, ground y = 0, origin at the middle axle's
// z + ... (see U.axles); the rear face of the platform at U.rear.
//
// Pivots and rig extras:
//   doorL, doorR    the cab doors (rotation.y; doorL opens negative, doorR positive, about 1.2).
//   crane           slew of the pedestal at (U.col.x, U.col.y0, U.col.z): rotation.y, 0 = the boom pointing
//                   forward (-Z), + turns it left.
//   craneBoom       the boom's luff at the column top: rotation.x, + raises the knuckle.
//   craneJib        the jib's angle at the knuckle relative to the boom: rotation.x (0 straight on, - folds
//                   it down).
//   craneExt        the jib's inner section: position.z = -extension (0 .. U.jib.ext).
//   craneHead       the sheave head at the tip (kept level by setCrane, do not set).
//   anchors.craneHook  the hook's eye under the head; position.y = -cable (setCrane `cable`). A container
//                   hanging from it: its top eye at the anchor, axis straight down (identity transform
//                   in the anchor hangs it plumb, see CONTAINER).
//   setCrane({ slew, boom, jib, ext, cable })  poses the crane (head levelled, rams follow).
//   solveCrane(p, out, cable)  slew, boom, jib, ext that put the hook at p (model space) with that much
//                   cable; elbow up (the knuckle above the line to the tip); out.ok false out of reach.
//   craneTravel     the travel pose (boom forward over the bed, the jib folded down to its front).
//   setOutriggers(v)  0 stowed .. 1 the rear stabilizer feet down on the ground.
//   setWheels(roll, steer)  roll in metres; steer the front axle (rad, + = left).
//   anchors.cargo[i]  (8) container places on the bed: the top end's eye, the container's frame (its
//                   axis along the frame's -Y, here laid along -Z: rotation.x = PI / 2 maps it).
//   setLoaded(i, on)  shows container i on the bed.
//   anchors.eye, anchors.cabDoorL/R (on the ground by each door), anchors.operator (the crane operator's
//                   spot on the ground at the rear left, by the controls).

export const U = {
  R: 0.6, W: 0.5, track: 1.0,
  axles: [-2.9, 0.625, 2.025],
  bumper: { z: -4.5, d: 0.55, y0: 0.62, y1: 1.15, w: 2.55 },
  bonnet: { zf: -4.0, zr: -2.25, top: 1.98, hw: 0.64 },
  wing: { zf: -4.05, zr: -2.12, top: 1.62, out: 1.27 },
  cab: { zf: -2.25, zr: -0.75, y0: 1.3, H: 2.72, hw: 1.15 },
  bed: { z0: -0.5, z1: 3.2, floor: 1.8, hw: 1.2, side: 0.55 },
  deck: { z1: 4.0, y: 1.45 }, // the crane platform behind the bed
  rear: 4.15,
  col: { x: -0.3, z: 3.8, y0: 1.85, h: 1.2 }, // slew pedestal top, column to the boom pin
  boom: 1.6, // tor_9t244_14/16: a short boom off the column, the long jib folded level forward over the bed
  jib: { L: 2.3, ext: 3.6 }, // the jib's outer section, the two inner sections' travel together
};
// a container: 3.0 m long, 0.25 dia, the top flange and eye above (as the Tor rig's cell caps)
export const CONTAINER = { L: 3.0, r: 0.125, top: 0.1 }; // top: the eye's top above the flange's foot
const CARGO_Y = U.bed.floor + 0.03 + CONTAINER.r, CARGO_TOP = 2.9; // axis height, z of the flange's foot

// ---------------------------------------------------------------- cab and bonnet

function front(P, rig) {
  const { bumper: bp, bonnet: bn, wing: wg, cab } = U;
  // bumper box: deep and black, plates and two big tow hooks on its top, the plate
  const by = (bp.y0 + bp.y1) / 2, bz = bp.z + bp.d / 2;
  P.add('dark', rb(bp.w, bp.y1 - bp.y0, bp.d, 0.04, 0, by, bz));
  P.add('dark', sideProfile([[bp.z + 0.02, bp.y0], [bp.z + 0.25, bp.y0 - 0.12], [bp.z + bp.d, bp.y0 - 0.12], [bp.z + bp.d, bp.y0]], bp.w - 0.3)); // chamfer under it
  for (const s of [-1, 1]) {
    P.add('dark', box(0.5, 0.03, 0.34, s * 0.62, bp.y1 + 0.015, bz)); // plates
    // tow hook: a ring segment standing on the top
    const hk = new THREE.TorusGeometry(0.11, 0.035, 6, 12, Math.PI * 1.3).applyMatrix4(xf(s * 0.42, bp.y1 + 0.12, bp.z + 0.12, 0, Math.PI / 2, -0.2));
    P.add('dark', hk);
    P.add('dark', box(0.12, 0.08, 0.2, s * 0.42, bp.y1 + 0.04, bp.z + 0.14));
  }
  P.add('dark', box(0.52, 0.12, 0.02, 0.0, by, bp.z - 0.005));
  P.add('white', box(0.48, 0.1, 0.01, 0.0, by, bp.z - 0.012), { tint: 0x8a8a8a });
  // bonnet: a rounded top over vertical sides, the front face with the recessed slatted grille
  const { zf, zr, top, hw } = bn;
  const sec = [];
  for (let i = 0; i <= 8; i++) { const a = (i / 8) * Math.PI; sec.push([Math.cos(a) * hw, wg.top - 0.02 + (top - wg.top) * Math.min(1, Math.sin(a) * 1.6)]); }
  sec.unshift([hw, wg.top - 0.3]); sec.push([-hw, wg.top - 0.3]);
  P.add('camo', frontProfile(sec.reverse(), zf, zr));
  P.add('dark', box(0.74, 0.5, 0.03, 0, wg.top + 0.2, zf - 0.005)); // grille recess
  for (let i = 0; i < 8; i++) P.add('camo', box(0.05, 0.48, 0.07, -0.315 + i * 0.09, wg.top + 0.2, zf - 0.02));
  P.add('camo', box(0.8, 0.05, 0.08, 0, wg.top + 0.46, zf - 0.02));
  P.add('steel', box(0.16, 0.16, 0.02, 0.48, top - 0.12, zf + 0.45, 0, Math.PI / 2, Math.PI / 4)); // the emblem on the side
  P.add('dark', box(0.9, 0.02, 0.9, 0, top + 0.005, zf + 0.9)); // bonnet seam
  // wings: flat tops at lamp height, the outer edge turned down, sweeping down behind the wheel to the step
  for (const s of [-1, 1]) {
    const x0 = hw - 0.02, x1 = wg.out, cx = s * (x0 + x1) / 2, w = x1 - x0;
    const prof = [[wg.zf, 1.05], [wg.zf, wg.top - 0.04], [wg.zf + 0.06, wg.top], [wg.zr - 0.35, wg.top], [wg.zr, wg.top - 0.18], [wg.zr + 0.05, 0.95], [wg.zr - 0.25, 0.95], [-2.9 + 0.3, 1.32], [-2.9 - 0.3, 1.32], [wg.zf + 0.45, 1.05]];
    P.add('camo', sideProfile(prof, w, 0.03).translate(cx, 0, 0));
    // the arch under it: a dark liner
    P.add('dark', sideProfile([[-3.6, 1.04], [-3.3, 1.28], [-2.5, 1.28], [-2.25, 1.0], [-2.3, 0.98], [-2.55, 1.22], [-3.25, 1.22], [-3.55, 1.0]], w - 0.1).translate(cx, 0, 0));
    // head lamp in the wing's front by the grille, the turn lamp above it, side marker
    const lx = s * (hw + 0.22);
    P.add('dark', zTube(wg.zf - 0.05, wg.zf + 0.02, 0.12, 0.12, 16, lx, wg.top - 0.26));
    P.add('lens', zTube(wg.zf - 0.06, wg.zf - 0.05, 0.1, 0.1, 16, lx, wg.top - 0.26));
    addLamp(P, lx, wg.top - 0.05, wg.zf - 0.02, 0.07, 0.05, 0.05, 'amber');
    P.add('amber', box(0.02, 0.05, 0.05, s * (x1 + 0.005), wg.top - 0.06, wg.zf + 0.4));
  }
  // air cleaner on the right wing by the cab: a big drum along the truck, its elbow into the bonnet, the
  // mushroom cap of the intake on top; a box on the left wing
  P.add('dark', zTube(-2.85, -2.2, 0.25, 0.25, 18, 0.95, wg.top + 0.27));
  P.add('dark', zTube(-2.92, -2.85, 0.2, 0.25, 18, 0.95, wg.top + 0.27));
  P.add('dark', rod(V(0.95, wg.top + 0.27, -2.92), V(0.8, wg.top + 0.3, -3.15), 0.11, 10));
  P.add('dark', rod(V(0.8, wg.top + 0.3, -3.15), V(hw - 0.02, wg.top + 0.3, -3.2), 0.11, 10));
  P.add('dark', yTube(wg.top + 0.5, wg.top + 0.66, 0.08, 0.08, 10, 0.95, -2.38));
  P.add('dark', sphere(0.15, 0.95, wg.top + 0.7, -2.38, 1, 0.55, 1, 12));
  for (const z of [-2.75, -2.3]) P.add('steel', zTube(z - 0.02, z + 0.02, 0.26, 0.26, 18, 0.95, wg.top + 0.27));
  P.add('camo', rb(0.4, 0.28, 0.5, 0.03, -0.95, wg.top + 0.14, -3.1));
  // the cab: a tall box with the two-pane screen, doors (pivots), a small rear window, the roof rack
  const { zf: cz0, zr: cz1, y0, H, hw: chw } = cab, g0 = 2.12, g1 = 2.58;
  const prof = [[cz0, y0], [cz0, g0 - 0.04], [cz0 + 0.08, g1], [cz0 + 0.14, H - 0.04], [cz0 + 0.24, H], [cz1 - 0.08, H], [cz1, H - 0.08], [cz1, y0]];
  P.add('camo', sideProfile(prof, chw * 2, 0.04));
  const tilt = Math.atan2(0.08, g1 - g0);
  for (const s of [-1, 1]) {
    P.add('glass', box(1.0, g1 - g0 - 0.06, 0.03, s * 0.55, (g0 + g1) / 2, cz0 + 0.03, tilt));
    P.add('rubber', box(1.04, 0.035, 0.04, s * 0.55, g1 - 0.02, cz0 + 0.075, tilt));
    P.add('rubber', box(1.04, 0.035, 0.04, s * 0.55, g0 + 0.02, cz0 + 0.0, tilt));
    P.add('dark', box(0.02, 0.025, 0.55, s * 0.45, g1 - 0.1, cz0 + 0.02, Math.PI / 2 + tilt - 0.15, 0, 0));
    // sides: rear window, the door seams, steps, grab rail, mirror on its long arm
    const x = s * (chw + 0.004);
    P.add('glass', box(0.03, 0.42, 0.28, x, 2.4, cz1 - 0.25));
    P.add('dark', box(0.03, H - y0 - 0.2, 0.025, x, (y0 + H) / 2, cz0 + 1.02));
    P.add('dark', box(0.4, 0.04, 0.5, s * (chw - 0.12), y0 - 0.32, cz0 + 0.55));
    P.add('dark', box(0.4, 0.04, 0.5, s * (chw - 0.12), y0 - 0.66, cz0 + 0.55));
    P.add('steel', rod(V(s * (chw + 0.06), y0 + 0.25, cz0 + 1.12), V(s * (chw + 0.06), H - 0.4, cz0 + 1.12), 0.018, 5));
    P.add('dark', rod(V(x, g1 - 0.05, cz0 + 0.12), V(s * (chw + 0.2), g1 + 0.1, cz0 - 0.1), 0.02, 5));
    P.add('dark', rod(V(x, g0 + 0.02, cz0 + 0.12), V(s * (chw + 0.2), g0 + 0.2, cz0 - 0.1), 0.02, 5));
    P.add('dark', rb(0.08, 0.55, 0.3, 0.03, s * (chw + 0.23), g1 - 0.08, cz0 - 0.12));
    addLamp(P, x, y0 + 0.15, cz0 + 0.12, 0.02, 0.08, 0.12, 'amber');
  }
  P.add('camo', box(0.08, g1 - g0, 0.04, 0, (g0 + g1) / 2, cz0 + 0.04, tilt));
  P.add('dark', box(chw * 2 - 0.1, 0.04, 0.04, 0, g0 - 0.06, cz0 - 0.01)); // the cowl's vent
  // roof rack: a frame of tubes on posts with amber markers along its front, a box on it
  const rk = H + 0.22;
  for (const x of [-1.0, 1.0]) P.add('steel', zTube(cz0 + 0.2, cz1 - 0.05, 0.022, 0.022, 6, x, rk), { tint: 0x7c8566 });
  for (let z = cz0 + 0.2; z <= cz1 - 0.04; z += 0.38) P.add('steel', xTube(-1.0, 1.0, 0.018, 0.018, 6, rk, z), { tint: 0x7c8566 });
  for (const [x, z] of [[-0.95, cz0 + 0.25], [0.95, cz0 + 0.25], [-0.95, cz1 - 0.1], [0.95, cz1 - 0.1]]) P.add('steel', yTube(H, rk, 0.02, 0.02, 5, x, z), { tint: 0x7c8566 });
  for (const x of [-0.7, 0, 0.7]) P.add('amber', yTube(rk, rk + 0.08, 0.04, 0.035, 8, x, cz0 + 0.18));
  P.add('camo', rb(0.6, 0.26, 0.45, 0.03, -0.35, rk + 0.13, -1.25));
  P.add('dark', yTube(rk, rk + 1.8, 0.012, 0.006, 4, 0.8, cz1 - 0.2)); // whip
  extinguisher(P, chw + 0.08, y0 - 0.1, cz1 - 0.2);
  // the doors
  for (const s of [-1, 1]) {
    const d0 = cz0 + 0.06, d1 = cz0 + 1.02;
    const dp = pivotAt(rig, rig.root, s < 0 ? 'doorL' : 'doorR', s * (chw + 0.012), 0, d0);
    const D = new Parts(rig.mats);
    D.add('camo', box(0.05, H - y0 - 0.3, d1 - d0 - 0.02, 0, (y0 + H) / 2 - 0.1, (d1 - d0) / 2));
    D.add('glass', box(0.06, 0.52, d1 - d0 - 0.2, 0, 2.38, (d1 - d0) / 2 + 0.02));
    D.add('steel', rb(0.08, 0.05, 0.2, 0.02, s * 0.04, 2.0, d1 - d0 - 0.22));
    D.add('dark', box(0.06, 0.02, 0.6, 0, 1.85, (d1 - d0) / 2)); // the pressed crease
    D.build(dp, { dirt: 0.4 });
  }
}

// ---------------------------------------------------------------- chassis

function chassis(P) {
  const { R, W, track, axles } = U;
  for (const s of [-1, 1]) {
    P.add('dark', box(0.12, 0.3, 8.2, s * 0.5, 1.02, -0.05));
    P.add('dark', box(0.18, 0.03, 8.2, s * 0.48, 0.87, -0.05));
  }
  for (let z = -3.9; z < 4.0; z += 1.1) P.add('dark', box(0.95, 0.1, 0.1, 0, 1.02, z));
  axles.forEach((z, i) => {
    P.add('dark', xTube(-track + 0.42, track - 0.42, 0.085, 0.085, 10, R, z));
    P.add('dark', sphere(0.21, 0, R, z, 1, 0.9, 1.1, 10));
    for (const s of [-1, 1]) {
      P.add('dark', xTube(s * (track - W * 0.5 + 0.02), s * (track - W * 0.5 - 0.2), 0.14, 0.12, 12, R, z));
      P.add('dark', box(0.1, 0.08, 1.0, s * 0.55, R + 0.3, z)); // spring pack
    }
    if (i === 0) P.add('dark', xTube(-track + 0.4, track - 0.4, 0.025, 0.025, 6, R - 0.05, z - 0.36));
  });
  for (let i = 0; i < 2; i++) P.add('dark', zTube(axles[i] + 0.25, axles[i + 1] - 0.25, 0.05, 0.05, 8, 0, R + 0.08));
  P.add('dark', box(0.2, 0.15, 1.6, 0.0, R + 0.35, (axles[1] + axles[2]) / 2)); // the bogie's balancer
  // engine sump and gearbox under the bonnet and cab, fuel tank under the right door, the battery box
  // with its X-braced lid under the left
  P.add('dark', box(0.8, 0.5, 2.2, 0, 0.95, -3.0));
  P.add('camo', zTube(-1.95, -0.85, 0.27, 0.27, 16, 0.95, 0.98));
  for (const z of [-1.8, -1.0]) P.add('dark', box(0.08, 0.6, 0.06, 0.95, 0.98, z));
  P.add('camo', rb(0.45, 0.42, 0.9, 0.03, -0.95, 0.95, -1.5));
  P.add('dark', rod(V(-1.18, 0.78, -1.9), V(-1.18, 1.12, -1.1), 0.015, 4));
  P.add('dark', rod(V(-1.18, 1.12, -1.9), V(-1.18, 0.78, -1.1), 0.015, 4));
  // the spare wheel lying under the bed's front on the right (photo 14)
  P.add('tyre', new THREE.TorusGeometry(0.42, 0.14, 8, 22).applyMatrix4(xf(0.62, 1.07, -0.25, Math.PI / 2, 0, 0)));
  P.add('dark', yTube(0.98, 1.16, 0.3, 0.3, 14, 0.62, -0.25));
  // mudguards over the bogie (flat), flaps behind
  for (const s of [-1, 1]) {
    P.add('camo', box(W + 0.2, 0.05, axles[2] - axles[1] + 1.55, s * track, 1.4, (axles[1] + axles[2]) / 2));
    P.add('camo', box(0.04, 0.22, axles[2] - axles[1] + 1.55, s * (track + W / 2 + 0.08), 1.3, (axles[1] + axles[2]) / 2));
    mudFlap(P, s * track, 1.38, axles[2] + 0.78, W + 0.16, 0.6);
  }
}

// ---------------------------------------------------------------- the bed and the platform

// Drop-side bed: floor, the headboard, perforated side panels between posts (two rows of round holes,
// photo 14 and 15), the rear board, lockers under it, the containers' cradles.
function bed(P) {
  const { z0, z1, floor, hw, side } = U.bed, L = z1 - z0, cz = (z0 + z1) / 2, top = floor + side;
  P.add('camo', box(hw * 2, 0.08, L, 0, floor - 0.04, cz));
  for (const z of [z0 + 0.3, cz, z1 - 0.3]) P.add('dark', box(hw * 2, 0.12, 0.1, 0, floor - 0.14, z)); // cross bearers
  for (const s of [-1, 1]) P.add('dark', box(0.12, 0.14, L, s * 0.5, floor - 0.15, cz));
  // sides: six panels each, posts between, a rail along the top, the holes as dark discs
  const n = 6, pw = L / n;
  for (const s of [-1, 1]) {
    const x = s * hw;
    P.add('camo', box(0.04, side, L, x, floor + side / 2, cz));
    P.add('camo', box(0.07, 0.06, L + 0.04, x + s * 0.01, top - 0.03, cz));
    P.add('camo', box(0.07, 0.05, L + 0.04, x + s * 0.01, floor + 0.03, cz));
    for (let i = 0; i <= n; i++) P.add('camo', box(0.07, side, 0.06, x + s * 0.01, floor + side / 2, z0 + i * pw));
    for (let i = 0; i < n; i++) for (let r = 0; r < 2; r++) for (let k = 0; k < 4; k++) {
      const z = z0 + i * pw + pw * (0.17 + k * 0.22), y = floor + 0.17 + r * 0.22;
      P.add('dark', xTube(x - 0.025, x + s * 0.025, 0.055, 0.055, 10, y, z));
    }
    // hinges at the foot, the latches at the posts
    for (let i = 1; i < n; i++) P.add('steel', box(0.03, 0.1, 0.04, x + s * 0.05, top - 0.12, z0 + i * pw));
    // lockers under the side, their lids with handles
    for (const [a, b] of [[0.0, 0.85], [0.95, 1.8]]) {
      P.add('camo', rb(0.4, 0.5, b - a, 0.02, s * (hw - 0.22), floor - 0.45, (a + b) / 2));
      P.add('dark', box(0.02, 0.06, 0.2, s * (hw - 0.01), floor - 0.32, (a + b) / 2));
      P.add('white', box(0.01, 0.06, 0.18, s * (hw - 0.01), floor - 0.5, (a + b) / 2), { tint: 0xd0d0c8 });
    }
  }
  // headboard, a little higher than the sides
  P.add('camo', box(hw * 2, side + 0.15, 0.05, 0, floor + (side + 0.15) / 2, z0));
  P.add('camo', box(hw * 2 + 0.04, 0.05, 0.08, 0, floor + side + 0.15, z0));
  // the rear board
  P.add('camo', box(hw * 2, side, 0.05, 0, floor + side / 2, z1));
  // cradles: two cross beams with a saddle per container
  for (const z of [0.55, 2.45]) {
    P.add('dark', box(hw * 2 - 0.1, 0.05, 0.14, 0, floor + 0.025, z));
    for (let i = 0; i < 8; i++) P.add('dark', box(0.2, 0.04, 0.14, cargoX(i), floor + 0.06, z));
  }
}
const cargoX = (i) => -0.98 + i * 0.28;

// The platform behind the bed: its deck, the rear beam with its bolts, the lamps under it, the slewing
// pedestal, the control cabinet with its hoses, the hose reels, the ladder, the stabilizer housings.
function platform(P) {
  const { z1: bz } = U.bed, { z1, y } = U.deck, zr = U.rear;
  P.add('dark', box(2.3, 0.05, z1 - bz, 0, y - 0.025, (bz + z1) / 2)); // chequer deck
  P.add('camo', box(2.5, 0.22, 0.2, 0, y - 0.15, zr - 0.1)); // the rear beam
  for (let x = -1.0; x <= 1.0; x += 0.25) P.add('dark', yTube(y - 0.08, y - 0.03, 0.02, 0.02, 6, x, zr - 0.0)); // bolts
  P.add('camo', box(2.3, 0.2, z1 - bz, 0, y - 0.15, (bz + z1) / 2));
  for (const s of [-1, 1]) {
    addLamp(P, s * 0.85, 0.95, zr - 0.15, 0.2, 0.1, 0.06, 'red');
    addLamp(P, s * 0.6, 0.95, zr - 0.15, 0.1, 0.1, 0.06, 'amber');
    P.add('dark', box(0.06, 0.4, 0.06, s * 0.72, 1.12, zr - 0.2));
  }
  P.add('dark', box(0.5, 0.12, 0.02, 0.0, 0.95, zr - 0.13));
  P.add('white', box(0.46, 0.1, 0.01, 0.0, 0.95, zr - 0.12), { tint: 0x8a8a8a });
  // the slewing pedestal: a big drum on the deck at the rear left
  const { x: cx, z: czc, y0 } = U.col;
  P.add('camo', yTube(y, y0 - 0.12, 0.36, 0.32, 20, cx, czc));
  P.add('dark', yTube(y0 - 0.12, y0, 0.4, 0.4, 20, cx, czc));
  // the control cabinet at the rear right of the column, a gauge and levers, the hoses down to it
  P.add('camo', rb(0.56, 0.7, 0.42, 0.03, 0.6, y + 0.35, 3.62));
  P.add('camo', rb(0.46, 0.36, 0.34, 0.03, 0.6, y + 0.88, 3.6));
  P.add('dark', zTube(3.41, 3.39, 0.06, 0.06, 12, 0.72, y + 0.95));
  P.add('white', zTube(3.415, 3.41, 0.05, 0.05, 12, 0.72, y + 0.95), { tint: 0xd8d8d0 });
  for (let i = 0; i < 4; i++) P.add('dark', rod(V(0.45 + i * 0.09, y + 0.52, 3.42), V(0.45 + i * 0.09, y + 0.66, 3.32), 0.012, 4));
  // hose reels at the rear of the bed, either side
  for (const s of [-1, 1]) {
    const x = s * (U.bed.hw + 0.1), z = 3.35, yy = 2.0;
    P.add('camo', xTube(x - s * 0.04, x + s * 0.04, 0.32, 0.32, 18, yy, z));
    P.add('dark', xTube(x - s * 0.15, x - s * 0.04, 0.18, 0.18, 14, yy, z));
    for (let k = 0; k < 4; k++) { const a = (k / 4) * Math.PI; P.add('dark', box(0.02, 0.6, 0.03, x + s * 0.05, yy, z, a)); }
    P.add('camo', box(0.06, 0.6, 0.08, x - s * 0.02, yy - 0.35, z));
  }
  // the ladder at the rear right, the stabilizer housings at the rear corners
  ladder(P, 1.0, zr + 0.03, 0.35, y, 0.32, 'camo');
  for (const s of [-1, 1]) {
    P.add('camo', box(0.24, 0.5, 0.24, s * 1.1, y - 0.3, 3.45));
    P.add('dark', box(0.28, 0.06, 0.28, s * 1.1, y - 0.05, 3.45));
  }
}

// ---------------------------------------------------------------- the crane

function crane(rig) {
  const { mats, root } = rig;
  const { x: cx, z: cz, y0, h } = U.col, { L: jl, ext: EXT } = U.jib, BL = U.boom;
  const slew = pivotAt(rig, root, 'crane', cx, y0, cz);
  const S = new Parts(mats);
  S.add('camo', yTube(0, 0.1, 0.36, 0.36, 20)); // slewing ring
  S.add('camo', box(0.34, h + 0.1, 0.34, 0, (h + 0.1) / 2, 0)); // the column
  S.add('camo', box(0.42, 0.42, 0.42, 0, h, 0)); // its head
  for (const s of [-1, 1]) S.add('dark', box(0.05, 0.36, 0.3, s * 0.24, h, -0.08)); // the boom's pin cheeks
  S.add('dark', xTube(-0.28, 0.28, 0.07, 0.07, 10, h, -0.08));
  S.add('dark', box(0.2, 0.24, 0.18, 0, h * 0.42, -0.25)); // ram lug
  // the hydraulic and electric lines bundled up the column, a lamp in a wire guard on top
  for (const dx of [-0.12, -0.06, 0.06, 0.12]) S.add('rubber', yTube(0.15, h - 0.2, 0.018, 0.018, 5, dx, 0.2));
  S.add('cloth', box(0.26, h - 0.5, 0.08, 0, h / 2, 0.24), { tint: 0x9a9a8a }); // the sleeve over them
  S.add('dark', yTube(h + 0.21, h + 0.33, 0.1, 0.1, 10, 0.1, 0.1));
  S.add('lens', sphere(0.08, 0.1, h + 0.38, 0.06, 1, 1, 0.7, 10));
  for (let k = 0; k < 6; k++) { const a = (k / 6) * Math.PI * 2; S.add('dark', rod(V(0.1 + Math.cos(a) * 0.12, h + 0.3, 0.1 + Math.sin(a) * 0.12), V(0.1 + Math.cos(a) * 0.12, h + 0.48, 0.1 + Math.sin(a) * 0.12), 0.008, 3)); }
  S.build(slew, { dirt: 0.3, y0 });
  // the boom: a box beam along -Z from the pin, the jib ram's lug on top
  const bm = pivotAt(rig, slew, 'craneBoom', 0, h, -0.08);
  const B = new Parts(mats);
  B.add('camo', box(0.26, 0.3, BL + 0.2, 0, 0, -BL / 2 + 0.05));
  B.add('dark', xTube(-0.2, 0.2, 0.09, 0.09, 12, 0, -BL)); // knuckle pin
  B.add('dark', box(0.2, 0.14, 0.2, 0, -0.22, -0.9)); // the boom ram's lug under it
  B.add('dark', box(0.2, 0.18, 0.22, 0, 0.24, -BL + 1.25)); // the jib ram's lug on top
  for (const s of [-1, 1]) B.add('rubber', zTube(0.1, -BL + 0.2, 0.02, 0.02, 5, s * 0.16, 0.08));
  B.add('white', box(0.005, 0.08, 0.5, 0.133, 0.0, -0.8), { tint: 0xb8b8b0 });
  B.build(bm, { dirt: 0.1, y0: y0 + h });
  // the jib at the knuckle: the outer section, a lever above the pin for its ram, the inner section
  const jb = pivotAt(rig, bm, 'craneJib', 0, 0, -BL);
  const J = new Parts(mats);
  J.add('camo', box(0.22, 0.26, jl, 0, 0, -jl / 2 + 0.1));
  J.add('camo', box(0.18, 0.4, 0.22, 0, 0.18, 0.05)); // lever
  J.add('dark', box(0.23, 0.2, 0.03, 0, 0, -jl + 0.1));
  J.build(jb, { dirt: 0.05, y0: y0 + h });
  // two inner sections: the middle one slides out half the extension, the inner one half again on it
  const ex = pivotAt(rig, jb, 'craneExt', 0, 0, 0);
  const E = new Parts(mats);
  E.add('camo', box(0.17, 0.2, jl - 0.1, 0, 0, -jl / 2 - 0.02));
  E.add('dark', box(0.18, 0.15, 0.03, 0, 0, -jl + 0.06));
  E.build(ex, { dirt: 0.05, y0: y0 + h });
  const ex2 = new THREE.Group();
  ex2.name = 'craneExt2';
  ex.add(ex2);
  const E2 = new Parts(mats);
  E2.add('camo', box(0.13, 0.15, jl - 0.05, 0, 0, -jl / 2 + 0.02));
  E2.build(ex2, { dirt: 0.05, y0: y0 + h });
  // the sheave head at the inner section's tip, level; the hook on its cable
  const hd = pivotAt(rig, ex2, 'craneHead', 0, 0, -jl - 0.05);
  const Hd = new Parts(mats);
  Hd.add('camo', box(0.2, 0.22, 0.24, 0, 0, 0));
  Hd.add('dark', xTube(-0.07, 0.07, 0.11, 0.11, 14, -0.08, 0)); // sheave
  Hd.build(hd, { dirt: 0, y0: 5 });
  const cable = new THREE.Group();
  hd.add(cable);
  const C = new Parts(mats);
  C.add('dark', yTube(-1, 0, 0.012, 0.012, 4, 0, 0));
  C.build(cable, { dirt: 0, y0: 5 });
  const hook = node(hd, 'craneHook', 0, -0.6, 0);
  const K = new Parts(mats);
  K.add('dark', box(0.12, 0.16, 0.08, 0, 0.13, 0)); // the block
  K.add('steel', yTube(0.03, 0.05, 0.04, 0.04, 8, 0, 0)); // swivel
  K.add('steel', new THREE.TorusGeometry(0.045, 0.012, 5, 10, Math.PI * 1.4).applyMatrix4(xf(0, -0.02, 0, 0, 0, Math.PI * 0.8)));
  K.build(hook, { dirt: 0, y0: 4 });
  rig.anchors.craneHook = hook;
  // rams: boom ram from the column's lug to the boom's underside, jib ram from the boom's top to the lever
  const mkRam = (parent, L0, r0, r1) => {
    const g = new THREE.Group(), rr = new THREE.Group();
    parent.add(g, rr);
    const Pb = new Parts(mats), Pr = new Parts(mats);
    Pb.add('camo', zTube(0, -L0, r0, r0, 12, 0, 0));
    Pr.add('steel', zTube(0, -L0 - 0.1, r1, r1, 10, 0, 0));
    Pb.build(g, { dirt: 0.1, y0: 4 });
    Pr.build(rr, { dirt: 0, y0: 4 });
    return { g, rr, L0 };
  };
  const ramA = mkRam(slew, 0.9, 0.1, 0.06), ramB = mkRam(bm, 1.0, 0.085, 0.05);
  const A0 = V(0, h * 0.42, -0.25), A1 = V(0, -0.22, -0.9); // boom ram: column (slew space), boom (boom space)
  const B0 = V(0, 0.24, -BL + 1.25), B1 = V(0, 0.38, 0.05); // jib ram: boom (boom space), lever (jib space)
  const X = V(1, 0, 0), tA = new THREE.Vector3(), tB = new THREE.Vector3();
  const pose = (ram, a, b) => {
    const dy = b.y - a.y, dz = b.z - a.z, d = Math.hypot(dy, dz);
    ram.g.position.copy(a);
    ram.g.rotation.x = Math.atan2(dy, -dz);
    ram.rr.position.copy(b);
    ram.rr.rotation.x = Math.atan2(-dy, dz);
    ram.g.scale.z = Math.min(1, Math.max(0.3, (d - 0.05) / ram.L0));
    ram.rr.scale.z = Math.min(1.5, Math.max(0.3, d / (ram.L0 + 0.1)));
  };
  const st = { slew: 0, boom: 0, jib: 0, ext: 0, cable: 0.6 };
  rig.crane = st;
  rig.setCrane = (o = {}) => {
    Object.assign(st, o);
    slew.rotation.y = st.slew;
    bm.rotation.x = st.boom;
    jb.rotation.x = st.jib;
    ex.position.z = ex2.position.z = -Math.min(EXT, Math.max(0, st.ext)) / 2;
    hd.rotation.x = -(st.boom + st.jib);
    hook.position.y = -st.cable;
    cable.scale.y = Math.max(0.01, st.cable - 0.2);
    // boom ram: A0 in slew space to A1 rotated by the boom about the pin
    tA.copy(A1).applyAxisAngle(X, st.boom).add(bm.position);
    pose(ramA, A0, tA);
    // jib ram in boom space: B0 to B1 rotated by the jib about the knuckle
    tB.copy(B1).applyAxisAngle(X, st.jib).add(jb.position);
    pose(ramB, B0, tB);
  };
  // The solver: the head's pin is jl + 0.05 + ext along the jib from the knuckle, the hook `cable` under
  // it; the boom and the jib are a two-link arm in the slew plane from the boom pin (elbow up).
  const pinY = y0 + h, pinZ = -0.08;
  rig.solveCrane = (p, out = {}, cableLen = st.cable) => {
    const dx = p.x - cx, dz = p.z - cz;
    out.slew = Math.atan2(-dx, -dz);
    // the pin sits 0.08 ahead of the axis along the boom's direction
    const u = Math.hypot(dx, dz) - (-pinZ), v = p.y + cableLen - pinY;
    let D = Math.hypot(u, v);
    // extend the jib only as far as needed to keep a bend at the knuckle
    const ext = Math.min(EXT, Math.max(0, D - (BL + jl + 0.05) + 0.5));
    const L2 = jl + 0.05 + ext;
    out.ok = D <= BL + L2 - 0.02 && D >= Math.abs(BL - L2) + 0.02;
    D = Math.min(BL + L2 - 0.02, Math.max(Math.abs(BL - L2) + 0.02, D));
    const a = Math.atan2(v, u), k = Math.acos(Math.min(1, Math.max(-1, (BL * BL + D * D - L2 * L2) / (2 * BL * D))));
    const phi1 = a + k; // boom elevation (elbow up)
    const kx = BL * Math.cos(phi1), ky = BL * Math.sin(phi1);
    const phi2 = Math.atan2(D * Math.sin(a) - ky, D * Math.cos(a) - kx);
    out.boom = phi1;
    out.jib = phi2 - phi1;
    out.ext = ext;
    out.cable = cableLen;
    return out;
  };
  rig.craneTravel = { slew: 0, boom: 0.32, jib: -0.33, ext: 0, cable: 0.25 }; // tor_9t244_14
}

// ---------------------------------------------------------------- stabilizers

function outriggers(rig) {
  const feet = [-1, 1].map((s) => {
    const g = pivotAt(rig, rig.root, 'outrigger' + (s < 0 ? 'L' : 'R'), s * 1.1, 1.4, 3.45);
    delete rig.pivots[g.name];
    const P = new Parts(rig.mats);
    P.add('steel', yTube(-1.0, 0, 0.07, 0.07, 10, 0, 0));
    P.add('dark', yTube(-1.06, -0.98, 0.2, 0.18, 14, 0, 0));
    P.build(g, { dirt: 0.6, y0: 1.0 });
    return g;
  });
  // the inner leg slides out of its housing (0.9 .. 1.4 m) until the pad stands on the ground
  rig.setOutriggers = (v) => {
    const k = Math.min(1, Math.max(0, v));
    for (const f of feet) f.position.y = 1.4 - 0.34 * k;
  };
  rig.setOutriggers(0);
}

// ---------------------------------------------------------------- the rig

export function build9T244() {
  const rig = newRig('green');
  const { P, root, mats } = rig;
  front(P, rig);
  chassis(P);
  bed(P);
  platform(P);
  P.build(root, { dirt: 0.55 });
  crane(rig);
  rig.setCrane(rig.craneTravel);
  outriggers(rig);
  const wheels = spinWheels(root, mats, U.axles.flatMap((z, i) => [-1, 1].map((s) => ({ x: s * U.track, y: U.R, z, steer: i === 0 ? 1 : 0 }))), U.R, heavyWheel(U.W));
  rig.setWheels = wheels.set;
  rig.wheelR = U.R;
  rig.axles = U.axles;
  // the containers on the bed: one group each on its anchor (the top eye; the container hangs along the
  // anchor's -Y, laid along -Z here)
  rig.anchors.cargo = [];
  const groups = [];
  for (let i = 0; i < 8; i++) {
    const a = node(root, 'cargo' + i, cargoX(i), CARGO_Y, CARGO_TOP + CONTAINER.top, Math.PI / 2, 0, 0);
    rig.anchors.cargo.push(a);
    const g = new THREE.Group();
    a.add(g);
    const K = new Parts(mats);
    containerParts(K);
    K.build(g, { dirt: 0.05, y0: CARGO_Y });
    groups.push(g);
  }
  rig.slots = groups.map((g) => [g]);
  rig.anchors.eye = node(root, 'eye', 0, 2.4, 0);
  rig.anchors.cabDoorL = node(root, 'cabDoorL', -U.cab.hw - 0.55, 0, U.cab.zf + 0.6);
  rig.anchors.cabDoorR = node(root, 'cabDoorR', U.cab.hw + 0.55, 0, U.cab.zf + 0.6);
  rig.anchors.operator = node(root, 'operator', -1.75, 0, 3.0);
  hb(rig, -1.27, 0, U.bumper.z, 1.27, U.cab.H, U.rear);
  return rig;
}

/**
 * The 9M338's transport-launch container into a parts collector, hanging from its top eye at the
 * origin (top: the eye's top above the flange's foot, which seats on the cell's top): the eye, the top
 * flange and boss (as the cap the Tor's cells show), the tube down L with two bands and a collar near the
 * top (tor_m2_06), the bottom cover. Keys 'canister' (the tube), 'dark'.
 */
export function containerParts(K) {
  const { L, r, top } = CONTAINER, f = -top; // the flange's foot (seated: on the cell's top)
  K.add('canister', yTube(f, f + 0.025, 0.15, 0.15, 16)); // flange, as the cell cap of tor.js
  K.add('canister', yTube(f + 0.025, f + 0.035, 0.09, 0.07, 12)); // boss
  K.add('dark', new THREE.TorusGeometry(0.03, 0.009, 5, 10).applyMatrix4(xf(0, -0.035, 0, 0, Math.PI / 2, 0))); // the lifting eye
  K.add('canister', yTube(f - L, f, r, r, 16));
  K.add('canister', yTube(f - 0.55, f - 0.35, r + 0.018, r + 0.018, 16)); // collar
  for (const d of [1.4, 2.4]) K.add('canister', yTube(f - d - 0.03, f - d + 0.03, r + 0.01, r + 0.01, 16));
  K.add('dark', yTube(f - L - 0.02, f - L, r - 0.01, r, 16));
}
