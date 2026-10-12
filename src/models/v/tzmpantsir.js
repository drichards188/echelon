import * as THREE from 'three';
import { V, xf, box, yTube, zTube, xTube, rod, loft, sideProfile, mudguard, Parts } from '../kit.js';
import { newRig, node, pivotAt, hb } from '../rig.js';
import { mudFlap } from '../trucks.js';
import { rb, kamazFrame, kamazRunningGear, kamazTyre, kamazHub } from './kamaz.js';
import { spinWheels } from './t22t6.js';
import { TUBE, pantsirTube, tubeCap, greyer } from './pantsir.js';
import { mark, span, swapper } from './swap.js';

// Transport-loading vehicle (TZM) of the Pantsir-S1, after the Serbian vehicles in refs/reload (photos
// pantsir_tzm_serbia_granit2023_95, the right side from the front, and pantsir_tzm_serbia_zastava2024_01,
// the left side from the front; section 2a of the README). The only photographed TZM; the designation
// 73V6 and its load (24 57E6 containers and 2,808 30 mm rounds, two loads for a combat vehicle) are
// secondary sources. A KamAZ-6350 8x8 (badge "63501"): the KamAZ forward-control day cab of the
// Pantsir's KamAZ-6560 (kamaz.js) with three amber marker lamps on the roof and the spotlight on the
// left corner, the axles in two pairs far apart, a spare wheel standing behind the cab on the right
// and a rack with a cooling unit on the left, a flat platform with low ribbed sides under a tall
// tarpaulin tilt, and at the tail a folding crane stowed upright behind the tilt with a ladder frame
// and a tall pole beside it.
//
// RECONSTRUCTED, not seen: the crane is only partly visible in the photos (a folded column and boom
// behind the tilt); it is built here as a knuckle-boom loader crane on a slewing column with a
// telescopic outer boom, a rotator and a small spreader that takes one or two containers side by side
// at the Pantsir block's column spacing; the outriggers (a transverse beam under the tail with
// sliding legs and jacks) and the load under the tilt (two layers of six containers in saddle racks in
// the rear part of the platform) are inferred, and so is the tilt's rear part, which bunches forward
// on its bows to open the racks to the crane. Proportions are measured from the photos with the cab
// and the 1.28 m tyres as rulers. Model space: front -Z, ground y = 0, origin at the middle.
//
// Pivots and rig extras:
//   crane        rotation.y slew about the column at the tail's right corner (TZM.crane); 0 = the
//                booms reaching forward (-Z), + swings them to the left.
//   craneBoom    the main boom on the column top: rotation.x, 0 level reaching forward, + raises it.
//   craneJib     the outer boom on the main boom's tip (the knuckle): rotation.x relative to it.
//   craneExt, craneExt2  the outer boom's two telescopic stages (setCrane `ext`, split between them).
//   craneHook    the hook under the boom tip, kept level by setCrane; its child craneRotator turns
//                the spreader (rotation.y relative to the slew) and rides up with `hoist` (0 pulled up
//                for travel, 1 at its working drop).
//   anchors.craneLoad  under the spreader: a container hung there with an identity transform lies
//                level along the anchor's -Z (its mouth), its axis 0.12 m below the anchor; a pair hangs
//                at x = +-TZM.pair / 2.
//   setCrane({ slew, boom, jib, ext, rotate, hoist })  poses the crane (the hook levels itself, the rams
//                follow).
//   solveCrane(p, yaw, out = {})  the pose that puts craneLoad at p (model space) with the load's mouth
//                along model-space heading yaw (three's rotation.y convention); out.ok false when out of
//                reach (clamped).
//   craneTravel  the stowed pose: main boom upright, outer boom folded down beside it on the right,
//                the hook pulled up.
//   setOutriggers(v)  0 stowed (jacks folded along the legs), 0.5 legs out to the sides, 0.75 jacks
//                swung down, 1 on the ground (y = 0).
//   setTarp(v)   0 closed, 1 the tilt's rear part bunched forward on its bows (the racks open).
//   setWheels(roll, steer)  roll: metres travelled; steer: the first axle's angle (rad, + left), the
//                second takes 0.7 of it.
//   setLoaded(i, on)  the container in rack place i (0..11: upper layer left to right, then the lower).
//   anchors.cargo[i]  each rack place's container frame (as the Pantsir block: the axis, mouth to -Z, the
//                tube from z TUBE.z1 to TUBE.z0 along it).
//   doorL, doorR  the cab doors (rotation.y; doorL opens negative).
//   anchors.eye, anchors.cabDoorL/R (on the ground by each door), anchors.operator (the crane's
//                control levers at the column, ground level beside the right rear corner).

export const TZM = {
  R: 0.63, W: 0.43, track: 1.025,
  axles: [-3.5, -1.5, 1.84, 3.16], // 2.0 + 3.34 + 1.32 (KamAZ-6350), the track 2.05
  cab: { zf: -4.6, zr: -2.85, bumper: -4.92, hw: 1.22, y0: 1.32, top: 3.0 },
  deck: 1.5, // top of the platform floor
  bed: { z0: -2.3, z1: 4.0, hw: 1.25, side: 0.42 }, // platform; side board height
  tilt: { top: 3.1, eave: 2.86, split: 0.15 }, // roof, the top of its sides, where the rear part begins
  crane: { x: 1.0, z: 4.25, y: 1.55, h: 0.32 }, // column foot (the tail platform's right corner), its height to the boom hinge
  boom: { L: 0.9 }, jib: { L: 1.35, up: 0.3, tip: 1.45, ext: 2.6 }, // main boom; outer boom, its knuckle above the boom line, knuckle to the retracted tip, telescopic travel (two stages)
  drop: 0.62, // boom tip to the load anchor (hook, rotator, spreader)
  rear: 5.32, // the cargo truck is 9.85 m long; the crane and the frame behind add 0.4
  pair: TUBE.cols[1] - TUBE.cols[0], // spacing of a pair on the spreader (the block's columns)
  rack: { z: 3.65, pitch: TUBE.cols[1] - TUBE.cols[0], y: [1.93, 1.67] }, // container frames' z (the rear closures), column pitch, layer axes (upper, lower)
};

// ---------------------------------------------------------------- body

