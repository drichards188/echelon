import * as THREE from 'three';
import { toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { V, box, rbox, yTube, zTube, xTube, rod, lathe, loft, xf, Parts, camoTextures, surfaceFinish } from '../kit.js';
import { whip } from '../trucks.js';
import { newRig, node, pivotAt, hb } from '../rig.js';
import { L1, buildChassis } from './leopard1.js';

// Flakpanzer Gepard 1A2 on the Leopard 1 hull (./leopard1.js), as delivered to Ukraine. The tall
// boxy welded turret: flat vertical sides, chamfered roof edges, the front-top edge cut back; on its
// front the tracking radar on a round pedestal (the head with the radome forward and an elevation
// drum either side, its azimuth fixed to the turret); on each side, outside the wall, an angular
// armoured gun mount with a 35 mm Oerlikon KDA (90 calibres, 3.15 m barrel, a jacket at the root,
// the muzzle brake with the v0 measuring ring), both on one trunnion axis at the turret's middle;
// under the barrels a quad bank of 76 mm smoke dischargers on a shelf; on the roof the two periscopic
// sights (the commander's raised), two hatches, a stowage box, the beacon and two whips; at the rear
// the MPDR 12 search antenna, a doubly curved reflector with its feed on a gooseneck, on a turntable
// at the top of a short swing arm that folds it back over the engine deck for travel; stowage boxes
// on the rear face. Measured from refs/gepard: gepard_spaag_cc0 (left side, travel: the road wheel
// spacing as the ruler) and gepard_1a2_side (left side, in action) for the stations, heights and the
// gun mount; gepard_1a2_overview, gepard_heer and gepard_munster_2026 (three-quarter views) for the
// turret's width, the gun mounts and the tracking radar; gepard_firing (rear) for the antenna; the
// published 3.71 m width over the gun mounts and 3.29 m height with the antenna folded.
//
// Rig, model space front -Z, right +X, ground y = 0 (all angles radians, three's conventions):
//   pivots.turret        on the ring at (0, 1.62, -0.1). rotation.y = traverse relative to the hull,
//                        + turns the guns to the left; 0 = guns over the bow. Full circle.
//   pivots.elevation     the guns' common trunnion axis, turret space (0, 0.74, -0.05). rotation.x = gun
//                        elevation, + raises the muzzles (the -Z end); real limits about -10 deg (-0.17)
//                        to +85 deg (1.48). Both gun mounts with their barrels are on it (bores at
//                        x = -/+1.42, muzzles 3.98 m ahead of the axis, level with it: 7.68 m overall
//                        with the guns forward).
//   pivots.trackRadar    the tracking radar head's elevation axis, turret space (0, 0.73, -1.75).
//                        rotation.x = elevation, + tilts the radome up (-0.17 to 1.48); its azimuth
//                        is the turret's.
//   pivots.searchRadar   the search antenna's turntable at the top of the swing arm. rotation.y spins
//                        the antenna relative to the turret, 0 = the reflector facing forward, + to the
//                        left; any angle. Keep it at 0 in travel.
//   setDeploy(v)         v = 0 travel, 1 in action (smoothstepped). It turns two internal groups: `fold`
//                        about the arm's hinge at the rear of the roof, turret space (0, 1.36, 1.42),
//                        rotation.x = pi/2 at v = 0 (the arm lying back, the reflector flat behind the
//                        turret over the engine deck, face down, its top about 3.1 m above the ground)
//                        to 0 at v = 1 (upright: the turntable at 3.16 m, the reflector's top 4.1 m), and
//                        `stow` under the turntable, rotation.y = pi at v = 0 (the antenna turned to face
//                        the rear before it lies down, as in gepard_spaag_cc0) to 0 at v = 1; the arm
//                        rises over the first three quarters, the antenna turns round over the last half.
//   anchors.muzzles      two Object3Ds on the elevation pivot at the muzzle brake mouths, -Z along the
//                        bore: [left gun, right gun].
//   anchors.sight        the gunner's periscopic sight head on the roof (turret space), its rotation.x
//                        follows the elevation pivot, so its -Z looks along the guns.
//   anchors.eye          camera focus (0, 2.3, 0) on the root.
// No missile slots.

const RING = { y: L1.ringY, z: L1.ring };
const RY = 1.24; // turret roof above the ring face (2.86 m above the ground)
const BOT = 0.06; // the body's underside: it clears the raised engine deck as it traverses (the basket below)
const HW = 1.15; // half width of the turret body
const FRONT = -1.45, REAR = 1.5; // front and rear faces (turret z)
const TRUN = { y: 0.74, z: -0.05 }; // gun trunnions
const GX = 1.42; // bores either side of the turret (elevation space)
const MUZZLE = -3.98; // muzzle brake mouths (elevation space z): 4.13 m ahead of the ring, 7.68 m overall guns forward
const TR = { y: 0.73, z: -1.75 }; // tracking radar elevation axis
const SR = { y: RY + 0.12, z: 1.42, arm: 0.18 }; // search antenna: the fold hinge, the arm to the turntable
const SIGHT = { x: 0.45, z: -0.85 }; // the gunner's sight (right); the commander's at -x

// ---------------------------------------------------------------- turret body

// Hexagonal section of the body at z: flat sides, chamfered roof edges (c), top at `top`
const section = (z, top, c = 0.12, hw = HW, bot = BOT) => [V(-hw, bot, z), V(hw, bot, z), V(hw, top - c, z), V(hw - c, top, z), V(-(hw - c), top, z), V(-hw, top - c, z)];

function turretBody(T) {
  // the body from the cut-back front-top edge to the rear face, its rear-top edge chamfered too
  T.add('camo', loft([section(FRONT, RY - 0.24, 0.12), section(FRONT + 0.26, RY), section(REAR - 0.08, RY), section(REAR, RY - 0.08, 0.1)], { crease: 0.5 }));
  // the basket under the body down to the ring, the dark gap over the hull
  T.add('dark', yTube(-0.06, BOT + 0.02, 1.1, 1.1, 40));
  T.add('dark', box(HW * 2 - 0.04, 0.02, REAR - FRONT - 0.04, 0, BOT - 0.005, (FRONT + REAR) / 2), { tint: 0x707070 });
  // seams: the front plate's top edge, the side plates' welds
  T.add('dark', box(HW * 2 - 0.1, 0.015, 0.015, 0, RY - 0.24, FRONT - 0.002));
  for (const s of [-1, 1]) {
    T.add('dark', box(0.012, RY - 0.25 - BOT, 0.015, s * (HW + 0.002), (RY - 0.12 + BOT) / 2, FRONT + 0.03));
    T.add('dark', box(0.012, RY - 0.2 - BOT, 0.015, s * (HW + 0.002), (RY - 0.12 + BOT) / 2, 0.02));
  }
}

// Things on the turret's sides: the gun trunnion bearings, the round covers on the rear section, the
// smoke discharger banks under the barrels, grab rails, the antenna and fittings
function turretSides(T) {
  for (const s of [-1, 1]) {
    // trunnion bearing boss on the wall (the mount's half turns with the guns)
    T.add('camo', xTube(s * (HW - 0.02), s * (HW + 0.06), 0.22, 0.2, 18, TRUN.y, TRUN.z), { tint: 0xd0d0d0 });
    // round bolted cover on the rear section above the gun mount (gepard_1a2_side, _turret_rear)
    T.add('camo', xTube(s * HW, s * (HW + 0.03), 0.17, 0.17, 18, 1.03, 1.12), { tint: 0xd8d8d8 });
    for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; T.add('dark', xTube(s * (HW + 0.03), s * (HW + 0.045), 0.015, 0.015, 6, 1.03 + Math.cos(a) * 0.13, 1.12 + Math.sin(a) * 0.13)); }
    // smoke dischargers: a shelf plate on brackets, four 76 mm tubes tilted forward, up and out, capped
    const sx = s * (HW + 0.15);
    T.add('camo', box(0.3, 0.035, 0.66, sx, 0.16, -1.0), { tint: 0xd0d0d0 });
    for (const z of [-1.3, -0.7]) T.add('camo', box(0.26, 0.1, 0.04, s * (HW + 0.13), 0.12, z));
    const dir = V(s * 0.3, 0.72, -0.62).normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), dir);
    [-1.22, -1.06, -0.9, -0.74].forEach((z, i) => {
      const base = V(sx + s * 0.02 * i, 0.19, z);
      T.add('dark', rbox(0.11, 0.1, 0.13, 0.02, base.x, base.y + 0.02, base.z));
      const tube = new THREE.CylinderGeometry(0.048, 0.048, 0.22, 12).translate(0, 0.11, 0).applyQuaternion(q).translate(base.x, base.y + 0.05, base.z);
      T.add('dark', tube);
      const cap = new THREE.CylinderGeometry(0.056, 0.056, 0.06, 12).translate(0, 0.24, 0).applyQuaternion(q).translate(base.x, base.y + 0.05, base.z);
      T.add('paint', cap, { tint: 0x9a9a9a });
    });
    // grab rail at the front of the side (the emblem goes behind it, markings.js)
    T.add('dark', rod(V(s * (HW + 0.05), RY - 0.3, -1.36), V(s * (HW + 0.05), RY - 0.3, -1.04), 0.014, 5));
    for (const z of [-1.36, -1.04]) T.add('dark', rod(V(s * HW, RY - 0.3, z), V(s * (HW + 0.05), RY - 0.3, z), 0.014, 5));
  }
}

