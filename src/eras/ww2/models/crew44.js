import * as THREE from 'three';
import { crewGeometry, crewMaterial, crewDepthMaterial, ROW_W, T_TINT, T_MASK, T_BUILD, PART, TINT, JOINT, GRIP } from './figure44.js';
import { spec, resetSpec, solve, writeBones, newBody, boneToRoot, propGrips } from './pose44.js';
import { JOBS, ROLES, prepareRig } from './jobs44.js';
import { mulberry32 } from '../../../noise.js';

// German flak crews for the WW2 era (Fliegerhorst Hopsten, February to March 1945): a man at every crew spot
// of every WW2 gun rig (rig.anchors.crew, see kit44.js crewSpot), posed for his job, dressed for the late
// winter, cheap enough for a battery and three platoons on the map. The figure is figure44.js, the poses
// pose44.js, the jobs (which pose, prop and gear at which spot of which rig, and where the hands go)
// jobs44.js; this file is the instanced layer and the API.
//
// Cost: every man of every outfit is drawn by ONE InstancedMesh per level of detail ('near' up to NEAR m from
// the camera, about 6,000 triangles a man with every outfit piece in it; 'far' beyond, about 900), so all the
// crews on the map take 2 draw calls, plus 2 in the shadow pass. The skinning runs on the GPU from a float
// texture with one row per man (1 KB, uploaded for the men solved that frame); his pose is solved on the CPU
// (about 25 us: the job's targets and eye solve, then the IK) every frame within 30 m of the camera, every 2nd,
// 4th, 8th or 16th frame out to 80, 200, 500 m and beyond, and his root goes into the instance matrix every
// frame, so a man riding round on a gun's top carriage never lags it. Men outside the view frustum or beyond FAR
// m are not drawn and not solved. Measured (headless Chromium): the battery and the three platoons, 137 men,
// 0.7 ms a frame seen from afar, 0.9 ms with the camera at a gun.
//
// API (for render/units.js; nothing here reads the sim):
//   const crews = new Crew44(scene)            the layer; adds its two meshes to the scene. Built after
//                                              patchSceneFog is fine (its materials patch themselves).
//   const h = crews.place(rig, kind, opts)     crew a rig built by buildVehicle(kind): one man per spot in
//                                              rig.anchors.crew. kind: 'flak88' | 'kdo40' | 'wurzburg' |
//                                              'flak43' | 'flakvierling' | 'flakvierling-tower' | 'flak38'.
//     opts.seed       outfits, faces and idle timing (default: from the rig's position)
//     opts.mix        'luftwaffe' (default: soldiers with Luftwaffenhelfer on the technical posts, older men
//                     and Hiwis carrying ammunition, per refs/ww2/markings 5.1), 'helpers' (a schoolboy crew,
//                     as the 2 cm guns often had), 'rad' (a RAD flak crew in earth brown: the sources put RAD
//                     batteries in home defence, none named at an airfield, so it is an option, not a default)
//     opts.jobs       only these jobs (default every spot); opts.drop: jobs to leave out (a short crew)
//     opts.outfit     overrides for every man: { body: 'blouse' | 'coat' | 'parka', head: 'helmet' | 'cap43'
//                     | 'sidecap' | 'none', ... }; opts.men: { [job]: overrides } for one man
//   crews.update(dt, camera)                   every frame after the rigs are posed (turret, elevation,
//                                              recoil) and before rendering; dt drives the idle life (pass
//                                              the sim's dt to freeze them when paused)
//   h.setTarget(worldPos | null)               where the commanders, the range-takers and the trackers look
//                                              (default: along the gun's bore, or the instrument's line of
//                                              sight); pass the engaged aircraft for a livelier picture
//   h.setVisible(on), h.setStance('action' | 'easy')  stand down between raids ('easy': at ease, props put
//                                              away, the seated men sitting back)
//   h.man(job)                                 one man (below); h.men all of them
//   h.remove() or crews.remove(h)              take the crew off (a new battle, a knocked-out gun)
//   crews.clear(), crews.dispose(), crews.stats() -> { men, drawn, near, far, solved, draws, triangles }
// A man (the hooks for the firing and loading scenes; every field is optional and cleared with null):
//   m.job, m.label, m.spot, m.outfit           who he is and where
//   m.pose = { name, t, blend }                a pose44.js POSES pose (or a job pose name, e.g. 'carry')
//                                              instead of his job's; blend < 1 eases into it per frame
//   m.override = (m, S, ctx) => true           fill the specification yourself (pose44.js spec; ctx has the
//                                              rig's helpers, see jobs44.js); return false to fall back
//   m.prop = 'round88' | 'clip37' | 'mag20' | 'rangefinder' | 'bino' | 'handset' | null   what he holds
//                                              (undefined: the job's choice)
//   m.propWorld = Matrix4                      put the held prop there (world; e.g. a round going into the
//                                              breech); his hands keep their grips on it
//   m.look = Vector3                           a world point to look at
//   m.at = { x, y, z, heading }                stand him somewhere else (world; walking away from the spot)
//   m.loop = { name, t }                       a cycle the scene drives (walk, sidestep), same as m.pose
//   m.visible = false                          hide him (killed, gone for ammunition)
//   m.handWorld('L' | 'R', out), m.propPose(out: Matrix4)   where his hands and his prop are (world)

