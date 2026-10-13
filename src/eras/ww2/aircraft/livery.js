import * as THREE from 'three';
import { patchMaterial } from '../../../shaderlib.js';

// The Allied aircraft's procedural livery, adapted from MaxGFX's aircraft livery shader (threejs-maxgfx
// src/models/aircraft.js, copied and extended): one patched MeshStandardMaterial per type, painted in
// the fragment shader from model-space position, normal, the part id (aPart) and the lifting surfaces'
// span and chord fractions (aSurf). New here: the paint schemes (natural metal, olive drab over neutral
// grey, the RAF day fighter scheme, PRU blue), RAF roundels and fin flashes, the star and bar with its
// real proportions, unit colours, invasion stripes, and squadron codes and serials in block letters
// from a glyph atlas. A type has up to eight liveries (codes, serial, colours, olive drab or natural
// metal, a holdover of invasion stripes, the A-26's nose); the per-instance attribute aState picks one.
//
// aState (per instance; models/threats.js `state`, render/entities.js): x damage 0..1 (soot; 0.85 burning),
// y livery index, z stores (count + 16 * load set + 64 * drop tanks), w bomb doors 0..1 + 2 * the
// stopped engine (1-based, 0 none). The vertex shader spins the props about their own hubs (aPivot xy,
// direction z, engine index w), swings the bomb doors about their hinges, and collapses stores that
// have gone and the parts of other variants (aVar, a bit mask matched against the livery's variant).

export const GLYPHS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ-';
const CELLS = 8, SLOT_CHARS = 8;

let atlas = null;
// Block capitals and digits, white on black, one 64 px cell each (rows from the top of the canvas).
function glyphAtlas() {
  if (atlas) return atlas;
  const cell = 64, c = document.createElement('canvas');
  c.width = c.height = CELLS * cell;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  // cap height 0.716 em fills 84 % of the cell
  ctx.font = `bold ${Math.round(cell * 1.18)}px "Liberation Sans", Arial, Helvetica, sans-serif`;
  for (let i = 0; i < GLYPHS.length; i++) {
    const ch = GLYPHS[i];
    const w = ctx.measureText(ch).width;
    const sx = Math.min(1, (cell * 0.8) / w);
    ctx.save();
    ctx.translate(((i % CELLS) + 0.5) * cell, (Math.floor(i / CELLS) + 1) * cell - cell * 0.08);
    ctx.scale(sx, 1);
    ctx.fillText(ch, 0, 0);
    ctx.restore();
  }
  atlas = new THREE.CanvasTexture(c);
  atlas.colorSpace = THREE.NoColorSpace;
  atlas.minFilter = THREE.LinearMipmapLinearFilter;
  atlas.anisotropy = 4;
  return atlas;
}

// ---------------------------------------------------------------- GLSL constants

const f = (x) => Number(x).toFixed(4);
const lin = (h) => {
  const c = new THREE.Color(h); // sRGB in, linear working space out
  return [c.r, c.g, c.b];
};
export const v3 = (h) => {
  const c = Array.isArray(h) ? h : lin(h);
  return `vec3(${f(c[0])}, ${f(c[1])}, ${f(c[2])})`;
};
// a colour field: a hex, or 'liv:name' for the livery's own colour of that name
const col = (L, c) => (typeof c === 'string' && c.startsWith('liv:') ? `acLC[${L.colourSlots.indexOf(c.slice(4))}]` : v3(c));

