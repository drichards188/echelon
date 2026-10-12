import * as THREE from 'three';
import { V, box, rbox, yTube, zTube, xTube, sphere, rod, plane, sideProfile, Parts, scaleUV, addLamp, runwayTexture, dish, addWheel, mudguard } from './kit.js';
import { runningGear, frameRails, sideGear, rearEnd, mzktCab, exhaustStack, jack, ladder, whip, uralCab, spareWheel, toolRack, snorkel } from './trucks.js';
import { newRig, node, pivotAt, hb, mzktTruck } from './rig.js';

// ---------------------------------------------------------------- S-400 TEL

export function canisterMesh(mats, L, w) {
  const P = new Parts(mats);
  P.add('canister', rbox(w, w, L, 0.1, 0, 0, -L / 2));
  P.add('dark', rbox(w * 1.02, w * 1.02, 0.12, 0.1, 0, 0, -L - 0.02)); // front closure
  P.add('steel', box(w * 0.55, w * 0.55, 0.03, 0, 0, -L - 0.095));
  P.add('dark', rbox(w * 0.8, w * 0.8, 0.3, 0.08, 0, 0, -0.1)); // tail
  for (const z of [-0.9, -2.7, -4.5, -6.3]) P.add('dark', rbox(w * 1.035, w * 1.035, 0.1, 0.1, 0, 0, z));
  P.add('white', box(w * 0.5, 0.01, 0.9, 0, w / 2 + 0.003, -3.6));
  P.add('rust', box(w * 0.3, 0.012, 0.5, 0, w / 2 + 0.004, -1.6));
  for (const s of [-1, 1]) for (const y of [-0.26, 0.26]) P.add('dark', box(0.03, 0.05, L * 0.9, s * (w / 2 + 0.01), y * w, -L / 2)); // guide rails
  return P;
}

export function buildTEL() {
  const rig = newRig('tri'), { P, root, mats } = rig;
  const { rear } = mzktTruck(P);
  // equipment housing behind the cab, hydraulic power pack, cable boxes
  P.add('camo', rbox(2.4, 0.9, 1.0, 0.05, 0, 1.8, -2.0));
  P.add('dark', box(2.0, 0.03, 0.7, 0, 2.27, -2.0));
  for (const s of [-1, 1]) {
    P.add('camo', rbox(0.5, 0.55, 1.1, 0.04, s * 1.15, 1.7, 3.55));
    P.add('dark', box(0.03, 0.4, 0.9, s * 1.405, 1.7, 3.55));
  }
  // stabilizer jacks on outriggers
  for (const [x, z] of [[-1.6, -1.0], [1.6, -1.0], [-1.6, 4.7], [1.6, 4.7]]) {
    P.add('dark', box(Math.abs(x) - 0.5, 0.2, 0.3, Math.sign(x) * (Math.abs(x) / 2 + 0.25), 1.0, z));
    jack(P, x, z, 1.1);
  }
  // hinge pedestals and stowed rests
  const py = 2.4, pz = 4.9;
  for (const s of [-1, 1]) {
    P.add('dark', box(0.3, 0.9, 0.5, s * 0.95, 1.8, pz));
    P.add('steel', xTube(s * 0.8, s * 1.15, 0.09, 0.09, 10, py, pz));
    P.add('dark', box(0.28, 0.22, 0.5, s * 0.55, 1.46, -2.2));
    P.add('dark', box(0.28, 0.22, 0.5, s * 0.55, 1.46, 0.8));
  }
  // stowage: jerrycans, a tarp roll and a spare cable drum on the rear bed
  for (let i = 0; i < 3; i++) P.add('paint', rbox(0.3, 0.45, 0.14, 0.02, -1.0 + i * 0.18, 1.6, -2.6 - 0.0));
  P.add('cloth', zTube(2.0, 3.0, 0.14, 0.14, 12, 1.12, 1.55));
  P.add('dark', xTube(-1.15, -0.75, 0.2, 0.2, 14, 1.6, 2.35));
  P.build(root, { dirt: 0.5 });

  const er = pivotAt(rig, root, 'erector', 0, py, pz);
  rig.pivots.erector = er;
  const Q = new Parts(mats);
  for (const s of [-1, 1]) {
    Q.add('dark', box(0.12, 0.2, 7.9, s * 0.92, -0.9, -3.9));
    Q.add('camo', box(0.06, 0.55, 7.7, s * 0.97, -0.55, -3.9));
  }
  for (const z of [-0.5, -2.6, -4.7, -6.8]) {
    Q.add('dark', box(1.9, 0.16, 0.22, 0, -0.91, z));
    for (const s of [-1, 1]) Q.add('dark', box(0.1, 1.7, 0.16, s * 0.93, -0.1, z));
  }
  Q.add('steel', xTube(-0.9, 0.9, 0.07, 0.07, 10, 0, 0));
  Q.add('dark', rbox(1.4, 0.5, 0.35, 0.05, 0, -0.78, -7.7)); // front crossbar
  Q.build(er, { dirt: 0.25, y0: py });
  const slotPos = [[-0.42, 0.42], [0.42, 0.42], [-0.42, -0.42], [0.42, -0.42]];
  slotPos.forEach(([x, y], i) => {
    const g = new THREE.Group();
    g.name = 'canister' + i;
    g.position.set(x, y, 0);
    er.add(g);
    canisterMesh(mats, 7.5, 0.76).build(g, { dirt: 0.15 });
    rig.slots.push([g]);
    const a = node(er, 'slot' + i, x, y, -7.62);
    rig.anchors.missileSlots.push(a);
  });
  rig.anchors.eye = node(root, 'eye', 0, 2.1, 0);
  hb(rig, -1.45, 0, -5.1, 1.45, 3.2, 5.3);
  return rig;
}


