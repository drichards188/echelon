import * as THREE from 'three';
import { V, xf, box, rbox, yTube, zTube, xTube, rod, lathe, loft, sideProfile, vehicleMats, camoTextures, surfaceFinish, scaleUV, Parts } from '../kit.js';
import { newRig, node, pivotAt, hb } from '../rig.js';
import { GM352, buildChassis, plateRR } from './gm352.js';
import { mark, span, swapper } from './swap.js';

// 2S6M Tunguska-M (2K22M) combat vehicle on the GM-352M chassis (gm352.js), after refs/tunguska:
// photos 01 to 06 the 2S6M itself, 07, 09, 15 and 16 the raised guns, launchers and search antenna.
// Proportions were checked by solving each photo's camera from known points (road wheels, hull
// corners) and overlaying renders, and against the side profile of photo 02 at 230 px/m.
// The turret sits forward (its axis 3.1 m behind the glacis tip): a broad faceted base plinth, a
// wide lower body with a narrower upper body on it, a tall rear box carrying the folding search
// antenna, the round tracking radar on a short mount at the front, a twin-barrelled 2A38M on each
// side between the body and a fixed armour plate, outboard of the guns a launcher of four 9M311
// containers (two over two) whose rear half the plate covers, and on the roof the tall sight
// cylinder, the sight head with its searchlight, a vent pipe and the whip.
//
// Rig (model space: front -Z, right +X, ground y = 0, metres; the hull is centred on z = 0):
//   turret       Group at (0, 1.98, -0.85), on the turret ring. Yaw about +Y: rotation.y = 0 faces the
//                front of the hull, + turns the front to the left (three's convention). 360 degrees.
//   elevation    child of turret at (0, 0.72, 1.1) turret space: the trunnion line of both guns, at the
//                rear of the side plates (photo 07; the muzzles are 2.81 m ahead of it). rotation.x > 0
//                raises the -Z (muzzle) end. Range -0.17 to +1.52 rad (-10 to +87 degrees,
//                en.wikipedia); the breeches sink into the body's gun bays as they rise.
//   launcher     child of turret at (0, 0.61, 1.45): both four-round launchers on one transverse axis
//                near the rear of the containers. They elevate on their own drive, not with the guns
//                (photos 07, 09, 15: guns up, containers level; 16: the arm raised; photo 10 even
//                shows one side up and one level, so the real sides may move apart: unconfirmed).
//                rotation.x > 0 raises the container mouths. Range 0 (stowed level, as in every
//                travel photo) to about 1.25 rad.
//   trackRadar   child of turret at (0.05, 0.66, -1.08): the round tracking antenna's own elevation
//                axis, rotation.x > 0 tilts its face up. Not linked to the guns (photos 07, 09, 15 show
//                it level with the guns raised); 0 = level, about -0.2 to +1.4 rad.
//   searchRadar  child of turret at (0, 1.19, 2.3), on top of the rear box: the search antenna's
//                turntable, spun about +Y by the render with the radar sweep (rotation.y; 0 = facing
//                the front of the turret, any angle). On it a yoke carries the fold hinge (a plain
//                Group 'fold', not a pivot), set by rig.setDeploy(v):
//                  v = 1  in action: the reflector stands upright, its top 4.1 m above the ground
//                         (photos 09, 15, 16); the rig is built this way.
//                  v = 0  travel: folded back 106 degrees, the feed box lying on top and the reflector
//                         under it as an arch whose wings droop over the rear of the turret (photos
//                         02 to 04); keep searchRadar.rotation.y at 0 while folded.
//                  between: part way (the fold is linear in v), for the raise and stow animation.
// Anchors: eye (camera focus over the turret ring), sight (the sight head's window on the roof, in
// turret space), muzzles (4: left gun upper and lower barrel, then the right gun's, -Z along the
// bore, on the elevation pivot), missileSlots (8, on the launcher pivot at the container mouths,
// -Z out of the mouth; launch order alternating left and right: upper outer, upper inner, lower
// outer, lower inner). setLoaded(i, false) takes the front cover off container i so it shows an
// empty bore (the spent container stays on the launcher until the 2F77M reloads it); setContainer(i,
// false) takes container i off its launcher altogether (the reload scene swaps the containers).
// tunguskaContainer() and containerCover() build the container and its cover for the reload scene.
// build9M311() builds the missile on its own: front -Z, origin at its centre, the booster a child
// Group (userData.booster) that the launch animation can detach.

const TZ = -0.85; // turret axis (3.1 m behind the glacis tip: photos 02 and 05)
const TY = GM352.roof + 0.02; // turret ring face
const EL = { y: 0.72, z: 1.1 }; // gun trunnions (turret space)
const GUN = { x: 0.8, dy: 0.045, muzzle: -2.81 }; // elevation space
const LA = { y: 0.61, z: 1.45 }; // launcher axis (turret space)
export const CONT = { r: 0.1, z0: -2.5, z1: 0.25, cols: [1.02, 1.24], rows: [-0.11, 0.11] }; // launcher space
const PLATE = { x: 1.37, y0: 0.37, y1: 0.85, z0: 0.03, z1: 1.48 }; // fixed side armour (turret space)
const DISH = { x: 0.05, y: 0.66, z: -1.08, r: 0.39 }; // 0.8 m over the rim (README, photo 15)
const SR = { y: 1.19, z: 2.3, hinge: 0.25, hy: 0.2 };
const FOLD = 1.85; // search antenna fold angle at travel (rad, back and down past the horizontal)

