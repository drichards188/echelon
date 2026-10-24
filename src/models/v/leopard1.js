import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { V, box, rbox, yTube, zTube, xTube, rod, sideProfile, loft, lathe, xf } from '../kit.js';

// Leopard 1 hull and running gear in the Flakpanzer Gepard 1A2's build (refs/gepard): the 7.09 m hull
// with its sharp nose (a long shallow upper glacis carrying four spare track shoes, the headlights and
// the big tow hooks; the lower glacis sloping back under), sponsons over the tracks with the row of
// perforated stowage bins along their sides, big front mudguards, the driver's hatch at the front
// right, the auxiliary power unit's grille at the front left, the engine deck a little higher behind
// the turret with louvred exhaust grilles on its chamfered rear corners, the rear plate with its lamp
// clusters, hatches and hooks and the flat rear mudguards. No side skirts: the upper track run shows.
// Running gear: seven twin road wheels on torsion bar arms (a wider gap between the third and fourth),
// dampers on wheels 1, 2, 3, 6 and 7, four return rollers, the front idler and the rear sprocket, a
// double-pin track with rubber pads. Measured from refs/gepard (gepard_spaag_cc0 the left side, the
// road wheel spacing as the ruler; gepard_1a2_side, _overview, gepard_heer, gepard_munster_2026 and
// gepard_firing for the front, sides and rear). Model space: front -Z, right +X, ground y = 0, metres;
// the hull is centred on z = 0.

export const L1 = {
  front: -3.55, rear: 3.55, // fender tips (7.09 m hull, Leopard 1)
  nose: [-3.42, 0.98], // the upper glacis' lower edge, where the lower glacis turns under (z, y)
  glacisTop: -2.38, // where the upper glacis meets the roof
  W: 1.625, // half width over the sponsons (3.25 m)
  deck: 1.56, // hull roof
  ringY: 1.62, // turret ring face (on its raised housing)
  engine: 1.68, // engine deck, higher behind the turret (toward the louvres' top in gepard_spaag_cc0, below the turret's underside)
  engineZ: 1.5, // where the engine deck's front slope ends
  louvreZ: 1.95, // where the louvred rear corners begin
  mid: 1.22, // half width of the engine deck between the louvred chamfers
  under: 1.2, // underside of the sponsons over the tracks
  lower: 1.04, // half width of the lower hull between the tracks
  belly: 0.44, // ground clearance
  gauge: 1.35, // track centre line (2.70 m)
  trackW: 0.55,
  wheels: [-2.455, -1.755, -1.055, -0.285, 0.415, 1.115, 1.815], // road wheel centres, front to rear
  wheelR: 0.33,
  wheelY: 0.41,
  rollers: [-2.11, -1.4, 0.07, 1.42], // return rollers
  rollerY: 0.98,
  rollerR: 0.1,
  idler: [-3.15, 0.78, 0.29], // z, y, radius
  sprocket: [2.64, 0.82, 0.28],
  ring: -0.1, // turret ring centre (z)
};

const nonIdx = (gs) => mergeGeometries(gs.map((g) => { const n = g.index ? g.toNonIndexed() : g; if (n.attributes.uv) n.deleteAttribute('uv'); return n; }));
const latheX = (pts, seg) => lathe(pts, seg).rotateZ(-Math.PI / 2); // profile [r, x], axis along +X
// height of the upper glacis at z
export const glacisY = (z) => { const [nz, ny] = L1.nose; return ny + ((z - nz) / (L1.glacisTop - nz)) * (L1.deck - ny); };
const GLA = Math.atan2(L1.deck - L1.nose[1], L1.glacisTop - L1.nose[0]); // upper glacis slope

// ---------------------------------------------------------------- track