// The roof: the two sights on their rings (the commander's left, raised), the hatches behind them,
// the stowage box, the beacon, lifting eyes
function roof(T) {
  for (const s of [-1, 1]) {
    const x = s * SIGHT.x, z = SIGHT.z;
    T.add('camo', yTube(RY - 0.02, RY + 0.06, 0.27, 0.27, 24, x, z), { tint: 0xc8c8c8 });
    T.add('dark', yTube(RY + 0.06, RY + 0.08, 0.25, 0.25, 24, x, z));
    T.add('camo', rbox(0.36, 0.26, 0.36, 0.04, x, RY + 0.2, z), { tint: 0xd0d0d0 });
    T.add('camo', box(0.4, 0.04, 0.22, x, RY + 0.32, z - 0.15, -0.35), { tint: 0xc0c0c0 }); // armoured hood
    T.add('glass', box(0.24, 0.1, 0.012, x, RY + 0.2, z - 0.185));
    if (s < 0) { // the commander's sight stands on a post (gepard_munster_2026, gepard_heer)
      T.add('dark', yTube(RY + 0.31, RY + 0.34, 0.07, 0.07, 10, x, z + 0.05));
      T.add('camo', rbox(0.24, 0.11, 0.26, 0.03, x, RY + 0.385, z + 0.03), { tint: 0xc8c8c8 });
      T.add('glass', box(0.16, 0.06, 0.01, x, RY + 0.385, z - 0.105));
    }
    // hatch behind each sight
    const hz = -0.2;
    T.add('camo', rbox(0.62, 0.05, 0.56, 0.05, s * 0.5, RY + 0.015, hz), { tint: 0xd4d4d4 });
    T.add('dark', box(0.5, 0.03, 0.03, s * 0.5, RY + 0.045, hz + 0.29)); // hinge
    T.add('dark', rod(V(s * 0.38, RY + 0.06, hz - 0.1), V(s * 0.62, RY + 0.06, hz - 0.1), 0.012, 5));
    // lifting eyes at the roof corners
    for (const z of [-1.0, 1.2]) {
      T.add('dark', new THREE.TorusGeometry(0.045, 0.014, 5, 10, Math.PI).applyMatrix4(xf(s * (HW - 0.18), RY, z, 0, Math.PI / 2, 0)));
    }
  }
  // stowage box on the roof's left rear (gepard_1a2_side), the amber beacon on the right
  T.add('camo', rbox(0.46, 0.3, 0.9, 0.03, -0.78, RY + 0.15, 0.55), { tint: 0xd8d8d8 });
  for (const dz of [-0.2, 0.2]) T.add('dark', box(0.03, 0.1, 0.08, -0.78 - 0.235, RY + 0.17, 0.55 + dz));
  T.add('dark', yTube(RY, RY + 0.06, 0.07, 0.07, 10, 0.85, 0.35));
  T.add('amber', lathe([[0.001, 0.0], [0.065, 0.0], [0.065, 0.1], [0.04, 0.15], [0.001, 0.16]], 12).applyMatrix4(xf(0.85, RY + 0.06, 0.35)));
  // whips at the rear corners
  for (const x of [-0.95, 0.95]) whip(T, x, RY, 1.25, 2.4, 0.01);
  // a vent and a small dome on the roof's middle
  T.add('camo', yTube(RY, RY + 0.08, 0.1, 0.09, 12, 0.1, 0.3));
  T.add('dark', yTube(RY + 0.08, RY + 0.09, 0.09, 0.09, 12, 0.1, 0.3));
}

