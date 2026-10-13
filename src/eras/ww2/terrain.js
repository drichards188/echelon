// The WW2 era's landscape (eras/ww2.js `terrain`): Fliegerhorst Hopsten and its surroundings in late winter,
// February to March 1945. Plain data and pure functions, importable in Node: the sim's heightAt and los come
// from here when the era is in play (terrainHeight.js), and the renderer takes its ground, grass and tree
// styles from it (terrain.js, grass.js, vegetation.js). The shape of a terrain style is at the end of the
// file (`export default`); an era without `terrain` gets the modern steppe.
//
// Game frame as deploy.js: metres, origin at the runway centre (the field's reference point, 52 20 40 N,
// 07 32 30 E, deZeng), north -Z, east +X. The map keeps true compass bearings: the shared runway on 070 is
// the game's (Hopsten's main runway lay about 085, refs/ww2/airfield 1.3), everything else sits where it is.
//
// Relief: the EU-DEM (25 m, sampled through opentopodata.org on a 500 m grid out to 30 km, a 3 km grid out to
// 60 km and a 250 m patch over the Teutoburger Wald's narrow tip; heights relative to the field's 38.4 m), with
// woods and villages filtered out of the flat parts (it is a surface model), and a metre or two of procedural
// relief below the grid's reach: swells, low sand dunes on the heaths, calm round the landing ground. Heights
// over 150 m are eased toward 175 m (the highest ground is about 180 m, 38 km east-south-east), so the sim's
// line of sight, clipped at 200 m (sim.js), stays right. What the grid carries (distance and bearing from the
// field, height over it in the model):
//   - the Ibbenbuerener Bergplatte (Schafberg), a sandstone plateau 14 km long WNW-ESE and 5 km wide
//     (de.wikipedia): from Uffeln (6.5 km on 116) and Dickenberg (9.4 km on 111, 95 m) to Laggenbeck, its top
//     (176 m above the sea) 20.4 km on 113, 133 to 142 m;
//   - the Teutoburger Wald: its north-western tip, the Huckberg above the canal at Bevergern (8.2 km on 151;
//     95 m above the sea, 57 m over the field, about 35 m in the 250 m grid), the Birgter Berg (12 km on 139,
//     97 m), rising south-eastward to Tecklenburg (23.1 km on 127, about 140 m), wooded along its crest;
//   - the Ems valley 7 to 15 km to the west (Rheine 10.1 km on 225), a few metres below the field, and the
//     plain rising gently toward the Schafberg.
// Waters (OpenStreetMap, simplified): the Dortmund-Ems-Kanal, 42 m wide, from the Nasses Dreieck at
// Bergeshoevede (8.7 km on 150, where the Mittellandkanal leaves it eastward round the Schafberg)
// north-westward, 6.1 km from the field at its nearest (on 207) past Dreierwalde and Rheine and north; its
// pounds at the EU-DEM water levels (50, 40, 37.8 and 32.4 m above the sea) on dikes where the ground lies
// lower; the Ems through Rheine; the brooks (the Hopstener, Dreierwalder, Hoersteler, Speller and Recker Aa and
// others) as ditches with alders; the Heiliges Meer lakes 6.3 km on 87. Rheine-Bentlage, KG 51's second field,
// 12.4 km on 241: its sandy landing area and three runways (RHEINE).

// Land cover, from the 21 and 22 March 1945 photographs of the field (refs/ww2/airfield photos 01 to 03) and the
// 2014 view (06): Muensterland farmland of small fields with hedgebanks (Wallhecken) along most edges, a dense
// net of sand lanes, a farmstead every few hundred metres in its ring of oaks (the Streusiedlung), small pine
// plantations, oak and birch copses; heath on the sand and bog to the north (the Speller Dose, 5.2 km on 327, and
// the Recker Moor, 15.6 km on 75, both far bigger in 1945 than their reserves today) and round the Heiliges Meer.
// Kinds: 0 ploughed, 1 winter rye, 2 grassland, 3 stubble and fallow, 4 heath, 5 bog, 6 pine wood, 7 oak and
// birch wood, 8 the landing ground. The land is laid out in regions of about 1.6 by 1.2 km bounded by lanes, each
// with its own field grid, orientation and size (block fields, or the long strips of the Esch); the field kinds
// and the hedge lines are hashes of the field indices, the same in JS (the tree planter) and GLSL (the ground
// and the grass), so trees stand exactly on the edges the ground draws.
//
// The Fliegerhorst, from the layout's assets: the grass landing ground round the runway with its perimeter track
// and the ladder hardstands along its north and south sides; taxiways from the perimeter to the blast bays
// (`revetment`), which open out of a pine wood behind them; the hangar in a wood off the north boundary
// (deZeng); small woods over the Flak command post and the fuel dump. The landing ground carries the painted
// field pattern of the photos, darker strips continuing the farmland across it. No wood, heath or bog closer
// than 170 m to a gun position, and no farmstead closer than 260 m.
//
// Season: bare oaks, birches and hedges (a few young oaks keep their brown leaves), dark green pines, ploughed
// fields and winter rye, dull winter grass with dead straw, brown heather, the bleached moor grass of the bogs,
// wet ruts and pools. Sky defaults (`sky`): the sun at 30 degrees on 215, mid-March at 52.3 N at 14:00 solar time
// (declination -2.4 degrees), and a broken late-winter cloud cover with haze.
//
// Sources: EU-DEM v1.1 (Copernicus Land Monitoring Service, funded by the European Union) through the
// opentopodata.org API; OpenStreetMap contributors (ODbL), the canals, the Ems, the brooks, the lakes and the
// villages; de.wikipedia "Ibbenbuerener Bergplatte", "Teutoburger Wald"; deZeng, Luftwaffe Airfields 1935-45
// (Hopsten, Rheine) and the photographs in refs/ww2/airfield.

const smooth = (a, b, x) => {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
};
const TAU = Math.PI * 2;

// integer hash in [0, 1): terrainHeight.js ihash, repeated here (importing it would close a module cycle);
// the GLSL twin below repeats it bit for bit
function ihash(x, y, s) {
  let h = Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1) ^ Math.imul(s, 0x9e3779b1);
  h ^= h >>> 15;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 8) / 16777216;
}

// smooth value noise in [0, 1] (the GLSL twin is vnI)
function vn(x, z, s) {
  const xi = Math.floor(x), zi = Math.floor(z);
  const fx = x - xi, fz = z - zi;
  const ux = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
  const uz = fz * fz * fz * (fz * (fz * 6 - 15) + 10);
  const a = ihash(xi, zi, s), b = ihash(xi + 1, zi, s), c = ihash(xi, zi + 1, s), d = ihash(xi + 1, zi + 1, s);
  return a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz;
}

// ---------------------------------------------------------------- relief
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
let FINE = null, FAR = null, TEUTO = null, FAR_EDGE = 0;
function decode(g) {
  const idx = new Int8Array(128);
  for (let k = 0; k < 64; k++) idx[B64.charCodeAt(k)] = k;
  const n = g.nx * g.nz, a = new Float32Array(n);
  for (let k = 0; k < n; k++) a[k] = ((idx[g.s.charCodeAt(2 * k)] << 6) | idx[g.s.charCodeAt(2 * k + 1)]) / 10 - 40;
  return { ...g, s: null, a, x1: g.x0 + (g.nx - 1) * g.step, z1: g.z0 + (g.nz - 1) * g.step };
}
function initRelief() {
  FINE = decode(DEM_FINE);
  FAR = decode(DEM_FAR);
  TEUTO = decode(DEM_TEUTO);
  // beyond the far grid the plain levels out at the mean of its border
  let s = 0, c = 0;
  const { nx, nz, a } = FAR;
  for (let k = 0; k < nx; k++) { s += a[k] + a[(nz - 1) * nx + k]; c += 2; }
  for (let k = 0; k < nz; k++) { s += a[k * nx] + a[k * nx + nx - 1]; c += 2; }
  FAR_EDGE = s / c;
}

// Catmull-Rom bicubic on a grid (clamped at its border)
const cr = (p0, p1, p2, p3, t) => p1 + 0.5 * t * (p2 - p0 + t * (2 * p0 - 5 * p1 + 4 * p2 - p3 + t * (3 * (p1 - p2) + p3 - p0)));
function sample(g, x, z) {
  const nx = g.nx, a = g.a, mx = nx - 1, mz = g.nz - 1;
  const fx = (x - g.x0) / g.step, fz = (z - g.z0) / g.step;
  const i = Math.floor(fx), j = Math.floor(fz), tx = fx - i, tz = fz - j;
  const c0 = Math.min(Math.max(i - 1, 0), mx), c1 = Math.min(Math.max(i, 0), mx), c2 = Math.min(Math.max(i + 1, 0), mx), c3 = Math.min(Math.max(i + 2, 0), mx);
  let r0 = 0, r1 = 0, r2 = 0, r3 = 0;
  for (let b = 0; b < 4; b++) {
    const o = Math.min(Math.max(j - 1 + b, 0), mz) * nx;
    const v = cr(a[o + c0], a[o + c1], a[o + c2], a[o + c3], tx);
    if (b === 0) r0 = v;
    else if (b === 1) r1 = v;
    else if (b === 2) r2 = v;
    else r3 = v;
  }
  return cr(r0, r1, r2, r3, tz);
}

/** The EU-DEM surface relative to the field (m): the fine grid, blended into the far one near its border, and
 *  the finer patch over the Teutoburger Wald's narrow tip. */
export function demAt(x, z) {
  if (!FINE) initRelief();
  const m = Math.max(Math.abs(x), Math.abs(z));
  const e = FINE.x1 - 1.5 * FINE.step;
  let h;
  if (m < e - 2000) h = sample(FINE, x, z);
  else {
    let far = sample(FAR, x, z);
    if (m > FAR.x1 - 9000) far += (FAR_EDGE - far) * smooth(FAR.x1 - 9000, FAR.x1 - 3000, m);
    if (m >= e) return far;
    const t = smooth(e - 2000, e, m);
    h = sample(FINE, x, z) * (1 - t) + far * t;
  }
  const P = TEUTO;
  if (x > P.x0 && x < P.x1 && z > P.z0 && z < P.z1) {
    const w = smooth(0, 1200, Math.min(x - P.x0, P.x1 - x, z - P.z0, P.z1 - z));
    if (w > 0) h += (sample(P, x, z) - h) * w;
  }
  return h;
}

// ---------------------------------------------------------------- the zones: bog, heath, woodiness
// Real bogs and heaths (x, z, radius): the Speller Dose and the moors north of Hopsten toward Schapen, the
// Recker Moor and the bog land between Halverde and Recke, the heath and bog round the Heiliges Meer, the
// sand heath on the Ems terraces north of Rheine. Their 1945 extent is an estimate (E) from the reserves of
// today, the field names and the bright heath patches of the March 1945 photographs.
const MOOR_SITES = [[-2790, -4380, 1500], [-500, -7600, 1900], [15050, -4050, 2100], [10400, -6600, 1900], [6600, -1400, 650]];
const HEATH_SITES = [[6200, -700, 1300], [-6400, -1200, 1500], [-1800, -9800, 1600], [3600, 9600, 900]];
// Forest: the Teutoburger Wald is wooded along its crest from the Huckberg south-eastward, the Schafberg on its
// flanks: capsules [ax, az, bx, bz, radius, share of woods]
const FORESTS = [[4300, 7100, 7800, 9000, 700, 0.75], [7800, 9000, 13700, 13300, 900, 0.75], [13700, 13300, 26000, 19500, 1000, 0.75], [7000, 3100, 20500, 8300, 2300, 0.28]];
const Z = { moor: 0, heath: 0, wood: 0 };
// 1 inside the inner part of disc s, 0 outside it (the GLSL twin: 1 - smoothstep(0.55 r, r, d))
function disc(s, x, z) {
  const dx = x - s[0], dz = z - s[1], d2 = dx * dx + dz * dz;
  return d2 >= s[2] * s[2] ? 0 : 1 - smooth(s[2] * 0.55, s[2], Math.sqrt(d2));
}
function zoneAt(x, z, out = Z) {
  const far = smooth(2400, 4400, Math.sqrt(x * x + z * z));
  let m = 0, h = 0, f = 0;
  for (const s of MOOR_SITES) m = Math.max(m, disc(s, x, z));
  for (const s of HEATH_SITES) h = Math.max(h, disc(s, x, z));
  for (const c of FORESTS) {
    const dx = c[2] - c[0], dz = c[3] - c[1];
    const t = Math.min(Math.max(((x - c[0]) * dx + (z - c[1]) * dz) / (dx * dx + dz * dz), 0), 1);
    const ex = x - c[0] - dx * t, ez = z - c[1] - dz * t, e2 = ex * ex + ez * ez;
    if (e2 < c[4] * c[4]) f = Math.max(f, c[5] * (1 - smooth(c[4] * 0.6, c[4], Math.sqrt(e2))));
  }
  m = Math.max(m, smooth(0.72, 0.82, vn(x / 4300, z / 4300, 401)) * far);
  h = Math.max(h, smooth(0.66, 0.76, vn(x / 2900 + 5.3, z / 2900 - 1.7, 403)) * far);
  out.moor = m;
  out.heath = h * (1 - m);
  out.wood = Math.max(0.05 + 0.11 * vn(x / 2300, z / 2300, 405), f);
  return out;
}

/** The procedural relief under the grid's reach: a metre or two of swells, dunes on the heaths, calm at the field. */
function micro(x, z, fine) {
  const calm = 0.12 + 0.88 * smooth(1300, 3600, Math.hypot(x, z));
  let h = 1.7 * (vn(x / 760, z / 760, 61) - 0.5) + 0.8 * (vn(x / 270 + 3.1, z / 270, 62) - 0.5);
  if (fine) h += 0.22 * (vn(x / 70, z / 70, 63) - 0.5) + 0.05 * (vn(x / 19, z / 19, 64) - 0.5);
  // drift sand on the heaths: low dunes, long west to east
  const hz = smooth(0.66, 0.76, vn(x / 2900 + 5.3, z / 2900 - 1.7, 403));
  if (hz > 0) {
    const d = vn(x / 420 + 1.7, z / 150, 65);
    h += hz * 3.2 * d * d * d;
  }
  return h * calm;
}

// ---------------------------------------------------------------- waters
// Every water line is cut into segments kept in 1 km buckets, so a height sample looks at the two or three
// near it. Canals: a flat pound at its level (a vertex's level holds to the next vertex, so a lock is a step),
// the bed 3.5 m down, a towpath and dike at least 1.1 m over the water on both sides, cut into higher ground.
// The Ems: its level follows the valley floor downstream, never rising, the channel 2 m deep. Brooks: a ditch
// 1.4 m deep in the local ground. Lakes: a bowl under a flat surface at the lowest shore.
const BK = 1000, BN = 70, BO = 35000; // buckets: 1 km cells over 70 km
let SEGS = null, BUCKETS = null, LAKE = null;
const REACH = { canal: 60, river: 40, brook: 9 };
function initWaters() {
  if (!FINE) initRelief();
  SEGS = [];
  BUCKETS = Array.from({ length: BN * BN }, () => []);
  for (const w of WATERS) {
    const hw = w.w / 2, kind = w.kind, P = w.pts;
    let lv = null;
    if (kind === 'river') {
      // the valley floor along the river, smoothed, held from rising downstream
      lv = P.map((p) => demAt(p[0], p[1]) - 1.1);
      for (let k = 1; k < lv.length; k++) lv[k] = Math.min(lv[k], lv[k - 1] + 0.02);
      for (let pass = 0; pass < 3; pass++) for (let k = 1; k < lv.length - 1; k++) lv[k] = Math.min(lv[k], (lv[k - 1] + lv[k] + lv[k + 1]) / 3 + 0.01);
      for (let k = 1; k < lv.length; k++) lv[k] = Math.min(lv[k], lv[k - 1]);
    }
    w.levels = lv;
    for (let k = 1; k < P.length; k++) {
      const a = P[k - 1], b = P[k];
      const la = kind === 'canal' ? a[2] : lv ? lv[k - 1] : 0, lb = kind === 'canal' ? a[2] : lv ? lv[k] : 0;
      const s = { ax: a[0], az: a[1], bx: b[0], bz: b[1], la, lb, hw, kind, len2: (b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2 };
      const id = SEGS.push(s) - 1;
      const r = hw + REACH[kind];
      const i0 = Math.floor((Math.min(a[0], b[0]) - r + BO) / BK), i1 = Math.floor((Math.max(a[0], b[0]) + r + BO) / BK);
      const j0 = Math.floor((Math.min(a[1], b[1]) - r + BO) / BK), j1 = Math.floor((Math.max(a[1], b[1]) + r + BO) / BK);
      for (let j = Math.max(j0, 0); j <= Math.min(j1, BN - 1); j++) for (let i = Math.max(i0, 0); i <= Math.min(i1, BN - 1); i++) BUCKETS[j * BN + i].push(id);
    }
  }
  LAKE = LAKES.map((l) => {
    let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9, lvl = 1e9;
    for (const [x, z] of l.pts) {
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z);
      lvl = Math.min(lvl, demAt(x, z) + micro(x, z, false));
    }
    return { ...l, x0: x0 - 40, x1: x1 + 40, z0: z0 - 40, z1: z1 + 40, level: lvl - 0.4 };
  });
}

