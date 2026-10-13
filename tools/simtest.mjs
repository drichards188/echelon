// Headless battles: node tools/simtest.mjs [seeds] [--both | --all | --players auto,s400,full]
//   [--difficulty Easy|Normal|Hard|all] [--era ID] [--loadout KINDS] [--quiet] [--table] [--log] [--jobs N]
// Runs whole games at dt = 0.05 with every unit on auto ('auto'), with a scripted player running the
// area unit, the S-400 or the Buk ('s400', --both adds it), or with one who also runs both point
// defense units, Pantsirs or Tunguskas ('full', --all adds both), and prints per wave what came in,
// what killed what, what leaked and what was spent, then a summary per difficulty and player: outcome,
// wave reached, game time, wave durations and kills per layer (one column per slot, the point defense
// pair's guns apart). --loadout picks the unit of each slot, comma separated in slot order
// (s400|buk, pantsir|tunguska, pantsir|tunguska, osa|tor, strela|shilka; an empty entry keeps the
// default), or 'default', or 'alt' for every alternative. --era picks the era (src/eras, default
// 'modern'; any registered era with units, available on the menu or not), whose slots --loadout then
// names. --table prints only the summary, --log the whole radio log. Games run in worker threads; the
// sim is deterministic per seed. With --era ww2 the scripted players are the WW2 era's: 's400' (or 'area')
// runs the heavy battery, 'full' the battery and the four platoons; its columns are the slots, with the
// battery's own 2 cm guns apart (B20).
import { Worker, isMainThread, parentPort } from 'node:worker_threads';
import os from 'node:os';
import { Sim } from '../src/sim/sim.js';
import { WAVES } from '../src/sim/director.js';
import { ERA, SLOT_OPTIONS, DEFAULT_LOADOUT, setEra } from '../src/deploy.js';
import { ERAS, DEFAULT_ERA, eraById } from '../src/eras/index.js';
import { MISSILES, SYSTEMS, THREATS } from '../src/sim/systems.js';

let heightAt, los;
try {
  ({ heightAt, los } = await import('../src/terrainHeight.js'));
} catch (e) {
  try {
    ({ heightAt, los } = await import('../src/terrain.js'));
  } catch {
    // stand-in ridges, in case the terrain is missing or broken
    heightAt = (x, z) => 60 * Math.max(0, Math.sin(x / 9000) * Math.cos(z / 7000)) + 20 * Math.sin(x / 2300 + z / 3100);
    los = (ax, ay, az, bx, by, bz) => {
      const n = 40;
      for (let i = 1; i < n; i++) {
        const t = i / n;
        if (ay + (by - ay) * t < heightAt(ax + (bx - ax) * t, az + (bz - az) * t)) return false;
      }
      return true;
    };
    if (isMainThread) console.log('(terrain unavailable, using stand-in ridges)', e.message);
  }
}