// Rounded-rectangle ring in plan at height y: half-width hw, front z0, rear z1, corner radius r.
function rrRing(hw, z0, z1, r, y, n = 3) {
  const out = [];
  const corners = [[hw - r, z0 + r, -90], [hw - r, z1 - r, 0], [-hw + r, z1 - r, 90], [-hw + r, z0 + r, 180]];
  for (const [cx, cz, a0] of corners) for (let k = 0; k < n; k++) {
    const a = ((a0 + (90 * k) / (n - 1)) * Math.PI) / 180;
    out.push(V(cx + Math.cos(a) * r, y, cz + Math.sin(a) * r));
  }
  return out;
}

// The KamAZ-6350's day cab (the photos): wider than the 6560's (2.45 m), a one-piece windscreen raked a
// little under a crowned roof with three amber marker lamps along its front edge, the
// grille band with three body-colour bars and the KAMAZ plate at its upper right, the round headlamps
// at its ends, a black panel under it and the deep black bumper box with round amber lamps, towing
// slots and the plate; black flared arches over the front wheels, steps, big mirrors on tube arms.
// The doors are pivots (built in buildPantsirTZM).
function cab6350(P) {
  const { zf, zr, bumper, hw, y0, top } = TZM.cab, a1 = TZM.axles[0];
  P.add('camo', loft([
    rrRing(hw, zf, zr, 0.1, y0),
    rrRing(hw, zf, zr, 0.1, 1.95),
    rrRing(hw, zf + 0.02, zr, 0.1, 2.3),
    rrRing(hw - 0.01, zf + 0.17, zr, 0.11, 2.9),
    rrRing(hw - 0.04, zf + 0.28, zr - 0.01, 0.15, top - 0.03),
    rrRing(hw - 0.14, zf + 0.5, zr - 0.08, 0.24, top + 0.03),
  ], { crease: 35 * Math.PI / 180 }));
  P.add('dark', box(2.2, 0.3, 1.6, 0, y0 - 0.1, (zf + zr) / 2 + 0.05)); // floor tunnel and engine cover under the cab
  // windscreen and its black surround, the wipers parked on the cowl
  const rake = Math.atan2(0.15, 0.58);
  P.add('rubber', box(2.18, 0.64, 0.02, 0, 2.6, zf + 0.085, rake));
  P.add('glass', box(2.1, 0.56, 0.02, 0, 2.6, zf + 0.075, rake));
  for (const x of [-0.62, 0.28]) {
    P.add('dark', box(0.02, 0.02, 0.06, x, 2.33, zf + 0.0));
    P.add('dark', box(0.62, 0.018, 0.018, x - 0.24, 2.37, zf + 0.005, 0, 0, 0.1));
  }
  // grille band: recess, three body-colour bars, KAMAZ plate at its upper right, headlamps at the ends
  P.add('dark', box(1.5, 0.3, 0.03, 0, 1.5, zf - 0.005));
  for (const y of [1.42, 1.5, 1.58]) P.add('camo', rb(1.48, 0.045, 0.05, 0.01, 0, y, zf - 0.02));
  P.add('dark', box(0.56, 0.085, 0.025, 0.2, 1.665, zf - 0.02));
  P.add('steel', box(0.5, 0.05, 0.01, 0.2, 1.665, zf - 0.035));
  for (const s of [-1, 1]) {
    P.add('dark', zTube(zf + 0.02, zf - 0.035, 0.125, 0.125, 18, s * 0.94, 1.5));
    P.add('lens', zTube(zf - 0.035, zf - 0.045, 0.1, 0.1, 18, s * 0.94, 1.5));
    P.add('amber', rb(0.05, 0.08, 0.06, 0.01, s * (hw - 0.04), 2.06, zf - 0.01)); // corner lamp
    P.add('amber', rb(0.04, 0.08, 0.08, 0.01, s * (hw + 0.005), 2.06, zf + 0.6)); // side repeater
  }
  P.add('dark', box(2.3, 0.22, 0.05, 0, y0 - 0.06, zf + 0.02)); // black panel under the grille
  // bumper box: full width, deep, black, with round amber lamps, towing slots, the plate, tow hooks
  const bz = (bumper + zf + 0.04) / 2, bd = zf + 0.04 - bumper;
  P.add('dark', rb(2.5, 0.38, bd, 0.03, 0, 1.02, bz));
  for (const s of [-1, 1]) {
    P.add('dark', zTube(bumper + 0.01, bumper - 0.02, 0.06, 0.06, 12, s * 1.0, 1.0));
    P.add('amber', zTube(bumper - 0.02, bumper - 0.03, 0.05, 0.05, 12, s * 1.0, 1.0));
    P.add('rubber', box(0.14, 0.16, 0.02, s * 0.62, 1.02, bumper - 0.005)); // towing slot
    P.add('steel', box(0.03, 0.12, 0.03, s * 0.6, 1.02, bumper - 0.01));
    P.add('steel', rod(V(s * 0.45, 0.85, bumper + 0.12), V(s * 0.45, 0.72, bumper + 0.05), 0.022, 6));
    P.add('steel', new THREE.TorusGeometry(0.06, 0.016, 6, 10).applyMatrix4(xf(s * 0.45, 0.68, bumper + 0.05, 0, Math.PI / 2, 0)));
  }
  P.add('white', box(0.52, 0.12, 0.01, 0, 0.99, bumper - 0.012), { tint: 0xe2e2da });
  P.add('dark', box(0.44, 0.07, 0.008, 0.03, 0.99, bumper - 0.018));
  P.add('red', box(0.04, 0.07, 0.008, -0.21, 0.99, bumper - 0.018), { tint: 0xb03030 });
  // fenders: the body-colour panel under each door with the wheel arch cut from it, a black flare round
  // the arch, two steps in its front part, a flap behind
  const arch = [];
  for (let k = 0; k <= 12; k++) { const t = ((160 - (140 * k) / 12) * Math.PI) / 180; arch.push([a1 + Math.cos(t) * 0.84, TZM.R + Math.sin(t) * 0.84]); }
  const fender = [[zf + 0.04, y0 + 0.5], [zf + 0.04, 0.95], ...arch, [arch[arch.length - 1][0], y0 + 0.5]];
  for (const s of [-1, 1]) {
    P.add('camo', sideProfile(fender, 0.14, 0.02).translate(s * (hw + 0.02), 0, 0));
    P.add('rubber', mudguard(TZM.R, 0.2, s * (hw + 0.07), TZM.R, a1, 18, 162, 0.16, 0.07)); // black flare
    P.add('rubber', mudguard(TZM.R, 0.5, s * (hw - 0.15), TZM.R, a1, 30, 150, 0.12, 0.025)); // inner liner
    for (const y of [0.92, 1.25]) {
      P.add('dark', box(0.05, 0.14, 0.36, s * (hw + 0.1), y + 0.05, zf + 0.33));
      P.add('steel', box(0.07, 0.03, 0.34, s * (hw + 0.09), y, zf + 0.33));
    }
    mudFlap(P, s * TZM.track, TZM.R, a1 + 0.86, 0.5, 0.45);
  }
  // cab sides: the rear quarter behind the door with a grab handle, the door seam on the shell
  for (const s of [-1, 1]) {
    const x = s * (hw + 0.002);
    P.add('dark', box(0.012, 1.5, 0.02, x, 2.1, zf + 0.22));
    P.add('dark', box(0.012, 1.5, 0.02, x, 2.1, zf + 1.4));
    P.add('steel', rod(V(s * (hw + 0.06), 1.75, zr - 0.12), V(s * (hw + 0.06), 2.75, zr - 0.12), 0.017, 6));
    for (const y of [1.75, 2.75]) P.add('steel', rod(V(s * (hw + 0.06), y, zr - 0.12), V(s * hw, y, zr - 0.12), 0.017, 5));
    // mirrors: a large black one on a tube arm from the A-pillar, a small one under it
    const mx = s * (hw + 0.2), mz = zf - 0.02;
    P.add('dark', rod(V(s * hw, 2.86, zf + 0.25), V(mx, 2.88, mz), 0.017, 6));
    P.add('dark', rod(V(s * hw, 2.3, zf + 0.25), V(mx, 2.28, mz), 0.017, 6));
    P.add('dark', rod(V(mx, 2.28, mz), V(mx, 2.88, mz), 0.017, 6));
    P.add('dark', rb(0.07, 0.46, 0.26, 0.025, mx + s * 0.04, 2.6, mz, 0, s * 0.25, 0));
    P.add('dark', rb(0.07, 0.2, 0.2, 0.04, mx + s * 0.04, 2.15, mz + 0.02, 0, s * 0.3, 0));
  }
  // roof: three amber marker lamps along the front edge, a vent behind them
  for (const x of [-0.3, 0, 0.3]) {
    P.add('dark', box(0.1, 0.03, 0.07, x, top - 0.005, zf + 0.33));
    P.add('amber', rb(0.08, 0.05, 0.05, 0.015, x, top + 0.035, zf + 0.33));
  }
  P.add('camo', rb(0.5, 0.06, 0.4, 0.02, 0.3, top + 0.02, zf + 1.1));
  // the rear wall: the cab mount and the air intake pipe on the left
  P.add('dark', box(2.2, 0.4, 0.2, 0, y0 + 0.1, zr + 0.1));
}