// distance from (x, z) to segment s, and the level there (written to _w)
const _w = { d: 0, level: 0 };
function segDist(s, x, z) {
  const dx = s.bx - s.ax, dz = s.bz - s.az;
  let t = ((x - s.ax) * dx + (z - s.az) * dz) / (s.len2 || 1);
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const px = s.ax + dx * t - x, pz = s.az + dz * t - z;
  _w.d = Math.sqrt(px * px + pz * pz);
  _w.level = s.la + (s.lb - s.la) * t;
  return _w.d;
}

// signed distance to a lake shore (negative inside)
function lakeDist(l, x, z) {
  const P = l.pts;
  let inside = false, best = 1e9;
  for (let k = 0, m = P.length - 1; k < P.length; m = k++) {
    const [ax, az] = P[m], [bx, bz] = P[k];
    if ((az > z) !== (bz > z) && x < ((bx - ax) * (z - az)) / (bz - az) + ax) inside = !inside;
    const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1;
    let t = ((x - ax) * dx + (z - az) * dz) / l2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    best = Math.min(best, Math.hypot(ax + dx * t - x, az + dz * t - z));
  }
  return inside ? -best : best;
}

function waters(x, z, h, fine) {
  if (!SEGS) initWaters();
  const i = Math.floor((x + BO) / BK), j = Math.floor((z + BO) / BK);
  if (i >= 0 && j >= 0 && i < BN && j < BN) {
    const list = BUCKETS[j * BN + i];
    // the nearest segment of each kind decides (so two segments of one line do not cut twice)
    let dc = 1e9, lc = 0, hc = 0, dr = 1e9, lr = 0, hr = 0, db = 1e9, hb = 0;
    for (let k = 0; k < list.length; k++) {
      const s = SEGS[list[k]];
      const d = segDist(s, x, z);
      if (s.kind === 'canal') { if (d < dc) { dc = d; lc = _w.level; hc = s.hw; } }
      else if (s.kind === 'river') { if (d < dr) { dr = d; lr = _w.level; hr = s.hw; } }
      else if (d < db) { db = d; hb = s.hw; }
    }
    if (fine && db < hb + REACH.brook) h -= 1.4 * (1 - smooth(hb * 0.5, hb + REACH.brook, db));
    if (dr < hr + REACH.river) {
      const bed = lr - 2 + 2.4 * smooth(hr * 0.55, hr + 2, dr);
      h = bed + (Math.max(h, lr + 0.4) - bed) * smooth(hr + 2, hr + REACH.river, dr);
    }
    if (dc < hc + REACH.canal) {
      const top = Math.max(h, lc + 1.1);
      if (dc <= hc + 1) h = lc - 3.5 + 3.8 * smooth(hc - 9, hc + 1, dc);
      else if (dc <= hc + 12) h = lc + 0.3 + (top - lc - 0.3) * smooth(hc + 1, hc + 5 + Math.min(6, 0.5 * (top - lc)), dc);
      else h = top + (h - top) * smooth(hc + 12, hc + REACH.canal, dc);
    }
  }
  for (const l of LAKE) {
    if (x < l.x0 || x > l.x1 || z < l.z0 || z > l.z1) continue;
    const s = lakeDist(l, x, z);
    if (s < 0) h = l.level - 0.6 - 2.6 * smooth(0, 70, -s);
    else if (s < 40) h = l.level + 0.3 + (Math.max(h, l.level + 0.3) - l.level - 0.3) * smooth(0, 40, s);
  }
  return h;
}

/** 0..1: water and its banks at a point (1 on the water), for the ground shader and the planter. */
export function bankAt(x, z) {
  if (!SEGS) initWaters();
  let m = 0;
  const i = Math.floor((x + BO) / BK), j = Math.floor((z + BO) / BK);
  if (i >= 0 && j >= 0 && i < BN && j < BN) {
    const list = BUCKETS[j * BN + i];
    for (let k = 0; k < list.length; k++) {
      const s = SEGS[list[k]];
      const d = segDist(s, x, z);
      const reach = s.kind === 'brook' ? 7 : 22;
      if (d < s.hw + reach) m = Math.max(m, 1 - smooth(s.hw - 1, s.hw + reach, d) * (s.kind === 'brook' ? 1 : 0.92));
    }
  }
  for (const l of LAKE) {
    if (x < l.x0 || x > l.x1 || z < l.z0 || z > l.z1) continue;
    const s = lakeDist(l, x, z);
    if (s < 25) m = Math.max(m, 1 - smooth(-1, 25, s) * 0.92);
  }
  return m;
}

/** The water surfaces for the renderer: ribbons { pts: [[x, z, level]], w } and lakes { pts, level }. */
export function waterBodies() {
  if (!SEGS) initWaters();
  const ribbons = [];
  for (const w of WATERS) {
    if (w.kind === 'brook') continue;
    ribbons.push({ name: w.name, w: w.w, pts: w.pts.map((p, k) => [p[0], p[1], w.kind === 'canal' ? p[2] : w.levels[k]]), step: w.kind === 'canal' });
  }
  return { ribbons, lakes: LAKE.map((l) => ({ name: l.name, pts: l.pts, level: l.level })) };
}

/** Natural ground with its waters (no pads; terrainHeight.js levels those). `fine` false: the coarse levels. */
export function height(x, z, fine = true) {
  return waters(x, z, demAt(x, z) + micro(x, z, fine), fine);
}

// ---------------------------------------------------------------- land cover (JS twin of the GLSL below)
export const KIND = { PLOUGH: 0, RYE: 1, GRASS: 2, STUBBLE: 3, HEATH: 4, MOOR: 5, PINE: 6, DECID: 7, LANDING: 8 };
const { PLOUGH, RYE, GRASS, STUBBLE, HEATH, MOOR, PINE, DECID, LANDING } = KIND;

// Regions: a grid turned 0.1 rad, columns about 1.6 km wide with jittered edges, rows about 1.2 km offset per
// column (the modern field grid, one size up); their edges are lanes.
const RA = 0.1, RC = Math.cos(RA), RS = Math.sin(RA), RU = 1600, RV = 1200;
const rcolB = (i) => i * RU + (ihash(i, 0, 301) - 0.5) * 0.5 * RU;
const rrowOff = (i) => ihash(i, 0, 303) * RV;
const rrowB = (i, j) => j * RV + (ihash(i, j, 305) - 0.5) * 0.5 * RV;
const HSEG = 300; // hedge lines go in pieces of this length (some pieces have no hedge)
const LANE = 700; // lanes along the region edges change between track and road in pieces of this length

// The cell of a region: its rectangle in the region frame and its field grid (orientation and size). Kept in
// a small cache, since the planter asks for the same cells over and over.
const cells = new Map();
function cellAt(i, j) {
  const key = i * 100003 + j;
  let c = cells.get(key);
  if (c) return c;
  if (cells.size > 4000) cells.clear();
  const L = rcolB(i), R = rcolB(i + 1), o = rrowOff(i), B = rrowB(i, j), T = rrowB(i, j + 1);
  const cs = i * 7919 + j * 104729;
  // the cell's centre: its fields' orientation and size drift slowly across the land (so neighbours are
  // alike), and it decides how many hedges there are (a bog has hardly any)
  const cu = (L + R) / 2, cv = (B + T) / 2 - o;
  const cx = cu * RC - cv * RS, cz = cu * RS + cv * RC;
  const off = (vn(cx / 4200 + 2.3, cz / 4200 - 0.7, 315) - 0.5) * 1.6 + (ihash(i, j, 313) - 0.5) * 0.14;
  const strips = ihash(i, j, 317) < 0.22;
  const h2 = 0.6 * vn(cx / 3000 - 1.3, cz / 3000 + 4.1, 319) + 0.4 * ihash(i, j, 319), h3 = 0.5 * vn(cx / 3000 + 6.1, cz / 3000 - 2.9, 321) + 0.5 * ihash(i, j, 321);
  const zc = zoneAt(cx, cz, {});
  const pH = 0.62 * (1 - zc.moor) * (1 - 0.6 * zc.heath) + 0.04;
  c = {
    // hedges: on the long sides of block fields and across both, but not between the strips of an Esch
    i, j, L, R, B, T, o, cs, strips, pHc: strips ? 0.04 : pH, pHr: pH * 0.8,
    su: strips ? 24 + 26 * h2 : 90 + 120 * h2,
    sv: strips ? 210 + 220 * h3 : 120 + 190 * h3,
    ca: Math.cos(RA + off), sa: Math.sin(RA + off),
    // origin: the corner (L, B - o) in the world
    ox: L * RC - (B - o) * RS, oz: L * RS + (B - o) * RC,
  };
  cells.set(key, c);
  return c;
}
const fcolB = (c, i) => i * c.su + (ihash(i, c.cs, 331) - 0.5) * 0.5 * c.su;
const frowOff = (c, i) => ihash(i, c.cs, 333) * c.sv;
const frowB = (c, i, j) => j * c.sv + (ihash(i, j, c.cs + 335) - 0.5) * 0.5 * c.sv;

// region cell of a world point
function regionOf(x, z) {
  const u = x * RC + z * RS, v = -x * RS + z * RC;
  let i = Math.floor(u / RU);
  if (u < rcolB(i)) i--;
  else if (u >= rcolB(i + 1)) i++;
  const vv = v + rrowOff(i);
  let j = Math.floor(vv / RV);
  if (vv < rrowB(i, j)) j--;
  else if (vv >= rrowB(i, j + 1)) j++;
  return cellAt(i, j);
}

// The layout's influence (set by setLayout from the era's assets and sites): the landing ground in the runway
// frame, the airfield woods, the gun positions kept clear.
const AF = { cx: 0, cz: 0, ax: 1, az: 0, dx: 0, dz: 1, a0: -1500, a1: 750, d0: -470, d1: 330, woods: [], bays: [], guns: [], sites: [] };
let layoutKey = '';
/** The Fliegerhorst from a layout (eras' `layout`): call before using the cover of that layout. */
export function setLayout(layout) {
  const key = JSON.stringify([layout.assets, layout.sites]);
  if (key === layoutKey) return;
  layoutKey = key;
  farms.clear();
  kinds.clear();
  const rw = layout.assets.find((a) => a.kind === 'runway') ?? { x: 0, z: 0, bearing: 70, length: 2800 };
  const b = (rw.bearing * Math.PI) / 180, k = (rw.length ?? 2800) / 2800;
  Object.assign(AF, { cx: rw.x, cz: rw.z, ax: Math.sin(b), az: -Math.cos(b), dx: Math.cos(b), dz: Math.sin(b), a0: -1500 * k, a1: 750 * k, d0: -470, d1: 330 });
  const fr = (x, z) => [(x - AF.cx) * AF.ax + (z - AF.cz) * AF.az, (x - AF.cx) * AF.dx + (z - AF.cz) * AF.dz];
  // woods: [a0, a1, d0, d1, kind] in the runway frame
  AF.woods = [];
  AF.bays = layout.assets.filter((a) => a.kind === 'revetment').map((a) => {
    const [aa, dd] = fr(a.x, a.z), fb = (a.bearing * Math.PI) / 180;
    return { x: a.x, z: a.z, a: aa, d: dd, fx: Math.sin(fb), fz: -Math.cos(fb) };
  });
  if (AF.bays.length) {
    const as = AF.bays.map((q) => q.a), ds = AF.bays.map((q) => q.d);
    const dmax = Math.max(...ds);
    AF.woods.push([Math.min(...as) - 170, Math.max(...as) + 170, Math.min(...ds) - 5, dmax + 240, PINE]);
  }
  for (const a of layout.assets) {
    const [aa, dd] = fr(a.x, a.z);
    if (a.kind === 'hangar') AF.woods.push([aa - 230, aa + 230, dd - 230, dd + 60, DECID]);
    else if (a.kind === 'command44') AF.woods.push([aa - 140, aa + 140, dd - 90, dd + 130, PINE]);
    else if (a.kind === 'fuel44') AF.woods.push([aa - 120, aa + 150, dd - 70, dd + 110, PINE]);
  }
  // the gun positions (each unit's site; its guns stand within about 110 m of it), and with the assets the
  // places no farmstead stands near
  AF.guns = (layout.sites ?? []).map((s) => [s.x, s.z]);
  AF.sites = [...AF.guns, ...layout.assets.filter((a) => a.kind !== 'runway').map((a) => [a.x, a.z])];
}
// runway frame of a point
const afA = (x, z) => (x - AF.cx) * AF.ax + (z - AF.cz) * AF.az;
const afD = (x, z) => (x - AF.cx) * AF.dx + (z - AF.cz) * AF.dz;
// Rheine-Bentlage, KG 51's second field, 12.3 km on 241 (deZeng: 52 17 25 N, 07 23 00 E; a landing area of
// about 1,740 by 2,650 m with three concrete runways, 1,750 m ENE-WSW and 1,500 m NNW-SSE and NE-SW): its
// landing area in its own frame (the long side on 070, E), and its runways [x0, z0, x1, z1] (E)
export const RHEINE = { cx: -10793, cz: 6025, ax: Math.sin(70 * Math.PI / 180), az: -Math.cos(70 * Math.PI / 180), half: [1325, 870] };
const rwy = (cx, cz, b, len) => {
  const s = Math.sin(b * Math.PI / 180), c = -Math.cos(b * Math.PI / 180);
  return [cx - s * len / 2, cz - c * len / 2, cx + s * len / 2, cz + c * len / 2];
};
RHEINE.runways = [rwy(RHEINE.cx + 100, RHEINE.cz + 280, 70, 1750), rwy(RHEINE.cx + 520, RHEINE.cz - 60, 160, 1500), rwy(RHEINE.cx - 420, RHEINE.cz - 150, 45, 1500)];
const onRheine = (x, z, m) => {
  const dx = x - RHEINE.cx, dz = z - RHEINE.cz, a = dx * RHEINE.ax + dz * RHEINE.az, d = -dx * RHEINE.az + dz * RHEINE.ax;
  return Math.abs(a) < RHEINE.half[0] + m && Math.abs(d) < RHEINE.half[1] + m;
};
/** True on a landing ground (Hopsten's grass inside its perimeter track, the track included, or Rheine's). */
export function onLanding(x, z, margin = 0) {
  const a = afA(x, z), d = afD(x, z);
  return (a > AF.a0 - margin && a < AF.a1 + margin && d > AF.d0 - margin && d < AF.d1 + margin) || onRheine(x, z, margin);
}
// distance to the nearest gun position or asset
function siteDist(x, z) {
  let m = 1e9;
  for (const s of AF.sites) m = Math.min(m, Math.hypot(x - s[0], z - s[1]));
  return m;
}

/**
 * The cover at a point: { kind, cell, fi, fj, hedge (m to the nearest hedge line), edge (m to the field edge),
 * lane (m to the nearest lane) }. The GLSL twin is coverAt in GLSL_COVER.
 */
