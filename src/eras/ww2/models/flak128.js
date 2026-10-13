import * as THREE from 'three';
import { V, box, rbox, yTube, zTube, xTube, Parts } from '../../../models/kit.js';
import { newRig, node, pivotAt, hb } from '../../../models/rig.js';
import { flakMats, setPaint, paintCarrier, add, build, crewSpot } from './kit44.js';

// 12,8 cm Flakzwilling 40 on a flak tower's corner turret (the game's flak tower, flakturm.js; a sketch
// after the general arrangement of the tower mounts, not a reference-matched model): two Flak 40 side by
// side in one cradle, their L/61 barrels 7.8 m long; the big box carriage with the layers' cabins on the
// sides and the power rammers' loading trays behind the breeches; the mount on its pedestal over the
// fixed ring in the turret's floor; no shield (the turret's parapet covers the crews).
//
// Rig (front -Z, right +X, ground y = 0: the turret's floor):
//   pivots.turret     the carriage on the pedestal at (0, 0.9, 0). rotation.y = traverse, + to the left, unlimited.
//   pivots.elevation  the trunnions, turret space (0, 1.4, 0.9) (2.3 m above the floor). rotation.x =
//                     elevation, + raises the muzzles; -3 to +88 deg (-0.05 to 1.53).
//   pivots.recoil0/1  each barrel's recoiling mass (left, right): position.z = recoil (m); rig.setRecoil(m)
//                     moves both, rig.setRecoil(k, m) one.
//   anchors.muzzles   [left, right], each in its recoil group, -Z along the bore.
//   anchors.breeches  [left, right], the chamber mouths (recoil groups).
//   anchors.sight     the layer's telescope on the left cabin, following the elevation.
//   anchors.eye       camera focus (0, 2.4, 1.0) on the root.
//   anchors.crew      k1 and k2 the layers (in the side cabins), k3 and k4 loaders at the trays, k5 and k6
//                     ammunition numbers at the hoist, gf the gun commander.
//   setPaint('grey' | 'yellow'). rig.recoilLength(el) the stroke (m).
export const F128 = { pivotY: 0.9, trunnion: { y: 1.4, z: 0.9 }, barrel: 7.83, bf: 1.0, half: 0.48, recoil: 0.9 };
const MUZ = F128.bf - F128.barrel;

// one barrel in its recoil frame: the tube stepping up to the jacket, the breech ring, the recuperator over it
function barrel(P) {
  const z0 = F128.bf, z1 = MUZ;
  add(P, 'paint', zTube(z1 + 0.05, z1 + 3.4, 0.085, 0.1, 18), 0xd0d0d0);
  add(P, 'paint', zTube(z1 + 3.4, z0 - 1.6, 0.12, 0.15, 18), 0xd0d0d0);
  add(P, 'paint', zTube(z0 - 1.6, z0 - 0.4, 0.2, 0.2, 18), 0xc4c4c4);
  add(P, 'paint', zTube(z1, z1 + 0.05, 0.1, 0.1, 18), 0xb0b0b0); // muzzle ring
  add(P, 'metal', rbox(0.46, 0.46, 0.55, 0.04, 0, 0, z0 - 0.15), 0xb8b8b8); // breech ring
  add(P, 'metal', box(0.38, 0.1, 0.3, 0, -0.2, z0 - 0.1), 0x9a9a9a); // wedge housing
  add(P, 'paint', zTube(z0 - 2.9, z0 - 0.5, 0.11, 0.11, 14, 0, 0.29), 0xc8c8c8); // recuperator
  add(P, 'paint', zTube(z0 - 2.6, z0 - 0.5, 0.08, 0.08, 12, 0, -0.27), 0xc8c8c8); // recoil brake
}

// the cradle: a wide trough round both barrels, the trunnion blocks, the equilibrators under it
function cradle(P) {
  const H = F128.half;
  add(P, 'paint', rbox(1.7, 0.75, 2.6, 0.08, 0, 0, -0.4));
  add(P, 'paint', box(0.2, 0.55, 0.8, -H - 0.62, 0, 0)); // trunnion blocks
  add(P, 'paint', box(0.2, 0.55, 0.8, H + 0.62, 0, 0));
  for (const s of [-1, 1]) {
    add(P, 'paint', zTube(-2.2, -1.65, 0.24, 0.24, 14, s * H, 0), 0xc0c0c0); // barrel guides
    add(P, 'metal', zTube(-1.6, 0.2, 0.07, 0.07, 10, s * 0.35, -0.48), 0x888888); // equilibrator rods
  }
  // the loading trays behind the breeches with their rammers
  for (const s of [-1, 1]) {
    add(P, 'metal', box(0.38, 0.06, 1.5, s * H, -0.2, F128.bf + 0.95), 0xa0a0a0);
    add(P, 'paint', box(0.18, 0.22, 1.3, s * (H + 0.32), -0.08, F128.bf + 0.95));
  }
}

