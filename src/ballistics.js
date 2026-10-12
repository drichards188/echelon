import * as THREE from 'three';

// Shells and tracers, from maxgfx's ballistics.js: quadratic drag and gravity in typed arrays, every
// tracer in one instanced mesh. Here the 30 mm of the Pantsir and the Tunguska and the Shilka's 23 mm
// use it. Game values, tuned for play.
const G = 9.81;

// c: quadratic drag (1/m), v0 muzzle velocity, life: flight time before the round self-destructs,
// dmg: game damage per hit, tracer: hdr colour, every: one round in `every` carries a tracer, spread: the
// guns' dispersion (rad: each component of the bore's random error is within +-spread).
// Drag and life give the public figures' feel, nothing more (DESIGN.md "Simulation fidelity"): the 30 mm
// (Pantsir-S1, Tunguska; effective to about 4 km slant, 3 km up) takes 1.2 s to 1 km, 2.75 s to 2 km,
// 4.7 s to 3 km and 7.2 s to 4 km, and self-destructs at 4.2 to 4.4 km; the old 0.0007 and 5.5 s (from a
// WW2 game) took 4.6 s to 2 km and burnt out at 2.2 km.
export const SHELLS = {
  '30mm': { id: 0, v0: 960, c: 0.00025, life: 8, dmg: 0.15, tracer: [22, 7, 2.2], width: 0.18, tail: 0.03, every: 4, radius: 2.2, spread: 0.005 },
  // lighter, slows sooner and self-destructs earlier (the Shilka; effective to about 2.5 km slant, 1.5 km
  // up): 1.3 s to 1 km, 3.05 s to 2 km, 4.25 s to 2.5 km, gone at 2.7 to 2.9 km
  '23mm': { id: 1, v0: 970, c: 0.00036, life: 5, dmg: 0.14, tracer: [20, 9, 3], width: 0.14, tail: 0.025, every: 3, radius: 1.8, spread: 0.005 },
};
const BY_ID = Object.values(SHELLS);
const NAMES = Object.keys(SHELLS);
export const OWNER = { PLAYER: 0, AI: 1 };

/** Time for a shell of `kind` to cover `dist` metres (straight line, quadratic drag, no gravity). */
export function timeOfFlight(kind, dist, v0 = kind.v0) {
  const c = kind.c;
  const x = Math.min(c * dist, 3);
  return (Math.exp(x) - 1) / (c * v0);
}

/** How far a shell of `kind` gets before it self-destructs (m, straight line, no gravity). */
export const reachOf = (kind) => Math.log(1 + kind.c * kind.v0 * kind.life) / kind.c;

/**
 * How far a shell falls below its line of departure after `t` seconds: gravity under the same quadratic
 * drag (the drag slows the fall too: for the 30 mm about 85 % of the vacuum drop at 2 km, three quarters at 4 km).
 */
export function dropAt(kind, t) {
  const a = kind.c * kind.v0;
  return (G / (2 * a)) * (t + (a * t * t) / 2 - Math.log(1 + a * t) / a);
}

/**
 * Aim point for a target moving at constant velocity (gravity drop included) in `out`, closed form;
 * returns the time of flight. `drop` scales the aim-off for gravity (1, the default, is right).
 */
export function leadPoint(kind, from, tPos, tVel, out, drop = 1) {
  let t = timeOfFlight(kind, from.distanceTo(tPos));
  for (let i = 0; i < 4; i++) {
    out.copy(tPos).addScaledVector(tVel, t);
    t = timeOfFlight(kind, out.distanceTo(from));
  }
  out.y += dropAt(kind, t) * drop;
  return t;
}

const _sd = new THREE.Vector3();

