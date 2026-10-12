import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { V, box, rbox, yTube, zTube, xTube, sphere, rod, lathe, plane, scaleUV, sideProfile, frontProfile, Parts, vehicleMats, camoTextures, surfaceFinish, projectUV } from '../kit.js';
import { newRig, node, pivotAt, hb } from '../rig.js';
import { GM355, addHull, addRunningGear } from './gm355.js';

// 9A331M Tor-M2 combat vehicle on the tracked GM-355 chassis (gm355.js), Russian service look of the
// Tor-M2U parades (refs/tor). The turret is a wide, flat-topped lower body with ribbed sides sitting
// straight on the hull's raised centre section, and stepped in on it the launcher block: four broad
// panels a side sloping up at about 32 degrees to a 1.1 m wide deck with 2 x 4 hinged lids over the
// eight vertical cells (two 9M334 modules of four 9M331; side photo, top view 09 and reload photo 06),
// the tracking antenna at the front (a deep box with a round radome filling its face, tilting on
// trunnions; a sensor dome at the top of its left side, another a third of the way down its right side)
// and the folding search antenna at the rear (a flat 1.9 x 0.85 m reflector with the louvred IFF visor
// on top, on a telescopic mast). Paint: a grey-green olive tint over the shared 'green' scheme.
// Measured from tor_m2u_01 (side, 200 px/m from the wheel pitch), tor_m2_07 (head-on), _02/_05/_10
// (three-quarters, travel), _04 and tor_m2_08 (deployed), _09 (top); checked in ortho against them.
//
// Rig (model space front -Z, right +X, ground y = 0, metres):
//   pivots.turret       yaw on the ring at (0, 2.18, 0.35); rotation.y, 0 = antenna toward the front of
//                       the hull (in action), + = turns left, any angle. The real vehicle travels with the
//                       turret turned round (rotation.y = PI).
//   pivots.trackRadar   the tracking antenna's tilt about its trunnion axis (x) at turret (0, 0.83, -1.49);
//                       rotation.x, 0 = face upright looking along the turret's -Z, + = face tilts up
//                       (the elevation it looks at), useful range -0.1 .. +1.45; travel pose is
//                       rig.trackTravel = +1.31 (lying back, face up, as on the march and on parade).
//   pivots.searchRadar  the search antenna's spin about the vertical mast axis at turret (0, 0.70, 2.55);
//                       rotation.y, any angle, relative to the turret (render spins it with the sweep).
//                       Folding needs rotation.y = 0 (the antenna folds over the turret's rear, which is
//                       over the cab when the turret is turned round for the march).
//   rig.setDeploy(v)    0 = travel, the search antenna folded down 105 deg on its mast hinge and the
//                       mast down; 1 = in action, mast up 0.56 m and the antenna upright (top
//                       about 5.2 m). It unfolds over v 0..0.62 and the mast rises over v 0.5..1.
//                       Built deployed (v = 1). It does not move trackRadar or the turret.
//   rig.hatches[i]      the lid over cell i: an Object3D hinged on its outer long edge (axis along z);
//                       open motion is rotation.z from 0 (shut) to hatches[i].userData.open (+1.75 rad on
//                       the left row, -1.75 on the right: the lid swings up and outward past vertical).
//                       rig.setHatch(i, t) sets it for t in 0..1. Lid layout and hinge side unconfirmed.
//   anchors.missileSlots[i]  the top of cell i under its lid, in launch order (left/right alternately,
//                       front to back); the node's -Z points straight up (the round leaves upward).
//   rig.setLoaded(i, loaded) shows or hides the round container end in cell i (seen when its lid is open).
//   anchors.eye         camera focus over the hull centre.

const RING = { y: GM355.ringY, z: GM355.ringZ }; // turret pivot in model space
const TR = { y: 0.83, z: -1.49 }; // tracking antenna trunnion, turret space
// antenna box about the trunnion (upright): a 1.28 x 1.42 face 0.4 ahead of the trunnion, 0.59 deep; the
// ends solved from the travel pose in tor_m2u_01 (outer end at z +2.50, y 2.65 .. 3.25; trunnion 1.84, 3.01)
const ANT = { hw: 0.64, y0: -0.62, y1: 0.8, zf: -0.4, zb: 0.19 };
const TRACK_TRAVEL = 1.31; // the face 15 deg off horizontal in tor_m2u_01
const SR = { y: 0.7, z: 2.55, col: 0.28, lift: 0.67, fold: 1.83, park: 0.165 }; // search mast: pivot, column, lift, fold (rad)
const LID = { y: 1.28, hinge: 0.72, w: 0.66, len: 0.58, z: [-0.36, 0.38, 1.13, 1.87], open: 1.75 }; // lid stations from the hinge bumps in tor_m2u_01
const CELL_X = 0.38;
const BODY = { zf0: -1.33, zf1: -1.08, zr0: 2.38, zr1: 2.46, top: 0.77, hw: 1.55, inner: 1.0 };
const BLOCK = { z0: -0.66, z1: 2.32, top: 1.27, shoulder: 1.2, hw0: 1.3, hw1: 0.75 };
const FACE = new THREE.Color(1.12, 1.22, 1.0); // antenna faces: a lighter, greener paint (camo material)

