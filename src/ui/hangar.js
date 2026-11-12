import { STILLS, stillUrl } from './backdrop.js';

// The menu's hangar: the unit chosen drawn up for inspection on a parade ground suited to its era (the modern era's
// on a concrete apron by the airbase, the WW2 era's on a gravel square inside whitewashed stones). Every vehicle or
// gun of the unit stands side by side in one straight line, their fronts dressed on one line, the launchers and the
// guns at its head and the radars, predictors and command posts after them (parade.js paradeLine); each one's crew
// in ranks in front of it, its commander a pace ahead of the right of the line; an inspecting officer and his
// sergeant face the head of the line; in front of them the unit's munitions on display (models/munitions.js, from
// parade.js displayOf). A flak tower's concrete stands behind the line. The camera looks along the line from its
// front quarter, sways slowly, glides when the unit changes and can be orbited with the mouse; a hovered armament
// row takes it to that piece of the display.
//
// The menu stays light: three.js, the vehicle and crew models and the munitions are imported the first time the
// hangar shows, an era's own models (loadEra) before its first parade, and the canvas draws only while the hangar is
// on screen. Nothing is drawn half-built: a parade is put together off the scene and its shaders compiled before it
// is swapped in. The first stands behind the menu's loading screen (which follows `onProgress` and lifts on
// `onReady`); a later one keeps the unit before it in view, under a veil if it takes more than a moment. Without
// WebGL the unit's still from the game (public/menu/<kind>.jpg) stands in. The scene is its own: shaderlib.js
// patches three's fog and lighting chunks globally (the WW2 crews import it), so the hangar sets the shared uniforms
// for a clear day with plain distance fog (no height fog, no cloud shadows) and every material renders the same.
let lib = null;
const loadLib = () => (lib ??= Promise.all([
  import('three'), import('three/examples/jsm/controls/OrbitControls.js'), import('three/examples/jsm/environments/RoomEnvironment.js'),
  import('../models/vehicles.js'), import('../models/v/crew.js'), import('../models/munitions.js'), import('../models/ao.js'),
  import('../models/kit.js'), import('../shaderlib.js'), import('../deploy.js'), import('../eras/index.js'), import('../parade.js'),
]).then(([THREE, oc, re, vehicles, crew, munitions, ao, kit, shaderlib, deploy, eras, parade]) => ({
  THREE, OrbitControls: oc.OrbitControls, RoomEnvironment: re.RoomEnvironment, vehicles, crew, munitions, ao, kit, shaderlib, deploy, eras, parade,
})));

// The parade by era: the ground ('apron' or 'square'), the sky and the haze, the gap between vehicles in the line,
// and the dress: 'crew' the modern figures (models/v/crew.js, posed standing and baked), 'crew44' the WW2 gun crews
// (eras/ww2/models/crew44.js) with outfit overrides for the ranks, the commanders, the officer and his sergeant.
// An era not listed parades as the modern one.
const LW_COAT = 0x5b6168, HELMET = 0x4d524c;
const ERA_LOOK = {
  modern: {
    ground: 'apron', gap: 3, sky: [0x7d99b4, 0xc4cdd0], fog: 0xc0c8cb, grass: 0x66704a,
    dress: 'crew', man: { headgear: 'cap' }, no1: { headgear: 'cap', skin: 1 }, officer: { headgear: 'cap', pattern: 'olive' }, sergeant: { headgear: 'cap', skin: 2 },
  },
  ww2: {
    ground: 'square', gap: 2.6, sky: [0x8a949a, 0xbcbdb3], fog: 0xb6b7ad, grass: 0x5d6040,
    dress: 'crew44',
    man: { body: 'coat', coat: LW_COAT, head: 'helmet', headgear: HELMET, legs: 'jackboots' },
    no1: { body: 'coat', coat: LW_COAT, head: 'cap43', legs: 'jackboots' },
    officer: { body: 'coat', coat: 0x4f5560, head: 'cap43', legs: 'jackboots', kit: ['belt', 'holster'] },
    sergeant: { body: 'coat', coat: LW_COAT, head: 'cap43', legs: 'jackboots', kit: ['belt', 'holster'] },
  },
};
const lookOf = (era) => ERA_LOOK[era] ?? ERA_LOOK.modern;
const PACE = 0.8, RANK = 1.2, FRONT = 2.1; // between files, between ranks, the rear rank from the vehicle's front
const YELLOW_GUNS = new Set(['B', 'E']); // the heavy guns in Dunkelgelb (as render/units.js)
const KEEP = 4; // parades kept built, the most recent

