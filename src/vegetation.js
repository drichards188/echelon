import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { patchMaterial, noiseGLSL } from './shaderlib.js';
import { mulberry32 } from './noise.js';
import { hedgeSegments } from './terrainField.js';
import { heightAt, padMask, ihash, riverCenterZ } from './terrainHeight.js';

// Windbreak rows along the hedge lines of the field grid, riparian willows, scattered groves and
// bushes. Four species (poplar, elm, birch, bush) as instanced meshes, a detailed and a coarse
// level each; every crown is a cluster of lumpy ellipsoids whose surface is cut into leaves in the
// fragment shader (a tiling leaf texture, triplanar in tree space, alpha-tested near the camera and
// solid beyond). Rows farther than ROW_NEAR are drawn as 50 m crossed cards carrying a row of
// silhouettes, a few triangles per piece, out to several kilometres. Every tree comes from a
// position hash, so a tree is the same tree each time it is re-planted.

const rnd = (x, z, s) => ihash(Math.floor(x * 2.7), Math.floor(z * 2.7), s);

// ---------------------------------------------------------------- textures
function dataTex(data, w, h, anisotropy = 4) {
  const t = new THREE.DataTexture(data, w, h, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = anisotropy;
  t.needsUpdate = true;
  return t;
}

// tiling leaves: alpha is coverage (about 80%), red a per-leaf brightness
function leafTexture() {
  const S = 128, d = new Uint8Array(S * S * 4);
  const rand = mulberry32(77);
  for (let n = 0; n < 230; n++) {
    const cx = rand() * S, cy = rand() * S, ang = rand() * Math.PI, len = 6.5 + rand() * 5, wid = 2.8 + rand() * 2;
    const shade = 70 + rand() * 185, c = Math.cos(ang), s = Math.sin(ang), R = Math.ceil(len) + 1;
    for (let j = -R; j <= R; j++) {
      for (let i = -R; i <= R; i++) {
        const u = i * c + j * s, w = -i * s + j * c;
        if ((u / len) ** 2 + (w / wid) ** 2 > 1) continue;
        const x = (((Math.floor(cx) + i) % S) + S) % S, y = (((Math.floor(cy) + j) % S) + S) % S, o = (y * S + x) * 4;
        const mid = 1 - Math.abs(w) / wid * 0.35; // a lighter midrib
        d[o] = Math.min(255, shade * mid + 20);
        d[o + 1] = d[o + 2] = 0;
        d[o + 3] = 255;
      }
    }
  }
  return dataTex(d, S, S);
}

// a row of tree silhouettes for the far cards: the upper half poplars (6 per piece), the lower half
// round crowns (4 per piece); alpha is the silhouette, red the brightness
function rowTexture() {
  const W = 512, H = 256, HH = H / 2, d = new Uint8Array(W * H * 4);
  const rand = mulberry32(1311);
  const put = (x, y, v) => {
    const o = (y * W + (((x % W) + W) % W)) * 4;
    d[o] = v; d[o + 3] = 255;
  };
  const grow = (y0, n, kind) => {
    for (let k = 0; k < n; k++) {
      const cx = (k + 0.5 + (rand() - 0.5) * 0.3) * (W / n), h = (kind === 0 ? 0.72 + 0.26 * rand() : 0.62 + 0.3 * rand()) * HH;
      const wmax = (kind === 0 ? 0.2 : 0.36) * (W / n) * (0.85 + 0.3 * rand());
      for (let y = 0; y < h; y++) {
        const t = y / h;
        let hw;
        if (kind === 0) hw = t < 0.1 ? 1.5 : wmax * Math.pow(Math.sin(Math.PI * Math.pow((t - 0.1) / 0.9, 0.62)), 0.85);
        else hw = t < 0.28 ? 1.8 : wmax * Math.sqrt(Math.max(0, 1 - ((t - 0.64) / 0.36) ** 2));
        hw *= 0.9 + 0.2 * Math.sin(y * 0.9 + k * 3.1);
        for (let x = Math.floor(cx - hw); x <= Math.ceil(cx + hw); x++) {
          const edge = 1 - Math.abs(x - cx) / Math.max(hw, 1);
          const shade = (t < 0.1 || (kind === 1 && t < 0.28) ? 60 : 100 + 90 * t + 40 * edge) * (0.75 + 0.5 * rand());
          put(x, y0 + y, Math.min(255, shade));
        }
      }
    }
  };
  grow(0, 4, 1);
  grow(HH, 6, 0);
  return dataTex(d, W, H, 8);
}

// ---------------------------------------------------------------- geometry
const tmpV = new THREE.Vector3();
function disp(x, y, z, seed) {
  const h = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719 + seed * 4.1) * 43758.5453;
  return (h - Math.floor(h)) - 0.5;
}

