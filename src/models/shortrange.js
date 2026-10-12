import * as THREE from 'three';
import { V, box, rbox, yTube, zTube, xTube, sphere, rod, plane, sideProfile, topProfile, loft, ringAt, Parts, scaleUV, addLamp, dish, addWheel, mudguard, hubGeometry, tyreGeometry, xf, DEG } from './kit.js';
import { runningGear, frameRails, sideGear, rearEnd, exhaustStack, jack, ladder, whip, kamazCab, snorkel, toolRack, hose } from './trucks.js';
import { newRig, node, pivotAt, hb } from './rig.js';

// Short-range layer: Pantsir-S1, Osa-AKM, Strela-10M3.

function arrayFace(P, w, h, x, y, z, facing = -1) {
  const g = plane(w, h, x, y, z, 0, facing < 0 ? Math.PI : 0, 0);
  scaleUV(g, w / 0.8, h / 0.8);
  P.add('array', g);
}

// Lens window on a sensor block: black tube with a glass front
function lens(P, x, y, z, r, d = 0.06) {
  P.add('dark', zTube(z, z - d, r * 1.15, r * 1.15, 14, x, y));
  P.add('glass', zTube(z - d, z - d - 0.008, r * 0.9, r * 0.9, 14, x, y));
}

// ---------------------------------------------------------------- Pantsir-S1

function pantsirBarrel(P, x, y, z0, zm) {
  P.add('dark', zTube(z0, zm + 0.45, 0.034, 0.034, 10, x, y));
  P.add('steel', zTube(z0, z0 - 0.9, 0.052, 0.046, 10, x, y)); // jacket
  P.add('steel', zTube(zm + 0.5, zm, 0.052, 0.052, 10, x, y)); // muzzle brake
  for (let i = 0; i < 3; i++) P.add('dark', zTube(zm + 0.34 - i * 0.12, zm + 0.28 - i * 0.12, 0.058, 0.058, 10, x, y));
}

