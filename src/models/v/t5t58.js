import * as THREE from 'three';
import { toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { V, xf, box, rbox, yTube, zTube, xTube, sphere, rod, lathe, sideProfile, addLamp, Parts, vehicleMats, grainTextures, surfaceFinish } from '../kit.js';
import { newRig, node, pivotAt, hb } from '../rig.js';
import { lugTyre, discHub, rb } from './ural.js';
import { mudFlap, extinguisher, ladder } from '../trucks.js';
import { spinWheels, heavyWheel } from './t22t6.js';

// 5T58-2 transporter of the S-400: the semitrailer that carries four spare canisters, two over two, in
// two portal cradles, behind its BAZ-64022 6x6 tractor (refs/reload/README.md section 1a; side photo
// refs/s400-support/photos/Tractor_5T58_2_mod.jpg, the trailer in refs/reload/photos/s400_22t6_ashuluk_3,
// 5 and 6). The tractor: a flat-faced cab-forward cab wholly ahead of the first axle (as on the MAZ-543),
// two windscreen panes over a deep black bumper, the engine bay behind it with two air cleaner pots and a
// spare wheel on the roof rack, a second spare standing behind the bay, the fifth wheel over the rear
// tandem. The trailer: a raised front deck over the tractor with two tool boxes and a railing, a swan
// neck down to the main frame, two portal cradles holding the canisters (bases forward, mouths to the
// rear), a two-axle bogie under the rear. Dimensions are estimates from the photos (1.5 m tractor
// tyres, 7.87 m canisters as rulers). Model space: front -Z, ground y = 0, origin at the middle of the
// tractor.
//
// Also the canister itself, the 48N6 container and the 9M96 pack as the 5P85SM2-01 TEL carries them
// (tel.js; same profile, covers and materials, so a canister lifted between a TEL, this trailer and the
// ground looks the same everywhere): canisterParts / coverParts / packParts build one along +Z from
// the mouth lip at z = 0 (the cover in front of it, toward -Z), canisterMats() is the shared set.
//
// Pivots and rig extras:
//   trailer      the semitrailer, hinged at the kingpin on the fifth wheel (rotation.y: articulation,
//                + = the trailer swings to the tractor's left behind it). Its frame: origin on the
//                ground under the kingpin, +Z back along the trailer.
//   anchors.cargo[0..3]  (trailer) the canister mouths: lower left, lower right, upper left, upper
//                right; -Z out of the mouth (toward the trailer's rear), as the TEL's anchors.mouths.
//   setLoaded(i, loaded)  shows the canister in cargo place i (built loaded, 48N6 with its cover).
//   setPayload('48N6' | '9M96')  canisters or 9M96 packs in the cradles.
//   setWheels(roll, steer)  the tractor's wheels (roll in metres, steer on the first axle);
//   setTrailerWheels(roll)  the trailer's.
//   wheelR, trailerR, axles (tractor), trailerAxles (trailer frame z), kingpin (tractor z).
//   doorL, doorR  the cab doors (rotation.y, doorL opens negative).
//   anchors.eye, anchors.cabDoorL/R (on the ground by each door), anchors.deckLadder (trailer frame:
//                the foot of the ladder up to the front deck).

export const BAZ = {
  front: -5.2, rear: 5.2, R: 0.72, W: 0.58, track: 1.06,
  axles: [-1.75, 2.82, 4.27],
  cab: { zf: -5.02, zr: -2.85, y0: 1.22, H: 3.02, w: 2.65 },
  kingpin: 3.35, fifth: 1.72,
};
export const TRAILER = {
  front: -1.35, rear: 11.75, R: 0.6, W: 0.48, track: 1.0, axles: [9.65, 10.95],
  deck: 1.92, frame: 1.25, // raised front deck top, main frame top
  cargo: [[-0.6, 1.96], [0.6, 1.96], [-0.6, 3.22], [0.6, 3.22]], // canister axes (x, y), lower pair first
  base: 3.3, // trailer z of the canister bases (tails); the mouths are LIP behind them
  stations: [4.65, 8.55],
};

// ---------------------------------------------------------------- the canister (as on the TEL)

export const CAN = { LIP: 7.55, R: 0.53, cover: 0.32, cells: [[-0.2, 0.2], [0.2, -0.2], [-0.2, -0.2], [0.2, 0.2]], cellR: 0.165, cellD: 7.5 };
// from tel.js's "d from the tail" frame (built along +Y) to the mouth frame (lip at 0, body along +Z)
const MOUTH = new THREE.Matrix4().makeTranslation(0, 0, CAN.LIP).multiply(new THREE.Matrix4().makeRotationX(-Math.PI / 2));
const toMouth = (g) => g.applyMatrix4(MOUTH);

let CANBODY = null;
function canisterBody() {
  if (CANBODY) return CANBODY;
  const pts = [[0, 0], [0.12, 0], [0.13, 0.02], [0.38, 0.035], [0.44, 0.06], [0.48, 0.11], [0.5, 0.18], [0.5, 0.27], [0.53, 0.29], [0.53, 0.45], [0.49, 0.47]];
  for (let k = 0; k < 9; k++) {
    const d = 1.05 + k * 0.75;
    pts.push([0.507, d - 0.05], [0.528, d - 0.03], [0.528, d + 0.03], [0.49, d + 0.05]);
  }
  pts.push([0.507, 7.27], [0.538, 7.29], [0.538, 7.51], [0.547, 7.52], [0.547, CAN.LIP], [0.47, CAN.LIP], [0.47, 7.45]);
  CANBODY = toCreasedNormals(lathe(pts, 28), 0.3);
  return CANBODY;
}

/** The canister body (rings, tail cap, collar) and the dark mouth inside, into K ('canister', 'hole'). */
export function canisterParts(K, m = null) {
  const g = toMouth(canisterBody().clone());
  K.add('canister', m ? g.applyMatrix4(m) : g);
  const h = toMouth(lathe([[0.47, 7.45], [0, 7.45]], 20));
  K.add('hole', m ? h.applyMatrix4(m) : h);
  // the clamp bands where the cradles hold it
  for (const d of [0.75, 4.55]) {
    const b = toMouth(lathe([[0.522, d - 0.05], [0.54, d - 0.04], [0.54, d + 0.04], [0.522, d + 0.05]], 28));
    K.add('canister', m ? b.applyMatrix4(m) : b);
  }
}

/** The 48N6 canister's domed cover: a skirt over the lip, twelve bolts, the dome, a bail ('cover'). */
export function coverParts(K, m = null) {
  const add = (g) => K.add('cover', m ? toMouth(g).applyMatrix4(m) : toMouth(g));
  add(lathe([[0.53, 7.515], [0.553, 7.52], [0.553, 7.6], [0.549, 7.635], [0.534, 7.68], [0.507, 7.72], [0.463, 7.763], [0.402, 7.8], [0.322, 7.83], [0.222, 7.852], [0.112, 7.865], [0, 7.869]], 32));
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2 + 0.13, c = Math.cos(a), s = Math.sin(a);
    add(rod(V(c * 0.548, 7.565, s * 0.548), V(c * 0.567, 7.565, s * 0.567), 0.017, 6));
  }
  for (const x of [-0.075, 0.075]) add(box(0.035, 0.03, 0.05, x, 7.874, 0));
  add(new THREE.TorusGeometry(0.075, 0.009, 5, 10, Math.PI).translate(0, 7.88, 0));
}

