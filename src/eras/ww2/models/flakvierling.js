import * as THREE from 'three';
import { V, DEG, box, rbox, yTube, zTube, xTube, rod, lathe, xf, loft, Parts } from '../../../models/kit.js';
import { newRig, node, pivotAt, hb } from '../../../models/rig.js';
import { mulberry32 } from '../../../noise.js';
import { flakMats, setPaint, paintCarrier, add, build, tubeAB, wheelSet, panSeat, ringBank, floorDisc, sandbagWall, sandbag, crewSpot } from './kit44.js';

// 2 cm Flakvierling 38 (refs/ww2/flakvierling; TM-E 9-228 figs. 1, 3 to 5 for the dimensions; photos
// flakvierling_museum_09, the mount on its triangle from the right rear; flakvierling_museum_05, the front;
// flakvierling_trailer-drawing_01, the 1943 Bilderatlas view with magazines fitted; flakvierling_pit-firing_24,
// the crew round it in action). Two kinds share the mount:
//   flakvierling        on its triangular lower carriage (Lafettendreieck, the Sd.Anh. 52 taken away) in a
//                       round pit with a low sandbag and earth parapet (section 11, an estimate: no source
//                       gives one); an ammunition niche under planks on the left;
//   flakvierling-tower  on its fixed ring (receiving ring 0.82 m across, 0.115 m high; trunnions 0.915 m above
//                       the ring's foot, fig. 5) on a wooden flak tower (section 11: no airfield tower
//                       drawing was found; built after the coastal towers' description, four main poles, the
//                       gun platform walled 1.0 m high with 0.18 m thick planking and an open ammunition
//                       platform below it, scaled to the 9 to 15 m airfield towers of the overview): the gun
//                       platform 9 m up, the ammunition platform at 7 m, a ladder up one side.
// The mount: the rotating ring with the upper carriage between its side plates; the cradle, two large
// drums joined across the middle, the four Flak 38 on sleighs on the drums' outer faces, two a side, one
// above the other (axes 0.674 m apart across and 0.280 m apart in height; the right-hand guns upside down,
// so every 20-round magazine sits on the outboard side, roughly level); each gun's receiver, the barrel
// with its slightly flared flash hider; the equilibrator low at the front with the deflector box for the
// spent cases under it; at the rear the layer's seat with its curved back rest on a toothed post, the
// elevating handwheel on his right, the traverse handwheel slanting in front of him, the two firing pedals
// and the knee guards; the Flakvisier 40 sight head on its pivoting arm, the long control rod from the
// cradle; both platform halves beside and behind the drums with slatted boards, the wood-lined magazine
// rack of eight upright slots at each one's front edge, the loaders' small round seats at their outer rear
// corners; the optional shield (two
// side shields angled in front of the platforms, the small sight shield) fitted, rig.setShield(false) takes
// it off.
//
// Dimensions: trunnions 0.80 m above the ground on the triangle (bores 0.94 and 0.66 m), muzzles 1.71 m
// ahead of the trunnion axis (traverse circle 3.42 m), the front jacks 2.03 m apart with the pivot 0.65 m
// behind them and the rear jack 2.25 m behind them, 2.336 m across the loaders' seats, the eyepiece 1.03 m
// behind and 0.50 m above the trunnions, the layer's seat on a 1.305 m arc; recoil 85 mm per gun.
//
// Rig (front -Z, right +X, ground y = 0; on the tower the ground is the tower's foot):
//   pivots.turret     the upper carriage on its ring: rotation.y = traverse, + to the left, unlimited.
//                     (0, 0.2, 0) on the triangle; on the tower (0, 9.515, 0).
//   pivots.elevation  the trunnion axis, turret space (0, 0.6, 0) (0.80 m above the ground; on the tower
//                     0.915 m above the ring's foot, 10.115 m up). rotation.x = elevation, + raises the muzzles; -10 to
//                     +100 deg (-0.175 to 1.745).
//   pivots.gun0..3    each gun on its sleigh (elevation group), in the TM's order: 0 = 1L upper left,
//                     1 = 2R upper right, 2 = 3R lower right, 3 = 4L lower left. position.z = recoil;
//                     rig.setRecoil(i, m), 0 to 0.085. The right pedal fires 2R and 4L, the left 1L and 3R.
//   rig.setMagazine(i, on)  the magazine on gun i (off while a loader changes it); rig.setRack(n) the full
//                     magazines left in the two racks, 0 to 16 (12 after loading the guns).
//   anchors.muzzles   [4] at the flash hiders, gun order as above, -Z along the bores.
//   anchors.magazines [4] where each gun's magazine goes in (gun groups), +X/-X outboard.
//   anchors.sight     the Flakvisier's eyepiece (turret space, kept level), -Z along the line of sight.
//   anchors.eye       camera focus on the root.
//   anchors.crew      on the turret (riding on the platform): k1 layer (seated), k2 left loader and k3 right
//                     loader (on their seats), gf gun commander (standing on the rear of the left half);
//                     on the root: k4 range setter, k5 range-taker (outside the pit or by the tower's
//                     ladder head), k6 and k7 ammunition numbers.
//   setPaint('yellow' | 'grey'): Dunkelgelb by default.

