// Osa-AKM console: older amber search PPI, tracking radar acquisition A-scope, salvo launch.
import { el, setText, plate, label, Lamp, Btn, Toggle, Seg, Readout, Bar, Rack, fmtKm, fmtTti } from '../widgets.js';
import { Scope, AScope } from '../scope.js';
import { TrackTable } from '../tracktable.js';
import { tut } from '../highlight.js';
import { Header, SelBar, abbrev, engagedSet, selectedTrack, threatOrder, reloadFrac, takeManual, channelLock, MODE_ITEMS } from './common.js';

const MODES = ['auto', 'manual', 'hold'];

export function mountOsa(ctx) {
  const { send, memo } = ctx;
  const root = el('div', 'con osa');
  const hdr = new Header('ОСА-АКМ', 'OSA-AKM 9K33M3');
  let u = null;
  if (!memo.range) memo.range = 30000;

  const pp = plate('ИНДИКАТОР ОБЗОРА', 'SEARCH PPI', 'pl-ppi');
  const scope = new Scope({ size: 372, range: memo.range, rings: 3, theme: 'amber', fused: false, period: 1.6, title: '' });
  scope.canvas.addEventListener('pointerdown', (e) => {
    const id = scope.pick(e.clientX, e.clientY);
    if (id != null) { e.preventDefault(); send('select', { trackId: id }); }
  });
  scope.canvas.style.cursor = 'crosshair';
  const rangeSeg = new Seg({ cls: 'compact', items: [15, 30].map((k) => ({ v: k * 1000, ru: `${k} КМ`, en: 'RANGE' })), onChange: (v) => { memo.range = v; } });
  pp.body.append(scope.el, rangeSeg.el);
  tut(scope.el, 'scope');
  tut(rangeSeg.el, 'range');

  const right = el('div', 'col rightc');

  const pa = plate('ЗАХВАТ ЦЕЛИ', 'TRACKING RADAR ACQUISITION', 'pl-a');
  const ascope = new AScope({ w: 258, h: 112, range: 30000, theme: 'amber' });
  const rRng = new Readout('ДАЛЬНОСТЬ', 'RANGE km', '88.8', '', 'sm');
  const rTti = new Readout('ВРЕМЯ', 'TTI', '8:88', '', 'sm');
  const lLock = new Lamp('ЗАХВАТ', 'LOCKED ON', 'green');
  const lTrk = new Lamp('СОПРОВОЖД', 'TRACKING', 'amber');
  const ar = el('div', 'rowc');
  ar.append(rRng.el, rTti.el, lTrk.el, lLock.el);
  pa.body.append(ascope.el, ar);
  tut(pa.el, 'ascope');
  tut(lLock.el, 'lock');
  tut(lTrk.el, 'tracking');

  const ps = plate('РЛС И РЕЖИМ', 'RADARS AND MODE', 'pl-sw');
  const search = new Toggle({ ru: 'ПОИСК', en: 'SEARCH RADAR', color: 'green', onChange: (on) => send('radar', { on }) });
  const track = new Toggle({ ru: 'СОПР', en: 'TRACK RADAR', color: 'amber', onChange: (on) => send('track', { on }) });
  const mode = new Seg({ cls: 'stack', items: MODE_ITEMS, onChange: (v) => send('mode', { mode: v }) });
  const sw = el('div', 'rowc');
  sw.append(search.el, track.el, mode.el);
  ps.body.append(sw);
  tut(search.el, 'search');
  tut(track.el, 'track-radar');
  tut(mode.el, 'mode');

  const pm = plate('РАКЕТЫ 9М33М3', 'MISSILES', 'pl-weap');
  const rack = new Rack(6, 'p6');
  const rRes = new Readout('ЗАПАС', 'RESERVE', '88', '', 'sm');
  const rRdy = new Readout('НА ПУ', 'READY', '8', '', 'sm');
  const rl = new Bar({ segs: 14, cls: 'reload', text: false });
  const rlTxt = el('span', 'telst');
  const rlr = el('div', 'col tight');
  rlr.append(label('ПЕРЕЗАРЯДКА', 'RELOAD', 'cap'), rl.el, rlTxt);
  const mr = el('div', 'rowc');
  mr.append(rRdy.el, rRes.el, rlr);
  const l1 = new Btn({ ru: 'ПУСК 1', en: 'LAUNCH 1 MISSILE', color: 'amber', cls: 'big', onClick: () => launch(1) });
  const l2 = new Btn({ ru: 'ПУСК 2', en: 'LAUNCH SALVO OF 2', color: 'red', cls: 'big', onClick: () => launch(2) });
  const cease = new Btn({ ru: 'ОТБОЙ', en: 'CEASE FIRE ON TRACK', color: 'white', onClick: () => { if (u && u.selected != null) send('cease', { trackId: u.selected }); } });
  const reload = new Btn({ ru: 'ЗАРЯДКА', en: 'RELOAD LAUNCHER', color: 'green', onClick: () => send('reload', {}) });
  const bt = el('div', 'rowc btns');
  bt.append(l1.el, l2.el, cease.el, reload.el);
  const ENG = [['aligning', 'НАВЕД', 'ALIGN', 'amber'], ['launch', 'ПУСК', 'LAUNCH', 'red'], ['flying', 'ПОЛЁТ', 'FLIGHT', 'amber'], ['kill', 'ПОРАЖ', 'KILL', 'green'], ['miss', 'ПРОМАХ', 'MISS', 'red']];
  const engLamps = {};
  const er = el('div', 'rowc englamps');
  for (const [k, ru, en, col] of ENG) { engLamps[k] = new Lamp(ru, en, col); er.append(engLamps[k].el); }
  pm.body.append(rack.el, mr, er, bt);
  tut(l1.el, 'launch');
  tut(l2.el, 'salvo');
  tut(cease.el, 'cease');
  tut(reload.el, 'reload');
  tut(rack.el, 'stock');
  tut(er, 'eng-lamps');

  right.append(pa.el, ps.el, pm.el);
  const lc = el('div', 'col leftc');

  const pt = plate('ТАБЛИЦА ЦЕЛЕЙ', 'TRACKS', 'pl-table');
  const table = new TrackTable({ cols: ['id', 'cls', 'rng', 'brg', 'alt', 'spd', 'tti', 'eng'], sort: 'tti', onPick: (id) => send('select', { trackId: id }), abbrev });
  pt.body.append(table.el);
  tut(table.el, 'tracks');
  lc.append(pp.el, pt.el);
  const main = el('div', 'row main2');
  main.append(lc, right);

  const keys = el('div', 'helpline', 'TAB: NEXT TRACK   SPACE: LAUNCH (SHIFT = 2)   T: TRACK RADAR   R: SEARCH RADAR   A: MODE   L: RELOAD');
  const selBar = new SelBar();
  tut(selBar.el, 'selbar');
  root.append(hdr.el, selBar.el, main, keys);

  // the sim switches the tracking radar on for the shot; a held-fire unit is taken to manual first
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

  return {
    el: root,
    key(e, down) {
      if (!down) return false;
      switch (e.code) {
        case 'Space': launch(e.shiftKey ? 2 : 1); l1.press(true); setTimeout(() => l1.press(false), 120); return true;
        case 'KeyR': send('radar', { on: !(u.radar && u.radar.search) }); return true;
        case 'KeyT': send('track', { on: !(u.radar && u.radar.track) }); return true;
        case 'KeyA': send('mode', { mode: MODES[(MODES.indexOf(u.mode) + 1) % 3] }); return true;
        case 'KeyL': send('reload', {}); return true;
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
      const sel = selectedTrack(u, tracks);
      // the tracking radar's display shows what its channel holds (the crew's target in auto), otherwise
      // the selected track
      const ch = u.channel && u.channel.targetId != null ? tracks.find((x) => x.id === u.channel.targetId) : null;
      const t = ch || sel;
      const tr = !!(u.radar && u.radar.track);
      const inRange = !!t && t.range < 28000;
      const locked = channelLock(u, t);
      ascope.update(dt, { on: tr, target: inRange ? t.range : null, locked, quality: t ? t.quality : 0 });
      selBar.update(u, sel, data);
      rRng.set(t ? fmtKm(t.range) : '--');
      rTti.set(t ? fmtTti(t.tti).replace('s', '') : '--');
      lTrk.set(tr && t ? (locked ? 1 : 2) : 0);
      lLock.set(locked ? 1 : 0);
      search.set(u.radar && u.radar.search);
      track.set(tr);
      mode.set(u.mode);
      const m = (u.weapons && u.weapons.missiles) || { ready: 0, reserve: 0, reload: 0 };
      rack.set(m.ready, m.reload > 0);
      rRdy.set(m.ready);
      rRes.set(m.reserve == null ? 0 : m.reserve);
      rl.set(reloadFrac(memo, 'osa', m.reload));
      setText(rlTxt, m.reload > 0 ? `${Math.ceil(m.reload)} с` : m.ready === 0 ? 'ПУСТО' : 'ГОТОВО');
      const can = !!sel && m.ready > 0 && u.alive !== false;
      l1.enable(can); l2.enable(can && m.ready > 1);
      l1.set(sel && sel.engagedBy && sel.engagedBy.includes(u.id));
      reload.set(m.reload > 0);
      const ev = (u.engagements || []).find((x) => x.trackId === u.selected) || (u.engagements || [])[0];
      for (const k in engLamps) engLamps[k].set(ev && ev.state === k ? 1 : 0);
    },
    dispose() { search.dispose(); track.dispose(); },
  };
}
