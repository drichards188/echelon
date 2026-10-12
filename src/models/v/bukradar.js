import * as THREE from 'three';
import { V, box, rbox, yTube, zTube, xTube, rod, lathe, sideProfile, frontProfile, xf, loft, ringAt, Parts } from '../kit.js';
import { whip, hose } from '../trucks.js';
import { newRig, node, pivotAt, hb } from '../rig.js';
import { rb } from './ural.js';
import { lamp } from './maz543.js';
import { RADAR_C, CP_C, addRunningGear, addLowerHull, upperHull, sidePanel, addRear, addNoseFittings, plateZ } from './gm567.js';

// The Buk-M2 battery's search radar and command post, both on the Mytishchi GM-567M / GM-579 tracked
// chassis (./gm567.js, the TELAR's running gear). Reference: refs/buk/README.md, section C.
//
// buk-radar: 9S18M1-1 "Kupol" acquisition radar (the M2 battery's search radar per the sheet), built
// from its one photo (refs/buk/photos m1-radar-9s18m1-1-kupol-maks2005, from the front, array raised)
// and the ru Wikipedia figures (hull 9.59 m, 3.25 m wide, 3.25 m high in travel, 8.02 m in action).
// The low beak-nosed cab: two pillow-shaped windscreen covers on a short steep glacis, three vision
// blocks under the overhang of the antenna housing, a three-lamp cluster on the left and one lamp on
// the right, the tow cable hung across the nose plate, a short ladder up the glacis, the side door
// on the left. Right behind the cab the turning antenna housing: a 1.9 m box (2.2 to 2.95 m up) with
// two pressed, beaded lids on its face and a whip on its left, on a turntable; on fold arms at its
// back the array (2.65 x 3.6 m, about sixty stacked slotted waveguides that make the ribbed face,
// leaning back 15 degrees, its foot just above the box) with the flat IFF array (2.6 x 1.13 m) on
// three trusses above. On a bracket off the right front corner the telescopic mast: a geared foot, a
// slim olive lower tube with a junction box, a canister and cables, a ground-plane crown of eight
// rods at about 6.2 m, a bright inner tube above. Sizes and positions come from a least-squares fit of
// that photo's camera and these dimensions (the 8.02 m top, the 3.25 m width and the nose as rulers;
// about 15 px rms on the 2560 px photo). Unconfirmed and reconstructed: the rear two thirds (no photo
// shows them), the array's back, the fold drive, and the travel pose (the array folds back flat over
// the engine deck, face up, which fits the 3.25 m travel height; the mast folds back along the right
// edge, telescoped in).
//
// Rig (buk-radar), model space front -Z, right +X, ground y = 0:
//   pivots.searchRadar  turntable at (0, 2.15, -3.0), carrying the housing box and the array:
//                       rotation.y is the array's azimuth relative to the hull (three's convention,
//                       + turns the face to the left), 0 = facing ahead. The render spins it with the
//                       sweep; for travel it should be left at 0 (the array folds back along the hull).
//   anchors.eye         (0, 2.6, -2.0)
//   setDeploy(v)        v = 0 travel, 1 in action; it moves (internal groups, not in rig.pivots):
//     antennaFold  rotation.x about the fold pivot at the housing's back (2.78 m up, 0.6 m behind the
//                  turntable axis; the array's foot stands 0.4 m up its fold arms): pi/2 (folded back
//                  flat over the engine deck, face up) at v = 0 to 0.27 (leaning back 15 degrees) at
//                  v >= 0.8; + tips the top backward.
//     mastFold     rotation.x about the mast foot (1.84, 2.42, -3.9): pi/2 (lying back along the right
//                  edge of the roof) at v = 0 to 0 (upright) at v >= 0.5.
//     mastTop      position.y of the inner tube: 0.4 (telescoped in) to 4.3 (out) over v 0.5 to 1.
//     crown        the ground-plane rods spread (scale x, z 0.1 to 1) over v 0.4 to 0.7.
//
// buk-cp: 9S510 command post. No photo of a 9S510 was found, so it is reconstructed after the
// Buk-M1's 9S470M1 (refs/buk/photos m1-command-post-9s470m1-kuzmin, right front three-quarter) and the ru
// Wikipedia figures for the 9S470 (hull 8.0 m, width 3.3 m, height 3.8 m, Object 579, 4.65 m from the
// first to the last road wheel): the TELAR's running gear and wheel spacing (./gm569.js scale), a
// tall cabin set in from wide aprons over the front two thirds with its sides leaning in above the belt, a steep glacis
// between faceted cheeks with two bulged windscreen covers, vision blocks under a roof visor and lamps
// in hooded brackets on the cheeks, a ventilation box on the roof, a lower engine deck behind with
// L-shaped guard rails, whips at the front left and on the roof's right. Rig: anchors.eye at (0, 3.0, 0); it
// has no mast, so setDeploy is a no-op kept for a uniform interface.

const clamp01 = (v) => Math.min(1, Math.max(0, v));
const OLIVE = 0x8c8f6e; // tint that takes the satin 'canister' olive to the hull's paint (array ribs, radome)
const PRESSED = 0x9ea284; // the same for the smooth pressed covers (housing lids, windscreen covers)
const smooth = (v) => v * v * (3 - 2 * v);

// a point on a glacis plate u metres up from its lower edge g0 toward g1, off metres out from it
// (as [z, y]), and the rx that lays a flat box (its local z up the slope) onto the plate
function glacis(g0, g1) {
  const a = Math.atan2(g1[1] - g0[1], g1[0] - g0[0]);
  return {
    len: Math.hypot(g1[1] - g0[1], g1[0] - g0[0]),
    rx: -(Math.PI / 2 - a),
    at: (u, off = 0) => [g0[0] + Math.cos(a) * u - Math.sin(a) * off, g0[1] + Math.sin(a) * u + Math.cos(a) * off],
  };
}

// Unit pillow: a hemisphere pushed out to a rounded-square footprint, its top flattened.
function pillow() {
  const g = new THREE.SphereGeometry(1, 24, 10, 0, Math.PI * 2, 0, Math.PI / 2), p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i), a = Math.atan2(z, x);
    const k = Math.pow(Math.pow(Math.abs(Math.cos(a)), 5) + Math.pow(Math.abs(Math.sin(a)), 5), -1 / 5);
    p.setXYZ(i, x * k, Math.pow(Math.max(0, y), 0.55), z * k);
  }
  g.computeVertexNormals();
  return g;
}

