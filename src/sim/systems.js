// Game values for the fire units, their missiles and the threats. These are gameplay numbers tuned for
// pacing and for the layering (long range high, short range low), not a model of real equipment.

// Fire units. search: the search radar's game range against a full-size target (m), rotation period (s),
// antenna height (m, for the earth-curvature line of sight) and a low-altitude penalty for older sets.
// track: the tracking channel's game range (and `sector`, the half-width in radians around the turret's
// bore it can hold targets in, for a turret-mounted array: the turret sits in the middle of its
// engagements, refuses a new one outside 80 % of it, and the guns take the turret off a missile in
// flight only for a target inside it). eo: the electro-optical channel's range, `vis`, how much poor
// visibility (`sim.visibility` below 1) shortens it, and `free`, how far (rad) the sight turns from the
// bore on its own drive (it holds only what is inside its field of view). AI crew rules: react, how long
// the crew takes to engage a new track (s); tempo, the pause after it starts an engagement before it
// starts another (s); close, inside this range (m) it also takes drones that are not coming for it (the
// area unit helicopters too, the Strela anything it can see); keep, the missiles it holds back from
// drones for faster targets; salvo, a fixed salvo size (otherwise two for aircraft, helicopters and
// ballistic targets, one for the rest); giveUp, how long a TELAR tries to get a target before it
// gives it up (s). targetGap: the engagement rate cap, the least time (s) between the first rounds
// at two new targets (a re-fire at a target its round missed is not held back; FireUnits.targetWait).
// gun.range is where the AI crew opens fire with its guns (full bursts inside half of it, half bursts
// and twice the pause at it), and inside it (below maxAlt) its missiles leave targets to the guns; the
// player can fire anywhere the shells reach. shell is the ballistics.js kind, side and height place the
// guns on the turret (m), rate is rounds per second, spread and dmg (optional) scale the shell's
// dispersion and damage per hit, settle is how long the crew lets the fire control hold a new target
// before it opens fire on it (s).
//
// Capabilities (instead of checks on the kind):
//   area      the area layer: the crew takes the high layer and leaves drones and helicopters to the
//             others, the unit fuses every emitting unit's tracks into the picture and links it (while
//             its command post stands), and raids sent at 'radar' aim at its 'radar' vehicle
//   fc        the fire-control channel that guides the missiles: 'search' (the search radar itself),
//             'track' (the tracking radar, or the EO sight when sight.src is 'eo'), 'sight' (the
//             Strela's optical sight), 'telar' (each launcher vehicle's own radar, one target each)
//   missileFc 'eo': the missiles are guided through the optical sight only (silent), the tracking
//             radar lays only the guns
//   eoFallback with the tracking radar off the guns are laid by the optical sight
//   uplink    the battalion's radar also carries its own-seeker rounds until their seeker takes over
//   vertical  rounds leave vertically (canisters, cells): no launcher to point before a launch
//   erectors  launchers that must be raised before the first launch
//   armFirst  the crew puts radar-seeking missiles first
//   restEl    the elevation the crew holds the launcher at with nothing to engage
//   minEl, maxEl  the launcher's elevation limits (the Osa's panels launch from at least minEl and stop
//             at maxEl; a Buk launcher stays at or above minEl while in action)
//   antenna   the tracking antenna elevates on its own (`turret.trackEl`), apart from the launcher; it
//             follows the target only while the tracking radar emits
//   dispersed per-vehicle hit points (the unit's hp is their sum): a warhead damages each vehicle by its
//             own distance and a vehicle at zero is knocked out on its own; the unit is out with its
//             last TELAR
//   racks     how the ready rounds of a type sit on the vehicles: [part, rounds, rounds per slot], in
//             the order they are loaded (and fired back from the end); one vehicle by default. With
//             fc 'telar' each vehicle keeps its own rounds instead (see FireUnits.nextLauncher);
//             cradle, how many reserve rounds the loader-launcher's rack shows.
//   reload    seconds a reload job takes until the vehicle is back in action (FireUnits.startJob; the
//             render's reload scene plays it, DESIGN.md "Reload scenes"); reloadMin, if given: a
//             partial load takes its share of `reload` by the rounds it adds, but not less than this
//   reloadPose the launcher's loading pose while a job runs on it: `erect` (the S-400: the TEL lowers
//             its stack to it in `time` s and raises it again after, inside `reload`) or `az`, `el`
//             (a turret is laid there, relative to the hull, at its slew rates; nothing else moves it);
//             `crane`, a pose of the same form for the vehicle whose crane works for another (Buk);
//             `free`, s before the job ends that the turret goes back to where it was when the job began;
//             `guns`, the guns take the turret while they have a target (Pantsir, Tunguska)
//   reloadDrive (Buk) m/s: a job on a TELAR adds the loader-launcher's drive over (straight distance
//             from its spot, or from where it is on its way back from the last one, FireUnits.loaderDrive)
export const SYSTEMS = {
  s400: {
    hp: 300,
    area: true, fc: 'search', uplink: true, vertical: true, erectors: 3, armFirst: true,
    search: { range: 240000, period: 6, height: 28, low: 1 },
    channels: 8,
    react: 9,
    tempo: 2,
    close: 5000,
    launchGap: 3,
    launchY: 9,
    stocks: { '48N6': { ready: 8, reserve: 8, load: 4 }, '9M96': { ready: 16, reserve: 16, load: 16 } },
    racks: { '48N6': [[0, 4], [1, 4]], '9M96': [[2, 16, 4]] },
    reload: 90,
    reloadPose: { erect: 0, time: 8 },
    turnAz: 0,
  },
  // A battery of five vehicles: shorter reach than the S-400 and no answer to ballistic missiles, cheaper
  // missiles, one target per TELAR (each guides its rounds with its own radar, which must hold the
  // target until impact), the loader-launcher fires too when a TELAR guides its rounds and reloads the
  // TELARs. Every TELAR radar that emits is a target for radar-seeking missiles.
  buk: {
    area: true, fc: 'telar', armFirst: true,
    dispersed: { 'buk-telar': 110, 'buk-loader': 80, 'buk-radar': 130, 'buk-cp': 90 },
    search: { range: 160000, period: 4, height: 20, low: 1 },
    track: { range: 80000 },
    react: 9,
    tempo: 2,
    close: 5000,
    launchGap: 2,
    launchY: 3.6,
    giveUp: 12,
    stocks: { '9M317': { ready: 12, reserve: 20, load: 4 } },
    racks: { '9M317': [[0, 4], [1, 4], [2, 4]] },
    cradle: 4,
    // the loader-launcher's crane work (reload) plus its drive to the TELAR it loads (reloadDrive m/s);
    // the TELAR turns its launcher to the rear, level, for the rounds (refs/buk section E, render/reload/buk.js),
    // the loader-launcher its crane end to the rear (crane: its launcher's elevation is left to the scene)
    reload: 30, reloadDrive: 12,
    reloadPose: { az: Math.PI, el: 0, crane: { az: Math.PI } },
    turnAz: 1.0, turnEl: 0.7, minEl: 0.3,
  },
  pantsir: {
    hp: 120,
    fc: 'track', armFirst: true,
    search: { range: 36000, period: 2.5, height: 7, low: 0.9 },
    track: { range: 24000, sector: 0.79 },
    eo: { range: 14000, vis: 0.3, free: 1.57 },
    channels: 2,
    // about ten targets a minute: with fast kills close in one Pantsir took on four in 6 s
    targetGap: 6,
    react: 3.5,
    tempo: 1,
    close: 3500,
    keep: 4,
    launchGap: 1.2,
    launchY: 3.4,
    stocks: { '57E6': { ready: 12, reserve: 12, load: 12 } },
    // opens fire at 2.5 km; the 30 mm reaches about 4.2 km (effective to about 4 km, 3 km up)
    gun: { shell: '30mm', rounds: 1400, range: 2500, maxAlt: 3000, rate: 80, burst: 1.4, cool: 0.9, side: 1.3, height: 3.6, settle: 4, spread: 2 },
    reload: 120, reloadMin: 40,
    reloadPose: { az: Math.PI / 2, el: 0, guns: true }, // combat module 90 degrees left, blocks level (render/reload/pantsir.js; reconstructed); the guns may take it
    turnAz: 1.6, turnEl: 1.2,
  },
  // Guns first: tougher, more 30 mm, a shorter search radar, and eight cheap missiles of shorter reach
  // guided only through the optical sight (silent, but it needs line of sight and good visibility). Its
  // gun crew opens fire at 3.5 km after 3 s on a new target (the Pantsir's 2.5 km and 4 s; the 30 mm
  // reaches about 4.2 km). At 3 km (its 9M311 leaving targets to the guns 500 m closer in) the all-auto
  // alternatives won 79 of 144 (51 before the gun ranges changed), at 3.5 km 52 (DESIGN.md "Balance").
  tunguska: {
    hp: 160,
    fc: 'track', missileFc: 'eo', salvo: 2, armFirst: true,
    search: { range: 24000, period: 1, height: 6, low: 0.8 },
    track: { range: 14000 },
    eo: { range: 12000, vis: 0.8, free: 0.79 },
    channels: 1,
    // one optical channel: the gunner lays the sight on each new target himself
    targetGap: 8,
    react: 4,
    tempo: 2,
    close: 3000,
    keep: 3,
    launchGap: 1.2,
    launchY: 3.0,
    stocks: { '9M311': { ready: 8, reserve: 24, load: 8 } },
    gun: { shell: '30mm', rounds: 2400, range: 3500, maxAlt: 3000, rate: 90, burst: 1.6, cool: 0.8, side: 1.7, height: 3.2, settle: 3 },
    reload: 45, reloadMin: 40,
    reloadPose: { az: Math.PI / 2, el: 0.5, guns: true }, // front to the 2F77M on the left, guns raised clear of the launchers (render/reload/tunguska.js; reconstructed); the guns may take it
    turnAz: 1.4, turnEl: 1.0,
  },
  osa: {
    hp: 90,
    fc: 'track', salvo: 2, restEl: 0.55, minEl: 0.55, maxEl: 0.6, antenna: true,
    search: { range: 30000, period: 1.5, height: 5, low: 0.6 },
    track: { range: 20000 },
    channels: 1,
    react: 5,
    tempo: 2,
    close: 6000,
    keep: 2,
    launchGap: 3, // a pair at one target leaves 3 to 5 s apart (refs/launch)
    launchY: 3.4,
    stocks: { '9M33': { ready: 6, reserve: 12, load: 6 } },
    reload: 60, reloadMin: 40,
    reloadPose: { az: Math.PI / 2, el: 0, free: 5 }, // panels level, rear ends right to the 9T217 (render/reload/osa.js); back 5 s before the end
    turnAz: 0.5, turnEl: 0.8,
  },
  // Eight rounds cold-launched from vertical cells, several targets at once inside the turret's radar
  // sector, quick to react, good against small fast targets, dearer rounds.
  tor: {
    hp: 100,
    fc: 'track', vertical: true, armFirst: true, salvo: 2,
    search: { range: 28000, period: 1, height: 6, low: 0.85 },
    track: { range: 18000, sector: 0.9 },
    channels: 4,
    // four channels and quick: a full set of four targets in 12 s
    targetGap: 4,
    react: 3,
    tempo: 1,
    close: 4500,
    keep: 2,
    launchGap: 1,
    launchY: 4.5,
    stocks: { '9M338': { ready: 8, reserve: 12, load: 8 } },
    reload: 70, reloadMin: 40,
    reloadPose: { az: Math.PI, el: 1.31 }, // turret round as for the march, antenna laid back (tor_m2_06; render/reload/tor.js)
    turnAz: 1.2, turnEl: 0.8,
  },
  strela: {
    hp: 70,
    fc: 'sight',
    search: null,
    sight: { fov: 0.21, zoom: 0.07, seeker: 0.045, range: 6500 },
    channels: 1,
    react: 6,
    close: 5500,
    launchGap: 1.5,
    launchY: 2.6,
    stocks: { '9M37': { ready: 4, reserve: 4, load: 4 } },
    // the crew's hand reload at a believable pace (render/reload/strela.js: 41 to 94 s for one to four
    // containers); win rates over 72 seeds unchanged against the old 20 s, the Strela scores a little less
    reload: 100,
    reloadMin: 42,
    reloadPose: { az: 0, el: 0.33 }, // launcher fore and aft, rails leading down over the rear roof (render/reload/strela.js)
    turnAz: 1.4, turnEl: 1.0,
  },
  // Guns only: four 23 mm barrels with a deep magazine, radar fire control and the optical sight when
  // the radar is off. Very short range, cheap against drones and helicopters, no use high or far.
  shilka: {
    hp: 80,
    fc: 'track', eoFallback: true,
    search: { range: 14000, period: 1, height: 5, low: 0.8 },
    track: { range: 6000 },
    eo: { range: 4000, vis: 0.8 },
    channels: 1,
    react: 2.5,
    close: 3000,
    stocks: {},
    // opens fire at 2 km; the 23 mm reaches about 2.8 km (effective to about 2.5 km, 1.5 km up)
    gun: { shell: '23mm', rounds: 2400, range: 2000, maxAlt: 1500, rate: 75, burst: 1.2, cool: 0.5, side: 0.3, height: 2.6, settle: 2.5 },
    reload: 0,
    turnAz: 1.8, turnEl: 1.3,
  },
};

