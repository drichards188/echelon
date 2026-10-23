import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { patchMaterial } from '../../../shaderlib.js';

// The WW2 German flak crewman (refs/ww2/markings section 5, the gun sheets' crew sections and photos): the
// figure's skeleton, its geometry and the one material every crewman shares. crew44.js places the men at the
// guns and poses them (pose44.js); this file only builds what they are made of.
//
// One geometry holds every outfit at once: each piece carries a part bit (PART) and a man's mask switches
// the pieces he wears on (the others collapse to a point in the vertex shader, so they cost vertices but no
// pixels). Colours come from per-man tints (TINT channels: tunic, trousers, coat, headgear, skin, hair,
// hands) multiplying near-white vertex colours, roughness and metalness from a per-vertex surface class. So
// every man of every outfit is drawn by ONE InstancedMesh per level of detail: the skinning runs on the GPU
// from a float texture with one row per man (the bones, his tints, his mask and his build), written by
// crew44.js. Two levels: 'near' (the third-person camera's distance) and 'far' (fewer segments, no faces).
//
// What a man can wear (no insignia of any kind on anything: no eagles, cockades, collar patches, badges,
// cuff titles, armbands or helmet decals; plain buttons and a plain buckle):
//   body       blouse (the short fly-front Fliegerbluse with its belt), coat (the double-breasted
//              greatcoat to mid-calf, belted), parka (the padded winter parka to mid-thigh, hood down)
//   legs       straight trousers with jackboots, or ankle boots and gaiters with the trousers bloused over
//   headgear   helmet (M40/M42 steel helmet, flared skirt, chin strap), cap43 (the peaked M43 field cap),
//              sidecap (the Fliegermuetze), or none (cropped hair)
//   gear       headset (telephone earphones, layers and operators), gasmask (the fluted canister on the
//              back), holster (NCOs), scarf (the helpers' white towel), binoChest (binoculars hanging)
//   held       one prop on the 'prop' bone (round88, round128, clip37, mag20, rangefinder, bino, handset) and
//              a second 20 mm magazine in the left hand (mag20L)
//
// Skeleton (metres, a 1.78 m man in the bind pose, arms hanging; ground y = 0, facing -Z, right +X): the
// joints of models/v/crew.js (the same proportions and bone lengths, so its IK numbers carry over) plus a
// free 'prop' bone whose transform is the held prop's own. The bind rotations are identity, so a bone's
// skinning matrix is world x scale x T(joint now) R(bone) T(-joint in the bind pose).
//
// Row layout of the data texture (RGBA32F, ROW_W texels per man): texels 0..53 the 18 bones' 3x4 matrices
// (three rows each), 54..61 the tints (linear RGB), 62 the mask (x: bits 0..23, y: bits 24..47), 63 the
// build (x: girth, the lateral scale of body and limbs about their bones; y: head scale; z: mud; w: seed).

export const BONES = ['hips', 'spine', 'chest', 'neck', 'head', 'upperArmL', 'forearmL', 'handL', 'upperArmR', 'forearmR', 'handR',
  'thighL', 'shinL', 'footL', 'thighR', 'shinR', 'footR', 'prop'];
export const NB = BONES.length;
export const BI = Object.fromEntries(BONES.map((b, i) => [b, i]));
export const PARENT = {
  hips: null, spine: 'hips', chest: 'spine', neck: 'chest', head: 'neck',
  upperArmL: 'chest', forearmL: 'upperArmL', handL: 'forearmL', upperArmR: 'chest', forearmR: 'upperArmR', handR: 'forearmR',
  thighL: 'hips', shinL: 'thighL', footL: 'shinL', thighR: 'hips', shinR: 'thighR', footR: 'shinR', prop: null,
};
export const SK = { L_TH: 0.425, L_SH: 0.415, L_UA: 0.295, L_FA: 0.26, SH_X: 0.185, SH_Y: 1.445, SH_Z: 0.012, HIP_X: 0.092, HIP_Y: 0.93, ANKLE_Y: 0.09, H: 1.78 };
const { L_TH, L_UA, L_FA, SH_X, SH_Y, SH_Z, HIP_X, HIP_Y, ANKLE_Y } = SK;
// joint centres in the bind pose (index 0 left, 1 right: SIDE -1 / +1)
export const JOINT = {
  hips: [0, 0.98, 0], spine: [0, 1.08, 0], chest: [0, 1.27, 0], neck: [0, 1.495, 0.012], head: [0, 1.6, 0.005],
  upperArmL: [-SH_X, SH_Y, SH_Z], forearmL: [-SH_X, SH_Y - L_UA, SH_Z], handL: [-SH_X, SH_Y - L_UA - L_FA, SH_Z],
  upperArmR: [SH_X, SH_Y, SH_Z], forearmR: [SH_X, SH_Y - L_UA, SH_Z], handR: [SH_X, SH_Y - L_UA - L_FA, SH_Z],
  thighL: [-HIP_X, HIP_Y, 0], shinL: [-HIP_X, HIP_Y - L_TH, 0], footL: [-HIP_X, ANKLE_Y, 0],
  thighR: [HIP_X, HIP_Y, 0], shinR: [HIP_X, HIP_Y - L_TH, 0], footR: [HIP_X, ANKLE_Y, 0], prop: [0, 0, 0],
};
// how the build scales a bone's geometry in the shader: 0 not at all, 1 girth (x and z about the joint), 2 head
const SCALE_MODE = { hips: 1, spine: 1, chest: 1, neck: 1, head: 2, upperArmL: 1, forearmL: 1, upperArmR: 1, forearmR: 1, thighL: 1, shinL: 1, thighR: 1, shinR: 1 };
export const SIDE = [-1, 1];
const SFX = ['L', 'R'];
// the grip point in hand space: inside the curled fingers
export const GRIP = SIDE.map((s) => new THREE.Vector3(-0.032 * s, -0.092, 0));

export const PART = {
  blouse: 0, coat: 1, parka: 2, jackboots: 3, ankle: 4, helmet: 5, cap43: 6, sidecap: 7, headset: 8, gasmask: 9, holster: 10,
  scarf: 11, binoChest: 12, round88: 13, clip37: 14, mag20: 15, mag20L: 16, rangefinder: 17, bino: 18, handset: 19, belt: 20,
  round128: 21,
};
export const PROPS = ['round88', 'round128', 'clip37', 'mag20', 'rangefinder', 'bino', 'handset'];
export const TINT = { none: 0, tunic: 1, trousers: 2, coat: 3, headgear: 4, skin: 5, hair: 6, hands: 7 };
// surface classes: roughness, metalness (the shader's table)
const SURF = { cloth: 0, leather: 1, skin: 2, helmet: 3, metal: 4, brass: 5, paint: 6, bakelite: 7, glass: 8, wool: 9 };
const SURF_RM = [[0.93, 0], [0.55, 0], [0.62, 0], [0.68, 0.12], [0.42, 0.7], [0.34, 0.85], [0.6, 0.05], [0.38, 0], [0.08, 0.3], [0.97, 0]];

export const ROW_W = 64;
export const T_TINT = 54, T_MASK = 62, T_BUILD = 63;

const V3 = THREE.Vector3;
const TAU = Math.PI * 2;
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const lerp = (a, b, t) => a + (b - a) * t;
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

// ---------------------------------------------------------------- geometry primitives (no UVs)

