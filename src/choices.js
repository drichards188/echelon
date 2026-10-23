import { ERAS, eraById, playableEra } from './eras/index.js';

// The player's choices, kept between the main menu (ui/menu.js) and a game page (main.js), and the URLs
// that lead from one to the other. Plain data and local storage, no three.js: the menu imports it.
// Kept in local storage: the era (`echelon.era`), the loadout of each era (`echelon.loadout.<era>`: one
// option per slot of its `slots`) and the difficulty (`echelon.difficulty`). Before there were eras the
// loadout was kept under `echelon.loadout`: it was the modern era's and moves to its key.
export const ERA_KEY = 'echelon.era';
const LOADOUT_KEY = 'echelon.loadout';
const DIFFICULTY_KEY = 'echelon.difficulty';
// the lessons done (tutorial.js keeps it, the menu marks them)
export const LESSONS_KEY = 'echelon.tutorials';
export const DIFFICULTIES = ['Easy', 'Normal', 'Hard'];
export const loadoutKey = (era) => `${LOADOUT_KEY}.${era}`;

export const stored = (key) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null; // private mode
  }
};
export const store = (key, value) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    // private mode: the choice lasts until the page is left
  }
};
export const migrateLoadout = () => {
  try {
    const old = localStorage.getItem(LOADOUT_KEY);
    if (old === null) return;
    if (localStorage.getItem(loadoutKey('modern')) === null) localStorage.setItem(loadoutKey('modern'), old);
    localStorage.removeItem(LOADOUT_KEY);
  } catch {
    // private mode: nothing was kept
  }
};

// Development override: with ?dev=1 an era still in development (`available: false`) can be played, from
// ?era=<id> or __iads.setEra(id); the menu still shows it greyed out and it is never kept in storage.
export const isDev = (q) => q.get('dev') === '1';
export const canPlay = (era, q) => !!era && (era.available || isDev(q));
// The era a page starts in: a lesson's own (`?tutorial=`), else `?era=` (not kept), else the one kept,
// else the default; one still in development falls back to the default (unless ?dev=1).
export const startEra = (q) => {
  const asked = eraById(q.get('era'));
  const lesson = q.get('tutorial') && !asked?.tutorials.includes(q.get('tutorial')) ? ERAS.find((e) => e.tutorials.includes(q.get('tutorial'))) : null;
  if (lesson && canPlay(lesson, q)) return lesson.id;
  return isDev(q) && asked ? asked.id : playableEra(q.get('era') ?? stored(ERA_KEY));
};

// one offered kind per slot of `era`, the slot's default for anything else
export const validLoadout = (era, kinds) => era.slotOptions.map((opts, i) => (opts.some((o) => o.kind === kinds?.[i]) ? kinds[i] : opts[0].kind));
// The loadout kept for `era`; `q` (the ?loadout= parameter: kinds in slot order, or 'alt' for every
// alternative) overrides it without being kept.
export const keptLoadout = (era, q = null) => {
  if (q) return validLoadout(era, q === 'alt' ? era.slotOptions.map((o) => o[1]?.kind) : q.split(','));
  try {
    return validLoadout(era, JSON.parse(stored(loadoutKey(era.id)) || 'null'));
  } catch {
    return [...era.defaultLoadout];
  }
};
export const keepLoadout = (era, kinds) => store(loadoutKey(era.id), JSON.stringify(kinds));
// the difficulty: `?difficulty=`, else the one the menu kept, else Normal
export const keptDifficulty = (q = null) => [q?.get('difficulty'), stored(DIFFICULTY_KEY)].find((d) => DIFFICULTIES.includes(d)) ?? 'Normal';
export const keepDifficulty = (d) => store(DIFFICULTY_KEY, d);

// ---------------------------------------------------------------- pages
// `/` is the main menu; a URL with `play` (a battle) or `tutorial` (a lesson) is a game page (src/boot.js).
export const isGame = (q) => !!(q.get('play') || q.get('tutorial'));
// the settings a URL hands on, menu to game and back (in the game the gear menu sets them); both are
// this same page, wherever it is served
const PASS = ['quality', 'dev'];
const href = (p, from) => {
  for (const k of PASS) if (from?.get(k)) p.set(k, from.get(k));
  const s = p.toString();
  return s ? `${location.pathname}?${s}` : location.pathname;
};
// A game page: a battle in `era` at `difficulty`, or the lesson `tutorial`. The loadout is the one kept.
export const gameHref = ({ era, difficulty, tutorial = null }, from) =>
  href(new URLSearchParams(tutorial ? { tutorial, era } : { play: '1', era, difficulty }), from);
// back to the menu from a game: its era, and the tutorial list open when `lessons`
export const menuHref = (q, { era = null, lessons = false } = {}) => {
  const p = new URLSearchParams();
  if (era) p.set('era', era);
  if (lessons) p.set('lessons', '1');
  return href(p, q);
};
// the slot option (kind, name, callsign) a lesson's unit id names in `era`
export const optionById = (era, id) => era.slots.flatMap((s) => s.options).find((o) => o.id === id) ?? null;