// a lumpy ellipsoid with smooth outward normals and a vertical colour gradient; aLeaf is the leaf
// tiling frequency per metre (0 on wood)
function blob(c, r, detail, seed, lo, hi, lump = 0.3, leaf = 0.45) {
  const g = new THREE.IcosahedronGeometry(1, detail);
  g.deleteAttribute('uv');
  const p = g.attributes.position, n = g.attributes.normal;
  const col = new Float32Array(p.count * 3);
  const a = new THREE.Color(), b = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const k = 1 + lump * disp(Math.round(x * 50) / 50, Math.round(y * 50) / 50, Math.round(z * 50) / 50, seed);
    x *= k; y *= k; z *= k;
    tmpV.set(x / (r[0] * r[0]), y / (r[1] * r[1]), z / (r[2] * r[2])).normalize();
    n.setXYZ(i, tmpV.x, tmpV.y, tmpV.z);
    p.setXYZ(i, c[0] + x * r[0], c[1] + y * r[1], c[2] + z * r[2]);
    const t = THREE.MathUtils.clamp((y + 1) / 2, 0, 1);
    a.set(lo).lerp(b.set(hi), t * t * 0.9 + 0.1);
    const j = 0.88 + 0.24 * (disp(x * 3, y * 3, z * 3, seed + 1) + 0.5);
    col[i * 3] = a.r * j; col[i * 3 + 1] = a.g * j; col[i * 3 + 2] = a.b * j;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('aLeaf', new THREE.BufferAttribute(new Float32Array(p.count).fill(leaf), 1));
  return g;
}

