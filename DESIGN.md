# Echelon: layered air defense (design contract)

A three.js (WebGL2) game built from the MaxGFX: Battle Stations framework (`../threejs-maxgfx`, read only:
another session is editing it, never write there). The player commands a layered Russian air defense
around an airbase against escalating air attacks: an S-400 battalion for the long-range, high layer, two
Pantsir-S1 for point defense, an Osa-AKM and a Strela-10M3 for the short-range layer. On the main menu
each of the five slots can take an alternative of the same class instead (Buk-M2 battery, 2S6M Tunguska,
Tor-M2, ZSU-23-4M4 Shilka-M4; see "Loadout").

**Screen:** the left half is a third-person 3D view of the selected fire unit (orbit with the mouse, zoom
with the wheel); the right half is that unit's console (scopes, track tables, switches, sight view).
Units not selected fight on their own (AI crew) in whatever mode the player left them.

This file is the contract between the agents building the game in parallel. If you need to change a
shared interface, keep it backward compatible and note it in the "Changelog" at the end.

## Conventions

- Plain ES modules, no TypeScript, no framework, only `three` and `lil-gui` at runtime. Match the
  maxgfx code style: 2-space indent, single quotes, semicolons, compact code, comments that explain
  why rather than what. No em dashes in prose or comments (use commas, colons, parentheses).
- Units: metres, seconds, radians (degrees only in tables meant for people and in `deploy.js` bearings).
- World frame: y up, origin at the runway centre, north is -Z, east is +X. See `src/deploy.js`
  (`fromBearing`, `bearingOf`, `headingFor`, `UNITS`, `ASSETS`, `partPlacements`, `flatPads`, and the
  loadout: `SLOT_OPTIONS`, `DEFAULT_LOADOUT`, `LOADOUT`, `buildUnits`, `setLoadout`). `UNITS` and
  `LOADOUT` change in place with the loadout: read them when needed, never keep anything derived from
  them at import time.
- Model/vehicle space: front -Z, right +X, ground contact at y = 0, real-world size in metres.
  Headings are `rotation.y` (0 = facing north). Turret azimuth is `rotation.y` of the turret pivot
  relative to the hull (+ = left); elevation is `rotation.x` of the elevation pivot (+ = up).
- Every system is a class with `update(dt, ...)`. Cross-system effects go through callbacks wired in
  `main.js` (the maxgfx pattern), never by importing another system's state.
- Dev server: `http://localhost:5200` (already running; do not start another on 5200. If it is down,
  start it with `npx vite --port 5200 --host` in the background from the project root).
- Screenshots and console errors: `node tools/shot.mjs <path> <out.png> [--size 1600x900] [--wait ms]
  [--until "expr"] [--eval "expr"]`. Each call launches its own headless Chromium (SwiftShader WebGL2,
  slow but correct), so agents never share a browser. Do NOT use the Playwright MCP browser tools.
  Put screenshots in `shots/` (gitignored). Look at them with the Read tool.
- Never commit to git.

## File ownership (phase 1, four agents in parallel)

| Agent | Owns (create/edit only these) |
|---|---|
| Framework | `index.html`, `src/style.css`, `src/main.js`, `src/shaderlib.js`, `src/noise.js`, `src/atmosphere.js`, `src/clouds.js`, `src/weather.js`, `src/post.js`, `src/fx.js`, `src/terrain.js` (+ any `src/terrain*.js`, `src/vegetation.js`, `src/grass.js`), `src/camera.js`, `src/hud.js` |
| Models | `src/models/*`, `models.html`, `src/dev/modelviewer.js` |
| Simulation | `src/sim/*`, `src/ballistics.js`, `tools/simtest.mjs` |
| UI | `src/ui/*`, `ui.html` |
| Audio | `src/audio.js`, `public/audio/*` |

Phase 2 (one integration agent, after all of the above): `src/render/*`, `src/sight.js`, wiring in
`src/main.js`, `README.md`, `CLAUDE.md`, balance passes.

## Module contracts

### Terrain (`src/terrain.js`, framework)

```js
import { Terrain, heightAt } from './terrain.js';
heightAt(x, z)                 // pure function, valid anywhere (procedural), includes the flattened pads
const terrain = new Terrain(scene, { quality });
terrain.heightAt(x, z); terrain.normalAt(x, z, out);
terrain.los(ax, ay, az, bx, by, bz) // true if the straight line clears the ground (sampled march)
terrain.update(camera)          // recentres camera-following geometry
```

Rolling steppe and farmland (fields, tree windbreaks, a river valley, low ridges up to ~150 m that
mask low flyers), detailed near the camera, readable out to ~40 km through fog. `heightAt` must be
cheap (the sim calls it for terrain following and radar masking) and importable in Node (no DOM).

### Camera (`src/camera.js`, framework)

`ChaseCamera(camera, domElement)` orbits a world point (the selected unit's `eye` anchor): left-drag
orbits, wheel zooms (8 to 150 m), smooth 0.8 s transitions on `setTarget(object3D)`, stays above the
terrain, optional `padlock(pointOrNull)` that swings the view to keep a target in frame behind the
vehicle.

### Models (`src/models/`, models agent)

```js
import { buildVehicle } from './models/vehicles.js';
const rig = buildVehicle(kind); // 's400-tel' | 's400-radar' | 's400-search' | 's400-cp' | 'pantsir' | 'osa' | 'strela'
rig.root      // THREE.Group, model space as above
rig.pivots    // { turret, elevation, searchRadar, trackRadar, erector } (only those the vehicle has)
rig.anchors   // { eye, sight, muzzles: [], missileSlots: [] } Object3Ds; a slot's -Z is the firing direction
rig.setLoaded(i, loaded)  // show/hide the round or canister in slot i
rig.boxes     // [{ min, max }] model-space hit boxes for damage tests (optional)

import { buildThreat, buildInterceptor, THREAT_TYPES, INTERCEPTOR_KINDS } from './models/threats.js';
buildThreat(type)   // -> { parts: [{ geometry, material, spin?: 'z' | 'y', pivot?: Vector3 }], length, plume?: Vector3 }
buildInterceptor(k) // same shape; `plume` is the nozzle position in model space
// One merged BufferGeometry per part so the render layer can draw each part as an InstancedMesh.

import { buildAsset } from './models/site.js';
buildAsset(asset)   // asset from deploy.js ASSETS -> THREE.Group (runway with markings, shelters, ...)
```

Vehicles: 5P85SM2 TEL (MZKT-7930 8x8, four 48N6 canisters on an erector; or 9M96 quad packs),
92N6E engagement radar, 91N6E search radar (rotating), 55K6E command post, Pantsir-S1 on KamAZ-6560
8x8 (two 2A38M twin 30 mm, twelve 57E6 tubes, 1RS2 tracking radar, rotating search radar, EO block),
9K33M3 Osa-AKM (BAZ-5937 6x6, turret with search radar, tracking radar and six 9M33M3 in containers),
9K35M3 Strela-10M3 (MT-LB tracked, turret with four 9M37M containers, optical sight). Threat types:
`'cruise' | 'fighter' | 'decoy' | 'drone' | 'arm' | 'glide' | 'helo' | 'tbm' | 'atgm'`; interceptors:
`'48N6' | '9M96' | '57E6' | '9M33' | '9M37'`. All built procedurally, detailed enough to hold up in a
close third-person view, materials from `MeshStandardMaterial` (camo via canvas textures is fine).

### Simulation (`src/sim/`, simulation agent)

Pure logic plus `ballistics.js` tracer rendering (copied from maxgfx). Runs in Node for tests.

```js
import { Sim } from './sim/sim.js';
const sim = new Sim({ heightAt, los });   // los(ax, ay, az, bx, by, bz) -> bool
sim.events = {
  launch(unit, missile, part),        // missile left a launcher (render: blast, smoke)
  gun(unit, muzzle, dir),             // a 30 mm burst sample, ~20 Hz while firing (render: flash)
  detonate(pos, kind, hit),           // interceptor or shell burst (kind is the munition), hit = damaged its target
  threatKilled(threat, by),           // by = { unitId, weapon }
  impact(threat, pos, victim),        // a threat or its weapon hit the ground; victim = { kind: 'unit'|'asset', id } | null
  unitDamaged(unit), unitDestroyed(unit), assetDamaged(asset),
  radio(text, kind),                  // kind: 'info' | 'warn' | 'alert' | 'kill'
  wave(n, title, sub), state(state),  // director
  partDestroyed(unit, partIndex),     // optional: one vehicle of a dispersed unit (Buk) knocked out
};
sim.newGame({ difficulty: 'Normal', loadout });   // loadout optional, see "Loadout"
sim.update(dt);                      // dt already scaled by the time compression
sim.command(unitId, name, args);
sim.units; sim.threats; sim.missiles; sim.assets; sim.picture; sim.state; sim.wave; sim.score; sim.time;
sim.loadout;                         // the kinds in play, slot order
sim.area;                            // the area layer's unit (S-400 or Buk), or null
sim.linkUp();                        // the data link stands (area unit alive, and its command post vehicle)
sim.nextLauncher(unitOrId, type?);   // { part, slot } the next round of `type` (default: selected) leaves from
sim.emitting(unit, part?);           // the unit (or that vehicle) emits: radar-seeking missiles can home on it
sim.visibility = 1;                  // 1 clear; lower (rain, fog, dark) shortens the EO channels, see eo.vis
```

**Unit** (`sim.units[i]`, plain data the UI and render layer read):
```js
{ id, kind, name, callsign, pos, heading, parts: [{ kind, pos, heading }], hp, maxHp, alive,
  mode: 'auto' | 'manual' | 'hold',
  radar: { search: bool, track: bool, sweep: rad /* current search antenna azimuth, world */, range },
  tracks: Track[], selected: trackId | null,
  engagements: [{ trackId, missileIds: [], state: 'aligning' | 'launch' | 'flying' | 'kill' | 'miss' }],
  weapons: {
    missiles: { type, ready, reserve, max, reload /* s left, 0 = idle */ },   // S-400: per type, see below
    gun: { rounds, max, firing, heat },                                      // Pantsir only
    types: ['48N6', '9M96'], type: '48N6'                                     // S-400 only: selected missile
  },
  turret: { az, el },                       // relative to hull; S-400 has none
  erect: [0..1 per TEL],                    // S-400 launcher erect state
  sight: { az, el, fov, uncaged, lock, tone }, // Strela (and Pantsir EO channel): world az/el, lock 0..1
  status: 'READY', alerts: ['ARM INBOUND'] }
```
Fields added with the loadout (all kinds unless noted): `slot` (0..4, = `index`); `parts[i].role`
(`'main'` for single vehicles; `'launcher' | 'radar' | 'search' | 'cp'` on the S-400, `'telar' | 'loader'
| 'radar' | 'cp'` on the Buk; `'radar'` is the vehicle the attackers' radar-hunting raids aim at),
`parts[i].alive` (false once knocked out, and for every part of a destroyed unit), `parts[i].rounds`
(missiles on that vehicle). A dispersed unit (Buk) gives each vehicle `hp`, `maxHp` (the unit's `hp` and
`maxHp` are their sum), its TELARs `turret: { az, el }` (relative to the hull, like `unit.turret`),
`track` (its radar emitting), `target` (the track id its channel holds, or null), `locked` (holds it
right now), and the loader-launcher `turret: { az, el }`; `unit.telars` (part indices) and `unit.loader`
(part index). `unit.turret` is the lead vehicle's turret (a Buk: TELAR 1's, the same object).
`weapons.missiles` is null for a unit without missiles (Shilka: `types` is empty, `weapon` stays 'gun').
`weapons.gun.shell` ('30mm' | '23mm'), `gun.aim` (the lead point the fire control lays the guns on),
`gun.aimOk` (a target is held and `aim` is valid), `gun.locked` (the guns' channel holds their target),
`gun.tof` (the lead's time of flight, s), `gun.laid` (the guns have the turret) and `gun.hold` (why they
cannot fire on their target, or null; see "Gun fire control"). A Buk's stock has `reloadPart` (the vehicle the
loader-launcher is loading, -1 none; `reload` the seconds left on it). New alerts: 'TELAR DOWN',
'LOADER DOWN', 'RADAR DOWN', 'CP DOWN'. On a Buk `radar.search` is the search radar vehicle and
`radar.track` is true while any TELAR radar emits.

**Track** (`unit.tracks`, `sim.picture` = the fused network picture):
```js
{ id /* = the threat id it follows */, pos, vel, cls: 'aircraft' | 'cruise' | 'drone' | 'arm' | 'tbm'
  | 'helo' | 'bomb' | 'unknown', iff: 'hostile' | 'unknown', quality, firstSeen, lastSeen,
  range, bearing, alt, speed, tti, engagedBy: [unitId], source: 'own' | 'link' }
```
`range` and `bearing` in `unit.tracks` are relative to that unit; in `sim.picture` relative to the
runway. Decoys classify as `'aircraft'` on radar until the track has been held a while.

**Threat** (`sim.threats`): `{ id, type, pos, vel, bank, hp, maxHp, alive, falling, rcs, ir, target }`;
`target` is `{ kind: 'unit' | 'asset', id, pos }`, with `part` (the vehicle aimed at) for a unit.
Enemy weapons in flight (ARMs, glide bombs, ATGMs, cruise missiles, TBMs) are threats too, so they can
be shot down. **Interceptor** (`sim.missiles`): `{ id, kind, unitId, targetId, pos, vel, phase:
'eject' | 'boost' | 'sustain' | 'coast' | 'dead', motor: bool, age, alive }`.

**Commands** (`sim.command(unitId, name, args)`):

| Command | Units | Args |
|---|---|---|
| `radar` | all but Strela | `{ on }` search radar emitting (off = invisible to ARMs, but blind); a Buk's is its search radar vehicle, refused once that is knocked out |
| `track` | Pantsir, Tunguska, Osa, Tor, Shilka, Buk | `{ on }` tracking radar; Buk `{ on, part }`: one TELAR's radar (all TELARs without `part`; a TELAR switched off loses guidance of its rounds in flight) |
| `mode` | all | `{ mode: 'auto' \| 'manual' \| 'hold' }` |
| `select` | all | `{ trackId }` (null clears): designates the track to the unit's tracking channel (`unit.desig`, see "Designation"): a free channel takes it, the turret, antenna, TELAR or Strela launcher is laid on it and the channel locks; a gun unit in manual also takes it as its gun target (laid on its lead inside the guns' reach) |
| `engage` | all with missiles but Strela | `{ trackId, salvo: 1 \| 2, part }` launch at a track; `part` (Buk, optional): the TELAR to take it, otherwise `unit.firePart`, otherwise the free one with line of sight, its own rounds first |
| `firePart` | Buk | `{ part }` the TELAR (part index) the player picks to fire from, null for the best available; kept in `unit.firePart` (null at a new game): `engage` without `part` uses it and `sim.nextLauncher` (the camera) points at it while it stands |
| `cease` | all | `{ trackId }` |
| `missileType` | S-400 | `{ type: '48N6' \| '9M96' }` |
| `reload` | all with missiles | `{ part }` (Buk, optional: the vehicle the loader-launcher loads; default the emptiest TELAR, then its own rails) |
| `weapon` | Pantsir, Tunguska | `{ weapon: 'missile' \| 'gun' }` (the Shilka stays on 'gun') |
| `trigger` | Pantsir, Tunguska, Shilka | `{ down }` guns; releasing it stops the fire, the guns stay laid on the target |
| `trackSource` | Pantsir, Tunguska, Shilka | `{ source: 'radar' \| 'eo' }` what lays the guns (and the Pantsir's missiles); the Tunguska's missiles always fly on the EO sight; the Shilka falls back to EO while its tracking radar is off |
| `slew` | Strela, Pantsir, Tunguska, Shilka (EO) | `{ daz, del }` radians, manual sight movement (an EO sight stays within `eo.free` of the bore); Strela: moves where the launcher is laid (`unit.lay`; the sight looks along the launcher, the turret follows at its rates), and `{ az, el }` (world radians, either optional) lays it on a designation (the cue strip) |
| `uncage` | Strela | `{ on }` seeker free to track; tone and lock in `sight` |
| `fire` | Strela | `{}` launch when the seeker has a lock |
| `zoom` | units with a sight | `{ wide }` (omitted: toggle) |

**Simulation fidelity: this is an arcade-level game, not a weapons model.** The systems keep their
names, look and their role in the layering, but the mechanics are generic game rules with gameplay
values: missiles steer toward a target with a turn-rate limit, hits resolve from a simple game table,
sensors see by game range plus line of sight, waves are scripted for pacing. Do not model real-world
guidance laws, warhead lethality, sensor performance or real tactics; tune everything for fun.

Rounded encyclopedia-level figures, only as the starting feel for game values (the relative layering
matters, the numbers do not):

| System | Missile | Range | Altitude | Speed | Guidance | Ready |
|---|---|---|---|---|---|---|
| S-400 | 48N6E3 | 3 to 250 km | 10 m to 27 km | ~2000 m/s | command + TVM | 3 TELs x 4 |
| S-400 | 9M96E2 | 1 to 120 km | 5 m to 30 km | ~1000 m/s | inertial, active radar terminal | packs on a TEL |
| Pantsir-S1 | 57E6 | 1.2 to 20 km | 5 m to 15 km | ~1300 m/s peak | radio command (needs track) | 12 |
| Pantsir-S1 | 2A38M x2, 30 mm | 0.2 to 4 km | 0 to 3 km | 960 m/s muzzle | radar/EO fire control | 1400 rds, ~5000 rpm |
| Osa-AKM | 9M33M3 | 1.5 to 10 km | 25 m to 5 km | ~500 m/s avg | radio command | 6 |
| Strela-10M3 | 9M37M | 0.8 to 5 km | 10 m to 3.5 km | ~520 m/s | IR/photocontrast, fire and forget | 4 + 4 |

The loadout's alternatives have no rows here on purpose: their values are game values set relative to
the systems above for play (see "Loadout"), not taken from real-world figures.

Game rule that makes the layers work: low flyers only show up on a unit's scope inside a short
range and when there is line of sight over the terrain, so they leak through to the short-range layer.
A game "emitting" flag: units with their radar on can be targeted by the enemy's radar-seeking
missiles, units with it off are hidden from those but see nothing. Waves (6 to 8, escalating):
drones, cruise missiles, a SEAD strike (ARMs + decoys), glide bombs from standoff fighters, helicopter
pop-ups with ATGMs against the short-range units, a tactical ballistic missile, then mixed saturation.
The S-400 alone must not be able to win: tune so every layer matters and the player's choices count.

### Loadout (`src/deploy.js`, `src/sim/`, simulation agent)

The main menu lets the player swap each unit for an alternative of the same class. Five slots, each a
site (where it stands) with its options; option 0 is the default:

| Slot | Class | Options (`kind`, unit id) |
|---|---|---|
| 0 | area layer | `s400` S400, `buk` BUK |
| 1 | gun-missile point defense, battalion cover | `pantsir` P1, `tunguska` T1 |
| 2 | gun-missile point defense, airbase | `pantsir` P2, `tunguska` T2 |
| 3 | short-range missile | `osa` OSA, `tor` TOR |
| 4 | very short range | `strela` STR, `shilka` SHK |

```js
import { SLOT_OPTIONS, DEFAULT_LOADOUT, LOADOUT, UNITS, buildUnits, setLoadout } from './deploy.js';
SLOT_OPTIONS       // [slot][option] = { kind, id, name, callsign, parts: [{ kind, dx, dz }] }
DEFAULT_LOADOUT    // ['s400', 'pantsir', 'pantsir', 'osa', 'strela'] (frozen)
setLoadout(kinds)  // one kind per slot (missing, null or '': the slot's default; throws on a kind the slot
                   // does not offer); rebuilds UNITS and LOADOUT in place, returns UNITS
buildUnits(kinds)  // the same unit definitions as fresh objects ({ id, kind, name, callsign, slot, x, z,
                   // bearing, parts }), changing nothing
sim.newGame({ difficulty, loadout })   // with `loadout`: setLoadout(loadout) first; without: UNITS as set
```

- **Unit ids belong to the option, not the slot.** The default loadout keeps the ids it always had
  (S400, P1, P2, OSA, STR), so the tutorials, the UI mock and everything keyed on them work unchanged;
  an alternative brings its own (BUK, T1 or T2, TOR, SHK). `unit.slot` (= `unit.index`, the number key)
  says which slot a unit fills. Nothing in `src/sim` or `tools/` looks a unit up by id any more: the area
  unit is `sim.area`, the point defense pair is slots 1 and 2.
- **Importers must not cache.** `UNITS` and `LOADOUT` are changed in place; read them when needed and
  rebuild whatever is derived from them after a loadout change. Known places that derive at import or
  init time today (owners please change): `ui/panel.js` `KIND_OF`, main's `eyes` map, `UnitViews` (built
  once at init; `views.reset(sim)` assumes the same unit ids), the panel's tabs. (All rebuilt now on a
  loadout change: main's `newBattle`, see the Client changelog lines.)
