# Echelon: layered air defense

A three.js (WebGL2) game built on the MaxGFX framework (`../threejs-maxgfx`). One game holds several eras of air defense; the modern one is playable, a late-war WW2 era (German flak defending the jet airfield at Hopsten, February to March 1945) is in development: its battles run in the headless sim, its models and consoles are being built. In the modern era you command the air defense of an airbase on the steppe: an S-400 battalion for the long-range, high layer, two Pantsir-S1 for point defense, an Osa-AKM and a Strela-10M3 for the short-range layer, against seven escalating raids of drones, cruise missiles, fighters with radar-seeking missiles and glide bombs, decoys, attack helicopters and ballistic missiles.

The left half of the screen is a third-person view of the unit you have selected; the right half is that unit's console. The units you are not operating fight on their own, in whatever mode you left them. Everything is procedural (terrain, vehicles, aircraft, missiles, the consoles, almost all the sound); the only asset files are four CC0 recordings in `public/audio` (see `CREDITS.md` there).

The simulation is a game, not a weapons model: the systems keep their names, look and their place in the layering, and the mechanics are game rules with gameplay values (see `DESIGN.md`, "Simulation fidelity").

```bash
npm install
npm run dev      # http://localhost:5200
npm run build    # production bundle in dist/
```

## Playing

Pick an era, a difficulty and a loadout and click **Take command**. A demonstration battle runs behind the title screen; its camera drifts slowly and cuts to another unit about every 26 s, and now and then to a missile launch.

**Era.** The toggle at the top of the options picks the era: **Modern** (2020s), or **WW2** (1944 to 1945), shown greyed out and marked as in development until its content exists. The line under it gives the era's setting (point at the other era to read its own). An era brings its own map, units, raids and consoles; the loadout picker, the tutorials and the demonstration battle follow it. The era is kept in the browser for the next visit.

**Loadout.** Under the difficulty the title screen lists the five slots (the number keys) with two options each, the default first; the line under a slot gives the chosen option's trade-off (point at the other option to read its own). Picking an option rebuilds the demonstration battle with it and cuts to that unit, so you see what you chose; **Take command** fights with it. The choice is kept in the browser for the next visit, one loadout per era. A tutorial runs on the default units with its own vehicle swapped in (the Buk, Tunguska, Tor and Shilka lessons) and puts your loadout back when it ends.

| Slot | Default | Alternative |
|---|---|---|
| 1 area layer | S-400 | Buk-M2 battery: 70 km, cheaper rounds and a deep reserve, one target per TELAR, no answer to ballistic missiles; five vehicles knocked out one by one |
| 2 battalion cover | Pantsir-S1 | 2S6M Tunguska: guns first (more 30 mm, its crew opens fire at 3.5 km, tougher), eight cheap 9M311 to 10 km guided only through the optical sight, a new missile target every 8 s at most |
| 3 airbase cover | Pantsir-S1 | 2S6M Tunguska |
| 4 short range | Osa-AKM | Tor-M2: four targets at once inside its radar sector (a new one every 4 s at most), quick, best against small fast targets, dearer rounds fired straight up out of their cells |
| 5 very short range | Strela-10M3 | ZSU-23-4M4 Shilka-M4: four 23 mm guns, free to fire, its shells reach about 2.8 km and its crew opens fire inside 2 km; its radar emits |

The search radars see high flyers far out and low flyers only close in and over open ground, so the long layer gets the aircraft, decoys and ballistic missiles, and what comes in low leaks through to the Pantsirs, the Osa and the Strela. Every unit starts in **auto** (its crew engages on its own, competently but wastefully: slow to react, it fires on decoys, uses the big missiles on everything and never switches its radar off). **Manual** fires only on your orders and your shots are a little better; **hold** never fires.