export function buildPantsir() {
  const rig = newRig('tri'), { P, root, mats } = rig;
  const R = 0.64, deck = 1.45;
  runningGear(P, { axles: [-3.3, -1.85, 1.4, 2.85], R, W: 0.44, track: 1.15, steered: 2 });
  frameRails(P, -4.4, 4.5, 1.1, 1.2);
  sideGear(P, -1.05, 0.75, 0.95, 1.0, false);
  const c = kamazCab(P, -4.55, 1.2);
  exhaustStack(P, 1.1, c.back + 0.1, 1.4, 3.4);
  whip(P, -1.0, c.top + 0.12, c.back - 0.3, 2.2);
  P.add('dark', box(2.3, 0.5, 0.3, 0, 1.12, c.back + 0.05));
  const len = 4.5 - (c.back - 0.0);
  P.add('camo', rbox(2.5, 0.12, len, 0.03, 0, deck - 0.06, (c.back + 4.5) / 2));
  for (const s of [-1, 1]) {
    P.add('camo', box(0.05, 0.34, len, s * 1.25, deck - 0.29, (c.back + 4.5) / 2));
    P.add('dark', box(0.07, 0.04, len, s * 1.26, deck - 0.1, (c.back + 4.5) / 2));
    P.add('camo', rbox(0.5, 0.45, 1.0, 0.04, s * 1.0, deck + 0.22, 3.65)); // stowage lockers rear
    P.add('dark', box(0.03, 0.34, 0.8, s * 1.255, deck + 0.22, 3.65));
  }
  P.add('cloth', zTube(3.2, 4.2, 0.13, 0.13, 12, 0.0, deck + 0.13));
  rearEnd(P, 4.55, 2.2, 0.85);
  snorkel(P, -1.1, c.back + 0.1, 1.4, 3.2);
  toolRack(P, -1.275, deck - 0.2, 2.7, -1);
  for (const [x, z] of [[0.88, 3.4], [1.12, 3.4], [0.88, 3.9]]) { // jerrycans on the right locker
    P.add('canister', rbox(0.16, 0.32, 0.3, 0.025, x, deck + 0.61, z));
    P.add('dark', box(0.1, 0.04, 0.08, x, deck + 0.79, z));
  }
  hose(P, V(0.6, 1.25, c.back + 0.05), V(0.7, 1.35, c.back + 0.5), 0.12, 0.03);
  hose(P, V(-0.6, 1.25, c.back + 0.05), V(-0.7, 1.35, c.back + 0.5), 0.12, 0.03);
  // turret ring
  P.add('dark', yTube(deck, deck + 0.12, 1.15, 1.15, 28, 0, 0.9));
  P.build(root, { dirt: 0.5 });

  const tur = pivotAt(rig, root, 'turret', 0, deck + 0.12, 0.9);
  const T = new Parts(mats);
  const body = [[-1.5, 0.0], [-1.5, 0.95], [-1.1, 1.3], [1.5, 1.3], [1.6, 1.15], [1.6, 0.0]];
  T.add('camo', sideProfile(body, 1.8, 0.06));
  for (const s of [-1, 1]) {
    T.add('dark', box(0.03, 0.8, 1.0, s * 0.915, 0.65, 0.2)); // armoured door
    T.add('steel', box(0.04, 0.06, 0.16, s * 0.93, 0.65, -0.1));
    for (let i = 0; i < 4; i++) T.add('steel', box(0.02, 0.012, 0.8, s * 0.93, 0.35 + i * 0.07, 1.0));
    T.add('steel', rod(V(s * 0.93, 0.35, -1.0), V(s * 0.93, 1.0, -1.0), 0.015));
  }
  T.add('dark', box(0.9, 0.04, 0.9, 0.0, 1.32, 0.35)); // roof hatch
  T.add('steel', yTube(1.32, 1.4, 0.07, 0.07, 8, 0.35, 0.35));
  T.add('camo', rbox(0.9, 0.3, 0.8, 0.05, 0, 1.45, 0.95)); // mast housing
  T.add('white', sphere(0.11, -0.55, 1.4, -0.6, 1, 0.75, 1, 12)); // satellite navigation dome
  whip(T, 0.6, 1.32, -1.1, 1.4); // command link whip
  for (const x of [-0.6, 0.6]) T.add('dark', rod(V(x, 1.32, 0.1), V(x, 1.32, 0.9), 0.015, 5)); // roof grab rails
  for (const x of [-0.6, 0.6]) for (const z of [0.1, 0.9]) T.add('dark', rod(V(x, 1.3, z), V(x, 1.4, z), 0.015, 4));
  T.add('dark', yTube(1.6, 2.15, 0.09, 0.1, 12, 0, 1.15));
  T.add('dark', yTube(2.1, 2.3, 0.3, 0.3, 18, 0, 1.15));
  T.build(tur, { dirt: 0.3, y0: 1.57 });

  // search radar (1RS1-1E): rotating array on the turret rear
  const sr = pivotAt(rig, tur, 'searchRadar', 0, 2.3, 1.15);
  const S = new Parts(mats);
  S.add('paint', rbox(1.7, 0.85, 0.16, 0.03, 0, 0.55, -0.1));
  arrayFace(S, 1.58, 0.72, 0, 0.55, -0.19);
  S.add('steel', box(1.74, 0.04, 0.2, 0, 0.99, -0.1));
  S.add('steel', box(1.74, 0.04, 0.2, 0, 0.11, -0.1));
  for (let i = 0; i < 5; i++) S.add('dark', box(1.4, 0.05, 0.1, 0, 0.25 + i * 0.15, 0.04));
  S.add('paint', rbox(0.9, 0.2, 0.1, 0.02, 0, 1.18, -0.1)); // IFF antenna on top
  for (let i = 0; i < 6; i++) S.add('steel', box(0.1, 0.14, 0.03, -0.4 + i * 0.16, 1.18, -0.17));
  S.add('paint', yTube(0, 0.15, 0.22, 0.28, 16, 0, 0));
  S.add('paint', box(0.5, 0.45, 0.35, 0, 0.35, 0.12));
  S.build(sr, { dirt: 0, y0: 3.9 });

  // elevating assembly: radar, EO block, two twin 30 mm, two 6-tube pods
  const el = pivotAt(rig, tur, 'elevation', 0, 1.95, -0.35);
  const E = new Parts(mats);
  E.add('camo', rbox(0.82, 0.75, 1.3, 0.05, 0, -0.05, 0.05));
  E.add('paint', rbox(0.9, 0.62, 0.22, 0.03, 0, -0.1, -0.58)); // tracking radar (1RS2-1E)
  arrayFace(E, 0.78, 0.5, 0, -0.1, -0.696);
  E.add('steel', box(0.92, 0.04, 0.24, 0, 0.22, -0.58));
  E.add('steel', box(0.92, 0.04, 0.24, 0, -0.42, -0.58));
  for (const s of [-1, 1]) {
    E.add('dark', box(0.1, 0.1, 0.12, s * 0.56, 0.1, -0.64)); // guidance horns
    E.add('steel', zTube(-0.69, -0.76, 0.05, 0.06, 10, s * 0.56, 0.1));
  }
  // EO block (OEPS-1): ball-less box with TV, thermal and laser windows
  E.add('paint', rbox(0.66, 0.44, 0.55, 0.06, 0, 0.5, -0.15));
  E.add('dark', rbox(0.7, 0.05, 0.6, 0.02, 0, 0.74, -0.15));
  lens(E, -0.18, 0.5, -0.425, 0.075);
  lens(E, 0.06, 0.5, -0.425, 0.095);
  lens(E, 0.26, 0.55, -0.425, 0.04);
  lens(E, 0.26, 0.43, -0.425, 0.04);
  for (const s of [-1, 1]) {
    // twin 30 mm 2A38M: housing, ammunition boxes, barrels
    const x = s * 0.74;
    E.add('camo', rbox(0.42, 0.62, 1.1, 0.05, x, -0.15, -0.1));
    E.add('dark', rbox(0.3, 0.2, 0.5, 0.03, x, -0.52, 0.0));
    E.add('camo', rbox(0.4, 0.42, 0.7, 0.05, x, -0.1, 0.85));
    E.add('dark', box(0.3, 0.1, 0.1, x, -0.4, 0.5));
    pantsirBarrel(E, x, -0.04, -0.62, -2.35);
    pantsirBarrel(E, x, -0.27, -0.62, -2.35);
    E.add('dark', box(0.34, 0.5, 0.05, x, -0.15, -0.65));
    // pod: body and six tubes
    const px = s * 1.24, py = 0.02;
    E.add('camo', rbox(0.66, 0.5, 2.7, 0.05, px, py, -0.65));
    E.add('dark', box(0.7, 0.06, 2.72, px, py + 0.26, -0.65));
    E.add('dark', box(0.7, 0.06, 2.72, px, py - 0.26, -0.65));
    E.add('dark', rbox(0.14, 0.4, 0.8, 0.02, s * 0.97, -0.05, -0.2)); // pod bracket
    for (let k = 0; k < 6; k++) {
      const cx = px + ((k % 3) - 1) * 0.2, cy = py + (k < 3 ? 0.1 : -0.1);
      E.add('canister', zTube(-0.7, -2.55, 0.086, 0.086, 12, cx, cy));
      E.add('dark', zTube(-2.5, -2.58, 0.092, 0.092, 12, cx, cy));
    }
  }
  E.build(el, { dirt: 0, y0: 3.5 });
  for (const s of [-1, 1]) for (const y of [-0.04, -0.27]) rig.anchors.muzzles.push(node(el, 'muzzle' + rig.anchors.muzzles.length, s * 0.74, y, -2.37));
  for (let k = 0; k < 12; k++) {
    const s = k < 6 ? -1 : 1, j = k % 6;
    const cx = s * 1.24 + ((j % 3) - 1) * 0.2, cy = 0.02 + (j < 3 ? 0.1 : -0.1);
    const g = new THREE.Group();
    const M = new Parts(mats);
    M.add('white', zTube(-2.3, -2.45, 0.07, 0.06, 10, cx, cy), { tint: 0x8a8d90 });
    M.add('white', zTube(-2.45, -2.62, 0.06, 0.012, 10, cx, cy)); // nose of the missile in the tube
    M.build(g);
    el.add(g);
    rig.slots.push([g]);
    rig.anchors.missileSlots.push(node(el, 'slot' + k, cx, cy, -2.62));
  }
  rig.anchors.sight = node(el, 'sight', 0.06, 0.5, -0.5);
  rig.anchors.eye = node(root, 'eye', 0, 2.6, 0.4);
  hb(rig, -1.45, 0, -4.7, 1.45, 3.1, -2.3);
  hb(rig, -1.5, 0.3, -2.4, 1.5, 4.3, 4.6);
  return rig;
}

