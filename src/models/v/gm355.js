import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { V, box, rbox, yTube, zTube, xTube, rod, sideProfile, lathe, loft, xf, scaleUV, plane } from '../kit.js';

// GM-355 tracked chassis in its 9A331M (Tor-M2) build: the long box hull with the clipped prow (cab
// face with the windows, a shelf, the lower plate), the tall crew and equipment section, the lower engine
// deck at the rear, the thick sloped track guards, and the running gear (front idler, seven double
// road wheels at 0.857 m pitch, rear sprocket, 0.55 m track with every link modelled).
// Measured off refs/tor (tor_m2u_01 side profile at 200 px/m from the wheel pitch, _02/_03 front,
// _04 rear, _09 top). Model space: front -Z, right +X, ground y = 0.

export const GM355 = {
  W: 1.62, // half width over the hull sides
  roof: 2.0, // roof of the cab and the equipment compartment
  deck: 1.82, // engine deck behind the step
  step: 1.95, // z where the roof steps down to the engine deck
  nose: [-4.49, 1.34], // prow edge (z, y)
  cab: [-4.08, 1.46], // foot of the raked cab face
  roofFront: -3.71, // top of the cab face
  rear: 4.46,
  belly: 0.45,
  sponson: 1.0, // underside of the hull where it overhangs the tracks
  skirt: 1.13, // top of the track guards
  gauge: 1.42, // track centre line
  trackW: 0.55,
  wheels: [2.8, 1.943, 1.086, 0.229, -0.628, -1.485, -2.342], // road wheel centres, rear to front
  wheelR: 0.325, // 0.65 m road wheels (tor_m2u_01 at full size)
  wheelY: 0.4,
  sprocket: [3.51, 0.6, 0.29], // z, y, radius at the track's inner face
  idler: [-3.28, 0.62, 0.27],
  rollers: [2.05, 0.0, -2.05], // return rollers: unconfirmed (the guards hide the top run in every photo)
  ringZ: 0.35, // turret ring centre, 4.8 m from the prow
  ringY: 2.18, // turret ring top
  plinth: 2.16, // top of the raised centre section under the turret
};

const nonIdx = (gs) => mergeGeometries(gs.map((g) => { const n = g.index ? g.toNonIndexed() : g; if (n.attributes.uv) n.deleteAttribute('uv'); return n; }));
const latheX = (pts, seg) => lathe(pts, seg).rotateZ(-Math.PI / 2); // profile [r, x], axis along +X
// a plate with the rounded-box signature but a plain box's 12 triangles
const rb = (w, h, d, r, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) => box(w, h, d, x, y, z, rx, ry, rz);

// ---------------------------------------------------------------- track

// Closed path of the track's inner face in (z, y), counterclockwise in the (z, y) plane: under the
// road wheels from the idler to the sprocket, round the sprocket, back over the return rollers and
// round the idler. Each circle is wrapped on its outside (external tangents between neighbours).
function trackPath() {
  const { wheels, wheelR: R, wheelY: Y, rollers } = GM355;
  const [sz, sy, sr] = GM355.sprocket, [iz, iy, ir] = GM355.idler;
  const C = [[iz, iy, ir], ...wheels.slice().reverse().map((z) => [z, Y, R]), [sz, sy, sr], ...rollers.map((z) => [z, 0.77, 0.1])];
  const n = C.length;
  // outward normal angle of the tangent leaving circle a for circle b
  const tan = (a, b) => {
    const dz = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dz, dy);
    return Math.atan2(dy, dz) - Math.acos((a[2] - b[2]) / L);
  };
  const pts = [];
  for (let i = 0; i < n; i++) {
    const c = C[i], aIn = tan(C[(i - 1 + n) % n], c), aOut = tan(c, C[(i + 1) % n]);
    let a1 = aOut;
    while (a1 < aIn - 1e-6) a1 += Math.PI * 2;
    if (a1 - aIn > Math.PI * 2 - 1e-6) a1 -= Math.PI * 2;
    const k = Math.max(1, Math.ceil((a1 - aIn) / 0.12));
    for (let j = 0; j <= k; j++) { const a = aIn + (a1 - aIn) * (j / k); pts.push([c[0] + Math.cos(a) * c[2], c[1] + Math.sin(a) * c[2]]); }
  }
  return pts;
}

