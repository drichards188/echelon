import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { V, box, rbox, yTube, zTube, xTube, rod, sideProfile, loft, lathe, xf } from '../kit.js';

// MT-LB tracked chassis in its 9A35M3 (Strela-10M3) build: the low boat hull with the long shallow
// glacis and folded trim vane, the driver's and commander's cupolas, the big rear doors, and the
// running gear (front sprocket, six road wheels, rear idler, 0.35 m track with every link modelled).
// Measured off the reference side, front and rear photos scaled to the 6.45 m hull. Model space:
// front -Z, right +X, ground y = 0.

export const MTLB = {
  W: 1.425, // half width over the upper hull and the outer track edges (2.85)
  roof: 1.76,
  sponson: 1.1, // underside of the upper hull where it overhangs the tracks
  front: -3.25,
  rear: 3.12,
  gauge: 1.25, // track centre line
  wheels: [1.9, 1.15, 0.36, -0.44, -1.25, -2.05], // road wheel centres, rear to front
  wheelR: 0.34,
  wheelY: 0.405,
  sprocket: [-2.83, 0.75, 0.29], // z, y, radius at the track's inner face
  idler: [2.67, 0.58, 0.27],
};

const nonIdx = (gs) => mergeGeometries(gs.map((g) => { const n = g.index ? g.toNonIndexed() : g; if (n.attributes.uv) n.deleteAttribute('uv'); return n; }));

// Upper hull height at z along the roof, cab front and glacis
const roofAt = (z) => {
  if (z >= -2.02) return MTLB.roof;
  if (z >= -2.21) return MTLB.roof - (-2.02 - z) / 0.19 * 0.2;
  return 1.56 - (-2.21 - z) / 0.97 * 0.15;
};
const glacisSlope = Math.atan2(0.15, 0.97);

// ---------------------------------------------------------------- track

// Closed path of the track's inner face in (z, y), counterclockwise seen from the right: around the
// front of the sprocket, under the road wheels, round the idler, and back along a top run that sags
// onto the wheel tops (no return rollers on the MT-LB).
function trackPath() {
  const { wheels, wheelR: R, wheelY: Y } = MTLB;
  const [sz, sy, sr] = MTLB.sprocket, [iz, iy, ir] = MTLB.idler;
  const wF = wheels[wheels.length - 1], wR = wheels[0];
  // outward normal angle of the external tangent from circle 1 to circle 2 (both wrapped CCW)
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
  const aTop = tan(wF, Y, R, sz, sy, sr); // leaving the front wheel's top for the sprocket
  const aSB = tan(sz, sy, sr, wF, Y, R); // sprocket bottom to front wheel bottom
  const aWI = tan(wR, Y, R, iz, iy, ir); // rear wheel bottom to idler
  const aIT = tan(iz, iy, ir, wR, Y, R); // idler top to rear wheel top
  arc(sz, sy, sr, aTop, aSB);
  arc(wF, Y, R, aSB, -Math.PI / 2);
  arc(wR, Y, R, -Math.PI / 2, aWI);
  arc(iz, iy, ir, aWI, aIT);
  // top run: tangent off the idler, a sag between each pair of wheel tops, up to the sprocket
  let top = [[iz + Math.cos(aIT) * ir, iy + Math.sin(aIT) * ir]];
  top.push([wR + Math.cos(aIT) * R, Y + Math.sin(aIT) * R]);
  for (let k = 0; k < wheels.length; k++) {
    top.push([wheels[k], Y + R]);
    if (k < wheels.length - 1) top.push([(wheels[k] + wheels[k + 1]) / 2, Y + R - 0.018]);
  }
  top.push([wF + Math.cos(aTop) * R, Y + Math.sin(aTop) * R]);
  top.push([sz + Math.cos(aTop) * sr, sy + Math.sin(aTop) * sr]);
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

// One link: shoe plate nearly the full pitch long, two grouser rows standing out of it, hinge
// knuckles at the joint on the inside. Local: x across the track, y outward from the inner face,
// z along the run.
function linkGeometry(w) {
  const g = [box(w, 0.036, 0.1, 0, 0.018, 0)];
  for (const s of [-1, 1]) g.push(box(0.13, 0.034, 0.06, s * 0.09, 0.05, 0.01)); // grousers
  for (const s of [-1, 1]) g.push(box(0.07, 0.03, 0.035, s * 0.1, 0.0, 0.05)); // hinge knuckles
  return nonIdx(g);
}

export function addTracks(P, pitch = 0.112) {
  const pts = trackPath();
  const n = pts.length, cum = [0];
  for (let i = 1; i <= n; i++) { const a = pts[i - 1], b = pts[i % n]; cum.push(cum[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1])); }
  const L = cum[n], N = Math.round(L / pitch), step = L / N;
  const link = linkGeometry(0.35);
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
      m.setPosition(sx * MTLB.gauge, y, z);
      P.add('dark', link.clone().applyMatrix4(m));
    }
  }
  return N;
}

