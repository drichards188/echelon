import * as THREE from 'three';
import { V, box, rbox, yTube, zTube, xTube, sphere, rod, plane, sideProfile, addWheel, mudguard, addLamp, tyreGeometry, hubGeometry, xf, DEG } from './kit.js';

// Truck building blocks shared by the vehicles: wheel stations, frame and running gear, and the
// cabs (MZKT cab-forward, KamAZ armoured, Ural conventional). Everything goes into a Parts
// collector, front is -Z, ground is y = 0.

// Wheel stations for a list of axle z positions: tyres with hubs, axle beams and differentials,
// leaf springs, brake chambers, steering links and mudguards.
export function runningGear(P, { axles, R = 0.66, W = 0.46, track = 1.2, lugs = 22, steered = 2, guard = true, flaps = true }) {
  axles.forEach((z, i) => {
    for (const s of [-1, 1]) {
      addWheel(P, s * track, R, z, R, W, s, lugs);
      if (guard) P.add('camo', mudguard(R, W + 0.14, s * track, R, z, 8, 172, 0.1, 0.04));
      if (flaps && (i === axles.length - 1 || axles[i + 1] - z > 2 * R + 0.5)) mudFlap(P, s * track, R * 0.82, z + R + 0.12, W + 0.16, R * 0.62);
      // brake chamber and wheel-end hub housing
      P.add('dark', yTube(R - 0.08, R + 0.16, 0.07, 0.07, 8, s * (track - W * 0.5 + 0.12), z + 0.2));
      P.add('steel', xTube(s * (track - W * 0.5), s * (track - W * 0.5 - 0.12), 0.1, 0.1, 10, R, z));
      // leaf spring pack
      P.add('dark', box(0.1, 0.07, 1.0, s * (track - 0.4), R + 0.13, z));
      P.add('dark', box(0.1, 0.05, 0.75, s * (track - 0.4), R + 0.19, z));
    }
    P.add('dark', xTube(-track + 0.3, track - 0.3, 0.085, 0.085, 10, R, z));
    P.add('dark', sphere(0.19, 0, R, z, 1.0, 0.95, 1.1, 12)); // differential
    if (i < steered) { // track rod
      P.add('dark', xTube(-track + 0.35, track - 0.35, 0.025, 0.025, 6, R - 0.06, z - 0.34));
    }
  });
  // drive shafts down the middle
  for (let i = 0; i < axles.length - 1; i++) if (!(axles.length === 4 && i === 1)) {
    P.add('dark', zTube(axles[i] + 0.2, axles[i + 1] - 0.2, 0.045, 0.045, 8, 0, R + 0.05));
    P.add('steel', sphere(0.07, 0, R + 0.05, axles[i] + 0.2, 1, 1, 1, 8));
  }
  if (axles.length === 4) P.add('dark', zTube(axles[1] + 0.2, axles[2] - 0.2, 0.05, 0.05, 8, 0, R + 0.05));
}

// Rubber mud flap hanging behind a wheel: a bracket, the flap and a stiffening strip along its foot.
export function mudFlap(P, x, y, z, w = 0.55, h = 0.4) {
  P.add('tyre', box(w, h, 0.025, x, y - h / 2, z));
  P.add('dark', box(w + 0.04, 0.05, 0.05, x, y + 0.01, z - 0.02));
  P.add('dark', box(w * 0.9, 0.05, 0.035, x, y - h + 0.03, z + 0.012));
}

// Air intake snorkel up the back of a cab: pipe, bracket bands and a cyclone cap with a screen.
export function snorkel(P, x, z, y0, y1) {
  P.add('dark', yTube(y0, y1, 0.065, 0.065, 8, x, z));
  for (const y of [y0 + 0.35, (y0 + y1) / 2, y1 - 0.4]) P.add('steel', box(0.17, 0.04, 0.17, x, y, z));
  P.add('dark', yTube(y1, y1 + 0.22, 0.14, 0.1, 10, x, z));
  P.add('steel', yTube(y1 + 0.22, y1 + 0.25, 0.15, 0.15, 10, x, z));
}

// Fire extinguisher in a clip bracket, standing upright.
export function extinguisher(P, x, y, z) {
  P.add('red', yTube(y, y + 0.34, 0.06, 0.06, 8, x, z));
  P.add('dark', yTube(y + 0.34, y + 0.4, 0.025, 0.04, 6, x, z));
  P.add('steel', box(0.14, 0.03, 0.14, x, y + 0.2, z));
}