// ---------------------------------------------------------------- shared radar pieces

// Phased array face (dark lattice) on the -Z side (facing = -1) or +Z side (facing = +1).
function arrayFace(P, w, h, x, y, z, facing = -1) {
  const g = plane(w, h, x, y, z, 0, facing < 0 ? Math.PI : 0, 0);
  scaleUV(g, w / 0.8, h / 0.8);
  P.add('array', g);
}

// A flat array panel centred at the origin: face toward -Z, frame, rear housing with cooling ribs.
function arrayPanel(P, w, h, d, { double = false, key = 'paint' } = {}) {
  P.add(key, rbox(w, h, d, 0.04));
  arrayFace(P, w - 0.14, h - 0.14, 0, 0, -d / 2 - 0.004, -1);
  if (double) arrayFace(P, w - 0.14, h - 0.14, 0, 0, d / 2 + 0.004, 1);
  for (const [x, y, bw, bh] of [[0, h / 2, w, 0.1], [0, -h / 2, w, 0.1], [-w / 2, 0, 0.1, h], [w / 2, 0, 0.1, h]]) P.add('steel', box(bw + 0.02, bh + 0.0, d + 0.04, x, y, 0));
  // module seams
  for (let i = 1; i < 4; i++) P.add('dark', box(0.025, h - 0.14, 0.012, -w / 2 + (w * i) / 4, 0, -d / 2 - 0.012));
  for (let i = 1; i < 4; i++) P.add('dark', box(w - 0.14, 0.025, 0.012, 0, -h / 2 + (h * i) / 4, -d / 2 - 0.012));
  if (!double) for (let i = 0; i < 7; i++) P.add('dark', box(w * 0.78, 0.07, 0.16, 0, -h * 0.42 + i * (h * 0.84 / 6), d / 2 + 0.07));
}

