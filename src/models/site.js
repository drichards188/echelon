import * as THREE from 'three';
import { V, box, rbox, sphere, yTube, zTube, xTube, rod, plane, frontProfile, projectUV, scaleUV, Parts, concreteTextures, runwayTexture, earthTextures, grainTextures, camoTextures, surfaceFinish, dish, xf } from './kit.js';

// The defended airbase: runway, the air defense command post (a semi-buried bunker), hardened
// aircraft shelters, the fuel farm and the control tower. buildAsset(asset) returns a group whose
// origin is the asset's position on the ground; the caller turns it to face `bearing`
// (rotation.y = headingFor(bearing)), so the model's -Z runs along the asset's bearing.
// Everything is weathered concrete, rusting steel and faded paint: the surface finish shader adds
// the splash line at the foot of every wall and the dust on every top.

let mats;
function siteMats() {
  if (mats) return mats;
  const con = concreteTextures(), grain = grainTextures(), earth = earthTextures(), khaki = camoTextures('khaki');
  const std = (c, rough, metal, extra = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: rough, metalness: metal, vertexColors: true, ...extra });
  const dust = { dustColor: 0xa39c88 };
  const finish = (m, key, ns, o) => {
    m.roughnessMap = grain.rough;
    m.normalMap = grain.normal;
    m.normalScale.set(ns, ns);
    return surfaceFinish(m, 'site-' + key, { ...dust, ...o });
  };
  mats = {
    concrete: surfaceFinish(std(0xcfcbc0, 1, 0, { map: con.map, roughnessMap: con.rough, normalMap: con.normal }), 'site-concrete', { mud: 0.85, mudTop: 1.8, dust: 0.45, mudColor: 0x474337, ...dust }),
    asphalt: std(0xffffff, 0.93, 0.0, { map: runwayTexture(), roughnessMap: grain.rough, normalMap: grain.normal, normalScale: new THREE.Vector2(0.6, 0.6) }),
    paint: std(0xdcdcd2, 0.8, 0.0, { roughnessMap: grain.rough, normalMap: grain.normal, normalScale: new THREE.Vector2(0.5, 0.5), polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
    earth: std(0xffffff, 1, 0, { map: earth.map, roughnessMap: earth.rough, normalMap: earth.normal }),
    sand: finish(std(0xb0a278, 1, 0), 'sand', 1.2, { mud: 0.6, dust: 0.3 }),
    steel: finish(std(0x7a7e82, 0.5, 0.75), 'steel', 0.9, { mud: 0.5, dust: 0.35 }),
    dark: finish(std(0x242624, 0.65, 0.25), 'dark', 0.5, { mud: 0.5, dust: 0.3 }),
    green: surfaceFinish(std(0xd4d8c6, 1, 0.1, { map: khaki.map, roughnessMap: khaki.rough, normalMap: khaki.normal, normalScale: new THREE.Vector2(0.8, 0.8) }), 'site-green', { mud: 0.7, mudTop: 1.4, dust: 0.22, ...dust }),
    glass: std(0x20323d, 0.04, 0.3, { envMapIntensity: 1.8 }),
    lens: std(0xf0e8c0, 0.3, 0.1, { emissive: 0xffe7a0, emissiveIntensity: 0.6 }),
    red: finish(std(0x8a2c22, 0.65, 0.05), 'red', 0.5, { mud: 0.4, dust: 0.4 }),
    white: finish(std(0xbebeb3, 0.65, 0.05), 'white', 0.5, { mud: 0.5, dust: 0.45 }),
  };
  return mats;
}

// concrete gets box-projected UVs (a tile is about 6 m)
function addCon(P, g, s = 6, key = 'concrete') {
  const n = g.index ? g.toNonIndexed() : g;
  if (!n.attributes.normal) n.computeVertexNormals();
  projectUV(n, s);
  P.add(key, n);
}

// Half-outline of a flattened arch of radius r (height r * k), left foot to right foot over the crown.
const archPts = (r, k, n = 20) => Array.from({ length: n + 1 }, (_, i) => { const a = Math.PI - (i * Math.PI) / n; return [Math.cos(a) * r, Math.sin(a) * r * k]; });
// A horseshoe band of the arch between radii r0 > r1, extruded along z from z0 to z1.
const archBand = (r0, r1, k, z0, z1) => frontProfile([...archPts(r0, k), ...archPts(r1, k).reverse()], z0, z1);

// the runway numbers as a decal
function numberMaterial(text) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 512;
  const g = c.getContext('2d');
  g.clearRect(0, 0, 256, 512);
  g.fillStyle = '#ecece4';
  g.font = 'bold 360px sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.save();
  g.scale(0.55, 1);
  g.fillText(text, 128 / 0.55, 260);
  g.restore();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return new THREE.MeshStandardMaterial({ map: t, transparent: true, alphaTest: 0.4, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
}

function runway(a) {
  const root = new THREE.Group();
  const P = new Parts(siteMats());
  const L = a.length, W = a.width;
  // the strip with its shoulders, and the blast pads
  const strip = scaleUV(plane(W, L, 0, 0.14, 0, -Math.PI / 2), W / 6, L / 6);
  P.add('asphalt', strip);
  for (const s of [-1, 1]) P.add('concrete', scaleUV(plane(8, L + 120, s * (W / 2 + 4), 0.12, 0, -Math.PI / 2), 8 / 6, (L + 120) / 6));
  for (const s of [-1, 1]) P.add('concrete', scaleUV(plane(W, 60, 0, 0.13, s * (L / 2 + 30), -Math.PI / 2), W / 6, 10), { tint: 0xd8d4c4 });
  // markings: centreline dashes, edge lines, threshold piano keys, touchdown zones, aiming points
  for (let z = -L / 2 + 120; z < L / 2 - 120; z += 50) P.add('paint', plane(0.9, 30, 0, 0.15, z + 15, -Math.PI / 2));
  for (const s of [-1, 1]) P.add('paint', plane(0.9, L, s * (W / 2 - 1), 0.15, 0, -Math.PI / 2));
  for (const e of [-1, 1]) {
    const zt = e * (L / 2 - 6 - 15);
    for (let i = 0; i < 8; i++) for (const s of [-1, 1]) P.add('paint', plane(1.8, 30, s * (3.2 + i * 2.6), 0.15, zt, -Math.PI / 2));
    for (const s of [-1, 1]) {
      P.add('paint', plane(10, 60, s * 7, 0.15, e * (L / 2 - 400), -Math.PI / 2)); // aiming point
      for (const k of [0, 1, 2]) P.add('paint', plane(1.8, 22, s * (6 + (k % 2) * 3), 0.15, e * (L / 2 - 550 - k * 150), -Math.PI / 2));
    }
  }
  // edge lights every 60 m, threshold lights green and red
  for (let z = -L / 2; z <= L / 2; z += 60) for (const s of [-1, 1]) P.add('lens', box(0.25, 0.3, 0.25, s * (W / 2 + 1.5), 0.15, z));
  for (let x = -W / 2; x <= W / 2; x += 3) for (const e of [-1, 1]) P.add('lens', box(0.25, 0.3, 0.25, x, 0.15, e * (L / 2 + 1)), { tint: e > 0 ? 0x8cffa0 : 0xff8c8c });
  // taxiway stubs toward the shelters
  for (const z of [-L * 0.3, L * 0.22]) {
    P.add('concrete', scaleUV(plane(160, 23, W / 2 + 80, 0.12, z, -Math.PI / 2), 160 / 6, 23 / 6));
    P.add('paint', plane(160, 0.5, W / 2 + 80, 0.14, z, -Math.PI / 2), { tint: 0xe8c040 });
  }
  P.build(root, { shadow: false });
  // the numbers, read from the approach end
  for (const [txt, e] of [['07', 1], ['25', -1]]) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(12, 24), numberMaterial(txt));
    m.rotation.set(-Math.PI / 2, 0, e > 0 ? 0 : Math.PI);
    m.position.set(0, 0.16, e * (L / 2 - 70));
    root.add(m);
  }
  root.traverse((o) => o.isMesh && (o.receiveShadow = true));
  return root;
}

