// The eras: one game, several settings ("AA through the ages"). An era is a plain data module (Node-safe,
// tools/simtest.mjs reads it) holding everything that belongs to its setting: the map layout, the slots
// and their options, the raids, the setting's text, the consoles' alert captions, its theme and markings.
// The per-kind tables (sim/systems.js SYSTEMS, the console MOUNT table in ui/panel.js, RELOAD_SCENES,
// VEHICLE_KINDS, MARKINGS, the tutorial lessons) stay global registries keyed by kind: an era lists the
// kinds it uses. deploy.js holds the era in play (setEra). Fields (DESIGN.md, "Eras"):
//   id, name, years       'modern', 'Modern', '2020s': the menu's toggle
//   available             false: shown on the menu, disabled and marked as in development
//   theme                 the class `era-<theme>` on the page and the console panel, for its CSS
//   markings              the markings set its vehicles carry (models/markings.js), or null
//   text                  { sub, blurb, setting, orders, lull, victory, defeat }: the title screen,
//                         the radio at the start and between raids, the end screen
//   layout                { threatAxis, assets, vital, sites }: the defended assets (`label` puts one on
//                         the HUD's compass), the asset ids whose loss together ends the battle, and
//                         where each slot's unit stands (slot order)
//   slots                 [{ cls, options: [{ kind, id, name, callsign, label, info, parts }] }]: option 0
//                         is the slot's default
//   waves                 the raids (sim/director.js)
//   alerts                { key: [cabin caption, English meaning, rank] } for ui/consoles/common.js
//   tutorials             the lesson ids its Tutorials list offers
//   content               optional () => import(...): its models, consoles and reload scenes, loaded
//                         only when the era is picked (loadEra); the module registers them when it runs
// Derived here: defaultLoadout (every slot's first option), slotOptions (deploy.js SLOT_OPTIONS) and
// kinds (the unit kinds its slots offer).
import modern from './modern.js';
import ww2 from './ww2.js';

function prepare(era) {
  era.slotOptions = era.slots.map((s) => s.options);
  era.defaultLoadout = Object.freeze(era.slots.map((s) => s.options[0].kind));
  era.kinds = [...new Set(era.slots.flatMap((s) => s.options.map((o) => o.kind)))];
  return era;
}

// in the menu's order
export const ERAS = [modern, ww2].map(prepare);
export const DEFAULT_ERA = 'modern';

export const eraById = (id) => ERAS.find((e) => e.id === id) ?? null;
// the era the menu can start in: `id` when it is available, otherwise the default
export const playableEra = (id) => (eraById(id)?.available ? id : DEFAULT_ERA);

// An era's heavy browser modules (`content`), fetched once; resolves at once for an era without them.
const loading = new Map();
export function loadEra(id) {
  const era = eraById(id);
  if (!era?.content) return Promise.resolve(era);
  if (!loading.has(era.id)) {
    loading.set(era.id, era.content().then(() => era, (e) => {
      loading.delete(era.id); // a failed fetch is tried again next time
      throw e;
    }));
  }
  return loading.get(era.id);
}