// Lattice mast: four corner legs with zig-zag bracing between y0 and y1.
function lattice(P, x, z, y0, y1, w, key = 'paint', r = 0.045) {
  const h = w / 2;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) P.add(key, yTube(y0, y1, r, r, 6, x + sx * h, z + sz * h));
  const n = Math.max(2, Math.round((y1 - y0) / (w * 1.1)));
  for (let i = 0; i < n; i++) {
    const ya = y0 + ((y1 - y0) * i) / n, yb = y0 + ((y1 - y0) * (i + 1)) / n, f = i % 2 ? 1 : -1;
    P.add(key, rod(V(x - h * f, ya, z + h), V(x + h * f, yb, z + h), r * 0.5, 5));
    P.add(key, rod(V(x - h * f, ya, z - h), V(x + h * f, yb, z - h), r * 0.5, 5));
    P.add(key, rod(V(x + h, ya, z - h * f), V(x + h, yb, z + h * f), r * 0.5, 5));
    P.add(key, rod(V(x - h, ya, z - h * f), V(x - h, yb, z + h * f), r * 0.5, 5));
  }
}

// Equipment shelter box with a door, windows, vents and roof air conditioner
function shelter(P, x, y0, z0, z1, w, h, { door = true, doorSide = 1 } = {}) {
  const len = z1 - z0, cz = (z0 + z1) / 2, cy = y0 + h / 2;
  P.add('camo', rbox(w, h, len, 0.06, x, cy, cz));
  P.add('dark', box(w + 0.02, 0.05, len + 0.02, x, y0 + 0.02, cz));
  P.add('camo', box(w - 0.3, 0.06, len - 0.3, x, y0 + h + 0.03, cz));
  // roof air conditioner and vents
  P.add('white', rbox(0.9, 0.38, 1.1, 0.05, x - w * 0.2, y0 + h + 0.25, cz - len * 0.2));
  for (let i = 0; i < 5; i++) P.add('dark', box(0.8, 0.02, 0.02, x - w * 0.2, y0 + h + 0.25 + (i - 2) * 0.06, cz - len * 0.2 - 0.56));
  P.add('dark', yTube(y0 + h, y0 + h + 0.2, 0.12, 0.12, 12, x + w * 0.25, cz + len * 0.25));
  for (const s of [-1, 1]) {
    for (let i = 0; i < 2; i++) P.add('glass', box(0.03, 0.4, 0.55, x + s * (w / 2 + 0.003), y0 + h * 0.62, cz - len * 0.25 + i * len * 0.5));
    P.add('dark', box(0.05, 0.3, 0.7, x + s * (w / 2 + 0.01), y0 + h * 0.3, cz + len * 0.05)); // grille
    for (let i = 0; i < 5; i++) P.add('steel', box(0.02, 0.012, 0.64, x + s * (w / 2 + 0.03), y0 + h * 0.3 + (i - 2) * 0.06, cz + len * 0.05));
  }
  if (door) {
    const s = doorSide;
    P.add('dark', box(0.04, h * 0.7, 0.86, x + s * (w / 2 + 0.008), y0 + h * 0.4, z1 - 0.7));
    P.add('steel', box(0.06, 0.05, 0.14, x + s * (w / 2 + 0.03), y0 + h * 0.4, z1 - 0.4));
    P.add('steel', box(0.5, 0.04, 0.3, x + s * (w / 2 + 0.2), y0 + 0.2, z1 - 0.7));
    ladder(P, x + s * (w / 2 + 0.28), z1 - 0.35, y0 - 0.1, y0 + 0.3, 0.3);
  }
  return { top: y0 + h };
}

// ---------------------------------------------------------------- 92N6E engagement radar