// kills are counted per slot (the area unit, the point defense pair's missiles, their guns, the
// short-range missile unit, the very short range unit), labelled by the kinds in the loadout; another
// era's slots get a column each
const LABEL = { s400: 'S400', buk: 'BUK', pantsir: 'PAN', tunguska: 'TUN', osa: 'OSA', tor: 'TOR', strela: 'STR', shilka: 'SHK' };
const NAME = { s400: 'S-400', buk: 'Buk', pantsir: 'Pantsirs', tunguska: 'Tunguskas' };
const modern = () => ERA.id === 'modern';
// the WW2 era's columns: the heavy battery's 8.8 cm, the two 3.7 cm platoons (Flak lane, dispersal), the
// Vierlinge, the 2 cm, and the battery's own 2 cm
const WW2_LABEL = { flak88: '88', flak43: '37', flakvierling: 'VIER', flak38: '20', flakturm: 'TURM' };
const ww2 = () => ERA.id === 'ww2';
function layersFor(loadout) {
  if (ww2()) return [...loadout.map((k, i) => (WW2_LABEL[k] ?? k.toUpperCase()) + (loadout.indexOf(k) < i ? 'B' : loadout.indexOf(k, i + 1) > i ? 'A' : '')), 'B20'];
  if (!modern()) return loadout.map((k, i) => (LABEL[k] ?? k.toUpperCase()) + (loadout.indexOf(k) < i ? i + 1 : ''));
  const pd = loadout[1] === loadout[2] ? LABEL[loadout[1]] : 'PD';
  return [LABEL[loadout[0]], pd, 'GUN', LABEL[loadout[3]], LABEL[loadout[4]]];
}
// the layer a kill key (`unitId:weapon`) counts in
function layerOf(sim, layers, key) {
  const [id, weapon] = key.split(':');
  if (ww2()) {
    const u = sim.unitById.get(id);
    return u && SYSTEMS[u.kind].predictor && !SYSTEMS[u.kind].groups && weapon !== u.heavyShell ? 'B20' : layers[u?.slot ?? 0];
  }
  if (!modern()) return layers[sim.unitById.get(id)?.slot ?? 0];
  const slot = sim.unitById.get(id)?.slot ?? 4;
  if ((slot === 1 || slot === 2) && /mm$/.test(weapon)) return 'GUN';
  return layers[slot === 2 ? 1 : slot];
}
function parseLoadout(arg) {
  if (!arg || arg === 'default') return [...DEFAULT_LOADOUT];
  if (arg === 'alt') return SLOT_OPTIONS.map((o) => o[1].kind);
  const kinds = arg.split(',').map((k) => k.trim().toLowerCase());
  return SLOT_OPTIONS.map((opts, i) => {
    const k = kinds[i] || opts[0].kind;
    if (!opts.some((o) => o.kind === k)) throw new Error(`--loadout: slot ${i} is ${opts.map((o) => o.kind).join(' or ')}, not '${k}'`);
    return k;
  });
}

// ---------------------------------------------------------------- scripted players
const armsAt = (sim, u) => sim.threats.filter((t) => t.alive && t.type === 'arm' && t.target?.id === u.id && t.pos.distanceTo(t.aim) < 16000);

// a player who runs the S-400 by hand: big missiles for aircraft and ballistic targets (and keeps
// them for the ballistic raid when it is due), small ones for the rest, leaves slow "aircraft"
// (decoys) alone and goes silent when a radar-seeking missile comes for the battalion
function s400Player(sim, s) {
  const id = s.id;
  if (s.mode !== 'manual') sim.command(id, 'mode', { mode: 'manual' });
  // silent only for the last stretch of a radar-seeking missile's flight (it misses by hundreds of
  // metres once it loses the emitter that far out), so the battalion is not blind for long
  const arm = armsAt(sim, s).length > 0;
  if (arm && s.radar.search) sim.command(id, 'radar', { on: false });
  if (!arm && !s.radar.search) sim.command(id, 'radar', { on: true });
  // a TEL that is empty is reloaded at once
  for (const st of Object.values(s.weapons.stock)) if (st.ready <= st.max - (st.type === '48N6' ? 4 : 16) && st.reserve > 0 && st.reload === 0) {
    sim.command(id, 'missileType', { type: st.type });
    sim.command(id, 'reload', {});
  }
  const tbmWave = sim.state === 'wave' && WAVES[sim.wave - 1]?.groups.some((g) => g.type === 'tbm');
  for (const tr of s.tracks) {
    if (tr.engagedBy.includes(id) || tr.source !== 'own') continue;
    let type = null, salvo = 1;
    if (tr.cls === 'tbm') (type = '48N6'), (salvo = 2);
    else if (tr.cls === 'aircraft' && tr.speed > 245 && tr.held > 6) type = tbmWave ? '9M96' : '48N6';
    else if ((tr.cls === 'cruise' || tr.cls === 'bomb' || tr.cls === 'arm') && tr.range < 90000) type = '9M96';
    if (!type) continue;
    if (s.weapons.stock[type].ready === 0) type = type === '48N6' ? '9M96' : '48N6';
    if (s.weapons.stock[type].ready === 0) continue;
    sim.command(id, 'missileType', { type });
    sim.unitsAI.engage(s, tr.id, salvo, false);
  }
}

