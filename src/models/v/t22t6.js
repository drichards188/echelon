import * as THREE from 'three';
import { V, xf, box, rbox, yTube, zTube, xTube, sphere, rod, lathe, sideProfile, addLamp, Parts, mudguard } from '../kit.js';
import { newRig, node, pivotAt, hb } from '../rig.js';
import { lugTyre, discHub, rb } from './ural.js';
import { mudFlap, extinguisher, hose, ladder } from '../trucks.js';

// 22T6 transporter-loader (TZM) of the S-400 on the Ural-532361 8x8 (refs/reload/README.md, section 1;
// photos refs/reload/photos/s400_22t6_ashuluk_1..6, s400_airdefexercise2017_10..13 and the travel side
// view in s400_antiaircraftexercise2019_37): the short cab-forward Ural cab (two-pane windscreen over
// a slatted grille, headlamps in pods at the corners, a black bumper), the engine bay behind it with
// the spare wheel and the exhaust, two axle pairs far apart, a long body with lockers and a flat rear
// face (two round holes, a ladder up the middle, the plate on the left), and on the rear deck the
// crane: a turntable, a goose-neck column of two pierced plates, a pierced box boom with its luffing
// ram, a self-levelling head with the control box and lamp on top, a telescopic post, a rotator and
// the spreader that takes a pair of canisters (two long beams with clamp legs at their ends). Four
// outriggers: swing arms at the rear corners and behind the cab, each with a screw jack in a bellows
// boot and a round pad. Plain olive (4BO). Dimensions are estimates from the photos with the 1.3 m
// tyre as the ruler (no published figures). Model space: front -Z, ground y = 0, origin at the middle
// of the 10.8 m length.
//
// Pivots (radians; three.js Euler about the pivot's own axes) and rig extras:
//   crane        rotation.y slew about the turntable on the centre line 1.9 m ahead of the rear face;
//                0 = the boom pointing forward (-Z), + swings it to the left. Any value.
//   craneColumn  rotation.x of the column about its foot on the turntable; 0 upright (working), the
//                travel pose folds it forward (TRAVEL.column, -1.42).
//   craneBoom    rotation.x of the boom about the column top; 0 level when the column is upright, +
//                raises the tip; travel TRAVEL.boom (folded back over the column).
//   craneHead    the head at the boom tip, kept level by setCrane (do not set).
//   cranePost    the telescopic post under the head: position.y = -extension (setCrane `post`).
//   craneRotator rotation.y of the spreader under the post (setCrane `rotate`, relative to the boom).
//   anchors.craneLoad  under the spreader at the middle of a carried pair of canisters, between their
//                axes: a load parented with an identity transform hangs level with its length along
//                the anchor's Z (the beams).
//   doorL, doorR the cab doors: doorL opens to about -1.2 (rotation.y), doorR to +1.2.
//   setCrane({ slew, column, boom, post, rotate })  poses the crane (the head levels itself, the luffing
//                ram follows); any field may be left out (it keeps its value).
//   solveCrane(p, yaw, out = {})  slew, boom, post and rotate that put the middle of the load at p
//                (model space Vector3) with its length along the model-space yaw (radians, three's
//                rotation.y convention) with the column upright; out.ok is false (and the pose clamped)
//                when p is out of reach.
//   craneTravel  { slew: 0, column, boom, post, rotate }: the travel pose (built in it).
//   setOutriggers(v)  0 stowed .. 0.5 arms swung out .. 1 jacks down on the ground (y = 0).
//   setWheels(roll, steer)  roll: metres travelled (the wheels turn by roll / R); steer: front axle
//                angle (rad, + = left), the second axle steers 0.6 of it.
//   wheelR       tyre radius; axles: z of the four axles; wheelbase: front pair to rear pair (m).
//   anchors.eye, anchors.cabDoorL/R (on the ground by each cab door), anchors.operator (the crane
//                operator's spot, ground, rear right corner).

export const T22 = {
  L: 10.3, front: -5.05, rear: 5.25, R: 0.62, W: 0.5, track: 1.03,
  axles: [-3.77, -2.39, 1.2, 2.61],
  cab: { zf: -4.93, zr: -3.48, y0: 1.5, H: 3.5, w: 2.5 },
  deck: 2.12, // top of the body and the rear deck
  body: { z0: -1.0, hw: 1.26 },
  turntable: { z: 2.5, y: 2.12 },
  column: { pivot: 0.32, h: 4.0, back: 0.75 }, // foot above the turntable top; the boom hinge h up and back behind it
  boom: { L: 5.7 },
  head: { up: 0.6, rot: 0.25 }, // head box above the boom line; the rotator under the post
  post: { min: 0.3, max: 0.95 }, // the telescopic post's travel under the head
  spreader: { L: 3.4, gap: 1.24, drop: 0.45, load: 0.72 }, // beam length, beam spacing, rotator to beams, beams to the load anchor
};

// the travel pose (filled in by crane()): the crane turned to face the rear, the column laid back
// over the body (the hinge forward, its bulge down), the boom level back over it to the rear and the
// spreader lying across the rear deck with its legs down either side of the body
export const TRAVEL = { slew: Math.PI, column: 1.1, boom: -1.1, post: 0.3, rotate: Math.PI / 2 };

// ---------------------------------------------------------------- spinning wheels (shared with t5t58.js)

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(0, 0, 0, 'YXZ'), _p = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1);

/**
 * Wheels drawn as instanced meshes (one per material) so they can turn: list of { x, y, z, steer }
 * (steer: the share of the steering angle that axle takes, 0 for none). The right wheels (x > 0) are
 * built with the hub on the outside and the left ones are the same wheel turned half round about y.
 * Returns { meshes, set(roll, steer) }; `build(P, R, W)` fills a Parts collector with one wheel at the
 * origin (axle along x, hub toward +x).
 */