export const NEAR = 42; // m: the near level of detail out to here
export const FAR = 1600; // m: not drawn beyond
const CAP = 256; // men the layer can hold (the battery and three platoons are 137)

const V3 = THREE.Vector3;
const _m = new THREE.Matrix4(), _m2 = new THREE.Matrix4(), _v = new V3(), _v2 = new V3(), _q = new THREE.Quaternion(), _s = new V3();
const _frustum = new THREE.Frustum(), _sphere = new THREE.Sphere(), _pv = new THREE.Matrix4();
const S = spec();

// ---------------------------------------------------------------- outfits

// colours (sRGB) from refs/ww2/markings 5.2 to 5.5 (estimates there, E)
const C = {
  // (the sheet's estimates, darkened to sit with the Dunkelgrau guns as the 1943 photos show them)
  lw: [0x515a64, 0x5e6771, 0x4b535d, 0x565f69], // Luftwaffe blue-grey cloth: new, faded, dark, mid
  coat: [0x4a525c, 0x505862, 0x464d56],
  coverall: 0x2b2f35,
  parka: [0x67695f, 0x606567, 0x6d6e64],
  parkaWhite: 0xcfcdc3,
  helmet: [0x50575d, 0x4a5055, 0x555c61],
  helmetHeer: 0x535747,
  heer: [0x57594b, 0x5d5e53], // field grey (older men in Army kit)
  rad: [0x58493a, 0x524536],
  hiwi: [0x564f3d, 0x4c4739, 0x4d4a44],
  dark: [0x34363a, 0x3a3a36],
  skin: [0xc59c84, 0xb88d70, 0xd4ae96, 0xc9a088, 0xa98068],
  skinBoy: [0xd8b09a, 0xcfa58c, 0xe0bba6],
  hair: [0x3b2d21, 0x5b4431, 0x231b15, 0x6e5536, 0x8a7048, 0x4a3a2a],
  hairGrey: [0x8a8580, 0x6d6a66, 0x9c9894],
  glove: [0x4d4f50, 0x5a4632, 0x2a2624, 0x3e3b36],
};
const pick = (r, a) => a[Math.floor(r() * a.length) % a.length];
const chance = (r, p) => r() < p;
const lin = new THREE.Color();

