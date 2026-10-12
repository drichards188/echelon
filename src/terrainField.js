// The field patchwork: a rotated grid of jittered columns and rows, evaluated identically in JS
// (tree placement) and GLSL (ground colour), so hedges and windbreaks sit exactly on field edges.
// Every random choice is the integer hash from terrainHeight.js, which GLSL repeats bit for bit.
import { ihash } from './terrainHeight.js';

export const FIELD = { angle: 0.38, su: 340, sv: 520, hedgeSeg: 400, region: 7000 };
const CA = Math.cos(FIELD.angle), SA = Math.sin(FIELD.angle);
const { su: SU, sv: SV, hedgeSeg: HS, region: RG } = FIELD;

export const toFieldUV = (x, z, out = { u: 0, v: 0 }) => {
  out.u = x * CA + z * SA;
  out.v = -x * SA + z * CA;
  return out;
};
export const fromFieldUV = (u, v, out = { x: 0, z: 0 }) => {
  out.x = u * CA - v * SA;
  out.z = u * SA + v * CA;
  return out;
};

export const colB = (i) => i * SU + (ihash(i, 0, 11) - 0.5) * 0.55 * SU;
export const rowOffset = (i) => ihash(i, 0, 23) * SV;
export const rowB = (i, j) => j * SV + (ihash(i, j, 37) - 0.5) * 0.5 * SV; // in the column's shifted v

// farmland or open steppe, decided per 7 km cell; the airbase and its surroundings stay grass
const farmAt = (u, v) => { const p = fromFieldUV(u, v); return farmRegion(p.x, p.z); };
export function farmRegion(x, z) {
  if (x * x + z * z < 2200 * 2200) return false;
  const u = x * CA + z * SA, v = -x * SA + z * CA;
  return ihash(Math.floor(u / RG), Math.floor(v / RG), 5) < 0.72;
}

/** Field containing a world point: { i, j, kind, farm, hedge: distance to the nearest hedge line }. */
export function fieldAt(x, z) {
  const u = x * CA + z * SA, v = -x * SA + z * CA;
  let i = Math.floor(u / SU);
  if (u < colB(i)) i--;
  else if (u >= colB(i + 1)) i++;
  const L = colB(i), R = colB(i + 1);
  const o = rowOffset(i), vv = v + o;
  let j = Math.floor(vv / SV);
  if (vv < rowB(i, j)) j--;
  else if (vv >= rowB(i, j + 1)) j++;
  const B = rowB(i, j), T = rowB(i, j + 1);
  // the field's anchor decides farm or steppe and its crop
  const a = fromFieldUV(L, B - o);
  const farm = farmRegion(a.x, a.z);
  const kind = farm ? Math.floor(ihash(i, j, 53) * 5) : 5;
  // hedges: column lines in segments of the unshifted v (shared by both neighbours), row lines per column
  const seg = Math.floor(v / HS);
  const hedgeCol = (ci) => ihash(ci, seg, 41) < 0.55 && farmAt(colB(ci), (seg + 0.5) * HS);
  let hedge = 1e9;
  if (hedgeCol(i)) hedge = Math.min(hedge, Math.abs(u - L));
  if (hedgeCol(i + 1)) hedge = Math.min(hedge, Math.abs(R - u));
  const rowHedge = (rj) => ihash(i, rj, 43) < 0.3 && farm;
  if (rowHedge(j)) hedge = Math.min(hedge, Math.abs(vv - B));
  if (rowHedge(j + 1)) hedge = Math.min(hedge, Math.abs(T - vv));
  return { i, j, kind, farm, hedge, edge: Math.min(u - L, R - u, vv - B, T - vv) };
}

/**
 * Hedge lines in a world rectangle, as world-space segments { x0, z0, x1, z1 }, for the tree
 * planter. Covers the same lines the shader darkens.
 */
export function hedgeSegments(cx, cz, radius) {
  const out = [];
  const c = toFieldUV(cx, cz);
  const r = radius * 1.05;
  const i0 = Math.floor((c.u - r) / SU) - 1, i1 = Math.ceil((c.u + r) / SU) + 1;
  for (let i = i0; i <= i1; i++) {
    const L = colB(i);
    // column line, in segments
    const s0 = Math.floor((c.v - r) / HS), s1 = Math.floor((c.v + r) / HS);
    for (let s = s0; s <= s1; s++) {
      if (ihash(i, s, 41) >= 0.55) continue;
      const m = fromFieldUV(L, (s + 0.5) * HS);
      if (!farmRegion(m.x, m.z)) continue;
      const p0 = fromFieldUV(L, s * HS), p1 = fromFieldUV(L, (s + 1) * HS);
      out.push({ x0: p0.x, z0: p0.z, x1: p1.x, z1: p1.z });
    }
    // row lines inside this column
    const o = rowOffset(i), R = colB(i + 1);
    const j0 = Math.floor((c.v - r + o) / SV) - 1, j1 = Math.ceil((c.v + r + o) / SV) + 1;
    for (let j = j0; j <= j1; j++) {
      if (ihash(i, j, 43) >= 0.3) continue;
      const b = rowB(i, j) - o;
      const a = fromFieldUV(L, b);
      if (!farmRegion(a.x, a.z)) continue;
      const p1 = fromFieldUV(R, b);
      out.push({ x0: a.x, z0: a.z, x1: p1.x, z1: p1.z });
    }
  }
  return out;
}