export function spinWheels(parent, mats, list, R, build, y0 = 0) {
  const P = new Parts(mats);
  build(P, R);
  const meshes = [];
  for (const key of P.lists.keys()) {
    const g = P.merged(key);
    const pos = g.attributes.position, ah = new Float32Array(pos.count);
    for (let i = 0; i < pos.count; i++) ah[i] = pos.getY(i) + R + y0;
    g.setAttribute('aH', new THREE.BufferAttribute(ah, 1));
    g.computeBoundingSphere();
    const m = new THREE.InstancedMesh(g, mats[key], list.length);
    m.name = 'wheels-' + key;
    m.castShadow = true;
    m.receiveShadow = true;
    m.frustumCulled = false;
    parent.add(m);
    meshes.push(m);
  }
  for (const l of P.lists.values()) for (const g of l) g.dispose();
  const set = (roll = 0, steer = 0) => {
    const a = roll / R;
    list.forEach((w, i) => {
      const left = w.x < 0;
      _e.set(left ? a : -a, (w.steer ?? 0) * steer + (left ? Math.PI : 0), 0, 'YXZ');
      _m.compose(_p.set(w.x, w.y, w.z), _q.setFromEuler(_e), _s);
      for (const m of meshes) m.setMatrixAt(i, _m);
    });
    for (const m of meshes) m.instanceMatrix.needsUpdate = true;
  };
  set(0, 0);
  return { meshes, set };
}

// A heavy truck wheel: the lugged tyre on a black disc wheel with its hub reduction.
export function heavyWheel(W) {
  return (P, R) => {
    P.add('tyre', lugTyre(R, W, 18, 48));
    discHub(P, 0, 0, 0, 1, R, W);
  };
}

// ---------------------------------------------------------------- cab and chassis

// The Ural cab (Ural-5323 family, the newer face): a short tall box over the first axle, the
// two-pane windscreen raked a little, a slatted grille under it with headlamp pods at the corners,
// a deep black bumper; doors with big windows, a small rear quarter window, steps under the doors.
function cab(P, rig) {
  const { zf, zr, y0, H, w } = T22.cab, hw = w / 2, g0 = 2.36, g1 = 3.17;
  // (the outline 5 cm inside the nominal lines: the extrusion's bevel grows it back out)
  const e = 0.05;
  const prof = [[zf + e, y0 + e], [zf + e, g0 - 0.04], [zf + 0.13 + e, g1 + 0.04], [zf + 0.2 + e, H - 0.05 - e], [zf + 0.32, H - e], [zr - 0.1, H - e], [zr - e, H - 0.1], [zr - e, y0 + e]];
  P.add('camo', sideProfile(prof, w, e));
  const tilt = Math.atan2(0.13, g1 - g0);
  // windscreen: two panes either side of a pillar, rubber surrounds, wipers parked low
  for (const s of [-1, 1]) {
    const x = s * 0.56;
    P.add('glass', box(1.04, g1 - g0, 0.03, x, (g0 + g1) / 2, zf + 0.055, tilt));
    P.add('rubber', box(1.08, 0.035, 0.04, x, g1 + 0.005, zf + 0.12, tilt));
    P.add('rubber', box(1.08, 0.035, 0.04, x, g0 - 0.005, zf - 0.005, tilt));
    P.add('dark', box(0.02, 0.025, 0.62, x - 0.2, g0 + 0.07, zf + 0.0, Math.PI / 2 - 0.18 + tilt, 0, -s * 0.2));
  }
  P.add('camo', box(0.07, g1 - g0, 0.04, 0, (g0 + g1) / 2, zf + 0.05, tilt)); // centre pillar
  // the band under the screen with a vent slot, then the grille between the lamp pods
  P.add('dark', box(1.7, 0.02, 0.02, 0.1, 2.25, zf - 0.005));
  P.add('dark', box(1.32, 0.5, 0.03, 0.06, 1.9, zf - 0.005));
  for (let i = 0; i < 6; i++) P.add('camo', box(1.3, 0.035, 0.05, 0.06, 1.7 + i * 0.08, zf - 0.02));
  P.add('steel', box(0.17, 0.17, 0.02, 0.0, 1.94, zf - 0.05, 0, 0, Math.PI / 4)); // the badge
  for (const s of [-1, 1]) {
    const x = s * 0.97;
    P.add('camo', rb(0.42, 0.56, 0.12, 0.03, x, 1.88, zf - 0.05));
    P.add('dark', zTube(zf - 0.13, zf - 0.08, 0.11, 0.11, 16, x + s * 0.02, 1.76));
    P.add('lens', zTube(zf - 0.14, zf - 0.13, 0.095, 0.095, 16, x + s * 0.02, 1.76));
    P.add('amber', box(0.13, 0.08, 0.04, x + s * 0.02, 2.04, zf - 0.11));
  }
  // bumper box, plate, tow hooks; the skid plate and the steering gear behind
  const b0 = 1.02, b1 = 1.47, bz = zf - 0.02;
  P.add('dark', rb(w + 0.04, b1 - b0, 0.28, 0.04, 0, (b0 + b1) / 2, bz));
  P.add('dark', box(0.56, 0.13, 0.02, 0.0, (b0 + b1) / 2, zf - 0.165));
  P.add('white', box(0.52, 0.11, 0.01, 0.0, (b0 + b1) / 2, zf - 0.175), { tint: 0x888888 });
  for (const s of [-1, 1]) {
    P.add('steel', rb(0.16, 0.12, 0.16, 0.03, s * 0.55, b0 + 0.04, zf - 0.17));
    addLamp(P, s * 1.08, b0 + 0.22, zf - 0.16, 0.12, 0.08, 0.04, 'amber');
  }
  P.add('dark', box(1.6, 0.4, 0.9, 0, 1.0, zf + 0.5));
  // sides: door seams (the doors are their own pivots), rear quarter windows, steps, grab handles, mirrors
  const d0 = zf + 0.17, d1 = zf + 1.12;
  for (const s of [-1, 1]) {
    const x = s * (hw + 0.004);
    P.add('dark', box(0.02, H - y0 - 0.15, 0.03, x, (y0 + H) / 2 - 0.05, d1 + 0.01));
    P.add('glass', box(0.03, 0.46, 0.22, x, 2.72, zr - 0.2));
    for (const [y, d] of [[y0 - 0.34, 0.32], [y0 - 0.72, 0.28]]) P.add('dark', box(0.32, 0.04, 0.62, s * (hw - 0.12), y, (d0 + d1) / 2));
    P.add('dark', box(0.03, 0.82, 0.04, s * (hw - 0.03), y0 - 0.48, d0 + 0.12));
    P.add('dark', box(0.03, 0.82, 0.04, s * (hw - 0.03), y0 - 0.48, d1 - 0.12));
    P.add('steel', rod(V(s * (hw + 0.06), y0 + 0.2, d1 + 0.08), V(s * (hw + 0.06), H - 0.45, d1 + 0.08), 0.018, 5));
    // mirror: a long bent arm off the screen pillar and a tall rectangular glass
    P.add('dark', rod(V(x, 3.0, zf + 0.15), V(s * (hw + 0.55), 3.08, zf - 0.08), 0.02, 5));
    P.add('dark', rod(V(x, 2.45, zf + 0.15), V(s * (hw + 0.55), 2.62, zf - 0.08), 0.02, 5));
    P.add('dark', rb(0.08, 0.6, 0.32, 0.03, s * (hw + 0.58), 2.85, zf - 0.1));
    addLamp(P, x, y0 + 0.15, zf + 0.25, 0.02, 0.08, 0.12, 'amber');
    // the door opening behind each door panel (seen when it stands open)
    P.add('dark', box(0.02, 1.62, d1 - d0 - 0.04, s * (hw - 0.03), 2.38, (d0 + d1) / 2));
  }
  // roof: three amber marker lamps along the front edge, a vent, a whip
  for (const x of [-0.95, 0, 0.95]) P.add('amber', yTube(H, H + 0.09, 0.045, 0.04, 8, x, zf + 0.42));
  P.add('dark', box(0.62, 0.06, 0.55, -0.3, H + 0.03, zr - 0.55));
  P.add('dark', yTube(H, H + 1.8, 0.012, 0.006, 4, hw - 0.12, zr - 0.15));
  extinguisher(P, hw + 0.08, y0 - 0.12, zr - 0.18);
  // the doors: panel, window, handle, on their hinges at the front edge
  for (const s of [-1, 1]) {
    const dp = pivotAt(rig, rig.root, s < 0 ? 'doorL' : 'doorR', s * (hw + 0.012), 0, d0);
    const D = new Parts(rig.mats);
    D.add('camo', box(0.05, 1.66, d1 - d0 - 0.02, 0, 2.36, (d1 - d0) / 2));
    D.add('glass', box(0.06, 0.66, d1 - d0 - 0.22, 0, 2.78, (d1 - d0) / 2 + 0.03));
    D.add('rubber', box(0.062, 0.7, 0.03, 0, 2.78, 0.07));
    D.add('steel', rb(0.08, 0.05, 0.2, 0.02, s * 0.04, 2.25, d1 - d0 - 0.25));
    D.build(dp, { dirt: 0.4 });
  }
}

