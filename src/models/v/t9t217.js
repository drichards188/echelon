import * as THREE from 'three';
import { V, xf, box, rbox, yTube, zTube, xTube, sphere, rod, Parts } from '../kit.js';
import { newRig, node, pivotAt, hb } from '../rig.js';
import { buildBaz, bazTyre, bazHub, HULL } from './baz5937.js';
import { spinWheels } from './t22t6.js';

// 9T217 transloader of the Osa-AKM (refs/reload/README.md section 3; photos osa_9t217_polish (front
// three-quarter, tilt closed), osa_9t217_warsaw_2013 (side, a man in the cab hatch) and osa_9t217_ntw_9_93
// (the bay open, the crane's box boom out over a launcher on its left)). The hull is the Osa's BAZ-5937
// boat hull (baz5937.js: cab, flutes, wells, bow and stern fittings), here with a cargo bay sunk into the
// deck between the cab and the engine grilles, a canvas tilt over it (walls 0.55 m, a long hip at the
// front, a short one at the rear, a flat top 1.13 m over the deck; matched to the side view) and a crane
// inside. Reconstructed (no photo shows the bay's inside or the crane whole): the tilt splits along its
// centre line and each half opens on the top of its wall (ntw_9_93: the right half is raised; the left
// half, toward the launcher, swings over and down the outside), the crane is a pedestal crane at the
// front of the bay with a telescopic box boom (the ntw photo's stenciled beam) and a spreader that takes
// the containers as a block of three (handwiki: reloads "in sets of three"), and the bay holds four
// blocks in two stacks of two (12 rounds, the 9T217B load per ru.wikipedia). Model space: front -Z,
// ground y = 0, origin at mid-hull (as the Osa).
//
// Pivots and rig extras:
//   hatchL, hatchR  the cab roof hatch lids, hinged at their front edge: rotation.x, 0 shut, about -1.75
//                   open (the lid stands up ahead of the man, osa_9t217_warsaw_2013).
//   roofL, roofR    the tilt's halves (each a side slope, half the flat top and half of each hip) on their
//                   hinges along the walls' tops: rotation.z (setRoof does it).
//   setRoof(v)      0 shut .. 1 open: the left half over and down the outside of its wall (235 degrees),
//                   the right half raised and leaning out over its wall (112 degrees: its underside to the
//                   outside, as in ntw_9_93).
//   crane           slew on the pedestal at (0, PED.y, PED.z): rotation.y, 0 = the boom pointing forward
//                   (-Z), + turns it left.
//   craneBoom       luff about the boom's root on the slewing column: rotation.x, + raises the tip.
//   craneExt        the middle boom section (the inner one rides on it): setCrane's `ext` (0 .. EXT).
//   craneHead       the hanger at the boom tip, kept plumb by setCrane (do not set).
//   craneRotator    the spreader's rotator under the hanger: rotation.y relative to the boom.
//   anchors.craneLoad  the middle of a carried block of three containers (the block frame of osa.js:
//                   x across it, y up, z along it with +z toward the tails); a block parented with an
//                   identity transform hangs level under the spreader.
//   setCrane({ slew, luff, ext, rotate })  poses the crane (the hanger levels itself, the ram follows).
//   solveCrane(p, yaw, out)  slew, luff, ext and rotate that put the middle of a block at p (model space)
//                   with its length along the model-space yaw (rotation.y of the block frame); out.ok false
//                   when out of reach (clamped).
//   craneTravel     the travel pose: the boom slewed back over the bay, the spreader resting in the
//                   lower right place (BAY[2], empty until the spent blocks come in).
//   BAY             the bay's block places: [{ x, y, z }] block centres (yaw PI: the tails forward).
//   setWheels(roll, steer)  roll in metres, steer the front axle (rad, + = left; the rear axle steers
//                   against it, as the BAZ-5937 does).
//   anchors.eye, anchors.operator (the crane operator's spot on the bay floor, right of the pedestal,
//                   out from under the boom), anchors.hatchL/R (where a man standing in a hatch stands).