const COV = { kind: 0, cell: null, fi: 0, fj: 0, hedge: 1e9, edge: 0, lane: 1e9 };
export function coverAt(x, z, out = COV) {
  const c = regionOf(x, z);
  const dx = x - c.ox, dz = z - c.oz;
  const fu = dx * c.ca + dz * c.sa, fv = -dx * c.sa + dz * c.ca;
  let fi = Math.floor(fu / c.su);
  if (fu < fcolB(c, fi)) fi--;
  else if (fu >= fcolB(c, fi + 1)) fi++;
  const FL = fcolB(c, fi), FR = fcolB(c, fi + 1), fo = frowOff(c, fi), fvv = fv + fo;
  let fj = Math.floor(fvv / c.sv);
  if (fvv < frowB(c, fi, fj)) fj--;
  else if (fvv >= frowB(c, fi, fj + 1)) fj++;
  const FB = frowB(c, fi, fj), FT = frowB(c, fi, fj + 1);
  out.cell = c; out.fi = fi; out.fj = fj;
  out.kind = override(x, z, fieldBase(c, fi, fj, FL, FB - fo));
  // hedges on the field's edges
  const seg = Math.floor(fv / HSEG);
  let hedge = 1e9;
  if (ihash(fi, seg, c.cs + 341) < c.pHc) hedge = Math.min(hedge, fu - FL);
  if (ihash(fi + 1, seg, c.cs + 341) < c.pHc) hedge = Math.min(hedge, FR - fu);
  if (ihash(fi, fj, c.cs + 343) < c.pHr) hedge = Math.min(hedge, fvv - FB);
  if (ihash(fi, fj + 1, c.cs + 343) < c.pHr) hedge = Math.min(hedge, FT - fvv);
  out.hedge = hedge;
  out.edge = Math.min(fu - FL, FR - fu, fvv - FB, FT - fvv);
  // lanes on the region's edges
  const u = x * RC + z * RS, v = -x * RS + z * RC, vv = v + c.o;
  out.lane = Math.min(u - c.L, c.R - u, vv - c.B, c.T - vv);
  return out;
}

// the kind field (fi, fj) of cell c was sown with, from its corner (FL, FB) in the cell's field frame (kept:
// the planter asks for the same fields every time the camera moves)
const kinds = new Map();
function fieldBase(c, fi, fj, FL, FB) {
  const key = (c.cs * 4096 + fi + 2048) * 4096 + fj + 2048;
  let k = kinds.get(key);
  if (k === undefined) {
    if (kinds.size > 60000) kinds.clear();
    kinds.set(key, (k = sown(c, fi, fj, FL, FB)));
  }
  return k;
}
function sown(c, fi, fj, FL, FB) {
  const ax = c.ox + FL * c.ca - FB * c.sa, az = c.oz + FL * c.sa + FB * c.ca;
  const zn = zoneAt(ax, az);
  const h = ihash(fi, fj, c.cs + 337);
  // the strips of an Esch are all arable; woods come in clumps of fields
  if (!c.strips) {
    if (zn.moor > 0.5) return h < 0.72 ? MOOR : h < 0.86 ? HEATH : h < 0.94 ? DECID : PINE;
    if (zn.heath > 0.5) return h < 0.5 ? HEATH : h < 0.85 ? PINE : h < 0.93 ? GRASS : PLOUGH;
    if (vn(ax / 700 + 3.7, az / 700 + 1.1, 407) < zn.wood * 1.35) return h < 0.62 ? PINE : DECID;
  }
  const g = ihash(fi, fj, c.cs + 339);
  return g < 0.32 ? PLOUGH : g < 0.55 ? RYE : g < 0.88 ? GRASS : STUBBLE;
}
// what the airfield and the guns make of kind k at (x, z): the landing ground, the airfield's woods, and
// grass within 170 m of a gun position (its field of fire, the pits dug into a meadow)
function override(x, z, k) {
  const a = afA(x, z), d = afD(x, z);
  if ((a > AF.a0 && a < AF.a1 && d > AF.d0 && d < AF.d1) || onRheine(x, z, 0)) return LANDING;
  for (const w of AF.woods) if (a > w[0] && a < w[1] && d > w[2] && d < w[3]) return w[4];
  for (const g of AF.guns) if ((x - g[0]) ** 2 + (z - g[1]) ** 2 < 170 * 170) return GRASS;
  return k;
}

// ---------------------------------------------------------------- farmsteads and villages
// A farmstead on most cells of a 430 m grid in the region frame (fewer on the heath, none in the bogs, on the
// landing ground or near the guns), its house turned to the lane; villages and towns pack houses round their
// church (positions from OpenStreetMap, sizes for 1945 estimated): [x, z, radius, church].
const FS = 430;
export const VILLAGES = [
  [4248, -3866, 380, 1], [-2468, 1482, 300, 1], [3038, 5239, 360, 1], [1198, -6171, 300, 1], [-4628, -2256, 330, 1],
  [11983, -2874, 380, 1], [2768, 7831, 260, 1], [5678, 9095, 300, 1], [8621, -7888, 240, 1], [10403, -579, 200, 0],
  [-7108, 7196, 1500, 2], [11822, 7452, 1100, 2], [16494, 3147, 420, 1], [-2840, -9887, 260, 1], [-3785, 12761, 300, 1],
  [8815, 3394, 260, 0], [5796, 2878, 220, 0], [7445, 5308, 220, 0], [-5000, 4484, 280, 1],
];
function villageAt(x, z) {
  let m = 0;
  for (const v of VILLAGES) {
    const d = Math.hypot(x - v[0], z - v[1]);
    if (d < v[2]) m = Math.max(m, 1 - d / v[2]);
  }
  return m;
}
/** The farmstead of farm cell (i, j), or null: { x, z, rot }. The GLSL twin is farmAt. */
const farms = new Map();
export function farmSite(i, j) {
  const key = i * 100003 + j;
  let f = farms.get(key);
  if (f === undefined) {
    if (farms.size > 20000) farms.clear();
    farms.set(key, (f = findFarm(i, j)));
  }
  return f;
}
function findFarm(i, j) {
  const p = ihash(i, j, 501);
  if (p > 0.5) return null;
  const u = (i + 0.2 + 0.6 * ihash(i, j, 502)) * FS, v = (j + 0.2 + 0.6 * ihash(i, j, 503)) * FS;
  const x = u * RC - v * RS, z = u * RS + v * RC;
  if (onLanding(x, z, 160) || siteDist(x, z) < 260) return null;
  let m = 0;
  for (const s of MOOR_SITES) m = Math.max(m, disc(s, x, z));
  if (m > 0.3 || vn(x / 4300, z / 4300, 401) > 0.74) return null;
  if (villageAt(x, z) > 0) return null;
  return { x, z, rot: RA + (ihash(i, j, 504) < 0.5 ? 0 : Math.PI / 2) + (ihash(i, j, 505) - 0.5) * 0.3 };
}
// the nearest farmstead's distance (m), for keeping woods and fields off the yard
function farmDist(x, z) {
  const i = Math.floor((x * RC + z * RS) / FS), j = Math.floor((-x * RS + z * RC) / FS);
  let m = 1e9;
  for (let b = -1; b <= 1; b++) for (let a = -1; a <= 1; a++) {
    const f = farmSite(i + a, j + b);
    if (f) m = Math.min(m, Math.hypot(x - f.x, z - f.z));
  }
  return m;
}

// ---------------------------------------------------------------- the planter
// Species, by index into `trees.species` below (vegetation.js builds their forms)
const T_PINE = 0, T_OAK = 1, T_BIRCH = 2, T_SHRUB = 3, T_JUNIPER = 4, T_HEATHPINE = 5, T_HOUSE = 6, T_BARN = 7, T_CHURCH = 8;
// row cards (vegetation.js rows): 0 bare trees, 1 a pine wood's edge
const R_BARE = 0, R_PINE = 1;
const rnd = (x, z, s) => ihash(Math.floor(x * 2.7), Math.floor(z * 2.7), s);

// clip the segment p0-p1 (world) to cell c's rectangle (region frame); returns [x0, z0, x1, z1] or null
const _clip = [0, 0];
// one side of a Liang-Barsky clip: false when the segment misses it
function clipSide(p, q) {
  if (p === 0) return q >= 0;
  const r = q / p;
  if (p < 0) { if (r > _clip[1]) return false; if (r > _clip[0]) _clip[0] = r; }
  else { if (r < _clip[0]) return false; if (r < _clip[1]) _clip[1] = r; }
  return true;
}
function clipToCell(c, x0, z0, x1, z1) {
  const u0 = x0 * RC + z0 * RS, v0 = -x0 * RS + z0 * RC + c.o, u1 = x1 * RC + z1 * RS, v1 = -x1 * RS + z1 * RC + c.o;
  const du = u1 - u0, dv = v1 - v0;
  _clip[0] = 0; _clip[1] = 1;
  if (!clipSide(-du, u0 - c.L) || !clipSide(du, c.R - u0) || !clipSide(-dv, v0 - c.B) || !clipSide(dv, c.T - v0)) return null;
  const t0 = _clip[0], t1 = _clip[1];
  if (t1 - t0 < 1e-6) return null;
  return [x0 + (x1 - x0) * t0, z0 + (z1 - z0) * t0, x0 + (x1 - x0) * t1, z0 + (z1 - z0) * t1];
}
const insideCell = (c, x, z, m = 0) => {
  const u = x * RC + z * RS, v = -x * RS + z * RC + c.o;
  return u > c.L + m && u < c.R - m && v > c.B + m && v < c.T - m;
};
// field frame of cell c to world
const fw = (c, fu, fv) => [c.ox + fu * c.ca - fv * c.sa, c.oz + fu * c.sa + fv * c.ca];

// a hedgebank: oaks standing out of hazel, blackthorn and birch, or cards beyond `near`
function hedge(ctx, x0, z0, x1, z1, seed) {
  const dx = x1 - x0, dz = z1 - z0, len = Math.hypot(dx, dz);
  if (len < 4) return;
  const mx = (x0 + x1) / 2 - ctx.cx, mz = (z0 + z1) / 2 - ctx.cz;
  const md = mx * mx + mz * mz;
  if (md > ctx.near * ctx.near) {
    // far off, more and more hedges are left out (the rest still line most fields)
    const keep = md > 5000 * 5000 ? 0.3 : md > 3000 * 3000 ? 0.55 : 1;
    if (ihash(seed, 7, 88) > keep) return;
    if (!onLanding((x0 + x1) / 2, (z0 + z1) / 2, 6)) ctx.row(x0, z0, x1, z1, R_BARE, 10 + 5 * ihash(seed, 1, 87), 0.95);
    return;
  }
  const sx = dx / len, sz = dz / len;
  // a hedge is mostly shrubs with an oak every 15 to 30 m; some are lines of big oaks
  const big = ihash(seed, 3, 83) < 0.3;
  for (let t = 2; t < len - 2;) {
    const r = ihash(Math.floor(x0 + sx * t), Math.floor(z0 + sz * t), 79);
    t += (big ? 7 : 5) + 3.5 * r / Math.max(0.5, ctx.dens);
    const x = x0 + sx * t + sz * (r - 0.5) * 2.5, z = z0 + sz * t - sx * (r - 0.5) * 2.5;
    if (onLanding(x, z, 4)) continue;
    const pick = rnd(x, z, 81);
    if (big ? pick < 0.72 : pick < 0.24) ctx.put(x, z, T_OAK, 0.75 + 0.55 * rnd(x, z, 85), 0.9);
    else if (pick < (big ? 0.8 : 0.34)) ctx.put(x, z, T_BIRCH, 0.7 + 0.4 * rnd(x, z, 85), 0.9);
    else if (md < 1000 * 1000) ctx.put(x, z, T_SHRUB, 0.8 + 0.6 * rnd(x, z, 85), 0.85);
  }
}

// a wood or copse filling the part of rectangle (corner p, sides e1, e2: world vectors) that is `kind`
function wood(ctx, kind, px, pz, e1x, e1z, e2x, e2z, test, seed) {
  const l1 = Math.hypot(e1x, e1z), l2 = Math.hypot(e2x, e2z);
  // the wood's distance from the camera (its nearest corner)
  const qx = ctx.cx - px, qz = ctx.cz - pz;
  const s1 = Math.min(Math.max((qx * e1x + qz * e1z) / (l1 * l1), 0), 1), s2 = Math.min(Math.max((qx * e2x + qz * e2z) / (l2 * l2), 0), 1);
  const nd = Math.hypot(px + e1x * s1 + e2x * s2 - ctx.cx, pz + e1z * s1 + e2z * s2 - ctx.cz);
  if (nd > ctx.far) return;
  if (nd > ctx.woodR) {
    // beyond: cards round the wood's edges, and across it every 70 m so it has depth seen at a slant
    const card = (ax, az, bx, bz, k) => {
      const seg = test.clip ? test.clip(ax, az, bx, bz) : [ax, az, bx, bz];
      if (seg) ctx.row(seg[0], seg[1], seg[2], seg[3], kind === PINE ? R_PINE : R_BARE, kind === PINE ? 17 + 4 * ihash(seed, k, 89) : 14 + 4 * ihash(seed, k, 89), kind === PINE ? 1 : 0.9, test.keep);
    };
    const corners = [[px, pz], [px + e1x, pz + e1z], [px + e1x + e2x, pz + e1z + e2z], [px + e2x, pz + e2z]];
    const mx = px + (e1x + e2x) / 2, mz = pz + (e1z + e2z) / 2;
    for (let k = 0; k < 4; k++) {
      const [ax, az] = corners[k], [bx, bz] = corners[(k + 1) % 4];
      // an edge with more wood beyond it is inside a bigger wood: no card
      const ex = (ax + bx) / 2, ez = (az + bz) / 2, el = Math.hypot(ex - mx, ez - mz) || 1;
      const out = coverAt(ex + ((ex - mx) / el) * 8, ez + ((ez - mz) / el) * 8).kind;
      if (out === PINE || out === DECID) continue;
      card(ax, az, bx, bz, k);
    }
    const n = nd < 3500 ? Math.floor(l2 / 70) : 0;
    for (let k = 1; k <= n; k++) {
      const t = k / (n + 1);
      card(px + e2x * t, pz + e2z * t, px + e1x + e2x * t, pz + e1z + e2z * t, k + 4);
    }
    return;
  }
  const sp = (kind === PINE ? 8 : 8.5) / Math.sqrt(Math.max(0.5, ctx.dens));
  const n1 = Math.ceil(l1 / sp), n2 = Math.ceil(l2 / sp);
  // a plantation is one age: its height is the stand's
  const age = 0.75 + 0.45 * ihash(seed, 5, 91);
  for (let b = 0; b < n2; b++) for (let a = 0; a < n1; a++) {
    const h1 = ihash(seed + a, b, 93), h2 = ihash(seed + a, b, 94);
    const t1 = (a + 0.15 + 0.7 * h1) / n1, t2 = (b + 0.15 + 0.7 * h2) / n2;
    const x = px + e1x * t1 + e2x * t2, z = pz + e1z * t1 + e2z * t2;
    if (!test(x, z)) continue;
    const pick = ihash(seed + a, b, 95);
    if (kind === PINE) {
      if (pick < 0.92) ctx.put(x, z, T_PINE, age * (0.88 + 0.24 * h1), 0.85 + 0.2 * h2);
      else ctx.put(x, z, T_BIRCH, 0.8 + 0.3 * h1, 0.9);
    } else if (pick < 0.5) ctx.put(x, z, T_OAK, 0.8 + 0.5 * h1, 0.9);
    else if (pick < 0.8) ctx.put(x, z, T_BIRCH, 0.75 + 0.45 * h1, 0.9);
    else if (pick < 0.9) ctx.put(x, z, T_PINE, 0.8 + 0.3 * h1, 0.9);
    else ctx.put(x, z, T_SHRUB, 1 + 0.5 * h1, 0.85);
  }
}

