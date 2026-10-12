// Tor-M2 console: search PPI with the tracking array's sector drawn on it, four tracking channels with lock
// lamps, the eight vertical cells, radar and mode switches, launch / salvo / cease / reload.
import './tor.css';
import { el, setText, setCls, plate, label, Lamp, Btn, Toggle, Seg, Readout, Bar, wrapPi, DEG, fmtKm, fmtTti } from '../widgets.js';
import { Scope } from '../scope.js';
import { TrackTable } from '../tracktable.js';
import { tut } from '../highlight.js';
import { SYSTEMS } from '../../sim/systems.js';
import { Header, SelBar, abbrev, engagedSet, selectedTrack, threatOrder, reloadFrac, takeManual, MODE_ITEMS } from './common.js';

const MODES = ['auto', 'manual', 'hold'];
const TAU = Math.PI * 2;
const CH = 4;
const SEC = (SYSTEMS.tor && SYSTEMS.tor.track && SYSTEMS.tor.track.sector) || 0.9;
const TRK_RANGE = (SYSTEMS.tor && SYSTEMS.tor.track && SYSTEMS.tor.track.range) || 18000;
const CLS3 = { aircraft: 'AIR', cruise: 'CM', drone: 'UAV', arm: 'ARM', tbm: 'BM', helo: 'HEL', bomb: 'BMB', unknown: 'UNK', decoy: 'AIR', atgm: 'ATG' };
const ST = {
  aligning: ['ЗАХВАТ', 'ACQUIRE', 'amber'],
  launch: ['ПУСК', 'LAUNCH', 'red'],
  flying: ['ПОЛЁТ', 'IN FLIGHT', 'amber'],
  kill: ['ПОРАЖ', 'KILL', 'green'],
  miss: ['ПРОМАХ', 'MISS', 'red'],
};

// the eight cells: lit while the round is in; one pulses while the loader works
class Cells {
  constructor() {
    this.el = el('div', 'rack p8');
    this.cells = [];
    for (let i = 0; i < 8; i++) { const c = el('i', 'cell'); this.el.append(c); this.cells.push(c); }
    this.k = '';
  }
  set(slots, busy) {
    let k = busy ? 'b' : 'n';
    for (let i = 0; i < 8; i++) k += slots[i] ? '1' : '0';
    if (k === this.k) return;
    this.k = k;
    let pulsed = false;
    for (let i = 0; i < 8; i++) {
      const on = !!slots[i];
      this.cells[i].classList.toggle('on', on);
      const p = busy && !on && !pulsed;
      if (p) pulsed = true;
      this.cells[i].classList.toggle('busy', p);
    }
  }
}