// a plate with the rounded-box signature but a plain box's 12 triangles (RoundedBoxGeometry costs 300)
const rb = (w, h, d, r, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) => box(w, h, d, x, y, z, rx, ry, rz);
// The 'green' scheme leans yellow; the Tor-M2U's paint is a grey-green with about as much blue as red
// in the photos (tor_m2u_02, _04, _05 sample near 75, 83, 78), so its painted parts take a cooler tint.
function olive(meshes) {
  for (const m of meshes) if (m.name.startsWith('camo') || m.name === 'paint' || m.name === 'slope') {
    const c = m.geometry.attributes.color;
    for (let i = 0; i < c.count; i++) c.setXYZ(i, c.getX(i) * 0.8, c.getY(i) * 0.86, c.getZ(i) * 1.5);
  }
  return meshes;
}
// Own painted set (as tel.js and tunguska.js do): the shared green paint with a light, grey dust. The
// shared set's tan dust on up-facing surfaces turned the turret's sloped panels and decks pale tan;
// the Tor-M2U in the photos is the same grey-green on every face.
let torMats;
function ownMats() {
  if (torMats) return torMats;
  const tex = camoTextures('green');
  const mk = (key, color) => {
    const m = new THREE.MeshStandardMaterial({ color, roughness: 1, metalness: 0, vertexColors: true, map: tex.map, roughnessMap: tex.rough, normalMap: tex.normal });
    m.normalScale.set(0.7, 0.7);
    return surfaceFinish(m, 'veh-tor-' + key, { mud: 0.8, dust: 0.18, dustColor: 0x7d7f74 });
  };
  // the launcher block's sloped side panels: the same paint with a weaker sheen (on the dark paint the sun's
  // specular made them a pale band; in tor_m2u_01 they are 1.5 x the lower body's tone)
  const slope = surfaceFinish(new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 1, metalness: 0, vertexColors: true, map: tex.map, roughnessMap: tex.rough, normalMap: tex.normal, specularIntensity: 0.25, envMapIntensity: 0.5 }), 'veh-tor-slope', { mud: 0.8, dust: 0.12, dustColor: 0x7d7f74 });
  slope.normalScale.set(0.7, 0.7);
  torMats = { ...vehicleMats('green'), camo: mk('camo', 0xffffff), paint: mk('paint', 0x56603d), slope };
  return torMats;
}
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// ---------------------------------------------------------------- moving parts in one draw call

// One merged mesh whose vertex ranges follow Object3Ds (children of the same parent as the mesh), moved
// on the CPU only when one of them turns, so the eight lids (or the eight round tops) cost one draw
// call. items: [{ node, geom }] with geom in the node's local space; item.on = false collapses its range.
// The check runs in the mesh's updateMatrix (the scene's matrix update, before the buffers upload), so a
// lid turned before a render shows in that render.
function followMesh(parent, mats, key, items, y0) {
  const geoms = items.map(({ geom }) => { const Q = new Parts(mats); Q.add(key, geom); return Q.merged(key); });
  const ranges = [];
  let n = 0;
  for (const g of geoms) { ranges.push([n, g.attributes.position.count]); n += g.attributes.position.count; }
  const g = mergeGeometries(geoms, false);
  const pos = g.attributes.position, nor = g.attributes.normal;
  const base = pos.array.slice(), baseN = nor.array.slice();
  const ah = new Float32Array(pos.count);
  g.setAttribute('aH', new THREE.BufferAttribute(ah, 1));
  const mesh = new THREE.Mesh(g, mats[key]);
  mesh.name = key + '-moving';
  parent.add(mesh);
  const last = items.map(() => [NaN, NaN, NaN, null]);
  const v = new THREE.Vector3(), nm = new THREE.Matrix3();
  const sync = () => {
    let dirty = false;
    items.forEach((it, i) => {
      const o = it.node, l = last[i], on = it.on !== false;
      if (l[0] === o.rotation.x && l[1] === o.rotation.y && l[2] === o.rotation.z && l[3] === on) return;
      l[0] = o.rotation.x; l[1] = o.rotation.y; l[2] = o.rotation.z; l[3] = on;
      o.updateMatrix();
      nm.getNormalMatrix(o.matrix);
      const [s, c] = ranges[i];
      for (let k = s; k < s + c; k++) {
        if (on) v.fromArray(base, k * 3).applyMatrix4(o.matrix); else v.copy(o.position);
        pos.setXYZ(k, v.x, v.y, v.z);
        v.fromArray(baseN, k * 3).applyMatrix3(nm).normalize();
        nor.setXYZ(k, v.x, v.y, v.z);
      }
      dirty = true;
    });
    if (dirty) { pos.needsUpdate = true; nor.needsUpdate = true; }
  };
  sync();
  for (let k = 0; k < pos.count; k++) ah[k] = pos.getY(k) + y0;
  g.computeBoundingSphere();
  g.boundingSphere.radius += 1.0; // room for the lids swinging open
  mesh.updateMatrix = function () { sync(); THREE.Object3D.prototype.updateMatrix.call(this); };
  mesh.userData.sync = sync;
  return mesh;
}