// a z-tube squashed to an oval about its own axis (sx, sy scale the radius)
const ovalZ = (z0, z1, r, sx, sy, x, y, seg = 16) => zTube(z0, z1, r, r, seg).applyMatrix4(xf(x, y, 0, 0, 0, 0, V(sx, sy, 1)));

// The shared 'green' scheme leans yellow and light; the 2S6M's paint is a darker green-grey (sampled
// from photos 06 and 09: blue about equal to green, red a little lower), so the painted parts take a
// cool vertex tint. The painted materials are the Tunguska's own copies of the shared ones (same
// textures) with less, greyer dust on the up-facing plates: the shared khaki dust turned the deck and
// the turret roof yellow. Both exported for the 2F77M transloader, painted the same.
export function greyer(meshes) {
  for (const m of meshes) if (m.name === 'camo' || m.name === 'paint') {
    const c = m.geometry.attributes.color;
    for (let i = 0; i < c.count; i++) c.setXYZ(i, c.getX(i) * 0.74, c.getY(i) * 0.85, c.getZ(i) * 1.55);
  }
  return meshes;
}
let ownMats;
export function tunguskaMats() {
  if (ownMats) return ownMats;
  const tex = camoTextures('green');
  const mk = (key, color) => {
    const m = new THREE.MeshStandardMaterial({ color, roughness: 1, metalness: 0, vertexColors: true, map: tex.map, roughnessMap: tex.rough, normalMap: tex.normal });
    m.normalScale.set(0.7, 0.7);
    return surfaceFinish(m, 'veh-tunguska-' + key, { mud: 0.8, dust: 0.3, dustColor: 0x8e8d86 });
  };
  ownMats = { ...vehicleMats('green'), camo: mk('camo', 0xffffff), paint: mk('paint', 0x56603d) };
  return ownMats;
}

// ---------------------------------------------------------------- turret body

