import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { V, box, rbox, yTube, zTube, xTube, rod, sideProfile, loft, lathe, xf, plane, scaleUV } from '../kit.js';

// GM-569 family tracked chassis (Mytishchi "Object 569"), as carried by the Buk-M2: the 9A317
// TELAR on the GM-569 and the 9A316 loader-launcher on the longer GM-577. A low slab-sided hull:
// the crew compartment at the front under a sloped glacis with the two oval hatches, the engine at
// the rear under a slightly lower deck with three grille panels, sloped aprons with a rubber skirt
// over the tracks. Running gear: idler at the front, six dual rubber-tyred road wheels, the drive
// sprocket at the rear, the top run on small return rollers hidden behind the aprons.
// Measured off refs/buk (m2-telar-captured-prague-02 pure left side, scaled to the 3.8 m height;
// m2-telar-9a317-parade-rehearsal-kuzmin for the right side; m2-telar-maks2007 and
// m2-telar-captured-prague-04 for the front; m1-telar-9a310-kuzmin for the rear). The road wheel
// gaps grow toward the front in every side photo, so the spacing is not even.
// Model space: front -Z, right +X, ground y = 0. Shared with bukradar.js (read only there).
//
// Scale. The numbers below are in "photo units": the side photos measured with the hull at the
// published 9.3 m. Camera-matched to m2-telar-9a317-moscow2015, the 9M317 rounds on the launcher then
// read 6.5 m long and 0.44 m across, 17% more than their published 5.55 m; ru Wikipedia's 4.65 m
// base (first to last road wheel) for the family says the same (5.53 m here). So the vehicles are
// built at GM_SCALE: lengths and heights x 0.85 (hull 7.8 m, base 4.7 m, turret roof 3.4 m, rails
// 3.85 m, close to the published 3.8 m height); widths are kept at the published 3.25 m (the rail
// loading gauge; a top-photo fit with free width also prefers it). The 9.3 m is then taken as an
// overall length (unconfirmed). Apply it with scaleParts() after building in photo units.
export const GM_SCALE = { x: 1, y: 0.85, z: 0.85 };
export function scaleParts(Pa, K = GM_SCALE) {
  const m = new THREE.Matrix4().makeScale(K.x, K.y, K.z);
  for (const list of Pa.lists.values()) for (const g of list) { g.applyMatrix4(m); g.computeVertexNormals(); }
  return Pa;
}

export const GM569 = {
  zf: -4.6, zr: 4.62, // hull nose and rear plate (9.2 m)
  deck: 2.45, deckRear: 2.34, step: 0.83, // forward deck, engine deck aft of z = step
  glacis: -3.62, // front edge of the deck, top of the glacis (prague-02: about 48 deg)
  ledge: 1.8, // the ledge at the foot of the glacis, 0.25 m behind the nose (m2-telar-9a317 side: nose top 1.83)
  cornerTop: 2.24, // the boxes either side of the glacis (side photo: the side's top line drops to 2.24 ahead of z -3.6)
  W: 1.3, // half width of the upper hull
  apron: 1.625, // half width over the aprons (3.25 m)
  fender: 1.42, sponson: 1.3, belly: 0.45, lowerW: 1.08,
  gauge: 1.37, trackW: 0.5,
  wheels: [-2.93, -1.7, -0.52, 0.62, 1.62, 2.6], wheelR: 0.385, wheelY: 0.47,
  idler: [-3.86, 0.86, 0.3], sprocket: [3.6, 0.88, 0.33], // z, y, radius at the track's inner face
  rollers: [-2.35, -0.05, 2.15], rollerY: 1.08,
  ring: -0.88, // turret ring centre
  intake: [1.25, 3.18], // mesh air intake low on the left side
  // lockers on the hull sides, [z0, z1, y0, y1]: right side from the parade photo, left from Prague
  lockersR: [[3.45, 4.15, 1.6, 2.18], [1.9, 2.9, 1.5, 2.2], [1.02, 1.55, 1.55, 2.15], [-0.27, 0.98, 1.5, 2.25], [-1.52, -0.5, 1.5, 2.25], [-3.25, -1.8, 1.5, 2.25], [-3.95, -3.35, 1.55, 2.05]],
  lockersL: [[-3.5, -2.95, 1.55, 2.2], [-2.92, -2.05, 1.5, 2.25], [-2.0, -1.6, 1.55, 2.25], [-1.55, -0.32, 1.5, 2.25], [-0.28, 0.6, 1.85, 2.25], [-0.28, 0.6, 1.5, 1.8], [1.25, 3.18, 1.8, 2.15], [3.3, 4.4, 1.5, 2.15]],
};

