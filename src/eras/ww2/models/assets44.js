import * as THREE from 'three';
import { V, box, rbox, yTube, zTube, xTube, rod, xf, frontProfile, Parts, concreteTextures, grainTextures, earthTextures, surfaceFinish, projectUV } from '../../../models/kit.js';
import { mulberry32 } from '../../../noise.js';
import { flakMats, add, sandbag } from './kit44.js';
import { buildMe262 } from './me262.js';

// The WW2 era's defended Fliegerhorst (refs/ww2/airfield section 4, "the game's airbase as a 1945
// Fliegerhorst"): asset builders for site.js registerAssets. Each takes the deploy.js asset object and
// returns a group whose origin is on the ground at the asset, -Z along its bearing (the caller turns it):
//   revetment   a Splitterschutzbox: an open-topped U-shaped earth blast bay (photo airfield_hopsten_attack_03
//               from the air, airfield_blastwall_14 a surviving wall at Wesendorf): inside 20 m across by 16 m
//               deep, the banks 2.8 m high with a 7 m base, rounded and grassed, open toward -Z (the taxiway),
//               a concrete hardstand inside. asset.jet (default true) parks an Me 262 A-2a nose out (me262.js:
//               no national cross, nothing on the fin but the Werknummer); asset.letter its letter
//               (default from the asset id), asset.werknummer.
//   hangar      the large hall half hidden in a wood off the north boundary: 60 m wide, 40 m deep, 12 m to the
//               ridge, a shallow segmental steel roof camouflaged in patches, rendered brick walls, the
//               sliding doors across the whole front (-Z) with their glazed tops and the track, a two-storey
//               workshop range along the back.
//   tower44     the Flugleitung: a two-storey rendered building 25 x 10 m with a flat roof (photo
//               airfield_flugleitung_13, Goslar, a type example), white-framed windows, the entrance porch
//               with its balcony, and the glazed control room on the roof (top 9.5 m); the signal square and
//               the windsock in front (-Z, toward the field).
//   fuel44      the bulk fuel store: a fenced area 80 x 50 m with five earth-covered horizontal tanks
//               (12 m long), their fill domes and vent pipes standing out, a rail siding along the front with
//               three tank wagons, the fill point gantry, stacks of 200 l drums, a pump hut.
//   command44   the Fliegerhorst or flak command post: a concrete bunker about 15 x 10 m under an earth mound,
//               two entrances with blast walls (one each end), three radio masts with the aerial wires, the
//               telephone pole line out.
// Sizes are the sheet's estimates (E) where it gives no source.

const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const canvasTex = (c) => { const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; return t; };

let M;
function mats() {
  if (M) return M;
  const base = flakMats('grey'), grain = grainTextures(), earth = earthTextures();
  const std = (c, r, m, extra = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: m, vertexColors: true, ...extra });
  const con = concreteTextures(0xb4afa3), render = concreteTextures(0xd6d0c2);
  // turf for the banks: the kit's grass and soil, a little faded for the winter
  const turf = std(0xc4bfa4, 1, 0, { map: earth.map, roughnessMap: earth.rough, normalMap: earth.normal });
  // a camouflage-painted roof: dark green and brown patches over grey, 8 m tile
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d'), rnd = mulberry32(44);
  g.fillStyle = '#5b5e55'; g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 14; i++) {
    g.fillStyle = i % 2 ? '#3f4834' : '#56483a';
    g.beginPath();
    const x = rnd() * 256, y = rnd() * 256, r = 30 + rnd() * 50;
    for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2, rr = r * (0.6 + rnd() * 0.6); g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); }
    g.fill();
  }
  for (let i = 0; i < 20; i++) { g.fillStyle = 'rgba(20,20,18,0.25)'; g.fillRect(0, i * 12.8, 256, 1.5); }
  const roofMap = canvasTex(c);
  const finish = (m, key, o = {}) => surfaceFinish(m, 'ww2-site-' + key, { mud: 0.6, mudTop: 1.4, dust: 0.3, dustColor: 0x9a9480, mudColor: 0x4a4235, ...o });
  M = {
    ...base,
    concrete: finish(std(0xffffff, 1, 0, { map: con.map, roughnessMap: con.rough, normalMap: con.normal }), 'concrete'),
    render: finish(std(0xffffff, 1, 0, { map: render.map, roughnessMap: render.rough, normalMap: render.normal }), 'render'),
    turf,
    roof: finish(std(0xffffff, 0.9, 0.2, { map: roofMap, roughnessMap: grain.rough, normalMap: grain.normal }), 'roof', { mud: 0, dust: 0.2 }),
    window: std(0x1f2a30, 0.08, 0.4, { envMapIntensity: 1.8 }),
    frame: finish(std(0xe2e0d8, 0.7, 0.0, { roughnessMap: grain.rough, normalMap: grain.normal }), 'frame', { mud: 0.2 }),
    leaf: std(0xffffff, 1, 0, { side: THREE.DoubleSide }),
    gravel: finish(std(0x8f8a7c, 1, 0, { map: con.map, roughnessMap: con.rough, normalMap: con.normal }), 'gravel', { mud: 0.3 }),
  };
  return M;
}
const addUV = (P, key, g, tint = 0xffffff, tile = 4) => add(P, key, g, tint, tile);