// ---------------------------------------------------------------- WW2 (eras/ww2.js, refs/ww2)
// Gun units of several mounts (`mounts`, sim/mounts.js): 'battery', a heavy battery whose guns are laid
// from its predictor and fire together by salvo (or at a barrage box), and 'platoon', a Zug of three
// light or medium guns, each laying and firing on its own from its own pit on its crew's sight, at the
// platoon's target or at targets spread across the guns. Every gun is a part with its own turret and gun
// state; the unit is `dispersed` (each part knocked out on its own) and out with its last part of role
// `core`. Observers (`search.optical`): the battery's lookouts and the platoons' spotters scan the sky by
// eye, and see an aircraft out to `search.range` times its visual size (THREATS `vis`), shortened low
// down (`low`) and by poor `sim.visibility`, with terrain line of sight; the Flugmeldedienst's plot
// (the era's `layout.plot`) stands in for the data link. `roles` gives a part kind a role in this unit
// (the battery's own 2 cm guns are 'close': AI-only close defence).
//
// guns: one entry per gun part kind.
//   shell      ballistics.js kind; barrels: guns on the mount (the Vierling's four, fired in diagonal pairs),
//              each firing `rate` rounds/s (cyclic)
//   feed       how the rounds reach the gun: `mag` (magazines of that many rounds, `change` s to change one,
//              `loaders` men changing them, one magazine each at a time), `table` (clips of `clip` rounds
//              laid on a loading table holding `table` rounds, a clip every `load` s, +- loadVar, while there
//              is room: the 3.7 cm fires on as long as its loader keeps up) or `hand` (one round at a time,
//              `load` s +- loadVar from firing to the next round in the breech: the 8.8 cm)
//   rounds     at the gun (on the mount, the racks and the pit's niches); the supply column refills them
//              between raids
//   turnAz, turnEl  hand-laid slew rates (rad/s): the light guns' coarse gear at a brisk crank, the 8.8 cm's
//              US test rates (the laying gear ratios are in the refs sheets)
//   minEl, maxEl  elevation limits (rad); height: the bore above the ground (m; a tower's platform adds its
//              own), muzzle: barrel length forward of the trunnion (m)
//   sight      how far the layer holds a target of visual size 1 in his sight (m)
//   range, maxAlt  where the AI crew opens fire (slant m) and the highest target it takes (m); settle: s
//              the crew tracks a new target before it opens fire; burst, cool: its bursts and pauses (s)
//   err        the crew's aiming error (rad): the computing sight's and the layer's, wandering, smaller once
//              the crew corrects by the tracer; spread, dmg: scale the shell's dispersion and damage
// Where the sources are silent the value is an estimate (marked E), as in the sheets.

