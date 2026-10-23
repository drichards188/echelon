// The WW2 consoles' instruments: German gun-position hardware as DOM and canvas widgets, after the
// Kommandogeraet 40's operators' panel and the Flak 37's receiver dials (refs/ww2/battery photos
// battery_kg40_panel_04, refs/ww2/flak88 flak88_receivers_09): black enamel dials with white figures under
// glass and follow-the-pointer needles, mechanical drum counters, round signal lamps behind coloured
// lenses, Bakelite rotary switches, engraved label plates. German captions with a small English line
// under them, as the modern consoles pair Russian with English. Every setter caches its last value (the
// modern widgets' rule), and the canvases redraw only when their value moved.
//
// Also here: the shared header, the selected-target bar and the target list in the era's words, the
// trigger's reach rule for a unit of several guns (the modern consoles/common.js gunReach and setTrigger,
// per gun), the per-unit sight view state the sight poses read (VIEW), and the sights' projection.
import { SYSTEMS } from '../../../sim/systems.js';
import { SHELLS, reachOf } from '../../../ballistics.js';
import { ERA } from '../../../deploy.js';
import { el, hw, setText, setCls, label, snd, Bar, Lamp } from '../../../ui/widgets.js';
import { alertRu, alertEn } from '../../../ui/consoles/common.js';

export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;
export const wrap2 = (a) => ((a % TAU) + TAU) % TAU;
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const pad3 = (n) => String(n).padStart(3, '0');

// German figures: the decimal comma, the thousands point
export const dec = (v, d = 1) => (v == null || !isFinite(v) ? '--' : v.toFixed(d).replace('.', ','));
export const thou = (v) => (v == null || !isFinite(v) ? '--' : String(Math.round(v)).replace(/\B(?=(\d{3})+(?!\d))/g, '.'));
export const km = (m) => (m == null || !isFinite(m) ? '--' : dec(m / 1000, m < 9950 ? 1 : 0));

// the compass bearing a part's turret points along (turret az is relative to the unit's heading in
// rotation.y convention: sim/mounts.js turretAz)
export const compassOf = (u, tu) => wrap2(-(u.heading + tu.az));
// a track's course (compass radians) from its velocity
export const courseOf = (t) => wrap2(Math.atan2(t.vel?.x ?? 0, -(t.vel?.z ?? 0)));

// The track classes the observers and the reporting service give (THREATS cls), in the gun position's words
export const CLS44 = {
  bomber: ['BOMBER', 'BOMBER', 'BOM'], fighter: ['JAGDFLUGZEUG', 'FIGHTER', 'JAG'], recon: ['AUFKLÄRER', 'RECONNAISSANCE', 'AUF'],
  window: ['DÜPPEL', 'WINDOW', 'DÜP'], bomb: ['BOMBE', 'BOMB', 'BMB'], rocket: ['RAKETE', 'ROCKET', 'RAK'], unknown: ['UNBEKANNT', 'UNIDENTIFIED', '?'],
};
export const clsOf = (c) => CLS44[c] ?? CLS44.unknown;
// what the gun crews take (the sim's PLANE_CLS)
export const PLANE = new Set(['bomber', 'fighter', 'recon']);
// the period German spelling alphabet for the heavy guns' letters
export const LETTER = { A: 'ANTON', B: 'BERTA', C: 'CÄSAR', D: 'DORA', E: 'EMIL', F: 'FRIEDRICH' };

// the sim's unit status in German, with the English
const STATUS = {
  READY: ['FEUERBEREIT', 'READY'], TRACKING: ['BEOBACHTUNG', 'TRACKING'], ENGAGING: ['IM FEUER', 'ENGAGING'],
  'HOLD FIRE': ['FEUER HALT', 'HOLD FIRE'], BARRAGE: ['SPERRFEUER', 'BARRAGE'], DESTROYED: ['AUSGEFALLEN', 'DESTROYED'],
  SILENT: ['FuMG AUS', 'RADAR OFF'], RELOADING: ['MUNITION', 'RESUPPLY'],
};

const alertRank = (a) => ERA.alerts[a]?.[2] ?? 2;

// the per-unit sight view the consoles choose and the sight poses read (consoles.js): { part, fov }
export const VIEW = new Map();