// heath and bog: lone pines, birch scrub, junipers
function scatter(ctx, kind, px, pz, e1x, e1z, e2x, e2z, test, seed) {
  const l1 = Math.hypot(e1x, e1z), l2 = Math.hypot(e2x, e2z), sp = 34;
  const n1 = Math.ceil(l1 / sp), n2 = Math.ceil(l2 / sp);
  for (let b = 0; b < n2; b++) for (let a = 0; a < n1; a++) {
    const p = ihash(seed + a, b, 97);
    if (p > (kind === HEATH ? 0.34 : 0.16) * ctx.dens) continue;
    const t1 = (a + ihash(seed + a, b, 98)) / n1, t2 = (b + ihash(seed + a, b, 99)) / n2;
    const x = px + e1x * t1 + e2x * t2, z = pz + e1z * t1 + e2z * t2;
    if (!test(x, z)) continue;
    const s = ihash(seed + a, b, 100);
    if (kind === HEATH) {
      if (p < 0.08) ctx.put(x, z, T_HEATHPINE, 0.6 + 0.6 * s, 0.9);
      else if (p < 0.15) ctx.put(x, z, T_BIRCH, 0.55 + 0.5 * s, 0.95);
      else ctx.put(x, z, T_JUNIPER, 0.6 + 0.8 * s, 0.9);
    } else if (p < 0.12) ctx.put(x, z, T_BIRCH, 0.4 + 0.45 * s, 0.95);
    else ctx.put(x, z, T_HEATHPINE, 0.4 + 0.4 * s, 0.85);
  }
}

// the trees, houses and cards of one region cell
function plantCell(ctx, c) {
  const { cs } = c;
  // the cell's rectangle in its field frame
  const corners = [[c.L, c.B], [c.R, c.B], [c.R, c.T], [c.L, c.T]].map(([u, v]) => {
    const vv = v - c.o, x = u * RC - vv * RS, z = u * RS + vv * RC, dx = x - c.ox, dz = z - c.oz;
    return [dx * c.ca + dz * c.sa, -dx * c.sa + dz * c.ca];
  });
  const fu0 = Math.min(...corners.map((p) => p[0])), fu1 = Math.max(...corners.map((p) => p[0]));
  const fv0 = Math.min(...corners.map((p) => p[1])), fv1 = Math.max(...corners.map((p) => p[1]));
  const near2 = ctx.R * ctx.R;
  for (let fi = Math.floor(fu0 / c.su) - 1; fi <= Math.floor(fu1 / c.su) + 1; fi++) {
    const FL = fcolB(c, fi), FR = fcolB(c, fi + 1);
    if (FR < fu0 || FL > fu1) continue;
    // the column line's hedge pieces
    for (let s = Math.floor(fv0 / HSEG); s <= Math.floor(fv1 / HSEG); s++) {
      if (ihash(fi, s, cs + 341) >= c.pHc) continue;
      const [ax, az] = fw(c, FL, s * HSEG), [bx, bz] = fw(c, FL, (s + 1) * HSEG);
      const seg = clipToCell(c, ax, az, bx, bz);
      if (seg) hedge(ctx, seg[0], seg[1], seg[2], seg[3], fi * 31 + s * 17 + cs);
    }
    const fo = frowOff(c, fi);
    for (let fj = Math.floor((fv0 + fo) / c.sv) - 1; fj <= Math.floor((fv1 + fo) / c.sv) + 1; fj++) {
      const FB = frowB(c, fi, fj) - fo, FT = frowB(c, fi, fj + 1) - fo;
      if (FT < fv0 || FB > fv1) continue;
      if (ihash(fi, fj, cs + 343) < c.pHr) {
        const [ax, az] = fw(c, FL, FB), [bx, bz] = fw(c, FR, FB);
        const seg = clipToCell(c, ax, az, bx, bz);
        if (seg) hedge(ctx, seg[0], seg[1], seg[2], seg[3], fi * 13 + fj * 29 + cs);
      }
      const k = fieldBase(c, fi, fj, FL, FB);
      if (k < HEATH) continue;
      const [px, pz] = fw(c, FL, FB);
      const e1x = (FR - FL) * c.ca, e1z = (FR - FL) * c.sa, e2x = -(FT - FB) * c.sa, e2z = (FT - FB) * c.ca;
      const seed = fi * 7 + fj * 131 + cs;
      const test = (x, z) => insideCell(c, x, z, 4) && override(x, z, k) === k && farmDist(x, z) > 42;
      test.clip = (ax, az, bx, bz) => clipToCell(c, ax, az, bx, bz);
      test.keep = (x, z) => override(x, z, k) === k;
      if (k === PINE || k === DECID) wood(ctx, k, px, pz, e1x, e1z, e2x, e2z, test, seed);
      else {
        const mx = px + (e1x + e2x) / 2 - ctx.cx, mz = pz + (e1z + e2z) / 2 - ctx.cz;
        if (mx * mx + mz * mz < near2) scatter(ctx, k, px, pz, e1x, e1z, e2x, e2z, test, seed);
      }
    }
  }
  // the lanes on the cell's west and north edges that are roads with an avenue
  const lane = (ax, az, bx, bz, seed) => {
    const mx = (ax + bx) / 2 - ctx.cx, mz = (az + bz) / 2 - ctx.cz;
    if (mx * mx + mz * mz > ctx.near * ctx.near) {
      ctx.row(ax, az, bx, bz, R_BARE, 13 + 4 * ihash(seed, 2, 87), 0.95);
      return;
    }
    const dx = bx - ax, dz = bz - az, len = Math.hypot(dx, dz), sx = dx / len, sz = dz / len;
    for (let t = 6; t < len - 6; t += 11 / Math.max(0.5, ctx.dens)) {
      for (const side of [-1, 1]) {
        const x = ax + sx * t + sz * side * 5.5, z = az + sz * t - sx * side * 5.5;
        if (onLanding(x, z, 4) || rnd(x, z, 107) < 0.2) continue;
        ctx.put(x, z, rnd(x, z, 108) < 0.75 ? T_OAK : T_BIRCH, 0.85 + 0.4 * rnd(x, z, 109), 0.9);
      }
    }
  };
  for (let s = Math.floor((c.B - c.o) / LANE); s <= Math.floor((c.T - c.o) / LANE); s++) {
    if (!avenueCol(c.i, s)) continue;
    const v0 = Math.max(s * LANE, c.B - c.o), v1 = Math.min((s + 1) * LANE, c.T - c.o);
    if (v1 - v0 < 20) continue;
    lane(c.L * RC - v0 * RS, c.L * RS + v0 * RC, c.L * RC - v1 * RS, c.L * RS + v1 * RC, c.i * 3 + s * 7);
  }
  if (avenueRow(c.i, c.j)) {
    const v = c.B - c.o;
    lane(c.L * RC - v * RS, c.L * RS + v * RC, c.R * RC - v * RS, c.R * RS + v * RC, c.i * 5 + c.j * 11);
  }
}
// the lanes that are roads with trees: pieces of the region's column lines, and its row lines (GLSL twins in
// GLSL_COVER)
const avenueCol = (i, s) => ihash(i, s, 353) < 0.22;
const avenueRow = (i, j) => ihash(i, j, 355) < 0.22;

// a farmstead: the house, a barn, a ring of oaks round the yard, a few fruit trees
function farm(ctx, f, i, j) {
  const d = Math.hypot(f.x - ctx.cx, f.z - ctx.cz);
  if (d > ctx.far * 0.7) return;
  if (d > ctx.R) {
    // beyond: the grove as two crossed cards
    const c = Math.cos(f.rot), s = Math.sin(f.rot);
    ctx.row(f.x - c * 35, f.z - s * 35, f.x + c * 35, f.z + s * 35, R_BARE, 15 + 4 * ihash(i, j, 511), 0.9);
    ctx.row(f.x + s * 28, f.z - c * 28, f.x - s * 28, f.z + c * 28, R_BARE, 14 + 4 * ihash(i, j, 512), 0.9);
    return;
  }
  const c = Math.cos(f.rot), s = Math.sin(f.rot);
  const big = ihash(i, j, 513);
  // the Hallenhaus (house, byre and barn under one roof): 13 to 16 m wide, 26 to 34 m long
  ctx.house(f.x, f.z, T_HOUSE, f.rot, 13 + 3 * big, 10 + 2 * big, 26 + 8 * big, 0.85 + 0.3 * ihash(i, j, 514));
  // a barn or shed across the yard
  const bx = f.x + s * 26 - c * 6, bz = f.z - c * 26 - s * 6;
  ctx.house(bx, bz, T_BARN, f.rot + Math.PI / 2, 8 + 3 * big, 6 + 2 * big, 14 + 6 * ihash(i, j, 515), 0.8 + 0.3 * ihash(i, j, 516));
  // the oaks round the yard, thinner on the side the house faces the lane
  const n = 8 + Math.floor(7 * ihash(i, j, 517));
  for (let k = 0; k < n; k++) {
    const a = f.rot + (k / n) * TAU + (ihash(i, j, 520 + k) - 0.5) * 0.5;
    if (Math.cos(a - f.rot) > 0.75 && ihash(i, j, 540 + k) < 0.7) continue;
    const r = 34 + 14 * ihash(i, j, 560 + k);
    const x = f.x + Math.cos(a) * r, z = f.z + Math.sin(a) * r;
    ctx.put(x, z, ihash(i, j, 580 + k) < 0.8 ? T_OAK : T_BIRCH, 0.95 + 0.45 * ihash(i, j, 600 + k), 0.9);
  }
  // fruit trees and bushes in the garden behind the house
  for (let k = 0; k < 5; k++) {
    const a = f.rot + Math.PI + (ihash(i, j, 620 + k) - 0.5) * 1.6, r = 18 + 10 * ihash(i, j, 630 + k);
    ctx.put(f.x + Math.cos(a) * r, f.z + Math.sin(a) * r, T_SHRUB, 1.2 + 0.6 * ihash(i, j, 640 + k), 0.9);
  }
}

// a village or town: houses packed round the church, gardens with trees
function village(ctx, v, vi) {
  const [vx, vz, vr, church] = v;
  const d = Math.hypot(vx - ctx.cx, vz - ctx.cz);
  if (d > ctx.far + vr) return;
  if (church) ctx.house(vx, vz, T_CHURCH, RA + ihash(vi, 0, 701) * 0.4, church === 2 ? 1.4 : 1, church === 2 ? 1.5 : 1, church === 2 ? 1.4 : 1, 1, true);
  if (d - vr > ctx.R) return;
  const G = church === 2 ? 34 : 42;
  const n = Math.ceil(vr / G);
  const rot0 = RA + (ihash(vi, 1, 702) - 0.5) * 0.6;
  const c = Math.cos(rot0), s = Math.sin(rot0);
  for (let b = -n; b <= n; b++) for (let a = -n; a <= n; a++) {
    const lu = (a + (ihash(vi * 97 + a, b, 703) - 0.5) * 0.4) * G, lv = (b + (ihash(vi * 97 + a, b, 704) - 0.5) * 0.4) * G;
    const x = vx + lu * c - lv * s, z = vz + lu * s + lv * c;
    const r = Math.hypot(x - vx, z - vz) / vr;
    if (r > 1 || r < 0.05) continue;
    // the gun positions keep their field of fire
    if (AF.guns.some((g) => (x - g[0]) ** 2 + (z - g[1]) ** 2 < 170 * 170)) continue;
    const p = ihash(vi * 97 + a, b, 705);
    if (p > 0.85 * Math.pow(1 - r, 0.5)) {
      if (p < 0.95) ctx.put(x, z, ihash(vi * 97 + a, b, 706) < 0.6 ? T_OAK : T_SHRUB, 0.8 + 0.5 * p, 0.9);
      continue;
    }
    const h = ihash(vi * 97 + a, b, 707);
    const rot = rot0 + (ihash(vi * 97 + a, b, 708) < 0.5 ? 0 : Math.PI / 2) + (h - 0.5) * 0.2;
    ctx.house(x, z, h < 0.8 ? T_HOUSE : T_BARN, rot, 8 + 4 * h, 8 + 3 * h, 11 + 7 * ihash(vi * 97 + a, b, 709), 0.8 + 0.35 * ihash(vi * 97 + a, b, 710));
  }
}

// alders along the brooks
function brooks(ctx) {
  for (const w of WATERS) {
    if (w.kind !== 'brook') continue;
    const P = w.pts;
    for (let k = 1; k < P.length; k++) {
      const [ax, az] = P[k - 1], [bx, bz] = P[k];
      const mx = (ax + bx) / 2 - ctx.cx, mz = (az + bz) / 2 - ctx.cz, md = mx * mx + mz * mz;
      if (md > ctx.far * ctx.far * 0.5) continue;
      const len = Math.hypot(bx - ax, bz - az);
      if (md > ctx.R * ctx.R) {
        if (ihash(k, P.length, 721) < 0.5) ctx.row(ax, az, bx, bz, R_BARE, 11 + 4 * ihash(k, 3, 722), 0.85);
        continue;
      }
      const sx = (bx - ax) / len, sz = (bz - az) / len;
      for (let t = 3; t < len; t += 10 / Math.max(0.5, ctx.dens)) {
        const x0 = ax + sx * t, z0 = az + sz * t, r = rnd(x0, z0, 723);
        if (r > 0.55) continue;
        const side = r < 0.27 ? -1 : 1, off = 4.5 + 3 * rnd(x0, z0, 724);
        const x = x0 + sz * side * off, z = z0 - sx * side * off;
        if (onLanding(x, z, 4)) continue;
        ctx.put(x, z, r < 0.1 ? T_SHRUB : r < 0.18 ? T_BIRCH : T_OAK, 0.7 + 0.4 * rnd(x0, z0, 725), 0.72);
      }
    }
  }
}

/**
 * Plants everything around the camera through ctx (vegetation.js): { cx, cz, R (single trees within),
 * near (hedges nearer than this get single trees, the rest cards), woodR (woods filled within), far (cards
 * out to), dens, put(x, z, species, scale, tint), house(x, z, species, rot, width, height, length, tint, far),
 * row(x0, z0, x1, z1, card, height, tint, keep) }. A generator: it yields between pieces of work, so the
 * planter can spread a replanting over a few frames.
 */
function* plant(ctx, layout) {
  setLayout(layout);
  const { cx, cz } = ctx;
  const uc = cx * RC + cz * RS, vc = -cx * RS + cz * RC, R = ctx.far;
  for (let i = Math.floor((uc - R) / RU) - 1; i <= Math.floor((uc + R) / RU) + 1; i++) {
    const L = rcolB(i), Rr = rcolB(i + 1);
    if (Rr < uc - R || L > uc + R) continue;
    const o = rrowOff(i);
    for (let j = Math.floor((vc - R + o) / RV) - 1; j <= Math.floor((vc + R + o) / RV) + 1; j++) {
      const c = cellAt(i, j);
      const du = Math.max(c.L - uc, 0, uc - c.R), dv = Math.max(c.B - o - vc, 0, vc - (c.T - o));
      if (du * du + dv * dv > R * R) continue;
      plantCell(ctx, c);
      yield;
    }
  }
  // the airfield's woods
  for (const w of AF.woods) {
    const px = AF.cx + AF.ax * w[0] + AF.dx * w[2], pz = AF.cz + AF.az * w[0] + AF.dz * w[2];
    const la = w[1] - w[0], ld = w[3] - w[2];
    const test = (x, z) => override(x, z, 0) === w[4];
    test.keep = test;
    wood(ctx, w[4], px, pz, AF.ax * la, AF.az * la, AF.dx * ld, AF.dz * ld, test, Math.round(w[0] * 3 + w[2]));
    yield;
  }
  // farmsteads
  const fr = ctx.far * 0.7;
  const fi0 = Math.floor((uc - fr) / FS), fi1 = Math.floor((uc + fr) / FS), fj0 = Math.floor((vc - fr) / FS), fj1 = Math.floor((vc + fr) / FS);
  for (let j = fj0; j <= fj1; j++) {
    for (let i = fi0; i <= fi1; i++) {
      const f = farmSite(i, j);
      if (f) farm(ctx, f, i, j);
    }
    yield;
  }
  VILLAGES.forEach((v, k) => village(ctx, v, k));
  yield;
  brooks(ctx);
}

