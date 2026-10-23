import * as THREE from 'three';
import { V, box, rbox, yTube, zTube, xTube, sideProfile, Parts } from '../../../models/kit.js';
import { newRig, node, pivotAt, hb } from '../../../models/rig.js';
import { flakMats, setPaint, paintCarrier, add, build, crewSpot, panSeat, wheelSet, strutSet } from './kit44.js';

// 12,8 cm Flakzwilling 40 in a flak tower's gun pit (flakturm.js), after refs/ww2/flakturm (the twin at the
// former US Army Ordnance Museum, Aberdeen, photos zwilling_aberdeen_22 to _24, front and left front; the
// wartime tower photos flakturm_humboldthain_twin_11 and the Bundesarchiv views) and refs/ww2/flak128 (the
// single Flak 40: trunnions at the extreme rear of the upper carriage nearly in line with the breech, 2.3 m
// up; recuperator above the barrel and buffer below; the left gun loads from the left, the right from the
// right). What the photos show and this builds: two Flak 40 side by side, each in its own cradle box with
// the recuperator over the barrel and two equilibrators slanting from the front of the carriage up to the
// cradle; the barrels' thick sleeves stepping down to the long tubes; three side walls (the outer two big
// trapezoids, a narrow one between the guns) carrying the trunnions at their rear tops; a riveted beam across
// the front with a ladder; the loading machinery's box with its round cover on the left wall, the elevating
// gear's drum and the layers' handwheels on the right; the carriage on a round pedestal; fold-down crew
// platforms with rails along both sides; no shield. Width over the walls 2.5 m, over the side gear 3.4 m;
// barrels 1.35 m apart (read from the front views with the carriage's width, E).
//
// Rig (front -Z, right +X, ground y = 0: the gun pit's floor):
//   pivots.turret     the upper carriage on the pedestal at (0, 0.8, 0). rotation.y = traverse, + to the
//                     left, unlimited.
//   pivots.elevation  the trunnions, turret space (0, 1.75, 1.2): 2.55 m over the floor, so the breeches and
//                     the trays behind them clear the floor at full elevation (the carriage stops short of
//                     their sweep). rotation.x = elevation, + raises the muzzles; -3 to +88 deg (-0.05 to 1.53).
//   pivots.recoil0/1  each barrel's recoiling mass (left, right): position.z = recoil (m); rig.setRecoil(m)
//                     moves both, rig.setRecoil(k, m) one.
//   anchors.muzzles   [left, right], each in its recoil group, -Z along the bore.
//   anchors.breeches  [left, right], the chamber mouths (recoil groups).
//   anchors.sight     the layer's telescope on the right wall, following the elevation.
//   anchors.eye       camera focus (0, 2.4, 1.0) on the root.
//   anchors.crew      on the turret: k1 and k2 the layers on their seats at the right wall's handwheels, k3
//                     and k4 the loaders on the side platforms beside their gun's loading tray, k5 and k6
//                     their ammunition numbers at the hoists at the platforms' rear ends, gf the commander.
//   The loading machine (refs/ww2/flak128 sec. 5, 12; refs/ww2/flak105 sec. 5: a round laid in a tray at the
//   side, swung behind the breech on a jointed arm, driven home by two rubber rollers at the entrance to the
//   bore, the tray knocked back by the case rim; here one tray per gun does both): each gun's tray rests on
//   its stand at the outer edge of its side platform, horizontal at the loader's waist (anchors.trayRest[k]);
//   it swings out over the platform's edge to the gun's elevation, then in onto the bore line behind the
//   breech (anchors.trays[k], its origin the round's middle, -Z its nose), on a telescoping arm from a
//   bracket on the trunnion boss; the rollers at its front end ram the round; it swings back. An ammunition
//   hoist at the rear of each side platform brings the next round up (anchors.hoists[k]: the risen round's
//   base, +Y up). rig.setDrill(drill) poses it all from the crew's drill clock (crew44.js h.drill) and
//   leaves rig.load = { swing, ram, rise } (0..1) for the crew's jobs (jobs44.js): the rounds themselves
//   are the loader's and the ammunition number's props, so they cost no draw call.
//   setPaint('grey' | 'yellow'). rig.recoilLength(el) the stroke (m).
export const F128 = { pivotY: 0.8, trunnion: { y: 1.75, z: 1.2 }, barrel: 7.835, bf: 0.45, half: 0.675, recoil: 1.0 };
const MUZ = F128.bf - F128.barrel;
const FL = -F128.pivotY; // the floor in the turret's frame
const PLAT = FL + 1.15; // the side platforms' top
const WALL = 1.18; // the outer walls' x
// the loading machine: the round (1.488 m) on the bore line, its nose at the chamber mouth; the tray at rest
// on its stand (turret frame, x outboard); the platforms' inner edge (the tray swings down past it)
export const LOAD = { round: 1.488, mid: F128.bf + 0.1 + 0.744, restX: 1.47, restY: PLAT + 0.98, restZ: 2.5, platIn: 1.62, platEnd: 4.3, hoistX: 1.95, hoistZ: 4.02, lever: 2.7 };
// the drill's phases of a load (0..1) when the machine moves (jobs44.js keys the crew to the same numbers)
export const LOAD_PHASES = { rise: [0.3, 0.48], swing: [0.58, 0.7], ram: [0.72, 0.86], back: [0.88, 0.96] };
const smooth = ([a, b], p) => { const t = Math.min(1, Math.max(0, (p - a) / (b - a))); return t * t * (3 - 2 * t); };