// Closed path of the track's inner face in (z, y), counterclockwise seen from the right: round the
// front of the idler, along the bottoms of the road wheels, up round the rear sprocket and back over
// the return rollers, sagging between them (a polyline rounded off).
function trackPath() {
  const { wheels, wheelR: R, wheelY: Y, rollers, rollerY, rollerR } = L1;
  const [iz, iy, ir] = L1.idler, [sz, sy, sr] = L1.sprocket;
  const wF = wheels[0], wR = wheels[wheels.length - 1];
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
  const aID = tan(iz, iy, ir, wF, Y, R);
  const aWS = tan(wR, Y, R, sz, sy, sr);
  arc(iz, iy, ir, Math.PI / 2, aID + Math.PI * 2);
  arc(wF, Y, R, aID, -Math.PI / 2);
  arc(wR, Y, R, -Math.PI / 2, aWS);
  arc(sz, sy, sr, aWS, Math.PI / 2);
  let top = [[sz, sy + sr]];
  const sup = [[sz, sy + sr], ...rollers.slice().reverse().map((z) => [z, rollerY + rollerR]), [iz, iy + ir]];
  for (let k = 0; k < sup.length - 1; k++) {
    const [a, b] = [sup[k], sup[k + 1]];
    top.push([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2 - 0.03]);
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

// One double-pin link: the body (two pin tubes under one shoe), two rubber pads on the ground side,
// the end connectors over the joint on both edges and the centre connector with its guide horn
// standing up between the twin wheels. The connectors are bare steel (rusty in every photo). Local:
// x across the track, y outward from the inner face, z along the run.
function linkGeometry(w, pitch) {
  const body = [box(w - 0.1, 0.035, pitch * 0.78, 0, 0.018, 0)];
  for (const s of [-1, 1]) body.push(box(w / 2 - 0.1, 0.028, pitch * 0.6, s * (w / 4 - 0.005), 0.05, 0)); // rubber pads
  body.push(box(0.06, 0.085, 0.07, 0, -0.04, 0)); // guide horn
  const steel = [];
  for (const s of [-1, 1]) steel.push(box(0.05, 0.05, pitch * 0.5, s * (w / 2 - 0.025), 0.018, pitch * 0.5)); // end connectors
  steel.push(box(0.08, 0.045, pitch * 0.42, 0, 0.018, pitch * 0.5)); // centre connector
  return { body: nonIdx(body), steel: nonIdx(steel) };
}

export function addTracks(P, pitch = 0.17) {
  const pts = trackPath();
  const n = pts.length, cum = [0];
  for (let i = 1; i <= n; i++) { const a = pts[i - 1], b = pts[i % n]; cum.push(cum[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1])); }
  const L = cum[n], N = Math.round(L / pitch), step = L / N;
  const link = linkGeometry(L1.trackW, step);
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
      m.setPosition(sx * L1.gauge, y, z);
      P.add('dark', link.body.clone().applyMatrix4(m));
      P.add('rust', link.steel.clone().applyMatrix4(m), { tint: 0xb0a090 });
    }
  }
  return N;
}

// ---------------------------------------------------------------- wheels

// Twin road wheel about +X (outer face +X): two pressed discs with rubber tyres and the gap between
// them for the guide horns; the outer disc dished with a rolled lip, a raised hub with a bolt ring
// and a domed cap. Returns { tyre, disc }.
function roadWheel(R) {
  const h = 0.14, g = 0.035; // width of one half, half the gap between them
  const tyre = (x0) => latheX([[R - 0.075, x0], [R - 0.012, x0], [R, x0 + 0.02], [R, x0 + h - 0.02], [R - 0.012, x0 + h], [R - 0.075, x0 + h]], 20);
  const ty = nonIdx([tyre(g), tyre(-g - h)]);
  const d = [];
  d.push(latheX([[R - 0.075, g + h], [R - 0.085, g + h + 0.012], [R - 0.11, g + h - 0.005], [0.15, g + h - 0.02], [0.13, g + h + 0.01], [0.075, g + h + 0.03], [0.0, g + h + 0.045]], 20));
  for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; d.push(xTube(g + h - 0.01, g + h + 0.022, 0.014, 0.014, 6, Math.cos(a) * 0.105, Math.sin(a) * 0.105)); }
  d.push(latheX([[0.0, -g - h - 0.02], [R - 0.075, -g - h]], 14)); // inner disc
  d.push(xTube(-g, g, 0.15, 0.15, 12, 0, 0, true)); // hub between the halves
  return { tyre: ty, disc: nonIdx(d) };
}

