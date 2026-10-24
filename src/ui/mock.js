// Mock world for the console UI (ui.html): units from deploy.js with ammunition and radars, a few dozen
// tracks of every class flying in from the west-southwest, engagements that spend missiles, an ARM alert,
// a synthetic sky for the sights, and a command handler so every switch does something.
import './mockloadout.js';
import { UNITS, DEG, bearingOf } from '../deploy.js';
import { aimTo, sightFov } from './sightview.js';
import { Panel } from './panel.js';
import { initBukTor, engageBukTor, commandBukTor, stepBukTor } from './mockbuktor.js';

const TAU = Math.PI * 2;
const rnd = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

const GUN_KINDS = new Set(['pantsir', 'tunguska', 'shilka', 'gepard']);
const SPEC = {
  aircraft: { n: 8, speed: [220, 290], alt: [5000, 9000], dist: [20000, 200000] },
  cruise: { n: 8, speed: [220, 250], alt: [35, 70], dist: [10000, 120000] },
  drone: { n: 8, speed: [40, 60], alt: [150, 500], dist: [3000, 35000] },
  arm: { n: 3, speed: [600, 700], alt: [3000, 3000], dist: [20000, 60000] },
  tbm: { n: 1, speed: [1700, 1900], alt: [40000, 40000], dist: [100000, 250000] },
  helo: { n: 3, speed: [60, 80], alt: [25, 40], dist: [3000, 25000] },
  bomb: { n: 2, speed: [260, 300], alt: [4000, 6000], dist: [15000, 50000] },
  unknown: { n: 3, speed: [180, 230], alt: [3000, 8000], dist: [30000, 100000] },
};

export function createAudioLog() {
  const log = { ui: {}, seeker: 0, seekerLevel: 0, locked: false };
  window.__audio = log;
  return {
    ui: (n) => { log.ui[n] = (log.ui[n] || 0) + 1; },
    seeker: (l, locked) => { log.seeker++; log.seekerLevel = l; log.locked = locked; },
  };
}

export class MockWorld {
  constructor() {
    this.time = 0;
    this.nextId = 17;
    this.units = UNITS.map((d) => this.makeUnit(d));
    this.threats = [];
    for (const [cls, s] of Object.entries(SPEC)) for (let i = 0; i < s.n; i++) this.threats.push(this.spawn(cls, true));
    // two orbiters near the Strela so its sight has something to find
    const str = this.units.find((u) => u.id === 'STR') || this.units[this.units.length - 1];
    this.threats.push(this.orbiter('helo', str, 3200, 220, 38, 0.012));
    this.threats.push(this.orbiter('drone', str, 4300, 380, 55, -0.01));
    this.picture = [];
    this.selectedId = 'S400';
    this.state = 'raid';
    this.wave = { n: 3, title: 'SEAD strike' };
    this.score = 1240;
  }