// ---------------------------------------------------------------------------------------------------
// The header: callsign and unit, the status in German with the English sentence under it, the strength
// with the guns standing, two alert windows (the era's alert captions, eras/ww2.js `alerts`).
export class Header44 {
  constructor(kindDe, kindEn) {
    this.el = el('div', 'hdr hdr44');
    const id = el('div', 'hid');
    this.call = el('b', 'call');
    this.name = el('i', 'uname');
    id.append(this.call, this.name);
    const st = el('div', 'hstat');
    const row = el('div', 'hsrow');
    this.stat = el('b', 'stat');
    this.statEn = el('i', 'staten');
    row.append(this.stat, this.statEn);
    this.line = el('i', 'sline');
    st.append(label('ZUSTAND', 'STATUS', 'cap'), row, this.line);
    const hp = el('div', 'hhp');
    this.hp = new Bar({ segs: 12, cls: 'hpbar' });
    this.guns = el('i', 'hguns');
    hp.append(label('GEFECHTSSTÄRKE', 'STRENGTH', 'cap'), this.hp.el, this.guns);
    this.lamps = [new Lamp('', '', 'red', 'wide'), new Lamp('', '', 'red', 'wide')];
    const al = el('div', 'halerts');
    al.append(...this.lamps.map((l) => l.el));
    this.el.append(id, st, hp, al);
    this.kind = `${kindDe} / ${kindEn}`;
  }
  update(u, line) {
    setText(this.call, (u.callsign || u.id).toUpperCase());
    setText(this.name, u.name || this.kind);
    const dead = u.alive === false;
    const s = STATUS[dead ? 'DESTROYED' : u.status] ?? [u.status ?? 'FEUERBEREIT', ''];
    setText(this.stat, s[0]);
    setText(this.statEn, s[1]);
    setCls(this.stat, 'bad', dead || u.status === 'HOLD FIRE');
    setText(this.line, line);
    this.hp.set(u.maxHp ? u.hp / u.maxHp : 1, u.maxHp ? `${Math.max(0, Math.round((u.hp / u.maxHp) * 100))}%` : '');
    const guns = u.parts.filter((p) => p.role === 'gun');
    setText(this.guns, `${guns.filter((p) => p.alive).length} / ${guns.length} GESCHÜTZE`);
    const al = (u.alerts || []).slice().sort((a, b) => alertRank(a) - alertRank(b));
    for (let i = 0; i < 2; i++) {
      const l = this.lamps[i];
      if (al[i]) {
        l.text(alertRu(al[i]), alertEn(al[i]));
        l.set(alertRank(al[i]) < 2 ? 2 : 1);
      } else {
        l.text('', '');
        l.set(0);
      }
    }
  }
}

// The selected target under the header: number, class, range, height, speed, course, who is firing at it.
export class SelBar44 {
  constructor() {
    this.el = el('div', 'selbar');
    this.cap = label('ZIEL', 'TARGET', 'cap');
    this.txt = el('b', 'seltxt');
    this.eng = el('i', 'seleng');
    this.el.append(this.cap, this.txt, this.eng);
  }
  update(u, t, data) {
    if (!t) {
      setText(this.txt, u.selected != null ? `${pad3(u.selected)}  (VERLOREN / LOST)` : 'KEIN ZIEL: click the plot or the list, or press Tab');
      setText(this.eng, '');
      setCls(this.eng, 'on', false);
      return;
    }
    const c = clsOf(t.cls);
    setText(this.txt, `${pad3(t.id)}  ${c[0]}   ${km(t.range)} km   ${thou(t.alt)} m   ${Math.round(t.speed)} m/s   KURS ${pad3(Math.round(courseOf(t) / DEG) % 360)}`);
    const by = (t.engagedBy || []).map((id) => {
      const o = data.units.find((x) => x.id === id);
      return o ? (o.id === u.id ? 'EIGENE' : (o.callsign || o.id).toUpperCase()) : id;
    });
    setText(this.eng, by.length ? 'IM FEUER: ' + by.join(', ') : 'nicht bekämpft / not engaged');
    setCls(this.eng, 'on', by.length > 0);
  }
}