const G = { trun: 0.6, dx: 0.337, dy: 0.14, muzzle: -1.71, rear: 0.54 };

// one Flak 38 gun along -Z in its own space: receiver, the barrel and flash hider, the magazine on the
// outboard side (side = +1: outboard is +X), the cocking handle; returns the magazine's vertex range start
function gun(P, side) {
  const m = (g, t = 0x7a7e82) => add(P, 'metal', g, t);
  // receiver (gun body) and its cover, the barrel sleeve with the recoil spring housing
  m(rbox(0.11, 0.13, 0.9, 0.02, 0, 0, 0.09), 0x6e7276);
  m(rbox(0.09, 0.03, 0.7, 0.01, 0, 0.075, 0.12), 0x7e8286);
  m(zTube(-0.36, -0.86, 0.034, 0.03, 14, 0, 0), 0x6e7276); // the barrel jacket with the recoil spring
  m(zTube(-0.86, -1.62, 0.019, 0.016, 12, 0, 0), 0x565a5e);
  m(zTube(-1.62, -1.71, 0.02, 0.03, 12, 0, 0), 0x50545a);
  m(new THREE.CircleGeometry(0.01, 8).applyMatrix4(xf(0, 0, -1.711, 0, Math.PI, 0)), 0x151515);
  m(box(0.03, 0.02, 0.06, -side * 0.07, 0.03, 0.3), 0x8a8e92); // cocking handle, inboard
  // the magazine: a flat box sticking out sideways, curving a little, 20 rounds in two staggered rows
  const start = P.lists.get('metal').length;
  const s = side;
  const mg = loft([[V(s * 0.055, -0.06, -0.08), V(s * 0.055, 0.06, -0.08), V(s * 0.055, 0.06, 0.04), V(s * 0.055, -0.06, 0.04)],
    [V(s * 0.355, -0.08, -0.065), V(s * 0.355, 0.04, -0.065), V(s * 0.355, 0.04, 0.025), V(s * 0.355, -0.08, 0.025)]], { crease: 0.4 });
  m(mg, 0x5a5e5a);
  return start;
}