function chassis(P) {
  const { axles, R } = TZM;
  kamazFrame(P, TZM.cab.zf + 0.4, TZM.rear - 0.2);
  kamazRunningGear(P, { axles, R, W: TZM.W, wheels: false });
  // fenders: the second axle's flat guard, one long guard over the rear pair (photos: flat plates on stays)
  for (const s of [-1, 1]) {
    const x = s * TZM.track;
    P.add('camo', box(0.6, 0.05, 1.45, x, R + 0.78, axles[1]));
    P.add('camo', box(0.04, 0.24, 1.45, s * (TZM.track + 0.3), R + 0.67, axles[1]));
    P.add('camo', box(0.6, 0.05, axles[3] - axles[2] + 1.5, x, R + 0.8, (axles[2] + axles[3]) / 2));
    P.add('camo', box(0.04, 0.24, axles[3] - axles[2] + 1.5, s * (TZM.track + 0.3), R + 0.69, (axles[2] + axles[3]) / 2));
    for (const z of [axles[1] - 0.5, axles[1] + 0.5, axles[2] - 0.6, axles[3] + 0.6]) P.add('dark', box(0.06, 0.4, 0.05, s * 0.72, R + 0.6, z));
    mudFlap(P, s * TZM.track, R * 0.98, axles[1] + 0.74, 0.5, 0.48);
    mudFlap(P, s * TZM.track, R * 0.98, axles[3] + 0.76, 0.5, 0.48);
    // the sloped stay in front of the rear guard (photo zastava: a camouflaged plate)
    P.add('camo', box(0.04, 0.62, 0.5, s * (TZM.track + 0.3), R + 0.38, axles[2] - 0.98, 0.5, 0, 0));
  }
  // fuel tank on the right between the axle pairs, battery box and air tanks on the left
  P.add('dark', rb(0.55, 0.55, 1.25, 0.06, 0.98, 1.08, -0.35));
  P.add('steel', box(0.04, 0.57, 0.05, 1.27, 1.08, -0.85));
  P.add('steel', box(0.04, 0.57, 0.05, 1.27, 1.08, 0.15));
  P.add('dark', yTube(1.35, 1.42, 0.06, 0.06, 8, 0.98, -0.75));
  P.add('dark', rb(0.5, 0.45, 0.7, 0.04, -1.0, 1.1, 0.0));
  P.add('dark', zTube(-0.8, 0.0, 0.18, 0.18, 14, -0.98, 0.95));
  P.add('dark', zTube(0.6, 1.1, 0.18, 0.18, 14, -0.98, 1.0));
  // exhaust under the right side, silencer
  P.add('dark', zTube(-2.3, -1.2, 0.12, 0.12, 10, 0.82, 0.92));
  P.add('dark', zTube(-1.2, -0.6, 0.06, 0.06, 8, 0.82, 0.92));
}