// Toothed sprocket ring with round lightening holes, extruded along X
function sprocketRing(rRoot, rTip, t, teeth = 11) {
  const s = new THREE.Shape();
  const pts = [];
  for (let i = 0; i < teeth; i++) {
    const a = (i / teeth) * Math.PI * 2, w = Math.PI / teeth;
    for (const [r, b] of [[rRoot, a - w * 0.62], [rTip, a - w * 0.22], [rTip, a + w * 0.22], [rRoot, a + w * 0.62]]) pts.push(new THREE.Vector2(Math.cos(b) * r, Math.sin(b) * r));
  }
  s.setFromPoints(pts);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + 0.2, hole = new THREE.Path();
    hole.absarc(Math.cos(a) * 0.17, Math.sin(a) * 0.17, 0.035, 0, Math.PI * 2, true);
    s.holes.push(hole);
  }
  const g = new THREE.ExtrudeGeometry(s, { depth: t, bevelEnabled: false, curveSegments: 4 });
  g.translate(0, 0, -t / 2);
  return g.rotateY(Math.PI / 2);
}

export function addRunningGear(P) {
  const { wheels, wheelR: R, wheelY: Y, gauge: G, rollers, rollerY, rollerR, lower: I } = L1;
  const [sz, sy, sr] = L1.sprocket, [iz, iy, ir] = L1.idler;
  const rw = roadWheel(R);
  const spr = sprocketRing(sr - 0.05, sr + 0.035, 0.045);
  const DAMPED = [0, 1, 2, 5, 6];
  for (const s of [-1, 1]) {
    const flip = s < 0 ? Math.PI : 0; // left side wheels face -X
    wheels.forEach((z, i) => {
      const m = xf(s * G, Y, z, 0, flip, 0);
      P.add('rubber', rw.tyre.clone().applyMatrix4(m));
      P.add('rim', rw.disc.clone().applyMatrix4(m));
      // trailing arm from the torsion bar's bearing ahead of the hub
      P.add('dark', rod(V(s * I, 0.62, z - 0.36), V(s * (G - 0.17), Y, z), 0.05, 6));
      P.add('rim', xTube(s * (I - 0.04), s * (I + 0.08), 0.09, 0.09, 12, 0.62, z - 0.36));
      // dampers leaning back from the arm to the sponson (red-marked in gepard_spaag_cc0)
      if (DAMPED.includes(i)) {
        P.add('dark', rod(V(s * 1.12, 0.6, z - 0.18), V(s * 1.12, 1.12, z + 0.12), 0.055, 8));
        P.add('rim', rod(V(s * 1.12, 0.84, z - 0.04), V(s * 1.12, 1.12, z + 0.12), 0.068, 8));
      }
    });
    // return rollers: twin rubber-tyred rollers on stub axles from the hull side
    for (const z of rollers) {
      for (const dx of [-0.1, 0.1]) P.add('rubber', xTube(s * (G + dx - 0.07), s * (G + dx + 0.07), rollerR, rollerR, 14, rollerY, z));
      P.add('rim', xTube(s * (G + 0.17), s * (G + 0.19), 0.06, 0.045, 12, rollerY, z));
      P.add('dark', xTube(s * I, s * (G - 0.17), 0.04, 0.04, 8, rollerY, z));
    }
    // rear drive sprocket: two toothed rings on a hub, the bolted hub cap, the final drive housing
    for (const dx of [-0.11, 0.11]) P.add('rim', spr.clone().applyMatrix4(xf(s * G + dx, sy, sz, 0.12 * s)));
    P.add('rim', xTube(s * (G - 0.13), s * (G + 0.13), sr - 0.06, sr - 0.06, 20, sy, sz));
    P.add('rim', latheX([[sr - 0.06, 0.13], [0.14, 0.14], [0.1, 0.18], [0.0, 0.19]], 18).applyMatrix4(xf(s * G, sy, sz, 0, flip, 0)));
    for (let i = 0; i < 10; i++) { const a = (i / 10) * Math.PI * 2; P.add('steel', xTube(s * (G + 0.15), s * (G + 0.17), 0.013, 0.013, 6, sy + Math.cos(a) * 0.12, sz + Math.sin(a) * 0.12)); }
    P.add('dark', xTube(s * I, s * (G - 0.13), 0.16, 0.16, 12, sy, sz));
    // front idler: a twin dished wheel like the road wheels, without tyres, on its crank
    P.add('rim', latheX([[ir, -0.17], [ir, 0.17], [ir - 0.02, 0.185], [0.13, 0.17], [0.09, 0.2], [0.0, 0.215]], 22).applyMatrix4(xf(s * G, iy, iz, 0, flip, 0)));
    P.add('rim', latheX([[0.0, -0.19], [ir - 0.02, -0.18]], 18).applyMatrix4(xf(s * G, iy, iz, 0, flip, 0)));
    P.add('dark', latheX([[ir - 0.005, -0.03], [ir - 0.005, 0.03]], 22).applyMatrix4(xf(s * G, iy, iz, 0, flip, 0))); // the groove
    for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; P.add('steel', xTube(s * (G + 0.19), s * (G + 0.21), 0.013, 0.013, 6, iy + Math.cos(a) * 0.065, iz + Math.sin(a) * 0.065)); }
    P.add('dark', rod(V(s * I, 0.9, iz + 0.32), V(s * (G - 0.18), iy, iz), 0.06, 6));
  }
  return addTracks(P);
}

