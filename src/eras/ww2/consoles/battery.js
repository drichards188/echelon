// The heavy battery's console (`flak88`): the player is the battery officer at the command post beside the
// Kommandogeraet 40 (refs/ww2/battery 1, 2, 6). What it shows, from the sim (sim/mounts.js, DESIGN.md
// "WW2 era"):
//   the predictor's telescope   the picture along the KdO 40's line to its target (the sight pose in
//                               consoles.js), 12x or 24x; the battery's bursts show round the target
//   Kommandogeraet 40           the target's present data on follow-the-pointer dials (bearing, elevation
//                               and slant range from the predictor, height, course, speed), the solution's
//                               quality, the fuze it sends (the data pointer) and the one gun A's setter
//                               has set (the follow pointer), time of flight, expected miss (`sigma`), and
//                               lamps for held, settling, solution, out of reach and Window
//                               (u.predictor: target, state, quality, range, fuze, tof, sigma, window, hold)
//   fire control                the mode (FEUER FREI auto, AUF BEFEHL manual, FEUER HALT hold), predicted
//                               fire or barrage (Sperrfeuer) on the selected formation, the range source
//                               (the 4 m rangefinder or the Wuerzburg), the Wuerzburg's power, the trigger
//                               (salvos while held, the modern trigger's OUT OF RANGE and LONG RANGE faces),
//                               one salvo, Stopfen (cease)
//   the gun reports             A to F: laid (the elevation order and the barrel on a small follow-the-
//                               pointer dial), loaded, the fuze set, fired, out of action, rounds; the
//                               battery's two 2 cm guns (in action on their own in every mode but hold)
//   Wuerzburg D                 its circular range trace with Window's clutter (wurzburg.js)
//   the air picture             the plotting board (plot.js) and the target list: the lookouts', the
//                               Wuerzburg's and the reporting service's aircraft; a click designates
//                               (`select`: the predictor's target in manual, and in auto when the crew
//                               would take it)
// Commands: select, mode, trigger { down }, fire, cease, barrage { on, trackId }, ranging { source },
// radar { on }. Keys: Space trigger (hold), A mode, R Wuerzburg, T range source, G barrage, Q zoom.
import { SYSTEMS } from '../../../sim/systems.js';
import { el, setText, setCls, plate, label, Btn, Toggle, Seg, snd } from '../../../ui/widgets.js';
import { tut } from '../../../ui/highlight.js';
import { takeManual } from '../../../ui/consoles/common.js';
import { Header44, SelBar44, Lamp44, Drum, Knob, Dial, TargetList, VIEW, LETTER, PLANE, setTrigger44, compassOf, courseOf, dec, thou, pad3, DEG, wrap2 } from './kit.js';
import { Sight44 } from './sights.js';
import { Plot44 } from './plot.js';
import { Wurzburg44 } from './wurzburg.js';

const MODES = ['auto', 'manual', 'hold'];
export const MODE44 = [
  { v: 'auto', de: 'FREI', en: 'CREW FIRES' },
  { v: 'manual', de: 'BEFEHL', en: 'YOU FIRE' },
  { v: 'hold', de: 'HALT', en: 'HOLD FIRE' },
];
// the telescope's two magnifications (horizontal field of view, rad)
const ZOOM = { 12: 0.08, 24: 0.04 };
// the battery's guns are said to reach well against a box inside this slant range (the crew lets a box
// going away go beyond it: sim/mounts.js batteryPick)
const LONG = 11000;