// The gap behind the cab: the spare wheel standing on the right, axis fore and aft (photo granit), the
// rack with a cooling unit on the left (photo zastava), the air intake and the bed's headboard.
function behindCab(P) {
  const z0 = TZM.cab.zr, z1 = TZM.bed.z0, deck = TZM.deck;
  const sx = 0.62, sy = deck + 0.5, sz = (z0 + z1) / 2 + 0.02, turn = xf(sx, sy, sz, 0, Math.PI / 2, 0);
  P.add('tyre', kamazTyre(TZM.R, TZM.W, 14, 48).applyMatrix4(turn));
  const H = new Parts(P.mats);
  kamazHub(H, 0, 0, 0, 1);
  for (const key of ['dark', 'steel']) P.add(key, H.merged(key).applyMatrix4(turn));
  P.add('dark', box(1.0, 0.08, 0.45, sx, deck - 0.18, sz));
  P.add('dark', box(0.06, 1.25, 0.06, sx + 0.66, deck + 0.42, sz));
  P.add('dark', rod(V(sx, sy, sz - 0.28), V(sx, sy + 0.62, z0 + 0.05), 0.022, 5));
  // the cooling unit in its tube frame on the left: a fan behind a guard, a radiator box below
  const cx = -0.78;
  P.add('camo', rb(0.7, 0.6, 0.32, 0.03, cx, deck + 0.35, sz));
  P.add('dark', zTube(sz + 0.17, sz + 0.12, 0.25, 0.25, 18, cx, deck + 1.0));
  P.add('dark', box(0.62, 0.62, 0.12, cx, deck + 1.0, sz + 0.05));
  for (let i = -2; i <= 2; i++) P.add('steel', box(0.5, 0.012, 0.012, cx, deck + 1.0 + i * 0.1, sz + 0.2));
  for (const s of [-1, 1]) {
    P.add('steel', yTube(deck - 0.05, deck + 1.45, 0.022, 0.022, 6, cx + s * 0.36, sz + 0.22));
    P.add('steel', yTube(deck - 0.05, deck + 1.45, 0.022, 0.022, 6, cx + s * 0.36, sz - 0.2));
  }
  P.add('steel', xTube(cx - 0.36, cx + 0.36, 0.022, 0.022, 6, deck + 1.45, sz + 0.22));
  P.add('steel', xTube(cx - 0.36, cx + 0.36, 0.022, 0.022, 6, deck + 1.45, sz - 0.2));
  P.add('camo', rb(0.42, 0.42, 0.04, 0.02, cx, deck + 0.35, sz + 0.18)); // the panel with the unit badge
  P.add('red', box(0.06, 0.1, 0.01, cx, deck + 0.45, sz + 0.205), { tint: 0xc04040 });
  // air intake up the back of the cab on the left
  P.add('dark', yTube(1.3, 2.95, 0.075, 0.075, 8, -0.3, z0 + 0.12));
  P.add('dark', yTube(2.95, 3.12, 0.14, 0.1, 10, -0.3, z0 + 0.12));
  // the frame cross member and the bed's headboard, as tall as the tilt's sides
  P.add('dark', box(2.2, 0.16, 0.2, 0, deck - 0.12, z1 - 0.15));
}

// The platform: deck, low drop sides with vertical ribs and the rope hooks, the headboard, the rear
// board, the subframe, and the saddle racks for twelve containers in the rear part.
function platform(P) {
  const { deck } = TZM, { z0, z1, hw, side } = TZM.bed, len = z1 - z0, zc = (z0 + z1) / 2;
  P.add('camo', box(hw * 2, 0.08, len, 0, deck - 0.04, zc));
  P.add('dark', box(1.3, 0.16, len, 0, deck - 0.16, zc)); // subframe
  for (let z = z0 + 0.35; z < z1; z += 0.85) P.add('dark', box(hw * 2 - 0.1, 0.1, 0.08, 0, deck - 0.13, z));
  for (const s of [-1, 1]) {
    const x = s * (hw - 0.02);
    P.add('camo', box(0.04, side, len, x, deck + side / 2, zc));
    P.add('camo', box(0.07, 0.06, len, s * hw, deck + side - 0.03, zc)); // top rail
    P.add('camo', box(0.07, 0.07, len, s * hw, deck + 0.03, zc)); // bottom rail
    const n = Math.round(len / 0.42);
    for (let i = 0; i <= n; i++) {
      const z = z0 + 0.04 + ((len - 0.08) * i) / n;
      P.add('camo', box(0.06, side, 0.05, s * (hw + 0.01), deck + side / 2, z));
      P.add('dark', box(0.03, 0.04, 0.05, s * (hw + 0.04), deck + side - 0.1, z + 0.12)); // rope hook
    }
    for (const z of [z0 + len * 0.32, z0 + len * 0.66]) P.add('dark', box(0.08, side + 0.04, 0.04, s * (hw + 0.01), deck + side / 2, z)); // drop side hinges
  }
  P.add('camo', box(hw * 2, TZM.tilt.eave - deck, 0.06, 0, (TZM.tilt.eave + deck) / 2, z0 + 0.03)); // headboard
  P.add('camo', box(hw * 2, side, 0.05, 0, deck + side / 2, z1 - 0.025)); // tailboard
  for (const s of [-1, 1]) P.add('dark', box(0.06, side, 0.08, s * (hw - 0.05), deck + side / 2, z1 + 0.01));
  // saddle racks under the rear part: three cross frames carrying two layers of six
  const { pitch, y } = TZM.rack, zr = TZM.rack.z;
  const w = 6 * pitch + 0.06;
  for (const z of [zr + TUBE.z1 + 0.45, zr - 1.4, zr - 0.2]) {
    for (const yy of y) P.add('dark', box(w, 0.04, 0.1, 0, yy - TUBE.r - 0.035, z));
    for (const s of [-1, 1]) P.add('dark', box(0.06, y[0] - deck + 0.12, 0.1, s * w / 2, (y[0] + deck) / 2 + 0.06, z));
    for (let c = 0; c < 6; c++) P.add('rubber', box(0.12, 0.03, 0.11, (c - 2.5) * pitch, y[1] - TUBE.r - 0.02, z));
  }
}

// Inverted-U tilt bow between the side boards at z, as tubes.
function bow(P, z, key = 'paint') {
  const { deck } = TZM, { hw, side } = TZM.bed, { top, eave } = TZM.tilt;
  const x = hw - 0.04, y0 = deck + side - 0.05;
  for (const s of [-1, 1]) {
    P.add(key, rod(V(s * x, y0, z), V(s * x, eave, z), 0.022, 6));
    P.add(key, rod(V(s * x, eave, z), V(s * (x - 0.22), top - 0.03, z), 0.022, 6));
  }
  P.add(key, rod(V(-(x - 0.22), top - 0.03, z), V(x - 0.22, top - 0.03, z), 0.022, 6));
}

