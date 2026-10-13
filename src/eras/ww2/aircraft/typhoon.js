import { Assembly, PART, V, D2R, loft, box, strut, sphere, wingAt, wingSurfaceY } from './build.js';
import { barrel, disc } from './kit.js';
import { C } from './colours.js';
import { rp3Geometry } from './ordnance.js';

// Hawker Typhoon Mk IB, late production, of a 2nd TAF rocket squadron in February and March 1945
// (refs/ww2/typhoon): the one-piece sliding hood on the cut-down spine, the four-blade propeller, the
// Tempest tailplane, four 20 mm Hispanos with their barrel fairings, four RP-3 rails under each outer
// wing with eight 60 lb rockets (load 0) or two 500 lb bombs (load 1), 45 gal tanks (tanks). The Day
// Fighter Scheme, Dark Green and Ocean Grey over Medium Sea Grey; from January 1945 Type C1 roundels on
// the fuselage, the upper (55 in) and lower (36 in) wings, the fin flash, the yellow leading-edge strips
// outboard of the cannon; black spinner, no Sky band and no invasion stripes (MN875 at Helmond, 23 Feb
// 1945). Codes in Sky reading code, roundel, letter on both sides (MN875 right, MN235 left), the serial
// in black under the tailplane. Liveries: MN875 "EL-B" of 181 Sqn, RB396 "XP-W" of 174 Sqn, RB402 "5V-P"
// of 439 Sqn, MN234 "SF-T" of 137 Sqn (documented); the rest plausible (E).
//
// Shape: the Commons three-view "Hawker Typhoon 3-view.svg" (Franckd, Free Art Licence; 131.2 px per
// metre at 1920 px), its side view levelled from the ground attitude by 11 degrees: span 12.67 m, length
// 9.74 m, the chin radiator, the inverted gull (1 degree anhedral inboard of the break at 2.3 m, 5.5
// outboard). Stations zd are metres aft of the spinner tip, y up from the thrust line; model z = zd - 2.3.
// Moving parts: the prop (anticlockwise from the cockpit, the Sabre's take-off swing to the right),
// rockets and bombs, the tanks.

const Z = (zd) => zd - 2.3;
const P = (pl) => pl.map(([x, a, b]) => [x, Z(a), Z(b)]);
// side view heights are read above the drawing's line through the spinner tip, 0.07 m under the axis
const st = ([zd, w, t, b], e = 2.15) => [Z(zd), w, (t - b) / 2, (t - b) / 2, (t + b) / 2 - 0.07, e];
const FUS = [
  [0.55, 0.42, 0.5, -0.38], [0.72, 0.45, 0.57, -0.86], [1.0, 0.47, 0.61, -0.96], [1.5, 0.5, 0.65, -0.98], [2.2, 0.52, 0.68, -0.93],
  [3.0, 0.51, 0.7, -0.88], [4.0, 0.46, 0.68, -0.84], [5.0, 0.39, 0.65, -0.75], [6.0, 0.31, 0.6, -0.64], [7.0, 0.23, 0.53, -0.55],
  [8.0, 0.16, 0.46, -0.47], [9.0, 0.09, 0.38, -0.38], [9.62, 0.03, 0.3, -0.26],
].map((s) => st(s));
const CANOPY = [[3.0, 0.3, 0.02, 0.6], [3.2, 0.34, 0.15, 0.6], [3.45, 0.36, 0.33, 0.6], [3.8, 0.36, 0.41, 0.6], [4.3, 0.33, 0.37, 0.6], [4.6, 0.27, 0.24, 0.6], [4.85, 0.14, 0.05, 0.6]].map(([z, ...r]) => [Z(z), ...r]);

const WING = {
  semispan: 6.335, y: -0.66, gull: [2.3, -1 * D2R], dihedral: 5.5 * D2R, tRoot: 0.195, tTip: 0.12, S: 22, C: 26, x0: 0.2, washout: 1.5, camber: 0.014,
  plan: P([[0, 1.68, 4.5], [0.7, 1.69, 4.42], [2.0, 1.72, 4.1], [3.5, 1.78, 3.75], [5.0, 1.86, 3.4], [5.9, 1.92, 3.15], [6.2, 2.05, 2.95], [6.3, 2.25, 2.75], [6.335, 2.5, 2.55]]),
};
const HTAIL = { semispan: 2.2, y: 0.22, tRoot: 0.12, tTip: 0.09, S: 12, C: 18, x0: 0.05, plan: P([[0, 7.6, 8.95], [1.0, 7.73, 8.92], [1.7, 7.88, 8.86], [2.0, 8.0, 8.78], [2.15, 8.2, 8.6], [2.2, 8.4, 8.42]]) };
const FIN = {
  semispan: 2.08, base: -0.65, tRoot: 0.12, tTip: 0.09, S: 14, C: 18,
  plan: P([[0, 9.3, 9.65], [0.4, 8.9, 9.75], [1.0, 8.05, 9.76], [1.4, 8.35, 9.75], [1.75, 8.65, 9.72], [1.95, 8.88, 9.65], [2.05, 9.1, 9.52], [2.08, 9.3, 9.35]]),
};

