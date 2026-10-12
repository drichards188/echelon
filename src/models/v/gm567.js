import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { V, box, yTube, zTube, xTube, rod, sideProfile, lathe, loft, ringAt, xf } from '../kit.js';
import { rb } from './ural.js';

// Mytishchi GM-567M / GM-579 tracked chassis of the Buk battery's radar and command post (the Buk
// TELAR and loader hulls are the same family, ./gm569.js): a low, slab-sided hull on six twin
// rubber-tyred road wheels a side, the drive sprocket at the rear, the idler at the front, a straight
// upper track run on small return rollers under the side apron, and a beak nose (a lower plate sloping
// back under the tracks' front, the upper hull's glacis above it). The running gear is the TELAR's
// (./gm569.js) at that file's GM_SCALE (lengths and heights x 0.85: 0.65 m road wheels, the published
// 4.65 m from the first to the last road wheel), so the battery matches; widths stay at the published
// 3.25 m, 0.5 m tracks, and the belly at the published 0.45 m clearance. The road wheel gaps open up
// toward the front, as in the TELAR side photos. On the Kupol photo (bukradar.js) the wheels are hidden
// in shadow, but the track's front and its ground contact, seen through the solved camera, sit where
// this gear puts them (the larger gear stood 0.27 m too high there). Every function takes a chassis
// record C (RADAR_C, CP_C below); the upper hull is the builder's. Model space: front -Z, right +X,
// ground y = 0.

const S = 0.85; // GM_SCALE of ./gm569.js, applied to the photo-unit layout below
const BASE = {
  W: 1.56, // half width of the upper hull over the tracks
  apron: 1.625, // outer edge of the side aprons (3.25 m)
  gauge: 1.37, // track centre line
  trackW: 0.5,
  belly: 0.45,
  sponson: 1.12, // underside of the upper hull where it overhangs the tracks
  lowerW: 1.07, // half width of the lower hull between the tracks
  wheelR: 0.385 * S,
  wheelY: 0.47 * S,
};

// Lay the running gear out from the nose: the idler behind it, six wheels with the gaps closing up
// toward the rear (as on the TELAR), the sprocket behind the last wheel; k stretches the spacing.
// wheels[0] is the rear.
function gear(front, rear, k = 1) {
  const idler = front + 0.78 * S, w = [idler + 0.93 * S * k];
  for (const g of [1.23, 1.18, 1.14, 1.0, 0.98]) w.push(w[w.length - 1] + g * S * k);
  const wheels = w.reverse();
  return { front, rear, wheels, sprocket: [wheels[0] + 1.0 * S * k, 0.88 * S, 0.33 * S], idler: [idler, 0.86 * S, 0.3 * S], rollers: [(wheels[0] + wheels[1]) / 2, (wheels[2] + wheels[3]) / 2, (wheels[4] + wheels[5]) / 2] };
}

// 9S18M1-1: hull 9.59 m (ru Wikipedia), deck 2.15 m (fitted to the photo). The family's quoted 4.65 m
// wheelbase would leave 2.6 m of hull behind the sprocket, so the same wheels are spread 27% wider
// (5.97 m) to end the hull a TELAR-like 0.9 m behind it (unconfirmed: no side photo of the radar).
export const RADAR_C = { ...BASE, ...gear(-4.8, 4.79, 1.27), roof: 2.15 };
// 9S510 command post on the 9S470's chassis: hull 8.0 m, the same running gear
export const CP_C = { ...BASE, ...gear(-4.0, 4.0), roof: 2.3, W: 1.35 }; // the body stands in from wide aprons, as on the TELAR
export const GM = RADAR_C;

const nonIdx = (gs) => mergeGeometries(gs.map((g) => { const n = g.index ? g.toNonIndexed() : g; if (n.attributes.uv) n.deleteAttribute('uv'); return n; }));
const latheX = (pts, seg) => lathe(pts, seg).rotateZ(-Math.PI / 2); // profile [r, x], axis along +X

// height of the straight top run (track inner face) at z, from the idler top to the sprocket top
export function topRunY(C, z) {
  const [sz, sy, sr] = C.sprocket, [iz, iy, ir] = C.idler;
  return iy + ir + ((sy + sr) - (iy + ir)) * (z - iz) / (sz - iz);
}

// ---------------------------------------------------------------- track

