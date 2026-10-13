import { Assembly, PART, V, D2R, loft, box, strut, sphere, wingAt, wingSurfaceY } from './build.js';
import { barrel, disc, cowl as cowlGeo } from './kit.js';
import { C } from './colours.js';

// Republic P-47D-30 Thunderbolt ("bubble-top") of the 406th Fighter Group, XXIX TAC (refs/ww2/p47): the
// group supported the Ninth Army in the north from February 1945 and ended the war at Muenster-Handorf,
// 40 km from Hopsten. Natural metal (Skirty Bert III, 514th FS, at Handorf in 1945), the olive drab
// anti-glare panel, black codes forward of the star (514th FS "O7"; 512th "L3", 513th "4P") with the
// letter aft, the serial on the fin, stars on both fuselage sides, the upper left and both lower wings
// (ETO fighters, 40 in, 61 in from the tips). The group colours are not sourced (refs/ww2/markings 6.5):
// the yellow cowl ring and the red and yellow fin tip are read from the 406th's line-up at Nordholz,
// June 1945 (E). Two liveries are olive drab, as some of the group's aircraft were by mid-1945, and one
// keeps the invasion stripes under the rear fuselage. Codes and serials are plausible (E).
//
// Shape: the US three-view of the P-47B (Commons "Republic P-47 Thunderbolt 3-view line drawing.png",
// public domain, 114.5 px per metre) for the wing (12.43 m), the tail and the fuselage below the spine;
// from the P-47C on the engine sat 8 in further forward (length 11.02 m), and the D-30 has the sliding
// bubble canopy on a cut-down spine, the low dorsal fillet and the 13 ft Curtiss Electric paddle prop
// (refs/ww2/p47 sections 1 to 3). Stations zd are metres aft of the B's prop hub, y up from the thrust
// line; model z = zd - 3.25. Moving parts: the prop, two 500 lb bombs on the wing pylons (load 0) or six
// HVARs on the zero-length stubs (load 1), a belly tank (tanks).

const Z = (zd) => zd - 3.25;
const P = (pl) => pl.map(([x, a, b]) => [x, Z(a), Z(b)]);
const st = ([zd, w, t, b], e = 2.1) => [Z(zd), w, (t - b) / 2, (t - b) / 2, (t + b) / 2, e];
const FUS = [
  [1.95, 0.66, 0.8, -1.0], [2.5, 0.66, 0.87, -1.03], [3.0, 0.65, 0.92, -1.05], [4.0, 0.63, 0.95, -1.05], [5.0, 0.6, 0.93, -1.03],
  [5.6, 0.56, 0.89, -0.97], [6.5, 0.5, 0.8, -0.84], [7.5, 0.41, 0.68, -0.67], [8.5, 0.3, 0.57, -0.5], [9.5, 0.2, 0.46, -0.33],
  [10.25, 0.11, 0.36, -0.17], [10.62, 0.03, 0.26, 0.0],
].map((s) => st(s));
// the bubble sits 0.4 m further aft than the B's framed hood, as the D-40 photographed from above shows
// (p47_museum_12, camera-matched)
const CANOPY = [[3.55, 0.3, 0.02, 0.9], [3.75, 0.36, 0.17, 0.9], [4.0, 0.38, 0.33, 0.9], [4.35, 0.38, 0.42, 0.9], [4.9, 0.36, 0.4, 0.9], [5.35, 0.3, 0.27, 0.9], [5.7, 0.2, 0.1, 0.9], [5.9, 0.08, 0.02, 0.9]].map(([z, ...r]) => [Z(z), ...r]);

const WING = {
  semispan: 6.215, y: -0.5, dihedral: 6 * D2R, tRoot: 0.16, tTip: 0.1, S: 22, C: 26, x0: 0.2, washout: 2, camber: 0.014,
  plan: P([[0, 2.45, 5.35], [0.65, 2.5, 5.3], [2.0, 2.6, 5.15], [3.5, 2.73, 4.95], [5.0, 2.88, 4.65], [5.7, 3.0, 4.42], [6.0, 3.12, 4.25], [6.15, 3.3, 4.0], [6.215, 3.65, 3.75]]),
};
const HTAIL = { semispan: 2.44, y: 0.3, tRoot: 0.12, tTip: 0.09, S: 12, C: 18, x0: 0.05, plan: P([[0, 9.15, 10.6], [1.0, 9.42, 10.62], [1.8, 9.72, 10.62], [2.2, 9.95, 10.6], [2.38, 10.18, 10.52], [2.44, 10.4, 10.42]]) };
const FIN = { semispan: 1.65, base: 0.4, tRoot: 0.11, tTip: 0.08, S: 12, C: 18, plan: P([[0, 8.6, 10.6], [0.15, 8.68, 10.62], [0.6, 9.05, 10.64], [1.0, 9.4, 10.62], [1.3, 9.65, 10.58], [1.5, 9.85, 10.5], [1.6, 10.0, 10.38], [1.65, 10.15, 10.25]]) };
const FILLET = { semispan: 0.3, base: 0.5, tRoot: 0.1, tTip: 0.1, S: 5, C: 12, plan: P([[0, 7.4, 8.9], [0.1, 7.9, 8.9], [0.2, 8.4, 8.85], [0.3, 8.72, 8.8]]) };