// ---------------------------------------------------------------- turret

// Lower body: the ribbed side boxes with their raked front ends and the mesh grilles at the rear,
// the centre between them, the ring. Turret space: origin on the ring, front -Z.
function lowerBody(T) {
  const { zf0, zf1, zr0, zr1, top, hw, inner } = BODY;
  // (it sits straight on the hull's raised centre section: no ring shows under it, tor_m2u_01)
  const sw = hw - inner, sx = (hw + inner) / 2;
  for (const s of [-1, 1]) {
    // section: an upright outer face with only a small chamfer into the flat top, so the upper block
    // stands stepped in on a ledge (tor_m2u_01, _02, _07), extruded between the raked ends
    const sec = [[inner, -0.02], [hw, -0.02], [hw, top - 0.08], [hw - 0.03, top], [inner, top]].map(([x, y]) => [s * x, y]);
    T.add('camo', frontProfile(s > 0 ? sec : sec.reverse(), zf1, zr0));
    T.add('camo', sideProfile([[zf0, -0.02], [zf1, top], [zf1, -0.02]], sw).translate(s * sx, 0, 0));
    T.add('camo', sideProfile([[zr0, -0.02], [zr0, top], [zr1, top]], sw - 0.03).translate(s * (sx - 0.015), 0, 0));
    // the outer face: vertical ribs, two rails along it, a rail along the top edge (tor_m2u_01, _05)
    const ox = () => hw + 0.012;
    for (const z of [-0.55, 0.05, 0.62, 1.2, 1.78]) T.add('camo', box(0.03, top - 0.16, 0.05, s * ox(), (top - 0.1) / 2 + 0.02, z), { tint: 0xc8c8c8 });
    for (const y of [0.2, 0.42]) T.add('camo', box(0.025, 0.025, zr0 - zf1 - 0.3, s * ox(), y, (zf1 + zr0) / 2), { tint: 0xbcbcbc });
    T.add('camo', box(0.03, 0.04, zr0 - zf1 - 0.1, s * (hw + 0.008), top - 0.1, (zf1 + zr0) / 2), { tint: 0xbcbcbc });

    // small louvred vent and a handle on the side, U-handles along the top edge
    T.add('dark', box(0.03, 0.13, 0.32, s * ox(), 0.52, -0.25));
    for (let i = 0; i < 4; i++) T.add('steel', box(0.035, 0.012, 0.28, s * (ox() + 0.01), 0.47 + i * 0.03, -0.25), { tint: 0x7f866f });
    T.add('dark', rod(V(s * (ox() + 0.04), 0.3, 0.82), V(s * (ox() + 0.04), 0.3, 1.02), 0.015, 5));
    for (const z of [-0.6, 0.2, 1.0, 1.8]) T.add('dark', rod(V(s * (inner + 0.25), top, z - 0.08), V(s * (inner + 0.25), top + 0.05, z), 0.012, 4));
    // mesh grille over the rear end (it leans out at the top like the end itself)
    const gz = (zr0 + zr1) / 2, ga = Math.atan2(zr1 - zr0, top - 0.08);
    const gw = sw - 0.22, gx = s * (sx - 0.06);
    const g = plane(gw, 0.44, gx, 0.34, gz + 0.016, -ga, 0, 0);
    scaleUV(g, gw / 0.12, 0.44 / 0.12);
    T.add('array', g, { tint: new THREE.Color(2.5, 2.8, 2.3) });
    for (const dx of [-1, 1]) T.add('camo', box(0.04, 0.5, 0.05, gx + dx * (gw / 2 + 0.01), 0.34, gz + 0.01, -ga, 0, 0), { tint: 0xb0b0b0 }); // grille frame
    T.add('camo', box(gw + 0.06, 0.04, 0.05, gx, 0.59, gz + 0.012, -ga, 0, 0), { tint: 0xb0b0b0 });
    T.add('camo', box(sw, 0.05, 0.05, s * sx, top - 0.03, zr1 - 0.01));
  }
  // centre between the side boxes, recessed behind the antenna at the front
  T.add('camo', box(inner * 2, top + 0.02, 3.6, 0, (top - 0.02) / 2, 0.6));
  T.add('camo', sideProfile([[-1.2, -0.02], [-1.05, top], [-0.6, top], [-0.6, -0.02]], inner * 2));
  T.add('dark', yTube(-0.03, -0.01, 1.2, 1.2, 32)); // the ring's seal line
  // rear: the search radar's machinery deck and the drive housings either side of it
  T.add('camo', box(1.5, 0.62, 0.3, 0, 0.36, 2.45));
  for (const s of [-1, 1]) {
    T.add('camo', rb(0.42, 0.5, 0.26, 0.03, s * 0.75, 0.36, 2.47));
    T.add('camo', xTube(s * 0.86, s * 0.98, 0.15, 0.15, 16, 0.5, 2.45), { tint: 0xb4b4b4 });
  }
  // the turret's rear between the side boxes: equipment columns, the mast drive, pipes (tor_m2_07)
  T.add('camo', box(0.26, 1.02, 0.3, -0.58, 0.62, 2.48));
  T.add('camo', box(0.3, 0.9, 0.26, 0.64, 0.56, 2.5));
  T.add('camo', box(0.14, 0.5, 0.12, -0.32, 0.86, 2.62), { tint: 0xa8a8a8 });
  T.add('camo', yTube(0.3, 0.86, 0.07, 0.07, 10, 0.36, 2.66));
  T.add('dark', yTube(0.3, 0.36, 0.09, 0.09, 10, 0.36, 2.66));
  for (const y of [0.5, 0.95]) T.add('dark', xTube(-0.45, 0.5, 0.025, 0.025, 6, y, 2.72));
  T.add('camo', box(1.3, 0.12, 0.14, 0, 0.98, 2.42));
  T.add('dark', yTube(0.66, SR.y, 0.36, 0.36, 24, 0, SR.z)); // radar drive drum under the turntable
  T.add('camo', yTube(0.5, 0.66, 0.4, 0.38, 24, 0, SR.z));
}

