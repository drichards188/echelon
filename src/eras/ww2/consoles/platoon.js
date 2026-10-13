// The platoon consoles (`flak43`, `flakvierling`, `flak38`): the player is the platoon leader (Zugfuehrer)
// of three guns, each laid and fired by its own crew on its own sight (refs/ww2/flak43, flakvierling,
// flak38; sim/mounts.js 'platoon'). What it shows:
//   the layer's sight   the picture along one gun's bore (the gun in action, or the one picked), with its
//                       sight drawn over it: the Schwebedornvisier 43 of the 3.7 cm (its floating pin
//                       coloured by speed and marked by range), the Flakvisier 38 or 40 of the 2 cm (the
//                       lit ring on the lit cross wires, moved by the lead); sights.js
//   the platoon leader  the mode (FEUER FREI auto: every crew picks its own target; AUF BEFEHL manual: all
//                       three take the selected one and fire while FEUER is held; FEUER HALT hold), the
//                       fire distribution in auto (spread over the targets, or all on the selected one:
//                       `concentrate`), FEUER with the modern trigger's OUT OF RANGE and LONG RANGE faces
//                       (kit.js reach44, per gun), Stopfen (cease), the range-taker's range, height and
//                       speed of the selected aircraft, in-range lamps
//   the three guns      per gun: laid, firing, taking cover from strafing, out of action; its target and
//                       why it holds; the feed: the 3.7 cm's loading table (two 8-round clips, `table`) and
//                       the clip its loader is laying (`clip`, `load`), the 2 cm's 20-round magazine per
//                       barrel and its change (`barrels[k] { mag, change }`; the Vierling's four, 1L 2R up,
//                       4L 3R down); shots fired and rounds in the pit. The Flakvierling's third gun is the
//                       tower gun. A card picks that gun's sight.
//   the air picture     the plotting board (plot.js) with the guns' reach, and the target list; a click
//                       designates (`select`)
// Commands: select, mode, trigger { down }, cease, concentrate { on }. Keys: Space FEUER (hold), A mode,
// G distribution, Q the next gun's sight.
import { SYSTEMS } from '../../../sim/systems.js';
import { SHELLS, reachOf } from '../../../ballistics.js';
import { el, setText, setCls, plate, label, Btn, Seg, snd } from '../../../ui/widgets.js';
import { tut } from '../../../ui/highlight.js';
import { takeManual } from '../../../ui/consoles/common.js';
import { Header44, SelBar44, Lamp44, Drum, Knob, TargetList, VIEW, PLANE, reach44, setTrigger44, compassOf, dec, thou, km, pad3 } from './kit.js';
import { Sight44 } from './sights.js';
import { Plot44 } from './plot.js';
import { MODE44 } from './battery.js';

const MODES = ['auto', 'manual', 'hold'];

// per unit kind: the console's names, its sight, the sight picture's field of view (rad: wide enough for a
// crossing fighter's lead, 15 degrees and more close in)
export const PLATOON = {
  flak43: { de: '3,7 CM FLAK 43', en: 'MEDIUM FLAK PLATOON', style: 'dorn', sight: ['SCHWEBEDORNVISIER 43', "LAYER'S FLOATING-PIN SIGHT"], fov: 0.75 },
  flakvierling: { de: '2 CM FLAKVIERLING 38', en: 'LIGHT FLAK PLATOON', style: 'visier', sight: ['FLAKVISIER 40', "LAYER'S COMPUTING REFLECTOR SIGHT"], fov: 0.7 },
  flak38: { de: '2 CM FLAK 38', en: 'LIGHT FLAK PLATOON', style: 'visier', sight: ['FLAKVISIER 38', "LAYER'S COMPUTING REFLECTOR SIGHT"], fov: 0.7 },
};

// a gun's name on the console
export const gunName = (p, i) => (p.kind === 'flakvierling-tower' ? ['TURM', 'TOWER GUN'] : [`GESCHÜTZ ${i + 1}`, `GUN ${i + 1}`]);
const SHELL = { '37mm': '3.7 cm', '20mm': '2 cm' };
const HOLD = { 'out of reach': ['ZU WEIT', 'OUT OF REACH'], 'no lock': ['NICHT IM VISIER', 'NOT IN SIGHT'], 'target lost': ['ZIEL VERLOREN', 'TARGET LOST'] };

