import * as THREE from 'three';
import { mulberry32 } from '../noise.js';
import { ERA } from '../deploy.js';

// National markings painted onto the vehicles, as thin decal planes (no photo pixels: everything is
// drawn onto one canvas atlas per markings set at load). Sources and measurements: refs/markings/README.md.
// A set is what the decal types look like in an era (eras/<era>.js `markings`, MARKING_SETS below); the
// modern era's is 'ua', the national markings of Ukraine:
//
//   emblem  The emblem of the Armed Forces of Ukraine (Presidential Decree 551/2006): an equal-armed
//           cross with divergent arms in crimson with a gold edge, a round blue medallion (2/5 of the
//           cross height) with a gold edge and the gold trident. Parade vehicles (Buk-M1, Kyiv 2018) carry
//           it on the hull side beside the tactical number; the geometry below is the SVG's path data.
//   flag    A small blue over yellow rectangle (3:2), the field marking on the front of many vehicles.
//
// MARKINGS[kind] lists decals. Every entry:
//   type   a type of the set: 'emblem' | 'flag' in 'ua'
//   pivot  null (the rig root) or the name of a pivot in rig.pivots, so a decal on a turret turns with it
//   pos    [x, y, z] centre in the parent's space, ON the surface (a 3 mm lift is added)
//   face   'x' | '-x' | 'z' | '-z' | 'y' | '-y' or a normal [nx, ny, nz] the decal looks along
//   size   width in metres (height follows the type's aspect) or [w, h]
//   roll   optional degrees about the normal (positive = counterclockwise seen from outside)
//   up     optional direction of the decal's top edge (default world up; +Z, away from a viewer at the front, on near horizontal surfaces)
// `pair()` mirrors an entry across the x = 0 plane (a hull side) and returns both. The vehicle model files
// are not edited: positions were measured on the built models (see the README), so when a model changes
// move its decals here.

const GOLD = '#ffdf00', GOLD_EDGE = '#806600', CRIMSON = '#d50663', BLUE = '#001788';
// the SVG's paths (500 x 500 viewBox)
const P_CROSS_OUT = 'm162 499h175l-53-214 215 53v-175l-215 53 53-215h-175l53 214-214-53v175l214-53z';
const P_CROSS_IN = 'm325 489h-150l54-218-218 54v-150l218 54-54-218h150l-54 218 218-54v150l-218-54z';
const P_TRIDENT = 'm250 170c-11 15-3 20-4 56 0 17-6 31-13 45-14-1-15-17-1-17-3-36-6-59-30-72v116h27c2 17 16 26 21 32m-40-131c11 15 11 30 13 49-4 2-7 6-8 10h-5zm40 80c-2-3-5-5-9-6 4-6 7-13 9-20m-40 13h4c4 8 8 11 16 12-2 4-2 8-2 12h-18zm28 14c5 1 9 5 9 10h-10c0-3 1-7 1-10zm-1 18h9v17c-4-5-8-10-9-17';

function drawEmblem(g, ox, oy, s) {
  g.save();
  g.translate(ox, oy);
  g.scale(s, s);
  g.lineJoin = 'round';
  g.lineCap = 'round';
  g.lineWidth = 2;
  g.strokeStyle = GOLD_EDGE;
  g.fillStyle = GOLD;
  const out = new Path2D(P_CROSS_OUT);
  g.fill(out); g.stroke(out);
  g.fillStyle = CRIMSON;
  g.fill(new Path2D(P_CROSS_IN));
  g.fillStyle = GOLD;
  g.beginPath(); g.arc(250, 250, 98, 0, Math.PI * 2); g.fill(); g.stroke();
  g.fillStyle = BLUE;
  g.beginPath(); g.arc(250, 250, 88, 0, Math.PI * 2); g.fill();
  g.strokeStyle = GOLD;
  g.stroke(new Path2D('m250 330-0-51m0-109-0 83'));
  g.strokeStyle = GOLD_EDGE;
  g.fillStyle = GOLD;
  const tri = new Path2D(P_TRIDENT);
  g.fill(tri); g.stroke(tri);
  g.translate(500, 0); g.scale(-1, 1);
  g.fill(tri); g.stroke(tri);
  g.restore();
}

