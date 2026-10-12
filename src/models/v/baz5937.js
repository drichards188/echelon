import * as THREE from 'three';
import { V, box, rbox, yTube, zTube, xTube, sphere, rod, lathe, sideProfile, xf } from '../kit.js';
import { smoothstep } from '../../noise.js';

// BAZ-5937 6x6 amphibious chassis of the 9A33BM3 Osa-AKM: a slab-sided boat hull with a planing
// prow, a raked stern, wheels in trapezoid wells and the crew cab at the front. Proportions are read
// off side and front photos scaled to the published 9.14 m overall length and 2.75 m width.
// Model space: front -Z, z = 0 at mid-hull, ground y = 0, metres.

export const HULL = {
  hw: 1.375, // half width
  bot: 0.6, // hull bottom (the axles hang lower)
  top: 1.93, // deck / gunwale
  front: -4.36, // stem
  rear: 4.36, // stern slab
  axles: [-2.43, 0.26, 2.74], // uneven spacing: 2.69 then 2.48
  R: 0.57, // 1.14 m tyres
  W: 0.42,
  track: 1.12, // wheel centre x
  archTop: 1.25,
  keel: 0.86, // half width of the hull between the wheel wells
};

const lerp = (a, b, t) => a + (b - a) * t;
const ramp = (y, y0, y1) => Math.min(1, Math.max(0, (y - y0) / (y1 - y0)));

// Front of the hull at height y: the lower bow plate (27 deg), the stem lip, the bow deck that
// carries the trim vane, then the windscreen face, raked about 26 deg, up to the roof.
export const BELT = 1.5; // cab beltline: above it the cab sides lean in
const STEM = [1.1, 1.26]; // the short vertical stem face under the lid's front edge, where the lamps sit
function bowZ(y) {
  if (y <= STEM[0]) return lerp(-3.24, HULL.front, ramp(y, HULL.bot, STEM[0]));
  if (y <= STEM[1]) return HULL.front;
  if (y <= 1.42) return lerp(HULL.front, -3.45, ramp(y, STEM[1], 1.42));
  return lerp(-3.45, -3.2, ramp(y, 1.42, HULL.top));
}

// Bow and cab corners at height y, as [front edge half width, z where the corner face meets the
// full-width side]. The stem is narrower than the hull; above the beltline the cab corners are cut
// back at about 45 deg into the faces that carry the corner windows.
function bowCorner(y, zf, W) {
  const k = [[HULL.bot, 0.95, 0], [STEM[0], 1.18, 0.3], [STEM[1], 1.18, 0.3], [1.42, 1.22, 0.16], [BELT, 1.2, 0.18], [HULL.top, 0.92, 0.46]];
  let i = 0;
  while (i < k.length - 2 && y > k[i + 1][0]) i++;
  const t = ramp(y, k[i][0], k[i + 1][0]);
  return [Math.min(lerp(k[i][1], k[i + 1][1], t), W), zf + lerp(k[i][2], k[i + 1][2], t)];
}
const cabCorner = (y) => { const zf = bowZ(y), [xf, zs] = bowCorner(y, zf, HULL.hw); return [V(xf, y, zf), V(HULL.hw, y, zs)]; };

// Plan outline of the hull at height y as a ring of points (same count at every height, so the
// rings can be skinned). The wheel wells are notches in to the keel; `closed` puts their points back
// on the side (above the arches) so the step between an open and a closed ring is the well roof.
function hullRing(y, closed, inset = 0) {
  const { hw, bot, keel, axles, archTop } = HULL;
  const W = lerp(1.17, hw, ramp(y, bot, 0.85)) - inset; // chine below the knuckle line
  const zf = bowZ(y);
  const [xf, zs] = bowCorner(y, zf, W);
  const zr = lerp(3.82, HULL.rear, ramp(y, bot, 0.94)); // stern rake under the slab
  const h = lerp(0.8, 0.55, ramp(y, bot, archTop)); // wells are trapezoids, wider at the bottom
  const right = [[xf, zf], [W, zs]];
  for (const c of axles) {
    const za = Math.max(c - h, zs), k = closed ? W : keel;
    right.push([W, za], [k, za], [k, c + h], [W, c + h]);
  }
  right.push([W, zr - 0.12], [W - 0.1, zr]);
  const left = right.slice().reverse().map(([x, z]) => [-x, z]);
  return [...right, ...left].map(([x, z]) => V(x, y, z));
}

