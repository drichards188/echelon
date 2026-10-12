import * as THREE from 'three';
import { V, xf, box, yTube, zTube, xTube, sphere, rod, lathe, sideProfile, topProfile, Parts, vehicleMats, camoTextures, grainTextures, surfaceFinish } from '../kit.js';
import { toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { newRig, node, pivotAt, hb } from '../rig.js';
import { lamp as cabLamp, maz543Cabs } from './maz543.js';

// 5P85SM2-01 self-propelled launcher of the S-400 on the MAZ-543M family 8x8: a small left-hand
// cab beside the radiator grille, a full-width black bumper, an equipment stack with cable reels
// behind the cab, and four round canisters (1.0 m x 7.9 m, ring stiffened) two over two on an
// erector hinged at the frame end. Plain olive. Measured from refs/s400-mzkt with the 1.5 m tyre as
// the ruler. Parts are placed by f, metres behind the front bumper (Z(f) is the model z). The
// origin is under the erected canister stack.
//
// Canister tops (refs/launch/README.md, "Canister covers"): the mouth has a collar, and a 48N6
// canister is closed by a domed cover painted with the canister (5P85SM2-01 a68, 51P6 Army-2022):
// bolted round its skirt, a lifting bail on the crown. The ribbed dome at the other end is the base.
// A 9M96 pack is the same body with a bulkhead across the mouth and four cells, each under its own
// small red domed cover (as on the 9M96E2 container shown at MAKS-2017 and the S-350E launcher).
// The covers are frangible: the round breaks through them (fx.coverBurst throws the pieces).
//
// Rig extras beyond the shared contract:
//   setPayload(kind)        '48N6' (default) or '9M96': one round per canister or a four-round pack
//   perSlot                 rounds per canister for the payload (1 or 4)
//   setLoaded(i, loaded)    canister i full (its cover or all four cell covers on) or empty
//   coverOff(i, tube)       one cover gone: canister i's dome, or cell `tube` (0..3) of pack i
//   setCovers(i, n)         pack i with its cells 0..n-1 still covered (a 48N6 canister: n > 0)
//   mouth(i, tube, pos, dir) world position of the mouth (canister lip or cell) and the axis out of
//                           it; returns { size, paint } of its cover (diameter in m, paint colour)
//   anchors.mouths[i], anchors.tubes[i][k]  the mouth anchors, -Z out of the mouth

const F0 = 12.6;
const Z = (f) => f - F0;
const Vf = (x, y, f) => V(x, y, Z(f));
const R = 0.75, TW = 0.6, TRACK = 1.22; // 1500x600-635 tyres, wheel centres at +-1.22 (3.05 overall)
const AXLES = [2.65, 4.95, 8.35, 10.65]; // pitches 2.3 / 3.4 / 2.3
const PIN = { f: 11.45, y: 1.72 }; // erector hinge at the frame end
const TAIL = 12.85; // canister tail end (f); the canisters are 7.87 long with the dome cover
const LIP = 7.55; // d of the collar lip the cover seats on (d: metres from the tail along the canister)
const MOUTH = TAIL - LIP; // f of the canister mouth under its cover
// the cells of a 9M96 pack across the mouth, [x, z] in canister space (z is up when stowed), in
// tube order: the sim fires a pack's rounds from the last tube to the first
const CELLS = [[-0.2, 0.2], [0.2, -0.2], [-0.2, -0.2], [0.2, 0.2]];
const CELL = { r: 0.165, d: 7.5 }; // cell bore radius and the bulkhead's d
const CAN_COVER = { size: 1.1, paint: 0x434b37 }, CELL_COVER = { size: 0.34, paint: 0xa3241a };
// canister axes [x, y] in slot order: lower left, lower right, upper left, upper right
const CANS = [[-0.66, 2.36], [0.66, 2.36], [-0.58, 3.36], [0.58, 3.36]];
const STATIONS = [12.1, 8.3, 5.95]; // cradle clamp bands (f)

// Box by its extents (any order), f along the vehicle.
function ext(x0, x1, y0, y1, f0, f1, rx = 0, ry = 0, rz = 0) {
  if (x0 > x1) [x0, x1] = [x1, x0];
  if (y0 > y1) [y0, y1] = [y1, y0];
  if (f0 > f1) [f0, f1] = [f1, f0];
  return box(x1 - x0, y1 - y0, f1 - f0, (x0 + x1) / 2, (y0 + y1) / 2, Z((f0 + f1) / 2), rx, ry, rz);
}

// Side profile [f, y] extruded across x in [x0, x1].
const sideAt = (pts, x0, x1) => sideProfile(pts.map(([f, y]) => [Z(f), y]), Math.abs(x1 - x0)).translate((x0 + x1) / 2, 0, 0);

// Round lamp facing forward (axis 'z') or sideways (axis 'x', dir +-1), placed by f.
const lamp = (P, x, y, f, r, key = 'lens', axis = 'z', dir = -1) => cabLamp(P, x, y, Z(f), r, key, axis, dir);

// Plain olive set: the shared green paint with less dust on the tops (the launchers are kept
// clean), canisters in a darker satin olive composite, tyres a dusty dark grey.
let MATS;
function telMats() {
  if (MATS) return MATS;
  const tex = camoTextures('green'), grain = grainTextures(), dustColor = 0x8a7f62;
  const std = (color, roughness, metalness, extra) => new THREE.MeshStandardMaterial({ color, roughness, metalness, vertexColors: true, ...extra });
  const painted = (color, key) => {
    const m = std(color, 1, 0, { map: tex.map, roughnessMap: tex.rough, normalMap: tex.normal });
    m.normalScale.set(0.7, 0.7);
    return surfaceFinish(m, key, { mud: 0.75, dust: 0.22, dustColor });
  };
  const bare = (color, roughness, metalness, key, ns, o) => {
    const m = std(color, roughness, metalness, { roughnessMap: grain.rough, normalMap: grain.normal });
    m.normalScale.set(ns, ns);
    return surfaceFinish(m, key, { dustColor, ...o });
  };
  MATS = {
    ...vehicleMats('green'),
    camo: painted(0xe2e2e2, 'tel-camo'),
    paint: painted(0xb4b8a4, 'tel-paint'),
    canister: bare(0x414a36, 0.58, 0.05, 'tel-canister', 0.3, { mud: 0.3, dust: 0.3 }),
    // the frangible covers: flat paint over a composite shell, no sheen (the canister's satin made
    // the domes read as metal caps)
    cover: bare(CAN_COVER.paint, 1, 0, 'tel-cover', 0.15, { mud: 0.1, dust: 0.1 }),
    coverRed: bare(CELL_COVER.paint, 0.95, 0, 'tel-cover-red', 0.15, { mud: 0.05, dust: 0.08 }),
    tyre: bare(0x3d3b37, 1, 0, 'tel-tyre', 0.7, { mud: 0.75, dust: 0.6, mudTop: 0.95 }),
    hole: std(0x0b0c0a, 1, 0), // inside an empty canister: no dust settles where the light cannot reach
  };
  return MATS;
}

// ---------------------------------------------------------------- running gear

// MAZ-543 wheel: tall tyre with deep arrow lugs on a small black disc wheel (0.8 m) with ten nuts
// and the hub reduction cap. Axle along x; side = +1 on the right.
function wheel(P, x, y, z, side) {
  const W = TW / 2;
  const tyre = lathe([[0.4, -W + 0.03], [0.5, -W], [0.63, -W + 0.01], [0.69, -W + 0.05], [0.712, -W + 0.1], [0.712, W - 0.1], [0.69, W - 0.05], [0.63, W - 0.01], [0.5, W], [0.4, W - 0.03]], 36);
  P.add('tyre', tyre.applyMatrix4(xf(x, y, z, 0, 0, -Math.PI / 2)));
  const at = xf(x, y, z);
  for (let k = 0; k < 18; k++) {
    const a = (k / 18) * Math.PI * 2;
    for (const s of [-1, 1]) {
      // half an arrow lug: a block on the tread raked back from the centre line
      const m = new THREE.Matrix4().makeRotationX(a).multiply(xf(s * 0.13, 0.724, 0, 0, s * 0.5, 0));
      P.add('tyre', box(0.27, 0.05, 0.1).applyMatrix4(m).applyMatrix4(at));
      // the lug runs on over the shoulder
      const n = new THREE.Matrix4().makeRotationX(a).multiply(xf(s * 0.29, 0.665, -0.065, 0, 0, s * 0.35));
      P.add('tyre', box(0.05, 0.12, 0.09).applyMatrix4(n).applyMatrix4(at));
    }
  }
  const rim = lathe([[0.42, -0.04], [0.41, 0.02], [0.37, 0.01], [0.3, -0.05], [0.17, -0.06], [0.16, -0.01], [0.13, 0.02], [0.1, 0.09], [0.0, 0.1]], 22);
  P.add('dark', rim.applyMatrix4(xf(x + side * (W - 0.05), y, z, 0, 0, -side * Math.PI / 2)));
  for (let i = 0; i < 10; i++) {
    const b = (i / 10) * Math.PI * 2;
    P.add('dark', xTube(x + side * (W - 0.11), x + side * (W - 0.06), 0.028, 0.024, 6, y + Math.cos(b) * 0.235, z + Math.sin(b) * 0.235));
  }
  P.add('dark', xTube(x - side * (W - 0.06), x - side * (W - 0.04), 0.42, 0.42, 18, y, z)); // inner face
}

function runningGear(P) {
  AXLES.forEach((f) => {
    for (const s of [-1, 1]) {
      wheel(P, s * TRACK, R, Z(f), s);
      P.add('dark', xTube(s * 0.45, s * (TRACK - 0.27), 0.12, 0.1, 10, R, Z(f))); // half-shaft housing
      P.add('dark', sphere(0.19, s * (TRACK - 0.32), R, Z(f), 0.7, 1, 1, 10)); // hub knuckle
      P.add('dark', rod(Vf(s * 0.5, R + 0.32, f - 0.5), Vf(s * (TRACK - 0.38), R + 0.12, f), 0.05, 6)); // wishbones
      P.add('dark', rod(Vf(s * 0.5, R - 0.12, f - 0.45), Vf(s * (TRACK - 0.38), R - 0.1, f), 0.045, 6));
      P.add('dark', rod(Vf(s * 0.5, R + 0.4, f + 0.35), Vf(s * (TRACK - 0.4), R + 0.15, f + 0.1), 0.04, 6)); // damper
    }
    P.add('dark', sphere(0.24, 0, R + 0.02, Z(f), 1.3, 0.9, 1.1, 12)); // final drive
  });
  for (let i = 0; i < 3; i++) P.add('dark', zTube(Z(AXLES[i] + 0.25), Z(AXLES[i + 1] - 0.25), 0.05, 0.05, 8, 0, R + 0.05));
  P.add('dark', zTube(Z(1.2), Z(AXLES[0] - 0.25), 0.06, 0.06, 8, 0, R + 0.1)); // from the transfer box
}

// ---------------------------------------------------------------- chassis and body

function frame(P) {
  for (const s of [-1, 1]) {
    P.add('dark', ext(s * 0.41, s * 0.55, 0.95, 1.32, 0.4, 11.5)); // rails
    P.add('dark', ext(s * 0.4, s * 0.58, 1.3, 1.34, 0.4, 11.5));
    // guards over the wheels where the equipment deck runs out over them
    P.add('camo', ext(s * 0.92, s * 1.5, 1.56, 1.62, 2.35, 5.3));
  }
  for (let f = 1.0; f < 11.4; f += 1.45) P.add('dark', ext(-0.41, 0.41, 1.05, 1.25, f, f + 0.12));
  // engine and transmission under the cab, sump and skid plate behind the bumper
  P.add('dark', ext(-0.8, 0.8, 0.62, 1.15, 0.6, 2.0));
  P.add('dark', sideAt([[0.3, 0.86], [0.45, 0.9], [1.45, 0.5], [1.35, 0.44]], -1.05, 1.05));
  // deck behind the cab and under the canisters
  P.add('dark', ext(-0.92, 0.92, 1.32, 1.47, 2.35, 5.3));
  P.add('dark', ext(-1.18, 1.18, 1.32, 1.42, 5.3, 11.45));
}

// Bumper, radiator housing with the vertical-slat grille on the right, engine block sides.
function front(P) {
  // full-width black bumper with chamfered ends, lamps, red tow hook
  P.add('dark', topProfile([[-1.52, Z(0.14)], [-1.38, Z(0)], [1.38, Z(0)], [1.52, Z(0.14)], [1.52, Z(0.46)], [-1.52, Z(0.46)]], 0.86, 1.28));
  P.add('dark', ext(-1.45, 1.45, 1.22, 1.29, 0.02, 0.4)); // top lip
  for (const s of [-1, 1]) {
    lamp(P, s * 1.1, 1.08, 0.0, 0.07);
    lamp(P, s * 1.3, 1.08, 0.0, 0.045, 'amber');
    P.add('dark', ext(s * 0.55, s * 0.75, 0.92, 1.0, -0.12, 0.02)); // tow eyes
  }
  const hook = new THREE.TorusGeometry(0.075, 0.025, 6, 12, Math.PI * 1.4).applyMatrix4(xf(0.2, 0.94, Z(-0.08), 0, Math.PI / 2, -0.6));
  P.add('red', hook);
  P.add('red', ext(0.15, 0.25, 0.96, 1.06, -0.1, 0.0));

  // radiator housing, x -0.52 .. 1.52 (the cab is a narrow tandem two-seater beside it), its face
  // at f 0.22, top (the hood) at 2.12; a heavy frame round 27 deep vertical bars
  P.add('camo', sideAt([[0.34, 1.0], [0.34, 2.12], [1.8, 2.12], [1.8, 1.05], [1.6, 1.0]], -0.52, 1.52));
  P.add('dark', ext(-0.44, 1.2, 1.3, 2.03, 0.33, 0.35)); // grille back
  P.add('camo', ext(-0.52, 1.52, 2.02, 2.12, 0.22, 0.34)); // face frame
  P.add('camo', ext(-0.52, 1.52, 1.22, 1.3, 0.22, 0.34));
  P.add('camo', ext(1.2, 1.52, 1.3, 2.02, 0.22, 0.34));
  P.add('camo', ext(-0.52, -0.44, 1.3, 2.02, 0.22, 0.34));
  for (let i = 0; i < 27; i++) P.add('camo', ext(-0.425 + i * 0.0605, -0.403 + i * 0.0605, 1.3, 2.02, 0.25, 0.31)); // bars
  P.add('camo', ext(-0.44, 1.2, 1.63, 1.71, 0.22, 0.33)); // mid bar
  P.add('camo', ext(0.62, 0.68, 1.3, 2.02, 0.22, 0.33)); // divider
  lamp(P, 1.37, 1.68, 0.22, 0.1);
  P.add('amber', ext(1.3, 1.44, 1.42, 1.48, 0.19, 0.22));
  // hood top: tread ribs and grab handles
  for (let i = 0; i < 8; i++) P.add('camo', ext(-0.4 + i * 0.25, -0.36 + i * 0.25, 2.12, 2.14, 0.6, 1.65));
  for (const x of [-0.1, 0.9]) {
    P.add('steel', rod(Vf(x - 0.12, 2.12, 0.42), Vf(x - 0.12, 2.18, 0.42), 0.012, 5));
    P.add('steel', rod(Vf(x + 0.12, 2.12, 0.42), Vf(x + 0.12, 2.18, 0.42), 0.012, 5));
    P.add('steel', rod(Vf(x - 0.12, 2.18, 0.42), Vf(x + 0.12, 2.18, 0.42), 0.012, 5));
  }
  // louvres on the right flank of the radiator housing
  for (let i = 0; i < 3; i++) P.add('dark', ext(1.52, 1.53, 1.25, 1.65, 0.85 + i * 0.25, 1.0 + i * 0.25));

  // right block over the front wheel: sloped front, wheel-arch cut below
  P.add('camo', sideAt([[1.8, 1.0], [1.8, 2.12], [2.38, 2.72], [2.62, 2.72], [2.62, 1.66], [2.45, 1.66], [1.75, 1.0]], 0.85, 1.52));
  P.add('dark', ext(0.95, 1.42, 2.35, 2.37, 2.0, 2.3, -Math.PI / 4)); // vent on the slope
  // centre box behind the hood and the lidded box on top of it, reaching over the cab roof
  P.add('camo', ext(-0.52, 0.85, 1.3, 2.78, 1.8, 2.62));
  P.add('dark', ext(-0.35, 0.7, 2.25, 2.27, 1.79, 1.8));
  P.add('camo', ext(-0.75, 0.8, 2.78, 3.3, 1.85, 2.6));
  P.add('camo', ext(-0.77, 0.82, 3.18, 3.22, 1.83, 2.62)); // lid lip
  for (const x of [-0.35, 0.0, 0.55]) P.add('steel', ext(x - 0.04, x + 0.04, 3.06, 3.16, 1.82, 1.85));
  for (const x of [-0.4, 0.45]) P.add('steel', sphere(0.045, x, 3.3, Z(1.95), 1, 0.6, 1, 8)); // lid knobs
  // mirror on the right, on a tall bracket from the front corner of the housing
  P.add('dark', rod(Vf(1.45, 2.12, 0.5), Vf(1.78, 2.3, 0.3), 0.018, 5));
  P.add('dark', rod(Vf(1.52, 1.8, 0.45), Vf(1.78, 2.05, 0.3), 0.018, 5));
  P.add('dark', box(0.07, 0.46, 0.26, 1.8, 2.18, Z(0.24), 0, 0.3, 0));
}

// Equipment behind the cab: hydraulic power unit and cabinets, the X-braced cabinet across the top,
// the cable reels and the panel of white connector lights on the right, number plate box.
function equipment(P) {
  // left column behind the cab
  P.add('camo', ext(-1.5, -0.32, 1.56, 3.05, 2.35, 3.3));
  P.add('dark', ext(-1.515, -1.5, 1.65, 2.9, 2.5, 2.52));
  P.add('dark', ext(-1.515, -1.5, 1.65, 2.9, 3.15, 3.17));
  for (const y of [1.9, 2.6]) P.add('steel', ext(-1.54, -1.5, y, y + 0.04, 2.95, 3.1));
  for (let i = 0; i < 4; i++) P.add('dark', ext(-1.51, -1.5, 2.3 + i * 0.09, 2.34 + i * 0.09, 2.62, 3.05)); // louvres
  // hydraulic power unit under the X cabinet
  P.add('camo', ext(-0.32, 0.95, 1.47, 2.85, 2.62, 3.85));
  P.add('dark', ext(-0.2, 0.85, 1.6, 2.6, 2.61, 2.62));
  P.add('camo', ext(-0.95, 0.95, 1.47, 2.85, 3.85, 4.55));
  for (const x of [-0.6, 0.0, 0.6]) P.add('dark', ext(x - 0.2, x + 0.2, 1.7, 2.6, 4.55, 4.56)); // access panels, seen when the stack is up
  for (const x of [-0.75, 0.75]) P.add('steel', zTube(Z(4.56), Z(5.2), 0.03, 0.03, 6, x, 1.62)); // hoses to the cradle
  // X-braced cabinet across the top
  P.add('camo', ext(-1.05, 0.95, 2.85, 3.58, 2.75, 4.55));
  P.add('camo', ext(-1.07, 0.97, 3.56, 3.6, 2.73, 4.57));
  for (const [x0, x1] of [[-1.0, -0.06], [0.0, 0.9]]) {
    const w = x1 - x0, h = 0.66, a = Math.atan2(h, w), L = Math.hypot(w, h);
    for (const s of [-1, 1]) P.add('camo', box(L, 0.04, 0.03, (x0 + x1) / 2, 3.18, Z(2.735), 0, 0, s * a));
    P.add('dark', ext(x0, x1, 2.84, 3.52, 2.74, 2.745));
  }
  // right side: connector panel with eight white lights, electronics boxes, two cable reels
  P.add('camo', ext(1.08, 1.42, 1.6, 2.42, 2.72, 3.1));
  for (let i = 0; i < 4; i++) for (const f of [2.82, 3.0]) {
    P.add('dark', xTube(1.42, 1.45, 0.05, 0.05, 10, 1.75 + i * 0.17, Z(f)));
    P.add('white', xTube(1.45, 1.47, 0.035, 0.035, 10, 1.75 + i * 0.17, Z(f)));
  }
  P.add('camo', ext(1.0, 1.42, 2.46, 2.86, 2.72, 3.12));
  P.add('camo', ext(1.02, 1.38, 2.9, 3.28, 2.74, 3.08));
  P.add('glass', ext(1.42, 1.425, 2.62, 2.74, 2.8, 3.0));
  P.add('dark', ext(1.38, 1.385, 3.0, 3.15, 2.8, 3.0));
  for (const [y, r] of [[2.34, 0.25], [2.94, 0.22]]) {
    const pts = [];
    for (let i = 0; i <= 16; i++) pts.push([r + (i % 2 ? 0.012 : -0.004), (i / 16) * 0.55]);
    P.add('tyre', lathe(pts, 16).applyMatrix4(xf(1.2, y, Z(3.2), Math.PI / 2, 0, 0)));
    for (const f of [3.17, 3.75]) P.add('dark', zTube(Z(f), Z(f + 0.03), r + 0.05, r + 0.05, 16, 1.2, y));
    P.add('dark', zTube(Z(3.2), Z(3.75), 0.1, 0.1, 8, 1.2, y));
  }
  for (const f of [3.12, 3.83]) {
    P.add('dark', ext(1.0, 1.04, 1.56, 3.25, f - 0.02, f + 0.02));
    P.add('dark', ext(1.46, 1.5, 1.56, 3.25, f - 0.02, f + 0.02));
  }
  P.add('dark', ext(1.0, 1.5, 3.23, 3.27, 3.1, 3.85));
  // number box at the canister noses, white plate with a digit; its mate on the left
  P.add('camo', ext(0.95, 1.5, 1.56, 3.08, 3.88, 4.85));
  P.add('white', ext(1.5, 1.51, 2.42, 2.82, 3.98, 4.28));
  digit(P, 1.512, 2.62, 4.13, 0.28, 6);
  P.add('camo', ext(-1.5, -0.95, 1.56, 3.0, 3.35, 4.85));
  P.add('dark', ext(-1.515, -1.5, 1.65, 2.85, 3.5, 3.52));
  P.add('dark', ext(-1.515, -1.5, 1.65, 2.85, 4.7, 4.72));
  P.add('steel', ext(-1.54, -1.5, 2.2, 2.24, 4.45, 4.62));
  // exhaust out of the right side below the reels
  P.add('dark', xTube(0.9, 1.56, 0.065, 0.065, 8, 1.44, Z(3.55)));
  // front rest for the canister cradle
  P.add('dark', ext(-1.0, 1.0, 1.47, 1.69, 5.3, 5.55));
  for (const s of [-1, 1]) P.add('rubber', ext(s * 0.4, s * 0.9, 1.69, 1.75, 5.32, 5.53));
  // the tubular guard arch: a frame leaning in over the roof from the sides behind the cab
  const tube = (a, b) => P.add('camo', rod(a, b, 0.045, 8));
  tube(Vf(1.46, 1.85, 2.67), Vf(0.85, 3.78, 2.67));
  tube(Vf(0.85, 3.78, 2.67), Vf(-1.05, 3.78, 2.67));
  tube(Vf(-1.05, 3.78, 2.67), Vf(-1.48, 2.3, 2.67));
  for (const x of [0.85, -1.05]) P.add('camo', sphere(0.06, x, 3.78, Z(2.67), 1, 1, 1, 8));
  // mushroom vent on a post behind the lidded box
  P.add('dark', yTube(3.3, 3.62, 0.05, 0.05, 8, -0.15, Z(2.68)));
  P.add('camo', yTube(3.62, 3.72, 0.2, 0.17, 16, -0.15, Z(2.68)));
}

// Seven-segment digit in black on a white plate facing +X (read with the front to the right).
function digit(P, x, y, f, h, n) {
  const w = h * 0.55, t = h * 0.12;
  // segments a..g: top, upper right, lower right, bottom, lower left, upper left, middle
  const on = ['abcdef', 'bc', 'abged', 'abgcd', 'fgbc', 'afgcd', 'afgedc', 'abc', 'abcdefg', 'abfgcd'][n];
  const hz = (dy) => P.add('dark', ext(x, x + 0.005, y + dy - t / 2, y + dy + t / 2, f - w / 2, f + w / 2));
  const vt = (dy, df) => P.add('dark', ext(x, x + 0.005, y + dy - h / 4, y + dy + h / 4, f + df - t / 2, f + df + t / 2));
  const R = -(w / 2 - t / 2), L = -R; // the viewer's right is toward the front (smaller f)
  if (on.includes('a')) hz(h / 2 - t / 2);
  if (on.includes('b')) vt(h / 4, R);
  if (on.includes('c')) vt(-h / 4, R);
  if (on.includes('d')) hz(-h / 2 + t / 2);
  if (on.includes('e')) vt(-h / 4, L);
  if (on.includes('f')) vt(h / 4, L);
  if (on.includes('g')) hz(0);
}

// Side platforms over the rear wheels: box beams with ribbed locker doors and an outer skin that dips
// between the wheels, the black battery box on its tray, rear cross member and lamps, the erector
// hinge brackets and pin.
function platforms(P) {
  for (const s of [-1, 1]) {
    P.add('camo', sideAt([[5.1, 1.86], [11.5, 1.86], [11.5, 1.64], [11.15, 1.52], [5.25, 1.52], [5.1, 1.64]], s * 1.18, s * 1.5));
    for (const [f0, f1] of [[5.6, 7.5], [8.72, 9.83], [9.94, 11.05]]) {
      P.add('camo', ext(s * 1.5, s * 1.52, 1.56, 1.82, f0, f1));
      for (let k = 1; k < 4; k++) P.add('camo', ext(s * 1.5, s * 1.535, 1.56 + k * 0.065, 1.575 + k * 0.065, f0 + 0.08, f1 - 0.08));
      for (const f of [f0 + 0.15, f1 - 0.15]) P.add('steel', ext(s * 1.52, s * 1.55, 1.75, 1.8, f - 0.05, f + 0.05));
    }
    // outer skin: clears the tyres and dips down between the wheel pairs
    P.add('camo', sideAt([[5.1, 1.86], [11.6, 1.86], [11.6, 1.3], [11.43, 1.3], [11.43, 1.55], [9.95, 1.55], [9.75, 1.25], [9.25, 1.25], [9.05, 1.55],
      [7.65, 1.55], [7.45, 1.2], [5.95, 1.2], [5.75, 1.55], [5.25, 1.55], [5.1, 1.64]], s * 1.45, s * 1.5));
    for (const [f0, f1] of [[6.05, 7.35], [9.33, 9.67]]) P.add('dark', ext(s * 1.5, s * 1.505, 1.28, 1.3, f0, f1));
    lamp(P, s * 1.5, 1.68, 7.62, 0.04, 'lens', 'x', s);
    P.add('dark', ext(s * 0.72, s * 1.3, 0.95, 1.22, 5.95, 7.3)); // battery box on its tray
    P.add('camo', ext(s * 0.7, s * 1.32, 0.6, 0.95, 5.92, 7.33));
    P.add('camo', ext(s * 1.32, s * 1.335, 0.72, 0.76, 5.95, 7.3));
    for (const f of [6.0, 7.25]) P.add('dark', ext(s * 1.28, s * 1.3, 0.95, 1.5, f - 0.02, f + 0.02));
    // rear lamps on the ends of the platform beams
    P.add('dark', ext(s * 1.22, s * 1.46, 1.62, 1.8, 11.5, 11.53));
    P.add('red', ext(s * 1.25, s * 1.36, 1.66, 1.76, 11.53, 11.545));
    P.add('amber', ext(s * 1.38, s * 1.44, 1.66, 1.76, 11.53, 11.545));
    // hinge brackets
    P.add('dark', ext(s * 0.24, s * 0.38, 1.15, 1.88, 11.2, 11.55));
  }
  P.add('dark', ext(-0.8, 0.8, 1.0, 1.32, 11.36, 11.5));
  P.add('steel', zTube(Z(11.5), Z(11.7), 0.05, 0.05, 8, 0, 1.08));
  P.add('steel', ext(-0.08, 0.08, 1.0, 1.16, 11.48, 11.56));
  P.add('steel', xTube(-0.46, 0.46, 0.08, 0.08, 12, PIN.y, Z(PIN.f))); // hinge pin
}

// Jack housings between the paired wheels; the legs and feet are posed (see buildTEL).
const JACKS = [[-1.22, 3.8], [1.22, 3.8], [-1.22, 9.5], [1.22, 9.5]];
function jackHousings(P) {
  for (const [x, f] of JACKS) {
    P.add('camo', ext(x - 0.13, x + 0.13, 0.85, 1.5, f - 0.13, f + 0.13));
    P.add('dark', ext(x - 0.15, x + 0.15, 0.82, 0.88, f - 0.15, f + 0.15));
    P.add('dark', ext(Math.sign(x) * 0.55, x, 1.15, 1.3, f - 0.08, f + 0.08)); // to the frame
    if (f < 5) P.add('red', ext(x + Math.sign(x) * 0.13, x + Math.sign(x) * 0.135, 0.95, 1.4, f - 0.05, f + 0.05)); // marker plate
  }
}
function jackLegs(P) {
  for (const [x, f] of JACKS) {
    P.add('steel', yTube(0.42, 1.4, 0.065, 0.065, 10, x, Z(f)));
    P.add('dark', yTube(0.36, 0.42, 0.22, 0.2, 18, x, Z(f)));
    P.add('dark', sphere(0.09, x, 0.45, Z(f), 1, 0.8, 1, 8));
  }
}

// ---------------------------------------------------------------- erector and canisters

// Canister body about its axis: shallow tail cap with a boss and a rounded shoulder, the tail band,
// then ten sections joined by stiffening rings every 0.75 m, each section flaring slightly toward the
// mouth so the joints read as steps, and the mouth collar with its lip, the inside dropping to the
// dark mouth. d runs from the tail (0) to the lip (LIP). Creased normals keep the ring edges sharp
// and the round smooth.
function canisterBody() {
  const pts = [[0, 0], [0.12, 0], [0.13, 0.02], [0.38, 0.035], [0.44, 0.06], [0.48, 0.11], [0.5, 0.18], [0.5, 0.27], [0.53, 0.29], [0.53, 0.45], [0.49, 0.47]];
  for (let k = 0; k < 9; k++) {
    const d = 1.05 + k * 0.75;
    pts.push([0.507, d - 0.05], [0.528, d - 0.03], [0.528, d + 0.03], [0.49, d + 0.05]);
  }
  pts.push([0.507, 7.27], [0.538, 7.29], [0.538, 7.51], [0.547, 7.52], [0.547, LIP], [0.47, LIP], [0.47, 7.45]);
  return toCreasedNormals(lathe(pts, 28), 0.3);
}

// Places a geometry built along +Y (d from the tail) on canister i in vehicle space.
const onCan = (g, i) => g.applyMatrix4(xf(CANS[i][0], CANS[i][1], Z(TAIL), -Math.PI / 2, 0, 0));

function cradle(P) {
  const body = canisterBody();
  CANS.forEach(([x, y], i) => {
    P.add('canister', onCan(body.clone(), i));
    P.add('hole', onCan(lathe([[0.47, 7.45], [0, 7.45]], 20), i)); // empty mouth, seen when the cover is gone
    const upper = i > 1, s = Math.sign(x);
    STATIONS.forEach((f, k) => {
      const d = TAIL - f;
      P.add('canister', onCan(lathe([[0.522, d - 0.05], [0.54, d - 0.04], [0.54, d + 0.04], [0.522, d + 0.05]], 28), i));
      if (upper) P.add('paint', ext(s * 0.06, s * 0.22, 2.9, 3.08, f - 0.06, f + 0.06)); // bracket to the spine
      else P.add('paint', ext(s * 0.11, s * 0.19, y - 0.06, y + 0.06, f - 0.06, f + 0.06));
      if (upper && k < 2) { // hold-down latches on top: a saddle with two cheeks and a hook
        P.add('paint', ext(x - 0.12, x + 0.12, y + 0.52, y + 0.58, f - 0.12, f + 0.12));
        for (const c of [-0.09, 0.09]) P.add('paint', ext(x + c - 0.02, x + c + 0.02, y + 0.58, y + 0.72, f - 0.1, f + 0.1));
        P.add('dark', xTube(x - 0.11, x + 0.11, 0.025, 0.025, 6, y + 0.68, Z(f)));
        P.add('dark', ext(x - 0.03, x + 0.03, y + 0.6, y + 0.7, f - 0.16, f - 0.04, -0.5));
      }
      if (k === 1) P.add('paint', ext(x + s * 0.53, x + s * 0.6, y - 0.08, y + 0.08, f - 0.1, f + 0.1)); // side lug
    });
  });
  // spine between the stacks, rails under the lower pair, hinge lugs round the pin
  P.add('paint', ext(-0.12, 0.12, 1.75, 2.95, 5.5, 12.7));
  for (const s of [-1, 1]) {
    P.add('dark', ext(s * 0.42, s * 0.54, 1.75, 1.86, 5.6, 12.5));
    P.add('dark', ext(s * 0.12, s * 0.22, 1.5, 1.95, 11.2, 11.7));
    P.add('steel', zTube(Z(5.7), Z(12.4), 0.022, 0.022, 6, s * 0.135, 2.6)); // hydraulic lines
    P.add('steel', zTube(Z(5.7), Z(12.4), 0.018, 0.018, 6, s * 0.135, 2.5));
  }
  P.add('dark', ext(-0.18, 0.18, 1.62, 1.82, 9.95, 10.45)); // ram lug
  // hardware under the spine, facing the vehicle when erected: hose channel and valve blocks
  P.add('dark', ext(-0.15, 0.15, 1.67, 1.75, 5.7, 9.9));
  for (const [f0, f1] of [[6.2, 6.8], [7.6, 8.0], [8.8, 9.45]]) P.add('paint', ext(-0.2, 0.2, 1.56, 1.68, f0, f1));
  for (const x of [-0.08, 0.0, 0.08]) P.add('rubber', zTube(Z(5.8), Z(9.8), 0.022, 0.022, 6, x, 1.64));
  P.add('paint', ext(-0.16, 0.16, 2.6, 2.94, 7.0, 7.8)); // valve box
}

// Domed cover of canister i: a skirt over the collar lip with twelve bolts round it, a shallow dome
// and a lifting bail on the crown, all in the canister's paint.
function dome(K, i) {
  K.add('cover', onCan(lathe([[0.53, 7.515], [0.553, 7.52], [0.553, 7.6], [0.549, 7.635], [0.534, 7.68], [0.507, 7.72], [0.463, 7.763], [0.402, 7.8], [0.322, 7.83], [0.222, 7.852], [0.112, 7.865], [0, 7.869]], 32), i));
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2 + 0.13, c = Math.cos(a), s = Math.sin(a);
    K.add('cover', onCan(rod(V(c * 0.548, 7.565, s * 0.548), V(c * 0.567, 7.565, s * 0.567), 0.017, 6), i));
  }
  for (const x of [-0.075, 0.075]) K.add('cover', onCan(box(0.035, 0.03, 0.05, x, 7.874, 0), i));
  K.add('cover', onCan(new THREE.TorusGeometry(0.075, 0.009, 5, 10, Math.PI).translate(0, 7.88, 0), i));
}