function drawFlag(g, x, y, w, h) {
  g.fillStyle = '#0057b7';
  g.fillRect(x, y, w, h / 2);
  g.fillStyle = '#ffd700';
  g.fillRect(x, y + h / 2, w, h / 2);
}

// Paint that has been outdoors: dust, a grey-brown haze toward the lower edge, scuffs and chips.
function weather(g, W, H, seed) {
  const rnd = mulberry32(seed);
  const img = g.getImageData(0, 0, W, H), d = img.data;
  // value noise on a coarse grid
  const gw = 32, gh = 16, gs = gw + 2, grid = Float32Array.from({ length: gs * (gh + 2) }, rnd);
  const vn = (x, y) => {
    const fx = (((x / W) * gw) % gw + gw) % gw, fy = (((y / H) * gh) % gh + gh) % gh, ix = Math.floor(fx), iy = Math.floor(fy);
    const tx = fx - ix, ty = fy - iy, sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
    const a = grid[iy * gs + ix], b = grid[iy * gs + ix + 1], c = grid[(iy + 1) * gs + ix], e = grid[(iy + 1) * gs + ix + 1];
    return (a + (b - a) * sx) * (1 - sy) + (c + (e - c) * sx) * sy;
  };
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      if (d[i + 3] === 0) continue;
      const n = vn(x, y), n2 = vn(x * 3.1 + 11, y * 3.1 + 7);
      const cellY = y / H;
      const dust = Math.min(0.55, 0.12 + 0.3 * n + 0.2 * cellY * n2);
      const k = 0.88 + 0.12 * n2;
      d[i] = (d[i] * (1 - dust) + 118 * dust) * k;
      d[i + 1] = (d[i + 1] * (1 - dust) + 108 * dust) * k;
      d[i + 2] = (d[i + 2] * (1 - dust) + 86 * dust) * k;
      // chipped and scuffed paint, mostly in clumps
      if (n2 > 0.78 && n > 0.5) d[i + 3] = Math.round(d[i + 3] * (0.45 + 0.4 * rnd()));
    }
  }
  g.putImageData(img, 0, 0);
  // fine scratches
  g.globalCompositeOperation = 'destination-out';
  g.strokeStyle = 'rgba(0,0,0,0.5)';
  g.lineWidth = 1.2;
  for (let i = 0; i < 40; i++) {
    const x = rnd() * W, y = rnd() * H, a = rnd() * Math.PI, l = 6 + rnd() * 26;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke();
  }
  g.globalCompositeOperation = 'source-over';
}

// The markings sets: every decal type a set paints, with its atlas cell in the 1024 x 512 canvas as a
// pixel rectangle [x, y, w, h] (canvas y down), its aspect (height / width) and how it is drawn there.
// An era's lazily loaded content adds its own set with registerMarkingSet.
export const MARKING_SETS = {
  ua: {
    emblem: { px: [6, 6, 500, 500], aspect: 1, draw: (g, x, y, w) => drawEmblem(g, x, y, w / 500) },
    flag: { px: [518, 51, 500, 334], aspect: 2 / 3, draw: drawFlag },
  },
};
export function registerMarkingSet(id, set) {
  MARKING_SETS[id] = set;
}