// 2 cm Flak 38 (refs/ww2/flak38): 420 to 480 rounds/min cyclic, 180 to 220 practical; 20-round magazines
// from the left (the change time is not recorded: 3 to 4 s, E); the Flakvisier 38 computing sight; fire
// opened at about 1,200 m (TTT 41), effective to about 2,000 yd; gear ratios not found (E: the Vierling's)
const FLAK38 = {
  shell: '20mm', barrels: 1, rate: 7.5,
  feed: { mag: 20, change: 3.5, loaders: 1 },
  rounds: 640, // E: about 12 magazines in the pit's racks and 100-round boxes in a niche
  turnAz: 0.6, turnEl: 0.35, minEl: -0.2, maxEl: 1.57, height: 0.9, muzzle: 1.4,
  sight: 3500, range: 1400, maxAlt: 1500, settle: 2, burst: 1.6, cool: 0.8, err: 0.006,
};
// 2 cm Flakvierling 38 (refs/ww2/flakvierling): four Flak 38 guns, 700 to 800 rounds/min practical, each
// pedal firing a diagonal pair; two loaders change the 20-round magazines (3.5 s each, E), 320 rounds on
// the mount (4 on the guns, 16 in the racks); traverse 22.5 and elevation 12 degrees per turn in coarse gear
const FLAKVIERLING = {
  shell: '20mm', barrels: 4, rate: 7.5,
  feed: { mag: 20, change: 3.5, loaders: 2 },
  rounds: 1600, // the mount's 320 and the pit's ammunition boxes (E)
  turnAz: 0.5, turnEl: 0.26, minEl: -0.17, maxEl: 1.57, height: 0.9, muzzle: 1.4,
  sight: 3500, range: 1500, maxAlt: 1800, settle: 2, burst: 1.8, cool: 0.9, err: 0.005,
};
// 3.7 cm Flak 43 (refs/ww2/flak43): 250 rounds/min cyclic, 150 to 180 practical; 8-round clips laid flat on
// a loading table that holds two (the loader lays one every 3 to 4 s, E), 32 rounds on the mount; one layer
// works both handwheels (traverse 20 degrees per turn coarse, elevation 8); the Schwebedornvisier 43;
// effective to about 2,700 m, self-destructs at 2,800 to 3,500 m
const FLAK43 = {
  shell: '37mm', barrels: 1, rate: 250 / 60,
  feed: { clip: 8, table: 16, load: 3.5, loadVar: 0.6 },
  rounds: 480, // E: 60 clips in the pit's niches
  turnAz: 0.4, turnEl: 0.18, minEl: -0.17, maxEl: 1.57, height: 1.1, muzzle: 2.3,
  sight: 5500, range: 2400, maxAlt: 3000, settle: 2.5, burst: 2.4, cool: 1.2, err: 0.004,
};
// 8.8 cm Flak 37 (refs/ww2/flak88): hand loaded, 15 to 20 rounds/min practical (TM E9-369A; an average crew
// 10, a very good one 15, TTT 20; the sheet's game figure 15 a minute sustained); laid by hand on the
// follow-the-pointer receivers, traverse 10.6 and elevation 5.9 degrees/s in the US test, -3 to +85
// degrees; the fuze set on the setter from the predictor's data; about 60 to 80 rounds at the gun with
// more carried from the bunker (E)
const FLAK88 = {
  shell: '88mm', barrels: 1, rate: 1,
  feed: { hand: true, load: 3.6, loadVar: 0.5 },
  rounds: 150,
  turnAz: 0.185, turnEl: 0.103, minEl: -0.05, maxEl: 1.48, height: 1.8, muzzle: 4.9,
  err: 0.0015,
};

