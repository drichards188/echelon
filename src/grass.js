import * as THREE from 'three';
import { mulberry32 } from './noise.js';
import { patchMaterial, noiseGLSL } from './shaderlib.js';
import { fieldGLSL } from './terrainField.js';

// GPU grass. Tufts live in a square tile that wraps around the viewer, so a fixed pool of
// instances always carpets the ground near the camera. Placement on the ground (from the finest
// terrain level's height texture), the crop type (the same field function as the ground shader),
// height, wind and fade all run in the vertex shader.

function tuftGeometry() {
  const pos = [], uv = [], idx = [];
  const blades = [0, 2.0];
  const SEG = 2;
  blades.forEach((rot, b) => {
    const c = Math.cos(rot), s = Math.sin(rot);
    const base = pos.length / 3;
    for (let i = 0; i <= SEG; i++) {
      const t = i / SEG;
      const w = 0.02 * (1 - t * t * 0.9);
      const curve = t * t * 0.2;
      for (const sx of [-1, 1]) {
        const x = sx * w, z = curve + b * 0.01;
        pos.push(x * c + z * s + (b - 1) * 0.05, t, -x * s + z * c + (b - 1) * 0.04);
        uv.push(sx < 0 ? 0 : 1, t);
      }
      if (i < SEG) {
        const a = base + i * 2;
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
  });
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

export class Grass {
  constructor(terrain) {
    this.terrain = terrain;
    this.radius = 70;
    this.uniforms = {
      uNearTex: { value: terrain.nearTex },
      uNear: { value: terrain.nearInfo },
      uCamPos: { value: new THREE.Vector3() },
      uTileSize: { value: 140 },
    };
    this.material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0, side: THREE.DoubleSide });
    this.material.defines = { SKIP_WET: '' }; // thin blades turn to mirrors if treated as wet surfaces
    patchMaterial(this.material, 'grass-iads', (shader) => {
      Object.assign(shader.uniforms, this.uniforms);
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          /* glsl */ `
          #include <common>
          attribute vec4 aBlade; // xz offset in tile, rotation, scale
          uniform sampler2D uNearTex;
          uniform vec4 uNear;
          uniform vec3 uCamPos;
          uniform float uTileSize;
          uniform float uTime;
          uniform float uWindStrength;
          varying float vBladeY;
          varying float vVariant;
          varying vec3 vWPos;
          varying vec3 vGrassCol;
          ${noiseGLSL}
          ${fieldGLSL}
          vec2 nearAt(ivec2 i) { return texelFetch(uNearTex, clamp(i, ivec2(0), ivec2(int(uNear.w) - 1)), 0).rg; }
          vec3 groundAt(vec2 xz, out float pad) {
            vec2 g = (xz - uNear.xy) / uNear.z;
            ivec2 i = ivec2(floor(g));
            vec2 f = fract(g);
            vec2 a = nearAt(i), b = nearAt(i + ivec2(1, 0)), c = nearAt(i + ivec2(0, 1)), d = nearAt(i + ivec2(1, 1));
            vec2 m = mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
            pad = m.y;
            vec2 e = vec2(mix(b.x - a.x, d.x - c.x, f.y), mix(c.x - a.x, d.x - b.x, f.x)) / uNear.z;
            return vec3(m.x, e);
          }
          mat3 rotY(float a) { float c = cos(a), s = sin(a); return mat3(c, 0.0, -s, 0.0, 1.0, 0.0, s, 0.0, c); }
          `
        )
        .replace(
          '#include <beginnormal_vertex>',
          /* glsl */ `
          vec3 objectNormal = normalize(mix(rotY(aBlade.z) * normal, vec3(0.0, 1.0, 0.0), 0.6));
          #ifdef USE_TANGENT
            vec3 objectTangent = vec3(tangent.xyz);
          #endif
          `
        )
        .replace(
          '#include <begin_vertex>',
          /* glsl */ `
          vec2 wxz = aBlade.xy + uTileSize * floor((uCamPos.xz - aBlade.xy) / uTileSize + 0.5);
          float pad;
          vec3 gh = groundAt(wxz, pad);
          float groundH = gh.x;

          FieldInfo fi = fieldAt(wxz);
          float k = fi.kind;
          float patchN = fbm2(wxz * 0.035);
          float nFar = fbm2(wxz * 0.0012 + 4.0);
          float nMid = fbm2(wxz * 0.02);
          // blade height by crop: plough bare, stubble short, steppe knee high, wheat tall
          float hgt = k < 0.5 ? 0.62 : k < 1.5 ? 0.85 : k < 2.5 ? 0.0 : k < 3.5 ? 0.14 : k < 4.5 ? 0.7 : 0.34 + 0.2 * patchN;
          hgt *= 0.8 + 0.4 * ihash(fi.i, fi.j, 61);
          float mask = 1.0 - smoothstep(0.3, 0.7, pad);
          mask *= 1.0 - smoothstep(0.2, 0.3, 1.0 - normalize(vec3(-gh.y, 1.0, -gh.z)).y);
          mask *= smoothstep(0.0, 1.5, fi.hedge) ;
          // bare dirt road, flattened sprayer tramlines and tractor tracks
          mask *= smoothstep(1.8, 2.6, f_road(fi, wxz).x);
          if (k != 2.0 && k < 4.5) {
            float tr = (1.0 - smoothstep(0.1, 0.3, f_tramDist(fi))) * smoothstep(7.0, 9.0, fi.eL);
            mask *= 1.0 - 0.8 * tr - 0.5 * f_headland(fi, wxz);
          }
          float camDist = length(wxz - uCamPos.xz);
          float fade = 1.0 - smoothstep(uTileSize * 0.3, uTileSize * 0.49, camDist);
          float scale = aBlade.w * mask * fade * hgt * (0.75 + patchN * 0.6);
          vBladeY = position.y;
          vVariant = fract(aBlade.x * 12.9898 + aBlade.y * 78.233);
          vGrassCol = fieldBaseColor(k, smoothstep(0.35, 0.7, nFar * 0.7 + nMid * 0.5 - 0.1)) * (0.82 + 0.36 * ihash(fi.i, fi.j, 61)) * (1.0 + 0.5 * (vVariant - 0.5));
          vGrassCol *= 1.35;

          vec3 p = rotY(aBlade.z) * position;
          float wide = 1.0 + camDist * 0.03;
          p *= vec3((1.0 + scale * 0.2) * wide, scale, (1.0 + scale * 0.2) * wide);

          vec2 windDir = normalize(vec2(1.0, 0.35));
          float gust = fbm2(wxz * 0.018 - windDir * uTime * (0.35 + uWindStrength * 0.25));
          float flutter = sin(uTime * (3.2 + uWindStrength) + wxz.x * 0.9 + wxz.y * 0.7 + vVariant * 6.28) * 0.1;
          float bend = ((gust * 1.25 - 0.2) * uWindStrength + flutter * sqrt(uWindStrength)) * position.y * position.y;
          p.xz += windDir * bend * (0.15 + scale * 0.5);
          p.y -= abs(bend) * scale * 0.2;

          vec3 world = vec3(wxz.x, groundH - 0.03, wxz.y) + p;
          vWPos = world;
          vec3 transformed = world;
          `
        );
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vBladeY;\nvarying float vVariant;\nvarying vec3 vWPos;\nvarying vec3 vGrassCol;')
        .replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\nnormal = normalize(vNormal);')
        .replace(
          '#include <color_fragment>',
          /* glsl */ `
          #include <color_fragment>
          diffuseColor.rgb *= mix(vGrassCol * 0.28, vGrassCol, smoothstep(0.0, 0.9, vBladeY));
          `
        )
        .replace(
          '#include <emissivemap_fragment>',
          /* glsl */ `
          #include <emissivemap_fragment>
          vec3 viewDirW = normalize(vWPos - cameraPosition);
          float trans = pow(max(dot(viewDirW, uSunDirW), 0.0), 6.0) * vBladeY * worldShadowFactor(vWPos);
          totalEmissiveRadiance += uSunColorN * vGrassCol * 0.35 * trans;
          diffuseColor.rgb *= mix(0.4, 1.0, smoothstep(0.0, 0.45, vBladeY));
          `
        );
    });
    this.geometry = tuftGeometry();
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.receiveShadow = true;
    this.mesh.castShadow = false;
    this.mesh.name = 'grass';
    this.count = 0;
  }

  setCount(count, radius = this.radius) {
    if (count === this.count && radius === this.radius) return;
    this.radius = radius;
    this.uniforms.uTileSize.value = radius * 2;
    const rand = mulberry32(1234);
    const data = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) {
      data[i * 4] = (rand() * 2 - 1) * radius;
      data[i * 4 + 1] = (rand() * 2 - 1) * radius;
      data[i * 4 + 2] = rand() * Math.PI * 2;
      data[i * 4 + 3] = 0.45 + Math.pow(rand(), 1.5) * 0.9;
    }
    this.geometry.setAttribute('aBlade', new THREE.InstancedBufferAttribute(data, 4));
    this.geometry.instanceCount = count;
    this.count = count;
  }

  update(camera) {
    this.uniforms.uCamPos.value.copy(camera.position);
  }
}
