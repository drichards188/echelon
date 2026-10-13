// The right half of the screen: a unit selector strip and the selected unit's control console.
// Driven only by panel.update() data; talks back only through onSelect and onCommand.
import './panel.css';
import { UNITS, ERA } from '../deploy.js';
import { el, hw, snd, setText, setCls, Bar, Led, label } from './widgets.js';
import { SIGHT_W, SIGHT_H } from './sightview.js';
import { threatOrder, alertSevere } from './consoles/common.js';
import { mountS400 } from './consoles/s400.js';
import { mountPantsir } from './consoles/pantsir.js';
import { mountOsa } from './consoles/osa.js';
import { mountStrela } from './consoles/strela.js';
import { mountTunguska } from './consoles/tunguska.js';
import { mountShilka } from './consoles/shilka.js';
import { mountBuk } from './consoles/buk.js';
import { mountTor } from './consoles/tor.js';
import { applyHighlight } from './highlight.js';
import { mountFallback } from './fallback.js';

const DESIGN_W = 760;
const DESIGN_H = 860;
// The consoles by unit kind (a global registry: each era lists the kinds it uses), the tab's type label
// and the kinds whose console shows a sight picture. An era's lazily loaded content adds its own with
// registerConsole.
const MOUNT = { s400: mountS400, pantsir: mountPantsir, osa: mountOsa, strela: mountStrela, tunguska: mountTunguska, shilka: mountShilka, buk: mountBuk, tor: mountTor };
const TYPE_LABEL = { s400: 'С-400', pantsir: 'ПАНЦИРЬ-С1', osa: 'ОСА-АКМ', strela: 'СТРЕЛА-10М3', tunguska: 'ТУНГУСКА-М', shilka: 'ШИЛКА-М4', buk: 'БУК-М2', tor: 'ТОР-М2' };
const SIGHT_KINDS = new Set(['pantsir', 'strela', 'tunguska', 'shilka']);

/** Registers the console of a unit kind: mount({ id, send, memo, sight }) -> { el, update, key, dispose? }. */
export function registerConsole(kind, { mount, label = kind, sight = false }) {
  MOUNT[kind] = mount;
  TYPE_LABEL[kind] = label;
  if (sight) SIGHT_KINDS.add(kind);
}

// UNITS changes in place with the loadout (deploy.js): look kinds up when needed
const kindOf = (id) => UNITS.find((u) => u.id === id)?.kind;
const STATE_RU = { brief: 'ИНСТРУКТАЖ', raid: 'НАЛЁТ', wave: 'НАЛЁТ', lull: 'ПАУЗА', victory: 'ПОБЕДА', defeat: 'ПОРАЖЕНИЕ' };
const STATE_EN = { brief: 'BRIEFING', raid: 'RAID', wave: 'RAID', lull: 'LULL, RELOAD NOW', victory: 'VICTORY', defeat: 'DEFEAT' };
// the status strip in the era's own language: ERA.text.strip { state: { [state]: [caption, English] }, wave,
// score: [caption, English] } when the era has one (the WW2 era's German), else the cabin's Russian above
const strip = () => ERA.text.strip ?? null;
const TAB_HINT = { emit: 'Radar emitting (visible to anti-radar missiles)', eng: 'Engaging a target', alert: 'Alert: open this console' };

function ammoFrac(u) {
  const w = u.weapons || {};
  const fr = [];
  const m = w.missiles;
  const one = (s) => {
    const have = (s.ready || 0) + (s.reserve || 0);
    return { have, cap: Math.max(s.max || 0, have, 1) };
  };
  if (m) {
    if (typeof m.ready === 'number') { const o = one(m); fr.push(o.have / o.cap); }
    else {
      let h = 0, c = 0;
      for (const k in m) { if (m[k] && typeof m[k].ready === 'number') { const o = one(m[k]); h += o.have; c += o.cap; } }
      if (c) fr.push(h / c);
    }
  }
  if (w.gun && w.gun.max) fr.push(w.gun.rounds / w.gun.max);
  return fr.length ? fr.reduce((a, b) => a + b, 0) / fr.length : 1;
}