Object.assign(SYSTEMS, {
  // The heavy battery (Grossbatterie no; one static battery of the March 1945 establishment, TM-E 30-451:
  // six 8.8 cm and two 2 cm): the Kommandogeraet 40 tracks one target by optics (its 4 m rangefinder) or
  // with the range from the Wuerzburg D, and its solution settles under 30 s from pickup to the first round
  // (refs/ww2/battery 1.7); the guns follow its data and fire together, the fuze set for where the target
  // will be after 15 to 22 s of shell flight. Window in the Wuerzburg's beam spoils the radar range; the
  // optical rangefinder is immune but worse. Barrage fire (Sperrfeuer) into a box on a formation's course.
  flak88: {
    area: true, mounts: 'battery', core: 'gun', stocks: {},
    dispersed: { flak88: 60, kdo40: 40, wurzburg: 35, flak38: 30 },
    roles: { flak38: 'close' },
    // the battery's lookouts and the predictor's telescopes
    search: { range: 30000, period: 2, height: 8, low: 0.6, optical: true },
    // Wuerzburg D (FuMG 62 D): range 29 to 40 km (game 30), about 25 m in range, 0.2 to 0.3 degrees in angle;
    // beam: half-width of what it picks up around its target (rad, E), gate: the range gate (m, E)
    radar: { range: 30000, beam: 0.1, gate: 500 },
    // Kommandogeraet 40 (TTT 40): slant range 1.2 to 18 km, targets to 300 m/s, time of flight to 30 s;
    // settle: the solution's time constant (s, E); rate: the trackers' angular rate limit (rad/s, E);
    // err: the solution's error at the burst (m, game: a + b * slant range) by range source, Window's
    // addition at full jamming; salvo: guns ready for a salvo, else the first ready gun waits `wait` s
    predictor: {
      range: 18000, minRange: 1200, radarRange: 30000, maxSpeed: 300, rate: 0.12, settle: 9, minFuze: 1.5,
      err: { radar: [10, 0.004], optical: [15, 0.0045], window: 300 }, salvo: 4, wait: 1.5,
      // barrage box half-sizes (m): along and across the formation's course, and in height (E; a block of
      // 500 x 500 x 250 m, ww2t, laid long on the course so the formation flies through it for a while)
      box: [500, 150, 80],
    },
    react: 8,
    guns: { flak88: FLAK88, flak38: FLAK38 },
  },
  // a Zug of three 3.7 cm Flak 43 (MIS 10: three guns in a triangle 69 to 137 m apart; no predictor, each
  // gun on its own sight, the Zug's 1 m rangefinder for the range)
  flak43: {
    mounts: 'platoon', core: 'gun', stocks: {},
    dispersed: { flak43: 45 },
    search: { range: 22000, period: 1.5, height: 4, low: 0.6, optical: true },
    react: 3,
    guns: { flak43: FLAK43 },
  },
  // a Zug of three 2 cm Flakvierling 38, the third on a wooden Flak tower (refs/ww2/flakvierling 11: 9 m
  // towers at the airfields, TTT 15)
  flakvierling: {
    mounts: 'platoon', core: 'gun', stocks: {},
    dispersed: { flakvierling: 40, 'flakvierling-tower': 35 },
    search: { range: 20000, period: 1.5, height: 4, low: 0.6, optical: true },
    react: 3,
    guns: { flakvierling: FLAKVIERLING, 'flakvierling-tower': { ...FLAKVIERLING, height: 10.4 } },
  },
  // a Zug of three 2 cm Flak 38
  flak38: {
    mounts: 'platoon', core: 'gun', stocks: {},
    dispersed: { flak38: 30 },
    search: { range: 20000, period: 1.5, height: 4, low: 0.6, optical: true },
    react: 3,
    guns: { flak38: FLAK38 },
  },
});