// ---------------------------------------------------------------------------------------------------
// Signal lamp: a round lens behind a bezel with its plate; 0 dark, 1 lit, 2 blinking.
export class Lamp44 {
  constructor(de, en, color = 'red', cls = '') {
    this.el = el('div', `lamp44 ${color} ${cls}`);
    this.lens = el('i', 'lens');
    this.lbl = label(de, en);
    this.el.append(this.lens, this.lbl);
    this.s = 0;
  }
  text(de, en) {
    setText(this.lbl.firstChild, de);
    setText(this.lbl.lastChild, en);
  }
  set(s) {
    s = s === true ? 1 : s || 0;
    if (s === this.s) return;
    this.s = s;
    this.el.classList.toggle('on', s > 0);
    this.el.classList.toggle('blink', s === 2);
  }
}

// Mechanical drum counter: white figures on black drums in a window, the caption plate under it.
export class Drum {
  constructor(de, en, tpl, cls = '') {
    this.el = el('div', 'drum44 ' + cls);
    this.win = el('div', 'dwin');
    this.val = el('span', 'dval', tpl.replace(/[0-9]/g, '0'));
    this.win.append(this.val);
    this.el.append(this.win);
    if (de) this.el.append(label(de, en));
    this.n = tpl.length;
  }
  set(text) {
    text = String(text);
    if (text.length < this.n) text = text.padStart(this.n, ' ');
    setText(this.val, text);
  }
}

// Bakelite rotary switch: a knob with a white pointer line and its positions engraved round it; click a
// position, or the knob for the next one. items: [{ v, de, en }]
export class Knob {
  constructor({ items, onChange, de = '', en = '', cls = '' }) {
    this.el = el('div', `knob44 ${cls} n${items.length}`);
    const face = el('div', 'kface');
    this.cap = el('div', 'kcap');
    this.ptr = el('i', 'kptr');
    this.cap.append(this.ptr);
    face.append(this.cap);
    const n = items.length;
    const spread = n === 2 ? 90 : n === 3 ? 120 : 150;
    this.ang = new Map();
    items.forEach((it, i) => {
      const a = n === 1 ? 0 : -spread / 2 + (spread * i) / (n - 1);
      this.ang.set(it.v, a);
      const p = el('button', 'kpos');
      p.type = 'button';
      p.tabIndex = -1;
      p.append(label(it.de, it.en));
      // the positions on an arc over the knob, their marks pointing at it
      const r = 1, x = Math.sin(a * DEG) * r, y = -Math.cos(a * DEG) * r;
      p.style.setProperty('--x', x.toFixed(3));
      p.style.setProperty('--y', y.toFixed(3));
      const tick = el('i', 'ktick');
      tick.style.transform = `rotate(${a}deg)`;
      face.append(tick);
      p.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        snd('switch');
        onChange(it.v);
      });
      face.append(p);
    });
    this.items = items;
    this.cap.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      snd('switch');
      const i = items.findIndex((it) => it.v === this.cur);
      onChange(items[(i + 1) % n].v);
    });
    this.el.append(face);
    if (de) this.el.append(label(de, en, 'kcapt'));
    this.cur = undefined;
  }
  set(v) {
    if (v === this.cur) return;
    this.cur = v;
    const a = this.ang.get(v) ?? 0;
    this.cap.style.transform = `rotate(${a}deg)`;
    for (const b of this.el.querySelectorAll('.kpos')) b.classList.remove('lit');
    const i = this.items.findIndex((it) => it.v === v);
    if (i >= 0) this.el.querySelectorAll('.kpos')[i].classList.add('lit');
  }
}

// ---------------------------------------------------------------------------------------------------
// Follow-the-pointer dial (canvas): a black enamel face with white figures, the data pointer (slim,
// cream) and optionally the follow pointer (broad, hollow, orange) that a layer turns over it, as on the
// Flak 37's receivers. opts: size (css px), min, max, wrap (a full circle: 0 at the top, clockwise),
// arc ([from, to] degrees from the top for a part scale), major, minor (scale steps), fig (figure for a
// major mark), zones ([[from, to, css colour]]), unit (engraved on the face), de / en (its plate).
export class Dial {
  constructor(o) {
    this.o = { size: 84, min: 0, max: 100, wrap: false, arc: [-135, 135], major: 10, minor: 2, fig: (v) => String(v), zones: [], unit: '', ...o };
    this.el = el('div', 'dial44');
    this.cv = document.createElement('canvas');
    this.cv.className = 'dialcv';
    const s = this.o.size;
    this.cv.style.width = this.cv.style.height = `${s}px`;
    this.el.append(this.cv);
    if (o.de) this.el.append(label(o.de, o.en));
    this.c = this.cv.getContext('2d');
    this.face = null;
    this.k = 0;
    this.v = null;
    this.f = null;
    this.dirty = true;
  }

