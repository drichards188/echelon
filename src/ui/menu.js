import { ERAS, eraById } from '../eras/index.js';
import {
  ERA_KEY, LESSONS_KEY, DIFFICULTIES, MODE_KEY, stored, store, migrateLoadout, startEra, keptLoadout, keepLoadout, keptDifficulty, keepDifficulty, keptMode, gameHref, canPlay,
} from '../choices.js';
import {
  EMPTY, loadCareer, saveCareer, resetCareer, devMode, setDevMode, treeOf, columnOf, nodeOf, nextInColumn, unitInfo, rankName, owns, researchable, setTarget,
  slotChoices, lineupOf, setSlot, hasUnits, levelsOf, levelOf, rollModifiers, modifierOf, researchedShare, researchShareOf,
} from '../career.js';
import { SYSTEMS, MISSILES } from '../sim/systems.js';
import { paradeLine, paradeCrew, displayOf, shellName } from '../parade.js';
import { STILLS, stillUrl } from './backdrop.js';
import { createHangar } from './hangar.js';
import './menu.css';

// The main menu, laid out as a tank game's garage (after Drumfire's): a top bar with the era tabs (Modern, WW2; an
// era in development greyed), the two screens (the Hangar: the unit chosen drawn up on parade in 3D, its details on
// the left, its armament and the next unit of its column on the right, the five sites of the lineup along the
// bottom; Research: the era's tree in columns by type beside the unit shown), the three lists (Career battle,
// Quick battle, Tutorials) with the chooser that drops from them (the threat level and the modifiers rolled for it,
// the difficulty, or the lesson), To battle, and on the right the dev mode switch and the career's reset.
// Choosing an era, a unit, a site or a screen never reloads the page; To battle opens the game page, which loads the
// world behind its own loading card (ui/loading.js). The hangar (ui/hangar.js) loads three.js the first time it
// shows a unit, behind the menu's loading screen; without WebGL the unit's still stands in.
//
// Kept in local storage: the era, the loadouts, the difficulty and the mode as before (choices.js), the career
// (career.js), and the menu's own last choices (`echelon.menu`: the screen, the site chosen and the unit shown in
// Research per era, the list open, the lesson chosen per era).
const MENU_KEY = 'echelon.menu';
const VIEWS = [['hangar', 'Hangar'], ['research', 'Research']];
const TABS = [['career', 'Career battle'], ['battle', 'Quick battle'], ['tutorials', 'Tutorials']];
const KEYS = '<li><kbd>1</kbd>-<kbd>5</kbd> select unit</li><li><kbd>Drag</kbd> orbit</li><li><kbd>Wheel</kbd> zoom</li><li><kbd>F</kbd> chase the latest missile</li><li><kbd>C</kbd> free camera</li><li><kbd>V</kbd> padlock</li><li><kbd>M</kbd> mute</li><li><kbd>[</kbd> <kbd>]</kbd> time compression</li><li><kbd>H</kbd> hide overlay</li>';

const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};
const num = (n) => Math.round(n).toLocaleString('en-US');
const km = (m) => `${(m / 1000).toFixed(m < 9500 ? 1 : 0)} km`;
const bar = (k) => {
  const b = el('span', 'rs-bar'), f = el('i');
  f.style.width = `${Math.round(Math.min(1, Math.max(0, k)) * 100)}%`;
  b.append(f);
  return b;
};
const actBtn = (text, act, why, onClick) => {
  const b = el('button', 'rs-act', text);
  b.type = 'button';
  b.dataset.act = act;
  b.disabled = !!why;
  if (why) b.title = why;
  b.addEventListener('click', onClick);
  return b;
};
const read = (key, fallback) => {
  try {
    return JSON.parse(stored(key)) ?? fallback;
  } catch {
    return fallback;
  }
};

