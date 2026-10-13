import * as THREE from 'three';
import { Assembly, PART, V, D2R, loft, box, strut, sphere, sectionAt, wingAt, wingSurfaceY } from './build.js';
import { barrel, section, tube, disc } from './kit.js';
import { C } from './colours.js';
import { v3 } from './livery.js';

// Boeing B-17G Flying Fortress, late production (staggered enclosed waist windows, Bendix chin turret,
// cheek guns, Cheyenne tail turret) of the 398th Bomb Group, 1st Air Division, which bombed Rheine on
// 21 March 1945 (refs/ww2/b17): natural metal, the 1st CBW's red fin and tailplanes (the fabric rudder
// and elevators left silver, as the 398th and 91st BG colour photos show), red wingtips, the black
// Triangle W on the fin and the upper right wingtip, the tail number and call letter in yellow on the
// red fin, black squadron codes aft of the fuselage star (601st BS "3O", 600th "N7", 602nd "K8", 603rd
// "N8"), black de-icer boots, no invasion stripes (heavies never carried them). Livery 0 is 44-8771
// "3O-B" from the colour photo b17_398bg_1945_01; the others are plausible, and one is olive drab (E).
//
// Shape: the Commons three-view (b17_3view_drawing_11.png) read on a metre grid. Its span gives 37.9 px
// per metre, but its fuselage is 4.6 % longer than the published 22.66 m, so lengthwise readings are
// taken at 39.66 px per metre; the tailplane is set to 13.1 m (43 ft). Drawing stations zd are metres
// aft of the nose tip, ys metres above the drawing's reference line; model z = zd - 6.9 (the quarter MAC),
// y = ys + 0.3. Moving parts: four props, the bomb doors (open on the run: threat.doors or the bombing
// phases; the bay shows dark behind them), a feathered prop on a damaged engine.

const Z = (zd) => zd - 6.9, Y = (ys) => ys + 0.3;
const P = (pl) => pl.map(([x, a, b]) => [x, Z(a), Z(b)]);

// [zd, half width, top ys, bottom ys]
const STATIONS = [
  [1.55, 0.8, 0.52, -1.33], [2.5, 0.95, 0.65, -1.47], [3.4, 1.02, 0.75, -1.57], [4.0, 1.06, 0.92, -1.62], [4.6, 1.1, 1.08, -1.66],
  [5.5, 1.12, 1.12, -1.69], [8.0, 1.12, 1.1, -1.72], [10.0, 1.1, 0.98, -1.7], [12.0, 1.0, 0.85, -1.6], [14.0, 0.86, 0.72, -1.45],
  [16.0, 0.72, 0.6, -1.25], [18.0, 0.55, 0.45, -1.02], [20.0, 0.4, 0.3, -0.77], [21.25, 0.32, 0.2, -0.62],
];
const st = ([zd, w, t, b], e = 2.0) => [Z(zd), w, (t - b) / 2, (t - b) / 2, Y((t + b) / 2), e];
const FUS = STATIONS.map((s) => st(s));
const NOSE = [[0.04, 0.08, -0.32, -0.56], [0.35, 0.38, 0.0, -0.92], [0.8, 0.6, 0.3, -1.12], [1.2, 0.72, 0.43, -1.25], [1.56, 0.8, 0.52, -1.33]].map((s) => st(s));
const TAIL = [[21.24, 0.32, 0.2, -0.62], [21.9, 0.28, 0.1, -0.55], [22.4, 0.19, -0.04, -0.46], [22.62, 0.05, -0.2, -0.3]].map((s) => st(s));

