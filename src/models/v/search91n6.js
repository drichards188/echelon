import * as THREE from 'three';
import { V, box, yTube, zTube, xTube, rod, frontProfile, topProfile, Parts, mudguard } from '../kit.js';
import { jack, ladder, whip, hose, rearEnd, snorkel, exhaustStack } from '../trucks.js';
import { newRig, node, pivotAt, hb } from '../rig.js';
import { rb, heavyGear, ladderFrame, bogieFender } from './ural.js';
import { lamp, maz543Cabs } from './maz543.js';

// 91N6E (Big Bird) acquisition radar, deployed and turning. No free photo of the 91N6E exists, so
// the layout follows its predecessor the 64N6E2 (refs/s400-support photos 2, 4, 5): an 8x8 tractor
// pulling a semitrailer whose front, over the fifth wheel, carries the antenna post; the post's
// turntable holds a two-faced array (about 5 x 3.5 m, chamfered top corners, a vertical centre
// seam, a dense grid of radiating elements, junction boxes at the lower corners) over a louvred
// cooling box, with a hinged boom across its top carrying a lamp at each end. Behind the post the
// trailer carries a long, low equipment body. The tractor is the MZKT-74106 / MAZ-7410 kind with the
// MAZ-543 split cab (photos 2 and 4, models/v/maz543.js): two narrow cabins either side of a tall
// radiator housing with a wide black bumper below, the front axle under the cabins' rear, an
// equipment bay behind, fifth wheel over the bogie. Built in vehicle z from the cabin faces (0.2)
// back; the group is shifted to centre the 18 m rig.

const OFF = -9.05; // model z of the cab face
const R = 0.75, W = 0.55, TRACK = 1.17; // 1500x600 tyres
const AX = [2.6, 4.45, 6.85, 8.45]; // tractor axles (the first under the cabins' rear)
const TAX = [15.2, 16.75]; // trailer axles
const DECK = 1.85; // top of the semitrailer frame
const KING = 7.55; // kingpin / fifth wheel
const POST = { z0: 6.1, z1: 9.7, top: 2.62 }; // fixed antenna post body
const AXIS = { z: 7.9, y: 2.72 }; // turntable top, the searchRadar pivot
const ARR = { w: 4.9, h: 3.6, d: 0.8, y0: 0.78, cx: 0.4, cy: 0.72 }; // array in pivot space
const BODY = { z0: 10.75, z1: 16.95, top: 2.98, hw: 1.43 }; // long, low equipment body on the trailer

// Element grid of the array face: olive-grey frame with dark square radiators in rows, as the
// 64N6 faces read from a few metres (photo 4). 16 x 16 elements per tile, tile 1.28 m.
let faceMat;
const FACE_TILE = 1.28;
function arrayFaceMaterial() {
  if (faceMat) return faceMat;
  const s = 512, n = 16, c = s / n;
  const cv = document.createElement('canvas');
  cv.width = cv.height = s;
  const g = cv.getContext('2d');
  g.fillStyle = '#545b41';
  g.fillRect(0, 0, s, s);
  const ht = new Float32Array(s * s);
  let seed = 11;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const x0 = i * c + c * 0.24, y0 = j * c + c * 0.24, e = c * 0.52;
    const k = 0.85 + rnd() * 0.3;
    g.fillStyle = '#1c1f17';
    g.fillRect(x0 + 3, y0 + 3, e, e); // shadow
    g.fillStyle = `rgb(${30 * k | 0},${33 * k | 0},${25 * k | 0})`;
    g.fillRect(x0, y0, e, e);
    g.fillStyle = '#626a4e';
    g.fillRect(x0, y0, e, 2);
    g.fillRect(x0, y0, 2, e);
    for (let y = Math.floor(y0); y < y0 + e; y++) for (let x = Math.floor(x0); x < x0 + e; x++) ht[y * s + x] = 1;
  }
  // module seams every 8 elements
  g.fillStyle = '#2a2d22';
  g.fillRect(0, 0, s, 3);
  g.fillRect(0, 0, 3, s);
  const map = new THREE.CanvasTexture(cv);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.anisotropy = 8;
  // normal map from the pin heights
  const nc = document.createElement('canvas');
  nc.width = nc.height = s;
  const ng = nc.getContext('2d'), img = ng.createImageData(s, s);
  const at = (x, y) => ht[((y + s) % s) * s + ((x + s) % s)];
  for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
    const dx = (at(x + 1, y) - at(x - 1, y)) * 0.5, dy = (at(x, y + 1) - at(x, y - 1)) * 0.5;
    const nx = -dx * 2.5, ny = dy * 2.5, l = 1 / Math.hypot(nx, ny, 1), i4 = (y * s + x) * 4;
    img.data[i4] = (nx * l * 0.5 + 0.5) * 255;
    img.data[i4 + 1] = (ny * l * 0.5 + 0.5) * 255;
    img.data[i4 + 2] = (l * 0.5 + 0.5) * 255;
    img.data[i4 + 3] = 255;
  }
  ng.putImageData(img, 0, 0);
  const normalMap = new THREE.CanvasTexture(nc);
  normalMap.wrapS = normalMap.wrapT = THREE.RepeatWrapping;
  faceMat = new THREE.MeshStandardMaterial({ map, normalMap, roughness: 0.75, metalness: 0.2, vertexColors: true });
  faceMat.name = 'array91n6';
  return faceMat;
}