// Frame, the engine bay behind the cab with the spare wheel standing on its right and the exhaust,
// the axles and suspension (the wheels themselves are instanced, see spinWheels).
function chassis(P) {
  const { R, W, track, axles, body } = T22;
  for (const s of [-1, 1]) {
    P.add('dark', box(0.13, 0.36, 10.1, s * 0.5, 1.05, 0.15));
    P.add('dark', box(0.2, 0.03, 10.1, s * 0.48, 0.88, 0.15));
  }
  for (let z = -4.6; z < 5.0; z += 1.25) P.add('dark', box(1.0, 0.12, 0.1, 0, 1.05, z));
  axles.forEach((z, i) => {
    P.add('dark', xTube(-track + 0.42, track - 0.42, 0.08, 0.08, 10, R, z));
    P.add('dark', sphere(0.21, 0, R, z, 1, 0.9, 1.1, 10)); // differential
    for (const s of [-1, 1]) {
      P.add('dark', xTube(s * (track - W * 0.5 + 0.02), s * (track - W * 0.5 - 0.2), 0.15, 0.12, 12, R, z)); // hub reduction
      P.add('dark', box(0.1, 0.08, 0.95, s * 0.62, R + 0.32, z));
      P.add('dark', yTube(R + 0.05, R + 0.42, 0.05, 0.05, 8, s * 0.72, z + 0.22));
    }
    if (i < 2) P.add('dark', xTube(-track + 0.4, track - 0.4, 0.025, 0.025, 6, R - 0.05, z - 0.36));
  });
  for (let i = 0; i < 3; i++) P.add('dark', zTube(axles[i] + 0.25, axles[i + 1] - 0.25, 0.05, 0.05, 8, 0, R + 0.1));
  // mudguards: a flat guard over each axle pair, flaps behind
  for (const s of [-1, 1]) {
    for (const [a, b] of [[axles[0], axles[1]], [axles[2], axles[3]]]) {
      const x = s * track;
      if (a < -3) {
        P.add('camo', box(W + 0.18, 0.05, b - a + 0.6, x, 1.43, (a + b) / 2 + 0.25));
      } else {
        P.add('camo', box(W + 0.18, 0.05, b - a + 1.45, x, R * 2 + 0.12, (a + b) / 2));
        P.add('camo', box(0.04, 0.24, b - a + 1.45, x + s * (W / 2 + 0.07), R * 2 + 0.0, (a + b) / 2));
      }
      mudFlap(P, x, R * 1.9, b + R + 0.15, W + 0.14, R * 1.15);
    }
  }
  // engine bay: the cowl over the engine, intake and the radiator grille panels on its sides
  const ez0 = T22.cab.zr + 0.05, ez1 = body.z0 - 0.05;
  P.add('camo', rb(1.72, 1.15, ez1 - ez0, 0.06, -0.1, 1.95, (ez0 + ez1) / 2));
  for (const s of [-1, 1]) for (let i = 0; i < 7; i++) P.add('dark', box(0.03, 0.62, 0.035, s * 0.77 - 0.1, 1.95, ez0 + 0.3 + i * 0.13));
  P.add('dark', box(1.0, 0.05, 0.9, -0.25, 2.55, (ez0 + ez1) / 2)); // top hatch
  // the spare wheel standing on the right of the bay (axis across), on its cradle with a winch
  const sz = T22.front + 2.55;
  P.add('tyre', lugTyre(0.6, 0.46, 16, 40).applyMatrix4(xf(1.0, 2.46, sz)));
  discHub(P, 1.0, 2.46, sz, 1, 0.6, 0.46);
  P.add('dark', box(0.62, 0.08, 1.2, 0.95, 1.76, sz));
  P.add('dark', rod(V(0.7, 1.8, sz - 0.55), V(0.7, 3.05, sz - 0.05), 0.04, 6));
  P.add('dark', rod(V(0.7, 1.8, sz + 0.55), V(0.7, 3.05, sz + 0.05), 0.04, 6));
  // exhaust: up behind the cab on the right with a guard and a cap; the air cleaner on the left
  P.add('dark', yTube(1.4, 3.7, 0.075, 0.075, 10, 1.05, ez0 + 0.12));
  P.add('rust', yTube(3.7, 3.82, 0.085, 0.08, 10, 1.05, ez0 + 0.12));
  P.add('steel', yTube(2.6, 3.3, 0.11, 0.11, 10, 1.05, ez0 + 0.12, true));
  P.add('camo', yTube(1.9, 2.75, 0.24, 0.24, 14, -1.0, ez0 + 0.35));
  P.add('dark', yTube(2.75, 2.85, 0.26, 0.2, 14, -1.0, ez0 + 0.35));
  // fuel tank and battery box under the bay on the left, tool box on the right
  P.add('camo', zTube(ez0 + 0.15, ez1 - 0.3, 0.3, 0.3, 14, -0.92, 1.12));
  P.add('camo', rb(0.55, 0.45, 0.8, 0.03, 0.95, 1.2, ez0 + 0.65));
  // the platform behind the cab: a chequer plate deck with a rail
  P.add('dark', box(2.3, 0.05, 0.6, 0, 2.6, ez1 - 0.25));
  for (const s of [-1, 1]) P.add('steel', rod(V(s * 1.15, 2.6, ez1 - 0.5), V(s * 1.15, 3.35, ez1 - 0.5), 0.02, 5));
  P.add('steel', xTube(-1.15, 1.15, 0.02, 0.02, 5, 3.35, ez1 - 0.5));
}