// A dish on a stub mast: parabolic reflector with a rim, back hub and a feed on three struts.
function siteDish(P, x, y, z, R = 1.6, yaw = 0, tilt = -0.35) {
  const d = R * 0.3, F = (R * R) / (4 * d);
  const M = xf(x, y, z, tilt, yaw, 0);
  const at = (key, g) => P.add(key, g.applyMatrix4(M));
  at('white', dish(R, d, 0.04, 32));
  at('steel', new THREE.TorusGeometry(R, 0.03, 5, 32).translate(0, 0, -d));
  at('dark', zTube(0, 0.3, 0.2, 0.28, 10, 0, 0));
  for (let i = 0; i < 3; i++) {
    const a = Math.PI / 2 + (i / 3) * Math.PI * 2;
    at('steel', rod(V(Math.cos(a) * R, Math.sin(a) * R, -d), V(0, 0, -F), 0.025, 4));
  }
  at('dark', zTube(-F + 0.3, -F, 0.12, 0.08, 8, 0, 0));
  P.add('steel', yTube(y - 3.4, y - 0.4, 0.22, 0.22, 10, x, z));
  P.add('dark', box(0.9, 0.5, 0.9, x, y - 0.6, z));
}

// A row of sandbags: n bags along x, stacked rows, each course offset half a bag.
function sandbags(P, x, y, z, n, rows, ry = 0, bag = [0.55, 0.2, 0.32]) {
  const g = [];
  for (let r = 0; r < rows; r++) for (let i = 0; i < n; i++) {
    const off = (r % 2) * bag[0] * 0.5;
    g.push(box(bag[0] * 0.98, bag[1], bag[2], (i - (n - 1) / 2) * bag[0] + off, r * bag[1] * 0.9 + bag[1] / 2, ((i * 7 + r * 3) % 5 - 2) * 0.012));
  }
  for (const b of g) P.add('sand', b.applyMatrix4(xf(x, y, z, 0, ry, 0)));
}