function turretBody(T) {
  // base plinth: a broad faceted ring with near vertical sides and a bevelled top edge
  T.add('camo', lathe([[1.36, 0.0], [1.36, 0.19], [1.29, 0.26], [0.001, 0.26]], 12).rotateY(Math.PI / 12));
  T.add('dark', yTube(-0.03, 0.0, 1.2, 1.2, 24));
  for (let i = 0; i < 12; i++) { // bolted lugs round the plinth's foot
    const a = (i / 12) * Math.PI * 2 + Math.PI / 12;
    T.add('dark', box(0.1, 0.04, 0.05, Math.sin(a) * 1.37, 0.04, Math.cos(a) * 1.37, 0, a, 0));
  }
  // main body: a wide lower block with a flat front, and on it a narrower upper block with rounded
  // roof edges; the guns ride on the shoulders between the two (photos 06, 15)
  const ring = (y, hw, zf, zr, cf) => [V(hw - cf, y, zf), V(hw, y, zf + cf), V(hw, y, zr), V(-hw, y, zr), V(-hw, y, zf + cf), V(-(hw - cf), y, zf)];
  // the lower body's front is a sloped chin from the plinth up under the dish, its corners cut back
  // at an angle; the upper body's front leans back to the roof with chamfered cheeks (photos 06, 15)
  T.add('camo', loft([ring(0.24, 0.84, -1.0, 1.95, 0.34), ring(0.44, 0.84, -0.93, 1.95, 0.3), ring(0.62, 0.84, -0.86, 1.95, 0.26)], { crease: 0.5 }));
  T.add('camo', loft([ring(0.6, 0.66, -0.86, 1.95, 0.22), ring(0.95, 0.65, -0.8, 1.95, 0.24), ring(1.07, 0.55, -0.66, 1.95, 0.2)], { crease: 0.5 }));
  // front details: a handle on each cheek, the seam along the chin's top
  for (const s of [-1, 1]) T.add('dark', box(0.03, 0.12, 0.04, s * 0.46, 0.74, -0.86, 0, -s * 0.5, 0));
  T.add('dark', box(0.9, 0.012, 0.012, 0, 0.62, -0.865));
  // rear box (taller than the body, vertical faces) with the door on its back face
  T.add('camo', rbox(1.36, 1.13, 0.54, 0.16, 0, 0.605, 2.19)); // rear box, its top edges well rounded (photos 08, 09)
  T.add('camo', plateRR(1.0, 0.6, 0.06, 0.03, 0, 0, 0).rotateY(Math.PI / 2).translate(0.02, 0.43, 2.465), { tint: 0xd4d4d4 }); // door
  for (const y of [0.25, 0.7]) T.add('dark', box(0.05, 0.1, 0.05, -0.51, y, 2.47));
  T.add('dark', box(0.03, 0.18, 0.05, 0.44, 0.5, 2.49));
  for (const y of [0.33, 0.55]) T.add('dark', box(0.7, 0.012, 0.012, 0.02, y, 2.483)); // stiffener ribs
  // the recess at the top of the back face where the search antenna's mount comes down, with the
  // mount's round joint in it (photos 04, 08, 09)
  T.add('dark', plateRR(0.42, 0.36, 0.08, 0.02, 0, 0, 0).rotateY(Math.PI / 2).translate(0, 0.94, 2.468));
  T.add('camo', xTube(-0.12, 0.12, 0.09, 0.09, 14, 0.9, 2.42));
  // X-stamped boxes on the rear box's flanks (photos 02, 03, 05)
  for (const s of [-1, 1]) {
    T.add('camo', rbox(0.12, 0.55, 0.26, 0.02, s * 0.74, 0.42, 2.3));
    for (const r of [-1, 1]) T.add('dark', box(0.01, 0.58, 0.015, s * 0.802, 0.42, 2.3, r * 0.42, 0, 0));
  }
  // roof: a hatch plate, the cupola, the sight head with the searchlight, vent pipe, intake, whip
  T.add('camo', rbox(0.5, 0.03, 0.5, 0.02, 0.15, 1.08, 0.95), { tint: 0xd6d6d6 });
  // the tall sight cylinder left of centre (photos 05, 06, 07): a drum with a domed cap, a small lens
  // on its left and vision blocks round its front
  T.add('camo', yTube(1.02, 1.38, 0.22, 0.21, 20, -0.28, 0.35));
  T.add('camo', lathe([[0.21, 0], [0.19, 0.05], [0.12, 0.09], [0.001, 0.1]], 20).translate(-0.28, 1.38, 0.35));
  for (let i = 0; i < 3; i++) {
    const a = -0.6 + i * 0.6;
    T.add('glass', box(0.07, 0.045, 0.012, -0.28 + Math.sin(a) * 0.215, 1.26, 0.35 - Math.cos(a) * 0.215, 0, -a, 0));
  }
  T.add('dark', xTube(-0.5, -0.53, 0.04, 0.04, 10, 1.3, 0.3));
  T.add('glass', xTube(-0.53, -0.535, 0.028, 0.028, 10, 1.3, 0.3));
  T.add('dark', yTube(1.02, 1.08, 0.25, 0.25, 20, -0.28, 0.35)); // base ring
  // sight head: a box with its window to the front and the searchlight on a fork above it
  T.add('camo', rbox(0.3, 0.14, 0.34, 0.03, 0.2, 1.12, -0.2));
  T.add('dark', box(0.2, 0.08, 0.02, 0.2, 1.12, -0.37));
  T.add('glass', box(0.17, 0.06, 0.01, 0.2, 1.12, -0.381), { tint: 0x8fb0ff });
  T.add('dark', yTube(1.17, 1.23, 0.04, 0.04, 8, 0.2, -0.2));
  for (const s of [-1, 1]) T.add('dark', box(0.025, 0.14, 0.05, 0.2 + s * 0.13, 1.28, -0.2));
  T.add('camo', xTube(0.08, 0.32, 0.11, 0.11, 16, 1.33, -0.2), { tint: 0xc0c0c0 });
  T.add('dark', zTube(-0.27, -0.33, 0.1, 0.1, 16, 0.2, 1.33));
  T.add('lens', zTube(-0.33, -0.335, 0.085, 0.085, 16, 0.2, 1.33));
  T.add('camo', zTube(-0.05, -0.27, 0.11, 0.11, 16, 0.2, 1.33));
  // corrugated vent pipe ahead of the rear box, right
  for (let i = 0; i < 5; i++) T.add('dark', yTube(1.07 + i * 0.045, 1.1 + i * 0.045, 0.065, 0.065, 12, 0.42, 1.68));
  T.add('dark', yTube(1.07, 1.3, 0.055, 0.055, 10, 0.42, 1.68));
  // louvred intake on the roof's right, aft
  T.add('camo', rbox(0.34, 0.08, 0.3, 0.02, 0.28, 1.1, 1.35));
  for (let i = 0; i < 5; i++) T.add('dark', box(0.3, 0.012, 0.02, 0.28, 1.145, 1.23 + i * 0.06));
  // whip on its base at the left rear of the roof, leaning forward a little (photos 02, 05)
  T.add('dark', yTube(1.05, 1.22, 0.05, 0.04, 8, -0.45, 1.0));
  T.add('dark', rod(V(-0.45, 1.22, 1.0), V(-0.45, 3.9, 0.45), 0.011, 5));
  // small fittings: periscope heads, lifting eyes, grab rails
  T.add('dark', rbox(0.16, 0.1, 0.12, 0.02, 0.05, 1.11, 0.45));
  T.add('glass', box(0.12, 0.05, 0.01, 0.05, 1.12, 0.388));
  for (const [x, z] of [[-0.5, -0.45], [0.5, -0.45], [-0.5, 1.7], [0.5, 1.2]]) T.add('dark', box(0.05, 0.06, 0.08, x, 1.08, z));
  T.add('steel', rod(V(-0.45, 1.13, 1.45), V(-0.1, 1.13, 1.45), 0.012, 5), { tint: 0x777777 });
}

// The fixed armour plate on each side, the gun bay behind it, and the launcher's support below it
function sideArmour(T, s) {
  const { x, y0, y1, z0, z1 } = PLATE;
  T.add('camo', plateRR(z1 - z0, y1 - y0, 0.08, 0.05, s * x, (y0 + y1) / 2, (z0 + z1) / 2));
  T.add('camo', plateRR(z1 - z0 - 0.06, y1 - y0 - 0.06, 0.06, 0.03, s * (x + 0.02), (y0 + y1) / 2, (z0 + z1) / 2), { tint: 0xdedede });
  T.add('dark', xTube(s * (x + 0.02), s * (x + 0.04), 0.025, 0.025, 8, y1 - 0.08, z1 - 0.1));
  // brackets from the body out to the plate, above and below the launcher
  for (const z of [0.25, 1.25]) {
    T.add('camo', box(x - 0.84, 0.06, 0.1, s * (x + 0.84) / 2, y1 - 0.02, z));
    T.add('camo', box(x - 0.84, 0.06, 0.1, s * (x + 0.84) / 2, y0 + 0.02, z));
  }
  // the launcher's lower support: a sloped plate from under the plate's rear down to the plinth
  T.add('camo', rbox(0.6, 0.04, 0.9, 0.02, s * 1.05, 0.33, 1.05, 0.0, 0, s * 0.25));
  T.add('dark', box(0.06, 0.3, 0.08, s * 0.98, 0.42, 1.5));
  // the launcher's trunnion bearings on the body side, at the rear
  T.add('dark', xTube(s * 0.82, s * 0.92, 0.08, 0.08, 12, LA.y, LA.z));
}

