import * as THREE from 'three';
import { V, xf, box, yTube, zTube, xTube, rod, dish, mudguard } from '../kit.js';
import { jack, ladder, whip, hose, rearEnd } from '../trucks.js';
import { newRig, node, hb } from '../rig.js';
import { rb, heavyGear, ladderFrame, flatCab } from './ural.js';

// 55K6E command post on the Ural-532301 8x8, deployed (refs/s400-support photo 1, 2017): a tall,
// long, flat-fronted crew cab (three-pane windscreen, two doors a side, the front axle under its
// rear section), a deep bumper box high over a sloped skid plate with tow ropes looped across it;
// behind, a KUNG equipment body a little taller than the cab with horizontal ribs along its sides,
// small windows, roof whips and a small dish; at its rear a lattice mast section and a telescopic
// pole carrying a log-periodic antenna and a discone, and a stair platform at the rear door.
// Built in vehicle z from the cab face (0) back; the group is shifted to centre the truck.

const OFF = -4.6; // model z of the cab face
const R = 0.69, W = 0.47, TRACK = 1.04; // 14.00-20 class tyres, 1.38 m
const AX = [2.3, 3.85, 5.95, 7.45];
const FRAME = 1.22; // top of the frame rails
const BODY = { z0: 3.15, z1: 9.35, y0: 1.36, top: 3.37, hw: 1.27 };
const MAST = { x: -0.62, z: 9.62, y0: 2.3, lat: 3.75, rot: 4.55, top: 6.9 };

// Log-periodic dipole array in a vertical plane (photo 1): a dark boom along z with vertical
// element pairs that lengthen toward its back, clamped to the pole at its middle.
function lpda(P, x, y, z, len = 1.7, n = 15) {
  P.add('dark', zTube(z - len / 2, z + len / 2, 0.035, 0.03, 8, x, y));
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1), zz = z - len / 2 + 0.05 + t * (len - 0.1), half = 0.14 + t * 0.5;
    P.add('steel', yTube(y - half, y + half, 0.007, 0.007, 3, x, zz));
  }
  P.add('dark', box(0.1, 0.16, 0.12, x, y, z));
}

