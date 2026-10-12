import * as THREE from 'three';
import { heightAt, heightLod, normalAt, padMask, los, riverCenterZ, riverLevel, RIVER } from './terrainHeight.js';
import { fieldGLSL } from './terrainField.js';
import { patchMaterial, noiseGLSL, globalUniforms } from './shaderlib.js';
import { makeTileableNormalMap } from './noise.js';
import { Trees } from './vegetation.js';
import { Grass } from './grass.js';

export { heightAt, normalAt, los, riverCenterZ, riverLevel, RIVER };

// Camera-centred geometry clipmap built on the CPU from the same pure heightAt the sim uses.
// Level k is an (N+1)^2 grid with cell 2.5 * 2^k metres whose vertices sit on the world grid; the
// level above it is drawn with the quads under the finer one left out. Cracks between levels are
// hidden by skirts. Levels re-centre in steps of two cells and reuse the heights they already have.
const N = 80;
const BASE_CELL = 2.5;
const LEVELS = 10; // 200 m, 400 m ... 102 km across

const QUALITY = {
  Low: { grass: 40000, trees: 0.45, grassRadius: 42 },
  Medium: { grass: 110000, trees: 0.8, grassRadius: 52 },
  High: { grass: 200000, trees: 1, grassRadius: 62 },
  Ultra: { grass: 320000, trees: 1.2, grassRadius: 80 },
};

