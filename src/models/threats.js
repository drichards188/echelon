import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { V, box, rbox, sphere, zTube, yTube, lathe, sideProfile, topProfile, Parts } from './kit.js';
import { buildMissile9M317 } from './v/buk.js';
import { buildTorMissile } from './v/tor.js';
import { build9M311 } from './v/tunguska.js';

// The attackers and the interceptors, built procedurally for instanced drawing: every model is a few
// parts, each one merged BufferGeometry with vertex colours over a shared material, so the render
// layer can draw each part of each type as one InstancedMesh. The modern era's attackers are Russian types.
// Model space: forward -Z, up +Y, real size in metres, origin near the middle of the body.
// Spinning parts (props, rotors) carry `spin` (the axis), `pivot` (the centre they turn about) and
// optionally `dir: -1` (turning the other way: a coaxial rotor); their geometry stays in model space.
// Optional fields (an era's flyers use them, render/entities.js reads them): a part's `castShadow: false`
// and `depthMaterial` (its shadow-pass material); the model's `cap` (pool size), `state(threat, array,
// offset)` (writes four floats per instance into an `aState` attribute its materials read), `motor`
// ({ burn, size }: a motor plume at `plume` while threat.age < burn) and `smoke` (engine points: a
// damaged flyer trails smoke from one of them).

export const THREAT_TYPES = ['fighter', 'decoy', 'cruise', 'drone', 'arm', 'glide', 'helo', 'tbm', 'atgm'];
export const INTERCEPTOR_KINDS = ['48N6', '9M96', '57E6', '9M33', '9M37', '9M317', '9M338', '9M311'];
// the model a kind flies on once its booster has dropped (the render layer switches at the end of the burn),
// and the booster that falls away then (its model's `offset` is where its centre sits on the round)
export const INTERCEPTOR_STAGES = { '57E6': '57E6:dart', '9M311': '9M311:dart' };
export const INTERCEPTOR_BOOSTERS = { '57E6': '57E6:booster', '9M311': '9M311:booster' };

let mats;
function materials() {
  if (mats) return mats;
  const std = (o) => new THREE.MeshStandardMaterial({ vertexColors: true, ...o });
  mats = {
    body: std({ roughness: 0.55, metalness: 0.25 }),
    glass: std({ roughness: 0.08, metalness: 0.6, envMapIntensity: 1.6 }),
    rotor: std({ roughness: 0.7, metalness: 0.1, side: THREE.DoubleSide }),
  };
  return mats;
}

// a body of revolution along Z: profile [radius, z] pairs, any order along z
function body(profile, seg = 16) {
  const pts = profile.slice().sort((a, b) => b[1] - a[1]);
  const g = lathe(pts.map(([r, z]) => [Math.max(r, 0.0005), -z]), seg);
  g.rotateX(-Math.PI / 2);
  return g;
}

// an ogive-nosed missile body: length L, radius r, nose length n, tail at +L/2
function missileBody(L, r, n, { boat = 0, seg = 16, tip = 0.08 } = {}) {
  const z0 = -L / 2, z1 = L / 2;
  const pts = [[0, z1], [r * (1 - boat), z1 - 0.001], [r, z1 - Math.max(boat > 0 ? r * 2 : 0.01, 0.01)]];
  for (let i = 0; i <= 8; i++) {
    const k = i / 8;
    pts.push([r * Math.sqrt(Math.max(0, 1 - k * k)) * (1 - tip) + r * tip * (1 - k), z0 + n * (1 - k) + 0.0001 * i]);
  }
  pts.push([0, z0 - 0.0001]);
  return body(pts, seg);
}

// four fins round the body: planform [z, y] (y outward from the axis) of thickness t, rolled by `roll`,
// the body's axis moved to `at`
function fins(P, key, pts, t, tint, roll = Math.PI / 4, n = 4, at = null) {
  const one = sideProfile(pts, t);
  for (let i = 0; i < n; i++) {
    const g = one.clone().rotateZ(roll + (i * Math.PI * 2) / n);
    P.add(key, at ? g.translate(at.x, at.y, at.z) : g, { tint });
  }
}

// a flat wing from a planform [x, z] (both sides), thickness t at height y
const wing = (pts, t, y = 0) => topProfile(pts, y - t / 2, y + t / 2);

function finish(P, extra = {}) {
  const m = materials();
  const parts = [];
  for (const key of ['body', 'glass']) {
    const g = P.merged(key);
    if (!g) continue;
    g.computeBoundingSphere();
    parts.push({ geometry: g, material: m[key] });
  }
  return { parts, ...extra };
}

// a spinning part (`dir` -1 turns it the other way)
function spinner(P, axis, pivot, dir = 1) {
  const g = P.merged('body');
  g.computeBoundingSphere();
  return { geometry: g, material: materials().rotor, spin: axis, pivot, ...(dir < 0 ? { dir } : {}) };
}

const NOZZLE = 0x2a2a2a;

// ---------------------------------------------------------------- attackers
// The modern era's raids are Russian (refs/threats-ru: dimensions and photos): Su-34 strike aircraft,
// Ka-52 attack helicopters, Kh-101 cruise missiles, old Kh-55s flown as decoys, Geran-2 drones, Kh-31P
// anti-radar missiles, FAB-500 bombs with the UMPK glide kit, Iskander-M ballistic missiles and Vikhr
// anti-tank missiles. Where the sheet has no figure the shape is an estimate.

