import * as THREE from 'three';
import { mergeGeometries, toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { fbm, mulberry32, smoothstep } from '../noise.js';

// Shared modelling kit: geometry helpers, a merge-per-material part collector and the canvas
// textures (camouflage, radar array, concrete, asphalt) used by vehicles, threats and site.
// Model space: forward -Z, up +Y, right +X, metres.

export const V = (x, y, z) => new THREE.Vector3(x, y, z);
export const DEG = Math.PI / 180;

export function xf(x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, s = 1) {
  const sc = typeof s === 'number' ? V(s, s, s) : s;
  return new THREE.Matrix4().compose(V(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), sc);
}

export const box = (w, h, d, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) => new THREE.BoxGeometry(w, h, d).applyMatrix4(xf(x, y, z, rx, ry, rz));
export const rbox = (w, h, d, r, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) =>
  new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 2 - 1e-3, h / 2 - 1e-3, d / 2 - 1e-3)).applyMatrix4(xf(x, y, z, rx, ry, rz));
export const sphere = (r, x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1, seg = 14) =>
  new THREE.SphereGeometry(r, seg, Math.max(6, seg >> 1)).applyMatrix4(xf(x, y, z, 0, 0, 0, V(sx, sy, sz)));

// Tubes along an axis from a0 to a1; radius r0 at a0 and r1 at a1 (a cone when they differ).
export const yTube = (y0, y1, r0, r1 = r0, seg = 14, x = 0, z = 0, open = false) =>
  new THREE.CylinderGeometry(r1, r0, Math.abs(y1 - y0), seg, 1, open).applyMatrix4(xf(x, (y0 + y1) / 2, z, y1 < y0 ? Math.PI : 0));

export function zTube(z0, z1, r0, r1 = r0, seg = 14, x = 0, y = 0, open = false) {
  const g = new THREE.CylinderGeometry(r1, r0, Math.abs(z1 - z0), seg, 1, open);
  return g.applyMatrix4(xf(x, y, (z0 + z1) / 2, z1 > z0 ? Math.PI / 2 : -Math.PI / 2));
}

export function xTube(x0, x1, r0, r1 = r0, seg = 14, y = 0, z = 0, open = false) {
  const g = new THREE.CylinderGeometry(r1, r0, Math.abs(x1 - x0), seg, 1, open);
  return g.applyMatrix4(xf((x0 + x1) / 2, y, z, 0, 0, x1 > x0 ? -Math.PI / 2 : Math.PI / 2));
}

// A cylinder between two points.
export function rod(a, b, r, seg = 8) {
  const d = b.clone().sub(a), len = d.length();
  const g = new THREE.CylinderGeometry(r, r, len, seg, 1);
  const q = new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), d.normalize());
  return g.applyMatrix4(new THREE.Matrix4().compose(a.clone().add(b).multiplyScalar(0.5), q, V(1, 1, 1)));
}

export const plane = (w, h, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) => new THREE.PlaneGeometry(w, h).applyMatrix4(xf(x, y, z, rx, ry, rz));

// Lathe about Y from [radius, y] points.
export const lathe = (pts, seg = 20) => new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), seg);

// Side profile [z, y] points extruded across x in [-w/2, w/2], with optional bevel. Front is -Z.
export function sideProfile(pts, w, bevel = 0) {
  const s = new THREE.Shape(pts.map(([z, y]) => new THREE.Vector2(z, y)));
  const g = new THREE.ExtrudeGeometry(s, { depth: w - bevel * 2, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 1, curveSegments: 6 });
  g.translate(0, 0, -(w - bevel * 2) / 2);
  g.rotateY(-Math.PI / 2);
  return g;
}

// Front profile [x, y] points extruded along z in [z0, z1] (for arches, hangars and wings seen head on).
export function frontProfile(pts, z0, z1) {
  const s = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
  const g = new THREE.ExtrudeGeometry(s, { depth: Math.abs(z1 - z0), bevelEnabled: false, curveSegments: 8 });
  return g.translate(0, 0, Math.min(z0, z1));
}

// Top profile [x, z] points extruded up through y in [y0, y1] (wings, plan shapes).
export function topProfile(pts, y0, y1) {
  const s = new THREE.Shape(pts.map(([x, z]) => new THREE.Vector2(x, -z)));
  const g = new THREE.ExtrudeGeometry(s, { depth: Math.abs(y1 - y0), bevelEnabled: false, curveSegments: 6 });
  g.rotateX(-Math.PI / 2);
  return g.translate(0, Math.min(y0, y1), 0);
}

export function mirrorX(g) {
  const m = g.clone();
  m.applyMatrix4(new THREE.Matrix4().makeScale(-1, 1, 1));
  if (m.index) {
    const a = m.index.array;
    for (let i = 0; i < a.length; i += 3) { const t = a[i + 1]; a[i + 1] = a[i + 2]; a[i + 2] = t; }
    return m;
  }
  for (const k of Object.keys(m.attributes)) {
    const at = m.attributes[k], n = at.itemSize, ar = at.array;
    for (let i = 0; i < at.count; i += 3) for (let c = 0; c < n; c++) {
      const j1 = (i + 1) * n + c, j2 = (i + 2) * n + c, t = ar[j1];
      ar[j1] = ar[j2];
      ar[j2] = t;
    }
  }
  return m;
}

