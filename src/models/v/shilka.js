import * as THREE from 'three';
import { toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { V, DEG, box, yTube, zTube, xTube, rod, lathe, xf, Parts, camoTextures, surfaceFinish } from '../kit.js';
import { whip } from '../trucks.js';
import { newRig, node, pivotAt, hb } from '../rig.js';
import { GM, rb, addHull, addRunningGear } from './gm575.js';

// ZSU-23-4M4 Shilka-M4 on the GM-575 chassis (./gm575.js). The low, wide, long turret: two cheeks
// either side of the gun well with flat riveted inner faces and a bulbous rounded mass over the outer
// front of each (it ends a little behind the cheek face); behind them the sides are flat slabs, a set-in
// lower side, a lip and a flat upper flank rolling into the roof (the sticker panel in m4_02, m4_03),
// and the rear section is set in further; in the well the AZP-23 Amur cradle (four water-cooled 2A7
// 23 mm guns, the two upper ones inboard, the two lower ones outboard: water jackets, thin barrels,
// flash hiders, hinged muzzle caps, spacing yokes on a centre post) under a cover plate hinged on the
// roof that the cradle pushes up as it elevates; the round cupola with its periscope sight on the left,
// the big crew hatch behind the well, a domed hatch on the right; at the rear the radar: a shallow
// round reflector drum on the front of its trapezoidal transceiver housing, on two short legs that
// fold back for travel; on the M4 two Igla packs (two 9P39 tubes each, seeker caps forward) on frames
// at the rear corners, boxes on the turret rear and two whips.
// Measured from refs/shilka with cameras solved from known points (road wheel hubs, tow eyes, track
// feet) in m4_02, m4_03, m4_04 and the turret pose fitted to the muzzles: ring 0.1 m behind mid-hull,
// turret about 3.6 m from the cheek noses to the rear face, the gun trunnion about 1.05 m ahead of the
// ring, gun pair spacings 0.33 m (lower) and 0.23 m (upper), the dish about 1 m across with its top at
// 3.6 m (m4_04; the published height with the radar raised is 3.57 m).
//
// Rig, model space front -Z, right +X, ground y = 0 (all angles radians, three's conventions):
//   pivots.turret        on the ring at (0, 1.55, -0.1). rotation.y = traverse relative to the hull,
//                        + turns the guns to the left; 0 = guns over the bow. Full circle.
//   pivots.elevation     the cradle trunnion, turret space (0, 0.43, -1.05). rotation.x = gun elevation,
//                        + raises the muzzles (the -Z end); real limits -4 deg (-0.07) to +85 deg (1.48).
//                        The well's cover plate follows it (1.25 times the elevation, up to 83 deg).
//   pivots.trackRadar    the radar turntable at the rear of the roof, turret space (0, 0.72, 1.62).
//                        rotation.y = dish azimuth relative to the turret, + turns the dish to the left,
//                        0 = facing over the guns; full circle. The game's one radar both searches and
//                        tracks with it: spin it for search, point it (with trackRadarNod) to track.
//                        Leave it at 0 in travel (setDeploy(0)), where the stand lies folded back.
//   pivots.trackRadarNod the dish's elevation axis between the tops of the stand's legs (inside the
//                        fold). rotation.x = dish elevation, + tilts the face up; about -0.1 to +1.3
//                        (-6 to +75 deg) when deployed. setDeploy does not touch it; keep it at 0 in travel.
//   setDeploy(v)         v = 0 travel, 1 in action (smoothstepped). It turns two internal groups:
//                        `fold` about the hinge at the foot of the stand (0.12 m above the turntable),
//                        rotation.x = 2.5 at v = 0 (stand lying back and down over the turret's rear
//                        edge) to 0 at v = 1 (upright: dish centre about 3.1 m, top 3.6 m), and `stow` at
//                        the top of the stand, rotation.x = -0.93 to 0, so in travel the dish lies face up
//                        on the turret's rear edge, its top about 2.5 m above the ground (v1_07).
//   anchors.muzzles      four Object3Ds in the cradle at the flash hider mouths, -Z along the bore:
//                        [left lower, right lower, left upper, right upper].
//   anchors.sight        the gunner's periscope sight head on the cupola (turret space), its rotation.x
//                        follows the elevation pivot, so its -Z looks along the guns.
//   anchors.eye          camera focus (0, 2.1, -0.2) on the root.
// The Igla packs are part of the turret; the game does not fire them (no missile slots).

const RING = { y: GM.deck - 0.01, z: GM.ring }; // the turret's chamfered underside leaves a dark gap over the deck (m4_02)
const RY = 0.67; // turret roof above the ring face (2.18 m above the ground; the stowed dish makes the 2.58 m)
const FRONT = -1.55, NOSE = -1.74, REAR = 1.85; // cheek faces, tips of the brows, rear face (turret z)
const BULB_END = -1.14; // where the bulbous cheeks run back into the flat sides (turret z)
const MID_END = 0.8; // where the ridged sides end and the set-in rear section begins
const WELL = 0.3; // half width of the gun well
const WELL_END = -0.36; // back wall of the gun well
const TRUN = { y: 0.43, z: -1.05 }; // cradle trunnion, turret space
const GUNS = [ // bore positions in the cradle: x, y (the lower pair outboard, the upper pair inboard)
  [-0.165, -0.14], [0.165, -0.14], [-0.115, 0.17], [0.115, 0.17], // pair spacings 0.33 and 0.23 (m4_03, m4_04)
];
const MUZZLE = -2.12; // flash hider mouths, cradle space z
const PLATE = { z: -0.66, len: 0.7, w: 0.68 }; // cover plate: hinge on the roof at its rear edge
const RADAR = { z: 1.62, y: RY + 0.05 }; // turntable, turret space
const LEG = 0.48; // stand: fold hinge to the nod axis (the leg tops)
const FOLD_TRAVEL = 2.5; // stand lying back and down over the rear edge in travel
const TILT_TRAVEL = Math.PI / 2 - FOLD_TRAVEL; // the head turned on it so the dish faces straight up
const IGLA = { y: RY + 0.5, z0: 1.2, z1: 2.9, bz: 2.05, packs: [-1.05, 1.05], dx: 0.11 }; // pack centres x, tubes either side

// ---------------------------------------------------------------- shell sweep

// A solid swept along z through cross-sections ([{ z, pts: [[x, y], ...] }], every section the same
// point count, counterclockwise seen from +z), with flat caps at both ends; smooth normals except across
// creases sharper than `crease`.
function sweepZ(sections, { crease = 35 * DEG } = {}) {
  const out = [];
  const up = sections[sections.length - 1].z > sections[0].z;
  const tri = (a, b, c) => (up ? out.push(a, b, c) : out.push(a, c, b));
  const n = sections[0].pts.length;
  const P = (s, i) => V(s.pts[i][0], s.pts[i][1], s.z);
  for (let k = 0; k < sections.length - 1; k++) {
    const A = sections[k], B = sections[k + 1];
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      tri(P(A, i), P(A, j), P(B, j));
      tri(P(A, i), P(B, j), P(B, i));
    }
  }
  // a counterclockwise contour triangulates counterclockwise (facing +z)
  const cap = (s, last) => {
    for (const [a, b, c] of THREE.ShapeUtils.triangulateShape(s.pts.map(([x, y]) => new THREE.Vector2(x, y)), [])) {
      if (last === up) out.push(P(s, a), P(s, b), P(s, c)); else out.push(P(s, a), P(s, c), P(s, b));
    }
  };
  cap(sections[0], false);
  cap(sections[sections.length - 1], true);
  return toCreasedNormals(new THREE.BufferGeometry().setFromPoints(out), crease);
}

