import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { buildVehicle, VEHICLE_KINDS } from '../models/vehicles.js';
import { buildThreat, buildInterceptor, THREAT_TYPES, INTERCEPTOR_KINDS } from '../models/threats.js';
import { buildAsset } from '../models/site.js';
import { ASSETS } from '../deploy.js';
import { buildCrewman, CREW_POSES, CREW_GAITS, CREW_OUTFITS } from '../models/v/crew.js';

// Standalone model viewer. ?kind=pantsir | cruise | 48N6 | asset:runway ; ?all=vehicles|threats|interceptors|assets ;
// &anim=1 animates pivots and spinning parts ; &cam=az,el,dist (az 0 = from the front, 90 = from the right) ;
// &pose=turret:0.5,elevation:0.6,erector:1.57 sets pivots (turret, searchRadar and crane about y, others about x,
// `trackRadar.z:0.3` picks the axis, `deploy:0` calls setDeploy) ; &loaded=0 hides the missile slots ; &night=1 dims the sun.
// &ortho=right|left|front|rear|top: an orthographic blueprint view with a 1 m grid behind the model (5 m lines
// darker), for comparing proportions against reference photos and drawings.
// ?kind=crew (or ?all=crew, every pose in a row): the crew figure; &pose=walk picks a pose, &t=0.25 its
// phase, &anim=1 animates the pose (or cycles through all of them without &pose); outfit with
// &headgear=cap|helmet|hardhat|none &vest=none|webbing|hiviz &pattern=emr|olive &gloves=0 &skin=0..3;
// &mix=1 varies the outfits along ?all=crew; &load=0 hides the stand-in load on the carry anchor.
const q = new URLSearchParams(location.search);
const VEHICLES = VEHICLE_KINDS; // every registered vehicle, new builders included

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.85;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x9db4c6);
scene.fog = new THREE.Fog(0x9db4c6, 120, 600);
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.55;
scene.add(new THREE.HemisphereLight(0xcfe3ff, 0x6a6048, 0.5));
const sun = new THREE.DirectionalLight(0xfff0d8, 2.6);
sun.position.set(-40, 70, -30);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -40, right: 40, top: 40, bottom: -40, near: 1, far: 250 });
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.03;
scene.add(sun, sun.target);

const ground = new THREE.Mesh(new THREE.PlaneGeometry(2000, 2000), new THREE.MeshStandardMaterial({ color: 0x6f6a55, roughness: 1 }));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);
const grid = new THREE.GridHelper(200, 200, 0x444444, 0x555555);
grid.material.opacity = 0.25;
grid.material.transparent = true;
scene.add(grid);

let camera = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 0.1, 3000);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = false;

const items = []; // { root, rig, kind }
const labels = [];
const anim = q.get('anim') === '1';
const pose = {};
for (const kv of (q.get('pose') || '').split(',')) { const [k, v] = kv.split(':'); if (k) pose[k] = Number(v); }