// The mount above the base: everything on the ring; returns its pieces for the rig.
function mount(rig, mats, base, y0) {
  const root = rig.root;
  const tur = pivotAt(rig, root, 'turret', 0, y0, 0);
  const T = new Parts(mats);
  const paint = (g, t = 0xffffff) => add(T, 'paint', g, t);
  // the rotating ring with its azimuth scale band, the upper carriage's side plates and box
  paint(yTube(-0.02, 0.06, 0.42, 0.42, 28));
  add(T, 'white', yTube(0.03, 0.05, 0.425, 0.425, 28, 0, 0, true), 0xd8d4c4);
  // the upper carriage: its wide lower box under both drums (flakvierling_museum_09, _05), the two side
  // plates rising between the drums to the trunnion
  paint(rbox(0.86, 0.26, 0.82, 0.03, 0, 0.17, 0.02));
  paint(rbox(0.5, 0.12, 0.7, 0.03, 0, 0.34, 0.02), 0xdcdcdc);
  for (const s of [-1, 1]) paint(box(0.025, 0.56, 0.62, s * 0.11, 0.42, 0.0));
  // the equilibrator in its rounded housing low at the front, the deflector box for the spent cases under
  // it with the lid half open
  paint(xTube(-0.3, 0.3, 0.2, 0.2, 18, 0.36, -0.45));
  paint(rbox(0.5, 0.26, 0.3, 0.02, 0, 0.16, -0.5), 0xd8d8d8);
  paint(box(0.5, 0.015, 0.24, 0, 0.3, -0.68, -0.5, 0, 0), 0xd0d0d0);
  paint(rod(V(-0.28, 0.2, -0.66), V(-0.28, 0.44, -0.62), 0.015, 5), 0xd0d0d0);
  // the platform halves beside and behind the drums (flakvierling_museum_09): frames, slatted boards, the
  // magazine rack at each one's front edge just behind the drum, the fold-down footrests
  for (const s of [-1, 1]) {
    paint(box(0.06, 0.06, 1.15, s * 0.44, 0.08, 0.5), 0xd0d0d0);
    paint(box(0.06, 0.06, 1.15, s * 1.15, 0.08, 0.5), 0xd0d0d0);
    for (let i = 0; i < 6; i++) add(T, 'wood', box(0.7, 0.03, 0.12, s * 0.795, 0.125, 0.28 + i * 0.16), 0xc4b49a, 1);
    paint(box(0.32, 0.02, 0.1, s * 0.6, 0.0, 1.05), 0xc8c8c8);
    // the magazine rack: a wood-lined box of eight upright slots
    paint(rbox(0.7, 0.36, 0.22, 0.02, s * 0.8, 0.32, 0.08));
    for (let i = 0; i < 9; i++) add(T, 'wood', box(0.012, 0.32, 0.18, s * (0.47 + i * 0.083), 0.33, 0.08), 0xb8a68a, 1);
    // the loader's small round seat with a low back at the outer rear corner
    panSeat(T, 'paint', s * 1.08, 0.12, 0.95, 0.42, 0.12, true, Math.PI);
    // knee guards beside the layer's seat
    paint(rbox(0.04, 0.3, 0.3, 0.02, s * 0.26, 0.45, 1.05, 0, s * 0.3, 0), 0xd0d0d0);
  }
  // the layer's seat on the toothed post (on the 1.3 m arc), its curved back rest, the firing pedals, the
  // gear column with the elevating gear box on his right, the sight bracket's pivot over it
  paint(rod(V(0, 0.14, 0.35), V(0, 0.42, 1.25), 0.03, 8), 0xd0d0d0);
  panSeat(T, 'paint', 0, 0.12, 1.25, 0.42, 0.16, false);
  paint(new THREE.TorusGeometry(0.2, 0.025, 6, 16, Math.PI).applyMatrix4(xf(0, 0.78, 1.4, Math.PI / 2 + 0.2, 0, 0)), 0xdedede);
  paint(box(0.4, 0.2, 0.03, 0, 0.7, 1.41, 0.2, 0, 0), 0xdedede);
  for (const s of [-1, 1]) add(T, 'black', box(0.1, 0.02, 0.16, s * 0.12, 0.2, 0.85));
  paint(rbox(0.16, 0.42, 0.14, 0.02, 0.0, 0.72, 0.78), 0xd8d8d8);
  paint(rod(V(0, 0.5, 0.3), V(0, 0.62, 0.72), 0.04, 8), 0xd8d8d8);
  paint(rbox(0.12, 0.18, 0.16, 0.02, 0.22, 0.78, 0.82), 0xd8d8d8);
  paint(rbox(0.16, 0.12, 0.1, 0.02, 0.0, 0.97, 0.85), 0xd8d8d8);
  // the battery box for the sight's lamp on the rear plate
  paint(rbox(0.16, 0.12, 0.1, 0.02, 0.24, 0.92, 0.9), 0xc8c8c8);
  // the shield: two side plates angled in front of the platforms, the small sight shield (setShield)
  const S = new Parts(mats);
  for (const s of [-1, 1]) {
    add(S, 'paint', box(0.78, 0.82, 0.008, s * 0.82, 0.62, -0.28, 0, s * 0.35, 0));
    add(S, 'paint', box(0.02, 0.82, 0.04, s * 0.45, 0.62, -0.16), 0xd0d0d0);
    for (const y of [0.35, 0.85]) add(S, 'paint', rod(V(s * 0.6, y, -0.2), V(s * 0.6, y - 0.2, -0.02), 0.012, 5), 0xd0d0d0);
  }
  add(S, 'paint', box(0.34, 0.3, 0.006, 0, 1.0, 0.72, -0.3, 0, 0));
  const shield = new THREE.Group();
  shield.name = 'shield';
  tur.add(shield);
  build(S, shield, y0 + 0.5, 0);
  build(T, tur, y0, 0.12);
  // spare magazines standing lips down in the racks, eight a side (setRack shows the first n)
  const Rk = new Parts(mats);
  for (const s of [1, -1]) for (let i = 0; i < 8; i++) add(Rk, 'metal', box(0.07, 0.28, 0.13, s * (0.51 + i * 0.083), 0.37, 0.08), 0x5a5e5a, 0);
  const [rackM] = build(Rk, tur, y0, 0);
  const rackV = rackM.geometry.attributes.position.count / 16;

  // handwheels: elevation (vertical, on the right), traverse (slanting in front of the layer)
  const hwE = node(tur, 'wheelEl', 0.31, 0.78, 0.86), hwT = node(tur, 'wheelTr', 0.0, 0.85, 0.92);
  hwT.rotation.x = -0.6;
  wheelSet(root, [[hwE, xf(0, 0, 0, 0, Math.PI / 2, 0)], [hwT, xf(0, 0, 0, Math.PI / 2, 0, 0)]].map(([node, M]) => ({ node, M, R: 0.11 })), mats.metal);

  // ---- the cradle: two drums joined across the middle, between and outside the side plates
  const el = pivotAt(rig, tur, 'elevation', 0, G.trun, 0);
  const E = new Parts(mats);
  for (const s of [-1, 1]) {
    add(E, 'paint', xTube(s * 0.125, s * 0.28, 0.3, 0.3, 30, 0, 0));
    add(E, 'paint', xTube(s * 0.28, s * 0.29, 0.26, 0.26, 26, 0, 0), 0xdcdcdc);
    // the sleighs on the drum covers that carry the guns
    for (const y of [G.dy, -G.dy]) add(E, 'paint', box(0.03, 0.08, 0.7, s * 0.295, y, -0.05), 0xd0d0d0);
  }
  add(E, 'paint', box(0.25, 0.22, 0.3, 0, 0.0, -0.12), 0xe0e0e0);
  add(E, 'paint', rod(V(0.24, 0.25, 0.1), V(0.12, 0.38, 0.8), 0.008, 4), 0xd0d0d0); // the control rod to the sight arm
  build(E, el, y0 + G.trun, 0);
  // the four guns on their sleighs
  const guns = [], mags = [];
  const spots = [[-G.dx, G.dy, -1], [G.dx, G.dy, 1], [G.dx, -G.dy, 1], [-G.dx, -G.dy, -1]];
  spots.forEach(([x, y, side], i) => {
    const g = pivotAt(rig, el, 'gun' + i, x, y, 0);
    const Gp = new Parts(mats);
    const mStart = gun(Gp, side);
    const list = Gp.lists.get('metal');
    let vBefore = 0;
    for (let k = 0; k < mStart; k++) vBefore += list[k].attributes.position.count;
    const [mesh] = build(Gp, g, y0 + G.trun, 0).filter((mm) => mm.name === 'metal');
    guns.push(g);
    mags.push({ mesh, from: vBefore, all: mesh.geometry.attributes.position.count });
    rig.anchors.muzzles.push(node(g, 'muzzle' + i, 0, 0, G.muzzle));
  });
  rig.anchors.magazines = spots.map(([x, y, side], i) => node(guns[i], 'magazine' + i, side * 0.06, 0, -0.02));

  // ---- the sight: its arm follows the cradle through the control rod, the head stays level
  const arm = node(tur, 'sightArm', 0.0, 0.97, 0.85);
  const head = node(arm, 'sightHead', 0, 0.12, 0.15);
  const Sh = new Parts(mats);
  add(Sh, 'paint', rbox(0.18, 0.14, 0.22, 0.02, 0, 0.0, 0.0), 0xd8d8d8);
  add(Sh, 'glass', box(0.14, 0.1, 0.004, 0, 0.11, -0.02, -0.75, 0, 0)); // the reflector glass at 45 deg
  add(Sh, 'paint', box(0.16, 0.02, 0.12, 0, 0.07, -0.02), 0xd0d0d0);
  add(Sh, 'black', zTube(0.11, 0.15, 0.025, 0.03, 10, 0, 0.02)); // rubber eyecup of the telescope
  add(Sh, 'black', yTube(0.07, 0.1, 0.018, 0.018, 8, 0.08, -0.06)); // correction knob
  build(Sh, head, y0 + 1.2, 0);
  const Sa = new Parts(mats);
  add(Sa, 'paint', box(0.03, 0.03, 0.3, 0, 0.06, 0.05), 0xd0d0d0);
  build(Sa, arm, y0 + 1.1, 0);
  arm.updateMatrix = function () { this.rotation.x = el.rotation.x * 0.35; THREE.Object3D.prototype.updateMatrix.call(this); };
  head.updateMatrix = function () { this.rotation.x = -el.rotation.x * 0.35; THREE.Object3D.prototype.updateMatrix.call(this); };
  hwE.updateMatrix = function () { this.rotation.x = -(el.rotation.x / (4 * DEG)) * Math.PI * 2; THREE.Object3D.prototype.updateMatrix.call(this); };
  hwT.updateMatrix = function () { this.rotation.y = (tur.rotation.y / (7.5 * DEG)) * Math.PI * 2; THREE.Object3D.prototype.updateMatrix.call(this); };

  rig.anchors.sight = node(head, 'eyepiece', 0, 0.02, 0.16);
  const P0 = 0.14;
  rig.anchors.crew = {
    k1: crewSpot(tur, 'k1', 0, 0.54, 1.25, 0, { label: 'K1 layer (seated, both handwheels, the pedals)', pose: 'sit', seated: true, hands: V(0.0, 0.85, 0.92) }),
    k2: crewSpot(tur, 'k2', -1.08, 0.54, 0.95, -30, { label: 'K2 left loader (guns 1L and 4L)', pose: 'sit', seated: true }),
    k3: crewSpot(tur, 'k3', 1.08, 0.54, 0.95, 30, { label: 'K3 right loader (guns 2R and 3R)', pose: 'sit', seated: true }),
    gf: crewSpot(tur, 'gf', -0.75, P0, 0.6, 20, { label: 'Geschuetzfuehrer (on the rear of the left platform half)', pose: 'stand' }),
  };
  const st = { rack: 12 };
  rig.setRecoil = (i, m) => { const g = guns[i]; if (g) g.position.z = Math.min(0.085, Math.max(0, m)); };
  rig.setMagazine = (i, on) => { const q = mags[i]; if (q) q.mesh.geometry.setDrawRange(0, on ? q.all : q.from); };
  rig.setRack = (n) => { st.rack = Math.max(0, Math.min(16, n | 0)); rackM.geometry.setDrawRange(0, st.rack * rackV); };
  rig.setShield = (on) => { shield.visible = !!on; };
  rig.setRack(12);
  return { tur, el };
}