export function buildRadar() {
  const rig = newRig('tri'), { P, root, mats } = rig;
  mzktTruck(P, { rear: 5.0, boxes: false });
  // equipment shelter behind the cab
  const sh = shelter(P, 0, 1.35, -2.4, 1.3, 2.55, 1.9, { door: true, doorSide: -1 });
  ladder(P, 1.3, -0.5, 1.35, sh.top, 0.4);
  // rear: turntable ring and stabilizer jacks
  const tz = 3.2;
  P.add('dark', yTube(1.35, 1.55, 1.25, 1.25, 24, 0, tz));
  P.add('steel', yTube(1.55, 1.6, 1.2, 1.2, 24, 0, tz));
  for (const [x, z] of [[-1.6, -1.0], [1.6, -1.0], [-1.6, 4.8], [1.6, 4.8]]) {
    P.add('dark', box(Math.abs(x) - 0.5, 0.2, 0.3, Math.sign(x) * (Math.abs(x) / 2 + 0.25), 1.0, z));
    jack(P, x, z, 1.1);
  }
  P.add('camo', rbox(0.6, 0.5, 1.2, 0.04, -1.1, 1.62, 0.55)); // cable box
  P.add('camo', rbox(0.6, 0.5, 1.2, 0.04, 1.1, 1.62, 0.55));
  P.add('cloth', zTube(-2.3, -1.4, 0.15, 0.15, 12, -0.9, 3.45));
  P.build(root, { dirt: 0.5 });

  // rotating mast and array
  const tur = pivotAt(rig, root, 'turret', 0, 1.6, tz);
  const T = new Parts(mats);
  T.add('paint', rbox(3.0, 0.3, 2.4, 0.05, 0, 0.15, 0));
  T.add('dark', yTube(0.0, 0.1, 1.15, 1.15, 24));
  for (const s of [-1, 1]) {
    T.add('paint', rbox(0.34, 3.7, 0.5, 0.04, s * 1.95, 2.0, 0));
    T.add('dark', box(0.4, 0.25, 0.7, s * 1.95, 0.4, 0));
    T.add('steel', xTube(s * 1.75, s * 2.2, 0.13, 0.13, 12, 3.85, 0));
    T.add('dark', rod(V(s * 1.8, 0.3, -1.1), V(s * 1.95, 2.8, -0.15), 0.05));
    T.add('dark', rod(V(s * 1.8, 0.3, 1.1), V(s * 1.95, 2.8, 0.15), 0.05));
    ladder(T, s * 2.15, 0.0, 0.3, 3.2, 0.36);
  }
  T.add('paint', rbox(2.7, 0.3, 0.5, 0.04, 0, 0.55, 0.5));
  for (const s of [-1, 1]) T.add('amber', box(0.12, 0.1, 0.1, s * 1.95, 3.95, -0.22));
  T.build(tur, { dirt: 0.2, y0: 1.6 });
  const el = pivotAt(rig, tur, 'elevation', 0, 3.85, 0);
  const A = new Parts(mats);
  arrayPanel(A, 3.3, 3.0, 0.5);
  for (const s of [-1, 1]) A.add('steel', xTube(s * 1.65, s * 1.8, 0.1, 0.1, 12, 0, 0));
  for (let i = 0; i < 5; i++) A.add('white', rbox(0.2, 0.1, 0.1, 0.02, -1.3 + i * 0.65, 1.57, -0.1)); // IFF/aux dipoles
  A.add('dark', box(3.3, 0.06, 0.2, 0, 1.53, -0.0));
  A.build(el, { dirt: 0, y0: 5.4 });
  rig.anchors.eye = node(root, 'eye', 0, 3.0, 1.5);
  rig.anchors.sight = node(el, 'sight', 0, 0, -0.3);
  hb(rig, -1.45, 0, -5.1, 1.45, 3.4, 5.3);
  hb(rig, -2.1, 3.3, 2.4, 2.1, 7.2, 4.0);
  return rig;
}

// ---------------------------------------------------------------- 91N6E acquisition radar