// the gun whose sight the console shows: the one picked, else the gun in action (the camera's, u.nextGun)
export const sightGun = (u, pick) => (pick >= 0 && u.parts[pick]?.gun ? pick : u.nextGun ?? 0);

function line(u, keep) {
  if (u.alive === false) return 'No longer in action';
  if (u.mode === 'hold') return 'FEUER HALT: guns safe';
  const guns = u.parts.filter((p) => p.gun && p.alive && keep(p));
  const g = u.weapons.gun;
  const firing = guns.filter((p) => p.gun.firing);
  const shell = SHELL[g.shell] ?? g.shell;
  if (firing.length) {
    const ids = [...new Set(firing.map((p) => p.gun.target).filter((x) => x != null))].map(pad3).join(', ');
    return `FIRING ${shell}${ids ? ' on ' + ids : ''} (${firing.length} gun${firing.length > 1 ? 's' : ''})`;
  }
  if (u.mode === 'manual') {
    if (u.selected == null) return 'MANUAL: pick a target, hold FEUER';
    const held = guns.map((p) => p.gun.hold).find((h) => h);
    if (g.trigger && held) return `GUNS HELD on ${pad3(u.selected)}: ${held}`;
    return `MANUAL: ${pad3(u.selected)} selected, hold FEUER`;
  }
  const on = guns.filter((p) => p.gun.target != null);
  if (on.length) return `AUTO: ${on.length} gun${on.length > 1 ? 's' : ''} on ${[...new Set(on.map((p) => pad3(p.gun.target)))].join(', ')}${u.concentrate ? ', concentrated' : ''}`;
  const n = u.tracks.filter((t) => PLANE.has(t.cls)).length;
  return n ? `AUTO: spotters watching ${n} aircraft` : 'AUTO: sky clear';
}

// The feed at one gun: pips for the rounds, the loader's work as a bar
function feedView(kind, p) {
  const f = el('div', 'feed44');
  const out = { el: f, pips: [], mags: [] };
  const pips = (n, cls) => {
    const row = el('div', 'pips ' + cls);
    const list = [];
    for (let i = 0; i < n; i++) {
      const e = el('i');
      row.append(e);
      list.push(e);
    }
    return { row, list };
  };
  if (kind === 'flak43') {
    // the loading table: two clips side by side, firing from the right; the loader laying the next
    const t = el('div', 'table44');
    const a = pips(8, 'clip'), b = pips(8, 'clip');
    t.append(a.row, b.row);
    out.pips = [...a.list, ...b.list];
    const ld = el('div', 'loader44');
    out.bar = el('i', 'lbar');
    out.ltxt = el('span', 'ltxt');
    ld.append(label('LADER', 'LOADER', 'cap'), el('div', 'lwell', null), out.ltxt);
    ld.children[1].append(out.bar);
    f.append(label('LADETISCH', 'LOADING TABLE: 2 CLIPS OF 8', 'cap'), t, ld);
  } else {
    // magazines of 20, one per barrel (the Vierling: 1L 2R over 4L 3R, as the guns sit)
    const names = p.gun.barrels.length === 4 ? ['1 L', '2 R', '4 L', '3 R'] : [''];
    const grid = el('div', 'mags44 n' + names.length);
    names.forEach((nm, k) => {
      const m = el('div', 'mag44');
      const pp = pips(20, 'mag');
      const ch = el('i', 'chg');
      m.append(el('b', null, nm), pp.row, ch);
      grid.append(m);
      out.mags.push({ pips: pp.list, ch, el: m });
    });
    f.append(label(names.length > 1 ? 'MAGAZINE' : 'MAGAZIN', names.length > 1 ? 'FOUR 20-ROUND MAGAZINES, TWO LOADERS' : '20-ROUND MAGAZINE, ONE LOADER', 'cap'), grid);
  }
  return out;
}

