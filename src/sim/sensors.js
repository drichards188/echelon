import * as THREE from 'three';
import { SYSTEMS, THREATS } from './systems.js';
import { TAU, horizon, bearingRange } from './flight.js';

// Search radars as a game rule: a target shows up when the rotating beam passes its bearing, it is
// inside the set's game range for its size, above the earth-curvature line of sight and not hidden by
// terrain. Tracks coast between sweeps (dead reckoning) and drop after a few missed sweeps.
// The area unit's command post (S-400 or Buk) fuses every emitting unit's tracks into `sim.picture` and
// links them to the rest of the force (source 'link').

const _v = new THREE.Vector3();

export function newTrack(id, now) {
  return {
    id, pos: new THREE.Vector3(), vel: new THREE.Vector3(), cls: 'unknown', iff: 'hostile', quality: 0,
    firstSeen: now, lastSeen: now, range: 0, bearing: 0, alt: 0, speed: 0, tti: Infinity, engagedBy: [], source: 'own',
    held: 0, n: 0, // n: measurements taken (a track nobody has measured yet sits at the origin)
  };
}

export class Sensors {
  constructor(sim) {
    this.sim = sim;
    this.pictureMap = new Map();
  }

  // can `unit` see threat `t` right now with an antenna at height `antenna` and a game range `range`?
  visible(unit, t, range, antenna, low = 1) {
    const def = THREATS[t.type];
    const dx = t.pos.x - unit.pos.x, dz = t.pos.z - unit.pos.z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    const agl = t.pos.y - this.sim.heightAt(t.pos.x, t.pos.z);
    let r = range * (0.35 + 0.65 * def.size);
    if (agl < 60) r *= low;
    if (dist > r) return false;
    if (dist > horizon(antenna + unit.pos.y - this.sim.heightAt(unit.pos.x, unit.pos.z), agl)) return false;
    return this.sim.los(unit.pos.x, unit.pos.y + antenna, unit.pos.z, t.pos.x, t.pos.y, t.pos.z);
  }

  // a fresh measurement of a threat into a track
  measure(unit, tr, t, now, sigmaScale = 1) {
    const dist = unit.pos.distanceTo(t.pos);
    const rng = this.sim.rng;
    const s = (12 + dist * 0.0015) * sigmaScale * (1.2 - tr.quality * 0.7);
    if (tr.quality === 0) tr.vel.copy(t.vel);
    else tr.vel.lerp(t.vel, 0.6);
    tr.pos.set(t.pos.x + (rng() - 0.5) * s, t.pos.y + (rng() - 0.5) * s * 0.5, t.pos.z + (rng() - 0.5) * s);
    tr.quality = Math.min(1, tr.quality + 0.34);
    tr.lastSeen = now;
    tr.source = 'own';
    tr.n++;
  }

  update(dt) {
    const sim = this.sim;
    const now = sim.time;
    for (const u of sim.units) {
      if (!u.alive) {
        u.trackMap.clear();
        continue;
      }
      const sys = SYSTEMS[u.kind];
      const s = sys.search;
      if (s) {
        const prev = u.radar.sweep;
        u.radar.sweep = (prev + (TAU * dt) / s.period) % TAU;
        if (u.radar.search) {
          const swept = (u.radar.sweep - prev + TAU) % TAU;
          for (const t of sim.threats) {
            if (!t.alive) continue;
            const [b] = bearingRange(u.pos.x, u.pos.z, t.pos.x, t.pos.z);
            if ((b - prev + TAU) % TAU > swept) continue;
            if (!this.visible(u, t, s.range, s.height, s.low)) continue;
            let tr = u.trackMap.get(t.id);
            if (!tr) u.trackMap.set(t.id, (tr = newTrack(t.id, now)));
            this.measure(u, tr, t, now);
          }
        }
      }
      // tracking channels refresh their targets continuously; a track the channel starts is measured at
      // once (it would otherwise sit at the origin, and the turret would swing to it)
      for (const id of sim.channelTargets(u)) {
        const t = sim.threatById.get(id);
        if (!t || !t.alive || !sim.channelSees(u, t)) continue;
        let tr = u.trackMap.get(id);
        if (!tr) u.trackMap.set(id, (tr = newTrack(id, now)));
        if (!tr.n || now - tr.lastSeen > 0.25) this.measure(u, tr, t, now, 0.4);
      }
      // coast, age and drop
      const hold = s ? Math.max(s.period * 2.6, 4) : 4;
      for (const [id, tr] of u.trackMap) {
        const t = sim.threatById.get(id);
        if (!t || !t.alive || now - tr.lastSeen > hold) {
          u.trackMap.delete(id);
          continue;
        }
        tr.pos.addScaledVector(tr.vel, dt);
        tr.held += dt;
        if (now - tr.lastSeen > 0.5) tr.quality = Math.max(0, tr.quality - dt / (hold * 1.5));
        this.classify(tr, t, u.pos.distanceTo(t.pos));
      }
    }
    this.fuse(now);
    for (const u of sim.units) this.buildUnitTracks(u, now);
  }