const STAR = 0xb3261e, STAR_EDGE = 0xe4e4e0;

// a five-pointed star outline [u, v] of outer radius R about (cu, cv), its top point toward +v (dir 1) or
// -v (dir -1)
function starPts(R, cu, cv, dir = 1) {
  const pts = [];
  for (let i = 0; i < 10; i++) {
    const a = (i * Math.PI) / 5, r = i % 2 ? R * 0.382 : R;
    pts.push([cu + Math.sin(a) * r, cv + dir * Math.cos(a) * r]);
  }
  return pts;
}

// the red star with its white edge on a fin (both faces of a fin of thickness t at x, centred at z, y)
function finStar(P, x, z, y, R, t) {
  P.add('body', sideProfile(starPts(R * 1.18, z, y), t + 0.03).translate(x, 0, 0), { tint: STAR_EDGE });
  P.add('body', sideProfile(starPts(R, z, y), t + 0.04).translate(x, 0, 0), { tint: STAR });
}

// A smooth closed hull through cross-sections along z, front to back: [z, half width, top, bottom, centre
// height = 0, top width = 1, sq = 1]. Each section is an ellipse-like ring, its upper half `top` above the
// centre and its lower half `bottom` below; `top width` < 1 slopes the sides in toward the top, `sq` < 1
// squares the section off. Both ends are capped flat.
function hull(st, n = 16) {
  const pos = [], idx = [];
  for (const [z, w, top, bot, y0 = 0, tw = 1, sq = 1] of st) {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
      const x = Math.sign(c) * Math.abs(c) ** sq, y = Math.sign(s) * Math.abs(s) ** sq;
      pos.push(w * x * (s > 0 ? 1 - (1 - tw) * y : 1), y0 + y * (s > 0 ? top : bot), z);
    }
  }
  const R = st.length;
  for (let k = 0; k < R - 1; k++) {
    for (let i = 0; i < n; i++) {
      const a = k * n + i, b = k * n + ((i + 1) % n);
      idx.push(a, b, a + n, b, b + n, a + n);
    }
  }
  // the caps get their own vertices so their edges stay sharp
  const cap = (k, back) => {
    const base = pos.length / 3;
    for (let i = 0; i < n; i++) pos.push(pos[(k * n + i) * 3], pos[(k * n + i) * 3 + 1], pos[(k * n + i) * 3 + 2]);
    pos.push(0, st[k][4] ?? 0, st[k][0]);
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      if (back) idx.push(base + n, base + i, base + j);
      else idx.push(base + n, base + j, base + i);
    }
  };
  cap(0, false);
  cap(R - 1, true);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// Kh-31P (refs/threats-ru): 4.7 m long, 0.36 m across, cruciform wings (0.914 m span) and tail fins, the
// four ramjet intakes along the rear half between them with their inlet fairings, a dark radome over the
// anti-radar seeker. Centred at (x, y, z).
function kh31(P, x = 0, y = 0, z = 0) {
  const at = V(x, y, z), M = 0x8d9397, F = 0x7a8084;
  P.add('body', missileBody(4.7, 0.18, 0.95, { seg: 14, tip: 0.04 }).translate(x, y, z), { tint: M });
  P.add('body', missileBody(0.96, 0.182, 0.95, { seg: 14, tip: 0.04 }).translate(x, y, z - 1.87), { tint: 0x46494d });
  for (let i = 0; i < 4; i++) {
    const a = Math.PI / 4 + (i * Math.PI) / 2, cx = x + Math.cos(a) * 0.25, cy = y + Math.sin(a) * 0.25;
    P.add('body', zTube(z - 0.15, z + 2.2, 0.085, 0.085, 10, cx, cy), { tint: M });
    P.add('body', zTube(z - 0.45, z - 0.15, 0.012, 0.085, 10, cx, cy), { tint: F });
  }
  fins(P, 'body', [[-0.3, 0.17], [0.3, 0.17], [0.24, 0.457], [0.02, 0.457]], 0.02, F, 0, 4, at);
  fins(P, 'body', [[1.8, 0.17], [2.32, 0.17], [2.32, 0.44], [2.1, 0.44]], 0.02, F, 0, 4, at);
  P.add('body', zTube(z + 2.33, z + 2.38, 0.11, 0.11, 12, x, y), { tint: NOZZLE });
}

