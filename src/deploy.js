// Where everything sits. Shared by terrain (flattened pads), sim (unit and asset positions) and
// the render layer, so it holds plain numbers only.
//
// World frame: metres, y up, origin at the middle of the airbase runway. North is -Z, east is +X.
// A bearing (degrees clockwise from north) at range r is x = r * sin(b), z = -r * cos(b).
// Vehicle and model space: front -Z, right +X, ground contact y = 0; headings are three's
// rotation.y (0 = facing north, + = turning left/west).

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

// The attacks come mostly out of the west-south-west; later waves widen the arc.
export const THREAT_AXIS = 250;

// The defended airbase. `hp` is gameplay hit points; losing the runway and the command post ends the battle.
export const ASSETS = [
  { id: 'runway', kind: 'runway', name: 'Runway 07/25', x: 0, z: 0, bearing: 70, length: 2800, width: 45, hp: 400 },
  { id: 'cp', kind: 'command', name: 'Air defense command post', x: -350, z: 650, bearing: 70, hp: 250 },
  { id: 'has1', kind: 'shelter', name: 'Shelter 1', x: -700, z: 420, bearing: 160, hp: 150 },
  { id: 'has2', kind: 'shelter', name: 'Shelter 2', x: -520, z: 480, bearing: 160, hp: 150 },
  { id: 'has3', kind: 'shelter', name: 'Shelter 3', x: 520, z: 260, bearing: 160, hp: 150 },
  { id: 'has4', kind: 'shelter', name: 'Shelter 4', x: 700, z: 200, bearing: 160, hp: 150 },
  { id: 'fuel', kind: 'fuel', name: 'Fuel farm', x: 900, z: 650, bearing: 70, hp: 120 },
  { id: 'tower', kind: 'tower', name: 'Control tower', x: 150, z: 380, bearing: 70, hp: 80 },
];

// The fire units, one per slot, in the order the number keys select them. Each slot has a site (where
// it stands) and the options the player can pick on the main menu, all of the same class: the area
// layer, two gun-missile point defense units, a short-range missile system and a very short range one.
// `parts` are the vehicles of a unit in the unit's own frame (metres; -dz is toward `bearing`), the
// first part carries the third-person camera. Everything faces the threat axis unless it says otherwise.
// Unit ids belong to the option, not the slot: the default loadout keeps 'S400', 'P1', 'P2', 'OSA' and
// 'STR'; the alternatives are 'BUK', 'T1' / 'T2' (a Tunguska in slot 1 or 2), 'TOR' and 'SHK'.
const SITES = [
  { x: 7000, z: 2600, bearing: THREAT_AXIS },
  { x: 6300, z: 2050, bearing: THREAT_AXIS },
  { x: -2300, z: -700, bearing: THREAT_AXIS },
  { x: -1500, z: 2300, bearing: 230 },
  { x: 950, z: -750, bearing: 270 },
];
const one = (kind) => [{ kind, dx: 0, dz: 0 }];

export const SLOT_OPTIONS = [
  [
    {
      kind: 's400', id: 'S400', name: 'S-400 Triumf', callsign: 'Granit',
      parts: [
        { kind: 's400-tel', dx: 0, dz: 0 },
        { kind: 's400-tel', dx: -180, dz: 60 },
        { kind: 's400-tel', dx: 180, dz: 60 },
        { kind: 's400-radar', dx: 0, dz: 420 },
        { kind: 's400-search', dx: -420, dz: 700 },
        { kind: 's400-cp', dx: 260, dz: 760 },
      ],
    },
    {
      // two TELARs in front with the loader-launcher on their flank, the search radar and the command
      // post behind; every vehicle stands on one of the battalion's levelled spots, at least 180 m from
      // the next so one warhead never catches two
      kind: 'buk', id: 'BUK', name: 'Buk-M2 battery', callsign: 'Beech',
      parts: [
        { kind: 'buk-telar', dx: 0, dz: 0 },
        { kind: 'buk-telar', dx: -180, dz: 60 },
        { kind: 'buk-loader', dx: 180, dz: 60 },
        { kind: 'buk-radar', dx: 0, dz: 420 },
        { kind: 'buk-cp', dx: 260, dz: 760 },
      ],
    },
  ],
  [
    { kind: 'pantsir', id: 'P1', name: 'Pantsir-S1 (battalion cover)', callsign: 'Shield 1', parts: one('pantsir') },
    { kind: 'tunguska', id: 'T1', name: '2S6M Tunguska (battalion cover)', callsign: 'Sabre 1', parts: one('tunguska') },
  ],
  [
    { kind: 'pantsir', id: 'P2', name: 'Pantsir-S1 (airbase)', callsign: 'Shield 2', parts: one('pantsir') },
    { kind: 'tunguska', id: 'T2', name: '2S6M Tunguska (airbase)', callsign: 'Sabre 2', parts: one('tunguska') },
  ],
  [
    { kind: 'osa', id: 'OSA', name: 'Osa-AKM', callsign: 'Wasp', parts: one('osa') },
    { kind: 'tor', id: 'TOR', name: 'Tor-M2', callsign: 'Hammer', parts: one('tor') },
  ],
  [
    { kind: 'strela', id: 'STR', name: 'Strela-10M3', callsign: 'Arrow', parts: one('strela') },
    { kind: 'shilka', id: 'SHK', name: 'ZSU-23-4M4 Shilka-M4', callsign: 'Saw', parts: one('shilka') },
  ],
];

// the kind picked for each slot; the first option of every slot
export const DEFAULT_LOADOUT = Object.freeze(SLOT_OPTIONS.map((opts) => opts[0].kind));

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
  }));
}

// Pads the terrain flattens: each vehicle gets a level spot and the runway a strip. The terrain keeps
// them from its first use, so they cover every option of every slot (the default loadout's first, any
// spot another option shares is not repeated) and whatever the menu picks stands on level ground.
export function flatPads() {
  const pads = [];
  const defs = buildUnits();
  SLOT_OPTIONS.forEach((opts, slot) => opts.slice(1).forEach((o) => defs.push({ ...o, ...SITES[slot] })));
  for (const u of defs) for (const p of partPlacements(u)) {
    if (pads.some((q) => Math.abs(q.x - p.x) < 1 && Math.abs(q.z - p.z) < 1)) continue;
    pads.push({ x: p.x, z: p.z, rx: 22, rz: 22, heading: p.heading, blend: 40 });
  }
  for (const a of ASSETS) {
    if (a.kind === 'runway') pads.push({ x: a.x, z: a.z, rx: a.width / 2 + 60, rz: a.length / 2 + 150, heading: headingFor(a.bearing), blend: 250 });
    else pads.push({ x: a.x, z: a.z, rx: 45, rz: 45, heading: headingFor(a.bearing), blend: 80 });
  }
  return pads;
}