  // the angle (rad from the top, clockwise) for a value
  ang(v) {
    const { min, max, wrap, arc } = this.o;
    if (wrap) return ((v - min) / (max - min)) * TAU;
    const t = clamp((v - min) / (max - min), 0, 1);
    return (arc[0] + (arc[1] - arc[0]) * t) * DEG;
  }

  resize() {
    const k = clamp(hw.scale * Math.min(window.devicePixelRatio || 1, 2), 1, 2.4);
    if (Math.abs(k - this.k) < 0.01 && this.face) return;
    this.k = k;
    const w = Math.round(this.o.size * k);
    this.cv.width = this.cv.height = w;
    this.face = document.createElement('canvas');
    this.face.width = this.face.height = w;
    this.drawFace(this.face.getContext('2d'));
    this.dirty = true;
  }

  drawFace(c) {
    const { size: S, min, max, wrap, major, minor, fig, zones, unit } = this.o;
    const k = this.k, R = S / 2, cx = R, cy = R;
    c.setTransform(k, 0, 0, k, 0, 0);
    // bezel and the black enamel face
    const bz = c.createRadialGradient(cx - R * 0.3, cy - R * 0.4, R * 0.1, cx, cy, R);
    bz.addColorStop(0, '#8b8e86');
    bz.addColorStop(0.7, '#4a4c47');
    bz.addColorStop(1, '#1d1e1b');
    c.fillStyle = bz;
    c.beginPath(); c.arc(cx, cy, R - 0.5, 0, TAU); c.fill();
    const fr = R - 4;
    const fg = c.createRadialGradient(cx, cy - fr * 0.3, fr * 0.1, cx, cy, fr);
    fg.addColorStop(0, '#1b1c1a');
    fg.addColorStop(1, '#0b0b0a');
    c.fillStyle = fg;
    c.beginPath(); c.arc(cx, cy, fr, 0, TAU); c.fill();
    // coloured zones on the scale's edge
    for (const [a, b, col] of zones) {
      c.strokeStyle = col;
      c.lineWidth = 3;
      c.beginPath();
      c.arc(cx, cy, fr - 3, this.ang(a) - Math.PI / 2, this.ang(b) - Math.PI / 2);
      c.stroke();
    }
    // the scale
    c.strokeStyle = '#ece6d2';
    c.fillStyle = '#ece6d2';
    c.lineCap = 'butt';
    const span = max - min;
    const steps = Math.round(span / minor);
    c.font = `700 ${Math.max(7.5, S * 0.125)}px "DejaVu Sans Condensed", "Liberation Sans Narrow", "Arial Narrow", sans-serif`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    for (let i = 0; i <= steps; i++) {
      const v = min + i * minor;
      if (wrap && i === steps) break;
      const isMaj = Math.abs(((v - min) / major) - Math.round((v - min) / major)) < 1e-6;
      const a = this.ang(v) - Math.PI / 2;
      const r0 = fr - (isMaj ? 8 : 4.5), r1 = fr - 1.5;
      c.lineWidth = isMaj ? 1.4 : 0.8;
      c.beginPath();
      c.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
      c.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
      c.stroke();
      if (isMaj) {
        const rt = fr - 16;
        c.fillText(fig(v), cx + Math.cos(a) * rt, cy + Math.sin(a) * rt);
      }
    }
    // the engraving: the unit under the hub
    if (unit) {
      c.fillStyle = 'rgba(236,230,210,0.6)';
      c.font = `600 ${Math.max(6, S * 0.1)}px "DejaVu Sans Condensed", sans-serif`;
      c.fillText(unit, cx, cy + fr * 0.45);
    }
  }

  // v: the data pointer; f: the follow pointer (null: none); null v: the pointer rests at the scale's start
  set(v, f = null) {
    const eps = (this.o.max - this.o.min) / 600;
    if (!this.dirty && this.v != null && v != null && Math.abs(v - this.v) < eps && (f == null) === (this.f == null) && (f == null || Math.abs(f - this.f) < eps)) return;
    if (!this.dirty && v == null && this.v == null && f == null && this.f == null) return;
    this.v = v;
    this.f = f;
    this.dirty = false;
    this.draw();
  }

