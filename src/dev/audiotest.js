// Live smoke test of the audio engine: every API call, world sounds at several distances, the gun,
// the seeker and threat engines. Reports exceptions and the voice counts in window.__audioReport.
import * as THREE from 'three';
import { AudioEngine } from '../audio.js';

const out = document.getElementById('out');
const report = (window.__audioReport = { errors: [], steps: [] });
const step = (name, fn) => {
  try {
    fn();
    report.steps.push(name);
  } catch (e) {
    report.errors.push(`${name}: ${e.message}`);
  }
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const audio = new AudioEngine();
window.__audio = audio;
const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1e5);
camera.position.set(0, 3, 0);
camera.updateMatrixWorld();
const P = (x, y, z) => new THREE.Vector3(x, y, z);
const threats = [
  { id: 1, type: 'fighter', pos: P(2000, 3000, -4000), vel: P(-200, 0, 150), alive: true },
  { id: 2, type: 'drone', pos: P(300, 150, -800), vel: P(0, 0, 55), alive: true },
  { id: 3, type: 'helo', pos: P(-1500, 80, -2500), vel: P(0, 0, 0), alive: true },
  { id: 4, type: 'cruise', pos: P(-900, 40, -1500), vel: P(150, 0, 190), alive: true },
  { id: 5, type: 'tbm', pos: P(0, 6000, -3000), vel: P(0, -900, 400), alive: true },
];
// buttons to hear the new units (the dev server page: click Start first)
const bar = document.getElementById('buttons');
if (bar) {
  const btn = (label, fn) => {
    const b = document.createElement('button');
    b.textContent = label;
    b.onclick = () => (audio.start(), fn());
    bar.append(b);
  };
  for (const k of ['9M317', '9M338', '9M311', '48N6']) for (const d of [60, 1500]) btn(`launch ${k} ${d} m`, () => audio.launch(k, P(d, 0, -d / 4)));
  for (const sh of ['30mm', '30mm-tunguska', '23mm', '35mm']) {
    let on = false;
    btn(`gun ${sh} (toggle)`, () => audio.gun('btn-' + sh, (on = !on), P(25, 3, -10), sh));
  }
  for (const k of ['buk', 'tor', 'tunguska', 'shilka', 'gepard', 'pantsir', 's400']) btn(`idle ${k}`, () => audio.vehicle(k));
  // the WW2 era's heavy guns (WW2 era first: its banks render and its recordings load in a few seconds), one
  // round and a battery's salvo of six guns 25 m apart; close ones dull the ears (deafen)
  btn('WW2 era', () => audio.setEra('ww2'));
  for (const k of ['88mm', '128mm']) for (const d of [20, 1500, 6000]) btn(`${k} ${d} m`, () => audio.shot(k, P(d, 2, -d / 4)));
  btn('88mm salvo 30 m', () => {
    for (let i = 0; i < 6; i++) setTimeout(() => audio.shot('88mm', P(30 + (i % 3) * 25, 2, -20 + Math.floor(i / 3) * 25)), Math.random() * 250);
  });
  for (const k of ['Start']) btn(k, () => {});
  // world sounds travel and land in update(), which the smoke test below stops calling after a few seconds
  let running = false;
  bar.addEventListener('click', () => {
    if (running) return;
    running = true;
    setInterval(() => audio.update(1 / 60, camera, { threats: [] }), 16);
  });
}
const tick = (n) => {
  for (let i = 0; i < n; i++) audio.update(1 / 60, camera, { threats });
};

(async () => {
  step('start', () => audio.start());
  await wait(300);
  step('vehicle', () => audio.vehicle('pantsir'));
  step('mood', () => audio.mood('lull'));
  for (const k of ['48N6', '9M96', '57E6', '9M33', '9M37', '9M317', '9M338', '9M311']) for (const d of [30, 1500, 8000]) step(`launch ${k} ${d}`, () => audio.launch(k, P(d, 0, 0)));
  for (const d of [80, 900, 6000]) {
    step(`explosion ${d}`, () => audio.explosion(P(0, 0, -d), 1));
    step(`airburst ${d}`, () => audio.airburst(P(0, 500, -d)));
    step(`impact ${d}`, () => audio.impact(P(d, 0, 0), 1.5));
  }
  step('crack', () => audio.crack(P(20, 10, 0)));
  step('gun on', () => audio.gun('P1', true, P(10, 3, 0)));
  tick(30);
  await wait(800);
  step('gun hold', () => audio.gun('P1', true, P(10, 3, 0)));
  tick(30);
  step('gun off', () => audio.gun('P1', false, P(10, 3, 0)));
  // several gun units at once, each by its shell type (more than GUN_VOICES to exercise the cap)
  const shells = ['30mm', '23mm', '30mm', '35mm', '30mm-tunguska', '23mm', '30mm', '35mm', '30mm', '23mm'];
  shells.forEach((sh, i) => step(`gun ${sh} #${i}`, () => audio.gun('G' + i, true, P(20 + i * 400, 3, -30))));
  tick(30);
  await wait(800);
  shells.forEach((sh, i) => step(`gun off #${i}`, () => audio.gun('G' + i, false, P(20 + i * 400, 3, -30))));
  step('ignite', () => audio.ignite('9M338', P(30, 0, 0)));
  for (const k of ['buk', 'tor', 'tunguska', 'shilka', 'gepard', 'pantsir']) step(`vehicle ${k}`, () => audio.vehicle(k));
  for (const n of ['click', 'switch', 'button', 'alarm', 'warning', 'lock']) step(`ui ${n}`, () => audio.ui(n));
  for (let i = 0; i <= 10; i++) step(`seeker ${i}`, () => audio.seeker(i / 10, i === 10));
  step('seeker off', () => audio.seeker(0, false));
  for (let i = 0; i < 120; i++) {
    for (const t of threats) t.pos.addScaledVector(t.vel, 1 / 60);
    step('update', () => audio.update(1 / 60, camera, { threats }));
    await wait(16);
  }
  step('mute', () => (audio.toggleMute(), audio.toggleMute()));
  step('volume', () => (audio.setVolume(0.7), audio.setMusicVolume(0.4)));
  await wait(2000);
  report.state = audio.ctx?.state;
  report.banks = Object.fromEntries(Object.entries(audio.bank).map(([g, b]) => [g, Object.keys(b).length]));
  report.pending = audio.pending.length;
  report.voices = { pos: audio.posVoices, direct: audio.directVoices, inFlight: audio.inFlight.length, engines: audio.engines.filter((e) => e.id).length, guns: audio.guns.size };
  report.recordings = audio.recordingsInUse ?? null;
  report.steps = report.steps.length;
  report.done = true;
  out.textContent = JSON.stringify(report, null, 1);
})();