// Spare wheel standing on its side against a frame (axis along x), on a cradle.
export function spareWheel(P, x, y, z, R = 0.6, W = 0.42, side = 1) {
  P.add('tyre', tyreGeometry(R, W, 18, 40).applyMatrix4(xf(x, y, z)));
  P.add('rim', hubGeometry(R, W, side).applyMatrix4(xf(x, y, z)));
  P.add('dark', box(W + 0.1, 0.05, 0.12, x, y - R - 0.03, z));
  P.add('dark', rod(V(x, y + R * 0.7, z), V(x - side * 0.3, y + R * 0.9, z), 0.025, 5)); // strap to the frame
}

// Entrenching tool, axe and crowbar clipped to a flat side (face toward +x when side = 1).
export function toolRack(P, x, y, z, side = 1) {
  const f = side * 0.035;
  P.add('dark', rod(V(x + f, y, z - 0.45), V(x + f, y, z + 0.35), 0.016, 6)); // shovel shaft
  P.add('steel', box(0.02, 0.22, 0.26, x + f, y, z - 0.58)); // shovel blade
  P.add('dark', rod(V(x + f, y - 0.12, z - 0.35), V(x + f, y - 0.12, z + 0.25), 0.015, 6)); // axe handle
  P.add('steel', box(0.02, 0.15, 0.1, x + f, y - 0.09, z - 0.4)); // axe head
  P.add('steel', rod(V(x + f, y - 0.23, z - 0.4), V(x + f, y - 0.23, z + 0.35), 0.012, 6)); // crowbar
  for (const dz of [-0.28, 0.12]) P.add('dark', box(0.03, 0.34, 0.05, x + side * 0.022, y - 0.1, z + dz)); // clips
}

// A hanging cable or hose between two points: a catenary-ish sag in a few straight lengths.
export function hose(P, a, b, sag = 0.15, r = 0.025, key = 'tyre', n = 5) {
  let prev = a;
  for (let i = 1; i <= n; i++) {
    const t = i / n, p = a.clone().lerp(b, t);
    p.y -= Math.sin(t * Math.PI) * sag;
    P.add(key, rod(prev, p, r, 5));
    prev = p;
  }
}

// Frame rails with cross members between z0 (front) and z1 (rear), top at y = top.
export function frameRails(P, z0, z1, top = 1.1, span = 1.25) {
  const len = z1 - z0, cz = (z0 + z1) / 2;
  for (const s of [-1, 1]) {
    P.add('dark', box(0.16, 0.34, len, s * span * 0.5, top - 0.17, cz));
    P.add('dark', box(0.2, 0.03, len, s * span * 0.5 - s * 0.02, top - 0.34, cz));
    P.add('dark', box(0.2, 0.03, len, s * span * 0.5 - s * 0.02, top, cz));
  }
  for (let z = z0 + 0.4; z < z1 - 0.2; z += 1.2) P.add('dark', box(span, 0.12, 0.1, 0, top - 0.15, z));
}

// Fuel tanks / tool boxes slung beside the frame between z0 and z1.
export function sideGear(P, z0, z1, y = 0.95, xo = 1.0, boxes = true) {
  const zc = (z0 + z1) / 2;
  P.add('steel', zTube(z0, zc - 0.1, 0.34, 0.34, 18, xo, y));
  P.add('steel', zTube(z0, zc - 0.1, 0.34, 0.34, 18, -xo, y));
  for (const s of [-1, 1]) {
    for (const z of [z0 + 0.25, zc - 0.35]) P.add('dark', box(0.04, 0.8, 0.07, s * xo, y, z));
    P.add('dark', zTube(z0 - 0.02, z0 - 0.0, 0.34, 0.2, 18, s * xo, y));
    P.add('steel', yTube(y + 0.3, y + 0.42, 0.07, 0.07, 8, s * xo, z0 + 0.5)); // filler
    if (boxes) {
      P.add('camo', rbox(0.5, 0.5, 0.95, 0.05, s * xo, y + 0.0, zc + 0.75));
      P.add('dark', box(0.03, 0.4, 0.8, s * (xo + 0.255), y, zc + 0.75));
    }
  }
}