  classify(tr, t, dist) {
    const def = THREATS[t.type];
    if (tr.quality < 0.6) return;
    if (t.type === 'decoy') tr.cls = tr.held > 22 && dist < 70000 ? 'decoy' : 'aircraft';
    else if (tr.held > 3 || def.cls === 'tbm' || def.cls === 'arm') tr.cls = def.cls;
  }

  // the network picture: the best own track of every emitting unit, while the command post stands
  fuse(now) {
    const sim = this.sim;
    const map = this.pictureMap;
    sim.link = sim.linkUp();
    const seen = new Set();
    for (const u of sim.units) {
      if (!u.alive) continue;
      for (const [id, tr] of u.trackMap) {
        if (tr.source !== 'own') continue;
        const best = map.get(id);
        if (seen.has(id) && best.quality >= tr.quality) continue;
        let p = best;
        if (!p) map.set(id, (p = newTrack(id, now)));
        p.pos.copy(tr.pos);
        p.vel.copy(tr.vel);
        p.quality = tr.quality;
        p.lastSeen = tr.lastSeen;
        p.held = Math.max(p.held, tr.held);
        if (tr.cls !== 'unknown' && (p.cls === 'unknown' || tr.cls === 'decoy')) p.cls = tr.cls;
        p.source = 'own';
        p.reporter = u.id;
        seen.add(id);
      }
    }
    for (const id of map.keys()) if (!seen.has(id)) map.delete(id);
    sim.picture.length = 0;
    for (const p of map.values()) {
      this.describe(p, 0, 0, 0, now);
      sim.picture.push(p);
    }
  }

  // range, bearing (degrees), altitude, speed, time to impact and who is engaging, relative to (x, y, z)
  describe(tr, x, y, z, now) {
    const sim = this.sim;
    const dx = tr.pos.x - x, dz = tr.pos.z - z;
    tr.range = Math.sqrt(dx * dx + dz * dz);
    tr.bearing = ((Math.atan2(dx, -dz) * 180) / Math.PI + 360) % 360;
    tr.alt = tr.pos.y - y;
    tr.speed = tr.vel.length();
    const t = sim.threatById.get(tr.id);
    tr.tti = Infinity;
    if (t?.target && tr.speed > 1) {
      _v.subVectors(t.target.pos, tr.pos);
      const closing = -_v.dot(tr.vel) / -_v.length();
      if (closing > 1) tr.tti = _v.length() / closing;
    }
    tr.engagedBy = sim.engagedBy.get(tr.id) ?? EMPTY;
  }

  buildUnitTracks(u, now) {
    const sim = this.sim;
    const list = u.tracks;
    list.length = 0;
    if (!u.alive) return;
    const gy = u.pos.y;
    for (const tr of u.trackMap.values()) {
      this.describe(tr, u.pos.x, gy, u.pos.z, now);
      list.push(tr);
    }
    if (!sim.link) {
      u.linkMap.clear();
      return;
    }
    for (const p of sim.picture) {
      if (u.trackMap.has(p.id)) continue;
      let tr = u.linkMap.get(p.id);
      if (!tr) u.linkMap.set(p.id, (tr = newTrack(p.id, now)));
      tr.pos.copy(p.pos);
      tr.vel.copy(p.vel);
      tr.cls = p.cls;
      tr.quality = p.quality * 0.8;
      tr.lastSeen = p.lastSeen;
      tr.held = p.held;
      tr.source = 'link';
      this.describe(tr, u.pos.x, gy, u.pos.z, now);
      list.push(tr);
    }
    for (const id of u.linkMap.keys()) if (!sim.picture.some((p) => p.id === id) || u.trackMap.has(id)) u.linkMap.delete(id);
  }
}

const EMPTY = Object.freeze([]);