// the triangular lower carriage: the front jacks 2.03 m apart 0.65 m ahead of the pivot, the rear one
// 2.25 m behind them; box arms, the side eyes for the trailer's hooks, the carrier pin at the rear
function triangle(P) {
  const paint = (g, t = 0xffffff) => add(P, 'paint', g, t);
  const feet = [[-1.015, -0.65], [1.015, -0.65], [0, 1.6]];
  paint(yTube(0.05, 0.16, 0.5, 0.5, 24));
  for (const [x, z] of feet) {
    const L = Math.hypot(x, z), a = Math.atan2(x, z);
    paint(loft([[V(-0.14, 0.04, 0.3), V(0.14, 0.04, 0.3), V(0.14, 0.17, 0.3), V(-0.14, 0.17, 0.3)], [V(-0.08, 0.07, L), V(0.08, 0.07, L), V(0.08, 0.16, L), V(-0.08, 0.16, L)]], { crease: 0.5 }).applyMatrix4(xf(0, 0, 0, 0, a, 0)));
    paint(yTube(0.0, 0.025, 0.12, 0.12, 14, x, z), 0xbdbdbd);
    add(P, 'metal', yTube(0.025, 0.1, 0.024, 0.024, 8, x, z));
    paint(yTube(0.09, 0.3, 0.045, 0.04, 10, x, z));
    add(P, 'metal', box(0.18, 0.015, 0.02, x + 0.07, 0.31, z));
  }
  for (const s of [-1, 1]) add(P, 'metal', new THREE.TorusGeometry(0.05, 0.015, 5, 10).applyMatrix4(xf(s * 0.62, 0.13, -0.38, 0, Math.PI / 2, 0)), 0xa0a0a0);
  add(P, 'metal', zTube(1.7, 1.82, 0.03, 0.03, 8, 0, 0.12), 0xa0a0a0);
  add(P, 'glass', yTube(0.16, 0.18, 0.04, 0.04, 12, 0, 1.2));
}