// The rear: two stowage boxes on the rear face (low enough for the folded feed to clear them) and
// the search antenna's base, a cylinder over the rear edge with the hinge cheeks on top
function rear(T) {
  for (const s of [-1, 1]) {
    T.add('camo', rbox(0.9, 0.38, 0.3, 0.03, s * 0.54, 0.39, REAR + 0.15), { tint: 0xd8d8d8 });
    T.add('dark', box(0.8, 0.012, 0.02, s * 0.54, 0.52, REAR + 0.3));
    T.add('dark', box(0.12, 0.06, 0.03, s * 0.54, 0.44, REAR + 0.31));
    T.add('camo', xTube(s * 0.98, s * 1.0, 0.07, 0.07, 12, 0.39, REAR + 0.15)); // the round socket on its end
  }
  T.add('camo', yTube(RY - 0.32, RY + 0.06, 0.26, 0.26, 24, 0, SR.z - 0.2), { tint: 0xd0d0d0 });
  T.add('dark', yTube(RY + 0.06, RY + 0.07, 0.24, 0.24, 24, 0, SR.z - 0.2));
  for (const s of [-1, 1]) T.add('camo', box(0.06, 0.16, 0.2, s * 0.13, SR.y - 0.03, SR.z - 0.04));
  T.add('dark', xTube(-0.17, 0.17, 0.03, 0.03, 8, SR.y, SR.z));
}