// The body: lockers down both sides, the deck, the rear face with its two round holes, the ladder up
// the middle, lamps and the plate; the outrigger housings.
function body(P) {
  const { deck, rear, body: B } = T22, hw = B.hw, z0 = B.z0;
  const len = rear - z0, cz = (z0 + rear) / 2;
  P.add('camo', box(hw * 2, 0.08, len, 0, deck - 0.04, cz)); // deck plate
  P.add('camo', box(hw * 2 - 0.1, 0.95, len - 0.1, 0, deck - 0.52, cz)); // the box under it
  for (const s of [-1, 1]) {
    const x = s * hw;
    // lockers: four doors with hinges and latches, a rubbing strip under them
    const lz = [z0 + 0.2, 0.75, 2.05, 3.3, rear - 0.25];
    for (let i = 0; i < lz.length - 1; i++) {
      const a = lz[i] + 0.04, b = lz[i + 1] - 0.04;
      P.add('camo', box(0.04, 0.78, b - a, x + s * 0.01, deck - 0.5, (a + b) / 2));
      P.add('dark', box(0.05, 0.02, b - a, x + s * 0.01, deck - 0.1, (a + b) / 2));
      P.add('steel', box(0.03, 0.05, 0.14, x + s * 0.035, deck - 0.5, b - 0.15));
      for (const yy of [deck - 0.25, deck - 0.75]) P.add('dark', box(0.04, 0.08, 0.05, x + s * 0.03, yy, a + 0.08));
      P.add('white', box(0.01, 0.06, 0.24, x + s * 0.035, deck - 0.22, (a + b) / 2), { tint: 0x9a9a8a });
    }
    P.add('dark', box(0.06, 0.07, len, x + s * 0.02, deck - 0.98, cz));
    // the rail along the deck edge
    for (let z = z0 + 0.3; z < rear - 0.6; z += 1.5) P.add('steel', yTube(deck, deck + 0.5, 0.018, 0.018, 5, x - s * 0.05, z));
    P.add('steel', zTube(z0 + 0.3, rear - 2.6, 0.018, 0.018, 5, x - s * 0.05, deck + 0.5));
  }
  // the rear face: a plain panel from the bumper up to the deck, two round holes, the ladder
  const zr = rear;
  P.add('camo', box(hw * 2, 1.3, 0.06, 0, deck - 0.65, zr - 0.03));
  for (const s of [-1, 1]) {
    P.add('dark', zTube(zr - 0.02, zr + 0.005, 0.125, 0.125, 18, s * 1.02, deck - 0.23));
    P.add('camo', zTube(zr - 0.02, zr + 0.02, 0.15, 0.15, 18, s * 1.02, deck - 0.23, true));
    P.add('dark', zTube(zr - 0.02, zr + 0.005, 0.07, 0.07, 14, s * 0.47, deck - 0.18)); // small hole
    P.add('camo', box(0.82, 0.5, 0.03, s * 0.66, 1.31, zr + 0.01)); // lower lockers
    P.add('dark', box(0.84, 0.02, 0.03, s * 0.66, 1.57, zr + 0.015));
    addLamp(P, s * 1.07, deck - 0.66, zr + 0.08, 0.2, 0.08, 0.06, 'red');
    addLamp(P, s * 0.86, deck - 0.66, zr + 0.08, 0.1, 0.08, 0.06, 'amber');
    for (const x of [0.27, 1.06]) { // tow eyes with their red and white reflector strips
      P.add('white', box(0.05, 0.2, 0.02, s * x, deck - 0.38, zr + 0.02), { tint: 0xeeeeee });
      P.add('red', box(0.05, 0.08, 0.025, s * x, deck - 0.44, zr + 0.022));
      P.add('dark', box(0.1, 0.1, 0.06, s * x, deck - 0.24, zr + 0.03));
    }
  }
  ladder(P, 0, zr + 0.06, 0.55, deck + 0.05, 0.36, 'camo');
  P.add('dark', box(0.52, 0.13, 0.02, -0.88, 0.93, zr + 0.02));
  P.add('white', box(0.48, 0.1, 0.01, -0.88, 0.93, zr + 0.03), { tint: 0x8a8a8a });
  P.add('dark', box(hw * 2, 0.16, 0.12, 0, 0.82, zr - 0.02)); // rear cross member
  P.add('steel', zTube(zr - 0.1, zr + 0.18, 0.06, 0.06, 10, 0, 0.82)); // pintle
  // the turntable plinth on the rear deck
  const { turntable: tt } = T22;
  P.add('dark', yTube(deck, tt.y + 0.18, 0.78, 0.78, 24, 0, tt.z));
  P.add('camo', box(1.9, 0.1, 1.9, 0, deck + 0.02, tt.z));
}