// What each vehicle of a multi-vehicle unit does: 'launcher' (S-400 TEL), 'radar' (the vehicle the
// attackers' radar-hunting raids aim at), 'search' (a search antenna), 'cp' (command post: the data
// link stands with it), 'telar' (launcher with its own tracking radar), 'loader' (loader-launcher).
// Single-vehicle units are 'main'. WW2: 'gun' (a gun of a battery or platoon), 'predictor' (the heavy
// battery's Kommandogeraet), 'radar' (its Wuerzburg), 'close' (the battery's 2 cm, SYSTEMS roles).
export const PART_ROLE = {
  's400-tel': 'launcher', 's400-radar': 'radar', 's400-search': 'search', 's400-cp': 'cp',
  'buk-telar': 'telar', 'buk-loader': 'loader', 'buk-radar': 'radar', 'buk-cp': 'cp',
  flak88: 'gun', kdo40: 'predictor', wurzburg: 'radar', flak43: 'gun', flakvierling: 'gun', 'flakvierling-tower': 'gun', flak38: 'gun',
};

// How many missiles each part's slot holds (the render layer shows a slot while it holds any).
export const SLOTS = { 's400-tel': 4, pantsir: 12, osa: 6, strela: 4, 'buk-telar': 4, 'buk-loader': 8, tor: 8, tunguska: 8 };

