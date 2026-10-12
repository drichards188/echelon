# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Echelon: a three.js (WebGL2) layered air defense game built on the MaxGFX framework (`../threejs-maxgfx`, a separate project; do not edit it from here). The player commands an S-400 battalion, two Pantsir-S1, an Osa-AKM and a Strela-10M3 around an airbase against escalating raids. Left half of the screen: third-person 3D view of the selected unit; right half: its console. Plain ES modules, no TypeScript, no framework; runtime dependencies are three.js and lil-gui only. Everything is procedural except four CC0 recordings in `public/audio` (`CREDITS.md`). `DESIGN.md` is the contract between the modules (conventions, data shapes, commands, events) with a changelog; keep it current when an interface changes.

**The simulation is an arcade-level game, not a weapons model** (DESIGN.md, "Simulation fidelity"): generic game mechanics with gameplay values (turn-rate-limited steering, hits from a game table, sensors by game range and line of sight, scripted raids). Keep it that way; do not add real-world guidance laws, warhead lethality, sensor performance or tactics.

## Commands

```bash
npm install
npm run dev      # Vite dev server on http://localhost:5200 (--host)
npm run build    # production bundle in dist/
node tools/simtest.mjs 1 2 3 --both --quiet   # headless battles: all-auto vs a scripted S-400 player
node tools/simtest.mjs 1 2 3 --all --difficulty all --table   # + a scripted player with both Pantsirs; --table summary only, --log radio log, --jobs N
node tools/audiotest.mjs                       # renders every sound bank offline, reports levels
node tools/shot.mjs <path> <out.png> [--size WxH] [--wait ms] [--until expr] [--eval expr]   # headless capture
```

No tests, linter or formatter beyond those tools. `tools/shot.mjs` launches its own headless Chromium (SwiftShader WebGL2) from `~/.cache/ms-playwright` via `playwright-core`, prints console and page errors, and needs the dev server running. `window.__iads` exposes every system; `__iads.fastForward(seconds, { unit, scale })` stops the loop, runs the battle without drawing and draws a few frames, so a capture can jump into a raid: `node tools/shot.mjs "/?play=1&unit=1&quality=Low" shots/x.png --until "window.__iads?.state === 'playing'" --eval "window.__iads.fastForward(60, { unit: 1 })"`. `frame(dt, draw)` steps one frame. URL params: `?quality=Low|Medium|High|Ultra`, `?play=1` (start at once), `?unit=N`.

Dev pages: `/models.html?kind=<kind>` (model viewer; `&ortho=right|left|front|rear|top` for orthographic blueprint views), `/ui.html?unit=ID` (consoles against `src/ui/mock.js`), `/audio.html` (audio smoke test).

## Architecture

### Orchestration (`src/main.js`)

`init()` builds atmosphere, terrain, clouds, fx, weather, the `Sim` (started in attract mode: a demonstration battle behind the title screen, nothing scored or destroyed), `UnitViews` and `Entities` (`src/render`), then `patchSceneFog(scene)`, post, the chase camera, the `SightRenderer`, the `AudioEngine` and the `Panel`. Cross-system effects go through `sim.events` wired in main (launch, ignite, gun, detonate, threatKilled, impact, unitDestroyed, radio, wave, state); modules do not import each other's state. "Take command" calls `sim.newGame({ difficulty })` and `views.reset(sim)`.

Per frame: sun/sky, `sim.update(dt)` (dt is time-compressed by `params.timeScale`), `views.update`, `entities.update`, `sim.ballistics.render()`, camera, terrain, atmosphere, clouds, fx, weather, post, then `panel.update`, the sight picture for a selected Pantsir or Strela, the Pantsir gun loops and `audio.update`, then HUD markers, the bracket on the selected track and the padlock. `rawDt` drives cameras, post and audio. On the title screen `chase.cine(true)` drifts the camera and main cuts to the next unit about every 26 s (and to a launch in the demonstration battle). F chases the selected unit's newest missile in flight (`ChaseCamera.follow(obj, onEnd)`); F again, a unit key or C returns to the unit.

The `params` object is the single source of truth for settings (lil-gui behind the gear button); `QUALITY` presets set pixel ratio, shadow map, AO, sample counts and the fx budget.

### World frame (`src/deploy.js`)

Metres, y up, origin at the runway centre, north -Z, east +X; a bearing b at range r is `x = r sin b, z = -r cos b`. Model space: front -Z, ground at y = 0; headings are `rotation.y` (`headingFor(bearing)`). Turret azimuth is relative to the hull in `rotation.y` convention; `radar.sweep` and `sight.az` are compass bearings in radians; track `bearing` is in degrees. `UNITS` (with their vehicles as `parts`) and `ASSETS` live here, and `flatPads()` levels the terrain under them.

### Simulation (`src/sim/`, Node-safe)

