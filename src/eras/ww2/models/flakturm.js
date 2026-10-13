import * as THREE from 'three';
import { box, rbox, yTube, Parts, concreteTextures, surfaceFinish } from '../../../models/kit.js';
import { newRig, node, hb } from '../../../models/rig.js';
import { mulberry32 } from '../../../noise.js';
import { flakMats, add, build } from './kit44.js';

// The flak tower (Flakturm, a G-tower; the game's what-if at Hopsten, not a reference-matched model): a
// reinforced concrete block 40 m square and 32 m to the roof, the four corner turrets rising to 36 m with
// a parapet round each (the 12,8 cm Flakzwilling 40 stand on them, flak128.js), a gallery on each face at
// 26 m carrying a 2 cm Flakvierling, the roof with its parapet carrying the Kommandogeraet, the Wuerzburg
// and two 3,7 cm Flak 43. Slit windows behind steel shutters in rows, string courses, the entrance in the
// rear (+Z) face behind a blast wall, the foundation running a few metres into the ground so the block
// sits on any slope of the pad. The guns are their own rigs placed on the decks (eras/ww2.js `deck`);
// FLAKTURM holds the heights they stand at.
//
// Rig (front -Z, right +X, ground y = 0 at the centre): no pivots; anchors.eye on the roof.
export const FLAKTURM = { half: 20, roof: 32, turret: 36, gallery: 26, corner: 15, side: 24, turretR: 6.5, galleryW: 14, galleryD: 8 };

let MATS;
function mats() {
  if (MATS) return MATS;
  const con = concreteTextures(0xa8a49a);
  const concrete = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0, vertexColors: true, map: con.map, roughnessMap: con.rough, normalMap: con.normal });
  surfaceFinish(concrete, 'ww2-flakturm', { mud: 0.5, mudTop: 1.6, dust: 0.25, dustColor: 0x8d8a80, mudColor: 0x3d3a34 });
  MATS = { ...flakMats('grey'), concrete };
  return MATS;
}

// an octagon prism (a corner turret), radius r to the faces
const octagon = (r, y0, y1, x, z) => yTube(y0, y1, r / Math.cos(Math.PI / 8), r / Math.cos(Math.PI / 8), 8, x, z);

