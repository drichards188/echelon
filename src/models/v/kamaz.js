import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { V, DEG, xf, box, yTube, zTube, xTube, sphere, rod, lathe, loft, mudguard, sideProfile } from '../kit.js';
import { mudFlap } from '../trucks.js';

// Rounded box with one segment per edge (108 triangles; the kit's rbox costs 300).
export const rb = (w, h, d, r, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) =>
  new RoundedBoxGeometry(w, h, d, 1, Math.min(r, w / 2 - 1e-3, h / 2 - 1e-3, d / 2 - 1e-3)).applyMatrix4(xf(x, y, z, rx, ry, rz));

// KamAZ-6560 8x8 (the Pantsir-S1 carrier): forward-control day cab, black steel disc wheels on
// 425/85 R21 big-lug tyres, axle spacing 1.85 / 3.15 / 1.3 (the rear pair nearly touch), frame,
// steps, bumper box. Measured from side and front photos with the tyre as the ruler.
// Model space: front -Z, right +X, ground y = 0. Everything goes into a Parts collector.

export const KAMAZ = { R: 0.64, W: 0.44, track: 1.025, axles: [-3.08, -1.23, 1.92, 3.22], frameTop: 1.22, rail: 0.48 };

// Tyre about the x axis: a rounded section with staggered tread blocks (two rows offset by half a
// pitch, the shoulders stepped so the lugs read in silhouette).
export function kamazTyre(R = KAMAZ.R, W = KAMAZ.W, lugs = 14, seg = 56) {
  const h = R * 0.32, Rr = R - h, G = R * 0.06;
  // [u across the width, radius, zone]: 0 sidewall, 1 shoulder, 2 tread
  const prof = [[-0.97, Rr, 0], [-1.06, Rr + 0.4 * h, 0], [-1.02, Rr + 0.78 * h, 0], [-0.93, R - 0.1 * h, 1], [-0.78, R, 2], [-0.1, R, 2],
    [0.1, R, 2], [0.78, R, 2], [0.93, R - 0.1 * h, 1], [1.02, Rr + 0.78 * h, 0], [1.06, Rr + 0.4 * h, 0], [0.97, Rr, 0]];
  const M = prof.length, pos = [], idx = [];
  const half = seg / lugs / 2;
  for (let i = 0; i < seg; i++) {
    const a = (i / seg) * Math.PI * 2;
    for (let j = 0; j < M; j++) {
      let [u, r, zone] = prof[j];
      if (zone) {
        const ph = ((((i + (u > 0 ? half : 0)) / seg) * lugs) % 1 + 1) % 1;
        const lug = ph < 0.45;
        if (zone === 2 && !lug) r -= G;
        if (zone === 1) r += lug ? G * 0.25 : -G * 0.7;
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

// Black steel disc wheel on the outer face (side = +1 for +X): dished disc with its rim lip, ten
// nuts, the hub boss and the central tyre inflation valve with its hose.
export function kamazHub(P, x, y, z, side, R = KAMAZ.R, W = KAMAZ.W) {
  const Rr = R * 0.66, xo = x + side * (W * 0.5 - 0.03);
  const M = xf(xo, y, z, 0, 0, -side * Math.PI / 2);
  // the profile runs from the rim inward so the faces point out of the wheel
  P.add('dark', lathe([[Rr * 0.9, -0.14], [Rr * 1.02, -0.02], [Rr, 0.02], [Rr * 0.96, -0.02], [0.33, -0.04], [0.27, -0.06], [0.16, -0.02], [0.13, 0.0], [0.001, 0.0]], 20).applyMatrix4(M));
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    P.add('dark', box(0.035, 0.035, 0.035, xo + side * 0.015, y + Math.cos(a) * 0.15, z + Math.sin(a) * 0.15, a));
  }
  P.add('dark', xTube(xo, xo + side * 0.09, 0.1, 0.085, 14, y, z)); // hub boss
  P.add('steel', xTube(xo + side * 0.09, xo + side * 0.11, 0.05, 0.04, 10, y, z));
  P.add('steel', rod(V(xo + side * 0.1, y, z), V(xo + side * 0.06, y + 0.25, z + 0.05), 0.012, 5)); // inflation line
}

export function kamazWheel(P, x, y, z, side, R = KAMAZ.R, W = KAMAZ.W) {
  P.add('tyre', kamazTyre(R, W).applyMatrix4(xf(x, y, z)));
  kamazHub(P, x, y, z, side, R, W);
}

// Axles, wheels, springs, final drives, propeller shafts and steering on the first two axles
// (wheels: false leaves the wheels out, for a truck that draws them turning, see t22t6.js spinWheels).
export function kamazRunningGear(P, { R = KAMAZ.R, W = KAMAZ.W, track = KAMAZ.track, axles = KAMAZ.axles, wheels = true } = {}) {
  axles.forEach((z, i) => {
    for (const s of [-1, 1]) {
      if (wheels) kamazWheel(P, s * track, R, z, s, R, W);
      P.add('dark', xTube(s * (track - W * 0.5 + 0.02), s * (track - W * 0.5 - 0.16), 0.13, 0.11, 12, R, z)); // wheel hub reduction
      P.add('dark', yTube(R - 0.06, R + 0.2, 0.07, 0.07, 8, s * (track - 0.42), z + 0.22)); // brake chamber
      if (i < 2) { // leaf springs (front pair)
        P.add('dark', box(0.09, 0.07, 1.25, s * 0.52, R + 0.2, z));
        P.add('dark', box(0.09, 0.05, 0.9, s * 0.52, R + 0.27, z));
        P.add('dark', box(0.09, 0.04, 0.5, s * 0.52, R + 0.32, z));
      }
    }
    P.add('dark', xTube(-track + 0.3, track - 0.3, 0.075, 0.075, 10, R, z));
    P.add('dark', sphere(0.2, 0, R, z, 1.0, 0.9, 1.1, 12)); // differential
    if (i < 2) P.add('dark', xTube(-track + 0.35, track - 0.35, 0.022, 0.022, 6, R - 0.05, z - 0.36)); // track rod
  });
  // rear bogie: leaf springs on a trunnion between the two rear axles, torque rods
  const zb = (axles[2] + axles[3]) / 2;
  for (const s of [-1, 1]) {
    P.add('dark', box(0.1, 0.08, 1.55, s * 0.52, R + 0.18, zb));
    P.add('dark', box(0.1, 0.06, 1.1, s * 0.52, R + 0.26, zb));
    P.add('dark', xTube(s * 0.4, s * 0.62, 0.11, 0.11, 12, R + 0.3, zb));
    for (const zz of [axles[2], axles[3]]) P.add('dark', rod(V(s * 0.3, R + 0.05, zz), V(s * 0.3, R + 0.42, zb), 0.03, 6));
  }
  for (let i = 0; i < axles.length - 1; i++) {
    P.add('dark', zTube(axles[i] + 0.22, axles[i + 1] - 0.22, 0.045, 0.045, 8, 0, R + 0.08));
    P.add('steel', sphere(0.07, 0, R + 0.08, axles[i] + 0.22, 1, 1, 1, 8));
  }
  P.add('dark', box(0.55, 0.45, 0.7, 0, 0.95, (axles[1] + axles[2]) / 2 - 0.3)); // transfer case
}

// Ladder frame rails from z0 to z1 with cross members.
export function kamazFrame(P, z0, z1, top = KAMAZ.frameTop, rail = KAMAZ.rail) {
  const len = z1 - z0, cz = (z0 + z1) / 2;
  for (const s of [-1, 1]) {
    P.add('dark', box(0.1, 0.3, len, s * rail, top - 0.15, cz));
    P.add('dark', box(0.16, 0.025, len, s * (rail - 0.03), top - 0.29, cz));
  }
  for (let z = z0 + 0.3; z < z1; z += 1.4) P.add('dark', box(rail * 2, 0.12, 0.1, 0, top - 0.15, z));
}

// Rounded-rectangle ring in plan at height y: half-width hw, front z0, rear z1, corner radius r.
function rrRing(hw, z0, z1, r, y, n = 3) {
  const out = [];
  const corners = [[hw - r, z0 + r, -90], [hw - r, z1 - r, 0], [-hw + r, z1 - r, 90], [-hw + r, z0 + r, 180]];
  for (const [cx, cz, a0] of corners) for (let k = 0; k < n; k++) {
    const a = (a0 + (90 * k) / (n - 1)) * DEG;
    out.push(V(cx + Math.cos(a) * r, y, cz + Math.sin(a) * r));
  }
  return out;
}

// Five-pointed star decal facing +X (side = 1) or -X, centre (y, z), outer radius r.
export function starDecal(P, key, side, x, y, z, r, tint) {
  const s = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const a = Math.PI / 2 + (i / 10) * Math.PI * 2, rr = i % 2 ? r * 0.4 : r;
    const px = Math.cos(a) * rr, py = Math.sin(a) * rr;
    if (i) s.lineTo(px, py); else s.moveTo(px, py);
  }
  const g = new THREE.ShapeGeometry(s).applyMatrix4(xf(x, y, z, 0, side * Math.PI / 2, 0));
  P.add(key, g, tint === undefined ? {} : { tint });
}

// The KamAZ-6560 day cab, 2.2 m wide (narrower than the 2.5 m body and wheels, photo 03); zf is the
// front face, zr the rear wall. Flat front with a slightly raked one-piece windscreen, crowned roof
// with a round hatch, a spotlight on the right front corner and a beacon on the left (photos 02,
// 07), big black mirrors on arms, grille band with round headlamps, the steel bumper box with its
// lamps, step and tow hooks, and the deep fenders under the doors with the steps in their front part.
export function kamazCab(P, { zf = -4.18, zr = -2.53, bumper = -4.4, a1 = KAMAZ.axles[0], star = true } = {}) {
  const hw = 1.1, top = 3.18;
  // shell: rounded vertical corners, vertical lower front, raked screen, crowned roof
  P.add('camo', loft([
    rrRing(hw, zf, zr, 0.12, 1.45),
    rrRing(hw, zf, zr, 0.12, 1.95),
    rrRing(hw, zf + 0.04, zr, 0.12, 2.38),
    rrRing(hw - 0.01, zf + 0.2, zr, 0.13, 2.98),
    rrRing(hw - 0.04, zf + 0.32, zr - 0.01, 0.17, 3.1),
    rrRing(hw - 0.16, zf + 0.56, zr - 0.1, 0.25, top),
  ], { crease: 35 * DEG }));
  // the cab floor tunnel and engine cover under the cab
  P.add('dark', box(2.0, 0.3, 1.5, 0, 1.3, (zf + zr) / 2 + 0.05));
  // windscreen and its rubber surround, the wipers parked on the cowl
  const rake = Math.atan2(0.16, 0.6);
  P.add('dark', box(2.04, 0.6, 0.02, 0, 2.68, zf + 0.12 - 0.014, rake));
  P.add('glass', box(1.96, 0.53, 0.02, 0, 2.68, zf + 0.12 - 0.024, rake));
  for (const x of [-0.75, -0.05, 0.6]) {
    P.add('dark', box(0.02, 0.02, 0.06, x, 2.4, zf + 0.02));
    P.add('dark', box(0.55, 0.018, 0.018, x - 0.2, 2.44, zf + 0.025, 0, 0, 0.12));
  }
  // cowl ridge and the panel under the screen, leaning back a little, with its badges
  P.add('camo', rb(2.12, 0.06, 0.06, 0.02, 0, 2.38, zf + 0.025));
  P.add('dark', box(0.32, 0.05, 0.01, 0.75, 2.15, zf + 0.012, Math.atan2(0.04, 0.43)));
  P.add('dark', box(0.22, 0.04, 0.01, -0.75, 2.15, zf + 0.012, Math.atan2(0.04, 0.43)));
  // grille band: recess, three body-colour slats, KAMAZ plate, round headlamps, corner posts
  P.add('dark', box(1.3, 0.3, 0.03, 0, 1.69, zf - 0.005));
  for (const y of [1.6, 1.69, 1.78]) P.add('camo', rb(1.28, 0.045, 0.05, 0.01, 0, y, zf - 0.02));
  P.add('dark', box(0.52, 0.07, 0.02, 0, 1.83, zf - 0.03));
  P.add('steel', box(0.46, 0.035, 0.01, 0, 1.83, zf - 0.041));
  for (const s of [-1, 1]) {
    P.add('dark', zTube(zf + 0.02, zf - 0.04, 0.115, 0.115, 16, s * 0.83, 1.69));
    P.add('lens', zTube(zf - 0.04, zf - 0.05, 0.09, 0.09, 16, s * 0.83, 1.69));
    P.add('camo', rb(0.1, 0.85, 0.1, 0.03, s * (hw - 0.03), 1.85, zf - 0.02)); // corner posts
    P.add('amber', rb(0.04, 0.09, 0.08, 0.01, s * (hw + 0.005), 2.05, zf + 0.12)); // side repeater on the corner
  }
  // bumper box: full width steel box with lamps, a slotted step in the middle, plate, fog lamps
  const bz = (bumper + zf + 0.08) / 2, bd = zf + 0.08 - bumper;
  P.add('camo', rb(2.4, 0.56, bd, 0.03, 0, 1.17, bz));
  for (const s of [-1, 1]) P.add('rubber', rb(0.12, 0.54, bd + 0.01, 0.03, s * 1.15, 1.17, bz)); // black end caps
  P.add('dark', box(0.62, 0.05, 0.22, 0, 1.39, bumper + 0.12));
  for (let i = 0; i < 6; i++) P.add('steel', box(0.56, 0.012, 0.02, 0, 1.415, bumper + 0.04 + i * 0.035));
  P.add('dark', box(0.62, 0.14, 0.02, 0, 1.2, bumper - 0.005));
  P.add('white', box(0.48, 0.11, 0.01, 0.12, 1.0, bumper - 0.01), { tint: 0xd8d8d0 });
  P.add('dark', box(0.4, 0.07, 0.008, 0.12, 1.0, bumper - 0.016));
  for (const s of [-1, 1]) {
    P.add('dark', rb(0.13, 0.1, 0.03, 0.02, s * 0.88, 1.27, bumper - 0.005));
    P.add('amber', box(0.1, 0.07, 0.01, s * 0.88, 1.27, bumper - 0.02));
    P.add('dark', rb(0.14, 0.09, 0.03, 0.02, s * 0.88, 0.98, bumper - 0.005));
    P.add('lens', box(0.11, 0.06, 0.01, s * 0.88, 0.98, bumper - 0.02));
    P.add('dark', box(0.08, 0.06, 0.12, s * 0.45, 0.86, bumper + 0.05)); // tow eye under the bumper
    P.add('steel', new THREE.TorusGeometry(0.05, 0.016, 6, 10).applyMatrix4(xf(s * 0.45, 0.82, bumper - 0.02, Math.PI / 2, 0, 0)));
    // tow hooks hanging under the bumper
    P.add('steel', rod(V(s * 0.62, 0.9, bumper + 0.08), V(s * 0.62, 0.8, bumper - 0.02), 0.025, 6));
    P.add('steel', rod(V(s * 0.62, 0.8, bumper - 0.02), V(s * 0.62, 0.86, bumper - 0.08), 0.025, 6));
  }
  // the deep fender under each door, wider than the cab so it covers the tyre, with the wheel arch
  // cut from it and the two steps on its front part (photo 13)
  const arch = [];
  for (let k = 0; k <= 10; k++) { const t = (158 - (128 * k) / 10) * DEG; arch.push([a1 + Math.cos(t) * 0.78, 0.64 + Math.sin(t) * 0.78]); }
  const fender = [[zf + 0.04, 1.9], [zf + 0.04, 0.96], ...arch, [arch[arch.length - 1][0], 1.9]];
  for (const s of [-1, 1]) {
    P.add('camo', sideProfile(fender, 0.15, 0.02).translate(s * (hw + 0.04), 0, 0));
    P.add('rubber', mudguard(0.64, 0.14, s * (hw + 0.04), 0.64, a1, 22, 158, 0.13, 0.03)); // black arch lining
    for (const y of [0.98, 1.3]) {
      P.add('dark', box(0.04, 0.14, 0.34, s * (hw + 0.12), y + 0.05, zf + 0.3)); // step recess
      P.add('steel', box(0.06, 0.03, 0.32, s * (hw + 0.11), y, zf + 0.3));
    }
    mudFlap(P, s * 1.04, 0.62, a1 + 0.72, 0.5, 0.42);
  }
  // doors: seams, window, handle, grab handle; the rear quarter panel
  for (const s of [-1, 1]) {
    const x = s * (hw + 0.002);
    const d0 = zf + 0.2, d1 = zf + 1.32;
    for (const z of [d0, d1]) P.add('dark', box(0.012, 1.08, 0.018, x, 2.43, z));
    P.add('dark', box(0.015, 0.56, 0.66, x, 2.68, zf + 0.62));
    P.add('glass', box(0.012, 0.5, 0.6, s * (hw + 0.006), 2.68, zf + 0.62));
    P.add('dark', box(0.03, 0.035, 0.14, s * (hw + 0.015), 2.18, d1 - 0.2));
    P.add('steel', rod(V(s * (hw + 0.06), 1.7, zr - 0.08), V(s * (hw + 0.06), 2.7, zr - 0.08), 0.017, 6));
    for (const y of [1.7, 2.7]) P.add('steel', rod(V(s * (hw + 0.06), y, zr - 0.08), V(s * hw, y, zr - 0.08), 0.017, 5));
    // mirrors: a large black one on two arms from the A-pillar, a small convex one under it
    const mx = s * (hw + 0.3), mz = zf + 0.02;
    P.add('dark', rod(V(s * hw, 2.92, zf + 0.25), V(mx, 2.88, mz), 0.016, 6));
    P.add('dark', rod(V(s * hw, 2.42, zf + 0.25), V(mx, 2.45, mz), 0.016, 6));
    P.add('dark', rb(0.08, 0.44, 0.26, 0.025, mx, 2.67, mz, 0, s * 0.25, 0));
    P.add('dark', rb(0.08, 0.2, 0.18, 0.04, s * (hw + 0.24), 2.25, zf + 0.0, 0, s * 0.3, 0));
    if (star) starDecal(P, 'red', s, s * (hw + 0.008), 2.05, zf + 0.82, 0.13);
  }
  // roof: round hatch, spotlight, beacon
  P.add('camo', yTube(top - 0.02, top + 0.05, 0.31, 0.29, 18, 0.12, (zf + zr) / 2 + 0.05));
  P.add('camo', yTube(top + 0.05, top + 0.09, 0.25, 0.23, 18, 0.12, (zf + zr) / 2 + 0.05)); // hatch lid
  P.add('dark', box(0.08, 0.03, 0.12, 0.12, top + 0.1, (zf + zr) / 2 + 0.28));
  P.add('dark', yTube(top - 0.04, top + 0.06, 0.03, 0.03, 6, 0.88, zf + 0.42));
  P.add('dark', zTube(zf + 0.48, zf + 0.3, 0.085, 0.09, 12, 0.88, top + 0.12));
  P.add('lens', zTube(zf + 0.3, zf + 0.29, 0.075, 0.075, 12, 0.88, top + 0.12));
  P.add('amber', yTube(top - 0.02, top + 0.13, 0.065, 0.06, 10, -0.72, zf + 0.62));
  P.add('dark', yTube(top + 0.13, top + 0.15, 0.04, 0.03, 10, -0.72, zf + 0.62));
  return { top, front: zf, back: zr, hw };
}
