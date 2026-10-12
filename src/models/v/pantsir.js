import * as THREE from 'three';
import { V, DEG, xf, box, yTube, zTube, xTube, sphere, rod, plane, lathe, loft, frontProfile, sideProfile, scaleUV, Parts } from '../kit.js';
import { mudFlap, whip } from '../trucks.js';
import { newRig, node, pivotAt, hb } from '../rig.js';
import { KAMAZ, rb, kamazCab, kamazFrame, kamazRunningGear, kamazTyre, kamazHub } from './kamaz.js';
import { mark, span, swapper } from './swap.js';

// 96K6 Pantsir-S1 on the KamAZ-6560 8x8, deployed: cab, spare wheel, equipment cabin as high as the
// cab, a lower rear body with wire-mesh panels, and the combat module on a ring over the front of
// the rear body: round tracking radar drum (1RS2-1E) with the EO window on its upper left, two
// twin 30 mm 2A38M inboard and two blocks of six 57E6 tubes (3 rows x 2 columns) outboard, all on
// one elevating cradle, and the 1RS1-1E search radar standing on a pedestal at the turret rear.
// Measured from refs/pantsir (photos 13, 04, 05, 10, 11, 12 with the tyre as the ruler).
// Rig extras: setLoaded(i, false) takes the cap off container i (an empty bore); setContainer(i, false)
// takes container i out of its block altogether (the reload scene swaps the containers, pantsirTube()
// and tubeCap() build the same container for it).

const DECK = 1.7; // floor of the cabin and the rear body
const CAB = { zf: -4.18, zr: -2.53, bumper: -4.4 };
const CABIN = { z0: -1.83, z1: 0.07, top: 3.12 };
const BODY = { z0: 0.07, z1: 4.32, top: 2.85 };
const HW = 1.25; // body half width
// turret ring top and centre, a little behind the cabin/body joint. Photo 13 (travel, turret turned
// round) puts the folded radar's hinge over the cabin's back and the tube muzzles level with the
// body's rear end. Everything that swings over the cabin clears its roof.
const RING = { y: 2.97, z: 1.2 };
const EL = { y: 0.7, z: 0.1 }; // elevation axis in turret space, through the drum's centre
// tube rows from just below the drum's centre up to its top (photo 13: rows at about 3.45, 3.75, 4.05 m)
export const TUBE = { r: 0.105, z0: 0.28, z1: -3.0, cols: [0.86, 1.15], rows: [-0.15, 0.15, 0.45] }; // in the cradle
const GUN = { x: 0.6, y: 0.47, dx: 0.055, muzzle: -3.05 };
const DRUM = { r: 0.49, z0: -1.55, z1: -2.35 };
const RADAR = { z: 1.25 }; // search radar pivot, turret space

// The shared 'green' scheme leans yellow; the Pantsir's paint is a greyer olive (photos 03, 07,
// 12), so its painted parts take a cooler vertex tint (exported: the reload scene's containers and the
// TZM take it too).
export function greyer(meshes) {
  for (const m of meshes) if (m.name === 'camo' || m.name === 'paint') {
    const c = m.geometry.attributes.color;
    for (let i = 0; i < c.count; i++) c.setXYZ(i, c.getX(i) * 0.93, c.getY(i) * 0.95, c.getZ(i) * 1.1);
  }
}

// Diagonal-striped warning plate facing +Z: white with red bands at 45 degrees, centre (x, y, z).
function warningPlate(P, w, h, x, y, z, flip = 1) {
  P.add('white', box(w, h, 0.012, x, y, z), { tint: 0xeeeeea });
  const clip = (poly, a, b, c) => { // keep a*x + b*y <= c
    const out = [];
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i], q = poly[(i + 1) % poly.length];
      const fp = a * p[0] + b * p[1] - c, fq = a * q[0] + b * q[1] - c;
      if (fp <= 0) out.push(p);
      if ((fp < 0) !== (fq < 0) && fp !== fq) { const t = fp / (fp - fq); out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]); }
    }
    return out;
  };
  const sq = [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]];
  const step = (w + h) / 7;
  for (let k = 0; k < 7; k += 2) {
    const c0 = -(w + h) / 2 + k * step, c1 = c0 + step;
    let poly = clip(sq, flip, 1, c1);
    poly = clip(poly, -flip, -1, -c0);
    if (poly.length < 3) continue;
    const s = new THREE.Shape(poly.map(([px, py]) => new THREE.Vector2(px, py)));
    P.add('red', new THREE.ShapeGeometry(s).translate(x, y, z + 0.008), { tint: 0xd02020 });
  }
}

// A side panel of perforated mesh (the radar's lattice texture, tinted) behind a frame with
// vertical stiffeners, facing +X when side = 1.
function meshPanel(P, side, z0, z1, y0, y1) {
  const x = side * HW, len = z1 - z0, h = y1 - y0, zc = (z0 + z1) / 2, yc = (y0 + y1) / 2;
  P.add('dark', box(0.02, h, len, side * (HW - 0.09), yc, zc));
  const g = plane(len, h, side * (HW - 0.03), yc, zc, 0, side * Math.PI / 2, 0);
  scaleUV(g, len / 0.5, h / 0.5);
  P.add('array', g, { tint: new THREE.Color(2.4, 2.7, 2.0) }); // the lattice texture is near black; lift it to a weathered olive
  for (const y of [y0 + 0.03, y1 - 0.03]) P.add('camo', box(0.07, 0.06, len, x - side * 0.035, y, zc));
  for (const z of [z0 + 0.03, z1 - 0.03]) P.add('camo', box(0.07, h, 0.06, x - side * 0.035, yc, z));
  const n = Math.round(len / 0.36);
  for (let i = 1; i < n; i++) P.add('camo', box(0.03, h - 0.08, 0.035, x - side * 0.03, yc, z0 + (len * i) / n));
  P.add('camo', box(0.03, 0.03, len - 0.08, x - side * 0.03, yc, zc));
}

