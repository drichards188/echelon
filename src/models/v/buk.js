import * as THREE from 'three';
import { V, DEG, box, rbox, yTube, zTube, xTube, rod, loft, lathe, xf, plane, scaleUV, Parts, vehicleMats } from '../kit.js';
import { node, newRig, pivotAt, hb } from '../rig.js';
import { GM569, GM577, GM_SCALE as K, scaleParts, addChassis, addTravelLock, addTravelLockTop } from './gm569.js';

// Buk-M2: the 9A317 TELAR (GM-569 chassis) and the 9A316 loader-launcher (GM-577), and the 9M317
// missile. References: refs/buk/README.md and photos (side: m2-telar-9a317-parade-rehearsal-kuzmin,
// m2-telar-captured-prague-02; top: m2-telar-9a317-moscow2015, m2-loader-9a316-moscow2015; raised
// launcher: m2-telar-maks2007; loader: m2-loader-9a316-parade-rehearsal-kuzmin, -kozlovskiy,
// m2-telar-sokolrus (a loaded 9A316, despite its name), m1-loader-9a39m1-kuzmin-2012).
//
// Both vehicles are built in the in-action convention: turret rotation.y = 0 points the launcher
// (missile noses) forward over the front of the hull. On the road the real vehicles carry the
// turret reversed (rotation.y = PI): noses to the rear, the launcher's tail end and blast plates
// over the glacis, held by the travel lock.
//
// Pivots and anchors (all rotations in radians, three.js Euler about the pivot's local axis):
//   turret       rotation.y about the turret ring; 0 = launcher forward, + = turns left, any value
//                (PI = travel). TELAR ring 0.75 m ahead of mid-hull, loader 0.64 m (deck 2.08 m).
//   elevation    rotation.x about the launcher trunnion at the turret's tail end (+Z end); + raises
//                the -Z end (the noses). 0 = level (travel, loading), up to about 1.2 (69 deg); the
//                photos show about 65 deg in action. The blast plates under the missile tails hang
//                when it is level and fold up toward the tails as it rises (by 0.6), so they clear
//                the hull deck with the turret facing forward.
//   crane        (loader) rotation.y slew about the crane post, 0.3 m off the turret's centre line
//                2.5 m behind the ring (-Z), between the inner rack rounds; 0 = boom pointing -Z
//                (travel: over the rear deck when the turret is reversed); any value; + swings
//                the boom to the turret's left.
//   craneBoom    (loader) rotation.x luff about the hinge on top of the post; + raises the tip.
//                0 = level; travel 0.18 (as photographed); about -0.5 (down 30 deg) to 1.2.
//   craneJib     (loader) rotation.x of the outer jib about the boom tip; 0 = straight on from the
//                boom, + raises it; travel -2.36 (folded down and back toward the post, as on
//                the photos), working range about -1.6 to 0.4.
//   craneExt     (loader) the jib's two telescopic inner sections (reconstructed), slid out along
//                the jib's -Z by rig.setCraneExt(m), 0 (in, travel) to rig.craneExtMax (2 m); the
//                hoist rides on the inner one.
//   craneHoist   (loader) frame at the jib tip (the inner section's tip), kept level (it undoes the
//                boom's and jib's luff itself; it turns with the slew). Do not set its rotation.
//   anchors.craneHook  (loader) child of craneHoist: the lifting beam with its slings. Its
//                position.y (<= -0.6) is the hoist drop below the jib tip (travel -0.6; the cable
//                follows); rotation.y may turn the load. A lifted missile parented to it with an
//                identity transform hangs in the slings level, nose toward the hook's -Z.
//   anchors.eye        camera focus over the hull centre.
//   anchors.missileSlots  Object3Ds at the missile centres (the 9M317 model's origin), -Z the
//                nose. TELAR: 0..3 on the launcher in launch order (outer right, outer left, inner
//                right, inner left). Loader: 0..3 the same on its launcher, 4..7 the transport
//                rack (outer right, outer left, inner right, inner left).
//   setLoaded(i, loaded)  shows or hides missile i (one draw call per launcher/rack: a hidden
//                round is collapsed to a point).
//   setDeploy(v)  0 travel .. 1 in action: moves the travel lock only (a post from the front ledge
//                up to the launcher's tail end; from 0 to 0.5 its top telescopes down, from 0.5
//                to 1 it folds flat to the right along the ledge). Built at 1. The 9S36 mast
//                the reference sheet puts on the 9A317 is not modelled: no photo shows it, and
//                the photographed hulls carry no stowed mast. No trackRadar pivot: the 9A317's
//                array is fixed in the turret under the housing at its -Z end.

// Wings and fins in X (0.86 m wing span as quoted for the 9M38; the side photos show the panels
// above and below the body). The body reads 0.36 m across against its 5.55 m length in
// moscow2015 (the 0.36 of the naval 9M317M), not 0.4.
const MISSILE = { L: 5.55, r: 0.18, wingTip: 0.44, finTip: 0.41, roll: 0 };

const GREEN = 0x3f6a36, NOSE = 0xffffff, FIN = 0xb4b8b6, BAND = 0x2a2c2a, SILVER = 0x9fa3a3, JOINT = 0x426b31;

// The Buk's paint is a darker, cooler green than the shared 'green' scheme (parade photos): the
// painted meshes take a vertex tint.
function bukPaint(meshes, k = [0.62, 0.65, 0.84]) {
  for (const m of meshes) if (m.name === 'camo' || m.name === 'paint') {
    const c = m.geometry.attributes.color;
    for (let i = 0; i < c.count; i++) c.setXYZ(i, c.getX(i) * k[0], c.getY(i) * k[1], c.getZ(i) * k[2]);
  }
  return meshes;
}