// ---------------------------------------------------------------- hull fittings

// Perforated stowage bin lid along a sponson side (facing +X when s = 1): a frame standing proud of
// the side with a dark perforated sheet behind a fine lattice.
function sideBin(P, s, z0, z1, y0, y1) {
  const x = s * (L1.W + 0.025), zc = (z0 + z1) / 2, yc = (y0 + y1) / 2, l = z1 - z0, h = y1 - y0;
  P.add('dark', box(0.03, h, l, x, yc, zc), { tint: 0x8a8a8a });
  for (const [dy, hh] of [[-h / 2 + 0.015, 0.03], [h / 2 - 0.015, 0.03]]) P.add('camo', box(0.05, hh, l, x + s * 0.01, yc + dy, zc));
  for (const dz of [-l / 2 + 0.015, l / 2 - 0.015]) P.add('camo', box(0.05, h, 0.03, x + s * 0.01, yc, zc + dz));
  for (let z = z0 + 0.06; z < z1 - 0.04; z += 0.06) P.add('camo', box(0.02, h - 0.04, 0.022, x + s * 0.012, yc, z), { tint: 0xc8c8c8 });
  for (const dy of [-h / 6, h / 6]) P.add('camo', box(0.02, 0.02, l - 0.04, x + s * 0.014, yc + dy, zc), { tint: 0xc8c8c8 });
}

// Big rotating tow hook on the glacis corner (the hook swung up, its eye toward the nose)
function towHook(P, x, z) {
  const y = glacisY(z);
  const n = V(0, Math.cos(GLA), -Math.sin(GLA));
  P.add('dark', rbox(0.18, 0.12, 0.2, 0.03, x, y + 0.05, z, -GLA));
  const g = new THREE.TorusGeometry(0.08, 0.03, 6, 10, Math.PI * 1.3).rotateZ(-0.65).rotateY(Math.PI / 2);
  P.add('dark', g.applyMatrix4(xf(x, y + 0.12 + n.y * 0.04, z - 0.12, -GLA)));
  P.add('dark', yTube(y + 0.04, y + 0.16, 0.04, 0.04, 8, x, z - 0.04));
}

// Headlight group on a glacis corner: the round headlamp in its housing, a small lamp outboard, the
// bracket and a guard bar
function headlights(P, s, z) {
  const x = s * 0.92, y = glacisY(z) + 0.1;
  P.add('dark', box(0.34, 0.05, 0.12, x, y - 0.06, z + 0.04));
  P.add('camo', zTube(z + 0.06, z - 0.1, 0.085, 0.085, 14, x - s * 0.04, y + 0.02));
  P.add('glass', zTube(z - 0.1, z - 0.105, 0.072, 0.072, 14, x - s * 0.04, y + 0.02), { tint: 0xd8dde0 });
  P.add('dark', zTube(z + 0.03, z - 0.07, 0.045, 0.045, 10, x + s * 0.11, y - 0.01));
  P.add('amber', zTube(z - 0.07, z - 0.074, 0.038, 0.038, 10, x + s * 0.11, y - 0.01));
  P.add('dark', rod(V(x - s * 0.15, y - 0.06, z - 0.14), V(x + s * 0.16, y - 0.06, z - 0.14), 0.012, 5));
  for (const dx of [-0.15, 0.16]) P.add('dark', rod(V(x + s * dx, y - 0.08, z + 0.02), V(x + s * dx, y - 0.06, z - 0.14), 0.012, 5));
}

