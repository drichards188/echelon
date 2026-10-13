import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { V, DEG, box, yTube, zTube, xTube, rod, xf, projectUV, surfaceFinish, grainTextures, mirrorX } from '../../../models/kit.js';
import { mulberry32 } from '../../../noise.js';

// Shared kit of the WW2 German flak models (src/eras/ww2/models/): the paint and its wear, bare and
// oiled steel, timber, sandbags, soil, the ammunition, handwheels, follow-the-pointer dials and the
// emplacement pieces (plank-revetted pits with their earth banks, log decking, sandbag walls).
//
// Paint (refs/ww2/markings section 1.3): the heavy guns Dunkelgrau RAL 7021 (in game #464b4d, a fresh
// #3f4446 a little faded), one or two of them Dunkelgelb RAL 7028 (#b3a072, the 1943 shade), the light and
// medium guns Dunkelgelb. Flat, chalky paint chipped to the red oxide primer and the steel, oil and
// handling wear. A rig's painted meshes swap between the two schemes with setPaint (below), so any gun
// can be either; the other scheme's materials ride along on a hidden mesh in the rig, so main's
// patchSceneFog patches both (materials created after it must patch themselves).
//
// Model space as everywhere: metres, front -Z, right +X, the ground (the pit floor) at y = 0.

export { V, DEG, box, yTube, zTube, xTube, rod, xf };

export const PAINT = { grey: 0x464b4d, yellow: 0xb3a072 };