// Half outline of the flat-sided body from the inner edge xi outward, counterclockwise seen from +z:
// a chamfered underside that leaves a dark gap over the deck, the lower side, a lip about 0.37 m up,
// the flat upper flank above it (the sticker panel in m4_02, m4_03) rolling over into the roof. `w` is
// the half width of the upper flank, `ridge` how far the lip stands out.
function flatHalf(xi, w = 1.2, ridge = 0.025) {
  return [[xi, 0.0], [w - 0.24, 0.0], [w - 0.05, 0.13], [w - 0.04, 0.35], [w + ridge, 0.37], [w, 0.4], [w - 0.005, 0.55], [w - 0.05, RY - 0.04], [w - 0.13, RY], [xi, RY]];
}
// The bulbous cheek over the outer front of each cheek (half outline, inner edge on the cheek's roof
// line): it bulges out past the flat side to a full rounded flank, its top level with the roof
// (m4_04, m4_05 head on; m4_02, m4_03 from the side: a rounded mass at the front only).
const BULB = [[0.6, 0.26], [1.1, 0.2], [1.24, 0.24], [1.33, 0.32], [1.37, 0.43], [1.36, 0.54], [1.31, 0.63], [1.22, 0.69], [1.08, RY], [0.6, RY]];
const mirrorPts = (pts) => pts.map(([x, y]) => [-x, y]).reverse();

function turretShell(T) {
  // cheeks either side of the gun well, from the flat front faces back past the well's end
  const cheek = [FRONT, -0.8, WELL_END + 0.04].map((z) => ({ z, pts: flatHalf(WELL) }));
  T.add('camo', sweepZ(cheek));
  T.add('camo', sweepZ(cheek.map((s) => ({ z: s.z, pts: mirrorPts(s.pts) }))));
  // the bulbous cheeks: domed at the nose ahead of the flat cheek face, full behind it, then drawn
  // back into the flat side by BULB_END
  const c = [1.0, 0.42], L = FRONT - NOSE + 0.02;
  const inner = BULB.map(([x, y]) => [Math.min(x, 1.12), y]);
  const E = BULB_END - NOSE;
  const stations = [[0, 0], [0.04, 0], [0.09, 0], [0.14, 0], [L, 0], [E - 0.3, 0], [E - 0.15, 0.55], [E, 1]];
  const bulb = stations.map(([d, t]) => {
    const f = d >= L ? 1 : Math.max(0.12, Math.sqrt(1 - ((L - d) / L) ** 2));
    const drop = Math.max(0, 1 - d / E) * 0.1; // the top slopes down toward the nose (m4_02)
    return { z: NOSE + d, pts: BULB.map(([x, y], i) => {
      const bx = c[0] + (x - c[0]) * f, by = c[1] + (y - c[1]) * (0.45 + 0.55 * f) - (y > 0.6 ? drop : 0);
      return [bx + (inner[i][0] - bx) * t, by + (inner[i][1] - by) * t];
    }) };
  });
  T.add('camo', sweepZ(bulb));
  T.add('camo', sweepZ(bulb.map((s) => ({ z: s.z, pts: mirrorPts(s.pts) }))));
  // the body over the full width behind the well: flat sides with the ridge, ending in a rounded
  // vertical edge at MID_END; behind it the rear section is set in a little with plain flat sides
  const full = (h) => [...mirrorPts(h).slice(0, -1), ...h.slice(1, -1)];
  const body = [[WELL_END, flatHalf(0)], [MID_END - 0.06, flatHalf(0)], [MID_END, flatHalf(0, 1.17, 0.01)], [MID_END + 0.05, flatHalf(0, 1.12, 0)], [REAR - 0.06, flatHalf(0, 1.12, 0)], [REAR, flatHalf(0, 1.06, 0)]];
  T.add('camo', sweepZ(body.map(([z, h]) => ({ z, pts: full(h) }))));
  // ring and the dark gap under the overhang
  T.add('dark', yTube(-0.04, 0.05, 0.94, 0.94, 36));
  T.add('dark', yTube(0.0, 0.035, 1.2, 1.2, 36), { tint: 0x808080 });
  // the gun well: dark inner walls, floor and back wall, the bar with the warning plate under the guns
  for (const s of [-1, 1]) T.add('dark', box(0.01, RY - 0.03, WELL_END - FRONT, s * (WELL - 0.006), RY / 2, (FRONT + WELL_END) / 2), { tint: 0x707070 });
  T.add('dark', box(WELL * 2, 0.02, WELL_END - FRONT, 0, 0.0, (FRONT + WELL_END) / 2));
  T.add('dark', box(WELL * 2, RY - 0.03, 0.02, 0, RY / 2, WELL_END - 0.005));
  T.add('camo', box(WELL * 2 - 0.02, 0.14, 0.04, 0, 0.1, FRONT + 0.03), { tint: 0xc8c8c8 });
  T.add('white', box(0.3, 0.09, 0.01, 0, 0.11, FRONT + 0.005), { tint: 0x9a9a92 });
}

