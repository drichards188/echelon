import { V, xf, box, yTube, zTube, xTube, rod, ringAt, loft } from '../kit.js';

// MAZ-543 family split cab (5P85 launcher, 64N6E2 and 91N6E tractors): two narrow tandem two-seater
// cabins standing either side of the radiator housing, nearly upright faces with a single windscreen,
// a small corner chamfer, two side windows and the wheel-arch cut at the rear. Measured from the
// launcher (refs/s400-mzkt) and the 64N6E2 photos (refs/s400-support). Parts are placed by f, metres
// behind the front bumper; the model z is f + zOff.

// Round lamp facing forward (axis 'z') or sideways (axis 'x', dir +-1), at model z.
export function lamp(P, x, y, z, r, key = 'lens', axis = 'z', dir = -1) {
  if (axis === 'z') {
    P.add('dark', zTube(z, z + dir * 0.05, r + 0.025, r + 0.025, 14, x, y));
    P.add(key, zTube(z + dir * 0.05, z + dir * 0.058, r, r * 0.9, 14, x, y));
  } else {
    P.add('dark', xTube(x, x + dir * 0.04, r + 0.02, r + 0.02, 12, y, z));
    P.add(key, xTube(x + dir * 0.04, x + dir * 0.048, r, r * 0.9, 12, y, z));
  }
}

// The cabins. sides: 'left' | 'right' | 'both'. Each cabin spans xi (inner face, distance from the
// axis) to xi + w; the launcher has xi 0.52, w 1.0 on the left only. roof: per side, a list of
// 'light' (searchlight), 'beacon' (amber rotating lamp over it) and 'mast' (antenna).
export function maz543Cabs(P, { sides = 'left', zOff = 0, xi = 0.52, w = 1.0, roof } = {}) {
  const k = w / 1.0, all = ['light', 'mast'];
  const want = { left: sides !== 'right' ? (roof?.left || all) : null, right: sides !== 'left' ? (roof?.right || all) : null };
  for (const side of ['left', 'right']) if (want[side]) one(P, side === 'left' ? -1 : 1, want[side], zOff, xi, k);
}

