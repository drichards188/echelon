import * as THREE from 'three';
import { globalUniforms, patchMaterial } from './shaderlib.js';
import { mulberry32, noise3 } from './noise.js';

const rand = Math.random;
const rr = (a, b) => a + (b - a) * rand();
const tmpV = new THREE.Vector3();

// ---------------------------------------------------------------- puff atlas
// Four soft cumulus-like puffs in a 2x2 atlas. rg = billboard-space normal, a = density.
function makePuffAtlas(size = 128) {
  const N = size * 2;
  const data = new Uint8Array(N * N * 4);
  const r = mulberry32(77);
  for (let tile = 0; tile < 4; tile++) {
    const blobs = [];
    const nb = 9 + Math.floor(r() * 6);
    for (let i = 0; i < nb; i++) {
      const a = r() * Math.PI * 2, d = Math.sqrt(r()) * 0.22;
      blobs.push({ x: 0.5 + Math.cos(a) * d, y: 0.5 + Math.sin(a) * d * 0.9, s: 0.1 + r() * 0.13 });
    }
    const dens = new Float32Array(size * size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const u = (x + 0.5) / size, v = (y + 0.5) / size;
        let d = 0;
        for (const b of blobs) {
          const dx = u - b.x, dy = v - b.y;
          d += Math.exp(-(dx * dx + dy * dy) / (b.s * b.s));
        }
        const n = noise3(u * 7 + tile * 13, v * 7, tile) * 0.5 + noise3(u * 17, v * 17 + tile * 5, 3) * 0.25;
        const edge = Math.max(0, 1 - Math.hypot(u - 0.5, v - 0.5) / 0.5);
        dens[y * size + x] = Math.max(0, Math.min(1, (d * 0.55 + n * 0.6 - 0.2) * Math.min(1, edge * 3)));
      }
    }
    const ox = (tile % 2) * size, oy = Math.floor(tile / 2) * size;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const at = (xx, yy) => dens[Math.min(size - 1, Math.max(0, yy)) * size + Math.min(size - 1, Math.max(0, xx))];
        const gx = (at(x + 1, y) - at(x - 1, y)) * 3.5;
        const gy = (at(x, y + 1) - at(x, y - 1)) * 3.5;
        const inv = 1 / Math.sqrt(gx * gx + gy * gy + 1);
        const i = ((oy + y) * N + ox + x) * 4;
        data[i] = (-gx * inv * 0.5 + 0.5) * 255;
        data[i + 1] = (-gy * inv * 0.5 + 0.5) * 255;
        data[i + 2] = 255;
        data[i + 3] = Math.pow(at(x, y), 1.2) * 255;
      }
    }
  }
  const tex = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

// ---------------------------------------------------------------- particle pool
const FIELDS = ['px', 'py', 'pz', 'vx', 'vy', 'vz', 'age', 'life', 's0', 's1', 'rot', 'rotV', 'r', 'g', 'b', 'a', 'glow', 'tile', 'drag', 'buoy', 'kind', 'len'];

class Pool {
  constructor(max) {
    this.max = max;
    this.n = 0;
    for (const f of FIELDS) this[f] = new Float32Array(max);
  }
  spawn() {
    if (this.n >= this.max) return -1;
    return this.n++;
  }
  kill(i) {
    const j = --this.n;
    if (i !== j) for (const f of FIELDS) this[f][i] = this[f][j];
  }
}

const quadGeo = (attrs, max) => {
  const q = new THREE.PlaneGeometry(1, 1);
  const g = new THREE.InstancedBufferGeometry();
  g.index = q.index;
  g.setAttribute('position', q.attributes.position);
  g.setAttribute('uv', q.attributes.uv);
  const out = {};
  for (const name of attrs) {
    const arr = new Float32Array(max * 4);
    const a = new THREE.InstancedBufferAttribute(arr, 4).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute(name, a);
    out[name] = a;
  }
  g.instanceCount = 0;
  return { geo: g, attrs: out };
};

// kinds (smoke system)
// BURST: an 8.8 cm shell's black ball, thrown out at once by the explosion (it fades in within a few frames,
// where the other kinds take a twelfth of their life)
export const SMOKE = { FLAK: 0, PUFF: 1, TRAIL: 2, BLACK: 3, CORDITE: 4, SPRAY: 5, MIST: 6, HAZE: 7, HANG: 8, BURST: 9 };
// kinds (glow system)
const FLAME = 0, FLASH = 1, SPARK = 2;

const unit = new THREE.Vector3();