// ---------------------------------------------------------------- Osa-AKM (BAZ-5937)

// Parabolic cylinder reflector (axis along x), opening toward -Z: the vertex sits at z = 0 and the
// rim edges at z = -depth. A profile extruded across the width, thickness t toward +Z.
function cylinderDish(w, h, depth, t = 0.03) {
  const n = 10, front = [];
  for (let i = 0; i <= n; i++) { const y = -h / 2 + (h * i) / n; front.push([-depth * (2 * y / h) ** 2, y]); }
  const back = front.slice().reverse().map(([z, y]) => [z + t, y]);
  const sh = new THREE.Shape([...front, ...back].map(([z, y]) => new THREE.Vector2(z, y)));
  const g = new THREE.ExtrudeGeometry(sh, { depth: w, bevelEnabled: false });
  g.translate(0, 0, -w / 2);
  g.rotateY(-Math.PI / 2);
  return g;
}

// The Osa's search antenna: a 1.7 m by 0.9 m wire-mesh parabolic cylinder (horizontal and vertical
// bars over the reflecting surface), end plates and a top and bottom rail, back bracing on a cross
// tube, a feed horn array on struts at the focal line and the IFF dipoles on a bar above. Centred on
// the origin, opening toward -Z.
function searchAntenna(Q, M0) {
  const P = { add: (key, g) => Q.add(key, g.applyMatrix4(M0)) };
  const W = 1.7, H = 0.9, Dp = 0.26, t = 0.025;
  const zAt = (y) => -Dp * (2 * y / H) ** 2;
  P.add('paint', cylinderDish(W, H, Dp, t));
  for (const s of [-1, 1]) P.add('steel', cylinderDish(0.035, H + 0.02, Dp, t + 0.012).applyMatrix4(xf(s * (W / 2 + 0.01), 0, 0))); // end plates
  for (const s of [-1, 1]) P.add('steel', box(W + 0.06, 0.05, 0.07, 0, s * (H / 2 + 0.01), zAt(s * H / 2) + 0.01)); // top and bottom rails
  for (let i = -7; i <= 7; i++) { // horizontal bars
    const y = (i / 7.5) * (H / 2);
    P.add('steel', xTube(-W / 2, W / 2, 0.007, 0.007, 4, y, zAt(y) - 0.014));
  }
  for (let k = -4; k <= 4; k++) { // vertical bars, in short lengths along the curve
    for (let i = -6; i < 6; i++) {
      const y0 = (i / 6) * (H / 2), y1 = ((i + 1) / 6) * (H / 2);
      P.add('steel', rod(V(k * 0.18, y0, zAt(y0) - 0.02), V(k * 0.18, y1, zAt(y1) - 0.02), 0.008, 4));
    }
  }
  // back bracing: a cross tube and plates
  P.add('steel', xTube(-W / 2 + 0.1, W / 2 - 0.1, 0.035, 0.035, 8, 0, t + 0.07));
  for (let k = -2; k <= 2; k++) {
    P.add('dark', rod(V(k * 0.36, 0, t + 0.07), V(k * 0.36, H / 2 - 0.03, zAt(H / 2) + t), 0.016, 5));
    P.add('dark', rod(V(k * 0.36, 0, t + 0.07), V(k * 0.36, -H / 2 + 0.03, zAt(H / 2) + t), 0.016, 5));
  }
  P.add('dark', rbox(0.3, 0.3, 0.2, 0.03, 0, 0, t + 0.16)); // the drive housing behind the vertex
  // feed: four horns across the focal line on two struts from the rim rails
  const fz = -0.62;
  for (const s of [-1, 1]) {
    P.add('steel', rod(V(s * 0.55, H / 2, zAt(H / 2)), V(s * 0.3, 0.04, fz + 0.04), 0.014, 5));
    P.add('steel', rod(V(s * 0.55, -H / 2, zAt(H / 2)), V(s * 0.3, -0.04, fz + 0.04), 0.014, 5));
  }
  P.add('dark', box(0.9, 0.12, 0.07, 0, 0, fz + 0.1));
  for (let i = -2; i <= 1; i++) {
    P.add('dark', rbox(0.17, 0.14, 0.14, 0.02, (i + 0.5) * 0.22, 0, fz));
    P.add('steel', box(0.12, 0.09, 0.02, (i + 0.5) * 0.22, 0, fz - 0.075));
  }
  // IFF dipoles on a bar above
  P.add('paint', box(1.2, 0.04, 0.06, 0, H / 2 + 0.2, zAt(H / 2) + 0.12));
  P.add('steel', rod(V(0.4, H / 2 + 0.01, zAt(H / 2) + 0.04), V(0.4, H / 2 + 0.2, zAt(H / 2) + 0.12), 0.012, 4));
  P.add('steel', rod(V(-0.4, H / 2 + 0.01, zAt(H / 2) + 0.04), V(-0.4, H / 2 + 0.2, zAt(H / 2) + 0.12), 0.012, 4));
  for (let i = 0; i < 7; i++) P.add('steel', box(0.015, 0.14, 0.015, -0.54 + i * 0.18, H / 2 + 0.29, zAt(H / 2) + 0.12));
}