function command() {
  const root = new THREE.Group();
  const P = new Parts(siteMats());
  const mound = (x, z) => -2 + 0.42 * 22 * Math.sqrt(Math.max(0, 1 - (x * x + z * z) / 484));
  // the bunker under an earth mound, its concrete portal facing the runway
  addCon(P, sphere(22, 0, -2, 0, 1, 0.42, 1, 36), 8, 'earth');
  addCon(P, box(9, 4.2, 3, 0, 2.1, -20.5));
  addCon(P, box(14, 1.2, 2, 0, 4.6, -20.5));
  addCon(P, box(10, 0.3, 2.4, 0, 5.35, -20.5)); // cornice
  for (const s of [-1, 1]) {
    addCon(P, box(1.2, 3.5, 8, s * 6.5, 1.5, -24.5)); // wing walls
    addCon(P, box(1.5, 0.25, 8.3, s * 6.5, 3.35, -24.5)); // their caps
    sandbags(P, s * 6.5, 3.45, -24.5, 12, 3, Math.PI / 2, [0.55, 0.22, 0.34]);
  }
  addCon(P, box(14, 0.12, 9, 0, 0.06, -27)); // apron in front of the portal
  addCon(P, box(8, 0.3, 1.2, 0, 0.15, -22.8)); // threshold step
  // the blast door: a frame, two leaves ribbed with channel, hinges, locking wheel, a hazard stripe
  P.add('dark', box(4.4, 3.4, 0.3, 0, 1.7, -22.0));
  for (const s of [-1, 1]) {
    P.add('green', box(1.95, 3.0, 0.2, s * 1.0, 1.55, -22.2));
    for (const y of [0.5, 1.5, 2.5]) P.add('steel', box(1.9, 0.12, 0.08, s * 1.0, y, -22.34));
    for (const x of [0.4, 1.0, 1.6]) P.add('steel', box(0.1, 2.9, 0.07, s * x, 1.55, -22.33));
    for (const y of [0.55, 2.55]) P.add('steel', box(0.14, 0.3, 0.18, s * 2.0, y, -22.2)); // hinges
  }
  P.add('steel', xTube(-0.3, 0.3, 0.04, 0.04, 8, 1.6, -22.5));
  P.add('steel', new THREE.TorusGeometry(0.26, 0.03, 5, 16).translate(0, 1.6, -22.52));
  for (let i = 0; i < 4; i++) P.add('steel', rod(V(0, 1.6, -22.52), V(Math.cos(i * Math.PI / 2) * 0.26, 1.6 + Math.sin(i * Math.PI / 2) * 0.26, -22.52), 0.015, 4));
  P.add('red', box(0.9, 0.25, 0.04, 0, 3.55, -22.2)); // sign board over the door
  P.add('white', box(0.8, 0.12, 0.02, 0, 3.55, -22.23));
  // intake and exhaust stacks on the mound: a concrete stub with a mushroom cap on legs
  for (const [x, z] of [[-5, 4], [4, -3], [7, 6]]) {
    const y = mound(x, z);
    addCon(P, yTube(y - 1, y + 1.2, 0.55, 0.5, 12, x, z));
    for (const [dx, dz] of [[0.5, 0], [-0.5, 0], [0, 0.5], [0, -0.5]]) P.add('steel', box(0.08, 0.5, 0.08, x + dx, y + 1.35, z + dz));
    P.add('steel', yTube(y + 1.6, y + 1.75, 0.85, 0.5, 12, x, z));
  }
  // a guyed antenna mast with cross arms and a beacon, whip antennas, a dish on a short tower
  const mx = -10, mz = 8, my = mound(mx, mz);
  P.add('steel', yTube(my - 1, 26, 0.18, 0.08, 8, mx, mz));
  for (const y of [8, 15, 22]) P.add('steel', box(2.4, 0.06, 0.06, mx, y, mz));
  for (const y of [8, 15, 22]) for (const s of [-1, 1]) P.add('steel', box(0.05, 0.5, 0.05, mx + s * 1.2, y, mz));
  P.add('red', sphere(0.22, mx, 26.3, mz, 1, 1, 1, 8));
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2 + 0.4;
    P.add('steel', rod(V(mx, 25, mz), V(mx + Math.sin(a) * 14, mound(mx + Math.sin(a) * 14, mz + Math.cos(a) * 14), mz + Math.cos(a) * 14), 0.014, 4)); // guys
    P.add('steel', rod(V(mx, 15, mz), V(mx + Math.sin(a) * 10, mound(mx + Math.sin(a) * 10, mz + Math.cos(a) * 10), mz + Math.cos(a) * 10), 0.012, 4));
  }
  for (const [x, z, h] of [[6, -2, 6], [-2, 10, 5], [11, 0, 7]]) {
    const y = mound(x, z);
    P.add('steel', yTube(y - 0.5, y + h, 0.05, 0.025, 6, x, z));
  }
  const dy = mound(9, 8);
  siteDish(P, 9, dy + 4.4, 8, 1.6, 0.5, -0.45);
  // diesel exhaust pipe and a cable run down the mound
  P.add('dark', yTube(mound(-12, -6) - 1, mound(-12, -6) + 2.5, 0.12, 0.12, 8, -12, -6));
  P.add('dark', yTube(mound(-12, -6) + 2.5, mound(-12, -6) + 2.6, 0.2, 0.2, 8, -12, -6));
  P.build(root);
  return root;
}

