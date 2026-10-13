import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { V, box, rbox, sphere, zTube, yTube, lathe, sideProfile, topProfile, Parts } from './kit.js';
import { buildMissile9M317 } from './v/buk.js';
import { buildTorMissile } from './v/tor.js';
import { build9M311 } from './v/tunguska.js';

// The attackers and the interceptors, built procedurally for instanced drawing: every model is a few
// parts, each one merged BufferGeometry with vertex colours over a shared material, so the render
// layer can draw each part of each type as one InstancedMesh. The attackers are generic and unmarked.
// Model space: forward -Z, up +Y, real size in metres, origin near the middle of the body.
// Spinning parts (props, rotors) carry `spin` (the axis) and `pivot` (the centre they turn about);
// their geometry stays in model space.
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

// four fins round the body: planform [z, y] (y outward from the axis) of thickness t, rolled by `roll`
function fins(P, key, pts, t, tint, roll = Math.PI / 4, n = 4) {
  const one = sideProfile(pts, t);
  for (let i = 0; i < n; i++) P.add(key, one.clone().rotateZ(roll + (i * Math.PI * 2) / n), { tint });
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

function spinner(P, axis, pivot) {
  const g = P.merged('body');
  g.computeBoundingSphere();
  return { geometry: g, material: materials().rotor, spin: axis, pivot };
}

const GREY = 0x7b838a, DARK = 0x3d4246, LIGHT = 0xb8bcb8, NOZZLE = 0x2a2a2a, RADOME = 0x9a9c94;

// ---------------------------------------------------------------- attackers

function fighter() {
  const P = new Parts(materials());
  // fuselage: radome, cockpit section, a deeper centre body over the intake, then the nozzle
  P.add('body', body([[0, -7.6], [0.14, -7.4], [0.42, -6.2], [0.58, -4.6], [0.72, -2.5], [0.78, 1.0], [0.72, 5.0], [0.55, 7.0], [0.42, 7.6], [0, 7.61]], 18), { tint: GREY });
  P.add('body', box(1.25, 0.95, 6.2, 0, -0.45, -0.4), { tint: GREY }); // centre body
  P.add('body', rbox(1.0, 0.75, 3.0, 0.12, 0, -0.75, -2.6), { tint: GREY }); // intake
  P.add('body', box(0.86, 0.5, 0.12, 0, -0.78, -4.08), { tint: NOZZLE }); // intake mouth
  P.add('body', zTube(6.6, 7.9, 0.5, 0.44, 16), { tint: NOZZLE }); // nozzle
  // cropped delta wing and the strakes
  P.add('body', wing([[-4.75, 1.6], [-4.75, 2.6], [-0.6, 3.8], [0.6, 3.8], [4.75, 2.6], [4.75, 1.6], [0.6, -2.6], [-0.6, -2.6]], 0.14, -0.2), { tint: GREY });
  P.add('body', wing([[-0.9, -1.2], [-0.2, -5.0], [0.2, -5.0], [0.9, -1.2]], 0.08, -0.1), { tint: GREY });
  // tailplanes and fin
  P.add('body', wing([[-2.9, 6.6], [-2.9, 7.4], [2.9, 7.4], [2.9, 6.6], [0.6, 4.6], [-0.6, 4.6]], 0.08, -0.15), { tint: GREY });
  P.add('body', sideProfile([[3.8, 0.6], [6.9, 0.6], [7.4, 3.6], [6.4, 3.6]], 0.12), { tint: GREY });
  for (const s of [-1, 1]) P.add('body', sideProfile([[5.6, -0.7], [7.2, -0.7], [7.2, -1.2]], 0.08).translate(s * 0.55, 0, 0), { tint: GREY }); // ventral fins
  // canopy
  P.add('glass', sphere(0.5, 0, 0.62, -3.9, 1, 0.75, 2.6, 16), { tint: 0x26323a });
  // stores: wingtip missiles, two radar-seeking missiles under the wings, a centreline tank
  for (const s of [-1, 1]) {
    P.add('body', zTube(-0.6, 3.0, 0.065, 0.065, 8, s * 4.85, -0.2), { tint: LIGHT });
    P.add('body', box(0.06, 0.3, 1.0, s * 2.6, -0.45, 0.9), { tint: GREY }); // pylon
    P.add('body', missileBody(4.2, 0.13, 0.6, { seg: 10 }).translate(s * 2.6, -0.75, 0.6), { tint: LIGHT });
  }
  P.add('body', missileBody(4.0, 0.3, 1.2, { seg: 12, boat: 0.3 }).translate(0, -1.15, 0.2), { tint: 0x8a9096 });
  return finish(P, { length: 15.2, plume: V(0, 0, 7.9) });
}

function decoy() {
  const P = new Parts(materials());
  P.add('body', missileBody(2.84, 0.17, 0.45, { boat: 0.3, seg: 12 }), { tint: 0x9a9e9a });
  P.add('body', wing([[-0.85, -0.05], [-0.85, 0.12], [0.85, 0.12], [0.85, -0.05], [0, -0.3]], 0.03, 0.12), { tint: 0x8d918d });
  fins(P, 'body', [[1.05, 0.12], [1.4, 0.12], [1.42, 0.38], [1.3, 0.38]], 0.025, 0x8d918d);
  P.add('body', zTube(1.38, 1.45, 0.1, 0.1, 10), { tint: NOZZLE });
  return finish(P, { length: 2.84, plume: V(0, 0, 1.45) });
}

function cruise() {
  const P = new Parts(materials());
  // a flattened stealthy body: a chined box section that tapers to a chisel nose
  P.add('body', rbox(0.62, 0.48, 3.6, 0.12, 0, 0, 0.3), { tint: 0x7d8580 });
  P.add('body', sideProfile([[-1.5, -0.24], [-1.5, 0.24], [-2.45, 0.02], [-2.45, -0.06]], 0.58, 0.04), { tint: 0x7d8580 });
  P.add('body', sideProfile([[2.1, -0.2], [2.1, 0.18], [2.55, 0.05], [2.55, -0.12]], 0.5, 0.03), { tint: 0x7d8580 });
  P.add('body', box(0.32, 0.14, 0.8, 0, -0.29, 0.6), { tint: 0x6e7470 }); // belly intake
  P.add('body', box(0.26, 0.08, 0.04, 0, -0.29, 0.19), { tint: NOZZLE });
  // pop-out wings and the tail controls
  P.add('body', wing([[-1.3, -0.05], [-1.3, 0.2], [1.3, 0.2], [1.3, -0.05], [0, -0.35]], 0.04, 0.2), { tint: 0x737a75 });
  fins(P, 'body', [[1.9, 0.2], [2.4, 0.2], [2.45, 0.5], [2.25, 0.5]], 0.03, 0x737a75);
  P.add('body', zTube(2.5, 2.58, 0.1, 0.1, 10), { tint: NOZZLE });
  return finish(P, { length: 5.1, plume: V(0, 0, 2.58) });
}

function drone() {
  const P = new Parts(materials());
  const C = 0xb3b5ae, D = 0x8f918a;
  // a cropped delta flying wing round a cylindrical body, wingtip fins, pusher engine at the back
  P.add('body', missileBody(3.2, 0.24, 0.6, { seg: 14, tip: 0.2 }).translate(0, 0, -0.1), { tint: C });
  P.add('body', wing([[-1.25, 1.35], [-1.25, 1.05], [-0.3, -0.9], [0.3, -0.9], [1.25, 1.05], [1.25, 1.35]], 0.09, 0), { tint: C });
  for (const s of [-1, 1]) P.add('body', sideProfile([[0.95, -0.25], [1.4, -0.25], [1.45, 0.35], [1.2, 0.35]], 0.04).translate(s * 1.25, 0, 0), { tint: D });
  P.add('body', zTube(1.25, 1.5, 0.15, 0.12, 12), { tint: 0x5a5c58 }); // engine
  P.add('body', zTube(1.5, 1.6, 0.06, 0.03, 8), { tint: NOZZLE }); // spinner
  const out = finish(P, { length: 3.5 });
  // the pusher propeller (two blades) turns about the body axis
  const R = new Parts(materials());
  for (const a of [0, Math.PI]) R.add('body', box(0.07, 0.42, 0.015, 0, 0.21, 0).rotateZ(a).translate(0, 0, 1.58), { tint: 0x2e2e2c });
  out.parts.push(spinner(R, 'z', V(0, 0, 1.58)));
  return out;
}

function arm() {
  const P = new Parts(materials());
  P.add('body', missileBody(4.17, 0.127, 0.55, { seg: 12 }), { tint: LIGHT });
  P.add('body', missileBody(0.56, 0.129, 0.55, { seg: 12 }).translate(0, 0, -1.805), { tint: RADOME }); // radome
  fins(P, 'body', [[-0.6, 0.12], [0.5, 0.12], [0.45, 0.42], [0.2, 0.42]], 0.02, 0xa7aaa5, 0);
  fins(P, 'body', [[1.65, 0.12], [2.05, 0.12], [2.05, 0.3], [1.85, 0.3]], 0.018, 0xa7aaa5, 0);
  P.add('body', zTube(2.05, 2.1, 0.09, 0.09, 10), { tint: NOZZLE });
  return finish(P, { length: 4.17, plume: V(0, 0, 2.1) });
}

function glide() {
  const P = new Parts(materials());
  const C = 0x5d6450;
  P.add('body', missileBody(3.9, 0.23, 0.9, { boat: 0.35, seg: 14, tip: 0.25 }), { tint: C });
  P.add('body', box(0.12, 0.08, 1.2, 0, 0.25, -0.1), { tint: 0x4f5545 }); // wing kit
  P.add('body', wing([[-1.3, 0.05], [-1.3, 0.25], [1.3, 0.25], [1.3, 0.05], [0.1, -0.15], [-0.1, -0.15]], 0.025, 0.3), { tint: 0x4f5545 });
  fins(P, 'body', [[1.3, 0.16], [1.9, 0.16], [1.95, 0.44], [1.75, 0.44]], 0.03, 0x4f5545);
  for (const z of [-0.9, 0.6]) P.add('body', zTube(z - 0.04, z + 0.04, 0.236, 0.236, 14), { tint: 0xa98b2c }); // fuze bands
  return finish(P, { length: 3.9 });
}

function helo() {
  const P = new Parts(materials());
  const C = 0x4b5146, D = 0x3c4139;
  // narrow tandem fuselage: nose sensor turret, stepped cockpits, the engine deck and the boom
  P.add('body', rbox(1.05, 1.5, 6.4, 0.3, 0, 1.75, -0.6), { tint: C });
  P.add('body', sideProfile([[-3.8, 1.0], [-3.8, 2.4], [-5.2, 1.7], [-5.4, 1.3]], 0.9, 0.08), { tint: C });
  P.add('body', sphere(0.32, 0, 1.0, -5.3, 1, 1, 1, 12), { tint: D }); // sensor turret
  P.add('glass', sideProfile([[-1.2, 2.45], [-2.6, 2.45], [-3.8, 2.3], [-4.3, 2.0], [-1.2, 2.0]], 0.98, 0.05), { tint: 0x22303a });
  P.add('glass', sideProfile([[-1.1, 2.75], [-1.2, 2.45], [-2.4, 2.45], [-2.0, 2.95], [-1.4, 3.0]], 0.9, 0.05), { tint: 0x22303a });
  for (const s of [-1, 1]) {
    P.add('body', zTube(-1.1, 2.0, 0.42, 0.36, 14, s * 0.9, 2.55), { tint: D }); // engines
    P.add('body', zTube(1.95, 2.3, 0.3, 0.3, 12, s * 0.9, 2.55), { tint: NOZZLE });
  }
  P.add('body', rbox(1.3, 0.6, 2.6, 0.2, 0, 2.7, 0.2), { tint: C }); // engine deck
  P.add('body', zTube(2.4, 9.6, 0.42, 0.18, 12, 0, 2.0), { tint: C }); // tail boom
  P.add('body', sideProfile([[8.6, 2.0], [9.9, 2.0], [10.3, 4.1], [9.6, 4.1]], 0.14), { tint: C }); // fin
  P.add('body', wing([[-1.7, 8.9], [-1.7, 9.5], [1.7, 9.5], [1.7, 8.9], [0, 8.6]], 0.08, 2.2), { tint: C }); // stabiliser
  // stub wings with rocket pods and missile rails
  P.add('body', wing([[-2.4, 0.0], [-2.4, 0.9], [2.4, 0.9], [2.4, 0.0]], 0.14, 1.65), { tint: C });
  for (const s of [-1, 1]) {
    P.add('body', zTube(-0.6, 1.3, 0.24, 0.24, 12, s * 1.3, 1.25), { tint: D }); // rocket pod
    for (const dy of [0.95, 1.3]) P.add('body', missileBody(1.6, 0.09, 0.2, { seg: 8 }).translate(s * 2.2, dy, 0.3), { tint: 0x6d7350 });
  }
  // skids and the mast
  for (const s of [-1, 1]) P.add('body', zTube(-3.2, 0.8, 0.05, 0.05, 6, s * 1.0, 0.1), { tint: D });
  for (const z of [-2.4, 0.2]) P.add('body', box(2.0, 0.06, 0.08, 0, 0.55, z), { tint: D });
  P.add('body', yTube(2.9, 3.6, 0.16, 0.12, 10, 0, -0.4), { tint: D });
  P.add('body', yTube(3.6, 3.9, 0.3, 0.3, 12, 0, -0.4), { tint: D }); // hub
  const out = finish(P, { length: 17.7 });
  // main rotor: four blades, 14.6 m across, turning about Y at the hub
  const M = new Parts(materials());
  for (let i = 0; i < 4; i++) M.add('body', box(7.2, 0.05, 0.53, 3.75, 0, 0).rotateY((i * Math.PI) / 2).translate(0, 3.78, -0.4), { tint: 0x2d302b });
  out.parts.push(spinner(M, 'y', V(0, 3.78, -0.4)));
  // tail rotor: four blades on the left of the fin, turning about X
  const T = new Parts(materials());
  for (let i = 0; i < 4; i++) T.add('body', box(0.04, 1.35, 0.2, 0, 0.7, 0).rotateX((i * Math.PI) / 2).translate(-0.18, 3.5, 9.95), { tint: 0x2d302b });
  out.parts.push(spinner(T, 'x', V(-0.18, 3.5, 9.95)));
  return out;
}

function tbm() {
  const P = new Parts(materials());
  P.add('body', missileBody(4.0, 0.305, 1.2, { seg: 18, tip: 0.04 }), { tint: 0x8f938d });
  P.add('body', missileBody(1.21, 0.307, 1.2, { seg: 18, tip: 0.04 }).translate(0, 0, -1.395), { tint: 0x5f625e }); // heat-blackened nose
  fins(P, 'body', [[1.4, 0.3], [2.0, 0.3], [2.0, 0.62], [1.7, 0.62]], 0.04, 0x7b7f79);
  P.add('body', zTube(2.0, 2.06, 0.22, 0.22, 14), { tint: NOZZLE });
  return finish(P, { length: 4.0, plume: V(0, 0, 2.06) });
}

function atgm() {
  const P = new Parts(materials());
  P.add('body', missileBody(1.63, 0.089, 0.22, { seg: 10, tip: 0.3 }), { tint: 0x6d7350 });
  fins(P, 'body', [[-0.25, 0.088], [0.15, 0.088], [0.12, 0.2], [-0.15, 0.2]], 0.012, 0x5d6345);
  fins(P, 'body', [[0.62, 0.088], [0.8, 0.088], [0.8, 0.17], [0.7, 0.17]], 0.01, 0x5d6345);
  return finish(P, { length: 1.63, plume: V(0, 0, 0.82) });
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