class Level {
  constructor(k) {
    this.k = k;
    this.cell = BASE_CELL * 2 ** k;
    const G = N + 3; // one extra ring of heights for the normals
    this.G = G;
    this.h = new Float32Array(G * G);
    this.h2 = new Float32Array(G * G);
    this.gx0 = 1e9; // global grid index of h[0]
    this.gz0 = 1e9;
    this.cx = 1e9; // snapped centre (world metres)
    this.cz = 1e9;
    this.valid = false;
    const V = (N + 1) * (N + 1), P = 4 * N;
    this.V = V;
    this.pos = new Float32Array((V + P) * 3);
    this.nrm = new Float32Array((V + P) * 3);
    this.info = new Float32Array((V + P) * 2);
    this.index = new Uint16Array(N * N * 6 + P * 6);
    this.geo = new THREE.BufferGeometry();
    const dyn = (a, n) => new THREE.BufferAttribute(a, n).setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('position', dyn(this.pos, 3));
    this.geo.setAttribute('normal', dyn(this.nrm, 3));
    this.geo.setAttribute('aInfo', dyn(this.info, 2));
    this.geo.setIndex(new THREE.BufferAttribute(this.index, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e7);
    this.hole = null; // finer level's rect { x0, x1, z0, z1 } in world metres, or null
    this.holeKey = '';
    // perimeter order: south (x up), east (z up), north (x down), west (z down)
    const per = [];
    for (let i = 0; i < N; i++) per.push(i); // z = 0
    for (let j = 0; j < N; j++) per.push(j * (N + 1) + N); // x = N
    for (let i = N; i > 0; i--) per.push(N * (N + 1) + i); // z = N
    for (let j = N; j > 0; j--) per.push(j * (N + 1)); // x = 0
    this.per = per;
  }

  // world index of grid point (gx, gz) -> height, computing what the previous centre did not have
  rebuild(cx, cz) {
    const c = this.cell, G = this.G, half = N / 2;
    const gx0 = Math.round(cx / c) - half - 1, gz0 = Math.round(cz / c) - half - 1;
    const old = this.h, nu = this.h2;
    const ox = this.gx0, oz = this.gz0;
    for (let b = 0; b < G; b++) {
      const gz = gz0 + b;
      for (let a = 0; a < G; a++) {
        const gx = gx0 + a;
        const oa = gx - ox, ob = gz - oz;
        nu[b * G + a] = this.valid && oa >= 0 && oa < G && ob >= 0 && ob < G ? old[ob * G + oa] : heightLod(gx * c, gz * c, c);
      }
    }
    this.h = nu;
    this.h2 = old;
    this.gx0 = gx0;
    this.gz0 = gz0;
    this.cx = cx;
    this.cz = cz;
    this.valid = true;

    const pos = this.pos, nrm = this.nrm, info = this.info;
    const detail = this.k <= 3;
    const skirt = c * 0.55 + 0.5;
    for (let j = 0; j <= N; j++) {
      for (let i = 0; i <= N; i++) {
        const idx = j * (N + 1) + i;
        const a = i + 1, b = j + 1; // centre of the (N+3) array
        const y = nu[b * G + a];
        const x = (gx0 + a) * c, z = (gz0 + b) * c;
        pos[idx * 3] = x;
        pos[idx * 3 + 1] = y;
        pos[idx * 3 + 2] = z;
        const dx = nu[b * G + a - 1] - nu[b * G + a + 1];
        const dz = nu[(b - 1) * G + a] - nu[(b + 1) * G + a];
        const inv = 1 / Math.sqrt(dx * dx + 4 * c * c + dz * dz);
        nrm[idx * 3] = dx * inv;
        nrm[idx * 3 + 1] = 2 * c * inv;
        nrm[idx * 3 + 2] = dz * inv;
        let pm = 0, rv = 0;
        if (detail) pm = padMask(x, z);
        const dr = Math.abs(z - riverCenterZ(x));
        if (dr < 120) rv = 1 - Math.min(1, Math.max(0, (dr - 14) / 80));
        info[idx * 2] = pm;
        info[idx * 2 + 1] = rv;
      }
    }
    const V = this.V;
    for (let s = 0; s < this.per.length; s++) {
      const src = this.per[s], dst = V + s;
      pos[dst * 3] = pos[src * 3];
      pos[dst * 3 + 1] = pos[src * 3 + 1] - skirt;
      pos[dst * 3 + 2] = pos[src * 3 + 2];
      nrm[dst * 3] = nrm[src * 3];
      nrm[dst * 3 + 1] = nrm[src * 3 + 1];
      nrm[dst * 3 + 2] = nrm[src * 3 + 2];
      info[dst * 2] = info[src * 2];
      info[dst * 2 + 1] = info[src * 2 + 1];
    }
    for (const a of ['position', 'normal', 'aInfo']) this.geo.attributes[a].needsUpdate = true;
    this.holeKey = '';
  }

  // the quads under the finer level are dropped
  setHole(r) {
    const key = r ? `${r.x0}|${r.x1}|${r.z0}|${r.z1}|${this.gx0}|${this.gz0}` : 'none';
    if (key === this.holeKey) return;
    this.holeKey = key;
    const c = this.cell, idx = this.index;
    let n = 0;
    for (let j = 0; j < N; j++) {
      const z0 = (this.gz0 + 1 + j) * c, z1 = z0 + c;
      for (let i = 0; i < N; i++) {
        const x0 = (this.gx0 + 1 + i) * c, x1 = x0 + c;
        if (r && x0 >= r.x0 - 1e-3 && x1 <= r.x1 + 1e-3 && z0 >= r.z0 - 1e-3 && z1 <= r.z1 + 1e-3) continue;
        const a = j * (N + 1) + i, b = a + N + 1;
        idx[n++] = a; idx[n++] = b; idx[n++] = a + 1;
        idx[n++] = a + 1; idx[n++] = b; idx[n++] = b + 1;
      }
    }
    const P = this.per.length, V = this.V;
    for (let s = 0; s < P; s++) {
      const a = this.per[s], b = this.per[(s + 1) % P], a2 = V + s, b2 = V + ((s + 1) % P);
      idx[n++] = a; idx[n++] = b; idx[n++] = a2;
      idx[n++] = b; idx[n++] = b2; idx[n++] = a2;
    }
    this.geo.index.needsUpdate = true;
    this.geo.setDrawRange(0, n);
  }
}

export class Terrain {
  constructor(scene, { quality = 'Medium' } = {}) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.name = 'terrain';
    scene.add(this.group);

    this.detailN = makeTileableNormalMap({ size: 256, seed: 7, minFreq: 3, maxFreq: 40, strength: 1.4 });
    this.material = this.buildMaterial();
    this.levels = [];
    this.meshes = [];
    for (let k = 0; k < LEVELS; k++) {
      const lv = new Level(k);
      const mesh = new THREE.Mesh(lv.geo, this.material);
      mesh.frustumCulled = false;
      mesh.receiveShadow = true;
      mesh.name = `terrain-${k}`;
      this.group.add(mesh);
      this.levels.push(lv);
      this.meshes.push(mesh);
    }

