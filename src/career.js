import { stored, store } from './choices.js';
import { DIFFICULTY } from './sim/systems.js';

// The career (DESIGN.md "Career", docs/PLAYING.md): one per era, as War Thunder's nations. Plain data and
// local storage, Node-safe (no DOM, no three.js): the menu, the game page and tools/careertest.mjs share it.
//
// An era's `career` (eras/<era>.js) holds its research tree, in columns by type, and its threat levels. A new
// career owns the era's `start` units; the research points (RP) every career battle pays go to the unit being
// researched (`target`), and when it is done the rest goes on to the next one in its column, else the
// cheapest one open. A unit is open for research when the one before it in its column (`after`) is owned.
// Owned units fill the era's sites (`lineup`, one entry per slot: a kind, EMPTY for a site left empty, or
// null for "the best I own there", the highest rank among the owned units the slot offers). Every threat
// level is open from the start.
//
// Kept in local storage: `echelon.career.<era>` (this module's state, version 1) and `echelon.career.dev`
// (dev mode: every unit owned for the lineup and every level open; the career itself goes on underneath).

export const EMPTY = 'none'; // as deploy.js's (deploy.js imports the eras, which a menu need not)
const KEY = (era) => `echelon.career.${era.id}`;
const DEV_KEY = 'echelon.career.dev';
const VERSION = 1;
// RP for a level won, times its pay
export const WIN_RP = 300;

export const devMode = () => stored(DEV_KEY) === '1';
export const setDevMode = (on) => store(DEV_KEY, on ? '1' : '0');

// ---------------------------------------------------------------- the tree
export const treeOf = (era) => era.career?.tree ?? [];
export const nodeOf = (era, kind) => treeOf(era).find((n) => n.kind === kind) ?? null;
// the units of a column, in research order (each after the one before it)
export function columnOf(era, column) {
  const nodes = treeOf(era).filter((n) => n.column === column);
  const out = [];
  let prev = null;
  for (let n; (n = nodes.find((x) => x.after === prev && !out.includes(x))); prev = n.kind) out.push(n);
  return out.concat(nodes.filter((x) => !out.includes(x)));
}
// the unit after this one in its column, or null
export const nextInColumn = (era, kind) => treeOf(era).find((n) => n.after === kind) ?? null;
// a unit's name, short name and trade-off from the era's slot options
export function unitInfo(era, kind) {
  const o = era.slots.flatMap((s) => s.options).find((x) => x.kind === kind);
  return { name: o?.name?.replace(/\s*\(.*\)$/, '') ?? kind, label: o?.label ?? o?.name ?? kind, info: o?.info ?? '' };
}
export const RANKS = ['I', 'II', 'III', 'IV', 'V'];
export const rankName = (n) => RANKS[(n ?? 1) - 1] ?? String(n);

// ---------------------------------------------------------------- the state
function fresh(era) {
  const c = { v: VERSION, owned: [...(era.career?.start ?? [])], progress: {}, target: null, lineup: era.slots.map(() => null), unlocked: 1, level: 1, battles: 0, earned: 0 };
  c.target = nextTarget(era, c);
  return c;
}
// the career kept for `era`, or a new one (a kept one from another version starts over)
export function loadCareer(era) {
  let c = null;
  try {
    c = JSON.parse(stored(KEY(era)) || 'null');
  } catch {
    c = null;
  }
  if (!c || c.v !== VERSION) return fresh(era);
  const kinds = new Set(treeOf(era).map((n) => n.kind));
  c.owned = [...new Set([...(era.career?.start ?? []), ...(c.owned ?? []).filter((k) => kinds.has(k))])];
  c.progress = c.progress && typeof c.progress === 'object' ? c.progress : {};
  c.lineup = era.slots.map((_, i) => c.lineup?.[i] ?? null);
  c.unlocked = clampLevel(era, c.unlocked);
  c.level = clampLevel(era, c.level);
  c.battles = c.battles | 0;
  c.earned = c.earned | 0;
  if (!researchable(era, c, c.target)) c.target = nextTarget(era, c);
  return c;
}
export const saveCareer = (era, c) => store(KEY(era), JSON.stringify(c));
export const resetCareer = (era) => {
  const c = fresh(era);
  saveCareer(era, c);
  return c;
};

