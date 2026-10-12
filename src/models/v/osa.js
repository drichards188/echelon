import * as THREE from 'three';
import { V, box, rbox, yTube, zTube, xTube, sphere, rod, frontProfile, sideProfile, dish, Parts } from '../kit.js';
import { newRig, node, pivotAt, hb } from '../rig.js';
import { buildBaz, HULL } from './baz5937.js';

// 9A33BM3 Osa-AKM on the BAZ-5937. The turret carries, front to back: the antenna post (the 9S33
// tracking radar under its flat cover, a missile-guidance dish either side, the TV sight on top),
// the folding search radar on its mast in the middle, and the two launcher panels of three 9M33M3
// containers on the flanks, pivoted on cradles a third of the way from their rear ends.
// Turret frame: origin on the ring at deck height, 0.15 m behind mid-hull.

const TAN = 0xb39f7a; // canvas-covered antenna faces (white material, tinted)
const TEAL = 0x9fc7bc; // dish interiors (camo material, tinted)
const CAP = 0xe6e6df; // container front covers
const EL_MAX = 0.6; // launcher elevation stop (rad): the panel tails reach the rear deck

// Flat tracking antenna cover seen head on: a broad arc at the bottom, straight sides, the top
// corners cut off. Centred on the dish axis.
function plateOutline() {
  const pts = [];
  const n = 10, w = 0.55, yb = -0.42, sag = 0.24;
  for (let i = 0; i <= n; i++) { const x = w - (2 * w * i) / n; pts.push([x, yb - sag * (1 - (x / w) ** 2)]); }
  pts.push([-w, 0.48], [-0.34, 0.67], [0.34, 0.67], [w, 0.48]);
  return pts.reverse();
}

// The search antenna: a wide, shallow reflector of wire mesh on a lattice frame (curved in plan,
// concave forward), the feed on struts at its focus and the small cage antenna on top. Built
// around the rotation axis, y up from the mast head.
function searchAntenna(S, yc) {
  const W = 0.92, H = 0.38, D = 0.26, Dv = 0.14, zv = 0.16, tilt = 0.33; // tilted back 19 deg
  const n = 12, ct = Math.cos(tilt), st = Math.sin(tilt);
  // a point on the dish (dished both ways, concave forward), then tilted back about the centre line
  const P = (x, v) => {
    const z = zv - D * (1 - (x / W) ** 2) - Dv * (1 - (v / H) ** 2);
    return V(x, yc + v * ct + (z - zv) * st, zv + (z - zv) * ct - v * st);
  };
  // the mesh: a thin dark sheet under the frame, in strips so it follows the curve
  const sheet = [];
  for (let i = 0; i < n; i++) for (let j = 0; j < 4; j++) {
    const x0 = -W + (2 * W * i) / n, x1 = -W + (2 * W * (i + 1)) / n, v0 = -H + (H * j) / 2, v1 = -H + (H * (j + 1)) / 2;
    const a = P(x0, v0), b = P(x1, v0), c = P(x1, v1), d = P(x0, v1);
    sheet.push(a, c, b, a, d, c, a, b, c, a, c, d); // both faces
  }
  S.add('camo', new THREE.BufferGeometry().setFromPoints(sheet), { tint: 0x7a8072 });
  // rails top, middle, bottom and a few wires across the mesh
  for (let j = 0; j <= 6; j++) {
    const v = -H + (2 * H * j) / 6, main = j % 3 === 0;
    for (let i = 0; i < n; i++) {
      const x0 = -W + (2 * W * i) / n, x1 = -W + (2 * W * (i + 1)) / n;
      const o = main ? 0 : -0.012;
      S.add('camo', rod(P(x0, v).setZ(P(x0, v).z + o), P(x1, v).setZ(P(x1, v).z + o), main ? 0.022 : 0.007, main ? 6 : 3));
    }
  }
  // vertical ribs bent to the dish, and diagonals in alternate bays
  for (let i = 0; i <= n; i++) {
    const x = -W + (2 * W * i) / n, rib = i % 3 === 0 ? 0.022 : 0.01;
    for (let j = 0; j < 4; j++) S.add('camo', rod(P(x, -H + (H * j) / 2), P(x, -H + (H * (j + 1)) / 2), rib, 4));
    if (i < n && i % 2 === 0) {
      const x1 = -W + (2 * W * (i + 1)) / n;
      S.add('camo', rod(P(x, -H), P(x1, 0), 0.01, 4));
      S.add('camo', rod(P(x1, 0), P(x, H), 0.01, 4));
    }
  }
  // back frame onto the mast head
  const back = (v) => V(0, yc + v * ct + 0.1 * st, zv + 0.1 * ct - v * st);
  S.add('camo', rod(back(-H - 0.05), back(H + 0.05), 0.05, 6));
  for (const x of [-0.6, 0.6]) {
    S.add('camo', rod(back(-0.1), P(x, -H), 0.016, 5));
    S.add('camo', rod(back(0.1), P(x, H), 0.016, 5));
  }
  S.add('camo', rod(V(0, yc - H - 0.25, zv + 0.02), back(-H - 0.02), 0.06, 6));
  // feed: a horn box on struts out at the focal line
  const f = P(0, 0).add(V(0, 0.46 * st, -0.46 * ct));
  S.add('camo', rbox(0.28, 0.2, 0.18, 0.03, f.x, f.y, f.z, -tilt));
  S.add('dark', box(0.2, 0.12, 0.02, f.x, f.y + 0.02, f.z - 0.095, -tilt));
  S.add('camo', rod(P(-0.32, H), f.clone().add(V(-0.08, 0.06, 0.05)), 0.012, 4));
  S.add('camo', rod(P(0.32, -H), f.clone().add(V(0.08, -0.06, 0.05)), 0.012, 4));
  S.add('camo', rod(P(-0.32, -H), f.clone().add(V(-0.08, -0.06, 0.05)), 0.012, 4));
  // the cage antenna on top, behind the rim: a part-cylinder of ribs and hoops, open to the front
  const top = P(0, H), cy0 = top.y + 0.05, cy1 = cy0 + 0.42, r = 0.3, cz = top.z + 0.1;
  for (let i = 0; i <= 8; i++) {
    const a = -1.9 + (3.8 * i) / 8;
    const x = Math.sin(a) * r, z = cz + Math.cos(a) * r;
    S.add('camo', rod(V(x, cy0, z), V(x, cy1, z), i % 4 === 0 ? 0.014 : 0.008, 4));
  }
  for (const y of [cy0, cy0 + 0.14, cy0 + 0.28, cy1]) for (let i = 0; i < 8; i++) {
    const a0 = -1.9 + (3.8 * i) / 8, a1 = -1.9 + (3.8 * (i + 1)) / 8;
    S.add('camo', rod(V(Math.sin(a0) * r, y, cz + Math.cos(a0) * r), V(Math.sin(a1) * r, y, cz + Math.cos(a1) * r), y === cy0 || y === cy1 ? 0.014 : 0.007, 4));
  }
  S.add('camo', rod(back(H + 0.04), V(0, cy0, cz + r), 0.025, 5));
  S.add('steel', yTube(cy1, cy1 + 0.18, 0.012, 0.006, 4, 0, cz + r)); // top whip
}