// a smooth earth bank along a polyline in plan ([x, z] points, open ends rounded down), crown height H,
// base width B: a lofted rounded profile swept along the path
function bankAlong(P, path, H, B, key = 'turf', rnd = mulberry32(5)) {
  const prof = [[-0.5, 0], [-0.4, 0.35], [-0.25, 0.8], [-0.08, 1.0], [0.08, 1.0], [0.25, 0.8], [0.4, 0.35], [0.5, 0]];
  const pos = [];
  const N = path.length;
  const pt = (i, k) => {
    const [x, z] = path[i], [x0, z0] = path[Math.max(0, i - 1)], [x1, z1] = path[Math.min(N - 1, i + 1)];
    let dx = x1 - x0, dz = z1 - z0; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
    const nx = -dz, nz = dx;
    const end = Math.min(i, N - 1 - i), hk = sstep(0, 2.5, end) * 0.85 + 0.15;
    const [u, v] = prof[k], n = (rnd() - 0.5) * 0.15;
    return V(x + nx * u * B, Math.max(0, v * H * hk + (k > 0 && k < prof.length - 1 ? n : 0)), z + nz * u * B);
  };
  const grid = path.map((_, i) => prof.map((__, k) => pt(i, k)));
  for (let i = 0; i < N - 1; i++) for (let k = 0; k < prof.length - 1; k++) {
    const a = grid[i][k], b = grid[i + 1][k], c = grid[i][k + 1], d = grid[i + 1][k + 1];
    pos.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry().setFromPoints(pos);
  g.computeVertexNormals();
  // make the faces point up/out whatever the path's winding
  const n = g.attributes.normal;
  let up = 0; for (let i = 0; i < n.count; i++) up += n.getY(i);
  if (up < 0) { const p = g.attributes.position.array; for (let i = 0; i < p.length; i += 9) for (let c = 0; c < 3; c++) { const t = p[i + 3 + c]; p[i + 3 + c] = p[i + 6 + c]; p[i + 6 + c] = t; } g.computeVertexNormals(); }
  const p = g.attributes.position, uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) { uv[i * 2] = p.getX(i) / 8; uv[i * 2 + 1] = p.getZ(i) / 8 + p.getY(i) / 8; }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  P.add(key, g, { uv: true });
}

// a simple conifer and a birch for the edges (two parts each), at (x, z), height h
function tree(P, x, z, h, kind, rnd) {
  if (kind === 'pine') {
    add(P, 'wood', yTube(0, h * 0.75, 0.16, 0.08, 6, x, z), 0x7a5a40, 0);
    add(P, 'leaf', new THREE.ConeGeometry(h * 0.18, h * 0.45, 7).translate(x, h * 0.75, z), 0x3c4a2c, 0);
    add(P, 'leaf', new THREE.ConeGeometry(h * 0.14, h * 0.3, 7).translate(x + (rnd() - 0.5) * 0.3, h * 0.92, z), 0x405030, 0);
  } else {
    // a birch in late winter: bare, the crown a haze of purple-brown twigs
    add(P, 'white', yTube(0, h * 0.8, 0.12, 0.06, 6, x, z), 0xe8e6e0, 0);
    add(P, 'leaf', new THREE.IcosahedronGeometry(h * 0.16, 0).applyMatrix4(xf(x, h * 0.8, z, 0, rnd() * 3, 0, V(1, 1.5, 1))), 0x5a4a44, 0);
  }
}

// ---------------------------------------------------------------- revetment

