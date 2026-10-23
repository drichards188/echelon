import * as THREE from 'three';
// one file per vehicle in ./v/ (each builder owns its file and any chassis helpers it adds there)
import { buildTEL } from './v/tel.js';
import { buildRadar } from './v/radar92n6.js';
import { buildSearch } from './v/search91n6.js';
import { buildCP } from './v/cp55k6.js';
import { buildPantsir } from './v/pantsir.js';
import { buildOsa } from './v/osa.js';
import { buildStrela } from './v/strela.js';
import { buildBukRadar, buildBukCp } from './v/bukradar.js';
import { buildBukTelar, buildBukLoader } from './v/buk.js';
import { buildTunguska } from './v/tunguska.js';
import { buildTor } from './v/tor.js';
import { buildShilka } from './v/shilka.js';
import { build22T6 } from './v/t22t6.js';
import { build5T58 } from './v/t5t58.js';
import { build9T217 } from './v/t9t217.js';
import { build9T244 } from './v/t9t244.js';
import { buildPantsirTZM } from './v/tzmpantsir.js';
import { build2F77M } from './v/t2f77m.js';
import { buildKamaz5350 } from './v/kamaz5350.js';
import { applyMarkings } from './markings.js';
import { bakeRig } from './ao.js';

// Procedural vehicles of the air defense force. Model space: front -Z, right +X, ground y = 0.
// Each rig: { root, pivots, anchors, setLoaded(i, loaded), boxes } as documented in DESIGN.md.

export const VEHICLE_KINDS = ['s400-tel', 's400-radar', 's400-search', 's400-cp', 'pantsir', 'osa', 'strela', 'buk-radar', 'buk-cp', 'buk-telar', 'buk-loader', 'tunguska', 'tor', 'shilka', '22t6', '5t58', 'pantsir-tzm', '2f77m'];

const BUILDERS = { 's400-tel': buildTEL, 's400-radar': buildRadar, 's400-search': buildSearch, 's400-cp': buildCP, pantsir: buildPantsir, osa: buildOsa, strela: buildStrela, 'buk-radar': buildBukRadar, 'buk-cp': buildBukCp, 'buk-telar': buildBukTelar, 'buk-loader': buildBukLoader, tunguska: buildTunguska, tor: buildTor, shilka: buildShilka, '22t6': build22T6, '5t58': build5T58, 'pantsir-tzm': buildPantsirTZM, '2f77m': build2F77M };
VEHICLE_KINDS.push('9t217'); BUILDERS['9t217'] = build9T217; // Osa-AKM transloader (render/reload/osa.js)
VEHICLE_KINDS.push('9t244'); BUILDERS['9t244'] = build9T244; // Tor-M2 transloader (render/reload/tor.js)
VEHICLE_KINDS.push('kamaz-5350'); BUILDERS['kamaz-5350'] = buildKamaz5350; // Shilka ammunition truck (render/reload/shilka.js)

/** Registers vehicle builders, { kind: () => rig } with the rig contract (an era's lazily loaded content, eras/index.js). */
export function registerVehicles(builders) {
  for (const [kind, b] of Object.entries(builders)) {
    if (!VEHICLE_KINDS.includes(kind)) VEHICLE_KINDS.push(kind);
    BUILDERS[kind] = b;
  }
}

export function buildVehicle(kind) {
  const b = BUILDERS[kind];
  if (!b) throw new Error('unknown vehicle ' + kind);
  const rig = b();
  rig.root.name = kind;
  rig.root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  applyMarkings(rig, kind); // national markings (markings.js); after the shadow flags, they do not cast
  bakeRig(rig, kind); // baked occlusion in the vertex colours (ao.js; the kinds an era opted in)
  delete rig.P;
  delete rig.mats;
  return rig;
}
