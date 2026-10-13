import * as THREE from 'three';

// Geometry for the Allied aircraft, adapted from MaxGFX's parametric WW2 aircraft generator
// (threejs-maxgfx src/models/aircraft.js, copied and extended): superellipse fuselage stations, wings
// and tails with a NACA-like section and washout, props and spinners, radial cowlings. New here:
// wings and fins from a planform table (any outline: ellipses, kinks, the B-17's fin), gull wings,
// per-vertex pivots for parts the shader moves (props, bomb doors, stores) and variant masks.
// Model space: forward -Z, up +Y, right (starboard) +X, origin near the CG, metres.

export const PART = {
  FUSELAGE: 0, WING: 1, TAIL: 2, COWL: 3, GLASS: 4, PROP: 5, SPINNER: 6, GEAR: 7, STORE: 8, DARK: 9,
  DOOR: 10, METAL: 11, RADIATOR: 12, RUBBER: 13,
};

export const V = (x, y, z) => new THREE.Vector3(x, y, z);
export const D2R = Math.PI / 180;
export const lerp = THREE.MathUtils.lerp;
export const clamp = THREE.MathUtils.clamp;
export const smooth01 = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

// ---------------------------------------------------------------- surfaces

// Flip winding if the surface faces inward (signed volume about its centroid).
export function orient(g) {
  const p = g.attributes.position, idx = g.index.array;
  const c = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) c.add(V(p.getX(i), p.getY(i), p.getZ(i)));
  c.divideScalar(p.count);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), d = new THREE.Vector3();
  let vol = 0;
  for (let t = 0; t < idx.length; t += 3) {
    a.fromBufferAttribute(p, idx[t]).sub(c);
    b.fromBufferAttribute(p, idx[t + 1]).sub(c);
    d.fromBufferAttribute(p, idx[t + 2]).sub(c);
    vol += a.dot(b.cross(d));
  }
  if (vol < 0) {
    for (let t = 0; t < idx.length; t += 3) {
      const s = idx[t + 1];
      idx[t + 1] = idx[t + 2];
      idx[t + 2] = s;
    }
  }
  return g;
}

// Surface through rings of points (each ring a closed loop of the same count). Points may carry .s/.c
// surface coordinates, which become the aSurf attribute.
export function tube(rings, { capStart = false, capEnd = false } = {}) {
  const n = rings[0].length;
  const pos = [], surf = [];
  for (const r of rings) {
    for (const p of r) {
      pos.push(p.x, p.y, p.z);
      surf.push(p.s ?? 0, p.c ?? -1);
    }
  }
  const idx = [];
  for (let i = 0; i < rings.length - 1; i++) {
    for (let j = 0; j < n; j++) {
      const a = i * n + j, b = i * n + ((j + 1) % n), c = (i + 1) * n + j, d = (i + 1) * n + ((j + 1) % n);
      idx.push(a, b, c, b, d, c);
    }
  }
  const cap = (ring, base, start) => {
    const c = new THREE.Vector3();
    let s = 0, cc = 0;
    ring.forEach((p) => {
      c.add(p);
      s += p.s ?? 0;
      cc += p.c ?? -1;
    });
    c.divideScalar(n);
    const ci = pos.length / 3;
    pos.push(c.x, c.y, c.z);
    surf.push(s / n, cc / n);
    for (let j = 0; j < n; j++) {
      const a = base + j, b = base + ((j + 1) % n);
      if (start) idx.push(ci, b, a);
      else idx.push(ci, a, b);
    }
  };
  if (capStart) cap(rings[0], 0, true);
  if (capEnd) cap(rings[rings.length - 1], (rings.length - 1) * n, false);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aSurf', new THREE.Float32BufferAttribute(surf, 2));
  g.setIndex(idx);
  return orient(g);
}

// Egg-shaped superellipse section in the XY plane at depth z (separate top and bottom heights).
export function section(n, z, w, hT, hB, yc = 0, e = 2, xc = 0) {
  const pts = [];
  const k = 2 / e;
  w = Math.max(w, 2e-3);
  hT = Math.max(hT, 2e-3);
  hB = Math.max(hB, 2e-3);
  for (let j = 0; j < n; j++) {
    const a = (j / n) * Math.PI * 2;
    const c = Math.cos(a), s = Math.sin(a);
    const h = s >= 0 ? hT : hB;
    pts.push(V(xc + w * Math.sign(c) * Math.pow(Math.abs(c), k), yc + h * Math.sign(s) * Math.pow(Math.abs(s), k), z));
  }
  return pts;
}