function build() {
  const A = new Assembly();
  A.body(FUS, PART.FUSELAGE, { n: 32, count: 30, capStart: false });
  // the oval cowling, deepest below where the oil cooler and turbo intake ducts fill its lower half
  const zF = Z(0.38), zB = Z(1.98);
  A.add(cowlGeo({ x: 0, y: -0.1, zF, zB, w: 0.64, h: 0.8, wB: 0.66, hB: 0.9, inner: 0.78 }), PART.COWL);
  // engine face in the upper part of the mouth, the "horse collar" duct mouths below it
  A.add(disc(0, 0.05, zF + 0.32, 0.5, 0.5, 20), PART.DARK);
  for (let k = 0; k < 9; k++) {
    const a = (k / 9) * Math.PI * 2;
    A.add(strut(V(Math.cos(a) * 0.15, 0.05 + Math.sin(a) * 0.15, zF + 0.28), V(Math.cos(a) * 0.46, 0.05 + Math.sin(a) * 0.46, zF + 0.28), 0.07, 0.07, 5), PART.DARK);
  }
  A.add(sphere(0, 0.05, zF + 0.22, 0.2, 1, 1, 0.8, 10, 6), PART.DARK);
  for (const s of [-1, 1]) A.add(disc(s * 0.28, -0.6, zF + 0.16, 0.22, 0.12, 14), PART.RADIATOR);
  // cowl flaps
  for (let k = 0; k < 18; k++) {
    const a = (k / 18) * Math.PI * 2;
    A.add(box(0.02, 0.22, 0.24, Math.cos(a) * 0.66, -0.1 + Math.sin(a) * 0.88, zB + 0.06, 0, 0, a), PART.COWL, { flat: true });
  }
  A.prop({ x: 0, y: 0.04, z: Z(0.22), r: 1.98, blades: 4, chord: 0.3, paddle: 0.55, dir: -1, hub: 0.2, hubR: 0.2 });

  A.canopy(CANOPY, { frames: [Z(3.57), Z(4.0)], rail: false });
  A.pilot(0, 1.13, Z(4.52));
  A.add(box(0.08, 0.12, 0.12, 0, 1.0, Z(3.9)), PART.DARK, { flat: true });
  A.add(strut(V(0, 0.82, Z(6.3)), V(0, 1.15, Z(6.5)), 0.012, 0.012, 4), PART.DARK);
  // turbosupercharger exhaust hood under the rear fuselage
  A.body([[Z(6.4), 0.02, 0.02, 0.02, -0.82, 2], [Z(6.6), 0.16, 0.06, 0.07, -0.8, 2.4], [Z(7.1), 0.15, 0.05, 0.06, -0.72, 2.4], [Z(7.3), 0.02, 0.02, 0.02, -0.68, 2]], PART.METAL, { n: 12 });

  A.surfaces({ wing: WING, htail: HTAIL, fin: [FIN, FILLET] });
  A.fillets(FUS, WING, { x: 0.55, z0: -0.06, z1: 0.12, w: 0.26, hT: 0.16, hB: 0.06 });
  // eight .50s, four a side, staggered back from the leading edge
  for (const s of [-1, 1]) for (let k = 0; k < 4; k++) {
    const x = 2.2 + k * 0.2, w = wingAt(WING, x);
    A.add(barrel(s * x, w.y - 0.03, w.le + 0.25 + k * 0.04, w.le - 0.42 + k * 0.08, 0.022), PART.DARK);
  }
  // wing pylons with two 500 lb GP bombs (load 0), six 5 in HVARs on zero-length stubs (load 1)
  for (const s of [-1, 1]) {
    const x = 2.05, y = wingSurfaceY(WING, x, 0.35, -1), w = wingAt(WING, x);
    const zc = w.le + w.c * 0.35;
    A.add(box(0.07, 0.2, 0.75, s * x, y - 0.08, zc), PART.FUSELAGE, { flat: true });
    A.store(bomb500().translate(s * x, y - 0.37, zc - 0.1), 0, s > 0 ? 1 : 0);
    for (let k = 0; k < 3; k++) {
      const xr = 3.3 + k * 0.45, wr = wingAt(WING, xr), yr = wingSurfaceY(WING, xr, 0.3, -1);
      A.add(box(0.05, 0.08, 0.12, s * xr, yr - 0.03, wr.le + wr.c * 0.2), PART.METAL, { flat: true });
      A.add(box(0.05, 0.08, 0.12, s * xr, yr - 0.03, wr.le + wr.c * 0.55), PART.METAL, { flat: true });
      A.store(hvar().translate(s * xr, yr - 0.16, wr.le + wr.c * 0.38), 1, k * 2 + (s > 0 ? 1 : 0));
    }
  }
  // belly drop tank (110 gal)
  A.store(loft([[-1.2, 0.02, 0.02, 0.02, 0, 2], [-0.9, 0.24, 0.24, 0.24, 0, 2], [-0.3, 0.33, 0.33, 0.33, 0, 2], [0.4, 0.33, 0.33, 0.33, 0, 2], [1.0, 0.18, 0.18, 0.18, 0, 2], [1.25, 0.02, 0.02, 0.02, 0, 2]], { n: 14, count: 12 }).translate(0, -1.45, Z(3.9)), 10, 0);

  return A.finish({
    type: 'p47', length: 11.02, exh: { z: Z(7.25), y: -0.72, x: 0, w: 0.18, len: 2.0 }, well: [1.4, Z(3.3), 0.55], propW: 22,
    smoke: [V(0, 0, Z(1.2))], stores: { 0: 2, 1: 6 }, storeField: 'bombs',
    livery: LIVERY,
  });
}