// one barrel in its recoil frame: the breech ring, the sleeve inside the cradle and its step at the cradle's
// mouth, the long tube with its bands, the muzzle's swell
function barrel(P) {
  const z0 = F128.bf;
  add(P, 'metal', rbox(0.5, 0.5, 0.62, 0.05, 0, 0, z0 - 0.31), 0xb8b8b8); // breech ring
  add(P, 'metal', box(0.44, 0.1, 0.5, 0, -0.27, z0 - 0.3), 0x9a9a9a); // the wedge's housing
  add(P, 'black', new THREE.CircleGeometry(0.078, 18).translate(0, 0, z0 + 0.002), 0x080808); // the chamber, wedge open
  add(P, 'paint', zTube(z0 - 0.62, -2.35, 0.2, 0.2, 18), 0xc8c8c8); // sleeve (in the cradle)
  add(P, 'paint', zTube(-2.35, -3.35, 0.205, 0.195, 18), 0xd0d0d0); // the sleeve's visible end
  add(P, 'paint', zTube(-3.35, -3.42, 0.215, 0.215, 18), 0xbcbcbc); // its band
  add(P, 'paint', zTube(-3.42, -3.6, 0.17, 0.155, 18), 0xd0d0d0); // the step down
  add(P, 'paint', zTube(-3.6, MUZ + 0.35, 0.15, 0.125, 18), 0xd4d4d4);
  add(P, 'paint', zTube(-5.1, -5.16, 0.142, 0.142, 18), 0xc0c0c0); // the joint of the three-piece tube
  add(P, 'paint', zTube(MUZ + 0.35, MUZ, 0.137, 0.14, 18), 0xc8c8c8); // muzzle swell
  add(P, 'black', zTube(MUZ - 0.002, MUZ + 0.25, 0.066, 0.066, 14, 0, 0, true), 0x101010); // the bore
}

