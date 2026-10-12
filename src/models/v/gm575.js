import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { V, box, yTube, zTube, xTube, rod, sideProfile, frontProfile, lathe, loft, xf } from '../kit.js';

// GM-575 tracked chassis of the ZSU-23-4 (PT-76 running gear) in its Shilka-M4 build: the slab-sided
// hull as wide as the tracks, the broad glacis with the driver's hatch at the front left, the engine
// deck at the rear, and the running gear (front idler, six road wheels with a wider gap behind the
// first, rear drive sprocket, no return rollers, 0.382 m track of 93 links). The M4 adds the black
// rubber skirt along the lower hull edge, the flat sensor boxes on the front corners, the driver's
// TV window and a handrail round the rear deck. Measured off refs/shilka (m4_02, m4_04, m4_05 and the
// V1 side views v1_07, v1_10) with the road wheel spacing as the ruler, scaled to the 6.535 m hull.
// Model space: front -Z, right +X, ground y = 0.

export const GM = {
  W: 1.37, // half width of the upper hull (2.74); the tracks run out to 1.47 under the fender ledges
  W0: 1.41, W1: 1.35, // the upper hull side leans in a little, from W0 at the ledge to W1 at the deck edge (m4_04)
  FX: 1.5, // outer edge of the fender ledges along the hull sides, where the M4's skirt hangs (3.0 over them)
  deck: 1.56, // hull roof (engine deck, turret ring face)
  fender: 1.0, // underside of the upper hull where it overhangs the tracks, top of the fender plates
  belly: 0.42,
  front: -3.25, // fender tips
  rear: 3.25,
  inner: 1.06, // half width of the lower hull between the tracks
  gauge: 1.28, // track centre line (outer edges 2.94 apart, m4_04, m4_05)
  trackW: 0.382,
  wheels: [-2.02, -1.12, -0.36, 0.4, 1.16, 1.92], // road wheel centres, front to rear
  wheelR: 0.355,
  wheelY: 0.4,
  idler: [-2.67, 0.7, 0.245], // front idler z, y, radius at the track's inner face
  sprocket: [2.74, 0.7, 0.27], // rear drive sprocket
  glacis: [[-3.22, 0.95], [-2.35, 1.56]], // the glacis plate's lower edge (the prow) and upper edge (z, y)
  prowW: 1.04, // half width of the glacis at the prow; it widens to the full hull at the deck (chamfered corners, m4_04)
  ring: -0.1, // turret ring centre (z)
};

// rounded box with one segment per edge (about 100 triangles against kit rbox's 300)
export const rb = (w, h, d, r, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) =>
  new RoundedBoxGeometry(w, h, d, 1, Math.min(r, w / 2 - 1e-3, h / 2 - 1e-3, d / 2 - 1e-3)).applyMatrix4(xf(x, y, z, rx, ry, rz));

const nonIdx = (gs) => mergeGeometries(gs.map((g) => { const n = g.index ? g.toNonIndexed() : g; if (n.attributes.uv) n.deleteAttribute('uv'); return n; }));
const latheX = (pts, seg) => lathe(pts, seg).rotateZ(-Math.PI / 2); // profile [r, x], axis along +X
// height of the glacis plane at z (front of the hull)
export const glacisY = (z) => { const [[z0, y0], [z1, y1]] = GM.glacis; return y0 + ((z - z0) / (z1 - z0)) * (y1 - y0); };
const GLA = Math.atan2(GM.glacis[1][1] - GM.glacis[0][1], GM.glacis[1][0] - GM.glacis[0][0]); // glacis slope

// ---------------------------------------------------------------- track

