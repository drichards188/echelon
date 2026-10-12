// The console for a kind that has none of its own yet: the header with its status line, the selected
// track, mode and radar switches, the weapons in plain numbers, engage and fire, the track list and the
// sight picture when the unit has one. Enough to play any unit; the real consoles replace it.
import { el, setText, plate, Btn, Toggle, Seg, Readout } from './widgets.js';
import { TrackTable } from './tracktable.js';
import { Header, SelBar, abbrev, threatOrder, takeManual, tracksFor, MODE_ITEMS } from './consoles/common.js';

const MODES = ['auto', 'manual', 'hold'];

export function mountFallback(ctx) {
  const { send, sight } = ctx;
  const root = el('div', 'con fallback');
  const hdr = new Header('ЗРК', 'AIR DEFENSE UNIT');
  const selBar = new SelBar();
  let u = null;

  const ps = plate('РЛС И РЕЖИМ', 'RADARS AND MODE', 'pl-sw');
  const search = new Toggle({ ru: 'ПОИСК', en: 'SEARCH RADAR', color: 'green', onChange: (on) => send('radar', { on }) });
  const track = new Toggle({ ru: 'СОПР', en: 'TRACK RADAR', color: 'amber', onChange: (on) => send('track', { on }) });
  const mode = new Seg({ cls: 'stack', items: MODE_ITEMS, onChange: (v) => send('mode', { mode: v }) });
  const sw = el('div', 'rowc');
  sw.append(search.el, track.el, mode.el);
  ps.body.append(sw);

  const pw = plate('ВООРУЖЕНИЕ', 'WEAPONS', 'pl-weap');
  const rRdy = new Readout('НА ПУ', 'READY', '88', '', 'sm');
  const rRes = new Readout('ЗАПАС', 'RESERVE', '88', '', 'sm');
  const rGun = new Readout('СНАРЯДЫ', 'ROUNDS', '8888', '', 'sm');
  const info = el('span', 'telst');
  const wr = el('div', 'rowc');
  wr.append(rRdy.el, rRes.el, rGun.el, info);
  const engage = new Btn({ ru: 'ПУСК', en: 'LAUNCH', color: 'red', cls: 'big', onClick: () => launch() });
  const fire = new Btn({ ru: 'ОГОНЬ', en: 'GUNS (HOLD)', color: 'red', cls: 'big', hold: true, onDown: () => trigger(true), onUp: () => trigger(false) });
  const reload = new Btn({ ru: 'ЗАРЯДКА', en: 'RELOAD', color: 'green', onClick: () => send('reload', {}) });
  const bt = el('div', 'rowc btns');
  bt.append(engage.el, fire.el, reload.el);
  pw.body.append(wr, bt);

  const pt = plate('ТАБЛИЦА ЦЕЛЕЙ', 'TRACKS', 'pl-table');
  const table = new TrackTable({ cols: ['id', 'cls', 'rng', 'brg', 'alt', 'spd', 'tti', 'eng'], sort: 'tti', onPick: (id) => send('select', { trackId: id }), abbrev });
  pt.body.append(table.el);

  const main = el('div', 'col');
  if (sight) {
    const pv = plate('ПРИЦЕЛ', 'SIGHT', 'pl-sight');
    sight.className = 'sightcv';
    sight.style.width = '100%';
    sight.style.height = 'auto';
    pv.body.append(sight);
    main.append(pv.el);
  }
  main.append(ps.el, pw.el, pt.el);
  const keys = el('div', 'helpline', 'TAB: NEXT TRACK   SPACE: LAUNCH / FIRE   R: SEARCH RADAR   T: TRACK RADAR   A: MODE   L: RELOAD');
  root.append(hdr.el, selBar.el, main, keys);

  function pick() {
    const l = threatOrder(u.tracks || []);
    if (l.length) send('select', { trackId: l[0].id });
  }
  function launch() {
    if (!u || !u.weapons.missiles) return;
    if (u.selected == null) return pick();
    takeManual(u, send, true);
    send('engage', { trackId: u.selected, salvo: 1 });
  }
  function trigger(down) {
    if (!u || !u.weapons.gun) return;
    if (down) takeManual(u, send, true);
    send('trigger', { down });
  }

  return {
    el: root,
    key(e, down) {
      if (!u) return false;
      if (e.code === 'Space') {
        if (u.weapons.gun && (!u.weapons.missiles || u.weapons.weapon === 'gun')) trigger(down);
        else if (down) launch();
        return true;
      }
      if (!down) return false;
      switch (e.code) {
        case 'KeyR': send('radar', { on: !(u.radar && u.radar.search) }); return true;
        case 'KeyT': send('track', { on: !(u.radar && u.radar.track) }); return true;
        case 'KeyA': send('mode', { mode: MODES[(MODES.indexOf(u.mode) + 1) % 3] }); return true;
        case 'KeyL': send('reload', {}); return true;
        default: return false;
      }
    },
    update(dt, unit, data) {
      u = unit;
      const tracks = tracksFor(u, data);
      hdr.update(u, tracks);
      selBar.update(u, tracks.find((t) => t.id === u.selected) || null, data);
      table.update(dt, tracks, u.selected);
      search.set(u.radar && u.radar.search);
      track.set(u.radar && u.radar.track);
      mode.set(u.mode);
      const m = u.weapons.missiles, g = u.weapons.gun;
      rRdy.set(m ? m.ready : '--');
      rRes.set(m ? m.reserve : '--');
      rGun.set(g ? g.rounds : '--');
      setText(info, m && m.reload > 0 ? `RELOAD ${Math.ceil(m.reload)} s` : g && g.firing ? 'FIRING' : '');
      engage.enable(!!m && m.ready > 0 && u.alive !== false);
      fire.enable(!!g && u.alive !== false);
      fire.set(!!g && g.firing);
      reload.set(!!m && m.reload > 0);
    },
    dispose() { search.dispose(); track.dispose(); },
  };
}