const WING = {
  semispan: 15.81, y: Y(-0.55), dihedral: 3.5 * D2R, tRoot: 0.18, tTip: 0.1, S: 26, C: 28, x0: 0.4, washout: 2, camber: 0.012,
  // the drawing's planform with the leading edge 0.25 m further aft at the root, as the photo from
  // directly above (b17_top_04) shows
  plan: P([[0, 5.1, 10.65], [2.0, 5.4, 10.39], [5.0, 5.85, 10.0], [8.0, 6.3, 9.61], [11.0, 6.75, 9.22], [14.0, 7.15, 8.83], [15.3, 7.32, 8.66], [15.65, 7.5, 8.5], [15.81, 7.95, 8.2]]),
};
const HTAIL = {
  semispan: 6.55, y: Y(-0.3), tRoot: 0.12, tTip: 0.09, S: 14, C: 20, x0: 0.1,
  plan: P([[0, 17.2, 20.05], [1.0, 17.35, 20.0], [3.0, 17.9, 19.97], [5.5, 18.6, 19.95], [6.15, 18.87, 19.92], [6.45, 19.12, 19.8], [6.55, 19.45, 19.6]]),
};
const FIN = {
  semispan: 4.0, base: Y(0.45), tRoot: 0.12, tTip: 0.1, S: 14, C: 20,
  plan: P([[0, 16.6, 21.05], [0.5, 17.05, 20.95], [1.2, 17.45, 20.8], [2.0, 17.75, 20.6], [2.9, 18.05, 20.4], [3.5, 18.4, 20.25], [3.85, 18.85, 20.05], [4.0, 19.4, 19.7]]),
};
// the long dorsal fillet running forward to the radio room
const FILLET = {
  semispan: 2.3, base: Y(0.5), tRoot: 0.032, tTip: 0.05, S: 10, C: 14,
  plan: P([[0, 10.0, 17.6], [0.5, 10.5, 17.6], [0.8, 13.5, 17.6], [1.25, 15.9, 17.7], [1.85, 16.95, 17.8], [2.3, 17.35, 17.95]]),
};

// engines: inner and outer, x, cowl front, cowl back, centre ys, prop plane
const ENGINES = [[3.05, 3.3, 4.6, -0.85, 2.95], [6.55, 3.75, 5.0, -0.7, 3.4]];

