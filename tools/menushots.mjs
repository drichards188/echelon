// The main menu's background stills (src/ui/backdrop.js STILLS): a unit of each kind firing in a raid,
// captured from the game itself in a private headless Chromium (as tools/shot.mjs: SwiftShader, no HMR),
// with the console and the overlay hidden and the 3D view the full width. Writes public/menu/<kind>.jpg.
// Needs the dev server on port 5200.
//   node tools/menushots.mjs [kind ...] [--size 1920x1080] [--quality High] [--out public/menu]    (no kinds: every shot)
// Each run plays a new battle (the game takes a random seed), so look at the pictures before keeping them.
// A shot: the battle with that kind in its slot and the camera on it, a fast-forward to the first raid,
// then 0.05 s steps without drawing until the unit fires (`on`: a missile leaving, its guns, or a WW2 gun's
// round), `after` more steps for the launch to develop and a few drawn frames. `cam` holds the chase
// camera: [yaw off the unit's back (+ round to its right), pitch, distance in metres]; the view is shifted
// so the unit stands right of the middle, clear of the menu on the left. `part`: the camera on one vehicle
// or gun of the unit (a battery's, a platoon's), waiting for that one to fire.
import { chromium } from 'playwright-core';
import fs from 'node:fs';

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(name);
  if (i < 0) return def;
  const v = args[i + 1];
  args.splice(i, 2);
  return v;
};
const size = opt('--size', '1920x1080').split('x').map(Number);
const quality = opt('--quality', 'High');
const OUT = opt('--out', 'public/menu');

const MODERN = ['s400', 'pantsir', 'pantsir', 'osa', 'strela'];
const WW2 = ['flak88', 'flak43', 'flak43', 'flakvierling', 'flakturm'];
export const SHOTS = [
  { kind: 's400', era: 'modern', base: MODERN, slot: 0, on: 'launch', ff: 20, cam: [2.3, 0.1, 34], after: 26 },
  { kind: 'buk', era: 'modern', base: MODERN, slot: 0, on: 'launch', ff: 20, cam: [2, 0.08, 24], after: 3 },
  { kind: 'pantsir', era: 'modern', base: MODERN, slot: 1, on: 'launch', ff: 20, cam: [2, 0.1, 18], after: 5 },
  { kind: 'tunguska', era: 'modern', base: MODERN, slot: 1, on: 'launch', ff: 20, cam: [2, 0.1, 16], after: 4 },
  { kind: 'osa', era: 'modern', base: MODERN, slot: 3, on: 'launch', ff: 20, cam: [2, 0.08, 16], after: 3 },
  { kind: 'tor', era: 'modern', base: MODERN, slot: 3, on: 'launch', ff: 20, cam: [2, 0.08, 16], after: 14 },
  { kind: 'strela', era: 'modern', base: MODERN, slot: 4, on: 'launch', ff: 20, cam: [2, 0.08, 13], after: 3 },
  { kind: 'shilka', era: 'modern', base: MODERN, slot: 4, on: 'gun', ff: 20, cam: [2.2, 0.08, 13], after: 1 },
  { kind: 'flak88', era: 'ww2', base: WW2, slot: 0, part: 1, on: 'muzzle', ff: 20, cam: [2.2, 0.1, 14], after: 2 },
  { kind: 'flak43', era: 'ww2', base: WW2, slot: 1, part: 0, on: 'muzzle', ff: 20, cam: [2.2, 0.18, 16], after: 1 },
  { kind: 'flakvierling', era: 'ww2', base: WW2, slot: 3, part: 0, on: 'muzzle', ff: 20, cam: [2.2, 0.1, 10], after: 1 },
  { kind: 'flakturm', era: 'ww2', base: WW2, slot: 4, part: 18, on: 'muzzle', ff: 20, cam: [2.3, 0.14, 190], after: 2 },
  { kind: 'flak38', era: 'ww2', base: WW2, slot: 4, part: 0, on: 'muzzle', ff: 20, cam: [2.2, 0.1, 9], after: 1 },
];