// Louvred grille: dark backing and angled slats, on a side (normal +X when side = 1).
function louvreSide(P, side, z0, z1, y0, y1, pitch = 0.055, x = side * HW) {
  const len = z1 - z0, h = y1 - y0, zc = (z0 + z1) / 2;
  P.add('dark', box(0.02, h, len, x - side * 0.06, (y0 + y1) / 2, zc));
  for (let y = y0 + pitch * 0.6; y < y1 - pitch * 0.3; y += pitch) P.add('camo', box(0.06, 0.012, len - 0.04, x - side * 0.035, y, zc, 0, 0, side * 35 * DEG));
  for (const y of [y0 + 0.025, y1 - 0.025]) P.add('camo', box(0.06, 0.05, len, x - side * 0.03, y, zc));
  for (const z of [z0 + 0.025, z1 - 0.025]) P.add('camo', box(0.06, h, 0.05, x - side * 0.03, (y0 + y1) / 2, z));
}

// White stencilled tactical number on the right side (photo 02), seven-segment digits of height h;
// seen from the right it reads rear to front, so the first digit's centre is the rearmost, at z.
function tacticalNumber(P, text, x, y, z, h) {
  const SEG = { 2: 'abged', 5: 'afgcd', 7: 'abc' };
  const w = h * 0.55, t = h * 0.13;
  [...text].forEach((ch, i) => {
    const zc = z - i * (w + h * 0.25);
    const at = { a: [0, h / 2, w, t], d: [0, -h / 2, w, t], g: [0, 0, w, t], b: [-w / 2, h / 4, t, h / 2], c: [-w / 2, -h / 4, t, h / 2], f: [w / 2, h / 4, t, h / 2], e: [w / 2, -h / 4, t, h / 2] };
    for (const sg of SEG[ch] || '') { const [dz, dy, lz, ly] = at[sg]; P.add('white', box(0.006, ly, lz, x, y + dy, zc + dz), { tint: 0xd8d8d0 }); }
  });
}

// Crew door with ladder rungs on a side of the cabin.
function cabinDoor(P, side, z0, z1, y0, y1) {
  const x = side * (HW + 0.012), zc = (z0 + z1) / 2, yc = (y0 + y1) / 2;
  P.add('camo', rb(0.025, y1 - y0, z1 - z0, 0.012, x, yc, zc));
  P.add('dark', box(0.01, y1 - y0 + 0.03, 0.015, x, yc, z0 - 0.015));
  P.add('dark', box(0.01, y1 - y0 + 0.03, 0.015, x, yc, z1 + 0.015));
  P.add('dark', box(0.01, 0.015, z1 - z0 + 0.03, x, y1 + 0.015, zc));
  for (const y of [y0 + 0.25, y1 - 0.25]) P.add('dark', box(0.03, 0.12, 0.05, x + side * 0.01, y, z1 - 0.02)); // hinges
  P.add('steel', box(0.04, 0.03, 0.14, x + side * 0.02, yc + 0.05, z0 + 0.1)); // handle
  // two rungs and a grab handle so the crew can climb to the roof
  for (const y of [y0 + 0.32, y0 + 0.66]) {
    P.add('steel', rod(V(x, y, zc - 0.18), V(x + side * 0.1, y, zc - 0.18), 0.014, 5));
    P.add('steel', rod(V(x, y, zc + 0.18), V(x + side * 0.1, y, zc + 0.18), 0.014, 5));
    P.add('steel', rod(V(x + side * 0.1, y, zc - 0.18), V(x + side * 0.1, y, zc + 0.18), 0.016, 5));
  }
  P.add('steel', rod(V(x + side * 0.06, y1 - 0.5, zc + 0.3), V(x + side * 0.06, y1 - 0.1, zc + 0.3), 0.014, 5));
}

// Hydraulic stabiliser jack, lowered: housing, ram and round foot on the ground.
function jackDown(P, x, z, yTop) {
  P.add('dark', box(0.22, 0.42, 0.22, x, yTop - 0.21, z));
  P.add('dark', yTube(0.5, yTop - 0.4, 0.075, 0.075, 10, x, z));
  P.add('steel', yTube(0.08, 0.55, 0.055, 0.055, 10, x, z));
  P.add('dark', yTube(0.0, 0.05, 0.2, 0.17, 14, x, z));
  P.add('dark', sphere(0.07, x, 0.08, z, 1, 0.7, 1, 8));
}

// Ladder leaning against the rear face (photo 10: the feet stand well out behind the body): flat-bar
// rails from (y0, z + lean) up to (y1, z), round rungs, the rails bent over the roof edge as hand
// holds. Returns a point-on-ladder function (t from 0 at the foot to 1 at the top).
function rearLadder(P, x, y0, y1, z, w = 0.48, lean = 0.55) {
  const at = (t, dz = 0) => V(0, y0 + (y1 - y0) * t, z + 0.09 + lean * (1 - t) + dz);
  const tilt = -Math.atan2(lean, y1 - y0);
  for (const s of [-1, 1]) {
    const rx = x + s * w / 2, a = at(0), b = at(1), m = at(0.5);
    P.add('paint', box(0.035, b.distanceTo(a) + 0.25, 0.05, rx, m.y + 0.1, m.z - 0.1 * Math.tan(-tilt), tilt));
    P.add('paint', box(0.035, 0.05, 0.3, rx, y1 + 0.22, z - 0.06));
    P.add('paint', box(0.03, 0.04, 0.12, rx, y1 - 0.15, z + 0.04)); // top bracket to the body
  }
  for (let t = 0.06; t < 1; t += 0.2) { const p = at(t); P.add('paint', xTube(x - w / 2, x + w / 2, 0.016, 0.016, 6, p.y, p.z)); }
  return at;
}