// `host` is the element the canvas fills; `onProgress(text, k)` reports a parade being put together (k 0 to 1) and
// `onReady()` that it stands drawn (or that the still stands in). Returns { show({ era, kind, parts, name }),
// lookAt(i), setActive(on) }: `parts` the slot option's parts (deploy.js), `name` for the progress line; lookAt(i)
// takes the camera to the display's entry i (parade.js displayOf order; null: back to the line).
export function createHangar(host, { onProgress = () => {}, onReady = () => {}, webgl = true } = {}) {
  let three = null, failed = !webgl, active = false, raf = 0, want = null, park = null, last = 0;
  const parades = new Map(); // key -> a parade built, the most recent last
  const still = document.createElement('div');
  still.className = 'hg-still';
  still.hidden = true;
  const veil = document.createElement('div');
  veil.className = 'hg-veil';
  veil.hidden = true;
  veil.innerHTML = '<p class="hg-veil-t"></p><div class="hg-veil-bar"><i></i></div>';
  host.append(still, veil);
  const progress = (text, k) => {
    veil.querySelector('.hg-veil-t').textContent = text;
    veil.querySelector('i').style.width = `${Math.round(k * 100)}%`;
    onProgress(text, k);
  };
  const tick = () => new Promise((r) => setTimeout(r, 0));
  const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));
  const fallback = (kind) => {
    still.style.backgroundImage = STILLS.has(kind) ? `url("${stillUrl(kind)}")` : '';
    still.hidden = false;
  };

  async function setup() {
    const L = await loadLib(), { THREE } = L;
    const canvas = document.createElement('canvas');
    canvas.className = 'hg-canvas';
    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    } catch (e) {
      failed = true;
      throw e;
    }
    host.prepend(canvas);
    renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.9;
    L.ao.setBakeRenderer(renderer); // the WW2 guns' baked occlusion, as in the game
    // a clear day for every patched material (shaderlib.js): plain distance fog, no cloud shadows, dry
    const U = L.shaderlib.globalUniforms;
    U.fogHeightFalloff.value = 0;
    U.uCloudShadow.value = 0;
    U.uWetness.value = 0;
    U.uFlareCount.value = 0;
    const scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new L.RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = 0.5;
    const hemi = new THREE.HemisphereLight(0xd8e2ea, 0x5a5444, 0.55);
    const sun = new THREE.DirectionalLight(0xfff0d8, 2.6);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.04;
    scene.add(hemi, sun, sun.target);
    const sky = new THREE.Mesh(new THREE.SphereGeometry(4000, 32, 16), new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { top: { value: new THREE.Color() }, horizon: { value: new THREE.Color() } },
      vertexShader: 'varying vec3 vP; void main() { vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: 'uniform vec3 top; uniform vec3 horizon; varying vec3 vP; void main() { float k = clamp(normalize(vP).y * 2.2, 0.0, 1.0); gl_FragColor = vec4(mix(horizon, top, sqrt(k)), 1.0); }',
    }));
    sky.renderOrder = -1;
    sky.frustumCulled = false;
    scene.add(sky);
    scene.fog = new THREE.FogExp2(0xc0c8cb, 0.0016);
    const camera = new THREE.PerspectiveCamera(34, 1, 0.2, 6000);
    const controls = new L.OrbitControls(camera, canvas);
    controls.enableDamping = true;
    controls.enablePan = false;
    controls.maxPolarAngle = Math.PI * 0.47;
    controls.addEventListener('start', () => {
      controls.autoRotate = false;
      idleUntil = Infinity;
      glide = null;
    });
    controls.addEventListener('end', () => (idleUntil = performance.now() + 8000));
    const resize = () => {
      const w = host.clientWidth || innerWidth, h = host.clientHeight || innerHeight;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    new ResizeObserver(() => {
      resize();
      if (park && !glide) look(looking, true);
    }).observe(host);
    resize();
    three = { ...L, renderer, scene, camera, controls, sun, hemi, sky, resize, layer: null, figures: new Map() };
    return three;
  }

  // ---------------------------------------------------------------- the ground and the scenery round it
  let groundTex = null;
  function gravelTexture() {
    if (groundTex) return groundTex;
    const { THREE } = three, size = 256, cv = document.createElement('canvas');
    cv.width = cv.height = size;
    const g = cv.getContext('2d'), img = g.createImageData(size, size);
    let s = 7;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < size * size; i++) {
      const k = 0.78 + rnd() * 0.3 + (rnd() < 0.08 ? -0.25 : 0);
      img.data[i * 4] = 150 * k;
      img.data[i * 4 + 1] = 142 * k;
      img.data[i * 4 + 2] = 126 * k;
      img.data[i * 4 + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    groundTex = new THREE.CanvasTexture(cv);
    groundTex.colorSpace = THREE.SRGBColorSpace;
    groundTex.wrapS = groundTex.wrapT = THREE.RepeatWrapping;
    groundTex.anisotropy = 4;
    return groundTex;
  }
  // a deterministic jitter
  const h2 = (a, b, c = 0) => {
    const x = Math.sin(a * 127.1 + b * 311.7 + c * 74.7) * 43758.5453;
    return x - Math.floor(x);
  };
  function environment(era, lot) {
    const { THREE, kit } = three, L = lookOf(era), g = new THREE.Group();
    const std = (o) => new THREE.MeshStandardMaterial({ roughness: 0.95, ...o });
    const add = (geo, m, x, y, z, ry = 0, shadow = true) => {
      const mesh = new THREE.Mesh(geo, m);
      mesh.position.set(x, y, z);
      mesh.rotation.y = ry;
      mesh.castShadow = shadow;
      mesh.receiveShadow = true;
      g.add(mesh);
      return mesh;
    };
    const cx = (lot.x0 + lot.x1) / 2, cz = (lot.zFront + lot.zBack) / 2;
    // the field round it, a little below the parade ground and pushed back in depth so the two never fight far off
    const ground = add(new THREE.PlaneGeometry(6000, 6000).rotateX(-Math.PI / 2), std({ color: L.grass, polygonOffset: true, polygonOffsetFactor: 4, polygonOffsetUnits: 4 }), cx, -0.04, cz, 0, false);
    ground.castShadow = false;
    const sx0 = lot.x0 - 14, sx1 = lot.x1 + 14, sz0 = lot.zFront - 14, sz1 = lot.zBack + 12, w = sx1 - sx0, d = sz1 - sz0;
    const trees = [];
    if (L.ground === 'apron') {
      // the apron: concrete slabs (models/kit.js, its 2 m formwork panels stretched to 5 m slabs), a yellow line
      // where the vehicles' fronts stand and a white edge line
      const set = kit.concreteTextures(0x9c9a92), tex = (t) => {
        const c = t.clone();
        c.wrapS = c.wrapT = THREE.RepeatWrapping;
        c.repeat.set(w / 15, d / 15);
        c.needsUpdate = true;
        return c;
      };
      const pad = new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2);
      add(pad, std({ map: tex(set.map), roughnessMap: tex(set.rough), normalMap: tex(set.normal), color: 0xffffff }), cx, 0.02, (sz0 + sz1) / 2, 0, false);
      const paint = std({ color: 0xd9b23a, roughness: 0.7 }), white = std({ color: 0xe6e4dc, roughness: 0.7 });
      add(new THREE.PlaneGeometry(lot.x1 - lot.x0 + 4, 0.18).rotateX(-Math.PI / 2), paint, cx, 0.03, -0.4, 0, false);
      for (const [x, z, ww, dd] of [[cx, sz0 + 1, w - 2, 0.2], [cx, sz1 - 1, w - 2, 0.2], [sx0 + 1, (sz0 + sz1) / 2, 0.2, d - 2], [sx1 - 1, (sz0 + sz1) / 2, 0.2, d - 2]]) {
        add(new THREE.PlaneGeometry(ww, dd).rotateX(-Math.PI / 2), white, x, 0.03, z, 0, false);
      }
      // the airbase behind: hardened aircraft shelters, concrete vaults with their doors toward the apron
      const con = std({ color: 0x8e8d86, roughness: 0.9 }), dark = std({ color: 0x2a2c2c });
      const n = Math.max(2, Math.round(w / 55));
      for (let k = 0; k < n; k++) {
        const x = sx0 + 20 + (k * (w - 40)) / Math.max(1, n - 1), z = sz1 + 70 + h2(k, 1) * 20;
        const vault = new THREE.CylinderGeometry(12, 12, 34, 24, 1, false, -Math.PI / 2, Math.PI).rotateX(Math.PI / 2).rotateZ(0);
        add(vault, con, x, 0, z);
        add(new THREE.PlaneGeometry(20, 9), dark, x, 4.5, z - 17.05, 0, false);
        add(new THREE.BoxGeometry(26, 3, 6), con, x, 1.5, z - 20);
      }
      // a tree line out in the haze: pines and birches
      for (let k = 0; k < 160; k++) {
        const a = h2(k, 7) * Math.PI * 2, r = 320 + h2(k, 8) * 520;
        trees.push([cx + Math.cos(a) * r, cz + Math.sin(a) * r, 12 + h2(k, 9) * 10, h2(k, 3) < 0.6]);
      }
    } else {
      // the square: rolled gravel inside whitewashed edging stones
      const tex = gravelTexture().clone();
      tex.repeat.set(w / 3, d / 3);
      tex.needsUpdate = true;
      add(new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2), std({ map: tex, color: 0xffffff }), cx, 0.02, (sz0 + sz1) / 2, 0, false);
      const stones = [];
      for (let x = sx0; x <= sx1; x += 1.4) stones.push([x, sz0], [x, sz1]);
      for (let z = sz0 + 1.4; z < sz1; z += 1.4) stones.push([sx0, z], [sx1, z]);
      const st = new THREE.InstancedMesh(new THREE.BoxGeometry(0.42, 0.2, 0.3), std({ color: 0xe8e6de }), stones.length), o = new THREE.Object3D();
      stones.forEach(([x, z], i) => {
        o.position.set(x, 0.1, z);
        o.rotation.y = (h2(x, z) - 0.5) * 0.4;
        o.updateMatrix();
        st.setMatrixAt(i, o.matrix);
      });
      st.castShadow = st.receiveShadow = true;
      g.add(st);
      // the barracks behind: long timber huts, creosoted, roofed in tarred felt
      const wood = std({ color: 0x4a3c2e }), felt = std({ color: 0x2c2b29 }), win = std({ color: 0x1d2123, roughness: 0.3 });
      const n = Math.max(2, Math.round(w / 40));
      for (let k = 0; k < n; k++) {
        const x = sx0 + 18 + (k * (w - 36)) / Math.max(1, n - 1), z = sz1 + 26 + (k % 2) * 6, len = 28, hw = 4;
        add(new THREE.BoxGeometry(len, 2.8, hw * 2), wood, x, 1.4, z);
        const roof = new THREE.CylinderGeometry(hw * 1.18, hw * 1.18, len + 0.6, 3, 1).rotateZ(Math.PI / 2).rotateX(Math.PI / 2 + Math.PI / 6);
        roof.scale(1, 0.42, 1);
        add(roof, felt, x, 2.8 + hw * 0.18, z);
        for (let i = 0; i < 6; i++) add(new THREE.PlaneGeometry(1.1, 1.0), win, x - len / 2 + 2.5 + i * 4.6, 1.7, z - hw - 0.01, Math.PI, false);
      }
      // telegraph poles along the road beyond
      for (let x = sx0 - 30; x <= sx1 + 30; x += 32) {
        add(new THREE.CylinderGeometry(0.11, 0.14, 7, 6), wood, x, 3.5, sz1 + 48);
        add(new THREE.BoxGeometry(1.4, 0.1, 0.1), wood, x, 6.6, sz1 + 48);
      }
      // a row of birches along the road and the woods in the haze
      for (let x = sx0 - 50; x <= sx1 + 50; x += 8) trees.push([x + (h2(x, 5) - 0.5) * 3, sz1 + 54 + h2(x, 2) * 4, 13 + h2(x, 6) * 5, false]);
      for (let k = 0; k < 140; k++) {
        const a = h2(k, 7) * Math.PI * 2, r = 260 + h2(k, 8) * 460;
        trees.push([cx + Math.cos(a) * r, cz + Math.sin(a) * r, 14 + h2(k, 9) * 8, h2(k, 3) < 0.7]);
      }
    }
    // the trees: instanced trunks and crowns (a pine a cone, a birch a rounded crown)
    const pines = trees.filter((t) => t[3]), birch = trees.filter((t) => !t[3]), o = new THREE.Object3D();
    const inst = (geo, m, list, f) => {
      if (!list.length) return;
      const im = new THREE.InstancedMesh(geo, m, list.length);
      list.forEach((t, i) => {
        f(o, t);
        o.updateMatrix();
        im.setMatrixAt(i, o.matrix);
      });
      im.castShadow = im.receiveShadow = true;
      g.add(im);
    };
    const trunk = new THREE.CylinderGeometry(0.16, 0.28, 1, 6).translate(0, 0.5, 0);
    inst(trunk, std({ color: 0x4b4036 }), pines, (q, [x, z, ht]) => { q.position.set(x, 0, z); q.rotation.set(0, 0, 0); q.scale.set(1, ht * 0.4, 1); });
    inst(trunk, std({ color: 0xcfcbc0 }), birch, (q, [x, z, ht]) => { q.position.set(x, 0, z); q.rotation.set(0, 0, 0); q.scale.set(0.8, ht * 0.55, 0.8); });
    inst(new THREE.ConeGeometry(1, 1, 8).translate(0, 0.5, 0), std({ color: 0x34452e, flatShading: true }), pines, (q, [x, z, ht]) => { q.position.set(x, ht * 0.2, z); q.scale.set(ht * 0.22, ht * 0.85, ht * 0.22); q.rotation.y = h2(x, z) * 6; });
    inst(new THREE.IcosahedronGeometry(1, 1), std({ color: era === 'ww2' ? 0x6b6a4c : 0x5c6a3e, flatShading: true }), birch, (q, [x, z, ht]) => { q.position.set(x, ht * 0.62, z); q.scale.set(ht * 0.24, ht * 0.36, ht * 0.24); q.rotation.y = h2(x, z) * 6; });
    return g;
  }

  // ---------------------------------------------------------------- the men
  // A modern figure standing, baked once per outfit: the crew figure posed and its skinning applied to a plain
  // geometry, so the ranks are a few instanced meshes
  function baked(outfit) {
    const key = JSON.stringify(outfit);
    if (three.figures.has(key)) return three.figures.get(key);
    const { THREE, crew } = three;
    const f = crew.buildCrewman(outfit);
    f.pose('stand', 0, 1);
    f.root.updateMatrixWorld(true);
    const mesh = f.mesh, src = mesh.geometry, pos = src.attributes.position, v = new THREE.Vector3(), out = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      mesh.applyBoneTransform(i, v.fromBufferAttribute(pos, i));
      out[i * 3] = v.x;
      out[i * 3 + 1] = v.y;
      out[i * 3 + 2] = v.z;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(out, 3));
    for (const [name, attr] of Object.entries(src.attributes)) if (!['position', 'normal', 'skinIndex', 'skinWeight'].includes(name)) geo.setAttribute(name, attr);
    if (src.index) geo.setIndex(src.index);
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
    f.dispose();
    const b = { geo, mat: mesh.material };
    three.figures.set(key, b);
    return b;
  }
  // [outfit, x, z, heading] each, one instanced mesh per outfit
  function modernMen(list) {
    const { THREE } = three, by = new Map(), o = new THREE.Object3D(), out = [];
    for (const m of list) {
      const k = JSON.stringify(m[0]);
      if (!by.has(k)) by.set(k, []);
      by.get(k).push(m);
    }
    for (const ms of by.values()) {
      const b = baked(ms[0][0]);
      const im = new THREE.InstancedMesh(b.geo, b.mat, ms.length);
      ms.forEach(([, x, z, yaw], i) => {
        o.position.set(x, 0, z);
        o.rotation.set(0, yaw, 0);
        o.updateMatrix();
        im.setMatrixAt(i, o.matrix);
      });
      im.castShadow = im.receiveShadow = true;
      im.computeBoundingSphere();
      out.push(im);
    }
    return out;
  }
  // The WW2 crews' layer (one for the hangar): every man stands on parade, so a man's pose is solved for his first
  // frames only and then left as it is (the instancing, the culling and the detail levels still run every frame)
  async function layer44() {
    if (three.layer) return three.layer;
    const { Crew44, JOBS } = await import('../eras/ww2/models/crew44.js');
    class Parade44 extends Crew44 {
      solveMan(h, m, dt) {
        if ((m.paraded = (m.paraded ?? 0) + 1) > 3) return;
        super.solveMan(h, m, dt);
      }
    }
    three.layer = new Parade44(three.scene);
    three.JOBS = JOBS;
    return three.layer;
  }

  // Where a crew of `n` stands in front of a vehicle `w` wide whose front is at z = 0: [x, z] each from its middle,
  // the commander last, a pace ahead of the right of the line; and how deep the ranks are
  function ranks(n, w) {
    const rest = Math.max(0, n - 1), per = Math.max(1, Math.min(rest, Math.max(3, Math.floor((w + 0.6) / PACE)))), rows = Math.ceil(rest / per);
    const spots = [];
    for (let k = 0; k < rest; k++) {
      const r = Math.floor(k / per), f = k % per, cnt = Math.min(per, rest - r * per);
      spots.push([((cnt - 1) / 2 - f) * PACE, -(FRONT + (rows - 1 - r) * RANK)]);
    }
    const front = -(FRONT + Math.max(0, rows - 1) * RANK);
    if (n > 0) spots.push([(Math.min(per, rest) - 1) / 2 * PACE + PACE * 0.6, front - 1.3]);
    return { spots, front: front - (n > 0 ? 1.3 : 0) };
  }

  // ---------------------------------------------------------------- a parade
  async function build(era, unit) {
    const { THREE, vehicles, parade, munitions } = three, look = lookOf(era);
    const group = new THREE.Group(), rigs = [], spin = [];
    const { line, behind } = parade.paradeLine(unit.kind, unit.parts);
    // the vehicles and guns side by side, their fronts on z = 0, facing the front (-z); the line is laid out by its
    // distance u from the head and runs toward -x (x = -u), so seen from its right front it recedes to the right
    const X = (u) => -u;
    let x = 0;
    const place = (part, i, n) => {
      const rig = vehicles.buildVehicle(part.kind);
      // on parade a gun stands out of its pit, its letter and paint as in the battle
      if (rig.emplacement) {
        rig.emplacement.removeFromParent();
        rig.emplacement = null;
      }
      if (part.letter) {
        rig.setLetter?.(part.letter);
        if (YELLOW_GUNS.has(part.letter)) rig.setPaint?.('yellow');
      }
      rig.setDeploy?.(1);
      rig.root.updateMatrixWorld(true);
      const b = new THREE.Box3().setFromObject(rig.root);
      return { rig, part, b, i, n };
    };
    for (const [i, part] of line.entries()) {
      progress(`Bringing up the ${unit.name ?? unit.kind}`, 0.1 + (0.5 * i) / line.length);
      await tick();
      const r = place(part, i, line.length);
      r.x0 = x;
      r.x1 = x + r.b.max.x - r.b.min.x;
      r.rig.root.position.set(X(r.x1) - r.b.min.x, 0, -r.b.min.z);
      r.depth = r.b.max.z - r.b.min.z;
      r.height = r.b.max.y;
      x = r.x1 + look.gap;
      group.add(r.rig.root);
      rigs.push(r);
      if (r.rig.pivots?.searchRadar) spin.push({ node: r.rig.pivots.searchRadar, w: (Math.PI * 2) / (9 + i * 1.3) });
    }
    const lineEnd = rigs.length ? rigs[rigs.length - 1].x1 : 0;
    let zBack = Math.max(4, ...rigs.map((r) => r.depth));
    // a flak tower's concrete behind the line
    let bx = 0;
    for (const part of behind) {
      progress('Raising the tower', 0.62);
      await tick();
      const r = place(part, 0, 1);
      r.rig.root.position.set(X(bx + r.b.max.x - r.b.min.x) - r.b.min.x, 0, zBack + 30 - r.b.min.z);
      bx += r.b.max.x - r.b.min.x + 20;
      group.add(r.rig.root);
      r.behind = true;
      rigs.push(r);
    }
    progress('Forming up the crews', 0.66);
    await tick();
    // each crew in front of its vehicle; the officer and his sergeant facing the head of the line
    const inLine = rigs.filter((r) => !r.behind);
    const men = []; // [role, x, z, heading, rig entry]
    let rankFront = -FRONT;
    for (const r of look.dress === 'crew44' ? [] : inLine) {
      const n = parade.crewOf(r.part.kind);
      r.men = n;
      const F = ranks(n, r.x1 - r.x0), mid = X((r.x0 + r.x1) / 2);
      F.spots.forEach(([dx, z], k) => men.push([k === F.spots.length - 1 ? 'no1' : 'man', mid + dx, z, 0, r]));
      rankFront = Math.min(rankFront, F.front);
      r.front = F.front;
    }
    const handles = [];
    if (look.dress === 'crew44') {
      // the WW2 crews: a man for every crew spot of his gun (jobs44.js), stood in ranks; a gun or instrument
      // without crew spots borrows men from the first one that has them
      const L44 = await layer44(), JOBS = three.JOBS, donor = inLine.find((r) => r.rig.anchors?.crew && JOBS[r.part.kind]);
      let seed = 11;
      const crewOf = (r, outfit, n = null) => {
        const own = r.rig.anchors?.crew && JOBS[r.part.kind];
        const src = own ? r : donor;
        if (!src) return [];
        const jobs = Object.keys(JOBS[src.part.kind]).filter((j) => src.rig.anchors.crew[j]);
        const want = n ?? (own ? jobs.length : three.parade.crewOf(r.part.kind));
        const out = [];
        for (let k = 0; k < want; k += jobs.length) {
          const h = L44.place(src.rig, src.part.kind, { seed: seed++ * 7919, jobs: jobs.slice(0, want - k), outfit });
          handles.push(h);
          out.push(...h.men);
        }
        return out;
      };
      rankFront = -FRONT;
      for (const r of inLine) {
        const list = crewOf(r, look.man);
        r.men = list.length;
        const F = ranks(list.length, r.x1 - r.x0), mid = X((r.x0 + r.x1) / 2);
        // the commander in his own dress: his man's outfit changed (the look written again)
        list.forEach((m, k) => {
          const [dx, z] = F.spots[k];
          if (k === list.length - 1) {
            Object.assign(m.outfit, look.no1);
            m.outfit.kit = new Set([...(m.outfit.kit ?? []), 'belt', 'holster']);
            L44.writeLook(m);
          }
          m.at = { x: mid + dx, y: 0, z, heading: 0 };
          m.pose = { name: 'stand', t: (k * 0.37) % 1 };
          m.prop = null;
        });
        rankFront = Math.min(rankFront, F.front);
        r.front = F.front;
      r.front = F.front;
      }
      if (inLine.length) {
        const [officer, sergeant] = crewOf(inLine[0], look.officer, 2);
        const ox = X((inLine[0].x0 + inLine[0].x1) / 2);
        if (sergeant) {
          Object.assign(sergeant.outfit, look.sergeant, { kit: new Set(look.sergeant.kit) });
          L44.writeLook(sergeant);
          sergeant.at = { x: ox + 1.1, y: 0, z: rankFront - 2.0, heading: Math.PI };
          sergeant.pose = { name: 'stand', t: 0.5 };
          sergeant.prop = null;
        }
        if (officer) {
          officer.outfit.kit = new Set(look.officer.kit);
          L44.writeLook(officer);
          officer.at = { x: ox - 0.4, y: 0, z: rankFront - 2.8, heading: Math.PI };
          officer.pose = { name: 'atEase', t: 0 };
          officer.prop = null;
        }
      }
    } else if (inLine.length) {
      const ox = X((inLine[0].x0 + inLine[0].x1) / 2);
      men.push(['officer', ox - 0.4, rankFront - 2.8, Math.PI], ['sergeant', ox + 1.1, rankFront - 2.0, Math.PI]);
      // a few faces across the ranks
      const list = men.map(([role, mx, mz, yaw], k) => [{ ...look[role], ...(role === 'man' ? { skin: k % 4 } : {}) }, mx, mz, yaw]);
      for (const im of modernMen(list)) group.add(im);
    }
    // the munitions on display in front of the officer, from the head of the line on
    progress('Laying out the munitions', 0.74);
    await tick();
    const spots = [];
    let dx = (inLine[0]?.x0 ?? 0) - 1, zRow = rankFront - 4.6, dz = 0;
    const entries = parade.displayOf(unit.kind);
    const shown = [];
    for (const [i, e] of entries.entries()) {
      const d = munitions.buildDisplay(e);
      if (!d) continue;
      shown.push(d);
      d.i = i;
    }
    dz = Math.max(0, ...shown.map((d) => d.depth));
    for (const d of shown) {
      d.group.position.set(X(dx + d.width / 2), 0, zRow - dz / 2);
      d.u0 = dx;
      d.u1 = dx + d.width;
      group.add(d.group);
      spots[d.i] = { x: X(dx + d.width / 2), y: d.top * 0.45, z: zRow - dz / 2, r: Math.max(1.2, d.width * 0.55, d.depth * 0.5) };
      dx += d.width + 1.4;
    }
    const zFront = zRow - dz - 1;
    // the frame of the overview: the head of the line (its first vehicles, about 16 m of it, or the whole of a short
    // line, a display longer than it), its ranks and the display in front of them
    const x0 = Math.min(inLine[0]?.x0 ?? 0, -1), fx1 = Math.min(Math.max(lineEnd, dx - 1.4), x0 + Math.max(18, (inLine[0]?.x1 ?? 0) - x0 + 1));
    // (boxes [x0, x1, y0, y1, z0, z1] round what stands there: the vehicles, their ranks, the officer, the display)
    const head = inLine.filter((r) => r.x0 < fx1), frame = [];
    for (const r of head) {
      frame.push([X(Math.min(r.x1, fx1)), X(r.x0), 0, Math.min(r.height, 9), 0, Math.min(r.depth, 16)]);
      if (r.front != null) frame.push([X(r.x1), X(r.x0), 0, 1.8, r.front, -FRONT]);
    }
    if (inLine.length) frame.push([X(inLine[0].x1) - 1, X(inLine[0].x0) + 1, 0, 1.8, rankFront - 3.2, rankFront - 1.5]);
    for (const d of shown) if (d.u0 < fx1) frame.push([X(Math.min(d.u1, fx1 + 2)), X(d.u0), 0, d.top, zRow - dz, zRow]);
    const lot = { x0: X(Math.max(lineEnd, dx) + 2), x1: X(Math.min(x0, -2) - 2), zFront, zBack: zBack + (behind.length ? 80 : 0), height: Math.max(...rigs.map((r) => r.height)) };
    return { group, rigs, spin, handles, lot, frame, spots, era };
  }

  // a parade off the scene: its crews hidden, its group taken out
  function stow(p) {
    three.scene.remove(p.group, p.env);
    for (const h of p.handles) h.setVisible(false);
  }
  function dispose(p) {
    stow(p);
    for (const h of p.handles) h.remove();
    for (const g of [p.group, p.env]) g?.traverse((o) => {
      if (o.isInstancedMesh) o.dispose();
      else if (o.isMesh) o.geometry?.dispose();
    });
  }

  // ---------------------------------------------------------------- the camera
  // The overview: the head of the line from its right front, along the line, a little above, its frame fitted into the
  // gap between the menu's panels (on a wide screen they stand over the view: the details on the left, the armament
  // on the right, the sites along the bottom), the rest of the line receding behind it.
  const GAP = { wide: { x0: -0.42, x1: 0.32, y0: -0.6, y1: 0.66 }, narrow: { x0: -0.94, x1: 0.94, y0: -0.9, y1: 0.86 } };
  const AZ = 50, EL = 14;
  let looking = null, glide = null, idleUntil = 0, base = null;
  const orbit = (target, dist, azDeg, elDeg) => {
    const { THREE } = three, az = THREE.MathUtils.degToRad(azDeg), el = THREE.MathUtils.degToRad(elDeg);
    return new THREE.Vector3(target.x + Math.sin(az) * Math.cos(el) * dist, target.y + Math.sin(el) * dist, target.z - Math.cos(az) * Math.cos(el) * dist);
  };
  // fit the corners of boxes ([x0, x1, y0, y1, z0, z1] each) into the gap, seen from az, el
  function fit(boxes, az, el, gap) {
    const { THREE, camera } = three, corners = [];
    for (const [x0, x1, y0, y1, z0, z1] of boxes) for (const x of [x0, x1]) for (const y of [y0, y1]) for (const z of [z0, z1]) corners.push(new THREE.Vector3(x, y, z));
    const span = new THREE.Box3().setFromPoints(corners), size = span.getSize(new THREE.Vector3());
    const target = span.getCenter(new THREE.Vector3());
    let dist = Math.max(8, Math.hypot(size.x, size.z) * 1.3);
    const keep = { p: camera.position.clone(), q: camera.quaternion.clone() }, v = new THREE.Vector3(), r = new THREE.Vector3(), u = new THREE.Vector3();
    for (let it = 0; it < 5; it++) {
      camera.position.copy(orbit(target, dist, az, el));
      camera.lookAt(target);
      camera.updateMatrixWorld();
      let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
      for (const c of corners) {
        v.copy(c).project(camera);
        a0 = Math.min(a0, v.x);
        a1 = Math.max(a1, v.x);
        b0 = Math.min(b0, v.y);
        b1 = Math.max(b1, v.y);
      }
      const halfH = dist * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)), halfW = halfH * camera.aspect;
      r.setFromMatrixColumn(camera.matrixWorld, 0);
      u.setFromMatrixColumn(camera.matrixWorld, 1);
      target.addScaledVector(r, ((a0 + a1) / 2 - (gap.x0 + gap.x1) / 2) * halfW);
      target.addScaledVector(u, ((b0 + b1) / 2 - (gap.y0 + gap.y1) / 2) * halfH);
      dist *= Math.max((a1 - a0) / (gap.x1 - gap.x0), (b1 - b0) / (gap.y1 - gap.y0), 0.3);
    }
    camera.position.copy(keep.p);
    camera.quaternion.copy(keep.q);
    camera.updateMatrixWorld();
    return { target, pos: orbit(target, dist, az, el), dist, az };
  }
  const wide = () => (host.clientWidth || innerWidth) > 1100 && innerWidth > 1100;
  function aim(view, now) {
    const { controls, camera } = three;
    idleUntil = 0;
    base = view;
    if (now) {
      controls.target.copy(view.target);
      camera.position.copy(view.pos);
      glide = null;
      controls.update();
      return;
    }
    glide = { t0: performance.now(), dur: 1100, from: { target: controls.target.clone(), pos: camera.position.clone() }, to: view };
  }
  // the camera onto the display's entry i, or back to the overview
  function look(i, now = false) {
    looking = i != null && park?.spots[i] ? i : null;
    if (!three || !park) return;
    const gap = wide() ? GAP.wide : GAP.narrow;
    if (looking == null) {
      const v = fit(park.frame, AZ, EL, gap);
      three.controls.minDistance = Math.min(3, v.dist * 0.2);
      three.controls.maxDistance = Math.max(60, v.dist * 3);
      aim(v, now);
      return;
    }
    const s = park.spots[looking];
    aim(fit([[s.x - s.r, s.x + s.r, 0, s.y * 2, s.z - s.r * 0.6, s.z + s.r * 0.6]], 26, 26, gap), now);
  }
  // the light and the shadow round the head of the line (a long line's far end goes without the sun's shadow)
  function light() {
    const { sun, scene, sky } = three, lot = park.lot, L = lookOf(park.era);
    const cx = (lot.x1 + Math.max(lot.x0, lot.x1 - 90)) / 2, cz = (lot.zFront + Math.min(lot.zBack, 40)) / 2;
    const r = Math.max(14, Math.hypot(Math.min(lot.x1 - lot.x0, 90), Math.min(lot.zBack, 40) - lot.zFront) / 2 + 4);
    sun.position.set(cx - r * 1.4 - 30, r * 2.4 + 50, cz - r * 1.2 - 40);
    sun.target.position.set(cx, 0, cz);
    const s = sun.shadow.camera, e = r * 1.25;
    Object.assign(s, { left: -e, right: e, top: e, bottom: -e, near: 1, far: r * 8 + 300 });
    s.updateProjectionMatrix();
    sky.material.uniforms.top.value.set(L.sky[0]);
    sky.material.uniforms.horizon.value.set(L.sky[1]);
    scene.fog.color.set(L.fog);
    three.shaderlib.globalUniforms.uSunDirW.value.copy(sun.position).sub(sun.target.position).normalize();
  }

  // ---------------------------------------------------------------- drawing
  let tPrev = 0;
  function frame(t) {
    raf = 0;
    if (!active || !three || !park || document.hidden) return;
    const { controls, camera, renderer, scene } = three;
    const dt = Math.min(0.1, tPrev ? (t - tPrev) / 1000 : 0.016);
    tPrev = t;
    if (glide) {
      const k = Math.min(1, (performance.now() - glide.t0) / glide.dur), e = k * k * (3 - 2 * k);
      controls.target.lerpVectors(glide.from.target, glide.to.target, e);
      camera.position.lerpVectors(glide.from.pos, glide.to.pos, e);
      if (k >= 1) glide = null;
    } else if (looking == null && base && performance.now() > idleUntil) {
      // a slow sway either side of the overview while nobody turns it
      controls.autoRotate = true;
      const th = controls.getAzimuthalAngle(), th0 = Math.PI - (base.az * Math.PI) / 180;
      const d = Math.atan2(Math.sin(th - th0), Math.cos(th - th0));
      if (d > 0.22) controls.autoRotateSpeed = 0.18;
      else if (d < -0.22) controls.autoRotateSpeed = -0.18;
      else if (!controls.autoRotateSpeed) controls.autoRotateSpeed = 0.18;
    } else controls.autoRotate = false;
    for (const s of park.spin) s.node.rotation.y += s.w * dt;
    controls.update(dt);
    three.layer?.update(dt, camera);
    renderer.render(scene, camera);
    raf = requestAnimationFrame(frame);
  }
  const run = () => {
    if (active && three && park && !raf) {
      tPrev = 0;
      raf = requestAnimationFrame(frame);
    }
  };
  document.addEventListener('visibilitychange', run);

  // The unit drawn up (a parade built before is taken from the shelf). A new one is put together off the scene, its
  // shaders compiled against the scene's lights and fog, then swapped in and drawn once before it shows; until
  // then the one before it stays in view, the veil up at once the first time (under the menu's loading screen)
  // and after a moment on a later change.
  async function show({ era, kind, parts, name }) {
    const key = `${era}|${kind}|${parts.map((p) => `${p.kind}${p.letter ?? ''}`).join(',')}`;
    if (key === park?.key || key === want) return;
    want = key;
    if (failed) {
      fallback(kind);
      onReady();
      return;
    }
    const first = !park;
    const slow = setTimeout(() => {
      if (want === key) veil.hidden = false;
    }, first ? 0 : 350);
    try {
      if (!three) {
        progress('Loading the 3D engine', 0.04);
        await setup();
      }
      const { renderer, scene, camera, eras, deploy } = three;
      let p = parades.get(key);
      if (!p) {
        if (eras.eraById(era)?.content) progress(`Loading the ${eras.eraById(era).name} models`, 0.06);
        await eras.loadEra(era);
        deploy.setEra(era); // the era's markings on the vehicles (models/markings.js)
        if (want !== key) return;
        p = await build(era, { kind, parts, name });
        p.key = key;
        p.env = environment(era, p.lot);
        if (want !== key) {
          dispose(p);
          return;
        }
        progress('Preparing the shaders', 0.88);
        const staging = new three.THREE.Group();
        staging.add(p.group, p.env);
        await renderer.compileAsync(staging, camera, scene);
        staging.remove(p.group, p.env);
        if (want !== key) {
          dispose(p);
          return;
        }
        parades.set(key, p);
      } else {
        parades.delete(key);
        parades.set(key, p);
      }
      if (park) stow(park);
      // the shelf keeps the latest few
      while (parades.size > KEEP) {
        const [k, old] = parades.entries().next().value;
        parades.delete(k);
        if (old !== p) dispose(old);
      }
      scene.add(p.group, p.env);
      for (const h of p.handles) h.setVisible(true);
      park = p;
      light();
      look(null, first);
      if (three.layer) {
        three.layer.update(0, camera);
        await renderer.compileAsync(scene, camera);
      }
      three.resize();
      renderer.render(scene, camera);
      await nextFrame();
      progress('Ready', 1);
      still.hidden = true;
      run();
      onReady();
    } catch (e) {
      console.warn('hangar:', e);
      failed = failed || !three;
      fallback(kind);
      onReady();
    } finally {
      clearTimeout(slow);
      if (want === key) {
        veil.hidden = true;
        want = null;
      }
    }
  }

  return {
    show,
    lookAt(i) {
      look(i);
      run();
    },
    setActive(on) {
      active = on;
      if (on) {
        three?.resize();
        run();
      }
    },
    get three() { return three; }, // the scene, camera and controls, for the headless tools (window.__hangar)
    get park() { return park; },
  };
}
