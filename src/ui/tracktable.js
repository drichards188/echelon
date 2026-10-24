// Sortable track table. Rows are pooled DOM nodes keyed by track id; cells are updated only when their
// text changes and rows are re-appended only when the sort order actually changes.
import { el, setText, setCls, fmtKm, fmtAlt, fmtTti } from './widgets.js';

const CLS_CODE = { aircraft: 'AIR', cruise: 'CM', drone: 'UAV', arm: 'ARM', tbm: 'BM', helo: 'HEL', bomb: 'BMB', unknown: 'UNK' };

const COLS = {
  id: { h: 'ЦЕЛЬ', en: 'Target: its track number', w: 44, get: (t) => String(t.id).padStart(3, '0'), key: (t) => Number(t.id) || 0 },
  cls: { h: 'КЛАСС', en: 'Class: AIR aircraft, CM cruise missile, UAV drone, ARM anti-radar missile, BM ballistic missile, HEL helicopter, UNK unknown', w: 46, get: (t) => CLS_CODE[t.cls] || t.cls, key: (t) => t.cls },
  rng: { h: 'ДАЛЬ,км', en: 'Range, km', w: 56, get: (t) => fmtKm(t.range), key: (t) => t.range },
  brg: { h: 'АЗ,°', en: 'Azimuth: compass bearing, degrees', w: 40, get: (t) => String(Math.round(t.bearing) % 360).padStart(3, '0'), key: (t) => t.bearing },
  alt: { h: 'ВЫС,м', en: 'Altitude, m', w: 48, get: (t) => fmtAlt(t.alt), key: (t) => t.alt },
  spd: { h: 'СКОР,км/ч', en: 'Speed, km/h', w: 62, get: (t) => String(Math.round(t.speed * 3.6)), key: (t) => t.speed },
  tti: { h: 'ВРЕМЯ', en: 'Time: until it reaches what it is attacking', w: 46, get: (t) => fmtTti(t.tti), key: (t) => (t.tti == null || !isFinite(t.tti) ? 1e9 : t.tti) },
  eng: { h: 'ОБСТРЕЛ', en: 'Engaged: the units firing at it', w: 84, get: (t, ab) => (t.engagedBy && t.engagedBy.length ? t.engagedBy.map((i) => ab(i)).join(' ') : ''), key: (t) => (t.engagedBy ? t.engagedBy.length : 0) },
};

export class TrackTable {
  // heads: the column captions in another language ({ col: caption }), none: the empty table's caption
  constructor({ cols, onPick, sort = 'tti', maxHeight = 200, abbrev = (i) => String(i).slice(0, 2), heads = {}, none = 'НЕТ ЦЕЛЕЙ' }) {
    this.cols = cols;
    this.onPick = onPick;
    this.sortKey = sort;
    this.dir = 1;
    this.abbrev = abbrev;
    this.el = el('div', 'ttable');
    this.head = el('div', 'tr th');
    this.heads = {};
    for (const c of cols) {
      const d = COLS[c];
      const h = el('span', 'td c-' + c, heads[c] ?? d.h);
      h.style.width = d.w + 'px';
      h.title = `${d.en}\n(click to sort)`;
      h.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        if (this.sortKey === c) this.dir = -this.dir; else { this.sortKey = c; this.dir = 1; }
        this.order = null;
        this.refresh = true;
        this.tick = 1;
      });
      this.heads[c] = h;
      this.head.append(h);
    }
    this.body = el('div', 'tbody');
        this.empty = el('div', 'tempty', `${none} / NO TRACKS`);
    this.el.append(this.head, this.body);
    this.rows = new Map();
    this.order = null;
    this.tick = 1;
    this.sel = null;
    this.refresh = true;
  }

  update(dt, tracks, selId, force) {
    this.tick += dt;
    if (this.tick < 0.2 && !force && selId === this.sel) return;
    this.tick = 0;
    const sel = selId;
    const selChanged = sel !== this.sel;
    this.sel = sel;
    const seen = new Set();
    const list = [];
    for (const t of tracks) {
      seen.add(t.id);
      let r = this.rows.get(t.id);
      if (!r) {
        r = { el: el('div', 'tr'), cells: {}, t };
        for (const c of this.cols) {
          const s = el('span', 'td c-' + c);
          s.style.width = COLS[c].w + 'px';
          r.cells[c] = s;
          r.el.append(s);
        }
        r.el.addEventListener('pointerdown', (e) => { e.preventDefault(); this.onPick(t.id); });
        this.rows.set(t.id, r);
        this.order = null;
      }
      r.t = t;
      list.push(r);
    }
    for (const [id, r] of this.rows) if (!seen.has(id)) { r.el.remove(); this.rows.delete(id); this.order = null; }
    const col = COLS[this.sortKey];
    const dir = this.dir;
    list.sort((a, b) => {
      const ka = col.key(a.t), kb = col.key(b.t);
      return (ka < kb ? -1 : ka > kb ? 1 : 0) * dir || (a.t.range - b.t.range);
    });
    let same = this.order && this.order.length === list.length;
    if (same) for (let i = 0; i < list.length; i++) if (this.order[i] !== list[i]) { same = false; break; }
    if (!same) {
      const frag = document.createDocumentFragment();
      for (const r of list) frag.append(r.el);
      this.body.append(frag);
      this.order = list;
    }
    for (const r of list) {
      const t = r.t;
      for (const c of this.cols) setText(r.cells[c], COLS[c].get(t, this.abbrev));
      setCls(r.el, 'sel', t.id === sel);
      setCls(r.el, 'eng', t.engagedBy && t.engagedBy.length > 0);
      setCls(r.el, 'hot', t.cls === 'arm' || t.cls === 'tbm');
      setCls(r.el, 'unk', t.iff === 'unknown');
      if (selChanged && t.id === sel) r.el.scrollIntoView({ block: 'nearest' });
    }
    if (this.refresh) {
      this.refresh = false;
      for (const c of this.cols) setCls(this.heads[c], 'sorted', c === this.sortKey);
      for (const c of this.cols) this.heads[c].dataset.dir = c === this.sortKey ? (this.dir > 0 ? '▲' : '▼') : '';
    }
    if (!list.length) { if (!this.empty.parentNode) this.body.append(this.empty); }
    else if (this.empty.parentNode) this.empty.remove();
  }
}