// ---------------------------------------------------------------- wheels

const latheX = (pts, seg) => lathe(pts, seg).rotateZ(-Math.PI / 2); // profile [r, x], axis along +X

// Road wheel about +X (outer face +X): rubber tyre, pressed disc with a rolled lip and twelve
// radial ribs, domed hub with bolts. Returns { tyre, disc }.
function roadWheel(R) {
  const tyre = latheX([[R - 0.055, -0.1], [R - 0.012, -0.1], [R - 0.002, -0.088], [R, -0.06], [R, 0.06], [R - 0.002, 0.088], [R - 0.012, 0.1], [R - 0.055, 0.1]], 22);
  const d = [latheX([[R - 0.05, 0.1], [R - 0.06, 0.118], [R - 0.08, 0.108], [0.17, 0.088], [0.125, 0.096], [0.1, 0.122], [0.085, 0.15], [0.05, 0.168], [0.0, 0.172]], 22)];
  d.push(latheX([[0, -0.1], [R - 0.05, -0.1]], 16));
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    d.push(box(0.022, 0.13, 0.026, 0.098, 0, 0).applyMatrix4(xf(0, Math.cos(a) * 0.19, Math.sin(a) * 0.19, a, 0, 0)));
  }
  for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; d.push(xTube(0.105, 0.128, 0.012, 0.012, 6, Math.cos(a) * 0.112, Math.sin(a) * 0.112)); }
  return { tyre, disc: nonIdx(d) };
}

// Toothed sprocket ring (13 teeth) with lightening holes, extruded along X
function sprocketRing(rRoot, rTip, t, teeth = 13) {
  const s = new THREE.Shape();
  const pts = [];
  for (let i = 0; i < teeth; i++) {
    const a = (i / teeth) * Math.PI * 2, w = Math.PI / teeth;
    for (const [r, b] of [[rRoot, a - w * 0.62], [rTip, a - w * 0.28], [rTip, a + w * 0.28], [rRoot, a + w * 0.62]]) pts.push(new THREE.Vector2(Math.cos(b) * r, Math.sin(b) * r));
  }
  s.setFromPoints(pts);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.3, h = new THREE.Path();
    h.absarc(Math.cos(a) * 0.165, Math.sin(a) * 0.165, 0.045, 0, Math.PI * 2, true);
    s.holes.push(h);
  }
  const g = new THREE.ExtrudeGeometry(s, { depth: t, bevelEnabled: false, curveSegments: 6 });
  g.translate(0, 0, -t / 2);
  return g.rotateY(Math.PI / 2); // shape (x, y) -> (z, y), extruded along x
}

function idlerDisc(r, t) {
  const s = new THREE.Shape();
  s.absarc(0, 0, r, 0, Math.PI * 2, false);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2, h = new THREE.Path();
    h.absarc(Math.cos(a) * r * 0.58, Math.sin(a) * r * 0.58, r * 0.2, 0, Math.PI * 2, true);
    s.holes.push(h);
  }
  const g = new THREE.ExtrudeGeometry(s, { depth: t, bevelEnabled: false, curveSegments: 8 });
  g.translate(0, 0, -t / 2);
  return g.rotateY(Math.PI / 2);
}

