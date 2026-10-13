import { registerMarkingSet, MARKINGS, pair } from '../../../models/markings.js';
import { LETTER_PX, REC } from './flak88.js';

// The WW2 era's markings set 'ww2' (eras/ww2.js `markings`): only what the German guns really carried
// and nothing political (refs/ww2/markings sections 2 to 4): no national insignia, no unit emblems.
//
//   A .. F  the gun's letter (Anton, Berta, Caesar, Dora, Emil, Friedrich), a plain white capital about
//           0.1 m tall painted on the side of the recuperator near its front end (markings_karow_emil_letter_03:
//           "E" on Emil; markings_karow_caesar_letter_04: "C" on Caesar). Every heavy gun's MARKINGS entry
//           carries 'A'; rig.setLetter(L) moves that rig's own copies to L's atlas cell.
//
// The kill rings are not decals: they are white bands painted round the barrel, geometry in the gun's
// recoil group (flak88.js), so they wrap the tube; rig.setKills(n) shows the first n. The clock numbers on
// the pit walls are part of each emplacement (kit44.js clockNumbers, one draw for all twelve).
//
// Atlas cells (1024 x 512): the letters side by side from x = 8, LETTER_PX apart, 120 x 156 px each
// (aspect 1.3).

const LETTER_W = 120, LETTER_H = 156;
function drawLetter(ch) {
  return (g, x, y, w, h) => {
    g.save();
    g.fillStyle = '#ecebe2';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = `bold ${Math.round(h * 0.92)}px sans-serif`;
    g.translate(x + w / 2, y + h / 2 + h * 0.03);
    g.scale(0.82, 1); // a narrow stencil capital
    g.fillText(ch, 0, 0);
    g.restore();
  };
}

const set = {};
['A', 'B', 'C', 'D', 'E', 'F'].forEach((ch, i) => {
  set[ch] = { px: [8 + i * LETTER_PX, 8, LETTER_W, LETTER_H], aspect: LETTER_H / LETTER_W, draw: drawLetter(ch) };
});
registerMarkingSet('ww2', set);

// Places, measured on the built models. flak88 (flak88.js REC): the recuperator, radius 0.095 at y = 0.215
// in the recoil group, its front end cap at z = -1.47; the letter on both sides 0.17 m behind the cap,
// 0.075 m wide (0.1 m tall): flat decals touching the cylinder at its widest, the edges lift a few mm.
MARKINGS.flak88 = [
  ...pair({ type: 'A', pivot: 'recoil', pos: [REC.r + 0.0005, REC.y, REC.z0 + 0.17], face: 'x', size: 0.075 }),
];