  makeUnit(d) {
    const u = {
      id: d.id, kind: d.kind, name: d.name, callsign: d.callsign,
      pos: { x: d.x, y: 0, z: d.z }, heading: d.bearing, parts: [], hp: 100, maxHp: 100, alive: true, mode: 'auto',
      radar: { search: d.kind !== 'strela', track: false, sweep: Math.random() * TAU, range: 0 },
      tracks: [], selected: null, engagements: [], status: 'READY', alerts: [],
      weapons: {}, turret: { az: 0, el: 0 }, sight: null, erect: null, cool: 0,
    };
    if (d.kind === 's400') {
      u.radar.range = 250000;
      u.period = 6;
      u.weapons = { types: ['48N6', '9M96'], type: '48N6', missiles: { '48N6': { type: '48N6', ready: 8, reserve: 16, max: 12, reload: 0 }, '9M96': { type: '9M96', ready: 4, reserve: 20, max: 12, reload: 0 } } };
      u.erect = [0, 0, 0];
      u.hp = 86;
    } else if (d.kind === 'pantsir') {
      u.radar.range = 36000;
      u.radar.track = true;
      u.period = 2.4;
      u.weapons = { missiles: { type: '57E6', ready: 12, reserve: 12, max: 12, reload: 0 }, gun: { rounds: 1400, max: 1400, firing: false, heat: 0 }, weapon: 'missile' };
      u.sight = { az: 250 * DEG, el: 0.1, fov: 0.07, uncaged: true, lock: 0, tone: 0 };
      if (d.id === 'P2') u.hp = 42;
    } else if (d.kind === 'tunguska') {
      u.radar.range = 24000;
      u.radar.track = true;
      u.period = 1;
      u.weapons = { missiles: { type: '9M311', ready: 8, reserve: 24, max: 8, reload: 0 }, gun: { rounds: 2400, max: 2400, firing: false, heat: 0, aimOk: false, aim: { x: 0, y: 0, z: 0 } }, weapon: 'gun' };
      u.sight = { az: 250 * DEG, el: 0.1, fov: 0.07, uncaged: true, lock: 0, tone: 0, src: 'radar' };
      u.hp = 100;
    } else if (d.kind === 'shilka') {
      u.radar.range = 14000;
      u.radar.track = true;
      u.period = 1;
      u.weapons = { missiles: null, gun: { rounds: 2400, max: 2400, firing: false, heat: 0, aimOk: false, aim: { x: 0, y: 0, z: 0 } }, weapon: 'gun' };
      u.sight = { az: 250 * DEG, el: 0.1, fov: 0.07, uncaged: true, lock: 0, tone: 0, src: 'radar' };
    } else if (d.kind === 'gepard') {
      u.radar.range = 15000;
      u.radar.track = true;
      u.period = 1;
      u.weapons = { missiles: null, gun: { rounds: 640, max: 640, firing: false, heat: 0, aimOk: false, aim: { x: 0, y: 0, z: 0 } }, weapon: 'gun' };
      u.sight = { az: 250 * DEG, el: 0.1, fov: 0.07, uncaged: true, lock: 0, tone: 0, src: 'radar' };
    } else if (d.kind === 'buk' || d.kind === 'tor') {
      initBukTor(u, d);
    } else if (d.kind === 'osa') {
      u.radar.range = 30000;
      u.radar.track = true;
      u.period = 1.6;
      u.weapons = { missiles: { type: '9M33M3', ready: 4, reserve: 6, max: 6, reload: 0 } };
    } else if (d.kind === 'strela') {
      u.radar = { search: false, track: false, sweep: 0, range: 0 };
      u.weapons = { missiles: { type: '9M37M', ready: 4, reserve: 4, max: 4, reload: 0 } };
      u.sight = { az: 285 * DEG, el: 0.02, fov: 0.12, uncaged: false, lock: 0, tone: 0 };
      u.mode = 'manual';
      u.lockT = 0;
    }
    return u;
  }

  spawn(cls, anywhere) {
    const s = SPEC[cls];
    const dist = anywhere ? rnd(s.dist[0], s.dist[1]) : rnd(Math.max(s.dist[1] * 0.7, s.dist[0]), s.dist[1]);
    const b = (250 + rnd(-38, 38)) * DEG;
    const x = Math.sin(b) * dist, z = -Math.cos(b) * dist;
    const th = {
      id: this.nextId++, cls: cls === 'unknown' ? 'aircraft' : cls, decoy: cls === 'unknown', iff: cls === 'unknown' ? 'unknown' : 'hostile',
      pos: { x, y: rnd(s.alt[0], s.alt[1]), z }, vel: { x: 0, y: 0, z: 0 }, speed: rnd(s.speed[0], s.speed[1]), alt0: 0, base: cls,
      aim: { x: rnd(-600, 600), z: rnd(-600, 600) }, quality: rnd(0.55, 1), firstSeen: this.time, hp: 1,
    };
    th.alt0 = th.pos.y;
    return th;
  }

  orbiter(cls, unit, r, alt, speed, w) {
    const th = this.spawn(cls, true);
    th.orbit = { cx: unit.pos.x, cz: unit.pos.z, r, a: Math.random() * TAU, w };
    th.pos.y = alt;
    th.speed = speed;
    return th;
  }

  move(dt) {
    for (const th of this.threats) {
      if (th.orbit) {
        const o = th.orbit;
        o.a += o.w * dt;
        const nx = o.cx + Math.cos(o.a) * o.r, nz = o.cz + Math.sin(o.a) * o.r;
        th.vel.x = (nx - th.pos.x) / Math.max(dt, 1e-3); th.vel.z = (nz - th.pos.z) / Math.max(dt, 1e-3); th.vel.y = 0;
        if (dt > 0) { th.pos.x = nx; th.pos.z = nz; }
        continue;
      }
      const dx = th.aim.x - th.pos.x, dz = th.aim.z - th.pos.z;
      const d = Math.hypot(dx, dz);
      if (d < 700) { Object.assign(th, this.spawn(th.decoy ? 'unknown' : th.base, false), { id: th.id }); continue; }
      th.vel.x = (dx / d) * th.speed;
      th.vel.z = (dz / d) * th.speed;
      // shaped descents for the weapons that dive
      const alt = th.base === 'tbm' ? Math.min(th.alt0, d * 0.35) : th.base === 'arm' ? Math.min(3000, d * 0.12 + 60) : th.base === 'bomb' ? Math.min(th.alt0, d * 0.3 + 50) : th.alt0;
      th.vel.y = (alt - th.pos.y) / Math.max(dt, 1 / 60);
      th.pos.x += th.vel.x * dt;
      th.pos.z += th.vel.z * dt;
      th.pos.y = alt;
    }
  }