const catmull = (p0, p1, p2, p3, t) => {
  const t2 = t * t, t3 = t2 * t;
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
};

// Smoothly resample key stations (arrays of numbers) into `count` stations.
export function resample(keys, count) {
  if (count <= keys.length) return keys;
  const n = keys.length, out = [];
  for (let i = 0; i < count; i++) {
    const t = (i / (count - 1)) * (n - 1);
    const k = Math.min(Math.floor(t), n - 2), f = t - k;
    const p0 = keys[Math.max(k - 1, 0)], p1 = keys[k], p2 = keys[k + 1], p3 = keys[Math.min(k + 2, n - 1)];
    out.push(p1.map((_, j) => catmull(p0[j], p1[j], p2[j], p3[j], f)));
  }
  return out;
}

// Stations [z, halfWidth, heightTop, heightBottom, centerY, exponent]; 4-tuples [z, w, h, yc] and 5-tuples
// [z, w, hT, hB, yc] are accepted.
export const norm = (st) => st.map((s) => (s.length === 4 ? [s[0], s[1], s[2], s[2], s[3], 2] : s.length === 5 ? [...s, 2] : s));

export function loft(stations, { n = 20, count = 0, xc = 0, capStart = true, capEnd = true } = {}) {
  const st = resample(norm(stations), count);
  return tube(st.map(([z, w, hT, hB, yc, e]) => section(n, z, w, hT, hB, yc, e, xc)), { capStart, capEnd });
}

// Linear lookup of a loft's section at z (for frames, fillets and placement).
export function sectionAt(stations, z) {
  const st = norm(stations);
  if (z <= st[0][0]) return st[0];
  for (let i = 0; i < st.length - 1; i++) {
    const a = st[i], b = st[i + 1];
    if (z <= b[0]) {
      const t = (z - a[0]) / (b[0] - a[0]);
      return a.map((v, j) => lerp(v, b[j], t));
    }
  }
  return st[st.length - 1];
}

// Tube of radius r (n sides) along a polyline.
export function pathTube(points, r, n = 5, r2 = r) {
  const rings = [];
  let prevU = null;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const a = points[Math.max(i - 1, 0)], b = points[Math.min(i + 1, points.length - 1)];
    const t = b.clone().sub(a).normalize();
    let u = prevU ? prevU.clone().projectOnPlane(t) : V(0, 1, 0).projectOnPlane(t);
    if (u.lengthSq() < 1e-6) u = V(1, 0, 0).projectOnPlane(t);
    u.normalize();
    prevU = u;
    const v = new THREE.Vector3().crossVectors(t, u).normalize();
    const pts = [];
    for (let j = 0; j < n; j++) {
      const q = (j / n) * Math.PI * 2 + Math.PI / n;
      pts.push(p.clone().addScaledVector(u, r * Math.cos(q)).addScaledVector(v, r2 * Math.sin(q)));
    }
    rings.push(pts);
  }
  return tube(rings, { capStart: true, capEnd: true });
}

// Streamlined strut between two points with an elliptic section (a along the flow, b across).
export function strut(p0, p1, a, b = a, n = 8, a1 = a, b1 = b) {
  const dir = p1.clone().sub(p0).normalize();
  let u = V(0, 0, 1).projectOnPlane(dir);
  if (u.lengthSq() < 1e-6) u = V(1, 0, 0).projectOnPlane(dir);
  u.normalize();
  const v = new THREE.Vector3().crossVectors(dir, u).normalize();
  const mk = (c, ra, rb) => {
    const pts = [];
    for (let j = 0; j < n; j++) {
      const t = (j / n) * Math.PI * 2;
      pts.push(c.clone().addScaledVector(u, ra * Math.cos(t)).addScaledVector(v, rb * Math.sin(t)));
    }
    return pts;
  };
  return tube([mk(p0, a, b), mk(p1, a1, b1)], { capStart: true, capEnd: true });
}

// A gun barrel along -Z from z0 (breech side) to z1 (muzzle), radius r.
export const barrel = (x, y, z0, z1, r, n = 6) => strut(V(x, y, z0), V(x, y, z1), r, r, n);

export function box(w, h, d, x, y, z, rx = 0, ry = 0, rz = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.deleteAttribute('uv');
  g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx, ry, rz)));
  g.translate(x, y, z);
  return g;
}