export function buildFlakvierling() {
  const rig = newRig('green');
  const mats = flakMats('yellow');
  rig.mats = mats;
  const root = rig.root, rnd = mulberry32(38);
  // ---- the pit: sandbag parapet with earth banked outside, the niche on the left, entrance at the rear
  const emp = new THREE.Group();
  emp.name = 'emplacement';
  root.add(emp);
  rig.emplacement = emp;
  const P = new Parts(mats);
  const R = 2.9;
  ringBank(P, { R: R + 0.3, H: 0.55, bank: 1.4, crown: 0.3, seg: 36, gaps: [[Math.PI, 0.3]], rnd, inner: 0.05 });
  // a ring of sandbags, three courses, round the inside of the bank
  const nb = 30;
  for (let i = 0; i < nb; i++) {
    const a = ((i + 0.5) / nb) * Math.PI * 2;
    if (Math.abs(Math.atan2(Math.sin(a - Math.PI), Math.cos(a - Math.PI))) < 0.3) continue;
    for (let r = 0; r < 3; r++) {
      const aa = a + (r % 2) * (Math.PI / nb), x = Math.sin(aa) * R, z = -Math.cos(aa) * R;
      add(P, 'sand', sandbag([0.6, 0.16, 0.34], rnd).applyMatrix4(xf(x, 0.08 + r * 0.15, z, 0, -aa + (rnd() - 0.5) * 0.08, 0)), 0xffffff, 0.5);
    }
  }
  floorDisc(P, R, 0.004);
  // the ammunition niche on the left: boxes under a plank roof on sandbag walls
  for (let i = 0; i < 4; i++) add(P, 'wood', rbox(0.46, 0.2, 0.32, 0.02, -R - 0.55 + (i % 2) * 0.05, 0.1 + Math.floor(i / 2) * 0.21, -0.25 + (i % 2) * 0.45), 0x8f9a6a, 1);
  for (let i = 0; i < 6; i++) add(P, 'wood', box(1.0, 0.04, 0.2, -R - 0.55, 0.55, -0.55 + i * 0.2), 0xc8bca8, 1);
  sandbagWall(P, -0.5, 0.5, 0, 3, { ry: Math.PI / 2, ox: -R - 1.1, oz: 0, rnd });
  build(P, emp, 0, 0.3);
  const X = new Parts(mats);
  triangle(X);
  build(X, root, 0, 0.3);
  mount(rig, mats, 'triangle', 0.2);
  rig.anchors.eye = node(root, 'eye', 0, 1.0, 0.4);
  rig.anchors.crew.k4 = crewSpot(root, 'k4', 1.6, 0, 1.2, -40, { label: 'K4 range setter', pose: 'stand' });
  rig.anchors.crew.k5 = crewSpot(root, 'k5', 3.6, 0, 3.0, -30, { label: 'K5 range-taker with the 1 m rangefinder, outside the pit', pose: 'rangefinder' });
  rig.anchors.crew.k6 = crewSpot(root, 'k6', -2.1, 0, 0.6, -100, { label: 'K6 ammunition number', pose: 'carry' });
  rig.anchors.crew.k7 = crewSpot(root, 'k7', -2.0, 0, -0.7, -80, { label: 'K7 ammunition number', pose: 'carry' });
  hb(rig, -1.2, 0, -0.9, 1.2, 1.3, 1.7);
  finish(rig, root);
  return rig;
}