  horizon(u, th) {
    const lim = u.kind === 's400' ? 250000 : u.radar.range;
    return Math.min(lim, 4120 * (Math.sqrt(Math.max(th.pos.y, 1)) + Math.sqrt(8)));
  }

  makeTrack(th, ox, oz, own) {
    const dx = th.pos.x - ox, dz = th.pos.z - oz;
    const hr = Math.hypot(dx, dz);
    const rng = Math.hypot(hr, th.pos.y);
    // time to impact on the airbase aim point
    const ax = th.aim.x - th.pos.x, az = th.aim.z - th.pos.z;
    const ad = Math.hypot(ax, az);
    return {
      id: th.id, pos: th.pos, vel: th.vel, cls: th.cls, iff: th.iff, quality: th.quality, firstSeen: th.firstSeen, lastSeen: this.time,
      range: rng, bearing: bearingOf(dx, dz), alt: th.pos.y, speed: Math.hypot(th.vel.x, th.vel.y, th.vel.z),
      tti: th.orbit ? null : ad / Math.max(th.speed, 1), engagedBy: [], source: own ? 'own' : 'link',
    };
  }

  update(dt) {
    this.time += dt;
    this.move(dt);
    const eng = new Map();
    for (const u of this.units) for (const e of u.engagements) {
      if (!eng.has(e.trackId)) eng.set(e.trackId, []);
      eng.get(e.trackId).push(u.id);
    }
    this.picture = this.threats.filter((th) => Math.hypot(th.pos.x, th.pos.z) < 250000).map((th) => {
      const t = this.makeTrack(th, 0, 0, false);
      t.engagedBy = eng.get(th.id) || [];
      return t;
    });
    for (const u of this.units) this.updateUnit(u, dt, eng);
    this.drawAll();
  }

  weaponOf(u) {
    const m = u.weapons.missiles;
    return u.kind === 's400' ? m[u.weapons.type] : m;
  }