// The Osa's tracking antenna: a 1 m dish with a rim ring, back hub and ribs, a feed horn at the
// focus on three struts, and a plain pedestal and yoke. Built with its centre at the origin
// (dish axis along -Z), then placed by the caller.
function trackingDish(P, M) {
  const R = 0.5, d = 0.14, F = (R * R) / (4 * d);
  const at = (g) => P.add('white', g.applyMatrix4(M));
  at(dish(R, d, 0.025, 36));
  P.add('steel', new THREE.TorusGeometry(R, 0.016, 6, 36).translate(0, 0, -d).applyMatrix4(M)); // rim
  P.add('dark', zTube(0.0, 0.16, 0.1, 0.12, 12, 0, 0).applyMatrix4(M)); // back hub
  for (let i = 0; i < 6; i++) { // radial ribs behind the dish
    const a = (i / 6) * Math.PI * 2;
    P.add('paint', rod(V(Math.cos(a) * 0.09, Math.sin(a) * 0.09, 0.1), V(Math.cos(a) * R * 0.92, Math.sin(a) * R * 0.92, -d * 0.85 + 0.03), 0.012, 4).applyMatrix4(M));
  }
  for (let i = 0; i < 3; i++) { // feed struts from the rim to the focus
    const a = Math.PI / 2 + (i / 3) * Math.PI * 2;
    P.add('steel', rod(V(Math.cos(a) * R, Math.sin(a) * R, -d), V(0, 0, -F), 0.011, 4).applyMatrix4(M));
  }
  P.add('dark', zTube(-F + 0.12, -F, 0.05, 0.035, 10, 0, 0).applyMatrix4(M)); // feed horn
  P.add('white', zTube(-F + 0.125, -F + 0.12, 0.052, 0.052, 10, 0, 0).applyMatrix4(M));
}

