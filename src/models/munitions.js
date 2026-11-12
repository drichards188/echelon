import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { buildInterceptor } from './threats.js';
import { containerOf, calibreOf, shellName } from '../parade.js';

// The munitions a unit shows on parade (the menu's hangar, ui/hangar.js; what is shown comes from parade.js
// displayOf): each missile type laid on two steel stands with its container beside it on dunnage (a canister, a
// square container, or for a round that rides bare on its rails, the missile alone), the modern guns' rounds as a
// belt on a trestle table beside their ammunition boxes, the WW2 guns' fixed rounds standing in a rack and lying
// in wicker baskets, the 3.7 cm's clips and the 2 cm's magazines on tables. A placard names each.
//
// buildDisplay(entry) -> { group, width, depth, top, label }: the group laid out along X (the missiles' noses to
// -X), its front to -Z, centred on its origin on the ground; width along X, depth along Z, top its highest point.
// Every piece is merged into one mesh per material. The missile models are the game's own (models/threats.js);
// the WW2 rounds follow the profiles of the crews' props (eras/ww2/models/figure44.js round88, round128, clip37,
// mag20). Sizes are the models' and the references'; nothing here is a game value.

const mats = new Map();
const mat = (name, color, roughness = 0.7, metalness = 0, extra = {}) => {
  if (!mats.has(name)) mats.set(name, new THREE.MeshStandardMaterial({ color, roughness, metalness, ...extra }));
  return mats.get(name);
};
const M = {
  steel: () => mat('steel', 0x464a4c, 0.55, 0.6),
  timber: () => mat('timber', 0x7a6044, 0.9),
  board: () => mat('board', 0x8c7556, 0.85),
  olive: () => mat('olive', 0x4c5538, 0.65, 0.1),
  oliveDark: () => mat('oliveDark', 0x2e3424, 0.8, 0.05),
  tarp: () => mat('tarp', 0x55573f, 1),
  brass: () => mat('brass', 0xb08a48, 0.32, 0.85),
  shellModern: () => mat('shellModern', 0x3f4636, 0.55, 0.3),
  shellWW2: () => mat('shellWW2', 0xb39a45, 0.55, 0.15),
  fuze: () => mat('fuze', 0x9c9a90, 0.4, 0.7),
  can: () => mat('can', 0x4f5a3a, 0.6, 0.25),
  crate: () => mat('crate', 0x6d5a3c, 0.85),
  wicker: () => mat('wicker', 0x9a7a4c, 0.95),
  clip: () => mat('clip', 0x55595a, 0.5, 0.6),
  mag: () => mat('mag', 0x4d524f, 0.55, 0.45),
  red: () => mat('red', 0x8a2a20, 0.6),
};

// geometry collected per material, merged into one mesh each
class Bag {
  constructor() { this.by = new Map(); }
  add(m, g, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
    g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(1, 1, 1)));
    if (!this.by.has(m)) this.by.set(m, []);
    this.by.get(m).push(g);
    return g;
  }
  build(parent) {
    for (const [m, list] of this.by) {
      const clean = list.map((g) => {
        for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
        if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
        return g.index ? g.toNonIndexed() : g;
      });
      const mesh = new THREE.Mesh(clean.length > 1 ? mergeGeometries(clean, false) : clean[0], m);
      mesh.castShadow = mesh.receiveShadow = true;
      parent.add(mesh);
    }
    this.by.clear();
  }
}
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
// a cylinder along X
const xcyl = (r0, r1, len, seg = 16) => new THREE.CylinderGeometry(r1, r0, len, seg).rotateZ(-Math.PI / 2);
const ycyl = (r0, r1, len, seg = 16) => new THREE.CylinderGeometry(r1, r0, len, seg);
// a body of revolution from [distance from the base, radius] pairs, standing on its base (+Y)
const latheY = (prof, seg = 14) => new THREE.LatheGeometry(prof.map(([d, r]) => new THREE.Vector2(Math.max(r, 0.0005), d)), seg);