// Upper block: four sloped panels a side, the cells' deck with hinge housings along the outer edges,
// the equipment and waveguide runs behind the lids.
function upperBlock(T) {
  const { z0, z1, top, hw0, hw1 } = BLOCK, y0 = BODY.top;
  const sh = BLOCK.shoulder;
  T.add('camo', frontProfile([[-hw0, y0], [hw0, y0], [hw1, sh], [hw1 - 0.02, top], [-(hw1 - 0.02), top], [-hw1, sh]], z0, z1));
  const slope = Math.atan2(hw0 - hw1, sh - y0);
  for (const s of [-1, 1]) {
    // dark seams between the panels, so the block's own (shinier) slope does not show through as light lines
    for (const z of [-0.08, 0.765, 1.53]) {
      const x = s * ((hw0 + hw1) / 2 + 0.005), y = (y0 + sh) / 2;
      T.add('camo', box(0.03, (sh - y0) / Math.cos(slope), 0.06, x, y, z, 0, 0, s * slope), { tint: 0x3a3a3a });
    }
    for (const [a, b] of [[-0.66, -0.1], [-0.06, 0.74], [0.79, 1.5], [1.56, 2.3]]) { // tor_m2u_01 panel seams
      // raised panel on the slope with a gap round it
      const x = s * ((hw0 + hw1) / 2 + 0.015), y = (y0 + sh) / 2;
      const pg = rb(0.035, (sh - y0) / Math.cos(slope) - 0.06, b - a, 0.012, x, y, (a + b) / 2, 0, 0, s * slope).toNonIndexed();
      projectUV(pg, 4);
      T.add('slope', pg, { tint: new THREE.Color(0.6, 0.64, 0.8) });
      T.add('camo', box(0.02, 0.02, 0.07, x - s * 0.17, y + 0.14, a + 0.1, 0, 0, s * slope), { tint: 0x8a8a8a }); // latch
      T.add('camo', box(0.02, 0.025, 0.12, x + s * 0.12, y - 0.08, (a + b) / 2, 0, 0, s * slope), { tint: 0x8a8a8a }); // handle
    }
    T.add('dark', box(0.02, 0.05, 0.2, s * (hw1 - 0.005), 1.17, 1.6));
    // hinge housings along the outer edge of the lid rows
    for (const z of LID.z) {
      T.add('camo', rb(0.06, 0.06, LID.len - 0.06, 0.015, s * (LID.hinge + 0.0), top + 0.02, z));
      T.add('dark', zTube(z - 0.2, z + 0.2, 0.022, 0.022, 6, s * LID.hinge, LID.y));
    }
  }
  // the cells' deck: dark wells under the lids (seen when one is open), frames between them
  for (const s of [-1, 1]) for (const z of LID.z) {
    T.add('dark', box(LID.w - 0.12, 0.012, LID.len - 0.08, s * CELL_X, top + 0.006, z));
    T.add('camo', box(LID.w - 0.04, 0.04, 0.03, s * CELL_X, top + 0.02, z - LID.len / 2 + 0.01)); // coaming between the cells
  }
  for (const s of [-1, 1]) T.add('camo', box(LID.w - 0.04, 0.04, 0.03, s * CELL_X, top + 0.02, LID.z[3] + LID.len / 2 - 0.01));
  T.add('camo', box(0.06, 0.04, 2.0, 0, top + 0.02, 0.28));
  // front face toward the antenna: equipment boxes
  T.add('camo', rb(0.9, 0.3, 0.1, 0.03, 0, 0.84, z0 - 0.05));
  for (const s of [-1, 1]) T.add('camo', rb(0.3, 0.22, 0.1, 0.03, s * 0.72, 0.86, z0 - 0.05));
  // the waveguide runs over the rear end of the deck down to the mast, a low rail along the centre
  const zb = LID.z[3] + LID.len / 2;
  for (const x of [-0.18, 0.12]) {
    const c = new THREE.CatmullRomCurve3([V(x, top + 0.03, zb - 0.2), V(x, top + 0.08, z1 - 0.15), V(x * 0.6, top - 0.05, z1 + 0.05), V(x * 0.4, 0.98, SR.z - 0.3)]);
    T.add('dark', new THREE.TubeGeometry(c, 16, 0.045, 6, false));
  }
  T.add('camo', rb(0.9, 0.08, 0.16, 0.03, 0, top + 0.04, z1 - 0.1)); // rear edge box
}