// a cradle in the elevation frame at x0 (s: the side its gun loads from): the box round the sleeve, the
// trunnion arms, the recuperator above with the clamp to the barrel, the buffer below, the loading tray on
// the bore line behind the recoil and the rammer beside it
function cradle(P, x0, s) {
  add(P, 'paint', rbox(0.64, 0.64, 2.75, 0.05, x0, 0, -0.95)); // the cradle box, from behind the trunnions forward
  add(P, 'paint', rbox(0.7, 0.18, 0.5, 0.03, x0, 0.36, 0.1)); // its top saddle over the breech end
  add(P, 'paint', zTube(-3.05, 0.25, 0.125, 0.125, 16, x0, 0.43), 0xc8c8c8); // recuperator
  add(P, 'paint', zTube(-3.05, -2.95, 0.15, 0.15, 16, x0, 0.43), 0xb8b8b8); // its front cap
  add(P, 'paint', zTube(0.25, 0.36, 0.15, 0.15, 16, x0, 0.43), 0xb8b8b8); // its rear cap
  add(P, 'metal', box(0.06, 0.42, 0.08, x0 + 0.1, 0.2, -2.98), 0x8a8a8a); // the link to the barrel's band
  add(P, 'paint', zTube(-2.3, 0.15, 0.085, 0.085, 12, x0, -0.38), 0xc0c0c0); // buffer
  add(P, 'paint', box(0.34, 0.12, 0.5, x0, -0.38, -2.2)); // its front bracket
  // the trunnion arms out to the walls (the outer one) and to the middle wall
  add(P, 'paint', xTube(x0 + s * 0.3, s * (WALL - 0.08), 0.17, 0.17, 14), 0xbcbcbc);
  add(P, 'paint', xTube(x0 - s * 0.3, s * 0.12, 0.17, 0.17, 14), 0xbcbcbc);
}

