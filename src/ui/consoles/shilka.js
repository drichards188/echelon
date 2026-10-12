// ZSU-23-4M4 Shilka-M4 console: guns only. One dish both searches and tracks, so the radar scope and the
// dish state sit together; the gunner's sight shows the lead point the fire control lays the guns on.
// Tracking by radar or by the optical sight (the sight takes over by itself while the dish is off).
import { el, setText, setCls, plate, label, Lamp, Btn, Toggle, Seg, Readout, Bar, fmtKm, DEG, snd } from '../widgets.js';
import { Scope } from '../scope.js';
import { SightView, sightFov, aimTo, SIGHT_W, SIGHT_H } from '../sightview.js';
import { TrackTable } from '../tracktable.js';
import { tut } from '../highlight.js';
import { Header, SelBar, abbrev, engagedSet, selectedTrack, Slewer, takeManual, channelLock, channelsSee, inGunRange, setTrigger, MODE_ITEMS } from './common.js';

const MODES = ['auto', 'manual', 'hold'];

export function mountShilka(ctx) {
  const { send, memo } = ctx;
  const root = el('div', 'con pantsir shilka');
  const hdr = new Header('ШИЛКА-М4', 'ZSU-23-4M4 SHILKA');
  let u = null;
  let leadDist = null;
  const slew = new Slewer();
  if (!memo.range) memo.range = 14000;
  memo.bursts = memo.bursts || 0;

  // gunner's sight, with the lead point drawn over the standard reticle
  const ps = plate('ПРИЦЕЛ НАВОДЧИКА', "GUNNER'S SIGHT", 'pl-sight');
  const sendSlew = (daz, del) => { takeManual(u, send); send('slew', { daz, del }); };
  const overlay = (c, info, st, fov, unit) => {
    const g = unit.weapons && unit.weapons.gun;
    leadDist = null;
    if (!g || !g.aimOk || !g.aim || !info.target || !info.inView) return;
    const a = aimTo(unit, g.aim);
    const fovV = fov * (SIGHT_H / SIGHT_W);
    const dAz = ((a.az - (st.az || 0) + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    const x = SIGHT_W / 2 + (dAz / fov) * SIGHT_W;
    const y = SIGHT_H / 2 - ((a.el - (st.el || 0)) / fovV) * SIGHT_H;
    const tp = info.target.pos;
    leadDist = tp ? Math.hypot(g.aim.x - tp.x, g.aim.y - tp.y, g.aim.z - tp.z) : null;
    c.save();
    c.lineWidth = 1.4;
    c.strokeStyle = 'rgba(0,0,0,0.75)';
    c.fillStyle = '#ffd24a';
    c.setLineDash([3, 3]);
    c.beginPath(); c.moveTo(info.sx, info.sy); c.lineTo(x, y); c.stroke();
    c.strokeStyle = '#ffd24a';
    c.beginPath(); c.moveTo(info.sx, info.sy); c.lineTo(x, y); c.stroke();
    c.setLineDash([]);
    c.beginPath(); c.arc(x, y, 8, 0, Math.PI * 2); c.stroke();
    c.beginPath(); c.moveTo(x - 13, y); c.lineTo(x - 4, y); c.moveTo(x + 4, y); c.lineTo(x + 13, y); c.moveTo(x, y - 13); c.lineTo(x, y - 4); c.moveTo(x, y + 4); c.lineTo(x, y + 13); c.stroke();
    c.font = '600 11px "DejaVu Sans Mono", monospace';
    c.textAlign = 'left';
    c.fillText('УПР', x + 16, y + 4);
    c.restore();
  };
  const sight = new SightView({ canvas: ctx.sight, kind: 'pantsir', onSlew: sendSlew, overlay });
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
    items: [{ v: 'radar', ru: 'РЛС', en: 'RADAR' }, { v: 'eo', ru: 'ОПТИКА', en: 'OPTICAL' }],
    onChange: (v) => send('trackSource', { source: v }),
  });
  const srcNote = el('span', 'telst');
  const srcRow = el('div', 'col tight');
  srcRow.append(label('СОПРОВОЖДЕНИЕ', 'TRACKING BY', 'cap'), srcSeg.el, srcNote);
  ro.append(rRng.el, rAz.el, rEl.el, lamps, srcRow);
  ps.body.append(sight.el, ro);
  tut(ps.el, 'sight');
  tut(srcSeg.el, 'src');
  tut(lamps, 'lamps');

  // guns
  const pw = plate('ВООРУЖЕНИЕ', 'ARMAMENT: 4 x 23 mm', 'pl-weap');
  const rRounds = new Readout('СНАРЯДОВ', 'ROUNDS', '8888', '', 'sm');
  const rBurst = new Readout('ОЧЕРЕДЕЙ', 'BURSTS', '888', '', 'sm');
  const rLead = new Readout('УПРЕЖДЕНИЕ', 'LEAD m', '8888', '', 'sm'); // over 1 km on a fast target near the shells' reach
  const wr = el('div', 'rowc');
  wr.append(rRounds.el, rBurst.el, rLead.el);
  const ammo = new Bar({ segs: 14, cls: 'ammo', text: false });
  const ar = el('div', 'col tight');
  ar.append(label('БОЕКОМПЛЕКТ', 'AMMUNITION', 'cap'), ammo.el);
  const heat = new Bar({ segs: 14, invert: true, cls: 'heat', text: false });
  const hr = el('div', 'col tight');
  hr.append(label('НАГРЕВ СТВОЛОВ', 'BARREL HEAT', 'cap'), heat.el);
  const trig = new Btn({
    ru: 'ОГОНЬ', en: 'FIRE (HOLD)', color: 'red', hold: true, cls: 'big',
    onDown: () => trigger(true),
    onUp: () => trigger(false),
  });
  const cease = new Btn({ ru: 'ОТБОЙ', en: 'CEASE ON TRACK', color: 'white', onClick: () => { if (u && u.selected != null) send('cease', { trackId: u.selected }); } });
  const bt = el('div', 'rowc btns');
  bt.append(trig.el, cease.el);
  pw.body.append(wr, ar, hr, bt);
  tut(trig.el, 'trigger');
  tut(cease.el, 'cease');
  tut(wr, 'stock');
  tut(hr, 'heat');

  const pk = plate('РЕЖИМ И РЛС', 'MODE AND RADAR DISH', 'pl-sw');
  const search = new Toggle({ ru: 'ПОИСК', en: 'SEARCH', color: 'green', onChange: (on) => send('radar', { on }) });
  const track = new Toggle({ ru: 'СОПР', en: 'TRACK', color: 'amber', onChange: (on) => send('track', { on }) });
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

  // the one dish: search scope and tracks
  const pp = plate('РЛС: ПОИСК И СОПРОВОЖДЕНИЕ', 'RADAR (ONE DISH)', 'pl-ppi');
  const scope = new Scope({ size: 200, range: memo.range, rings: 4, theme: 'green', fused: false, period: 1, title: '' });
  scope.canvas.addEventListener('pointerdown', (e) => {
    const id = scope.pick(e.clientX, e.clientY);
    if (id != null) { e.preventDefault(); send('select', { trackId: id }); }
  });
  scope.canvas.style.cursor = 'crosshair';
  const rangeSeg = new Seg({ cls: 'compact', items: [4, 8, 14].map((k) => ({ v: k * 1000, ru: `${k} КМ`, en: 'RANGE' })), onChange: (v) => { memo.range = v; } });
  const dish = el('span', 'telst');
  pp.body.append(scope.el, rangeSeg.el, dish);
  tut(scope.el, 'scope');
  tut(rangeSeg.el, 'range');

  const pt = plate('ЦЕЛИ', 'TRACKS', 'pl-table');
  const table = new TrackTable({ cols: ['id', 'cls', 'rng', 'alt', 'tti', 'eng'], sort: 'tti', onPick: (id) => send('select', { trackId: id }), abbrev });
  pt.body.append(table.el);
  tut(table.el, 'tracks');
  const low = el('div', 'row low');
  low.append(pp.el, pt.el);

  const keys = el('div', 'helpline', 'TAB: TRACK   SPACE: FIRE (HOLD)   R: SEARCH   T: TRACK   ARROWS: SLEW SIGHT   A: MODE');
  const selBar = new SelBar();
  tut(selBar.el, 'selbar');
  root.append(hdr.el, selBar.el, top, low, keys);

  // the crew fires in auto and holds in hold: the player's trigger needs manual
  let spaceDown = false;
  let wasFiring = false;
  function trigger(down) {
    if (down) takeManual(u, send, true);
    send('trigger', { down });
  }

  return {
    el: root,
    key(e, down) {
      if (slew.key(e, down)) return true;
      if (e.code === 'Space') {
        if (down === spaceDown) return true;
        spaceDown = down;
        trig.press(down);
        trigger(down);
        return true;
      }
      if (!down) return false;
      switch (e.code) {
        case 'KeyR': send('radar', { on: !(u.radar && u.radar.search) }); return true;
        case 'KeyT': send('track', { on: !(u.radar && u.radar.track) }); snd('switch'); return true;
        case 'KeyA': send('mode', { mode: MODES[(MODES.indexOf(u.mode) + 1) % 3] }); return true;
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
      const dishOn = !!(u.radar && u.radar.track);
      // the sim lays the guns by the optical sight while the dish is not tracking, whatever the switch says
      const effEo = st.src === 'eo' || !dishOn;
      srcSeg.set(st.src || 'radar');
      setText(srcNote, effEo ? (dishOn || st.src === 'eo' ? 'ОПТИКА' : 'РЛС ВЫКЛ: ОПТИКА') : 'РЛС');
      setCls(srcNote, 'warn', !dishOn && st.src !== 'eo');
      setText(dish, u.radar && u.radar.track ? 'АНТЕННА: СОПРОВОЖДЕНИЕ' : u.radar && u.radar.search ? 'АНТЕННА: ПОИСК' : 'АНТЕННА: ВЫКЛ');
      search.set(u.radar && u.radar.search);
      track.set(dishOn);
      mode.set(u.mode);
      const g = (u.weapons && u.weapons.gun) || { rounds: 0, max: 2400, heat: 0, firing: false };
      if (g.firing && !wasFiring) memo.bursts++;
      wasFiring = !!g.firing;
      rRounds.set(Math.round(g.rounds));
      rBurst.set(memo.bursts);
      rLead.set(leadDist == null || !g.aimOk ? '--' : Math.round(leadDist));
      ammo.set(g.max ? g.rounds / g.max : 0);
      heat.set(g.heat || 0);
      trig.set(g.firing);
      setTrigger(trig, u, t, 'FIRE (HOLD)', g.rounds > 0 && !g.overheated);
    },
    dispose() {
      slew.clear();
      if (spaceDown || trig.held) send('trigger', { down: false });
      search.dispose(); track.dispose();
    },
  };
}