// Small assemblies are drawn as one mesh: their black steel and bare metal bits move into the
// painted set with a darker or lighter vertex tint (one draw call per pivot instead of three).
function onePaint(Pa, tints = { dark: 0.32, steel: 0.8, white: 1.6 }) {
  const camo = Pa.lists.get('camo') || [];
  for (const k of [...Pa.lists.keys()]) {
    const t = tints[k];
    if (t === undefined) continue;
    for (const g of Pa.lists.get(k)) {
      const c = g.attributes.color;
      for (let i = 0; i < c.count; i++) c.setXYZ(i, c.getX(i) * t, c.getY(i) * t, c.getZ(i) * t);
      camo.push(g);
    }
    Pa.lists.delete(k);
  }
  Pa.lists.set('camo', camo);
  return Pa;
}

// ---------------------------------------------------------------- 9M317

// Fin panel in the plane through the axis, root at radius r0, tip at r1; z values along the axis
// (nose -Z). Rotated about the axis to angle phi (from +X toward +Y).
function finPanel(r0, r1, zLE0, zTE0, zLE1, zTE1, t, phi) {
  const s = new THREE.Shape([new THREE.Vector2(r0, zLE0), new THREE.Vector2(r1, zLE1), new THREE.Vector2(r1, zTE1), new THREE.Vector2(r0, zTE0)]);
  const g = new THREE.ExtrudeGeometry(s, { depth: t, bevelEnabled: false });
  g.translate(0, 0, -t / 2);
  g.rotateX(Math.PI / 2); // shape y -> z, thickness -> y
  g.rotateZ(phi);
  return g;
}

// The 9M317 into a parts collector, placed by the matrix m4 (front -Z, origin at the missile's
// centre). One material: the satin white set tinted green for the body, white radome, grey fins.
export function addMissile9M317(P, m4 = new THREE.Matrix4(), key = 'white', seg = 16) {
  const H = MISSILE.L / 2, R = MISSILE.r, rf = 0.165;
  const put = (g, tint) => P.add(key, g.applyMatrix4(m4), { tint });
  const alongZ = (pts, n = seg) => lathe(pts.map(([r, y]) => [Math.max(r, 0.002), y]), n).rotateX(-Math.PI / 2); // lathe y -> -z
  // radome: tangent ogive, 0.9 m long, the silver ring and the black band behind it
  const Ln = 0.9, rho = (rf * rf + Ln * Ln) / (2 * rf), nose = [];
  for (let i = 0; i <= 8; i++) { const x = (Ln * i) / 8; nose.push([Math.sqrt(rho * rho - (Ln - x) ** 2) + rf - rho, H - x]); }
  nose[0][0] = 0.002;
  put(alongZ(nose.reverse()), NOSE);
  put(alongZ([[rf + 0.003, H - Ln - 0.03], [rf + 0.003, H - Ln]]), SILVER);
  put(alongZ([[rf + 0.002, H - Ln - 0.09], [rf + 0.002, H - Ln - 0.03]]), BAND);
  // seeker and warhead sections, a little slimmer; the motor section; the tail
  put(alongZ([[0.17, -H], [0.176, -H + 0.1], [R, -H + 0.2], [R, 0.95], [rf, 1.05], [rf, H - Ln - 0.09], [0.002, H - Ln - 0.09]]), GREEN);
  put(alongZ([[0.002, -H + 0.09], [0.125, -H + 0.09], [0.125, -H], [0.17, -H]], 12), BAND); // nozzle
  for (const y of [H - 1.32, 0.95, -0.55, -1.75]) put(alongZ([[(y > 1 ? rf : R) + 0.006, y - 0.025], [(y > 1 ? rf : R) + 0.006, y + 0.025]]), JOINT);
  // cable raceway along the top
  put(box(0.05, 0.03, 2.9, 0, R + 0.012, 0.3), GREEN);
  // four clipped-delta wings in X, and the tail control fins behind them
  const z = (fromNose) => -H + fromNose;
  for (let k = 0; k < 4; k++) {
    const phi = Math.PI / 4 + MISSILE.roll + (k * Math.PI) / 2;
    put(finPanel(R - 0.01, MISSILE.wingTip, z(2.5), z(4.05), z(3.0), z(3.93), 0.018, phi), FIN);
    put(finPanel(R - 0.01, MISSILE.finTip, z(4.98), z(5.47), z(5.24), z(5.5), 0.014, phi), FIN);
  }
}

// One 9M317 as a group (one mesh), front -Z, origin at its centre: for the in-flight model.
export function buildMissile9M317(mats = vehicleMats('green')) {
  const g = new THREE.Group();
  g.name = '9M317';
  const P = new Parts(mats);
  addMissile9M317(P);
  P.build(g, { shadow: true });
  return g;
}

// Missiles at the given centres (parent space) merged into one mesh; returns setLoaded(i, on),
// which collapses a hidden round to its centre so the set stays one draw call.
function missileSet(mats, parent, centres, y0) {
  const M = new Parts(mats);
  for (const [x, y, z] of centres) addMissile9M317(M, xf(x, y, z));
  const [mesh] = M.build(parent, { y0 });
  mesh.name = 'missiles';
  const pos = mesh.geometry.attributes.position, per = pos.count / centres.length, orig = pos.array.slice();
  return (i, on) => {
    if (!(i >= 0 && i < centres.length)) return;
    const a = pos.array, [x, y, z] = centres[i];
    for (let v = i * per; v < (i + 1) * per; v++) {
      a[v * 3] = on ? orig[v * 3] : x;
      a[v * 3 + 1] = on ? orig[v * 3 + 1] : y;
      a[v * 3 + 2] = on ? orig[v * 3 + 2] : z;
    }
    pos.needsUpdate = true;
  };
}

// ---------------------------------------------------------------- launcher (shared)

// Elevation space: origin on the trunnion, missiles level toward -Z. The rails carry the rounds
// with their axes 0.6 m over the trunnion and their tails 0.32 m behind it (in metres: the
// launcher is not scaled with the hull, the rounds are 5.55 m). Spacing 0.69 m: solved with the
// camera from m2-telar-9a317-moscow2015 (0.675) and m2-loader-9a316-moscow2015 (0.70).
const LX = [1.035, -1.035, 0.345, -0.345]; // missile x in launch order
const LA = { axis: 0.6, rail: 0.28, tail: 0.32, frame0: 0.45, frame1: -2.9, beam: 0.69 };

