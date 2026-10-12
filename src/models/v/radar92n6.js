import * as THREE from 'three';
import { V, DEG, xf, box, rbox, yTube, zTube, xTube, sphere, rod, sideProfile, frontProfile, Parts, addLamp, hubGeometry } from '../kit.js';
import { hose, ladder } from '../trucks.js';
import { newRig, node, pivotAt, hb } from '../rig.js';

// 92N6E engagement radar of the S-400 on the MZKT-7930 8x8, deployed. From the front: the flat
// forward-control cab (three windscreens over a high black bumper) with its lower rear section over
// the first axle, the antenna post (equipment box on the chassis, turntable, lattice platform and
// the portrait slab: plain olive face, lower housing with hatches, ribbed back), the equipment
// cabin over the rear axles and the white telescopic comms mast behind the cab. Plain olive.
// Measured from refs/s400-mzkt: camera solved from the wheel hubs of the Kuzmin photo, the 1.5 m
// tyre as the ruler and 12.6 m overall.
// Rig: `turret` turns the whole antenna post above the turntable (0 = face forward over the cab),
// `elevation` tilts the slab about the hinge at its foot (0 = upright, + = face up; the photos show
// it leaning back about 15 to 20 degrees in operation). The travel pose is not modelled: no photo
// shows it, and the game always has the radar deployed (jacks down, mast up).

const ZB = -6.3; // front face of the bumper; f is the distance back from it, z = ZB + f
const Z = (f) => ZB + f;
const AX = [2.65, 4.65, 8.0, 10.0]; // axle centres (pitches 2.0 / 3.35 / 2.0)
const R = 0.75, TW = 0.6, TRACK = 1.23; // 1500x600-635 tyres
const CAB = { f0: 0.15, f1: 1.55, f2: 3.1, top: 3.12, top2: 3.04, hw: 1.48, y0: 1.35 };
const POST = { f0: 3.2, f1: 7.3, y0: 1.85, y1: 2.9, hw: 1.45 }; // antenna post equipment box
const CABIN = { f0: 7.5, f1: 12.6, y0: 1.85, y1: 3.78, hw: 1.45 };
const TURN = { f: 5.9, y: 2.95 }; // turntable axis and top
const HINGE = { y: 0.5, z: -0.1 }; // elevation axis in turret space
const SLAB = { w: 2.9, h: 3.12 };
const MAST = { x: 0.75, f: 2.8, y0: 3.04, top: 8.4 };
const FACE = new THREE.Color().setRGB(0.34, 0.35, 0.27); // the antenna's plain face, a greyer olive (tints the light 'white')
const SLAB_PAINT = new THREE.Color(1.15, 1.12, 1.22); // the rest of the antenna, lighter than the truck
const BODY = new THREE.Color(1.02, 0.99, 1.2); // the truck: the plain 'green' set pulled toward the photos' greyer olive

// sideProfile grows the outline by its bevel; inset the [z, y] polygon first so the bevelled solid
// keeps the measured outline (edges offset inward, neighbours re-intersected).
function inset(pts, b) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) { const [x0, y0] = pts[i], [x1, y1] = pts[(i + 1) % pts.length]; a += x0 * y1 - x1 * y0; }
  const s = a > 0 ? 1 : -1, n = pts.length;
  const lines = pts.map(([x0, y0], i) => {
    const [x1, y1] = pts[(i + 1) % n], dx = x1 - x0, dy = y1 - y0, l = Math.hypot(dx, dy);
    const nx = (-dy / l) * s, ny = (dx / l) * s; // inward normal
    return [x0 + nx * b, y0 + ny * b, dx, dy];
  });
  return lines.map((L, i) => {
    const P = lines[(i + n - 1) % n], det = P[2] * L[3] - P[3] * L[2];
    if (Math.abs(det) < 1e-9) return [L[0], L[1]];
    const t = ((L[0] - P[0]) * L[3] - (L[1] - P[1]) * L[2]) / det;
    return [P[0] + P[2] * t, P[1] + P[3] * t];
  });
}
const profile = (pts, w, b) => sideProfile(inset(pts, b), w, b);

// ---------------------------------------------------------------- MZKT-7930 chassis