// a player who runs the Buk battery the same way: aircraft (not the slow ones, decoys), bombs,
// radar-seeking and cruise missiles, drones and helicopters that come for the battery, nothing
// ballistic (it has no answer); each TELAR takes the most
// urgent track it can see, its own battery's or from the link, an empty TELAR is reloaded at once and everything between raids, and each
// emitter a radar-seeking missile is in the last stretch toward goes silent (the search radar, or a
// TELAR, whose rounds in flight then lose guidance)
function bukPlayer(sim, s) {
  const id = s.id;
  const ai = sim.unitsAI;
  if (s.mode !== 'manual') sim.command(id, 'mode', { mode: 'manual' });
  const hunted = new Set(armsAt(sim, s).map((t) => t.target.part));
  const radar = s.parts.findIndex((p) => p.role === 'radar');
  if (s.parts[radar].alive && s.radar.search === hunted.has(radar)) sim.command(id, 'radar', { on: !hunted.has(radar) });
  for (const i of s.telars) if (hunted.has(i) && s.parts[i].track) sim.command(id, 'track', { on: false, part: i });
  const st = s.weapons.missiles;
  if (st.reload === 0 && st.reserve > 0) {
    const i = ai.emptiest(s, st);
    if (i >= 0 && (s.parts[i].rounds === 0 || sim.state !== 'wave')) sim.command(id, 'reload', { part: i });
  }
  const urgency = (tr) => {
    const t = sim.threatById.get(tr.id);
    let p = Math.min(tr.tti, 600);
    if (t?.target?.id === id) p -= 300;
    if (tr.cls === 'aircraft') p -= 200;
    return p;
  };
  const cands = s.tracks.filter((tr) => {
    if (tr.engagedBy.includes(id) || (tr.source !== 'own' && s.parts[radar].alive)) return false;
    if (tr.cls === 'aircraft') return tr.speed > 245 && tr.held > 6;
    // drones and helicopters only when they come for the battery
    if (tr.cls === 'drone' || tr.cls === 'helo') return sim.threatById.get(tr.id)?.target?.id === id && tr.range < 12000;
    return tr.cls === 'arm' || tr.cls === 'bomb' || tr.cls === 'cruise';
  }).sort((a, b) => urgency(a) - urgency(b));
  for (const tr of cands) {
    if (ai.activeEngagements(s) >= ai.channelCount(s)) break;
    const g = ai.freeTelar(s, tr);
    if (g >= 0 && !hunted.has(g)) ai.engage(s, tr.id, 1, false, g);
  }
}

// a player who also runs both point defense units by hand: the guns on whatever comes inside 1.5 km,
// otherwise one engagement at a time at the most urgent track nobody else is on (drones only close in;
// pairs from a one-channel Tunguska), and the radars off with the electro-optical channel while an ARM
// comes for that unit
function pdPlayer(sim, u) {
  const id = u.id;
  if (u.mode !== 'manual') sim.command(id, 'mode', { mode: 'manual' });
  const arm = armsAt(sim, u).length > 0;
  if (u.radar.search === arm) sim.command(id, 'radar', { on: !arm });
  if ((u.sight.src === 'eo') !== arm) sim.command(id, 'trackSource', { source: arm ? 'eo' : 'radar' });
  if (arm && u.radar.track) sim.command(id, 'track', { on: false });
  const st = u.weapons.missiles;
  if (st.reload === 0 && st.reserve > 0 && (st.ready === 0 || (st.ready <= 4 && sim.state !== 'wave'))) sim.command(id, 'reload', {});
  // guns: the nearest target inside 1.5 km, in bursts while the barrels are on its lead
  const g = u.weapons.gun;
  let gunT = null;
  for (const tr of u.tracks) {
    if (tr.range > 1500 || tr.alt > 2500 || tr.cls === 'unknown' || tr.cls === 'decoy') continue;
    if (!gunT || tr.range < gunT.range) gunT = tr;
  }
  if (gunT && g.rounds > 0 && !g.overheated) {
    if (!arm && !u.radar.track) sim.command(id, 'track', { on: true });
    sim.command(id, 'weapon', { weapon: 'gun' });
    if (u.selected !== gunT.id) sim.command(id, 'select', { trackId: gunT.id });
    const aim = g.aimOk && g.target === gunT.id ? g.aim : gunT.pos;
    sim.command(id, 'trigger', { down: g.heat < 0.8 && sim.unitsAI.alignedTo(u, aim, 0.06) });
    return;
  }
  if (g.trigger) sim.command(id, 'trigger', { down: false });
  if (g.target) sim.command(id, 'select', { trackId: null });
  sim.command(id, 'weapon', { weapon: 'missile' });
  if (st.ready === 0 || sim.unitsAI.activeEngagements(u) >= sim.unitsAI.channelCount(u)) return;
  const reach = Math.min(16000, MISSILES[st.type].range * 0.85);
  const cands = u.tracks.filter((tr) => {
    if (tr.engagedBy.length || tr.cls === 'unknown' || tr.cls === 'decoy' || tr.cls === 'aircraft') return false;
    if (tr.range < 2000 && tr.alt < 2500) return false;
    return tr.range < (tr.cls === 'drone' ? 5000 : reach);
  }).sort((a, b) => Math.min(a.tti, 600) - Math.min(b.tti, 600));
  // a unit with one channel (the Tunguska's optical sight) makes each engagement count with a pair
  const pair = cands[0]?.cls === 'helo' || sim.unitsAI.channelCount(u) === 1;
  if (cands.length) sim.unitsAI.engage(u, cands[0].id, pair ? 2 : 1, false);
}