// One link: a shoe plate nearly the pitch long with a rubber pad and a grouser bar, the guide horn
// standing in from the middle (it runs between the two discs of each road wheel), hinge knuckles.
// Local: x across the track, y outward from the inner face, z along the run.
function linkGeometry(w, pitch) {
  const g = [box(w, 0.04, pitch * 0.9, 0, 0.02, 0)];
  g.push(box(w * 0.92, 0.035, pitch * 0.4, 0, 0.057, -pitch * 0.12)); // grouser bar / rubber pad
  g.push(box(0.05, 0.075, 0.07, 0, -0.035, 0)); // guide horn
  return nonIdx(g);
}

export function addTracks(P, pitch = 0.165) {
  const pts = trackPath();
  const n = pts.length, cum = [0];
  for (let i = 1; i <= n; i++) { const a = pts[i - 1], b = pts[i % n]; cum.push(cum[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1])); }
  const L = cum[n], N = Math.round(L / pitch), step = L / N;
  const link = linkGeometry(GM355.trackW, step);
  const m = new THREE.Matrix4(), X = V(1, 0, 0), Nv = V(0, 0, 0), T = V(0, 0, 0);
  const list = [];
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
      m.setPosition(sx * GM355.gauge, y, z);
      list.push(link.clone().applyMatrix4(m));
    }
  }
  P.add('dark', mergeGeometries(list), { tint: 0x9a9690 });
  return N;
}

// ---------------------------------------------------------------- wheels

// Double road wheel about +X centred between its two discs (the guide horns run in the gap): each
// disc a rubber tyre on a pressed steel wheel with a raised ring; the outer disc carries the domed hub
// cap and its bolt circle. Returns { tyre, disc } in wheel space, outer face toward +X.
function roadWheel(R) {
  const t = [], d = [];
  const g0 = 0.035, w = 0.2; // half gap, disc width
  for (const s of [-1, 1]) {
    const a = s * g0, b = s * (g0 + w); // inner and outer faces of this disc
    const prof = [[R - 0.07, a], [R - 0.005, a + s * 0.01], [R, (a + b) / 2], [R - 0.005, b - s * 0.01], [R - 0.07, b]];
    t.push(latheX(s > 0 ? prof : prof.slice().reverse(), 16));
  }
  // the outer disc: rim lip, raised ring, dish to the hub; the inner one is a plain disc (it faces the hull)
  const o = g0 + w;
  d.push(latheX([[R - 0.07, o], [R - 0.1, o + 0.012], [0.2, o - 0.03], [0.15, o - 0.02], [0.11, o], [0.001, o]], 16));
  d.push(latheX([[0.001, -o], [R - 0.07, -o]], 10));
  // domed hub cap and its bolts
  d.push(latheX([[0.11, o], [0.1, o + 0.05], [0.06, o + 0.085], [0.001, o + 0.093]], 12));
  for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; d.push(xTube(o, o + 0.025, 0.015, 0.015, 4, Math.cos(a) * 0.145, Math.sin(a) * 0.145)); }
  return { tyre: nonIdx(t), disc: nonIdx(d) };
}

// Toothed sprocket ring with lightening holes, extruded along X
function sprocketRing(rRoot, rTip, t, teeth = 14) {
  const s = new THREE.Shape();
  const pts = [];
  for (let i = 0; i < teeth; i++) {
    const a = (i / teeth) * Math.PI * 2, w = Math.PI / teeth;
    for (const [r, b] of [[rRoot, a - w * 0.62], [rTip, a - w * 0.25], [rTip, a + w * 0.25], [rRoot, a + w * 0.62]]) pts.push(new THREE.Vector2(Math.cos(b) * r, Math.sin(b) * r));
  }
  s.setFromPoints(pts);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.3, h = new THREE.Path();
    h.absarc(Math.cos(a) * rRoot * 0.6, Math.sin(a) * rRoot * 0.6, rRoot * 0.17, 0, Math.PI * 2, true);
    s.holes.push(h);
  }
  const g = new THREE.ExtrudeGeometry(s, { depth: t, bevelEnabled: false, curveSegments: 5 });
  g.translate(0, 0, -t / 2);
  return g.rotateY(Math.PI / 2);
}