// Bulged armour cover over a windscreen on a glacis: a rimmed base plate under a smooth pillow dome
// (half an ellipsoid standing out of the plate), hinges along the top, the slit under the lower edge.
function screenCover(P, gl, x, u0, u1, w) {
  const uc = (u0 + u1) / 2, L = u1 - u0;
  let [z, y] = gl.at(uc, 0.02);
  P.add('camo', rb(w, 0.04, L, 0.02, x, y, z, gl.rx));
  [z, y] = gl.at(uc - 0.02, 0.03);
  P.add('canister', pillow().applyMatrix4(xf(x, y, z, gl.rx, 0, 0, V(w * 0.47, 0.14, L * 0.47))), { tint: PRESSED });
  for (const dx of [-w * 0.3, w * 0.3]) { [z, y] = gl.at(u1 - 0.02, 0.05); P.add('dark', xTube(x + dx - 0.07, x + dx + 0.07, 0.025, 0.025, 8, y, z)); }
  [z, y] = gl.at(u0 - 0.02, 0.012);
  P.add('dark', box(w - 0.08, 0.01, 0.05, x, y, z, gl.rx)); // the slit under the cover's lower edge
  [z, y] = gl.at(u0 + 0.06, 0.07);
  P.add('steel', box(0.1, 0.03, 0.03, x + w * 0.38, y, z, gl.rx)); // stay
}

// ---------------------------------------------------------------- 9S18M1-1 radar

const C = RADAR_C, ROOF = C.roof; // deck 2.15
const AXZ = -3.0; // turntable axis z (searchRadar pivot on the roof)
const HY = 0.63, HZ = 0.6; // fold pivot in pivot space: 2.78 m up, 0.6 m behind the axis (at the box's back)
const LEG = 0.4; // the array's foot stands this far up the fold arms from the pivot
const TILT = 0.27; // the array leans back 15 degrees in action
const PW = 2.65, PH = 3.6, PD = 0.36; // main array: width, height, depth (face to back plate)
const IW = 2.58, IH = 1.13, ID = 0.2, IG = 0.23; // IFF array and the gap under it
const BOX = { w: 1.9, y0: 0.05, y1: 0.8, z0: -1.33, z1: 0.45 }; // housing box in pivot space (2.2 to 2.95 m)
const MAST = V(1.84, 2.42, -3.9); // mast foot hinge, on a bracket off the right front corner
const NOSE_Y = 1.22;
const ZV = -4.3; // the cab front: vision blocks under the box's overhang
const G0 = [C.front, NOSE_Y], G1 = [ZV - 0.03, 1.95]; // glacis: nose edge and the brow (z, y)

// The array in its fold group: origin on the fold pivot at the housing's back, local y up the fold
// arms and the face, z back (the face looks along -z). The arms are short lattice legs from the
// pivot up to the array's foot (seen beside the box in the photo).
function buildArray(A) {
  const yb = LEG, yt = yb + PH, zf = -PD, hw = PW / 2;
  // frame: side channels, top and bottom members
  for (const s of [-1, 1]) A.add('camo', box(0.07, PH, PD, s * (hw - 0.035), yb + PH / 2, -PD / 2));
  A.add('camo', box(PW, 0.08, PD, 0, yt - 0.04, -PD / 2));
  A.add('camo', box(PW, 0.12, PD, 0, yb + 0.06, -PD / 2));
  // face: about sixty stacked slotted waveguides over a dark backing
  A.add('dark', box(PW - 0.14, PH - 0.2, 0.02, 0, yb + PH / 2, zf + 0.07), { tint: 0x8a9466 });
  const rows = 58, y0 = yb + 0.15, dy = (PH - 0.27) / (rows - 1);
  for (let i = 0; i < rows; i++) A.add('canister', box(PW - 0.14, 0.038, 0.06, 0, y0 + i * dy, zf + 0.03), { tint: OLIVE });
  // latches and lifting lugs along the side channels and the top
  for (const s of [-1, 1]) for (let i = 0; i < 6; i++) A.add('dark', box(0.05, 0.08, 0.1, s * (hw + 0.012), yb + 0.35 + i * 0.6, -0.22));
  for (const s of [-1, 1]) A.add('dark', box(0.08, 0.12, 0.12, s * (hw - 0.04), yt + 0.05, -0.32));
  // back: plate, a grid of box beams, diagonals, the feed run down the left edge
  A.add('camo', box(PW - 0.06, PH - 0.05, 0.03, 0, yb + PH / 2, -0.015));
  const T = { tint: 0xcfcfcf }, ys = [0.1, 0.36, 0.62, 0.88].map((f) => yb + f * PH);
  for (const y of ys) A.add('camo', box(PW - 0.2, 0.12, 0.12, 0, y, 0.06), T);
  for (const x of [-0.9, 0, 0.9]) A.add('camo', box(0.12, PH - 0.2, 0.12, x, yb + PH / 2, 0.06), T);
  for (const s of [-1, 1]) for (let i = 0; i < 3; i++) A.add('camo', rod(V(s * 0.06, ys[i], 0.06), V(s * 0.84, ys[i + 1], 0.06), 0.03, 5), T);
  A.add('dark', box(0.16, PH - 0.4, 0.14, -1.13, yb + PH / 2, 0.08), { tint: 0xa0a68a });
  for (let i = 0; i < 7; i++) A.add('dark', box(0.2, 0.04, 0.17, -1.13, yb + 0.35 + i * 0.48, 0.08));
  // fold arms: lattice legs from the pivot knuckles to the foot, a centre post with the rotary joint
  for (const s of [-1, 1]) {
    const x = s * (hw - 0.17);
    A.add('dark', xTube(x - 0.1, x + 0.1, 0.07, 0.07, 12, 0, 0));
    A.add('camo', box(0.1, LEG + 0.06, 0.1, x, LEG / 2, 0.0), T);
    A.add('camo', box(0.06, LEG + 0.06, 0.06, x, LEG / 2, -0.28), T);
    A.add('camo', rod(V(x, 0.02, 0.0), V(x, LEG, -0.28), 0.02, 4), T);
    A.add('camo', rod(V(x, 0.05, 0.0), V(x - s * 0.35, LEG, 0.02), 0.022, 4), T);
    A.add('camo', sideProfile([[-0.05, 0.28], [0.22, 0.0], [0.04, -0.18], [-0.18, -0.04]], 0.05).applyMatrix4(xf(x + s * 0.13, 0, 0)), T); // fold drive gear sector
    A.add('dark', xTube(s * 0.32, s * 0.5, 0.06, 0.06, 10, 0, 0));
  }
  A.add('camo', box(0.24, LEG, 0.2, 0, LEG / 2, 0.02), T);
  A.add('camo', rb(0.42, 0.34, 0.26, 0.03, 0, LEG + 0.25, 0.2)); // rotary joint and waveguide
  A.add('dark', zTube(0.2, 0.42, 0.06, 0.06, 8, 0, LEG + 0.1));
  // IFF array on three trusses above the main array
  const iy0 = yt + IG;
  for (const x of [-1.0, 0, 1.0]) {
    for (const z of [-0.3, -0.08]) A.add('camo', box(0.06, IG + 0.06, 0.05, x, yt + IG / 2, z), T);
    A.add('camo', rod(V(x, yt, -0.3), V(x, iy0, -0.08), 0.018, 4), T);
    A.add('camo', box(0.5, 0.05, 0.05, x, yt + 0.03, -0.19), T);
    A.add('camo', box(0.5, 0.05, 0.05, x, iy0 - 0.03, -0.19), T);
    A.add('camo', rod(V(x - 0.22, yt + 0.05, -0.19), V(x, iy0 - 0.05, -0.19), 0.016, 4), T);
    A.add('camo', rod(V(x + 0.22, yt + 0.05, -0.19), V(x, iy0 - 0.05, -0.19), 0.016, 4), T);
  }
  A.add('camo', box(PW - 0.3, 0.05, 0.05, 0, iy0 - 0.03, -0.19), T);
  A.add('camo', rb(IW, IH, ID, 0.03, 0, iy0 + IH / 2, zf + ID / 2));
  A.add('canister', box(IW - 0.08, IH - 0.08, 0.012, 0, iy0 + IH / 2, zf - 0.004), { tint: OLIVE }); // radome skin
  A.add('dark', box(IW - 0.05, 0.02, ID + 0.01, 0, iy0 + 0.02, zf + ID / 2));
  A.add('dark', box(0.1, 0.12, 0.1, -IW / 2 - 0.05, iy0 + IH - 0.1, zf + 0.1)); // corner fittings
  A.add('dark', box(0.08, 0.2, 0.12, IW / 2 + 0.04, iy0 + IH - 0.12, zf + 0.12));
  A.add('dark', box(0.08, 0.2, 0.12, IW / 2 + 0.04, iy0 + 0.12, zf + 0.12));
  // cable loops (painted yellow) between the arrays
  for (const x of [-0.42, -0.1]) A.add('amber', new THREE.TorusGeometry(0.07, 0.014, 5, 10, Math.PI * 1.4).applyMatrix4(xf(x, yt + 0.1, -0.2, 0, Math.PI / 2, -0.4)));
}