// track class -> the threat type whose hit chance applies (a missile with none cannot take it)
export const CLS_TYPE = { aircraft: 'fighter', decoy: 'decoy', cruise: 'cruise', drone: 'drone', arm: 'arm', bomb: 'glide', helo: 'helo', tbm: 'tbm', atgm: 'atgm' };

// Interceptors. speed: top speed (m/s) reached by `accel` during `burn` s, then the missile slows by
// `decel` m/s each second; below `minSpeed` it can no longer manoeuvre and self-destructs. eject: a
// cold-launched round rises unpowered for this long, thrown out of its canister or cell at `ejectSpeed`
// (m/s, slowing by g), and its motor lights at the top (refs/launch: the S-400's 20 to 30 m up, the
// Tor's 25 m/s catapult and 16 to 21 m).
// turn: game turn-rate limit (rad/s). fuze: the distance at which the hit is resolved. command: guided
// by the firing unit's tracking channel the whole way (loses guidance if the unit loses the track).
// seeker: switches to its own homing within this distance of the target. loft: long shots climb a little
// (a look, not a model). hit: game chance per threat type (0: the crews do not engage that class).
export const MISSILES = {
  '48N6': {
    speed: 1700, accel: 190, burn: 10, decel: 8, minSpeed: 450, turn: 0.3, life: 150, fuze: 25,
    range: 200000, minRange: 3000, maxAlt: 27000, minAlt: 15, eject: 1.2, ejectSpeed: 28, command: true, seeker: 0, cost: 40, loft: true,
    hit: { fighter: 0.85, decoy: 0.9, cruise: 0.6, drone: 0.5, arm: 0.5, glide: 0.65, helo: 0.6, tbm: 0.65, atgm: 0.15 },
  },
  '9M96': {
    speed: 1000, accel: 160, burn: 7, decel: 5, minSpeed: 350, turn: 0.7, life: 130, fuze: 18,
    range: 100000, minRange: 1500, maxAlt: 25000, minAlt: 8, eject: 1, ejectSpeed: 28, command: false, seeker: 12000, cost: 15, loft: true,
    hit: { fighter: 0.75, decoy: 0.85, cruise: 0.75, drone: 0.7, arm: 0.55, glide: 0.7, helo: 0.65, tbm: 0.2, atgm: 0.2 },
  },
  '57E6': {
    speed: 1250, accel: 450, burn: 2.6, decel: 30, minSpeed: 300, turn: 1.1, life: 30, fuze: 9,
    range: 20000, minRange: 1200, maxAlt: 15000, minAlt: 5, eject: 0, command: true, seeker: 0, cost: 8,
    hit: { fighter: 0.65, decoy: 0.8, cruise: 0.75, drone: 0.7, arm: 0.5, glide: 0.7, helo: 0.75, tbm: 0.15, atgm: 0.45 },
  },
  '9M33': {
    speed: 800, accel: 260, burn: 3, decel: 22, minSpeed: 260, turn: 0.8, life: 28, fuze: 12,
    range: 10000, minRange: 1500, maxAlt: 5000, minAlt: 25, eject: 0, command: true, seeker: 0, cost: 8,
    hit: { fighter: 0.65, decoy: 0.75, cruise: 0.55, drone: 0.55, arm: 0.3, glide: 0.45, helo: 0.75, tbm: 0, atgm: 0.2 },
  },
  '9M37': {
    speed: 560, accel: 300, burn: 2, decel: 18, minSpeed: 220, turn: 1.3, life: 16, fuze: 5,
    range: 5000, minRange: 800, maxAlt: 3500, minAlt: 10, eject: 0, command: false, seeker: Infinity, cost: 5,
    hit: { fighter: 0.6, decoy: 0.7, cruise: 0.5, drone: 0.7, arm: 0.2, glide: 0.2, helo: 0.8, tbm: 0, atgm: 0.1 },
  },
  // Buk: off the TELAR's rail, guided by that TELAR's radar the whole way; none against ballistic targets
  '9M317': {
    speed: 1300, accel: 260, burn: 6, decel: 9, minSpeed: 380, turn: 0.6, life: 90, fuze: 18,
    range: 70000, minRange: 2500, maxAlt: 22000, minAlt: 15, eject: 0, command: true, seeker: 0, cost: 12, loft: true,
    hit: { fighter: 0.8, decoy: 0.85, cruise: 0.7, drone: 0.6, arm: 0.6, glide: 0.7, helo: 0.7, tbm: 0, atgm: 0.2 },
  },
  // Tor: cold-launched up out of its cell, then it turns hard; best against small fast targets
  '9M338': {
    speed: 1000, accel: 520, burn: 2.5, decel: 28, minSpeed: 280, turn: 1.5, life: 24, fuze: 8,
    range: 15000, minRange: 1000, maxAlt: 10000, minAlt: 10, eject: 0.9, ejectSpeed: 25, command: true, seeker: 0, cost: 14,
    hit: { fighter: 0.6, decoy: 0.75, cruise: 0.8, drone: 0.75, arm: 0.7, glide: 0.8, helo: 0.7, tbm: 0, atgm: 0.5 },
  },
  // Tunguska: short reach, guided through the optical sight
  '9M311': {
    speed: 1100, accel: 500, burn: 2.4, decel: 28, minSpeed: 250, turn: 1.1, life: 16, fuze: 8,
    range: 10000, minRange: 1200, maxAlt: 3500, minAlt: 5, eject: 0, command: true, seeker: 0, cost: 5,
    hit: { fighter: 0.55, decoy: 0.75, cruise: 0.7, drone: 0.7, arm: 0.4, glide: 0.55, helo: 0.8, tbm: 0, atgm: 0.4 },
  },
};