// Region and decal snippets. Surface frames: the fuselage side reads (z, y) with u in the viewer's
// reading direction (acRd: +z seen from the left, -z from the right); wings and tailplanes read
// (|x|, -z); the fin reads like the fuselage side. s and c are aSurf's span and chord fractions.
const REGION = {
  // fuselage (and cowling) ahead of z1, its rear edge slanting by k per metre of height
  nose: (L, r) => `if (acFus && acP.z < ${f(r.z1)} + ${f(r.k ?? 0)} * acP.y && acP.z > ${f(r.z0 ?? -99)}) acPaint(${col(L, r.colour)}, ${f(r.gloss ?? 0.45)}, 1.0);`,
  // a band right round the fuselage between z0 and z1
  band: (L, r) => `if (acFus && acP.z > ${f(r.z0)} && acP.z < ${f(r.z1)}) acPaint(${col(L, r.colour)}, 0.45, 1.0);`,
  cowl: (L, r) => `if (acPt == 3.0${r.z1 !== undefined ? ` && acP.z < ${f(r.z1)}` : ''}) acPaint(${col(L, r.colour)}, 0.45, 1.0);`,
  spinner: (L, r) => `if (acPt == 6.0) acPaint(${col(L, r.colour)}, 0.4, 1.0);`,
  // anti-glare panel on top of the nose, |x| < w where the skin faces up
  antiglare: (L, r) => `if (acFus && acP.z > ${f(r.z0)} && acP.z < ${f(r.z1)} && acN.y > ${f(r.ny ?? 0.55)}${r.x !== undefined ? ` && abs(abs(acP.x) - ${f(r.x)}) < ${f(r.w)}` : ''}) acPaint(${col(L, r.colour)}, 0.85, 1.0);`,
  // the rudder: the fin aft of chord fraction c0, span s0..s1
  rudder: (L, r) => `if (acFinS && acSf.y > ${f(r.c0)} && acSf.x > ${f(r.s0 ?? -1)} && acSf.x < ${f(r.s1 ?? 2)}) acPaint(${col(L, r.colour)}, 0.45, 1.0);`,
  // a band across the fin (and rudder) between span fractions s0 and s1; only ahead of c1 if given
  finBand: (L, r) => `if (acFinS && acSf.x > ${f(r.s0)} && acSf.x < ${f(r.s1)}${r.c1 !== undefined ? ` && acSf.y < ${f(r.c1)}` : ''}${r.c0 !== undefined ? ` && acSf.y > ${f(r.c0)}` : ''}) acPaint(${col(L, r.colour)}, 0.45, 1.0);`,
  // the whole fin above height y0 (model space), ahead of chord fraction c1
  fin: (L, r) => `if (acPt == 2.0 && acFinSurf && acP.y > ${f(r.y0 ?? -99)} && acSf.y < ${f(r.c1 ?? 2)}) acPaint(${col(L, r.colour)}, 0.45, 1.0);`,
  // tailplane (both faces) outboard of span fraction s0
  tailTip: (L, r) => `if (acPt == 2.0 && !acFinSurf && acSf.x > ${f(r.s0)}) acPaint(${col(L, r.colour)}, 0.45, 1.0);`,
  wingTip: (L, r) => `if (acPt == 1.0 && acSf.x > ${f(r.s0)}${r.top ? ' && acN.y > 0.0' : ''}) acPaint(${col(L, r.colour)}, 0.45, 1.0);`,
  // a strip along the leading edge (chord fraction < c1) between span fractions s0 and s1, of the
  // wing (part 1) or the tail surfaces (part 2)
  le: (L, r) => `if (acLift && acPt == ${f(r.part ?? 1)} && acSf.x > ${f(r.s0 ?? -1)} && acSf.x < ${f(r.s1 ?? 2)} && acSf.y < ${f(r.c1)}) acPaint(${col(L, r.colour)}, ${f(r.gloss ?? 0.45)}, 1.0);`,
  // invasion stripes round the lower rear fuselage (five bands from z0 aft, w each), on liveries with
  // flag bit 2
  stripes: (L, r) => `if (acFus && (acFlags & 2) != 0 && acP.z > ${f(r.z0)} && acP.z < ${f(r.z0 + 5 * r.w)} && acP.y < ${f(r.y1 ?? 99)}) acPaint(mod(floor((acP.z - ${f(r.z0)}) / ${f(r.w)}), 2.0) < 0.5 ? ${v3('#e8e8e3')} : ${v3('#1c1c1c')}, 0.8, 1.0);`,
  // glazing or painted-out panels on the fuselage side: dark glass rectangles [z0, z1, y0, y1]
  windows: (L, r) => r.rects.map((q) => `if (acSide && acP.z > ${f(q[0])} && acP.z < ${f(q[1])} && acP.y > ${f(q[2])} && acP.y < ${f(q[3])}${q[4] ? ` && acP.x * ${f(q[4])} > 0.0` : ''}) acGlassAt = 1.0;`).join('\n  '),
  // RAF fin flash, red at the leading edge: z0..z1 (z0 forward), y0..y1, stripes 11:2:11
  flash: (L, r) => {
    const w = r.z1 - r.z0, a = r.z0 + (w * 11) / 24, b = r.z0 + (w * 13) / 24;
    return `if (acFinS && acP.y > ${f(r.y0)} && acP.y < ${f(r.y1)} && acP.z > ${f(r.z0)} && acP.z < ${f(r.z1)}) acPaint(acP.z < ${f(a)} ? ${v3('#7a2e2a')} : acP.z < ${f(b)} ? ${v3('#ecebe6')} : ${v3('#2b3550')}, 0.5, 1.0);`;
  },
  // free GLSL for anything else
  glsl: (L, r) => r.code,
};

