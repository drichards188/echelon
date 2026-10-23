import * as THREE from 'three';
import { box, rbox, yTube, Parts, concreteTextures, surfaceFinish } from '../../../models/kit.js';
import { newRig, node, hb } from '../../../models/rig.js';
import { mulberry32 } from '../../../noise.js';
import { flakMats, add, build } from './kit44.js';

// The flak tower pair of the first type (Bauart 1, the three Berlin towers and Hamburg's Heiligengeistfeld,
// 1941 to 1942), the game's what-if at Hopsten: the gun tower (G-Turm) and, 420 m from it, its fire control
// tower (L-Turm). After refs/ww2/flakturm: the plan of the type (flakturm_plan_bau1_01: a square block with a
// square corner tower at each corner, a round gun emplacement on each and two small emplacements for the light
// flak on each corner tower's outer faces), Hamburg's tower that still stands (flakturm_hamburg_18 to _20 and
// the aerial view of 1945, _13: the corner towers standing proud of the block's faces, the octagonal gun tubs
// on them over a cantilevered slab, the light-flak nests hanging below it on heavy brackets, a cluttered
// roof), and the Zoo tower in Berlin (flakturm_zoo_04, _09, _03, _05: the same arrangement in rounded forms,
// round gun tubs over a rounded slab; small window openings in rows with hinged steel shutters; the gun
// pits' parapets with ready-ammunition niches; the L-tower beyond with its radar on the roof). Built in the
// Berlin forms. Sizes: 70.5 m square and 39 m to the gun tubs' rims (en.wiki Zoo tower; Hamburg 75 m, de.wiki);
// the L-tower 50 by 23 m and 39 m (en.wiki); the corner towers' size, the slab's and the nests' read from the
// Hamburg photos with those (E). Lift lines of the board formwork in the concrete texture; the window
// openings were cast in and closed by steel shutters (de.wiki Flakturm IV: later concrete plugs).
//
// G-tower rig (front -Z, right +X, ground y = 0 at the centre): no pivots; anchors.eye on the roof. FLAKTURM
// holds the levels the guns stand at (eras/ww2.js `deck`) and the structure's boxes for the light guns'
// masked arcs (sim/systems.js), all measured from the ground at the tower's centre.
export const FLAKTURM = {
  half: 35.25, // the outer faces of the corner towers
  block: 31.75, // the block's faces between them
  corner: 24, // the corner towers' centres (and the gun tubs'), from the tower's centre on each axis
  cornerHalf: 11.25, // the corner towers' half side
  roof: 33.5, // the roof slab's top
  capHalf: 14.05, capR: 5, // the cantilevered slab round each corner tower's top (half side, corner radius)
  tubR: 9.6, rimR: 8.9, pitR: 7.2, // the gun tub: its foot's and rim's outer radius, the pit's
  floor: 37.1, rim: 39.0, // the gun pit's floor (the twins stand on it) and the parapet's top
  nest: 29.8, nestR: 4.6, nestOut: 1.0, gunOut: 4.0, // the light-flak nests: floor, radius, centre and gun beyond the face
  post: 36.5, // the backup fire control post's top in the middle of the roof (the Kommandogeraet)
};
// L-tower: 50 by 23 m, its roof at 34 m, a corner bastion at each corner, the radar's plinth at its east end
export const LEITTURM = { hx: 25, hz: 11.5, roof: 34, house: 39, plinth: 36, plinthX: 15, nestR: 4 };

let MATS;
function mats() {
  if (MATS) return MATS;
  const con = concreteTextures(0xa8a49a);
  const concrete = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0, vertexColors: true, map: con.map, roughnessMap: con.rough, normalMap: con.normal });
  surfaceFinish(concrete, 'ww2-flakturm', { mud: 0.5, mudTop: 1.6, dust: 0.25, dustColor: 0x8d8a80, mudColor: 0x3d3a34 });
  MATS = { ...flakMats('grey'), concrete };
  return MATS;
}