function one(P, sg, roof, zOff, xi, k) {
  const Z = (f) => f + zOff;
  const Vf = (x, y, f) => V(X(x), y, Z(f));
  // x of the launcher's left cab (-1.52 .. -0.52) mapped to this cabin
  const X = (x) => sg * (xi + (-x - 0.52) * k);
  const ry = (a) => (sg < 0 ? a : -a);
  const ext = (x0, x1, y0, y1, f0, f1, rx = 0, a = 0, rz = 0) => {
    x0 = X(x0);
    x1 = X(x1);
    if (x0 > x1) [x0, x1] = [x1, x0];
    if (y0 > y1) [y0, y1] = [y1, y0];
    if (f0 > f1) [f0, f1] = [f1, f0];
    return box(x1 - x0, y1 - y0, f1 - f0, (x0 + x1) / 2, (y0 + y1) / 2, Z((f0 + f1) / 2), rx, ry(a), sg < 0 ? rz : -rz);
  };
  const ring = (y, f0, f1, fr = 0) => ringAt([[-1.32 + fr, Z(f0)], [-0.52, Z(f0)], [-0.52, Z(f1)], [-1.52 + fr, Z(f1)], [-1.52 + fr, Z(f0 + 0.2)]].map(([x, z]) => [X(x), z]), y);
  P.add('camo', loft([ring(1.0, 0.24, 1.72), ring(1.62, 0.24, 2.35), ring(1.95, 0.24, 2.35), ring(2.62, 0.36, 2.35), ring(2.75, 0.46, 2.3, 0.02)], { crease: 0.35 }));
  // windscreen, frame and wiper; the small hatch below it; headlight and marker
  const rake = Math.atan2(0.12, 0.67);
  P.add('rubber', box(0.76 * k, 0.66, 0.02, X(-0.93), 2.29, Z(0.293), rake));
  P.add('glass', box(0.7 * k, 0.6, 0.02, X(-0.93), 2.29, Z(0.287), rake));
  P.add('dark', rod(Vf(-0.72, 2.02, 0.235), Vf(-1.02, 2.4, 0.29), 0.012, 4));
  P.add('glass', box(0.2, 0.56, 0.02, X(-1.42), 2.29, Z(0.4), rake, ry(Math.PI / 4), 0)); // corner window
  P.add('camo', ext(-1.25, -0.8, 1.77, 1.88, 0.215, 0.245));
  lamp(P, X(-1.12), 1.68, Z(0.24), 0.1);
  P.add('amber', ext(-0.88, -0.78, 1.64, 1.72, 0.21, 0.24));
  // two windows in the outer side, door seams, handle and steps
  for (const [f0, f1] of [[0.45, 0.8], [0.95, 1.42]]) P.add('glass', ext(-1.535, -1.52, 2.12, 2.55, f0, f1));
  for (const f of [0.88, 1.72]) P.add('dark', ext(-1.53, -1.515, 1.2, 2.66, f, f + 0.02));
  P.add('dark', ext(-1.53, -1.515, 2.65, 2.67, 0.88, 1.74));
  P.add('steel', ext(-1.56, -1.52, 1.95, 1.99, 1.5, 1.65));
  for (const y of [0.72, 1.08]) P.add('dark', ext(-1.5, -1.2, y, y + 0.04, 1.0, 1.45));
  P.add('dark', ext(-1.5, -1.47, 0.7, 1.15, 1.0, 1.03));
  P.add('dark', ext(-1.5, -1.47, 0.7, 1.15, 1.42, 1.45));
  // side window toward the radiator housing
  P.add('glass', ext(-0.52, -0.505, 2.22, 2.56, 0.7, 1.35));
  // roof: hatch, marker lamps, searchlight with a beacon, antenna; mirror on the outer side
  P.add('camo', ext(-1.32, -0.82, 2.75, 2.8, 1.2, 1.8));
  if (roof.includes('light')) {
    P.add('dark', yTube(2.75, 2.92, 0.025, 0.025, 6, X(-0.68), Z(0.72)));
    P.add('dark', zTube(Z(0.8), Z(0.62), 0.1, 0.1, 14, X(-0.68), 2.98));
    P.add('lens', zTube(Z(0.62), Z(0.61), 0.085, 0.085, 14, X(-0.68), 2.98));
  }
  if (roof.includes('beacon')) {
    P.add('dark', box(0.2, 0.04, 0.2, X(-0.68), 3.1, Z(0.72)));
    P.add('amber', yTube(3.12, 3.27, 0.065, 0.06, 10, X(-0.68), Z(0.72)));
    P.add('dark', yTube(3.27, 3.3, 0.07, 0.055, 10, X(-0.68), Z(0.72)));
    for (const s of [-1, 1]) P.add('steel', rod(Vf(-0.68, 3.1, 0.72 + s * 0.2), Vf(-0.68, 3.4, 0.72 + s * 0.14), 0.01, 4)); // cage
    P.add('steel', yTube(3.1, 3.4, 0.01, 0.01, 4, X(-0.68) + 0.14, Z(0.72)));
    P.add('steel', yTube(3.1, 3.4, 0.01, 0.01, 4, X(-0.68) - 0.14, Z(0.72)));
  }
  if (roof.includes('mast')) {
    P.add('dark', yTube(2.75, 3.2, 0.018, 0.012, 6, X(-0.88), Z(0.75))); // antenna stub
    P.add('dark', yTube(2.75, 2.93, 0.035, 0.03, 8, X(-0.62), Z(1.05)));
    P.add('dark', yTube(2.93, 5.0, 0.011, 0.005, 5, X(-0.62), Z(1.05)));
  }
  for (const x of [-1.4, -0.62]) P.add('amber', ext(x - 0.05, x + 0.05, 2.75, 2.81, 0.5, 0.58));
  P.add('dark', rod(Vf(-1.52, 2.45, 0.7), Vf(-1.84, 2.52, 0.35), 0.018, 5));
  P.add('dark', rod(Vf(-1.52, 2.05, 0.7), Vf(-1.84, 2.28, 0.35), 0.018, 5));
  P.add('dark', box(0.07, 0.44, 0.26, X(-1.86), 2.4, Z(0.32), 0, ry(-0.3), 0));
}