export function buildSearch() {
  const rig = newRig('tri'), { P, root, mats } = rig;
  const g = new THREE.Group();
  g.position.z = -3.8; // centre the 17 m long rig on its origin
  root.add(g);
  mzktTruck(P, { axles: [-3.55, -2.0, 0.55], rear: 1.9, boxes: false, bed: false });
  P.add('camo', rbox(2.5, 0.14, 3.4, 0.03, 0, 1.36, 0.0)); // tractor deck
  P.add('steel', yTube(1.43, 1.52, 0.55, 0.55, 20, 0, 0.2)); // fifth wheel
  // semitrailer
  const z0 = 0.3, z1 = 11.4, deck = 1.62;
  for (const s of [-1, 1]) {
    P.add('dark', box(0.2, 0.42, z1 - z0, s * 0.8, deck - 0.3, (z0 + z1) / 2));
    P.add('dark', box(0.04, 0.02, z1 - z0, s * 0.92, deck - 0.08, (z0 + z1) / 2));
  }
  for (let z = z0 + 0.5; z < z1; z += 1.1) P.add('dark', box(1.6, 0.14, 0.12, 0, deck - 0.4, z));
  P.add('camo', rbox(2.6, 0.14, z1 - z0, 0.03, 0, deck - 0.07, (z0 + z1) / 2));
  P.add('dark', box(2.64, 0.03, z1 - z0, 0, deck - 0.14, (z0 + z1) / 2));
  runningGear(P, { axles: [8.3, 9.7], R: 0.56, W: 0.4, track: 1.12, steered: 0 });
  rearEnd(P, z1 + 0.05, 2.3, 1.0);
  P.add('steel', yTube(0.2, 1.4, 0.07, 0.07, 8, 0.6, 3.0)); // landing legs
  P.add('steel', yTube(0.2, 1.4, 0.07, 0.07, 8, -0.6, 3.0));
  P.add('dark', box(0.4, 0.05, 0.5, 0.6, 0.12, 3.0));
  P.add('dark', box(0.4, 0.05, 0.5, -0.6, 0.12, 3.0));
  for (const [x, z] of [[-1.55, 5.8], [1.55, 5.8], [-1.55, 11.0], [1.55, 11.0]]) {
    P.add('dark', box(Math.abs(x) - 0.55, 0.2, 0.3, Math.sign(x) * (Math.abs(x) / 2 + 0.28), 1.1, z));
    jack(P, x, z, 1.2);
  }
  // equipment cabin and mast tower
  const sh = shelter(P, 0, deck, 1.0, 5.5, 2.55, 2.35, { door: true, doorSide: 1 });
  P.add('camo', rbox(0.8, 0.5, 0.9, 0.04, -1.0, deck + 0.3, 6.1)); // generator housing
  P.add('camo', rbox(0.8, 0.5, 0.9, 0.04, 1.0, deck + 0.3, 6.1));
  P.add('paint', rbox(1.3, 0.5, 1.3, 0.04, 0, deck + 0.25, 7.2));
  lattice(P, 0, 7.2, deck + 0.5, 6.5, 0.95, 'paint', 0.06);
  for (const s of [-1, 1]) P.add('dark', rod(V(s * 0.6, deck + 0.4, 7.2), V(s * 0.45, deck + 3.2, 7.2), 0.03));
  P.add('dark', yTube(6.4, 6.62, 0.7, 0.7, 20, 0, 7.2));
  ladder(P, 0.0, 7.75, deck + 0.4, 6.4, 0.4);
  P.add('cloth', zTube(1.1, 4.5, 0.2, 0.2, 12, -0.9, deck + 0.15 + 2.5)); // cable bundle on the roof
  P.build(g, { dirt: 0.5 });
  const sr = pivotAt(rig, g, 'searchRadar', 0, 8.3, 7.2);
  const A = new Parts(mats);
  arrayPanel(A, 6.4, 3.0, 0.5, { double: true });
  A.add('dark', yTube(-1.7, -1.4, 0.55, 0.55, 20, 0, 0));
  A.add('paint', rbox(0.9, 0.3, 0.9, 0.04, 0, -1.58, 0));
  A.add('amber', box(0.12, 0.1, 0.12, 0, 1.58, 0));
  for (const s of [-1, 1]) A.add('paint', rod(V(s * 1.0, -1.45, 0), V(s * 2.4, -1.4, 0), 0.04));
  A.build(sr, { dirt: 0, y0: 8.3 });
  rig.anchors.eye = node(root, 'eye', 0, 4.2, 3.4);
  hb(rig, -1.45, 0, -8.8, 1.45, 3.6, -2.0);
  hb(rig, -1.4, 0.4, -2.8, 1.4, 4.2, 7.8);
  hb(rig, -3.3, 6.5, 3.1, 3.3, 9.9, 4.4);
  return rig;
}