export function buildFlakturm() {
  const rig = newRig('green');
  const M = mats();
  rig.mats = M;
  const root = rig.root;
  const F = FLAKTURM, H = F.half, rnd = mulberry32(1942);
  const P = new Parts(M);
  const C = (g, tint = 0xffffff, tile = 6) => add(P, 'concrete', g, tint, tile);

  // the foundation and the block
  C(box(2 * H + 2, 5, 2 * H + 2, 0, -2.4, 0), 0x9c988e);
  C(box(2 * H, F.roof, 2 * H, 0, F.roof / 2, 0));
  // string courses round the block every storey (about 5.3 m), a heavier cornice under the roof parapet
  for (let y = 5.3; y < F.roof - 1; y += 5.3) C(box(2 * H + 0.3, 0.3, 2 * H + 0.3, 0, y, 0), 0xb2aea4);
  C(box(2 * H + 0.8, 0.8, 2 * H + 0.8, 0, F.roof - 0.4, 0), 0xb0aca2);
  // the roof parapet (1.2 m) with its coping
  for (const [w, d, x, z] of [[2 * H, 0.8, 0, -H + 0.4], [2 * H, 0.8, 0, H - 0.4], [0.8, 2 * H - 1.6, -H + 0.4, 0], [0.8, 2 * H - 1.6, H - 0.4, 0]]) {
    C(box(w, 1.2, d, x, F.roof + 0.6, z), 0xa6a298);
  }
  // the roof slab's walkway and the hoist houses beside the corner turrets
  C(box(2 * H - 1.6, 0.15, 2 * H - 1.6, 0, F.roof + 0.075, 0), 0x96938b, 8);
  for (const [sx, sz] of [[-1, 1], [1, 1]]) C(rbox(3, 2.6, 3, 0.1, sx * 7, F.roof + 1.3, sz * 15), 0xa4a096);

  // the corner turrets: octagons from the ground to 36 m, a parapet round the gun floor
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    const x = sx * F.corner, z = sz * F.corner;
    C(octagon(F.turretR, 0, F.turret, x, z));
    C(octagon(F.turretR + 0.25, F.roof - 0.8, F.roof, x, z), 0xb0aca2);
    // the parapet: eight wall pieces round the gun floor, 1.4 m high
    const R = F.turretR + 0.05;
    for (let k = 0; k < 8; k++) {
      const a = (k + 0.5) * (Math.PI / 4), w = 2 * R * Math.tan(Math.PI / 8);
      C(box(w + 0.05, 1.4, 0.7, 0, 0, 0).rotateY(a).translate(x + Math.sin(a) * (R - 0.35), F.turret + 0.7, z + Math.cos(a) * (R - 0.35)), 0xa6a298);
    }
    C(octagon(F.turretR - 0.3, F.turret, F.turret + 0.08, x, z), 0x8e8b84);
    // shuttered slits up the turret's outer faces
    for (let y = 4; y < F.turret - 4; y += 5.3) {
      for (const a of [Math.atan2(sx, sz) - Math.PI / 8, Math.atan2(sx, sz) + Math.PI / 8]) {
        add(P, 'black', box(0.7, 1.1, 0.3, 0, 0, 0).rotateY(a).translate(x + Math.sin(a) * F.turretR, y, z + Math.cos(a) * F.turretR), 0x2a2a28, 0);
      }
    }
  }

  // the galleries: a slab on corbels projecting from each face's middle, its parapet open to the outside
  const faces = [[0, -1], [1, 0], [0, 1], [-1, 0]];
  for (const [fx, fz] of faces) {
    const along = fx === 0, W = F.galleryW, D = F.galleryD;
    const cx = fx * (H + D / 2), cz = fz * (H + D / 2);
    C(along ? box(W, 1, D, cx, F.gallery - 0.5, cz) : box(D, 1, W, cx, F.gallery - 0.5, cz), 0xaca89e);
    // corbels under it
    for (let k = -2; k <= 2; k++) {
      const o = (k * W) / 5;
      const g = along ? box(0.8, 3, D - 1, o, F.gallery - 2.5, cz - fz * 0.5) : box(D - 1, 3, 0.8, cx - fx * 0.5, F.gallery - 2.5, o);
      C(g, 0xa29e94);
    }
    // the parapet on the three open sides (1.1 m)
    if (along) {
      C(box(W, 1.1, 0.5, cx, F.gallery + 0.55, fz * (H + D - 0.25)), 0xa6a298);
      for (const s of [-1, 1]) C(box(0.5, 1.1, D, s * (W / 2 - 0.25), F.gallery + 0.55, cz), 0xa6a298);
    } else {
      C(box(0.5, 1.1, W, fx * (H + D - 0.25), F.gallery + 0.55, cz), 0xa6a298);
      for (const s of [-1, 1]) C(box(D, 1.1, 0.5, cx, F.gallery + 0.55, s * (W / 2 - 0.25)), 0xa6a298);
    }
    // the door onto the gallery and ammunition boxes stacked by it
    if (along) add(P, 'metal', box(2.2, 2.4, 0.2, fx ? 0 : 4, F.gallery + 1.2, fz * (H + 0.1)), 0x55574f);
    else add(P, 'metal', box(0.2, 2.4, 2.2, fx * (H + 0.1), F.gallery + 1.2, 4), 0x55574f);
    for (let i = 0; i < 4; i++) {
      const o = -5 + i * 0.6, y = F.gallery + 0.2 + (i % 2) * 0.32;
      add(P, 'wood', along ? box(0.5, 0.3, 0.35, o, y, fz * (H + 0.6)) : box(0.35, 0.3, 0.5, fx * (H + 0.6), y, o), 0x7d8a5a, 1);
    }
  }

  // slit windows behind steel shutters in rows on each face, between the corner turrets and the galleries
  for (const [fx, fz] of faces) {
    for (let y = 2.8; y < F.roof - 2; y += 5.3) {
      for (const o of [-10.5, -8.5, 8.5, 10.5]) {
        if (Math.abs(y - F.gallery) < 3 && Math.abs(o) < F.galleryW / 2 + 1) continue;
        const shut = rnd() < 0.7;
        const g = fx === 0 ? box(1.0, 1.4, 0.3, o, y, fz * (H + 0.05)) : box(0.3, 1.4, 1.0, fx * (H + 0.05), y, o);
        add(P, shut ? 'metal' : 'black', g, shut ? 0x5c5e57 : 0x1a1a19, 0);
      }
    }
  }

  // the entrance in the rear face: a door behind its blast wall, steps
  add(P, 'metal', box(4, 4.2, 0.3, 0, 2.1, H + 0.1), 0x4d4f48);
  C(box(9, 3.6, 1.2, 0, 1.8, H + 5), 0xa29e94);
  for (const s of [-1, 1]) C(box(1.2, 3.6, 5, s * 4.5, 1.8, H + 2.5), 0xa29e94);
  build(P, root, 0, 0.6);

  rig.anchors.eye = node(root, 'eye', 0, F.roof + 3, 6);
  hb(rig, -H - 2, 0, -H - 2, H + 2, F.turret + 1.5, H + 2);
  return rig;
}
