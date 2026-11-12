import { isGame } from './choices.js';
import { mountMenu } from './ui/menu.js';
import { showLoading } from './ui/loading.js';
import { checkGpu } from './ui/gpu.js';

// The page's entry: a URL with `play` or `tutorial` is a game (its loading screen at once, then main.js
// builds the world behind it and starts the battle or the lesson); anything else is the main menu, whose
// hangar loads three.js and the unit's models behind its own loading screen, nothing of the battlefield (without
// WebGL the unit's still stands in). Either way the browser is checked first: without WebGL (graphics acceleration
// off) a card says how to turn it on and no game starts.
const q = new URLSearchParams(location.search);
const gpu = checkGpu();
if (isGame(q)) {
  showLoading(q);
  if (gpu === 'none') document.getElementById('status').textContent = 'No WebGL: graphics acceleration is off';
  else {
    import('./main.js').catch((e) => {
      console.error(e);
      document.getElementById('status').textContent = `Failed to load: ${e.message}`;
    });
  }
} else mountMenu(undefined, { webgl: gpu !== 'none' });
