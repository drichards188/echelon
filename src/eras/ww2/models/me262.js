import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { V, box, rbox, yTube, zTube, xTube, rod, lathe, xf, loft, tyreGeometry, Parts, grainTextures, surfaceFinish } from '../../../models/kit.js';
import { mulberry32 } from '../../../noise.js';

// Messerschmitt Me 262 A-2a of I./KG 51 parked (refs/ww2/airfield section 3; photos airfield_me262_colour_11
// and _12, the AWM's KG 51 aircraft W.Nr. 500200 "Black X" in original paint; airfield_me262_parked_08, a
// parked A-1a from the front; the sheet's 3-view measurements), for the revetment asset (assets44.js).
// Span 12.5 m, length 10.6 m, height 3.8 m on its wheels, sitting level; wheelbase 4.0 m, main track 2.5 m;
// the engines' centrelines 4.5 m apart, the nacelles 0.6 m above the ground; the triangular-section
// fuselage with the rounded "shark" nose and its four gun ports, the red nose cap of KG 51 (and the red tip
// of the rudder, AWM), the bubble canopy over the wing, the swept wing (18.5 deg leading edge, slight
// dihedral) with its leading-edge slats lying out at rest, the two Jumo 004 nacelles slung under it with
// their big round intakes, the starter bullets in them and the nozzle plugs; the tall swept fin and the
// tailplane on it; the tricycle gear with the tall nose leg and its big flat door; the A-2a's two
// "Wikingerschiff" bomb racks under the nose (empty).
// Paint (section 3.7, estimates): the upper surfaces RLM 82 with soft patches of RLM 81, the sides and the
// fin RLM 76 with dense dark mottles, the under surfaces RLM 76. Markings: only the aircraft's letter, in
// black on the fuselage sides and on the nose wheel door (the AWM aircraft's "large black X"), and the
// Werknummer in small black numerals on the lower fin. NO national cross and NOTHING on the fin above the
// Werknummer: the contract forbids the fin marking outright, and the cross stays off.
//
// buildMe262({ letter = 'X', werknummer = '500200', seed }) -> THREE.Group, origin on the ground under the
// aircraft's centre (the wing's mean chord), nose toward -Z.

const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// the fuselage stations: [z, centre y, width, height]
const STA = [[-5.3, 1.86, 0.02, 0.02], [-5.17, 1.86, 0.44, 0.4], [-4.95, 1.85, 0.72, 0.66], [-4.45, 1.84, 0.97, 0.94], [-3.6, 1.84, 1.12, 1.14],
  [-2.6, 1.86, 1.2, 1.28], [-1.5, 1.89, 1.24, 1.36], [-0.4, 1.93, 1.22, 1.38], [0.8, 1.98, 1.1, 1.24], [2.0, 2.05, 0.9, 1.02], [3.2, 2.13, 0.66, 0.78],
  [4.2, 2.21, 0.45, 0.55], [5.0, 2.28, 0.24, 0.32], [5.3, 2.3, 0.05, 0.07]];

// a rounded triangle: wide, flattish bottom with soft chines, the sides closing toward a narrow top
function section(z, yc, w, h, n = 18) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2, c = Math.cos(t), s = Math.sin(t);
    const yy = Math.sign(s) * Math.abs(s) ** 0.8; // -1 bottom .. 1 top
    const taper = 1 - 0.5 * (yy + 1) / 2;
    const x = (w / 2) * Math.sign(c) * Math.abs(c) ** 0.7 * taper;
    pts.push(V(x, yc + (h / 2) * yy, z));
  }
  return pts;
}

// Split a geometry's triangles by their facing: tops, sides and bottoms (the camouflage's three zones).
function splitByFacing(g, up = 0.42, down = -0.4) {
  const n = g.index ? g.toNonIndexed() : g;
  if (!n.attributes.normal) n.computeVertexNormals();
  const p = n.attributes.position, out = { top: [], side: [], under: [] };
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  for (let i = 0; i < p.count; i += 3) {
    a.fromBufferAttribute(p, i); b.fromBufferAttribute(p, i + 1); c.fromBufferAttribute(p, i + 2);
    const fn = b.clone().sub(a).cross(c.clone().sub(a)).normalize();
    const k = fn.y > up ? 'top' : fn.y < down ? 'under' : 'side';
    for (const v of [a, b, c]) out[k].push(v.x, v.y, v.z);
  }
  const mk = (arr) => { if (!arr.length) return null; const gg = new THREE.BufferGeometry(); gg.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3)); gg.computeVertexNormals(); return gg; };
  return { top: mk(out.top), side: mk(out.side), under: mk(out.under) };
}