// ---------------------------------------------------------------- the placard
// A board on two posts naming the piece, its face to the front (-Z), stencil-white on dark green
const placards = new Map();
function placard(bag, group, text, x, z) {
  if (!placards.has(text)) {
    const cv = document.createElement('canvas');
    cv.width = 512;
    cv.height = 160;
    const g = cv.getContext('2d');
    g.fillStyle = '#2c3326';
    g.fillRect(0, 0, 512, 160);
    g.strokeStyle = '#d9d6c4';
    g.lineWidth = 6;
    g.strokeRect(10, 10, 492, 140);
    g.fillStyle = '#e6e2d0';
    g.font = 'bold 76px ui-monospace, Menlo, Consolas, monospace';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, 256, 84, 470);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    placards.set(text, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8 }));
  }
  const W = 0.62, H = 0.2, y = 0.62;
  for (const s of [-1, 1]) bag.add(M.timber(), box(0.04, y, 0.04), x + s * W * 0.38, y / 2, z + 0.02);
  bag.add(M.timber(), box(W + 0.04, H + 0.04, 0.03), x, y + 0.02, z + 0.035, 0.35);
  // (a plane faces +Z: turned round to face the front, and tilted back with its board)
  const face = new THREE.Mesh(new THREE.PlaneGeometry(W, H), placards.get(text));
  face.rotation.set(0.35, Math.PI, 0);
  face.position.set(x, y + 0.02, z + 0.015);
  face.castShadow = false;
  face.receiveShadow = true;
  group.add(face);
}

// ---------------------------------------------------------------- missiles
// the interceptor model's parts as one group, its nose to -X, and its size (length, radius of what sticks out)
function missileModel(id) {
  const m = buildInterceptor(id);
  if (!m) return null;
  const g = new THREE.Group(), bb = new THREE.Box3(), b = new THREE.Box3();
  for (const p of m.parts) {
    const mesh = new THREE.Mesh(p.geometry, p.material);
    mesh.castShadow = mesh.receiveShadow = true;
    g.add(mesh);
    p.geometry.boundingBox ?? p.geometry.computeBoundingBox();
    bb.union(b.copy(p.geometry.boundingBox));
  }
  // model space: nose -Z; on display along X, nose -X
  g.rotation.y = Math.PI / 2;
  const L = bb.max.z - bb.min.z, R = Math.max(-bb.min.x, bb.max.x, -bb.min.y, bb.max.y), cz = (bb.min.z + bb.max.z) / 2, cy = (bb.min.y + bb.max.y) / 2;
  return { group: g, L, R, cz, cy };
}

// a steel stand under a body of radius r at height y (its axis): an A-frame each side and a saddle
function stand(bag, x, y, z, r) {
  const top = y - r * 0.92, w = r * 2.2 + 0.2;
  for (const s of [-1, 1]) {
    const leg = box(0.06, top / Math.cos(0.22), 0.06);
    bag.add(M.steel(), leg, x, top / 2, z + s * w * 0.28, s * 0.22);
  }
  bag.add(M.steel(), box(0.08, 0.06, w), x, top / 2 * 0.5, z);
  // the saddle: two pads angled under the body
  for (const s of [-1, 1]) bag.add(M.steel(), box(0.14, 0.05, r * 0.9 + 0.05), x, top + r * 0.18, z + s * r * 0.42, -s * 0.5);
  bag.add(M.steel(), box(0.14, 0.05, w * 0.7), x, top - 0.01, z);
}
// timber dunnage: baulks across under something of width w (along z) at x
function dunnage(bag, x, z, w, h = 0.14) {
  bag.add(M.timber(), box(0.16, h, w + 0.2), x, h / 2, z);
}

