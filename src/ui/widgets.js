// Cabin hardware as DOM widgets: annunciator tiles, illuminated push buttons, guarded toggles, segmented
// selectors, amber readouts, LED bars, missile racks. Every setter caches its last value so calling it
// each frame costs nothing when nothing changed (no layout thrash, no innerHTML rebuilds).

export const hw = { audio: null, scale: 1 };

// The audio engine is optional; a missing or throwing hook must never break the console.
export function snd(name) {
  try { if (hw.audio && hw.audio.ui) hw.audio.ui(name); } catch (e) { /* optional */ }
}

export function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

export function setText(n, v) {
  v = String(v);
  if (n._v !== v) { n._v = v; n.textContent = v; }
}

export function setCls(n, c, on) {
  on = !!on;
  const k = '_c' + c;
  if (n[k] !== on) { n[k] = on; n.classList.toggle(c, on); }
}

// Russian caption in caps with a small English caption under it.
export function label(ru, en, cls = '') {
  const d = el('div', 'lbl ' + cls);
  d.append(el('b', null, ru), el('i', null, en));
  return d;
}

export function plate(ru, en, cls = '') {
  const p = el('section', 'plate ' + cls);
  const t = el('div', 'ptitle');
  t.append(el('b', null, ru), el('i', null, en));
  const body = el('div', 'pbody');
  p.append(t, body);
  return { el: p, body };
}

// Annunciator window: dark until lit. state 0 off, 1 lit, 2 blinking.
export class Lamp {
  constructor(ru, en, color = 'green', cls = '') {
    this.el = el('div', `ann ${color} ${cls}`);
    this.b = el('b', null, ru);
    this.i = el('i', null, en);
    this.el.append(this.b, this.i);
    this.s = 0;
  }
  text(ru, en) { setText(this.b, ru); setText(this.i, en); }
  set(s) {
    s = s === true ? 1 : s || 0;
    if (s === this.s) return;
    this.s = s;
    this.el.classList.toggle('on', s > 0);
    this.el.classList.toggle('blink', s === 2);
  }
}

// Small round LED (unit tabs).
export class Led {
  constructor(color) { this.el = el('i', `led ${color}`); this.s = 0; }
  set(s) {
    s = s === true ? 1 : s || 0;
    if (s === this.s) return;
    this.s = s;
    this.el.classList.toggle('on', s > 0);
    this.el.classList.toggle('blink', s === 2);
  }
}

// Illuminated square push button. `hold` buttons report down and up (trigger), others click on press.
export class Btn {
  constructor({ ru, en, color = 'amber', hold = false, onClick, onDown, onUp, cls = '' }) {
    this.el = el('button', `btn ${color} ${cls}`);
    this.el.type = 'button';
    this.el.tabIndex = -1;
    this.face = el('span', 'face');
    this.lbl = label(ru, en);
    this.face.append(this.lbl);
    this.el.append(this.face);
    this.held = false;
    this.disabled = false;
    this.lit = false;
    const down = (e) => {
      if (this.disabled || this.held) return;
      e.preventDefault();
      try { this.el.setPointerCapture(e.pointerId); } catch (err) { /* synthetic events */ }
      this.held = true;
      this.el.classList.add('down');
      snd('button');
      if (onDown) onDown();
      if (!hold && onClick) onClick();
    };
    const up = () => {
      if (!this.held) return;
      this.held = false;
      this.el.classList.remove('down');
      if (onUp) onUp();
    };
    this.el.addEventListener('pointerdown', down);
    this.el.addEventListener('pointerup', up);
    this.el.addEventListener('pointercancel', up);
    this.el.addEventListener('lostpointercapture', up);
    this.el.addEventListener('keydown', (e) => e.preventDefault());
  }
  set(lit) { lit = !!lit; if (lit !== this.lit) { this.lit = lit; this.el.classList.toggle('lit', lit); } }
  // visual press from a key (the console sends the command itself)
  press(on) { this.el.classList.toggle('down', on); }
  enable(on) { if (this.disabled === !on) return; this.disabled = !on; this.el.classList.toggle('dis', !on); }
  // relabel the face (a button whose meaning changes with the situation)
  text(ru, en) { setText(this.lbl.firstChild, ru); setText(this.lbl.lastChild, en); }
}

// Toggle switch, optionally under a hinged guard cover (flip the cover, then the switch).
export class Toggle {
  constructor({ ru, en, onChange, guard = false, color = 'green' }) {
    this.el = el('div', `tog ${color}`);
    const well = el('div', 'well');
    this.lever = el('div', 'lever');
    this.pilot = el('i', 'pilot');
    well.append(this.lever);
    this.guardEl = null;
    this.open = !guard;
    this.on = false;
    if (guard) {
      this.guardEl = el('div', 'guard');
      well.append(this.guardEl);
    }
    this.el.append(well, this.pilot, label(ru, en));
    this.onChange = onChange;
    this.timer = 0;
    well.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (!this.open) { this.setOpen(true); snd('switch'); return; }
      snd('switch');
      if (guard) this.arm();
      onChange(!this.on);
    });
  }
  arm() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.setOpen(false), 4500);
  }
  setOpen(o) {
    this.open = o;
    if (this.guardEl) this.guardEl.classList.toggle('open', o);
    if (o) this.arm();
  }
  set(on) {
    on = !!on;
    if (on === this.on && this._init) return;
    this._init = true;
    this.on = on;
    this.el.classList.toggle('up', on);
  }
  dispose() { clearTimeout(this.timer); }
}