// ---------------------------------------------------------------- scripted WW2 players
// how far (m) the 8.8 cm battery can put a burst at a height, roughly (refs/ww2/flak88, the fuze limit)
const heavyReach = (alt) => (alt > 8500 ? 4500 : alt > 6500 ? 7000 : 7600);

// a player who runs the heavy battery by hand: the predictor on the bomber boxes that have not bombed yet
// (the box nearest its release first, its leader if it can), kept while the solution holds; fighters at
// height only when no bomber is in reach; the rangefinder instead of the Wuerzburg while Window spoils the
// radar range; salvo fire as soon as the solution is fair; barrage at the leading box if the predictor is
// knocked out
function heavyPlayer(sim, u) {
  const id = u.id;
  const pr = u.predictor;
  if (u.mode !== 'manual') sim.command(id, 'mode', { mode: 'manual' });
  if (pr.ranging === 'radar' && pr.window > 0.2) sim.command(id, 'ranging', { source: 'optical' });
  else if (pr.ranging === 'optical' && pr.window < 0.02 && !sim.threats.some((t) => t.alive && THREATS[t.type].chaff && t.pos.distanceTo(u.pos) < 15000)) sim.command(id, 'ranging', { source: 'radar' });
  const c = u.pos;
  const score = (tr) => {
    const t = sim.threatById.get(tr.id);
    if (!t?.alive || !THREATS[t.type].plane || t.phase === 'straggle') return Infinity;
    const agl = tr.pos.y - sim.heightAt(tr.pos.x, tr.pos.z);
    if (agl < 1200) return Infinity;
    const hd = Math.hypot(tr.pos.x - c.x, tr.pos.z - c.z);
    const reach = heavyReach(tr.pos.y);
    const closing = (c.x - tr.pos.x) * tr.vel.x + (c.z - tr.pos.z) * tr.vel.z > 0;
    // inbound bombers are tracked well before they are in reach, so the solution has settled
    if (hd > reach + (closing ? (THREATS[t.type].role === 'level' ? 9000 : 2500) : 0)) return Infinity;
    if (THREATS[t.type].role === 'level') {
      if (t.released) return 50000 + hd;
      // the box nearest its target first, its leader a little before the others
      return Math.hypot(t.pos.x - t.target.pos.x, t.pos.z - t.target.pos.z) - (t.lead ? 0 : 400);
    }
    return 30000 + hd;
  };
  const cur = pr.target != null ? u.tracks.find((tr) => tr.id === pr.target) : null;
  let pick = cur && score(cur) < Infinity && (pr.valid || pr.t < 10) ? cur : null;
  if (!pick || score(pick) >= 30000) {
    let bs = pick ? score(pick) - 2000 : Infinity;
    for (const tr of u.tracks) {
      const s = score(tr);
      if (s < bs) {
        bs = s;
        pick = tr;
      }
    }
  }
  if ((pick?.id ?? null) !== u.selected) sim.command(id, 'select', { trackId: pick?.id ?? null });
  if (pr.hold === 'no predictor') {
    if (pick && !pr.barrage) sim.command(id, 'barrage', { on: true, trackId: pick.id });
    sim.command(id, 'trigger', { down: !!pr.barrage });
    return;
  }
  sim.command(id, 'trigger', { down: !!pick && pr.valid && pr.quality > 0.35 });
}