// ---------------------------------------------------------------- 55K6E command post

export function buildCP() {
  const rig = newRig('tri'), { P, root } = rig;
  const R = 0.6;
  runningGear(P, { axles: [-3.0, 0.7, 2.2], R, W: 0.42, track: 1.05, steered: 1, lugs: 20 });
  frameRails(P, -4.1, 4.7, 1.05, 1.1);
  P.add('steel', zTube(-1.5, 0.5, 0.3, 0.3, 14, 0.95, 0.9)); // fuel tank
  spareWheel(P, -0.78, 0.62, -1.15, 0.6, 0.42, -1);
  const c = uralCab(P, -4.3, 1.25);
  P.add('camo', rbox(2.4, 0.14, 5.7, 0.03, 0, 1.2, 1.85));
  rearEnd(P, 4.75, 2.1, 0.8);
  // the KUNG body
  const sh = shelter(P, 0, 1.27, -1.0, 4.7, 2.6, 2.4, { door: true, doorSide: 1 });
  // rear door
  P.add('dark', box(1.1, 1.9, 0.04, 0.5, 2.35, 4.71));
  P.add('steel', box(0.1, 0.06, 0.04, 0.1, 2.3, 4.74));
  P.add('steel', box(0.8, 0.05, 0.4, 0.5, 1.15, 4.95));
  P.add('steel', box(0.8, 0.05, 0.4, 0.5, 0.78, 4.95));
  for (const s of [-1, 1]) P.add('steel', yTube(0.78, 1.9, 0.02, 0.02, 6, 0.5 + s * 0.38, 4.95));
  // roof: telescopic mast with whips, a small satellite dish, antenna array, cables
  const top = sh.top + 0.06;
  P.add('steel', yTube(top, top + 0.15, 0.18, 0.18, 12, -0.7, 1.4));
  for (let i = 0; i < 5; i++) P.add('steel', yTube(top + 0.15 + i * 0.7, top + 0.85 + i * 0.7, 0.14 - i * 0.02, 0.14 - i * 0.02, 10, -0.7, 1.4));
  P.add('dark', box(1.5, 0.03, 0.03, -0.7, top + 3.4, 1.4));
  for (const s of [-1, 1]) P.add('steel', yTube(top + 3.2, top + 3.6, 0.01, 0.01, 4, -0.7 + s * 0.7, 1.4));
  P.add('dark', box(0.1, 0.1, 0.1, -0.7, top + 3.55, 1.4));
  for (const [x, z, h] of [[0.85, 3.6, 2.4], [1.05, 3.8, 3.2], [0.4, 3.9, 2.0]]) whip(P, x, top, z, h);
  P.add('steel', yTube(top, top + 0.8, 0.05, 0.05, 8, 0.9, 1.6));
  P.add('dark', box(0.6, 0.06, 0.6, 0.9, top + 0.8, 1.6));
  P.add('white', dish(0.45, 0.14, 0.025, 20).applyMatrix4(new THREE.Matrix4().compose(V(0.9, top + 1.1, 1.6), new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.5, 0.4, 0)), V(1, 1, 1))));
  P.add('dark', rod(V(0.9, top + 0.9, 1.6), V(0.84, top + 1.2, 1.35), 0.012));
  P.add('rust', box(0.5, 0.3, 0.4, -0.4, top + 0.2, 3.4)); // generator exhaust/vent housing
  P.add('cloth', zTube(2.4, 4.0, 0.12, 0.12, 10, 0.95, top + 0.14));
  P.build(root, { dirt: 0.5 });
  rig.anchors.eye = node(root, 'eye', 0, 2.5, 0.8);
  hb(rig, -1.4, 0, -4.4, 1.4, 3.4, 5.0);
  return rig;
}
