import { Assembly, PART, V, D2R, loft, box, strut, wingAt, wingSurfaceY } from './build.js';
import { barrel, disc } from './kit.js';
import { rafLivery } from './typhoon.js';

// Hawker Tempest V Series 2 of 122 Wing at Volkel, February and March 1945 (refs/ww2/tempest): the rat
// scramble's jet hunter over Rheine and Hopsten. The Typhoon's family likeness with the longer nose (the
// engine 21 in further forward ahead of a new fuselage tank: length 10.26 m), the same chin radiator,
// the thin near-elliptical wing (12.50 m, 28.06 m2) with straight dihedral and no gull, the dorsal fin
// fillet, the big four-blade 4.27 m prop, the short Hispano Mk V muzzles flush with the leading edge,
// streamlined 45 gal drop tanks (tanks). Paint as the 2nd TAF ordered on 3 January 1945 (typhoon.js
// rafLivery): Dark Green and Ocean Grey over Medium Sea Grey, black spinner, no Sky band, no stripes,
// C1 roundels. Liveries: 274 Sqn EJ714 "JJ-W", 486 Sqn EJ627 "SA-E", 80 Sqn EJ638 "W2-B" and EJ705
// "W2-X" (documented, refs/ww2/tempest section 9); 3 Sqn "JF-E" (Clostermann's; its serial NV724 is not
// confirmed in the sheet) and the rest plausible (E).
//
// Shape: no Tempest V three-view was available, so the fuselage is the Typhoon's (typhoon.js, read off
// its three-view) with 0.52 m added in the nose, the wing an ellipse sized to the published span and
// area (root chord 2.86 m) with its 30 % chord line straight, the dorsal fillet from the photos
// (tempest_side_parked_01, tempest_museum_tail_11), dihedral about 5.5 degrees (tempest_486_volkel_1945_13).
// Stations zd are metres aft of the spinner tip; model z = zd - 2.85, y up from the thrust line.
// The roundel, codes and fin flash sit where the photo of NX201 has them (camera-matched overlay).
// Moving parts: the prop (anticlockwise from the cockpit, as the Typhoon's Sabre), the tanks.

const Z = (zd) => zd - 2.85;
const P = (pl) => pl.map(([x, a, b]) => [x, Z(a), Z(b)]);
const st = ([zd, w, t, b], e = 2.15) => [Z(zd), w, (t - b) / 2, (t - b) / 2, (t + b) / 2 - 0.07, e];
// the Typhoon's stations, the nose stretched (0.55 to 2.2 becomes 0.55 to 2.72) and the rest 0.52 aft
const FUS = [
  [0.55, 0.42, 0.5, -0.36], [0.75, 0.44, 0.56, -0.78], [1.1, 0.46, 0.6, -0.9], [1.7, 0.49, 0.64, -0.94], [2.3, 0.51, 0.67, -0.92],
  [2.72, 0.52, 0.68, -0.91], [3.52, 0.51, 0.7, -0.87], [4.52, 0.46, 0.68, -0.83], [5.52, 0.39, 0.65, -0.74], [6.52, 0.31, 0.6, -0.63],
  [7.52, 0.23, 0.53, -0.54], [8.52, 0.16, 0.46, -0.46], [9.52, 0.09, 0.38, -0.37], [10.14, 0.03, 0.3, -0.26],
].map((s) => st(s));
const CANOPY = [[3.52, 0.3, 0.02, 0.6], [3.72, 0.34, 0.15, 0.6], [3.97, 0.36, 0.33, 0.6], [4.32, 0.36, 0.41, 0.6], [4.82, 0.33, 0.37, 0.6], [5.12, 0.27, 0.24, 0.6], [5.37, 0.14, 0.05, 0.6]].map(([z, ...r]) => [Z(z), ...r]);

// the ellipse: chord c(x) = 2.86 sqrt(1 - (x/6.25)^2), its 30 % line at zd 3.2
const ellipse = [];
for (const u of [0, 0.25, 0.45, 0.6, 0.72, 0.82, 0.9, 0.95, 0.98, 1]) {
  const x = u * 6.25, c = 2.86 * Math.sqrt(Math.max(0, 1 - u * u)) * (u < 1 ? 1 : 0) + (u === 1 ? 0.12 : 0);
  ellipse.push([x, 3.2 - 0.3 * c, 3.2 + 0.7 * c]);
}
const WING = { semispan: 6.25, y: -0.62, dihedral: 5.5 * D2R, tRoot: 0.145, tTip: 0.1, S: 24, C: 26, x0: 0.2, washout: 1.5, camber: 0.012, plan: P(ellipse) };
const HTAIL = { semispan: 2.3, y: 0.22, tRoot: 0.12, tTip: 0.09, S: 12, C: 18, x0: 0.05, plan: P([[0, 8.12, 9.47], [1.0, 8.25, 9.44], [1.8, 8.4, 9.38], [2.1, 8.52, 9.3], [2.25, 8.72, 9.12], [2.3, 8.92, 8.94]]) };
const FIN = {
  semispan: 2.12, base: -0.65, tRoot: 0.12, tTip: 0.09, S: 14, C: 18,
  plan: P([[0, 9.82, 10.17], [0.4, 9.42, 10.27], [1.0, 8.57, 10.28], [1.4, 8.87, 10.27], [1.75, 9.17, 10.24], [1.97, 9.4, 10.17], [2.08, 9.62, 10.04], [2.12, 9.82, 9.87]]),
};
const FILLET = { semispan: 0.42, base: 0.28, tRoot: 0.1, tTip: 0.1, S: 5, C: 12, plan: P([[0, 7.2, 8.9], [0.1, 7.7, 8.9], [0.2, 8.15, 8.88], [0.3, 8.45, 8.85], [0.42, 8.7, 8.82]]) };

