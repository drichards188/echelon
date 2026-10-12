// Pieces every console shares: the unit header (name, status, health, alerts) and small data helpers.
import { SYSTEMS } from '../../sim/systems.js';
import { el, setText, setCls, Bar, Lamp, label, fmtKm, fmtAlt, fmtTti } from '../widgets.js';

// Every alert the sim raises (units.js describe) with its cabin caption, a plain English meaning and a rank.
const ALERTS = {
  'ARM INBOUND': ['ПРР НА ПОДЛЁТЕ', 'ANTI-RADAR MISSILE: RADAR OFF!', 0],
  'ATGM INBOUND': ['ПТУР НА ПОДЛЁТЕ', 'GUIDED MISSILE AT THIS UNIT', 0],
  'INBOUND': ['ЦЕЛЬ БЛИЗКО', 'ENEMY CLOSING ON THIS UNIT', 1],
  'NO MISSILES': ['НЕТ РАКЕТ', 'NO MISSILES READY', 1],
  'OVERHEAT': ['ПЕРЕГРЕВ', 'GUNS OVERHEATED, WAIT', 1],
  'DAMAGED': ['ПОВРЕЖДЕНИЕ', 'UNIT BELOW HALF HEALTH', 2],
  'LOW AMMO': ['МАЛО БК', 'LOW AMMUNITION, RELOAD', 2],
  'NO LINK': ['НЕТ СВЯЗИ', 'NO DATA LINK TO S-400', 3],
  'GLIDE BOMB': ['УПАБ НА ПОДЛЁТЕ', 'GLIDE BOMB INBOUND', 0],
  'ATGM LAUNCH': ['ПУСК ПТУР', 'ATGM LAUNCHED', 0],
  'BALLISTIC': ['БАЛЛИСТИКА', 'BALLISTIC MISSILE', 0],
  'RADAR OFF': ['РЛС ВЫКЛ', 'RADAR OFF', 3],
  // a dispersed battery's vehicles knocked out (Buk; a standing state, ranked as DAMAGED): СОУ the TELAR,
  // ПЗУ the loader-launcher, СОЦ the search radar, КП the command post
  'TELAR DOWN': ['СОУ ПОРАЖЕНА', 'A TELAR IS KNOCKED OUT', 2],
  'LOADER DOWN': ['ПЗУ ПОРАЖЕНА', 'LOADER-LAUNCHER KNOCKED OUT', 2],
  'RADAR DOWN': ['СОЦ ПОРАЖЕНА', 'SEARCH RADAR KNOCKED OUT', 2],
  'CP DOWN': ['КП ПОРАЖЁН', 'COMMAND POST OUT: NO LINK', 2],
};
export const alertRu = (a) => (ALERTS[a] ? ALERTS[a][0] : 'ТРЕВОГА');
export const alertEn = (a) => (ALERTS[a] ? ALERTS[a][1] : a);
const alertRank = (a) => (ALERTS[a] ? ALERTS[a][2] : 2);
// Sirens only for what can kill the unit right now.
export const alertSevere = (a) => alertRank(a) === 0;

export class Header {
  constructor(kindRu, kindEn) {
    this.el = el('div', 'hdr');
    const id = el('div', 'hid');
    this.call = el('b', 'call');
    this.name = el('i', 'uname');
    id.append(this.call, this.name);
    const st = el('div', 'hstat');
    this.stat = el('b', 'stat');
    this.line = el('i', 'sline');
    st.append(label('СОСТОЯНИЕ', 'STATUS', 'cap'), this.stat, this.line);
    const hp = el('div', 'hhp');
    this.hp = new Bar({ segs: 12, cls: 'hpbar' });
    hp.append(label('ИСПРАВНОСТЬ', 'HEALTH', 'cap'), this.hp.el);
    this.lamps = [new Lamp('', '', 'red', 'wide'), new Lamp('', '', 'red', 'wide')];
    const al = el('div', 'halerts');
    al.append(...this.lamps.map((l) => l.el));
    this.el.append(id, st, hp, al);
    this.kind = kindRu + ' / ' + kindEn;
  }
  update(u, tracks) {
    setText(this.call, u.callsign ? u.callsign.toUpperCase() : u.id);
    setText(this.name, u.name || this.kind);
    const dead = u.alive === false;
    setText(this.stat, dead ? 'DESTROYED' : (u.status || 'READY'));
    setCls(this.stat, 'bad', dead || u.status === 'HOLD FIRE' || u.status === 'SILENT');
    setText(this.line, statusLine(u, tracks));
    this.hp.set(u.maxHp ? u.hp / u.maxHp : 1, u.maxHp ? `${Math.max(0, Math.round((u.hp / u.maxHp) * 100))}%` : '');
    const al = (u.alerts || []).slice().sort((a, b) => alertRank(a) - alertRank(b));
    for (let i = 0; i < 2; i++) {
      const l = this.lamps[i];
      if (al[i]) { l.text(alertRu(al[i]), alertEn(al[i])); l.set(alertRank(al[i]) < 2 ? 2 : 1); } else { l.text('', ''); l.set(0); }
    }
  }
}