function missileDisplay(id) {
  const one = missileModel(id);
  if (!one) return null;
  const { L, R } = one, group = new THREE.Group(), bag = new Bag();
  // the missile on two stands, its fins clear of the ground
  const y = Math.max(R + 0.12, 0.55 + Math.min(R, 0.4)), zM = -0.2;
  // (turned, the model's z runs along x: its middle to x = 0)
  one.group.position.set(-one.cz, y - one.cy, zM);
  group.add(one.group);
  const body = Math.min(R, Math.max(0.09, R * 0.45));
  for (const sx of [-0.3, 0.3]) stand(bag, sx * L, y, zM, body);
  // its container beside it, behind (+z), on dunnage
  const shape = containerOf(id);
  let depth = R * 2 + 0.6;
  if (shape) {
    const cr = R * 1.06 + 0.05, cl = L + 0.45, zc = zM + R + cr + 0.55, yc = 0.16 + cr;
    for (const sx of [-0.33, 0.33]) dunnage(bag, sx * cl, zc, cr * 2);
    if (shape === 'tube') {
      bag.add(M.olive(), xcyl(cr, cr, cl, 24), 0, yc, zc);
      // stiffening bands and the end flanges
      const n = Math.max(2, Math.round(cl / 1.3));
      for (let i = 0; i <= n; i++) bag.add(M.oliveDark(), xcyl(cr * 1.045, cr * 1.045, i === 0 || i === n ? 0.08 : 0.05, 24), -cl / 2 + (cl * i) / n, yc, zc);
      // the front cover off, leaning against its end: the mouth dark inside
      bag.add(M.oliveDark(), new THREE.CircleGeometry(cr * 0.94, 24).rotateY(-Math.PI / 2), -cl / 2 - 0.002, yc, zc);
      bag.add(M.olive(), new THREE.CylinderGeometry(cr * 1.02, cr * 1.02, 0.05, 24), -cl / 2 - 0.35, cr * 0.98, zc - cr * 0.2, 0, 0, 1.35);
      // lifting lugs on top
      for (const sx of [-0.25, 0.25]) bag.add(M.steel(), box(0.08, 0.08, 0.05), sx * cl, yc + cr + 0.03, zc);
    } else {
      const s = cr * 1.9;
      bag.add(M.olive(), box(cl, s, s), 0, 0.16 + s / 2, zc);
      const n = Math.max(2, Math.round(cl / 0.9));
      for (let i = 0; i <= n; i++) bag.add(M.oliveDark(), box(0.06, s + 0.03, s + 0.03), -cl / 2 + (cl * i) / n, 0.16 + s / 2, zc);
      bag.add(M.oliveDark(), box(0.01, s * 0.86, s * 0.86), -cl / 2 - 0.02, 0.16 + s / 2, zc);
      for (const sx of [-0.3, 0.3]) bag.add(M.steel(), box(0.1, 0.06, 0.06), sx * cl, 0.16 + s + 0.04, zc);
    }
    depth = zc + cr - (zM - R) + 0.2;
  }
  // the placard at the nose
  placard(bag, group, id, -L / 2 - 0.15, zM - R - 0.55);
  bag.build(group);
  const z0 = zM - R - 0.7, z1 = z0 + depth + 0.7;
  // centre on z
  for (const c of group.children) c.position.z -= (z0 + z1) / 2;
  return { group, width: L + 0.9, depth: z1 - z0, top: Math.max(y + R, 0.4 + R * 2.2), label: id };
}

// ---------------------------------------------------------------- rounds
// a fixed round standing on its case's base: profile [distance from the base, radius] by parts
const R88 = { caseP: [[0, 0], [0, 0.056], [0.01, 0.056], [0.012, 0.05], [0.49, 0.049], [0.525, 0.045], [0.57, 0.045]],
  shellP: [[0.57, 0.0438], [0.75, 0.0438], [0.79, 0.041], [0.83, 0.033], [0.872, 0.016]], fuzeP: [[0.872, 0.016], [0.9, 0.013], [0.926, 0.006], [0.932, 0]] };
const R128 = { caseP: [[0, 0], [0, 0.083], [0.012, 0.083], [0.015, 0.075], [0.86, 0.072], [0.9, 0.067], [0.95, 0.067]],
  shellP: [[0.95, 0.064], [1.2, 0.064], [1.26, 0.06], [1.33, 0.046], [1.42, 0.022]], fuzeP: [[1.42, 0.022], [1.46, 0.016], [1.482, 0.008], [1.488, 0]] };