// FAB-500 with the UMPK glide kit (refs/threats-ru): the bomb (0.4 m across) strapped to the kit's beam,
// whose pointed fairing runs on ahead of the bomb's nose; the scissor wing under the beam (two panels of
// about 2 m, folded along it when carried, open to about 4 m once released) and a tail cone with four
// control fins in place of the bomb's own tail; 3.2 m in all. Centred at (x, y, z), the beam underneath.
function umpk(P, x = 0, y = 0, z = 0, open = true) {
  const at = V(x, y, z), S = (s) => s - 1.5 + z, BOMB = 0x66715f, KIT = 0xa7aba8, KIT_D = 0x5a5e5f;
  P.add('body', body([[0, S(0.33)], [0.04, S(0.34)], [0.04, S(0.4)], [0.1, S(0.46)], [0.16, S(0.62)], [0.19, S(0.85)], [0.2, S(1.1)], [0.2, S(2.2)], [0.175, S(2.35)], [0, S(2.351)]], 16).translate(x, y, 0), { tint: BOMB });
  for (const s of [0.95, 1.95]) P.add('body', zTube(S(s) - 0.04, S(s) + 0.04, 0.207, 0.207, 16, x, y), { tint: KIT });
  P.add('body', zTube(S(2.34), S(3.0), 0.185, 0.12, 14, x, y), { tint: KIT_D });
  fins(P, 'body', [[2.5 - 1.5, 0.15], [2.98 - 1.5, 0.12], [3.02 - 1.5, 0.42], [2.82 - 1.5, 0.42]], 0.02, KIT_D, Math.PI / 4, 4, at);
  P.add('body', sideProfile([[S(-0.15), -0.3], [S(0.5), -0.21], [S(2.5), -0.21], [S(2.6), -0.28], [S(2.5), -0.36], [S(0.5), -0.36]], 0.24).translate(x, y, 0), { tint: KIT });
  if (open) P.add('body', wing([[-2, S(1.25)], [2, S(1.25)], [2, S(1.62)], [-2, S(1.62)]], 0.035, -0.4).translate(x, y, 0), { tint: KIT });
  else {
    P.add('body', box(0.36, 0.03, 2.4, x, y - 0.38, S(1.3)), { tint: KIT });
    P.add('body', box(0.36, 0.03, 2.4, x, y - 0.415, S(1.5)), { tint: KIT });
  }
}

// Su-34 (refs/threats-ru): 23.3 m long, 14.7 m span. The flattened "platypus" nose and the side by side
// cockpit, canards ahead of the wing root extensions, the engines in nacelles under the centre body with
// the long tail cone between the nozzles, twin fins and tailplanes on booms beside the nacelles. Blue-grey,
// a dark radome, bare metal round the engines, red stars. It carries both raids' weapons: Kh-31P under the
// wings, UMPK glide bombs under the nacelles, Khibiny jamming pods on the wingtips.
function fighter() {
  const P = new Parts(materials());
  const S = (s) => s - 11.67; // s: metres back from the nose tip
  const B = 0x8ea3b1, D = 0x6a808f, RAD = 0x3d4347, BRONZE = 0x978a74;
  // radome, forward fuselage and canopy
  P.add('body', hull([[S(0), 0.02, 0.02, 0.02, -0.12, 0.9], [S(0.45), 0.25, 0.16, 0.14, -0.11, 0.9], [S(1.2), 0.47, 0.3, 0.26, -0.08, 0.9], [S(2.2), 0.64, 0.42, 0.36, -0.04, 0.9], [S(3.05), 0.74, 0.5, 0.43, -0.01, 0.9]], 18), { tint: RAD });
  P.add('body', hull([[S(3.05), 0.74, 0.5, 0.43, -0.01, 0.9], [S(4.5), 0.92, 0.62, 0.55, 0.02, 0.9], [S(6.2), 1.03, 0.74, 0.62, 0.04, 0.9], [S(8.2), 1.07, 0.92, 0.66, 0.05, 0.85], [S(10.2), 1.05, 0.97, 0.62, 0.05, 0.8]], 18), { tint: B });
  P.add('glass', sphere(1, 0, 0.7, S(6.0), 0.78, 0.5, 1.9, 18), { tint: 0x34444f });
  // centre body: the dorsal spine behind the cockpit, running back into the tail cone between the nozzles
  P.add('body', hull([[S(10.0), 1.05, 0.97, 0.62, 0.05, 0.8], [S(12.5), 1.55, 0.97, 0.45, 0.05, 0.55, 0.8], [S(15.5), 1.7, 0.86, 0.4, 0.05, 0.45, 0.8], [S(18.2), 1.2, 0.66, 0.36, 0.05, 0.55, 0.85], [S(20.4), 0.5, 0.5, 0.42, 0, 0.9], [S(22.7), 0.4, 0.38, 0.34, 0], [S(23.34), 0.08, 0.08, 0.08, 0]], 18), { tint: B });
  // engine nacelles: the intake mouths, bare metal aft, the nozzles
  for (const s of [-1, 1]) {
    const x = s * 1.3;
    P.add('body', hull([[S(9.3), 0.6, 0.52, 0.52, -0.62, 1, 0.6], [S(12), 0.66, 0.58, 0.58, -0.62, 1, 0.6], [S(15.5), 0.66, 0.58, 0.58, -0.62, 1, 0.65]], 12).translate(x, 0, 0), { tint: B });
    P.add('body', hull([[S(15.5), 0.66, 0.58, 0.58, -0.62, 1, 0.65], [S(18), 0.62, 0.56, 0.56, -0.6, 1, 0.8], [S(19.6), 0.56, 0.54, 0.54, -0.57]], 12).translate(x, 0, 0), { tint: BRONZE });
    P.add('body', box(1.1, 0.92, 0.06, x, -0.62, S(9.27)), { tint: NOZZLE });
    P.add('body', zTube(S(19.55), S(20.3), 0.54, 0.5, 16, x, -0.57), { tint: 0x46423d });
    P.add('body', zTube(S(20.28), S(20.32), 0.44, 0.44, 16, x, -0.57), { tint: NOZZLE });
  }
  // the wing with its root extensions and the canards (each one slab through the body)
  const both = (pts) => [...pts, ...pts.map(([x, z]) => [-x, z]).reverse()];
  P.add('body', wing(both([[0.95, S(6.9)], [2.4, S(9.75)], [7.3, S(14.1)], [7.3, S(16.2)], [2.1, S(15.7)]]), 0.16, -0.12), { tint: B });
  P.add('body', wing(both([[1.4, S(7.9)], [3.15, S(9.55)], [3.15, S(10.15)], [1.4, S(9.5)]]), 0.08, 0.02), { tint: B });
  // tail booms with the fins (dark tips) and the ventral fins, and the tailplanes
  for (const s of [-1, 1]) {
    const x = s * 2.15;
    P.add('body', box(0.42, 0.42, 5.8, x, -0.28, S(18.1)), { tint: B });
    P.add('body', sideProfile([[S(15.9), -0.1], [S(20.2), -0.1], [S(20.5), 3.5], [S(19.3), 3.5]], 0.12).translate(x, 0, 0), { tint: B });
    P.add('body', sideProfile([[S(19.06), 3.25], [S(20.48), 3.25], [S(20.5), 3.5], [S(19.3), 3.5]], 0.13).translate(x, 0, 0), { tint: D });
    P.add('body', sideProfile([[S(16.6), -0.45], [S(18.3), -0.45], [S(18.5), -1.2], [S(17.8), -1.2]], 0.08).translate(x, 0, 0), { tint: B });
    P.add('body', wing([[x * 0.93, S(17.3)], [s * 4.95, S(20.0)], [s * 4.95, S(20.95)], [x * 0.93, S(21.0)]], 0.08, -0.3), { tint: B });
    finStar(P, x, S(18.95), 1.55, 0.5, 0.12);
    // stars on the wings, top and bottom
    P.add('body', topProfile(starPts(0.82, s * 5.0, S(14.1), -1), -0.21, -0.03), { tint: STAR_EDGE });
    P.add('body', topProfile(starPts(0.7, s * 5.0, S(14.1), -1), -0.215, -0.025), { tint: STAR });
    // Khibiny jamming pod on the wingtip
    P.add('body', missileBody(4.2, 0.16, 0.8, { seg: 12, tip: 0.1 }).translate(s * 7.42, -0.12, S(14.3)), { tint: 0x9aa4a8 });
    // stores: a Kh-31P on the wing pylon, a glide bomb under the nacelle
    P.add('body', box(0.12, 0.3, 1.8, s * 4.3, -0.33, S(13.4)), { tint: D });
    kh31(P, s * 4.3, -0.68, S(13.4));
    P.add('body', box(0.14, 0.18, 1.6, s * 1.3, -1.23, S(13.8)), { tint: D });
    umpk(P, s * 1.3, -1.52, S(13.9), false);
  }
  return finish(P, { length: 23.3 });
}