/**
 * The fire control's lead, exact for the game's own shells (maxgfx's solveLead): the closed form's aim
 * point, then a shell flown through the same integrator as Ballistics.update in the sim's order (a
 * shell fired this step moves once before the target moves again), and the aim corrected by its miss at
 * the closest approach until it passes within `tol` metres. The target moves at `tVel` and, optionally,
 * accelerates at `acc`. Writes the aim point to `out`; returns the time of flight, or -1 when the shell
 * self-destructs before it gets there (or cannot catch the target).
 */
export function solveLead(kind, from, tPos, tVel, out, acc = null, dt = 0.05, iterations = 4, tol = 0.3) {
  let tof = leadPoint(kind, from, tPos, tVel, out);
  if (acc) out.addScaledVector(acc, 0.5 * tof * tof);
  const c = kind.c, life = kind.life;
  const ax = acc ? acc.x * 0.5 : 0, ay = acc ? acc.y * 0.5 : 0, az = acc ? acc.z * 0.5 : 0;
  // the round self-destructs after 0.95 to 1.05 of its life
  const steps = Math.floor((life * 0.95) / dt);
  let best = Infinity;
  for (let it = 0; it < iterations; it++) {
    _sd.subVectors(out, from).normalize();
    let px = from.x, py = from.y, pz = from.z;
    let vx = _sd.x * kind.v0, vy = _sd.y * kind.v0, vz = _sd.z * kind.v0;
    let bx = 0, by = 0, bz = 0, bt = -1;
    best = Infinity;
    for (let i = 0; i < steps; i++) {
      // where the hit test sees the target during this step
      const tt = i * dt;
      const qx = tPos.x + (tVel.x + ax * tt) * tt, qy = tPos.y + (tVel.y + ay * tt) * tt, qz = tPos.z + (tVel.z + az * tt) * tt;
      const sp = Math.sqrt(vx * vx + vy * vy + vz * vz);
      const dk = 1 / (1 + c * sp * dt);
      vx *= dk;
      vy = vy * dk - G * dt;
      vz *= dk;
      const sx = vx * dt, sy = vy * dt, sz = vz * dt;
      // the segment's closest approach to it, as in the hit test
      const cx = qx - px, cy = qy - py, cz = qz - pz;
      let f = (cx * sx + cy * sy + cz * sz) / (sx * sx + sy * sy + sz * sz);
      f = f < 0 ? 0 : f > 1 ? 1 : f;
      const dx = cx - sx * f, dy = cy - sy * f, dz = cz - sz * f;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < best) {
        best = d2;
        bx = dx; by = dy; bz = dz;
        bt = tt + f * dt;
      } else if (f === 0) break;
      px += sx; py += sy; pz += sz;
    }
    // still closing when the shell self-destructs: out of its reach
    if (bt >= (steps - 1) * dt) return -1;
    tof = bt;
    if (best < tol * tol) return tof;
    out.x += bx;
    out.y += by;
    out.z += bz;
  }
  // not settled (a target the shells cannot catch): no solution
  return best < 9 ? tof : -1;
}

const MAX = 6000;

