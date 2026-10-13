import * as THREE from 'three';
import { Assembly, PART, V, D2R, loft, box, strut, sphere, sectionAt } from './build.js';
import { barrel, tube } from './kit.js';
import { C } from './colours.js';

// Douglas A-26B and A-26C Invader of the 416th Bomb Group, 9th Air Force, which bombed the jet
// airfield at Rheine on 13 March 1945 (refs/ww2/a26): one model with both noses, the solid six-gun
// nose of the A-26B and the glazed bombardier nose of the A-26C, picked per livery (each flight of six
// is led by an A-26C: slots 0 and 6 of a box, threat.slotI, or one in six by its id). Natural metal (the
// 669th BS aircraft of late 1944), one livery olive drab as the 416th's 1945 colour photo looks; the olive drab
// anti-glare panel; black codes, the squadron code forward of the star and the letter aft (668th BS
// "5H", 669th "2A", 670th "F6", 671st "5C"); the dark band along the rudder trailing edge the photos
// show; the tail number in black on the fin. Liveries: the Rheine mission's loading list (F6-W
// 43-22501, F6-T 43-22528 and 5H-P 43-22481 are A-26Cs; 2A-C 43-22344, 2A-V 43-22383 and 5C-J 43-22352
// A-26Bs), 2A-O 43-22301 and a 2A-K of the 669th's formation photo (its serial E).
//
// Shape: the USAF three-view of the B-26B/C Invader (a26_3view_drawing_07.png; side view 51.1 px per
// metre, plan view 51.9): span 21.34 m, length 15.47 m (the drawing's 609 in), wing dihedral 4.5 and
// tailplane 10.5 degrees, engines 2.97 m out, Hamilton Standard three-blade 3.84 m props without
// spinners, the flat-topped canopy of the 416th's 1945 aircraft, remote dorsal and ventral turrets
// (placed aft of the wing as the side photo a26_side_10 shows).
// Stations zd are metres aft of the nose, y up from the drawing's centre line; model z = zd - 4.75.
// Moving parts: props (one feathered on a damaged aircraft), bomb doors (threat.doors or the bombing
// phases).

const Z = (zd) => zd - 4.75;
const P = (pl) => pl.map(([x, a, b]) => [x, Z(a), Z(b)]);
const st = ([zd, w, t, b], e = 2.1) => [Z(zd), w, (t - b) / 2, (t - b) / 2, (t + b) / 2, e];
const FUS = [
  [2.1, 0.6, 0.85, -0.86], [3.0, 0.62, 0.92, -0.97], [4.5, 0.62, 0.95, -1.02], [6.0, 0.6, 0.93, -1.05], [7.5, 0.55, 0.82, -0.98],
  [9.0, 0.48, 0.66, -0.8], [10.5, 0.38, 0.6, -0.6], [12.0, 0.29, 0.62, -0.42], [13.5, 0.2, 0.6, -0.25], [14.8, 0.1, 0.5, -0.08], [15.45, 0.03, 0.35, 0.1],
].map((s) => st(s));
const NOSE = [[0.04, 0.06, 0.08, -0.08], [0.4, 0.3, 0.36, -0.3], [0.9, 0.46, 0.57, -0.52], [1.5, 0.56, 0.74, -0.72], [2.12, 0.6, 0.85, -0.86]].map((s) => st(s));
const NOSE_C_GLASS = [[0.04, 0.06, 0.08, -0.08], [0.4, 0.3, 0.36, -0.3], [0.9, 0.46, 0.57, -0.52], [1.25, 0.52, 0.67, -0.64]].map((s) => st(s));
const NOSE_C_METAL = [[1.24, 0.52, 0.67, -0.64], [1.5, 0.56, 0.74, -0.72], [2.12, 0.6, 0.85, -0.86]].map((s) => st(s));
// flat-topped canopy (the early type, still the 416th's in March 1945)
const CANOPY = [[2.2, 0.42, 0.02, 0.86, 3], [2.45, 0.5, 0.12, 0.86, 3], [2.8, 0.52, 0.19, 0.86, 3], [3.7, 0.52, 0.2, 0.88, 3], [4.4, 0.5, 0.18, 0.9, 3], [4.8, 0.4, 0.08, 0.91, 3], [5.0, 0.25, 0.02, 0.92, 3]]
  .map(([z, w, h, yc, e]) => [Z(z), w, h, h, yc, e]);

