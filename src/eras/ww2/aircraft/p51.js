import { Assembly, PART, V, D2R, loft, box, strut, sphere, wingAt, wingSurfaceY } from './build.js';
import { barrel, disc } from './kit.js';
import { C } from './colours.js';

// North American P-51D-20/D-25 Mustang of the 361st Fighter Group, February to March 1945
// (refs/ww2/p51): natural metal, the group's yellow nose and spinner, the squadron's rudder colour
// (from November 1944: 374th FS red, 375th blue, 376th yellow; refs/ww2/markings 6.5), black codes
// (squadron code forward of the star on both sides, the aircraft letter aft), the serial in black on
// the fin, the star and bar on both fuselage sides, the upper left and lower right wing. A few carry
// the invasion stripes' late holdover under the rear fuselage only. Drew's 44-14164 "Detroit Miss",
// E2-D, is livery 0; the other codes and serials are plausible ones from the D-20 and D-25 blocks (E).
//
// Shape: the NAA three-view (refs/ww2/p51/photos/p51_3view_11.jpg, 82.7 px per metre) read on a metre
// grid; span 11.28 m, length 9.83 m, Hamilton Standard four-blade 3.40 m prop. Drawing stations are
// metres aft of the spinner tip (zd); model z = zd - 3.4 (the wing's quarter MAC, fuselage station 99), y up from the thrust
// line. Moving parts: the prop (clockwise from the cockpit), drop tanks (load: tanks) on the wing racks.

const Z = (zd) => zd - 3.4;
// a planform in drawing stations [x, zdLE, zdTE] to model z
const P = (pl) => pl.map(([x, a, b]) => [x, Z(a), Z(b)]);

// [zd, half width, height above, depth below, centre y, exponent]
const FUS = [
  [0.52, 0.36, 0.37, 0.37, 0.0, 2.0], [0.7, 0.38, 0.42, 0.44, 0.0, 2.05], [1.0, 0.4, 0.46, 0.5, 0.0, 2.1],
  [1.5, 0.43, 0.49, 0.55, 0.0, 2.15], [2.0, 0.45, 0.52, 0.58, 0.0, 2.2], [2.5, 0.47, 0.56, 0.62, 0.0, 2.25],
  [3.0, 0.48, 0.6, 0.64, 0.0, 2.25], [3.5, 0.49, 0.62, 0.65, 0.0, 2.25], [4.1, 0.49, 0.64, 0.66, 0.0, 2.2],
  [4.7, 0.47, 0.65, 0.65, 0.0, 2.2], [5.3, 0.43, 0.65, 0.62, 0.0, 2.15], [5.9, 0.38, 0.62, 0.58, 0.01, 2.1],
  [6.5, 0.31, 0.58, 0.52, 0.02, 2.05], [7.2, 0.25, 0.55, 0.44, 0.04, 2.0], [8.0, 0.18, 0.5, 0.34, 0.07, 2.0],
  [8.8, 0.12, 0.42, 0.24, 0.1, 2.0], [9.4, 0.07, 0.3, 0.15, 0.12, 2.0], [9.75, 0.025, 0.14, 0.08, 0.13, 2.0],
].map(([z, ...r]) => [Z(z), ...r]);

const CANOPY = [
  [3.3, 0.26, 0.04, 0.6], [3.48, 0.3, 0.2, 0.6], [3.74, 0.32, 0.37, 0.6], [4.1, 0.33, 0.44, 0.6], [4.6, 0.32, 0.42, 0.6],
  [5.0, 0.28, 0.31, 0.6], [5.35, 0.21, 0.15, 0.6], [5.6, 0.1, 0.03, 0.6],
].map(([z, ...r]) => [Z(z), ...r]);

// the belly radiator and oil cooler scoop: the mouth stands below the fuselage at zd 3.95, the exit
// flap at zd 6.2
const SCOOP = [
  [3.95, 0.25, 0.16, 0.11, -0.86, 2.6], [4.3, 0.3, 0.24, 0.17, -0.84, 2.6], [5.0, 0.32, 0.3, 0.2, -0.82, 2.6],
  [5.7, 0.29, 0.3, 0.16, -0.77, 2.5], [6.2, 0.23, 0.26, 0.09, -0.7, 2.4],
].map(([z, ...r]) => [Z(z), ...r]);