// ---------------------------------------------------------------- outriggers

// Four outriggers. Each: a box arm hinged at its housing that swings out (rear pair out and back at
// 45 degrees, front pair straight out behind the cab), a screw jack at its end in a bellows boot, and a
// round pad; the jack's foot reaches the ground at v = 1.
function outriggers(rig) {
  const { rear, body: B } = T22;
  // (yaw: the arm runs along -Z at 0; + turns it toward -X)
  const defs = [
    { x: -B.hw + 0.05, z: rear - 0.2, y: 0.95, len: 2.05, out: 2.36, stow: 0 }, // rear left: stowed forward along the side
    { x: B.hw - 0.05, z: rear - 0.2, y: 0.95, len: 2.05, out: -2.36, stow: 0 },
    { x: -B.hw + 0.02, z: -1.6, y: 1.0, len: 1.85, out: 1.57, stow: Math.PI }, // front left: stowed back between the axles
    { x: B.hw - 0.02, z: -1.6, y: 1.0, len: 1.85, out: -1.57, stow: -Math.PI },
  ];
  // arm yaw: rotation.y of a group whose arm runs along -Z from the hinge (0 = forward)
  const list = defs.map((d) => {
    const g = pivotAt(rig, rig.root, 'outrigger' + rig.outriggers.length, d.x, d.y, d.z);
    delete rig.pivots[g.name];
    const P = new Parts(rig.mats);
    const L = d.len;
    // the arm: a tapered box beam bent down near its end, the hinge knuckle
    P.add('camo', rod(V(0, 0.05, 0), V(0, -0.05, -L + 0.25), 0.11, 6));
    P.add('camo', box(0.2, 0.26, L - 0.2, 0, 0, -(L - 0.2) / 2));
    P.add('dark', yTube(-0.18, 0.18, 0.1, 0.1, 10, 0, 0));
    // the jack housing at the end
    P.add('camo', yTube(-0.25, 0.32, 0.12, 0.12, 12, 0, -L));
    P.add('dark', yTube(0.32, 0.4, 0.14, 0.1, 12, 0, -L));
    P.add('steel', box(0.06, 0.08, 0.18, 0.13, 0.25, -L)); // the crank
    P.build(g, { dirt: 0.5, y0: d.y });
    // the jack under the housing: the pad and ball foot (moves down), the bellows boot between them
    // (squashed and stretched to fit)
    const leg = new THREE.Group();
    leg.position.set(0, -0.25, -L);
    g.add(leg);
    const Q = new Parts(rig.mats);
    Q.add('dark', sphere(0.08, 0, 0.1, 0, 1, 0.7, 1, 8));
    Q.add('dark', yTube(0.0, 0.05, 0.27, 0.25, 18, 0, 0));
    Q.add('dark', yTube(0.05, 0.09, 0.12, 0.09, 12, 0, 0));
    const foot = new THREE.Group();
    leg.add(foot);
    Q.build(foot, { dirt: 0.7, y0: 0 });
    const B = new Parts(rig.mats); // one metre of bellows, top at 0
    for (let i = 0; i < 9; i++) B.add('rubber', yTube(-0.06 - i * 0.105, -0.01 - i * 0.105, 0.105, 0.105, 12, 0, 0));
    B.add('steel', yTube(-1.0, 0, 0.045, 0.045, 8, 0, 0));
    const boot = new THREE.Group();
    leg.add(boot);
    B.build(boot, { dirt: 0.6, y0: 0.5 });
    return { g, foot, boot, d };
  });
  rig.outriggers.push(...list);
  rig.setOutriggers = (v) => {
    const swing = THREE.MathUtils.smoothstep(v, 0, 0.5), drop = THREE.MathUtils.smoothstep(v, 0.5, 1);
    for (const { g, foot, boot, d } of list) {
      g.rotation.y = d.stow + (d.out - d.stow) * swing;
      // stowed the pad is drawn up 0.3 m under the housing; down it stands on the ground (y 0 of the truck)
      const ground = -(d.y - 0.25);
      foot.position.y = -0.3 + (ground + 0.3) * drop;
      boot.scale.y = Math.max(0.05, -foot.position.y - 0.09);
    }
  };
  rig.setOutriggers(0);
}

// ---------------------------------------------------------------- crane