// Kh-55 (refs/threats-ru), flown as a decoy: old missiles with ballast in place of the warhead. 6.04 m
// long, 0.514 m across, pop-out wings of 3.1 m, the tail surfaces unfolded and the turbofan lowered under
// the tail on its pylon.
function decoy() {
  const P = new Parts(materials());
  P.add('body', missileBody(6.04, 0.257, 1.1, { boat: 0.45, seg: 16, tip: 0.05 }), { tint: 0xc6c9c5 });
  P.add('body', missileBody(1.12, 0.259, 1.1, { seg: 16, tip: 0.05 }).translate(0, 0, -2.46), { tint: 0xa6aca8 });
  P.add('body', wing([[-1.55, 0.62], [-1.55, 0.88], [1.55, 0.88], [1.55, 0.62], [0.15, 0.2], [-0.15, 0.2]], 0.035, 0), { tint: 0xb7bbb7 });
  P.add('body', wing([[-0.85, 2.6], [-0.85, 2.82], [0.85, 2.82], [0.85, 2.6], [0.12, 2.3], [-0.12, 2.3]], 0.03, 0.04), { tint: 0xb7bbb7 });
  P.add('body', sideProfile([[2.2, 0.2], [2.85, 0.2], [2.95, 0.78], [2.72, 0.78]], 0.035), { tint: 0xb7bbb7 });
  P.add('body', box(0.06, 0.3, 0.55, 0, -0.33, 2.15), { tint: 0x6d716e });
  P.add('body', zTube(1.75, 2.85, 0.2, 0.17, 14, 0, -0.55), { tint: 0x5b5f5c });
  P.add('body', zTube(2.85, 2.88, 0.12, 0.12, 12, 0, -0.55), { tint: NOZZLE });
  return finish(P, { length: 6.04, plume: V(0, -0.55, 2.88) });
}