  updateUnit(u, dt, eng) {
    if (!u.alive) return;
    const hasRadar = u.kind !== 'strela';
    if (hasRadar && u.radar.search) {
      u.radar.sweep = (u.radar.sweep + (TAU * dt) / u.period) % TAU;
      u.tracks = this.threats.filter((th) => {
        const r = Math.hypot(th.pos.x - u.pos.x, th.pos.z - u.pos.z, th.pos.y);
        return r < this.horizon(u, th);
      }).map((th) => {
        const t = this.makeTrack(th, u.pos.x, u.pos.z, true);
        t.engagedBy = eng.get(th.id) || [];
        return t;
      });
    }
    if (u.selected != null && !this.threats.some((th) => th.id === u.selected)) u.selected = null;
    // radiation alarm: an ARM within 70 km of an emitting set
    const arm = hasRadar && u.radar.search && u.tracks.some((t) => t.cls === 'arm' && t.range < 70000);
    u.alerts = arm ? ['ARM INBOUND'] : [];
    const m = this.weaponOf(u);
    if (GUN_KINDS.has(u.kind) && u.weapons.gun.rounds <= 0) u.alerts.push('LOW AMMO');
    if (m && m.reload > 0 && u.kind !== 'buk' && u.kind !== 'tor') {
      m.reload = Math.max(0, m.reload - dt);
      if (m.reload === 0) { const take = Math.min(m.reserve, m.max - m.ready); m.ready += take; m.reserve -= take; }
    }
    u.status = u.mode === 'hold' ? 'HOLD FIRE' : u.radar.search || !hasRadar ? 'READY' : 'RADAR SILENT';
    // engagements
    for (const e of u.engagements) {
      e.t += dt;
      const th = this.threats.find((x) => x.id === e.trackId);
      if (e.state === 'aligning' && e.t > 1.2) {
        e.state = 'launch'; e.t = 0;
        if (m) m.ready = Math.max(0, m.ready - e.salvo);
        e.fly = th ? clamp(Math.hypot(th.pos.x - u.pos.x, th.pos.z - u.pos.z) / (u.kind === 's400' ? 1200 : 500), 2, 14) : 3;
        if (u.kind === 'strela') e.fly = 3;
      } else if (e.state === 'launch' && e.t > 0.5) { e.state = 'flying'; e.t = 0; }
      else if (e.state === 'flying' && e.t > e.fly) {
        e.state = th && Math.random() < 0.7 ? 'kill' : 'miss'; e.t = 0;
        if (e.state === 'kill' && th) { this.score += 50; Object.assign(th, this.spawn(th.base === 'bomb' && th.orbit ? 'bomb' : th.base, false), { id: th.id }); th.orbit = th.orbit; }
      } else if ((e.state === 'kill' || e.state === 'miss') && e.t > 1.5) e.done = true;
    }
    u.engagements = u.engagements.filter((e) => !e.done);
    if (u.kind === 's400') {
      const active = u.engagements.length > 0;
      for (let i = 0; i < 3; i++) u.erect[i] = clamp(u.erect[i] + (active || u.mode === 'auto' && u.tracks.length ? 0.25 : -0.1) * dt * (1 + i * 0.1), 0, 1);
    }
    if (u.kind === 'buk' || u.kind === 'tor') stepBukTor(this, u, dt);
    this.autoFire(u, dt);
    if (GUN_KINDS.has(u.kind)) this.pantsirGuns(u, dt);
    if (GUN_KINDS.has(u.kind)) this.pantsirSight(u, dt);
    if (u.kind === 'strela') this.strela(u, dt);
  }

  engage(u, trackId, salvo, part) {
    if (u.kind === 'buk' || u.kind === 'tor') { engageBukTor(this, u, trackId, salvo, part); return; }
    const m = this.weaponOf(u);
    if (!m || m.ready <= 0 || m.reload > 0 || u.engagements.some((e) => e.trackId === trackId && e.state !== 'miss')) return;
    if (u.kind === 'osa' && !u.radar.track) return;
    u.engagements.push({ trackId, missileIds: [], state: 'aligning', t: 0, salvo: Math.min(salvo || 1, m.ready) });
    u.selected = trackId;
  }

  autoFire(u, dt) {
    if (u.mode !== 'auto' || u.kind === 'strela') return;
    u.cool -= dt;
    if (u.cool > 0 || !u.radar.search) return;
    const env = { s400: 150000, pantsir: 14000, osa: 9000, buk: 70000, tor: 12000 }[u.kind];
    const cand = u.tracks.filter((t) => t.range < env && t.cls !== 'bomb' && !t.engagedBy.length).sort((a, b) => (a.tti || 1e9) - (b.tti || 1e9))[0];
    if (cand && (u.kind !== 'osa' || u.radar.track)) {
      this.engage(u, cand.id, 1);
      u.cool = 5 + Math.random() * 3;
    }
  }

  pantsirGuns(u, dt) {
    const g = u.weapons.gun;
    const t = u.tracks.find((x) => x.id === u.selected);
    const auto = u.mode === 'auto' && u.weapons.weapon === 'gun' && t && t.range < (u.kind === 'shilka' ? 1400 : u.kind === 'gepard' ? 3500 : 3800);
    if (auto) g.firing = true; else if (u.mode === 'auto' && !this.trigger) g.firing = !!(u.trig);
    if (g.firing && g.rounds > 0) {
      const n = 80 * dt;
      g.rounds = Math.max(0, g.rounds - n);
      g.heat = clamp(g.heat + 0.12 * dt, 0, 1);
      if (t && t.range < 4000 && Math.random() < 0.5 * dt) {
        const th = this.threats.find((x) => x.id === t.id);
        if (th) { Object.assign(th, this.spawn(th.base, false), { id: th.id }); this.score += 50; }
      }
    } else g.heat = clamp(g.heat - 0.05 * dt, 0, 1);
    g.rounds = Math.round(g.rounds * 10) / 10;
    // lead point for the sight overlay: ahead of the target along its velocity
    g.aimOk = !!t && (u.radar.track || u.sight.src === 'eo');
    if (t && g.aimOk) {
      const tt = t.range / 900;
      g.aim = { x: t.pos.x + t.vel.x * tt, y: t.pos.y + t.vel.y * tt, z: t.pos.z + t.vel.z * tt };
    }
  }