    // the finest level's heights, for the grass shader
    this.nearTex = new THREE.DataTexture(new Float32Array((N + 1) * (N + 1) * 2), N + 1, N + 1, THREE.RGFormat, THREE.FloatType);
    this.nearTex.minFilter = this.nearTex.magFilter = THREE.NearestFilter;
    this.nearInfo = new THREE.Vector4(0, 0, BASE_CELL, N + 1); // origin x, origin z, cell, size

    this.buildWater();
    this.trees = new Trees(this);
    this.grass = new Grass(this);
    this.group.add(this.trees.group, this.grass.mesh);
    this.setQuality(quality);
    this._v = new THREE.Vector3();
    this.update({ position: new THREE.Vector3(0, 10, 0) }, true);
  }

  setQuality(name) {
    const q = QUALITY[name] || QUALITY.Medium;
    this.quality = q;
    this.grass.setCount(q.grass, q.grassRadius);
    this.trees.setDensity(q.trees);
  }

  heightAt(x, z) {
    return heightAt(x, z);
  }

  normalAt(x, z, out = new THREE.Vector3()) {
    return normalAt(x, z, out);
  }

  /** True if the straight line from A to B clears the ground. */
  los(ax, ay, az, bx, by, bz) {
    return los(ax, ay, az, bx, by, bz);
  }

  /**
   * The ground changed under the geometry: another era levels other pads (deploy.js setEra,
   * terrainHeight.js). Every level and the trees are built again around the camera.
   */
  relayout(camera) {
    for (const lv of this.levels) {
      lv.valid = false;
      lv.cx = lv.cz = 1e9;
    }
    this.trees.dirty = true;
    this.update(camera, true);
  }

  /** Recentre the camera-following geometry (call every frame; it rebuilds only when a level moves). */
  update(camera, all = false) {
    const p = camera.position;
    let budget = all ? LEVELS : 2;
    const L = this.levels;
    for (let k = 0; k < LEVELS; k++) {
      const lv = L[k], step = lv.cell * 2;
      const cx = Math.round(p.x / step) * step, cz = Math.round(p.z / step) * step;
      if (cx !== lv.cx || cz !== lv.cz) {
        if (budget <= 0) continue;
        budget--;
        lv.rebuild(cx, cz);
        if (k === 0) this.updateNear(lv);
      }
    }
    for (let k = 0; k < LEVELS; k++) {
      const lv = L[k];
      if (!lv.valid) continue;
      if (k === 0) {
        lv.setHole(null);
        continue;
      }
      const f = L[k - 1];
      const e = (N * f.cell) / 2;
      lv.setHole(f.valid ? { x0: f.cx - e, x1: f.cx + e, z0: f.cz - e, z1: f.cz + e } : null);
    }
    this.trees.update(camera, all);
    this.grass.update(camera);
  }

  updateNear(lv) {
    const t = this.nearTex.image.data, G = lv.G;
    for (let j = 0; j <= N; j++) {
      for (let i = 0; i <= N; i++) {
        const o = j * (N + 1) + i;
        t[o * 2] = lv.h[(j + 1) * G + i + 1];
        t[o * 2 + 1] = lv.info[o * 2];
      }
    }
    this.nearTex.needsUpdate = true;
    this.nearInfo.set((lv.gx0 + 1) * lv.cell, (lv.gz0 + 1) * lv.cell, lv.cell, N + 1);
  }

