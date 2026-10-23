// Where everything sits, in the era in play (src/eras). Shared by terrain (flattened pads), sim (unit and
// asset positions) and the render layer, so it holds plain data only.
//
// World frame: metres, y up, origin at the middle of the defended site (the modern era's: its airbase
// runway). North is -Z, east is +X.
// A bearing (degrees clockwise from north) at range r is x = r * sin(b), z = -r * cos(b).
// Vehicle and model space: front -Z, right +X, ground contact y = 0; headings are three's
// rotation.y (0 = facing north, + = turning left/west).

import { ERAS, DEFAULT_ERA, eraById } from './eras/index.js';

export const DEG = Math.PI / 180;

export function fromBearing(bearingDeg, range, out = { x: 0, z: 0 }) {
  out.x = range * Math.sin(bearingDeg * DEG);
  out.z = -range * Math.cos(bearingDeg * DEG);
  return out;
}

export function bearingOf(dx, dz) {
  return ((Math.atan2(dx, -dz) / DEG) + 360) % 360;
}

// rotation.y that makes a model (front -Z) face a bearing
export const headingFor = (bearingDeg) => -bearingDeg * DEG;

// The era in play (src/eras): its map, its slots and its raids. Everything below follows it and changes
// with setEra: ERA, THREAT_AXIS, ASSETS, SLOT_OPTIONS, DEFAULT_LOADOUT and WAVES are live bindings (read
// them when needed, never keep anything derived from them at import time), UNITS and LOADOUT change in
// place.
export let ERA = eraById(DEFAULT_ERA);
// the compass bearing the raids come from (later waves widen the arc)
export let THREAT_AXIS = ERA.layout.threatAxis;
// The defended assets. `hp` is gameplay hit points; losing all of ERA.layout.vital ends the battle.
export let ASSETS = ERA.layout.assets;
// The fire units, one per slot, in the order the number keys select them. Each slot has a site (where
// it stands) and the options the player can pick on the main menu, all of the same class (the era's
// `slots`). `parts` are the vehicles of a unit in the unit's own frame (metres; -dz is toward `bearing`),
// the first part carries the third-person camera.
let SITES = ERA.layout.sites;
export let SLOT_OPTIONS = ERA.slotOptions;
// the raids (sim/director.js)
export let WAVES = ERA.waves;

// the kind picked for each slot; the first option of every slot
export let DEFAULT_LOADOUT = ERA.defaultLoadout;

/**
 * Unit definitions for a loadout (one kind per slot; a missing, null or empty entry takes the slot's
 * default).
 * Throws on a kind the slot does not offer. Returns fresh objects: { id, kind, name, callsign, slot,
 * x, z, bearing, parts: [{ kind, dx, dz }] }.
 */
export function buildUnits(loadout = DEFAULT_LOADOUT) {
  return SLOT_OPTIONS.map((opts, slot) => {
    const kind = loadout[slot] || opts[0].kind;
    const o = opts.find((x) => x.kind === kind);
    if (!o) throw new Error(`slot ${slot} has no option '${kind}' (${opts.map((x) => x.kind).join(', ')})`);
    return { ...o, slot, ...SITES[slot], parts: o.parts.map((p) => ({ ...p })) };
  });
}

// The units in play and their kinds. Both arrays are changed in place by setLoadout, so modules that
// import them see the new loadout; they must not keep anything derived from them at import time.
export const UNITS = buildUnits();
export const LOADOUT = [...DEFAULT_LOADOUT];

/** Picks the units for the next game (before sim.newGame, or pass `loadout` to newGame). Returns UNITS. */
export function setLoadout(loadout = DEFAULT_LOADOUT) {
  const next = buildUnits(loadout);
  UNITS.length = 0;
  UNITS.push(...next);
  LOADOUT.length = 0;
  LOADOUT.push(...next.map((u) => u.kind));
  return UNITS;
}

/**
 * Picks the era for the next game (before sim.newGame, or pass `era` to newGame) and with it the layout,
 * the slots and the raids; a new era starts on its default loadout, the same era keeps the loadout.
 * Throws on an unknown id; any registered era is accepted (the menu offers only the available ones,
 * eras/index.js playableEra). Returns ERA.
 */
export function setEra(id) {
  const era = eraById(id);
  if (!era) throw new Error(`no era '${id}' (${ERAS.map((e) => e.id).join(', ')})`);
  if (era === ERA) return ERA;
  ERA = era;
  THREAT_AXIS = era.layout.threatAxis;
  ASSETS = era.layout.assets;
  SITES = era.layout.sites;
  SLOT_OPTIONS = era.slotOptions;
  DEFAULT_LOADOUT = era.defaultLoadout;
  WAVES = era.waves;
  setLoadout(DEFAULT_LOADOUT);
  return ERA;
}

// World position and heading of every part of a unit.
export function partPlacements(unit) {
  const h = headingFor(unit.bearing);
  const c = Math.cos(h), s = Math.sin(h);
  return unit.parts.map((p) => ({
    ...p,
    // rotate the local offset by the heading (three's rotation.y convention)
    x: unit.x + p.dx * c + p.dz * s,
    z: unit.z - p.dx * s + p.dz * c,
    heading: h,
    // the structure a part on a deck stands on (`base`, its offset; default the unit's site): where its deck
    // is measured from
    ...(p.deck != null ? { bx: unit.x + (p.base?.[0] ?? 0) * c + (p.base?.[1] ?? 0) * s, bz: unit.z - (p.base?.[0] ?? 0) * s + (p.base?.[1] ?? 0) * c } : {}),
  }));
}

// Pads the terrain flattens for the era in play: each vehicle gets a level spot and the runway a strip.
// The terrain keeps them until the era changes (terrainHeight.js), so they cover every option of every
// slot (the default loadout's first, any spot another option shares is not repeated) and whatever the
// menu picks stands on level ground.
export function flatPads() {
  const pads = [];
  const defs = buildUnits();
  SLOT_OPTIONS.forEach((opts, slot) => opts.slice(1).forEach((o) => defs.push({ ...o, ...SITES[slot] })));
  for (const u of defs) for (const p of partPlacements(u)) {
    // a part on a structure's deck needs no ground of its own; a structure says how much it needs (`pad`)
    if (p.deck != null || pads.some((q) => Math.abs(q.x - p.x) < 1 && Math.abs(q.z - p.z) < 1)) continue;
    pads.push({ x: p.x, z: p.z, rx: p.pad?.[0] ?? 22, rz: p.pad?.[1] ?? 22, heading: p.heading, blend: 40 });
  }
  for (const a of ASSETS) {
    if (a.kind === 'runway') pads.push({ x: a.x, z: a.z, rx: a.width / 2 + 60, rz: a.length / 2 + 150, heading: headingFor(a.bearing), blend: 250 });
    else pads.push({ x: a.x, z: a.z, rx: 45, rz: 45, heading: headingFor(a.bearing), blend: 80 });
  }
  return pads;
}