const shared = new Map();
function sharedAssets(id) {
  if (shared.has(id)) return shared.get(id);
  const set = MARKING_SETS[id];
  const cv = document.createElement('canvas');
  cv.width = 1024; cv.height = 512;
  const g = cv.getContext('2d');
  for (const t of Object.values(set)) t.draw(g, ...t.px);
  weather(g, 1024, 512, 4471);
  const map = new THREE.CanvasTexture(cv);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 8;
  map.generateMipmaps = true;
  map.minFilter = THREE.LinearMipmapLinearFilter;
  const mat = new THREE.MeshStandardMaterial({
    map, roughness: 0.93, metalness: 0, transparent: true, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4,
  });
  mat.name = 'markings';
  const geo = {};
  for (const [type, { px: [x, y, w, h] }] of Object.entries(set)) {
    const g2 = new THREE.PlaneGeometry(1, 1);
    const uv = g2.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, (x + uv.getX(i) * w) / 1024, 1 - (y + (1 - uv.getY(i)) * h) / 512);
    geo[type] = g2;
  }
  shared.set(id, { mat, geo, map, set });
  return shared.get(id);
}

const NORMALS = { x: [1, 0, 0], '-x': [-1, 0, 0], z: [0, 0, 1], '-z': [0, 0, -1], y: [0, 1, 0], '-y': [0, -1, 0] };

/** Mirror a hull-side entry across x = 0 (both sides of the vehicle). */
export function pair(e) {
  const m = { ...e, pos: [-e.pos[0], e.pos[1], e.pos[2]] };
  const f = e.face || 'x';
  if (typeof f === 'string') m.face = f.startsWith('-') ? f.slice(1) : (f === 'x' ? '-x' : f);
  else m.face = [-f[0], f[1], f[2]];
  if (e.roll) m.roll = -e.roll;
  return [e, m];
}