- **S-400** (battalion command post): the big scope and the track table. Pick the 48N6 (long range, few) or the 9M96 (shorter range, cheap and plentiful), select a track and launch one or two (**NEXT THREAT** steps through the threats nobody is engaging yet). Slow "aircraft" that never close are often decoys: their class shows once a track has been held long enough. When a radar-seeking missile comes for the battalion, switching the emitter off makes it lose its aim, but blinds the battalion and its 48N6 in flight.
- **Pantsir-S1**: missiles out to 20 km on two channels, a new target every 6 s at most (about ten a minute; a re-fire at a target its missile missed goes at once); twin 30 mm guns whose shells reach about 4.2 km, taking about 3 s to 2 km and 7 s to 4 km and scattering more the farther they go, so the crew opens fire inside 2.5 km (hold Space or the FIRE button in manual: it greys out while the shells cannot reach the target). The tracking channel can be the radar or the silent electro-optical sight, whose picture is in the console.
- **Osa-AKM**: one target at a time, salvoes of two, its tracking radar must hold the target until the missiles arrive.
- **Strela-10M3**: no radar. Slew the optical sight onto the target (drag in the sight or arrow keys, the strip below it cues the bearings of the nearest threats from the battalion's picture), uncage the seeker (U), wait for the tone to steady and the LOCK lamp, then fire.

Between raids (40 s of quiet) a supply column refills the reserves; launchers still have to reload, which takes from half a minute to two minutes and keeps that launcher out of action, so start them as the raid ends.

| Key | Action |
|---|---|
| Click an era | title screen: switch the era (Modern; WW2 is in development) |
| Click a loadout option | title screen: swap that slot's unit for the next battle |
| `1`-`5` | select a unit (or click its tab above the console) |
| Drag, wheel | orbit and zoom the camera |
| `V` | padlock: the camera keeps the selected track in view |
| `F` | chase the selected unit's newest missile in flight (F again, a unit key or C returns) |
| `C` | free camera (WASD to move) |
| `[` `]` | time compression (x0.25 to x8); also the - and + buttons by the time readout (click the readout for x1) |
| `Tab` / `Shift+Tab` | next / previous track |
| `Space` | engage or fire (hold for the guns of the Pantsir, Tunguska and Shilka) |
| `R` / `T` | search / tracking radar (the Shilka's one dish: search / track) |
| `G` | Pantsir, Tunguska: missiles or guns |
| `Q` | S-400: missile type; Buk: firing vehicle (best, TELAR 1, TELAR 2) |
| `U` | Strela: uncage the seeker |
| `A` | mode: auto, manual, hold |
| `L` | reload |
| arrows | slew the sight |
| `M` | mute |
| `H` | hide the overlay |
| `F3` | FPS, draw calls, battle counters |

## Tutorials

**Tutorials** on the title screen opens a list of short guided lessons, one for each vehicle, the loadout alternatives included, and one for the basics (a tick shows the ones you have finished, kept in the browser's local storage). Each runs on a quiet range: the raids are off, nothing is scored, nothing can be destroyed, and the other units stand down. A card over the 3D view gives the step, a pulsing amber frame marks the console control it is about, and the step completes when you do the thing; steps that only explain go on with **Next** (**Skip step** passes one you cannot complete). Time compression stays in your hands: the + and - buttons by the time readout, or [ and ]. Esc or **Exit** goes back to the list, Esc again to the title.

- **The basics**: orbit and zoom, switching units (1 to 5, the tabs), modes, padlock (V), the missile chase (F), time compression, the layers.
- **S-400 battalion**: the scope and the track table, manual mode, the long and the short missile, launching at an aircraft, a decoy that gives itself away (hold fire), switching the emitter off for an anti-radar missile, reloading.
- **Pantsir-S1**: the search scope and the tracking channel, missiles and then guns, a drone close in, the silent TV / IR channel.
- **Osa-AKM**: the scope, the tracking radar, a salvo of two, the one-target limit, reloading.
- **Strela-10M3**: the bearing cue strip, slewing the sight, uncaging, the tone and the lock lamp, firing, the stowed reload.
- **Buk-M2 battery** (replaces the S-400): the five vehicles and why each TELAR is its own fire unit, the scope and track table, naming the firing vehicle, the TELAR radar holding the target to impact, two targets on two TELARs, going dark against an anti-radar missile, reloading a TELAR from the loader-launcher.
- **2S6M Tunguska** (replaces a Pantsir): holding the trigger and the fire control's lead, heat and ammunition, the optical-only missile channel and when to use it, the search radar, reloading.
- **Tor-M2** (replaces the Osa): the tracking sector, a vertical cold launch, several targets at once on separate channels, a salvo, reloading.
- **Shilka-M4** (replaces the Strela): radar tracking and the lock lamp, the lead mark in the sight, a very short range, bursts and heat, the optical fallback with the dish off, the radar as an anti-radar target.

`?tutorial=s400` (or `basics`, `pantsir`, `osa`, `strela`, `buk`, `tunguska`, `tor`, `shilka`) starts one at once.

## Development pages

- `/models.html?kind=pantsir` (or `?all=vehicles|threats|interceptors|assets`, `&anim=1`, `&cam=az,el,dist`): the model viewer. `&ortho=right|left|front|rear|top` (with `kind`) gives an orthographic blueprint view with a 1 m grid (5 m lines darker) for checking proportions. `&era=ID` loads that era's lazily loaded models (and its markings and assets).
- Vehicle model work: each vehicle is rebuilt against reference sheets in `refs/<group>/` (`README.md` with dimensions, profiles, a feature checklist and a photo index with licences, plus `photos/` from Wikimedia Commons). The folder is gitignored and only for local reference, not part of the game. The method: compare viewer renders with the photos from matching angles, check the blueprint views against the dimension tables, and iterate.
- `/?loadout=buk,tunguska,pantsir,tor,shilka` (kinds in slot order, empty entries or anything a slot does not offer take the default; `alt` for every alternative) starts with that loadout without saving it; `window.__iads.setLoadout(kinds)` changes it from a test.
- `/?era=modern` starts in that era without saving it (an era still in development falls back to modern); `window.__iads.setEra(id)` switches it from a test (`__iads.era` is the era in play). Local storage keeps `echelon.era` and the loadout per era in `echelon.loadout.<era>`.
- `/ui.html?unit=STR`: the consoles against a mock battle.
- `/audio.html`: a live smoke test of the audio engine.
- `node tools/simtest.mjs 1 2 3 --both --quiet`: whole battles headless, all-auto against a scripted S-400 player. With `--era ww2` the scripted players are the WW2 era's (a heavy battery player, and one who also runs the platoons) and the columns are its slots, with the heavy battery's own 2 cm guns apart (B20). `--all` adds a player who also runs both Pantsirs, `--difficulty Easy|Normal|Hard|all` picks the difficulty, `--era ID` the era (default `modern`), `--loadout KINDS|alt` the units, `--table` prints only the summary, `--log` the whole radio log, `--jobs N` sets the worker threads. Each game prints a per-wave summary.
- `node tools/audiotest.mjs`: renders every synthesized sound bank offline and reports levels.
- `node tools/shot.mjs "/?play=1&unit=1&quality=Low" shots/x.png --until "window.__iads?.state === 'playing'" --eval "window.__iads.fastForward(60)"`: a headless capture of the game.

## Layout

```
src/
  main.js          renderer, quality presets, GUI, game flow, event wiring, main loop
  eras/            one module per era: map layout, slots and options, raids, text, alert captions, theme
    index.js       the registry (ERAS), the derived default loadouts, loadEra (an era's lazily loaded content)
    modern.js      the modern era (the airbase on the steppe)
    ww2.js         the WW2 era: Fliegerhorst Hopsten, February to March 1945, its flak, six day raids (in development; ww2/content.js: its lazy modules)
  deploy.js        the era in play (setEra) and where everything sits (units, their vehicles, the assets), bearing helpers
  sim/             the battle, pure logic (runs in Node)
    sim.js         Sim: update order, events, damage, targets for the attackers, radio
    systems.js     game values: fire units, missiles, threats, difficulty
    sensors.js     search radars, tracks, the fused picture and the data link
    units.js       fire units: commands, AI crews, engagements, Pantsir guns, Strela seeker
    mounts.js      gun units of several mounts (WW2): the heavy battery's predictor, salvos and barrage, the platoons' guns and feeds
    missiles.js    interceptor flight and hit resolution
    threats.js     threat behaviour and the weapons aircraft release
    planes.js      the WW2 aircraft's attack roles (recon, strafing, dive bombing, rockets, bomber boxes, escorts), bombs, rockets, Window
    director.js    the raids, lulls, resupply, win and loss
    flight.js      shared kinematics
  ballistics.js    shells and tracers (from maxgfx): the 30 and 23 mm, the WW2 8.8 cm (time fuzes, bursts), 3.7 and 2 cm
  render/
    units.js       vehicles and buildings bound to the sim (turrets, radars, masts, erectors, Tor lids, wrecks; the Buk loader-launcher's crane is its reload scene, reload/buk.js), rebuilt when the loadout changes
    entities.js    everything that flies, instanced, with plumes and wreck trails (distant flyers are enlarged to stay visible)
  sight.js         the sight pictures for the consoles (Pantsir, Tunguska, Shilka, Strela)
  ui/              the right half: unit tabs and one console per system
  audio.js         audio engine: synthesized banks, recordings, threat engines, seeker tone
  terrain*.js      steppe terrain (clipmap), fields, river, windbreaks; heightAt and los
  vegetation.js    trees (poplar, broadleaf, birch, bushes) and windbreak rows; grass.js  grass
  camera.js        third-person chase camera with padlock, missile chase (F), title orbit and free modes
  tutorial.js      the tutorials: lessons as lists of steps run on a scripted range (sim.newGame({ scripted: true })), the cards and the list
  hud.js           overlay on the 3D view: unit, compass, radio, toasts, bracket, end screen
  atmosphere.js, clouds.js, weather.js, post.js, fx.js, shaderlib.js, noise.js   from maxgfx
  models/          procedural threats, interceptors and the airbase
    vehicles.js    the vehicle rigs; one builder per vehicle in v/ (tel, radar92n6, search91n6, cp55k6, pantsir, osa, strela) with their chassis helpers (maz543, ural, kamaz, baz5937, mtlb)
```