// GM-577 (9A316 loader-launcher): the same family stretched to 9.96 m
export const GM577 = {
  ...GM569,
  zf: -4.98, zr: 4.98, glacis: -4.0, step: 1.15,
  wheels: [-3.2, -1.86, -0.6, 0.66, 1.76, 2.86],
  idler: [-4.22, 0.86, 0.3], sprocket: [3.96, 0.88, 0.33],
  rollers: [-2.55, -0.0, 2.35],
  ring: -0.75,
  intake: [1.6, 3.55],
  lockersR: [[3.8, 4.5, 1.6, 2.18], [2.25, 3.25, 1.5, 2.2], [1.3, 1.85, 1.55, 2.15], [-0.05, 1.2, 1.5, 2.25], [-1.25, -0.15, 1.5, 2.25], [-2.45, -1.35, 1.5, 2.25], [-3.3, -2.55, 1.5, 2.25], [-4.3, -3.75, 1.55, 2.05]],
  lockersL: [[-3.85, -3.3, 1.55, 2.2], [-3.25, -2.3, 1.5, 2.25], [-2.25, -1.8, 1.55, 2.25], [-1.75, -0.4, 1.5, 2.25], [-0.35, 0.55, 1.85, 2.25], [-0.35, 0.55, 1.5, 1.8], [1.6, 3.55, 1.8, 2.15], [3.7, 4.75, 1.5, 2.15]],
};

const nonIdx = (gs) => mergeGeometries(gs.map((g) => { const n = g.index ? g.toNonIndexed() : g; if (n.attributes.uv) n.deleteAttribute('uv'); return n; }));
const latheX = (pts, seg) => lathe(pts, seg).rotateZ(-Math.PI / 2); // profile [r, x], axis along +X

// glacis plane: u along the slope from the deck edge down, offset along its outward normal
export function glacisFrame(C) {
  const y0 = C.deck, z0 = C.glacis, y1 = C.ledge, z1 = C.zf + 0.25;
  const L = Math.hypot(y0 - y1, z0 - z1), dy = (y1 - y0) / L, dz = (z1 - z0) / L;
  const ny = -dz, nz = dy; // outward: up and forward
  const ang = -Math.atan2(y0 - y1, z0 - z1); // rx that lays a box's z axis along the slope
  return { L, ang, at: (u, off = 0) => [y0 + dy * u + ny * off, z0 + dz * u + nz * off] };
}

// ---------------------------------------------------------------- running gear

// Closed belt around circles given counterclockwise in (z, y): along the bottom from the front,
// up round the rear, back along the top, down round the front. Each pair is joined by its outer
// tangent.
function beltPath(circles) {
  const n = circles.length;
  const tang = (a, b) => { const dz = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dz, dy); return Math.atan2(dy, dz) - Math.acos((a[2] - b[2]) / L); };
  const leave = circles.map((c, i) => tang(c, circles[(i + 1) % n]));
  const pts = [];
  for (let i = 0; i < n; i++) {
    const [cz, cy, r] = circles[i];
    const a0 = leave[(i - 1 + n) % n];
    let a1 = leave[i];
    while (a1 < a0 - 1e-4) a1 += Math.PI * 2;
    const m = Math.max(1, Math.ceil((a1 - a0) / 0.1));
    for (let k = 0; k <= m; k++) { const a = a0 + (a1 - a0) * (k / m); pts.push([cz + Math.cos(a) * r, cy + Math.sin(a) * r]); }
  }
  return pts;
}

// One link (local x across, y outward from the inner face, z along the run): the shoe, a grouser
// bar, hinge knuckles, and the centre guide horn standing in from the inner face (the row of
// teeth seen on the top run under the aprons).
function linkGeometry(w, pitch) {
  return nonIdx([
    box(w, 0.035, pitch - 0.012, 0, 0.0175, 0),
    box(w - 0.06, 0.03, 0.045, 0, 0.05, 0.02),
    box(0.07, 0.11, 0.075, 0, -0.05, 0),
  ]);
}