const shape = (pts) => new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
// Front outline of the array (x, y about its centre): chamfered top corners.
function outline(w, h, cx, cy, inset = 0) {
  const a = w / 2 - inset, b = h / 2 - inset, ccx = cx - inset * 0.4, ccy = cy - inset * 0.4;
  return [[-a, -b], [a, -b], [a, b - ccy], [a - ccx, b], [-a + ccx, b], [-a, b - ccy]];
}
// The radiating face: the outline inset, with the lower corners stepped in over the junction boxes.
function faceOutline(w, h, cx, cy) {
  const a = w / 2 - 0.12, b = h / 2 - 0.12, lo = -h / 2 + 0.3, st = 0.42, sx = 0.32;
  return [[-a + sx, lo], [a - sx, lo], [a - sx, lo + st], [a, lo + st], [a, b - cy + 0.08], [a - cx + 0.08, b], [-a + cx - 0.08, b], [-a, b - cy + 0.08], [-a, lo + st], [-a + sx, lo + st]];
}

// The two-faced array centred at (0, yc, 0) of the pivot, faces toward -Z and +Z.
function buildArray(A, yc) {
  const { w, h, d, cx, cy } = ARR;
  A.add('camo', frontProfile(outline(w, h, cx, cy), -d / 2, d / 2).translate(0, yc, 0));
  // raised rim around each face
  const rim = shape(outline(w, h, cx, cy));
  rim.holes.push(new THREE.Path(outline(w, h, cx, cy, 0.12).map(([x, y]) => new THREE.Vector2(x, y))));
  const rimG = new THREE.ExtrudeGeometry(rim, { depth: 0.05, bevelEnabled: false });
  A.add('camo', rimG.clone().translate(0, yc, d / 2));
  A.add('camo', rimG.translate(0, yc, -d / 2 - 0.05));
  // element faces
  for (const f of [-1, 1]) {
    const fg = new THREE.ShapeGeometry(shape(faceOutline(w, h, cx, cy)));
    const uv = fg.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / FACE_TILE, uv.getY(i) / FACE_TILE);
    if (f < 0) fg.rotateY(Math.PI);
    A.add('face', fg.translate(0, yc, f * (d / 2 + 0.012)));
    A.add('dark', box(0.07, h - 0.55, 0.03, 0.0, yc + 0.12, f * (d / 2 + 0.02))); // centre seam
  }
  // bottom beam with the junction boxes at the lower corners
  const yb = yc - h / 2;
  A.add('camo', box(w - 0.1, 0.3, d + 0.16, 0, yb + 0.15, 0));
  for (const s of [-1, 1]) {
    A.add('camo', rb(0.62, 0.55, d + 0.3, 0.03, s * (w / 2 - 0.28), yb + 0.38, 0));
    A.add('dark', box(0.5, 0.04, d + 0.32, s * (w / 2 - 0.28), yb + 0.45, 0));
    for (const f of [-1, 1]) A.add('dark', box(0.3, 0.2, 0.02, s * (w / 2 - 0.3), yb + 0.33, f * (d / 2 + 0.16)));
  }
  // edges: ribbed side frames, cable trays and lifting eyes along the top
  for (const s of [-1, 1]) for (let i = 0; i < 5; i++) A.add('dark', box(0.03, 0.04, d + 0.06, s * (w / 2 + 0.01), yb + 0.7 + i * 0.5, 0));
  const yt = yc + h / 2;
  A.add('dark', box(w - 2 * cx - 0.3, 0.08, 0.3, 0, yt + 0.04, 0));
  for (const x of [-1.6, -0.9, 0.9, 1.6]) {
    A.add('steel', box(0.1, 0.16, 0.06, x, yt + 0.08, -0.25));
    A.add('steel', box(0.1, 0.16, 0.06, x, yt + 0.08, 0.25));
  }
  // the boom across the top: hinge bracket at the centre, bent tube, a lamp hanging at each end
  A.add('camo', rb(0.5, 0.36, 0.6, 0.04, 0, yt + 0.18, 0));
  A.add('dark', xTube(-0.3, 0.3, 0.09, 0.09, 10, yt + 0.32, 0));
  const hinge = V(0, yt + 0.42, 0), ends = [V(-3.25, yt - 0.25, 0.1), V(3.35, yt + 0.42 + 0.3, -0.1)];
  const knee = V(-1.2, yt + 0.42, 0.05);
  A.add('paint', rod(hinge, V(0.6, yt + 0.48, 0), 0.09, 8));
  A.add('paint', rod(V(0.6, yt + 0.48, 0), ends[1], 0.075, 8));
  A.add('paint', rod(hinge, knee, 0.09, 8));
  A.add('paint', rod(knee, ends[0], 0.075, 8));
  for (const e of ends) {
    A.add('dark', rod(e, V(e.x, e.y - 0.25, e.z), 0.03, 5));
    A.add('dark', rb(0.26, 0.3, 0.28, 0.04, e.x, e.y - 0.38, e.z));
    A.add('lens', box(0.2, 0.2, 0.02, e.x, e.y - 0.4, e.z - 0.15));
    A.add('lens', box(0.2, 0.2, 0.02, e.x, e.y - 0.4, e.z + 0.15));
  }
  // hydraulic ram from the bracket to the boom
  A.add('steel', rod(V(0.2, yt + 0.12, 0.2), V(1.4, yt + 0.6, 0.12), 0.04, 6));
}

