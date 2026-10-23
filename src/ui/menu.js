import { ERAS, eraById } from '../eras/index.js';
import {
  ERA_KEY, LESSONS_KEY, DIFFICULTIES, stored, store, migrateLoadout, startEra, keptLoadout, keepLoadout, keptDifficulty, keepDifficulty, gameHref,
} from '../choices.js';
import { backdrop } from './backdrop.js';

// The main menu: DOM only, nothing of the world is built here (no renderer, no sim). It picks the era, the
// difficulty and the loadout, all kept in local storage (choices.js), and opens a game page (src/boot.js):
// Take command a battle, a lesson from the Tutorials list. Behind it, stills from the game (ui/backdrop.js)
// turn through the units of the loadout; picking an option shows that unit. Switching era never reloads.
export function mountMenu(root = document.getElementById('menu')) {
  const q = new URLSearchParams(location.search);
  const $ = (id) => document.getElementById(id);
  migrateLoadout();
  let era = eraById(startEra(q));
  let loadout = keptLoadout(era);
  let difficulty = keptDifficulty();
  const still = backdrop(root);
  const go = (game) => (location.href = gameHref({ era: era.id, difficulty, ...game }, q));
  // the address without what it no longer asks for
  const forget = () => history.replaceState(null, '', `${location.pathname}${q.toString() ? `?${q}` : ''}`);

  // the era's look: the title's text and the class `era-<theme>` for its CSS
  const applyLook = () => {
    $('title-sub').textContent = era.text.sub;
    $('title-blurb').textContent = era.text.blurb;
    for (const c of [...document.body.classList]) if (c.startsWith('era-')) document.body.classList.remove(c);
    document.body.classList.add(`era-${era.theme}`);
  };

  // The era toggle, the menu's main control: a button per era (eras/index.js ERAS), the era's years under
  // its name; an era still in development shows greyed out with its tag and cannot be picked. The line
  // under it is the setting of the era in play (another's while the pointer is on it).
  const eraDesc = $('era-desc');
  const showSetting = (e) => (eraDesc.textContent = e.text.setting ?? '');
  const eraBtns = ERAS.map((e) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.era = e.id;
    b.setAttribute('role', 'radio');
    b.innerHTML = '<b></b><span><small></small></span>';
    b.querySelector('b').textContent = e.name;
    b.querySelector('small').textContent = e.years;
    b.title = `${e.name}, ${e.years}`;
    if (!e.available) {
      b.classList.add('soon');
      b.setAttribute('aria-disabled', 'true');
      b.querySelector('span').insertAdjacentHTML('beforeend', '<em>In development</em>');
      b.title += ': in development';
    }
    b.addEventListener('click', () => setEra(e));
    b.addEventListener('pointerenter', () => showSetting(e));
    b.addEventListener('pointerleave', () => showSetting(era));
    $('era').appendChild(b);
    return b;
  });
  const showEras = () => {
    for (const b of eraBtns) {
      b.classList.toggle('on', b.dataset.era === era.id);
      b.setAttribute('aria-checked', String(b.dataset.era === era.id));
    }
    showSetting(era);
  };
  const setEra = (e) => {
    if (!e.available || e === era) return;
    era = e;
    store(ERA_KEY, e.id);
    loadout = keptLoadout(era);
    // the address no longer names an era: a reload shows the one kept
    if (q.has('era')) {
      q.delete('era');
      forget();
    }
    render();
  };

  // the difficulty of the next battle
  const diffBtns = [...document.querySelectorAll('#difficulty button')];
  const showDifficulty = () =>
    diffBtns.forEach((b) => {
      b.classList.toggle('on', b.dataset.d === difficulty);
      b.setAttribute('aria-checked', String(b.dataset.d === difficulty));
    });
  diffBtns.forEach((b) =>
    b.addEventListener('click', () => {
      if (!DIFFICULTIES.includes(b.dataset.d)) return;
      difficulty = b.dataset.d;
      keepDifficulty(difficulty);
      showDifficulty();
    })
  );

  // The loadout picker: a row per slot of the era with its options and the chosen one's trade-off
  // (another's while the pointer is on it). Built again for another era.
  const pickerEl = $('loadout');
  let pickRows = [];
  const buildPicker = () => {
    pickerEl.replaceChildren();
    pickRows = era.slots.map(({ cls: slotClass, options: opts }, slot) => {
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
        b.addEventListener('click', () => pick(slot, o.kind));
        b.addEventListener('pointerenter', () => show(o.kind));
        b.addEventListener('pointerleave', () => show(loadout[slot]));
        btns.appendChild(b);
        return b;
      });
      row.append(key, cls, btns, desc);
      pickerEl.appendChild(row);
      return { buttons, show };
    });
  };
  const showLoadout = () =>
    pickRows.forEach((r, slot) => {
      for (const b of r.buttons) b.classList.toggle('on', b.dataset.kind === loadout[slot]);
      r.show(loadout[slot]);
    });
  // an option picked: kept for the era, and its unit behind the menu
  const pick = (slot, kind) => {
    if (loadout[slot] === kind) return;
    loadout = loadout.map((k, i) => (i === slot ? kind : k));
    keepLoadout(era, loadout);
    showLoadout();
    still(loadout, kind);
  };

  // The Tutorials list, for the era in play: one lesson per unit (tutorial.js, fetched after the menu is
  // up: its lessons' scripts bring three.js with them, which the game page needs next anyway). A lesson
  // done is marked; picking one opens its game page.
  let lessons = null;
  const lessonsReady = import('../tutorial.js').then(
    (m) => (lessons = m.TUTORIALS),
    (e) => console.warn(`tutorial list failed: ${e.message}`)
  );
  const buildLessons = () => {
    const list = $('tut-list');
    let done = {};
    try {
      done = JSON.parse(stored(LESSONS_KEY)) ?? {};
    } catch {
      // nothing kept
    }
    list.replaceChildren(
      ...era.tutorials.map((id) => lessons?.find((d) => d.id === id)).filter(Boolean).map((d) => {
        const b = document.createElement('button');
        b.className = 'tut-item';
        b.type = 'button';
        b.classList.toggle('done', !!done[d.id]);
        b.innerHTML = '<span class="ti-mark">✓</span><b></b><i></i>';
        b.querySelector('b').textContent = d.name;
        b.querySelector('b').insertAdjacentHTML('beforeend', `<small>${d.steps.length} steps</small>`);
        b.querySelector('i').textContent = d.blurb;
        b.addEventListener('click', () => go({ tutorial: d.id }));
        return b;
      })
    );
  };
  const openLessons = (open) => {
    if (open) lessonsReady.then(buildLessons);
    document.body.classList.toggle('tut-menu', open);
  };
  $('tutorials').addEventListener('click', () => openLessons(true));
  $('tut-back').addEventListener('click', () => openLessons(false));
  $('play').addEventListener('click', () => go({}));
  addEventListener('keydown', (e) => {
    if (e.code === 'Escape' && document.body.classList.contains('tut-menu')) openLessons(false);
  });

  function render() {
    applyLook();
    showEras();
    buildPicker();
    showLoadout();
    $('tutorials').disabled = !era.tutorials.length;
    still(loadout);
    if (document.body.classList.contains('tut-menu')) openLessons(true);
  }

  showDifficulty();
  render();
  // the way back from a lesson (?lessons=1) opens the list; the address then forgets it
  if (q.get('lessons')) {
    openLessons(true);
    q.delete('lessons');
    forget();
  }
  root.hidden = false;
  document.body.classList.add('menu');
}