export function buildOsa() {
  const rig = newRig('green'), { P, root, mats } = rig;
  const R = 0.6;
  runningGear(P, { axles: [-1.9, 0.1, 2.1], R, W: 0.38, track: 1.2, steered: 1, lugs: 20 });
  // boat hull: lower hull between the wheels, wide upper hull above them, pointed bow
  P.add('camo', topProfile([[-1.12, -2.3], [-0.65, -3.95], [0.65, -3.95], [1.12, -2.3], [1.12, 3.95], [-1.12, 3.95]], 0.42, 1.32));
  P.add('dark', box(2.0, 0.06, 7.2, 0, 0.4, 0.0));
  const ring0 = ringAt([[-1.4, -2.6], [-0.95, -3.9], [0.95, -3.9], [1.4, -2.6], [1.4, 3.95], [-1.4, 3.95]], 1.3);
  const ring1 = ringAt([[-1.34, -1.7], [-0.8, -2.3], [0.8, -2.3], [1.34, -1.7], [1.34, 3.85], [-1.34, 3.85]], 2.02);
  P.add('camo', loft([ring0, ring1]));
  // side sponsons over the wheels and wheel-well liners
  for (const s of [-1, 1]) {
    P.add('dark', box(0.06, 0.18, 7.5, s * 1.405, 1.3, 0.0));
    for (const z of [-1.9, 0.1, 2.1]) P.add('dark', box(0.04, 0.25, 1.4, s * 1.1, 1.18, z));
    addLamp(P, s * 0.8, 1.5, -3.68, 0.3, 0.16, 0.08);
    addLamp(P, s * 0.95, 1.5, -3.5, 0.12, 0.1, 0.06, 'amber');
    P.add('steel', rod(V(s * 0.55, 0.7, -3.85), V(s * 0.55, 0.5, -4.15), 0.03));
    P.add('steel', rod(V(s * 0.55, 0.5, -4.15), V(s * 0.55, 0.38, -4.08), 0.03));
    P.add('steel', box(0.05, 0.4, 0.05, s * 1.3, 1.6, 2.9)); // cable bracket
    P.add('camo', rbox(0.28, 0.2, 0.9, 0.03, s * 1.28, 1.52, 3.2)); // tool boxes on the sponson
    // rear: waterjet tunnels
    P.add('dark', zTube(3.95, 4.06, 0.19, 0.19, 14, s * 0.6, 0.85));
    P.add('steel', zTube(4.06, 4.1, 0.12, 0.12, 14, s * 0.6, 0.85));
  }
  // bow: trim vane folded on the glacis, hatches, periscopes
  P.add('camo', rbox(1.6, 0.05, 1.5, 0.02, 0, 1.72, -3.05, -0.38));
  P.add('dark', box(1.6, 0.04, 0.05, 0, 1.46, -3.65, -0.38));
  for (const s of [-1, 1]) P.add('steel', rod(V(s * 0.8, 1.52, -3.5), V(s * 0.8, 1.74, -2.7), 0.02));
  P.add('camo', rbox(0.7, 0.2, 0.6, 0.05, -0.45, 1.98, -1.85));
  for (const x of [-0.7, -0.45, -0.2]) P.add('glass', box(0.1, 0.06, 0.04, x, 2.04, -2.16));
  P.add('camo', rbox(0.6, 0.12, 0.6, 0.05, 0.6, 1.98, -1.75));
  P.add('steel', yTube(1.98, 2.1, 0.1, 0.1, 10, 0.6, -1.75));
  for (let i = 0; i < 6; i++) P.add('steel', box(0.9, 0.015, 0.05, 0, 2.03, 3.0 + i * 0.12 - 0.3)); // engine louvres
  P.add('dark', box(1.1, 0.02, 0.9, 0, 2.03, 3.1));
  // rear door: a panel outlined by its seams, with hinges, a handle and a lock bar
  P.add('camo', rbox(1.1, 0.8, 0.04, 0.01, 0, 1.35, 3.962));
  P.add('dark', box(1.12, 0.025, 0.02, 0, 0.95, 3.985));
  P.add('dark', box(1.12, 0.025, 0.02, 0, 1.75, 3.985));
  for (const x of [-0.56, 0, 0.56]) P.add('dark', box(0.025, 0.82, 0.02, x, 1.35, 3.985));
  for (const x of [-0.5, 0.5]) for (const y of [1.05, 1.65]) P.add('steel', box(0.07, 0.1, 0.05, x, y, 3.99));
  P.add('steel', box(0.14, 0.05, 0.05, -0.15, 1.35, 3.995));
  P.add('steel', box(0.14, 0.05, 0.05, 0.15, 1.35, 3.995));
  P.add('steel', rod(V(0.9, 1.75, 3.9), V(0.9, 2.15, 3.9), 0.04)); // exhaust
  exhaustStack(P, -1.0, 3.5, 1.9, 2.45);
  whip(P, 1.1, 2.0, 3.4, 2.2);
  toolRack(P, 1.385, 1.5, -0.6, 1);
  for (const s of [-1, 1]) {
    for (const dy of [-0.06, 0.06]) P.add('dark', box(0.3, 0.015, 0.015, s * 0.8, 1.5 + dy, -3.73)); // bars over the head lamps
  }
  for (const x of [-0.5, 0.5]) P.add('steel', rbox(0.14, 0.14, 0.1, 0.02, x * 1.2, 0.95, -4.0)); // tow eyes
  P.add('dark', yTube(2.0, 2.1, 1.05, 1.05, 28, 0, 0.6)); // turret ring
  P.build(root, { dirt: 0.5 });

  const tur = pivotAt(rig, root, 'turret', 0, 2.1, 0.6);
  const T = new Parts(mats);
  T.add('camo', sideProfile([[-1.35, 0.0], [-1.35, 0.55], [-1.0, 0.95], [1.1, 0.95], [1.35, 0.7], [1.35, 0.0]], 1.56, 0.05));
  for (const s of [-1, 1]) {
    T.add('dark', box(0.03, 0.5, 0.9, s * 0.8, 0.45, 0.2));
    T.add('steel', xTube(s * 0.78, s * 0.98, 0.07, 0.07, 10, 0.55, -0.1)); // elevation trunnion
  }
  T.add('dark', box(0.8, 0.03, 0.8, 0, 0.97, 0.2));
  T.add('camo', rbox(0.8, 0.24, 0.5, 0.04, -0.3, 1.05, -0.45)); // roof equipment box
  T.build(tur, { dirt: 0.3, y0: 2.1 });

  // tracking radar (9S33) on the turret front: dish with guidance antennas, pans in azimuth
  const tr = pivotAt(rig, tur, 'trackRadar', 0, 0.95, -0.95);
  const D = new Parts(mats);
  D.add('paint', yTube(0, 0.3, 0.2, 0.15, 14));
  D.add('dark', yTube(0.28, 0.34, 0.22, 0.22, 14));
  D.add('paint', rbox(0.56, 0.22, 0.4, 0.04, 0, 0.42, 0.0)); // yoke housing
  for (const s of [-1, 1]) D.add('paint', rbox(0.06, 0.5, 0.18, 0.02, s * 0.3, 0.7, 0.0)); // yoke arms
  trackingDish(D, xf(0, 0.74, -0.1, 0.12));
  D.add('steel', xTube(-0.34, 0.34, 0.03, 0.03, 8, 0.74, 0.0)); // elevation axis
  for (const s of [-1, 1]) {
    D.add('dark', rbox(0.1, 0.1, 0.18, 0.02, s * 0.62, 0.5, -0.1)); // missile-guidance horns
    D.add('steel', zTube(-0.2, -0.28, 0.04, 0.05, 8, s * 0.62, 0.5));
    D.add('white', box(0.07, 0.07, 0.01, s * 0.62, 0.5, -0.285));
    D.add('paint', rod(V(s * 0.1, 0.35, 0), V(s * 0.6, 0.5, -0.05), 0.02));
  }
  D.add('paint', rbox(0.3, 0.22, 0.3, 0.03, 0.0, 1.32, 0.0)); // TV optical sight above the dish
  lens(D, 0, 1.32, -0.15, 0.06);
  D.add('paint', rod(V(0, 1.0, 0.05), V(0, 1.22, 0), 0.025));
  D.build(tr, { dirt: 0, y0: 3.05 });

  // folding search radar on the turret rear
  const sr = pivotAt(rig, tur, 'searchRadar', 0, 0.95, 0.75);
  const S = new Parts(mats);
  S.add('paint', yTube(0, 0.4, 0.2, 0.15, 14));
  S.add('dark', yTube(0.38, 0.5, 0.26, 0.26, 18));
  S.add('paint', rbox(0.6, 0.32, 0.42, 0.04, 0, 0.66, 0.0)); // head housing
  S.add('steel', xTube(-0.3, 0.3, 0.04, 0.04, 8, 1.0, 0.1)); // elevation axis the antenna folds about
  S.add('steel', rod(V(0, 0.8, 0.1), V(0, 1.0, 0.1), 0.05, 6));
  searchAntenna(S, xf(0, 1.32, 0));
  S.build(sr, { dirt: 0, y0: 3.05 });

  // launcher: two arms with three 9M33M3 in containers each, elevating about the turret trunnions
  const el = pivotAt(rig, tur, 'elevation', 0, 0.55, -0.1);
  const L = new Parts(mats);
  const cl = [[-0.16, -0.13], [0.16, -0.13], [0.0, 0.16]];
  let k = 0;
  const slotDefs = [];
  for (const s of [-1, 1]) {
    const cx0 = s * 1.15;
    // arm bracket back to the turret
    L.add('dark', box(0.1, 0.8, 0.5, s * 1.0, 0.0, 0.1));
    L.add('dark', box(0.4, 0.1, 0.4, s * 1.0, -0.3, 0.1));
    for (const [dx, dy] of cl) {
      const cx = cx0 + dx, cy = 0.15 + dy;
      L.add('canister', rbox(0.3, 0.3, 3.3, 0.04, cx, cy, -1.1));
      L.add('dark', rbox(0.32, 0.32, 0.05, 0.03, cx, cy, 0.52));
      for (const z of [-0.2, -1.1, -2.0]) L.add('dark', rbox(0.315, 0.315, 0.06, 0.04, cx, cy, z));
      L.add('dark', box(0.18, 0.012, 0.5, cx, cy + 0.151, -0.65));
      slotDefs.push([cx, cy]);
    }
  }
  L.build(el, { dirt: 0, y0: 2.65 });
  for (const [cx, cy] of slotDefs) {
    const g = new THREE.Group();
    const M = new Parts(mats);
    M.add('steel', rbox(0.3, 0.3, 0.06, 0.04, cx, cy, -2.77));
    M.add('steel', box(0.2, 0.2, 0.02, cx, cy, -2.81));
    M.build(g);
    el.add(g);
    rig.slots.push([g]);
    rig.anchors.missileSlots.push(node(el, 'slot' + (k++), cx, cy, -2.83));
  }
  rig.anchors.eye = node(root, 'eye', 0, 2.2, 0.4);
  hb(rig, -1.45, 0.4, -4.1, 1.45, 2.1, 4.1);
  hb(rig, -1.5, 2.0, -2.4, 1.5, 4.2, 1.8);
  return rig;
}

