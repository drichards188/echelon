// The WW2 era's consoles (registerConsole) and the era's console theme. Registers itself when
// eras/ww2/content.js imports it. The consoles are in ./consoles/ (their headers say what each shows, the
// sim fields it reads and the commands it sends):
//   battery.js   `flak88`: the heavy battery's command post: the Kommandogeraet 40's telescope and data,
//                the fire control (predicted or barrage, range source, salvos), the gun reports A to F,
//                the Wuerzburg D's range display, the air picture
//   platoon.js   `flak43`, `flakvierling`, `flak38`: the platoon leader's console: a layer's sight, the
//                mode and fire distribution, the trigger, the three guns and their feeds, the air picture
//   kit.js       the instruments (dials, drum counters, lamps, rotary switches), the header, the target
//                list, the trigger's reach rule, the sights' projection
//   sights.js    the sight overlays (the predictor's telescope, the Schwebedornvisier 43, the Flakvisier)
//   turm.js      `flakturm`: the flak tower's console, the battery's and the platoons' pages under a gun
//                selector (the group of guns the player commands)
//   plot.js      the plotting board; wurzburg.js the Wuerzburg's display; ww2.css the `.era-ww2` theme
//
// The sight pictures: the panel gives these kinds a sight canvas (`sight: true`) and main's
// SightRenderer draws the scene into it. Their sim units have no `sight` of their own, so each kind
// registers a sight pose (sight.js registerSightPose): the predictor's telescope along the KdO 40's line
// to its target, or a gun's sight along its bore, from that part's rig (`part`; its anchors.sight). Main
// feeds a unit without `u.sight` through sightPose(u) (see sight.js).
import { registerConsole } from '../../ui/panel.js';
import { registerSightPose } from '../../sight.js';
import { SYSTEMS } from '../../sim/systems.js';
import { mountBattery } from './consoles/battery.js';
import { mountPlatoon, PLATOON, sightGun } from './consoles/platoon.js';
import { mountTurm } from './consoles/turm.js';
import { VIEW, compassOf } from './consoles/kit.js';
import './consoles/ww2.css';

registerConsole('flak88', { mount: mountBattery, label: '8,8 CM FLAK 37', sight: true });
registerConsole('flakturm', { mount: mountTurm, label: 'FLAKTURM', sight: true });
for (const kind of Object.keys(PLATOON)) {
  registerConsole(kind, { mount: (ctx) => mountPlatoon(ctx, kind), label: PLATOON[kind].de, sight: true });
}

// the heavy battery: the predictor's telescope (the KdO 40's turret follows its target)
registerSightPose('flak88', (u) => {
  const v = VIEW.get(u.id);
  const i = v?.part ?? u.parts.findIndex((p) => p.role === 'predictor');
  const p = u.parts[i];
  if (!p?.turret || !p.alive) return null;
  return { az: compassOf(u, p.turret), el: p.turret.el, fov: v?.fov ?? 0.08, part: i };
});
// a platoon: the layer's sight on the gun the console shows, along its bore
for (const kind of Object.keys(PLATOON)) {
  registerSightPose(kind, (u) => {
    const v = VIEW.get(u.id);
    const i = v?.part ?? sightGun(u, -1);
    const p = u.parts[i];
    if (!p?.turret || !SYSTEMS[u.kind].guns[p.kind]) return null;
    return { az: compassOf(u, p.turret), el: p.turret.el, fov: v?.fov ?? PLATOON[kind].fov, part: i };
  });
}
// the flak tower: the predictor's telescope or a gun's sight, whichever the page shown picked (VIEW)
registerSightPose('flakturm', (u) => {
  const v = VIEW.get(u.id);
  const i = v?.part ?? u.parts.findIndex((p) => p.role === 'predictor');
  const p = u.parts[i];
  if (!p?.turret || !p.alive) return null;
  return { az: compassOf(u, p.turret), el: p.turret.el, fov: v?.fov ?? 0.08, part: i };
});