export function buildCP() {
  const rig = newRig('green'), { P, root } = rig;
  const g = new THREE.Group();
  g.position.z = OFF;
  root.add(g);

  // ---------------------------------------------------------------- chassis and cab
  heavyGear(P, { axles: AX, R, W, track: TRACK, steered: 2 });
  ladderFrame(P, 0.5, 9.3, FRAME, 0.48);
  const cab = flatCab(P, { zf: 0, len: 3.0, w: 2.5, H: 3.17, y0: 1.3, zA: AX[0], R, glass: [2.12, 2.95], doorZ: [0.2, 1.05], sideWin: [[1.2, 1.85], [2.12, 2.72]], bumperY: [1.17, 1.86], bumperD: 0.6, bumperKey: 'camo' });
  // second door behind the first, a grab rail up the cab's back corner, horns, whip, roof hatch
  for (const s of [-1, 1]) {
    const x = s * (cab.hw + 0.004);
    P.add('dark', box(0.03, 1.6, 0.025, x, 2.15, 1.98));
    P.add('dark', box(0.03, 0.025, 0.9, x, 2.94, 1.52));
    P.add('steel', rb(0.06, 0.05, 0.2, 0.02, s * (cab.hw + 0.03), 1.92, 1.78));
    P.add('steel', rod(V(s * (cab.hw + 0.06), 1.6, 2.95), V(s * (cab.hw + 0.06), 2.95, 2.95), 0.018, 5));
    P.add('camo', mudguard(R, W + 0.12, s * TRACK, R, AX[1], 15, 175, 0.08, 0.04));
  }
  whip(P, 1.05, cab.top, 0.35, 3.0);
  P.add('dark', box(0.8, 0.07, 0.8, -0.3, cab.top + 0.035, 1.6));
  P.add('steel', zTube(2.5, 2.8, 0.05, 0.06, 8, 0.7, cab.top + 0.06));
  // tow ropes looped across the bumper front, a tow pin
  for (const [y, k] of [[1.68, 0.18], [1.52, 0.22]]) hose(P, V(-1.1, y + 0.08, -0.62), V(0.95, y, -0.62), k, 0.03, 'steel', 6);
  P.add('steel', zTube(-0.72, -0.6, 0.05, 0.05, 8, 0, 1.28));
  // engine and transfer under the body front, fuel tank, battery and tool boxes, exhaust
  P.add('dark', box(0.9, 0.7, 1.4, 0, 1.0, 3.6));
  P.add('camo', zTube(4.6, 5.25, 0.27, 0.27, 14, 1.0, 1.0));
  P.add('camo', rb(0.45, 0.5, 0.65, 0.03, -1.0, 1.0, 4.9));
  P.add('dark', yTube(1.4, 3.6, 0.075, 0.075, 8, -1.12, 3.07)); // exhaust up behind the cab
  P.add('dark', yTube(3.6, 3.7, 0.075, 0.06, 8, -1.12, 3.07));
  rearEnd(P, 9.38, 2.3, 0.95);
  for (const s of [-1, 1]) P.add('camo', box(W + 0.16, 0.05, AX[3] - AX[2] + 1.75, s * TRACK, 1.42, (AX[2] + AX[3]) / 2)); // bogie fenders under the body

  // ---------------------------------------------------------------- KUNG body
  const { z0, z1, y0, top, hw } = BODY, bl = z1 - z0, bc = (z0 + z1) / 2, bh = top - y0;
  P.add('camo', rb(hw * 2, bh, bl, 0.06, 0, y0 + bh / 2, bc));
  P.add('dark', box(hw * 2 + 0.04, 0.12, bl + 0.04, 0, y0 + 0.04, bc)); // floor sill
  P.add('camo', box(hw * 2 + 0.06, 0.06, bl + 0.06, 0, top - 0.03, bc)); // roof edge
  for (const s of [-1, 1]) {
    const x = s * (hw + 0.004);
    // horizontal ribs along the sides (photo 1), vertical corner posts
    // (over the lower half, broken on the right side by the door)
    const runs = s > 0 ? [[z0 + 0.15, z0 + 1.9], [z0 + 2.9, z1 - 0.15]] : [[z0 + 0.15, z1 - 0.15]];
    for (let i = 0; i < 4; i++) for (const [ra, rz] of runs) {
      P.add('camo', box(0.1, 0.06, rz - ra, s * (hw + 0.05), y0 + 0.28 + i * 0.27, (ra + rz) / 2));
      P.add('dark', box(0.02, 0.02, rz - ra, s * (hw + 0.01), y0 + 0.24 + i * 0.27, (ra + rz) / 2)); // shadow line under the rib
    }
    for (const z of [z0 + 0.06, z1 - 0.06]) P.add('camo', box(0.07, bh, 0.1, s * (hw + 0.02), y0 + bh / 2, z));
    // two small windows high up under rain hoods, filter-vent grilles, cable ports
    for (const z of [z0 + 1.6, z1 - 1.8]) {
      P.add('dark', box(0.04, 0.5, 0.62, x + s * 0.01, top - 0.45, z));
      P.add('glass', box(0.03, 0.4, 0.52, x + s * 0.025, top - 0.45, z));
      P.add('camo', box(0.1, 0.05, 0.7, x + s * 0.05, top - 0.17, z)); // rain hood
    }
    P.add('dark', box(0.04, 0.4, 0.5, x + s * 0.03, y0 + 1.62, z0 + 0.7));
    for (let k = 0; k < 4; k++) P.add('steel', box(0.05, 0.02, 0.44, x + s * 0.05, y0 + 1.47 + k * 0.1, z0 + 0.7));
    for (let k = 0; k < 3; k++) P.add('dark', xTube(s * hw, s * (hw + 0.1), 0.06, 0.06, 8, y0 + 0.4, z1 - 0.9 - k * 0.25));
    P.add('white', box(0.01, 0.25, 0.08, x + s * 0.01, top - 0.55, bc + 0.5), { tint: 0xd8d8d0 }); // a small cross marking
    P.add('white', box(0.01, 0.08, 0.25, x + s * 0.01, top - 0.55, bc + 0.5), { tint: 0xd8d8d0 });
    // ground jacks at the body corners, the front pair on short outriggers clear of the wheels
    P.add('dark', box(1.05, 0.18, 0.2, s * 1.02, 1.22, z0 + 0.15));
    jack(P, s * 1.55, z0 + 0.15, 1.25);
    P.add('dark', box(0.3, 0.2, 0.3, s * (hw - 0.05), y0 - 0.2, z1 - 0.35));
    jack(P, s * (hw - 0.05), z1 - 0.35, y0 - 0.25);
  }
  // right side door with fold-down steps
  P.add('dark', box(0.03, 1.79, 0.89, hw + 0.004, y0 + 0.92, z0 + 2.4));
  P.add('camo', box(0.04, 1.73, 0.83, hw + 0.012, y0 + 0.92, z0 + 2.4));
  P.add('steel', box(0.05, 0.14, 0.05, hw + 0.04, y0 + 0.95, z0 + 2.72));
  for (let k = 0; k < 3; k++) P.add('steel', box(0.45, 0.04, 0.7, hw + 0.25 + k * 0.0, y0 - 0.3 - k * 0.33, z0 + 2.4));
  P.add('steel', box(0.04, 1.1, 0.04, hw + 0.47, y0 - 0.3, z0 + 2.05));
  P.add('steel', box(0.04, 1.1, 0.04, hw + 0.47, y0 - 0.3, z0 + 2.75));
  // front wall: filter-ventilation unit and a cable reel
  P.add('camo', rb(1.2, 0.7, 0.35, 0.04, 0.45, top - 0.6, z0 - 0.15));
  for (let k = 0; k < 5; k++) P.add('dark', box(1.0, 0.03, 0.02, 0.45, top - 0.85 + k * 0.12, z0 - 0.33));
  // rear wall: door, rear lights, the stair platform with railings and steps down
  P.add('dark', box(0.94, 1.84, 0.03, 0.5, y0 + 0.95, z1 + 0.004));
  P.add('camo', box(0.88, 1.78, 0.04, 0.5, y0 + 0.95, z1 + 0.012));
  P.add('steel', box(0.06, 0.15, 0.05, 0.15, y0 + 0.95, z1 + 0.04));
  const pz0 = z1 + 0.05, pz1 = z1 + 1.35, px0 = -0.05, px1 = 1.25, py = y0 + 0.02;
  P.add('steel', box(px1 - px0, 0.05, pz1 - pz0, (px0 + px1) / 2, py, (pz0 + pz1) / 2));
  for (const [x, z] of [[px0, pz0 + 0.1], [px1, pz0 + 0.1], [px0, pz1], [px1, pz1]]) P.add('dark', yTube(0, py, 0.035, 0.035, 6, x, z));
  for (const x of [px0, px1]) {
    P.add('steel', yTube(py, py + 1.0, 0.02, 0.02, 5, x, pz0 + 0.1));
    P.add('steel', yTube(py, py + 1.0, 0.02, 0.02, 5, x, pz1 - 0.05));
    P.add('steel', zTube(pz0 + 0.1, pz1 - 0.05, 0.02, 0.02, 5, x, py + 1.0));
    P.add('steel', zTube(pz0 + 0.1, pz1 - 0.05, 0.016, 0.016, 5, x, py + 0.5));
  }
  // stairs down from the platform's rear edge
  const sx0 = 0.12, sx1 = 1.08, run = 1.5, steps = 5;
  for (const x of [sx0, sx1]) {
    P.add('dark', rod(V(x, py, pz1), V(x, 0.02, pz1 + run), 0.04, 5));
    P.add('steel', rod(V(x, py + 0.95, pz1), V(x, 0.95, pz1 + run), 0.02, 5));
  }
  for (let k = 1; k <= steps; k++) {
    const t = k / (steps + 1);
    P.add('steel', box(sx1 - sx0, 0.035, 0.24, (sx0 + sx1) / 2, py * (1 - t), pz1 + run * t));
  }
  // the ground-cable cabinet standing beside the body
  P.add('white', rb(0.6, 1.25, 0.45, 0.02, hw + 1.6, 0.66, z1 - 1.6), { tint: 0x9a9e98 });
  P.add('dark', box(0.03, 1.1, 0.4, hw + 1.6 - 0.31, 0.68, z1 - 1.6));
  P.add('dark', box(0.7, 0.05, 0.55, hw + 1.6, 1.3, z1 - 1.6));
  hose(P, V(hw + 1.3, 0.3, z1 - 1.6), V(hw + 0.02, y0 + 0.4, z1 - 1.15), 0.5, 0.025, 'rubber', 5);
  // roof: air conditioner, cable tray, satellite dish on a stub, whips along the edges
  P.add('camo', rb(1.1, 0.42, 1.2, 0.04, -0.45, top + 0.21, z0 + 1.0));
  for (let k = 0; k < 6; k++) P.add('dark', box(0.9, 0.3, 0.02, -0.45, top + 0.22, z0 + 0.5 + k * 0.2));
  P.add('dark', box(0.25, 0.07, bl - 2.0, 0.75, top + 0.035, bc + 0.6));
  P.add('dark', yTube(top, top + 0.55, 0.05, 0.05, 8, 0.75, z0 + 0.8));
  P.add('dark', box(0.25, 0.12, 0.25, 0.75, top + 0.6, z0 + 0.8));
  P.add('white', dish(0.3, 0.1, 0.025, 18).applyMatrix4(xf(0.75, top + 0.8, z0 + 0.74, -0.6, 0.5, 0)));
  P.add('dark', rod(V(0.75, top + 0.68, z0 + 0.78), V(0.82, top + 1.0, z0 + 0.5), 0.012, 4));
  for (const [x, z, h] of [[1.1, z0 + 2.6, 3.0], [-1.1, z0 + 3.4, 2.6], [1.1, z1 - 1.3, 3.4]]) whip(P, x, top, z, h, 0.014);
  ladder(P, -1.06, z1 + 0.07, y0 - 0.9, top + 0.4, 0.36);

  // ---------------------------------------------------------------- antenna mast at the rear
  const { x: mx, z: mz, y0: m0, lat, top: mt } = MAST;
  for (const y of [m0 + 0.2, lat - 0.25]) P.add('dark', box(0.3, 0.1, 0.32, mx, y, mz - 0.18)); // brackets to the rear wall
  const lw = 0.32;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) P.add('camo', yTube(m0, lat, 0.025, 0.025, 5, mx + sx * lw / 2, mz + sz * lw / 2));
  for (let y = m0 + 0.1; y < lat - 0.2; y += 0.36) for (const f of [-1, 1]) {
    P.add('camo', rod(V(mx - lw / 2, y, mz + f * lw / 2), V(mx + lw / 2, y + 0.36, mz + f * lw / 2), 0.012, 4));
    P.add('camo', rod(V(mx + f * lw / 2, y, mz - lw / 2), V(mx + f * lw / 2, y + 0.36, mz + lw / 2), 0.012, 4));
  }
  P.add('dark', box(lw + 0.1, 0.12, lw + 0.1, mx, lat, mz));
  // telescopic pole (pale), the rotator with its red obstruction lamp, the LPDA and a discone on top
  const rot = MAST.rot;
  P.add('steel', yTube(lat, rot, 0.07, 0.07, 10, mx, mz));
  P.add('dark', rb(0.3, 0.36, 0.3, 0.03, mx, rot + 0.18, mz));
  for (let k = 0; k < 3; k++) P.add('steel', box(0.32, 0.02, 0.32, mx, rot + 0.08 + k * 0.1, mz));
  P.add('red', box(0.07, 0.07, 0.07, mx + 0.17, rot + 0.3, mz));
  P.add('steel', yTube(rot + 0.36, mt - 0.5, 0.05, 0.045, 10, mx, mz));
  P.add('dark', yTube(rot + 0.75, rot + 0.82, 0.1, 0.1, 10, mx, mz)); // section collar
  P.add('steel', yTube(mt - 0.5, mt, 0.03, 0.02, 8, mx, mz));
  lpda(P, mx, rot + 1.35, mz);
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + 0.4, c = Math.cos(a), sn = Math.sin(a);
    P.add('steel', rod(V(mx, mt, mz), V(mx + c * 0.42, mt - 0.42, mz + sn * 0.42), 0.007, 3)); // cone
    P.add('steel', rod(V(mx, mt - 0.04, mz), V(mx + c * 0.22, mt + 0.03, mz + sn * 0.22), 0.007, 3)); // disc
  }
  hose(P, V(mx + 0.1, lat - 0.3, mz - 0.15), V(mx + 0.4, top - 0.3, z1 + 0.02), 0.2, 0.025, 'rubber', 4);
  P.build(g, { dirt: 0.45 });

  rig.anchors.eye = node(root, 'eye', 0, 2.5, 0);
  hb(rig, -1.3, 0, OFF - 0.55, 1.3, 3.15, OFF + BODY.z0); // cab and front
  hb(rig, -1.3, 0, OFF + BODY.z0, 1.3, BODY.top + 0.2, OFF + BODY.z1 + 0.1); // body
  hb(rig, -0.1, 0, OFF + BODY.z1, 1.3, BODY.y0 + 1.1, OFF + BODY.z1 + 2.9); // platform and stairs
  hb(rig, MAST.x - 0.5, BODY.top, OFF + MAST.z - 0.9, MAST.x + 0.5, MAST.top + 0.1, OFF + MAST.z + 0.9); // mast
  return rig;
}