// The tilt cover between z0 and z1 (open ends unless capped): sides from the side boards' top to the
// eave, rounded shoulders, a flat roof; ropes along the foot.
function tarp(P, z0, z1, { front = false, back = false } = {}) {
  const { deck } = TZM, { hw, side } = TZM.bed, { top, eave } = TZM.tilt;
  const yb = deck + side - 0.1, x = hw + 0.02, sh = 0.24;
  const sec = [[x, yb], [x, eave], [x - sh * 0.3, eave + (top - eave) * 0.75], [x - sh, top], [-(x - sh), top], [-(x - sh * 0.3), eave + (top - eave) * 0.75], [-x, eave], [-x, yb]];
  // one strip per edge of the section, extruded from z0 to z1 (flat shaded panels with soft corners)
  for (let i = 0; i < sec.length - 1; i++) {
    const [ax, ay] = sec[i], [bx, by] = sec[i + 1];
    const mx = (ax + bx) / 2, my = (ay + by) / 2, L = Math.hypot(bx - ax, by - ay);
    P.add('cloth', box(L, 0.02, z1 - z0, mx, my, (z0 + z1) / 2, 0, 0, Math.atan2(by - ay, bx - ax)));
  }
  const cap = (z, d) => {
    const s = new THREE.Shape(sec.map(([a, b]) => new THREE.Vector2(a, b)));
    P.add('cloth', new THREE.ShapeGeometry(s).applyMatrix4(xf(0, 0, z, 0, d > 0 ? 0 : Math.PI, 0)));
  };
  if (front) cap(z0, -1);
  if (back) cap(z1, 1);
  // tie ropes along the foot and the eyelets
  for (const s of [-1, 1]) P.add('cloth', box(0.03, 0.02, z1 - z0 - 0.04, s * (x + 0.012), yb + 0.05, (z0 + z1) / 2), { tint: 0x55554a });
}

// The tail: a short platform behind the bed carrying the crane's column, the ladder frame across the
// back, the tall pole, the lamps and the tow hitch, the outrigger beam under it.
function tail(P) {
  const { deck, rear } = TZM, z0 = TZM.bed.z1 + 0.02, zc = (z0 + rear) / 2;
  P.add('camo', box(2.3, 0.1, rear - z0 - 0.1, 0, deck - 0.05, zc - 0.05));
  P.add('dark', box(1.3, 0.3, rear - z0, 0, deck - 0.25, zc));
  // the railing plate across the left of the tail platform, pierced with square holes (photo zastava)
  const zg = 4.62, x0 = -1.15, x1 = 0.35, yb = deck, yt = deck + 0.92;
  P.add('camo', box(x1 - x0, 0.12, 0.04, (x0 + x1) / 2, yb + 0.06, zg));
  P.add('camo', box(x1 - x0, 0.12, 0.04, (x0 + x1) / 2, yt - 0.06, zg));
  for (let i = 0; i <= 4; i++) P.add('camo', box(0.1, yt - yb, 0.04, x0 + 0.05 + ((x1 - x0 - 0.1) * i) / 4, (yb + yt) / 2, zg));
  P.add('camo', box(x1 - x0, 0.06, 0.04, (x0 + x1) / 2, (yb + yt) / 2, zg));
  P.add('camo', box(0.04, yt - yb, 0.6, x0, (yb + yt) / 2, zg + 0.3)); // its return along the left edge
  P.add('camo', box(0.04, 0.4, 0.5, x0 + 0.015, yb - 0.15, zg + 0.3)); // the plate down under the edge
  // the boarding ladder at the left rear corner, from near the ground to the railing's top
  const lx = -0.88, lz = rear - 0.05;
  for (const s of [-1, 1]) P.add('paint', box(0.06, yt - 0.55, 0.06, lx + s * 0.2, (0.55 + yt) / 2, lz));
  for (let y = 0.65; y < yt; y += 0.3) P.add('paint', box(0.4, 0.03, 0.05, lx, y, lz));
  for (const s of [-1, 1]) P.add('paint', box(0.04, 0.04, 0.7, lx + s * 0.2, yt - 0.05, lz - 0.35));
  P.add('paint', yTube(0.9, 2.75, 0.03, 0.025, 8, -1.14, rear - 0.25)); // the pole at the left rear corner (photo zastava)
  P.add('dark', box(0.08, 0.25, 0.08, -1.14, 1.25, rear - 0.25));
  // lamps, plate, hitch at the frame end under the platform
  P.add('dark', box(2.35, 0.16, 0.14, 0, 1.0, rear - 0.2));
  for (const s of [-1, 1]) {
    P.add('dark', box(0.4, 0.13, 0.05, s * 0.8, 1.0, rear - 0.11));
    P.add('red', box(0.12, 0.07, 0.01, s * 0.66, 1.0, rear - 0.08));
    P.add('red', box(0.12, 0.07, 0.01, s * 0.84, 1.0, rear - 0.08));
    P.add('amber', box(0.07, 0.07, 0.01, s * 0.98, 1.0, rear - 0.08));
  }
  P.add('white', box(0.48, 0.11, 0.01, 0.2, 1.16, rear - 0.12), { tint: 0xd8d8d0 });
  P.add('dark', box(0.3, 0.22, 0.2, 0, 0.86, rear - 0.12));
  P.add('steel', yTube(0.74, 0.98, 0.03, 0.03, 8, 0, rear - 0.04));
}

// ---------------------------------------------------------------- crane

const _a = new THREE.Vector3(), _b = new THREE.Vector3();

// one box-section boom along -Z from its hinge, w by h, length L, with the hinge lugs
function boomBox(P, w, h, L, key = 'camo') {
  P.add(key, rb(w, h, L, 0.02, 0, 0, -L / 2));
  P.add('dark', xTube(-w / 2 - 0.03, w / 2 + 0.03, h * 0.32, h * 0.32, 12, 0, 0));
  P.add('dark', box(w + 0.02, 0.02, L * 0.9, 0, h / 2 + 0.01, -L / 2)); // hose run on top
}