// ---------------------------------------------------------------- GLSL
const g = (n) => (Number.isInteger(n) ? n.toFixed(1) : String(n));
const vec = (a) => a.map(g).join(', ');
const arr = (type, list, n, fill) => `${type}[${Math.max(1, n)}](${(n ? list : [fill]).join(', ')})`;

// The layout's constants (the landing ground, the airfield woods, the taxiways, the guns, the villages)
function glslLayout(layout) {
  setLayout(layout);
  const woods = AF.woods.map((w) => `vec4(${vec(w.slice(0, 4))})`), wk = AF.woods.map((w) => String(w[4]));
  // taxiways: from each bay's mouth out to the perimeter track, and along the row of mouths
  const taxi = [];
  const mouths = AF.bays.map((b) => [b.x + b.fx * 13, b.z + b.fz * 13, b]).sort((p, q) => p[2].a - q[2].a);
  for (const [mx, mz, b] of mouths) {
    // along the bay's facing until the landing ground's edge (or 200 m)
    let t = 0;
    for (; t < 260; t += 2) if (onLanding(mx + b.fx * t, mz + b.fz * t)) break;
    taxi.push(`vec4(${vec([mx, mz, mx + b.fx * (t + 6), mz + b.fz * (t + 6)])})`);
  }
  for (let k = 1; k < mouths.length; k++) taxi.push(`vec4(${vec([mouths[k - 1][0], mouths[k - 1][1], mouths[k][0], mouths[k][1]])})`);
  const guns = AF.guns.map((p) => `vec2(${vec(p)})`), sites = AF.sites.map((p) => `vec2(${vec(p)})`);
  return /* glsl */ `
const vec2 AF_C = vec2(${vec([AF.cx, AF.cz])});
const vec2 AF_A = vec2(${AF.ax.toFixed(8)}, ${AF.az.toFixed(8)});
const vec2 AF_D = vec2(${AF.dx.toFixed(8)}, ${AF.dz.toFixed(8)});
const vec4 AF_LG = vec4(${vec([AF.a0, AF.a1, AF.d0, AF.d1])});
const int AF_NW = ${woods.length};
const vec4 AF_WOOD[${Math.max(1, woods.length)}] = ${arr('vec4', woods, woods.length, 'vec4(0.0)')};
const int AF_WK[${Math.max(1, wk.length)}] = ${arr('int', wk, wk.length, '0')};
const int AF_NT = ${taxi.length};
const vec4 AF_TAXI[${Math.max(1, taxi.length)}] = ${arr('vec4', taxi, taxi.length, 'vec4(0.0)')};
const int NGUN = ${guns.length};
const vec2 GUNS[${Math.max(1, guns.length)}] = ${arr('vec2', guns, guns.length, 'vec2(1e9)')};
const int NSITE = ${sites.length};
const vec2 SITES[${Math.max(1, sites.length)}] = ${arr('vec2', sites, sites.length, 'vec2(1e9)')};
`;
}

// The cover function, line by line the JS above (coverAt, fieldBase, override, zoneAt, farmSite)
const GLSL_COVER = /* glsl */ `
const float RC = ${RC.toFixed(8)};
const float RS = ${RS.toFixed(8)};
const float RU = ${g(RU)};
const float RV = ${g(RV)};
float ihash(int x, int y, int s) {
  uint h = uint(x) * 0x27d4eb2du ^ uint(y) * 0x165667b1u ^ uint(s) * 0x9e3779b1u;
  h ^= h >> 15u; h *= 0x85ebca6bu; h ^= h >> 13u; h *= 0xc2b2ae35u; h ^= h >> 16u;
  return float(h >> 8u) / 16777216.0;
}
float vnI(vec2 p, int s) {
  vec2 i = floor(p), f = p - i;
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  int x = int(i.x), y = int(i.y);
  float a = ihash(x, y, s), b = ihash(x + 1, y, s), c = ihash(x, y + 1, s), d = ihash(x + 1, y + 1, s);
  return a + (b - a) * u.x + (c - a) * u.y + (a - b - c + d) * u.x * u.y;
}
const vec3 MOORS[${MOOR_SITES.length}] = vec3[](${MOOR_SITES.map((s) => `vec3(${vec(s)})`).join(', ')});
const vec3 HEATHS[${HEATH_SITES.length}] = vec3[](${HEATH_SITES.map((s) => `vec3(${vec(s)})`).join(', ')});
const vec4 FOREST_A[${FORESTS.length}] = vec4[](${FORESTS.map((c) => `vec4(${vec(c.slice(0, 4))})`).join(', ')});
const vec2 FOREST_B[${FORESTS.length}] = vec2[](${FORESTS.map((c) => `vec2(${vec(c.slice(4))})`).join(', ')});
const vec4 VILLAGES[${VILLAGES.length}] = vec4[](${VILLAGES.map((v) => `vec4(${vec(v)})`).join(', ')});
// x bog, y heath, z the share of woods
vec3 zoneAt(vec2 p) {
  float far = smoothstep(2400.0, 4400.0, length(p));
  float m = 0.0, h = 0.0, f = 0.0;
  for (int k = 0; k < ${MOOR_SITES.length}; k++) m = max(m, 1.0 - smoothstep(MOORS[k].z * 0.55, MOORS[k].z, length(p - MOORS[k].xy)));
  for (int k = 0; k < ${HEATH_SITES.length}; k++) h = max(h, 1.0 - smoothstep(HEATHS[k].z * 0.55, HEATHS[k].z, length(p - HEATHS[k].xy)));
  for (int k = 0; k < ${FORESTS.length}; k++) {
    vec2 a = FOREST_A[k].xy, d = FOREST_A[k].zw - a;
    float t = clamp(dot(p - a, d) / dot(d, d), 0.0, 1.0);
    f = max(f, FOREST_B[k].y * (1.0 - smoothstep(FOREST_B[k].x * 0.6, FOREST_B[k].x, length(p - a - d * t))));
  }
  m = max(m, smoothstep(0.72, 0.82, vnI(p / 4300.0, 401)) * far);
  h = max(h, smoothstep(0.66, 0.76, vnI(vec2(p.x / 2900.0 + 5.3, p.y / 2900.0 - 1.7), 403)) * far);
  return vec3(m, h * (1.0 - m), max(0.05 + 0.11 * vnI(p / 2300.0, 405), f));
}
float rcolB(int i) { return float(i) * RU + (ihash(i, 0, 301) - 0.5) * 0.5 * RU; }
float rrowOff(int i) { return ihash(i, 0, 303) * RV; }
float rrowB(int i, int j) { return float(j) * RV + (ihash(i, j, 305) - 0.5) * 0.5 * RV; }
struct Cell { int i; int j; float L; float R; float B; float T; float o; int cs; bool strips; float pHc; float pHr; float su; float sv; float ca; float sa; vec2 org; };
Cell cellOf(vec2 p) {
  float u = p.x * RC + p.y * RS, v = -p.x * RS + p.y * RC;
  int i = int(floor(u / RU));
  if (u < rcolB(i)) i--; else if (u >= rcolB(i + 1)) i++;
  float o = rrowOff(i), vv = v + o;
  int j = int(floor(vv / RV));
  if (vv < rrowB(i, j)) j--; else if (vv >= rrowB(i, j + 1)) j++;
  Cell c;
  c.i = i; c.j = j; c.o = o;
  c.L = rcolB(i); c.R = rcolB(i + 1); c.B = rrowB(i, j); c.T = rrowB(i, j + 1);
  c.cs = i * 7919 + j * 104729;
  float cu = (c.L + c.R) * 0.5, cv = (c.B + c.T) * 0.5 - o;
  vec2 cc = vec2(cu * RC - cv * RS, cu * RS + cv * RC);
  float off = (vnI(vec2(cc.x / 4200.0 + 2.3, cc.y / 4200.0 - 0.7), 315) - 0.5) * 1.6 + (ihash(i, j, 313) - 0.5) * 0.14;
  bool strips = ihash(i, j, 317) < 0.22;
  c.strips = strips;
  float h2 = 0.6 * vnI(vec2(cc.x / 3000.0 - 1.3, cc.y / 3000.0 + 4.1), 319) + 0.4 * ihash(i, j, 319);
  float h3 = 0.5 * vnI(vec2(cc.x / 3000.0 + 6.1, cc.y / 3000.0 - 2.9), 321) + 0.5 * ihash(i, j, 321);
  vec3 zc = zoneAt(cc);
  float pH = 0.62 * (1.0 - zc.x) * (1.0 - 0.6 * zc.y) + 0.04;
  c.pHc = strips ? 0.04 : pH;
  c.pHr = pH * 0.8;
  c.su = strips ? 24.0 + 26.0 * h2 : 90.0 + 120.0 * h2;
  c.sv = strips ? 210.0 + 220.0 * h3 : 120.0 + 190.0 * h3;
  c.ca = cos(${g(RA)} + off); c.sa = sin(${g(RA)} + off);
  c.org = vec2(c.L * RC - (c.B - o) * RS, c.L * RS + (c.B - o) * RC);
  return c;
}
float fcolB(Cell c, int i) { return float(i) * c.su + (ihash(i, c.cs, 331) - 0.5) * 0.5 * c.su; }
float frowOff(Cell c, int i) { return ihash(i, c.cs, 333) * c.sv; }
float frowB(Cell c, int i, int j) { return float(j) * c.sv + (ihash(i, j, c.cs + 335) - 0.5) * 0.5 * c.sv; }
int fieldBase(Cell c, int fi, int fj, float FL, float FB) {
  vec2 an = c.org + vec2(FL * c.ca - FB * c.sa, FL * c.sa + FB * c.ca);
  vec3 zn = zoneAt(an);
  float h = ihash(fi, fj, c.cs + 337);
  if (!c.strips) {
    if (zn.x > 0.5) return h < 0.72 ? 5 : h < 0.86 ? 4 : h < 0.94 ? 7 : 6;
    if (zn.y > 0.5) return h < 0.5 ? 4 : h < 0.85 ? 6 : h < 0.93 ? 2 : 0;
    if (vnI(vec2(an.x / 700.0 + 3.7, an.y / 700.0 + 1.1), 407) < zn.z * 1.35) return h < 0.62 ? 6 : 7;
  }
  float g = ihash(fi, fj, c.cs + 339);
  return g < 0.32 ? 0 : g < 0.55 ? 1 : g < 0.88 ? 2 : 3;
}
vec2 afFrame(vec2 p) { vec2 q = p - AF_C; return vec2(dot(q, AF_A), dot(q, AF_D)); }
const vec2 RH_C = vec2(${vec([RHEINE.cx, RHEINE.cz])});
const vec2 RH_A = vec2(${RHEINE.ax.toFixed(8)}, ${RHEINE.az.toFixed(8)});
const vec2 RH_H = vec2(${vec(RHEINE.half)});
const vec4 RH_RWY[3] = vec4[](${RHEINE.runways.map((r) => `vec4(${vec(r.map((v) => +v.toFixed(2)))})`).join(', ')});
bool onRheine(vec2 p, float m) { vec2 q = p - RH_C; return abs(dot(q, RH_A)) < RH_H.x + m && abs(-q.x * RH_A.y + q.y * RH_A.x) < RH_H.y + m; }
bool onLanding(vec2 p, float m) { vec2 r = afFrame(p); return (r.x > AF_LG.x - m && r.x < AF_LG.y + m && r.y > AF_LG.z - m && r.y < AF_LG.w + m) || onRheine(p, m); }
int overrideKind(vec2 p, int k) {
  vec2 r = afFrame(p);
  if ((r.x > AF_LG.x && r.x < AF_LG.y && r.y > AF_LG.z && r.y < AF_LG.w) || onRheine(p, 0.0)) return 8;
  for (int w = 0; w < AF_NW; w++) if (r.x > AF_WOOD[w].x && r.x < AF_WOOD[w].y && r.y > AF_WOOD[w].z && r.y < AF_WOOD[w].w) return AF_WK[w];
  for (int n = 0; n < NGUN; n++) { vec2 e = p - GUNS[n]; if (dot(e, e) < 28900.0) return 2; }
  return k;
}
struct Cover { int kind; float hedge; float edge; float lane; float road; float eL; float eB; float fu; float fv; int fi; int fj; Cell c; };
Cover coverAt(vec2 p) {
  Cover r;
  Cell c = cellOf(p);
  vec2 d = p - c.org;
  float fu = d.x * c.ca + d.y * c.sa, fv = -d.x * c.sa + d.y * c.ca;
  int fi = int(floor(fu / c.su));
  if (fu < fcolB(c, fi)) fi--; else if (fu >= fcolB(c, fi + 1)) fi++;
  float FL = fcolB(c, fi), FR = fcolB(c, fi + 1), fo = frowOff(c, fi), fvv = fv + fo;
  int fj = int(floor(fvv / c.sv));
  if (fvv < frowB(c, fi, fj)) fj--; else if (fvv >= frowB(c, fi, fj + 1)) fj++;
  float FB = frowB(c, fi, fj), FT = frowB(c, fi, fj + 1);
  r.c = c; r.fi = fi; r.fj = fj; r.fu = fu; r.fv = fvv;
  r.kind = overrideKind(p, fieldBase(c, fi, fj, FL, FB - fo));
  int seg = int(floor(fv / ${g(HSEG)}));
  float hedge = 1e9;
  if (ihash(fi, seg, c.cs + 341) < c.pHc) hedge = min(hedge, fu - FL);
  if (ihash(fi + 1, seg, c.cs + 341) < c.pHc) hedge = min(hedge, FR - fu);
  if (ihash(fi, fj, c.cs + 343) < c.pHr) hedge = min(hedge, fvv - FB);
  if (ihash(fi, fj + 1, c.cs + 343) < c.pHr) hedge = min(hedge, FT - fvv);
  r.hedge = hedge;
  r.eL = fu - FL; r.eB = fvv - FB;
  r.edge = min(min(fu - FL, FR - fu), min(fvv - FB, FT - fvv));
  // lanes on most of the region's edges: sand tracks wandering a few metres, or straight roads with an avenue
  // (avenueCol, avenueRow in JS)
  float u = p.x * RC + p.y * RS, v = -p.x * RS + p.y * RC, vv = v + c.o;
  int s = int(floor(v / ${g(LANE)}));
  r.lane = 1e9; r.road = 0.0;
  bool av = ihash(c.i, s, 353) < 0.22;
  if (av || ihash(c.i, s, 357) < 0.72) { float d = abs(u - c.L - (av ? 0.0 : 2.5 * sin(v * 0.011 + float(c.i) * 1.7))); if (d < r.lane) { r.lane = d; r.road = av ? 1.0 : 0.0; } }
  av = ihash(c.i + 1, s, 353) < 0.22;
  if (av || ihash(c.i + 1, s, 357) < 0.72) { float d = abs(u - c.R - (av ? 0.0 : 2.5 * sin(v * 0.011 + float(c.i + 1) * 1.7))); if (d < r.lane) { r.lane = d; r.road = av ? 1.0 : 0.0; } }
  av = ihash(c.i, c.j, 355) < 0.22;
  if (av || ihash(c.i, c.j, 359) < 0.72) { float d = abs(vv - c.B - (av ? 0.0 : 2.5 * sin(u * 0.012 + float(c.j) * 2.3))); if (d < r.lane) { r.lane = d; r.road = av ? 1.0 : 0.0; } }
  av = ihash(c.i, c.j + 1, 355) < 0.22;
  if (av || ihash(c.i, c.j + 1, 359) < 0.72) { float d = abs(vv - c.T - (av ? 0.0 : 2.5 * sin(u * 0.012 + float(c.j + 1) * 2.3))); if (d < r.lane) { r.lane = d; r.road = av ? 1.0 : 0.0; } }
  return r;
}
float villageAt(vec2 p) {
  float m = 0.0;
  for (int k = 0; k < ${VILLAGES.length}; k++) { float d = length(p - VILLAGES[k].xy); if (d < VILLAGES[k].z) m = max(m, 1.0 - d / VILLAGES[k].z); }
  return m;
}
// the farmstead of the farm cell holding p: xy its place, z its turn, w 1 if there is one
vec4 farmAt(vec2 p) {
  int i = int(floor((p.x * RC + p.y * RS) / ${g(FS)})), j = int(floor((-p.x * RS + p.y * RC) / ${g(FS)}));
  if (ihash(i, j, 501) > 0.5) return vec4(0.0);
  float u = (float(i) + 0.2 + 0.6 * ihash(i, j, 502)) * ${g(FS)}, v = (float(j) + 0.2 + 0.6 * ihash(i, j, 503)) * ${g(FS)};
  vec2 f = vec2(u * RC - v * RS, u * RS + v * RC);
  if (onLanding(f, 160.0)) return vec4(0.0);
  for (int n = 0; n < NSITE; n++) if (length(f - SITES[n]) < 260.0) return vec4(0.0);
  float m = 0.0;
  for (int k = 0; k < ${MOOR_SITES.length}; k++) m = max(m, 1.0 - smoothstep(MOORS[k].z * 0.55, MOORS[k].z, length(f - MOORS[k].xy)));
  if (m > 0.3 || vnI(f / 4300.0, 401) > 0.74 || villageAt(f) > 0.0) return vec4(0.0);
  return vec4(f, ${g(RA)} + (ihash(i, j, 504) < 0.5 ? 0.0 : 1.5707963) + (ihash(i, j, 505) - 0.5) * 0.3, 1.0);
}
`;