// ---------------------------------------------------------------- tracking radar

// The pedestal on the turret front (turret space): a broad round foot with a lip merging into the
// front plate, a column under the head tied back to the plate (gepard_1a2_overview, ua_gepard_01)
function pedestal(T) {
  T.add('camo', lathe([[0.001, BOT], [0.39, BOT], [0.41, BOT + 0.04], [0.4, 0.24], [0.36, 0.27], [0.33, 0.28], [0.33, 0.35], [0.3, 0.38], [0.001, 0.385]], 32).applyMatrix4(xf(0, 0, TR.z)));
  T.add('dark', yTube(0.265, 0.28, 0.375, 0.375, 32, 0, TR.z));
  T.add('camo', box(0.44, 0.22, 0.3, 0, 0.27, TR.z + 0.2));
  T.add('dark', rbox(0.16, 0.1, 0.1, 0.02, -0.34, BOT + 0.08, TR.z - 0.32)); // a small lamp box low on the front
}

// The head (trackRadar space, origin on the elevation axis, the radome facing -Z): the body with
// cooling ribs on top (gepard_1a2_front_laser), the radome on its ring at the front, the elevation
// drums either side, the laser rangefinder's box on the left drum
function trackHead(H) {
  H.add('camo', rbox(0.42, 0.42, 0.42, 0.04, 0, 0.0, 0.06), { tint: 0xc8c8c8 });
  for (let i = 0; i < 5; i++) H.add('camo', box(0.36, 0.028, 0.03, 0, 0.222, -0.1 + i * 0.075), { tint: 0xc0c0c0 });
  // the antenna ring and the radome, a shallow dome
  H.add('dark', zTube(-0.14, -0.19, 0.3, 0.3, 32));
  H.add('paint', lathe([[0.29, 0.0], [0.295, 0.015], [0.275, 0.05], [0.23, 0.09], [0.15, 0.12], [0.07, 0.133], [0.001, 0.138]], 32).applyMatrix4(xf(0, 0, -0.19, -Math.PI / 2, 0, 0)));
  for (const s of [-1, 1]) {
    H.add('camo', xTube(s * 0.2, s * 0.42, 0.24, 0.24, 24, -0.02, 0.06), { tint: 0xc8c8c8 });
    H.add('camo', xTube(s * 0.42, s * 0.45, 0.235, 0.2, 24, -0.02, 0.06), { tint: 0xc0c0c0 });
    for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; H.add('dark', xTube(s * 0.45, s * 0.462, 0.013, 0.013, 6, -0.02 + Math.cos(a) * 0.14, 0.06 + Math.sin(a) * 0.14)); }
  }
  H.add('dark', rbox(0.1, 0.11, 0.26, 0.02, -0.31, 0.27, 0.04));
  H.add('glass', zTube(-0.09, -0.095, 0.032, 0.032, 10, -0.31, 0.27));
}