function shelter() {
  const root = new THREE.Group();
  const P = new Parts(siteMats());
  const R = 12, Ln = 34, k = 0.72;
  // the arched concrete shell, flattened, open toward -Z
  const arch = new THREE.CylinderGeometry(R, R, Ln, 36, 1, true, Math.PI / 2, Math.PI).rotateX(Math.PI / 2).scale(1, k, 1);
  addCon(P, arch, 6);
  const inner = new THREE.CylinderGeometry(R - 0.8, R - 0.8, Ln, 36, 1, true, Math.PI / 2, Math.PI).rotateX(Math.PI / 2).scale(1, k, 1);
  const inv = inner.toNonIndexed();
  const pa = inv.attributes.position.array;
  for (let i = 0; i < pa.length; i += 9) for (let c = 0; c < 3; c++) { const t = pa[i + 3 + c]; pa[i + 3 + c] = pa[i + 6 + c]; pa[i + 6 + c] = t; }
  inv.computeVertexNormals();
  addCon(P, inv, 6);
  // expansion rings every five metres, and a thicker portal ring at the front
  for (let z = -Ln / 2 + 5.5; z < Ln / 2 - 1; z += 5) addCon(P, archBand(R + 0.2, R - 0.3, k, z - 0.35, z + 0.35), 6);
  addCon(P, archBand(R + 0.35, R - 1.3, k, -Ln / 2 - 0.3, -Ln / 2 + 0.7), 6);
  // earth banked against both flanks, with the turf on it
  for (const s of [-1, 1]) addCon(P, sphere(1, s * (R + 1.0), -0.2, -1, 6.5, 3.8, Ln * 0.5, 24), 8, 'earth');
  // the rear wall, with air louvres, and the front doors (closed)
  addCon(P, archBand(R, 0.01, k, Ln / 2 - 1.2, Ln / 2));
  for (const x of [-6, 0, 6]) {
    P.add('dark', box(2.6, 1.8, 0.12, x, 2.4, Ln / 2 + 0.06));
    for (let i = 0; i < 6; i++) P.add('steel', box(2.5, 0.05, 0.08, x, 1.7 + i * 0.28, Ln / 2 + 0.14));
  }
  // exhaust port and its blast baffle
  addCon(P, box(4, 3, 3, 0, 1.5, Ln / 2 + 1.4));
  P.add('dark', box(2.6, 1.6, 0.2, 0, 1.6, Ln / 2 + 2.95));
  // the door: leaves of khaki-painted steel ribbed with channel, a centre seam, a track above
  const dz = -Ln / 2 + 0.6;
  P.add('green', frontProfile(archPts(R - 0.9, k), dz, dz + 0.6));
  const hAt = (x) => k * Math.sqrt(Math.max(0, (R - 0.9) ** 2 - x * x));
  for (let x = -10.5; x <= 10.5; x += 1.5) {
    if (Math.abs(x) < 0.1) continue;
    P.add('dark', box(0.3, hAt(x) - 0.2, 0.12, x, hAt(x) / 2, dz - 0.06));
  }
  for (const y of [1.6, 3.6, 5.4]) {
    const hw = Math.sqrt(Math.max(0, 1 - (y / (k * (R - 0.9))) ** 2)) * (R - 0.9);
    if (hw > 1) P.add('steel', box(hw * 2 - 0.4, 0.2, 0.1, 0, y, dz - 0.14));
  }
  P.add('dark', box(0.3, hAt(0) - 0.2, 0.2, 0, hAt(0) / 2, dz - 0.1)); // meeting seam
  P.add('steel', box(0.5, 0.6, 0.14, 0.9, 3.0, dz - 0.2)); // lock
  P.add('white', box(1.4, 0.8, 0.04, -5, 5.4, dz - 0.2)); // shelter number plate
  P.add('dark', box(1.1, 0.5, 0.05, -5, 5.4, dz - 0.23));
  // door rails across the apron, and the hardstand with its guide line
  P.add('steel', box(R * 2 - 1.5, 0.1, 0.18, 0, 0.1, dz - 0.9));
  addCon(P, box(26, 0.08, 30, 0, 0.04, -Ln / 2 - 15));
  P.add('paint', plane(0.4, 29, 0, 0.1, -Ln / 2 - 15, -Math.PI / 2), { tint: 0xe8c040 });
  for (const s of [-1, 1]) P.add('paint', plane(0.3, 12, s * 6, 0.1, -Ln / 2 - 14, -Math.PI / 2), { tint: 0xe8c040 });
  // vent hoods and a lightning rod along the crown
  const crown = (x) => k * Math.sqrt(Math.max(0, R * R - x * x));
  for (const [x, z] of [[-3, 8], [3, 8], [-3, 13], [3, 13]]) {
    addCon(P, box(1.3, 1.1, 1.3, x, crown(x) + 0.1, z));
    P.add('steel', box(1.6, 0.1, 1.6, x, crown(x) + 0.7, z));
  }
  P.add('steel', yTube(crown(0) - 0.2, crown(0) + 3.5, 0.04, 0.02, 5, 0, 12));
  // tie-down rings in the apron
  for (let x = -8; x <= 8; x += 4) P.add('steel', new THREE.TorusGeometry(0.2, 0.03, 4, 10).rotateX(Math.PI / 2).translate(x, 0.1, -Ln / 2 - 8));
  P.build(root);
  return root;
}