// The ground's colour (terrain.js wraps it): in wp, q, tDist, tWN, vInfo (x the pad mask, y water and banks);
// out col (albedo), tBump (slope of the small relief, world xz), tDetail (strength of the detail normals),
// tGloss (0 dry to 1 standing water)
const GLSL_GROUND = /* glsl */ `
{
  Cover cv = coverAt(q);
  int k = cv.kind;
  float fieldT = ihash(cv.fi, cv.fj, cv.c.cs + 61);
  float nFar = fbm2(q * 0.0012 + 4.0);
  float nMid = tDist < 7000.0 ? fbm2(q * 0.02) : 0.5;
  float nNear = tDist < 600.0 ? vnoise(q * 1.3) : 0.5;
  float nFine = tDist < 90.0 ? vnoise(q * 9.0) : 0.5;
  float mpp = max(fwidth(q.x) + fwidth(q.y), 1e-4);
  vec2 gu = vec2(cv.c.ca, cv.c.sa);
  float nearK = 1.0 - smoothstep(60.0, 400.0, tDist);
  // the soil: sandy loam, greyer on the sand, darker and wetter in the hollows
  float sand = smoothstep(0.35, 0.75, nFar * 0.8 + nMid * 0.4 - 0.1);
  vec3 soil = mix(vec3(0.105, 0.078, 0.055), vec3(0.19, 0.16, 0.12), sand);
  float wet = smoothstep(0.55, 0.8, 1.0 - nMid) * 0.6;
  tGloss = 0.0;
  tDetail = 0.55;
  if (k == 0) {
    // ploughed in the autumn: ridges and shadowed furrows, clods, water standing in some furrows
    // the furrows wander a little (a horse plough's lines are not straight)
    float ph = cv.eL / 0.95 * 6.2831853 + (tDist < 400.0 ? vnoise(q * 0.045 + 1.7) * 7.0 : 3.5);
    float aa = 1.0 - smoothstep(0.2, 0.55, mpp / 0.95);
    float row = sin(ph) * aa;
    float clod = vnoise(q * vec2(9.0, 7.0));
    col = soil * (0.86 + 0.26 * (0.5 + 0.5 * row)) * (0.82 + 0.36 * clod);
    float puddle = smoothstep(0.62, 0.8, nNear) * smoothstep(0.3, 0.9, -row) * wet * nearK;
    col = mix(col, col * 0.55, puddle);
    tGloss = max(tGloss, puddle);
    tBump += gu * cos(ph) * 0.22 * aa * (0.6 + 0.8 * fieldT);
    tDetail = 0.8;
  } else if (k == 1) {
    // winter rye: thin green drills on harrowed soil
    float ph = cv.eL / 0.22 * 6.2831853;
    float aa = 1.0 - smoothstep(0.2, 0.55, mpp / 0.22);
    float row = 0.5 + 0.5 * sin(ph) * aa;
    vec3 green = vec3(0.055, 0.075, 0.03) * (0.85 + 0.3 * fieldT);
    col = mix(soil * 1.1, green, (0.42 + 0.3 * fieldT) * mix(0.75, row, aa) * (0.8 + 0.4 * nMid));
    tBump += gu * cos(ph) * 0.06 * aa;
  } else if (k == 2) {
    // winter grassland: dull green, dead straw in tussocks, muddy where the cattle stood
    vec3 sward = mix(vec3(0.066, 0.078, 0.036), vec3(0.088, 0.09, 0.045), fieldT);
    vec3 straw = vec3(0.19, 0.165, 0.1);
    col = mix(sward, straw, smoothstep(0.35, 0.8, nMid * 0.7 + nNear * 0.5 - 0.05) * (0.45 + 0.4 * fieldT));
    col = mix(col, soil * 0.8, smoothstep(0.75, 0.95, nNear) * wet * 0.6);
  } else if (k == 3) {
    // stubble and fallow: grey straw, weeds, bare patches
    float streak = vnoise(vec2(cv.eL * 9.0, cv.fv * 0.45));
    col = mix(vec3(0.2, 0.175, 0.115), vec3(0.25, 0.22, 0.15), streak * nearK);
    col = mix(col, vec3(0.07, 0.085, 0.035), smoothstep(0.6, 0.85, nMid) * 0.5);
    col = mix(col, soil, smoothstep(0.65, 0.9, nNear) * 0.5);
  } else if (k == 4) {
    // heath: brown heather, grass and bare sand on the paths
    vec3 heather = mix(vec3(0.1, 0.07, 0.048), vec3(0.096, 0.062, 0.058), nNear);
    col = mix(heather, vec3(0.2, 0.17, 0.11), smoothstep(0.55, 0.8, nMid) * 0.55);
    col = mix(col, vec3(0.32, 0.28, 0.21) * (0.85 + 0.3 * nFine), smoothstep(0.74, 0.9, nMid * 0.8 + nNear * 0.3) * 0.75);
    tDetail = 0.8;
  } else if (k == 5) {
    // bog: bleached moor grass, dark peat, peat cuttings and pools
    col = mix(vec3(0.27, 0.22, 0.14), vec3(0.2, 0.16, 0.1), nNear);
    col = mix(col, vec3(0.06, 0.045, 0.034), smoothstep(0.6, 0.8, nMid) * 0.75);
    float cut = step(0.62, fract(cv.fu / 24.0)) * step(0.55, fieldT) * step(0.3, fract(cv.fv / 70.0));
    col = mix(col, vec3(0.045, 0.034, 0.026), cut * 0.85);
    float pool = smoothstep(0.66, 0.7, vnoise(q * 0.035 + 7.0)) * (1.0 - cut);
    col = mix(col, vec3(0.012, 0.016, 0.016), pool);
    tGloss = max(tGloss, max(pool, cut * 0.5));
    tDetail = 0.7;
  } else if (k == 6 || k == 7) {
    // a wood: needles or leaf litter under the trees; from afar its canopy
    vec3 floorC = k == 6 ? mix(vec3(0.095, 0.07, 0.048), vec3(0.045, 0.06, 0.028), smoothstep(0.5, 0.8, nNear)) : mix(vec3(0.125, 0.08, 0.046), vec3(0.09, 0.07, 0.05), nNear);
    vec3 crown = k == 6 ? vec3(0.026, 0.04, 0.022) * (0.85 + 0.3 * fieldT) : vec3(0.085, 0.072, 0.062) * (0.85 + 0.3 * fieldT);
    col = mix(floorC, crown * (0.8 + 0.4 * nMid), smoothstep(1100.0, 1900.0, tDist));
  } else {
    // the landing ground: short sandy grass with the field pattern painted on it (darker strips where the
    // hedges would be), a few darker and lighter painted fields
    vec3 grass = mix(vec3(0.11, 0.11, 0.055), vec3(0.2, 0.185, 0.125), smoothstep(0.4, 0.8, nMid * 0.8 + nNear * 0.3));
    col = grass * (0.84 + 0.32 * fieldT);
    float paint = 1.0 - smoothstep(1.5, 3.5 + tDist * 0.001, cv.hedge);
    col = mix(col, vec3(0.05, 0.055, 0.03), paint * 0.85);
    // Rheine-Bentlage's runways, darker than its sandy landing area
    if (onRheine(q, 0.0)) {
      float rd = 1e9;
      for (int n = 0; n < 3; n++) {
        vec2 a = RH_RWY[n].xy, ab = RH_RWY[n].zw - a;
        float t = clamp(dot(q - a, ab) / dot(ab, ab), 0.0, 1.0);
        rd = min(rd, length(q - a - ab * t));
      }
      col = mix(col * 1.15, vec3(0.1, 0.1, 0.09), 1.0 - smoothstep(28.0, 32.0 + mpp, rd));
    }
  }
  col *= 0.9 + 0.2 * nFine;

  // field edges: a worn balk; hedgebanks: an earth bank under bare shrubs (not on the landing ground)
  if (k != 8) {
    float eb = (1.0 - smoothstep(0.5, 1.6 + tDist * 0.0006, cv.edge)) * (1.0 - smoothstep(1500.0, 5000.0, tDist));
    col = mix(col, vec3(0.13, 0.11, 0.075), eb * 0.4);
    float hw = 2.6 + tDist * 0.0012;
    float hb = (1.0 - smoothstep(hw * 0.4, hw * 1.7, cv.hedge)) * (1.0 - smoothstep(9000.0, 18000.0, tDist));
    col = mix(col, vec3(0.055, 0.045, 0.032), hb * 0.75);
  }

  // lanes: sand tracks between the regions, wheel ruts with water in them; roads with a stone surface
  {
    float road = cv.road;
    float hwid = mix(1.6, 2.9, road);
    float d = cv.lane;
    float cover = (1.0 - smoothstep(hwid, hwid + 0.6 + mpp * 0.5, d)) * (1.0 - smoothstep(2500.0, 7000.0, tDist)) * (1.0 - smoothstep(0.3, 0.7, vInfo.x));
    if (cover > 0.0) {
      vec3 sandC = vec3(0.22, 0.185, 0.135) * (0.85 + 0.3 * nNear);
      float rut = exp(-pow((d - 0.95) / 0.32, 2.0)) * (1.0 - smoothstep(0.3, 0.9, mpp)) * (1.0 - road);
      vec3 rc = mix(sandC, sandC * 0.45, rut * 0.8);
      rc = mix(rc, vec3(0.15, 0.145, 0.135) * (0.8 + 0.4 * nFine), road);
      col = mix(col, rc, cover);
      tGloss = max(tGloss, rut * wet * cover * 0.8);
    }
  }

  // farmsteads and villages (near only)
  if (tDist < 4000.0) {
    vec4 f = farmAt(q);
    if (f.w > 0.0) {
      vec2 e = q - f.xy;
      float d = length(e);
      float yard = 1.0 - smoothstep(30.0, 44.0 + 6.0 * nMid, d);
      vec3 yc = mix(vec3(0.15, 0.12, 0.09), vec3(0.075, 0.08, 0.04), smoothstep(0.4, 0.7, nNear));
      col = mix(col, yc, yard * 0.9);
      tGloss = max(tGloss, yard * smoothstep(0.7, 0.85, nNear) * 0.6);
    }
    float vil = villageAt(q);
    if (vil > 0.0) {
      vec3 vc = mix(vec3(0.12, 0.1, 0.075), vec3(0.06, 0.07, 0.035), smoothstep(0.35, 0.65, vnoise(q * 0.08)));
      col = mix(col, vc, smoothstep(0.0, 0.25, vil) * 0.8);
    }
  }

  // the Fliegerhorst: perimeter track, ladder hardstands, taxiways to the bays
  {
    vec2 r = afFrame(q);
    float tw = 7.0;
    float onA = step(AF_LG.z - tw, r.y) * step(r.y, AF_LG.w + tw), onD = step(AF_LG.x - tw, r.x) * step(r.x, AF_LG.y + tw);
    float dt = 1e9;
    if (onA > 0.0) dt = min(dt, min(abs(r.x - AF_LG.x), abs(r.x - AF_LG.y)));
    if (onD > 0.0) dt = min(dt, min(abs(r.y - AF_LG.z), abs(r.y - AF_LG.w)));
    // hardstands along the north side and the west part of the south side, a stub out of the track to each
    float hs = 1e9;
    float slot = mod(r.x + 1350.0, 90.0) - 45.0;
    if (r.x > AF_LG.x + 150.0 && r.x < AF_LG.y - 120.0) {
      float north = max(abs(slot) - 9.0, abs(r.y - (AF_LG.z - 40.0)) - 9.0);
      float stubN = max(abs(slot) - 3.5, abs(r.y - (AF_LG.z - 20.0)) - 13.0);
      hs = min(hs, min(north, stubN));
      if (r.x < AF_LG.x + 800.0) {
        float south = max(abs(slot) - 9.0, abs(r.y - (AF_LG.w + 40.0)) - 9.0);
        float stubS = max(abs(slot) - 3.5, abs(r.y - (AF_LG.w + 20.0)) - 13.0);
        hs = min(hs, min(south, stubS));
      }
    }
    float tx = 1e9;
    for (int n = 0; n < AF_NT; n++) {
      vec2 a = AF_TAXI[n].xy, b = AF_TAXI[n].zw, ab = b - a;
      float t = clamp(dot(q - a, ab) / dot(ab, ab), 0.0, 1.0);
      tx = min(tx, length(q - a - ab * t) - 6.5);
    }
    float paved = max(1.0 - smoothstep(tw - 1.0, tw + mpp, dt), max(1.0 - smoothstep(0.0, mpp + 0.5, hs), 1.0 - smoothstep(0.0, mpp + 0.5, tx)));
    paved *= 1.0 - smoothstep(6000.0, 12000.0, tDist);
    vec3 conc = vec3(0.21, 0.2, 0.185) * (0.82 + 0.3 * nNear) * (0.9 + 0.2 * nFine);
    col = mix(col, conc, paved * 0.95);
    tDetail = mix(tDetail, 0.25, paved);
  }

  // waters' edges: the brooks a wet, darker ditch with rushes, the canal banks and the river's grass and reeds
  float bank = vInfo.y;
  col = mix(col, mix(vec3(0.16, 0.13, 0.08), vec3(0.075, 0.08, 0.04), nMid), smoothstep(0.25, 0.7, bank) * 0.7);
  col = mix(col, vec3(0.05, 0.045, 0.035), smoothstep(0.85, 1.0, bank));
  tGloss = max(tGloss, smoothstep(0.9, 1.0, bank) * 0.7);

  // steep ground (cuttings, the ridges' scarps): bare sand and stone; the high ground drier
  float slope = 1.0 - tWN.y;
  col = mix(col, vec3(0.2, 0.17, 0.13) * (0.8 + 0.4 * nNear), smoothstep(0.12, 0.25, slope + (nMid - 0.5) * 0.06));

  // the gun pits and the assets' levelled ground: trodden mud and sand, wet in the ruts
  vec3 mud = mix(vec3(0.15, 0.115, 0.08), vec3(0.09, 0.07, 0.05), nNear) * (0.8 + 0.4 * nFine);
  float pm = smoothstep(0.3 + 0.35 * nNear, 1.0, vInfo.x);
  col = mix(col, mud, pm);
  tGloss = max(tGloss, pm * smoothstep(0.72, 0.85, nMid) * 0.6);
}
`;

