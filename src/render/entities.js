import * as THREE from 'three';
import { buildThreat, buildInterceptor, THREAT_TYPES, INTERCEPTOR_KINDS, INTERCEPTOR_STAGES, INTERCEPTOR_BOOSTERS } from '../models/threats.js';
import { MISSILES } from '../sim/systems.js';
import { SMOKE } from '../fx.js';

// Everything that flies: one InstancedMesh per part of each threat type and interceptor kind, posed
// from the simulation every frame (orientation from the velocity and the bank), with rotors spinning
// about their pivots, motor plumes and smoke trails through fx, and burning wrecks falling. A bicalibre
// round (57E6, 9M311) drops its booster at burnout: the dart flies on as its next stage, unpowered, and
// the booster tumbles down behind it (a small pool here, drawn with the flyers). The 9M96 pitches over
// on side thrusters just after its motor lights (puffs from fx.thruster).

const CAP = { drone: 96, cruise: 64, atgm: 48, fighter: 32, decoy: 32, arm: 48, glide: 48, helo: 16, tbm: 16 };
const MCAP = 64;
const SPIN = { y: 31, x: 110, z: 160 }; // rad/s, rotor and prop speeds (only the look)
// plume size per interceptor kind, and for the enemy weapons that are seen under power
const PLUME = { '48N6': 1.6, '9M96': 1.1, '57E6': 0.75, '9M33': 0.9, '9M37': 0.55, '9M317': 1.2, '9M338': 0.8, '9M311': 0.7 };
// the S-400's trails hang as a hazy band for minutes (s; fx.motorPlume's `hang`)
const HANG = { '48N6': 150, '9M96': 120 };
// the 9M96's side thrusters: when they fire after the motor lights (s) and where on the body (m ahead of
// the centre)
const THRUST = { '9M96': { at: [0.1, 0.3, 0.55, 0.85], z: -0.6 } };
const MAX_BOOSTERS = 24;
// a type's instances cast shadows only while one of them is this close to the camera: the shadow map
// covers a couple of hundred metres round the view, so a stream of bombers kilometres off would only be
// drawn into it for nothing (the WW2 era's raids are a hundred aircraft and more)
const SHADOW_NEAR = 3000;

const _m = new THREE.Matrix4();
const _big = new THREE.Matrix4();
const _r = new THREE.Matrix4();
const _s = new THREE.Matrix4();
const _x = new THREE.Vector3();
const _y = new THREE.Vector3();
const _z = new THREE.Vector3();
const _p = new THREE.Vector3();
const _q = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