// The upper carriage in the turret's frame (the floor at y = FL): the bed on the pedestal, the walls, the
// front beam with its ladder, the side gear, the platforms and their rails, the ready-round rack behind.
function carriage(P) {
  const H = F128.half;
  add(P, 'paint', yTube(-0.06, 0.02, 1.5, 1.5, 32), 0xb4b4b4); // the turntable's ring
  // the bed: stops short of the breeches' sweep (z > 0.8 between the walls)
  add(P, 'paint', rbox(2.5, 0.5, 2.9, 0.05, 0, 0.35, -0.65));
  // the three walls: big trapezoids outside, the narrow one between the guns; trunnion bosses at their tops
  // (their rear edge steps forward below the trunnion boss: the loading trays swing in past it)
  const outer = [[-2.05, 0.1], [0.9, 0.1], [0.9, 1.3], [1.55, 1.6], [1.55, 1.95], [0.85, 2.05], [-0.4, 1.55], [-2.05, 0.95]];
  const mid = [[-1.7, 0.6], [1.45, 0.6], [1.45, 1.92], [0.8, 1.98], [-1.7, 1.0]];
  for (const s of [-1, 1]) {
    add(P, 'paint', sideProfile(outer, 0.13).translate(s * WALL, 0, 0));
    add(P, 'paint', xTube(s * (WALL - 0.12), s * (WALL + 0.14), 0.24, 0.24, 18, F128.trunnion.y, F128.trunnion.z), 0xb8b8b8);
    add(P, 'paint', rbox(0.16, 1.1, 2.4, 0.03, s * (WALL + 0.1), 0.62, -0.55)); // the walls' footing flanges
  }
  add(P, 'paint', sideProfile(mid, 0.2));
  // the front beam: a riveted box across the walls, its two panels, and the ladder up to it
  add(P, 'paint', rbox(2.5, 0.62, 0.42, 0.04, 0, 0.95, -2.12));
  for (const s of [-1, 1]) add(P, 'paint', box(1.0, 0.42, 0.04, s * 0.58, 0.97, -2.34), 0xc4c4c4);
  for (const s of [-1, 1]) add(P, 'metal', box(0.04, 1.4, 0.04, s * 0.22, FL + 0.95, -2.42), 0x8a8a8a);
  for (let k = 0; k < 4; k++) add(P, 'metal', box(0.44, 0.03, 0.04, 0, FL + 0.35 + k * 0.32, -2.42), 0x8a8a8a);
  // the equilibrators' lower brackets on the front of the bed
  for (const s of [-1, 1]) for (const t of [-1, 1]) add(P, 'paint', box(0.12, 0.2, 0.22, s * H + t * 0.37, 0.66, -1.75), 0xb8b8b8);
  // left wall: the loading machinery's box with its round cover; a smaller box above it
  add(P, 'paint', rbox(0.42, 0.95, 1.1, 0.04, -WALL - 0.32, 1.0, -1.2));
  add(P, 'paint', yTube(-0.02, 0.02, 0.3, 0.3, 20).rotateZ(Math.PI / 2).translate(-WALL - 0.54, 1.05, -1.2), 0xb8b8b8);
  add(P, 'paint', rbox(0.34, 0.45, 0.6, 0.03, -WALL - 0.28, 1.68, -0.6));
  // right wall: the elevating gear's drum with its cover, the traverse gear box below, the receivers' dials
  add(P, 'paint', xTube(WALL + 0.06, WALL + 0.5, 0.42, 0.42, 22, 1.3, 0.35), 0xc0c0c0);
  add(P, 'paint', xTube(WALL + 0.5, WALL + 0.56, 0.3, 0.3, 22, 1.3, 0.35), 0xb0b0b0);
  add(P, 'paint', rbox(0.4, 0.6, 0.8, 0.04, WALL + 0.28, 0.55, -0.55));
  for (const [y, z] of [[1.6, -0.85], [1.6, -0.45]]) {
    add(P, 'paint', box(0.22, 0.3, 0.32, WALL + 0.17, y, z));
    add(P, 'white', box(0.01, 0.22, 0.22, WALL + 0.285, y, z), 0xe8e4d8); // a receiver's dial face
  }
  // the fold-down platforms along both sides, grating on brackets, with a rail round each; the loading
  // trays' stands and release levers, the arms' brackets, the ammunition hoists at the rear ends
  const L = LOAD, pw = 2.275 - L.platIn, pc = (L.platIn + 2.275) / 2, pz = (L.platEnd - 0.65) / 2;
  for (const s of [-1, 1]) {
    add(P, 'metal', box(pw, 0.05, L.platEnd + 0.65, s * pc, PLAT - 0.025, pz), 0x7a7a72);
    for (const z of [-0.4, 1.4, 3.2]) add(P, 'metal', box(0.06, 0.06, 0.06, s * (L.platIn + 0.05), PLAT - 0.2, z).applyMatrix4(new THREE.Matrix4().makeRotationZ(s * 0.6)), 0x7a7a72);
    for (const z of [-0.6, 1.75, L.platEnd - 0.05]) add(P, 'metal', box(0.035, 0.95, 0.035, s * (WALL + 1.07), PLAT + 0.47, z), 0x8a8a8a);
    add(P, 'metal', zTube(-0.6, L.platEnd - 0.05, 0.02, 0.02, 6, s * (WALL + 1.07), PLAT + 0.92), 0x8a8a8a);
    add(P, 'metal', zTube(-0.6, L.platEnd - 0.05, 0.016, 0.016, 6, s * (WALL + 1.07), PLAT + 0.5), 0x8a8a8a);
    // a short ladder at the platform's rear end, inboard of the hoist
    for (const t of [-1, 1]) add(P, 'metal', box(0.04, 1.2, 0.04, s * 1.72 + t * 0.12, FL + 0.55, L.platEnd + 0.06), 0x8a8a8a);
    for (let k = 1; k <= 3; k++) add(P, 'metal', box(0.24, 0.03, 0.04, s * 1.72, FL + k * 0.3, L.platEnd + 0.06), 0x8a8a8a);
    // the tray's stand: two posts at the platform's inner edge, their arms in under the tray at rest
    const ty = L.restY - 0.18;
    for (const z of [2.0, 2.65]) {
      add(P, 'paint', box(0.06, ty - PLAT, 0.06, s * (L.platIn + 0.04), (ty + PLAT) / 2, z), 0xc0c0c0);
      add(P, 'paint', box(L.platIn + 0.04 - L.restX + 0.1, 0.05, 0.08, s * (L.platIn + 0.04 + L.restX - 0.1) / 2, ty - 0.025, z), 0xc0c0c0);
      add(P, 'paint', box(0.03, 0.08, 0.08, s * (L.restX - 0.12), ty + 0.02, z), 0xc0c0c0); // a stop
    }
    // the release lever on the rear post, its knob
    add(P, 'metal', tubeXYZ(s * (L.platIn + 0.04), ty - 0.05, 2.65, s * (L.platIn + 0.2), ty + 0.32, L.lever, 0.018), 0x8a8a8a);
    add(P, 'black', yTube(0, 0.08, 0.03, 0.03, 10, s * (L.platIn + 0.2), ty + 0.32, L.lever), 0x181818);
    // the arm's bracket on the trunnion boss
    add(P, 'paint', rbox(0.14, 0.18, 0.16, 0.02, s * 1.31, 1.45, 1.36), 0xc4c4c4);
    // the ammunition hoist: its tube up through the platform, the collar round its mouth
    add(P, 'paint', yTube(FL, PLAT - 0.02, 0.13, 0.13, 16, s * L.hoistX, L.hoistZ), 0xbcbcbc);
    add(P, 'paint', yTube(PLAT - 0.02, PLAT + 0.06, 0.17, 0.17, 18, s * L.hoistX, L.hoistZ), 0xc8c8c8);
    add(P, 'black', yTube(PLAT + 0.06, PLAT + 0.062, 0.11, 0.11, 14, s * L.hoistX, L.hoistZ), 0x0c0c0c);
  }
}
// a rod between two points (turret frame)
const tubeXYZ = (x0, y0, z0, x1, y1, z1, r) => {
  const a = V(x0, y0, z0), b = V(x1, y1, z1), d = b.clone().sub(a);
  return new THREE.CylinderGeometry(r, r, d.length(), 8).applyMatrix4(new THREE.Matrix4().compose(a.clone().add(b).multiplyScalar(0.5), new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), d.normalize()), V(1, 1, 1)));
};