function build() {
  const A = new Assembly();
  A.body(FUS, PART.FUSELAGE, { n: 32, count: 34 });
  A.add(disc(0, -0.58, Z(0.72), 0.34, 0.18, 18), PART.RADIATOR);
  A.prop({ x: 0, y: 0, z: Z(0.5), r: 2.135, blades: 4, chord: 0.28, dir: 1, spinner: [Z(0), Z(0.58), 0.43, 0.3] });
  A.canopy(CANOPY, { frames: [Z(3.54), Z(3.94)], rail: false });
  A.pilot(0, 0.84, Z(4.47));
  A.add(box(0.08, 0.12, 0.12, 0, 0.72, Z(3.84)), PART.DARK, { flat: true });
  A.add(strut(V(0, 0.55, Z(6.1)), V(0, 0.95, Z(6.35)), 0.012, 0.012, 4), PART.DARK);
  for (const s of [-1, 1]) {
    A.body([[Z(1.15), 0.01, 0.01, 0.01, 0.17, 2], [Z(1.25), 0.05, 0.06, 0.06, 0.17, 2], [Z(2.05), 0.05, 0.06, 0.06, 0.15, 2], [Z(2.2), 0.01, 0.01, 0.01, 0.15, 2]], PART.METAL, { n: 10, xc: s * 0.475 });
    for (let k = 0; k < 6; k++) A.add(disc(0, 0, 0, 0.04, 0.035, 8).rotateY(-s * Math.PI / 2).translate(s * 0.527, 0.16, Z(1.33 + k * 0.13)), PART.DARK);
  }
  A.surfaces({ wing: WING, htail: HTAIL, fin: [FIN, FILLET] });
  A.fillets(FUS, WING, { x: 0.55, z0: -0.05, z1: 0.14, w: 0.24, hT: 0.14, hB: 0.06 });
  // Series 2: the short Hispano Mk V, only the muzzles at the leading edge
  for (const s of [-1, 1]) for (const x of [2.45, 3.1]) {
    const w = wingAt(WING, x);
    A.add(barrel(s * x, w.y - 0.01, w.le + 0.1, w.le - 0.08, 0.03), PART.DARK);
  }
  // streamlined 45 gal drop tanks
  for (const s of [-1, 1]) {
    const x = 2.2, w = wingAt(WING, x), y = wingSurfaceY(WING, x, 0.3, -1), zc = w.le + w.c * 0.32;
    A.store(loft([[-0.95, 0.02, 0.02, 0.02, 0, 2], [-0.7, 0.18, 0.18, 0.18, 0, 2], [-0.2, 0.23, 0.23, 0.23, 0, 2], [0.4, 0.22, 0.22, 0.22, 0, 2], [0.95, 0.04, 0.04, 0.04, 0, 2]], { n: 12, count: 10, xc: s * x }).translate(0, y - 0.3, zc), 10, 0);
    A.store(box(0.05, 0.12, 0.5, s * x, y - 0.05, zc), 10, 0, true);
  }
  return A.finish({
    type: 'tempest', length: 10.26, exh: { z: Z(2.15), y: 0.15, x: 0.48, w: 0.1, len: 2.4 }, well: [1.6, Z(2.95), 0.62], propW: 22,
    smoke: [V(0, 0, Z(1.6))],
    livery: rafLivery({
      roundel: Z(6.12), roundelY: -0.06, codeFwd: Z(5.02), codeAft: Z(7.24), letterFwd: Z(5.27), letterAft: Z(6.99), codeY: -0.04, codeH: 0.7,
      serial: [Z(8.6), -0.2, 0.18], flash: [Z(9.2), Z(9.81), 0.42, 1.03], wingX: 4.4, wingZ: Z(3.1), leStrip: [0.55, 0.97],
      demarc: [-0.42, 0.035, 0.06], ailerons: [0.58, 0.95, 0.74], flaps: [0.06, 0.55, 0.78],
    }, [
      { code: 'JJ', letter: 'W', serial: 'EJ714' },
      { code: 'JF', letter: 'E', serial: 'NV724' },
      { code: 'SA', letter: 'E', serial: 'EJ627' },
      { code: 'W2', letter: 'B', serial: 'EJ638' },
      { code: 'JF', letter: 'B', serial: 'NV640' },
      { code: 'W2', letter: 'X', serial: 'EJ705' },
      { code: 'US', letter: 'K', serial: 'SN129' },
      { code: 'JJ', letter: 'Y', serial: 'NV651' },
    ]),
  });
}

export const tempest = build;