// The tracking antenna's fixed mounts: bearing housings outside the trunnions on plates down to the
// lower body and back to the block, the curved fender plate low on the left and the braced equipment
// panel on the right (tor_m2u_01 left side, _05 and _10 right side).
function antennaMounts(T) {
  for (const s of [-1, 1]) {
    const x = s * 0.92;
    T.add('camo', sideProfile([[-1.66, 0.62], [-1.62, 1.0], [-1.3, 0.98], [BLOCK.z0, 0.95], [BLOCK.z0, BODY.top], [-1.0, 0.55], [-1.22, 0.08], [-1.5, 0.08]], 0.12).translate(x, 0, 0));
    T.add('camo', xTube(s * 0.86, s * 1.0, 0.24, 0.24, 20, TR.y, TR.z));
    T.add('camo', xTube(s * 1.0, s * 1.04, 0.13, 0.11, 14, TR.y, TR.z), { tint: 0xb0b0b0 });
  }
  // a lens in the end of the left trunnion bearing (tor_m2_08)
  T.add('dark', xTube(-1.04, -1.07, 0.09, 0.09, 16, TR.y, TR.z));
  T.add('glass', xTube(-1.07, -1.075, 0.07, 0.07, 16, TR.y, TR.z));
  // left: curved fender plate below the trunnion, ahead of the side box's raked front
  // a plate set at a slant below the trunnion, ahead of the lower body (tor_m2u_01)
  T.add('camo', sideProfile([[-1.42, 0.12], [-1.66, 0.44], [-1.82, 0.32], [-1.6, 0.08]], 0.3, 0.015).translate(-1.12, 0, 0));
  // right: braced equipment panel standing ahead of the side box
  T.add('camo', rb(0.1, 1.0, 0.3, 0.03, 1.2, 0.55, -1.5, 0.1, 0, 0));
  T.add('camo', rb(0.16, 0.36, 0.2, 0.02, 1.32, 0.66, -1.48));
  for (const y of [0.25, 0.55, 0.85]) T.add('dark', box(0.03, 0.025, 0.28, 1.26, y, -1.52 + y * 0.06));
  T.add('dark', rod(V(1.26, 0.12, -1.64), V(1.26, 1.0, -1.4), 0.012, 4));
}

// The tracking antenna in its pivot (trunnion at the origin, face toward -Z when upright): a deep box
// with a square face and the round shallow radome on it, ribs and a box on the back, the trunnion
// hubs, and the sensor domes on their brackets at the upper sides.
function antenna(A) {
  const { hw, y0, y1, zf, zb } = ANT, ym = (y0 + y1) / 2, zm = (zf + zb) / 2;
  // full depth at both ends (the outer end in travel shows a 0.6 m end face, tor_m2u_01), small bevel at the back
  A.add('camo', sideProfile([[zf, y0], [zf, y1], [zb - 0.08, y1], [zb, y1 - 0.08], [zb, y0 + 0.08], [zb - 0.08, y0]], hw * 2, 0.02));
  // face: a raised square frame and the round radome (tor_m2u_09 top view, tor_m2_08, _11)
  A.add('camo', box(hw * 2 - 0.06, y1 - y0 - 0.06, 0.02, 0, ym, zf - 0.005), { tint: FACE });
  const R = 0.59;
  A.add('camo', lathe([[R, 0], [R * 0.985, 0.012], [R * 0.85, 0.03], [R * 0.55, 0.045], [0.001, 0.05]], 40).rotateX(-Math.PI / 2).translate(0, ym, zf - 0.015), { tint: new THREE.Color(1.18, 1.3, 1.05) });
  for (const s of [-1, 1]) {
    A.add('camo', box(0.05, y1 - y0, 0.06, s * (hw - 0.01), ym, zf - 0.02)); // frame edges
    A.add('camo', box(hw * 2, 0.05, 0.06, 0, ym + s * ((y1 - y0) / 2 - 0.01), zf - 0.02));
  }
  for (const [x, y] of [[-0.56, y1 - 0.08], [0.56, y1 - 0.08], [-0.56, y0 + 0.08], [0.56, y0 + 0.08]]) A.add('dark', zTube(zf - 0.03, zf - 0.05, 0.018, 0.018, 6, x, y));
  // back: two ribs, a cable box and conduits
  for (const x of [-0.32, 0.32]) A.add('camo', box(0.06, 0.75, 0.05, x, y0 + 0.43, zb + 0.02));
  A.add('camo', rb(0.5, 0.36, 0.12, 0.03, 0, y0 + 0.45, zb + 0.06));
  A.add('dark', rod(V(-0.2, y0 + 0.15, zb + 0.03), V(-0.2, 0.15, zb + 0.08), 0.025, 5));
  // trunnion hubs on the sides
  for (const s of [-1, 1]) {
    A.add('camo', xTube(s * hw, s * 0.86, 0.2, 0.2, 18, 0, 0));
    // sensor domes out from the sides, their fronts about flush with the face: one at the top corner on an
    // angular housing, the other a third of the way down on a smaller bracket (tor_m2_08, tor_m1_13). The
    // travel side view (tor_m2u_01, turret round, so its left side faces the camera) puts the top one on the
    // left: solved about the trunnion it is 0.70 above it and 0.24 ahead (centre at z +1.22, y 3.42 there)
    const top = s < 0, dx = s * (hw + 0.22), dy = top ? 0.7 : 0.24, dz = top ? -0.24 : zf + 0.2, r = top ? 0.19 : 0.17;
    if (top) {
      A.add('camo', rb(0.36, 0.26, 0.42, 0.04, s * (hw + 0.17), dy - 0.18, dz + 0.12));
      A.add('camo', box(0.3, 0.12, 0.36, s * (hw + 0.19), dy - 0.08, dz + 0.1, 0, 0, s * 0.35));
    } else {
      A.add('camo', rb(0.24, 0.18, 0.3, 0.03, s * (hw + 0.14), dy - 0.2, dz + 0.1));
      A.add('camo', box(0.1, 0.2, 0.1, s * (hw + 0.04), dy - 0.2, dz + 0.16));
    }
    A.add('camo', zTube(dz + 0.18, dz, r * 0.85, r * 0.92, 18, dx, dy));
    A.add('camo', sphere(r, dx, dy, dz, 1, 1, 1.05, 18), { tint: new THREE.Color(1.05, 1.12, 0.95) });
    A.add('dark', zTube(dz, dz + 0.02, r + 0.005, r + 0.005, 18, dx, dy));
  }

}