const _m4 = new THREE.Matrix4(), _q4 = new THREE.Quaternion(), _e4 = new THREE.Euler(), _one = new V3(1, 1, 1), _p4 = new V3();
function xform(g, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  return g.applyMatrix4(_m4.compose(_p4.set(x, y, z), _q4.setFromEuler(_e4.set(rx, ry, rz)), _one));
}
const box = (w, h, d, x, y, z, rx = 0, ry = 0, rz = 0) => xform(new THREE.BoxGeometry(w, h, d), x, y, z, rx, ry, rz);
function ellipsoid(rx, ry, rz, x, y, z, w = 10, h = 7) {
  return new THREE.SphereGeometry(1, w, h).scale(rx, ry, rz).translate(x, y, z);
}
// Surface of revolution about +Y through (x, y, z) from [dy, r] pairs listed bottom to top.
function lathe(prof, seg, x, y, z, sx = 1, sz = 1) {
  const g = new THREE.LatheGeometry(prof.map(([dy, r]) => new THREE.Vector2(Math.max(r, 1e-4), dy)), seg);
  return g.scale(sx, 1, sz).translate(x, y, z);
}
// A cylinder from a to b (radius r0 at a, r1 at b).
function tube(a, b, r0, r1 = r0, seg = 8, open = false) {
  const d = new V3().subVectors(b, a), len = d.length();
  const g = new THREE.CylinderGeometry(r1, r0, len, seg, 1, open);
  const q = new THREE.Quaternion().setFromUnitVectors(new V3(0, 1, 0), d.normalize());
  return g.applyMatrix4(new THREE.Matrix4().compose(a.clone().add(b).multiplyScalar(0.5), q, _one));
}
// Smooth solid through rings stacked along +Y; ring { y, rx, rz, cx, cz, ex (superellipse), dome }; the seam
// at the back (+Z), i = n / 2 at the front. `mod(p, k, i)` may move vertices before the normals.
function ringLoft(rings, n = 16, capBottom = false, capTop = false, mod = null) {
  const pos = [], idx = [], cols = n + 1;
  rings.forEach((R, k) => {
    const e = 2 / (R.ex || 2);
    for (let i = 0; i <= n; i++) {
      const a = Math.PI / 2 + (i / n) * TAU, c = Math.cos(a), s = Math.sin(a);
      const p = new V3((R.cx || 0) + Math.sign(c) * Math.abs(c) ** e * R.rx, R.y, (R.cz || 0) + Math.sign(s) * Math.abs(s) ** e * R.rz);
      if (mod) mod(p, k, i);
      pos.push(p.x, p.y, p.z);
    }
  });
  const at = (k, i) => k * cols + i;
  for (let k = 0; k < rings.length - 1; k++) for (let i = 0; i < n; i++) idx.push(at(k, i), at(k + 1, i), at(k, i + 1), at(k, i + 1), at(k + 1, i), at(k + 1, i + 1));
  const cap = (k, up) => {
    const R = rings[k], c = pos.length / 3;
    pos.push(R.cx || 0, R.y + (up ? 1 : -1) * (R.dome || 0), R.cz || 0);
    for (let i = 0; i < n; i++) idx.push(...(up ? [at(k, i), c, at(k, i + 1)] : [at(k, i), at(k, i + 1), c]));
  };
  if (capBottom) cap(0, false);
  if (capTop) cap(rings.length - 1, true);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  // the seam's two columns share their normals
  const N = g.attributes.normal, a = new V3(), b = new V3();
  for (let k = 0; k < rings.length; k++) {
    a.fromBufferAttribute(N, at(k, 0)); b.fromBufferAttribute(N, at(k, n)); a.add(b).normalize();
    N.setXYZ(at(k, 0), a.x, a.y, a.z); N.setXYZ(at(k, n), a.x, a.y, a.z);
  }
  return g;
}
// A grid surface from rows of points (rows[k][i], all rows the same length), optionally closed round.
function gridSurface(rows, closed = false, flip = false) {
  const pos = [], idx = [], m = rows[0].length;
  for (const r of rows) for (const p of r) pos.push(p.x, p.y, p.z);
  const cols = closed ? m : m - 1;
  for (let k = 0; k < rows.length - 1; k++) for (let i = 0; i < cols; i++) {
    const a = k * m + i, b = k * m + ((i + 1) % m), c = (k + 1) * m + i, d = (k + 1) * m + ((i + 1) % m);
    if (flip) idx.push(a, b, c, b, d, c); else idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// ---------------------------------------------------------------- the parts collector

// Each piece: its bone (and a second bone with a per-vertex weight for the skirts), its part bit (-1: always
// worn), its tint channel, its surface class and its vertex colour (hex or (x, y, z) => hex, sRGB).
class Fig {
  constructor(lod) { this.lod = lod; this.near = lod === 'near'; this.list = []; }
  add(g, { bone, bone2 = null, w = 1, part = -1, tint = TINT.none, surf = SURF.cloth, col = 0xffffff, grow = false }) {
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
    g.clearGroups();
    if (!g.index) g.setIndex([...Array(g.attributes.position.count).keys()]);
    if (!g.attributes.normal) g.computeVertexNormals();
    const n = g.attributes.position.count, p = g.attributes.position;
    const color = new Float32Array(n * 3), bones = new Float32Array(n * 2), wt = new Float32Array(n), info = new Float32Array(n * 3), gr = new Float32Array(n * 3);
    if (grow) gr.set(g.attributes.normal.array.subarray(0, n * 3));
    const c = new THREE.Color(), b0 = BI[bone], b1 = bone2 ? BI[bone2] : b0;
    for (let i = 0; i < n; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      c.setHex(typeof col === 'function' ? col(x, y, z) : col); // setHex converts sRGB to linear
      color[i * 3] = c.r; color[i * 3 + 1] = c.g; color[i * 3 + 2] = c.b;
      bones[i * 2] = b0; bones[i * 2 + 1] = b1;
      wt[i] = typeof w === 'function' ? clamp(w(x, y, z), 0, 1) : w;
      info[i * 3] = part + 1; info[i * 3 + 1] = typeof tint === 'function' ? tint(x, y, z) : tint; info[i * 3 + 2] = surf;
    }
    g.setAttribute('color', new THREE.BufferAttribute(color, 3));
    g.setAttribute('aBone', new THREE.BufferAttribute(bones, 2));
    g.setAttribute('aWeight', new THREE.BufferAttribute(wt, 1));
    g.setAttribute('aInfo', new THREE.BufferAttribute(info, 3));
    g.setAttribute('aGrow', new THREE.BufferAttribute(gr, 3));
    this.list.push(g);
  }
  geometry() {
    const g = mergeGeometries(this.list, false);
    for (const x of this.list) x.dispose();
    g.boundingSphere = new THREE.Sphere(new V3(), 1e6); // drawn by instances anywhere
    return g;
  }
}

// ---------------------------------------------------------------- the body

const COL = {
  boot: 0x1f1d1b, sole: 0x141312, leather: 0x24211e, buckle: 0x6c6f6a, button: 0x5f625e, eye: 0x1c1612, lip: 0xb27c72,
  bakelite: 0x1a1918, gas: 0x5b6058, towel: 0xd9d5c9, strap: 0x2b2824, gaiter: 0xe2e2dc,
  brass: 0xb08a48, steelCase: 0x8b917f, shell: 0xb39a45, fuze: 0x9c9a90, clip: 0x55595a, mag: 0x4d524f, optic: 0x3c3f3d,
  glass: 0x18252c, rf: 0x5b6158,
};

// The face's shading in the vertex colours (sRGB factors on the skin tint): soft dark sockets round the eyes
// and the shadow under the brows, warmer cheeks, a stubble shadow under the jaw and chin, so a face reads at a
// few metres without a texture
const sRGB = (r, g, b) => (Math.round(Math.min(1, Math.max(0, r)) * 255) << 16) | (Math.round(Math.min(1, Math.max(0, g)) * 255) << 8) | Math.round(Math.min(1, Math.max(0, b)) * 255);
function faceCol(x, y, z) {
  let r = 1, g = 1, b = 1;
  if (z < -0.035) {
    for (const s of SIDE) {
      const eye = Math.max(0, 1 - Math.hypot((x - s * 0.032) / 0.027, (y - 1.671) / 0.02));
      r -= eye * 0.3; g -= eye * 0.34; b -= eye * 0.3;
      const cheek = Math.max(0, 1 - Math.hypot((x - s * 0.046) / 0.032, (y - 1.622) / 0.026));
      g -= cheek * 0.1; b -= cheek * 0.12;
    }
  }
  if (y < 1.588) { const k = Math.min(1, (1.588 - y) / 0.035) * 0.16; r -= k; g -= k * 1.02; b -= k * 0.92; }
  return sRGB(r, g, b);
}

// head and neck: skull with the cropped hair, jaw, face details
function head(F) {
  const near = F.near;
  const hair = (x, y, z) => y > 1.735 - 0.9 * Math.max(0, z + 0.02) || (z > -0.02 && y > 1.652);
  const skull = ellipsoid(0.078, 0.102, 0.098, 0, 1.678, 0.008, near ? 11 : 7, near ? 8 : 5);
  F.add(skull, { bone: 'head', tint: (x, y, z) => (hair(x, y, z) ? TINT.hair : TINT.skin), surf: SURF.skin, col: near ? faceCol : 0xffffff });
  F.add(ellipsoid(0.069, 0.07, 0.076, 0, 1.606, -0.02, near ? 8 : 5, near ? 5 : 3), { bone: 'head', tint: TINT.skin, surf: SURF.skin, col: near ? faceCol : 0xffffff });
  if (near) {
    F.add(ellipsoid(0.012, 0.021, 0.016, 0, 1.642, -0.093, 5, 4), { bone: 'head', tint: TINT.skin, surf: SURF.skin, col: (x, y) => sRGB(1, 0.93 + (1.642 - y) * 2, 0.92 + (1.642 - y) * 2) }); // nose, its tip warmer
    for (const s of SIDE) {
      F.add(ellipsoid(0.013, 0.029, 0.02, s * 0.078, 1.656, 0.012, 5, 4), { bone: 'head', tint: TINT.skin, surf: SURF.skin, col: 0xf4dcd2 }); // ears
      F.add(ellipsoid(0.014, 0.007, 0.006, s * 0.032, 1.674, -0.082, 5, 3), { bone: 'head', col: COL.eye, surf: SURF.skin });
      F.add(box(0.032, 0.006, 0.01, s * 0.032, 1.688, -0.084, 0, 0, s * -0.12), { bone: 'head', tint: TINT.hair, surf: SURF.wool, col: 0xe0d8d0 });
    }
    F.add(box(0.034, 0.006, 0.01, 0, 1.585, -0.094), { bone: 'head', tint: TINT.skin, col: COL.lip, surf: SURF.skin });
  }
  F.add(lathe([[-0.05, 0.057], [0.05, 0.053], [0.13, 0.047]], near ? 8 : 5, 0, 1.495, 0.018), { bone: 'neck', tint: TINT.skin, surf: SURF.skin });
}

// The outer garment's torso and sleeves, shared by the blouse, the greatcoat and the parka: a per-man bulk
// (the build's T_BULK) pushes them out along their normals in the shader, so a greatcoat or a padded parka
// costs only its collar and skirt. Tinted with the 'tunic' channel, which holds the outer garment's colour.
function outerBody(F) {
  const near = F.near, n = near ? 14 : 8, ex = 2.5, T = TINT.tunic, o = { tint: T, grow: true };
  const r = (y, rx, rz, cz = 0) => ({ y, rx, rz, cz, ex });
  F.add(ringLoft([r(0.84, 0.19, 0.136, 0.01), r(0.88, 0.193, 0.138, 0.01), r(0.95, 0.188, 0.132, 0.005), r(1.03, 0.18, 0.126), r(1.08, 0.176, 0.122)], n), { bone: 'hips', ...o });
  F.add(ringLoft([r(0.99, 0.18, 0.125), r(1.1, 0.178, 0.124), r(1.23, 0.188, 0.128, -0.005)], n), { bone: 'spine', ...o });
  F.add(ringLoft([r(1.15, 0.182, 0.125), r(1.27, 0.192, 0.131, -0.008), r(1.36, 0.196, 0.13, -0.008), r(1.43, 0.178, 0.114, 0.002),
    { y: 1.475, rx: 0.13, rz: 0.09, cz: 0.01 }, { y: 1.505, rx: 0.072, rz: 0.066, cz: 0.014 }], n, false, true), { bone: 'chest', ...o });
  for (const s of SIDE) F.add(ellipsoid(0.056, 0.044, 0.06, s * 0.165, 1.41, 0.01, near ? 8 : 6, near ? 5 : 4), { bone: 'chest', ...o });
  const seg = near ? 8 : 5;
  for (const s of SIDE) {
    const S = SFX[SIDE.indexOf(s)], x = s * SH_X, ey = SH_Y - L_UA;
    F.add(lathe([[-0.34, 0], [-0.33, 0.046], [-0.26, 0.056], [-0.12, 0.06], [-0.03, 0.058], [0.008, 0.044], [0.028, 0]], seg, x, SH_Y, SH_Z, 1, 1.06), { bone: 'upperArm' + S, ...o });
    F.add(lathe([[-0.272, 0], [-0.266, 0.05], [-0.21, 0.053], [-0.2, 0.048], [-0.08, 0.052], [0.0, 0.055], [0.034, 0.042], [0.05, 0]], seg, x, ey, SH_Z, 1, 1.06), { bone: 'forearm' + S, ...o });
  }
  // the belt and its plain buckle (worn on all three)
  F.add(ringLoft([{ y: 1.012, rx: 0.187, rz: 0.131, ex }, { y: 1.052, rx: 0.186, rz: 0.13, ex }], n), { bone: 'spine', part: PART.belt, col: COL.leather, surf: SURF.leather, grow: true });
  if (near) F.add(box(0.052, 0.044, 0.014, 0, 1.032, -0.133), { bone: 'spine', part: PART.belt, col: COL.buckle, surf: SURF.metal, grow: true });
}

// a skirt in two halves (left, right) from `top` down to `bottom`, each half blending from the hips to its
// thigh lower down and toward the front, so it lies over the thighs of a seated man
function skirt(F, part, tint, rings, { overlap = 0.03, thighFront = 0.95, thighBack = 0.2, from = 0.95, span = 0.45, inner = true } = {}) {
  const m = F.near ? 7 : 4; // points per half
  for (const s of SIDE) {
    const S = SFX[SIDE.indexOf(s)];
    const rows = rings.map(([y, rx, rz, cz = 0]) => {
      const row = [];
      for (let i = 0; i < m; i++) {
        // from just past the front centre round the side to the back
        const a = -Math.PI / 2 - s * (overlap / rx) + s * (i / (m - 1)) * (Math.PI + overlap / rx);
        const c = Math.cos(a), sn = Math.sin(a);
        row.push(new V3(Math.sign(c) * Math.abs(c) ** 0.8 * rx, y, cz + Math.sign(sn) * Math.abs(sn) ** 0.8 * rz));
      }
      return row;
    });
    const wfn = (x, y, z) => {
      const front = clamp((-z / 0.2 + 1) / 2, 0, 1), k = lerp(thighBack, thighFront, front) * sstep(0, 1, (from - y) / span);
      return 1 - k; // the weight of the hips (the first bone)
    };
    F.add(gridSurface(rows, false, s > 0), { bone: 'hips', bone2: 'thigh' + S, w: wfn, part, tint });
    if (inner && F.near) {
      const rin = rows.map((r) => r.map((p) => new V3(p.x * 0.97, p.y, p.z * 0.97)));
      F.add(gridSurface(rin, false, s < 0), { bone: 'hips', bone2: 'thigh' + S, w: wfn, part, tint, col: 0xa8a8a8 });
    }
  }
}

function blouse(F) {
  // the Fliegerbluse's fold-down collar (the body is outerBody's)
  F.add(lathe([[0.0, 0.08], [0.03, 0.084], [0.052, 0.079], [0.064, 0.07]], F.near ? 12 : 7, 0, 1.468, 0.016, 1, 0.95), { bone: 'chest', part: PART.blouse, tint: TINT.tunic, col: 0xe0e0e0 });
}

function greatcoat(F) {
  const P = PART.coat, T = TINT.coat, near = F.near;
  // the wide collar lying on the shoulders, open at the front
  F.add(lathe([[0.0, 0.09], [0.025, 0.104], [0.05, 0.108], [0.07, 0.096], [0.08, 0.08]], near ? 12 : 7, 0, 1.44, 0.02, 1.12, 0.98), { bone: 'chest', part: P, tint: T, col: 0xe2e2e2 });
  // two rows of six plain buttons down the double-breasted front
  if (near) for (const x of [-0.072, 0.072]) for (let i = 0; i < 6; i++) {
    const y = 1.36 - i * 0.07, b = y > 1.17 ? 'chest' : 'spine';
    F.add(box(0.016, 0.016, 0.008, x, y, -(y > 1.15 ? 0.152 : 0.146) + Math.abs(x) * 0.25), { bone: b, part: P, col: COL.button, surf: SURF.metal });
  }
  // the skirt to mid-calf
  skirt(F, P, T, [[0.98, 0.206, 0.15], [0.86, 0.217, 0.158], [0.68, 0.236, 0.175], [0.5, 0.252, 0.19], [0.34, 0.268, 0.2]], { from: 0.94, span: 0.4 });
}

function parka(F) {
  const P = PART.parka, T = TINT.coat, near = F.near;
  // the drawn-in waist, the hood lying down on the shoulders behind the neck, the collar, the skirt to mid-thigh
  F.add(ringLoft([{ y: 0.99, rx: 0.222, rz: 0.162, ex: 2.5 }, { y: 1.02, rx: 0.214, rz: 0.156, ex: 2.5 }, { y: 1.05, rx: 0.22, rz: 0.16, ex: 2.5 }], near ? 14 : 8), { bone: 'spine', part: P, tint: T, col: 0xdadada });
  F.add(ellipsoid(0.13, 0.085, 0.075, 0, 1.455, 0.12, near ? 8 : 6, near ? 5 : 4), { bone: 'chest', part: P, tint: T, col: 0xe4e4e4 });
  F.add(lathe([[0.0, 0.094], [0.03, 0.099], [0.06, 0.09]], near ? 12 : 7, 0, 1.455, 0.018, 1.06, 0.98), { bone: 'chest', part: P, tint: T });
  skirt(F, P, T, [[0.98, 0.228, 0.166], [0.86, 0.232, 0.17], [0.72, 0.236, 0.172]], { from: 0.95, span: 0.3, thighFront: 0.85, thighBack: 0.3, inner: false });
}

// trousers, boots and gaiters
function legs(F) {
  const near = F.near, seg = near ? 8 : 5;
  // the seat of the trousers under the jacket
  F.add(ringLoft([{ y: 0.84, rx: 0.165, rz: 0.115, ex: 2.5, dome: 0.012 }, { y: 0.9, rx: 0.18, rz: 0.128, ex: 2.5 }, { y: 0.98, rx: 0.178, rz: 0.125, ex: 2.5 }], near ? 12 : 7, true, false), { bone: 'hips', tint: TINT.trousers });
  for (const s of SIDE) {
    const S = SFX[SIDE.indexOf(s)], x = s * HIP_X;
    F.add(lathe([[-0.48, 0], [-0.46, 0.06], [-0.37, 0.08], [-0.2, 0.093], [-0.04, 0.1], [0.03, 0.094], [0.065, 0.064], [0.085, 0]], seg, x, HIP_Y, -0.004, 1, 1.06),
      { bone: 'thigh' + S, tint: TINT.trousers });
    const ky = HIP_Y - L_TH;
    F.add(lathe([[-0.4, 0.05], [-0.31, 0.064], [-0.215, 0.074], [-0.08, 0.072], [0.0, 0.073], [0.04, 0.058], [0.062, 0]], seg, x, ky, 0.0, 1, 1.06),
      { bone: 'shin' + S, tint: TINT.trousers });
    // the boot's foot (both kinds), sole dark
    F.add(ringLoft([
      { y: -0.08, rx: 0.031, rz: 0.031, cz: 0.045, ex: 2.5, dome: 0.008 }, { y: -0.06, rx: 0.046, rz: 0.051, cz: 0.052, ex: 2.5 },
      { y: 0.01, rx: 0.053, rz: 0.06, cz: 0.06, ex: 2.5 }, { y: 0.11, rx: 0.057, rz: 0.043, cz: 0.042, ex: 2.5 },
      { y: 0.19, rx: 0.05, rz: 0.032, cz: 0.03, ex: 2.5 }, { y: 0.224, rx: 0.034, rz: 0.025, cz: 0.026, dome: 0.008 },
    ], near ? 8 : 6, true, true, (p) => { if (p.z < 0) p.z = 0; }).rotateX(-Math.PI / 2).translate(x, 0, 0), { bone: 'foot' + S, col: (px, py) => (py < 0.022 ? COL.sole : COL.boot), surf: SURF.leather });
    // jackboots: the tall shaft to below the knee
    F.add(lathe([[-0.03, 0], [-0.025, 0.058], [0.08, 0.066], [0.22, 0.073], [0.33, 0.079], [0.335, 0.0]], seg, x, ANKLE_Y, 0.006, 1, 1.1), { bone: 'shin' + S, part: PART.jackboots, col: COL.boot, surf: SURF.leather });
    // ankle boots, canvas gaiters with a strap, the trousers bloused over them
    F.add(lathe([[-0.03, 0], [-0.025, 0.057], [0.05, 0.058], [0.075, 0.0]], seg, x, ANKLE_Y, 0.008, 1, 1.12), { bone: 'shin' + S, part: PART.ankle, col: COL.boot, surf: SURF.leather });
    F.add(lathe([[0.03, 0.0], [0.035, 0.064], [0.165, 0.069], [0.17, 0.0]], seg, x, ANKLE_Y, 0.006, 1, 1.1), { bone: 'shin' + S, part: PART.ankle, tint: TINT.trousers, col: COL.gaiter, surf: SURF.cloth });
    if (near) F.add(lathe([[0.0, 0.07], [0.014, 0.07]], seg, x, ANKLE_Y + 0.1, 0.006, 1, 1.1), { bone: 'shin' + S, part: PART.ankle, col: COL.strap, surf: SURF.leather });
    F.add(lathe([[0.15, 0.0], [0.16, 0.075], [0.21, 0.08], [0.26, 0.0]], seg, x, ANKLE_Y, 0.004, 1, 1.08), { bone: 'shin' + S, part: PART.ankle, tint: TINT.trousers });
  }
}

// hands (skin or gloves, the 'hands' channel)
function hands(F) {
  const near = F.near;
  for (const s of SIDE) {
    const S = SFX[SIDE.indexOf(s)], x = s * SH_X, wy = SH_Y - L_UA - L_FA;
    const o = { bone: 'hand' + S, tint: TINT.hands, surf: SURF.skin };
    F.add(lathe([[-0.034, 0.03], [-0.026, 0.037], [0.012, 0.036], [0.022, 0.03]], near ? 7 : 5, x, wy, SH_Z), o);
    F.add(ellipsoid(0.023, 0.049, 0.044, x, wy - 0.056, SH_Z, near ? 6 : 5, near ? 4 : 3), o);
    F.add(xform(ellipsoid(0.019, 0.038, 0.041, 0, 0, 0, near ? 6 : 5, near ? 4 : 3), x - s * 0.014, wy - 0.104, SH_Z + 0.003, 0, 0, -s * 0.6), o);
    if (near) F.add(xform(ellipsoid(0.014, 0.032, 0.015, 0, 0, 0, 5, 3), x - s * 0.01, wy - 0.062, SH_Z - 0.043, 0.35, 0, -s * 0.35), o);
  }
}

// the steel helmet (M40/M42): a dome, the break and the flared skirt, short at the front over the brows, low
// over the ears and the nape; an inner skin under the skirt; the chin strap
function helmet(F) {
  const near = F.near, n = near ? 16 : 9, P = PART.helmet, T = TINT.headgear;
  const cz = 0.012; // the shell's centre over the head
  const rimY = (a) => { const c = Math.cos(a); return c < 0 ? lerp(1.603, 1.708, sstep(0.2, 0.95, -c)) : lerp(1.603, 1.584, sstep(0.1, 0.9, c)); }; // a = 0 at the back
  const Rx = 0.118, Rz = 0.135;
  const R = (a) => 1 / Math.sqrt((Math.sin(a) / Rx) ** 2 + (Math.cos(a) / Rz) ** 2);
  const prof = (a) => {
    const r = R(a), yr = rimY(a), yb = yr + (Math.cos(a) < 0 ? 0.03 : 0.045), fl = Math.cos(a) < 0 ? lerp(0.016, 0.03, -Math.cos(a)) : 0.02;
    return [[0, 1.838], [0.4 * r, 1.83], [0.72 * r, 1.808], [0.9 * r, 1.775], [0.985 * r, 1.735], [r, Math.max(yb, 1.705)], [r + 0.004, yb], [r + fl, yr]];
  };
  const rows = [], inner = [];
  const K = prof(0).length;
  for (let k = 0; k < K; k++) { rows.push([]); inner.push([]); }
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU, pr = prof(a), sa = Math.sin(a), ca = Math.cos(a);
    for (let k = 0; k < K; k++) {
      const [r, y] = pr[k];
      rows[k].push(new V3(sa * r, y, cz + ca * r));
      inner[k].push(new V3(sa * (r - 0.006), y + 0.003, cz + ca * (r - 0.006)));
    }
  }
  F.add(gridSurface(rows, true, false), { bone: 'head', part: P, tint: T, surf: SURF.helmet });
  if (near) F.add(gridSurface(inner.slice(K - 3), true, true), { bone: 'head', part: P, tint: T, surf: SURF.helmet, col: 0x8a8a8a });
  if (near) for (const s of SIDE) {
    F.add(box(0.012, 0.09, 0.016, s * 0.076, 1.578, 0.012, -0.25, 0, -s * 0.1), { bone: 'head', part: P, col: COL.strap, surf: SURF.leather }); // chin strap
    F.add(ellipsoid(0.007, 0.007, 0.004, s * 0.103, 1.75, 0.02, 4, 3).rotateZ(0), { bone: 'head', part: P, tint: T, surf: SURF.helmet, col: 0xcccccc }); // vent lugs
  }
}

// the M43 field cap: a soft crown rising toward the front with a flattish top, the turned-up curtain round
// the sides and back closed by two plain buttons at the front, the long soft peak sloping down
function cap43(F) {
  const near = F.near, n = near ? 12 : 7, P = PART.cap43, T = TINT.headgear;
  const front = (p) => { if (p.z < 0 && p.y > 1.735) p.y += 0.024 * sstep(0.0, 0.12, -p.z); };
  const tilt = (g) => xform(g.translate(0, -1.69, 0), 0, 1.69, 0, 0.06, 0, 0);
  // the crown flares a little toward its top panel (the M43's soft, slightly overhanging top)
  F.add(tilt(ringLoft([
    { y: 1.684, rx: 0.092, rz: 0.107, cz: 0.006 }, { y: 1.73, rx: 0.097, rz: 0.112, cz: 0.004 },
    { y: 1.762, rx: 0.105, rz: 0.12, cz: -0.004 }, { y: 1.775, rx: 0.102, rz: 0.116, cz: -0.006 }, { y: 1.781, rx: 0.084, rz: 0.097, cz: -0.006, dome: 0.002 },
  ], n, false, true, front)), { bone: 'head', part: P, tint: T });
  // the curtain, a little proud of the crown, lower at the back
  const curtain = (p) => { if (p.z > 0 && p.y < 1.7) p.y -= 0.008 * (p.z / 0.11); };
  F.add(tilt(ringLoft([{ y: 1.686, rx: 0.097, rz: 0.112, cz: 0.006 }, { y: 1.732, rx: 0.1, rz: 0.115, cz: 0.004 }], n, false, false, curtain)), { bone: 'head', part: P, tint: T, col: 0xd6d6d6 });
  if (near) for (const x of [-0.013, 0.013]) F.add(tilt(box(0.009, 0.009, 0.004, x, 1.711, -0.117)), { bone: 'head', part: P, col: COL.button, surf: SURF.metal });
  F.add(tilt(visor(0.094, 0.109, 0.072, 1.688, near ? 8 : 4, 0.032)), { bone: 'head', part: P, tint: T, col: 0xc8c8c8 });
}
// a peak round the front of a crown of radii rx, rz at height y, `len` long at its middle, sloping down
function visor(rx, rz, len, y, n, drop = 0.018) {
  const pos = [], idx = [];
  const a0 = -Math.PI * 0.5 - 1.0, a1 = -Math.PI * 0.5 + 1.0;
  for (let i = 0; i <= n; i++) {
    const a = lerp(a0, a1, i / n), c = Math.cos(a), s = Math.sin(a), w = Math.sin((Math.PI * i) / n);
    const ix = c * rx, iz = 0.006 + s * rz, ox = c * (rx + len * 0.8 * w), oz = 0.006 + s * (rz + len * w);
    for (const dy of [0.004, -0.004]) { pos.push(ix, y + dy, iz, ox, y - drop * w + dy, oz); }
  }
  for (let i = 0; i < n; i++) {
    const a = i * 4, b = a + 4;
    idx.push(a, a + 1, b, b, a + 1, b + 1, a + 2, b + 2, a + 3, b + 2, b + 3, a + 3, a + 1, a + 3, b + 1, b + 1, a + 3, b + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// the side cap (Fliegermuetze): a boat-shaped cap pulled over the crown, its crease front to back a little
// higher at the front, pointed ends, the turned-up curtain's fold round the bottom; worn tilted to the right
function sidecap(F) {
  const near = F.near, P = PART.sidecap, T = TINT.headgear, m = near ? 8 : 5;
  const rows = [];
  for (let k = 0; k < m; k++) {
    const z = lerp(-0.118, 0.122, k / (m - 1)), e = Math.max(0, 1 - ((z - 0.002) / 0.126) ** 2);
    const w = 0.09 * Math.sqrt(e) + 0.008, yb = 1.694 + 0.01 * (z / 0.12), yt = 1.8 - 0.016 * ((z + 0.118) / 0.24) - 0.02 * (1 - Math.sqrt(e));
    rows.push([[-w, yb], [-w * 1.03, yb + 0.032], [-w * 0.85, yb + 0.064], [-w * 0.45, yt - 0.016], [0, yt], [w * 0.45, yt - 0.016], [w * 0.85, yb + 0.064], [w * 1.03, yb + 0.032], [w, yb]]
      .map(([x, y]) => new V3(x, Math.max(y, yb), z)));
  }
  // worn tilted to the right, about the crown
  const tilt = (q) => xform(q.translate(0, -1.7, 0), 0.012, 1.702, 0.004, 0, 0, -0.19);
  F.add(tilt(gridSurface(rows, false, false)), { bone: 'head', part: P, tint: T, col: (x, y) => (y < 1.733 ? 0xe4e4e4 : 0xffffff) });
  // the end caps (front and back) as fans
  for (const [k, flip] of [[0, true], [m - 1, false]]) {
    const r = rows[k], c = r.reduce((a, p) => a.add(p), new V3()).multiplyScalar(1 / r.length);
    const pos = [c.x, c.y, c.z], idx = [];
    for (const p of r) pos.push(p.x, p.y, p.z);
    for (let i = 1; i < r.length; i++) idx.push(...(flip ? [0, i + 1, i] : [0, i, i + 1]));
    const f = new THREE.BufferGeometry();
    f.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    f.setIndex(idx);
    f.computeVertexNormals();
    F.add(tilt(f), { bone: 'head', part: P, tint: T, col: 0xd4d4d4 });
  }
}

function gear(F) {
  const near = F.near;
  // telephone headset: two bakelite earcups and the band over the top
  const H = PART.headset;
  for (const s of SIDE) F.add(xform(new THREE.CylinderGeometry(0.036, 0.034, 0.028, near ? 9 : 6), s * 0.088, 1.652, 0.012, 0, 0, Math.PI / 2), { bone: 'head', part: H, col: COL.bakelite, surf: SURF.bakelite });
  F.add(xform(new THREE.TorusGeometry(0.1, 0.005, 3, near ? 10 : 6, Math.PI * 0.94).scale(1, 1.6, 1), 0, 1.655, 0.014, 0, 0, Math.PI * 0.03), { bone: 'head', part: H, col: COL.bakelite, surf: SURF.metal });
  // the gas mask canister, fluted, slung on the back right hip, and its strap
  const G = PART.gasmask, ribs = [];
  for (let i = 0; i <= 6; i++) ribs.push([i * 0.043, i === 0 || i === 6 ? 0.048 : (i % 2 ? 0.056 : 0.051)]);
  F.add(xform(lathe([[0, 0], ...ribs, [0.262, 0]], near ? 8 : 5, 0, -0.13, 0), 0.115, 0.86, 0.175, 0.15, 0, 0.42), { bone: 'hips', part: G, col: COL.gas, surf: SURF.paint });
  if (near) F.add(tube(new V3(0.16, 0.98, 0.17), new V3(-0.16, 1.46, 0.06), 0.008, 0.008, 3), { bone: 'chest', part: G, col: COL.strap, surf: SURF.leather });
  // pistol holster on the belt, left front
  F.add(box(0.06, 0.13, 0.05, -0.135, 0.975, -0.11, 0.1, 0.5, 0.05), { bone: 'hips', part: PART.holster, col: COL.leather, surf: SURF.leather });
  // the helpers' white towel worn as a scarf
  F.add(lathe([[0.0, 0.074], [0.02, 0.081], [0.045, 0.078], [0.06, 0.068]], near ? 9 : 6, 0, 1.462, 0.018, 1, 0.95), { bone: 'chest', part: PART.scarf, col: COL.towel, surf: SURF.wool });
  // binoculars hanging on the chest
  binoculars(F, 'chest', PART.binoChest, new THREE.Matrix4().compose(new V3(0, 1.255, -0.172), new THREE.Quaternion().setFromEuler(new THREE.Euler(-1.35, 0, 0)), _one));
}

// 6x30 binoculars, prop space: the eyepieces' middle at the origin, -Z the line of sight, +X right
function binoculars(F, bone, part, M) {
  const near = F.near, seg = near ? 7 : 5;
  const add = (g, col, surf) => F.add(g.applyMatrix4(M), { bone, part, col, surf });
  for (const s of SIDE) {
    add(xform(new THREE.CylinderGeometry(0.019, 0.017, 0.035, seg), s * 0.033, 0, 0.006, Math.PI / 2, 0, 0), COL.bakelite, SURF.bakelite); // eyepiece
    add(box(0.044, 0.05, 0.05, s * 0.036, -0.004, -0.04), COL.optic, SURF.paint); // prism housing
    add(xform(new THREE.CylinderGeometry(0.021, 0.021, 0.05, seg), s * 0.045, -0.012, -0.085, Math.PI / 2, 0, 0), COL.optic, SURF.paint); // objective
    if (near) add(xform(new THREE.CircleGeometry(0.016, 8), s * 0.045, -0.012, -0.111, 0, Math.PI, 0), COL.glass, SURF.glass);
  }
  add(box(0.03, 0.016, 0.03, 0, 0.004, -0.03), COL.optic, SURF.paint); // bridge
}

// ---------------------------------------------------------------- props (the 'prop' bone, their own space)

// 8.8 cm round, prop space: the case head at the origin, the nose toward -Z; 0.932 m (refs/ww2/flak88 sec. 8)
function round88(F) {
  const near = F.near, seg = near ? 9 : 6, o = { bone: 'prop', part: PART.round88 };
  // one profile from the case head to the fuze's tip: [distance from the head, radius]
  const caseP = [[0, 0], [0, 0.056], [0.01, 0.056], [0.012, 0.05], [0.49, 0.049], [0.525, 0.045], [0.57, 0.045]];
  const shellP = [[0.57, 0.0438], [0.75, 0.0438], [0.79, 0.041], [0.83, 0.033], [0.872, 0.016]];
  const fuzeP = [[0.872, 0.016], [0.9, 0.013], [0.926, 0.006], [0.932, 0]];
  const along = (prof) => xform(lathe(prof.map(([d, r]) => [d, r]), seg, 0, 0, 0), 0, 0, 0, -Math.PI / 2, 0, 0);
  F.add(along(caseP), { ...o, col: COL.brass, surf: SURF.brass });
  F.add(along(shellP), { ...o, col: COL.shell, surf: SURF.paint });
  F.add(along(fuzeP), { ...o, col: COL.fuze, surf: SURF.metal });
}

// 12.8 cm round, prop space as round88's: the case head at the origin, the nose toward -Z; 1.488 m, a fixed
// round of 48 kg (refs/ww2/flak128 sec. 8: the cartridge 17.4 kg, so the case about two thirds of the length, E)
const R128 = { caseP: [[0, 0], [0, 0.083], [0.012, 0.083], [0.015, 0.075], [0.86, 0.072], [0.9, 0.067], [0.95, 0.067]],
  shellP: [[0.95, 0.064], [1.2, 0.064], [1.26, 0.06], [1.33, 0.046], [1.42, 0.022]], fuzeP: [[1.42, 0.022], [1.46, 0.016], [1.482, 0.008], [1.488, 0]] };
function round128(F) {
  const near = F.near, seg = near ? 10 : 6, o = { bone: 'prop', part: PART.round128 };
  const along = (prof) => xform(lathe(prof, seg, 0, 0, 0), 0, 0, 0, -Math.PI / 2, 0, 0);
  F.add(along(R128.caseP), { ...o, col: COL.brass, surf: SURF.brass });
  F.add(along(R128.shellP), { ...o, col: COL.shell, surf: SURF.paint });
  F.add(along(R128.fuzeP), { ...o, col: COL.fuze, surf: SURF.metal });
}

// 3.7 cm clip of eight (refs/ww2/flak43 sec. 8): the plate's middle at the origin, rounds along -Z noses forward
// side by side along X at 0.049 m, the case heads at z = +0.13 against the plate's rear ridge
function clip37(F) {
  const o = { bone: 'prop', part: PART.clip37 }, pitch = 0.049;
  F.add(box(8 * pitch, 0.006, 0.3, 0, -0.027, -0.02), { ...o, col: COL.clip, surf: SURF.metal });
  F.add(box(8 * pitch, 0.03, 0.012, 0, -0.012, 0.135), { ...o, col: COL.clip, surf: SURF.metal });
  for (let i = 0; i < 8; i++) {
    const x = (i - 3.5) * pitch;
    F.add(xform(lathe([[0, 0], [0, 0.0245], [0.25, 0.024], [0.263, 0.0185], [0.31, 0.0185], [0.355, 0.009], [0.368, 0]], 5, 0, 0, 0), x, 0, 0.13, -Math.PI / 2, 0, 0),
      { ...o, col: (px, py, pz) => (pz > 0.13 - 0.262 ? COL.brass : COL.shell), surf: SURF.brass });
  }
}

// 2 cm magazine (refs/ww2/flak38 sec. 8): a flat box 0.31 m long (+X), 0.12 high, 0.09 thick; origin at its
// middle; the left-hand copy rides on the left hand (its grip at the magazine's upper rear edge)
function mag20(F, bone, part, M) {
  const near = F.near, add = (g, col, surf) => F.add(g.applyMatrix4(M), { bone, part, col, surf });
  add(box(0.31, 0.12, 0.085, 0, 0, 0), COL.mag, SURF.paint);
  if (near) for (let i = 0; i < 5; i++) add(box(0.012, 0.124, 0.089, -0.1 + i * 0.05, 0, 0), 0x5a5f5b, SURF.paint);
  add(box(0.04, 0.035, 0.05, -0.17, 0.03, 0), 0x3d413f, SURF.metal); // the lips
}

// the light flak's 1 m stereo rangefinder on its shoulder harness (flakvierling_rangefinder_17): prop space at
// the eyepieces, -Z the line of sight, the tube along X
function rangefinder(F) {
  const near = F.near, seg = near ? 7 : 5, P = PART.rangefinder, o = { bone: 'prop', part: P };
  const X = (a, b, r0, r1, y = 0, z = 0) => xform(new THREE.CylinderGeometry(r1, r0, Math.abs(b - a), seg), (a + b) / 2, y, z, 0, 0, b > a ? -Math.PI / 2 : Math.PI / 2);
  F.add(X(-0.5, 0.5, 0.034, 0.034, 0.02, -0.07), { ...o, col: COL.rf, surf: SURF.paint });
  for (const s of SIDE) {
    F.add(X(s * 0.47, s * 0.6, 0.05, 0.052, 0.02, -0.07), { ...o, col: COL.rf, surf: SURF.paint }); // end heads
    if (near) F.add(xform(new THREE.CircleGeometry(0.03, 8), s * 0.55, 0.02, -0.123, 0, Math.PI, 0), { ...o, col: COL.glass, surf: SURF.glass });
    F.add(box(0.1, 0.09, 0.03, s * 0.55, 0.02, -0.105), { ...o, col: COL.rf, surf: SURF.paint });
    // the harness frame from the tube down to the chest pad
    F.add(tube(new V3(s * 0.12, 0.0, -0.07), new V3(s * 0.08, -0.26, 0.06), 0.008, 0.008, 4), { ...o, col: 0x3b3e3b, surf: SURF.metal });
    F.add(xform(new THREE.CylinderGeometry(0.018, 0.016, 0.06, seg), s * 0.032, 0.0, -0.02, Math.PI / 2, 0, 0), { ...o, col: COL.bakelite, surf: SURF.bakelite }); // eyecups
  }
  F.add(box(0.12, 0.08, 0.08, 0, 0.0, -0.06), { ...o, col: COL.rf, surf: SURF.paint }); // the eyepiece block
  F.add(box(0.22, 0.05, 0.03, 0, -0.27, 0.07), { ...o, col: 0x3b3e3b, surf: SURF.leather }); // chest pad
}

// telephone handset: prop space at the earpiece, the grip down and forward to the mouthpiece
function handset(F) {
  const near = F.near, P = PART.handset, o = { bone: 'prop', part: P, col: COL.bakelite, surf: SURF.bakelite };
  F.add(xform(new THREE.CylinderGeometry(0.028, 0.026, 0.02, near ? 10 : 6), 0, 0, 0, 0, 0, Math.PI / 2), o);
  F.add(tube(new V3(0.012, -0.01, 0), new V3(0.03, -0.17, -0.07), 0.014, 0.014, near ? 6 : 4), o);
  F.add(xform(new THREE.CylinderGeometry(0.024, 0.02, 0.025, near ? 10 : 6), 0.028, -0.185, -0.08, 0.5, 0, Math.PI / 2), o);
}

// ---------------------------------------------------------------- the far level

// The same man for the distance (beyond crew44.js NEAR): the same bones, parts, tints and silhouette in a
// fraction of the triangles: no faces, fingers or buttons, few segments, simple props.
function farFigure(F) {
  const ex = 2.5, T = TINT.tunic, n = 6;
  const r = (y, rx, rz, cz = 0) => ({ y, rx, rz, cz, ex });
  // head, neck, hands
  F.add(ellipsoid(0.078, 0.11, 0.097, 0, 1.665, 0.0, 6, 4), { bone: 'head', tint: (x, y, z) => (y > 1.74 - 0.9 * Math.max(0, z + 0.02) || (z > -0.02 && y > 1.652) ? TINT.hair : TINT.skin), surf: SURF.skin });
  F.add(lathe([[-0.05, 0.056], [0.13, 0.047]], 4, 0, 1.495, 0.018), { bone: 'neck', tint: TINT.skin, surf: SURF.skin });
  for (const s of SIDE) {
    const S = SFX[SIDE.indexOf(s)], x = s * SH_X, wy = SH_Y - L_UA - L_FA;
    F.add(ellipsoid(0.026, 0.06, 0.045, x - s * 0.005, wy - 0.07, SH_Z, 5, 3), { bone: 'hand' + S, tint: TINT.hands, surf: SURF.skin });
  }
  // the outer garment (bulked in the shader like the near one)
  F.add(ringLoft([r(0.84, 0.19, 0.136, 0.01), r(0.95, 0.188, 0.132, 0.005), r(1.08, 0.176, 0.122)], n), { bone: 'hips', tint: T, grow: true });
  F.add(ringLoft([r(1.0, 0.18, 0.125), r(1.24, 0.19, 0.129, -0.006)], n), { bone: 'spine', tint: T, grow: true });
  F.add(ringLoft([r(1.16, 0.183, 0.125), r(1.37, 0.198, 0.13, -0.008), r(1.445, 0.183, 0.114), { y: 1.5, rx: 0.08, rz: 0.07, cz: 0.012 }], n, false, true), { bone: 'chest', tint: T, grow: true });
  for (const s of SIDE) {
    const S = SFX[SIDE.indexOf(s)], x = s * SH_X, ey = SH_Y - L_UA;
    F.add(ellipsoid(0.06, 0.06, 0.066, s * 0.178, 1.432, 0.01, 4, 3), { bone: 'chest', tint: T, grow: true });
    F.add(lathe([[-0.34, 0], [-0.33, 0.05], [-0.02, 0.064], [0.05, 0]], 4, x, SH_Y, SH_Z, 1, 1.06), { bone: 'upperArm' + S, tint: T, grow: true });
    F.add(lathe([[-0.27, 0], [-0.265, 0.05], [0.0, 0.055], [0.05, 0]], 4, x, ey, SH_Z, 1, 1.06), { bone: 'forearm' + S, tint: T, grow: true });
  }
  F.add(ringLoft([r(1.012, 0.188, 0.132), r(1.052, 0.187, 0.131)], n), { bone: 'spine', part: PART.belt, col: COL.leather, surf: SURF.leather, grow: true });
  // coat: the collar and the skirt; parka: the waist, the hood, the skirt
  F.add(lathe([[0.0, 0.09], [0.05, 0.108], [0.08, 0.08]], 5, 0, 1.44, 0.02, 1.12, 0.98), { bone: 'chest', part: PART.coat, tint: TINT.coat, col: 0xe2e2e2 });
  skirt(F, PART.coat, TINT.coat, [[0.98, 0.206, 0.15], [0.66, 0.236, 0.175], [0.34, 0.268, 0.2]], { from: 0.94, span: 0.4, inner: false });
  F.add(ellipsoid(0.13, 0.085, 0.075, 0, 1.455, 0.12, 5, 3), { bone: 'chest', part: PART.parka, tint: TINT.coat, col: 0xe4e4e4 });
  skirt(F, PART.parka, TINT.coat, [[0.98, 0.228, 0.166], [0.72, 0.236, 0.172]], { from: 0.95, span: 0.3, thighFront: 0.85, thighBack: 0.3, inner: false });
  // legs and boots
  F.add(ringLoft([{ y: 0.84, rx: 0.165, rz: 0.115, ex, dome: 0.01 }, { y: 0.98, rx: 0.178, rz: 0.125, ex }], n, true, false), { bone: 'hips', tint: TINT.trousers });
  for (const s of SIDE) {
    const S = SFX[SIDE.indexOf(s)], x = s * HIP_X, ky = HIP_Y - L_TH;
    F.add(lathe([[-0.48, 0], [-0.46, 0.065], [-0.04, 0.1], [0.085, 0]], 5, x, HIP_Y, -0.004, 1, 1.06), { bone: 'thigh' + S, tint: TINT.trousers });
    F.add(lathe([[-0.4, 0.05], [-0.215, 0.074], [0.0, 0.073], [0.062, 0]], 5, x, ky, 0.0, 1, 1.06), { bone: 'shin' + S, tint: TINT.trousers });
    F.add(box(0.1, 0.09, 0.27, x, 0.045, -0.06), { bone: 'foot' + S, col: COL.boot, surf: SURF.leather });
    F.add(lathe([[-0.03, 0.06], [0.33, 0.079], [0.335, 0.0]], 5, x, ANKLE_Y, 0.006, 1, 1.1), { bone: 'shin' + S, part: PART.jackboots, col: COL.boot, surf: SURF.leather });
    F.add(lathe([[-0.03, 0.058], [0.165, 0.069], [0.17, 0.0]], 5, x, ANKLE_Y, 0.006, 1, 1.1), { bone: 'shin' + S, part: PART.ankle, tint: TINT.trousers, col: COL.gaiter, surf: SURF.cloth });
  }
  // headgear
  F.add(lathe([[0, 0.142], [0.04, 0.128], [0.12, 0.11], [0.2, 0.0]], 8, 0, 1.6, 0.012, 0.86, 1.0), { bone: 'head', part: PART.helmet, tint: TINT.headgear, surf: SURF.helmet });
  F.add(ringLoft([{ y: 1.684, rx: 0.094, rz: 0.11, cz: 0.006 }, { y: 1.8, rx: 0.086, rz: 0.098, dome: 0.004 }], 6, false, true), { bone: 'head', part: PART.cap43, tint: TINT.headgear });
  F.add(box(0.1, 0.008, 0.06, 0, 1.69, -0.13, -0.3), { bone: 'head', part: PART.cap43, tint: TINT.headgear, col: 0xd0d0d0 });
  F.add(xform(ellipsoid(0.085, 0.045, 0.118, 0, 0, 0, 5, 3), 0.006, 1.762, 0.004, 0, 0, -0.14), { bone: 'head', part: PART.sidecap, tint: TINT.headgear });
  // gear
  for (const s of SIDE) F.add(box(0.03, 0.06, 0.06, s * 0.088, 1.652, 0.012), { bone: 'head', part: PART.headset, col: COL.bakelite, surf: SURF.bakelite });
  F.add(xform(new THREE.CylinderGeometry(0.054, 0.054, 0.26, 5), 0.115, 0.86, 0.175, 0.15, 0, 0.42), { bone: 'hips', part: PART.gasmask, col: COL.gas, surf: SURF.paint });
  F.add(lathe([[0.0, 0.075], [0.06, 0.07]], 5, 0, 1.462, 0.018, 1, 0.95), { bone: 'chest', part: PART.scarf, col: COL.towel, surf: SURF.wool });
  F.add(box(0.12, 0.06, 0.1, 0, 1.25, -0.17), { bone: 'chest', part: PART.binoChest, col: COL.optic, surf: SURF.paint });
  // props
  const o88 = { bone: 'prop', part: PART.round88 };
  F.add(xform(lathe([[0, 0], [0, 0.056], [0.57, 0.046]], 5, 0, 0, 0), 0, 0, 0, -Math.PI / 2, 0, 0), { ...o88, col: COL.brass, surf: SURF.brass });
  F.add(xform(lathe([[0.57, 0.044], [0.75, 0.044], [0.932, 0]], 5, 0, 0, 0), 0, 0, 0, -Math.PI / 2, 0, 0), { ...o88, col: COL.shell, surf: SURF.paint });
  const o128 = { bone: 'prop', part: PART.round128 };
  F.add(xform(lathe([[0, 0], [0, 0.083], [0.95, 0.068]], 5, 0, 0, 0), 0, 0, 0, -Math.PI / 2, 0, 0), { ...o128, col: COL.brass, surf: SURF.brass });
  F.add(xform(lathe([[0.95, 0.064], [1.2, 0.064], [1.488, 0]], 5, 0, 0, 0), 0, 0, 0, -Math.PI / 2, 0, 0), { ...o128, col: COL.shell, surf: SURF.paint });
  F.add(box(0.39, 0.05, 0.37, 0, 0, -0.05), { bone: 'prop', part: PART.clip37, col: (x, y, z) => (z > -0.12 ? COL.brass : COL.shell), surf: SURF.brass });
  F.add(box(0.31, 0.12, 0.085, 0, 0, 0), { bone: 'prop', part: PART.mag20, col: COL.mag, surf: SURF.paint });
  const wy = SH_Y - L_UA - L_FA;
  F.add(box(0.31, 0.12, 0.085, 0, 0, 0).applyMatrix4(new THREE.Matrix4().compose(new V3(-SH_X - 0.005, wy - 0.235, SH_Z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI / 2, Math.PI / 2)), _one)), { bone: 'handL', part: PART.mag20L, col: COL.mag, surf: SURF.paint });
  F.add(xform(new THREE.CylinderGeometry(0.04, 0.04, 1.2, 5), 0, 0.02, -0.07, 0, 0, Math.PI / 2), { bone: 'prop', part: PART.rangefinder, col: COL.rf, surf: SURF.paint });
  F.add(box(0.15, 0.07, 0.12, 0, 0, -0.05), { bone: 'prop', part: PART.bino, col: COL.optic, surf: SURF.paint });
  F.add(box(0.04, 0.2, 0.05, 0.02, -0.09, -0.04), { bone: 'prop', part: PART.handset, col: COL.bakelite, surf: SURF.bakelite });
}

// ---------------------------------------------------------------- geometries and the material

const geoCache = new Map();
export function crewGeometry(lod = 'near') {
  if (geoCache.has(lod)) return geoCache.get(lod);
  const F = new Fig(lod);
  if (lod === 'far') {
    farFigure(F);
    const g = F.geometry();
    geoCache.set(lod, g);
    return g;
  }
  head(F); hands(F); legs(F);
  outerBody(F); blouse(F); greatcoat(F); parka(F);
  helmet(F); cap43(F); sidecap(F);
  gear(F);
  round88(F); round128(F); clip37(F); rangefinder(F); handset(F);
  binoculars(F, 'prop', PART.bino, new THREE.Matrix4());
  mag20(F, 'prop', PART.mag20, new THREE.Matrix4());
  // the second magazine in the left hand: held by its upper rear edge, hanging along the forearm's line
  const wy = SH_Y - L_UA - L_FA;
  mag20(F, 'handL', PART.mag20L, new THREE.Matrix4().compose(new V3(-SH_X - 0.005, wy - 0.235, SH_Z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI / 2, Math.PI / 2)), _one));
  const g = F.geometry();
  geoCache.set(lod, g);
  return g;
}

// The skinning, masking, tint and surface code the material and its depth material share.
const VERT_PARS = /* glsl */ `
uniform highp sampler2D uCrewData;
uniform vec4 uCrewJoint[${NB}];
attribute vec2 aBone;
attribute float aWeight;
attribute vec3 aInfo;
attribute vec3 aGrow;
attribute float aRow;
mat4 crewBone(int b, int row) {
  vec4 r0 = texelFetch(uCrewData, ivec2(b * 3, row), 0);
  vec4 r1 = texelFetch(uCrewData, ivec2(b * 3 + 1, row), 0);
  vec4 r2 = texelFetch(uCrewData, ivec2(b * 3 + 2, row), 0);
  return mat4(r0.x, r1.x, r2.x, 0.0, r0.y, r1.y, r2.y, 0.0, r0.z, r1.z, r2.z, 0.0, r0.w, r1.w, r2.w, 1.0);
}`;
const VERT_BASE = /* glsl */ `
  int crewRow = int(aRow + 0.5);
  int crewB0 = int(aBone.x + 0.5);
  mat4 crewM = crewBone(crewB0, crewRow);
  if (aWeight < 0.999) crewM = crewM * aWeight + crewBone(int(aBone.y + 0.5), crewRow) * (1.0 - aWeight);
  vec4 crewBuild = texelFetch(uCrewData, ivec2(${T_BUILD}, crewRow), 0);
  vec4 crewBulk = texelFetch(uCrewData, ivec2(${T_TINT}, crewRow), 0); // x: the outer garment's bulk (m), y: quilted
  vec4 crewMaskT = texelFetch(uCrewData, ivec2(${T_MASK}, crewRow), 0);
  int crewPart = int(aInfo.x + 0.5) - 1;
  float crewOn = 1.0;
  if (crewPart >= 0) {
    int crewBits = crewPart < 24 ? int(crewMaskT.x + 0.5) : int(crewMaskT.y + 0.5);
    if (((crewBits >> (crewPart < 24 ? crewPart : crewPart - 24)) & 1) == 0) crewOn = 0.0;
  }`;
const VERT_SKIN = /* glsl */ `
  {
    vec4 cj = uCrewJoint[crewB0];
    vec3 cp = transformed - cj.xyz + aGrow * crewBulk.x;
    if (cj.w > 0.5 && cj.w < 1.5) cp.xz *= crewBuild.x; else if (cj.w > 1.5) cp *= crewBuild.y;
    transformed = (crewM * vec4((cj.xyz + cp) * crewOn, 1.0)).xyz;
  }`;

let material = null, depthMaterial = null;
const shared = { tex: { value: null }, joints: { value: null } };

function jointUniform() {
  return BONES.map((b) => new THREE.Vector4(...JOINT[b], SCALE_MODE[b] || 0));
}

/** The one material every crewman shares (MeshStandardMaterial, vertex colours, GPU skinning from the
 *  crew data texture). `tex` is that texture (crew44.js owns it). */
export function crewMaterial(tex) {
  shared.tex.value = tex;
  if (material) return material;
  shared.joints.value = jointUniform();
  material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 });
  material.name = 'crew44';
  const rm = SURF_RM.map(([r, m]) => `vec2(${r.toFixed(3)}, ${m.toFixed(3)})`).join(', ');
  patchMaterial(material, 'crew44', (shader) => {
    shader.uniforms.uCrewData = shared.tex;
    shader.uniforms.uCrewJoint = shared.joints;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERT_PARS}\nvarying vec3 vCrewTint;\nvarying vec2 vCrewRM;\nvarying vec4 vCrewP;\nvarying vec2 vCrewMud;\nconst vec2 CREW_RM[${SURF_RM.length}] = vec2[](${rm});`)
      .replace('#include <skinbase_vertex>', `${VERT_BASE}
  int crewTint = int(aInfo.y + 0.5);
  vCrewTint = crewTint > 0 ? texelFetch(uCrewData, ivec2(${T_TINT} + crewTint, crewRow), 0).rgb : vec3(1.0);
  int crewSurf = int(aInfo.z + 0.5);
  vCrewRM = CREW_RM[crewSurf];
  vCrewP = vec4(position, crewBuild.w);
  // mud and wear: the boots, the trousers to the knee, a coat's hem (cloth and leather only); the parka's quilting
  vCrewMud = vec2((crewSurf <= 1 || crewSurf == 9) ? crewBuild.z * (1.0 - smoothstep(0.08, 0.62, position.y)) : 0.0, crewBulk.y * step(0.5, dot(aGrow, aGrow)));`)
      .replace('#include <skinnormal_vertex>', 'objectNormal = mat3(crewM) * objectNormal;')
      .replace('#include <skinning_vertex>', VERT_SKIN);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vCrewTint;\nvarying vec2 vCrewRM;\nvarying vec4 vCrewP;\nvarying vec2 vCrewMud;
float crewHash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float crewNoise(vec3 x) {
  vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(crewHash(i), crewHash(i + vec3(1, 0, 0)), f.x), mix(crewHash(i + vec3(0, 1, 0)), crewHash(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(crewHash(i + vec3(0, 0, 1)), crewHash(i + vec3(1, 0, 1)), f.x), mix(crewHash(i + vec3(0, 1, 1)), crewHash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
// a bump from a height field (metres) by its screen derivatives, without tangents (Mikkelsen, as three's
// bump map does)
vec3 crewBump(vec3 pos, vec3 n, float h) {
  vec3 sx = dFdx(pos), sy = dFdy(pos);
  vec3 r1 = cross(sy, n), r2 = cross(n, sx);
  float det = dot(sx, r1);
  vec3 grad = sign(det) * (dFdx(h) * r1 + dFdy(h) * r2);
  return normalize(abs(det) * n - grad);
}`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
  // cloth and wool: soft wrinkles running round the limbs and the body (stretched along them), and a finer
  // weave, a few millimetres deep, so a uniform is not a smooth shell
  if (vCrewRM.x > 0.8) {
    vec3 cq = vCrewP.xyz + vCrewP.w * 13.0;
    float crewH = crewNoise(cq * vec3(11.0, 3.6, 11.0)) * 0.011 + crewNoise(cq * vec3(26.0, 9.0, 26.0)) * 0.004 + crewNoise(cq * vec3(60.0, 48.0, 60.0)) * 0.0012;
    normal = crewBump(-vViewPosition, normal, crewH);
  }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
  diffuseColor.rgb *= vCrewTint;
  vec3 crewQ = vCrewP.xyz * 7.0 + vCrewP.w * 31.0;
  float crewN = crewNoise(crewQ) * 0.6 + crewNoise(crewQ * 3.7) * 0.4;
  if (vCrewRM.x > 0.8) diffuseColor.rgb *= 0.88 + 0.22 * crewN; // wool and cloth: an uneven, worn surface
  if (vCrewMud.y > 0.5) diffuseColor.rgb *= 1.0 - 0.18 * smoothstep(0.05, 0.0, 0.5 - abs(fract(vCrewP.y / 0.085) - 0.5)); // quilting
  float crewMud = clamp(vCrewMud.x * (0.55 + 0.9 * crewN), 0.0, 1.0);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.085, 0.07, 0.052), crewMud * 0.75);`)
      .replace('#include <roughnessmap_fragment>', '#define roughness (vCrewRM.x)\n#include <roughnessmap_fragment>\n#undef roughness')
      .replace('#include <metalnessmap_fragment>', '#define metalness (vCrewRM.y)\n#include <metalnessmap_fragment>\n#undef metalness');
  });
  return material;
}

/** The shadow pass's material, skinned the same way. */
export function crewDepthMaterial() {
  if (depthMaterial) return depthMaterial;
  depthMaterial = new THREE.MeshDepthMaterial();
  depthMaterial.name = 'crew44-depth';
  patchMaterial(depthMaterial, 'crew44-depth', (shader) => {
    shader.uniforms.uCrewData = shared.tex;
    shader.uniforms.uCrewJoint = shared.joints;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERT_PARS}`)
      .replace('#include <skinbase_vertex>', VERT_BASE)
      .replace('#include <skinning_vertex>', VERT_SKIN);
  });
  return depthMaterial;
}

/** Triangles per man at each level (every outfit piece is in the geometry; a man's mask hides the rest). */
export function crewTriangles(lod = 'near') {
  const g = crewGeometry(lod);
  return g.index.count / 3;
}