// Kh-101 (refs/threats-ru): 7.45 m long, a flattened body with flat bottom and sides sloping in toward the
// top, a wide rounded shovel nose, long thin wings on top, the turbofan lowered under the tail on its
// pylon; pale blue-grey. The tail surfaces are an estimate (no photo shows them unfolded).
function cruise() {
  const P = new Parts(materials());
  const S = (s) => s - 3.725, C = 0xa7b3bb, D = 0x939fa7;
  P.add('body', hull([
    [S(0), 0.06, 0.02, 0.02, -0.06, 1, 0.8],
    [S(0.3), 0.24, 0.09, 0.07, -0.05, 0.85, 0.7],
    [S(0.8), 0.33, 0.17, 0.13, -0.03, 0.8, 0.6],
    [S(1.6), 0.38, 0.25, 0.19, 0, 0.75, 0.55],
    [S(2.6), 0.39, 0.28, 0.21, 0, 0.72, 0.55],
    [S(5.8), 0.39, 0.28, 0.21, 0, 0.72, 0.55],
    [S(6.9), 0.32, 0.22, 0.18, 0, 0.75, 0.6],
    [S(7.45), 0.18, 0.13, 0.11, 0, 0.8, 0.7],
  ], 20), { tint: C });
  P.add('body', wing([[-1.5, S(4.95)], [-1.5, S(5.25)], [1.5, S(5.25)], [1.5, S(4.95)], [0.2, S(4.25)], [-0.2, S(4.25)]], 0.035, 0.27), { tint: D });
  P.add('body', wing([[-0.8, S(7.2)], [-0.8, S(7.42)], [0.8, S(7.42)], [0.8, S(7.2)], [0.15, S(6.75)], [-0.15, S(6.75)]], 0.03, 0), { tint: D });
  P.add('body', sideProfile([[S(6.6), 0.15], [S(7.35), 0.1], [S(7.45), 0.62], [S(7.2), 0.62]], 0.03), { tint: D });
  P.add('body', box(0.06, 0.3, 0.6, 0, -0.33, S(6.35)), { tint: 0x6d757b });
  P.add('body', zTube(S(5.95), S(7.1), 0.19, 0.16, 14, 0, -0.52), { tint: 0x5d6266 });
  P.add('body', zTube(S(7.1), S(7.13), 0.11, 0.11, 12, 0, -0.52), { tint: NOZZLE });
  return finish(P, { length: 7.45, plume: V(0, -0.52, S(7.13)) });
}

// Geran-2 (the Shahed-136 as Russia builds it, in the black finish): a cropped delta flying wing round a
// cylindrical body, 3.5 m long and 2.5 m across, fins on the wingtips, the pusher engine at the back
function drone() {
  const P = new Parts(materials());
  const C = 0x2e3032, D = 0x252729;
  P.add('body', missileBody(3.2, 0.24, 0.6, { seg: 14, tip: 0.2 }).translate(0, 0, -0.1), { tint: C });
  P.add('body', wing([[-1.25, 1.35], [-1.25, 1.05], [-0.3, -0.9], [0.3, -0.9], [1.25, 1.05], [1.25, 1.35]], 0.09, 0), { tint: C });
  for (const s of [-1, 1]) P.add('body', sideProfile([[0.95, -0.25], [1.4, -0.25], [1.45, 0.35], [1.2, 0.35]], 0.04).translate(s * 1.25, 0, 0), { tint: D });
  P.add('body', zTube(1.25, 1.5, 0.15, 0.12, 12), { tint: 0x3a3c3a }); // engine
  P.add('body', zTube(1.5, 1.6, 0.06, 0.03, 8), { tint: NOZZLE }); // spinner
  const out = finish(P, { length: 3.5 });
  // the pusher propeller (two blades) turns about the body axis
  const R = new Parts(materials());
  for (const a of [0, Math.PI]) R.add('body', box(0.07, 0.42, 0.015, 0, 0.21, 0).rotateZ(a).translate(0, 0, 1.58), { tint: 0x1e1e1d });
  out.parts.push(spinner(R, 'z', V(0, 0, 1.58)));
  return out;
}

function arm() {
  const P = new Parts(materials());
  kh31(P);
  return finish(P, { length: 4.7, plume: V(0, 0, 2.38) });
}

function glide() {
  const P = new Parts(materials());
  umpk(P);
  return finish(P, { length: 3.2 });
}