const WING = {
  semispan: 5.64, y: -0.48, dihedral: 5 * D2R, tRoot: 0.15, tTip: 0.11, S: 22, C: 26, x0: 0.15, washout: 1.5, camber: 0.012,
  // straight taper (root 2.64 m, MAC 2.02 m at station 99), the D's root extension ahead of the wheel
  // bays, square-cut rounded tips (three-view top view)
  plan: P([[0, 2.4, 5.19], [0.6, 2.46, 5.11], [1.2, 2.69, 5.03], [2.5, 2.9, 4.87], [4.0, 3.11, 4.67], [5.2, 3.28, 4.51], [5.5, 3.34, 4.44], [5.6, 3.42, 4.34], [5.64, 3.62, 4.12]]),
};
const HTAIL = {
  semispan: 2.02, y: 0.32, tRoot: 0.12, tTip: 0.09, S: 12, C: 18, x0: 0.05,
  plan: P([[0, 8.0, 9.27], [1.0, 8.12, 9.2], [1.6, 8.24, 9.16], [1.9, 8.35, 9.14], [1.99, 8.48, 9.1], [2.02, 8.7, 8.95]]),
};
const FIN = {
  semispan: 1.32, base: 0.3, tRoot: 0.11, tTip: 0.08, S: 12, C: 18,
  plan: P([[0, 8.1, 9.82], [0.25, 8.45, 9.82], [0.6, 8.65, 9.76], [1.0, 8.85, 9.7], [1.2, 8.98, 9.65], [1.29, 9.15, 9.6], [1.32, 9.38, 9.5]]),
};
const FILLET = { semispan: 0.42, base: 0.42, tRoot: 0.1, tTip: 0.1, S: 5, C: 12, plan: P([[0, 7.2, 8.8], [0.1, 7.75, 8.8], [0.2, 8.2, 8.75], [0.3, 8.5, 8.7], [0.42, 8.75, 8.72]]) };

function build() {
  const A = new Assembly();
  A.body(FUS, PART.FUSELAGE, { n: 30, count: 34 });
  A.body(SCOOP, PART.FUSELAGE, { n: 20, count: 10 });
  A.add(disc(0, -0.85, Z(3.96), 0.23, 0.12, 16), PART.RADIATOR);
  // carburettor air intake under the nose
  A.body([[Z(0.85), 0.07, 0.04, 0.06, -0.48, 2.4], [Z(1.0), 0.11, 0.06, 0.08, -0.5, 2.6], [Z(1.7), 0.1, 0.06, 0.06, -0.55, 2.4], [Z(2.0), 0.03, 0.02, 0.02, -0.56, 2]], PART.FUSELAGE, { n: 12 });
  A.add(disc(0, -0.5, Z(0.86), 0.09, 0.05, 10), PART.RADIATOR);
  A.canopy(CANOPY, { frames: [Z(3.32), Z(3.73)], rail: false });
  A.pilot(0, 0.88, Z(4.2));
  // gunsight and the whip aerial behind the hood
  A.add(box(0.08, 0.12, 0.12, 0, 0.72, Z(3.62)), PART.DARK, { flat: true });
  A.add(strut(V(0, 0.6, Z(6.4)), V(0, 0.95, Z(6.6)), 0.012, 0.012, 4), PART.DARK);
  // six exhaust stacks a side along the cowling
  for (const s of [-1, 1]) for (let k = 0; k < 6; k++) {
    const z = Z(1.05 + k * 0.14);
    A.add(strut(V(s * 0.42, 0.22, z), V(s * 0.5, 0.2, z + 0.06), 0.035, 0.05, 6, 0.03, 0.045), PART.METAL);
  }
  A.prop({ x: 0, y: 0, z: Z(0.5), r: 1.7, blades: 4, chord: 0.24, dir: -1, spinner: [Z(0), Z(0.56), 0.36, 0.85] });
  A.surfaces({ wing: WING, htail: HTAIL, fin: [FIN, FILLET] });
  A.fillets(FUS, WING, { x: 0.45, z0: -0.05, z1: 0.18, w: 0.22, hT: 0.14, hB: 0.06 });
  // three .50s a side in the leading edge, inboard lowest
  for (const s of [-1, 1]) for (let k = 0; k < 3; k++) {
    const x = 2.45 + k * 0.25, w = wingAt(WING, x);
    A.add(barrel(s * x, w.y - 0.02 - k * 0.01, w.le + 0.15, w.le - 0.1, 0.02), PART.DARK);
  }
  // drop tanks (108 gal) on the wing racks
  for (const s of [-1, 1]) {
    const x = 3.0, y = wingSurfaceY(WING, x, 0.35, -1);
    A.store(loft([[-1.05, 0.02, 0.02, 0.02, 0, 2], [-0.8, 0.2, 0.2, 0.2, 0, 2], [-0.3, 0.29, 0.29, 0.29, 0, 2], [0.3, 0.29, 0.29, 0.29, 0, 2], [0.85, 0.16, 0.16, 0.16, 0, 2], [1.1, 0.02, 0.02, 0.02, 0, 2]], { n: 14, count: 12, xc: s * x }).translate(0, y - 0.36, -0.3), 10, 0);
    A.store(box(0.06, 0.12, 0.7, s * x, y - 0.05, -0.3), 10, 0, true);
  }
  return A.finish({
    type: 'p51', length: 9.83, exh: { z: Z(1.75), y: 0.2, x: 0.47, w: 0.12, len: 2.2 }, well: [1.25, Z(2.9) + 0.1, 0.5], propW: 24,
    smoke: [V(0, 0, Z(1.2))],
    livery: LIVERY,
  });
}