  draw() {
    this.resize();
    const c = this.c;
    const { size: S } = this.o;
    const k = this.k, R = S / 2, cx = R, cy = R, fr = R - 4;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, this.cv.width, this.cv.height);
    c.drawImage(this.face, 0, 0);
    c.setTransform(k, 0, 0, k, 0, 0);
    const needle = (a, len, w, col, tail) => {
      c.save();
      c.translate(cx, cy);
      c.rotate(a);
      c.fillStyle = col;
      c.beginPath();
      c.moveTo(-w, tail);
      c.lineTo(-w * 0.35, -len);
      c.lineTo(w * 0.35, -len);
      c.lineTo(w, tail);
      c.closePath();
      c.fill();
      c.restore();
    };
    if (this.f != null) {
      // the follow pointer: a broad hollow blade the data pointer shows through when covered
      const a = this.ang(this.f);
      c.save();
      c.translate(cx, cy);
      c.rotate(a);
      c.strokeStyle = '#ff9a2e';
      c.lineWidth = 1.6;
      c.beginPath();
      c.moveTo(-4.5, 4); c.lineTo(-3.2, -fr + 6); c.lineTo(3.2, -fr + 6); c.lineTo(4.5, 4);
      c.stroke();
      c.restore();
    }
    const a = this.ang(this.v ?? this.o.min);
    needle(a, fr - 4, 1.8, this.v == null ? '#6c6a60' : '#f3ecd4', 9);
    // the hub
    c.fillStyle = '#2b2c29';
    c.beginPath(); c.arc(cx, cy, 4.2, 0, TAU); c.fill();
    c.fillStyle = '#9a9b93';
    c.beginPath(); c.arc(cx - 0.8, cy - 0.8, 1.6, 0, TAU); c.fill();
    // the glass
    const gl = c.createLinearGradient(0, 0, S, S);
    gl.addColorStop(0, 'rgba(255,255,255,0.13)');
    gl.addColorStop(0.42, 'rgba(255,255,255,0)');
    c.fillStyle = gl;
    c.beginPath(); c.arc(cx, cy, fr, 0, TAU); c.fill();
  }
}