// The launcher panels in the elevation pivot's frame (trunnion at turret (0, EL_Y, EL_Z)): each panel's
// three containers lie side by side about x = side * CX with their axes AX above the trunnion, noses at
// Z0 and tails at Z1. The reload scene (render/reload/osa.js) moves the containers as a block of three.
export const OSA_PANEL = { TY: HULL.top, TZ: 0.15, EL_Y: 0.62, EL_Z: 1.45, AX: 0.31, Z0: -2.2, Z1: 1.1, CX: 0.85 };

/**
 * One panel's block of three 9M33M3 containers (side -1 left, +1 right) into a parts collector, in the
 * elevation pivot's frame: the bodies with their end frames and mouths, the ribbed skins, the bands.
 * The cradle under it stays with the launcher; rig.blocks[0 | 1] are these, one group per side.
 */
export function osaBlockParts(L, s) {
  const { AX, Z0, Z1, CX } = OSA_PANEL;
  const cx = s * CX;
  // three containers side by side in one panel
  L.add('camo', box(1.0, 0.3, Z1 - Z0 - 0.12, cx, AX, (Z0 + Z1) / 2 + 0.02));
  for (let k = 0; k < 3; k++) {
    const x = cx + (k - 1) * 0.333;
    L.add('camo', rbox(0.325, 0.32, 0.09, 0.02, x, AX, Z0 + 0.05)); // front end frame
    L.add('dark', box(0.25, 0.23, 0.01, x, AX, Z0 - 0.002)); // the open mouth once the cover is gone
    L.add('camo', rbox(0.32, 0.31, 0.07, 0.02, x, AX, Z1 - 0.06)); // rear end frame and its closure
    L.add('dark', box(0.22, 0.2, 0.02, x, AX, Z1 - 0.02));
  }
  // corrugated top and outer side, reinforcing bands
  // (each container has its own ribbed skin, so the top reads as three rows with seams between)
  for (let i = 0; i < 41; i++) {
    const zz = Z0 + 0.16 + i * 0.075;
    for (let k = 0; k < 3; k++) L.add('camo', box(0.3, 0.024, 0.036, cx + (k - 1) * 0.333, AX + 0.162, zz));
    L.add('camo', box(0.024, 0.27, 0.036, s * 1.362, AX, zz));
  }
  for (const f of [0.22, 0.5, 0.76, 0.97]) L.add('camo', box(1.03, 0.33, 0.07, cx, AX, Z0 + (Z1 - Z0) * f));
  for (let k = 1; k < 3; k++) L.add('dark', box(0.03, 0.02, Z1 - Z0 - 0.2, cx + (k - 1.5) * 0.333, AX + 0.155, (Z0 + Z1) / 2)); // seams
}