const WING = {
  semispan: 10.67, y: 0.05, dihedral: 4.5 * D2R, tRoot: 0.15, tTip: 0.11, S: 24, C: 26, x0: 0.3, washout: 1.5, camber: 0.012,
  plan: P([[0, 3.95, 7.15], [1.0, 4.0, 7.13], [3.0, 4.07, 7.05], [4.64, 4.12, 7.01], [7.5, 4.48, 6.48], [10.0, 4.85, 6.02], [10.45, 5.0, 5.85], [10.62, 5.2, 5.62], [10.67, 5.4, 5.45]]),
};
const HTAIL = { semispan: 3.52, y: 0.72, dihedral: 10.5 * D2R, tRoot: 0.12, tTip: 0.09, S: 12, C: 18, x0: 0.1, plan: P([[0, 12.89, 14.45], [1.5, 13.0, 14.35], [3.0, 13.15, 14.2], [3.4, 13.3, 14.1], [3.52, 13.55, 13.9]]) };
const FIN = { semispan: 2.95, base: 0.55, tRoot: 0.11, tTip: 0.09, S: 12, C: 18, plan: P([[0, 11.3, 15.45], [0.8, 12.0, 15.35], [1.6, 12.55, 15.25], [2.4, 13.05, 15.15], [2.85, 13.35, 15.05], [2.93, 13.6, 14.95], [2.95, 14.2, 14.6]]) };

const B_NOSE = 1, C_NOSE = 2;

function build() {
  const A = new Assembly();
  A.body(FUS, PART.FUSELAGE, { n: 30, count: 30, capStart: false });
  A.body(NOSE, PART.FUSELAGE, { n: 30, count: 10, capEnd: false, variant: B_NOSE });
  A.body(NOSE_C_GLASS, PART.GLASS, { n: 30, count: 8, capEnd: false, variant: C_NOSE });
  A.body(NOSE_C_METAL, PART.FUSELAGE, { n: 30, count: 6, capStart: false, capEnd: false, variant: C_NOSE });
  A.add(strut(V(0, 0.01, Z(1.22)), V(0, 0.01, Z(1.28)), 0.53, 0.67, 24), PART.FUSELAGE, { variant: C_NOSE });
  // the A-26B's six .50s in the nose, three a side
  for (const s of [-1, 1]) for (let k = 0; k < 3; k++) {
    const y = 0.28 - k * 0.14, x = s * (0.16 + k * 0.03);
    A.add(barrel(x, y, Z(0.75), Z(0.12 + k * 0.08), 0.022), PART.DARK, { variant: B_NOSE });
  }
  A.canopy(CANOPY, { frames: [Z(2.22), Z(2.6), Z(3.3), Z(4.0), Z(4.6)], rail: true, count: 10 });
  A.pilot(-0.25, 1.0, Z(3.3), { headrest: false });
  A.pilot(0.28, 0.98, Z(3.45), { headrest: false });
  // remote dorsal and ventral turrets, two .50s each, trained aft
  A.add(sphere(0, 0.76, Z(8.5), 0.4, 1, 0.45, 1, 14, 6), PART.METAL);
  for (const x of [-0.1, 0.1]) A.add(barrel(x, 0.86, Z(8.7), Z(9.8), 0.025), PART.DARK);
  A.add(sphere(0, -0.62, Z(10.4), 0.36, 1, 0.45, 1, 14, 6), PART.METAL);
  for (const x of [-0.1, 0.1]) A.add(barrel(x, -0.7, Z(10.6), Z(11.6), 0.025), PART.DARK);

  // engines: R-2800 cowls, long nacelles running aft under the wing, bare-hub props
  for (const s of [-1, 1]) {
    const x = s * 2.97, y = -0.12;
    A.radial({ x, y, zF: Z(2.37), zB: Z(3.6), w: 0.68, wB: 0.68, inner: 0.74 }, { rows: 2, perRow: 9, flaps: 16 });
    A.body([[Z(3.58), 0.68, 0.68, 0.68, y, 2], [Z(4.5), 0.63, 0.6, 0.68, y - 0.03, 2.1], [Z(6.0), 0.5, 0.48, 0.56, y - 0.06, 2.1], [Z(7.5), 0.31, 0.3, 0.37, y - 0.08, 2], [Z(8.66), 0.05, 0.05, 0.06, y - 0.08, 2]], PART.FUSELAGE, { n: 20, count: 10, xc: x });
    A.prop({ x, y, z: Z(2.11), r: 1.92, blades: 3, chord: 0.27, dir: -1, hub: 0.22 });
    // exhaust stacks along the nacelle sides
    for (const t of [-1, 1]) A.add(box(0.06, 0.08, 0.5, x + t * 0.66, y + 0.05, Z(3.95)), PART.METAL, { flat: true });
  }
  A.surfaces({ wing: WING, htail: HTAIL, fin: [FIN] });
  A.fillets(FUS, WING, { x: 0.8, z0: -0.04, z1: 0.06, w: 0.22, hT: 0.14, hB: 0.1, xs: 0.92 });

  // bomb doors under the bay (two panels hinged at their outer edges); the bay shows dark when open
  const zd0 = 5.0, zd1 = 7.3, hx = 0.45;
  for (const s of [-1, 1]) {
    const rings = [];
    for (const zd of [zd0, (zd0 + zd1) / 2, zd1]) {
      const [z, w, , hB, yc] = sectionAt(FUS, Z(zd));
      const outer = [], inner = [];
      for (let k = 0; k <= 6; k++) {
        const xx = (k / 6) * hx, yb = yc - hB * Math.sqrt(Math.max(0, 1 - (xx / w) ** 2)) - 0.012;
        outer.push(V(s * xx, yb, z));
        inner.push(V(s * xx, yb + 0.035, z));
      }
      rings.push([...outer, ...inner.reverse()]);
    }
    const [, w, , hB, yc] = sectionAt(FUS, Z(6));
    A.add(tube(rings, { capStart: true, capEnd: true }), PART.DOOR, { pivot: [s * hx, yc - hB * Math.sqrt(1 - (hx / w) ** 2), s, 0] });
  }

  return A.finish({
    type: 'a26', length: 15.47, cap: 48, propW: 22, doors: true,
    smoke: [V(-2.97, -0.12, Z(3.0)), V(2.97, -0.12, Z(3.0))],
    exh: { z: 99, y: 0, x: 0, w: 0 },
    // the glazed nose for the flight leaders: every sixth slot of a box (the sim's slotI), else one in six
    liveryPick: (th) => {
      const h = Math.abs(Math.imul(th.id | 0, 2654435761)) >>> 0;
      const lead = Number.isInteger(th.slotI) ? th.slotI % 6 === 0 : h % 6 === 0;
      const pool = LIVERY.liveries.map((l, i) => [l, i]).filter(([l]) => (l.variant === C_NOSE) === !!lead);
      return pool[h % pool.length][1];
    },
    livery: LIVERY,
  });
}