// ---------------------------------------------------------------- Strela-10M3 (MT-LB)

// Endless track belt about the road wheels, as an extruded ring, plus cleats.
function trackRun(P, x, W) {
  const zi = -3.0, zs = 2.95, yc = 0.47, ri = 0.43, rs = 0.46, t = 0.07;
  const sh = new THREE.Shape();
  sh.moveTo(zi, yc - ri);
  sh.lineTo(zs, yc - rs);
  sh.absarc(zs, yc, rs, -Math.PI / 2, Math.PI / 2, false);
  sh.lineTo(zi, yc + ri);
  sh.absarc(zi, yc, ri, Math.PI / 2, (Math.PI * 3) / 2, false);
  const hole = new THREE.Path();
  hole.moveTo(zi, yc - ri + t);
  hole.absarc(zi, yc, ri - t, (Math.PI * 3) / 2, Math.PI / 2, true);
  hole.lineTo(zs, yc + rs - t);
  hole.absarc(zs, yc, rs - t, Math.PI / 2, -Math.PI / 2, true);
  hole.lineTo(zi, yc - ri + t);
  sh.holes.push(hole);
  const g = new THREE.ExtrudeGeometry(sh, { depth: W, bevelEnabled: false, curveSegments: 10 });
  g.translate(0, 0, -W / 2);
  g.rotateY(-Math.PI / 2);
  P.add('tyre', g.applyMatrix4(xf(x, 0, 0)));
  // cleats (grousers) on the belt: lower run, upper run and around the ends
  for (let z = zi; z < zs; z += 0.14) {
    P.add('dark', box(W + 0.02, 0.035, 0.07, x, yc - ri + 0.004 + (z - zi) / (zs - zi) * (ri - rs) * -1, z));
    P.add('dark', box(W + 0.02, 0.035, 0.07, x, yc + ri - 0.004, z));
  }
  for (let a = -Math.PI / 2; a <= Math.PI / 2; a += 0.35) {
    P.add('dark', box(W + 0.02, 0.07, 0.035, x, yc + Math.sin(a) * rs, zs + Math.cos(a) * rs, 0, 0, 0));
    P.add('dark', box(W + 0.02, 0.07, 0.035, x, yc + Math.sin(a) * ri, zi - Math.cos(a) * ri, 0, 0, 0));
  }
}

