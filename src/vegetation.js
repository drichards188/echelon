import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { patchMaterial, noiseGLSL } from './shaderlib.js';
import { mulberry32 } from './noise.js';
import { hedgeSegments } from './terrainField.js';
import { heightAt, padMask, ihash, riverCenterZ } from './terrainHeight.js';
import { ERA, flatPads } from './deploy.js';

// Windbreak rows along the hedge lines of the field grid, riparian willows, scattered groves and
// bushes. Four species (poplar, elm, birch, bush) as instanced meshes, a detailed and a coarse
// level each; every crown is a cluster of lumpy ellipsoids whose surface is cut into leaves in the
// fragment shader (a tiling leaf texture, triplanar in tree space, alpha-tested near the camera and
// solid beyond). Rows farther than ROW_NEAR are drawn as 50 m crossed cards carrying a row of
// silhouettes, a few triangles per piece, out to several kilometres. Every tree comes from a
// position hash, so a tree is the same tree each time it is re-planted.

const rnd = (x, z, s) => ihash(Math.floor(x * 2.7), Math.floor(z * 2.7), s);

// ---------------------------------------------------------------- textures
function dataTex(data, w, h, anisotropy = 4) {
  const t = new THREE.DataTexture(data, w, h, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = anisotropy;
  t.needsUpdate = true;
  return t;
}

// tiling leaves: alpha is coverage (about 80%), red a per-leaf brightness
function leafTexture() {
  const S = 128, d = new Uint8Array(S * S * 4);
  const rand = mulberry32(77);
  for (let n = 0; n < 230; n++) {
    const cx = rand() * S, cy = rand() * S, ang = rand() * Math.PI, len = 6.5 + rand() * 5, wid = 2.8 + rand() * 2;
    const shade = 70 + rand() * 185, c = Math.cos(ang), s = Math.sin(ang), R = Math.ceil(len) + 1;
    for (let j = -R; j <= R; j++) {
      for (let i = -R; i <= R; i++) {
        const u = i * c + j * s, w = -i * s + j * c;
        if ((u / len) ** 2 + (w / wid) ** 2 > 1) continue;
        const x = (((Math.floor(cx) + i) % S) + S) % S, y = (((Math.floor(cy) + j) % S) + S) % S, o = (y * S + x) * 4;
        const mid = 1 - Math.abs(w) / wid * 0.35; // a lighter midrib
        d[o] = Math.min(255, shade * mid + 20);
        d[o + 1] = d[o + 2] = 0;
        d[o + 3] = 255;
      }
    }
  }
  return dataTex(d, S, S);
}

// a row of tree silhouettes for the far cards: the upper half poplars (6 per piece), the lower half
// round crowns (4 per piece); alpha is the silhouette, red the brightness
function rowTexture() {
  const W = 512, H = 256, HH = H / 2, d = new Uint8Array(W * H * 4);
  const rand = mulberry32(1311);
  const put = (x, y, v) => {
    const o = (y * W + (((x % W) + W) % W)) * 4;
    d[o] = v; d[o + 3] = 255;
  };
  const grow = (y0, n, kind) => {
    for (let k = 0; k < n; k++) {
      const cx = (k + 0.5 + (rand() - 0.5) * 0.3) * (W / n), h = (kind === 0 ? 0.72 + 0.26 * rand() : 0.62 + 0.3 * rand()) * HH;
      const wmax = (kind === 0 ? 0.2 : 0.36) * (W / n) * (0.85 + 0.3 * rand());
      for (let y = 0; y < h; y++) {
        const t = y / h;
        let hw;
        if (kind === 0) hw = t < 0.1 ? 1.5 : wmax * Math.pow(Math.sin(Math.PI * Math.pow((t - 0.1) / 0.9, 0.62)), 0.85);
        else hw = t < 0.28 ? 1.8 : wmax * Math.sqrt(Math.max(0, 1 - ((t - 0.64) / 0.36) ** 2));
        hw *= 0.9 + 0.2 * Math.sin(y * 0.9 + k * 3.1);
        for (let x = Math.floor(cx - hw); x <= Math.ceil(cx + hw); x++) {
          const edge = 1 - Math.abs(x - cx) / Math.max(hw, 1);
          const shade = (t < 0.1 || (kind === 1 && t < 0.28) ? 60 : 100 + 90 * t + 40 * edge) * (0.75 + 0.5 * rand());
          put(x, y0 + y, Math.min(255, shade));
        }
      }
    }
  };
  grow(0, 4, 1);
  grow(HH, 6, 0);
  return dataTex(d, W, H, 8);
}

// ---------------------------------------------------------------- geometry
const tmpV = new THREE.Vector3();
function disp(x, y, z, seed) {
  const h = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719 + seed * 4.1) * 43758.5453;
  return (h - Math.floor(h)) - 0.5;
}

// a lumpy ellipsoid with smooth outward normals and a vertical colour gradient; aLeaf is the leaf
// tiling frequency per metre (0 on wood)
function blob(c, r, detail, seed, lo, hi, lump = 0.3, leaf = 0.45) {
  const g = new THREE.IcosahedronGeometry(1, detail);
  g.deleteAttribute('uv');
  const p = g.attributes.position, n = g.attributes.normal;
  const col = new Float32Array(p.count * 3);
  const a = new THREE.Color(), b = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const k = 1 + lump * disp(Math.round(x * 50) / 50, Math.round(y * 50) / 50, Math.round(z * 50) / 50, seed);
    x *= k; y *= k; z *= k;
    tmpV.set(x / (r[0] * r[0]), y / (r[1] * r[1]), z / (r[2] * r[2])).normalize();
    n.setXYZ(i, tmpV.x, tmpV.y, tmpV.z);
    p.setXYZ(i, c[0] + x * r[0], c[1] + y * r[1], c[2] + z * r[2]);
    const t = THREE.MathUtils.clamp((y + 1) / 2, 0, 1);
    a.set(lo).lerp(b.set(hi), t * t * 0.9 + 0.1);
    const j = 0.88 + 0.24 * (disp(x * 3, y * 3, z * 3, seed + 1) + 0.5);
    col[i * 3] = a.r * j; col[i * 3 + 1] = a.g * j; col[i * 3 + 2] = a.b * j;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('aLeaf', new THREE.BufferAttribute(new Float32Array(p.count).fill(leaf), 1));
  return g;
}