// Threats. cls: what radar classification reveals. size: game radar size (0..1), ir: game heat
// signature for the Strela's seeker, radius: hit sphere (m), warhead: damage and radius on arrival,
// points: score for a kill.
export const THREATS = {
  fighter: { cls: 'aircraft', speed: 260, hp: 2, size: 1, ir: 1, radius: 7, warhead: null, points: 400 },
  decoy: { cls: 'aircraft', speed: 230, hp: 1, size: 0.85, ir: 0.15, radius: 2, warhead: null, points: 20 },
  cruise: { cls: 'cruise', speed: 240, hp: 1, size: 0.3, ir: 0.55, radius: 3, warhead: [140, 60], points: 150 },
  drone: { cls: 'drone', speed: 65, hp: 1, size: 0.18, ir: 0.35, radius: 2.5, warhead: [45, 30], points: 50 },
  arm: { cls: 'arm', speed: 680, hp: 1, size: 0.14, ir: 0.5, radius: 2, warhead: [80, 35], points: 120 },
  glide: { cls: 'bomb', speed: 260, hp: 1, size: 0.2, ir: 0.05, radius: 2, warhead: [160, 60], points: 120 },
  helo: { cls: 'helo', speed: 70, hp: 2.5, size: 0.75, ir: 0.85, radius: 6, warhead: null, points: 300 },
  atgm: { cls: 'atgm', speed: 330, hp: 1, size: 0.05, ir: 0.6, radius: 1, warhead: [55, 14], points: 60 },
  tbm: { cls: 'tbm', speed: 1200, hp: 1, size: 0.25, ir: 0.9, radius: 3, warhead: [260, 90], points: 500 },
};

