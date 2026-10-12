// Mock behaviour for the Buk battery and the Tor in the console harness (ui.html?unit=BUK / ?unit=TOR),
// kept out of mock.js: unit data in the shape sim.describe gives (parts with role, alive, hp, rounds, slots,
// turret, track, target, locked; unit.telars / unit.loader; stock.reloadPart), a part-aware engage,
// track and reload, and a Tor whose turret follows its engagements. `?hurt=1` knocks out TELAR 2 and the CP.
import { DEG } from '../deploy.js';

const ROLE = { 'buk-telar': 'telar', 'buk-loader': 'loader', 'buk-radar': 'radar', 'buk-cp': 'cp' };
const HP = { telar: 110, loader: 80, radar: 130, cp: 90 };
const live = (e) => e.state === 'aligning' || e.state === 'launch' || e.state === 'flying';
const slotsOf = (n, len) => Array.from({ length: len }, (_, i) => i < n);
const wrapPi = (a) => { a = (a + Math.PI) % (2 * Math.PI); if (a < 0) a += 2 * Math.PI; return a - Math.PI; };

export function initBukTor(u, d) {
  const hurt = new URLSearchParams(location.search).get('hurt');
  if (d.kind === 'tor') {
    u.heading = -d.bearing * DEG;
    u.radar.range = 28000;
    u.radar.track = false;
    u.period = 1;
    u.parts = [{ kind: 'tor', role: 'main', alive: true, slots: slotsOf(8, 8), rounds: 8 }];
    u.weapons = { missiles: { type: '9M338', ready: 8, reserve: 12, max: 8, reload: 0 } };
    u.turret = { az: 0, el: 0.2 };
    return;
  }
  u.radar.range = 160000;
  u.period = 4;
  u.parts = d.parts.map((p) => {
    const role = ROLE[p.kind] || 'main';
    const part = { kind: p.kind, role, alive: true, rounds: 0, slots: [], hp: HP[role], maxHp: HP[role] };
    if (role === 'telar') Object.assign(part, { track: false, target: null, locked: false, idle: 0, turret: { az: 0, el: 0.3 }, slots: slotsOf(4, 4), rounds: 4 });
    if (role === 'loader') Object.assign(part, { turret: { az: 0, el: 0.3 }, slots: slotsOf(8, 8), rounds: 4 });
    return part;
  });
  u.telars = u.parts.flatMap((p, i) => (p.role === 'telar' ? [i] : []));
  u.loader = u.parts.findIndex((p) => p.role === 'loader');
  u.parts[u.telars[1]].rounds = 3;
  u.parts[u.telars[1]].slots = slotsOf(3, 4);
  u.weapons = { missiles: { type: '9M317', ready: 11, reserve: 20, max: 12, reload: 0, reloadPart: -1 } };
  u.hp = u.maxHp = u.parts.reduce((a, p) => a + p.maxHp, 0);
  if (hurt) {
    for (const i of [u.telars[1], u.parts.findIndex((p) => p.role === 'cp')]) { u.parts[i].alive = false; u.parts[i].hp = 0; u.parts[i].slots = []; u.parts[i].rounds = 0; }
    u.hp = u.parts.reduce((a, p) => a + p.hp, 0);
    u.weapons.missiles.reload = 14; u.weapons.missiles.reloadPart = u.telars[0]; u.parts[u.telars[0]].rounds = 1; u.parts[u.telars[0]].slots = slotsOf(1, 4);
  }
}

function sync(u) {
  const m = u.weapons.missiles;
  let n = 0;
  for (const i of [...u.telars, u.loader]) { const p = u.parts[i]; if (p.alive) n += p.rounds; }
  m.ready = n;
  for (const i of u.telars) { const p = u.parts[i]; p.slots = slotsOf(p.alive ? p.rounds : 0, 4); }
  const l = u.parts[u.loader];
  l.slots = [...slotsOf(l.alive ? l.rounds : 0, 4), ...slotsOf(l.alive ? Math.min(4, m.reserve) : 0, 4)];
}

export function engageBukTor(world, u, trackId, salvo, part) {
  const m = u.weapons.missiles;
  if (m.ready <= 0 || u.engagements.some((e) => e.trackId === trackId && live(e))) return;
  if (u.kind === 'tor') {
    if (m.reload > 0 || u.engagements.filter(live).length >= 4) return;
    u.radar.track = true;
    u.engagements.push({ trackId, missileIds: [], state: 'aligning', t: 0, salvo: Math.min(salvo || 1, m.ready), type: m.type });
    u.selected = trackId;
    return;
  }
  const busy = new Set(u.engagements.filter(live).map((e) => e.guide));
  const ok = (i) => u.parts[i].alive && !busy.has(i) && u.parts[i].rounds + u.parts[u.loader].rounds > 0 && m.reloadPart !== i;
  const guide = part != null ? (ok(part) ? part : -1) : u.telars.find(ok) ?? -1;
  if (guide < 0) return;
  const p = u.parts[guide];
  p.track = true; p.target = trackId; p.idle = 0;
  u.radar.track = true;
  u.engagements.push({ trackId, missileIds: [], state: 'aligning', t: 0, salvo: Math.min(salvo || 1, m.ready), type: m.type, guide });
  u.selected = trackId;
}

