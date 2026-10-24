// The modern era: an airbase on the steppe against Russian drones, cruise missiles, strike aircraft,
// helicopters and ballistic missiles (Geran-2, Kh-101, Su-34, Ka-52, Iskander-M; models/threats.js),
// defended by a layered Russian-built air defense in Ukrainian markings. Plain
// data, importable in Node (tools/simtest.mjs); the shape of an era is in eras/index.js and DESIGN.md
// ("Eras"). Its models, consoles and reload scenes are imported statically by their registries, so it
// has no `content` to load.

// The attacks come mostly out of the west-south-west; later waves widen the arc.
const AXIS = 250;

export default {
  id: 'modern',
  name: 'Modern',
  years: '2020s',
  available: true,
  theme: 'modern',
  markings: 'ua',

  text: {
    sub: 'Layered air defense',
    blurb: 'An S-400 battalion, two Pantsir-S1, an Osa and a Strela-10 stand between the airbase and the raids, or the alternatives you pick for them. The long layer sees them first; the short layer catches what leaks through.',
    setting: 'Ukraine defends an airbase on the steppe against Russian drones, missiles and strike aircraft.',
    orders: 'Command: all units, weapons free. First raid expected shortly.',
    lull: 'Command: raid over. Supply column is up, reload and stand by.',
    victory: 'Airbase held',
    defeat: 'Airbase lost',
  },

  layout: {
    threatAxis: AXIS,
    // The defended airbase. `hp` is gameplay hit points; `label` puts the asset on the HUD's compass.
    assets: [
      { id: 'runway', kind: 'runway', name: 'Runway 07/25', x: 0, z: 0, bearing: 70, length: 2800, width: 45, hp: 400, label: 'RWY' },
      { id: 'cp', kind: 'command', name: 'Air defense command post', x: -350, z: 650, bearing: 70, hp: 250 },
      { id: 'has1', kind: 'shelter', name: 'Shelter 1', x: -700, z: 420, bearing: 160, hp: 150 },
      { id: 'has2', kind: 'shelter', name: 'Shelter 2', x: -520, z: 480, bearing: 160, hp: 150 },
      { id: 'has3', kind: 'shelter', name: 'Shelter 3', x: 520, z: 260, bearing: 160, hp: 150 },
      { id: 'has4', kind: 'shelter', name: 'Shelter 4', x: 700, z: 200, bearing: 160, hp: 150 },
      { id: 'fuel', kind: 'fuel', name: 'Fuel farm', x: 900, z: 650, bearing: 70, hp: 120 },
      { id: 'tower', kind: 'tower', name: 'Control tower', x: 150, z: 380, bearing: 70, hp: 80 },
    ],
    // losing the runway and the command post ends the battle
    vital: ['runway', 'cp'],
    // where each slot's unit stands, in slot order; everything faces the threat axis unless it says otherwise
    sites: [
      { x: 7000, z: 2600, bearing: AXIS },
      { x: 6300, z: 2050, bearing: AXIS },
      { x: -2300, z: -700, bearing: AXIS },
      { x: -1500, z: 2300, bearing: 230 },
      { x: 950, z: -750, bearing: 270 },
    ],
  },

  // The fire units, one per slot, in the order the number keys select them, each with the options the
  // player can pick on the main menu, all of the same class: the area layer, two gun-missile point
  // defense units, a short-range missile system and a very short range one. Unit ids belong to the
  // option, not the slot: the default loadout keeps 'S400', 'P1', 'P2', 'OSA' and 'STR'; the
  // alternatives are 'BUK', 'T1' / 'T2' (a Tunguska in slot 1 or 2), 'TOR', 'SHK' and 'GEP'. `label` and
  // `info` are the menu's short name and one-line trade-off (DESIGN.md, "Loadout").
  slots: [
    {
      cls: 'Area layer',
      options: [
        {
          kind: 's400', id: 'S400', name: 'S-400 Triumf', callsign: 'Granit',
          label: 'S-400', info: 'Longest reach, stops ballistic missiles; few, costly rounds',
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
          label: 'Buk-M2', info: '70 km, cheap rounds; one target per TELAR, no ballistic targets',
          parts: [
            { kind: 'buk-telar', dx: 0, dz: 0 },
            { kind: 'buk-telar', dx: -180, dz: 60 },
            { kind: 'buk-loader', dx: 180, dz: 60 },
            { kind: 'buk-radar', dx: 0, dz: 420 },
            { kind: 'buk-cp', dx: 260, dz: 760 },
          ],
        },
      ],
    },
    {
      cls: 'Battalion cover',
      options: [
        { kind: 'pantsir', id: 'P1', name: 'Pantsir-S1 (battalion cover)', callsign: 'Shield 1', label: 'Pantsir-S1', info: 'Missiles to 20 km and 30 mm guns; takes some ballistic missiles', parts: [{ kind: 'pantsir', dx: 0, dz: 0 }] },
        { kind: 'tunguska', id: 'T1', name: '2S6M Tunguska (battalion cover)', callsign: 'Sabre 1', label: 'Tunguska', info: 'Guns first, tougher; cheap 9M311 to 10 km on the optical sight', parts: [{ kind: 'tunguska', dx: 0, dz: 0 }] },
      ],
    },
    {
      cls: 'Airbase cover',
      options: [
        { kind: 'pantsir', id: 'P2', name: 'Pantsir-S1 (airbase)', callsign: 'Shield 2', label: 'Pantsir-S1', info: 'Missiles to 20 km and 30 mm guns; takes some ballistic missiles', parts: [{ kind: 'pantsir', dx: 0, dz: 0 }] },
        { kind: 'tunguska', id: 'T2', name: '2S6M Tunguska (airbase)', callsign: 'Sabre 2', label: 'Tunguska', info: 'Guns first, tougher; cheap 9M311 to 10 km on the optical sight', parts: [{ kind: 'tunguska', dx: 0, dz: 0 }] },
      ],
    },
    {
      cls: 'Short range',
      options: [
        { kind: 'osa', id: 'OSA', name: 'Osa-AKM', callsign: 'Wasp', label: 'Osa-AKM', info: 'Six missiles to 10 km, fired in pairs; one target at a time', parts: [{ kind: 'osa', dx: 0, dz: 0 }] },
        { kind: 'tor', id: 'TOR', name: 'Tor-M2', callsign: 'Hammer', label: 'Tor-M2', info: 'Four targets at once inside its radar sector; quick, dearer rounds', parts: [{ kind: 'tor', dx: 0, dz: 0 }] },
      ],
    },
    {
      cls: 'Very short range',
      options: [
        { kind: 'strela', id: 'STR', name: 'Strela-10M3', callsign: 'Arrow', label: 'Strela-10M3', info: 'IR missiles to 5 km, no radar: silent, and you aim the sight', parts: [{ kind: 'strela', dx: 0, dz: 0 }] },
        { kind: 'shilka', id: 'SHK', name: 'ZSU-23-4M4 Shilka-M4', callsign: 'Saw', label: 'Shilka-M4', info: 'Four 23 mm guns, free to fire; very short range, its radar emits', parts: [{ kind: 'shilka', dx: 0, dz: 0 }] },
        { kind: 'gepard', id: 'GEP', name: 'Flakpanzer Gepard', callsign: 'Cheetah', label: 'Gepard', info: 'Two 35 mm guns to 3.5 km on their own radars; few heavy rounds, its radars emit', parts: [{ kind: 'gepard', dx: 0, dz: 0 }] },
      ],
    },
  ],

  // The battle: escalating waves, lulls between them, win and loss (sim/director.js). Groups: type, count,
  // bearing offset from the threat axis (deg), spawn range (m), delay after the wave starts (s), what
  // they go for, and per type extras (role, weapons and release range for aircraft, altitude, standoff for
  // helicopters: 5.5 km from their target, close enough for the short-range units and the airbase's cover
  // to meet them, so the raids do not hang on the battalion cover's 20 km 57E6, which a Tunguska there
  // lacks). Each wave runs about three to five minutes at x1 from the call to the last threat.
  waves: [
    {
      title: 'Wave 1: drones', sub: 'Geran-2 one-way attack drones, low and slow, from the west',
      radio: 'Command: Geran-2 drones, low and slow, from the west. Stand by.',
      groups: [
        { type: 'drone', count: 6, bearing: 0, range: 9000, spread: 14, delay: 0, target: 'assets' },
        { type: 'drone', count: 4, bearing: 28, range: 9000, spread: 8, delay: 40, target: 'short' },
        { type: 'drone', count: 4, bearing: -25, range: 9000, spread: 10, delay: 70, target: 'any' },
      ],
    },
    {
      title: 'Wave 2: cruise missiles', sub: 'Terrain-hugging Kh-101 cruise missiles with drones in support',
      radio: 'Command: Kh-101 cruise missiles on the deck, drones in support. Stand by.',
      groups: [
        { type: 'cruise', count: 4, bearing: -8, range: 30000, spread: 10, delay: 0, target: 'any' },
        { type: 'drone', count: 5, bearing: 32, range: 9000, spread: 10, delay: 10, target: 'assets' },
        { type: 'cruise', count: 4, bearing: 18, range: 30000, spread: 8, delay: 60, target: 'radar' },
        { type: 'drone', count: 4, bearing: -30, range: 9000, spread: 10, delay: 80, target: 'short' },
      ],
    },
    {
      title: 'Wave 3: suppression strike', sub: 'Su-34s with Kh-31P anti-radar missiles, Kh-55 decoys and Kh-101s',
      radio: 'Command: Su-34s with Kh-31P anti-radar missiles, Kh-55 decoys and Kh-101s. Stand by.',
      groups: [
        { type: 'fighter', count: 4, bearing: 0, range: 85000, spread: 14, delay: 0, role: 'sead', weapons: 2, target: 'assets' },
        { type: 'decoy', count: 6, bearing: 5, range: 80000, spread: 20, delay: 5, target: 'radar' },
        { type: 'drone', count: 4, bearing: -20, range: 9000, spread: 10, delay: 20, target: 'short' },
        { type: 'cruise', count: 4, bearing: 15, range: 30000, spread: 8, delay: 60, target: 'radar' },
      ],
    },
    {
      title: 'Wave 4: standoff bombing', sub: 'Su-34s with UMPK glide bombs behind decoys, drones from the south',
      radio: 'Command: Su-34s with UMPK glide bombs behind decoys, drones from the south. Stand by.',
      groups: [
        { type: 'fighter', count: 4, bearing: -5, range: 70000, spread: 12, delay: 0, role: 'glide', weapons: 2, target: 'assets' },
        { type: 'decoy', count: 3, bearing: 0, range: 75000, spread: 16, delay: 0, target: 'radar' },
        { type: 'drone', count: 8, bearing: -65, range: 9000, spread: 14, delay: 15, target: 'any' },
        { type: 'cruise', count: 3, bearing: 10, range: 30000, spread: 6, delay: 70, target: 'assets' },
      ],
    },
    {
      title: 'Wave 5: helicopters', sub: 'Radar hunters and cruise missiles, then Ka-52s against the short-range units',
      radio: 'Command: radar hunters and Kh-101s, then Ka-52s against the short-range units. Stand by.',
      groups: [
        { type: 'fighter', count: 2, bearing: 0, range: 85000, spread: 8, delay: 0, role: 'sead', weapons: 2, target: 'assets' },
        { type: 'cruise', count: 6, bearing: 5, range: 30000, spread: 14, delay: 0, target: 'any' },
        { type: 'drone', count: 4, bearing: 40, range: 9000, spread: 10, delay: 20, target: 'short' },
        { type: 'helo', count: 4, bearing: -20, range: 9500, spread: 24, delay: 50, target: 'short', weapons: 4, standoff: 5500 },
        { type: 'cruise', count: 3, bearing: -35, range: 30000, spread: 8, delay: 100, target: 'radar' },
      ],
    },
    {
      title: 'Wave 6: ballistic missiles', sub: 'Iskander-M missiles at the battalion and the airbase, behind cruise missiles and drones',
      radio: 'Command: Iskander-M launches expected, cruise missiles and drones ahead of them. Stand by.',
      groups: [
        { type: 'cruise', count: 8, bearing: -15, range: 30000, spread: 20, delay: 0, target: 'any' },
        { type: 'drone', count: 10, bearing: 40, range: 9000, spread: 20, delay: 10, target: 'any' },
        { type: 'tbm', count: 2, bearing: 10, range: 120000, spread: 6, delay: 60, target: 'radar' },
        { type: 'cruise', count: 4, bearing: 20, range: 30000, spread: 10, delay: 90, target: 'radar' },
        { type: 'tbm', count: 2, bearing: -10, range: 120000, spread: 6, delay: 110, target: 'assets' },
      ],
    },
    {
      title: 'Wave 7: saturation', sub: 'Everything at once, from three directions',
      groups: [
        { type: 'fighter', count: 4, bearing: 0, range: 85000, spread: 16, delay: 0, role: 'sead', weapons: 2, target: 'assets' },
        { type: 'decoy', count: 6, bearing: -10, range: 80000, spread: 24, delay: 0, target: 'radar' },
        { type: 'drone', count: 6, bearing: 0, range: 9000, spread: 20, delay: 0, target: 'any' },
        { type: 'fighter', count: 4, bearing: 20, range: 70000, spread: 12, delay: 20, role: 'glide', weapons: 2, target: 'assets' },
        { type: 'cruise', count: 6, bearing: -25, range: 30000, spread: 10, delay: 30, target: 'any' },
        { type: 'helo', count: 2, bearing: 30, range: 10000, spread: 12, delay: 40, target: 'short', weapons: 4, standoff: 5500 },
        { type: 'cruise', count: 4, bearing: 45, range: 30000, spread: 10, delay: 60, target: 'assets' },
        { type: 'drone', count: 6, bearing: -80, range: 9000, spread: 16, delay: 60, target: 'short' },
        { type: 'tbm', count: 2, bearing: 5, range: 120000, spread: 6, delay: 80, target: 'radar' },
      ],
    },
  ],

  // Every alert the sim raises (sim/units.js describe) with its cabin caption, a plain English meaning and
  // a rank (ui/consoles/common.js Header): the consoles of this era are labelled in Russian.
  alerts: {
    'ARM INBOUND': ['ПРР НА ПОДЛЁТЕ', 'ANTI-RADAR MISSILE: RADAR OFF!', 0],
    'ATGM INBOUND': ['ПТУР НА ПОДЛЁТЕ', 'GUIDED MISSILE AT THIS UNIT', 0],
    'INBOUND': ['ЦЕЛЬ БЛИЗКО', 'ENEMY CLOSING ON THIS UNIT', 1],
    'NO MISSILES': ['НЕТ РАКЕТ', 'NO MISSILES READY', 1],
    'OVERHEAT': ['ПЕРЕГРЕВ', 'GUNS OVERHEATED, WAIT', 1],
    'DAMAGED': ['ПОВРЕЖДЕНИЕ', 'UNIT BELOW HALF HEALTH', 2],
    'LOW AMMO': ['МАЛО БК', 'LOW AMMUNITION, RELOAD', 2],
    'NO LINK': ['НЕТ СВЯЗИ', 'NO DATA LINK TO S-400', 3],
    'GLIDE BOMB': ['УПАБ НА ПОДЛЁТЕ', 'GLIDE BOMB INBOUND', 0],
    'ATGM LAUNCH': ['ПУСК ПТУР', 'ATGM LAUNCHED', 0],
    'BALLISTIC': ['БАЛЛИСТИКА', 'BALLISTIC MISSILE', 0],
    'RADAR OFF': ['РЛС ВЫКЛ', 'RADAR OFF', 3],
    // a dispersed battery's vehicles knocked out (Buk; a standing state, ranked as DAMAGED): СОУ the TELAR,
    // ПЗУ the loader-launcher, СОЦ the search radar, КП the command post
    'TELAR DOWN': ['СОУ ПОРАЖЕНА', 'A TELAR IS KNOCKED OUT', 2],
    'LOADER DOWN': ['ПЗУ ПОРАЖЕНА', 'LOADER-LAUNCHER KNOCKED OUT', 2],
    'RADAR DOWN': ['СОЦ ПОРАЖЕНА', 'SEARCH RADAR KNOCKED OUT', 2],
    'CP DOWN': ['КП ПОРАЖЁН', 'COMMAND POST OUT: NO LINK', 2],
  },

  // the lessons on the Tutorials list (tutorial.js TUTORIALS ids), in order
  tutorials: ['basics', 's400', 'pantsir', 'osa', 'strela', 'buk', 'tunguska', 'tor', 'shilka', 'gepard'],
};