// One plain sentence on what the battery is doing (the header's English line).
function line(u, data) {
  if (u.alive === false) return 'No longer in action';
  const pr = u.predictor;
  const g = u.weapons.gun;
  if (u.mode === 'hold') return 'FEUER HALT: guns safe';
  if (pr.barrage) {
    const b = pr.barrage;
    const c = u.parts.find((p) => p.role === 'gun' && p.alive)?.pos ?? u.pos;
    const brg = pad3(Math.round(wrap2(Math.atan2(b.center.x - c.x, -(b.center.z - c.z))) / DEG) % 360);
    const t = data.time ?? 0;
    const when = t < b.from ? `, in ${Math.ceil(b.from - t)} s` : g.firing ? ', firing' : u.mode === 'manual' ? ', hold FEUER' : '';
    return `BARRAGE ${brg}, ${thou(Math.round(b.center.y / 100) * 100)} m${when}`;
  }
  if (pr.hold === 'no predictor') return 'PREDICTOR OUT: barrage fire only';
  if (pr.target != null) {
    const id = pad3(pr.target);
    const src = pr.source === 'radar' ? 'Wuerzburg' : 'rangefinder';
    if (pr.hold === 'not held') return `LAYING ON ${id}: predictor not on it yet`;
    if (pr.hold === 'out of reach') return `${id} OUT OF REACH: no solution`;
    if (pr.source === 'radar' && pr.window > 0.3) return `WINDOW ON ${id}: miss ${Math.round(pr.sigma)} m, use E-MESSER`;
    if (g.firing && pr.lastSalvo > (data.time ?? 0) - 6) return `SALVO ${pr.salvos} at ${id}, fuze ${dec(pr.fuze, 1)} s`;
    if (pr.state === 'tracking') return `SETTLING ON ${id}: ${Math.round(pr.quality * 100)} %, ${src}`;
    if (pr.state === 'solution') return u.mode === 'manual' ? `SOLUTION ON ${id}: FEUER (hold Space)` : `SOLUTION ON ${id}: crew firing salvos`;
  }
  if (u.mode === 'manual') return u.selected != null ? `MANUAL: ${pad3(u.selected)} selected` : 'MANUAL: pick a target on the plot';
  const n = u.tracks.filter((t) => PLANE.has(t.cls)).length;
  return n ? `AUTO: lookouts watching ${n} aircraft` : 'AUTO: sky clear';
}

