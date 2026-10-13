import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { patchMaterial } from '../../../shaderlib.js';
import { loft, box, V } from './kit.js';

// The attackers' weapons in flight, as flyer models (models/threats.js): `gpbomb`, a US general-purpose
// bomb, and `rp3`, the RAF's 3 in rocket with its 60 lb head. Both are one vertex-coloured mesh; the bomb
// takes its size per instance (threat.lb: 100, 250, 500 or 1000, default 500) and the rocket's motor
// glow shows while it burns (threat.age under motor.burn), with entities.js laying the smoke trail.

const BOMBS = {
  // AN-M30A1, AN-M57A1, AN-M64A1, AN-M65A1: diameter and overall length with the tail (m)
  100: [0.208, 1.03], 250: [0.277, 1.21], 500: [0.361, 1.5], 1000: [0.478, 1.77],
};

const tint = (g, hex) => {
  const c = new THREE.Color(hex), n = g.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) a.set([c.r, c.g, c.b], i * 3);
  g.setAttribute('color', new THREE.Float32BufferAttribute(a, 3));
  return g;
};
const clean = (g) => {
  for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'color') g.deleteAttribute(k);
  g = g.index ? g.toNonIndexed() : g;
  g.computeVertexNormals();
  return g;
};

// the 500 lb bomb, nose forward (-z), centred on its body: body, yellow nose band, box tail fins
function bombGeometry() {
  const parts = [];
  const body = loft([[-0.75, 0.025, 0.025, 0.025, 0, 2], [-0.7, 0.085, 0.085, 0.085, 0, 2], [-0.58, 0.15, 0.15, 0.15, 0, 2], [-0.4, 0.179, 0.179, 0.179, 0, 2], [0.2, 0.179, 0.179, 0.179, 0, 2], [0.42, 0.13, 0.13, 0.13, 0, 2], [0.55, 0.085, 0.085, 0.085, 0, 2]], { n: 14, count: 14 });
  parts.push(tint(clean(body), '#4f5136'));
  parts.push(tint(clean(loft([[-0.53, 0.168, 0.168, 0.168, 0, 2], [-0.47, 0.176, 0.176, 0.176, 0, 2]], { n: 14 })), '#c8a030'));
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
    parts.push(tint(clean(box(0.008, 0.2, 0.32, Math.cos(a) * 0.13, Math.sin(a) * 0.13, 0.6, 0, 0, a - Math.PI / 2)), '#4f5136'));
    // the box strut joining the fin tips
    parts.push(tint(clean(box(0.008, 0.2, 0.12, Math.cos(a + Math.PI / 4) * 0.165, Math.sin(a + Math.PI / 4) * 0.165, 0.68, 0, 0, a + Math.PI / 4 - Math.PI / 2)), '#4f5136'));
  }
  // nose fuze and arming vane
  parts.push(tint(clean(loft([[-0.8, 0.01, 0.01, 0.01, 0, 2], [-0.76, 0.03, 0.03, 0.03, 0, 2], [-0.74, 0.03, 0.03, 0.03, 0, 2]], { n: 8 })), '#5a5a52'));
  parts.push(tint(clean(box(0.09, 0.012, 0.004, 0, 0, -0.78)), '#5a5a52'));
  const g = mergeGeometries(parts);
  g.computeBoundingSphere();
  return g;
}