export function rearEnd(P, zr, w = 2.3, y = 0.8) {
  P.add('dark', box(w, 0.2, 0.16, 0, y, zr));
  for (const s of [-1, 1]) {
    addLamp(P, s * (w / 2 - 0.12), y + 0.28, zr + 0.06, 0.2, 0.14, 0.06, 'red');
    P.add('tyre', box(0.65, 0.5, 0.03, s * 0.9, 0.5, zr - 0.5));
  }
  P.add('steel', box(0.1, 0.12, 0.2, 0, y - 0.02, zr + 0.14)); // tow hook plate
  P.add('steel', zTube(zr + 0.2, zr + 0.34, 0.05, 0.05, 8, 0, y - 0.02));
  P.add('white', box(0.5, 0.14, 0.02, 0, y + 0.26, zr + 0.09));
}

// MZKT-7930 style cab-forward cab. zf is the front face, cab runs back about 2.25 m. Returns key spots.
export function mzktCab(P, zf = -5.0, y0 = 1.4) {
  const w = 2.5, hw = w / 2, H = 3.12;
  const prof = [[zf, 1.05], [zf, 2.1], [zf + 0.08, 2.3], [zf + 0.3, 3.0], [zf + 0.4, H], [zf + 2.15, H], [zf + 2.25, H - 0.1], [zf + 2.25, y0], [zf + 0.7, y0], [zf + 0.65, 1.05]];
  P.add('camo', sideProfile(prof, w, 0.05));
  // windscreen: two panes with a centre pillar, wipers
  for (const s of [-1, 1]) P.add('glass', box(1.08, 0.74, 0.03, s * 0.58, 2.66, zf + 0.12, 0.25));
  P.add('dark', box(0.1, 0.8, 0.05, 0, 2.66, zf + 0.11, 0.25));
  P.add('dark', box(2.34, 0.06, 0.06, 0, 3.04, zf + 0.35, 0.25));
  P.add('dark', box(2.34, 0.06, 0.06, 0, 2.27, zf + 0.04, 0.25));
  for (const s of [-1, 1]) {
    P.add('dark', box(0.03, 0.03, 0.62, s * 0.55, 2.38, zf + 0.0, 0.0, 0, s * 0.1)); // wiper
    P.add('dark', box(0.02, 0.02, 0.6, s * 0.15, 2.38, zf + 0.0));
  }
  // grille, headlights, bumper, hooks
  P.add('dark', rbox(1.55, 0.72, 0.1, 0.03, 0, 1.72, zf + 0.0));
  for (let i = 0; i < 7; i++) P.add('steel', box(1.45, 0.025, 0.04, 0, 1.45 + i * 0.1, zf - 0.045));
  P.add('white', box(0.5, 0.14, 0.02, 0, 1.2, zf - 0.015)); // plate
  for (const s of [-1, 1]) {
    addLamp(P, s * 0.98, 1.72, zf - 0.02, 0.36, 0.2, 0.1);
    addLamp(P, s * 1.02, 1.44, zf - 0.02, 0.2, 0.12, 0.08, 'amber');
    addLamp(P, s * 0.98, 2.04, zf + 0.06, 0.18, 0.1, 0.08, 'amber');
    P.add('steel', rod(V(s * 0.72, 1.0, zf - 0.05), V(s * 0.72, 0.82, zf - 0.32), 0.035)); // tow hook
    P.add('steel', rod(V(s * 0.72, 0.82, zf - 0.32), V(s * 0.72, 0.68, zf - 0.26), 0.035));
    P.add('steel', rbox(0.18, 0.08, 0.08, 0.02, s * 0.72, 0.96, zf - 0.06));
  }
  P.add('dark', rbox(2.6, 0.26, 0.4, 0.05, 0, 1.0, zf - 0.05));
  P.add('steel', box(2.4, 0.04, 0.3, 0, 1.14, zf - 0.07));
  // doors: seams, glass, handles, steps, grab handles
  for (const s of [-1, 1]) {
    const x = s * (hw + 0.002);
    P.add('glass', box(0.03, 0.66, 0.95, x, 2.58, zf + 0.95));
    P.add('glass', box(0.03, 0.55, 0.38, x, 2.64, zf + 1.65));
    P.add('dark', box(0.035, 0.05, 1.04, x, 2.95, zf + 0.95));
    P.add('dark', box(0.035, 0.05, 1.04, x, 2.24, zf + 0.95));
    for (const z of [zf + 0.45, zf + 1.48, zf + 1.86]) P.add('dark', box(0.03, 1.7, 0.025, x, 2.1, z));
    P.add('dark', box(0.03, 0.025, 1.05, x, 1.5, zf + 0.97));
    P.add('steel', rbox(0.06, 0.06, 0.2, 0.02, s * (hw + 0.03), 2.1, zf + 1.3));
    P.add('steel', rod(V(s * (hw + 0.1), 1.55, zf + 0.5), V(s * (hw + 0.1), 2.95, zf + 0.5), 0.02));
    P.add('steel', rod(V(s * (hw + 0.1), 1.55, zf + 0.5), V(s * (hw + 0.03), 1.55, zf + 0.5), 0.02));
    P.add('steel', rod(V(s * (hw + 0.1), 2.95, zf + 0.5), V(s * (hw + 0.03), 2.95, zf + 0.5), 0.02));
    // steps
    P.add('steel', box(0.42, 0.04, 0.32, s * (hw + 0.1), 0.86, zf + 1.1));
    P.add('steel', box(0.42, 0.04, 0.32, s * (hw + 0.1), 1.2, zf + 1.1));
    P.add('dark', box(0.04, 0.4, 0.3, s * (hw - 0.02), 1.0, zf + 1.1));
    // mirrors on a bracket
    P.add('dark', rod(V(s * hw, 2.6, zf + 0.35), V(s * (hw + 0.38), 2.78, zf + 0.12), 0.018));
    P.add('dark', rod(V(s * hw, 2.3, zf + 0.35), V(s * (hw + 0.38), 2.52, zf + 0.12), 0.018));
    P.add('dark', rbox(0.1, 0.5, 0.22, 0.02, s * (hw + 0.4), 2.65, zf + 0.12));
    P.add('steel', box(0.012, 0.44, 0.17, s * (hw + 0.345), 2.65, zf + 0.12));
    // side markers
    addLamp(P, s * (hw + 0.02), 2.0, zf + 0.12, 0.02, 0.1, 0.16, 'amber');
  }
  // roof: visor, vents, horns, beacon
  P.add('camo', rbox(2.5, 0.05, 0.3, 0.02, 0, 3.0, zf + 0.5, 0.25));
  P.add('camo', rbox(0.8, 0.12, 0.7, 0.04, 0.55, H + 0.06, zf + 1.3));
  P.add('dark', box(0.7, 0.02, 0.6, 0.55, H + 0.13, zf + 1.3));
  for (const s of [-1, 1]) P.add('amber', box(0.12, 0.08, 0.1, s * 0.5, H + 0.04, zf + 0.5));
  P.add('steel', zTube(zf + 1.6, zf + 1.85, 0.05, 0.05, 8, -0.6, H + 0.1));
  P.add('steel', zTube(zf + 1.95, zf + 2.1, 0.05, 0.06, 8, -0.6, H + 0.1));
  extinguisher(P, hw + 0.08, 1.42, zf + 1.78);
  P.add('dark', box(0.05, 0.3, 0.2, hw + 0.025, 1.6, zf + 1.78)); // its bracket
  for (const s of [-1, 1]) P.add('tyre', box(0.04, 0.5, 0.025, s * (hw + 0.005), 1.2, zf + 2.2)); // door seal and rear flap
  return { top: H, back: zf + 2.25, front: zf, hw };
}