export function sphere(x, y, z, r, sx = 1, sy = 1, sz = 1, w = 10, h = 7) {
  const g = new THREE.SphereGeometry(r, w, h);
  g.deleteAttribute('uv');
  g.scale(sx, sy, sz);
  g.translate(x, y, z);
  return g;
}

// Flat disc facing -Z (normals set explicitly).
export function disc(x, y, z, w, h, n = 24) {
  const pos = [], nor = [];
  for (let j = 0; j < n; j++) {
    const a0 = (j / n) * Math.PI * 2, a1 = ((j + 1) / n) * Math.PI * 2;
    pos.push(x, y, z, x + w * Math.cos(a1), y + h * Math.sin(a1), z, x + w * Math.cos(a0), y + h * Math.sin(a0), z);
    nor.push(0, 0, -1, 0, 0, -1, 0, 0, -1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  return g;
}

export function mirrorX(g) {
  const m = g.clone();
  m.applyMatrix4(new THREE.Matrix4().makeScale(-1, 1, 1));
  if (m.index) return orient(m);
  const p = m.attributes.position;
  for (let t = 0; t < p.count; t += 3) {
    for (const name of Object.keys(m.attributes)) {
      const a = m.attributes[name], k = a.itemSize;
      for (let c = 0; c < k; c++) {
        const tmp = a.array[(t + 1) * k + c];
        a.array[(t + 1) * k + c] = a.array[(t + 2) * k + c];
        a.array[(t + 2) * k + c] = tmp;
      }
    }
  }
  return m;
}

// ---------------------------------------------------------------- wings and tails

// A planform table [[x, zLE, zTE], ...] from the root (x 0 or x0) to the tip (where zLE meets zTE),
// smoothed through its points and looked up by x.
function planSampler(plan) {
  const dense = resample(plan, Math.max(160, plan.length));
  return (x) => {
    if (x <= dense[0][0]) return { le: dense[0][1], te: dense[0][2] };
    for (let i = 0; i < dense.length - 1; i++) {
      const a = dense[i], b = dense[i + 1];
      if (x <= b[0]) {
        const t = (x - a[0]) / Math.max(b[0] - a[0], 1e-6);
        return { le: lerp(a[1], b[1], t), te: lerp(a[2], b[2], t) };
      }
    }
    const l = dense[dense.length - 1];
    return { le: l[1], te: l[2] };
  };
}

// Height of the wing's reference plane at span x: flat dihedral from `dihedralFrom`, or a gull
// (`gull: [xBreak, innerAngle]`, the outer panel at `dihedral`).
function wingY(o, x) {
  const { y = 0, dihedral = 0, dihedralFrom = 0, gull } = o;
  if (gull) {
    const [xb, inner] = gull;
    return y + Math.min(x, xb) * Math.tan(inner) + Math.max(0, x - xb) * Math.tan(dihedral);
  }
  return y + Math.max(0, x - dihedralFrom) * Math.tan(dihedral);
}

// Planform at spanwise station x: chord, leading edge z and height.
export function wingAt(o, x) {
  if (o.plan) {
    o._plan ??= planSampler(o.plan);
    const { le, te } = o._plan(x);
    return { c: Math.max(te - le, 0), le, y: wingY(o, x) };
  }
  const { semispan, root, tip = root * 0.5, zLE, sweep = 0, round = 0.15, shape = 'taper' } = o;
  const s = clamp(x / semispan, 0, 1);
  let c, le;
  if (shape === 'ellipse') {
    c = root * Math.sqrt(Math.max(0, 1 - Math.pow(s, 2.4)));
    le = zLE + 0.3 * root + sweep * x - 0.3 * c;
  } else {
    const lin = lerp(root, tip, s);
    c = lin;
    if (shape !== 'square' && s > 1 - round) {
      const k = (s - (1 - round)) / round;
      c = lin * Math.sqrt(Math.max(0, 1 - k * k));
    }
    le = zLE + sweep * x + (lin - c) * 0.42;
  }
  return { c, le, y: wingY(o, x) };
}

const naca = (tc, c, xc) => 5 * tc * c * (0.2969 * Math.sqrt(xc) - 0.126 * xc - 0.3516 * xc * xc + 0.2843 * xc ** 3 - 0.1036 * xc ** 4);

// One wing half (span along +X) with a NACA 00xx-like cambered section and washout.
export function wingHalf(o) {
  const { semispan, tRoot = 0.15, tTip = 0.09, shape = 'taper', S = 20, C = 26, camber = 0.015, x0 = 0, washout = 0 } = o;
  const rings = [];
  for (let i = 0; i <= S; i++) {
    const u = i / S;
    const s = shape === 'square' ? u : Math.sin((u * Math.PI) / 2);
    const x = x0 + s * (semispan - x0);
    const { c, le, y } = wingAt(o, x);
    const sf = x / semispan;
    const tc = lerp(tRoot, tTip, sf);
    const tw = -washout * D2R * sf; // nose down toward the tip
    const ct = Math.cos(tw), st = Math.sin(tw);
    const pts = [];
    for (let j = 0; j < C; j++) {
      const th = (j / C) * Math.PI * 2;
      const xc = 0.5 * (1 + Math.cos(th)); // j = 0 trailing edge, j = C/2 leading edge
      const up = j < C / 2 ? 1 : -1;
      const ly = camber * c * 4 * xc * (1 - xc) + up * naca(tc, c, xc);
      const lz = (xc - 0.25) * c;
      const p = V(x, y + ly * ct - lz * st, le + 0.25 * c + ly * st + lz * ct);
      p.s = sf;
      p.c = xc;
      pts.push(p);
    }
    rings.push(pts);
  }
  return tube(rings, { capEnd: shape === 'square' || !!o.capTip });
}

export const wingPair = (o) => {
  const r = wingHalf(o);
  return [r, mirrorX(r)];
};

// Vertical surface: a wing half turned so its span points up from baseY.
export function finSurface(o, baseY) {
  const g = wingHalf({ ...o, y: 0, dihedral: 0, gull: null, camber: 0, washout: 0 });
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i);
    p.setXY(i, y, x + baseY);
  }
  return orient(g);
}