const DECAL = {
  // US star and bar, radius r (the disc)
  star: (L, d) => `vec2 ins = acInsignia(q, ${f(d.r)}); acPaint(${v3('#1f2a48')}, 0.5, ins.x); acPaint(${v3('#ecebe6')}, 0.5, ins.y);`,
  // RAF roundel of type C1 (red, white, blue, yellow 3:4:8:9), C (3:4:8) or B (red, blue 2:5); r the outer radius
  roundel: (L, d) => {
    const R = d.r, t = d.type || 'C1';
    const rings = t === 'B' ? [[R, '#2b3550'], [R * 0.4, '#7a2e2a']]
      : t === 'C' ? [[R, '#2b3550'], [R * 0.5, '#ecebe6'], [R * 0.375, '#7a2e2a']]
      : [[R, '#d8a830'], [(R * 8) / 9, '#2b3550'], [(R * 4) / 9, '#ecebe6'], [(R * 3) / 9, '#7a2e2a']];
    return `float rq = length(q); ${rings.map(([rr, c]) => `acPaint(${v3(c)}, 0.5, acDiscAA(rq, ${f(rr)}));`).join(' ')}`;
  },
  // text from livery slot `slot`, letter height h
  text: (L, d) => `float tx = acText(q, ${f(d.h)}, acLv * ${L.slots.length} + ${L.slots.indexOf(d.slot)}); acPaint(${col(L, d.colour)}, 0.6, tx);`,
  // an upward triangle of side `size` with a letter from livery slot `slot` in it (the 8th AF heavy
  // groups' marking): fill colour and letter colour
  tri: (L, d) => `float s = ${f(d.size)}; vec2 t = vec2(abs(q.x), q.y + s * 0.2887); float tri = step(0.0, t.y) * step(t.x * 1.7320508 + t.y, s * 0.8660254); acPaint(${col(L, d.colour)}, 0.5, tri); float tx = acText(q + vec2(0.0, s * 0.05), s * 0.42, acLv * ${L.slots.length} + ${L.slots.indexOf(d.slot)}); acPaint(${col(L, d.letter)}, 0.5, tx * tri);`,
};

// The surface frame a decal sits in: the condition for the fragment to be on that surface and its
// decal coordinates q, centred on (a, b). Sides: 'L', 'R' or both.
function frame(d) {
  const side = d.side === 'L' ? ' && acP.x < 0.0' : d.side === 'R' ? ' && acP.x > 0.0' : '';
  const read = `vec2((acP.z - ${f(d.a)}) * acRd, acP.y - ${f(d.b)})`;
  const plan = `vec2(abs(acP.x) - ${f(d.a)}, -(acP.z - ${f(d.b)}))`;
  switch (d.surf) {
    case 'side': return { cond: `acSide${side}`, q: read };
    case 'fin': return { cond: `acFinS${side}`, q: read };
    case 'wingTop': return { cond: `acPt == 1.0 && acN.y > 0.0${side}`, q: plan };
    case 'wingBot': return { cond: `acPt == 1.0 && acN.y <= 0.0${side}`, q: plan };
    case 'tailTop': return { cond: `acPt == 2.0 && !acFinSurf && acN.y > 0.0${side}`, q: plan };
    default: throw new Error(`unknown decal surface ${d.surf}`);
  }
}

function decalCode(L, d) {
  const { cond, q } = frame(d);
  return `if (${cond}) { vec2 q = ${q}; if (max(abs(q.x), abs(q.y)) < ${f(d.reach ?? 3)}) { ${DECAL[d.kind](L, d)} } }`;
}

// ---------------------------------------------------------------- shaders

const vertexPars = /* glsl */ `
attribute float aPart;
attribute vec2 aSurf;
attribute vec4 aPivot;
attribute float aVar;
#ifdef USE_INSTANCING
attribute vec4 aState;
#endif
uniform float uTime;
`;

// prop spin, bomb doors, stores and variants: shared by the colour and the shadow programs
const stateGLSL = /* glsl */ `
#ifdef USE_INSTANCING
  vec4 acSt = aState;
#else
  vec4 acSt = AC_REST;
#endif
  float acPart = floor(aPart + 0.5);
  float acDead = floor(acSt.w * 0.5 + 0.001);
  float acDoor = (acSt.w - 2.0 * acDead);
  mat2 acRot = mat2(1.0);
  vec2 acHub = aPivot.xy;
  if (acPart == 5.0) {
    float w = abs(aPivot.w + 1.0 - acDead) < 0.5 ? 0.0 : AC_PROP_W;
    float a = (uTime * w + acSt.y * 1.7 + aPivot.w * 2.1) * aPivot.z;
    acRot = mat2(cos(a), sin(a), -sin(a), cos(a));
  } else if (acPart == 10.0) {
    float a = aPivot.z * acDoor * 1.45;
    acRot = mat2(cos(a), sin(a), -sin(a), cos(a));
  }
  float acVis = 1.0;
  int acLvV = int(acSt.y + 0.5);
  if (aVar > 0.5 && (int(aVar + 0.5) & AC_LVAR[acLvV]) == 0) acVis = 0.0;
  if (acPart == 8.0) {
    float cnt = mod(acSt.z, 16.0), set = mod(floor(acSt.z / 16.0), 4.0), tanks = floor(acSt.z / 64.0);
    if (aPivot.x > 9.5) acVis *= step(0.5, tanks);
    else acVis *= abs(aPivot.x - set) < 0.5 && aPivot.y < cnt ? 1.0 : 0.0;
  }
`;

const transformGLSL = /* glsl */ `
  if (acPart == 5.0 || acPart == 10.0) transformed.xy = acHub + acRot * (transformed.xy - acHub);
  transformed *= acVis;
`;