// Where the markings go. Positions are in the vehicle's model space (front -Z, right +X, ground y = 0)
// or the named pivot's space; measured on the current models (refs/markings/README.md).
export const MARKINGS = {
  // MAZ-543M cab: side plate at |x| = 1.52 (z -12.2 to -10.0), front plate at z = -12.38
  's400-tel': [
    ...pair({ type: 'emblem', pos: [1.523, 1.62, -10.9], face: 'x', size: 0.5 }),
    { type: 'flag', pos: [-1.05, 1.5, -12.383], face: '-z', size: 0.5 },
  ],
  // 92N6 cabin side plate at |x| = 1.45 (z 1.3 to 6.25, y 1.95 to 3.7), rear doors at z = 6.30, cab front panel z = -6.15
  's400-radar': [
    ...pair({ type: 'emblem', pos: [1.453, 2.8, 5.72], face: 'x', size: 0.55 }),
    { type: 'emblem', pos: [0.75, 3.3, 6.303], face: 'z', size: 0.5 },
    { type: 'flag', pos: [0.85, 1.95, -6.152], face: '-z', size: 0.42 },
  ],
  // Search radar: MAZ-543 cab side at |x| = 1.55 (door z -8.15 to -7.4), trailer cabin side at |x| = 1.43 (z 1.8 to 7.8).
  // No clean panel at the front (lamps, grille) or the rear face, so none there.
  's400-search': [
    ...pair({ type: 'emblem', pos: [1.433, 2.4, 4.8], face: 'x', size: 0.5 }),
    ...pair({ type: 'emblem', pos: [1.553, 1.5, -7.78], face: 'x', size: 0.4 }),
  ],
  // 55K6 cab side below the windows at |x| = 1.25 (y 1.55 to 2.2); rear door at z = 4.78; front panel under the windscreen z = -4.62
  's400-cp': [
    ...pair({ type: 'emblem', pos: [1.253, 1.88, -2.3], face: 'x', size: 0.45 }),
    { type: 'emblem', pos: [0.4, 2.85, 4.782], face: 'z', size: 0.5 },
    { type: 'flag', pos: [-0.5, 2.0, -4.625], face: '-z', size: 0.3 },
  ],
  // KamAZ cab door at |x| = 1.10 (the model's red star sits at z -3.36, y 1.95 to 2.18: the emblem is painted over it),
  // cab front panel at z = -4.17. The body side has handles and the rear is a cage of ladders: no clean panel.
  pantsir: [
    ...pair({ type: 'emblem', pos: [1.109, 2.09, -3.36], face: 'x', size: 0.3 }),
    { type: 'flag', pos: [0, 2.1, -4.167], face: [0, 0.1, -1], size: 0.45 },
  ],
  // BAZ-5937 hull: flat side plate at |x| = 1.375 above the wheel arches, rear plate at z = 4.36
  osa: [
    ...pair({ type: 'emblem', pos: [1.382, 1.3, -1.1], face: 'x', size: 0.42 }),
    { type: 'emblem', pos: [-0.65, 1.65, 4.36], face: 'z', size: 0.42 },
    { type: 'flag', pos: [0, 1.434, -4.07], face: [0, 0.985, 0.17], size: 0.6 },
  ],
  // 9T217 (t9t217.js): the Osa's BAZ hull, so the same side plate, stern plate and bow lid
  '9t217': [
    ...pair({ type: 'emblem', pos: [1.382, 1.3, -1.1], face: 'x', size: 0.42 }),
    { type: 'emblem', pos: [-0.65, 1.65, 4.36], face: 'z', size: 0.42 },
    { type: 'flag', pos: [0, 1.434, -4.07], face: [0, 0.985, 0.17], size: 0.6 },
  ],
  // MT-LB hull: side plate at |x| = 1.425 (flat up to y 1.52), rear door at z = 3.165, front deck slopes 9 degrees
  strela: [
    ...pair({ type: 'emblem', pos: [1.428, 1.3, 1.55], face: 'x', size: 0.42 }),
    { type: 'emblem', pivot: 'doorRR', pos: [-0.45, 1.1, 0.013], face: 'z', size: 0.45 }, // right rear door, a pivot (hinge 0.95, 3.155)
    { type: 'flag', pos: [0, 1.548, -2.75], face: [0, 0.988, -0.153], size: 0.6 },
  ],
  // GM-569 hull (TELAR): flat side plate at |x| = 1.343 for y 1.3 to 1.9 (4 cm grooves at z -1.5 and -0.3, the emblem sits between);
  // upper body (turret) side at |x| = 1.333 for y 2.2 to 2.5 (grooves at z -0.2 and 2.0); rear plate z = 4.01 at |x| 0.5 to 1.2;
  // lower nose plate z = -3.91 (y 1.15 to 1.35). Turret space = model space minus the ring (0, 2.083, -0.748).
  'buk-telar': [
    ...pair({ type: 'emblem', pos: [1.343, 1.6, -0.9], face: 'x', size: 0.45 }),
    ...pair({ type: 'emblem', pivot: 'turret', pos: [1.333, 0.337, 1.648], face: 'x', size: 0.38 }),
    { type: 'emblem', pos: [1.05, 1.7, 4.01], face: 'z', size: 0.3 }, // a latch at x 0.8 to 0.9, y 1.6 sits to its left
    { type: 'flag', pos: [0.5, 1.25, -3.908], face: '-z', size: 0.3 },
  ],
  // GM-577 loader hull, 0.3 m longer than the TELAR's: side plate |x| = 1.343 (y 1.3 to 1.9), rear plate z = 4.32 at |x| 0.5 to 1.2,
  // nose plate z = -4.23 (y 1.2 to 1.3). The turret is a missile rack with the crane: no clean side panel, so none on it.
  'buk-loader': [
    ...pair({ type: 'emblem', pos: [1.343, 1.6, -0.9], face: 'x', size: 0.45 }),
    { type: 'emblem', pos: [1.05, 1.7, 4.323], face: 'z', size: 0.3 },
    { type: 'flag', pos: [0.5, 1.25, -4.233], face: '-z', size: 0.3 },
  ],
  // 9S18M1 radar hull: side plate |x| = 1.56 with raised 2 cm door panels (|x| = 1.58, y 1.47 to 1.95) each with a handle 3 cm
  // proud at y 1.7: right door z -2.1 to -1.1 (handle -1.65), left door z -1.95 to -1.0 (handle -1.45), so the emblems sit beside the handles.
  // Rear: raised 2 cm panel z = 4.81 (|x| < 0.5, y 1.35 to 1.95). Nose plate (below the beak) z = -4.75 at y 1.3, rising 0.6 m per m back.
  'buk-radar': [
    { type: 'emblem', pos: [1.583, 1.71, -1.9], face: 'x', size: 0.34 },
    { type: 'emblem', pos: [-1.583, 1.71, -1.72], face: '-x', size: 0.34 },
    { type: 'emblem', pos: [0, 1.76, 4.813], face: 'z', size: 0.34 }, // a handle (4 cm proud) at y 1.51 to 1.54, so above it
    { type: 'flag', pos: [0, 1.28, -4.76], face: [0, 0.51, -0.86], size: 0.34 },
  ],
  // 9S510 command post: side wall |x| = 1.35 with raised 2 cm door panels |x| = 1.37 (front door z -2.8 to -2.1, y 1.5 to 2.0);
  // rear door panel z = 4.02 (|x| < 0.5, y 1.55 to 2.05); glacis rises 0.5 m per m back from z = -3.97 at y 1.6.
  'buk-cp': [
    ...pair({ type: 'emblem', pos: [1.373, 1.75, -2.45], face: 'x', size: 0.4 }),
    { type: 'emblem', pos: [0, 1.89, 4.023], face: 'z', size: 0.3 }, // a handle (4 cm proud) at y 1.66 to 1.70, so above it
    { type: 'flag', pos: [0, 1.85, -3.845], face: [0, 0.447, -0.894], size: 0.42 },
  ],
  // 9A331 hull: flat side plate |x| = 1.65 (y 1.25 to 1.95, door seams at z -2.2 and -1.3); turret lower body side |x| = 1.55 (y 2.25 to 2.8,
  // z -0.7 to 2.8; turret space z = world z - 0.35, y = world y - 2.18); rear plate z = 4.49 (lugs 5 cm proud at some spots, clear at x 0.9 to 1.3);
  // the front chamfer strip below the windscreen z = -4.315 at y 1.39 (it climbs 0.1 m over 0.34 m back, so the flag lies almost flat).
  tor: [
    ...pair({ type: 'emblem', pos: [1.653, 1.6, -1.7], face: 'x', size: 0.5 }),
    ...pair({ type: 'emblem', pivot: 'turret', pos: [1.553, 0.32, 1.35], face: 'x', size: 0.5 }),
    { type: 'emblem', pos: [1.1, 1.65, 4.493], face: 'z', size: 0.36 },
    { type: 'flag', pos: [0, 1.39, -4.315], face: [0, 0.96, -0.28], size: 0.4 },
  ],
  // 9T244 (t9t244.js): the Ural's doors are pivots (outer face 0.025 from the hinge, below the pressed crease at
  // y 1.85, door middle 0.48 behind the hinge); the bumper's face z = -4.5 (y 0.62 to 1.15) left of the centred plate.
  '9t244': [
    { type: 'emblem', pivot: 'doorL', pos: [-0.026, 1.6, 0.48], face: '-x', size: 0.36 },
    { type: 'emblem', pivot: 'doorR', pos: [0.026, 1.6, 0.48], face: 'x', size: 0.36 },
    { type: 'flag', pos: [-0.75, 0.89, -4.5], face: '-z', size: 0.3 },
  ],
  // 2S6M hull: side plate |x| = 1.45 for y 1.4 to 1.95 between the 10 cm raised pads (z -1.2 to -0.15 is clear, two studs at z -0.75 and -0.45);
  // the fixed armour plate on the turret side |x| = 1.40 (y 2.4 to 2.8, z -0.8 to 0.6; turret space z = world z + 0.85, y = world y - 1.98);
  // rear plate z = 3.95 (clear at x 0.1 to 0.7); lower nose plate z = -3.89 at y 1.25 (leans out 0.55 m per m up).
  tunguska: [
    { type: 'emblem', pos: [1.453, 1.65, -1.0], face: 'x', size: 0.38 },
    { type: 'emblem', pos: [-1.453, 1.54, -0.8], face: '-x', size: 0.28 }, // the left side carries a 4 cm rail at y 1.70 to 1.75 (z -1.3 to -0.3): below it
    ...pair({ type: 'emblem', pivot: 'turret', pos: [1.403, 0.62, 0.75], face: 'x', size: 0.36 }),
    { type: 'emblem', pos: [0.4, 1.45, 3.953], face: 'z', size: 0.36 },
    { type: 'flag', pos: [0, 1.25, -3.89], face: [0, -0.48, -0.87], size: 0.32 },
  ],
  // GM-575 hull: upper side plate leans 6 degrees (|x| = 1.38 at y 1.3, y 1.12 to 1.5); turret flank (flat 0.2 m band y 1.96 to 2.16, |x| = 1.20; turret
  // space y = world y - 1.55, z = world z + 0.1); rear plate z = 3.13 (y 1.05 to 1.55); the lower glacis (y 1.0 to 1.25, clear of the driver's hatch box and the gun well cover above it) z = -2.99 at y 1.12 rising 1.45 m per m back.
  shilka: [
    ...pair({ type: 'emblem', pos: [1.383, 1.31, 0.0], face: [1, 0.1, 0], size: 0.34 }),
    ...pair({ type: 'emblem', pivot: 'turret', pos: [1.203, 0.515, -0.4], face: 'x', size: 0.2 }),
    { type: 'emblem', pos: [0, 1.35, 3.123], face: [0, 0.1, 1], size: 0.34 },
    { type: 'flag', pos: [0, 1.12, -2.99], face: [0, 0.82, -0.57], size: 0.42 },
  ],
  // 22T6 (t22t6.js): the cab doors are pivots (outer face 0.026 from the hinge line, below the window y 1.6 to 2.4, door
  // middle z 0.48 behind the hinge); the second locker on each body side (outer face |x| = 1.29, y 1.23 to 2.01, z 0.79 to
  // 2.01; latch at z 1.86); the right lower locker of the rear face (z = 5.275, x 0.25 to 1.07, y 1.06 to 1.56); the bumper
  // face z = -5.09 left of the centred plate.
  '22t6': [
    { type: 'emblem', pivot: 'doorL', pos: [-0.026, 1.95, 0.48], face: '-x', size: 0.4 },
    { type: 'emblem', pivot: 'doorR', pos: [0.026, 1.95, 0.48], face: 'x', size: 0.4 },
    ...pair({ type: 'emblem', pos: [1.293, 1.55, 1.38], face: 'x', size: 0.42 }),
    { type: 'emblem', pos: [0.66, 1.31, 5.276], face: 'z', size: 0.36 },
    { type: 'flag', pos: [-0.75, 1.25, -5.092], face: '-z', size: 0.3 },
  ],
  // 5T58-2 (t5t58.js): the BAZ cab doors are pivots (outer face 0.026, below the window y 1.3 to 2.2); the trailer's side
  // girders (pivot 'trailer', outer face |x| = 1.09, y 0.94 to 1.26 clear of the strip below); the tractor's bumper face
  // z = -5.395 between the plate and the left head lamp.
  '5t58': [
    { type: 'emblem', pivot: 'doorL', pos: [-0.026, 1.85, 0.48], face: '-x', size: 0.4 },
    { type: 'emblem', pivot: 'doorR', pos: [0.026, 1.85, 0.48], face: 'x', size: 0.4 },
    ...pair({ type: 'emblem', pivot: 'trailer', pos: [1.093, 1.1, 6.2], face: 'x', size: 0.3 }),
    { type: 'flag', pos: [-0.55, 1.36, -5.396], face: '-z', size: 0.28 },
  ],
  // KamAZ-5350 (kamaz5350.js, the Shilka's ammunition truck): cab doors |x| = 1.106 above the fenders (y 1.9) and below the
  // windows (2.4); the tailgate is a pivot (outer face at its z 0.0, ribs 0.4 apart); bumper face z = -4.07 left of the plate.
  'kamaz-5350': [
    ...pair({ type: 'emblem', pos: [1.106, 2.1, -3.0], face: 'x', size: 0.3 }),
    { type: 'emblem', pivot: 'tailgate', pos: [-0.6, 0.27, 0.035], face: 'z', size: 0.28 },
    { type: 'flag', pos: [-0.5, 1.12, -4.075], face: '-z', size: 0.26 },
  ],
  // Pantsir TZM (tzmpantsir.js): the cab doors are pivots (outer face 0.0125 from the hinge line; below the window y 1.35 to
  // 2.25, the handle at z 0.98); the bumper face z = -4.92 between the plate (|x| < 0.26) and the left towing slot (x < -0.55).
  'pantsir-tzm': [
    { type: 'emblem', pivot: 'doorL', pos: [-0.013, 1.85, 0.52], face: '-x', size: 0.4 },
    { type: 'emblem', pivot: 'doorR', pos: [0.013, 1.85, 0.52], face: 'x', size: 0.4 },
    { type: 'flag', pos: [-0.405, 1.09, -4.921], face: '-z', size: 0.24 },
  ],
  // 2F77M (t2f77m.js): the cab doors are pivots (outer face 0.0125, below the window y 1.24 to 2.07, the handle at z 0.64);
  // the cab's front panel z = -3.515 right of the placards (x 0.37 to 0.73, y 1.6 to 1.85).
  '2f77m': [
    { type: 'emblem', pivot: 'doorL', pos: [-0.013, 1.62, 0.33], face: '-x', size: 0.36 },
    { type: 'emblem', pivot: 'doorR', pos: [0.013, 1.62, 0.33], face: 'x', size: 0.36 },
    { type: 'flag', pos: [0.55, 1.72, -3.516], face: '-z', size: 0.34 },
  ],
};