/** A 9M96 pack's bulkhead with four cells ('cover', 'hole'). */
export function packParts(K, m = null) {
  const s = new THREE.Shape().absarc(0, 0, 0.475, 0, Math.PI * 2, false);
  for (const [cx, cz] of CAN.cells) s.holes.push(new THREE.Path().absarc(cx, -cz, CAN.cellR, 0, Math.PI * 2, true));
  const add = (key, g) => K.add(key, m ? toMouth(g).applyMatrix4(m) : toMouth(g));
  add('cover', new THREE.ShapeGeometry(s, 24).rotateX(-Math.PI / 2).translate(0, CAN.cellD, 0));
  for (const [cx, cz] of CAN.cells) {
    add('cover', lathe([[0.182, CAN.cellD], [0.182, CAN.cellD + 0.025], [0.172, CAN.cellD + 0.032], [CAN.cellR, CAN.cellD + 0.032], [CAN.cellR, CAN.cellD]], 20).translate(cx, 0, cz));
    add('hole', lathe([[CAN.cellR, CAN.cellD], [CAN.cellR, CAN.cellD - 0.3], [0, CAN.cellD - 0.3]], 16).translate(cx, 0, cz));
  }
}

/** The red domed cover of cell k of a 9M96 pack ('coverRed'). */
export function cellCoverParts(K, k, m = null) {
  const [cx, cz] = CAN.cells[k], d = CAN.cellD;
  const g = toMouth(lathe([[0.17, d + 0.028], [0.186, d + 0.032], [0.186, d + 0.052], [0.181, d + 0.078], [0.166, d + 0.105], [0.14, d + 0.128], [0.103, d + 0.145], [0.055, d + 0.155], [0, d + 0.158]], 22).translate(cx, 0, cz));
  K.add('coverRed', m ? g.applyMatrix4(m) : g);
}