// a tubular frame (rod path through points) into P
function tubeRail(P, key, pts, r = 0.022) { for (let i = 0; i < pts.length - 1; i++) P.add(key, rod(pts[i], pts[i + 1], r, 6)); }

// opts.beam: x of the main beams; opts.low: the cross frames and rail posts under the rounds (the
// loader leaves them off: its rack rounds lie under the launcher)
function launcherBody(E, { beam: bx = LA.beam, low = true } = {}) {
  const { axis, rail: ry, frame0: f0, frame1: f1 } = LA;
  E.add('dark', xTube(-1.0, 1.0, 0.07, 0.07, 12, 0, 0)); // trunnion shaft
  for (const s of [-1, 1]) {
    E.add('camo', rbox(0.16, 0.2, f0 - f1, 0.03, s * bx, -0.02, (f0 + f1) / 2)); // main beams
    E.add('camo', rbox(0.22, 0.3, 0.42, 0.04, s * bx, 0.0, 0.05)); // trunnion hubs
    // long rods between the pairs at the rails' height, a hooked end at the tail
    E.add('steel', zTube(f0 + 0.15, -4.1, 0.035, 0.035, 8, s * LA.beam, ry + 0.06), { tint: 0x8a9080 });
    for (const z of [0.4, -1.4, -2.75]) E.add('camo', box(0.06, ry, 0.08, s * (LA.beam + bx) / 2, ry / 2, z));
    E.add('dark', box(0.08, 0.12, 0.14, s * LA.beam, ry + 0.1, f0 + 0.17));
  }
  for (const z of low ? [0.3, -1.35, -2.8] : [0.3]) E.add('camo', box(2.24, 0.12, 0.12, 0, -0.02, z));
  for (const x of LX) {
    // rail under each round, three shoes, the tail retainer with its connector and label plate
    E.add('camo', box(0.1, 0.12, 3.0, x, ry, -1.35));
    for (const z of [-0.25, -1.35, -2.6]) E.add('dark', box(0.08, axis - 0.18 - ry - 0.04, 0.16, x, (axis - 0.18 + ry + 0.06) / 2, z));
    for (const z of low ? [0.3, -1.35, -2.8] : [0.3]) E.add('camo', box(0.08, ry, 0.08, x, ry / 2, z));
    E.add('camo', rbox(0.34, 0.66, 0.55, 0.04, x, 0.06, 0.33));
    E.add('camo', box(0.3, 0.06, 0.3, x, 0.4, 0.45, -0.5), { tint: 0xc4c4c4 }); // sloped top
    E.add('white', box(0.12, 0.012, 0.08, x, 0.395, 0.2), { tint: 0xdedcd0 });
    E.add('dark', zTube(0.6, 0.66, 0.06, 0.06, 10, x, 0.0));
    E.add('dark', box(0.03, 0.14, 0.04, x + 0.19, 0.05, 0.4)); // handle
  }
  // tubular guard frames on both sides at the tail end, their tops a little over the rounds
  for (const s of [-1, 1]) {
    const x = s * 1.42, t = axis + 0.3;
    tubeRail(E, 'camo', [V(x, -0.05, 0.42), V(x, t - 0.1, 0.42), V(x, t, 0.32), V(x, t, -0.4), V(x, t - 0.1, -0.5), V(x, -0.05, -0.5)], 0.024);
    for (const z of [0.42, -0.5]) E.add('camo', box(Math.abs(x) - bx, 0.06, 0.06, s * (bx + Math.abs(x)) / 2, -0.05, z));
  }
}

// Blast plates: a perforated (honeycomb) plate in a heavy frame behind each round's tail, hinged
// under its retainer and held by a stay; built in a group whose origin is the hinge line, hanging
// `droop` (rad) below the turret's frame when the launcher is level: 55 deg on the TELAR, 15 deg on
// the loader (shots/buk/plates-evidence.png collects the photos). Seen in m2-telar-captured-prague-03 and -05, m2-telar-9a317-moscow2015 (under the tails)
// and m2-loader-9a316-parade-rehearsal-kuzmin.
function blastPlates(mats, el, y0, droop) {
  const g = new THREE.Group();
  g.name = 'blastPlates';
  g.position.set(0, -0.2, 0.64);
  el.add(g);
  const B = new Parts(mats), Lp = 0.72, W = 0.54;
  for (const x of LX) {
    B.add('camo', box(W, 0.07, 0.07, x, 0, Lp - 0.035));
    for (const s of [-1, 1]) B.add('camo', box(0.07, 0.09, Lp, x + s * (W / 2 - 0.035), 0, Lp / 2));
    const p = plane(W - 0.12, Lp - 0.1, x, 0.012, Lp / 2, -Math.PI / 2, 0, 0);
    scaleUV(p, (W - 0.12) / 0.07, (Lp - 0.1) / 0.07);
    B.add('array', p, { tint: new THREE.Color(1.25, 1.35, 1.05) });
    const p2 = plane(W - 0.12, Lp - 0.1, x, -0.012, Lp / 2, Math.PI / 2, 0, 0);
    scaleUV(p2, (W - 0.12) / 0.07, (Lp - 0.1) / 0.07);
    B.add('array', p2, { tint: new THREE.Color(1.1, 1.2, 0.95) });
    B.add('dark', xTube(x - 0.25, x + 0.25, 0.035, 0.035, 8, 0, 0));
    B.add('camo', rod(V(x + 0.2, 0.03, 0.62), V(x + 0.2, 0.32, 0.02), 0.022, 5)); // stay up to the retainer
  }
  const ms = bukPaint(onePaint(B).build(g, { y0 }));
  // level (travel, loading) they hang at `droop`; as the launcher rises they fold up toward the
  // tails (fully by 0.6 rad), so they clear the hull deck at any elevation with the turret forward
  g.updateMatrix = function () {
    const e = el.rotation.x, k = THREE.MathUtils.smoothstep(e, 0.05, 0.6);
    this.rotation.x = (droop - e) * (1 - k) - 1.3 * k;
    THREE.Object3D.prototype.updateMatrix.call(this);
  };
  return ms;
}

