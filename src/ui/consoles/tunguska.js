// 2S6M Tunguska console: guns first. Search PPI, the optical sight (the only guidance for the 9M311
// missiles; it also lays the guns when the tracking radar is off or EO is chosen), weapon choice, gun heat
// and rounds, the eight missile cells, channel lamps, radars, mode, reload. Same layout and keys as the Pantsir.
import { el, setText, plate, label, Lamp, Btn, Toggle, Seg, Readout, Bar, Rack, fmtKm, DEG, snd } from '../widgets.js';
import { Scope } from '../scope.js';
import { SightView, sightFov } from '../sightview.js';
import { TrackTable } from '../tracktable.js';
import { tut } from '../highlight.js';
import { Header, SelBar, threatOrder, abbrev, engagedSet, selectedTrack, Slewer, reloadFrac, takeManual, channelLock, channelsSee, inGunRange, setTrigger, MODE_ITEMS } from './common.js';

const MODES = ['auto', 'manual', 'hold'];

export function mountTunguska(ctx) {
  const { send, memo } = ctx;
  const root = el('div', 'con pantsir tunguska');
  const hdr = new Header('ТУНГУСКА-М', 'TUNGUSKA 2S6M');
  let u = null;
  const slew = new Slewer();
  if (!memo.range) memo.range = 24000;
  if (!memo.weapon) memo.weapon = 'gun';
  if (!memo.salvo) memo.salvo = 2;

  // optical sight: guides the missiles, and can lay the guns
  const ps = plate('ОПТИЧЕСКИЙ ВИЗИР', 'OPTICAL SIGHT (MISSILE CHANNEL)', 'pl-sight');
  const sendSlew = (daz, del) => { takeManual(u, send); send('slew', { daz, del }); };
  const sight = new SightView({ canvas: ctx.sight, kind: 'pantsir', onSlew: sendSlew });
  const ro = el('div', 'rowc rolist');
  const rRng = new Readout('ДАЛЬНОСТЬ', 'RANGE km', '88.8', '', 'sm');
  const rAz = new Readout('АЗИМУТ', 'AZIMUTH °', '888.8', '', 'sm');
  const rEl = new Readout('УГОЛ МЕСТА', 'ELEVATION °', '-88.8', '', 'sm');
  const lLock = new Lamp('ЗАХВАТ', 'LOCKED ON', 'green');
  const lGun = new Lamp('ЗОНА ОГНЯ', 'IN GUN RANGE', 'amber');
  const lamps = el('div', 'col tight');
  lamps.append(lLock.el, lGun.el);
  const srcSeg = new Seg({
    cls: 'compact',
    items: [{ v: 'radar', ru: 'РЛС', en: 'RADAR' }, { v: 'eo', ru: 'ОЭС', en: 'TV / IR' }],
    onChange: (v) => send('trackSource', { source: v }),
  });
  const srcRow = el('div', 'col tight');
  srcRow.append(label('ПУШКИ ПО', 'GUNS LAID BY', 'cap'), srcSeg.el);
  ro.append(rRng.el, rAz.el, rEl.el, lamps, srcRow);
  ps.body.append(sight.el, ro);
  tut(ps.el, 'sight');
  tut(srcSeg.el, 'src');
  tut(lamps, 'lamps');

  // armament
  const pw = plate('ВООРУЖЕНИЕ', 'ARMAMENT', 'pl-weap');
  const weapon = new Seg({
    items: [{ v: 'gun', ru: 'ПУШКИ', en: 'GUNS 30 mm' }, { v: 'missile', ru: 'РАКЕТЫ', en: 'MISSILES 9M311' }],
    onChange: (v) => { memo.weapon = v; send('weapon', { weapon: v }); },
  });
  const salvo = new Seg({
    cls: 'compact',
    items: [{ v: 2, ru: 'ПАРА', en: 'PAIR' }, { v: 1, ru: 'ОДНА', en: 'SINGLE' }],
    onChange: (v) => { memo.salvo = v; },
  });
  const wsRow = el('div', 'rowc');
  const salvoCol = el('div', 'col tight');
  salvoCol.append(label('ЗАЛП', 'SALVO', 'cap'), salvo.el);
  wsRow.append(weapon.el, salvoCol);
  const rack = new Rack(8, 'p12');
  const rMsl = new Readout('НА ПУ', 'MISSILES', '88', '', 'sm');
  const rRes = new Readout('УКЛАДКА', 'STOWED', '88', '', 'sm');
  const rRounds = new Readout('СНАРЯДОВ', 'ROUNDS', '8888', '', 'sm');
  const heat = new Bar({ segs: 9, invert: true, cls: 'heat', text: false });
  const hr = el('div', 'col tight');
  hr.append(label('НАГРЕВ СТВОЛОВ', 'BARREL HEAT', 'cap'), heat.el);
  const rl = new Bar({ segs: 9, cls: 'reload', text: false });
  const rlTxt = el('span', 'telst');
  const rlr = el('div', 'col tight');
  rlr.append(label('ПЕРЕЗАРЯДКА', 'RELOAD', 'cap'), rl.el, rlTxt);
  const wr = el('div', 'rowc');
  wr.append(rMsl.el, rRes.el, rRounds.el);
  const hrr = el('div', 'rowc');
  hrr.append(hr, rlr);
  const trig = new Btn({
    ru: 'ОГОНЬ', en: 'FIRE GUNS (HOLD)', color: 'red', hold: true, cls: 'big',
    onDown: () => trigger(true),
    onUp: () => trigger(false),
  });
  const launch = new Btn({ ru: 'ПУСК', en: 'LAUNCH MISSILES', color: 'amber', cls: 'big', onClick: () => engage() });
  const cease = new Btn({ ru: 'ОТБОЙ', en: 'CEASE ON TRACK', color: 'white', onClick: () => { if (u && u.selected != null) send('cease', { trackId: u.selected }); } });
  const reloadBtn = new Btn({ ru: 'ЗАРЯДКА', en: 'RELOAD MISSILES', color: 'green', onClick: () => send('reload', {}) });
  const bt = el('div', 'rowc btns');
  bt.append(trig.el, launch.el, cease.el, reloadBtn.el);
  pw.body.append(wsRow, rack.el, wr, hrr, bt);
  tut(weapon.el, 'weapon');
  tut(salvo.el, 'salvo');
  tut(trig.el, 'trigger');
  tut(launch.el, 'launch');
  tut(cease.el, 'cease');
  tut(reloadBtn.el, 'reload');
  tut(wr, 'stock');
  tut(hr, 'heat');

  const pk = plate('РЕЖИМ И РЛС', 'MODE AND RADARS', 'pl-sw');
  const search = new Toggle({ ru: 'ПОИСК', en: 'SEARCH RADAR', color: 'green', onChange: (on) => send('radar', { on }) });
  const track = new Toggle({ ru: 'СОПР', en: 'GUN RADAR', color: 'amber', onChange: (on) => send('track', { on }) });
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
  const scope = new Scope({ size: 200, range: memo.range, rings: 4, theme: 'green', fused: false, period: 1, title: '' });
  scope.canvas.addEventListener('pointerdown', (e) => {
    const id = scope.pick(e.clientX, e.clientY);
    if (id != null) { e.preventDefault(); send('select', { trackId: id }); }
  });
  scope.canvas.style.cursor = 'crosshair';
  const rangeSeg = new Seg({ cls: 'compact', items: [6, 12, 24].map((k) => ({ v: k * 1000, ru: `${k} КМ`, en: 'RANGE' })), onChange: (v) => { memo.range = v; } });
  pp.body.append(scope.el, rangeSeg.el);
  tut(scope.el, 'scope');
  tut(rangeSeg.el, 'range');

  const pt = plate('ЦЕЛИ', 'TRACKS', 'pl-table');
  const table = new TrackTable({ cols: ['id', 'cls', 'rng', 'alt', 'tti', 'eng'], sort: 'tti', onPick: (id) => send('select', { trackId: id }), abbrev });
  pt.body.append(table.el);
  tut(table.el, 'tracks');
  const low = el('div', 'row low');
  low.append(pp.el, pt.el);

  const keys = el('div', 'helpline', 'TAB: TRACK   SPACE: FIRE (HOLD = GUNS)   G: GUN/MISSILE   T: GUN RADAR   R: SEARCH   ARROWS: SLEW SIGHT   A: MODE   L: RELOAD');
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
    send('engage', { trackId: u.selected, salvo: memo.salvo });
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
      const t = selectedTrack(u, tracks);
      sight.update(dt, u, t ? [t] : [], u.selected);
      const st = u.sight || {};
      rRng.set(t ? fmtKm(t.range) : '--');
      rAz.set(((((st.az || 0) / DEG) % 360 + 360) % 360).toFixed(1));
      rEl.set(((st.el || 0) / DEG).toFixed(1));
      selBar.update(u, t, data);
      lLock.set(channelLock(u, t) ? 1 : 0);
      const ch = channelsSee(u, t);
      lGun.set(t && inGunRange(u, t) && (ch.radar || ch.eo) ? 1 : 0);
      srcSeg.set(st.src || 'radar');
      weapon.set(memo.weapon);
      salvo.set(memo.salvo);
      search.set(u.radar && u.radar.search);
      track.set(u.radar && u.radar.track);
      mode.set(u.mode);
      const m = (u.weapons && u.weapons.missiles) || { ready: 0, reserve: 0, max: 8, reload: 0 };
      const g = (u.weapons && u.weapons.gun) || { rounds: 0, max: 2400, heat: 0, firing: false };
      rack.set(m.ready, m.reload > 0);
      rMsl.set(m.ready);
      rRes.set(m.reserve || 0);
      rRounds.set(Math.round(g.rounds));
      heat.set(g.heat || 0);
      rl.set(reloadFrac(memo, 't', m.reload));
      setText(rlTxt, m.reload > 0 ? `${Math.ceil(m.reload)} с` : m.ready === 0 ? 'ПУСТО' : 'ГОТОВО');
      trig.set(g.firing);
      setTrigger(trig, u, t, 'FIRE GUNS (HOLD)', g.rounds > 0 && !g.overheated);
      launch.enable(!!t && m.ready > 0);
      launch.set(t && t.engagedBy && t.engagedBy.includes(u.id));
    },
    dispose() {
      slew.clear();
      if (spaceDown || trig.held) send('trigger', { down: false });
      search.dispose(); track.dispose();
    },
  };
}
