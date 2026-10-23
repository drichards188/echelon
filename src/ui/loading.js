import { eraById } from '../eras/index.js';
import { startEra, keptLoadout, keptDifficulty, menuHref, optionById } from '../choices.js';
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
  const loadout = keptLoadout(era, q.get('loadout'));
  const unit = Number(q.get('unit') ?? 0);
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