function addTracks(P, C, pitch = 0.15) {
  const { wheels, wheelR: R, wheelY: Y, idler: I, sprocket: S, rollers, rollerY } = C;
  // bottom run front to rear, the sprocket, the top run over the rollers rear to front, the idler
  const circles = [...wheels.map((z) => [z, Y, R]), S, ...rollers.slice().reverse().map((z) => [z, rollerY, 0.105]), I];
  const pts = beltPath(circles);
  const n = pts.length, cum = [0];
  for (let i = 1; i <= n; i++) { const a = pts[i - 1], b = pts[i % n]; cum.push(cum[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1])); }
  const L = cum[n], N = Math.round(L / pitch), step = L / N;
  const link = linkGeometry(C.trackW, step);
  const m = new THREE.Matrix4(), X = V(1, 0, 0), Nv = V(0, 0, 0), T = V(0, 0, 0);
  let j = 0;
  for (let k = 0; k < N; k++) {
    const s = k * step;
    while (cum[j + 1] < s) j++;
    const a = pts[j], b = pts[(j + 1) % n], f = (s - cum[j]) / (cum[j + 1] - cum[j] || 1);
    const z = a[0] + (b[0] - a[0]) * f, y = a[1] + (b[1] - a[1]) * f;
    const tl = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, tz = (b[0] - a[0]) / tl, ty = (b[1] - a[1]) / tl;
    Nv.set(0, -tz, ty);
    T.set(0, -ty, -tz);
    m.makeBasis(X, Nv, T);
    for (const sx of [-1, 1]) {
      m.setPosition(sx * C.gauge, y, z);
      P.add('dark', link.clone().applyMatrix4(m));
    }
  }
}

// Dual road wheel about +X centred on the track line: two rubber-tyred pressed discs with the gap
// for the guide horns between them; the outer one has the dished face, hub cap and bolt ring.
function roadWheel(R) {
  const h = 0.065, tyre = [], disc = [];
  for (const c of [-0.105, 0.105]) {
    tyre.push(latheX([[R - 0.075, c - h], [R - 0.01, c - h], [R, c - h + 0.02], [R, c + h - 0.02], [R - 0.01, c + h], [R - 0.075, c + h]], 20));
  }
  disc.push(latheX([[R - 0.075, 0.105 + h], [R - 0.09, 0.105 + h + 0.012], [0.2, 0.105 + h + 0.03], [0.13, 0.105 + h + 0.065], [0.1, 0.105 + h + 0.08], [0.06, 0.105 + h + 0.1], [0.001, 0.105 + h + 0.105]], 20));
  disc.push(latheX([[0.001, -0.105 - h - 0.02], [R - 0.075, -0.105 - h]], 16));
  disc.push(xTube(-0.04, 0.04, R - 0.08, R - 0.08, 18)); // hub drum in the gap
  for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; disc.push(xTube(0.105 + h + 0.03, 0.105 + h + 0.058, 0.015, 0.015, 5, Math.cos(a) * 0.165, Math.sin(a) * 0.165)); }
  return { tyre: nonIdx(tyre), disc: nonIdx(disc) };
}

// Toothed sprocket ring extruded along X
function sprocketRing(rRoot, rTip, t, teeth = 13) {
  const s = new THREE.Shape(), pts = [];
  for (let i = 0; i < teeth; i++) {
    const a = (i / teeth) * Math.PI * 2, w = Math.PI / teeth;
    for (const [r, b] of [[rRoot, a - w * 0.6], [rTip, a - w * 0.25], [rTip, a + w * 0.25], [rRoot, a + w * 0.6]]) pts.push(new THREE.Vector2(Math.cos(b) * r, Math.sin(b) * r));
  }
  s.setFromPoints(pts);
  for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2 + 0.3, hpath = new THREE.Path(); hpath.absarc(Math.cos(a) * rRoot * 0.62, Math.sin(a) * rRoot * 0.62, rRoot * 0.16, 0, Math.PI * 2, true); s.holes.push(hpath); }
  const g = new THREE.ExtrudeGeometry(s, { depth: t, bevelEnabled: false, curveSegments: 6 });
  g.translate(0, 0, -t / 2);
  return g.rotateY(Math.PI / 2);
}