// ---------------------------------------------------------------------------------------------------
// The target list (Zielliste): the unit's own sightings and the reporting service's plots, nearest first;
// a click on a row designates, on a column title sorts by it (again: the other way). Pooled rows keyed by
// track id, as ui/tracktable.js. Each column's English on hover; the sort key per column.
const COLS = [
  ['id', 'NR', 30, 'Nummer: the target\'s number', (t) => Number(t.id) || 0],
  ['cls', 'ART', 34, 'Art (type): BOM bomber, JAG fighter, AUF reconnaissance, DÜP Window (chaff), ? unidentified', (t) => clsOf(t.cls)[2]],
  ['rng', 'ENTF', 40, 'Entfernung: range, km', (t) => t.range],
  ['alt', 'HÖHE', 44, 'Höhe: altitude, m', (t) => t.alt],
  ['brg', 'SEITE', 38, 'Seite: bearing, degrees', (t) => t.bearing],
  ['src', 'MELD.', 40, 'Meldung (report): EIGEN our own sighting, NACHB from a neighbouring unit, FluMe from the aircraft reporting service', (t, data) => srcOf(t, data)],
  ['eng', 'FEUER', 54, 'Feuer: the units firing at it', (t) => (t.engagedBy || []).length],
];
const SORT = Object.fromEntries(COLS.map(([k, , , , key]) => [k, key]));
// who reported it: our own sighting, a neighbouring unit's, or the reporting service's plot
function srcOf(t, data) {
  if (t.source !== 'link') return 'EIGEN';
  return (data.picture || []).some((p) => p.id === t.id && p.reporter) ? 'NACHB' : 'FluMe';
}
export class TargetList {
  constructor({ onPick, rows = 8 }) {
    this.el = el('div', 'tlist44');
    const head = el('div', 'tlr tlh');
    this.sortKey = 'rng';
    this.dir = 1;
    this.heads = {};
    for (const [k, h, w, en] of COLS) {
      const c = el('span', 'tlc c-' + k, h);
      c.style.width = w + 'px';
      c.title = `${en}\n(click to sort)`;
      c.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        snd('click');
        if (this.sortKey === k) this.dir = -this.dir; else { this.sortKey = k; this.dir = 1; }
        this.sorted();
        this.tick = 1;
        this.key = '';
      });
      this.heads[k] = c;
      head.append(c);
    }
    this.body = el('div', 'tlb');
    this.empty = el('div', 'tlempty', 'KEINE ZIELE / NO TARGETS');
    this.el.append(head, this.body);
    this.rows = new Map();
    this.onPick = onPick;
    this.max = rows;
    this.tick = 1;
    this.key = '';
    this.sorted();
  }
  // the sorted column's title marked, with its direction
  sorted() {
    for (const [k, c] of Object.entries(this.heads)) {
      setCls(c, 'sorted', k === this.sortKey);
      c.dataset.dir = k === this.sortKey ? (this.dir > 0 ? '▲' : '▼') : '';
    }
  }
  update(dt, u, tracks, data, force = false) {
    this.tick += dt;
    if (this.tick < 0.25 && !force && this.sel === u.selected) return;
    this.tick = 0;
    this.sel = u.selected;
    const by = SORT[this.sortKey], dir = this.dir;
    const list = tracks.filter((t) => t.cls !== 'bomb' && t.cls !== 'rocket').sort((a, b) => {
      const ka = by(a, data), kb = by(b, data);
      return (ka < kb ? -1 : ka > kb ? 1 : 0) * dir || a.range - b.range;
    });
    const seen = new Set();
    const order = [];
    for (const t of list) {
      seen.add(t.id);
      let r = this.rows.get(t.id);
      if (!r) {
        r = { el: el('div', 'tlr'), cells: {} };
        for (const [k, , w] of COLS) {
          const c = el('span', 'tlc c-' + k);
          c.style.width = w + 'px';
          r.cells[k] = c;
          r.el.append(c);
        }
        const id = t.id;
        r.el.addEventListener('pointerdown', (e) => {
          e.preventDefault();
          snd('click');
          this.onPick(id);
        });
        this.rows.set(t.id, r);
      }
      setText(r.cells.id, pad3(t.id));
      setText(r.cells.cls, clsOf(t.cls)[2]);
      setText(r.cells.rng, km(t.range));
      setText(r.cells.alt, thou(t.alt));
      setText(r.cells.brg, pad3(Math.round(t.bearing) % 360));
      setText(r.cells.src, srcOf(t, data));
      setText(r.cells.eng, (t.engagedBy || []).map((id) => (data.units.find((x) => x.id === id)?.callsign ?? id).slice(0, 4).toUpperCase()).join(' '));
      setCls(r.el, 'sel', t.id === u.selected);
      setCls(r.el, 'link', t.source === 'link');
      setCls(r.el, 'eng', (t.engagedBy || []).length > 0);
      setCls(r.el, 'chaff', t.cls === 'window');
      order.push(t.id);
    }
    for (const [id, r] of this.rows) if (!seen.has(id)) { r.el.remove(); this.rows.delete(id); }
    const key = order.join(',');
    if (key !== this.key) {
      this.key = key;
      this.body.replaceChildren(...(order.length ? order.map((id) => this.rows.get(id).el) : [this.empty]));
    }
  }
}

// ---------------------------------------------------------------------------------------------------
// The trigger's reach for a platoon (the modern rule of consoles/common.js gunReach, gun by gun): 'out'
// when no standing gun's shells can get to the track (a gun on it says so in its own solution's hold,
// otherwise the shells' straight-line reach), 'long' when it is beyond every gun's opening range or
// ceiling (the shells arrive slow and scattered, few hit), 'in' when inside them; null without a track.
export function reach44(u, t) {
  if (!t) return null;
  const sys = SYSTEMS[u.kind];
  let reach = false, inside = false;
  for (const p of u.parts) {
    const def = sys.guns?.[p.kind];
    if (!def || !p.alive || !p.gun || (u.predictor && p.role === 'gun')) continue;
    const g = p.gun;
    const d = Math.hypot(t.pos.x - p.pos.x, t.pos.y - (p.pos.y + (def.height ?? 1)), t.pos.z - p.pos.z);
    // a gun on it knows (its solution's hold); one whose layer cannot see it yet goes by the straight-line
    // reach, a little short of it (a target at the very edge is seldom one the shells can catch)
    const most = reachOf(SHELLS[def.shell]);
    const out = g.target === t.id && g.hold != null ? g.hold === 'out of reach' || g.hold === 'masked' || (g.hold === 'no lock' && d > most * 0.92) : d > most;
    if (out) continue;
    reach = true;
    if (d < def.range && !(t.alt > def.maxAlt)) inside = true;
  }
  return !reach ? 'out' : inside ? 'in' : 'long';
}