// ---------------------------------------------------------------- guns

// One 2A38M: receiver, the two barrels one over the other inside a long cooling jacket, bare
// barrels ahead with a clamp, and the long forked muzzle frame (elevation space). Returns the two
// muzzle points (upper, lower).
function gun(E, s) {
  const x = s * GUN.x;
  E.add('camo', rbox(0.2, 0.3, 1.05, 0.04, x, -0.02, -0.02)); // receiver
  E.add('dark', rbox(0.12, 0.16, 0.6, 0.03, x - s * 0.14, -0.06, 0.05)); // feed on the inboard side
  E.add('camo', xTube(x - s * 0.1, x - s * 0.18, 0.33, 0.33, 24, 0, 0)); // cradle sector over the trunnion
  E.add('dark', xTube(x - s * 0.18, x - s * 0.22, 0.12, 0.12, 12, 0, 0));
  E.add('dark', ovalZ(-0.45, -1.95, 0.095, 1.0, 1.3, x, 0, 16)); // cooling jacket round both barrels (photos 07, 09)
  E.add('dark', ovalZ(-0.47, -0.57, 0.105, 1.0, 1.3, x, 0, 16)); // its collars
  E.add('dark', ovalZ(-1.85, -1.95, 0.103, 1.0, 1.3, x, 0, 16));
  E.add('dark', ovalZ(-1.2, -1.26, 0.102, 1.0, 1.3, x, 0, 16));
  const out = [];
  for (const d of [1, -1]) {
    const y = d * GUN.dy;
    E.add('dark', zTube(-1.95, GUN.muzzle + 0.04, 0.026, 0.024, 10, x, y));
    E.add('dark', zTube(GUN.muzzle + 0.04, GUN.muzzle, 0.032, 0.032, 10, x, y)); // muzzle ring
    out.push(V(x, y, GUN.muzzle));
  }
  E.add('dark', box(0.075, 0.16, 0.06, x, 0, -2.3)); // barrel clamp
  E.add('dark', rod(V(x, 0.075, -1.95), V(x, 0.075, -2.3), 0.012, 5)); // gas tube on top
  // forked muzzle frame: side plates with slots and a cross plate
  for (const e of [-1, 1]) for (const d of [-1, 1]) E.add('dark', box(0.014, 0.03, 0.46, x + e * 0.045, d * 0.07, GUN.muzzle + 0.27)); // side rails
  for (const e of [-1, 1]) E.add('dark', box(0.014, 0.17, 0.03, x + e * 0.045, 0, GUN.muzzle + 0.5));
  for (const d of [-1, 1]) E.add('dark', box(0.1, 0.03, 0.05, x, d * 0.075, GUN.muzzle + 0.04)); // front fork
  E.add('dark', box(0.1, 0.04, 0.03, x, 0, GUN.muzzle + 0.06));
  return out;
}

// ---------------------------------------------------------------- launchers

// Four containers two over two on one side (launcher space, side -1 left, +1 right): tubes with
// bands, rear closures, clamp frames round the block and the arm along its inner foot.
// One 9M311 container as it sits on a launcher (launcher space, axis at x, y): the tube, the mouth
// collar and lip, the bore under the cover, the rear closure and the bands. Exported so the reload
// scene and the 2F77M's load build the same container.
export function tunguskaContainer(L, x, y) {
  const { r, z0, z1 } = CONT;
  L.add('canister', zTube(z1, z0 + 0.04, r, r, 18, x, y, true), { tint: 0xd2d2dc });
  L.add('canister', zTube(z0 + 0.04, z0, r + 0.012, r + 0.012, 18, x, y, true), { tint: 0x8c8c84 }); // mouth collar
  L.add('canister', lathe([[r + 0.012, 0], [r - 0.01, 0]], 18).applyMatrix4(xf(x, y, z0, -Math.PI / 2, 0, 0)), { tint: 0x8c8c84 });
  L.add('dark', zTube(z0 + 0.14, z0 + 0.12, r - 0.008, r - 0.008, 16, x, y)); // the bore under the cover
  L.add('canister', zTube(z1 - 0.03, z1 + 0.02, r + 0.01, r + 0.01, 18, x, y), { tint: 0x8c8c84 }); // rear closure
  L.add('dark', zTube(z1 + 0.02, z1 + 0.025, 0.05, 0.05, 10, x, y));
  for (const z of [z0 + 0.5, -1.0]) L.add('canister', zTube(z + 0.03, z - 0.03, r + 0.008, r + 0.008, 18, x, y, true), { tint: 0x9a9a92 }); // bands
}

// the front cover of a loaded container (one per slot in the covers mesh)
export const containerCover = (x, y) => lathe([[0.001, -0.02], [CONT.r + 0.006, -0.02], [CONT.r + 0.006, 0.0], [0.08, 0.015], [0.04, 0.026], [0.001, 0.028]], 14).applyMatrix4(xf(x, y, CONT.z0 - 0.004, -Math.PI / 2, 0, 0));

// slot order (rig.missileSlots): [column, row] pairs, each left then right
const ORDER = [[1, 1], [0, 1], [1, 0], [0, 0]];