const crewPose = q.get('kind') === 'crew' ? q.get('pose') : null;
const crewT = Number(q.get('t') || 0);
const CARRIED = ['carry', 'carryWalk', 'carryShoulder', 'crouch', 'reachUp', 'push'];
// viewer-only stand-ins: a 1.8 m container on the carry anchor (held from below, so it sits above the
// anchor; along it for push), and a vehicle side with rungs 0.3 m apart for climb
function crewProps(fig) {
  const mat = new THREE.MeshStandardMaterial({ color: 0x8a9a7a, roughness: 0.6 });
  const load = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 1.8, 16).rotateZ(Math.PI / 2), mat);
  load.castShadow = true;
  fig.anchors.carry.add(load);
  const wall = new THREE.Group();
  const side = new THREE.Mesh(new THREE.BoxGeometry(1.4, 3.2, 0.1), new THREE.MeshStandardMaterial({ color: 0x4d5a3c, roughness: 0.8 }));
  side.position.set(0, 1.4, -0.42);
  wall.add(side);
  for (let i = -1; i < 9; i++) {
    const r = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.025, 0.1), mat);
    r.position.set(0, -0.068 + 0.3 * i, -0.3);
    const h = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.6, 8).rotateZ(Math.PI / 2), mat);
    h.position.set(0, 1.25 + 0.3 * i - 0.6, -0.33);
    wall.add(r, h);
  }
  fig.root.add(wall);
  return { load, wall };
}
function showCrewProps(rig, name, t) {
  const p = rig.props;
  p.load.visible = q.get('load') !== '0' && CARRIED.includes(name);
  const r = name === 'carryShoulder' ? 0.6 : 1; // a slimmer tube on the shoulder
  p.load.scale.set(1, r, r);
  p.load.position.set(name === 'push' ? 0.9 : 0, name === 'push' ? 0 : 0.14 * r + 0.01, 0);
  p.wall.visible = name === 'climb';
  p.wall.position.y = -CREW_GAITS.climb.rise * fract(t) + 0.3 * Math.floor(2 * fract(t));
}
const fract = (x) => x - Math.floor(x);

function addItem(kind, x) {
  let root, rig = null, info = '';
  if (kind === 'crew' || kind.startsWith('crew:')) {
    const fig = buildCrewman(q.get('mix') === '1' ? CREW_OUTFITS[items.length % CREW_OUTFITS.length] : { headgear: q.get('headgear') || undefined,
      vest: q.get('vest') || undefined, pattern: q.get('pattern') || undefined, gloves: q.get('gloves') !== '0', skin: Number(q.get('skin') || 0) });
    root = fig.root;
    const name = kind.startsWith('crew:') ? kind.slice(5) : (crewPose || 'stand');
    rig = { crew: fig, pose: name };
    fig.pose(name, crewT, 1);
  } else if (kind.startsWith('asset:')) {
    const id = kind.slice(6);
    const a = ASSETS.find((s) => s.kind === id) || ASSETS[0];
    root = buildAsset({ ...a, x: 0, z: 0 });
  } else if (VEHICLES.includes(kind)) {
    rig = buildVehicle(kind);
    root = rig.root;
  } else {
    const t = THREAT_TYPES.includes(kind) ? buildThreat(kind) : buildInterceptor(kind);
    root = new THREE.Group();
    t.meshes = t.parts.map((p) => {
      const m = new THREE.Mesh(p.geometry, p.material);
      m.castShadow = true;
      if (p.pivot) { m.position.copy(p.pivot); m.geometry = p.geometry.clone().translate(-p.pivot.x, -p.pivot.y, -p.pivot.z); }
      root.add(m);
      return m;
    });
    if (t.plume) { const s = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff8800 })); s.position.copy(t.plume); root.add(s); }
    rig = { threat: t };
    root.position.y = Math.max(1, t.length * 0.15);
  }
  root.position.x = x;
  scene.add(root);
  root.updateMatrixWorld(true);
  root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  let tris = 0, draws = 0;
  root.traverse((o) => { if (o.isMesh) { draws++; const g = o.geometry; tris += (g.index ? g.index.count : g.attributes.position.count) / 3; } });
  const box = new THREE.Box3().setFromObject(root);
  items.push({ root, rig, kind, box, tris, draws });
  if (rig && rig.crew) { rig.props = crewProps(rig.crew); showCrewProps(rig, rig.pose, crewT); } // after the bounds and counts
  // pivots that slew turn about y, the rest tilt about x; `name.z:v` picks the axis, `deploy:v` calls setDeploy
  const YAW = new Set(['turret', 'searchRadar', 'crane']);
  if (rig && rig.pivots) for (const [key, v] of Object.entries(pose)) {
    if (key === 'deploy') { rig.setDeploy?.(v); continue; }
    const [k, axis] = key.split('.');
    if (rig.pivots[k]) rig.pivots[k].rotation[axis || (YAW.has(k) ? 'y' : 'x')] = v;
  }
  if (rig && rig.setLoaded && q.get('loaded') === '0') for (let i = 0; i < 16; i++) rig.setLoaded(i, false);
  const label = document.createElement('div');
  label.className = 'label';
  label.textContent = `${kind}  ${Math.round(tris)} tris, ${draws} draws`;
  document.body.appendChild(label);
  labels.push({ el: label, root });
  return items[items.length - 1];
}