// Ka-52 (refs/threats-ru): a 13.5 m fuselage under two coaxial three-blade rotors of 14.5 m turning
// opposite ways (no tail rotor); the side by side cockpit behind a pale radome, the sight ball under the
// nose, the engines high on the fuselage sides behind their round intake covers, the 30 mm cannon on the
// right side, stub wings with rocket pods and Vikhr racks and jammer pods on the tips, a fin with a red
// star and a stabiliser with end plates. Dark grey; the belly at y 0.6.
function helo() {
  const P = new Parts(materials());
  const S = (s) => s - 5.6; // s: metres back from the nose tip; the rotor mast at s 5.6
  const C = 0x40474a, D = 0x2e3436, RAD = 0x8ba697, MAST = V(0, 0, S(5.6));
  P.add('body', hull([[S(0), 0.03, 0.03, 0.03, 1.4], [S(0.3), 0.3, 0.29, 0.29, 1.41], [S(0.8), 0.47, 0.45, 0.45, 1.43], [S(1.45), 0.55, 0.53, 0.53, 1.45]], 16), { tint: RAD });
  P.add('body', hull([[S(1.45), 0.58, 0.62, 0.66, 1.45, 0.9], [S(2.4), 0.8, 0.85, 0.82, 1.5, 0.8], [S(4.0), 0.86, 0.95, 0.88, 1.55, 0.75], [S(6.0), 0.8, 0.95, 0.92, 1.55, 0.75], [S(8.2), 0.72, 0.85, 0.88, 1.52, 0.8], [S(10.0), 0.5, 0.55, 0.45, 1.68], [S(11.6), 0.3, 0.32, 0.28, 1.8], [S(13.4), 0.2, 0.2, 0.18, 1.92]], 16), { tint: C });
  P.add('glass', sphere(1, 0, 2.1, S(2.95), 0.84, 0.62, 1.5, 18), { tint: 0x22303a });
  // the sight ball under the nose
  P.add('body', yTube(0.75, 1.0, 0.14, 0.14, 10, 0, S(1.0)), { tint: D });
  P.add('body', sphere(0.36, 0, 0.55, S(1.0), 1, 1, 1, 14), { tint: 0xa5b0a6 });
  P.add('glass', box(0.22, 0.16, 0.05, 0, 0.56, S(0.65)), { tint: 0x1c2228 });
  // engine deck and the engines with their round intake covers and exhausts
  P.add('body', rbox(1.35, 0.5, 4.2, 0.2, 0, 2.55, S(6.4)), { tint: C });
  for (const s of [-1, 1]) {
    P.add('body', zTube(S(4.7), S(8.0), 0.42, 0.38, 14, s * 0.92, 2.3), { tint: C });
    P.add('body', sphere(0.43, s * 0.92, 2.3, S(4.72), 1, 1, 0.55, 14), { tint: D });
    P.add('body', zTube(S(8.0), S(8.5), 0.3, 0.27, 12, s * 1.0, 2.35), { tint: D });
  }
  // the mast with both hubs
  P.add('body', yTube(2.75, 3.25, 0.32, 0.22, 12, 0, MAST.z), { tint: C });
  P.add('body', yTube(3.25, 5.0, 0.12, 0.11, 10, 0, MAST.z), { tint: D });
  for (const [y0, y1, r] of [[3.2, 3.45, 0.3], [4.0, 4.15, 0.22], [4.85, 5.08, 0.28]]) P.add('body', yTube(y0, y1, r, r, 12, 0, MAST.z), { tint: D });
  // 30 mm cannon on the right side
  P.add('body', box(0.35, 0.4, 2.2, 0.85, 0.95, S(5.6)), { tint: C });
  P.add('body', zTube(S(3.0), S(4.6), 0.045, 0.045, 8, 0.95, 0.95), { tint: D });
  // stub wings: jammer pods on the tips, rocket pods inboard, six-round Vikhr racks outboard
  P.add('body', wing([[-3.6, S(6.5)], [3.6, S(6.5)], [3.6, S(7.6)], [-3.6, S(7.6)]], 0.18, 1.6), { tint: C });
  for (const s of [-1, 1]) {
    P.add('body', rbox(0.32, 0.5, 1.7, 0.08, s * 3.72, 1.55, S(7.0)), { tint: D });
    for (const x of [1.55, 2.75]) P.add('body', box(0.1, 0.35, 0.9, s * x, 1.35, S(7.05)), { tint: D });
    P.add('body', zTube(S(6.0), S(8.0), 0.26, 0.26, 14, s * 1.55, 0.98), { tint: 0x6b7462 });
    P.add('body', zTube(S(5.97), S(6.0), 0.22, 0.22, 14, s * 1.55, 0.98), { tint: D });
    P.add('body', box(0.5, 0.06, 2.6, s * 2.75, 1.17, S(7.0)), { tint: D });
    for (const row of [0, 1]) for (const col of [-1, 0, 1]) P.add('body', zTube(S(5.6), S(8.4), 0.075, 0.075, 8, s * 2.75 + col * 0.16, 1.05 - row * 0.16), { tint: 0x59613f });
  }
  // tail: the stabiliser with its end plates, the fin
  P.add('body', wing([[-1.6, S(10.6)], [1.6, S(10.6)], [1.6, S(11.45)], [-1.6, S(11.45)]], 0.08, 1.75), { tint: C });
  for (const s of [-1, 1]) P.add('body', sideProfile([[S(10.6), 1.3], [S(11.45), 1.3], [S(11.55), 2.3], [S(11.0), 2.3]], 0.07).translate(s * 1.6, 0, 0), { tint: C });
  P.add('body', sideProfile([[S(12.2), 1.25], [S(13.5), 1.15], [S(13.6), 3.8], [S(13.15), 3.8]], 0.12), { tint: C });
  finStar(P, 0, S(13.21), 3.0, 0.27, 0.12);
  const out = finish(P, { length: 16.0 });
  // the two rotors, 14.5 m across: the lower one turning one way, the upper the other
  for (const [y, dir, off] of [[3.33, 1, 0], [4.97, -1, Math.PI / 3]]) {
    const M = new Parts(materials());
    for (let i = 0; i < 3; i++) M.add('body', box(6.95, 0.05, 0.45, 3.8, 0, 0).rotateY(off + (i * Math.PI * 2) / 3).translate(0, y, MAST.z), { tint: 0x2d302b });
    out.parts.push(spinner(M, 'y', V(0, y, MAST.z), dir));
  }
  return out;
}

// 9M723, the Iskander-M's missile (refs/threats-ru): 7.3 m long, 0.92 m across, a long pointed nose, small
// fins at the tail; olive green
function tbm() {
  const P = new Parts(materials());
  const S = (s) => s - 3.64, G = 0x5f6b3e, R = 0.46, Ln = 3.1, rho = (R * R + Ln * Ln) / (2 * R);
  // a tangent ogive nose, then the cylinder
  const prof = [[0, S(0)]];
  for (let i = 1; i <= 12; i++) {
    const x = (Ln * i) / 12;
    prof.push([Math.sqrt(rho * rho - (Ln - x) ** 2) + R - rho, S(x)]);
  }
  prof.push([R, S(7.26)], [0.42, S(7.28)], [0, S(7.281)]);
  P.add('body', body(prof, 20), { tint: G });
  for (const s of [3.95, 6.55]) P.add('body', zTube(S(s) - 0.03, S(s) + 0.03, 0.465, 0.465, 20), { tint: 0x4d5832 });
  fins(P, 'body', [[S(6.65), 0.45], [S(7.25), 0.45], [S(7.26), 0.74], [S(7.08), 0.74]], 0.04, 0x56613a);
  P.add('body', zTube(S(7.27), S(7.3), 0.3, 0.3, 14), { tint: NOZZLE });
  return finish(P, { length: 7.28, plume: V(0, 0, S(7.3)) });
}