function launcherBlock(L, s, spans) {
  const { r, z0, z1, cols, rows } = CONT;
  // each container's vertices are recorded so the reload scene can take it off (rig.setContainer)
  cols.forEach((c, ci) => rows.forEach((y, ri) => {
    const m = mark(L);
    tunguskaContainer(L, s * c, y);
    spans[2 * ORDER.findIndex(([a, b]) => a === ci && b === ri) + (s > 0 ? 1 : 0)] = span(L, m);
  }));
  const xm = s * (cols[0] + cols[1]) / 2, w = cols[1] - cols[0] + 2 * r + 0.05;
  const yb = rows[0] - r - 0.025, yt = rows[1] + r + 0.025;
  // clamp frames: front, middle, rear
  for (const z of [z0 + 0.32, -1.3, z1 - 0.2]) {
    L.add('paint', box(w, 0.03, 0.09, xm, yt, z));
    L.add('paint', box(w, 0.03, 0.09, xm, yb, z));
    for (const xx of [xm - w / 2, xm + w / 2]) L.add('paint', box(0.03, yt - yb, 0.09, xx, (yb + yt) / 2, z));
  }
  // the arm: a flat beam with lightening holes along the block's inner foot, back to the trunnion
  const xa = s * (cols[0] - r - 0.03);
  L.add('paint', box(0.03, 0.16, z1 - z0 - 0.4, xa, yb + 0.05, (z0 + z1) / 2 + 0.15));
  for (let i = 0; i < 7; i++) L.add('dark', xTube(xa - s * 0.016, xa - s * 0.018, 0.03, 0.03, 8, yb + 0.05, z0 + 0.6 + i * 0.3));
  L.add('paint', box(0.16, 0.05, z1 - z0 - 0.6, xm - s * 0.04, yb - 0.02, (z0 + z1) / 2 + 0.2));
  L.add('dark', rbox(0.2, 0.22, 0.3, 0.03, s * 0.88, 0, 0)); // trunnion block
}

// ---------------------------------------------------------------- tracking radar

// Round tracking antenna (radar space, origin on its elevation axis): a drum with a rolled rim and a
// faintly domed radome face, ports round the rim, a mount box and cable loom behind.
function trackDish(D) {
  const { r } = DISH, zf = -0.33, zb = -0.08;
  D.add('camo', zTube(zb, zf + 0.04, r, r, 36, 0, 0));
  D.add('paint', zTube(zf + 0.08, zf, r + 0.025, r + 0.025, 36, 0, 0)); // front rim
  const dome = lathe([[r * 0.98, -0.01], [r * 0.98, 0.0], [r * 0.8, 0.025], [r * 0.45, 0.04], [0.001, 0.045]], 36);
  D.add('canister', dome.applyMatrix4(xf(0, 0, zf, -Math.PI / 2, 0, 0)), { tint: new THREE.Color(0.98, 0.98, 1.22) }); // radome: the body's grey-green, a shade lighter (photos 01, 06)
  for (let i = 0; i < 10; i++) { // small round ports round the drum's side
    const a = (i / 10) * Math.PI * 2;
    D.add('dark', zTube(zf + 0.12, zf + 0.15, 0.018, 0.018, 6, Math.cos(a) * (r + 0.004), Math.sin(a) * (r + 0.004)).applyMatrix4(new THREE.Matrix4()));
  }
  D.add('camo', zTube(zb + 0.03, zb, r * 0.9, r * 0.9, 28, 0, 0)); // back plate
  D.add('dark', zTube(zb + 0.12, zb, 0.12, 0.12, 14, 0, 0)); // hub into the mount
  D.add('camo', rbox(0.14, 0.42, 0.24, 0.03, r * 0.72, -0.05, 0.06)); // electronics box on the right
  D.add('dark', rod(V(r * 0.72, 0.18, 0.06), V(0.05, r + 0.03, -0.12), 0.012, 4));
  D.add('dark', rod(V(r * 0.7, 0.2, 0.04), V(0.1, r + 0.02, -0.16), 0.01, 4));
}

// ---------------------------------------------------------------- search radar