function spokedDisc(r, t, holes = 6) {
  const s = new THREE.Shape();
  s.absarc(0, 0, r, 0, Math.PI * 2, false);
  for (let i = 0; i < holes; i++) { const a = (i / holes) * Math.PI * 2, hp = new THREE.Path(); hp.absarc(Math.cos(a) * r * 0.58, Math.sin(a) * r * 0.58, r * 0.22, 0, Math.PI * 2, true); s.holes.push(hp); }
  const g = new THREE.ExtrudeGeometry(s, { depth: t, bevelEnabled: false, curveSegments: 8 });
  g.translate(0, 0, -t / 2);
  return g.rotateY(Math.PI / 2);
}

export function addRunningGear(P, C) {
  const { wheels, wheelR: R, wheelY: Y, gauge: G } = C;
  const [sz, sy, sr] = C.sprocket, [iz, iy, ir] = C.idler;
  const rw = roadWheel(R);
  const spr = sprocketRing(sr - 0.02, sr + 0.07, 0.04), idl = spokedDisc(ir - 0.02, 0.04);
  for (const s of [-1, 1]) {
    const flip = s < 0 ? Math.PI : 0; // the left wheels face -X
    for (const z of wheels) {
      const m = xf(s * G, Y, z, 0, flip, 0);
      P.add('rubber', rw.tyre.clone().applyMatrix4(m));
      P.add('rim', rw.disc.clone().applyMatrix4(m));
      // trailing arm from the hull to the hub, its pivot boss on the lower hull
      P.add('dark', rod(V(s * C.lowerW, Y + 0.24, z - 0.42), V(s * (G - 0.2), Y, z), 0.05, 6));
      P.add('dark', xTube(s * (C.lowerW - 0.02), s * (C.lowerW + 0.1), 0.085, 0.085, 10, Y + 0.24, z - 0.42));
    }
    // return rollers under the top run
    for (const z of C.rollers) {
      for (const dx of [-0.105, 0.105]) P.add('rubber', xTube(s * G + dx - 0.05, s * G + dx + 0.05, 0.105, 0.105, 12, C.rollerY, z));
      P.add('dark', xTube(s * C.lowerW, s * G, 0.04, 0.04, 8, C.rollerY, z));
    }
    // rear drive sprocket: two toothed rings either side of the guide horns, the hub and final drive
    for (const dx of [-0.11, 0.11]) P.add('rim', spr.clone().applyMatrix4(xf(s * G + dx, sy, sz, 0.1 * s)));
    P.add('rim', xTube(s * (G - 0.13), s * (G + 0.13), sr - 0.08, sr - 0.08, 20, sy, sz));
    P.add('rim', xTube(s * (G + 0.13), s * (G + 0.18), 0.13, 0.1, 14, sy, sz));
    for (let i = 0; i < 10; i++) { const a = (i / 10) * Math.PI * 2; P.add('steel', xTube(s * (G + 0.13), s * (G + 0.16), 0.016, 0.016, 6, sy + Math.cos(a) * 0.17, sz + Math.sin(a) * 0.17)); }
    P.add('dark', xTube(s * C.lowerW, s * (G - 0.13), 0.15, 0.15, 12, sy, sz));
    // front idler: twin spoked discs on a crank
    for (const dx of [-0.1, 0.1]) P.add('rim', idl.clone().applyMatrix4(xf(s * G + dx, iy, iz)));
    P.add('rim', xTube(s * (G - 0.08), s * (G + 0.08), ir - 0.03, ir - 0.03, 22, iy, iz, true));
    P.add('rim', xTube(s * (G + 0.1), s * (G + 0.15), 0.08, 0.06, 12, iy, iz));
    P.add('dark', rod(V(s * C.lowerW, iy + 0.12, iz + 0.32), V(s * (G - 0.08), iy, iz), 0.055, 6));
  }
  addTracks(P, C);
}

// ---------------------------------------------------------------- hull

// a stowage locker on a hull side: a door standing proud of the side with a hinge strip, a
// handle and two latches (side = +1 for the right)
function locker(P, C, side, z0, z1, y0, y1) {
  const x = side * (C.W + 0.018), zc = (z0 + z1) / 2, yc = (y0 + y1) / 2;
  P.add('camo', rbox(0.035, y1 - y0, z1 - z0, 0.012, x, yc, zc));
  P.add('dark', box(0.03, 0.035, z1 - z0 - 0.1, x + side * 0.012, y1 - 0.03, zc)); // hinge
  P.add('dark', box(0.03, 0.05, 0.13, x + side * 0.02, yc + 0.02, z1 - 0.18)); // handle
  for (const zz of [z0 + 0.08, z1 - 0.08]) P.add('dark', box(0.03, 0.06, 0.05, x + side * 0.01, y0 + 0.05, zz)); // latches
}