function buildLauncher(rig, parent, at, y0, opts = {}) {
  const el = pivotAt(rig, parent, 'elevation', at.x, at.y, at.z);
  const E = new Parts(rig.mats);
  launcherBody(E, opts);
  bukPaint(onePaint(E, { steel: 0.8, white: 1.6 }).build(el, { y0: y0 + at.y }));
  blastPlates(rig.mats, el, y0 + at.y, (opts.droop ?? 55) * DEG);
  const centres = LX.map((x) => [x, LA.axis, LA.tail - MISSILE.L / 2]);
  const set = missileSet(rig.mats, el, centres, y0 + at.y);
  centres.forEach(([x, y, z], i) => rig.anchors.missileSlots.push(node(el, 'slot' + i, x, y, z)));
  return { el, set };
}

// The travel lock on the front ledge, posed by setDeploy: in travel (0) it stands up to the
// launcher's tail end leaning by `lean`; in action (1) its top part slides down into the tube and
// it folds flat to the right along the ledge, in front of the corner box.
function travelLock(rig, C, h, lean) {
  const g = new THREE.Group();
  g.name = 'travelLock';
  g.position.set(0, C.ledge * K.y + 0.04, (C.zf + 0.14) * K.z);
  rig.root.add(g);
  const T = new Parts(rig.mats);
  addTravelLock(T, h);
  bukPaint(onePaint(T).build(g, { y0: C.ledge * K.y }));
  const top = new THREE.Group();
  g.add(top);
  const U = new Parts(rig.mats);
  addTravelLockTop(U, h);
  bukPaint(onePaint(U).build(top, { y0: C.ledge * K.y }));
  return (v) => {
    const k = THREE.MathUtils.clamp(v, 0, 1);
    const slide = THREE.MathUtils.clamp(k * 2, 0, 1), fold = THREE.MathUtils.clamp(k * 2 - 1, 0, 1);
    top.position.y = -Math.max(0, h - 0.75) * slide;
    g.rotation.set(lean * (1 - fold), 0, -Math.PI / 2 * fold);
  };
}

// ---------------------------------------------------------------- 9A317 TELAR

// TELAR turret in photo units (scaled by GM_SCALE with the hull), measured on
// m2-telar-9a317-parade-rehearsal-kuzmin camera-matched: the lower row of boxes 0.09 to 0.82 over
// the deck and 7.3 m long, the upper cabin with sloped sides up to the roof at 1.59 from z -3.36 to
// -0.35, chamfered down to 0.33; the radar housing bulging 0.4 m past the boxes at mid-height.
const TL = { z0: -3.48, z1: 3.85, box: 0.82, roof: 1.5, hw: 1.3, cw: 1.08, up0: -3.36, cab1: -0.65, cab2: 0.03 };
// launcher trunnion in turret space, scaled units (it is not scaled: the launcher is in metres)
const TRUN = { y: 0.9, z: 3.26 }; // axis 3.58 m over the ground (fit: 3.53, raised to clear the roof), tails 3.58 m from the ring

// a door on the turret's vertical side (side +1 right)
function sideDoor(T, s, z0, z1, y0, y1, x = TL.hw) {
  const zc = (z0 + z1) / 2, yc = (y0 + y1) / 2;
  T.add('camo', rbox(0.03, y1 - y0, z1 - z0, 0.012, s * (x + 0.012), yc, zc));
  T.add('dark', box(0.02, 0.012, z1 - z0 - 0.04, s * (x + 0.026), y1 - 0.015, zc));
  T.add('dark', box(0.03, 0.035, 0.14, s * (x + 0.03), yc, s > 0 ? z0 + 0.14 : z1 - 0.14)); // handle
  for (const y of [y0 + 0.1, y1 - 0.1]) T.add('dark', box(0.03, 0.08, 0.04, s * (x + 0.02), y, s > 0 ? z1 - 0.02 : z0 + 0.02)); // hinges
}

// The radar housing over the 9A317's phased array, full height at the turret's -Z end: a thick slab
// whose flat outer face leans in toward the turret (from 0.53 m past the boxes at 0.55 up to the
// roof edge), with a rounded lower edge and rounded corners in plan (side photo, camera-matched;
// from above, moscow2015, it reads as a leaning slab). Lofted from plan rings. Photo units.
function radarHousing() {
  const zi = -3.2, rings = [];
  const face = (y) => -3.89 + (y - 0.55) * (0.53 / 1.04); // the flat face, y from 0.55 to 1.59
  for (const [y, zo, w, rc] of [[0.0, -3.7, 1.2, 0.2], [0.15, -3.81, 1.22, 0.25], [0.35, -3.87, 1.23, 0.28], [0.55, face(0.55), 1.23, 0.3], [1.2, face(1.2), 1.21, 0.3], [1.5, face(1.5), 1.19, 0.28], [1.59, face(1.59) + 0.04, 1.15, 0.24], [1.62, -3.22, 1.05, 0.05]]) {
    const r = [V(w, y, zi)];
    for (let k = 0; k <= 4; k++) { const a = (k / 4) * (Math.PI / 2); r.push(V(w - rc + Math.cos(a) * rc, y, zo + rc - Math.sin(a) * rc)); }
    for (let k = 0; k <= 4; k++) { const a = Math.PI / 2 + (k / 4) * (Math.PI / 2); r.push(V(-w + rc + Math.cos(a) * rc, y, zo + rc - Math.sin(a) * rc)); }
    r.push(V(-w, y, zi));
    rings.push(r);
  }
  return loft(rings);
}