// The grass (grass.js wraps it in the vertex shader): in wxz, pad, gh (ground height, slope); out hgt (blade
// height, m), mask (0 none), gcol (colour)
const GLSL_GRASS = /* glsl */ `
{
  Cover cv = coverAt(wxz);
  int k = cv.kind;
  float fieldT = ihash(cv.fi, cv.fj, cv.c.cs + 61);
  float patchN = fbm2(wxz * 0.035);
  float nMid = fbm2(wxz * 0.02);
  // short winter growth: none on the plough, sparse shoots in the rye, a short sward with tussocks, heather
  // knee high, the moor grass in tall pale tussocks, a little under the trees, mown short on the landing ground
  hgt = k == 0 ? 0.0 : k == 1 ? 0.1 : k == 2 ? 0.16 + 0.16 * patchN : k == 3 ? 0.12 : k == 4 ? 0.28 : k == 5 ? 0.42 + 0.25 * patchN : k == 6 ? 0.1 : k == 7 ? 0.14 : 0.12;
  hgt *= 0.8 + 0.4 * fieldT;
  mask = k == 6 || k == 7 ? smoothstep(0.45, 0.75, patchN) : k == 1 ? 0.75 : 1.0;
  mask *= smoothstep(0.0, 1.2, cv.hedge) * smoothstep(mix(1.7, 3.0, cv.road), mix(2.4, 3.6, cv.road), cv.lane);
  vec3 straw = vec3(0.21, 0.18, 0.11), green = mix(vec3(0.06, 0.075, 0.032), vec3(0.08, 0.088, 0.04), fieldT);
  gcol = k == 1 ? vec3(0.06, 0.1, 0.03)
    : k == 2 || k == 8 ? mix(green, straw, smoothstep(0.45, 0.8, nMid * 0.7 + patchN * 0.5) * 0.6)
    : k == 3 ? straw * 0.95
    : k == 4 ? mix(vec3(0.1, 0.07, 0.048), vec3(0.1, 0.065, 0.06), patchN)
    : k == 5 ? mix(vec3(0.3, 0.25, 0.16), vec3(0.24, 0.19, 0.12), patchN)
    : vec3(0.07, 0.075, 0.035);
}
`;