// a polygon in plan ([x, z] points, counter-clockwise seen from above) with holes, extruded from y0 to y1
function slab(outer, holes, y0, y1) {
  const s = new THREE.Shape(outer.map(([x, z]) => new THREE.Vector2(x, -z)));
  for (const h of holes) s.holes.push(new THREE.Path(h.map(([x, z]) => new THREE.Vector2(x, -z))));
  const g = new THREE.ExtrudeGeometry(s, { depth: y1 - y0, bevelEnabled: false, curveSegments: 4 });
  g.rotateX(-Math.PI / 2);
  return g.translate(0, y0, 0);
}
// a rounded rectangle's outline in plan
function roundRect(cx, cz, hx, hz, r, seg = 6) {
  const pts = [];
  for (const [qx, qz, a0] of [[1, 1, 0], [-1, 1, Math.PI / 2], [-1, -1, Math.PI], [1, -1, 1.5 * Math.PI]]) {
    for (let i = 0; i <= seg; i++) {
      const a = a0 + (i / seg) * (Math.PI / 2);
      pts.push([cx + qx * (hx - r) + r * Math.cos(a), cz + qz * (hz - r) + r * Math.sin(a)]);
    }
  }
  return pts;
}
// the outline pulled in by d (a parapet's inner face); fine for the convex outlines here
const inset = (pts, d, cx, cz) => pts.map(([x, z]) => {
  const dx = x - cx, dz = z - cz, l = Math.hypot(dx, dz) || 1;
  return [x - (dx / l) * d, z - (dz / l) * d];
});
// a band of the lathe profile [[r, y], [r, y]] round (cx, cz), leaving out a gap of `gap` radians at angle `at`
// (three's lathe: angle 0 toward +Z, +pi/2 toward +X)
function band(p0, p1, cx, cz, seg = 40, gap = 0, at = 0) {
  const g = new THREE.LatheGeometry([new THREE.Vector2(p0[0], p0[1]), new THREE.Vector2(p1[0], p1[1])], seg, at + gap / 2, Math.PI * 2 - gap);
  return g.translate(cx, 0, cz);
}

// a wall's window openings with their steel shutters: a grid across a face from u0 to u1 (along the face), the
// rows' sill heights; the face's outward normal (nx, nz) and its plane (d along the normal from the centre)
function windows(P, rnd, { nx, nz, d, u0, u1, cols, rows, w = 1.3, h = 1.7, skip = () => false }) {
  for (const y of rows) {
    for (let k = 0; k < cols; k++) {
      const u = cols === 1 ? (u0 + u1) / 2 : u0 + ((u1 - u0) * k) / (cols - 1);
      if (skip(u, y)) continue;
      // (x, z) on the face: u runs along it (+X on a z-face, +Z on an x-face)
      const at = (out, along) => (nz ? [u + along, nz * (d + out)] : [nx * (d + out), u + along]);
      const [x, z] = at(0.03, 0);
      const open = rnd() < 0.18;
      add(P, 'black', nz ? box(w, h, 0.08, x, y + h / 2, z) : box(0.08, h, w, x, y + h / 2, z), 0x16171a, 0);
      if (open) {
        // swung out on its hinge at one side, square to the wall or past it
        const side = rnd() < 0.5 ? -1 : 1, swing = 0.9 + rnd() * 0.9;
        const [hx, hz] = at(0.05, side * (w / 2));
        const g = box(w, h, 0.06, -side * (w / 2), h / 2, 0);
        g.rotateY((nz ? 0 : Math.PI / 2) + side * swing * (nz ? -nz : nx));
        add(P, 'white', g.translate(hx, y, hz), 0x7c7e78, 0);
      } else {
        const [sx, sz] = at(0.07, 0);
        add(P, 'white', nz ? box(w + 0.1, h + 0.1, 0.05, sx, y + h / 2, sz) : box(0.05, h + 0.1, w + 0.1, sx, y + h / 2, sz), 0x86888a, 0);
      }
    }
  }
}