// ---------------------------------------------------------------- a unit's figures (SYSTEMS, MISSILES, SHELLS)
// the first slot option of `kind` in the era: its name, parts and trade-off
const optionOf = (era, kind) => era.slots.flatMap((s) => s.options).find((o) => o.kind === kind) ?? null;
const slotOf = (era, kind) => era.slots.find((s) => s.options.some((o) => o.kind === kind)) ?? null;
// ballistics.js (it brings three.js, which the hangar loads anyway): the guns' reach once it is in
let SHELLS = null, reachOf = null;
const ballistics = import('../ballistics.js').then((m) => ({ SHELLS, reachOf } = m)).catch(() => {});
const shellReach = (shell) => (SHELLS?.[shell] && reachOf ? reachOf(SHELLS[shell]) : 0);
// the gun kinds of a unit with how many of each stand in its line ({ gun, n, g } each)
function gunsOf(era, kind) {
  const s = SYSTEMS[kind] ?? {}, o = optionOf(era, kind);
  if (!s.guns) return [];
  const line = paradeLine(kind, o?.parts ?? []).line;
  return Object.entries(s.guns).map(([gun, g]) => ({ gun, g, n: line.filter((p) => p.kind === gun).length })).filter((x) => x.n);
}
const feedOf = (g) => (g.feed?.mag ? `magazines of ${g.feed.mag}` : g.feed?.clip ? `clips of ${g.feed.clip}` : g.feed?.hand ? 'loaded by hand' : 'belt fed');
function figures(era, kind) {
  const s = SYSTEMS[kind] ?? {}, o = optionOf(era, kind), parts = o?.parts ?? [];
  const missiles = Object.keys(s.stocks ?? {}).filter((m) => MISSILES[m]);
  const guns = gunsOf(era, kind);
  const reach = Math.max(0, ...missiles.map((m) => MISSILES[m].range), s.gun ? shellReach(s.gun.shell) || s.gun.range : 0, ...guns.map(({ g }) => shellReach(g.shell) || g.range || 0));
  // (a battery laid from its predictor takes the bombers at any height its shells reach: no ceiling of its own)
  const up = s.predictor ? 0 : Math.max(0, ...missiles.map((m) => MISSILES[m].maxAlt), s.gun?.maxAlt ?? 0, ...guns.map(({ g }) => g.maxAlt ?? 0));
  const out = [];
  if (reach) out.push(['Reach', km(reach)]);
  if (up) out.push(['Ceiling', km(up)]);
  if (missiles.length) out.push(['Missiles', missiles.join(', ')]);
  if (s.gun) out.push(['Guns', shellName(s.gun.shell)]);
  if (guns.length) out.push(['Guns', guns.map(({ g, n }) => `${n} × ${shellName(g.shell)}`).join(', ')]);
  if (missiles.length) {
    out.push(['Ready', missiles.map((m) => s.stocks[m].ready).join(' + ') + (s.gun ? ` · ${num(s.gun.rounds)} rds` : '')]);
    out.push(['Reserve', missiles.map((m) => s.stocks[m].reserve).join(' + ')]);
  } else if (s.gun) out.push(['Rounds', num(s.gun.rounds)]);
  else if (guns.length) out.push(['Rounds', guns.map(({ g }) => `${num(g.rounds)} a gun`).join(', ')]);
  if (s.reload) out.push(['Reload', `${s.reload} s`]);
  else if (guns.length) out.push(['Feed', feedOf(guns[0].g)]);
  if (s.channels) out.push(['Targets', s.channels > 1 ? `${s.channels} at once` : 'one at a time']);
  const line = paradeLine(kind, parts).line;
  out.push([s.mounts ? 'Pieces' : 'Vehicles', String(line.length)]);
  out.push(['Crew', `${paradeCrew(kind, parts)} on parade`]);
  return out;
}
// the armament panel's rows: one per piece on the display (parade.js displayOf), its game values
function armament(era, kind) {
  const s = SYSTEMS[kind] ?? {};
  return displayOf(kind).map((e) => {
    if (e.missile) {
      const m = MISSILES[e.missile], st = s.stocks?.[e.missile];
      return { name: e.missile, kicker: 'Missile', line: `to ${km(m.range)}, ${km(m.maxAlt)} up · ${num(m.speed)} m/s${m.command ? ' · command guided' : m.seeker ? ' · own seeker' : ''}`, more: st ? `${st.ready} ready, ${st.reserve} in reserve` : '' };
    }
    if (s.gun && s.gun.shell === e.shell) {
      const r = shellReach(e.shell);
      return { name: `${shellName(e.shell)} guns`, kicker: 'Guns', line: `open fire at ${km(s.gun.range)}${r ? `, reach ${km(r)}` : ''}`, more: `${num(s.gun.rounds)} rounds · ${num(s.gun.rate * 60)} a minute` };
    }
    const g = s.guns?.[e.guns?.[0]];
    if (!g) return { name: shellName(e.shell), kicker: 'Rounds', line: '', more: '' };
    const r = shellReach(e.shell);
    return {
      name: shellName(e.shell), kicker: e.guns.length > 1 ? 'Guns' : 'Gun',
      line: g.feed?.hand ? `a round every ${g.feed.load} s${g.barrels > 1 ? ` from each of ${g.barrels} barrels` : ''} · ${feedOf(g)}` : `${num(g.rate * 60 * (g.barrels ?? 1))} rounds a minute${g.barrels > 1 ? ` from ${g.barrels} barrels` : ''} · ${feedOf(g)}`,
      more: `${num(g.rounds)} rounds a gun${r ? ` · reach ${km(r)}` : ''}${g.range ? ` · opens fire at ${km(g.range)}` : ''}`,
    };
  });
}

// The background behind the Research card and the hangar's stand-in: the unit's still from the game
const still = (kind) => (STILLS.has(kind) ? `url("${stillUrl(kind)}")` : '');