// Closed path of the track's inner face in (z, y), counterclockwise in the (z, y) plane: round the
// front of the idler, under the road wheels, round the back of the sprocket, then the straight top run.
function trackPath(C) {
  const { wheels, wheelR: R, wheelY: Y } = C;
  const L = [C.idler, [wheels[wheels.length - 1], Y, R], [wheels[0], Y, R], C.sprocket];
  // outward normal angle of the external tangent from circle a to circle b (both wrapped CCW)
  const tan = (a, b) => { const dz = b[0] - a[0], dy = b[1] - a[1], d = Math.hypot(dz, dy); return Math.atan2(dy, dz) - Math.acos((a[2] - b[2]) / d); };
  const pts = [];
  for (let i = 0; i < L.length; i++) {
    const prev = L[(i + L.length - 1) % L.length], c = L[i], next = L[(i + 1) % L.length];
    const a0 = tan(prev, c);
    let a1 = tan(c, next);
    while (a1 < a0) a1 += Math.PI * 2;
    const n = Math.max(1, Math.ceil((a1 - a0) / 0.09));
    for (let k = 0; k <= n; k++) { const a = a0 + (a1 - a0) * (k / n); pts.push([c[0] + Math.cos(a) * c[2], c[1] + Math.sin(a) * c[2]]); }
  }
  return pts;
}

// One link: shoe plate, a grouser bar across it, the guide horn on the inside (it runs between the
// twin road wheels) and the hinge lugs. Local: x across, y outward from the inner face, z along the run.
function linkGeometry(w, pitch) {
  return nonIdx([
    box(w, 0.034, pitch * 0.86, 0, 0.019, 0),
    box(w - 0.06, 0.026, 0.04, 0, 0.048, -pitch * 0.12),
    box(0.05, 0.085, 0.07, 0, -0.04, 0),
    box(0.1, 0.03, pitch * 0.4, w * 0.27, 0.0, pitch * 0.32),
    box(0.1, 0.03, pitch * 0.4, -w * 0.27, 0.0, pitch * 0.32),
  ]);
}

function addTracks(P, C, pitch = 0.13) {
  const pts = trackPath(C);
  const n = pts.length, cum = [0];
  for (let i = 1; i <= n; i++) { const a = pts[i - 1], b = pts[i % n]; cum.push(cum[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1])); }
  const L = cum[n], N = Math.round(L / pitch), step = L / N;
  const link = linkGeometry(C.trackW, step);
  const m = new THREE.Matrix4(), X = V(1, 0, 0), Nv = V(0, 0, 0), T = V(0, 0, 0);
  let j = 0;
  for (let k = 0; k < N; k++) {
    const s = k * step;
    while (cum[j + 1] < s) j++;
    const a = pts[j], b = pts[(j + 1) % n], f = (s - cum[j]) / (cum[j + 1] - cum[j]);
    const z = a[0] + (b[0] - a[0]) * f, y = a[1] + (b[1] - a[1]) * f;
    const tl = Math.hypot(b[0] - a[0], b[1] - a[1]), tz = (b[0] - a[0]) / tl, ty = (b[1] - a[1]) / tl;
    Nv.set(0, -tz, ty); // outward
    T.set(0, -ty, -tz);
    m.makeBasis(X, Nv, T);
    for (const sx of [-1, 1]) {
      m.setPosition(sx * C.gauge, y, z);
      P.add('dark', link.clone().applyMatrix4(m));
    }
  }
  return N;
}

// ---------------------------------------------------------------- wheels

// Twin road wheel about +X (outer face +X): two rubber tyres either side of the guide horn gap, a
// dished outer disc with a bolted hub cap, a plain inner disc. Returns { tyre, disc }.
function roadWheel(R) {
  const tyre = [], h = 0.08, c0 = 0.12;
  for (const c of [-c0, c0]) tyre.push(latheX([[R - 0.075, c - h], [R - 0.015, c - h], [R, c - h + 0.018], [R, c + h - 0.018], [R - 0.015, c + h], [R - 0.075, c + h]], 20));
  const o = c0 + h; // outer face
  const d = [latheX([[R - 0.075, o], [R - 0.1, o + 0.015], [0.23, o - 0.01], [0.16, o - 0.004], [0.12, o + 0.022], [0.08, o + 0.04], [0.0, o + 0.044]], 20)];
  d.push(latheX([[0, -o], [R - 0.075, -o]], 16));
  d.push(latheX([[R - 0.075, -0.04], [R - 0.075, 0.04]], 16)); // the rims either side of the horn gap
  for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; d.push(xTube(o - 0.01, o + 0.018, 0.014, 0.014, 5, Math.cos(a) * 0.19, Math.sin(a) * 0.19)); }
  for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2 + 0.3; d.push(xTube(o + 0.02, o + 0.05, 0.012, 0.012, 5, Math.cos(a) * 0.1, Math.sin(a) * 0.1)); }
  return { tyre: nonIdx(tyre), disc: nonIdx(d) };
}

