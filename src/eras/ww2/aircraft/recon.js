import { Assembly, PART, V, D2R, loft, box, strut, wingAt, wingSurfaceY } from './build.js';
import { disc } from './kit.js';
import { C } from './colours.js';

// Supermarine Spitfire PR.XI, the recon sheet's first choice (refs/ww2/recon): an unarmed high-altitude
// photo aircraft of No. 16 Squadron, 34 Wing, 2nd TAF, over north-west Germany in 1945. Overall PRU blue;
// the deep chin of the larger oil tank and the long carburettor intake under the nose, the wrap-around
// PR windscreen, clean leading edges (no guns), the two Merlin 60-series radiators under the wings, the
// four-blade Rotol 3.27 m prop, the large pointed rudder, two F52 camera ports under the rear fuselage.
// Markings: C1 roundels on the fuselage and (2nd TAF from January 1945) the upper wings, C under the
// wings, the fin flash, a black individual letter and serial; and the invasion stripes under the rear
// fuselage, which 34 Wing's Spitfires were exempted from removing at the end of 1944 (refs/ww2/markings
// 6.3; the wing stripes had gone in August and September 1944). PL965 "R", which flew with 16 Sqn, is
// livery 0; the other serials are plausible PR.XI ones (E).
//
// Shape: the Commons three-view "Supermarine Spitfire Mk Vb 3-view.svg" (Marek Cel, CC0; 175.1 px per
// metre at 1920 px), whose wing (11.23 m), tail and fuselage are the PR.XI's; its length matches the
// Mk IX family's 9.47 m. The PR.XI's own nose, chin, radiators, windscreen and rudder are modelled on
// the sheet's text and the PL965 photos. Stations zd are metres aft of the spinner tip, y up from the
// spinner axis; model z = zd - 2.55. Moving parts: the prop (clockwise from the cockpit).

const Z = (zd) => zd - 2.55;
const P = (pl) => pl.map(([x, a, b]) => [x, Z(a), Z(b)]);
const st = ([zd, w, t, b], e = 2.05) => [Z(zd), w, (t - b) / 2, (t - b) / 2, (t + b) / 2, e];
const FUS = [
  [0.6, 0.3, 0.32, -0.31], [0.85, 0.37, 0.35, -0.47], [1.2, 0.4, 0.36, -0.57], [1.8, 0.42, 0.38, -0.61], [2.5, 0.43, 0.38, -0.64],
  [3.4, 0.44, 0.4, -0.68], [4.2, 0.44, 0.52, -0.72], [4.9, 0.42, 0.58, -0.72], [5.4, 0.38, 0.55, -0.69], [6.0, 0.33, 0.5, -0.62],
  [7.0, 0.25, 0.43, -0.52], [8.0, 0.17, 0.34, -0.42], [8.8, 0.1, 0.27, -0.33], [9.35, 0.03, 0.2, -0.22],
].map((s) => st(s));
// the hood 0.3 m aft of the Vb drawing's, as PL965 shows (the Mk IX family's longer nose)
const CANOPY = [[3.62, 0.25, 0.02, 0.38], [3.85, 0.3, 0.12, 0.38], [4.12, 0.32, 0.25, 0.38], [4.45, 0.31, 0.3, 0.38], [4.75, 0.27, 0.24, 0.4], [4.92, 0.2, 0.12, 0.42], [5.05, 0.1, 0.02, 0.44]].map(([z, ...r]) => [Z(z), ...r]);

const WING = {
  semispan: 5.615, y: -0.55, dihedral: 6 * D2R, tRoot: 0.13, tTip: 0.06, S: 24, C: 26, x0: 0.2, washout: 2, camber: 0.012,
  plan: P([[0, 1.94, 4.47], [1.0, 1.95, 4.45], [2.0, 1.98, 4.42], [3.0, 2.08, 4.32], [4.0, 2.2, 4.05], [5.0, 2.45, 3.6], [5.4, 2.65, 3.25], [5.58, 2.82, 3.05], [5.615, 2.93, 2.97]]),
};
const HTAIL = { semispan: 1.62, y: 0.12, tRoot: 0.11, tTip: 0.08, S: 12, C: 16, x0: 0.05, plan: P([[0, 7.95, 9.3], [0.6, 8.05, 9.3], [1.0, 8.2, 9.26], [1.3, 8.38, 9.18], [1.52, 8.6, 9.05], [1.62, 8.85, 8.88]]) };
const FIN = { semispan: 1.36, base: -0.3, tRoot: 0.1, tTip: 0.08, S: 12, C: 16, plan: P([[0, 9.05, 9.3], [0.3, 8.6, 9.42], [0.6, 7.9, 9.43], [0.9, 8.15, 9.4], [1.1, 8.42, 9.33], [1.25, 8.66, 9.2], [1.33, 8.86, 9.04], [1.36, 8.98, 8.96]]) };

