// Buk-M2 battery command post: the search radar's PPI and the track table, per-vehicle status (each TELAR's
// radar, channel, rounds and health, the loader-launcher and its reload, the search radar, the command
// post), mode, emission control, and engage with a choice of firing vehicle.
import './buk.css';
import { el, setText, setCls, plate, label, Lamp, Btn, Toggle, Seg, Readout, Bar, Rack, Led, fmtKm, fmtTti } from '../widgets.js';
import { Scope } from '../scope.js';
import { TrackTable } from '../tracktable.js';
import { tut } from '../highlight.js';
import { Header, SelBar, abbrev, engagedSet, selectedTrack, threatOrder, reloadFrac, takeManual, MODE_ITEMS } from './common.js';

const MODES = ['auto', 'manual', 'hold'];
const CLS3 = { aircraft: 'AIR', cruise: 'CM', drone: 'UAV', arm: 'ARM', tbm: 'BM', helo: 'HEL', bomb: 'BMB', unknown: 'UNK', decoy: 'AIR', atgm: 'ATG' };
const lit = (a) => { let n = 0; if (a) for (const x of a) if (x) n++; return n; };

export function mountBuk(ctx) {
  const { send, memo } = ctx;
  const root = el('div', 'con buk');
  const hdr = new Header('БУК-М2', 'BUK-M2 9K317M');
  let u = null;
  if (!memo.range) memo.range = 80000;

  // search radar PPI
  const pp = plate('ИНДИКАТОР ОБЗОРА', 'SEARCH RADAR PPI', 'pl-ppi');
  const scope = new Scope({ size: 340, range: memo.range, rings: 4, theme: 'green', fused: true, period: 4 });
  scope.canvas.addEventListener('pointerdown', (e) => {
    const id = scope.pick(e.clientX, e.clientY);
    if (id != null) { e.preventDefault(); send('select', { trackId: id }); }
  });
  scope.canvas.style.cursor = 'crosshair';
  const rangeSeg = new Seg({ cls: 'compact', items: [40, 80, 160].map((k) => ({ v: k * 1000, ru: `${k} КМ`, en: 'RANGE' })), onChange: (v) => { memo.range = v; } });
  const ppRow = el('div', 'rowc');
  ppRow.append(label('ШКАЛА ДАЛЬНОСТИ', 'RANGE SCALE', 'cap'), rangeSeg.el);
  pp.body.append(scope.el, ppRow);
  tut(scope.el, 'scope');
  tut(rangeSeg.el, 'range');

  // controls column
  const ctl = el('div', 'col ctl');

  const pm = plate('РЕЖИМ', 'MODE');
  const mode = new Seg({ cls: 'stack', items: MODE_ITEMS, onChange: (v) => send('mode', { mode: v }) });
  pm.body.append(mode.el);
  tut(pm.el, 'mode');

  const pe = plate('ИЗЛУЧЕНИЕ', 'EMISSION');
  const emit = new Toggle({ ru: 'РЛС ОБЗ', en: 'SEARCH RADAR', guard: true, color: 'red', onChange: (on) => send('radar', { on }) });
  const emitLamp = new Lamp('ИЗЛУЧАЕТ', 'EMITTING', 'green');
  const emitWarn = new Lamp('МОЛЧИТ', 'SILENT, BLIND', 'amber');
  const lc = el('div', 'col tight');
  lc.append(emitLamp.el, emitWarn.el);
  const er = el('div', 'rowc');
  er.append(emit.el, lc);
  const quiet = new Btn({ ru: 'ВСЕ МОЛЧАТ', en: 'ALL RADARS OFF', color: 'red', cls: 'sm', onClick: () => silence() });
  pe.body.append(er, quiet.el);
  tut(emit.el, 'emit');
  tut(er, 'emit-lamps');
  tut(quiet.el, 'silence');

  const rowA = el('div', 'row');
  rowA.append(pm.el, pe.el);

  const pa = plate('ЦЕЛЬ / ПУСК', 'ENGAGE');
  const selId = new Readout('ЦЕЛЬ', 'TRACK', '888', '', 'sm');
  const selRng = new Readout('ДАЛЬН', 'KM', '888.8', '', 'sm');
  const selTti = new Readout('ВРЕМЯ', 'TTI', '8:88', '', 'sm');
  const rdy = new Readout('РАКЕТ', 'READY', '88', '', 'sm');
  const sel = el('div', 'rowc');
  sel.append(selId.el, selRng.el, selTti.el, rdy.el);
  const fireSeg = new Seg({
    cls: 'compact fire',
    items: [{ v: 'best', ru: 'ЛУЧШАЯ', en: 'BEST AVAILABLE' }, { v: 0, ru: 'СОУ 1', en: 'TELAR 1' }, { v: 1, ru: 'СОУ 2', en: 'TELAR 2' }],
    onChange: (v) => pickFire(v),
  });
  const fr = el('div', 'rowc');
  fr.append(label('ПУСКОВАЯ', 'FIRING VEHICLE', 'cap'), fireSeg.el);
  const assign = new Btn({ ru: 'НАЗНАЧ', en: 'NEXT THREAT', color: 'white', onClick: () => doAssign() });
  const l1 = new Btn({ ru: 'ПУСК 1', en: 'LAUNCH 1 MISSILE', color: 'amber', onClick: () => launch(1) });
  const l2 = new Btn({ ru: 'ПУСК 2', en: 'LAUNCH SALVO OF 2', color: 'red', onClick: () => launch(2) });
  const cease = new Btn({ ru: 'ОТБОЙ', en: 'CEASE FIRE ON TRACK', color: 'white', onClick: () => doCease() });
  const br = el('div', 'rowc btns');
  br.append(assign.el, l1.el, l2.el, cease.el);
  pa.body.append(sel, fr, br);
  tut(assign.el, 'next-threat');
  tut(l1.el, 'launch');
  tut(l2.el, 'salvo');
  tut(cease.el, 'cease');
  tut(sel, 'sel');
  tut(fr, 'firing-vehicle');

  ctl.append(rowA, pa.el);
  const main = el('div', 'row main');
  main.append(pp.el, ctl);

  // lower row: track table and the battery's vehicles
  const pt = plate('ТАБЛИЦА ЦЕЛЕЙ', 'TRACK TABLE', 'pl-table');
  const table = new TrackTable({ cols: ['id', 'cls', 'rng', 'alt', 'tti', 'eng'], sort: 'tti', onPick: (id) => send('select', { trackId: id }), abbrev });
  pt.body.append(table.el);
  tut(table.el, 'tracks');

  const pv = plate('БАТАРЕЯ', 'BATTERY VEHICLES', 'pl-veh');
  const tv = [0, 1].map((i) => makeTelar(i));
  const ld = makeLoader();
  const rd = makeSimple('РЛС ОБЗОРА', 'SEARCH RADAR');
  const cp = makeSimple('КП', 'COMMAND POST');
  pv.body.append(tv[0].el, tv[1].el, ld.el, rd.el, cp.el);
  tut(pv.el, 'vehicles');
  const low = el('div', 'row low');
  low.append(pt.el, pv.el);

  const keys = el('div', 'helpline', 'TAB: NEXT TRACK   SPACE: LAUNCH (SHIFT = 2)   X: CEASE   Q: FIRING VEHICLE   T: TELAR RADARS   R: SEARCH RADAR   A: MODE   L: RELOAD');
  const selBar = new SelBar();
  tut(selBar.el, 'selbar');
  tut(hdr.el, 'header');
  root.append(hdr.el, selBar.el, main, low, keys);

  // ---- vehicle blocks
  function head(ru, en) {
    const h = el('div', 'vhead');
    const nm = el('div', 'vname');
    nm.append(el('b', null, ru), el('i', null, en));
    const hp = new Bar({ segs: 8, cls: 'mini', text: false });
    const st = el('span', 'vstate');
    h.append(nm, hp.el, st);
    return { el: h, hp, st };
  }
  function makeTelar(i) {
    const box = el('div', 'veh telar');
    const h = head(`СОУ ${i + 1}`, `TELAR ${i + 1}`);
    const rack = new Rack(4, 'big');
    const lamp = new Lamp('ЗАХВАТ', 'LOCK', 'green', 'chl');
    const tgt = el('span', 'vtgt');
    const radar = new Btn({ ru: 'РЛС', en: 'TRACK RADAR', color: 'amber', cls: 'sm', onClick: () => {
      if (!u) return;
      const p = telarPart(i);
      if (p < 0) return;
      const on = !(u.parts[p].track);
      if (!on) takeManual(u, send);
      send('track', { on, part: p });
    } });
    const rel = new Btn({ ru: 'ЗАРЯДКА', en: 'RELOAD TELAR', color: 'green', cls: 'sm', onClick: () => {
      const p = telarPart(i);
      if (u && p >= 0) send('reload', { part: p });
    } });
    const row = el('div', 'vrow');
    row.append(rack.el, lamp.el, tgt, radar.el, rel.el);
    box.append(h.el, row);
    tut(radar.el, `telar${i + 1}-radar`);
    tut(rel.el, `telar${i + 1}-reload`);
    tut(box, `telar${i + 1}`);
    return { el: box, h, rack, lamp, tgt, radar, rel };
  }
  function makeLoader() {
    const box = el('div', 'veh loader');
    const h = head('ПЗУ', 'LOADER-LAUNCHER');
    const launcher = new Rack(4, 'big');
    const stow = new Rack(4, 'big stow');
    const rl = new Bar({ segs: 10, cls: 'reload', text: false });
    const rlTxt = el('span', 'vtgt');
    const row = el('div', 'vrow');
    const rr = el('div', 'rowc tight');
    rr.append(label('ПУ', 'LAUNCH', 'cap'), launcher.el, label('СТЕЛЛАЖ', 'RACK', 'cap'), stow.el);
    row.append(rr);
    const row2 = el('div', 'vrow');
    row2.append(label('ЗАРЯДКА', 'RELOAD', 'cap'), rl.el, rlTxt);
    box.append(h.el, row, row2);
    tut(box, 'loader');
    return { el: box, h, launcher, stow, rl, rlTxt };
  }
  function makeSimple(ru, en) {
    const box = el('div', 'veh simple');
    const h = head(ru, en);
    const lamp = new Led('green');
    h.el.append(lamp.el);
    box.append(h.el);
    return { el: box, h, lamp };
  }

  // ---- helpers
  const partsOf = (role) => { const r = []; (u.parts || []).forEach((p, i) => { if (p.role === role) r.push(i); }); return r; };
  const telarPart = (ord) => (u && (u.telars || partsOf('telar'))[ord] != null ? (u.telars || partsOf('telar'))[ord] : -1);
  // the firing vehicle lives in the sim (u.firePart, a TELAR's part or null for best available): engage
  // defaults to it and the camera rides it; the selector shows it and a click or Q changes it
  const fireChoice = () => {
    const i = u && u.firePart != null ? (u.telars || partsOf('telar')).indexOf(u.firePart) : -1;
    return i >= 0 ? i : 'best';
  };
  function pickFire(v) {
    if (!u) return;
    const p = v === 'best' ? -1 : telarPart(v);
    send('firePart', { part: p >= 0 ? p : null });
  }

  function sortedTargets() { return threatOrder(u.tracks || []); }
  function doAssign() {
    const all = sortedTargets();
    const open = all.filter((t) => !(t.engagedBy && t.engagedBy.length));
    const list = open.length ? open : all;
    if (!list.length) return;
    const i = list.findIndex((t) => t.id === u.selected);
    send('select', { trackId: list[(i + 1) % list.length].id });
  }
  function launch(n) {
    if (!u) return;
    if (u.selected == null) { doAssign(); return; }
    takeManual(u, send, true);
    const args = { trackId: u.selected, salvo: n };
    send('engage', args);
  }
  function doCease() { if (u && u.selected != null) send('cease', { trackId: u.selected }); }
  function silence() {
    if (!u) return;
    takeManual(u, send);
    send('track', { on: false });
    send('radar', { on: false });
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
        case 'KeyQ': { const f = fireChoice(); pickFire(f === 'best' ? 0 : f === 0 ? 1 : 'best'); return true; }
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
      mode.set(u.mode);
      const parts = u.parts || [];
      const tel = u.telars || partsOf('telar');
      const ldI = u.loader != null ? u.loader : partsOf('loader')[0];
      const rdI = partsOf('radar')[0];
      const cpI = partsOf('cp')[0];
      const rdAlive = rdI != null && parts[rdI].alive !== false;
      const cpAlive = cpI != null && parts[cpI].alive !== false && u.alive !== false;

      const em = !!(u.radar && u.radar.search);
      emit.set(em);
      emitLamp.set(em ? 1 : 0);
      emitWarn.set(em ? 0 : 2);
      setCls(emit.el, 'dis', !rdAlive);
      quiet.set(false);
      quiet.enable(u.alive !== false && (em || !!(u.radar && u.radar.track)));

      const m = (u.weapons && u.weapons.missiles) || { ready: 0, reserve: 0, reload: 0, reloadPart: -1 };
      const reloading = m.reload > 0 ? m.reloadPart : -2;

      // selected track and the engage controls
      const t = selectedTrack(u, tracks);
      selBar.update(u, t, data);
      selId.set(t ? String(t.id).padStart(3, '0') : '---');
      selRng.set(t ? fmtKm(t.range) : '--');
      selTti.set(t ? fmtTti(t.tti).replace('s', '') : '--');
      rdy.set(m.ready);
      fireSeg.set(fireChoice());
      for (let i = 0; i < 2; i++) {
        const b = fireSeg.btns.get(i);
        if (b) b.classList.toggle('dis', !(tel[i] != null && parts[tel[i]].alive !== false));
      }
      const can = !!t && m.ready > 0 && u.alive !== false;
      l1.enable(can); l2.enable(can && m.ready > 1);
      cease.enable(!!t);
      l1.set(t && t.engagedBy && t.engagedBy.includes(u.id));

      // vehicles
      for (let i = 0; i < 2; i++) {
        const v = tv[i];
        const pi = tel[i];
        const p = pi != null ? parts[pi] : null;
        if (!p) { setCls(v.el, 'gone', true); continue; }
        const alive = p.alive !== false;
        setCls(v.el, 'gone', false);
        setCls(v.el, 'dead', !alive);
        v.h.hp.set(p.maxHp ? p.hp / p.maxHp : alive ? 1 : 0);
        const busy = reloading === pi;
        setText(v.h.st, !alive ? 'ВЫВЕДЕНА  KNOCKED OUT' : busy ? 'ЗАРЯДКА  LOADING' : p.track ? 'РЛС ИЗЛУЧАЕТ  RADAR ON' : 'РЛС ВЫКЛ  RADAR OFF');
        setCls(v.h.st, 'bad', !alive);
        setCls(v.h.st, 'dim', alive && !p.track && !busy);
        v.rack.set(lit(p.slots), busy);
        const tr = p.target != null ? tracks.find((x) => x.id === p.target) : null;
        v.lamp.set(alive && p.locked ? 1 : alive && p.track && p.target != null ? 2 : 0);
        setText(v.tgt, !alive ? '' : p.target != null ? `${String(p.target).padStart(3, '0')} ${tr ? CLS3[tr.cls] || '' : ''}` : (p.track ? 'СВОБОДЕН' : '--'));
        v.radar.set(alive && p.track);
        v.radar.enable(alive && u.alive !== false);
        v.rel.enable(alive && m.reload <= 0 && lit(p.slots) < 4 && (m.reserve > 0 || (ldI != null && lit(parts[ldI].slots.slice(4)) > 0)) && ldI != null && parts[ldI].alive !== false);
        v.rel.set(busy);
      }
      {
        const p = ldI != null ? parts[ldI] : null;
        const alive = !!p && p.alive !== false;
        setCls(ld.el, 'dead', !alive);
        ld.h.hp.set(p && p.maxHp ? p.hp / p.maxHp : alive ? 1 : 0);
        setText(ld.h.st, !alive ? 'ВЫВЕДЕНА  KNOCKED OUT' : m.reload > 0 ? 'КРАН РАБОТАЕТ  CRANE AT WORK' : 'ГОТОВА  READY');
        setCls(ld.h.st, 'bad', !alive);
        const sl = p && p.slots ? p.slots : [];
        ld.launcher.set(lit(sl.slice(0, 4)), false);
        ld.stow.set(lit(sl.slice(4, 8)), false);
        ld.rl.set(reloadFrac(memo, 'buk', m.reload));
        const who = m.reload > 0 && m.reloadPart >= 0 ? tel.indexOf(m.reloadPart) : -1;
        setText(ld.rlTxt, m.reload > 0 ? `${who >= 0 ? `СОУ ${who + 1}` : 'ПЗУ'}  ${Math.ceil(m.reload)} с` : m.reserve > 0 ? `ЗАПАС ${m.reserve}` : 'ПУСТО');
      }
      {
        setCls(rd.el, 'dead', !rdAlive);
        const p = rdI != null ? parts[rdI] : null;
        rd.h.hp.set(p && p.maxHp ? p.hp / p.maxHp : rdAlive ? 1 : 0);
        setText(rd.h.st, !rdAlive ? 'ВЫВЕДЕНА  KNOCKED OUT' : em ? 'ИЗЛУЧАЕТ  EMITTING' : 'МОЛЧИТ  SILENT');
        setCls(rd.h.st, 'bad', !rdAlive);
        setCls(rd.h.st, 'dim', rdAlive && !em);
        rd.lamp.set(rdAlive && em ? 1 : 0);
        const p2 = cpI != null ? parts[cpI] : null;
        setCls(cp.el, 'dead', !cpAlive);
        cp.h.hp.set(p2 && p2.maxHp ? p2.hp / p2.maxHp : cpAlive ? 1 : 0);
        setText(cp.h.st, !cpAlive ? 'ВЫВЕДЕН  LINK DOWN' : 'СВЯЗЬ  DATA LINK UP');
        setCls(cp.h.st, 'bad', !cpAlive);
        cp.lamp.set(cpAlive ? 1 : 2);
      }
    },
    dispose() { emit.dispose(); },
  };
}