// Closed path of the track's inner face in (z, y), counterclockwise seen from the right: round the
// front of the idler, under the road wheels, round the sprocket and back along a top run that sags
// onto the wheel tops.
function trackPath() {
  const { wheels, wheelR: R, wheelY: Y } = GM;
  const [fz, fy, fr] = GM.idler, [bz, by, br] = GM.sprocket;
  const wF = wheels[0], wR = wheels[wheels.length - 1];
  const tan = (z1, y1, r1, z2, y2, r2) => {
    const dz = z2 - z1, dy = y2 - y1, L = Math.hypot(dz, dy);
    return Math.atan2(dy, dz) - Math.acos((r1 - r2) / L);
  };
  const pts = [];
  const arc = (cz, cy, r, a0, a1) => {
    while (a1 < a0) a1 += Math.PI * 2;
    const n = Math.max(2, Math.ceil((a1 - a0) / 0.08));
    for (let i = 0; i <= n; i++) { const a = a0 + (a1 - a0) * (i / n); pts.push([cz + Math.cos(a) * r, cy + Math.sin(a) * r]); }
  };
  const aTop = tan(wF, Y, R, fz, fy, fr);
  const aFB = tan(fz, fy, fr, wF, Y, R);
  const aWB = tan(wR, Y, R, bz, by, br);
  const aBT = tan(bz, by, br, wR, Y, R);
  arc(fz, fy, fr, aTop, aFB);
  arc(wF, Y, R, aFB, -Math.PI / 2);
  arc(wR, Y, R, -Math.PI / 2, aWB);
  arc(bz, by, br, aWB, aBT);
  let top = [[bz + Math.cos(aBT) * br, by + Math.sin(aBT) * br]];
  top.push([wR + Math.cos(aBT) * R, Y + Math.sin(aBT) * R]);
  for (let k = wheels.length - 1; k >= 0; k--) {
    top.push([wheels[k], Y + R]);
    if (k > 0) top.push([(wheels[k] + wheels[k - 1]) / 2, Y + R - (k === 1 ? 0.03 : 0.02)]);
  }
  top.push([wF + Math.cos(aTop) * R, Y + Math.sin(aTop) * R]);
  top.push([fz + Math.cos(aTop) * fr, fy + Math.sin(aTop) * fr]);
  for (let it = 0; it < 3; it++) { // Chaikin rounding, keeping the end points on the tangents
    const o = [top[0]];
    for (let i = 0; i < top.length - 1; i++) {
      const [a, b] = [top[i], top[i + 1]];
      if (i > 0) o.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25]);
      if (i < top.length - 2) o.push([a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
    }
    o.push(top[top.length - 1]);
    top = o;
  }
  pts.push(...top.slice(1, -1));
  return pts;
}

// One cast link of the PT-76 type track: a shoe with two windows (side bars, a middle bar and the end
// bars as the grousers), the hinge lugs, and the guide horn standing up from the inner face in the
// middle (it runs in the groove of the twin road wheels). Local: x across, y outward, z along.
function linkGeometry(w, p) {
  const g = [];
  g.push(box(w, 0.022, p * 0.9, 0, 0.016, 0)); // shoe
  g.push(box(w - 0.02, 0.03, 0.04, 0, 0.035, p * 0.2)); // grouser across the ground side
  g.push(box(0.11, 0.028, p * 0.8, 0, 0.03, -0.01)); // the middle rib with the hinge knuckles
  g.push(box(0.045, 0.075, 0.06, 0, -0.035, -0.005)); // guide horn
  return nonIdx(g);
}

export function addTracks(P, N = 93) {
  const pts = trackPath();
  const n = pts.length, cum = [0];
  for (let i = 1; i <= n; i++) { const a = pts[i - 1], b = pts[i % n]; cum.push(cum[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1])); }
  const L = cum[n], step = L / N;
  const link = linkGeometry(GM.trackW, step);
  const m = new THREE.Matrix4(), X = V(1, 0, 0), Nv = V(0, 0, 0), T = V(0, 0, 0);
  let j = 0;
  for (let k = 0; k < N; k++) {
    const s = k * step;
    while (cum[j + 1] < s) j++;
    const a = pts[j], b = pts[(j + 1) % n], f = (s - cum[j]) / (cum[j + 1] - cum[j]);
    const z = a[0] + (b[0] - a[0]) * f, y = a[1] + (b[1] - a[1]) * f;
    const tl = Math.hypot(b[0] - a[0], b[1] - a[1]), tz = (b[0] - a[0]) / tl, ty = (b[1] - a[1]) / tl;
    Nv.set(0, -tz, ty); // outward: the travel direction turned to the right
    T.set(0, -ty, -tz);
    m.makeBasis(X, Nv, T);
    for (const sx of [-1, 1]) {
      m.setPosition(sx * GM.gauge, y, z);
      P.add('dark', link.clone().applyMatrix4(m));
    }
  }
  return step;
}

// ---------------------------------------------------------------- wheels

