// The flak tower's console (`flakturm`): one unit with three kinds of gun (sim/mounts.js `groups`), so the
// console is the battery's and the platoons' pages under a gun selector (GESCHÜTZWAHL): the player takes
// command of one group at a time (`group { kind }`), and that page shows:
//   12,8 cm   the heavy battery's page (battery.js) for the four Flakzwilling 40 under the Kommandogeraet:
//             the predictor's telescope and data, salvos and barrage, the Wuerzburg, the four guns' reports
//   3,7 cm    a platoon leader's page (platoon.js) for the two Flak 43 on the roof
//   2 cm      a platoon leader's page for the four Flakvierlinge on the galleries
// The groups not under command fight on with their crews (as in FEUER FREI) in every mode but HALT; the
// mode, the selection and the trigger are the group's under command. Each page keeps its own memo (zoom,
// gun picked, plot scale); the sight canvas moves to the page shown. Keys: W the next group (and each
// page's own keys).
import { el, label, Seg, snd } from '../../../ui/widgets.js';
import { tut } from '../../../ui/highlight.js';
import { mountBattery } from './battery.js';
import { mountPlatoon } from './platoon.js';

const MORE = '   W: GUNS';
export const TURM_GROUPS = [
  { kind: 'flak128', de: '12,8 CM', en: 'HEAVY TWINS', mount: (ctx) => mountBattery(ctx, { title: ['12,8 CM FLAKZWILLING 40', 'FLAK TOWER: HEAVY GUNS'], heavyOnly: true, cal: '12,8 cm', keys: MORE }) },
  { kind: 'flak43', de: '3,7 CM', en: 'ROOF GUNS', mount: (ctx) => mountPlatoon(ctx, 'flak43', { keep: (p) => p.kind === 'flak43', guns: ['1', '2'], title: ['3,7 CM FLAK 43', 'FLAK TOWER: ROOF GUNS'], keys: MORE }) },
  { kind: 'flakvierling', de: '2 CM VIERLING', en: 'GALLERY GUNS', mount: (ctx) => mountPlatoon(ctx, 'flakvierling', { keep: (p) => p.kind === 'flakvierling', guns: ['N', 'O', 'S', 'W'], title: ['2 CM FLAKVIERLING 38', 'FLAK TOWER: GALLERY GUNS'], keys: MORE }) },
];

export function mountTurm(ctx) {
  const { send, memo } = ctx;
  const root = el('div', 'con c44 turm44');
  memo.pages ??= {};
  // the gun selector
  const bar = el('div', 'turmbar44');
  const seg = new Seg({ cls: 'turmsel44', items: TURM_GROUPS.map((g) => ({ v: g.kind, ru: g.de, en: g.en })), onChange: (v) => pick(v) });
  bar.append(label('GESCHÜTZWAHL', 'GUNS UNDER YOUR COMMAND', 'cap'), seg.el);
  tut(bar, 'groups');
  root.append(bar);
  const pages = new Map();
  for (const g of TURM_GROUPS) {
    const m = (memo.pages[g.kind] ??= {});
    const con = g.mount({ ...ctx, memo: m });
    con.el.style.display = 'none';
    root.append(con.el);
    pages.set(g.kind, con);
  }
  let u = null, shown = null;

  function pick(kind) {
    if (!u || u.group === kind) return;
    // a held trigger stays with the page it was pressed on
    pages.get(shown)?.key({ code: 'Space' }, false);
    send('group', { kind });
  }
  function show(kind) {
    if (kind === shown) return;
    if (shown) pages.get(shown).el.style.display = 'none';
    shown = kind;
    const con = pages.get(kind);
    con.el.style.display = '';
    // the one sight canvas goes to this page's sight
    con.el.querySelector('.sight44')?.prepend(ctx.sight);
    seg.set(kind);
  }

  return {
    el: root,
    key(e, down) {
      if (e.code === 'KeyW') {
        if (down && u) {
          const i = TURM_GROUPS.findIndex((g) => g.kind === u.group);
          pick(TURM_GROUPS[(i + 1) % TURM_GROUPS.length].kind);
          snd('switch');
        }
        return true;
      }
      return pages.get(shown)?.key(e, down) ?? false;
    },
    update(dt, unit, data) {
      u = unit;
      show(u.group ?? TURM_GROUPS[0].kind);
      pages.get(shown).update(dt, unit, data);
    },
    dispose() {
      for (const p of pages.values()) p.dispose?.();
    },
  };
}