export function commandBukTor(world, u, name, a) {
  if (u.kind === 'tor') return false;
  const m = u.weapons.missiles;
  if (name === 'track') {
    for (const i of a.part != null ? [a.part] : u.telars) {
      const p = u.parts[i];
      if (!p || p.role !== 'telar' || !p.alive) continue;
      p.track = !!a.on;
      if (!a.on) { p.target = null; p.locked = false; }
    }
    u.radar.track = u.telars.some((i) => u.parts[i].track);
    return true;
  }
  if (name === 'reload') {
    if (m.reload > 0) return true;
    const need = (i) => u.parts[i].alive && u.parts[i].rounds < 4;
    const g = a.part != null ? a.part : (u.telars.filter(need).sort((x, y) => u.parts[x].rounds - u.parts[y].rounds)[0] ?? u.loader);
    if (g == null || g < 0 || !u.parts[g].alive || !u.parts[u.loader].alive || m.reserve <= 0 || u.parts[g].rounds >= 4) return true;
    m.reload = 10; m.reloadPart = g;
    return true;
  }
  if (name === 'radar') return false;
  return false;
}

export function stepBukTor(world, u, dt) {
  const m = u.weapons.missiles;
  if (u.kind === 'tor') {
    if (m.reload > 0) {
      m.reload = Math.max(0, m.reload - dt);
      if (m.reload === 0) { const take = Math.min(m.reserve, m.max - m.ready); m.ready += take; m.reserve -= take; }
    }
    const act = u.engagements.filter(live);
    for (const e of act) {
      if (e.state === 'launch' && !e.spent) { e.spent = true; m.ready = Math.max(0, m.ready - 0); }
    }
    u.parts[0].slots = slotsOf(m.ready, 8);
    u.parts[0].rounds = m.ready;
    // the turret turns to the middle of what it engages
    const trs = act.map((e) => u.tracks.find((t) => t.id === e.trackId)).filter(Boolean);
    if (trs.length) {
      let want = 0;
      const ref = wrapPi(-trs[0].bearing * DEG - u.heading);
      for (const t of trs) want += wrapPi(-t.bearing * DEG - u.heading - ref);
      want = ref + want / trs.length;
      u.turret.az = wrapPi(u.turret.az + wrapPi(want - u.turret.az) * Math.min(1, dt * 1.2));
    }
    if (!act.length && u.mode !== 'manual') u.radar.track = u.radar.track && world.time % 20 < 15;
    return;
  }
  // Buk: rounds leave the guiding TELAR (then the loader-launcher), the crane refills one vehicle at a time
  for (const e of u.engagements) {
    if (e.state === 'launch' && !e.spent && e.guide != null) {
      e.spent = true;
      let n = e.salvo;
      for (const i of [e.guide, u.loader]) { const p = u.parts[i]; const k = Math.min(n, p.rounds); p.rounds -= k; n -= k; }
    }
  }
  if (m.reload > 0) {
    m.reload = Math.max(0, m.reload - dt);
    if (m.reload === 0 && m.reloadPart >= 0) {
      const p = u.parts[m.reloadPart];
      const k = Math.min(4 - p.rounds, m.reserve);
      p.rounds += k; m.reserve -= k;
      m.reloadPart = -1;
    }
  }
  for (const i of u.telars) {
    const p = u.parts[i];
    const e = u.engagements.find((x) => live(x) && x.guide === i);
    if (e) { p.target = e.trackId; p.idle = 0; p.locked = p.alive && p.track && e.state !== 'aligning' ? true : p.alive && p.track && e.t > 0.6; }
    else { p.locked = false; p.idle += dt; if (p.target != null && p.idle > 2) p.target = null; }
    if (!p.alive) p.track = false;
    if (e) {
      const t = u.tracks.find((x) => x.id === e.trackId);
      if (t) { p.turret.az = wrapPi(-t.bearing * DEG - u.heading); p.turret.el = Math.max(0.3, Math.min(1.2, Math.atan2(t.alt, t.range))); }
    }
  }
  u.radar.track = u.telars.some((i) => u.parts[i].track);
  // the data link needs the command post; the battery keeps what its radar sees
  sync(u);
  if (u.parts.some((p) => p.role === 'cp' && !p.alive) && !u.alerts.includes('CP DOWN')) u.alerts.push('CP DOWN');
  for (const p of u.parts) if (!p.alive && p.role !== 'cp') { const k = { telar: 'TELAR DOWN', loader: 'LOADER DOWN', radar: 'RADAR DOWN' }[p.role]; if (k && !u.alerts.includes(k)) u.alerts.push(k); }
}