// ---------------------------------------------------------------- guns

// One gun on the elevation pivot (elevation space; s = -1 left, +1 right; the bore along -Z at
// x = s * GX on the axis): the angular armoured mount (a hexagonal box, tapered to the barrel at the
// front and under the rear) with its top cover and side door, the barrel with its jacket and the
// muzzle brake with the v0 ring. Returns the muzzle point.
function gun(E, s) {
  const X = s * GX;
  const hex = (z, [xi, xo, yb, yt, c]) => [[xi, yb], [xo - c, yb], [xo, yb + c], [xo, yt - c], [xo - c, yt], [xi, yt]].map(([x, y]) => V(X + s * x, y, z));
  const rings = [
    hex(-0.88, [-0.1, 0.13, -0.12, 0.1, 0.03]),
    hex(-0.5, [-0.18, 0.42, -0.46, 0.15, 0.12]),
    hex(0.48, [-0.18, 0.42, -0.46, 0.15, 0.12]),
    hex(0.72, [-0.18, 0.4, -0.25, 0.13, 0.1]),
  ];
  E.add('camo', loft(rings, { crease: 0.5 }));
  // the trunnion's half on the mount's inner face
  E.add('camo', xTube(X - s * 0.17, X - s * 0.22, 0.16, 0.16, 16, 0, 0), { tint: 0xc8c8c8 });
  // the top cover with its hinges and clamp (gepard_1a2_gun_left), the side door, bolt rows
  E.add('camo', rbox(0.3, 0.06, 0.62, 0.02, X + s * 0.1, 0.17, 0.05), { tint: 0xc8c8c8 });
  for (const z of [-0.18, 0.28]) E.add('dark', box(0.1, 0.04, 0.06, X + s * 0.1, 0.21, z));
  E.add('camo', rbox(0.02, 0.24, 0.5, 0.02, X + s * 0.425, -0.16, 0.18), { tint: 0xd0d0d0 });
  E.add('dark', box(0.03, 0.12, 0.04, X + s * 0.44, -0.16, -0.03));
  for (let i = 0; i < 6; i++) E.add('dark', xTube(X + s * 0.42, X + s * 0.435, 0.012, 0.012, 5, 0.02, -0.4 + i * 0.17));
  // barrel: a thick jacket at the root, tapering, the long thin tube, the muzzle brake and the v0 ring
  E.add('dark', zTube(-0.86, -1.42, 0.075, 0.07, 14, X, 0));
  E.add('dark', zTube(-1.42, -1.58, 0.07, 0.052, 14, X, 0));
  E.add('dark', zTube(-1.58, -3.58, 0.05, 0.043, 12, X, 0));
  E.add('dark', zTube(-0.9, -1.9, 0.018, 0.018, 6, X - s * 0.07, -0.06)); // the cable run under the barrel
  E.add('dark', zTube(-3.58, -3.62, 0.06, 0.06, 14, X, 0));
  E.add('dark', zTube(-3.62, -3.98, 0.066, 0.066, 16, X, 0, true));
  E.add('dark', zTube(-3.98, MUZZLE, 0.072, 0.072, 16, X, 0, true));
  for (const z of [-3.7, -3.82, -3.94]) E.add('dark', zTube(z + 0.015, z - 0.015, 0.075, 0.075, 16, X, 0));
  for (let i = 0; i < 4; i++) { const a = (i / 4) * Math.PI * 2 + Math.PI / 4; E.add('dark', box(0.02, 0.02, 0.34, X + Math.cos(a) * 0.075, Math.sin(a) * 0.075, -3.8)); }
  E.add('dark', zTube(-3.64, -3.7, 0.1, 0.1, 18, X, 0)); // v0 measuring ring
  E.add('dark', box(0.03, 0.06, 0.05, X, -0.11, -3.67));
  return V(X, 0, MUZZLE);
}