// The search antenna: column and turntable on the spinning pivot (S), the telescopic inner column (L,
// moves up with the deploy), and on the fold hinge (F): the yoke, the flat reflector (face toward +Z,
// the back with its frame rails and the two feed pipes toward -Z) and the louvred IFF visor on top,
// which bows toward -Z (tor_m2u_02 folded, _04 and tor_m2_07 raised).
function searchMast(S, L, F) {
  S.add('dark', yTube(0, 0.05, 0.32, 0.32, 24));
  S.add('camo', yTube(0.05, SR.col, 0.15, 0.15, 16));
  S.add('camo', rb(0.36, 0.2, 0.3, 0.03, 0, 0.17, -0.12));
  S.add('dark', xTube(-0.2, 0.2, 0.06, 0.06, 10, 0.18, -0.12));
  L.add('steel', yTube(-SR.lift - 0.02, 0, 0.1, 0.1, 14), { tint: 0x9a9f94 });
  L.add('camo', rb(0.34, 0.14, 0.26, 0.03, 0, 0, 0));
  L.add('dark', xTube(-0.2, 0.2, 0.05, 0.05, 10, 0, 0)); // fold hinge pin
  // yoke: hub, cross bar, the two feed pipes up the back of the reflector
  F.add('camo', rb(0.3, 0.16, 0.24, 0.03, 0, 0.09, -0.04));
  F.add('camo', box(1.0, 0.07, 0.08, 0, 0.13, -0.1));
  for (const s of [-1, 1]) {
    F.add('camo', yTube(0.1, 0.92, 0.04, 0.04, 8, s * 0.36, -0.12));
    F.add('camo', rod(V(s * 0.12, 0.08, -0.06), V(s * 0.5, 0.2, -0.08), 0.03, 6));
    F.add('camo', rb(0.1, 0.16, 0.08, 0.02, s * 0.36, 0.55, -0.17));
  }
  F.add('dark', rod(V(0, 0.12, -0.15), V(0.08, 0.8, -0.12), 0.012, 4));
  // reflector: a thin flat panel 1.9 x 0.85, a frame round it and three rails across the back
  const y0 = 0.16, y1 = 1.01, ym = (y0 + y1) / 2;
  F.add('camo', box(1.9, y1 - y0, 0.07, 0, ym, 0));
  F.add('camo', box(1.84, y1 - y0 - 0.06, 0.01, 0, ym, 0.04), { tint: FACE });
  for (const s of [-1, 1]) F.add('camo', box(0.05, y1 - y0 + 0.04, 0.12, s * 0.95, ym, 0));
  for (const y of [y0 + 0.08, ym, y1 - 0.08]) F.add('camo', box(1.85, 0.035, 0.04, 0, y, -0.06));
  for (const x of [-0.75, 0.75]) F.add('camo', box(0.035, y1 - y0 - 0.1, 0.035, x, ym, -0.055));
  F.add('camo', rb(0.2, 0.18, 0.1, 0.02, -0.62, ym + 0.1, -0.09));
  // the IFF hood on the top edge: a louvred band 1.2 m wide that rises off the reflector and curls back
  // over it (toward -Z), its ends dropping a little; slats follow the curl, five heavier frame ribs, a
  // rail along each edge (tor_m2u_04 from behind, _02 folded, tor_m2_07 head-on)
  const hw = 0.6, nS = 25, nT = 6, T0 = 1.8;
  const hood = (x, t) => { const R = 0.36 * (1 - 0.22 * (x / hw) ** 2); return V(x, y1 + 0.02 + R * Math.sin(t), -R + R * Math.cos(t)); };
  for (let i = 0; i < nS; i++) {
    const x = -hw + (2 * hw * i) / (nS - 1), frame = i % 6 === 0;
    for (let j = 0; j < nT; j++) {
      const a = hood(x, (T0 * j) / nT), b = hood(x, (T0 * (j + 1)) / nT), m = a.clone().add(b).multiplyScalar(0.5);
      const rx = -Math.atan2(b.y - a.y, b.z - a.z) + 0; // the box's length (z) along the slat
      F.add('camo', box(frame ? 0.03 : 0.012, frame ? 0.07 : 0.05, a.distanceTo(b) + 0.004, m.x, m.y, m.z, rx, 0, 0));
    }
  }
  for (const t of [0, T0]) for (let i = 0; i < 8; i++) {
    const x0 = -hw + (2 * hw * i) / 8, x1 = x0 + (2 * hw) / 8;
    F.add('camo', rod(hood(x0, t), hood(x1, t), 0.02, 5));
  }
  F.add('camo', box(1.3, 0.03, 0.18, 0, y1 + 0.02, -0.03)); // brim joining the hood to the reflector
}