// Upper (up 1) or lower (up -1) surface height of a wing at span x and chord fraction xc.
export function wingSurfaceY(o, x, xc, up = 1) {
  const { c, y } = wingAt(o, x);
  const tc = lerp(o.tRoot ?? 0.15, o.tTip ?? 0.09, x / o.semispan);
  return y + (o.camber ?? 0.015) * c * 4 * xc * (1 - xc) + up * naca(tc, c, xc);
}

// ---------------------------------------------------------------- props, spinners, radial engines

// Blades about the Z axis at `center`, `count` of them, radius R. `paddle` widens the outer blade
// (the P-47's paddle blades), `hub` is where the blade root leaves the hub.
export function bladeSet(center, R, count, chord, { hub = 0.17, paddle = 0, phase = 0.3, dir = 1, segs = 10, sides = 8 } = {}) {
  const out = [];
  const zf = V(0, 0, 1);
  for (let k = 0; k < count; k++) {
    const a = (k / count) * Math.PI * 2 + phase;
    const d = V(Math.cos(a), Math.sin(a), 0), t = V(-Math.sin(a), Math.cos(a), 0).multiplyScalar(dir);
    const rings = [];
    const st = segs;
    for (let i = 0; i <= st; i++) {
      const u = i / st;
      const r = lerp(hub, R, u);
      // round shank, widest near 60 % radius, rounded tip
      const shank = 1 - smooth01(0.0, 0.25, u);
      const body = 0.78 + 0.22 * Math.sin(Math.min(u / 0.6, 1) * Math.PI * 0.5) + paddle * smooth01(0.3, 0.8, u);
      const tipK = u < 0.82 ? 1 : 0.3 + 0.7 * Math.cos(((u - 0.82) / 0.18) * Math.PI * 0.5);
      const w = lerp(chord * body * tipK, 0.09, shank);
      const th = lerp(0.045 * (1 - 0.65 * u), 0.085, shank);
      const pitch = lerp(58, 15, Math.pow(u, 0.8)) * D2R;
      const cv = t.clone().multiplyScalar(Math.cos(pitch)).addScaledVector(zf, Math.sin(pitch));
      const tv = t.clone().multiplyScalar(-Math.sin(pitch)).addScaledVector(zf, Math.cos(pitch));
      const c = center.clone().addScaledVector(d, r);
      const pts = [];
      for (let m = 0; m < sides; m++) {
        const q = (m / sides) * Math.PI * 2;
        const cq = Math.cos(q), sq = Math.sin(q);
        const thick = th * (sq > 0 ? 0.55 : 0.45) * (0.75 + 0.25 * cq);
        pts.push(c.clone().addScaledVector(cv, (w / 2) * cq).addScaledVector(tv, thick * sq));
      }
      rings.push(pts);
    }
    out.push(tube(rings, { capStart: true, capEnd: true }));
  }
  return out;
}