// A tank farm: tanks banded with weld seams and a wind girder, a stair winding up each one, bunds of
// earth, a manifold with wheel valves, a pump house and two floodlight masts.
function fuel() {
  const root = new THREE.Group();
  const P = new Parts(siteMats());
  const tint = 0xaeb59f; // pale grey-green tank paint
  for (const [x, z, ph] of [[-12, -12, 0.3], [12, -12, 2.1], [-12, 12, 4.0], [12, 12, 5.6]]) {
    P.add('white', yTube(0, 8, 7, 7, 40, x, z), { tint });
    P.add('white', sphere(7, x, 8, z, 1, 0.12, 1, 28), { tint });
    P.add('steel', yTube(8.6, 9.6, 0.25, 0.25, 8, x, z)); // vent
    P.add('steel', yTube(8.1, 8.2, 0.9, 0.9, 12, x + 2.5, z)); // manhole
    P.add('steel', yTube(8.1, 8.9, 0.1, 0.1, 6, x - 2.5, z + 1)); // foam chamber
    for (const y of [2.0, 4.0, 6.0]) P.add('dark', new THREE.TorusGeometry(7.02, 0.04, 4, 40).rotateX(Math.PI / 2).translate(x, y, z)); // weld seams
    P.add('steel', new THREE.TorusGeometry(7.1, 0.09, 5, 40).rotateX(Math.PI / 2).translate(x, 8.0, z)); // wind girder
    // handrail around the roof edge
    P.add('steel', new THREE.TorusGeometry(6.9, 0.03, 4, 40).rotateX(Math.PI / 2).translate(x, 8.0 + 1.0 - 0.1, z));
    for (let i = 0; i < 20; i++) { const a = (i / 20) * Math.PI * 2; P.add('steel', yTube(8.0, 9.0, 0.025, 0.025, 4, x + Math.cos(a) * 6.9, z + Math.sin(a) * 6.9)); }
    // a stair spiralling up the shell: treads, a stringer and a handrail
    const n = 22;
    let pa = null, pb = null;
    for (let i = 0; i <= n; i++) {
      const t = i / n, a = ph + t * Math.PI * 1.3, y = 0.3 + t * 7.7, r = 7.0;
      const cx = x + Math.cos(a) * (r + 0.5), cz = z + Math.sin(a) * (r + 0.5);
      P.add('steel', box(1.0, 0.05, 0.5, 0, 0, 0).applyMatrix4(xf(cx, y, cz, 0, -a + Math.PI / 2, 0)));
      const hx = x + Math.cos(a) * (r + 0.98), hz = z + Math.sin(a) * (r + 0.98);
      const pc = V(cx, y - 0.1, cz), ph2 = V(hx, y + 0.95, hz);
      if (pa) { P.add('dark', rod(pa, pc, 0.04, 4)); P.add('steel', rod(pb, ph2, 0.025, 4)); }
      if (i % 3 === 0) P.add('steel', rod(V(hx, y, hz), ph2, 0.02, 4));
      pa = pc;
      pb = ph2;
    }
  }
  // earth bunds around the farm: trapezoid sections along each side
  const bund = [[-3.2, 0], [-1.2, 2.5], [1.2, 2.5], [3.2, 0]];
  for (const s of [-1, 1]) {
    addCon(P, frontProfile(bund, -27, 27).applyMatrix4(xf(s * 25, 0, 0)), 8, 'earth');
    addCon(P, frontProfile(bund, -27, 27).applyMatrix4(xf(0, 0, s * 25, 0, Math.PI / 2, 0)), 8, 'earth');
  }
  addCon(P, box(48, 0.08, 48, 0, 0.04, 0), 6); // the gravel floor of the bund
  // manifold: pipes on sleepers, elbows, wheel valves
  P.add('steel', zTube(-12, 12, 0.3, 0.3, 10, 0, 0.7));
  P.add('steel', zTube(-16, 26, 0.3, 0.3, 10, 4, 0.7));
  P.add('steel', xTube(-12, 12, 0.22, 0.22, 10, 0.6, -12));
  P.add('steel', xTube(-12, 12, 0.22, 0.22, 10, 0.6, 12));
  for (let z = -14; z <= 24; z += 4) addCon(P, box(0.9, 0.35, 0.4, 2, 0.17, z)); // sleepers
  for (const [x, z] of [[0, -6], [0, 6], [4, 10], [4, 18], [-6, -12], [6, 12]]) {
    P.add('dark', yTube(0.6, 1.3, 0.1, 0.1, 6, x, z));
    P.add('red', new THREE.TorusGeometry(0.28, 0.035, 5, 14).rotateX(Math.PI / 2).translate(x, 1.35, z));
    P.add('steel', xTube(x - 0.28, x + 0.28, 0.02, 0.02, 4, 1.35, z));
    P.add('steel', zTube(z - 0.28, z + 0.28, 0.02, 0.02, 4, x, 1.35));
  }
  P.add('steel', zTube(16, 26, 0.3, 0.3, 10, 4, 0.7));
  // pump house: concrete, steel door, roof vents and an air conditioner, pipes in
  addCon(P, box(6, 3.5, 5, 0, 1.75, 31));
  addCon(P, box(6.4, 0.3, 5.4, 0, 3.65, 31));
  P.add('dark', box(1.4, 2.2, 0.1, 0, 1.1, 28.45));
  P.add('steel', box(1.2, 0.1, 0.1, 0, 1.2, 28.38));
  P.add('white', rbox(1.2, 0.45, 0.9, 0.05, 1.8, 4.1, 31.8));
  P.add('steel', yTube(3.8, 4.4, 0.2, 0.2, 8, -2, 29.8));
  P.add('steel', yTube(3.8, 4.4, 0.2, 0.2, 8, -2, 32.5));
  P.add('steel', zTube(26, 28.5, 0.3, 0.3, 10, 4, 0.7));
  // two floodlight masts at the corners
  for (const [x, z] of [[-28, -28], [28, 28]]) {
    P.add('steel', yTube(0, 14, 0.14, 0.08, 8, x, z));
    P.add('dark', box(1.6, 0.8, 0.3, x, 14.3, z));
    P.add('lens', box(1.4, 0.6, 0.04, x, 14.3, z - 0.18));
  }
  P.build(root);
  return root;
}