`Sim` steps at a fixed 0.05 s: director (spawns), threats, fire units, interceptors, shells, sensors, bookkeeping, raid callouts. Units, tracks, threats and interceptors are plain objects the UI and render layer read directly (shapes in DESIGN.md). Search radars detect when the beam's sweep passes a target inside a game range scaled by the target's size, above the earth-curvature line of sight and with terrain line of sight (`sim.los` clips long rays to the part below 200 m, the highest ground is about 145 m). The S-400 (while it stands) fuses every emitting unit's tracks into `sim.picture` and links them to the others (`source: 'link'`). Command-guided missiles (48N6, 57E6, 9M33) need the unit's channel (`channelSees`, `unit.channel`) to hold the target and self-destruct after 3 s without it; the 9M96 and 9M37 are not command-guided, so they fly on and home on their own seekers when the track is lost. Emitting units can be targeted by the attackers' radar-seeking missiles, which miss when the emitter goes silent early. The sim is deterministic per seed: take randomness from `sim.rng` (`ballistics.fire` takes `{ rng }`), never `Math.random`. AI crews (`mode: 'auto'`) are tuned to be imperfect so the player matters: **after touching `SYSTEMS`, `MISSILES`, `THREATS`, `WAVES`, the lull or the crew logic, re-run `tools/simtest.mjs`**. Balance on Normal (`--all`, seeds 1 to 144, the finished tree with the reload jobs, their realistic durations and the 40 s lull): all-auto won 29, the scripted S-400 117 and the scripted S-400 with the Pantsirs 127 of 144 (all alternatives: 51 / 110 / 132), with every layer getting kills; every single swap (seeds 1 to 72) keeps the scripted area player (the S-400, or the Buk in its place) within 10 points of the default's 56 of 72; on Hard (seeds 1 to 48) 0 / 7 / 17 of 48, on Easy 48 of 48 for all three. Keep the all-auto crews losing most games and the scripted player winning most (about 70 to 85 %) on Normal, the swaps within about 15 points of the default; on Hard the scripted S-400 should win only a few. Single games flip near the loss line, so 72 seeds swing by about 5 games with any small change; decide on 72 seeds or more (DESIGN.md "Balance").

### Rendering

`render/units.js` builds one rig per vehicle (`models/vehicles.js`: pivots `turret`, `elevation`, `searchRadar`, `trackRadar`, `erector`; anchors `eye`, `sight`, `muzzles`, `missileSlots`) and the airbase (`models/site.js`), and poses them from the sim. `render/entities.js` draws every threat and interceptor as instanced meshes, one `InstancedMesh` per model part (`models/threats.js`: spinning parts carry `spin` axis and `pivot`), orientation from `fwd` and `bank`. `sight.js` renders the scene again at 320x200 into a float target, reads it back and tone-maps it into the console's sight canvas at ~15 Hz.

Vehicles are one builder per file in `src/models/v/` (`tel.js` the 5P85SM2-01 on the MAZ-543M, not an MZKT-7930; `radar92n6.js` on the MZKT-7930; `search91n6.js`, laid out after the 64N6E2 because no 91N6E photo was found, with the MAZ-543 family cab from `maz543.js`; `cp55k6.js` on a Ural-532301 with `ural.js`; `pantsir.js` with `kamaz.js`; `osa.js` with `baz5937.js`; `strela.js` with `mtlb.js`), wired through `models/vehicles.js`, and each keeps the rig contract. `models/s400.js` and `models/shortrange.js` are the old builders and nothing imports them any more. Model changes follow the reference workflow: `refs/<group>/README.md` sheets (dimensions, profiles, feature checklists, photo index with licences) and `refs/<group>/photos/` from Wikimedia Commons are local reference only (gitignored, not part of the game). Compare renders from `/models.html?kind=<kind>` with the photos from matching angles, check the `&ortho=` blueprint views (1 m grid, 5 m lines darker) against the dimension tables, and iterate.

Framework pieces from maxgfx keep their rules: `shaderlib.js` overrides three's fog/lighting chunks globally and `patchMaterial` needs a unique key per patch; materials created after `patchSceneFog` must patch themselves; `fx.js` keeps a fixed pool of lights (never add or remove lights at runtime). Every round leaves its own canister, tube, container, cell or rail: main's `ev.launch` moves it onto its slot anchor (`SLOT_AT`, a visual correction of the sim's one launch point per vehicle; hits are unaffected) and bursts or throws off its cover (`fx.coverBurst`, `fx.throwLid`). The S-400 rounds leave their canisters with `fx.coldLaunch` (gas puff, no flame) and light with `fx.ignition`; `fx.burnSite` keeps at most 8 ground fires. `render/entities.js` enlarges distant flyers to stay visible and keeps a second, unscaled instance set for the sight renders (`entities.plain(on)`, called by `sight.update(..., entities)`).

### UI (`src/ui/`) and audio (`src/audio.js`)

`Panel` reads only the data passed to `update` and talks back through `onSelect` and `onCommand(unitId, name, args)` (command table in DESIGN.md); one console per kind in `ui/consoles/`. It owns the console keys (Tab, Space, R, T, G, U, A, arrows, Q, L); main owns 1 to 5, C, V, F, M, H, F3, `[` and `]`. Each console has a status line under the header and a selected-track bar; a control that the AI crew would undo (slew, trigger, uncage, launch) first switches the unit to manual (`takeManual`). `AudioEngine` renders its banks at `start()` (a user gesture), lays the recordings over them when decoded, routes world sounds with travel delay and air absorption, runs threat engine loops with Doppler, the Pantsir gun loops, the Strela seeker tone and the console sounds.