// a player who runs a light or medium platoon: its crews fire on their own (auto, the guns spread over
// the targets), and the player points them at a dive-bomber or rocket aircraft diving on this position, the
// nearest first (a selection the crews take at once)
function platoonPlayer(sim, u) {
  const id = u.id;
  const def = Object.values(SYSTEMS[u.kind].guns)[0];
  if (u.mode !== 'auto') sim.command(id, 'mode', { mode: 'auto' });
  let best = null, bs = Infinity;
  for (const tr of u.tracks) {
    const t = sim.threatById.get(tr.id);
    if (!t?.alive || !t.attack || t.phase !== 'dive' || t.target?.id !== id || !THREATS[t.type].vis) continue;
    const d = tr.pos.distanceTo(u.pos);
    if (d > def.range * 1.3) continue;
    if (d < bs) {
      bs = d;
      best = tr;
    }
  }
  if ((best?.id ?? null) !== u.selected) sim.command(id, 'select', { trackId: best?.id ?? null });
}

function areaPlayer(sim) {
  const s = sim.area;
  if (!s?.alive) return;
  if (s.kind === 'buk') bukPlayer(sim, s);
  else if (SYSTEMS[s.kind].predictor) heavyPlayer(sim, s);
  else s400Player(sim, s);
}

function fullPlayer(sim) {
  areaPlayer(sim);
  if (ww2()) {
    for (const u of sim.units) if (u.alive && SYSTEMS[u.kind].mounts === 'platoon') platoonPlayer(sim, u);
    return;
  }
  for (const u of sim.units) if ((u.slot === 1 || u.slot === 2) && u.alive && u.weapons.missiles && u.weapons.gun) pdPlayer(sim, u);
}

const PLAYERS = { auto: null, s400: areaPlayer, area: areaPlayer, full: fullPlayer };
const playerName = (player, loadout) => {
  if (ww2()) return { auto: 'all auto', s400: 'scripted heavy battery', area: 'scripted heavy battery', full: 'scripted battery + platoons' }[player];
  const pd = loadout[1] === loadout[2] ? NAME[loadout[1]] ?? loadout[1] : 'Pantsir and Tunguska';
  const area = NAME[loadout[0]] ?? loadout[0];
  return { auto: 'all auto', s400: `scripted ${area}`, area: `scripted ${area}`, full: `scripted ${area} + ${pd}` }[player];
};