// Dress one man for his role (ROLES in jobs44.js: gunner, tech, helper, carrier, nco) and the unit's mix.
function dress(r, role, mix, job, jobDef, over) {
  const o = { role, kit: new Set() };
  let who = 'soldier';
  if (mix === 'helpers') who = role === 'nco' ? 'soldier' : role === 'carrier' && chance(r, 0.4) ? 'older' : 'boy';
  else if (mix === 'rad') who = role === 'nco' && chance(r, 0.5) ? 'older' : chance(r, 0.15) ? 'boy' : 'rad';
  else {
    const p = ROLES[role] || ROLES.gunner;
    const x = r();
    who = x < p.boy ? 'boy' : x < p.boy + p.older ? 'older' : x < p.boy + p.older + (p.hiwi || 0) ? 'hiwi' : 'soldier';
  }
  if (who === 'rad' && mix !== 'rad') who = 'soldier';
  o.who = who;
  const boy = who === 'boy', old = who === 'older', hiwi = who === 'hiwi';
  // build
  o.height = boy ? 1.6 + r() * 0.12 : 1.68 + r() * 0.15 + (old ? -0.02 : 0);
  o.girth = boy ? 0.86 + r() * 0.06 : old ? 1.01 + r() * 0.08 : 0.96 + r() * 0.09;
  o.headScale = boy ? 1.09 : 1;
  o.mud = 0.25 + r() * 0.45;
  // headgear: steel helmets in action, M43 caps, side caps mostly on the helpers
  const hx = r();
  o.head = hiwi ? pick(r, ['cap43', 'none', 'sidecap', 'cap43']) : hx < (boy ? 0.5 : 0.6) ? 'helmet' : hx < (boy ? 0.72 : 0.88) ? 'cap43' : 'sidecap';
  // body: late winter; loaders and ammunition numbers seldom in the long coat
  const busy = jobDef.busy, bx = r();
  o.body = hiwi ? (bx < 0.5 ? 'blouse' : 'coat') : busy ? (bx < 0.55 ? 'blouse' : bx < 0.85 ? 'parka' : 'coat') : bx < 0.38 ? 'coat' : bx < 0.65 ? 'parka' : 'blouse';
  o.legs = chance(r, old || who === 'rad' ? 0.6 : boy ? 0.15 : 0.35) ? 'jackboots' : 'ankle';
  o.gloves = jobDef.gloves || chance(r, 0.45);
  if (chance(r, hiwi ? 0 : boy ? 0.3 : 0.5)) o.kit.add('gasmask');
  if (boy && chance(r, 0.35)) o.kit.add('scarf');
  // the belt over the blouse, coat or parka (the helpers of the Giessen photo wear none)
  if (!(boy && o.body === 'blouse' && chance(r, 0.5))) o.kit.add('belt');
  if (role === 'nco' && chance(r, 0.75)) o.kit.add('holster');
  for (const k of jobDef.kit || []) o.kit.add(k);
  // colours
  const lw = pick(r, C.lw);
  o.tunic = who === 'rad' ? pick(r, C.rad) : hiwi ? pick(r, C.hiwi) : old && chance(r, 0.4) ? pick(r, C.heer) : chance(r, boy ? 0.08 : 0.15) ? C.coverall : lw;
  o.trousers = who === 'rad' ? o.tunic : hiwi ? pick(r, C.dark) : o.tunic === C.coverall ? C.coverall : chance(r, 0.7) ? lw : pick(r, C.lw);
  o.coat = o.body === 'parka' ? (chance(r, 0.04) ? C.parkaWhite : pick(r, C.parka)) : who === 'rad' ? pick(r, C.rad) : hiwi ? pick(r, C.hiwi) : old && o.tunic !== lw ? pick(r, C.heer) : pick(r, C.coat);
  o.headgear = o.head === 'helmet' ? (who === 'rad' ? C.helmetHeer : pick(r, C.helmet)) : hiwi ? pick(r, C.hiwi) : who === 'rad' ? o.tunic : lw;
  o.skin = boy ? pick(r, C.skinBoy) : pick(r, C.skin);
  o.hair = old ? pick(r, C.hairGrey) : pick(r, C.hair);
  o.hands = o.gloves ? pick(r, C.glove) : o.skin;
  Object.assign(o, over || {});
  if (over && over.kit) o.kit = new Set(over.kit);
  return o;
}

function maskOf(o, prop) {
  const P = PART;
  let m = 0;
  const on = (b) => { m |= 1 << b; };
  on(o.body === 'coat' ? P.coat : o.body === 'parka' ? P.parka : P.blouse);
  on(o.legs === 'jackboots' ? P.jackboots : P.ankle);
  if (o.head === 'helmet') on(P.helmet); else if (o.head === 'cap43') on(P.cap43); else if (o.head === 'sidecap') on(P.sidecap);
  for (const k of o.kit) if (P[k] !== undefined) on(P[k]);
  if (prop && P[prop] !== undefined) on(P[prop]);
  if (prop === 'mag20pair') { on(P.mag20); on(P.mag20L); }
  if (prop === 'bino') m &= ~(1 << P.binoChest); // the binoculars are in his hands
  return m;
}

// ---------------------------------------------------------------- the layer