// Mesh air intake, a recessed frame with a perforated screen (the kit's lattice texture tinted)
function meshIntake(P, C, side, z0, z1, y0, y1) {
  const x = side * C.W, len = z1 - z0, h = y1 - y0, zc = (z0 + z1) / 2, yc = (y0 + y1) / 2;
  P.add('dark', box(0.02, h, len, x - side * 0.05, yc, zc));
  const g = plane(len, h, x + side * 0.004, yc, zc, 0, side * Math.PI / 2, 0);
  scaleUV(g, len / 0.22, h / 0.22);
  P.add('array', g, { tint: new THREE.Color(1.5, 1.6, 1.3) });
  for (const y of [y0 - 0.02, y1 + 0.02]) P.add('camo', box(0.05, 0.04, len + 0.08, x + side * 0.01, y, zc));
  for (const z of [z0 - 0.02, z1 + 0.02]) P.add('camo', box(0.05, h + 0.08, 0.04, x + side * 0.01, yc, z));
}

// Raised engine deck grille box: louvred sides, a perforated top panel in a frame (the three
// stepped boxes across the rear deck in moscow2015; their backs read as the rear corner boxes
// in m1-telar-9a310-kuzmin)
function deckGrille(P, x0, x1, z0, z1, y, h = 0.1) {
  const w = x1 - x0, d = z1 - z0, xc = (x0 + x1) / 2, zc = (z0 + z1) / 2;
  P.add('camo', rbox(w, h, d, 0.02, xc, y + h / 2, zc));
  const g = plane(w - 0.16, d - 0.16, xc, y + h + 0.003, zc, -Math.PI / 2, 0, 0);
  scaleUV(g, (w - 0.16) / 0.2, (d - 0.16) / 0.2);
  P.add('array', g, { tint: new THREE.Color(1.7, 1.8, 1.45) });
  P.add('dark', box(0.04, 0.03, 0.12, xc, y + h + 0.01, z0 + 0.12)); // lifting handle
  for (let i = 0; i < 3; i++) P.add('dark', box(w - 0.14, 0.025, 0.03, xc, y + 0.05 + (i * (h - 0.09)) / 2, z1 + 0.005)); // slats on its back
}