// The canister materials of the 5P85SM2-01 (tel.js telMats): satin olive composite, the flat painted
// covers, the red cell covers, and the dark inside.
let CMATS;
export function canisterMats() {
  if (CMATS) return CMATS;
  const grain = grainTextures(), dustColor = 0x8a7f62;
  const std = (color, roughness, metalness, extra) => new THREE.MeshStandardMaterial({ color, roughness, metalness, vertexColors: true, ...extra });
  const bare = (color, roughness, metalness, key, ns, o) => {
    const m = std(color, roughness, metalness, { roughnessMap: grain.rough, normalMap: grain.normal });
    m.normalScale.set(ns, ns);
    return surfaceFinish(m, key, { dustColor, ...o });
  };
  CMATS = {
    canister: bare(0x414a36, 0.58, 0.05, 'tel-canister', 0.3, { mud: 0.3, dust: 0.3 }),
    cover: bare(0x434b37, 1, 0, 'tel-cover', 0.15, { mud: 0.1, dust: 0.1 }),
    coverRed: bare(0xa3241a, 0.95, 0, 'tel-cover-red', 0.15, { mud: 0.05, dust: 0.08 }),
    hole: std(0x0b0c0a, 1, 0),
  };
  return CMATS;
}

// ---------------------------------------------------------------- tractor