// 1500x600-635 cross-country tyre about the x axis: flat-topped lugs with steep walls, the two
// halves staggered half a pitch and swept back from a centre rib, running onto the shoulders.
// Four rings per lug (top, top, groove, groove) keep the walls sharp with few vertices.
function tyre(R, W, lugs = 20) {
  const h = R * 0.3, Rr = R - h, d = R * 0.085, seg = lugs * 4;
  const prof = [[-1, Rr], [-1.06, Rr + 0.4 * h], [-1.0, R - 0.22 * h], [-0.86, R - 0.05 * h], [-0.5, R], [0, R], [0.5, R], [0.86, R - 0.05 * h], [1.0, R - 0.22 * h], [1.06, Rr + 0.4 * h], [1, Rr]];
  const fr = [0.04, 0.46, 0.54, 0.96];
  const M = prof.length, pos = [], idx = [];
  for (let i = 0; i < seg; i++) {
    const k = Math.floor(i / 4), q = i % 4;
    for (let j = 0; j < M; j++) {
      let [u, r] = prof[j];
      const tread = j > 1 && j < M - 2, side = Math.abs(u) > 0.01;
      const off = tread ? (u > 0.01 ? 0.5 + u * 0.35 : u < -0.01 ? -u * 0.35 : 0.25) : 0;
      if (tread && side && q > 1) r -= d;
      const a = ((k + fr[q] + off) / lugs) * Math.PI * 2;
      pos.push(u * W * 0.5, Math.cos(a) * r, Math.sin(a) * r);
    }
  }
  for (let i = 0; i < seg; i++) for (let j = 0; j < M - 1; j++) {
    const a = i * M + j, b = ((i + 1) % seg) * M + j;
    idx.push(a, b, a + 1, b, b + 1, a + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// Wheel stations: tyres on black disc wheels, axle beams, differentials, drive shafts, the
// steering rods of the first two axles.
function runningGear(P) {
  const tg = tyre(R, TW);
  AX.forEach((f, i) => {
    for (const s of [-1, 1]) {
      P.add('tyre', tg.clone().applyMatrix4(xf(s * TRACK, R, Z(f))));
      P.add('rim', hubGeometry(R, TW, s).applyMatrix4(xf(s * TRACK, R, Z(f))), { tint: 0x353535 });
      P.add('dark', xTube(s * (TRACK - TW * 0.5), s * (TRACK - TW * 0.5 - 0.15), 0.12, 0.12, 12, R, Z(f)));
      P.add('dark', box(0.12, 0.12, 0.9, s * 0.75, R + 0.15, Z(f))); // suspension arm
    }
    P.add('dark', xTube(-TRACK + 0.3, TRACK - 0.3, 0.09, 0.09, 10, R, Z(f)));
    P.add('dark', sphere(0.2, 0, R, Z(f), 1.0, 0.95, 1.1, 12));
    if (i < 2) P.add('dark', xTube(-TRACK + 0.35, TRACK - 0.35, 0.025, 0.025, 6, R - 0.06, Z(f) - 0.34));
  });
  for (let i = 0; i < 3; i++) P.add('dark', zTube(Z(AX[i]) + 0.2, Z(AX[i + 1]) - 0.2, 0.05, 0.05, 8, 0, R + 0.05));
}

function chassis(P) {
  runningGear(P);
  // frame rails and the body subframe over the wheels
  for (const s of [-1, 1]) {
    P.add('dark', box(0.18, 0.38, 12.0, s * 0.55, 1.2, Z(6.4)));
    P.add('dark', box(0.12, 0.3, Z(12.55) - Z(3.15), s * 1.36, 1.7, (Z(3.15) + Z(12.55)) / 2));
    P.add('dark', box(0.08, 0.06, Z(12.55) - Z(3.15), s * 1.42, 1.53, (Z(3.15) + Z(12.55)) / 2));
  }
  for (let f = 3.4; f < 12.4; f += 1.05) P.add('dark', box(2.7, 0.14, 0.12, 0, 1.6, Z(f)));
  for (let f = 0.8; f < 12.4; f += 1.4) P.add('dark', box(1.1, 0.12, 0.1, 0, 1.08, Z(f)));
  // between the axle pairs: fuel tank, air tanks, batteries, the climbing ladder to the post roof
  for (const s of [-1, 1]) {
    P.add('dark', zTube(Z(5.55), Z(6.85), 0.3, 0.3, 16, s * 1.02, 1.05));
    P.add('steel', zTube(Z(5.5), Z(5.56), 0.32, 0.32, 16, s * 1.02, 1.05));
    P.add('dark', box(0.5, 0.42, 0.75, s * 1.05, 1.15, Z(7.0) + 0.0));
    P.add('dark', zTube(Z(3.55), Z(4.0), 0.12, 0.12, 10, s * 0.95, 1.25)); // air reservoir between wheels 1 and 2
  }
  ladder(P, -1.38, Z(7.12), 0.55, 1.85, 0.36, 'dark');
  // rear end: cross member, lamps, tow hook
  P.add('dark', box(2.8, 0.32, 0.18, 0, 1.35, Z(12.5)));
  for (const s of [-1, 1]) {
    addLamp(P, s * 1.15, 1.35, Z(12.6) + 0.07, 0.22, 0.12, 0.06, 'red');
    addLamp(P, s * 0.85, 1.35, Z(12.6) + 0.07, 0.1, 0.1, 0.06, 'amber');
  }
  P.add('steel', zTube(Z(12.55), Z(12.85), 0.06, 0.06, 8, 0, 1.15));
  P.add('dark', box(0.3, 0.2, 0.15, 0, 1.15, Z(12.6)));
  // deployed stabiliser jacks between the axle pairs: housing on the side member, leg, round foot
  for (const f of [3.65, 9.0]) for (const s of [-1, 1]) {
    const x = s * 1.18;
    P.add('dark', box(0.26, 0.42, 0.26, x, 1.55, Z(f)));
    P.add('steel', yTube(0.12, 1.4, 0.055, 0.055, 10, x, Z(f)));
    P.add('dark', yTube(0.9, 1.38, 0.08, 0.08, 10, x, Z(f)));
    P.add('dark', yTube(0.0, 0.06, 0.24, 0.22, 16, x, Z(f)));
    P.add('steel', sphere(0.07, x, 0.1, Z(f), 1, 0.8, 1, 8));
  }
}

// ---------------------------------------------------------------- MZKT-7930 cab

function cab(P) {
  const { f0, f1, f2, top, top2, hw, y0 } = CAB;
  // front section: vertical face up to the windscreen, screens raked back a little, flat roof
  const prof = [[Z(f0), 1.7], [Z(f0), 2.14], [Z(f0 + 0.06), 2.2], [Z(f0 + 0.14), 3.0], [Z(f0 + 0.14), top], [Z(f1), top], [Z(f1), y0], [Z(f0 + 0.2), y0], [Z(f0 + 0.2), 1.7]];
  P.add('camo', profile(prof, hw * 2, 0.05));
  // rear section over the first axle, roof a little lower, wheel arch cut into it
  const ac = Z(2.75), ar = 1.0, arch = [];
  for (let a = 143; a >= 69; a -= 6) arch.push([ac + ar * Math.cos(a * DEG), 0.75 + ar * Math.sin(a * DEG)]);
  const yA = 0.75 + ar * Math.sin(69.5 * DEG);
  const prof2 = [[Z(f1) - 0.02, y0], [arch[0][0], y0], ...arch, [Z(f2), yA], [Z(f2), top2], [Z(f1) - 0.02, top2]];
  P.add('camo', profile(prof2, hw * 2 - 0.02, 0.04));
  for (const s of [-1, 1]) { // arch lips
    const g = new THREE.Shape();
    const r0 = ar, r1 = ar + 0.06;
    g.absarc(0, 0, r1, 69.5 * DEG, 143 * DEG, false);
    g.absarc(0, 0, r0, 143 * DEG, 69.5 * DEG, true);
    const e = new THREE.ExtrudeGeometry(g, { depth: 0.12, bevelEnabled: false, curveSegments: 12 });
    e.translate(0, 0, -0.06).rotateY(-Math.PI / 2).translate(s * (hw - 0.02), 0.75, ac);
    P.add('camo', e);
  }
  // front face: three windscreens in rubber, lower panel crease, louvre, bumper
  const rk = Math.atan2(0.08, 0.8); // windscreen rake
  for (const x of [-0.94, 0, 0.94]) {
    P.add('rubber', box(0.86, 0.74, 0.03, x, 2.6, Z(f0 + 0.1) - 0.005, rk));
    P.add('glass', box(0.8, 0.68, 0.03, x, 2.6, Z(f0 + 0.1) - 0.016, rk));
    P.add('dark', box(0.025, 0.55, 0.025, x + 0.25, 2.68, Z(f0 + 0.1) - 0.04, rk)); // wiper parked upright
    P.add('dark', box(0.015, 0.4, 0.012, x + 0.25, 2.66, Z(f0 + 0.1) - 0.06, rk));
  }
  P.add('camo', box(hw * 2 - 0.1, 0.05, 0.08, 0, 2.15, Z(f0) - 0.02)); // crease under the screens
  for (let i = 0; i < 4; i++) P.add('dark', box(0.78, 0.025, 0.03, 0.28, 1.76 + i * 0.045, Z(f0) - 0.01));
  P.add('dark', box(0.84, 0.2, 0.012, 0.28, 1.83, Z(f0) - 0.002));
  // windscreen guard posts with roof lamps on top, top rail along the roof edge
  for (const x of [-0.47, 0.47]) {
    P.add('camo', rod(V(x, 2.05, Z(f0) - 0.1), V(x, 3.2, Z(f0 + 0.04) - 0.06), 0.022, 8));
    P.add('camo', box(0.1, 0.06, 0.18, x, 2.08, Z(f0) - 0.03));
    P.add('dark', yTube(3.2, 3.26, 0.045, 0.045, 10, x, Z(f0 + 0.04) - 0.06));
    P.add('lens', yTube(3.26, 3.31, 0.055, 0.055, 12, x, Z(f0 + 0.04) - 0.06));
    P.add('dark', yTube(3.31, 3.35, 0.06, 0.02, 12, x, Z(f0 + 0.04) - 0.06));
  }
  P.add('camo', xTube(-1.2, 1.2, 0.025, 0.025, 8, 3.14, Z(f0 + 0.12)));
  // bumper: black box, lamps at both ends, tow coupling, skid plate under it sloping back
  P.add('dark', rbox(3.0, 0.48, 0.45, 0.03, 0, 1.46, Z(0.225)));
  P.add('dark', profile([[Z(0.1), 1.25], [Z(1.55), 0.86], [Z(1.95), 0.92], [Z(1.95), 1.36], [Z(0.45), 1.36], [Z(0.45), 1.25]], 1.7, 0.02));
  for (const s of [-1, 1]) {
    P.add('dark', yTube(0, 0.06, 0.11, 0.11, 16, 0, 0).applyMatrix4(xf(s * 0.95, 1.56, Z(0) - 0.0, -Math.PI / 2)));
    P.add('lens', yTube(0, 0.02, 0.09, 0.09, 16, 0, 0).applyMatrix4(xf(s * 0.95, 1.56, Z(0) - 0.05, -Math.PI / 2)));
    for (const [x, y] of [[1.2, 1.58], [1.2, 1.43]]) P.add('amber', yTube(0, 0.03, 0.045, 0.045, 10, 0, 0).applyMatrix4(xf(s * x, y, Z(0) - 0.01, -Math.PI / 2)));
    addLamp(P, s * 1.08, 1.3, Z(0) + 0.01, 0.17, 0.07, 0.04);
  }
  P.add('dark', yTube(0, 0.12, 0.09, 0.09, 12, 0, 0).applyMatrix4(xf(-0.25, 1.42, Z(0) - 0.02, -Math.PI / 2))); // tow pin housing
  P.add('red', rod(V(0.3, 1.47, Z(0) - 0.02), V(0.3, 1.38, Z(0) - 0.16), 0.03, 6));
  P.add('red', rod(V(0.3, 1.38, Z(0) - 0.16), V(0.3, 1.3, Z(0) - 0.08), 0.03, 6));
  // sides: narrow corner window, door with window, rear-section window, handles, steps, mirrors
  for (const s of [-1, 1]) {
    const x = s * (hw + 0.004);
    P.add('glass', box(0.03, 0.66, 0.16, x, 2.6, Z(f0 + 0.18)));
    P.add('glass', rbox(0.03, 0.52, 0.5, 0.06, x, 2.6, Z(0.83)));
    P.add('glass', rbox(0.03, 0.62, 0.6, 0.01, x, 2.36, Z(2.2)));
    P.add('dark', box(0.03, 1.6, 0.02, x, 2.15, Z(0.43))); // door seams
    P.add('dark', box(0.03, 1.6, 0.02, x, 2.15, Z(1.2)));
    P.add('dark', box(0.03, 0.02, 0.78, x, 1.36, Z(0.81)));
    P.add('dark', box(0.03, 0.02, 0.78, x, 2.95, Z(0.81)));
    P.add('steel', box(0.06, 0.04, 0.16, s * (hw + 0.03), 2.1, Z(1.05)));
    P.add('dark', rod(V(s * (hw + 0.06), 1.6, Z(1.28)), V(s * (hw + 0.06), 2.8, Z(1.28)), 0.016, 6)); // grab rail
    for (const y of [1.6, 2.8]) P.add('dark', box(0.07, 0.03, 0.03, s * (hw + 0.03), y, Z(1.28)));
    P.add('dark', box(0.03, 0.02, 0.9, x, 1.5, Z(2.2))); // rear section belt line
    for (const [y, d] of [[0.62, 0.32], [0.98, 0.32]]) P.add('steel', box(0.36, 0.035, d, s * (hw - 0.12), y, Z(0.85)));
    for (const dz of [-0.17, 0.17]) P.add('dark', box(0.04, 0.55, 0.04, s * (hw - 0.12), 0.85, Z(0.85) + dz)); // step hangers
    // mirrors on a tube from the front corner: a big flat one and a small round one under it
    P.add('dark', rod(V(s * hw, 2.95, Z(f0 + 0.1)), V(s * (hw + 0.36), 2.95, Z(f0 + 0.32)), 0.016, 6));
    P.add('dark', rod(V(s * (hw + 0.36), 2.95, Z(f0 + 0.32)), V(s * (hw + 0.36), 2.2, Z(f0 + 0.32)), 0.016, 6));
    P.add('dark', rod(V(s * hw, 2.2, Z(f0 + 0.15)), V(s * (hw + 0.36), 2.2, Z(f0 + 0.32)), 0.016, 6));
    P.add('dark', rbox(0.08, 0.42, 0.26, 0.02, s * (hw + 0.4), 2.68, Z(f0 + 0.32)));
    P.add('glass', box(0.012, 0.38, 0.22, s * (hw + 0.355), 2.68, Z(f0 + 0.32)));
    P.add('dark', yTube(0, 0.06, 0.1, 0.1, 12, 0, 0).applyMatrix4(xf(s * (hw + 0.4), 2.33, Z(f0 + 0.32), 0, 0, Math.PI / 2)));
    addLamp(P, s * (hw + 0.01), 1.95, Z(f0 + 0.1), 0.05, 0.08, 0.06, 'amber');
  }
  // roof: drip rails, whip antenna on the front right (MAKS photo), handrails on the rear section
  P.add('dark', box(hw * 2 - 0.06, 0.03, 0.03, 0, top + 0.015, Z(f1) - 0.02));
  P.add('dark', yTube(top, top + 0.12, 0.04, 0.03, 8, 1.25, Z(f0 + 0.35)));
  P.add('dark', yTube(top + 0.12, top + 1.1, 0.011, 0.006, 5, 1.25, Z(f0 + 0.35)));
  for (const s of [-1, 1]) {
    P.add('steel', rod(V(s * 1.38, top2, Z(f1 + 0.15)), V(s * 1.38, top2 + 0.3, Z(f1 + 0.25)), 0.018, 6));
    P.add('steel', rod(V(s * 1.38, top2 + 0.3, Z(f1 + 0.25)), V(s * 1.38, top2 + 0.3, Z(f2 - 0.15)), 0.018, 6));
    P.add('steel', rod(V(s * 1.38, top2 + 0.3, Z(f2 - 0.15)), V(s * 1.38, top2, Z(f2 - 0.05)), 0.018, 6));
  }
}

// ---------------------------------------------------------------- antenna post, cabin, mast

function post(P) {
  const { f0, f1, y0, y1, hw } = POST;
  const zc = (Z(f0) + Z(f1)) / 2, len = Z(f1) - Z(f0), yc = (y0 + y1) / 2;
  P.add('camo', rbox(hw * 2, y1 - y0, len, 0.04, 0, yc, zc));
  P.add('dark', box(hw * 2 + 0.02, 0.05, len, 0, y0 + 0.02, zc));
  // cabinet doors along both sides with handles, a louvre near the rear
  for (const s of [-1, 1]) {
    const x = s * (hw + 0.004);
    for (let f = f0 + 0.15; f < f1 - 0.1; f += 0.68) P.add('dark', box(0.02, y1 - y0 - 0.16, 0.02, x, yc, Z(f)));
    for (let f = f0 + 0.49; f < f1 - 0.3; f += 0.68) P.add('steel', box(0.04, 0.12, 0.03, s * (hw + 0.015), yc, Z(f) + 0.2));
    P.add('dark', box(0.03, 0.2, 0.5, x, y1 - 0.3, Z(f1 - 1.2)));
    for (let i = 0; i < 4; i++) P.add('camo', box(0.04, 0.02, 0.48, s * (hw + 0.01), y1 - 0.37 + i * 0.045, Z(f1 - 1.2)));
  }
  // front face: cable connector panel and a cable drum, handrails up from the cab roof
  P.add('dark', box(1.2, 0.5, 0.03, 0.45, yc, Z(f0) - 0.005));
  for (let i = 0; i < 6; i++) P.add('steel', zTube(Z(f0) - 0.08, Z(f0), 0.04, 0.04, 8, 0.0 + i * 0.18, yc + 0.08));
  P.add('dark', xTube(-1.25, -0.8, 0.22, 0.22, 16, yc + 0.1, Z(f0) - 0.25));
  P.add('rubber', xTube(-1.2, -0.85, 0.25, 0.25, 16, yc + 0.1, Z(f0) - 0.25));
  for (const s of [-1, 1]) {
    P.add('steel', rod(V(s * 1.36, y1, Z(f0 + 0.08)), V(s * 1.36, y1 + 0.55, Z(f0 + 0.12)), 0.018, 6));
    P.add('steel', rod(V(s * 1.36, y1 + 0.55, Z(f0 + 0.12)), V(s * 1.36, y1 + 0.55, Z(f0 + 0.55)), 0.018, 6));
    P.add('steel', rod(V(s * 1.36, y1 + 0.55, Z(f0 + 0.55)), V(s * 1.36, y1, Z(f0 + 0.6)), 0.018, 6));
  }
  // walkway grating on the roof around the turntable
  P.add('dark', box(hw * 2 - 0.2, 0.02, len - 0.2, 0, y1 + 0.01, zc));
}

function cabin(P) {
  const { f0, f1, y0, y1, hw } = CABIN;
  const zc = (Z(f0) + Z(f1)) / 2, len = Z(f1) - Z(f0), yc = (y0 + y1) / 2, h = y1 - y0;
  P.add('camo', rbox(hw * 2, h, len, 0.06, 0, yc, zc));
  P.add('dark', box(hw * 2 + 0.02, 0.06, len + 0.02, 0, y0 + 0.03, zc));
  P.add('camo', box(hw * 2 - 0.12, 0.05, len - 0.12, 0, y1 + 0.02, zc)); // roof rim
  // panel seams
  for (const s of [-1, 1]) for (let f = f0 + 1.3; f < f1 - 0.2; f += 1.3) P.add('dark', box(0.02, h - 0.1, 0.02, s * (hw + 0.003), yc, Z(f)));
  // left side: front louvre, a narrow hatch, the door in the rear half with a step and grab rails
  const xl = -(hw + 0.006);
  P.add('dark', box(0.02, 0.9, 0.42, xl, yc + 0.3, Z(f0 + 0.35)));
  for (let i = 0; i < 9; i++) P.add('camo', box(0.03, 0.85, 0.02, xl - 0.006, yc + 0.3, Z(f0 + 0.17) + i * 0.045));
  P.add('dark', box(0.02, 1.4, 0.5, xl, yc + 0.1, Z(f0 + 1.0)));
  P.add('dark', box(0.03, 1.75, 0.86, xl, y0 + 0.97, Z(f1 - 1.95)));
  P.add('camo', box(0.03, 1.69, 0.8, xl - 0.006, y0 + 0.97, Z(f1 - 1.95)));
  P.add('steel', box(0.05, 0.05, 0.14, xl - 0.03, y0 + 1.0, Z(f1 - 2.25)));
  P.add('dark', box(0.4, 0.05, 0.8, xl - 0.12, y0 - 0.25, Z(f1 - 1.95))); // step under the door
  for (const dz of [-0.48, 0.48]) P.add('steel', rod(V(xl - 0.04, y0 + 0.3, Z(f1 - 1.95) + dz), V(xl - 0.04, y0 + 1.5, Z(f1 - 1.95) + dz), 0.016, 6)); // grab rails
  ladder(P, xl - 0.06, Z(f0 + 0.95), 1.0, y1 - 0.45, 0.36, 'dark');
  // right side: two hatches and a cable entry box
  for (const f of [f0 + 1.8, f0 + 3.5]) for (const [dy, dz, bh, bd] of [[0.55, 0, 0.025, 0.9], [-0.55, 0, 0.025, 0.9], [0, 0.45, 1.1, 0.025], [0, -0.45, 1.1, 0.025]]) P.add('dark', box(0.02, bh, bd, hw + 0.006, yc + dy, Z(f) + dz));
  P.add('camo', rbox(0.25, 0.5, 0.7, 0.03, hw + 0.12, y0 + 0.45, Z(f0 + 0.8)));
  // front face: connector box; rear face: lockers, lamps
  P.add('camo', rbox(1.4, 0.7, 0.3, 0.03, 0.4, yc - 0.2, Z(f0) - 0.15));
  for (let i = 0; i < 5; i++) P.add('steel', zTube(Z(f0) - 0.36, Z(f0) - 0.3, 0.045, 0.045, 8, -0.1 + i * 0.25, yc - 0.3));
  for (const x of [-0.72, 0.72]) for (const y of [y0 + 0.55, y0 + 1.45]) for (const [dx, dy, bw, bh] of [[0, 0.37, 1.2, 0.025], [0, -0.37, 1.2, 0.025], [0.6, 0, 0.025, 0.75], [-0.6, 0, 0.025, 0.75]]) P.add('dark', box(bw, bh, 0.02, x + dx, y + dy, Z(f1) + 0.005));
  for (const x of [-0.72, 0.72]) for (const y of [y0 + 0.55, y0 + 1.45]) P.add('steel', box(0.12, 0.05, 0.04, x + 0.45, y, Z(f1) + 0.02));
  // roof: air handler and vents
  P.add('camo', rbox(0.9, 0.3, 1.0, 0.04, 0.6, y1 + 0.17, Z(f1 - 1.1)));
  for (let i = 0; i < 4; i++) P.add('dark', box(0.8, 0.02, 0.02, 0.6, y1 + 0.1 + i * 0.05, Z(f1 - 1.1) - 0.51));
  for (const f of [f0 + 1.2, f0 + 2.6]) P.add('dark', yTube(y1, y1 + 0.14, 0.12, 0.12, 12, -0.7, Z(f)));
  // cable bundles from the antenna post into the cabin's front
  for (let i = 0; i < 3; i++) hose(P, V(-0.9 + i * 0.12, POST.y1 - 0.1, Z(POST.f1) - 0.05), V(-0.95 + i * 0.12, yc - 0.2, Z(f0) - 0.05), 0.25, 0.035, 'rubber', 6);
}

function mast(P) {
  const { x, top } = MAST, z = Z(MAST.f), y0 = CAB.top2;
  // base unit on the cab's rear section roof, then the telescopic tube in four stages
  P.add('camo', rbox(0.6, 0.45, 0.55, 0.03, x - 0.05, y0 + 0.22, z));
  for (let i = 0; i < 3; i++) P.add('dark', box(0.62, 0.02, 0.4, x - 0.05, y0 + 0.12 + i * 0.1, z));
  const st = [[y0 + 0.4, 4.6, 0.085], [4.6, 6.1, 0.068], [6.1, 7.4, 0.052], [7.4, top - 0.3, 0.04]];
  for (const [a, b, r] of st) {
    P.add('white', yTube(a, b, r, r, 12, x, z));
    P.add('steel', yTube(b - 0.06, b, r + 0.012, r + 0.012, 12, x, z)); // stage collars
  }
  // spiral cable down the lower stages
  const n = 60, spiral = [];
  for (let i = 0; i <= n; i++) { const t = i / n, a = t * Math.PI * 2 * 5.2; spiral.push(V(x + Math.cos(a) * 0.12, 3.35 + t * 2.6, z + Math.sin(a) * 0.12)); }
  for (let i = 0; i < n; i++) P.add('rubber', rod(spiral[i], spiral[i + 1], 0.014, 5));
  // panel antennas clamped half way up, a smaller box under them
  const grey = { tint: 0x8c8f86 }, bx = x - 0.12, bz = z - 0.32;
  P.add('white', rbox(0.62, 0.75, 0.34, 0.02, bx, 4.4, bz), grey);
  for (const dy of [-0.2, 0.05, 0.25]) P.add('dark', box(0.64, 0.02, 0.36, bx, 4.4 + dy, bz));
  P.add('white', rbox(0.55, 0.38, 0.32, 0.02, bx, 3.72, bz), grey);
  for (let i = 0; i < 4; i++) P.add('dark', box(0.4, 0.02, 0.02, bx, 3.62 + i * 0.06, bz - 0.17));
  P.add('dark', box(0.08, 0.06, 0.3, x - 0.02, 4.4, z - 0.15));
  P.add('dark', box(0.08, 0.06, 0.3, x - 0.02, 3.72, z - 0.15));
  // ring of vertical dipoles on a hoop
  const yr = 6.35;
  P.add('dark', yTube(yr - 0.025, yr + 0.025, 0.46, 0.46, 24, x, z, true));
  for (let i = 0; i < 6; i++) { const a = i * Math.PI / 3 + 0.4; P.add('dark', rod(V(x, yr + 0.1, z), V(x + Math.cos(a) * 0.46, yr, z + Math.sin(a) * 0.46), 0.014, 4)); }
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2, px = x + Math.cos(a) * 0.48, pz = z + Math.sin(a) * 0.48, dy = (i % 2) * 0.1 - 0.05;
    P.add('white', yTube(yr - 0.22 + dy, yr + 0.26 + dy, 0.013, 0.013, 4, px, pz));
    P.add('dark', yTube(yr - 0.3 + dy, yr - 0.2 + dy, 0.03, 0.03, 6, px, pz));
  }
  // drooping radials and a wire diamond (discone) at the top, cap disc
  const yd = top - 0.75;
  for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2 + 0.6; P.add('dark', rod(V(x, yd, z), V(x + Math.cos(a) * 0.55, yd - 0.55, z + Math.sin(a) * 0.55), 0.01, 4)); }
  for (let i = 0; i < 4; i++) {
    const a = i * Math.PI / 2 + 0.2, ox = Math.cos(a) * 0.17, oz = Math.sin(a) * 0.17;
    P.add('dark', rod(V(x, top - 0.55, z), V(x + ox, top - 0.3, z + oz), 0.008, 4));
    P.add('dark', rod(V(x + ox, top - 0.3, z + oz), V(x, top - 0.05, z), 0.008, 4));
  }
  P.add('dark', yTube(top - 0.06, top, 0.12, 0.12, 14, x, z));
}

// ---------------------------------------------------------------- turret and slab

function turret(T) {
  T.add('dark', yTube(-0.1, 0.04, 1.05, 1.05, 32));
  T.add('dark', yTube(0.04, 0.07, 1.0, 1.0, 32));
  T.add('steel', yTube(0.035, 0.075, 1.02, 1.02, 32, 0, 0, true)); // bearing ring
  // lattice platform: floor, corner posts, top rails and close vertical bars all round
  const w = 1.32, d0 = -0.62, d1 = 0.62, y0 = 0.07, y1 = HINGE.y - 0.02;
  T.add('camo', box(w * 2, 0.06, d1 - d0, 0, y0 + 0.03, (d0 + d1) / 2));
  for (const sx of [-1, 1]) for (const z of [d0, d1]) T.add('camo', box(0.07, y1 - y0, 0.07, sx * w, (y0 + y1) / 2, z));
  for (const y of [y1 - 0.03, (y0 + y1) / 2]) {
    for (const z of [d0, d1]) T.add('camo', box(w * 2, 0.045, 0.045, 0, y, z));
    for (const sx of [-1, 1]) T.add('camo', box(0.045, 0.045, d1 - d0, sx * w, y, (d0 + d1) / 2));
  }
  for (let x = -w + 0.11; x < w - 0.05; x += 0.11) for (const z of [d0, d1]) T.add('dark', box(0.022, y1 - y0 - 0.06, 0.022, x, (y0 + y1) / 2, z));
  for (let z = d0 + 0.11; z < d1 - 0.05; z += 0.11) for (const sx of [-1, 1]) T.add('dark', box(0.022, y1 - y0 - 0.06, 0.022, sx * w, (y0 + y1) / 2, z));
  // drive and elevation gear inside, hinge brackets
  T.add('camo', rbox(1.5, 0.32, 0.85, 0.03, 0, y0 + 0.2, 0.05));
  for (const s of [-1, 1]) {
    T.add('dark', box(0.12, 0.2, 0.3, s * 1.05, HINGE.y - 0.08, HINGE.z));
    T.add('steel', xTube(s * 0.95, s * 1.18, 0.06, 0.06, 10, HINGE.y, HINGE.z));
  }
  // cables climbing from the post into the antenna
  hose(T, V(-1.0, 0.1, 0.5), V(-1.2, HINGE.y + 0.15, HINGE.z + 0.35), 0.12, 0.035, 'rubber', 5);
  hose(T, V(-0.9, 0.1, 0.55), V(-1.1, HINGE.y + 0.15, HINGE.z + 0.4), 0.14, 0.03, 'rubber', 5);
}

function slab(A0) {
  const { w, h } = SLAB, c = 0.16, hw = w / 2, LH = 0.64; // LH: top of the lower housing
  // the antenna's paint is a lighter, greyer olive than the truck's (Kuzmin photo)
  const A = { add: (k, g, o) => A0.add(k, g, o ?? (k === 'camo' ? { tint: SLAB_PAINT } : undefined)) };
  // lower housing, section (z, y): deep, its nose chamfered back toward the hinge
  A.add('camo', profile([[0.14, 0.02], [-0.44, 0.02], [-0.64, 0.4], [-0.64, LH], [0.14, LH]], w, 0.04));
  // the plate above it, top corners cut off (outline seen from the front)
  const outline = (d) => [[-hw + d, LH], [hw - d, LH], [hw - d, h - c - d * 0.4], [hw - c - d * 0.4, h - d], [-hw + c + d * 0.4, h - d], [-hw + d, h - c - d * 0.4]];
  A.add('camo', frontProfile(outline(0), -0.56, -0.26));
  // face: plain plate (a greyer olive) inside a raised border with a row of fasteners
  A.add('white', frontProfile(outline(0.1), -0.575, -0.55), { tint: FACE });
  for (const sx of [-1, 1]) A.add('camo', box(0.06, h - c - LH - 0.1, 0.035, sx * (hw - 0.07), (LH + 0.04 + h - c) / 2, -0.575));
  A.add('camo', box(w - 0.08, 0.06, 0.035, 0, LH + 0.06, -0.575));
  A.add('camo', box(w - 2 * c - 0.1, 0.05, 0.035, 0, h - 0.06, -0.575));
  for (let i = 0; i < 17; i++) for (const sx of [-1, 1]) A.add('dark', box(0.022, 0.022, 0.01, sx * (hw - 0.07), LH + 0.2 + i * 0.12, -0.597)); // fasteners
  // lower housing: four hatches across its upper face, seam above the chamfer
  for (let i = 0; i < 4; i++) {
    const x = -1.08 + i * 0.72;
    A.add('dark', box(0.52, 0.15, 0.012, x, LH - 0.12, -0.646));
    A.add('camo', box(0.48, 0.11, 0.02, x, LH - 0.12, -0.648));
    A.add('steel', box(0.06, 0.03, 0.03, x + 0.18, LH - 0.12, -0.66));
  }
  A.add('dark', box(w - 0.08, 0.02, 0.02, 0, 0.41, -0.645));
  // side hoods and the top: small boxes on both edges, beacon on the top centre, lifting eyes
  for (const sx of [-1, 1]) {
    for (const y of [h - 0.55, h - 1.05]) A.add('camo', rbox(0.14, 0.24, 0.22, 0.02, sx * (hw + 0.06), y, -0.42));
    A.add('steel', box(0.04, 0.1, 0.1, sx * (hw - 0.4), h + 0.03, -0.4));
  }
  A.add('camo', yTube(h - 0.02, h + 0.1, 0.07, 0.07, 12, 0, -0.4));
  A.add('dark', yTube(h + 0.1, h + 0.13, 0.08, 0.08, 12, 0, -0.4));
  // back: horizontal cooling ribs on two stiffeners, the elevating cylinders' rods
  for (let y = LH + 0.16; y < h - c - 0.05; y += 0.075) A.add('camo', box(w - 0.12, 0.02, 0.035, 0, y, -0.245), { tint: new THREE.Color(0.92, 0.92, 0.85) });
  for (const s of [-1, 1]) A.add('camo', box(0.08, h - c - LH - 0.1, 0.06, s * 0.7, (LH + 0.1 + h - c) / 2, -0.23));
  for (const s of [-1, 1]) {
    A.add('dark', box(0.1, 0.1, 0.12, s * 0.85, 1.85, -0.2));
    A.add('steel', rod(V(s * 0.85, 1.85, -0.18), V(s * 0.85, 0.2, 0.75), 0.03, 8));
  }
  // cable bundles out of the lower housing's left side
  for (let i = 0; i < 3; i++) hose(A, V(-hw + 0.1, 0.5, -0.1 + i * 0.07), V(-hw + 0.05, -0.05, 0.45 + i * 0.05), 0.08, 0.03, 'rubber', 4);
}

// The elevating cylinders: barrels in turret space aimed at where the rods attach at mid tilt, so
// the rods (in the antenna's space) slide in and out of them as the antenna tilts.
function cylinders(T) {
  const mid = 0.16;
  for (const s of [-1, 1]) {
    const a = V(s * 0.85, 1.85, -0.18).applyAxisAngle(V(1, 0, 0), mid).add(V(0, HINGE.y, HINGE.z));
    const b = V(s * 0.85, 0.2, 0.75).applyAxisAngle(V(1, 0, 0), mid).add(V(0, HINGE.y, HINGE.z));
    const foot = b.clone().add(b.clone().sub(a).normalize().multiplyScalar(0.25));
    const tip = foot.clone().lerp(a, 0.55);
    T.add('dark', rod(foot, tip, 0.055, 10));
    T.add('dark', box(0.16, 0.12, 0.16, foot.x, foot.y - 0.02, foot.z));
  }
}

export function buildRadar() {
  const rig = newRig('green'), { root, mats } = rig;
  const P = { add: (k, g, o) => rig.P.add(k, g, o ?? (k === 'camo' ? { tint: BODY } : undefined)), build: (...a) => rig.P.build(...a) };
  chassis(P);
  cab(P);
  post(P);
  cabin(P);
  mast(P);
  P.build(root, { dirt: 0.45 });

  const tur = pivotAt(rig, root, 'turret', 0, TURN.y, Z(TURN.f));
  const T = new Parts(mats);
  turret(T);
  cylinders(T);
  T.build(tur, { dirt: 0.15, y0: TURN.y });
  const el = pivotAt(rig, tur, 'elevation', 0, HINGE.y, HINGE.z);
  const A = new Parts(mats);
  slab(A);
  A.build(el, { dirt: 0, y0: TURN.y + HINGE.y });

  rig.anchors.eye = node(root, 'eye', 0, 3.0, Z(6.0));
  rig.anchors.sight = node(el, 'sight', 0, (0.64 + SLAB.h) / 2, -0.6);
  hb(rig, -1.55, 0, Z(0), 1.55, 3.2, Z(7.3));
  hb(rig, -1.5, 1.4, Z(7.3), 1.5, 3.95, Z(12.6));
  hb(rig, -1.5, TURN.y, Z(TURN.f) - 0.8, 1.5, TURN.y + HINGE.y + SLAB.h + 0.1, Z(TURN.f) + 0.9);
  hb(rig, MAST.x - 0.3, CAB.top2, Z(MAST.f) - 0.3, MAST.x + 0.3, MAST.top, Z(MAST.f) + 0.3);
  return rig;
}