const LETTERS = 'XKLMHNPABE';
function revetment(asset = {}) {
  const root = new THREE.Group();
  const P = new Parts(mats()), rnd = mulberry32(((asset.id || 'r').length * 977 + (asset.x | 0)) >>> 0);
  const W = 20, D = 16, H = 2.8, B = 7;
  // the U: along the back and down both sides, the bank's centreline B/2 outside the bay
  const path = [];
  const xo = W / 2 + B / 2 - 1.0, zb = D / 2 + B / 2 - 1.0;
  for (let i = 0; i <= 8; i++) path.push([-xo, -D / 2 - 1.5 + (i / 8) * (D / 2 + 1.5 + zb - 3)]);
  for (let i = 1; i < 10; i++) { const a = Math.PI + (i / 10) * Math.PI; path.push([Math.cos(a) * xo, zb - 3 - Math.sin(a) * 3]); }
  for (let i = 8; i >= 0; i--) path.push([xo, -D / 2 - 1.5 + (i / 8) * (D / 2 + 1.5 + zb - 3)]);
  bankAlong(P, path.map(([x, z]) => [x, z]).reverse(), H, B, 'turf', rnd);
  // the hardstand, a concrete pad with expansion joints, and its apron out to the taxiway
  addUV(P, 'concrete', box(W - 1, 0.12, D, 0, 0.06, 0.5), 0xd8d4ca, 6);
  addUV(P, 'concrete', box(14, 0.1, 10, 0, 0.05, -D / 2 - 4.5), 0xd0ccc2, 6);
  for (const x of [-4.75, 0, 4.75]) add(P, 'black', box(0.05, 0.005, D, x, 0.123, 0.5), 0x3a3a38, 0);
  // wheel chocks, a trestle, fuel drums and a starter battery cart by the bank
  for (const x of [-1.25, 1.25]) for (const dz of [-0.6, 0.6]) add(P, 'wood', box(0.25, 0.18, 0.2, x, 0.21, 1.2 + dz * 0.75), 0x9a8060, 1);
  for (let i = 0; i < 4; i++) add(P, 'paint', yTube(0.12, 1.0, 0.29, 0.29, 12, 7.2 + (i % 2) * 0.62, 5.8 - Math.floor(i / 2) * 0.62), 0x7a8a6a);
  add(P, 'paint', rbox(1.2, 0.7, 0.8, 0.05, -7.0, 0.55, 4.5), 0x9aa08a);
  for (const s of [-1, 1]) add(P, 'black', xTube(-7.65, -6.35, 0.2, 0.2, 10, 0.22, 4.5 + s * 0.3));
  // a few pines and birches on the bank's outer foot (the bays at Hopsten lay among woods and fields)
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 1.4 - 0.2, r = 15 + rnd() * 3;
    tree(P, Math.cos(a) * r * (i % 2 ? 1 : -1), Math.sin(a) * r * 0.8 + 4, 9 + rnd() * 6, i % 3 ? 'pine' : 'birch', rnd);
  }
  P.build(root, { dirt: 0.2 });
  // the parked jet, nose toward the opening, its main wheels over the hardstand's middle
  if (asset.jet !== false) {
    const n = Number(String(asset.id || '').replace(/\D/g, '')) || 0;
    const jet = buildMe262({ letter: asset.letter || LETTERS[n % LETTERS.length], werknummer: asset.werknummer || String(500200 + n * 7), seed: n });
    jet.position.set(0, 0.12, 1.0);
    root.add(jet);
  }
  return root;
}

// ---------------------------------------------------------------- hangar