export class Entities {
  constructor(scene) {
    this.groups = new Map();
    this.cam = new THREE.Vector3(); // the camera position, set each frame
    const add = (key, model, cap, shadow) => {
      // a model with `state` (models/threats.js) gets one per-instance aState attribute shared by its parts
      const state = model.state ? new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4).setUsage(THREE.DynamicDrawUsage) : null;
      const parts = model.parts.map((pt) => {
        let geo = pt.geometry;
        // spinning parts are drawn about their pivot
        if (pt.spin) geo = geo.clone().translate(-pt.pivot.x, -pt.pivot.y, -pt.pivot.z);
        if (state) geo.setAttribute('aState', state);
        const mesh = new THREE.InstancedMesh(geo, pt.material, cap);
        mesh.count = 0;
        mesh.frustumCulled = false;
        mesh.castShadow = shadow && pt.castShadow !== false;
        if (pt.depthMaterial) mesh.customDepthMaterial = pt.depthMaterial;
        mesh.receiveShadow = false;
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        scene.add(mesh);
        const plain = new THREE.InstancedBufferAttribute(new Float32Array(cap * 16), 16);
        plain.setUsage(THREE.DynamicDrawUsage);
        return { mesh, spin: pt.spin, pivot: pt.pivot, plain, scaled: null, shadow: mesh.castShadow };
      });
      let radius = 0.5;
      for (const pt of model.parts) {
        pt.geometry.boundingSphere ?? pt.geometry.computeBoundingSphere();
        radius = Math.max(radius, pt.geometry.boundingSphere.radius);
      }
      this.groups.set(key, { parts, model, cap, n: 0, radius, state });
    };
    this.addGroup = add;
    for (const t of THREAT_TYPES) add(t, buildThreat(t), CAP[t] ?? buildThreat(t).cap ?? 32, true);
    for (const k of INTERCEPTOR_KINDS) add(k, buildInterceptor(k), MCAP, false);
    for (const k of Object.values(INTERCEPTOR_STAGES)) add(k, buildInterceptor(k), MCAP, false);
    for (const k of Object.values(INTERCEPTOR_BOOSTERS)) add(k, buildInterceptor(k), MAX_BOOSTERS, true);
    // dropped boosters: { key, pos, vel, fwd, axis, w, roll, age, rest }; rounds already split, and the
    // thruster pulses each 9M96 has fired
    this.boosters = [];
    this.split = new WeakSet();
    this.pulses = new WeakMap();
  }

  // flyers registered since the pools were made (an era's content, models/threats.js registerFlyers)
  sync() {
    for (const t of THREAT_TYPES) if (!this.groups.has(t)) this.addGroup(t, buildThreat(t), CAP[t] ?? buildThreat(t).cap ?? 32, true);
    for (const k of INTERCEPTOR_KINDS) if (!this.groups.has(k)) this.addGroup(k, buildInterceptor(k), MCAP, false);
  }

  // a round's booster drops at burnout: placed where it sat on the round, it keeps most of the round's
  // speed, slows hard (a blunt body), tumbles and falls, trailing a little smoke at first
  dropBooster(m, fx) {
    const key = INTERCEPTOR_BOOSTERS[m.kind], model = buildInterceptor(key);
    if (!model) return;
    if (this.boosters.length >= MAX_BOOSTERS) this.boosters.shift();
    this.basis(m.fwd, 0, _r);
    const pos = model.offset.clone().applyMatrix4(_r).add(m.pos);
    const axis = new THREE.Vector3().crossVectors(m.fwd, UP);
    if (axis.lengthSq() < 1e-6) axis.set(1, 0, 0);
    axis.normalize().applyAxisAngle(m.fwd, (Math.random() - 0.5) * 1.2);
    this.boosters.push({ key, pos, vel: m.vel.clone().multiplyScalar(0.94), fwd: m.fwd.clone(), axis, w: 1.5 + Math.random() * 3, roll: 0, age: 0, rest: false });
    fx.separation(_p.copy(m.fwd).multiplyScalar(-0.2).add(m.pos), m.vel, m.kind === '57E6' ? 1 : 0.8);
  }

  updateBoosters(dt, t, fx) {
    for (let i = this.boosters.length - 1; i >= 0; i--) {
      const b = this.boosters[i];
      b.age += dt;
      if (b.age > 60 || (b.rest && b.age - b.rest > 20)) {
        this.boosters.splice(i, 1);
        continue;
      }
      if (!b.rest && dt > 0) {
        // drag grows with speed (falls to some 45 m/s), gravity, the tumble speeding up as it slows
        const sp = b.vel.length();
        b.vel.multiplyScalar(Math.exp(-(0.15 + 0.0015 * sp) * dt));
        b.vel.y -= 9.8 * dt;
        b.pos.addScaledVector(b.vel, dt);
        b.w = Math.min(9, b.w + dt * 2);
        b.fwd.applyAxisAngle(b.axis, b.w * dt).normalize();
        b.roll += b.w * 0.4 * dt;
        if (b.age < 1.4 && Math.random() < 0.6) fx.trail(b.pos, _q.copy(b.vel).multiplyScalar(0.1), 0);
        const g = fx.ground(b.pos.x, b.pos.z);
        if (b.pos.y < g + 0.1) {
          // down: it lies on its side
          b.pos.y = g + 0.1;
          b.fwd.y = 0;
          if (b.fwd.lengthSq() < 1e-6) b.fwd.set(1, 0, 0);
          b.fwd.normalize();
          b.rest = b.age;
          for (let k = 0; k < 4; k++) fx.addSmoke(SMOKE.PUFF, b.pos.x, b.pos.y + 0.3, b.pos.z, (Math.random() - 0.5) * 3, 1 + Math.random(), (Math.random() - 0.5) * 3, 2 + Math.random() * 2, 0.4, 2.2, 0.42, 0.35, 0.26, 0.5, { drag: 1.5 });
        }
      }
      // in the air it is drawn larger far off, as the flyers; lying on the ground at its true size
      this.place(b.key, b.pos, b.fwd, b.roll, t, 0, !b.rest);
    }
  }

  // the 9M96's side thrusters fire a few pulses just after its motor lights: the gas leaves the body on
  // the side away from the turn it makes toward its target
  thrusters(m, fx) {
    const th = THRUST[m.kind], def = MISSILES[m.kind];
    const n = this.pulses.get(m) ?? 0;
    if (!th || !def || n >= th.at.length || m.phase === 'eject' || m.age < def.eject + th.at[n]) return;
    this.pulses.set(m, n + 1);
    _q.subVectors(m.aim, m.pos).normalize();
    _q.addScaledVector(m.fwd, -_q.dot(m.fwd));
    if (_q.lengthSq() < 1e-6) _q.crossVectors(m.fwd, UP);
    if (_q.lengthSq() < 1e-6) _q.set(1, 0, 0);
    _q.normalize().negate();
    fx.thruster(_p.copy(m.fwd).multiplyScalar(-th.z).add(m.pos), _q, PLUME[m.kind] ?? 1);
  }

  // basis from the forward vector (model -Z) and a bank angle about it
  basis(fwd, bank, out) {
    _z.copy(fwd).negate();
    _x.crossVectors(fwd, UP);
    if (_x.lengthSq() < 1e-6) _x.set(1, 0, 0);
    _x.normalize();
    _y.crossVectors(_x, fwd).normalize();
    if (bank) {
      const c = Math.cos(bank), s = Math.sin(bank);
      const xx = _x.x * c - _y.x * s, xy = _x.y * c - _y.y * s, xz = _x.z * c - _y.z * s;
      _y.set(_y.x * c + _x.x * s, _y.y * c + _x.y * s, _y.z * c + _x.z * s);
      _x.set(xx, xy, xz);
    }
    return out.makeBasis(_x, _y, _z);
  }

  place(key, pos, fwd, bank, t, spin = 0, grow = true) {
    const g = this.groups.get(key);
    if (!g || g.n >= g.cap) return null;
    if (!g.near && this.cam.distanceToSquared(pos) < SHADOW_NEAR * SHADOW_NEAR) g.near = true;
    this.basis(fwd, bank, _r);
    _r.setPosition(pos);
    // far away a flyer is drawn up to a few pixels across (a glint, not a vanishing speck); the sight
    // pictures use the second, unscaled set of matrices (see plain())
    const k = grow ? Math.min(9, (this.cam.distanceTo(pos) * 0.0022) / g.radius) : 1;
    _big.copy(_r);
    if (k > 1) _big.scale(_x.set(k, k, k));
    for (const p of g.parts) {
      if (p.spin) {
        _s.makeRotationAxis(p.spin === 'x' ? _x.set(1, 0, 0) : p.spin === 'y' ? _y.set(0, 1, 0) : _z.set(0, 0, 1), spin * SPIN[p.spin] + t * SPIN[p.spin]);
        _s.setPosition(p.pivot);
        p.mesh.setMatrixAt(g.n, _m.multiplyMatrices(_big, _s));
        _m.multiplyMatrices(_r, _s).toArray(p.plain.array, g.n * 16);
      } else {
        p.mesh.setMatrixAt(g.n, _big);
        _r.toArray(p.plain.array, g.n * 16);
      }
    }
    g.n++;
    return _big;
  }

  /** Draw the true-size instances (for the sight renders, which have their own narrow field of view). */
  plain(on) {
    for (const g of this.groups.values()) {
      for (const p of g.parts) {
        if (on === (p.mesh.instanceMatrix === p.plain)) continue;
        if (on) {
          p.scaled = p.mesh.instanceMatrix;
          p.plain.needsUpdate = true;
          p.mesh.instanceMatrix = p.plain;
        } else p.mesh.instanceMatrix = p.scaled;
      }
    }
  }

  update(sim, t, fx, dt, camPos = null) {
    if (camPos) this.cam.copy(camPos);
    for (const g of this.groups.values()) {
      g.n = 0;
      g.near = false;
    }
    for (const th of sim.threats) {
      if (th.dead || (!th.alive && !th.falling)) continue;
      const M = this.place(th.type, th.pos, th.fwd, th.bank, t, th.id);
      if (!M) continue;
      const g = this.groups.get(th.type), model = g.model;
      if (g.state) model.state(th, g.state.array, (g.n - 1) * 4);
      if (dt === 0) continue;
      if (th.falling) fx.wreck(th.pos, th.vel);
      else if (th.type === 'arm' && th.age < 7) {
        // the radar-seeking missile's motor burns for its first seconds
        _p.copy(this.groups.get('arm').model.plume).applyMatrix4(M);
        fx.motorPlume(_p, th.vel, 0.5);
      } else if (th.type === 'atgm') {
        _p.copy(this.groups.get('atgm').model.plume).applyMatrix4(M);
        fx.motorPlume(_p, th.vel, 0.3);
      } else if (model.motor) {
        // a rocket's motor (model.motor: { burn s, size }) burns for its first seconds
        if (th.age < model.motor.burn) fx.motorPlume(_p.copy(model.plume).applyMatrix4(M), th.vel, model.motor.size);
      } else if (model.smoke && th.hp < th.maxHp * 0.7 && Math.random() < dt * 20) {
        // a damaged aircraft trails smoke from one of its engines (model.smoke: engine points), black and burning when badly hit
        const dmg = 1 - th.hp / th.maxHp;
        fx.trail(_p.copy(model.smoke[th.id % model.smoke.length]).applyMatrix4(M), th.vel, dmg > 0.66 ? 0.75 : 0.3);
      }
    }
    for (const m of sim.missiles) {
      if (!m.alive) continue;
      // a round that drops its booster at burnout flies on as its next stage
      const staged = m.phase === 'coast' && INTERCEPTOR_STAGES[m.kind];
      if (staged && !this.split.has(m)) {
        this.split.add(m);
        if (INTERCEPTOR_BOOSTERS[m.kind]) this.dropBooster(m, fx);
      }
      const key = staged ? INTERCEPTOR_STAGES[m.kind] : m.kind;
      const M = this.place(key, m.pos, m.fwd, 0, t);
      if (!M || !m.motor || dt === 0) continue;
      _p.copy(this.groups.get(key).model.plume).applyMatrix4(M);
      fx.motorPlume(_p, m.vel, PLUME[m.kind] ?? 1, HANG[m.kind] ?? 0);
      if (THRUST[m.kind]) this.thrusters(m, fx);
    }
    this.updateBoosters(dt, t, fx);
    for (const g of this.groups.values()) {
      for (const p of g.parts) {
        p.mesh.count = g.n;
        if (g.n) p.mesh.instanceMatrix.needsUpdate = true;
        p.mesh.castShadow = p.shadow && g.near;
      }
      if (g.state && g.n) g.state.needsUpdate = true;
    }
  }

  counts() {
    let n = 0;
    for (const g of this.groups.values()) n += g.n;
    return n;
  }
}