export function buildFlakturm() {
  const rig = newRig('green');
  const M = mats();
  rig.mats = M;
  const root = rig.root;
  const F = FLAKTURM, rnd = mulberry32(1942);
  const P = new Parts(M);
  const C = (g, tint = 0xffffff, tile = 6) => add(P, 'concrete', g, tint, tile);
  const CORNERS = [[-1, -1], [1, -1], [1, 1], [-1, 1]];

  // the foundation (a few metres into the ground, so the block sits on any slope of its pad), the block, the
  // corner towers standing proud of its faces
  C(box(2 * F.half + 2, 6, 2 * F.half + 2, 0, -2.9, 0), 0x9c988e);
  C(box(2 * F.block, F.roof, 2 * F.block, 0, F.roof / 2, 0), 0xb4b0a6);
  for (const [sx, sz] of CORNERS) C(box(2 * F.cornerHalf, F.roof, 2 * F.cornerHalf, sx * F.corner, F.roof / 2, sz * F.corner), 0xaca89e);
  // the roof's cornice and parapet along the block's faces between the corner towers
  const gap = F.corner - F.cornerHalf; // half the block's face between them
  for (const [nx, nz] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
    const o = F.block;
    C(nz ? box(2 * gap, 0.9, 0.6, 0, F.roof - 0.45, nz * (o + 0.3)) : box(0.6, 0.9, 2 * gap, nx * (o + 0.3), F.roof - 0.45, 0), 0xb0aca2);
    C(nz ? box(2 * gap, 1.2, 0.6, 0, F.roof + 0.6, nz * (o - 0.3)) : box(0.6, 1.2, 2 * gap, nx * (o - 0.3), F.roof + 0.6, 0), 0xa6a298);
  }
  C(box(2 * F.block - 1.2, 0.1, 2 * F.block - 1.2, 0, F.roof + 0.05, 0), 0x96938b, 8); // the roof's screed

  for (const [sx, sz] of CORNERS) {
    const cx = sx * F.corner, cz = sz * F.corner;
    // the slab cantilevered round the corner tower's top, its parapet
    const cap = roundRect(cx, cz, F.capHalf, F.capHalf, F.capR);
    C(slab(cap, [], F.roof - 1.6, F.roof), 0xaeaaa0);
    C(slab(cap, [inset(cap, 0.45, cx, cz)], F.roof, F.roof + 1.1), 0xa6a298);
    // the gun tub: a battered round wall rising from the slab, the pit inside with its floor; an opening and
    // a stair toward the roof's middle; ready-ammunition niches round the parapet's inner face
    const toMid = Math.atan2(-sx, -sz);
    C(band([F.tubR, F.roof], [F.rimR, F.rim], cx, cz, 48, 0.32, toMid), 0xb2aea4);
    C(band([F.rimR, F.rim], [F.pitR + 0.1, F.rim], cx, cz, 48, 0.32, toMid), 0xbab6ac);
    C(band([F.pitR + 0.1, F.rim], [F.pitR, F.floor], cx, cz, 48, 0.32, toMid), 0xa29e94);
    C(band([F.pitR, F.floor], [0.01, F.floor], cx, cz, 40), 0x8e8b84);
    // the gap's cheeks and the stair down to the roof
    for (const t of [-1, 1]) {
      const a = toMid + t * 0.16, r = (F.pitR + F.tubR) / 2;
      C(box(0.4, F.rim - F.roof, F.tubR - F.pitR + 0.3, 0, 0, 0).rotateY(a).translate(cx + Math.sin(a) * r, (F.rim + F.roof) / 2, cz + Math.cos(a) * r), 0xa6a298);
    }
    // the stair: a straight flight along the tub's wall from the roof up to the gap (flakturm_humboldthain_11)
    const nSteps = Math.round((F.floor - F.roof) / 0.2), tx = Math.cos(toMid), tz = -Math.sin(toMid);
    const lx = cx + Math.sin(toMid) * (F.tubR + 0.9), lz = cz + Math.cos(toMid) * (F.tubR + 0.9);
    C(box(1.6, F.floor - F.roof, 1.6, 0, 0, 0).rotateY(toMid).translate(lx, (F.floor + F.roof) / 2, lz), 0x9c988e); // the landing
    for (let k = 0; k < nSteps; k++) {
      const along = 0.8 + 0.3 * (k + 0.5), h = F.floor - F.roof - 0.2 * (k + 1);
      C(box(1.4, h, 0.3, 0, 0, 0).rotateY(toMid).translate(lx + tx * along, F.roof + h / 2, lz + tz * along), 0x9c988e);
    }
    // a railing round the rim
    add(P, 'metal', new THREE.TorusGeometry(F.rimR - 0.3, 0.025, 4, 48, Math.PI * 2 - 0.4).rotateX(Math.PI / 2).rotateY(toMid - Math.PI / 2 + 0.2).translate(cx, F.rim + 0.9, cz), 0x5a5c58, 0);
    for (let k = 0; k < 16; k++) {
      const a = toMid + 0.25 + (k / 15) * (Math.PI * 2 - 0.5);
      add(P, 'metal', box(0.04, 0.9, 0.04, cx + Math.sin(a) * (F.rimR - 0.3), F.rim + 0.45, cz + Math.cos(a) * (F.rimR - 0.3)), 0x5a5c58, 0);
    }
    // rounds stacked on the roof by the tub (flakturm_humboldthain_10): their cases lying in a pile
    for (let row = 0; row < 3; row++) for (let k = 0; k < 7 - row; k++) {
      const g = yTube(-0.75, 0.75, 0.085, 0.085, 8).rotateZ(Math.PI / 2).rotateY(toMid);
      const along = -2.4 + k * 0.19 + row * 0.095, out = F.tubR + 3.2;
      add(P, 'brass', g.translate(cx + Math.sin(toMid) * out + tx * along, F.roof + 0.09 + row * 0.16, cz + Math.cos(toMid) * out + tz * along), 0xffffff, 0);
    }
    for (let k = 0; k < 10; k++) {
      const a = toMid + 0.5 + (k / 10) * (Math.PI * 2 - 1.0), r = F.pitR + 0.06;
      add(P, 'black', box(0.95, 0.75, 0.12, 0, 0, 0).rotateY(a).translate(cx + Math.sin(a) * r, F.floor + 0.75, cz + Math.cos(a) * r), 0x1c1d1f, 0);
    }
    // the hoist's house on the roof beside the tub
    C(rbox(3.2, 2.8, 3.2, 0.1, cx - sx * 12.5, F.roof + 1.4, cz - sz * 6.5), 0xa4a096);
    add(P, 'metal', box(1.4, 2.0, 0.1, cx - sx * 12.5, F.roof + 1.0, cz - sz * 6.5 - sz * 1.62), 0x55574f);

    // the light-flak nests on the corner tower's two outer faces: a half-round slab under the cantilever, its
    // parapet, two heavy brackets under it to the wall
    for (const ax of ['x', 'z']) {
      const nx = ax === 'x' ? sx : 0, nz = ax === 'z' ? sz : 0;
      const fx = ax === 'x' ? sx * (F.half + F.nestOut) : cx, fz = ax === 'z' ? sz * (F.half + F.nestOut) : cz;
      const face = Math.atan2(nx, nz); // three's lathe/cylinder angle of the face's normal
      const half = (r, y0, y1, open = false) => new THREE.CylinderGeometry(r, r, y1 - y0, 20, 1, open, face - Math.PI / 2, Math.PI).translate(fx, (y0 + y1) / 2, fz);
      C(half(F.nestR, F.nest - 0.8, F.nest), 0xb0aca2);
      C(half(F.nestR, F.nest, F.nest + 1.1, true), 0xa6a298);
      C(half(F.nestR - 0.4, F.nest, F.nest + 1.1, true), 0xa6a298);
      C(band([F.nestR - 0.4, F.nest + 1.1], [F.nestR, F.nest + 1.1], fx, fz, 20, Math.PI, face + Math.PI), 0xb2aea4);
      // the nest's inner part, back to the wall
      C(nz ? box(2 * F.nestR, 0.8, F.nestOut + 0.05, fx, F.nest - 0.4, fz - nz * (F.nestOut / 2)) : box(F.nestOut + 0.05, 0.8, 2 * F.nestR, fx - nx * (F.nestOut / 2), F.nest - 0.4, fz), 0xb0aca2);
      for (const t of [-1, 1]) {
        const along = t * 2.2, out = 2.0;
        const g = box(0.8, 5.2, 0.9, 0, 0, 0);
        g.rotateX(nz ? -nz * 0.55 : 0).rotateZ(nx ? nx * 0.55 : 0);
        C(g.translate(nz ? fx + along : fx - nx * (F.nestOut - out / 2), F.nest - 2.6, nz ? fz - nz * (F.nestOut - out / 2) : fz + along), 0xa29e94);
      }
      // the door from the tower onto the nest
      add(P, 'metal', nz ? box(1.6, 2.2, 0.1, fx + (rnd() < 0.5 ? -2.6 : 2.6), F.nest + 1.1, sz * (F.half + 0.05)) : box(0.1, 2.2, 1.6, sx * (F.half + 0.05), F.nest + 1.1, fz + (rnd() < 0.5 ? -2.6 : 2.6)), 0x55574f, 0);
    }
  }

  // the backup fire control post in the roof's middle: a round stand with its parapet, the Kommandogeraet on it
  C(yTube(F.roof, F.post, 4.6, 4.3, 32), 0xaeaaa0);
  C(band([4.3, F.post], [4.3, F.post + 1.0], 0, 0, 32), 0xa6a298);
  C(band([3.9, F.post + 1.0], [3.9, F.post], 0, 0, 32), 0xa6a298);
  C(band([3.9, F.post + 1.0], [4.3, F.post + 1.0], 0, 0, 32), 0xb2aea4);
  for (let k = 0; k < 5; k++) C(box(1.4, 0.34, 0.36, 0, F.roof + 0.17 + k * 0.6, 4.75 + k * 0.36), 0x9c988e); // its steps
  // low walls and a ramp on the roof, the aerial masts
  C(box(14, 1.0, 0.5, 0, F.roof + 0.5, -12), 0xa29e94);
  C(box(0.5, 1.0, 12, -12, F.roof + 0.5, 0), 0xa29e94);
  for (const [x, z, h] of [[6, 8, 9], [-7, -7, 7]]) add(P, 'metal', yTube(F.roof, F.roof + h, 0.05, 0.03, 6, x, z), 0x5a5c58, 0);

  // the windows: six storeys of openings on the block's faces between the corner towers and on the towers' outer faces
  const rows = [4.4, 9.6, 14.8, 20.0, 25.2];
  for (const [nx, nz] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
    windows(P, rnd, { nx, nz, d: F.block, u0: -gap + 2.5, u1: gap - 2.5, cols: 5, rows, skip: (u, y) => y < 6 && Math.abs(u) < 3 && nz === 1 });
    for (const s of [-1, 1]) windows(P, rnd, { nx, nz, d: F.half, u0: s * F.corner - 6.5, u1: s * F.corner + 6.5, cols: 3, rows });
  }
  // the entrances in the rear face and the left face, each behind a blast wall
  for (const [nx, nz] of [[0, 1], [-1, 0]]) {
    const o = F.block;
    add(P, 'metal', nz ? box(4, 4.4, 0.25, 0, 2.2, nz * (o + 0.12)) : box(0.25, 4.4, 4, nx * (o + 0.12), 2.2, 0), 0x4d4f48, 0);
    C(nz ? box(10, 4.2, 1.4, 0, 2.1, nz * (o + 6)) : box(1.4, 4.2, 10, nx * (o + 6), 2.1, 0), 0xa29e94);
    for (const s of [-1, 1]) C(nz ? box(1.4, 4.2, 6, s * 5, 2.1, nz * (o + 3)) : box(6, 4.2, 1.4, nx * (o + 3), 2.1, s * 5), 0xa29e94);
  }
  build(P, root, 0, 0.6);

  rig.anchors.eye = node(root, 'eye', 0, F.roof + 3, 6);
  hb(rig, -F.half - 2, 0, -F.half - 2, F.half + 2, F.rim + 1, F.half + 2);
  return rig;
}