// Across the mouth of a 9M96 pack: a bulkhead with four cells, each with a raised ring and a dark bore.
function bulkhead(K, i) {
  const s = new THREE.Shape().absarc(0, 0, 0.475, 0, Math.PI * 2, false);
  for (const [cx, cz] of CELLS) s.holes.push(new THREE.Path().absarc(cx, -cz, CELL.r, 0, Math.PI * 2, true));
  K.add('cover', onCan(new THREE.ShapeGeometry(s, 24).rotateX(-Math.PI / 2).translate(0, CELL.d, 0), i));
  for (const [cx, cz] of CELLS) {
    K.add('cover', onCan(lathe([[0.182, CELL.d], [0.182, CELL.d + 0.025], [0.172, CELL.d + 0.032], [CELL.r, CELL.d + 0.032], [CELL.r, CELL.d]], 20).translate(cx, 0, cz), i));
    K.add('hole', onCan(lathe([[CELL.r, CELL.d], [CELL.r, CELL.d - 0.3], [0, CELL.d - 0.3]], 16).translate(cx, 0, cz), i));
  }
}

// The red domed cover of one cell of pack i.
const cellCover = (i, [cx, cz]) =>
  onCan(lathe([[0.17, CELL.d + 0.028], [0.186, CELL.d + 0.032], [0.186, CELL.d + 0.052], [0.181, CELL.d + 0.078], [0.166, CELL.d + 0.105], [0.14, CELL.d + 0.128], [0.103, CELL.d + 0.145], [0.055, CELL.d + 0.155], [0, CELL.d + 0.158]], 22).translate(cx, 0, cz), i);