// Twin road wheel about +X (outer face +X): two rubber tyres with the horn groove between them, a
// pressed disc with a rolled lip and fourteen radial ribs, a domed hub with its bolt ring.
function roadWheel(R) {
  const t = [];
  for (const c of [-0.075, 0.075]) t.push(latheX([[R - 0.06, c - 0.065], [R - 0.012, c - 0.065], [R, c - 0.05], [R, c + 0.05], [R - 0.012, c + 0.065], [R - 0.06, c + 0.065]], 20));
  const d = [latheX([[R - 0.055, 0.14], [R - 0.08, 0.155], [0.17, 0.125], [0.12, 0.135], [0.08, 0.19], [0.0, 0.208]], 20)];
  d.push(latheX([[0, -0.14], [R - 0.055, -0.14]], 14));
  d.push(latheX([[R - 0.062, -0.02], [R - 0.062, 0.02]], 14)); // the groove's floor
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    d.push(box(0.024, 0.14, 0.03, 0.136, 0, 0).applyMatrix4(xf(0, Math.cos(a) * 0.2, Math.sin(a) * 0.2, a, 0, 0)));
  }
  for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; d.push(xTube(0.15, 0.175, 0.013, 0.013, 5, Math.cos(a) * 0.112, Math.sin(a) * 0.112)); }
  return { tyre: nonIdx(t), disc: nonIdx(d) };
}

// Toothed sprocket ring, extruded along X
function sprocketRing(rRoot, rTip, t, teeth = 14) {
  const s = new THREE.Shape();
  const pts = [];
  for (let i = 0; i < teeth; i++) {
    const a = (i / teeth) * Math.PI * 2, w = Math.PI / teeth;
    for (const [r, b] of [[rRoot, a - w * 0.6], [rTip, a - w * 0.25], [rTip, a + w * 0.25], [rRoot, a + w * 0.6]]) pts.push(new THREE.Vector2(Math.cos(b) * r, Math.sin(b) * r));
  }
  s.setFromPoints(pts);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.3, h = new THREE.Path();
    h.absarc(Math.cos(a) * 0.15, Math.sin(a) * 0.15, 0.04, 0, Math.PI * 2, true);
    s.holes.push(h);
  }
  const g = new THREE.ExtrudeGeometry(s, { depth: t, bevelEnabled: false, curveSegments: 3 });
  g.translate(0, 0, -t / 2);
  return g.rotateY(Math.PI / 2);
}

function idlerDisc(r, t) {
  const s = new THREE.Shape();
  s.absarc(0, 0, r, 0, Math.PI * 2, false);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2, h = new THREE.Path();
    h.absarc(Math.cos(a) * r * 0.58, Math.sin(a) * r * 0.58, r * 0.19, 0, Math.PI * 2, true);
    s.holes.push(h);
  }
  const g = new THREE.ExtrudeGeometry(s, { depth: t, bevelEnabled: false, curveSegments: 5 });
  g.translate(0, 0, -t / 2);
  return g.rotateY(Math.PI / 2);
}

export function addRunningGear(P) {
  const { wheels, wheelR: R, wheelY: Y, gauge: G } = GM;
  const [bz, by] = GM.sprocket, [fz, fy, fr] = GM.idler;
  const rw = roadWheel(R);
  const spr = sprocketRing(0.24, 0.31, 0.05), idl = idlerDisc(fr - 0.01, 0.04);
  for (const s of [-1, 1]) {
    const flip = s < 0 ? Math.PI : 0; // left side wheels face -X
    for (const z of wheels) {
      const m = xf(s * G, Y, z, 0, flip, 0);
      P.add('rubber', rw.tyre.clone().applyMatrix4(m));
      P.add('rim', rw.disc.clone().applyMatrix4(m));
      // trailing arm forward of the hub to the torsion bar in the hull
      P.add('dark', rod(V(s * GM.inner, 0.62, z - 0.34), V(s * (G - 0.16), Y, z), 0.05, 6));
      P.add('dark', xTube(s * (GM.inner - 0.05), s * (GM.inner + 0.06), 0.085, 0.085, 10, 0.62, z - 0.34));
    }
    // rear drive sprocket: two toothed rings either side of the hub, final drive housing
    for (const dx of [-0.11, 0.11]) P.add('rim', spr.clone().applyMatrix4(xf(s * G + dx, by, bz, 0.1 * s)));
    P.add('rim', xTube(s * (G - 0.14), s * (G + 0.14), 0.19, 0.19, 18, by, bz));
    P.add('rim', xTube(s * (G + 0.14), s * (G + 0.19), 0.11, 0.08, 14, by, bz));
    for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; P.add('steel', xTube(s * (G + 0.14), s * (G + 0.165), 0.013, 0.013, 6, by + Math.cos(a) * 0.145, bz + Math.sin(a) * 0.145)); }
    P.add('dark', xTube(s * GM.inner, s * (G - 0.14), 0.14, 0.14, 12, by, bz));
    // front idler: twin spoked discs on a crank arm
    for (const dx of [-0.08, 0.08]) P.add('rim', idl.clone().applyMatrix4(xf(s * G + dx, fy, fz)));
    P.add('rim', xTube(s * (G - 0.06), s * (G + 0.06), fr - 0.005, fr - 0.005, 22, fy, fz, true));
    P.add('rim', xTube(s * (G + 0.08), s * (G + 0.14), 0.08, 0.06, 12, fy, fz));
    P.add('dark', rod(V(s * GM.inner, 0.78, fz + 0.3), V(s * (G - 0.08), fy, fz), 0.055, 6));
  }
  return addTracks(P);
}