export const T217 = {
  bay: { x: 1.22, z0: -1.88, z1: 2.3, floor: 1.27 }, // the opening in the deck and the floor of the well
  tilt: { z0: -1.95, z1: 2.55, x: 1.3, wall: 2.48, top: 3.06, edge: 0.55, hipF: -0.6, hipR: 2.2 }, // walls, flat top (edge: its half width), the hips' upper ends
  PED: { z: -1.5, y: 1.85, top: 2.4 }, // the crane: slew bearing height, the boom's root pin height
  BOOM: { base: 2.1, EXT: 2.75, drop: 0.12 }, // root pin to the tip retracted, extension travel, hanger pin under the axis
  HANG: 0.535, // hanger pin to the middle of a block hanging under the spreader
  hatch: { x: 0.8, z: -2.35 },
  steer: [1, 0, -1],
};

// block of three containers (osa.js OSA_PANEL): 1.03 wide (bands), 0.35 high (ribs), 3.3 long
const BLOCK = { w: 1.03, h: 0.35, L: 3.3 };
const STACK_X = 0.575, LAYER = BLOCK.h + 0.03, BAY_Z = 0.6;
export const BAY = [
  { x: -STACK_X, y: T217.bay.floor + 0.03 + BLOCK.h / 2 + LAYER, z: BAY_Z }, // 0 upper left
  { x: -STACK_X, y: T217.bay.floor + 0.03 + BLOCK.h / 2, z: BAY_Z }, // 1 lower left
  { x: STACK_X, y: T217.bay.floor + 0.03 + BLOCK.h / 2, z: BAY_Z }, // 2 lower right
  { x: STACK_X, y: T217.bay.floor + 0.03 + BLOCK.h / 2 + LAYER, z: BAY_Z }, // 3 upper right
];

// ---------------------------------------------------------------- the bay

// The well sunk into the hull between the wells' tops: floor, walls lined in the body paint, the
// sleepers the blocks sit on, tie-down rails, and the crane's pedestal plinth.
function bay(P) {
  const { x, z0, z1, floor } = T217.bay, top = HULL.top;
  const d = top - floor, cz = (z0 + z1) / 2, L = z1 - z0;
  P.add('dark', box(x * 2, 0.04, L, 0, floor - 0.02, cz)); // floor plate
  for (const s of [-1, 1]) P.add('camo', box(0.04, d, L, s * (x - 0.02), floor + d / 2, cz), { tint: 0x9a9a9a });
  P.add('camo', box(x * 2, d, 0.04, 0, floor + d / 2, z0 + 0.02), { tint: 0x9a9a9a });
  P.add('camo', box(x * 2, d, 0.04, 0, floor + d / 2, z1 - 0.02), { tint: 0x9a9a9a });
  // the gunwale's coaming round the opening
  for (const s of [-1, 1]) P.add('camo', box(0.06, 0.05, L + 0.06, s * (x + 0.01), top + 0.02, cz));
  for (const z of [z0, z1]) P.add('camo', box(x * 2 + 0.08, 0.05, 0.06, 0, top + 0.02, z));
  // sleepers across the floor under the stacks, chocks at their ends, tie-down rails along the walls
  for (const dz of [-1.2, 0, 1.2]) {
    P.add('dark', box(2.3, 0.03, 0.14, 0, floor + 0.015, BAY_Z + dz));
    for (const s of [-1, 1]) P.add('dark', box(0.06, 0.12, 0.14, s * (STACK_X + BLOCK.w / 2 + 0.05), floor + 0.06, BAY_Z + dz));
  }
  for (const s of [-1, 1]) for (const y of [floor + 0.25, floor + 0.45]) P.add('steel', zTube(z0 + 0.3, z1 - 0.2, 0.012, 0.012, 5, s * (x - 0.06), y));
  // the pedestal plinth in the front of the well
  const { z } = T217.PED;
  P.add('dark', box(0.9, 0.08, 0.9, 0, floor + 0.04, z));
  P.add('camo', yTube(floor + 0.08, T217.PED.y - 0.1, 0.24, 0.3, 18, 0, z));
}

// ---------------------------------------------------------------- the tilt

// A thin canvas sheet between four corners (two triangles each face, both faces), for the hip and the roof.
function sheet(a, b, c, d, t = 0.015) {
  const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(d, a)).normalize().multiplyScalar(t / 2);
  const A = a.clone().add(n), B = b.clone().add(n), C = c.clone().add(n), D = d.clone().add(n);
  const A2 = a.clone().sub(n), B2 = b.clone().sub(n), C2 = c.clone().sub(n), D2 = d.clone().sub(n);
  const g = new THREE.BufferGeometry().setFromPoints([A, B, C, A, C, D, A2, C2, B2, A2, D2, C2, A, A2, B2, A, B2, B, B, B2, C2, B, C2, C, C, C2, D2, C, D2, D, D, D2, A2, D, A2, A]);
  g.computeVertexNormals();
  return g;
}