function hangar() {
  const root = new THREE.Group();
  const P = new Parts(mats()), rnd = mulberry32(60);
  const W = 60, D = 40, Hw = 9.0, Hr = 12.0;
  // the walls: rendered brick, a plinth, the corner piers
  addUV(P, 'render', box(0.5, Hw, D, -W / 2, Hw / 2, 0), 0xe0dccf, 6);
  addUV(P, 'render', box(0.5, Hw, D, W / 2, Hw / 2, 0), 0xe0dccf, 6);
  addUV(P, 'render', box(W, Hw + 1.2, 0.5, 0, (Hw + 1.2) / 2, D / 2), 0xe0dccf, 6);
  for (const x of [-W / 2, W / 2]) addUV(P, 'render', box(1.4, Hw + 0.6, 1.4, x, (Hw + 0.6) / 2, -D / 2 + 0.7), 0xd6d2c4, 6);
  addUV(P, 'concrete', box(W + 0.6, 0.6, D + 0.6, 0, 0.3, 0), 0xb8b4aa, 6);
  // side windows: a row of tall windows along each side wall, high up
  for (const s of [-1, 1]) for (let i = 0; i < 7; i++) {
    const z = -D / 2 + 4 + i * 5.2;
    add(P, 'window', box(0.1, 2.4, 3.2, s * (W / 2 + 0.22), 6.6, z), 0xffffff, 0);
    add(P, 'frame', box(0.12, 0.08, 3.3, s * (W / 2 + 0.24), 6.6, z), 0xffffff, 0);
    add(P, 'frame', box(0.12, 2.5, 0.08, s * (W / 2 + 0.24), 6.6, z), 0xffffff, 0);
  }
  // the roof: a shallow segmental arch across the span, eaves over the walls, roofing joints
  const arch = [], n = 24, R = ((W / 2) ** 2 + (Hr - Hw) ** 2) / (2 * (Hr - Hw)), cy = Hr - R;
  for (let i = 0; i <= n; i++) { const x = -W / 2 - 0.6 + ((W + 1.2) * i) / n; arch.push([x, cy + Math.sqrt(Math.max(0, R * R - x * x))]); }
  const roofShape = [...arch, ...arch.slice().reverse().map(([x, y]) => [x, y - 0.35])];
  const rg = frontProfile(roofShape, -D / 2 - 0.8, D / 2 + 0.4);
  projectUV(rg, 8);
  P.add('roof', rg, { uv: true });
  // the front gable over the doors: a steel fascia girder carrying the door track
  addUV(P, 'paint', box(W + 1.0, 1.2, 0.6, 0, Hw + 0.55, -D / 2), 0xb0b0a8, 4);
  const gable = [...arch.map(([x, y]) => [x, y - 0.3]), [W / 2 + 0.6, Hw + 1.1], [-W / 2 - 0.6, Hw + 1.1]];
  addUV(P, 'render', frontProfile(gable, -D / 2 - 0.25, -D / 2 + 0.05), 0xd8d4c6, 6);
  addUV(P, 'render', frontProfile(gable, D / 2 - 0.25, D / 2 + 0.05), 0xd8d4c6, 6);
  // the sliding doors: twelve leaves of ribbed steel, glazed along the top, two of them run open
  const leaves = 12, lw = (W - 1.4) / leaves;
  for (let i = 0; i < leaves; i++) {
    const open = i === 5 || i === 6, x = -W / 2 + 0.7 + lw * (i + 0.5) + (open ? (i === 5 ? -lw : lw) : 0);
    const z = -D / 2 - 0.15 - (i % 2) * 0.25 - (open ? 0.5 : 0);
    addUV(P, 'paint', box(lw - 0.06, Hw - 0.2, 0.12, x, Hw / 2, z), i % 2 ? 0x9a9f94 : 0xa4a99c, 4);
    add(P, 'window', box(lw - 0.5, 1.2, 0.04, x, Hw - 1.1, z - 0.07), 0xffffff, 0);
    for (let k = 0; k < 4; k++) add(P, 'paint', box(lw - 0.1, 0.08, 0.06, x, 1.0 + k * 1.8, z - 0.08), 0x8c9086);
    add(P, 'black', box(lw - 0.06, 0.12, 0.2, x, 0.06, z), 0x303030, 0);
  }
  add(P, 'black', box(W, 0.08, 1.0, 0, 0.62, -D / 2 - 0.6), 0x333333, 0); // the door track in the apron
  // inside the open doors: the dark hall
  add(P, 'black', box(2 * lw, Hw - 0.3, 0.05, 0, Hw / 2, -D / 2 + 0.3), 0x0e0f0e, 0);
  // the workshop range along the back: two storeys, flat roof, windows
  const wz = D / 2 + 4;
  addUV(P, 'render', box(W - 4, 7.0, 8.0, 0, 3.5, wz), 0xdcd8ca, 6);
  addUV(P, 'roof', box(W - 3.6, 0.3, 8.4, 0, 7.15, wz), 0x9a9a92, 8);
  for (const y of [1.8, 5.0]) for (let i = 0; i < 14; i++) {
    const x = -W / 2 + 4 + i * 3.8;
    for (const s of [-1, 1]) if (s > 0 || i % 3 === 1) {
      add(P, 'window', box(1.6, 1.4, 0.1, x, y, wz + s * 4.02), 0xffffff, 0);
      add(P, 'frame', box(1.7, 0.08, 0.12, x, y, wz + s * 4.04), 0xffffff, 0);
    }
  }
  // the apron, and the trees of the wood round it
  addUV(P, 'concrete', box(W + 10, 0.12, 24, 0, 0.06, -D / 2 - 12), 0xc8c4ba, 6);
  for (let i = 0; i < 22; i++) {
    const a = rnd() * Math.PI * 2, r = 42 + rnd() * 18;
    const x = Math.cos(a) * r * 1.1, z = Math.sin(a) * r * 0.8 + 12;
    if (z < -D / 2 - 6 && Math.abs(x) < W / 2 + 6) continue;
    tree(P, x, z, 14 + rnd() * 8, rnd() < 0.7 ? 'pine' : 'birch', rnd);
  }
  P.build(root, { dirt: 0.1 });
  return root;
}

// ---------------------------------------------------------------- the flying control building