// ---------------------------------------------------------------- search antenna

// The reflector (antenna space: the turntable's top at the origin, facing -Z): a rounded-rectangle
// shell curved both ways, deepest a little below the middle, the top rolled forward like a hood
// (gepard_1a2_side) and the side edges brought forward. Creased normals keep the rim sharp.
const REF = { hw: 0.72, y0: 0.08, y1: 0.94, t: 0.035, r: 0.24 };
const refZ = (x, y) => {
  const f = (y - REF.y0) / (REF.y1 - REF.y0);
  return 0.1 - 0.42 * (f - 0.4) ** 2 - (f > 0.7 ? 1.2 * (f - 0.7) ** 2 : 0) - 0.18 * (x / REF.hw) ** 2;
};
function reflectorGeometry(nu = 16, nv = 12) {
  const { hw, y0, y1, t, r } = REF;
  const halfAt = (y) => { // the outline's half width at height y (rounded corners)
    const d = Math.min(y - y0, y1 - y);
    if (d >= r) return hw;
    return hw - r + Math.sqrt(Math.max(0, r * r - (r - d) * (r - d)));
  };
  const F = [], Bk = [];
  for (let j = 0; j <= nv; j++) {
    const y = y0 + ((y1 - y0) * j) / nv, h = halfAt(y), rowF = [], rowB = [];
    for (let i = 0; i <= nu; i++) {
      const x = -h + (2 * h * i) / nu, z = refZ(x, y);
      rowF.push(V(x, y, z));
      rowB.push(V(x, y, z + t));
    }
    F.push(rowF);
    Bk.push(rowB);
  }
  const out = [];
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
    const [a, b, c, d] = [F[j][i], F[j][i + 1], F[j + 1][i + 1], F[j + 1][i]];
    out.push(a, d, b, b, d, c); // front faces -Z
    const [e, f, g, k] = [Bk[j][i], Bk[j][i + 1], Bk[j + 1][i + 1], Bk[j + 1][i]];
    out.push(e, f, k, f, g, k); // back faces +Z
  }
  // rim: quads between the front and back outlines, oriented away from the middle
  const ctr = V(0, (y0 + y1) / 2, 0);
  const e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), m = new THREE.Vector3();
  const quad = (a, b, c, d) => {
    for (const [p, q, w] of [[a, b, c], [a, c, d]]) {
      e1.subVectors(q, p); e2.subVectors(w, p); e1.cross(e2);
      m.copy(p).add(q).add(w).divideScalar(3).sub(ctr);
      m.z = 0;
      if (e1.dot(m) < 0) out.push(p, w, q); else out.push(p, q, w);
    }
  };
  for (let i = 0; i < nu; i++) {
    quad(F[0][i], F[0][i + 1], Bk[0][i + 1], Bk[0][i]);
    quad(F[nv][i], F[nv][i + 1], Bk[nv][i + 1], Bk[nv][i]);
  }
  for (let j = 0; j < nv; j++) {
    quad(F[j][0], F[j + 1][0], Bk[j + 1][0], Bk[j][0]);
    quad(F[j][nu], F[j + 1][nu], Bk[j + 1][nu], Bk[j][nu]);
  }
  return toCreasedNormals(new THREE.BufferGeometry().setFromPoints(out), 0.7);
}

