// Pantsir-S1 console: search PPI, tracking channel display (sight canvas under the console's own overlay),
// weapon selector, rounds and heat, trigger and engage.
import { el, setText, plate, label, Lamp, Btn, Toggle, Seg, Readout, Bar, Rack, fmtKm, fmtTti, DEG, snd } from '../widgets.js';
import { Scope } from '../scope.js';
import { SightView, sightFov } from '../sightview.js';
import { TrackTable } from '../tracktable.js';
import { tut } from '../highlight.js';
import { Header, SelBar, threatOrder, abbrev, engagedSet, selectedTrack, Slewer, reloadFrac, takeManual, channelLock, MODE_ITEMS } from './common.js';

const MODES = ['auto', 'manual', 'hold'];

export function mountPantsir(ctx) {
  const { send, memo } = ctx;
  const root = el('div', 'con pantsir');
  const hdr = new Header('ПАНЦИРЬ-С1', 'PANTSIR-S1');
  let u = null;
  const slew = new Slewer();
  if (!memo.range) memo.range = 36000;
  if (!memo.weapon) memo.weapon = 'missile';

  // tracking channel
  const ps = plate('КАНАЛ СОПРОВОЖДЕНИЯ ЦЕЛИ', 'TARGET TRACKING CHANNEL', 'pl-sight');
  const sendSlew = (daz, del) => { takeManual(u, send); send('slew', { daz, del }); };
  const sight = new SightView({ canvas: ctx.sight, kind: 'pantsir', onSlew: sendSlew });
  const ro = el('div', 'rowc rolist');
  const rRng = new Readout('ДАЛЬНОСТЬ', 'RANGE km', '88.8', '', 'sm');
  const rAz = new Readout('АЗИМУТ', 'AZIMUTH °', '888.8', '', 'sm');
  const rEl = new Readout('УГОЛ МЕСТА', 'ELEVATION °', '-88.8', '', 'sm');
  const lLock = new Lamp('ЗАХВАТ', 'LOCKED ON', 'green');
  const lTrk = new Lamp('СОПРОВОЖД', 'TRACKING', 'amber');
  const srcSeg = new Seg({
    cls: 'compact',
    items: [{ v: 'radar', ru: 'РЛС', en: 'RADAR' }, { v: 'eo', ru: 'ОЭС', en: 'TV / IR' }],
    onChange: (v) => send('trackSource', { source: v }),
  });
  const srcRow = el('div', 'col tight');
  srcRow.append(label('ИСТОЧНИК', 'TRACKING BY', 'cap'), srcSeg.el);
  const lamps = el('div', 'col tight');
  lamps.append(lLock.el, lTrk.el);
  ro.append(rRng.el, rAz.el, rEl.el, lamps, srcRow);
  ps.body.append(sight.el, ro);
  tut(ps.el, 'sight');
  tut(srcSeg.el, 'src');
  tut(lamps, 'lamps');

  // weapons
  const pw = plate('ВООРУЖЕНИЕ', 'ARMAMENT', 'pl-weap');
  const weapon = new Seg({
    items: [{ v: 'missile', ru: 'РАКЕТЫ', en: 'MISSILES 57E6' }, { v: 'gun', ru: 'ПУШКИ', en: 'GUNS 30 mm' }],
    onChange: (v) => { memo.weapon = v; send('weapon', { weapon: v }); },
  });
  const rack = new Rack(12, 'p12');
  const rMsl = new Readout('РАКЕТ', 'MISSILES', '88', '', 'sm');
  const rRounds = new Readout('СНАРЯДОВ', 'ROUNDS', '8888', '', 'sm');
  const heat = new Bar({ segs: 9, invert: true, cls: 'heat', text: false });
  const hr = el('div', 'col tight');
  hr.append(label('НАГРЕВ СТВОЛОВ', 'BARREL HEAT', 'cap'), heat.el);
  const rl = new Bar({ segs: 9, cls: 'reload', text: false });
  const rlr = el('div', 'col tight');
  const rlTxt = el('span', 'telst');
  rlr.append(label('ПЕРЕЗАРЯДКА', 'RELOAD', 'cap'), rl.el, rlTxt);
  const wr = el('div', 'rowc');
  wr.append(rMsl.el, rRounds.el);
  const trig = new Btn({
    ru: 'ОГОНЬ', en: 'FIRE GUNS (HOLD)', color: 'red', hold: true, cls: 'big',
    onDown: () => trigger(true),
    onUp: () => trigger(false),
  });
  const launch = new Btn({ ru: 'ПУСК', en: 'LAUNCH MISSILE', color: 'amber', cls: 'big', onClick: () => engage() });
  const cease = new Btn({ ru: 'ОТБОЙ', en: 'CEASE ON TRACK', color: 'white', onClick: () => { if (u && u.selected != null) send('cease', { trackId: u.selected }); } });
  const reloadBtn = new Btn({ ru: 'ЗАРЯДКА', en: 'RELOAD MISSILES', color: 'green', onClick: () => send('reload', {}) });
  const bt = el('div', 'rowc btns');
  bt.append(trig.el, launch.el, cease.el);
  const hrr = el('div', 'rowc');
  hrr.append(hr, rlr);
  bt.append(reloadBtn.el);
  pw.body.append(weapon.el, rack.el, wr, hrr, bt);
  tut(weapon.el, 'weapon');
  tut(trig.el, 'trigger');
  tut(launch.el, 'launch');
  tut(cease.el, 'cease');
  tut(reloadBtn.el, 'reload');
  tut(wr, 'stock');

  const pk = plate('РЕЖИМ И РЛС', 'MODE AND RADARS', 'pl-sw');
  const search = new Toggle({ ru: 'ПОИСК', en: 'SEARCH RADAR', color: 'green', onChange: (on) => send('radar', { on }) });
  const track = new Toggle({ ru: 'СОПР', en: 'TRACK RADAR', color: 'amber', onChange: (on) => send('track', { on }) });
  const mode = new Seg({ cls: 'compact modeh', items: MODE_ITEMS, onChange: (v) => send('mode', { mode: v }) });
  const sw = el('div', 'rowc');
  sw.append(search.el, track.el);
  pk.body.append(sw, mode.el);
  tut(search.el, 'search');
  tut(track.el, 'track-radar');
  tut(mode.el, 'mode');

  const top = el('div', 'row top');
  const rc = el('div', 'col rightc');
  rc.append(pw.el, pk.el);
  top.append(ps.el, rc);

  // search PPI and tracks
  const pp = plate('ПОИСК', 'SEARCH PPI', 'pl-ppi');
  const scope = new Scope({ size: 200, range: memo.range, rings: 4, theme: 'green', fused: false, period: 2.4, title: '' });
  scope.canvas.addEventListener('pointerdown', (e) => {
    const id = scope.pick(e.clientX, e.clientY);
    if (id != null) { e.preventDefault(); send('select', { trackId: id }); }
  });
  scope.canvas.style.cursor = 'crosshair';
  const rangeSeg = new Seg({ cls: 'compact', items: [9, 18, 36].map((k) => ({ v: k * 1000, ru: `${k} КМ`, en: 'RANGE' })), onChange: (v) => { memo.range = v; } });
  pp.body.append(scope.el, rangeSeg.el);
  tut(scope.el, 'scope');
  tut(rangeSeg.el, 'range');

  const pt = plate('ЦЕЛИ', 'TRACKS', 'pl-table');
  const table = new TrackTable({ cols: ['id', 'cls', 'rng', 'alt', 'tti', 'eng'], sort: 'tti', onPick: (id) => send('select', { trackId: id }), abbrev });
  pt.body.append(table.el);
  tut(table.el, 'tracks');
  const low = el('div', 'row low');
  low.append(pp.el, pt.el);

  const keys = el('div', 'helpline', 'TAB: TRACK   SPACE: FIRE (HOLD = GUNS)   G: GUN/MISSILE   T: TRACK RADAR   R: SEARCH   ARROWS: SLEW EO   A: MODE   L: RELOAD');
  const selBar = new SelBar();
  tut(selBar.el, 'selbar');
  root.append(hdr.el, selBar.el, top, low, keys);

  function engage() {
    if (!u) return;
    if (u.selected == null) {
      const l = threatOrder(u.tracks || []);
      if (l.length) send('select', { trackId: l[0].id });
      return;
    }
    takeManual(u, send, true);
    send('engage', { trackId: u.selected, salvo: 1 });
  }
  // the crew fires the guns itself in auto and holds them in hold: the player's trigger needs manual
  let spaceDown = false;
  function trigger(down) {
    if (down) {
      takeManual(u, send, true);
      if (memo.weapon !== 'gun') { memo.weapon = 'gun'; send('weapon', { weapon: 'gun' }); }
    }
    send('trigger', { down });
  }

  return {
    el: root,
    key(e, down) {
      if (slew.key(e, down)) return true;
      if (e.code === 'Space') {
        if (memo.weapon === 'gun') {
          if (down === spaceDown) return true;
          spaceDown = down;
          trig.press(down);
          trigger(down);
        } else if (down) { engage(); launch.press(true); setTimeout(() => launch.press(false), 120); }
        return true;
      }
      if (!down) return false;
      switch (e.code) {
        case 'KeyR': send('radar', { on: !(u.radar && u.radar.search) }); return true;
        case 'KeyT': send('track', { on: !(u.radar && u.radar.track) }); return true;
        case 'KeyG': { const w = memo.weapon === 'gun' ? 'missile' : 'gun'; memo.weapon = w; send('weapon', { weapon: w }); snd('switch'); return true; }
        case 'KeyA': send('mode', { mode: MODES[(MODES.indexOf(u.mode) + 1) % 3] }); return true;
        case 'KeyL': send('reload', {}); return true;
        default: return false;
      }
    },
    update(dt, unit, data) {
      u = unit;
      const tracks = u.tracks || [];
      hdr.update(u, tracks);
      if (u.weapons && (u.weapons.weapon === 'missile' || u.weapons.weapon === 'gun')) memo.weapon = u.weapons.weapon;
      scope.setRange(memo.range);
      rangeSeg.set(memo.range);
      scope.update(dt, u, { tracks, selected: u.selected, engaged: engagedSet(u) });
      table.update(dt, tracks, u.selected);
      slew.step(dt, sightFov(u.sight), (n, a) => sendSlew(a.daz, a.del));
      sight.flush();
      const sel = selectedTrack(u, tracks);
      // the tracking channel's display shows what the channel holds (the crew's target in auto, the
      // round's target while one flies), otherwise the selected track
      const ch = u.channel && u.channel.targetId != null ? tracks.find((x) => x.id === u.channel.targetId) : null;
      const t = ch || sel;
      const info = sight.update(dt, u, t ? [t] : [], t ? t.id : u.selected);
      const st = u.sight || {};
      rRng.set(t ? fmtKm(t.range) : '--');
      const az = ((((st.az || 0) / DEG) % 360) + 360) % 360;
      rAz.set(az.toFixed(1));
      rEl.set(((st.el || 0) / DEG).toFixed(1));
      selBar.update(u, sel, data);
      const lock = channelLock(u, t);
      lLock.set(lock ? 1 : 0);
      lTrk.set(t && ((u.radar && u.radar.track) || st.src === 'eo') ? (lock ? 1 : 2) : 0);
      srcSeg.set(st.src || memo.src || 'radar');
      weapon.set(memo.weapon);
      search.set(u.radar && u.radar.search);
      track.set(u.radar && u.radar.track);
      mode.set(u.mode);
      const m = (u.weapons && u.weapons.missiles) || { ready: 0, max: 12, reload: 0 };
      const g = (u.weapons && u.weapons.gun) || { rounds: 0, max: 1400, heat: 0, firing: false };
      rack.set(m.ready, m.reload > 0);
      rMsl.set(m.ready);
      rRounds.set(Math.round(g.rounds));
      heat.set(g.heat || 0);
      rl.set(reloadFrac(memo, 'p', m.reload));
      setText(rlTxt, m.reload > 0 ? `${Math.ceil(m.reload)} с` : m.ready === 0 ? 'ПУСТО' : 'ГОТОВО');
      trig.set(g.firing);
      launch.enable(!!sel && m.ready > 0);
      launch.set(sel && sel.engagedBy && sel.engagedBy.includes(u.id));
      trig.enable(g.rounds > 0);
      void info; void fmtTti;
    },
    dispose() {
      slew.clear();
      if (spaceDown || trig.held) send('trigger', { down: false });
      search.dispose(); track.dispose();
    },
  };
}