// Fixed equipment cabin behind the cab and the rear body with its mesh panels, rear ladders and
// warning plates, the gear under the body, the spare wheel and the rear end.
function body(P) {
  const { z0: c0, z1: c1, top: ct } = CABIN;
  const { z0: b0, z1: b1, top: bt } = BODY;
  // subframe and the body floor edge
  for (const s of [-1, 1]) {
    P.add('dark', box(0.14, 0.42, b1 - c0 - 0.2, s * 0.55, DECK - 0.27, (c0 + b1) / 2));
    P.add('camo', box(0.08, 0.12, b1 - c0, s * (HW - 0.04), DECK + 0.02, (c0 + b1) / 2));
  }
  for (let z = c0 + 0.3; z < b1; z += 0.9) P.add('dark', box(2.3, 0.1, 0.1, 0, DECK - 0.1, z));
  // cabin shell and roof lip
  P.add('camo', rb(2.5, ct - DECK, c1 - c0, 0.03, 0, (ct + DECK) / 2, (c0 + c1) / 2));
  P.add('camo', rb(2.52, 0.05, c1 - c0 + 0.02, 0.015, 0, ct - 0.02, (c0 + c1) / 2));
  // right side: equipment column ahead of the door, door with rungs, a lamp behind it
  P.add('camo', rb(0.12, 0.9, 0.42, 0.02, HW + 0.03, DECK + 0.55, c0 + 0.24));
  P.add('dark', box(0.04, 0.4, 0.3, HW + 0.1, DECK + 0.6, c0 + 0.24));
  tacticalNumber(P, '752', HW + 0.004, ct - 0.3, -0.04, 0.22); // between the door and the cabin's back (photo 02)
  P.add('dark', yTube(DECK + 0.1, ct - 0.1, 0.03, 0.03, 6, HW + 0.05, c0 + 0.5));
  cabinDoor(P, 1, -1.28, -0.5, DECK + 0.12, ct - 0.12);
  P.add('dark', rb(0.06, 0.12, 0.18, 0.02, HW + 0.03, DECK + 0.3, -0.25));
  P.add('red', box(0.01, 0.06, 0.12, HW + 0.065, DECK + 0.3, -0.25));
  P.add('camo', rb(0.05, 0.4, 0.3, 0.015, HW + 0.02, DECK + 0.7, -0.2)); // junction box
  // left side: tall louvred box at the front, door with rungs, a narrow louvre strip near the back
  P.add('camo', rb(0.16, ct - DECK - 0.14, 0.5, 0.02, -HW - 0.05, (ct + DECK) / 2, c0 + 0.3));
  louvreSide(P, -1, c0 + 0.08, c0 + 0.52, DECK + 0.12, ct - 0.14, 0.06, -HW - 0.13);
  cabinDoor(P, -1, -1.15, -0.4, DECK + 0.12, ct - 0.12);
  louvreSide(P, -1, -0.32, -0.08, DECK + 0.5, ct - 0.3, 0.06, -HW - 0.02);
  // cabin front, facing the cab: cable reel, boxes, the guard frame reaching over the spare wheel
  P.add('brass', xTube(0.55, 0.95, 0.24, 0.24, 18, ct - 0.33, c0 - 0.24), { tint: 0xb08a5a });
  for (const s of [-1, 1]) P.add('dark', xTube(0.75 + s * 0.22, 0.75 + s * 0.25, 0.29, 0.29, 18, ct - 0.33, c0 - 0.24));
  P.add('dark', box(0.08, 0.5, 0.35, 0.75, ct - 0.55, c0 - 0.12));
  P.add('camo', rb(0.7, 0.8, 0.3, 0.02, -0.6, DECK + 0.6, c0 - 0.15));
  P.add('dark', rb(0.9, 1.0, 0.5, 0.02, -0.75, DECK + 0.25, CAB.zr + 0.4)); // air intake and gear behind the cab, left
  P.add('dark', yTube(DECK - 0.2, ct - 0.1, 0.11, 0.11, 10, -0.75, CAB.zr + 0.2));
  for (const s of [-1, 1]) {
    P.add('camo', box(0.06, 0.06, 0.75, s * 1.2, ct + 0.04, c0 - 0.36));
    P.add('camo', rod(V(s * 1.2, ct + 0.04, c0 - 0.7), V(s * 1.2, ct - 0.45, c0 - 0.02), 0.025, 6));
  }
  P.add('camo', box(2.4, 0.06, 0.06, 0, ct + 0.04, c0 - 0.72));
  // spare wheel standing in the gap on the right, axis fore and aft, on a cradle
  const sx = 0.6, sy = DECK + 0.58, sz = c0 - 0.3, turn = xf(sx, sy, sz, 0, Math.PI / 2, 0);
  P.add('tyre', kamazTyre(KAMAZ.R, KAMAZ.W, 16, 56).applyMatrix4(turn));
  const H = new Parts(P.mats); // the hub faces forward: build it facing +X and turn it
  kamazHub(H, 0, 0, 0, 1);
  for (const key of ['dark', 'steel']) P.add(key, H.merged(key).applyMatrix4(turn));
  P.add('dark', box(0.9, 0.08, 0.5, sx, DECK - 0.08, sz));
  P.add('dark', box(0.05, 1.3, 0.06, sx + 0.7, DECK + 0.55, sz + 0.2));
  P.add('dark', rod(V(sx, sy + 0.1, sz - 0.25), V(sx, sy + 0.1, c0), 0.025, 6));

  // whips on brackets behind the cab, beyond the reach of the turret's tubes (3 m from the ring)
  for (const [x, h] of [[-1.0, 2.3], [-0.75, 1.9]]) {
    P.add('dark', box(0.12, 0.08, 0.12, x, 2.86, CAB.zr + 0.09));
    whip(P, x, 2.9, CAB.zr + 0.09, h, 0.01);
  }
  // rear body: inner box, mesh panels and a louvred grille on each side, roof, handrails
  P.add('camo', box(2.3, bt - DECK, b1 - b0, 0, (bt + DECK) / 2, (b0 + b1) / 2));
  P.add('camo', rb(2.52, 0.06, b1 - b0 + 0.02, 0.015, 0, bt - 0.03, (b0 + b1) / 2));
  for (const s of [-1, 1]) {
    for (const z of [b0 + 0.04, b1 - 0.04]) P.add('camo', box(0.12, bt - DECK, 0.08, s * (HW - 0.06), (bt + DECK) / 2, z));
    meshPanel(P, s, b0 + 0.1, 1.62, DECK + 0.08, bt - 0.08);
    meshPanel(P, s, 1.68, 3.2, DECK + 0.08, bt - 0.08);
    louvreSide(P, s, 3.26, b1 - 0.1, DECK + 0.08, bt - 0.08, 0.05);
    P.add('camo', box(0.1, bt - DECK, 0.06, s * (HW - 0.05), (bt + DECK) / 2, 1.65));
    P.add('camo', box(0.1, bt - DECK, 0.06, s * (HW - 0.05), (bt + DECK) / 2, 3.23));
    // handrails: two rails on posts along the mesh panels
    const hx = s * (HW + 0.07);
    for (const y of [DECK + 0.45, DECK + 0.85]) P.add('steel', rod(V(hx, y, b0 + 0.25), V(hx, y, 3.05), 0.016, 6));
    for (const z of [b0 + 0.25, 1.65, 3.05]) {
      P.add('steel', rod(V(hx, DECK + 0.3, z), V(hx, DECK + 0.9, z), 0.016, 6));
      for (const y of [DECK + 0.3, DECK + 0.9]) P.add('steel', rod(V(hx, y, z), V(s * HW, y, z), 0.014, 5));
    }
  }
  // roof: ring housing for the turret, hatches and boxes at the back corners
  P.add('dark', yTube(bt, RING.y - 0.02, 1.02, 0.98, 32, 0, RING.z));
  P.add('steel', yTube(RING.y - 0.02, RING.y, 0.96, 0.96, 32, 0, RING.z));
  for (const s of [-1, 1]) {
    // boxes on the rear corners with stamped crosses on their backs (photo 05)
    P.add('camo', rb(0.4, 0.28, 0.42, 0.03, s * 1.03, bt + 0.14, b1 - 0.24));
    for (const r of [-1, 1]) P.add('dark', box(0.3, 0.02, 0.012, s * 1.03, bt + 0.14, b1 - 0.024, 0, 0, r * 0.75));
  }
  P.add('camo', rb(0.9, 0.06, 0.8, 0.02, 0, bt + 0.03, 3.4));
  // rear face (photo 05): equipment door and hatches, three ladders, the striped plates, grab rails
  const rz = b1 + 0.005;
  P.add('camo', box(2.5, bt - DECK, 0.04, 0, (bt + DECK) / 2, b1 - 0.015));
  P.add('dark', box(0.8, 1.0, 0.012, 0.1, DECK + 0.63, rz)); // equipment door seam
  P.add('camo', box(0.77, 0.97, 0.02, 0.1, DECK + 0.63, rz + 0.004));
  P.add('dark', box(0.4, 0.44, 0.012, -0.5, DECK + 0.95, rz)); // hatch
  P.add('camo', box(0.37, 0.41, 0.02, -0.5, DECK + 0.95, rz + 0.004));
  P.add('dark', box(0.3, 0.6, 0.012, -0.52, DECK + 0.38, rz));
  P.add('camo', box(0.27, 0.57, 0.02, -0.52, DECK + 0.38, rz + 0.004));
  P.add('dark', box(2.5, 0.06, 0.03, 0, bt - 0.13, rz + 0.01)); // rim under the roof edge
  P.add('camo', rb(0.55, 0.25, 0.12, 0.02, 0, DECK - 0.22, b1 - 0.02));
  P.add('amber', box(0.12, 0.05, 0.01, 0.0, DECK - 0.15, b1 + 0.045));
  const y0 = DECK - 0.3, lean = 0.55, tilt = -Math.atan2(lean, bt - y0);
  for (const s of [-1, 1]) {
    // outer ladders carry the striped plates; a tall grab rail on each corner
    const at = rearLadder(P, s * 0.92, y0, bt, b1, 0.48, lean);
    const p = at(0.45, 0.035);
    const plate = new Parts(P.mats);
    warningPlate(plate, 0.44, 0.4, 0, 0, 0, s);
    for (const key of ['white', 'red']) P.add(key, plate.merged(key).applyMatrix4(xf(s * 0.92, p.y, p.z, tilt, 0, 0)), { tint: key === 'red' ? 0xd02020 : 0xeeeeea });
    for (const t of [0.3, 0.6]) { const q = at(t, 0.01); P.add('paint', box(0.48, 0.03, 0.05, s * 0.92, q.y, q.z, tilt)); }
    P.add('paint', rod(V(s * 1.3, DECK + 0.25, b1 - 0.12), V(s * 1.3, bt + 0.2, b1 - 0.12), 0.02, 6));
    for (const y of [DECK + 0.25, bt + 0.2]) P.add('paint', rod(V(s * 1.3, y, b1 - 0.12), V(s * 1.22, y, b1 - 0.12), 0.02, 5));
  }
  const mid = rearLadder(P, 0.07, y0, bt, b1, 0.42, lean)(0.22, 0.03);
  P.add('steel', box(0.4, 0.3, 0.02, 0.07, mid.y, mid.z, tilt), { tint: 0x9a9e94 }); // chequer plate
  // under the body: fuel tank right, air tank left, battery box, exhaust, fenders, flaps
  P.add('dark', rb(0.5, 0.48, 1.0, 0.1, 1.0, 1.18, 0.55));
  P.add('steel', box(0.04, 0.5, 0.06, 1.25, 1.18, 0.2));
  P.add('steel', box(0.04, 0.5, 0.06, 1.25, 1.18, 0.9));
  P.add('dark', yTube(1.42, 1.48, 0.06, 0.06, 8, 1.0, 0.25));
  P.add('dark', zTube(0.05, 1.15, 0.24, 0.24, 16, -1.0, 1.2));
  P.add('dark', rb(0.5, 0.42, 0.55, 0.04, -1.0, 1.15, -0.15));
  P.add('steel', zTube(-0.2, 1.1, 0.07, 0.07, 8, 0.72, 0.85));
  P.add('dark', zTube(1.1, 1.25, 0.08, 0.06, 8, 0.72, 0.85));
  const [, a2, a3, a4] = KAMAZ.axles, R = KAMAZ.R, tx = KAMAZ.track;
  for (const s of [-1, 1]) {
    P.add('camo', box(0.62, 0.05, 1.5, s * tx, 1.46, a2));
    P.add('camo', box(0.04, 0.22, 1.5, s * (tx + 0.3), 1.36, a2));
    P.add('camo', box(0.62, 0.05, a4 - a3 + 1.5, s * tx, 1.46, (a3 + a4) / 2));
    P.add('camo', box(0.04, 0.22, a4 - a3 + 1.5, s * (tx + 0.3), 1.36, (a3 + a4) / 2));
    mudFlap(P, s * tx, R * 0.95, a2 + 0.75, 0.52, 0.5);
    mudFlap(P, s * tx, R * 0.95, a4 + 0.76, 0.52, 0.5);
    // jacks: a pair at the rear corners, a pair behind the second axle
    jackDown(P, s * 1.12, b1 + 0.12, 1.45);
    P.add('dark', box(0.3, 0.12, 0.3, s * 1.0, 1.42, b1 + 0.05));
    jackDown(P, s * 1.13, -0.35, 1.55);
  }
  // rear bumper beam with lamp clusters and the hitch
  P.add('dark', box(2.45, 0.2, 0.14, 0, 0.9, b1 + 0.06));
  P.add('dark', box(1.2, 0.5, 0.1, 0, 1.25, b1 - 0.1));
  for (const s of [-1, 1]) {
    P.add('dark', box(0.42, 0.13, 0.05, s * 0.85, 0.9, b1 + 0.15));
    P.add('red', box(0.12, 0.07, 0.01, s * 0.72, 0.9, b1 + 0.18));
    P.add('red', box(0.12, 0.07, 0.01, s * 0.88, 0.9, b1 + 0.18));
    P.add('amber', box(0.08, 0.07, 0.01, s * 1.0, 0.9, b1 + 0.18));
  }
  P.add('dark', box(0.3, 0.22, 0.2, 0, 0.9, b1 + 0.2));
  P.add('steel', yTube(0.78, 1.02, 0.03, 0.03, 8, 0, b1 + 0.26));
}