// Exhaust stack with a rain cap, behind the cab on the right.
export function exhaustStack(P, x, z, y0, y1) {
  P.add('steel', yTube(y0, y1, 0.085, 0.085, 10, x, z));
  P.add('dark', yTube(y1, y1 + 0.12, 0.1, 0.1, 10, x, z));
  P.add('dark', box(0.28, 0.02, 0.28, x, y1 + 0.18, z));
  P.add('dark', box(0.04, 0.12, 0.04, x, y1 + 0.12, z));
  for (const y of [y0 + 0.5, (y0 + y1) / 2, y1 - 0.4]) P.add('dark', yTube(y - 0.03, y + 0.03, 0.105, 0.105, 10, x, z));
  P.add('dark', box(0.04, y1 - y0 - 0.3, 0.2, x - Math.sign(x) * 0.12, (y0 + y1) / 2 - 0.15, z)); // heat shield
}

// Stabiliser jack: a hydraulic leg and a ground pad, dropped to y = 0.
export function jack(P, x, z, yTop = 1.0) {
  P.add('dark', box(0.34, 0.34, 0.34, x, yTop - 0.1, z));
  P.add('steel', yTube(0.1, yTop - 0.15, 0.065, 0.065, 10, x, z));
  P.add('dark', yTube(0.12, yTop - 0.4, 0.09, 0.09, 10, x, z));
  P.add('dark', box(0.62, 0.07, 0.62, x, 0.04, z));
  P.add('steel', sphere(0.09, x, 0.12, z, 1, 0.7, 1, 8));
  P.add('tyre', box(0.7, 0.03, 0.7, x, 0.015, z));
}