// The wooden flak tower: four log poles battered in a little, cross-braced, the ammunition platform at
// 7 m (open at the sides), the gun platform at 9 m with a 1 m plank wall 0.18 m thick, a ladder.
export const TOWER = { h: 9.0, ammo: 7.0, half: 2.6 };
function tower(P, rnd) {
  const { h, ammo, half } = TOWER;
  const top = half - 0.2, foot = half + 0.5;
  const poles = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  const at = (sx, sz, y) => { const k = y / h, r = foot + (top - foot) * k; return V(sx * r, y, sz * r); };
  for (const [sx, sz] of poles) {
    add(P, 'wood', tubeAB(at(sx, sz, -0.2), at(sx, sz, h + 0.05), 0.17, 0.14, 9), 0xb9a88e, 1);
    add(P, 'sand', box(0.7, 0.4, 0.7, at(sx, sz, 0).x, 0.1, at(sx, sz, 0).z), 0x9a9a8a, 0.5); // foot stone
  }
  // cross bracing on all four faces in two tiers, horizontal ties
  for (let f = 0; f < 4; f++) {
    const [ax, az] = poles[f], [bx, bz] = poles[(f + 1) % 4];
    for (const [y0, y1] of [[0.4, ammo - 0.2], [ammo - 0.2, h - 0.15]]) {
      add(P, 'wood', tubeAB(at(ax, az, y0), at(bx, bz, y1), 0.07, 0.07, 7), 0xc4b398, 1);
      add(P, 'wood', tubeAB(at(bx, bz, y0), at(ax, az, y1), 0.07, 0.07, 7), 0xc4b398, 1);
      add(P, 'wood', tubeAB(at(ax, az, y0), at(bx, bz, y0), 0.08, 0.08, 7), 0xc4b398, 1);
    }
  }
  // the ammunition platform (planks on joists), open at the sides, boxes on it
  const plank = (y, w, tint) => { for (let i = 0; i < Math.round(w / 0.2); i++) add(P, 'wood', box(w, 0.05, 0.19, 0, y, -w / 2 + 0.1 + i * 0.2), tint, 1); };
  plank(ammo, 2 * (foot + (top - foot) * (ammo / h)) + 0.3, 0xcbbca4);
  for (let i = 0; i < 6; i++) add(P, 'wood', rbox(0.46, 0.2, 0.32, 0.02, -1.2 + (i % 3) * 0.5, ammo + 0.13 + Math.floor(i / 3) * 0.21, 1.0), 0x8f9a6a, 1);
  // the gun platform: deck, the 1 m wall of double planking with a sand fill (0.18 m), its cap
  const w = 2 * top + 0.6;
  plank(h, w, 0xd2c4ab);
  for (const [cx, cz, lx, lz] of [[0, -w / 2 + 0.09, w, 0.18], [0, w / 2 - 0.09, w, 0.18], [-w / 2 + 0.09, 0, 0.18, w - 0.36], [w / 2 - 0.09, 0, 0.18, w - 0.36]]) {
    for (let k = 0; k < 5; k++) add(P, 'wood', box(lx, 0.19, lz, cx, h + 0.12 + k * 0.2, cz), k % 2 ? 0xc8b99f : 0xd6c8ae, 1);
    add(P, 'wood', box(lx + (lx > 1 ? 0.04 : 0), 0.05, lz + (lz > 1 ? 0.04 : 0), cx, h + 1.06, cz), 0xbfb09a, 1);
  }
  // the hatch's ladder up the rear face from the ground to the ammunition platform and on to the gun deck
  for (const [y0, y1, z] of [[0, ammo, foot + 0.35], [ammo, h, top - 0.4]]) {
    for (const s of [-1, 1]) add(P, 'wood', tubeAB(V(s * 0.25, y0, z), V(s * 0.25, y1 + 0.9, z - 0.25), 0.035, 0.035, 6), 0xc8b89c, 1);
    for (let y = y0 + 0.3; y < y1 + 0.8; y += 0.3) add(P, 'wood', xTube(-0.25, 0.25, 0.022, 0.022, 6, y, z - ((y - y0) / (y1 + 0.9 - y0)) * 0.25), 0xc8b89c, 0);
  }
  // the fixed receiving ring on its timber bearers
  for (const x of [-0.6, 0.6]) add(P, 'wood', box(0.2, 0.18, 2.2, x, h + 0.115, 0), 0xb0a088, 1);
  add(P, 'paint', yTube(h + 0.2, h + 0.315, 0.41, 0.41, 24));
  add(P, 'paint', yTube(h + 0.315, h + 0.5, 0.36, 0.38, 24), 0xd8d8d8); // the mount's base on the ring
}