// The rotating base of the combat module (turret space, origin on the ring): a low faceted body,
// the trunnion cheeks, boxes at the back corners.
function turretBase(T) {
  const ring = (inset, y) => [[0.6 - inset, -0.95 + inset], [0.98 - inset, -0.5], [0.98 - inset, 1.0], [0.62 - inset, 1.6 - inset], [-0.62 + inset, 1.6 - inset], [-0.98 + inset, 1.0], [-0.98 + inset, -0.5], [-0.6 + inset, -0.95 + inset]].map(([x, z]) => V(x, y, z));
  const skirt = [[0.48, -0.75], [0.85, -0.32], [0.85, 0.32], [0.48, 0.75], [-0.48, 0.75], [-0.85, 0.32], [-0.85, -0.32], [-0.48, -0.75]].map(([x, z]) => V(x, 0, z));
  T.add('camo', loft([skirt, ring(0, 0.17), ring(0.12, 0.32)], { crease: 30 * DEG }));
  T.add('dark', yTube(-0.06, 0.0, 0.94, 0.94, 32, 0, 0));
  // trunnion cheeks on each side of the cradle
  const cheek = [[-0.25, 0.25], [-0.25, 0.67], [-0.05, 0.9], [0.45, 0.9], [0.65, 0.67], [0.65, 0.25]];
  for (const s of [-1, 1]) T.add('camo', sideProfile(cheek.map(([z, y]) => [z + EL.z - 0.2, y]), 0.07).translate(s * 0.43, 0, 0));
  // equipment boxes at the back corners, beside the radar pedestal
  for (const s of [-1, 1]) T.add('camo', rb(0.4, 0.3, 0.46, 0.03, s * 0.76, 0.42, 1.1));
  // the radar's pedestal block at the back: two side walls and a top plate over a dark recess with a
  // V brace across its open back (photos 05, 10); it starts 0.8 behind the ring, clear of the guns'
  // breeches as the cradle elevates
  for (const s of [-1, 1]) T.add('camo', box(0.12, 0.5, 0.85, s * 0.5, 0.55, 1.225));
  T.add('camo', box(1.12, 0.06, 0.85, 0, 0.79, 1.225));
  T.add('dark', box(0.88, 0.46, 0.65, 0, 0.55, 1.15));
  for (const s of [-1, 1]) T.add('camo', rod(V(s * 0.42, 0.72, 1.58), V(0, 0.4, 1.58), 0.04, 6));
  T.add('camo', box(0.88, 0.06, 0.06, 0, 0.73, 1.6));
}