// Ladder up the side of a body: rails and rungs.
export function ladder(P, x, z, y0, y1, w = 0.4, key = 'steel') {
  for (const s of [-1, 1]) P.add(key, yTube(y0, y1, 0.018, 0.018, 6, x + s * w / 2, z));
  for (let y = y0 + 0.2; y < y1; y += 0.28) P.add(key, xTube(x - w / 2, x + w / 2, 0.015, 0.015, 6, y, z));
}

// Antenna whip with a base
export function whip(P, x, y, z, h, r = 0.012) {
  P.add('dark', yTube(y, y + 0.14, 0.04, 0.03, 8, x, z));
  P.add('dark', yTube(y + 0.14, y + h, r, r * 0.4, 5, x, z));
}

// KamAZ-6560 style armoured cab (Pantsir): boxy with sloped armour plates and small windows.
export function kamazCab(P, zf = -4.55, y0 = 1.2) {
  const w = 2.45, hw = w / 2, H = 3.0;
  const prof = [[zf, 1.0], [zf, 1.95], [zf + 0.18, 2.15], [zf + 0.5, 2.9], [zf + 0.62, H], [zf + 2.0, H], [zf + 2.1, H - 0.12], [zf + 2.1, y0], [zf + 0.6, y0], [zf + 0.55, 1.0]];
  P.add('camo', sideProfile(prof, w, 0.04));
  // armour: slab plates over the windscreen and bolted skirt detail
  for (const s of [-1, 1]) {
    P.add('glass', box(0.98, 0.42, 0.04, s * 0.58, 2.48, zf + 0.34, 0.45));
    P.add('camo', rbox(1.0, 0.12, 0.12, 0.02, s * 0.58, 2.76, zf + 0.46, 0.45));
    P.add('camo', rbox(1.0, 0.12, 0.12, 0.02, s * 0.58, 2.2, zf + 0.2, 0.45));
    P.add('glass', box(0.04, 0.4, 0.78, s * (hw + 0.003), 2.5, zf + 0.9));
    P.add('camo', rbox(0.06, 0.1, 0.9, 0.02, s * (hw + 0.02), 2.78, zf + 0.9));
    P.add('camo', rbox(0.06, 0.1, 0.9, 0.02, s * (hw + 0.02), 2.2, zf + 0.9));
    addLamp(P, s * 0.9, 1.6, zf - 0.01, 0.34, 0.2, 0.1);
    addLamp(P, s * 1.0, 1.35, zf - 0.01, 0.18, 0.1, 0.08, 'amber');
    P.add('steel', rod(V(s * 0.7, 1.0, zf - 0.05), V(s * 0.7, 0.84, zf - 0.3), 0.035));
    P.add('dark', box(0.03, 1.35, 0.025, s * (hw + 0.002), 2.0, zf + 1.45));
    P.add('dark', box(0.03, 1.35, 0.025, s * (hw + 0.002), 2.0, zf + 0.35));
    P.add('steel', rbox(0.06, 0.06, 0.2, 0.02, s * (hw + 0.03), 2.0, zf + 1.3));
    P.add('steel', box(0.42, 0.04, 0.32, s * (hw + 0.1), 0.78, zf + 0.9));
    P.add('steel', box(0.42, 0.04, 0.32, s * (hw + 0.1), 1.12, zf + 0.9));
    P.add('dark', rod(V(s * hw, 2.5, zf + 0.5), V(s * (hw + 0.34), 2.7, zf + 0.25), 0.018));
    P.add('dark', rbox(0.1, 0.46, 0.2, 0.02, s * (hw + 0.36), 2.62, zf + 0.25));
  }
  P.add('dark', box(0.12, 0.45, 0.05, 0, 2.48, zf + 0.34, 0.45));
  P.add('dark', rbox(1.6, 0.6, 0.1, 0.03, 0, 1.55, zf + 0.0));
  for (let i = 0; i < 6; i++) P.add('steel', box(1.5, 0.02, 0.04, 0, 1.3 + i * 0.1, zf - 0.045));
  P.add('dark', rbox(2.55, 0.28, 0.4, 0.05, 0, 0.95, zf - 0.05));
  P.add('camo', rbox(2.3, 0.12, 0.7, 0.04, 0, H + 0.06, zf + 1.35));
  P.add('dark', box(0.6, 0.04, 0.5, -0.4, H + 0.14, zf + 1.35));
  extinguisher(P, hw + 0.08, 1.4, zf + 1.7);
  P.add('dark', box(0.05, 0.3, 0.2, hw + 0.025, 1.58, zf + 1.7));
  for (const s of [-1, 1]) { // bars over the head lamps, tow eyes on the bumper, roof marker lamps
    for (const dy of [-0.08, 0.08]) P.add('dark', box(0.46, 0.015, 0.015, s * 0.9, 1.6 + dy, zf - 0.07));
    P.add('steel', rbox(0.1, 0.1, 0.1, 0.02, s * 1.08, 0.92, zf - 0.28));
    addLamp(P, s * 1.0, H - 0.1, zf + 0.62, 0.16, 0.08, 0.06, 'amber');
  }
  return { top: H, back: zf + 2.1, front: zf, hw };
}