// Rear-view mirror on a post at a front corner of the roof (for the road)
function mirror(P, x, z) {
  const D = L1.deck;
  P.add('dark', yTube(D, D + 0.06, 0.04, 0.03, 8, x, z));
  P.add('dark', rod(V(x, D + 0.05, z), V(x, D + 0.42, z - 0.02), 0.012, 5));
  P.add('dark', zTube(z - 0.04, z + 0.02, 0.085, 0.08, 14, x, D + 0.47).applyMatrix4(xf(0, 0, 0, 0, 0, 0)));
  P.add('glass', zTube(z + 0.02, z + 0.025, 0.07, 0.07, 14, x, D + 0.47), { tint: 0x9aa4ac });
}

// D-shaped lifting eye standing on a deck at (x, y, z)
function liftEye(P, x, y, z, ry = 0) {
  P.add('dark', new THREE.TorusGeometry(0.05, 0.016, 5, 10, Math.PI).applyMatrix4(xf(x, y, z, 0, ry, 0)));
  P.add('dark', box(0.14, 0.02, 0.05, x, y + 0.01, z, 0, ry, 0));
}

// ---------------------------------------------------------------- hull

export function addHull(P) {
  const { W, deck: D, engine: E, under: U, lower: I, belly: B, mid: M } = L1;
  const [nz, ny] = L1.nose, gT = L1.glacisTop, LZ = L1.louvreZ, EZ = L1.engineZ;
  const RT = 3.2, RB = 3.3; // the upper rear plate: top (at the engine deck) and bottom (at the sponsons' underside), leaning in
  // upper hull over the full width from the glacis to the louvred corners
  P.add('camo', sideProfile([[gT, U], [gT, D], [LZ + 0.01, D], [LZ + 0.01, U]], W * 2));
  // the engine compartment between the louvred corners: the deck steps up behind the turret ring
  P.add('camo', sideProfile([[1.2, U], [1.2, D - 0.005], [EZ, E], [RT, E], [RB, U]], M * 2));
  // the louvred rear corners: chamfers from the sponson edge up to the engine deck
  for (const s of [-1, 1]) {
    const pt = (x, y, z) => V(s * x, y, z);
    P.add('camo', loft([[pt(M - 0.01, U, LZ), pt(W, U, LZ), pt(W, 1.27, LZ), pt(M - 0.01, E, LZ)], [pt(M - 0.01, U, RB), pt(W, U, RB), pt(W, 1.27, RB - 0.02), pt(M - 0.01, E, RT)]]));
  }
  // upper glacis: from the nose (narrower, the corners chamfered) up to the roof over the full width
  P.add('camo', loft([[V(-1.08, ny - 0.01, nz), V(1.08, ny - 0.01, nz), V(1.08, ny + 0.01, nz), V(-1.08, ny + 0.01, nz)], [V(-W, U, gT), V(W, U, gT), V(W, D, gT), V(-W, D, gT)]], { crease: 0.5 }));
  // lower hull between the tracks: the lower glacis, the belly, the lower rear plate
  P.add('camo', sideProfile([[nz, ny], [-2.95, B], [2.95, B], [3.26, 0.62], [RB, U], [gT, U]], I * 2));
  for (const s of [-1, 1]) P.add('camo', box(0.01, U - B - 0.06, 6.1, s * (I + 0.005), (U + B) / 2, 0.0), { tint: 0x4a4a4a }); // in the hull's shadow
  P.add('dark', box(I * 2 - 0.1, 0.03, 5.8, 0, B - 0.01, 0.0));
  // the sponsons' undersides over the tracks
  for (const s of [-1, 1]) P.add('dark', box(W - I, 0.02, RB - gT, s * (W + I) / 2, U - 0.005, (RB + gT) / 2), { tint: 0x707070 });

  // ---- front fenders over the track fronts: a plate sloping down with the glacis and the big
  // mudguard angled forward at its end, a hinge strip across (gepard_heer, gepard_munster_2026)
  for (const s of [-1, 1]) {
    const x0 = 1.05, x1 = W + 0.03, xc = s * (x0 + x1) / 2, w = x1 - x0;
    P.add('camo', sideProfile([[gT + 0.02, D - 0.02], [-3.2, 1.42], [-3.46, 1.2], [-3.59, 0.88], [-3.56, 0.87], [-3.43, 1.18], [-3.19, 1.37], [gT + 0.02, U]], w).applyMatrix4(xf(xc, 0, 0)));
    P.add('dark', box(w + 0.01, 0.025, 0.05, xc, 1.43, -3.2, -0.7)); // the mudguard's hinge
    P.add('camo', box(w, 0.03, 0.04, xc, 0.89, -3.585, -1.2), { tint: 0xc0c0c0 }); // its stiffened lower edge
  }

  // ---- glacis: four spare track shoes in the middle, headlights, tow hooks, the number plate
  const onG = (z, lift = 0) => glacisY(z) + lift / Math.cos(GLA);
  for (const [dx, dz] of [[-0.19, -2.72], [0.19, -2.72], [-0.19, -2.97], [0.19, -2.97]]) {
    P.add('dark', box(0.34, 0.06, 0.2, dx - 0.05, onG(dz, 0.04), dz, -GLA));
    P.add('rubber', box(0.13, 0.03, 0.15, dx - 0.12, onG(dz, 0.085), dz, -GLA));
    P.add('rubber', box(0.13, 0.03, 0.15, dx + 0.03, onG(dz, 0.085), dz, -GLA));
    P.add('rust', box(0.05, 0.05, 0.1, dx + 0.14, onG(dz, 0.06), dz, -GLA), { tint: 0xb0a090 });
  }
  for (const x of [-0.6, 0.5]) P.add('dark', box(0.04, 0.05, 0.62, x, onG(-2.85, 0.03), -2.85, -GLA)); // clamping bars
  for (const s of [-1, 1]) {
    headlights(P, s, -2.95);
    towHook(P, s * 0.7, -3.27);
  }
  P.add('white', box(0.52, 0.012, 0.12, 0.0, onG(-3.27, 0.005), -3.27, -GLA), { tint: 0xe8e8e0 }); // number plate
  P.add('dark', box(0.42, 0.014, 0.05, 0.02, onG(-3.27, 0.008), -3.27, -GLA), { tint: 0x5a5a5a });
  // tow cable along the glacis top edge
  const cab = new THREE.CatmullRomCurve3([V(-1.0, D + 0.03, gT - 0.05), V(-0.3, D + 0.04, gT - 0.08), V(0.3, D + 0.04, gT - 0.08), V(1.0, D + 0.03, gT - 0.05)]);
  P.add('steel', new THREE.TubeGeometry(cab, 16, 0.02, 5, false), { tint: 0x8a8a80 });
  // lower glacis: towing eyes, the seam
  const lz = (y) => nz + ((ny - y) / (ny - B)) * (-2.95 - nz);
  for (const x of [-0.45, 0.45]) {
    P.add('dark', new THREE.TorusGeometry(0.06, 0.02, 5, 10).applyMatrix4(xf(x, 0.72, lz(0.72) - 0.04, 0.8)));
    P.add('dark', box(0.12, 0.08, 0.05, x, 0.8, lz(0.8) - 0.01, 0.8));
  }
  P.add('dark', box(I * 2, 0.015, 0.02, 0, ny - 0.005, nz + 0.005));

  // ---- roof front: the driver's hatch at the right with its three periscopes, the auxiliary power
  // unit's grille at the left, mirrors on posts, lifting eyes, the turret ring housing
  {
    const x = 0.58, z = -1.95;
    P.add('camo', yTube(D, D + 0.05, 0.36, 0.36, 24, x, z), { tint: 0xd0d0d0 });
    P.add('camo', rbox(0.62, 0.05, 0.58, 0.04, x + 0.02, D + 0.075, z + 0.02), { tint: 0xc8c8c8 });
    P.add('dark', box(0.2, 0.03, 0.04, x + 0.02, D + 0.11, z + 0.12));
    for (const dx of [-0.2, 0, 0.2]) {
      P.add('dark', box(0.14, 0.08, 0.1, x + dx, D + 0.04, z - 0.36));
      P.add('glass', box(0.11, 0.045, 0.012, x + dx, D + 0.05, z - 0.415, 0.5));
    }
  }
  {
    const x = -0.72, z = -1.95;
    P.add('camo', rbox(0.66, 0.08, 0.5, 0.03, x, D + 0.03, z), { tint: 0xd0d0d0 });
    P.add('dark', box(0.54, 0.02, 0.38, x, D + 0.075, z));
    for (let i = 0; i < 7; i++) P.add('camo', box(0.54, 0.02, 0.022, x, D + 0.085, z - 0.17 + i * 0.057, 0.5), { tint: 0xc0c0c0 });
    P.add('dark', yTube(D, D + 0.14, 0.05, 0.05, 10, x - 0.42, z + 0.15)); // its exhaust stub
  }
  mirror(P, -1.42, -2.3);
  mirror(P, 1.42, -2.3);
  for (const s of [-1, 1]) {
    liftEye(P, s * 1.45, D, -2.2, Math.PI / 2);
    liftEye(P, s * 1.45, E, 3.0, Math.PI / 2);
  }
  P.add('dark', yTube(D - 0.01, L1.ringY - 0.005, 1.08, 1.06, 40, 0, L1.ring)); // ring housing
  P.add('camo', yTube(D - 0.01, D + 0.02, 1.16, 1.14, 40, 0, L1.ring), { tint: 0xc0c0c0 });

  // ---- sponson sides: the perforated stowage bins between the fender and the louvres, the rail under them
  const bins = [[-2.18, -1.98], [-1.95, -1.55], [-1.52, -0.72], [-0.69, 0.13], [0.16, 0.56], [0.59, 1.36], [1.39, 1.92]];
  for (const s of [-1, 1]) {
    for (const [z0, z1] of bins) sideBin(P, s, z0, z1, 1.27, 1.52);
    P.add('dark', box(0.05, 0.035, LZ - gT, s * (W + 0.02), 1.225, (LZ + gT) / 2));
    for (const z of [-1.6, -0.3, 1.0]) P.add('dark', box(0.04, 0.05, 0.05, s * (W + 0.04), 1.53, z)); // hasps
  }

  // ---- the louvred exhaust grilles on the rear corners (slats along the chamfer)
  const ch = Math.atan2(E - 1.27, W - M); // chamfer slope
  for (const s of [-1, 1]) {
    const zc = (LZ + RT) / 2 + 0.05, l = RT - LZ - 0.12;
    for (let i = 0; i < 8; i++) {
      const f = (i + 0.5) / 8, x = W - (W - M) * f, y = 1.27 + (E - 1.27) * f;
      P.add('dark', box(0.03, 0.04, l, s * (x + 0.01), y + 0.005, zc, 0, 0, s * (Math.PI / 2 - ch)));
      P.add('camo', box(0.012, 0.055, l, s * (x + 0.02), y + 0.02, zc, 0, 0, s * (Math.PI / 2 - ch - 0.6)), { tint: 0xa8a8a8 });
    }
    P.add('camo', box(0.05, 0.05, 0.06, s * (W - 0.01), 1.29, LZ + 0.02)); // the frame's front post
  }

  // ---- engine deck: two mesh grilles either side of the centre plates, hatch seams, the step
  for (const s of [-1, 1]) {
    const x = s * 0.62, z = 2.45, w = 0.95, d = 1.25;
    P.add('dark', box(w, 0.02, d, x, E - 0.002, z));
    for (let i = 1; i < 12; i++) P.add('steel', box(w - 0.04, 0.02, 0.012, x, E + 0.008, z - d / 2 + (d * i) / 12), { tint: 0x5e605a });
    for (let i = 1; i < 6; i++) P.add('steel', box(0.012, 0.025, d - 0.04, x - w / 2 + (w * i) / 6, E + 0.01, z), { tint: 0x5e605a });
    P.add('camo', rbox(w + 0.06, 0.03, d + 0.06, 0.015, x, E + 0.0, z), { tint: 0xc0c0c0 });
  }
  P.add('camo', rbox(0.26, 0.03, 1.3, 0.01, 0, E + 0.012, 2.45), { tint: 0xd0d0d0 });
  P.add('dark', box(M * 2, 0.012, 0.02, 0, E + 0.004, 1.7));
  P.add('dark', box(M * 2, 0.012, 0.02, 0, E + 0.004, 3.12));

  // ---- rear (gepard_firing): lamp clusters in the top corners, the two round-cornered hatches, the
  // number plate, red reflectors, the towing coupling, tow hooks, the flat mudguards behind the tracks
  const rz = (y) => RB + ((y - U) / (E - U)) * (RT - RB); // the upper rear plate's z at height y
  const lrz = (y) => 3.26 + ((y - 0.62) / (U - 0.62)) * (RB - 3.26); // the lower rear plate's z at height y
  const ra = Math.atan2(RB - RT, E - U); // its lean
  for (const s of [-1, 1]) {
    P.add('dark', rbox(0.26, 0.12, 0.08, 0.02, s * 1.0, 1.42, rz(1.42) + 0.03, -ra));
    P.add('red', zTube(rz(1.42) + 0.06, rz(1.42) + 0.075, 0.035, 0.035, 10, s * 0.94, 1.45));
    P.add('amber', zTube(rz(1.42) + 0.06, rz(1.42) + 0.075, 0.035, 0.035, 10, s * 1.06, 1.4));
    P.add('camo', rbox(0.6, 0.24, 0.03, 0.05, s * 0.45, 1.02, lrz(1.02) + 0.012), { tint: 0xd0d0d0 }); // lower plate hatches
    P.add('dark', box(0.1, 0.03, 0.04, s * 0.45, 1.06, lrz(1.06) + 0.03));
    P.add('red', zTube(lrz(0.72), lrz(0.72) + 0.02, 0.05, 0.05, 12, s * 0.62, 0.72));
    P.add('dark', rbox(0.12, 0.16, 0.12, 0.02, s * 0.85, 0.72, lrz(0.72) + 0.04));
    P.add('dark', new THREE.TorusGeometry(0.055, 0.02, 5, 10, Math.PI * 1.2).applyMatrix4(xf(s * 0.85, 0.66, lrz(0.72) + 0.11, 0, Math.PI / 2, Math.PI)));
    // rear fender over the track's end and the flat mudguard hanging from it, behind the sprocket
    P.add('camo', sideProfile([[RB - 0.02, U], [RB - 0.02, 1.25], [3.44, 1.25], [3.5, 1.19], [3.5, U - 0.04], [RB - 0.02, U - 0.04]], W - I + 0.04).applyMatrix4(xf(s * (W + I) / 2, 0, 0)));
    P.add('camo', box(W - I + 0.02, 0.62, 0.025, s * (W + I) / 2, 0.86, 3.49), { tint: 0xd0d0d0 });
    P.add('dark', box(W - I, 0.03, 0.04, s * (W + I) / 2, 1.16, 3.5));
  }
  P.add('white', box(0.5, 0.11, 0.01, -0.2, 0.86, lrz(0.86) + 0.008), { tint: 0xe8e8e0 });
  P.add('dark', box(0.4, 0.05, 0.012, -0.2, 0.86, lrz(0.86) + 0.012), { tint: 0x5a5a5a });
  P.add('dark', rbox(0.24, 0.16, 0.18, 0.03, 0.12, 0.72, lrz(0.72) + 0.06)); // towing coupling
  P.add('dark', zTube(lrz(0.72) + 0.1, lrz(0.72) + 0.2, 0.05, 0.05, 10, 0.12, 0.72));
  P.add('dark', box(M * 2, 0.015, 0.015, 0, U, RB + 0.005));
  for (const s of [-1, 1]) liftEye(P, s * 0.8, E, RT - 0.08);
}

export function buildChassis(P) {
  addHull(P);
  return addRunningGear(P);
}