// ---------------------------------------------------------------- hull

// Rounded-corner access panel standing proud of a hull side (normal +X when side = 1), hinges on its
// rear edge and a handle.
// x of the leaning upper hull side at height y, and its lean (radians, top inward)
export const sideX = (y) => GM.W0 - ((y - GM.fender) / (GM.deck - GM.fender)) * (GM.W0 - GM.W1);
const LEAN = Math.atan2(GM.W0 - GM.W1, GM.deck - GM.fender);

// Round-cornered access hatch standing proud of a hull side (side = 1 for +X), leaning with it,
// hinges on its rear edge and a handle.
function sidePanel(P, side, z, y, w, h, hinge = true) {
  const x = side * (sideX(y) + 0.012), r = side * LEAN;
  P.add('camo', rb(0.025, h, w, 0.07, x, y, z, 0, 0, r), { tint: 0xd8d8d8 });
  P.add('camo', rb(0.02, h - 0.05, w - 0.05, 0.05, x + side * 0.01, y, z, 0, 0, r), { tint: 0xc4c4c4 });
  if (hinge) for (const dy of [-h * 0.3, h * 0.3]) P.add('camo', box(0.035, 0.06, 0.08, x + side * 0.01, y + dy, z + w / 2 + 0.015, 0, 0, r), { tint: 0xb8b8b8 });
  P.add('camo', box(0.03, 0.03, 0.1, x + side * 0.03, y, z - w / 2 + 0.08, 0, 0, r), { tint: 0xb8b8b8 });
}

// Louvred grille set into a deck (top surface at y), slats across x.
function deckGrille(P, x, z, w, d, y, n) {
  P.add('dark', box(w, 0.02, d, x, y - 0.005, z));
  for (let i = 0; i < n; i++) P.add('camo', box(w - 0.06, 0.02, 0.025, x, y + 0.005, z - d / 2 + (d * (i + 0.5)) / n, 0.5), { tint: 0xb8b8b8 });
  P.add('camo', rb(w + 0.06, 0.04, d + 0.06, 0.015, x, y + 0.01, z), { tint: 0xc8c8c8 });
}