// The WW2 era's aircraft and ordnance (refs/ww2/<type>/README.md; game values, the speeds and heights from
// the sheets). plane: an aircraft flying one of the scripted attack roles of sim/planes.js (`role` its
// usual one; a wave's group can give another): 'recon' (a straight photo run at height, then home), 'strafe'
// (low gun passes, repeated), 'dive' (roll-in, dive, bomb release, pull-out, then gun passes), 'rocket'
// (a dive with a salvo of rp3, then gun passes), 'level' (squadron boxes at height, every aircraft
// releasing its stick on the leader's release), 'escort' (weaving over the bombers, strafing after they
// leave). cls: the track class the observers report, name: for the radio, speed: cruise (m/s), fast: in
// the dive or the attack, turn: rad/s, alt: its usual height (m), guns: strafing damage per second on
// target, passes: gun passes, bombs: game bombs per aircraft (each `bomb` [damage, radius] stands for a
// few real ones; lb, their size as the models draw them), rockets: rp3 carried, window: it throws chaff, vis: visual size for the observers and
// the gun layers (0..1: a big airframe and contrails show far; 0, never seen by eye), size: radar size
// (the Wuerzburg). ghost: never hit by shells or bursts (falling bombs, rockets, chaff); chaff: a Window
// cloud, a false echo for the radar that falls slowly and is gone after `life` s.
Object.assign(THREATS, {
  // B-17G (refs/ww2/b17): bomb run at about 95 to 100 m/s true at 6,400 to 7,620 m in 12-ship squadron
  // boxes; 38 x 100 lb or 12 x 500 lb GP; chaff thrown by hand through the target area
  b17: { cls: 'bomber', name: 'B-17', plane: true, role: 'level', speed: 98, fast: 105, turn: 0.08, alt: 7300, hp: 6, size: 1, vis: 1, ir: 1, radius: 12, warhead: null, points: 600, bombs: 4, bomb: [55, 40], lb: 500, window: true },
  // A-26B/C (refs/ww2/a26): about 120 m/s at 2,650 to 4,100 m, boxes of three flights, 22 x 100 lb GP each;
  // it drops 300 m after bombing
  a26: { cls: 'bomber', name: 'A-26', plane: true, role: 'level', speed: 120, fast: 130, turn: 0.12, alt: 3000, hp: 5, size: 0.7, vis: 0.6, ir: 1, radius: 8, warhead: null, points: 400, bombs: 3, bomb: [45, 35], lb: 100 },
  // P-47D (refs/ww2/p47): cruise 156 m/s, roll-in at 2,100 to 3,050 m, a 45 to 60 degree dive at 180 to 200
  // m/s, release at 610 to 915 m, pull-out by about 300 m, then strafing; 2 x 500 lb, 8 x .50
  p47: { cls: 'fighter', name: 'P-47', plane: true, role: 'dive', speed: 150, fast: 190, turn: 0.45, alt: 2500, hp: 2.5, size: 0.45, vis: 0.45, ir: 1, radius: 5.5, warhead: null, points: 300, bombs: 2, bomb: [70, 30], lb: 500, guns: 7, passes: 1 },
  // P-51D (refs/ww2/p51): strafing at 155 to 178 m/s on the deck, pulling up to about 300 m 1.6 km out; 6 x .50
  p51: { cls: 'fighter', name: 'P-51', plane: true, role: 'strafe', speed: 160, fast: 178, turn: 0.55, alt: 1500, hp: 1.6, size: 0.4, vis: 0.4, ir: 1, radius: 5, warhead: null, points: 250, guns: 6, passes: 2 },
  // Typhoon IB (refs/ww2/typhoon): about 179 m/s in the attack; on a defended target a 60 degree dive from
  // 2,440 m with all eight RP-3 at 1,220 m, then a zoom climb; 4 x 20 mm
  typhoon: { cls: 'fighter', name: 'Typhoon', plane: true, role: 'rocket', speed: 165, fast: 180, turn: 0.45, alt: 2440, hp: 2.2, size: 0.45, vis: 0.45, ir: 1, radius: 5.5, warhead: null, points: 300, rockets: 8, guns: 6, passes: 1 },
  // Tempest V (refs/ww2/tempest): patrols at 2,400 to 3,050 m, strafing dives at 200 to 240 m/s, opening
  // fire at 900 m; 4 x 20 mm
  tempest: { cls: 'fighter', name: 'Tempest', plane: true, role: 'strafe', speed: 175, fast: 230, turn: 0.5, alt: 2700, hp: 2, size: 0.4, vis: 0.4, ir: 1, radius: 5.5, warhead: null, points: 300, guns: 7, passes: 2 },
  // Spitfire PR.XI (refs/ww2/recon): unarmed, 177 m/s at 7.3 to 9.8 km, one straight photo run; contrails
  // above 7.5 km
  recon: { cls: 'recon', name: 'reconnaissance aircraft', plane: true, role: 'recon', speed: 177, fast: 177, turn: 0.2, alt: 8500, hp: 1.5, size: 0.4, vis: 0.55, ir: 1, radius: 4.5, warhead: null, points: 350 },
  // a general-purpose bomb falling from its aircraft (drag: c, 1/m; the carrier sets its warhead)
  gpbomb: { cls: 'bomb', name: 'bomb', ghost: true, speed: 0, c: 0.00005, hp: 1, size: 0.05, vis: 0, ir: 0, radius: 0.5, warhead: [60, 35], points: 0 },
  // RP-3 with the 60 lb head (refs/ww2/typhoon 7: about 230 to 490 m/s, sources disagree; game 400 m/s more
  // than the aircraft, the motor burning `burn` s)
  rp3: { cls: 'rocket', name: 'rocket', ghost: true, speed: 400, burn: 1.2, hp: 1, size: 0.05, vis: 0, ir: 0, radius: 0.5, warhead: [55, 20], points: 0 },
  // Window (Dueppel, refs/ww2/battery 3.5): a cloud of chaff, an echo on the Wuerzburg like an aircraft's,
  // falling at about 4 m/s
  window: { cls: 'unknown', name: 'Window', ghost: true, chaff: true, speed: 0, fall: 4, life: 100, hp: 1, size: 0.6, vis: 0, ir: 0, radius: 0, warhead: null, points: 0 },
});

// hit: interceptor hit chances, enemy: the size of drone, cruise missile, decoy and helicopter groups (and
// of the WW2 era's aircraft groups), air: the size of fighter and ballistic missile groups, damage: what
// leakers do, aim: the WW2 light and medium gun crews' aiming errors, heavyAim: the WW2 heavy battery's
// predictor's (sim/mounts.js; `aim` when missing), bombAim: the WW2 aircraft's aiming errors with their
// bombs, rockets and guns (sim/planes.js). Hard's predictor is held to 1.25 so the 8.8 cm still brings
// bombers down (at 1.5 it got about 4 a game), and Hard's aircraft aim better instead.
export const DIFFICULTY = {
  Easy: { hit: 1.15, enemy: 0.9, air: 0.75, damage: 0.6, aim: 0.85 },
  Normal: { hit: 1, enemy: 1.15, air: 1, damage: 1, aim: 1 },
  Hard: { hit: 0.9, enemy: 1.4, air: 1.2, damage: 1, aim: 1.5, heavyAim: 1.25, bombAim: 0.9 },
};