// The fixed tilt: the canvas walls on their frame along the bay, the front and rear walls up to the
// roof's lower edge, the top rail each half hinges on, and the bows and ridge pole (seen when the roof
// is open).
function tiltFixed(P) {
  const { z0, z1, x, wall, top: yt, hipF, hipR } = T217.tilt, deck = HULL.top, L = z1 - z0, cz = (z0 + z1) / 2;
  for (const s of [-1, 1]) {
    P.add('cloth', box(0.03, wall - deck, L, s * x, (wall + deck) / 2, cz));
    // the tie-down rope along the foot and the straps over the wall
    P.add('rubber', zTube(z0, z1, 0.012, 0.012, 4, s * (x + 0.02), deck + 0.06));
    for (let z = z0 + 0.4; z < z1 - 0.2; z += 0.75) P.add('cloth', box(0.012, wall - deck - 0.04, 0.05, s * (x + 0.018), (wall + deck) / 2, z), { tint: 0x8a8a7a });
    P.add('dark', zTube(z0 + 0.05, z1 - 0.05, 0.02, 0.02, 5, s * (x - 0.02), wall - 0.02)); // top rail (the roof's hinge)
  }
  P.add('cloth', box(x * 2, wall - deck, 0.03, 0, (wall + deck) / 2, z0));
  P.add('cloth', box(x * 2, wall - deck, 0.03, 0, (wall + deck) / 2, z1));
  // the frame under the canvas: ridge pole, bows, the hip rafters
  P.add('dark', zTube(hipF, hipR, 0.025, 0.025, 6, 0, yt - 0.04));
  for (let z = hipF + 0.5; z < hipR; z += 0.95) for (const s of [-1, 1]) {
    P.add('dark', rod(V(s * (x - 0.02), wall - 0.02, z), V(s * 0.55, yt - 0.05, z), 0.016, 5));
    P.add('dark', rod(V(s * 0.55, yt - 0.05, z), V(0, yt - 0.04, z), 0.016, 5));
  }
  for (const s of [-1, 1]) {
    P.add('dark', rod(V(s * (x - 0.02), wall - 0.02, z0 + 0.02), V(s * 0.55, yt - 0.05, hipF), 0.016, 5));
    P.add('dark', rod(V(s * (x - 0.02), wall - 0.02, z1 - 0.02), V(s * 0.55, yt - 0.05, hipR), 0.016, 5));
  }
}

// One roof half in its hinge's frame (the hinge on the wall top at the origin): the side slope up to the
// flat top's edge, half the flat top, and the halves of the front and rear hips, so the tilt splits
// along its centre line. side -1 is the left half (built toward +X), +1 the right.
function roofHalf(side) {
  const { z0, z1, x, wall, top: yt, edge, hipF, hipR } = T217.tilt, d = -side;
  const h = yt - wall, P = (px, py, pz) => V(d * px, py, pz);
  const A0 = P(0, 0, z0), A1 = P(0, 0, z1), B0 = P(x - edge, h, hipF), B1 = P(x - edge, h, hipR);
  const C0 = P(x - 0.01, h + 0.02, hipF), C1 = P(x - 0.01, h + 0.02, hipR), F = P(x - 0.01, 0, z0), R = P(x - 0.01, 0, z1);
  return [sheet(A0, A1, B1, B0), sheet(B0, B1, C1, C0), sheet(A0, B0, C0, F), sheet(A1, R, C1, B1)];
}

function tilt(rig) {
  const { x, wall } = T217.tilt;
  const halves = [-1, 1].map((s) => {
    const g = pivotAt(rig, rig.root, s < 0 ? 'roofL' : 'roofR', s * x, wall, 0);
    const A = new Parts(rig.mats);
    for (const q of roofHalf(s)) A.add('cloth', q);
    A.build(g, { dirt: 0.2, y0: wall });
    return g;
  });
  // left (toward the launcher): over and down the outside of the wall; right: up, leaning out a little
  rig.setRoof = (v) => {
    const k = Math.min(1, Math.max(0, v));
    halves[0].rotation.z = 4.1 * THREE.MathUtils.smootherstep(k, 0, 1);
    halves[1].rotation.z = -1.95 * THREE.MathUtils.smootherstep(k, 0, 0.8);
    rig.roof = k;
  };
  rig.setRoof(0);
}