// Hydraulic ram between two points of a pivot's space, built along +Z: barrel and rod groups posed by
// aim(a, b) every setCrane.
function ram(rig, parent, r, len) {
  const barrel = new THREE.Group(), rodG = new THREE.Group();
  parent.add(barrel, rodG);
  const B = new Parts(rig.mats), R = new Parts(rig.mats);
  B.add('camo', zTube(0, len, r, r, 12, 0, 0));
  B.add('dark', zTube(-0.06, 0.04, r + 0.015, r + 0.015, 10, 0, 0));
  R.add('steel', zTube(0, len + 0.1, r * 0.55, r * 0.55, 10, 0, 0));
  R.add('dark', zTube(-0.05, 0.05, r * 0.8, r * 0.8, 10, 0, 0));
  B.build(barrel, { dirt: 0.1, y0: 3 });
  R.build(rodG, { dirt: 0.05, y0: 3 });
  // a and b in the parent's y-z plane (x fixed): the barrel from a toward b, the rod from b back toward a
  return (a, b) => {
    const dy = b.y - a.y, dz = b.z - a.z, d = Math.hypot(dy, dz);
    barrel.position.copy(a);
    barrel.rotation.set(-Math.atan2(dy, dz), 0, 0);
    rodG.position.copy(b);
    rodG.rotation.set(-Math.atan2(-dy, -dz), 0, 0);
    barrel.scale.z = Math.min(1, Math.max(0.3, (d - 0.05) / len));
    rodG.scale.z = Math.min(1, Math.max(0.3, d / (len + 0.1)));
  };
}

function crane(rig) {
  const { mats, root } = rig;
  const C = TZM.crane, J = TZM.jib, L1 = TZM.boom.L, ST = 1.3; // stage length
  const slew = pivotAt(rig, root, 'crane', C.x, C.y, C.z);
  // column: the base housing with the slewing gear, the column, the control levers
  const S = new Parts(mats);
  S.add('camo', rb(0.56, 0.3, 0.56, 0.04, 0, 0.15, 0));
  S.add('camo', yTube(0.3, C.h + 0.1, 0.15, 0.13, 14, 0, 0));
  S.add('dark', yTube(0.28, 0.34, 0.22, 0.22, 16, 0, 0));
  for (const s of [-1, 1]) S.add('camo', box(0.05, 0.3, 0.32, s * 0.13, C.h, 0.02)); // hinge cheeks
  S.add('dark', box(0.12, 0.18, 0.12, 0.0, C.h - 0.22, 0.2)); // the main ram's foot lug
  S.build(slew, { dirt: 0.25, y0: C.y });
  const bm = pivotAt(rig, slew, 'craneBoom', 0, C.h, 0);
  const B = new Parts(mats);
  boomBox(B, 0.2, 0.26, L1 + 0.1);
  for (const s of [-1, 1]) B.add('camo', box(0.04, 0.42, 0.3, s * 0.12, J.up * 0.5, -L1)); // knuckle cheeks
  B.add('dark', box(0.12, 0.08, 0.14, 0, -0.17, -L1 * 0.6)); // the main ram's head lug
  B.add('dark', box(0.12, 0.1, 0.14, 0, 0.19, -0.22)); // the outer ram's foot lug
  B.build(bm, { dirt: 0.1, y0: 3 });
  const jb = pivotAt(rig, bm, 'craneJib', 0, J.up, -L1);
  const Jp = new Parts(mats);
  boomBox(Jp, 0.2, 0.24, J.L);
  Jp.add('dark', box(0.12, 0.08, 0.14, 0, 0.16, 0.2)); // the outer ram's head lug (behind the knuckle)
  Jp.build(jb, { dirt: 0.08, y0: 3 });
  // two telescopic stages nested in the outer boom, each a box along -Z from its pivot
  const e1 = pivotAt(rig, jb, 'craneExt', 0, 0, -(J.L + 0.05) + ST);
  const E1 = new Parts(mats);
  E1.add('camo', rb(0.15, 0.19, ST, 0.02, 0, 0, -ST / 2));
  E1.build(e1, { dirt: 0.05, y0: 3 });
  const e2 = pivotAt(rig, e1, 'craneExt2', 0, 0, -0.05);
  const E2 = new Parts(mats);
  E2.add('camo', rb(0.11, 0.15, ST, 0.02, 0, 0, -ST / 2));
  E2.add('dark', box(0.15, 0.18, 0.14, 0, -0.02, -ST + 0.05)); // the head with the sheave
  E2.add('dark', xTube(-0.08, 0.08, 0.06, 0.06, 10, -0.05, -ST + 0.04));
  E2.build(e2, { dirt: 0.05, y0: 3 });
  const hk = pivotAt(rig, e2, 'craneHook', 0, 0, -ST);
  // the two falls of the hoist cable, scaled with the hook's drop
  const cable = new THREE.Group();
  hk.add(cable);
  const Cb = new Parts(mats);
  for (const x of [-0.03, 0.03]) Cb.add('dark', yTube(-1, 0, 0.01, 0.01, 4, x, 0));
  Cb.build(cable, { dirt: 0, y0: 3, shadow: false });
  const rt = pivotAt(rig, hk, 'craneRotator', 0, -0.38, 0);
  const R = new Parts(mats);
  R.add('dark', box(0.1, 0.12, 0.08, 0, 0.06, 0)); // hook block
  R.add('dark', yTube(-0.08, 0, 0.05, 0.05, 10, 0, 0)); // rotator
  // spreader: a beam along the containers with two cross heads, short chains down to four clamps
  R.add('paint', box(0.06, 0.08, 1.3, 0, -0.12, 0));
  for (const z of [-0.6, 0.6]) {
    R.add('paint', box(TZM.pair + 0.2, 0.05, 0.06, 0, -0.14, z));
    for (const s of [-1, 1]) {
      R.add('steel', yTube(-0.22, -0.15, 0.008, 0.008, 4, s * TZM.pair / 2, z));
      R.add('dark', box(0.05, 0.04, 0.07, s * TZM.pair / 2, -0.225, z)); // clamp
    }
  }
  R.add('dark', rod(V(0, -0.08, 0), V(0, -0.12, 0.3), 0.012, 4));
  R.build(rt, { dirt: 0, y0: 3 });
  rig.anchors.craneLoad = node(rt, 'craneLoad', 0, -0.24, 0);
  // rams: the main one from the column to the boom's belly, the outer one over the knuckle
  const mainRam = ram(rig, slew, 0.065, 0.8), jibRam = ram(rig, bm, 0.055, 0.7);
  const A0 = V(0, C.h - 0.22, 0.2), B0 = V(0, -0.17, -L1 * 0.6); // column lug (slew space), boom lug (boom space)
  const C0 = V(0, 0.19, -0.22), D0 = V(0, 0.16, 0.2); // boom lug (boom space), jib lug (jib space)
  const st = { slew: 0, boom: 0, jib: 0, ext: 0, rotate: 0, hoist: 1 };
  rig.crane = st;
  rig.setCrane = (o = {}) => {
    Object.assign(st, o);
    slew.rotation.y = st.slew;
    bm.rotation.x = st.boom;
    jb.rotation.x = st.jib;
    const e = Math.max(0, Math.min(J.ext, st.ext)) / 2;
    e1.position.z = -(J.L + 0.05) + ST - e;
    e2.position.z = -0.05 - e;
    hk.rotation.x = -(st.boom + st.jib);
    rt.rotation.y = st.rotate;
    const lift = 0.27 * (1 - Math.max(0, Math.min(1, st.hoist)));
    rt.position.y = -0.38 + lift;
    cable.scale.y = 0.32 - lift;
    // ram points in the parent's space
    _b.copy(B0).applyAxisAngle(_X, st.boom).add(bm.position);
    mainRam(A0, _b);
    _a.copy(D0).applyAxisAngle(_X, st.jib).add(jb.position);
    jibRam(C0, _a);
  };
  // The solver: the main boom (hinge to knuckle: L1 along the boom, J.up above it) and the outer boom
  // (knuckle to tip: J.tip + extension) are a two-link arm in the slew plane; the extension grows with
  // the reach. Elbow up. The load anchor hangs TZM.drop under the tip.
  const Lk = Math.hypot(L1, J.up), dk = Math.atan2(J.up, L1);
  const hingeY = C.y + C.h;
  rig.solveCrane = (p, yaw, out = {}) => {
    const dx = p.x - C.x, dz = p.z - C.z;
    const u = Math.hypot(dx, dz), y = p.y + TZM.drop - hingeY;
    out.slew = Math.atan2(-dx, -dz);
    const D0 = Math.hypot(u, y);
    const ext = Math.max(0, Math.min(J.ext, D0 - Lk * 0.5 - J.tip));
    const L2 = J.tip + ext;
    out.ok = D0 <= Lk + L2 - 0.02 && D0 >= Math.abs(L2 - Lk) + 0.02;
    const D = Math.min(Lk + L2 - 0.02, Math.max(Math.abs(L2 - Lk) + 0.02, D0));
    const a = Math.atan2(y, u), k = Math.acos(Math.min(1, Math.max(-1, (Lk * Lk + D * D - L2 * L2) / (2 * Lk * D))));
    const phi1 = a + k, x0 = Lk * Math.cos(phi1), y0 = Lk * Math.sin(phi1);
    const phi2 = Math.atan2(D * Math.sin(a) - y0, D * Math.cos(a) - x0);
    out.boom = phi1 - dk;
    out.jib = phi2 - out.boom;
    out.ext = ext;
    out.rotate = yaw - out.slew;
    out.hoist = 1;
    return out;
  };
  // stowed upright at the tail's right corner behind the tilt (photo granit): the main boom standing,
  // the outer boom folded down beside it on the outside, the hook pulled up, the spreader along the
  // truck under the platform's edge
  rig.craneTravel = { slew: Math.PI / 2, boom: Math.PI / 2, jib: -Math.PI + 0.03, ext: 0, rotate: -Math.PI / 2, hoist: 0 };
}
const _X = new THREE.Vector3(1, 0, 0);