const fragmentPars = /* glsl */ `
uniform float uTime;
uniform sampler2D acGlyphs;
varying vec3 vAcPos;
varying vec3 vAcNrm;
varying float vAcPart;
varying vec4 vAcState;
varying vec2 vAcSurf;

float acHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float acNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(acHash(i), acHash(i + vec2(1.0, 0.0)), u.x), mix(acHash(i + vec2(0.0, 1.0)), acHash(i + vec2(1.0, 1.0)), u.x), u.y);
}
// thin lines every 'spacing' metres, faded out before they alias
float acLine(float v, float spacing, float width) {
  float d = abs(fract(v / spacing) - 0.5) * spacing;
  float aa = fwidth(v) + 1e-5;
  return (1.0 - smoothstep(width, width + aa, d)) * (1.0 - smoothstep(0.008, 0.03, aa));
}
// a line at value 'at' about one pixel wide
float acAt(float v, float at) {
  float aa = fwidth(v) + 1e-6;
  return 1.0 - smoothstep(0.6 * aa, 1.6 * aa, abs(v - at));
}
float acFrame(float v, float spacing, float width) {
  float d = abs(fract(v / spacing) - 0.5) * spacing;
  float aa = fwidth(v) + 1e-5;
  return (1.0 - smoothstep(width, width + aa, d)) * (1.0 - smoothstep(0.03, 0.09, aa));
}
float acDiscAA(float d, float r) {
  return 1.0 - smoothstep(r - fwidth(d) * 0.5, r + fwidth(d) * 0.5 + 1e-4, d);
}
vec2 acRect(vec2 p, vec2 lo, vec2 hi) {
  vec2 aa = fwidth(p) + 1e-6;
  vec2 a = (p - lo) / aa, b = (hi - p) / aa;
  float d = min(min(a.x, a.y), min(b.x, b.y));
  float inside = step(0.0, d);
  return vec2(inside * (1.0 - smoothstep(0.5, 1.5, d)), inside);
}
float acStar(vec2 p, float r, float rf) {
  const vec2 k1 = vec2(0.809016994375, -0.587785252292);
  const vec2 k2 = vec2(-k1.x, k1.y);
  p.x = abs(p.x);
  p -= 2.0 * max(dot(k1, p), 0.0) * k1;
  p -= 2.0 * max(dot(k2, p), 0.0) * k2;
  p.x = abs(p.x);
  p.y -= r;
  vec2 ba = rf * vec2(-k1.y, k1.x) - vec2(0.0, 1.0);
  float h = clamp(dot(p, ba) / dot(ba, ba), 0.0, r);
  return length(p - ba * h) * sign(p.y * ba.x - p.x * ba.y);
}
// US star and bar (from 14 August 1943): x the blue mask, y the white. Disc radius r; the white bars
// r/2 high with their top edge on the star's side points, reaching r beyond the disc, the blue
// outline r/8 wide (refs/ww2/markings 6.1).
vec2 acInsignia(vec2 p, float r) {
  float aa = fwidth(p.x) * 1.2 + 1e-4;
  float circ = 1.0 - smoothstep(r - aa * 0.5, r + aa * 0.5, length(p));
  float top = r * 0.309, bot = top - r * 0.5, o = r * 0.125;
  float ax = abs(p.x);
  float barW = smoothstep(bot - aa, bot, p.y) * (1.0 - smoothstep(top, top + aa, p.y)) * (1.0 - smoothstep(2.0 * r, 2.0 * r + aa, ax));
  float barB = smoothstep(bot - o - aa, bot - o, p.y) * (1.0 - smoothstep(top + o, top + o + aa, p.y)) * (1.0 - smoothstep(2.0 * r + o, 2.0 * r + o + aa, ax));
  float star = 1.0 - smoothstep(-aa * 0.5, aa * 0.5, acStar(p, r * 0.985, 0.382));
  return vec2(max(circ, barB), max(star * circ, barW * (1.0 - circ)));
}
// a string from the livery table, centred at q = 0, letter height h; q.x along the reading direction
float acText(vec2 q, float h, int s) {
  int n = AC_SLEN[s];
  if (n == 0) return 0.0;
  float adv = h * 0.68;
  vec2 g = vec2(q.x / adv + float(n) * 0.5, q.y / h + 0.5);
  vec2 gx = dFdx(g), gy = dFdy(g);
  if (g.x < 0.0 || g.x >= float(n) || g.y < 0.0 || g.y > 1.0) return 0.0;
  int k = int(g.x);
  int ch = AC_STR[s * ${SLOT_CHARS} + k];
  if (ch < 0) return 0.0;
  // the cell's column, its row counted from the bottom of the (flipped) atlas, the glyph's cap height
  // spanning 8 % to 92 % of the cell
  vec2 cell = vec2(float(ch % ${CELLS}), float(${CELLS - 1} - ch / ${CELLS}));
  vec2 uv = (cell + vec2(0.5 + (fract(g.x) - 0.5) * 1.0, 0.08 + g.y * 0.84)) / ${CELLS}.0;
  float a = textureGrad(acGlyphs, uv, gx * vec2(1.0, 0.84) / ${CELLS}.0, gy * vec2(1.0, 0.84) / ${CELLS}.0).r;
  return smoothstep(0.35, 0.65, a);
}
`;

