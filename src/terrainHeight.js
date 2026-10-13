// Pure terrain height (no DOM, no three): importable in Node, used by the sim for terrain following
// and radar masking and by the renderer to build the mesh, so the two always agree.
//
// Rolling steppe with long swells, a meandering river valley, a few long low ridges 9 to 18 km out
// (up to ~150 m, placed where they mask low flyers from the radars) and the flattened pads of the era
// in play from deploy.js. Everything is deterministic value noise from an integer hash.
//
// An era may bring its own landscape: its `terrain` style (eras/<id>.js; the WW2 era's is
// eras/ww2/terrain.js) replaces the natural ground and its waters with style.height(x, z, fine), and the
// pads are levelled on that. Without one (the modern era) the steppe below is used, unchanged.
import { flatPads, ERA } from './deploy.js';

// the era in play's terrain style, or null for the steppe
let STYLE = null, styleEra = null;
export function terrainStyle() {
  if (styleEra !== ERA) {
    styleEra = ERA;
    STYLE = ERA.terrain ?? null;
  }
  return STYLE;
}

const smooth = (a, b, x) => {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
};

// integer hash in [0, 1); the same function exists in GLSL (terrainField.js) so fields match
export function ihash(x, y, s) {
  let h = Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1) ^ Math.imul(s, 0x9e3779b1);
  h ^= h >>> 15;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 8) / 16777216;
}

// smooth value noise in [0, 1]
function vn(x, z, s) {
  const xi = Math.floor(x), zi = Math.floor(z);
  const fx = x - xi, fz = z - zi;
  const ux = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
  const uz = fz * fz * fz * (fz * (fz * 6 - 15) + 10);
  const a = ihash(xi, zi, s), b = ihash(xi + 1, zi, s), c = ihash(xi, zi + 1, s), d = ihash(xi + 1, zi + 1, s);
  return a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz;
}

// Low ridges: a long crest line with a gaussian cross profile, wandering sideways and varying in height
const RIDGES = [
  // west-south-west, across the main threat axis (bearing 250)
  { cx: -10600, cz: 3300, dx: 0.3, dz: -0.954, len: 14000, w: 1900, h: 150, s: 21 },
  { cx: -13500, cz: -5200, dx: 0.25, dz: -0.968, len: 9000, w: 1500, h: 120, s: 22 },
  // north, east and south: weaker cover for the low-level routes
  { cx: -1800, cz: -12800, dx: 0.97, dz: 0.24, len: 12000, w: 1700, h: 105, s: 23 },
  { cx: 14500, cz: -2200, dx: 0.1, dz: 0.995, len: 11000, w: 1800, h: 120, s: 24 },
  { cx: 3500, cz: 12600, dx: 0.96, dz: -0.28, len: 12000, w: 1600, h: 95, s: 25 },
];
for (const R of RIDGES) {
  const l = Math.hypot(R.dx, R.dz);
  R.dx /= l;
  R.dz /= l;
}

function ridges(x, z) {
  let h = 0;
  for (const R of RIDGES) {
    const px = x - R.cx, pz = z - R.cz;
    const s = px * R.dx + pz * R.dz;
    const half = R.len * 0.5;
    if (s < -half - 3000 || s > half + 3000) continue;
    const d = -px * R.dz + pz * R.dx + (vn(s / 2800, 0.5, R.s) - 0.5) * 2400;
    if (Math.abs(d) > R.w * 3.2) continue;
    const along = smooth(-half - 2500, -half + 2500, s) * (1 - smooth(half - 2500, half + 2500, s));
    const cross = Math.exp(-(d / R.w) * (d / R.w));
    const crest = Math.min(1, 0.5 + 0.9 * vn(s / 1700, 3.3, R.s + 5));
    const rough = 0.8 + 0.3 * vn(x / 420, z / 420, R.s + 9) + 0.12 * vn(x / 110, z / 110, R.s + 11);
    h += R.h * 0.88 * along * cross * crest * rough;
  }
  return h;
}

// rolling ground; `fine` false drops the small octaves (far mesh levels, river bed)
function rolling(x, z, fine) {
  let h = 40 * (vn(x / 5200, z / 5200, 1) - 0.5) + 22 * (vn(x / 2100 + 7.1, z / 2100 + 3.3, 2) - 0.5) + 7 * (vn(x / 760, z / 760, 3) - 0.5);
  if (fine) h += 1.9 * (vn(x / 240, z / 240, 4) - 0.5) + 0.5 * (vn(x / 70, z / 70, 5) - 0.5) + 0.12 * (vn(x / 21, z / 21, 6) - 0.5);
  return h;
}

function calmAt(x, z) {
  // the airbase sits on a near-level plain
  return 0.07 + 0.93 * smooth(900, 3800, Math.hypot(x, z));
}

function farHills(x, z) {
  const m = smooth(15000, 24000, Math.hypot(x, z));
  if (m <= 0) return 0;
  return m * (62 * Math.pow(vn(x / 7000 + 3, z / 7000 + 9, 9), 1.6) + 26 * vn(x / 2600, z / 2600, 10));
}