// The turning housing: ring, the box with two ribbed lids on its face, a hatch on top, the whip on
// its left side, and at its back a cross beam with the clevises the array's fold arms hang on.
function buildHousing(S) {
  const B = BOX, bh = B.y1 - B.y0, yc = (B.y0 + B.y1) / 2, zc = (B.z0 + B.z1) / 2, hw = B.w / 2;
  S.add('camo', yTube(0, B.y0, 0.98, 0.96, 28));
  S.add('dark', yTube(-0.02, 0.02, 1.04, 1.04, 28));
  S.add('camo', rb(B.w, bh, B.z1 - B.z0, 0.04, 0, yc, zc));
  S.add('dark', box(B.w - 0.06, 0.06, 0.02, 0, B.y0 + 0.04, B.z0 - 0.005));
  for (const [x0, x1, y0, y1] of [[0.92, 0.14, 0.12, 0.7], [-0.2, -0.79, 0.15, 0.76]]) {
    const w = Math.abs(x1 - x0), xc = (x0 + x1) / 2, cy = (y0 + y1) / 2, h = y1 - y0;
    S.add('camo', rb(w, h, 0.06, 0.05, xc, cy, B.z0 - 0.02), { tint: 0xeeeeee });
    S.add('canister', rbox(w - 0.04, h - 0.04, 0.14, 0.06, xc, cy, B.z0 - 0.06), { tint: PRESSED }); // the pressed, bulging cover
    for (const f of [0.22, 0.5, 0.78]) S.add('canister', xTube(xc - w / 2 + 0.09, xc + w / 2 - 0.09, 0.024, 0.024, 8, y0 + h * f, B.z0 - 0.125), { tint: PRESSED }); // pressed beads
    S.add('dark', box(w - 0.1, 0.012, 0.02, xc, y1 + 0.018, B.z0 - 0.03));
    for (const dx of [-w * 0.33, w * 0.33]) S.add('dark', xTube(xc + dx - 0.06, xc + dx + 0.06, 0.02, 0.02, 6, y1 + 0.01, B.z0 - 0.04));
    S.add('dark', box(0.08, 0.04, 0.04, xc, y0 + 0.04, B.z0 - 0.07));
  }
  S.add('camo', box(0.06, bh - 0.08, 0.04, -0.03, yc, B.z0 - 0.025), { tint: 0xd0d0d0 }); // the hinge post in the gap between the lids
  for (const y of [0.25, 0.55]) S.add('dark', box(0.05, 0.06, 0.05, -0.03, y, B.z0 - 0.05));
  S.add('dark', box(0.02, bh - 0.1, 0.02, -0.87, yc, B.z0 - 0.015));
  // top: rim, a hatch, lifting eyes
  S.add('camo', box(B.w - 0.2, 0.03, B.z1 - B.z0 - 0.2, 0, B.y1 + 0.005, zc), { tint: 0xd8d8d8 });
  S.add('camo', rb(0.7, 0.06, 0.7, 0.02, 0.4, B.y1 + 0.03, zc + 0.3), { tint: 0xe4e4e4 });
  S.add('dark', xTube(0.08, 0.72, 0.02, 0.02, 6, B.y1 + 0.04, zc + 0.66));
  for (const [x, z] of [[-0.8, B.z0 + 0.12], [0.8, B.z0 + 0.12], [-0.8, B.z1 - 0.12], [0.8, B.z1 - 0.12]]) S.add('dark', new THREE.TorusGeometry(0.05, 0.012, 4, 8, Math.PI).applyMatrix4(xf(x, B.y1, z, 0, Math.PI / 2, 0)));
  // sides: a locker on the right, louvres and cable connectors on the left
  sidePanel(S, hw, 1, B.z0 + 0.2, B.z1 - 0.25, B.y0 + 0.12, B.y1 - 0.1);
  S.add('dark', box(0.02, 0.36, 0.9, -hw - 0.005, yc, zc - 0.15));
  for (let i = 0; i < 5; i++) S.add('camo', box(0.03, 0.03, 0.86, -hw - 0.015, yc - 0.14 + i * 0.07, zc - 0.15), { tint: 0xc0c0c0 });
  for (let i = 0; i < 3; i++) S.add('dark', xTube(-hw - 0.06, -hw, 0.04, 0.04, 8, yc, zc + 0.5 + i * 0.13));
  // whip on a bracket on the left side, at the front
  S.add('dark', box(0.1, 0.14, 0.12, -hw - 0.05, yc, B.z0 + 0.12));
  whip(S, -hw - 0.07, yc + 0.07, B.z0 + 0.12, 4.6, 0.011);
  // back: cross beam carrying the clevises for the fold arms, braces down to the box
  S.add('camo', box(PW - 0.2, 0.16, 0.22, 0, HY - 0.15, B.z1 + 0.1));
  for (const s of [-1, 1]) {
    for (const x of [PW / 2 - 0.17, 0.41]) for (const d of [-0.12, 0.12]) S.add('camo', sideProfile([[B.z1 + 0.0, HY - 0.25], [HZ + 0.1, HY - 0.1], [HZ + 0.1, HY + 0.08], [HZ - 0.1, HY + 0.1], [B.z1 + 0.0, HY - 0.0]], 0.035).applyMatrix4(xf(s * x + d, 0, 0)));
    S.add('steel', xTube(s * (PW / 2 - 0.33), s * (PW / 2 - 0.01), 0.028, 0.028, 6, HY, HZ));
    S.add('steel', xTube(s * 0.27, s * 0.55, 0.028, 0.028, 6, HY, HZ));
    S.add('camo', rod(V(s * (hw + 0.02), B.y0 + 0.1, B.z1 - 0.5), V(s * (PW / 2 - 0.17), HY - 0.18, B.z1 + 0.1), 0.03, 6));
  }
  hose(S, V(-0.3, B.y0 + 0.4, B.z1), V(-0.05, HY + LEG, HZ + 0.15), 0.1, 0.03, 'tyre', 4);
  hose(S, V(0.3, B.y0 + 0.4, B.z1), V(0.1, HY + LEG, HZ + 0.15), 0.12, 0.025, 'tyre', 4);
  for (let i = 0; i < 24; i++) { const a = (i / 24) * Math.PI * 2; S.add('dark', yTube(B.y0 - 0.02, B.y0 + 0.01, 0.018, 0.018, 5, Math.cos(a) * 0.91, Math.sin(a) * 0.91)); }
}