export function buildFlakvierlingTower() {
  const rig = newRig('green');
  const mats = flakMats('yellow');
  rig.mats = mats;
  const root = rig.root, rnd = mulberry32(39);
  const emp = new THREE.Group();
  emp.name = 'emplacement';
  root.add(emp);
  rig.emplacement = emp;
  const P = new Parts(mats);
  tower(P, rnd);
  build(P, emp, 0, 0.1);
  const y0 = TOWER.h + 0.515; // on the fixed ring: the trunnions 0.915 m above the ring's foot (fig. 5)
  mount(rig, mats, 'ring', y0);
  rig.anchors.eye = node(root, 'eye', 0, TOWER.h + 1.2, 0.4);
  const D = TOWER.h + 0.03;
  rig.anchors.crew.k4 = crewSpot(root, 'k4', 1.5, D, 1.5, -40, { label: 'K4 range setter (gun deck)', pose: 'stand' });
  rig.anchors.crew.k5 = crewSpot(root, 'k5', -1.6, D, 1.6, 30, { label: 'K5 range-taker with the 1 m rangefinder (gun deck)', pose: 'rangefinder' });
  rig.anchors.crew.k6 = crewSpot(root, 'k6', 0.8, TOWER.ammo + 0.03, 0.6, 180, { label: 'K6 ammunition number (ammunition platform)', pose: 'carry' });
  rig.anchors.crew.k7 = crewSpot(root, 'k7', 0, 0, TOWER.half + 1.4, 180, { label: 'K7 ammunition number (at the ladder foot)', pose: 'carry' });
  hb(rig, -TOWER.half - 0.4, 0, -TOWER.half - 0.4, TOWER.half + 0.4, TOWER.h + 1.1, TOWER.half + 0.4);
  hb(rig, -1.2, TOWER.h, -1.9, 1.2, TOWER.h + 2.3, 1.5);
  finish(rig, root);
  return rig;
}

function finish(rig, root) {
  let paint = 'yellow';
  paintCarrier(root);
  rig.setPaint = (s) => { if (s !== paint && (s === 'grey' || s === 'yellow')) { paint = s; setPaint(root, s); } };
}
