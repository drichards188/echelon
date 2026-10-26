# Development

Back to the [README](../README.md).

## Running it

```bash
npm install
npm run dev      # http://localhost:5200 (also reachable from other machines on your network)
npm run build    # production bundle in dist/
npm run preview  # serves dist/ on http://localhost:4173
```

- **What you need.** Node.js to run these, and a browser with WebGL2, a keyboard and a mouse to play.
- **The port.** The dev server only uses port 5200: if something else holds it, it stops with an error rather than pick another port.

## Sharing the build

- **Build and serve.** Build it and put `dist/` on a web server.
- **Any folder.** `vite.config.js` sets `base: './'`, so the build loads its files relative to its page and works from a site's root or any folder in it. It still needs a web server: opened straight from disk (`file://`) it fails.
- **itch.io.** Zip what is inside `dist/` (`index.html` at the top of the zip, not in a folder), upload it as an HTML game and tick "This file will be played in the browser". In Embed options pick "Click to launch in fullscreen" (the screen is split in two halves, so it wants room), or embed at 1280 x 720 or larger with the Fullscreen button; leave Mobile friendly and SharedArrayBuffer off.
- **What's in it.** The build holds only the game page. Its first file is the main menu's, small and without three.js; the game's code is fetched when a battle or a lesson starts, and the WW2 era's models and consoles when that era is played. The development pages are not part of it.

## Checks

There are no unit tests, linter or formatter; the checks are the pages and tools below. `DESIGN.md` is the contract between the modules (data shapes, commands, events, how to add an era) with a changelog.

## Development pages

These run on the dev server only.

- **`/models.html?kind=pantsir`** (or `?all=vehicles|threats|interceptors|assets|crew`, `&anim=1`, `&cam=az,el,dist`, `&pit=0` without a gun's emplacement, `&flat=1` only the vertex colours, to check the baked occlusion, `&drill=0..1` a gun's loading machine at that phase): the model viewer.
  - `&ortho=right|left|front|rear|top` (with `kind`) gives an orthographic blueprint view with a 1 m grid (5 m lines darker) for checking proportions.
  - `&era=ID` loads that era's lazily loaded models (and its markings and assets).
  - The rest of its options are listed at the top of `src/dev/modelviewer.js`.
- **`/ui.html?unit=STR`:** the modern era's consoles against a mock battle (`src/ui/mock.js`). `unit` is any modern unit id (`S400`, `P1`, `P2`, `OSA`, `STR`, `BUK`, `T1`, `T2`, `TOR`, `SHK`).
- **`/audio.html`:** a live smoke test of the audio engine.

## URL parameters for the game