// ---------------------------------------------------------------- the crane

// Pedestal crane: the slewing column with its drive and the operator's valve bank, the outer box boom
// on its root pin with the luffing ram under it, the inner section sliding out of it (stenciled), the
// hanger, the rotator and the spreader for a block of three (a frame over the block with clamp legs
// down its sides at the ends).
function crane(rig) {
  const { mats, root } = rig;
  const { z, y, top } = T217.PED;
  const slew = pivotAt(rig, root, 'crane', 0, y, z);
  const S = new Parts(mats);
  const ry = top - y; // boom root above the slew bearing
  S.add('camo', yTube(0, 0.12, 0.32, 0.32, 20, 0, 0)); // slewing ring
  S.add('camo', rbox(0.42, ry + 0.05, 0.46, 0.04, 0, ry / 2 + 0.05, 0.05));
  S.add('dark', box(0.3, 0.26, 0.24, -0.26, 0.2, 0.2)); // slew drive
  for (const s of [-1, 1]) S.add('camo', box(0.06, 0.28, 0.32, s * 0.2, ry, 0.0)); // root pin cheeks
  S.add('dark', xTube(-0.25, 0.25, 0.06, 0.06, 10, ry, 0));
  S.add('camo', rbox(0.3, 0.24, 0.16, 0.03, 0.3, 0.42, 0.2)); // valve bank with levers
  for (let i = 0; i < 4; i++) S.add('dark', rod(V(0.2 + i * 0.065, 0.54, 0.22), V(0.2 + i * 0.065, 0.66, 0.3), 0.009, 4));
  S.build(slew, { dirt: 0.2, y0: y });
  // the boom: outer box section along -Z from the root pin
  const bm = pivotAt(rig, slew, 'craneBoom', 0, ry, 0);
  const B = new Parts(mats);
  const { base, EXT, drop } = T217.BOOM, bw = 0.24, bh = 0.24;
  B.add('camo', rbox(bw, bh, base + 0.15, 0.03, 0, 0, -(base - 0.15) / 2 + 0.05));
  B.add('dark', box(bw + 0.01, bh - 0.06, 0.04, 0, 0, -base + 0.1)); // the mouth of the outer section
  B.add('dark', box(0.2, 0.1, 0.16, 0, -0.16, -0.85)); // ram lug
  for (const s of [-1, 1]) B.add('white', box(0.005, 0.06, 0.75, s * (bw / 2 + 0.003), 0.03, -1.1), { tint: 0xb8b8b0 }); // stencil
  B.add('rubber', zTube(0.0, -base + 0.2, 0.018, 0.018, 5, bw / 2 + 0.03, -0.05)); // hydraulic lines
  B.add('rubber', zTube(0.0, -base + 0.2, 0.018, 0.018, 5, bw / 2 + 0.03, 0.04));
  B.build(bm, { dirt: 0.1, y0: top });
  // two telescopic sections: the middle one moves out half the extension, the inner one (with the head)
  // half again on it, so they nest when retracted and overlap by 0.7 m at full stretch
  const ext = pivotAt(rig, bm, 'craneExt', 0, 0, 0);
  const E = new Parts(mats);
  E.add('camo', box(0.2, 0.2, 2.15, 0, 0, -1.02));
  E.add('dark', box(0.21, 0.15, 0.03, 0, 0, -2.08));
  E.build(ext, { dirt: 0.05, y0: top });
  const inner = new THREE.Group();
  inner.name = 'craneExt2';
  ext.add(inner);
  const I = new Parts(mats);
  I.add('camo', box(0.16, 0.16, 2.15, 0, 0, -1.05));
  I.add('camo', rbox(0.22, 0.22, 0.2, 0.03, 0, 0, -base - 0.05)); // the head
  for (const s of [-1, 1]) I.add('dark', box(0.03, 0.12, 0.16, s * 0.1, -drop + 0.04, -base - 0.05)); // hanger cheeks
  I.add('dark', xTube(-0.12, 0.12, 0.03, 0.03, 8, -drop, -base - 0.05));
  I.build(inner, { dirt: 0.05, y0: top });
  // the hanger under the tip, plumb; the rotator and the spreader
  const hd = pivotAt(rig, inner, 'craneHead', 0, -drop, -base - 0.05);
  const H = new Parts(mats);
  H.add('dark', box(0.07, 0.1, 0.08, 0, -0.03, 0));
  H.add('dark', yTube(-0.14, -0.08, 0.12, 0.12, 14, 0, 0)); // rotator ring
  H.build(hd, { dirt: 0, y0: top });
  const rot = pivotAt(rig, hd, 'craneRotator', 0, -0.14, 0);
  const R = new Parts(mats);
  // the spreader: a beam along the block (z), cross heads at its ends, clamp legs down its sides to
  // the block's mid-height
  const sy = -0.08, mid = -(T217.HANG - 0.14); // beam centre and the block's middle below the rotator
  R.add('camo', box(0.16, 0.12, 2.3, 0, sy, 0));
  for (const e of [-1, 1]) {
    const zz = e * 1.05;
    R.add('camo', box(BLOCK.w + 0.16, 0.1, 0.12, 0, sy, zz));
    for (const s of [-1, 1]) {
      const lx = s * (BLOCK.w / 2 + 0.05);
      R.add('camo', box(0.06, sy - mid, 0.1, lx, (sy + mid) / 2, zz)); // leg
      R.add('dark', box(0.08, 0.1, 0.14, lx - s * 0.03, mid + 0.02, zz)); // clamp jaw
    }
    R.add('rubber', rod(V(0.06, sy + 0.06, 0.1), V(0.06, sy + 0.06, zz - e * 0.15), 0.015, 4));
  }
  R.build(rot, { dirt: 0.1, y0: 3 });
  rig.anchors.craneLoad = node(rot, 'craneLoad', 0, mid, 0);
  // the luffing ram: barrel on the column, rod to the boom's lug, posed by setCrane
  const barrel = new THREE.Group(), rod2 = new THREE.Group();
  slew.add(barrel, rod2);
  const Rb = new Parts(mats), Rr = new Parts(mats);
  Rb.add('camo', zTube(0, -0.75, 0.075, 0.075, 12, 0, 0));
  Rr.add('steel', zTube(0, -0.8, 0.045, 0.045, 10, 0, 0));
  Rb.build(barrel, { dirt: 0.1, y0: top });
  Rr.build(rod2, { dirt: 0.05, y0: top });
  const A = V(0, ry - 0.42, -0.2); // ram foot on the column's front (slew space)
  const B0 = V(0, -0.16, -0.85); // ram head on the boom (boom space)
  const Bp = new THREE.Vector3(), X = V(1, 0, 0);
  const st = { slew: 0, luff: 0, ext: 0, rotate: 0 };
  rig.crane = st;
  rig.setCrane = (o = {}) => {
    Object.assign(st, o);
    slew.rotation.y = st.slew;
    bm.rotation.x = st.luff;
    ext.position.z = inner.position.z = -Math.min(EXT, Math.max(0, st.ext)) / 2;
    hd.rotation.x = -st.luff;
    rot.rotation.y = st.rotate;
    Bp.copy(B0).applyAxisAngle(X, st.luff).add(bm.position);
    const dy = Bp.y - A.y, dz = Bp.z - A.z, d = Math.hypot(dy, dz);
    barrel.position.copy(A);
    barrel.rotation.x = Math.atan2(dy, -dz);
    rod2.position.copy(Bp);
    rod2.rotation.x = Math.atan2(-dy, dz);
    barrel.scale.z = Math.min(1, Math.max(0.3, (d - 0.05) / 0.75));
    rod2.scale.z = Math.min(1.4, Math.max(0.3, d / 0.8));
  };
  // The solver: the hanger pin is drop under the boom's axis at base + 0.05 + ext from the root pin, the
  // block's middle HANG under the pin (plumb): rotate (Lh, -drop) by the luff onto the pin's offset.
  rig.solveCrane = (p, yaw, out = {}) => {
    const dx = p.x, dz = p.z - z;
    const u = Math.hypot(dx, dz), v = p.y + T217.HANG - top;
    out.slew = Math.atan2(-dx, -dz);
    const Lh = Math.sqrt(Math.max(0.01, u * u + v * v - drop * drop));
    out.luff = Math.atan2(v, u) + Math.atan2(drop, Lh);
    const e = Lh - base - 0.05;
    out.ok = e >= -0.05 && e <= EXT + 0.05;
    out.ext = Math.min(EXT, Math.max(0, e));
    out.rotate = yaw - out.slew;
    return out;
  };
}