const all = q.get('all');
let list;
if (all === 'vehicles') list = VEHICLES;
else if (all === 'threats') list = THREAT_TYPES;
else if (all === 'interceptors') list = INTERCEPTOR_KINDS;
else if (all === 'assets') list = ['runway', 'command', 'shelter', 'fuel', 'tower'].map((k) => 'asset:' + k);
else if (all === 'crew') list = CREW_POSES.map((p) => 'crew:' + p);
else list = [q.get('kind') || 'pantsir'];

let xo = 0;
for (const k of list) {
  const spacing = all === 'vehicles' ? 16 : all === 'assets' ? 120 : all === 'interceptors' ? 8 : all === 'crew' ? 1.7 : 20;
  addItem(k, xo);
  xo += spacing;
}
const info = document.getElementById('info');
const r0 = items[0];
const center = new THREE.Vector3();
const bb = new THREE.Box3();
for (const it of items) bb.union(it.box);
bb.getCenter(center);
if (items.length === 1) {
  const eye = r0.rig && r0.rig.anchors && r0.rig.anchors.eye;
  if (eye) { r0.root.updateMatrixWorld(true); eye.getWorldPosition(center); }
}
const size = bb.getSize(new THREE.Vector3());
const cam = (q.get('cam') || '').split(',').map(Number);
const dist = cam[2] || Math.max(size.length() * 1.1, 6);
const az = (cam[0] ?? 35) * Math.PI / 180, el = (isNaN(cam[1]) ? 18 : cam[1]) * Math.PI / 180;
camera.position.set(center.x + dist * Math.sin(az) * Math.cos(el), center.y + dist * Math.sin(el), center.z - dist * Math.cos(az) * Math.cos(el));
controls.target.copy(center);
controls.update();
sun.target.position.copy(center);
sun.position.copy(center).add(new THREE.Vector3(-40, 70, -30));
if (size.x > 60 || size.z > 60) {
  const R = Math.max(size.x, size.z);
  Object.assign(sun.shadow.camera, { left: -R, right: R, top: R, bottom: -R, far: R * 4 });
  sun.position.copy(center).add(new THREE.Vector3(-R, R * 1.5, -R * 0.6));
  sun.shadow.mapSize.set(4096, 4096);
}
sun.shadow.camera.updateProjectionMatrix();

