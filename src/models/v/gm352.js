import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { ConvexGeometry } from 'three/examples/jsm/geometries/ConvexGeometry.js';
import { V, box, rbox, yTube, zTube, xTube, rod, sideProfile, loft, lathe, xf } from '../kit.js';
import { mudFlap } from '../trucks.js';

// GM-352M tracked chassis (Minsk) in its 2S6M Tunguska build: a long, low, slab-sided hull with a
// thick sloped skirt over the tracks, a shallow glacis deck with a steep lower nose (the corners cut
// back), the driver's window at the front left, a raised box along the front right, four big access
// doors and a louvred grille on each side, the engine deck at the rear. Running gear: six twin-tyred
// road wheels on hydropneumatic arms, a raised rear sprocket and front idler, three return rollers
// behind the skirt. Measured from refs/tunguska (photo 02 the right side at 230 px/m with the 7.9 m
// hull; 05, 06, 15 the front; 03, 04, 08 the rear). Model space: front -Z, right +X, ground y = 0;
// the hull is centred on z = 0.

export const GM352 = {
  front: -3.95, // tip of the glacis deck
  rear: 3.95,
  W: 1.45, // half width of the upper hull (side walls)
  roof: 1.96,
  under: 1.2, // underside of the upper hull where it overhangs the tracks
  lower: 1.08, // half width of the lower hull between the tracks
  belly: 0.45,
  skirt: { top: 1.34, edge: 1.17, bottom: 1.07, out: 1.625, z0: -2.6 },
  gauge: 1.36, // track centre line
  trackW: 0.48,
  wheels: [-2.45, -1.45, -0.45, 0.57, 1.57, 2.53], // road wheel centres, front to rear
  wheelR: 0.36,
  wheelY: 0.41,
  rollers: [-1.95, -0.05, 1.07], // return rollers (hidden behind the skirt in every photo)
  rollerY: 0.98,
  idler: [-3.08, 0.8, 0.33], // z, y, radius (front, raised)
  sprocket: [3.3, 0.82, 0.3], // rear drive
};

const nonIdx = (gs) => mergeGeometries(gs.map((g) => { const n = g.index ? g.toNonIndexed() : g; if (n.attributes.uv) n.deleteAttribute('uv'); return n; }));
const latheX = (pts, seg) => lathe(pts, seg).rotateZ(-Math.PI / 2); // profile [r, x], axis along +X
const hull = (pts) => new ConvexGeometry(pts.map(([x, y, z]) => V(x, y, z)));
const both = (pts) => pts.flatMap(([x, y, z]) => [[-x, y, z], [x, y, z]]);

// A flat plate with rounded corners in the (z, y) plane, thickness t along x, centred at (x, y, z):
// doors and armour panels (far fewer triangles than a rounded box).
export function plateRR(len, h, r, t, x, y, z) {
  const s = new THREE.Shape(), a = len / 2, b = h / 2;
  s.moveTo(-a + r, -b);
  s.lineTo(a - r, -b); s.quadraticCurveTo(a, -b, a, -b + r);
  s.lineTo(a, b - r); s.quadraticCurveTo(a, b, a - r, b);
  s.lineTo(-a + r, b); s.quadraticCurveTo(-a, b, -a, b - r);
  s.lineTo(-a, -b + r); s.quadraticCurveTo(-a, -b, -a + r, -b);
  const g = new THREE.ExtrudeGeometry(s, { depth: t, bevelEnabled: false, curveSegments: 3 });
  g.translate(0, 0, -t / 2);
  g.rotateY(-Math.PI / 2); // the shape's x runs along z, the extrusion along x
  return g.translate(x, y, z);
}

// ---------------------------------------------------------------- track

