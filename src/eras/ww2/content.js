// The WW2 era's heavy modules: nothing yet. Its era definition imports this with a dynamic import
// (eras/ww2.js `content`), which main.js runs through eras/index.js loadEra only when the era is picked,
// so its code stays out of the modern game's download.
//
// When it runs, a content module registers its kinds in the shared registries, as the modern era's
// modules are registered statically:
//   registerVehicles({ kind: builder })          models/vehicles.js (the rig contract, DESIGN.md "Models")
//   registerAssets({ kind: builder })            models/site.js, the defended assets' models
//   registerFlyers({ threats, interceptors })    models/threats.js, flyer models by type and kind
//   registerMarkingSet(id, { type: { px, aspect, draw } })  models/markings.js, the era's `markings`
//                                                set; the decals' places go in MARKINGS[kind]
//   registerConsole(kind, { mount, label, sight })  ui/panel.js
//   RELOAD_SCENES[kind] = scene                  render/reload.js
// The game values (sim/systems.js SYSTEMS, MISSILES, THREATS) are plain data the headless sim needs,
// so they stay in the static registries.

export default {};