function telarTurret(T) {
  const { z0, z1, box: yb, roof, hw, cw, up0, cab1, cab2 } = TL;
  T.add('dark', yTube(-0.02, 0.09, 1.16, 1.16, 32)); // ring skirt
  T.add('camo', rbox(hw * 2 - 0.04, yb - 0.08, z1 - z0, 0.035, 0, (yb + 0.08) / 2, (z0 + z1) / 2));
  T.add('dark', box(hw * 2 - 0.1, 0.03, z1 - z0 - 0.04, 0, 0.09, (z0 + z1) / 2)); // shadow line at the bottom edge
  // upper cabin: sloped sides; at its -Z end it meets the housing, at its +Z end it is chamfered
  // down to the boxes ahead of the launcher's well
  const q = (z, yt, wt) => [V(-hw + 0.02, yb - 0.01, z), V(hw - 0.02, yb - 0.01, z), V(wt, yt, z), V(-wt, yt, z)];
  T.add('camo', loft([q(up0 + 0.05, roof, cw), q(cab1, roof, cw), q(cab2, yb + 0.06, hw - 0.04)]));
  const side = Math.atan2(hw - cw, roof - yb); // the cabin side's lean
  // the lower row of boxes (six a side, hinged lids), the upper row of doors on the sloped sides
  for (const s of [-1, 1]) {
    for (const [a, b] of [[-3.46, -2.8], [-2.74, -1.07], [-1.01, 0.62], [0.68, 1.86], [1.92, 3.18], [3.24, 3.83]]) sideDoor(T, s, a, b, 0.13, yb - 0.04);
    for (const [a, b] of [[-2.63, -1.43], [-1.37, -0.7]]) {
      const yc = (yb + roof) / 2 + 0.01, xc = (hw + cw) / 2 + 0.012;
      T.add('camo', rbox(0.03, roof - yb - 0.12, b - a, 0.012, s * xc, yc, (a + b) / 2, 0, 0, s * side), { tint: 0xe4e4e4 });
      T.add('dark', box(0.03, 0.035, 0.14, s * (xc + 0.02), yc, (a + b) / 2, 0, 0, s * side));
    }
  }
  // roof: two hatches, the optical sight head on its post at the housing end on the right (the
  // left of the vehicle in travel, moscow2015), the guard rails, vents
  for (const [x, z] of [[-0.45, -1.5], [0.35, -0.95]]) {
    T.add('camo', yTube(roof, roof + 0.06, 0.32, 0.3, 18, x, z));
    T.add('dark', box(0.5, 0.03, 0.05, x, roof + 0.07, z + 0.28));
  }
  const sx = 0.62, sz = -2.45;
  T.add('camo', rbox(0.2, 0.36, 0.24, 0.03, sx, roof + 0.18, sz + 0.05)); // post
  T.add('camo', rbox(0.34, 0.28, 0.85, 0.04, sx, roof + 0.5, sz)); // the head
  T.add('camo', rbox(0.2, 0.1, 0.3, 0.02, sx, roof + 0.69, sz + 0.1));
  T.add('glass', box(0.22, 0.14, 0.02, sx, roof + 0.5, sz - 0.43));
  T.add('dark', box(0.3, 0.04, 0.14, sx, roof + 0.66, sz - 0.42)); // sun visor
  // (outboard of the outer rounds, which lie over the roof from z -2.3 in these units)
  for (const s of [-1, 1]) {
    const x = s * 1.27;
    tubeRail(T, 'camo', [V(x, yb, -2.84), V(x, 2.0, -2.8), V(x, 2.09, -2.66), V(x, 2.09, -0.45), V(x, 2.0, -0.31), V(x, yb, -0.28)], 0.024);
  }
  T.add('dark', box(0.5, 0.06, 0.25, -0.4, roof + 0.03, -2.65));
  // whip antenna on the cabin's edge near its end, a stub beside it
  T.add('dark', box(0.1, 0.1, 0.1, hw - 0.1, yb + 0.06, cab2 + 0.1));
  T.add('dark', yTube(yb + 0.1, yb + 0.28, 0.035, 0.03, 8, hw - 0.1, cab2 + 0.1));
  T.add('dark', yTube(yb + 0.28, yb + 3.4, 0.01, 0.004, 5, hw - 0.1, cab2 + 0.1));
  T.add('dark', yTube(roof, roof + 0.4, 0.015, 0.01, 6, -0.9, -0.6));
  T.add('camo', radarHousing(), { tint: 0xd4e6cc });
  for (const s of [-1, 1]) T.add('dark', box(0.06, 0.12, 0.14, s * 0.9, roof + 0.02, -3.0)); // lifting eyes
  // launcher well ahead of the chamfer: the elevation drive housings either side and a deck plate
  for (const s of [-1, 1]) {
    T.add('camo', rbox(0.34, 0.36, 1.6, 0.04, s * 0.55, yb + 0.12, 2.0));
    T.add('dark', rod(V(s * 0.55, yb + 0.2, 1.6), V(s * 0.55, yb + 0.35, 3.0), 0.07, 8));
  }
  T.add('camo', box(hw * 2 - 0.2, 0.04, z1 - cab2 - 0.2, 0, yb + 0.01, (z1 + cab2) / 2), { tint: 0xd0d0d0 });
}

export function buildBukTelar() {
  const rig = newRig('green'), { P, root, mats } = rig;
  const C = GM569, deck = C.deck * K.y, ring = C.ring * K.z;
  addChassis(P, C);
  bukPaint(scaleParts(P).build(root, { dirt: 0.55 }));
  const lockPose = travelLock(rig, C, 1.15, -0.41);

  const tur = pivotAt(rig, root, 'turret', 0, deck, ring);
  const T = new Parts(mats);
  telarTurret(T);
  bukPaint(scaleParts(T).build(tur, { dirt: 0.25, y0: deck }));
  const { set } = buildLauncher(rig, tur, { x: 0, y: TRUN.y, z: TRUN.z }, deck);
  rig.setLoaded = set;
  rig.setDeploy = lockPose;
  lockPose(1);

  rig.anchors.eye = node(root, 'eye', 0, 2.4, 0);
  hb(rig, -C.apron * K.x, 0, C.zf * K.z, C.apron * K.x, deck, C.zr * K.z);
  hb(rig, -TL.hw * K.x, deck, ring - 3.9, TL.hw * K.x, deck + TL.roof * K.y + 0.4, ring + 3.9);
  return rig;
}