- **The pages.** `/` is the main menu: plain HTML, nothing of the world is built (`src/boot.js`). **`?play=1`** is a battle's page and **`?tutorial=ID`** a lesson's (see [Tutorials](PLAYING.md#tutorials)): its loading card at once, then the world is built and the game starts. The menu's buttons open these; on the menu, **`?lessons=1`** opens the tutorial list.
- **`?quality=Low|Medium|High|Ultra`** (default Medium) and **`?dev=1`** pass between the menu and the game. **`?difficulty=Easy|Normal|Hard`** sets a battle's (default: the one the menu kept, else Normal). **`?unit=N`** selects unit N, counted from 0 in slot order.
- **`?era=modern`** or **`?era=ww2`** starts in that era without saving it (on the menu: shows it). `?dev=1` would let an era still marked in development be played (none is at present).
- **`?loadout=buk,tunguska,pantsir,tor,shilka`** starts with that loadout without saving it. Give the kinds in slot order; empty entries or anything a slot does not offer take the default; `alt` picks every slot's first alternative (slot 5's Shilka; the Gepard is `gepard`).

## `window.__iads`

- **Game pages only.** The menu builds no systems, so it has no `__iads`.
- **Systems.** It exposes every system: `sim`, `renderer`, `scene`, `camera`, `terrain`, `post`, `fx`, `hud`, `panel`, `audio`, `tutorial`, `params` and more.
- **Functions.** `select(i)`, `start()`, `setTimeScale(k)`, `setLoadout(kinds)`, `setEra(id)` and `frame(dt, draw)` (one frame).
- **`fastForward(seconds, { unit, scale })`** stops the loop, runs the battle without drawing, draws a few frames and returns a summary.
- **State and hooks.** `state`, `era`, `eras`, `events` (start, select) and `onFrame` (per-frame callbacks).
- **Local storage** keeps `echelon.era`, the loadout per era in `echelon.loadout.<era>`, `echelon.difficulty` and the finished lessons in `echelon.tutorials` (`src/choices.js`).

## Tools

**`node tools/simtest.mjs 1 2 3 --both --quiet`** plays whole battles headless, all-auto against a scripted S-400 player. Each game prints a per-wave summary.

- **Players.** `--all` adds a player who also runs both Pantsirs; `--players auto,s400,full` picks them.
- **Setup.** `--difficulty Easy|Normal|Hard|all` sets the difficulty, `--era ID` the era (default `modern`), `--loadout KINDS|alt` the units.
- **Output.** `--table` prints only the summary, `--quiet` leaves out each game's first radio lines, `--log` prints its whole radio log.
- **Speed.** `--jobs N` sets the worker threads.
- **WW2.** With `--era ww2` the scripted players are the WW2 era's (a heavy battery player, and one who also runs the platoons) and the columns are its slots, with the heavy battery's own 2 cm guns apart (B20).

**`node tools/audiotest.mjs`** renders every synthesized sound bank offline and reports levels (`--era ww2` adds the WW2 era's).

**`node tools/shot.mjs "/?play=1&unit=1&quality=Low" shots/x.png --until "window.__iads?.state === 'playing'" --eval "window.__iads.fastForward(60)"`** makes a headless capture of the game.

- **Options.** `--size WxH` (default 1600x900) and `--wait ms`.
- **Needs** the dev server running. It launches its own headless Chromium from `~/.cache/ms-playwright`.

**`node tools/menushots.mjs [kind ...]`** takes the main menu's background stills from the game itself: for each unit kind, a battle with it in its slot, run on until it fires, the console and overlay hidden. It writes `public/menu/<kind>.jpg`.

- **Options.** `--size WxH` (default 1920x1080), `--quality` (default High), `--out dir`.
- **Check them.** Each run plays a new battle, so look at the pictures before keeping them.

## Model work

- **Reference sheets.** Each vehicle and gun is rebuilt against reference sheets in `refs/<group>/`: a `README.md` with dimensions, profiles, a feature checklist and a photo index with licences, plus `photos/`, mostly from Wikimedia Commons.
- **Local only.** The folder is gitignored and only for local reference, not part of the game.
- **The method.** Compare viewer renders with the photos from matching angles, check the blueprint views against the dimension tables, and iterate.
- **Captures** go in `shots/`, also gitignored.
- **The flak towers.** The gun tower, the fire control tower, the 12.8 cm twin and the Wuerzburg-Riese are matched to `refs/ww2/flakturm/` (24 photos: the Berlin and Hamburg towers, the twin at Aberdeen).

## Libraries

- **Runtime:** [three.js](https://threejs.org) (MIT), including its add-ons (post-processing passes, the sky, geometry utilities, the stats panel), and [lil-gui](https://lil-gui.georgealways.com) (MIT) for the settings panel.
- **Development only:** [Vite](https://vite.dev) (MIT), and playwright-core (Apache 2.0) for `tools/shot.mjs` and `tools/menushots.mjs`.

## Layout

```
index.html         the game page; models.html, ui.html, audio.html the development pages
vite.config.js     the dev server on port 5200
public/audio/      the recordings and CREDITS.md
public/menu/       the main menu's stills, one per unit kind (tools/menushots.mjs)
docs/              the README's screenshot and these pages (PLAYING, MODELLED, HISTORY, DEVELOPMENT)
tools/             simtest.mjs, audiotest.mjs, shot.mjs, menushots.mjs
src/
  boot.js          the page's entry: the WebGL check (ui/gpu.js), then the main menu, or a game page (?play=1, ?tutorial=ID) that loads main.js
  choices.js       the era, loadout and difficulty kept between the menu and the game, and the URLs between them
  main.js          a game page: renderer, quality presets, settings, game flow, event wiring, main loop
  style.css        the page, the main menu, the loading card, the HUD and the tutorial card
  eras/            one module per era: map layout, slots and options, raids, text, alert captions, theme
    index.js       the registry (ERAS), the derived default loadouts, loadEra (an era's lazily loaded content)
    modern.js      the modern era (the airbase on the steppe)
    ww2.js         the WW2 era: Fliegerhorst Hopsten, February to March 1945, its flak, six day raids
    ww2/           the WW2 era's lazily loaded content (content.js): terrain.js (Hopsten's landscape),
                   models/ (the guns, the Kommandogeraet, the Wuerzburg, the flak tower and its 12.8 cm twins,
                   the airfield buildings and the Me 262, the crews), aircraft/ (the Allied aircraft and their
                   bombs and rockets), consoles/ (battery, platoon,
                   turm: the flak tower's gun selector, plot, wurzburg, sights)
  deploy.js        the era in play (setEra) and where everything sits (units, their vehicles, the assets), bearing helpers
  sim/             the battle, pure logic (runs in Node)
    sim.js         Sim: update order, events, damage, targets for the attackers, radio
    systems.js     game values: fire units, missiles, threats, difficulty
    sensors.js     search radars and lookouts, tracks, the fused picture, the data link and the WW2 plot
    units.js       fire units: commands, AI crews, engagements, guns, Strela seeker, reload jobs
    mounts.js      gun units of several mounts (WW2): the predictor, salvos and barrage, the platoons' guns and feeds, the flak tower's groups
    missiles.js    interceptor flight and hit resolution
    threats.js     threat behaviour and the weapons aircraft release
    planes.js      the WW2 aircraft's attack roles (recon, strafing, dive bombing, rockets, bomber boxes, escorts), bombs, rockets, Window
    director.js    the raids, lulls, resupply, repairs, win and loss
    flight.js      shared kinematics
  ballistics.js    shells and tracers: the 30 and 23 mm, the WW2 8.8 and 12.8 cm (time fuzes, bursts), 3.7 and 2 cm
  render/
    units.js       vehicles, guns and buildings bound to the sim (turrets, radars, erectors, launcher slots, recoil, wrecks), rebuilt when the loadout or era changes
    entities.js    everything that flies, instanced, with plumes and wreck trails (distant flyers are enlarged to stay visible)
    reload.js      the reload scenes' driver; reload/ one scene per unit kind (s400, buk, pantsir, tunguska, osa, tor, strela, shilka) and their shared helpers
  sight.js         the consoles' sight pictures (the modern sights, the WW2 gun sights and the predictor's telescope)
  ui/              menu.js (the main menu), loading.js (a game page's loading card), backdrop.js (their stills),
                   gpu.js (the card when graphics acceleration is off);
                   the right half: panel.js (the unit tabs and the console), consoles/ (one per modern kind, common.js),
                   scope.js, tracktable.js, sightview.js, widgets.js, highlight.js (the tutorials' frames), fallback.js;
                   mock.js, mockbuktor.js, mockloadout.js for ui.html
  audio.js         audio engine: synthesized banks, recordings, threat engines, gun loops, seeker tone, music
  terrain.js       the terrain clipmap and an era's ground style; terrainHeight.js the pure height and line of sight; terrainField.js the field patchwork
  vegetation.js    trees and windbreak rows (the steppe's poplars, broadleaves, birches and bushes; the WW2 era's pines,
                   oaks, birches, shrubs and junipers, and its farmhouses, barns and churches); grass.js  grass
  camera.js        third-person chase camera with padlock, missile chase (F), a cinematic orbit and free modes
  tutorial.js      the tutorials: lessons as lists of steps run on a scripted range (sim.newGame({ scripted: true })) and their cards
  hud.js           overlay on the 3D view: unit, compass, radio, toasts, bracket, end screen
  atmosphere.js    the sky, stars and moon, sun light and the image-based light baked from the sky
  clouds.js        drifting cumulus billboards
  weather.js       the four weathers: rain, lightning, wind
  post.js          the post-processing chain
  shaderlib.js     shared shader uniforms, height fog, cloud shadows and wet surfaces
  noise.js         noise functions and a seeded random number generator
  fx.js            particles, fires, bursts, debris, spent cases
  models/          procedural vehicles, threats, interceptors and the modern airbase
    vehicles.js    the vehicle registry; one builder per vehicle in v/: the fire units (tel, radar92n6, search91n6, cp55k6,
                   pantsir, osa, strela, buk, bukradar, tunguska, tor, shilka, gepard), the reload vehicles (t22t6, t5t58, t9t217,
                   t9t244, tzmpantsir, t2f77m, kamaz5350), their chassis (maz543, ural, kamaz, baz5937, mtlb, gm352, gm355,
                   gm567, gm569, gm575, leopard1), crew.js (the reload crews) and swap.js
    threats.js     the attackers and the interceptors; site.js the modern airbase; markings.js the national markings
    kit.js, rig.js, trucks.js   shared modelling helpers
  dev/             modelviewer.js and audiotest.js, behind models.html and audio.html
```