// The trigger's face for that reach: greyed out beyond the shells' reach, a blinking warning beyond the
// crews' opening range, the plain FEUER inside it (the modern setTrigger's faces, in German). A new face
// shows once the reach has held it for 0.4 s, so a target at the edge does not flicker it.
export function setTrigger44(btn, r, en, ok) {
  const now = performance.now();
  if (r === btn._r) btn._next = undefined;
  else if (btn._r == null || r == null) btn._r = r;
  else {
    if (r !== btn._next) {
      btn._next = r;
      btn._nextT = now;
    }
    if (now - btn._nextT > 400) {
      btn._r = r;
      btn._next = undefined;
    } else r = btn._r;
  }
  btn.enable(ok && r !== 'out');
  btn.text(r === 'out' ? 'ZU WEIT' : 'FEUER', r === 'out' ? 'OUT OF RANGE' : r === 'long' ? 'LONG RANGE: FEW HITS' : en);
  setCls(btn.el, 'warn', r === 'long' && ok);
  setCls(btn.el, 'out', r === 'out');
}

// ---------------------------------------------------------------------------------------------------
// The sights' projection: a world point seen from `eye` along compass az / elevation el, horizontal field
// of view fov, onto a W x H picture (the SightRenderer's camera: perspective, world up). Writes [x, y] to
// out and returns the depth along the line of sight (negative: behind).
export class SightCam {
  constructor(W, H) {
    this.W = W;
    this.H = H;
    this.f = [0, 0, -1];
    this.r = [1, 0, 0];
    this.u = [0, 1, 0];
    this.eye = { x: 0, y: 0, z: 0 };
    this.th = 1;
    this.tv = 1;
  }
  set(eye, az, el, fov) {
    const ce = Math.cos(el);
    const f = this.f, r = this.r, u = this.u;
    f[0] = Math.sin(az) * ce; f[1] = Math.sin(el); f[2] = -Math.cos(az) * ce;
    r[0] = Math.cos(az); r[1] = 0; r[2] = Math.sin(az);
    // up = right x forward
    u[0] = r[1] * f[2] - r[2] * f[1];
    u[1] = r[2] * f[0] - r[0] * f[2];
    u[2] = r[0] * f[1] - r[1] * f[0];
    this.eye.x = eye.x; this.eye.y = eye.y; this.eye.z = eye.z;
    this.th = Math.tan(fov / 2);
    this.tv = this.th / (this.W / this.H);
    this.fov = fov;
    this.az = az;
    this.el = el;
    return this;
  }
  project(p, out) {
    const dx = p.x - this.eye.x, dy = p.y - this.eye.y, dz = p.z - this.eye.z;
    const f = this.f, r = this.r, u = this.u;
    const z = dx * f[0] + dy * f[1] + dz * f[2];
    const x = dx * r[0] + dy * r[1] + dz * r[2];
    const y = dx * u[0] + dy * u[1] + dz * u[2];
    const zz = Math.max(z, 1e-3);
    out[0] = this.W / 2 + (x / zz / this.th) * (this.W / 2);
    out[1] = this.H / 2 - (y / zz / this.tv) * (this.H / 2);
    return z;
  }
  // pixels per radian at the centre
  get ppr() {
    return this.W / 2 / this.th;
  }
}

// a line drawn twice, a dark under-stroke and the bright core, so it reads on sky and ground alike
export function line2(c, pts, w, col, under = 'rgba(0,0,0,0.6)') {
  c.lineJoin = 'round';
  c.beginPath();
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    if (i === 0 || p[2]) c.moveTo(p[0], p[1]);
    else c.lineTo(p[0], p[1]);
  }
  if (under) {
    c.strokeStyle = under;
    c.lineWidth = w + 2;
    c.stroke();
  }
  c.strokeStyle = col;
  c.lineWidth = w;
  c.stroke();
}