// o (the flak tower's console, turm.js): keep(part) (the guns this page shows; default all), guns (their
// buttons' labels in order; default 1, 2, 3), title [de, en], keys (more help)
export function mountPlatoon(ctx, kind, o = {}) {
  const { send, memo } = ctx;
  const K = PLATOON[kind];
  const keep = o.keep ?? (() => true);
  const root = el('div', `con c44 platoon44 k-${kind}`);
  const hdr = new Header44(...(o.title ?? [K.de, K.en]));
  // the guns on this page (part indices) and the gun picked by its place among them
  const gunsOf = (unit) => unit.parts.flatMap((p, i) => (p.gun && keep(p) ? [i] : []));
  const nameOf = (unit, i) => {
    const k = o.guns ? gunsOf(unit).indexOf(i) : -1;
    return k >= 0 ? [`GESCHÜTZ ${o.guns[k]}`, `GUN ${o.guns[k]}`] : gunName(unit.parts[i], i);
  };
  let u = null;
  memo.gun ??= -1;
  memo.plotR ??= 10000;
  const pick = (id) => send('select', { trackId: id });

  // ---------------------------------------------------------------- the layer's sight
  const ps = plate(K.sight[0], 'SIGHT', 'pl-sight');
  const sight = new Sight44({ canvas: ctx.sight, style: K.style, onPick: pick });
  const labels = o.guns ?? ['1', '2', kind === 'flakvierling' ? 'T' : '3'];
  const gunSeg = new Seg({ cls: 'compact zoom44', items: [{ v: -1, ru: 'AUTO', en: 'IN ACTION' }, ...labels.map((l, k) => ({ v: k, ru: l, en: 'GUN' }))], onChange: (v) => { memo.gun = v < 0 || !u ? -1 : gunsOf(u)[v] ?? -1; } });
  ps.el.append(gunSeg.el);
  ps.body.append(sight.el);
  tut(ps.el, 'sight');
  tut(gunSeg.el, 'gunsel');

  // ---------------------------------------------------------------- the platoon leader
  const pz = plate('ZUGFÜHRER', 'PLATOON LEADER', 'pl-zug');
  const mode = new Knob({ items: MODE44, de: 'FEUERERLAUBNIS', en: 'MODE', onChange: (v) => send('mode', { mode: v }) });
  const dist = new Knob({
    items: [{ v: false, de: 'VERTEILT', en: 'OWN TARGETS' }, { v: true, de: 'ZUSAMMEN', en: 'ALL ON MINE' }], de: 'ZIELVERTEILUNG', en: 'IN FEUER FREI',
    onChange: (v) => send('concentrate', { on: v }),
  });
  const knobs = el('div', 'rowc knobs');
  knobs.append(mode.el, dist.el);
  const trig = new Btn({ ru: 'FEUER', en: 'FIRE (HOLD)', color: 'red', hold: true, cls: 'big trig44', onDown: () => trigger(true), onUp: () => trigger(false) });
  const stop = new Btn({ ru: 'STOPFEN', en: 'CEASE ON TARGET', color: 'white', onClick: () => { if (u) send('cease', { trackId: u.selected }); } });
  const bts = el('div', 'rowc btns44');
  bts.append(trig.el, stop.el);
  const rRng = new Drum('ENTFERNUNG', 'RANGE km', '88,8');
  const rAlt = new Drum('HÖHE', 'HEIGHT m', '8888');
  const rSpd = new Drum('FAHRT', 'SPEED m/s', '888');
  const drums = el('div', 'rowc drums');
  drums.append(rRng.el, rAlt.el, rSpd.el);
  const lIn = new Lamp44('IM BEREICH', 'IN RANGE', 'amber');
  const lOut = new Lamp44('ZU WEIT', 'OUT OF RANGE', 'red');
  const lamps = el('div', 'lamps44');
  lamps.append(lIn.el, lOut.el);
  // the gun's data plate: the shells' reach and where the crews open fire (SHELLS, SYSTEMS guns)
  const G = SYSTEMS[kind].guns[kind];
  const dplate = el('div', 'dplate44');
  dplate.append(label(`REICHWEITE ${km(reachOf(SHELLS[G.shell]))} km   FEUER AB ${km(G.range)} km`, 'SHELLS SELF-DESTRUCT / CREWS OPEN FIRE'));
  const lrow = el('div', 'rowc lrow');
  lrow.append(lamps, dplate);
  pz.body.append(knobs, bts, drums, lrow);
  tut(mode.el, 'mode');
  tut(dist.el, 'concentrate');
  tut(trig.el, 'trigger');
  tut(stop.el, 'cease');
  tut(drums, 'range');
  tut(lamps, 'lamps');

  // ---------------------------------------------------------------- the three guns
  const pg = el('div', 'row guns44');
  const cards = [];
  tut(pg, 'guns');

  // ---------------------------------------------------------------- plot and targets
  const pp = plate('FLUGMELDEKARTE', 'AIR PICTURE', 'pl-plot');
  const plot = new Plot44({ size: 172, range: memo.plotR, onPick: pick });
  const scale = new Seg({ cls: 'compact stack44', items: [5, 10, 20].map((k) => ({ v: k * 1000, ru: `${k}`, en: 'km' })), onChange: (v) => { memo.plotR = v; } });
  const prow = el('div', 'rowc plotrow');
  prow.append(plot.el, scale.el);
  pp.body.append(prow);
  tut(pp.el, 'plot');
  const pt = plate('ZIELE', 'TARGETS: SPOTTERS AND REPORTED', 'pl-list');
  const list = new TargetList({ onPick: pick });
  pt.body.append(list.el);
  tut(pt.el, 'tracks');

  const selBar = new SelBar44();
  tut(selBar.el, 'selbar');
  tut(hdr.el, 'header');
  const top = el('div', 'row top');
  top.append(ps.el, pz.el);
  const low = el('div', 'row low');
  low.append(pp.el, pt.el);
  const keys = el('div', 'helpline', 'TAB: TARGET   SPACE: FEUER (HOLD)   A: MODE   G: DISTRIBUTION   Q: NEXT GUN\'S SIGHT   CLICK A GUN: ITS SIGHT' + (o.keys ?? ''));
  root.append(hdr.el, selBar.el, top, pg, low, keys);

  function trigger(down) {
    if (down) takeManual(u, send, true);
    send('trigger', { down });
  }

  function buildCards(unit) {
    pg.replaceChildren();
    cards.length = 0;
    unit.parts.forEach((p, i) => {
      if (!p.gun || !keep(p)) return;
      const nm = nameOf(unit, i);
      const c = { i, el: el('section', 'plate gcard44') };
      const t = el('div', 'ptitle');
      t.append(el('b', null, nm[0]), el('i', null, nm[1]));
      const body = el('div', 'pbody');
      c.laid = new Lamp44('GERICHTET', 'LAID', 'green', 'mini');
      c.fire = new Lamp44('FEUER', 'FIRING', 'red', 'mini');
      c.cover = new Lamp44('DECKUNG', 'COVER', 'amber', 'mini');
      const lr = el('div', 'rowc glamps');
      lr.append(c.laid.el, c.fire.el, c.cover.el);
      c.tgt = el('b', 'gtgt');
      c.why = el('i', 'gwhy');
      const tl = el('div', 'gline');
      tl.append(c.tgt, c.why);
      c.feed = feedView(p.kind, p);
      c.shots = new Drum('SCHUSS', 'FIRED', '8888', 'sm');
      c.rounds = new Drum('MUNITION', 'IN THE PIT', '8888', 'sm');
      const dr = el('div', 'rowc gdrums');
      dr.append(c.shots.el, c.rounds.el);
      body.append(lr, tl, c.feed.el, dr);
      c.el.append(t, body);
      c.el.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        snd('click');
        memo.gun = memo.gun === i ? -1 : i;
      });
      pg.append(c.el);
      cards.push(c);
    });
    cards.key = unit.id;
    for (const c of cards) tut(c.feed.el, 'feed');
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
      switch (e.code) {
        case 'KeyA': send('mode', { mode: MODES[(MODES.indexOf(u.mode) + 1) % 3] }); snd('switch'); return true;
        case 'KeyG': send('concentrate', { on: !u.concentrate }); snd('switch'); return true;
        case 'KeyQ': {
          const guns = gunsOf(u);
          const cur = memo.gun < 0 ? -1 : guns.indexOf(memo.gun);
          memo.gun = cur + 1 >= guns.length ? -1 : guns[cur + 1];
          snd('click');
          return true;
        }
        default: return false;
      }
    },
    update(dt, unit, data) {
      u = unit;
      const tracks = u.tracks || [];
      if (cards.key !== u.id) buildCards(u);
      hdr.update(u, line(u, keep));
      const sel = u.selected != null ? tracks.find((t) => t.id === u.selected) ?? null : null;
      selBar.update(u, sel, data);
      const sys = SYSTEMS[u.kind];

      // the sight of the gun picked (or the one in action)
      const gi = sightGun(u, memo.gun);
      const p = u.parts[gi];
      const def = sys.guns[p.kind];
      const g = p.gun;
      VIEW.set(u.id, { part: gi, fov: K.fov });
      gunSeg.set(memo.gun < 0 ? -1 : gunsOf(u).indexOf(memo.gun));
      const tg = (g.target ?? u.selected) != null ? tracks.find((t) => t.id === (g.target ?? u.selected)) ?? null : null;
      const nm = nameOf(u, gi);
      const why = HOLD[g.hold];
      sight.update(dt, {
        eye: { x: p.pos.x, y: p.pos.y + def.height + 0.4, z: p.pos.z }, az: compassOf(u, p.turret), el: p.turret.el, fov: K.fov,
        tracks: tracks.filter((t) => PLANE.has(t.cls)), target: tg, aim: g.aimOk ? g.aim : null, shell: def.shell,
        info: {
          title: K.sight[0], gun: `${nm[0]} / ${nm[1]}`, tof: g.aimOk ? g.tof : 0, firing: g.firing, down: !p.alive,
          line: g.firing ? 'FEUER' : why ? why[0] : g.target != null ? (g.laid ? 'GERICHTET' : 'RICHTEN') : 'KEIN ZIEL',
        },
      });

      // the platoon leader's controls
      mode.set(u.mode);
      dist.set(!!u.concentrate);
      const r = reach44(u, sel);
      const ug = u.weapons.gun;
      setTrigger44(trig, r, 'FIRE (HOLD)', ug.rounds > 0);
      trig.set(ug.trigger && ug.firing);
      rRng.set(sel ? km(sel.range) : '--,-');
      rAlt.set(sel ? thou(sel.alt) : '----');
      rSpd.set(sel ? String(Math.round(sel.speed)) : '---');
      lIn.set(r === 'in' ? 1 : 0);
      lOut.set(r === 'out' ? 1 : 0);

      // the guns
      const now = data.time ?? 0;
      for (const c of cards) {
        const q = u.parts[c.i];
        const gg = q.gun;
        const dead = !q.alive;
        setCls(c.el, 'dead', dead);
        setCls(c.el, 'view', c.i === gi);
        c.laid.set(!dead && gg.laid ? 1 : 0);
        c.fire.set(!dead && gg.firing ? 1 : 0);
        c.cover.set(!dead && now < (gg.cover ?? 0) ? 2 : 0);
        const t = gg.target != null ? tracks.find((x) => x.id === gg.target) : null;
        setText(c.tgt, dead ? 'AUSGEFALLEN' : gg.target != null ? `ZIEL ${pad3(gg.target)}${t ? '  ' + km(Math.hypot(t.pos.x - q.pos.x, t.pos.y - q.pos.y, t.pos.z - q.pos.z)) + ' km' : ''}` : 'KEIN ZIEL');
        const w = HOLD[gg.hold];
        setText(c.why, dead ? 'OUT OF ACTION' : w ? `${w[0]} / ${w[1]}` : gg.target != null ? (gg.laid ? 'GERICHTET / LAID' : 'RICHTEN / LAYING') : '');
        setCls(c.why, 'bad', !!w || dead);
        const f = c.feed;
        if (q.kind === 'flak43') {
          // the table fires from the right: the right clip empties first
          for (let k = 0; k < 16; k++) setCls(f.pips[15 - k], 'on', k < gg.table);
          const laying = gg.load > 0;
          f.bar.style.transform = `scaleX(${laying ? (1 - gg.load / 3.5).toFixed(2) : 0})`;
          setText(f.ltxt, dead ? '' : laying ? `RAHMEN ${dec(gg.load, 1)} s` : gg.table >= 16 ? 'TISCH VOLL' : gg.rounds <= 0 ? 'LEER' : 'BEREIT');
        } else {
          gg.barrels.forEach((b, k) => {
            const m = f.mags[k];
            for (let j = 0; j < 20; j++) setCls(m.pips[j], 'on', j < b.mag);
            setCls(m.el, 'chg', b.change > 0);
            setText(m.ch, b.change > 0 ? `WECHSEL ${dec(b.change, 1)}` : b.mag === 0 ? 'LEER' : '');
          });
        }
        c.shots.set(String(gg.shots % 10000));
        c.rounds.set(String(gg.rounds));
      }

      // the plot with the guns' reach, the list
      plot.setRange(memo.plotR);
      scale.set(memo.plotR);
      plot.update(dt, u, tracks, data, [[reachOf(SHELLS[G.shell]), 'REICHWEITE'], [G.range, 'FEUER']]);
      list.update(dt, u, tracks, data);
    },
    dispose() {
      if (spaceDown || trig.held) send('trigger', { down: false });
      VIEW.delete(u?.id);
    },
  };
}