// Front of the MAZ-543 tractor: full-width black bumper with lamps and a tow hook, the tall radiator
// housing between the cabins with its vertical-slat grille behind a tubular guard, the engine under
// it and the raised equipment box behind its hood (photos 2 and 4). Placed by f behind the bumper.
const ZO = -0.04; // model z = f + ZO (the cabin faces stand at z 0.2)
const HW = 0.65; // half width of the housing between the cabins
function front543(P) {
  const ext = (x0, x1, y0, y1, f0, f1) => box(Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(f1 - f0), (x0 + x1) / 2, (y0 + y1) / 2, (f0 + f1) / 2 + ZO);
  const lampZ = (x, y, r, key) => lamp(P, x, y, ZO, r, key);
  // bumper with chamfered ends, top lip, an under-skirt down to the skid plate
  P.add('dark', topProfile([[-1.58, ZO + 0.14], [-1.44, ZO], [1.44, ZO], [1.58, ZO + 0.14], [1.58, ZO + 0.46], [-1.58, ZO + 0.46]], 0.86, 1.28));
  P.add('dark', ext(-1.5, 1.5, 1.22, 1.29, 0.02, 0.4));
  P.add('dark', ext(-1.25, 1.25, 0.58, 0.88, 0.14, 0.9)); // skid plate and sump behind the bumper
  for (const s of [-1, 1]) {
    lampZ(s * 1.32, 1.08, 0.065, 'amber');
    P.add('amber', ext(s * 1.5 - 0.05, s * 1.5 + 0.05, 1.02, 1.12, -0.03, 0.02)); // side marker
    P.add('red', ext(s * 1.5 - 0.04, s * 1.5 + 0.04, 1.12, 1.2, -0.03, 0.02));
    P.add('dark', ext(s * 0.8, s * 1.0, 0.92, 1.0, -0.12, 0.02)); // tow eyes
  }
  P.add('red', ext(-0.03, 0.03, 0.97, 1.05, -0.12, 0.0)); // tow hook, centre
  P.add('steel', ext(-0.08, 0.08, 0.9, 0.97, -0.06, 0.02));
  // radiator housing: body, face frame round 25 deep vertical bars, mid bar, hood ribs
  P.add('camo', ext(-HW, HW, 1.0, 2.12, 0.34, 1.8));
  P.add('dark', ext(-HW + 0.08, HW - 0.08, 1.3, 2.03, 0.33, 0.35));
  P.add('camo', ext(-HW, HW, 2.02, 2.12, 0.2, 0.34));
  P.add('camo', ext(-HW, HW, 1.2, 1.3, 0.2, 0.34));
  for (const s of [-1, 1]) P.add('camo', ext(s * HW, s * (HW - 0.1), 1.3, 2.02, 0.2, 0.34));
  P.add('camo', ext(-HW, HW, 1.0, 1.2, 0.3, 0.34));
  const bars = 22, bw = (2 * (HW - 0.1) - 0.02) / bars;
  for (let i = 0; i < bars; i++) P.add('camo', ext(-HW + 0.11 + i * bw, -HW + 0.11 + i * bw + 0.022, 1.3, 2.02, 0.25, 0.31));
  P.add('camo', ext(-HW + 0.1, HW - 0.1, 1.63, 1.71, 0.22, 0.33));
  for (let i = 0; i < 7; i++) P.add('camo', ext(-0.5 + i * 0.17, -0.46 + i * 0.17, 2.12, 2.14, 0.6, 1.7));
  // tubular guard across the grille: two rails and four posts, and two lifting handles on the hood
  for (const y of [1.45, 1.86]) P.add('camo', ext(-0.5, 0.5, y, y + 0.05, 0.12, 0.17));
  for (const x of [-0.5, -0.17, 0.17, 0.5]) P.add('camo', ext(x - 0.025, x + 0.025, 1.45, 1.91, 0.12, 0.17));
  for (const s of [-1, 1]) for (const f of [0.15, 0.22]) P.add('camo', ext(s * 0.4 - 0.02, s * 0.4 + 0.02, 1.4, 1.9, f, f + 0.05));
  for (const x of [-0.3, 0.3]) {
    P.add('steel', rod(V(x - 0.12, 2.12, 0.42 + ZO), V(x - 0.12, 2.18, 0.42 + ZO), 0.012, 5));
    P.add('steel', rod(V(x + 0.12, 2.12, 0.42 + ZO), V(x + 0.12, 2.18, 0.42 + ZO), 0.012, 5));
    P.add('steel', rod(V(x - 0.12, 2.18, 0.42 + ZO), V(x + 0.12, 2.18, 0.42 + ZO), 0.012, 5));
  }
  // raised equipment box between the cabins behind the hood, with a lidded box and hatches on top
  P.add('camo', ext(-HW, HW, 1.3, 2.78, 1.8, 2.62));
  P.add('camo', ext(-0.5, 0.5, 2.78, 3.2, 1.9, 2.5));
  P.add('dark', ext(-0.52, 0.52, 3.16, 3.2, 1.88, 2.52));
  for (const x of [-0.3, 0, 0.3]) P.add('steel', ext(x - 0.04, x + 0.04, 2.9, 3.0, 1.88, 1.9));
  // engine under the housing
  P.add('dark', ext(-0.8, 0.8, 0.62, 1.15, 0.6, 2.0));
}