// Toothed sprocket ring with lightening holes, extruded along X
function sprocketRing(rRoot, rTip, t, teeth = 13) {
  const s = new THREE.Shape();
  const pts = [];
  for (let i = 0; i < teeth; i++) {
    const a = (i / teeth) * Math.PI * 2, w = Math.PI / teeth;
    for (const [r, b] of [[rRoot, a - w * 0.66], [rTip, a - w * 0.3], [rTip, a + w * 0.3], [rRoot, a + w * 0.66]]) pts.push(new THREE.Vector2(Math.cos(b) * r, Math.sin(b) * r));
  }
  s.setFromPoints(pts);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.3, hp = new THREE.Path();
    hp.absarc(Math.cos(a) * rRoot * 0.62, Math.sin(a) * rRoot * 0.62, rRoot * 0.17, 0, Math.PI * 2, true);
    s.holes.push(hp);
  }
  const g = new THREE.ExtrudeGeometry(s, { depth: t, bevelEnabled: false, curveSegments: 5 });
  g.translate(0, 0, -t / 2);
  return g.rotateY(Math.PI / 2);
}

function idlerDisc(r, t) {
  const s = new THREE.Shape();
  s.absarc(0, 0, r, 0, Math.PI * 2, false);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2, hp = new THREE.Path();
    hp.absarc(Math.cos(a) * r * 0.58, Math.sin(a) * r * 0.58, r * 0.19, 0, Math.PI * 2, true);
    s.holes.push(hp);
  }
  const g = new THREE.ExtrudeGeometry(s, { depth: t, bevelEnabled: false, curveSegments: 8 });
  g.translate(0, 0, -t / 2);
  return g.rotateY(Math.PI / 2);
}

export function addRunningGear(P, C) {
  const { wheels, wheelR: R, wheelY: Y, gauge: G } = C;
  const [sz, sy, sr] = C.sprocket, [iz, iy, ir] = C.idler;
  const rw = roadWheel(R);
  const spr = sprocketRing(sr - 0.035, sr + 0.045, 0.05), idl = idlerDisc(ir - 0.012, 0.04);
  const hx = C.lowerW - 0.06; // torsion bar ends
  for (const s of [-1, 1]) {
    const flip = s < 0 ? Math.PI : 0; // left side wheels face -X
    for (const z of wheels) {
      const m = xf(s * G, Y, z, 0, flip, 0);
      P.add('rubber', rw.tyre.clone().applyMatrix4(m));
      P.add('rim', rw.disc.clone().applyMatrix4(m));
      // trailing arm from the torsion bar ahead of the wheel to the hub
      P.add('dark', rod(V(s * hx, Y + 0.24, z - 0.36), V(s * (G - 0.22), Y, z), 0.055, 6));
      P.add('dark', xTube(s * (hx - 0.02), s * (hx + 0.1), 0.09, 0.09, 10, Y + 0.24, z - 0.36));
    }
    // hydraulic dampers on the first two and the last wheels
    for (const z of [wheels[5], wheels[4], wheels[0]]) P.add('dark', rod(V(s * (G - 0.26), Y + 0.1, z - 0.12), V(s * (G - 0.28), C.sponson - 0.1, z - 0.45), 0.045, 6));
    // return rollers under the top run
    for (const z of C.rollers) {
      const y = topRunY(C, z) - 0.09;
      P.add('rubber', xTube(s * (G - 0.13), s * (G + 0.13), 0.09, 0.09, 12, y, z));
      P.add('rim', xTube(s * (G + 0.13), s * (G + 0.16), 0.055, 0.04, 8, y, z));
      P.add('dark', xTube(s * hx, s * (G - 0.13), 0.035, 0.035, 6, y, z));
    }
    // rear drive sprocket: two toothed rings either side of a bolted hub, final drive behind
    for (const dx of [-0.105, 0.105]) P.add('rim', spr.clone().applyMatrix4(xf(s * G + dx, sy, sz, 0.14 * s)));
    P.add('rim', xTube(s * (G - 0.13), s * (G + 0.13), 0.23, 0.23, 18, sy, sz));
    P.add('rim', xTube(s * (G + 0.13), s * (G + 0.18), 0.14, 0.11, 14, sy, sz));
    for (let i = 0; i < 10; i++) { const a = (i / 10) * Math.PI * 2; P.add('steel', xTube(s * (G + 0.13), s * (G + 0.155), 0.017, 0.017, 5, sy + Math.cos(a) * 0.185, sz + Math.sin(a) * 0.185)); }
    P.add('dark', xTube(s * hx, s * (G - 0.13), 0.17, 0.17, 12, sy, sz));
    // front idler: twin spoked discs on a crank arm
    for (const dx of [-0.085, 0.085]) P.add('rim', idl.clone().applyMatrix4(xf(s * G + dx, iy, iz)));
    P.add('rim', xTube(s * (G - 0.065), s * (G + 0.065), ir - 0.006, ir - 0.006, 22, iy, iz, true));
    P.add('rim', xTube(s * (G + 0.085), s * (G + 0.14), 0.085, 0.065, 12, iy, iz));
    P.add('dark', rod(V(s * hx, iy + 0.2, iz + 0.35), V(s * (G - 0.085), iy, iz), 0.06, 6));
  }
  return addTracks(P, C);
}