// Outriggers (reconstructed, none is seen deployed): a transverse box under the tail, a sliding leg
// out of each end, and at its tip a jack that folds up along the leg for travel, so nothing hangs
// below the frame. setOutriggers: the legs slide out (0..0.5), the jacks swing down (..0.75) and
// extend to the ground (..1).
function outriggers(rig) {
  const { mats, root } = rig;
  const z = TZM.rear - 0.55, y = 0.95, piv = 0.12;
  const P = new Parts(mats);
  P.add('camo', box(2.1, 0.2, 0.24, 0, y, z));
  P.build(root, { dirt: 0.4 });
  const legs = [];
  for (const s of [-1, 1]) {
    const g = new THREE.Group();
    g.position.set(s * 0.15, y, z);
    root.add(g);
    const L = new Parts(mats);
    L.add('camo', box(1.0, 0.15, 0.18, s * 0.45, 0, 0));
    L.add('dark', box(0.08, 0.06, 0.2, s * 0.95, -0.09, 0)); // the hinge lugs
    L.build(g, { dirt: 0.4, y0: y });
    const jk = new THREE.Group();
    jk.position.set(s * 0.95, -piv, 0);
    g.add(jk);
    const J = new Parts(mats);
    J.add('dark', box(0.16, 0.2, 0.16, 0, -0.1, 0)); // the jack's cylinder head
    J.add('dark', yTube(-0.42, -0.2, 0.07, 0.07, 12, 0, 0)); // barrel
    J.build(jk, { dirt: 0.5, y0: 0.6 });
    const rodG = new THREE.Group();
    jk.add(rodG);
    const K = new Parts(mats);
    K.add('steel', yTube(-0.44, 0.0, 0.045, 0.045, 10, 0, 0));
    K.add('dark', yTube(-0.5, -0.44, 0.16, 0.14, 14, 0, 0)); // pad
    K.build(rodG, { dirt: 0.6, y0: 0.3 });
    legs.push({ g, jk, rodG, s });
  }
  const reach = y - piv - 0.5; // the rod's travel to the ground
  rig.setOutriggers = (v) => {
    const out = Math.min(1, Math.max(0, v * 2)), swing = Math.min(1, Math.max(0, v * 4 - 2)), down = Math.min(1, Math.max(0, v * 4 - 3));
    for (const L of legs) {
      L.g.position.x = L.s * (0.15 + 0.9 * out);
      L.jk.rotation.z = -L.s * (Math.PI / 2) * (1 - swing);
      L.rodG.position.y = -reach * down;
    }
  };
  rig.setOutriggers(0);
}