  // ---------------------------------------------------------------- materials
  buildMaterial() {
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, metalness: 0 });
    const detailN = this.detailN;
    patchMaterial(mat, 'terrain-iads', (shader) => {
      shader.uniforms.uDetailN = { value: detailN };
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec2 aInfo;\nvarying vec3 vWPos;\nvarying vec3 vWNormal;\nvarying vec2 vInfo;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWPos = position;\nvWNormal = normal;\nvInfo = aInfo;');
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
          varying vec3 vWPos;
          varying vec3 vWNormal;
          varying vec2 vInfo;
          uniform sampler2D uDetailN;
          ${noiseGLSL}
          ${fieldGLSL}
          float tDist;
          vec3 tWN;
          vec2 tBump;`
        )
        .replace(
          '#include <color_fragment>',
          /* glsl */ `
          #include <color_fragment>
          vec3 wp = vWPos;
          tDist = length(wp - cameraPosition);
          tWN = normalize(vWNormal);
          vec2 q = wp.xz;
          FieldInfo fi = fieldAt(q);
          float k = fi.kind;
          float fieldT = ihash(fi.i, fi.j, 61);
          float nFar = fbm2(q * 0.0012 + 4.0);
          float nMid = tDist < 7000.0 ? fbm2(q * 0.02) : 0.5;
          float nNear = tDist < 500.0 ? vnoise(q * 1.3) : 0.5;
          float nFine = tDist < 90.0 ? vnoise(q * 9.0) : 0.5;

          vec3 col = fieldBaseColor(k, smoothstep(0.35, 0.7, nFar * 0.7 + nMid * 0.5 - 0.1));
          col *= 0.82 + 0.36 * fieldT;
          col = mix(col, col * vec3(1.08, 1.0, 0.85), nFar);
          col *= 0.8 + 0.4 * nMid;
          col *= 0.85 + 0.3 * nNear;
          col *= 0.9 + 0.2 * nFine;

          // crop structure: drill rows, furrows, stubble streaks, sprayer tramlines and headland tracks
          float mpp = max(fwidth(q.x) + fwidth(q.y), 1e-4);
          vec2 gu = vec2(F_C, F_S);
          tBump = vec2(0.0);
          float pad = vInfo.x;
          if (k < 4.5) {
            float per = k == 2.0 ? 0.95 : k == 3.0 ? 0.3 : 0.5;
            float ph = fi.eL / per * 6.2831853;
            float aa = 1.0 - smoothstep(0.2, 0.55, mpp / per);
            float row = sin(ph) * aa;
            if (k == 2.0) {
              // plough: ridges and shadowed furrows, clods
              float clod = vnoise(q * vec2(9.0, 7.0));
              col *= (0.82 + 0.4 * (0.5 + 0.5 * row)) * (0.8 + 0.4 * clod);
              col = mix(col, vec3(0.2, 0.15, 0.09) * (0.8 + 0.4 * nNear), smoothstep(0.55, 1.0, clod) * 0.3 * (1.0 - smoothstep(60.0, 300.0, tDist)));
              tBump += gu * cos(ph) * 0.5 * aa;
            } else if (k == 3.0) {
              // stubble: pale straw streaks along the drill, bare soil showing between
              float streak = vnoise(vec2(fi.eL * 9.0, fi.vv * 0.45));
              col = mix(col, col * vec3(1.2, 1.12, 0.85), smoothstep(0.35, 0.8, streak) * 0.5 * (1.0 - smoothstep(30.0, 400.0, tDist)));
              col *= 1.0 + 0.16 * row;
              tBump += gu * cos(ph) * 0.12 * aa;
            } else {
              // standing crop: soil between the drills
              col *= 1.0 + 0.16 * row;
              tBump += gu * cos(ph) * 0.1 * aa;
            }
            // sprayer tramlines in the standing crop and the stubble
            if (k != 2.0) {
              float tr = (1.0 - smoothstep(0.1, 0.28 + mpp * 0.9, f_tramDist(fi))) * (1.0 - smoothstep(300.0, 1000.0, tDist)) * smoothstep(7.0, 9.0, fi.eL);
              col = mix(col, col * (k == 3.0 ? vec3(0.8, 0.72, 0.6) : vec3(0.62, 0.55, 0.4)), tr * 0.8);
            }
            // tractor tracks along the headland
            float hl = f_headland(fi, q) * (1.0 - smoothstep(150.0, 700.0, tDist));
            col = mix(col, col * vec3(0.55, 0.47, 0.36) + vec3(0.02, 0.012, 0.0), hl * 0.75);
          }
          // sunflowers: yellow heads in the lush fields
          if (k > 3.5 && k < 4.5 && nNear > 0.55) col = mix(col, vec3(0.4, 0.3, 0.02), smoothstep(0.55, 0.8, nNear) * (1.0 - smoothstep(60.0, 600.0, tDist)) * 0.5);

          // dirt roads between some fields: packed earth, two wheel ruts, a grassy crown
          vec3 rd = f_road(fi, q);
          if (rd.x < 6.0) {
            float d = rd.x;
            float cover = (1.0 - smoothstep(1.9, 2.5 + mpp * 0.7, d)) * (1.0 - smoothstep(4000.0, 9000.0, tDist)) * (1.0 - smoothstep(0.2, 0.6, pad));
            float rut = exp(-pow((d - 0.95) / 0.3, 2.0)) * (1.0 - smoothstep(0.3, 0.9, mpp));
            float crown = (1.0 - smoothstep(0.25, 0.6, d)) * (1.0 - smoothstep(0.25, 0.9, mpp));
            vec3 dirt = vec3(0.29, 0.22, 0.135) * (0.8 + 0.4 * nNear) * (0.9 + 0.2 * nFine);
            dirt = mix(dirt, vec3(0.34, 0.28, 0.2), smoothstep(0.55, 0.85, nMid) * 0.5); // dusty stretches
            vec3 rc = mix(dirt, dirt * 0.5, rut * 0.85);
            rc = mix(rc, col * 0.95, crown * 0.8);
            col = mix(col, rc, cover);
            float dh = 2.67 * (d - 0.95) * rut;
            tBump -= rd.yz * dh * cover * 0.9;
          }

          // field boundaries: a worn balk, and the dark shade of a hedge row (wider with distance so it does not alias)
          float eb = (1.0 - smoothstep(0.5, 1.6 + tDist * 0.0006, fi.edge)) * (1.0 - smoothstep(1500.0, 5000.0, tDist));
          col = mix(col, vec3(0.2, 0.15, 0.09), eb * 0.5);
          float hw = 3.0 + tDist * 0.0012;
          float hb = (1.0 - smoothstep(hw * 0.4, hw * 1.7, fi.hedge)) * (1.0 - smoothstep(9000.0, 18000.0, tDist));
          col = mix(col, vec3(0.022, 0.04, 0.014), hb * 0.8);

          // dry ground on the high ridges, a little rock on the steepest slopes
          float slope = 1.0 - tWN.y;
          col = mix(col, vec3(0.22, 0.19, 0.11) * (0.8 + 0.4 * nMid), smoothstep(45.0, 130.0, wp.y) * 0.45);
          col = mix(col, vec3(0.2, 0.18, 0.15) * (0.8 + 0.4 * nNear), smoothstep(0.1, 0.22, slope + (nMid - 0.5) * 0.06));

          // river banks: wet mud and reeds
          float rv = vInfo.y;
          vec3 reeds = mix(vec3(0.045, 0.085, 0.02), vec3(0.12, 0.1, 0.05), nMid);
          col = mix(col, reeds, smoothstep(0.55, 0.9, rv) * 0.8);
          col = mix(col, vec3(0.07, 0.055, 0.04), smoothstep(0.93, 1.0, rv));

          // levelled pads: packed earth and gravel
          vec3 gravel = vec3(0.26, 0.19, 0.11) * (0.75 + 0.5 * nFine) * (0.85 + 0.3 * nNear);
          col = mix(col, gravel, smoothstep(0.3 + 0.35 * nNear, 1.0, vInfo.x));
          diffuseColor.rgb *= col;
          `
        )
        .replace(
          '#include <normal_fragment_maps>',
          /* glsl */ `
          #include <normal_fragment_maps>
          {
            float dk = (1.0 - smoothstep(30.0, 260.0, tDist)) * 0.55;
            // two scales, the coarse one blended between two rotations so the texture does not tile
            mat2 rot = mat2(0.8, 0.6, -0.6, 0.8);
            float bl = smoothstep(0.3, 0.7, vnoise(q * 0.05));
            vec2 d1 = mix(texture2D(uDetailN, q * 0.3).xy, texture2D(uDetailN, rot * q * 0.23 + 0.41).xy, bl) * 2.0 - 1.0;
            vec2 d2 = mix(texture2D(uDetailN, q * 1.9 + 0.37).xy, texture2D(uDetailN, rot * q * 1.55 + 0.11).xy, 1.0 - bl) * 2.0 - 1.0;
            vec3 nW = normalize(tWN + vec3(d1.x * 0.9 + d2.x * 0.5, 0.0, d1.y * 0.9 + d2.y * 0.5) * dk * (k == 2.0 ? 1.6 : 1.0) + vec3(tBump.x, 0.0, tBump.y) * (1.0 - smoothstep(60.0, 400.0, tDist)));
            normal = normalize(mat3(viewMatrix) * nW);
          }
          `
        );
    });
    return mat;
  }

  buildWater() {
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.05, metalness: 0 });
    mat.defines = { SKIP_WET: '' };
    const detailN = this.detailN;
    patchMaterial(mat, 'river-iads', (shader) => {
      shader.uniforms.uDetailN = { value: detailN };
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aEdge;\nvarying vec3 vWPos;\nvarying float vEdge;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWPos = position;\nvEdge = aEdge;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nvarying float vEdge;\nuniform sampler2D uDetailN;\nuniform float uTime;')
        .replace(
          '#include <color_fragment>',
          /* glsl */ `
          #include <color_fragment>
          vec3 deep = vec3(0.02, 0.045, 0.04);
          vec3 shallow = vec3(0.09, 0.11, 0.07);
          diffuseColor.rgb = mix(deep, shallow, vEdge * vEdge);
          `
        )
        .replace(
          '#include <normal_fragment_maps>',
          /* glsl */ `
          #include <normal_fragment_maps>
          {
            vec2 flow = vec2(uTime * 0.35, 0.0);
            vec2 a = texture2D(uDetailN, vWPos.xz * 0.12 + flow * 0.2).xy * 2.0 - 1.0;
            vec2 b = texture2D(uDetailN, vWPos.xz * 0.45 - flow * 0.31 + 0.21).xy * 2.0 - 1.0;
            float calm = 1.0 - smoothstep(80.0, 500.0, length(vWPos - cameraPosition));
            vec3 nW = normalize(vec3(0.0, 1.0, 0.0) + vec3(a.x + b.x * 0.6, 0.0, a.y + b.y * 0.6) * 0.28 * calm);
            normal = normalize(mat3(viewMatrix) * nW);
          }
          `
        );
    });
    this.waterMat = mat;
    // one static ribbon along the river, the level following the swells of the ground
    const X0 = -26000, X1 = 26000, STEP = 22;
    const n = Math.round((X1 - X0) / STEP);
    const pos = new Float32Array((n + 1) * 2 * 3);
    const hw = RIVER.halfWidth - 1.5;
    for (let i = 0; i <= n; i++) {
      const x = X0 + i * STEP, zc = riverCenterZ(x);
      const dz = riverCenterZ(x + 1) - zc;
      const l = Math.hypot(1, dz);
      const nx = -dz / l, nz = 1 / l;
      const y = riverLevel(x);
      for (let s = 0; s < 2; s++) {
        const sg = s === 0 ? -1 : 1, o = (i * 2 + s) * 3;
        pos[o] = x + nx * hw * sg;
        pos[o + 1] = y;
        pos[o + 2] = zc + nz * hw * sg;
      }
    }
    // a centre line so the banks read shallow and the middle deep
    const geo = new THREE.BufferGeometry();
    const full = new Float32Array((n + 1) * 3 * 3), fe = new Float32Array((n + 1) * 3), fi = [];
    for (let i = 0; i <= n; i++) {
      for (let s = 0; s < 3; s++) {
        const src = s === 2 ? i * 2 + 1 : i * 2;
        const o = (i * 3 + s) * 3;
        if (s === 1) {
          full[o] = (pos[i * 6] + pos[i * 6 + 3]) / 2;
          full[o + 1] = pos[i * 6 + 1];
          full[o + 2] = (pos[i * 6 + 2] + pos[i * 6 + 5]) / 2;
          fe[i * 3 + 1] = 0;
        } else {
          full[o] = pos[src * 3];
          full[o + 1] = pos[src * 3 + 1];
          full[o + 2] = pos[src * 3 + 2];
          fe[i * 3 + s] = 1;
        }
      }
      if (i < n) {
        const a = i * 3;
        fi.push(a, a + 1, a + 3, a + 1, a + 4, a + 3, a + 1, a + 2, a + 4, a + 2, a + 5, a + 4);
      }
    }
    geo.setAttribute('position', new THREE.BufferAttribute(full, 3));
    geo.setAttribute('aEdge', new THREE.BufferAttribute(fe, 1));
    geo.setIndex(fi);
    geo.computeVertexNormals();
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e7);
    this.water = new THREE.Mesh(geo, mat);
    this.water.frustumCulled = false;
    this.water.receiveShadow = true;
    this.water.name = 'river';
    this.group.add(this.water);
  }
}