// Box-projected UVs (scale metres per tile) so the camo is continuous in metres on any flat-ish part.
export function projectUV(g, scale = 4) {
  const p = g.attributes.position, n = g.attributes.normal;
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i += 3) {
    const nx = Math.abs(n.getX(i)), ny = Math.abs(n.getY(i)), nz = Math.abs(n.getZ(i));
    for (let k = 0; k < 3; k++) {
      const x = p.getX(i + k), y = p.getY(i + k), z = p.getZ(i + k);
      let u, v;
      if (nx >= ny && nx >= nz) { u = z; v = y; } else if (ny >= nz) { u = x; v = z; } else { u = x; v = y; }
      uv[(i + k) * 2] = u / scale;
      uv[(i + k) * 2 + 1] = v / scale;
    }
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

export function scaleUV(g, su, sv) {
  const a = g.attributes.uv;
  for (let i = 0; i < a.count; i++) a.setXY(i, a.getX(i) * su, a.getY(i) * sv);
  return g;
}

// ---------------------------------------------------------------- parts collector

const c3 = new THREE.Color();

// Material keys whose parts get metric box-projected UVs (4 m tiles) so the camouflage and the
// grain maps are continuous in metres on any flat-ish surface.
const PROJECTED = new Set(['camo', 'paint', 'dark', 'steel', 'tyre', 'rim', 'rubber', 'canister', 'white', 'brass', 'rust', 'cloth', 'green', 'sand']);

// Collects geometry per material key, then merges each key into one mesh. Every geometry gets
// position, normal, uv and a color (tint) so any set can be merged; `dirt` darkens low vertices a little (the surface finish shader adds the mud).
export class Parts {
  constructor(mats) {
    this.mats = mats;
    this.lists = new Map();
  }

  add(key, geom, { tint = 0xffffff, uv = null } = {}) {
    let g = geom.index ? geom.toNonIndexed() : geom.clone();
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k);
    if (!g.attributes.normal) g.computeVertexNormals();
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    if (!uv && PROJECTED.has(key)) projectUV(g, 4);
    const col = new Float32Array(g.attributes.position.count * 3);
    c3.set(tint);
    for (let i = 0; i < col.length; i += 3) { col[i] = c3.r; col[i + 1] = c3.g; col[i + 2] = c3.b; }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    if (!this.lists.has(key)) this.lists.set(key, []);
    this.lists.get(key).push(g);
    return this;
  }

  // add a geometry and its mirror image across x = 0
  sym(key, geom, o) {
    this.add(key, geom, o);
    return this.add(key, mirrorX(geom), o);
  }

  merged(key) {
    const l = this.lists.get(key);
    return l && l.length ? mergeGeometries(l, false) : null;
  }

  // Merge each material into one mesh under `parent`. y0 is the parent's height above the ground
  // (for the dirt gradient on parts inside pivots).
  build(parent, { dirt = 0, y0 = 0, shadow = true } = {}) {
    const out = [];
    for (const [key, list] of this.lists) {
      const g = mergeGeometries(list, false);
      if (dirt > 0 && key !== 'glass' && key !== 'lens' && key !== 'array') {
        const p = g.attributes.position, c = g.attributes.color;
        for (let i = 0; i < p.count; i++) {
          const s = smoothstep(0.15, 1.7, p.getY(i) + y0);
          const f = 1 - dirt * 0.6 * (1 - s);
          c.setXYZ(i, c.getX(i) * f * (1 - dirt * 0.6 * (1 - s) * 0.05), c.getY(i) * f * (1 - dirt * 0.6 * (1 - s) * 0.16), c.getZ(i) * f * (1 - dirt * 0.6 * (1 - s) * 0.3));
        }
      }
      // height above the ground in vehicle space, for the mud line in the surface finish shader
      const hp = g.attributes.position, ah = new Float32Array(hp.count);
      for (let i = 0; i < hp.count; i++) ah[i] = hp.getY(i) + y0;
      g.setAttribute('aH', new THREE.BufferAttribute(ah, 1));
      g.computeBoundingSphere();
      g.computeBoundingBox();
      const m = new THREE.Mesh(g, this.mats[key]);
      m.name = key;
      m.castShadow = shadow;
      m.receiveShadow = true;
      parent.add(m);
      out.push(m);
      for (const l of list) l.dispose();
    }
    this.lists.clear();
    return out;
  }
}

// ---------------------------------------------------------------- textures

const canvasTex = (c, { srgb = true, repeat = true, aniso = 8 } = {}) => {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = aniso;
  t.generateMipmaps = true;
  return t;
};

// fbm that tiles with period L by blending four shifted samples
function tileNoise(x, y, L, f) {
  const u = x / L, v = y / L;
  return ((1 - u) * (1 - v) * f(x, y) + u * (1 - v) * f(x - L, y) + (1 - u) * v * f(x, y - L) + u * v * f(x - L, y - L));
}