// BAZ-64022 cab: a tall flat-faced box wholly ahead of the first axle, the lower face leaning back
// under a deep black bumper, two windscreen panes, a door and a rear side window each side.
function bazCab(P, rig) {
  const { zf, zr, y0, H, w } = BAZ.cab, hw = w / 2, g0 = 2.2, g1 = 2.85;
  // (the outline 5 cm inside the nominal lines: the extrusion's bevel grows it back out)
  const e = 0.05;
  const prof = [[zf + 0.25, y0 + e], [zf + e, y0 + 0.55], [zf + e, g0 - 0.03], [zf + 0.14 + e, g1 + 0.03], [zf + 0.2 + e, H - 0.04 - e], [zf + 0.3, H - e], [zr - 0.06, H - e], [zr - e, H - 0.06], [zr - e, y0 + e]];
  P.add('camo', sideProfile(prof, w, e));
  const tilt = Math.atan2(0.14, g1 - g0);
  for (const s of [-1, 1]) {
    const x = s * 0.62;
    P.add('glass', box(1.14, g1 - g0, 0.03, x, (g0 + g1) / 2, zf + 0.06, tilt));
    P.add('rubber', box(1.18, 0.035, 0.04, x, g1 + 0.005, zf + 0.13, tilt));
    P.add('rubber', box(1.18, 0.035, 0.04, x, g0 - 0.005, zf - 0.005, tilt));
    P.add('dark', box(0.02, 0.025, 0.62, x - 0.15, g0 + 0.07, zf + 0.0, Math.PI / 2 - 0.2 + tilt, 0, -s * 0.15));
  }
  P.add('camo', box(0.08, g1 - g0, 0.04, 0, (g0 + g1) / 2, zf + 0.05, tilt));
  // the face under the screen: a horizontal intake slot, the plate, a step in the middle
  P.add('dark', box(1.5, 0.12, 0.02, 0, 1.98, zf - 0.005));
  for (let i = 0; i < 3; i++) P.add('camo', box(1.48, 0.02, 0.03, 0, 1.94 + i * 0.04, zf - 0.015));
  // bumper: deep black box with the head lamps let into its corners, tow eyes
  const b0 = 0.88, b1 = 1.5, bz = zf - 0.12;
  P.add('dark', rb(w + 0.04, b1 - b0, 0.5, 0.05, 0, (b0 + b1) / 2, bz));
  for (const s of [-1, 1]) {
    P.add('dark', zTube(zf - 0.4, zf - 0.36, 0.12, 0.12, 16, s * 0.98, 1.25));
    P.add('lens', zTube(zf - 0.41, zf - 0.4, 0.105, 0.105, 16, s * 0.98, 1.25));
    addLamp(P, s * 1.18, 1.0, zf - 0.37, 0.1, 0.07, 0.04, 'amber');
    P.add('steel', rb(0.16, 0.12, 0.16, 0.03, s * 0.42, b0 + 0.06, zf - 0.37));
  }
  P.add('dark', box(0.52, 0.12, 0.02, 0, 1.24, zf - 0.375));
  P.add('white', box(0.48, 0.1, 0.01, 0, 1.24, zf - 0.385), { tint: 0x888888 });
  // sides: the door opening (doors are pivots), the rear side window, steps, handles, mirrors
  const d0 = zf + 0.35, d1 = zf + 1.3;
  for (const s of [-1, 1]) {
    const x = s * (hw + 0.004);
    P.add('glass', box(0.03, 0.5, 0.5, x, 2.55, zr - 0.42));
    P.add('dark', box(0.02, H - y0 - 0.2, d1 - d0 - 0.04, s * (hw - 0.03), (y0 + H) / 2 - 0.05, (d0 + d1) / 2));
    for (const [y, d] of [[y0 - 0.32, 0.3], [y0 - 0.68, 0.26]]) P.add('dark', box(0.3, 0.04, 0.6, s * (hw - 0.1), y, (d0 + d1) / 2));
    P.add('steel', rod(V(s * (hw + 0.06), y0 + 0.25, d1 + 0.1), V(s * (hw + 0.06), H - 0.4, d1 + 0.1), 0.018, 5));
    P.add('dark', rod(V(x, 2.75, zf + 0.15), V(s * (hw + 0.45), 2.85, zf - 0.05), 0.02, 5));
    P.add('dark', rod(V(x, 2.25, zf + 0.15), V(s * (hw + 0.45), 2.45, zf - 0.05), 0.02, 5));
    P.add('dark', rb(0.08, 0.55, 0.3, 0.03, s * (hw + 0.48), 2.62, zf - 0.07));
    addLamp(P, x, y0 + 0.2, zf + 0.2, 0.02, 0.08, 0.12, 'amber');
  }
  // roof: the beacon, marker lamps, a vent and the rack over the back with the spare tyre lying on it
  P.add('dark', box(0.3, 0.06, 0.3, -0.8, H + 0.03, zf + 0.5));
  P.add('amber', yTube(H + 0.06, H + 0.24, 0.07, 0.065, 10, -0.8, zf + 0.5));
  for (const x of [-0.3, 0.3]) P.add('amber', yTube(H, H + 0.08, 0.04, 0.035, 8, x, zf + 0.35));
  P.add('dark', box(0.55, 0.06, 0.5, 0.3, H + 0.03, zf + 0.95));
  // doors
  for (const s of [-1, 1]) {
    const dp = pivotAt(rig, rig.root, s < 0 ? 'doorL' : 'doorR', s * (hw + 0.012), 0, d0);
    const D = new Parts(rig.mats);
    D.add('camo', box(0.05, H - y0 - 0.25, d1 - d0 - 0.02, 0, (y0 + H) / 2 - 0.08, (d1 - d0) / 2));
    D.add('glass', box(0.06, 0.6, d1 - d0 - 0.24, 0, 2.5, (d1 - d0) / 2 + 0.02));
    D.add('steel', rb(0.08, 0.05, 0.2, 0.02, s * 0.04, 2.0, d1 - d0 - 0.25));
    D.build(dp, { dirt: 0.4 });
  }
  extinguisher(P, hw + 0.08, y0 - 0.12, zr - 0.2);
}