// the carriage: a box on the pedestal with the side cabins of the layers and the walkway round the breeches
function carriage(P) {
  add(P, 'paint', rbox(3.6, 0.5, 4.2, 0.06, 0, 0.25, 0.6)); // the turntable's deck
  for (const s of [-1, 1]) {
    add(P, 'paint', rbox(0.35, 1.5, 2.2, 0.05, s * 1.2, 1.15, 0.7)); // side walls carrying the trunnions
    add(P, 'paint', rbox(0.9, 1.7, 1.3, 0.08, s * 2.0, 1.2, 0.0)); // the layers' cabins
    add(P, 'glass', box(0.04, 0.3, 0.6, s * 2.46, 1.75, -0.05));
    add(P, 'metal', box(0.04, 0.9, 0.04, s * 1.75, 0.95, 2.6), 0x8a8a8a); // rail posts
    add(P, 'metal', xTube(s * 0.4, s * 1.75, 0.025, 0.025, 6, 1.4, 2.6), 0x8a8a8a);
  }
  add(P, 'metal', xTube(-1.75, 1.75, 0.025, 0.025, 6, 1.4, 2.65), 0x8a8a8a);
  // the ammunition hoist's mouth at the rear of the deck
  add(P, 'metal', rbox(0.9, 0.5, 0.6, 0.04, 0, 0.75, 2.4), 0x777777);
}

export function buildFlak128() {
  const rig = newRig('green');
  const mats = flakMats('grey');
  rig.mats = mats;
  const root = rig.root;

  // the pedestal on the turret's fixed ring
  const B = new Parts(mats);
  add(B, 'paint', yTube(0, 0.18, 2.1, 2.1, 32), 0xb8b8b8);
  add(B, 'paint', yTube(0.18, F128.pivotY, 1.25, 1.05, 28));
  build(B, root, 0, 0.2);

  const tur = pivotAt(rig, root, 'turret', 0, F128.pivotY, 0);
  const T = new Parts(mats);
  carriage(T);
  build(T, tur, F128.pivotY, 0.15);

  const el = pivotAt(rig, tur, 'elevation', 0, F128.trunnion.y, F128.trunnion.z);
  const E = new Parts(mats);
  cradle(E);
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

  // the layer's telescope on the left cabin, following the elevation
  const sight = node(tur, 'sight', -2.0, 2.15, -0.6);
  const S = new Parts(mats);
  add(S, 'paint', zTube(-0.25, 0.2, 0.05, 0.05, 12), 0xc8c8c8);
  add(S, 'black', zTube(0.2, 0.28, 0.04, 0.035, 10), 0x303030);
  build(S, sight, F128.pivotY + 2.15, 0);
  sight.updateMatrix = function () {
    this.rotation.x = el.rotation.x;
    THREE.Object3D.prototype.updateMatrix.call(this);
  };
  rig.anchors.sight = node(sight, 'sightEye', 0, 0, 0.28);
  rig.anchors.eye = node(root, 'eye', 0, 2.4, 1.0);

  const deck = 0.5 - F128.pivotY;
  rig.anchors.crew = {
    k1: crewSpot(tur, 'k1', -2.0, deck, 0.3, 0, { label: 'K1 elevation layer (left cabin)', pose: 'stand' }),
    k2: crewSpot(tur, 'k2', 2.0, deck, 0.3, 0, { label: 'K2 traverse layer (right cabin)', pose: 'stand' }),
    k3: crewSpot(tur, 'k3', -1.0, deck, 2.1, 0, { label: 'K3 loader, left gun', pose: 'load' }),
    k4: crewSpot(tur, 'k4', 1.0, deck, 2.1, 0, { label: 'K4 loader, right gun', pose: 'load' }),
    k5: crewSpot(tur, 'k5', -0.6, deck, 2.9, 180, { label: 'K5 ammunition number at the hoist', pose: 'carry' }),
    k6: crewSpot(tur, 'k6', 0.6, deck, 2.9, 180, { label: 'K6 ammunition number at the hoist', pose: 'carry' }),
    gf: crewSpot(root, 'gf', -3.2, 0, 2.6, -40, { label: 'Geschuetzfuehrer (gun commander)', pose: 'stand' }),
  };

  hb(rig, -2.5, 0, -1.5, 2.5, 3.2, 3.0);

  let paint = 'grey';
  paintCarrier(root);
  rig.setPaint = (s) => { if (s !== paint && (s === 'grey' || s === 'yellow')) { paint = s; setPaint(root, s); } };
  rig.recoilLength = () => F128.recoil;
  rig.setRecoil = (a, b) => {
    if (b === undefined) for (const rc of recoils) rc.position.z = Math.max(0, a);
    else if (recoils[a]) recoils[a].position.z = Math.max(0, b);
  };
  return rig;
}