// Six tubes, three rows by two columns, with clamp bands, the rear cradle, the support box under
// them and the outer armour plate (elevation space; side = -1 left, +1 right).
// One 57E6 transport-launch container as it sits in a block (elevation space, axis at x, y; side -1
// left, +1 right: the red tag is on its outer face): the tube, the muzzle collar and lip, the bore
// under the cap, the rear closure, the light band and the clamp bands. Exported so the reload scene and
// the TZM's load build the same container.
export function pantsirTube(E, x, y, side) {
  E.add('camo', zTube(TUBE.z0, TUBE.z1 + 0.03, TUBE.r, TUBE.r, 16, x, y, true));
  E.add('canister', zTube(TUBE.z1 + 0.03, TUBE.z1, TUBE.r + 0.012, TUBE.r + 0.012, 16, x, y, true), { tint: 0xc8ccb8 }); // muzzle collar
  E.add('canister', lathe([[TUBE.r + 0.012, 0], [TUBE.r - 0.012, 0]], 16).applyMatrix4(xf(x, y, TUBE.z1, -Math.PI / 2, 0, 0)), { tint: 0xc8ccb8 }); // its lip
  E.add('dark', zTube(TUBE.z1 + 0.12, TUBE.z1 + 0.1, TUBE.r - 0.01, TUBE.r - 0.01, 14, x, y)); // the empty bore under the cap
  E.add('dark', zTube(TUBE.z0 + 0.03, TUBE.z0, TUBE.r + 0.01, TUBE.r + 0.01, 14, x, y)); // rear closure
  E.add('canister', zTube(TUBE.z1 + 0.42, TUBE.z1 + 0.28, TUBE.r + 0.004, TUBE.r + 0.004, 16, x, y, true), { tint: 0xd8dcc8 }); // lighter band near the muzzle
  for (const z of [TUBE.z1 + 0.75, -0.95]) E.add('paint', zTube(z + 0.04, z - 0.04, TUBE.r + 0.012, TUBE.r + 0.012, 16, x, y, true)); // clamp bands
  E.add('red', box(0.02, 0.025, 0.04, x + side * 0.1, y, -0.6)); // red tag on each tube
}