export function mountTor(ctx) {
  const { send, memo } = ctx;
  const root = el('div', 'con tor');
  const hdr = new Header('ТОР-М2', 'TOR-M2 9K332M');
  let u = null;
  if (!memo.range) memo.range = 30000;

  // search PPI, with the tracking array's sector laid over it
  const pp = plate('ИНДИКАТОР ОБЗОРА', 'SEARCH PPI', 'pl-ppi');
  const scope = new Scope({ size: 340, range: memo.range, rings: 3, theme: 'green', fused: false, period: 1.2 });
  scope.canvas.addEventListener('pointerdown', (e) => {
    const id = scope.pick(e.clientX, e.clientY);
    if (id != null) { e.preventDefault(); send('select', { trackId: id }); }
  });
  scope.canvas.style.cursor = 'crosshair';
  const sec = el('canvas', 'secv');
  scope.el.append(sec);
  const sctx = sec.getContext('2d');
  let secKey = '';
  const rangeSeg = new Seg({ cls: 'compact', items: [15, 30].map((k) => ({ v: k * 1000, ru: `${k} КМ`, en: 'RANGE' })), onChange: (v) => { memo.range = v; } });
  const ppRow = el('div', 'rowc');
  ppRow.append(label('ШКАЛА ДАЛЬНОСТИ', 'RANGE SCALE', 'cap'), rangeSeg.el);
  pp.body.append(scope.el, ppRow);
  tut(scope.el, 'scope');
  tut(rangeSeg.el, 'range');

  const pt = plate('ТАБЛИЦА ЦЕЛЕЙ', 'TRACKS', 'pl-table');
  const table = new TrackTable({ cols: ['id', 'cls', 'rng', 'brg', 'alt', 'tti', 'eng'], sort: 'tti', onPick: (id) => send('select', { trackId: id }), abbrev });
  pt.body.append(table.el);
  tut(table.el, 'tracks');
  const lc = el('div', 'col leftc');
  lc.append(pp.el, pt.el);

  // tracking channels: up to four targets held at once inside the sector
  const pc = plate('КАНАЛЫ СОПРОВОЖДЕНИЯ', 'TRACKING CHANNELS, 4 TARGETS', 'pl-ch');
  const chs = [];
  const chBox = el('div', 'chlist');
  const chHead = el('div', 'chrow chhead');
  for (const [ru, en] of [['КАН', 'CH'], ['ЗАХВАТ', 'LOCK'], ['ЦЕЛЬ', 'TRACK'], ['ДАЛЬ', 'KM'], ['ВРЕМЯ', 'TTI'], ['ФАЗА', 'PHASE']]) chHead.append(label(ru, en, 'cap'));
  chBox.append(chHead);
  for (let i = 0; i < CH; i++) {
    const row = el('div', 'chrow');
    const no = el('b', 'chno', String(i + 1));
    const lamp = new Lamp('ЗАХВАТ', 'LOCK', 'green', 'chl');
    const id = el('span', 'chid');
    const rng = el('span', 'chrng');
    const tti = el('span', 'chtti');
    const ph = el('span', 'chph');
    row.append(no, lamp.el, id, rng, tti, ph);
    chBox.append(row);
    chs.push({ row, lamp, id, rng, tti, ph });
  }
  const secRow = el('div', 'rowc secrow');
  const secLamp = new Lamp('В СЕКТОРЕ', 'TARGET IN SECTOR', 'green', 'wide');
  const secTxt = el('span', 'sectxt');
  secRow.append(secLamp.el, secTxt);
  pc.body.append(chBox, secRow);
  tut(pc.el, 'channels');
  tut(secRow, 'sector');

  // radars and mode
  const ps = plate('РЛС И РЕЖИМ', 'RADARS AND MODE', 'pl-sw');
  const search = new Toggle({ ru: 'ПОИСК', en: 'SEARCH RADAR', color: 'green', onChange: (on) => send('radar', { on }) });
  const track = new Toggle({ ru: 'СОПР', en: 'TRACK ARRAY', color: 'amber', onChange: (on) => { if (!on) takeManual(u, send); send('track', { on }); } });
  const mode = new Seg({ cls: 'stack', items: MODE_ITEMS, onChange: (v) => send('mode', { mode: v }) });
  const sw = el('div', 'rowc');
  sw.append(search.el, track.el, mode.el);
  ps.body.append(sw);
  tut(search.el, 'search');
  tut(track.el, 'track-radar');
  tut(mode.el, 'mode');

  // cells and fire controls
  const pm = plate('РАКЕТЫ 9М338К', 'VERTICAL CELLS', 'pl-weap');
  const cells = new Cells();
  const rRdy = new Readout('НА ПУ', 'READY', '8', '', 'sm');
  const rRes = new Readout('ЗАПАС', 'RESERVE', '88', '', 'sm');
  const rl = new Bar({ segs: 12, cls: 'reload', text: false });
  const rlTxt = el('span', 'telst');
  const rlr = el('div', 'col tight');
  rlr.append(label('ПЕРЕЗАРЯДКА', 'RELOAD', 'cap'), rl.el, rlTxt);
  const selId = new Readout('ЦЕЛЬ', 'TRACK', '888', '', 'sm');
  const selRng = new Readout('ДАЛЬН', 'KM', '888.8', '', 'sm');
  const selTti = new Readout('ВРЕМЯ', 'TTI', '8:88', '', 'sm');
  const sr = el('div', 'rowc');
  sr.append(selId.el, selRng.el, selTti.el);
  tut(sr, 'sel');
  const mr = el('div', 'rowc');
  mr.append(rRdy.el, rRes.el, rlr);
  const ENG = [['aligning', 'НАВЕД', 'ALIGN', 'amber'], ['launch', 'ПУСК', 'LAUNCH', 'red'], ['flying', 'ПОЛЁТ', 'FLIGHT', 'amber'], ['kill', 'ПОРАЖ', 'KILL', 'green'], ['miss', 'ПРОМАХ', 'MISS', 'red']];
  const engLamps = {};
  const eg = el('div', 'rowc englamps');
  for (const [k, ru, en, col] of ENG) { engLamps[k] = new Lamp(ru, en, col); eg.append(engLamps[k].el); }
  tut(eg, 'eng-lamps');
  const l1 = new Btn({ ru: 'ПУСК 1', en: 'LAUNCH 1 MISSILE', color: 'amber', cls: 'big', onClick: () => launch(1) });
  const l2 = new Btn({ ru: 'ПУСК 2', en: 'LAUNCH SALVO OF 2', color: 'red', cls: 'big', onClick: () => launch(2) });
  const cease = new Btn({ ru: 'ОТБОЙ', en: 'CEASE FIRE ON TRACK', color: 'white', onClick: () => doCease() });
  const reload = new Btn({ ru: 'ЗАРЯДКА', en: 'RELOAD CELLS', color: 'green', onClick: () => send('reload', {}) });
  const bt = el('div', 'rowc btns');
  bt.append(l1.el, l2.el, cease.el, reload.el);
  pm.body.append(sr, cells.el, mr, eg, bt);
  tut(l1.el, 'launch');
  tut(l2.el, 'salvo');
  tut(cease.el, 'cease');
  tut(reload.el, 'reload');
  tut(cells.el, 'stock');

  const right = el('div', 'col rightc');
  right.append(pc.el, ps.el, pm.el);
  const main = el('div', 'row main2');
  main.append(lc, right);

  const keys = el('div', 'helpline', 'TAB: NEXT TRACK   SPACE: LAUNCH (SHIFT = 2)   X: CEASE   T: TRACK ARRAY   R: SEARCH RADAR   A: MODE   L: RELOAD');
  const selBar = new SelBar();
  tut(selBar.el, 'selbar');
  tut(hdr.el, 'header');
  root.append(hdr.el, selBar.el, main, keys);

  function launch(n) {
    if (!u) return;
    if (u.selected == null) {
      const l = threatOrder(u.tracks || []);
      if (l.length) send('select', { trackId: l[0].id });
      return;
    }
    takeManual(u, send, true);
    send('engage', { trackId: u.selected, salvo: n });
  }
  function doCease() { if (u && u.selected != null) send('cease', { trackId: u.selected }); }

  // compass bearing (rad) of the array's bore: the turret turns against the hull heading
  const bore = () => ((-(u.turret ? u.turret.az : 0) - (u.heading || 0)) % TAU + TAU) % TAU;
  const secDiff = (t) => wrapPi(-(t.bearing || 0) * DEG - (u.heading || 0) - (u.turret ? u.turret.az : 0));

  function drawSector(live) {
    const S = scope.S;
    const k = scope.k || 1;
    const w = Math.round(S * k);
    const key = `${w}|${memo.range}|${Math.round(bore() * 200)}|${live}`;
    if (key === secKey) return;
    secKey = key;
    if (sec.width !== w) { sec.width = sec.height = w; }
    sctx.setTransform(k, 0, 0, k, 0, 0);
    sctx.clearRect(0, 0, S, S);
    const r = Math.min(scope.R, (TRK_RANGE / memo.range) * scope.R);
    const b = bore();
    const a0 = b - SEC - Math.PI / 2, a1 = b + SEC - Math.PI / 2;
    sctx.beginPath();
    sctx.moveTo(scope.cx, scope.cy);
    sctx.arc(scope.cx, scope.cy, r, a0, a1);
    sctx.closePath();
    sctx.fillStyle = live ? 'rgba(255,186,64,0.08)' : 'rgba(255,186,64,0.035)';
    sctx.fill();
    sctx.strokeStyle = live ? 'rgba(255,186,64,0.75)' : 'rgba(255,186,64,0.35)';
    sctx.lineWidth = 1;
    if (!live) sctx.setLineDash([4, 4]);
    sctx.stroke();
    sctx.setLineDash([]);
    // bore
    sctx.beginPath();
    sctx.moveTo(scope.cx, scope.cy);
    sctx.lineTo(scope.cx + Math.sin(b) * r, scope.cy - Math.cos(b) * r);
    sctx.strokeStyle = 'rgba(255,200,110,0.55)';
    sctx.stroke();
  }

  return {
    el: root,
    key(e, down) {
      if (!down || !u) return false;
      switch (e.code) {
        case 'Space': launch(e.shiftKey ? 2 : 1); l1.press(true); setTimeout(() => l1.press(false), 120); return true;
        case 'KeyR': send('radar', { on: !(u.radar && u.radar.search) }); return true;
        case 'KeyT': if (u.radar && u.radar.track) takeManual(u, send); send('track', { on: !(u.radar && u.radar.track) }); return true;
        case 'KeyA': send('mode', { mode: MODES[(MODES.indexOf(u.mode) + 1) % 3] }); return true;
        case 'KeyL': send('reload', {}); return true;
        case 'KeyX': doCease(); return true;
        default: return false;
      }
    },
    update(dt, unit, data) {
      u = unit;
      const tracks = u.tracks || [];
      hdr.update(u, tracks);
      scope.setRange(memo.range);
      rangeSeg.set(memo.range);
      scope.update(dt, u, { tracks, selected: u.selected, engaged: engagedSet(u) });
      table.update(dt, tracks, u.selected);
      const t = selectedTrack(u, tracks);
      selBar.update(u, t, data);
      const trOn = !!(u.radar && u.radar.track);
      const engs = (u.engagements || []).slice().sort((a, b) => (b.state === 'kill' || b.state === 'miss' ? 0 : 1) - (a.state === 'kill' || a.state === 'miss' ? 0 : 1));
      const live = engs.some((e) => e.state === 'aligning' || e.state === 'launch' || e.state === 'flying');
      drawSector(live);

      // channels
      for (let i = 0; i < CH; i++) {
        const c = chs[i];
        const e = engs[i];
        const tr = e ? tracks.find((x) => x.id === e.trackId) : null;
        setCls(c.row, 'busy', !!e);
        if (!e) {
          c.lamp.set(0);
          setText(c.id, 'СВОБОДЕН');
          setText(c.rng, '');
          setText(c.tti, '');
          setText(c.ph, 'FREE');
          setCls(c.ph, 'hot', false);
          continue;
        }
        const st = ST[e.state] || ST.aligning;
        const held = trOn && (e.state === 'launch' || e.state === 'flying' || (tr && e.state === 'aligning' && u.channel && u.channel.locked));
        c.lamp.set(e.state === 'kill' ? 1 : held ? 1 : e.state === 'miss' ? 0 : 2);
        setText(c.id, `${String(e.trackId).padStart(3, '0')} ${tr ? CLS3[tr.cls] || '' : ''}`);
        setText(c.rng, tr ? fmtKm(tr.range) : '--');
        setText(c.tti, tr ? fmtTti(tr.tti).replace('s', '') : '--');
        setText(c.ph, st[0]);
        setCls(c.ph, 'hot', e.state === 'miss');
        setCls(c.ph, 'ok', e.state === 'kill');
      }
      // is the selected track inside the array's sector?
      let inSec = null;
      if (t) inSec = Math.abs(secDiff(t)) < SEC * 0.8;
      secLamp.set(t ? (inSec || !live ? 1 : 2) : 0);
      secLamp.text(!t ? 'СЕКТОР' : inSec ? 'В СЕКТОРЕ' : live ? 'ВНЕ СЕКТОРА' : 'ПОВОРОТ ПУ', !t ? 'NO TARGET SELECTED' : inSec ? 'TARGET IN SECTOR' : live ? 'OUT: ENGAGEMENT BLOCKED' : 'TURRET TURNS TO TARGET');
      const az = Math.round(((bore() / DEG) % 360 + 360) % 360);
      setText(secTxt, `ОСЬ ${String(az).padStart(3, '0')}°  СЕКТОР ±${Math.round(SEC / DEG)}°\nBORE  /  SECTOR HALF-WIDTH`);

      search.set(u.radar && u.radar.search);
      track.set(trOn);
      mode.set(u.mode);

      // cells
      const m = (u.weapons && u.weapons.missiles) || { ready: 0, reserve: 0, reload: 0 };
      const slots = (u.parts && u.parts[0] && u.parts[0].slots) || [];
      const have = slots.length ? slots : Array.from({ length: 8 }, (_, i) => i < m.ready);
      cells.set(have, m.reload > 0);
      rRdy.set(m.ready);
      rRes.set(m.reserve == null ? 0 : m.reserve);
      rl.set(reloadFrac(memo, 'tor', m.reload));
      setText(rlTxt, m.reload > 0 ? `${Math.ceil(m.reload)} с` : m.ready === 0 ? 'ПУСТО' : 'ГОТОВО');
      const can = !!t && m.ready > 0 && m.reload <= 0 && u.alive !== false;
      l1.enable(can); l2.enable(can && m.ready > 1);
      l1.set(t && t.engagedBy && t.engagedBy.includes(u.id));
      cease.enable(!!t);
      reload.set(m.reload > 0);
      selId.set(t ? String(t.id).padStart(3, '0') : '---');
      selRng.set(t ? fmtKm(t.range) : '--');
      selTti.set(t ? fmtTti(t.tti).replace('s', '') : '--');
      const ev = engs.find((x) => x.trackId === u.selected) || engs[0];
      for (const k in engLamps) engLamps[k].set(ev && ev.state === k ? 1 : 0);
    },
    dispose() { search.dispose(); track.dispose(); },
  };
}
