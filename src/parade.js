import { SYSTEMS, MISSILES, PART_ROLE } from './sim/systems.js';

// The parade (the menu's hangar, ui/hangar.js) as plain data, Node-safe (no DOM, no three.js): which vehicles of a
// unit stand in the line and in what order, how many men stand in front of each, and what the unit shows on its
// display row (its missiles and their containers, its rounds). Everything has a fallback from the game tables
// (SYSTEMS, MISSILES, PART_ROLE), so a unit added to an era's slots gets a parade without a line here; the tables
// below only correct what the fallback would get wrong. The menu's cards read the same data (ui/menu.js).

// Men in front of a vehicle or gun on parade (a game figure, not an establishment): the WW2 guns' are the crew
// spots of their models (eras/ww2/models/jobs44.js, which the hangar uses when it has them); anything not
// listed gets DEFAULT_CREW.
export const CREW = {
  's400-tel': 3, 's400-radar': 4, 's400-search': 3, 's400-cp': 5,
  'buk-telar': 4, 'buk-loader': 3, 'buk-radar': 4, 'buk-cp': 5,
  pantsir: 3, tunguska: 4, osa: 5, tor: 4, strela: 3, shilka: 4, gepard: 3,
  flak88: 9, kdo40: 6, wurzburg: 5, wurzburgriese: 4, flak43: 6, flakvierling: 8, 'flakvierling-tower': 8, flak38: 6, flak128: 7,
};
export const DEFAULT_CREW = 3;
export const crewOf = (vehicle) => CREW[vehicle] ?? DEFAULT_CREW;

// The order of the line, the head first (nearest the reviewing camera): the launchers and the guns, then the
// loader-launchers and the close-defence guns, then the radars, the predictors and the command posts. A part
// whose role is 'tower' (the flak tower's concrete) does not stand in the line: the hangar puts it behind.
const ORDER = { launcher: 0, telar: 0, gun: 0, main: 0, loader: 1, close: 2, radar: 3, search: 3, predictor: 3, cp: 4 };
export const roleOf = (unitKind, vehicle) => SYSTEMS[unitKind]?.roles?.[vehicle] ?? PART_ROLE[vehicle] ?? 'main';
// an option's parts in the order of the line ({ kind, letter?, ... } each), and the structures behind it
export function paradeLine(unitKind, parts) {
  const all = parts.map((p, i) => ({ ...p, role: roleOf(unitKind, p.kind), i }));
  const line = all.filter((p) => p.role !== 'tower').sort((a, b) => (ORDER[a.role] ?? 2) - (ORDER[b.role] ?? 2) || a.i - b.i);
  return { line, behind: all.filter((p) => p.role === 'tower') };
}
export const paradeCrew = (unitKind, parts) => paradeLine(unitKind, parts).line.reduce((n, p) => n + crewOf(p.kind), 0);

// How a missile is kept: 'tube' (a round canister: the S-400's, the Pantsir's and the Tunguska's tubes), 'box'
// (a square container: the Osa's, the Strela's, the Tor's cells) or null (none: the Buk's rounds ride bare on
// the launcher's rails, shown on a transport cradle). Not listed: a tube.
export const CONTAINER = { '9M33': 'box', '9M37': 'box', '9M338': 'box', '9M317': null };
export const containerOf = (missile) => (missile in CONTAINER ? CONTAINER[missile] : 'tube');

// a shell kind's name on its placard (ballistics.js SHELLS kinds 'NNmm'): the German guns' in centimetres
const SHELL_NAME = { '20mm': '2 cm', '37mm': '3.7 cm', '88mm': '8.8 cm', '128mm': '12.8 cm' };
export const shellName = (shell) => SHELL_NAME[shell] ?? shell.replace(/mm$/, ' mm');
export const calibreOf = (shell) => parseFloat(shell) / 1000 || 0.03;

// The display row in front of a unit's ranks, an entry each: { missile } for every missile type it fires (with
// its container), { shell, feed, guns } for its guns' rounds ('belt': linked rounds and their boxes, the modern
// guns; 'mag', 'clip', 'hand': the WW2 guns' magazines, clips and fixed rounds, from SYSTEMS guns[].feed).
// DISPLAY[kind] replaces the fallback for a unit that needs another display.
export const DISPLAY = {};
export function displayOf(unitKind) {
  if (DISPLAY[unitKind]) return DISPLAY[unitKind];
  const s = SYSTEMS[unitKind] ?? {};
  const out = Object.keys(s.stocks ?? {}).filter((m) => MISSILES[m]).map((missile) => ({ missile }));
  if (s.gun) out.push({ shell: s.gun.shell, feed: 'belt', guns: [unitKind] });
  for (const [gun, g] of Object.entries(s.guns ?? {})) {
    const have = out.find((e) => e.shell === g.shell);
    if (have) {
      have.guns.push(gun);
      continue;
    }
    out.push({ shell: g.shell, feed: g.feed?.mag ? 'mag' : g.feed?.clip ? 'clip' : g.feed?.hand ? 'hand' : 'belt', guns: [gun] });
  }
  return out;
}