const sphere = (r, x, y, z, seg = 6) => new THREE.SphereGeometry(r, seg, Math.max(3, seg >> 1)).translate(x, y, z);

// Square plate with an X pressed into it on a side face (normal +X for s = 1), centre (s * x, y, z).
function xPlate(T, s, x, y, z, w, h) {
  T.add('camo', rb(0.02, h, w, 0.015, s * x, y, z), { tint: 0xd8d8d8 });
  const a = Math.atan2(h, w);
  for (const r of [a, -a]) T.add('dark', box(0.012, 0.012, Math.hypot(w, h) - 0.06, s * (x + 0.012), y, z, r, 0, 0));
}

// Rivets, plates and handles on the shell, the roof fittings.
function turretFittings(T) {
  for (const s of [-1, 1]) {
    // rivet rows down both edges of the flat cheek faces (m4_05), a grab handle
    for (let i = 0; i < 6; i++) for (const x of [WELL + 0.05, 0.56]) T.add('dark', sphere(0.014, s * x, 0.1 + i * 0.1, FRONT - 0.004));
    T.add('dark', box(0.03, 0.2, 0.03, s * 0.47, 0.38, FRONT - 0.03));
    // X-marked access plates: on the lower cheek under the bulb at the front (m4_04) and two on the
    // flat side behind it
    xPlate(T, s, 1.175, 0.23, -0.6, 0.36, 0.15);
    T.add('camo', rb(0.3, 0.15, 0.02, 0.015, s * 0.95, 0.12, FRONT - 0.005), { tint: 0xd8d8d8 });
    for (const r of [0.45, -0.45]) T.add('dark', box(0.3, 0.012, 0.012, s * 0.95, 0.12, FRONT - 0.018, 0, 0, r));
    xPlate(T, s, 1.175, 0.23, 0.45, 0.4, 0.15);
    // a long handrail along the brow top, hooks, panel seams on the lower body
    T.add('dark', rod(V(s * 1.04, RY + 0.06, -1.2), V(s * 1.04, RY + 0.06, 0.4), 0.013, 5));
    for (const z of [-1.15, 0.35]) T.add('dark', rod(V(s * 1.04, RY - 0.01, z), V(s * 1.04, RY + 0.06, z), 0.013, 5));
    T.add('dark', box(0.01, 0.22, 0.01, s * 1.172, 0.24, 0.05));
    T.add('dark', box(0.01, 0.15, 0.01, s * 1.207, 0.47, -0.85));
    // raised roof plates over the front of the cheeks
    T.add('camo', rb(0.66, 0.03, 0.65, 0.02, s * 0.66, RY + 0.008, -1.2), { tint: 0xd4d4d4 });
    for (const z of [-1.45, 1.6]) T.add('dark', new THREE.TorusGeometry(0.04, 0.012, 5, 10).applyMatrix4(xf(s * 0.95, RY + 0.04, z)));
  }
  // the left cupola with its hatch and the periscope sight head (m4_02, m4_03, m4_05)
  const cx = -0.62, cz = 0.5;
  T.add('camo', yTube(RY - 0.02, RY + 0.17, 0.4, 0.38, 28, cx, cz));
  T.add('dark', yTube(RY + 0.17, RY + 0.19, 0.39, 0.39, 28, cx, cz));
  T.add('camo', lathe([[0.001, -0.02], [0.35, -0.02], [0.35, 0.0], [0.3, 0.035], [0.18, 0.07], [0.001, 0.08]], 24).applyMatrix4(xf(cx + 0.03, RY + 0.21, cz + 0.04)));
  T.add('dark', box(0.2, 0.04, 0.05, cx + 0.03, RY + 0.3, cz + 0.04)); // hatch handle
  for (let i = 0; i < 5; i++) { const a = -0.6 + i * 0.3; T.add('glass', box(0.1, 0.05, 0.02, cx + Math.sin(a) * 0.39, RY + 0.11, cz - Math.cos(a) * 0.39, 0, -a, 0)); }
  const sx = cx - 0.12, sz = cz - 0.36;
  T.add('camo', rb(0.22, 0.16, 0.22, 0.03, sx, RY + 0.24, sz));
  T.add('camo', rb(0.18, 0.1, 0.2, 0.03, sx, RY + 0.35, sz - 0.02));
  T.add('camo', lathe([[0.001, 0.0], [0.11, 0.0], [0.11, 0.06], [0.08, 0.11], [0.001, 0.13]], 18).applyMatrix4(xf(sx, RY + 0.39, sz - 0.02)));
  T.add('dark', new THREE.TorusGeometry(0.13, 0.012, 5, 18).applyMatrix4(xf(sx, RY + 0.45, sz - 0.02, Math.PI / 2)));
  T.add('glass', box(0.12, 0.06, 0.012, sx, RY + 0.36, sz - 0.125));
  // the big crew hatch behind the well (its lid stands up when open, m4_04/05; shown closed)
  // (the lids are on pivots, see crewHatchLid and domeHatchLid)
  const { x: hx, z: hz } = HATCH;
  T.add('camo', rb(0.86, 0.06, 0.8, 0.05, hx, RY + 0.02, hz), { tint: 0xd8d8d8 });
  T.add('dark', xTube(hx - 0.32, hx + 0.32, 0.03, 0.03, 8, RY + 0.05, hz + 0.42));
  // the domed hatch over the right cheek's rear (m4_03, m4_05)
  T.add('camo', rb(0.7, 0.06, 0.62, 0.05, DOME.x, RY + 0.02, DOME.z), { tint: 0xd8d8d8 });
  T.add('dark', xTube(0.62, 1.14, 0.025, 0.025, 8, RY + 0.06, DOME.hinge));
  // vent, a small dome and lifting eyes on the roof
  T.add('camo', yTube(RY, RY + 0.06, 0.12, 0.1, 14, 0.75, 0.75));
  T.add('dark', yTube(RY + 0.06, RY + 0.07, 0.1, 0.1, 14, 0.75, 0.75));
  T.add('camo', yTube(RY, RY + 0.1, 0.07, 0.05, 10, -0.2, 1.1));
}