// Closed path of the track's inner face in (z, y), counterclockwise seen from the right: down the
// front of the idler, along the bottoms of the road wheels, up round the rear sprocket, and back
// over the return rollers with a little sag (a polyline rounded off).
function trackPath() {
  const { wheels, wheelR: R, wheelY: Y, rollers, rollerY } = GM352;
  const [iz, iy, ir] = GM352.idler, [sz, sy, sr] = GM352.sprocket;
  const wF = wheels[0], wR = wheels[wheels.length - 1];
  // outward normal angle of the external tangent from circle 1 to circle 2, both wrapped CCW
  const tan = (z1, y1, r1, z2, y2, r2) => {
    const dz = z2 - z1, dy = y2 - y1, L = Math.hypot(dz, dy);
    return Math.atan2(dy, dz) - Math.acos((r1 - r2) / L);
  };
  const pts = [];
  const arc = (cz, cy, r, a0, a1) => {
    while (a1 < a0) a1 += Math.PI * 2;
    const n = Math.max(2, Math.ceil((a1 - a0) / 0.09));
    for (let i = 0; i <= n; i++) { const a = a0 + (a1 - a0) * (i / n); pts.push([cz + Math.cos(a) * r, cy + Math.sin(a) * r]); }
  };
  const aID = tan(iz, iy, ir, wF, Y, R); // idler to the front wheel's bottom
  const aWS = tan(wR, Y, R, sz, sy, sr); // rear wheel's bottom to the sprocket
  arc(iz, iy, ir, Math.PI / 2, aID + Math.PI * 2);
  arc(wF, Y, R, aID, -Math.PI / 2);
  arc(wR, Y, R, -Math.PI / 2, aWS);
  arc(sz, sy, sr, aWS, Math.PI / 2);
  // top run from the sprocket's top over the rollers to the idler's top, sagging between supports
  let top = [[sz, sy + sr]];
  const sup = [[sz, sy + sr], ...rollers.slice().reverse().map((z) => [z, rollerY + 0.085]), [iz, iy + ir]];
  for (let k = 0; k < sup.length - 1; k++) {
    const [a, b] = [sup[k], sup[k + 1]];
    top.push([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2 - 0.035]);
    top.push(b);
  }
  for (let it = 0; it < 3; it++) { // Chaikin rounding, keeping the end points
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

// One link: a shoe nearly the full pitch long with two grouser bars, the end connectors with their
// round wedge bolts on both edges, and a pair of guide horns on the inside that the twin wheels run
// between. Local: x across the track, y outward from the inner face, z along the run.
function linkGeometry(w, pitch) {
  const g = [box(w - 0.08, 0.035, pitch * 0.86, 0, 0.018, 0)];
  g.push(box(w * 0.7, 0.03, 0.04, 0, 0.05, 0.01)); // grouser
  for (const s of [-1, 1]) g.push(box(0.05, 0.05, pitch * 0.7, s * (w / 2 - 0.025), 0.016, pitch * 0.5)); // end connectors over the joint
  g.push(box(0.09, 0.075, 0.07, 0, -0.04, 0)); // guide horns
  return nonIdx(g);
}

export function addTracks(P, pitch = 0.152) {
  const pts = trackPath();
  const n = pts.length, cum = [0];
  for (let i = 1; i <= n; i++) { const a = pts[i - 1], b = pts[i % n]; cum.push(cum[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1])); }
  const L = cum[n], N = Math.round(L / pitch), step = L / N;
  const link = linkGeometry(GM352.trackW, step);
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
      m.setPosition(sx * GM352.gauge, y, z);
      P.add('dark', link.clone().applyMatrix4(m));
    }
  }
  return N;
}

// ---------------------------------------------------------------- wheels

// Twin road wheel about +X: two pressed discs each with a thick rubber tyre, a gap between them for
// the guide horns, the outer disc dished in with a raised hub and a ring of bolts. Returns { tyre, disc }.
function roadWheel(R) {
  const h = 0.16; // width of one half
  const tyre = (x0) => latheX([[R - 0.07, x0], [R - 0.01, x0], [R, x0 + 0.025], [R, x0 + h - 0.025], [R - 0.01, x0 + h], [R - 0.07, x0 + h]], 18);
  const ty = nonIdx([tyre(0.025), tyre(-0.025 - h)]);
  const d = [];
  // outer half: rim lip, the face dished in, a raised hub with a cap
  d.push(latheX([[R - 0.07, 0.025 + h], [R - 0.1, 0.15], [0.12, 0.14], [0.1, 0.175], [0.0, 0.19]], 18));
  for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; d.push(xTube(0.16, 0.176, 0.012, 0.012, 5, Math.cos(a) * 0.085, Math.sin(a) * 0.085)); }
  // inner half and the hub between the halves (seen through the gap)
  d.push(latheX([[0.0, -0.18], [R - 0.07, -0.025 - h]], 14));
  d.push(xTube(-0.03, 0.03, 0.14, 0.14, 10, 0, 0, true));
  return { tyre: ty, disc: nonIdx(d) };
}