// ---------------------------------------------------------------- materials

let camo;
function camoTextures() {
  if (camo) return camo;
  const size = 512, mk = () => { const c = document.createElement('canvas'); c.width = c.height = size; return c; };
  const rnd = mulberry32(262);
  // upper surfaces: 82 with soft 81 patches; sides: 76 with dense small dark mottles (photo 08)
  const top = mk(), side = mk();
  let g = top.getContext('2d');
  g.fillStyle = '#45503a'; g.fillRect(0, 0, size, size);
  g.filter = 'blur(10px)';
  for (let i = 0; i < 14; i++) {
    g.fillStyle = 'rgba(90, 80, 56, 0.9)';
    g.beginPath();
    const x = rnd() * size, y = rnd() * size, r = 40 + rnd() * 70;
    for (let k = 0; k < 9; k++) { const a = (k / 9) * Math.PI * 2, rr = r * (0.6 + rnd() * 0.6); g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); }
    g.fill();
  }
  g.filter = 'none';
  g = side.getContext('2d');
  g.fillStyle = '#a5afaa'; g.fillRect(0, 0, size, size);
  g.filter = 'blur(4px)';
  for (let i = 0; i < 700; i++) {
    g.fillStyle = rnd() < 0.5 ? 'rgba(69, 80, 58, 0.55)' : 'rgba(90, 80, 56, 0.5)';
    g.beginPath(); g.ellipse(rnd() * size, rnd() * size, 4 + rnd() * 8, 3 + rnd() * 6, rnd() * 3, 0, Math.PI * 2); g.fill();
  }
  g.filter = 'none';
  // wear: chips to the metal along panel lines, thin dark panel lines
  for (const c of [top, side]) {
    const q = c.getContext('2d');
    q.strokeStyle = 'rgba(30, 32, 28, 0.35)'; q.lineWidth = 1;
    for (let i = 0; i < 6; i++) { q.beginPath(); q.moveTo(i * size / 6 + 20, 0); q.lineTo(i * size / 6 + 20, size); q.stroke(); }
    for (let i = 0; i < 4; i++) { q.beginPath(); q.moveTo(0, i * size / 4 + 30); q.lineTo(size, i * size / 4 + 30); q.stroke(); }
    q.fillStyle = 'rgba(150, 152, 150, 0.6)';
    for (let i = 0; i < 90; i++) q.fillRect(rnd() * size, rnd() * size, 1 + rnd() * 4, 1 + rnd() * 2);
  }
  const tex = (c) => { const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; return t; };
  camo = { top: tex(top), side: tex(side) };
  return camo;
}

let mats;
function me262Mats() {
  if (mats) return mats;
  const c = camoTextures(), grain = grainTextures();
  const std = (col, r, m, extra = {}) => {
    const mm = new THREE.MeshStandardMaterial({ color: col, roughness: r, metalness: m, vertexColors: true, roughnessMap: grain.rough, normalMap: grain.normal, ...extra });
    mm.normalScale.set(0.3, 0.3);
    return mm;
  };
  const fin = (mm, key) => surfaceFinish(mm, 'me262-' + key, { mud: 0.25, mudTop: 0.5, dust: 0.25, dustColor: 0x8d8670, mudColor: 0x4a3d2c });
  mats = {
    top: fin(std(0xffffff, 0.78, 0.05, { map: c.top }), 'top'),
    side: fin(std(0xffffff, 0.75, 0.05, { map: c.side }), 'side'),
    under: fin(std(0xa9b4b0, 0.7, 0.05), 'under'),
    red: fin(std(0x8a2a22, 0.55, 0.05), 'red'),
    glass: new THREE.MeshStandardMaterial({ color: 0x2a3a42, roughness: 0.05, metalness: 0.3, transparent: true, opacity: 0.5, envMapIntensity: 2, depthWrite: false }),
    metal: fin(std(0x8a8f92, 0.4, 0.8), 'metal'),
    black: fin(std(0x1c1d1c, 0.8, 0.1), 'black'),
    tyre: fin(std(0x1e1e1d, 0.95, 0), 'tyre'),
  };
  return mats;
}