const natural0 = (x, z, fine) => rolling(x, z, fine) * calmAt(x, z) + ridges(x, z) + farHills(x, z);

// ---------------------------------------------------------------- river
export const RIVER = { halfWidth: 26, bank: 130, depth: 1.4 };
export function riverCenterZ(x) {
  return -3300 + 700 * Math.sin(x / 3100 + 0.6) + 260 * Math.sin(x / 1100 + 2.0) + 85 * Math.sin(x / 380);
}
// surface level of the river at x: the swells along its course, low-passed so it runs smoothly
export function riverLevel(x) {
  const z = riverCenterZ(x);
  return natural0(x, z, false) - 3.2;
}

function withRiver(x, z, h) {
  const zc = riverCenterZ(x);
  const d = Math.abs(z - zc);
  if (d >= RIVER.bank) return h;
  const lvl = riverLevel(x);
  const bed = lvl - RIVER.depth;
  // a flat bed, steep banks up to just over the water line, then easing into the natural ground
  const channel = bed + (RIVER.depth + 0.4) * smooth(18, 30, d);
  const t = smooth(30, RIVER.bank, d);
  return channel + (Math.max(h, lvl + 0.4) - channel) * t;
}

// ---------------------------------------------------------------- pads
// the era in play's (deploy.js flatPads), made again when the era changes
let PADS = null, padsEra = null;
function pads() {
  if (PADS && padsEra === ERA) return PADS;
  padsEra = ERA;
  PADS = flatPads().map((p) => ({
    x: p.x, z: p.z, rx: p.rx, rz: p.rz, c: Math.cos(p.heading), s: Math.sin(p.heading), blend: p.blend,
    reach: Math.hypot(p.rx, p.rz) + p.blend, h: 0, small: p.rx <= 22,
  }));
  const S = terrainStyle();
  for (const p of PADS) p.h = S ? S.height(p.x, p.z, true) : withRiver(p.x, p.z, natural0(p.x, p.z, true));
  return PADS;
}

function padWeight(p, x, z, rx = p.rx, rz = p.rz, blend = p.blend) {
  const dx = x - p.x, dz = z - p.z;
  if (dx > p.reach || dx < -p.reach || dz > p.reach || dz < -p.reach) return 0;
  const lx = dx * p.c - dz * p.s, lz = dx * p.s + dz * p.c;
  const qx = Math.max(Math.abs(lx) - rx, 0), qz = Math.max(Math.abs(lz) - rz, 0);
  const d = Math.sqrt(qx * qx + qz * qz);
  return 1 - smooth(0, blend, d);
}

/** 0..1: how much of a point is on a levelled pad (the renderer turns it to dirt and gravel). */
export function padMask(x, z) {
  let m = 0;
  for (const p of pads()) {
    // a vehicle's levelled square is mostly invisible: only the middle of it is worn to bare earth
    const w = p.small ? padWeight(p, x, z, 7, 9, 10) : padWeight(p, x, z);
    if (w > m) m = w;
  }
  return m;
}

/** Ground height at any point; pure and cheap enough for per-tick terrain following. */
export function heightAt(x, z) {
  const S = terrainStyle();
  let h = S ? S.height(x, z, true) : withRiver(x, z, natural0(x, z, true));
  for (const p of pads()) {
    const w = padWeight(p, x, z);
    if (w > 0) h += (p.h - h) * w;
  }
  return h;
}

/** Same surface with the small octaves dropped, for the coarse mesh levels (cell is the grid spacing, metres). */
export function heightLod(x, z, cell) {
  if (cell < 60) return heightAt(x, z);
  const S = terrainStyle();
  let h = S ? S.height(x, z, false) : withRiver(x, z, natural0(x, z, false));
  if (cell < 700) for (const p of pads()) {
    const w = padWeight(p, x, z);
    if (w > 0) h += (p.h - h) * w;
  }
  return h;
}

/** Surface normal by central differences (writes into out, returns it). */
export function normalAt(x, z, out = { x: 0, y: 1, z: 0 }) {
  const e = 1.5;
  const dx = heightAt(x - e, z) - heightAt(x + e, z);
  const dz = heightAt(x, z - e) - heightAt(x, z + e);
  const inv = 1 / Math.sqrt(dx * dx + 4 * e * e + dz * dz);
  out.x = dx * inv;
  out.y = 2 * e * inv;
  out.z = dz * inv;
  return out;
}

/** True when the straight segment A to B clears the ground (sampled march, coarse over long ranges). */
export function los(ax, ay, az, bx, by, bz, clearance = 0.5) {
  const dx = bx - ax, dy = by - ay, dz = bz - az;
  const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (len < 1) return true;
  const step = Math.min(120, Math.max(12, len / 260));
  const n = Math.ceil(len / step);
  for (let i = 1; i < n; i++) {
    const t = i / n;
    const x = ax + dx * t, z = az + dz * t;
    if (ay + dy * t < heightAt(x, z) + clearance) return false;
  }
  return true;
}