// The two roof hatch lids, each in its own pivot on the hinge at its rear edge (rotation.x + lifts the
// front edge: the lid stands up at about 1.75): the big crew hatch behind the well, and the domed hatch
// over the right cheek, the reload scene's way in for the ammunition (render/reload/shilka.js).
const HATCH = { x: 0.28, z: 0.08, y: RY + 0.05 };
const DOME = { x: 0.88, z: -0.5, y: RY + 0.06, hinge: -0.19 };
function crewHatchLid(Q) {
  const ox = HATCH.x, oy = HATCH.y, oz = HATCH.z + 0.42; // the hinge line
  Q.add('camo', rb(0.78, 0.04, 0.72, 0.04, HATCH.x - ox, RY + 0.055 - oy, HATCH.z - oz));
  for (const dx of [-0.22, 0.22]) Q.add('dark', rod(V(dx, RY + 0.08 - oy, HATCH.z - 0.12 - oz), V(dx, RY + 0.08 - oy, HATCH.z - 0.3 - oz), 0.012, 5));
  Q.add('glass', box(0.12, 0.05, 0.02, 0.25, RY + 0.12 - oy, HATCH.z - 0.35 - oz));
  Q.add('dark', rb(0.16, 0.08, 0.1, 0.02, 0.25, RY + 0.12 - oy, HATCH.z - 0.29 - oz));
}
function domeHatchLid(Q) {
  Q.add('camo', lathe([[0.001, 0.0], [0.3, 0.0], [0.28, 0.04], [0.18, 0.08], [0.001, 0.09]], 20).applyMatrix4(xf(0, RY + 0.05 - DOME.y, DOME.z - DOME.hinge, 0, 0, 0, V(1.08, 1, 0.95))));
}
// for the reload scene: turret-space places of the two hatches (their centres on the roof) and the roof
export const SHILKA = { ring: { y: GM.deck - 0.01, z: GM.ring }, roof: RY, hatch: { x: HATCH.x, z: HATCH.z }, dome: { x: DOME.x, z: DOME.z, hinge: DOME.hinge }, rear: REAR };

// ---------------------------------------------------------------- guns

