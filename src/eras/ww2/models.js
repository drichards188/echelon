// The WW2 era's German guns, their emplacements and the heavy battery's fire control: registerVehicles,
// registerAssets, registerMarkingSet. Registers itself when eras/ww2/content.js imports it. The builders
// live in ./models/ (one file per model, the shared kit in kit44.js); their header comments document the
// rigs (pivots, anchors, paint, markings) and the photos they were matched to.
import { registerVehicles } from '../../models/vehicles.js';
import { registerAssets } from '../../models/site.js';
import { buildFlak88 } from './models/flak88.js';
import { buildKdo40 } from './models/kdo40.js';
import { buildWurzburg } from './models/wurzburg.js';
import { buildFlak43 } from './models/flak43.js';
import { buildFlakvierling, buildFlakvierlingTower } from './models/flakvierling.js';
import { buildFlak38 } from './models/flak38.js';
import { buildFlak128 } from './models/flak128.js';
import { buildFlakturm } from './models/flakturm.js';
import { ASSETS44 } from './models/assets44.js';
import './models/markings44.js';

registerVehicles({
  flak88: buildFlak88,
  kdo40: buildKdo40,
  wurzburg: buildWurzburg,
  flak43: buildFlak43,
  flakvierling: buildFlakvierling,
  'flakvierling-tower': buildFlakvierlingTower,
  flak38: buildFlak38,
  flak128: buildFlak128,
  flakturm: buildFlakturm,
});

registerAssets(ASSETS44);

// The gun crews (models/crew44.js, its figure figure44.js, poses pose44.js and jobs jobs44.js): one Crew44 layer
// on the scene, place(rig, kind) for every rig of the kinds above; the API is in crew44.js's header.
export { Crew44, NEAR as CREW_NEAR, FAR as CREW_FAR } from './models/crew44.js';
export { JOBS as CREW_JOBS } from './models/jobs44.js';