function build() {
  const A = new Assembly();
  A.body(FUS, PART.FUSELAGE, { n: 32, count: 32 });
  // the chin radiator's mouth under the spinner
  A.add(disc(0, -0.62, Z(0.7), 0.36, 0.21, 18), PART.RADIATOR);
  A.prop({ x: 0, y: 0, z: Z(0.5), r: 1.95, blades: 4, chord: 0.27, dir: 1, spinner: [Z(0), Z(0.58), 0.43, 0.3] });
  A.canopy(CANOPY, { frames: [Z(3.02), Z(3.42)], rail: false });
  A.pilot(0, 0.84, Z(3.95));
  A.add(box(0.08, 0.12, 0.12, 0, 0.72, Z(3.32)), PART.DARK, { flat: true });
  A.add(strut(V(0, 0.55, Z(5.6)), V(0, 0.95, Z(5.85)), 0.012, 0.012, 4), PART.DARK);
  // six exhaust ports a side in a long fairing
  for (const s of [-1, 1]) {
    A.body([[Z(0.85), 0.01, 0.01, 0.01, 0.17, 2], [Z(0.95), 0.05, 0.06, 0.06, 0.17, 2], [Z(1.75), 0.05, 0.06, 0.06, 0.15, 2], [Z(1.9), 0.01, 0.01, 0.01, 0.15, 2]], PART.METAL, { n: 10, xc: s * 0.47 });
    for (let k = 0; k < 6; k++) A.add(disc(0, 0, 0, 0.04, 0.035, 8).rotateY(-s * Math.PI / 2).translate(s * 0.522, 0.16, Z(1.03 + k * 0.13)), PART.DARK);
  }
  A.surfaces({ wing: WING, htail: HTAIL, fin: [FIN] });
  A.fillets(FUS, WING, { x: 0.55, z0: -0.05, z1: 0.12, w: 0.24, hT: 0.15, hB: 0.06 });
  // four 20 mm Hispano Mk II, the barrels well forward of the leading edge in tubular fairings
  for (const s of [-1, 1]) for (const x of [2.62, 3.38]) {
    const w = wingAt(WING, x);
    A.add(barrel(s * x, w.y - 0.02, w.le + 0.15, w.le - 0.95, 0.025), PART.DARK);
    A.add(strut(V(s * x, w.y - 0.02, w.le + 0.1), V(s * x, w.y - 0.02, w.le - 0.45), 0.055, 0.055, 8, 0.035, 0.035), PART.FUSELAGE);
  }
  // RP-3 rails, four a side under the outer wing, and their rockets (load 0): they go in pairs as the
  // sim's count (threat.rockets) falls, the outer pair first
  const rails = [3.95, 4.4, 4.85, 5.3];
  for (const s of [-1, 1]) rails.forEach((x, i) => {
    const w = wingAt(WING, x), y = wingSurfaceY(WING, x, 0.3, -1);
    A.add(box(0.035, 0.07, 1.65, s * x, y - 0.06, w.le + 0.55), PART.METAL, { flat: true });
    A.store(rp3Geometry().translate(s * x, y - 0.2, w.le + 0.3), 0, i * 2 + (s > 0 ? 1 : 0));
  });
  // bomb racks inboard of the cannon: two 500 lb (load 1), or 45 gal tanks (tanks)
  for (const s of [-1, 1]) {
    const x = 2.0, w = wingAt(WING, x), y = wingSurfaceY(WING, x, 0.3, -1), zc = w.le + w.c * 0.3;
    A.add(box(0.07, 0.16, 0.6, s * x, y - 0.06, zc), PART.FUSELAGE, { flat: true });
    A.store(loft([[-0.75, 0.03, 0.03, 0.03, 0, 2], [-0.6, 0.12, 0.12, 0.12, 0, 2], [-0.35, 0.17, 0.17, 0.17, 0, 2], [0.3, 0.17, 0.17, 0.17, 0, 2], [0.55, 0.09, 0.09, 0.09, 0, 2]], { n: 12, count: 9, xc: s * x }).translate(0, y - 0.32, zc - 0.1), 1, 0);
    A.store(loft([[-0.95, 0.02, 0.02, 0.02, 0, 2], [-0.7, 0.18, 0.18, 0.18, 0, 2], [-0.2, 0.22, 0.22, 0.22, 0, 2], [0.4, 0.22, 0.22, 0.22, 0, 2], [0.9, 0.08, 0.08, 0.08, 0, 2]], { n: 12, count: 10, xc: s * x }).translate(0, y - 0.36, zc - 0.05), 10, 0);
  }
  return A.finish({
    type: 'typhoon', length: 9.74, exh: { z: Z(1.85), y: 0.15, x: 0.48, w: 0.1, len: 2.4 }, well: [1.5, Z(2.4), 0.6], propW: 22,
    smoke: [V(0, 0, Z(1.4))], stores: { 0: 8, 1: 2 }, storeField: 'rockets',
    livery: rafLivery({
      roundel: Z(6.1), roundelY: -0.06, codeFwd: Z(5.0), codeAft: Z(7.22), letterFwd: Z(5.25), letterAft: Z(6.97), codeY: -0.04, codeH: 0.7,
      serial: [Z(8.35), -0.18, 0.18], flash: [Z(8.62), Z(9.23), 0.4, 1.01], wingX: 4.6, wingZ: Z(2.62), leStrip: [0.6, 0.97],
      demarc: [-0.42, 0.035, 0.06], ailerons: [0.6, 0.95, 0.74], flaps: [0.06, 0.55, 0.78],
    }, [
      { code: 'EL', letter: 'B', serial: 'MN875' },
      { code: 'XP', letter: 'W', serial: 'RB396' },
      { code: '5V', letter: 'P', serial: 'RB402' },
      { code: 'SF', letter: 'T', serial: 'MN234' },
      { code: 'EL', letter: 'Y', serial: 'PD611' },
      { code: 'XP', letter: 'D', serial: 'RB281' },
      { code: 'HH', letter: 'K', serial: 'SW496' },
      { code: 'MR', letter: 'R', serial: 'RB389' },
    ]),
  });
}