export function addRunningGear(P) {
  const { wheels, wheelR: R, wheelY: Y, gauge: G } = MTLB;
  const [sz, sy] = MTLB.sprocket, [iz, iy, ir] = MTLB.idler;
  const rw = roadWheel(R);
  const spr = sprocketRing(0.262, 0.33, 0.045), idl = idlerDisc(ir - 0.012, 0.035);
  for (const s of [-1, 1]) {
    const flip = s < 0 ? Math.PI : 0; // left side wheels face -X
    for (const z of wheels) {
      const m = xf(s * G, Y, z, 0, flip, 0);
      P.add('rubber', rw.tyre.clone().applyMatrix4(m));
      P.add('rim', rw.disc.clone().applyMatrix4(m));
      // trailing arm from the hull to the hub (torsion bar suspension)
      P.add('dark', rod(V(s * 1.0, 0.62, z - 0.32), V(s * (G - 0.1), Y, z), 0.045, 6));
      P.add('dark', xTube(s * 0.98, s * 1.08, 0.08, 0.08, 10, 0.62, z - 0.32));
    }
    // front drive sprocket: two toothed rings either side of the hub
    for (const dx of [-0.105, 0.105]) P.add('rim', spr.clone().applyMatrix4(xf(s * G + dx, sy, sz, 0.12 * s)));
    P.add('rim', xTube(s * (G - 0.13), s * (G + 0.13), 0.2, 0.2, 18, sy, sz));
    P.add('rim', xTube(s * (G + 0.13), s * (G + 0.17), 0.11, 0.085, 14, sy, sz));
    for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; P.add('steel', xTube(s * (G + 0.13), s * (G + 0.155), 0.014, 0.014, 6, sy + Math.cos(a) * 0.15, sz + Math.sin(a) * 0.15)); }
    P.add('dark', xTube(s * 1.0, s * (G - 0.13), 0.13, 0.13, 12, sy, sz)); // final drive housing
    // rear idler: twin spoked discs on a crank
    for (const dx of [-0.07, 0.07]) P.add('rim', idl.clone().applyMatrix4(xf(s * G + dx, iy, iz)));
    P.add('rim', xTube(s * (G - 0.05), s * (G + 0.05), ir - 0.005, ir - 0.005, 22, iy, iz, true));
    P.add('rim', xTube(s * (G + 0.07), s * (G + 0.12), 0.08, 0.06, 12, iy, iz));
    P.add('dark', rod(V(s * 1.0, 0.72, iz - 0.25), V(s * (G - 0.07), iy, iz), 0.05, 6));
  }
  return addTracks(P);
}

// ---------------------------------------------------------------- hull

// One rear door leaf (s = -1 left, +1 right): the plate reaching down over the lower hull, its pressed
// panel and the handle. With `hinge` it is built about its hinge line (x = s * 0.95, z = rear + 0.035;
// the hinge barrels stay on the hull), so a rig can swing it open on a pivot there (the left door
// opens with rotation.y going negative, the right one positive).
export const REAR_DOOR = { x: 0.95, z: MTLB.rear + 0.035 };
export function rearDoor(P, s, hinge = false) {
  const ZR = MTLB.rear, hx = hinge ? s * REAR_DOOR.x : 0, hz = hinge ? REAR_DOOR.z : 0;
  P.add('camo', rbox(0.9, 1.02, 0.04, 0.12, s * 0.47 - hx, 1.18, ZR + 0.01 - hz));
  P.add('camo', rbox(0.76, 0.86, 0.03, 0.1, s * 0.47 - hx, 1.18, ZR + 0.03 - hz), { tint: 0xd0d0d0 });
  P.add('dark', rod(V(s * 0.12 - hx, 1.22, ZR + 0.06 - hz), V(s * 0.3 - hx, 1.22, ZR + 0.06 - hz), 0.012, 5));
}