export class Crew44 {
  constructor(scene, { capacity = CAP } = {}) {
    this.scene = scene;
    this.cap = capacity;
    this.data = new Float32Array(ROW_W * 4 * capacity);
    this.tex = new THREE.DataTexture(this.data, ROW_W, capacity, THREE.RGBAFormat, THREE.FloatType);
    this.tex.minFilter = this.tex.magFilter = THREE.NearestFilter;
    this.tex.generateMipmaps = false;
    this.tex.needsUpdate = true;
    // until the texture has been uploaded once every upload is a whole one (partial ranges need its storage)
    this.uploaded = false;
    this.tex.onUpdate = () => { this.uploaded = true; };
    this.dirty = new Set();
    this.free = Array.from({ length: capacity }, (_, i) => capacity - 1 - i);
    this.handles = [];
    this.frame = 0;
    const mat = crewMaterial(this.tex), depth = crewDepthMaterial();
    this.meshes = ['near', 'far'].map((lod) => {
      const g = crewGeometry(lod).clone();
      const rows = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1);
      rows.setUsage(THREE.DynamicDrawUsage);
      g.setAttribute('aRow', rows);
      const mesh = new THREE.InstancedMesh(g, mat, capacity);
      mesh.name = 'crew44-' + lod;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.customDepthMaterial = depth;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      mesh.raycast = () => {};
      mesh.count = 0;
      mesh.visible = false;
      mesh.userData.tris = g.index.count / 3;
      scene.add(mesh);
      return mesh;
    });
    this.info = { men: 0, drawn: 0, near: 0, far: 0, solved: 0 };
  }

  place(rig, kind, opts = {}) {
    const jobs = JOBS[kind];
    if (!jobs) throw new Error(`crew44: no jobs for '${kind}'`);
    const spots = rig.anchors.crew || {};
    rig.root.updateWorldMatrix(true, true);
    const p = rig.root.position;
    const seed = opts.seed ?? ((Math.round(p.x * 7.3) * 73856093) ^ (Math.round(p.z * 3.1) * 19349663) ^ kind.length * 83492791);
    const r = mulberry32(seed >>> 0);
    const h = new Handle(this, rig, kind, prepareRig(rig, kind));
    for (const [job, spot] of Object.entries(spots)) {
      const def = jobs[job];
      if (!def) continue;
      if (opts.jobs && !opts.jobs.includes(job)) continue;
      if (opts.drop && opts.drop.includes(job)) continue;
      if (!this.free.length) { console.warn('crew44: capacity reached'); break; }
      const over = { ...(opts.outfit || {}), ...((opts.men && opts.men[job]) || {}) };
      const o = dress(r, def.role || 'gunner', opts.mix || 'luftwaffe', job, def, over);
      spot.updateMatrix();
      const m = new Man(h, job, spot, def, o, this.free.pop(), r());
      h.men.push(m);
      this.writeLook(m);
    }
    this.handles.push(h);
    this.info.men += h.men.length;
    return h;
  }

  remove(h) {
    const i = this.handles.indexOf(h);
    if (i < 0) return;
    this.handles.splice(i, 1);
    for (const m of h.men) this.free.push(m.row);
    this.info.men -= h.men.length;
    h.men.length = 0;
  }

  clear() { for (const h of [...this.handles]) this.remove(h); }

  dispose() {
    this.clear();
    for (const m of this.meshes) { this.scene.remove(m); m.geometry.dispose(); }
    this.tex.dispose();
  }

  // the tints, the mask and the build into the man's row
  writeLook(m) {
    const o = m.outfit, d = this.data, base = m.row * ROW_W * 4;
    const tint = (ch, hex) => { lin.setHex(hex); const k = base + (T_TINT + ch) * 4; d[k] = lin.r; d[k + 1] = lin.g; d[k + 2] = lin.b; d[k + 3] = 1; };
    // the shared outer garment takes the coat's colour when he wears one; slot 0 holds its bulk and quilting
    tint(TINT.tunic, o.body === 'blouse' ? o.tunic : o.coat); tint(TINT.trousers, o.trousers); tint(TINT.coat, o.coat); tint(TINT.headgear, o.headgear);
    { const k = base + T_TINT * 4; d[k] = o.body === 'coat' ? 0.014 : o.body === 'parka' ? 0.03 : 0; d[k + 1] = o.body === 'parka' ? 1 : 0; d[k + 2] = 0; d[k + 3] = 0; }
    tint(TINT.skin, o.skin); tint(TINT.hair, o.hair); tint(TINT.hands, o.hands);
    m.mask = maskOf(o, m.propNow);
    const k = base + T_MASK * 4;
    d[k] = m.mask & 0xffffff; d[k + 1] = (m.mask >>> 24) & 0xffffff;
    const b = base + T_BUILD * 4;
    d[b] = o.girth; d[b + 1] = o.headScale; d[b + 2] = o.mud; d[b + 3] = m.seed * 17;
    this.dirty.add(m.row);
  }

  update(dt, camera) {
    this.frame++;
    camera.updateMatrixWorld();
    _pv.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    _frustum.setFromProjectionMatrix(_pv);
    const cam = camera.getWorldPosition(_v2);
    const [nearM, farM] = this.meshes;
    const nRows = nearM.geometry.attributes.aRow.array, fRows = farM.geometry.attributes.aRow.array;
    const nMat = nearM.instanceMatrix.array, fMat = farM.instanceMatrix.array;
    let nn = 0, nf = 0, solved = 0;
    for (const h of this.handles) {
      if (!h.visible) continue;
      if (h.rig.root.position.distanceToSquared(cam) > (FAR + 30) ** 2) { for (const m of h.men) m.drawn = false; continue; }
      h.prepare(); // the rig's matrices for this frame (the placements and the jobs read them)
      h.ready = true;
      for (const m of h.men) {
        m.clock += dt;
        m.drawn = false;
        if (m.visible === false) continue;
        h.root(m, dt); // m.W: his root matrix (world, scaled)
        const e = m.W.elements;
        _v.set(e[12], e[13], e[14]);
        const dist = _v.distanceTo(cam);
        m.dist = dist;
        if (dist > FAR) continue;
        _sphere.center.set(e[12], e[13] + 0.9, e[14]);
        _sphere.radius = 1.6;
        if (!_frustum.intersectsSphere(_sphere)) continue;
        // solve near men every frame, further ones less often (staggered by row)
        const every = dist < 30 ? 1 : dist < 80 ? 2 : dist < 200 ? 4 : dist < 500 ? 8 : 16;
        if (m.last < 0 || (this.frame + m.row) % every === 0 || m.hooked()) {
          if (!h.ready) { h.prepare(); h.ready = true; }
          this.solveMan(h, m, dt * (m.last < 0 ? 1 : Math.min(every, this.frame - m.last)));
          m.last = this.frame;
          solved++;
        }
        m.drawn = true;
        if (dist < NEAR) { nRows[nn] = m.row; nMat.set(e, nn * 16); nn++; } else { fRows[nf] = m.row; fMat.set(e, nf * 16); nf++; }
      }
    }
    nearM.count = nn; farM.count = nf;
    nearM.visible = nn > 0; farM.visible = nf > 0;
    for (const mesh of this.meshes) { mesh.instanceMatrix.needsUpdate = true; mesh.geometry.attributes.aRow.needsUpdate = true; }
    if (this.dirty.size) {
      // a row per man solved this frame (1 KB each); a whole upload (256 KB) when most of them were
      if (!this.uploaded || this.dirty.size >= 48) this.tex.clearUpdateRanges();
      else for (const row of this.dirty) this.tex.addUpdateRange(row * ROW_W * 4, ROW_W * 4);
      this.tex.needsUpdate = true;
      this.dirty.clear();
    }
    Object.assign(this.info, { drawn: nn + nf, near: nn, far: nf, solved });
  }

  solveMan(h, m, dt) {
    resetSpec(S);
    S.prop.s = 1.78 / m.outfit.height; // props are real size in his scaled root space
    const ctx = h.ctx(m, dt);
    const want = m.prop !== undefined ? m.prop : m.def.prop?.(ctx, m) ?? null;
    let done = false;
    if (m.override) done = m.override(m, S, ctx) === true;
    if (!done) {
      const name = (m.loop && m.loop.name) || (m.pose && m.pose.name);
      if (name) done = ctx.library(name, m.loop ? m.loop.t : m.pose.t ?? 0);
    }
    if (!done) {
      if (h.stance === 'easy' && m.def.easy) m.def.easy(ctx, m, S);
      else m.def.pose(ctx, m, S);
    }
    // what he holds shows only while a pose holds it (a library pose or the easy stance puts it away)
    const prop = S.prop.on ? want : null;
    if (prop !== m.propNow) { m.propNow = prop; this.writeLook(m); }
    if (m.propWorld && S.prop.on) {
      _m.copy(m.inv).multiply(m.propWorld);
      _m.decompose(S.prop.pos, S.prop.q, _s);
      S.prop.s = _s.x;
      propGrips(S);
    }
    ctx.finishHands(S);
    const blend = m.pose && m.pose.blend != null ? m.pose.blend : 1;
    solve(S, m.body, blend);
    writeBones(m.body, this.data, m.row * ROW_W * 4);
    this.dirty.add(m.row);
  }

  stats() {
    const [n, f] = this.meshes;
    const draws = (n.count ? 1 : 0) + (f.count ? 1 : 0);
    return { ...this.info, draws, shadowDraws: draws, triangles: n.count * n.userData.tris + f.count * f.userData.tris, trisNear: n.userData.tris, trisFar: f.userData.tris };
  }
}