// the cap over a loaded container's mouth (white, one per slot in the caps mesh)
export const tubeCap = (x, y) => lathe([[0.001, -0.02], [TUBE.r + 0.005, -0.02], [TUBE.r + 0.005, 0.0], [0.085, 0.012], [0.05, 0.022], [0.001, 0.025]], 12).applyMatrix4(xf(x, y, TUBE.z1 - 0.005, -Math.PI / 2, 0, 0));

// the slot (rig.missileSlots order) of the container in column ci, row ri of a side's block
const slotOf = (side, ci, ri) => 2 * ((2 - ri) * 2 + ci) + (side > 0 ? 1 : 0);

function tubeBlock(E, side, spans) {
  const [c0, c1] = TUBE.cols;
  // each container's vertices are recorded so the reload scene can take it off (rig.setContainer)
  [c0, c1].forEach((c, ci) => TUBE.rows.forEach((y, ri) => {
    const m = mark(E);
    pantsirTube(E, side * c, y, side);
    spans[slotOf(side, ci, ri)] = span(E, m);
  }));
  const xm = side * (c0 + c1) / 2, w = c1 - c0 + 2 * TUBE.r + 0.06;
  const yb = TUBE.rows[0] - TUBE.r - 0.03, ytp = TUBE.rows[2] + TUBE.r + 0.03;
  // clamp frames around the block near the muzzle and in the middle
  for (const z of [TUBE.z1 + 0.75, -0.95]) {
    E.add('camo', box(w, 0.03, 0.08, xm, ytp, z));
    E.add('camo', box(w, 0.03, 0.08, xm, yb, z));
    for (const x of [xm - w / 2, xm + w / 2]) E.add('camo', box(0.03, ytp - yb, 0.08, x, (yb + ytp) / 2, z));
  }
  // rear cradle: longitudinal rails at the corners, a ribbed floor
  for (const x of [xm - w / 2, xm + w / 2]) for (const y of [yb, ytp]) E.add('paint', box(0.05, 0.05, 1.5, x, y, TUBE.z0 - 0.75));
  E.add('paint', box(w, 0.04, 1.5, xm, yb - 0.02, TUBE.z0 - 0.75));
  for (let i = 0; i < 6; i++) E.add('dark', box(w - 0.06, 0.03, 0.03, xm, yb - 0.05, TUBE.z0 - 0.1 - i * 0.25));
  // support box under the block, carrying the outer armour plate
  E.add('camo', rb(w, 0.12, 1.4, 0.03, xm, yb - 0.1, TUBE.z0 - 0.9));
  const ox = side * (c1 + TUBE.r + 0.05);
  // its lower edge clears the cabin roof (3.2 m) as the turret swings over it
  const prof = [[TUBE.z0 - 0.1, -0.42], [TUBE.z0 - 0.1, 0.3], [-1.05, 0.3], [-1.45, 0.12], [-1.45, -0.3], [-1.3, -0.42]];
  E.add('camo', sideProfile(prof, 0.04).translate(ox, 0, 0));
  const inner = [[TUBE.z0 - 0.25, -0.34], [TUBE.z0 - 0.25, 0.18], [-1.0, 0.18], [-1.3, 0.03], [-1.3, -0.22], [-1.18, -0.34]];
  E.add('paint', sideProfile(inner, 0.02).translate(ox + side * 0.025, 0, 0));
  E.add('dark', rb(0.06, 0.3, 0.5, 0.02, side * (c0 - TUBE.r - 0.06), 0.05, -0.2)); // arm to the cross shaft
}

// Twin 30 mm 2A38M: receiver, jacketed barrels side by side, the muzzle bracket and a feed chute
// (elevation space). Returns the two muzzle points.
function twinGun(E, side) {
  const x = side * GUN.x, y = GUN.y;
  E.add('camo', rb(0.22, 0.3, 1.55, 0.03, x, y, -0.52));
  E.add('dark', rb(0.18, 0.16, 0.6, 0.02, x, y - 0.22, -0.2)); // feed chute
  E.add('camo', rb(0.26, 0.12, 0.4, 0.03, x, y + 0.18, -0.6));
  E.add('dark', zTube(-1.3, -1.75, 0.075, 0.065, 12, x, y)); // recoil housing
  const out = [];
  for (const d of [-1, 1]) {
    const bx = x + d * GUN.dx;
    E.add('dark', zTube(-1.3, GUN.muzzle + 0.2, 0.036, 0.032, 10, bx, y));
    E.add('dark', zTube(-1.75, -2.2, 0.048, 0.048, 10, bx, y)); // perforated jacket
    E.add('dark', zTube(GUN.muzzle + 0.2, GUN.muzzle, 0.045, 0.045, 10, bx, y)); // muzzle brake
    out.push(V(bx, y, GUN.muzzle));
  }
  for (const z of [-2.0, GUN.muzzle + 0.3, GUN.muzzle + 0.1]) E.add('dark', box(GUN.dx * 2 + 0.06, 0.035, 0.05, x, y, z)); // barrel brackets
  E.add('dark', box(0.02, 0.1, 0.25, x, y + 0.05, GUN.muzzle + 0.2));
  return out;
}