// ---------------------------------------------------------------- 9A316 loader-launcher

// Loader layout in turret space (+Z the launcher end), in metres, solved together with the cameras
// of m2-loader-9a316-moscow2015 (high) and m2-telar-sokolrus (side, a loaded 9A316): the launcher
// rounds' axes 1.33 m over the hull deck with their tails 3.87 m from the ring; the rack rounds
// four abreast at x 0.76 and 1.28, axes 0.52 m over the deck, the inner pair 1.37 m further aft
// (their noses reach the hull's rear end); the rack's side walls from 0.1 to 0.8 m over the
// deck and from z -0.6 to 2.4, so the rack noses overhang them by 2.6 m (Sokolrus); the crane
// post 2.5 m behind the ring between the inner rack pair, just off the centre line, its boom
// rising 10 deg toward the rear to a tip 1.9 m over the deck at z -4.4 (triangulated).
const LTRUN = { y: 0.73, z: 3.55 };
const LT = LTRUN.z + LA.tail; // the launcher rounds' tails
const LD = { z0: -4.6, z1: 3.55, deck: 0.1, wall: 1.5, rack0: -0.6, rack1: 2.4, rackBot: 0.1, rackTop: 0.8, ped: 3.3 };
const CRANE = { x: 0.3, z: -2.5, post: 1.5, boom: 1.95, jib: 1.25 }; // post foot and boom tip triangulated from both photos
const RACK = [[1.28, 0.52, 2.36], [-1.28, 0.52, 2.36], [0.755, 0.52, 0.99], [-0.755, 0.52, 0.99]]; // x, axis y, tail z

// rack side wall: a plate between top and bottom flanges, posts, flat bar V braces in each bay
// (the photos' zigzag)
function rackWall(T, s) {
  const { rack0: a, rack1: b, rackBot: y0, rackTop: y1, wall } = LD;
  const x = s * wall, zc = (a + b) / 2, h = y1 - y0;
  T.add('camo', box(0.03, h, b - a, x, (y0 + y1) / 2, zc));
  for (const y of [y0 + 0.03, y1 - 0.03]) T.add('camo', box(0.1, 0.06, b - a + 0.04, x + s * 0.03, y, zc));
  const n = 3, bay = (b - a) / n;
  for (let i = 0; i <= n; i++) T.add('camo', box(0.07, h, 0.07, x + s * 0.03, (y0 + y1) / 2, a + i * bay));
  const hy = h - 0.12, hz = bay / 2 - 0.05, len = Math.hypot(hy, hz), ang = Math.atan2(hz, hy);
  for (let i = 0; i < n; i++) {
    const za = a + i * bay, zm = za + bay / 2, zb = za + bay;
    for (const [zz, sg] of [[(za + zm) / 2, 1], [(zm + zb) / 2, -1]]) T.add('camo', box(0.03, len, 0.07, x + s * 0.035, (y0 + y1) / 2, zz, sg * ang));
  }
  for (const z of [a + 0.4, b - 0.4]) T.add('dark', box(0.04, 0.05, 0.2, x + s * 0.06, y1 - 0.12, z)); // lashing points
}

function loaderBody(T) {
  const { z0, z1, deck } = LD;
  T.add('dark', yTube(-0.02, 0.06, 1.2, 1.2, 32));
  T.add('camo', rbox(3.0, deck, z1 - z0, 0.03, 0, deck / 2, (z0 + z1) / 2)); // the platform
  for (const s of [-1, 1]) rackWall(T, s);
  // cradles across the platform: a beam with a post and saddle under each round
  for (const z of [-2.3, -0.1, 1.9]) {
    T.add('camo', box(2.9, 0.12, 0.14, 0, deck + 0.06, z));
    for (const [x, y, tail] of RACK) {
      if (z > tail - 0.2 || z < tail - MISSILE.L + 0.4) continue;
      T.add('camo', box(0.1, y - 0.2 - deck, 0.12, x, (y - 0.2 + deck) / 2, z));
      T.add('dark', box(0.3, 0.05, 0.16, x, y - 0.205, z));
    }
  }
  // the rounds' tail stops
  for (const [x, y, tail] of RACK) T.add('dark', box(0.26, 0.2, 0.08, x, y - 0.12, tail + 0.06));
  // launcher pedestal with doors, the trunnion brackets on it
  const p0 = LD.rack1, p1 = LD.ped, py = LTRUN.y - 0.14;
  T.add('camo', rbox(2.6, py - deck, p1 - p0, 0.04, 0, (py + deck) / 2, (p0 + p1) / 2));
  for (const s of [-1, 1]) {
    sideDoor(T, s, p0 + 0.08, p1 - 0.1, deck + 0.06, py - 0.06, 1.3);
    T.add('camo', box(0.26, 0.24, 0.5, s * 0.95, py + 0.06, LTRUN.z - 0.2));
    T.add('dark', xTube(s * 0.82, s * 1.08, 0.12, 0.12, 14, LTRUN.y, LTRUN.z));
  }
  // boxes and a cable reel on the platform at the crane end, under the inner rack noses
  T.add('dark', xTube(-0.3, 0.3, 0.16, 0.16, 14, deck + 0.17, -4.25));
  // railing round the crane end: high side frames with a solid panel and two rails (kuzmin)
  const r0 = z0 + 0.05, r1 = LD.rack0 - 0.4, rh = deck + 0.95;
  for (const s of [-1, 1]) {
    const x = s * 1.45;
    tubeRail(T, 'camo', [V(x, deck, r1), V(x, rh, r1 - 0.1), V(x, rh, r0 + 0.15), V(x, rh - 0.1, r0), V(x, deck, r0)], 0.024);
    T.add('camo', rod(V(x, deck + 0.5, r1), V(x, deck + 0.5, r0), 0.02, 5));
    T.add('camo', box(0.025, 0.45, 1.2, x - s * 0.02, deck + 0.35, (r0 + r1) / 2 + 0.3));
  }
  // crane operator's control box beside the post
  T.add('camo', rbox(0.3, 0.45, 0.26, 0.03, -0.2, deck + 0.24, CRANE.z + 0.5));
  T.add('dark', box(0.2, 0.12, 0.02, -0.2, deck + 0.34, CRANE.z + 0.37));
  // whip antenna on the pedestal's corner
  T.add('dark', yTube(py, py + 0.15, 0.035, 0.03, 8, -1.12, p0 + 0.12));
  T.add('dark', yTube(py + 0.15, py + 3.1, 0.01, 0.004, 5, -1.12, p0 + 0.12));
}