function tower44() {
  const root = new THREE.Group();
  const P = new Parts(mats()), rnd = mulberry32(13);
  const L = 25, Dp = 10, H1 = 3.4, H2 = 6.8;
  // the block: plinth, rendered walls, the dark roof edge
  addUV(P, 'concrete', box(L + 0.4, 0.6, Dp + 0.4, 0, 0.3, 0), 0x9a958a, 4);
  addUV(P, 'render', box(L, H2 - 0.6, Dp, 0, 0.6 + (H2 - 0.6) / 2, 0), 0xe8e4d6, 6);
  addUV(P, 'paint', box(L + 0.5, 0.3, Dp + 0.5, 0, H2 + 0.12, 0), 0x50524e);
  // windows: white frames with four panes, front and back on both floors
  const win = (x, y, face, w = 1.25, h = 1.35, dz = 0) => {
    const z = face * (Dp / 2 + 0.01) + dz;
    add(P, 'window', box(w, h, 0.06, x, y, z - face * 0.03), 0xffffff, 0);
    add(P, 'frame', box(w + 0.12, 0.1, 0.1, x, y + h / 2, z), 0xffffff, 0);
    add(P, 'frame', box(w + 0.12, 0.12, 0.16, x, y - h / 2, z + face * 0.04), 0xffffff, 0);
    add(P, 'frame', box(0.08, h, 0.1, x, y, z), 0xffffff, 0);
    add(P, 'frame', box(w, 0.06, 0.1, x, y + 0.05, z), 0xffffff, 0);
    for (const s of [-1, 1]) add(P, 'frame', box(0.08, h, 0.1, x + s * w / 2, y, z), 0xffffff, 0);
  };
  for (const face of [-1, 1]) for (const y of [1.85, 5.2]) for (let i = 0; i < 9; i++) {
    const x = -L / 2 + 1.6 + i * 2.72;
    if (face < 0 && y < 3 && Math.abs(x) < 3) continue; // the porch
    win(x, y, face);
  }
  for (const s of [-1, 1]) for (const y of [1.85, 5.2]) for (const z of [-2.2, 2.2]) { add(P, 'window', box(0.06, 1.35, 1.25, s * (L / 2 + 0.02), y, z), 0xffffff, 0); add(P, 'frame', box(0.1, 1.45, 0.1, s * (L / 2 + 0.03), y, z), 0xffffff, 0); }
  // downpipes and the gutter
  for (const x of [-L / 2 + 0.4, -3.4, 3.4, L / 2 - 0.4]) add(P, 'paint', yTube(0.6, H2, 0.05, 0.05, 6, x, -Dp / 2 - 0.08), 0x8a8c88);
  // the entrance porch with its balcony above (front, -Z), the steps
  addUV(P, 'render', box(5.6, H1 - 0.2, 1.8, 0, 0.6 + (H1 - 0.6) / 2, -Dp / 2 - 0.9), 0xe4e0d2, 6);
  addUV(P, 'paint', box(6.0, 0.2, 2.2, 0, H1 + 0.2, -Dp / 2 - 1.0), 0x50524e);
  add(P, 'black', box(1.6, 2.3, 0.1, 0, 1.75, -Dp / 2 - 1.81), 0x1a1c1a, 0);
  for (const x of [-2.0, 2.0]) win(x, 1.85, -1, 1.5, 1.4, -1.8);
  for (let k = 0; k < 3; k++) addUV(P, 'concrete', box(2.4, 0.16, 0.35, 0, 0.08 + k * 0.16, -Dp / 2 - 2.0 - (2 - k) * 0.35), 0xa8a49a, 2);
  for (let i = 0; i <= 12; i++) add(P, 'metal', yTube(H1 + 0.3, H1 + 1.25, 0.012, 0.012, 4, -2.9 + i * 0.48, -Dp / 2 - 2.05), 0x3a3c3a, 0);
  add(P, 'metal', box(5.9, 0.05, 0.05, 0, H1 + 1.27, -Dp / 2 - 2.05), 0x3a3c3a, 0);
  // the glazed control room on the roof: a base, the slanted glazing all round, its roof and the stair hut
  const cw = 6.5, cd = 4.2, cy0 = H2 + 0.27, ch = 2.4;
  addUV(P, 'render', box(cw, 0.7, cd, 0, cy0 + 0.35, -0.8), 0xe4e0d2, 6);
  for (const [w, d, x, z, ry] of [[cw, 0.08, 0, -0.8 - cd / 2, 0], [cw, 0.08, 0, -0.8 + cd / 2, 0], [cd, 0.08, -cw / 2, -0.8, Math.PI / 2], [cd, 0.08, cw / 2, -0.8, Math.PI / 2]]) {
    add(P, 'window', box(w, ch - 0.9, d, x, cy0 + 0.7 + (ch - 0.9) / 2, z, 0, ry, 0), 0xffffff, 0);
  }
  for (let i = 0; i <= 6; i++) for (const z of [-0.8 - cd / 2, -0.8 + cd / 2]) add(P, 'frame', box(0.08, ch - 0.9, 0.12, -cw / 2 + (i * cw) / 6, cy0 + 0.7 + (ch - 0.9) / 2, z), 0xffffff, 0);
  for (let i = 0; i <= 4; i++) for (const x of [-cw / 2, cw / 2]) add(P, 'frame', box(0.12, ch - 0.9, 0.08, x, cy0 + 0.7 + (ch - 0.9) / 2, -0.8 - cd / 2 + (i * cd) / 4), 0xffffff, 0);
  addUV(P, 'paint', box(cw + 0.8, 0.25, cd + 0.8, 0, cy0 + ch + 0.1, -0.8), 0x50524e);
  addUV(P, 'render', box(2.4, 2.3, 2.4, 0, cy0 + 1.15, 2.6), 0xe4e0d2, 6);
  // the roof's railing, an aerial mast and the windsock mast and the signal square in front
  for (let i = 0; i <= 10; i++) add(P, 'metal', yTube(H2 + 0.27, H2 + 1.2, 0.015, 0.015, 4, -L / 2 + 0.4 + (i * (L - 0.8)) / 10, -Dp / 2 + 0.3), 0x3a3c3a, 0);
  add(P, 'metal', box(L - 0.8, 0.05, 0.05, 0, H2 + 1.2, -Dp / 2 + 0.3), 0x3a3c3a, 0);
  add(P, 'metal', yTube(cy0 + ch + 0.2, cy0 + ch + 6, 0.04, 0.02, 6, 2.5, -0.8), 0x4a4c4a, 0);
  add(P, 'metal', yTube(0, 8, 0.07, 0.05, 8, 14, -16), 0x6a6c68, 0);
  const sock = new THREE.CylinderGeometry(0.22, 0.42, 2.6, 10, 1, true).rotateZ(Math.PI / 2 - 0.25).translate(15.2, 7.6, -16);
  add(P, 'white', sock, 0xd86030, 0);
  add(P, 'white', new THREE.CylinderGeometry(0.42, 0.42, 0.6, 10, 1, true).rotateZ(Math.PI / 2 - 0.25).translate(14.15, 7.85, -16), 0xe6e6e0, 0);
  // the signal square: a white-bordered square with the landing T
  addUV(P, 'gravel', box(9, 0.06, 9, -8, 0.03, -18), 0x9a9688, 4);
  for (const [w, d, x, z] of [[9, 0.5, -8, -22.25], [9, 0.5, -8, -13.75], [0.5, 9, -12.25, -18], [0.5, 9, -3.75, -18]]) add(P, 'white', box(w, 0.04, d, x, 0.07, z), 0xe8e8e2, 0);
  add(P, 'white', box(4.4, 0.04, 0.8, -8, 0.08, -20), 0xe8e8e2, 0);
  add(P, 'white', box(0.8, 0.04, 4.0, -8, 0.08, -18), 0xe8e8e2, 0);
  for (let i = 0; i < 5; i++) tree(P, 16 + rnd() * 6, 6 + i * 3.5, 12 + rnd() * 5, i % 2 ? 'birch' : 'pine', rnd);
  P.build(root, { dirt: 0.1 });
  return root;
}