// Tracking radar drum with its domed radome face, louvres round the drum and the boom back to the
// cross shaft. The EO window on its upper left (seen from the front: upper right) turns on its own
// drive and is built apart (eoHead); returns the centre of its housing.
function drum(E) {
  const { r, z0, z1 } = DRUM, zc = (z0 + z1) / 2;
  E.add('camo', zTube(z0, z1 + 0.06, r, r, 32, 0, 0));
  E.add('paint', zTube(z1 + 0.08, z1, r + 0.025, r + 0.025, 32, 0, 0)); // front rim
  const dome = lathe([[r * 0.98, -0.02], [r * 0.98, 0.0], [r * 0.85, 0.03], [r * 0.5, 0.055], [0.001, 0.07]], 32); // rim inward: faces out
  E.add('canister', dome.applyMatrix4(xf(0, 0, z1, -Math.PI / 2, 0, 0)), { tint: new THREE.Color(0.72, 1.12, 0.5) }); // the radome cover is a lighter, greener paint (photo 06)
  E.add('dark', zTube(z0 + 0.02, z0 - 0.02, r + 0.01, r + 0.01, 32, 0, 0)); // back seam
  // rows of small diagonal louvres round the lower half of the drum
  for (let i = 0; i < 9; i++) {
    const a = -Math.PI * 0.15 - (i / 8) * Math.PI * 0.7;
    for (const z of [zc + 0.18, zc - 0.05]) E.add('dark', box(0.1, 0.02, 0.012, Math.cos(a) * (r + 0.004), Math.sin(a) * (r + 0.004), z, 0, 0, a + Math.PI / 2));
  }
  // the EO window housing sits on the upper left (eoHead)
  const ex = -0.3, ey = 0.4;
  // sensor housing on top of the drum's right side, a short lateral barrel with a window at each end
  E.add('paint', rb(0.34, 0.2, 0.42, 0.04, 0.2, r + 0.1, zc + 0.05));
  E.add('paint', xTube(0.02, 0.4, 0.11, 0.11, 14, r + 0.27, zc - 0.05));
  E.add('dark', xTube(0.4, 0.42, 0.08, 0.08, 12, r + 0.27, zc - 0.05));
  // boom: the central cradle from the cross shaft to the back of the drum
  E.add('camo', rb(0.76, 0.6, 0.2 - z0, 0.04, 0, -0.05, (0.2 + z0) / 2));
  E.add('dark', xTube(-1.0, 1.0, 0.09, 0.09, 14, 0, 0)); // cross shaft
  E.add('camo', rb(0.5, 0.2, 0.4, 0.03, 0, 0.32, -0.3));
  return V(ex, ey, z1 + 0.16);
}

// The EO window housing (10ES1-E) around its own centre, window toward -Z.
function eoHead(O) {
  O.add('paint', rb(0.24, 0.22, 0.32, 0.05, 0, 0, 0));
  O.add('paint', zTube(-0.14, -0.17, 0.095, 0.095, 16, 0, 0));
  O.add('glass', zTube(-0.17, -0.175, 0.075, 0.075, 16, 0, 0));
}

// 1RS1-1E search radar (radar space, origin 0.3 above the ring, face toward -Z): turntable,
// column, a deep box tapering toward the top with an octagonal face tilted back, ribs and
// waveguides on the back, ports on the sides, the IFF bar and a spoke antenna on top.
function searchRadar(S) {
  // turntable on the turret's rear block (its top is at y = 0.5 here), the column, a collar
  S.add('dark', yTube(0.5, 0.57, 0.36, 0.34, 24, 0, 0));
  S.add('dark', yTube(0.57, 0.86, 0.13, 0.13, 14, 0, 0));
  S.add('camo', yTube(0.79, 0.87, 0.3, 0.3, 18, 0, 0.02));
  const y0 = 0.85, y1 = 1.9, hw = 0.78;
  const zf = (y) => -0.32 + 0.2 * (y - y0), zb = (y) => 0.45 - 0.3 * (y - y0);
  const rect = (y) => [V(-hw, y, zf(y)), V(hw, y, zf(y)), V(hw, y, zb(y)), V(-hw, y, zb(y))];
  S.add('camo', loft([rect(y0), rect(y1)]));
  // octagonal face plate, tilted back like the box's front
  const W = 1.7, H = 1.22, c = 0.3, tilt = Math.atan(0.2);
  const oct = [[-W / 2 + c, -H / 2], [W / 2 - c, -H / 2], [W / 2, -H / 2 + c], [W / 2, H / 2 - c], [W / 2 - c, H / 2], [-W / 2 + c, H / 2], [-W / 2, H / 2 - c], [-W / 2, -H / 2 + c]];
  const ym = (y0 + y1) / 2 + 0.02;
  const place = (g) => g.applyMatrix4(xf(0, ym, zf(ym), tilt, 0, 0));
  S.add('paint', place(frontProfile(oct, -0.04, 0.03)));
  S.add('camo', place(frontProfile(oct.map(([x, y]) => [x * 0.95, y * 0.93]), -0.05, -0.04)), { tint: 0x9aa090 }); // the radiating face, painted over
  // back: ribs and two waveguides with flanges
  const tb = Math.atan(0.3), yb = (y0 + y1) / 2;
  for (let i = -2; i <= 2; i++) S.add('camo', box(0.13, (y1 - y0) / Math.cos(tb) - 0.05, 0.05, i * 0.3, yb, zb(yb) + 0.02, -tb, 0, 0));
  for (const y of [y0 + 0.14, y0 + 0.24]) {
    S.add('dark', xTube(-0.7, 0.7, 0.03, 0.03, 8, y, zb(y) + 0.08));
    for (const x of [-0.45, 0.45]) S.add('dark', xTube(x - 0.05, x + 0.05, 0.045, 0.045, 8, y, zb(y) + 0.08));
  }
  // sides: four round ports and a louvred vent
  for (const s of [-1, 1]) {
    for (const [y, z] of [[1.12, 0.02], [1.12, 0.15], [1.25, 0.02], [1.25, 0.15]]) {
      S.add('dark', xTube(s * hw, s * (hw + 0.025), 0.055, 0.055, 12, y, z));
      S.add('steel', xTube(s * (hw + 0.025), s * (hw + 0.03), 0.035, 0.035, 10, y, z));
    }
    S.add('dark', box(0.02, 0.06, 0.32, s * (hw + 0.01), 1.55, 0.0));
  }
  // IFF bar on two feet, spoke antenna
  S.add('paint', box(1.45, 0.22, 0.07, 0, y1 + 0.17, zf(y1) + 0.12, tilt, 0, 0));
  for (const x of [-0.42, 0.42]) S.add('camo', box(0.24, 0.09, 0.12, x, y1 + 0.03, 0.02));
  S.add('dark', yTube(y1, y1 + 0.28, 0.02, 0.015, 6, -0.6, 0.05));
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    S.add('dark', rod(V(-0.6, y1 + 0.28, 0.05), V(-0.6 + Math.cos(a) * 0.32, y1 + 0.5, 0.05 + Math.sin(a) * 0.32), 0.007, 4));
  }
  S.add('dark', yTube(y1 + 0.28, y1 + 0.75, 0.01, 0.006, 4, -0.6, 0.05));
}