// Side plate of the column in its own frame (z back from the boom side, y up from the foot), the goose
// neck: the foot on the turntable, the plates sweeping back and up, then curving forward into the boom
// hinge at the top. Lightening holes along it.
function columnShape() {
  const { h, back } = T22.column;
  const s = new THREE.Shape();
  // outline as (z, y) with z = back positive; the shape is drawn in (x = z, y)
  const pts = COLUMN_OUT.concat(COLUMN_IN.slice().reverse());
  s.moveTo(pts[0][0], pts[0][1]);
  for (const [z, y] of pts.slice(1)) s.lineTo(z, y);
  s.closePath();
  for (const [z, y, r] of [[0.4, 0.6, 0.13], [0.74, 1.45, 0.14], [0.86, 2.25, 0.13], [0.84, 3.0, 0.13], [back + 0.06, h - 0.38, 0.1]]) {
    s.holes.push(new THREE.Path().absarc(z, y, r, 0, Math.PI * 2, true));
  }
  return s;
}

// the column's back (outer) and front (inner) edges, (z back from the axis, y up from the foot)
const COLUMN_OUT = [[-0.55, 0], [0.55, 0], [0.88, 0.55], [1.06, 1.5], [1.1, 2.55], [1.05, 3.35], [0.95, 3.95], [0.72, 4.3]];
const COLUMN_IN = [[-0.55, 0], [-0.2, 0.46], [0.36, 1.1], [0.58, 1.8], [0.64, 2.65], [0.58, 3.3], [0.42, 3.78], [0.32, 4.15]];

// The column: two pierced side plates 0.62 m apart, edge plates closing the box along its outline.
function column(P) {
  const shape = columnShape(), W2 = 0.31, t = 0.05;
  for (const sx of [-1, 1]) {
    const g = new THREE.ExtrudeGeometry(shape, { depth: t, bevelEnabled: false, curveSegments: 8 });
    // shape (x = back, y = up) extruded along +z: turn so shape x -> model +Z and extrusion -> +-X
    g.applyMatrix4(new THREE.Matrix4().makeRotationY(-Math.PI / 2));
    g.translate(sx > 0 ? W2 : -W2 + t, 0, 0);
    P.add('camo', g);
  }
  // edge plates along the front and back of the outline (between the side plates)
  for (const line of [COLUMN_IN, COLUMN_OUT.slice(1)]) {
    for (let i = 0; i < line.length - 1; i++) {
      const a = V(0, line[i][1], line[i][0]), b = V(0, line[i + 1][1], line[i + 1][0]);
      const d = b.clone().sub(a), len = d.length();
      const g = box(W2 * 2 - 0.02, 0.04, len + 0.02).applyMatrix4(new THREE.Matrix4().compose(a.clone().add(b).multiplyScalar(0.5), new THREE.Quaternion().setFromUnitVectors(V(0, 0, 1), d.normalize()), V(1, 1, 1)));
      P.add('camo', g);
    }
  }
  // the foot: a flanged box on the turntable, the hinge pin, the ram's lower lugs, the boom hinge cap
  P.add('camo', box(0.8, 0.3, 1.25, 0, 0.1, 0.0));
  P.add('dark', xTube(-0.45, 0.45, 0.09, 0.09, 12, 0, 0.0));
  P.add('dark', box(0.3, 0.22, 0.25, 0, 2.3, 0.62));
  P.add('dark', xTube(-0.36, 0.36, 0.13, 0.13, 14, T22.column.h, T22.column.back));
}

// The boom: a box beam with a row of round holes in each side, the hinge at its root and the head
// lug at its tip; built along -Z from the hinge.
function boom(P) {
  const L = T22.boom.L, h = 0.42, w = 0.36;
  const s = new THREE.Shape();
  s.moveTo(-0.25, -h / 2); s.lineTo(L + 0.18, -h / 2); s.lineTo(L + 0.18, h / 2 - 0.05); s.lineTo(L + 0.05, h / 2); s.lineTo(-0.25, h / 2); s.closePath();
  for (let k = 0; k < 12; k++) s.holes.push(new THREE.Path().absarc(0.55 + k * 0.42, 0.02, 0.085, 0, Math.PI * 2, true));
  for (const sx of [-1, 1]) {
    const g = new THREE.ExtrudeGeometry(s, { depth: 0.035, bevelEnabled: false, curveSegments: 8 });
    // shape x -> -Z (along the boom), y up, extrusion -> x
    g.applyMatrix4(new THREE.Matrix4().makeRotationY(Math.PI / 2));
    g.translate(sx > 0 ? w / 2 - 0.035 : -w / 2, 0, 0);
    P.add('camo', g);
  }
  P.add('camo', box(w, 0.035, L + 0.4, 0, h / 2 - 0.018, -L / 2 + 0.05));
  P.add('camo', box(w, 0.035, L + 0.4, 0, -h / 2 + 0.018, -L / 2 + 0.05));
  P.add('dark', xTube(-0.24, 0.24, 0.09, 0.09, 12, 0, 0)); // hinge
  P.add('dark', box(0.3, 0.18, 0.3, 0, -0.27, -1.9)); // ram lug
  P.add('white', box(0.005, 0.08, 0.5, w / 2 + 0.003, 0.11, -0.55), { tint: 0xbbbbbb }); // inspection stencil
  P.add('dark', xTube(-0.24, 0.24, 0.08, 0.08, 12, 0, -L)); // head pin
  // hydraulic and electric lines along the side
  P.add('steel', zTube(-0.1, -L + 0.2, 0.016, 0.016, 5, -w / 2 - 0.03, -0.12));
  P.add('rubber', zTube(-0.1, -L + 0.2, 0.02, 0.02, 5, -w / 2 - 0.03, 0.04));
}

