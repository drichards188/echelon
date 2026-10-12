import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { V, xf, box, yTube, zTube, xTube, sphere, rod, lathe, sideProfile, addLamp } from '../kit.js';
import { mudFlap, extinguisher } from '../trucks.js';

// Heavy 8x8 chassis pieces shared by the S-400 support vehicles (91N6E tractor, 55K6E command
// post): big-lug 1.4 to 1.5 m tyres on black disc wheels, axles, frame, and the long, tall,
// flat-fronted cab-forward cab of the MZKT-7930 / Ural-532301 class (front axle under the rear of
// the cab, three-pane windscreen, a deep bumper box over a sloped skid plate). Measured from
// refs/s400-support photos 1, 3 and 6 with the tyre as the ruler. Front -Z, ground y = 0.

// Rounded box with one segment per edge (108 triangles; the kit's rbox costs 300).
export const rb = (w, h, d, r, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) =>
  new RoundedBoxGeometry(w, h, d, 1, Math.min(r, w / 2 - 1e-3, h / 2 - 1e-3, d / 2 - 1e-3)).applyMatrix4(xf(x, y, z, rx, ry, rz));

// Tyre about the x axis: rounded section, big tread blocks in a stepped chevron (the two halves
// offset by half a pitch) so the lugs read in silhouette; about 1300 triangles.
export function lugTyre(R, W, lugs = 18, seg = 54) {
  const h = R * 0.3, Rr = R - h, G = R * 0.06;
  // [u across the width, radius, zone]: 0 sidewall, 1 shoulder, 2 tread
  const prof = [[-0.96, Rr, 0], [-1.05, Rr + 0.45 * h, 0], [-1.0, R - 0.2 * h, 1], [-0.86, R, 2], [-0.4, R, 2], [-0.05, R, 2],
    [0.05, R, 2], [0.4, R, 2], [0.86, R, 2], [1.0, R - 0.2 * h, 1], [1.05, Rr + 0.45 * h, 0], [0.96, Rr, 0]];
  const M = prof.length, pos = [], idx = [], per = seg / lugs;
  for (let i = 0; i < seg; i++) {
    const a = (i / seg) * Math.PI * 2;
    for (let j = 0; j < M; j++) {
      let [u, r, zone] = prof[j];
      if (zone) {
        // chevron: the block steps back one segment toward the shoulders; right half offset by half a pitch
        const k = i + (Math.abs(u) > 0.5 ? 1 : 0) + (u > 0 ? per / 2 : 0);
        const lug = ((k % per) + per) % per < per * 0.6;
        if (zone === 2 && !lug) r -= G;
        if (zone === 1) r += lug ? G * 0.2 : -G * 0.8;
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

// Black steel disc wheel on the outer face (side = +1 for +X): dished disc with lightening holes
// suggested by dark bosses, ten nuts, the hub boss and the tyre inflation valve.
export function discHub(P, x, y, z, side, R, W) {
  const Rr = R * 0.68, xo = x + side * (W * 0.5 - 0.04);
  // lathe profile [radius, depth inward]; the lathe faces -Y, which this turn points outward
  const M = xf(xo, y, z, 0, 0, side * Math.PI / 2);
  P.add('dark', lathe([[0.001, 0.0], [0.15, 0.0], [0.18, 0.03], [Rr * 0.55, 0.08], [Rr * 0.85, 0.07], [Rr * 0.97, 0.03], [Rr, -0.01], [Rr * 1.02, 0.03], [Rr * 0.95, 0.2]], 18).applyMatrix4(M));
  for (let i = 0; i < 8; i++) { // lightening holes (shadowed recesses)
    const a = (i / 8) * Math.PI * 2 + 0.2;
    P.add('tyre', xTube(xo - side * 0.07, xo - side * 0.05, 0.065, 0.065, 8, y + Math.cos(a) * Rr * 0.66, z + Math.sin(a) * Rr * 0.66));
  }
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    P.add('dark', box(0.04, 0.04, 0.04, xo + side * 0.02, y + Math.cos(a) * 0.16, z + Math.sin(a) * 0.16, a));
  }
  P.add('dark', xTube(xo, xo + side * 0.1, 0.11, 0.09, 12, y, z)); // hub boss
  P.add('steel', xTube(xo + side * 0.1, xo + side * 0.12, 0.05, 0.04, 8, y, z));
  P.add('steel', rod(V(xo + side * 0.11, y, z), V(xo + side * 0.07, y + 0.27, z + 0.06), 0.012, 4)); // inflation line
}

export function bigWheel(P, x, y, z, side, R, W) {
  P.add('tyre', lugTyre(R, W).applyMatrix4(xf(x, y, z)));
  discHub(P, x, y, z, side, R, W);
}

// Axles with wheels, hub reductions, differentials, torsion arms, steering rods on the steered
// axles and propeller shafts down the middle.
export function heavyGear(P, { axles, R, W, track, steered = 2, shafts = true }) {
  axles.forEach((z, i) => {
    for (const s of [-1, 1]) {
      bigWheel(P, s * track, R, z, s, R, W);
      P.add('dark', xTube(s * (track - W * 0.5 + 0.03), s * (track - W * 0.5 - 0.18), 0.15, 0.12, 12, R, z)); // hub reduction
      P.add('dark', rod(V(s * (track - W * 0.5 - 0.15), R + 0.05, z), V(s * 0.45, R + 0.3, z - 0.35), 0.05, 6)); // trailing arm
      P.add('dark', yTube(R + 0.05, R + 0.45, 0.06, 0.06, 8, s * (track - 0.55), z + 0.25)); // damper
    }
    P.add('dark', xTube(-track + 0.45, track - 0.45, 0.08, 0.08, 10, R, z));
    P.add('dark', sphere(0.21, 0, R, z, 1.0, 0.9, 1.1, 10)); // differential
    if (i < steered) P.add('dark', xTube(-track + 0.4, track - 0.4, 0.025, 0.025, 6, R - 0.05, z - 0.38)); // track rod
  });
  if (shafts) for (let i = 0; i < axles.length - 1; i++) P.add('dark', zTube(axles[i] + 0.22, axles[i + 1] - 0.22, 0.05, 0.05, 8, 0, R + 0.08));
}

// Ladder frame rails from z0 to z1, top at y = top, rails at +-rail.
export function ladderFrame(P, z0, z1, top, rail = 0.55, depth = 0.32) {
  const len = z1 - z0, cz = (z0 + z1) / 2;
  for (const s of [-1, 1]) {
    P.add('dark', box(0.12, depth, len, s * rail, top - depth / 2, cz));
    P.add('dark', box(0.18, 0.03, len, s * (rail - 0.03), top - depth, cz));
  }
  for (let z = z0 + 0.3; z < z1; z += 1.3) P.add('dark', box(rail * 2, 0.12, 0.1, 0, top - depth / 2, z));
}

// Flat mudguard over a pair of wheels: a top plate with a turned-down outer lip and a rubber flap.
export function bogieFender(P, x, z0, z1, y, W) {
  const s = Math.sign(x);
  P.add('camo', box(W + 0.16, 0.05, z1 - z0, x, y, (z0 + z1) / 2));
  P.add('camo', box(0.04, 0.22, z1 - z0, x + s * (W / 2 + 0.06), y - 0.12, (z0 + z1) / 2));
  P.add('dark', box(0.05, 0.05, z1 - z0, x - s * (W / 2 + 0.06), y - 0.03, (z0 + z1) / 2));
  mudFlap(P, x, y - 0.03, z1 - 0.02, W + 0.1, 0.55);
}

// Long cab-forward cab with a flat face (MZKT-7930 / Ural-532301 class). Front face at zf, length
// len, width w, roof H, floor y0. The front axle sits under its rear part (wheel arch at zA, wheel
// radius R). panes: windscreen pane count across. sideWin: [[z0, z1]] side windows behind the door.
// Returns key spots.
export function flatCab(P, { zf, len = 2.8, w = 2.85, H = 3.2, y0 = 1.3, zA, R = 0.75, glass = [2.15, 2.95], panes = 3, doorZ = [0.25, 1.35], sideWin = [], bumperY = [0.9, 1.35], bumperD = 0.42, bumperKey = 'dark' }) {
  const hw = w / 2, zr = zf + len, [g0, g1] = glass, rake = 0.14;
  // shell: vertical face up to the windscreen, the screen raked back, a short brow, flat roof,
  // vertical back, the floor line with the arch over the front wheel cut out of the rear corner
  // (the outline is drawn 4 cm inside the nominal lines: the extrusion's bevel grows it back out)
  const e = 0.04, rA = R + 0.12 + e, yA = R, prof = [[zf + e, y0 + e], [zf + e, g0 - 0.06], [zf + rake + e, g1 + 0.06], [zf + 0.1 + e, H - 0.08 - e], [zf + 0.2 + e, H - e], [zr - 0.06 - e, H - e], [zr - e, H - 0.06 - e]];
  if (zA !== undefined && yA + rA > y0) {
    const a0 = Math.asin((y0 - yA) / rA), dz = rA * Math.cos(a0);
    const ar = zA + dz > zr - e ? Math.acos((zr - e - zA) / rA) : a0, af = Math.PI - a0;
    if (zA + dz <= zr - e) prof.push([zr - e, y0 + e]);
    for (let k = 0; k <= 10; k++) {
      const a = ar + ((af - ar) * k) / 10;
      prof.push([Math.min(zr - e, zA + Math.cos(a) * rA), yA + Math.sin(a) * rA]);
    }
  } else prof.push([zr - e, y0 + e]);
  P.add('camo', sideProfile(prof, w, 0.04));
  // windscreen panes in a body-coloured frame with pillars; wipers parked at the top
  const tilt = Math.atan2(rake, g1 - g0), gy = (g0 + g1) / 2, gz = zf + rake / 2 - 0.012;
  const pw = (w - 0.3 - (panes - 1) * 0.1) / panes;
  for (let i = 0; i < panes; i++) {
    const x = -hw + 0.15 + pw / 2 + i * (pw + 0.1);
    P.add('glass', box(pw, g1 - g0, 0.03, x, gy, gz, tilt));
    P.add('rubber', box(pw + 0.06, 0.04, 0.035, x, g1 - 0.005, gz + 0.006, tilt)); // rubber surround
    P.add('rubber', box(pw + 0.06, 0.04, 0.035, x, g0 + 0.005, gz - 0.006, tilt));
    P.add('dark', box(0.025, 0.025, 0.55, x + pw * 0.2, g1 - 0.08, gz - 0.02, Math.PI / 2 - 0.25 + tilt, 0, 0)); // wiper
  }
  P.add('camo', box(w - 0.1, 0.07, 0.05, 0, g1 + 0.04, gz + 0.01, tilt)); // frame top
  P.add('camo', box(w - 0.1, 0.07, 0.05, 0, g0 - 0.03, gz - 0.01, tilt));
  // face below the screen: a small louvred grille on the right (photos 1, 6), a hatch, the brow lamps
  // (in the band between the bumper and the screen when that is narrow)
  const band = g0 - 0.05 - bumperY[1], gh = Math.min(0.22, band - 0.06), gy0 = band < 0.6 ? (bumperY[1] + g0 - 0.05) / 2 : g0 - 0.38;
  P.add('dark', box(0.62, gh, 0.03, 0.4, gy0, zf - 0.005));
  for (let i = 0; i < 4; i++) P.add('camo', box(0.58, 0.02, 0.04, 0.4, gy0 - gh * 0.36 + i * gh * 0.24, zf - 0.02));
  P.add('dark', box(0.5, 0.02, 0.01, -0.55, g0 - 0.25, zf - 0.005));
  for (const s of [-1, 1]) {
    P.add('amber', box(0.1, 0.06, 0.06, s * (hw - 0.25), H - 0.02, zf + 0.25));
    P.add('lens', box(0.07, 0.06, 0.06, s * (hw - 0.45), H - 0.02, zf + 0.25));
  }
  // bumper box with the lamp clusters at its ends, tow eyes, and the skid plate sloping back under
  const [b0, b1] = bumperY, bz = zf - bumperD / 2 + 0.04;
  P.add(bumperKey, rb(w + 0.04, b1 - b0, bumperD, 0.04, 0, (b0 + b1) / 2, bz));
  P.add('dark', sideProfile([[zf - bumperD + 0.04, b0], [zf + 0.05, b0], [zf + 1.05, y0 - 0.55], [zf + 1.05, y0 - 0.4], [zf + 0.05, b0 + 0.05]], w - 0.5, 0));
  for (const s of [-1, 1]) {
    const lx = s * (hw - 0.22), fz = zf - bumperD + 0.03;
    P.add('dark', zTube(fz - 0.02, fz + 0.06, 0.12, 0.12, 14, lx, b0 + 0.27));
    P.add('lens', zTube(fz - 0.035, fz - 0.02, 0.1, 0.1, 14, lx, b0 + 0.27));
    addLamp(P, s * (hw - 0.5), b0 + 0.3, fz + 0.02, 0.1, 0.08, 0.05, 'amber');
    addLamp(P, s * (hw - 0.5), b0 + 0.14, fz + 0.02, 0.1, 0.07, 0.05, 'lens');
    P.add('steel', rb(0.16, 0.12, 0.14, 0.03, s * 0.55, b0 + 0.12, fz - 0.05)); // tow eye
    P.add('steel', xTube(s * 0.5, s * 0.6, 0.04, 0.04, 8, b0 + 0.12, fz - 0.12));
  }
  P.add('dark', box(0.5, 0.15, 0.02, 0.0, (b0 + b1) / 2, zf - bumperD + 0.025)); // plate
  P.add('white', box(0.44, 0.1, 0.01, 0.0, (b0 + b1) / 2, zf - bumperD + 0.015), { tint: 0x777777 });
  // sides: door seams and window, rear windows, handles, steps, grab rails, mirrors
  const [d0, d1] = doorZ;
  for (const s of [-1, 1]) {
    const x = s * (hw + 0.004);
    P.add('glass', box(0.03, 0.62, d1 - d0 - 0.3, x, g0 + 0.42, zf + (d0 + d1) / 2 + 0.05));
    for (const z of [d0, d1]) P.add('dark', box(0.03, H - y0 - 0.25, 0.025, x, (y0 + H) / 2 - 0.05, zf + z));
    P.add('dark', box(0.03, 0.025, d1 - d0, x, H - 0.17, zf + (d0 + d1) / 2));
    P.add('steel', rb(0.06, 0.05, 0.2, 0.02, s * (hw + 0.03), g0 - 0.15, zf + d1 - 0.25));
    for (const [z0, z1] of sideWin) P.add('glass', box(0.03, 0.62, z1 - z0, x, g0 + 0.42, zf + (z0 + z1) / 2));
    // two steps under the door on hangers
    for (const [y, d] of [[y0 - 0.32, 0.3], [y0 - 0.68, 0.26]]) P.add('dark', box(0.35, 0.04, d1 - d0 - 0.4, s * (hw - 0.12), y, zf + (d0 + d1) / 2));
    P.add('dark', box(0.03, 0.75, 0.04, s * (hw - 0.02), y0 - 0.45, zf + d0 + 0.22));
    P.add('dark', box(0.03, 0.75, 0.04, s * (hw - 0.02), y0 - 0.45, zf + d1 - 0.22));
    P.add('steel', rod(V(s * (hw + 0.07), y0 + 0.2, zf + d1 + 0.12), V(s * (hw + 0.07), H - 0.4, zf + d1 + 0.12), 0.018, 5));
    // big rectangular mirrors on tubular arms off the A pillar, a wide-angle one below
    P.add('dark', rod(V(x, g1 - 0.05, zf + 0.15), V(s * (hw + 0.42), g1 + 0.05, zf - 0.05), 0.02, 5));
    P.add('dark', rod(V(x, g0, zf + 0.15), V(s * (hw + 0.42), g0 + 0.1, zf - 0.05), 0.02, 5));
    P.add('dark', rb(0.08, 0.5, 0.3, 0.03, s * (hw + 0.45), g1 - 0.12, zf - 0.07));
    P.add('dark', rb(0.08, 0.26, 0.26, 0.03, s * (hw + 0.45), g0 + 0.05, zf - 0.07));
    addLamp(P, x, y0 + 0.12, zf + 0.2, 0.02, 0.08, 0.14, 'amber');
  }
  extinguisher(P, hw + 0.08, y0 - 0.1, zr - 0.25);
  return { top: H, back: zr, front: zf, hw };
}

// Amber rotating beacon with a work lamp in a guard frame, on a small plinth (cab roof).
export function beacon(P, x, y, z) {
  P.add('dark', box(0.34, 0.06, 0.34, x, y + 0.03, z));
  P.add('amber', yTube(y + 0.06, y + 0.24, 0.07, 0.065, 10, x, z));
  P.add('dark', yTube(y + 0.24, y + 0.27, 0.075, 0.06, 10, x, z));
  P.add('dark', yTube(y + 0.06, y + 0.3, 0.012, 0.012, 4, x + 0.14, z + 0.14));
  P.add('lens', sphere(0.07, x + 0.14, y + 0.36, z - 0.02, 1, 1, 0.8, 8));
  for (const s of [-1, 1]) P.add('steel', rod(V(x + 0.14 + s * 0.09, y + 0.06, z + 0.06), V(x + 0.14 + s * 0.09, y + 0.46, z + 0.06), 0.01, 4));
  P.add('steel', xTube(x + 0.05, x + 0.23, 0.01, 0.01, 4, y + 0.46, z + 0.06));
}