// Four 2A7 guns on the cradle (elevation space, origin on the trunnion, bores along -Z): receivers in
// the well, water jackets with their bands over the rear of the barrels, thin barrels, flash hiders, a
// muzzle cap hinged open beside each muzzle, two spacing yokes on a centre post, the cradle body and
// the feed chutes. Returns the muzzle points.
function guns(E) {
  const out = [];
  for (const [x, y] of GUNS) {
    E.add('dark', rb(0.12, 0.17, 0.8, 0.02, x, y, 0.0)); // receiver
    E.add('camo', zTube(-0.34, -0.42, 0.075, 0.075, 14, x, y), { tint: 0x9a9a9a }); // jacket collar
    E.add('dark', zTube(-0.42, -1.14, 0.062, 0.058, 14, x, y)); // water jacket
    for (const z of [-0.6, -0.88, -1.1]) E.add('dark', zTube(z + 0.02, z - 0.02, 0.069, 0.069, 14, x, y)); // bands
    E.add('dark', zTube(-1.14, -1.22, 0.05, 0.032, 12, x, y));
    E.add('dark', zTube(-1.22, MUZZLE + 0.36, 0.031, 0.029, 10, x, y)); // barrel
    // flash hider: a long tube much fatter than the barrel, flaring a little at the open mouth
    // (guns_14), a collar behind it, the bore's floor seen down the mouth
    E.add('dark', zTube(MUZZLE + 0.4, MUZZLE + 0.34, 0.04, 0.04, 12, x, y));
    E.add('dark', zTube(MUZZLE + 0.34, MUZZLE + 0.3, 0.042, 0.05, 14, x, y));
    E.add('dark', zTube(MUZZLE + 0.3, MUZZLE + 0.06, 0.05, 0.053, 14, x, y, true));
    E.add('dark', zTube(MUZZLE + 0.06, MUZZLE, 0.053, 0.06, 14, x, y, true));
    E.add('dark', zTube(MUZZLE + 0.25, MUZZLE + 0.24, 0.045, 0.045, 10, x, y));
    // muzzle cap hinged open, hanging beside the flash hider (outboard on the lower guns, under the upper
    // ones), on its clamp
    const lower = y < 0, sx = x < 0 ? -1 : 1;
    const cx = lower ? x + sx * 0.11 : x, cy = lower ? y : y - 0.11;
    E.add('dark', zTube(MUZZLE + 0.3, MUZZLE + 0.24, 0.056, 0.056, 12, x, y));
    E.add('dark', box(lower ? 0.07 : 0.02, lower ? 0.02 : 0.07, 0.03, (x + cx) / 2, (y + cy) / 2, MUZZLE + 0.27));
    E.add('camo', lathe([[0.001, 0.0], [0.065, 0.0], [0.065, 0.014], [0.054, 0.034], [0.001, 0.036]], 14).applyMatrix4(xf(cx, cy, MUZZLE + 0.2, 0, 0, lower ? -sx * Math.PI / 2 : Math.PI)), { tint: 0x9a9a9a });
    out.push(V(x, y, MUZZLE));
  }
  // spacing yokes: the lower one ties the outer (lower) pair to the centre post, the upper one the inner
  // pair, with lightening holes and hubs; the post runs back to the cradle front between the guns
  for (const [y, z, hx] of [[-0.14, -1.3, 0.165], [0.17, -1.66, 0.115]]) {
    E.add('camo', rb(hx * 2 + 0.11, 0.075, 0.07, 0.02, 0, y, z), { tint: 0x9a9a9a });
    for (const s of [-1, 1]) E.add('camo', zTube(z + 0.055, z - 0.055, 0.045, 0.045, 12, s * hx, y), { tint: 0x9a9a9a });
    for (const s of [-1, 1]) E.add('dark', zTube(z - 0.036, z - 0.04, 0.025, 0.025, 10, s * hx * 0.45, y));
  }
  E.add('camo', rod(V(0, -0.19, -0.4), V(0, -0.14, -1.3), 0.026, 8), { tint: 0x9a9a9a });
  E.add('camo', rod(V(0, -0.14, -1.3), V(0, 0.17, -1.66), 0.022, 8), { tint: 0x9a9a9a });
  // the cradle: a box between the cheeks behind the jackets' roots, trunnion shaft, feed chutes
  E.add('dark', rb(0.52, 0.42, 0.65, 0.03, 0, -0.02, 0.0));
  E.add('camo', rb(0.5, 0.12, 0.1, 0.02, 0, -0.19, -0.34), { tint: 0xb0b0b0 });
  E.add('dark', xTube(-WELL + 0.005, WELL - 0.005, 0.07, 0.07, 14, 0, 0));
  for (const s of [-1, 1]) {
    E.add('dark', rod(V(s * 0.26, -0.05, -0.15), V(s * 0.27, -0.3, 0.15), 0.035, 6));
    E.add('dark', rod(V(s * 0.21, 0.22, -0.2), V(s * 0.25, 0.08, 0.25), 0.03, 6));
  }
  return out;
}

// The well's cover plate (plate space: origin on its hinge at the rear edge, the plate lying forward
// along -Z), with stiffener ribs underneath and a lip at its front edge.
function coverPlate(C) {
  const { len, w } = PLATE;
  C.add('camo', rb(w, 0.035, len, 0.012, 0, -0.005, -len / 2), { tint: 0xd8d8d8 });
  for (const x of [-0.27, 0.27]) C.add('camo', box(0.03, 0.05, len - 0.08, x, -0.045, -len / 2));
  C.add('camo', box(w, 0.06, 0.03, 0, -0.03, -len + 0.015));
  C.add('dark', xTube(-w / 2 + 0.05, w / 2 - 0.05, 0.025, 0.025, 8, -0.01, 0.0)); // hinge
}

// ---------------------------------------------------------------- radar

// The turntable on the roof's rear edge (turntable space): a domed base with the two knuckles of the
// stand and the foot of the raising ram.
function radarBase(R) {
  R.add('camo', lathe([[0.001, 0.0], [0.3, 0.0], [0.28, 0.03], [0.24, 0.08], [0.15, 0.12], [0.001, 0.13]], 24));
  R.add('dark', yTube(-0.05, 0.0, 0.3, 0.3, 24));
  for (const s of [-1, 1]) R.add('camo', box(0.08, 0.12, 0.16, s * 0.13, 0.12, 0.0));
  R.add('dark', xTube(-0.2, 0.2, 0.035, 0.035, 8, 0.12, 0.0));
  R.add('camo', rb(0.2, 0.12, 0.18, 0.03, 0.0, 0.08, 0.2));
}

// The stand (fold space, origin on the hinge): the two legs splaying out from the knuckles to the yoke
// bearings at the housing's sides (rear_11), a cross bar, the raising ram.
function radarStand(F) {
  for (const s of [-1, 1]) {
    F.add('camo', rod(V(s * 0.13, 0, 0), V(s * 0.38, LEG, -0.04), 0.035, 8));
    F.add('camo', sphere(0.06, s * 0.13, 0.0, 0.0, 10));
    F.add('dark', xTube(s * 0.33, s * 0.43, 0.05, 0.05, 10, LEG, -0.04));
  }
  F.add('camo', rod(V(-0.2, 0.24, -0.02), V(0.2, 0.24, -0.02), 0.022, 6));
  F.add('dark', rod(V(0, 0.0, 0.18), V(0.06, LEG - 0.12, 0.02), 0.03, 6));
  F.add('steel', rod(V(0.03, 0.2, 0.13), V(0.06, LEG - 0.12, 0.02), 0.018, 6));
}

