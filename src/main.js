import * as THREE from 'three';
import GUI from 'lil-gui';
import Stats from 'three/examples/jsm/libs/stats.module.js';

import { globalUniforms, patchSceneFog } from './shaderlib.js';
import { Atmosphere } from './atmosphere.js';
import { Terrain } from './terrain.js';
import { Clouds } from './clouds.js';
import { Weather, WEATHER } from './weather.js';
import { PostFX, GRADES } from './post.js';
import { FX, SMOKE } from './fx.js';
import { HUD } from './hud.js';
import { ChaseCamera } from './camera.js';
import { UNITS, SLOT_OPTIONS, DEFAULT_LOADOUT, ERA, setEra as deployEra } from './deploy.js';
import { ERAS, eraById, playableEra, loadEra } from './eras/index.js';
import { heightAt, los } from './terrain.js';
import { Sim } from './sim/sim.js';
import { SYSTEMS, THREATS, MISSILES } from './sim/systems.js';
import { buildInterceptor } from './models/threats.js';
import { UnitViews } from './render/units.js';
import { Entities } from './render/entities.js';
import { SightRenderer, sightPose } from './sight.js';
import { Panel } from './ui/panel.js';
import { AudioEngine } from './audio.js';
import { Tutorials } from './tutorial.js';

const QUALITY = {
  Low: { pixelRatio: 0.75, shadowMap: 2048, shadowExtent: 100, ao: false, raySamples: 16, dofSamples: 16, fx: 0.5, maxSmoke: 3500 },
  Medium: { pixelRatio: 1, shadowMap: 2048, shadowExtent: 120, ao: true, raySamples: 32, dofSamples: 32, fx: 0.75, maxSmoke: 5500 },
  High: { pixelRatio: 1.5, shadowMap: 4096, shadowExtent: 140, ao: true, raySamples: 48, dofSamples: 48, fx: 1, maxSmoke: 7000 },
  Ultra: { pixelRatio: 2, shadowMap: 4096, shadowExtent: 160, ao: true, raySamples: 64, dofSamples: 64, fx: 1.25, maxSmoke: 9000 },
};
const TIME_SCALES = [0.25, 0.5, 1, 2, 4, 8];

const hud = new HUD();
const tick = () => new Promise((r) => setTimeout(r, 0));
const step = async (p, msg) => {
  hud.setLoading(p, msg);
  await tick();
};
const query = new URLSearchParams(location.search);
// Development override: with ?dev=1 an era still in development (`available: false`) can be played, from
// ?era=<id> or __iads.setEra(id); the menu still shows it greyed out and it is never kept in storage.
const DEV = query.get('dev') === '1';
const canPlay = (era) => !!era && (era.available || DEV);

const KILL_NAME = { fighter: 'fighter', decoy: 'decoy', cruise: 'cruise missile', drone: 'drone', arm: 'ARM', glide: 'glide bomb', helo: 'helicopter', atgm: 'ATGM', tbm: 'ballistic missile' };
const CLS_SHORT = { aircraft: 'AC', cruise: 'CM', drone: 'UAV', arm: 'ARM', tbm: 'TBM', helo: 'HELO', bomb: 'BOMB', decoy: 'DCY', atgm: 'ATGM', unknown: '?' };
// the WW2 era's aircraft (the kill toasts) and track classes (the compass and the bracket), and its guns'
// shells as the kill toasts name them
Object.assign(KILL_NAME, { p51: 'Mustang', p47: 'Thunderbolt', typhoon: 'Typhoon', tempest: 'Tempest', a26: 'Invader', b17: 'Fortress', recon: 'Spitfire PR', gpbomb: 'bomb', rp3: 'rocket' });
Object.assign(CLS_SHORT, { bomber: 'BMR', fighter: 'FTR', recon: 'RCN', rocket: 'RKT', window: 'WIN' });
const WEAPON_NAME = { '88mm': '8.8 cm', '37mm': '3.7 cm', '20mm': '2 cm' };
// fx and sound sizes of interceptor warheads and of enemy warheads arriving
const MSIZE = { '48N6': 1.4, '9M96': 1, '57E6': 0.6, '9M33': 0.8, '9M37': 0.5, '9M317': 1.1, '9M338': 0.7, '9M311': 0.55 };
const COLD = { '48N6': 1.5, '9M96': 1.0, '9M338': 0.7 }; // cold-launched rounds: fx size
// shell hits: sparks, no burst
const SHELL = new Set(['30mm', '23mm']);
// the gun units' muzzle flash and the sound of their guns (audio.gun's `shell`; the sim's otherwise)
const FLASH = { '30mm': 0.7, '23mm': 0.5 };
const GUN_VOICE = { tunguska: '30mm-tunguska' };
// sight pictures: monochrome TV channels (the Pantsir's, and as it the Tunguska's and Shilka's) or
// the Strela's direct-view optics
const MONO_SIGHT = new Set(['pantsir', 'tunguska', 'shilka']);
// Every round leaves from its own slot on the model, along the slot's axis (refs/launch): 'mouth' when
// the slot anchor is the canister, tube, container or cell mouth (the round starts inside, its nose
// there; an S-400 TEL finds its canister lip or 9M96 cell through rig.mouth), 'centre' when it is the
// round's centre on a rail (Buk). See ev.launch.
const SLOT_AT = {
  's400-tel': 'mouth', pantsir: 'mouth', tunguska: 'mouth', osa: 'mouth', strela: 'mouth', tor: 'mouth',
  'buk-telar': 'centre', 'buk-loader': 'centre',
};
// Spent cases and links (refs/launch). The 2A38M (Pantsir, Tunguska) throws its cases back and out of
// the receiver, as the Pantsir firing photo shows (an arc to the side and rear of the turret, more on
// the ground behind the truck), with its links and a lick of flame and smoke at the port; the Shilka's
// 2A7s drop theirs out of the turret front under the guns onto the hull (no source found: the usual
// arrangement for guns in an enclosed turret). back: muzzle to ejection port along the bore (m); v:
// [out, up, back] in the gun's frame (m/s; the Shilka's back is forward, along the hull); d, len: the case.
const BRASS = {
  pantsir: { back: 3.2, v: [4.5, 2.5, 5], d: 0.03, len: 0.165, flame: true },
  tunguska: { back: 3.3, v: [4, 2, 4.5], d: 0.03, len: 0.165, flame: true },
  shilka: { back: 1.7, front: true, v: [0.6, -0.8, 2.2], d: 0.025, len: 0.152 },
};

// ---------------------------------------------------------------- era and loadout
// The era (src/eras) and, for each era, the loadout the title screen's picker chose (one option per slot
// of its SLOT_OPTIONS; the slots' classes, short names and trade-offs come from the era's `slots`) are
// kept in local storage: `echelon.era` and `echelon.loadout.<era>`. Before there were eras the loadout
// was kept under `echelon.loadout`: it was the modern era's and moves to its key.
const ERA_KEY = 'echelon.era';
const LOADOUT_KEY = 'echelon.loadout';
const loadoutKey = (era) => `${LOADOUT_KEY}.${era}`;
const stored = (key) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null; // private mode
  }
};
const store = (key, value) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    // private mode: the choice lasts until the page is reloaded
  }
};
const migrateLoadout = () => {
  try {
    const old = localStorage.getItem(LOADOUT_KEY);
    if (old === null) return;
    if (localStorage.getItem(loadoutKey('modern')) === null) localStorage.setItem(loadoutKey('modern'), old);
    localStorage.removeItem(LOADOUT_KEY);
  } catch {
    // private mode: nothing was kept
  }
};
// one offered kind per slot of the era in play, the slot's default for anything else
const validLoadout = (kinds) => SLOT_OPTIONS.map((opts, i) => (opts.some((o) => o.kind === kinds?.[i]) ? kinds[i] : opts[0].kind));
// the loadout kept for the era in play; `q` (the ?loadout= parameter: kinds in slot order, or 'alt' for
// every alternative) overrides it without being kept
const savedLoadout = (q = null) => {
  if (q) return validLoadout(q === 'alt' ? SLOT_OPTIONS.map((o) => o[1]?.kind) : q.split(','));
  try {
    return validLoadout(JSON.parse(stored(loadoutKey(ERA.id)) || 'null'));
  } catch {
    return [...DEFAULT_LOADOUT];
  }
};
// The era's look on the page: the title screen's text and the class `era-<theme>` for its CSS (the
// console panel takes the same class, Panel.setTheme).
const applyEraLook = () => {
  document.getElementById('title-sub').textContent = ERA.text.sub;
  document.getElementById('title-blurb').textContent = ERA.text.blurb;
  for (const c of [...document.body.classList]) if (c.startsWith('era-')) document.body.classList.remove(c);
  document.body.classList.add(`era-${ERA.theme}`);
};
const WSIZE = { cruise: 1.6, drone: 0.8, arm: 1, glide: 1.8, atgm: 0.6, tbm: 2.6, fighter: 1.2, helo: 1.2, decoy: 0.5, p51: 1, p47: 1.1, typhoon: 1.1, tempest: 1, a26: 1.5, b17: 2, recon: 0.9 };
// the WW2 era's bombs by their size (lb, the models' `lb`): the fx size of the burst (1 for 500 lb)
const BOMB_SIZE = { 100: 0.55, 250: 0.8, 500: 1, 1000: 1.4 };
// the loading screen's lines (an era may bring its own, `text.loading`)
const LOADING = ['Painting the sky', 'Surveying the steppe', 'Laying out the airbase', 'Preparing the lens', 'Compiling shaders'];
const _p = new THREE.Vector3();