// ---------------------------------------------------------------- hull

// z of the lower nose plate at height y (it leans back 40 degrees from the nose edge at yNose)
export function plateZ(C, y, yNose = 1.22) { return C.front + (yNose - y) * 0.83; }

// Lower hull between the tracks, the lower nose plate sloping back from the nose edge (yNose) and
// the side aprons over the tracks. The upper hull is the builder's (it differs by vehicle).
export function addLowerHull(P, C, { yNose = 1.22, wNose = 1.5 } = {}) {
  const { front: ZF, rear: ZR, lowerW: LW, belly: YB, sponson: YS } = C;
  const zb = plateZ(C, YB, yNose); // where the nose plate meets the belly
  P.add('camo', sideProfile([[zb, YB], [ZR - 0.42, YB], [ZR, 0.86], [ZR, YS + 0.01], [zb, YS + 0.01]], LW * 2));
  // lower nose plate: full width at the nose edge, narrowing between the tracks at the bottom
  P.add('camo', loft([ringAt([[-wNose, ZF], [wNose, ZF], [wNose, ZF + 0.4], [-wNose, ZF + 0.4]], yNose), ringAt([[-LW, zb], [LW, zb], [LW, zb + 0.05], [-LW, zb + 0.05]], YB)]));
  // the side between the tracks is always in the aprons' shadow: a darker skin keeps it dark
  for (const s of [-1, 1]) P.add('camo', box(0.01, YS - YB - 0.05, ZR - zb - 0.6, s * (LW + 0.004), (YS + YB) / 2, (zb + ZR) / 2 - 0.2), { tint: 0x4a4a4a });
  P.add('dark', box(LW * 2 - 0.1, 0.03, ZR - zb - 0.4, 0, YB - 0.01, (zb + ZR) / 2)); // belly
  // side aprons: a sloped band along the hull's lower edge over the tracks, turned down at both ends
  const [iz] = C.idler, [sz] = C.sprocket;
  const z0 = iz - 0.05, z1 = sz + 0.45, yt = YS + 0.12;
  for (const s of [-1, 1]) {
    const x = s * (C.W + (C.apron - C.W) / 2), tilt = -s * Math.min(0.35, (C.apron - C.W) * 1.2); // wide aprons slope outward
    P.add('camo', sideProfile([[z0 - 0.45, YS - 0.3], [z0, yt], [z1, yt], [z1 + 0.35, YS - 0.3], [z1 + 0.35, YS - 0.36], [z1 - 0.02, YS + 0.04], [z0 + 0.02, YS + 0.04], [z0 - 0.45, YS - 0.36]], C.apron - C.W).applyMatrix4(xf(0, -YS, 0)).applyMatrix4(xf(x, YS, 0, 0, 0, tilt)));
    P.add('camo', box(C.apron - C.W + 0.01, 0.025, z1 - z0, x, yt - 0.005, (z0 + z1) / 2, 0, 0, tilt), { tint: 0xb8b8b8 });
    P.add('rubber', box(0.015, 0.1, z1 - z0 - 0.1, s * (C.apron - 0.005), YS - 0.0, (z0 + z1) / 2)); // rubber skirt strip
    for (let z = z0 + 0.25; z < z1; z += 0.45) P.add('dark', xTube(s * C.apron, s * (C.apron + 0.012), 0.016, 0.016, 5, yt - 0.06, z));
  }
}

// Upper hull loft from [z, yBottom, yTop, halfWidth] rings, front to back or back to front.
export function upperHull(P, rings, key = 'camo') {
  P.add(key, loft(rings.map(([z, yb, yt, w]) => [V(-w, yb, z), V(w, yb, z), V(w, yt, z), V(-w, yt, z)])));
}

