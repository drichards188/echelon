import { isGame } from './choices.js';
import { mountMenu } from './ui/menu.js';
import { showLoading } from './ui/loading.js';

// The page's entry: a URL with `play` or `tutorial` is a game (its loading screen at once, then main.js
// builds the world behind it and starts the battle or the lesson); anything else is the main menu, which
// builds nothing of the world.
const q = new URLSearchParams(location.search);
if (isGame(q)) {
  showLoading(q);
  import('./main.js').catch((e) => {
    console.error(e);
    document.getElementById('status').textContent = `Failed to load: ${e.message}`;
  });
} else mountMenu();