// The search antenna in its raised attitude (fold space: origin on the hinge, -Z to the front): a
// lattice arm up from the hinge, the feed box with the perforated face and a mesh cage on top, and
// behind it the wide reflector, curved so its tips sweep back (when folded they hang down as an
// arch), pressed with the X-shaped dimples of photos 01, 05 and 09.
// The reflector (photos 09, 07, 03, 04): two wings either side of the feed block, curved in plan
// (concave to the front, the tips swept back) and pressed from thick sheet: a flat rim, a rib along
// the middle and one X of ribs per wing, leaving six rounded pockets on each wing (a pair at the
// tip, the X's upper and lower triangles, a pair next to the block). The pockets are real
// depressions: front and back faces follow one depth field, so the back shows their bulges.
const REF = { w: 1.0, h: 0.315, sag: 0.45, z: -0.02, y: 0.42, t: 0.02, block: 0.2, depth: 0.075 }; // half width, half height, tip sweep, shell half thickness
// the outline: a rounded rectangle per wing (corner radius 0.08 m at the tips)
const halfH = (u) => { const a = Math.abs(u) * REF.w, e = Math.max(0, a - (REF.w - 0.08)) / 0.08; return REF.h - 0.08 * (1 - Math.sqrt(Math.max(0, 1 - e * e))); };
const refAt = (u, v, off = 0) => { // u, v in [-1, 1]; off along the normal toward the front
  const x = u * REF.w, z = REF.z + REF.sag * u * u;
  const nx = 2 * REF.sag * u / REF.w, nl = Math.hypot(nx, 1);
  return V(x + (nx / nl) * off, REF.y + v * halfH(u), z - off / nl);
};
// distance from (a, y) (metres along the wing from the centre, height from the mid line) to segment pq
const segDist = (a, y, p, q) => {
  const dx = q[0] - p[0], dy = q[1] - p[1], t = Math.max(0, Math.min(1, ((a - p[0]) * dx + (y - p[1]) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(a - p[0] - dx * t, y - p[1] - dy * t);
};
const sstep = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
// pocket depth at (u, v): 0 on the rim and ribs, REF.depth inside a pocket, with sloped rounded walls
function pocketDepth(u, v) {
  const a = Math.abs(u) * REF.w, hh = halfH(u), y = v * hh;
  if (a < REF.block - 0.02) return 0; // behind the feed block
  const ac = REF.block + 0.5 * (REF.w - REF.block), dx = 0.16, top = REF.h - 0.04;
  let d = Math.abs(y); // the middle rib
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) d = Math.min(d, segDist(a, y, [ac, 0], [ac + sx * dx, sy * top])); // the X
  const edge = Math.min(hh - Math.abs(y), REF.w - a, a - (REF.block - 0.02)) - 0.045; // the rim
  d = Math.min(d, edge);
  return REF.depth * sstep(0.04, 0.085, d);
}
function reflector(S) {
  const nu = 60, nv = 16, row = nv + 1;
  const grid = (off) => { // front (off > 0) or back face, an indexed grid following the pockets
    const pos = [], idx = [];
    for (let i = 0; i <= nu; i++) for (let j = 0; j <= nv; j++) {
      const u = -1 + (2 * i) / nu, v = -1 + (2 * j) / nv;
      const p = refAt(u, v, off - pocketDepth(u, v));
      pos.push(p.x, p.y, p.z);
    }
    for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
      const k = i * row + j;
      if (off > 0) idx.push(k, k + 1, k + row + 1, k, k + row + 1, k + row); // facing -Z (front)
      else idx.push(k, k + row + 1, k + 1, k, k + row, k + row + 1);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  };
  // the face: lighter and dustier than the body (photo 09), split by depth into the rim and ribs, the
  // pocket walls and the pocket floors, each a shade darker (the viewer has no ambient occlusion)
  {
    const g = grid(REF.t), P3 = g.attributes.position, N3 = g.attributes.normal, ix = g.index.array;
    const dep = [];
    for (let i = 0; i <= nu; i++) for (let j = 0; j <= nv; j++) dep.push(pocketDepth(-1 + (2 * i) / nu, -1 + (2 * j) / nv) / REF.depth);
    const bins = [[[], []], [[], []], [[], []]];
    for (let t = 0; t < ix.length; t += 3) {
      const m = (dep[ix[t]] + dep[ix[t + 1]] + dep[ix[t + 2]]) / 3, b = m < 0.3 ? 0 : m < 0.85 ? 1 : 2;
      for (let k = 0; k < 3; k++) { const v = ix[t + k]; bins[b][0].push(P3.getX(v), P3.getY(v), P3.getZ(v)); bins[b][1].push(N3.getX(v), N3.getY(v), N3.getZ(v)); }
    }
    [0xd8d8d8, 0xb4b4b4, 0x9c9c9c].forEach((tint, b) => {
      const bg = new THREE.BufferGeometry();
      bg.setAttribute('position', new THREE.Float32BufferAttribute(bins[b][0], 3));
      bg.setAttribute('normal', new THREE.Float32BufferAttribute(bins[b][1], 3));
      S.add('camo', bg, { tint });
    });
  }
  S.add('camo', grid(-REF.t), { tint: 0xa0a0a0 });
  // the edges: top and bottom strips, the tips (quads listed clockwise seen from outside)
  const pos = [];
  const quad = (a, b, c, d) => pos.push(a, c, b, a, d, c);
  for (let i = 0; i < nu; i++) {
    const u0 = -1 + (2 * i) / nu, u1 = -1 + (2 * (i + 1)) / nu;
    quad(refAt(u0, 1, REF.t), refAt(u1, 1, REF.t), refAt(u1, 1, -REF.t), refAt(u0, 1, -REF.t));
    quad(refAt(u0, -1, -REF.t), refAt(u1, -1, -REF.t), refAt(u1, -1, REF.t), refAt(u0, -1, REF.t));
  }
  for (let j = 0; j < nv; j++) {
    const v0 = -1 + (2 * j) / nv, v1 = -1 + (2 * (j + 1)) / nv;
    quad(refAt(-1, v0, REF.t), refAt(-1, v1, REF.t), refAt(-1, v1, -REF.t), refAt(-1, v0, -REF.t));
    quad(refAt(1, v0, REF.t), refAt(1, v0, -REF.t), refAt(1, v1, -REF.t), refAt(1, v1, REF.t));
  }
  const g = new THREE.BufferGeometry().setFromPoints(pos);
  g.computeVertexNormals();
  S.add('camo', g, { tint: 0xa0a0a0 });
}

function searchAntenna(S, F) {
  // turntable on the rear box and the yoke carrying the fold hinge (they spin with the pivot)
  S.add('dark', yTube(-0.02, 0.05, 0.28, 0.26, 20, 0, 0));
  S.add('camo', rbox(0.4, SR.hy, 0.36, 0.03, 0, SR.hy / 2 + 0.03, SR.hinge - 0.16));
  for (const e of [-1, 1]) S.add('camo', box(0.04, 0.12, 0.16, e * 0.16, SR.hy, SR.hinge - 0.04));
  S.add('dark', xTube(-0.22, 0.22, 0.04, 0.04, 10, SR.hy, SR.hinge));
  // fold space (origin on the hinge, -Z to the front when raised): the mount box on the hinge, the
  // feed block on it with its perforated face standing proud of the wings, a hood and a grab rail on
  // top, a small side box (photo 09); the reflector's wings join the block's sides
  F.add('camo', rbox(0.56, 0.22, 0.32, 0.03, 0, 0.06, -0.1)); // mount box
  F.add('dark', box(0.04, 0.14, 0.2, 0.29, 0.06, -0.1)); // its finned side
  F.add('camo', rbox(0.42, 0.54, 0.26, 0.025, 0, 0.45, -0.12)); // feed block
  // the perforated face: a plate with rows of holes (photo 09)
  F.add('camo', box(0.32, 0.42, 0.01, 0.02, 0.47, -0.254), { tint: 0xd0d0d0 });
  for (let i = 0; i < 6; i++) for (let j = 0; j < 10; j++) {
    F.add('dark', new THREE.CircleGeometry(0.011, 6).rotateY(Math.PI).translate(-0.095 + i * 0.044 + (j % 2) * 0.012, 0.29 + j * 0.039, -0.264));
  }
  F.add('camo', rbox(0.12, 0.18, 0.08, 0.02, -0.16, 0.32, -0.27)); // small box on the face's lower left
  F.add('camo', box(0.05, 0.3, 0.03, 0.18, 0.5, -0.262)); // plate strip on the right
  // hood: a wedge over the block, the grab rail on it
  const hood = [[-0.13, 0.74], [-0.13, 0.82], [0.05, 0.84], [0.05, 0.74]];
  F.add('camo', sideProfile(hood.map(([z, y]) => [z - 0.05, y]), 0.36));
  for (const e of [-1, 1]) F.add('steel', rod(V(e * 0.14, 0.84, -0.1), V(e * 0.14, 0.9, -0.1), 0.01, 4), { tint: 0x777777 });
  F.add('steel', rod(V(-0.14, 0.9, -0.1), V(0.14, 0.9, -0.1), 0.01, 4), { tint: 0x777777 });
  // brackets from the block's back to the wings' backs
  for (const e of [-1, 1]) for (const v of [-0.6, 0.6]) F.add('dark', rod(V(e * 0.15, REF.y + v * REF.h, 0.0), refAt(e * 0.32, v, -REF.t - REF.depth), 0.014, 5));
  reflector(F);
}

// ---------------------------------------------------------------- missile

// 9M311: a bicalibre round, 2.56 m: the 76 mm dart (ogive nose, four control fins behind it, four
// fixed fins at its tail) on a 152 mm booster with four folding fins at the tail, shown open.
// Front -Z, origin at the centre. Returns a Group with the dart's meshes and the booster as a child
// Group (userData.booster); userData.plume / userData.dartPlume are the booster's nozzle and the
// dart's tail.
export function build9M311() {
  const mats = vehicleMats('green');
  const root = new THREE.Group();
  root.name = '9M311';
  const D = new Parts(mats), B = new Parts(mats);
  const OL = 0x8a9a62, DK = 0x5f6a48; // olive #5c6e3c over the canister material's own olive
  const zj = 0.32; // dart / booster joint
  // dart: ogive nose and body
  const prof = [[0.001, zj + 0.0001], [0.038, zj]];
  for (let i = 1; i <= 8; i++) { const k = i / 8; prof.push([0.038 * Math.sqrt(1 - k * k) + 0.001, -1.04 - 0.24 * k]); } // ogive, 0.24 long
  prof.sort((a, b) => b[1] - a[1]);
  D.add('canister', lathe(prof.map(([r, z]) => [r, -z]), 14).rotateX(-Math.PI / 2), { tint: OL });
  D.add('white', lathe(prof.filter(([, z]) => z < -1.0).map(([r, z]) => [r + 0.0015, -z]), 14).rotateX(-Math.PI / 2), { tint: 0xf0f0ea }); // white nose cone (photo 10)
  const fin = (P, pts, t, tint, n = 4, roll = Math.PI / 4) => {
    const one = sideProfile(pts, t);
    for (let i = 0; i < n; i++) P.add('canister', one.clone().rotateZ(roll + (i * Math.PI * 2) / n), { tint });
  };
  fin(D, [[-0.98, 0.036], [-0.86, 0.036], [-0.88, 0.085], [-0.95, 0.085]], 0.006, DK); // control fins
  fin(D, [[0.05, 0.036], [0.3, 0.036], [0.3, 0.1], [0.18, 0.1]], 0.008, DK); // fixed fins
  D.build(root);
  // booster: adapter cone, body, tail with the folding fins open, nozzle
  const booster = new THREE.Group();
  booster.name = 'booster';
  root.add(booster);
  B.add('canister', zTube(zj, zj + 0.1, 0.04, 0.076, 16), { tint: OL });
  B.add('canister', zTube(zj + 0.1, 1.24, 0.076, 0.076, 18), { tint: OL });
  B.add('canister', zTube(1.24, 1.28, 0.076, 0.06, 16), { tint: DK });
  B.add('dark', zTube(1.28, 1.3, 0.045, 0.045, 12));
  for (const z of [0.6, 1.0]) B.add('canister', zTube(z - 0.01, z + 0.01, 0.078, 0.078, 18), { tint: DK });
  fin(B, [[0.98, 0.075], [1.26, 0.075], [1.28, 0.24], [1.14, 0.24]], 0.008, DK, 4, 0);
  B.build(booster);
  root.userData = { booster, length: 2.56, plume: V(0, 0, 1.3), dartPlume: V(0, 0, zj) };
  return root;
}

// ---------------------------------------------------------------- vehicle

export function buildTunguska() {
  const rig = newRig('green');
  rig.mats = tunguskaMats();
  rig.P = new Parts(rig.mats);
  const { P, root, mats } = rig;
  buildChassis(P);
  greyer(P.build(root, { dirt: 0.55 }));

  // turret
  const tur = pivotAt(rig, root, 'turret', 0, TY, TZ);
  const T = new Parts(mats);
  turretBody(T);
  for (const s of [-1, 1]) sideArmour(T, s);
  greyer(T.build(tur, { dirt: 0.2, y0: TY }));

  // guns on the trunnion line behind the turret's middle
  const el = pivotAt(rig, tur, 'elevation', 0, EL.y, EL.z);
  const E = new Parts(mats);
  const mz = [...gun(E, -1), ...gun(E, 1)];
  greyer(E.build(el, { dirt: 0, y0: TY + EL.y }));
  mz.forEach((p, i) => rig.anchors.muzzles.push(node(el, 'muzzle' + i, p.x, p.y, p.z)));

  // launchers, both sides on one axis
  const la = pivotAt(rig, tur, 'launcher', 0, LA.y, LA.z);
  const L = new Parts(mats), spans = [];
  for (const s of [-1, 1]) launcherBlock(L, s, spans);
  const block = greyer(L.build(la, { dirt: 0, y0: TY + LA.y }));
  // setContainer(i, false) takes the whole container of slot i off its launcher (the reload scene swaps it)
  rig.setContainer = swapper(block, spans).set;
  // container covers in one merged mesh; a slot is emptied by collapsing its cover into the bore
  const C = new Parts(mats);
  const slots = [];
  for (const [c, rw] of ORDER) for (const s of [-1, 1]) slots.push([s * CONT.cols[c], CONT.rows[rw]]);
  for (const [x, y] of slots) C.add('canister', containerCover(x, y), { tint: 0x7a7c70 });
  slots.forEach(([x, y], i) => rig.anchors.missileSlots.push(node(la, 'slot' + i, x, y, CONT.z0 - 0.05)));
  const [capMesh] = C.build(la, { dirt: 0, y0: TY + LA.y });
  const pos = capMesh.geometry.attributes.position, per = pos.count / slots.length, orig = pos.array.slice();
  rig.slots = slots.map(() => []);
  // the cover a round breaks through on its way out (main: fx.coverBurst at the slot's mouth)
  rig.cover = { size: 2 * (CONT.r + 0.006), paint: 0x6e7064 };
  rig.setLoaded = (i, loaded) => {
    if (!(i >= 0 && i < slots.length)) return;
    const a = pos.array, [x, y] = slots[i];
    for (let v = i * per; v < (i + 1) * per; v++) {
      a[v * 3] = loaded ? orig[v * 3] : x;
      a[v * 3 + 1] = loaded ? orig[v * 3 + 1] : y;
      a[v * 3 + 2] = loaded ? orig[v * 3 + 2] : CONT.z0 + 0.15;
    }
    pos.needsUpdate = true;
  };

  // tracking radar on its mount at the turret front
  const M = new Parts(mats);
  M.add('camo', rbox(0.36, 0.5, 0.22, 0.04, DISH.x, DISH.y, DISH.z + 0.12)); // mount housing on the body front
  M.add('dark', xTube(DISH.x - 0.2, DISH.x + 0.2, 0.05, 0.05, 10, DISH.y, DISH.z));
  M.add('dark', rod(V(0.4, 0.95, -0.8), V(DISH.x + 0.1, DISH.y + 0.28, DISH.z + 0.05), 0.02, 5)); // cable loom
  greyer(M.build(tur, { dirt: 0.1, y0: TY }));
  const tr = pivotAt(rig, tur, 'trackRadar', DISH.x, DISH.y, DISH.z);
  const DD = new Parts(mats);
  trackDish(DD);
  greyer(DD.build(tr, { dirt: 0, y0: TY + DISH.y }));

  // search radar: turntable on the rear box, the antenna on its fold hinge
  const sr = pivotAt(rig, tur, 'searchRadar', 0, SR.y, SR.z);
  const fold = new THREE.Group();
  fold.name = 'fold';
  fold.position.set(0, SR.hy, SR.hinge);
  sr.add(fold);
  const S = new Parts(mats), F = new Parts(mats);
  searchAntenna(S, F);
  greyer(S.build(sr, { dirt: 0, y0: TY + SR.y }));
  greyer(F.build(fold, { dirt: 0, y0: TY + SR.y }));
  rig.setDeploy = (v) => {
    rig.deploy = Math.min(1, Math.max(0, v));
    fold.rotation.x = FOLD * (1 - rig.deploy);
  };
  rig.setDeploy(1);

  // sight: just ahead of the sight head's window (turret space); eye over the ring
  rig.anchors.sight = node(tur, 'sight', 0.2, 1.12, -0.42);
  rig.anchors.eye = node(root, 'eye', 0, 2.5, TZ + 0.3);
  hb(rig, -GM352.W - 0.18, 0.1, GM352.front, GM352.W + 0.18, GM352.roof, GM352.rear);
  hb(rig, -1.4, TY, TZ - 1.4, 1.4, TY + 1.1, TZ + 2.45);
  return rig;
}