const canvasTex = (c, srgb = true) => {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
};
const mkCanvas = (w, h = w) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
const lin2srgb = (l) => 255 * (l <= 0.0031308 ? l * 12.92 : 1.055 * Math.pow(Math.max(0, l), 1 / 2.4) - 0.055);
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// periodic value noise on a tile (x, y in [0, 1)), so the textures wrap exactly
const hashI = (x, y, s) => {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(s, 2246822519)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
};
function pnoise(x, y, px, py, s) {
  const X = x * px, Y = y * py, x0 = Math.floor(X), y0 = Math.floor(Y), fx = X - x0, fy = Y - y0;
  const u = fx * fx * fx * (fx * (fx * 6 - 15) + 10), v = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
  const xa = ((x0 % px) + px) % px, xb = (xa + 1) % px, ya = ((y0 % py) + py) % py, yb = (ya + 1) % py;
  const a = hashI(xa, ya, s), b = hashI(xb, ya, s), c = hashI(xa, yb, s), d = hashI(xb, yb, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function pfbm(x, y, px, py, oct, s, gain = 0.5) {
  let a = 1, sum = 0, n = 0;
  for (let o = 0; o < oct; o++) { sum += a * pnoise(x, y, px, py, s + o * 17); n += a; a *= gain; px *= 2; py *= 2; }
  return sum / n;
}

function normalCanvas(h, W, H, strength) {
  const cv = mkCanvas(W, H), g = cv.getContext('2d'), img = g.createImageData(W, H);
  const at = (x, y) => h[((y + H) % H) * W + ((x + W) % W)];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const dx = (at(x + 1, y) - at(x - 1, y)) * 0.5, dy = (at(x, y + 1) - at(x, y - 1)) * 0.5;
    const nx = -dx * strength, ny = dy * strength, l = 1 / Math.hypot(nx, ny, 1), i = (y * W + x) * 4;
    img.data[i] = (nx * l * 0.5 + 0.5) * 255; img.data[i + 1] = (ny * l * 0.5 + 0.5) * 255; img.data[i + 2] = (l * 0.5 + 0.5) * 255; img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return cv;
}

// Write a texture set from linear albedo, roughness channels (R streaks, G roughness, B patches: the
// layout surfaceFinish reads) and a height field.
function texSet(W, H, alb, rr, rg, rb, ht, nStrength) {
  const cA = mkCanvas(W, H), cR = mkCanvas(W, H), gA = cA.getContext('2d'), gR = cR.getContext('2d');
  const iA = gA.createImageData(W, H), iR = gR.createImageData(W, H);
  for (let i = 0; i < W * H; i++) {
    for (let c = 0; c < 3; c++) iA.data[i * 4 + c] = lin2srgb(Math.min(1, alb[i * 3 + c]));
    iA.data[i * 4 + 3] = 255;
    iR.data[i * 4] = rr[i] * 255; iR.data[i * 4 + 1] = rg[i] * 255; iR.data[i * 4 + 2] = rb[i] * 255; iR.data[i * 4 + 3] = 255;
  }
  gA.putImageData(iA, 0, 0);
  gR.putImageData(iR, 0, 0);
  return { map: canvasTex(cA), rough: canvasTex(cR, false), normal: canvasTex(normalCanvas(ht, W, H, nStrength), false), canvas: cA };
}

// ---------------------------------------------------------------- paint

// One 2 m tile of a gun's paint: the scheme's colour, a faint spray mottle, chips to the red oxide
// primer and the bare steel, rust spots with streaks under them, oil and soot smears, scuffs.
const paintCache = new Map();
export function paintTextures(scheme = 'grey', size = 512) {
  if (paintCache.has(scheme)) return paintCache.get(scheme);
  const base = new THREE.Color(PAINT[scheme]);
  const primer = new THREE.Color(0x6f4334), bare = new THREE.Color(0x6b6e70), rust = new THREE.Color(0x5e3a22), oil = new THREE.Color(0x1f1d19), under = new THREE.Color(PAINT.grey);
  const yellow = scheme === 'yellow';
  const N = size * size;
  const alb = new Float32Array(N * 3), rr = new Float32Array(N), rg = new Float32Array(N), rb = new Float32Array(N), ht = new Float32Array(N);
  const col = new THREE.Color();
  for (let py = 0; py < size; py++) for (let px = 0; px < size; px++) {
    const u = px / size, v = py / size, i = py * size + px;
    col.copy(base);
    // spray mottle and fade
    const m = pfbm(u, v, 4, 4, 4, 11), f = pfbm(u, v, 2, 2, 3, 13);
    let k = 0.93 + (m - 0.5) * 0.16 + (pnoise(u, v, 180, 180, 15) - 0.5) * 0.05;
    col.multiplyScalar(k * (1 + (f - 0.5) * 0.12));
    // dust bloom: dark grey goes chalky, dark yellow a little greyer
    col.lerp(yellow ? new THREE.Color(0x8f8670) : new THREE.Color(0x5d605d), sstep(0.5, 0.8, f) * 0.25);
    // chips: sparse clusters of small flakes; a Dunkelgelb gun repainted over its grey shows the grey
    const cl = pfbm(u, v, 6, 6, 2, 21), fl = pnoise(u, v, 110, 110, 23) * 0.6 + pnoise(u, v, 260, 260, 24) * 0.4;
    const chip = cl > 0.66 && fl > 0.76 ? (fl > 0.83 ? 2 : 1) : 0;
    let r = 0.86 + (f - 0.5) * 0.06, h = (pnoise(u, v, 160, 160, 31) - 0.5) * 0.35; // orange peel
    if (chip === 1) { col.lerp(yellow ? under : primer, 0.7); r = 0.75; h -= 0.5; }
    if (chip === 2) { col.lerp(bare, 0.75); r = 0.45; h -= 0.9; }
    // rust spots and their streaks (v runs down a vertical face)
    const rs = pfbm(u, v, 5, 5, 2, 41);
    const spot = rs > 0.76 && pnoise(u, v, 40, 40, 42) > 0.72 ? 1 : 0;
    const streak = sstep(0.6, 0.75, pfbm(u, v, 30, 2, 3, 43)) * sstep(0.68, 0.76, rs);
    col.lerp(rust, Math.max(spot * 0.6, streak * 0.25));
    // oil and soot smears
    const sm = sstep(0.68, 0.8, pfbm(u, v, 3, 3, 3, 51));
    col.lerp(oil, sm * 0.25);
    r = Math.min(1, r - sm * 0.18 + spot * 0.05);
    // scuffs: lighter, polished streaks
    const sc = sstep(0.82, 0.9, pnoise(u, v, 12, 70, 61));
    col.lerp(bare, sc * 0.18);
    alb[i * 3] = col.r; alb[i * 3 + 1] = col.g; alb[i * 3 + 2] = col.b;
    rg[i] = r;
    rr[i] = pfbm(u, v, 40, 4, 3, 71);
    rb[i] = pfbm(u, v, 10, 10, 3, 81);
    ht[i] = h;
  }
  const out = texSet(size, size, alb, rr, rg, rb, ht, 1.2);
  paintCache.set(scheme, out);
  return out;
}

// ---------------------------------------------------------------- timber, soil, sandbags

// Weathered pine planks along U, each about 0.2 m wide (the tile is 2 m by 2 m, ten planks), grey-brown,
// grain, knots, joints and nail heads. Logs and posts use it too.
let woodSet;
export function woodTextures(size = 512) {
  if (woodSet) return woodSet;
  const N = size * size, rnd = mulberry32(5);
  const alb = new Float32Array(N * 3), rr = new Float32Array(N), rg = new Float32Array(N), rb = new Float32Array(N), ht = new Float32Array(N);
  const planks = 10, tone = Array.from({ length: planks }, () => 0.8 + rnd() * 0.35), joint = Array.from({ length: planks }, () => rnd());
  const knots = Array.from({ length: 26 }, () => [rnd(), rnd(), 0.004 + rnd() * 0.008]);
  const fresh = new THREE.Color(0x8a7454), old = new THREE.Color(0x6d665a), dark = new THREE.Color(0x3a3027);
  const col = new THREE.Color();
  for (let py = 0; py < size; py++) for (let px = 0; px < size; px++) {
    const u = px / size, v = py / size, i = py * size + px;
    const p = Math.floor(v * planks), pv = v * planks - p;
    col.copy(fresh).lerp(old, 0.45 + (pfbm(u, v, 3, 3, 3, 101) - 0.5) * 0.6);
    const grain = pfbm(u * 1, v, 2, 60, 3, 103 + p) * 0.6 + pnoise(u, v, 8, 220, 105) * 0.4;
    let k = tone[p] * (0.85 + grain * 0.3);
    let h = (grain - 0.5) * 0.8;
    // the gap between planks, and a butt joint somewhere along each
    const edge = Math.min(pv, 1 - pv) * (size / planks);
    if (edge < 1.6) { k *= 0.35; h -= 1.5; }
    const ju = Math.abs(u - joint[p]) * size;
    if (ju < 1.3) { k *= 0.45; h -= 1.2; }
    // nails near the joint
    for (const off of [-6, 6]) for (const pvn of [0.25, 0.75]) {
      const dx = (u - joint[p]) * size - off, dy = (pv - pvn) * (size / planks);
      if (dx * dx + dy * dy < 2.2) { col.lerp(new THREE.Color(0x3b3833), 0.9); h += 0.6; }
    }
    for (const [ku, kv, kr] of knots) {
      const d = Math.hypot((u - ku) * 0.5, v - kv);
      if (d < kr) { col.lerp(dark, 0.7); h -= 0.3; }
      else if (d < kr * 2.5) k *= 0.9;
    }
    col.lerp(dark, sstep(0.62, 0.8, pfbm(u, v, 4, 4, 3, 107)) * 0.35); // damp and dirt
    col.multiplyScalar(k);
    alb[i * 3] = col.r; alb[i * 3 + 1] = col.g; alb[i * 3 + 2] = col.b;
    rg[i] = 0.88 + (grain - 0.5) * 0.1;
    rr[i] = pfbm(u, v, 30, 3, 3, 109);
    rb[i] = pfbm(u, v, 6, 6, 3, 111);
    ht[i] = h;
  }
  woodSet = texSet(size, size, alb, rr, rg, rb, ht, 1.6);
  return woodSet;
}

// Sandy Muensterland soil banked round the pits (tile 8 m): fresh light-brown sand and humus, patches of
// dead winter grass, clods, footprints of darker damp earth.
let soilSet;
export function soilTextures(size = 512) {
  if (soilSet) return soilSet;
  const N = size * size;
  const alb = new Float32Array(N * 3), rr = new Float32Array(N), rg = new Float32Array(N), rb = new Float32Array(N), ht = new Float32Array(N);
  const sand = new THREE.Color(0x7d6a50), humus = new THREE.Color(0x4c3f31), grass = new THREE.Color(0x6e6a45), dead = new THREE.Color(0x8b8160);
  const col = new THREE.Color();
  for (let py = 0; py < size; py++) for (let px = 0; px < size; px++) {
    const u = px / size, v = py / size, i = py * size + px;
    const big = pfbm(u, v, 4, 4, 4, 201), mid = pfbm(u, v, 16, 16, 3, 202), fine = pnoise(u, v, 200, 200, 203);
    col.copy(sand).lerp(humus, sstep(0.4, 0.65, big) * 0.6);
    const g = sstep(0.55, 0.7, pfbm(u, v, 6, 6, 3, 204));
    col.lerp(pnoise(u, v, 90, 90, 205) > 0.5 ? grass : dead, g * 0.75);
    const clod = pnoise(u, v, 70, 70, 206);
    col.multiplyScalar(0.82 + fine * 0.3 + (clod > 0.75 ? -0.12 : 0));
    alb[i * 3] = col.r; alb[i * 3 + 1] = col.g; alb[i * 3 + 2] = col.b;
    rg[i] = 0.95;
    rr[i] = pfbm(u, v, 20, 3, 3, 207);
    rb[i] = mid;
    ht[i] = (mid - 0.5) * 0.8 + (fine - 0.5) * 0.7 + (clod > 0.75 ? 0.8 : 0) + g * (pnoise(u, v, 140, 140, 208) - 0.5) * 1.2;
  }
  soilSet = texSet(size, size, alb, rr, rg, rb, ht, 1.4);
  return soilSet;
}

// Hessian sandbags (tile 0.5 m): coarse weave, stitching, dirt.
let hessianSet;
function hessianTextures(size = 256) {
  if (hessianSet) return hessianSet;
  const N = size * size;
  const alb = new Float32Array(N * 3), rr = new Float32Array(N), rg = new Float32Array(N), rb = new Float32Array(N), ht = new Float32Array(N);
  const base = new THREE.Color(0x8a7a58), dirt = new THREE.Color(0x4f4434), col = new THREE.Color();
  for (let py = 0; py < size; py++) for (let px = 0; px < size; px++) {
    const u = px / size, v = py / size, i = py * size + px;
    const wx = Math.sin(u * Math.PI * 2 * 64), wy = Math.sin(v * Math.PI * 2 * 64);
    const weave = (wx > 0) !== (wy > 0) ? wx * wx : wy * wy;
    col.copy(base).lerp(dirt, sstep(0.45, 0.75, pfbm(u, v, 3, 3, 3, 301)) * 0.6).multiplyScalar(0.85 + weave * 0.2);
    alb[i * 3] = col.r; alb[i * 3 + 1] = col.g; alb[i * 3 + 2] = col.b;
    rg[i] = 1; rr[i] = pfbm(u, v, 12, 3, 3, 303); rb[i] = pfbm(u, v, 4, 4, 3, 305);
    ht[i] = weave * 0.8;
  }
  hessianSet = texSet(size, size, alb, rr, rg, rb, ht, 1.2);
  return hessianSet;
}

// ---------------------------------------------------------------- dials and numerals

// The follow-the-pointer dial faces (Uebertragungsgeraet 37, flak88_receivers_09): black faces with white
// graduations, a large fine dial (0 to 80 on each half, 0 at the top and the bottom) and a small coarse
// dial (0 to 32), and a plain face for the predictor's and the setter's dials. One atlas, 1024 x 256:
//   [0, 0, 256, 256] fine dial; [256, 0, 256, 256] coarse dial; [512, 0, 256, 256] plain 0 to 9 dial;
//   [768, 0, 256, 256] the receiver box glass with both dials on a grey plate (wide)
let dialTex;
export function dialTexture() {
  if (dialTex) return dialTex;
  const c = mkCanvas(1024, 256), g = c.getContext('2d');
  g.fillStyle = '#4a4d4c';
  g.fillRect(0, 0, 1024, 256);
  const face = (cx, cy, R, labels, ticks) => {
    g.fillStyle = '#121312';
    g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#e8e6da'; g.fillStyle = '#e8e6da';
    for (let i = 0; i < ticks; i++) {
      const a = (i / ticks) * Math.PI * 2, long = i % 5 === 0;
      g.lineWidth = long ? 2.2 : 1.1;
      const r0 = R * (long ? 0.78 : 0.86);
      g.beginPath(); g.moveTo(cx + Math.sin(a) * r0, cy - Math.cos(a) * r0); g.lineTo(cx + Math.sin(a) * R * 0.95, cy - Math.cos(a) * R * 0.95); g.stroke();
    }
    g.font = `bold ${Math.round(R * 0.2)}px sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
    labels.forEach((t, i) => { const a = (i / labels.length) * Math.PI * 2; g.fillText(t, cx + Math.sin(a) * R * 0.6, cy - Math.cos(a) * R * 0.6); });
    g.strokeStyle = '#2c2e2d'; g.lineWidth = R * 0.08;
    g.beginPath(); g.arc(cx, cy, R + R * 0.04, 0, Math.PI * 2); g.stroke();
  };
  face(128, 128, 118, ['0', '20', '40', '60', '80', '0', '20', '40', '60', '80'], 100);
  face(384, 128, 118, ['0', '4', '8', '12', '16', '20', '24', '28'], 64);
  face(640, 128, 118, ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'], 50);
  // receiver plate: grey cast box face with the two windows, screws
  g.fillStyle = '#5a5e5c'; g.fillRect(768, 40, 256, 176);
  g.fillStyle = '#26282a';
  for (const [x, y] of [[778, 50], [1010, 50], [778, 202], [1010, 202]]) { g.beginPath(); g.arc(x, y, 4, 0, 7); g.fill(); }
  g.save(); g.translate(768, 40); g.scale(1, 1);
  g.fillStyle = '#121312'; g.beginPath(); g.ellipse(128, 88, 116, 78, 0, 0, Math.PI * 2); g.fill();
  g.restore();
  // copy the faces into the plate's window
  g.drawImage(c, 256, 0, 256, 256, 790, 70, 116, 116);
  g.drawImage(c, 0, 0, 256, 256, 880, 58, 140, 140);
  dialTex = canvasTex(c);
  dialTex.wrapS = dialTex.wrapT = THREE.ClampToEdgeWrapping;
  return dialTex;
}
export const DIAL_CELLS = { fine: [0, 0, 256, 256], coarse: [256, 0, 256, 256], plain: [512, 0, 256, 256], plate: [768, 40, 256, 176] };

// A flat quad (w by h, facing +Z, centred) whose UVs pick an atlas cell [x, y, w, h] of a W by H canvas.
export function cellQuad(w, h, cell, W = 1024, H = 256) {
  const g = new THREE.PlaneGeometry(w, h);
  const uv = g.attributes.uv, [cx, cy, cw, ch] = cell;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (cx + uv.getX(i) * cw) / W, 1 - (cy + (1 - uv.getY(i)) * ch) / H);
  return g;
}

// White stencilled numerals on a transparent atlas (the clock numbers 1 to 12 on the pit walls, the
// numbers on the predictor's tube): 16 cells of 128 x 128 in a 512 x 512 canvas, cell i holds String(i)
// (cells 1 to 15 used).
let numTex;
export function numeralTexture() {
  if (numTex) return numTex;
  const c = mkCanvas(512, 512), g = c.getContext('2d');
  g.fillStyle = '#ecebe2'; g.textAlign = 'center'; g.textBaseline = 'middle';
  for (let i = 1; i < 16; i++) {
    const x = (i % 4) * 128 + 64, y = Math.floor(i / 4) * 128 + 66;
    g.save(); g.translate(x, y); g.scale(String(i).length > 1 ? 0.62 : 0.8, 1);
    g.font = 'bold 108px sans-serif';
    g.fillText(String(i), 0, 0);
    g.restore();
  }
  // brush texture: thin the paint in places
  const img = g.getImageData(0, 0, 512, 512), d = img.data, rnd = mulberry32(9);
  for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 0) d[i + 3] *= 0.8 + 0.2 * rnd() - (pnoise((i / 4 % 512) / 512, Math.floor(i / 4 / 512) / 512, 30, 30, 5) > 0.75 ? 0.4 : 0);
  g.putImageData(img, 0, 0);
  numTex = new THREE.CanvasTexture(c);
  numTex.colorSpace = THREE.SRGBColorSpace;
  numTex.anisotropy = 8;
  return numTex;
}
export const numeralCell = (n) => [(n % 4) * 128, Math.floor(n / 4) * 128, 128, 128];

// Walk-on grating (the predictor's round platform, kg40_01, kg40_02): a square mesh of flat bars, 0.5 m
// tile, light bars on a dark ground (the platform is solid underneath at game range).
let grateTex;
export function grateTexture() {
  if (grateTex) return grateTex;
  const c = mkCanvas(256), g = c.getContext('2d');
  g.fillStyle = '#1c1d1c'; g.fillRect(0, 0, 256, 256);
  g.fillStyle = '#9a9c98';
  for (let i = 0; i < 16; i++) { g.fillRect(i * 16, 0, 3, 256); g.fillRect(0, i * 16 + 6, 256, 2); }
  grateTex = canvasTex(c);
  return grateTex;
}

// ---------------------------------------------------------------- materials

const std = (c, rough, metal, extra = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: rough, metalness: metal, vertexColors: true, ...extra });
const matCache = new Map();
// One material per painted scheme for the painted steel, and the shared rest. Keys:
//   paint (scheme)  painted steel, chips and wear in the texture; tint per part with vertex colours
//   metal           bare and oiled steel (breech, slides, bores, spindles, handwheel rims)
//   black           rubber, bakelite grips, cables, the black dial housings
//   brass           cartridge cases (88 mm, 37 mm and 20 mm); steel cases take a grey-green tint
//   shell           projectile paint (yellow HE, with tints)
//   white           painted white: kill rings, stencils
//   glass           dial glass, sight lenses
//   dial            the follow-the-pointer dial faces (dialTexture)
//   numerals        stencilled numbers (transparent, numeralTexture)
//   wood            timber: planks, posts, logs, boxes, baskets (tints)
//   soil            the earth banks and floors (soilTextures, 8 m tile)
//   sand            sandbags (hessian)
//   cloth           camouflage nets and tarpaulins (double sided)
export function flakMats(scheme = 'grey') {
  const key = 'm-' + scheme;
  if (matCache.has(key)) return matCache.get(key);
  const shared = sharedMats();
  const tex = paintTextures(scheme);
  const paint = std(0xffffff, 1, 0, { map: tex.map, roughnessMap: tex.rough, normalMap: tex.normal });
  paint.normalScale.set(0.6, 0.6);
  surfaceFinish(paint, 'ww2-paint-' + scheme, { mud: 0.55, mudTop: 0.6, dust: 0.45, dustColor: 0x8d8670, mudColor: 0x4a3d2c });
  paint.name = 'paint-' + scheme;
  const m = { ...shared, paint };
  matCache.set(key, m);
  return m;
}

let sharedSet;
function sharedMats() {
  if (sharedSet) return sharedSet;
  const grain = grainTextures(), wood = woodTextures(), soil = soilTextures(), hes = hessianTextures();
  const fin = (m, key, ns, o = {}) => {
    m.roughnessMap = grain.rough;
    m.normalMap = grain.normal;
    m.normalScale.set(ns, ns);
    return surfaceFinish(m, 'ww2-' + key, { mud: 0.4, mudTop: 0.5, dust: 0.3, dustColor: 0x8d8670, mudColor: 0x4a3d2c, ...o });
  };
  const woodM = std(0xffffff, 1, 0, { map: wood.map, roughnessMap: wood.rough, normalMap: wood.normal });
  surfaceFinish(woodM, 'ww2-wood', { mud: 0.6, mudTop: 0.5, dust: 0.25, dustColor: 0x8a7f66, mudColor: 0x3f3527 });
  const soilM = std(0xffffff, 1, 0, { map: soil.map, roughnessMap: soil.rough, normalMap: soil.normal, side: THREE.DoubleSide });
  const sandM = std(0xffffff, 1, 0, { map: hes.map, roughnessMap: hes.rough, normalMap: hes.normal });
  surfaceFinish(sandM, 'ww2-sand', { mud: 0.5, mudTop: 0.6, dust: 0.2, dustColor: 0x8a7f66, mudColor: 0x463b2c });
  const dial = new THREE.MeshStandardMaterial({ map: dialTexture(), roughness: 0.35, metalness: 0.0, vertexColors: true, envMapIntensity: 1.3 });
  const numerals = new THREE.MeshStandardMaterial({ map: numeralTexture(), transparent: true, alphaTest: 0.35, roughness: 0.85, metalness: 0, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
  sharedSet = {
    metal: fin(std(0x80858a, 0.45, 0.75), 'metal', 0.8, { mud: 0.3, dust: 0.2 }),
    black: fin(std(0x1e1f1e, 0.72, 0.05), 'black', 0.5),
    brass: std(0x9c7c3c, 0.34, 0.9),
    shell: fin(std(0xb69c3f, 0.6, 0.1), 'shell', 0.4, { mud: 0.2, dust: 0.2 }),
    white: fin(std(0xd9d6cb, 0.82, 0.0, { polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 }), 'white', 0.4, { mud: 0.2, dust: 0.3 }),
    glass: std(0x1d2a30, 0.05, 0.4, { envMapIntensity: 2.0, transparent: true, opacity: 0.55, depthWrite: false }),
    dial,
    numerals,
    wood: woodM,
    soil: soilM,
    sand: sandM,
    cloth: fin(std(0x4d4f3a, 0.95, 0, { side: THREE.DoubleSide }), 'cloth', 1.0, { mud: 0.3, dust: 0.3 }),
    grate: std(0xffffff, 0.6, 0.5, { map: grateTexture() }),
    net: std(0x4f513c, 1, 0, { side: THREE.DoubleSide, transparent: true, opacity: 0.85, depthWrite: false }),
  };
  return sharedSet;
}

// Swap a rig's painted meshes to a scheme ('grey' | 'yellow'). The paint material of every scheme is
// tagged, so meshes in any pivot follow.
export function setPaint(root, scheme) {
  const to = flakMats(scheme).paint;
  root.traverse((o) => { if (o.isMesh && o.material && o.material.name && o.material.name.startsWith('paint-')) o.material = to; });
}

// A hidden mesh carrying the other paint schemes' materials, so the framework patches them with the
// visible ones (patchSceneFog walks hidden objects too); it never draws.
export function paintCarrier(root) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0, 0, 0, 0], 3));
  for (const s of Object.keys(PAINT)) {
    const m = new THREE.Mesh(g, flakMats(s).paint);
    m.name = 'paintCarrier';
    m.visible = false;
    m.frustumCulled = true;
    root.add(m);
  }
}

// ---------------------------------------------------------------- parts collector helpers

// UVs projected per face at a given tile (metres), then added under key with a tint.
export function add(P, key, g, tint = 0xffffff, tile = 2) {
  let n = g.index ? g.toNonIndexed() : g;
  if (!n.attributes.normal) n.computeVertexNormals();
  if (tile) projectUV(n, tile);
  P.add(key, n, { tint, uv: true });
  return P;
}
// a geometry and its mirror across x = 0
export function addSym(P, key, g, tint, tile) {
  const n = g.index ? g.toNonIndexed() : g;
  add(P, key, n.clone(), tint, tile);
  return add(P, key, mirrorX(n), tint, tile);
}

// Build a Parts set under a parent with the height of the parent's origin above the ground (dirt). Small
// black parts (grips, cables, rubber) fold into the set's bare metal, darkened, when it has both, to save
// a draw call per set: at game range dark oiled steel and black rubber read the same.
export function build(P, parent, y0 = 0, dirt = 0.25) {
  const blk = P.lists.get('black'), met = P.lists.get('metal');
  if (blk && met) {
    for (const g of blk) {
      const c = g.attributes.color;
      for (let i = 0; i < c.count; i++) c.setXYZ(i, c.getX(i) * 0.16, c.getY(i) * 0.16, c.getZ(i) * 0.16);
      met.push(g);
    }
    P.lists.delete('black');
  }
  return P.build(parent, { dirt, y0 });
}

// A mesh that never casts a shadow even though buildVehicle switches every mesh's flag on (small
// decals, dial faces and glass: their shadow pass would cost draw calls for nothing).
export function noShadow(mesh) {
  Object.defineProperty(mesh, 'castShadow', { get: () => false, set: () => {}, configurable: true });
  return mesh;
}

// ---------------------------------------------------------------- geometry pieces

// Tube along an arbitrary straight axis: from a to b, radius r0 at a and r1 at b.
export function tubeAB(a, b, r0, r1 = r0, seg = 12, open = false) {
  const d = b.clone().sub(a), len = d.length();
  const g = new THREE.CylinderGeometry(r1, r0, len, seg, 1, open);
  const q = new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), d.normalize());
  return g.applyMatrix4(new THREE.Matrix4().compose(a.clone().add(b).multiplyScalar(0.5), q, V(1, 1, 1)));
}

// A spoked handwheel in the XY plane (axle along +Z), centred at the origin: rim, hub, spokes and a
// handle knob on the rim at the top (pointing +Z).
export function handwheel(R, { spokes = 3, rim = 0.012, hub = 0.03, knob = 0.07, seg = 20 } = {}) {
  const parts = [new THREE.TorusGeometry(R, rim, 6, seg)];
  parts.push(zTube(-0.02, 0.025, hub, hub, 10));
  for (let i = 0; i < spokes; i++) {
    const a = (i / spokes) * Math.PI * 2 + Math.PI / 2;
    parts.push(rod(V(0, 0, 0.0), V(Math.cos(a) * R, Math.sin(a) * R, 0), rim * 0.75, 5));
  }
  if (knob) {
    parts.push(zTube(0, knob, 0.009, 0.009, 6, 0, R));
    parts.push(zTube(knob * 0.35, knob + 0.015, 0.014, 0.012, 8, 0, R));
  }
  return mergeGeometries(parts.map((p) => (p.index ? p.toNonIndexed() : p)).map((p) => { for (const k of Object.keys(p.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') p.deleteAttribute(k); return p; }));
}

// A pan seat on a post: pan of radius r at height h above y0, post down to y0 (vertical), optional back.
export function panSeat(P, key, x, y0, z, h, r = 0.15, back = false, ry = 0) {
  const M = xf(x, y0, z, 0, ry, 0);
  add(P, key, yTube(0, h - 0.03, 0.025, 0.025, 8).applyMatrix4(M));
  add(P, key, yTube(h - 0.04, h, r, r * 0.95, 14).applyMatrix4(M));
  add(P, key, yTube(h - 0.06, h - 0.04, r * 0.6, r * 0.6, 12).applyMatrix4(M));
  if (back) add(P, key, box(r * 1.6, 0.22, 0.03, 0, h + 0.18, r * 0.9).applyMatrix4(M));
}

// ---------------------------------------------------------------- emplacements

// Plank-revetted pit with an earth bank outside (refs/ww2/flak88 section 11: Berlin-Karow and the 1943
// Bundesarchiv pits). A regular polygon of `sides` wall panels round the origin, inner apothem R, wall
// height H above the floor (y = 0, the ground): posts at the corners and mid-panel, horizontal planks and
// a wide top board (the clock numbers are painted on it). Panels listed in `open` are left out (an
// entrance), the bank cut there with plank cheek walls; `holes` ({ i, w, y0, h }) cut openings in a
// panel's planks (ammunition niches). Returns { panels: [{ i, a, c, n, w, open }], R, H, sides, w }.
// Clock convention: panel i is centred at bearing i * 360 / sides clockwise from -Z seen from above, so
// with 12 sides panel i is i o'clock (0 is 12) and the model's front is 12.
export function plankPit(P, { R = 4, H = 1.4, sides = 12, open = [], holes = [], bank = 2.8, crown = 0.8, planks = 7, rnd = mulberry32(3), posts = true } = {}) {
  const panels = [];
  const half = Math.PI / sides, Rc = R / Math.cos(half);
  const w = 2 * R * Math.tan(half);
  const corner = (k) => { const a = (k - 0.5) * (2 * half); return V(Math.sin(a) * Rc, 0, -Math.cos(a) * Rc); };
  const top = 0.2, ph = (H - top) / planks; // the planks up to the top board
  for (let i = 0; i < sides; i++) {
    const a = i * 2 * half, n = V(-Math.sin(a), 0, Math.cos(a)), c = V(Math.sin(a) * R, 0, -Math.cos(a) * R);
    panels.push({ i, a, c, n, w, open: open.includes(i) });
    if (open.includes(i)) continue;
    const M = xf(c.x, 0, c.z, 0, -a, 0); // panel along its tangent; local +Z points into the pit
    const hole = holes.find((h) => h.i === i);
    for (let k = 0; k < planks; k++) {
      const t = 0.04 + rnd() * 0.01, y = (k + 0.5) * ph, zc = -t / 2 - 0.03, tint = k % 2 ? 0xd8d0c4 : 0xffffff;
      const x0 = -w / 2 - 0.04, x1 = w / 2 + 0.04;
      const pieces = hole && y + ph / 2 > hole.y0 && y - ph / 2 < hole.y0 + hole.h ? [[x0, -hole.w / 2], [hole.w / 2, x1]] : [[x0, x1]];
      for (const [u0, u1] of pieces) add(P, 'wood', box(u1 - u0, ph * 0.94, t, (u0 + u1) / 2 + (rnd() - 0.5) * 0.02, y, zc, 0, 0, (rnd() - 0.5) * 0.008).applyMatrix4(M), tint);
    }
    // the top board, proud of the planks, and a cap rail on it
    add(P, 'wood', box(w + 0.1, top, 0.05, 0, H - top / 2, 0.0).applyMatrix4(M), 0xe8e2d6);
    add(P, 'wood', box(w + 0.1, 0.05, 0.16, 0, H + 0.025, -0.04).applyMatrix4(M), 0xd8d0c2);
    if (posts) add(P, 'wood', yTube(-0.05, H - top, 0.065, 0.06, 7, 0, 0.05).applyMatrix4(M), 0xcfc4b3); // mid post, in front of the planks
  }
  // corner posts
  for (let k = 0; k < sides; k++) {
    const p = corner(k);
    if (!open.includes(k) || !open.includes((k - 1 + sides) % sides)) add(P, 'wood', yTube(-0.05, H + 0.06, 0.08, 0.075, 8, p.x * 0.99, p.z * 0.99), 0xc8bdab);
  }
  earthBank(P, { R: R + 0.08, H, sides, open, bank, crown, rnd });
  // entrance cheek walls: planks along both sides of each open panel, holding the bank ends
  for (const i of open) {
    for (const s of [-1, 1]) {
      const p = corner(s < 0 ? i : i + 1), a = Math.atan2(p.x, -p.z), dir = V(Math.sin(a), 0, -Math.cos(a));
      const L = crown + 0.7, mid = p.clone().addScaledVector(dir, L / 2);
      const M = xf(mid.x, 0, mid.z, 0, Math.PI / 2 - a, 0);
      for (let k2 = 0; k2 < planks + 1; k2++) add(P, 'wood', box(L, (H / (planks + 1)) * 0.94, 0.04, 0, (k2 + 0.5) * (H / (planks + 1)), s * 0.03).applyMatrix4(M), k2 % 2 ? 0xd8d0c4 : 0xffffff);
      const end = p.clone().addScaledVector(dir, L);
      add(P, 'wood', yTube(-0.05, H + 0.05, 0.07, 0.065, 7, end.x, end.z), 0xc8bdab);
    }
  }
  return { panels, R, H, sides, w, top };
}

// The clock numbers on the top boards of a plankPit (panel i carries i, 0 carries 12; open panels none),
// white stencils about `size` m tall, into the 'numerals' key.
export function clockNumbers(P, pit, size = 0.16) {
  for (const pn of pit.panels) {
    if (pn.open) continue;
    const n = pn.i === 0 ? 12 : pn.i * (12 / pit.sides);
    if (!Number.isInteger(n)) continue;
    const q = cellQuad(size, size, numeralCell(n), 512, 512);
    q.applyMatrix4(xf(pn.c.x, 0, pn.c.z, 0, -pn.a, 0).multiply(xf(0, pit.H - pit.top / 2, 0.027)));
    P.add('numerals', q, { uv: true });
  }
}

// The earth bank against the outside of a polygonal wall: crown flat for `crown` m, then sloping to the
// ground over `bank` m, irregular; open panels cut, each cut end a rounded slope down to the ground.
export function earthBank(P, { R, H, sides, open = [], bank = 2.8, crown = 0.8, rnd = mulberry32(3), segPer = 4 }) {
  const Nseg = sides * segPer, half = Math.PI / sides;
  const prof = [[0, H + 0.02], [crown * 0.5, H + 0.12], [crown, H + 0.05], [crown + bank * 0.35, H * 0.62], [crown + bank * 0.75, H * 0.18], [crown + bank, -0.05]];
  const noise = Array.from({ length: Nseg + 1 }, () => [rnd() - 0.5, rnd() - 0.5]);
  const isOpen = (j) => open.includes(Math.floor((((j % Nseg) + Nseg) % Nseg + 0.5) / segPer) % sides);
  const pos = [];
  const pt = (j, k, endScale = 1) => {
    const a = (j / segPer - 0.5) * 2 * half; // polygon from corner to corner
    const panelA = Math.round(j / segPer - 0.5) * 2 * half;
    const along = Math.cos(a - panelA); // apothem distance correction: the wall is straight per panel
    const r0 = R / Math.max(0.5, along);
    const [dr, dy] = prof[k];
    const nz = noise[j % Nseg];
    const r = r0 + dr * (1 + nz[0] * 0.25) + (k > 1 ? nz[1] * 0.25 : 0);
    const y = Math.max(-0.05, (dy + (k > 0 && k < prof.length - 1 ? nz[1] * 0.15 : 0)) * endScale);
    return V(Math.sin(a) * r, y, -Math.cos(a) * r);
  };
  for (let j = 0; j < Nseg; j++) {
    if (isOpen(j)) continue;
    // a cut end next to an open segment slumps down
    const sa = isOpen((j - 1 + Nseg) % Nseg) ? 0.35 : 1, sb = isOpen((j + 1) % Nseg) ? 0.35 : 1;
    for (let k = 0; k < prof.length - 1; k++) {
      const a0 = pt(j, k, sa), a1 = pt(j + 1, k, sb), b0 = pt(j, k + 1, sa), b1 = pt(j + 1, k + 1, sb);
      pos.push(a0, a1, b0, a1, b1, b0); // counterclockwise seen from above (the angle runs clockwise)
    }
    // close the cut ends with a sloping face
    if (sa < 1) for (let k = 0; k < prof.length - 1; k++) { const a = pt(j, k, sa), b = pt(j, k + 1, sa); pos.push(a, b, V(a.x, -0.05, a.z)); }
    if (sb < 1) for (let k = 0; k < prof.length - 1; k++) { const a = pt(j + 1, k, sb), b = pt(j + 1, k + 1, sb); pos.push(a, V(a.x, -0.05, a.z), b); }
  }
  const g = new THREE.BufferGeometry().setFromPoints(pos);
  g.computeVertexNormals();
  const uv = new Float32Array(pos.length * 2);
  pos.forEach((p, i) => { uv[i * 2] = p.x / 8; uv[i * 2 + 1] = p.z / 8 + p.y / 8; });
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  P.add('soil', g, { uv: true });
}

// A round earth pit or ring parapet (light guns, the predictor): a low bank of radius R round a level
// floor, crown at height H, with optional gaps (angles in radians, clockwise from -Z, half-width).
export function ringBank(P, { R = 3, H = 0.7, bank = 1.6, crown = 0.5, seg = 40, gaps = [], rnd = mulberry32(7), inner = 0.35, key = 'soil' }) {
  const prof = [[-inner, -0.02], [0, H * 0.85], [crown * 0.5, H], [crown, H * 0.9], [crown + bank * 0.5, H * 0.4], [crown + bank, -0.05]];
  const noise = Array.from({ length: seg + 1 }, () => [rnd() - 0.5, rnd() - 0.5]);
  const gapAt = (a) => gaps.some(([c, hw]) => Math.abs(Math.atan2(Math.sin(a - c), Math.cos(a - c))) < hw);
  const pos = [];
  const pt = (j, k, s = 1) => {
    const a = (j / seg) * Math.PI * 2, nz = noise[j % seg];
    const [dr, dy] = prof[k];
    const r = R + dr * (1 + nz[0] * 0.25) + nz[1] * 0.12;
    return V(Math.sin(a) * r, Math.max(-0.05, (dy + (k > 0 && k < prof.length - 1 ? nz[1] * 0.1 : 0)) * s), -Math.cos(a) * r);
  };
  for (let j = 0; j < seg; j++) {
    const am = ((j + 0.5) / seg) * Math.PI * 2;
    if (gapAt(am)) continue;
    const sa = gapAt(((j - 0.5) / seg) * Math.PI * 2) ? 0.3 : 1, sb = gapAt(((j + 1.5) / seg) * Math.PI * 2) ? 0.3 : 1;
    for (let k = 0; k < prof.length - 1; k++) {
      const a0 = pt(j, k, sa), a1 = pt(j + 1, k, sb), b0 = pt(j, k + 1, sa), b1 = pt(j + 1, k + 1, sb);
      pos.push(a0, a1, b0, a1, b1, b0);
    }
  }
  const g = new THREE.BufferGeometry().setFromPoints(pos);
  g.computeVertexNormals();
  const uv = new Float32Array(pos.length * 2);
  pos.forEach((p, i) => { uv[i * 2] = p.x / 8; uv[i * 2 + 1] = p.z / 8 + p.y / 8; });
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  P.add(key, g, { uv: true });
}

// A level earth floor disc (radius R) a little above the ground, so the terrain does not show through.
export function floorDisc(P, R, y = 0.01, seg = 32, key = 'soil') {
  const g = new THREE.CircleGeometry(R, seg).rotateX(-Math.PI / 2).translate(0, y, 0);
  const n = g.toNonIndexed();
  const p = n.attributes.position, uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) { uv[i * 2] = p.getX(i) / 8; uv[i * 2 + 1] = p.getZ(i) / 8; }
  n.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  P.add(key, n, { uv: true, tint: 0x9a8f80 });
}

// A wall of sandbags along x from x0 to x1 (at z, base y0), `rows` courses, bonded half a bag.
export function sandbagWall(P, x0, x1, z, rows, { y0 = 0, ry = 0, ox = 0, oz = 0, bag = [0.6, 0.16, 0.34], rnd = mulberry32(11) } = {}) {
  const L = Math.abs(x1 - x0), n = Math.max(1, Math.round(L / bag[0]));
  const M = xf(ox, 0, oz, 0, ry, 0);
  for (let r = 0; r < rows; r++) {
    const off = (r % 2) * 0.5;
    for (let i = 0; i < n + (r % 2 ? -1 : 0); i++) {
      const x = Math.min(x0, x1) + (i + 0.5 + off) * (L / n);
      const g = sandbag(bag, rnd).applyMatrix4(xf(x, y0 + r * bag[1] * 0.92 + bag[1] / 2, z + (rnd() - 0.5) * 0.03, 0, (rnd() - 0.5) * 0.08, (rnd() - 0.5) * 0.04));
      add(P, 'sand', g.applyMatrix4(M), 0xffffff, 0.5);
    }
  }
}
// one sandbag: a box with rounded, bulging faces
export function sandbag([w, h, d], rnd = Math.random) {
  const g = new THREE.BoxGeometry(w, h, d, 3, 2, 2);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i) / (w / 2), y = p.getY(i) / (h / 2), z = p.getZ(i) / (d / 2);
    const b = (1 - y * y * 0.6) * 0.08, s = 1 - 0.15 * Math.max(0, Math.abs(x) - 0.6);
    p.setXYZ(i, p.getX(i) * (1 + b * 0.2) * (1 - 0.08 * y * y), p.getY(i) * (1 - 0.1 * x * x) * s, p.getZ(i) * (1 + b) * (1 - 0.12 * x * x));
  }
  g.computeVertexNormals();
  return g;
}

// ---------------------------------------------------------------- ammunition

// The base of a round seen end on in a niche or a rack: case head (radius r), rim and primer, the
// case running back `len` m along +Z from z = 0 (its head).
export function caseHead(P, x, y, z, r, len = 0.12, ry = 0, rx = 0, key = 'brass', tint = 0xffffff) {
  const M = xf(x, y, z, rx, ry, 0);
  add(P, key, zTube(0, len, r, r * 0.97, 10, 0, 0).applyMatrix4(M), tint, 0);
  add(P, key, zTube(-0.006, 0.004, r * 1.06, r * 1.06, 10, 0, 0).applyMatrix4(M), tint, 0);
  add(P, 'metal', zTube(-0.008, -0.004, r * 0.22, r * 0.22, 6, 0, 0).applyMatrix4(M), 0xb8a070, 0);
}

// A complete fixed round lying along -Z from its base at the origin: case (brass), projectile (shell
// paint) with ogive and fuze. Sizes for the 8.8 cm: case 0.570 m by 0.1 m (rim 0.112), round 0.932 m.
export function roundGeometry({ caseL = 0.57, caseR = 0.05, neckR = 0.046, projL = 0.36, projR = 0.044, fuzeL = 0.1, seg = 12 } = {}) {
  const caseG = [zTube(0, -caseL * 0.86, caseR, caseR * 0.97, seg), zTube(-caseL * 0.86, -caseL * 0.92, caseR * 0.97, neckR, seg), zTube(-caseL * 0.92, -caseL, neckR, neckR, seg),
    zTube(0.004, -0.006, caseR * 1.12, caseR * 1.12, seg)];
  const z0 = -caseL;
  const shellG = [zTube(z0, z0 - projL * 0.55, projR, projR, seg), zTube(z0 - projL * 0.55, z0 - projL, projR, projR * 0.38, seg)];
  const fuzeG = [zTube(z0 - projL, z0 - projL - fuzeL, projR * 0.38, projR * 0.12, seg)];
  const band = [zTube(z0 - projL * 0.12, z0 - projL * 0.18, projR * 1.04, projR * 1.04, seg)];
  return { caseG, shellG, fuzeG, band };
}

// ---------------------------------------------------------------- crew spots

// A crew spot: an Object3D whose position is where the man stands (or the seat point, `seated`), whose
// -Z is the way he faces; userData = { job, pose, seated, label }. Parent decides whether he rides round
// with the mount (a child of the turret pivot) or stays on the ground (the root).
export function crewSpot(parent, name, x, y, z, faceDeg, data) {
  const o = new THREE.Object3D();
  o.name = 'crew-' + name;
  o.position.set(x, y, z);
  o.rotation.y = faceDeg * DEG;
  o.userData = { job: name, pose: 'stand', seated: false, ...data };
  parent.add(o);
  return o;
}

// ---------------------------------------------------------------- instanced dial pointers

const _z = new THREE.Vector3(0, 0, 1);
// Every pointer of a rig's dials in one InstancedMesh (one draw call): `slots` are { parent, pos, face,
// len, width, color } in their parent's space (face = the dial's outward normal). Its updateMatrix calls
// `drive(angles)` to get one angle per slot (radians, clockwise as seen on the dial) and writes the
// instance matrices before every frame. Build it last on the rig's root (see below).
export function pointerSet(root, slots, drive) {
  const geo = new THREE.PlaneGeometry(1, 1).translate(0, 0.38, 0); // pivots near its tail
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5, metalness: 0 });
  const mesh = new THREE.InstancedMesh(geo, mat, slots.length);
  mesh.name = 'pointers';
  mesh.frustumCulled = false;
  noShadow(mesh);
  const col = new THREE.Color();
  slots.forEach((s, i) => mesh.setColorAt(i, col.set(s.color ?? 0xf0eee2)));
  const angles = new Float32Array(slots.length);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), qr = new THREE.Quaternion(), sc = new THREE.Vector3(), p = new THREE.Vector3();
  const base = slots.map((s) => {
    const n = new THREE.Vector3(...s.face).normalize();
    const up = Math.abs(n.y) > 0.9 ? new THREE.Vector3(0, 0, -1) : new THREE.Vector3(0, 1, 0);
    return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(n, new THREE.Vector3(), up));
  });
  const rel = new THREE.Matrix4();
  root.add(mesh);
  // Runs in the scene's updateMatrixWorld walk: the mesh is the root's last child at build time, so the
  // pivots' local matrices are already current; chain them up to the root.
  mesh.updateMatrix = function () {
    THREE.Object3D.prototype.updateMatrix.call(this);
    drive(angles);
    slots.forEach((s, i) => {
      qr.setFromAxisAngle(_z, -angles[i]);
      q.copy(base[i]).multiply(qr);
      p.set(...s.pos);
      sc.set(s.width, s.len, 1);
      m.compose(p, q, sc);
      rel.identity();
      for (let o = s.parent; o && o !== root; o = o.parent) rel.premultiply(o.matrix);
      m.premultiply(rel);
      mesh.setMatrixAt(i, m);
    });
    mesh.instanceMatrix.needsUpdate = true;
  };
  return mesh;
}

// Every handwheel of a rig in one InstancedMesh (one draw call): `wheels` are { node, R, M } where node is
// the Object3D the wheel turns with (its updateMatrix poses it), R its radius and M a Matrix4 that orients
// the unit wheel (axle along +Z) in the node's space. Build it last on the rig's root, after the nodes'
// parents exist (the matrices chain the nodes' local matrices up to the root, as pointerSet does).
export function wheelSet(root, wheels, material, { spokes = 3 } = {}) {
  const geo = handwheel(1, { spokes, rim: 0.075, hub: 0.2, knob: 0.45 });
  const mesh = new THREE.InstancedMesh(geo, material, wheels.length);
  mesh.name = 'handwheels';
  mesh.frustumCulled = false;
  noShadow(mesh);
  const m = new THREE.Matrix4(), rel = new THREE.Matrix4(), s = new THREE.Matrix4();
  root.add(mesh);
  mesh.updateMatrix = function () {
    THREE.Object3D.prototype.updateMatrix.call(this);
    wheels.forEach((w, i) => {
      rel.identity();
      for (let o = w.node; o && o !== root; o = o.parent) rel.premultiply(o.matrix);
      m.copy(rel).multiply(w.M || s.identity()).multiply(s.makeScale(w.R, w.R, w.R));
      mesh.setMatrixAt(i, m);
    });
    mesh.instanceMatrix.needsUpdate = true;
  };
  return mesh;
}