export function addRunningGear(P) {
  const { wheels, wheelR: R, wheelY: Y, gauge: G, rollers } = GM355;
  const [sz, sy, sr] = GM355.sprocket, [iz, iy, ir] = GM355.idler;
  const rw = roadWheel(R);
  const spr = sprocketRing(sr - 0.02, sr + 0.05, 0.05);
  // idler: a smaller double wheel, same build
  const idl = roadWheel(ir);
  for (const s of [-1, 1]) {
    const flip = s < 0 ? Math.PI : 0; // left side wheels face -X
    for (const z of wheels) {
      const m = xf(s * G, Y, z, 0, flip, 0);
      P.add('rubber', rw.tyre.clone().applyMatrix4(m));
      P.add('rim', rw.disc.clone().applyMatrix4(m));
      // trailing arm from the hull to the hub (torsion bar suspension), the arm points to the rear
      P.add('dark', rod(V(s * 1.08, 0.66, z - 0.36), V(s * (G - 0.22), Y + 0.02, z), 0.05, 6));
      P.add('dark', xTube(s * 1.05, s * 1.16, 0.085, 0.085, 10, 0.66, z - 0.36));
      // bump stop on the hull side over the wheel
      P.add('dark', box(0.12, 0.1, 0.16, s * 1.12, 0.86, z + 0.05));
    }
    // shock absorbers on the front and rear stations
    for (const z of [wheels[0], wheels[1], wheels[5], wheels[6]]) P.add('dark', rod(V(s * 1.12, 0.92, z - 0.2), V(s * 1.12, 0.55, z + 0.12), 0.04, 6));
    // rear drive sprocket: two toothed rings either side of the hub, final drive housing
    for (const dx of [-0.1, 0.1]) P.add('rim', spr.clone().applyMatrix4(xf(s * G + dx, sy, sz, 0.1 * s)));
    P.add('rim', xTube(s * (G - 0.13), s * (G + 0.13), sr - 0.08, sr - 0.08, 18, sy, sz));
    P.add('rim', xTube(s * (G + 0.13), s * (G + 0.19), 0.13, 0.1, 14, sy, sz));
    for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; P.add('steel', xTube(s * (G + 0.17), s * (G + 0.2), 0.015, 0.015, 6, sy + Math.cos(a) * 0.1, sz + Math.sin(a) * 0.1)); }
    P.add('dark', xTube(s * 1.0, s * (G - 0.13), 0.16, 0.16, 12, sy, sz));
    // front idler on its crank
    const mi = xf(s * G, iy, iz, 0, flip, 0);
    P.add('rubber', idl.tyre.clone().applyMatrix4(mi));
    P.add('rim', idl.disc.clone().applyMatrix4(mi));
    P.add('dark', rod(V(s * 1.05, 0.72, iz + 0.3), V(s * (G - 0.22), iy, iz), 0.06, 6));
    // return rollers under the guards
    for (const z of rollers) P.add('rim', xTube(s * (G - 0.25), s * (G + 0.25), 0.1, 0.1, 10, 0.77, z));
  }
  return addTracks(P);
}

// ---------------------------------------------------------------- hull

// a raised plate with rounded corners on a hull side (side = +1 right): z0..z1, y0..y1
function sidePanel(P, side, z0, z1, y0, y1, hinges = true, x = GM355.W) {
  const zc = (z0 + z1) / 2, yc = (y0 + y1) / 2;
  P.add('camo', rb(0.04, y1 - y0, z1 - z0, 0.03, side * (x + 0.012), yc, zc));
  // the dark seam round it
  for (const zz of [z0 - 0.012, z1 + 0.012]) P.add('dark', box(0.012, y1 - y0 + 0.036, 0.022, side * (x + 0.002), yc, zz));
  for (const yy of [y0 - 0.012, y1 + 0.012]) P.add('dark', box(0.012, 0.022, z1 - z0 + 0.036, side * (x + 0.002), yy, zc));
  if (hinges) for (const y of [y0 + 0.12, y1 - 0.12]) P.add('camo', box(0.05, 0.08, 0.08, side * (x + 0.03), y, z1 - 0.04), { tint: 0x9a9a9a });
  P.add('camo', box(0.03, 0.03, 0.08, side * (x + 0.035), yc, z0 + 0.1), { tint: 0x8a8a8a }); // latch
}