function tractor(P) {
  const { R, W, track, axles, cab: C, kingpin, fifth } = BAZ;
  // frame and axles
  for (const s of [-1, 1]) {
    P.add('dark', box(0.14, 0.36, 9.9, s * 0.52, 1.08, 0.2));
    P.add('dark', box(0.2, 0.03, 9.9, s * 0.5, 0.9, 0.2));
  }
  for (let z = -4.6; z < 5.0; z += 1.3) P.add('dark', box(1.04, 0.12, 0.1, 0, 1.08, z));
  axles.forEach((z, i) => {
    P.add('dark', xTube(-track + 0.45, track - 0.45, 0.085, 0.085, 10, R, z));
    P.add('dark', sphere(0.22, 0, R, z, 1, 0.9, 1.1, 10));
    for (const s of [-1, 1]) {
      P.add('dark', xTube(s * (track - W * 0.5 + 0.02), s * (track - W * 0.5 - 0.2), 0.16, 0.13, 12, R, z));
      P.add('dark', box(0.1, 0.08, 1.0, s * 0.64, R + 0.32, z));
    }
    if (i === 0) P.add('dark', xTube(-track + 0.4, track - 0.4, 0.025, 0.025, 6, R - 0.05, z - 0.38));
  });
  P.add('dark', zTube(axles[0] + 0.25, axles[1] - 0.25, 0.055, 0.055, 8, 0, R + 0.1));
  P.add('dark', zTube(axles[1] + 0.25, axles[2] - 0.25, 0.055, 0.055, 8, 0, R + 0.1));
  // the front wheels' arches in the engine bay sides, a flat guard over the tandem with flaps
  for (const s of [-1, 1]) {
    const x = s * track;
    P.add('camo', box(W + 0.2, 0.05, axles[2] - axles[1] + 1.75, x, R * 2 + 0.14, (axles[1] + axles[2]) / 2));
    P.add('camo', box(0.04, 0.26, axles[2] - axles[1] + 1.75, x + s * (W / 2 + 0.08), R * 2 + 0.02, (axles[1] + axles[2]) / 2));
    mudFlap(P, x, R * 1.95, axles[2] + R + 0.2, W + 0.16, R * 1.1);
  }
  // engine bay behind the cab: tall side panels with a louvred grille, the arch over the first axle
  const ez0 = C.zr + 0.02, ez1 = -0.35;
  const bay = [[ez0, 1.22], [ez0, 2.62], [ez1 - 0.25, 2.62], [ez1, 2.4], [ez1, 1.22]];
  P.add('camo', sideProfile(bay, 2.5, 0.04));
  for (const s of [-1, 1]) {
    for (let i = 0; i < 6; i++) P.add('dark', box(0.03, 0.55, 0.035, s * 1.255, 2.05, ez0 + 0.4 + i * 0.12));
    P.add('camo', box(0.2, 0.06, 1.8, s * 1.18, 1.62, axles[0])); // arch lip
    P.add('dark', box(0.04, 0.36, 1.2, s * 1.255, 1.42, ez1 - 0.6)); // battery box door
  }
  // two air cleaner pots on the bay top, the exhaust, the roof rack with a spare tyre lying on it
  for (const x of [-0.45, 0.25]) {
    P.add('camo', yTube(2.62, 3.05, 0.25, 0.25, 16, x, ez0 + 0.9));
    P.add('dark', yTube(3.05, 3.16, 0.27, 0.2, 16, x, ez0 + 0.9));
  }
  P.add('camo', zTube(ez0 + 0.75, ez0 + 1.05, 0.13, 0.13, 10, -0.1, 2.85));
  P.add('dark', yTube(2.0, 3.2, 0.07, 0.07, 10, 1.1, ez1 - 0.15));
  P.add('rust', yTube(3.2, 3.3, 0.08, 0.075, 10, 1.1, ez1 - 0.15));
  P.add('dark', box(1.4, 0.05, 1.1, 0.4, C.H + 0.12, C.zr - 0.3));
  for (const [x, z] of [[-0.2, C.zr - 0.8], [1.0, C.zr - 0.8], [-0.2, C.zr + 0.2], [1.0, C.zr + 0.2]]) P.add('dark', yTube(C.H - 0.2, C.H + 0.12, 0.025, 0.025, 5, x, z));
  P.add('tyre', lugTyre(0.62, 0.45, 16, 40).applyMatrix4(xf(0.4, C.H + 0.42, C.zr - 0.3, 0, 0, Math.PI / 2)));
  discHub(P, 0.4, C.H + 0.42, C.zr - 0.3, 1, 0.62, 0.45);
  // the second spare wheel standing on its carrier behind the bay (left), fuel tank (right)
  P.add('tyre', lugTyre(0.72, 0.56, 18, 44).applyMatrix4(xf(-1.0, 1.42, 0.55)));
  discHub(P, -1.0, 1.42, 0.55, -1, 0.72, 0.56);
  P.add('dark', box(0.15, 1.0, 0.12, -0.62, 1.5, 0.55));
  P.add('camo', zTube(-0.25, 1.35, 0.32, 0.32, 16, 0.92, 1.12));
  P.add('dark', box(0.08, 0.7, 0.06, 0.92, 1.12, 0.0));
  P.add('dark', box(0.08, 0.7, 0.06, 0.92, 1.12, 1.1));
  // tool box and air tanks between the axles, the fifth wheel on its plate
  P.add('camo', rb(0.6, 0.55, 0.9, 0.03, -0.9, 1.0, 1.75));
  P.add('dark', zTube(1.4, 2.2, 0.16, 0.16, 12, 0.75, 0.82));
  P.add('dark', box(1.7, 0.18, 1.6, 0, 1.38, kingpin));
  P.add('steel', yTube(fifth - 0.18, fifth - 0.06, 0.7, 0.72, 24, 0, kingpin));
  P.add('dark', box(1.2, 0.08, 0.5, 0, fifth - 0.2, kingpin + 0.7));
  // the rear: a cross member, lamps, the step plate
  P.add('dark', box(2.2, 0.2, 0.15, 0, 1.0, BAZ.rear - 0.1));
  for (const s of [-1, 1]) addLamp(P, s * 0.95, 1.05, BAZ.rear - 0.02 + 0.05, 0.18, 0.08, 0.05, 'red');
  // hoses to the trailer
  P.add('rubber', rod(V(-0.3, 1.9, -0.3), V(-0.25, 1.9, 1.6), 0.025, 6));
  P.add('red', rod(V(0.2, 1.9, -0.3), V(0.25, 1.9, 1.6), 0.025, 6));
}