class Handle {
  constructor(layer, rig, kind, R) {
    this.layer = layer; this.rig = rig; this.kind = kind; this.R = R; // R: the rig's prepared parts (jobs44.js)
    this.men = []; this.visible = true; this.stance = 'action'; this.target = null; this.ready = false;
  }
  man(job) { return this.men.find((m) => m.job === job) || null; }
  setTarget(p) { this.target = p ? (this.target || new V3()).copy(p) : null; }
  setVisible(on) { this.visible = !!on; }
  setStance(s) { this.stance = s === 'easy' ? 'easy' : 'action'; }
  remove() { this.layer.remove(this); }
  // the rig's matrices for this frame (only the nodes the jobs read)
  prepare() { this.R.update(this.rig); }
  // the man's root matrix: his spot (or m.at), turned or carried round by his job, scaled by his height
  root(m, dt) {
    const sc = m.outfit.height / 1.78;
    if (m.at) {
      m.W.compose(_v.set(m.at.x, m.at.y, m.at.z), _q.setFromAxisAngle(_v2.set(0, 1, 0), m.at.heading || 0), _s.set(sc, sc, sc));
    } else {
      // the spot's parent was brought up to date by prepare(); the spot itself never moves on it
      m.W.multiplyMatrices(m.spot.parent.matrixWorld, m.spot.matrix);
      const dy = this.R.dy.get(m.spot);
      if (dy) m.W.elements[13] += dy;
      if (m.def.place) m.def.place(this, m, dt); // follow the mount, turn toward the target
      m.W.multiply(_m.makeScale(sc, sc, sc));
    }
    m.inv.copy(m.W).invert();
  }
  ctx(m, dt) { return this.R.context(this, m, dt, S); }
}