// 9M127 Vikhr (refs/threats-ru): 2.8 m long, 0.13 m across, small canards behind the nose and four wings
// of 0.38 m span at the tail; olive
function atgm() {
  const P = new Parts(materials());
  P.add('body', missileBody(2.8, 0.065, 0.32, { seg: 12, tip: 0.25 }), { tint: 0x5d6844 });
  fins(P, 'body', [[-0.98, 0.064], [-0.86, 0.064], [-0.88, 0.12], [-0.95, 0.12]], 0.01, 0x4c5636, 0);
  fins(P, 'body', [[1.02, 0.064], [1.38, 0.064], [1.38, 0.19], [1.2, 0.19]], 0.012, 0x4c5636);
  P.add('body', zTube(1.4, 1.42, 0.05, 0.05, 10), { tint: NOZZLE });
  return finish(P, { length: 2.8, plume: V(0, 0, 1.42) });
}

// ---------------------------------------------------------------- interceptors

function m48N6() {
  const P = new Parts(materials());
  P.add('body', missileBody(7.5, 0.258, 1.6, { seg: 18, tip: 0.05 }), { tint: 0xd3d5cf });
  P.add('body', missileBody(1.0, 0.2, 1.0, { seg: 18, tip: 0.05 }).translate(0, 0, -3.25), { tint: 0xe6e6df }); // radome
  for (const z of [-1.1, 1.8]) P.add('body', zTube(z - 0.02, z + 0.02, 0.262, 0.262, 18), { tint: 0x9a9c96 }); // section joints
  // four control fins at the tail
  fins(P, 'body', [[2.95, 0.25], [3.72, 0.25], [3.72, 0.62], [3.4, 0.62]], 0.03, 0xb9bbb5);
  P.add('body', zTube(3.72, 3.8, 0.2, 0.18, 14), { tint: NOZZLE });
  return finish(P, { length: 7.5, plume: V(0, 0, 3.8) });
}

function m9M96() {
  const P = new Parts(materials());
  P.add('body', missileBody(5.65, 0.12, 0.85, { seg: 14, tip: 0.05 }), { tint: 0xd0d2cb });
  fins(P, 'body', [[-1.75, 0.12], [-1.45, 0.12], [-1.5, 0.25], [-1.65, 0.25]], 0.015, 0xaeb0a9); // canards
  fins(P, 'body', [[2.25, 0.12], [2.8, 0.12], [2.82, 0.36], [2.55, 0.36]], 0.02, 0xaeb0a9);
  P.add('body', zTube(2.82, 2.88, 0.09, 0.08, 12), { tint: NOZZLE });
  return finish(P, { length: 5.65, plume: V(0, 0, 2.88) });
}

// 57E6: the slender dart ahead and the fat booster behind (bicalibre: the booster drops at burnout and
// the dart flies on unpowered, refs/launch). `dz` moves a part along the axis (the booster model is
// centred on itself).
function dart57E6(P) {
  P.add('body', missileBody(1.9, 0.045, 0.35, { seg: 10, tip: 0.1 }).translate(0, 0, -0.65), { tint: 0x6b7056 });
  fins(P, 'body', [[-1.35, 0.044], [-1.2, 0.044], [-1.22, 0.1], [-1.3, 0.1]], 0.008, 0x5a5f47);
  fins(P, 'body', [[0.15, 0.044], [0.3, 0.044], [0.3, 0.12], [0.22, 0.12]], 0.008, 0x5a5f47);
}
const BOOST57 = 0.94; // the booster's centre on the round
function booster57E6(P, dz = 0) {
  const at = (g) => g.translate(0, 0, dz);
  P.add('body', at(zTube(0.3, 1.6, 0.085, 0.085, 14)), { tint: 0x5c6249 });
  P.add('body', at(zTube(0.24, 0.3, 0.045, 0.085, 14)), { tint: 0x5c6249 });
  const one = sideProfile([[1.2, 0.085], [1.6, 0.085], [1.6, 0.26], [1.4, 0.26]], 0.012);
  for (let i = 0; i < 4; i++) P.add('body', at(one.clone().rotateZ(Math.PI / 4 + (i * Math.PI) / 2)), { tint: 0x4f5440 });
  P.add('body', at(zTube(1.6, 1.64, 0.06, 0.06, 10)), { tint: NOZZLE });
}
function m57E6() {
  const P = new Parts(materials());
  dart57E6(P);
  booster57E6(P);
  return finish(P, { length: 3.2, plume: V(0, 0, 1.64) });
}
function m57E6dart() {
  const P = new Parts(materials());
  dart57E6(P);
  return finish(P, { length: 1.9, plume: V(0, 0, 0.3) });
}
function m57E6booster() {
  const P = new Parts(materials());
  booster57E6(P, -BOOST57);
  return finish(P, { length: 1.4, plume: V(0, 0, 1.64 - BOOST57), offset: V(0, 0, BOOST57) });
}

