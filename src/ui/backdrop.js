// The pictures behind the main menu (ui/menu.js) and a game page's loading screen (ui/loading.js): stills
// from the game itself, a unit of each kind firing in a raid (public/menu/<kind>.jpg, captured by
// tools/menushots.mjs). Two layers crossfade once the next picture has loaded and each drifts slowly
// under a shade that keeps the text readable (style.css); for a viewer who asks for less motion they
// neither drift nor turn.
export const STILLS = new Set(['s400', 'buk', 'pantsir', 'tunguska', 'osa', 'tor', 'strela', 'shilka', 'flak88', 'flak43', 'flakvierling', 'flakturm', 'flak38']);
const BASE = import.meta.env?.BASE_URL ?? '/';
export const stillUrl = (kind) => `${BASE}menu/${kind}.jpg`;
const ROTATE = 9000;

// Puts the backdrop into `root`. Returns show(kinds, first): the stills of `kinds` (those that have one,
// each once) in turn every ROTATE ms, from `first` at once when given, else going on from the one shown.
export function backdrop(root) {
  const el = (cls) => {
    const e = document.createElement('div');
    e.className = cls;
    return e;
  };
  const bg = el('bd');
  bg.setAttribute('aria-hidden', 'true');
  const layers = [el('bd-still'), el('bd-still')];
  bg.append(...layers, el('bd-shade'));
  root.prepend(bg);
  const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let list = [], i = 0, shown = null, want = null, front = 0, timer = 0;
  const load = (kind) => {
    if (kind === shown) return;
    want = kind;
    const img = new Image();
    img.onload = () => {
      if (want !== kind) return; // another was asked for meanwhile
      front ^= 1;
      const L = layers[front];
      L.style.backgroundImage = `url("${stillUrl(kind)}")`;
      L.style.animation = 'none'; // the drift starts again with the picture
      void L.offsetWidth;
      L.style.animation = '';
      L.classList.add('on');
      layers[front ^ 1].classList.remove('on');
      shown = kind;
      if (list.length > 1) new Image().src = stillUrl(list[(i + 1) % list.length]); // the next in turn, ahead
    };
    img.src = stillUrl(kind);
  };
  return (kinds, first = null) => {
    const next = [...new Set(kinds)].filter((k) => STILLS.has(k));
    const same = next.join() === list.join();
    if (same && (first == null || first === list[i])) return;
    list = next;
    i = Math.max(0, list.indexOf(STILLS.has(first) ? first : shown));
    clearInterval(timer);
    if (!list.length) return;
    load(list[i]);
    if (list.length > 1 && !calm) {
      timer = setInterval(() => {
        i = (i + 1) % list.length;
        load(list[i]);
      }, ROTATE);
    }
  };
}