const ROUND = { '88mm': R88, '128mm': R128 };
// any other calibre: the 8.8 cm's shape scaled (a hand-loaded gun) or a small-calibre round's (belts, clips, magazines)
const scaled = (P, k) => Object.fromEntries(Object.entries(P).map(([n, prof]) => [n, prof.map(([d, r]) => [d * k, r * k])]));
function roundProfile(shell) {
  if (ROUND[shell]) return ROUND[shell];
  const c = calibreOf(shell);
  if (c >= 0.075) return scaled(R88, c / 0.088);
  // small calibre: case about 5.5 calibres long, the round about 9.6 (30 mm: 165 and 290 mm)
  const L = c * 9.6, cl = c * 5.5, cr = c * 0.72, pr = c * 0.5;
  return { caseP: [[0, 0], [0, cr * 1.08], [0.006, cr * 1.08], [0.009, cr], [cl * 0.86, cr * 0.97], [cl * 0.94, pr * 1.04], [cl, pr * 1.04]],
    shellP: [[cl, pr], [cl + (L - cl) * 0.45, pr], [cl + (L - cl) * 0.8, pr * 0.62], [L * 0.985, pr * 0.2]], fuzeP: [[L * 0.985, pr * 0.2], [L, 0]] };
}
const lengthOf = (P) => P.fuzeP[P.fuzeP.length - 1][0];
const radiusOf = (P) => Math.max(...P.caseP.map(([, r]) => r));
// one round into the bag: standing (its base at x, y, z) or lying along `dir` (rx, ry, rz rotations)
function addRound(bag, P, ww2, x, y, z, rx = 0, ry = 0, rz = 0) {
  const seg = radiusOf(P) > 0.03 ? 14 : 8;
  bag.add(M.brass(), latheY(P.caseP, seg), x, y, z, rx, ry, rz);
  bag.add(ww2 ? M.shellWW2() : M.shellModern(), latheY(P.shellP, seg), x, y, z, rx, ry, rz);
  bag.add(M.fuze(), latheY(P.fuzeP, seg), x, y, z, rx, ry, rz);
}
// a timber trestle table, its top at h, w along X by d
function table(bag, x, z, w, d, h = 0.82) {
  bag.add(M.board(), box(w, 0.05, d), x, h - 0.025, z);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) bag.add(M.timber(), box(0.06, h - 0.05, 0.06), x + sx * (w / 2 - 0.12), (h - 0.05) / 2, z + sz * (d / 2 - 0.1));
  bag.add(M.timber(), box(w - 0.2, 0.05, 0.04), x, 0.22, z);
}

// the modern guns' rounds: a belt laid across a table (the rounds' noses to the front), three standing, and the
// ammunition boxes stacked beside it, one open
function beltDisplay(shell) {
  const P = roundProfile(shell), L = lengthOf(P), r = radiusOf(P), group = new THREE.Group(), bag = new Bag();
  const tw = Math.max(1.6, L * 5), td = Math.max(0.8, L * 2.2), h = 0.82;
  table(bag, 0, 0, tw, td);
  // the belt: rounds side by side along x, noses to -z, a link round each
  const pitch = r * 2.5, n = Math.floor((tw - 0.3) / pitch);
  for (let i = 0; i < n; i++) {
    const x = -tw / 2 + 0.15 + pitch * (i + 0.5);
    addRound(bag, P, false, x, h + r, td * 0.1 + L / 2, -Math.PI / 2);
    bag.add(M.steel(), box(pitch * 0.7, r * 0.5, L * 0.18), x, h + r * 0.5, td * 0.1 + L * 0.28);
  }
  for (let i = 0; i < 3; i++) addRound(bag, P, false, -tw / 2 + 0.25 + i * r * 3, h, -td / 2 + 0.15);
  // the ammunition boxes: green steel, a carrying handle, the lid of the top one open
  const bw = Math.max(0.42, L * 1.7), bh = Math.max(0.26, L * 0.95), bd = Math.max(0.28, L * 1.05), bx = tw / 2 + 0.25 + bw / 2;
  for (let k = 0; k < 3; k++) {
    const yy = bh / 2 + (k === 2 ? bh : 0), xx = bx + (k === 1 ? bw + 0.08 : 0) + (k === 2 ? bw * 0.5 : 0);
    bag.add(M.can(), box(bw, bh, bd), xx, yy, 0);
    bag.add(M.steel(), box(bw * 0.4, 0.03, 0.05), xx, yy + bh / 2 + 0.02, 0);
    if (k === 2) bag.add(M.can(), box(bw, 0.03, bd), xx, yy + bh / 2 + bd * 0.45, bd * 0.48, -1.35);
  }
  placard(bag, group, shellName(shell), -tw / 2 + 0.3, -td / 2 - 0.5);
  bag.build(group);
  const width = tw + 0.35 + bw * 2.1;
  for (const c of group.children) c.position.x -= (width / 2 - tw / 2);
  return { group, width, depth: td + 1, top: h + 0.2, label: shellName(shell) };
}