/** RP-3 with the 60 lb SAP head: the 3.25 in motor tube, 1.40 m, the 6 in head, four square fins. Nose -z. */
export function rp3Geometry() {
  return loft([[-0.95, 0.012, 0.012, 0.012, 0, 2], [-0.88, 0.05, 0.05, 0.05, 0, 2], [-0.78, 0.074, 0.074, 0.074, 0, 2], [-0.6, 0.076, 0.076, 0.076, 0, 2], [-0.52, 0.045, 0.045, 0.045, 0, 2], [-0.5, 0.042, 0.042, 0.042, 0, 2], [0.86, 0.042, 0.042, 0.042, 0, 2], [0.9, 0.036, 0.036, 0.036, 0, 2]], { n: 10, count: 10 });
}
function rocketGeometry() {
  const parts = [];
  const tube = clean(loft([[-0.5, 0.042, 0.042, 0.042, 0, 2], [0.86, 0.042, 0.042, 0.042, 0, 2], [0.9, 0.036, 0.036, 0.036, 0, 2]], { n: 10 }));
  parts.push(tint(tube, '#73775f'));
  parts.push(tint(clean(loft([[-0.95, 0.012, 0.012, 0.012, 0, 2], [-0.88, 0.05, 0.05, 0.05, 0, 2], [-0.78, 0.074, 0.074, 0.074, 0, 2], [-0.6, 0.076, 0.076, 0.076, 0, 2], [-0.52, 0.045, 0.045, 0.045, 0, 2], [-0.49, 0.043, 0.043, 0.043, 0, 2]], { n: 10, count: 8 })), '#3d4232'));
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2;
    parts.push(tint(clean(box(0.006, 0.1, 0.127, Math.cos(a) * 0.092, Math.sin(a) * 0.092, 0.82, 0, 0, a - Math.PI / 2)), '#5b604a'));
  }
  const g = mergeGeometries(parts);
  g.computeBoundingSphere();
  return g;
}

// per-instance aState for these: x scale across, y scale along (the bomb), z the motor burning (the rocket)
const vertexHead = /* glsl */ `
#ifdef USE_INSTANCING
attribute vec4 aState;
#endif
`;
const scaleGLSL = /* glsl */ `
#ifdef USE_INSTANCING
  transformed *= vec3(aState.x, aState.x, aState.y);
#endif
`;

let mats = null;
function materials() {
  if (mats) return mats;
  const body = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.2 });
  patchMaterial(body, 'ww2-ordnance', (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', `#include <common>\n${vertexHead}`).replace('#include <begin_vertex>', `#include <begin_vertex>\n${scaleGLSL}`);
  });
  const depth = new THREE.MeshDepthMaterial();
  patchMaterial(depth, 'ww2-ordnance-depth', (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', `#include <common>\n${vertexHead}`).replace('#include <begin_vertex>', `#include <begin_vertex>\n${scaleGLSL}`);
  });
  // the rocket motor's glow at the nozzle: additive, shown while it burns
  const flame = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.0, 0.55, 0.2).multiplyScalar(2.2), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
  patchMaterial(flame, 'ww2-rp3-flame', (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', `#include <common>\n${vertexHead}`).replace('#include <begin_vertex>', `#include <begin_vertex>
#ifdef USE_INSTANCING
  transformed *= aState.z;
#endif`);
  });
  mats = { body, depth, flame };
  return mats;
}

export function gpbomb() {
  const m = materials();
  const g = bombGeometry();
  return {
    parts: [{ geometry: g, material: m.body, depthMaterial: m.depth }],
    length: 1.5,
    cap: 512,
    state(th, a, o) {
      const [d, L] = BOMBS[th.lb] ?? BOMBS[500];
      a[o] = d / 0.361;
      a[o + 1] = L / 1.5;
      a[o + 2] = 0;
      a[o + 3] = 0;
    },
  };
}

export function rp3() {
  const m = materials();
  const g = rocketGeometry();
  // the flame: a short bright cone and a disc at the nozzle (+z)
  const cone = new THREE.ConeGeometry(0.06, 0.55, 10, 1, true).rotateX(-Math.PI / 2).translate(0, 0, 1.18);
  const glow = new THREE.SphereGeometry(0.07, 10, 6).translate(0, 0, 0.93);
  const flame = mergeGeometries([cone.toNonIndexed(), glow.toNonIndexed()].map((x) => {
    for (const k of Object.keys(x.attributes)) if (k !== 'position' && k !== 'normal') x.deleteAttribute(k);
    return x;
  }));
  flame.computeBoundingSphere();
  return {
    parts: [{ geometry: g, material: m.body, depthMaterial: m.depth }, { geometry: flame, material: m.flame, castShadow: false }],
    length: 1.85,
    cap: 96,
    plume: V(0, 0, 0.92),
    motor: { burn: 1.2, size: 0.45 },
    state(th, a, o) {
      a[o] = 1;
      a[o + 1] = 1;
      a[o + 2] = (th.age ?? 0) < 1.2 ? 1 : 0;
      a[o + 3] = 0;
    },
  };
}