/**
 * The 2nd TAF day fighter livery of January to April 1945 (refs/ww2/markings 7.1 and 7.2), shared by the
 * Typhoon and the Tempest: positions in model space for the fuselage roundel, the codes either side
 * (read code, roundel, letter on both sides: the code forward on the left, aft on the right), the
 * serial, the fin flash, the wing roundels and the yellow leading-edge strip (span fractions).
 */
export function rafLivery(o, liveries) {
  return {
    scheme: 'raf',
    upper: C.oceanGrey, upper2: C.darkGreen, lower: C.seaGrey,
    demarc: o.demarc, ailerons: o.ailerons, flaps: o.flaps,
    glassTop: 99, centreFrame: 0,
    store: C.rafStore, storeBand: -99,
    slots: ['code', 'letter', 'serial'],
    colourSlots: [],
    regions: [
      { kind: 'spinner', colour: '#141414' },
      { kind: 'le', part: 1, s0: o.leStrip[0], s1: o.leStrip[1], c1: 0.035, colour: C.rafYellow },
      { kind: 'flash', z0: o.flash[0], z1: o.flash[1], y0: o.flash[2], y1: o.flash[3] },
    ],
    decals: [
      { kind: 'roundel', type: 'C1', surf: 'side', a: o.roundel, b: o.roundelY, r: 0.457, reach: 0.6 },
      { kind: 'roundel', type: 'C1', surf: 'wingTop', a: o.wingX, b: o.wingZ, r: 0.7, reach: 0.8 },
      { kind: 'roundel', type: 'C1', surf: 'wingBot', a: o.wingX, b: o.wingZ, r: 0.457, reach: 0.6 },
      { kind: 'text', surf: 'side', side: 'L', a: o.codeFwd, b: o.codeY, h: o.codeH, slot: 'code', colour: C.sky, reach: 0.8 },
      { kind: 'text', surf: 'side', side: 'R', a: o.codeAft, b: o.codeY, h: o.codeH, slot: 'code', colour: C.sky, reach: 0.8 },
      { kind: 'text', surf: 'side', side: 'L', a: o.letterAft, b: o.codeY, h: o.codeH, slot: 'letter', colour: C.sky, reach: 0.5 },
      { kind: 'text', surf: 'side', side: 'R', a: o.letterFwd, b: o.codeY, h: o.codeH, slot: 'letter', colour: C.sky, reach: 0.5 },
      { kind: 'text', surf: 'side', a: o.serial[0], b: o.serial[1], h: o.serial[2], slot: 'serial', colour: '#141414', reach: 0.7 },
    ],
    liveries,
  };
}

export const typhoon = build;