// Periodic value noise on a tile: x, y in [0, 1) tile units, px by py lattice cells, so a texture
// built from it wraps exactly. Quintic interpolation; every octave doubles the cell count.
const hashI = (x, y, s) => {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(s, 2246822519)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
};
function pnoise(x, y, px, py, s) {
  const X = x * px, Y = y * py;
  const x0 = Math.floor(X), y0 = Math.floor(Y);
  const fx = X - x0, fy = Y - y0;
  const u = fx * fx * fx * (fx * (fx * 6 - 15) + 10), v = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
  const xa = ((x0 % px) + px) % px, xb = (xa + 1) % px, ya = ((y0 % py) + py) % py, yb = (ya + 1) % py;
  const a = hashI(xa, ya, s), b = hashI(xb, ya, s), c = hashI(xa, yb, s), d = hashI(xb, yb, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function pfbm(x, y, px, py, oct, s, gain = 0.5) {
  let a = 1, sum = 0, n = 0;
  for (let o = 0; o < oct; o++) {
    sum += a * pnoise(x, y, px, py, s + o * 17);
    n += a;
    a *= gain;
    px *= 2;
    py *= 2;
  }
  return sum / n;
}
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const mix = (a, b, t) => a + (b - a) * t;
const lin2srgb = (l) => 255 * (l <= 0.0031308 ? l * 12.92 : 1.055 * Math.pow(l, 1 / 2.4) - 0.055);

// Height field (size x size, tiling) to a tangent-space normal map canvas.
function normalCanvas(h, size, strength) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(size, size);
  const at = (x, y) => h[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const dx = (at(x + 1, y) - at(x - 1, y)) * 0.5, dy = (at(x, y + 1) - at(x, y - 1)) * 0.5; // dy runs down the image
    const nx = -dx * strength, ny = dy * strength, l = 1 / Math.hypot(nx, ny, 1);
    const i = (y * size + x) * 4;
    img.data[i] = (nx * l * 0.5 + 0.5) * 255;
    img.data[i + 1] = (ny * l * 0.5 + 0.5) * 255;
    img.data[i + 2] = (l * 0.5 + 0.5) * 255;
    img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return cv;
}

export const CAMO = {
  tri: { green: [0x435a2d, 0xa08f64, 0x1c1e1a] }, // green with sand and black blotches
  green: { green: [0x4a5336, 0x535c3b, 0x424a30] }, // plain army green, mottled
  khaki: { green: [0x6d6a4a, 0x7c7655, 0x5a5a3e] }, // dusty olive for support vehicles
};

// Metric tile of a painted steel skin: 4 m square. Returns { map, rough, normal } textures.
//   map     albedo: the paint scheme, faded, dusty, chipped at the seams, rain streaked
//   rough   G roughness, R vertical streak noise, B patchy noise (the surface finish shader reads R, B)
//   normal  panel seams, rivet rows, the paint's edge and a fine grain
// Panels are about 1 m by 1.3 m with brick offset; blotches of the tri scheme are hard edged and
// irregular, 0.5 to 1.5 m across, built from thresholded warped noise with a jagged edge.
const camoCache = new Map();
export function camoTextures(scheme = 'tri', size = 512) {
  if (camoCache.has(scheme)) return camoCache.get(scheme);
  const [base, sand, black] = CAMO[scheme].green.map((h) => new THREE.Color(h));
  const tri = scheme === 'tri';
  const rnd = mulberry32(scheme === 'tri' ? 7 : scheme === 'green' ? 17 : 27);
  const N = size * size;
  const alb = new Float32Array(N * 3), rg = new Float32Array(N), rr = new Float32Array(N), rb = new Float32Array(N), ht = new Float32Array(N);
  // panel layout: three rows of about 1.33 m; seams brick-offset per row, some of them missing
  const rows = 3, seamsPer = 4;
  const rowOff = Array.from({ length: rows }, () => rnd());
  const seamOn = Array.from({ length: rows * seamsPer }, () => rnd() < 0.8);
  const hs = size / 4; // pixels per metre
  const col = new THREE.Color();
  const dust = new THREE.Color(0x8a7c5e), lightGreen = base.clone().multiplyScalar(1.22);
  const primer = new THREE.Color(0x3b2c23), bare = new THREE.Color(0x5c5a53);
  const rivets = [];
  for (let r = 0; r < rows; r++) {
    for (let s = 0; s < seamsPer; s++) if (seamOn[r * seamsPer + s]) {
      const sx = (((s / seamsPer) + rowOff[r] / seamsPer) % 1) * size;
      for (let y = (r / rows) * size + 6; y < ((r + 1) / rows) * size - 4; y += hs * 0.13) rivets.push([sx + 4, y]);
    }
    for (let x = 4; x < size; x += hs * 0.13) rivets.push([x, (r / rows) * size + 2]);
  }
  const rivetMap = new Uint8Array(N);
  for (const [rx, ry] of rivets) {
    const x0 = Math.round(rx) % size, y0 = Math.round(ry) % size;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (dx * dx + dy * dy <= 2) rivetMap[((y0 + dy + size) % size) * size + ((x0 + dx + size) % size)] = 1;
  }
  const AA = 0.012;
  for (let py = 0; py < size; py++) for (let px = 0; px < size; px++) {
    const u = px / size, v = py / size, i = py * size + px;
    // paint scheme
    col.copy(base);
    let edgeStep = 0;
    if (tri) {
      const wx = pfbm(u, v, 3, 4, 2, 11) - 0.5, wy = pfbm(u, v, 3, 4, 2, 12) - 0.5;
      const uu = u + wx * 0.16, vv = v + wy * 0.16;
      const jag = (pfbm(u, v, 40, 40, 2, 41) - 0.5) * 0.15;
      const a = pfbm(uu, vv, 3, 4, 3, 21, 0.5) + jag;
      const b = pfbm(uu + 0.3, vv + 0.1, 3, 3, 3, 31, 0.5) + jag * 0.8;
      const c = pfbm(uu, vv, 5, 6, 2, 51) + jag * 0.6;
      col.lerp(lightGreen, sstep(0.5 - AA, 0.5 + AA, c) * 0.55);
      const sa = sstep(0.56 - AA, 0.56 + AA, a);
      col.lerp(sand, sa);
      const bl = sstep(0.56 - AA, 0.56 + AA, b);
      col.lerp(black, bl);
      edgeStep = Math.max(sa, bl) > 0.5 ? 0.5 : 0; // the paint stands a hair proud where it is thickest
    } else {
      const wx = pfbm(u, v, 3, 3, 2, 61) - 0.5;
      const m = pfbm(u + wx * 0.2, v, 4, 4, 3, 71);
      col.lerp(sand, sstep(0.45, 0.65, m) * (scheme === 'khaki' ? 0.7 : 0.8));
      col.lerp(black, sstep(0.55, 0.8, pfbm(u, v, 3, 3, 3, 81)) * 0.35);
      // rectangular touch-up repaints, a shade off the rest
      const gx = Math.floor(u * 6), gy = Math.floor(v * 5);
      const hv = hashI(gx, gy, 91);
      if (hv > 0.78) col.multiplyScalar(0.93 + hashI(gx, gy, 92) * 0.12);
    }
    // fade and dust haze
    const fade = pfbm(u, v, 2, 2, 3, 101);
    col.lerp(dust, tri ? 0.05 + fade * 0.12 : 0.02 + fade * 0.07);
    // rain streaks run down the panel (v)
    const streak = pfbm(u, v, 56, 3, 2, 111);
    let k = 1 - sstep(0.55, 0.85, streak) * 0.1 + (pfbm(u, v, 160, 160, 1, 121) - 0.5) * 0.12;
    // seams: dark line, chips alongside
    const rowI = Math.min(rows - 1, Math.floor(v * rows));
    const lineY = Math.min(v * rows - rowI, rowI + 1 - v * rows) * (size / rows);
    const kx = Math.round(u * seamsPer - rowOff[rowI]);
    const lineX = Math.abs(u - (kx + rowOff[rowI]) / seamsPer) * size;
    const onX = seamOn[rowI * seamsPer + (((kx % seamsPer) + seamsPer) % seamsPer)];
    const seam = lineY < 1.4 || (onX && lineX < 1.4) ? 1 : 0;
    const nearSeam = Math.min(lineY, onX ? lineX : 99);
    const chipMask = pfbm(u, v, 6, 6, 2, 131) * (1.0 + 0.8 * Math.max(0, 1 - nearSeam / 8));
    const chip = pnoise(u, v, 90, 90, 141) * 0.6 + pnoise(u, v, 200, 200, 142) * 0.4;
    const chipped = chipMask > (tri ? 0.6 : 0.64) && chip > (tri ? 0.67 : 0.7) ? 1 : 0;
    let r = 0.88 - fade * 0.06; // paint is a flat matt
    if (chipped) { col.lerp(chip > 0.76 ? bare : primer, 0.75); r = chip > 0.76 ? 0.5 : 0.8; }
    if (seam) { k *= 0.55; r = 0.95; }
    if (rivetMap[i]) k *= 1.12;
    // oil stains
    const oil = sstep(0.62, 0.72, pfbm(u, v, 3, 3, 3, 151));
    k *= 1 - oil * 0.25;
    r = Math.min(1, r + oil * 0.06 - sstep(0.62, 0.7, pfbm(u, v, 5, 5, 2, 161)) * 0.1);
    alb[i * 3] = col.r * k;
    alb[i * 3 + 1] = col.g * k;
    alb[i * 3 + 2] = col.b * k;
    rg[i] = r;
    rr[i] = pfbm(u, v, 40, 4, 3, 171);
    rb[i] = pfbm(u, v, 12, 12, 3, 181);
    // height: grain, paint ridge, groove at the seam, rivets, chips pitted
    ht[i] = (pfbm(u, v, 128, 128, 2, 191) - 0.5) * 0.35 + edgeStep * 0.35 - seam * 1.2 + (rivetMap[i] ? 1.0 : 0) - chipped * 0.4;
  }
  const mk = () => { const c = document.createElement('canvas'); c.width = c.height = size; return c; };
  const cvA = mk(), cvR = mk();
  const ctxA = cvA.getContext('2d'), ctxR = cvR.getContext('2d');
  const imA = ctxA.createImageData(size, size), imR = ctxR.createImageData(size, size);
  for (let i = 0; i < N; i++) {
    for (let c = 0; c < 3; c++) imA.data[i * 4 + c] = lin2srgb(Math.min(1, alb[i * 3 + c]));
    imA.data[i * 4 + 3] = 255;
    imR.data[i * 4] = rr[i] * 255;
    imR.data[i * 4 + 1] = rg[i] * 255;
    imR.data[i * 4 + 2] = rb[i] * 255;
    imR.data[i * 4 + 3] = 255;
  }
  ctxA.putImageData(imA, 0, 0);
  ctxR.putImageData(imR, 0, 0);
  const out = { map: canvasTex(cvA), rough: canvasTex(cvR, { srgb: false }), normal: canvasTex(normalCanvas(ht, size, 1.6), { srgb: false }) };
  camoCache.set(scheme, out);
  return out;
}
export const camoTexture = (scheme = 'tri') => camoTextures(scheme).map;

// Bare-metal and rubber finish shared by every part that is not camouflaged: a fine grain normal
// map (tile 4 m / 12) and a patchy noise map the surface finish shader reads for dust and mud.
let grainSet;
export function grainTextures(size = 256) {
  if (grainSet) return grainSet;
  const N = size * size;
  const ht = new Float32Array(N);
  const cvR = document.createElement('canvas');
  cvR.width = cvR.height = size;
  const ctxR = cvR.getContext('2d');
  const imR = ctxR.createImageData(size, size);
  for (let py = 0; py < size; py++) for (let px = 0; px < size; px++) {
    const u = px / size, v = py / size, i = py * size + px;
    // pitting and fine scratches along x
    const scratch = pnoise(u, v, 6, 140, 201) * 0.6 + pnoise(u, v, 9, 90, 202) * 0.4;
    ht[i] = (pfbm(u, v, 40, 40, 3, 211) - 0.5) * 0.9 + (scratch - 0.5) * 0.7;
    imR.data[i * 4] = pfbm(u, v, 24, 3, 3, 221) * 255; // streaks
    imR.data[i * 4 + 1] = (0.8 + pfbm(u, v, 30, 30, 2, 231) * 0.2) * 255;
    imR.data[i * 4 + 2] = pfbm(u, v, 5, 5, 4, 241) * 255; // patches
    imR.data[i * 4 + 3] = 255;
  }
  ctxR.putImageData(imR, 0, 0);
  grainSet = { rough: canvasTex(cvR, { srgb: false }), normal: canvasTex(normalCanvas(ht, size, 1.0), { srgb: false }) };
  grainSet.normal.repeat.set(12, 12);
  return grainSet;
}

let arrTex;
// Phased array face: dark panel with a fine lattice of radiating elements and module seams.
export function arrayTexture() {
  if (arrTex) return arrTex;
  const s = 512, cv = document.createElement('canvas');
  cv.width = cv.height = s;
  const g = cv.getContext('2d');
  g.fillStyle = '#2b3029';
  g.fillRect(0, 0, s, s);
  const n = 16, cell = s / n;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    g.fillStyle = (i + j) % 2 ? '#1b1f1b' : '#222721';
    g.fillRect(i * cell + 2, j * cell + 2, cell - 4, cell - 4);
    g.fillStyle = '#3d453b';
    g.beginPath();
    g.arc(i * cell + cell / 2, j * cell + cell / 2, cell * 0.2, 0, 7);
    g.fill();
    g.fillStyle = '#10130f';
    g.beginPath();
    g.arc(i * cell + cell / 2, j * cell + cell / 2, cell * 0.11, 0, 7);
    g.fill();
  }
  g.strokeStyle = '#5a6256';
  g.lineWidth = 3;
  g.strokeRect(1, 1, s - 2, s - 2);
  arrTex = canvasTex(cv, { aniso: 8 });
  return arrTex;
}

// Weathered concrete (tileable ~6 m): board-formed panels with tie holes, stains and runs, hairline
// cracks, spalled patches, speckle. Returns { map, rough, normal }; cached per tone.
const conCache = new Map();
export function concreteTextures(tone = 0x8c8a82) {
  if (conCache.has(tone)) return conCache.get(tone);
  const size = 512, N = size * size;
  const base = new THREE.Color(tone);
  const rnd = mulberry32(3);
  const alb = new Float32Array(N * 3), ht = new Float32Array(N);
  const cvR = document.createElement('canvas');
  cvR.width = cvR.height = size;
  const ctxR = cvR.getContext('2d');
  const imR = ctxR.createImageData(size, size);
  const lift = new THREE.Color();
  const pw = size / 3; // panel size: 2 m (tile is 6 m)
  for (let py = 0; py < size; py++) for (let px = 0; px < size; px++) {
    const u = px / size, v = py / size, i = py * size + px;
    const big = pfbm(u, v, 3, 3, 4, 11);
    const fine = pfbm(u, v, 48, 48, 3, 12);
    const grit = pnoise(u, v, 250, 250, 13);
    let k = 0.82 + big * 0.42 + (fine - 0.5) * 0.22 + (grit - 0.5) * 0.12;
    // runs of rain staining down the surface
    const run = sstep(0.55, 0.8, pfbm(u, v, 30, 3, 3, 14));
    k *= 1 - run * 0.2 * (0.5 + big);
    // damp, mossy darkening near the bottom of the tile fraction is left to the shader; patches here
    const patch = sstep(0.62, 0.7, pfbm(u, v, 4, 4, 3, 15));
    k *= 1 - patch * 0.14;
    lift.copy(base);
    lift.r *= 1 + (big - 0.5) * 0.12;
    lift.b *= 1 - (big - 0.5) * 0.1 - patch * 0.04;
    // formwork joints: horizontal and vertical lines every 2 m, with tie holes at the corners of each board
    const jx = Math.min(px % pw, pw - (px % pw)), jy = Math.min(py % (pw * 0.5), pw * 0.5 - (py % (pw * 0.5)));
    let h = (fine - 0.5) * 0.6 + (grit - 0.5) * 0.35;
    if (jx < 1.2) { k *= 0.8; h -= 0.9; }
    if (jy < 1.0) { k *= 0.88; h -= 0.5; }
    const tx = (px + pw * 0.25) % (pw * 0.5), ty = (py + pw * 0.125) % (pw * 0.5);
    if ((tx - pw * 0.25) ** 2 + (ty - pw * 0.25) ** 2 < 9) { k *= 0.55; h -= 1.0; }
    alb[i * 3] = lift.r * k;
    alb[i * 3 + 1] = lift.g * k;
    alb[i * 3 + 2] = lift.b * k * 0.98;
    ht[i] = h;
    imR.data[i * 4] = pfbm(u, v, 32, 3, 3, 16) * 255;
    imR.data[i * 4 + 1] = Math.min(255, (0.82 + patch * 0.1 + (1 - run) * 0.05 + (grit - 0.5) * 0.1) * 255);
    imR.data[i * 4 + 2] = pfbm(u, v, 5, 5, 4, 17) * 255;
    imR.data[i * 4 + 3] = 255;
  }
  const cvA = document.createElement('canvas');
  cvA.width = cvA.height = size;
  const ctxA = cvA.getContext('2d');
  const imA = ctxA.createImageData(size, size);
  for (let i = 0; i < N; i++) {
    for (let c = 0; c < 3; c++) imA.data[i * 4 + c] = lin2srgb(Math.min(1, alb[i * 3 + c]));
    imA.data[i * 4 + 3] = 255;
  }
  ctxA.putImageData(imA, 0, 0);
  ctxR.putImageData(imR, 0, 0);
  const g = ctxA;
  g.strokeStyle = 'rgba(30,30,28,0.55)';
  g.lineWidth = 1;
  for (let k = 0; k < 9; k++) { // hairline cracks
    let x = rnd() * size, y = rnd() * size;
    g.beginPath();
    g.moveTo(x, y);
    for (let i = 0; i < 16; i++) { x += (rnd() - 0.4) * 22; y += (rnd() - 0.5) * 16; g.lineTo(x, y); }
    g.stroke();
  }
  const out = { map: canvasTex(cvA), rough: canvasTex(cvR, { srgb: false }), normal: canvasTex(normalCanvas(ht, size, 1.4), { srgb: false }) };
  conCache.set(tone, out);
  return out;
}
// Steppe turf for earth mounds and berms (tile 8 m): dry grass and bare soil patches, dark tussocks,
// speckle, with a fine tufted normal map. Returns { map, rough, normal }.
let earthSet;
export function earthTextures() {
  if (earthSet) return earthSet;
  const size = 256, N = size * size;
  const alb = new Float32Array(N * 3), ht = new Float32Array(N);
  const cvR = document.createElement('canvas');
  cvR.width = cvR.height = size;
  const ctxR = cvR.getContext('2d');
  const imR = ctxR.createImageData(size, size);
  const grass = new THREE.Color(0x5b6a3f), dry = new THREE.Color(0x7d7852), soil = new THREE.Color(0x6a5d45), dark = new THREE.Color(0x44502f);
  const col = new THREE.Color();
  for (let py = 0; py < size; py++) for (let px = 0; px < size; px++) {
    const u = px / size, v = py / size, i = py * size + px;
    const big = pfbm(u, v, 4, 4, 4, 301), mid = pfbm(u, v, 14, 14, 3, 302), fine = pnoise(u, v, 120, 120, 303);
    col.copy(grass);
    col.lerp(dry, sstep(0.45, 0.65, big) * 0.5);
    col.lerp(soil, sstep(0.62, 0.74, pfbm(u, v, 5, 5, 3, 304)) * 0.4);
    col.lerp(dark, sstep(0.5, 0.7, mid) * 0.3);
    const k = 0.8 + fine * 0.4;
    alb[i * 3] = col.r * k;
    alb[i * 3 + 1] = col.g * k;
    alb[i * 3 + 2] = col.b * k;
    ht[i] = (pfbm(u, v, 90, 90, 2, 305) - 0.5) * 1.2 + (fine - 0.5) * 0.8;
    imR.data[i * 4] = pfbm(u, v, 20, 3, 3, 306) * 255;
    imR.data[i * 4 + 1] = 255;
    imR.data[i * 4 + 2] = pfbm(u, v, 5, 5, 4, 307) * 255;
    imR.data[i * 4 + 3] = 255;
  }
  const cvA = document.createElement('canvas');
  cvA.width = cvA.height = size;
  const ctxA = cvA.getContext('2d');
  const imA = ctxA.createImageData(size, size);
  for (let i = 0; i < N; i++) {
    for (let c = 0; c < 3; c++) imA.data[i * 4 + c] = lin2srgb(Math.min(1, alb[i * 3 + c]));
    imA.data[i * 4 + 3] = 255;
  }
  ctxA.putImageData(imA, 0, 0);
  ctxR.putImageData(imR, 0, 0);
  earthSet = { map: canvasTex(cvA), rough: canvasTex(cvR, { srgb: false }), normal: canvasTex(normalCanvas(ht, size, 1.2), { srgb: false }) };
  return earthSet;
}

export const concreteTexture = (tone) => concreteTextures(tone).map;

let astTex;
// Worn runway surface (tileable, 6 m): coarse aggregate, repair patches, hairline cracks, oil drips
// and a faint rubber smear. Dark asphalt grey.
export function runwayTexture() {
  if (astTex) return astTex;
  const s = 512, cv = document.createElement('canvas');
  cv.width = cv.height = s;
  const g = cv.getContext('2d');
  const img = g.createImageData(s, s);
  const rnd = mulberry32(5);
  const patches = Array.from({ length: 4 }, () => ({ x: rnd() * 0.7, y: rnd() * 0.8, w: 0.1 + rnd() * 0.15, h: 0.06 + rnd() * 0.1, k: 0.9 + rnd() * 0.16 }));
  for (let py = 0; py < s; py++) for (let px = 0; px < s; px++) {
    const u = px / s, v = py / s;
    const a = pfbm(u, v, 3, 3, 4, 401);
    const b = pnoise(u, v, 180, 180, 402);
    const c = pfbm(u, v, 60, 60, 2, 403);
    let k = 0.9 + (a - 0.5) * 0.22 + (b - 0.5) * 0.3 + (c - 0.5) * 0.16;
    for (const p of patches) if (u > p.x && u < p.x + p.w && v > p.y && v < p.y + p.h) k *= p.k;
    k *= 1 - sstep(0.6, 0.78, pfbm(u, v, 3, 2, 3, 404)) * 0.22; // oil and rubber
    const val = 74 * k;
    const i = (py * s + px) * 4;
    img.data[i] = val; img.data[i + 1] = val; img.data[i + 2] = val * 0.97; img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  g.strokeStyle = 'rgba(18,18,16,0.55)';
  g.lineWidth = 1.3;
  for (let k = 0; k < 6; k++) { // cracks
    let x = 30 + rnd() * (s - 60), y = 30 + rnd() * (s - 60);
    g.beginPath();
    g.moveTo(x, y);
    for (let i = 0; i < 18; i++) { x += (rnd() - 0.5) * 26; y += (rnd() - 0.2) * 18; g.lineTo(Math.min(s - 4, Math.max(4, x)), Math.min(s - 4, Math.max(4, y))); }
    g.stroke();
  }
  astTex = canvasTex(cv);
  return astTex;
}

// ---------------------------------------------------------------- surface finish

// Hooks a patch into a material's onBeforeCompile and program cache key without disturbing the
// ones the framework sets later (shaderlib's patchMaterial assigns both after the model is built):
// the assignments are captured and run first, then the patch.
function chainPatch(mat, key, patch) {
  let outer = null, outerKey = null;
  Object.defineProperty(mat, 'onBeforeCompile', {
    configurable: true,
    get: () => (shader, renderer) => { if (outer) outer(shader, renderer); patch(shader); },
    set: (f) => { outer = f; },
  });
  Object.defineProperty(mat, 'customProgramCacheKey', {
    configurable: true,
    get: () => () => (outerKey ? outerKey() : '') + '|' + key,
    set: (f) => { outerKey = f; },
  });
}

const glslColor = (hex) => { const c = new THREE.Color(hex); return `vec3(${c.r.toFixed(4)}, ${c.g.toFixed(4)}, ${c.b.toFixed(4)})`; };

// Weathering that depends on where a point is, applied after the normal map: mud thrown up from the
// ground (by `aH`, the height above the ground, ragged by the streak noise in the roughness map's R
// channel, patchy by its B channel), and dust settling on up-facing surfaces. Both pull the colour
// toward the dirt, roughen it and take the metal out of it. The material needs a roughnessMap
// laid out like camoTextures' / grainTextures'.
export function surfaceFinish(mat, key, { mud = 0.7, mudTop = 1.1, dust = 0.5, mudColor = 0x4a3b29, dustColor = 0x9a8d6e } = {}) {
  const code = /* glsl */ `
  {
    vec4 fin = texture2D( roughnessMap, vRoughnessMapUv );
    vec3 wn = inverseTransformDirection( normal, viewMatrix );
    float hh = vH + ( fin.r - 0.5 ) * 0.9 + ( fin.b - 0.5 ) * 0.35;
    float mudA = clamp( ${mud.toFixed(3)} * ( 1.0 - smoothstep( 0.15, ${mudTop.toFixed(3)}, hh ) ) * ( 0.7 + 0.6 * fin.b ), 0.0, 1.0 );
    diffuseColor.rgb = mix( diffuseColor.rgb, ${glslColor(mudColor)} * mix( 0.8, 1.4, fin.b ), mudA * 0.85 );
    roughnessFactor = mix( roughnessFactor, 1.0, mudA );
    metalnessFactor *= 1.0 - mudA;
    float dustA = clamp( ${dust.toFixed(3)} * smoothstep( 0.4, 0.95, wn.y ) * ( 0.4 + 0.9 * fin.b ), 0.0, 0.75 );
    diffuseColor.rgb = mix( diffuseColor.rgb, ${glslColor(dustColor)}, dustA );
    roughnessFactor = mix( roughnessFactor, 1.0, dustA * 0.8 );
    metalnessFactor *= 1.0 - dustA;
  }`;
  chainPatch(mat, key, (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aH;\nvarying float vH;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvH = aH;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vH;')
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n' + code);
  });
  return mat;
}

// ---------------------------------------------------------------- materials

const matCache = new Map();
const std = (c, rough = 0.7, metal = 0.1, extra = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: rough, metalness: metal, vertexColors: true, ...extra });

// The material set vehicles share. `scheme` picks the camouflage ('tri' | 'green' | 'khaki').
// Painted parts carry the paint scheme and its wear; bare metal, rubber and the rest take a fine
// grain. All of them get the mud line and the dust from surfaceFinish.
export function vehicleMats(scheme = 'tri') {
  if (matCache.has(scheme)) return matCache.get(scheme);
  const arr = arrayTexture();
  const tex = camoTextures(scheme), grain = grainTextures();
  const dirtCol = scheme === 'tri' ? 0x8e8062 : 0x8a7f62;
  // finish: [normalScale, mud, dust, mud height]
  const fin = (m, key, ns, mud, dust, top = 1.1) => {
    m.roughnessMap = grain.rough;
    m.normalMap = grain.normal;
    m.normalScale.set(ns, ns);
    return surfaceFinish(m, 'veh-' + key, { mud, dust, mudTop: top, dustColor: dirtCol });
  };
  const painted = (m, key, mud, dust) => {
    m.roughnessMap = tex.rough;
    m.normalMap = tex.normal;
    m.normalScale.set(0.7, 0.7);
    return surfaceFinish(m, 'veh-' + key + scheme, { mud, dust, dustColor: dirtCol });
  };
  const m = {
    camo: painted(std(0xffffff, 1, 0.0, { map: tex.map }), 'camo', 0.8, 0.55), // paint scheme, faded and chipped
    paint: painted(std(0x56603d, 1, 0.0, { map: tex.map }), 'paint', 0.8, 0.5), // sensor housings and small parts, the same paint
    dark: fin(std(0x1d1f1e, 0.62, 0.2), 'dark', 0.5, 0.7, 0.35), // black steel, brackets, chassis
    steel: fin(std(0x8b8f93, 0.42, 0.85), 'steel', 0.9, 0.6, 0.3), // bare / zinc steel
    tyre: fin(std(0x1c1c1b, 1, 0.0), 'tyre', 0.7, 0.55, 0.4, 0.9),
    rim: fin(std(0x4a5236, 0.7, 0.3), 'rim', 0.6, 0.85, 0.4, 1.0),
    rubber: fin(std(0x242423, 0.95, 0.0), 'rubber', 0.5, 0.6, 0.3),
    glass: std(0x23343f, 0.02, 0.6, { envMapIntensity: 2.2 }), // dark tinted glass, mirror-like at grazing angles
    lens: std(0xe8e6c8, 0.15, 0.2, { emissive: 0xfff2c0, emissiveIntensity: 0.25, envMapIntensity: 1.5 }),
    red: std(0x9a1a14, 0.3, 0.1, { emissive: 0x440806, emissiveIntensity: 0.4 }),
    amber: std(0xd88a14, 0.3, 0.1, { emissive: 0x6a3a02, emissiveIntensity: 0.4 }),
    array: std(0xffffff, 0.5, 0.35, { map: arr }),
    canister: fin(std(0x6a734b, 0.5, 0.15), 'canister', 0.4, 0.5, 0.5), // composite missile container, satin olive
    white: fin(std(0xc9cbc4, 0.5, 0.05), 'white', 0.4, 0.5, 0.5),
    brass: std(0x9a7a38, 0.35, 0.85),
    rust: fin(std(0x6b4a30, 0.85, 0.3), 'rust', 0.8, 0.5, 0.3),
    cloth: fin(std(0x5b6140, 0.95, 0.0), 'cloth', 1.2, 0.6, 0.7), // tarpaulin / canvas
  };
  matCache.set(scheme, m);
  return m;
}

// ---------------------------------------------------------------- wheels

// Tyre about the x axis centred at the origin: sidewall bulge, shoulder rounding and a chevron
// tread cut into the radius so lugs read in silhouette.
export function tyreGeometry(R, W, lugs = 22, seg = 76) {
  const h = R * 0.3, Rr = R - h;
  const prof = [[-1, Rr], [-1.05, Rr + 0.45 * h], [-0.93, R - 0.2 * h], [-0.74, R - 0.05 * h], [-0.5, R], [0, R], [0.5, R], [0.74, R - 0.05 * h], [0.93, R - 0.2 * h], [1.05, Rr + 0.45 * h], [1, Rr]];
  const M = prof.length, pos = [], idx = [];
  for (let i = 0; i < seg; i++) {
    const a = (i / seg) * Math.PI * 2;
    for (let j = 0; j < M; j++) {
      let [u, r] = prof[j];
      const tread = Math.abs(u) < 0.78 ? 1 : 0;
      if (tread) {
        const f = (((i / seg) * lugs + Math.sign(u || 1) * Math.abs(u) * 0.55) % 1 + 1) % 1;
        const groove = smoothstep(0.5, 0.6, f) * (1 - smoothstep(0.9, 1.0, f));
        r -= groove * R * 0.032 * smoothstep(0.0, 0.2, Math.abs(u));
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

// Wheel hub/disc on the outer face (side = +1 for +X). Returns [rimGeometry].
export function hubGeometry(R, W, side) {
  const h = R * 0.3, Rr = R - h;
  const parts = [];
  const disc = lathe([[0, 0], [Rr * 0.28, 0.0], [Rr * 0.3, 0.02], [Rr * 0.62, 0.04], [Rr * 0.97, 0.0], [Rr * 1.0, -0.06], [Rr * 0.9, -0.12], [0, -0.12]], 20);
  parts.push(disc.applyMatrix4(xf(side * (W * 0.5 - 0.02), 0, 0, 0, 0, -side * Math.PI / 2)));
  parts.push(xTube(side * (W * 0.5 - 0.02), side * (W * 0.5 + 0.07), Rr * 0.26, Rr * 0.2, 12));
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    parts.push(xTube(side * (W * 0.5 - 0.0), side * (W * 0.5 + 0.045), Rr * 0.045, Rr * 0.045, 6, Math.cos(a) * Rr * 0.5, Math.sin(a) * Rr * 0.5));
  }
  return mergeGeometries(parts.map((p) => (p.index ? p.toNonIndexed() : p)).map((p) => { p.deleteAttribute('uv'); return p; }));
}

// Wheel pair at axle position (all wheels of an axle) into the parts collector.
export function addWheel(P, x, y, z, R, W, side, lugs = 22) {
  P.add('tyre', tyreGeometry(R, W, lugs).applyMatrix4(xf(x, y, z)));
  P.add('rim', hubGeometry(R, W, side).applyMatrix4(xf(x, y, z)));
}

// Half-round mudguard over a wheel at (x, y, z), width W
export function mudguard(R, W, x, y, z, ang0 = 12, ang1 = 168, gap = 0.1, t = 0.04) {
  const s = new THREE.Shape();
  const r0 = R + gap, r1 = R + gap + t;
  s.absarc(0, 0, r1, ang0 * DEG, ang1 * DEG, false);
  s.absarc(0, 0, r0, ang1 * DEG, ang0 * DEG, true);
  const g = new THREE.ExtrudeGeometry(s, { depth: W, bevelEnabled: false, curveSegments: 10 });
  // shape is in (z,y)->, extruded along x
  g.translate(0, 0, -W / 2);
  g.rotateY(-Math.PI / 2);
  return g.applyMatrix4(xf(x, y, z));
}

// Lamp: housing + lens
export function addLamp(P, x, y, z, w, h, d = 0.08, key = 'lens') {
  P.add('dark', rbox(w + 0.04, h + 0.04, d, 0.02, x, y, z));
  P.add(key, box(w, h, 0.02, x, y, z - d / 2 - 0.005));
}

export const shadowAll = (root) => root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });

// Convex solid through stacked rings of points (same count, ordered around the outline), faces
// oriented away from the centroid. For tapered hulls, noses and fairings.
export function loft(rings, { top = true, bottom = true, crease = 0 } = {}) {
  const c = new THREE.Vector3();
  let n = 0;
  for (const r of rings) for (const p of r) { c.add(p); n++; }
  c.divideScalar(n);
  const out = [];
  const e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), m = new THREE.Vector3();
  const tri = (a, b, d) => {
    e1.subVectors(b, a);
    e2.subVectors(d, a);
    e1.cross(e2);
    if (e1.lengthSq() < 1e-12) return;
    m.copy(a).add(b).add(d).divideScalar(3).sub(c);
    if (e1.dot(m) < 0) out.push(a, d, b); else out.push(a, b, d);
  };
  for (let k = 0; k < rings.length - 1; k++) {
    const A = rings[k], B = rings[k + 1];
    for (let i = 0; i < A.length; i++) {
      const j = (i + 1) % A.length;
      tri(A[i], A[j], B[j]);
      tri(A[i], B[j], B[i]);
    }
  }
  const cap = (R) => { for (let i = 1; i < R.length - 1; i++) tri(R[0], R[i], R[i + 1]); };
  if (top) cap(rings[rings.length - 1]);
  if (bottom) cap(rings[0]);
  const g = new THREE.BufferGeometry().setFromPoints(out);
  if (crease > 0) return toCreasedNormals(g, crease);
  g.computeVertexNormals();
  return g;
}

// Plan polygon [x, z] points at height y as a ring of Vector3
export const ringAt = (pts, y) => pts.map(([x, z]) => V(x, y, z));

// Parabolic dish (radius R, depth d) opening toward -Z, thin shell, centred at the vertex.
export function dish(R, d, t = 0.03, seg = 24) {
  const pts = [];
  const n = 8;
  for (let i = n; i >= 0; i--) { const r = (R * i) / n; pts.push([r, d * (r / R) ** 2 - 0.0]); }
  for (let i = 0; i <= n; i++) { const r = (R * i) / n; pts.push([r, d * (r / R) ** 2 + t]); }
  const g = lathe(pts.map(([r, y]) => [Math.max(r, 0.0001), y]), seg);
  g.rotateX(-Math.PI / 2);
  return g;
}