export function buildOsa() {
  const rig = newRig('green'), { P, root, mats } = rig;
  buildBaz(P);
  P.build(root, { dirt: 0.55 });

  const TY = HULL.top, TZ = 0.15;
  const tur = pivotAt(rig, root, 'turret', 0, TY, TZ);
  const T = new Parts(mats);
  const EL_Y = 0.62, EL_Z = 1.45; // launcher trunnion in the turret frame
  const hz = -1.3, hy = 0.97; // tracking antenna trunnion
  // base: a low armoured riser with a sloped front and rows of lockers down its flanks
  T.add('camo', sideProfile([[-1.4, 0.04], [-1.4, 0.24], [-1.2, 0.44], [1.12, 0.44], [1.22, 0.34], [1.22, 0.04]], 1.9, 0.03));
  T.add('dark', yTube(0.0, 0.06, 1.0, 1.0, 32));
  let z = -1.25;
  for (const len of [0.46, 0.34, 0.5, 0.36, 0.34, 0.44, 0.4]) {
    for (const s of [-1, 1]) {
      T.add('camo', rbox(0.1, 0.36, len - 0.03, 0.03, s * 0.97, 0.24, z + len / 2, 0, 0, s * 0.1));
      T.add('dark', box(0.03, 0.03, 0.1, s * 1.02, 0.32, z + len / 2));
    }
    z += len;
  }
  // centre column between the panels: equipment cabinets, the launcher drive drum, the radar mast seat
  T.add('camo', rbox(0.6, 0.56, 1.9, 0.05, 0, 0.7, 0.35));
  T.add('camo', rbox(0.5, 0.14, 0.6, 0.03, 0, 1.02, 0.75));
  T.add('dark', xTube(-0.42, 0.42, 0.16, 0.16, 16, 0.78, 1.0)); // launcher elevation drive
  for (const s of [-1, 1]) {
    T.add('camo', xTube(s * 0.3, s * 0.46, 0.2, 0.2, 18, 0.78, 1.0));
    T.add('camo', rbox(0.12, 0.3, 0.5, 0.02, s * 0.34, 0.62, 0.0));
    T.add('tyre', rod(V(s * 0.25, 0.95, -0.4), V(s * 0.3, 0.5, 0.6), 0.02, 5)); // cable runs
  }
  // cradle trunnion brackets for the launcher panels
  for (const x of [-0.92, -0.42, 0.42, 0.92]) T.add('dark', box(0.08, 0.3, 0.32, x, 0.55, EL_Z));
  // antenna post: a tall cabinet behind the tracking antenna, stacked with equipment and the TV sight
  T.add('camo', rbox(0.7, 1.15, 0.78, 0.05, 0, 0.95, hz + 0.7));
  T.add('camo', rbox(0.56, 0.5, 0.3, 0.04, 0, 0.7, hz + 1.2));
  T.add('camo', rbox(0.46, 0.26, 0.42, 0.03, 0, 1.37, hz + 0.95));
  for (const s of [-1, 1]) {
    T.add('camo', rbox(0.12, 0.4, 0.46, 0.02, s * 0.4, 1.15, hz + 0.75));
    T.add('camo', rbox(0.1, 0.3, 0.3, 0.02, s * 0.4, 0.62, hz + 0.6));
    T.add('dark', box(0.02, 0.05, 0.12, s * 0.465, 1.25, hz + 0.75));
    T.add('tyre', rod(V(s * 0.36, 1.45, hz + 1.05), V(s * 0.46, 0.85, hz + 0.95), 0.018, 5));
    T.add('dark', box(0.06, 0.3, 0.3, s * 0.38, hy, hz + 0.33)); // trunnion bearings
  }
  T.add('steel', xTube(-0.42, 0.42, 0.04, 0.04, 8, hy, hz + 0.33));
  T.build(tur, { dirt: 0.25, y0: TY });

  // ---- launcher: elevation pivot on the cradle trunnions (turret frame)
  const el = pivotAt(rig, tur, 'elevation', 0, EL_Y, EL_Z);
  // the panels stop where their tails meet the rear deck (the sim's elevations stay under it)
  const pan = new THREE.Group();
  el.add(pan);
  pan.updateMatrix = function () {
    this.rotation.x = -Math.max(0, el.rotation.x - EL_MAX);
    THREE.Object3D.prototype.updateMatrix.call(this);
  };
  const L = new Parts(mats);
  const AX = 0.31, Z0 = -2.2, Z1 = 1.1; // panel axis above the trunnion, nose and tail (3.3 m containers)
  L.add('dark', xTube(-1.0, 1.0, 0.055, 0.055, 10, 0, 0));
  const slotXY = [];
  rig.blocks = [];
  for (const s of [-1, 1]) {
    const cx = s * 0.85;
    for (let k = 0; k < 3; k++) slotXY.push([cx + (k - 1) * 0.333, AX]);
    // the block of three containers, its own group (the reload scene lifts it off and sets one on)
    const B = new Parts(mats);
    osaBlockParts(B, s);
    const blk = new THREE.Group();
    blk.name = s < 0 ? 'blockL' : 'blockR';
    pan.add(blk);
    B.build(blk, { dirt: 0.1, y0: TY + EL_Y + AX });
    rig.blocks.push(blk);
    // tail tray past the rear ends
    L.add('dark', box(0.96, 0.04, 0.2, cx, AX - 0.12, Z1 + 0.07));
    // cradle: a box beam under the panel on the trunnion, and a lattice of tubes slung under it
    // (two lower chords, zigzag diagonals up to the panel's bottom rails, cross ties)
    const yb = AX - 0.16, yl = -0.06, zA = Z0 + 0.6, zB = Z1 - 0.05, nb = 6, bay = (zB - zA) / nb;
    L.add('camo', box(0.16, 0.14, Z1 - Z0 - 0.3, cx, yb - 0.07, (Z0 + Z1) / 2 + 0.1));
    for (const dx of [-0.36, 0.36]) {
      const x = cx + dx;
      L.add('camo', box(0.06, 0.06, Z1 - Z0 - 0.3, x, yb - 0.03, (Z0 + Z1) / 2 + 0.1));
      L.add('camo', rod(V(x, yl, zA), V(x, yl, zB), 0.022, 5));
      for (let i = 0; i < nb; i++) {
        const z0 = zA + i * bay;
        L.add('camo', rod(V(x, yl, z0), V(x, yb - 0.05, z0 + bay / 2), 0.016, 4));
        L.add('camo', rod(V(x, yb - 0.05, z0 + bay / 2), V(x, yl, z0 + bay), 0.016, 4));
      }
      L.add('camo', rod(V(cx + dx * 0.3, 0.02, 0.0), V(x, yl, -0.5), 0.024, 5));
      L.add('camo', rod(V(cx + dx * 0.3, 0.02, 0.0), V(x, yl, 0.5), 0.024, 5));
    }
    for (let i = 0; i <= nb; i += 2) L.add('camo', rod(V(cx - 0.36, yl, zA + i * bay), V(cx + 0.36, yl, zA + i * bay), 0.016, 4));
    L.add('dark', rbox(0.2, 0.22, 0.3, 0.02, cx, 0.06, 0.0)); // trunnion block
  }
  L.build(pan, { dirt: 0.1, y0: TY + EL_Y + AX });
  slotXY.forEach(([x, y], i) => {
    const g = new THREE.Group();
    const M = new Parts(mats);
    M.add('white', sphere(0.13, x, y, Z0 - 0.005, 1.0, 0.95, 0.35, 14), { tint: CAP });
    M.add('white', rbox(0.29, 0.27, 0.025, 0.02, x, y, Z0 - 0.012), { tint: CAP });
    M.build(g, { y0: TY + EL_Y });
    pan.add(g);
    rig.slots.push([g]);
    rig.anchors.missileSlots.push(node(pan, 'slot' + i, x, y, Z0 - 0.06));
  });
  // the front covers come off whole when a round leaves (main throws a copy with fx.throwLid)
  rig.lids = rig.slots.map(([g]) => g);

  // ---- tracking antenna: the flat cover over the 9S33 dish, a missile-guidance dish either side,
  // command-link horns under them. It tilts on its trunnion in front of the antenna post on its own
  // drive, apart from the launcher panels: `trackRadar` (rotation.x, + = the face looks up) points it
  // at the target while the tracking radar emits. On parade (0) the cover stands vertical.
  const tr = pivotAt(rig, tur, 'trackRadar', 0, hy, hz);
  const D = new Parts(mats);
  D.add('camo', dish(0.56, 0.2, 0.03, 32).translate(0, -0.1, 0.06), { tint: TEAL });
  D.add('dark', new THREE.TorusGeometry(0.56, 0.018, 6, 32).translate(0, -0.1, -0.14));
  D.add('white', frontProfile(plateOutline(), -0.45, -0.41), { tint: TAN });
  for (const s of [-1, 1]) { // stand-off rungs from the cover's frame back to the dish rim
    D.add('dark', yTube(-0.48, 0.5, 0.016, 0.016, 5, s * 0.5, -0.39));
    for (const y of [-0.42, -0.2, 0.02, 0.24, 0.45]) D.add('dark', rod(V(s * 0.5, y, -0.39), V(s * 0.5, y, -0.13), 0.012, 4));
  }
  for (const [x, y] of [[-0.42, 0.5], [0.42, 0.5], [-0.48, -0.1], [0.48, -0.1], [0, 0.6], [0, -0.55], [-0.3, -0.45], [0.3, -0.45]]) D.add('dark', zTube(-0.45, -0.465, 0.018, 0.012, 6, x, y));
  D.add('camo', zTube(0.06, 0.3, 0.16, 0.12, 14, 0, -0.1)); // feed housing behind the dish
  D.add('camo', rbox(0.7, 0.2, 0.2, 0.03, 0, -0.1, 0.3)); // yoke across to the trunnions
  // TV-optical sight on the cover's top edge, boresighted with the antenna
  D.add('camo', rbox(0.3, 0.12, 0.5, 0.03, 0.08, 0.72, 0.12));
  D.add('camo', zTube(-0.3, 0.45, 0.115, 0.115, 16, 0.12, 0.86));
  D.add('camo', zTube(-0.1, 0.4, 0.07, 0.07, 12, -0.14, 0.82));
  D.add('dark', zTube(-0.42, -0.3, 0.13, 0.125, 16, 0.12, 0.86, true));
  D.add('glass', zTube(-0.31, -0.3, 0.105, 0.105, 16, 0.12, 0.86));
  for (const s of [-1, 1]) {
    const x = s * 1.0;
    D.add('camo', rbox(0.46, 0.24, 0.3, 0.04, s * 0.62, 0.0, 0.08)); // arm out to the guidance dish
    D.add('camo', zTube(-0.06, 0.32, 0.27, 0.2, 20, x, 0.0));
    D.add('camo', zTube(-0.1, -0.04, 0.315, 0.29, 24, x, 0.0), { tint: TEAL });
    D.add('white', zTube(-0.125, -0.095, 0.305, 0.305, 24, x, 0.0), { tint: TAN });
    D.add('camo', rbox(0.34, 0.4, 0.34, 0.03, x, -0.46, 0.14)); // electronics under the dish
    D.add('white', zTube(-0.12, 0.1, 0.11, 0.11, 14, s * 1.0, -0.44), { tint: 0xd8d4c4 }); // command-link horn cans
    D.add('white', box(0.13, 0.1, 0.08, s * 1.24, -0.34, -0.06), { tint: 0xe8e8e8 });
  }
  D.build(tr, { dirt: 0, y0: TY + hy });

  // ---- search radar on its mast, spinning (child of the turret)
  const sr = pivotAt(rig, tur, 'searchRadar', 0, 1.09, -0.1);
  const S = new Parts(mats);
  S.add('dark', yTube(0, 0.08, 0.2, 0.2, 16));
  // the reflector clears the panel noses up to the launcher stop as it turns
  S.add('camo', yTube(0.08, 0.9, 0.13, 0.1, 14));
  S.add('camo', rbox(0.34, 0.26, 0.4, 0.04, 0, 0.95, 0.12)); // fold hinge and drive head
  S.add('dark', xTube(-0.2, 0.2, 0.06, 0.06, 10, 0.95, 0.12));
  for (const s of [-1, 1]) S.add('camo', rod(V(s * 0.12, 0.3, 0.05), V(s * 0.05, 0.85, 0.12), 0.025, 5)); // fold strut
  searchAntenna(S, 1.48);
  S.build(sr, { dirt: 0, y0: TY + 1.09 });

  rig.anchors.eye = node(root, 'eye', 0, 2.2, 0.3);
  hb(rig, -1.4, 0.35, -4.4, 1.4, 1.95, 4.4);
  hb(rig, -1.4, 1.93, -1.9, 1.4, 4.2, 3.1);
  return rig;
}