// The antenna (nod space, origin on the elevation axis between the leg tops): the trapezoidal
// transceiver housing sitting above the axis, wide at its front and tapering back (m4_02: about 0.8 m
// across and 0.6 m tall, its lower corners on the leg tops), the shallow round reflector drum on its
// front facing -Z under a flat domed cover (about 1 m across, 0.3 m deep), the ribs round the drum,
// the waveguide, the M4's sensor box on the right, the bearing caps.
const DISH = { y: 0.22, R: 0.5, zf: -0.5, zb: -0.2 };
function radarHead(D) {
  const ring = (z, w, h, dy) => [V(-w, dy - h, z), V(w, dy - h, z), V(w, dy + h, z), V(-w, dy + h, z)];
  D.add('camo', loftBox([ring(-0.22, 0.4, 0.3, 0.2), ring(0.2, 0.27, 0.2, 0.17)]));
  D.add('camo', rb(0.36, 0.22, 0.05, 0.02, 0, 0.16, 0.22), { tint: 0xc8c8c8 }); // access cover on the back
  D.add('dark', box(0.18, 0.03, 0.02, 0, 0.16, 0.255));
  for (const s of [-1, 1]) D.add('camo', xTube(s * 0.36, s * 0.42, 0.07, 0.07, 12, 0, 0)); // bearing caps on the leg tops
  const { y, R, zf, zb } = DISH;
  D.add('camo', lathe([[R, 0.0], [R + 0.012, 0.02], [R + 0.012, 0.05], [R - 0.004, 0.065], [R - 0.03, zb - zf - 0.06], [R - 0.1, zb - zf], [0.22, zb - zf + 0.03], [0.001, zb - zf + 0.04]], 36).applyMatrix4(xf(0, y, zf, Math.PI / 2, 0, 0)));
  D.add('paint', lathe([[0.001, -0.01], [R - 0.005, -0.01], [R - 0.005, 0.0], [R - 0.04, 0.025], [0.25, 0.05], [0.001, 0.06]], 36).applyMatrix4(xf(0, y, zf, -Math.PI / 2, 0, 0)), { tint: 0xc8ccc0 }); // the cover, painted like the rest (m4_04)
  D.add('dark', new THREE.TorusGeometry(R + 0.006, 0.015, 6, 36).translate(0, y, zf + 0.012));
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    D.add('camo', box(0.02, 0.025, 0.18, Math.cos(a) * (R + 0.006), y + Math.sin(a) * (R + 0.006), zf + 0.12, 0, 0, a + Math.PI / 2), { tint: 0xc0c0c0 });
  }
  D.add('dark', rod(V(0.14, 0.48, -0.2), V(0.2, 0.42, 0.1), 0.022, 6));
  D.add('dark', rod(V(0.2, 0.42, 0.1), V(0.18, 0.2, 0.22), 0.022, 6));
  D.add('camo', rb(0.15, 0.28, 0.28, 0.03, 0.47, 0.2, -0.05));
  D.add('glass', box(0.09, 0.07, 0.01, 0.47, 0.25, -0.195));
}

// convex box-like loft between two quads (housing shapes)
function loftBox([A, B]) {
  const out = [];
  const c = new THREE.Vector3();
  for (const p of [...A, ...B]) c.add(p);
  c.divideScalar(8);
  const e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), m = new THREE.Vector3();
  const tri = (a, b, d) => {
    e1.subVectors(b, a); e2.subVectors(d, a); e1.cross(e2);
    m.copy(a).add(b).add(d).divideScalar(3).sub(c);
    if (e1.dot(m) < 0) out.push(a, d, b); else out.push(a, b, d);
  };
  for (let i = 0; i < 4; i++) { const j = (i + 1) % 4; tri(A[i], A[j], B[j]); tri(A[i], B[j], B[i]); }
  tri(A[0], A[1], A[2]); tri(A[0], A[2], A[3]); tri(B[0], B[1], B[2]); tri(B[0], B[2], B[3]);
  const g = new THREE.BufferGeometry().setFromPoints(out);
  g.computeVertexNormals();
  return g;
}

// ---------------------------------------------------------------- Igla packs (M4)