// Row of push buttons of which one is lit (rotary selector).
export class Seg {
  constructor({ items, onChange, color = 'amber', cls = '' }) {
    this.el = el('div', `seg ${cls}`);
    this.btns = new Map();
    this.cur = null;
    for (const it of items) {
      const b = el('button', `sbtn ${it.color || color}`);
      b.type = 'button';
      b.tabIndex = -1;
      b.append(label(it.ru, it.en));
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        snd('click');
        onChange(it.v);
      });
      b.addEventListener('keydown', (e) => e.preventDefault());
      this.el.append(b);
      this.btns.set(it.v, b);
    }
  }
  set(v) {
    if (v === this.cur) return;
    this.cur = v;
    for (const [k, b] of this.btns) b.classList.toggle('lit', k === v);
  }
}

// Amber numeric readout with unlit "8" segments ghosted behind the value.
export class Readout {
  constructor(ru, en, tpl, unit = '', cls = '') {
    this.el = el('div', 'ro ' + cls);
    this.tpl = tpl;
    const d = el('div', 'disp');
    this.ghost = el('span', 'ghost', tpl.replace(/[0-9]/g, '8'));
    this.val = el('span', 'val');
    d.append(this.ghost, this.val);
    this.el.append(d);
    if (unit) this.el.append(el('span', 'unit', unit));
    if (ru) this.el.append(label(ru, en));
    this.n = tpl.length;
  }
  set(text) {
    text = String(text);
    if (text.length < this.n) text = text.padStart(this.n, ' ');
    setText(this.val, text);
  }
}

// Segmented LED bar. Colour follows the fill: green, amber below 60%, red below 30% unless `invert`.
export class Bar {
  constructor({ segs = 20, cls = '', invert = false, text = true } = {}) {
    this.el = el('div', 'bar ' + cls);
    this.segs = [];
    const row = el('div', 'segs');
    for (let i = 0; i < segs; i++) { const s = el('i'); row.append(s); this.segs.push(s); }
    this.el.append(row);
    this.txt = text ? el('span', 'btxt') : null;
    if (this.txt) this.el.append(this.txt);
    this.n = -1;
    this.lvl = '';
    this.invert = invert;
  }
  set(frac, text) {
    frac = Math.max(0, Math.min(1, frac || 0));
    const n = Math.round(frac * this.segs.length);
    const f = this.invert ? 1 - frac : frac;
    const lvl = f < 0.3 ? 'lo' : f < 0.6 ? 'mid' : 'hi';
    if (n !== this.n || lvl !== this.lvl) {
      const a = this.segs;
      for (let i = 0; i < a.length; i++) a[i].classList.toggle('on', i < n);
      this.n = n;
      if (lvl !== this.lvl) {
        if (this.lvl) this.el.classList.remove(this.lvl);
        this.el.classList.add(lvl);
        this.lvl = lvl;
      }
    }
    if (this.txt && text != null) setText(this.txt, text);
  }
}

// A rack of missile cells; the first `ready` are lit, `busy` pulses the next one (reloading).
export class Rack {
  constructor(n, cls = '') {
    this.el = el('div', 'rack ' + cls);
    this.cells = [];
    for (let i = 0; i < n; i++) { const c = el('i', 'cell'); this.el.append(c); this.cells.push(c); }
    this.k = -1;
  }
  set(ready, busy = false) {
    const k = ready * 2 + (busy ? 1 : 0);
    if (k === this.k) return;
    this.k = k;
    const a = this.cells;
    for (let i = 0; i < a.length; i++) {
      a[i].classList.toggle('on', i < ready);
      a[i].classList.toggle('busy', busy && i === ready);
    }
  }
}

export const fmtKm = (m) => (m == null || !isFinite(m) ? '--' : (m / 1000).toFixed(m < 99950 ? 1 : 0));
export const fmtAlt = (m) => (m == null || !isFinite(m) ? '--' : m < 1000 ? String(Math.round(m)) : (m / 1000).toFixed(1) + 'k');
export const fmtTti = (s) => {
  if (s == null || !isFinite(s) || s < 0) return '--';
  s = Math.round(s);
  return s >= 60 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : `${s}s`;
};
export const pad3 = (n) => String(Math.round(n)).padStart(3, '0');
export const DEG = Math.PI / 180;
export const wrapPi = (a) => { a = (a + Math.PI) % (Math.PI * 2); if (a < 0) a += Math.PI * 2; return a - Math.PI; };
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