// Skin a stack of rings (same point count, bottom to top) into a closed solid with flat faces.
// Rings may be non-convex (the wells), so the side winding comes from the ring's signed area and
// the caps are triangulated with ShapeUtils, then turned to face down / up.
export function skinRings(rings, { bottom = true, top = true, hole = null } = {}) {
  const out = [];
  const r0 = rings[0];
  let area = 0;
  for (let i = 0; i < r0.length; i++) { const a = r0[i], b = r0[(i + 1) % r0.length]; area += a.x * b.z - b.x * a.z; }
  const flip = area > 0;
  const e1 = new THREE.Vector3(), e2 = new THREE.Vector3();
  const tri = (a, b, c) => {
    if (flip) [b, c] = [c, b];
    e1.subVectors(b, a);
    e2.subVectors(c, a);
    if (e1.cross(e2).lengthSq() < 1e-10) return;
    out.push(a, b, c);
  };
  for (let k = 0; k < rings.length - 1; k++) {
    const A = rings[k], B = rings[k + 1];
    for (let i = 0; i < A.length; i++) {
      const j = (i + 1) % A.length;
      tri(A[i], A[j], B[j]);
      tri(A[i], B[j], B[i]);
    }
  }
  // hole: an optional [[x, z], ...] outline cut out of the top cap (the 9T217's cargo bay)
  const cap = (ring, up, cut = null) => {
    const pts = [];
    for (const p of ring) if (!pts.length || p.distanceToSquared(pts[pts.length - 1]) > 1e-8) pts.push(p);
    if (pts[0].distanceToSquared(pts[pts.length - 1]) < 1e-8) pts.pop();
    const holes = cut ? [cut.map(([x, z]) => new THREE.Vector2(x, z))] : [];
    if (cut) for (const [x, z] of cut) pts.push(V(x, ring[0].y, z));
    const idx = THREE.ShapeUtils.triangulateShape(pts.slice(0, pts.length - (cut ? cut.length : 0)).map((p) => new THREE.Vector2(p.x, p.z)), holes);
    for (const [a, b, c] of idx) {
      e1.subVectors(pts[b], pts[a]);
      e2.subVectors(pts[c], pts[a]);
      const ny = e1.cross(e2).y;
      if (Math.abs(ny) < 1e-10) continue;
      if ((ny > 0) === up) out.push(pts[a], pts[b], pts[c]); else out.push(pts[a], pts[c], pts[b]);
    }
  };
  if (bottom) cap(rings[0], false);
  if (top) cap(rings[rings.length - 1], true, hole);
  const g = new THREE.BufferGeometry().setFromPoints(out);
  g.computeVertexNormals();
  return g;
}

// A thin strip (box) between two points, its width across `side` (a unit vector), for ribs and lips.
function strip(a, b, w, t, side = V(1, 0, 0)) {
  const d = b.clone().sub(a), len = d.length();
  const zAxis = d.normalize(), xAxis = side.clone().normalize(), yAxis = zAxis.clone().cross(xAxis).normalize();
  xAxis.copy(yAxis).cross(zAxis);
  const m = new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis).setPosition(a.clone().add(b).multiplyScalar(0.5));
  return new THREE.BoxGeometry(t, w, len).applyMatrix4(m);
}