// `doors: false` leaves the rear door leaves out (the Strela builds them on pivots for its reload scene).
export function addHull(P, { doors = true } = {}) {
  const { W, roof, sponson: YS, rear: ZR } = MTLB;
  const CH = 0.22, CI = 0.115; // chamfer along the roof edge
  const ring = (z, t, yb = YS, w = W) => {
    const yc = Math.max(yb + 0.02, t - CH), ci = CI * (t - yc) / CH;
    return [V(-w, yb, z), V(w, yb, z), V(w, yc, z), V(w - ci, t, z), V(-(w - ci), t, z), V(-w, yc, z)];
  };
  // upper hull over the tracks: roof, cab front, shallow glacis and the nose, whose corners are cut
  // back at an angle over the sprockets (the headlights sit on those corner plates)
  P.add('camo', loft([ring(ZR, roof), ring(-2.02, roof), ring(-2.21, roofAt(-2.21)), ring(-2.6, roofAt(-2.6)), ring(-3.18, roofAt(-3.18), YS, 1.16), ring(-3.25, 1.37, 1.12, 1.1)]));
  // lower hull between the tracks with the steep lower nose plate
  P.add('camo', sideProfile([[-3.25, 1.14], [-2.62, 0.42], [2.86, 0.42], [ZR, 0.68], [ZR, 1.14]], 2.08));
  // the side between the tracks sits in the sponsons' shadow: a darker skin keeps it dark in any light
  for (const s of [-1, 1]) P.add('camo', box(0.01, 0.66, 5.5, s * 1.045, 0.77, 0.12), { tint: 0x4a4a4a });
  P.add('dark', box(1.9, 0.04, 5.4, 0, 0.41, 0.15)); // belly
  for (const s of [-1, 1]) P.add('camo', box(0.05, 0.05, 6.32, s * (W + 0.012), YS + 0.02, -0.06), { tint: 0xb0b0b0 }); // lip of the sponson

  // ---- front
  const gl = glacisSlope;
  // trim vane folded flat on the glacis, hinged at the nose
  P.add('camo', rbox(2.05, 0.04, 0.82, 0.02, 0, roofAt(-2.72) + 0.02, -2.72, -gl));
  P.add('camo', rbox(1.7, 0.03, 0.6, 0.02, 0, roofAt(-2.72) + 0.05, -2.74, -gl), { tint: 0xc8c8c8 });
  for (const x of [-0.8, 0, 0.8]) P.add('dark', xTube(x - 0.12, x + 0.12, 0.03, 0.03, 8, 1.4, -3.16));
  // towing lugs on the nose edge and hooks under it
  for (const x of [-0.78, -0.26, 0.26, 0.78]) P.add('dark', rbox(0.14, 0.08, 0.07, 0.02, x, 1.08, -3.24, -0.8));
  for (const s of [-1, 1]) {
    P.add('dark', rod(V(s * 0.72, 0.86, -3.03), V(s * 0.72, 0.8, -3.2), 0.035, 6));
    P.add('dark', box(0.06, 0.12, 0.06, s * 0.72, 0.76, -3.2));
  }
  // front mudguards over the sprockets
  for (const s of [-1, 1]) {
    P.add('camo', sideProfile([[-3.3, 1.12], [-2.98, 1.12], [-2.98, 1.08], [-3.22, 1.08], [-3.34, 0.96], [-3.34, 1.04]], 0.42).applyMatrix4(xf(s * 1.2, 0, 0)));
  }
  // cab: raised driver's (left) and commander's (right) cupolas, each with a big vision window in
  // its raked front and a round hatch on top
  const CY = 1.9;
  for (const s of [-1, 1]) {
    const x = s * 0.64;
    P.add('camo', sideProfile([[-2.25, 1.52], [-2.02, 1.74], [-1.24, 1.74], [-1.24, CY - 0.06], [-1.3, CY], [-2.08, CY]], 0.82, 0.02).applyMatrix4(xf(x, 0, 0)));
    P.add('glass', box(0.56, 0.012, 0.19, x, 1.758, -2.158, -1.15));
    P.add('dark', box(0.66, 0.03, 0.1, x, CY - 0.005, -2.12)); // brow over the window
    for (const e of [-1, 1]) P.add('dark', box(0.03, 0.03, 0.26, x + e * 0.31, 1.76, -2.16, -1.15)); // window frame
    P.add('camo', yTube(CY, CY + 0.06, 0.29, 0.28, 18, x, -1.66));
    P.add('camo', yTube(CY + 0.06, CY + 0.09, 0.25, 0.2, 18, x, -1.66));
    P.add('dark', xTube(x - 0.2, x + 0.2, 0.03, 0.03, 8, CY + 0.04, -1.34)); // hinge
  }
  P.add('glass', box(0.12, 0.07, 0.11, 0.64, CY + 0.13, -1.9, -0.3)); // commander's periscope
  P.add('dark', rbox(0.18, 0.11, 0.14, 0.02, 0.64, CY + 0.13, -1.84));
  // headlights in wire guards on the cut-back nose corners, side lights beside them
  for (const s of [-1, 1]) {
    const x = s * 1.25, y = 1.32, z = -2.99;
    P.add('dark', box(0.12, 0.1, 0.14, x, y - 0.05, z + 0.04));
    P.add('dark', zTube(z - 0.02, z - 0.16, 0.085, 0.1, 14, x, y));
    P.add('glass', zTube(z - 0.16, z - 0.17, 0.085, 0.085, 14, x, y));
    for (const a of [-0.7, 0, 0.7]) P.add('steel', rod(V(x + Math.sin(a) * 0.13, y + Math.cos(a) * 0.13, z - 0.02), V(x + Math.sin(a) * 0.13, y + Math.cos(a) * 0.13, z - 0.23), 0.008, 4));
    P.add('steel', rod(V(x - 0.13, y - 0.1, z - 0.23), V(x + 0.13, y - 0.1, z - 0.23), 0.008, 4));
    P.add('dark', box(0.07, 0.05, 0.06, s * 1.38, 1.3, -2.76));
    P.add('amber', box(0.05, 0.035, 0.01, s * 1.38, 1.3, -2.795));
  }
  // driver's searchlight on a post (left) and the rear-view mirror (right)
  P.add('dark', yTube(roof - 0.03, roof + 0.24, 0.025, 0.025, 6, -1.14, -2.0));
  P.add('dark', rbox(0.17, 0.15, 0.2, 0.03, -1.14, roof + 0.31, -2.02));
  P.add('glass', box(0.12, 0.1, 0.01, -1.14, roof + 0.31, -2.125));
  P.add('dark', rod(V(1.2, roof - 0.02, -2.0), V(1.36, roof + 0.36, -2.16), 0.012, 5));
  P.add('dark', rbox(0.06, 0.26, 0.2, 0.02, 1.37, roof + 0.44, -2.16, 0, 0.3));
  // antenna: tall whip on a mount at the right front corner, stub by the driver
  P.add('dark', box(0.08, 0.12, 0.1, 1.38, 1.5, -1.8));
  P.add('dark', yTube(1.42, 1.86, 0.045, 0.04, 10, 1.44, -1.8));
  P.add('dark', yTube(1.86, 2.0, 0.025, 0.02, 8, 1.44, -1.8));
  P.add('dark', yTube(2.0, 4.75, 0.011, 0.004, 5, 1.44, -1.8));
  P.add('dark', yTube(roof, roof + 0.45, 0.02, 0.01, 6, -1.12, -2.0));

  // ---- sides: tow cables with eyes, a round port cover, grab rail
  for (const s of [-1, 1]) {
    const x = s * (W + 0.03);
    const c = new THREE.CatmullRomCurve3([V(x, 1.34, 0.0), V(x, 1.42, 0.2), V(x, 1.47, -0.05), V(x, 1.4, -0.25), V(x, 1.35, -1.2), V(x, 1.36, -2.4), V(x, 1.3, -3.0)]);
    P.add('steel', new THREE.TubeGeometry(c, 60, 0.016, 5, false));
    for (const z of [-0.5, -1.5, -2.5]) P.add('dark', box(0.04, 0.06, 0.07, s * (W + 0.015), 1.37, z));
    P.add('camo', xTube(s * W, s * (W + 0.025), 0.12, 0.12, 16, 1.42, 1.15));
    P.add('dark', xTube(s * W, s * (W + 0.035), 0.03, 0.03, 8, 1.42, 1.15));
    P.add('dark', rod(V(s * (W + 0.03), 1.48, 0.8), V(s * (W + 0.03), 1.48, -0.6), 0.012, 5));
    for (const z of [0.8, -0.6]) P.add('dark', box(0.04, 0.04, 0.04, s * (W + 0.015), 1.48, z));
  }

  // ---- roof: deck handrails, troop compartment hatches, lifting eyes
  for (const s of [-1, 1]) {
    const x = s * 1.18, h = roof + 0.17;
    P.add('steel', rod(V(x, h, 0.2), V(x, h, 2.95), 0.016, 6));
    for (const z of [0.2, 1.1, 2.0, 2.95]) P.add('steel', rod(V(x, roof, z), V(x, h, z), 0.014, 5));
    // rear corner rails rising and bending inboard (photo 04)
    P.add('steel', rod(V(x, h, 2.95), V(x, h + 0.08, 3.06), 0.016, 6));
    P.add('steel', rod(V(x, h + 0.08, 3.06), V(s * 0.82, h + 0.08, 3.06), 0.016, 6));
    P.add('steel', rod(V(s * 0.82, h + 0.08, 3.06), V(s * 0.82, roof, 3.0), 0.014, 5));
    P.add('camo', rbox(0.74, 0.04, 0.95, 0.02, s * 0.5, roof + 0.02, 2.35));
    P.add('dark', xTube(s * 0.2, s * 0.8, 0.025, 0.025, 6, roof + 0.03, 1.86));
    P.add('dark', box(0.08, 0.04, 0.08, s * 0.98, roof + 0.02, -1.1));
  }

  // ---- rear: two doors, hinges and handles, tail lights, fender boxes with grilles, tow hooks
  for (const s of [-1, 1]) {
    // big doors reaching down over the lower hull (strela_04), a pressed panel in each
    if (doors) rearDoor(P, s);
    for (const y of [0.8, 1.18, 1.56]) P.add('dark', zTube(ZR, ZR + 0.07, 0.025, 0.025, 8, s * 0.95, y));
    // tail lights up on brackets at the top corners
    P.add('dark', box(0.04, 0.16, 0.04, s * 1.15, roof + 0.02, ZR - 0.02));
    P.add('dark', rbox(0.14, 0.1, 0.08, 0.02, s * 1.15, roof + 0.13, ZR - 0.01));
    P.add('red', zTube(ZR + 0.03, ZR + 0.04, 0.035, 0.035, 12, s * 1.15, roof + 0.13));
    // fender box over the track behind the idler: an L plate with louvres and slats facing aft
    const x = s * 1.18;
    P.add('camo', sideProfile([[2.84, 1.12], [3.08, 1.12], [3.2, 1.02], [3.2, 0.64], [3.15, 0.64], [3.15, 1.0], [3.06, 1.07], [2.84, 1.07]], 0.49).applyMatrix4(xf(x, 0, 0)));
    // side cheeks of the fender: the outer one wraps the back of the track, just outboard of it
    P.add('camo', sideProfile([[2.86, 1.1], [3.06, 1.1], [3.2, 0.98], [3.2, 0.6], [3.13, 0.6], [3.06, 0.76], [2.96, 0.94], [2.86, 1.03]], 0.02).applyMatrix4(xf(s * (W + 0.015), 0, 0)));
    P.add('camo', sideProfile([[3.05, 1.08], [3.17, 1.0], [3.17, 0.64], [3.05, 0.86]], 0.025).applyMatrix4(xf(x - s * 0.245, 0, 0)));
    P.add('dark', box(0.44, 0.34, 0.01, x, 0.82, 3.205));
    for (let i = 0; i < 6; i++) P.add('camo', box(0.025, 0.2, 0.025, x - 0.19 + i * 0.076, 0.75, 3.215));
    for (let i = 0; i < 3; i++) P.add('camo', box(0.44, 0.02, 0.04, x, 0.89 + i * 0.045, 3.21, 0.5));
    P.add('dark', rod(V(s * 0.68, 0.72, ZR - 0.02), V(s * 0.68, 0.72, ZR + 0.14), 0.035, 6));
    P.add('dark', box(0.05, 0.14, 0.05, s * 0.68, 0.68, ZR + 0.14));
  }
  P.add('dark', box(0.03, 0.98, 0.03, 0, 1.18, ZR + 0.035)); // door gap
  P.add('dark', box(0.2, 0.08, 0.12, 0, 0.62, ZR + 0.02)); // towing pintle
}