// One pack at a rear corner of the roof (turret space, centred on x = xm): the launch module box under
// the tubes on a rail, two 9P39 tubes side by side with their seeker caps forward (red rings on the
// noses, m4_04), light grey grip stocks and clamps, black tail caps; the box stands on two posts and a
// brace, the outer pack's frame reaching down the turret's flank (m4_02).
function iglaPack(T, xm) {
  const s = Math.sign(xm), y = IGLA.y, z0 = IGLA.z0, z1 = IGLA.z1;
  for (const x of [xm - IGLA.dx, xm + IGLA.dx]) {
    T.add('canister', zTube(z0 + 0.12, z1 - 0.06, 0.042, 0.042, 14, x, y));
    T.add('canister', lathe([[0.001, 0.0], [0.035, 0.005], [0.056, 0.03], [0.06, 0.07], [0.052, 0.13], [0.045, 0.14]], 14).applyMatrix4(xf(x, y, z0, Math.PI / 2, 0, 0)));
    T.add('red', zTube(z0 + 0.005, z0, 0.03, 0.03, 12, x, y));
    T.add('dark', zTube(z1 - 0.08, z1, 0.05, 0.052, 14, x, y, true));
    for (const z of [z0 + 0.32, (z0 + z1) / 2 + 0.1, z1 - 0.25]) T.add('white', zTube(z + 0.025, z - 0.025, 0.05, 0.05, 14, x, y), { tint: 0xb8bab4 });
    T.add('white', box(0.05, 0.1, 0.32, x, y - 0.09, z0 + 0.5), { tint: 0xb0b2aa });
    T.add('white', box(0.045, 0.12, 0.05, x, y - 0.15, z0 + 0.62, 0.3), { tint: 0xb0b2aa });
    T.add('white', zTube(z0 + 0.25, z0 + 0.4, 0.03, 0.03, 10, x, y - 0.065), { tint: 0xb0b2aa });
  }
  const bz = IGLA.bz, by = y - 0.2;
  T.add('paint', rb(0.44, 0.2, 0.5, 0.025, xm, by, bz));
  T.add('paint', rb(0.36, 0.06, 0.66, 0.015, xm, y - 0.07, bz));
  T.add('dark', xTube(xm - 0.23, xm + 0.23, 0.03, 0.03, 8, y - 0.12, bz - 0.15));
  T.add('dark', rod(V(xm - s * 0.22, by, bz + 0.1), V(xm - s * 0.4, RY + 0.02, bz - 0.4), 0.012, 4)); // cable
  // the frame: a post from the box's inner edge to the roof, a trapezoid of square tube from its outer
  // edge down the flat flank of the rear section to a bracket with a junction box (m4_02)
  const xo = s * 1.16, zf = bz - 0.3, zr = Math.min(bz + 0.2, REAR - 0.04);
  T.add('paint', rod(V(xm - s * 0.12, by - 0.1, bz - 0.1), V(xm - s * 0.12, RY, bz - 0.25), 0.022, 6));
  T.add('paint', box(0.3, 0.05, 0.05, xm + s * 0.15, by - 0.11, zf + 0.1));
  for (const z of [zf, zr]) T.add('paint', box(0.05, by - 0.1 - 0.25, 0.05, xo, (by - 0.1 + 0.25) / 2, z));
  T.add('paint', box(0.05, 0.05, zr - zf, xo, 0.27, (zf + zr) / 2));
  T.add('paint', rod(V(xo, 0.27, zf), V(xo, by - 0.1, zr), 0.018, 4));
  T.add('paint', box(0.05, 0.05, zr - zf + 0.05, xo, by - 0.12, (zf + zr) / 2));
  T.add('paint', box(Math.abs(xo - xm) + 0.05, 0.05, 0.05, (xo + xm) / 2 + s * 0.02, by - 0.12, zr));
  T.add('paint', rb(0.08, 0.2, 0.18, 0.02, s * 1.17, 0.36, zf - 0.15));
  T.add('white', box(0.005, 0.07, 0.025, s * 1.212, 0.38, zf - 0.15), { tint: 0xcfcfc8 }); // its stencilled "1"
}

// ---------------------------------------------------------------- build

// The shared 'green' scheme leans yellow and its dust settles thick on every top surface; the
// Shilka-M4s in the photos are clean, in a darker, cooler green (m4_01 to m4_05). So the painted parts
// use their own pair of materials (the same camouflage maps, little dust, a darker dust colour) and
// take a cooler vertex tint.
let ownMats = null;
function shilkaMats(base) {
  if (ownMats) return ownMats;
  const tex = camoTextures('green');
  const mk = (color, key) => {
    const m = new THREE.MeshStandardMaterial({ color, roughness: 1, metalness: 0, vertexColors: true, map: tex.map, roughnessMap: tex.rough, normalMap: tex.normal });
    m.normalScale.set(0.7, 0.7);
    return surfaceFinish(m, 'veh-shilka-' + key, { mud: 0.7, dust: 0.18, dustColor: 0x77755f });
  };
  // the M4's black rubber skirt has a satin sheen that picks up the sky (m4_02, m4_03)
  const skirt = new THREE.MeshStandardMaterial({ color: 0x2a2d33, roughness: 0.62, metalness: 0, vertexColors: true, roughnessMap: base.rubber.roughnessMap, normalMap: base.rubber.normalMap });
  skirt.normalScale.set(0.4, 0.4);
  // road wheels, sprockets and idlers in a grey-green, dusty (m4_02, m4_03)
  const rim = new THREE.MeshStandardMaterial({ color: 0x5e675f, roughness: 0.78, metalness: 0.15, vertexColors: true, roughnessMap: base.rim.roughnessMap, normalMap: base.rim.normalMap });
  rim.normalScale.set(0.6, 0.6);
  ownMats = { ...base, camo: mk(0xffffff, 'camo'), paint: mk(0x5a6644, 'paint'), skirt: surfaceFinish(skirt, 'veh-shilka-skirt', { mud: 0.35, dust: 0.1, dustColor: 0x77755f }),
    rim: surfaceFinish(rim, 'veh-shilka-rim', { mud: 0.6, mudTop: 0.9, dust: 0.3, dustColor: 0x8a8670 }) };
  return ownMats;
}
function cooler(meshes) {
  for (const m of meshes) if (m.name === 'camo' || m.name === 'paint') {
    const c = m.geometry.attributes.color;
    for (let i = 0; i < c.count; i++) c.setXYZ(i, c.getX(i) * 0.8, c.getY(i) * 0.86, c.getZ(i) * 1.5);
  }
}