// The swing arm (fold space, origin on the hinge): the knuckle between the cheeks and the column up to
// the turntable
function arm(F) {
  F.add('camo', xTube(-0.1, 0.1, 0.07, 0.07, 14, 0, 0));
  F.add('camo', yTube(0.0, SR.arm - 0.05, 0.13, 0.15, 18, 0, 0.0), { tint: 0xd0d0d0 });
  F.add('dark', yTube(SR.arm - 0.05, SR.arm - 0.04, 0.15, 0.15, 18));
}

// The antenna on its turntable (searchRadar space): the turntable, the bracket and struts to the
// reflector's back, the reflector with ribs behind it, the feed horn box on its gooseneck in front
// at about a third of the height, the small IFF post on top
function antenna(A) {
  A.add('camo', yTube(-0.04, 0.04, 0.19, 0.19, 20), { tint: 0xc8c8c8 });
  A.add('dark', yTube(0.04, 0.05, 0.16, 0.16, 20));
  A.add('camo', rbox(0.3, 0.16, 0.16, 0.02, 0, 0.11, 0.08), { tint: 0xc8c8c8 });
  for (const s of [-1, 1]) A.add('camo', rod(V(s * 0.1, 0.06, 0.1), V(s * 0.24, 0.45, refZ(s * 0.24, 0.45) + 0.05), 0.022, 6));
  A.add('white', reflectorGeometry(), { tint: 0x4a5258 });
  // ribs across the back
  for (const y of [0.3, 0.62]) {
    const pts = [];
    for (let i = 0; i <= 8; i++) { const x = -0.62 + (1.24 * i) / 8; pts.push(V(x, y, refZ(x, y) + REF.t + 0.012)); }
    A.add('white', new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 10, 0.016, 4, false), { tint: 0x34383c });
  }
  A.add('white', rbox(0.2, 0.36, 0.06, 0.02, 0, 0.42, refZ(0, 0.42) + REF.t + 0.03), { tint: 0x34383c });
  // feed on the gooseneck
  const neck = new THREE.CatmullRomCurve3([V(0, 0.02, -0.1), V(0, 0.1, -0.24), V(0, 0.22, -0.4), V(0, 0.3, -0.5)]);
  A.add('dark', new THREE.TubeGeometry(neck, 12, 0.042, 8, false));
  A.add('camo', rbox(0.17, 0.15, 0.17, 0.02, 0, 0.36, -0.58), { tint: 0xc0c0c0 });
  A.add('dark', zTube(-0.49, -0.43, 0.06, 0.085, 4, 0, 0.36));
  A.add('dark', yTube(REF.y1 - 0.02, REF.y1 + 0.08, 0.012, 0.012, 6, 0, refZ(0, REF.y1) + 0.02));
  A.add('dark', yTube(REF.y1 + 0.08, REF.y1 + 0.11, 0.025, 0.02, 8, 0, refZ(0, REF.y1) + 0.02));
}

// ---------------------------------------------------------------- build