// ---------------------------------------------------------------- the rig

export function buildTEL() {
  const rig = newRig('green');
  rig.mats = telMats();
  rig.P = new Parts(rig.mats);
  const { P, root, mats } = rig;
  runningGear(P);
  frame(P);
  front(P);
  maz543Cabs(P, { sides: 'left', zOff: -F0 });
  equipment(P);
  platforms(P);
  jackHousings(P);
  P.build(root, { dirt: 0.5 });

  // erector: modelled stowed in vehicle space, then moved so the group's origin is the hinge pin
  const er = pivotAt(rig, root, 'erector', 0, PIN.y, Z(PIN.f));
  const toPin = (meshes) => { for (const m of meshes) m.geometry.translate(0, -PIN.y, -Z(PIN.f)); };
  const C = new Parts(mats);
  cradle(C);
  toPin(C.build(er, { dirt: 0.2 }));
  // the covers: a dome per 48N6 canister; for a 9M96 payload a bulkhead per pack with a cover per cell
  const domes = [], cells = [];
  rig.anchors.mouths = [];
  rig.anchors.tubes = [];
  const packs = new THREE.Group();
  packs.name = 'packs';
  packs.visible = false;
  er.add(packs);
  const PK = new Parts(mats);
  CANS.forEach(([x, y], i) => {
    const g = new THREE.Group();
    g.name = 'cover' + i;
    er.add(g);
    const K = new Parts(mats);
    dome(K, i);
    toPin(K.build(g, { dirt: 0.1 }));
    domes.push(g);
    rig.slots.push([g]);
    rig.anchors.missileSlots.push(node(er, 'slot' + i, x, y - PIN.y, Z(MOUTH) - Z(PIN.f) - 0.05));
    rig.anchors.mouths.push(node(er, 'mouth' + i, x, y - PIN.y, Z(MOUTH) - Z(PIN.f)));
    bulkhead(PK, i);
    cells.push(CELLS.map((c, k) => {
      const cg = new THREE.Group();
      cg.name = `cell${i}.${k}`;
      packs.add(cg);
      const T = new Parts(mats);
      T.add('coverRed', cellCover(i, c));
      toPin(T.build(cg, { dirt: 0.05 }));
      return cg;
    }));
    rig.anchors.tubes.push(CELLS.map(([cx, cz], k) => node(er, `tube${i}.${k}`, x + cx, y + cz - PIN.y, Z(TAIL - CELL.d) - Z(PIN.f))));
  });
  toPin(PK.build(packs, { dirt: 0.1 }));
  let pack = false;
  const full = CANS.map(() => true);
  const show = (i) => {
    domes[i].visible = !pack && full[i];
    packs.visible = pack;
    for (const c of cells[i]) c.visible = full[i];
  };
  rig.perSlot = 1;
  rig.setPayload = (kind) => {
    pack = kind === '9M96';
    rig.perSlot = pack ? CELLS.length : 1;
    CANS.forEach((_, i) => show(i));
  };
  rig.setLoaded = (i, loaded) => {
    if (!domes[i]) return;
    full[i] = !!loaded;
    show(i);
  };
  rig.coverOff = (i, tube = 0) => {
    if (pack) {
      if (cells[i]?.[tube]) cells[i][tube].visible = false;
    } else if (domes[i]) domes[i].visible = false;
  };
  rig.setCovers = (i, n) => {
    if (!domes[i]) return;
    if (pack) cells[i].forEach((c, k) => (c.visible = k < n));
    else domes[i].visible = n > 0;
  };
  rig.mouth = (i, tube, pos, dir) => {
    const a = pack ? rig.anchors.tubes[i]?.[tube] : rig.anchors.mouths[i];
    if (!a) return null;
    a.updateWorldMatrix(true, false);
    pos.setFromMatrixPosition(a.matrixWorld);
    dir.set(0, 0, -1).transformDirection(a.matrixWorld);
    return pack ? CELL_COVER : CAN_COVER;
  };

  // The game only turns pivots.erector, so the lift rams and the jack legs pose themselves from its
  // angle whenever three updates the world matrices (before every render and shadow pass): the jacks
  // go down over the first part of the lift, the rams follow the cradle.
  const legs = new THREE.Group();
  root.add(legs);
  const L = new Parts(mats);
  jackLegs(L);
  L.build(legs, { dirt: 0.6 });
  const A = Vf(0, 1.15, 8.6), B0 = V(0, 0, Z(10.25) - Z(PIN.f)); // ram ends: on the frame, on the cradle (erector space)
  const barrel = new THREE.Group(), ram = new THREE.Group();
  root.add(barrel, ram);
  const Rb = new Parts(mats), Rr = new Parts(mats);
  for (const s of [-1, 1]) {
    Rb.add('paint', zTube(0, -1.7, 0.14, 0.14, 14, s * 0.3, 0));
    Rb.add('paint', zTube(-1.55, -1.7, 0.16, 0.16, 14, s * 0.3, 0)); // gland
    Rb.add('dark', zTube(0.1, -0.1, 0.16, 0.16, 12, s * 0.3, 0));
    Rr.add('steel', zTube(0, -1.72, 0.085, 0.085, 12, s * 0.3, 0));
    Rr.add('dark', zTube(0.09, -0.09, 0.12, 0.12, 12, s * 0.3, 0));
  }
  Rb.build(barrel, { dirt: 0.3, y0: 1.2 });
  Rr.build(ram, { dirt: 0.2, y0: 1.8 });
  const B = new THREE.Vector3(), X = V(1, 0, 0);
  const pose = () => {
    const t = er.rotation.x;
    legs.position.y = -0.36 * THREE.MathUtils.smoothstep(t, 0.02, 0.3);
    B.copy(B0).applyAxisAngle(X, t).add(er.position);
    const dy = B.y - A.y, dz = B.z - A.z;
    barrel.position.copy(A);
    barrel.rotation.x = Math.atan2(dy, -dz);
    ram.position.copy(B);
    ram.rotation.x = Math.atan2(-dy, dz);
  };
  for (const g of [legs, barrel, ram]) {
    g.updateMatrixWorld = function (force) {
      pose();
      THREE.Object3D.prototype.updateMatrixWorld.call(this, force);
    };
  }
  pose();

  rig.anchors.eye = node(root, 'eye', 0, 2.2, Z(6.2));
  hb(rig, -1.55, 0, Z(0), 1.55, 3.9, Z(TAIL));
  hb(rig, -1.2, 0.3, Z(11.5), 1.2, 8.3, Z(13.7)); // the stack when erected
  return rig;
}