// ---------------------------------------------------------------- trailer

// Built in the trailer frame: origin on the ground under the kingpin, +Z back along the trailer.
function trailerBody(P) {
  const { front, rear, deck, frame, track, axles, R, W, stations, cargo } = TRAILER;
  // the raised front deck over the tractor: a plate on two beams, the tool boxes and the railing
  P.add('camo', box(2.5, 0.1, 3.3, 0, deck - 0.05, front + 1.65));
  for (const s of [-1, 1]) P.add('camo', box(0.18, 0.42, 3.3, s * 1.0, deck - 0.3, front + 1.65));
  P.add('dark', yTube(BAZ.fifth, deck - 0.5, 0.06, 0.06, 10, 0, 0)); // kingpin
  P.add('dark', box(1.6, 0.12, 1.6, 0, BAZ.fifth + 0.06, 0));
  for (const s of [-1, 1]) P.add('camo', rb(0.8, 0.42, 0.5, 0.03, s * 0.75, deck + 0.21, front + 0.45));
  for (const s of [-1, 1]) {
    for (let z = front + 1.0; z <= front + 3.2; z += 0.55) P.add('steel', yTube(deck, deck + 0.6, 0.02, 0.02, 5, s * 1.18, z));
    P.add('steel', zTube(front + 0.95, front + 3.25, 0.022, 0.022, 5, s * 1.18, deck + 0.6));
    P.add('steel', zTube(front + 0.95, front + 3.25, 0.018, 0.018, 5, s * 1.18, deck + 0.32));
  }
  for (let x = -1.1; x <= 1.1; x += 0.55) P.add('steel', yTube(deck, deck + 0.6, 0.02, 0.02, 5, x, front + 3.25));
  P.add('steel', xTube(-1.18, 1.18, 0.022, 0.022, 5, deck + 0.6, front + 3.25));
  ladder(P, -1.28, front + 2.2, 0.6, deck + 0.05, 0.36, 'steel');
  // the swan neck down to the main frame, the two side girders, cross members
  const nz0 = front + 3.3, nz1 = nz0 + 1.25;
  for (const s of [-1, 1]) {
    P.add('camo', sideProfile([[nz0 - 0.2, deck], [nz0 + 0.15, deck], [nz1, frame + 0.05], [nz1, frame - 0.42], [nz1 - 0.4, frame - 0.42], [nz0 - 0.2, deck - 0.5]], 0.18, 0.02).translate(s * 1.0, 0, 0));
    P.add('camo', box(0.18, 0.46, rear - nz1 - 0.2, s * 1.0, frame - 0.19, (nz1 + rear - 0.2) / 2));
    P.add('dark', box(0.04, 0.04, rear - nz1 - 0.3, s * 1.1, frame - 0.38, (nz1 + rear - 0.2) / 2));
    P.add('white', box(0.01, 0.12, 0.12, s * 1.095, frame - 0.15, nz1 + 0.8), { tint: 0xdddddd }); // stencil cross
  }
  for (let z = nz1 + 0.3; z < rear - 0.3; z += 1.25) P.add('dark', box(1.9, 0.14, 0.12, 0, frame - 0.15, z));
  P.add('camo', box(2.1, 0.06, rear - nz1 - 0.3, 0, frame - 0.02, (nz1 + rear - 0.3) / 2)); // floor plates
  // the bogie: suspension beams, axles, mudguards with flaps
  for (const z of axles) {
    P.add('dark', xTube(-track + 0.4, track - 0.4, 0.08, 0.08, 10, R, z));
    for (const s of [-1, 1]) P.add('dark', xTube(s * (track - W * 0.5 + 0.02), s * (track - W * 0.5 - 0.16), 0.12, 0.1, 12, R, z));
  }
  for (const s of [-1, 1]) {
    P.add('dark', box(0.12, 0.14, axles[1] - axles[0] + 0.9, s * 0.72, R + 0.25, (axles[0] + axles[1]) / 2));
    P.add('camo', box(W + 0.2, 0.05, axles[1] - axles[0] + 1.5, s * track, R * 2 + 0.13, (axles[0] + axles[1]) / 2));
    P.add('camo', box(0.04, 0.24, axles[1] - axles[0] + 1.5, s * (track + W / 2 + 0.08), R * 2 + 0.02, (axles[0] + axles[1]) / 2));
    mudFlap(P, s * track, R * 1.95, axles[1] + R + 0.15, W + 0.16, R * 1.1);
  }
  // the landing legs (wound up), lamps and the plate at the rear
  for (const s of [-1, 1]) {
    P.add('camo', box(0.18, 0.9, 0.18, s * 0.85, deck - 0.85, nz0 + 0.1));
    P.add('dark', box(0.32, 0.05, 0.32, s * 0.85, deck - 1.33, nz0 + 0.1));
    addLamp(P, s * 1.05, frame - 0.2, rear + 0.02, 0.2, 0.08, 0.05, 'red');
  }
  P.add('dark', box(2.3, 0.18, 0.12, 0, frame - 0.32, rear - 0.05));
  P.add('dark', box(0.52, 0.13, 0.02, 0.0, frame - 0.6, rear - 0.0));
  P.add('white', box(0.48, 0.1, 0.01, 0.0, frame - 0.6, rear + 0.01), { tint: 0x888888 });
  // the two portal cradles: posts at the sides, cross beams under each pair and over the top with
  // saddles, joined by the side rails along the stack (red cargo marks on them)
  const yL = cargo[0][1], yU = cargo[2][1], top = yU + CAN.R + 0.12;
  for (const z of stations) {
    for (const s of [-1, 1]) {
      P.add('camo', box(0.14, top - frame, 0.16, s * 1.3, (top + frame) / 2, z));
      P.add('camo', rod(V(s * 1.3, frame + 0.05, z - 0.55), V(s * 1.3, yL + 0.3, z - 0.05), 0.04, 5)); // brace
    }
    for (const y of [yL - CAN.R - 0.08, yU - CAN.R - 0.09, top]) P.add('camo', box(2.74, 0.14, 0.16, 0, y, z));
    for (const [x, y] of cargo) {
      // saddle under each canister and the hold-down strap over it
      P.add('camo', box(0.62, 0.1, 0.24, x, y - CAN.R - 0.02, z));
      P.add('dark', new THREE.TorusGeometry(CAN.R + 0.02, 0.02, 4, 18, Math.PI).applyMatrix4(xf(x, y, z)));
    }
  }
  for (const s of [-1, 1]) {
    for (const y of [yU - CAN.R - 0.09, top]) P.add('camo', box(0.1, 0.12, stations[1] - stations[0], s * 1.3, y, (stations[0] + stations[1]) / 2));
    P.add('red', box(0.012, 0.11, 0.11, s * 1.356, yU - CAN.R - 0.09, (stations[0] + stations[1]) / 2 - 0.2));
    P.add('red', box(0.012, 0.11, 0.11, s * 1.356, yL - CAN.R - 0.08, (stations[0] + stations[1]) / 2 - 0.2));
    P.add('camo', box(0.1, 0.12, stations[1] - stations[0], s * 1.3, yL - CAN.R - 0.08, (stations[0] + stations[1]) / 2));
  }
}