  pantsirSight(u, dt) {
    const s = u.sight;
    const t = u.tracks.find((x) => x.id === u.selected);
    if (t && u.mode !== 'manual' && u.radar.track) {
      const a = aimTo(u, t.pos);
      const dAz = ((a.az - s.az + Math.PI * 3) % TAU) - Math.PI;
      const dEl = a.el - s.el;
      const k = clamp(dt * 3, 0, 1);
      s.az += dAz * k; s.el += dEl * k;
      s.lock = Math.hypot(dAz, dEl) < 0.004 ? Math.min(1, s.lock + dt) : Math.max(0, s.lock - dt);
    } else s.lock = Math.max(0, s.lock - dt);
  }

  strela(u, dt) {
    const s = u.sight;
    let best = null, bo = 1e9;
    for (const th of this.threats) {
      const a = aimTo(u, th.pos);
      const dAz = ((a.az - s.az + Math.PI * 3) % TAU) - Math.PI;
      const off = Math.hypot(dAz * Math.cos(a.el), a.el - s.el);
      if (off < bo && a.range < 6500) { bo = off; best = th; }
    }
    let tone = 0;
    if (s.uncaged && best) tone = clamp(1 - bo / (3.5 * DEG), 0, 1);
    s.tone = s.tone + (tone - s.tone) * clamp(dt * 6, 0, 1);
    u.lockT = s.uncaged && tone > 0.7 ? u.lockT + dt : Math.max(0, u.lockT - dt * 2);
    s.lock = clamp((u.lockT - 0.6) / 0.8, 0, 1);
    u.lockTarget = s.lock > 0.8 && best ? best.id : null;
    u.selected = u.lockTarget || u.selected;
  }

  command(id, name, a) {
    const u = this.units.find((x) => x.id === id);
    if (!u) return;
    const m = this.weaponOf(u);
    if ((u.kind === 'buk' || u.kind === 'tor') && commandBukTor(this, u, name, a)) return;
    switch (name) {
      case 'radar': u.radar.search = !!a.on; if (!a.on) u.engagements = u.engagements.filter((e) => e.state !== 'aligning'); break;
      case 'track': u.radar.track = !!a.on; break;
      case 'mode': u.mode = a.mode; break;
      case 'select': u.selected = a.trackId; break;
      case 'engage': this.engage(u, a.trackId, a.salvo, a.part); break;
      case 'cease': u.engagements = u.engagements.filter((e) => e.trackId !== a.trackId); break;
      case 'missileType': if (u.kind === 's400') u.weapons.type = a.type; break;
      case 'reload': if (m && m.reload <= 0 && m.ready < m.max && m.reserve > 0) m.reload = 8; break;
      case 'weapon': u.weapons.weapon = a.weapon; break;
      case 'trigger': u.trig = !!a.down; u.weapons.gun.firing = !!a.down && u.weapons.gun.rounds > 0; break;
      case 'trackSource': u.sight.src = a.source; break;
      case 'slew': if (u.sight) { u.sight.az += a.daz; u.sight.el = clamp(u.sight.el + a.del, -0.05, 1.4); } break;
      case 'uncage': u.sight.uncaged = !!a.on; break;
      case 'fire':
        if (u.kind === 'strela' && u.sight.lock > 0.8 && m.ready > 0 && u.lockTarget != null) {
          m.ready--; u.lockT = 0; u.sight.lock = 0;
          u.engagements.push({ trackId: u.lockTarget, missileIds: [], state: 'flying', t: 0, fly: 3, salvo: 1 });
        }
        break;
      default: break;
    }
  }

  // ---------- synthetic sight image ----------
  drawAll() {
    this.sightT = (this.sightT || 0) + 1;
    if (this.sightT % 4) return;
    for (const u of this.units) if (u.sight && this.canvases && this.canvases[u.id]) this.drawSight(u, this.canvases[u.id]);
  }