// Toothed sprocket ring with lightening holes, extruded along X
function sprocketRing(rRoot, rTip, t, teeth = 14) {
  const s = new THREE.Shape();
  const pts = [];
  for (let i = 0; i < teeth; i++) {
    const a = (i / teeth) * Math.PI * 2, w = Math.PI / teeth;
    for (const [r, b] of [[rRoot, a - w * 0.6], [rTip, a - w * 0.25], [rTip, a + w * 0.25], [rRoot, a + w * 0.6]]) pts.push(new THREE.Vector2(Math.cos(b) * r, Math.sin(b) * r));
  }
  s.setFromPoints(pts);
  const g = new THREE.ExtrudeGeometry(s, { depth: t, bevelEnabled: false, curveSegments: 6 });
  g.translate(0, 0, -t / 2);
  return g.rotateY(Math.PI / 2); // shape (x, y) -> (z, y), extruded along x
}

export function addRunningGear(P) {
  const { wheels, wheelR: R, wheelY: Y, gauge: G, rollers, rollerY } = GM352;
  const [sz, sy, sr] = GM352.sprocket, [iz, iy, ir] = GM352.idler;
  const rw = roadWheel(R);
  const spr = sprocketRing(sr - 0.06, sr + 0.02, 0.05);
  for (const s of [-1, 1]) {
    const flip = s < 0 ? Math.PI : 0; // left side wheels face -X
    for (const z of wheels) {
      const m = xf(s * G, Y, z, 0, flip, 0);
      P.add('rubber', rw.tyre.clone().applyMatrix4(m));
      P.add('rim', rw.disc.clone().applyMatrix4(m));
      // trailing arm forward to the hull and the hydropneumatic unit on the hull side above it
      P.add('dark', rod(V(s * 1.05, 0.66, z - 0.42), V(s * (G - 0.2), Y, z), 0.05, 6));
      P.add('dark', xTube(s * 1.0, s * 1.14, 0.1, 0.1, 10, 0.66, z - 0.42));
      P.add('dark', rod(V(s * 1.12, 0.95, z - 0.3), V(s * 1.12, 0.66, z - 0.42), 0.07, 8));
      P.add('dark', zTube(z - 0.62, z - 0.18, 0.08, 0.08, 8, s * 1.13, 0.95));
    }
    // return rollers on stub axles
    for (const z of rollers) {
      P.add('rubber', xTube(s * (G - 0.2), s * (G + 0.2), 0.085, 0.085, 14, rollerY, z));
      P.add('rim', xTube(s * (G + 0.2), s * (G + 0.22), 0.06, 0.05, 12, rollerY, z));
      P.add('dark', xTube(s * 1.05, s * (G - 0.2), 0.04, 0.04, 8, rollerY, z));
    }
    // rear drive sprocket: two toothed rings either side of the hub, a bolted hub cap outside
    for (const dx of [-0.1, 0.1]) P.add('rim', spr.clone().applyMatrix4(xf(s * G + dx, sy, sz, 0.11 * s)));
    P.add('rim', xTube(s * (G - 0.12), s * (G + 0.12), sr - 0.07, sr - 0.07, 20, sy, sz));
    P.add('rim', latheX([[sr - 0.07, 0.12], [0.16, 0.13], [0.12, 0.17], [0.0, 0.175]], 18).applyMatrix4(xf(s * G, sy, sz, 0, s < 0 ? Math.PI : 0, 0)));
    for (let i = 0; i < 10; i++) { const a = (i / 10) * Math.PI * 2; P.add('steel', xTube(s * (G + 0.15), s * (G + 0.17), 0.012, 0.012, 6, sy + Math.cos(a) * 0.12, sz + Math.sin(a) * 0.12)); }
    P.add('dark', xTube(s * 1.0, s * (G - 0.12), 0.15, 0.15, 12, sy, sz)); // final drive
    // front idler: a plain dished disc on a crank (the track tensioner)
    P.add('rim', latheX([[ir, -0.2], [ir, 0.2], [ir - 0.02, 0.215], [0.12, 0.2], [0.07, 0.24], [0.0, 0.245]], 24).applyMatrix4(xf(s * G, iy, iz, 0, s < 0 ? Math.PI : 0, 0)));
    P.add('rim', latheX([[0.0, -0.21], [ir - 0.02, -0.21]], 18).applyMatrix4(xf(s * G, iy, iz, 0, s < 0 ? Math.PI : 0, 0)));
    P.add('dark', rod(V(s * 1.0, 0.85, iz + 0.32), V(s * (G - 0.2), iy, iz), 0.06, 6));
  }
  return addTracks(P);
}