// the heavy guns' fixed rounds: three standing in a rack, one lying on a cradle in front, wicker baskets of three
// stacked beside, one open on top
function handDisplay(shell) {
  const P = roundProfile(shell), L = lengthOf(P), r = radiusOf(P), group = new THREE.Group(), bag = new Bag();
  const gap = r * 3.2, rackW = gap * 3 + 0.2;
  // the rack: a low board with three rounds standing on it, a rail round their bodies
  bag.add(M.board(), box(rackW, 0.06, r * 3), 0, 0.03, 0.2);
  for (let i = 0; i < 3; i++) addRound(bag, P, true, (i - 1) * gap, 0.06, 0.2);
  for (const s of [-1, 1]) bag.add(M.timber(), box(0.05, L * 0.62, 0.05), s * rackW / 2, L * 0.31, 0.2);
  bag.add(M.timber(), box(rackW, 0.04, 0.04), 0, L * 0.6, 0.2 - r * 1.2);
  // one lying on a cradle in front, nose to -x
  const zc = 0.2 - r * 2 - 0.45;
  for (const sx of [-0.3, 0.3]) bag.add(M.timber(), box(0.1, 0.16, r * 2.6), sx * L, 0.08, zc);
  addRound(bag, P, true, L / 2, 0.16 + r, zc, 0, 0, Math.PI / 2);
  // the baskets (the 8.8 cm's wicker basket holds three rounds: about 0.37 by 0.14 by 0.98 m), stacked two high
  const bl = L + 0.06, bw = r * 7.4, bh = r * 2.8, bx = rackW / 2 + 0.4 + bl / 2;
  for (let k = 0; k < 5; k++) {
    const lay = k < 3 ? 0 : 1, i = lay ? k - 3 : k;
    const x = bx, z = -bw * 1.1 + i * (bw + 0.05) + lay * bw * 0.5, y = bh / 2 + lay * bh;
    bag.add(M.wicker(), box(bl, bh, bw), x, y, z, 0, (k % 2) * 0.03, 0);
    for (const s of [-1, 1]) bag.add(M.steel(), box(0.04, bh + 0.01, bw + 0.01), x + s * bl * 0.35, y, z);
  }
  // the top basket open: its three rounds in it, the lid thrown back
  const ox = bx, oz = -bw * 1.1 + 1.5 * (bw + 0.05), oy = bh * 2;
  for (let i = 0; i < 3; i++) addRound(bag, P, true, ox + L / 2, oy + r * 0.2 + r, oz - bw * 0.3 + i * r * 2.2 + 0.02, 0, 0, Math.PI / 2);
  bag.add(M.wicker(), box(bl, 0.03, bw), ox, oy + bw * 0.45, oz + bw * 0.5 + 0.02, -1.35);
  placard(bag, group, shellName(shell), -rackW / 2 - 0.2, zc - 0.55);
  bag.build(group);
  const width = rackW + 0.4 + bl + 0.4;
  for (const c of group.children) c.position.x -= width / 2 - rackW / 2 - 0.2;
  return { group, width, depth: bw * 3.3 + 1.2, top: Math.max(L * 0.95, bh * 2 + bw * 0.6), label: shellName(shell) };
}