const wt = (e) => (e.type ? ' with ' + e.type : '');
const pad3 = (id) => String(id).padStart(3, '0');

// One plain sentence on what the unit is doing right now ("ENGAGING 026 with 57E6", "RELOADING 86 s", "SILENT").
export function statusLine(u, tracks) {
  if (u.alive === false) return 'No longer in action';
  const w = u.weapons || {};
  const m = w.missiles;
  const g = w.gun;
  if (g && g.firing) return `FIRING ${(g.shell ?? '30mm').replace('mm', ' mm')}${(g.target ?? u.selected) != null ? ' on ' + pad3(g.target ?? u.selected) : ''}`;
  // the guns cannot fire on their target (the sim's gun.hold): say why while the player wants them
  if (g && g.hold && g.target != null && (g.trigger || (u.mode === 'manual' && w.weapon === 'gun'))) return `GUNS HELD on ${pad3(g.target)}: ${g.hold}`;
  const live = (u.engagements || []).filter((e) => e.state === 'aligning' || e.state === 'launch' || e.state === 'flying');
  if (live.length) {
    // a round held back by the rate cap (the sim's e.wait, SYSTEMS targetGap) says so first
    const e = live.find((x) => x.wait > 0) || live[0];
    const more = live.length > 1 ? ` (+${live.length - 1})` : '';
    if (e.wait > 0) return `NEXT TARGET IN ${Math.ceil(e.wait)} s: ${pad3(e.trackId)}${wt(e)}${more}`;
    if (e.state === 'aligning') return `LAYING ON ${pad3(e.trackId)}${wt(e)}${more}`;
    if (e.state === 'launch') return `ENGAGING ${pad3(e.trackId)}${wt(e)}${more}`;
    return `${e.type || 'MISSILE'} IN FLIGHT to ${pad3(e.trackId)}${more}`;
  }
  const done = (u.engagements || [])[0];
  if (done && done.state === 'kill') return `SPLASH: ${pad3(done.trackId)} destroyed`;
  if (done && done.state === 'miss') return `MISSED ${pad3(done.trackId)}`;
  if (m && m.reload > 0) return `RELOADING ${Math.ceil(m.reload)} s`;
  if (u.mode === 'hold') return 'HOLD FIRE: weapons safe';
  if (u.kind === 'strela') {
    const s = u.sight || {};
    if (s.uncaged && (s.lock || 0) >= 1) return 'LOCKED: press FIRE';
    if (s.uncaged) return 'SEEKER ACTIVE: put target in the circle';
    return m && m.ready ? 'CAGED: slew to target, then UNCAGE' : 'NO MISSILES: reload';
  }
  if (u.radar && !u.radar.search && !u.radar.track) return 'SILENT: radars off, blind but hidden';
  if (m && m.ready === 0 && m.reserve > 0) return 'LAUNCHERS EMPTY: reload';
  if (u.mode === 'manual') return u.selected != null ? `MANUAL: track ${pad3(u.selected)} selected` : 'MANUAL: pick a track, then fire';
  if (tracks && tracks.length) return `AUTO: crew watching ${tracks.length} track${tracks.length > 1 ? 's' : ''}`;
  return 'AUTO: scanning, no tracks';
}

const CLS_NAME = { aircraft: 'aircraft', cruise: 'cruise missile', drone: 'drone', arm: 'anti-radar missile', tbm: 'ballistic missile', helo: 'helicopter', bomb: 'glide bomb', unknown: 'unknown', decoy: 'decoy', atgm: 'guided missile' };

// Thin bar under the header: the selected track and which units are engaging it.
export class SelBar {
  constructor() {
    this.el = el('div', 'selbar');
    this.cap = label('ВЫБРАНА', 'SELECTED TRACK', 'cap');
    this.txt = el('b', 'seltxt');
    this.eng = el('i', 'seleng');
    this.el.append(this.cap, this.txt, this.eng);
  }
  update(u, t, data) {
    if (!t) {
      setText(this.txt, u.selected != null ? `${pad3(u.selected)}  (lost)` : 'NONE: click the scope or the table, or press Tab');
      setText(this.eng, '');
      return;
    }
    setText(this.txt, `${pad3(t.id)}  ${(CLS_NAME[t.cls] || t.cls).toUpperCase()}${t.iff === 'unknown' ? '?' : ''}   ${fmtKm(t.range)} km   ${fmtAlt(t.alt)} m   ${Math.round(t.speed * 3.6)} km/h   TTI ${fmtTti(t.tti)}`);
    const by = (t.engagedBy || []).map((id) => {
      const o = data.units.find((x) => x.id === id);
      return o ? (o.id === u.id ? 'THIS UNIT' : o.callsign.toUpperCase()) : id;
    });
    setText(this.eng, by.length ? 'ENGAGED BY ' + by.join(', ') : 'not engaged');
    setCls(this.eng, 'on', by.length > 0);
  }
}

// Short unit tag for the "engaged by" column.
export const abbrev = (id) => String(id).slice(0, 2);