// ---------------------------------------------------------------- one game
function run(seed, player, difficulty, fullLog = false, loadout = DEFAULT_LOADOUT, era = DEFAULT_ERA) {
  const sim = new Sim({ heightAt, los, seed });
  sim.newGame({ difficulty, seed, loadout, era });
  const LAYERS = layersFor(loadout);
  const log = [];
  const waves = [];
  let cur = null, firstShot = null;
  sim.events.radio = (text, kind) => log.push(`${sim.time.toFixed(0).padStart(5)}s ${kind.padEnd(5)} ${text}`);
  sim.events.wave = (n) => waves.push((cur = { n, t0: sim.time, t1: null, first: null }));
  sim.events.state = (s) => {
    if (cur && s !== 'wave' && cur.t1 === null) cur.t1 = sim.time;
  };
  sim.events.launch = () => {
    if (firstShot === null) firstShot = sim.time;
    if (cur && cur.first === null) cur.first = sim.time - cur.t0;
  };
  // the WW2 guns (sim/mounts.js): a heavy salvo or a light gun's burst counts as the first shot
  if (ww2()) sim.events.salvo = sim.events.muzzle = sim.events.launch;
  const script = PLAYERS[player];
  let steps = 0, worst = 0, total = 0, maxThreats = 0, scriptT = 0;
  while (sim.state !== 'victory' && sim.state !== 'defeat' && sim.time < 3600) {
    if (script && (scriptT -= 0.05) <= 0) {
      scriptT = 0.5;
      script(sim);
    }
    const t0 = performance.now();
    sim.update(0.05);
    const ms = performance.now() - t0;
    total += ms;
    if (steps > 200) worst = Math.max(worst, ms);
    steps++;
    let n = 0;
    for (const t of sim.threats) if (t.alive) n++;
    maxThreats = Math.max(maxThreats, n);
  }
  if (cur && cur.t1 === null) cur.t1 = sim.time;

  const perWave = sim.stats.waves.map((w, i) => {
    const kills = Object.fromEntries(LAYERS.map((l) => [l, 0]));
    for (const [key, n] of Object.entries(w.kills)) kills[layerOf(sim, LAYERS, key)] += n;
    const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0);
    const wr = waves[i] ?? { t0: 0, t1: 0, first: null };
    return { n: w.wave, dur: wr.t1 - wr.t0, first: wr.first, kills, leaks: sum(w.leaked), spawned: sum(w.spawned), dmg: sum(w.assetDamage) + sum(w.unitDamage), raw: w };
  });

  const fmt = (o) => Object.entries(o).map(([k, v]) => `${k} ${typeof v === 'number' && v % 1 ? v.toFixed(0) : v}`).join(', ') || '-';
  const out = [];
  out.push(`\n=== seed ${seed}, ${playerName(player, loadout)}, ${difficulty}: ${sim.state.toUpperCase()} at wave ${sim.wave}/${WAVES.length}, ${(sim.time / 60).toFixed(1)} min, first shot at ${firstShot?.toFixed(0) ?? '-'} s`);
  out.push(`score ${sim.score.points}, kills ${sim.score.kills}, leaks ${sim.score.leaks}, missile cost ${sim.score.cost}, damage ${sim.score.damage.toFixed(0)}`);
  out.push(`step ${(total / steps).toFixed(3)} ms avg, ${worst.toFixed(2)} ms worst, ${steps} steps, up to ${maxThreats} threats alive`);
  for (const w of perWave) {
    out.push(` wave ${w.n}: ${(w.dur / 60).toFixed(1)} min, first launch ${w.first?.toFixed(0) ?? '-'} s | spawned ${fmt(w.raw.spawned)}`);
    out.push(`   kills ${LAYERS.map((l) => `${l} ${w.kills[l]}`).join(', ')} (${fmt(w.raw.kills)})`);
    out.push(`   leaked ${fmt(w.raw.leaked)} | fired ${fmt(w.raw.fired)} | asset dmg ${fmt(w.raw.assetDamage)} | unit dmg ${fmt(w.raw.unitDamage)}`);
  }
  // a dispersed unit's vehicles: + standing, x knocked out
  const vehicles = (u) => (u.parts.some((p) => p.hp != null) ? ` [${u.parts.map((p) => `${p.role[0]}${p.alive ? '+' : 'x'}`).join('')}]` : '');
  out.push(' units: ' + sim.units.map((u) => `${u.id} ${u.alive ? Math.round(u.hp) : 'DEAD'}${vehicles(u)} (${Object.values(u.weapons.stock).map((s) => `${s.type} ${s.ready}+${s.reserve}`).join(' ')}${u.weapons.gun ? `${u.weapons.missiles ? ' ' : ''}${u.weapons.gun.shell} ${u.weapons.gun.rounds}` : ''})`).join(', '));
  out.push(' assets: ' + sim.assets.map((a) => `${a.id} ${Math.round(a.hp)}`).join(', '));
  return {
    seed, player, difficulty, text: out.join('\n'), log: (fullLog ? log : log.slice(0, 60)).join('\n'),
    win: sim.state === 'victory', wave: sim.wave, time: sim.time, firstShot, leaks: sim.score.leaks,
    avg: total / steps, worst, waves: perWave.map(({ raw, ...w }) => w),
  };
}

