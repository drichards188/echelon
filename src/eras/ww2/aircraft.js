import { registerFlyers } from '../../models/threats.js';
import { p51 } from './aircraft/p51.js';
import { b17 } from './aircraft/b17.js';
import { p47 } from './aircraft/p47.js';
import { typhoon } from './aircraft/typhoon.js';
import { tempest } from './aircraft/tempest.js';
import { a26 } from './aircraft/a26.js';
import { recon } from './aircraft/recon.js';
import { gpbomb, rp3 } from './aircraft/ordnance.js';

// The WW2 era's Allied aircraft and their ordnance, registered as flyer models (models/threats.js
// registerFlyers) when eras/ww2/content.js imports this module. The builders are in ./aircraft/: one
// file per type on a shared kit (kit.js geometry, build.js assembly, livery.js the paint shader), all
// adapted from MaxGFX's aircraft generator. Each type is one instanced livery mesh plus its prop discs
// (two draw calls and one shadow call however many fly); the bomb is one, the rocket two.
//
// What the models read from a threat (render/entities.js passes it to the model's `state`): hp and
// maxHp (soot; below half one engine of a twin or four-engined type stops, the one that smokes),
// falling, id (the livery, unless `livery` picks one by index; the A-26's glazed nose by `slotI`),
// bombs (P-47) and rockets (Typhoon) still carried, `load` (the P-47's HVARs or the Typhoon's bombs
// instead), `tanks` (drop tanks on), `doors` (0..1; without it the B-17 and A-26 open them from 18 km
// out on the run until the stick has gone), and for the falling bomb `lb` (100, 250, 500 or 1000;
// default 500). The rocket's motor burns while age < 1.2 s (THREATS.rp3.burn).

registerFlyers({
  threats: { p51, p47, typhoon, tempest, a26, b17, recon, gpbomb, rp3 },
});