// The mast in its fold group (y up from the foot hinge): foot clevis, slim olive lower tube with clamp
// rings, the junction box and canister on its right, a thin rod alongside, a brace to the hull.
function buildMast(M) {
  M.add('camo', rb(0.24, 0.34, 0.28, 0.03, 0, 0.12, 0));
  M.add('camo', yTube(0.25, 4.25, 0.078, 0.072, 14));
  M.add('camo', yTube(0.25, 0.9, 0.1, 0.1, 14), { tint: 0xd8d8d8 });
  for (const y of [0.9, 1.0, 1.32, 2.0, 2.9, 4.18]) M.add('dark', yTube(y, y + 0.045, 0.092, 0.092, 14));
  M.add('camo', rb(0.2, 0.28, 0.16, 0.02, 0.16, 1.05, -0.02));
  for (const dx of [-0.05, 0.05]) M.add('dark', yTube(0.8, 0.92, 0.028, 0.028, 8, 0.16 + dx, -0.02));
  M.add('camo', yTube(0.35, 0.66, 0.06, 0.06, 10, 0.16, 0.02));
  M.add('dark', box(0.2, 0.03, 0.06, 0.12, 0.6, 0.0));
  M.add('dark', box(0.2, 0.03, 0.06, 0.12, 1.12, 0.0));
  M.add('steel', yTube(0.35, 2.45, 0.022, 0.022, 6, -0.11, 0.02), { tint: 0xd8d8c8 });
  for (const y of [0.4, 1.35, 2.4]) M.add('dark', box(0.08, 0.03, 0.04, -0.07, y, 0.02));
  hose(M, V(0.11, 0.8, -0.02), V(-0.25, -0.12, 0.05), 0.3, 0.016, 'white', 7);
  hose(M, V(0.21, 0.8, -0.02), V(-0.35, -0.1, 0.12), 0.38, 0.014, 'white', 7);
  M.add('camo', rod(V(-0.05, 0.38, 0.06), V(-0.5, 0.02, 0.32), 0.04, 8)); // the stay toward the box
  M.add('camo', rb(0.12, 0.34, 0.34, 0.02, 0.17, 0.08, 0.0)); // the gearbox on the foot's outboard side
  for (const [dy, dz] of [[-0.06, -0.1], [-0.06, 0.1], [0.18, -0.1], [0.18, 0.1]]) M.add('dark', xTube(0.23, 0.26, 0.03, 0.03, 6, dy, dz));
  M.add('camo', rb(0.12, 0.16, 0.1, 0.02, -0.13, 4.05, 0.0)); // bracket box at the collar
}