class Man {
  constructor(h, job, spot, def, outfit, row, seed) {
    this.h = h; this.job = job; this.spot = spot; this.def = def; this.outfit = outfit; this.row = row; this.seed = seed;
    this.label = spot.userData.label || job;
    this.rnd = mulberry32(Math.floor(seed * 4294967296) >>> 0);
    this.body = newBody(outfit.girth);
    this.st = {}; // the eye solve's state and the job's own (timers, the turn)
    this.W = new THREE.Matrix4(); this.inv = new THREE.Matrix4();
    this.clock = seed * 100; this.last = -1; this.dist = 0; this.drawn = false;
    this.mask = 0; this.propNow = null;
    this.pose = null; this.override = null; this.prop = undefined; this.propWorld = null; this.look = null; this.at = null; this.loop = null; this.visible = true;
  }
  hooked() { return !!(this.override || this.pose || this.propWorld || this.at || this.loop); }
  handWorld(side, out = new V3()) {
    const i = side === 'L' || side === 0 ? 0 : 1;
    _v.set(...JOINT[i ? 'handR' : 'handL']).add(GRIP[i]);
    return boneToRoot(this.body, i ? 10 : 7, _v, out).applyMatrix4(this.W);
  }
  propPose(out = new THREE.Matrix4()) {
    return out.compose(this.body.prop.pos, this.body.prop.q, _s.set(1, 1, 1)).premultiply(this.W);
  }
}

export { JOBS } from './jobs44.js';