// ---------------------------------------------------------------- hull

// Rounded access door on a side wall (facing +X when side = 1), with hinges toward the front and a
// handle at the back edge.
function sideDoor(P, s, z0, z1, y0, y1, { hinges = true, handle = true } = {}) {
  const x = s * (GM352.W + 0.045), zc = (z0 + z1) / 2, yc = (y0 + y1) / 2; // boxes standing 7 cm proud of the wall (photos 09, 15)
  P.add('camo', plateRR(z1 - z0, y1 - y0, 0.07, 0.11, x, yc, zc));
  P.add('dark', box(0.012, 0.02, z1 - z0 - 0.12, x, y0 - 0.008, zc)); // shadow line under the lid
  if (hinges) for (const y of [y0 + 0.1, y1 - 0.1]) {
    P.add('dark', box(0.04, 0.07, 0.09, x + s * 0.05, y, z0 - 0.04));
  }
  if (handle) {
    for (const y of [yc - 0.12, yc + 0.12]) P.add('dark', box(0.04, 0.05, 0.05, x + s * 0.05, y, z1 + 0.03));
    P.add('dark', box(0.03, 0.12, 0.03, x + s * 0.07, yc, z1 + 0.04));
  }
}

// Mesh grille in a frame on a side wall
function sideGrille(P, s, z0, z1, y0, y1, bars = 0) {
  const x = s * GM352.W, zc = (z0 + z1) / 2, yc = (y0 + y1) / 2;
  P.add('dark', box(0.03, y1 - y0, z1 - z0, x, yc, zc));
  P.add('camo', rbox(0.04, y1 - y0 + 0.06, 0.04, 0.015, x + s * 0.01, yc, z0 - 0.02));
  P.add('camo', rbox(0.04, y1 - y0 + 0.06, 0.04, 0.015, x + s * 0.01, yc, z1 + 0.02));
  P.add('camo', rbox(0.04, 0.04, z1 - z0 + 0.06, 0.015, x + s * 0.01, y0 - 0.02, zc));
  P.add('camo', rbox(0.04, 0.04, z1 - z0 + 0.06, 0.015, x + s * 0.01, y1 + 0.02, zc));
  if (bars) { // louvre bars across
    for (let i = 1; i < bars; i++) P.add('camo', box(0.025, 0.018, z1 - z0, x + s * 0.008, y0 + ((y1 - y0) * i) / bars, zc), { tint: 0xc8c8c8 });
  } else { // mesh: a lattice of thin wires
    for (let z = z0 + 0.04; z < z1; z += 0.05) P.add('steel', box(0.01, y1 - y0, 0.008, x + s * 0.016, yc, z), { tint: 0x6a6a6a });
    for (let y = y0 + 0.04; y < y1; y += 0.05) P.add('steel', box(0.01, 0.008, z1 - z0, x + s * 0.02, y, zc), { tint: 0x6a6a6a });
  }
}