function buildRadarHull(P) {
  const R = ROOF, W = C.W;
  addRunningGear(P, C);
  addLowerHull(P, C, { yNose: NOSE_Y, wNose: 1.57 });
  upperHull(P, [[C.front, NOSE_Y - 0.02, NOSE_Y, 1.57], [-4.55, C.sponson, 1.6, 1.565], [G1[0], C.sponson, G1[1], W], [ZV - 0.01, C.sponson, G1[1], W], [ZV, C.sponson, R, W], [C.rear, C.sponson, R, W]]);
  P.add('dark', box(W * 2 - 0.1, 0.02, 0.05, 0, R + 0.005, C.rear - 0.03)); // roof edge strip
  const gl = glacis(G0, G1);

  // ---- cab front: windscreen covers, vision blocks in the band under the box, lamps, ladder
  screenCover(P, gl, 0.21, 0.2, 0.84, 0.68);
  screenCover(P, gl, -0.5, 0.2, 0.84, 0.68);
  for (const x of [0.2, -0.17, -0.52]) {
    P.add('dark', box(0.27, 0.1, 0.03, x, 2.04, ZV - 0.005));
    P.add('glass', box(0.21, 0.065, 0.012, x, 2.04, ZV - 0.022));
  }
  P.add('dark', box(2.9, 0.035, 0.06, 0, G1[1] + 0.01, G1[0] - 0.01)); // brow lip
  // three-lamp cluster on the left (white outboard, two infrared), single lamp on the right
  P.add('camo', rb(0.72, 0.24, 0.3, 0.03, -1.16, 1.87, -4.42));
  P.add('camo', box(0.76, 0.03, 0.2, -1.16, 2.0, -4.6)); // visor over the lamps
  lamp(P, -1.38, 1.89, -4.57, 0.075, 'lens');
  lamp(P, -1.16, 1.89, -4.57, 0.075, 'glass');
  lamp(P, -0.94, 1.89, -4.57, 0.075, 'glass');
  P.add('amber', box(0.05, 0.04, 0.02, -1.45, 1.73, -4.6));
  P.add('camo', rb(0.2, 0.22, 0.24, 0.02, 1.32, 1.76, -4.6));
  lamp(P, 1.32, 1.76, -4.72, 0.07, 'lens');
  // ladder up the glacis beside the right cover
  for (const x of [0.62, 0.88]) {
    const a = gl.at(0.04, 0.07), b = gl.at(gl.len + 0.05, 0.07);
    P.add('steel', rod(V(x, a[1], a[0]), V(x, b[1], b[0]), 0.016, 6));
    for (const u of [0.1, gl.len - 0.05]) { const p = gl.at(u, 0.0), q = gl.at(u, 0.07); P.add('steel', rod(V(x, p[1], p[0]), V(x, q[1], q[0]), 0.012, 5)); }
  }
  for (const u of [0.25, 0.5, 0.75]) { const p = gl.at(u, 0.07); P.add('steel', xTube(0.62, 0.88, 0.014, 0.014, 6, p[1], p[0])); }
  for (const [x, u] of [[1.15, 0.45], [-1.3, 0.2]]) { const [z, y] = gl.at(u, 0.02); P.add('camo', rod(V(x, y, z), V(x, y + 0.03, z - 0.03), 0.07, 12), { tint: 0xd0d0d0 }); }

  // ---- lower nose plate: draped tow cable, hooks, lifting eyes, inspection cover
  const nrx = addNoseFittings(P, C, NOSE_Y);
  const cab = (x, y, off = 0.045) => V(x, y, plateZ(C, y, NOSE_Y) - off);
  const cable = new THREE.CatmullRomCurve3([cab(0.95, 0.62), cab(1.22, 0.86), cab(1.22, 1.08), cab(0.9, 1.13), cab(0.45, 0.98), cab(-0.1, 0.8), cab(-0.62, 0.84), cab(-1.05, 1.03), cab(-1.27, 1.06), cab(-1.24, 0.82), cab(-0.95, 0.62)]);
  P.add('steel', new THREE.TubeGeometry(cable, 90, 0.024, 6, false), { tint: 0x8d8b80 });
  { const c = cab(0.62, 1.02, 0.0), n = V(0, -Math.sin(-nrx), -Math.cos(-nrx)); P.add('camo', rod(c, c.clone().addScaledVector(n, 0.03), 0.13, 16), { tint: 0xd0d0d0 }); P.add('dark', rod(c, c.clone().addScaledVector(n, 0.045), 0.03, 8)); }

  // ---- left side door just behind the cab front, grab rail
  P.add('camo', box(0.03, 0.78, 0.74, -W - 0.015, 1.75, -3.85), { tint: 0xe2e2e2 });
  P.add('dark', box(0.012, 0.8, 0.012, -W - 0.005, 1.75, -4.23));
  P.add('dark', box(0.012, 0.8, 0.012, -W - 0.005, 1.75, -3.47));
  for (const y of [1.48, 2.02]) P.add('dark', zTube(-4.28, -4.14, 0.025, 0.025, 6, -W - 0.03, y));
  P.add('dark', box(0.04, 0.05, 0.14, -W - 0.04, 1.75, -3.58));
  P.add('steel', rod(V(-W - 0.05, 1.42, -3.32), V(-W - 0.05, 2.05, -3.32), 0.014, 5));

  // ---- hull side panels (as on the TELAR), the engine air grille on the left
  for (const [z0, z1] of [[-3.3, -2.3], [-2.15, -1.05], [-0.9, 0.2], [0.35, 1.45], [1.6, 2.6], [2.75, 3.6], [3.75, 4.55]]) sidePanel(P, W, 1, z0, z1, 1.45, 1.98);
  for (const [z0, z1] of [[-3.2, -2.1], [-1.95, -0.85], [-0.7, 0.4], [3.75, 4.55]]) sidePanel(P, W, -1, z0, z1, 1.45, 1.98);
  P.add('dark', box(0.03, 0.45, 2.6, -W - 0.01, 1.72, 2.1));
  for (let i = 0; i < 17; i++) P.add('steel', box(0.03, 0.41, 0.025, -W - 0.025, 1.72, 0.9 + i * 0.15), { tint: 0x707060 });
  P.add('camo', box(0.03, 0.04, 2.66, -W - 0.02, 1.96, 2.1));
  P.add('camo', box(0.03, 0.04, 2.66, -W - 0.02, 1.48, 2.1));

  // ---- the mast base hung off the right front corner, and its travel rest further back
  const pY = MAST.y - 0.2; // the bracket's platform under the foot
  P.add('camo', box(MAST.x + 0.24 - W, 0.06, 0.52, (MAST.x + 0.24 + W) / 2, pY, MAST.z));
  P.add('camo', sideProfile([[MAST.z - 0.3, pY - 0.03], [MAST.z + 0.26, pY - 0.03], [MAST.z + 0.26, 1.72], [MAST.z - 0.05, 1.42], [MAST.z - 0.3, 1.42]], 0.05).applyMatrix4(xf(W + 0.025, 0, 0)));
  for (const z of [MAST.z - 0.23, MAST.z + 0.2]) P.add('camo', frontProfile([[W + 0.02, 1.62], [W + 0.02, pY - 0.03], [MAST.x + 0.22, pY - 0.03]], z, z + 0.04));
  P.add('camo', zTube(MAST.z - 0.15, MAST.z + 0.15, 0.15, 0.15, 16, MAST.x, MAST.y)); // the geared hinge drum
  P.add('camo', zTube(MAST.z - 0.19, MAST.z - 0.15, 0.12, 0.1, 14, MAST.x, MAST.y), { tint: 0xd0d0d0 });
  P.add('dark', zTube(MAST.z - 0.22, MAST.z - 0.19, 0.03, 0.03, 8, MAST.x, MAST.y));
  P.add('camo', box(0.1, MAST.y - R - 0.05, 0.1, MAST.x - 0.1, (MAST.y + R) / 2 - 0.05, -0.4));
  P.add('dark', new THREE.TorusGeometry(0.1, 0.022, 5, 12, Math.PI).applyMatrix4(xf(MAST.x - 0.1, MAST.y - 0.02, -0.4, 0, 0, Math.PI)));
  P.add('rubber', box(0.2, 0.03, 0.1, MAST.x - 0.1, MAST.y - 0.12, -0.4));
  P.add('camo', box(0.3, 0.06, 0.3, MAST.x - 0.15, R + 0.03, -0.4));

  // ---- filter drum with its guard hoop at the left front corner of the roof
  const DR = V(-1.36, 2.36, -4.36);
  P.add('camo', zTube(DR.z, DR.z + 0.26, 0.17, 0.17, 20, DR.x, DR.y));
  P.add('camo', lathe([[0.001, 0.07], [0.08, 0.065], [0.14, 0.045], [0.165, 0.0]], 20).applyMatrix4(xf(DR.x, DR.y, DR.z, -Math.PI / 2, 0, 0)), { tint: 0xe4e4e4 }); // domed cap
  P.add('dark', zTube(DR.z - 0.075, DR.z - 0.06, 0.03, 0.03, 8, DR.x, DR.y));
  P.add('camo', box(0.28, DR.y - R - 0.1, 0.28, DR.x, (DR.y + R) / 2 - 0.08, DR.z + 0.15));
  P.add('steel', new THREE.TorusGeometry(0.23, 0.016, 6, 18, Math.PI).applyMatrix4(xf(DR.x, DR.y, DR.z - 0.1)), { tint: 0x7a8060 });
  for (const s of [-1, 1]) P.add('steel', rod(V(DR.x + s * 0.23, DR.y, DR.z - 0.1), V(DR.x + s * 0.23, DR.y - 0.2, DR.z - 0.02), 0.016, 5), { tint: 0x7a8060 });

  // ---- roof: the turntable race, engine deck, exhaust, the rests for the folded array
  P.add('dark', yTube(R - 0.01, R + 0.02, 1.08, 1.08, 32, 0, AXZ));
  P.add('camo', rb(1.2, 0.3, 0.8, 0.03, -0.75, R + 0.15, -1.2)); // stowage box behind the turret
  P.add('dark', box(1.0, 0.02, 0.6, -0.75, R + 0.31, -1.2));
  P.add('dark', box(2.3, 0.02, 2.2, 0, R + 0.01, 3.2));
  for (let i = 0; i < 15; i++) P.add('camo', box(2.2, 0.03, 0.05, 0, R + 0.03, 2.2 + i * 0.143), { tint: 0xb8b8b8 });
  for (const z of [2.08, 4.32]) P.add('camo', box(2.34, 0.05, 0.05, 0, R + 0.03, z));
  P.add('dark', yTube(R, R + 0.3, 0.12, 0.12, 12, 1.2, 1.5));
  P.add('dark', yTube(R + 0.3, R + 0.34, 0.17, 0.17, 12, 1.2, 1.5));
  P.add('camo', rb(0.9, 0.36, 1.0, 0.03, 0.85, R + 0.18, 4.05)); // the power unit's exhaust housing
  for (let i = 0; i < 6; i++) P.add('dark', box(0.75, 0.025, 0.06, 0.85, R + 0.37, 3.7 + i * 0.14));
  P.add('dark', box(0.72, 0.2, 0.02, 0.85, R + 0.2, 4.56));
  const rest = R + HY - 0.13; // under the folded array's back beams
  for (const z of [0.5, 2.3]) for (const s of [-1, 1]) {
    P.add('camo', box(0.14, rest - R - 0.08, 0.14, s * 0.95, (rest + R) / 2 - 0.04, z));
    P.add('camo', box(0.3, 0.05, 0.24, s * 0.95, rest - 0.07, z));
    P.add('rubber', box(0.3, 0.04, 0.24, s * 0.95, rest - 0.025, z));
  }
  addRear(P, C);
}