function paint(g, fn) {
  const n = g.attributes.position.count, col = new Float32Array(n * 3), c = new THREE.Color();
  for (let i = 0; i < n; i++) {
    fn(c, g.attributes.position.getY(i), i);
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('aLeaf', new THREE.BufferAttribute(new Float32Array(n), 1));
  return g;
}

function trunk(h, r0, r1, sides, color, bands = false) {
  const g = new THREE.CylinderGeometry(r1, r0, h, sides, bands ? Math.round(h * 2) : 1, true).toNonIndexed();
  g.deleteAttribute('uv');
  g.translate(0, h / 2, 0);
  const base = new THREE.Color(color), dark = new THREE.Color(0x1c1914);
  return paint(g, (c, y, i) => {
    c.copy(base);
    // birch bark: dark scars across the white
    if (bands && disp(Math.floor(y * 2.4), i % 3 > 0 ? 1 : 0, Math.floor(i / 6) % 6, 9) > 0.18) c.lerp(dark, 0.75);
  });
}

// a limb from a to b, tapering
const _up = new THREE.Vector3(0, 1, 0), _q = new THREE.Quaternion();
function limb(a, b, r0, r1, color) {
  const d = new THREE.Vector3(...b).sub(new THREE.Vector3(...a)), len = d.length();
  const g = new THREE.CylinderGeometry(r1, r0, len, 5, 1, true).toNonIndexed();
  g.deleteAttribute('uv');
  g.translate(0, len / 2, 0);
  g.applyQuaternion(_q.setFromUnitVectors(_up, d.normalize()));
  g.translate(a[0], a[1], a[2]);
  const c = new THREE.Color(color);
  return paint(g, (out) => out.copy(c));
}

function poplar(detail) {
  const parts = [trunk(5.5, 0.28, 0.16, 6, 0x3d332a)];
  const radii = [1.5, 2.0, 2.15, 2.0, 1.65, 1.15, 0.6];
  radii.forEach((rx, i) => {
    const o = disp(i, 3, 7, 5) * 0.7;
    parts.push(blob([o, 3.6 + i * 2.35, -o * 0.6], [rx, 2.7 - i * 0.05, rx], detail, i + 1, 0x1d3d10, 0x628528, 0.42, 0.3));
  });
  // ragged flanks: small clumps standing proud of the column
  for (let i = 0; i < 7; i++) {
    const a = i * 2.4 + 0.5, y = 3.4 + i * 1.75, r = 1.5 + 0.55 * Math.sin((i + 0.6) * 0.62 * 2);
    parts.push(blob([Math.cos(a) * r, y, Math.sin(a) * r], [0.95, 1.05, 0.95], detail, i + 41, 0x1d3d10, 0x628528, 0.4, 0.3));
  }
  return mergeGeometries(parts);
}
function broad(detail) {
  const parts = [trunk(4.6, 0.42, 0.28, 7, 0x4a3c30)];
  parts.push(limb([0, 4.2, 0], [-1.9, 7.4, 0.6], 0.26, 0.12, 0x4a3c30), limb([0, 4.2, 0], [2.0, 7.0, -0.8], 0.24, 0.11, 0x4a3c30), limb([0, 4.4, 0], [0.4, 7.2, 2.2], 0.2, 0.1, 0x4a3c30));
  const bl = [[0, 8.6, 0, 3.9, 3.0], [-3.3, 6.9, 1.0, 2.8, 2.3], [3.4, 7.1, -1.0, 2.9, 2.3], [0.6, 6.6, 3.2, 2.6, 2.1], [-0.8, 6.9, -3.2, 2.6, 2.1], [0.4, 10.9, -0.6, 2.5, 2.0], [-2.4, 9.4, -1.6, 2.2, 1.8], [2.2, 9.5, 1.8, 2.3, 1.9]];
  for (let i = 0; i < 6; i++) {
    const a = i * 1.1 + 0.3, r = 3.6 + (i % 2) * 0.8;
    bl.push([Math.cos(a) * r, 7.4 + (i % 3) * 1.4, Math.sin(a) * r, 1.5, 1.3]);
  }
  bl.forEach((b, i) => parts.push(blob([b[0], b[1], b[2]], [b[3], b[4], b[3]], detail, i + 11, 0x24441a, 0x6a8c2e, 0.34, 0.24)));
  return mergeGeometries(parts);
}
function birch(detail) {
  const parts = [trunk(9, 0.17, 0.07, 5, 0xd6d2c4, true)];
  parts.push(limb([0, 6, 0], [1.0, 8.6, 0.3], 0.07, 0.04, 0xd6d2c4), limb([0, 5.4, 0], [-0.9, 7.6, 0.2], 0.07, 0.04, 0xd6d2c4));
  const bl = [[0, 8.6, 0, 1.9, 2.4], [0.9, 10.6, 0.3, 1.5, 2.1], [-0.9, 6.9, 0.3, 1.6, 1.8], [0, 12.4, 0, 1.15, 1.5], [0.5, 9.2, -1.0, 1.3, 1.8], [-0.7, 10.0, 0.9, 1.2, 1.6]];
  bl.forEach((b, i) => parts.push(blob([b[0], b[1], b[2]], [b[3], b[4], b[3]], detail, i + 31, 0x3a6a1c, 0x95b648, 0.36, 0.34)));
  return mergeGeometries(parts);
}
function bush(detail) {
  const parts = [];
  [[0, 0.8, 0, 1.4, 0.9], [-1.1, 0.6, 0.5, 0.95, 0.65], [1.0, 0.6, -0.4, 1.0, 0.7], [0.2, 0.5, 1.2, 0.8, 0.55]].forEach((b, i) => parts.push(blob([b[0], b[1], b[2]], [b[3], b[4], b[3]], detail, i + 21, 0x2a4a14, 0x6a8a30, 0.32, 0.6)));
  return mergeGeometries(parts);
}

const SPECIES = [
  { name: 'poplar', build: poplar },
  { name: 'broad', build: broad },
  { name: 'bush', build: bush },
  { name: 'birch', build: birch },
];
const [POPLAR, BROAD, BUSH, BIRCH] = [0, 1, 2, 3];
const CAP_NEAR = 1200, CAP_FAR = 4500, CAP_ROW = 12000;
const NEAR_R = 380; // detailed crowns inside
const ROW_NEAR = 1500; // hedge segments whose middle is farther than this are drawn as cards
const ROW_FAR = 7600;
const PIECE = 50;

// row cards: two crossed vertical cards and a thin top, unit length PIECE, height 1
function rowGeometry() {
  const pos = [], uv = [], nrm = [], idx = [], kind = [];
  const quad = (p, uvs, n, k) => {
    const b = pos.length / 3;
    for (let i = 0; i < 4; i++) { pos.push(...p[i]); uv.push(...uvs[i]); nrm.push(...n); kind.push(k); }
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  };
  const h = PIECE / 2, y0 = -0.07;
  const card = (z, u0, k) => quad([[-h, y0, z], [h, y0, z], [h, 1, z], [-h, 1, z]], [[u0, 0], [u0 + 1, 0], [u0 + 1, 1], [u0, 1]], [0, 0.9, 0.3], k);
  card(-0.9, 0, 0);
  card(1.1, 0.41, 0);
  // top, a few metres wide, for views from above
  quad([[-h, 0.86, -2.2], [h, 0.86, -2.2], [h, 0.86, 2.2], [-h, 0.86, 2.2]], [[0, 0.5], [1, 0.5], [1, 0.5], [0, 0.5]], [0, 1, 0], 1);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('aKind', new THREE.Float32BufferAttribute(kind, 1));
  g.setIndex(idx);
  return g;
}

export class Trees {
  constructor(terrain) {
    this.terrain = terrain;
    this.group = new THREE.Group();
    this.group.name = 'trees';
    this.density = 1;
    this.R = 2000; // individual trees (hedge segments nearer than ROW_NEAR, groves, willows)
    this.center = new THREE.Vector2(1e9, 1e9);
    this.dirty = true;
    this.leafTex = leafTexture();
    this.rowTex = rowTexture();

    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, metalness: 0, side: THREE.DoubleSide });
    mat.defines = { SKIP_WET: '' };
    patchMaterial(mat, 'trees-iads-2', (shader) => {
      shader.uniforms.uLeaf = { value: this.leafTex };
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aLeaf;\nvarying float vLeaf;\nvarying vec3 vLP;\nvarying vec3 vLN;\nuniform float uTime;\nuniform float uWindStrength;')
        .replace(
          '#include <begin_vertex>',
          /* glsl */ `
          #include <begin_vertex>
          vLeaf = aLeaf;
          vLP = position;
          vLN = normal;
          {
            float hN = clamp(position.y / 16.0, 0.0, 1.0);
            vec3 ip = vec3(instanceMatrix[3]);
            float ph = uTime * 1.5 + ip.x * 0.11 + ip.z * 0.13;
            float w = 0.4 + uWindStrength;
            transformed.x += sin(ph) * 0.4 * hN * hN * w;
            transformed.z += cos(ph * 0.83) * 0.3 * hN * hN * w;
            // leaf shimmer, crowns only
            float fl = sin(uTime * 3.1 + dot(position, vec3(2.3, 1.7, 2.9)) + ip.x * 0.3) * min(aLeaf, 1.0);
            transformed += normal * fl * 0.07 * (0.3 + w * 0.6) * (0.4 + hN);
          }
          `
        );
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\nvarying float vLeaf;\nvarying vec3 vLP;\nvarying vec3 vLN;\nuniform sampler2D uLeaf;\n${noiseGLSL}`)
        .replace(
          '#include <color_fragment>',
          /* glsl */ `
          #include <color_fragment>
          {
            #ifdef USE_FOG
            float dd = length(vFogWorldPos - cameraPosition);
            #else
            float dd = 100.0;
            #endif
            if (vLeaf > 0.0) {
              vec3 nw = pow(abs(normalize(vLN)), vec3(3.0));
              nw /= nw.x + nw.y + nw.z;
              float sc = vLeaf;
              vec4 t = texture2D(uLeaf, vLP.zy * sc + 0.13) * nw.x + texture2D(uLeaf, vLP.xy * sc + 0.57) * nw.z + texture2D(uLeaf, vLP.xz * sc + 0.31) * nw.y;
              // leaf-shaped gaps near the camera, a solid crown beyond
              if (t.a < 0.46 * (1.0 - smoothstep(40.0, 160.0, dd))) discard;
              diffuseColor.rgb *= 0.45 + 0.9 * t.r;
            }
            if (!gl_FrontFacing) diffuseColor.rgb *= 0.55;
            #ifdef USE_FOG
            diffuseColor.rgb *= 0.7 + 0.6 * vnoise(vFogWorldPos.xz * 1.9 + vFogWorldPos.y * 2.3);
            #endif
          }
          `
        )
        .replace(
          '#include <emissivemap_fragment>',
          /* glsl */ `
          #include <emissivemap_fragment>
          #ifdef USE_FOG
          if (vLeaf > 0.0) {
            // light through the leaves when looking toward the sun
            vec3 vdW = normalize(vFogWorldPos - cameraPosition);
            totalEmissiveRadiance += uSunColorN * diffuseColor.rgb * 0.3 * pow(max(dot(vdW, uSunDirW), 0.0), 3.0) * worldShadowFactor(vFogWorldPos);
          }
          #endif
          `
        );
    });
    this.material = mat;

    const rowMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, metalness: 0, side: THREE.DoubleSide });
    rowMat.defines = { SKIP_WET: '' };
    patchMaterial(rowMat, 'tree-rows-iads', (shader) => {
      shader.uniforms.uRowTex = { value: this.rowTex };
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec2 aRow;\nattribute float aKind;\nvarying vec2 vRowUv;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRowUv = vec2(uv.x + aRow.x, uv.y * 0.5 + aRow.y * 0.5);');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\nvarying vec2 vRowUv;\nuniform sampler2D uRowTex;\n${noiseGLSL}`)
        .replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\nnormal = normalize(vNormal);')
        .replace(
          '#include <color_fragment>',
          /* glsl */ `
          #include <color_fragment>
          {
            vec4 rt = texture2D(uRowTex, vRowUv);
            #ifdef USE_FOG
            float dd = length(vFogWorldPos - cameraPosition);
            #else
            float dd = 1000.0;
            #endif
            // the silhouettes thin with the mip chain; keep the row readable at a distance
            if (rt.a < mix(0.5, 0.2, smoothstep(300.0, 2500.0, dd))) discard;
            diffuseColor.rgb *= 0.4 + 0.85 * rt.r;
            #ifdef USE_FOG
            diffuseColor.rgb *= 0.75 + 0.5 * vnoise(vFogWorldPos.xz * 0.35);
            #endif
          }
          `
        );
    });
    this.rowMaterial = rowMat;

    this.meshes = SPECIES.map((sp) => {
      const near = new THREE.InstancedMesh(sp.build(1), mat, CAP_NEAR);
      const far = new THREE.InstancedMesh(sp.build(0), mat, CAP_FAR);
      for (const m of [near, far]) {
        m.count = 0;
        m.frustumCulled = false;
        m.receiveShadow = true;
        m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        m.setColorAt(0, new THREE.Color(1, 1, 1));
        m.instanceColor.setUsage(THREE.DynamicDrawUsage);
        m.name = `trees-${sp.name}`;
        this.group.add(m);
      }
      near.castShadow = true;
      return { near, far };
    });

    const rg = rowGeometry();
    this.rowAttr = new THREE.InstancedBufferAttribute(new Float32Array(CAP_ROW * 2), 2).setUsage(THREE.DynamicDrawUsage);
    rg.setAttribute('aRow', this.rowAttr);
    this.rows = new THREE.InstancedMesh(rg, rowMat, CAP_ROW);
    this.rows.count = 0;
    this.rows.frustumCulled = false;
    this.rows.receiveShadow = false;
    this.rows.castShadow = false;
    this.rows.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.rows.setColorAt(0, new THREE.Color(1, 1, 1));
    this.rows.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.rows.name = 'tree-rows';
    this.group.add(this.rows);

    this._o = new THREE.Object3D();
    this._c = new THREE.Color();
  }

  setDensity(d) {
    this.density = d;
    this.dirty = true;
  }

  update(camera, force = false) {
    const p = camera.position;
    if (!force && !this.dirty && Math.hypot(p.x - this.center.x, p.z - this.center.y) < 110) return;
    this.dirty = false;
    this.center.set(p.x, p.z);
    this.plant(p.x, p.z);
  }

  plant(cx, cz) {
    const R = this.R, R2 = R * R;
    const counts = this.meshes.map(() => [0, 0]);
    const o = this._o, col = this._c;
    const put = (x, z, sp, scale, tint) => {
      const dx = x - cx, dz = z - cz, d2 = dx * dx + dz * dz;
      if (d2 > R2) return;
      if (padMask(x, z) > 0.04) return;
      if (Math.abs(z - riverCenterZ(x)) < 38) return;
      const near = d2 < NEAR_R * NEAR_R ? 0 : 1;
      const m = this.meshes[sp][near ? 'far' : 'near'];
      const cnt = counts[sp];
      if (cnt[near] >= (near ? CAP_FAR : CAP_NEAR)) return;
      const w = 0.88 + 0.24 * rnd(x, z, 74), hh = 0.92 + 0.16 * rnd(x, z, 78);
      o.position.set(x, heightAt(x, z) - 0.15, z);
      o.rotation.set(0, rnd(x, z, 73) * 6.283, 0);
      o.scale.set(scale * w, scale * hh, scale * (0.9 + 0.2 * rnd(x, z, 79)));
      o.updateMatrix();
      m.setMatrixAt(cnt[near], o.matrix);
      // tint: a wide spread of lightness and some trees yellower or bluer (leaf age, species mix)
      const l = tint * (0.78 + 0.4 * rnd(x, z, 75)), warm = rnd(x, z, 76);
      col.setRGB(l * (0.9 + 0.3 * warm), l * (0.95 + 0.1 * rnd(x, z, 77)), l * (1.05 - 0.3 * warm));
      m.setColorAt(cnt[near], col);
      cnt[near]++;
    };

    // windbreaks along the hedge lines: nearer ones as individual trees, farther ones as cards
    const dens = this.density;
    let rows = 0;
    const rm = this.rows, ra = this.rowAttr.array;
    const RN2 = ROW_NEAR * ROW_NEAR, RF2 = ROW_FAR * ROW_FAR;
    for (const s of hedgeSegments(cx, cz, ROW_FAR)) {
      const dx = s.x1 - s.x0, dz = s.z1 - s.z0, len = Math.hypot(dx, dz);
      const sx = dx / len, sz = dz / len;
      const seed = Math.floor(s.x0 + s.z0 * 3.7);
      // a row is mostly one kind: poplars, elms or birches, with a few of the others
      const kr = ihash(seed, 3, 83);
      const rowKind = kr < 0.5 ? POPLAR : kr < 0.8 ? BROAD : BIRCH;
      const mx = (s.x0 + s.x1) / 2 - cx, mz = (s.z0 + s.z1) / 2 - cz, md = mx * mx + mz * mz;
      if (md > RN2) {
        // cards: 50 m pieces along the row
        const nP = Math.max(1, Math.round(len / PIECE)), lp = len / nP;
        const ang = -Math.atan2(dz, dx);
        for (let k = 0; k < nP; k++) {
          const t = (k + 0.5) * lp;
          const x = s.x0 + sx * t, z = s.z0 + sz * t;
          const px = x - cx, pz = z - cz;
          if (px * px + pz * pz > RF2 || rows >= CAP_ROW) continue;
          if (padMask(x, z) > 0.04 || Math.abs(z - riverCenterZ(x)) < 38) continue;
          const r1 = ihash(Math.floor(x), Math.floor(z), 97), r2 = ihash(Math.floor(x), Math.floor(z), 98);
          const round = rowKind !== POPLAR;
          const hgt = (round ? 9.5 + 3.5 * r1 : 13 + 5 * r1) * (0.85 + 0.15 * dens);
          o.position.set(x, heightAt(x, z) - 0.1, z);
          o.rotation.set(0, ang, 0);
          o.scale.set(lp / PIECE, hgt, 1);
          o.updateMatrix();
          rm.setMatrixAt(rows, o.matrix);
          const l = (rowKind === BIRCH ? 1.15 : 0.95) * (0.78 + 0.4 * r2);
          col.setRGB(l * (0.9 + 0.3 * r1), l, l * (1.05 - 0.3 * r1));
          rm.setColorAt(rows, col);
          ra[rows * 2] = r2;
          ra[rows * 2 + 1] = round ? 0 : 1;
          rows++;
        }
        continue;
      }
      // along the row, ~8 m apart with jitter
      for (let t = 2; t < len - 2; ) {
        const r = ihash(Math.floor(s.x0 + sx * t), Math.floor(s.z0 + sz * t), 79);
        t += (6.5 + 3.5 * r) / Math.max(0.5, dens);
        const x = s.x0 + sx * t + sz * (r - 0.5) * 4, z = s.z0 + sz * t - sx * (r - 0.5) * 4;
        const pick = rnd(x, z, 81);
        const other = pick < 0.88 ? BROAD : pick < 0.95 ? BIRCH : POPLAR;
        const sp = pick < 0.08 ? BUSH : pick < 0.78 ? rowKind : other;
        const sc = sp === POPLAR ? 0.8 + 0.5 * rnd(x, z, 85) : sp === BUSH ? 1 + 0.6 * rnd(x, z, 85) : 0.7 + 0.5 * rnd(x, z, 85);
        put(x, z, sp, sc, 0.9);
      }
    }
    rm.count = rows;
    rm.instanceMatrix.needsUpdate = true;
    rm.instanceColor.needsUpdate = true;
    this.rowAttr.needsUpdate = true;

    // groves and lone trees on a 160 m cell grid
    const C = 160;
    const i0 = Math.floor((cx - R) / C), i1 = Math.floor((cx + R) / C), j0 = Math.floor((cz - R) / C), j1 = Math.floor((cz + R) / C);
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const h = ihash(i, j, 91);
        if (h > 0.035 * dens) continue;
        const gx = (i + ihash(i, j, 92)) * C, gz = (j + ihash(i, j, 93)) * C;
        if (gx * gx + gz * gz < 900 * 900) continue; // the airbase stays open
        const n = 3 + Math.floor(ihash(i, j, 94) * 7);
        for (let k = 0; k < n; k++) {
          const a = ihash(i, j, 100 + k) * 6.283, d = Math.sqrt(ihash(i, j, 120 + k)) * 26;
          const x = gx + Math.cos(a) * d, z = gz + Math.sin(a) * d;
          const q = ihash(i, j, 140 + k), s2 = ihash(i, j, 160 + k);
          const sp = q < 0.4 ? BROAD : q < 0.7 ? BIRCH : q < 0.8 ? POPLAR : BUSH;
          put(x, z, sp, sp === BUSH ? 1 + s2 : sp === BIRCH ? 0.8 + 0.5 * s2 : 0.7 + 0.6 * s2, 0.9);
        }
      }
    }

    // willows and reeds along the river banks
    const x0 = Math.floor((cx - R) / 14) * 14;
    for (let x = x0; x < cx + R; x += 14) {
      const r = ihash(Math.floor(x / 14), 7, 95);
      if (r > 0.6 * dens) continue;
      const side = r < 0.3 * dens ? -1 : 1;
      const zc = riverCenterZ(x);
      const off = 36 + 22 * ihash(Math.floor(x / 14), 8, 96);
      put(x + (r - 0.3) * 10, zc + side * off, r < 0.12 ? BUSH : BROAD, r < 0.12 ? 1.4 : 0.75 + 0.4 * r, 0.8);
    }

    this.meshes.forEach(({ near, far }, i) => {
      near.count = counts[i][0];
      far.count = counts[i][1];
      for (const m of [near, far]) {
        m.instanceMatrix.needsUpdate = true;
        if (m.instanceColor) m.instanceColor.needsUpdate = true;
      }
    });
    this.counts = counts;
    this.rowCount = rows;
  }
}