export function addHull(P, C) {
  const { W, deck, deckRear: dr, step, zf, zr, sponson: YS, fender: F } = C;
  const ring = (z, t, w = W, yb = YS) => { const c = Math.min(0.08, (t - yb) * 0.4); return [V(-w, yb, z), V(w, yb, z), V(w, t - c, z), V(w - c * 0.6, t, z), V(-(w - c * 0.6), t, z), V(-w, t - c, z)]; };
  // upper hull: the nose, the glacis with its corners cut back, the forward deck; then the engine deck
  // (the nose: a short plate leaning back to the ledge, then the steep glacis with the hatches)
  P.add('camo', loft([ring(zf, C.ledge - 0.3, W - 0.1, YS + 0.04), ring(zf + 0.12, C.ledge - 0.03, W - 0.06), ring(zf + 0.25, C.ledge, W - 0.04), ring(C.glacis, deck), ring(step, deck)]));
  P.add('camo', loft([ring(step, dr), ring(zr, dr)]));
  // the hull sides between the tracks and the lower nose and tail
  P.add('camo', sideProfile([[zf + 0.02, C.ledge - 0.3], [zf + 0.07, 1.0], [zf + 0.38, 0.58], [zf + 0.7, C.belly], [zr - 0.6, C.belly], [zr - 0.12, 0.92], [zr, 1.32], [zr, YS + 0.05], [zf + 0.2, YS + 0.05]], C.lowerW * 2));
  for (const s of [-1, 1]) P.add('camo', box(0.01, YS - 0.55, zr - zf - 1.4, s * (C.lowerW + 0.003), (YS + 0.55) / 2, (zf + zr) / 2), { tint: 0x5a5a5a }); // in the shadow of the sponson
  P.add('dark', box(C.lowerW * 2 - 0.1, 0.03, zr - zf - 1.3, 0, C.belly - 0.01, (zf + zr) / 2));
  // sponson floor over the tracks
  for (const s of [-1, 1]) P.add('dark', box(W - C.lowerW, 0.03, zr - zf - 0.3, s * (W + C.lowerW) / 2, YS, (zf + zr) / 2 + 0.1));

  // ---- aprons: a sloped plate along the top of each track, rubber skirt hanging off its edge
  const ap = C.apron, aw = ap - W + 0.02, slope = Math.atan2(0.09, aw);
  for (const s of [-1, 1]) {
    const len = zr - zf - 0.32, zc = (zf + zr) / 2 + 0.06;
    P.add('camo', box(aw, 0.03, len, s * (W + aw / 2 - 0.01), F - 0.035, zc, 0, 0, -s * slope));
    P.add('camo', box(0.03, 0.07, len, s * (ap - 0.01), F - 0.1, zc), { tint: 0x8a8a8a }); // turned-down edge
    P.add('rubber', box(0.025, 0.22, len - 0.1, s * (ap - 0.02), F - 0.23, zc));
    // front end of the apron curving down over the idler to the mud flap
    P.add('camo', box(aw, 0.03, 0.3, s * (W + aw / 2 - 0.01), F - 0.12, zf + 0.2, -0.55, 0, -s * slope));
    P.add('rubber', box(0.42, 0.5, 0.03, s * (ap - 0.21), F - 0.38, zf + 0.04, 0.1));
    // the side plate runs down at the rear corner over the sprocket
    P.add('camo', sideProfile([[zr - 0.95, F], [zr, F], [zr, 1.22], [zr - 0.55, 1.22]], 0.03).applyMatrix4(xf(s * (W - 0.005), 0, 0)));
  }

  // ---- hull sides: lockers, the mesh intake on the left, tie-down rails, side lamp
  for (const [z0, z1, y0, y1] of C.lockersR) locker(P, C, 1, z0, z1, y0, y1);
  for (const [z0, z1, y0, y1] of C.lockersL) locker(P, C, -1, z0, z1, y0, y1);
  meshIntake(P, C, -1, C.intake[0], C.intake[1], F + 0.07, F + 0.29);
  for (const s of [-1, 1]) {
    P.add('dark', box(0.04, 0.04, zr - zf - 1.2, s * (W + 0.02), F + 0.04, (zf + zr) / 2 + 0.2)); // ledge above the apron
    for (let z = zf + 1.0; z < zr - 0.4; z += 0.55) P.add('dark', box(0.05, 0.04, 0.05, s * (W + 0.03), F + 0.06, z)); // brackets
    P.add('dark', box(0.05, 0.06, 0.1, s * (W + 0.03), deck - 0.15, zf + 1.25));
    P.add('amber', box(0.01, 0.04, 0.07, s * (W + 0.056), deck - 0.15, zf + 1.25));
  }

  // ---- front: glacis with the driver's and commander's hatches, vision blocks, lamps, the air
  // intake cap on the right corner, lower plate with tow shackles, ladder, cable, mud flaps
  const gf = glacisFrame(C);
  for (const x of [-0.36, 0.36]) {
    const [y, z] = gf.at(gf.L * 0.5, 0.02);
    P.add('camo', rbox(0.62, 0.1, 0.62, 0.05, x, y, z, gf.ang));
    const [y2, z2] = gf.at(gf.L * 0.5, 0.075);
    P.add('camo', rbox(0.44, 0.05, 0.44, 0.025, x, y2, z2, gf.ang), { tint: 0xd8d8d8 }); // pressed bulge
    const [yh, zh] = gf.at(0.12, 0.03);
    P.add('dark', xTube(x - 0.22, x + 0.22, 0.03, 0.03, 8, yh, zh)); // hinge
    P.add('glass', box(0.16, 0.06, 0.03, x, deck - 0.03, C.glacis - 0.05)); // vision block in the deck edge
    P.add('dark', box(0.22, 0.09, 0.08, x, deck - 0.01, C.glacis - 0.01));
  }
  P.add('dark', box(0.04, 0.04, gf.L, 0, ...gf.at(gf.L / 2, 0.01), gf.ang)); // seam between the hatches
  // corner boxes either side of the hatches on the ledge: the right one carries the round air
  // intake cap, the left one the headlamp pair (m2-telar-maks2007, m1-...-museum)
  // (the side photo puts the boxes' tops at 2.24, the cap from 2.0 to 2.32, both 0.35 m inside the
  // nose; seen from the side they make the hull's top line drop ahead of the glacis)
  const zb = zf + 0.38, ct = C.cornerTop, bl = C.glacis - zf;
  for (const s of [-1, 1]) P.add('camo', rbox(0.5, ct - C.ledge + 0.3, bl, 0.03, s * (W - 0.25), (ct + C.ledge - 0.3) / 2, zf + bl / 2));
  P.add('camo', yTube(ct - 0.05, ct + 0.08, 0.16, 0.16, 18, 1.0, zb));
  P.add('camo', yTube(ct + 0.08, ct + 0.13, 0.18, 0.18, 18, 1.0, zb));
  P.add('dark', yTube(ct, ct + 0.04, 0.165, 0.165, 18, 1.0, zb));
  const lamp = (x, y, z, r = 0.075) => {
    P.add('dark', zTube(z + 0.05, z - 0.08, r + 0.01, r + 0.015, 14, x, y));
    P.add('lens', zTube(z - 0.08, z - 0.09, r, r, 14, x, y));
    P.add('dark', box(0.04, 0.12, 0.06, x, y - 0.12, z + 0.02));
  };
  lamp(0.9, ct + 0.1, zf + 0.12);
  lamp(-0.88, ct + 0.1, zf + 0.12);
  lamp(-1.1, ct + 0.1, zf + 0.12, 0.06);
  P.add('dark', box(0.08, 0.05, 0.06, -1.18, ct + 0.06, zf + 0.12));
  P.add('amber', box(0.06, 0.035, 0.01, -1.18, ct + 0.06, zf + 0.085));
  // a ledge at the foot of the glacis, the lower plate's shackles, tow hooks, ladder
  P.add('camo', box(2.3, 0.05, 0.2, 0, C.ledge, zf + 0.17));
  for (const x of [-0.75, -0.25, 0.25, 0.75]) {
    P.add('dark', box(0.12, 0.08, 0.1, x, 1.24, zf - 0.02));
    P.add('dark', new THREE.TorusGeometry(0.07, 0.022, 6, 12, Math.PI).applyMatrix4(xf(x, 1.2, zf - 0.08, 0, 0, Math.PI)));
  }
  for (const s of [-1, 1]) {
    P.add('dark', rbox(0.16, 0.22, 0.16, 0.03, s * 0.95, 1.05, zf + 0.0));
    P.add('dark', new THREE.TorusGeometry(0.1, 0.03, 6, 12).applyMatrix4(xf(s * 0.95, 0.9, zf - 0.08)));
  }
  for (const s of [-1, 1]) P.add('steel', box(0.03, 0.62, 0.03, -0.12 + s * 0.13, 0.98, zf - 0.07, -0.08));
  for (let i = 0; i < 4; i++) P.add('steel', box(0.26, 0.025, 0.03, -0.12, 0.74 + i * 0.15, zf - 0.07 - (3 - i) * 0.012));
  // tow cable slung across the front, looped back along the right side
  const cable = new THREE.CatmullRomCurve3([V(-1.05, 1.45, zf + 0.12), V(-0.7, 1.32, zf - 0.04), V(0, 1.3, zf - 0.08), V(0.6, 1.36, zf - 0.06), V(1.1, 1.45, zf + 0.1), V(1.31, 1.62, zf + 0.6), V(1.33, 1.65, zf + 1.6)]);
  P.add('steel', new THREE.TubeGeometry(cable, 40, 0.018, 5, false));

  // ---- deck: turret ring, the engine deck grilles and access plates
  P.add('dark', yTube(deck - 0.02, deck + 0.06, 1.12, 1.12, 32, 0, C.ring));
  P.add('camo', yTube(deck - 0.02, deck + 0.015, 1.24, 1.24, 32, 0, C.ring));
  const g0 = zr - 1.3;
  // three perforated plates across the rear deck, the middle one the widest (moscow2015 top)
  deckGrille(P, -1.22, -0.62, g0 + 0.2, zr - 0.05, dr, 0.08);
  deckGrille(P, -0.58, 0.58, g0 - 0.3, zr - 0.05, dr, 0.12);
  deckGrille(P, 0.62, 1.22, g0 + 0.2, zr - 0.05, dr, 0.08);
  P.add('camo', rbox(2.3, 0.05, g0 - step - 0.3, 0.02, 0, dr + 0.02, (step + g0) / 2), { tint: 0xd0d0d0 });
  P.add('camo', yTube(dr, dr + 0.32, 0.12, 0.12, 14, 0.95, step + 0.5)); // exhaust stub
  P.add('dark', yTube(dr + 0.3, dr + 0.33, 0.13, 0.13, 14, 0.95, step + 0.5));
  for (const s of [-1, 1]) P.add('dark', box(0.06, 0.06, zr - step - 0.4, s * (W - 0.1), dr + 0.03, (step + zr) / 2));

  // ---- rear plate: lockers, a ladder, tow shackles, lamps, the exhaust port
  // (the outer two are deep boxes standing out from the plate, m1-telar-9a310-kuzmin)
  for (const x of [-0.85, 0, 0.85]) {
    const d = x ? 0.1 : 0.035;
    P.add('camo', rbox(0.72, x ? 0.6 : 0.42, d, 0.015, x, x ? 1.95 : 1.82, zr + d / 2));
    P.add('dark', box(0.62, 0.03, 0.03, x, x ? 2.22 : 2.05, zr + d + 0.005));
    P.add('dark', box(0.13, 0.05, 0.03, x, 1.9, zr + d + 0.01));
  }
  for (const s of [-1, 1]) {
    P.add('dark', box(0.14, 0.12, 0.12, s * 1.05, 1.45, zr + 0.05));
    P.add('dark', new THREE.TorusGeometry(0.09, 0.028, 6, 12).applyMatrix4(xf(s * 1.05, 1.3, zr + 0.1)));
    P.add('dark', rbox(0.18, 0.1, 0.06, 0.02, s * 1.12, 2.31, zr + 0.03));
    P.add('red', box(0.06, 0.05, 0.01, s * 1.08, 2.31, zr + 0.065));
    P.add('amber', box(0.05, 0.05, 0.01, s * 1.17, 2.31, zr + 0.065));
    P.add('dark', new THREE.TorusGeometry(0.09, 0.025, 6, 12, Math.PI).applyMatrix4(xf(s * 0.55, dr + 0.02, zr - 0.05, Math.PI / 2, 0, 0)));
  }
  for (const s of [-1, 1]) P.add('steel', box(0.03, 0.55, 0.03, 0.42 + s * 0.12, 1.25, zr + 0.06));
  for (let i = 0; i < 3; i++) P.add('steel', box(0.24, 0.025, 0.03, 0.42, 1.05 + i * 0.17, zr + 0.06));
  P.add('dark', zTube(zr, zr + 0.06, 0.12, 0.12, 14, -0.45, 1.35));
  P.add('dark', box(2.2, 0.05, 0.05, 0, C.sponson + 0.05, zr + 0.02));
}

