// Strela-10M3 console: no radar. The optical/IR sight is the instrument; slew by dragging or arrow keys,
// uncage the seeker, listen for the tone, fire on LOCK. The network picture gives an azimuth-only cue strip.
import { el, setText, setCls, plate, label, Lamp, Btn, Toggle, Seg, Readout, Bar, Rack, DEG, wrapPi, hw } from '../widgets.js';
import { SightView, sightFov, aimTo } from '../sightview.js';
import { tut } from '../highlight.js';
import { Header, SelBar, tracksFor, Slewer, reloadFrac, takeManual, MODE_ITEMS } from './common.js';

const CUES = 6;
const CUE_SPAN = 100 * DEG; // strip shows +-50 degrees around the sight

export function mountStrela(ctx) {
  const { send, memo } = ctx;
  const root = el('div', 'con strela');
  const hdr = new Header('СТРЕЛА-10М3', 'STRELA-10M3 9K35M3');
  let u = null;
  const slew = new Slewer();

  const ps = plate('ОПТИЧЕСКИЙ ВИЗИР 9Ш127', 'OPTICAL SIGHT 9Sh127', 'pl-sight');
  // the crew slews the sight itself in auto, so the player's hand takes it to manual first
  const sendSlew = (daz, del) => { takeManual(u, send); send('slew', { daz, del }); };
  const sight = new SightView({ canvas: ctx.sight, kind: 'strela', onSlew: sendSlew, cls: 'big' });
  ps.body.append(sight.el);
  tut(ps.el, 'sight');

  // azimuth cue strip: the commander's designation from the network picture
  const pc = plate('ЦЕЛЕУКАЗАНИЕ', 'TARGET DESIGNATION (AZIMUTH ONLY)', 'pl-cue');
  const strip = el('div', 'cuestrip');
  const centre = el('i', 'cuecentre');
  strip.append(centre);
  const ticks = [];
  for (let d = -50; d <= 50; d += 10) {
    const t = el('i', 'cuetick');
    t.style.left = `${50 + d}%`;
    strip.append(t);
    ticks.push(t);
  }
  const cues = [];
  for (let i = 0; i < CUES; i++) {
    const c = el('b', 'cue', '');
    c.hidden = true;
    strip.append(c);
    cues.push(c);
  }
  // the bearings the cues show (world, radians) and where they sit on the strip (%), for a click
  const cueAz = new Array(CUES).fill(null), cueX = new Array(CUES).fill(0);
  strip.addEventListener('pointerdown', (e) => {
    // click a designation: the turret lays the launcher, and the sight with it, on that bearing at its
    // own rate (a click on a cue takes the cue's bearing, elsewhere the bearing under the click)
    if (!u || !u.sight) return;
    const r = strip.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * 100;
    let az = (u.sight.az || 0) + (x / 100 - 0.5) * CUE_SPAN, bd = 4;
    for (let i = 0; i < CUES; i++) if (cueAz[i] != null && Math.abs(cueX[i] - x) < bd) { bd = Math.abs(cueX[i] - x); az = cueAz[i]; }
    takeManual(u, send);
    // `az` lays the launcher on the bearing (the sim slews the turret there); daz/del for older handlers
    send('slew', { az, daz: wrapPi(az - (u.sight.az || 0)), del: 0 });
  });
  pc.body.append(strip);
  tut(pc.el, 'cues');

  // controls
  const ctl = el('div', 'row ctlrow');
  const pk = plate('ГСН', 'SEEKER', 'pl-seek');
  const uncage = new Toggle({ ru: 'АРРЕТИР', en: 'UNCAGE SEEKER', color: 'amber', onChange: (on) => { takeManual(u, send); send('uncage', { on }); } });
  const tone = new Bar({ segs: 11, cls: 'tone', text: false });
  const lLock = new Lamp('ЗАХВАТ', 'LOCKED: FIRE', 'green', 'wide');
  const tr = el('div', 'col tight');
  tr.append(label('ТОН ГСН', 'SEEKER TONE', 'cap'), tone.el, lLock.el);
  const sr = el('div', 'rowc');
  sr.append(uncage.el, tr);
  pk.body.append(sr);
  tut(uncage.el, 'uncage');
  tut(tone.el, 'tone');
  tut(lLock.el, 'lock');

  const pf = plate('ПУСК', 'LAUNCH', 'pl-fire');
  const mode = new Seg({ cls: 'compact modeh', items: MODE_ITEMS, onChange: (v) => send('mode', { mode: v }) });
  const fire = new Btn({ ru: 'ПУСК', en: 'FIRE MISSILE', color: 'red', cls: 'huge', onClick: () => doFire() });
  const reload = new Btn({ ru: 'ПЕРЕЗАРЯДКА', en: 'RELOAD LAUNCHER', color: 'green', onClick: () => send('reload', {}) });
  const fr = el('div', 'rowc');
  fr.append(fire.el, reload.el);
  pf.body.append(fr, mode.el);
  tut(fire.el, 'fire');
  tut(reload.el, 'reload');
  tut(mode.el, 'mode');

  const pm = plate('РАКЕТЫ 9М37М', 'MISSILES', 'pl-weap');
  const rackL = new Rack(4, 'p4');
  const rackS = new Rack(4, 'p4 stow');
  const mr = el('div', 'rowc');
  const m1 = el('div', 'col tight');
  m1.append(label('НА ПУ', 'LAUNCHER', 'cap'), rackL.el);
  const m2 = el('div', 'col tight');
  m2.append(label('УКЛАДКА', 'STOWED', 'cap'), rackS.el);
  mr.append(m1, m2);
  const rl = new Bar({ segs: 14, cls: 'reload', text: false });
  const rlTxt = el('span', 'telst');
  const rlr = el('div', 'col tight');
  rlr.append(label('ПЕРЕЗАРЯДКА', 'RELOAD', 'cap'), rl.el, rlTxt);
  pm.body.append(mr, rlr);
  tut(m1, 'launcher-rack');
  tut(m2, 'stowed');

  ctl.append(pk.el, pf.el, pm.el);
  const selBar = new SelBar();
  const help = el('div', 'helpline', 'DRAG OR ARROWS: SLEW SIGHT   U: UNCAGE SEEKER   SPACE: FIRE WHEN LOCKED   A: MODE   L: RELOAD');
  tut(selBar.el, 'selbar');
  root.append(hdr.el, selBar.el, ps.el, pc.el, ctl, help);

  function doFire() { takeManual(u, send, true); send('fire', {}); }
  let lastLock = false;
  let lastTone = -1;

  return {
    el: root,
    key(e, down) {
      if (slew.key(e, down)) return true;
      if (!down) return false;
      switch (e.code) {
        case 'Space': doFire(); fire.press(true); setTimeout(() => fire.press(false), 120); return true;
        case 'KeyU': takeManual(u, send); send('uncage', { on: !(u.sight && u.sight.uncaged) }); return true;
        case 'KeyA': send('mode', { mode: ['auto', 'manual', 'hold'][(['auto', 'manual', 'hold'].indexOf(u.mode) + 1) % 3] }); return true;
        case 'KeyL': send('reload', {}); return true;
        default: return false;
      }
    },
    update(dt, unit, data) {
      u = unit;
      const st = u.sight || {};
      const picture = tracksFor(u, data);
      hdr.update(u, picture);
      mode.set(u.mode);
      const lt = st.targetId != null ? picture.find((x) => x.id === st.targetId) : null;
      selBar.update(u, lt || (u.selected != null ? picture.find((x) => x.id === u.selected) : null), data);
      slew.step(dt, sightFov(st), (n, a) => sendSlew(a.daz, a.del));
      sight.flush();
      sight.update(dt, u, picture, u.selected);
      const lock = (st.lock || 0) > 0.85;
      const tn = st.uncaged ? st.tone || 0 : 0;
      uncage.set(st.uncaged);
      tone.set(tn);
      lLock.set(lock ? 2 : 0);
      if (lock && !lastLock) { try { hw.audio && hw.audio.ui && hw.audio.ui('lock'); } catch (e) { /* optional */ } }
      lastLock = lock;
      if (hw.audio && hw.audio.seeker && (tn !== lastTone || lock)) { try { hw.audio.seeker(tn, lock); } catch (e) { /* optional */ } }
      lastTone = tn;
      const m = (u.weapons && u.weapons.missiles) || { ready: 0, reserve: 0, reload: 0 };
      const onL = Math.min(4, m.ready);
      rackL.set(onL, m.reload > 0 && onL < 4);
      rackS.set(Math.max(0, Math.min(4, (m.reserve == null ? 0 : m.reserve))));
      rl.set(reloadFrac(memo, 's', m.reload));
      setText(rlTxt, m.reload > 0 ? `${Math.ceil(m.reload)} с` : onL === 0 ? 'ПУСТО' : 'ГОТОВО');
      fire.enable(onL > 0);
      fire.set(lock);
      reload.set(m.reload > 0);
      // cue strip: nearest threats by range from the unit, azimuth only
      const near = picture.slice().sort((a, b) => dist2(u, a) - dist2(u, b)).slice(0, CUES);
      for (let i = 0; i < CUES; i++) {
        const c = cues[i];
        const t = near[i];
        if (!t) { cueAz[i] = null; if (!c.hidden) c.hidden = true; continue; }
        const a = aimTo(u, t.pos).az;
        const d = wrapPi(a - (st.az || 0));
        const f = d / CUE_SPAN;
        const out = Math.abs(f) > 0.5;
        if (c.hidden) c.hidden = false;
        const x = out ? (f > 0 ? 98 : 2) : 50 + f * 100;
        cueAz[i] = out ? null : a;
        cueX[i] = x;
        const lbl = out ? (f > 0 ? '▶' : '◀') : '▼';
        c.style.left = `${x.toFixed(2)}%`;
        setText(c, lbl);
        setCls(c, 'sel', t.id === u.selected);
        setCls(c, 'near', i === 0);
        setCls(c, 'hot', t.cls === 'helo' || t.cls === 'arm');
      }
    },
    dispose() {
      slew.clear();
      try { hw.audio && hw.audio.seeker && hw.audio.seeker(0, false); } catch (e) { /* optional */ }
    },
  };
}

function dist2(u, t) {
  if (!t.pos || !u.pos) return 1e18;
  return (t.pos.x - u.pos.x) ** 2 + (t.pos.z - u.pos.z) ** 2;
}
