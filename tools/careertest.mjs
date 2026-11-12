// The career's checks: node tools/careertest.mjs [--battles]
// Research order and overflow, the lineup (owned units only, empty sites, the best owned), the threat levels'
// setups and modifiers, unlocking, saving and loading (src/career.js), for every era with a career. With
// --battles it also plays one headless career battle per era at level 1 with the starting units and one at
// level 10 with the elite lineup (dev mode), to see that they run and pay; that is not a balance test.
import { ERAS } from '../src/eras/index.js';
import { EMPTY } from '../src/deploy.js';

// local storage for Node
const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
};
const C = await import('../src/career.js');

let fails = 0;
const check = (ok, what) => {
  if (!ok) {
    fails++;
    console.log(`FAIL ${what}`);
  }
};

for (const era of ERAS.filter((e) => e.career)) {
  const tag = (s) => `${era.id}: ${s}`;
  const tree = C.treeOf(era);
  // the tree: every node an option of some slot, a known column, a known predecessor, columns without loops
  for (const n of tree) {
    check(era.slots.some((s) => s.options.some((o) => o.kind === n.kind)), tag(`${n.kind} is no slot's option`));
    check(era.career.columns.some((c) => c.id === n.column), tag(`${n.kind} has an unknown column`));
    check(!n.after || tree.some((x) => x.kind === n.after && x.column === n.column), tag(`${n.kind} comes after a unit not in its column`));
  }
  check(era.career.columns.reduce((k, c) => k + C.columnOf(era, c.id).length, 0) === tree.length, tag('columns do not hold every unit once'));
  for (const k of era.career.start) check(tree.some((n) => n.kind === k && n.cost === 0), tag(`start unit ${k} is not free in the tree`));
  const allKinds = new Set(era.slots.flatMap((s) => s.options.map((o) => o.kind)));
  for (const k of allKinds) check(tree.some((n) => n.kind === k), tag(`slot option ${k} is not in the tree`));

  // a new career
  let c = C.resetCareer(era);
  check(c.owned.join() === era.career.start.join(), tag('a new career owns only the start units'));
  check(C.researchable(era, c, c.target), tag('a new career researches something open'));
  const line = C.lineupOf(era, c);
  check(C.hasUnits(line), tag('the start lineup fields a unit'));
  check(line.every((k) => k === EMPTY || c.owned.includes(k)), tag('the start lineup fields only owned units'));
  check(!tree.some((n) => n.after && !c.owned.includes(n.after) && C.setTarget(era, c, n.kind)), tag('a locked unit can be targeted'));

  // research: everything, in column order, with the RP running over from one unit to the next
  const total = tree.reduce((k, n) => k + n.cost, 0);
  const done = C.earn(era, c, total - 1);
  check(done.length === tree.length - era.career.start.length - 1, tag(`one RP short of the whole tree researches all but one (${done.length})`));
  for (const k of done) {
    const n = C.nodeOf(era, k);
    check(!n.after || c.owned.indexOf(n.after) < c.owned.indexOf(k), tag(`${k} researched before ${n.after}`));
  }
  C.earn(era, c, 1);
  check(c.owned.length === tree.length && c.target === null, tag('the whole tree researched'));
  check(c.earned === total, tag('earned RP counted'));

  // the lineup: null takes the best owned, EMPTY stays empty, a kind the slot does not offer is refused
  const best = C.lineupOf(era, c);
  era.slots.forEach((s, i) => {
    const top = C.slotChoices(era, c, i)[0];
    check(best[i] === top, tag(`slot ${i + 1} fields the best owned (${best[i]} / ${top})`));
  });
  check(C.setSlot(era, c, 0, EMPTY) && C.lineupOf(era, c)[0] === EMPTY, tag('a site left empty'));
  check(!C.setSlot(era, c, 0, 'nonesuch'), tag('an unknown kind refused'));
  const fresh = C.resetCareer(era);
  const locked = era.slots[0].options.find((o) => !fresh.owned.includes(o.kind));
  if (locked) {
    check(!C.setSlot(era, fresh, 0, locked.kind), tag('an unowned unit refused for the lineup'));
    check(C.setSlot(era, fresh, 0, locked.kind, true), tag('dev mode lets any unit into the lineup'));
  }

  // threat levels: in order, each a valid setup; modifiers from level 5 (one) and 8 (two)
  const levels = C.levelsOf(era);
  check(levels.length === 10, tag('ten threat levels'));
  for (const lv of levels) {
    const s = C.levelSetup(era, lv.n, []);
    check(s.raids.length === lv.waves.length && s.raids.every((r) => r.groups.length), tag(`level ${lv.n} raids`));
    check(s.difficulty.hit > 0 && s.difficulty.enemy > 0, tag(`level ${lv.n} difficulty`));
    for (let seed = 1; seed < 40; seed++) check(C.rollModifiers(era, lv.n, seed).length === lv.mods, tag(`level ${lv.n} rolls ${lv.mods} modifiers`));
  }
  for (const m of era.career.modifiers) {
    const s = C.levelSetup(era, 7, [m.id]);
    const plain = C.levelSetup(era, 7, []);
    if (m.add) check(s.raids[1].groups.length === plain.raids[1].groups.length + 1 && s.raids[0].groups.length === plain.raids[0].groups.length, tag(`${m.id} adds a group from the second raid`));
    if (m.flank) check(s.raids[0].groups[1].bearing === plain.raids[0].groups[1].bearing + m.flank, tag(`${m.id} turns every other group`));
    if (m.count) check(Math.abs(s.difficulty.enemy - plain.difficulty.enemy * m.count) < 1e-9, tag(`${m.id} scales the raids`));
    if (m.visibility) check(s.visibility === m.visibility, tag(`${m.id} sets the visibility`));
  }
  check(era.waves[0].groups.every((g, j) => g.bearing === C.levelSetup(era, 1, ['flank']).raids[0].groups[j].bearing - (j % 2 ? 90 : 0)), tag('the era\'s waves are left unchanged'));
  c = C.resetCareer(era);
  check(levels.every((lv) => C.levelOpen(era, c, lv.n)), tag('every level open from the start'));
  C.finishLevel(era, c, 1, false);
  check(c.unlocked === 2, tag('playing level 1 to its end records level 2 reached'));
  const before = c.earned;
  C.finishLevel(era, c, 2, true);
  check(c.earned - before === C.WIN_RP * levels[1].pay, tag('a victory pays its bonus'));

  // save and load
  C.setSlot(era, c, era.slots.length - 1, EMPTY);
  C.saveCareer(era, c);
  const back = C.loadCareer(era);
  check(JSON.stringify(back) === JSON.stringify(c), tag('a career comes back as saved'));
  localStorage.setItem(`echelon.career.${era.id}`, '{"v":0}');
  check(C.loadCareer(era).owned.join() === era.career.start.join(), tag('another version starts a new career'));
  console.log(`${era.id}: ${tree.length} units in ${era.career.columns.length} columns, ${total.toLocaleString('en-US')} RP for the tree, ${levels.length} levels`);
}