// ---------------------------------------------------------------- workers and the summary
if (!isMainThread) {
  parentPort.on('message', (job) => {
    if (!job) return process.exit(0);
    parentPort.postMessage(run(job.seed, job.player, job.difficulty, job.log, job.loadout, job.era));
  });
} else {
  const args = process.argv.slice(2);
  const flag = (n) => args.includes(n);
  const opt = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d);
  const seeds = args.filter((a, i) => /^\d+$/.test(a) && !/^--(jobs|difficulty|players)$/.test(args[i - 1] ?? '')).map(Number);
  const dOpt = opt('--difficulty', 'Normal');
  const difficulties = dOpt === 'all' ? ['Easy', 'Normal', 'Hard'] : dOpt.split(',');
  const players = flag('--player') ? ['s400'] : flag('--all') ? ['auto', 's400', 'full'] : flag('--both') ? ['auto', 's400'] : opt('--players', 'auto').split(',');
  const quiet = flag('--quiet');
  const table = flag('--table');
  const era = opt('--era', DEFAULT_ERA);
  if (!eraById(era)?.slots.length) {
    console.error(`--era: '${era}' is not an era with units (${ERAS.filter((e) => e.slots.length).map((e) => e.id).join(', ')})`);
    process.exit(1);
  }
  setEra(era);
  if (era !== DEFAULT_ERA) console.log(`era: ${era}`);
  let loadout;
  try {
    loadout = parseLoadout(opt('--loadout', 'default'));
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
  const LAYERS = layersFor(loadout);
  if (loadout.some((k, i) => k !== DEFAULT_LOADOUT[i])) console.log(`loadout: ${loadout.join(', ')}`);

  const jobs = [];
  for (const difficulty of difficulties) for (const player of players) for (const seed of seeds.length ? seeds : [1, 2, 3]) jobs.push({ seed, player, difficulty, log: flag('--log'), loadout, era });
  const nWorkers = Math.max(1, Math.min(jobs.length, Number(opt('--jobs', Math.min(12, os.cpus().length - 2)))));
  const results = new Array(jobs.length);
  let next = 0;
  await Promise.all(Array.from({ length: nWorkers }, () => new Promise((resolve) => {
    const w = new Worker(new URL(import.meta.url));
    let idx = -1;
    const feed = () => {
      if (next >= jobs.length) {
        w.postMessage(null);
        return resolve();
      }
      idx = next++;
      w.postMessage(jobs[idx]);
    };
    w.on('message', (r) => {
      results[idx] = r;
      feed();
    });
    w.on('error', (e) => {
      console.error(e);
      resolve();
    });
    feed();
  })));

  if (!table) for (const r of results) {
    if (!r) continue;
    console.log(r.text);
    if (!quiet) console.log(r.log);
  }

  const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
  const f1 = (x) => x.toFixed(1);
  console.log('\n======== summary, means over seeds ========');
  for (const difficulty of difficulties) for (const player of players) {
    const rs = results.filter((r) => r && r.difficulty === difficulty && r.player === player);
    if (!rs.length) continue;
    const allW = rs.flatMap((r) => r.waves);
    const perGame = (l) => mean(rs.map((r) => r.waves.reduce((s, w) => s + w.kills[l], 0)));
    const cover = (l) => Math.round((allW.filter((w) => w.kills[l] > 0).length / Math.max(1, allW.length)) * 100);
    console.log(`\n${difficulty}, ${playerName(player, loadout)}: won ${rs.filter((r) => r.win).length}/${rs.length}, ` +
      `lost in waves [${rs.filter((r) => !r.win).map((r) => r.wave).join(' ') || '-'}], ` +
      `${f1(mean(rs.map((r) => r.time / 60)))} min, first shot ${mean(rs.map((r) => r.firstShot ?? 0)).toFixed(0)} s, ` +
      `leaks ${f1(mean(rs.map((r) => r.leaks)))}, step ${mean(rs.map((r) => r.avg)).toFixed(3)} ms (worst ${Math.max(...rs.map((r) => r.worst)).toFixed(1)})`);
    console.log(`  kills per game ${LAYERS.map((l) => `${l} ${f1(perGame(l))}`).join(', ')} | waves with a kill ${LAYERS.map((l) => `${l} ${cover(l)}%`).join(', ')}`);
    console.log('  wave  n   min  first  spawned ' + LAYERS.map((l) => l.padStart(6)).join('') + '  leaks    dmg');
    for (let n = 1; n <= WAVES.length; n++) {
      const ws = allW.filter((w) => w.n === n);
      if (!ws.length) continue;
      console.log(`  ${String(n).padStart(4)} ${String(ws.length).padStart(2)} ${f1(mean(ws.map((w) => w.dur / 60))).padStart(5)} ${mean(ws.map((w) => w.first ?? 0)).toFixed(0).padStart(6)} ${f1(mean(ws.map((w) => w.spawned))).padStart(8)} ` +
        LAYERS.map((l) => f1(mean(ws.map((w) => w.kills[l]))).padStart(6)).join('') +
        ` ${f1(mean(ws.map((w) => w.leaks))).padStart(6)} ${mean(ws.map((w) => w.dmg)).toFixed(0).padStart(6)}`);
    }
  }
}