export class Ballistics {
  // scene is optional so the simulation runs in Node
  constructor(scene = null) {
    this.n = 0;
    const F = (n = MAX) => new Float32Array(n);
    this.px = F(); this.py = F(); this.pz = F();
    this.vx = F(); this.vy = F(); this.vz = F();
    this.age = F(); this.life = F(); this.kind = F(); this.owner = F(); this.dmg = F(); this.unit = F();
    this.lit = new Uint8Array(MAX);
    this.count = 0;
    this.stats = { fired: 0, hits: 0 };

    const q = new THREE.PlaneGeometry(1, 1);
    const g = new THREE.InstancedBufferGeometry();
    g.index = q.index;
    g.setAttribute('position', q.attributes.position);
    this.aA = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.aB = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.aD = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 4), 4).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('iA', this.aA);
    g.setAttribute('iB', this.aB);
    g.setAttribute('iD', this.aD);
    g.instanceCount = 0;
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uFogDensity: { value: 0.00008 }, uPixel: { value: 0.0016 } },
      vertexShader: /* glsl */ `
        attribute vec4 iA; // head position, width
        attribute vec4 iB; // hdr color, alpha
        attribute vec4 iD; // tail vector
        uniform float uFogDensity;
        uniform float uPixel;
        varying vec4 vCol;
        varying vec2 vQ;
        void main() {
          vec4 p0 = viewMatrix * vec4(iA.xyz, 1.0);
          vec4 p1 = viewMatrix * vec4(iA.xyz - iD.xyz, 1.0);
          // keep both ends in front of the camera
          if (p1.z > -0.2) p1 = mix(p0, p1, (p0.z + 0.2) / max(p0.z - p1.z, 1e-4));
          vec2 axis = p0.xy / -p0.z - p1.xy / -p1.z;
          axis = length(axis) > 1e-7 ? normalize(axis) : vec2(1.0, 0.0);
          vec2 perp = vec2(-axis.y, axis.x);
          vec2 q = position.xy;
          vQ = q * 2.0;
          vec4 p = mix(p1, p0, q.x + 0.5);
          // never thinner than ~1.5 px so distant tracers still read
          float w = max(iA.w, -p.z * uPixel);
          float thin = iA.w / w;
          p.xy += perp * q.y * w + axis * q.x * w;
          gl_Position = projectionMatrix * p;
          vCol = iB * exp(-length(p0.xyz) * uFogDensity);
          vCol.a *= mix(0.35, 1.0, thin) * smoothstep(0.2, 0.6, -p0.z);
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec4 vCol;
        varying vec2 vQ;
        void main() {
          float r = abs(vQ.y);
          float core = exp(-r * r * 9.0);
          float a = (core + exp(-r * 2.5) * 0.25) * smoothstep(1.0, 0.7, abs(vQ.x));
          gl_FragColor = vec4(vCol.rgb * a * vCol.a, 1.0);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 7;
    if (scene) scene.add(this.mesh);
    this._p = new THREE.Vector3();
  }

  /**
   * Fire a shell. dir must be normalised. `unit` is the index of the firing unit, for kill credit.
   * `rng` (default Math.random) varies the self-destruct time; the sim passes its seeded one.
   */
  fire(kindName, pos, dir, owner, unit = 0, { dmg = 1, rng = Math.random } = {}) {
    if (this.n >= MAX) return false;
    const k = SHELLS[kindName];
    const i = this.n++;
    this.px[i] = pos.x; this.py[i] = pos.y; this.pz[i] = pos.z;
    this.vx[i] = dir.x * k.v0;
    this.vy[i] = dir.y * k.v0;
    this.vz[i] = dir.z * k.v0;
    this.age[i] = 0;
    this.life[i] = k.life * (0.95 + rng() * 0.1);
    this.kind[i] = k.id;
    this.owner[i] = owner;
    this.unit[i] = unit;
    this.dmg[i] = dmg * k.dmg;
    this.lit[i] = this.count++ % k.every === 0 ? 1 : 0;
    if (owner === OWNER.PLAYER) this.stats.fired++;
    return true;
  }

  kill(i) {
    const j = --this.n;
    if (i === j) return;
    this.px[i] = this.px[j]; this.py[i] = this.py[j]; this.pz[i] = this.pz[j];
    this.vx[i] = this.vx[j]; this.vy[i] = this.vy[j]; this.vz[i] = this.vz[j];
    this.age[i] = this.age[j]; this.life[i] = this.life[j]; this.kind[i] = this.kind[j];
    this.owner[i] = this.owner[j]; this.dmg[i] = this.dmg[j]; this.lit[i] = this.lit[j]; this.unit[i] = this.unit[j];
  }

  /**
   * ctx: {
   *   targets: [{ pos, radius, alive }],
   *   hit(target, point, kindName, owner, dmg, unit),
   *   groundAt(x, z) -> height, ground(point, kindName),
   *   expire(point, kindName)
   * }
   */
  update(dt, ctx) {
    const targets = ctx.targets;
    const p = this._p;
    for (let i = this.n - 1; i >= 0; i--) {
      const k = BY_ID[this.kind[i]];
      const ox = this.px[i], oy = this.py[i], oz = this.pz[i];
      let vx = this.vx[i], vy = this.vy[i], vz = this.vz[i];
      const sp = Math.sqrt(vx * vx + vy * vy + vz * vz);
      const dk = 1 / (1 + k.c * sp * dt);
      vx *= dk;
      vy = vy * dk - G * dt;
      vz *= dk;
      const nx = ox + vx * dt, ny = oy + vy * dt, nz = oz + vz * dt;
      this.vx[i] = vx; this.vy[i] = vy; this.vz[i] = vz;
      this.px[i] = nx; this.py[i] = ny; this.pz[i] = nz;
      this.age[i] += dt;

      // segment vs bounding spheres
      let dead = false;
      const sx = nx - ox, sy = ny - oy, sz = nz - oz;
      const sl2 = sx * sx + sy * sy + sz * sz;
      const sl = Math.sqrt(sl2);
      for (let j = 0; j < targets.length; j++) {
        const tg = targets[j];
        if (!tg.alive) continue;
        const cx = tg.pos.x - ox, cy = tg.pos.y - oy, cz = tg.pos.z - oz;
        const r = tg.radius + k.radius;
        const reach = r + sl;
        if (cx > reach || cx < -reach || cy > reach || cy < -reach || cz > reach || cz < -reach) continue;
        let t = (cx * sx + cy * sy + cz * sz) / sl2;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const dx = cx - sx * t, dy = cy - sy * t, dz = cz - sz * t;
        if (dx * dx + dy * dy + dz * dz < r * r) {
          p.set(ox + sx * t, oy + sy * t, oz + sz * t);
          ctx.hit(tg, p, NAMES[k.id], this.owner[i], this.dmg[i], this.unit[i]);
          if (this.owner[i] === OWNER.PLAYER) this.stats.hits++;
          dead = true;
          break;
        }
      }
      if (!dead && ny < oy && ctx.groundAt) {
        const gh = ctx.groundAt(nx, nz);
        if (ny < gh) {
          p.set(nx, gh, nz);
          ctx.ground?.(p, NAMES[k.id]);
          dead = true;
        }
      }
      if (!dead && this.age[i] >= this.life[i]) {
        p.set(nx, ny, nz);
        ctx.expire?.(p, NAMES[k.id]);
        dead = true;
      }
      if (dead) this.kill(i);
    }
  }

  // fills the tracer instances; call once per rendered frame
  render() {
    const A = this.aA.array, B = this.aB.array, D = this.aD.array;
    let m = 0;
    for (let i = 0; i < this.n; i++) {
      if (!this.lit[i]) continue;
      const k = BY_ID[this.kind[i]];
      const o = m * 4;
      A[o] = this.px[i];
      A[o + 1] = this.py[i];
      A[o + 2] = this.pz[i];
      A[o + 3] = k.width;
      B[o] = k.tracer[0];
      B[o + 1] = k.tracer[1];
      B[o + 2] = k.tracer[2];
      B[o + 3] = 1 - Math.pow(Math.min(this.age[i] / this.life[i], 1), 6);
      const tail = Math.min(k.tail, this.age[i]);
      D[o] = this.vx[i] * tail;
      D[o + 1] = this.vy[i] * tail;
      D[o + 2] = this.vz[i] * tail;
      m++;
    }
    for (const a of [this.aA, this.aB, this.aD]) {
      a.clearUpdateRanges();
      a.addUpdateRange(0, m * 4);
      a.needsUpdate = true;
    }
    this.mesh.geometry.instanceCount = m;
  }

  clear() {
    this.n = 0;
    this.mesh.geometry.instanceCount = 0;
  }
}