// A lid in its hinge's space: the hinge on the outer edge at the origin, the lid reaching inboard
// (toward +X for side -1): plate with two stiffeners, a handle.
function lidGeom(side) {
  const d = -side, w = LID.w, L = LID.len;
  const g = [
    box(w, 0.05, L - 0.02, d * (w / 2 + 0.02), 0.025, 0),
    box(0.04, 0.012, L - 0.08, d * (w - 0.02), 0.055, 0),
    box(0.04, 0.02, 0.12, d * (w - 0.1), 0.06, 0),
  ];
  return mergeGeometries(g.map((x) => (x.index ? x.toNonIndexed() : x)).map((x) => { x.deleteAttribute('uv'); return x; }));
}

// ---------------------------------------------------------------- the 9M331 round

let mslMat;
// a body of revolution along Z from [radius, z] pairs (z ascending), nose toward -Z
function revZ(pts, seg = 16) {
  const g = lathe(pts.slice().sort((a, b) => b[1] - a[1]).map(([r, z]) => [Math.max(r, 0.0005), -z]), seg);
  return g.rotateX(-Math.PI / 2);
}

/**
 * The 9M331 missile on its own for the in-flight model: front -Z, origin at its centre, 2.9 m long,
 * 0.235 m diameter, four small canards behind the nose and four folding wings at the tail (both
 * unfolded). Body colour and fin planforms are unconfirmed (no photo of a round out of its container):
 * the pale grey-green body with a dark radome follows the display round on a Tor-M2E (tor_m2_11).
 * -> { parts: [{ geometry, material }], length, plume } (the threats.js interceptor shape).
 */
export function buildTorMissile() {
  mslMat ??= new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.25 });
  const P = new Parts({ body: mslMat });
  const L = 2.9, r = 0.1175, z0 = -L / 2, z1 = L / 2, BODY_C = 0xb3baa8, NOSE = 0x3e423d, FIN = 0x9ea595;
  const nose = [];
  for (let i = 0; i <= 10; i++) { const k = i / 10; nose.push([r * Math.sqrt(1 - (1 - k) ** 2) * 0.97 + r * 0.03 * k, z0 + 0.5 * k]); }
  P.add('body', revZ(nose.map(([rr, z], i) => [i === 0 ? 0.004 : rr, z]), 18), { tint: NOSE });
  P.add('body', revZ([[r, z0 + 0.5], [r, z1 - 0.12], [r * 0.86, z1 - 0.02], [r * 0.8, z1], [0, z1 + 0.0001]], 18), { tint: BODY_C });
  P.add('body', zTube(z0 + 0.5, z0 + 0.53, r + 0.003, r + 0.003, 18), { tint: 0x6f7568 }); // radome joint
  P.add('body', zTube(z1, z1 + 0.04, 0.075, 0.07, 12, 0, 0, true), { tint: 0x2a2a2a }); // nozzle
  const fin = (pts, t, roll, tint) => { const one = sideProfile(pts, t); for (let i = 0; i < 4; i++) P.add('body', one.clone().rotateZ(roll + (i * Math.PI) / 2), { tint }); };
  fin([[z0 + 0.62, r], [z0 + 0.8, r], [z0 + 0.78, r + 0.13], [z0 + 0.7, r + 0.13]], 0.012, Math.PI / 4, FIN); // canards
  fin([[z1 - 0.42, r], [z1 - 0.06, r], [z1 - 0.06, r + 0.25], [z1 - 0.2, r + 0.25]], 0.014, Math.PI / 4, FIN); // tail wings
  for (const s of [-1, 1]) P.add('body', box(0.03, 0.02, 0.5, s * (r + 0.005), 0, 0.1), { tint: 0x8d9384 }); // cable ducts
  const geometry = P.merged('body');
  geometry.computeBoundingSphere();
  return { parts: [{ geometry, material: mslMat }], length: L, plume: V(0, 0, z1 + 0.05) };
}