// Hinged stowage panel on the upper hull side (s = +1 right, -1 left): a proud cover with a seam
// round it, hinges along the top and a handle. x is the face's distance from the centre line.
export function sidePanel(P, x, s, z0, z1, y0, y1, { handle = true } = {}) {
  const xo = s * (x + 0.013), zc = (z0 + z1) / 2, yc = (y0 + y1) / 2, w = z1 - z0, h = y1 - y0;
  P.add('camo', box(0.022, h - 0.02, w - 0.02, xo, yc, zc), { tint: 0xe4e4e4 });
  P.add('dark', box(0.012, 0.014, w + 0.01, s * (x + 0.004), y0 - 0.005, zc));
  P.add('dark', box(0.012, 0.014, w + 0.01, s * (x + 0.004), y1 + 0.005, zc));
  P.add('dark', box(0.012, h + 0.02, 0.014, s * (x + 0.004), yc, z0 - 0.005));
  P.add('dark', box(0.012, h + 0.02, 0.014, s * (x + 0.004), yc, z1 + 0.005));
  for (const z of [z0 + 0.15, z1 - 0.15]) P.add('camo', zTube(z - 0.06, z + 0.06, 0.018, 0.018, 6, s * (x + 0.03), y1 - 0.03), { tint: 0xb0b0b0 });
  if (handle) {
    P.add('dark', box(0.03, 0.04, 0.12, s * (x + 0.035), yc, zc));
    P.add('camo', box(0.016, 0.06, 0.03, s * (x + 0.03), yc - 0.05, z0 + 0.1), { tint: 0xb0b0b0 });
  }
}

// Rear plate fittings: tail light clusters, tow hooks, a towing pintle, spare track links, a door.
export function addRear(P, C) {
  const ZR = C.rear, top = C.roof;
  for (const s of [-1, 1]) {
    P.add('dark', rb(0.24, 0.13, 0.08, 0.02, s * 1.28, top - 0.18, ZR + 0.04));
    P.add('red', box(0.08, 0.07, 0.01, s * 1.22, top - 0.18, ZR + 0.085));
    P.add('amber', box(0.06, 0.07, 0.01, s * 1.35, top - 0.18, ZR + 0.085));
    P.add('dark', box(0.16, 0.2, 0.12, s * 0.8, 1.0, ZR + 0.05));
    P.add('dark', rod(V(s * 0.8, 1.0, ZR + 0.1), V(s * 0.8, 0.92, ZR + 0.22), 0.035, 6));
    P.add('dark', rod(V(s * 0.8, 0.92, ZR + 0.22), V(s * 0.8, 1.05, ZR + 0.25), 0.03, 6));
    for (let i = 0; i < 3; i++) P.add('dark', box(0.48, 0.03, 0.14, s * 0.75, 1.35 + i * 0.16, ZR + 0.02, -1.45));
  }
  P.add('dark', box(0.26, 0.12, 0.16, 0, 0.96, ZR + 0.06)); // pintle
  P.add('steel', zTube(ZR + 0.14, ZR + 0.24, 0.045, 0.045, 8, 0, 0.96));
  P.add('camo', box(1.1, 0.55, 0.025, 0, top - 0.5, ZR + 0.012), { tint: 0xdcdcdc }); // engine access door
  for (const x of [-0.45, 0.45]) P.add('dark', zTube(ZR, ZR + 0.04, 0.025, 0.025, 6, x, top - 0.25));
  P.add('dark', box(0.22, 0.03, 0.04, 0, top - 0.62, ZR + 0.04));
}

// Lower nose plate fittings: tow hooks at the corners, lifting eyes along the bottom. Returns the
// plate's tilt (rx) for anything else laid on it.
export function addNoseFittings(P, C, yNose = 1.22) {
  const rx = -Math.atan(0.83); // the plate leans back 40 degrees from vertical
  for (const s of [-1, 1]) {
    const y = 0.68, z = plateZ(C, y, yNose) - 0.03;
    P.add('dark', box(0.18, 0.22, 0.1, s * 0.92, y, z + 0.02, rx));
    P.add('dark', rod(V(s * 0.92, y - 0.04, z - 0.04), V(s * 0.92, y - 0.16, z - 0.16), 0.035, 6));
    P.add('dark', rod(V(s * 0.92, y - 0.16, z - 0.16), V(s * 0.92, y - 0.03, z - 0.22), 0.03, 6));
  }
  for (const x of [-0.52, 0, 0.52]) {
    const y = 0.6, z = plateZ(C, y, yNose) - 0.02;
    P.add('dark', new THREE.TorusGeometry(0.055, 0.014, 5, 10, Math.PI).applyMatrix4(xf(x, y + 0.01, z - 0.01, rx)));
    P.add('dark', box(0.16, 0.035, 0.035, x, y, z));
  }
  return rx;
}