// Low-pressure 1300-section tyre about the x axis: a tall rounded sidewall (the disc is only about
// half the diameter) and a chunky chevron tread cut into the radius so the lugs read in silhouette.
// Adapted from kit's tyreGeometry, which has the shallow sidewall of a road truck tyre.
export function bazTyre(R, W, lugs = 16, seg = 48) {
  const h = R * 0.46, Rr = R - h;
  const prof = [[-0.92, Rr], [-1.04, Rr + 0.3 * h], [-1.06, Rr + 0.6 * h], [-0.96, R - 0.16 * h], [-0.78, R - 0.04 * h], [-0.5, R], [0, R], [0.5, R], [0.78, R - 0.04 * h], [0.96, R - 0.16 * h], [1.06, Rr + 0.6 * h], [1.04, Rr + 0.3 * h], [0.92, Rr]];
  const M = prof.length, pos = [], idx = [];
  for (let i = 0; i < seg; i++) {
    const a = (i / seg) * Math.PI * 2;
    for (let j = 0; j < M; j++) {
      let [u, r] = prof[j];
      if (Math.abs(u) < 0.98 && r > R - 0.2 * h) {
        const f = (((i / seg) * lugs + Math.sign(u || 1) * Math.abs(u) * 0.45) % 1 + 1) % 1;
        const groove = smoothstep(0.45, 0.55, f) * (1 - smoothstep(0.9, 1.0, f));
        r -= groove * R * 0.05 * smoothstep(0.0, 0.15, Math.abs(u));
      }
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

// Wheel disc of the BAZ: a deep dish inside the bead seat, a raised hub with eight nuts and the
// central tyre inflation elbow. side = +1 faces +X.
export function bazHub(P, x, y, z, side) { hub(P, x, y, z, side); }
function hub(P, x, y, z, side) {
  const { R, W } = HULL;
  const Rr = R * 0.54;
  const rot = xf(x + side * (W * 0.5 - 0.03), y, z, 0, 0, -side * Math.PI / 2);
  // profiles run from the rim inward so the lathe faces point out of the wheel
  P.add('rim', lathe([[Rr + 0.01, -0.08], [Rr + 0.01, 0.0], [Rr, 0.03], [Rr * 0.96, 0.03], [Rr * 0.9, 0.0], [Rr * 0.82, -0.06], [0.17, -0.07], [0.15, -0.05], [0.001, -0.05]], 24).applyMatrix4(rot));
  P.add('rim', lathe([[0.12, -0.05], [0.12, 0.02], [0.095, 0.05], [0.07, 0.07], [0.001, 0.07]], 14).applyMatrix4(rot));
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    P.add('rim', xTube(x + side * (W * 0.5 - 0.08), x + side * (W * 0.5 - 0.02), 0.02, 0.02, 6, y + Math.cos(a) * 0.155, z + Math.sin(a) * 0.155));
  }
  // inflation line from the hub cap out to the valve near the rim
  const xo = x + side * (W * 0.5 + 0.045);
  P.add('steel', rod(V(xo, y, z), V(xo, y + 0.05, z + 0.12), 0.012, 5));
  P.add('steel', rod(V(xo, y + 0.05, z + 0.12), V(x + side * (W * 0.5 - 0.0), y + 0.2, z + 0.16), 0.012, 5));
}

// Hull, running gear and the fittings on it, into the parts collector. Options (all true for the Osa):
// wheels (the tyres and discs; the 9T217 draws its own turning ones), ring (the turret ring), hatches
// (the cab roof hatch lids; the 9T217 hinges its own).
export function buildBaz(P, { wheels = true, ring = true, hatches = true, deckHole = null } = {}) {
  const { hw, bot, top, axles, R, W, track, archTop, keel } = HULL;

  // ---- hull shell (deckHole: [[x, z], ...] cut out of the deck, the 9T217's bay)
  const levels = [[bot, false], [0.85, false], [0.94, false], [STEM[0], false], [archTop, false], [archTop, true], [STEM[1], true], [1.42, true], [BELT, true], [1.89, true]];
  const rings = levels.map(([y, c]) => hullRing(y, c));
  rings.push(hullRing(top, true, 0.035)); // rounded gunwale edge
  P.add('camo', skinRings(rings, { hole: deckHole }));

  // ---- running gear: tyres, discs, suspension arms (independent torsion bars) and hub reduction housings
  for (const z of axles) for (const s of [-1, 1]) {
    if (wheels) {
      P.add('tyre', bazTyre(R, W).applyMatrix4(xf(s * track, R, z)));
      hub(P, s * track, R, z, s);
    }
    P.add('dark', xTube(s * (track - W * 0.5 - 0.02), s * (track - W * 0.5 - 0.16), 0.14, 0.12, 12, R, z));
    for (const dz of [-0.16, 0.16]) P.add('dark', rod(V(s * (keel - 0.05), bot + 0.12, z + dz), V(s * (track - W * 0.5 - 0.1), R + 0.02, z + dz * 0.4), 0.045, 6));
    P.add('dark', yTube(R + 0.05, archTop, 0.06, 0.06, 8, s * (track - W * 0.5 - 0.12), z + 0.28)); // damper
  }
  for (const z of axles) P.add('dark', sphere(0.2, 0, bot - 0.04, z, 1.4, 0.6, 1.2, 10)); // final drives under the hull
  // dark liners in the wheel wells: the inboard wall and the roof
  for (const c of axles) for (const s of [-1, 1]) {
    P.add('dark', box(0.02, archTop - bot - 0.04, 1.5, s * (keel + 0.012), (archTop + bot) / 2, c));
    P.add('dark', box(hw - keel - 0.02, 0.02, 1.08, s * (hw + keel) / 2, archTop - 0.012, c));
  }

  // ---- side ribs: three pressed flutes the full length, a fourth between the wells, the gunwale rail
  for (const s of [-1, 1]) {
    const x = s * (hw + 0.012), sd = V(s, 0, 0);
    // pressed flutes: half-round ridges standing proud of the plate
    const flute = (y, z0, z1, r = 0.032) => P.add('camo', zTube(z0, z1, r, r, 8, s * (hw - r * 0.3), y));
    for (const [y, z0] of [[1.82, -2.05], [1.54, -2.12], [1.25, -3.45]]) flute(y, z0, HULL.rear - 0.14);
    const h = 0.8 - (0.98 - bot) / (archTop - bot) * 0.25;
    const spans = [[-3.6, axles[0] - h], [axles[0] + h, axles[1] - h], [axles[1] + h, axles[2] - h], [axles[2] + h, HULL.rear - 0.14]];
    for (const [z0, z1] of spans) flute(0.98, z0 + 0.04, z1 - 0.04);
    flute(0.8, -3.5, HULL.rear - 0.25, 0.025); // chine knuckle
    // wheel-well lips: a flat flange round each trapezoid
    for (const c of axles) {
      const lo = 0.8, hi = 0.55;
      const pts = [V(x, bot + 0.02, c - lo), V(x, archTop, c - hi), V(x, archTop, c + hi), V(x, bot + 0.02, c + lo)];
      if (c === axles[0]) pts[0] = V(x, 0.7, c - lo + 0.03);
      for (let i = 0; i < 3; i++) P.add('camo', strip(pts[i], pts[i + 1], 0.07, 0.04, sd));
    }
  }

  // ---- bow: trim vane lid on the deck, stem fittings, lamps
  const deckAt = (z) => lerp(STEM[1], 1.42, ramp(z, HULL.front, -3.45));
  {
    const z0 = -4.3, z1 = -3.52, a = Math.atan2(1.42 - STEM[1], -3.45 - HULL.front);
    P.add('camo', rbox(2.25, 0.05, z1 - z0, 0.02, 0, (deckAt(z0) + deckAt(z1)) / 2 + 0.04, (z0 + z1) / 2, a));
    for (const s of [-1, 1]) P.add('dark', box(0.12, 0.06, 0.1, s * 0.9, deckAt(z0) + 0.03, z0 + 0.02)); // lid hinges at the stem
    P.add('steel', rod(V(-0.7, deckAt(-3.9) + 0.09, -3.9), V(0.7, deckAt(-3.9) + 0.09, -3.9), 0.012, 5)); // grab bar
  }
  for (const s of [-1, 1]) {
    // headlamps in housings on the stem corners under the lid's edge, behind wire guards
    const x = s * 1.0, z = HULL.front + 0.14, y = 1.17;
    P.add('camo', rbox(0.38, 0.2, 0.3, 0.03, x, y, z));
    for (const dx of [-0.09, 0.09]) {
      P.add('dark', zTube(z - 0.15, z - 0.19, 0.075, 0.07, 12, x + dx, y));
      P.add('lens', zTube(z - 0.19, z - 0.2, 0.06, 0.06, 12, x + dx, y));
    }
    for (const dy of [-0.06, 0, 0.06]) P.add('steel', rbox(0.38, 0.015, 0.015, 0.006, x, y + dy, z - 0.24));
    for (const dx of [-0.17, 0, 0.17]) P.add('steel', rod(V(x + dx, y + 0.09, z - 0.16), V(x + dx, y - 0.09, z - 0.24), 0.008, 4));
    P.add('amber', box(0.06, 0.06, 0.02, s * 1.22, 1.2, HULL.front + 0.11)); // side marker on the stem
    // tow hooks hanging under the stem lip
    P.add('steel', rbox(0.12, 0.14, 0.14, 0.02, s * 0.5, 1.0, HULL.front + 0.2));
    P.add('steel', new THREE.TorusGeometry(0.06, 0.017, 6, 12).rotateY(Math.PI / 2).translate(s * 0.5, 0.9, HULL.front + 0.16));
    // round bosses on the bow side ahead of the front wheel (sockets and the blackout lamp), a lower
    // one and a small box behind them
    const bx = s * (hw + 0.005);
    for (const [z, r, y] of [[-3.3, 0.055, 1.33], [-3.45, 0.055, 1.33], [-3.63, 0.07, 1.33], [-3.45, 0.06, 1.03]]) {
      P.add('camo', xTube(bx, bx + s * 0.04, r, r, 12, y, z));
      P.add('dark', xTube(bx + s * 0.04, bx + s * 0.045, r * 0.6, r * 0.6, 10, y, z));
    }
    P.add('camo', rbox(0.06, 0.16, 0.16, 0.02, s * (hw + 0.02), 1.35, -3.05));
    P.add('dark', box(0.02, 0.08, 0.08, s * (hw + 0.05), 1.35, -3.05));
  }
  // stiffeners down the lower bow plate and one across it
  {
    const a = Math.atan2(STEM[0] - bot, HULL.front + 3.24), len = Math.hypot(STEM[0] - bot, HULL.front + 3.24);
    for (const x of [-0.75, -0.25, 0.25, 0.75]) P.add('camo', box(0.06, 0.04, len - 0.1, x, (STEM[0] + bot) / 2 - 0.01, (HULL.front - 3.24) / 2 - 0.02, -a));
    P.add('camo', box(2.0, 0.05, 0.05, 0, 0.97, -3.9, -a));
  }

  // ---- cab: windscreens in the raked face, side windows in the cut corners, roof hatches
  {
    const yb = 1.45, yt = 1.89, zb = bowZ(yb), zt = bowZ(yt);
    const a = Math.atan2(zb - zt, yt - yb); // rake of the windscreen face
    const len = Math.hypot(zb - zt, yt - yb);
    for (const s of [-1, 1]) {
      const cx = s * 0.53, cy = (yb + yt) / 2, cz = (zb + zt) / 2 - 0.012;
      P.add('dark', rbox(1.0, len + 0.02, 0.03, 0.06, cx, cy, cz + 0.004, -a));
      P.add('glass', rbox(0.92, len - 0.07, 0.02, 0.07, cx, cy, cz - 0.01, -a));
      P.add('steel', rod(V(cx - s * 0.2, yt - 0.03, zt - 0.03), V(cx + s * 0.1, yb + 0.06, zb - 0.06), 0.008, 4)); // wiper
    }
    P.add('dark', box(0.1, len, 0.04, 0, (yb + yt) / 2, (zb + zt) / 2 - 0.01, -a)); // centre pillar
    // roof visor over the windscreens
    P.add('camo', box(2.1, 0.04, 0.16, 0, top - 0.01, bowZ(top) - 0.05));
    // corner windows in the cut-back cab corners
    for (const s of [-1, 1]) {
      const [a0, b0] = cabCorner(BELT + 0.05), [a1, b1] = cabCorner(1.87);
      const n = a1.clone().sub(a0).cross(b0.clone().sub(a0)).normalize(); // outward for the right side
      const q = [a0.lerp(b0, 0.1), b0.lerp(a0, 0.12), b1.lerp(a1, 0.1), a1.lerp(b1, 0.1)].map((p) => p.addScaledVector(n, 0.012));
      const m = (p) => V(s * p.x, p.y, p.z);
      const tri = s > 0 ? [q[0], q[2], q[1], q[0], q[3], q[2]] : [q[0], q[1], q[2], q[0], q[2], q[3]];
      const g = new THREE.BufferGeometry().setFromPoints(tri.map(m));
      g.computeVertexNormals();
      P.add('glass', g);
      for (let i = 0; i < 4; i++) P.add('dark', rod(m(q[i]), m(q[(i + 1) % 4]), 0.022, 4));
      // wing mirror on a stalk at the corner
      const mx = s * 1.45, mz = -3.05;
      P.add('dark', rod(V(s * 1.2, 1.62, -3.25), V(mx, 1.95, mz), 0.015, 5));
      P.add('dark', rbox(0.04, 0.3, 0.2, 0.02, mx, 2.07, mz));
      P.add('glass', box(0.01, 0.26, 0.16, mx - s * 0.022, 2.07, mz));
    }
    // ventilation box on the cab roof behind the windscreens (louvred front, grille top), with the
    // commander's and driver's hatches either side of it
    P.add('camo', sideProfile([[-2.82, 0], [-2.74, 0.44], [-1.96, 0.44], [-1.9, 0]], 0.96, 0.03).translate(0, top - 0.02, 0));
    for (let i = 0; i < 4; i++) P.add('dark', box(0.8, 0.03, 0.03, 0, top + 0.08 + i * 0.09, -2.79 + i * 0.016, 0.18));
    P.add('dark', box(0.8, 0.02, 0.6, 0, top + 0.42, -2.33));
    for (let i = 0; i < 6; i++) P.add('camo', box(0.82, 0.03, 0.03, 0, top + 0.44, -2.58 + i * 0.1));
    for (const s of hatches ? [-1, 1] : []) {
      P.add('camo', rbox(0.46, 0.07, 0.6, 0.025, s * 0.8, top + 0.03, -2.35));
      P.add('dark', box(0.48, 0.02, 0.62, s * 0.8, top + 0.0, -2.35));
      P.add('steel', rod(V(s * 0.65, top + 0.09, -2.2), V(s * 0.95, top + 0.09, -2.2), 0.014, 5));
      P.add('dark', box(0.06, 0.06, 0.1, s * 0.58, top + 0.05, -2.35)); // hinge
      for (const dx of [-0.1, 0.1]) P.add('glass', box(0.1, 0.05, 0.02, s * 0.8 + dx, top + 0.07, -2.71));
      P.add('dark', box(0.34, 0.08, 0.08, s * 0.8, top + 0.05, -2.67));
    }
    // whip aerial on the front right corner (osa_02, osa_20, osa_21), base on the deck edge
    P.add('dark', yTube(1.3, 1.5, 0.05, 0.04, 8, 1.2, -3.72));
    P.add('dark', yTube(1.5, 3.4, 0.012, 0.005, 5, 1.2, -3.72));
  }

  // ---- deck: turret ring and the equipment and engine decks behind it
  if (ring) P.add('dark', yTube(top - 0.02, top + 0.04, 1.08, 1.08, 32, 0, 0.15));
  {
    // engine grilles over the rear deck, with louvres
    P.add('dark', box(1.5, 0.03, 1.6, 0, top + 0.01, 3.15));
    for (let i = 0; i < 12; i++) P.add('camo', box(1.45, 0.025, 0.06, 0, top + 0.04, 2.45 + i * 0.13, 0.5));
    for (const s of [-1, 1]) P.add('camo', box(0.06, 0.07, 1.65, s * 0.77, top + 0.04, 3.15));
    // stowage rack on the right of the rear deck
    for (const z of [3.15, 3.65, 4.15]) P.add('steel', yTube(top, top + 0.14, 0.015, 0.015, 5, 1.12, z));
    P.add('steel', rod(V(1.12, top + 0.14, 3.1), V(1.12, top + 0.14, 4.2), 0.018, 5));
    P.add('steel', rod(V(0.86, top + 0.14, 3.1), V(0.86, top + 0.14, 4.2), 0.018, 5));
    for (const z of [3.15, 3.65, 4.15]) P.add('steel', rod(V(0.86, top + 0.14, z), V(1.12, top + 0.14, z), 0.014, 4));
    P.add('dark', rbox(0.24, 0.1, 1.0, 0.03, 0.99, top + 0.2, 3.65)); // folded ladder on the rack
    // spare parts boxes on the left
    P.add('camo', rbox(0.5, 0.3, 0.9, 0.04, -1.0, top + 0.15, 3.65));
    P.add('dark', box(0.52, 0.03, 0.04, -1.0, top + 0.2, 3.45));
  }
  // side fittings: access plates, cable box, a fuel filler and the tool clips
  for (const s of [-1, 1]) {
    const x = s * (hw + 0.008);
    P.add('camo', rbox(0.03, 0.34, 0.85, 0.02, x, 1.43, 3.35));
    P.add('camo', rbox(0.03, 0.4, 0.45, 0.02, x, 1.6, 1.1));
    P.add('dark', box(0.035, 0.12, 0.12, x, 1.66, -1.4));
    P.add('steel', xTube(x, x + s * 0.03, 0.06, 0.06, 10, 1.7, 2.3));
  }

  // ---- stern: grille box, lamps, propeller cover, door, exhaust cowl on the right, tow eye
  const zr = HULL.rear;
  P.add('camo', rbox(0.75, 0.32, 0.22, 0.03, 0.45, 1.78, zr + 0.06));
  for (let i = 0; i < 3; i++) P.add('dark', box(0.2, 0.22, 0.04, 0.2 + i * 0.24, 1.78, zr + 0.17));
  for (const s of [-1, 1]) {
    P.add('dark', rbox(0.12, 0.34, 0.08, 0.02, s * 1.18, 1.62, zr + 0.03));
    P.add('red', box(0.08, 0.12, 0.02, s * 1.18, 1.7, zr + 0.075));
    P.add('amber', box(0.08, 0.08, 0.02, s * 1.18, 1.54, zr + 0.075));
  }
  P.add('camo', zTube(zr, zr + 0.05, 0.3, 0.3, 20, -0.5, 1.1)); // water propeller access cover
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    P.add('dark', rod(V(-0.5, 1.1, zr + 0.06), V(-0.5 + Math.cos(a) * 0.27, 1.1 + Math.sin(a) * 0.27, zr + 0.06), 0.015, 4));
  }
  P.add('camo', rbox(0.62, 0.6, 0.05, 0.08, 0.42, 1.18, zr + 0.02)); // rear access door
  P.add('dark', box(0.5, 0.025, 0.02, 0.42, 1.0, zr + 0.05));
  P.add('dark', box(0.5, 0.025, 0.02, 0.42, 1.3, zr + 0.05));
  P.add('steel', rbox(0.16, 0.12, 0.12, 0.02, 0, 0.98, zr + 0.06));
  P.add('steel', new THREE.TorusGeometry(0.07, 0.018, 6, 12).translate(0, 0.86, zr + 0.11));
  // exhaust cowl sticking out of the right rear corner
  P.add('dark', zTube(zr - 0.1, zr + 0.36, 0.15, 0.17, 14, 1.12, 1.5));
  P.add('dark', zTube(zr + 0.36, zr + 0.44, 0.17, 0.19, 14, 1.12, 1.5, true));
  P.add('steel', box(0.05, 0.3, 0.3, 1.12, 1.5, zr + 0.1));
}