function build() {
  const A = new Assembly();
  A.body(FUS, PART.FUSELAGE, { n: 32, count: 40, capStart: false, capEnd: false });
  A.body(NOSE, PART.GLASS, { n: 32, count: 10, capEnd: false });
  A.body(TAIL, PART.GLASS, { n: 24, count: 6, capStart: false });
  // nose glazing frame ring and the flat bomb-aiming panel
  A.add(strut(V(0, Y(-0.4), Z(1.53)), V(0, Y(-0.4), Z(1.6)), 0.82, 0.94, 24), PART.FUSELAGE);

  // flight deck windscreen: a raised glazed wedge on the nose top
  A.body([[Z(3.45), 0.55, 0.02, 0.02, Y(0.72), 2.6], [Z(3.75), 0.7, 0.14, 0.05, Y(0.76), 2.6], [Z(4.15), 0.8, 0.22, 0.05, Y(0.86), 2.6], [Z(4.5), 0.82, 0.18, 0.05, Y(0.96), 2.6], [Z(4.7), 0.8, 0.08, 0.05, Y(1.04), 2.6]], PART.GLASS, { n: 20, count: 8 });
  for (const x of [-0.42, 0.42]) A.pilot(x, Y(1.05), Z(4.55), { headrest: false });

  // Bendix chin turret and its twin .50s
  A.add(sphere(0, Y(-1.38), Z(1.55), 0.42, 1, 0.75, 1, 14, 8), PART.METAL);
  for (const x of [-0.17, 0.17]) A.add(barrel(x, Y(-1.45), Z(1.3), Z(0.25), 0.03), PART.DARK);
  // cheek guns, the left one further forward
  A.add(strut(V(-0.84, Y(-0.2), Z(1.95)), V(-1.1, Y(-0.25), Z(0.95)), 0.028, 0.028, 5), PART.DARK);
  A.add(strut(V(0.96, Y(-0.2), Z(2.65)), V(1.22, Y(-0.25), Z(1.65)), 0.028, 0.028, 5), PART.DARK);
  // astrodome
  A.add(sphere(0, Y(0.66), Z(2.2), 0.17, 1, 0.8, 1, 10, 6), PART.GLASS);
  // Sperry top turret: base ring, glazed dome, guns trained aft
  A.add(strut(V(0, Y(1.0), Z(5.4)), V(0, Y(1.22), Z(5.4)), 0.62, 0.62, 18), PART.METAL);
  A.add(sphere(0, Y(1.2), Z(5.4), 0.5, 1, 0.85, 1, 16, 8), PART.GLASS);
  for (const x of [-0.14, 0.14]) A.add(barrel(x, Y(1.38), Z(5.6), Z(6.9), 0.03), PART.DARK);
  // Sperry ball turret under the waist, guns aft
  A.add(sphere(0, Y(-1.88), Z(11.6), 0.56, 1, 1, 1, 16, 10), PART.METAL);
  A.add(strut(V(0, Y(-1.5), Z(11.6)), V(0, Y(-1.36), Z(11.6)), 0.35, 0.35, 12), PART.METAL);
  for (const x of [-0.12, 0.12]) A.add(barrel(x, Y(-1.95), Z(11.9), Z(13.2), 0.03), PART.DARK);
  // waist guns, staggered: the right window forward of the left
  A.add(strut(V(-0.86, Y(0.2), Z(13.95)), V(-1.7, Y(0.05), Z(14.2)), 0.028, 0.028, 5), PART.DARK);
  A.add(strut(V(0.93, Y(0.2), Z(12.95)), V(1.76, Y(0.05), Z(13.2)), 0.028, 0.028, 5), PART.DARK);
  // Cheyenne tail turret guns
  for (const x of [-0.13, 0.13]) A.add(barrel(x, Y(-0.28), Z(22.3), Z(23.25), 0.032), PART.DARK);

  // engines, nacelles with the turbosuperchargers under them, props
  ENGINES.forEach(([x, zF, zB, ys, zp], i) => {
    for (const s of [-1, 1]) {
      const e = { x: s * x, y: Y(ys), zF: Z(zF), zB: Z(zB), w: 0.72, wB: 0.7, inner: 0.72, n: 24 };
      A.radial(e, { rows: 1, perRow: 9, flaps: 14 });
      const nz = i === 0 ? 8.2 : 8.0;
      A.body([[Z(zB) - 0.02, 0.7, 0.7, 0.7, Y(ys), 2], [Z(zB + 0.9), 0.66, 0.6, 0.78, Y(ys - 0.02), 2.1], [Z(zB + 2.0), 0.58, 0.48, 0.74, Y(ys - 0.05), 2.1], [Z(nz - 0.7), 0.4, 0.32, 0.55, Y(ys - 0.08), 2], [Z(nz), 0.06, 0.05, 0.1, Y(ys - 0.08), 2]], PART.FUSELAGE, { n: 20, count: 10, xc: s * x });
      // turbosupercharger housing and its exhaust under the nacelle
      A.add(sphere(s * x, Y(ys - 0.72), Z(zB + 1.9), 0.24, 1, 0.55, 1.4, 10, 6), PART.METAL);
      A.add(disc(0, 0, 0, 0.09, 0.05, 8).rotateY(Math.PI).translate(s * x, Y(ys - 0.78), Z(zB + 2.25)), PART.DARK);
      A.prop({ x: s * x, y: Y(ys), z: Z(zp), r: 1.72, blades: 3, chord: 0.26, dir: -1, hub: 0.22, segs: 7, sides: 6 });
    }
  });
  // the main wheels stay partly out under the inner nacelles when retracted, the tail wheel too
  for (const s of [-1, 1]) A.add(new THREE.CylinderGeometry(0.62, 0.62, 0.36, 20).rotateZ(Math.PI / 2).translate(s * 3.05, Y(-1.15), Z(5.3)), PART.RUBBER);
  A.add(new THREE.CylinderGeometry(0.25, 0.25, 0.16, 14).rotateZ(Math.PI / 2).translate(0, Y(-1.02), Z(17.6)), PART.RUBBER);

  A.surfaces({ wing: WING, htail: HTAIL, fin: [FIN, FILLET] });
  A.fillets(FUS, WING, { x: 1.2, z0: -0.04, z1: 0.06, w: 0.3, hT: 0.2, hB: 0.1, xs: 0.9 });

  // bomb doors: two panels on the belly hinged at their outer edges, swinging down; the bay shows dark
  // behind them when open
  const zd0 = 7.7, zd1 = 10.4, hx = 0.6;
  for (const s of [-1, 1]) {
    const rings = [];
    for (const zd of [zd0, (zd0 + zd1) / 2, zd1]) {
      const [z, w, hT, hB, yc] = sectionAt(FUS, Z(zd));
      const ring = [];
      for (let k = 0; k <= 6; k++) {
        const x = (k / 6) * hx;
        const yb = yc - hB * Math.sqrt(Math.max(0, 1 - (x / w) ** 2)) - 0.012;
        ring.push(V(s * x, yb, z), V(s * x, yb + 0.04, z));
      }
      // as a closed loop: along the outer face, back along the inner
      const outer = ring.filter((_, j) => j % 2 === 0), inner = ring.filter((_, j) => j % 2 === 1).reverse();
      rings.push([...outer, ...inner]);
    }
    const [, w, , hB, yc] = sectionAt(FUS, Z(9));
    const hy = yc - hB * Math.sqrt(1 - (hx / w) ** 2);
    A.add(tube(rings, { capStart: true, capEnd: true }), PART.DOOR, { pivot: [s * hx, hy, s, 0] });
  }

  return A.finish({
    type: 'b17', length: 22.66, cap: 56, propW: 22, doors: true,
    smoke: ENGINES.flatMap(([x, zF, , ys]) => [V(-x, Y(ys), Z(zF + 1.4)), V(x, Y(ys), Z(zF + 1.4))]),
    exh: { z: 99, y: 0, x: 0, w: 0 },
    livery: LIVERY,
  });
}

