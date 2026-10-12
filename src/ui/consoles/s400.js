// S-400 battalion command post: big PPI, track table, launcher status, emission, mode and engagement controls.
import { el, setText, setCls, plate, label, Lamp, Btn, Toggle, Seg, Readout, Bar, Rack, fmtKm, fmtAlt, fmtTti } from '../widgets.js';
import { Scope } from '../scope.js';
import { TrackTable } from '../tracktable.js';
import { tut } from '../highlight.js';
import { Header, SelBar, abbrev, engagedSet, selectedTrack, threatOrder, stockOf, reloadFrac, takeManual, MODE_ITEMS } from './common.js';

const MODES = ['auto', 'manual', 'hold'];
const TYPES = ['48N6', '9M96'];

export function mountS400(ctx) {
  const { send, memo } = ctx;
  const root = el('div', 'con s400');
  const hdr = new Header('С-400 «ТРИУМФ»', 'S-400 TRIUMF');
  let u = null;
  if (!memo.range) memo.range = 100000;

  // PPI
  const pp = plate('ИНДИКАТОР КРУГОВОГО ОБЗОРА', 'PLAN POSITION INDICATOR', 'pl-ppi');
  const scope = new Scope({ size: 340, range: memo.range, rings: 4, theme: 'green', fused: true, period: 6 });
  scope.canvas.addEventListener('pointerdown', (e) => {
    const id = scope.pick(e.clientX, e.clientY);
    if (id != null) { e.preventDefault(); send('select', { trackId: id }); }
  });
  scope.canvas.style.cursor = 'crosshair';
  const rangeSeg = new Seg({
    cls: 'compact',
    items: [50, 100, 200, 300].map((k) => ({ v: k * 1000, ru: `${k} КМ`, en: 'RANGE' })),
    onChange: (v) => { memo.range = v; },
  });
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
  const emit = new Toggle({ ru: 'ИЗЛУЧ', en: 'SEARCH RADAR', guard: true, color: 'red', onChange: (on) => send('radar', { on }) });
  const emitLamp = new Lamp('ИЗЛУЧАЕТ', 'EMITTING', 'green');
  const emitWarn = new Lamp('МОЛЧИТ', 'SILENT, BLIND', 'amber');
  const er = el('div', 'rowc');
  const lc = el('div', 'col tight');
  lc.append(emitLamp.el, emitWarn.el);
  er.append(emit.el, lc);
  pe.body.append(er);
  tut(emit.el, 'emit');
  tut(er, 'emit-lamps');

  const pw = plate('РАКЕТЫ', 'MISSILES');
  const typeSeg = new Seg({
    items: [{ v: '48N6', ru: '48Н6Е3', en: '48N6 LONG' }, { v: '9M96', ru: '9М96Е2', en: '9M96 SHORT' }],
    onChange: (v) => send('missileType', { type: v }),
  });
  const stockRo = {};
  const sr = el('div', 'rowc');
  for (const t of TYPES) {
    stockRo[t] = { ready: new Readout(`${t} ГОТ`, 'READY', '88', '', 'sm'), res: new Readout(`${t} ЗАП`, 'RESERVE', '888', '', 'sm') };
    sr.append(stockRo[t].ready.el, stockRo[t].res.el);
  }
  pw.body.append(typeSeg.el, sr);
  tut(typeSeg.el, 'type');
  tut(sr, 'stock');

  const pa = plate('ЦЕЛЬ / ПУСК', 'ENGAGE');
  const selId = new Readout('ЦЕЛЬ', 'TRACK', '888', '', 'sm');
  const selRng = new Readout('ДАЛЬН', 'KM', '888.8', '', 'sm');
  const selTti = new Readout('ВРЕМЯ', 'TTI', '8:88', '', 'sm');
  const sel = el('div', 'rowc');
  sel.append(selId.el, selRng.el, selTti.el);
  const assign = new Btn({ ru: 'НАЗНАЧ', en: 'NEXT THREAT', color: 'white', onClick: () => doAssign() });
  const l1 = new Btn({ ru: 'ПУСК 1', en: 'LAUNCH 1 MISSILE', color: 'amber', onClick: () => launch(1) });
  const l2 = new Btn({ ru: 'ПУСК 2', en: 'LAUNCH SALVO OF 2', color: 'red', onClick: () => launch(2) });
  const cease = new Btn({ ru: 'ОТБОЙ', en: 'CEASE FIRE ON TRACK', color: 'white', onClick: () => doCease() });
  const reload = new Btn({ ru: 'ЗАРЯДКА', en: 'RELOAD LAUNCHERS', color: 'green', onClick: () => send('reload', {}) });
  const br = el('div', 'rowc btns');
  br.append(assign.el, l1.el, l2.el, cease.el, reload.el);
  pa.body.append(sel, br);
  tut(assign.el, 'next-threat');
  tut(l1.el, 'launch');
  tut(l2.el, 'salvo');
  tut(cease.el, 'cease');
  tut(reload.el, 'reload');
  tut(sel, 'sel');

  const rowA = el('div', 'row');
  rowA.append(pm.el, pe.el);
  ctl.append(rowA, pw.el, pa.el);
  const main = el('div', 'row main');
  main.append(pp.el, ctl);

  // lower row: track table + launchers
  const pt = plate('ТАБЛИЦА ЦЕЛЕЙ', 'TRACK TABLE', 'pl-table');
  const table = new TrackTable({
    cols: ['id', 'cls', 'rng', 'brg', 'alt', 'spd', 'tti', 'eng'], sort: 'tti', 
    onPick: (id) => send('select', { trackId: id }), abbrev,
  });
  pt.body.append(table.el);
  tut(table.el, 'tracks');

  const pl = plate('ПУСКОВЫЕ УСТАНОВКИ', 'LAUNCHERS', 'pl-tel');
  const tels = [];
  for (let i = 0; i < 3; i++) {
    const row = el('div', 'tel');
    const rack = new Rack(4, 'big');
    const erect = new Bar({ segs: 8, cls: 'erect', text: false });
    const st = el('span', 'telst');
    row.append(el('b', 'telno', `ПУ ${i + 1} ${i < 2 ? '48N6' : '9M96'}`), rack.el, erect.el, st);
    pl.body.append(row);
    tels.push({ rack, erect, st });
  }
  const rl = el('div', 'tel rl');
  const rlBar = new Bar({ segs: 11, cls: 'reload', text: false });
  const rlTxt = el('span', 'telst');
  rl.append(label('ПЕРЕЗАРЯДКА', 'RELOAD', 'cap'), rlBar.el, rlTxt);
  pl.body.append(rl);
  tut(pl.el, 'launchers');
  const low = el('div', 'row low');
  low.append(pt.el, pl.el);

  const keys = el('div', 'helpline', 'TAB: NEXT TRACK   SPACE: LAUNCH (SHIFT = 2)   X: CEASE   Q: MISSILE TYPE   R: RADAR   A: MODE   L: RELOAD');
  const selBar = new SelBar();
  tut(selBar.el, 'selbar');
  tut(hdr.el, 'header');
  root.append(hdr.el, selBar.el, main, low, keys);

  function sortedTargets() { return threatOrder(u.tracks || []); }
  // most urgent track nobody is engaging; pressing again steps down the list
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
    send('engage', { trackId: u.selected, salvo: n });
  }
  function doCease() { if (u && u.selected != null) send('cease', { trackId: u.selected }); }

  return {
    el: root,
    key(e, down) {
      if (!down || !u) return false;
      switch (e.code) {
        case 'Space': launch(e.shiftKey ? 2 : 1); l1.press(true); setTimeout(() => l1.press(false), 120); return true;
        case 'KeyR': send('radar', { on: !(u.radar && u.radar.search) }); return true;
        case 'KeyA': send('mode', { mode: MODES[(MODES.indexOf(u.mode) + 1) % 3] }); return true;
        case 'KeyQ': send('missileType', { type: (u.weapons && u.weapons.type) === '48N6' ? '9M96' : '48N6' }); return true;
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
      const em = !!(u.radar && u.radar.search);
      emit.set(em);
      emitLamp.set(em ? 1 : 0);
      emitWarn.set(em ? 0 : 2);
      const type = (u.weapons && u.weapons.type) || '48N6';
      typeSeg.set(type);
      let ready = 0, reloadS = 0;
      for (const t of TYPES) {
        const s = stockOf(u, t);
        stockRo[t].ready.set(s ? s.ready : '--');
        stockRo[t].res.set(s ? s.reserve : '--');
        if (t === type && s) { ready = s.ready; reloadS = s.reload || 0; }
      }
      const st = stockOf(u, type);
      rlBar.set(reloadFrac(memo, type, reloadS));
      setText(rlTxt, reloadS > 0 ? `${Math.ceil(reloadS)} с` : st && st.ready === 0 ? 'ПУСТО' : 'ГОТОВО');
      // one launcher per vehicle: the first two carry 48N6, the third the 9M96 packs
      const tel = telParts(u);
      for (let i = 0; i < 3; i++) {
        const p = tel[i];
        let cells = 0;
        if (p && p.slots) for (const x of p.slots) if (x) cells++;
        const er = u.erect ? u.erect[i] || 0 : 0;
        tels[i].rack.set(cells, reloadS > 0 && cells < 4 && ((type === '48N6') === (i < 2)));
        tels[i].erect.set(er);
        setText(tels[i].st, (er > 0.95 ? 'ВЗВЕДЕНА' : er > 0.05 ? 'ПОДЪЁМ' : 'ПОХОДНАЯ'));
      }
      const t = selectedTrack(u, tracks);
      selBar.update(u, t, data);
      selId.set(t ? String(t.id).padStart(3, '0') : '---');
      selRng.set(t ? fmtKm(t.range) : '--');
      selTti.set(t ? fmtTti(t.tti).replace('s', '') : '--');
      const can = !!t && ready > 0 && u.alive !== false;
      l1.enable(can); l2.enable(can && ready > 1);
      cease.enable(!!t);
      const engaged = t && t.engagedBy && t.engagedBy.includes(u.id);
      l1.set(engaged); cease.set(false);
      reload.set(reloadS > 0);
    },
    dispose() { emit.dispose(); },
  };
}

function telParts(u) {
  const r = [];
  for (const p of u.parts || []) if (p.kind === 's400-tel') r.push(p);
  return r;
}