// ---------------------------------------------------------------- the rig

export function build5T58() {
  const rig = newRig('green');
  const { P, root, mats } = rig;
  bazCab(P, rig);
  tractor(P);
  P.build(root, { dirt: 0.55 });
  const tw = spinWheels(root, mats, BAZ.axles.flatMap((z, i) => [-1, 1].map((s) => ({ x: s * BAZ.track, y: BAZ.R, z, steer: i === 0 ? 1 : 0 }))), BAZ.R, heavyWheel(BAZ.W));
  rig.setWheels = tw.set;
  const tr = pivotAt(rig, root, 'trailer', 0, 0, BAZ.kingpin);
  const T = new Parts(mats);
  trailerBody(T);
  T.build(tr, { dirt: 0.5 });
  const ww = spinWheels(tr, mats, TRAILER.axles.flatMap((z) => [-1, 1].map((s) => ({ x: s * TRAILER.track, y: TRAILER.R, z }))), TRAILER.R, heavyWheel(TRAILER.W));
  rig.setTrailerWheels = (roll) => ww.set(roll, 0);
  // the cargo: four canisters (or packs), each its own group so the crane can take them one by one
  const cm = canisterMats(), allMats = { ...mats, ...cm };
  rig.anchors.cargo = [];
  const groups = [], covers = [], packs = [];
  TRAILER.cargo.forEach(([x, y], i) => {
    const a = node(tr, 'cargo' + i, x, y, TRAILER.base + CAN.LIP, 0, Math.PI, 0);
    rig.anchors.cargo.push(a);
    const g = new THREE.Group();
    g.name = 'can' + i;
    a.add(g);
    const K = new Parts(allMats);
    canisterParts(K);
    K.build(g, { dirt: 0.15, y0: y });
    const cv = new THREE.Group(), pk = new THREE.Group();
    g.add(cv, pk);
    const C = new Parts(allMats);
    coverParts(C);
    C.build(cv, { dirt: 0.05, y0: y });
    const Q = new Parts(allMats);
    packParts(Q);
    for (let k = 0; k < 4; k++) cellCoverParts(Q, k);
    Q.build(pk, { dirt: 0.05, y0: y });
    pk.visible = false;
    groups.push(g);
    covers.push(cv);
    packs.push(pk);
  });
  rig.slots = groups.map((g) => [g]);
  rig.setPayload = (kind) => {
    const pack = kind === '9M96';
    covers.forEach((c) => (c.visible = !pack));
    packs.forEach((p) => (p.visible = pack));
  };
  rig.wheelR = BAZ.R;
  rig.trailerR = TRAILER.R;
  rig.axles = BAZ.axles;
  rig.trailerAxles = TRAILER.axles;
  rig.kingpin = BAZ.kingpin;
  rig.anchors.eye = node(root, 'eye', 0, 2.4, 0);
  rig.anchors.cabDoorL = node(root, 'cabDoorL', -BAZ.cab.w / 2 - 0.55, 0, BAZ.cab.zf + 0.85);
  rig.anchors.cabDoorR = node(root, 'cabDoorR', BAZ.cab.w / 2 + 0.55, 0, BAZ.cab.zf + 0.85);
  rig.anchors.deckLadder = node(tr, 'deckLadder', -1.75, 0, TRAILER.front + 2.2);
  hb(rig, -1.4, 0, BAZ.front, 1.4, 3.3, BAZ.rear);
  return rig;
}