const LIVERY = {
  scheme: 'nmf',
  demarc: [0, 0, 0.06],
  ailerons: [0.6, 0.95, 0.75], flaps: [0.06, 0.58, 0.76],
  glassTop: 1.04, centreFrame: 0,
  store: '#a6a9ab', storeBand: -99,
  slots: ['code', 'letter', 'serial'],
  colourSlots: ['rudder'],
  regions: [
    { kind: 'nose', z1: Z(3.12), k: 0, colour: C.yellow361 },
    { kind: 'spinner', colour: C.yellow361 },
    // the olive drab anti-glare panel on top of the nose, from the stacks to the windscreen
    { kind: 'antiglare', z0: Z(1.0), z1: Z(3.35), ny: 0.8, colour: C.od },
    { kind: 'rudder', c0: 0.6, s0: 0.0, colour: 'liv:rudder' },
    { kind: 'stripes', z0: Z(5.1), w: 0.457, y1: -0.05 },
  ],
  decals: [
    { kind: 'star', surf: 'side', a: Z(6.45), b: 0.0, r: 0.4, reach: 1.0 },
    { kind: 'star', surf: 'wingTop', side: 'L', a: 3.9, b: 0.45, r: 0.48, reach: 1.1 },
    { kind: 'star', surf: 'wingBot', side: 'R', a: 3.9, b: 0.45, r: 0.48, reach: 1.1 },
    { kind: 'text', surf: 'side', a: Z(5.35), b: 0.0, h: 0.6, slot: 'code', colour: C.black, reach: 0.8 },
    { kind: 'text', surf: 'side', a: Z(7.6), b: 0.02, h: 0.6, slot: 'letter', colour: C.black, reach: 0.5 },
    { kind: 'text', surf: 'fin', a: Z(9.15), b: 0.95, h: 0.17, slot: 'serial', colour: C.black, reach: 0.7 },
  ],
  liveries: [
    { code: 'E2', letter: 'D', serial: '414164', rudder: C.blue },
    { code: 'B7', letter: 'R', serial: '472218', rudder: C.red },
    { code: 'E9', letter: 'W', serial: '473109', rudder: C.yellow361 },
    { code: 'E2', letter: 'S', serial: '463622', rudder: C.blue, stripes: true },
    { code: 'B7', letter: 'H', serial: '472635', rudder: C.red },
    { code: 'E9', letter: 'A', serial: '473390', rudder: C.yellow361 },
    { code: 'E2', letter: 'K', serial: '472841', rudder: C.blue },
    { code: 'B7', letter: 'V', serial: '473556', rudder: C.red, stripes: true },
  ],
};

export const p51 = build;