const letterCache = new Map();
function letterMaterial(letter, werknummer) {
  const key = letter + werknummer;
  if (letterCache.has(key)) return letterCache.get(key);
  const c = document.createElement('canvas');
  c.width = 512; c.height = 256;
  const g = c.getContext('2d');
  g.clearRect(0, 0, 512, 256);
  g.fillStyle = '#141414'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = 'bold 230px sans-serif';
  g.fillText(letter, 128, 132);
  g.font = 'bold 70px sans-serif';
  g.fillText(werknummer, 384, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.MeshStandardMaterial({ map: t, transparent: true, alphaTest: 0.3, roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
  letterCache.set(key, m);
  return m;
}
const quadUV = (w, h, u0, u1) => { const q = new THREE.PlaneGeometry(w, h); const uv = q.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setX(i, u0 + uv.getX(i) * (u1 - u0)); return q; };

// ---------------------------------------------------------------- the airframe

function wingPanel(side, x0, x1, le0, te0, le1, te1, y0, t0, t1, dihedral = 0.1) {
  // a tapered panel from x0 to x1 (|x|), leading/trailing edges in z, thickness t (fraction of chord)
  const ring = (x, le, te, t) => {
    const ch = te - le, y = y0 + (x - x0) * dihedral, th = ch * t;
    const pts = [[0, 0], [0.04, 0.55], [0.15, 0.95], [0.35, 1.0], [0.6, 0.78], [0.85, 0.38], [1.0, 0.04], [0.85, -0.18], [0.6, -0.3], [0.35, -0.38], [0.15, -0.35], [0.04, -0.2]];
    return pts.map(([u, v]) => V(side * x, y + v * th * 0.5, le + u * ch));
  };
  return loft([ring(x0, le0, te0, t0), ring(x1, le1, te1, t1)], { crease: 0.9 });
}

function nacelle(x) {
  // Jumo 004 nacelle along z: intake lip, the fat body, tapering to the nozzle
  const prof = [[0.36, -2.75], [0.42, -2.62], [0.465, -2.3], [0.47, -1.8], [0.455, -0.9], [0.41, -0.1], [0.34, 0.8], [0.28, 1.4], [0.26, 1.55]];
  const g = lathe(prof, 20); // about y, then turned so the lathe's y runs along +z
  g.rotateX(Math.PI / 2);
  return g.translate(x, 1.05, 0);
}

export function buildMe262({ letter = 'X', werknummer = '500200', seed = 1 } = {}) {
  const root = new THREE.Group();
  root.name = 'me262';
  const M = me262Mats();
  const P = new Parts(M);
  const camo = (g) => {
    const s = splitByFacing(g);
    for (const k of ['top', 'side', 'under']) if (s[k]) {
      // box-projected UVs in metres (tile 4 m)
      const p = s[k].attributes.position, n = s[k].attributes.normal, uv = new Float32Array(p.count * 2);
      for (let i = 0; i < p.count; i++) {
        const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i));
        uv[i * 2] = (ay > ax ? p.getX(i) : p.getZ(i)) / 4; uv[i * 2 + 1] = (ay > ax ? p.getZ(i) : p.getY(i)) / 4;
      }
      s[k].setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      P.add(k, s[k], { uv: true });
    }
  };
  // ---- fuselage: lofted rings, the nose cap red
  const rings = STA.map(([z, y, w, h]) => section(z, y, w, h));
  const capAt = 2; // stations 0..2 are the red nose cap (to z -4.95, photos 11, 12)
  P.add('red', loft(rings.slice(0, capAt + 1), { top: false, bottom: false, crease: 0 }), { uv: true });
  camo(loft(rings.slice(capAt), { top: true, bottom: false, crease: 0 }));
  // gun ports on the nose top, the gun bay cover lines
  for (const x of [-0.16, -0.06, 0.06, 0.16]) P.add('black', zTube(-4.58, -4.5, 0.022, 0.022, 8, x, 2.2 + (Math.abs(x) < 0.1 ? 0.07 : 0)), { uv: true });
  // ---- the canopy: windscreen, the hood hinged on the right, the fairing behind
  const cz0 = -1.5, cz1 = 0.35, ctop = 2.98;
  const canopyRings = [];
  for (let i = 0; i <= 6; i++) {
    const t = i / 6, z = cz0 + (cz1 - cz0) * t;
    const hTop = 2.58 + (ctop - 2.58) * Math.sin(Math.min(1, t * 1.6) * Math.PI / 2) - (t > 0.7 ? (t - 0.7) * 0.6 : 0);
    const w = 0.34 + 0.22 * Math.sin(Math.min(1, t * 1.4) * Math.PI / 2);
    const r = [];
    for (let k = 0; k <= 8; k++) { const a = Math.PI * (k / 8); r.push(V(Math.cos(a) * w, 2.55 + Math.sin(a) * (hTop - 2.55), z)); }
    for (let k = 7; k >= 1; k--) { const a = Math.PI * (k / 8); r.push(V(Math.cos(a) * w * 0.9, 2.5, z)); }
    canopyRings.push(r);
  }
  P.add('glass', loft(canopyRings, { crease: 0 }), { uv: true });
  for (const z of [cz0 + 0.02, -0.75, cz1 - 0.05]) {
    const i = Math.round(((z - cz0) / (cz1 - cz0)) * 6), r = canopyRings[Math.max(0, Math.min(6, i))];
    for (let k = 0; k < 8; k++) P.add('black', rod(r[k].clone().setZ(z), r[k + 1].clone().setZ(z), 0.012, 4), { uv: true });
  }
  camo(loft([section(0.3, 2.62, 0.5, 0.35), section(1.6, 2.56, 0.36, 0.22), section(2.6, 2.5, 0.12, 0.06)], { crease: 0 }));
  // ---- wing: inner panels from the fuselage to the nacelles, outer panels to the tips; slats lying out
  const LE = (x) => -1.38 + (x - 0.55) * Math.tan(18.5 * Math.PI / 180), TE = (x) => 1.52 + (x - 0.55) * 0.01;
  for (const s of [-1, 1]) {
    camo(wingPanel(s, 0.45, 2.25, LE(0.45), TE(0.45), LE(2.25), TE(2.25), 1.3, 0.12, 0.11));
    camo(wingPanel(s, 2.25, 6.25, LE(2.25), TE(2.25), LE(6.25), TE(6.25), 1.3 + 1.8 * 0.1, 0.11, 0.09));
    // slats: three sections, slid forward a little
    for (const [a, b] of [[2.75, 3.8], [3.85, 4.9], [4.95, 6.0]]) {
      const y = 1.3 + (a - 0.45) * 0.1 + 0.02;
      P.add('top', rod(V(s * a, y, LE(a) - 0.06), V(s * b, y + (b - a) * 0.1, LE(b) - 0.06), 0.03, 6), { uv: true });
    }
    // the wing tip and the aileron line
    P.add('black', rod(V(s * 3.5, 1.3 + 3.05 * 0.1 + 0.05, TE(3.5) - 0.32), V(s * 6.1, 1.3 + 5.65 * 0.1 + 0.03, TE(6.1) - 0.28), 0.006, 3), { uv: true });
    // ---- the nacelle, intake, starter bullet, nozzle plug, the pylon fairing to the wing
    const nx = s * 2.25;
    camo(nacelle(nx));
    P.add('black', zTube(-2.74, -2.2, 0.34, 0.3, 18, nx, 1.05, true), { uv: true });
    P.add('metal', new THREE.TorusGeometry(0.37, 0.025, 6, 22).applyMatrix4(xf(nx, 1.05, -2.74)), { uv: true });
    P.add('metal', lathe([[0.001, 0], [0.12, 0.05], [0.17, 0.22], [0.17, 0.5], [0.1, 0.52]], 14).applyMatrix4(xf(nx, 1.05, -2.72, Math.PI / 2, 0, 0)), { uv: true });
    P.add('black', zTube(1.4, 1.56, 0.25, 0.25, 16, nx, 1.05, true), { uv: true });
    P.add('metal', lathe([[0.001, 0.0], [0.13, 0.12], [0.16, 0.28], [0.08, 0.42], [0.001, 0.45]], 14).applyMatrix4(xf(nx, 1.05, 1.15, Math.PI / 2, 0, 0)), { uv: true });
    camo(box(0.3, 0.25, 2.6, nx, 1.42, -0.3));
  }
  // ---- tail: the fin (sides mottled), the rudder with its red tip, the tailplane on the fin
  const finR = [[V(-0.07, 2.42, 3.55), V(0.07, 2.42, 3.55), V(0.07, 2.42, 5.25), V(-0.07, 2.42, 5.25)], [V(-0.03, 3.83, 4.75), V(0.03, 3.83, 4.75), V(0.03, 3.83, 5.35), V(-0.03, 3.83, 5.35)]];
  camo(loft(finR, { crease: 0.5 }));
  P.add('red', box(0.065, 0.12, 0.55, 0, 3.78, 5.08), { uv: true });
  P.add('black', rod(V(0.072, 2.45, 4.75), V(0.035, 3.7, 4.95), 0.005, 3), { uv: true }); // rudder hinge line
  for (const s of [-1, 1]) camo(wingPanel(s, 0.04, 2.5, 3.95, 5.15, 4.75, 5.35, 2.7, 0.1, 0.08, 0.0));
  // ---- the A-2a's bomb racks under the nose (empty)
  for (const x of [-0.28, 0.28]) P.add('under', loft([[V(x - 0.04, 1.27, -3.2), V(x + 0.04, 1.27, -3.2), V(x + 0.04, 1.27, -1.7), V(x - 0.04, 1.27, -1.7)], [V(x - 0.03, 1.05, -2.95), V(x + 0.03, 1.05, -2.95), V(x + 0.03, 1.05, -2.0), V(x - 0.03, 1.05, -2.0)]], { crease: 0.5 }), { uv: true });
  // ---- landing gear: the tall nose leg with its door, the main legs under the wing roots
  const nz = -3.7, mz = 0.3;
  P.add('metal', yTube(0.33, 1.25, 0.045, 0.045, 10, 0.0, nz), { uv: true });
  P.add('metal', rod(V(0.0, 0.85, nz), V(0.0, 1.25, nz + 0.45), 0.025, 6), { uv: true });
  P.add('tyre', tyreGeometry(0.325, 0.16, 14).applyMatrix4(xf(0, 0.325, nz + 0.05)), { uv: true });
  P.add('metal', xTube(-0.09, 0.09, 0.08, 0.08, 12, 0.325, nz + 0.05), { uv: true });
  P.add('side', box(0.012, 0.62, 0.48, 0.11, 0.98, nz + 0.15), { uv: true }); // the nose wheel door, on the leg's right
  for (const s of [-1, 1]) {
    const x = s * 1.25;
    P.add('metal', rod(V(x, 0.44, mz), V(s * 1.05, 1.3, mz - 0.15), 0.05, 10), { uv: true });
    P.add('tyre', tyreGeometry(0.44, 0.2, 18).applyMatrix4(xf(x + s * 0.06, 0.44, mz)), { uv: true });
    P.add('metal', xTube(x, x + s * 0.16, 0.16, 0.16, 14, 0.44, mz), { uv: true });
    P.add('under', box(0.02, 0.55, 0.85, s * 1.32, 0.95, mz - 0.1), { uv: true }); // leg door
  }
  P.build(root, { dirt: 0.15 });
  root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  // ---- markings: the letter on both fuselage sides behind the wing and on the nose wheel door, the
  // Werknummer small on the lower fin (both sides)
  const lm = letterMaterial(letter, werknummer);
  const dec = (w, h, u0, u1, x, y, z, ry, rz = 0) => {
    const m = new THREE.Mesh(quadUV(w, h, u0, u1), lm);
    m.position.set(x, y, z); m.rotation.order = 'ZYX'; m.rotation.set(0, ry, rz); m.renderOrder = 1; m.castShadow = false;
    root.add(m);
  };
  for (const s of [-1, 1]) {
    // the fuselage side at z 2.2 (half width 0.33 at mid height, the side leaning in about 12 deg)
    dec(0.46, 0.46, 0.0, 0.5, s * 0.345, 2.06, 2.2, s * Math.PI / 2, s * 0.21);
    dec(0.5, 0.12, 0.55, 0.95, s * 0.075, 2.55, 4.6, s * Math.PI / 2);
  }
  dec(0.34, 0.34, 0.0, 0.5, 0.118, 1.0, nz + 0.15, Math.PI / 2);
  return root;
}