export function buildShilka() {
  const rig = newRig('green');
  rig.mats = shilkaMats(rig.mats);
  rig.P = new Parts(rig.mats);
  const { P, root, mats } = rig;
  const K = new Parts({ ...mats, rubber: mats.skirt }); // the black rubber skirt and mudguards, built clear of the mud line
  addHull(P, { m4: true, skirt: K });
  addRunningGear(P);
  cooler(P.build(root, { dirt: 0.55 }));
  K.build(root, { y0: 0.5 });

  // ---- turret
  const tur = pivotAt(rig, root, 'turret', 0, RING.y, RING.z);
  const T = new Parts(mats);
  turretShell(T);
  turretFittings(T);
  for (const x of IGLA.packs) iglaPack(T, x);
  // flat rear flanks: two riveted access panels each (museum_12)
  for (const s of [-1, 1]) for (const [z, w] of [[1.25, 0.32], [1.6, 0.3]]) {
    T.add('camo', rb(0.02, 0.2, w, 0.015, s * 1.09, 0.25, z), { tint: 0xd8d8d8 });
    for (const dz of [-w / 2 + 0.03, w / 2 - 0.03]) for (const dy of [-0.09, 0.09]) T.add('dark', sphere(0.012, s * 1.102, 0.25 + dy, z + dz));
  }
  // boxes on the turret rear (M4): a louvred one on the left, a plain one on the right
  T.add('paint', rb(0.46, 0.34, 0.28, 0.03, -0.68, 0.27, REAR + 0.13));
  for (let i = 0; i < 4; i++) T.add('dark', box(0.28, 0.015, 0.01, -0.68, 0.19 + i * 0.05, REAR + 0.275));
  T.add('paint', rb(0.4, 0.3, 0.26, 0.03, 0.68, 0.3, REAR + 0.12));
  // rear face: the two big ammunition doors (rear_11), hinges, latches
  for (const s of [-1, 1]) {
    T.add('camo', rb(0.6, 0.4, 0.03, 0.05, s * 0.72, 0.36, REAR + 0.005), { tint: 0xd4d4d4 });
    for (const y of [0.22, 0.5]) T.add('dark', box(0.08, 0.06, 0.05, s * 1.03, y, REAR + 0.02));
    T.add('dark', box(0.12, 0.03, 0.04, s * 0.46, 0.36, REAR + 0.03));
  }
  // whips on mounts at the roof's rear corners, just ahead of and outboard of the Igla tubes
  for (const x of [-0.93, 0.93]) {
    T.add('dark', yTube(RY - 0.02, RY + 0.1, 0.06, 0.05, 10, x, 1.12));
    T.add('dark', yTube(RY + 0.1, RY + 0.3, 0.025, 0.02, 8, x, 1.12));
    whip(T, x, RY + 0.3, 1.12, 2.6, 0.01);
  }
  cooler(T.build(tur, { dirt: 0.25, y0: RING.y }));

  // ---- guns on the elevating cradle
  const el = pivotAt(rig, tur, 'elevation', 0, TRUN.y, TRUN.z);
  const E = new Parts(mats);
  const muzzles = guns(E);
  cooler(E.build(el, { dirt: 0, y0: RING.y + TRUN.y }));
  muzzles.forEach((p, i) => rig.anchors.muzzles.push(node(el, 'muzzle' + i, p.x, p.y, p.z)));

  // ---- the well's cover plate, pushed up by the cradle
  const plate = new THREE.Group();
  plate.name = 'coverPlate';
  plate.position.set(0, RY + 0.02, PLATE.z);
  tur.add(plate);
  plate.updateMatrix = function () {
    this.rotation.x = Math.min(1.45, Math.max(-0.05, el.rotation.x * 1.25));
    THREE.Object3D.prototype.updateMatrix.call(this);
  };
  const C = new Parts(mats);
  coverPlate(C);
  cooler(C.build(plate, { y0: RING.y + RY }));

  // ---- radar: turntable (yaw), fold (deploy), nod
  const tr = pivotAt(rig, tur, 'trackRadar', 0, RADAR.y, RADAR.z);
  const R = new Parts(mats);
  radarBase(R);
  cooler(R.build(tr, { y0: RING.y + RADAR.y }));
  const fold = new THREE.Group();
  fold.name = 'fold';
  fold.position.set(0, 0.12, 0);
  tr.add(fold);
  const F = new Parts(mats);
  radarStand(F);
  cooler(F.build(fold, { y0: RING.y + RADAR.y }));
  const stow = new THREE.Group(); // turns the head on the folded stand (setDeploy); nod is inside it
  stow.name = 'stow';
  stow.position.set(0, LEG, -0.04);
  fold.add(stow);
  const nod = pivotAt(rig, stow, 'trackRadarNod', 0, 0, 0);
  const D = new Parts(mats);
  radarHead(D);
  cooler(D.build(nod, { y0: RING.y + RADAR.y + LEG }));

  rig.setDeploy = (v) => {
    const t = Math.min(1, Math.max(0, v)), k = t * t * (3 - 2 * t);
    fold.rotation.x = FOLD_TRAVEL * (1 - k);
    stow.rotation.x = TILT_TRAVEL * (1 - k);
  };
  rig.setDeploy(1);

  // ---- the roof hatch lids (closed at 0; the reload scene opens them)
  const hp = pivotAt(rig, tur, 'hatch', HATCH.x, HATCH.y, HATCH.z + 0.42);
  const HQ = new Parts(mats);
  crewHatchLid(HQ);
  cooler(HQ.build(hp, { y0: RING.y + HATCH.y }));
  const dp = pivotAt(rig, tur, 'ammoHatch', DOME.x, DOME.y, DOME.hinge);
  const DQ = new Parts(mats);
  domeHatchLid(DQ);
  cooler(DQ.build(dp, { y0: RING.y + DOME.y }));

  // ---- anchors
  const sight = node(tur, 'sight', -0.74, RY + 0.36, 0.12);
  sight.updateMatrix = function () {
    this.rotation.x = el.rotation.x;
    THREE.Object3D.prototype.updateMatrix.call(this);
  };
  rig.anchors.sight = sight;
  rig.anchors.eye = node(root, 'eye', 0, 2.1, -0.2);

  hb(rig, -GM.W, 0.3, GM.front, GM.W, GM.deck, GM.rear);
  hb(rig, -1.37, RING.y, RING.z + NOSE, 1.37, RING.y + RY + 0.2, RING.z + REAR + 0.3);
  hb(rig, -1.25, RING.y + RY, RING.z + IGLA.z0, 1.25, RING.y + IGLA.y + 0.07, RING.z + IGLA.z1);
  return rig;
}