/**
 * Parent every decal of `kind` to the rig root or its pivot, painted in a markings set (by default the
 * era in play's; none without one). Returns the decal meshes.
 */
export function applyMarkings(rig, kind, setId = ERA.markings) {
  const list = MARKINGS[kind];
  if (!list || !list.length || !MARKING_SETS[setId]) return [];
  const { mat, geo, set } = sharedAssets(setId);
  const out = [];
  for (const e of list) {
    const parent = e.pivot ? rig.pivots[e.pivot] : rig.root;
    if (!parent || !set[e.type]) continue;
    const mesh = new THREE.Mesh(geo[e.type], mat);
    const f = e.face || 'x';
    const n = new THREE.Vector3(...(typeof f === 'string' ? NORMALS[f] : f)).normalize();
    const [w, h] = Array.isArray(e.size) ? e.size : [e.size, e.size * set[e.type].aspect];
    mesh.scale.set(w, h, 1);
    mesh.position.set(...e.pos).addScaledVector(n, 0.003);
    // the plane's front faces +Z: build the basis with z = n
    // (a decal on a near horizontal surface reads from the front: its top points toward +Z)
    const up = e.up ? new THREE.Vector3(...e.up) : Math.abs(n.y) > 0.9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0);
    const m4 = new THREE.Matrix4().lookAt(n, new THREE.Vector3(), up); // columns: x right, y up, z = n
    mesh.quaternion.setFromRotationMatrix(m4);
    if (e.roll) mesh.rotateZ((e.roll * Math.PI) / 180);
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    mesh.renderOrder = 1;
    mesh.name = 'marking-' + e.type;
    parent.add(mesh);
    out.push(mesh);
  }
  return out;
}