// Ural-532301 style conventional cab with a short bonnet (command post).
export function uralCab(P, zf = -4.3, y0 = 1.25) {
  const w = 2.3, hw = w / 2;
  // bonnet
  P.add('camo', rbox(1.9, 0.9, 1.3, 0.1, 0, 1.75, zf + 0.7));
  P.add('camo', rbox(2.1, 0.12, 1.2, 0.05, 0, 2.22, zf + 0.7));
  P.add('dark', rbox(1.4, 0.7, 0.08, 0.03, 0, 1.72, zf + 0.0));
  for (let i = 0; i < 6; i++) P.add('steel', box(1.3, 0.02, 0.03, 0, 1.45 + i * 0.1, zf - 0.04));
  for (const s of [-1, 1]) {
    addLamp(P, s * 0.82, 1.78, zf + 0.0, 0.3, 0.2, 0.1);
    addLamp(P, s * 0.82, 1.5, zf + 0.0, 0.16, 0.1, 0.08, 'amber');
    P.add('camo', mudguard(0.62, 0.5, s * 1.05, 0.62, zf + 1.15, 0, 180, 0.1, 0.04));
    P.add('steel', rod(V(s * 0.6, 1.1, zf - 0.05), V(s * 0.6, 0.95, zf - 0.28), 0.032));
  }
  P.add('dark', rbox(2.4, 0.26, 0.38, 0.05, 0, 0.95, zf - 0.04));
  // cab
  const c0 = zf + 1.4;
  const prof = [[c0, 1.25], [c0, 2.35], [c0 + 0.12, 2.5], [c0 + 0.45, 3.1], [c0 + 0.55, 3.18], [c0 + 1.85, 3.18], [c0 + 1.9, 3.1], [c0 + 1.9, y0]];
  P.add('camo', sideProfile(prof, w, 0.04));
  for (const s of [-1, 1]) {
    P.add('glass', box(0.98, 0.6, 0.03, s * 0.56, 2.76, c0 + 0.26, 0.38));
    P.add('glass', box(0.03, 0.6, 0.9, s * (hw + 0.002), 2.76, c0 + 0.95));
    P.add('dark', box(0.03, 1.55, 0.025, s * (hw + 0.002), 2.2, c0 + 0.45));
    P.add('dark', box(0.03, 1.55, 0.025, s * (hw + 0.002), 2.2, c0 + 1.5));
    P.add('steel', rbox(0.06, 0.06, 0.2, 0.02, s * (hw + 0.03), 2.25, c0 + 1.3));
    P.add('steel', box(0.42, 0.04, 0.3, s * (hw + 0.1), 0.92, c0 + 0.8));
    P.add('dark', rod(V(s * hw, 2.75, c0 + 0.3), V(s * (hw + 0.34), 2.95, c0 + 0.1), 0.018));
    P.add('dark', rbox(0.1, 0.42, 0.18, 0.02, s * (hw + 0.36), 2.88, c0 + 0.1));
  }
  P.add('dark', box(0.1, 0.62, 0.04, 0, 2.76, c0 + 0.26, 0.38));
  P.add('camo', rbox(2.3, 0.05, 0.3, 0.02, 0, 3.1, c0 + 0.45, 0.38));
  P.add('dark', box(1.0, 0.1, 0.5, 0.4, 3.2, c0 + 1.2));
  P.add('steel', yTube(1.2, 3.4, 0.07, 0.07, 10, 1.22, c0 + 1.98));
  P.add('dark', yTube(3.4, 3.52, 0.09, 0.09, 10, 1.22, c0 + 1.98));
  return { top: 3.2, back: c0 + 1.9, front: zf, hw };
}
