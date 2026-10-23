import * as THREE from 'three';
import { box, rbox, yTube, zTube, xTube, dish, Parts } from '../../../models/kit.js';
import { newRig, node, pivotAt, hb } from '../../../models/rig.js';
import { flakMats, setPaint, paintCarrier, add, build } from './kit44.js';

// Wuerzburg-Riese (FuMG 65), the flak tower's gun-laying radar on its fire control tower's roof (de.wiki
// Flakturm; refs/ww2/battery section 3.2: a 7.4 to 7.5 m dish, 15 t; photos battery_riese_12 and _14, the
// museum sets at Lesany and Gatow, and the Zoo L-tower's roof in flakturm_zoo_03 and _06). What the museum
// sets show: the paraboloid of wire mesh on a frame of radial lattice girders and rings, the feed's rod from
// its centre with the small dipole and its reflector disc at the end; behind the dish, square to it, the
// long box of the operators' cabin it is mounted on, turning on a short round column on a concrete base.
// The dish tilts on the cabin; the whole turns in azimuth. Sizes from the 7.4 m dish (E): cabin 5.6 m wide,
// 2.3 m tall, 2.4 m deep, the elevation axis 3.9 m over the base.
//
// Rig (front -Z = the beam at zero, ground y = 0 at the plinth's top):
//   pivots.turret     the column's top, the cabin and the dish, (0, 1.0, 0). rotation.y = azimuth, + left.
//   pivots.elevation  the dish's axle at the cabin's front top, turret space (0, 2.9, -1.0). rotation.x =
//                     elevation, + tilts the beam up; 0 to 75 deg.
//   pivots.quirl      the feed's rotor at the end of its rod (elevation group); rig.spin(t) spins it.
//   anchors.eye       camera focus; anchors.sight the dish's centre along the beam.
//   setPaint('grey' | 'yellow').
const R = 3.7, D = 0.95; // the dish's radius and depth

// the reflector's wire mesh: light grey, the sky through it
let MESH;
const meshMat = () => (MESH ??= new THREE.MeshStandardMaterial({ color: 0xc8cbc8, roughness: 0.6, metalness: 0.3, transparent: true, opacity: 0.42, side: THREE.DoubleSide, depthWrite: false, vertexColors: true }));

export function buildWurzburgRiese() {
  const rig = newRig('green');
  const mats = { ...flakMats('grey'), mesh: meshMat() };
  rig.mats = mats;
  const root = rig.root;

  const B = new Parts(mats);
  add(B, 'paint', yTube(0, 0.6, 1.3, 1.1, 24), 0xb4b4b4); // the column
  add(B, 'paint', yTube(0.6, 1.0, 1.5, 1.5, 28), 0xa8a8a8); // the turntable
  build(B, root, 0, 0.1);

  const tur = pivotAt(rig, root, 'turret', 0, 1.0, 0);
  const T = new Parts(mats);
  add(T, 'paint', rbox(5.6, 2.3, 2.4, 0.06, 0, 1.15, 0.2)); // the operators' cabin
  for (const s of [-1, 1]) {
    add(T, 'paint', box(0.3, 0.6, 1.4, s * 2.0, 2.55, -0.5)); // the dish's bearing blocks on the cabin
    add(T, 'black', box(0.02, 0.5, 0.7, s * 2.81, 1.4, 0.2), 0x1a1b1d); // the cabin's side windows
  }
  add(T, 'metal', box(0.9, 1.8, 0.05, 0.9, 1.0, 1.42), 0x55574f); // its door at the back
  for (let k = -2; k <= 2; k++) add(T, 'paint', box(0.05, 2.25, 0.05, k * 1.1, 1.15, 1.41), 0xb8b8b8); // stiffeners
  build(T, tur, 1.0, 0.1);

  // the dish: mesh skin, girders, rim, the feed
  const el = pivotAt(rig, tur, 'elevation', 0, 2.9, -1.0);
  const E = new Parts(mats);
  const v0 = -0.55;
  add(E, 'mesh', dish(R, D, 0.02, 40).applyMatrix4(new THREE.Matrix4().makeTranslation(0, 0, v0)), 0xd8d8d8, 0);
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
    // a radial girder along the dish's back from the hub to the rim
    for (let k = 0; k < 4; k++) {
      const r0 = 0.4 + (k / 4) * (R - 0.4), r1 = 0.4 + ((k + 1) / 4) * (R - 0.4);
      const p0 = new THREE.Vector3(ca * r0, sa * r0, v0 - D * (r0 / R) ** 2 + 0.06), p1 = new THREE.Vector3(ca * r1, sa * r1, v0 - D * (r1 / R) ** 2 + 0.06);
      const d = p1.clone().sub(p0), len = d.length();
      const g = box(0.06, 0.16, len, 0, 0, 0);
      g.applyMatrix4(new THREE.Matrix4().lookAt(new THREE.Vector3(), d, new THREE.Vector3(0, 0, 1)).setPosition(p0.clone().add(p1).multiplyScalar(0.5)));
      add(E, 'paint', g, 0xc4c4c4, 0);
    }
  }
  for (const r of [1.4, 2.6]) add(E, 'paint', new THREE.TorusGeometry(r, 0.04, 5, 40).translate(0, 0, v0 - D * (r / R) ** 2 + 0.05), 0xc4c4c4, 0);
  add(E, 'paint', new THREE.TorusGeometry(R, 0.09, 6, 56).translate(0, 0, v0 - D - 0.02), 0xc8c8c8, 0); // the rim girder
  add(E, 'paint', zTube(v0 + 0.05, 0.35, 0.45, 0.6, 16), 0xb8b8b8); // the hub behind the dish
  add(E, 'paint', xTube(-2.2, 2.2, 0.12, 0.12, 12, 0, 0), 0xb0b0b0); // the axle
  add(E, 'metal', zTube(v0 - 1.9, v0, 0.04, 0.04, 8), 0x7a7a7a); // the feed's rod
  build(E, el, 3.9, 0);
  const q = pivotAt(rig, el, 'quirl', 0, 0, v0 - 1.9);
  const Q = new Parts(mats);
  add(Q, 'paint', zTube(-0.25, 0, 0.09, 0.09, 12), 0xc8c8c8);
  add(Q, 'paint', zTube(-0.3, -0.27, 0.32, 0.32, 20), 0xd8d8d8); // the reflector disc
  build(Q, q, 3.9, 0);
  rig.spin = (t) => { q.rotation.z = (t * 25 * Math.PI * 2) % (Math.PI * 2); };

  rig.anchors.sight = node(el, 'sight', 0, 0, v0 - D);
  rig.anchors.eye = node(root, 'eye', 0, 2.5, 0.5);
  hb(rig, -3.8, 0, -2.0, 3.8, 7.8, 1.6);

  let paint = 'grey';
  paintCarrier(root);
  rig.setPaint = (s) => { if (s !== paint && (s === 'grey' || s === 'yellow')) { paint = s; setPaint(root, s); } };
  return rig;
}