const liveryHead = /* glsl */ `
  vec3 acP = vAcPos;
  vec3 acN = normalize(vAcNrm);
  float acPt = floor(vAcPart + 0.5);
  vec4 acS = vAcState;
  vec2 acSf = vAcSurf;
  int acLv = int(acS.y + 0.5);
  int acFlags = AC_LFLAG[acLv];
  vec3 acLC[AC_NCOL];
  for (int i = 0; i < AC_NCOL; i++) acLC[i] = AC_LCOL[acLv * AC_NCOL + i];
  bool acLift = acSf.y >= 0.0 && (acPt == 1.0 || acPt == 2.0);
  bool acFinSurf = acPt == 2.0 && abs(acN.x) > 0.6;
  bool acFinS = acFinSurf && acLift;
  bool acFus = acPt == 0.0 || acPt == 3.0 || acPt == 10.0;
  bool acSide = acFus && abs(acN.x) > 0.3;
  float acRd = acP.x < 0.0 ? 1.0 : -1.0;
  float acPx = length(fwidth(acP));
  float acNear = 1.0 - smoothstep(0.012, 0.045, acPx);
  float acClose = 1.0 - smoothstep(0.004, 0.012, acPx);
  float acN1 = acNoise(acP.xz * 2.3 + acP.y * 1.7);
  float acN2 = acNoise(acP.xz * 0.45 + acP.y * 0.3 + 3.1);
  float acRough = 0.6, acMetal = 0.1;
  vec3 acEmis = vec3(0.0);
  float acGlassAt = 0.0;
  bool acPaintable = acPt == 0.0 || acPt == 1.0 || acPt == 2.0 || acPt == 3.0 || acPt == 6.0 || acPt == 7.0 || acPt == 10.0;
  bool acOD = (acFlags & 1) != 0;

  // upper surfaces against the undersides
  float acUp;
  if (acFus || acPt == 7.0) {
    float dy = AC_DEMARC.x + AC_DEMARC.y * acP.z + 0.03 * sin(acP.z * 2.6);
    acUp = smoothstep(dy - AC_DEMARC.z, dy + AC_DEMARC.z, acP.y);
  } else {
    acUp = smoothstep(-0.25, 0.25, acN.y);
    if (acFinSurf) acUp = 1.0;
  }
  vec3 acCol;
  vec3 acUpper = AC_UPPER;
#ifdef AC_RAF
  // the Day Fighter Scheme: Dark Green and Ocean Grey in large disruptive patches over Medium Sea Grey
  vec2 cuv = (acPt == 1.0 || (acPt == 2.0 && !acFinSurf) || acN.y > 0.7) ? acP.xz : vec2(acP.z, acP.y);
  float camo = acNoise(cuv * AC_CAMO + 5.0) * 0.6 + acNoise(cuv * AC_CAMO * 2.4 + 1.3) * 0.3 + acNoise(cuv * AC_CAMO * 6.0) * 0.1;
  acUpper = mix(AC_UPPER, AC_UPPER2, smoothstep(0.49, 0.51, camo));
#endif
  if (acOD) acCol = mix(${v3('#747683')}, ${v3('#4a4b33')}, acUp);
  else acCol = mix(AC_LOWER, acUpper, acUp);
#ifdef AC_NMF
  if (!acOD) {
    // bare aluminium: sheet to sheet differences, polished or dull
    vec2 cellId = acLift ? vec2(floor((acFinSurf ? acP.y : acP.x) / 0.9), floor(acSf.y * 4.0)) : vec2(floor(acP.z / 0.62), floor((acP.y + acP.x * 0.3) / 0.55));
    float hv = acHash(cellId);
    acCol = AC_UPPER * (0.9 + 0.18 * hv) * (0.96 + 0.08 * acN1);
    acRough = 0.24 + 0.16 * hv + 0.1 * acN2;
    acMetal = 0.88;
  } else {
    acCol *= 0.9 + 0.2 * acN1;
    acRough = 0.72;
    acMetal = 0.05;
  }
#else
  acCol *= 0.9 + 0.2 * acN1;
  acRough = 0.68;
  acMetal = 0.06;
#endif
  vec3 acBase = acCol;
`;

// paint helper used by the generated snippets: colour c with roughness r, mixed by m (paint is
// never metallic)
const paintFn = /* glsl */ `
#define acPaint(c, r, m) { float _m = (m); acCol = mix(acCol, (c) * (0.92 + 0.12 * acN1), _m); acRough = mix(acRough, (r), _m); acMetal = mix(acMetal, 0.04, _m); }
`;