export function buildPantsir() {
  const rig = newRig('green'), { P, root, mats } = rig;
  // chassis, cab, body
  kamazFrame(P, -4.15, BODY.z1);
  kamazRunningGear(P);
  kamazCab(P, { ...CAB, star: false }); // the national markings (markings.js) replace the cab door stars
  body(P);
  greyer(P.build(root, { dirt: 0.5 }));

  // turret
  const tur = pivotAt(rig, root, 'turret', 0, RING.y, RING.z);
  const T = new Parts(mats);
  turretBase(T);
  greyer(T.build(tur, { dirt: 0.25, y0: RING.y }));

  // search radar on the turret rear (spun by the game relative to the turret)
  const sr = pivotAt(rig, tur, 'searchRadar', 0, 0.3, RADAR.z);
  const S = new Parts(mats);
  searchRadar(S);
  greyer(S.build(sr, { dirt: 0, y0: RING.y + 0.3 }));

  // elevating cradle: drum, guns, tube blocks
  const el = pivotAt(rig, tur, 'elevation', 0, EL.y, EL.z);
  const E = new Parts(mats);
  const eo = drum(E);
  const muzzles = [], spans = [];
  for (const s of [-1, 1]) {
    tubeBlock(E, s, spans);
    muzzles.push(...twinGun(E, s));
  }
  const cradle = E.build(el, { dirt: 0, y0: RING.y + EL.y });
  greyer(cradle);
  // setContainer(i, false) takes the whole container of slot i off its block (the reload scene swaps it)
  rig.setContainer = swapper(cradle, spans).set;
  muzzles.forEach((p, i) => rig.anchors.muzzles.push(node(el, 'muzzle' + i, p.x, p.y, p.z)));
  // the EO window on its own drive: `eo` turns it to where the sight looks (rotation.y relative to the
  // turret, then rotation.x relative to the cradle; 0 = along the bore), and the sight anchor with it
  const eoP = pivotAt(rig, el, 'eo', eo.x, eo.y, eo.z);
  eoP.rotation.order = 'YXZ';
  const O = new Parts(mats);
  eoHead(O);
  greyer(O.build(eoP, { dirt: 0, y0: RING.y + EL.y + eo.y }));
  rig.anchors.sight = node(eoP, 'sight', 0, 0, -0.18);

  // tube caps in one merged mesh; a slot is emptied by collapsing its cap into the bore, so all
  // twelve cost one draw call. Slots alternate sides so a salvo comes from both blocks.
  const C = new Parts(mats);
  const slots = [];
  for (let k = 0; k < 12; k++) {
    const side = k % 2 ? 1 : -1, j = Math.floor(k / 2);
    const x = side * TUBE.cols[j % 2], y = TUBE.rows[2 - Math.floor(j / 2)];
    slots.push([x, y]);
    C.add('white', tubeCap(x, y), { tint: 0x8e9484 });
    rig.anchors.missileSlots.push(node(el, 'slot' + k, x, y, TUBE.z1 - 0.05));
  }
  const [capMesh] = C.build(el, { dirt: 0, y0: RING.y + EL.y });
  const pos = capMesh.geometry.attributes.position, per = pos.count / 12, orig = pos.array.slice();
  rig.slots = slots.map(() => []);
  // the cap a round breaks through on its way out (main: fx.coverBurst at the slot's mouth); pale paint
  rig.cover = { size: 2 * (TUBE.r + 0.005), paint: 0x8a8f80 };
  rig.setLoaded = (i, loaded) => {
    if (!(i >= 0 && i < 12)) return;
    const a = pos.array, [x, y] = slots[i];
    for (let v = i * per; v < (i + 1) * per; v++) {
      a[v * 3] = loaded ? orig[v * 3] : x;
      a[v * 3 + 1] = loaded ? orig[v * 3 + 1] : y;
      a[v * 3 + 2] = loaded ? orig[v * 3 + 2] : TUBE.z1 + 0.1;
    }
    pos.needsUpdate = true;
  };

  rig.anchors.eye = node(root, 'eye', 0, 2.6, 0.3);
  hb(rig, -1.3, 0, CAB.bumper, 1.3, 3.2, CAB.zr);
  hb(rig, -1.3, 0.3, CAB.zr, 1.3, CABIN.top, BODY.z1 + 0.15);
  hb(rig, -1.3, RING.y, RING.z - 1.7, 1.3, 4.3, RING.z + 0.8);
  hb(rig, -0.85, 3.3, RING.z + 0.75, 0.85, 5.45, RING.z + 1.75);
  return rig;
}