// `skirt`: an optional second parts collector for the black rubber (the caller builds it clear of the
// mud line so it stays black, as on the exhibition vehicles)
export function addHull(P, { m4 = true, skirt = null } = {}) {
  const { W, deck: D, fender: F, belly: B, inner: I } = GM;
  const [[gz0, gy0], [gz1]] = GM.glacis;
  const ZR = 3.0; // rear edge of the deck
  // upper hull over the full width: deck, the upper rear plate leaning back down to the shelf; ahead of
  // the deck the glacis narrows to the prow between big chamfers down the front corners (m4_04), so
  // the nose comes to a point over the fenders
  const { W0, W1 } = GM;
  P.add('camo', sideProfile([[gz1, F], [gz1, D], [ZR, D], [ZR + 0.05, D - 0.03], [3.17, F + 0.02], [3.17, F]], W1 * 2));
  for (const s of [-1, 1]) P.add('camo', frontProfile(s > 0 ? [[W1, F], [W0, F], [W1, D]] : [[-W1, F], [-W1, D], [-W0, F]], gz1, 3.15)); // the leaning sides
  const pw = GM.prowW;
  P.add('camo', loft([[V(-W0, F, gz1), V(W0, F, gz1), V(W1, D, gz1), V(-W1, D, gz1)], [V(-pw, gy0 - 0.01, gz0), V(pw, gy0 - 0.01, gz0), V(pw, gy0 + 0.01, gz0), V(-pw, gy0 + 0.01, gz0)]], { crease: 0.5 }));
  // lower hull between the tracks: the glacis carried on down to the nose, the lower nose plate with the
  // tow eyes, the belly and the lower rear plate
  P.add('camo', sideProfile([[gz0, gy0], [gz1, F], [3.12, F + 0.05], [3.14, 0.92], [2.9, B], [-2.82, B]], I * 2));
  // the side between the tracks sits in the hull's shadow: a darker skin keeps it dark in any light
  for (const s of [-1, 1]) P.add('camo', box(0.01, F - B - 0.05, 5.6, s * (I + 0.005), (F + B) / 2, 0.15), { tint: 0x484848 });
  P.add('dark', box(I * 2 - 0.1, 0.03, 5.5, 0, B - 0.01, 0.1)); // belly
  // the fender ledges along the sides over the tracks, from the hull side out past the track (m4_04)
  for (const s of [-1, 1]) {
    P.add('camo', box(GM.FX - W0 + 0.01, 0.03, 5.85, s * (W0 + GM.FX) / 2, F + 0.005, 0.1), { tint: 0xc8c8c8 });
    P.add('camo', box(0.04, 0.06, 5.85, s * (GM.FX - 0.02), F + 0.01, 0.1), { tint: 0xb0b0b0 }); // turned-down edge
  }

  // ---- fenders over the tracks, wedge-nosed at the front with a rubber edge, flaps at the rear
  for (const s of [-1, 1]) {
    // rear: a box over the sprocket under the shelf, X-pressed on its back (rear_11), a rubber flap
    const bx = s * (GM.FX - 0.24), bw = 0.46;
    P.add('camo', box(bw, 0.36, 0.34, bx, F - 0.2, 3.12));
    P.add('camo', rb(bw - 0.04, 0.3, 0.02, 0.01, bx, F - 0.2, 3.29), { tint: 0xd0d0d0 });
    for (const r of [0.6, -0.6]) P.add('dark', box(Math.hypot(bw, 0.3) - 0.12, 0.012, 0.012, bx, F - 0.2, 3.302, 0, 0, r));
    if (m4) P.add('rubber', box(bw, 0.3, 0.02, bx, F - 0.52, 3.27));
  }

  // ---- front: glacis fittings
  const onG = (z, dy = 0) => glacisY(z) + dy;
  const gn = V(0, Math.cos(GLA), -Math.sin(GLA)); // glacis outward normal
  const gPlate = (key, w, l, x, z, lift, o) => P.add(key, box(w, 0.03, l, x, onG(z) + lift * gn.y, z + lift * gn.z, -GLA), o);
  // driver's hatch at the front left with its raised armoured lid (as in m4_04), a TV window right of it
  {
    const x = -0.5, z = -2.6;
    gPlate('camo', 0.76, 0.66, x, z, 0.02, { tint: 0xd0d0d0 });
    gPlate('dark', 0.6, 0.5, x, z, 0.035);
    // the hatch lid swung up on its hinge at the top of the opening, held out level like a visor
    P.add('camo', rb(0.64, 0.045, 0.5, 0.02, x, D + 0.02, -2.6, 0.15), { tint: 0xc8c8c8 });
    P.add('dark', xTube(x - 0.3, x + 0.3, 0.03, 0.03, 8, onG(-2.36) + 0.02, -2.36));
    for (const e of [-1, 1]) P.add('dark', rod(V(x + e * 0.29, onG(-2.7) + 0.02, -2.7), V(x + e * 0.29, D + 0.02, -2.78), 0.012, 5));
    // TV camera window (M4) on the glacis left of the hatch
    if (m4) {
      P.add('dark', rb(0.2, 0.11, 0.08, 0.04, -0.98, onG(-2.7) + 0.07, -2.72));
      P.add('glass', box(0.15, 0.07, 0.01, -0.98, onG(-2.7) + 0.07, -2.765));
    }
  }
  // raised box on the right of the glacis (stepped hood), the stowed rod, the tow cable across
  {
    const x = 0.52;
    P.add('camo', sideProfile([[-2.94, onG(-2.94)], [-2.94, D - 0.24], [-2.55, D - 0.04], [-2.45, onG(-2.45)]], 0.44).applyMatrix4(xf(x, 0, 0)));
    P.add('camo', rb(0.36, 0.03, 0.3, 0.01, x, D - 0.13, -2.75, -0.39), { tint: 0xc0c0c0 });
    P.add('dark', box(0.3, 0.02, 0.01, x, D - 0.34, -2.945));
    P.add('dark', rod(V(0.25, onG(-3.0) + 0.05, -3.0), V(0.05, onG(-2.45) + 0.05, -2.45), 0.025, 6));
    P.add('steel', rod(V(0.42, onG(-2.95) + 0.05, -2.95), V(0.95, onG(-2.4) + 0.05, -2.4), 0.022, 6));
    // the tow cable lies across the glacis just above the prow, from a shackle on the right to the left
    const c = new THREE.CatmullRomCurve3([V(-1.0, gy0 + 0.04, gz0 + 0.06), V(-0.6, onG(-3.13) + 0.03, -3.13), V(0, onG(-3.16) + 0.025, -3.16), V(0.6, onG(-3.12) + 0.03, -3.12), V(1.0, gy0 + 0.06, gz0 + 0.08)]);
    P.add('steel', new THREE.TubeGeometry(c, 24, 0.016, 5, false), { tint: 0x9a9a9a });
    for (const s of [-1, 1]) P.add('dark', new THREE.TorusGeometry(0.06, 0.018, 6, 12).applyMatrix4(xf(s * 1.02, gy0 + 0.05, gz0 + 0.07, 0, 0.3 * s, 0))); // shackles
  }
  // lower nose plate: three tow eyes and two hooks, the hanging mud flaps (light grey rubber on the M4)
  {
    const lz = (y) => gz0 + ((gy0 - y) / (gy0 - B)) * (-2.82 - gz0); // the lower nose plate's z at height y
    for (const x of [-0.66, 0, 0.66]) P.add('dark', new THREE.TorusGeometry(0.06, 0.016, 6, 12).applyMatrix4(xf(x, 0.66, lz(0.66) - 0.05, 0.5)));
    for (const s of [-1, 1]) {
      P.add('dark', rod(V(s * 0.95, 0.55, lz(0.55)), V(s * 0.95, 0.5, lz(0.55) - 0.14), 0.035, 6));
      P.add('dark', box(0.07, 0.12, 0.06, s * 0.95, 0.47, lz(0.55) - 0.14));
    }
    // three grey rubber mud flaps hung under the nose, down to a hand's width off the ground (m4_01,
    // m4_04), each a little dished, on a bar behind the nose plate's lower edge
    if (m4) for (const x of [-0.6, 0, 0.6]) {
      P.add('white', rb(0.55, 0.36, 0.012, 0.006, x, B - 0.15, lz(B) + 0.02, 0.08), { tint: 0x8a8880 });
      P.add('white', box(0.5, 0.012, 0.02, x, B - 0.31, lz(B) + 0.035), { tint: 0x5a5852 });
    }
    if (m4) P.add('dark', box(1.85, 0.04, 0.05, 0, B + 0.01, lz(B) + 0.03));
  }
  // M4 front corner boxes: a deep housing on each front corner, its top flush with the deck and its
  // face hanging down over the chamfer to about 1.3 m (m4_04, m4_05: the dark boxes either side of the
  // driver's hatch), the headlight and the laser warning receivers' lenses in the face, a flat visor
  // reaching forward over them, louvres along the outer side, a light grey sensor box on the chamfer
  for (const s of [-1, 1]) {
    const x = s * 1.07, z0 = -2.55, z1 = -2.05, y0 = 1.3, zc = (z0 + z1) / 2, yc = (y0 + D) / 2;
    P.add('camo', rb(0.56, D - y0, z1 - z0, 0.03, x, yc, zc), { tint: 0xc8c8c8 });
    P.add('camo', rb(0.6, 0.04, 0.32, 0.015, x, D + 0.01, z0 + 0.06), { tint: 0xd8d8d8 }); // visor
    P.add('dark', box(0.5, 0.17, 0.01, x, yc - 0.01, z0 - 0.004));
    for (const dx of [-0.16, 0.12]) {
      P.add('dark', zTube(z0 + 0.01, z0 - 0.05, 0.045, 0.04, 12, x + s * dx, yc + 0.02));
      P.add('glass', zTube(z0 - 0.05, z0 - 0.055, 0.034, 0.034, 12, x + s * dx, yc + 0.02));
    }
    P.add('dark', zTube(z0 + 0.01, z0 - 0.07, 0.065, 0.072, 14, x - s * 0.02, yc - 0.02));
    P.add('amber', zTube(z0 - 0.07, z0 - 0.075, 0.06, 0.06, 14, x - s * 0.02, yc - 0.02));
    if (m4) for (let i = 0; i < 6; i++) P.add('dark', box(0.01, 0.03, 0.05, s * 1.355, D - 0.06, z0 + 0.1 + i * 0.065)); // louvres
    // the sensor box low on the chamfer, a grab handle
    const cz = -2.85, cy = 1.12, cx = s * (pw + (W - pw) * ((cz - gz0) / (gz1 - gz0)) - 0.04);
    P.add('white', rb(0.12, 0.16, 0.14, 0.015, cx, cy, cz, 0, s * 0.45, 0), { tint: 0xb8b8b4 });
    P.add('dark', rod(V(s * 0.95, gy0 + 0.1, gz0 + 0.12), V(s * 1.05, 1.15, -2.95), 0.014, 5));
  }
  // fenders over the track fronts: a flat plate from the chamfer out over the track and a curved
  // mudguard sheet round the front of the track (m4_04)
  for (const s of [-1, 1]) {
    const x = s * 1.255;
    P.add('camo', box(0.5, 0.03, 0.75, x, F - 0.015, -2.85), { tint: 0xc8c8c8 });
    // the mudguard: a pointed wedge in side view (m4_02), curving down round the front of the track
    (skirt || P).add('rubber', sideProfile([[-3.2, F + 0.01], [-3.36, F - 0.06], [-3.33, F - 0.17], [-3.18, F - 0.3], [-3.0, F - 0.36], [-3.0, F - 0.3], [-3.15, F - 0.24], [-3.27, F - 0.14], [-3.29, F - 0.07], [-3.2, F - 0.02]], 0.5).applyMatrix4(xf(x, 0, 0)), { tint: 0xffffff });
  }

  // ---- sides: access panels, grab handles, hanging hooks
  for (const s of [-1, 1]) {
    const yc = (F + D) / 2 + 0.05;
    if (s < 0) { // left (m4_02): three panels
      sidePanel(P, s, -1.66, yc, 0.36, 0.34);
      sidePanel(P, s, -0.72, yc + 0.02, 0.36, 0.34);
      sidePanel(P, s, 0.62, yc + 0.06, 0.36, 0.36);
      P.add('dark', rod(V(s * (sideX(yc) + 0.03), yc - 0.05, 1.3), V(s * (sideX(yc) + 0.03), yc - 0.05, 2.0), 0.014, 5));
    } else { // right (v1_10): a big panel forward, the long one aft with a square hatch
      sidePanel(P, s, -1.35, yc, 1.1, 0.48);
      P.add('camo', rb(0.03, 0.26, 0.24, 0.02, s * (sideX(yc) + 0.02), yc - 0.02, -1.75, 0, 0, s * LEAN), { tint: 0xc0c0c0 });
      sidePanel(P, s, 1.3, yc, 0.95, 0.48);
      P.add('camo', rb(0.03, 0.24, 0.3, 0.02, s * (sideX(yc) + 0.02), yc, 1.15, 0, 0, s * LEAN), { tint: 0xc0c0c0 });
      P.add('camo', xTube(s * (sideX(yc) - 0.01), s * (sideX(yc) + 0.03), 0.09, 0.09, 14, yc + 0.05, -0.35));
    }
    for (const z of [-2.1, -0.2, 2.35]) P.add('camo', box(0.04, 0.04, 0.12, s * (sideX(D - 0.08) + 0.02), D - 0.08, z), { tint: 0xb8b8b8 });
  }

  // ---- M4 rubber skirt along the lower hull edge: panels hung from the sponson lip on hangers
  if (m4) {
    // panels of black rubber hung from the fender ledge, about 0.33 m deep, over the tops of the road
    // wheels (m4_02): joined at the hangers, where the lower edge is high, each panel's edge dips to its
    // lowest a little ahead of its middle; at the front the skirt runs forward into the mudguard's wedge
    const y0 = F + 0.02, y1 = 0.66, yn = 0.81, z0 = -3.3, z1 = 3.05;
    const hangers = [-2.12, -0.57, 0.64, 1.85];
    const joints = [-2.9, ...hangers, z1];
    const bottom = [[z1, yn]];
    for (let k = joints.length - 1; k > 0; k--) {
      const za = joints[k - 1], zb = joints[k];
      bottom.push([za + 0.4 * (zb - za), y1], [za, yn]);
    }
    bottom.push([z0 + 0.04, F - 0.12]);
    for (const s of [-1, 1]) {
      const x = s * (GM.FX + 0.01); // hung from the ledge's edge
      (skirt || P).add('rubber', sideProfile([[z0, F - 0.08], [z0 + 0.2, y0], [z1, y0], ...bottom], 0.025).applyMatrix4(xf(x, 0, 0)), { tint: 0xffffff });
      P.add('camo', box(0.035, 0.06, z1 - z0, x, y0 + 0.01, (z0 + z1) / 2), { tint: 0xb0b0b0 }); // clamping strip
      for (const z of [z0 + 0.3, ...hangers, z1 - 0.1]) P.add('dark', box(0.05, 0.06, 0.06, s * (GM.FX - 0.01), y0 - 0.01, z)); // hanger brackets
      for (const z of hangers) {
        P.add('steel', rb(0.025, 0.06, 0.12, 0.012, x + s * 0.014, yn + 0.05, z), { tint: 0xb0b0a8 }); // the clamp at the foot of each joint
        P.add('dark', box(0.01, y0 - yn, 0.012, x + s * 0.013, (y0 + yn) / 2, z)); // the seam
      }
    }
  }

  // ---- deck: engine compartment grilles, the air intake strip along the right edge, hatches
  deckGrille(P, 0, 2.3, 1.6, 0.85, D, 12);
  deckGrille(P, 1.28, 2.1, 0.32, 1.1, D, 10);
  P.add('camo', rb(0.8, 0.04, 0.36, 0.02, -0.6, D + 0.015, 2.85), { tint: 0xc8c8c8 });
  P.add('camo', rb(0.8, 0.04, 0.36, 0.02, 0.6, D + 0.015, 2.85), { tint: 0xc8c8c8 });
  for (const x of [-0.6, 0.6]) P.add('dark', box(0.3, 0.03, 0.03, x, D + 0.04, 2.74));
  P.add('dark', box(2.6, 0.015, 0.02, 0, D + 0.005, 1.82)); // the deck seam behind the turret
  // turret ring housing on the deck
  P.add('dark', yTube(D - 0.01, D + 0.04, 1.02, 1.0, 36, 0, GM.ring));

  // ---- rear (rear_11): the leaning upper plate with the wide engine access cover and two small ones,
  // the deep shelf across the back with its turned-down lip, the lower plate with two round-cornered
  // covers, tow hooks, lamps under the shelf corners
  const ra = Math.atan2(0.17, D - F - 0.05), rz = (y) => ZR + 0.05 + ((D - 0.03 - y) / (D - F - 0.05)) * 0.12; // the plate's z at height y
  P.add('camo', rb(1.7, 0.36, 0.04, 0.03, 0, D - 0.28, rz(D - 0.28) + 0.01, -ra), { tint: 0xd4d4d4 });
  P.add('dark', box(1.5, 0.03, 0.04, 0, D - 0.08, rz(D - 0.08) + 0.025, -ra)); // its hinge
  for (const s of [-1, 1]) {
    P.add('camo', rb(0.32, 0.24, 0.04, 0.02, s * 1.22, D - 0.32, rz(D - 0.32) + 0.01, -ra), { tint: 0xc8c8c8 });
    P.add('dark', rod(V(s * 0.95, 0.62, 3.0), V(s * 0.95, 0.62, 3.2), 0.04, 6));
    P.add('dark', box(0.09, 0.13, 0.07, s * 0.95, 0.58, 3.2));
    P.add('dark', box(0.16, 0.08, 0.06, s * 0.75, F - 0.08, 3.19));
    P.add('red', box(0.1, 0.04, 0.01, s * 0.75, F - 0.08, 3.225));
  }
  P.add('camo', box(GM.FX * 2, 0.045, 0.2, 0, F - 0.02, 3.22), { tint: 0xd0d0d0 }); // the shelf
  P.add('camo', box(GM.FX * 2, 0.16, 0.035, 0, F - 0.1, 3.31), { tint: 0xc8c8c8 }); // its lip
  for (const s of [-1, 1]) P.add('camo', rb(0.58, 0.36, 0.03, 0.04, s * 0.5, 0.72, 3.08, 0.35), { tint: 0xc0c0c0 }); // lower plate covers
  P.add('dark', box(0.24, 0.1, 0.16, 0, 0.62, 3.05)); // pintle

  // ---- M4 handrail round the rear deck corners
  if (m4) {
    const h = D + 0.26;
    for (const s of [-1, 1]) {
      const x = s * (W - 0.04);
      P.add('steel', rod(V(x, h, 2.2), V(x, h, 3.22), 0.018, 6), { tint: 0x7a8a6a });
      P.add('steel', rod(V(x, h, 3.22), V(s * 0.55, h, 3.22), 0.018, 6), { tint: 0x7a8a6a });
      P.add('steel', rod(V(x, h - 0.13, 2.25), V(x, h - 0.13, 3.18), 0.014, 5), { tint: 0x7a8a6a });
      for (const z of [2.2, 2.7, 3.22]) P.add('steel', rod(V(x, D, z), V(x, h, z), 0.016, 5), { tint: 0x7a8a6a });
      P.add('steel', rod(V(s * 0.55, h, 3.22), V(s * 0.55, D - 0.05, 3.18), 0.016, 5), { tint: 0x7a8a6a });
    }
  }
}