const ortho = q.get('ortho');
if (ortho) {
  // the view axis (from the camera toward the model) and the screen's up
  const AX = { right: [1, 0, 0], left: [-1, 0, 0], front: [0, 0, -1], rear: [0, 0, 1], top: [0, 1, 0] }[ortho] || [1, 0, 0];
  const dir = new THREE.Vector3(...AX);
  const c = bb.getCenter(new THREE.Vector3());
  const half = Math.max(size.x, size.y, size.z) * 0.62 + 0.5;
  const aspect = innerWidth / innerHeight;
  camera = new THREE.OrthographicCamera(-half * aspect, half * aspect, half, -half, 0.1, 1000);
  camera.position.copy(c).addScaledVector(dir, 200);
  camera.up.set(0, ortho === 'top' ? 0 : 1, ortho === 'top' ? -1 : 0);
  camera.lookAt(c);
  controls.enabled = false;
  // metre grid on a plane behind the model, facing the camera
  const L = Math.ceil(half * 2 * Math.max(aspect, 1)) + 4;
  const grid = new THREE.Group();
  const minor = new THREE.GridHelper(L, L, 0x6d7a86, 0x6d7a86);
  const major = new THREE.GridHelper(L, L / 5, 0x2e3b47, 0x2e3b47);
  minor.material.opacity = 0.35;
  minor.material.transparent = true;
  grid.add(minor, major);
  // GridHelper lies in XZ; turn it to face the view axis, and put it behind the model
  if (ortho === 'top') grid.position.set(Math.round(c.x), bb.min.y - 0.05, Math.round(c.z));
  else {
    grid.rotation.x = Math.PI / 2;
    if (ortho === 'right' || ortho === 'left') grid.rotation.z = Math.PI / 2;
    const back = ortho === 'right' ? bb.min.x - 1 : ortho === 'left' ? bb.max.x + 1 : ortho === 'front' ? bb.max.z + 1 : bb.min.z - 1;
    if (ortho === 'right' || ortho === 'left') grid.position.set(back, 0, Math.round(c.z));
    else grid.position.set(Math.round(c.x), 0, back);
  }
  scene.add(grid);
  ground.visible = ortho === 'top' ? false : ground.visible;
  scene.fog = null;
}
if (q.get('night') === '1') { sun.intensity = 0.2; scene.environmentIntensity = 0.15; scene.background = new THREE.Color(0x10151c); scene.fog.color.set(0x10151c); }
info.textContent = items.map((i) => `${i.kind}: ${Math.round(i.tris)} tris, ${i.draws} draws, ${i.box.getSize(new THREE.Vector3()).toArray().map((v) => v.toFixed(1)).join(' x ')} m`).join('\n');

const clock = new THREE.Clock();
let tPrev = 0;
function frame() {
  const t = clock.getElapsedTime(), dtv = Math.min(0.1, t - tPrev);
  tPrev = t;
  if (anim) for (const it of items) {
    const p = it.rig && it.rig.pivots;
    if (p) {
      if (p.turret) p.turret.rotation.y = Math.sin(t * 0.6) * 1.2;
      if (p.elevation) p.elevation.rotation.x = 0.35 + Math.sin(t * 0.9) * 0.35;
      if (p.searchRadar) p.searchRadar.rotation.y = t * 2.0;
      if (p.trackRadar) p.trackRadar.rotation.y = Math.sin(t * 0.8) * 0.8;
      if (p.erector) p.erector.rotation.x = (0.5 + 0.5 * Math.sin(t * 0.5)) * Math.PI / 2;
    }
    if (it.rig && it.rig.crew) {
      // with a pose: animate it (cycles at their natural rate); without: cycle through every pose
      const cyc = crewPose || it.kind.startsWith('crew:') ? null : CREW_POSES[Math.floor(t / 3.5) % CREW_POSES.length];
      const name = cyc || it.rig.pose, period = name === 'walk' ? CREW_GAITS.walk.period : name === 'carryWalk' ? CREW_GAITS.carryWalk.period : name === 'climb' ? CREW_GAITS.climb.period : 3;
      const ph = fract(t / period);
      it.rig.crew.pose(name, ph, cyc ? 1 - Math.exp(-8 * dtv) : 1);
      showCrewProps(it.rig, name, ph);
    }
    if (it.rig && it.rig.threat) {
      const th = it.rig.threat;
      th.parts.forEach((pt, i) => { if (pt.spin) { const m = th.meshes[i]; m.rotation[pt.spin] = t * 20; } });
    }
  }
  for (const l of labels) {
    const p = l.root.position.clone().add(new THREE.Vector3(0, -0.1, 0)).project(camera);
    l.el.style.left = ((p.x * 0.5 + 0.5) * innerWidth) + 'px';
    l.el.style.top = ((-p.y * 0.5 + 0.5) * innerHeight + 4) + 'px';
    l.el.style.display = items.length > 1 ? 'block' : 'none';
  }
  controls.update();
  renderer.render(scene, camera);
  window.__ready = true;
}
renderer.setAnimationLoop(frame);
addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });
window.__viewer = { scene, items, camera, controls, renderer };