// The control tower: a concrete shaft with slit windows and a service ladder, a glazed cab under a
// shading roof with a balcony and rail, red and white banding, the radar and masts on the roof, and
// the operations building at its foot with its doors, windows and roof plant.
function tower() {
  const root = new THREE.Group();
  const P = new Parts(siteMats());
  addCon(P, rbox(4.5, 17, 4.5, 0.15, 0, 8.5, 0));
  for (const y of [3, 6, 9, 12]) for (const s of [-1, 1]) {
    P.add('glass', box(1.2, 0.5, 0.06, 0, y, s * 2.27)); // slit windows
    P.add('dark', box(1.3, 0.6, 0.04, 0, y, s * 2.26));
  }
  for (const [y0, c] of [[12.6, 'red'], [14.8, 'red'], [16.0, 'white']]) P.add(c, box(4.56, y0 === 16.0 ? 0.6 : 1.2, 4.56, 0, y0, 0));
  // service ladder up the shaft
  for (const s of [-1, 1]) P.add('steel', yTube(0.2, 16.6, 0.03, 0.03, 5, 0.3 + s * 0.22, -2.32));
  for (let y = 0.5; y < 16.5; y += 0.32) P.add('steel', xTube(0.08, 0.52, 0.015, 0.015, 4, y, -2.32));
  // the operations building
  addCon(P, box(16, 6, 10, 0, 3, 6));
  addCon(P, box(16.6, 0.4, 10.6, 0, 6.2, 6)); // parapet slab
  for (let x = -6; x <= 6; x += 3) {
    P.add('dark', box(1.8, 1.6, 0.1, x, 4, 0.98));
    P.add('glass', box(1.6, 1.4, 0.1, x, 4, 0.95));
    P.add('dark', box(1.6, 0.08, 0.2, x, 3.2, 0.9));
  }
  P.add('dark', box(1.6, 2.4, 0.1, 6.5, 1.2, 1.0)); // entrance door
  P.add('steel', box(0.1, 0.06, 0.1, 6.0, 1.2, 1.1));
  addCon(P, box(2.6, 0.2, 1.2, 6.5, 2.7, 0.4)); // canopy
  addCon(P, box(2.2, 0.2, 1.0, 6.5, 0.1, 0.4));
  P.add('white', rbox(1.4, 0.5, 1.0, 0.05, -4, 6.7, 4)); // roof air conditioners
  P.add('white', rbox(1.4, 0.5, 1.0, 0.05, -1.5, 6.7, 4));
  P.add('steel', yTube(6.4, 8.5, 0.12, 0.12, 8, 5, 8)); // flue
  P.add('steel', yTube(8.5, 8.6, 0.25, 0.1, 8, 5, 8));
  // the cab: a wider slab, glazing in dark mullions with a rail around the balcony, the roof
  addCon(P, box(8.4, 0.5, 8.4, 0, 17.25, 0));
  addCon(P, box(9.6, 0.2, 9.6, 0, 17.6, 0)); // balcony slab
  const rail = (y, x0, x1, z0, z1) => {
    P.add('steel', box(x1 - x0, 0.05, 0.05, (x0 + x1) / 2, y, z0));
    P.add('steel', box(x1 - x0, 0.05, 0.05, (x0 + x1) / 2, y, z1));
    P.add('steel', box(0.05, 0.05, z1 - z0, x0, y, (z0 + z1) / 2));
    P.add('steel', box(0.05, 0.05, z1 - z0, x1, y, (z0 + z1) / 2));
  };
  rail(18.6, -4.7, 4.7, -4.7, 4.7);
  rail(18.1, -4.7, 4.7, -4.7, 4.7);
  for (let i = -4; i <= 4; i += 1.5) for (const s of [-4.7, 4.7]) { P.add('steel', box(0.05, 1.0, 0.05, i, 18.1, s)); P.add('steel', box(0.05, 1.0, 0.05, s, 18.1, i)); }
  P.add('glass', box(7.4, 3, 7.4, 0, 19.3, 0));
  for (let i = -3; i <= 3; i += 1.5) for (const s of [-1, 1]) {
    P.add('dark', box(0.12, 3.1, 0.12, i, 19.3, s * 3.72));
    P.add('dark', box(0.12, 3.1, 0.12, s * 3.72, 19.3, i));
  }
  for (const y of [17.9, 20.8]) P.add('dark', box(7.6, 0.1, 7.6, 0, y, 0));
  addCon(P, box(10, 0.5, 10, 0, 21.2, 0)); // the shading roof
  P.add('white', box(10.2, 0.2, 10.2, 0, 21.55, 0));
  for (const [x, z] of [[-3.7, -3.7], [3.7, -3.7], [-3.7, 3.7], [3.7, 3.7]]) P.add('dark', box(0.25, 3, 0.25, x, 19.3, z));
  // roof gear: radar on a pedestal, a mast with a beacon, whips, an anemometer
  P.add('steel', yTube(21.6, 24, 0.5, 0.5, 10, -2.5, -2.5));
  P.add('white', box(2.8, 0.9, 0.15, -2.5, 24.5, -2.5));
  P.add('dark', box(2.9, 0.12, 0.2, -2.5, 24.05, -2.5));
  P.add('steel', yTube(21.6, 28, 0.08, 0.05, 6, 2, 2));
  P.add('red', sphere(0.25, 2, 28.2, 2, 1, 1, 1, 8));
  P.add('steel', box(1.6, 0.05, 0.05, 2, 26, 2));
  for (const [x, z, h] of [[3, -3, 4.5], [-3.5, 3, 3.5]]) P.add('steel', yTube(21.6, 21.6 + h, 0.03, 0.015, 5, x, z));
  P.add('steel', yTube(21.6, 23.2, 0.03, 0.03, 5, 3.6, 0.5));
  for (let i = 0; i < 3; i++) P.add('steel', rod(V(3.6, 23.2, 0.5), V(3.6 + Math.cos(i * 2.094) * 0.3, 23.25, 0.5 + Math.sin(i * 2.094) * 0.3), 0.02, 4));
  P.build(root);
  return root;
}

const BUILD = { runway, command, shelter, fuel, tower };

/** Registers asset builders, { kind: (asset) => THREE.Group } (an era's lazily loaded content, eras/index.js). */
export function registerAssets(builders) {
  Object.assign(BUILD, builders);
}

/** asset from deploy.js ASSETS -> THREE.Group (origin on the ground at the asset, model -Z along its bearing) */
export function buildAsset(asset) {
  const f = BUILD[asset.kind];
  const g = f ? f(asset) : new THREE.Group();
  g.name = asset.id ?? asset.kind;
  return g;
}

