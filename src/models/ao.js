import * as THREE from 'three';

// Baked ambient occlusion: how open each vertex of a rig is to the sky, worked out once on the GPU when the
// rig is built and multiplied into its vertex colours, so crevices, the undersides of parts and the ground
// contact darken (and gather a little grime) at no cost per frame. The rig is rendered as depth from DIRS
// directions round a sphere; a points pass then tests every vertex,
// pushed a little off its surface, against each depth picture, adding its cosine-weighted visibility into one
// texel per vertex; one read-back gives every vertex's openness. Done in the rig's rest pose (the moving parts
// as built). The result is kept per kind and vertex count, so the other rigs of a kind only multiply.
//
// API: setBakeRenderer(renderer) once (main.js, the model viewer); bakeKinds(kinds) opts kinds in (an era's
// models.js); buildVehicle (models/vehicles.js) calls bakeRig(rig, kind) for those kinds.

const DIRS = 64, SIZE = 512, ROW = 1024;
const FAR = new THREE.Color(1e6, 1e6, 1e6);
const KINDS = new Set();
const CACHE = new Map();
let R = null;

export function setBakeRenderer(renderer) {
  R = renderer;
}
export function bakeKinds(kinds) {
  for (const k of kinds) KINDS.add(k);
}

// directions round the sphere (a Fibonacci spiral), unit vectors from the rig toward the "sky"
const DIR_LIST = Array.from({ length: DIRS }, (_, i) => {
  const y = 1 - (2 * (i + 0.5)) / DIRS, r = Math.sqrt(1 - y * y), a = i * Math.PI * (3 - Math.sqrt(5));
  return new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r);
});