// The prow (tor_m1_12, tor_m2u_01 side; _03, tor_m2_07 front): the raked cab face carrying the two
// windscreens and the light clusters on its clipped corners, a short shelf out to the prow edge, and the
// long lower plate raked back to the belly with the tow cable, its clamps and the shackles on it.
// Glass windscreen in the cab face with its armoured cover hinged up at the roof edge and held level
function windscreen(P, F, x, w, h, u) {
  const [z, y] = F.at(u, 0.0);
  P.add('dark', box(w + 0.12, 0.05, h + 0.1, x, y, z, F.rot, 0, 0)); // frame
  const [zg, yg] = F.at(u, 0.03);
  P.add('glass', box(w, 0.01, h, x, yg, zg, F.rot, 0, 0));
  const [zh, yh] = F.at(u + h / 2 + 0.07, 0.03);
  P.add('camo', rb(w + 0.14, 0.04, 0.46, 0.015, x, yh + 0.02, zh - 0.22));
  P.add('dark', xTube(x - w / 2, x + w / 2, 0.025, 0.025, 8, yh, zh));
  for (const e of [-1, 1]) P.add('steel', rod(V(x + e * (w / 2 - 0.05), yh - 0.24, zh + 0.1), V(x + e * (w / 2 - 0.05), yh + 0.02, zh - 0.34), 0.013, 5));
}

// Headlight cluster: housing, two lamps and the small blackout lamp
function lights(P, x, y, z, n = 2) {
  P.add('dark', rb(0.42, 0.16, 0.16, 0.03, x, y, z + 0.04));
  for (let i = 0; i < n; i++) {
    const lx = x + (i - (n - 1) / 2) * 0.15;
    P.add('dark', zTube(z - 0.04, z - 0.1, 0.06, 0.065, 14, lx, y));
    P.add('lens', zTube(z - 0.1, z - 0.105, 0.054, 0.054, 14, lx, y));
  }
  P.add('dark', zTube(z - 0.02, z - 0.08, 0.035, 0.035, 10, x + (x > 0 ? -0.27 : 0.27), y - 0.1));
  P.add('amber', box(0.06, 0.04, 0.01, x + (x > 0 ? 0.27 : -0.27), y - 0.09, z - 0.04));
}