export const owns = (era, c, kind, dev = false) => (dev && !!nodeOf(era, kind)) || c.owned.includes(kind);
// open for research: not owned, and the one before it in its column owned
export const researchable = (era, c, kind) => {
  const n = nodeOf(era, kind);
  return !!n && !c.owned.includes(kind) && (!n.after || c.owned.includes(n.after));
};
export const openNodes = (era, c) => treeOf(era).filter((n) => researchable(era, c, n.kind));
// the next unit to research: after `done` in its column if open, else the open one with the least to go
function nextTarget(era, c, done = null) {
  const next = done && nextInColumn(era, done);
  if (next && researchable(era, c, next.kind)) return next.kind;
  const open = openNodes(era, c).sort((a, b) => a.cost - (c.progress[a.kind] ?? 0) - (b.cost - (c.progress[b.kind] ?? 0)));
  return open[0]?.kind ?? null;
}
// how much of the era's tree the career has researched, 0 to 1: the RP of the units owned and the RP put into
// the others, of the RP of the whole tree (the menu's Research tab)
export function researchedShare(era, c) {
  const nodes = treeOf(era), total = nodes.reduce((s, n) => s + n.cost, 0);
  if (!total) return 1;
  const done = nodes.reduce((s, n) => s + (c.owned.includes(n.kind) ? n.cost : Math.min(n.cost, c.progress[n.kind] ?? 0)), 0);
  return done / total;
}
// a unit's research done, 0 to 1 (1 when owned)
export const researchShareOf = (era, c, kind) => {
  const n = nodeOf(era, kind);
  return !n ? 0 : c.owned.includes(kind) || !n.cost ? 1 : Math.min(1, (c.progress[kind] ?? 0) / n.cost);
};
export function setTarget(era, c, kind) {
  if (!researchable(era, c, kind)) return false;
  c.target = kind;
  return true;
}
// Adds `rp` to the research: the target first, the rest on to the next. Returns the kinds researched.
export function earn(era, c, rp) {
  const done = [];
  let left = Math.max(0, Math.round(rp));
  c.earned += left;
  while (left > 0 && c.target) {
    const n = nodeOf(era, c.target);
    const have = c.progress[n.kind] ?? 0;
    const put = Math.min(left, n.cost - have);
    c.progress[n.kind] = have + put;
    left -= put;
    if (c.progress[n.kind] >= n.cost) {
      c.owned.push(n.kind);
      delete c.progress[n.kind];
      done.push(n.kind);
      c.target = nextTarget(era, c, n.kind);
    }
  }
  return done;
}

// ---------------------------------------------------------------- the lineup
// the kinds a slot can take in this career (owned ones it offers), highest rank first
export function slotChoices(era, c, slot, dev = false) {
  return era.slots[slot].options.map((o) => o.kind).filter((k) => owns(era, c, k, dev))
    .sort((a, b) => (nodeOf(era, b)?.rank ?? 0) - (nodeOf(era, a)?.rank ?? 0));
}
// the lineup the battle fields: one kind or EMPTY per slot
export function lineupOf(era, c, dev = false) {
  return era.slots.map((s, i) => {
    const want = c.lineup[i];
    if (want === EMPTY) return EMPTY;
    const choices = slotChoices(era, c, i, dev);
    return want && choices.includes(want) ? want : choices[0] ?? EMPTY;
  });
}
// sets a slot: a kind it offers and the career owns, EMPTY, or null (the best owned)
export function setSlot(era, c, slot, kind, dev = false) {
  if (kind !== null && kind !== EMPTY && !slotChoices(era, c, slot, dev).includes(kind)) return false;
  c.lineup[slot] = kind;
  return true;
}
export const hasUnits = (lineup) => lineup.some((k) => k !== EMPTY);

// ---------------------------------------------------------------- threat levels
export const levelsOf = (era) => era.career?.levels ?? [];
const clampLevel = (era, n) => Math.max(1, Math.min(levelsOf(era).length || 1, Number(n) | 0 || 1));
export const levelOf = (era, n) => levelsOf(era)[clampLevel(era, n) - 1] ?? null;
// every level is open from the start (`unlocked` only records the highest reached)
export const levelOpen = (era, c, n) => n >= 1 && n <= levelsOf(era).length;
export const modifierOf = (era, id) => era.career?.modifiers?.find((m) => m.id === id) ?? null;
// a level's modifiers for a battle (none below its count), distinct, in the era's order
export function rollModifiers(era, n, seed) {
  const k = levelOf(era, n)?.mods ?? 0;
  const all = (era.career?.modifiers ?? []).map((m) => m.id);
  let s = seed >>> 0 || 1;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const pool = [...all], out = [];
  while (out.length < k && pool.length) out.push(pool.splice(Math.floor(rnd() * pool.length), 1)[0]);
  return all.filter((id) => out.includes(id));
}
// the modifier ids a URL names (?mods=), known ones only
export const parseModifiers = (era, s) => (s ?? '').split(',').filter((id) => modifierOf(era, id));

// What the sim needs for a level (sim.newGame({ level })): its raids (the level's waves of the era, with the
// modifiers' groups and flanks applied), its difficulty (the base row with the level's raid sizes), the
// visibility and the pay. Plain data; the era's waves are not changed.
export function levelSetup(era, n, modIds = []) {
  const lv = levelOf(era, n);
  const mods = modIds.map((id) => modifierOf(era, id)).filter(Boolean);
  const count = mods.reduce((k, m) => k * (m.count ?? 1), 1);
  const flank = mods.find((m) => m.flank)?.flank ?? 0;
  const raids = lv.waves.map((i, w) => {
    const wave = era.waves[i];
    const groups = wave.groups.map((g, j) => ({ ...g, bearing: g.bearing + (flank && j % 2 ? flank : 0) }));
    if (w > 0) for (const m of mods) if (m.add) groups.push({ ...m.add });
    return { ...wave, groups };
  });
  const base = DIFFICULTY[lv.base] ?? DIFFICULTY.Normal;
  return {
    n: lv.n, name: lv.name, pay: lv.pay, mods: mods.map((m) => m.id), raids,
    difficulty: { ...base, enemy: lv.enemy * count, air: lv.air * count },
    visibility: mods.reduce((v, m) => Math.min(v, m.visibility ?? 1), 1),
    weather: mods.find((m) => m.weather)?.weather ?? null,
  };
}
// A level played to its end, won or lost: the next opens, the victory pays its bonus. Returns the kinds
// researched with the bonus.
export function finishLevel(era, c, n, won) {
  c.battles++;
  if (n >= c.unlocked) c.unlocked = clampLevel(era, n + 1);
  return won ? earn(era, c, WIN_RP * (levelOf(era, n)?.pay ?? 1)) : [];
}