// The tilt's rear part: bows and cover between `split` and the platform's end that bunch forward
// (vertex positions recomputed only while it moves). The front part is fixed.
function sliding(rig) {
  const { mats, root } = rig;
  const z0 = TZM.tilt.split, z1 = TZM.bed.z1 - 0.02, n = 5;
  const Tp = new Parts(mats), Bw = new Parts(mats);
  tarp(Tp, z0 - 0.02, z1, { back: true });
  const bowZ = [];
  for (let i = 1; i <= n; i++) bowZ.push(z0 + ((z1 - z0) * i) / n - (i === n ? 0.04 : 0));
  for (const z of bowZ) bow(Bw, z);
  const [cover] = Tp.build(root, { dirt: 0.2 });
  const [bows] = Bw.build(root, { dirt: 0.1 });
  const cp = cover.geometry.attributes.position, c0 = cp.array.slice();
  const bp = bows.geometry.attributes.position, b0 = bp.array.slice();
  // each bow's vertices keep their shape: map them by the bow's own z
  const bowOf = new Float32Array(bp.count);
  for (let i = 0; i < bp.count; i++) {
    const z = b0[i * 3 + 2];
    let best = bowZ[0];
    for (const bz of bowZ) if (Math.abs(bz - z) < Math.abs(best - z)) best = bz;
    bowOf[i] = best;
  }
  const squeeze = 0.12; // the bunched length per metre of cover
  let last = -1;
  rig.setTarp = (v) => {
    v = Math.min(1, Math.max(0, v));
    if (v === last) return;
    last = v;
    const k = 1 - (1 - squeeze) * v;
    for (let i = 0; i < cp.count; i++) {
      const x = c0[i * 3], y = c0[i * 3 + 1], z = c0[i * 3 + 2];
      const d = z - z0;
      // folds: the cover sags between the bows and bulges out at the sides as it bunches
      const f = Math.abs(Math.sin((d / (z1 - z0)) * n * Math.PI)) * v;
      cp.array[i * 3] = x * (1 + 0.035 * f);
      cp.array[i * 3 + 1] = y - (y > TZM.tilt.eave ? 0.07 * f : 0);
      cp.array[i * 3 + 2] = z0 + d * k;
    }
    cp.needsUpdate = true;
    for (let i = 0; i < bp.count; i++) bp.array[i * 3 + 2] = b0[i * 3 + 2] - bowOf[i] + z0 + (bowOf[i] - z0) * k;
    bp.needsUpdate = true;
  };
  rig.setTarp(0);
}

// ---------------------------------------------------------------- load

// Twelve containers on the racks under the tilt's rear part, merged with the platform's parts; each can
// be taken off (setLoaded) when the crane lifts it. Their frames are the anchors.cargo.
function load(rig, P) {
  const spans = [];
  rig.anchors.cargo = [];
  for (let i = 0; i < 12; i++) {
    const layer = Math.floor(i / 6), c = i % 6;
    const x = (c - 2.5) * TZM.rack.pitch, y = TZM.rack.y[layer];
    const m = mark(P);
    // the container's own frame at (x, y, rack.z): the tube runs from TUBE.z1 (mouth, forward) to TUBE.z0
    const T = new Parts(P.mats);
    pantsirTube(T, 0, 0, 1);
    for (const [key, list] of T.lists) for (const g of list) P.lists.has(key) ? P.lists.get(key).push(g.applyMatrix4(xf(x, y, TZM.rack.z))) : P.lists.set(key, [g.applyMatrix4(xf(x, y, TZM.rack.z))]);
    const cap = new Parts(P.mats);
    cap.add('white', tubeCap(0, 0), { tint: 0x8e9484 });
    P.lists.has('white') ? P.lists.get('white').push(cap.lists.get('white')[0].applyMatrix4(xf(x, y, TZM.rack.z))) : P.lists.set('white', [cap.lists.get('white')[0].applyMatrix4(xf(x, y, TZM.rack.z))]);
    spans[i] = span(P, m);
    rig.anchors.cargo.push(node(rig.root, 'cargo' + i, x, y, TZM.rack.z));
  }
  return spans;
}

// ---------------------------------------------------------------- assembly

export function buildPantsirTZM() {
  const rig = newRig('green');
  const { P, root, mats } = rig;
  chassis(P);
  cab6350(P);
  behindCab(P);
  platform(P);
  tarp(P, TZM.bed.z0 + 0.03, TZM.tilt.split, { front: true });
  for (const z of [TZM.bed.z0 + 0.06, (TZM.bed.z0 + TZM.tilt.split) / 2]) bow(P, z);
  tail(P);
  const spans = load(rig, P);
  const meshes = P.build(root, { dirt: 0.5 });
  greyer(meshes);
  const cargo = swapper(meshes, spans);
  rig.setLoaded = (i, on) => cargo.set(i, on);
  rig.slots = [];
  sliding(rig);
  outriggers(rig);
  crane(rig);
  rig.setCrane(rig.craneTravel);
  // the cab doors over the seams on the shell: panel, window, handle
  const d0 = TZM.cab.zf + 0.22, d1 = TZM.cab.zf + 1.4;
  for (const s of [-1, 1]) {
    const dp = pivotAt(rig, root, s < 0 ? 'doorL' : 'doorR', s * (TZM.cab.hw + 0.012), 0, d0);
    const D = new Parts(mats);
    D.add('camo', box(0.025, 1.5, d1 - d0 - 0.02, 0, 2.1, (d1 - d0) / 2));
    D.add('rubber', box(0.03, 0.62, d1 - d0 - 0.2, 0, 2.56, (d1 - d0) / 2 + 0.02));
    D.add('glass', box(0.035, 0.56, d1 - d0 - 0.26, 0, 2.56, (d1 - d0) / 2 + 0.02));
    D.add('dark', box(0.035, 0.035, 0.14, s * 0.015, 2.16, d1 - d0 - 0.2));
    greyer(D.build(dp, { dirt: 0.4 }));
  }
  const wheels = spinWheels(root, mats, TZM.axles.flatMap((z, i) => [-1, 1].map((s) => ({ x: s * TZM.track, y: TZM.R, z, steer: i === 0 ? 1 : i === 1 ? 0.7 : 0 }))), TZM.R, (Q, R) => {
    Q.add('tyre', kamazTyre(R, TZM.W));
    kamazHub(Q, 0, 0, 0, 1, R, TZM.W);
  });
  rig.setWheels = wheels.set;
  rig.wheelR = TZM.R;
  rig.axles = TZM.axles;
  rig.anchors.eye = node(root, 'eye', 0, 2.4, 0);
  rig.anchors.cabDoorL = node(root, 'cabDoorL', -1.75, 0, TZM.cab.zf + 0.9);
  rig.anchors.cabDoorR = node(root, 'cabDoorR', 1.75, 0, TZM.cab.zf + 0.9);
  rig.anchors.operator = node(root, 'operator', 1.75, 0, TZM.crane.z + 0.2);
  hb(rig, -1.3, 0, TZM.cab.bumper, 1.3, TZM.tilt.top, TZM.rear);
  return rig;
}