export function mountBattery(ctx) {
  const { send, memo } = ctx;
  const root = el('div', 'con c44 battery44');
  const hdr = new Header44('8,8 CM FLAK 37', 'HEAVY BATTERY');
  let u = null;
  memo.zoom ??= 12;
  memo.plotR ??= 20000;
  const pick = (id) => send('select', { trackId: id });

  // ---------------------------------------------------------------- the predictor's telescope
  const ps = plate('ZIELFERNROHR', 'PREDICTOR TELESCOPE', 'pl-sight');
  const sight = new Sight44({ canvas: ctx.sight, style: 'kdo', onPick: pick });
  const zoom = new Seg({ cls: 'compact zoom44', items: [12, 24].map((z) => ({ v: z, ru: `${z}×`, en: 'ZOOM' })), onChange: (v) => { memo.zoom = v; } });
  ps.el.append(zoom.el);
  ps.body.append(sight.el);
  tut(ps.el, 'sight');
  tut(zoom.el, 'zoom');

  // ---------------------------------------------------------------- Kommandogeraet 40
  const pk = plate('KOMMANDOGERÄT 40', 'PREDICTOR: TARGET DATA AND SOLUTION', 'pl-kdo');
  const D = 64;
  const dBrg = new Dial({ size: D, wrap: true, min: 0, max: 360, major: 90, minor: 10, fig: (v) => String(v / 10), unit: '×10°', de: 'SEITE', en: 'BEARING' });
  const dEl = new Dial({ size: D, min: 0, max: 90, arc: [-120, 120], major: 30, minor: 5, unit: 'GRAD', de: 'HÖHENWINKEL', en: 'ELEVATION' });
  const dRng = new Dial({ size: D, min: 0, max: 20, arc: [-135, 135], major: 5, minor: 1, unit: 'km', de: 'ENTFERNUNG', en: 'SLANT RANGE' });
  const dAlt = new Dial({ size: D, min: 0, max: 10, arc: [-135, 135], major: 5, minor: 1, unit: 'km', de: 'ZIELHÖHE', en: 'HEIGHT' });
  const dCrs = new Dial({ size: D, wrap: true, min: 0, max: 360, major: 90, minor: 10, fig: (v) => String(v / 10), unit: '×10°', de: 'KURS', en: 'COURSE' });
  const dSpd = new Dial({ size: D, min: 0, max: 300, arc: [-135, 135], major: 100, minor: 20, unit: 'm/s', de: 'FAHRT', en: 'SPEED' });
  const dQ = new Dial({ size: D, min: 0, max: 100, arc: [-120, 120], major: 50, minor: 10, zones: [[0, 30, '#c0392b'], [30, 55, '#e0a020'], [55, 100, '#3fae55']], unit: '%', de: 'GÜTE', en: 'SOLUTION' });
  const dFz = new Dial({ size: D, min: 0, max: 30, arc: [-135, 135], major: 10, minor: 2, unit: 's', de: 'ZÜNDER', en: 'FUZE: SENT / SET' });
  const dials = el('div', 'dials44');
  dials.append(dBrg.el, dEl.el, dRng.el, dAlt.el, dCrs.el, dSpd.el, dQ.el, dFz.el);
  // the solution lamp blinks while the solution settles and burns once it is good enough to fire on
  const lHeld = new Lamp44('ERFASST', 'TARGET HELD', 'green');
  const lSol = new Lamp44('LÖSUNG', 'SETTLED', 'green');
  const lOut = new Lamp44('ZU WEIT', 'OUT OF REACH', 'red');
  const lWin = new Lamp44('DÜPPEL', 'WINDOW', 'red');
  const lamps = el('div', 'lamps44');
  lamps.append(lHeld.el, lSol.el, lOut.el, lWin.el);
  const rTof = new Drum('FLUGZEIT', 'FLIGHT s', '88,8');
  const rSig = new Drum('STREUUNG', 'MISS m', '888');
  const kRow = el('div', 'rowc krow');
  kRow.append(lamps, rTof.el, rSig.el);
  pk.body.append(dials, kRow);
  tut(pk.el, 'kdo');
  tut(dQ.el, 'quality');
  tut(dFz.el, 'fuze');
  tut(lamps, 'solution');
  tut(lWin.el, 'window');

  // ---------------------------------------------------------------- fire control
  const pf = plate('FEUERLEITUNG', 'FIRE CONTROL', 'pl-fire');
  const mode = new Knob({ items: MODE44, de: 'FEUERERLAUBNIS', en: 'MODE', onChange: (v) => send('mode', { mode: v }) });
  const art = new Knob({
    items: [{ v: 'aimed', de: 'GEZIELT', en: 'PREDICTED' }, { v: 'barrage', de: 'SPERRE', en: 'BARRAGE' }], de: 'FEUERART', en: 'FIRE',
    onChange: (v) => barrage(v === 'barrage'),
  });
  const rng = new Knob({
    items: [{ v: 'optical', de: 'E-MESSER', en: 'RANGEFINDER' }, { v: 'radar', de: 'FuMG', en: 'WÜRZBURG' }], de: 'ENTFERNUNG AUS', en: 'RANGE FROM',
    onChange: (v) => send('ranging', { source: v }),
  });
  const knobs = el('div', 'rowc knobs');
  knobs.append(mode.el, art.el, rng.el);
  const radar = new Toggle({ ru: 'FuMG 62', en: 'WÜRZBURG ON', color: 'green', onChange: (on) => send('radar', { on }) });
  const trig = new Btn({ ru: 'FEUER', en: 'SALVOS (HOLD)', color: 'red', hold: true, cls: 'big trig44', onDown: () => trigger(true), onUp: () => trigger(false) });
  const salvo = new Btn({ ru: 'SALVE', en: 'ONE SALVO', color: 'amber', onClick: () => { takeManual(u, send, true); send('fire', {}); } });
  const stop = new Btn({ ru: 'STOPFEN', en: 'CEASE ON TARGET', color: 'white', onClick: () => { if (u) send('cease', { trackId: u.selected }); } });
  const rSalvos = new Drum('SALVEN', 'SALVOS', '888');
  const bts = el('div', 'rowc btns44');
  bts.append(radar.el, trig.el, salvo.el, stop.el, rSalvos.el);
  pf.body.append(knobs, bts);
  tut(mode.el, 'mode');
  tut(art.el, 'barrage');
  tut(rng.el, 'ranging');
  tut(radar.el, 'radar');
  tut(trig.el, 'trigger');
  tut(salvo.el, 'salvo');
  tut(stop.el, 'cease');

  // ---------------------------------------------------------------- the gun reports
  const pg = plate('GESCHÜTZMELDUNGEN', 'GUN REPORTS', 'pl-guns');
  const gh = el('div', 'grow44 ghead');
  for (const [de, en] of [['GESCH.', 'GUN'], ['RICHT.', 'LAID'], ['GEL.', 'LOADED'], ['ZÜNDER', 'FUZE s'], ['FEUER', 'FIRED'], ['MUN.', 'ROUNDS'], ['', '']]) gh.append(label(de, en, 'cap'));
  const gl = el('div', 'glist44');
  gl.append(gh);
  const rows = [];
  pg.body.append(gl);
  tut(pg.el, 'guns');
  const pgSub = pg.el.querySelector('.ptitle i');

  // ---------------------------------------------------------------- Wuerzburg, plot, targets
  const pw = plate('WÜRZBURG D', 'FuMG 62 RADAR', 'pl-wz');
  const wz = new Wurzburg44({ size: 136, strip: 20 });
  pw.body.append(wz.el);
  tut(pw.el, 'wurzburg');
  const pp = plate('FLUGMELDEKARTE', 'AIR PICTURE', 'pl-plot');
  const plot = new Plot44({ size: 172, range: memo.plotR, onPick: pick });
  const scale = new Seg({ cls: 'compact stack44', items: [10, 20, 45].map((k) => ({ v: k * 1000, ru: `${k}`, en: 'km' })), onChange: (v) => { memo.plotR = v; } });
  const prow = el('div', 'rowc plotrow');
  prow.append(plot.el, scale.el);
  pp.body.append(prow);
  tut(pp.el, 'plot');
  const pt = plate('ZIELE', 'TARGETS: OWN AND REPORTED', 'pl-list');
  const list = new TargetList({ onPick: pick });
  pt.body.append(list.el);
  tut(pt.el, 'tracks');

  const selBar = new SelBar44();
  tut(selBar.el, 'selbar');
  tut(hdr.el, 'header');
  const left = el('div', 'col leftc');
  left.append(ps.el, pf.el);
  const right = el('div', 'col rightc');
  right.append(pk.el, pg.el);
  const top = el('div', 'row top');
  top.append(left, right);
  const low = el('div', 'row low');
  low.append(pw.el, pp.el, pt.el);
  const keys = el('div', 'helpline', 'TAB: TARGET   SPACE: FEUER (HOLD)   A: MODE   G: BARRAGE   T: RANGE FROM   R: WÜRZBURG   Q: ZOOM');
  root.append(hdr.el, selBar.el, top, low, keys);

  function trigger(down) {
    if (down) takeManual(u, send, true);
    send('trigger', { down });
  }
  // barrage on the selected formation (or off: predicted fire again)
  function barrage(on) {
    if (!u) return;
    if (!on) return send('barrage', { on: false });
    send('barrage', { on: true, trackId: u.selected });
  }
  function buildRows(unit) {
    for (const r of rows) r.el.remove();
    rows.length = 0;
    unit.parts.forEach((p, i) => {
      if (!p.gun) return;
      const heavy = p.role === 'gun';
      const r = { i, heavy, el: el('div', 'grow44' + (heavy ? '' : ' close')) };
      const id = el('div', 'gid');
      id.append(el('b', null, heavy ? p.letter ?? '?' : '2 cm'), el('i', null, heavy ? LETTER[p.letter] ?? '' : p.name.replace('2 cm gun ', 'NR. ')));
      r.dial = heavy ? new Dial({ size: 26, min: 0, max: 90, arc: [-120, 120], major: 30, minor: 15, fig: () => '' }) : null;
      r.laid = new Lamp44('', '', 'green', 'mini');
      r.load = new Lamp44('', '', 'white', 'mini');
      r.fuze = el('span', 'gfz');
      r.fire = new Lamp44('', '', 'red', 'mini');
      r.rounds = el('span', 'grd');
      r.st = el('span', 'gst');
      const lc = el('div', 'gcell');
      if (r.dial) lc.append(r.dial.el);
      lc.append(r.laid.el);
      r.el.append(id, lc, r.load.el, r.fuze, r.fire.el, r.rounds, r.st);
      gl.append(r.el);
      rows.push(r);
    });
    rows.key = unit.id;
  }

  let spaceDown = false;
  return {
    el: root,
    key(e, down) {
      if (e.code === 'Space') {
        if (down === spaceDown) return true;
        spaceDown = down;
        trig.press(down);
        trigger(down);
        return true;
      }
      if (!down || !u) return false;
      const pr = u.predictor;
      switch (e.code) {
        case 'KeyA': send('mode', { mode: MODES[(MODES.indexOf(u.mode) + 1) % 3] }); snd('switch'); return true;
        case 'KeyR': send('radar', { on: !u.radar.track }); snd('switch'); return true;
        case 'KeyT': send('ranging', { source: pr.ranging === 'radar' ? 'optical' : 'radar' }); snd('switch'); return true;
        case 'KeyG': barrage(!pr.barrage); snd('switch'); return true;
        case 'KeyQ': memo.zoom = memo.zoom === 12 ? 24 : 12; snd('click'); return true;
        default: return false;
      }
    },
    update(dt, unit, data) {
      u = unit;
      const pr = u.predictor;
      const tracks = u.tracks || [];
      if (rows.key !== u.id) buildRows(u);
      hdr.update(u, line(u, data));
      const sel = u.selected != null ? tracks.find((t) => t.id === u.selected) ?? null : null;
      selBar.update(u, sel, data);
      const tg = pr.target != null ? tracks.find((t) => t.id === pr.target) ?? null : null;

      // the telescope
      const kgI = u.parts.findIndex((p) => p.role === 'predictor');
      const kg = u.parts[kgI];
      const fov = ZOOM[memo.zoom] ?? ZOOM[12];
      VIEW.set(u.id, { part: kgI, fov });
      zoom.set(memo.zoom);
      const state = pr.hold === 'out of reach' && pr.locked ? ['ZU WEIT', '#ff8a62'] : pr.state === 'solution' ? ['LÖSUNG', '#8fe39c'] : pr.state === 'tracking' ? [`EINSCHWINGEN ${Math.round(pr.quality * 100)} %`, '#ffc04a'] : pr.state === 'barrage' ? ['SPERRFEUER', '#ffc04a'] : pr.state === 'acquiring' ? ['SUCHEN', '#ffc04a'] : ['', '#ccc'];
      sight.update(dt, kg ? {
        eye: { x: kg.pos.x, y: kg.pos.y + 1.6, z: kg.pos.z }, az: compassOf(u, kg.turret), el: kg.turret.el, fov,
        tracks: tracks.filter((t) => PLANE.has(t.cls)), target: tg,
        info: { mag: memo.zoom, range: pr.locked ? pr.range : tg?.range, fuze: pr.locked ? pr.fuze : 0, state: state[0], stateCol: state[1], held: pr.locked, down: !kg.alive },
      } : null);

      // the predictor's dials: the target's present data from the predictor (its position)
      if (tg && kg?.alive) {
        const dx = tg.pos.x - kg.pos.x, dy = tg.pos.y - kg.pos.y, dz = tg.pos.z - kg.pos.z;
        dBrg.set(wrap2(Math.atan2(dx, -dz)) / DEG);
        dEl.set(Math.atan2(dy, Math.hypot(dx, dz)) / DEG);
        dRng.set((pr.locked ? pr.range : Math.hypot(dx, dy, dz)) / 1000);
        dAlt.set(tg.alt / 1000);
        dCrs.set(courseOf(tg) / DEG);
        dSpd.set(tg.speed);
      } else for (const d of [dBrg, dEl, dRng, dAlt, dCrs, dSpd]) d.set(null);
      dQ.set(pr.locked ? pr.quality * 100 : null);
      const a = u.parts.find((p) => p.role === 'gun' && p.alive);
      dFz.set(pr.locked && pr.valid ? pr.fuze : null, a?.gun.loaded ? a.gun.fuze : null);
      rTof.set(pr.locked && pr.valid ? dec(pr.tof, 1) : '--,-');
      rSig.set(pr.locked ? String(Math.round(pr.sigma)) : '---');
      lHeld.set(pr.locked ? 1 : pr.target != null && !pr.barrage ? 2 : 0);
      lSol.set(pr.state === 'solution' ? 1 : pr.state === 'tracking' && pr.hold !== 'out of reach' ? 2 : 0);
      lOut.set(pr.hold === 'out of reach' ? 1 : 0);
      lWin.set(pr.source === 'radar' && pr.window > 0.3 ? 2 : pr.window > 0.3 ? 1 : 0);

      // fire control
      mode.set(u.mode);
      art.set(pr.barrage ? 'barrage' : 'aimed');
      rng.set(pr.ranging);
      radar.set(!!u.radar.track);
      const g = u.weapons.gun;
      trig.set(g.trigger && g.firing);
      salvo.enable(!!pr.target || !!pr.barrage);
      rSalvos.set(String(pr.salvos % 1000));
      if (pr.barrage) {
        trig.enable(g.rounds > 0);
        trig.text('FEUER', 'BARRAGE (HOLD)');
        setCls(trig.el, 'warn', false);
        setCls(trig.el, 'out', false);
      } else {
        const r = !tg ? null : pr.hold === 'out of reach' || pr.hold === 'no predictor' ? 'out' : pr.range > LONG || pr.hold === 'settling' ? 'long' : 'in';
        setTrigger44(trig, r, 'SALVOS (HOLD)', g.rounds > 0);
        if (r === 'long' && pr.hold === 'settling') trig.text('FEUER', 'SETTLING: FEW HITS');
      }

      // the gun reports
      const now = data.time ?? 0;
      let tot = 0;
      for (const r of rows) {
        const p = u.parts[r.i];
        const gg = p.gun;
        const dead = !p.alive;
        tot += gg.rounds + (gg.loaded ? 1 : 0) + gg.table + gg.clip + gg.barrels.reduce((s, b) => s + b.mag + b.next, 0);
        setCls(r.el, 'dead', dead);
        r.fire.set(!dead && gg.recoil >= 0 && gg.recoil < 0.5 ? 1 : 0);
        if (r.heavy) {
          r.dial.set(dead ? null : gg.order.el / DEG, dead ? null : p.turret.el / DEG);
          r.laid.set(!dead && gg.laid ? 1 : 0);
          r.load.set(!dead && gg.loaded ? 1 : 0);
          setText(r.fuze, dead || !(gg.fuze > 0) ? '' : dec(gg.fuze, 1));
          setText(r.rounds, dead ? '' : String(gg.rounds + (gg.loaded ? 1 : 0)));
          setText(r.st, dead ? 'AUSFALL' : now < (gg.cover ?? 0) ? 'DECKUNG' : !gg.loaded ? 'LADEN' : pr.barrage || pr.locked ? (gg.laid ? 'BEREIT' : 'RICHTEN') : '');
        } else {
          const b = gg.barrels[0];
          r.laid.set(!dead && gg.laid ? 1 : 0);
          r.load.set(!dead && b.change <= 0 && b.mag > 0 ? 1 : 0);
          setText(r.fuze, dead ? '' : `${b.mag}/20`);
          setText(r.rounds, dead ? '' : String(gg.rounds + b.mag + b.next));
          setText(r.st, dead ? 'AUSFALL' : b.change > 0 ? 'MAG.WECHSEL' : gg.firing ? 'FEUER' : gg.target != null ? 'ZIEL ' + pad3(gg.target) : '');
        }
        setCls(r.st, 'bad', dead);
      }
      setText(pgSub, `GUN REPORTS   MUNITION ${thou(tot)} / ROUNDS`);

      // the radar, the plot and the list
      wz.update(dt, u, tracks, pr);
      plot.setRange(memo.plotR);
      scale.set(memo.plotR);
      plot.update(dt, u, tracks, data, [[LONG, '8,8 cm'], [SYSTEMS.flak88.predictor.range, 'KdO 40']]);
      list.update(dt, u, tracks, data);
    },
    dispose() {
      if (spaceDown || trig.held) send('trigger', { down: false });
      radar.dispose();
      VIEW.delete(u?.id);
    },
  };
}
