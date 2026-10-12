import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Crew figure: a soldier of a Russian air defense crew for the reload scenes (S-400 and Pantsir
 * crews guiding crane loads, the Strela crew lifting containers by hand), built to read at 8 to
 * 150 m from the third-person camera. Reference: refs/crew/ (Commons photos of S-400 loading
 * crews: VKPO field uniform in EMR "tsifra" or plain olive worn loose, field caps, high black
 * boots, the loading crew in long orange hi-vis vests and hard hats; 6B47 helmets and plate
 * carriers on guard).
 *
 * One figure is ONE THREE.SkinnedMesh (one draw call, plus its shadow pass) with rigid skinning:
 * every vertex belongs to exactly one bone, so the parts are solid pieces that overlap at the
 * joints. 3.4k to 4.1k triangles depending on the outfit. Geometry is cached per outfit and shared
 * between figures; every figure uses the same material. Proportions of a 1.78 m man in metres, model
 * space as everywhere: ground at y = 0, the figure faces -Z, right is +X.
 *
 * API
 *   const fig = buildCrewman({ headgear, vest, pattern, gloves, skin, grip, height });
 *     headgear 'cap' (field cap, default) | 'helmet' (6B47 with an EMR cover) | 'hardhat' (orange) | 'none'
 *     vest     'none' (default) | 'webbing' (plate carrier with pouches) | 'hiviz' (orange, two tapes)
 *              (`webbing: true` is accepted for vest 'webbing')
 *     pattern  'emr' (default) | 'olive' | 'mm14' (the same digital pattern on a lighter khaki base, for a
 *              Ukrainian crew);  gloves true (default) | false;  skin 0..3 (tone)
 *     grip     half the spacing of the hands on a carried load, metres (default 0.2); also fig.grip
 *     height   stature in metres (default 1.78), applied as a uniform scale of fig.root
 *   fig.root      THREE.Group to place (its origin is the ground point under the figure)
 *   fig.mesh      the SkinnedMesh (castShadow/receiveShadow on, a fixed bounding sphere that covers every pose)
 *   fig.bones     { hips, spine, chest, neck, head, upperArmL, forearmL, handL, thighL, shinL, footL, ...R }
 *   fig.anchors   { handL, handR, carry }: handL/handR sit at the grip point inside each fist (children
 *                 of the hand bones); carry is a child of root placed by every pose, see below.
 *   fig.pose(name, t = 0, blend = 1)  sets the bone rotations (and the hips, shoulder and carry
 *                 positions) for pose `name` at phase t. blend < 1 moves that fraction of the way
 *                 from the current pose (call every frame with e.g. 1 - exp(-8 dt) to cross-fade).
 *                 A few two-bone IK solves (legs and the arms that hold something), about 4 us, no
 *                 allocation; call it every frame. Wrists are kept within a 57 degree bend and a
 *                 90 degree twist: the grip point always lands, the hand's orientation gives way.
 *   fig.reach(side, point, blend = 1, fingers?, palm?, pole?)  optional, after pose(): puts the grip
 *                 point of hand 'L' | 'R' on `point` (Vector3 in root space) with the same IK;
 *                 fingers / palm (root space directions) orient the hand, pole is where the elbow points.
 *   fig.dispose() frees the skeleton's bone texture (never the shared geometry or material).
 *   CREW_POSES, CREW_GAITS ({ walk, carryWalk, climb } cycle lengths, below), CREW_BONES, CREW_OUTFITS.
 *   buildCrew(n, opts)  n figures cycling through CREW_OUTFITS (opts override them).
 *   crewGeometry(opts), crewMaterial(), patchCrewMaterial(patchMaterial)  the shared resources.
 *
 * Poses (t in [0, 1) is one cycle; the others use t for breathing and small idle motion):
 *   stand        at ease.
 *   walk         cycle, root space treadmill: the feet plant and slide back, so move the root
 *                forward by CREW_GAITS.walk.stride per cycle (t += distance / stride).
 *   carry        a load held in front at the belt with both hands under it, elbows bent.
 *   carryWalk    the same, walking (CREW_GAITS.carryWalk.stride per cycle).
 *   carryShoulder  a load on the right shoulder, the right hand under it in front, head tilted away.
 *   crouch       kneeling on the right knee, hands forward and low under the load (picking it up).
 *   reachUp      arms raised, hands on the underside of a load hanging from a crane (t sways it).
 *   push         lunging, both hands on the end of a load at chest height, shoving it forward (t).
 *   climb        cycle, climbing the side of a vehicle: holds on a wall 0.32 m in front of the root,
 *                foot steps and hand bars 0.3 m apart. Every cycle the body rises
 *                CREW_GAITS.climb.rise (two steps), so raise the root by that much per cycle and the
 *                hands and feet stay on their holds (the viewer draws such a wall).
 *   signal       crane marshalling: right arm raised, the hand circling (t), left arm down.
 *   operate      standing at a control panel, hands forward on it at 1.1 m, pressing (t).
 *   sidestep     cycle, stepping sideways to the right (run t backwards to step to the left): the leading
 *                foot steps out, the other closes up, never crossing; move the root along its +X by
 *                CREW_GAITS.sidestep.stride per cycle. The arms hang (the reload scenes put the hands on
 *                a load with reach()).
 *   stoopWalk    cycle, walking bent double with the knees bent (head at about 1.1 m): through a low door
 *                or a hatch; CREW_GAITS.stoopWalk.stride per cycle.
 *
 * The carry anchor: +X runs along the load's length, +Y up. carry, carryWalk, crouch, reachUp: the
 * hands are under the load at carry +- grip along X, palms up and in, so the anchor is the underside
 * of the load between the hands; parent a container with its long axis along X and lift it by its
 * half height. Two men carrying one container stand side by side facing the same way, each holding
 * his end (offset the container along X in each one's anchor). carryShoulder: the anchor rides on the
 * right shoulder (it follows the torso), +X forward along the load raised 7 degrees, so a tube of
 * radius r goes at y = +r. push: the anchor is the middle of the load's end face, the hands 0.15 m
 * either side of it, +X forward into the load (offset a container by +length / 2). stand, walk,
 * climb, signal and operate leave it unheld in front of the waist.
 *
 * Fog and lighting: the material is a plain MeshStandardMaterial (vertex colours times an EMR
 * multiplier texture), so figures built before main.js calls patchSceneFog(scene) and added to the
 * scene are patched with everything else. Figures built later share the same material: patch it
 * once with  import { patchMaterial } from '../../shaderlib.js';  patchCrewMaterial(patchMaterial);
 * (that is patchMaterial(crewMaterial(), 'fog') unless already patched).
 */

const V3 = THREE.Vector3;
const TAU = Math.PI * 2;
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const lerp = (a, b, t) => a + (b - a) * t;
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const fract = (x) => x - Math.floor(x);

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------- skeleton (bind pose, model space)

export const CREW_BONES = ['hips', 'spine', 'chest', 'neck', 'head',
  'upperArmL', 'forearmL', 'handL', 'upperArmR', 'forearmR', 'handR',
  'thighL', 'shinL', 'footL', 'thighR', 'shinR', 'footR'];
const BI = Object.fromEntries(CREW_BONES.map((b, i) => [b, i]));
const PARENT = {
  hips: null, spine: 'hips', chest: 'spine', neck: 'chest', head: 'neck',
  upperArmL: 'chest', forearmL: 'upperArmL', handL: 'forearmL', upperArmR: 'chest', forearmR: 'upperArmR', handR: 'forearmR',
  thighL: 'hips', shinL: 'thighL', footL: 'shinL', thighR: 'hips', shinR: 'thighR', footR: 'shinR',
};
const L_TH = 0.425, L_SH = 0.415, L_UA = 0.295, L_FA = 0.26; // thigh, shin, upper arm, forearm (joint to joint)
const SH_X = 0.185, SH_Y = 1.445, SH_Z = 0.012, HIP_X = 0.092, HIP_Y = 0.93, ANKLE_Y = 0.09;
// joint centres of a 1.78 m man standing straight, arms hanging (index 0 left, 1 right; SIDE -1 / +1)
const J = {
  hips: [0, 0.98, 0], spine: [0, 1.08, 0], chest: [0, 1.27, 0], neck: [0, 1.495, 0.012], head: [0, 1.6, 0.005],
  upperArmL: [-SH_X, SH_Y, SH_Z], forearmL: [-SH_X, SH_Y - L_UA, SH_Z], handL: [-SH_X, SH_Y - L_UA - L_FA, SH_Z],
  upperArmR: [SH_X, SH_Y, SH_Z], forearmR: [SH_X, SH_Y - L_UA, SH_Z], handR: [SH_X, SH_Y - L_UA - L_FA, SH_Z],
  thighL: [-HIP_X, HIP_Y, 0], shinL: [-HIP_X, HIP_Y - L_TH, 0], footL: [-HIP_X, ANKLE_Y, 0],
  thighR: [HIP_X, HIP_Y, 0], shinR: [HIP_X, HIP_Y - L_TH, 0], footR: [HIP_X, ANKLE_Y, 0],
};
const SIDE = [-1, 1];
const SFX = ['L', 'R'];
const rel = (b) => { const p = PARENT[b], a = J[b]; return p ? new V3(a[0] - J[p][0], a[1] - J[p][1], a[2] - J[p][2]) : new V3(...a); };
const OFF = Object.fromEntries(CREW_BONES.map((b) => [b, rel(b)]));
// grip point in hand space: the inside of the curled fingers (the hand anchors sit here)
const GRIP = SIDE.map((s) => new V3(-0.032 * s, -0.092, 0));

// ---------------------------------------------------------------- colours and the EMR texture

const COL = {
  emr: 0x6d6a4e, mm14: 0x86836a, olive: 0x5e6045, skin: [0xc59c84, 0xb88d70, 0xd4ae96, 0xa07a60], hair: [0x3b2d21, 0x5b4431, 0x231b15, 0x6e5536],
  boot: 0x1d1c1b, sole: 0x111111, glove: 0x2a2a25, belt: 0x34352a, buckle: 0x6a6a5e, strap: 0x45463a,
  hiviz: 0xf57a1e, tape: 0xc7c9c2, hardhat: 0xe9621a, eye: 0x1c1612, lip: 0x9a6a58,
};
// EMR ("tsifra") as multipliers of the light base colour: base, green, brown, near black (sRGB)
const EMR = [0x6d6a4e, 0x596040, 0x5c4d37, 0x3b392c];
const TILE = 0.3; // metres of cloth per repeat of the pattern texture
const TEX = 256, CELL = 4; // texels, texels per pattern "pixel" (4.7 mm)
const WHITE_UV = [4 / TEX, 4 / TEX]; // a patch kept at multiplier 1: flat-coloured parts sample only this

let texture = null, material = null;
const geoCache = new Map();

function emrTexture() {
  const G = TEX / CELL;
  const r = rng(1944);
  const lattice = (P) => Float32Array.from({ length: P * P }, r);
  const vn = (a, P, u, v) => { // periodic value noise over the tile
    const x = u * P, y = v * P, ix = Math.floor(x), iy = Math.floor(y);
    let fx = x - ix, fy = y - iy;
    fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
    const x0 = ix % P, x1 = (ix + 1) % P, y0 = iy % P, y1 = (iy + 1) % P;
    return lerp(lerp(a[y0 * P + x0], a[y0 * P + x1], fx), lerp(a[y1 * P + x0], a[y1 * P + x1], fx), fy);
  };
  const L = Array.from({ length: 8 }, (_, i) => lattice(i % 2 ? 26 : 13));
  const f = (k, u, v) => 0.6 * vn(L[k * 2], 13, u, v) + 0.4 * vn(L[k * 2 + 1], 26, u, v);
  const base = new THREE.Color(EMR[0]);
  const mult = EMR.map((h) => { const c = new THREE.Color(h); return [c.r / base.r, c.g / base.g, c.b / base.b].map((m) => Math.round(clamp(m, 0, 1) * 255)); });
  const cv = document.createElement('canvas');
  cv.width = cv.height = TEX;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(TEX, TEX);
  for (let cy = 0; cy < G; cy++) for (let cx = 0; cx < G; cx++) {
    const u = (cx + 0.5) / G, v = (cy + 0.5) / G, j = (r() - 0.5) * 0.14;
    let k = 0;
    if (f(0, u, v) + j > 0.5) k = 1;
    if (f(1, u + 0.37, v + 0.21) + j * 0.8 > 0.6) k = 2;
    if (f(2, u + 0.11, v + 0.53) + j * 0.6 > 0.7) k = 3;
    if (f(3, u, v) + j > 0.72 && k === 0) k = 1; // stray pixels of green in the light areas
    if (cx < 2 && cy < 2) k = 0; // the flat patch at WHITE_UV
    const m = mult[k];
    for (let py = 0; py < CELL; py++) for (let px = 0; px < CELL; px++) {
      const i = ((cy * CELL + py) * TEX + cx * CELL + px) * 4;
      img.data[i] = m[0]; img.data[i + 1] = m[1]; img.data[i + 2] = m[2]; img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.NoColorSpace; // linear multipliers on the vertex colour
  t.anisotropy = 4;
  return t;
}

/** The one material every figure shares (created on first use). */
export function crewMaterial() {
  if (!material) {
    if (!texture && typeof document !== 'undefined') texture = emrTexture();
    material = new THREE.MeshStandardMaterial({ vertexColors: true, map: texture, roughness: 0.84, metalness: 0 });
    material.name = 'crew';
  }
  return material;
}

/** For figures built after patchSceneFog: pass shaderlib's patchMaterial. */
export function patchCrewMaterial(patchMaterial) {
  const m = crewMaterial();
  if (!m.userData.patched) patchMaterial(m, 'fog');
  return m;
}

// ---------------------------------------------------------------- geometry helpers

// Smooth solid through rings stacked along +Y; ring { y, rx, rz, cx, cz, ex (superellipse), dome }.
// UVs in metres: around from the front (so the front is never sheared), along Y; the seam is at the
// back, its normals averaged; caps get their own rim vertices with planar UVs (smooth normals kept).
// `mod(p)` may move vertices before the normals are computed.
function ringLoft(rings, n = 16, capBottom = false, capTop = false, mod = null) {
  const pos = [], uv = [], idx = [], cols = n + 1;
  for (const R of rings) {
    const e = 2 / (R.ex || 2), per = Math.PI * (R.rx + R.rz);
    for (let i = 0; i <= n; i++) {
      const a = Math.PI / 2 + (i / n) * TAU, c = Math.cos(a), s = Math.sin(a);
      pos.push((R.cx || 0) + Math.sign(c) * Math.abs(c) ** e * R.rx, R.y, (R.cz || 0) + Math.sign(s) * Math.abs(s) ** e * R.rz);
      uv.push((i / n - 0.5) * per, R.y);
    }
  }
  const at = (k, i) => k * cols + i;
  for (let k = 0; k < rings.length - 1; k++) for (let i = 0; i < n; i++) {
    idx.push(at(k, i), at(k + 1, i), at(k, i + 1), at(k, i + 1), at(k + 1, i), at(k + 1, i + 1));
  }
  const capTris = [];
  const cap = (k, up) => {
    const R = rings[k], c = pos.length / 3;
    pos.push(R.cx || 0, R.y + (up ? 1 : -1) * (R.dome || 0), R.cz || 0);
    uv.push(0, 0);
    for (let i = 0; i < n; i++) capTris.push(...(up ? [at(k, i), c, at(k, i + 1)] : [at(k, i), at(k, i + 1), c]));
  };
  if (capBottom) cap(0, false);
  if (capTop) cap(rings.length - 1, true);
  const g = new THREE.BufferGeometry();
  const P = new THREE.Float32BufferAttribute(pos, 3);
  if (mod) { const p = new V3(); for (let i = 0; i < P.count; i++) { p.fromBufferAttribute(P, i); mod(p); P.setXYZ(i, p.x, p.y, p.z); } }
  g.setAttribute('position', P);
  g.setIndex(idx.concat(capTris));
  g.computeVertexNormals();
  const N = g.attributes.normal, a = new V3(), b = new V3();
  for (let k = 0; k < rings.length; k++) {
    a.fromBufferAttribute(N, at(k, 0)); b.fromBufferAttribute(N, at(k, n)); a.add(b).normalize();
    N.setXYZ(at(k, 0), a.x, a.y, a.z); N.setXYZ(at(k, n), a.x, a.y, a.z);
  }
  // split the caps off onto their own copies of the rim, mapped from above
  const np = [...P.array], nn = [...N.array], remap = new Map();
  const ix = idx.slice();
  for (let j = 0; j < capTris.length; j++) {
    const v = capTris[j];
    let w = remap.get(v);
    if (w === undefined) { w = np.length / 3; np.push(P.getX(v), P.getY(v), P.getZ(v)); nn.push(N.getX(v), N.getY(v), N.getZ(v)); uv.push(0, 0); remap.set(v, w); }
    ix.push(w);
  }
  for (const w of [...remap.values(), ...(capBottom || capTop ? [cols * rings.length, cols * rings.length + (capBottom && capTop ? 1 : 0)] : [])]) {
    uv[w * 2] = np[w * 3]; uv[w * 2 + 1] = np[w * 3 + 2];
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(np, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nn, 3));
  out.setAttribute('uv', new THREE.Float32BufferAttribute(uv.map((v) => v / TILE), 2));
  out.setIndex(ix);
  g.dispose();
  return out;
}

// Surface of revolution about +Y through (x, y, z) from [dy, r] pairs listed bottom to top.
function lathe(prof, seg, x, y, z, sx = 1, sz = 1) {
  const g = new THREE.LatheGeometry(prof.map(([dy, r]) => new THREE.Vector2(Math.max(r, 1e-4), dy)), seg);
  const rmax = Math.max(...prof.map((p) => p[1])), len = prof[prof.length - 1][0] - prof[0][0];
  scaleUV(g, (TAU * rmax * (sx + sz)) / 2, len);
  return g.scale(sx, 1, sz).translate(x, y, z);
}

function ellipsoid(rx, ry, rz, x, y, z, w = 10, h = 7) {
  const g = new THREE.SphereGeometry(1, w, h);
  scaleUV(g, TAU * (rx + rz) / 2, Math.PI * ry);
  return g.scale(rx, ry, rz).translate(x, y, z);
}

function box(w, h, d, x, y, z, rx = 0, ry = 0, rz = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  scaleUV(g, Math.max(w, d), h);
  return xform(g, x, y, z, rx, ry, rz);
}

const _m4 = new THREE.Matrix4(), _q4 = new THREE.Quaternion(), _e4 = new THREE.Euler(), _one = new V3(1, 1, 1), _p4 = new V3();
function xform(g, x, y, z, rx = 0, ry = 0, rz = 0) {
  return g.applyMatrix4(_m4.compose(_p4.set(x, y, z), _q4.setFromEuler(_e4.set(rx, ry, rz)), _one));
}

function scaleUV(g, su, sv) {
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * su) / TILE, (uv.getY(i) * sv) / TILE);
  return g;
}

// ---------------------------------------------------------------- the body, part by part

class Body {
  constructor(o) { this.o = o; this.list = []; }
  // colour: hex or (x, y, z) => hex; camo: the part shows the pattern (when the outfit has one)
  add(g, bone, colour, camo = false) {
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
    g.clearGroups();
    const n = g.attributes.position.count, p = g.attributes.position, uv = g.attributes.uv;
    const col = new Float32Array(n * 3), si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
    const c = new THREE.Color(), pat = camo && this.o.pattern !== 'olive';
    for (let i = 0; i < n; i++) {
      const h = typeof colour === 'function' ? colour(p.getX(i), p.getY(i), p.getZ(i)) : colour;
      c.setHex(h);
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
      si[i * 4] = BI[bone];
      sw[i * 4] = 1;
      if (!pat) uv.setXY(i, WHITE_UV[0], WHITE_UV[1]);
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
    g.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
    this.list.push(g.index ? g : g.setIndex([...Array(n).keys()]));
  }
  geometry() {
    const g = mergeGeometries(this.list, false);
    for (const x of this.list) x.dispose();
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

function buildGeometry(o) {
  const B = new Body(o);
  const cloth = COL[o.pattern];
  const skin = COL.skin[o.skin % 4], hair = COL.hair[o.skin % 4];
  const ex = 2.5;

  // ---- head (bone head) and neck
  // cropped hair: under a cap only at the back and over the ears, bare-headed also on top
  const hairline = (x, y, z) => (o.headgear === 'none' ? y > 1.735 - 0.9 * Math.max(0, z + 0.02) || (z > -0.02 && y > 1.645) : o.headgear === 'cap' && z > -0.01 && y > 1.645 - 0.25 * Math.max(0, z - 0.03));
  B.add(ellipsoid(0.078, 0.102, 0.098, 0, 1.678, 0.008, 11, 8), 'head', (x, y, z) => (hairline(x, y, z) ? hair : skin));
  B.add(ellipsoid(0.069, 0.07, 0.076, 0, 1.606, -0.02, 9, 6), 'head', skin); // jaw and cheeks
  B.add(ellipsoid(0.012, 0.021, 0.016, 0, 1.642, -0.093, 5, 4), 'head', skin); // nose
  for (const s of SIDE) {
    B.add(ellipsoid(0.013, 0.029, 0.02, s * 0.078, 1.656, 0.012, 5, 4), 'head', skin); // ears
    B.add(ellipsoid(0.014, 0.007, 0.006, s * 0.032, 1.674, -0.082, 5, 3), 'head', COL.eye); // eyes
    B.add(box(0.034, 0.008, 0.012, s * 0.032, 1.688, -0.084, 0, 0, s * -0.12), 'head', o.skin === 2 ? COL.hair[3] : hair); // brows
  }
  B.add(box(0.034, 0.006, 0.01, 0, 1.585, -0.094), 'head', COL.lip);
  B.add(lathe([[-0.05, 0.057], [0.0, 0.055], [0.1, 0.05], [0.13, 0.047]], 8, 0, 1.495, 0.018), 'neck', skin);

  // ---- headgear (bone head)
  if (o.headgear === 'cap') {
    // VKPO field cap: upright crown, flat top, short curved visor
    B.add(ringLoft([
      { y: 1.688, rx: 0.088, rz: 0.104, cz: 0.006 },
      { y: 1.735, rx: 0.09, rz: 0.106, cz: 0.006 },
      { y: 1.775, rx: 0.089, rz: 0.104, cz: 0.004 },
      { y: 1.797, rx: 0.084, rz: 0.098, cz: 0.004, dome: 0.004 },
    ], 14, false, true), 'head', cloth, true);
    B.add(visor(), 'head', cloth, true);
  } else if (o.headgear === 'helmet') {
    // 6B47: rounded shell cut higher at the brow, fabric cover in EMR, chin strap
    const g = new THREE.SphereGeometry(1, 16, 9, 0, TAU, 0, Math.PI * 0.63);
    scaleUV(g, TAU * 0.13, Math.PI * 0.13);
    g.scale(0.124, 0.13, 0.144).translate(0, 1.672, 0.012);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) { const z = p.getZ(i), lim = 1.628 + 0.074 * sstep(0.03, -0.1, z); if (p.getY(i) < lim) p.setY(i, lim); }
    g.computeVertexNormals();
    B.add(g, 'head', cloth, true);
    for (const s of SIDE) B.add(box(0.008, 0.085, 0.014, s * 0.074, 1.6, 0.0, -0.3, 0, -s * 0.12), 'head', COL.strap); // chin strap
  } else if (o.headgear === 'hardhat') {
    const g = new THREE.SphereGeometry(1, 16, 7, 0, TAU, 0, Math.PI * 0.5);
    scaleUV(g, 1, 1);
    B.add(g.scale(0.12, 0.135, 0.14).translate(0, 1.695, 0.01), 'head', COL.hardhat);
    B.add(lathe([[-0.014, 0.114], [-0.005, 0.13], [0.004, 0.129], [0.006, 0.116]], 16, 0, 1.695, 0.008, 1, 1.17), 'head', COL.hardhat); // brim
    B.add(box(0.014, 0.022, 0.2, 0, 1.824, 0.012), 'head', COL.hardhat); // ridge
  }

  // ---- torso: a loose jacket worn outside the trousers, in three pieces that overlap where the spine bends
  B.add(ringLoft([
    { y: 0.765, rx: 0.188, rz: 0.134, cz: 0.01, ex, dome: 0.012 },
    { y: 0.84, rx: 0.193, rz: 0.137, cz: 0.01, ex },
    { y: 0.93, rx: 0.192, rz: 0.134, cz: 0.006, ex },
    { y: 1.01, rx: 0.183, rz: 0.127, cz: 0.002, ex },
    { y: 1.08, rx: 0.176, rz: 0.122, ex },
  ], 16, true, false), 'hips', cloth, true);
  B.add(ringLoft([
    { y: 0.99, rx: 0.18, rz: 0.125, ex },
    { y: 1.08, rx: 0.177, rz: 0.123, ex },
    { y: 1.16, rx: 0.182, rz: 0.126, cz: -0.003, ex },
    { y: 1.23, rx: 0.188, rz: 0.128, cz: -0.005, ex },
  ], 16), 'spine', cloth, true);
  B.add(ringLoft([
    { y: 1.15, rx: 0.182, rz: 0.125, ex },
    { y: 1.25, rx: 0.19, rz: 0.13, cz: -0.007, ex },
    { y: 1.33, rx: 0.196, rz: 0.132, cz: -0.01, ex },
    { y: 1.4, rx: 0.197, rz: 0.126, cz: -0.006, ex },
    { y: 1.445, rx: 0.183, rz: 0.114, cz: 0.002, ex },
    { y: 1.482, rx: 0.132, rz: 0.09, cz: 0.01 },
    { y: 1.505, rx: 0.072, rz: 0.066, cz: 0.014 },
  ], 16, false, true), 'chest', cloth, true);
  for (const s of SIDE) {
    B.add(ellipsoid(0.06, 0.06, 0.066, s * 0.178, 1.432, 0.01, 9, 6), 'chest', cloth, true); // shoulders
    if (o.vest === 'none') { // chest pockets (under a vest they are hidden)
      B.add(box(0.12, 0.15, 0.018, s * 0.09, 1.315, -0.134, 0.08, 0, s * 0.12), 'chest', cloth, true);
      B.add(box(0.122, 0.02, 0.02, s * 0.091, 1.385, -0.139, 0.08, 0, s * 0.12), 'chest', cloth, true);
    }
  }
  B.add(lathe([[0.0, 0.076], [0.05, 0.074], [0.058, 0.069]], 14, 0, 1.475, 0.016, 1, 0.95), 'chest', cloth, true); // collar
  B.add(ringLoft([{ y: 1.012, rx: 0.184, rz: 0.129, ex }, { y: 1.05, rx: 0.183, rz: 0.128, ex }], 16), 'spine', COL.belt);
  if (o.vest !== 'hiviz') B.add(box(0.05, 0.042, 0.012, 0, 1.031, -0.131), 'spine', COL.buckle); // under the vest it would poke through

  // ---- arms: loose sleeves
  for (const s of SIDE) {
    const S = SFX[SIDE.indexOf(s)], x = s * SH_X;
    B.add(lathe([[-0.345, 0], [-0.332, 0.04], [-0.3, 0.052], [-0.22, 0.056], [-0.12, 0.06], [-0.04, 0.063], [0.0, 0.061], [0.03, 0.044], [0.048, 0]], 9, x, SH_Y, SH_Z, 1, 1.06), 'upperArm' + S, cloth, true);
    B.add(box(0.012, 0.11, 0.085, x + s * 0.059, SH_Y - 0.14, SH_Z, 0, 0, s * 0.04), 'upperArm' + S, cloth, true); // sleeve pocket
    const ey = SH_Y - L_UA;
    B.add(lathe([[-0.275, 0], [-0.268, 0.044], [-0.25, 0.048], [-0.2, 0.047], [-0.12, 0.05], [-0.04, 0.054], [0.0, 0.054], [0.032, 0.04], [0.048, 0]], 9, x, ey, SH_Z, 1, 1.06), 'forearm' + S, cloth, true);
    const wy = ey - L_FA, hc = o.gloves ? COL.glove : skin;
    B.add(lathe([[-0.034, 0.03], [-0.026, 0.037], [0.012, 0.036], [0.022, 0.03]], 8, x, wy, SH_Z), 'hand' + S, hc);
    B.add(ellipsoid(0.023, 0.049, 0.044, x, wy - 0.056, SH_Z, 7, 5), 'hand' + S, hc); // palm
    B.add(xform(ellipsoid(0.019, 0.038, 0.041, 0, 0, 0, 7, 5), x - s * 0.014, wy - 0.104, SH_Z + 0.003, 0, 0, -s * 0.6), 'hand' + S, hc); // curled fingers
    B.add(xform(ellipsoid(0.014, 0.032, 0.015, 0, 0, 0, 6, 4), x - s * 0.01, wy - 0.062, SH_Z - 0.043, 0.35, 0, -s * 0.35), 'hand' + S, hc); // thumb
  }

  // ---- legs: baggy trousers with cargo pockets, bloused over high black boots
  for (const s of SIDE) {
    const S = SFX[SIDE.indexOf(s)], x = s * HIP_X;
    B.add(lathe([[-0.48, 0], [-0.462, 0.056], [-0.425, 0.074], [-0.37, 0.08], [-0.28, 0.088], [-0.18, 0.095], [-0.08, 0.1], [0.0, 0.1], [0.03, 0.094], [0.065, 0.064], [0.085, 0]], 9, x, HIP_Y, -0.004, 1, 1.06), 'thigh' + S, cloth, true);
    B.add(box(0.016, 0.17, 0.13, x + s * 0.088, HIP_Y - 0.25, -0.004, 0, 0, s * 0.05), 'thigh' + S, cloth, true); // cargo pocket
    B.add(box(0.018, 0.028, 0.134, x + s * 0.092, HIP_Y - 0.16, -0.004, 0, 0, s * 0.05), 'thigh' + S, cloth, true); // its flap
    const ky = HIP_Y - L_TH;
    B.add(lathe([[-0.262, 0], [-0.256, 0.055], [-0.245, 0.074], [-0.215, 0.078], [-0.15, 0.076], [-0.08, 0.074], [0.0, 0.074], [0.04, 0.058], [0.062, 0]], 9, x, ky, 0.0, 1, 1.06), 'shin' + S, cloth, true);
    B.add(lathe([[-0.03, 0], [-0.025, 0.055], [0.04, 0.057], [0.12, 0.056], [0.185, 0.059], [0.19, 0.0]], 8, x, ANKLE_Y, 0.008, 1, 1.12), 'shin' + S, COL.boot); // boot shaft
    B.add(ringLoft([
      { y: -0.08, rx: 0.03, rz: 0.03, cz: 0.045, ex, dome: 0.008 },
      { y: -0.066, rx: 0.043, rz: 0.048, cz: 0.05, ex },
      { y: -0.02, rx: 0.049, rz: 0.06, cz: 0.062, ex },
      { y: 0.03, rx: 0.053, rz: 0.058, cz: 0.058, ex },
      { y: 0.09, rx: 0.056, rz: 0.045, cz: 0.045, ex },
      { y: 0.15, rx: 0.055, rz: 0.036, cz: 0.035, ex },
      { y: 0.195, rx: 0.048, rz: 0.031, cz: 0.03, ex },
      { y: 0.224, rx: 0.033, rz: 0.024, cz: 0.026, dome: 0.008 },
    ], 10, true, true, (p) => { if (p.z < 0) p.z = 0; }).rotateX(-Math.PI / 2).translate(x, 0, 0), 'foot' + S, (px, py) => (py < 0.022 ? COL.sole : COL.boot));
  }

  // ---- vests
  if (o.vest === 'hiviz') {
    // long orange vest over the jacket, two reflective tapes round the waist (refs/crew, crew_01)
    const tape = (lo, hi) => (x, y) => (y > lo && y < hi ? COL.tape : COL.hiviz);
    const rings = (list) => list.map(([y, rx, rz, cz = 0]) => ({ y, rx, rz, cz, ex }));
    // the tapes have their own rings 0.5 mm inside the orange ones, so the colour changes sharply
    B.add(ringLoft(rings([[0.82, 0.2, 0.146, 0.01], [0.94, 0.201, 0.143, 0.006], [0.985, 0.197, 0.139, 0.003], [0.9855, 0.197, 0.139, 0.003], [1.0295, 0.192, 0.135, 0.001], [1.03, 0.192, 0.135, 0.001], [1.08, 0.187, 0.132]]), 14), 'hips', tape(0.9852, 1.0298));
    B.add(ringLoft(rings([[1.035, 0.19, 0.134], [1.1, 0.19, 0.134], [1.1005, 0.19, 0.134], [1.1445, 0.193, 0.136, -0.002], [1.145, 0.193, 0.136, -0.002], [1.24, 0.199, 0.139, -0.005]]), 14), 'spine', tape(1.1002, 1.1448));
    B.add(ringLoft(rings([[1.16, 0.193, 0.136], [1.25, 0.2, 0.14, -0.007], [1.33, 0.206, 0.142, -0.01], [1.4, 0.206, 0.136, -0.006], [1.45, 0.17, 0.118], [1.49, 0.12, 0.094, 0.008]]), 14), 'chest', COL.hiviz);
  } else if (o.vest === 'webbing') {
    // plate carrier: boxy front and back panels, shoulder straps, three magazine pouches, belt kit
    B.add(ringLoft([{ y: 1.05, rx: 0.2, rz: 0.15, cz: -0.007, ex: 3.2 }, { y: 1.2, rx: 0.202, rz: 0.15, cz: -0.007, ex: 3.2 }, { y: 1.25, rx: 0.202, rz: 0.15, cz: -0.007, ex: 3.2 }], 14, true, false), 'spine', cloth, true);
    B.add(ringLoft([{ y: 1.16, rx: 0.202, rz: 0.152, cz: -0.009, ex: 3.2 }, { y: 1.33, rx: 0.21, rz: 0.155, cz: -0.013, ex: 3.2 }, { y: 1.415, rx: 0.203, rz: 0.147, cz: -0.009, ex: 3.2 }, { y: 1.43, rx: 0.18, rz: 0.133, cz: -0.007, ex: 3 }], 14, false, true), 'chest', cloth, true);
    for (const s of SIDE) B.add(box(0.07, 0.03, 0.28, s * 0.115, 1.468, 0.006, 0, 0, s * 0.18), 'chest', cloth, true);
    for (const x of [-0.088, 0, 0.088]) {
      B.add(box(0.078, 0.13, 0.05, x, 1.125, -0.172), 'spine', cloth, true);
      B.add(box(0.082, 0.03, 0.054, x, 1.19, -0.173), 'spine', cloth, true);
    }
    B.add(box(0.08, 0.13, 0.06, -0.18, 1.3, -0.08, 0, -0.5, 0), 'chest', cloth, true); // radio pouch
    B.add(ringLoft([{ y: 0.96, rx: 0.197, rz: 0.142, cz: 0.004, ex }, { y: 1.01, rx: 0.192, rz: 0.137, cz: 0.002, ex }], 14), 'hips', COL.strap);
    for (const s of SIDE) B.add(box(0.06, 0.11, 0.09, s * 0.182, 0.95, 0.06, 0, s * 0.5, 0), 'hips', cloth, true);
  }
  return B.geometry();
}

// The field cap's visor: a curved peak round the front of the crown, sloping a little down.
function visor() {
  const pos = [], idx = [], uv = [], n = 10;
  const a0 = -Math.PI * 0.5 - 1.05, a1 = -Math.PI * 0.5 + 1.05;
  for (let i = 0; i <= n; i++) {
    const a = lerp(a0, a1, i / n), c = Math.cos(a), s = Math.sin(a), w = Math.sin((Math.PI * i) / n);
    const ix = c * 0.089, iz = 0.006 + s * 0.105, ox = c * (0.089 + 0.062 * w), oz = 0.006 + s * (0.105 + 0.068 * w);
    for (const dy of [0.005, -0.003]) {
      pos.push(ix, 1.693 + dy, iz, ox, 1.686 - 0.008 * w + dy, oz);
      uv.push(i * 0.02, 0, i * 0.02, 0.06);
    }
  }
  for (let i = 0; i < n; i++) {
    const a = i * 4, b = a + 4;
    idx.push(a, a + 1, b, b, a + 1, b + 1); // top
    idx.push(a + 2, b + 2, a + 3, b + 2, b + 3, a + 3); // underside
    idx.push(a + 1, a + 3, b + 1, b + 1, a + 3, b + 3); // front edge
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv.map((v) => v / TILE), 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// ---------------------------------------------------------------- figures

function options(opts) {
  const o = {
    headgear: opts.headgear || 'cap',
    vest: opts.vest || (opts.webbing ? 'webbing' : 'none'),
    pattern: ['olive', 'mm14'].includes(opts.pattern) ? opts.pattern : 'emr',
    gloves: opts.gloves !== false,
    skin: Math.abs(Math.floor(opts.skin ?? 0)) % 4,
  };
  o.key = `${o.headgear}|${o.vest}|${o.pattern}|${o.gloves}|${o.skin}`;
  return o;
}

export function crewGeometry(opts = {}) {
  const o = options(opts);
  if (!geoCache.has(o.key)) geoCache.set(o.key, buildGeometry(o));
  return geoCache.get(o.key);
}

export function buildCrewman(opts = {}) {
  const o = options(opts);
  const geo = crewGeometry(o);
  const bones = {}, list = [];
  for (const name of CREW_BONES) {
    const b = new THREE.Bone();
    b.name = name;
    b.position.copy(OFF[name]);
    if (PARENT[name]) bones[PARENT[name]].add(b);
    bones[name] = b;
    list.push(b);
  }
  const mesh = new THREE.SkinnedMesh(geo, crewMaterial());
  mesh.name = 'crewman';
  mesh.add(bones.hips);
  mesh.updateMatrixWorld(true);
  mesh.bind(new THREE.Skeleton(list));
  mesh.castShadow = mesh.receiveShadow = true;
  mesh.boundingSphere = new THREE.Sphere(new V3(0, 1.05, -0.1), 1.45); // covers every pose (climb raises the hands to 2.1 m)
  const root = new THREE.Group();
  root.name = 'crew';
  root.add(mesh);
  if (opts.height) root.scale.setScalar(opts.height / 1.78);
  const handL = new THREE.Object3D(), handR = new THREE.Object3D(), carry = new THREE.Object3D();
  handL.name = 'handL'; handR.name = 'handR'; carry.name = 'carry';
  handL.position.copy(GRIP[0]); handR.position.copy(GRIP[1]);
  bones.handL.add(handL); bones.handR.add(handR); root.add(carry);
  const fig = {
    root, mesh, bones, anchors: { handL, handR, carry }, grip: opts.grip ?? 0.2, outfit: o,
    pose: (name, t = 0, blend = 1) => solvePose(fig, name, t, blend),
    reach: (side, point, blend = 1, fingers = null, palm = null, pole = null) => reach(fig, side, point, blend, fingers, palm, pole),
    dispose: () => mesh.skeleton.dispose(),
  };
  fig.pose('stand', 0, 1);
  return fig;
}

// the varied outfits buildCrew cycles through (a loading crew is mostly caps and hi-vis vests)
export const CREW_OUTFITS = [
  { headgear: 'cap' }, { headgear: 'hardhat', vest: 'hiviz' }, { headgear: 'cap', skin: 1 }, { headgear: 'helmet', vest: 'webbing', skin: 2 },
  { headgear: 'hardhat', vest: 'hiviz', skin: 3 }, { headgear: 'none', skin: 2 }, { headgear: 'cap', pattern: 'olive', skin: 1 },
];
export function buildCrew(n, opts = {}) {
  return Array.from({ length: n }, (_, i) => buildCrewman({ ...CREW_OUTFITS[i % CREW_OUTFITS.length], ...opts }));
}

// ---------------------------------------------------------------- poses

export const CREW_POSES = ['stand', 'walk', 'carry', 'carryWalk', 'carryShoulder', 'crouch', 'reachUp', 'push', 'climb', 'signal', 'operate', 'sidestep', 'stoopWalk'];
export const CREW_GAITS = {
  walk: { stride: 1.25, period: 0.98 }, // metres the root moves per cycle, seconds per cycle at a natural pace
  carryWalk: { stride: 0.9, period: 1.1 },
  climb: { rise: 0.6, period: 2.6 }, // metres the root rises per cycle
  sidestep: { stride: 0.4, period: 1.0 }, // metres the root moves sideways per cycle
  stoopWalk: { stride: 0.6, period: 1.15 },
};

// The pose specification each pose function fills in (root space unless noted). Torso angles are
// Euler 'YXZ' with x < 0 leaning forward; feet: ankle target, rotation (x > 0 toe up), knee pole;
// arms: FK angles (ua: x forward, z outward for the right arm; fa: elbow flexion) or IK onto a grip
// point with the hand's finger and palm directions and the elbow's pole.
function makeSpec() {
  const foot = () => ({ ankle: new V3(), rot: new THREE.Euler(0, 0, 0, 'YXZ'), pole: new V3() });
  const arm = () => ({ ik: false, onCarry: false, ua: new THREE.Euler(), fa: 0, hand: new THREE.Euler(), grip: new V3(), fingers: new V3(), palm: new V3(), pole: new V3() });
  return {
    hips: new V3(), hipsRot: new THREE.Euler(0, 0, 0, 'YXZ'), spine: new THREE.Euler(0, 0, 0, 'YXZ'), chest: new THREE.Euler(0, 0, 0, 'YXZ'),
    neck: new THREE.Euler(0, 0, 0, 'YXZ'), head: new THREE.Euler(0, 0, 0, 'YXZ'), shrug: [0, 0], feet: [foot(), foot()], arms: [arm(), arm()],
    carry: new V3(), carryRot: new THREE.Euler(0, 0, 0, 'YXZ'), carryChest: false,
  };
}
const S = makeSpec();

function reset(S) {
  S.hips.set(0, 0.972, 0);
  S.hipsRot.set(0, 0, 0); S.spine.set(0, 0, 0); S.chest.set(0, 0, 0); S.neck.set(0, 0, 0); S.head.set(0, 0, 0);
  S.shrug[0] = S.shrug[1] = 0;
  for (let i = 0; i < 2; i++) {
    const s = SIDE[i], f = S.feet[i], a = S.arms[i];
    f.ankle.set(s * 0.115, ANKLE_Y, 0); f.rot.set(0, -s * 0.12, 0); f.pole.set(s * 0.15, 0, -1);
    a.ik = false; a.onCarry = false; a.ua.set(0.03, 0, s * 0.1); a.fa = 0.2; a.hand.set(0, 0, 0);
  }
  S.carry.set(0, 1.0, -0.36); S.carryRot.set(0, 0, 0); S.carryChest = false;
}

// Ankle of a foot whose flat ankle would be at (x, z), pitched by p (> 0 toe up, rolling on the
// heel; < 0 heel up, rolling on the toe: the boot is rigid, so it tips up on its toe cap), lifted by `lift`.
function ankleAt(out, x, z, p, lift) {
  const c = Math.cos(p), s = Math.sin(p);
  if (p >= 0) out.set(x, 0.09 * c + 0.07 * s, z + 0.07 + 0.09 * s - 0.07 * c);
  else out.set(x, 0.09 * c - 0.215 * s, z - 0.215 + 0.09 * s + 0.215 * c);
  out.y += lift;
  return out;
}

// One foot of a walking gait at its own phase: stance (heel strike, flat, heel off) then swing.
function gaitFoot(f, ph, stride, duty, x, yaw, lift) {
  const A = (stride * duty) / 2;
  let z, p, l = 0;
  if (ph < duty) {
    const k = ph / duty;
    z = -A + 2 * A * k;
    p = k < 0.16 ? 0.3 * (1 - sstep(0, 0.16, k)) : k > 0.58 ? -0.72 * ((k - 0.58) / 0.42) ** 1.5 : 0;
  } else {
    const k = (ph - duty) / (1 - duty);
    z = A - 2 * A * sstep(0.02, 0.98, k);
    p = lerp(-0.72, 0.3, sstep(0.0, 0.85, k));
    l = lift * Math.sin(Math.PI * Math.min(1, k * 1.1)) ** 0.8;
  }
  ankleAt(f.ankle, x, z, p, l);
  f.rot.set(p, yaw, 0);
}

function setIK(a, gx, gy, gz, fx, fy, fz, nx, ny, nz, px, py, pz) {
  a.ik = true;
  a.grip.set(gx, gy, gz); a.fingers.set(fx, fy, fz); a.palm.set(nx, ny, nz); a.pole.set(px, py, pz);
}

// hands on the carry anchor at +-grip along its X: fingers (carry space), palms turned in and up
// by palmIn / palmUp, elbows toward the pole (given for the right arm, mirrored for the left)
const _cq = new THREE.Quaternion(), _cv = new V3(), _cf = new V3(), _cn = new V3(), _cp = new V3();
function holdCarry(S, grip, fx, fy, fz, palmIn, palmUp, px, py, pz) {
  _cq.setFromEuler(S.carryRot);
  for (let i = 0; i < 2; i++) {
    const s = SIDE[i];
    _cv.set(s * grip, 0, 0).applyQuaternion(_cq).add(S.carry);
    _cf.set(fx, fy, fz).applyQuaternion(_cq);
    _cn.set(-s * palmIn, palmUp, 0).applyQuaternion(_cq);
    _cp.set(s * px, py, pz);
    setIK(S.arms[i], _cv.x, _cv.y, _cv.z, _cf.x, _cf.y, _cf.z, _cn.x, _cn.y, _cn.z, _cp.x, _cp.y, _cp.z);
  }
}

function walkLegs(S, t, stride, duty, hy, bob, lift) {
  const c = Math.cos(TAU * t), c2 = Math.cos(2 * TAU * t), sn = Math.sin(TAU * t);
  S.hips.set(-0.016 * sn, hy - bob * c2, 0);
  S.hipsRot.set(-0.03, -0.07 * c, -0.035 * sn);
  S.spine.set(-0.02, 0.04 * c, 0.02 * sn);
  S.chest.set(0.0, 0.06 * c, 0.015 * sn);
  S.neck.set(0.03, -0.03 * c, 0);
  S.head.set(-0.03 + 0.015 * c2, 0, 0);
  for (let i = 0; i < 2; i++) {
    const s = SIDE[i];
    gaitFoot(S.feet[i], fract(t + (i ? 0.5 : 0)), stride, duty, s * 0.085, -s * 0.08, lift);
    S.feet[i].pole.set(s * 0.12, 0, -1);
  }
  return c;
}

// a limb's hold in root space while climbing: it moves up one rise during [a, b] and otherwise
// sinks as the root rises; climbSwing is 0..1..0 over the move (to lift the limb off the wall)
const climbHold = (t, a, b, h0) => h0 + CREW_GAITS.climb.rise * (sstep(a, b, t) - t);
const climbSwing = (t, a, b) => (t > a && t < b ? Math.sin(Math.PI * sstep(a, b, t)) : 0);

const POSES = {
  stand(S, t) {
    const b = Math.sin(TAU * t);
    S.hips.set(0.012, 0.972, 0.004);
    S.hipsRot.set(0, 0.02, 0.02);
    S.spine.set(-0.02, 0, -0.012);
    S.chest.set(0.02 + 0.012 * b, -0.02, -0.01);
    S.neck.set(0.05, 0, 0); S.head.set(-0.05, 0.03, 0.01);
    S.feet[0].ankle.set(-0.125, ANKLE_Y, 0.02); S.feet[1].ankle.set(0.115, ANKLE_Y, -0.02);
    for (let i = 0; i < 2; i++) { const s = SIDE[i], a = S.arms[i]; a.ua.set(0.04 + 0.01 * b, 0, s * 0.11); a.fa = 0.22; a.hand.set(0.05, 0, s * 0.06); }
  },
  walk(S, t) {
    const c = walkLegs(S, t, CREW_GAITS.walk.stride, 0.6, 0.944, 0.022, 0.075);
    for (let i = 0; i < 2; i++) {
      const s = SIDE[i], a = S.arms[i], sw = s * 0.36 * c; // right arm forward with the left leg
      a.ua.set(sw, 0, s * 0.1); a.fa = 0.28 + 0.22 * Math.max(0, sw / 0.36); a.hand.set(0.1, 0, s * 0.05);
    }
  },
  carry(S, t, fig) {
    const b = Math.sin(TAU * t);
    S.hips.set(0, 0.962, 0.025);
    S.hipsRot.set(0.04, 0, 0);
    S.spine.set(0.03, 0, 0); S.chest.set(0.02 + 0.008 * b, 0, 0); S.neck.set(0.06, 0, 0); S.head.set(0.06, 0, 0);
    S.feet[0].ankle.set(-0.13, ANKLE_Y, 0.0); S.feet[1].ankle.set(0.13, ANKLE_Y, 0.03);
    S.carry.set(0, 1.07 + 0.004 * b, -0.34);
    holdCarry(S, fig.grip, 0, -0.15, -1, 0.8, 0.6, 0.45, -1, 0.35);
  },
  carryWalk(S, t, fig) {
    walkLegs(S, t, CREW_GAITS.carryWalk.stride, 0.64, 0.942, 0.016, 0.06);
    S.hipsRot.x = 0.035; S.spine.x = 0.02; S.chest.x = 0.02; S.neck.x = 0.06; S.head.x = 0.05;
    S.chest.y *= 0.4; S.spine.y *= 0.4;
    S.carry.set(0, S.hips.y + 0.11, -0.34);
    S.carryRot.set(0, 0.03 * Math.cos(TAU * t), 0);
    holdCarry(S, fig.grip, 0, -0.15, -1, 0.8, 0.6, 0.45, -1, 0.35);
  },
  carryShoulder(S, t) {
    const b = Math.sin(TAU * t);
    S.hips.set(-0.01, 0.968, 0.01);
    S.hipsRot.set(0, -0.04, 0.02);
    S.spine.set(0, 0.02, 0.03); S.chest.set(0.01 + 0.008 * b, 0.02, 0.03);
    S.neck.set(0.04, 0, 0.08); S.head.set(-0.02, -0.1, 0.14);
    S.shrug[1] = 0.025;
    S.feet[0].ankle.set(-0.13, ANKLE_Y, 0.03); S.feet[1].ankle.set(0.12, ANKLE_Y, -0.04);
    // the anchor rides on the right shoulder (chest space); the right hand holds the load's underside
    // 0.3 m in front of it (carry space)
    S.carryChest = true;
    S.carry.set(0.183, 0.228, 0.004);
    S.carryRot.set(0, Math.PI / 2, 0.12);
    setIK(S.arms[1], 0.3, -0.018, 0.015, 0, 0.35, -1, 0, 1, 0.35, 0.3, -1, 0.1);
    S.arms[1].onCarry = true;
    const a = S.arms[0];
    a.ua.set(0.06, 0, -0.12); a.fa = 0.3; a.hand.set(0.05, 0, -0.06);
  },
  crouch(S, t, fig) {
    const b = Math.sin(TAU * t);
    S.hips.set(0.02, 0.535, 0.1);
    S.hipsRot.set(-0.32, 0.12, 0.0);
    S.spine.set(-0.16 - 0.01 * b, -0.05, 0); S.chest.set(-0.06, -0.04, 0); S.neck.set(0.08, 0, 0); S.head.set(0.1, 0, 0);
    S.feet[0].ankle.set(-0.2, ANKLE_Y, -0.26); S.feet[0].rot.set(0, 0.3, 0); S.feet[0].pole.set(-0.6, 0.3, -1);
    ankleAt(S.feet[1].ankle, 0.12, 0.62, -1.2, 0.015); S.feet[1].rot.set(-1.2, -0.05, 0); S.feet[1].pole.set(0.05, -1, -0.3); // knee on the ground, toes tucked
    S.carry.set(0.07, 0.45, -0.45);
    S.carryRot.set(0, 0.12, 0);
    holdCarry(S, fig.grip, 0, -1, -0.35, 1, -0.15, 0.9, 0.1, 0.7);
  },
  reachUp(S, t, fig) {
    const w = Math.sin(TAU * t);
    S.hips.set(0.0, 0.972, 0.02);
    S.hipsRot.set(0.02, 0, 0.01 * w);
    S.spine.set(0.04, 0, 0); S.chest.set(0.08, 0, -0.01 * w); S.neck.set(-0.1, 0, 0); S.head.set(-0.32, 0, 0);
    S.shrug[0] = S.shrug[1] = 0.035;
    S.feet[0].ankle.set(-0.16, ANKLE_Y, -0.06); S.feet[1].ankle.set(0.15, ANKLE_Y, 0.08);
    S.carry.set(0.03 * w, 1.96, -0.27);
    holdCarry(S, fig.grip + 0.04, 0, 0.35, -1, 0.25, 1, 1, -0.25, 0.35);
  },
  push(S, t, fig) {
    const k = 0.5 - 0.5 * Math.cos(TAU * t); // a shove: weight forward and back
    S.hips.set(0.0, 0.875 - 0.01 * k, 0.08 - 0.05 * k);
    S.hipsRot.set(-0.2 - 0.04 * k, 0.04, 0);
    S.spine.set(-0.1, -0.02, 0); S.chest.set(-0.04, -0.02, 0); S.neck.set(0.12, 0, 0); S.head.set(-0.18, 0.02, 0);
    // front knee bent, the rear leg driving nearly straight from the ball of the foot
    S.feet[0].ankle.set(-0.13, ANKLE_Y, -0.27); S.feet[0].rot.set(0, 0.06, 0); S.feet[0].pole.set(-0.1, 0, -1);
    ankleAt(S.feet[1].ankle, 0.13, 0.68, -0.55, 0); S.feet[1].rot.set(-0.55, -0.1, 0);
    S.carry.set(0, 1.25 - 0.01 * k, -0.6 - 0.05 * k);
    S.carryRot.set(0, Math.PI / 2, 0);
    for (let i = 0; i < 2; i++) { const s = SIDE[i]; setIK(S.arms[i], s * 0.15, S.carry.y, S.carry.z + 0.005, s * 0.2, 1, 0, 0, 0, -1, s * 0.7, -1, 0.15); }
  },
  climb(S, t) {
    const WALL = -0.32;
    // swing windows [a, b] and hold heights at t = 0 (root space): left hand, right foot, right hand, left foot
    const lh = climbHold(t, 0.0, 0.22, 1.25), lhs = climbSwing(t, 0.0, 0.22), rf = climbHold(t, 0.12, 0.36, 0.022), rfs = climbSwing(t, 0.12, 0.36);
    const rh = climbHold(t, 0.5, 0.72, 1.55), rhs = climbSwing(t, 0.5, 0.72), lf = climbHold(t, 0.62, 0.86, 0.322), lfs = climbSwing(t, 0.62, 0.86);
    const b = Math.sin(2 * TAU * t);
    S.hips.set(0.03 * Math.sin(TAU * t), 0.81 + 0.015 * b, 0.02);
    S.hipsRot.set(0.05, 0.05 * Math.cos(TAU * t), 0.04 * Math.sin(TAU * t));
    S.spine.set(-0.08, 0, 0); S.chest.set(-0.1, -0.04 * Math.cos(TAU * t), 0); S.neck.set(0.02, 0, 0); S.head.set(-0.22, 0, 0);
    S.feet[0].ankle.set(-0.12, lf, WALL + 0.19 + 0.09 * lfs); S.feet[0].rot.set(0.15 * lfs, 0.1, 0); S.feet[0].pole.set(-0.45, 0.2, -1);
    S.feet[1].ankle.set(0.12, rf, WALL + 0.19 + 0.09 * rfs); S.feet[1].rot.set(0.15 * rfs, -0.1, 0); S.feet[1].pole.set(0.45, 0.2, -1);
    setIK(S.arms[0], -0.2, lh, WALL - 0.01 + 0.08 * lhs, 0, -0.25, -1, 0, -1, 0.25, -0.6, -1, 0.4);
    setIK(S.arms[1], 0.2, rh, WALL - 0.01 + 0.08 * rhs, 0, -0.25, -1, 0, -1, 0.25, 0.6, -1, 0.4);
    S.carry.set(0, 1.0, -0.3);
  },
  signal(S, t) {
    const a = TAU * t, b = Math.sin(a);
    S.hips.set(0.0, 0.972, 0.0);
    S.hipsRot.set(0, 0.04, -0.015);
    S.spine.set(0.02, 0, -0.02); S.chest.set(0.03, 0.02, -0.03); S.neck.set(-0.04, 0, 0); S.head.set(-0.14, 0.05, 0);
    S.shrug[1] = 0.035;
    S.feet[0].ankle.set(-0.15, ANKLE_Y, 0.02); S.feet[1].ankle.set(0.15, ANKLE_Y, -0.01);
    setIK(S.arms[1], 0.23 + 0.03 * Math.cos(a), 2.03 + 0.02 * b, -0.06 + 0.03 * Math.sin(a), 0.05, 1, 0, 0, 0, -1, 1, 0, 0.35);
    const l = S.arms[0];
    l.ua.set(0.02, 0, -0.1); l.fa = 0.2; l.hand.set(0, 0, -0.05);
  },
  sidestep(S, t) {
    // each foot is off the ground for a third of the cycle (the right one first, the left half a cycle
    // later); in stance it slides toward -X by what the root moves, so the feet stay planted
    const L = CREW_GAITS.sidestep.stride, duty = 0.66, A = (L * duty) / 2, c2 = Math.cos(2 * TAU * t);
    let w = 0;
    for (let i = 0; i < 2; i++) {
      const s = SIDE[i], ph = fract(t + (i ? 0 : 0.5));
      let x, lift = 0;
      if (ph < 1 - duty) {
        const k = ph / (1 - duty);
        x = -A + 2 * A * sstep(0, 1, k);
        lift = 0.07 * Math.sin(Math.PI * k);
        w += s * 0.5; // the weight on the other foot
      } else x = A - (2 * A * (ph - 1 + duty)) / duty;
      S.feet[i].ankle.set(s * 0.17 + x, ANKLE_Y + lift, i ? -0.01 : 0.02);
      S.feet[i].rot.set(0.12 * lift / 0.07, -s * 0.12, 0);
      S.feet[i].pole.set(s * 0.25, 0, -1);
    }
    S.hips.set(-0.02 * w, 0.952 - 0.012 * c2, 0.01);
    S.hipsRot.set(-0.02, 0, 0.03 * w);
    S.spine.set(-0.02, 0, -0.02 * w); S.chest.set(0.0, 0, -0.01 * w); S.neck.set(0.04, 0, 0); S.head.set(-0.03, 0, 0);
    for (let i = 0; i < 2; i++) { const s = SIDE[i], a = S.arms[i]; a.ua.set(0.1, 0, s * 0.16); a.fa = 0.45; a.hand.set(0.05, 0, s * 0.05); }
  },
  stoopWalk(S, t) {
    const c = walkLegs(S, t, CREW_GAITS.stoopWalk.stride, 0.64, 0.7, 0.014, 0.08);
    S.hips.z += 0.08;
    S.hipsRot.set(-0.85, -0.05 * c, S.hipsRot.z);
    S.spine.set(-0.32, 0.03 * c, 0); S.chest.set(-0.2, 0.04 * c, 0); S.neck.set(0.6, 0, 0); S.head.set(0.5, 0, 0);
    for (let i = 0; i < 2; i++) {
      const s = SIDE[i], a = S.arms[i], sw = s * 0.2 * c;
      a.ua.set(0.45 + sw, 0, s * 0.12); a.fa = 0.5; a.hand.set(0.1, 0, s * 0.05);
    }
  },
  operate(S, t) {
    const a = TAU * t;
    S.hips.set(0.0, 0.968, 0.04);
    S.hipsRot.set(-0.03, 0, 0);
    S.spine.set(-0.05, 0, 0); S.chest.set(-0.04, 0.02 * Math.sin(a), 0); S.neck.set(0.14, 0, 0); S.head.set(0.18, 0.04 * Math.sin(a * 0.5), 0);
    S.feet[0].ankle.set(-0.13, ANKLE_Y, 0.02); S.feet[1].ankle.set(0.13, ANKLE_Y, -0.02);
    const pr = Math.max(0, Math.sin(a * 2)) ** 4; // the right hand presses, the left turns a knob
    setIK(S.arms[0], -0.15 + 0.01 * Math.sin(a), 1.11, -0.42, 0.1, -0.45, -1, 0, -1, 0.45, -0.7, -0.6, 0.6);
    setIK(S.arms[1], 0.13, 1.115 - 0.012 * pr, -0.43, -0.05, -0.55, -1, 0, -1, 0.55, 0.7, -0.6, 0.6);
    S.carry.set(0, 1.08, -0.42);
  },
};

// ---------------------------------------------------------------- solver

const NB = CREW_BONES.length;
const TQ = Array.from({ length: NB }, () => new THREE.Quaternion());
const _qh = new THREE.Quaternion(), _qs = new THREE.Quaternion(), _qc = new THREE.Quaternion(), _qw = new THREE.Quaternion();
const _qa = new THREE.Quaternion(), _qb = new THREE.Quaternion(), _qi = new THREE.Quaternion(), _qx = new THREE.Quaternion();
const _qcar = new THREE.Quaternion(), _pcar = new V3();
const _pS = new V3(), _pC = new V3(), _pA = new V3(), _pT = new V3(), _sh = new V3();
const _d = new V3(), _pp = new V3(), _u = new V3(), _X = new V3(), _Y = new V3(), _Z = new V3(), _M = new THREE.Matrix4();
const XAXIS = new V3(1, 0, 0), _qr = new THREE.Quaternion();
const BEND = new Float64Array(1); // solve2's bend angle (kept out of return values, which V8 boxes)

// Two-bone IK from joint A to target T (lengths l1, l2), the middle joint bent toward `pole`.
// Writes the first bone's root-space rotation (its rest direction is -Y) to outQ and the bend
// angle to BEND[0]. s = +1 for arms (the lower bone flexes toward the bone's -Z), -1 for legs (toward +Z).
function solve2(A, T, l1, l2, pole, s, outQ) {
  _d.subVectors(T, A);
  let d = _d.length();
  if (d < 1e-6) { _d.set(0, -1, 0); d = 1e-6; } else _d.divideScalar(d);
  d = clamp(d, Math.abs(l1 - l2) + 1e-4, l1 + l2 - 1e-4);
  _pp.copy(pole).addScaledVector(_d, -pole.dot(_d));
  if (_pp.lengthSq() < 1e-8) _pp.set(0, 0, -s).addScaledVector(_d, s * _d.z);
  _pp.normalize();
  const ca = clamp((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d), -1, 1), sa = Math.sqrt(1 - ca * ca);
  _u.copy(_d).multiplyScalar(ca).addScaledVector(_pp, sa); // upper bone direction
  const cg = clamp((l1 * l1 + l2 * l2 - d * d) / (2 * l1 * l2), -1, 1);
  _Y.copy(_u).negate();
  _Z.copy(_pp).addScaledVector(_Y, -_pp.dot(_Y)).normalize().multiplyScalar(s);
  _X.crossVectors(_Y, _Z);
  outQ.setFromRotationMatrix(_M.makeBasis(_X, _Y, _Z));
  BEND[0] = Math.PI - Math.acos(cg);
}

// Hand rotation (root space) from finger and palm directions: bind pose fingers -Y, palm -X*side.
function handBasis(f, n, s, outQ) {
  _Y.copy(f).negate().normalize();
  _X.copy(n).multiplyScalar(-s);
  _X.addScaledVector(_Y, -_X.dot(_Y)).normalize();
  _Z.crossVectors(_X, _Y);
  return outQ.setFromRotationMatrix(_M.makeBasis(_X, _Y, _Z));
}

// IK for one arm: chest rotation qC (root space), shoulder position sh; fills TQ for the arm bones.
// The grip point is a constraint and the hand's orientation a preference: the hand's rotation from
// the forearm is split into a bend (wrist flexion and deviation, limited to MAX_BEND) and a twist
// about the forearm (pronation and supination, limited to MAX_TWIST; 0 is the thumb-up neutral);
// when either is clamped the arm is solved again for the hand's new wrist position.
const MAX_BEND = 1.0, MAX_TWIST = 1.6;
const _qt = new THREE.Quaternion(), _qsw = new THREE.Quaternion(), _qid = new THREE.Quaternion();
function armIK(i, a, qC, sh) {
  const b = 5 + i * 3;
  handBasis(a.fingers, a.palm, SIDE[i], _qw);
  let beta = 0;
  for (let pass = 0; pass < 3; pass++) {
    _pT.copy(GRIP[i]).applyQuaternion(_qw);
    _pT.subVectors(a.grip, _pT); // wrist target
    solve2(sh, _pT, L_UA, L_FA, a.pole, 1, _qa);
    beta = BEND[0];
    _qb.copy(_qa).multiply(_qx.setFromAxisAngle(XAXIS, beta)); // forearm in root space
    _qr.copy(_qb).invert().multiply(_qw); // hand relative to the forearm
    _qt.set(0, _qr.y, 0, _qr.w).normalize();
    let tw = 2 * Math.atan2(_qt.y, _qt.w);
    tw = tw > Math.PI ? tw - TAU : tw < -Math.PI ? tw + TAU : tw;
    _qsw.copy(_qr).multiply(_qi.copy(_qt).invert());
    const bend = 2 * Math.acos(Math.min(1, Math.abs(_qsw.w)));
    if (pass === 2 || (bend <= MAX_BEND + 0.01 && Math.abs(tw) <= MAX_TWIST + 0.01)) break;
    if (Math.abs(tw) > MAX_TWIST) _qt.setFromAxisAngle(_Y.set(0, 1, 0), Math.sign(tw) * MAX_TWIST);
    if (bend > MAX_BEND) _qsw.copy(_qid.slerp(_qsw, MAX_BEND / bend)), _qid.identity();
    _qw.copy(_qb).multiply(_qsw).multiply(_qt);
  }
  TQ[b].copy(_qi.copy(qC).invert()).multiply(_qa);
  TQ[b + 1].setFromAxisAngle(XAXIS, beta);
  TQ[b + 2].copy(_qb.invert()).multiply(_qw);
}

function solvePose(fig, name, t, blend) {
  const fn = POSES[name] || POSES.stand;
  reset(S);
  fn(S, t, fig);
  // torso chain (root space)
  TQ[0].setFromEuler(S.hipsRot);
  TQ[1].setFromEuler(S.spine); TQ[2].setFromEuler(S.chest); TQ[3].setFromEuler(S.neck); TQ[4].setFromEuler(S.head);
  _qh.copy(TQ[0]);
  _qs.copy(_qh).multiply(TQ[1]);
  _qc.copy(_qs).multiply(TQ[2]);
  _pS.copy(OFF.spine).applyQuaternion(_qh).add(S.hips);
  _pC.copy(OFF.chest).applyQuaternion(_qs).add(_pS);
  // the carry anchor (in chest space for loads on the shoulder) and hands placed on it
  _qcar.setFromEuler(S.carryRot);
  if (S.carryChest) { _qcar.premultiply(_qc); _pcar.copy(S.carry).applyQuaternion(_qc).add(_pC); } else _pcar.copy(S.carry);
  for (let i = 0; i < 2; i++) {
    const a = S.arms[i];
    if (a.onCarry) { a.grip.applyQuaternion(_qcar).add(_pcar); a.fingers.applyQuaternion(_qcar); a.palm.applyQuaternion(_qcar); }
  }
  // legs
  for (let i = 0; i < 2; i++) {
    const f = S.feet[i], b = 11 + i * 3;
    _pA.copy(OFF[i ? 'thighR' : 'thighL']).applyQuaternion(_qh).add(S.hips);
    solve2(_pA, f.ankle, L_TH, L_SH, f.pole, -1, _qa);
    const beta = BEND[0];
    TQ[b].copy(_qi.copy(_qh).invert()).multiply(_qa);
    TQ[b + 1].setFromAxisAngle(XAXIS, -beta);
    _qb.copy(_qa).multiply(TQ[b + 1]);
    _qx.setFromEuler(f.rot);
    TQ[b + 2].copy(_qb.invert()).multiply(_qx);
  }
  // arms
  for (let i = 0; i < 2; i++) {
    const a = S.arms[i], b = 5 + i * 3;
    if (a.ik) {
      _sh.copy(OFF[i ? 'upperArmR' : 'upperArmL']);
      _sh.y += S.shrug[i];
      _sh.x -= SIDE[i] * S.shrug[i] * 0.3;
      _sh.applyQuaternion(_qc).add(_pC);
      armIK(i, a, _qc, _sh);
    } else {
      TQ[b].setFromEuler(a.ua);
      TQ[b + 1].setFromAxisAngle(XAXIS, a.fa);
      TQ[b + 2].setFromEuler(a.hand);
    }
  }
  // apply, cross-fading from the current pose
  const B = fig.mesh.skeleton.bones, k = clamp(blend, 0, 1);
  for (let i = 0; i < NB; i++) { if (k >= 1) B[i].quaternion.copy(TQ[i]); else B[i].quaternion.slerp(TQ[i], k); }
  B[0].position.lerp(S.hips, k);
  for (let i = 0; i < 2; i++) {
    const ua = B[5 + i * 3], o = OFF[i ? 'upperArmR' : 'upperArmL'];
    ua.position.set(lerp(ua.position.x, o.x - SIDE[i] * S.shrug[i] * 0.3, k), lerp(ua.position.y, o.y + S.shrug[i], k), o.z);
  }
  const c = fig.anchors.carry;
  c.position.lerp(_pcar, k);
  if (k >= 1) c.quaternion.copy(_qcar); else c.quaternion.slerp(_qcar, k);
}

const _rf = new V3(), _rn = new V3(), _rp = new V3();
const RA = { ik: true, grip: new V3(), fingers: new V3(), palm: new V3(), pole: new V3() };
function reach(fig, side, point, blend, fingers, palm, pole) {
  const i = side === 'L' || side === 0 ? 0 : 1, s = SIDE[i], B = fig.mesh.skeleton.bones, b = 5 + i * 3;
  _qh.copy(B[0].quaternion);
  _qs.copy(_qh).multiply(B[1].quaternion);
  _qc.copy(_qs).multiply(B[2].quaternion);
  _pS.copy(B[1].position).applyQuaternion(_qh).add(B[0].position);
  _pC.copy(B[2].position).applyQuaternion(_qs).add(_pS);
  _sh.copy(B[b].position).applyQuaternion(_qc).add(_pC);
  RA.grip.copy(point);
  RA.fingers.copy(fingers || _rf.set(0, -0.3, -1));
  RA.palm.copy(palm || _rn.set(-s, 0, 0));
  RA.pole.copy(pole || _rp.set(s * 0.5, -1, 0.5));
  armIK(i, RA, _qc, _sh);
  const k = clamp(blend, 0, 1);
  for (let j = b; j < b + 3; j++) { if (k >= 1) B[j].quaternion.copy(TQ[j]); else B[j].quaternion.slerp(TQ[j], k); }
}
