// The late-war WW2 era: German flak defends Fliegerhorst Hopsten (Rheine-Hopsten), the Me 262 base of
// KG 51 in north-west Germany, against the Allied day raids of February and March 1945 (refs/ww2/README.md:
// the setting, the order of battle, the waves; one sheet per system and aircraft). Plain data, importable in
// Node (tools/simtest.mjs); the shape of an era is in eras/index.js and DESIGN.md ("Eras", "WW2 era"). Its
// game values are in sim/systems.js (SYSTEMS flak88, flak43, flakvierling, flak38; THREATS b17 to window);
// its models, consoles and markings come from its lazily loaded `content`. In development until its render
// and consoles exist (`available: false`).
import ww2Terrain from './ww2/terrain.js';

// The raids come out of the west-south-west: Rheine, KG 51's second field, lies 12 km out on about 241, and
// the Allied fields (Volkel, the Tempest wing's) beyond it. Hopsten's main runway lay about 085/265; the
// shared runway keeps the modern era's 070/250 geometry.
const AXIS = 250;

// Where a unit's guns stand in its own frame (m; -dz toward its bearing, +dx to its right). A light Zug:
// three guns in a triangle 69 to 137 m apart (MIS 10); the heavy battery: five guns on a ring of 32 m radius
// round the sixth, the Kommandogeraet 40 in its own pit 95 m to one side with the Wuerzburg D beside it and
// the two 2 cm guns between them and the ring (refs/ww2/battery 5.2). Part 0 is gun A, which carries the
// third-person camera.
const ZUG = [[0, -55], [-50, 30], [50, 30]];
const RING = [[0, -32], [30.4, -9.9], [18.8, 25.9], [-18.8, 25.9], [-30.4, -9.9], [0, 0]];
const platoon = (kind, last = kind) => ZUG.map(([dx, dz], i) => ({ kind: i === 2 ? last : kind, dx, dz, name: `gun ${i + 1}` }));