- `flatPads()` covers the vehicles of every option of every slot (the terrain keeps its pads from its
  first use), so any loadout stands on level ground. The Buk's five vehicles stand on five of the
  S-400's six spots (two TELARs in front, the loader-launcher on their flank, the search radar 420 m and
  the command post 800 m behind, every vehicle at least 180 m from the next so one warhead never catches
  two); the single-vehicle alternatives stand where the default stands.
- The menu calls `setLoadout` (or passes `loadout` to `newGame`) before "Take command". Tutorials are
  written for the default units: start them with `newGame({ scripted: true, loadout: DEFAULT_LOADOUT })`
  and apply the player's loadout again at the next "Take command". Attract mode runs whatever is set.

**The alternatives.** Each keeps its class and its place in the layering and is built only from the
game's generic rules (channels, game ranges and line of sight, turn-rate-limited missiles, the hit
table, the "unit must hold the track" rule, emitters as ARM targets); every value is a game value set
relative to the systems already there.

- **Buk-M2 battery** (`buk`; vehicles `buk-telar` x2, `buk-loader`, `buk-radar`, `buk-cp`). Shorter
  reach than the S-400 (9M317 70 km against 200 and 100), no answer to ballistic missiles (hit 0: the
  crews never engage them), cheaper rounds (12 against 40 and 15), 12 ready and 20 reserve. Each TELAR
  carries its own radar (`fc: 'telar'`): one target per TELAR still standing (`channelCount`), and the
  9M317 is command guided, so that TELAR's radar must hold the target until impact (3 s without it and
  the round self-destructs). The loader-launcher fires too, but only for an engagement a TELAR guides
  (the TELAR's own rounds first, then the loader's), and its crane reloads one vehicle at a time from
  the reserve on its rack (30 s of crane work plus its drive over to a TELAR at `reloadDrive` 12 m/s:
  from its spot 46 s for TELAR 1 and 60 s for TELAR 2, less when it is still on its way back from the
  other one, see "The Buk scene"; neither it nor that vehicle can launch meanwhile). A TELAR that
  cannot get its target (terrain, radar off) gives it up after `giveUp` (12 s). Every emitting TELAR
  radar and the search radar vehicle are separate targets for radar-seeking missiles: going silent is
  per emitter (`track { on, part }`), and a silenced TELAR loses its rounds in flight. The battery is
  **dispersed**: each vehicle has its own hit points (TELAR 110, loader 80, radar 130, CP 90) and is
  knocked out on its own (`partDestroyed`); without the search radar it fights on its TELARs and the
  link picture; without the command post the data link is down for everyone (the CP takes over the
  S-400's role of fusing the picture and linking it); the battery is out with its last TELAR. Raids
  sent at 'radar' aim at the search radar vehicle's site (also once it is knocked out).
- **2S6M Tunguska** (`tunguska`): guns first. Two twin 30 mm with 2400 rounds (the Pantsir 1400) whose
  crew opens fire out to 2.2 km, as far as its shells reach, 3 s after it takes a target (the Pantsir's
  at 1.6 km after 4 s), eight cheap 9M311 (cost 5, 8 + 24) of shorter reach (10 km against 20) guided
  only through the optical sight (`missileFc: 'eo'`: silent, needs line of sight, 12 km shortened by
  poor `sim.visibility`), one missile channel (the crew fires pairs), tougher (160 hp), a shorter
  search radar (24 km against 36). Its tracking radar lays only the guns (`trackSource` picks radar or
  EO for them). No answer to ballistic missiles.
- **Tor-M2** (`tor`): eight 9M338 in vertical cells, cold-launched straight up and turning after a
  0.9 s eject at 25 m/s, lighting about 18 m over its cell (`vertical`, the S-400's eject phase), four channels but only inside its turret-mounted
  array's sector (`track.sector` 0.9 rad around the bore: the turret turns to the middle of its
  engagements and refuses a new one outside 80 % of the sector), quick to react (3 s against the Osa's
  5), best against small fast targets (hit 0.7 to 0.8 against cruise missiles, glide bombs, ARMs,
  drones), dearer rounds (14 against 8), 8 + 12. The AI crew fires pairs; a player firing single rounds
  gets more out of it.
- **ZSU-23-4M4 Shilka-M4** (`shilka`): guns only, no missiles (`weapons.missiles` null). Four 23 mm
  barrels, 2400 rounds, 75 rounds/s in bursts, radar fire control with the optical sight taking over
  while the tracking radar is off (`eoFallback`), a short search radar (14 km). Very short range: the
  23 mm self-destructs at about 1.9 km and the crew opens fire inside 1.4 km, nothing above 1.5 km.
  Free per kill (guns cost nothing in `score.cost`); it takes drones, ATGMs, ARMs and cruise missiles
  diving close by. Its radar emits, unlike the Strela.

Game values (`SYSTEMS`, `MISSILES`), for comparison with the existing systems:

| Kind | Missile: reach, top speed, ready + reserve, cost | Channels | Guns | Search / track / EO | hp |
|---|---|---|---|---|---|
| s400 | 48N6 200 km, 1700 m/s, 8 + 8, 40; 9M96 100 km, 1000, 16 + 16, 15 | 8 | - | 240 km / search radar | 300 |
| buk | 9M317 70 km, 1300 m/s, 12 + 20 (4 per launcher vehicle), 12 | 1 per TELAR (2) | - | 160 km / 80 km per TELAR | 110 + 110 + 80 + 130 + 90 |
| pantsir | 57E6 20 km, 1250 m/s, 12 + 12, 8 | 2 | 30 mm, 1400, opens at 1.6 km | 36 / 24 / 14 km | 120 |
| tunguska | 9M311 10 km, 1100 m/s, 8 + 24, 5 (EO only, pairs) | 1 | 30 mm, 2400, opens at 2.2 km | 24 / 14 / 12 km | 160 |
| osa | 9M33 10 km, 800 m/s, 6 + 12, 8 (pairs) | 1 | - | 30 / 20 km | 90 |
| tor | 9M338 15 km, 1000 m/s, 8 + 12, 14 (cold launch, pairs) | 4 inside a 0.9 rad sector | - | 28 / 18 km | 100 |
| strela | 9M37 5 km, 560 m/s, 4 + 4, 5 | 1 (seeker) | - | sight 6.5 km | 70 |
| shilka | - | 1 | 23 mm, 2400, opens at 1.4 km, reach 1.9 km | 14 / 6 / 4 km | 80 |

**Balance** (`node tools/simtest.mjs <seeds> --all --loadout ...`, Normal; games won by the all-auto
crews / the scripted area player / the scripted area player with the point defense pair; the other
units on auto). The final pass, on the finished tree (loadout, tracking and designation fixes, gun fire
control, launch sequences, reload jobs with their realistic durations and scenes), with the changes it
made (below):

| Loadout | Seeds 1 to 72 | Seeds 1 to 144 | Scripted area player against the default (1 to 72) |
|---|---|---|---|
| default | 14 / 56 / 60 | 29 / 117 / 127 | |
| Buk | 21 / 49 / 58 | | -10 points |
| Tunguska in slot 1 | 4 / 50 / 55 | | -8 |
| Tunguska in slot 2 | 9 / 62 / 66 | | +8 |
| two Tunguskas | 4 / 58 / 58 | | +3 |
| Tor | 15 / 61 / 68 | | +7 |
| Shilka | 16 / 58 / 68 | | +3 |
| all alternatives | | 51 / 110 / 132 | |

On Hard (default, seeds 1 to 48) 0 / 7 / 17, on Easy 48 / 48 / 48. Kills per game, all auto, default
over 144 seeds: S-400 40, Pantsir missiles 58 and guns 13, Osa 26, Strela 12; all alternatives: Buk 39,
Tunguska missiles 38 and guns 24, Tor 35, Shilka 6 (drones and what dives close by; it scores in about
half the waves).

The final pass started from the tree as the other passes left it (seeds 1 to 144 for the default and
the alternatives, 1 to 72 for the swaps): default 12 / 109 / 121, all alternatives 44 / 102 / 125; the
swaps' scripted S-400 (or Buk) against the default's 54 of 72: Buk 42 (-17 points), Tunguska in slot 1
44 (-14), in slot 2 60 (+8), two Tunguskas 47 (-10), Tor 63 (+13), Shilka 64 (+14); Hard 1 / 9 / 13 of
48, Easy 47 / 48 / 48. Three changes, game values only (no reload duration shortened, no fix undone):

- **The lull between raids 20 s to 40 s** (`director.js` `LULL`). With the realistic reload times (30
  to 120 s, the Buk's loader-launcher one vehicle at a time and its drive) a 20 s lull let almost
  nothing finish before the next raid; at 40 s most jobs run while it is quiet, so the reload scenes
  play between raids. It helps most the units with slow serial reloads (the Buk, the Strela's hand
  reload) and least the Shilka (no reload): over seeds 1 to 72 the swaps went to Buk -5 games,
  Tunguska in slot 1 -6, Tor +9, Shilka +6 (from -12, -10, +9, +10), but two Tunguskas from -7 to -13.
  60 s did no better (Buk +2, Tunguska in slot 1 -14) and leaves the player waiting.
- **Helicopters stand off 5.5 km from their target, not 6.5** (wave 5 and 7, `standoff`). The
  Tunguska's losses were in the helicopter raids on the short-range units: the Pantsir covering the
  battalion reaches them with its 20 km 57E6, the 9M311 (10 km) does not, so with Tunguskas the Osa
  died in 32 of 48 games (19 with Pantsirs). Closer in, the short-range units and the airbase cover
  meet them: two Tunguskas 43 to 50, slot 1 50 to 53, the default unchanged (56).
- **The Tunguska's gun crew opens fire at 2.2 km after 3 s on a target** (`gun.range` 2000 to 2200,
  `gun.settle` 4 to 3; its place as "guns first"): two Tunguskas 97 to 115 of 144 for the scripted
  S-400 (settle alone 104, range alone 95), in slot 2 56 to 62 and in slot 1 53 to 50 of 72 (noise),
  all alternatives 56 / 106 to 51 / 110 of 144 (all auto / scripted Buk; the all auto 61 in another run
  with a Buk crew change that made no difference).

Tried and not kept (seeds 1 to 72 unless noted): Normal `damage` 1.1 (scripted all alternatives 54 to 48,
Buk 49 to 45, the default unchanged) and `enemy` 1.2 (Tunguska in slot 1 53 to 38); a slower Tor crew
(react 4) or a weaker 9M338 against drones (0.65): no change; the 9M311 to 12 km (two Tunguskas +9 of
144, but all alternatives all auto 73 of 144); the 9M311 hit table +0.05 to +0.15 (+5 two Tunguskas,
nothing in slot 1); the Buk crew topping up between raids only a TELAR at most half full, with react 12
(Buk all auto 45 to 44 of 144: no effect); one fewer ballistic missile in wave 6 (Buk 99 to 116 and two
Tunguskas 97 to 115 of 144, but the default 117 to 125 and the Buk all auto 45 to 65) or a 200 warhead
for it (Buk all auto 58, default all auto 40). The Buk stays the weakest swap: over seeds 73 to 144 it
measured 24 / 50 against the default's 15 / 61, so -12 points over 144 seeds; it has no answer to the
ballistic missiles of wave 6, which is its trade-off. Single games still flip near the loss line: the
default's scripted S-400 won 56 of seeds 1 to 72 and 61 of 73 to 144.

Earlier passes, for the record (measured on trees that have changed since). The table before the final
pass read, seeds 1 to 24 and 1 to 72: default 3 / 19 / 22 and 12 / 60 / 63, Buk 8 / 17 / 19 and
19 / 48 / 58, Tunguska in slot 1 1 / 19 / 19 and 4 / 49 / 52, in slot 2 3 / 23 / 22 and 13 / 63 / 66,
two Tunguskas 3 / 18 / 20 and 7 / 50 / 60, Tor 6 / 21 / 21 and 18 / 63 / 61, Shilka 2 / 20 / 20 and
5 / 57 / 60, all alternatives 10 / 16 / 18 and 34 / 50 / 58; before the loadout work the default
measured 2 / 20 / 21 of 24 (and 13 / 57 / 63 of 72).

In that table the default and all-alternatives rows were after the tracking fixes (refs/tracking), the
single-swap rows before them. Before the fixes those two rows read 5 / 18 / 23 and
15 / 57 / 63 (default), 8 / 16 / 21 and 24 / 54 / 61 (all alternatives). Single games flip near the
loss line (runway and command post), so 72 seeds still swing by about 5 games per column with any
small change (a 0.2 % change of one radar period moved the full alternatives player from 127 to 114
of 144): over seeds 1 to 144 the default went from 29 / 103 / 126 to 32 / 103 / 121 and the
alternatives from 61 / 105 / 127 to 55 / 113 / 120 (leaks per game 19.4 / 13.9 / 10.8 to
19.0 / 13.9 / 11.6, and 16.4 / 12.0 / 8.3 to 16.1 / 13.5 / 8.5). The fixes made the AI crews of the
alternatives stronger (no more rounds launched toward the runway centre), so the Tunguska crew is now
slower (react 4, tempo 2, close 3000, keep 3, was 3 / 1 / 4000 / 2) and the 9M311 quicker (1100 m/s,
was 950, so a pair holds the turret off the guns for less time). On Hard the default gives 0 and 1 of
24 (was 0 and 2).

The launch timing fixes (refs/launch: Osa `launchGap` 2 to 3 s, the 9M338 eject 0.5 s at 28 m/s to
0.9 s at 25 m/s, the S-400 gated on the firing TEL's own erector) were measured on a copy of the sim
taken before the reload rework (per-vehicle reload jobs) landed, seeds 1 to 72 and 73 to 144: default
19 / 48 / 62 and 14 / 55 / 60 before, 19 / 57 / 60 and 17 / 54 / 61 after (over 144: 33 / 103 / 122 to
36 / 111 / 121); all alternatives 31 / 56 / 61 and 32 / 52 / 59 before, 29 / 53 / 60 and 25 / 52 / 64
after (63 / 108 / 120 to 54 / 105 / 124); the Tor swap alone 24 / 64 / 62 to 21 / 58 / 62 (seeds 1 to
72). An Osa gap of 4 s gave 32 / 119 / 126 over 144 (the scripted S-400 stronger by 16), so 3 s, the
low end of the source's 3 to 5 s.

The gun fire-control rework (the exact lead, the channel's own track, firing on the lead) was measured
on one copy of the tree with and without it, seeds 1 to 144 (all auto / scripted area player / with the
point defense pair): default 29 / 111 / 106 to 19 / 114 / 122 (seeds 1 to 72: 22 / 55 / 50 to
12 / 60 / 63), all alternatives 53 / 95 / 98 to 55 / 101 / 115 (30 / 48 / 50 to 34 / 50 / 58). With a
working lead the guns kill fast and crossing targets they used to miss (gun kills per game, all auto:
13.9 to 12.9 default, 20.7 to 23.7 alternatives; the scripted pair 10.2 to 13.8 and 12.5 to 16.1), so
the game values were re-tuned: shell damage 0.22 to 0.15 (30 mm) and 0.2 to 0.14 (23 mm), dispersion
3 to 5 mrad, the Pantsir's guns twice that (`gun.spread` 2: the Tunguska keeps the tighter guns, its
place as "guns first"), the crew lets the fire control settle 4 s on a new target (the Shilka 2.5 s,
`gun.settle`) before it opens fire, and the difficulty scales gun damage as it scales the missiles' hit
chances. Wider dispersion and less damage barely move the outcome (the guns kill what comes close
anyway; dispersion 6 mrad or a third of the damage changed gun kills by about one per game); the settle
time is what keeps the all-auto crews from gaining. The scripted pair, which fires the guns itself on
the lead, gains about 8 games in 72 in both loadouts and no gun value tried took that back short of
breaking the guns again. On Hard (seeds 1 to 24) the default gives 0 and 5 (was 0 and 0).

In those passes every swap kept the scripted players within about 15 points of the default over 72
seeds (the weakest, a Tunguska as the battalion's cover: -11 and -15, because the Pantsir's 57E6 picks
off some of the ballistic missiles aimed at the S-400 and the 9M311 cannot; at the airbase the
Tunguska does better than the Pantsir) and the all-auto crews lose most games (at most 24 of 72, with every
alternative). On Hard the default still gave 0 and 2 of 24. Kills per game by the alternatives, all
on auto, 12 seeds: Buk cruise missiles 15, drones 9, ARMs 7, decoys 5, glide bombs 5, fighters 1.5;
Tunguska at the airbase drones 19 + 11 with the guns, cruise missiles 11 + 2.5, helicopters 4, ATGMs
2, and as battalion cover cruise missiles 6, ARMs 2 + 3.5 with the guns; Tor drones 25, cruise
missiles 6, ARMs 1.3, helicopters 1.1 (the Osa: drones 17, cruise missiles 3); Shilka drones 5, cruise
missiles 1.8, ARMs 1.6, ATGMs 1.4 (the helicopters stood off 6.5 km from their targets then, 5.5 km
since the final pass, out of its reach as out of the Strela's; the Strela: drones 12).

**Capabilities instead of kind checks.** `SYSTEMS` entries carry the flags the code asks (comment at
the top of `systems.js`): `area`, `fc` ('search' | 'track' | 'sight' | 'telar'), `missileFc`,
`eoFallback`, `uplink`, `vertical`, `erectors`, `armFirst`, `restEl`, `salvo`, `dispersed`, `racks`,
`cradle`, `giveUp`, `launchY`, `minEl`, `track.sector`, `eo.vis`, `gun.shell`, `gun.side`, `gun.height`,
`gun.spread`; `PART_ROLE` gives each vehicle kind its role and `CLS_TYPE` maps a track class to the hit
table. Missiles add `loft`. A new kind is a new `SYSTEMS` entry plus its vehicles in `deploy.js`.

**Next launcher.** `sim.nextLauncher(unitOrId, type = selected)` (and `FireUnits.nextLauncher(u, type,
engagement)`) returns `{ part, slot }`: the vehicle and slot the next round leaves from, slot -1 when
none is ready there (the vehicle that fires after the next reload), null for a unit without that
missile. `launch()` uses it; main's `launcherFor` uses it so the camera rides the vehicle that fires
next on every multi-launcher unit (S-400: TEL 2 for the 9M96, TELs 1 then 0 for the 48N6; Buk: the
TELAR that takes the next target, or the loader-launcher once that TELAR is empty). Slots: stacked
racks (every kind but the Buk) fire from the highest loaded slot down; a Buk vehicle fires from slot 0
up (the models' launch order) and the loader-launcher's slots 4 to 7 show up to `cradle` (4) rounds of
the reserve on its rack.

**Gun fire control** (Pantsir, Tunguska, Shilka; `units.js` `guns`, `fireGuns`, `ballistics.js`
`solveLead`): the gun target (the crew's pick in auto, the selection in manual) is held by the guns'
channel, the tracking radar (switched on for it unless the player silenced it) or the EO sight
(`trackSource`, the Shilka's fallback); `gun.locked` while it holds it. Only then is there a lead
(`gun.aim`, `gun.aimOk`, `gun.tof`), worked out from that channel's own fresh measurement (never a link
track or a search track coasting between sweeps): its velocity smoothed over 0.25 s, brought up to date
by its rate of change (0.6 s), and that rate of change (smoothed over 0.5 s, at most 25 m/s2) bending
the lead, so a turning, diving or speeding target is led too. `solveLead` takes the closed form
(`leadPoint`, the gravity drop under drag, `dropAt`, about two thirds of the vacuum drop at 2 km) and
flies a shell through the game's own integrator in the sim's order (as maxgfx's `solveLead`),
correcting the aim by its miss until it passes within 0.3 m; no lead where the shells cannot get
(their reach, about 2.2 km for the 30 mm and 2.0 km for the 23 mm, or a target they cannot catch).
The turret lays the guns, from their mount, on the lead continuously, before, during and between
bursts (on the target itself while there is no lead, to bring it into the channel); `gun.laid` while
the guns have the turret. The shells leave after the turret has moved in the same step, along the
bore with the shell's `spread` (5 mrad, the Pantsir's twice that), a hit doing the shell's `dmg` times
`gun.dmg` and the difficulty's `hit`. The AI opens fire once the channel has held the target for
`gun.settle` s (4, the Tunguska 3, the Shilka 2.5) and fires its bursts only while the bore is within 4 m of the lead at
its range (0.14 to 1.1 degrees), stopping when it is not. `gun.hold` says why the guns cannot fire
on their target ('no lock', 'out of reach', 'target lost', 'turret on the missile target'; null when
they can): the console's status line shows it while the player wants the guns, and a manual trigger
is held, with a radio line, while the missile channel keeps the turret off the gun target (otherwise
the player fires wherever the guns point). Releasing the trigger stops the fire and moves nothing; when
the target dies or its track drops the turret goes on to the next target or holds where it is.

**Turret priority** (every turret unit): the missile channel comes first. A round leaves only with
the launcher on its target (within about 1 degree), and while a command-guided round flies the turret
keeps its target in the channel: the guns get the turret only for a target inside the channel's
sector around the missiles' aim (80 % of `track.sector`, the Pantsir's array +-45 degrees, or of
`eo.free` when an optical sight guides the missiles, the Tunguska's +-45), only with a lead inside
their reach, and never while a round is about to leave (`gunsMay`, measured from the missiles' aim or
the designation, `turretBase`, not from the bore); the AI picks and keeps gun targets by the same rule,
so it never holds one the turret cannot take, and does not start a missile engagement outside the
sector while its guns work a target. Two Pantsir channels sit in the middle of their
targets (`track.sector`, as the Tor). An EO sight (`u.sight` on the Pantsir, Tunguska, Shilka) has its
own drive within `eo.free` of the bore (Pantsir +-90 degrees): it follows the missile channel's target
first, then the gun target, the bore when there is neither, and a manual slew overrides it for 3 s (the
turret follows a slewed sight only when nothing else holds it). The EO channel holds only what is in the
sight's field of view, so it holds one target (`channelCount` 1 while the missiles fly on it). Tracks a
channel starts are measured at once and nothing aims or launches at an unmeasured track
(`trackOf(u, id)`: the own track once measured, else the linked one). The Osa's tracking antenna
(`turret.trackEl`) elevates on its own and follows the target only while its radar emits; its launcher
panels stay between `minEl` and `maxEl` (31.5 to 34 degrees; the round climbs and dives onto low
targets). A Buk TELAR follows its target only while its radar emits. The Strela's sight looks along the
launcher: the seeker locks only on what the launcher points at, FIRE needs the launcher on the target,
then it swings to a small lead (a couple of degrees ahead, and up below 20 degrees elevation) and the
round leaves 0.5 to 1.1 s later (`unit.fire` while pending); after a launch the AI crew takes the next
target nobody has a round on.

**Designation** (`select`): the selected track is handed to the unit's tracking channel, as an operator
hands a target from the search picture to the tracking radar, and is the top priority in every mode
(in auto the crew may engage it by its own rules, taking it first and without its reaction delay; in
manual only the player fires; in hold nothing fires but the channel still takes it). `unit.desig =
{ id, state, part }`, state: `null` (nothing selected or the track is gone), `'held'` (a free channel
has it: the turret is laid on it and the channel locks once it sees it), `'engaged'` (an engagement's
channel holds it), `'queued'` (every channel guides a missile, or the target is outside the sector
around a busy turret: it waits, "channel busy, designation queued" on the radio, and is taken up when a
channel frees, "designated target taken up"), `'laying'` (the radar the channel needs is off because
the player switched it off: only the turret is laid, "radar off, laying on the designation only").
The radar the channel needs (S-400 search radar, the tracking radar, a Buk TELAR's radar; none for an
EO channel or the Strela) is switched on unless the player switched it off (`unit.silent.search`,
`unit.silent.track`, a Buk TELAR's `part.silent`, set by the `radar` and `track` commands). Per unit:
the S-400 takes it on a free channel (the 92N6E render turns to it when it is outside the sector it
holds); a Buk gives it to `unit.firePart` (it waits while that TELAR guides) or the best free TELAR
with line of sight (`desig.part`), which turns and locks, and `engage` then fires from that TELAR; the
Pantsir, Tunguska, Osa and Tor lay the turret (and the Osa its antenna), a Pantsir or Tor with a busy
channel sits between its engagements and the designation; the guns of the Pantsir, Tunguska and
Shilka are laid on its lead inside their reach (in auto when it is a target they would take); the
Strela lays its launcher and sight on it and uncages the seeker once they are on it (once per
designation: U still cages), the lock following the seeker's rules. `unit.channel` lists the
designation first while a channel holds it, so the consoles' lamps show its lock.

**What the render layer binds** for the new vehicle kinds (rigs in `models/v/`, see the Models
changelog entries for their pivots):

| Part kind | Sim state to show |
|---|---|
| `buk-telar` | `turret.rotation.y = part.turret.az`, `elevation.rotation.x = part.turret.el` (the sim keeps it at or above `minEl` 0.3 while in action); `part.track` its radar emitting; `part.target`/`locked` its channel; slots 0 to 3 from `part.slots` (0 leaves first); `part.alive` false: wreck this vehicle only |
| `buk-loader` | the same turret and elevation (it turns to the target it fires at next); slots 0 to 3 the launcher, 4 to 7 the rack; while it reloads, its drive, crane, rack slots and launcher elevation are the reload scene's (`render/reload/buk.js`) |
| `buk-radar` | `searchRadar.rotation.y = -radar.sweep - part.heading` while `radar.search` and `part.alive`; `setDeploy(1)` in battle |
| `buk-cp` | nothing moves; `part.alive` |
| `tor` | `turret.rotation.y = turret.az`; `trackRadar` tilt from `turret.el`; `searchRadar` spin from `radar.sweep` (relative to the turret if it sits on it: `-sweep - heading - turret.az`); cells 0 to 7 from `slots`, the round leaves from `missile.slot` straight up (open that hatch), cold: `ignite` comes 0.9 s later |
| `tunguska` | `turret`, `elevation` (guns) from `turret.az/el`; the new `launcher` pivot: `turret.el` while a missile engagement is aligning, launching or flying, else level (the sim lays one elevation for both); `trackRadar` tilt `turret.el`; `searchRadar` spin from the sweep; four `muzzles` (`gun` events); `sight` anchor for the EO picture (`sight.az/el`); slots 0 to 7 (highest leaves first) |
| `shilka` | `turret`, `elevation` from `turret.az/el`; its one radar: `trackRadar`/`trackRadarNod` face the gun's aim while `radar.track` (or `gun.aimOk`), spin with `radar.sweep` while only `radar.search`; four `muzzles`; `sight` anchor |
| `osa` | `turret`, `elevation` (the launcher panels) from `turret.az/el`; `trackRadar` (the tracking antenna head, its own pivot now) tilt `turret.trackEl` (done in `UnitViews.update`'s generic branch) |
| `pantsir` | `turret`, `elevation` from `turret.az/el`; the new `eo` pivot (the EO window, order YXZ): `rotation.y = wrapPi(-sight.az - heading - turret.az)`, `rotation.x = sight.el - turret.el`; the `sight` anchor rides on it (done in the generic branch) |

Other owners, for the new kinds: main's `MSIZE` and `COLD` tables need '9M317', '9M338' (cold, so
`fx.coldLaunch` and an `ignite`), '9M311'; `detonate` with kind '23mm' is a shell hit like '30mm'; the
`launch` handler's camera hold checks `u.kind === 's400'` (any unit with several vehicles now); audio
needs launch sounds for the three missiles and may give the Shilka its own gun voice; consoles for
`buk`, `tunguska`, `tor`, `shilka` (sight canvases for the Tunguska and Shilka).

### Reload scenes (`src/sim/units.js` jobs, `src/render/reload.js`, `src/render/reload/<kind>.js`)

What the player sees while a launcher is reloaded: the reload vehicles drive up from behind the unit,
the launcher takes its loading pose, the crew gets out and the rounds go over one by one (or a pair at a
time) until the sim counts them; then everything goes back. The research behind each system is in
`refs/reload/README.md` (and the reload sections of `refs/buk`, `refs/tor`, `refs/tunguska`,
`refs/shilka`).

**Sim: a reload is a job on one vehicle.** `unit.reloads` lists the jobs in progress (one per missile
type at most; `stock.job` points at its type's, null when idle):

```js
{ id,      // unique, increasing (a new job on the same vehicle is a new id)
  type,    // missile type ('48N6', '9M96', '57E6', ...)
  part,    // the vehicle loaded (index into unit.parts; 0 for one-vehicle units)
  from,    // the vehicle whose crane works (the same, or a Buk's loader-launcher)
  slots,   // the slots that get rounds, in the order they fill (rig slot indices)
  n,       // rounds the job adds at the end (the sim's count; clamped to the reserve then)
  t, dur } // seconds elapsed (sim time: time compression plays it faster) and until the rounds count
```

- Who loads: `reload` reloads the selected type's emptiest vehicle (the S-400's emptiest TEL of that
  type, a Buk's emptiest TELAR as before, a one-vehicle unit its launcher). The AI crews: an empty
  launcher vehicle at once (so an S-400 TEL reloads while the other fights on); in a raid, one down to
  its `keep` rounds only while nothing worth a missile is near (`busyNear`: no non-drone target inside
  its missile's reach and no round in the air); between raids a one-vehicle launcher tops up, an S-400
  TEL only when at most half full (`crewReload`).
- How long: `SYSTEMS[kind].reload` is the time until the vehicle is back in action. With `reloadMin` a
  partial load takes its share of it by the rounds it adds, never less than `reloadMin` (Pantsir,
  Tunguska, Osa, Tor: 40 s, so a truck scene always fits); without, every job takes the full time
  (S-400, Strela, Buk; a Buk job adds the loader-launcher's drive to the TELAR, `reloadDrive`). The S-400 TEL lowers its stack inside the job (`reloadPose.erect`, 8 s) and
  raises it after at the battle-start rate (16, 19, 22 s for TELs 0, 1, 2), so its job is `reload` minus
  that and the TEL is back in action after `reload` (90 s).
- While a job runs that vehicle does not launch: on stacked racks (every kind but the Buk) its rounds
  are held (`stock.held`, out of `ready`; consoles may show `ready + held` as on the launcher), a Buk's
  as before through `canFire`. `stock.reload` is still the seconds left (the consoles' bar).
- Loading poses: `SYSTEMS[kind].reloadPose` is `{ erect, time }` (the S-400: the TEL's `u.erect[part]`
  goes to `erect` in `time` s, back up after) or `{ az, el }` for a turret: `FireUnits.reloadPose(u, dt,
  part, turret)` lays the turret of the vehicle being loaded, or whose crane works, there at its slew
  rates and nothing else moves it (aimTurret and aimLaunchers ask it first); `reloadPose.crane`, when
  given, is the pose of the vehicle whose crane works for another (the Buk's loader-launcher; without
  `el` its elevation is left alone). The per-system agents add
  their `{ az, el }` from the research (Pantsir about 90 degrees to a side; Osa toward the transloader,
  panels down; Tor lids to the rear; Tunguska front to the 2F77M; the Pantsir and the Tunguska with `guns: true`: their guns may take the turret). Guns are not blocked by a job.
- The S-400's TELs keep their own rounds (`parts[i].rounds`, as the Buk's): the next round leaves the
  last TEL in rack order with rounds that is raised and not being reloaded (`firingVehicle`,
  `nextLauncher`); `ready` is the sum over the TELs not being reloaded.
- The sim's count is authoritative: the rounds appear in `part.slots`/`part.rounds` only at `dur`. A
  scene shows each round on the launcher as it places it and hands back to the rig then (UnitViews'
  `setLoaded`, main's `syncCovers` for the S-400 covers agree with it at that moment).

**Render: the scene API.** `UnitViews` owns a `ReloadScenes` (`src/render/reload.js`): it builds the
scenes with the rigs (so main's `patchSceneFog` patches their materials, also after a loadout change),
resets them with a new battle and drives them after the rigs every frame. A unit kind has a scene when
`RELOAD_SCENES` (top of reload.js) has an entry: one import and one line. The scene module
(`src/render/reload/<kind>.js`, default export):

```js
create(ctx)                        // build the unit's pooled props into ctx.group (vehicles from
                                   // buildVehicle, Crewman figures, loads); hide them; return a state
start(ctx, state, job)             // a job began: plan it, return a play (or null to show nothing)
update(ctx, state, play, t, job)   // pose everything for scene time t (s since the job began); job is
                                   // null once the sim has counted (t runs on, the outro); return false
                                   // when done (the play is dropped)
stop(ctx, state, play)             // cut short (the unit or vehicle knocked out, a new battle):
                                   // put the props away and restore anything hidden on the rigs
idle(ctx, state, dt)               // optional, every frame after the plays
reset(ctx, state)                  // optional, new battle, same rigs
dispose(ctx, state)                // optional; ctx.group and its geometry go anyway
```

`ctx`: `unit` (the live sim unit), `rig(i)` (UnitViews' rig of vehicle i), `loaded(i)` (UnitViews' copy
of its slots as the sim last set them), `group`, `ground` (`heightAt`), `frame(i, out)` (Matrix4),
`partFrame(i)` (a `Frame`). The kit exported by reload.js: `Frame` (a vehicle's local x, z, heading to
world and back), `Lane` (a polyline drive path in a Frame with arc-length `at(s, out)` and
`curvature`), `placeOnGround(root, x, z, heading, frontAxleZ, rearAxleZ, halfTrack)` (height, pitch and
roll from the terrain under the axles), `Timeline` (named steps, some fixed, stretched to fit between
two times; `k(name, t)`, `at(name)`, `step(t)`), `Crewman` (crew.js `buildCrewman`, pattern 'mm14' by
default: `at(x, z, heading, pose, t, y)`, `walk(a, b, k)` with the gait following the distance, `hide()`,
`Crewman.facing`), `ramp`, `smooth`, `ease`, `worldOf`. Reload vehicles are rigs with
`setWheels(roll, steer)` (wheels as `spinWheels` instanced meshes, see `models/v/t22t6.js`), `doorL/R`
pivots and whatever the job needs; register them in `models/vehicles.js` and give them `MARKINGS`.

Rules: build everything in `create` (no allocation per frame, no lights, figures built later need
`patchCrewMaterial(patchMaterial)`); make `update` a function of `t` and the plan made in `start` (time
compression, dropped frames and `fastForward` then all land on the same picture); place each round on
the launcher as it arrives from `job.slots` and let the rig show the sim's state from `dur` on; restore
whatever you hid on a rig in `stop` and `reset`; keep the props out of the vehicles' way (lanes,
outriggers, the launcher's own moving parts).

**The S-400 scene** (`render/reload/s400.js`, refs/reload section 1, photos `s400_22t6_*`,
`s400_airdefexercise2017_*`): one set of props per TEL (a `22t6` transporter-loader, a `5t58`
transporter with four spare canisters, four crew, eight canisters), hidden while idle. In the TEL's
frame the 22T6 stands 4.6 m to its left with its rear face 0.4 m behind the TEL's tail, the 5T58 beyond
it (9.6 m), both driving straight up their lanes from 70 m behind. Time line (stretched to the job):
arrive 14 s (the TEL lowers meanwhile), brakes, outriggers down 3 s, the crane unfolds and works,
folds; the crew climbs back in 3.2 s; outriggers up 3 s; the sim counts; the trucks back out 17 s while
the stack rises. The crane lifts the spent canisters off the TEL a pair at a time (upper row first, both
rows when the lower is to be filled) over the TEL onto the ground on its far side, then the fresh ones
from the transporter's upper layer first onto the TEL's lower row first, turning them end for end on
the way (bases forward on the transporter, aft on the TEL), covers on. The 9M96 packs go the same way.
While a scene runs the TEL's own canister meshes are hidden and the scene's identical ones (t5t58.js
builds the canister of tel.js) stand in, so each can move; where a short reload leaves a cradle empty
the stand-ins stay. Crew: the crane operator with his control box behind the 22T6 ('operate', facing
the load), a guide at the TEL's tail ('signal', 'reachUp' as a pair comes down on the lower row), one
at the transporter's tail ('signal' as it is unloaded), one on the far side ('reachUp' as the spent ones
come down). The spent canisters lie on the ground until the TEL's next reload.

**The Buk scene** (`render/reload/buk.js`, refs/buk section E, a reconstruction: no photo of a Buk
reload exists). The battery's own loader-launcher rig is moved (UnitViews places it; the scene puts it
back where the sim has it). Loading a TELAR (sim: its launcher to the rear, level, `reloadPose`; the
loader-launcher's turret to the rear, `reloadPose.crane`): the loader-launcher drives from wherever it
is (a turn-straight-turn path clear of the other vehicles, 15 m/s, the last 14 m straight and slow)
to park on the TELAR's right, 0.6 m between the aprons, its crane post level with the middle of the
TELAR's rounds, both launchers pointing the same way; it raises its own launcher clear of its rack
(the scene overrides the elevation, the sim leaves it alone); three 'mm14' crew get out (the crane
operator up through the deck by the control box, its third man down its side and out ahead of the two
vehicles, signalling, one of the TELAR's crew up the TELAR's rear plate onto the engine deck behind
the noses); the crane unfolds and takes the rack rounds (the TELAR's side first) one at a time onto
the TELAR's empty rails in `job.slots` order, each level on the lifting beam and parallel to the
hulls; the swing goes round the rear (its raised launcher is in front), and a round from the far side
of the crane post passes the boom's line far out (3.4 m) where the boom stands clear of it; the jib's
telescope (`craneExt`, reconstructed) reaches the far rail. The crane folds, the launcher comes down,
the crew get in and the loader-launcher pulls 6.5 m ahead, clear of the TELAR's launcher when it turns,
all inside the job; after it, it drives home. The work is what the job leaves after the drive (about
4 s a round for TELAR 1 from its spot, 6 s for TELAR 2). Loading its own rails it works where it
stands, launcher level (`reloadPose`), matching rack rounds to rails so none comes up under a loaded
rail. Rounds in transit and on the TELAR
until the sim counts them are one `InstancedMesh` of four 9M317; the lifted rack slots stay hidden until
it is home (the rack then shows the reserve again). A stop (TELAR or loader knocked out) puts the crane
in travel at once and drives the loader-launcher home in `idle` (a wreck is put back at once); a new
job takes over from wherever it is.

**The Osa scene** (`render/reload/osa.js`, refs/reload section 3, photos `osa_9t217_*`): one 9T217
transloader (t9t217.js), three crew and four stand-in blocks of three containers per unit. In the Osa's
frame the 9T217 stops 5.4 m to its right, its crane pedestal level with the turret ring, driving straight
up its lane from 60 m behind (12 s); ntw_9_93 shows the launcher on the transloader's left. The sim lays
the turret at `reloadPose` { az: PI / 2, el: 0, free: 5 }: panels level, their rear ends (where the
containers are loaded) toward the transloader, and in the job's last 5 s back to where it was when the
job began (`free`, a new optional field of `reloadPose`, kept on the job as `az0`, `el0`: the Osa's slow
turret faces the threat axis again when its rounds count; the crane's last lift is done before then). The
search antenna, spun by UnitViews, is run down to a stop over 2 s
and turned to face forward (out of the crane's way), and after the job it catches up with the sweep again
(the offset frozen at the end of the job, faded out over 2.2 s). Time line (the crane's work stretched to
the job): arrive 12 s, brake, the tilt opens 3 s (its left half swings over and down the outside of the
wall, the right half is raised and leans out over its wall, ntw_9_93), the lifts, back over the bay 2.5 s;
the rounds count; the spreader settles into the bay, the roof shuts, the 9T217 backs out (15 s) once its
marshal is back in.
For each panel with a slot in `job.slots` the spent block (with any rounds still in it) comes off onto
the bay's right stack, lower place first, then a fresh block from the left stack, upper first, goes on;
the rotator turns each block from its heading on the panel to the bay's (tails forward) on the way, and
the carries pass under the Osa's stopped search antenna; a fresh block not needed stays in the bay. The
launcher's own blocks and covers for the panels that change (`rig.blocks`, `rig.lids`) are hidden while
the stand-ins (osa.js `osaBlockParts`, the launcher's cover meshes shared) work, and shown again at
`dur`. Crew: the crane
operator with his control box on the bay floor right of the pedestal ('operate'), a man standing in the
right cab hatch ('signal' while a block moves), one who climbs out of the left hatch and down the side
to marshal between the vehicles ('signal'). Reconstructed: the launcher pose, the crane, the bay's
stowage, the whole tilt opening (ntw_9_93 shows only its front part open).

**The Tor scene** (`render/reload/tor.js`, refs/tor section 7, photos `tor_m2_06`, `tor_9t244_*`): one
9T244 (t9t244.js), two crew, eight stand-in containers (instanced). The Ural reverses up the Tor's centre
line from 32 m ahead until its tail is 0.35 m from the Tor's nose (11 s) and puts its rear stabilizers
down; the sim lays the turret at `reloadPose` { az: PI, el: 1.31 }: turned round as for the march, the
tracking antenna laid back (tor_m2_06). The scene stops the search antenna, turns it to the front and
folds it (`rig.setDeploy`); after the job it unfolds it and hands the spin back to UnitViews by resetting
`rig.spin` to where the antenna stands (as when an emitter comes back on). For each slot in `job.slots`,
in order, the crane takes a container from the bed by its top eye (the container swings up off the bed
about its foot until it hangs, then lifts clear), carries it round over the truck's left side with its
foot above the turret and the folded antenna, and lowers it into the cell; that cell's lid opens as it
comes over and shuts after (`rig.setHatch`). The containers stand in the cells until the rig shows the
rounds' caps at `dur`. Time line: arrive 11 s, brake, stabilizers 2.2 s, the lifts (stretched, but the last
container is let go about 9 s before `dur`, so the crewman is off the turret and the hull when the turret
is free), the crane back over the truck; then the crane folds, the stabilizers come up, the operator gets
back in and the truck drives off forward (13 s). Crew: the crane operator out of the left door to
the truck's left rear with his control box ('operate'), and a Tor crewman who comes round from behind the
Tor, climbs its side onto the turret roof, steadies each container into its cell from the other row
(his hands on it with crew.js `reach`) and is down again before `dur` (the last step is stretched for it). Reconstructed: the cell order, the lids opening one at a time,
the crewman's way up, the containers lying on the bed (none is seen loaded in the photos).

### UI (`src/ui/`, UI agent)

```js
import { Panel } from './ui/panel.js';
const panel = new Panel(document.getElementById('panel'), {
  onSelect(unitId),               // unit tabs
  onCommand(unitId, name, args),  // forwarded to sim.command
});
panel.update(dt, { time, units, picture, selectedId, state, wave, score, assets });
panel.sightCanvas(unitId)        // HTMLCanvasElement (fixed size, e.g. 640x400) the integration draws
                                 // the EO/IR sight image into, or null for units without a sight;
                                 // the console overlays its own reticle on top
```

One console per kind (`s400`, `pantsir`, `osa`, `strela`) mounted when that unit is selected. Look of
a real Soviet-lineage control cabin: olive/grey-green panels, phosphor-green CRT scopes with sweep and
afterglow, amber numeric readouts, guarded switches, illuminated push buttons labelled in Russian with
a small English caption. Scopes drawn with canvas 2D. S-400: PPI with range rings, track table (class,
range, alt, speed, TTI), missile type, launcher status, emission switch, assign and launch. Pantsir:
search PPI, tracking radar/EO view (sight canvas), missile/gun selector, auto/manual, trigger. Osa: PPI,
tracking radar acquisition, salvo launch. Strela: the optical/IR sight (sight canvas, drag or arrow keys
to slew), uncage, seeker tone indicator, fire. Every console shows unit health, ammunition, reload and
alerts.

Keys: the panel owns Tab / Shift+Tab (track), Space (engage/fire; hold for Pantsir guns), R (search
radar), T (tracking radar), G (gun/missile), U (uncage), A (mode), arrows (slew), Q (missile type),
L (reload). Main owns 1 to 5 (unit), C (camera mode), F3, H, M, Esc, `[` and `]` (time compression).
Ignore keys while an input element has focus.

### Audio (`src/audio.js`, audio agent)

```js
const audio = new AudioEngine();
audio.start();                        // on the first user gesture
audio.update(dt, camera, { threats, timeScale });   // engine loops for nearby threats, listener
audio.launch(kind, pos);              // '48N6' cold launch thump + motor, '9M96', '57E6', '9M33', '9M37', '9M317' (Buk, hot), '9M338' (Tor, cold vertical, motor lights 0.9 s after the thump), '9M311' (Tunguska, short booster)
audio.gun(unitId, on, pos, shell);    // continuous while on; shell = weapons.gun.shell: '30mm' (default), '23mm' (Shilka), '30mm-tunguska' (slower, deeper)
audio.explosion(pos, size); audio.airburst(pos); audio.impact(pos, size);
audio.seeker(level, locked);          // Strela seeker tone (0 = silent)
audio.ui(name);                       // 'click' | 'switch' | 'button' | 'alarm' | 'warning' | 'lock'
audio.setVolume(v); audio.setMusicVolume(v); audio.toggleMute();
```

Reuse the maxgfx engine core (distance delay, air absorption, voice stealing, reverb, recordings in
`public/audio` with `CREDITS.md`).

## Changelog

- (agents: note any contract change here, one line each)
- UI: conventions the panel assumes (please match in sim): `unit.pos` is `{x,y,z}`; `track.bearing` is compass degrees, `range`/`alt` metres, `speed` m/s, `track.vel` world m/s; `radar.sweep` and `sight.az` are compass radians clockwise from north, `sight.el` radians up, `sight.fov` horizontal radians; `slew` `daz > 0` turns right (clockwise), `del > 0` up.
- UI: optional extra fields the panel reads when present: `weapons.weapon` ('missile' | 'gun', Pantsir selection), `sight.src` ('radar' | 'eo', Pantsir track source), `weapons.missiles` for the S-400 may be a per-type map (`{'48N6': {ready, reserve, max, reload}, ...}`) or the flat record. Ammunition bars use `ready + reserve` against the largest value seen.
- UI: `panel.sightCanvas(id)` returns a 640x400 canvas for Pantsir and Strela units (null otherwise); Panel options also accept `audio` (optional `ui(name)` and `seeker(level, locked)`). Mock harness: `/ui.html?unit=ID`.
- Sim: matches the UI conventions above (`weapons.weapon`, `sight.src`, bearings in degrees on tracks, radians for `sweep`/`sight.az`). `weapons.missiles` is the selected type's flat record; `weapons.stock` is the per-type map, `weapons.types`/`weapons.type` the list and selection.
- Sim: track `cls` adds `'decoy'` (revealed after a long hold) and `'atgm'`. `unit.parts[i].slots` (booleans) say which launcher slots show a round; missiles carry `part` and `slot` for the render layer.
- Sim: extra optional events `spawn(t)`, `removed(t)`, `threatLaunch(t, from)`, `ignite(m)` (48N6/9M96 motor lights after the eject), `shellGround(p, kind)`, `shellExpire(p, kind)`; `detonate(pos, kind, hit, ground)`. Threats have `falling` wrecks until they hit the ground; `spin` drives rotors.
- Sim: `new Sim({ heightAt, los, scene, seed })` (scene: optional, for the 30 mm tracers); call `sim.ballistics.render()` once per rendered frame. Extra command `zoom { wide }` for sights. Between waves a supply column refills reserves and the 30 mm. `node tools/simtest.mjs 1 2 3 --both --quiet` runs headless battles.
- Framework: `src/terrainHeight.js` holds the pure terrain (`heightAt`, `los(ax,ay,az,bx,by,bz,clearance?)`, `normalAt`, `riverCenterZ`, `riverLevel`, `padMask`; no three, safe in Node); `src/terrain.js` re-exports them and adds `Terrain`. `terrain.update(camera)` takes an optional second arg `true` to rebuild every level at once. `ChaseCamera(camera, dom, { ground })` also needs `chase.update(dt)` each frame; extras: `free(on)`, `autoOrbit`, `focus`.
- Framework: fx additions `launchBlast(p, dir, size)`, `motorPlume(p, vel, k)` (call every frame per missile with motor on), `dust(p, size)`, `airburst(p, size)`, `wreck(p, vel)`, `setBudget(b)`; set `fx.ground = terrain.heightAt`. `fx.flak`/`fx.splash` (naval) are gone. HUD API: `setLoading, ready, showTitle, setUnit(name, callsign), setScore, setTimeScale(k), toast(msg, sub, ms), hint, radio(text, kind), kill(text, pts, assist), updateCompass(camera, markers), bracket(camera, point|null, label), showEnd(report, { onRestart }), hideEnd, debug`. `window.__iads` also exposes `onFrame` (push `(dt, rawDt, t)` callbacks), `events` (`start(difficulty)`, `select(unitId, index)`), `select(i)`, `start()`, `eyes`, `unitRoots`, `clouds`, `weather`.
- Models: spinning parts may use `spin: 'x'` (the helicopter tail rotor); `buildThreat`/`buildInterceptor` results are cached and shared, do not dispose them.
- Audio: extra `crack(pos)`, `vehicle(kind)` (selected unit's idle and cabin hum), `mood(state)` (score in briefing and lulls); `new AudioEngine({ context })` accepts an OfflineAudioContext. `bankTasks(sampleRate, make)` is exported for offline checks (`tools/audiotest.mjs`).
- Integration: done in `src/main.js` with `src/render/units.js`, `src/render/entities.js` and `src/sight.js`; `__iads.fastForward(seconds, { unit, scale })` for headless captures. Main also owns V (padlock the selected track) and M (mute).
- Keys: main owns F, which chases the selected unit's newest missile in flight (`ChaseCamera.follow`); F again, a unit key or C returns to the unit, and F with no missile in flight shows a hint.
- Framework: `ChaseCamera.follow(obj, onEnd)` chases a flyer `{ pos, vel, alive }` from behind and above and calls `onEnd` after it has been gone for 2.4 s (`follow(null)` releases); `ChaseCamera.cine(on)` is the title screen's slow drifting orbit.
- Framework: fx `coldLaunch(p, dir, size)` (canister gas puff, no flame) and `ignition(p, dir, size)` (motor lighting) for the S-400 rounds; `burnSite(p, size, life)` for persistent ground fires (at most 8 kept); smoke sheared by wind with height; motor plumes and trails scale with camera distance.
- Render: `entities.plain(on)` switches the flyers to the unscaled instance set (used by the sight renders); `sight.update(rawDt, unit, pos, canvas, mono, entities)` takes `entities` as an optional sixth argument.
- Sim: `unit.channel = { locked, targetId }` is set every step in `units.js` `describe()` (the gun target first, then an engagement's, then the Strela seeker's, whichever `channelSees` holds) and cleared when the unit is destroyed; the consoles' `channelLock` reads it.
- Sim: `levelToward(pos, x, z, alt, out, slope, reach)` takes `reach` (m) over which a height error is taken out; terrain following passes a short fixed reach, 0 keeps the default of a quarter of the way to the target.
- Sim: `DIFFICULTY[name].air` scales the size of fighter and ballistic missile groups (`director.js`).
- Sim: `SYSTEMS` crew fields `tempo` (s between engagement starts), `close` (m, the range inside which the crew takes slow tracks, drones and helicopters, itself), `keep` (missiles held back from drones); `gun.range` is the Pantsir AI's opening range for its guns.
- Sim: `ballistics.fire(kind, pos, dir, owner, unit, { dmg, rng })`; the sim passes its seeded `sim.rng`, so battles are deterministic per seed.
- Sim: the 9M96 and 9M37 are not command-guided: when their unit loses the track they fly on and home on their own seekers, and no longer self-destruct. Command-guided missiles (48N6, 57E6, 9M33) still lose guidance without the channel and self-destruct after 3 s.
- Tutorials: `sim.newGame({ scripted: true })` is a tutorial range: the director spawns nothing, nothing is damaged (`applyWarhead` returns null), interceptors hit reliably (`difficulty.hit` x2.5), S-400 launchers start erected and nothing is scored; `src/tutorial.js` places threats with `threatAI.spawnOne` / `launchWeapon`. Console elements carry `data-tut="name"` and `src/ui/highlight.js` (`setHighlight(names)`, `tut(el, name)`) pulses them; the Panel re-applies the current names after mounting a console.
- Models: vehicles rebuilt from reference photos, one builder per file in `src/models/v/` (`tel.js`, `radar92n6.js`, `search91n6.js`, `cp55k6.js`, `pantsir.js`, `osa.js`, `strela.js`) wired through `vehicles.js`; each builder still returns a `newRig` rig with the same pivots and anchors. `models/s400.js` and `models/shortrange.js` are no longer imported.
- Sim: `aimTurret` in `units.js` holds the Osa's launcher panels raised (`turret.el` toward 0.55 rad) when it has nothing to engage, as the real vehicle stands ready.
- Models: `src/models/markings.js` paints the national markings (the emblem of the Armed Forces of Ukraine, a small flag) as decal planes with one shared canvas material; `MARKINGS[kind]` is the placement table (`pivot`, `pos`, `face`, `size`; `pair()` mirrors a hull side) and `applyMarkings(rig, kind)` is called by `buildVehicle`. A new vehicle kind gets its own entry (measured on the built model, see refs/markings/README.md); no entry means no markings.
- Models: `src/models/v/crew.js` is the crew figure for the reload scenes (Russian AD soldier, 1.78 m, one rigidly skinned `SkinnedMesh` of 3.4k to 4.1k triangles, one shared material): `buildCrewman({ headgear: 'cap'|'helmet'|'hardhat'|'none', vest: 'none'|'webbing'|'hiviz', pattern: 'emr'|'olive'|'mm14', gloves, skin, grip, height })` returns `{ root, mesh, bones, anchors: { handL, handR, carry }, pose(name, t, blend), reach(side, point, blend, fingers, palm, pole), dispose() }`; `CREW_POSES` (stand, walk, carry, carryWalk, carryShoulder, crouch, reachUp, push, climb, signal, operate; IK hands and feet, cheap and allocation-free per call), `CREW_GAITS` (stride/rise per cycle), `buildCrew(n, opts)`, `CREW_OUTFITS`; figures built after `patchSceneFog` need `patchCrewMaterial(patchMaterial)` once. Viewer: `/models.html?kind=crew&pose=walk&anim=1` (or `?all=crew&mix=1`).
- Models: `buk-radar` (9S18M1-1 Kupol, `src/models/v/bukradar.js` `buildBukRadar`) and `buk-cp` (9S510, `buildBukCp`, reconstructed from the 9S470M1) on the GM-567M / GM-579 chassis in `src/models/v/gm567.js`. New optional rig method `rig.setDeploy(v)` (0 travel, 1 in action): on `buk-radar` it folds the array back flat over the deck, lowers and telescopes the mast (internal groups; `pivots.searchRadar` carries the housing and the array and should sit at 0 in travel); on `buk-cp` it is a no-op.
- Models: `tor` (9A331M Tor-M2, `src/models/v/tor.js` `buildTor`, on the tracked GM-355 in `src/models/v/gm355.js`). Pivots `turret` (ring at y 2.18, z 0.35; 0 = tracking antenna toward the hull front; the real vehicle marches with it at PI), `trackRadar` (antenna tilt, rotation.x, + = face looks up, same sign as `elevation`; `rig.trackTravel` = 1.31 lies it back for the march) and `searchRadar` (spin on the mast). `rig.setDeploy(v)` folds (0) or raises (1) the search antenna and its mast. Eight vertical cells: `anchors.missileSlots[i]` at the cell tops with -Z pointing up, `rig.hatches[i]` lid Object3Ds (open = `rotation.z` to `hatches[i].userData.open`, or `rig.setHatch(i, t)`), `setLoaded(i)` shows the container end. `buildTorMissile()` exports the 9M331 for flight (threats.js interceptor shape; body colour and fins unconfirmed).
- Models: `tunguska` (2S6M Tunguska-M, `src/models/v/tunguska.js` `buildTunguska`, on the tracked GM-352M in `src/models/v/gm352.js`). Pivots `turret` (ring at y 1.98, z -0.85), `elevation` (both 2A38M guns, trunnions at turret (0, 0.72, 1.1); + raises the muzzles, -0.17 to 1.52 rad), `launcher` (new: both four-round 9M311 launchers on their own axis at turret (0, 0.61, 1.45), + raises the mouths, 0 stowed to about 1.25; the photos show the guns raised with the launchers level), `trackRadar` (the front dish's own tilt, rotation.x, + = face up, 0 level) and `searchRadar` (turntable spin on the rear box). `rig.setDeploy(v)`: 0 folds the search antenna back over the turret rear (travel; keep `searchRadar` at 0), 1 stands it up. Anchors: 4 muzzles (left gun upper, lower, then right), 8 `missileSlots` on the launcher pivot alternating sides; `setLoaded(i, false)` uncovers an empty container. `build9M311()` exports the missile (front -Z, origin at its centre) with the booster as a child Group in `userData.booster` for the drop at burnout.
- Models: `buk-telar` (9A317, `src/models/v/buk.js` `buildBukTelar`) and `buk-loader` (9A316, `buildBukLoader`) on the GM-569 / GM-577 chassis in `src/models/v/gm569.js` (hull built in photo units and scaled by `GM_SCALE`, lengths and heights x 0.85, so the 9M317 rounds are 5.55 m against the camera-matched photos). Both are built in the in-action convention (turret 0 = missiles forward; travel is turret PI). Pivots `turret`, `elevation` (trunnion at the turret's +Z end, + raises the noses, 0 to about 1.2); the loader adds `crane` (slew, rotation.y), `craneBoom` (luff, + up), `craneJib` (rotation.x at the boom tip, travel -2.0) and `craneHoist` (self-levelling, do not set), with `anchors.craneHook` (position.y is the hoist drop, <= -0.6; a missile parented with an identity transform hangs level). `missileSlots` at the missile centres (-Z the nose): TELAR 0 to 3 in launch order, loader 0 to 3 on the launcher and 4 to 7 in the rack; `setLoaded(i)` collapses a hidden round. `rig.setDeploy(v)` moves only the travel lock (0 up to the launcher, 1 folded along the front ledge). `buildMissile9M317()` exports the missile for flight (one mesh, front -Z, origin at its centre); `addMissile9M317(parts, matrix)` adds one to a parts collector. Full pivot table in the header of buk.js.
- Models: `shilka` (ZSU-23-4M4 Shilka-M4, `src/models/v/shilka.js` `buildShilka`, on the tracked GM-575 in `src/models/v/gm575.js`). Pivots `turret` (ring at y 1.55, z -0.1; 0 = guns over the bow), `elevation` (the four 2A7 guns on one cradle, trunnion at turret (0, 0.43, -1.05), + raises the muzzles, -0.07 to 1.48; the well's cover plate follows it), `trackRadar` (the one radar, which searches and tracks: turntable yaw at the turret's rear, rotation.y relative to the turret, 0 = facing over the guns) and new `trackRadarNod` (the dish's elevation, rotation.x, + = face up, about -0.1 to 1.3). `rig.setDeploy(v)`: 0 folds the dish stand back over the turret rear with the dish face up (travel; keep `trackRadar` and `trackRadarNod` at 0), 1 stands it up. Anchors: 4 `muzzles` (left lower, right lower, left upper, right upper), `sight` (periscope on the cupola, follows the elevation), `eye`. The M4's two Igla packs are fixed turret geometry (no missile slots).
- Launch covers (S-400): `s400-tel` rigs have `setPayload('48N6' | '9M96')` (main calls `views.payloads(sim, SYSTEMS)` at init, from `SYSTEMS[kind].racks`), `perSlot` (1, or 4 for a 9M96 pack), `coverOff(slot, tube)`, `setCovers(slot, n)` and `mouth(slot, tube, pos, dir)` (world mouth and axis out of it, returns the cover's `{ size, paint }`), anchors `mouths[slot]` and `tubes[slot][cell]`; `setLoaded(i, loaded)` still works per canister. The 48N6 cover is a matte painted dome, a 9M96 pack a bulkhead with four red cell covers (refs/launch/README.md, "Canister covers"). New `fx.coverBurst(p, dir, size, paint)` throws the cover's pieces (a fixed pool of instanced shards, `maxShards`). `UnitViews.launcher(unitId, part)` returns a vehicle's rig. In `ev.launch` a cold-launched round is moved to its own canister or cell mouth along the canister axis (a visual correction of the sim's spawn point, `launchY` above the vehicle; the sim's flight continues from there), its cover bursts, and the cell of a pack follows from `part.rounds`.
- Sim: loadout. `deploy.js` adds `SLOT_OPTIONS`, `DEFAULT_LOADOUT`, `LOADOUT`, `buildUnits(kinds)`, `setLoadout(kinds)` (changes `UNITS` and `LOADOUT` in place: importers must not cache anything derived from them at import time) and `flatPads()` covers every option; `sim.newGame({ loadout })`, `sim.loadout`. Unit ids belong to the option (defaults unchanged: S400, P1, P2, OSA, STR; alternatives BUK, T1/T2, TOR, SHK); units carry `slot`. See "Loadout".
- Sim: new kinds `buk`, `tunguska`, `tor`, `shilka` (part kinds `buk-telar`, `buk-loader`, `buk-radar`, `buk-cp`, `tunguska`, `tor`, `shilka`), missiles '9M317', '9M338', '9M311' (MISSILES `loft` flag), `SLOTS` for them ('buk-loader' 8: launcher and rack). Kind checks in the sim became `SYSTEMS` capability flags (`area`, `fc`, `missileFc`, `eoFallback`, `uplink`, `vertical`, `erectors`, `armFirst`, `restEl`, `salvo`, `dispersed`, `racks`, `cradle`, `giveUp`, `launchY`, `minEl`, `track.sector`, `eo.vis`, `gun.shell/side/height/drop`), plus `PART_ROLE` and `CLS_TYPE`; the default loadout reproduced the old results exactly before the gun fix below.
- Sim: unit and part fields `slot`, `parts[i].role/alive/rounds` (Buk: `hp/maxHp`, TELAR `turret/track/target/locked`, loader `turret`; `unit.telars`, `unit.loader`), `weapons.missiles` may be null (Shilka), `gun.shell/aim/aimOk`, Buk stock `reloadPart`, alerts 'TELAR DOWN' | 'LOADER DOWN' | 'RADAR DOWN' | 'CP DOWN'. Optional event `partDestroyed(unit, partIndex)`. Threat `target.part`. `sim.area`, `sim.linkUp()` (the link is the area unit's, and needs a Buk's command post vehicle), `sim.visibility` (shortens EO channels by `eo.vis`), `sim.emitting(u, part)` (ARMs keep their aim while the vehicle they were fired at emits), `sim.nextLauncher(unitOrId, type)`.
- Sim: commands: `track { on, part }` and `engage { ..., part }` and `reload { part }` for the Buk's TELARs and loader-launcher; `trigger`, `trackSource`, `slew` also on the Tunguska and Shilka, `weapon` on the Tunguska; `reload` on every unit with missiles; `engage` refuses a track class the missile cannot hit (hit 0: the Osa and the Buk leave ballistic targets alone); `zoom` listed.
- Sim: gun fire control (Pantsir and the new gun units): the held gun target's lead is computed every step and the turret follows it before, during and between bursts, so pressing or releasing the trigger no longer swings the turret by the lead angle; the AI opens a burst once the guns are on the lead; when the target is gone the turret goes on to the next one or holds. The Pantsir's EO sight follows the held target's track, the bore only when there is none (manual slew still overrides). The default balance is unchanged within noise (72 seeds: all-auto 15/72 against 13/72, scripted S-400 57/72 and the full player 63/72, both as before).
- Sim: raids sent at 'radar' aim at the area unit's 'radar' vehicle (S-400: the 92N6 as before; Buk: the search radar's site, also once it is knocked out); radar-seeking missiles pick one emitting vehicle of the area unit (a Buk: the search radar or a TELAR with its radar on).
- Ballistics: `SHELLS['23mm']` (Shilka); per-shell `drop` (the fire control's aim-off for gravity, default 1.1 as before) and `leadPoint(kind, from, pos, vel, out, drop)` for a unit's own fire control (`gun.drop`). The 30 mm's 1.1 over-corrects past about 1.2 km (10 m high at 1.4 km); kept as it is for the default balance.
- Main: `launcherFor` is `sim.nextLauncher(id)?.part ?? 0`, so the camera rides the vehicle that fires next on any multi-launcher unit (the Buk included).
- Tools: `simtest.mjs --loadout s400,pantsir,pantsir,osa,strela` (kinds in slot order, empty entries keep the default, or `default`, or `alt` for every alternative); kill columns per slot labelled by kind; the scripted area player drives the S-400 or the Buk, `--all` also the point defense pair (Pantsirs or Tunguskas); the point defense player triggers on the lead and fires pairs from a one-channel unit; Buk vehicles print as `[t+t+l+r+c+]` (+ standing, x knocked out).
- Audio: launches '9M317', '9M338' (cold: the motor-light delay is inside the sample, `audio.ignite()` is a no-op) and '9M311'; `gun(unitId, on, pos, shell = '30mm')` picks its loop from the shell ('23mm' Shilka at 100 rounds/s in four-barrel ripple, '30mm-tunguska' 73 rounds/s, '30mm' unchanged) and handles any number of units (cap `GUN_VOICES` = 8, farthest dropped); `vehicle()` adds tracked idles for 'buk', 'tor', 'tunguska', 'shilka' (turbine and hydraulics layers). `tools/audiotest.mjs` now also reports rounds/s, envelope timing and spectra; `/audio.html` has buttons for the new sounds.
- UI: consoles for the loadout alternatives `tunguska` (`ui/consoles/tunguska.js`, T1/T2) and `shilka` (`ui/consoles/shilka.js`, SHK), registered in `panel.js` (`MOUNT`, `TYPE_LABEL`, `SIGHT_KINDS`: both get a sight canvas, so main must feed them through `sight.update` with the Pantsir picture, `su.kind === 'pantsir'` there). Both reuse the Pantsir layout and CSS (`con pantsir`). Tunguska: optical sight (guides the 9M311), weapon seg guns / missiles, PAIR / SINGLE salvo (`engage { salvo }`), 8 cells + stowed count, rounds, heat, reload, `trackSource` for the guns, search and gun radar toggles, keys as the Pantsir (Space hold = guns, G, T, R, L). Shilka: gunner's sight with the lead point drawn from `weapons.gun.aim` (new optional `overlay` hook in `SightView`), `trackSource` radar / optical (shows the automatic fall back to optical while the dish is not tracking), rounds, bursts, heat, one-dish scope with its state, `trigger`, `cease`, no missiles or reload. `common.js` gains `inGunRange` and `channelsSee`. `/ui.html?unit=T1|T2|SHK|...` sets the loadout first (`ui/mockloadout.js`) and the mock simulates both.
- UI: consoles for the Buk-M2 (`consoles/buk.js`: search PPI, track table, mode, emission with an all-radars-off button, engage with a firing vehicle choice (best available, TELAR 1, TELAR 2; `engage { part }`), a battery plate with each TELAR's health, radar switch (`track { on, part }`), channel lock, rounds and a per-TELAR reload (`reload { part }`), the loader-launcher's launcher and rack and crane state, the search radar and the command post; keys Q firing vehicle, T all TELAR radars) and the Tor-M2 (`consoles/tor.js`: search PPI with the tracking array's sector laid over it, four tracking channels with lock lamps and phase, the eight cells, `radar`/`track`/`mode`/`engage`/`cease`/`reload`); registered in `panel.js`, styles in `consoles/buk.css` and `tor.css`; `/ui.html?unit=BUK` and `?unit=TOR` (`&hurt=1` knocks out a TELAR and the CP) run against `src/ui/mockbuktor.js`.
- Markings: `src/models/markings.js` `MARKINGS` now has entries for buk-telar, buk-loader, buk-radar, buk-cp, tor, tunguska and shilka (emblem on hull sides, turret flank or plate where clean, rear panel, flag on a front plate; positions probed on the built models, so re-measure if those model files change).
- Client: title screen loadout picker (`index.html` `#loadout`, built in `main.js` from `SLOT_OPTIONS` with a short name and a one-line trade-off per option, `OPTION_INFO`), kept in localStorage `echelon.loadout`; `?loadout=buk,tunguska,...` (or `alt`) overrides it for one page load. `window.__iads.setLoadout(kinds, { save = true })`: on the title screen it rebuilds the demonstration battle with the new units (and cuts to the changed slot), during a battle it starts a new one with them, during a tutorial it waits for the next Take command. Tutorials start with `loadout: DEFAULT_LOADOUT`, leaving one goes back to the player's loadout.
- Client: rebuilding for a loadout. Main's `newBattle(opts)` wraps every `sim.newGame` (Take command, tutorials, the title's demonstration): `views.reset(sim)` now returns true when the units' ids or vehicle kinds changed, after it disposed the old rigs' geometry (materials and textures are shared and stay) and built new ones; main then reapplies `views.payloads`, `patchSceneFog(scene)` (idempotent, patches the new vehicles' own materials), rebuilds `eyes` in place, calls `panel.setUnits()` (drops the console and the tabs, rebuilt for the new `UNITS` on the next update) and warms the shaders with `compileAsync`. `ui/panel.js` looks kinds up from `UNITS` when needed (no `KIND_OF` at import), and mounts `ui/fallback.js` `mountFallback` (status line, mode, radars, weapons, engage and trigger, track list, sight) for a kind without a console.
- Render: `UnitViews` binds the new kinds per the "Loadout" table: Buk launchers' turret and elevation per part, the search radar vehicle's array and mast raised (`setDeploy`) and spun with the sweep, the loader-launcher's crane cycling (rack, hook, swing to its own launcher or out toward the vehicle it loads, a 9M317 on the hook) while `reload > 0`, each vehicle wrecked and burning on its own (`part.hp <= 0`; the ones still whole when the battery is out stand abandoned); Tor turret, tracking antenna tilt (from `rig.trackTravel` while deploying), search antenna, a cell's lid open for 3 s when its round leaves; Tunguska guns, launchers raised to `turret.el` only while a missile engagement runs, dish tilt, search antenna; Shilka guns, its one radar spinning with the sweep while only searching and facing `gun.aim` (or the gun target) while tracking. Radars and masts on `buk-radar`, `tor`, `tunguska`, `shilka` stand up over 7 s at the start of a battle and fold when the vehicle is knocked out (the antenna turns back to 0 first); an antenna that starts to spin takes up the sweep's rate at once and closes on its angle (no jump when an emitter comes back on). The S-400's 92N6E holds a sector: it turns at 0.25 rad/s only when a live engagement's target (own or link track) is more than 0.7 rad off its facing, to the mean bearing of the live targets, never back to the front when idle, and keeps its 0.32 rad tilt when the emitter is switched (refs/tracking items 6 and 7). The 91N6E uses the same spin-up.
- Render/models: interceptors '9M317', '9M338', '9M311' in `models/threats.js` from the vehicle builders' missiles (`fromObject` bakes an Object3D into instanced parts, `aH` set high so no mud); `INTERCEPTOR_STAGES['9M311'] = '9M311:dart'`, the model `entities.js` draws once the round's phase is 'coast' (booster dropped). Main: `MSIZE`/`COLD` entries (the 9M338 is cold: `fx.coldLaunch` at its cell, `fx.ignition` on `ignite`), a launch of a Buk, Tunguska or Tor round is moved onto its own slot anchor (`SLOT_AT`: the rail's round centre, or the container or cell mouth) along the slot's axis, the launch blast at its tail; '23mm' detonations are shell hits; `partDestroyed` blows up that vehicle (each vehicle once; `unitDestroyed` only the ones not already gone and with no hp left); the launch camera hold applies to every unit with several vehicles; sight pictures for every unit with a `sight` and a sight canvas (TV picture for the Pantsir, Tunguska and Shilka, natural for the Strela); gun loops pass `audio.gun(id, on, pos, shell)` ('30mm-tunguska' for the Tunguska); a role in brackets in a unit's name goes to the HUD's callsign line.
- Tutorials: lessons for the loadout alternatives, `buk`, `tunguska` (unit T2, slot 2), `tor` and `shilka`, in `src/tutorial.js`. A lesson def may carry `loadout` (`swap(slot, kind)`: the default loadout with its vehicle swapped in); main's `host.enter` passes `def.loadout ?? DEFAULT_LOADOUT` to `newBattle` and `host.leave` rebuilds with `params.loadout`, so the player's loadout comes back. `?tutorial=buk|tunguska|tor|shilka`; done ticks share `echelon.tutorials`. New `tut` hook: `heat` on the Tunguska's barrel heat. The scripted range needed no sim change.
- Sim (tracking fixes, refs/tracking): turret priority as in "Gun fire control" and "Turret priority": the missile channel keeps the turret while a round flies, the guns take it only inside the channel's sector, launches wait for the launcher on the target (`ALIGN` 0.02 rad, was 0.18), salvos stop when the channel loses the target between rounds, a turret crew gives up an engagement it cannot get into its channel after `giveUp` (12 s); `gun.aimOk` only inside the shells' reach; `select` in manual sets the gun target only for the guns or a close track; `unit.channel` lists the missile channel's target before the gun target.
- Sim: tracks a channel starts are measured at once (`track.n`, measurements taken; `FireUnits.trackOf(u, id)` gives the own track once measured, else the linked one), so turrets no longer swing to the runway centre on acquisition.
- Sim: `SYSTEMS` adds `pantsir.track.sector` 0.79 (two channels sit between their targets, a new one must be inside the sector), `eo.free` (the EO sight's travel from the bore: Pantsir 1.57, Tunguska 0.79, default pi/2), `antenna` and `minEl`/`maxEl` on the Osa (panels 0.55 to 0.6, the antenna in `turret.trackEl`), Pantsir `search.period` 2.5 (was 1), Osa `turnAz` 0.5 (was 1.0). The EO channel sees only inside the sight's field of view and counts as one channel.
- Sim: Strela: `unit.lay` (world bearing and elevation the launcher is laid on; the sight is the bore), `slew { az, el }` absolute designation, the seeker cone on the launcher axis, `unit.fire` (a launch swinging to its lead), `unit.aiCueId` (the crew's cue, replaces `aiCue`); FIRE answers "launcher not on the target" when it is not.
- Models: `osa` rig: the tracking antenna head is its own `trackRadar` pivot on the turret (rotation.x, + = face up; it no longer copies `elevation`). `pantsir` rig: new `eo` pivot (the EO window housing, rotation order YXZ) with the `sight` anchor on it; the cab doors lose their red stars (`kamazCab(..., { star: false })`), the national markings take their place.
- UI: the Pantsir and Osa consoles' tracking displays (range, azimuth, lamps, A-scope, sight box) show the channel's target (`unit.channel.targetId`) when it holds one, otherwise the selected track; the Strela's cue strip lays the launcher on the clicked cue's bearing (`slew { az }`) and the turret slews there at its rate.
- Sim: Buk `firePart { part }` command and `unit.firePart` (null by default and after `newGame`): the TELAR the player picks; `nextLauncher` uses it (after an engagement's own TELAR) while it stands, with the loader-launcher fallback as before, and `engage` without `part` takes it.
- Sim: balance after the tracking fixes (see "Balance"): Tunguska crew `react` 4, `tempo` 2, `close` 3000, `keep` 3 (was 3, 1, 4000, 2); 9M311 `speed` 1100, `accel` 500 (was 950, 450).
- Sim: designation. `select` hands the track to the unit's tracking channel (`unit.desig = { id, state: null | 'held' | 'engaged' | 'queued' | 'laying', part }`, see "Designation"): turret, antenna, TELAR or Strela launcher laid on it, the needed radar switched on unless the player silenced it (`unit.silent.search/track`, Buk `part.silent`), queued while every channel guides a missile or outside a busy turret's sector, top priority for the crew in auto. In manual `select` sets the gun target again for any track (the lead only inside the guns' reach). `unit.channel` puts a held designation first. The guns take the turret off a missile's target or a designation only with a lead (`gun.aimOk`). Render: the 92N6E sector logic in `UnitViews.s400()` includes a held designation.
- Launch sequences (refs/launch, all nine fixes): every round leaves its own slot. Main's `SLOT_AT` covers every launcher kind ('mouth': S-400 canister lip or 9M96 cell through `rig.mouth`, Pantsir and Tunguska tubes, Osa and Strela containers, Tor cells; 'centre': Buk rails) and `ev.launch` moves the round onto its slot anchor along the slot's axis, back by the sim's first step (a visual correction of the sim's one launch point per vehicle; hits and `tools/simtest.mjs` are unaffected); the hot-launch blast sits at the round's tail, the cold puff at the mouth, `ev.ignite` lights at the nozzle.
- Launch covers: rigs may carry `cover = { size, paint }` (Pantsir and Tunguska tube caps: `fx.coverBurst` at the mouth) or `lids[slot]` (Osa and Strela: the slot's lid group, thrown off whole as a copy sharing its meshes by the new `fx.throwLid(obj, vel, spin)`, a pool of 16 that tumble, land and lie a minute or so). Main's `syncCovers` sets each S-400 TEL's covers from `part.rounds` whenever that changes (`setCovers` per canister), so 9M96 cell covers come back as rounds are reloaded, partial reloads included.
- Models/render: bicalibre rounds drop their boosters. `INTERCEPTOR_STAGES['57E6'] = '57E6:dart'` (the 57E6 model split into dart and booster), `INTERCEPTOR_BOOSTERS` ('57E6:booster', '9M311:booster', models centred on themselves with `offset`, where the centre sat on the round). `Entities` drops one at the end of the burn (`fx.separation` puff), keeps a pool of 24 that slow, tumble, fall trailing a little smoke and lie where they land (drawn at true size on the ground: `place(..., grow)`); the dart flies on without flame or trail. The 9M96 fires four side-thruster pulses in its first second under power (`fx.thruster`).
- Framework: fx `ignition` adds the orange-tan ground cloud rolling out round the launcher, a gas column and a glow on the pad (30 to 90 s); `motorPlume(p, vel, k, hang = 0)` leaves broad `SMOKE.HANG` puffs that hang for `hang` s (48N6 150, 9M96 120; at most a third of the pool, thinned on low presets); `brass(p, v, d, len, link)` spent cases and links (ring buffer of 1600, one instanced mesh, no lights; main throws them from the Pantsir's and Tunguska's receivers out, up and back, the Shilka's out of the turret front onto the hull, `BRASS` table); `separation`, `thruster`, `throwLid`, `clearLitter()` (main calls it in `newBattle`).
- Sim: `MISSILES[kind].ejectSpeed` (m/s, default 28): the 9M338 is thrown out at 25 m/s for 0.9 s (was 0.5 s at 28) and lights about 18 m over its cell; the Tor launch sound's motor moved to 0.9 s. An S-400 engagement launches only when the TEL `nextLauncher` names is fully erected (`u.erect[part]`, was `u.erect[0]`). Osa `launchGap` 3 s (was 2). Balance in "Balance".
- Sim (reload jobs, render/reload.js): a reload is a job on one vehicle (`unit.reloads`, `stock.job`: `{ id, type, part, from, slots, n, t, dur }`, see "Reload scenes"); while it runs that vehicle does not launch (stacked racks hold its rounds in `stock.held`, out of `ready`) and takes `SYSTEMS[kind].reloadPose` (S-400 `{ erect: 0, time: 8 }`: the TEL lowers its stack in the job and raises it after inside the 90 s; `{ az, el }` hook for turrets, `FireUnits.reloadPose`, called first by aimTurret and aimLaunchers). The S-400's TELs keep their own rounds (`parts[i].rounds`); `reload` takes the emptiest TEL of the selected type; the next round leaves the last TEL in rack order that has rounds, is raised and is not being reloaded (`firingVehicle`, used by `nextLauncher` and the per-TEL erect gate). Optional `SYSTEMS[kind].reloadMin`: a partial load takes its share of `reload` by the rounds it adds, not less than this (Pantsir, Tunguska, Osa, Tor 40 s). AI crews (`crewReload`): an empty launcher vehicle at once (an S-400 TEL while the other fights on), in a raid one down to `keep` only while `busyNear` is false, between raids a TEL only when at most half full. The Buk keeps its loader logic and gets the job object for the render (`from` = the loader-launcher). `reload` durations unchanged.
- Render: `src/render/reload.js` (`ReloadScenes`, owned by `UnitViews`: built with the rigs, reset with a battle, driven after the rigs every frame with the time-compressed dt) and the kit (`Frame`, `Lane`, `placeOnGround`, `Timeline`, `Crewman`, `ramp`/`smooth`/`ease`, `worldOf`); one scene module per unit kind in `src/render/reload/<kind>.js`, registered with one line in `RELOAD_SCENES`. API and rules in "Reload scenes". `src/render/reload/s400.js`: the 22T6 and the 5T58-2 reload one TEL (sequence in "Reload scenes"); the TEL's merged canister meshes are hidden while it runs and identical stand-ins carry the canisters; it hands back to the rig when the sim counts (main's `syncCovers` agrees).
- Models: `22t6` (`src/models/v/t22t6.js` `build22T6`, the 22T6 transporter-loader on the Ural-532361 8x8, about 21k triangles plus 8 instanced wheels): pivots `crane` (slew), `craneColumn`, `craneBoom`, `craneHead`, `cranePost`, `craneRotator`, `doorL`/`doorR`; anchors `craneLoad` (a pair of canisters' middle), `cabDoorL/R`, `operator`; `setCrane({ slew, column, boom, post, rotate })` (head levelled, luffing ram posed), `solveCrane(p, yaw, out, post)` (two-link column and boom solution for a load point in model space), `craneTravel`, `setOutriggers(v)`, `setWheels(roll, steer)`. Exports `spinWheels` (wheels as instanced meshes that turn and steer) and `heavyWheel` for other trucks. `5t58` (`src/models/v/t5t58.js` `build5T58`, the 5T58-2 semitrailer with four canisters two over two behind a BAZ-64022 6x6, about 45k triangles): pivot `trailer` (articulation at the kingpin), `doorL/R`; anchors `cargo[0..3]` (canister mouths, -Z out), `deckLadder`; `setLoaded(i)`, `setPayload('48N6' | '9M96')`, `setWheels`, `setTrailerWheels`. It also exports the 5P85SM2-01's canister (`canisterParts`, `coverParts`, `packParts`, `cellCoverParts`, `canisterMats`, `CAN`), the same profile, covers and paint as tel.js. Both registered in `vehicles.js` (`VEHICLE_KINDS`) with `MARKINGS` entries. Comparisons with the photos: `shots/reload/r1..r5-*` (22T6), `t2..t3-*` (5T58), `m7-22t6-front-sbs.png`.
- Balance (reload jobs; seeds 1 to 72, Normal, measured on the tree with the gun fire changes landed alongside, against the same tree with the reload jobs reverted): default 27 / 65 / 69 reverted, 25 / 67 / 69 with jobs (seeds 73 to 144: 27 / 66 / 66 and 21 / 65 / 61); all alternatives 53 / 61 / 69 and 54 / 64 / 65. The all-auto S-400 crew kills about 4 fewer a game (its 9M96 TEL no longer tops up for free in the 20 s lulls); shorter S-400 reloads (80 s) or an early 9M96 reload did not help and were not kept.
- Render: `src/render/reload/strela.js`, the Strela-10M3 hand reload (refs/reload section 4; photo mastering2018_04: three men, one on the roof bent over a container's end, two below with their arms up, the container passed lengthwise from behind; the open door with the rack in that photo is the MT-LB's left rear door, the end of the track shows beside the closed right one). `SYSTEMS.strela.reloadPose { az: 0, el: 0.33 }`: the launcher fore and aft, rails leading down over the rear of the roof (clear of the corner rails), so a container goes up its open-topped rail from behind. Reconstructed: the four spares (the sim's reserve) on a 2 x 2 rack behind the left rear door, rear ends out; the crew out through the right rear door (stooping), the roof man up the right side (photo 03); phase A, the spent containers (the job's slots) drawn back down their rails by the roof man and dragged off by one man on the ground each (empty, light), laid in two piles beside the rear; phase B, each fresh one pulled from the rack by the end, carried behind its rail, its front lifted over the rear edge to the kneeling roof man, who sets it on the rail's lower end, pushed up by the man behind as far as he reaches, shoved on from beside by the roof man and home from behind its end, latched; the crew back in after the sim counts. The natural pace takes 41 / 57 / 78 / 94 s for 1 / 2 / 3 / 4 containers until the last is latched (plus about 9 s to climb down and get in, in the outro); a shorter job squeezes the plan (`SYSTEMS.strela.reload` 20 s plays it about 4.7 times too fast). Applied: `reload: 100, reloadMin: 42` (A/B on the same tree, seeds 1 to 72, Normal: all auto 3 to 7, scripted S-400 37 to 39, with the Pantsirs 40 to 39 wins; the Strela's kills per game drop from about 15 to 12). The launcher's own containers (`rig.containers`) and lids are hidden while it runs and identical instanced stand-ins move; they hand back at the job's end; the spent ones lie beside the vehicle until its next reload.
- Render: `src/render/reload/shilka.js`, the Shilka-M4's ammunition restock between raids. The sim has no reload for the Shilka (`reload: 0`; the director's `resupply()` refills `weapons.gun.rounds` the moment a raid ends), so the scene runs from `idle()`: it plays when the rounds jump up while the guns are idle (no gun target, not firing; it waits up to 15 s for that), with its own clock (the time-compressed dt), from two to eight boxes by the rounds added (one per 300). All reconstructed (refs/shilka section 7: no photo; "from the ground or from a supply truck"): a KamAZ-5350 drives up the right side with two men on the load; the turret is laid fore and aft for it by the render (it sets the turret and gun pivots after UnitViews while the scene runs, blending from and back to the sim's az and el; the sim's turret is idle between raids) and the loader comes out of the crew hatch and opens the domed hatch over the right cheek (taken as the right magazine's loading hatch); a chain of three passes each box: over the drop side, turned round on the ground, up to the loader kneeling on the turret roof, down into the hatch; then the loader goes back in, the man on the ground climbs into the truck and it drives off forward. About 5.5 s a box: 45 s in all for two boxes, 67 s for six, 79 s for eight (the truck gone). If the guns are wanted (a gun target, firing, the sim's turret moving) the plan is made again with only the boxes already started (identical up to then) and the turret is given back at once; the loader is planned in the turret's frame, so he stays on it if it turns.
- Render: `src/render/reload/handwork.js`, the toolkit of the two hand-loading scenes: `LoadPlan` (a load's segments: eased poses in the vehicle frame or another named frame, scene functions such as a rail that turns with the launcher, hidden), `ManPlan` (a crewman's segments: moves whose gait follows the distance against his facing, walk / backward / `sidestep` / `stoopWalk` / climb, poses, hands on load points), `Hand` (a Crewman evaluated from its plan with pose cross-fades and `reach()` grips), `VFrame`, `poseApply`. Plans are made once per job; evaluation allocates nothing.
- Models: `crew.js` poses `sidestep` (cycle, stepping sideways to the right, run t backwards for the left; `CREW_GAITS.sidestep` stride 0.4) and `stoopWalk` (walking bent double through a low door; stride 0.6); the existing poses are unchanged.
- Models: `strela.js`: the four containers are their own merged group `rig.containers` on the elevation pivot (the reload scene hides it); exports `STRELA` (turret axis, trunnion, container section and ends, slot x), `container(P, x)` and `lid(P, x)`; the MT-LB's rear doors are pivots `doorRL` (opens to about -1.75, rotation.y) and `doorRR` (+1.75) on their hinge lines (`mtlb.js` `rearDoor(P, s, hinge)`, `REAR_DOOR`, `addHull(P, { doors: false })`); the rear emblem in `MARKINGS.strela` moved onto `doorRR`.
- Models: `shilka.js`: the roof hatch lids are pivots `hatch` (the big crew hatch, hinge at its rear edge, rotation.x + opens, about 1.8) and `ammoHatch` (the domed hatch over the right cheek, the same way, about 1.75); exports `SHILKA` (ring, roof height, the two hatches' turret-space places).
- Models: `kamaz-5350` (`src/models/v/kamaz5350.js` `buildKamaz5350`, a KamAZ-5350 6x6 cargo truck, the Shilka's ammunition truck: the KamAZ-6560 day cab of kamaz.js, three axles, instanced `spinWheels`, a steel body with drop sides and the tilt rolled up on its front bows; about 11.5k triangles, 19 draws). Pivots `sideL`, `sideR` (drop sides, rotation.z), `tailgate` (rotation.x); `setWheels(roll, steer)`; exports `KAMAZ5350` (axles, track, body). Registered in `vehicles.js` (`VEHICLE_KINDS`) with a `MARKINGS` entry (cab doors, tailgate, bumper flag).
- Models: `9t217` (`src/models/v/t9t217.js` `build9T217`, the Osa-AKM's 9T217 transloader on the BAZ-5937 hull of baz5937.js, about 18k triangles plus 6 instanced wheels): pivots `crane` (slew), `craneBoom` (luff), `craneExt` (two telescopic sections), `craneHead` (plumb), `craneRotator`, `roofL`/`roofR` (the tilt's halves), `hatchL`/`hatchR` (cab roof hatches); anchors `craneLoad` (the middle of a carried block of three containers, osa.js's block frame), `operator`, `hatchL`/`hatchR`; `setRoof(v)`, `setCrane({ slew, luff, ext, rotate })`, `solveCrane(p, yaw, out)`, `craneTravel`, `setWheels(roll, steer)`, `BAY` (the four block places in the bay). Tilt matched to osa_9t217_warsaw_2013 and _polish (overlays `shots/reload/osa/`); bay, crane and stowage reconstructed. baz5937.js: `buildBaz(P, { wheels, ring, hatches, deckHole })` (all optional, the Osa unchanged), `bazTyre` and `bazHub` exported, `skinRings(rings, { hole })`. osa.js: the panels' blocks of three containers are their own groups (`rig.blocks[0 | 1]`, the same geometry and materials as before), `OSA_PANEL` and `osaBlockParts(P, side)` exported for the scene's stand-ins.
- Models: `9t244` (`src/models/v/t9t244.js` `build9T244`, the Tor-M2's 9T244 transloader on the Ural-4320 6x6, about 20k triangles plus 6 instanced wheels): pivots `crane` (slew), `craneBoom`, `craneJib` (knuckle), `craneExt` (two telescopic sections), `craneHead` (level), `doorL`/`doorR`; anchors `craneHook` (the hook's eye; a container hangs plumb from it), `cargo[0..7]` (containers on the bed), `operator`, `cabDoorL/R`; `setCrane({ slew, boom, jib, ext, cable })`, `solveCrane(p, out, cable)`, `craneTravel` (the jib folded level forward over the bed, tor_9t244_14), `setOutriggers(v)`, `setWheels`, `setLoaded(i)`; exports `U`, `CONTAINER` and `containerParts(P)` (the 9M338's transport container, 3.0 m, the flange of tor.js's cell caps). Matched to tor_9t244_14, _15, _16 (overlays `shots/reload/tor/`).
- Sim: `SYSTEMS.osa.reloadPose` `{ az: PI / 2, el: 0, free: 5 }` (panels level, their rear ends to the 9T217 on the right; new optional `free`: in the job's last `free` seconds `FireUnits.reloadPose` lays the turret back where it was when the job began, kept on the job as `az0`, `el0`; without it the Osa's slow turret, left 90 degrees off the threat axis after every reload, cost the Osa about 4 kills a game) and `SYSTEMS.tor.reloadPose` `{ az: PI, el: 1.31 }` (turret round, antenna laid back, tor_m2_06). `FireUnits.reloadPose` now leaves the turret to its channel while a command-guided round of that vehicle is still in flight (`MISSILES[kind].command`): an AI crew reloads the moment its launcher is empty, and the pose turned the array away from the last pair, which then self-destructed (Tor kills per game 24 with the pose against 34 without; with the hold 36, all-auto alternatives 9 of 24, scripted Buk 16 of 24, seeds 1 to 24, Normal). Default loadout, seeds 1 to 24 on the current tree (others' gun changes landed alongside), with the poses against without them: all-auto 2 and 4 of 24, scripted S-400 16 and 14, Osa kills per game 23 / 25 and 26 / 28.
- Render: reload scenes `osa` (`src/render/reload/osa.js`, the 9T217 alongside, blocks of three) and `tor` (`src/render/reload/tor.js`, the 9T244 backed up to the nose, containers into the cells one by one), sequences in "Reload scenes"; `src/render/reload/lifts.js` holds what they share (`CrewRoute`: a crew member's way out and back with walk, climb and rise legs; `keyPose`/`layKeys` crane keyframes; `unwrap`, `wrapPi`). Both scenes take over the rig's search antenna for the job (stopped facing forward; the Tor's folded with `setDeploy`) and hand it back to UnitViews' spin after `dur`. `MARKINGS` entries for `9t217` and `9t244`.
- Sim/ballistics (gun fire control; reported: the Pantsir and Tunguska guns did not track): `solveLead(kind, from, pos, vel, out, acc)` (flies a shell through the game's integrator in the sim's order and corrects the aim by the miss, maxgfx's method), `dropAt(kind, t)` (gravity drop under drag) and `reachOf(kind)` in `ballistics.js`; `leadPoint`'s `drop` now scales the drag-correct drop (default 1) and the shells' `drop` and the Tunguska's `gun.drop` are gone (the 1.1 put the 30 mm aim 40 m high at 2 km and the shells' closest approach 34 m above the target). `SHELLS[k].spread` (was a fixed 3 mrad), damage 0.22 to 0.15 (30 mm), 0.2 to 0.14 (23 mm), 5 mrad.
- Sim (gun fire control): `guns()` picks and lays, `fireGuns()` (new, called after `aimTurret` in `update`) fires along the bore laid this step, so the shells no longer leave on last step's lead. The lead uses only the guns' channel's own fresh track (`gun.locked`), its velocity smoothed (0.25 s) and brought up to date by its rate of change, which also bends the lead (`gun.est`); new gun fields `locked`, `lockT`, `tof`, `laid`, `hold` ('no lock' | 'out of reach' | 'target lost' | 'turret on the missile target'), aimed from the guns' mount. The AI fires only on the lead (4 m at its range) after `gun.settle` s of lock; `gunsMay`/`turretBase` give the guns the turret only inside 80 % of the channel's sector around the missiles' aim or a designation, and the AI keeps or drops gun targets by the same rule. The tracking radar comes on for a gun target in both modes unless silenced. A manual trigger is held (radio "guns held") while the missile channel keeps the turret. New `SYSTEMS` gun fields `settle`, `spread`, `dmg` (Pantsir spread 2). Probes: manual bursts from 800/1300/2000 m, the stream's centre now 0.3 to 1 m off non-weaving targets (was 3 to 23 m, 61 m on a drone at 2 km), auto fire more than 2 degrees off the lead 3 to 5 % of firing time before, 0 after (max 172 to 0.3 degrees).
- UI: `statusLine` (consoles/common.js) shows "GUNS HELD on NNN: <gun.hold>" while the player wants the guns and they cannot fire, and "FIRING ... on" names the guns' own target.
- Render: `src/render/reload/buk.js` (RELOAD_SCENES `buk`, "The Buk scene"): the loader-launcher (the battery's own rig) drives from wherever it is to park alongside the TELAR it loads (turn-straight-turn path clear of the battery, the last 14 m straight), raises its launcher clear of its rack, three 'mm14' crew get out, the crane lays the rack rounds one at a time on the TELAR's empty rails (two-link solution with the jib's telescope, rounds parallel to the hulls, swinging round the rear), folds, and the loader-launcher pulls 6.5 m ahead inside the job and drives home after it; loading its own rails it works where it stands. Rounds in transit: one `InstancedMesh` of four. Replaces the crane cycle and the carried 9M317 in `render/units.js` (removed). Captures `shots/bukr/final-*.png`, `sheet-*.png`.
- Sim: Buk reload jobs take `reload` (30 s, was 25) plus the loader-launcher's drive to the TELAR (`reloadDrive` 12 m/s on the straight distance from its spot, or from where it is on its way back from the last TELAR it loaded: `FireUnits.loaderDrive`, `stock.loaderAt`): 46 s for TELAR 1 and 60 s for TELAR 2 from its spot, 46 s from one TELAR to the other, 30 s for its own rails; `stock.reload` starts at the job's `dur`. `SYSTEMS.buk.reloadPose` `{ az: PI, el: 0, crane: { az: PI } }`; `FireUnits.reloadPose` lays the vehicle whose crane works for another at `reloadPose.crane` when given (no `el`: elevation left alone). Tutorial text for the Buk reload step updated (about a minute).
- Balance (Buk reload drive; seeds 1 to 72, Normal, all-auto / scripted Buk / scripted Buk with the Pantsirs, measured on copies of the tree as it stood): 25 s reloads 25 / 51 / 67, these values 17 / 49 / 59; the default on the same tree 9 / 58 / 66. Tried and not kept: 37 s + 10 m/s (19 / 34 / 45), 30 s + 12 m/s without the tracking (16 / 46 / 60), 26 s + 14 m/s (14 / 52 / 54); the losses are in wave 7, where both TELARs run dry.
- Models: `buk-loader` gets the jib's two telescopic inner sections (reconstructed from refs/buk section E, "the jib extends sideways over the TELAR rail"): pivot `craneExt`, `rig.setCraneExt(m)` 0 to `rig.craneExtMax` (2 m); the hoist and hook now ride on the inner section (travel pose unchanged, sections housed in the jib).
- Models: `pantsir-tzm` (`src/models/v/tzmpantsir.js` `buildPantsirTZM`, about 21.7k triangles plus 8 instanced wheels): the Pantsir-S1's transport-loading vehicle after the Serbian KamAZ-6350 in refs/reload (photos pantsir_tzm_serbia_granit2023_95, _zastava2024_01; axles 2.0 + 3.34 + 1.32 m, 9.85 m truck): its own 6350 day cab (marker lamps, black bumper and flares), spare wheel and cooling unit behind it, a platform with ribbed drop sides under a tilt, at the tail a railing, a ladder, a pole and a knuckle-boom crane stowed upright at the right corner. Reconstructed (not seen): the crane's working form (`crane`, `craneBoom`, `craneJib`, `craneExt`/`craneExt2` telescope, `craneHook`, `craneRotator`, `anchors.craneLoad`; `setCrane({ slew, boom, jib, ext, rotate, hoist })`, `solveCrane(p, yaw, out)`, `craneTravel`), the outriggers (`setOutriggers(v)`, jacks folded along the legs when stowed), the tilt's rear part bunching forward on its bows (`setTarp(v)`), and the load: twelve 57E6 containers in two layers on saddle racks (`setLoaded(i)`, `anchors.cargo[i]`). Doors `doorL/R`, anchors `cabDoorL/R`, `operator`. Overlays with solved cameras: `shots/reload/pt/z1..z5`, `tz1..tz6-*`.
- Models: `2f77m` (`src/models/v/t2f77m.js` `build2F77M`, about 18.2k triangles plus 6 instanced wheels): the Tunguska's 2F77M on the KamAZ-43101 6x6 (refs/tunguska section 7, photos tung_2f77m_11..13, the 3.34 + 1.32 m wheelbase as the ruler): the first KamAZ cab with the placards, spare wheel across the frame, the front ammunition rack under its tube frame, eight 9M311 containers in two stacks of four (`setLoaded(i)`, `anchors.cargo[i]`: 0..3 left bottom to top, 4..7 right), expanded-metal racks of ammunition boxes across the tail (`anchors.boxes`), the slewing trolley-beam crane at the rear (`crane`, `craneColumn` telescopic, `craneTrolley`, `craneHook`, `craneRotator`, `anchors.craneLoad`; `setCrane({ slew, lift, reach, cable, rotate })`, `solveCrane(p, yaw, out, minLift)`, `craneTravel`). Painted with the Tunguska's materials (`tunguskaMats`, `greyer` now exported from tunguska.js). The grab is reconstructed (photo 13 shows only a hook and a small frame). Overlays `shots/reload/pt/f1..f5-*`.
- Models: `src/models/v/swap.js` (`mark`, `span`, `swapper`): containers merged with their vehicle's parts that a scene can hide and show by collapsing their vertices (no draw call each). The `pantsir` and `tunguska` rigs gain `setContainer(i, shown)` (the whole container of slot i, not only its cap) and export the container builders (`pantsirTube`, `tubeCap`, `TUBE`, `greyer`; `tunguskaContainer`, `containerCover`, `CONT`, `tunguskaMats`, `greyer`); geometry unchanged. `kamazRunningGear(P, { wheels: false })` leaves the wheels out (for trucks with `spinWheels`). Both new kinds in `VEHICLE_KINDS` and `MARKINGS` (emblems on the cab doors, a flag on the bumper or the cab front).
- Render: `src/render/reload/pantsir.js` (RELOAD_SCENES `pantsir`; reconstructed, no source shows a Pantsir reload): the turret turns 90 degrees left with the blocks level; the TZM drives up from behind and stops alongside on the left (column 4.6 m out, level with the rear of the turret), outriggers down, the tilt's rear part bunches forward; per block row to fill, the spent pair (or single) slides out of the muzzles (a container sits between others, so out along its rails), the spreader takes it by the middle, draws it clear and lays it on the ground beyond the TZM; then a fresh pair from the top rack layer is turned square, lined up with the cells, run in to the muzzle face and slides home. Crew 'mm14': the operator at the column, a loader who climbs onto the platform and steadies the pairs, a guide from the Pantsir. The TZM drives on and away after the job; the spent containers lie there until the next reload. The rig's containers in the refilled cells give way to identical stand-ins (one `InstancedMesh` per material) while the scene runs. Fits 40 s (partial) to 120 s jobs: the 11 s drive-in and the 14 s drive-out keep their length, the crane's work is scaled. Captures `shots/reload/pt/p3`, `p4`, `p5` (partial).
- Render: `src/render/reload/tunguska.js` (RELOAD_SCENES `tunguska`; reconstructed, the vehicle and its load are seen, the sequence is not): the 2F77M pulls up alongside on the left, column level with the turret ring; the turret turns its front to it, guns raised to 0.5 rad, launchers level (the research suggested the rear, but the search antenna stands there and the containers leave by their mouths). Per side the spent containers slide out of the mouths, the grab takes them by the middle (one, two side by side or a block of four) and lays them on the ground in front of the turret; fresh ones from the top of the stacks (a column of two or one) go in the same way. The crane's operator works it with a pendant; the 2F77M's loader carries 30 mm ammunition boxes from the tail racks and hands them up to a crewman on the Tunguska's deck who takes them to the gun bay; a second crewman guides from the ground. Jobs 40 to 45 s: the 9 s drive-in and the 12 s drive-out fixed. Captures `shots/reload/pt/t3`, `t4`, `t5`, `t6`, `t7`.
- Sim: `SYSTEMS.pantsir.reloadPose { az: PI/2, el: 0, guns: true }`, `SYSTEMS.tunguska.reloadPose { az: PI/2, el: 0.5, guns: true }` (the DESIGN "Loading poses" note's "Tunguska rear" is now its front, to the left). New `reloadPose.guns`: `FireUnits.reloadPose` lets the guns take the turret while they have a target (two lines in units.js; without it the scripted S-400 won 28 of 48 instead of 40). Balance, seeds 1 to 72, Normal, without the poses / with them: default all-auto 7 / 6, scripted S-400 58 / 54; all alternatives all-auto 37 / 24, scripted Buk 44 / 53, Buk + Tunguskas 65 / 63.
- Balance (final pass on the finished tree, see "Balance"): `director.js` `LULL` 20 to 40 s (the reload jobs, durations unchanged, now mostly run and play between raids), the helicopters' `standoff` 6.5 to 5.5 km (waves 5 and 7), the Tunguska's `gun.range` 2000 to 2200 and `gun.settle` 4 to 3. Normal, seeds 1 to 144: default 29 / 117 / 127, all alternatives 51 / 110 / 132; every single swap within 10 points of the default's scripted S-400 over seeds 1 to 72.
- UI: the dispersed battery's alerts have their cabin captions (`consoles/common.js` `ALERTS`): 'TELAR DOWN' СОУ ПОРАЖЕНА, 'LOADER DOWN' ПЗУ ПОРАЖЕНА, 'RADAR DOWN' СОЦ ПОРАЖЕНА, 'CP DOWN' КП ПОРАЖЁН (ranked as DAMAGED, a standing state); they showed only the generic ТРЕВОГА. `vite.config.js` `chunkSizeWarningLimit` 1600 to 2000 kB (the bundle is 1.69 MB with the reload scenes).