export function addHull(P) {
  const { W, roof, deck, step, nose: [nz, ny], cab: [cz, cy], roofFront: rf, rear: ZR, belly, sponson: YS, skirt: SK } = GM355;
  // prow section, lofted so its corners are clipped in plan: prow edge, shelf, raked cab face, roof
  const ring = (z, hw, yb, yt) => [V(-hw, yb, z), V(hw, yb, z), V(hw, yt, z), V(-hw, yt, z)];
  P.add('camo', loft([ring(nz, 1.38, ny - 0.04, ny), ring(cz, 1.5, YS, cy), ring(rf, 1.6, YS, roof - 0.05), ring(rf + 0.16, W, YS, roof)]));
  // upper hull over the full width: roof, step down to the engine deck, rear plate
  P.add('camo', sideProfile([[rf + 0.16, roof], [step, roof], [step + 0.08, deck], [ZR, deck], [ZR, YS], [rf + 0.16, YS]], W * 2, 0.025));
  // lower front plate, full width between the track guards' ends, raked back to the belly
  const lz = nz + 0.61;
  P.add('camo', sideProfile([[nz, ny], [lz, belly], [lz + 0.14, belly], [lz + 0.14, ny]], 2.76));
  // lower hull between the tracks: belly, rear
  P.add('camo', sideProfile([[lz, belly], [ZR - 0.3, belly], [ZR, 0.7], [ZR, YS + 0.02], [lz, YS + 0.02]], 2.26));
  P.add('dark', box(2.1, 0.03, 7.9, 0, belly - 0.01, 0.1)); // belly plate
  for (const s of [-1, 1]) P.add('camo', box(0.01, YS - belly, 7.6, s * 1.125, (YS + belly) / 2, 0.15), { tint: 0x555555 }); // side between the tracks, in shadow

  // track guards: a thick shelf sloping down and out over the tracks, bent down at both ends
  for (const s of [-1, 1]) {
    const x = s * (W + 0.05);
    P.add('camo', sideProfile([[-3.98, 0.6], [-3.7, SK], [4.13, SK], [4.22, 1.0], [4.16, 0.64], [4.06, 0.64], [4.1, 0.97], [-3.6, 0.98], [-3.86, 0.6]], 0.1).translate(x, 0, 0));
    P.add('camo', box(0.26, 0.03, 7.84, s * (W - 0.0), SK - 0.01, 0.2, 0, 0, -s * 0.3), { tint: new THREE.Color(1.15, 1.15, 1.12) }); // top of the shelf catches the light
    P.add('camo', box(0.03, 0.12, 7.8, s * (W + 0.115), SK - 0.1, 0.2), { tint: 0xb0b0b0 }); // outer lip
  }

  // ---- front: cab face with the windscreens and lights
  const C = { L: Math.hypot(rf - cz, roof - 0.05 - cy), rot: -Math.atan2(roof - 0.05 - cy, rf - cz) };
  {
    const dz = rf - cz, dy = roof - 0.05 - cy, L = C.L;
    C.at = (u, off = 0) => [cz + (dz / L) * u - (dy / L) * off, cy + (dy / L) * u + (dz / L) * off];
  }
  windscreen(P, C, -0.43, 0.72, 0.46, 0.33);
  windscreen(P, C, 0.43, 0.72, 0.46, 0.33);
  { const [z, y] = C.at(0.32, 0.02); P.add('camo', box(0.1, 0.05, 0.5, 0, y, z, C.rot)); } // post between the windows
  for (const s of [-1, 1]) { const [z, y] = C.at(0.2, 0.06); lights(P, s * 1.22, y, z, 2); }
  // lower plate: clamp brackets, the tow cable looped between them, shackles (tor_m2_07, _03)
  const Lp = { L: Math.hypot(lz - nz, belly - ny), rot: -Math.atan2(belly - ny, lz - nz) };
  {
    const dz = lz - nz, dy = belly - ny, L = Lp.L;
    Lp.at = (u, off = 0) => [nz + (dz / L) * u + (dy / L) * off, ny + (dy / L) * u - (dz / L) * off];
  }
  for (const x of [-1.05, -0.4, 0.4, 1.05]) {
    const [z, y] = Lp.at(0.22, 0.02);
    P.add('dark', box(0.26, 0.04, 0.16, x, y, z, Lp.rot));
    const [z2, y2] = Lp.at(0.22, 0.06);
    P.add('dark', box(0.08, 0.05, 0.08, x, y2, z2, Lp.rot));
  }
  for (const x of [-1.2, -0.48, 0.48, 1.2]) {
    const [z, y] = Lp.at(0.62, 0.05);
    P.add('dark', box(0.1, 0.1, 0.08, x, y, z, Lp.rot));
    P.add('steel', new THREE.TorusGeometry(0.075, 0.024, 6, 12).rotateY(Math.PI / 2).translate(x, y - 0.1, z - 0.06));
  }
  {
    const pts = [];
    for (let i = 0; i <= 28; i++) {
      const t = i / 28, x = -1.2 + 2.4 * t, sag = 0.14 * Math.sin(t * Math.PI * 3) ** 2;
      const [z, y] = Lp.at(0.15 + sag, 0.05);
      pts.push(V(x, y, z));
    }
    P.add('steel', new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 56, 0.022, 5, false), { tint: 0x9a9a9a });
  }
  // right front roof corner: the louvred cooler box (tor_m2u_02); left: the barrel lamp on a low base (_10)
  P.add('camo', rb(0.62, 0.26, 0.4, 0.02, 1.22, roof + 0.13, rf + 0.45));
  for (let i = 0; i < 5; i++) P.add('dark', box(0.56, 0.018, 0.02, 1.22, roof + 0.05 + i * 0.045, rf + 0.245));
  P.add('camo', box(0.24, 0.12, 0.24, -1.22, roof + 0.06, rf + 0.4));
  P.add('camo', zTube(rf + 0.22, rf + 0.56, 0.1, 0.1, 14, -1.22, roof + 0.22));
  P.add('dark', zTube(rf + 0.2, rf + 0.22, 0.08, 0.08, 12, -1.22, roof + 0.22));
  // whips on brackets at the top corners of the cab face (tor_m2u_01, _02)
  for (const s of [-1, 1]) {
    const x = s * 1.45, z = -4.02, y = 1.9;
    P.add('dark', box(0.12, 0.08, 0.2, x, y - 0.06, z + 0.1));
    P.add('dark', yTube(y - 0.02, y + 0.22, 0.05, 0.04, 10, x, z));
    P.add('dark', yTube(y + 0.22, y + 0.36, 0.028, 0.022, 8, x, z));
    P.add('dark', yTube(y + 0.36, y + 3.0, 0.011, 0.004, 5, x, z));
  }
  // a cover on the right roof edge with its top sloping outward (tor_m2u_01)
  P.add('camo', box(0.36, 0.08, 0.64, W - 0.2, roof + 0.04, -2.7));
  P.add('camo', box(0.34, 0.03, 0.66, W - 0.17, roof + 0.09, -2.7, 0, 0, -0.22), { tint: 0xc0c0c0 });
  // the field of small slatted vent grilles on the roof between the cab and the turret (tor_m2u_05)
  for (const [x, z, w, d] of [[-0.95, -3.15, 0.5, 0.16], [-0.2, -3.2, 0.42, 0.14], [0.6, -3.15, 0.5, 0.16], [-0.5, -2.7, 0.5, 0.16], [0.35, -2.75, 0.4, 0.14],
    [1.1, -2.65, 0.45, 0.16], [-1.05, -2.2, 0.42, 0.15], [-0.1, -2.25, 0.5, 0.16], [0.8, -2.1, 0.5, 0.16], [-0.6, -1.7, 0.45, 0.15], [0.3, -1.6, 0.42, 0.14], [1.15, -1.55, 0.36, 0.14]]) {
    P.add('camo', box(w + 0.06, 0.025, d + 0.06, x, roof + 0.012, z), { tint: 0xb0b0b0 });
    const g = plane(w, d, x, roof + 0.027, z, -Math.PI / 2, 0, 0);
    scaleUV(g, w / 0.05, d / 0.05);
    P.add('array', g, { tint: new THREE.Color(0.9, 1.0, 0.85) });
  }
  // vents and periscope boxes on the cab roof
  for (const x of [-0.5, 0.5]) {
    P.add('camo', rb(0.4, 0.08, 0.2, 0.02, x, roof + 0.04, rf + 0.35));
    P.add('dark', box(0.3, 0.04, 0.01, x, roof + 0.05, rf + 0.244));
  }
  // ---- sides: door panels, round port, boxes on the engine section (tor_m2u_01, _04)
  for (const s of [-1, 1]) {
    // three doors (hinged at their front edges) and the panels ahead of them, all to 1.18 .. 1.98
    sidePanel(P, s, -0.42, 0.47, 1.18, 1.98);
    sidePanel(P, s, -1.25, -0.45, 1.18, 1.98);
    sidePanel(P, s, -2.1, -1.3, 1.2, 1.95);
    sidePanel(P, s, -2.84, -2.18, 1.26, 1.9, false);
    sidePanel(P, s, -3.62, -2.88, 1.28, 1.9, false);
    sidePanel(P, s, 0.5, 1.08, 1.2, 1.98, false);
    P.add('camo', xTube(s * W, s * (W + 0.04), 0.13, 0.13, 18, 1.82, 0.72)); // round port
    P.add('dark', xTube(s * (W + 0.04), s * (W + 0.05), 0.04, 0.04, 8, 1.82, 0.72));
    // the tall stowage box at the back of the centre section, its lower front corner cut away
    // (tor_m2u_01: z +1.12 .. +1.93, up to the raised section's top)
    P.add('camo', sideProfile([[1.93, 1.2], [1.93, 2.14], [1.12, 2.14], [1.12, 1.83], [1.62, 1.4], [1.62, 1.2]], 0.14, 0.02).translate(s * (W + 0.07), 0, 0));
    P.add('camo', box(0.03, 0.04, 0.78, s * (W + 0.1), 2.0, 1.52), { tint: 0xb4b4b4 });
    // ledge along the top of the side
    P.add('camo', box(0.05, 0.04, 1.08 - rf - 0.1, s * (W + 0.015), roof - 0.01, (1.08 + rf) / 2), { tint: 0xc0c0c0 });
    // handholds
    for (const z of [-0.9, 0.1]) P.add('steel', rod(V(s * (W + 0.05), roof - 0.2, z - 0.15), V(s * (W + 0.05), roof - 0.2, z + 0.15), 0.012, 5));
  }

  // engine section, right side: three stowage boxes (tor_m2u_01); left side: one long panel over the
  // mesh grille (tor_m2u_04)
  for (const [z0, z1, y1] of [[1.97, 2.53, 1.75], [2.57, 2.95, 1.83], [3.05, 3.75, 1.72]]) {
    P.add('camo', rbox(0.16, y1 - 1.2, z1 - z0, 0.03, W + 0.08, (y1 + 1.2) / 2, (z0 + z1) / 2));
    P.add('camo', box(0.02, y1 - 1.3, z1 - z0 - 0.1, W + 0.165, (y1 + 1.2) / 2, (z0 + z1) / 2), { tint: 0xc4c4c4 });
    P.add('camo', box(0.04, 0.08, 0.05, W + 0.18, y1 - 0.12, z0 + 0.12), { tint: 0x8a8a8a }); // latch
    P.add('camo', box(0.04, 0.08, 0.05, W + 0.18, y1 - 0.12, z1 - 0.12), { tint: 0x8a8a8a });
  }
  sidePanel(P, -1, 1.98, 3.75, 1.45, 1.74, false);
  // long mesh grille under the deck edge on the left of the engine section (tor_m2u_04, _05)
  P.add('dark', box(0.02, 0.17, 1.7, -(W + 0.005), SK + 0.17, 2.75));
  for (let i = 0; i < 14; i++) P.add('camo', box(0.025, 0.17, 0.02, -(W + 0.012), SK + 0.17, 1.95 + i * 0.123), { tint: 0x9a9a9a });
  // ---- roof: turret ring housing, deck plates
  // the raised centre section the turret stands on, 0.16 m over the roof from the cab to the engine deck
  // (tor_m2u_01: z -2.15 to +1.95, its top flush with the turret's underside)
  P.add('camo', box(2 * (W - 0.1), GM355.plinth - roof + 0.02, step + 2.15, 0, (GM355.plinth + roof - 0.02) / 2, (step - 2.15) / 2));
  P.add('camo', box(2 * (W - 0.1) + 0.02, 0.03, step + 2.17, 0, GM355.plinth - 0.03, (step - 2.15) / 2), { tint: 0xb4b4b4 }); // lip
  P.add('dark', yTube(GM355.plinth - 0.01, GM355.ringY - 0.03, 1.2, 1.2, 32, 0, GM355.ringZ));
  P.add('camo', box(2.9, 0.025, 1.0, 0, roof + 0.012, -2.7), { tint: 0xd0d0d0 });
  // ---- engine deck: perforated covers, grilles and the folded ladder (tor_m2u_05, _09)
  // (a cover with a field of perforations: the field is a darker inset)
  const perf = (w, d, x, z, y = deck) => {
    P.add('camo', rb(w, 0.06, d, 0.02, x, y + 0.03, z));
    P.add('camo', box(w - 0.12, 0.01, d - 0.12, x, y + 0.062, z), { tint: 0x6a6a64 });
  };
  perf(0.95, 0.62, -0.95, 3.95);
  perf(0.95, 0.95, -0.95, 3.15);
  perf(0.95, 0.6, -0.95, 2.45);
  perf(0.85, 0.62, 0.3, 3.9);
  perf(0.85, 0.95, 0.3, 3.1);
  perf(0.7, 0.9, 1.15, 3.6);
  P.add('dark', box(0.6, 0.02, 0.7, 1.15, deck + 0.012, 2.55)); // grille
  for (let i = 0; i < 8; i++) P.add('steel', box(0.56, 0.02, 0.03, 1.15, deck + 0.025, 2.25 + i * 0.085));
  for (const s of [-1, 1]) P.add('camo', box(0.04, 0.03, 1.2, -0.95, deck + 0.075, 3.15, 0, s * 0.785, 0), { tint: 0xb8b8b8 }); // stamped X on the big cover
  // folded ladder lying on the left of the deck
  for (const s of [-1, 1]) P.add('camo', box(0.035, 0.035, 1.35, -1.42 + s * 0.17, deck + 0.04, 3.25), { tint: 0xa8a8a8 });
  for (let i = 0; i < 5; i++) P.add('camo', xTube(-1.59, -1.25, 0.014, 0.014, 5, deck + 0.04, 2.7 + i * 0.27), { tint: 0xa8a8a8 });
  P.add('camo', rod(V(-1.42, deck + 0.04, 2.55), V(-1.42, deck + 0.35, 2.4), 0.016, 5), { tint: 0xa8a8a8 }); // grab handle
  // exhaust / air box between the deck and the step
  P.add('camo', rb(0.7, 0.22, 0.32, 0.03, 0.9, deck + 0.11, step + 0.25));
  // long cylinder lying on the deck beside the turret base (tor_m2u_01, _05)
  P.add('camo', zTube(step + 0.02, step + 1.05, 0.11, 0.11, 14, -0.62, deck + 0.13));
  P.add('dark', zTube(step + 1.05, step + 1.09, 0.08, 0.08, 12, -0.62, deck + 0.13));
  for (const z of [step + 0.2, step + 0.85]) P.add('dark', box(0.26, 0.05, 0.05, -0.62, deck + 0.025, z));

  // ---- rear plate: stowage boxes, lamps, tow hooks (tor_m2u_04, tor_m1_13)
  // three big lockers standing out low on the plate, a row of small covers under the deck edge (tor_m2u_04)
  for (const x of [-0.78, 0, 0.78]) {
    P.add('camo', box(0.7, 0.38, 0.26, x, 1.16, ZR + 0.13));
    P.add('camo', box(0.62, 0.3, 0.02, x, 1.16, ZR + 0.265), { tint: 0xc4c4c4 });
    for (const e of [-1, 1]) P.add('camo', box(0.06, 0.08, 0.04, x + e * 0.22, 1.3, ZR + 0.28), { tint: 0x8a8a8a }); // latches
  }
  for (const x of [-1.15, -0.55, 0.05, 0.6]) {
    P.add('camo', box(0.46, 0.2, 0.08, x, 1.62, ZR + 0.04));
    P.add('camo', box(0.06, 0.05, 0.03, x, 1.62, ZR + 0.095), { tint: 0x8a8a8a });
  }
  for (const s of [-1, 1]) {
    P.add('dark', rb(0.16, 0.1, 0.06, 0.02, s * 1.42, 1.72, ZR + 0.03));
    P.add('red', box(0.06, 0.04, 0.01, s * 1.38, 1.72, ZR + 0.065));
    P.add('amber', box(0.04, 0.04, 0.01, s * 1.47, 1.72, ZR + 0.065));
    P.add('dark', box(0.1, 0.16, 0.12, s * 0.75, 0.82, ZR + 0.04));
    P.add('steel', new THREE.TorusGeometry(0.07, 0.022, 6, 12).rotateY(Math.PI / 2).translate(s * 0.75, 0.68, ZR + 0.08));
  }
  // round convoy lamp at the rear right corner (tor_m2u_04)
  P.add('dark', zTube(ZR, ZR + 0.12, 0.13, 0.13, 16, 1.3, 1.3));
  P.add('lens', zTube(ZR + 0.12, ZR + 0.125, 0.11, 0.11, 16, 1.3, 1.3), { tint: 0xd8d8c8 });
}