// ---------------------------------------------------------------- fuel store

function fuel44() {
  const root = new THREE.Group();
  const P = new Parts(mats()), rnd = mulberry32(84);
  const W = 80, D = 50;
  addUV(P, 'gravel', box(W, 0.08, D, 0, 0.04, 0), 0xa29c8c, 6);
  // five buried horizontal tanks: an earth mound over each, the fill dome, manhole and vent standing out
  for (let i = 0; i < 5; i++) {
    const x = -28 + i * 14, z = 6;
    const path = []; for (let k = 0; k <= 10; k++) path.push([x, z - 7.5 + (k / 10) * 15]);
    bankAlong(P, path, 3.6, 8.5, 'turf', rnd);
    addUV(P, 'concrete', box(1.6, 0.6, 1.6, x, 3.6, z), 0xc0bcb2, 2);
    add(P, 'paint', yTube(3.9, 4.3, 0.45, 0.45, 12, x, z), 0x6a6e66);
    add(P, 'paint', yTube(3.6, 5.6, 0.07, 0.07, 6, x + 0.6, z + 2.5), 0x6a6e66);
    add(P, 'paint', box(0.3, 0.2, 0.3, x + 0.6, 5.7, z + 2.5), 0x6a6e66);
    // the pipe from the tank to the manifold along the front
    add(P, 'paint', rod(V(x, 0.3, z - 7.5), V(x, 0.3, -12), 0.08, 6), 0x707468);
  }
  // the manifold, the fill point gantry over the siding and the pump hut
  add(P, 'paint', xTube(-30, 30, 0.12, 0.12, 8, 0.4, -12), 0x707468);
  for (let x = -28; x <= 28; x += 4) addUV(P, 'concrete', box(0.4, 0.3, 0.9, x, 0.15, -12), 0xb0aca2, 2);
  for (const x of [-15, 0, 15]) {
    add(P, 'paint', yTube(0, 4.5, 0.12, 0.12, 8, x, -16), 0x5d6258);
    add(P, 'paint', box(0.25, 0.25, 4.0, x, 4.5, -18), 0x5d6258);
    add(P, 'black', rod(V(x, 4.4, -19.8), V(x, 2.6, -20.2), 0.06, 6), 0x2a2a2a, 0);
  }
  addUV(P, 'render', box(5, 3, 4, 33, 1.5, -10), 0xb08a6a, 3); // brick hut
  addUV(P, 'roof', box(5.6, 0.3, 4.6, 33, 3.15, -10), 0x7a5a48, 4);
  add(P, 'black', box(1.0, 2.0, 0.06, 33, 1.0, -12.03), 0x262626, 0);
  // the rail siding along the front: sleepers, rails, three tank wagons
  const rz = -20;
  for (let x = -40; x <= 40; x += 0.8) add(P, 'wood', box(0.25, 0.14, 2.6, x, 0.07, rz), 0x5a4a3a, 1);
  for (const s of [-0.72, 0.72]) add(P, 'metal', box(80, 0.13, 0.07, 0, 0.2, rz + s), 0x6a5a4a, 0);
  for (const x of [-14, 0, 14]) {
    add(P, 'black', box(10, 0.4, 2.3, x, 1.1, rz), 0x2a2a28, 0);
    for (const dx of [-3, 3]) for (const s of [-0.72, 0.72]) add(P, 'black', xTube(-0.06, 0.06, 0.45, 0.45, 12, 0.5, 0).applyMatrix4(xf(x + dx, 0, rz + s, 0, Math.PI / 2, 0)), 0x222222, 0);
    add(P, 'paint', xTube(x - 4.5, x + 4.5, 1.2, 1.2, 18, 2.5, rz), 0x404642);
    add(P, 'paint', yTube(3.6, 4.1, 0.45, 0.45, 12, x, rz), 0x404642);
    for (const s of [-1, 1]) add(P, 'black', yTube(0.9, 1.2, 0.18, 0.18, 8, x + s * 5.1, rz + 0.6));
  }
  // drums in stacks
  for (let i = 0; i < 30; i++) {
    const x = 20 + (i % 6) * 0.62, z = 14 + Math.floor(i / 6) % 3 * 0.62, y = Math.floor(i / 18) * 0.9;
    add(P, 'paint', yTube(y + 0.02, y + 0.88, 0.29, 0.29, 10, x, z), [0x5f6a50, 0x6d6450, 0x5a5a52][i % 3]);
  }
  // the fence: concrete posts, wire
  const fence = (x0, z0, x1, z1) => {
    const L = Math.hypot(x1 - x0, z1 - z0), n = Math.ceil(L / 3);
    for (let k = 0; k <= n; k++) { const t = k / n; addUV(P, 'concrete', box(0.14, 2.0, 0.14, x0 + (x1 - x0) * t, 1.0, z0 + (z1 - z0) * t), 0xbab6ac, 2); }
    for (const y of [0.5, 1.0, 1.5, 1.95]) add(P, 'metal', rod(V(x0, y, z0), V(x1, y, z1), 0.008, 3), 0x5a5a56, 0);
  };
  fence(-W / 2, -D / 2 + 1, W / 2, -D / 2 + 1); fence(-W / 2, D / 2, W / 2, D / 2);
  fence(-W / 2, -D / 2 + 1, -W / 2, D / 2); fence(W / 2, -D / 2 + 1, W / 2, D / 2);
  for (let i = 0; i < 8; i++) tree(P, -W / 2 - 5 - rnd() * 8, -20 + i * 6, 12 + rnd() * 6, 'pine', rnd);
  P.build(root, { dirt: 0.1 });
  return root;
}