// one loading tray in its own frame (origin the round's middle, -Z its nose): the trough under the front two
// thirds of the round (the base end overhangs it, where the loader's hand goes), the arch at its front with the
// two rubber rollers above and below the round
function trayGeometry(P) {
  add(P, 'paint', box(0.22, 0.025, 1.0, 0, -0.098, -0.19));
  for (const t of [-1, 1]) add(P, 'paint', box(0.022, 0.085, 1.0, t * 0.1, -0.055, -0.19), 0xd0d0d0);
  for (const t of [-1, 1]) add(P, 'paint', box(0.022, 0.33, 0.09, t * 0.1, 0.0, -0.72), 0xc8c8c8);
  add(P, 'paint', box(0.22, 0.025, 0.09, 0, 0.165, -0.72), 0xc8c8c8);
  for (const y of [-0.122, 0.122]) add(P, 'metal', xTube(-0.085, 0.085, 0.045, 0.045, 12, y, -0.72), 0x161616);
  add(P, 'paint', box(0.06, 0.07, 0.12, 0, -0.14, -0.6), 0xc0c0c0); // the arm's lug
}

export function buildFlak128() {
  const rig = newRig('green');
  const mats = flakMats('grey');
  rig.mats = mats;
  const root = rig.root;

  // the pedestal on its foot ring in the pit's floor
  const B = new Parts(mats);
  add(B, 'paint', yTube(0, 0.08, 2.0, 2.0, 36), 0xa8a8a8);
  add(B, 'paint', yTube(0.08, F128.pivotY - 0.06, 1.35, 1.2, 32), 0xb8b8b8);
  add(B, 'paint', yTube(F128.pivotY - 0.06, F128.pivotY, 1.45, 1.45, 32), 0xb0b0b0);
  build(B, root, 0, 0.2);

  const tur = pivotAt(rig, root, 'turret', 0, F128.pivotY, 0);
  const T = new Parts(mats);
  carriage(T);
  build(T, tur, F128.pivotY, 0.15);

  const el = pivotAt(rig, tur, 'elevation', 0, F128.trunnion.y, F128.trunnion.z);
  const E = new Parts(mats);
  cradle(E, -F128.half, -1);
  cradle(E, F128.half, 1);
  build(E, el, F128.pivotY + F128.trunnion.y, 0);
  const recoils = [-1, 1].map((s, k) => {
    const rc = pivotAt(rig, el, 'recoil' + k, s * F128.half, 0, 0);
    const R = new Parts(mats);
    barrel(R);
    build(R, rc, F128.pivotY + F128.trunnion.y, 0);
    rig.anchors.muzzles.push(node(rc, 'muzzle' + k, 0, 0, MUZ));
    return rc;
  });
  rig.anchors.breeches = recoils.map((rc, k) => node(rc, 'breech' + k, 0, 0, F128.bf + 0.1));

  // ---- the loading machine: per gun a tray (turret group, posed by setDrill), its rest and its hoist
  const L = LOAD;
  const trays = [], rests = [], hoists = [], lugs = [], hinges = [];
  [-1, 1].forEach((s, k) => {
    const tray = new THREE.Object3D();
    tray.name = 'tray' + k;
    tray.position.set(s * L.restX, L.restY, L.restZ);
    tur.add(tray);
    const TP = new Parts(mats);
    trayGeometry(TP);
    build(TP, tray, F128.pivotY + L.restY, 0);
    trays.push(tray);
    rests.push(node(tur, 'trayRest' + k, s * L.restX, L.restY, L.restZ));
    hoists.push(node(tur, 'hoist' + k, s * L.hoistX, PLAT + 0.06, L.hoistZ));
    lugs.push(node(tray, 'lug' + k, 0, -0.16, -0.6));
    hinges.push(node(tur, 'hinge' + k, s * 1.31, 1.42, 1.36));
  });
  rig.anchors.trays = trays;
  rig.anchors.trayRest = rests;
  rig.anchors.hoists = hoists;
  rig.anchors.levers = [-1, 1].map((s, k) => node(tur, 'lever' + k, s * (L.platIn + 0.2), L.restY - 0.18 + 0.36, L.lever));
  rig.anchors.drillNodes = [...trays, ...rests, ...hoists, ...rig.anchors.levers];
  // the machine's state for the crew (jobs44.js): swing 0 at rest .. 1 on the bore line, ram 0 .. 1 home,
  // rise 0 (the hoist's round down in the tube) .. 1 (standing on the platform)
  rig.load = { swing: 0, ram: 0, rise: 1 };

  // the layers' seats and handwheels on the right wall (elevation forward, traverse behind), and the layer's
  // telescope above them, following the elevation
  const S = new Parts(mats);
  panSeat(S, 'paint', WALL + 0.95, PLAT, -0.95, 0.42, 0.16);
  panSeat(S, 'paint', WALL + 0.95, PLAT, 0.1, 0.42, 0.16);
  build(S, tur, F128.pivotY, 0.1);
  const wEl = node(tur, 'wheelEl', WALL + 0.5, PLAT + 0.95, -0.95, 0, Math.PI / 2, 0);
  const wAz = node(tur, 'wheelAz', WALL + 0.5, PLAT + 0.95, 0.1, 0, Math.PI / 2, 0);
  const sight = node(tur, 'sight', WALL + 0.32, PLAT + 1.45, -0.95);
  const G = new Parts(mats);
  add(G, 'paint', zTube(-0.25, 0.2, 0.05, 0.05, 12), 0xc8c8c8);
  add(G, 'black', zTube(0.2, 0.28, 0.04, 0.035, 10), 0x303030);
  build(G, sight, F128.pivotY + PLAT + 1.45, 0);
  sight.updateMatrix = function () {
    this.rotation.x = el.rotation.x;
    THREE.Object3D.prototype.updateMatrix.call(this);
  };
  rig.anchors.sight = node(sight, 'sightEye', 0, 0, 0.28);
  rig.anchors.eye = node(root, 'eye', 0, 2.4, 1.0);
  rig.anchors.hoist = node(tur, 'hoistMouth', 0, FL + 0.5, 3.25);

  // the equilibrators: from brackets on the bed's front up to the cradles' undersides, two to a gun
  const struts = [];
  for (const s of [-1, 1]) for (const t of [-1, 1]) {
    const x = s * F128.half + t * 0.37;
    struts.push({ a: node(tur, 'eqLow', x, 0.72, -1.75), b: node(el, 'eqHigh', x, -0.36, -1.3), r: 0.12, len: 1.45 });
  }
  for (let k = 0; k < 2; k++) struts.push({ a: hinges[k], b: lugs[k], r: 0.04, len: 0.32 });
  strutSet(root, struts, mats.paint, mats.metal);
  wheelSet(root, [{ node: wEl, R: 0.2 }, { node: wAz, R: 0.2 }], mats.black);

  rig.anchors.crew = {
    k1: crewSpot(tur, 'k1', WALL + 0.95, PLAT + 0.42, -0.95, 90, { label: 'K1 elevation layer (seated at the right wall)', seated: true, pose: 'sit' }),
    k2: crewSpot(tur, 'k2', WALL + 0.95, PLAT + 0.42, 0.1, 90, { label: 'K2 traverse layer (seated at the right wall)', seated: true, pose: 'sit' }),
    k3: crewSpot(tur, 'k3', -1.94, PLAT, 2.85, -90, { label: 'K3 loader, left gun (at its loading tray)', pose: 'load' }),
    k4: crewSpot(tur, 'k4', 1.94, PLAT, 2.85, 90, { label: 'K4 loader, right gun (at its loading tray)', pose: 'load' }),
    k5: crewSpot(tur, 'k5', -1.96, PLAT, 3.55, 180, { label: 'K5 ammunition number at the left hoist', pose: 'carry' }),
    k6: crewSpot(tur, 'k6', 1.96, PLAT, 3.55, 180, { label: 'K6 ammunition number at the right hoist', pose: 'carry' }),
    gf: crewSpot(tur, 'gf', -1.95, PLAT, 0.2, -20, { label: 'Geschuetzfuehrer (gun commander, on the left platform)', pose: 'stand' }),
  };

  hb(rig, -2.2, 0, -2.5, 2.2, 3.0, 4.4);

  let paint = 'grey';
  paintCarrier(root);
  rig.setPaint = (s) => { if (s !== paint && (s === 'grey' || s === 'yellow')) { paint = s; setPaint(root, s); } };
  rig.recoilLength = () => F128.recoil;
  // The loading machine from the crew's drill clock (crew44.js h.drill: load 0..1 while loading, 1 when done).
  // The phases of the load are jobs44.js's for the twin (LOAD128): the tray swings in, the rollers ram, it
  // swings back; the hoist brings the next round up.
  const qIn = new THREE.Quaternion(), pIn = new THREE.Vector3(), pOut = new THREE.Vector3(), q0 = new THREE.Quaternion(), ax = new THREE.Vector3(1, 0, 0);
  rig.setDrill = (d) => {
    const p = d && d.loading ? d.load : 1;
    const P8 = LOAD_PHASES;
    const sw = p < P8.swing[0] ? 0 : p < P8.swing[1] ? smooth(P8.swing, p) : p < P8.back[0] ? 1 : p < P8.back[1] ? 1 - smooth(P8.back, p) : 0;
    rig.load.swing = sw;
    rig.load.ram = p < P8.ram[0] ? 0 : p < P8.ram[1] ? smooth(P8.ram, p) : 1;
    rig.load.rise = p < P8.rise[0] ? 0 : p < P8.rise[1] ? smooth(P8.rise, p) : 1;
    const e = el.rotation.x;
    qIn.setFromAxisAngle(ax, e);
    trays.forEach((tray, k) => {
      const s = k ? 1 : -1;
      // on the bore line: the round's middle at L.mid behind the trunnions; out: the same, at the rest's x
      pIn.set(s * F128.half, 0, L.mid).applyQuaternion(qIn).add(el.position);
      pOut.copy(pIn).setX(s * L.restX);
      if (sw <= 0.5) {
        const v = sw * 2;
        tray.position.lerpVectors(rests[k].position, pOut, v);
        tray.quaternion.slerpQuaternions(q0, qIn, v);
      } else {
        tray.position.lerpVectors(pOut, pIn, (sw - 0.5) * 2);
        tray.quaternion.copy(qIn);
      }
    });
  };
  rig.setRecoil = (a, b) => {
    if (b === undefined) for (const rc of recoils) rc.position.z = Math.max(0, a);
    else if (recoils[a]) recoils[a].position.z = Math.max(0, b);
  };
  return rig;
}