  drawSight(u, cv) {
    const c = cv.getContext('2d');
    const W = cv.width, H = cv.height;
    const s = u.sight, fov = sightFov(s), fovV = fov * (H / W);
    const hy = H / 2 + (s.el / fovV) * H; // horizon line
    const g = c.createLinearGradient(0, Math.min(hy, H), 0, Math.min(Math.max(hy - 260, 0), H));
    g.addColorStop(0, '#c6d6e4'); g.addColorStop(1, '#4f7eb4');
    c.fillStyle = '#4f7eb4'; c.fillRect(0, 0, W, H);
    c.fillStyle = g; c.fillRect(0, 0, W, Math.max(0, hy));
    const gg = c.createLinearGradient(0, hy, 0, hy + 200);
    gg.addColorStop(0, '#6e7b4c'); gg.addColorStop(1, '#2f3a1f');
    c.fillStyle = gg; c.fillRect(0, hy, W, H - hy);
    // field strips and tree line scrolling with azimuth
    const ppr = W / fov;
    for (let i = -40; i < 40; i++) {
      const a = Math.floor((s.az * 40) / TAU * 8) + i;
      const wx = W / 2 + ((a / 8 / 40) * TAU - s.az) * ppr;
      if (wx < -80 || wx > W + 80) continue;
      const hsh = Math.abs(Math.sin(a * 12.9898) * 43758.5453) % 1;
      c.fillStyle = hsh > 0.5 ? '#3d5226' : '#8b8f55';
      c.fillRect(wx, hy, 70 * (0.4 + hsh), Math.max(2, 14 + hsh * 30));
    }
    // clouds
    for (let i = 0; i < 14; i++) {
      const ca = (i / 14) * TAU + 0.3, ce = 0.05 + (i % 5) * 0.09;
      const x = W / 2 + (((ca - s.az + Math.PI * 3) % TAU) - Math.PI) * ppr;
      const y = H / 2 - ((ce - s.el) / fovV) * H;
      if (x < -200 || x > W + 200) continue;
      c.fillStyle = 'rgba(255,255,255,0.55)';
      for (let k = 0; k < 5; k++) { c.beginPath(); c.ellipse(x + k * 34 - 70, y + (k % 2) * 6, 56 * 1.3, 18 * 1.3, 0, 0, TAU); c.fill(); }
    }
    // threats: dark silhouettes against sky with hot spot for the engine
    for (const th of this.threats) {
      const a = aimTo(u, th.pos);
      const dAz = ((a.az - s.az + Math.PI * 3) % TAU) - Math.PI;
      const x = W / 2 + (dAz / fov) * W, y = H / 2 - ((a.el - s.el) / fovV) * H;
      if (x < -30 || x > W + 30 || y < -30 || y > H + 30) continue;
      const sz = clamp(9000 / a.range, 1.5, 22) * (th.cls === 'cruise' ? 0.7 : 1);
      c.fillStyle = 'rgba(20,24,30,0.9)';
      c.fillRect(x - sz, y - sz * 0.25, sz * 2, sz * 0.5);
      c.fillRect(x - sz * 0.25, y - sz * 0.7, sz * 0.5, sz * 1.4);
      const rg = c.createRadialGradient(x, y, 0, x, y, sz * 1.4);
      rg.addColorStop(0, 'rgba(255,220,150,0.95)'); rg.addColorStop(1, 'rgba(255,180,80,0)');
      c.fillStyle = rg; c.fillRect(x - sz * 2, y - sz * 2, sz * 4, sz * 4);
    }
  }
}

export function startMock() {
  const world = new MockWorld();
  const audio = createAudioLog();
  const panelEl = document.getElementById('panel');
  const log = [];
  const panel = new Panel(panelEl, {
    audio,
    onSelect: (id) => { world.selectedId = id; log.push(['select', id]); },
    onCommand: (id, name, args) => { log.push([id, name, args]); world.command(id, name, args); },
  });
  world.canvases = {};
  for (const u of UNITS) { const c = panel.sightCanvas(u.id); if (c) world.canvases[u.id] = c; }
  const q = new URLSearchParams(location.search);
  if (q.get('unit')) world.selectedId = q.get('unit');
  window.__panel = panel;
  window.__mock = world;
  window.__cmdlog = log;
  const view = document.getElementById('view');
  let last = performance.now();
  const frame = (now) => {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    world.update(dt);
    panel.update(dt, {
      time: world.time, units: world.units, picture: world.picture, selectedId: world.selectedId,
      state: world.state, wave: world.wave, score: world.score, assets: [],
    });
    if (view) view.dataset.sel = world.selectedId;
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  window.addEventListener('keydown', (e) => {
    const n = Number(e.key);
    if (n >= 1 && n <= UNITS.length && !e.ctrlKey) { world.selectedId = UNITS[n - 1].id; }
  });
}