// the 3.7 cm's clips of eight laid flat on a table (the plate under them, noses to the front), the boxes beside
function clipDisplay(shell) {
  const P = roundProfile(shell), L = lengthOf(P), r = radiusOf(P), group = new THREE.Group(), bag = new Bag();
  const pitch = r * 2.05, cw = pitch * 8, tw = cw * 2 + 0.5, td = L * 2 + 0.45, h = 0.82;
  table(bag, 0, 0, tw, td);
  for (let c = 0; c < 4; c++) {
    const cx = (c % 2 ? 1 : -1) * (cw / 2 + 0.06), cz = c < 2 ? -L / 2 - 0.05 : L / 2 + 0.1, top = h + (c === 3 ? r * 2 + 0.01 : 0);
    bag.add(M.clip(), box(cw, 0.006, L * 0.82), cx, top + 0.003, cz);
    bag.add(M.clip(), box(cw, 0.03, 0.012), cx, top + 0.015, cz + L / 2 - 0.01);
    for (let i = 0; i < 8; i++) addRound(bag, P, true, cx + (i - 3.5) * pitch, top + r + 0.006, cz + L / 2, -Math.PI / 2);
  }
  // the ammunition boxes, wooden, stacked
  const bw = cw + 0.12, bh = 0.22, bd = L + 0.12, bx = tw / 2 + 0.3 + bw / 2;
  for (let k = 0; k < 3; k++) bag.add(M.crate(), box(bw, bh, bd), bx, bh / 2 + (k === 2 ? bh : 0), (k === 1 ? 1 : k === 2 ? 0.5 : 0) * (bd + 0.05) - bd * 0.5);
  placard(bag, group, shellName(shell), -tw / 2 + 0.3, -td / 2 - 0.5);
  bag.build(group);
  const width = tw + 0.3 + bw;
  for (const c of group.children) c.position.x -= width / 2 - tw / 2;
  return { group, width, depth: td + 1, top: h + 0.3, label: shellName(shell) };
}

// the 2 cm's magazines (a flat box 0.31 by 0.12 by 0.085 m) in a row on a table and a stack, rounds beside them
function magDisplay(shell) {
  const P = roundProfile(shell), L = lengthOf(P), r = radiusOf(P), group = new THREE.Group(), bag = new Bag();
  const tw = 1.7, td = 0.8, h = 0.82;
  table(bag, 0, 0, tw, td);
  for (let i = 0; i < 6; i++) {
    const x = -tw / 2 + 0.2 + i * 0.13, z = -0.1;
    bag.add(M.mag(), box(0.085, 0.12, 0.31), x, h + 0.06, z);
    bag.add(M.steel(), box(0.087, 0.035, 0.04), x, h + 0.13, z - 0.17);
  }
  for (let k = 0; k < 4; k++) bag.add(M.mag(), box(0.31, 0.085, 0.12), tw / 2 - 0.35, h + 0.043 + k * 0.086, -0.05, 0, k * 0.05, 0);
  for (let i = 0; i < 6; i++) addRound(bag, P, true, -0.05 + i * r * 3, h, 0.25);
  const bw = 0.55, bh = 0.3, bd = 0.32, bx = tw / 2 + 0.3 + bw / 2;
  for (let k = 0; k < 3; k++) bag.add(M.crate(), box(bw, bh, bd), bx, bh / 2 + (k === 2 ? bh : 0), (k === 1 ? 1 : k === 2 ? 0.5 : 0) * (bd + 0.05) - bd * 0.5);
  placard(bag, group, shellName(shell), -tw / 2 + 0.3, -td / 2 - 0.5);
  bag.build(group);
  const width = tw + 0.3 + bw;
  for (const c of group.children) c.position.x -= width / 2 - tw / 2;
  return { group, width, depth: td + 1, top: h + 0.4, label: shellName(shell) };
}

const SHOWS = { belt: beltDisplay, hand: handDisplay, clip: clipDisplay, mag: magDisplay };
// One display entry (parade.js displayOf): { missile } or { shell, feed }; null if there is nothing to show.
export function buildDisplay(entry) {
  try {
    if (entry.missile) return missileDisplay(entry.missile);
    if (entry.shell) return (SHOWS[entry.feed] ?? beltDisplay)(entry.shell);
  } catch (e) {
    console.warn('munitions:', entry, e.message);
  }
  return null;
}