// The travel lock (in its group's space, hinged at the origin), in two parts: the lower tube with
// its hinge, and the upper part (a rod with the jaw that takes the launcher's tail end at height h)
// that telescopes down into it, so the lock can fold flat along the front ledge in action.
export function addTravelLock(P, h) {
  P.add('dark', box(0.3, 0.1, 0.16, 0, 0, 0));
  P.add('dark', xTube(-0.14, 0.14, 0.05, 0.05, 10, 0, 0));
  const t = Math.min(1.05, h - 0.35);
  P.add('camo', yTube(0.04, t, 0.075, 0.075, 10, 0, 0));
  P.add('camo', yTube(t - 0.05, t + 0.03, 0.085, 0.085, 10, 0, 0)); // collar
}
export function addTravelLockTop(P, h) {
  P.add('camo', yTube(0.25, h - 0.25, 0.05, 0.05, 10, 0, 0));
  P.add('camo', rbox(0.16, 0.26, 0.16, 0.03, 0, h - 0.17, 0));
  for (const s of [-1, 1]) P.add('dark', box(0.04, 0.16, 0.14, s * 0.07, h - 0.02, 0));
}

// Chassis in one go: hull and running gear.
export function addChassis(P, C) {
  addHull(P, C);
  addRunningGear(P, C);
}