// ---------------------------------------------------------------- the style
export default {
  id: 'ww2',
  height,
  bankAt,
  waterBodies,
  setLayout,
  coverAt,
  // the ground and the grass: GLSL from the layout (terrain.js and grass.js put it in their materials)
  glsl(layout) {
    return { cover: glslLayout(layout) + GLSL_COVER, ground: GLSL_GROUND, grass: GLSL_GRASS };
  },
  // the trees (vegetation.js forms; caps: instances near and far, or one level)
  trees: {
    species: [
      { name: 'pine', form: 'pine', cap: [1600, 9000], near: 220 },
      { name: 'oak', form: 'oak', cap: [2400, 8000] },
      { name: 'birch', form: 'birch', cap: [1200, 4000] },
      { name: 'shrub', form: 'shrub', cap: [2400, 7000] },
      { name: 'juniper', form: 'juniper', cap: [900, 2200] },
      { name: 'heath pine', form: 'pineOpen', cap: [400, 1400] },
      { name: 'house', form: 'house', cap: [1400] },
      { name: 'barn', form: 'barn', cap: [1400] },
      { name: 'church', form: 'church', cap: [40] },
    ],
    // the far cards fade out seen steeply from above, where the woods' canopy is the ground's colour
    rowsFromAbove: true,
    rows: 'winter', // the far cards: bare trees and a pine wood's edge
    rowColors: [[0.15, 0.125, 0.105], [0.05, 0.07, 0.04]],
    plant,
  },
  // what an era switch should set (main.js applies it, see the report): the sun of mid-March at 52.3 N,
  // 14:00 solar time, and the weather; the user's own settings win once changed
  sky: { elevation: 29.7, sunBearing: 215, weather: 'Clear' },
  // the weather presets for this landscape (weather.js): a late-winter "clear" day is broken cumulus over
  // a hazy plain; the others greyer and wetter than the steppe's
  weather: {
    Clear: { cover: 0.55, rain: 0, wind: 1.3, storm: 0.1, fog: 1.15 },
    Cloudy: { cover: 0.82, rain: 0, wind: 1.7, storm: 0.45, fog: 1.7 },
    Rain: { cover: 0.95, rain: 0.6, wind: 2.2, storm: 0.75, fog: 2.4 },
    Storm: { cover: 1.0, rain: 1.0, wind: 3.2, storm: 1.0, fog: 2.9 },
  },
};
// ---------------------------------------------------------------- data (generated from the sources in the header)
// EU-DEM heights relative to the field, two base64 characters a sample (0.1 m steps from -40 m), rows north to
// south from (x0, z0): 500 m out to 30 km, 3 km out to 60 km, and 250 m over the Teutoburger Wald's tip
const DEM_FINE = { nx: 121, nz: 121, x0: -30000, z0: -30000, step: 500, s: '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' };
const DEM_FAR = { nx: 41, nz: 41, x0: -60000, z0: -60000, step: 3000, s: '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' };
const DEM_TEUTO = { nx: 81, nz: 49, x0: 2000, z0: 4000, step: 250, s: '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' };
// canals (level m relative to the field at each vertex), the Ems and the brooks (Aa): x, z in the game frame
const WATERS = [
  { name: 'Dortmund-Ems-Kanal', kind: 'canal', w: 42, pts: [[9392,33713,11.6],[9532,33435,11.6],[9736,33160,11.6],[9890,32889,11.6],[9956,32716,11.6],[10538,28532,11.6],[10861,27674,11.6],[11429,26360,11.6],[11461,26221,11.6],[11486,25978,11.6],[11356,23949,11.6],[11358,23740,11.6],[11377,23569,11.6],[11483,23132,11.6],[11654,22210,11.6],[11702,21619,11.6],[11637,21202,11.6],[9373,14243,11.6],[9298,13927,11.6],[8927,11668,11.6],[8882,11502,11.6],[8792,11306,11.6],[8715,11194,11.6],[8556,11046,11.6],[8078,10681,11.6],[7729,10530,11.6],[7119,10353,11.6],[6663,10131,11.6],[6543,10043,11.6],[6320,9828,11.6],[6237,9701,11.6],[6078,9268,11.6],[5984,9110,11.6],[5595,8702,11.6],[5145,8078,11.6],[5035,7974,11.6],[4519,7676,11.6],[4298,7522,11.6],[3361,7443,1.6],[2903,7385,1.6],[2558,7226,1.6],[2340,7167,1.6],[1880,7088,1.6],[1618,7061,1.6],[862,7056,1.6],[642,7028,1.6],[89,6857,1.6],[-202,6794,1.6],[-583,6613,1.6],[-2636,5488,1.6],[-4026,4753,-0.6],[-4179,4652,-0.6],[-4734,4119,-0.6],[-4942,3879,-0.6],[-5185,3492,-0.6],[-8846,-2626,-0.6],[-8876,-2796,-0.6],[-9098,-3195,-0.6],[-9273,-3398,-6],[-9421,-3612,-6],[-11033,-6294,-6],[-11108,-6447,-6],[-11347,-7205,-6],[-11453,-7366,-6],[-12466,-8307,-6],[-12559,-8434,-6],[-12600,-8524,-6],[-12697,-9127,-6],[-12720,-9357,-6],[-12699,-9511,-6],[-12746,-9902,-6],[-12930,-10595,-6],[-13050,-11328,-6],[-13177,-11610,-6],[-13565,-12032,-6],[-13698,-12138,-6],[-13888,-12251,-6],[-14312,-12410,-6]] },
  { name: 'Mittellandkanal', kind: 'canal', w: 38, pts: [[27895,-5193,11.6],[27670,-5116,11.6],[27542,-5048,11.6],[26661,-4531,11.6],[26498,-4466,11.6],[24784,-3932,11.6],[23239,-3752,11.6],[22868,-3681,11.6],[22559,-3557,11.6],[22329,-3424,11.6],[21204,-2608,11.6],[20998,-2500,11.6],[20711,-2388,11.6],[20530,-2346,11.6],[19757,-2271,11.6],[16785,-2061,11.6],[13662,-1585,11.6],[13175,-1488,11.6],[12187,-1334,11.6],[9955,-832,11.6],[9666,-748,11.6],[8279,-198,11.6],[7973,-55,11.6],[7525,207,11.6],[7243,421,11.6],[6986,646,11.6],[6101,1514,11.6],[5828,1905,11.6],[5733,2173,11.6],[5686,2455,11.6],[5684,2618,11.6],[5757,3332,11.6],[5757,3617,11.6],[5685,4015,11.6],[5602,4324,11.6],[5483,4618,11.6],[5366,4838,11.6],[5132,5196,11.6],[4723,5750,11.6],[4527,6137,11.6],[4434,6375,11.6],[4373,6628,11.6],[4298,7522,11.6]] },
  { name: 'Ems', kind: 'river', w: 46, pts: [[4146,22543],[4117,22375],[4143,22185],[4395,21786],[4955,21646],[5350,21635],[5584,21496],[5940,21442],[6294,21235],[6338,21097],[6302,20996],[6031,20972],[5699,21158],[5420,21074],[5267,20848],[5258,20741],[5302,20592],[5385,20491],[5637,20395],[5663,20309],[5545,20207],[5278,20191],[5113,20226],[4958,20135],[4906,19990],[5033,19713],[5002,19619],[4756,19689],[4568,19960],[4499,20011],[4433,20007],[4186,19719],[3990,19639],[3819,19475],[3615,19456],[3387,19528],[3160,19378],[3025,19477],[2880,19502],[2761,19487],[2644,19366],[2394,19431],[2340,19401],[2327,19311],[2478,19059],[2439,18970],[2295,18919],[1857,18957],[1541,19166],[1475,19116],[1369,18825],[1317,18816],[977,18959],[668,18747],[575,18451],[492,18357],[288,18400],[211,18375],[199,18182],[89,17767],[111,17719],[252,17667],[338,17581],[382,17448],[399,17182],[332,17065],[115,16907],[44,16872],[-190,16874],[-243,16834],[-303,16705],[-304,16616],[-290,16503],[-218,16373],[-29,16341],[123,16194],[132,15915],[187,15801],[352,15595],[560,15485],[605,15125],[571,14971],[455,14838],[93,14552],[-444,14283],[-913,13966],[-1376,13807],[-1754,13782],[-1936,13727],[-2131,13461],[-2356,13351],[-2491,13231],[-2527,13142],[-2485,12921],[-2417,12830],[-2186,12743],[-2138,12615],[-2172,12537],[-2285,12459],[-2561,12416],[-2712,12244],[-2715,12069],[-2498,11832],[-2360,11534],[-2353,11409],[-2400,11313],[-2566,11204],[-2659,10871],[-2947,10610],[-3253,10508],[-3761,10694],[-3856,10696],[-4318,10522],[-4508,10371],[-4548,10368],[-4627,10463],[-4731,10513],[-4946,10565],[-5130,10476],[-5351,10441],[-5389,10237],[-5298,10004],[-5285,9869],[-5454,9611],[-5540,9572],[-5736,9584],[-5801,9540],[-5802,9385],[-5707,9240],[-5695,9135],[-5829,8903],[-5891,8622],[-5919,8226],[-5992,8042],[-6079,7974],[-6248,7941],[-6402,7816],[-6947,7122],[-7281,6623],[-7375,6105],[-7356,5698],[-7380,5563],[-7493,5311],[-7635,5183],[-7555,4506],[-7616,4342],[-8026,4076],[-8277,4058],[-8513,3791],[-8608,3798],[-8942,4059],[-9047,4062],[-9099,4033],[-9086,3823],[-9117,3681],[-9425,3641],[-9855,3496],[-10223,3224],[-10320,3254],[-10451,3521],[-10538,3515],[-10839,3354],[-10853,3298],[-10765,3083],[-10569,2844],[-10566,2776],[-10641,2700],[-11155,2680],[-11177,2561],[-11113,2307],[-11300,1892],[-11258,1501],[-11311,1382],[-11356,1377],[-11574,1511],[-11732,1929],[-11788,1992],[-12097,2161],[-12505,2058],[-12600,1948],[-12665,1669],[-12918,1491],[-12925,1266],[-12764,985],[-12765,932],[-12924,708],[-13010,179],[-13155,-171],[-13008,-393],[-12966,-667],[-13021,-769],[-13183,-829],[-13309,-790],[-13480,-607],[-13606,-577],[-13675,-617],[-13690,-746],[-13443,-1284],[-13453,-1411],[-13544,-1514],[-13966,-1519],[-14048,-1561],[-14065,-1616],[-13980,-1779],[-13571,-1923],[-13454,-2008],[-13424,-2136],[-13509,-2400],[-13513,-2624],[-13236,-2860],[-12848,-3099],[-12809,-3170],[-12848,-3310],[-13152,-3837],[-13272,-3817],[-13396,-3505],[-13485,-3460],[-13705,-3441],[-13816,-3481],[-13968,-3609],[-13998,-3750],[-13919,-3922],[-13846,-3947],[-13646,-3926],[-13555,-3957],[-13273,-4336],[-13276,-4565],[-13365,-4696],[-13531,-4719],[-14009,-4444],[-14121,-4504],[-14265,-4704],[-14251,-4837],[-14187,-4921],[-14013,-5027],[-13756,-4991],[-13691,-5014],[-13603,-5100],[-13555,-5255],[-13666,-5368],[-14140,-5594],[-14376,-5800],[-14413,-5960],[-14274,-6331],[-14288,-6399],[-14509,-6652],[-14526,-6788],[-14451,-7108],[-14478,-7392],[-14425,-7472],[-14046,-7642],[-14019,-7735],[-14083,-7817],[-14182,-7845],[-14470,-7827],[-14609,-7897],[-14641,-7972],[-14548,-8185],[-14489,-8239],[-13798,-8316],[-13716,-8393],[-13701,-8508],[-13774,-8850],[-13780,-9162],[-14054,-9483],[-14042,-9963],[-14159,-10135],[-14482,-10377],[-14613,-10691],[-14594,-11096],[-14674,-11339],[-14538,-11740],[-14547,-11916],[-14661,-12032],[-15205,-11901],[-15327,-11938],[-15382,-12019],[-15305,-12171],[-15043,-12272],[-14953,-12364],[-14779,-12800]] },
  { name: 'Hopstener Aa', kind: 'brook', w: 5, pts: [[3514,-3383],[3211,-3586],[3076,-3638],[3037,-3607],[3003,-3545],[2962,-3523],[2812,-3529],[2639,-3601],[2596,-3585],[2492,-3503],[2359,-3463],[2270,-3381],[1896,-3358],[1849,-3344],[1711,-3267],[1631,-3194],[1593,-3132],[1503,-2883],[1300,-2566],[1211,-2526],[781,-2585],[501,-2536],[294,-2553],[218,-2545],[152,-2563],[62,-2628],[1,-2806],[-20,-2835],[-49,-2860],[-172,-2905],[-489,-2888],[-830,-2805],[-1245,-2554],[-1439,-2241],[-2033,-1884],[-2450,-1835],[-2916,-1458],[-3522,-1605],[-4152,-1996],[-4533,-1930]] },
  { name: 'Dreierwalder Aa', kind: 'brook', w: 5, pts: [[2799,2179],[2747,2079],[2653,1999],[2551,1963],[2466,1960],[2347,1981],[2256,2031],[2077,2035],[1871,2158],[1741,2266],[1517,2359],[1390,2359],[1179,2392],[1063,2344],[895,2400],[783,2379],[620,2372],[494,2314],[156,2275],[59,2235],[-565,2164],[-641,2140],[-721,2084],[-784,1981],[-818,1685],[-1059,1459],[-1388,1348],[-1544,1358],[-1649,1297],[-1778,1266],[-1860,1229],[-1931,1232],[-2011,1256],[-2059,1247],[-2226,1159],[-2368,943],[-2408,928],[-2622,910],[-2834,825],[-2978,715],[-3205,496],[-3279,396],[-3314,256],[-3450,-146],[-3579,-362],[-3757,-721],[-3828,-779],[-3958,-943],[-3995,-1010],[-4019,-1081],[-4066,-1375],[-4177,-1652],[-4291,-1762],[-4533,-1930]] },
  { name: 'Ibbenbürener Aa', kind: 'brook', w: 5, pts: [[14300,9754],[14153,9649],[14009,9587],[13786,9462],[13614,9398],[13305,9059],[13231,9024],[13155,9025],[13099,9008],[12955,8861],[12847,8816],[12617,8643],[12480,8569],[12357,8569],[12253,8592],[12079,8599],[11875,8651],[11633,8654],[11564,8641],[11473,8568],[11304,8515],[11069,8468],[10900,8394],[10798,8319],[10722,8239],[10507,7913],[10445,7847],[10224,7671],[10181,7649],[10069,7627],[9887,7498],[9832,7422],[9803,7288],[9767,7231],[9555,7084],[9365,6864],[9293,6801],[9139,6711],[8965,6659],[8795,6646],[8657,6669],[8284,6774],[8109,6803],[7830,6823],[7577,6785]] },
  { name: 'Große Aa', kind: 'brook', w: 5, pts: [[1199,-14258],[1032,-14127],[876,-13913],[858,-13847],[846,-13571],[797,-13456],[417,-13010],[200,-12849],[36,-12658],[-157,-12330],[-200,-12325],[-359,-12393],[-459,-12403],[-767,-12229],[-1296,-12100],[-1530,-12082],[-1733,-11925],[-1999,-11792],[-2085,-11784],[-2170,-11795],[-2237,-11767],[-2301,-11696],[-2314,-11523],[-2345,-11455],[-2371,-11419],[-2538,-11285],[-2546,-11015],[-2617,-10602],[-2835,-10457],[-2875,-10452],[-2937,-10484],[-2988,-10492],[-3071,-10453],[-3157,-10382],[-3416,-10023],[-3598,-9970],[-3844,-9814],[-4080,-9718],[-4369,-9640],[-4598,-9505],[-4638,-9502],[-4989,-9608],[-5314,-9570],[-5385,-9585],[-5558,-9805],[-5634,-9947],[-5678,-9976],[-5921,-10038],[-5985,-10030],[-6015,-10012],[-6302,-9798],[-6465,-9588],[-6543,-9560],[-6610,-9584],[-6983,-9904],[-7080,-9935],[-7130,-9928],[-7216,-9866],[-7352,-9732],[-7498,-9540],[-7541,-9509],[-7735,-9471],[-7786,-9471],[-7850,-9495],[-7956,-9607],[-8006,-9631],[-8128,-9628],[-8248,-9675],[-8399,-9603],[-8430,-9602],[-8549,-9696],[-8735,-9695],[-8906,-9628],[-8943,-9582],[-8977,-9488],[-8975,-9191],[-8999,-9130],[-9041,-9094],[-9135,-9076],[-9170,-9082],[-9265,-9139],[-9317,-9151],[-9365,-9141],[-9423,-9101],[-9502,-8980],[-9528,-8961],[-9573,-8961],[-9838,-9097],[-9912,-9102],[-9963,-9078],[-10038,-8991],[-10126,-8575],[-10196,-8490],[-10306,-8457],[-10528,-8456],[-10588,-8482],[-10727,-8591],[-10757,-8596],[-10879,-8510],[-11031,-8497],[-11145,-8428],[-11269,-8428]] },
  { name: 'Schaler Aa', kind: 'brook', w: 5, pts: [[5107,-11687],[5002,-11833],[4766,-11952],[4547,-12126],[4496,-12254],[4353,-12333],[4206,-12355],[4126,-12393],[4039,-12566],[3954,-12683],[3948,-12774],[3829,-12901],[3791,-13111],[3713,-13197],[3548,-13315],[3496,-13332],[3282,-13350],[3131,-13405],[3020,-13339],[2984,-13332],[2571,-13583],[1936,-14140],[1628,-14197],[1329,-14130],[1254,-14166],[1199,-14258]] },
  { name: 'Giegel-Aa', kind: 'brook', w: 5, pts: [[3514,-3383],[3475,-3458],[3463,-3740],[3405,-3832],[3303,-3931],[3234,-4043],[3197,-4077],[3002,-4108],[2809,-4199],[2601,-4375],[2325,-4544],[2027,-4555],[1829,-4538],[1777,-4576],[1640,-4726],[1588,-4746],[1055,-4717],[892,-4664],[556,-4370],[281,-4234],[205,-4224],[49,-4258],[-242,-4416],[-483,-4641],[-701,-4624],[-810,-4676],[-852,-4945],[-894,-4991],[-1223,-5224],[-1254,-5284],[-1305,-5494],[-1511,-5818],[-1847,-6030],[-2084,-6254],[-2165,-6387],[-2197,-6460],[-2244,-6828],[-2316,-7036],[-2281,-7306],[-2305,-7365],[-2346,-7396],[-2358,-7502],[-2374,-7533],[-2442,-7614],[-2608,-7739],[-2726,-7886],[-2766,-7915],[-2913,-7961],[-2996,-8054],[-3249,-8421],[-3560,-8922],[-3558,-8980],[-3491,-9098],[-3497,-9159],[-3643,-9310],[-3740,-9335],[-3802,-9374],[-3998,-9573],[-4035,-9585],[-4174,-9574],[-4229,-9679]] },
  { name: 'Speller Aa', kind: 'brook', w: 5, pts: [[-4533,-1930],[-4601,-1958],[-4816,-1968],[-4959,-1891],[-5056,-1737],[-5291,-1570],[-5845,-1515],[-6144,-1601],[-6375,-1629],[-6426,-1655],[-6515,-1803],[-6559,-2021],[-6678,-2206],[-6706,-2225],[-6771,-2225],[-6911,-2108],[-7054,-2052],[-7114,-2053],[-7176,-2094],[-7305,-2322],[-7317,-2533],[-7374,-2766],[-7435,-2845],[-7639,-3042],[-7685,-3108],[-7700,-3271],[-7734,-3435],[-7940,-3556],[-8009,-3713],[-8072,-4065],[-7994,-4280],[-7990,-4334],[-8006,-4380],[-8072,-4436],[-8420,-4576],[-8507,-4672],[-8511,-4743],[-8409,-4873],[-8364,-4977],[-8393,-5171],[-8478,-5240],[-9025,-5404],[-9056,-5442],[-9090,-5575],[-9137,-5686],[-9158,-5706],[-9549,-5806],[-9608,-5794],[-9727,-5727],[-9768,-5724],[-9928,-5750],[-9975,-5774],[-10005,-5813],[-10019,-5886],[-10009,-5949],[-9884,-6093],[-9831,-6231],[-9775,-6305],[-9767,-6364],[-9810,-6495],[-10100,-6940],[-10139,-7081],[-10113,-7185],[-10160,-7227],[-10217,-7225]] },
  { name: 'Hörsteler Aa', kind: 'brook', w: 5, pts: [[7577,6785],[7337,6709],[7160,6613],[7092,6544],[7018,6404],[6872,6305],[6607,6205],[6362,6157],[6039,5970],[5934,5927],[5836,5901],[5400,5840],[5086,5748],[5013,5765],[4953,5856],[4910,5869],[4864,5834],[4834,5780],[4855,5748],[4939,5714],[4941,5681],[4763,5548],[4667,5513],[4592,5507],[4394,5533],[4117,5507],[3915,5538],[3829,5501],[3787,5434],[3744,5218],[3656,4990],[3649,4908],[3520,4745],[3476,4602],[3410,4465],[3423,4394],[3572,4130],[3588,4039],[3567,3935],[3461,3777],[3439,3718],[3464,3365],[3434,3146],[3395,3039],[3141,2599],[2867,2316],[2799,2179]] },
  { name: 'Recker Aa', kind: 'brook', w: 5, pts: [[13936,-1669],[13927,-1725],[13887,-1759],[13739,-1823],[13655,-1900],[13535,-1967],[13405,-2073],[13255,-2130],[13103,-2161],[12937,-2135],[12838,-2190],[12787,-2200],[12753,-2194],[12643,-2124],[12589,-2115],[12422,-2175],[12170,-2170],[12011,-2184],[11921,-2225],[11875,-2219],[11807,-2186],[11721,-2185],[11636,-2165],[11515,-2278],[11338,-2375],[11254,-2472],[11082,-2565],[10972,-2580],[10896,-2557],[10641,-2559],[10528,-2599],[10193,-2616],[9961,-2537],[9917,-2552],[9859,-2595],[9775,-2693],[9728,-2697],[9664,-2674],[9571,-2699],[9474,-2797],[9300,-2772],[9082,-2833],[8970,-2797],[8874,-2744],[8716,-2795],[8619,-2773],[8559,-2724],[8475,-2551],[8388,-2496],[8341,-2438],[8297,-2427],[8225,-2449],[8182,-2435],[8079,-2316],[7929,-2259],[7751,-2143],[7707,-2088],[7563,-1979],[7523,-1971],[7443,-2013],[7325,-2032],[7266,-2063],[7169,-2179],[7047,-2255],[6925,-2429],[6887,-2458],[6580,-2560],[6486,-2542],[6408,-2480],[6362,-2475],[6328,-2491],[6269,-2596],[6155,-2645],[6099,-2820],[6043,-2897],[6000,-2926],[5950,-2937],[5879,-2912],[5735,-2787],[5709,-2706],[5637,-2659],[5595,-2659],[5510,-2703],[5334,-2745],[5152,-2736],[5055,-2684],[5028,-2685],[4915,-2730],[4758,-2869],[4636,-3048],[4627,-3074],[4637,-3172],[4625,-3195],[4574,-3227],[4493,-3255],[4365,-3271],[4299,-3258],[4167,-3201],[4088,-3193],[3948,-3239],[3721,-3272],[3631,-3310],[3514,-3383]] },
  { name: 'Halverder - Schaler Aa', kind: 'brook', w: 5, pts: [[8984,-8179],[9017,-8224],[9013,-8306],[8982,-8410],[8920,-8470],[8700,-8379],[8627,-8379],[8570,-8341],[8510,-8381],[8305,-8356],[8156,-8222],[8119,-8208],[7908,-8212],[7680,-8242],[7624,-8234],[7545,-8278],[7418,-8272],[7360,-8298],[7252,-8384],[7133,-8554],[7105,-8705],[7042,-8825],[6995,-8888],[6907,-8922],[6809,-9016],[6802,-9146],[6789,-9167],[6561,-9302],[6487,-9420],[6346,-9540],[6327,-9607],[6324,-9714],[6253,-9925],[6254,-10280],[6242,-10357],[6195,-10401],[6009,-10460],[5820,-10590],[5645,-10877],[5551,-10961],[5334,-11245],[5331,-11283],[5363,-11363],[5353,-11461],[5260,-11595],[5107,-11687]] },
  { name: 'Halverder Aa', kind: 'brook', w: 5, pts: [[11543,-7026],[11251,-7268],[11078,-7375],[10788,-7604],[10543,-7710],[10386,-7652],[10330,-7651],[10264,-7677],[9960,-7875],[9765,-7983],[9681,-8109],[9616,-8107],[9504,-8030],[9263,-8061],[9192,-8044],[9148,-8095],[9088,-8135],[8986,-8139],[8984,-8179]] },
  { name: 'Wiechholzer Aa', kind: 'brook', w: 5, pts: [[10938,-10025],[10825,-10012],[10587,-10060],[10417,-10179],[10317,-10197],[10174,-10330],[10143,-10430],[10120,-10444],[9786,-10534],[9633,-10602],[9486,-10693],[9350,-10714],[9243,-10700],[9194,-10678],[9086,-10672],[8975,-10623],[8905,-10547],[8852,-10536],[8758,-10583],[8333,-10649],[8083,-10644],[8027,-10663],[8005,-10725],[7986,-10739],[7863,-10782],[7778,-10838],[7572,-10894],[7476,-10959],[7407,-10971],[7206,-10953],[6963,-10994],[6392,-11279],[6236,-11309],[6154,-11289],[6060,-11312],[5983,-11307],[5959,-11294],[5919,-11229],[5837,-11257],[5648,-10986],[5605,-10942],[5578,-10939]] },
  { name: 'Weeser Aa', kind: 'brook', w: 5, pts: [[17683,-7590],[17480,-7381],[17442,-7225],[17436,-7125],[17406,-7031],[17139,-6785],[17078,-6692],[16938,-6593],[16029,-6817],[15872,-6916],[15431,-6849],[14964,-7035],[14740,-7005],[14454,-7011],[14276,-6957],[14132,-6981],[13991,-6953],[13731,-7025],[13540,-7015],[13332,-7113],[13281,-7124],[13235,-7105],[13133,-7006],[12926,-6945],[12744,-6806],[12698,-6801],[12614,-6822],[12543,-6809],[12472,-6745],[12256,-6691],[12174,-6711],[11543,-7026]] },
  { name: 'Bevergerner Aa', kind: 'brook', w: 5, pts: [[3901,10905],[3846,10865],[3755,10571],[3703,10467],[3669,10476],[3640,10455],[3626,10409],[3566,10393],[3571,10333],[3539,10283],[3586,10228],[3605,10151],[3631,10132],[3647,9966],[3576,9714],[3616,9555],[3399,9379],[3374,9303],[3280,9149],[3116,9054],[3058,8957],[3053,8907],[3107,8501],[3128,8437],[3107,8404],[2662,8281],[2597,8231],[2478,8083],[2200,7977],[2148,7925],[2093,7942],[2016,8002],[1966,7999],[1903,7963],[1806,7997],[1777,8020],[1702,8137],[1641,8275],[1602,8311],[1565,8325],[1460,8298],[1402,8304],[1342,8344],[1283,8431],[1115,8549],[1008,8544],[928,8570]] },
];
// lakes: the Heiliges Meer group (shore polygons)
const LAKES = [
  { name: 'Erdfallsee', pts: [[5520,-494],[5585,-544],[5596,-559],[5622,-566],[5643,-598],[5655,-602],[5666,-600],[5690,-585],[5708,-583],[5726,-601],[5747,-597],[5748,-604],[5762,-602],[5766,-605],[5760,-611],[5765,-618],[5791,-608],[5799,-610],[5834,-593],[5846,-569],[5839,-554],[5851,-536],[5839,-481],[5845,-478],[5840,-475],[5838,-457],[5824,-445],[5777,-448],[5754,-441],[5731,-451],[5719,-470],[5690,-448],[5653,-440],[5640,-425],[5643,-411],[5638,-422],[5623,-423],[5614,-408],[5596,-400],[5566,-410],[5547,-423],[5542,-445],[5522,-465]] },
  { name: 'Heideweiher', pts: [[5376,-77],[5367,-84],[5339,-144],[5341,-163],[5361,-204],[5387,-240],[5400,-247],[5416,-246],[5428,-240],[5434,-224],[5453,-216],[5474,-180],[5468,-153],[5462,-143],[5439,-129],[5421,-89],[5411,-82],[5396,-84]] },
  { name: 'Kleines Heiliges Meer', pts: [[6994,-1365],[6991,-1395],[6979,-1410],[6944,-1427],[6946,-1431],[6921,-1436],[6906,-1437],[6891,-1425],[6889,-1393],[6880,-1381],[6879,-1372],[6889,-1359],[6888,-1347],[6900,-1331],[6945,-1322],[6969,-1327]] },
  { name: 'Großes Heiliges Meer', pts: [[6194,-721],[6192,-730],[6180,-732],[6165,-761],[6158,-835],[6218,-916],[6230,-919],[6242,-929],[6243,-936],[6240,-950],[6234,-953],[6235,-965],[6245,-977],[6260,-1012],[6272,-1025],[6279,-1044],[6299,-1050],[6309,-1060],[6346,-1055],[6351,-1019],[6347,-1014],[6344,-984],[6359,-943],[6355,-930],[6369,-902],[6388,-887],[6417,-850],[6415,-840],[6410,-838],[6406,-819],[6414,-813],[6387,-761],[6384,-738],[6367,-716],[6356,-691],[6340,-676],[6325,-671],[6248,-666],[6244,-660],[6232,-663],[6218,-672],[6207,-684],[6204,-696],[6194,-704]] },
];