// ---------------------------------------------------------------- the rig

export function build9T217() {
  const rig = newRig('green');
  const { P, root, mats } = rig;
  const { bay: b } = T217;
  buildBaz(P, { wheels: false, ring: false, hatches: false, deckHole: [[-b.x, b.z0], [b.x, b.z0], [b.x, b.z1], [-b.x, b.z1]] });
  bay(P);
  tiltFixed(P);
  // the cab roof hatches' frames and periscopes (the lids are pivots)
  const top = HULL.top, { x: hx, z: hz } = T217.hatch;
  for (const s of [-1, 1]) {
    P.add('dark', box(0.48, 0.02, 0.62, s * hx, top + 0.0, hz));
    P.add('dark', box(0.4, 0.03, 0.52, s * hx, top + 0.005, hz)); // the opening
    for (const dx of [-0.1, 0.1]) P.add('glass', box(0.1, 0.05, 0.02, s * hx + dx, top + 0.07, -2.71));
    P.add('dark', box(0.34, 0.08, 0.08, s * hx, top + 0.05, -2.67));
  }
  // the rotating beacon on the tilt's front (warsaw_2013), its cable down the front wall
  P.add('dark', box(0.2, 0.06, 0.2, -0.75, top + 0.03, T217.tilt.z0 - 0.15));
  P.add('amber', yTube(top + 0.06, top + 0.24, 0.07, 0.065, 10, -0.75, T217.tilt.z0 - 0.15));
  P.add('dark', yTube(top + 0.24, top + 0.27, 0.075, 0.06, 10, -0.75, T217.tilt.z0 - 0.15));
  P.build(root, { dirt: 0.55 });
  for (const s of [-1, 1]) {
    const h = pivotAt(rig, root, s < 0 ? 'hatchL' : 'hatchR', s * hx, top + 0.03, hz - 0.3);
    const L = new Parts(mats);
    L.add('camo', rbox(0.46, 0.07, 0.6, 0.025, 0, 0, 0.3));
    L.add('steel', rod(V(-0.15, 0.06, 0.45), V(0.15, 0.06, 0.45), 0.014, 5));
    L.add('dark', box(0.4, 0.03, 0.08, 0, -0.04, 0.02)); // hinge
    L.build(h, { dirt: 0.3, y0: top });
    rig.anchors[s < 0 ? 'hatchL' : 'hatchR'] = node(root, s < 0 ? 'hatchSpotL' : 'hatchSpotR', s * hx, top - 1.05, hz + 0.05);
  }
  tilt(rig);
  crane(rig);
  rig.craneTravel = { ...rig.solveCrane(V(BAY[2].x, BAY[2].y, BAY[2].z), Math.PI, {}) };
  rig.setCrane(rig.craneTravel);
  // the wheels turn and the front and rear axles steer
  const { axles, R, W, track } = HULL;
  const wheels = spinWheels(root, mats, axles.flatMap((z, i) => [-1, 1].map((s) => ({ x: s * track, y: R, z, steer: T217.steer[i] }))), R, (Q, r) => {
    Q.add('tyre', bazTyre(r, W));
    bazHub(Q, 0, 0, 0, 1);
  });
  rig.setWheels = wheels.set;
  rig.wheelR = R;
  rig.axles = axles;
  rig.BAY = BAY;
  rig.anchors.eye = node(root, 'eye', 0, 2.4, 0.3);
  rig.anchors.operator = node(root, 'operator', 0.8, T217.bay.floor, T217.PED.z - 0.05);
  hb(rig, -HULL.hw, 0.35, HULL.front, HULL.hw, top, HULL.rear);
  hb(rig, -T217.tilt.x, top, T217.tilt.z0, T217.tilt.x, T217.tilt.top, T217.tilt.z1);
  return rig;
}