function m9M33() {
  const P = new Parts(materials());
  P.add('body', missileBody(3.16, 0.105, 0.45, { seg: 12, tip: 0.08 }), { tint: 0xb9bfae });
  fins(P, 'body', [[-1.2, 0.104], [-0.95, 0.104], [-1.0, 0.24], [-1.1, 0.24]], 0.012, 0x9da393); // canards
  fins(P, 'body', [[0.85, 0.104], [1.55, 0.104], [1.55, 0.36], [1.3, 0.36]], 0.015, 0x9da393);
  P.add('body', zTube(1.55, 1.6, 0.08, 0.075, 12), { tint: NOZZLE });
  return finish(P, { length: 3.16, plume: V(0, 0, 1.6) });
}

function m9M37() {
  const P = new Parts(materials());
  P.add('body', missileBody(2.2, 0.06, 0.18, { seg: 12, tip: 0.35 }), { tint: 0x59633f });
  P.add('glass', sphere(0.05, 0, 0, -1.1, 1, 1, 0.6, 10), { tint: 0x4a2a3a }); // seeker dome
  fins(P, 'body', [[-0.92, 0.06], [-0.78, 0.06], [-0.8, 0.13], [-0.88, 0.13]], 0.008, 0x4c5536);
  fins(P, 'body', [[0.85, 0.06], [1.1, 0.06], [1.1, 0.17], [0.98, 0.17]], 0.01, 0x4c5536);
  P.add('body', zTube(1.1, 1.13, 0.045, 0.045, 10), { tint: NOZZLE });
  return finish(P, { length: 2.2, plume: V(0, 0, 1.13) });
}

// The loadout's rounds come from their vehicle builders (models/v/), which also put them on the
// launchers. A round built as an Object3D (meshes from Parts.build) is baked into this file's shape:
// every mesh moved into the root's space and merged per material, `skip` a subtree left out, or only
// the `only` subtree taken (moved by `shift`). The vehicle materials lay mud by the height above the
// ground in `aH`; a round in flight is clean, so it is set high.
function fromObject(root, extra, skip = null, only = null, shift = null) {
  root.updateMatrixWorld(true);
  const byMat = new Map();
  root.traverse((o) => {
    if (!o.isMesh) return;
    let inside = !only;
    for (let p = o; p; p = p.parent) {
      if (p === skip) return;
      if (p === only) inside = true;
    }
    if (!inside) return;
    const g = o.geometry.clone().applyMatrix4(o.matrixWorld);
    if (shift) g.translate(shift.x, shift.y, shift.z);
    const h = g.attributes.aH;
    if (h) h.array.fill(5);
    if (!byMat.has(o.material)) byMat.set(o.material, []);
    byMat.get(o.material).push(g);
  });
  const parts = [];
  for (const [material, list] of byMat) {
    const geometry = list.length > 1 ? mergeGeometries(list, false) : list[0];
    geometry.computeBoundingSphere();
    parts.push({ geometry, material });
  }
  return { parts, ...extra };
}

// Buk 9M317: one mesh, nozzle at the tail (+Z)
const m9M317 = () => fromObject(buildMissile9M317(), { length: 5.55, plume: V(0, 0, 2.8) });
// Tunguska 9M311: the dart on its booster, then the dart alone (it coasts, unpowered, after the drop)
function m9M311() {
  const g = build9M311();
  return fromObject(g, { length: g.userData.length, plume: g.userData.plume.clone() });
}
function m9M311dart() {
  const g = build9M311();
  return fromObject(g, { length: 1.6, plume: g.userData.dartPlume.clone() }, g.userData.booster);
}
// its booster alone, centred on itself (from the joint at z 0.32 to the nozzle at 1.3)
function m9M311booster() {
  const g = build9M311(), c = 0.81;
  return fromObject(g, { length: 0.98, plume: V(0, 0, 1.3 - c), offset: V(0, 0, c) }, null, g.userData.booster, V(0, 0, -c));
}

const BUILDERS = {
  fighter, decoy, cruise, drone, arm, glide, helo, tbm, atgm,
  '48N6': m48N6, '9M96': m9M96, '57E6': m57E6, '57E6:dart': m57E6dart, '57E6:booster': m57E6booster, '9M33': m9M33, '9M37': m9M37,
  '9M317': m9M317, '9M338': buildTorMissile, '9M311': m9M311, '9M311:dart': m9M311dart, '9M311:booster': m9M311booster,
};
const cache = new Map();
const build = (k) => {
  if (!cache.has(k)) cache.set(k, BUILDERS[k]?.() ?? null);
  return cache.get(k);
};

/** -> { parts: [{ geometry, material, spin?, pivot? }], length, plume? }; cached and shared, do not dispose. */
export const buildThreat = (type) => build(type);
export const buildInterceptor = (kind) => build(kind);

/**
 * Registers flyer models (an era's lazily loaded content, eras/index.js): threats { type: () => model }
 * and interceptors { kind: () => model }, models of the shape above. Entities.sync() draws them.
 */
export function registerFlyers({ threats = {}, interceptors = {} }) {
  for (const [type, b] of Object.entries(threats)) {
    if (!THREAT_TYPES.includes(type)) THREAT_TYPES.push(type);
    BUILDERS[type] = b;
  }
  for (const [kind, b] of Object.entries(interceptors)) {
    if (!INTERCEPTOR_KINDS.includes(kind)) INTERCEPTOR_KINDS.push(kind);
    BUILDERS[kind] = b;
  }
}