function build() {
  const A = new Assembly();
  A.body(FUS, PART.FUSELAGE, { n: 28, count: 30 });
  // the long carburettor intake (Vokes filter) under the nose
  A.body([[Z(1.35), 0.07, 0.03, 0.05, -0.6, 2.4], [Z(1.55), 0.1, 0.05, 0.08, -0.62, 2.6], [Z(2.45), 0.1, 0.05, 0.07, -0.66, 2.6], [Z(2.75), 0.03, 0.02, 0.02, -0.67, 2]], PART.FUSELAGE, { n: 12 });
  A.add(disc(0, -0.63, Z(1.36), 0.08, 0.05, 10), PART.RADIATOR);
  A.prop({ x: 0, y: 0, z: Z(0.55), r: 1.635, blades: 4, chord: 0.22, dir: -1, spinner: [Z(0), Z(0.62), 0.3, 0.75] });
  A.canopy(CANOPY, { frames: [Z(3.64), Z(4.12)], rail: false });
  A.pilot(0, 0.6, Z(4.5));
  // three pairs of exhaust stacks a side
  for (const s of [-1, 1]) for (let k = 0; k < 6; k++) {
    const z = Z(0.95 + k * 0.15);
    A.add(strut(V(s * 0.36, 0.17, z), V(s * 0.44, 0.15, z + 0.06), 0.03, 0.045, 6, 0.026, 0.04), PART.METAL);
  }
  A.surfaces({ wing: WING, htail: HTAIL, fin: [FIN] });
  A.fillets(FUS, WING, { x: 0.45, z0: -0.05, z1: 0.2, w: 0.2, hT: 0.1, hB: 0.05 });
  // the radiators under the wings, symmetric on the Merlin 60 series
  for (const s of [-1, 1]) {
    const x = 1.55, w = wingAt(WING, x), y = wingSurfaceY(WING, x, 0.4, -1);
    A.body([[w.le + 0.95, 0.24, 0.05, 0.02, y - 0.04, 3], [w.le + 1.05, 0.25, 0.08, 0.13, y - 0.08, 3], [w.le + 1.85, 0.25, 0.08, 0.12, y - 0.08, 3], [w.le + 2.2, 0.22, 0.05, 0.03, y - 0.03, 3]], PART.FUSELAGE, { n: 14, xc: s * x });
    A.add(disc(s * x, y - 0.1, w.le + 0.97, 0.22, 0.08, 12), PART.RADIATOR);
  }
  // camera ports under the rear fuselage
  for (const zd of [5.55, 5.95]) A.add(disc(0, 0, 0, 0.09, 0.09, 12).rotateX(-Math.PI / 2).translate(0, -0.665, Z(zd)), PART.GLASS);
  return A.finish({
    type: 'recon', length: 9.47, exh: { z: Z(1.85), y: 0.14, x: 0.41, w: 0.1, len: 2.4 }, well: [1.1, Z(2.6), 0.42], propW: 24,
    smoke: [V(0, 0, Z(1.3))],
    livery: LIVERY,
  });
}

const LIVERY = {
  scheme: 'pru',
  demarc: [0, 0, 0.06],
  ailerons: [0.6, 0.95, 0.75], flaps: [0.06, 0.5, 0.8],
  glassTop: 99, centreFrame: 0,
  slots: ['letter', 'serial'],
  colourSlots: [],
  regions: [
    { kind: 'spinner', colour: C.pru },
    { kind: 'flash', z0: Z(8.48), z1: Z(8.9), y0: 0.38, y1: 0.8 },
    { kind: 'stripes', z0: Z(5.2), w: 0.457, y1: -0.02 },
  ],
  decals: [
    { kind: 'roundel', type: 'C1', surf: 'side', a: Z(6.15), b: -0.06, r: 0.457, reach: 0.6 },
    { kind: 'roundel', type: 'C1', surf: 'wingTop', a: 4.0, b: Z(3.1), r: 0.62, reach: 0.7 },
    { kind: 'roundel', type: 'C', surf: 'wingBot', a: 4.0, b: Z(3.1), r: 0.41, reach: 0.5 },
    { kind: 'text', surf: 'side', a: Z(7.2), b: -0.05, h: 0.5, slot: 'letter', colour: '#141414', reach: 0.4 },
    { kind: 'text', surf: 'side', a: Z(7.95), b: -0.06, h: 0.17, slot: 'serial', colour: '#141414', reach: 0.6 },
  ],
  liveries: [
    { letter: 'R', serial: 'PL965', stripes: true },
    { letter: 'A', serial: 'PL883', stripes: true },
    { letter: 'C', serial: 'PL758', stripes: true },
    { letter: 'F', serial: 'PA944', stripes: true },
  ],
};

export const recon = build;