// Spinner from the tip (zTip) back to its base (zBase), radius r; `point` 0 is a round nose, 1 an ogive
// with a sharp tip (the P-51's).
export function spinner(x, y, zTip, zBase, r, { n = 18, point = 0.3 } = {}) {
  const st = [];
  const q = lerp(0.5, 0.85, point);
  for (let i = 0; i <= 10; i++) {
    const t = i / 10;
    const rr = r * Math.pow(1 - Math.pow(1 - t, 2.2), q) + 0.004;
    st.push([lerp(zTip, zBase, t), rr, rr, rr, y, 2]);
  }
  return loft(st, { n, xc: x, capStart: false, capEnd: true });
}

// Radial engine cowling, open at the front with an inward lip.
export function cowl({ x = 0, y = 0, zF, zB, w, h = w, wB, hB = wB, inner = 0.74, n = 32 }) {
  const rings = [
    section(n, zF + 0.16, w * inner, h * inner, h * inner, y, 2, x),
    section(n, zF + 0.02, w * (inner + 0.1), h * (inner + 0.1), h * (inner + 0.1), y, 2, x),
    section(n, zF - 0.005, w * 0.9, h * 0.9, h * 0.9, y, 2, x),
    section(n, zF + 0.04, w * 0.985, h * 0.985, h * 0.985, y, 2, x),
    section(n, zF + 0.12, w, h, h, y, 2, x),
    section(n, lerp(zF, zB, 0.45), w * 1.012, h * 1.012, h * 1.012, y, 2, x),
    section(n, lerp(zF, zB, 0.8), lerp(w, wB, 0.6) * 1.005, lerp(h, hB, 0.6) * 1.005, lerp(h, hB, 0.6) * 1.005, y, 2, x),
    section(n, zB, wB, hB, hB, y, 2, x),
  ];
  return tube(rings);
}

// Radial engine seen through the cowl mouth: cylinders (rows of `perRow`) and the gear housing.
export function engineFace(e, out, { rows = 2, perRow = 7 } = {}) {
  const h = e.h || e.w;
  const R0 = e.w * 0.26, R1 = e.w * 0.68;
  for (let row = 0; row < rows; row++) {
    for (let k = 0; k < perRow; k++) {
      const a = (k / perRow) * Math.PI * 2 + (row ? Math.PI / perRow : 0) + 0.2;
      const ca = Math.cos(a), sa = Math.sin(a) * (h / e.w);
      const z = e.zF + 0.3 + row * 0.2;
      out.push([strut(V(e.x + ca * R0, e.y + sa * R0, z), V(e.x + ca * R1, e.y + sa * R1, z), 0.075, 0.075, 5, 0.06, 0.06), PART.DARK]);
    }
  }
  out.push([loft([[e.zF + 0.1, e.w * 0.3, e.w * 0.3, e.w * 0.3, e.y, 2], [e.zF + 0.22, e.w * 0.36, e.w * 0.36, e.w * 0.36, e.y, 2], [e.zF + 0.6, e.w * 0.32, e.w * 0.32, e.w * 0.32, e.y, 2]], { n: 12, xc: e.x }), PART.DARK]);
  out.push([disc(e.x, e.y, e.zF + 0.62, e.w * 0.9, h * 0.9, 18), PART.DARK]);
}

// Cowl flaps round the back of the cowling, slightly open; `gap` leaves an arc clear (radians about
// straight down) where a duct or the wing meets the cowl.
export function cowlFlaps(e, out, { count = 16, open = 0.12, gap = 0 } = {}) {
  const h = e.hB || e.wB;
  for (let k = 0; k < count; k++) {
    const a = (k / count) * Math.PI * 2;
    if (gap && Math.abs(Math.atan2(Math.cos(a), -Math.sin(a))) < gap) continue;
    const ca = Math.cos(a), sa = Math.sin(a);
    const g = box(0.02, ((2 * Math.PI * e.wB) / count) * 0.92, 0.26, 0, 0, 0.13);
    g.applyMatrix4(new THREE.Matrix4().makeRotationZ(a).multiply(new THREE.Matrix4().makeRotationY(open)));
    g.translate(e.x + ca * e.wB * 0.995, e.y + sa * h * 0.995, e.zB - 0.02);
    out.push([g, PART.COWL, true]);
  }
}