const liveryTail = /* glsl */ `
  // panel lines and rivets
  float acPanel = 0.0, acRivet = 0.0;
  if (acFus) {
    acPanel = acLine(acP.z, 0.62, 0.005);
    acPanel = max(acPanel, acLine(acP.y + 0.08, 0.55, 0.004) * 0.6);
    acRivet = acLine(acP.z + 0.31, 0.62, 0.006) * step(0.5, fract(acP.y * 22.0));
  } else if (acLift) {
    float span = acFinSurf ? acP.y : acP.x;
    acPanel = max(acLine(span, 0.7, 0.005), max(acAt(acSf.y, 0.22), acAt(acSf.y, 0.6)) * 0.8);
    acRivet = acLine(span + 0.35, 0.7, 0.006) * step(0.5, fract(acP.z * 22.0));
  }
  acCol *= 1.0 - acPanel * 0.32 * acNear;
  acCol *= 1.0 - acRivet * 0.12 * acClose;

  // control surfaces: hinge lines and trim tabs
  if (acLift) {
    vec2 ctl;
    if (acPt == 1.0) {
      ctl = max(acRect(acSf, vec2(AC_AIL.x, AC_AIL.z), vec2(AC_AIL.y, 1.01)), acRect(acSf, vec2(AC_FLAP.x, AC_FLAP.z), vec2(AC_FLAP.y, 1.01)));
    } else {
      ctl = acRect(acSf, vec2(0.04, AC_TAILHINGE), vec2(0.97, 1.01));
      ctl.x = max(ctl.x, acRect(acSf, vec2(0.12, 0.88), vec2(0.34, 1.01)).x);
    }
    acCol *= 1.0 - ctl.x * 0.45;
  }
#ifdef AC_WELL_ON
  // the main wheel doors outlined under the wing
  if (acPt == 1.0 && acN.y < -0.2) {
    vec2 wq = vec2(abs(acP.x) - AC_WELL.x, acP.z - AC_WELL.y);
    float ring = acAt(length(wq), AC_WELL.z);
    acCol *= 1.0 - ring * 0.5 * acNear;
  }
#endif
  // worn and chipped paint showing aluminium on leading edges, the wing roots and the cowl lip
  if (acPaintable && (acOD || !${'AC_IS_NMF'})) {
    float zone = 0.0;
    if (acLift) zone = (1.0 - smoothstep(0.02, 0.1, acSf.y)) * 0.6 + (acPt == 1.0 ? (1.0 - smoothstep(0.06, 0.2, acSf.x)) * acUp * 0.7 : 0.0);
    else if (acFus) zone = 0.04;
    float cn = acNoise(acP.xz * 11.0 + acP.y * 7.0) * 0.6 + acNoise(acP.zy * 29.0 + acP.x * 13.0) * 0.4;
    float chip = smoothstep(0.86 - zone * 0.3, 0.88 - zone * 0.3, cn) * step(0.01, zone);
    acCol = mix(acCol, ${v3('#9a9ea2')}, chip);
    acRough = mix(acRough, 0.35, chip);
    acMetal = mix(acMetal, 0.8, chip);
  }
  // exhaust staining streaming back from the stacks
  if ((acFus || acPt == 1.0) && acP.z > AC_EXH.x - 0.1) {
    float ez = acP.z - AC_EXH.x;
    float lat = abs(abs(acP.x) - AC_EXH.z);
    float sideK = 1.0 - smoothstep(AC_EXH.w * 0.6, AC_EXH.w * 1.4, lat);
    float band = 1.0 - smoothstep(0.08, 0.22 + ez * 0.08, abs(acP.y - (AC_EXH.y - ez * 0.04)));
    float streak = acNoise(vec2(acP.z * 1.3, acP.y * 24.0)) * 0.55 + 0.45;
    float soot = band * sideK * (1.0 - smoothstep(0.0, AC_EXH_LEN, ez)) * streak;
    acCol = mix(acCol, vec3(0.03, 0.028, 0.025), soot * 0.7);
    acRough = mix(acRough, 0.9, soot);
    acMetal = mix(acMetal, 0.1, soot);
  }

  if (acPt == 4.0 || acGlassAt > 0.5) {
    // glazing with painted frames; the cabin is dark behind it
    float fr = 0.0;
    if (acPt == 4.0) {
      fr = (1.0 - smoothstep(0.02, 0.03, abs(acP.x))) * (1.0 - acNear * 0.7) * AC_GLASS.z;
      fr = max(fr, 1.0 - smoothstep(0.018, 0.028, abs(acP.y - AC_GLASS.y)));
#ifdef AC_GLAZED
      if (acP.z < AC_GLASS.x) fr = max(fr, max(acFrame(acP.y, 0.26, 0.012), acFrame(acP.x + acP.z * 0.3, 0.3, 0.012)));
#endif
    }
    acCol = mix(vec3(0.012, 0.018, 0.026), acBase, fr);
    acRough = mix(0.04, 0.5, fr);
    acMetal = mix(0.0, acMetal, fr);
  } else if (acPt == 5.0) {
    float rr = length(acP.xy - vAcHub);
    acCol = mix(vec3(0.012), ${v3('#e0b030')}, smoothstep(AC_PR - 0.16, AC_PR - 0.15, rr));
    acRough = 0.5;
    acMetal = 0.2;
  } else if (acPt == 8.0) {
    acCol = AC_STORE * (0.85 + 0.3 * acN1);
    acRough = 0.5;
    acMetal = 0.25;
    // a nose band
    if (acP.z < AC_STOREBAND) acCol = ${v3('#c8a030')};
  } else if (acPt == 9.0) {
    acCol = vec3(0.035, 0.034, 0.033) * (0.8 + 0.4 * acN1);
    acRough = 0.55;
    acMetal = 0.5;
  } else if (acPt == 11.0) {
    acCol = vec3(0.09, 0.085, 0.08) * (0.8 + 0.4 * acN1);
    acRough = 0.42;
    acMetal = 0.8;
  } else if (acPt == 12.0) {
    // radiator matrix behind its mouth
    acCol = vec3(0.05, 0.05, 0.048) * (0.7 + 0.6 * acLine(acP.x + acP.y, 0.03, 0.006));
    acRough = 0.7;
    acMetal = 0.4;
  } else if (acPt == 13.0) {
    acCol = vec3(0.022, 0.022, 0.022);
    acRough = 0.85;
    acMetal = 0.0;
  }

  // battle damage: soot and scorch spreading over the airframe
  if (acS.x > 0.001) {
    float soot = acNoise(vec2(acP.x * 3.5 + acP.y * 2.0, acP.z * 0.4)) * 0.6 + acNoise(acP.xz * 1.6 + acP.y * 1.3) * 0.4;
    float burn = smoothstep(1.0 - acS.x, 1.2 - acS.x, soot + acS.x * 0.25);
    acCol = mix(acCol, vec3(0.01, 0.009, 0.008), burn * 0.94);
    acRough = mix(acRough, 0.95, burn);
    acMetal = mix(acMetal, 0.0, burn);
  }
  diffuseColor.rgb = acCol;
`;