export class Panel {
  constructor(root, opts = {}) {
    this.root = root;
    this.opts = opts;
    hw.audio = opts.audio || null;
    root.classList.add('pn-root');
    this.setTheme(ERA.theme);
    this.scaleEl = el('div', 'pn-scale');
    this.tabsEl = el('div', 'tabs');
    this.host = el('div', 'conhost');
    this.scaleEl.append(this.tabsEl, this.host);
    root.append(this.scaleEl);
    this.tabs = new Map();
    this.tabIds = '';
    this.mounted = null;
    this.memo = {};
    this.sights = {};
    this.alertSeen = new Map();
    this.primed = false;
    this.data = null;
    this.ro = null;
    this.t = 0;

    const fit = () => {
      const w = root.clientWidth, h = root.clientHeight;
      if (!w || !h) return;
      const s = Math.max(0.55, Math.min(1.5, Math.min(w / DESIGN_W, h / DESIGN_H)));
      hw.scale = s;
      const st = this.scaleEl.style;
      st.width = `${w / s}px`;
      st.height = `${h / s}px`;
      st.transform = `scale(${s})`;
    };
    fit();
    if (typeof ResizeObserver !== 'undefined') { this.ro = new ResizeObserver(fit); this.ro.observe(root); }
    else window.addEventListener('resize', fit);

    this._kd = (e) => this._key(e, true);
    this._ku = (e) => this._key(e, false);
    this._blur = () => {
      const c = this.mounted && this.mounted.con;
      if (!c) return;
      for (const code of ['Space', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']) c.key({ code }, false);
    };
    // a second Panel (hot reload, a restart) must not leave the first one's key handlers behind
    if (window.__echelonPanel && window.__echelonPanel !== this) window.__echelonPanel.dispose();
    window.__echelonPanel = this;
    window.addEventListener('keydown', this._kd);
    window.addEventListener('keyup', this._ku);
    window.addEventListener('blur', this._blur);
  }

  // Fixed-size canvas for the EO/IR sight image; the console overlays its own reticle on top.
  sightCanvas(unitId) {
    const kind = kindOf(unitId);
    if (!SIGHT_KINDS.has(kind)) return null;
    let c = this.sights[unitId];
    if (!c) {
      c = document.createElement('canvas');
      c.width = SIGHT_W;
      c.height = SIGHT_H;
      const g = c.getContext('2d');
      g.fillStyle = '#10140e';
      g.fillRect(0, 0, c.width, c.height);
      this.sights[unitId] = c;
    }
    return c;
  }

  // After a loadout change (main.js, once UNITS holds the new units): the tabs, the console and the
  // alert memory are built again for them on the next update; sight canvases stay keyed by unit id.
  setUnits() {
    if (this.mounted && this.mounted.con.dispose) this.mounted.con.dispose();
    this.mounted = null;
    this.host.replaceChildren();
    this.tabIds = '';
    this.alertSeen.clear();
    this.primed = false;
  }

  // The era's console theme: the class `era-<theme>` on the panel's root, for the era's CSS (main.js puts
  // the same class on the page).
  setTheme(theme) {
    for (const c of [...this.root.classList]) if (c.startsWith('era-')) this.root.classList.remove(c);
    if (theme) this.root.classList.add(`era-${theme}`);
  }

  dispose() {
    window.removeEventListener('keydown', this._kd);
    window.removeEventListener('keyup', this._ku);
    window.removeEventListener('blur', this._blur);
    if (this.ro) this.ro.disconnect();
    if (this.mounted) this.mounted.con.dispose && this.mounted.con.dispose();
    if (window.__echelonPanel === this) window.__echelonPanel = null;
  }

  _send(id, name, args) {
    if (this.opts.onCommand) this.opts.onCommand(id, name, args);
  }

  // Keys are ignored while a text field, a select or the settings GUI has focus, but releases always get
  // through so a held trigger or slew key can never stick.
  _key(e, down) {
    const tg = e.target;
    if (down && tg && tg.nodeType === 1) {
      const tag = tg.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'BUTTON' || tg.isContentEditable || (tg.closest && tg.closest('.lil-gui'))) return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey || !this.mounted || !this.data) return;
    const code = e.code;
    if (code === 'Tab') {
      if (!down) return;
      e.preventDefault();
      if (!e.repeat) this._cycle(e.shiftKey ? -1 : 1);
      return;
    }
    if (down && e.repeat && code.slice(0, 5) !== 'Arrow') {
      if (code === 'Space') e.preventDefault();
      return;
    }
    if (this.mounted.con.key(e, down)) e.preventDefault();
  }

  _cycle(dir) {
    const d = this.data;
    const u = d.units.find((x) => x.id === this.mounted.id);
    if (!u) return;
    // own tracks only: the sim rejects a command on a track the unit does not hold (the Strela has no radar)
    const list = threatOrder(u.kind === 'strela' ? d.picture || [] : u.tracks || []);
    if (!list.length) return;
    let i = list.findIndex((t) => t.id === u.selected);
    i = i < 0 ? (dir > 0 ? 0 : list.length - 1) : (i + dir + list.length) % list.length;
    snd('click');
    this._send(u.id, 'select', { trackId: list[i].id });
  }

  _buildTabs(units) {
    this.tabsEl.replaceChildren();
    this.tabs.clear();
    units.forEach((u, i) => {
      const t = el('div', 'tab');
      const key = el('span', 'tkey', String(i + 1));
      const main = el('div', 'tmain');
      const call = el('b', 'tcall');
      const type = el('i', 'ttype', TYPE_LABEL[u.kind] || u.kind);
      main.append(call, type);
      const hp = new Bar({ segs: 8, cls: 'mini', text: false });
      const am = new Bar({ segs: 8, cls: 'mini ammo', text: false });
      const bars = el('div', 'tbars');
      const r1 = el('div', 'trow');
      r1.append(el('i', 'tcap', 'HP'), hp.el);
      const r2 = el('div', 'trow');
      r2.append(el('i', 'tcap', 'AMMO'), am.el);
      bars.append(r1, r2);
      const led = el('div', 'tleds');
      const emit = new Led('green'), eng = new Led('amber'), alert = new Led('red');
      emit.el.title = TAB_HINT.emit; eng.el.title = TAB_HINT.eng; alert.el.title = TAB_HINT.alert;
      led.append(emit.el, eng.el, alert.el);
      t.append(key, main, bars, led);
      t.dataset.tut = `tabs tab-${u.id}`;
      t.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        snd('click');
        if (this.opts.onSelect) this.opts.onSelect(u.id);
      });
      this.tabsEl.append(t);
      this.tabs.set(u.id, { el: t, call, hp, am, emit, eng, alert });
    });
    this.status = el('div', 'tstatus');
    applyHighlight();
    this.stWave = el('b', 'swave');
    this.stScore = el('span', 'sscore');
    this.stState = el('i', 'sstate');
    this.stEn = el('i', 'sen');
    const S = strip();
    this.status.append(this.stState, this.stEn, this.stWave, label(S?.score?.[0] ?? 'ОЧКИ', S?.score?.[1] ?? 'SCORE', 'cap'), this.stScore);
    this.tabsEl.append(this.status);
  }

  // Sirens on new alerts; the key string keeps this free of allocations while nothing changes.
  _alerts(units) {
    for (const u of units) {
      const dead = u.alive === false;
      const key = dead ? '__dead' : (u.alerts && u.alerts.length ? u.alerts.join('|') : '');
      const prev = this.alertSeen.get(u.id);
      if (key === prev) continue;
      this.alertSeen.set(u.id, key);
      if (!this.primed || !key) continue;
      const old = prev ? prev.split('|') : [];
      for (const a of key.split('|')) {
        if (!old.includes(a)) snd(a === '__dead' || alertSevere(a) ? 'alarm' : 'warning');
      }
    }
    this.primed = true;
  }

  update(dt, data) {
    const units = data && data.units;
    if (!units || !units.length) return;
    this.data = data;
    const ids = units.map((u) => u.id).join(',');
    if (ids !== this.tabIds) { this._buildTabs(units); this.tabIds = ids; }
    this._alerts(units);

    for (const u of units) {
      const t = this.tabs.get(u.id);
      setText(t.call, (u.callsign || u.id).toUpperCase());
      t.hp.set(u.maxHp ? u.hp / u.maxHp : 1);
      t.am.set(ammoFrac(u));
      const dead = u.alive === false;
      t.emit.set(u.radar && (u.radar.search || u.radar.track) ? 1 : 0);
      t.eng.set(u.engagements && u.engagements.length ? 1 : 0);
      t.alert.set(u.alerts && u.alerts.length ? 2 : 0);
      setCls(t.el, 'sel', u.id === data.selectedId);
      setCls(t.el, 'dead', dead);
      setCls(t.el, 'warn', !!(u.alerts && u.alerts.length));
    }
    const w = data.wave, S = strip(), W = S?.wave ?? 'ВОЛНА';
    setText(this.stWave, w == null ? '' : typeof w === 'object' ? `${W} ${w.n != null ? w.n : w.index != null ? w.index : ''}` : `${W} ${w}`);
    const sc = data.score;
    setText(this.stScore, sc == null ? '0' : typeof sc === 'object' ? String(sc.score != null ? sc.score : sc.points != null ? sc.points : sc.total != null ? sc.total : 0) : String(Math.round(sc)));
    const SS = S?.state?.[data.state];
    setText(this.stState, data.state ? (SS?.[0] ?? (STATE_RU[data.state] || String(data.state).toUpperCase())) : '');
    setText(this.stEn, data.state ? (SS?.[1] ?? (STATE_EN[data.state] || '')) : '');

    const sel = units.find((u) => u.id === data.selectedId) || units[0];
    if (!this.mounted || this.mounted.id !== sel.id) {
      if (this.mounted && this.mounted.con.dispose) this.mounted.con.dispose();
      this.host.replaceChildren();
      const mount = MOUNT[sel.kind] || mountFallback;
      if (mount) {
        const memo = this.memo[sel.id] || (this.memo[sel.id] = {});
        const con = mount({ id: sel.id, send: (name, args) => this._send(sel.id, name, args), memo, sight: this.sightCanvas(sel.id) });
        this.host.append(con.el);
        this.mounted = { id: sel.id, con };
        applyHighlight();
      } else this.mounted = null;
    }
    if (this.mounted) this.mounted.con.update(dt, sel, data);
  }
}