// box beam along -Z from z = 0 to -len, tapering, with lightening holes drawn as dark discs
function beam(Q, len, w0, h0, w1, h1) {
  const g = loft([[V(-w0 / 2, -h0 / 2, 0), V(w0 / 2, -h0 / 2, 0), V(w0 / 2, h0 / 2, 0), V(-w0 / 2, h0 / 2, 0)], [V(-w1 / 2, -h1 / 2, -len), V(w1 / 2, -h1 / 2, -len), V(w1 / 2, h1 / 2, -len), V(-w1 / 2, h1 / 2, -len)]]);
  Q.add('camo', g);
  const n = Math.floor(len / 0.35);
  for (let i = 1; i < n; i++) {
    const t = i / n, h = h0 + (h1 - h0) * t, w = w0 + (w1 - w0) * t;
    for (const s of [-1, 1]) Q.add('dark', xTube(s * (w / 2), s * (w / 2 + 0.004), h * 0.22, h * 0.22, 10, 0, -len * t));
  }
}

function buildCrane(rig, tur, y0) {
  const { mats } = rig;
  const cr = pivotAt(rig, tur, 'crane', CRANE.x, LD.deck, CRANE.z);
  const Q = new Parts(mats);
  // slewing base and the post (a tapered box column), the boom hinge lugs on top
  Q.add('dark', yTube(0, 0.08, 0.3, 0.3, 18));
  Q.add('camo', rbox(0.5, 0.3, 0.5, 0.04, 0, 0.2, 0));
  // (the post stands between the inner rack rounds' noses, so it is narrow across and deep)
  Q.add('camo', loft([[V(-0.17, 0.3, -0.24), V(0.17, 0.3, -0.24), V(0.17, 0.3, 0.26), V(-0.17, 0.3, 0.26)], [V(-0.14, CRANE.post - 0.06, -0.16), V(0.14, CRANE.post - 0.06, -0.16), V(0.14, CRANE.post - 0.06, 0.18), V(-0.14, CRANE.post - 0.06, 0.18)]]));
  for (let y = 0.6; y < CRANE.post - 0.3; y += 0.32) for (const s of [-1, 1]) Q.add('dark', xTube(s * 0.16, s * 0.165, 0.055, 0.055, 10, y, 0.02));
  for (const s of [-1, 1]) Q.add('camo', box(0.05, 0.34, 0.34, s * 0.15, CRANE.post, 0.02));
  Q.add('camo', box(0.3, 0.14, 0.18, 0, 0.82, -0.26)); // the luffing ram's lug
  bukPaint(onePaint(Q).build(cr, { y0: y0 + LD.deck }));

  const bm = pivotAt(rig, cr, 'craneBoom', 0, CRANE.post, 0);
  const B = new Parts(mats);
  B.add('dark', xTube(-0.2, 0.2, 0.06, 0.06, 10, 0, 0));
  beam(B, CRANE.boom, 0.26, 0.34, 0.2, 0.24);
  B.add('camo', box(0.24, 0.12, 0.18, 0, -0.2, -1.0)); // ram lug under the boom
  B.add('camo', zTube(-0.3, -1.3, 0.06, 0.06, 10, 0, 0.24)); // jib ram along the top: barrel, rod
  B.add('steel', zTube(-1.3, -2.25, 0.035, 0.035, 8, 0, 0.24));
  B.add('camo', box(0.18, 0.12, 0.12, 0, 0.18, -0.3));
  bukPaint(onePaint(B).build(bm, { y0: y0 + LD.deck + CRANE.post }));

  const jb = pivotAt(rig, bm, 'craneJib', 0, 0, -CRANE.boom);
  const J = new Parts(mats);
  J.add('dark', xTube(-0.15, 0.15, 0.05, 0.05, 10, 0, 0));
  beam(J, CRANE.jib, 0.19, 0.25, 0.14, 0.17);
  J.add('camo', box(0.16, 0.14, 0.14, 0, 0, -CRANE.jib - 0.02));
  J.add('dark', xTube(-0.1, 0.1, 0.05, 0.05, 10, 0, -CRANE.jib));
  bukPaint(onePaint(J).build(jb, { y0: y0 + LD.deck + CRANE.post }));

  // the jib's telescopic inner sections (reconstructed: refs/buk section E has the jib reach out
  // over the TELAR's rails beside the loader, no photo shows it): two stages that slide out of the
  // jib's tip along -Z together, housed inside it when in (rig.setCraneExt)
  const st1 = pivotAt(rig, jb, 'craneExt', 0, 0, 0);
  const st2 = new THREE.Group();
  st2.name = 'craneExt2';
  st1.add(st2);
  const X1 = new Parts(mats), X2 = new Parts(mats);
  beam(X1, CRANE.jib - 0.05, 0.12, 0.15, 0.11, 0.13);
  X1.add('camo', box(0.13, 0.15, 0.06, 0, 0, -CRANE.jib + 0.03));
  beam(X2, CRANE.jib - 0.05, 0.085, 0.1, 0.08, 0.095);
  X2.add('camo', box(0.1, 0.11, 0.06, 0, 0, -CRANE.jib + 0.03));
  X2.add('dark', xTube(-0.08, 0.08, 0.045, 0.045, 10, 0, -CRANE.jib));
  for (const [Q, g] of [[X1, st1], [X2, st2]]) bukPaint(onePaint(Q).build(g, { y0: y0 + LD.deck + CRANE.post }));
  rig.craneExtMax = 2.0;
  rig.setCraneExt = (v) => {
    const e = THREE.MathUtils.clamp(v, 0, rig.craneExtMax) / 2;
    st1.position.z = -e;
    st2.position.z = -e;
  };

  // level frame at the tip of the inner section (the jib's tip when it is in), the hook (lifting
  // beam) hanging under it on the cable
  const ho = pivotAt(rig, st2, 'craneHoist', 0, 0, -CRANE.jib);
  ho.updateMatrix = function () {
    this.rotation.x = -(bm.rotation.x + jb.rotation.x);
    THREE.Object3D.prototype.updateMatrix.call(this);
  };
  const hook = node(ho, 'craneHook', 0, -0.6, 0);
  rig.anchors.craneHook = hook;
  const H = new Parts(mats), top = 0.5; // the beam sits 0.5 m over the missile's axis
  H.add('dark', box(0.1, 0.12, 0.14, 0, top + 0.12, 0)); // hook block
  H.add('dark', rod(V(0, top + 0.18, 0), V(0, top + 0.05, -0.62), 0.01, 4));
  H.add('dark', rod(V(0, top + 0.18, 0), V(0, top + 0.05, 0.62), 0.01, 4));
  H.add('camo', box(0.08, 0.1, 1.5, 0, top, 0)); // lifting beam
  for (const z of [-0.62, 0.62]) {
    // a leg down each end of the beam to a saddle clamp that grips the round's top
    H.add('camo', box(0.06, top - 0.2, 0.06, 0, (top + 0.2) / 2, z));
    H.add('camo', box(0.3, 0.05, 0.12, 0, 0.215, z));
    for (const s of [-1, 1]) H.add('dark', box(0.03, 0.12, 0.1, s * 0.15, 0.16, z));
  }
  bukPaint(onePaint(H).build(hook, { y0: y0 + 3 }));
  // the cable from the jib tip down to the hook block, stretched to the drop each frame
  const cab = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 1, 5).translate(0, -0.5, 0), mats.dark);
  cab.name = 'craneCable';
  ho.add(cab);
  cab.onBeforeRender = cab.onBeforeShadow = () => {
    const len = Math.max(0.01, -hook.position.y - (top + 0.18));
    if (cab.scale.y !== len) { cab.scale.y = len; cab.updateMatrixWorld(true); }
  };
  // luffing ram between the post and the boom, aimed every frame
  const ram = new THREE.Group();
  ram.name = 'craneRam';
  cr.add(ram);
  const R = new Parts(mats);
  R.add('camo', yTube(0, 0.9, 0.09, 0.09, 10)); // barrel
  R.add('steel', yTube(0.85, 1.6, 0.05, 0.05, 8)); // rod, slides out of the barrel
  bukPaint(onePaint(R).build(ram, { y0: y0 + 1.5 }));
  const lugA = V(0, 0.82, -0.26), lugB = V(0, -0.22, -1.0), p = V(), up = V(0, 1, 0), q = new THREE.Quaternion();
  ram.updateMatrix = function () {
    p.copy(lugB).applyAxisAngle(V(1, 0, 0), bm.rotation.x).add(V(0, CRANE.post, 0)).sub(lugA);
    const L = p.length();
    this.position.copy(lugA);
    this.quaternion.copy(q.setFromUnitVectors(up, p.normalize()));
    this.scale.set(1, L / 1.6, 1);
    this.matrix.compose(this.position, this.quaternion, this.scale);
    this.matrixWorldNeedsUpdate = true;
  };
  ram.matrixAutoUpdate = true;
  // travel pose
  cr.rotation.y = 0;
  bm.rotation.x = 0.18;
  jb.rotation.x = -2.36;
  return cr;
}

