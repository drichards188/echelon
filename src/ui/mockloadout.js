// Side-effect module for the console harness (imported first by mock.js, before panel.js reads UNITS):
// /ui.html?unit=ID puts the option that owns that unit id into its slot (T1, T2, SHK, GEP, BUK, TOR ...).
import { SLOT_OPTIONS, DEFAULT_LOADOUT, setLoadout } from '../deploy.js';

const want = new URLSearchParams(location.search).get('unit');
if (want) {
  const loadout = [...DEFAULT_LOADOUT];
  SLOT_OPTIONS.forEach((opts, slot) => { const o = opts.find((x) => x.id === want); if (o) loadout[slot] = o.kind; });
  setLoadout(loadout);
}