export default {
  id: 'ww2',
  name: 'WW2',
  years: '1944 to 1945',
  available: false,
  theme: 'ww2',
  markings: 'ww2',
  terrain: ww2Terrain, // Hopsten's landscape in late winter: relief, waters, cover, trees, sky (eras/ww2/terrain.js)

  text: {
    sub: 'Flak at a jet airfield',
    blurb: 'A battery of six 8.8 cm guns under its predictor, two platoons of 3.7 cm, a platoon of Flakvierlinge and one of 2 cm guns stand round Fliegerhorst Hopsten. Only the heavy guns reach the bombers at height; the light guns meet whatever comes down low.',
    setting: 'Hopsten, a jet airfield in north-west Germany, February to March 1945: the flak against the Allied day raids.',
    orders: 'Flak command: all guns, fire at will. The aircraft reporting service has a raid inbound.',
    lull: 'Flak command: raid over. Ammunition is coming up, stand by.',
    victory: 'Airfield held',
    defeat: 'Airfield lost',
  },

  layout: {
    threatAxis: AXIS,
    // The Fliegerhorst (refs/ww2/airfield 1.3 to 1.5 and 4): the main runway, the blast bays of the south
    // dispersal with a parked Me 262 each, the hangar in the wood off the north boundary, the flight control
    // building on the edge of the landing ground, the fuel dump toward the south-east corner and the
    // earth-covered Flak command post. A bay's open side faces its bearing (the models: origin on the ground,
    // -Z along the bearing; a revetment's `jet: false` leaves it empty, `letter` and `werknummer` mark its Me
    // 262). `weight`: how likely raids sent at 'assets' pick it (default 1, the runway 3).
    assets: [
      { id: 'runway', kind: 'runway', name: 'Main runway', x: 0, z: 0, bearing: 70, length: 2800, width: 45, hp: 900, label: 'RWY' },
      { id: 'cp', kind: 'command44', name: 'Flak command post', x: 240, z: 900, bearing: 70, hp: 250, weight: 2 },
      // (bay 1's jet is the one Me 262 that survives in its original paint, W.Nr. 500200 "Black X", 9K+XK of KG 51)
      { id: 'bay1', kind: 'revetment', name: 'Blast bay 1', x: -494, z: 690, bearing: 340, hp: 120, weight: 1.5, letter: 'X', werknummer: '500200' },
      { id: 'bay2', kind: 'revetment', name: 'Blast bay 2', x: -353, z: 639, bearing: 340, hp: 120, weight: 1.5 },
      { id: 'bay3', kind: 'revetment', name: 'Blast bay 3', x: -212, z: 588, bearing: 340, hp: 120, weight: 1.5 },
      { id: 'bay4', kind: 'revetment', name: 'Blast bay 4', x: -71, z: 537, bearing: 340, hp: 120, weight: 1.5 },
      { id: 'hangar', kind: 'hangar', name: 'Hangar', x: -40, z: -680, bearing: 160, hp: 200 },
      { id: 'fuel', kind: 'fuel44', name: 'Fuel dump', x: 1240, z: 190, bearing: 70, hp: 120 },
      { id: 'tower', kind: 'tower44', name: 'Flight control', x: 230, z: 270, bearing: 340, hp: 80, weight: 0.5 },
    ],
    // losing the runway and the Flak command post ends the battle
    vital: ['runway', 'cp'],
    // between raids the airfield's construction troops fill the craters: a standing asset gets back this
    // share of its hit points (sim/director.js; Hopsten "was never seriously damaged, because of the strong
    // flak and the quickly executed repairs", refs/ww2/b17 6.4)
    repair: { runway: 0.25 },
    // The aircraft reporting service (Flugmeldedienst): its plot of the raids reaches every gun position by
    // telephone through the Flak command post, the stand-in for the modern data link (sim/sensors.js): every
    // aircraft more than `minAlt` m over the ground inside `range` m of the field, plotted again every
    // `period` s, about `error` m out; the link is down once the post is destroyed.
    plot: { post: 'cp', range: 45000, period: 8, minAlt: 250, error: 350 },
    // Where each slot's unit stands (refs/ww2 README section 3): the heavy battery 3.8 km out under the
    // bombers' approach (heavy guns stood 2 to 5 km out, "none nearer than 3.2 km", MIS 10); the 3.7 cm in the
    // Flak lane beside the extended centreline 2.7 km out, and by the blast bays; the Flakvierlinge north of
    // the centreline near the west threshold; the 2 cm by the fuel dump and the flight control building.
    sites: [
      { x: -2824, z: 2543, bearing: AXIS },
      { x: -2500, z: 1250, bearing: AXIS },
      { x: -280, z: 840, bearing: AXIS },
      { x: -1875, z: 405, bearing: AXIS },
      { x: 760, z: 330, bearing: AXIS },
    ],
  },

  // One unit per slot, the defaults only for now (the alternatives are listed in refs/ww2 README section 3).
  // Unit ids: BTY (the heavy battery), MED1 and MED2 (the 3.7 cm platoons), VIER, LIGHT. Callsigns follow
  // the period German spelling alphabet; the heavy guns are A to F (Anton to Friedrich), `letter`.
  slots: [
    {
      cls: 'Heavy battery',
      options: [
        {
          kind: 'flak88', id: 'BTY', name: '8.8 cm Flak 37 battery', callsign: 'Ludwig',
          label: '8.8 cm battery', info: 'Six guns fired together from the predictor: the only answer to the bombers at height',
          parts: [
            ...RING.map(([dx, dz], i) => ({ kind: 'flak88', dx, dz, name: `gun ${'ABCDEF'[i]}`, letter: 'ABCDEF'[i] })),
            { kind: 'kdo40', dx: -95, dz: 10, name: 'predictor' },
            { kind: 'wurzburg', dx: -110, dz: 45, name: 'Wuerzburg' },
            { kind: 'flak38', dx: -50, dz: -15, name: '2 cm gun 1' },
            { kind: 'flak38', dx: -55, dz: 40, name: '2 cm gun 2' },
          ],
        },
      ],
    },
    {
      cls: 'Medium flak, Flak lane',
      options: [
        { kind: 'flak43', id: 'MED1', name: '3.7 cm Flak 43 platoon (Flak lane)', callsign: 'Martha', label: '3.7 cm Flak 43', info: 'Three guns on their own sights, fed clip by clip; reach to about 3 km', parts: platoon('flak43') },
      ],
    },
    {
      cls: 'Medium flak, dispersal',
      options: [
        { kind: 'flak43', id: 'MED2', name: '3.7 cm Flak 43 platoon (dispersal)', callsign: 'Nordpol', label: '3.7 cm Flak 43', info: 'Three guns on their own sights, fed clip by clip; reach to about 3 km', parts: platoon('flak43') },
      ],
    },
    {
      cls: 'Light flak, quadruple',
      options: [
        { kind: 'flakvierling', id: 'VIER', name: '2 cm Flakvierling 38 platoon', callsign: 'Otto', label: '2 cm Vierling', info: 'Three quadruple mounts, one on a tower: a wall of fire inside 1.5 km', parts: platoon('flakvierling', 'flakvierling-tower') },
      ],
    },
    {
      cls: 'Light flak, single',
      options: [
        { kind: 'flak38', id: 'LIGHT', name: '2 cm Flak 38 platoon', callsign: 'Paula', label: '2 cm Flak 38', info: 'Three single guns: short reach, quick to swing onto a diving attacker', parts: platoon('flak38') },
      ],
    },
  ],

  // The six day waves of refs/ww2 README section 6, in game counts (the real raids were far bigger;
  // sim.difficulty.enemy scales them). Group fields as the modern era's (type, count, bearing offset from the
  // threat axis, spawn range, spread, delay, target) and the aircraft's (sim/planes.js): alt (m) or agl (m
  // over the ground: a low flyer), role, passes (gun passes), dive (degrees) and release (m over the ground,
  // where the bombs or the rockets leave), box (a formation: a squadron box or flights in trail, one aim
  // point, the leader's; bombs: game bombs per aircraft, bomb: their [damage, radius]), window (it throws
  // chaff), escort (it weaves over the wave's bombers and strafes once they have bombed), lb (the bombs' size
  // as the models draw them: the B-17 lead squadrons' 500 lb, the others' 100 lb); `radio`, the Flak
  // command's call as the wave starts (sim/director.js). Targets: 'assets',
  // 'asset:<kind>[,<kind>]', 'runway', 'flak' (any gun position), 'light' (the platoons), 'heavy' (the heavy
  // battery's guns), 'radar' (its Wuerzburg), 'units', 'any'.
  waves: [
    {
      title: 'Wave 1: reconnaissance and a sweep', sub: 'A photo aircraft at height, then Mustangs strafing the light flak and the dispersal',
      radio: 'Flak command: a single aircraft very high from the west, Mustangs behind it, low. Stand by.',
      groups: [
        { type: 'recon', count: 1, bearing: 5, range: 40000, spread: 2, delay: 0, alt: 9300, target: 'runway' },
        { type: 'p51', count: 4, bearing: -10, range: 22000, spread: 8, delay: 70, agl: 70, target: 'light', passes: 1 },
        { type: 'p51', count: 4, bearing: 15, range: 22000, spread: 8, delay: 85, agl: 70, target: 'asset:revetment', passes: 1 },
      ],
    },
    {
      title: 'Wave 2: fighter-bombers', sub: 'Thunderbolts dive-bombing the flak, the dispersal and the runway',
      radio: 'Flak command: Thunderbolts with bombs, four flights, from the west. Stand by.',
      groups: [
        { type: 'p47', count: 4, bearing: 0, range: 26000, spread: 8, delay: 0, alt: 2500, dive: 55, release: 750, target: 'flak' },
        { type: 'p47', count: 4, bearing: 8, range: 26000, spread: 8, delay: 25, alt: 2500, dive: 50, release: 800, target: 'asset:revetment' },
        { type: 'p47', count: 4, bearing: -15, range: 26000, spread: 8, delay: 60, alt: 2000, dive: 30, release: 300, target: 'asset:fuel44,tower44' },
        { type: 'p47', count: 4, bearing: 25, range: 26000, spread: 8, delay: 130, alt: 2500, dive: 50, release: 800, target: 'runway', bomb: [85, 35], lb: 1000 },
      ],
    },
    {
      title: 'Wave 3: Typhoons and Tempests', sub: 'Rocket Typhoons on the flak and the hangar, then Tempests strafing',
      radio: 'Flak command: Typhoons with rockets, Tempests behind them. Stand by.',
      groups: [
        { type: 'typhoon', count: 4, bearing: -5, range: 24000, spread: 8, delay: 0, alt: 2440, dive: 60, release: 1220, target: 'flak' },
        { type: 'typhoon', count: 4, bearing: 10, range: 24000, spread: 8, delay: 45, alt: 1500, dive: 40, release: 700, target: 'asset:hangar,revetment' },
        { type: 'tempest', count: 4, bearing: -3, range: 30000, spread: 6, delay: 110, alt: 2700, target: 'any' },
        { type: 'typhoon', count: 4, bearing: 30, range: 24000, spread: 8, delay: 160, alt: 1070, dive: 25, release: 460, target: 'light' },
      ],
    },
    {
      title: 'Wave 4: medium bombers', sub: 'Invaders in two boxes with Window and a flak flight, Thunderbolts ahead',
      radio: 'Flak command: twin-engined bombers in two formations at 3,000, Thunderbolts ahead of them. Stand by.',
      groups: [
        { type: 'p47', count: 4, bearing: -15, range: 26000, spread: 8, delay: 0, alt: 2500, dive: 55, release: 750, target: 'flak' },
        { type: 'a26', count: 9, bearing: -20, range: 32000, delay: 30, alt: 2900, box: true, target: 'runway' },
        { type: 'a26', count: 3, bearing: -21, range: 32800, delay: 30, alt: 3100, box: true, window: true, bombs: 0, target: 'runway' },
        { type: 'a26', count: 3, bearing: -12, range: 32000, delay: 40, alt: 2800, box: true, target: 'heavy', bomb: [40, 40] },
        { type: 'a26', count: 9, bearing: -20, range: 32000, delay: 90, alt: 2700, box: true, target: 'asset:command44' },
      ],
    },
    {
      // the squadrons a minute apart: they "took interval for a visual run" (Hopsten, 21 March 1945)
      title: 'Wave 5: Fortresses', sub: 'Three squadrons of B-17s in trail at 7 km with Window, Mustangs escorting and strafing',
      radio: 'Flak command: Fortresses, three formations at 7,000 to 7,500, with escort. Window expected. Stand by.',
      groups: [
        { type: 'p51', count: 6, bearing: 0, range: 33000, spread: 6, delay: 10, alt: 8100, escort: true, target: 'flak', passes: 1 },
        { type: 'b17', count: 12, bearing: 0, range: 34000, delay: 15, alt: 7300, box: true, window: true, target: 'runway' },
        { type: 'b17', count: 12, bearing: 3, range: 34000, delay: 75, alt: 7450, box: true, window: true, target: 'asset:revetment', lb: 100 },
        { type: 'b17', count: 12, bearing: -3, range: 34000, delay: 135, alt: 7150, box: true, window: true, target: 'asset:command44', lb: 100 },
        { type: 'p51', count: 6, bearing: 15, range: 25000, spread: 10, delay: 300, agl: 70, target: 'flak', passes: 1 },
      ],
    },
    {
      title: 'Wave 6: the Rhine crossing', sub: '24 March: every air force at once, from three directions',
      radio: 'Flak command: heavy raids from three directions, bombers and fighter-bombers together. All guns, stand by.',
      groups: [
        { type: 'typhoon', count: 6, bearing: -5, range: 24000, spread: 8, delay: 0, alt: 2440, dive: 60, release: 1220, target: 'flak' },
        { type: 'p47', count: 4, bearing: 25, range: 26000, spread: 8, delay: 20, alt: 2500, dive: 55, release: 750, target: 'heavy' },
        { type: 'a26', count: 9, bearing: -25, range: 32000, delay: 40, alt: 3500, box: true, window: true, target: 'runway' },
        { type: 'b17', count: 12, bearing: 10, range: 34000, delay: 60, alt: 7600, box: true, window: true, target: 'runway' },
        { type: 'b17', count: 12, bearing: 10, range: 34000, delay: 130, alt: 7600, box: true, window: true, target: 'asset:command44', lb: 100 },
        { type: 'tempest', count: 4, bearing: -40, range: 26000, spread: 8, delay: 120, agl: 60, target: 'any' },
        { type: 'p51', count: 6, bearing: 40, range: 26000, spread: 10, delay: 200, agl: 70, target: 'flak', passes: 1 },
      ],
    },
  ],

  // Every alert the sim raises for this era's units (sim/units.js describe, sim/mounts.js alerts) with the
  // gun position's caption (German), a plain English meaning and a rank (ui/consoles/common.js Header).
  alerts: {
    'ATTACK': ['TIEFANGRIFF', 'AIRCRAFT ATTACKING THIS POSITION', 0],
    'BOMBERS': ['BOMBER IM ANFLUG', 'BOMBER FORMATION INBOUND', 1],
    'WINDOW': ['DÜPPEL', 'WINDOW IN THE BEAM: RADAR RANGE SPOILED', 1],
    'BARRAGE': ['SPERRFEUER', 'BARRAGE FIRE', 2],
    'LOW AMMO': ['MUNITION KNAPP', 'LOW AMMUNITION', 2],
    'DAMAGED': ['STARK BESCHÄDIGT', 'UNIT BELOW HALF STRENGTH', 2],
    'GUN DOWN': ['GESCHÜTZ AUSGEFALLEN', 'A GUN IS KNOCKED OUT', 2],
    'PREDICTOR DOWN': ['KOMMANDOGERÄT AUSGEFALLEN', 'PREDICTOR KNOCKED OUT: BARRAGE ONLY', 2],
    'RADAR DOWN': ['FUMG AUSGEFALLEN', 'WÜRZBURG KNOCKED OUT', 2],
    'RADAR OFF': ['FUMG AUS', 'WÜRZBURG OFF', 3],
    'NO LINK': ['KEINE VERBINDUNG', 'NO LINE TO THE FLAK COMMAND POST', 3],
  },

  // the lessons on the Tutorials list (none yet)
  tutorials: [],

  // its models, consoles and reload scenes, fetched only when the era is picked (eras/index.js loadEra)
  content: () => import('./ww2/content.js'),
};