export function buildBukLoader() {
  const rig = newRig('green'), { P, root, mats } = rig;
  const C = GM577, deck = C.deck * K.y, ring = C.ring * K.z;
  addChassis(P, C);
  bukPaint(scaleParts(P).build(root, { dirt: 0.55 }));
  const lockPose = travelLock(rig, C, 1.0, -0.32);

  // the body, launcher, rack and crane are laid out in metres against the 5.55 m rounds (they
  // are not scaled with the hull)
  const tur = pivotAt(rig, root, 'turret', 0, deck, ring);
  const T = new Parts(mats);
  loaderBody(T);
  bukPaint(T.build(tur, { dirt: 0.25, y0: deck }));
  const { set } = buildLauncher(rig, tur, { x: 0, y: LTRUN.y, z: LTRUN.z }, deck, { beam: 0.69, low: false, droop: 15 });
  const rackCentres = RACK.map(([x, y, tail]) => [x, y, tail - MISSILE.L / 2]);
  const rackSet = missileSet(mats, tur, rackCentres, deck);
  rackCentres.forEach(([x, y, z], i) => rig.anchors.missileSlots.push(node(tur, 'slot' + (4 + i), x, y, z)));
  buildCrane(rig, tur, deck);
  rig.setLoaded = (i, on) => (i < 4 ? set(i, on) : rackSet(i - 4, on));
  rig.setDeploy = lockPose;
  lockPose(1);

  rig.anchors.eye = node(root, 'eye', 0, 2.5, 0);
  hb(rig, -C.apron * K.x, 0, C.zf * K.z, C.apron * K.x, deck, C.zr * K.z);
  hb(rig, -1.4, deck, ring - 4.0, 1.4, deck + 2.3, ring + 4.0);
  return rig;
}