// The fire control tower (L-Turm) of the first type: a block 50 by 23 m, its roof 34 m up, a round bastion at
// each corner for a 2 cm Flakvierling (four quadruple 20 mm, en.wiki), the control rooms' house on the roof up
// to 39 m, the Wuerzburg-Riese on its round plinth at the east end (de.wiki: the L-tower carried the Riese on
// its roof). Window openings and shutters as on the G-tower. Rig: front -Z, the long side along X; no pivots.
export function buildLeitturm() {
  const rig = newRig('green');
  const M = mats();
  rig.mats = M;
  const root = rig.root;
  const L = LEITTURM, rnd = mulberry32(1943);
  const P = new Parts(M);
  const C = (g, tint = 0xffffff, tile = 6) => add(P, 'concrete', g, tint, tile);

  C(box(2 * L.hx + 2, 6, 2 * L.hz + 2, 0, -2.9, 0), 0x9c988e);
  C(box(2 * L.hx, L.roof, 2 * L.hz, 0, L.roof / 2, 0));
  C(box(2 * L.hx + 0.6, 0.9, 2 * L.hz + 0.6, 0, L.roof - 0.45, 0), 0xb0aca2);
  // the parapet, broken by the bastions
  for (const s of [-1, 1]) {
    C(box(2 * L.hx - 2 * L.nestR, 1.2, 0.6, 0, L.roof + 0.6, s * (L.hz - 0.3)), 0xa6a298);
    C(box(0.6, 1.2, 2 * L.hz - 2 * L.nestR, s * (L.hx - 0.3), L.roof + 0.6, 0), 0xa6a298);
  }
  C(box(2 * L.hx - 1.2, 0.1, 2 * L.hz - 1.2, 0, L.roof + 0.05, 0), 0x96938b, 8);
  // the corner bastions: round slabs at the roof's corners, their parapets open toward the roof
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    const cx = sx * L.hx, cz = sz * L.hz, at = Math.atan2(-sx, -sz);
    C(yTube(L.roof - 1.6, L.roof, L.nestR, L.nestR, 28, cx, cz), 0xb0aca2);
    C(band([L.nestR, L.roof], [L.nestR, L.roof + 1.1], cx, cz, 28, Math.PI / 2, at), 0xa6a298);
    C(band([L.nestR - 0.4, L.roof + 1.1], [L.nestR - 0.4, L.roof], cx, cz, 28, Math.PI / 2, at), 0xa6a298);
    C(band([L.nestR - 0.4, L.roof + 1.1], [L.nestR, L.roof + 1.1], cx, cz, 28, Math.PI / 2, at), 0xb2aea4);
    // the bastion's corbel down the corner
    C(yTube(L.roof - 5, L.roof - 1.6, 1.2, L.nestR - 0.2, 28, cx, cz), 0xa29e94);
  }
  // the control rooms' house on the roof, its slit windows; the radar's round plinth at the east end
  C(box(20, L.house - L.roof, 12, -7, (L.house + L.roof) / 2, 0), 0xaeaaa0);
  C(box(20.6, 0.5, 12.6, -7, L.house - 0.25, 0), 0xb4b0a6);
  for (const s of [-1, 1]) for (let k = 0; k < 6; k++) add(P, 'black', box(1.6, 0.5, 0.1, -15 + k * 3.2, L.roof + 3.2, s * 6.04), 0x16171a, 0);
  C(yTube(L.roof, L.plinth, 5, 5, 32, L.plinthX, 0), 0xaeaaa0);
  for (let k = 0; k < 4; k++) C(box(1.2, 0.4, 0.4, L.plinthX - 5.3 - k * 0.4, L.roof + 0.2 + k * 0.45, 0, 0, Math.PI / 2, 0), 0x9c988e);
  for (const [x, z, h] of [[-12, 4, 8], [-2, -4, 6]]) add(P, 'metal', yTube(L.house, L.house + h, 0.05, 0.03, 6, x, z), 0x5a5c58, 0);

  const rows = [4.4, 9.6, 14.8, 20.0, 25.2];
  windows(P, rnd, { nx: 0, nz: -1, d: L.hz, u0: -L.hx + 4, u1: L.hx - 4, cols: 9, rows });
  windows(P, rnd, { nx: 0, nz: 1, d: L.hz, u0: -L.hx + 4, u1: L.hx - 4, cols: 9, rows, skip: (u, y) => y < 6 && Math.abs(u) < 3 });
  for (const s of [-1, 1]) windows(P, rnd, { nx: s, nz: 0, d: L.hx, u0: -L.hz + 4, u1: L.hz - 4, cols: 3, rows });
  add(P, 'metal', box(4, 4.4, 0.25, 0, 2.2, L.hz + 0.12), 0x4d4f48, 0);
  C(box(10, 4.2, 1.4, 0, 2.1, L.hz + 6), 0xa29e94);
  for (const s of [-1, 1]) C(box(1.4, 4.2, 6, s * 5, 2.1, L.hz + 3), 0xa29e94);
  build(P, root, 0, 0.6);

  rig.anchors.eye = node(root, 'eye', 0, L.roof + 3, 4);
  hb(rig, -L.hx - 4, 0, -L.hz - 4, L.hx + 4, L.house + 1, L.hz + 4);
  return rig;
}