function paint(g, fn) {
  const n = g.attributes.position.count, col = new Float32Array(n * 3), c = new THREE.Color();
  for (let i = 0; i < n; i++) {
    fn(c, g.attributes.position.getY(i), i);
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('aLeaf', new THREE.BufferAttribute(new Float32Array(n), 1));
  return g;
}

function trunk(h, r0, r1, sides, color, bands = false) {
  const g = new THREE.CylinderGeometry(r1, r0, h, sides, bands ? Math.round(h * 2) : 1, true).toNonIndexed();
  g.deleteAttribute('uv');
  g.translate(0, h / 2, 0);
  const base = new THREE.Color(color), dark = new THREE.Color(0x1c1914);
  return paint(g, (c, y, i) => {
    c.copy(base);
    // birch bark: dark scars across the white
    if (bands && disp(Math.floor(y * 2.4), i % 3 > 0 ? 1 : 0, Math.floor(i / 6) % 6, 9) > 0.18) c.lerp(dark, 0.75);
  });
}

// a limb from a to b, tapering
const _up = new THREE.Vector3(0, 1, 0), _q = new THREE.Quaternion();
function limb(a, b, r0, r1, color) {
  const d = new THREE.Vector3(...b).sub(new THREE.Vector3(...a)), len = d.length();
  const g = new THREE.CylinderGeometry(r1, r0, len, 5, 1, true).toNonIndexed();
  g.deleteAttribute('uv');
  g.translate(0, len / 2, 0);
  g.applyQuaternion(_q.setFromUnitVectors(_up, d.normalize()));
  g.translate(a[0], a[1], a[2]);
  const c = new THREE.Color(color);
  return paint(g, (out) => out.copy(c));
}

function poplar(detail) {
  const parts = [trunk(5.5, 0.28, 0.16, 6, 0x3d332a)];
  const radii = [1.5, 2.0, 2.15, 2.0, 1.65, 1.15, 0.6];
  radii.forEach((rx, i) => {
    const o = disp(i, 3, 7, 5) * 0.7;
    parts.push(blob([o, 3.6 + i * 2.35, -o * 0.6], [rx, 2.7 - i * 0.05, rx], detail, i + 1, 0x1d3d10, 0x628528, 0.42, 0.3));
  });
  // ragged flanks: small clumps standing proud of the column
  for (let i = 0; i < 7; i++) {
    const a = i * 2.4 + 0.5, y = 3.4 + i * 1.75, r = 1.5 + 0.55 * Math.sin((i + 0.6) * 0.62 * 2);
    parts.push(blob([Math.cos(a) * r, y, Math.sin(a) * r], [0.95, 1.05, 0.95], detail, i + 41, 0x1d3d10, 0x628528, 0.4, 0.3));
  }
  return mergeGeometries(parts);
}
function broad(detail) {
  const parts = [trunk(4.6, 0.42, 0.28, 7, 0x4a3c30)];
  parts.push(limb([0, 4.2, 0], [-1.9, 7.4, 0.6], 0.26, 0.12, 0x4a3c30), limb([0, 4.2, 0], [2.0, 7.0, -0.8], 0.24, 0.11, 0x4a3c30), limb([0, 4.4, 0], [0.4, 7.2, 2.2], 0.2, 0.1, 0x4a3c30));
  const bl = [[0, 8.6, 0, 3.9, 3.0], [-3.3, 6.9, 1.0, 2.8, 2.3], [3.4, 7.1, -1.0, 2.9, 2.3], [0.6, 6.6, 3.2, 2.6, 2.1], [-0.8, 6.9, -3.2, 2.6, 2.1], [0.4, 10.9, -0.6, 2.5, 2.0], [-2.4, 9.4, -1.6, 2.2, 1.8], [2.2, 9.5, 1.8, 2.3, 1.9]];
  for (let i = 0; i < 6; i++) {
    const a = i * 1.1 + 0.3, r = 3.6 + (i % 2) * 0.8;
    bl.push([Math.cos(a) * r, 7.4 + (i % 3) * 1.4, Math.sin(a) * r, 1.5, 1.3]);
  }
  bl.forEach((b, i) => parts.push(blob([b[0], b[1], b[2]], [b[3], b[4], b[3]], detail, i + 11, 0x24441a, 0x6a8c2e, 0.34, 0.24)));
  return mergeGeometries(parts);
}
function birch(detail) {
  const parts = [trunk(9, 0.17, 0.07, 5, 0xd6d2c4, true)];
  parts.push(limb([0, 6, 0], [1.0, 8.6, 0.3], 0.07, 0.04, 0xd6d2c4), limb([0, 5.4, 0], [-0.9, 7.6, 0.2], 0.07, 0.04, 0xd6d2c4));
  const bl = [[0, 8.6, 0, 1.9, 2.4], [0.9, 10.6, 0.3, 1.5, 2.1], [-0.9, 6.9, 0.3, 1.6, 1.8], [0, 12.4, 0, 1.15, 1.5], [0.5, 9.2, -1.0, 1.3, 1.8], [-0.7, 10.0, 0.9, 1.2, 1.6]];
  bl.forEach((b, i) => parts.push(blob([b[0], b[1], b[2]], [b[3], b[4], b[3]], detail, i + 31, 0x3a6a1c, 0x95b648, 0.36, 0.34)));
  return mergeGeometries(parts);
}
function bush(detail) {
  const parts = [];
  [[0, 0.8, 0, 1.4, 0.9], [-1.1, 0.6, 0.5, 0.95, 0.65], [1.0, 0.6, -0.4, 1.0, 0.7], [0.2, 0.5, 1.2, 0.8, 0.55]].forEach((b, i) => parts.push(blob([b[0], b[1], b[2]], [b[3], b[4], b[3]], detail, i + 21, 0x2a4a14, 0x6a8a30, 0.32, 0.6)));
  return mergeGeometries(parts);
}

const SPECIES = [
  { name: 'poplar', build: poplar },
  { name: 'broad', build: broad },
  { name: 'bush', build: bush },
  { name: 'birch', build: birch },
];
const [POPLAR, BROAD, BUSH, BIRCH] = [0, 1, 2, 3];
const CAP_NEAR = 1200, CAP_FAR = 4500, CAP_ROW = 12000;
const NEAR_R = 380; // detailed crowns inside
const ROW_NEAR = 1500; // hedge segments whose middle is farther than this are drawn as cards
const ROW_FAR = 7600;
const PIECE = 50;

// row cards: two crossed vertical cards and a thin top, unit length PIECE, height 1
function rowGeometry() {
  const pos = [], uv = [], nrm = [], idx = [], kind = [];
  const quad = (p, uvs, n, k) => {
    const b = pos.length / 3;
    for (let i = 0; i < 4; i++) { pos.push(...p[i]); uv.push(...uvs[i]); nrm.push(...n); kind.push(k); }
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  };
  const h = PIECE / 2, y0 = -0.07;
  const card = (z, u0, k) => quad([[-h, y0, z], [h, y0, z], [h, 1, z], [-h, 1, z]], [[u0, 0], [u0 + 1, 0], [u0 + 1, 1], [u0, 1]], [0, 0.9, 0.3], k);
  card(-0.9, 0, 0);
  card(1.1, 0.41, 0);
  // top, a few metres wide, for views from above
  quad([[-h, 0.86, -2.2], [h, 0.86, -2.2], [h, 0.86, 2.2], [-h, 0.86, 2.2]], [[0, 0.5], [1, 0.5], [1, 0.5], [0, 0.5]], [0, 1, 0], 1);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('aKind', new THREE.Float32BufferAttribute(kind, 1));
  g.setIndex(idx);
  return g;
}

// ---------------------------------------------------------------- an era's own trees (terrain styles)
// An era's terrain style (eras/<id>.js `terrain.trees`, the WW2 era's in eras/ww2/terrain.js) names its
// species by form (FORMS below) with their instance caps, and plants them itself through a context
// (Trees.plantStyle); its far cards use their own silhouette texture (`rows`). Its meshes are built the first
// time the era is shown and hidden while another era is in play; the steppe's set above stays as it is.

// twigs: thin branching strokes, alpha the cover (about a third), red the brightness
function twigTexture() {
  const S = 128, d = new Uint8Array(S * S * 4);
  const rand = mulberry32(97);
  const dot = (x, y, v) => {
    const o = ((((Math.round(y) % S) + S) % S) * S + (((Math.round(x) % S) + S) % S)) * 4;
    d[o] = Math.max(d[o], v);
    d[o + 3] = 255;
  };
  const branch = (x, y, a, len, lvl) => {
    const v = 70 + rand() * 150;
    for (let t = 0; t < len; t += 0.5) dot(x + Math.cos(a) * t, y + Math.sin(a) * t, v);
    if (lvl <= 0) return;
    const ex = x + Math.cos(a) * len, ey = y + Math.sin(a) * len;
    branch(ex, ey, a + 0.35 + rand() * 0.5, len * 0.62, lvl - 1);
    branch(ex, ey, a - 0.35 - rand() * 0.5, len * 0.62, lvl - 1);
  };
  for (let n = 0; n < 70; n++) branch(rand() * S, rand() * S, rand() * Math.PI * 2, 12 + rand() * 10, 4);
  return dataTex(d, S, S);
}

// the far cards of a winter landscape: the lower half bare trees (four a piece), the upper half the edge of a
// pine wood (tall bare trunks under dark crowns); alpha the silhouette, red the brightness
function winterRowTexture() {
  const W = 512, H = 256, HH = H / 2, d = new Uint8Array(W * H * 4);
  const rand = mulberry32(1913);
  const put = (x, y, v) => {
    if (y < 0 || y >= H) return;
    const o = (Math.floor(y) * W + (((Math.floor(x) % W) + W) % W)) * 4;
    d[o] = Math.max(d[o], v);
    d[o + 3] = 255;
  };
  const stroke = (x0, y0, x1, y1, w, v, top) => {
    const L = Math.hypot(x1 - x0, y1 - y0), n = Math.max(1, Math.ceil(L * 2));
    for (let k = 0; k <= n; k++) {
      const t = k / n, x = x0 + (x1 - x0) * t, y = y0 + (y1 - y0) * t, r = w / 2;
      for (let b = -Math.ceil(r); b <= Math.ceil(r); b++) for (let a = -Math.ceil(r); a <= Math.ceil(r); a++) if (a * a + b * b <= r * r + 0.3 && y + b < top) put(x + a, y + b, v);
    }
  };
  // bare trees: a trunk forking into limbs, the limbs into twigs, held inside a rounded crown
  const tree = (cx, h, wmax) => {
    const grow = (x, y, a, len, w, lvl) => {
      const ex = x + Math.cos(a) * len, ey = y + Math.sin(a) * len;
      stroke(x, y, ex, ey, w, 60 + 50 * (1 - lvl / 5) + 40 * rand(), HH);
      if (lvl <= 0 || w < 0.5) return;
      const n = lvl > 3 ? 3 : 2;
      for (let k = 0; k < n; k++) {
        const spread = (k - (n - 1) / 2) * (0.5 + 0.3 * rand()) + (rand() - 0.5) * 0.3;
        // limbs reach up and out; twigs fan
        const na = a + spread, nx = ex + Math.cos(na) * len * 0.7;
        if (Math.abs(nx - cx) > wmax) continue;
        grow(ex, ey, na, len * (0.62 + 0.15 * rand()), w * 0.62, lvl - 1);
      }
    };
    const tl = h * 0.3;
    stroke(cx, 0, cx, tl, 3.2, 55, HH);
    grow(cx, tl, Math.PI / 2 + (rand() - 0.5) * 0.2, h * 0.22, 2.6, 5);
  };
  for (let k = 0; k < 4; k++) tree((k + 0.5 + (rand() - 0.5) * 0.3) * (W / 4), (0.7 + 0.28 * rand()) * HH, 0.4 * (W / 4));
  // a pine wood's edge: trunks, dark crowns in the top third, undergrowth at the foot
  for (let k = 0; k < 13; k++) {
    const x = (k + 0.5 + (rand() - 0.5) * 0.6) * (W / 13), h = (0.78 + 0.2 * rand()) * HH, c0 = h * (0.58 + 0.08 * rand());
    stroke(x, HH, x + (rand() - 0.5) * 2, HH + h, 2.2, 70 + 40 * rand(), H);
    for (let b = 0; b < 26; b++) {
      const y = HH + c0 + rand() * (h - c0), wy = (1 - Math.abs((y - HH - c0) / (h - c0) - 0.45) * 1.4) * 11 + 3;
      stroke(x - wy * (0.4 + 0.6 * rand()), y, x + wy * (0.4 + 0.6 * rand()), y + (rand() - 0.5) * 3, 3 + 3 * rand(), 40 + 60 * rand(), H);
    }
  }
  for (let x = 0; x < W; x += 1.5) {
    const h = 6 + 10 * rand();
    stroke(x, HH, x + (rand() - 0.5) * 4, HH + h, 1.5, 45 + 40 * rand(), H);
  }
  return dataTex(d, W, H, 8);
}

// two-tone trunk: c0 at the foot to c1 at the top (a pine's bark turns orange up the stem)
function trunk2(h, r0, r1, sides, c0, c1) {
  const g = new THREE.CylinderGeometry(r1, r0, h, sides, 3, true).toNonIndexed();
  g.deleteAttribute('uv');
  g.translate(0, h / 2, 0);
  const a = new THREE.Color(c0), b = new THREE.Color(c1);
  return paint(g, (c, y) => c.copy(a).lerp(b, THREE.MathUtils.smoothstep(y / h, 0.35, 0.9)));
}
// a bare crown's twigs: aLeaf over 10 selects the twig texture (10 + its tiling per metre)
const twigs = (c, r, detail, seed, lo, hi, freq) => blob(c, r, detail, seed, lo, hi, 0.34, 10 + freq);

// Scots pine of a plantation: a long clear stem, the crown in its top third in flat dark clumps
function pineW(detail) {
  const parts = [trunk2(16.6, 0.26, 0.08, 6, 0x45372d, 0x8f5a3a)];
  // the crown: flat clumps of uneven size round the top of the stem
  const rand = mulberry32(5101);
  const n = detail ? 8 : 5;
  for (let i = 0; i < n; i++) {
    const a = i * 2.39996 + rand() * 0.8, t = i / n;
    const r = (0.4 + 1.5 * Math.sqrt(1 - t) * (0.6 + 0.6 * rand())) * (i === 0 ? 0 : 1);
    const y = 12.6 + 4.6 * t + (rand() - 0.5) * 0.8;
    const s = (1.75 - 0.7 * t) * (0.75 + 0.5 * rand());
    parts.push(blob([Math.cos(a) * r * 1.15, y, Math.sin(a) * r * 1.15], [s * 1.1, s * (0.42 + 0.2 * rand()), s * (0.9 + 0.35 * rand())], detail, i + 51, 0x0d160c, 0x2b3d24, 0.55, 0.62));
    if (detail && i > 0 && i % 2) parts.push(limb([0, y - 0.6, 0], [Math.cos(a) * r * 0.9, y - 0.2, Math.sin(a) * r * 0.9], 0.07, 0.04, 0x7a4c33));
  }
  return mergeGeometries(parts);
}
// a pine grown in the open (the heath's): a short crooked stem and a broad, ragged crown from half its height
function pineOpenW(detail) {
  const parts = [trunk2(5.2, 0.3, 0.16, 6, 0x45372d, 0x8a5838)];
  const rand = mulberry32(5303);
  const n = detail ? 8 : 5;
  for (let i = 0; i < n; i++) {
    const a = i * 2.39996 + rand(), t = i / n;
    const r = (0.6 + 2.6 * (1 - t) * (0.5 + 0.6 * rand())) * (i === 0 ? 0.3 : 1);
    const y = 5.2 + 4.2 * t + (rand() - 0.5);
    const s = (1.9 - 0.6 * t) * (0.75 + 0.5 * rand());
    if (detail && i) parts.push(limb([0, 3.8 + t * 3, 0], [Math.cos(a) * r * 0.9, y - 0.3, Math.sin(a) * r * 0.9], 0.11, 0.05, 0x6a4430));
    parts.push(blob([Math.cos(a) * r, y, Math.sin(a) * r], [s * 1.15, s * (0.45 + 0.2 * rand()), s], detail, i + 151, 0x0d160c, 0x2b3d24, 0.55, 0.62));
  }
  return mergeGeometries(parts);
}
// a bare oak: a short heavy bole, spreading limbs, the twigs in a rounded crown
function oakW(detail) {
  const bark = 0x39332c;
  const parts = [trunk(4.0, 0.46, 0.32, 7, bark)];
  const tips = [[-2.8, 7.6, 1.0], [3.0, 7.3, -1.1], [0.6, 8.4, 2.9], [-1.0, 8.6, -2.8], [0.3, 9.6, 0.2]];
  tips.forEach((t, i) => {
    parts.push(limb([0, 3.7, 0], t, 0.27, 0.13, bark));
    if (detail) {
      const o = [t[0] * 0.45 + (i % 2 ? 0.9 : -0.9), 1.6 + 0.3 * i, t[2] * 0.45 + (i % 3 ? 0.7 : -0.7)];
      parts.push(limb(t, [t[0] + o[0], t[1] + o[1], t[2] + o[2]], 0.12, 0.05, bark), limb(t, [t[0] * 1.35, t[1] + 1.2, t[2] * 1.35 + 0.5], 0.1, 0.04, bark));
    }
  });
  const bl = [[0, 8.4, 0, 4.6, 3.3], [-2.6, 7.6, 1.0, 2.6, 2.2], [2.8, 7.4, -1.0, 2.6, 2.2], [0.3, 10.4, -0.2, 3.0, 2.0]];
  bl.forEach((b, i) => parts.push(twigs([b[0], b[1], b[2]], [b[3], b[4], b[3]], detail, i + 61, 0x4a4038, 0x857565, 0.3)));
  return mergeGeometries(parts);
}
// a bare birch: the white stem, thin upswept limbs, a tall purple-brown haze of twigs
function birchW(detail) {
  const parts = [trunk(10.5, 0.18, 0.06, 5, 0xd2cec2, true)];
  parts.push(limb([0, 5.4, 0], [1.1, 9.4, 0.3], 0.07, 0.03, 0xc8c2b4), limb([0, 6.2, 0], [-1.0, 10.0, -0.3], 0.07, 0.03, 0xc8c2b4), limb([0, 7.0, 0], [0.2, 11.0, 1.0], 0.06, 0.03, 0xc8c2b4));
  const bl = [[0, 9.6, 0, 2.2, 3.7], [0.5, 12.2, 0.2, 1.5, 2.3], [-0.5, 7.6, 0.3, 1.8, 2.0]];
  bl.forEach((b, i) => parts.push(twigs([b[0], b[1], b[2]], [b[3], b[4], b[3]], detail, i + 71, 0x33262a, 0x5c4441, 0.42)));
  return mergeGeometries(parts);
}
// a bare shrub of a hedgebank (hazel, blackthorn, hawthorn): stems from the ground into a twiggy mass
function shrubW(detail) {
  const parts = [];
  for (let k = 0; k < (detail ? 5 : 3); k++) {
    const a = k * 1.3 + 0.4;
    parts.push(limb([Math.cos(a) * 0.3, 0, Math.sin(a) * 0.3], [Math.cos(a) * 1.3, 2.6 + 0.3 * k, Math.sin(a) * 1.3], 0.06, 0.03, 0x3e352c));
  }
  const bl = [[0, 1.9, 0, 2.0, 1.5], [-1.2, 1.4, 0.6, 1.3, 1.1], [1.1, 1.5, -0.5, 1.4, 1.1], [0.2, 2.9, 0.1, 1.2, 0.9]];
  bl.forEach((b, i) => parts.push(twigs([b[0], b[1], b[2]], [b[3], b[4], b[3]], detail, i + 81, 0x4a4036, 0x7a6a5a, 0.6)));
  return mergeGeometries(parts);
}
// a juniper of the heath: a dark green column
function juniperW(detail) {
  const parts = [];
  [[0, 1.2, 0, 0.75, 1.4], [0.1, 2.5, 0.05, 0.6, 1.3], [0, 3.6, 0, 0.38, 0.9]].forEach((b, i) => parts.push(blob([b[0], b[1], b[2]], [b[3], b[4], b[3]], detail, i + 91, 0x121c0d, 0x2a3a1d, 0.3, 0.9)));
  return mergeGeometries(parts);
}

// Buildings as unit boxes under a gable roof (the instance scale gives width, height to the ridge, length):
// walls to `eave` of the height, the roof's ridge along the length
function gableHouse(eave, wall, wallLow, roof, overhang = 0.04) {
  const pos = [], col = [];
  const cw = new THREE.Color(wall), cl = new THREE.Color(wallLow), cr = new THREE.Color(roof);
  const tri = (a, b, c, ca, cb, cc) => { pos.push(...a, ...b, ...c); col.push(ca.r, ca.g, ca.b, cb.r, cb.g, cb.b, cc.r, cc.g, cc.b); };
  const quad = (a, b, c, d, ca, cb) => { tri(a, b, c, ca, ca, cb); tri(a, c, d, ca, cb, cb); };
  const h = 0.5, e = eave;
  // walls (bottom colour darker), counter-clockwise from outside
  quad([-h, 0, h], [h, 0, h], [h, e, h], [-h, e, h], cl, cw);
  quad([h, 0, -h], [-h, 0, -h], [-h, e, -h], [h, e, -h], cl, cw);
  quad([h, 0, h], [h, 0, -h], [h, e, -h], [h, e, h], cl, cw);
  quad([-h, 0, -h], [-h, 0, h], [-h, e, h], [-h, e, -h], cl, cw);
  // gable ends
  tri([-h, e, h], [h, e, h], [0, 1, h], cw, cw, cw);
  tri([h, e, -h], [-h, e, -h], [0, 1, -h], cw, cw, cw);
  // roof planes, overhanging the walls a little
  const o = overhang, rl = e - o * (1 - e) / h;
  const dk = cr.clone().multiplyScalar(0.8);
  quad([h + o, rl, h + o], [h + o, rl, -h - o], [0, 1, -h - o], [0, 1, h + o], dk, cr);
  quad([-h - o, rl, -h - o], [-h - o, rl, h + o], [0, 1, h + o], [0, 1, -h - o], dk, cr);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}
// a village church: nave under a steep roof and a west tower with a spire (metres; scaled for a town's)
function churchW() {
  const nave = gableHouse(0.55, 0x8a7a68, 0x5a4c40, 0x3e2a24, 0.02);
  nave.scale(12, 17, 26);
  const tower = new THREE.BoxGeometry(7, 26, 7).toNonIndexed();
  tower.deleteAttribute('uv');
  tower.translate(0, 13, -15.5);
  const spire = new THREE.ConeGeometry(4.6, 15, 4, 1).toNonIndexed();
  spire.deleteAttribute('uv');
  spire.rotateY(Math.PI / 4);
  spire.translate(0, 33.5, -15.5);
  const stone = new THREE.Color(0x857564), slate = new THREE.Color(0x2e3234);
  for (const [gg, c] of [[tower, stone], [spire, slate]]) {
    const n = gg.attributes.position.count, a = new Float32Array(n * 3);
    for (let k = 0; k < n; k++) { a[k * 3] = c.r; a[k * 3 + 1] = c.g; a[k * 3 + 2] = c.b; }
    gg.setAttribute('color', new THREE.BufferAttribute(a, 3));
    gg.deleteAttribute('normal');
  }
  nave.deleteAttribute('normal');
  const g = mergeGeometries([nave, tower, spire]);
  g.computeVertexNormals();
  return g;
}
const FORMS = {
  pine: { build: pineW, tree: true },
  oak: { build: oakW, tree: true },
  birch: { build: birchW, tree: true },
  shrub: { build: shrubW, tree: true },
  juniper: { build: juniperW, tree: true },
  pineOpen: { build: pineOpenW, tree: true },
  // a Hallenhaus: brick walls under a tiled roof; a barn: boarded walls under thatch
  house: { build: () => gableHouse(0.3, 0x8a5240, 0x5a3628, 0x4a2a24) },
  barn: { build: () => gableHouse(0.28, 0x5e4c3a, 0x40332a, 0x625440) },
  church: { build: churchW },
};

// the tree material of an era's set: as the steppe's, with the twig texture on crowns marked aLeaf > 10, and
// bare crowns kept open further out (a winter tree is mostly air)
function styleTreeMaterial(leafTex, twigTex, key) {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0, side: THREE.DoubleSide });
  mat.defines = { SKIP_WET: '' };
  patchMaterial(mat, key, (shader) => {
    shader.uniforms.uLeaf = { value: leafTex };
    shader.uniforms.uTwig = { value: twigTex };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aLeaf;\nvarying float vLeaf;\nvarying vec3 vLP;\nvarying vec3 vLN;\nuniform float uTime;\nuniform float uWindStrength;')
      .replace(
        '#include <begin_vertex>',
        /* glsl */ `
        #include <begin_vertex>
        vLeaf = aLeaf;
        vLP = position;
        vLN = normal;
        {
          float hN = clamp(position.y / 16.0, 0.0, 1.0);
          vec3 ip = vec3(instanceMatrix[3]);
          float ph = uTime * 1.5 + ip.x * 0.11 + ip.z * 0.13;
          float w = 0.4 + uWindStrength;
          transformed.x += sin(ph) * 0.3 * hN * hN * w;
          transformed.z += cos(ph * 0.83) * 0.22 * hN * hN * w;
        }
        `
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying float vLeaf;\nvarying vec3 vLP;\nvarying vec3 vLN;\nuniform sampler2D uLeaf;\nuniform sampler2D uTwig;\n${noiseGLSL}`)
      .replace(
        '#include <color_fragment>',
        /* glsl */ `
        #include <color_fragment>
        {
          #ifdef USE_FOG
          float dd = length(vFogWorldPos - cameraPosition);
          #else
          float dd = 100.0;
          #endif
          if (vLeaf > 0.0) {
            vec3 nw = pow(abs(normalize(vLN)), vec3(3.0));
            nw /= nw.x + nw.y + nw.z;
            bool twig = vLeaf > 10.0;
            float sc = twig ? vLeaf - 10.0 : vLeaf;
            vec4 t;
            if (twig) t = texture2D(uTwig, vLP.zy * sc + 0.13) * nw.x + texture2D(uTwig, vLP.xy * sc + 0.57) * nw.z + texture2D(uTwig, vLP.xz * sc + 0.31) * nw.y;
            else t = texture2D(uLeaf, vLP.zy * sc + 0.13) * nw.x + texture2D(uLeaf, vLP.xy * sc + 0.57) * nw.z + texture2D(uLeaf, vLP.xz * sc + 0.31) * nw.y;
            // twigs: kept in proportion to their cover (a dithered haze where the mip chain has blurred them),
            // so a bare crown stays see-through at any distance; leaves and needles as the steppe's trees
            float ign = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
            if (twig ? t.a * 0.85 < ign : t.a < 0.46 * (1.0 - smoothstep(40.0, 160.0, dd))) discard;
            diffuseColor.rgb *= twig ? 0.75 + 0.5 * t.r : 0.45 + 0.9 * t.r;
            if (!gl_FrontFacing) diffuseColor.rgb *= twig ? 0.8 : 0.55;
          } else if (!gl_FrontFacing) diffuseColor.rgb *= 0.55;
          #ifdef USE_FOG
          diffuseColor.rgb *= 0.75 + 0.5 * vnoise(vFogWorldPos.xz * 1.9 + vFogWorldPos.y * 2.3);
          #endif
        }
        `
      );
  });
  return mat;
}

export class Trees {
  constructor(terrain) {
    this.terrain = terrain;
    this.group = new THREE.Group();
    this.group.name = 'trees';
    this.density = 1;
    this.shadows = true; // the detailed trees cast shadows (setShadows)
    this.R = 2000; // individual trees (hedge segments nearer than ROW_NEAR, groves, willows)
    this.center = new THREE.Vector2(1e9, 1e9);
    this.dirty = true;
    this.leafTex = leafTexture();
    this.rowTex = rowTexture();

    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, metalness: 0, side: THREE.DoubleSide });
    mat.defines = { SKIP_WET: '' };
    patchMaterial(mat, 'trees-iads-2', (shader) => {
      shader.uniforms.uLeaf = { value: this.leafTex };
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aLeaf;\nvarying float vLeaf;\nvarying vec3 vLP;\nvarying vec3 vLN;\nuniform float uTime;\nuniform float uWindStrength;')
        .replace(
          '#include <begin_vertex>',
          /* glsl */ `
          #include <begin_vertex>
          vLeaf = aLeaf;
          vLP = position;
          vLN = normal;
          {
            float hN = clamp(position.y / 16.0, 0.0, 1.0);
            vec3 ip = vec3(instanceMatrix[3]);
            float ph = uTime * 1.5 + ip.x * 0.11 + ip.z * 0.13;
            float w = 0.4 + uWindStrength;
            transformed.x += sin(ph) * 0.4 * hN * hN * w;
            transformed.z += cos(ph * 0.83) * 0.3 * hN * hN * w;
            // leaf shimmer, crowns only
            float fl = sin(uTime * 3.1 + dot(position, vec3(2.3, 1.7, 2.9)) + ip.x * 0.3) * min(aLeaf, 1.0);
            transformed += normal * fl * 0.07 * (0.3 + w * 0.6) * (0.4 + hN);
          }
          `
        );
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\nvarying float vLeaf;\nvarying vec3 vLP;\nvarying vec3 vLN;\nuniform sampler2D uLeaf;\n${noiseGLSL}`)
        .replace(
          '#include <color_fragment>',
          /* glsl */ `
          #include <color_fragment>
          {
            #ifdef USE_FOG
            float dd = length(vFogWorldPos - cameraPosition);
            #else
            float dd = 100.0;
            #endif
            if (vLeaf > 0.0) {
              vec3 nw = pow(abs(normalize(vLN)), vec3(3.0));
              nw /= nw.x + nw.y + nw.z;
              float sc = vLeaf;
              vec4 t = texture2D(uLeaf, vLP.zy * sc + 0.13) * nw.x + texture2D(uLeaf, vLP.xy * sc + 0.57) * nw.z + texture2D(uLeaf, vLP.xz * sc + 0.31) * nw.y;
              // leaf-shaped gaps near the camera, a solid crown beyond
              if (t.a < 0.46 * (1.0 - smoothstep(40.0, 160.0, dd))) discard;
              diffuseColor.rgb *= 0.45 + 0.9 * t.r;
            }
            if (!gl_FrontFacing) diffuseColor.rgb *= 0.55;
            #ifdef USE_FOG
            diffuseColor.rgb *= 0.7 + 0.6 * vnoise(vFogWorldPos.xz * 1.9 + vFogWorldPos.y * 2.3);
            #endif
          }
          `
        )
        .replace(
          '#include <emissivemap_fragment>',
          /* glsl */ `
          #include <emissivemap_fragment>
          #ifdef USE_FOG
          if (vLeaf > 0.0) {
            // light through the leaves when looking toward the sun
            vec3 vdW = normalize(vFogWorldPos - cameraPosition);
            totalEmissiveRadiance += uSunColorN * diffuseColor.rgb * 0.3 * pow(max(dot(vdW, uSunDirW), 0.0), 3.0) * worldShadowFactor(vFogWorldPos);
          }
          #endif
          `
        );
    });
    this.material = mat;

    const rowMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, metalness: 0, side: THREE.DoubleSide });
    rowMat.defines = { SKIP_WET: '' };
    patchMaterial(rowMat, 'tree-rows-iads', this.rowPatch(this.rowTex));
    this.rowMaterial = rowMat;

    this.meshes = SPECIES.map((sp) => {
      const near = new THREE.InstancedMesh(sp.build(1), mat, CAP_NEAR);
      const far = new THREE.InstancedMesh(sp.build(0), mat, CAP_FAR);
      for (const m of [near, far]) {
        m.count = 0;
        m.frustumCulled = false;
        m.receiveShadow = true;
        m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        m.setColorAt(0, new THREE.Color(1, 1, 1));
        m.instanceColor.setUsage(THREE.DynamicDrawUsage);
        m.name = `trees-${sp.name}`;
        this.group.add(m);
      }
      near.castShadow = true;
      return { near, far };
    });

    const rg = rowGeometry();
    this.rowAttr = new THREE.InstancedBufferAttribute(new Float32Array(CAP_ROW * 2), 2).setUsage(THREE.DynamicDrawUsage);
    rg.setAttribute('aRow', this.rowAttr);
    this.rows = new THREE.InstancedMesh(rg, rowMat, CAP_ROW);
    this.rows.count = 0;
    this.rows.frustumCulled = false;
    this.rows.receiveShadow = false;
    this.rows.castShadow = false;
    this.rows.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.rows.setColorAt(0, new THREE.Color(1, 1, 1));
    this.rows.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.rows.name = 'tree-rows';
    this.group.add(this.rows);

    this._o = new THREE.Object3D();
    this._c = new THREE.Color();
  }

  // the far cards' shader patch, sampling silhouette texture `tex`
  rowPatch(tex) {
    return (shader) => {
      shader.uniforms.uRowTex = { value: tex };
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec2 aRow;\nattribute float aKind;\nvarying vec2 vRowUv;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRowUv = vec2(uv.x + aRow.x, uv.y * 0.5 + aRow.y * 0.5);');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\nvarying vec2 vRowUv;\nuniform sampler2D uRowTex;\n${noiseGLSL}`)
        .replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\nnormal = normalize(vNormal);')
        .replace(
          '#include <color_fragment>',
          /* glsl */ `
          #include <color_fragment>
          {
            vec4 rt = texture2D(uRowTex, vRowUv);
            #ifdef USE_FOG
            float dd = length(vFogWorldPos - cameraPosition);
            #else
            float dd = 1000.0;
            #endif
            // the silhouettes thin with the mip chain; keep the row readable at a distance
            if (rt.a < mix(0.5, 0.2, smoothstep(300.0, 2500.0, dd))) discard;
            diffuseColor.rgb *= 0.4 + 0.85 * rt.r;
            #ifdef USE_FOG
            diffuseColor.rgb *= 0.75 + 0.5 * vnoise(vFogWorldPos.xz * 0.35);
            #endif
          }
          `
        );
    };
  }

  setDensity(d) {
    this.density = d;
    this.dirty = true;
  }

  // the detailed trees' shadows (the buildings among them keep theirs)
  setShadows(on) {
    this.shadows = on;
    for (const { near } of this.meshes) near.castShadow = on;
    for (const set of this.sets?.values() ?? []) for (const m of set.meshes) if (!m.single) m.near.castShadow = on;
  }

  /**
   * Plant an era's own trees (its terrain style, `S.trees`), or the steppe's again with null. The era's
   * meshes are built once, the first time, and only one set is shown.
   */
  setStyle(S) {
    const T = S?.trees ?? null;
    if (T === (this.styleSet?.def ?? null)) return;
    for (const { near, far } of this.meshes) near.visible = far.visible = !T;
    this.rows.visible = !T;
    this.sets ??= new Map();
    for (const set of this.sets.values()) set.group.visible = false;
    this.styleSet = null;
    this.job = null;
    this.terrainStyle = S;
    if (T) {
      if (!this.sets.has(T)) this.sets.set(T, this.buildSet(T, S.id));
      this.styleSet = this.sets.get(T);
      this.styleSet.group.visible = true;
    }
    this.dirty = true;
  }

  buildSet(T, id) {
    const group = new THREE.Group();
    group.name = `trees-${id}`;
    this.group.add(group);
    this.twigTex ??= twigTexture();
    const mat = styleTreeMaterial(this.leafTex, this.twigTex, `trees-${id}`);
    const houseMat = patchMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, metalness: 0 }), 'fog');
    const meshes = T.species.map((sp) => {
      const form = FORMS[sp.form];
      const mk = (geo, cap, m, name) => {
        const im = new THREE.InstancedMesh(geo, m, cap);
        im.count = 0;
        im.frustumCulled = false;
        im.receiveShadow = true;
        im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        im.setColorAt(0, new THREE.Color(1, 1, 1));
        im.instanceColor.setUsage(THREE.DynamicDrawUsage);
        im.name = name;
        group.add(im);
        return im;
      };
      if (form.tree) {
        const near = mk(form.build(1), sp.cap[0], mat, `trees-${sp.name}`), far = mk(form.build(0), sp.cap[1], mat, `trees-${sp.name}-far`);
        near.castShadow = this.shadows;
        // `near`: the radius of the detailed level (a wood's many pines switch sooner)
        return { near, far, caps: sp.cap, nearR2: (sp.near ?? NEAR_R) ** 2 };
      }
      const one = mk(form.build(), sp.cap[0], houseMat, `buildings-${sp.name}`);
      one.castShadow = true;
      return { near: one, far: one, caps: [sp.cap[0], 0], single: true };
    });
    // the far cards, with this landscape's silhouettes
    const rowTex = T.rows === 'winter' ? winterRowTexture() : this.rowTex;
    const rowMat = this.rowMaterial.clone();
    const base = this.rowPatch(rowTex);
    patchMaterial(rowMat, `tree-rows-${id}`, !T.rowsFromAbove ? base : (shader) => {
      base(shader);
      // seen steeply from above a card shows its trunks and gaps, not a canopy: it gives way (dithered) to
      // the ground, which paints the woods' canopy from afar
      shader.fragmentShader = shader.fragmentShader.replace(
        'if (rt.a < mix(0.5, 0.2, smoothstep(300.0, 2500.0, dd))) discard;',
        `if (rt.a < mix(0.5, 0.2, smoothstep(300.0, 2500.0, dd))) discard;
            #ifdef USE_FOG
            {
              float down = normalize(cameraPosition - vFogWorldPos).y;
              float ign = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
              if (smoothstep(0.3, 0.62, down) > ign) discard;
            }
            #endif`
      );
    });
    const rg = rowGeometry();
    const cap = T.rowCap ?? 26000;
    const rowAttr = new THREE.InstancedBufferAttribute(new Float32Array(cap * 2), 2).setUsage(THREE.DynamicDrawUsage);
    rg.setAttribute('aRow', rowAttr);
    const rows = new THREE.InstancedMesh(rg, rowMat, cap);
    rows.count = 0;
    rows.frustumCulled = false;
    rows.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    rows.setColorAt(0, new THREE.Color(1, 1, 1));
    rows.instanceColor.setUsage(THREE.DynamicDrawUsage);
    rows.name = `tree-rows-${id}`;
    group.add(rows);
    return { def: T, group, meshes, rows, rowAttr, rowCap: cap };
  }

  // An era's set replants in pieces, a few milliseconds a frame (its planter is a generator), and shows the
  // new planting once it is complete; forced (a relayout, the first frame) it plants at once.
  updateStyle(camera, force) {
    const p = camera.position;
    if (this.job && !force) {
      const t0 = performance.now();
      while (performance.now() - t0 < 4) if (this.job.next().done) { this.job = null; break; }
      return;
    }
    if (!force && !this.dirty && Math.hypot(p.x - this.center.x, p.z - this.center.y) < 110) return;
    this.dirty = false;
    this.center.set(p.x, p.z);
    this.job = this.plantJob(p.x, p.z);
    if (force) this.plantStyle();
  }

  // runs the planting job (a new one at cx, cz if given) to its end
  plantStyle(cx, cz) {
    if (cx !== undefined) this.job = this.plantJob(cx, cz);
    while (this.job && !this.job.next().done);
    this.job = null;
  }

  // Plants an era's set: its planter (S.trees.plant) places everything through these helpers, which keep
  // trees off the pads and the water, pick the level of detail and fill the instance buffers (uploaded
  // when the job ends, so the old planting stays on screen meanwhile).
  *plantJob(cx, cz) {
    const set = this.styleSet, S = this.terrainStyle;
    const R2 = this.R * this.R, RF2 = ROW_FAR * ROW_FAR;
    // the 100 m cells any pad reaches, so most points skip padMask
    const padCells = new Set();
    for (const p of flatPads()) {
      const r = Math.hypot(p.rx, p.rz) + p.blend;
      for (let j = Math.floor((p.z - r) / 100); j <= Math.floor((p.z + r) / 100); j++) for (let i = Math.floor((p.x - r) / 100); i <= Math.floor((p.x + r) / 100); i++) padCells.add(i * 65536 + j);
    }
    const onPad = (x, z, lim) => padCells.has(Math.floor(x / 100) * 65536 + Math.floor(z / 100)) && padMask(x, z) > lim;
    const o = this._o, col = this._c;
    const counts = set.meshes.map(() => [0, 0]);
    let rows = 0;
    const ra = set.rowAttr.array, rm = set.rows, rowColors = set.def.rowColors ?? [];
    const ctx = {
      cx, cz, R: this.R, near: ROW_NEAR, woodR: 650, far: ROW_FAR, dens: this.density,
      put: (x, z, sp, scale, tint) => {
        const dx = x - cx, dz = z - cz, d2 = dx * dx + dz * dz;
        if (d2 > R2) return false;
        const m = set.meshes[sp], lod = d2 < m.nearR2 ? 0 : 1, cnt = counts[sp];
        if (cnt[lod] >= m.caps[lod]) return false;
        if (onPad(x, z, 0.04) || S.bankAt(x, z) > 0.45) return false;
        const w = 0.88 + 0.24 * rnd(x, z, 74), hh = 0.92 + 0.16 * rnd(x, z, 78);
        o.position.set(x, heightAt(x, z) - 0.15, z);
        o.rotation.set(0, rnd(x, z, 73) * 6.283, 0);
        o.scale.set(scale * w, scale * hh, scale * (0.9 + 0.2 * rnd(x, z, 79)));
        o.updateMatrix();
        const mesh = lod ? m.far : m.near;
        mesh.setMatrixAt(cnt[lod], o.matrix);
        const l = tint * (0.78 + 0.4 * rnd(x, z, 75)), warm = rnd(x, z, 76);
        col.setRGB(l * (0.92 + 0.22 * warm), l * (0.95 + 0.1 * rnd(x, z, 77)), l * (1.04 - 0.22 * warm));
        mesh.setColorAt(cnt[lod], col);
        cnt[lod]++;
        return true;
      },
      house: (x, z, sp, rot, wdt, hgt, len, tint, far = false) => {
        const dx = x - cx, dz = z - cz, d2 = dx * dx + dz * dz;
        if (d2 > (far ? RF2 : R2)) return false;
        const m = set.meshes[sp], cnt = counts[sp];
        if (cnt[0] >= m.caps[0]) return false;
        if (onPad(x, z, 0.02) || S.bankAt(x, z) > 0.3) return false;
        // on the lowest of its corners, sunk a little into the slope
        const c = Math.cos(rot), s = Math.sin(rot), hx = wdt * 0.5, hz = len * 0.5;
        let y = heightAt(x, z);
        for (const [a, b] of [[-hx, -hz], [hx, -hz], [hx, hz], [-hx, hz]]) y = Math.min(y, heightAt(x + a * c + b * s, z - a * s + b * c));
        o.position.set(x, y - 0.2, z);
        o.rotation.set(0, rot, 0);
        o.scale.set(wdt, hgt, len);
        o.updateMatrix();
        m.near.setMatrixAt(cnt[0], o.matrix);
        col.setRGB(tint, tint * (0.96 + 0.08 * rnd(x, z, 77)), tint * (0.92 + 0.12 * rnd(x, z, 76)));
        m.near.setColorAt(cnt[0], col);
        cnt[0]++;
        return true;
      },
      // cards along a line, in pieces of about PIECE m; keep(x, z) may refuse a piece
      row: (x0, z0, x1, z1, kind, hgt, tint, keep = null) => {
        const dx = x1 - x0, dz = z1 - z0, len = Math.hypot(dx, dz);
        if (len < 4) return;
        const nP = Math.max(1, Math.round(len / PIECE)), lp = len / nP, ang = -Math.atan2(dz, dx);
        for (let k = 0; k < nP; k++) {
          if (rows >= set.rowCap) return;
          const t = (k + 0.5) / nP, x = x0 + dx * t, z = z0 + dz * t;
          const px = x - cx, pz = z - cz;
          if (px * px + pz * pz > RF2) continue;
          if (onPad(x, z, 0.04) || S.bankAt(x, z) > 0.45 || (keep && !keep(x, z))) continue;
          const r1 = ihash(Math.floor(x), Math.floor(z), 97), r2 = ihash(Math.floor(x), Math.floor(z), 98);
          o.position.set(x, heightAt(x, z) - 0.1, z);
          o.rotation.set(0, ang, 0);
          o.scale.set(lp / PIECE, hgt * (0.88 + 0.24 * r1) * (0.85 + 0.15 * this.density), 1);
          o.updateMatrix();
          rm.setMatrixAt(rows, o.matrix);
          const l = tint * (0.8 + 0.35 * r2), rc = rowColors[kind] ?? [1, 1, 1];
          col.setRGB(rc[0] * l * (0.94 + 0.12 * r1), rc[1] * l, rc[2] * l * (1.02 - 0.1 * r1));
          rm.setColorAt(rows, col);
          ra[rows * 2] = r2;
          ra[rows * 2 + 1] = kind;
          rows++;
        }
      },
    };
    yield* S.trees.plant(ctx, ERA.layout);
    set.meshes.forEach((m, i) => {
      m.near.count = counts[i][0];
      if (!m.single) m.far.count = counts[i][1];
      for (const mesh of m.single ? [m.near] : [m.near, m.far]) {
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      }
    });
    rm.count = rows;
    rm.instanceMatrix.needsUpdate = true;
    rm.instanceColor.needsUpdate = true;
    set.rowAttr.needsUpdate = true;
    this.counts = counts;
    this.rowCount = rows;
  }

  update(camera, force = false) {
    if (this.styleSet) return this.updateStyle(camera, force);
    const p = camera.position;
    if (!force && !this.dirty && Math.hypot(p.x - this.center.x, p.z - this.center.y) < 110) return;
    this.dirty = false;
    this.center.set(p.x, p.z);
    this.plant(p.x, p.z);
  }

  plant(cx, cz) {
    if (this.styleSet) return this.plantStyle(cx, cz);
    const R = this.R, R2 = R * R;
    const counts = this.meshes.map(() => [0, 0]);
    const o = this._o, col = this._c;
    const put = (x, z, sp, scale, tint) => {
      const dx = x - cx, dz = z - cz, d2 = dx * dx + dz * dz;
      if (d2 > R2) return;
      if (padMask(x, z) > 0.04) return;
      if (Math.abs(z - riverCenterZ(x)) < 38) return;
      const near = d2 < NEAR_R * NEAR_R ? 0 : 1;
      const m = this.meshes[sp][near ? 'far' : 'near'];
      const cnt = counts[sp];
      if (cnt[near] >= (near ? CAP_FAR : CAP_NEAR)) return;
      const w = 0.88 + 0.24 * rnd(x, z, 74), hh = 0.92 + 0.16 * rnd(x, z, 78);
      o.position.set(x, heightAt(x, z) - 0.15, z);
      o.rotation.set(0, rnd(x, z, 73) * 6.283, 0);
      o.scale.set(scale * w, scale * hh, scale * (0.9 + 0.2 * rnd(x, z, 79)));
      o.updateMatrix();
      m.setMatrixAt(cnt[near], o.matrix);
      // tint: a wide spread of lightness and some trees yellower or bluer (leaf age, species mix)
      const l = tint * (0.78 + 0.4 * rnd(x, z, 75)), warm = rnd(x, z, 76);
      col.setRGB(l * (0.9 + 0.3 * warm), l * (0.95 + 0.1 * rnd(x, z, 77)), l * (1.05 - 0.3 * warm));
      m.setColorAt(cnt[near], col);
      cnt[near]++;
    };

    // windbreaks along the hedge lines: nearer ones as individual trees, farther ones as cards
    const dens = this.density;
    let rows = 0;
    const rm = this.rows, ra = this.rowAttr.array;
    const RN2 = ROW_NEAR * ROW_NEAR, RF2 = ROW_FAR * ROW_FAR;
    for (const s of hedgeSegments(cx, cz, ROW_FAR)) {
      const dx = s.x1 - s.x0, dz = s.z1 - s.z0, len = Math.hypot(dx, dz);
      const sx = dx / len, sz = dz / len;
      const seed = Math.floor(s.x0 + s.z0 * 3.7);
      // a row is mostly one kind: poplars, elms or birches, with a few of the others
      const kr = ihash(seed, 3, 83);
      const rowKind = kr < 0.5 ? POPLAR : kr < 0.8 ? BROAD : BIRCH;
      const mx = (s.x0 + s.x1) / 2 - cx, mz = (s.z0 + s.z1) / 2 - cz, md = mx * mx + mz * mz;
      if (md > RN2) {
        // cards: 50 m pieces along the row
        const nP = Math.max(1, Math.round(len / PIECE)), lp = len / nP;
        const ang = -Math.atan2(dz, dx);
        for (let k = 0; k < nP; k++) {
          const t = (k + 0.5) * lp;
          const x = s.x0 + sx * t, z = s.z0 + sz * t;
          const px = x - cx, pz = z - cz;
          if (px * px + pz * pz > RF2 || rows >= CAP_ROW) continue;
          if (padMask(x, z) > 0.04 || Math.abs(z - riverCenterZ(x)) < 38) continue;
          const r1 = ihash(Math.floor(x), Math.floor(z), 97), r2 = ihash(Math.floor(x), Math.floor(z), 98);
          const round = rowKind !== POPLAR;
          const hgt = (round ? 9.5 + 3.5 * r1 : 13 + 5 * r1) * (0.85 + 0.15 * dens);
          o.position.set(x, heightAt(x, z) - 0.1, z);
          o.rotation.set(0, ang, 0);
          o.scale.set(lp / PIECE, hgt, 1);
          o.updateMatrix();
          rm.setMatrixAt(rows, o.matrix);
          const l = (rowKind === BIRCH ? 1.15 : 0.95) * (0.78 + 0.4 * r2);
          col.setRGB(l * (0.9 + 0.3 * r1), l, l * (1.05 - 0.3 * r1));
          rm.setColorAt(rows, col);
          ra[rows * 2] = r2;
          ra[rows * 2 + 1] = round ? 0 : 1;
          rows++;
        }
        continue;
      }
      // along the row, ~8 m apart with jitter
      for (let t = 2; t < len - 2; ) {
        const r = ihash(Math.floor(s.x0 + sx * t), Math.floor(s.z0 + sz * t), 79);
        t += (6.5 + 3.5 * r) / Math.max(0.5, dens);
        const x = s.x0 + sx * t + sz * (r - 0.5) * 4, z = s.z0 + sz * t - sx * (r - 0.5) * 4;
        const pick = rnd(x, z, 81);
        const other = pick < 0.88 ? BROAD : pick < 0.95 ? BIRCH : POPLAR;
        const sp = pick < 0.08 ? BUSH : pick < 0.78 ? rowKind : other;
        const sc = sp === POPLAR ? 0.8 + 0.5 * rnd(x, z, 85) : sp === BUSH ? 1 + 0.6 * rnd(x, z, 85) : 0.7 + 0.5 * rnd(x, z, 85);
        put(x, z, sp, sc, 0.9);
      }
    }
    rm.count = rows;
    rm.instanceMatrix.needsUpdate = true;
    rm.instanceColor.needsUpdate = true;
    this.rowAttr.needsUpdate = true;

    // groves and lone trees on a 160 m cell grid
    const C = 160;
    const i0 = Math.floor((cx - R) / C), i1 = Math.floor((cx + R) / C), j0 = Math.floor((cz - R) / C), j1 = Math.floor((cz + R) / C);
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const h = ihash(i, j, 91);
        if (h > 0.035 * dens) continue;
        const gx = (i + ihash(i, j, 92)) * C, gz = (j + ihash(i, j, 93)) * C;
        if (gx * gx + gz * gz < 900 * 900) continue; // the airbase stays open
        const n = 3 + Math.floor(ihash(i, j, 94) * 7);
        for (let k = 0; k < n; k++) {
          const a = ihash(i, j, 100 + k) * 6.283, d = Math.sqrt(ihash(i, j, 120 + k)) * 26;
          const x = gx + Math.cos(a) * d, z = gz + Math.sin(a) * d;
          const q = ihash(i, j, 140 + k), s2 = ihash(i, j, 160 + k);
          const sp = q < 0.4 ? BROAD : q < 0.7 ? BIRCH : q < 0.8 ? POPLAR : BUSH;
          put(x, z, sp, sp === BUSH ? 1 + s2 : sp === BIRCH ? 0.8 + 0.5 * s2 : 0.7 + 0.6 * s2, 0.9);
        }
      }
    }

    // willows and reeds along the river banks
    const x0 = Math.floor((cx - R) / 14) * 14;
    for (let x = x0; x < cx + R; x += 14) {
      const r = ihash(Math.floor(x / 14), 7, 95);
      if (r > 0.6 * dens) continue;
      const side = r < 0.3 * dens ? -1 : 1;
      const zc = riverCenterZ(x);
      const off = 36 + 22 * ihash(Math.floor(x / 14), 8, 96);
      put(x + (r - 0.3) * 10, zc + side * off, r < 0.12 ? BUSH : BROAD, r < 0.12 ? 1.4 : 0.75 + 0.4 * r, 0.8);
    }

    this.meshes.forEach(({ near, far }, i) => {
      near.count = counts[i][0];
      far.count = counts[i][1];
      for (const m of [near, far]) {
        m.instanceMatrix.needsUpdate = true;
        if (m.instanceColor) m.instanceColor.needsUpdate = true;
      }
    });
    this.counts = counts;
    this.rowCount = rows;
  }
}