// D-shaped towing eye on a plate facing `n` (unit vector), centred at p
function towEye(P, p, n, r = 0.06) {
  const g = new THREE.TorusGeometry(r, 0.016, 4, 8, Math.PI * 1.15).rotateZ(Math.PI * 0.92);
  const q = new THREE.Quaternion().setFromUnitVectors(V(0, 0, 1), n);
  g.applyQuaternion(q);
  P.add('dark', g.translate(p.x + n.x * 0.02, p.y + n.y * 0.02, p.z + n.z * 0.02));
  P.add('dark', box(0.05, 0.03, 0.04).applyQuaternion(q).translate(p.x + n.x * 0.01, p.y + n.y * 0.01 + r * 0.7, p.z + n.z * 0.01));
}

// Headlight pod on the glacis corner: box with a big lamp in a guard, two small marker lamps on top
function lampPod(P, s, z, y) {
  const x = s * 1.18;
  P.add('camo', rbox(0.42, 0.2, 0.36, 0.03, x, y, z));
  P.add('dark', zTube(z - 0.16, z - 0.25, 0.085, 0.085, 14, x - s * 0.06, y - 0.01));
  P.add('glass', zTube(z - 0.25, z - 0.255, 0.075, 0.075, 14, x - s * 0.06, y - 0.01), { tint: 0xc8d4dc });
  P.add('dark', box(0.2, 0.03, 0.12, x - s * 0.06, y + 0.1, z - 0.2)); // visor
  P.add('dark', zTube(z - 0.16, z - 0.24, 0.06, 0.06, 12, x + s * 0.12, y - 0.01));
  for (const dx of [-0.05, 0.05]) {
    P.add('dark', zTube(z - 0.05, z - 0.13, 0.03, 0.03, 8, x + s * 0.1 + dx, y + 0.14));
    P.add('red', zTube(z - 0.13, z - 0.135, 0.022, 0.022, 8, x + s * 0.1 + dx, y + 0.14));
  }
}