async function init() {
  // The era: `?era=` (not kept), else the one kept, else the default; one still in development falls back
  // to the default. Its own modules load first (none for the modern era, whose modules the registries
  // import statically) and its layout is in place before the terrain levels its pads.
  migrateLoadout();
  const asked = eraById(query.get('era'));
  const startEra = DEV && asked ? asked.id : playableEra(query.get('era') ?? stored(ERA_KEY));
  await loadEra(startEra);
  deployEra(startEra);
  applyEraLook();

  const view = document.getElementById('view');
  const canvas = document.getElementById('c');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
  const size = () => ({ w: Math.max(2, view.clientWidth), h: Math.max(2, view.clientHeight) });
  let { w: vw, h: vh } = size();
  renderer.setPixelRatio(Math.min(devicePixelRatio, QUALITY.High.pixelRatio));
  renderer.setSize(vw, vh, false);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.shadowMap.autoUpdate = false;
  renderer.info.autoReset = false;

  const scene = new THREE.Scene();
  // far enough for the ridges and the horizon haze; the near plane suits a camera 8 m from a vehicle
  const camera = new THREE.PerspectiveCamera(50, vw / vh, 0.4, 80000);
  camera.position.set(0, 20, 60);

  const startQuality = QUALITY[query.get('quality')] ? query.get('quality') : 'Medium';

  const loading = ERA.text.loading ?? LOADING;
  await step(0.05, loading[0]);
  const atmosphere = new Atmosphere(renderer, scene);

  await step(0.15, loading[1]);
  const terrain = new Terrain(scene, { quality: startQuality });
  const clouds = new Clouds(scene);

  await step(0.45, loading[2]);
  const fx = new FX(scene, { maxSmoke: QUALITY[startQuality].maxSmoke });
  fx.ground = terrain.heightAt;
  const weather = new Weather(scene, null);

  // ---------------------------------------------------------------- the battle
  // The sim runs a demonstration battle (attract mode: nothing scored, nothing destroyed) behind the
  // title screen; Take command starts the real one. Vehicles, buildings and everything that flies are
  // drawn from its state (src/render), its events drive fx, sound and the HUD.
  const sim = new Sim({ heightAt, los, scene, seed: (Math.random() * 1e9) | 0 });
  const loadout = savedLoadout(query.get('loadout'));
  sim.newGame({ attract: true, loadout });
  const views = new UnitViews(scene, sim);
  const entities = new Entities(scene);
  // the camera anchors by unit id (rebuilt with the rigs when the loadout changes)
  const eyes = {};
  const takeEyes = () => {
    for (const k of Object.keys(eyes)) delete eyes[k];
    for (const u of UNITS) eyes[u.id] = views.eye(u.id);
  };
  takeEyes();

  patchSceneFog(scene);

  await step(0.72, loading[3]);
  const post = new PostFX(renderer, scene, camera);
  const chase = new ChaseCamera(camera, canvas, { ground: terrain.heightAt });
  const sight = new SightRenderer(renderer, scene);
  const audio = new AudioEngine();
  audio.setEra(ERA.id);
  const panelEl = document.getElementById('panel');
  panelEl.replaceChildren();
  const panel = new Panel(panelEl, {
    audio,
    onSelect: (id) => unitKey(UNITS.findIndex((u) => u.id === id)),
    onCommand: (id, name, args) => sim.command(id, name, args),
  });

  // ---------------------------------------------------------------- settings
  const params = {
    quality: startQuality,
    dynamicRes: true,
    timeScale: 1,
    difficulty: 'Normal',
    era: ERA.id,
    loadout,
    fov: 50,
    elevation: 38,
    sunBearing: 215,
    weather: 'Clear',
    exposure: 1.0,
    sunGain: 1.5,
    envIntensity: 0.4,
    autoExposure: true,
    exposureKey: 0.17,
    toneMapping: 'ACES Filmic',
    grade: 'Natural',
    ao: true,
    aoIntensity: 1.0,
    bloom: true,
    bloomStrength: 0.28,
    bloomRadius: 0.5,
    bloomThreshold: 3.0,
    godRays: 0.5,
    lensFlare: 0.5,
    chromatic: 0.003,
    vignette: 0.3,
    grain: 0.025,
    sharpen: 0.35,
    fogDensity: 0.00007,
    fogFalloff: 0.0006,
    turbidity: 3.6,
    rayleigh: 1.5,
    grass: true,
    trees: true,
  };
  // The sun and the weather follow the era (its terrain's `sky`; the modern era's 38 degrees on 215, clear)
  // unless the player has set them in the settings: at start and on every switch of era.
  const SKY = { elevation: 38, sunBearing: 215, weather: 'Clear' };
  const skySet = new Set();
  const applySky = () => {
    const sky = { ...SKY, ...(ERA.terrain?.sky ?? {}) };
    for (const k of ['elevation', 'sunBearing']) if (!skySet.has(k)) params[k] = sky[k];
    if (!skySet.has('weather') && params.weather !== sky.weather) {
      params.weather = sky.weather;
      weather.set(sky.weather);
    }
  };
  applySky();
  let resScale = 1;
  let state = 'title'; // title | playing | ended | tutorial
  let freeCam = false;
  let selected = 0;
  let padlock = false;
  let preDist = 28;
  let following = false; // the camera is on a missile (F)
  let cineClock = 0; // title screen: seconds since the last cut
  let gunFlip = 0;

  const basePixelRatio = () => Math.min(devicePixelRatio, QUALITY[params.quality].pixelRatio);
  const applyPixelRatio = () => {
    renderer.setPixelRatio(basePixelRatio() * (params.dynamicRes ? resScale : 1));
    renderer.setSize(vw, vh, false);
    post.setSize(vw, vh);
  };
  const applyQuality = (name) => {
    const q = QUALITY[name];
    resScale = 1;
    applyPixelRatio();
    atmosphere.setShadowQuality(q.shadowMap, q.shadowExtent);
    params.ao = q.ao;
    post.gtao.enabled = q.ao;
    post.lens.material.defines.RAY_SAMPLES = q.raySamples;
    post.lens.material.needsUpdate = true;
    post.dof.material.defines.SAMPLES = q.dofSamples;
    post.dof.material.needsUpdate = true;
    fx.setBudget(q.fx);
    terrain.setQuality(name);
    gui.controllersRecursive().forEach((c) => c.updateDisplay());
  };
  const toneMaps = {
    'ACES Filmic': THREE.ACESFilmicToneMapping,
    AgX: THREE.AgXToneMapping,
    'Khronos Neutral': THREE.NeutralToneMapping,
    Reinhard: THREE.ReinhardToneMapping,
  };

  const gui = new GUI({ title: 'Settings', container: document.getElementById('gui-host') });
  gui.add(params, 'quality', Object.keys(QUALITY)).name('Quality preset').onChange(applyQuality);
  gui.add(params, 'dynamicRes').name('Dynamic resolution').onChange(() => {
    resScale = 1;
    applyPixelRatio();
  });
  const fPlay = gui.addFolder('Game');
  fPlay.add(params, 'difficulty', ['Easy', 'Normal', 'Hard']).name('Difficulty (next game)').listen();
  fPlay.add(params, 'timeScale', TIME_SCALES).name('Time compression ([ ])').listen().onChange((v) => hud.setTimeScale(v));
  fPlay.add(params, 'fov', 30, 80, 1).name('Field of view');
  const fWorld = gui.addFolder('Time & weather');
  fWorld.add(params, 'elevation', -15, 80, 0.1).name('Sun elevation').listen().onChange(() => skySet.add('elevation'));
  fWorld.add(params, 'sunBearing', 0, 360, 0.5).name('Sun bearing').listen().onChange(() => skySet.add('sunBearing'));
  fWorld.add(params, 'weather', Object.keys(WEATHER)).name('Weather').onChange((v) => {
    skySet.add('weather');
    weather.set(v);
  }).listen();
  fWorld.close();
  const fLand = gui.addFolder('Landscape');
  fLand.add(params, 'grass').name('Grass').onChange((v) => (terrain.grass.mesh.visible = v));
  fLand.add(params, 'trees').name('Trees').onChange((v) => (terrain.trees.group.visible = v));
  fLand.close();
  const fCam = gui.addFolder('Look');
  fCam.add(params, 'grade', Object.keys(GRADES)).name('Color grade').onChange((v) => post.setGrade(v));
  fCam.close();
  const fPost = gui.addFolder('Post processing');
  fPost.add(params, 'autoExposure').name('Auto exposure');
  fPost.add(params, 'exposureKey', 0.05, 0.6, 0.01).name('Exposure key');
  fPost.add(params, 'exposure', 0.1, 3, 0.01).name('Exposure bias');
  fPost.add(params, 'envIntensity', 0, 2, 0.01).name('Sky light (IBL)');
  fPost.add(params, 'sunGain', 0.3, 3, 0.01).name('Sun intensity');
  fPost.add(params, 'toneMapping', Object.keys(toneMaps)).name('Tone mapping');
  fPost.add(params, 'ao').name('GTAO').onChange((v) => (post.gtao.enabled = v)).listen();
  fPost.add(params, 'aoIntensity', 0, 2, 0.01).name('AO intensity');
  fPost.add(params, 'bloom').name('Bloom');
  fPost.add(params, 'bloomStrength', 0, 2, 0.01).name('Bloom strength');
  fPost.add(params, 'bloomRadius', 0, 1, 0.01).name('Bloom radius');
  fPost.add(params, 'bloomThreshold', 0, 10, 0.01).name('Bloom threshold');
  fPost.add(params, 'godRays', 0, 3, 0.01).name('God rays');
  fPost.add(params, 'lensFlare', 0, 3, 0.01).name('Lens flare');
  fPost.add(params, 'chromatic', 0, 0.05, 0.001).name('Chromatic aberration');
  fPost.add(params, 'vignette', 0, 1, 0.01).name('Vignette');
  fPost.add(params, 'grain', 0, 0.15, 0.001).name('Film grain');
  fPost.add(params, 'sharpen', 0, 1.5, 0.01).name('Sharpen');
  fPost.close();
  const fAtmo = gui.addFolder('Atmosphere');
  fAtmo.add(params, 'fogDensity', 0, 0.0004, 0.000005).name('Haze density');
  fAtmo.add(params, 'fogFalloff', 0, 0.01, 0.0001).name('Haze height falloff');
  fAtmo.add(params, 'turbidity', 0, 20, 0.1).name('Turbidity').onChange(() => (atmosphere.lastEnvKey = ''));
  fAtmo.add(params, 'rayleigh', 0, 4, 0.01).name('Rayleigh').onChange(() => (atmosphere.lastEnvKey = ''));
  fAtmo.close();
  post.setGrade(params.grade);

  const guiHost = document.getElementById('gui-host');
  guiHost.classList.add('hidden');
  document.getElementById('gear').addEventListener('click', () => guiHost.classList.toggle('hidden'));

  const stats = new Stats();
  stats.dom.classList.add('stats');
  view.appendChild(stats.dom);

  // ---------------------------------------------------------------- units and camera
  // a multi-launcher unit's camera rides the vehicle that fires its selected missile next (the sim
  // knows: S-400 TEL 2 the 9M96, TELs 1 then 0 the 48N6; a Buk's next TELAR or its loader-launcher), and
  // stays a few seconds on one that has just fired
  let camPart = 0, launchHold = 0;
  const launcherFor = (id) => sim.nextLauncher(id)?.part ?? 0;
  const toLauncher = (part) => {
    camPart = part;
    // keep the player's orbit: the launchers all face the same way
    chase.setTarget(views.eye(UNITS[selected].id, part), { behind: false });
  };
  const selectUnit = (i) => {
    if (i < 0 || i >= UNITS.length) return;
    selected = i;
    const u = UNITS[i];
    freeCam = false;
    following = false;
    chase.free(false);
    camPart = launcherFor(u.id);
    launchHold = 0;
    chase.setTarget(views.eye(u.id, camPart));
    // the HUD's corner is narrow: a role in brackets goes to the callsign line
    const [, name, role] = /^(.*?)(?: \((.*)\))?$/.exec(u.name);
    hud.setUnit(name, role ? `${u.callsign}, ${role}` : u.callsign);
    audio.vehicle(u.kind);
    iads.events.select?.(u.id, i);
  };
  // a unit key or tab: the tutorials keep the player on their unit (the basics lesson teaches the keys)
  const unitKey = (i) => {
    if (tutorial?.active && !tutorial.run.def.free) {
      hud.hint('This lesson stays on one unit. Exit it to switch.', 1800);
      return;
    }
    selectUnit(i);
  };
  // F: chase the selected unit's most recent missile in flight; back to the unit when it ends
  const backToUnit = () => {
    following = false;
    if (state === 'title') chase.cine(true);
    if (!freeCam) {
      camPart = launcherFor(UNITS[selected].id);
      chase.setTarget(views.eye(UNITS[selected].id, camPart));
    }
    chase.goalDist = preDist;
  };
  const followMissile = (m) => {
    freeCam = false;
    if (!following) preDist = chase.goalDist;
    following = true;
    chase.follow(m, backToUnit);
    hud.hint(`Chasing ${m.kind} (F: back to the unit)`, 2200);
  };
  const setTimeScale = (k) => {
    params.timeScale = k;
    hud.setTimeScale(k);
  };
  // one step along TIME_SCALES: the buttons by the readout and [ ]; clicking the readout goes back to x1
  const stepTime = (d) => setTimeScale(TIME_SCALES[Math.min(TIME_SCALES.length - 1, Math.max(0, TIME_SCALES.indexOf(params.timeScale) + d))]);
  const tsEl = document.getElementById('timescale');
  tsEl.addEventListener('pointerdown', (e) => e.stopPropagation()); // no camera drag from the buttons
  document.getElementById('ts-up').addEventListener('click', () => stepTime(1));
  document.getElementById('ts-down').addEventListener('click', () => stepTime(-1));
  document.getElementById('ts-val').addEventListener('click', () => setTimeScale(1));

  const playBtn = document.getElementById('play');
  const diffBtns = [...document.querySelectorAll('#difficulty button')];
  diffBtns.forEach((b) =>
    b.addEventListener('click', () => {
      params.difficulty = b.dataset.d;
      diffBtns.forEach((o) => o.classList.toggle('on', o === b));
    })
  );
  // A new battle (the real one, a tutorial's range or the demonstration): the sim's new game, then the
  // vehicles stand again; when the loadout changed the vehicles are built anew and everything that
  // holds onto units (the camera anchors, the console's tabs and consoles) is rebuilt with them. The
  // caller selects a unit afterwards, which puts the camera on the new rigs.
  const newBattle = (opts) => {
    for (const u of sim.units) if (u.weapons.gun) audio.gun(u.id, false, u.pos);
    audio.stopRattles?.();
    falling.length = 0;
    // the thrown lids hold the old rigs' geometry, and nothing of the last battle should lie about
    fx.clearLitter();
    sim.newGame(opts);
    if (!views.reset(sim)) return;
    views.payloads(sim, SYSTEMS);
    patchSceneFog(scene);
    takeEyes();
    panel.setUnits();
    renderer.compileAsync(scene, camera).catch(() => {});
  };

  const start = () => {
    state = 'playing';
    hud.hideEnd();
    hud.showTitle(false);
    chase.autoOrbit = 0;
    chase.cine(false);
    following = false;
    chase.goalDist = 28;
    newBattle({ difficulty: params.difficulty, loadout: params.loadout, seed: (Math.random() * 1e9) | 0 });
    selectUnit(selected);
    hud.toast('Echelon', ERA.text.sub, 3000);
    hud.setScore(0);
    audio.start();
    audio.vehicle(UNITS[selected].kind);
    audio.mood('brief');
    hud.radio(ERA.text.orders, 'info');
    iads.events.start?.(params.difficulty);
  };
  playBtn.addEventListener('click', start);

  // The loadout picker, next to the difficulty: a row per slot of the era in play with its options and
  // the chosen one's trade-off (another's while the pointer is on it). A change on the title screen
  // rebuilds the demonstration battle with it and cuts to that slot's unit. Built again for another era.
  const pickerEl = document.getElementById('loadout');
  let pickRows = [];
  const buildPicker = () => {
    pickerEl.replaceChildren();
    pickRows = ERA.slots.map(({ cls: slotClass, options: opts }, slot) => {
      const row = document.createElement('div');
      row.className = 'lo-slot';
      const key = document.createElement('span');
      key.className = 'lo-key';
      key.textContent = String(slot + 1);
      const cls = document.createElement('span');
      cls.className = 'lo-class';
      cls.textContent = slotClass;
      const btns = document.createElement('span');
      btns.className = 'lo-opts';
      const desc = document.createElement('span');
      desc.className = 'lo-desc';
      const show = (kind) => (desc.textContent = opts.find((o) => o.kind === kind)?.info ?? '');
      const buttons = opts.map((o) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.dataset.kind = o.kind;
        b.textContent = o.label ?? o.name;
        b.title = `${o.name}: ${o.info ?? ''}`;
        b.addEventListener('click', () => pickOption(slot, o.kind));
        b.addEventListener('pointerenter', () => show(o.kind));
        b.addEventListener('pointerleave', () => show(params.loadout[slot]));
        btns.appendChild(b);
        return b;
      });
      row.append(key, cls, btns, desc);
      pickerEl.appendChild(row);
      return { buttons, show };
    });
    showLoadout();
  };
  const showLoadout = () =>
    pickRows.forEach((r, slot) => {
      for (const b of r.buttons) b.classList.toggle('on', b.dataset.kind === params.loadout[slot]);
      r.show(params.loadout[slot]);
    });
  buildPicker();
  // Sets the loadout for the next battles and keeps it (for the era in play). On the title screen the
  // demonstration battle is rebuilt with it; during a battle (tests, the console) a new battle starts
  // with it; during a tutorial it waits for the next Take command (the lessons run on the default units).
  const setLoadout = (kinds, { save = true, cut = -1 } = {}) => {
    params.loadout = validLoadout(kinds);
    if (save) store(loadoutKey(ERA.id), JSON.stringify(params.loadout));
    showLoadout();
    if (state === 'title') {
      following = false;
      newBattle({ attract: true, loadout: params.loadout, seed: (Math.random() * 1e9) | 0 });
      cineClock = 0;
      selectUnit(cut >= 0 ? cut : selected);
    } else if (state === 'playing' || state === 'ended') start();
    return UNITS.map((u) => u.id);
  };
  const pickOption = (slot, kind) => {
    if (params.loadout[slot] === kind) return;
    const next = [...params.loadout];
    next[slot] = kind;
    setLoadout(next, { cut: slot });
  };

  // The era toggle, the title screen's main control: a button per era (eras/index.js ERAS), the era's
  // years under its name; an era still in development shows greyed out with its tag and cannot be
  // picked. The line under it is the setting of the era in play (another's while the pointer is on it).
  const eraEl = document.getElementById('era');
  const eraDesc = document.getElementById('era-desc');
  const showSetting = (era) => (eraDesc.textContent = era.text.setting ?? '');
  const eraBtns = ERAS.map((era) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.era = era.id;
    b.setAttribute('role', 'radio');
    b.innerHTML = '<b></b><span><small></small></span>';
    b.querySelector('b').textContent = era.name;
    b.querySelector('small').textContent = era.years;
    b.title = `${era.name}, ${era.years}`;
    if (!era.available) {
      b.classList.add('soon');
      b.setAttribute('aria-disabled', 'true');
      b.querySelector('span').insertAdjacentHTML('beforeend', '<em>In development</em>');
      b.title += ': in development';
    }
    b.addEventListener('click', () => setEra(era.id));
    b.addEventListener('pointerenter', () => showSetting(era));
    b.addEventListener('pointerleave', () => showSetting(ERA));
    eraEl.appendChild(b);
    return b;
  });
  const showEras = () => {
    for (const b of eraBtns) {
      b.classList.toggle('on', b.dataset.era === ERA.id);
      b.setAttribute('aria-checked', String(b.dataset.era === ERA.id));
    }
    showSetting(ERA);
  };
  showEras();
  // Sets the era for the next battles and keeps it. Its modules load first (eras/index.js loadEra), then
  // the layout (deploy.js), the terrain's pads, the vehicles and buildings, the title screen's text and
  // theme, the loadout picker (with the loadout kept for that era) and the tutorial list follow it. On
  // the title screen the demonstration battle is rebuilt in it; during a battle a new battle starts in it.
  // Refused for an era still in development and during a tutorial. Resolves to the era's id, or false.
  let eraAsk = 0;
  const setEra = async (id, { save = true } = {}) => {
    const era = eraById(id);
    if (!canPlay(era) || state === 'tutorial') return false;
    const ask = ++eraAsk;
    await loadEra(era.id);
    // a later pick overtook this one while its modules loaded
    if (ask !== eraAsk || state === 'tutorial') return false;
    if (save && era.available) store(ERA_KEY, era.id);
    if (era === ERA) return era.id;
    deployEra(era.id);
    audio.setEra(era.id);
    applySky();
    params.era = era.id;
    params.loadout = savedLoadout();
    applyEraLook();
    panel.setTheme(ERA.theme);
    terrain.relayout(camera);
    entities.sync();
    showEras();
    buildPicker();
    tutorial.buildMenu();
    document.getElementById('tutorials').disabled = !ERA.tutorials.length;
    selected = 0;
    if (state === 'title') {
      following = false;
      newBattle({ attract: true, loadout: params.loadout, seed: (Math.random() * 1e9) | 0 });
      cineClock = 0;
      selectUnit(0);
    } else if (state === 'playing' || state === 'ended') start();
    return era.id;
  };

  // ---------------------------------------------------------------- tutorials (src/tutorial.js)
  // A tutorial runs the sim in scripted mode (no director, nothing destroyed); leaving it goes back to
  // the demonstration battle behind the title screen.
  const tutorial = new Tutorials({
    sim,
    hud,
    host: {
      enter(def) {
        state = 'tutorial';
        hud.showTitle(false);
        hud.hideEnd();
        chase.autoOrbit = 0;
        chase.cine(false);
        following = false;
        padlock = false;
        chase.goalDist = 28;
        // the lessons run on the default units, or with their own vehicle swapped in (def.loadout); leave() puts the player's loadout back
        newBattle({ scripted: true, loadout: def.loadout ?? DEFAULT_LOADOUT, seed: (Math.random() * 1e9) | 0 });
        setTimeScale(1);
        hud.setScore(0);
        audio.start();
        audio.mood('wave');
        selectUnit(UNITS.findIndex((u) => u.id === def.unit));
      },
      leave() {
        following = false;
        padlock = false;
        setTimeScale(1);
        newBattle({ attract: true, loadout: params.loadout, seed: (Math.random() * 1e9) | 0 });
        state = 'title';
        audio.mood('brief');
        audio.ctx?.suspend?.();
        hud.showTitle(true);
        cineClock = 0;
        chase.goalDist = 70;
        chase.cine(true);
        selectUnit(selected);
      },
      cam: () => ({ yaw: chase.goalYaw, dist: chase.goalDist }),
      scale: () => params.timeScale,
      setScale: (k) => setTimeScale(k),
      selectedId: () => UNITS[selected].id,
      padlock: () => padlock,
      following: () => following,
      hint: (text) => hud.hint(text, 3500),
    },
  });
  document.getElementById('tutorials').addEventListener('click', () => tutorial.openMenu());

  addEventListener('keydown', (e) => {
    if (e.code === 'Escape' && tutorial.escape()) return;
    if (e.repeat || e.target.closest?.('input, textarea, select')) return;
    if (/^Digit[1-5]$/.test(e.code) && !e.ctrlKey) unitKey(Number(e.code.slice(5)) - 1);
    else if (e.code === 'KeyF' && !e.ctrlKey && !e.metaKey) {
      if (following) {
        backToUnit();
        return;
      }
      const uid = UNITS[selected].id;
      let m = null;
      for (const x of sim.missiles) if (x.alive && x.unitId === uid && (!m || x.id > m.id)) m = x;
      if (m) followMissile(m);
      else hud.hint('No missile in flight from this unit', 1800);
    } else if (e.code === 'KeyC') {
      following = false;
      freeCam = !freeCam;
      if (freeCam) {
        chase.free(true);
        chase.goalDist = 500;
        chase.goalPitch = 0.4;
        hud.hint('Free camera: drag to orbit, wheel to zoom, WASD to move, C to return', 3500);
      } else selectUnit(selected);
    } else if (e.code === 'BracketRight') stepTime(1);
    else if (e.code === 'BracketLeft') stepTime(-1);
    else if (e.code === 'KeyH') document.body.classList.toggle('ui-hidden');
    else if (e.code === 'KeyM') hud.hint(audio.toggleMute() ? 'Sound off' : 'Sound on', 1500);
    else if (e.code === 'KeyV') {
      padlock = !padlock;
      hud.hint(padlock ? 'Padlock: the camera keeps the selected track in view (V)' : 'Padlock off', 2500);
    }
    else if (e.code === 'F3') {
      e.preventDefault();
      document.body.classList.toggle('debug');
    }
  });

  new ResizeObserver(() => {
    ({ w: vw, h: vh } = size());
    camera.aspect = vw / vh;
    camera.updateProjectionMatrix();
    renderer.setSize(vw, vh, false);
    post.setSize(vw, vh);
  }).observe(view);

  // ---------------------------------------------------------------- battle events
  const ev = sim.events;
  // Every round leaves its own canister, cell, tube, container mouth or rail, along its axis. The sim
  // launches all the rounds of a vehicle from one game point (`launchY` over it, along the bore or
  // straight up) and cannot know the models (it runs in Node; they use canvas textures), so at the launch
  // event the round is moved onto its slot (SLOT_AT): a visual correction of a few metres before its first
  // flight step, after which the sim flies it on from there as before. Hits are unaffected (they are
  // resolved at the target, kilometres off, by the hit table) and the headless sim (tools/simtest.mjs)
  // never applies it. The cover the round breaks through goes with it: the S-400's canister dome or 9M96
  // cell cover and the Pantsir's and Tunguska's tube caps burst into pieces (fx.coverBurst), the Osa's and
  // Strela's container lids are blown off whole (fx.throwLid); a Tor cell's hatch is opened by UnitViews,
  // a Buk round sits on an open rail. Which cell of a 9M96 pack: the rounds left on the vehicle count down
  // through the packs and their cells (the sim fires a pack's last cell first).
  views.payloads(sim, SYSTEMS);
  const _mouth = new THREE.Vector3(), _axis = new THREE.Vector3(), _tail = new THREE.Vector3();
  const toSlot = (u, m, part) => {
    const rig = views.launcher(u.id, m.part), how = SLOT_AT[u.parts[m.part]?.kind];
    if (!rig || !how || !(m.slot >= 0)) return null;
    let cover = rig.cover ?? null;
    if (rig.mouth) {
      const per = rig.perSlot ?? 1, cell = THREE.MathUtils.clamp((part?.rounds ?? 0) - per * m.slot, 0, per - 1);
      cover = rig.mouth(m.slot, cell, _mouth, _axis);
      if (!cover) return null;
      rig.coverOff(m.slot, cell);
    } else {
      const a = rig.anchors.missileSlots[m.slot];
      if (!a) return null;
      a.updateWorldMatrix(true, false);
      _mouth.setFromMatrixPosition(a.matrixWorld);
      _axis.set(0, 0, -1).transformDirection(a.matrixWorld);
    }
    // back by the step the sim moves it in the step that launched it (at its speed after that step), so
    // the nose is at the mouth (or the round on its rail) when first drawn
    const def = MISSILES[m.kind], len = buildInterceptor(m.kind)?.length ?? 3;
    const step = 0.05 * (def?.eject ? Math.max(m.speed - 9.8 * 0.05, 8) : Math.min(def?.speed ?? m.speed, m.speed + (def?.accel ?? 0) * 0.05));
    m.fwd.copy(_axis);
    m.pos.copy(_mouth).addScaledVector(_axis, -((how === 'mouth' ? len / 2 + 0.05 : 0) + step));
    m.vel.copy(_axis).multiplyScalar(m.speed);
    _tail.copy(_mouth).addScaledVector(_axis, -(how === 'mouth' ? len : len / 2));
    return { rig, cover };
  };
  // a container lid blown off whole: a copy of it (sharing its meshes' geometry and materials) set at its
  // centre, flung forward off the mouth by the exhaust and the round, a little up and to a side
  const _lb = new THREE.Box3(), _lc = new THREE.Vector3(), _lv = new THREE.Vector3(), _ls = new THREE.Vector3();
  const throwLid = (lid, axis, speed) => {
    lid.updateWorldMatrix(true, true);
    _lb.setFromObject(lid).getCenter(_lc);
    const outer = new THREE.Group();
    lid.matrixWorld.decompose(_lv, outer.quaternion, _ls);
    outer.position.copy(_lc);
    outer.updateMatrix();
    const inner = lid.clone();
    inner.visible = true;
    inner.matrixAutoUpdate = false;
    inner.matrix.copy(outer.matrix).invert().multiply(lid.matrixWorld);
    outer.add(inner);
    _lv.copy(axis).multiplyScalar(speed * (0.8 + Math.random() * 0.4));
    _lv.x += (Math.random() - 0.5) * 4;
    _lv.y += 2 + Math.random() * 3;
    _lv.z += (Math.random() - 0.5) * 4;
    fx.throwLid(outer, _lv, 5 + Math.random() * 10);
  };
  // the S-400's covers follow the rounds on each TEL (a pack keeps a cover on every cell that still holds
  // a round), so the covers come back as rounds are reloaded, a partial reload included
  const coverRounds = new WeakMap();
  const syncCovers = () => {
    for (const u of sim.units) {
      u.parts.forEach((part, i) => {
        const rig = views.launcher(u.id, i);
        if (!rig?.setCovers || coverRounds.get(rig) === part.rounds) return;
        coverRounds.set(rig, part.rounds);
        const per = rig.perSlot ?? 1;
        for (let k = 0; k < rig.slots.length; k++) rig.setCovers(k, THREE.MathUtils.clamp((part.rounds ?? 0) - per * k, 0, per));
      });
    }
  };
  ev.launch = (u, m, part) => {
    tutorial.onLaunch(u, m);
    const at = toSlot(u, m, part);
    if (at?.cover) fx.coverBurst(_p.copy(_mouth).addScaledVector(_axis, at.cover.size * 0.12), _axis, at.cover.size, at.cover.paint);
    else if (at?.rig.lids?.[m.slot]) throwLid(at.rig.lids[m.slot], _axis, m.kind === '9M33' ? 13 : 10);
    // the S-400's and the Tor's rounds are pushed out of their canisters or cells cold; the others light
    // in the tube or on the rail, the blast at the round's tail (out of the tube's rear)
    if (COLD[m.kind]) fx.coldLaunch(at ? _mouth : m.pos, m.fwd, COLD[m.kind]);
    else fx.launchBlast(at ? _tail : m.pos, m.fwd, MSIZE[m.kind]);
    audio.launch(m.kind, m.pos);
    // a unit of several launcher vehicles: the camera goes to the one that fired and stays a moment
    if (u.parts.length > 1 && u.id === UNITS[selected].id && !freeCam && !following) {
      launchHold = 5;
      if (m.part !== camPart) toLauncher(m.part);
    }
    // the title screen's demonstration battle cuts to a launch now and then
    if (sim.attract && state === 'title' && !following && cineClock > 6) {
      const i = sim.units.indexOf(u);
      if (i >= 0 && i !== selected) selectUnit(i);
      cineClock = 0;
      chase.cine(false);
      followMissile(m);
    }
  };
  // the cold-launched rounds light their motors once clear (the S-400's 20 to 30 m up, the Tor's 16 to
  // 21 m), at the nozzle
  ev.ignite = (m) => {
    _p.copy(m.fwd).multiplyScalar(-(buildInterceptor(m.kind)?.length ?? 0) / 2).add(m.pos);
    fx.ignition(_p, m.fwd, COLD[m.kind] ?? 1);
    audio.ignite?.(m.kind, m.pos);
  };
  const _gx = new THREE.Vector3(), _gy = new THREE.Vector3(), _gz = new THREE.Vector3(), _gp = new THREE.Vector3(), _gv = new THREE.Vector3();
  const jit = (k) => k * (0.7 + Math.random() * 0.6);
  ev.gun = (u, muzzle, dir) => {
    const ms = views.muzzles(u.id);
    const size = FLASH[u.weapons.gun?.shell] ?? 0.7, b = BRASS[u.kind];
    for (let i = gunFlip; i < ms.length; i += 2) {
      fx.muzzle(ms[i].getWorldPosition(_p), dir, size, true);
      if (!b) continue;
      // the gun's frame from its muzzle anchor: x right, y up, z back along the bore; out is away from
      // the turret's middle
      ms[i].matrixWorld.extractBasis(_gx, _gy, _gz);
      const out = Math.sign(ms[i].position.x) || 1;
      _gp.copy(_p).addScaledVector(_gz, b.back);
      if (b.front) {
        // out of the turret front below the guns, falling forward onto the hull
        _gp.y -= 0.3;
        _gv.set(-_gz.x, 0, -_gz.z).normalize().multiplyScalar(jit(b.v[2])).addScaledVector(_gx, (Math.random() - 0.5) * 2 * b.v[0]);
        _gv.y += jit(b.v[1]);
      } else _gv.copy(_gx).multiplyScalar(out * jit(b.v[0])).addScaledVector(_gy, jit(b.v[1])).addScaledVector(_gz, jit(b.v[2]));
      fx.brass(_gp, _gv, b.d, b.len);
      // its link, a little slower
      if (Math.random() < 0.7) fx.brass(_gp, _gv.multiplyScalar(0.6 + Math.random() * 0.3), b.d, b.len, true);
      // the gas out of the port: a puff of grey smoke over the turret and, now and then, a lick of flame
      if (fx.cheap() && Math.random() < 0.5) fx.addSmoke(SMOKE.CORDITE, _gp.x, _gp.y, _gp.z, _gv.x * 0.4, _gv.y * 0.4 + 1, _gv.z * 0.4, 2.5 + Math.random() * 2.5, 0.5, 2.5 + Math.random() * 1.5, 0.55, 0.53, 0.5, 0.3, { drag: 1.5, buoy: 0.5 });
      if (b.flame && Math.random() < 0.2) fx.muzzle(_gp, _gv.normalize(), 0.35, false);
    }
    gunFlip ^= 1;
  };
  ev.detonate = (pos, kind, hit, ground) => {
    if (kind === '37mm' || kind === '20mm') {
      // a WW2 light flak round bursting on an airframe: its high-explosive's flash and sparks
      fx.sparks(pos, kind === '37mm' ? 8 : 5, 25);
      if (kind === '37mm') fx.puff(pos, 0.5);
      return;
    }
    if (SHELL.has(kind)) {
      if (hit) fx.sparks(pos, 5, 25);
      return;
    }
    if (ground) {
      fx.dust(pos, 0.5);
      audio.impact(pos, 0.5);
      return;
    }
    fx.airburst(pos, MSIZE[kind] ?? 1);
    audio.airburst(pos);
  };
  ev.threatKilled = (t, by) => {
    tutorial.onKill(t, by);
    // missiles and bombs break up in the air; aircraft burst into flame and fall
    const size = WSIZE[t.type] ?? 1;
    fx.explosion(t.pos, t.falling ? size * 0.7 : size * 0.8, { debris: true });
    audio.explosion(t.pos, size);
    if (sim.attract) return;
    const u = sim.unitById.get(by.unitId);
    hud.kill(`${u?.callsign ?? by.unitId}: ${KILL_NAME[t.type]}, ${WEAPON_NAME[by.weapon] ?? by.weapon}`, THREATS[t.type].points, by.unitId !== UNITS[selected].id);
    hud.setScore(sim.score.points);
  };
  ev.impact = (t, pos, victim) => {
    if (THREATS[t.type].plane || t.type === 'gpbomb' || t.type === 'rp3') {
      ww2Impact(t, pos, victim);
      return;
    }
    const w = THREATS[t.type].warhead;
    const size = w ? Math.min(3, 0.5 + w[0] / 90) : 0.8;
    fx.dust(pos, size);
    fx.explosion(pos, size * 0.7, { debris: true });
    if (size >= 0.8) fx.burnSite(pos, size, 20 + size * 12);
    audio.impact(pos, size);
    if (victim && !sim.attract) hud.setScore(sim.score.points);
  };
  // a vehicle blows up once: a dispersed unit's (the Buk's) one by one as they are knocked out, and
  // the ones still whole when the unit is out of action stand abandoned
  const blown = new WeakSet();
  const blowUp = (part) => {
    if (blown.has(part)) return;
    blown.add(part);
    fx.explosion(_p.copy(part.pos).setY(part.pos.y + 2), 1.6, { debris: true });
  };
  ev.partDestroyed = (u, i) => {
    blowUp(u.parts[i]);
    audio.explosion(u.parts[i].pos, 2);
  };
  ev.unitDestroyed = (u) => {
    for (const part of u.parts) if (!(part.hp > 0)) blowUp(part);
    audio.explosion(u.pos, 2.5);
  };
  ev.radio = (text, kind) => {
    tutorial.onRadio(text);
    if (!sim.attract) hud.radio(text, kind);
  };
  ev.wave = (n, title, sub) => {
    if (sim.attract) return;
    hud.toast(title, sub, 5000);
    audio.ui('alarm');
  };
  ev.state = (s) => {
    audio.mood(s);
    if ((s === 'victory' || s === 'defeat') && !sim.attract && state === 'playing') endGame(s);
  };
  // ---------------------------------------------------------------- the WW2 era's flak and air attack
  // (sim/mounts.js, sim/planes.js; DESIGN.md "WW2 era", Events). The guns' flashes, the 8.8 cm's blast and
  // the spent cases are UnitViews' (the rigs' muzzles); here the bursts, bombs, rockets and strafing and the
  // sound of all of it. The 8.8 cm and 3.7 cm report shot by shot (`muzzle`: every heavy round, every 3.7
  // cm round), the 2 cm's rattle is a loop per gun (ww2Sound), every sound arriving late with its distance.
  ev.muzzle = (u, i, pos, dir, shell) => {
    if (shell === '88mm' || shell === '37mm') audio.shot(shell, pos);
  };
  // a time-fuzed 8.8 cm shell bursting: the black puff and, long after it at that height, its crump
  ev.burst = (pos) => {
    fx.flak(pos);
    audio.flak(pos);
  };
  ev.feed = (u, i, what) => audio.feed(what, u.parts[i].pos);
  ev.strafe = (t, point) => {
    fx.strafe(point, t.pos, t.vel);
    audio.strafe(t.pos, t.type);
  };
  // bombs falling (their whistle near the camera, ww2Sound) and rockets leaving their rails
  const falling = [];
  const whistled = new WeakSet();
  ev.threatLaunch = (t) => {
    if (t.type === 'gpbomb') falling.push(t);
    else if (t.type === 'rp3') {
      fx.rocketOff(t.pos, t.fwd);
      audio.launch('rp3', t.pos);
    }
  };
  // a 3.7 cm round's self-destruct at the end of its tracer, a light round striking the ground
  ev.shellExpire = (p, kind) => {
    if (kind === '37mm') {
      fx.puff(p);
      audio.pop(p);
    } else if (kind === '20mm' && fx.cheap() && Math.random() < 0.35) fx.puff(p, 0.45);
  };
  ev.shellGround = (p, kind) => {
    if (kind === '37mm' || kind === '20mm' || kind === '88mm') fx.spurt(p, kind === '88mm' ? 1.5 : kind === '37mm' ? 0.6 : 0.35);
  };
  // a bomb, a rocket or an aircraft coming down: the earth thrown up, its crater, fire where it hit
  // something, the bang
  const ww2Impact = (t, pos, victim) => {
    let s;
    if (t.type === 'gpbomb') {
      s = BOMB_SIZE[t.lb] ?? 1;
      fx.bomb(pos, s);
      fx.crater(pos, 8 * s);
      audio.explosion(pos, 0.5 + s);
    } else if (t.type === 'rp3') {
      s = 0.5;
      fx.bomb(pos, s);
      fx.explosion(pos, 0.45, { debris: false });
      fx.crater(pos, 4);
      audio.explosion(pos, 0.9);
    } else {
      // a wreck: its fuel goes up where it hits
      s = WSIZE[t.type] ?? 1;
      fx.explosion(pos, s, { debris: true });
      fx.bomb(pos, s * 0.6);
      fx.crater(pos, 5 + 2 * s);
      fx.burnSite(pos, s, 40 + 20 * s);
      audio.explosion(pos, s * 1.2);
    }
    if (victim && (t.type === 'gpbomb' || t.type === 'rp3')) fx.burnSite(pos, s, 25 + 20 * s);
    if (victim && !sim.attract) hud.setScore(sim.score.points);
  };
  // every frame: each 2 cm gun's rattle while it fires (a loop per gun, on and off when the sound gets
  // here), and a falling bomb's whistle for its last seconds when it comes down near the camera
  const ww2Sound = (dt) => {
    for (const u of sim.units) {
      if (!SYSTEMS[u.kind].mounts) continue;
      u.parts.forEach((part, i) => {
        const g = part.gun;
        if (!g || g.shell !== '20mm') return;
        const on = part.alive && dt > 0 && g.recoil >= 0 && g.recoil < 0.2;
        audio.rattle(`${u.id}/${i}`, on, _p.copy(part.pos).setY(part.pos.y + (part.kind === 'flakvierling-tower' ? 10 : 1.2)), part.kind === 'flak38' ? '20mm-flak38' : '20mm-vierling');
      });
    }
    for (let i = falling.length - 1; i >= 0; i--) {
      const b = falling[i];
      if (!b.alive || b.dead) {
        falling.splice(i, 1);
        continue;
      }
      if (whistled.has(b)) continue;
      const left = (b.pos.y - heightAt(b.pos.x, b.pos.z)) / Math.max(30, -b.vel.y);
      if (left < 4 && camera.position.distanceTo(b.pos) < 2000) {
        whistled.add(b);
        audio.whistle(b.pos, left);
      }
    }
  };

  // every wave's rounds (stats.fired restarts each wave; the running wave's are still in stats.fired)
  const spent = () => {
    let n = 0;
    for (const w of sim.stats.waves) for (const v of Object.values(w === sim.stats.cur ? sim.stats.fired : w.fired)) n += v;
    return n;
  };
  const endGame = (s) => {
    state = 'ended';
    const sc = sim.score;
    hud.showEnd(
      {
        title: s === 'victory' ? ERA.text.victory : ERA.text.defeat,
        sub: s === 'victory' ? `All ${ERA.waves.length} raids beaten off.` : `Overrun in wave ${sim.wave} of ${ERA.waves.length}.`,
        victory: s === 'victory',
        stats: [
          ['Score', sc.points.toLocaleString('en-US')],
          ['Kills', sc.kills],
          ['Leakers', sc.leaks],
          ERA.text.spent ? [ERA.text.spent, spent()] : ['Missiles spent', spent(), `cost ${sc.cost}`],
          ['Damage taken', Math.round(sc.damage)],
          ['Units standing', `${sim.units.filter((u) => u.alive).length} / ${sim.units.length}`],
        ],
      },
      { onRestart: () => start() }
    );
  };

  // ---------------------------------------------------------------- warm up
  await step(0.85, loading[4]);
  applyQuality(startQuality);
  weather.set(params.weather);
  const azimuthOf = () => 180 - params.sunBearing;
  atmosphere.set(params.elevation, azimuthOf());
  selectUnit(2);
  chase.cine(true);
  chase.goalDist = 70;
  chase.goalPitch = 0.28;
  chase.update(1);
  terrain.update(camera, true);
  await renderer.compileAsync(scene, camera);
  atmosphere.update(chase.focus, 0, camera);
  renderer.shadowMap.needsUpdate = true;
  post.render(0.016);
  hud.setLoading(1, '');
  hud.ready();
  playBtn.disabled = false;
  document.getElementById('tutorials').disabled = !ERA.tutorials.length;
  hud.setTimeScale(1);

  // ---------------------------------------------------------------- loop
  const timer = new THREE.Timer();
  const sunColorN = new THREE.Color();
  const ambient = new THREE.Color();
  let t = 0;
  let sunTimer = 0;
  let hudTimer = 0;
  let resTimer = 0;
  let frameAvg = 16;
  const markers = [];

  // one frame of the game; forcedDt lets tests step without real time
  const frame = (forcedDt, draw = true) => {
    timer.update();
    const rawDt = forcedDt ?? THREE.MathUtils.clamp(timer.getDelta(), 0, 0.1);
    frameAvg += (rawDt * 1000 - frameAvg) * 0.05;
    const dt = rawDt * params.timeScale; // game time (time compression applies to the world, not the camera)
    t += dt;
    globalUniforms.uTime.value = t;

    // sun and sky
    atmosphere.setStorm(weather.state.storm);
    sunTimer -= rawDt;
    const u = atmosphere.uniforms;
    u.cloudCoverage.value = weather.state.cover * 0.45;
    u.cloudDensity.value = 0.45 + weather.state.storm * 0.4;
    u.turbidity.value = params.turbidity;
    u.rayleigh.value = params.rayleigh;
    const stormKey = weather.state.storm.toFixed(2);
    if (
      sunTimer <= 0 &&
      (Math.abs(params.elevation - atmosphere.elevation) > 0.4 || azimuthOf() !== atmosphere.azimuth || atmosphere.lastEnvKey === '' || !atmosphere.lastEnvKey.endsWith(stormKey))
    ) {
      atmosphere.set(params.elevation, azimuthOf());
      sunTimer = 0.25;
    }
    scene.environmentIntensity = params.envIntensity * atmosphere.baseEnvIntensity * (1 - weather.state.storm * 0.45) + weather.flash * 2.5;

    // the battle (dt is already time-compressed), then everything drawn from it
    if (dt > 0) sim.update(dt);
    tutorial.update(rawDt);
    views.update(dt, rawDt, sim, fx, camera);
    syncCovers();
    entities.update(sim, t, fx, dt, camera.position);
    sim.ballistics.render();
    for (const f of iads.onFrame) f(dt, rawDt, t);

    // camera
    camera.fov += (params.fov - camera.fov) * (1 - Math.exp(-rawDt * 10));
    camera.updateProjectionMatrix();
    if (state === 'title') {
      // title screen: cut to the next unit now and then
      cineClock += rawDt;
      if (!following && cineClock > 26) {
        cineClock = 0;
        selectUnit((selected + 1) % UNITS.length);
      }
    }
    launchHold -= rawDt;
    if (!freeCam && !following && launchHold <= 0) {
      const p = launcherFor(UNITS[selected].id);
      if (p !== camPart) toLauncher(p);
    }
    chase.update(rawDt);
    camera.updateMatrixWorld();

    terrain.update(camera);

    // shadows follow the unit in view
    atmosphere.update(chase.focus, t, camera);
    const light = atmosphere.sun;
    light.intensity = (atmosphere.sunBase ?? light.intensity) * params.sunGain;
    sunColorN.copy(light.color).multiplyScalar(light.intensity / 6.5);
    globalUniforms.uSunDirW.value.copy(atmosphere.lightDir);
    globalUniforms.uSunColorN.value.copy(sunColorN);
    ambient.copy(scene.fog.color).multiplyScalar(0.9 + 0.3 * (1 - weather.state.storm));

    const lightEnv = { sunDir: atmosphere.lightDir, sunColor: sunColorN, sunIntensity: 6.5, ambient };
    clouds.update(dt, camera, { ...lightEnv, sunIntensity: 6.5 * (1 - 0.65 * atmosphere.night), cover: THREE.MathUtils.clamp(0.55 + weather.state.cover * 0.6, 0, 1) });
    fx.wind.set(-4 * weather.state.wind, 0, 1.6 * weather.state.wind);
    fx.update(dt, camera, { ...lightEnv, night: atmosphere.night });
    weather.update(dt, t, camera, atmosphere);

    scene.fog.density = params.fogDensity * weather.state.fog;
    globalUniforms.fogSunColor.value.copy(atmosphere.fogSunBase || globalUniforms.fogSunColor.value).multiplyScalar(1 - 0.9 * weather.state.storm);
    globalUniforms.fogHeightFalloff.value = params.fogFalloff;
    globalUniforms.fogBaseHeight.value = 0;

    // post
    const nightK = atmosphere.night;
    renderer.toneMapping = toneMaps[params.toneMapping];
    renderer.toneMappingExposure = params.exposure;
    const ex = post.exposure.params;
    ex.auto = params.autoExposure;
    ex.key = params.exposureKey * (1 - 0.45 * nightK);
    ex.max = 2 + 5 * (1 - THREE.MathUtils.smoothstep(params.elevation, -6, 3));
    post.gtao.blendIntensity = params.aoIntensity;
    post.bloom.enabled = params.bloom;
    post.bloom.strength = params.bloomStrength * (1 - 0.45 * nightK);
    post.bloom.radius = params.bloomRadius;
    post.bloom.threshold = params.bloomThreshold;
    const lu = post.lens.uniforms;
    lu.uFlare.value = params.lensFlare * (1 - weather.state.storm);
    lu.uCA.value = params.chromatic;
    const gu = post.grade.uniforms;
    gu.uVignette.value = params.vignette;
    gu.uGrain.value = params.grain * (1 - 0.5 * nightK);
    gu.uNight.value = nightK;
    gu.uSharpen.value = params.sharpen;
    post.dof.enabled = false;
    post.update(t, rawDt, atmosphere.sunDir, sunColorN, params.elevation);
    lu.uRays.value *= params.godRays * (1 - weather.state.storm);

    renderer.info.reset();
    renderer.shadowMap.needsUpdate = true;
    if (draw) post.render(rawDt);
    stats.update();

    // the console and its sight picture, then the sound
    const su = sim.units[selected];
    panel.update(rawDt, { time: sim.time, units: sim.units, picture: sim.picture, selectedId: su.id, state: sim.state, wave: sim.wave, score: sim.score.points, assets: sim.assets });
    const pose = draw && sightPose(su);
    if (pose) {
      const cv = panel.sightCanvas(su.id);
      if (cv) sight.update(rawDt, su, views.sightPos(su.id, _p, pose.part ?? 0), cv, MONO_SIGHT.has(su.kind), entities, pose);
    }
    for (const u of sim.units) {
      const g = u.weapons.gun;
      if (g && !SYSTEMS[u.kind].mounts) audio.gun(u.id, u.alive && g.firing && dt > 0, _p.copy(u.pos).setY(u.pos.y + 3), GUN_VOICE[u.kind] ?? g.shell);
    }
    ww2Sound(dt);
    audio.update(rawDt, camera, { threats: sim.threats, timeScale: params.timeScale });

    // dynamic resolution: keep frame time near 60 fps
    resTimer -= rawDt;
    if (params.dynamicRes && resTimer <= 0) {
      resTimer = 1.5;
      let next = resScale;
      if (frameAvg > 20) next = Math.max(0.5, resScale - 0.1);
      else if (frameAvg < 13.5) next = Math.min(1, resScale + 0.05);
      if (next !== resScale) {
        resScale = next;
        applyPixelRatio();
      }
    }

    // HUD
    markers.length = 0;
    sim.units.forEach((un, i) => {
      if (i !== selected && un.alive) markers.push({ pos: un.pos, kind: 'unit', label: un.id });
    });
    for (const a of sim.assets) if (a.label) markers.push({ pos: a.pos, kind: 'friend', label: a.label });
    const near = sim.picture.slice().sort((a, b) => a.range - b.range);
    for (let i = 0; i < Math.min(10, near.length); i++) markers.push({ pos: near[i].pos, kind: 'enemy', label: CLS_SHORT[near[i].cls] ?? '' });
    hud.updateCompass(camera, markers);
    // the selected unit's selected track: bracketed, and padlocked by the camera if asked
    const trk = su.selected != null ? su.tracks.find((x) => x.id === su.selected) : null;
    hud.bracket(camera, trk ? trk.pos : null, trk ? `${CLS_SHORT[trk.cls] ?? ''} ${trk.id}  ${(trk.range / 1000).toFixed(1)} km` : '');
    chase.padlock(padlock && trk && !freeCam ? trk.pos : null);
    hudTimer -= rawDt;
    if (hudTimer <= 0 && document.body.classList.contains('debug')) {
      hudTimer = 0.25;
      const i = renderer.info;
      const c = fx.counts;
      const tc = terrain.trees.counts || [];
      hud.debug(
        `fps        ${(1000 / frameAvg).toFixed(0)} (${frameAvg.toFixed(1)} ms)\n` +
          `state      ${state}  time x${params.timeScale}${freeCam ? '  free camera' : ''}\n` +
          `draw calls ${i.render.calls}\n` +
          `triangles  ${(i.render.triangles / 1e6).toFixed(2)}M\n` +
          `resolution ${Math.round(vw * renderer.getPixelRatio())}x${Math.round(vh * renderer.getPixelRatio())} (${Math.round(resScale * 100)}%)\n` +
          `trees      ${tc.map((c2) => c2.join('/')).join(' ')}  grass ${terrain.grass.count}\n` +
          `particles  ${c.smoke} smoke, ${c.glow} glow, ${c.debris} debris\n` +
          `battle     ${sim.state} wave ${sim.wave}  threats ${sim.threats.length}  missiles ${sim.missiles.length}  shells ${sim.ballistics.n}  drawn ${entities.counts()}\n` +
          `camera     ${camera.position.x.toFixed(0)}, ${camera.position.y.toFixed(0)}, ${camera.position.z.toFixed(0)}  dist ${chase.dist.toFixed(0)}\n` +
          `sun        ${params.elevation.toFixed(1)} deg bearing ${params.sunBearing.toFixed(0)}  weather ${params.weather}`
      );
    }
  };
  renderer.setAnimationLoop(() => frame());
  const qu = Number(query.get('unit') ?? 0);
  const startUnit = Number.isInteger(qu) && qu >= 0 && qu < UNITS.length ? qu : 0;

  if (query.get('play')) {
    selectUnit(startUnit);
    start();
  } else selected = startUnit;

  if (query.get('tutorial')) tutorial.start(query.get('tutorial'));

  Object.assign(iads, {
    tutorial,
    renderer, scene, camera, terrain, atmosphere, post, fx, hud, chase, params, frame, clouds, weather, eyes,
    sim, views, entities, panel, audio, sight,
    select: selectUnit, start, setTimeScale, setLoadout, setEra, eras: ERAS,
    // headless tests: stop the loop, run `seconds` of battle without drawing, then draw a few frames
    fastForward(seconds, { unit = null, scale = 8, settle = 6 } = {}) {
      renderer.setAnimationLoop(null);
      if (unit != null) selectUnit(unit);
      const keep = params.timeScale;
      params.timeScale = scale;
      for (let i = Math.ceil(seconds / (0.05 * scale)); i > 0; i--) frame(0.05, false);
      params.timeScale = keep;
      for (let i = 0; i < settle; i++) frame(1 / 30, true);
      return {
        time: Math.round(sim.time), state: sim.state, wave: sim.wave, score: sim.score,
        threats: sim.threats.filter((x) => x.alive).length, missiles: sim.missiles.length,
        units: sim.units.map((u) => `${u.id}:${Math.round(u.hp)}${u.alive ? '' : 'X'}:${u.status}`).join(' '),
      };
    },
  });
  // live getters (Object.assign would copy their values once)
  Object.defineProperty(iads, 'state', { get: () => state, configurable: true });
  Object.defineProperty(iads, 'era', { get: () => ERA.id, configurable: true });
}

// tests and tools: every system, plus `events` (start, select) and per-frame callbacks in onFrame
const iads = { events: {}, onFrame: [] };
window.__iads = iads;

init().catch((err) => {
  console.error(err);
  hud.setLoading(0, `Failed to start: ${err.message}`);
});