/**
 * The livery material for one type. `sh` describes the airframe (from build.js: props, exhaust, the
 * wheel well) and `L` the livery: scheme ('nmf' | 'od' | 'raf' | 'pru'), base colours, the fuselage
 * demarcation, regions and decals, the per-livery table and its string slots. Returns the colour
 * material and the matching shadow-pass material.
 */
export function createLivery(type, sh, L) {
  L.slots ??= [];
  L.colourSlots ??= [];
  const livs = L.liveries;
  const nLiv = livs.length, nSlot = Math.max(1, L.slots.length), nCol = Math.max(1, L.colourSlots.length);
  // the string table: every livery's slots, SLOT_CHARS characters each (-1 pads)
  const str = [], slen = [];
  for (const lv of livs) {
    for (let s = 0; s < nSlot; s++) {
      const t = String(lv[L.slots[s]] ?? '').toUpperCase();
      slen.push(t.length);
      for (let k = 0; k < SLOT_CHARS; k++) str.push(k < t.length ? GLYPHS.indexOf(t[k]) : -1);
    }
  }
  const lcol = [];
  for (const lv of livs) for (let i = 0; i < nCol; i++) lcol.push(v3(lv[L.colourSlots[i]] ?? '#808080'));
  const flags = livs.map((lv) => (lv.od ? 1 : 0) | (lv.stripes ? 2 : 0));
  const lvar = livs.map((lv) => lv.variant ?? 1);
  const scheme = L.scheme;
  const upper = L.upper ?? { nmf: '#b9bcc0', od: '#4a4b33', raf: '#63676d', pru: '#646e83' }[scheme];
  const lower = L.lower ?? { nmf: '#b9bcc0', od: '#747683', raf: '#878b92', pru: '#646e83' }[scheme];
  const ail = L.ailerons ?? [0.58, 0.93, 0.74], flap = L.flaps ?? [0.08, 0.56, 0.78];
  const exh = sh.exh ?? { z: 99, y: 0, x: 0, w: 0, len: 1 };
  const rest = L.rest ?? [0, 0, 15, 0];
  const consts = `
${scheme === 'nmf' ? '#define AC_NMF\n#define AC_IS_NMF true' : '#define AC_IS_NMF false'}
${scheme === 'raf' ? '#define AC_RAF' : ''}
${L.glazed ? '#define AC_GLAZED' : ''}
${sh.well ? '#define AC_WELL_ON' : ''}
const int AC_NLIV = ${nLiv};
const int AC_NCOL = ${nCol};
const int AC_LFLAG[${nLiv}] = int[${nLiv}](${flags.join(', ')});
const int AC_LVAR[${nLiv}] = int[${nLiv}](${lvar.join(', ')});
const vec3 AC_LCOL[${nLiv * nCol}] = vec3[${nLiv * nCol}](${lcol.join(', ')});
const int AC_STR[${str.length}] = int[${str.length}](${str.join(', ')});
const int AC_SLEN[${slen.length}] = int[${slen.length}](${slen.join(', ')});
const vec3 AC_UPPER = ${v3(upper)};
const vec3 AC_UPPER2 = ${v3(L.upper2 ?? '#44493a')};
const vec3 AC_LOWER = ${v3(lower)};
const vec3 AC_STORE = ${v3(L.store ?? '#4a4b33')};
const float AC_STOREBAND = ${f(L.storeBand ?? -99)};
const vec3 AC_DEMARC = vec3(${f(L.demarc?.[0] ?? 0)}, ${f(L.demarc?.[1] ?? 0)}, ${f(L.demarc?.[2] ?? 0.06)});
const vec3 AC_AIL = vec3(${f(ail[0])}, ${f(ail[1])}, ${f(ail[2])});
const vec3 AC_FLAP = vec3(${f(flap[0])}, ${f(flap[1])}, ${f(flap[2])});
const float AC_TAILHINGE = ${f(L.tailHinge ?? 0.64)};
const vec4 AC_EXH = vec4(${f(exh.z)}, ${f(exh.y)}, ${f(exh.x)}, ${f(exh.w)});
const float AC_EXH_LEN = ${f(exh.len ?? 2.4)};
const vec3 AC_WELL = vec3(${f(sh.well?.[0] ?? 0)}, ${f(sh.well?.[1] ?? 0)}, ${f(sh.well?.[2] ?? 0)});
const vec3 AC_GLASS = vec3(${f(L.glassZ ?? -99)}, ${f(L.glassTop ?? 99)}, ${f(L.centreFrame ?? 1)});
const float AC_PR = ${f(sh.propR ?? 1.6)};
const float AC_CAMO = ${f(L.camoScale ?? 0.42)};
`;
  const vconsts = `
const float AC_PROP_W = ${f(sh.propW ?? 26)};
const vec4 AC_REST = vec4(${rest.map(f).join(', ')});
const int AC_LVAR[${nLiv}] = int[${nLiv}](${lvar.join(', ')});
`;
  const regions = (L.regions || []).map((r) => REGION[r.kind](L, r)).join('\n  ');
  const decals = (L.decals || []).map((d) => decalCode(L, d)).join('\n  ');
  const glyphs = glyphAtlas();

  const mat = new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0 });
  mat.name = `ww2-aircraft-${type}`;
  patchMaterial(mat, `ww2-aircraft-${type}`, (shader) => {
    shader.uniforms.acGlyphs = { value: glyphs };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
${vertexPars}
${vconsts}
varying vec3 vAcPos;
varying vec3 vAcNrm;
varying float vAcPart;
varying vec4 vAcState;
varying vec2 vAcSurf;
varying vec2 vAcHub;`)
      .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
${stateGLSL}
  if (acPart == 5.0 || acPart == 10.0) objectNormal.xy = acRot * objectNormal.xy;
  vAcNrm = objectNormal;
  vAcPart = acPart;
  vAcState = acSt;
  vAcPos = position;
  vAcSurf = aSurf;
  vAcHub = aPivot.xy;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${transformGLSL}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
${consts}
${fragmentPars}
${paintFn}
varying vec2 vAcHub;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
${liveryHead}
  if (acPaintable) {
  ${regions}
  ${decals}
  }
${liveryTail}`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n  roughnessFactor *= acRough;')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\n  metalnessFactor = acMetal;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n  totalEmissiveRadiance += acEmis;');
  });

  const depth = new THREE.MeshDepthMaterial();
  patchMaterial(depth, `ww2-aircraft-depth-${type}`, (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${vertexPars}\n${vconsts}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${stateGLSL}\n${transformGLSL}`);
  });
  return { material: mat, depthMaterial: depth };
}

let discTexture = null;

/** Faint blurred-propeller disc with the yellow tip ring (MaxGFX's), for the props' disc part. */
export function propDiscMaterial() {
  if (!discTexture) {
    const size = 256;
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(size, size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const dx = ((x + 0.5) / size) * 2 - 1, dy = ((y + 0.5) / size) * 2 - 1;
        const r = Math.hypot(dx, dy);
        const ang = Math.atan2(dy, dx);
        const i = (y * size + x) * 4;
        if (r > 1 || r < 0.1) {
          img.data[i + 3] = 0;
          continue;
        }
        const tip = r > 0.9 && r < 0.97 ? 1 : 0;
        const streak = 0.5 + 0.5 * Math.sin(ang * 4 + r * 7);
        let a = (0.07 + 0.06 * streak * (1 - r * 0.6) + 0.05 * tip) * THREE.MathUtils.smoothstep(r, 0.1, 0.25);
        a *= 1 - THREE.MathUtils.smoothstep(r, 0.96, 1.0);
        img.data[i] = tip ? 130 : 30;
        img.data[i + 1] = tip ? 105 : 28;
        img.data[i + 2] = tip ? 40 : 26;
        img.data[i + 3] = Math.round(Math.min(a, 0.18) * 255);
      }
    }
    ctx.putImageData(img, 0, 0);
    discTexture = new THREE.CanvasTexture(c);
    discTexture.colorSpace = THREE.SRGBColorSpace;
  }
  const m = new THREE.MeshBasicMaterial({ map: discTexture, transparent: true, depthWrite: false, side: THREE.DoubleSide, forceSinglePass: true });
  m.name = 'ww2-propdisc';
  return m;
}