export function addHull(P) {
  const { front: F, rear: R, W, roof: T, under: U, lower: L, belly: B } = GM352;
  const CH = 0.05;
  const ring = (z, top, bot = U, w = W) => [V(-w, bot, z), V(w, bot, z), V(w, top - CH, z), V(w - CH, top, z), V(-(w - CH), top, z), V(-w, top - CH, z)];
  // upper hull: roof from the cab back to the rear plate
  const ZC = -3.12; // where the front plate meets the roof
  P.add('camo', loft([ring(R, T), ring(ZC, T)]));
  // front: a steep plate down from the roof to the glacis deck, which runs shallow to the tip
  P.add('camo', hull(both([[W, U, ZC + 0.02], [W, T, ZC + 0.02], [W, T - 0.04, ZC - 0.03], [W, 1.6, -3.3], [W, U, -3.3]])));
  P.add('camo', hull(both([[W, U, -3.29], [W, 1.6, -3.29], [W, 1.41, F], [W, 1.3, F + 0.04], [W, U, -3.6]])));
  // lower hull between the tracks: steep lower nose, flat belly, the lower rear plate sloping in
  P.add('camo', sideProfile([[F + 0.3, 1.28], [-3.45, 0.62], [-3.15, B], [3.5, B], [R, 0.98], [R, U + 0.02], [F + 0.3, U + 0.02]], L * 2));
  // the lower nose plate across the full width at the top, tapering to the bottom (a trapezoid)
  P.add('camo', hull(both([[W, 1.41, F], [W, 1.3, F + 0.03], [W - 0.05, U, -3.62], [1.0, 0.62, -3.45], [1.0, 0.62, -3.3], [L, U, -3.3]])));
  // the side between the tracks sits in shadow behind the wheels
  for (const s of [-1, 1]) P.add('camo', box(0.01, U - B - 0.1, 6.6, s * (L + 0.006), (U + B) / 2, 0.15), { tint: 0x505050 });
  P.add('dark', box(L * 2 - 0.1, 0.03, 6.6, 0, B - 0.01, 0.15)); // belly plate

  // ---- skirts: a sloped plate from the wall out to a lip, in sections; the front one dips over the idler
  const sk = GM352.skirt;
  const sec = (z, top, edge, bot, out = sk.out) => [V(W - 0.02, bot, z), V(out, bot, z), V(out, edge, z), V(W - 0.02, top, z)];
  const joints = [R - 0.04, 2.25, 0.55, -1.15, sk.z0];
  for (const s of [-1, 1]) {
    const mir = (r) => (s < 0 ? r.map((p) => V(-p.x, p.y, p.z)) : r);
    for (let i = 0; i < joints.length - 1; i++) {
      P.add('camo', loft([mir(sec(joints[i] - 0.006, sk.top, sk.edge, sk.bottom)), mir(sec(joints[i + 1] + 0.006, sk.top, sk.edge, sk.bottom))]));
    }
    // front section: dips toward the nose over the idler and turns in to the nose corner, a fender
    // rather than a blade (photos 06, 15)
    P.add('camo', loft([mir(sec(sk.z0 - 0.006, sk.top, sk.edge, sk.bottom)), mir(sec(-3.2, 1.24, 1.08, 0.97, 1.6)), mir(sec(-3.62, 1.12, 1.0, 0.9, 1.53)), mir(sec(-3.84, 1.06, 0.95, 0.86, W + 0.02))]));
    // rubber flap behind the rear section, and a narrower one ahead of the idler
    mudFlap(P, s * (GM352.gauge + 0.02), sk.bottom, R - 0.06, 0.5, 0.38);
  }

  // ---- cab and front fittings
  // raised box along the front right (photo 02: 1.8 m long, 0.1 m over the roof, sloped front)
  P.add('camo', hull([[0.92, T - 0.02, -1.62], [W, T - 0.02, -1.62], [0.92, 2.07, -1.62], [W - 0.03, 2.07, -1.62], [0.92, 2.07, -3.18], [W - 0.03, 2.07, -3.18], [0.92, 1.66, -3.48], [W, 1.66, -3.48], [0.92, T - 0.02, -3.0], [W, T - 0.02, -3.0]]));
  P.add('dark', box(0.3, 0.012, 0.9, 1.18, 2.075, -2.45)); // its hatch seam
  // box behind the glacis right of centre with an X-stamped hatch (photo 15)
  P.add('camo', hull([[0.06, 1.6, -3.42], [0.86, 1.6, -3.42], [0.06, 1.72, -3.42], [0.86, 1.72, -3.42], [0.06, 2.0, -3.0], [0.86, 2.0, -3.0], [0.06, 2.0, -2.6], [0.86, 2.0, -2.6], [0.06, 1.6, -2.6], [0.86, 1.6, -2.6]]));
  const xa = Math.atan2(0.28, 0.42); // the X-stamped hatch on the box's sloped top
  P.add('camo', box(0.58, 0.025, 0.4, 0.46, 1.87, -3.2, xa), { tint: 0xd8d8d8 });
  for (const r of [-1, 1]) P.add('dark', box(0.6, 0.012, 0.02, 0.46, 1.885, -3.2, xa, r * 0.6, 0));
  // driver's station at the front left: a sloped window plate with a hood standing open above it
  const dx = -0.52;
  P.add('camo', hull([[dx - 0.44, 1.6, -3.42], [dx + 0.44, 1.6, -3.42], [dx - 0.44, 2.0, -3.22], [dx + 0.44, 2.0, -3.22], [dx - 0.44, 2.02, -2.6], [dx + 0.44, 2.02, -2.6], [dx - 0.44, 1.6, -2.6], [dx + 0.44, 1.6, -2.6]]));
  const wa = Math.atan2(0.4, 0.2); // window plate slope
  P.add('dark', box(0.66, 0.3, 0.02, dx, 1.8, -3.33, -(Math.PI / 2 - wa)));
  P.add('glass', box(0.6, 0.24, 0.02, dx, 1.8, -3.335, -(Math.PI / 2 - wa)));
  P.add('camo', box(0.86, 0.035, 0.36, dx, 2.07, -3.36, 0.18)); // the armoured hood, propped open over the window
  for (const s of [-1, 1]) P.add('dark', rod(V(dx + s * 0.4, 1.95, -3.24), V(dx + s * 0.4, 2.06, -3.5), 0.012, 4));
  P.add('dark', box(0.015, 0.012, 0.3, dx + 0.05, 1.8, -3.345, -(Math.PI / 2 - wa), 0, 0.9)); // wiper
  P.add('dark', rod(V(dx - 0.2, 2.03, -2.75), V(dx + 0.2, 2.03, -2.75), 0.015, 5)); // grab handle
  // headlight pods on the glacis corners
  for (const s of [-1, 1]) lampPod(P, s, -3.62, 1.66);
  // grilles on the deck corners, tow cable looped across the glacis, its eyes clipped down
  for (const s of [-1, 1]) {
    P.add('dark', box(0.32, 0.02, 0.16, s * 0.95, 1.47, -3.78, 0.32));
    for (let i = 0; i < 4; i++) P.add('steel', box(0.28, 0.01, 0.012, s * 0.95, 1.483, -3.84 + i * 0.04, 0.32), { tint: 0x777777 });
  }
  const cable = new THREE.CatmullRomCurve3([V(-0.95, 1.5, -3.62), V(-0.5, 1.52, -3.7), V(0.2, 1.53, -3.62), V(0.62, 1.56, -3.42), V(0.2, 1.57, -3.4), V(-0.4, 1.56, -3.48), V(-0.85, 1.53, -3.55)]);
  P.add('steel', new THREE.TubeGeometry(cable, 40, 0.03, 6, false), { tint: 0xb4b4ac });
  for (const x of [-0.98, 0.75]) P.add('dark', rbox(0.2, 0.05, 0.08, 0.02, x, 1.5, -3.62));
  // lower nose: D-ring eyes, the hitch block in the middle, towing hooks at the corners
  const nn = V(0, 0.55, -0.83).normalize();
  for (const x of [-0.75, -0.32, 0.32, 0.75]) towEye(P, V(x, 1.12, -3.72), nn);
  P.add('dark', rbox(0.36, 0.2, 0.12, 0.02, 0, 1.08, -3.72, 0.6));
  for (const s of [-1, 1]) P.add('dark', box(0.05, 0.25, 0.1, s * 0.1, 1.06, -3.76, 0.6));
  for (const s of [-1, 1]) {
    P.add('dark', rbox(0.14, 0.26, 0.16, 0.03, s * 0.98, 0.84, -3.56, 0.55));
    P.add('dark', box(0.12, 0.05, 0.18, s * 0.98, 0.72, -3.52, 0.2));
  }

  // ---- sides (right per photo 02, left per photo 05; doors 0.42 to 0.5 m tall above the skirt)
  // right
  sideDoor(P, 1, -3.4, -2.42, 1.4, 1.84);
  P.add('camo', xTube(W, W + 0.025, 0.08, 0.08, 14, 1.75, -1.92)); // filler cover
  sideDoor(P, 1, -1.84, -1.28, 1.4, 1.78);
  sideDoor(P, 1, -0.02, 0.73, 1.4, 1.84);
  sideDoor(P, 1, 0.93, 1.64, 1.42, 1.84);
  sideGrille(P, 1, 1.69, 1.88, 1.45, 1.75, 6);
  sideGrille(P, 1, 1.95, 2.3, 1.42, 1.9);
  sideDoor(P, 1, 2.85, 3.3, 1.42, 1.8, { hinges: true, handle: false });
  for (const z of [-0.45, -0.75]) P.add('dark', box(0.03, 0.16, 0.03, W + 0.015, 1.68, z, 0.4));
  // left
  sideDoor(P, -1, -3.05, -2.32, 1.4, 1.86);
  sideDoor(P, -1, -2.2, -1.68, 1.44, 1.8);
  P.add('dark', box(0.04, 0.05, 1.05, -W - 0.02, 1.72, -0.78)); // long handle bar
  for (const z of [-1.3, -0.26]) P.add('camo', box(0.06, 0.12, 0.03, -W - 0.02, 1.76, z), { tint: 0xc8b48a });
  for (const z of [-0.36, -0.08]) P.add('camo', xTube(-W, -W - 0.025, 0.07, 0.07, 14, 1.52, z));
  sideDoor(P, -1, 0.05, 0.8, 1.42, 1.82);
  P.add('dark', box(0.02, 0.6, 0.012, -W - 0.006, 1.65, 0.88)); // seam ahead of the engine bay
  sideGrille(P, -1, 1.05, 3.2, 1.44, 1.56);
  for (let i = 0; i < 6; i++) P.add('camo', rbox(0.03, 0.12, 0.26, 0.015, -W - 0.01, 1.73, 1.2 + i * 0.36));
  // shadow line along the top of the skirts
  for (const s of [-1, 1]) P.add('dark', box(0.012, 0.018, 7.7, s * (W + 0.006), sk.top + 0.005, 0.0));

  // ---- rear plate (photos 04, 08): strapped stowage box left of centre, the exhaust cowl right,
  // lamp clusters in the top corners, tow eyes on the lower plate
  const rz = R + 0.001;
  P.add('camo', rbox(1.18, 0.34, 0.24, 0.03, -0.42, 1.56, R + 0.12));
  for (const x of [-0.85, 0.0]) {
    P.add('cloth', box(0.06, 0.4, 0.26, x, 1.56, R + 0.13), { tint: 0xb8a77a });
  }
  P.add('camo', yTube(1.22, 1.46, 0.02, 0.02, 5, -0.42, R + 0.22));
  P.add('camo', zTube(R, R + 0.2, 0.18, 0.17, 18, 0.88, 1.64));
  P.add('dark', zTube(R + 0.2, R + 0.21, 0.13, 0.13, 16, 0.88, 1.64));
  P.add('camo', rbox(0.06, 0.34, 0.08, 0.02, 1.12, 1.56, R + 0.05));
  for (const s of [-1, 1]) {
    P.add('dark', rbox(0.26, 0.1, 0.07, 0.02, s * 1.22, 1.9, R + 0.035));
    for (const dx of [-0.07, 0, 0.07]) P.add(dx === 0 ? 'amber' : 'red', zTube(R + 0.07, R + 0.075, 0.025, 0.025, 8, s * 1.22 + dx, 1.9));
  }
  const rn = V(0, -0.6, 0.8); // the lower rear plate's normal (it slopes in toward the belly)
  for (const [x, y] of [[-0.6, 0.86], [-0.2, 0.78], [0.2, 0.78], [0.6, 0.86], [-0.4, 0.62], [0.4, 0.62]]) towEye(P, V(x, y, 3.5 + (y - 0.45) * 0.84), rn);
  for (const s of [-1, 1]) P.add('dark', box(0.14, 0.24, 0.12, s * 0.95, 0.9, R - 0.05));
  P.add('dark', box(2.9, 0.012, 0.012, 0, 1.25, rz)); // seam to the lower plate

  // ---- roof: turret ring housing, engine deck hatches and grilles, lifting eyes, rails
  P.add('camo', rbox(0.9, 0.08, 0.6, 0.02, -0.9, T + 0.04, 3.45)); // box on the left rear corner
  P.add('camo', rbox(0.5, 0.1, 0.4, 0.02, 1.15, T + 0.05, 3.0));
  for (const [x, z, w, d] of [[0.25, 2.2, 0.9, 1.0], [-0.75, 2.2, 0.9, 1.0], [0.25, 3.1, 0.9, 0.6]]) {
    P.add('camo', rbox(w, 0.03, d, 0.02, x, T + 0.012, z), { tint: 0xd0d0d0 });
    P.add('dark', box(0.3, 0.02, 0.025, x, T + 0.04, z));
  }
  P.add('dark', box(2.6, 0.015, 0.02, 0, T + 0.004, 1.6));
  for (const s of [-1, 1]) {
    P.add('steel', rod(V(s * 1.32, T + 0.12, 1.75), V(s * 1.32, T + 0.12, 3.75), 0.014, 5), { tint: 0x7c7c7c });
    for (const z of [1.75, 2.75, 3.75]) P.add('steel', rod(V(s * 1.32, T, z), V(s * 1.32, T + 0.12, z), 0.013, 5), { tint: 0x7c7c7c });
    P.add('dark', box(0.08, 0.06, 0.08, s * 1.3, T + 0.03, -1.4));
  }
}

export function buildChassis(P) {
  addHull(P);
  return addRunningGear(P);
}