// ---------------------------------------------------------------- command post

function command44() {
  const root = new THREE.Group();
  const P = new Parts(mats()), rnd = mulberry32(51);
  // the earth mound over the bunker: an oval dome, 26 x 20 m at the base, 5 m high
  const seg = 28, rings = 7, pos = [];
  const at = (i, k) => {
    const a = (i / seg) * Math.PI * 2, t = k / rings, r = 1 - t, n = k === 0 ? 0 : (rnd() - 0.5) * 0.2;
    return V(Math.cos(a) * (13 * Math.sqrt(r) + n), 5.0 * (1 - r * r) + n * 0.5 - 0.05, Math.sin(a) * (10 * Math.sqrt(r) + n));
  };
  const grid = []; for (let i = 0; i <= seg; i++) { grid.push([]); for (let k = 0; k <= rings; k++) grid[i].push(at(i % seg, k)); }
  for (let i = 0; i < seg; i++) for (let k = 0; k < rings; k++) { const a = grid[i][k], b = grid[i + 1][k], c = grid[i][k + 1], d = grid[i + 1][k + 1]; pos.push(a, c, b, b, c, d); }
  const mound = new THREE.BufferGeometry().setFromPoints(pos);
  mound.computeVertexNormals();
  const mp = mound.attributes.position, muv = new Float32Array(mp.count * 2);
  for (let i = 0; i < mp.count; i++) { muv[i * 2] = mp.getX(i) / 8; muv[i * 2 + 1] = mp.getZ(i) / 8; }
  mound.setAttribute('uv', new THREE.BufferAttribute(muv, 2));
  P.add('turf', mound, { uv: true });
  // two entrances, one at each end: a concrete portal with its door, and a dog-leg blast wall before it
  for (const s of [-1, 1]) {
    const x = s * 11.5;
    addUV(P, 'concrete', box(1.0, 3.2, 4.4, x, 1.6, 0), 0xc4c0b6, 4);
    add(P, 'paint', box(0.08, 2.1, 1.1, x + s * 0.52, 1.05, 0), 0x5a5e58);
    for (const dz of [-1.9, 1.9]) addUV(P, 'concrete', box(3.0, 2.8, 0.6, x + s * 1.8, 1.4, dz), 0xc4c0b6, 4);
    addUV(P, 'concrete', box(0.8, 2.6, 3.6, x + s * 4.0, 1.3, 1.0), 0xc4c0b6, 4); // the blast wall across, offset
  }
  // the vent shafts and the periscope cap on top, sandbags round the cap
  for (const [x, z] of [[-3, 2], [3.5, -1.5]]) { addUV(P, 'concrete', box(0.8, 1.2, 0.8, x, 5.0, z), 0xb8b4aa, 2); add(P, 'paint', box(0.9, 0.1, 0.9, x, 5.65, z), 0x5a5e58); }
  for (let i = 0; i < 10; i++) { const a = (i / 10) * Math.PI * 2; add(P, 'sand', sandbag([0.6, 0.16, 0.34], rnd).applyMatrix4(xf(Math.cos(a) * 1.2, 5.05, Math.sin(a) * 1.2, 0, -a, 0)), 0xffffff, 0.5); }
  add(P, 'metal', yTube(4.9, 6.0, 0.1, 0.1, 8, 0, 0), 0x404440, 0);
  // three radio masts round it with guys, the aerial wires between them, the telephone line out
  const masts = [[-17, -9], [16, -10], [2, 15]];
  for (const [x, z] of masts) {
    add(P, 'wood', yTube(0, 14, 0.14, 0.08, 7, x, z), 0xa89878, 1);
    for (let k = 0; k < 3; k++) { const a = (k / 3) * Math.PI * 2; add(P, 'metal', rod(V(x, 12, z), V(x + Math.cos(a) * 7, 0, z + Math.sin(a) * 7), 0.01, 3), 0x5a5a56, 0); }
  }
  for (let k = 0; k < 3; k++) { const [x0, z0] = masts[k], [x1, z1] = masts[(k + 1) % 3]; add(P, 'metal', rod(V(x0, 13.6, z0), V(x1, 13.6, z1), 0.012, 3), 0x3a3a38, 0); }
  for (const [x0, z0] of masts) add(P, 'metal', rod(V(x0, 13.4, z0), V(0, 6.0, 0), 0.01, 3), 0x3a3a38, 0);
  for (let i = 0; i < 6; i++) {
    const z = -14 - i * 30;
    add(P, 'wood', yTube(0, 6.5, 0.1, 0.08, 6, 3, z), 0x8a7a60, 1);
    add(P, 'wood', box(1.4, 0.1, 0.1, 3, 6.0, z), 0x8a7a60, 1);
    if (i) add(P, 'metal', rod(V(3.6, 6.05, z), V(3.6, 6.05, z + 30), 0.008, 3), 0x3a3a38, 0);
  }
  // trench and sandbagged positions near the entrances
  for (let i = 0; i < 9; i++) add(P, 'sand', sandbag([0.6, 0.16, 0.34], rnd).applyMatrix4(xf(-17 + (i % 3) * 0.55, 0.08 + Math.floor(i / 3) * 0.15, 4, 0, (rnd() - 0.5) * 0.1, 0)), 0xffffff, 0.5);
  for (let i = 0; i < 4; i++) tree(P, 18 + rnd() * 6, 6 + i * 4, 11 + rnd() * 5, i % 2 ? 'birch' : 'pine', rnd);
  P.build(root, { dirt: 0.15 });
  return root;
}

export const ASSETS44 = { revetment, hangar, tower44, fuel44, command44 };