let depthMat, pointMat;
function materials() {
  if (depthMat) return;
  depthMat = new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `varying float vD; void main() { vec4 mv = modelViewMatrix * vec4(position, 1.0); vD = -mv.z; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: /* glsl */ `varying float vD; void main() { gl_FragColor = vec4(vD, 0.0, 0.0, 1.0); }`,
  });
  pointMat = new THREE.ShaderMaterial({
    uniforms: { uDepth: { value: null }, uView: { value: new THREE.Matrix4() }, uProj: { value: new THREE.Matrix4() }, uL: { value: new THREE.Vector3() }, uRows: { value: 1 }, uBias: { value: 0.03 } },
    vertexShader: /* glsl */ `
      attribute float aIdx;
      uniform mat4 uView, uProj; uniform vec3 uL; uniform float uRows;
      varying vec2 vUv; varying float vD, vW;
      void main() {
        vec4 vp = uView * vec4(position + normal * 0.015, 1.0);
        vD = -vp.z;
        vec4 cp = uProj * vp;
        vUv = cp.xy / cp.w * 0.5 + 0.5;
        vW = max(dot(normal, uL), 0.0);
        float x = mod(aIdx, ${ROW}.0), y = floor(aIdx / ${ROW}.0);
        gl_Position = vec4((x + 0.5) / ${ROW}.0 * 2.0 - 1.0, (y + 0.5) / uRows * 2.0 - 1.0, 0.0, 1.0);
        gl_PointSize = 1.0;
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D uDepth; uniform float uBias;
      varying vec2 vUv; varying float vD, vW;
      void main() {
        float d = texture2D(uDepth, vUv).r;
        float vis = (vUv.x < 0.0 || vUv.x > 1.0 || vUv.y < 0.0 || vUv.y > 1.0 || d >= vD - uBias) ? 1.0 : 0.0;
        gl_FragColor = vec4(vis * vW, vW, 0.0, 1.0);
      }`,
    blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
    depthTest: false, depthWrite: false,
  });
}

// the meshes whose colours the bake darkens: plain meshes with a vertex colour, visible in the rest pose
function targets(root) {
  const out = [];
  root.traverse((o) => {
    if (!o.isMesh || o.isInstancedMesh || o.isSkinnedMesh || !o.geometry.attributes.color || !o.geometry.attributes.normal) return;
    for (let p = o; p; p = p.parent) if (p.visible === false) return;
    out.push(o);
  });
  return out;
}

/** Bakes the rig's occlusion into its vertex colours (kinds opted in with bakeKinds; no renderer: nothing). */
export function bakeRig(rig, kind) {
  if (!R || !KINDS.has(kind)) return;
  const root = rig.root;
  root.updateMatrixWorld(true);
  const meshes = targets(root);
  let V = 0;
  for (const m of meshes) V += m.geometry.attributes.position.count;
  if (!V) return;
  const key = `${kind}|${meshes.length}|${V}`;
  const ao = CACHE.get(key) ?? measure(root, meshes, V);
  CACHE.set(key, ao);
  apply(meshes, ao);
}

function measure(root, meshes, V) {
  materials();
  // every vertex in rig space (the root at the origin), and the rig's bounds
  const pos = new Float32Array(V * 3), nrm = new Float32Array(V * 3), idx = new Float32Array(V);
  const v = new THREE.Vector3(), n = new THREE.Vector3(), nm = new THREE.Matrix3(), inv = new THREE.Matrix4().copy(root.matrixWorld).invert(), M = new THREE.Matrix4();
  const box = new THREE.Box3();
  let o = 0;
  for (const m of meshes) {
    M.multiplyMatrices(inv, m.matrixWorld);
    nm.getNormalMatrix(M);
    const P = m.geometry.attributes.position, N = m.geometry.attributes.normal;
    for (let i = 0; i < P.count; i++, o++) {
      v.fromBufferAttribute(P, i).applyMatrix4(M);
      n.fromBufferAttribute(N, i).applyMatrix3(nm).normalize();
      pos.set([v.x, v.y, v.z], o * 3);
      nrm.set([n.x, n.y, n.z], o * 3);
      idx[o] = o;
      box.expandByPoint(v);
    }
  }
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  const c = sphere.center, r = Math.max(sphere.radius, 0.5);
  const rows = Math.ceil(V / ROW);

  // the scene to render: the rig (its instanced parts hidden: their matrices are not set yet), in depth; no
  // ground (the environment light already has the ground below the horizon: this is the rig shutting itself in)
  const scene = new THREE.Scene();
  scene.overrideMaterial = depthMat;
  const parent = root.parent, rootMatrix = root.matrix.clone(), hidden = [];
  root.traverse((x) => { if ((x.isInstancedMesh || x.isPoints || x.isLine) && x.visible) { x.visible = false; hidden.push(x); } });
  scene.add(root);
  root.matrix.identity(); root.matrixWorld.identity(); root.updateMatrixWorld(true);

  const depthRT = new THREE.WebGLRenderTarget(SIZE, SIZE, { type: THREE.FloatType, depthBuffer: true, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
  const accRT = new THREE.WebGLRenderTarget(ROW, rows, { type: THREE.FloatType, depthBuffer: false, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  g.setAttribute('aIdx', new THREE.BufferAttribute(idx, 1));
  const points = new THREE.Points(g, pointMat);
  points.frustumCulled = false;
  const pscene = new THREE.Scene();
  pscene.add(points);
  const pcam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const cam = new THREE.OrthographicCamera(-r, r, r, -r, 0.01, r * 4);

  const prevRT = R.getRenderTarget(), prevClear = R.getClearColor(new THREE.Color()), prevAlpha = R.getClearAlpha();
  const prevShadow = R.shadowMap.enabled, prevAuto = R.autoClear;
  R.shadowMap.enabled = false;
  R.autoClear = true;
  R.setRenderTarget(accRT);
  R.setClearColor(0x000000, 0);
  R.clear();
  pointMat.uniforms.uDepth.value = depthRT.texture;
  pointMat.uniforms.uRows.value = rows;
  pointMat.uniforms.uBias.value = Math.max(0.02, r * 0.004);
  for (const d of DIR_LIST) {
    cam.position.copy(c).addScaledVector(d, r * 2);
    cam.up.set(Math.abs(d.y) > 0.9 ? 1 : 0, Math.abs(d.y) > 0.9 ? 0 : 1, 0);
    cam.lookAt(c);
    cam.updateMatrixWorld();
    R.setRenderTarget(depthRT);
    R.setClearColor(FAR, 1); // nothing there: farther than anything
    R.clear();
    R.render(scene, cam);
    pointMat.uniforms.uView.value.copy(cam.matrixWorldInverse);
    pointMat.uniforms.uProj.value.copy(cam.projectionMatrix);
    pointMat.uniforms.uL.value.copy(d);
    R.setRenderTarget(accRT);
    R.autoClear = false;
    R.render(pscene, pcam);
    R.autoClear = true;
  }
  const buf = new Float32Array(ROW * rows * 4);
  R.readRenderTargetPixels(accRT, 0, 0, ROW, rows, buf);
  R.setRenderTarget(prevRT);
  R.setClearColor(prevClear, prevAlpha);
  R.shadowMap.enabled = prevShadow;
  R.autoClear = prevAuto;

  // put the rig back as it was
  scene.remove(root);
  if (parent) parent.add(root);
  root.matrix.copy(rootMatrix);
  root.matrix.decompose(root.position, root.quaternion, root.scale);
  root.updateMatrixWorld(true);
  for (const x of hidden) x.visible = true;
  depthRT.dispose(); accRT.dispose(); g.dispose();

  const ao = new Float32Array(V);
  for (let i = 0; i < V; i++) {
    const w = buf[i * 4 + 1];
    ao[i] = w > 1e-4 ? buf[i * 4] / w : 0;
  }
  return ao;
}

// openness into colour: darker and a little browner (grime) the more shut in a vertex is; never below 22 %
const GRIME = [1.0, 0.94, 0.86];
function apply(meshes, ao) {
  let o = 0;
  for (const m of meshes) {
    const C = m.geometry.attributes.color;
    for (let i = 0; i < C.count; i++, o++) {
      const a = ao[o], shut = 1 - a;
      const k = 0.22 + 0.78 * Math.pow(a, 1.1);
      C.setXYZ(i, C.getX(i) * k * (1 - shut * (1 - GRIME[0]) * 0.5), C.getY(i) * k * (1 - shut * (1 - GRIME[1])), C.getZ(i) * k * (1 - shut * (1 - GRIME[2])));
    }
    C.needsUpdate = true;
  }
}