export function buildBukRadar() {
  const rig = newRig('green'), { P, root, mats } = rig;
  buildRadarHull(P);
  P.build(root, { dirt: 0.5 });

  // ---- mast: fold group at the foot, the crown and the telescoping inner tube in it
  const mastFold = new THREE.Group();
  mastFold.name = 'mastFold';
  mastFold.position.copy(MAST);
  root.add(mastFold);
  const M = new Parts(mats);
  buildMast(M);
  M.build(mastFold, { y0: MAST.y });
  const crown = node(mastFold, 'crown', 0, 3.8, 0);
  const K = new Parts(mats);
  K.add('dark', yTube(-0.07, 0.07, 0.05, 0.05, 10));
  for (let i = 0; i < 4; i++) {
    const a = Math.PI / 4 + (i * Math.PI) / 2, b = (i * Math.PI) / 2;
    K.add('dark', rod(V(Math.cos(a) * 0.04, 0.03, Math.sin(a) * 0.04), V(Math.cos(a) * 0.86, -0.04, Math.sin(a) * 0.86), 0.009, 4));
    K.add('dark', rod(V(Math.cos(b) * 0.04, -0.03, Math.sin(b) * 0.04), V(Math.cos(b) * 0.5, -0.62, Math.sin(b) * 0.5), 0.009, 4));
  }
  K.build(crown, { y0: MAST.y + 3.8 });
  const mastTop = node(mastFold, 'mastTop', 0, 4.3, 0);
  const Q = new Parts(mats);
  Q.add('steel', yTube(0, 3.9, 0.056, 0.048, 12));
  Q.add('dark', yTube(3.88, 3.98, 0.055, 0.055, 10));
  Q.add('dark', yTube(3.98, 4.28, 0.02, 0.014, 6));
  Q.add('dark', yTube(0.0, 0.08, 0.07, 0.07, 12));
  Q.build(mastTop, { y0: MAST.y + 4.3 });

  // ---- antenna: turntable (searchRadar) with the housing, fold group at the hinge
  const sr = pivotAt(rig, root, 'searchRadar', 0, ROOF, AXZ);
  const S = new Parts(mats);
  buildHousing(S);
  S.build(sr, { dirt: 0.2, y0: ROOF });
  const fold = node(sr, 'antennaFold', 0, HY, HZ);
  const A = new Parts(mats);
  buildArray(A);
  A.build(fold, { y0: ROOF + HY });

  rig.setDeploy = (v) => {
    v = clamp01(v);
    fold.rotation.x = Math.PI / 2 + (TILT - Math.PI / 2) * smooth(clamp01(v / 0.8));
    mastFold.rotation.x = (1 - smooth(clamp01(v / 0.5))) * Math.PI / 2;
    mastTop.position.y = 0.4 + (4.3 - 0.4) * clamp01((v - 0.5) / 0.5);
    const k = 0.1 + 0.9 * clamp01((v - 0.4) / 0.3);
    crown.scale.set(k, 1, k);
  };
  rig.setDeploy(1);

  rig.anchors.eye = node(root, 'eye', 0, 2.6, -2.0);
  hb(rig, -C.apron, 0, C.front, C.apron, ROOF, C.rear);
  hb(rig, -1.0, ROOF, AXZ + BOX.z0, 1.0, ROOF + BOX.y1, AXZ + HZ + 0.1); // housing
  hb(rig, -1.5, ROOF + HY, AXZ - 1.5, 1.5, 8.0, AXZ + 1.8); // array in action (swept)
  hb(rig, MAST.x - 0.15, MAST.y, MAST.z - 0.15, MAST.x + 0.15, MAST.y + 8.0, MAST.z + 0.15);
  return rig;
}