// ---------------------------------------------------------------- cover shards
// The pieces a frangible canister cover breaks into: a thin, slightly dished, irregular plate about
// a metre across (scaled per piece). Front faces show the instance colour (the paint), back faces
// the pale composite under it.
function shardGeometry() {
  const r = mulberry32(31), n = 6, pos = [0, 0, 0], idx = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + (r() - 0.5) * 0.7, d = 0.32 + r() * 0.24;
    const x = Math.cos(a) * d, y = Math.sin(a) * d;
    pos.push(x, y, -0.18 * (x * x + y * y));
    idx.push(0, 1 + i, 1 + ((i + 1) % n));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
const SHARD = ['px', 'py', 'pz', 'vx', 'vy', 'vz', 'qx', 'qy', 'qz', 'qw', 'wx', 'wy', 'wz', 'sx', 'sy', 'age', 'life', 'drag', 'flut', 'fph', 'ffq', 'fdx', 'fdz', 'rest', 'gy', 'cr', 'cg', 'cb'];
const PALE = new THREE.Color(0xd2c3a6); // a flake of the cover's composite, both faces pale
const _sc = new THREE.Color(), _sq = new THREE.Quaternion(), _sq2 = new THREE.Quaternion(), _se = new THREE.Euler();
const _su = new THREE.Vector3(), _sw = new THREE.Vector3(), _sr = new THREE.Vector3();

// ---------------------------------------------------------------- spent cases and links
// A gun's spent cases and belt links: a ring buffer in typed arrays drawn as one instanced mesh (a short
// six-sided cylinder along y; a case is scaled to its diameter and length, a link flattened to a clip).
// They tumble out, bounce once or twice and lie where they fall until the slot is reused.
const BRASS = ['px', 'py', 'pz', 'vx', 'vy', 'vz', 'qx', 'qy', 'qz', 'qw', 'ax', 'ay', 'az', 'ang', 'w', 'sx', 'sy', 'sz', 'age', 'life', 'rest', 'flat', 'gy0', 'cr', 'cg', 'cb'];
const CASE_COL = new THREE.Color(0xb59a62), LINK_COL = new THREE.Color(0x4a4944);

// the lid pool: whole container lids blown off a launcher, tumbling down and lying where they land
const MAX_LIDS = 16;
const _lq = new THREE.Quaternion();

// ---------------------------------------------------------------- bomb craters
// A crater seen from above, on a unit square: the blackened, wet bottom, the lip of thrown-up raw earth
// and its spray of clods in rays, fading into the ground round it (alpha). Drawn flat on the terrain.
const MAX_CRATERS = 64;
function craterTexture(size = 128) {
  const data = new Uint8Array(size * size * 4);
  const r = mulberry32(53);
  const rays = Array.from({ length: 14 }, () => ({ a: r() * Math.PI * 2, w: 0.04 + r() * 0.08, l: 0.75 + r() * 0.25 }));
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) / size - 0.5, v = (y + 0.5) / size - 0.5;
      const d = Math.hypot(u, v) * 2, a = Math.atan2(v, u);
      const n = noise3(u * 9, v * 9, 1) * 0.5 + noise3(u * 23, v * 23, 4) * 0.25;
      const rim = d + n * 0.12;
      let ray = 0;
      for (const q of rays) {
        const da = Math.abs(((a - q.a + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
        if (da < q.w) ray = Math.max(ray, (1 - da / q.w) * Math.max(0, 1 - d / q.l));
      }
      // the bottom (dark), the lip (raw sandy earth), the spray beyond it
      const bottom = 1 - Math.min(1, Math.max(0, (rim - 0.26) / 0.12));
      const lip = Math.max(0, 1 - Math.abs(rim - 0.46) / 0.16);
      const spray = Math.max(0, Math.min(1, ray * 1.4 + (n + 0.2) * Math.max(0, 1 - d) * 0.6));
      let cr = 0.3, cg = 0.25, cb = 0.18;
      cr += (0.07 - cr) * bottom; cg += (0.06 - cg) * bottom; cb += (0.05 - cb) * bottom;
      const k = 0.9 + n * 0.3;
      const alpha = Math.min(1, Math.max(bottom, lip * 0.95, spray * 0.8 * Math.max(0, 1 - d * 0.9))) * Math.max(0, Math.min(1, (1 - d) * 4));
      const i = (y * size + x) * 4;
      data[i] = Math.min(255, cr * k * 255);
      data[i + 1] = Math.min(255, cg * k * 255);
      data[i + 2] = Math.min(255, cb * k * 255);
      data[i + 3] = alpha * 255;
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}
const _cn = new THREE.Vector3(), _cq = new THREE.Quaternion(), _cq2 = new THREE.Quaternion(), _cs = new THREE.Vector3(), _cm = new THREE.Matrix4(), _cu = new THREE.Vector3(0, 1, 0);

export class FX {
  constructor(scene, { maxSmoke = 7000, maxGlow = 4000, maxDebris = 300, maxShards = 640, maxBrass = 1600, lights = 4 } = {}) {
    this.scene = scene;
    this.smoke = new Pool(maxSmoke);
    this.glow = new Pool(maxGlow);
    this.wind = new THREE.Vector3(-5, 0, 2);
    this.budget = 1; // scaled by the quality preset
    const atlas = makePuffAtlas();

    // lit, sorted smoke / spray
    const s = quadGeo(['iA', 'iB', 'iC'], maxSmoke);
    this.smokeAttrs = s.attrs;
    this.smokeMat = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([
        THREE.UniformsLib.fog,
        {
          uTex: { value: null },
          uLightView: { value: new THREE.Vector3(0, 1, 0) },
          uSun: { value: new THREE.Color(1, 1, 1) },
          uAmbient: { value: new THREE.Color(0.4, 0.45, 0.5) },
          uGlowColor: { value: new THREE.Color(4, 1.4, 0.3) },
        },
      ]),
      vertexShader: /* glsl */ `
        attribute vec4 iA; // position, size
        attribute vec4 iB; // albedo, alpha
        attribute vec4 iC; // rotation, glow, tile
        varying vec2 vUv;
        varying vec4 vCol;
        varying float vGlow;
        varying float vRot;
        varying float vNear;
        #include <fog_pars_vertex>
        void main() {
          vec4 mvPosition = viewMatrix * vec4(iA.xyz, 1.0);
          float c = cos(iC.x), s = sin(iC.x);
          mvPosition.xy += mat2(c, s, -s, c) * position.xy * iA.w;
          float tile = iC.z;
          vUv = (uv + vec2(mod(tile, 2.0), floor(tile / 2.0))) * 0.5;
          vCol = iB;
          vGlow = iC.y;
          vRot = iC.x;
          vNear = smoothstep(1.0, 4.0 + iA.w * 0.6, -mvPosition.z);
          gl_Position = projectionMatrix * mvPosition;
          if (vNear < 0.002) gl_Position = vec4(2.0, 2.0, 2.0, 1.0); // fully faded: skip the fill
          #include <fog_vertex>
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D uTex;
        uniform vec3 uLightView;
        uniform vec3 uSun;
        uniform vec3 uAmbient;
        uniform vec3 uGlowColor;
        varying vec2 vUv;
        varying vec4 vCol;
        varying float vGlow;
        varying float vRot;
        varying float vNear;
        #include <fog_pars_fragment>
        void main() {
          vec4 t = texture2D(uTex, vUv);
          float a = t.a * vCol.a * vNear;
          if (a < 0.004) discard;
          vec2 nxy = t.rg * 2.0 - 1.0;
          float c = cos(vRot), s = sin(vRot);
          nxy = mat2(c, s, -s, c) * nxy;
          vec3 n = vec3(nxy, sqrt(max(1.0 - dot(nxy, nxy), 0.0)));
          float ndl = dot(n, uLightView);
          float thin = 1.0 - t.a;
          vec3 light = uAmbient * (0.75 + 0.25 * n.y) + uSun * (0.3 + 0.7 * max(ndl, 0.0) + thin * 0.4 * max(-uLightView.z, 0.0));
          #ifdef USE_FOG
          // parachute flares light the smoke too (the flare uniforms come with the fog chunk)
          for (int fi = 0; fi < 4; fi++) {
            if (fi >= uFlareCount) break;
            vec3 fd = uFlarePos[fi] - vFogWorldPos;
            float d2 = dot(fd, fd);
            vec3 fl = normalize((viewMatrix * vec4(fd, 0.0)).xyz);
            light += uFlareCol[fi] / (d2 + 1.6e5) * (1.0 - smoothstep(9.0e6, 1.6e7, d2)) * (0.45 + 0.55 * max(dot(n, fl), 0.0) + thin * 0.3);
          }
          #endif
          vec3 col = vCol.rgb * light + uGlowColor * vGlow * (0.4 + t.a);
          gl_FragColor = vec4(col, a);
          #include <fog_fragment>
        }
      `,
      transparent: true,
      depthWrite: false,
      fog: true,
    });
    this.smokeMat.uniforms.uTex.value = atlas;
    Object.assign(this.smokeMat.uniforms, globalUniforms);
    this.smokeMesh = new THREE.Mesh(s.geo, this.smokeMat);
    this.smokeMesh.frustumCulled = false;
    this.smokeMesh.renderOrder = 5;
    scene.add(this.smokeMesh);

    // additive HDR flames, flashes and sparks
    const gq = quadGeo(['iA', 'iB', 'iD'], maxGlow);
    this.glowAttrs = gq.attrs;
    this.glowMat = new THREE.ShaderMaterial({
      uniforms: {
        uTex: { value: atlas },
        uFogDensity: { value: 0.00006 },
        uGlowScale: { value: 1 }, // turned down by night, when the eye is open wide
      },
      vertexShader: /* glsl */ `
        attribute vec4 iA; // position, size
        attribute vec4 iB; // hdr color, alpha
        attribute vec4 iD; // streak vector (world, length baked in), kind
        uniform float uFogDensity;
        uniform float uGlowScale;
        varying vec2 vUv;
        varying vec4 vCol;
        varying float vKind;
        varying vec2 vQ;
        void main() {
          vec4 p0 = viewMatrix * vec4(iA.xyz, 1.0);
          vKind = iD.w;
          vec2 q = position.xy;
          vQ = q * 2.0;
          vUv = uv * 0.5;
          if (dot(iD.xyz, iD.xyz) > 1e-6) {
            // streak: stretch between the head and the tail in view space
            vec4 p1 = viewMatrix * vec4(iA.xyz - iD.xyz, 1.0);
            vec2 axis = p0.xy / -p0.z - p1.xy / -p1.z;
            axis = length(axis) > 1e-6 ? normalize(axis) : vec2(1.0, 0.0);
            vec2 perp = vec2(-axis.y, axis.x);
            float k = q.x + 0.5;
            vec4 p = mix(p1, p0, k);
            float w = max(iA.w, -p.z * 0.0015);
            p.xy += perp * q.y * w + axis * (q.x * w);
            gl_Position = projectionMatrix * p;
          } else {
            p0.xy += q * iA.w;
            gl_Position = projectionMatrix * p0;
          }
          float d = length(p0.xyz);
          vCol = iB * exp(-d * uFogDensity);
          vCol.rgb *= uGlowScale;
          vCol.a *= smoothstep(0.3, 1.5, -p0.z);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D uTex;
        varying vec2 vUv;
        varying vec4 vCol;
        varying float vKind;
        varying vec2 vQ;
        void main() {
          float a;
          if (vKind < 0.5) {
            a = texture2D(uTex, vUv).a;
            a = smoothstep(0.05, 0.8, a);
          } else if (vKind < 1.5) {
            float r = length(vQ);
            float ang = atan(vQ.y, vQ.x);
            float star = pow(abs(cos(ang * 3.0)), 12.0) * (1.0 - r) * 0.8;
            a = exp(-r * r * 9.0) + star + exp(-r * 3.5) * 0.25;
            a *= smoothstep(1.0, 0.8, r);
          } else {
            float r = abs(vQ.y);
            a = exp(-r * r * 6.0) * smoothstep(1.0, 0.6, abs(vQ.x));
          }
          gl_FragColor = vec4(vCol.rgb * a * vCol.a, 1.0);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.glowMesh = new THREE.Mesh(gq.geo, this.glowMat);
    this.glowMesh.frustumCulled = false;
    this.glowMesh.renderOrder = 6;
    scene.add(this.glowMesh);

    // tumbling debris
    this.maxDebris = maxDebris;
    this.debris = [];
    const dg = new THREE.BoxGeometry(1, 0.25, 0.6);
    this.debrisMesh = new THREE.InstancedMesh(dg, new THREE.MeshStandardMaterial({ color: 0x24272a, roughness: 0.7, metalness: 0.3 }), maxDebris);
    this.debrisMesh.count = 0;
    this.debrisMesh.frustumCulled = false;
    this.debrisMesh.castShadow = true;
    this.debrisMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.add(this.debrisMesh);
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._s = new THREE.Vector3();

    // cover shards: a fixed pool in typed arrays, drawn as one instanced mesh with per-piece colour
    this.shards = { n: 0, max: maxShards };
    for (const f of SHARD) this.shards[f] = new Float32Array(maxShards);
    const shardMat = new THREE.MeshStandardMaterial({ roughness: 0.92, metalness: 0, side: THREE.DoubleSide });
    patchMaterial(shardMat, 'fx-shard', (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <color_fragment>',
        '#include <color_fragment>\n\tif ( !gl_FrontFacing ) diffuseColor.rgb = vec3( 0.6, 0.51, 0.37 ); // the composite under the paint'
      );
    });
    this.shardMesh = new THREE.InstancedMesh(shardGeometry(), shardMat, maxShards);
    this.shardMesh.setColorAt(0, PALE); // creates the colour attribute up front, so the program never recompiles
    this.shardMesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.shardMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.shardMesh.count = 0;
    this.shardMesh.frustumCulled = false;
    this.shardMesh.castShadow = true;
    this.shardMesh.receiveShadow = true;
    scene.add(this.shardMesh);

    // spent cases and links: a ring buffer, one instanced mesh with per-piece colour
    this.cases = { next: 0, max: maxBrass, live: 0 };
    for (const f of BRASS) this.cases[f] = new Float32Array(maxBrass);
    const caseMat = patchMaterial(new THREE.MeshStandardMaterial({ roughness: 0.32, metalness: 0.8 }), 'fog');
    this.caseMesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.5, 0.5, 1, 6, 1), caseMat, maxBrass);
    this.caseMesh.setColorAt(0, CASE_COL); // the colour attribute up front, so the program never recompiles
    this.caseMesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.caseMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.caseMesh.count = 0;
    this.caseMesh.frustumCulled = false;
    this.caseMesh.castShadow = false;
    this.caseMesh.receiveShadow = true;
    scene.add(this.caseMesh);

    // whole lids in flight or on the ground: { obj, vel, axis, w, age, rest, life }
    this.lids = [];

    // bomb craters: flat decals in a ring buffer, one instanced mesh (made here, so the loading screen's
    // warm-up compiles it and the first bomb does not)
    const craterMat = patchMaterial(new THREE.MeshStandardMaterial({ map: craterTexture(), roughness: 0.95, metalness: 0, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }), 'fog');
    const craterMesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), craterMat, MAX_CRATERS);
    craterMesh.count = 0;
    craterMesh.frustumCulled = false;
    craterMesh.receiveShadow = true;
    craterMesh.renderOrder = 1;
    scene.add(craterMesh);
    this.craters = { next: 0, n: 0, mesh: craterMesh };

    // a fixed pool of point lights for nearby blasts and muzzle flashes (never added/removed at runtime)
    this.lights = [];
    for (let i = 0; i < lights; i++) {
      const l = new THREE.PointLight(0xffa860, 0, 0, 2);
      l.userData = { t: 0, life: 1, peak: 0 };
      scene.add(l);
      this.lights.push(l);
    }

    this.hangN = 0; // long-lived trail puffs alive (SMOKE.HANG), kept to a share of the pool
    this.sites = []; // ground fires left by impacts: { p, k, t, life, acc }
    this.ground = () => 0; // (x, z) -> ground height, set by main (terrain.heightAt)
    this.dt = 1 / 60;
    this.alloc = { smoke: maxSmoke, glow: maxGlow };
    this._order = new Float64Array(maxSmoke);
    this._cam = new THREE.Vector3();
  }

  // ---------------------------------------------------------------- spawning
  addSmoke(kind, x, y, z, vx, vy, vz, life, s0, s1, r, g, b, a, { glow = 0, drag = 0.4, buoy = 0 } = {}) {
    const P = this.smoke;
    const i = P.spawn();
    if (i < 0) return;
    P.px[i] = x; P.py[i] = y; P.pz[i] = z;
    P.vx[i] = vx; P.vy[i] = vy; P.vz[i] = vz;
    P.age[i] = 0; P.life[i] = life;
    P.s0[i] = s0; P.s1[i] = s1;
    P.rot[i] = rand() * 6.283; P.rotV[i] = rr(-0.3, 0.3);
    P.r[i] = r; P.g[i] = g; P.b[i] = b; P.a[i] = a;
    P.glow[i] = glow; P.tile[i] = Math.floor(rand() * 4);
    P.drag[i] = drag; P.buoy[i] = buoy; P.kind[i] = kind;
    return i;
  }

  addGlow(kind, x, y, z, vx, vy, vz, life, s0, s1, r, g, b, a, { len = 0, drag = 0.5, buoy = 0 } = {}) {
    const P = this.glow;
    const i = P.spawn();
    if (i < 0) return;
    P.px[i] = x; P.py[i] = y; P.pz[i] = z;
    P.vx[i] = vx; P.vy[i] = vy; P.vz[i] = vz;
    P.age[i] = 0; P.life[i] = life;
    P.s0[i] = s0; P.s1[i] = s1;
    P.rot[i] = rand() * 6.283; P.rotV[i] = 0;
    P.r[i] = r; P.g[i] = g; P.b[i] = b; P.a[i] = a;
    P.kind[i] = kind; P.len[i] = len; P.drag[i] = drag; P.buoy[i] = buoy;
    P.tile[i] = Math.floor(rand() * 4);
    return i;
  }

  light(pos, intensity, life, color) {
    // reuse the weakest light
    let best = this.lights[0], bestV = Infinity;
    for (const l of this.lights) {
      const u = l.userData;
      const v = u.peak * Math.max(0, 1 - u.t / u.life);
      if (v < bestV) {
        bestV = v;
        best = l;
      }
    }
    if (bestV > intensity) return;
    best.position.copy(pos);
    best.color.set(color || 0xffa860);
    best.userData.t = 0;
    best.userData.life = life;
    best.userData.peak = intensity;
  }

  // A muzzle flash. `own`: the player's own gun, a couple of metres from his eye, gets the flash its
  // flash hider really let out (about half a metre across on an Oerlikon, a metre on a Bofors) and
  // a dimmer core, or it would fill a third of the view and bloom over the gun.
  muzzle(p, dir, size = 1, smoke = true, own = false) {
    const s = size;
    const k = own ? 0.35 : 1, z = own ? 0.55 : 1;
    this.addGlow(FLASH, p.x + dir.x * 0.4 * s * z, p.y + dir.y * 0.4 * s * z, p.z + dir.z * 0.4 * s * z, 0, 0, 0, own ? 0.045 : 0.06, 0.9 * s * z, 1.4 * s * z * 0.85, 60 * k, 34 * k, 12 * k, 1);
    // a cone of flame along the bore that doesn't travel
    this.addGlow(SPARK, p.x, p.y, p.z, dir.x, dir.y, dir.z, 0.05, 0.45 * s * z, 0.6 * s * z, 40 * k, 20 * k, 6 * k, 1, { len: 2.2 * s * z, drag: 1e6 });
    if (smoke) {
      // pushed out ahead of the muzzle so it never sits on the camera
      this.addSmoke(SMOKE.CORDITE, p.x + dir.x * 3 * s, p.y + dir.y * 3 * s, p.z + dir.z * 3 * s, dir.x * 14 * s, dir.y * 14 * s, dir.z * 14 * s, rr(1, 2) * s, 0.6 * s, rr(3, 4.5) * s, 0.5, 0.48, 0.45, 0.35, { drag: 2.5, buoy: 0.6 });
    }
  }

  sparks(p, n = 8, speed = 25, color = [30, 18, 6]) {
    for (let i = 0; i < n; i++) {
      const v = tmpV.randomDirection().multiplyScalar(rr(0.3, 1) * speed);
      this.addGlow(SPARK, p.x, p.y, p.z, v.x, v.y + speed * 0.3, v.z, rr(0.25, 0.7), 0.08, 0.05, color[0], color[1], color[2], 1, { len: 0.04, drag: 0.6, buoy: -9.8 });
    }
  }

  /** Smoke puff for trails behind damaged aircraft and burning wreckage. k: 0 grey .. 1 black and burning. */
  trail(p, vel, k) {
    const black = k > 0.5;
    const c = black ? 0.035 : 0.3 - k * 0.3;
    this.addSmoke(black ? SMOKE.BLACK : SMOKE.TRAIL, p.x + rr(-0.3, 0.3), p.y + rr(-0.3, 0.3), p.z + rr(-0.3, 0.3), vel.x * 0.15, vel.y * 0.15, vel.z * 0.15, rr(2.5, 4.5) * (black ? 1.5 : 1), 1 + k, 4 + k * 5, c, c, c * 1.05, black ? 0.75 : 0.5, { drag: 1.2, glow: black ? 0.05 : 0 });
    if (k > 0.6) {
      this.addGlow(FLAME, p.x, p.y, p.z, vel.x * 0.6, vel.y * 0.6, vel.z * 0.6, rr(0.15, 0.3), 1.2, 2.6, 14, 5, 1.2, 1, { drag: 3 });
    }
  }

  /** One frame of a burning fire (ship fires call this repeatedly). */
  fire(p, size = 1, smokeRate = 1) {
    const s = size;
    this.addGlow(FLAME, p.x + rr(-1, 1) * s, p.y + rr(0, 1) * s, p.z + rr(-1, 1) * s, rr(-0.5, 0.5), rr(2, 5) * s, rr(-0.5, 0.5), rr(0.5, 1.1), 1.4 * s, 3.4 * s, 9, 3.6, 0.9, 1, { drag: 0.5 });
    if (rand() < 0.35 * smokeRate * this.budget) {
      this.addSmoke(SMOKE.BLACK, p.x, p.y + 2 * s, p.z, rr(-0.5, 0.5), rr(4, 7), rr(-0.5, 0.5), rr(12, 22), 2.5 * s, rr(18, 32) * Math.sqrt(s), 0.03, 0.028, 0.026, 0.8, { glow: 0.35, drag: 0.15, buoy: 0.4 });
    }
  }

  /** Funnel exhaust haze. */
  haze(p) {
    this.addSmoke(SMOKE.HAZE, p.x, p.y, p.z, rr(-0.4, 0.4), rr(2, 4), rr(-0.4, 0.4), rr(6, 10), 2, 12, 0.32, 0.31, 0.3, 0.18, { drag: 0.2, buoy: 0.1 });
  }

  explosion(p, size = 1, { debris = true, fireball = true } = {}) {
    const s = size;
    if (fireball) {
      this.addGlow(FLASH, p.x, p.y, p.z, 0, 0, 0, 0.18, 10 * s, 26 * s, 60, 40, 22, 1);
      const nf = Math.round(14 * s * this.budget) + 4;
      for (let i = 0; i < nf; i++) {
        const v = tmpV.randomDirection().multiplyScalar(rr(4, 16) * s);
        this.addGlow(FLAME, p.x + v.x * 0.15, p.y + v.y * 0.15, p.z + v.z * 0.15, v.x, v.y + 3 * s, v.z, rr(0.6, 1.4) * Math.sqrt(s), 3 * s, rr(8, 14) * s, 16, 6.5, 1.6, 1, { drag: 2.2, buoy: 1.5 });
      }
      this.light(p, 4000 * s * s, 0.6 + s * 0.5, 0xff9a50);
    }
    const ns = Math.round(10 * s * this.budget) + 3;
    for (let i = 0; i < ns; i++) {
      const v = tmpV.randomDirection().multiplyScalar(rr(3, 10) * s);
      this.addSmoke(SMOKE.BLACK, p.x + v.x * 0.3, p.y + v.y * 0.3, p.z + v.z * 0.3, v.x, Math.abs(v.y) + 2 * s, v.z, rr(6, 14) * Math.sqrt(s), 4 * s, rr(14, 26) * s, 0.04, 0.035, 0.03, 0.85, { glow: 0.5, drag: 1.2, buoy: 0.8 });
    }
    this.sparks(p, Math.round(18 * s) + 4, 30 * s + 15);
    if (debris) this.debrisBurst(p, Math.round(8 * s) + 3, 12 + 20 * s, 0.4 + s * 0.8);
  }

  debrisBurst(p, n, speed, size) {
    for (let i = 0; i < n; i++) {
      if (this.debris.length >= this.maxDebris) break;
      const v = new THREE.Vector3().randomDirection().multiplyScalar(rr(0.3, 1) * speed);
      v.y = Math.abs(v.y) + speed * 0.3;
      this.debris.push({
        p: p.clone(),
        v,
        q: new THREE.Quaternion().random(),
        w: new THREE.Vector3().randomDirection().multiplyScalar(rr(4, 14)),
        s: size * rr(0.4, 1.2),
        life: rr(3, 7),
        smoke: rand() < 0.4,
      });
    }
  }

  /** Scale the particle load (quality presets); the pools keep their allocation, the cap follows. */
  setBudget(b) {
    this.budget = b;
    this.smoke.max = Math.max(500, Math.round(this.alloc.smoke * Math.min(1, 0.3 + b * 0.7)));
    this.glow.max = Math.max(300, Math.round(this.alloc.glow * Math.min(1, 0.3 + b * 0.7)));
  }

  /** Spare pool room: optional particles skip themselves when the pools run full. */
  cheap() {
    return this.smoke.n < this.smoke.max * 0.85;
  }

  /** Samples along the last frame's path of something moving at vel, so fast trails stay unbroken. */
  _samples(vel, spacing) {
    const sp = vel.length();
    return Math.min(14, Math.max(1, Math.round((sp * this.dt) / (spacing / Math.max(0.5, this.budget)))));
  }

  /**
   * A hot launch off a rail or turret: a flash, the fire jet and backblast thrown out behind the round,
   * a dust ring blown across the ground and the white booster smoke that hangs for a quarter of a minute.
   * size: ~0.3 for a shoulder-sized round, 1 for a Pantsir.
   */
  launchBlast(p, dir, size = 1) {
    const s = size, b = this.budget;
    const gy = this.ground(p.x, p.z);
    const h = Math.max(0, p.y - gy);
    this.addGlow(FLASH, p.x, p.y, p.z, 0, 0, 0, 0.22, 3.5 * s, 11 * s, 60, 40, 20, 1);
    this.addGlow(SPARK, p.x, p.y, p.z, dir.x, dir.y, dir.z, 0.4, 1.1 * s, 1.9 * s, 40, 22, 8, 1, { len: 9 * s, drag: 1e6 });
    // the exhaust goes out behind the round
    for (let i = 0; i < 6; i++) {
      tmpV.set(-dir.x + rr(-0.25, 0.25), -dir.y + rr(-0.25, 0.25), -dir.z + rr(-0.25, 0.25)).multiplyScalar(rr(5, 16) * s);
      this.addGlow(FLAME, p.x, p.y, p.z, tmpV.x, tmpV.y, tmpV.z, rr(0.4, 0.9), 1.5 * s, 3 * s, 14, 6, 1.5, 1, { drag: 1.2 });
    }
    this.light(p, 3500 * s * s, 0.7, 0xffa860);
    // the blast kicks the dust up in a ring
    const nd = Math.round(22 * s * b) + 8;
    for (let i = 0; i < nd; i++) {
      const a = rand() * 6.283, v = rr(5, 22) * s;
      this.addSmoke(SMOKE.PUFF, p.x + Math.cos(a) * 2 * s, gy + rr(0.3, 1.5), p.z + Math.sin(a) * 2 * s, Math.cos(a) * v, rr(0.5, 3) * s, Math.sin(a) * v, rr(5, 10), 3 * s, rr(9, 17) * s, 0.46, 0.38, 0.28, h > 8 ? 0.4 : 0.6, { drag: 0.55, buoy: 0.25 });
    }
    // booster smoke: a billowing white cloud round the launcher, thickest behind the round
    const ns = Math.round(22 * s * b) + 6;
    for (let i = 0; i < ns; i++) {
      const t = i / ns;
      tmpV.randomDirection();
      this.addSmoke(SMOKE.PUFF, p.x + tmpV.x * 1.5 * s - dir.x * t * 5 * s, p.y + tmpV.y * s - dir.y * t * 5 * s, p.z + tmpV.z * 1.5 * s - dir.z * t * 5 * s, tmpV.x * 3 * s, Math.abs(tmpV.y) * 3 * s + 1, tmpV.z * 3 * s, rr(9, 16), 2.5 * s, rr(11, 20) * s, 0.88, 0.87, 0.85, 0.7, { drag: 0.45, buoy: 0.5 });
    }
    this.sparks(p, Math.round(8 * s) + 4, 18 * s + 8, [30, 14, 4]);
  }

  /**
   * The S-400's cold launch: the round is pushed out of its canister by gas, so there is no fire, only a
   * burst of white gas and steam over the mouth, the pad's dust blown out from under the launcher and the
   * round rising on its own. size: ~1.5 for a 48N6.
   */
  coldLaunch(p, dir, size = 1.5) {
    const s = size, b = this.budget;
    const gy = this.ground(p.x, p.z);
    const n = Math.round(16 * s * b) + 6;
    for (let i = 0; i < n; i++) {
      tmpV.randomDirection();
      const k = rand();
      this.addSmoke(SMOKE.PUFF, p.x + tmpV.x * s, p.y - 1 - k * 3 * s + tmpV.y * s, p.z + tmpV.z * s, tmpV.x * 7 * s + dir.x * 3, 2 + k * 6 * s + Math.abs(tmpV.y) * 3, tmpV.z * 7 * s + dir.z * 3, rr(7, 13), 1.6 * s, rr(6, 12) * s, 0.93, 0.93, 0.92, 0.65, { drag: 0.8, buoy: 0.3 });
    }
    // the gas that blew the round out spreads the pad's dust: a low tan skirt rolling out from under it
    const nd = Math.round(16 * s * b) + 6;
    for (let i = 0; i < nd; i++) {
      const a = rand() * 6.283, v = rr(3, 12) * s;
      this.addSmoke(SMOKE.PUFF, p.x + Math.cos(a) * 3, gy + rr(0.3, 1.5), p.z + Math.sin(a) * 3, Math.cos(a) * v, rr(0.3, 2), Math.sin(a) * v, rr(9, 16), 2.5 * s, rr(7, 13) * s, 0.55, 0.46, 0.35, 0.55, { drag: 0.55, buoy: 0.15 });
    }
  }

  /**
   * The motor of a cold-launched round lighting a few tens of metres up (p: the nozzle): a hard flash, a
   * bright jet, a thick white cloud of motor smoke that the column grows from, the white gas column down
   * to the pad, and the jet's blast on the ground: a big orange-tan cloud of dust and gas boiling up round
   * the launcher to about the height of its canisters and rolling outward for tens of metres (the S-300P
   * launch photos, refs/launch). It hangs for a minute or so. size: ~1.5 for a 48N6.
   */
  ignition(p, dir, size = 1.5) {
    const s = size, b = this.budget;
    const gy = this.ground(p.x, p.z), h = Math.max(0, p.y - gy);
    // long-lived: thinned out when the pool is already busy
    const q = this.cheap() ? 1 : 0.4, k = Math.min(1, s);
    this.addGlow(FLASH, p.x, p.y, p.z, 0, 0, 0, 0.3, 3 * s, 12 * s, 60, 42, 22, 1);
    this.addGlow(SPARK, p.x, p.y, p.z, dir.x, dir.y, dir.z, 0.5, 1.2 * s, 2.2 * s, 45, 26, 9, 1, { len: 10 * s, drag: 1e6 });
    this.light(p, 6000 * s, 0.9, 0xffb070);
    const n = Math.round(22 * s * b * q) + 8;
    for (let i = 0; i < n; i++) {
      tmpV.randomDirection();
      const f = rand();
      this.addSmoke(SMOKE.PUFF, p.x + tmpV.x * 2 * s - dir.x * f * 6 * s, p.y + tmpV.y * 2 * s - dir.y * f * 6 * s, p.z + tmpV.z * 2 * s - dir.z * f * 6 * s, tmpV.x * 6 * s, tmpV.y * 4 * s + 2, tmpV.z * 6 * s, rr(20, 40) * k, 2.5 * s, rr(12, 22) * s, 0.9, 0.9, 0.88, 0.72, { drag: 0.5, buoy: 0.3 });
    }
    // the white gas column between the pad and the round, rooted on the launcher
    const nc = Math.round(12 * s * b * q) + 4;
    for (let i = 0; i < nc; i++) {
      const f = rand();
      this.addSmoke(SMOKE.PUFF, p.x + rr(-2, 2) * s, gy + 2 + f * h, p.z + rr(-2, 2) * s, rr(-1.5, 1.5) * s, rr(0.5, 2.5), rr(-1.5, 1.5) * s, rr(50, 90) * k, 3 * s, rr(10, 18) * s, 0.9, 0.89, 0.86, 0.6, { drag: 0.5, buoy: 0.2 });
    }
    // the jet on the pad: an orange-tan cloud boiling up round the launcher and rolling out over the ground
    const nd = Math.round(30 * s * b * q) + 10;
    for (let i = 0; i < nd; i++) {
      const a = rand() * 6.283, r0 = rr(1, 6) * s, v = rr(3, 11) * s, warm = rand();
      this.addSmoke(SMOKE.PUFF, p.x + Math.cos(a) * r0, gy + rr(0.5, 5) * s, p.z + Math.sin(a) * r0, Math.cos(a) * v, rr(1, 4) * s, Math.sin(a) * v, rr(30, 60) * k, 4 * s, rr(13, 22) * s, 0.62 + warm * 0.08, 0.5 + warm * 0.03, 0.36, 0.6, { drag: 0.45, buoy: 0.1 });
    }
    // and its glow at the moment it lights
    this.addGlow(FLASH, p.x, gy + 1.5, p.z, 0, 0, 0, 0.45, 4 * s, 12 * s, 34, 20, 8, 1);
    for (let i = 0; i < 5; i++) {
      const a = rand() * 6.283, r0 = rr(1, 5) * s;
      this.addGlow(FLAME, p.x + Math.cos(a) * r0, gy + rr(1, 3) * s, p.z + Math.sin(a) * r0, Math.cos(a) * 8 * s, rr(1, 4), Math.sin(a) * 8 * s, rr(0.4, 0.8), 2 * s, 6 * s, 12, 5.5, 1.6, 1, { drag: 1.5 });
    }
    this.sparks(tmpV.set(p.x, gy + 1, p.z), Math.round(8 * s) + 4, 16 * s + 8, [30, 14, 4]);
  }

  /**
   * A gas-dynamic side thruster firing (the 9M96's pitch-over just after its motor lights): a pop of
   * light and a short jet of grey-white gas thrown sideways off the body, left hanging beside the trail.
   * p: the thruster; dir: the way the gas leaves (away from the turn); size: ~1 for a 9M96.
   */
  thruster(p, dir, size = 1) {
    const s = size, far = 1 + Math.min(4, this._cam.distanceTo(p) / 800);
    this.addGlow(FLASH, p.x, p.y, p.z, 0, 0, 0, 0.07, 0.5 * s * far, 1.6 * s * far, 40, 30, 18, 1);
    this.addGlow(SPARK, p.x, p.y, p.z, -dir.x, -dir.y, -dir.z, 0.06, 0.25 * s * far, 0.35 * s * far, 30, 22, 12, 1, { len: 1.2 * s * far, drag: 1e6 });
    const n = Math.round(4 + 4 * this.budget);
    for (let i = 0; i < n; i++) {
      tmpV.randomDirection();
      const v = rr(15, 40) * s;
      this.addSmoke(SMOKE.PUFF, p.x + dir.x * 0.3, p.y + dir.y * 0.3, p.z + dir.z * 0.3, dir.x * v + tmpV.x * 3, dir.y * v + tmpV.y * 3, dir.z * v + tmpV.z * 3, rr(3, 6), 0.3 * s * far, rr(2.5, 4.5) * s * far, 0.88, 0.88, 0.86, 0.75, { drag: 3.5, buoy: 0.2 });
    }
  }

  /**
   * A booster dropping off at burnout: a pop of light at the joint and a small puff of grey-white smoke
   * left hanging where the dart went on. vel: the round's velocity; size: ~1 for a 57E6.
   */
  separation(p, vel, size = 1) {
    const s = size, far = 1 + Math.min(4, this._cam.distanceTo(p) / 800);
    this.addGlow(FLASH, p.x, p.y, p.z, 0, 0, 0, 0.08, 0.6 * s * far, 2 * s * far, 30, 20, 9, 1);
    const n = Math.round(6 * this.budget) + 4;
    for (let i = 0; i < n; i++) {
      tmpV.randomDirection();
      this.addSmoke(SMOKE.PUFF, p.x + tmpV.x * 0.4 * s, p.y + tmpV.y * 0.4 * s, p.z + tmpV.z * 0.4 * s, vel.x * 0.02 + tmpV.x * rr(2, 6) * s, vel.y * 0.02 + tmpV.y * rr(2, 6) * s, vel.z * 0.02 + tmpV.z * rr(2, 6) * s, rr(3, 6), 0.5 * s * far, rr(2.5, 4.5) * s * far, 0.82, 0.82, 0.8, 0.55, { drag: 2, buoy: 0.2 });
    }
  }

  /**
   * A frangible canister cover bursting as the round breaks through it (the S-300P launch photos show
   * pale flakes thrown up and out round the round, still in the air seconds later): a few dozen pieces
   * of the cover (painted outside, pale composite inside) and pale flakes flung up the axis and out,
   * tumbling and fluttering back down to lie round the launcher, and a puff of the composite's dust.
   * p: the cover's centre; dir: out of the mouth; size: the cover's diameter (1.1 for a 48N6 dome,
   * 0.34 for a 9M96 cell); paint: its colour.
   */
  coverBurst(p, dir, size = 1, paint = 0x434b37) {
    const s = size, k = Math.min(1, s);
    // a basis across the axis
    _su.set(Math.abs(dir.y) < 0.9 ? 0 : 1, Math.abs(dir.y) < 0.9 ? 1 : 0, 0).cross(dir).normalize();
    _sw.crossVectors(dir, _su);
    _sc.setHex(paint);
    const gy = this.ground(p.x, p.z);
    // a small cell cover still throws enough, and big enough, pieces to read from the usual camera
    // distances (a few pixels at 50 m)
    const pieces = Math.round(24 + 18 * k), flakes = Math.round(14 + 10 * k);
    for (let i = 0; i < pieces + flakes; i++) {
      const flake = i >= pieces;
      // where on the cover it was (rho 0 the crown, 1 the rim), and the push: up the axis with the gas
      // and out from the centre, the rim pieces out further
      const a = rand() * 6.283, rho = Math.sqrt(rand());
      _sr.copy(_su).multiplyScalar(Math.cos(a)).addScaledVector(_sw, Math.sin(a));
      const up = rr(10, 34) * (flake ? 0.8 : 1), out = rr(2, 9) * (0.5 + rho);
      const piece = flake ? Math.max(0.04, s * rr(0.05, 0.11)) : Math.max(0.07, s * rr(0.08, 0.22)) * (rho > 0.7 && rand() < 0.3 ? 1.6 : 1);
      const off = rho * s * 0.45, lift = (1 - rho * rho) * s * 0.15;
      this.addShard(
        p.x + _sr.x * off + dir.x * lift, p.y + _sr.y * off + dir.y * lift, p.z + _sr.z * off + dir.z * lift,
        dir.x * up + _sr.x * out + rr(-1.5, 1.5), dir.y * up + _sr.y * out + rr(-1.5, 1.5), dir.z * up + _sr.z * out + rr(-1.5, 1.5),
        piece, flake ? PALE : _sc, flake ? rr(1.2, 2.2) : rr(0.5, 1.4), gy
      );
    }
    const nd = Math.round((5 + 7 * k) * this.budget) + 2;
    for (let i = 0; i < nd; i++) {
      tmpV.randomDirection();
      const v = rr(3, 12);
      this.addSmoke(SMOKE.PUFF, p.x + tmpV.x * 0.3 * s, p.y + tmpV.y * 0.3 * s, p.z + tmpV.z * 0.3 * s, dir.x * v + tmpV.x * 3, dir.y * v + tmpV.y * 3, dir.z * v + tmpV.z * 3, rr(1.5, 3.5), 0.2 + 0.4 * s, (1.2 + 2.4 * s) * rr(0.8, 1.3), 0.84, 0.8, 0.7, 0.5, { drag: 1.8, buoy: 0.3 });
    }
  }

  /** One cover shard into the pool (when it is full the piece nearest its end makes room). */
  addShard(x, y, z, vx, vy, vz, size, color, drag, gy) {
    const S = this.shards;
    let i = 0;
    if (S.n < S.max) i = S.n++;
    else for (let j = 1; j < S.n; j++) if (S.age[j] - S.life[j] > S.age[i] - S.life[i]) i = j;
    S.px[i] = x; S.py[i] = y; S.pz[i] = z;
    S.vx[i] = vx; S.vy[i] = vy; S.vz[i] = vz;
    _sq.random();
    S.qx[i] = _sq.x; S.qy[i] = _sq.y; S.qz[i] = _sq.z; S.qw[i] = _sq.w;
    tmpV.randomDirection().multiplyScalar(rr(5, 18));
    S.wx[i] = tmpV.x; S.wy[i] = tmpV.y; S.wz[i] = tmpV.z;
    S.sx[i] = size * rr(0.7, 1.3); S.sy[i] = size * rr(0.5, 1);
    S.age[i] = 0; S.life[i] = rr(18, 30);
    S.drag[i] = drag;
    // light pieces flutter as they fall: a sideways push that swings back and forth
    S.flut[i] = rr(2, 7); S.fph[i] = rand() * 6.283; S.ffq[i] = rr(3, 8);
    const h = rand() * 6.283;
    S.fdx[i] = Math.cos(h); S.fdz[i] = Math.sin(h);
    S.rest[i] = 0; S.gy[i] = gy;
    S.cr[i] = color.r; S.cg[i] = color.g; S.cb[i] = color.b;
  }

  /**
   * One spent case thrown from a gun's ejection port at p with velocity v (world), d its diameter and len
   * its length (m); `link` a belt link instead (a small dark clip). Cases lie where they fall until the
   * ring buffer comes round to them again.
   */
  brass(p, v, d = 0.03, len = 0.165, link = false) {
    const C = this.cases, i = C.next;
    C.next = (i + 1) % C.max;
    C.px[i] = p.x; C.py[i] = p.y; C.pz[i] = p.z;
    C.vx[i] = v.x; C.vy[i] = v.y; C.vz[i] = v.z;
    _sq.random();
    C.qx[i] = _sq.x; C.qy[i] = _sq.y; C.qz[i] = _sq.z; C.qw[i] = _sq.w;
    tmpV.randomDirection();
    C.ax[i] = tmpV.x; C.ay[i] = tmpV.y; C.az[i] = tmpV.z;
    C.ang[i] = 0; C.w[i] = rr(12, 35);
    C.sx[i] = link ? 0.045 : d; C.sy[i] = link ? 0.012 : len; C.sz[i] = link ? 0.032 : d;
    C.age[i] = 0; C.life[i] = rr(30, 45); C.rest[i] = 0; C.flat[i] = link ? 1 : 0;
    const c = link ? LINK_COL : CASE_COL, k = rr(0.85, 1.1);
    C.cr[i] = c.r * k; C.cg[i] = c.g * k; C.cb[i] = c.b * k;
    // the ground under where it starts: the pads are level, so it only looks again close to it
    C.gy0[i] = this.ground(p.x, p.z);
  }

  /**
   * A whole container lid blown off its launcher. obj: an Object3D at the lid's centre in world space,
   * holding the lid's meshes (shared geometry and materials, never disposed here); vel its velocity, spin
   * its tumble (rad/s). It flies, tumbles, lies where it lands and is gone after a minute or so (at most
   * MAX_LIDS at once: the oldest goes first).
   */
  throwLid(obj, vel, spin = 8) {
    if (this.lids.length >= MAX_LIDS) this.scene.remove(this.lids.shift().obj);
    this.scene.add(obj);
    this.lids.push({ obj, vel: vel.clone(), axis: new THREE.Vector3().randomDirection(), w: spin, age: 0, rest: false, life: rr(70, 100), gy: this.ground(obj.position.x, obj.position.z) });
  }

  /** Take every thrown lid and spent case away (a new battle: the vehicles the lids came from may be rebuilt). */
  clearLitter() {
    for (const l of this.lids) this.scene.remove(l.obj);
    this.lids.length = 0;
    this.cases.life.fill(0);
    this.craters.n = this.craters.next = 0;
    this.craters.mesh.count = 0;
  }

  /**
   * One frame of a rocket motor: a bright exhaust glow at the nozzle and a white smoke trail sampled
   * along the path since the last frame, spaced and sized by distance so a far trail stays continuous
   * for little. k is the missile size (1 for a Pantsir round). Call every frame per missile with the
   * motor on. The trail lasts 10 to 16 s and shears away with the wind. hang (s): a big round's trail
   * also leaves sparse broad puffs that fade in as the dense trail goes and hang as a hazy band for
   * about that long (the S-300P family's trails last minutes, refs/launch), drifting with the wind; they
   * are kept to about a third of the pool.
   */
  motorPlume(p, vel, k = 1, hang = 0) {
    const sp = vel.length();
    if (sp < 1e-3) return;
    unit.copy(vel).multiplyScalar(-1 / sp); // exhaust points backward
    const d = this._cam.distanceTo(p);
    const far = 1 + Math.min(7, d / 600);
    // never smaller than a few pixels, so a plume far away is still a bright point
    const g = Math.max(1, (d * 0.0035) / (1.2 * k));
    this.addGlow(FLAME, p.x, p.y, p.z, 0, 0, 0, 0.07, 0.8 * k * g, 1.3 * k * g, 18, 9, 3, 1);
    this.addGlow(SPARK, p.x, p.y, p.z, unit.x, unit.y, unit.z, 0.05, 0.4 * k, 0.55 * k, 40, 24, 9, 1, { len: 3.5 * k + sp * this.dt * 0.35, drag: 1e6 });
    this.light(p, 900 * k, 0.1, 0xffb070);
    const n = this._samples(vel, (2 * k + 0.8) * far);
    const dt = this.dt;
    const sf = Math.sqrt(far);
    for (let i = 0; i < n; i++) {
      const u = (i + rand()) / n;
      this.addSmoke(SMOKE.TRAIL, p.x - vel.x * dt * u + rr(-0.2, 0.2), p.y - vel.y * dt * u + rr(-0.2, 0.2), p.z - vel.z * dt * u + rr(-0.2, 0.2), vel.x * 0.01, vel.y * 0.01, vel.z * 0.01, rr(10, 16), (0.8 + 0.6 * k) * sf, (4.5 + 5 * k) * sf * rr(0.8, 1.2), 0.93, 0.93, 0.94, 0.4, { drag: 0.7, buoy: 0.05 });
    }
    if (hang > 0 && this.hangN < this.smoke.max * 0.35) {
      // one broad puff every several metres of the path (further apart far off, where they are drawn
      // larger, and on the lower quality presets)
      let m = (sp * dt * Math.max(0.5, this.budget)) / ((8 + 6 * k) * far);
      while (m > 0 && (m >= 1 || rand() < m)) {
        m -= 1;
        const u = rand();
        if (this.addSmoke(SMOKE.HANG, p.x - vel.x * dt * u + rr(-1, 1) * k, p.y - vel.y * dt * u + rr(-1, 1) * k, p.z - vel.z * dt * u + rr(-1, 1) * k, vel.x * 0.004, vel.y * 0.004, vel.z * 0.004, hang * rr(0.75, 1.1), (4 + 2 * k) * sf, (16 + 12 * k) * sf * rr(0.8, 1.25), 0.92, 0.92, 0.93, 0.36, { drag: 0.6, buoy: 0.04 }) !== undefined) this.hangN++;
      }
    }
  }

  /** A fire left burning on the ground (an impact): flames and a black column for `life` seconds. At most eight at once. */
  burnSite(p, size = 1, life = 30) {
    if (this.sites.length >= 8) this.sites.shift();
    this.sites.push({ p: new THREE.Vector3(p.x, this.ground(p.x, p.z) + 0.5, p.z), k: Math.min(1.5, size * 0.7), t: 0, life, acc: 0 });
  }

  /** A shell or missile striking the ground: a dirt column, a ball of smoke, clods and sparks. */
  dust(p, size = 1) {
    const s = size, b = this.budget;
    const gy = this.ground(p.x, p.z);
    this.addGlow(FLASH, p.x, gy + 1, p.z, 0, 0, 0, 0.15, 3 * s, 8 * s, 50, 32, 14, 1);
    this.addGlow(FLAME, p.x, gy + 1, p.z, 0, 2 * s, 0, 0.5, 2 * s, 5 * s, 14, 5, 1.2, 1, { drag: 1.5 });
    this.light(tmpV.set(p.x, gy + 3, p.z), 1500 * s * s, 0.35, 0xff9a50);
    const nd = Math.round(14 * s * b) + 5;
    for (let i = 0; i < nd; i++) {
      const a = rand() * 6.283, v = rr(2, 9) * s;
      this.addSmoke(SMOKE.PUFF, p.x + Math.cos(a), gy + rr(0.3, 2), p.z + Math.sin(a), Math.cos(a) * v, rr(4, 14) * s, Math.sin(a) * v, rr(5, 9), 1.5 * s, rr(6, 13) * s, 0.36, 0.28, 0.2, 0.8, { drag: 0.8, buoy: -1.5 });
    }
    const ns = Math.round(7 * s * b) + 2;
    for (let i = 0; i < ns; i++) {
      tmpV.randomDirection();
      this.addSmoke(SMOKE.BLACK, p.x + tmpV.x * s, gy + 1 + Math.abs(tmpV.y) * s, p.z + tmpV.z * s, tmpV.x * 3 * s, 3 + Math.abs(tmpV.y) * 6 * s, tmpV.z * 3 * s, rr(6, 12), 2.5 * s, rr(8, 14) * s, 0.06, 0.055, 0.05, 0.8, { glow: 0.2, drag: 0.9, buoy: 0.5 });
    }
    this.sparks(tmpV.set(p.x, gy + 1, p.z), Math.round(10 * s) + 4, 24 * s + 10);
    this.debrisBurst(tmpV.set(p.x, gy + 1, p.z), Math.round(8 * s) + 3, 10 + 12 * s, 0.25 + s * 0.25);
  }

  /** A warhead burst at altitude: a hard white flash, a ragged grey cloud that hangs and drifts, fragment streaks. */
  airburst(p, size = 1) {
    const d = this._cam.distanceTo(p);
    if (d > 20000) return;
    const s = size;
    this.addGlow(FLASH, p.x, p.y, p.z, 0, 0, 0, 0.12, 5 * s, 11 * s, 55, 42, 26, 1);
    this.addGlow(FLAME, p.x, p.y, p.z, 0, 0, 0, 0.3, 2.5 * s, 6 * s, 14, 7, 2.5, 1);
    if (d < 1500) this.light(p, 2200 * s * s, 0.15, 0xffe0b0);
    const far = d > 8000 ? 0.4 : d > 3000 ? 0.7 : 1;
    const n = Math.max(2, Math.round(7 * this.budget * far));
    for (let i = 0; i < n; i++) {
      tmpV.randomDirection();
      this.addSmoke(SMOKE.FLAK, p.x + tmpV.x * 2 * s, p.y + tmpV.y * 2 * s, p.z + tmpV.z * 2 * s, tmpV.x * 7 * s, tmpV.y * 7 * s, tmpV.z * 7 * s, rr(7, 13), 3 * s, rr(11, 18) * s, 0.22, 0.21, 0.2, 0.8, { drag: 1.6 });
    }
    if (d < 4000) {
      for (let i = 0; i < 12; i++) {
        const v = tmpV.randomDirection().multiplyScalar(rr(60, 140));
        this.addGlow(SPARK, p.x, p.y, p.z, v.x, v.y, v.z, rr(0.2, 0.5), 0.3 * s, 0.1 * s, 30, 18, 7, 1, { len: 0.05, drag: 1.2 });
      }
    }
  }

  /** One frame of a burning aircraft falling: black smoke sampled along its path and licking flame. */
  wreck(p, vel) {
    const n = this._samples(vel, 6);
    const dt = this.dt;
    for (let i = 0; i < n; i++) {
      const u = (i + rand()) / n;
      this.addSmoke(SMOKE.BLACK, p.x - vel.x * dt * u + rr(-0.5, 0.5), p.y - vel.y * dt * u + rr(-0.5, 0.5), p.z - vel.z * dt * u + rr(-0.5, 0.5), vel.x * 0.05, vel.y * 0.05, vel.z * 0.05, rr(7, 12), 2, rr(10, 16), 0.03, 0.028, 0.026, 0.8, { glow: 0.3, drag: 0.7, buoy: 0.3 });
    }
    this.addGlow(FLAME, p.x, p.y, p.z, vel.x * 0.2, vel.y * 0.2, vel.z * 0.2, rr(0.2, 0.45), 2, 4.5, 14, 5, 1.2, 1, { drag: 2 });
    if (rand() < 0.15) this.addGlow(SPARK, p.x, p.y, p.z, vel.x * 0.1 + rr(-8, 8), vel.y * 0.1 + rr(-4, 8), vel.z * 0.1 + rr(-8, 8), rr(0.3, 0.8), 0.15, 0.08, 30, 14, 4, 1, { len: 0.05, drag: 0.8, buoy: -9.8 });
  }

  // ---------------------------------------------------------------- the WW2 era: flak and air attack

  /**
   * An 8.8 cm shell bursting (maxgfx's 5in burst): a flash and a short fireball, a jet-black ball that is
   * most of its size at once (the explosion throws it out), ragged lobes and fragment streaks round it,
   * then the ball spreads and drifts with the wind for a quarter of a minute and leaves a faint grey haze
   * that hangs for most of a minute, so a barrage smudges its patch of sky. The bursts are seen from 8 to
   * 20 km (the bombers' height and range): thinned with distance and drawn a little larger far off, so
   * each stays a few pixels across.
   */
  flak(p) {
    const d = this._cam.distanceTo(p);
    if (d > 26000) return;
    const far = d > 9000 ? 0.5 : d > 3500 ? 0.7 : 1;
    // drawn larger with the distance (as render/entities.js draws far aircraft), so a burst 10 km off is
    // still a black dot a few pixels across beside the bombers
    const g = Math.min(6, Math.max(1, d / 2500));
    this.addGlow(FLASH, p.x, p.y, p.z, 0, 0, 0, 0.14, 9 * g, 17 * g, 46, 30, 14, 1);
    this.addGlow(FLAME, p.x, p.y, p.z, 0, 0, 0, 0.45, 5 * g, 10 * g, 14, 5.5, 1.6, 1);
    if (d < 900) this.light(p, 2500, 0.18, 0xffb070);
    const k = Math.max(0.5, this.budget) * far;
    // the core: dense and black
    for (let i = 0, n = Math.max(2, Math.round(4 * k)); i < n; i++) {
      tmpV.randomDirection().multiplyScalar(rr(0.5, 2.5) * g);
      this.addSmoke(SMOKE.BURST, p.x + tmpV.x, p.y + tmpV.y, p.z + tmpV.z, tmpV.x * 2, tmpV.y * 2, tmpV.z * 2, rr(14, 20), rr(9, 12) * g, rr(24, 32) * g, 0.02, 0.019, 0.018, 1, { drag: 1.2 });
    }
    // ragged lobes thrown out and stopped by the air
    for (let i = 0, n = Math.max(1, Math.round(5 * k)); i < n; i++) {
      tmpV.randomDirection();
      const v = rr(10, 18);
      this.addSmoke(SMOKE.BURST, p.x + tmpV.x * 3 * g, p.y + tmpV.y * 3 * g, p.z + tmpV.z * 3 * g, tmpV.x * v, tmpV.y * v, tmpV.z * v, rr(10, 15), rr(4, 6) * g, rr(15, 21) * g, 0.042, 0.04, 0.038, 0.85, { drag: 2.4 });
    }
    // fragments: dark streaks of smoke and a spray of hot sparks
    if (d < 2500) {
      for (let i = 0, n = Math.round(4 * k); i < n; i++) {
        const v = tmpV.randomDirection().multiplyScalar(rr(30, 45));
        this.addSmoke(SMOKE.PUFF, p.x, p.y, p.z, v.x, v.y, v.z, rr(1.2, 2), 1.2, 3.5, 0.05, 0.05, 0.05, 0.55, { drag: 1.8 });
      }
    }
    if (d < 8000) {
      for (let i = 0; i < 10; i++) {
        const v = tmpV.randomDirection().multiplyScalar(rr(50, 110));
        this.addGlow(SPARK, p.x, p.y, p.z, v.x, v.y, v.z, rr(0.2, 0.45), 0.3, 0.12, 30, 16, 6, 1, { len: 0.05, drag: 1.5 });
      }
    }
    // the haze it leaves: broad, faint and grey, fading in as the ball thins (long-lived: kept to a
    // share of the pool, as the missiles' hanging trails are)
    if (this.hangN < this.smoke.max * 0.35) {
      for (let i = 0, n = rand() < 0.5 * this.budget ? 2 : 1; i < n; i++) {
        tmpV.randomDirection().multiplyScalar(rr(4, 10) * g);
        if (this.addSmoke(SMOKE.HANG, p.x + tmpV.x, p.y + tmpV.y, p.z + tmpV.z, tmpV.x * 0.3, tmpV.y * 0.2, tmpV.z * 0.3, rr(35, 55), 14 * g, rr(55, 75) * g, 0.2, 0.195, 0.19, 0.16, { drag: 0.6 }) !== undefined) this.hangN++;
      }
    }
  }

  /**
   * A heavy gun firing (the 8.8 cm, no muzzle brake): a ball of flame thrown out along the bore and the
   * cone of fire behind it, a cloud of brown-grey cordite smoke rolling out ahead and rising, and the
   * blast's dust raised off the pit's floor and its earth walls round the gun at `base` (more with the
   * barrel low). p: the muzzle, dir: the bore; size 1 for an 8.8 cm.
   */
  cannon(p, dir, base, size = 1) {
    const s = size, b = this.budget;
    this.addGlow(FLASH, p.x + dir.x * 2 * s, p.y + dir.y * 2 * s, p.z + dir.z * 2 * s, 0, 0, 0, 0.07, 2.4 * s, 5 * s, 44, 24, 7, 1);
    this.addGlow(SPARK, p.x, p.y, p.z, dir.x, dir.y, dir.z, 0.06, 1 * s, 1.4 * s, 40, 20, 6, 1, { len: 4.5 * s, drag: 1e6 });
    for (let i = 0; i < 3; i++) {
      const v = rr(18, 36) * s;
      this.addGlow(FLAME, p.x + dir.x * s, p.y + dir.y * s, p.z + dir.z * s, dir.x * v + rr(-3, 3), dir.y * v + rr(-3, 3), dir.z * v + rr(-3, 3), rr(0.08, 0.15), 1.2 * s, 2.8 * s, 14, 6, 1.5, 1, { drag: 6 });
    }
    this.light(p, 5000 * s * s, 0.14, 0xffb070);
    const ns = Math.round(10 * s * b) + 4;
    for (let i = 0; i < ns; i++) {
      const f = rr(2, 10) * s, v = rr(8, 28) * s;
      tmpV.randomDirection();
      this.addSmoke(SMOKE.CORDITE, p.x + dir.x * f, p.y + dir.y * f, p.z + dir.z * f, dir.x * v + tmpV.x * 3, dir.y * v + tmpV.y * 3 + 1, dir.z * v + tmpV.z * 3, rr(5, 9), 1.5 * s, rr(6, 10) * s, 0.56, 0.52, 0.46, 0.5, { drag: 1.4, buoy: 0.6 });
    }
    // the blast's dust off the pit: a ring round the gun, thicker with the barrel low
    const gy = this.ground(base.x, base.z);
    const low = 1 - 0.6 * Math.min(1, Math.max(0, dir.y));
    const nd = Math.round(16 * s * b * low) + 4;
    for (let i = 0; i < nd; i++) {
      const a = rand() * 6.283, r0 = rr(1.5, 5), v = rr(3, 10) * s * low;
      this.addSmoke(SMOKE.PUFF, base.x + Math.cos(a) * r0, gy + rr(0.3, 1.6), base.z + Math.sin(a) * r0, Math.cos(a) * v + dir.x * 4, rr(0.5, 2.5), Math.sin(a) * v + dir.z * 4, rr(4, 8), 1.5 * s, rr(5, 9) * s, 0.5, 0.43, 0.33, 0.45, { drag: 0.8, buoy: 0.2 });
    }
  }

  /**
   * A bomb bursting on the ground (or a rocket's head): the flash and a short fireball, the column of earth
   * thrown straight up (tens of metres for a 500 lb bomb) falling back as a brown curtain, the black smoke
   * rising out of the crater, clods flung out, and the blast's dust ring rolling out over the ground.
   * size: 1 for a 500 lb bomb (about 0.6 for 100 lb, 1.4 for 1,000 lb, 0.5 for an RP-3's 60 lb head).
   */
  bomb(p, size = 1) {
    const s = size, b = this.budget;
    const gy = this.ground(p.x, p.z);
    this.addGlow(FLASH, p.x, gy + 2 * s, p.z, 0, 0, 0, 0.16, 6 * s, 16 * s, 60, 40, 20, 1);
    for (let i = 0, n = Math.round(6 * s * b) + 3; i < n; i++) {
      this.addGlow(FLAME, p.x + rr(-2, 2) * s, gy + rr(0.5, 3) * s, p.z + rr(-2, 2) * s, rr(-4, 4) * s, rr(6, 18) * s, rr(-4, 4) * s, rr(0.4, 0.8), 3 * s, 8 * s, 16, 6.5, 1.6, 1, { drag: 2, buoy: 1 });
    }
    this.light(tmpV.set(p.x, gy + 4, p.z), 6000 * s * s, 0.5, 0xff9a50);
    // the earth column: thrown up, slowed by gravity (buoy < 0), falling back
    // (a heavy raid drops a hundred bombs or more: kept lean, and the pool's spare room decides the rest)
    const q = this.cheap() ? 1 : 0.5;
    for (let i = 0, n = Math.round(18 * s * b * q) + 6; i < n; i++) {
      const up = rr(10, 30) * s * (0.6 + 0.4 * rand());
      this.addSmoke(SMOKE.BURST, p.x + rr(-1.5, 1.5) * s, gy + rr(0.5, 3), p.z + rr(-1.5, 1.5) * s, rr(-3, 3) * s, up, rr(-3, 3) * s, rr(4, 8), 2 * s, rr(6, 12) * s, 0.17, 0.135, 0.095, 0.9, { drag: 0.6, buoy: -6 });
    }
    for (let i = 0, n = Math.round(10 * s * b * q) + 4; i < n; i++) {
      this.addSmoke(SMOKE.BLACK, p.x + rr(-2, 2) * s, gy + rr(1, 4) * s, p.z + rr(-2, 2) * s, rr(-1, 1), rr(3, 8) * s, rr(-1, 1), rr(12, 20), 3 * s, rr(14, 24) * s, 0.05, 0.045, 0.04, 0.85, { glow: 0.25, drag: 0.8, buoy: 0.6 });
    }
    for (let i = 0, n = Math.round(10 * s * b * q) + 4; i < n; i++) {
      const a = rand() * 6.283, v = rr(6, 18) * s;
      this.addSmoke(SMOKE.PUFF, p.x + Math.cos(a) * 2 * s, gy + rr(0.3, 1.5), p.z + Math.sin(a) * 2 * s, Math.cos(a) * v, rr(0.5, 3), Math.sin(a) * v, rr(4, 7), 2 * s, rr(7, 12) * s, 0.36, 0.3, 0.22, 0.45, { drag: 0.7, buoy: 0.15 });
    }
    this.sparks(tmpV.set(p.x, gy + 1, p.z), Math.round(10 * s) + 4, 26 * s + 10);
    this.debrisBurst(tmpV.set(p.x, gy + 1, p.z), Math.round(10 * s) + 4, 14 + 16 * s, 0.25 + 0.3 * s);
  }

  /**
   * A crater decal on the ground at p, r metres to the edge of its spray (the dark bottom is about a third
   * of that across): laid on the terrain's slope, at most MAX_CRATERS, the oldest going first.
   */
  crater(p, r = 8) {
    const C = this.craters;
    const e = Math.max(1, r * 0.5), x = p.x, z = p.z;
    _cn.set(this.ground(x - e, z) - this.ground(x + e, z), 2 * e, this.ground(x, z - e) - this.ground(x, z + e)).normalize();
    _cq.setFromUnitVectors(_cu, _cn).multiply(_cq2.setFromAxisAngle(_cu, rand() * 6.283));
    _cm.compose(tmpV.set(x, this.ground(x, z) + 0.06, z), _cq, _cs.set(2 * r, 1, 2 * r));
    C.mesh.setMatrixAt(C.next, _cm);
    C.next = (C.next + 1) % MAX_CRATERS;
    C.n = Math.min(C.n + 1, MAX_CRATERS);
    C.mesh.count = C.n;
    C.mesh.instanceMatrix.needsUpdate = true;
  }

  /**
   * A strafing burst striking the ground round p: dust spurts walked along the aircraft's path (its
   * velocity `vel`; the guns' beaten zone, a few metres across and a couple of dozen long), a few sparks,
   * and its tracers coming down into it from the aircraft at `from`.
   */
  strafe(p, from, vel) {
    const h = Math.hypot(vel.x, vel.z) || 1, fx = vel.x / h, fz = vel.z / h;
    for (let i = 0, n = 6 + Math.round(6 * this.budget); i < n; i++) {
      const al = rr(-12, 12), sd = rr(-3, 3);
      const x = p.x + fx * al - fz * sd, z = p.z + fz * al + fx * sd, gy = this.ground(x, z);
      this.addSmoke(SMOKE.BURST, x, gy + 0.3, z, rr(-1, 1) + fx * 2, rr(3, 8), rr(-1, 1) + fz * 2, rr(1.5, 3), 0.4, rr(1.6, 2.8), 0.3, 0.25, 0.18, 0.75, { drag: 2, buoy: -3 });
      if (rand() < 0.3) this.addGlow(FLASH, x, gy + 0.3, z, 0, 0, 0, 0.05, 0.3, 0.7, 30, 20, 8, 1);
    }
    this.sparks(tmpV.set(p.x, this.ground(p.x, p.z) + 0.5, p.z), 4, 12);
    // the tracers (one round in five): streaks flying down from the aircraft into the burst
    for (let i = 0; i < 3; i++) {
      const tx = p.x + fx * rr(-12, 12), tz = p.z + fz * rr(-12, 12);
      tmpV.set(tx - from.x, this.ground(tx, tz) - from.y, tz - from.z);
      const dist = tmpV.length();
      if (dist < 1) continue;
      tmpV.multiplyScalar(870 / dist);
      this.addGlow(SPARK, from.x, from.y, from.z, tmpV.x, tmpV.y, tmpV.z, dist / 870, 0.12, 0.1, 30, 9, 3, 1, { len: 0.018, drag: 0 });
    }
  }

  /** A light flak round self-destructing (3.7 cm) at the end of its tracer: a sharp little flash and a tight dark puff that lingers. */
  puff(p, size = 1) {
    const d = this._cam.distanceTo(p);
    if (d > 7000) return;
    const s = size;
    this.addGlow(FLASH, p.x, p.y, p.z, 0, 0, 0, 0.07, 2.2 * s, 4 * s, 40, 26, 11, 1);
    this.addGlow(FLAME, p.x, p.y, p.z, 0, 0, 0, 0.18, 1 * s, 2.2 * s, 12, 5, 1.4, 1);
    for (let i = 0, n = d < 2500 ? 2 : 1; i < n; i++) {
      this.addSmoke(SMOKE.PUFF, p.x + rr(-0.6, 0.6), p.y + rr(-0.6, 0.6), p.z + rr(-0.6, 0.6), rr(-1, 1), rr(-1, 1), rr(-1, 1), rr(7, 10), rr(2, 2.6) * s, rr(5.5, 7) * s, 0.06, 0.058, 0.056, 0.9, { drag: 1.2 });
    }
  }

  /** A shell striking the ground (a light flak round, size about 0.4): a spurt of dust and a few sparks. */
  spurt(p, size = 0.5) {
    if (this._cam.distanceTo(p) > 4000) return;
    const gy = this.ground(p.x, p.z);
    for (let i = 0; i < 2; i++) {
      this.addSmoke(SMOKE.PUFF, p.x + rr(-0.5, 0.5), gy + 0.3, p.z + rr(-0.5, 0.5), rr(-1, 1), rr(2, 6) * size + 1, rr(-1, 1), rr(1.5, 3), 0.4 * size + 0.2, rr(1.5, 2.8) * size + 0.8, 0.46, 0.39, 0.29, 0.7, { drag: 2, buoy: -3 });
    }
    this.addGlow(FLASH, p.x, gy + 0.3, p.z, 0, 0, 0, 0.05, 0.4 * size, 1.2 * size, 30, 20, 8, 1);
    if (rand() < 0.5) this.sparks(tmpV.set(p.x, gy + 0.3, p.z), 3, 10);
  }

  /** Rockets leaving an aircraft's rails: a flash and a puff of grey-white smoke at p along dir. */
  rocketOff(p, dir) {
    this.addGlow(FLASH, p.x, p.y, p.z, 0, 0, 0, 0.08, 1.5, 3.5, 50, 32, 14, 1);
    for (let i = 0; i < 4; i++) {
      tmpV.randomDirection();
      this.addSmoke(SMOKE.PUFF, p.x + tmpV.x, p.y + tmpV.y, p.z + tmpV.z, dir.x * 20 + tmpV.x * 3, dir.y * 20 + tmpV.y * 3, dir.z * 20 + tmpV.z * 3, rr(3, 5), 1, rr(4, 6), 0.8, 0.8, 0.78, 0.6, { drag: 1.6, buoy: 0.2 });
    }
  }

  // ---------------------------------------------------------------- update
  update(dt, camera, { sunDir, sunColor, sunIntensity = 6.5, ambient, night = 0 }) {
    this.dt = dt > 0 ? dt : this.dt;
    const cam = this._cam.copy(camera.position);
    // by night the exposure is wide open: flashes and fires would bloom across half the sky
    this.glowMat.uniforms.uGlowScale.value = 1 - 0.65 * night;
    const wind = this.wind;
    const wx = wind.x, wz = wind.z;

    // smoke
    const P = this.smoke;
    let hang = 0;
    for (let i = P.n - 1; i >= 0; i--) {
      P.age[i] += dt;
      if (P.age[i] >= P.life[i]) {
        P.kill(i);
        continue;
      }
      if (P.kind[i] === SMOKE.HANG) hang++;
      const dk = Math.exp(-P.drag[i] * dt);
      // drag pulls velocity toward the wind, which blows harder higher up (trails shear over)
      const wk = 1 + Math.min(2.2, P.py[i] * 0.003);
      P.vx[i] = wx * wk + (P.vx[i] - wx * wk) * dk;
      P.vz[i] = wz * wk + (P.vz[i] - wz * wk) * dk;
      P.vy[i] = P.vy[i] * (P.buoy[i] < 0 ? 1 : dk) + P.buoy[i] * dt;
      P.px[i] += P.vx[i] * dt;
      P.py[i] += P.vy[i] * dt;
      P.pz[i] += P.vz[i] * dt;
      P.rot[i] += P.rotV[i] * dt;
      if (P.kind[i] === SMOKE.SPRAY && P.py[i] < this.ground(P.px[i], P.pz[i]) - 1 && P.vy[i] < 0) P.age[i] = P.life[i];
    }
    this.hangN = hang;
    // back-to-front order
    const n = P.n;
    const order = this._order;
    const fx = camera.matrixWorldInverse.elements;
    for (let i = 0; i < n; i++) {
      const z = fx[2] * P.px[i] + fx[6] * P.py[i] + fx[10] * P.pz[i] + fx[14];
      order[i] = Math.floor((z + 100000) * 8) * 16384 + i;
    }
    const sorted = order.subarray(0, n).sort();
    const A = this.smokeAttrs.iA.array, B = this.smokeAttrs.iB.array, C = this.smokeAttrs.iC.array;
    for (let k = 0; k < n; k++) {
      const i = sorted[k] % 16384;
      const t = P.age[i] / P.life[i];
      const grow = 1 - Math.pow(1 - t, 2.2);
      const o = k * 4;
      A[o] = P.px[i];
      A[o + 1] = P.py[i];
      A[o + 2] = P.pz[i];
      A[o + 3] = P.s0[i] + (P.s1[i] - P.s0[i]) * grow;
      // a hanging trail holds its density longer and thins out late
      const kd = P.kind[i];
      const fade = kd === SMOKE.HANG ? Math.min(1, t * 8) * (1 - t * t * t) : kd === SMOKE.BURST ? Math.min(1, t * 120) * (1 - t * t) : Math.min(1, t * 12) * (1 - t * t);
      B[o] = P.r[i];
      B[o + 1] = P.g[i];
      B[o + 2] = P.b[i];
      B[o + 3] = P.a[i] * fade;
      C[o] = P.rot[i];
      C[o + 1] = P.glow[i] * Math.max(0, 1 - t * 3);
      C[o + 2] = P.tile[i];
    }
    for (const a of Object.values(this.smokeAttrs)) {
      a.clearUpdateRanges();
      a.addUpdateRange(0, n * 4);
      a.needsUpdate = true;
    }
    this.smokeMesh.geometry.instanceCount = n;

    const su = this.smokeMat.uniforms;
    su.uLightView.value.copy(sunDir).transformDirection(camera.matrixWorldInverse);
    su.uSun.value.copy(sunColor).multiplyScalar(sunIntensity / Math.PI);
    su.uAmbient.value.copy(ambient);

    // glow
    const Q = this.glow;
    for (let i = Q.n - 1; i >= 0; i--) {
      Q.age[i] += dt;
      if (Q.age[i] >= Q.life[i]) {
        Q.kill(i);
        continue;
      }
      if (Q.drag[i] < 1e5) {
        const dk = Math.exp(-Q.drag[i] * dt);
        Q.vx[i] *= dk;
        Q.vz[i] *= dk;
        Q.vy[i] = Q.vy[i] * dk + Q.buoy[i] * dt;
        Q.px[i] += Q.vx[i] * dt;
        Q.py[i] += Q.vy[i] * dt;
        Q.pz[i] += Q.vz[i] * dt;
      }
    }
    const GA = this.glowAttrs.iA.array, GB = this.glowAttrs.iB.array, GD = this.glowAttrs.iD.array;
    for (let i = 0; i < Q.n; i++) {
      const t = Q.age[i] / Q.life[i];
      const o = i * 4;
      const kind = Q.kind[i];
      GA[o] = Q.px[i];
      GA[o + 1] = Q.py[i];
      GA[o + 2] = Q.pz[i];
      GA[o + 3] = Q.s0[i] + (Q.s1[i] - Q.s0[i]) * Math.sqrt(t);
      let r = Q.r[i], g = Q.g[i], b = Q.b[i], a = Q.a[i];
      if (kind === FLAME) {
        // white-hot to orange to a dull red ember
        const cool = Math.min(1, t * 1.4);
        r *= 1 - cool * 0.55;
        g *= 1 - cool * 0.8;
        b *= 1 - cool * 0.95;
        a *= Math.min(1, t * 10) * (1 - t);
      } else if (kind === FLASH) {
        a *= 1 - t;
      } else {
        a *= 1 - t * t;
      }
      GB[o] = r;
      GB[o + 1] = g;
      GB[o + 2] = b;
      GB[o + 3] = a;
      const len = Q.len[i];
      if (len > 0) {
        const vx = Q.vx[i], vy = Q.vy[i], vz = Q.vz[i];
        if (Q.drag[i] >= 1e5) {
          // static cone: (vx, vy, vz) is a unit direction, len its length
          GD[o] = -vx * len;
          GD[o + 1] = -vy * len;
          GD[o + 2] = -vz * len;
        } else {
          GD[o] = vx * len;
          GD[o + 1] = vy * len;
          GD[o + 2] = vz * len;
        }
      } else {
        GD[o] = GD[o + 1] = GD[o + 2] = 0;
      }
      GD[o + 3] = kind;
    }
    for (const a of Object.values(this.glowAttrs)) {
      a.clearUpdateRanges();
      a.addUpdateRange(0, Q.n * 4);
      a.needsUpdate = true;
    }
    this.glowMesh.geometry.instanceCount = Q.n;

    // debris
    const m = this._m, q = this._q, sc = this._s;
    let k = 0;
    for (let i = this.debris.length - 1; i >= 0; i--) {
      const d = this.debris[i];
      d.life -= dt;
      d.v.y -= 9.8 * dt;
      d.p.addScaledVector(d.v, dt);
      q.setFromAxisAngle(tmpV.copy(d.w).normalize(), d.w.length() * dt);
      d.q.multiply(q);
      if (d.smoke && rand() < dt * 20) this.trail(d.p, d.v, 0.2);
      const gy = this.ground(d.p.x, d.p.z);
      if (d.p.y < gy || d.life <= 0) {
        if (d.p.y < gy && d.s > 0.5 && this.cheap()) this.addSmoke(SMOKE.PUFF, d.p.x, gy + 0.3, d.p.z, rr(-1, 1), rr(1, 2.5), rr(-1, 1), rr(1.5, 3), 0.6, 2.4, 0.3, 0.24, 0.17, 0.5, { drag: 1.5 });
        this.debris.splice(i, 1);
      }
    }
    for (const d of this.debris) {
      sc.setScalar(d.s);
      m.compose(d.p, d.q, sc);
      this.debrisMesh.setMatrixAt(k++, m);
    }
    this.debrisMesh.count = k;
    this.debrisMesh.instanceMatrix.needsUpdate = true;

    // cover shards: drag toward the wind, gravity, a flutter while falling, tumbling, then lying flat
    const S = this.shards;
    for (let i = S.n - 1; i >= 0; i--) {
      S.age[i] += dt;
      if (S.age[i] >= S.life[i]) {
        const j = --S.n;
        if (i !== j) for (const f of SHARD) S[f][i] = S[f][j];
        continue;
      }
      if (S.rest[i] || dt === 0) continue;
      const dk = Math.exp(-S.drag[i] * dt);
      S.vx[i] = wx + (S.vx[i] - wx) * dk;
      S.vz[i] = wz + (S.vz[i] - wz) * dk;
      S.vy[i] = (S.vy[i] - 9.8 * dt) * dk;
      if (S.vy[i] < 0) {
        const f = S.flut[i] * Math.sin(S.fph[i] + S.age[i] * S.ffq[i]) * dt;
        S.vx[i] += S.fdx[i] * f;
        S.vz[i] += S.fdz[i] * f;
      }
      S.px[i] += S.vx[i] * dt;
      S.py[i] += S.vy[i] * dt;
      S.pz[i] += S.vz[i] * dt;
      _sr.set(S.wx[i], S.wy[i], S.wz[i]);
      const w = _sr.length();
      _sq.set(S.qx[i], S.qy[i], S.qz[i], S.qw[i]).multiply(_sq2.setFromAxisAngle(_sr.multiplyScalar(1 / w), w * dt));
      if (S.py[i] < S.gy[i] + 3 && S.vy[i] < 0) {
        const g = this.ground(S.px[i], S.pz[i]);
        if (S.py[i] <= g + 0.03) {
          // down: it lies flat, paint or composite up
          S.py[i] = g + 0.03;
          S.rest[i] = 1;
          _sq.setFromEuler(_se.set((rand() < 0.5 ? -1 : 1) * Math.PI * 0.5 + rr(-0.12, 0.12), rand() * 6.283, 0, 'YXZ'));
        }
      }
      S.qx[i] = _sq.x; S.qy[i] = _sq.y; S.qz[i] = _sq.z; S.qw[i] = _sq.w;
    }
    const SM = this.shardMesh, SC = SM.instanceColor;
    for (let i = 0; i < S.n; i++) {
      // shrink away at the end; drawn larger far off (a few pixels across, up to 3x) so a burst still
      // reads as a spray of pieces and not a few lost pixels, as the flyers are
      const far = Math.min(3, Math.max(1, (Math.hypot(S.px[i] - cam.x, S.py[i] - cam.y, S.pz[i] - cam.z) * 0.005) / Math.max(S.sx[i], S.sy[i])));
      const fade = Math.min(1, (S.life[i] - S.age[i]) / 1.5) * far;
      sc.set(S.sx[i] * fade, S.sy[i] * fade, (S.sx[i] + S.sy[i]) * 0.5 * fade);
      m.compose(tmpV.set(S.px[i], S.py[i], S.pz[i]), q.set(S.qx[i], S.qy[i], S.qz[i], S.qw[i]), sc);
      SM.setMatrixAt(i, m);
      SC.setXYZ(i, S.cr[i], S.cg[i], S.cb[i]);
    }
    SM.count = S.n;
    if (S.n) {
      SM.instanceMatrix.needsUpdate = true;
      SC.needsUpdate = true;
    }

    // spent cases and links: gravity, a little drag, tumbling, a bounce off the ground, then lying still
    const Cs = this.cases, CM = this.caseMesh, CC = CM.instanceColor;
    let nc = 0;
    for (let i = 0; i < Cs.max; i++) {
      if (Cs.age[i] >= Cs.life[i]) continue;
      Cs.age[i] += dt;
      if (!Cs.rest[i] && dt > 0) {
        const dk = Math.exp(-0.2 * dt);
        Cs.vx[i] *= dk;
        Cs.vz[i] *= dk;
        Cs.vy[i] = (Cs.vy[i] - 9.8 * dt) * dk;
        Cs.px[i] += Cs.vx[i] * dt;
        Cs.py[i] += Cs.vy[i] * dt;
        Cs.pz[i] += Cs.vz[i] * dt;
        Cs.ang[i] += Cs.w[i] * dt;
        if (Cs.py[i] < Cs.gy0[i] + 1 && Cs.vy[i] < 0) {
          const g = this.ground(Cs.px[i], Cs.pz[i]);
          if (Cs.py[i] <= g + 0.015) {
            Cs.py[i] = g + 0.015;
            if (Cs.vy[i] < -3) {
              // a bounce, livelier for a case than for a link
              Cs.vy[i] *= Cs.flat[i] ? -0.15 : -0.32;
              Cs.vx[i] *= 0.45;
              Cs.vz[i] *= 0.45;
              Cs.w[i] *= 0.5;
            } else {
              // down: a case on its side, a link flat
              Cs.rest[i] = 1;
              Cs.ang[i] = 0;
              _sq.setFromEuler(_se.set(Cs.flat[i] ? 0 : Math.PI / 2, rand() * 6.283, 0, 'YXZ'));
              Cs.qx[i] = _sq.x; Cs.qy[i] = _sq.y; Cs.qz[i] = _sq.z; Cs.qw[i] = _sq.w;
            }
          }
        }
      }
      _sq.set(Cs.qx[i], Cs.qy[i], Cs.qz[i], Cs.qw[i]);
      if (Cs.ang[i]) _sq.multiply(_sq2.setFromAxisAngle(_sr.set(Cs.ax[i], Cs.ay[i], Cs.az[i]), Cs.ang[i]));
      // shrink away at the end; drawn larger far off (up to 3x), so a stream of cases reads at a distance
      const far = Math.min(3, Math.max(1, (Math.hypot(Cs.px[i] - cam.x, Cs.py[i] - cam.y, Cs.pz[i] - cam.z) * 0.002) / Cs.sy[i]));
      const f = Math.min(1, (Cs.life[i] - Cs.age[i]) / 1.5) * far;
      sc.set(Cs.sx[i] * f, Cs.sy[i] * f, Cs.sz[i] * f);
      m.compose(tmpV.set(Cs.px[i], Cs.py[i], Cs.pz[i]), _sq, sc);
      CM.setMatrixAt(nc, m);
      CC.setXYZ(nc, Cs.cr[i], Cs.cg[i], Cs.cb[i]);
      nc++;
    }
    Cs.live = nc;
    CM.count = nc;
    if (nc) {
      CM.instanceMatrix.needsUpdate = true;
      CC.needsUpdate = true;
    }

    // thrown lids: gravity, drag toward the wind, tumbling, then lying flat where they land
    for (let i = this.lids.length - 1; i >= 0; i--) {
      const L = this.lids[i], o = L.obj;
      L.age += dt;
      if (L.age >= L.life) {
        this.scene.remove(o);
        this.lids.splice(i, 1);
        continue;
      }
      if (!L.rest && dt > 0) {
        const dk = Math.exp(-0.3 * dt);
        L.vel.x = wx + (L.vel.x - wx) * dk;
        L.vel.z = wz + (L.vel.z - wz) * dk;
        L.vel.y = (L.vel.y - 9.8 * dt) * dk;
        o.position.addScaledVector(L.vel, dt);
        o.quaternion.premultiply(_lq.setFromAxisAngle(L.axis, L.w * dt));
        if (o.position.y < L.gy + 2 && L.vel.y < 0) {
          const g = this.ground(o.position.x, o.position.z);
          if (o.position.y <= g + 0.06) {
            o.position.y = g + 0.06;
            L.rest = true;
            o.quaternion.setFromEuler(_se.set((rand() < 0.5 ? -1 : 1) * Math.PI * 0.5 + rr(-0.08, 0.08), rand() * 6.283, 0, 'YXZ'));
          }
        }
      }
      o.scale.setScalar(Math.max(1e-3, Math.min(1, (L.life - L.age) / 1.5)));
    }

    // ground fires left by impacts
    for (let i = this.sites.length - 1; i >= 0; i--) {
      const f = this.sites[i];
      f.t += dt;
      f.acc = Math.min(f.acc + dt, 0.4);
      if (f.t >= f.life) {
        this.sites.splice(i, 1);
        continue;
      }
      while (f.acc > 0.1) {
        f.acc -= 0.1;
        const k = f.k * (1 - 0.7 * (f.t / f.life));
        if (this.cheap()) this.fire(f.p, k, k * 0.8);
      }
    }

    // lights
    for (const l of this.lights) {
      const u = l.userData;
      u.t += dt;
      const f = Math.max(0, 1 - u.t / u.life);
      l.intensity = u.peak * f * f;
      l.visible = true;
    }
  }

  get counts() {
    return { smoke: this.smoke.n, glow: this.glow.n, debris: this.debris.length + this.shards.n + this.cases.live + this.lids.length };
  }
}