const LIVERY = {
  scheme: 'nmf',
  demarc: [-0.2, 0, 0.08],
  ailerons: [0.65, 0.95, 0.76], flaps: [0.05, 0.62, 0.78], tailHinge: 0.7,
  glassTop: 99, centreFrame: 0, glassZ: Z(1.25), glazed: true,
  store: C.bombOD, storeBand: -99,
  slots: ['code', 'letter', 'serial'],
  colourSlots: [],
  regions: [
    { kind: 'antiglare', z0: Z(0.6), z1: Z(2.25), ny: 0.6, colour: C.od },
    // the dark band along the rudder's trailing edge
    { kind: 'rudder', c0: 0.86, s0: 0.0, colour: '#1e1f22' },
    // gunner's compartment windows, the bay dark when the doors are open
    { kind: 'windows', rects: [[Z(9.15), Z(9.75), 0.14, 0.42]] },
    { kind: 'glsl', code: `if (acPt == 0.0 && acS.w - 2.0 * floor(acS.w * 0.5 + 0.001) > 0.05 && abs(acP.x) < 0.45 && acP.y < -0.75 && acP.z > ${Z(5.0).toFixed(3)} && acP.z < ${Z(7.3).toFixed(3)}) acPaint(vec3(0.03), 0.9, 1.0);` },
  ],
  decals: [
    { kind: 'star', surf: 'side', a: Z(10.7), b: 0.0, r: 0.5, reach: 1.2 },
    { kind: 'star', surf: 'wingTop', side: 'L', a: 7.4, b: Z(5.2), r: 0.72, reach: 1.6 },
    { kind: 'star', surf: 'wingBot', side: 'R', a: 7.4, b: Z(5.2), r: 0.72, reach: 1.6 },
    { kind: 'text', surf: 'side', a: Z(9.2), b: 0.0, h: 0.72, slot: 'code', colour: C.black, reach: 0.9 },
    { kind: 'text', surf: 'side', a: Z(11.95), b: 0.05, h: 0.62, slot: 'letter', colour: C.black, reach: 0.5 },
    { kind: 'text', surf: 'fin', a: Z(14.15), b: 1.75, h: 0.22, slot: 'serial', colour: C.black, reach: 1.0 },
  ],
  liveries: [
    { code: 'F6', letter: 'W', serial: '322501', variant: C_NOSE },
    { code: '2A', letter: 'C', serial: '322344', variant: B_NOSE },
    { code: 'F6', letter: 'T', serial: '322528', variant: C_NOSE },
    { code: '2A', letter: 'V', serial: '322383', variant: B_NOSE },
    { code: '5C', letter: 'J', serial: '322352', variant: B_NOSE },
    { code: '5H', letter: 'P', serial: '322481', variant: C_NOSE },
    { code: '2A', letter: 'O', serial: '322301', variant: B_NOSE },
    { code: '2A', letter: 'K', serial: '322318', variant: B_NOSE, od: true },
  ],
};

export const a26 = build;