// ---------------------------------------------------------------- 9S510 command post

const D = CP_C;
const CP = { roof: 3.3, belt: 2.45, wt: 1.0, z0: -3.25, z1: 1.9, noseY: 1.55, noseW: 1.1 };
const CG0 = [D.front, CP.noseY], CG1 = [CP.z0 - 0.02, 2.95]; // glacis between the cheeks, up to the vision band

function buildCpHull(P) {
  const R = D.roof, W = D.W;
  addRunningGear(P, D);
  addLowerHull(P, D, { yNose: CP.noseY, wNose: CP.noseW });
  upperHull(P, [[CP.z1 - 0.2, D.sponson, R, W], [D.rear, D.sponson, R, W]]); // deck level hull behind the cabin
  // the prow: a steep glacis between big faceted cheeks, from the nose edge up to the vision band
  P.add('camo', loft([
    [V(-CP.noseW, D.sponson - 0.1, D.front), V(CP.noseW, D.sponson - 0.1, D.front), V(CP.noseW - 0.05, CP.noseY, D.front), V(-CP.noseW + 0.05, CP.noseY, D.front)],
    [V(-W, D.sponson, CG1[0]), V(W, D.sponson, CG1[0]), V(CP.wt + 0.06, CG1[1], CG1[0]), V(-CP.wt - 0.06, CG1[1], CG1[0])],
  ]));
  // the cabin: sides upright to the belt, then leaning well in to the roof
  const ring = (z) => [V(-W, D.sponson, z), V(W, D.sponson, z), V(W, CP.belt, z), V(CP.wt, CP.roof, z), V(-CP.wt, CP.roof, z), V(-W, CP.belt, z)];
  P.add('camo', loft([ring(CP.z0), ring(CP.z1)]));
  P.add('dark', box(W * 2 + 0.02, 0.03, CP.z1 - CP.z0, 0, CP.belt, (CP.z0 + CP.z1) / 2)); // belt seam
  const gl = glacis(CG0, CG1);

  // ---- front: windscreen covers high on the glacis, vision blocks under the visor, hooded lamps
  screenCover(P, gl, 0.4, gl.len - 0.78, gl.len - 0.1, 0.68);
  screenCover(P, gl, -0.4, gl.len - 0.78, gl.len - 0.1, 0.68);
  for (const x of [-0.62, -0.22, 0.22, 0.62]) {
    P.add('dark', box(0.24, 0.09, 0.03, x, 3.12, CP.z0 - 0.005));
    P.add('glass', box(0.18, 0.055, 0.012, x, 3.12, CP.z0 - 0.022));
  }
  // the roof's front box with its visor overhanging the vision band, and the long hatch box behind
  P.add('camo', loft([ringAt([[-1.12, CP.z0 - 0.38], [1.12, CP.z0 - 0.38], [1.12, CP.z0 + 1.1], [-1.12, CP.z0 + 1.1]], CP.roof + 0.24), ringAt([[-1.2, CP.z0 - 0.42], [1.2, CP.z0 - 0.42], [1.2, CP.z0 + 1.2], [-1.2, CP.z0 + 1.2]], CP.roof + 0.14), ringAt([[-1.12, CP.z0 - 0.05], [1.12, CP.z0 - 0.05], [1.12, CP.z0 + 1.2], [-1.12, CP.z0 + 1.2]], CP.roof - 0.02)]));
  for (const s of [-1, 1]) P.add('camo', sideProfile([[CP.z0 - 0.38, CP.roof + 0.14], [CP.z0 + 0.02, CP.roof + 0.14], [CP.z0 + 0.02, CP.roof - 0.18]], 0.05).applyMatrix4(xf(s * 1.0, 0, 0)));
  P.add('camo', rb(1.7, 0.16, 2.3, 0.03, 0.0, CP.roof + 0.07, -0.1));
  P.add('camo', box(1.5, 0.04, 2.1, 0.0, CP.roof + 0.16, -0.1), { tint: 0xd8d8d8 });
  for (const z of [-0.95, 0.75]) P.add('dark', xTube(-0.65, 0.65, 0.025, 0.025, 6, CP.roof + 0.17, z));
  // lamps in hooded brackets standing out of the cheeks
  for (const s of [-1, 1]) {
    const x = s * 1.12, y = 2.28, z = -3.62;
    P.add('camo', rb(0.32, 0.24, 0.32, 0.02, x, y, z + 0.05));
    P.add('camo', box(0.38, 0.03, 0.36, x, y + 0.14, z - 0.04)); // hood
    lamp(P, x + s * 0.04, y, z - 0.11, 0.07, 'lens');
    lamp(P, x - s * 0.1, y - 0.03, z - 0.11, 0.035, 'amber');
  }
  // searchlight and the commander's sight at the top right, a stowed bar across the covers
  P.add('dark', zTube(CP.z0 - 0.2, CP.z0, 0.11, 0.11, 14, 0.98, 3.08));
  P.add('glass', zTube(CP.z0 - 0.22, CP.z0 - 0.2, 0.09, 0.09, 14, 0.98, 3.08));
  P.add('dark', rb(0.22, 0.2, 0.2, 0.03, 0.62, 3.05, CP.z0 - 0.12));
  P.add('glass', box(0.14, 0.07, 0.01, 0.62, 3.07, CP.z0 - 0.225));
  { const a = gl.at(gl.len - 0.05, 0.17), b = gl.at(gl.len - 0.95, 0.17); P.add('dark', rod(V(0.22, a[1], a[0]), V(-0.02, b[1], b[0]), 0.03, 6)); }
  // ---- nose: ladder up the lower plate, shackles and tow eyes
  addNoseFittings(P, D, CP.noseY);
  for (const x of [0.28, 0.56]) P.add('steel', rod(V(x, 0.42, plateZ(D, 0.45, CP.noseY) - 0.12), V(x, CP.noseY + 0.04, D.front - 0.06), 0.016, 6), { tint: 0xd8d8d0 });
  for (const y of [0.64, 0.88, 1.12]) P.add('steel', xTube(0.28, 0.56, 0.014, 0.014, 6, y, plateZ(D, y, CP.noseY) - 0.08), { tint: 0xd8d8d0 });
  for (const s of [-1, 1]) {
    const y = 1.08, z = plateZ(D, y, CP.noseY) - 0.04;
    P.add('dark', new THREE.TorusGeometry(0.07, 0.022, 6, 12, Math.PI).applyMatrix4(xf(s * 0.8, y - 0.02, z - 0.04, -0.6, 0, Math.PI)));
  }

  // ---- sides: door at the cabin's rear right, panels below the belt, grab rails above
  P.add('camo', box(0.03, 0.82, 0.8, W + 0.015, 1.76, 1.3), { tint: 0xe2e2e2 });
  for (const z of [0.89, 1.71]) P.add('dark', box(0.012, 0.84, 0.012, W + 0.005, 1.76, z));
  for (const y of [1.48, 2.05]) P.add('dark', zTube(1.62, 1.76, 0.025, 0.025, 6, W + 0.03, y));
  P.add('dark', box(0.04, 0.14, 0.05, W + 0.04, 1.76, 0.98));
  P.add('dark', box(0.05, 0.4, 0.12, W + 0.03, 1.9, 0.65)); // step bracket
  for (const s of [-1, 1]) {
    const panels = s < 0 ? [[-2.85, -1.85], [-1.7, -0.7], [-0.55, 0.45], [0.6, 1.7]] : [[-2.85, -1.85], [-1.7, -0.7], [-0.55, 0.45]];
    for (const [z0, z1] of panels) sidePanel(P, W, s, z0, z1, 1.42, 2.08);
    // grab rail on the leaning upper side
    const xr = s * (W - (W - CP.wt) * 0.42 + 0.05), yr = CP.belt + 0.46;
    P.add('steel', rod(V(xr, yr, -2.4), V(xr, yr, 1.2), 0.014, 5), { tint: 0x8a8a7a });
    for (const z of [-2.4, -0.6, 1.2]) P.add('dark', box(0.06, 0.04, 0.04, xr - s * 0.03, yr, z));
    // panels on the deck sides behind the cabin
    sidePanel(P, W, s, 2.05, 2.95, 1.42, 2.15);
    sidePanel(P, W, s, 3.1, 3.85, 1.42, 2.15);
  }
  // ---- roof: hatches behind the long box, whips at the front left and the roof's right
  for (const x of [-0.55, 0.55]) {
    P.add('camo', yTube(CP.roof, CP.roof + 0.06, 0.3, 0.28, 18, x, 1.3));
    P.add('camo', yTube(CP.roof + 0.06, CP.roof + 0.09, 0.25, 0.2, 18, x, 1.3), { tint: 0xd8d8d8 });
  }
  P.add('dark', box(0.14, 0.1, 0.14, 1.05, CP.roof + 0.05, 0.95));
  whip(P, 1.05, CP.roof + 0.1, 0.95, 3.2, 0.011);
  P.add('dark', box(0.14, 0.12, 0.14, -1.15, CP.roof - 0.1, CP.z0 + 0.15));
  whip(P, -1.15, CP.roof - 0.04, CP.z0 + 0.15, 3.2, 0.011);
  // cabin rear wall: door and a cable connector panel
  P.add('camo', box(0.8, 0.85, 0.03, 0.45, R + 0.5, CP.z1 + 0.015), { tint: 0xe2e2e2 });
  P.add('dark', box(0.04, 0.12, 0.05, 0.15, R + 0.5, CP.z1 + 0.04));
  P.add('dark', box(0.6, 0.4, 0.03, -0.7, R + 0.55, CP.z1 + 0.015));
  for (let i = 0; i < 4; i++) P.add('dark', zTube(CP.z1, CP.z1 + 0.07, 0.04, 0.04, 8, -0.5 - i * 0.13, R + 0.5));

  // ---- engine deck behind the cabin: grilles, a box on the right, the L-shaped guard rails
  P.add('dark', box(2.0, 0.02, 1.5, -0.15, R + 0.01, 3.1));
  for (let i = 0; i < 10; i++) P.add('camo', box(1.9, 0.03, 0.05, -0.15, R + 0.03, 2.45 + i * 0.145), { tint: 0xb8b8b8 });
  P.add('camo', rb(0.62, 0.6, 0.9, 0.03, 1.18, R + 0.3, 3.35));
  P.add('dark', box(0.64, 0.02, 0.92, 1.18, R + 0.45, 3.35));
  P.add('dark', yTube(R, R + 0.35, 0.11, 0.11, 12, -1.15, 2.25));
  P.add('dark', yTube(R + 0.35, R + 0.39, 0.16, 0.16, 12, -1.15, 2.25));
  for (const s of [-1, 1]) {
    const x = s * 1.46, yt = 3.25, zr = 3.8;
    P.add('steel', rod(V(x, R, zr), V(x, yt - 0.08, zr), 0.025, 6), { tint: 0x7c8262 });
    P.add('steel', rod(V(x, yt - 0.08, zr), V(x, yt, zr - 0.08), 0.025, 6), { tint: 0x7c8262 });
    P.add('steel', rod(V(x, yt, zr - 0.08), V(x - s * 0.08, yt, CP.z1), 0.025, 6), { tint: 0x7c8262 });
    P.add('dark', box(0.08, 0.05, 0.08, x, R + 0.02, zr));
  }
  // ladder up the right apron to the deck at the rear
  for (const z of [3.42, 3.78]) P.add('steel', rod(V(1.66, 0.55, z), V(1.66, R + 0.1, z), 0.016, 6), { tint: 0xd8d8d0 });
  for (let y = 0.7; y < R; y += 0.28) P.add('steel', zTube(3.42, 3.78, 0.014, 0.014, 6, 1.66, y), { tint: 0xd8d8d0 });
  addRear(P, D);
}

export function buildBukCp() {
  const rig = newRig('green'), { P, root } = rig;
  buildCpHull(P);
  P.build(root, { dirt: 0.5 });
  rig.setDeploy = () => {}; // no mast on the command post
  rig.anchors.eye = node(root, 'eye', 0, 3.0, 0);
  hb(rig, -D.apron, 0, D.front, D.apron, D.roof, D.rear);
  hb(rig, -D.W, D.roof, CP.z0 - 0.4, D.W, CP.roof + 0.3, CP.z1);
  return rig;
}