// The head: the control box with its lamp on top, the swivel joint to the boom, and the sleeve of the
// telescopic post; then the post itself (moves), the rotator and the spreader (built separately).
function head(P) {
  const { up } = T22.head;
  P.add('camo', box(0.36, up + 0.1, 0.36, 0, up / 2 - 0.05, 0)); // upright through the boom tip
  P.add('camo', rb(0.6, 0.55, 0.62, 0.04, 0, up + 0.25, 0.05)); // control box
  P.add('dark', box(0.4, 0.3, 0.02, 0, up + 0.27, -0.27)); // its door
  P.add('lens', sphere(0.11, 0.16, up + 0.62, -0.08, 1, 1, 1, 10)); // the lamp
  P.add('dark', yTube(up + 0.52, up + 0.6, 0.06, 0.06, 8, 0.16, -0.08));
  P.add('dark', box(0.45, 0.2, 0.45, 0, -0.1, 0)); // swivel housing
  // the post's outer sleeve and the valve block with hoses
  P.add('camo', box(0.28, 0.75, 0.28, 0, -0.55, 0));
  P.add('dark', box(0.2, 0.3, 0.16, 0.24, -0.3, 0.05));
  P.add('rubber', rod(V(0.24, -0.15, 0.1), V(0.12, 0.3, 0.16), 0.022, 5));
  P.add('rubber', rod(V(0.26, -0.45, 0.1), V(0.18, -0.85, 0.2), 0.022, 5));
}

// The inner post (slides in the sleeve; position.y of cranePost moves it) and the rotator ring.
function postInner(P) {
  const r = T22.head.rot;
  P.add('steel', box(0.2, 0.9, 0.2, 0, 0.1, 0));
  P.add('dark', box(0.32, 0.1, 0.32, 0, -r + 0.13, 0));
  P.add('dark', yTube(-r, -r + 0.13, 0.24, 0.24, 18, 0, 0)); // rotator ring
}

// The spreader under the rotator: two long beams over the canisters (along Z) on a centre cross box,
// clamp legs down at their ends with chains, built with the rotator plate at y 0.
function spreader(P) {
  const { L, gap, drop } = T22.spreader;
  const y = -drop;
  P.add('camo', box(gap + 0.5, 0.26, 0.55, 0, y + 0.05, 0)); // cross box
  P.add('dark', box(0.22, 0.12, 0.22, 0, -0.06, 0)); // hanger
  P.add('camo', box(0.2, drop - 0.12, 0.3, 0, -drop / 2 + 0.02, 0));
  for (const s of [-1, 1]) {
    const x = s * gap / 2;
    P.add('camo', box(0.16, 0.2, L, x, y, 0));
    P.add('camo', box(0.06, 0.06, L - 0.4, x - s * 0.13, y + 0.08, 0)); // stiffener
    // at each end an arm out over the canister's flank and a leg down it to a clamp at the axis
    const lx = x + s * 0.6, ld = T22.spreader.load;
    for (const e of [-1, 1]) {
      const z = e * (L / 2 - 0.15);
      P.add('camo', box(0.62, 0.14, 0.16, x + s * 0.3, y, z)); // arm
      P.add('camo', box(0.1, ld + 0.12, 0.16, lx, y - ld / 2 - 0.02, z)); // leg
      P.add('dark', box(0.1, 0.22, 0.3, lx - s * 0.07, y - ld, z)); // clamp jaw
      for (let k = 0; k < 4; k++) P.add('steel', new THREE.TorusGeometry(0.035, 0.009, 4, 8).applyMatrix4(xf(lx + s * 0.08, y - 0.12 - k * 0.07, z - e * 0.1, 0, k % 2 ? Math.PI / 2 : 0, 0)));
    }
    // valve blocks and hoses along the beams
    P.add('dark', box(0.12, 0.12, 0.3, x, y + 0.16, s * 0.6));
    P.add('rubber', zTube(-L / 2 + 0.3, L / 2 - 0.3, 0.018, 0.018, 5, x + s * 0.1, y + 0.1));
  }
}