// Own track picture, falling back to the fused network picture (Strela has no radar of its own).
export const tracksFor = (u, data) => (u.tracks && u.tracks.length ? u.tracks : (data.picture || []));

export const selectedTrack = (u, tracks) => {
  if (u.selected == null) return null;
  for (const t of tracks) if (t.id === u.selected) return t;
  return null;
};

export const engagedSet = (u) => {
  const s = new Set();
  if (u.engagements) for (const e of u.engagements) s.add(e.trackId);
  return s;
};

// Tracks ordered by threat: shortest time to impact, then range.
export const threatOrder = (tracks) =>
  tracks.slice().sort((a, b) => ((a.tti == null || !isFinite(a.tti) ? 1e9 : a.tti) - (b.tti == null || !isFinite(b.tti) ? 1e9 : b.tti)) || a.range - b.range);

// Missile stock for a type, whether the sim reports weapons.missiles per type or as one flat record.
export function stockOf(u, type) {
  const w = u.weapons;
  if (!w) return null;
  if (w.stock && w.stock[type || w.type]) return w.stock[type || w.type];
  const m = w.missiles;
  if (!m) return null;
  if (typeof m.ready === 'number') return !type || !m.type || m.type === type ? m : null;
  return m[type] || null;
}

// Largest reload time seen per key, so the progress bar is right whatever the sim's reload durations are.
export function reloadFrac(memo, key, left) {
  const k = 'rl_' + key;
  if (!(left > 0)) { memo[k] = 0; return 0; }
  if (!memo[k] || left > memo[k]) memo[k] = left;
  return 1 - Math.min(1, left / memo[k]);
}

// Arrow keys held down become continuous slew commands, scaled to the field of view.
export class Slewer {
  constructor() { this.keys = new Set(); this.fast = false; }
  key(e, down) {
    const k = e.code;
    if (k !== 'ArrowLeft' && k !== 'ArrowRight' && k !== 'ArrowUp' && k !== 'ArrowDown') return false;
    if (down) this.keys.add(k); else this.keys.delete(k);
    this.fast = e.shiftKey;
    return true;
  }
  step(dt, fov, send) {
    if (!this.keys.size) return;
    const r = fov * 0.7 * dt * (this.fast ? 3 : 1);
    const daz = (this.keys.has('ArrowRight') ? r : 0) - (this.keys.has('ArrowLeft') ? r : 0);
    const del = (this.keys.has('ArrowUp') ? r : 0) - (this.keys.has('ArrowDown') ? r : 0);
    if (daz || del) send('slew', { daz, del });
  }
  clear() { this.keys.clear(); }
}

// Does this unit's fire-control channel hold the track? The sim keeps no flag for it, so this repeats its
// rule in channelSees (tracking channel on, inside its game range) and also trusts a live engagement.
export function channelLock(u, t) {
  if (!t || u.alive === false) return false;
  // the sim says which target the fire-control channel holds; the rules below are the fallback
  if (u.channel) return !!u.channel.locked && u.channel.targetId === t.id;
  if ((u.engagements || []).some((e) => e.trackId === t.id && (e.state === 'launch' || e.state === 'flying'))) return true;
  if (u.weapons && u.weapons.gun && u.weapons.gun.firing && u.weapons.gun.target === t.id) return true;
  const sys = SYSTEMS[u.kind];
  if (!sys || !sys.track) return false;
  if (u.kind === 'pantsir' && u.sight && u.sight.src === 'eo') return t.range < sys.eo.range;
  return !!(u.radar && u.radar.track) && t.range < sys.track.range;
}

// A command the AI crew would undo (it slews the sight, sweeps the turret and works the guns in auto, and
// cancels engagements in hold) first takes the console to manual. `fromHold` also leaves hold.
export function takeManual(u, send, fromHold = false) {
  if (!u) return;
  if (u.mode === 'auto' || (fromHold && u.mode === 'hold')) send('mode', { mode: 'manual' });
}

export const MODE_ITEMS = [
  { v: 'auto', ru: 'АВТОМАТ', en: 'CREW FIRES', color: 'green' },
  { v: 'manual', ru: 'РУЧНОЙ', en: 'YOU FIRE' },
  { v: 'hold', ru: 'ЗАПРЕТ', en: 'HOLD FIRE', color: 'red' },
];

// Is this track inside the unit's gun range (the sim's own rule: the crew opens fire inside it)?
export const inGunRange = (u, t) => {
  const g = SYSTEMS[u.kind] && SYSTEMS[u.kind].gun;
  return !!(t && g && t.range < g.range);
};

// Which of a gun unit's two channels see the track: the tracking radar (on, inside its range) and the EO sight.
export function channelsSee(u, t) {
  const sys = SYSTEMS[u.kind];
  if (!t || !sys || u.alive === false) return { radar: false, eo: false };
  return {
    radar: !!(sys.track && u.radar && u.radar.track && t.range < sys.track.range),
    eo: !!(sys.eo && t.range < sys.eo.range),
  };
}