// The shared material set in the nato scheme, with its own painted materials: the shared khaki dust
// settles thick on every up-facing plate and turned the three-tone pastel, so less of it and greyer.
// The small parts painted plain (the radome, the discharger caps) in a flat olive, the road wheels
// in the bronze green.
let ownMats = null;
function gepardMats(base) {
  if (ownMats) return ownMats;
  const tex = camoTextures('nato');
  const camo = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0, vertexColors: true, map: tex.map, roughnessMap: tex.rough, normalMap: tex.normal });
  camo.normalScale.set(0.7, 0.7);
  const paint = new THREE.MeshStandardMaterial({ color: 0x4b5342, roughness: 0.9, metalness: 0, vertexColors: true, roughnessMap: base.dark.roughnessMap, normalMap: base.dark.normalMap });
  paint.normalScale.set(0.5, 0.5);
  const rim = new THREE.MeshStandardMaterial({ color: 0x4d5543, roughness: 0.8, metalness: 0.15, vertexColors: true, roughnessMap: base.rim.roughnessMap, normalMap: base.rim.normalMap });
  rim.normalScale.set(0.6, 0.6);
  ownMats = { ...base,
    camo: surfaceFinish(camo, 'veh-gepard-camo', { mud: 0.75, dust: 0.2, dustColor: 0x77705c }),
    paint: surfaceFinish(paint, 'veh-gepard-paint', { mud: 0.6, dust: 0.15, dustColor: 0x77705c }),
    rim: surfaceFinish(rim, 'veh-gepard-rim', { mud: 0.7, mudTop: 0.9, dust: 0.3, dustColor: 0x7a7462 }) };
  return ownMats;
}

export function buildGepard() {
  const rig = newRig('nato');
  rig.mats = gepardMats(rig.mats);
  rig.P = new Parts(rig.mats);
  const { P, root, mats } = rig;
  root.name = 'gepard';
  buildChassis(P);
  P.build(root, { dirt: 0.55 });

  // ---- turret
  const tur = pivotAt(rig, root, 'turret', 0, RING.y, RING.z);
  const T = new Parts(mats);
  turretBody(T);
  turretSides(T);
  roof(T);
  rear(T);
  pedestal(T);
  T.build(tur, { dirt: 0.25, y0: RING.y });

  // ---- guns on the common trunnion axis
  const el = pivotAt(rig, tur, 'elevation', 0, TRUN.y, TRUN.z);
  const E = new Parts(mats);
  const muzzles = [gun(E, -1), gun(E, 1)];
  E.build(el, { dirt: 0, y0: RING.y + TRUN.y });
  muzzles.forEach((p, i) => rig.anchors.muzzles.push(node(el, 'muzzle' + i, p.x, p.y, p.z)));

  // ---- tracking radar head
  const tr = pivotAt(rig, tur, 'trackRadar', 0, TR.y, TR.z);
  const H = new Parts(mats);
  trackHead(H);
  H.build(tr, { y0: RING.y + TR.y });

  // ---- search antenna: the fold (swing arm), the stow turn, the turntable
  const fold = new THREE.Group();
  fold.name = 'fold';
  fold.position.set(0, SR.y, SR.z);
  tur.add(fold);
  const F = new Parts(mats);
  arm(F);
  F.build(fold, { y0: RING.y + SR.y });
  const stow = new THREE.Group();
  stow.name = 'stow';
  stow.position.set(0, SR.arm, 0);
  fold.add(stow);
  const sr = pivotAt(rig, stow, 'searchRadar', 0, 0, 0);
  const A = new Parts(mats);
  antenna(A);
  A.build(sr, { y0: RING.y + SR.y + SR.arm });

  const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  rig.setDeploy = (v) => {
    const t = Math.min(1, Math.max(0, v));
    fold.rotation.x = (Math.PI / 2) * (1 - smooth(0, 0.75, t));
    stow.rotation.y = Math.PI * (1 - smooth(0.5, 1, t));
  };
  rig.setDeploy(1);

  // ---- anchors
  const sight = node(tur, 'sight', SIGHT.x, RY + 0.2, SIGHT.z - 0.19);
  sight.updateMatrix = function () {
    this.rotation.x = el.rotation.x;
    THREE.Object3D.prototype.updateMatrix.call(this);
  };
  rig.anchors.sight = sight;
  rig.anchors.eye = node(root, 'eye', 0, 2.3, 0);

  hb(rig, -L1.W, 0.3, -3.5, L1.W, L1.deck, 3.35);
  hb(rig, -1.85, RING.y, RING.z + TR.z - 0.5, 1.85, RING.y + RY + 0.3, RING.z + REAR + 0.3);
  return rig;
}