// A headless career battle: the lineup at the level, to its end (or 2 h of battle)
if (process.argv.includes('--battles')) {
  const { Sim } = await import('../src/sim/sim.js');
  const { heightAt, los } = await import('../src/terrainHeight.js');
  for (const era of ERAS.filter((e) => e.career)) {
    for (const [n, dev] of [[1, false], [10, true]]) {
      const c = C.resetCareer(era);
      const lineup = C.lineupOf(era, c, dev);
      const level = C.levelSetup(era, n, C.rollModifiers(era, n, 7));
      const sim = new Sim({ heightAt, los, seed: 7 });
      let paid = 0;
      sim.events.reward = (rp) => (paid += rp);
      sim.newGame({ era: era.id, loadout: lineup, level, seed: 7 });
      check(sim.units.length === lineup.filter((k) => k !== EMPTY).length, `${era.id} level ${n}: fields its lineup`);
      for (let i = 0; i < 144000 && sim.state !== 'victory' && sim.state !== 'defeat'; i++) sim.update(0.05);
      check(sim.state === 'victory' || sim.state === 'defeat', `${era.id} level ${n}: ends`);
      check(paid === sim.rp && (sim.score.kills === 0 || sim.rp > 0), `${era.id} level ${n}: pays for its kills`);
      console.log(`${era.id} level ${n} (${lineup.filter((k) => k !== EMPTY).join(', ')}${level.mods.length ? `; ${level.mods.join(', ')}` : ''}): ${sim.state} at raid ${sim.wave}/${sim.raids.length}, ${(sim.time / 60).toFixed(1)} min, ${sim.score.kills} kills, ${sim.rp} RP`);
    }
  }
}

console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