function crane(rig) {
  const { mats, root } = rig;
  const { turntable: tt, column: C, boom: B, head: Hd } = T22;
  const slew = pivotAt(rig, root, 'crane', 0, tt.y + 0.18, tt.z);
  const T = new Parts(mats);
  T.add('camo', yTube(0, 0.14, 0.72, 0.72, 24, 0, 0)); // the slewing ring
  T.add('dark', box(0.5, 0.3, 0.4, -0.55, 0.25, 0.55)); // slewing drive
  T.add('camo', rb(0.62, 0.62, 0.5, 0.04, 0.55, 0.42, 0.6)); // the operator's control cabinet
  T.add('dark', box(0.45, 0.4, 0.02, 0.55, 0.45, 0.86));
  T.build(slew, { dirt: 0.3, y0: tt.y + 0.18 });
  const col = pivotAt(rig, slew, 'craneColumn', 0, C.pivot, 0);
  const CP = new Parts(mats);
  column(CP);
  CP.build(col, { dirt: 0.25, y0: tt.y + 0.5 });
  const bm = pivotAt(rig, col, 'craneBoom', 0, C.h, C.back);
  const BP = new Parts(mats);
  boom(BP);
  BP.build(bm, { dirt: 0.1, y0: 5 });
  const hd = pivotAt(rig, bm, 'craneHead', 0, 0, -B.L);
  const HP = new Parts(mats);
  head(HP);
  HP.build(hd, { dirt: 0.1, y0: 5 });
  const post = pivotAt(rig, hd, 'cranePost', 0, -T22.post.min, 0);
  const PP = new Parts(mats);
  postInner(PP);
  PP.build(post, { dirt: 0.05, y0: 4 });
  const rot = pivotAt(rig, post, 'craneRotator', 0, -Hd.rot, 0);
  const SP = new Parts(mats);
  spreader(SP);
  SP.build(rot, { dirt: 0.2, y0: 3 });
  rig.anchors.craneLoad = node(rot, 'craneLoad', 0, -T22.spreader.drop - T22.spreader.load, 0);
  // the luffing ram: barrel from the column's lug to the boom's lug, posed in setCrane
  const barrel = new THREE.Group(), ram = new THREE.Group();
  col.add(barrel, ram);
  const Rb = new Parts(mats), Rr = new Parts(mats);
  Rb.add('camo', zTube(0, -1.6, 0.12, 0.12, 14, 0, 0));
  Rb.add('dark', zTube(0.12, -0.05, 0.13, 0.13, 12, 0, 0));
  Rr.add('steel', zTube(0, -1.75, 0.07, 0.07, 12, 0, 0));
  Rr.add('dark', zTube(0.1, -0.08, 0.1, 0.1, 12, 0, 0));
  Rb.build(barrel, { dirt: 0.2, y0: 4 });
  Rr.build(ram, { dirt: 0.1, y0: 4 });
  const A = V(0, 2.3, 0.6); // ram foot on the column (column space)
  const B0 = V(0, -0.27, -1.9); // ram head on the boom (boom space)
  const Bp = new THREE.Vector3();
  const st = { slew: 0, column: 0, boom: 0, post: T22.post.min, rotate: 0 };
  rig.crane = st;
  rig.setCrane = (o = {}) => {
    Object.assign(st, o);
    slew.rotation.y = st.slew;
    col.rotation.x = st.column;
    bm.rotation.x = st.boom;
    hd.rotation.x = -(st.column + st.boom);
    post.position.y = -Math.min(T22.post.max, Math.max(T22.post.min, st.post));
    rot.rotation.y = st.rotate;
    Bp.copy(B0).applyAxisAngle(V(1, 0, 0), st.boom).add(bm.position);
    const dy = Bp.y - A.y, dz = Bp.z - A.z, d = Math.hypot(dy, dz);
    barrel.position.copy(A);
    barrel.rotation.x = Math.atan2(dy, -dz);
    ram.position.copy(Bp);
    ram.rotation.x = Math.atan2(-dy, dz);
    // folded for travel the ram closes up shorter than its barrel: shorten both so nothing pokes through
    barrel.scale.z = Math.min(1, Math.max(0.2, (d - 0.12) / 1.6));
    ram.scale.z = Math.min(1, Math.max(0.2, d / 1.75));
  };
  // The solver: the column and the boom are a two-link arm in the slew plane (reach u forward of the
  // axis, height y). The column foot to the boom hinge is Lc long at PHI0 + column from the +u axis;
  // the boom points at column + boom. The load hangs `below` under the boom tip plus the post.
  const below = Hd.rot + T22.spreader.drop + T22.spreader.load; // rotator under the post, rotator to beams, beams to anchor
  const footY = tt.y + 0.18 + C.pivot;
  const Lc = Math.hypot(C.h, C.back), PHI0 = Math.atan2(C.h, -C.back), Lb = B.L;
  rig.solveCrane = (p, yaw, out = {}, post = T22.post.min) => {
    const dx = p.x, dz = p.z - tt.z;
    const u = Math.hypot(dx, dz), y = p.y + below + post - footY;
    out.slew = Math.atan2(-dx, -dz);
    let D = Math.hypot(u, y);
    out.ok = D <= Lc + Lb - 0.05 && D >= Math.abs(Lb - Lc) + 0.05;
    D = Math.min(Lc + Lb - 0.05, Math.max(Math.abs(Lb - Lc) + 0.05, D));
    // elbow up: the hinge above the line from the foot to the tip
    const a = Math.atan2(y, u), k = Math.acos(Math.min(1, Math.max(-1, (Lc * Lc + D * D - Lb * Lb) / (2 * Lc * D))));
    const phi1 = a + k;
    const hx = Lc * Math.cos(phi1), hy = Lc * Math.sin(phi1);
    const phi2 = Math.atan2(D * Math.sin(a) - hy, D * Math.cos(a) - hx);
    out.column = phi1 - PHI0;
    out.boom = phi2 - out.column;
    out.post = post;
    out.rotate = yaw - out.slew;
    return out;
  };
  // the travel pose: slewed to face the rear (u runs back along the truck), the boom tip over the rear
  // deck (TRAVEL_TIP) so the spreader lies across it; the column laid back (the hinge toward the cab),
  // the boom coming back over it
  {
    const u = TRAVEL_TIP.z - tt.z, y = TRAVEL_TIP.y - footY, D = Math.hypot(u, y);
    const a = Math.atan2(y, u), k = Math.acos((Lc * Lc + D * D - Lb * Lb) / (2 * Lc * D));
    const phi1 = a + k, hx = Lc * Math.cos(phi1), hy = Lc * Math.sin(phi1);
    TRAVEL.column = phi1 - PHI0;
    TRAVEL.boom = Math.atan2(y - hy, u - hx) - TRAVEL.column;
  }
}

// ---------------------------------------------------------------- the rig

// where the boom tip rests for travel: the spreader's beams just on the deck
const TRAVEL_TIP = { z: 4.3, y: T22.deck + 0.1 + T22.spreader.drop + T22.head.rot + TRAVEL.post };

export function build22T6() {
  const rig = newRig('green');
  const { P, root, mats } = rig;
  rig.outriggers = [];
  cab(P, rig);
  chassis(P);
  body(P);
  P.build(root, { dirt: 0.55 });
  outriggers(rig);
  crane(rig);
  rig.craneTravel = { ...TRAVEL };
  rig.setCrane(TRAVEL);
  const wheels = spinWheels(root, mats, T22.axles.flatMap((z, i) => [-1, 1].map((s) => ({ x: s * T22.track, y: T22.R, z, steer: i === 0 ? 1 : i === 1 ? 0.6 : 0 }))), T22.R, heavyWheel(T22.W));
  rig.setWheels = wheels.set;
  rig.wheelR = T22.R;
  rig.axles = T22.axles;
  rig.wheelbase = (T22.axles[2] + T22.axles[3]) / 2 - (T22.axles[0] + T22.axles[1]) / 2;
  rig.anchors.eye = node(root, 'eye', 0, 2.4, 0);
  rig.anchors.cabDoorL = node(root, 'cabDoorL', -T22.cab.w / 2 - 0.55, 0, T22.cab.zf + 0.7);
  rig.anchors.cabDoorR = node(root, 'cabDoorR', T22.cab.w / 2 + 0.55, 0, T22.cab.zf + 0.7);
  rig.anchors.operator = node(root, 'operator', 1.75, 0, T22.rear + 0.5);
  hb(rig, -1.3, 0, T22.front, 1.3, 3.5, T22.rear);
  return rig;
}