export function buildSearch() {
  const rig = newRig('green'), { P, root, mats } = rig;
  const g = new THREE.Group();
  g.position.z = OFF;
  root.add(g);

  // ---------------------------------------------------------------- tractor
  heavyGear(P, { axles: AX, R, W, track: TRACK, steered: 2 });
  ladderFrame(P, 0.35, 9.35, 1.32, 0.5);
  front543(P);
  maz543Cabs(P, { sides: 'both', zOff: ZO, xi: 0.65, w: 0.9, roof: { left: ['mast'], right: ['light', 'beacon'] } });
  // equipment bay behind the cabins: narrow over the frame, wide above the second axle's wheels
  P.add('camo', box(1.6, 0.42, 2.15, 0, 1.52, 3.55));
  P.add('camo', rb(2.72, 1.12, 2.15, 0.05, 0, 2.28, 3.55));
  for (const s of [-1, 1]) {
    for (let i = 0; i < 7; i++) P.add('dark', box(0.03, 0.05, 1.5, s * 1.37, 2.0 + i * 0.09, 3.5)); // side louvres
    P.add('dark', box(0.03, 0.75, 0.025, s * 1.37, 2.3, 2.6));
    P.add('dark', box(0.03, 0.75, 0.025, s * 1.37, 2.3, 4.5));
  }
  for (let i = 0; i < 9; i++) P.add('dark', box(2.2, 0.03, 0.06, 0, 2.85, 2.85 + i * 0.16)); // top grilles
  P.add('dark', box(2.3, 0.02, 1.5, 0, 2.835, 3.5));
  exhaustStack(P, 1.15, 5.15, 1.6, 3.5);
  snorkel(P, -1.2, 2.95, 2.75, 3.45);
  // fuel tanks and battery box between the second and third axles
  for (const s of [-1, 1]) {
    P.add('camo', zTube(5.25, 6.0, 0.3, 0.3, 16, s * 1.0, 1.0));
    for (const z of [5.35, 5.9]) P.add('dark', box(0.66, 0.05, 0.06, s * 1.0, 0.68, z));
    P.add('camo', mudguard(R, W + 0.12, s * TRACK, R, AX[1], 20, 175, 0.08, 0.04));
  }
  P.add('camo', rb(0.6, 0.5, 0.8, 0.03, -0.0, 1.0, 5.6));
  // fifth wheel and the bogie fenders
  P.add('dark', box(1.3, 0.12, 1.6, 0, 1.4, KING));
  P.add('steel', yTube(1.46, 1.58, 0.72, 0.72, 20, 0, KING));
  P.add('dark', box(0.3, 0.05, 0.9, 0, 1.6, KING + 0.6));
  for (const s of [-1, 1]) bogieFender(P, s * TRACK, AX[2] - 0.95, AX[3] + 0.95, 1.6, W);
  rearEnd(P, 9.4, 2.4, 0.95);

  // ---------------------------------------------------------------- semitrailer
  // gooseneck beams over the tractor (between its fenders), then the main frame at deck height
  for (const s of [-1, 1]) {
    P.add('dark', box(0.16, 0.24, 4.6, s * 0.55, 1.74, 8.1));
    P.add('dark', box(0.2, 0.45, 7.6, s * 0.6, DECK - 0.225, 14.15));
    P.add('camo', box(0.08, 0.3, 17.95 - 5.8, s * 1.42, DECK - 0.15, (5.8 + 17.95) / 2)); // side member
    P.add('dark', box(0.1, 0.03, 17.95 - 5.8, s * 1.43, DECK - 0.29, (5.8 + 17.95) / 2));
  }
  P.add('dark', box(2.84, 0.06, 17.95 - 5.8, 0, DECK - 0.03, (5.8 + 17.95) / 2)); // deck plate
  for (let z = 10.6; z < 17.8; z += 1.2) P.add('dark', box(1.2, 0.2, 0.12, 0, DECK - 0.3, z));
  P.add('steel', yTube(1.58, 1.62, 0.5, 0.5, 18, 0, KING)); // rubbing plate
  heavyGear(P, { axles: TAX, R, W, track: TRACK, steered: 0, shafts: false });
  for (const s of [-1, 1]) bogieFender(P, s * TRACK, TAX[0] - 0.95, TAX[1] + 0.95, 1.6, W);
  for (const s of [-1, 1]) P.add('dark', box(0.12, 0.3, 3.4, s * 0.45, 1.3, (TAX[0] + TAX[1]) / 2)); // bogie beams
  rearEnd(P, 17.98, 2.6, 1.15);
  // landing legs (wound up) and the stabiliser jacks lowered at the trailer corners
  for (const s of [-1, 1]) {
    P.add('dark', box(0.16, 1.1, 0.16, s * 0.8, DECK - 0.8, 10.25));
    P.add('steel', yTube(0.62, 1.0, 0.05, 0.05, 8, s * 0.8, 10.25));
    P.add('dark', box(0.3, 0.06, 0.4, s * 0.8, 0.6, 10.25));
    for (const z of [9.95, 17.55]) {
      P.add('dark', box(0.32, 0.22, 0.32, s * 1.3, DECK - 0.2, z));
      jack(P, s * 1.55, z, DECK - 0.1);
      P.add('dark', box(0.3, 0.18, 0.28, s * 1.42, DECK - 0.18, z));
    }
  }

  // fixed antenna post body over the fifth wheel: louvred sides, a door, a ladder, handrails
  // (it hangs down over the fifth wheel to just above the tractor's fenders)
  const pb = 1.69, pc = (POST.z0 + POST.z1) / 2, pl = POST.z1 - POST.z0, ph = POST.top - pb;
  P.add('camo', rb(2.8, ph, pl, 0.04, 0, pb + ph / 2, pc));
  P.add('dark', box(2.84, 0.05, pl + 0.04, 0, DECK - 0.02, pc));
  for (const s of [-1, 1]) {
    P.add('dark', box(0.03, ph - 0.25, 1.0, s * 1.405, pb + ph / 2, POST.z0 + 0.8));
    for (let i = 0; i < 5; i++) P.add('camo', box(0.05, 0.035, 0.94, s * 1.42, pb + 0.2 + i * 0.14, POST.z0 + 0.8));
    P.add('dark', box(0.03, ph - 0.2, 0.7, s * 1.405, pb + ph / 2, POST.z1 - 0.7));
    P.add('steel', box(0.05, 0.04, 0.12, s * 1.43, pb + ph / 2, POST.z1 - 0.45));
    P.add('dark', box(0.03, 0.5, 0.9, s * 1.405, pb + ph / 2, pc + 0.2)); // cable connector panel
    for (let i = 0; i < 3; i++) P.add('dark', zTube(pc - 0.05 + i * 0.25, pc + 0.05 + i * 0.25, 0.05, 0.05, 8, s * 1.42, pb + ph / 2));
    // handrails along the post deck
    for (const z of [POST.z0 + 0.15, pc, POST.z1 - 0.15]) P.add('steel', yTube(POST.top, POST.top + 0.9, 0.02, 0.02, 5, s * 1.32, z));
    P.add('steel', zTube(POST.z0 + 0.15, POST.z1 - 0.15, 0.022, 0.022, 5, s * 1.32, POST.top + 0.9));
    P.add('steel', zTube(POST.z0 + 0.15, POST.z1 - 0.15, 0.016, 0.016, 5, s * 1.32, POST.top + 0.48));
  }
  ladder(P, 1.55, POST.z1 - 0.2, 0.25, POST.top, 0.42);
  P.add('dark', yTube(POST.top, AXIS.y - 0.06, 1.05, 1.05, 28, 0, AXIS.z)); // turntable race
  P.add('camo', yTube(AXIS.y - 0.08, AXIS.y - 0.04, 1.08, 1.08, 28, 0, AXIS.z));
  hose(P, V(-0.9, POST.top + 0.02, POST.z1 - 0.2), V(-0.9, DECK + 0.4, BODY.z0 + 0.05), 0.25, 0.06, 'tyre', 4);
  hose(P, V(-0.6, POST.top + 0.02, POST.z1 - 0.2), V(-0.6, DECK + 0.6, BODY.z0 + 0.05), 0.3, 0.05, 'tyre', 4);

  // long, low equipment body on the trailer: flat roof, access hatches, hatch and ladders at the rear
  const bc = (BODY.z0 + BODY.z1) / 2, bl = BODY.z1 - BODY.z0, bh = BODY.top - DECK;
  P.add('camo', rb(BODY.hw * 2, bh, bl, 0.05, 0, DECK + bh / 2, bc));
  P.add('camo', box(BODY.hw * 2 - 0.25, 0.06, bl - 0.25, 0, BODY.top + 0.02, bc));
  for (const s of [-1, 1]) {
    const x = s * (BODY.hw + 0.004);
    for (let i = 1; i < 5; i++) P.add('dark', box(0.03, bh - 0.06, 0.025, x, DECK + bh / 2, BODY.z0 + (bl * i) / 5)); // panel seams
    for (let i = 0; i < 5; i++) {
      const z = BODY.z0 + (bl * (i + 0.5)) / 5;
      P.add('dark', box(0.03, 0.75, 0.025, x, DECK + 0.56, z - 0.45));
      P.add('dark', box(0.03, 0.75, 0.025, x, DECK + 0.56, z + 0.45));
      P.add('dark', box(0.03, 0.025, 0.9, x, DECK + 0.93, z));
      P.add('dark', box(0.03, 0.025, 0.9, x, DECK + 0.18, z));
      P.add('steel', box(0.05, 0.12, 0.05, s * (BODY.hw + 0.02), DECK + 0.56, z + 0.3));
      if (s < 0 && i % 2 === 0) for (let k = 0; k < 3; k++) P.add('camo', box(0.04, 0.035, 0.7, x, DECK + 0.38 + k * 0.17, z)); // louvres
    }
  }
  // rear wall: hatch, air conditioner, ladders up the trailer's tail and to the roof
  P.add('dark', box(0.9, 0.85, 0.03, 0.55, DECK + 0.55, BODY.z1 + 0.005));
  P.add('steel', box(0.05, 0.14, 0.05, 0.2, DECK + 0.55, BODY.z1 + 0.03));
  P.add('camo', rb(1.0, 0.7, 0.4, 0.04, -0.75, DECK + 0.5, BODY.z1 + 0.2));
  for (let i = 0; i < 5; i++) P.add('dark', box(0.85, 0.03, 0.02, -0.75, DECK + 0.3 + i * 0.1, BODY.z1 + 0.41));
  ladder(P, 0.6, 18.12, 0.45, DECK + 0.1, 0.42);
  ladder(P, 1.25, BODY.z1 + 0.06, DECK + 0.1, BODY.top + 0.5, 0.36);
  // roof: travel rests for the folded array, cable trays, a short mast with a whip and a ring antenna
  for (const s of [-1, 1]) {
    P.add('dark', box(0.25, 0.5, 0.25, s * 1.0, BODY.top + 0.25, 11.6));
    P.add('rubber', box(0.4, 0.06, 0.35, s * 1.0, BODY.top + 0.52, 11.6));
  }
  P.add('dark', box(0.3, 0.08, bl - 1.6, 0.9, BODY.top + 0.06, bc + 0.6));
  P.add('dark', yTube(BODY.top, BODY.top + 1.5, 0.06, 0.05, 8, -1.0, BODY.z0 + 0.6));
  P.add('dark', yTube(BODY.top + 1.5, BODY.top + 1.56, 0.25, 0.25, 14, -1.0, BODY.z0 + 0.6, true));
  whip(P, -1.0, BODY.top + 1.56, BODY.z0 + 0.6, 2.4);
  P.add('camo', rb(0.9, 0.55, 1.3, 0.04, 0.6, BODY.top + 0.28, 15.6)); // ventilation unit
  for (let i = 0; i < 6; i++) P.add('dark', box(0.03, 0.42, 1.1, 0.6 + (i - 2.5) * 0.13, BODY.top + 0.3, 15.6));
  // rear platform behind the body: cable drum and a tool box
  P.add('camo', xTube(-1.1, -0.95, 0.34, 0.34, 16, DECK + 0.36, 17.45));
  P.add('camo', xTube(-0.45, -0.3, 0.34, 0.34, 16, DECK + 0.36, 17.45));
  P.add('rubber', xTube(-0.95, -0.45, 0.27, 0.27, 14, DECK + 0.36, 17.45));
  P.add('camo', rb(0.9, 0.5, 0.6, 0.03, 0.75, DECK + 0.25, 17.5));
  P.build(g, { dirt: 0.45 });

  // ---------------------------------------------------------------- antenna (turns)
  const sr = pivotAt(rig, g, 'searchRadar', 0, AXIS.y, AXIS.z);
  const A = new Parts({ ...mats, face: arrayFaceMaterial() });
  A.add('dark', yTube(0, 0.1, 1.0, 0.95, 24));
  A.add('camo', rb(1.5, 0.28, 1.15, 0.04, 0, 0.2, 0)); // equipment cabinet on the turntable
  A.add('dark', box(1.0, 0.18, 0.02, 0.1, 0.2, -0.585));
  // cooling box under the array: deep vertical fins with dark gaps between them (photos 2, 4)
  A.add('dark', box(2.3, 0.44, 0.6, 0.15, ARR.y0 - 0.24, 0));
  for (let i = 0; i < 18; i++) A.add('camo', box(0.05, 0.44, 0.74, 0.15 - 1.12 + i * 0.132, ARR.y0 - 0.24, 0));
  A.add('camo', box(2.4, 0.05, 0.78, 0.15, ARR.y0 - 0.02, 0));
  A.add('camo', box(2.4, 0.05, 0.78, 0.15, ARR.y0 - 0.46, 0));
  for (const s of [-1, 1]) { // struts to the array's lower corners, cable loops
    A.add('dark', rod(V(s * 0.65, 0.12, -0.45), V(s * 2.0, ARR.y0 + 0.05, -0.25), 0.05, 6));
    A.add('dark', rod(V(s * 0.65, 0.12, 0.45), V(s * 2.0, ARR.y0 + 0.05, 0.25), 0.05, 6));
  }
  hose(A, V(-1.1, ARR.y0 + 0.1, 0.36), V(-0.7, 0.35, 0.58), 0.12, 0.05, 'tyre', 4);
  hose(A, V(-1.25, ARR.y0 + 0.1, -0.36), V(-0.8, 0.3, -0.58), 0.14, 0.04, 'tyre', 4);
  buildArray(A, ARR.y0 + ARR.h / 2);
  A.build(sr, { dirt: 0, y0: AXIS.y });

  rig.anchors.eye = node(root, 'eye', 0, 3.6, 0.5);
  hb(rig, -1.45, 0, OFF - 0.45, 1.45, 3.3, OFF + 9.45); // tractor
  hb(rig, -1.45, 0.6, OFF + 9.45, 1.45, BODY.top + 0.2, OFF + 18.0); // trailer and body
  hb(rig, -1.45, 1.4, OFF + POST.z0, 1.45, AXIS.y + ARR.y0, OFF + POST.z1); // antenna post
  hb(rig, -2.3, AXIS.y + ARR.y0, OFF + AXIS.z - 2.3, 2.3, AXIS.y + ARR.y0 + ARR.h + 0.4, OFF + AXIS.z + 2.3); // array swept
  return rig;
}
