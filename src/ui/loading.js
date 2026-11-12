import { eraById } from '../eras/index.js';
import { startEra, keptLoadout, keptDifficulty, menuHref, optionById, careerLevel } from '../choices.js';
import { loadCareer, devMode, lineupOf, levelOf, parseModifiers, modifierOf, EMPTY } from '../career.js';
import { backdrop } from './backdrop.js';

// A game page's loading screen: what is being started (a battle: its era, difficulty and units; or a
// lesson), described from the page's own URL and the choices kept, shown before main.js is even fetched
// and kept up while the world builds behind it; hud.setLoading fills its bar. Behind it, the still of the
// unit the game opens on (ui/backdrop.js).
export function showLoading(q, root = document.getElementById('loading')) {
  const era = eraById(startEra(q));
  const $ = (s) => root.querySelector(s);
  const still = backdrop(root);
  const line = (text) => {
    const li = document.createElement('li');
    li.textContent = text;
    return li;
  };
  const lesson = q.get('tutorial');
  $('.ld-back').href = menuHref(q, { era: era.id, lessons: !!lesson });
  document.body.classList.add('loading', `era-${era.theme}`);
  root.hidden = false;
  if (lesson) {
    $('.ld-kicker').textContent = `Tutorial · ${era.name}, ${era.years}`;
    $('.ld-title').textContent = 'Tutorial';
    // the lesson's text comes with its script, which main.js imports too
    import('../tutorial.js').then(({ TUTORIALS }) => {
      const d = TUTORIALS.find((t) => t.id === lesson);
      if (!d) return;
      $('.ld-title').textContent = d.name;
      $('.ld-diff').textContent = `${d.steps.length} steps`;
      $('.ld-blurb').textContent = `${d.blurb} A quiet range: nothing is scored and nothing is destroyed.`;
      still([optionById(era, d.unit)?.kind]);
    }, () => {});
    return;
  }
  const unit = Number(q.get('unit') ?? 0);
  // a career battle: its threat level, the career's lineup and the modifiers rolled for it
  const n = era.career ? careerLevel(q) : null;
  if (n) {
    const career = loadCareer(era);
    const lv = levelOf(era, n);
    const lineup = lineupOf(era, career, devMode());
    $('.ld-kicker').textContent = `Career · ${era.name}, ${era.years}`;
    $('.ld-diff').textContent = `Threat level ${lv.n}`;
    $('.ld-title').textContent = lv.name;
    $('.ld-blurb').textContent = `${lv.sub} ${era.text.setting ?? ''}`;
    $('.ld-lines').replaceChildren(
      ...era.slots.flatMap((s, i) => {
        const o = s.options.find((x) => x.kind === lineup[i]);
        return lineup[i] === EMPTY || !o ? [] : [line(`${i + 1}  ${s.cls}: ${o.name}`)];
      }),
      ...parseModifiers(era, q.get('mods')).map((id) => line(`Modifier: ${modifierOf(era, id).name}. ${modifierOf(era, id).line}`))
    );
    const fielded = lineup.filter((k) => k !== EMPTY);
    still([fielded[unit] ?? fielded[0]]);
    return;
  }
  const loadout = keptLoadout(era, q.get('loadout'));
  $('.ld-kicker').textContent = `Battle · ${era.name}, ${era.years}`;
  $('.ld-diff').textContent = keptDifficulty(q);
  $('.ld-title').textContent = era.text.sub;
  $('.ld-blurb').textContent = era.text.setting ?? '';
  $('.ld-lines').replaceChildren(
    ...era.slots.map((s, i) => {
      const o = s.options.find((x) => x.kind === loadout[i]) ?? s.options[0];
      return line(`${i + 1}  ${s.cls}: ${o.name}`);
    })
  );
  still([loadout[unit] ?? loadout[0]]);
}

// the battle or the lesson runs: the screen fades and the page is the game's
export function hideLoading(root = document.getElementById('loading')) {
  document.body.classList.add('loaded');
  setTimeout(() => {
    root.hidden = true;
    document.body.classList.remove('loading', 'loaded');
  }, 700);
}