// in the page: the battle run on until the unit fires, its launch developing, then the frame drawn
async function unitShot(page, s) {
  return page.evaluate(({ slot, part = null, on, ff, cam, after, wait = 900 }) => {
    const I = window.__iads, sim = I.sim, ev = sim.events, u = sim.units[slot];
    let fired = false;
    const was = ev[on];
    // a WW2 gun's round names its gun (muzzle: u, i, ...); the flak tower's building waits for any of its guns
    ev[on] = (...a) => {
      was?.(...a);
      if (a[0] === u && (part == null || on !== 'muzzle' || a[1] === part || u.parts[part]?.kind === u.kind)) fired = true;
    };
    I.fastForward(ff, { unit: slot, scale: 8, settle: 0 });
    if (part != null) I.chase.setTarget(I.views.eye(u.id, part), { behind: true });
    const base = I.chase.goalYaw;
    const hold = () => {
      I.chase.yaw = I.chase.goalYaw = base + cam[0];
      I.chase.pitch = I.chase.goalPitch = cam[1];
      I.chase.dist = I.chase.goalDist = cam[2];
    };
    // the unit at 62% across: the frame is the left part of a view 1.3 times as wide
    const w = innerWidth, h = innerHeight;
    I.camera.setViewOffset(w * 1.3, h, 0, 0, w, h);
    I.params.timeScale = 1;
    let n = 0;
    while (!fired && n++ < wait / 0.05) {
      hold();
      I.frame(0.05, false);
    }
    for (let k = 0; k < after; k++) {
      hold();
      I.frame(0.05, false);
    }
    for (let k = 0; k < 4; k++) {
      hold();
      I.frame(1 / 30, true);
    }
    return { fired, time: Math.round(sim.time), wave: sim.wave };
  }, s);
}

const exe = ['chromium-1247', 'chromium-1217']
  .map((d) => `${process.env.HOME}/.cache/ms-playwright/${d}/chrome-linux64/chrome`)
  .find((p) => fs.existsSync(p));
const browser = await chromium.launch({ executablePath: exe, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
fs.mkdirSync(OUT, { recursive: true });
const want = args.filter((a) => !a.startsWith('--'));
const HIDE = '#panel, #hud, #loading, #tut-card, #gear, #return-menu, #end, .lil-gui { display: none !important; } #view { flex: 1 1 100% !important; width: 100% !important; }';
for (const s of SHOTS.filter((x) => !want.length || want.includes(x.kind))) {
  const page = await browser.newPage({ viewport: { width: size[0], height: size[1] } });
  await page.addInitScript(() => {
    const Orig = window.WebSocket;
    window.WebSocket = function (url, proto) {
      if (proto === 'vite-hmr') return { send() {}, close() {}, addEventListener() {}, removeEventListener() {}, readyState: 1 };
      return new Orig(url, proto);
    };
  });
  page.on('pageerror', (e) => console.log(`  [pageerror] ${e.message}`));
  const t = Date.now();
  try {
    const loadout = s.base.map((k, i) => (i === s.slot ? s.kind : k)).join(',');
    await page.goto(`http://localhost:5200/?play=1&era=${s.era}&loadout=${loadout}&unit=${s.slot}&quality=${quality}`, { waitUntil: 'load', timeout: 60000 });
    await page.waitForFunction(() => window.__iads?.state === 'playing', null, { timeout: 180000, polling: 250 });
    await page.addStyleTag({ content: HIDE });
    await page.waitForTimeout(400);
    const r = await unitShot(page, s);
    const file = `${OUT}/${s.kind}.jpg`;
    await page.screenshot({ path: file, type: 'jpeg', quality: 80, timeout: 180000 });
    console.log(`${s.kind}: ${JSON.stringify(r)} -> ${file} (${Math.round(fs.statSync(file).size / 1024)} KB, ${Math.round((Date.now() - t) / 1000)} s)`);
  } catch (e) {
    console.log(`${s.kind}: FAILED ${e.message.split('\n')[0]}`);
  }
  await page.close();
}
await browser.close();