const RED = C.red, YEL = C.yellow;
const LIVERY = {
  scheme: 'nmf',
  demarc: [Y(-0.4), 0, 0.08],
  ailerons: [0.62, 0.95, 0.76], flaps: [0.04, 0.6, 0.78], tailHinge: 0.68,
  glassZ: Z(1.6), glassTop: 99, centreFrame: 0,
  store: C.bombOD, storeBand: -99,
  slots: ['code', 'letter', 'serial', 'group'],
  colourSlots: [],
  regions: [
    // olive drab anti-glare panel ahead of the windscreen and on the inboard nacelle sides
    { kind: 'antiglare', z0: Z(2.4), z1: Z(3.6), ny: 0.55, colour: C.od },
    // the red fin (the fixed fin only: the fabric rudder aft of chord 0.66 stays silver), red tailplanes
    // and wingtips
    { kind: 'glsl', code: `if (acFinS && acP.y > ${(Y(0.9)).toFixed(3)} && acSf.y < 0.66 && acP.z > ${Z(16.8).toFixed(3)}) acPaint(${v3(C.red)}, 0.45, 1.0);` },
    { kind: 'glsl', code: `if (acPt == 2.0 && !acFinSurf && acSf.y < 0.7) acPaint(${v3(C.red)}, 0.45, 1.0);` },
    { kind: 'wingTip', s0: 0.86, colour: RED },
    // black de-icer boots on the wing, tailplane and fin leading edges
    { kind: 'le', part: 1, s0: 0.06, s1: 0.95, c1: 0.05, colour: '#161616', gloss: 0.85 },
    { kind: 'le', part: 2, s0: 0.05, s1: 0.95, c1: 0.06, colour: '#161616', gloss: 0.85 },
    // glazing painted on: navigator's windows, cockpit side windows, radio room, waist windows, the bay
    // when the doors are open
    { kind: 'windows', rects: [[Z(2.05), Z(2.5), Y(-0.25), Y(0.08)], [Z(2.7), Z(3.15), Y(-0.25), Y(0.08)], [Z(1.7), Z(2.15), Y(-0.45), Y(0.1), -1], [Z(2.4), Z(2.85), Y(-0.45), Y(0.1), 1],
      [Z(3.75), Z(4.65), Y(0.78), Y(1.06)], [Z(9.8), Z(10.35), Y(0.3), Y(0.62)], [Z(13.5), Z(14.4), Y(-0.05), Y(0.5), -1], [Z(12.5), Z(13.4), Y(-0.05), Y(0.52), 1]] },
    { kind: 'glsl', code: `if (acPt == 0.0 && acS.w - 2.0 * floor(acS.w * 0.5 + 0.001) > 0.05 && abs(acP.x) < 0.6 && acP.y < ${Y(-1.3).toFixed(3)} && acP.z > ${Z(7.7).toFixed(3)} && acP.z < ${Z(10.4).toFixed(3)}) acPaint(vec3(0.03), 0.9, 1.0);` },
  ],
  decals: [
    // fuselage star: on the left between the wing and the waist window, on the right aft of its window
    { kind: 'star', surf: 'side', side: 'L', a: Z(12.2), b: Y(-0.35), r: 0.62, reach: 1.5 },
    { kind: 'star', surf: 'side', side: 'R', a: Z(14.75), b: Y(-0.32), r: 0.56, reach: 1.4 },
    { kind: 'text', surf: 'side', side: 'L', a: Z(15.85), b: Y(-0.33), h: 1.1, slot: 'code', colour: C.black, reach: 1.6 },
    { kind: 'text', surf: 'side', side: 'R', a: Z(17.6), b: Y(-0.3), h: 0.95, slot: 'code', colour: C.black, reach: 1.4 },
    { kind: 'star', surf: 'wingTop', side: 'L', a: 12.4, b: Z(8.35), r: 0.92, reach: 2.1 },
    { kind: 'star', surf: 'wingBot', side: 'R', a: 12.4, b: Z(8.35), r: 0.92, reach: 2.1 },
    // the Triangle W on the fin and the upper right wing, the tail number and call letter in yellow
    { kind: 'tri', surf: 'fin', a: Z(18.95), b: Y(3.55), size: 1.5, slot: 'group', colour: C.black, letter: C.insWhite, reach: 1.0 },
    { kind: 'text', surf: 'fin', a: Z(18.75), b: Y(2.55), h: 0.32, slot: 'serial', colour: YEL, reach: 1.3 },
    { kind: 'text', surf: 'fin', a: Z(18.6), b: Y(1.65), h: 0.8, slot: 'letter', colour: YEL, reach: 0.6 },
    { kind: 'tri', surf: 'wingTop', side: 'R', a: 12.6, b: Z(8.25), size: 2.0, slot: 'group', colour: C.black, letter: C.insWhite, reach: 1.4 },
  ],
  liveries: [
    { code: '3OB', letter: 'B', serial: '48771', group: 'W' },
    { code: 'N7K', letter: 'K', serial: '338345', group: 'W' },
    { code: 'K8P', letter: 'P', serial: '48826', group: 'W' },
    { code: 'N8T', letter: 'T', serial: '338907', group: 'W' },
    { code: '3OG', letter: 'G', serial: '46512', group: 'W' },
    { code: 'N7D', letter: 'D', serial: '297318', group: 'W', od: true },
    { code: 'K8F', letter: 'F', serial: '48603', group: 'W' },
    { code: 'N8L', letter: 'L', serial: '338512', group: 'W' },
  ],
};

export const b17 = build;