export function mountMenu(root = document.getElementById('menu'), { webgl = true } = {}) {
  const q = new URLSearchParams(location.search);
  migrateLoadout();
  const memo = read(MENU_KEY, {});
  for (const k of ['sel', 'rs', 'lesson']) memo[k] = memo[k] && typeof memo[k] === 'object' ? memo[k] : {};
  let era = eraById(startEra(q));
  let career = loadCareer(era);
  let loadout = keptLoadout(era);
  let difficulty = keptDifficulty();
  let dev = devMode();
  let mode = keptMode(); // the slot bar's: 'career' (the lineup) or 'battle' (the free loadout)
  let tab = q.get('lessons') ? 'tutorials' : TABS.some(([t]) => t === memo.tab) ? memo.tab : mode;
  let view = VIEWS.some(([v]) => v === memo.view) ? memo.view : 'hangar';
  let open = !!q.get('lessons'), swap = null, preview = null, mods = [], lessons = null;
  const save = () => store(MENU_KEY, JSON.stringify({ view, tab, sel: memo.sel, rs: memo.rs, lesson: memo.lesson }));
  const saveC = () => saveCareer(era, career);
  const rollMods = () => (mods = era.career ? rollModifiers(era, career.level, (Math.random() * 2 ** 32) >>> 0) : []);
  // the address without what it no longer asks for
  const forget = (...keys) => {
    for (const k of keys) q.delete(k);
    history.replaceState(null, '', `${location.pathname}${q.toString() ? `?${q}` : ''}`);
  };

  root.innerHTML = `<header class="mn-top"><div class="mn-top-in">
      <b class="mn-mark">ECHELON</b>
      <nav class="mn-eras" aria-label="Era"></nav>
      <nav class="mn-views" aria-label="Screens">${VIEWS.map(([v, name]) => `<button type="button" data-view="${v}">${name}<span class="mn-view-n"></span></button>`).join('')}</nav>
      <div class="mn-go">
        <nav class="mn-modes" aria-label="What to play">${TABS.map(([t, name]) => `<button type="button" data-mode="${t}">${name}</button>`).join('')}</nav>
        <button type="button" class="mn-mode" aria-haspopup="dialog" aria-expanded="false" title="Choose the battle or the lesson"><small class="mn-mode-k"></small><b class="mn-mode-t"></b><span class="mn-mode-d"></span></button>
        <button type="button" id="mn-play">To battle</button>
      </div>
      <div class="mn-switches">
        <button class="dev-unlock" data-switch="dev" type="button" aria-pressed="false" title="Dev mode: every unit of the era owned for the lineup and every level open, for testing. Your own career goes on underneath. Saved in this browser."><span class="dev-light"></span>Dev mode <b class="dev-state">OFF</b></button>
        <button class="mn-reset" type="button" title="Reset this era's career: research, lineup, levels and battles back to a new career. Click twice to confirm.">Reset</button>
      </div>
    </div></header>
    <section class="mn-drop" role="dialog" aria-label="Choose the battle" hidden>
      <button type="button" class="mn-drop-close" aria-label="Close">✕</button>
      <div class="mn-drop-list">
        <nav class="mn-tabs" aria-label="Lists">${TABS.map(([t, name]) => `<button type="button" data-tab="${t}">${name}<span class="mn-count"></span></button>`).join('')}</nav>
        <p class="mn-help"></p>
        <div class="mn-list" role="listbox" aria-label="Choices"></div>
      </div>
      <div class="mn-drop-detail">
        <div class="mn-detail" aria-live="polite"><small class="mn-kicker"></small><h2 class="mn-title"></h2><p class="mn-sub"></p><p class="mn-blurb"></p><ul class="mn-lines"></ul></div>
        <div class="mn-difficulty" role="radiogroup" aria-label="Difficulty">${DIFFICULTIES.map((d) => `<button type="button" role="radio" data-d="${d}">${d}</button>`).join('')}</div>
        <button type="button" class="mn-play2">To battle</button>
        <ul class="keys mn-keys">${KEYS}</ul>
      </div>
    </section>
    <main class="mn-hangar" data-for="hangar">
      <div class="hg-stage"></div>
      <div class="hg-preview" hidden><span class="hg-preview-t"></span><button type="button" class="rs-act" data-act="back-research">Back to research</button></div>
      <section class="hg-info" aria-label="Unit"></section>
      <aside class="hg-mods" aria-label="Armament"></aside>
      <footer class="hg-bar"><div class="hg-slots" role="toolbar" aria-label="Sites"></div><div class="mn-status"><span class="hg-count"></span><span class="mn-save"></span></div></footer>
    </main>
    <div class="mn-rsv" data-for="research" hidden>
      <header class="rsv-head"><div><small class="mn-kicker rsv-kicker"></small><h1 class="rsv-title">Research</h1></div></header>
      <p class="rsv-help">Pick the unit to research: every career battle pays research points into it, won or lost, and a victory pays a bonus. Each column is researched from the top down; a unit researched joins the lineup's choices for the sites that take it.</p>
      <div class="rsv-body"></div>
    </div>`;
  const $ = (s) => root.querySelector(s);
  const $$ = (s) => root.querySelectorAll(s);
  const drop = $('.mn-drop'), modeBtn = $('.mn-mode'), slotsEl = $('.hg-slots');

  // the loading screen: up until the hangar's first parade stands drawn (or a minute has passed)
  const loading = el('div', 'mn-loading');
  loading.setAttribute('role', 'status');
  loading.innerHTML = '<div class="ml-in"><h1 class="ml-brand">ECHELON</h1><p class="ml-era"></p><div class="ml-bar"><i></i></div><p class="ml-step">Loading</p></div>';
  root.append(loading);
  let loaded = false;
  const lift = () => {
    if (loaded) return;
    loaded = true;
    loading.classList.add('done');
    setTimeout(() => loading.remove(), 700);
  };
  setTimeout(lift, 60000);
  const hangar = createHangar($('.hg-stage'), {
    webgl,
    onProgress: (text, k) => {
      if (loaded) return;
      loading.querySelector('.ml-step').textContent = text;
      loading.querySelector('.ml-bar i').style.width = `${Math.round(k * 100)}%`;
    },
    onReady: lift,
  });
  window.__hangar = hangar; // the headless tools look at the hangar through it

  // ---------------------------------------------------------------- what the sites hold
  // the kinds on the sites: the career's lineup (EMPTY for a site left empty) or the quick battle's loadout
  const sites = () => (mode === 'career' && era.career ? lineupOf(era, career, dev) : loadout);
  const selSlot = () => Math.min(era.slots.length - 1, Math.max(0, memo.sel[era.id] | 0));
  // the unit in the hangar: the one previewed, else the chosen site's (an empty site: the first that is not)
  const shownKind = () => {
    if (preview) return preview;
    const s = sites(), i = selSlot();
    return s[i] !== EMPTY ? s[i] : s.find((k) => k !== EMPTY) ?? era.slots[i].options[0].kind;
  };
  const pickSlot = (i) => {
    memo.sel[era.id] = i;
    preview = null;
    swap = null;
    view = 'hangar';
    save();
    render();
  };
  const rsKind = () => (nodeOf(era, memo.rs[era.id]) ? memo.rs[era.id] : career.target ?? treeOf(era)[0]?.kind ?? shownKind());

  // ---------------------------------------------------------------- the top bar
  const eraNav = $('.mn-eras');
  for (const e of ERAS) {
    const b = el('button');
    b.type = 'button';
    b.dataset.era = e.id;
    b.append(e.name, el('small', null, e.years));
    if (!canPlay(e, q)) {
      b.classList.add('soon');
      b.setAttribute('aria-disabled', 'true');
      b.title = `${e.name}, ${e.years}: in development`;
    } else b.title = e.text.setting ?? `${e.name}, ${e.years}`;
    b.addEventListener('click', () => setEra(e));
    eraNav.append(b);
  }
  function setEra(e) {
    if (!canPlay(e, q) || e === era) return;
    era = e;
    store(ERA_KEY, e.id);
    career = loadCareer(era);
    loadout = keptLoadout(era);
    preview = null;
    swap = null;
    rollMods();
    if (!era.career && mode === 'career') mode = 'battle';
    if (q.has('era')) forget('era');
    render();
  }
  function renderTop() {
    for (const b of $$('[data-era]')) {
      const on = b.dataset.era === era.id;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', String(on));
    }
    for (const b of $$('[data-view]')) {
      b.setAttribute('aria-pressed', String(b.dataset.view === view));
      if (b.dataset.view === 'research') b.querySelector('.mn-view-n').textContent = era.career ? `${Math.round(researchedShare(era, career) * 100)}%` : '';
    }
    for (const w of $$('[data-for]')) w.hidden = w.dataset.for !== view;
    for (const b of $$('[data-mode]')) {
      const on = b.dataset.mode === tab;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', String(on));
      b.disabled = b.dataset.mode === 'career' ? !era.career : b.dataset.mode === 'tutorials' ? !era.tutorials.length : false;
    }
    const c = chosen();
    $('.mn-mode-k').textContent = c.kicker;
    $('.mn-mode-t').textContent = c.title;
    $('.mn-mode-d').textContent = c.side;
    const sw = $('[data-switch="dev"]');
    sw.setAttribute('aria-pressed', String(dev));
    sw.querySelector('.dev-state').textContent = dev ? 'ON' : 'OFF';
    sw.hidden = !era.career;
    $('.mn-reset').hidden = !era.career;
    for (const s of $$('.mn-save')) s.textContent = 'Saved in this browser';
    for (const c of [...document.body.classList]) if (c.startsWith('era-')) document.body.classList.remove(c);
    document.body.classList.add(`era-${era.theme}`);
  }
  // what To battle plays: { kicker, title, side }
  function chosen() {
    if (tab === 'tutorials') {
      const d = lesson();
      return { kicker: 'Tutorial', title: d?.name ?? 'Tutorials', side: d ? `${d.steps.length} steps` : '' };
    }
    if (tab === 'career' && era.career) {
      const lv = levelOf(era, career.level);
      return { kicker: 'Career battle', title: lv.name, side: `Level ${lv.n}` };
    }
    return { kicker: 'Quick battle', title: era.text.sub, side: difficulty };
  }

  // ---------------------------------------------------------------- the chooser
  const lessonsReady = import('../tutorial.js').then(
    (m) => {
      lessons = m.TUTORIALS;
      render();
    },
    (e) => console.warn(`tutorial list failed: ${e.message}`)
  );
  const doneLessons = () => read(LESSONS_KEY, {});
  const eraLessons = () => era.tutorials.map((id) => lessons?.find((d) => d.id === id)).filter(Boolean);
  const lesson = () => {
    const list = eraLessons();
    return list.find((d) => d.id === memo.lesson[era.id]) ?? list.find((d) => !doneLessons()[d.id]) ?? list[0] ?? null;
  };
  const setOpen = (on) => {
    open = on;
    drop.hidden = !on;
    modeBtn.setAttribute('aria-expanded', String(on));
    if (on) render();
  };
  const toTab = (t) => {
    tab = t;
    if (t !== 'tutorials' && t !== mode) {
      mode = t;
      store(MODE_KEY, mode);
      preview = null;
      swap = null;
    }
    save();
  };
  const row = (n, title, side, on, done, onClick) => {
    const r = el('button', 'mn-row');
    r.type = 'button';
    r.setAttribute('role', 'option');
    r.setAttribute('aria-selected', String(on));
    r.classList.toggle('on', on);
    r.classList.toggle('done', !!done);
    const label = el('span', 'mn-label');
    label.append(el('b', null, title), el('small', null, side));
    r.append(el('span', 'mn-n', n), label);
    r.addEventListener('click', onClick);
    return r;
  };
  function renderDrop() {
    const list = $('.mn-list');
    for (const b of $$('[data-tab]')) {
      b.setAttribute('aria-pressed', String(b.dataset.tab === tab));
      b.disabled = b.dataset.tab === 'career' ? !era.career : b.dataset.tab === 'tutorials' ? !era.tutorials.length : false;
      const count = b.dataset.tab === 'tutorials' && lessons ? `${eraLessons().filter((d) => doneLessons()[d.id]).length}/${eraLessons().length}` : b.dataset.tab === 'career' && era.career ? `${levelsOf(era).length} levels` : '';
      b.querySelector('.mn-count').textContent = count;
    }
    $('.mn-difficulty').hidden = tab !== 'battle';
    for (const b of $$('[data-d]')) {
      b.classList.toggle('on', b.dataset.d === difficulty);
      b.setAttribute('aria-checked', String(b.dataset.d === difficulty));
    }
    if (tab === 'career' && era.career) {
      $('.mn-help').textContent = 'Your career\'s lineup against a threat level: every level is open. A battle pays research points for every kill, won or lost, times the level\'s pay, and a victory pays a bonus.';
      list.replaceChildren(...levelsOf(era).map((lv) => row(String(lv.n).padStart(2, '0'), lv.name, `pay ×${lv.pay}`, lv.n === career.level, lv.n < career.unlocked, () => {
        if (career.level === lv.n) return;
        career.level = lv.n;
        saveC();
        rollMods();
        render();
      })));
      const lv = levelOf(era, career.level);
      const first = era.waves[lv.waves[0]].title.replace(/^Wave \d+: /, ''), lastW = era.waves[lv.waves[lv.waves.length - 1]].title.replace(/^Wave \d+: /, '');
      detail(`Threat level ${lv.n} · pay ×${lv.pay}`, lv.name, `Built for: ${lv.fits}`, lv.sub, [
        lv.waves.length > 1 ? `${lv.waves.length} raids, ${first} to ${lastW}` : `One raid: ${first}`,
        `Your lineup: ${sites().filter((k) => k !== EMPTY).map((k) => unitInfo(era, k).label).join(', ')}`,
        ...mods.map((id) => `${modifierOf(era, id).name}: ${modifierOf(era, id).line}`),
      ], mods.length);
    } else if (tab === 'tutorials') {
      $('.mn-help').textContent = 'Short guided lessons on a quiet range. Nothing is scored and nothing is destroyed.';
      const done = doneLessons(), cur = lesson();
      list.replaceChildren(...eraLessons().map((d, i) => row(done[d.id] ? '✓' : String(i + 1).padStart(2, '0'), d.name, `${d.steps.length} steps`, d === cur, done[d.id], () => {
        memo.lesson[era.id] = d.id;
        save();
        render();
      })));
      if (!lessons) list.append(el('p', 'mn-empty', 'Loading the lessons'));
      if (cur) detail(`Tutorial · ${era.name}`, cur.name, `${cur.steps.length} steps`, cur.blurb, [], 0);
      else detail('Tutorials', 'Tutorials', '', '', [], 0);
    } else {
      $('.mn-help').textContent = 'A battle with a free loadout: every option of every site, at the difficulty you choose. It pays no research points.';
      list.replaceChildren(row('01', era.text.sub, `${era.name}, ${era.years}`, true, false, () => {}));
      detail(`Quick battle · ${era.name}, ${era.years}`, era.text.sub, era.text.setting ?? '', era.text.blurb, [`Your loadout: ${loadout.map((k) => unitInfo(era, k).label).join(', ')}`], 0);
    }
  }
  function detail(kicker, title, sub, blurb, lines, nMods) {
    $('.mn-kicker').textContent = kicker;
    $('.mn-title').textContent = title;
    $('.mn-sub').textContent = sub;
    $('.mn-blurb').textContent = blurb;
    $('.mn-lines').replaceChildren(...lines.map((t, i) => el('li', i >= lines.length - nMods ? 'mod' : null, t)));
  }

  // ---------------------------------------------------------------- the hangar's panels
  // The unit's details: rank, column and era; name and role; its figures; what it is doing in the career
  function infoCard(kind) {
    const box = el('div', 'hg-info-in'), node = nodeOf(era, kind), info = unitInfo(era, kind), slot = slotOf(era, kind);
    const col = node && era.career.columns.find((c) => c.id === node.column);
    box.append(el('small', 'mn-kicker', [node && `Rank ${rankName(node.rank)}`, col?.name, `${era.name}, ${era.years}`].filter(Boolean).join(' · ')));
    box.append(el('h1', 'hg-name', info.name), el('p', 'hg-role', `${slot?.cls ?? ''}${info.info ? `: ${info.info}` : ''}`));
    const dl = el('dl', 'hg-figs');
    for (const [k, v] of figures(era, kind)) dl.append(el('dt', null, k), el('dd', null, v));
    box.append(dl);
    const acts = el('div', 'hg-acts');
    let state = '';
    if (mode === 'career' && era.career && !preview) {
      const s = sites(), at = s.indexOf(kind), own = owns(era, career, kind, dev);
      if (at >= 0) {
        const without = lineupOf(era, { ...career, lineup: career.lineup.map((k, i) => (i === at ? EMPTY : k)) }, dev);
        acts.append(actBtn('Leave out of battle', `leave:${at}`, hasUnits(without) ? '' : 'At least one site must field a unit', () => {
          setSlot(era, career, at, EMPTY, dev);
          saveC();
          render();
        }));
        state = `${owns(era, career, kind) ? 'Researched' : 'By dev mode'}: in your lineup on the ${era.slots[at].cls.toLowerCase()} site.`;
      } else if (own) {
        const to = era.slots.findIndex((sl) => sl.options.some((o) => o.kind === kind));
        acts.append(actBtn('Take into battle', `take:${kind}`, '', () => {
          setSlot(era, career, to, kind, dev);
          saveC();
          memo.sel[era.id] = to;
          save();
          render();
        }));
        state = 'Researched, not in your lineup.';
      }
    }
    if (era.career && !owns(era, career, kind)) {
      const n = nodeOf(era, kind), have = career.progress[kind] ?? 0;
      if (n) state = career.target === kind ? `Researching: ${num(have)} of ${num(n.cost)} RP.` : researchable(era, career, kind) ? `Not researched: ${num(n.cost)} RP${have ? `, ${num(have)} in` : ''}.` : `Not researched: after the ${unitInfo(era, n.after).name}.`;
      if (researchable(era, career, kind) && career.target !== kind) acts.append(actBtn('Research this', `target:${kind}`, '', () => {
        setTarget(era, career, kind);
        saveC();
        render();
      }));
    } else if (!state && era.career && owns(era, career, kind)) state = nodeOf(era, kind)?.cost ? 'Researched.' : 'A starting unit: yours from the first battle.';
    if (mode === 'battle' && !preview) state = 'In your quick battle loadout: any unit can take the field there.';
    if (preview) state = `Preview: the ${info.name} at full strength.${state ? ` ${state}` : ''}`;
    if (acts.children.length) box.append(acts);
    if (state) box.append(el('p', `hg-state${era.career && !owns(era, career, kind) && mode === 'career' ? ' not' : ''}`, state));
    if (dev && mode === 'career') box.append(el('p', 'rs-note', 'Dev mode is on: every unit of the era can take a site. Your own career goes on underneath.'));
    return box;
  }
  // The right panel: the unit's armament as it stands on the display (a row hovered takes the camera to it), and
  // the next unit of its column with its research
  function armsPanel(kind) {
    const box = el('div', 'hg-mods-in');
    box.append(el('h2', 'hg-panel-h', 'Armament'));
    const rows = el('div', 'rs-parts');
    armament(era, kind).forEach((a, i) => {
      const r = el('div', 'rs-part');
      r.tabIndex = 0;
      const l = el('div', 'rs-part-name');
      l.append(el('small', 'rs-part-k', a.kicker), el('b', null, a.name), el('small', null, a.line));
      if (a.more) l.append(el('small', 'rs-part-more', a.more));
      r.append(l);
      r.addEventListener('mouseenter', () => hangar.lookAt(i));
      r.addEventListener('mouseleave', () => hangar.lookAt(null));
      r.addEventListener('focus', () => hangar.lookAt(i));
      r.addEventListener('blur', () => hangar.lookAt(null));
      rows.append(r);
    });
    box.append(rows, el('p', 'rs-help', 'Hover a row to see it on the display in front of the ranks.'));
    if (era.career && nodeOf(era, kind)) {
      box.append(el('h2', 'hg-panel-h hg-next-h', 'Next in its column'));
      const next = nextInColumn(era, kind);
      if (!next) box.append(el('p', 'rs-help', 'The top of its column: nothing comes after it.'));
      else {
        const card = el('div', 'hg-next'), have = career.progress[next.kind] ?? 0, own = owns(era, career, next.kind);
        const head = el('button', 'hg-next-name');
        head.type = 'button';
        head.title = 'Show it in Research';
        head.append(el('span', 'hg-slot-tier', rankName(next.rank)), el('b', null, unitInfo(era, next.kind).name));
        head.addEventListener('click', () => showResearch(next.kind));
        card.append(head, el('small', null, unitInfo(era, next.kind).info), bar(researchShareOf(era, career, next.kind)));
        card.append(el('small', 'hg-next-state', own ? 'Researched' : career.target === next.kind ? `Researching · ${num(have)} of ${num(next.cost)} RP` : researchable(era, career, next.kind) ? `${num(next.cost)} RP · open for research` : `${num(next.cost)} RP · after the ${unitInfo(era, kind).name}`));
        const acts = el('div', 'hg-acts');
        if (!own && researchable(era, career, next.kind) && career.target !== next.kind) acts.append(actBtn('Research it', `target:${next.kind}`, '', () => {
          setTarget(era, career, next.kind);
          saveC();
          render();
        }));
        acts.append(actBtn('Preview on parade', `preview:${next.kind}`, '', () => previewKind(next.kind)));
        card.append(acts);
        box.append(card);
      }
    }
    return box;
  }

  // The sites along the bottom: a card each with the unit it fields (a career's lineup or the quick battle's
  // loadout) and a swap that opens the bench of the units that site can take
  function slotBar(kind) {
    const s = sites(), i0 = preview ? -1 : s[selSlot()] !== EMPTY ? selSlot() : s.findIndex((k) => k !== EMPTY);
    return era.slots.map((slot, i) => {
      const k = s[i], cell = el('div', 'hg-cell'), opened = swap === i;
      cell.classList.toggle('swapping', opened);
      const b = el('button', 'hg-slot');
      b.type = 'button';
      b.dataset.act = `slot:${i}`;
      b.classList.toggle('on', i === i0 && k !== EMPTY);
      b.setAttribute('aria-pressed', String(i === i0));
      b.append(el('span', 'hg-slot-key', String(i + 1)));
      if (k === EMPTY) {
        b.classList.add('empty');
        b.append(el('b', null, 'Empty site'), el('small', null, slot.cls));
        b.addEventListener('click', () => setSwap(opened ? null : i));
      } else {
        const n = nodeOf(era, k);
        if (n) b.append(el('span', 'hg-slot-tier', rankName(n.rank)));
        b.append(el('b', null, unitInfo(era, k).label), el('small', null, `${slot.cls}${mode === 'career' && era.career && !owns(era, career, k) ? ' · dev mode' : ''}`));
        b.addEventListener('click', () => pickSlot(i));
      }
      const sw = el('button', 'hg-swap', '⇄');
      sw.type = 'button';
      sw.dataset.act = `swap:${i}`;
      sw.title = `Another unit on the ${slot.cls.toLowerCase()} site`;
      sw.setAttribute('aria-label', sw.title);
      sw.setAttribute('aria-expanded', String(opened));
      sw.addEventListener('click', (e) => {
        e.stopPropagation();
        setSwap(opened ? null : i);
      });
      cell.append(b);
      if (k !== EMPTY || mode === 'battle') cell.append(sw);
      return cell;
    });
  }
  // The bench above the bar for site i: the options it takes (a career: those owned, the rest locked until
  // researched; leaving the site empty), or every option for a quick battle
  function bench(i) {
    const box = el('div', 'hg-bench'), slot = era.slots[i], s = sites();
    box.setAttribute('role', 'dialog');
    const head = el('div', 'hg-bench-h');
    head.append(el('span', null, `Site ${i + 1} · ${slot.cls}`));
    const x = el('button', 'hg-bench-x', '×');
    x.type = 'button';
    x.setAttribute('aria-label', 'Close');
    x.addEventListener('click', () => setSwap(null));
    head.append(x);
    const list = el('div', 'hg-bench-list');
    const career_ = mode === 'career' && era.career;
    const choices = career_ ? slotChoices(era, career, i, dev) : slot.options.map((o) => o.kind);
    for (const o of slot.options) {
      const ok = choices.includes(o.kind), n = nodeOf(era, o.kind), r = el('button', 'hg-bench-row');
      r.type = 'button';
      r.dataset.act = `bench:${i}:${o.kind}`;
      r.classList.toggle('on', s[i] === o.kind);
      r.disabled = !ok;
      if (n) r.append(el('span', 'hg-slot-tier', rankName(n.rank)));
      r.append(el('b', null, o.label ?? o.name), el('small', null, ok ? o.info ?? '' : `Research it first: ${num(n?.cost ?? 0)} RP`));
      r.addEventListener('click', () => {
        if (career_) {
          if (!setSlot(era, career, i, o.kind, dev)) return;
          saveC();
        } else {
          loadout = loadout.map((k, j) => (j === i ? o.kind : k));
          keepLoadout(era, loadout);
        }
        pickSlot(i);
      });
      list.append(r);
    }
    if (career_) {
      const without = lineupOf(era, { ...career, lineup: career.lineup.map((k, j) => (j === i ? EMPTY : k)) }, dev);
      const r = el('button', 'hg-bench-row empty');
      r.type = 'button';
      r.dataset.act = `bench:${i}:empty`;
      r.classList.toggle('on', s[i] === EMPTY);
      r.disabled = !hasUnits(without);
      r.append(el('b', null, 'Leave it empty'), el('small', null, hasUnits(without) ? 'No unit on this site' : 'At least one site must field a unit'));
      r.addEventListener('click', () => {
        setSlot(era, career, i, EMPTY, dev);
        saveC();
        swap = null;
        render();
      });
      list.append(r);
    }
    box.append(head, list);
    return box;
  }
  const setSwap = (i) => {
    swap = i;
    render();
  };
  const previewKind = (kind) => {
    preview = kind;
    view = 'hangar';
    swap = null;
    save();
    render();
  };

  function renderHangar() {
    const kind = shownKind(), o = optionOf(era, kind);
    hangar.setActive(true);
    if (o) hangar.show({ era: era.id, kind, parts: o.parts, name: unitInfo(era, kind).name });
    $('.hg-preview').hidden = !preview;
    $('.hg-preview-t').textContent = preview ? `Preview: the ${unitInfo(era, preview).name} on parade` : '';
    const focus = document.activeElement?.dataset?.act;
    $('.hg-info').replaceChildren(infoCard(kind));
    $('.hg-mods').replaceChildren(armsPanel(kind));
    slotsEl.replaceChildren(...slotBar(kind));
    $('.hg-bar > .hg-bench')?.remove();
    if (swap != null) $('.hg-bar').prepend(bench(swap));
    if (focus) root.querySelector(`[data-act="${CSS.escape(focus)}"]`)?.focus();
    const s = sites();
    $('.hg-count').textContent = mode === 'career' && era.career ? `Lineup: ${s.filter((k) => k !== EMPTY).length} of ${s.length} sites${dev ? ' · dev mode' : ''}` : 'Quick battle loadout';
  }

  // ---------------------------------------------------------------- the Research screen
  const showResearch = (kind) => {
    memo.rs[era.id] = kind;
    view = 'research';
    preview = null;
    swap = null;
    save();
    render();
  };
  function renderResearch() {
    hangar.setActive(false);
    const kind = rsKind(), body = $('.rsv-body');
    $('.rsv-kicker').textContent = `${era.name}, ${era.years}`;
    if (!era.career) {
      body.replaceChildren(el('p', 'rs-help', 'Nothing to research in this era: every unit is yours from the start.'));
      return;
    }
    const wrap = el('div', 'rs'), side = el('div', 'rs-side');
    const purse = el('div', 'rs-purse'), t = career.target && nodeOf(era, career.target);
    if (t) purse.append(el('small', null, 'Researching'), el('b', null, unitInfo(era, t.kind).name), bar(researchShareOf(era, career, t.kind)), el('small', null, `${num(career.progress[t.kind] ?? 0)} of ${num(t.cost)} RP · ${career.battles} ${career.battles === 1 ? 'battle' : 'battles'} fought · ${num(career.earned)} RP earned`));
    else purse.append(el('small', null, 'Research'), el('b', null, 'Every unit researched'), el('small', null, `${num(career.earned)} RP earned`));
    side.append(purse);
    const cols = el('div', 'rs-tree');
    cols.style.setProperty('--lines', era.career.columns.length);
    for (const col of era.career.columns) {
      const c = el('div', 'rs-line');
      c.append(el('div', 'rs-line-n', col.name));
      for (const n of columnOf(era, col.id)) {
        const own = owns(era, career, n.kind), open = researchable(era, career, n.kind), on = career.target === n.kind;
        const b = el('button', 'rs-node');
        b.type = 'button';
        b.dataset.act = `show:${n.kind}`;
        b.classList.toggle('own', own);
        b.classList.toggle('ready', open);
        b.classList.toggle('target', on);
        b.classList.toggle('on', n.kind === kind);
        b.setAttribute('aria-pressed', String(n.kind === kind));
        b.append(el('span', 'rs-rank', rankName(n.rank)), el('b', null, unitInfo(era, n.kind).name));
        if (on) b.append(bar(researchShareOf(era, career, n.kind)));
        b.append(el('small', null, own ? (n.cost ? 'Researched' : 'Starting unit') : on ? `Researching · ${Math.round(researchShareOf(era, career, n.kind) * 100)}%` : open ? `${num(n.cost)} RP` : `After the ${unitInfo(era, n.after).name}`));
        b.addEventListener('click', () => showResearch(n.kind));
        c.append(b);
      }
      cols.append(c);
    }
    side.append(cols);
    if (dev) side.append(el('p', 'rs-note', 'Dev mode is on: every unit can take a site in your lineup. This tree is your own career.'));
    // the unit shown: its still from the game, its figures, and what to do with it
    const card = el('section', 'rs-card'), node = nodeOf(era, kind), info = unitInfo(era, kind);
    const pic = el('div', 'rs-pic');
    pic.style.backgroundImage = still(kind);
    pic.setAttribute('role', 'img');
    pic.setAttribute('aria-label', `The ${info.name} in action`);
    const head = el('header', 'rs-card-head'), title = el('div');
    const col = era.career.columns.find((c) => c.id === node?.column);
    title.append(el('small', null, [node && `Rank ${rankName(node.rank)}`, col?.name].filter(Boolean).join(' · ')), el('h3', null, info.name));
    const acts = el('div', 'rs-head-acts'), own = owns(era, career, kind);
    if (!own && researchable(era, career, kind) && career.target !== kind) acts.append(actBtn('Research this', `target:${kind}`, '', () => {
      setTarget(era, career, kind);
      saveC();
      render();
    }));
    acts.append(actBtn('Preview on parade', `preview:${kind}`, '', () => previewKind(kind)));
    head.append(title, acts);
    const have = career.progress[kind] ?? 0;
    const status = own ? (node?.cost ? 'Researched: it can take its site in your lineup.' : 'A starting unit: yours from the first battle.')
      : career.target === kind ? `Researching: ${num(have)} of ${num(node.cost)} RP. Every career battle's research points go to it until it is done.`
      : researchable(era, career, kind) ? `Open for research: ${num(node.cost)} RP${have ? `, ${num(have)} in` : ''}.` : `Not yet: research the ${unitInfo(era, node.after).name} first.`;
    const dl = el('dl', 'hg-figs');
    for (const [k, v] of figures(era, kind)) dl.append(el('dt', null, k), el('dd', null, v));
    card.append(pic, head, el('p', 'rs-help', `${slotOf(era, kind)?.cls ?? ''}: ${info.info}`), dl, el('p', `hg-state${own ? '' : ' not'}`, status));
    if (!own && node) card.append(bar(researchShareOf(era, career, kind)));
    wrap.append(side, card);
    const focus = document.activeElement?.dataset?.act;
    body.replaceChildren(wrap);
    if (focus) body.querySelector(`[data-act="${CSS.escape(focus)}"]`)?.focus();
  }

  function render() {
    renderTop();
    if (!loaded) loading.querySelector('.ml-era').textContent = `${era.name}, ${era.years} · ${era.text.sub}`;
    if (open) renderDrop();
    if (view === 'research') {
      renderResearch();
      // the hangar loads behind the loading screen whichever screen opens first
      if (!loaded) {
        const k = shownKind(), o = optionOf(era, k);
        if (o) hangar.show({ era: era.id, kind: k, parts: o.parts, name: unitInfo(era, k).name });
      }
    } else renderHangar();
  }

  const go = () => {
    if (tab === 'tutorials') {
      const d = lesson();
      if (d) location.href = gameHref({ era: era.id, tutorial: d.id }, q);
      return;
    }
    location.href = tab === 'career' && era.career ? gameHref({ era: era.id, level: career.level, mods }, q) : gameHref({ era: era.id, difficulty }, q);
  };

  // ---------------------------------------------------------------- the controls
  $('[data-act="back-research"]').addEventListener('click', () => showResearch(preview ?? rsKind()));
  for (const b of $$('[data-view]')) b.addEventListener('click', () => {
    if (b.dataset.view === view && !preview) return;
    view = b.dataset.view;
    preview = null;
    swap = null;
    save();
    render();
  });
  for (const b of $$('[data-tab]')) b.addEventListener('click', () => {
    toTab(b.dataset.tab);
    render();
  });
  for (const b of $$('[data-mode]')) b.addEventListener('click', () => {
    const t = b.dataset.mode;
    if (open && tab === t) {
      setOpen(false);
      return;
    }
    toTab(t);
    setOpen(true);
  });
  for (const b of $$('[data-d]')) b.addEventListener('click', () => {
    difficulty = b.dataset.d;
    keepDifficulty(difficulty);
    render();
  });
  $('[data-switch="dev"]').addEventListener('click', () => {
    dev = !dev;
    setDevMode(dev);
    render();
  });
  // the career's reset: the first click arms it for 4 s, the second resets
  const resetBtn = $('.mn-reset');
  let armed = 0;
  const disarm = () => {
    clearTimeout(armed);
    armed = 0;
    resetBtn.classList.remove('armed');
    resetBtn.textContent = 'Reset';
  };
  resetBtn.addEventListener('click', () => {
    if (!armed) {
      resetBtn.classList.add('armed');
      resetBtn.textContent = 'Confirm?';
      armed = setTimeout(disarm, 4000);
      return;
    }
    disarm();
    career = resetCareer(era);
    preview = null;
    rollMods();
    render();
    resetBtn.textContent = 'Done';
    setTimeout(() => {
      if (!armed) resetBtn.textContent = 'Reset';
    }, 1500);
  });
  modeBtn.addEventListener('click', () => setOpen(!open));
  $('.mn-drop-close').addEventListener('click', () => {
    setOpen(false);
    modeBtn.focus();
  });
  $('#mn-play').addEventListener('click', go);
  $('.mn-play2').addEventListener('click', go);
  // a click outside the chooser closes it, and one outside the bench and the bar the bench
  addEventListener('pointerdown', (e) => {
    if (open && !drop.contains(e.target) && !modeBtn.contains(e.target) && !e.target.closest?.('.mn-modes')) setOpen(false);
    if (swap != null && !e.target.closest?.('.hg-bench, .hg-slots')) setSwap(null);
  });
  // Escape closes the chooser or the bench; Enter goes to battle; in the hangar Left and Right walk the sites
  addEventListener('keydown', (e) => {
    if (e.target.closest?.('input, textarea')) return;
    if (e.code === 'Escape' && open) {
      setOpen(false);
      modeBtn.focus();
      return;
    }
    if (e.code === 'Escape' && swap != null) return setSwap(null);
    if (e.code === 'Escape' && preview) return showResearch(preview);
    if (e.code === 'Enter' && !e.target.closest?.('button, [tabindex]')) {
      e.preventDefault();
      go();
      return;
    }
    if (!open && view === 'hangar' && (e.code === 'ArrowLeft' || e.code === 'ArrowRight')) {
      const n = era.slots.length, s = sites();
      let i = selSlot();
      for (let k = 0; k < n; k++) {
        i = (i + (e.code === 'ArrowRight' ? 1 : n - 1)) % n;
        if (s[i] !== EMPTY) break;
      }
      e.preventDefault();
      pickSlot(i);
    }
  });
  // the slot bar's fading ends while there is more of it to scroll to
  const edges = () => {
    slotsEl.classList.toggle('more-l', slotsEl.scrollLeft > 2);
    slotsEl.classList.toggle('more-r', slotsEl.scrollLeft + slotsEl.clientWidth < slotsEl.scrollWidth - 2);
  };
  slotsEl.addEventListener('scroll', edges, { passive: true });
  addEventListener('resize', edges);

  rollMods();
  if (!era.career && mode === 'career') mode = 'battle';
  if (tab === 'career' && !era.career) tab = 'battle';
  render();
  setOpen(open);
  if (q.get('lessons')) {
    forget('lessons');
    lessonsReady.then(() => open && render());
  }
  ballistics.then(() => render());
  root.hidden = false;
  document.body.classList.add('menu');
  edges();
  save();
}