export function buildStrela() {
  const rig = newRig('green'), { P, root, mats } = rig;
  const hw = 1.15;
  for (const s of [-1, 1]) {
    const x = s * 1.3;
    trackRun(P, x, 0.36);
    for (let i = 0; i < 6; i++) { // road wheels
      const z = -2.25 + i * 0.95;
      P.add('tyre', xTube(x - 0.13, x + 0.13, 0.4, 0.4, 20, 0.47, z));
      P.add('rim', xTube(x - 0.17, x + 0.17, 0.27, 0.27, 16, 0.47, z));
      P.add('steel', xTube(x + s * 0.17, x + s * 0.2, 0.09, 0.09, 10, 0.47, z));
      for (let b = 0; b < 8; b++) { const a = (b / 8) * Math.PI * 2; P.add('dark', xTube(x + s * 0.17, x + s * 0.2, 0.018, 0.018, 5, 0.47 + Math.cos(a) * 0.18, z + Math.sin(a) * 0.18)); }
      P.add('dark', rod(V(s * hw, 0.95, z), V(x - s * 0.17, 0.47, z), 0.04)); // trailing arm
    }
    for (const z of [-1.5, 0, 1.5]) { // support rollers
      P.add('tyre', xTube(x - 0.1, x + 0.1, 0.13, 0.13, 12, 0.8, z));
      P.add('steel', xTube(x - 0.13, x + 0.13, 0.06, 0.06, 8, 0.8, z));
    }
    P.add('rim', xTube(x - 0.18, x + 0.18, 0.37, 0.37, 20, 0.47, 2.95)); // sprocket
    for (let b = 0; b < 16; b++) { const a = (b / 16) * Math.PI * 2; P.add('steel', box(0.06, 0.1, 0.07, x, 0.47 + Math.sin(a) * 0.4, 2.95 + Math.cos(a) * 0.4, 0, 0, 0)); }
    P.add('rim', xTube(x - 0.18, x + 0.18, 0.34, 0.34, 18, 0.47, -3.0)); // idler
    P.add('steel', xTube(x + s * 0.18, x + s * 0.22, 0.1, 0.1, 10, 0.47, -3.0));
    // fender and mudguard line
    P.add('camo', rbox(0.5, 0.06, 6.5, 0.02, s * 1.32, 1.13, -0.05));
    P.add('camo', rbox(0.5, 0.06, 0.6, 0.02, s * 1.32, 1.0, -3.4, 0.5));
    P.add('dark', box(0.06, 0.2, 6.5, s * 1.55, 1.04, -0.05));
    P.add('camo', rbox(0.3, 0.22, 0.8, 0.03, s * 1.35, 1.27, 1.7)); // stowage box
    P.add('camo', rbox(0.3, 0.22, 0.8, 0.03, s * 1.35, 1.27, 0.7));
    addLamp(P, s * 1.0, 1.5, -3.15, 0.26, 0.16, 0.08);
    P.add('steel', rod(V(s * 0.8, 0.95, -3.1), V(s * 0.8, 0.8, -3.3), 0.035));
  }
  // hull
  const prof = [[-3.15, 0.62], [-3.15, 1.15], [-2.5, 1.6], [-2.35, 1.8], [-2.2, 1.9], [3.0, 1.9], [3.15, 1.75], [3.15, 0.62]];
  P.add('camo', sideProfile(prof, 2.3, 0.05));
  P.add('dark', box(2.0, 0.08, 6.3, 0, 0.5, 0.0));
  // driver position left of the glacis: raised hatch with three periscopes; commander hatch right
  P.add('camo', rbox(0.9, 0.28, 0.9, 0.05, -0.6, 1.95, -2.15));
  for (const x of [-0.85, -0.6, -0.35]) P.add('glass', box(0.14, 0.09, 0.04, x, 2.0, -2.62));
  P.add('camo', rbox(0.7, 0.2, 0.7, 0.05, 0.65, 1.95, -1.85));
  P.add('steel', yTube(1.95, 2.1, 0.12, 0.12, 12, 0.65, -1.85));
  // glacis: trim vane folded flat, tow cables, hooks
  P.add('camo', rbox(1.8, 0.05, 1.0, 0.02, 0, 1.58, -2.9, -0.62));
  P.add('dark', box(1.8, 0.04, 0.05, 0, 1.2, -3.3, -0.62));
  for (const s of [-1, 1]) { // tow cables on the glacis
    P.add('steel', rod(V(s * 0.5, 1.2, -3.2), V(s * 0.8, 1.72, -2.5), 0.025));
  }
  for (let i = 0; i < 8; i++) { // spare track links clipped to the nose plate
    P.add('dark', box(0.2, 0.13, 0.035, -0.85 + i * 0.24, 0.92, -3.18));
    P.add('steel', box(0.18, 0.035, 0.03, -0.85 + i * 0.24, 0.92, -3.2));
  }
  toolRack(P, -1.155, 1.2, -0.4, -1);
  P.add('camo', yTube(1.9, 2.42, 0.22, 0.22, 14, -0.4, 2.75)); // fuel drum on the engine deck
  P.add('steel', yTube(2.42, 2.46, 0.2, 0.2, 14, -0.4, 2.75));
  for (const y of [2.05, 2.2, 2.35]) P.add('dark', yTube(y - 0.015, y + 0.015, 0.225, 0.225, 14, -0.4, 2.75));
  P.add('dark', box(0.04, 0.3, 0.25, -0.62, 2.1, 2.75));
  P.add('steel', zTube(-3.28, -3.15, 0.05, 0.05, 8, -0.7, 0.85));
  P.add('steel', zTube(-3.28, -3.15, 0.05, 0.05, 8, 0.7, 0.85));
  // engine deck, exhaust on the right, rear door, antenna
  for (let i = 0; i < 7; i++) P.add('steel', box(1.2, 0.015, 0.05, 0.4, 1.93, 1.8 + i * 0.12));
  P.add('dark', box(1.2, 0.02, 0.95, 0.4, 1.92, 2.15));
  exhaustStack(P, 1.0, 2.9, 1.8, 2.45);
  P.add('dark', box(1.5, 1.0, 0.04, 0, 1.2, 3.16));
  P.add('steel', box(0.1, 0.06, 0.05, 0.5, 1.2, 3.2));
  whip(P, -0.9, 1.9, 2.4, 2.4);
  for (let i = 0; i < 5; i++) P.add('steel', box(0.05, 0.12, 0.06, -0.9, 1.92, -0.9 + i * 0.01 - 0.0)); // lifting eyes
  P.add('dark', yTube(1.9, 2.0, 0.95, 0.95, 28, 0, 0.1)); // turret ring
  P.build(root, { dirt: 0.5 });

  const tur = pivotAt(rig, root, 'turret', 0, 2.0, 0.1);
  const T = new Parts(mats);
  T.add('camo', sideProfile([[-0.95, 0], [-0.95, 0.45], [-0.65, 0.78], [0.85, 0.78], [1.0, 0.6], [1.0, 0]], 1.75, 0.05));
  for (const s of [-1, 1]) {
    T.add('dark', box(0.03, 0.5, 0.7, s * 0.885, 0.35, 0.3));
    T.add('steel', xTube(s * 0.88, s * 1.0, 0.07, 0.07, 10, 0.78, -0.35));
  }
  T.add('dark', box(0.7, 0.03, 0.6, 0.3, 0.8, 0.5));
  T.add('camo', rbox(0.5, 0.14, 0.5, 0.03, -0.45, 0.85, 0.45)); // turret roof box
  // infrared searchlight on the left of the roof: housing, reflector and a dark filter
  T.add('dark', rbox(0.3, 0.3, 0.34, 0.04, -0.7, 0.93, -0.5));
  T.add('steel', zTube(-0.66, -0.7, 0.13, 0.13, 14, -0.7, 0.93));
  T.add('glass', zTube(-0.7, -0.705, 0.11, 0.11, 14, -0.7, 0.93));
  T.add('dark', rod(V(-0.7, 0.8, -0.3), V(-0.7, 0.78, -0.1), 0.03, 6));
  whip(T, 0.55, 0.8, 0.75, 1.4);
  T.build(tur, { dirt: 0.3, y0: 2.0 });
  const el = pivotAt(rig, tur, 'elevation', 0, 0.78, -0.35);
  const E = new Parts(mats);
  // sight head (centre) with the operator's optical sight window and an armoured shutter
  E.add('camo', rbox(0.62, 0.46, 0.8, 0.06, 0, 0.17, -0.38));
  E.add('dark', rbox(0.5, 0.3, 0.05, 0.03, 0, 0.24, -0.8));
  E.add('glass', box(0.4, 0.2, 0.02, 0, 0.26, -0.83));
  E.add('camo', rbox(0.5, 0.05, 0.16, 0.02, 0, 0.44, -0.84, -0.9));
  E.add('paint', rbox(0.18, 0.14, 0.2, 0.03, -0.18, 0.5, -0.4)); // IR sight / seeker head
  lens(E, -0.18, 0.5, -0.5, 0.05);
  E.add('dark', box(0.6, 0.05, 0.95, 0, -0.1, -0.2));
  let k = 0;
  const defs = [];
  for (const s of [-1, 1]) for (const dy of [0.17, -0.12]) {
    const cx = s * 0.6, cy = dy;
    E.add('canister', rbox(0.27, 0.27, 2.35, 0.04, cx, cy, -0.7));
    E.add('dark', rbox(0.285, 0.285, 0.05, 0.03, cx, cy, 0.5));
    for (const z of [-0.3, -1.0, -1.7]) E.add('dark', rbox(0.285, 0.285, 0.06, 0.04, cx, cy, z));
    defs.push([cx, cy]);
  }
  E.add('dark', box(0.1, 0.5, 0.5, 0.35, 0.0, 0.2));
  E.add('dark', box(0.1, 0.5, 0.5, -0.35, 0.0, 0.2));
  E.build(el, { dirt: 0, y0: 2.8 });
  for (const [cx, cy] of defs) {
    const g = new THREE.Group();
    const M = new Parts(mats);
    M.add('steel', rbox(0.27, 0.27, 0.05, 0.04, cx, cy, -1.9));
    M.add('steel', box(0.16, 0.16, 0.02, cx, cy, -1.93));
    M.build(g);
    el.add(g);
    rig.slots.push([g]);
    rig.anchors.missileSlots.push(node(el, 'slot' + (k++), cx, cy, -1.96));
  }
  rig.anchors.sight = node(el, 'sight', 0, 0.26, -0.86);
  rig.anchors.eye = node(root, 'eye', 0, 1.8, 0.2);
  hb(rig, -1.5, 0, -3.5, 1.5, 1.95, 3.2);
  hb(rig, -1.0, 1.9, -1.5, 1.0, 3.0, 1.2);
  return rig;
}