// ---------------------------------------------------------------- vehicle

export function buildTor() {
  const rig = newRig('green');
  rig.mats = ownMats();
  rig.P = new Parts(rig.mats);
  const { P, root, mats } = rig;
  addHull(P);
  addRunningGear(P);
  olive(P.build(root, { dirt: 0.55 }));

  // ---- turret
  const tur = pivotAt(rig, root, 'turret', 0, RING.y, RING.z);
  const T = new Parts(mats);
  lowerBody(T);
  upperBlock(T);
  antennaMounts(T);
  olive(T.build(tur, { dirt: 0.2, y0: RING.y }));

  // ---- tracking antenna on its trunnions
  const tr = pivotAt(rig, tur, 'trackRadar', 0, TR.y, TR.z);
  const A = new Parts(mats);
  antenna(A);
  olive(A.build(tr, { dirt: 0, y0: RING.y + TR.y }));
  rig.trackTravel = TRACK_TRAVEL;

  // ---- search antenna: spin pivot, telescopic mast, fold hinge
  const sr = pivotAt(rig, tur, 'searchRadar', 0, SR.y, SR.z);
  const lift = new THREE.Group();
  lift.name = 'searchLift';
  sr.add(lift);
  const fold = new THREE.Group();
  fold.name = 'searchFold';
  lift.add(fold);
  const S = new Parts(mats), Lp = new Parts(mats), F = new Parts(mats);
  searchMast(S, Lp, F);
  olive(S.build(sr, { dirt: 0, y0: RING.y + SR.y }));
  olive(Lp.build(lift, { dirt: 0, y0: RING.y + SR.y + SR.col }));
  // the yoke holds the reflector 0.19 m to its face side of the hinge, so folded it lies below the hinge
  const arm = new THREE.Group();
  arm.position.z = 0.19;
  fold.add(arm);
  olive(F.build(arm, { dirt: 0, y0: RING.y + SR.y + SR.col + SR.lift }));
  rig.setDeploy = (v) => {
    v = Math.min(1, Math.max(0, v));
    fold.rotation.x = SR.fold * (1 - smooth(0, 0.62, v));
    lift.position.y = SR.col + SR.lift * (SR.park + (1 - SR.park) * smooth(0.5, 1, v));
    rig.deploy = v;
  };
  rig.setDeploy(1);

  // ---- cells: lids (one draw call), round container ends (one draw call), slot anchors
  rig.hatches = [];
  const lidItems = [], capItems = [];
  const order = [];
  LID.z.forEach((z) => { for (const s of [-1, 1]) order.push([s, z]); });
  order.forEach(([s, z], i) => {
    const h = node(tur, 'hatch' + i, s * LID.hinge, LID.y, z);
    h.userData.open = -s * LID.open;
    rig.hatches.push(h);
    lidItems.push({ node: h, geom: lidGeom(s) });
    const c = node(tur, 'cell' + i, s * CELL_X, BLOCK.top + 0.0, z);
    const cap = mergeGeometries([yTube(0, 0.025, 0.15, 0.15, 12), yTube(0.025, 0.035, 0.09, 0.07, 10)].map((x) => x.toNonIndexed()).map((x) => { x.deleteAttribute('uv'); return x; }));
    capItems.push({ node: c, geom: cap });
    rig.anchors.missileSlots.push(node(tur, 'slot' + i, s * CELL_X, BLOCK.top + 0.02, z, Math.PI / 2, 0, 0));
  });
  olive([followMesh(tur, mats, 'camo', lidItems, RING.y)]);
  followMesh(tur, mats, 'canister', capItems, RING.y);
  rig.setHatch = (i, t) => { const h = rig.hatches[i]; if (h) h.rotation.z = h.userData.open * Math.min(1, Math.max(0, t)); };
  rig.slots = capItems.map(() => []);
  rig.setLoaded = (i, loaded) => { if (capItems[i]) capItems[i].on = !!loaded; };

  rig.anchors.eye = node(root, 'eye', 0, 2.6, 0.35);
  hb(rig, -GM355.W - 0.1, 0, GM355.nose[0], GM355.W + 0.1, GM355.roof, GM355.rear);
  hb(rig, -BODY.hw, RING.y, RING.z - 1.9, BODY.hw, RING.y + 1.35, RING.z + 2.9);
  hb(rig, -0.95, RING.y + 0.2, RING.z - 1.95, 0.95, RING.y + 1.7, RING.z - 1.3);
  return rig;
}