// AN-M64 500 lb GP bomb, 0.36 m across, 1.5 m with the tail, nose forward (-z)
function bomb500() {
  const g = loft([[-0.75, 0.03, 0.03, 0.03, 0, 2], [-0.68, 0.1, 0.1, 0.1, 0, 2], [-0.5, 0.17, 0.17, 0.17, 0, 2], [-0.25, 0.18, 0.18, 0.18, 0, 2], [0.25, 0.18, 0.18, 0.18, 0, 2], [0.5, 0.12, 0.12, 0.12, 0, 2], [0.62, 0.08, 0.08, 0.08, 0, 2]], { n: 12, count: 10 });
  return g;
}
// 5 in HVAR: a 1.73 m motor tube with its head, four cruciform fins
function hvar() {
  return loft([[-0.86, 0.01, 0.01, 0.01, 0, 2], [-0.78, 0.05, 0.05, 0.05, 0, 2], [-0.62, 0.065, 0.065, 0.065, 0, 2], [0.8, 0.065, 0.065, 0.065, 0, 2], [0.86, 0.04, 0.04, 0.04, 0, 2]], { n: 8, count: 6 });
}

const LIVERY = {
  scheme: 'nmf',
  demarc: [-0.1, 0, 0.08],
  ailerons: [0.55, 0.94, 0.75], flaps: [0.08, 0.53, 0.76],
  glassTop: 1.32, centreFrame: 0,
  store: C.bombOD, storeBand: -99,
  slots: ['code', 'letter', 'serial'],
  colourSlots: [],
  regions: [
    { kind: 'antiglare', z0: Z(1.95), z1: Z(3.58), ny: 0.6, colour: C.od },
    // the group colours (E): a yellow ring round the cowl lip, a red fin tip over a yellow band
    { kind: 'cowl', z1: Z(0.62), colour: C.yellow },
    { kind: 'finBand', s0: 0.86, s1: 1.1, colour: C.red },
    { kind: 'finBand', s0: 0.74, s1: 0.86, colour: C.yellow },
    { kind: 'stripes', z0: Z(6.1), w: 0.46, y1: -0.15 },
  ],
  decals: [
    { kind: 'star', surf: 'side', a: Z(7.85), b: -0.05, r: 0.45, reach: 1.1 },
    { kind: 'star', surf: 'wingTop', side: 'L', a: 4.67, b: Z(3.75), r: 0.51, reach: 1.2 },
    { kind: 'star', surf: 'wingBot', a: 4.67, b: Z(3.75), r: 0.51, reach: 1.2 },
    { kind: 'text', surf: 'side', a: Z(6.45), b: 0.0, h: 0.7, slot: 'code', colour: C.black, reach: 0.9 },
    { kind: 'text', surf: 'side', a: Z(9.18), b: 0.04, h: 0.52, slot: 'letter', colour: C.black, reach: 0.5 },
    { kind: 'text', surf: 'fin', a: Z(10.0), b: 1.25, h: 0.17, slot: 'serial', colour: C.black, reach: 0.8 },
  ],
  liveries: [
    { code: 'O7', letter: 'K', serial: '420493' },
    { code: 'O7', letter: 'D', serial: '432841' },
    { code: 'L3', letter: 'R', serial: '433102' },
    { code: '4P', letter: 'H', serial: '420618', od: true },
    { code: 'O7', letter: 'W', serial: '489742' },
    { code: 'L3', letter: 'A', serial: '433519', stripes: true },
    { code: '4P', letter: 'T', serial: '420877' },
    { code: 'L3', letter: 'G', serial: '432690', od: true },
  ],
};

export const p47 = build;