// ---------------------------------------------------------------- GLSL twin
const f = (n) => (Number.isInteger(n) ? n.toFixed(1) : String(n));
export const fieldGLSL = /* glsl */ `
const float F_C = ${CA.toFixed(8)};
const float F_S = ${SA.toFixed(8)};
const float F_SU = ${f(SU)};
const float F_SV = ${f(SV)};
const float F_HS = ${f(HS)};
const float F_RG = ${f(RG)};
float ihash(int x, int y, int s) {
  uint h = uint(x) * 0x27d4eb2du ^ uint(y) * 0x165667b1u ^ uint(s) * 0x9e3779b1u;
  h ^= h >> 15u; h *= 0x85ebca6bu; h ^= h >> 13u; h *= 0xc2b2ae35u; h ^= h >> 16u;
  return float(h >> 8u) / 16777216.0;
}
float f_colB(int i) { return float(i) * F_SU + (ihash(i, 0, 11) - 0.5) * 0.55 * F_SU; }
float f_rowOff(int i) { return ihash(i, 0, 23) * F_SV; }
float f_rowB(int i, int j) { return float(j) * F_SV + (ihash(i, j, 37) - 0.5) * 0.5 * F_SV; }
vec2 f_world(float u, float v) { return vec2(u * F_C - v * F_S, u * F_S + v * F_C); }
bool f_farm(vec2 p) {
  if (dot(p, p) < ${f(2200 * 2200)}) return false;
  float u = p.x * F_C + p.y * F_S, v = -p.x * F_S + p.y * F_C;
  return ihash(int(floor(u / F_RG)), int(floor(v / F_RG)), 5) < 0.72;
}
struct FieldInfo { int i; int j; float kind; float hedge; float edge; float u; float vv; float eL; float eR; float eB; float eT; };
FieldInfo fieldAt(vec2 p) {
  float u = p.x * F_C + p.y * F_S, v = -p.x * F_S + p.y * F_C;
  FieldInfo f;
  int i = int(floor(u / F_SU));
  if (u < f_colB(i)) i--; else if (u >= f_colB(i + 1)) i++;
  float L = f_colB(i), R = f_colB(i + 1);
  float o = f_rowOff(i), vv = v + o;
  int j = int(floor(vv / F_SV));
  if (vv < f_rowB(i, j)) j--; else if (vv >= f_rowB(i, j + 1)) j++;
  float B = f_rowB(i, j), T = f_rowB(i, j + 1);
  bool farm = f_farm(f_world(L, B - o));
  f.i = i; f.j = j;
  f.kind = farm ? floor(ihash(i, j, 53) * 5.0) : 5.0;
  int seg = int(floor(v / F_HS));
  float hedge = 1e9;
  float segV = (float(seg) + 0.5) * F_HS;
  if (ihash(i, seg, 41) < 0.55 && f_farm(f_world(L, segV))) hedge = min(hedge, abs(u - L));
  if (ihash(i + 1, seg, 41) < 0.55 && f_farm(f_world(f_colB(i + 1), segV))) hedge = min(hedge, abs(R - u));
  if (farm) {
    if (ihash(i, j, 43) < 0.3) hedge = min(hedge, abs(vv - B));
    if (ihash(i, j + 1, 43) < 0.3) hedge = min(hedge, abs(T - vv));
  }
  f.hedge = hedge;
  f.edge = min(min(u - L, R - u), min(vv - B, T - vv));
  f.u = u; f.vv = vv;
  f.eL = u - L; f.eR = R - u; f.eB = vv - B; f.eT = T - vv;
  return f;
}

// Dirt roads along some of the field boundaries (the same hash from both neighbours, so a road is
// continuous across its line): x is the distance to the nearest road's centre line (1e9 if none),
// yz the ground gradient of that distance. The airbase surroundings stay free of them.
vec3 f_road(FieldInfo f, vec2 p) {
  if (dot(p, p) < ${f(1800 * 1800)}) return vec3(1e9, 0.0, 0.0);
  float d = 1e9;
  vec2 g = vec2(0.0), gu = vec2(F_C, F_S), gv = vec2(-F_S, F_C);
  if (ihash(f.i, 0, 201) < 0.3 && f.eL < d) { d = f.eL; g = gu; }
  if (ihash(f.i + 1, 0, 201) < 0.3 && f.eR < d) { d = f.eR; g = -gu; }
  if (ihash(f.i, f.j, 203) < 0.22 && f.eB < d) { d = f.eB; g = gv; }
  if (ihash(f.i, f.j + 1, 203) < 0.22 && f.eT < d) { d = f.eT; g = -gv; }
  return vec3(d, g);
}

// distance from the nearest wheel line of the sprayer tramlines (21 m apart, rows run along v)
float f_tramDist(FieldInfo f) {
  float m = mod(f.eL - 5.0, 21.0) - 10.5;
  return abs(abs(m) - 0.9);
}

// worn tractor tracks along the edge of some fields: x the amount (before distance fades)
float f_headland(FieldInfo f, vec2 p) {
  float e = f.edge;
  float w = exp(-pow((e - 3.2) / 0.32, 2.0)) + exp(-pow((e - 5.0) / 0.32, 2.0));
  return w * step(ihash(f.i, f.j, 205), 0.55) * smoothstep(0.35, 0.6, vnoise(p * 0.045 + 3.0));
}

// ground colour of a field kind (0 green wheat, 1 ripe wheat, 2 plough, 3 stubble, 4 lush crop, 5 steppe)
vec3 fieldBaseColor(float k, float dry) {
  if (k < 0.5) return vec3(0.052, 0.112, 0.022);
  if (k < 1.5) return vec3(0.30, 0.215, 0.055);
  if (k < 2.5) return vec3(0.115, 0.075, 0.045);
  if (k < 3.5) return vec3(0.25, 0.195, 0.085);
  if (k < 4.5) return vec3(0.07, 0.13, 0.02);
  return mix(vec3(0.085, 0.135, 0.04), vec3(0.26, 0.225, 0.095), dry);
}
`;
