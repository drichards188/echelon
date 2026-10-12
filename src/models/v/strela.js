import * as THREE from 'three';
import { V, box, rbox, yTube, zTube, xTube, rod, sideProfile, lathe, xf, Parts } from '../kit.js';
import { node, newRig, pivotAt, hb } from '../rig.js';
import { MTLB, addHull, addRunningGear, rearDoor, REAR_DOOR } from './mtlb.js';

// 9A35M3 Strela-10M3 combat vehicle on the MT-LB chassis. The turret sits a little behind mid-hull:
// a turntable, the operator's cabin with its raked windscreen facing forward, a sloped housing behind,
// and a short post that carries the launcher's trunnion. The launcher is two wings of two square 9M37
// containers each, with the round radar rangefinder dish on a beam in the gap between them, a little
// behind the container mouths (raised high, strela_09, it stands at the top of a column between the
// wings). Proportions from the reference side profile (refs/shorad/strela_02) scaled to the 6.45 m
// hull, widths from the rear view (strela_04); the launcher is 2.26 m long and about 3.3 m to its top
// when stowed level.

const TZ = 0.91; // turret axis, metres aft of the hull centre
const TY = MTLB.roof + 0.04; // turntable face
const EY = 1.185; // trunnion above the turntable, at the containers' axis (2.99 m above the ground)
const C = 0.33; // container section (about a foot, as the SA-13 card gives)
const GAP = 0.36; // half the gap between the wings, which the dish sits in and the cabin swings through
const CW = 0.33; // half width of the operator's cabin
const ZF = -1.13, ZB = 1.13; // container front and rear ends about the trunnion (it is at mid-length)
const XS = [-(GAP + C * 1.5), -(GAP + C / 2), GAP + C / 2, GAP + C * 1.5]; // container centres, left outer to right outer
// for the reload scene (render/reload/strela.js): the turret axis, the trunnion and the containers
export const STRELA = { TZ, TY, EY, C, ZF, ZB, XS };

// the Strela's own fittings on the MT-LB roof: turret ring, the equipment housing ahead of the turret,
// the engine air grille on the left
function hullFittings(P) {
  const R = MTLB.roof;
  P.add('dark', yTube(R - 0.01, TY, 0.7, 0.7, 32, 0, TZ));
  P.add('camo', yTube(R - 0.01, R + 0.02, 0.76, 0.76, 32, 0, TZ));
  // (everything above the turntable stays outside the cabin's 0.87 m sweep about the turret axis)
  P.add('camo', sideProfile([[-1.15, R], [-0.02, R], [-0.02, R + 0.2], [-0.9, R + 0.26], [-1.15, R + 0.12]], 1.2).applyMatrix4(xf(-0.05, 0, 0)));
  P.add('dark', box(0.46, 0.08, 0.02, -0.05, R + 0.19, -1.035, 1.06)); // slot in the sloped front
  P.add('camo', sideProfile([[-0.95, R], [0.28, R], [0.28, R + 0.3], [-0.8, R + 0.3], [-0.95, R + 0.16]], 0.36).applyMatrix4(xf(0.9, 0, 0)));
  P.add('dark', zTube(-0.85, 0.33, 0.035, 0.035, 8, 0.9, R + 0.35)); // stowed rod on the right housing
  for (const z of [-0.6, 0.15]) P.add('dark', box(0.1, 0.06, 0.05, 0.9, R + 0.32, z));
  P.add('dark', box(0.62, 0.02, 1.0, -0.95, R + 0.005, -0.75));
  for (let i = 0; i < 9; i++) P.add('steel', box(0.6, 0.025, 0.035, -0.95, R + 0.02, -1.2 + i * 0.112));
  P.add('camo', box(0.66, 0.03, 0.04, -0.95, R + 0.015, -1.27));
  P.add('camo', box(0.66, 0.03, 0.04, -0.95, R + 0.015, -0.23));
}

// one 9M37 container: square box with transverse frames, end flanges, a dark mouth at each end and the
// rear X-brace with its ring; the front lid is separate (it goes when the round is fired). Exported for
// the reload scene's stand-ins (x = 0: the container's own frame, centre at the origin, mouth to -Z).
export function container(E, x = 0) {
  const L = ZB - ZF - 0.12, zc = (ZF + ZB) / 2;
  E.add('camo', box(C, C, L, x, 0, zc));
  for (let i = 0; i < 10; i++) E.add('camo', box(C + 0.026, C + 0.026, 0.03, x, 0, ZF + 0.17 + i * 0.218), { tint: 0xc4c4c4 });
  for (const [z0, z1] of [[ZF, ZF + 0.06], [ZB - 0.06, ZB]]) {
    const z = (z0 + z1) / 2, d = z1 - z0;
    for (const s of [-1, 1]) {
      E.add('camo', box(C + 0.03, 0.03, d, x, s * (C / 2), z));
      E.add('camo', box(0.03, C + 0.03, d, x + s * (C / 2), 0, z));
    }
  }
  E.add('dark', box(C - 0.02, C - 0.02, 0.01, x, 0, ZF + 0.062));
  E.add('dark', box(C - 0.02, C - 0.02, 0.01, x, 0, ZB - 0.062));
  for (const a of [Math.PI / 4, -Math.PI / 4]) E.add('camo', box(0.032, (C - 0.02) * 1.41, 0.03, x, 0, ZB - 0.02, 0, 0, a));
  E.add('camo', zTube(ZB - 0.05, ZB + 0.025, 0.085, 0.085, 16, x, 0));
  E.add('dark', zTube(ZB + 0.025, ZB + 0.03, 0.062, 0.062, 14, x, 0));
  for (const z of [-0.85, 0.35]) E.add('camo', box(0.08, 0.04, 0.06, x, C / 2 + 0.03, z), { tint: 0x9a9a9a }); // latches
}

// lattice rack under a wing (inner edge x0, outer edge x1): rails, zigzag sides, cross members
const RACK = 0.17;
function rack(E, x0, x1) {
  const yt = -C / 2, yb = yt - RACK, z0 = ZF + 0.05, z1 = ZB - 0.42, n = 8, dz = (z1 - z0) / n;
  // the outer side is a plain channel; the inner side and the bottom are open lattice
  E.add('camo', box(0.035, RACK, z1 - z0 + 0.03, x1, (yt + yb) / 2, (z0 + z1) / 2));
  E.add('camo', box(0.035, 0.035, z1 - z0 + 0.03, x0, yb + 0.0175, (z0 + z1) / 2));
  for (let i = 0; i < n; i++) {
    const za = z0 + i * dz, zb = za + dz;
    E.add('camo', rod(V(x0, yt, za), V(x0, yb + 0.02, (za + zb) / 2), 0.012, 4));
    E.add('camo', rod(V(x0, yb + 0.02, (za + zb) / 2), V(x0, yt, zb), 0.012, 4));
  }
  for (let i = 0; i <= n; i++) E.add('camo', box(Math.abs(x1 - x0), 0.025, 0.03, (x0 + x1) / 2, yb + 0.012, z0 + i * dz), { tint: 0xb8b8b8 });
}

// front lid: square cover with an X brace and a round boss
export function lid(Q, x = 0) {
  Q.add('camo', box(C - 0.02, C - 0.02, 0.02, x, 0, ZF - 0.005));
  for (const a of [Math.PI / 4, -Math.PI / 4]) Q.add('camo', box(0.034, (C - 0.04) * 1.41, 0.03, x, 0, ZF - 0.025, 0, 0, a), { tint: 0xd0d0d0 });
  Q.add('camo', zTube(ZF - 0.02, ZF - 0.06, 0.075, 0.07, 16, x, 0));
  Q.add('camo', zTube(ZF - 0.06, ZF - 0.085, 0.06, 0.03, 16, x, 0));
}

export function buildStrela() {
  const rig = newRig('green'), { P, root, mats } = rig;
  addHull(P, { doors: false });
  addRunningGear(P);
  hullFittings(P);
  P.build(root, { dirt: 0.55 });

  // ---- turret: turntable, operator's cabin, launcher post
  const tur = pivotAt(rig, root, 'turret', 0, TY, TZ);
  const T = new Parts(mats);
  T.add('camo', yTube(0, 0.07, 0.66, 0.66, 32));
  T.add('dark', yTube(0.07, 0.085, 0.62, 0.6, 32));
  // body in turret space (z, y): the operator's windscreen raked about 43 degrees runs from the front
  // edge right up to the post; behind the post a sloped rear housing comes down to the turntable
  const ws = [[-0.76, 0.1], [-0.22, 0.6]];
  T.add('camo', sideProfile([[-0.8, 0.06], [0.6, 0.06], [0.6, 0.12], [0.2, 0.76], [-0.18, 0.76], [-0.18, 0.63], ws[1], ws[0], [-0.8, 0.1]], CW * 2, 0.015));
  const wa = Math.atan2(ws[1][1] - ws[0][1], ws[1][0] - ws[0][0]); // slope of the windscreen
  const wl = Math.hypot(ws[1][1] - ws[0][1], ws[1][0] - ws[0][0]);
  const wm = [(ws[0][0] + ws[1][0]) / 2, (ws[0][1] + ws[1][1]) / 2];
  const nz = -Math.sin(wa), ny = Math.cos(wa); // its outward normal (forward and up)
  const onWs = (u, off) => [wm[0] + Math.cos(wa) * u + nz * off, wm[1] + Math.sin(wa) * u + ny * off]; // u along the slope
  {
    const [z, y] = onWs(0, 0.012);
    T.add('glass', box(CW * 2 - 0.12, 0.012, wl - 0.1, 0, y, z, -wa));
    for (const u of [-1, 1]) { const [zz, yy] = onWs(u * (wl / 2 - 0.035), 0.03); T.add('dark', box(CW * 2 - 0.02, 0.04, 0.05, 0, yy, zz, -wa)); }
    for (const s of [-1, 1]) { const [zz, yy] = onWs(0, 0.03); T.add('dark', box(0.05, 0.04, wl, s * (CW - 0.035), yy, zz, -wa)); }
    const [zd, yd] = onWs(0, 0.022);
    T.add('dark', box(0.02, 0.02, wl - 0.08, 0.05, yd, zd, -wa));
    const [zw, yw] = onWs(-0.12, 0.035);
    T.add('dark', box(0.015, 0.012, 0.36, -0.1, yw, zw, -wa, 0, 0.5)); // wiper
    // side cheeks framing the screen, and a hood over its top edge
    for (const s of [-1, 1]) T.add('camo', sideProfile([[-0.8, 0.06], [-0.2, 0.64], [-0.14, 0.64], [-0.68, 0.06]], 0.04).applyMatrix4(xf(s * (CW + 0.01), 0, 0)));
    T.add('camo', box(CW * 2 + 0.06, 0.04, 0.12, 0, 0.66, -0.2));
  }
  // hatch on the rear housing, grab handles
  const ra = Math.atan2(0.64, 0.4);
  T.add('camo', box(0.44, 0.5, 0.025, 0, 0.42, 0.405, -(Math.PI / 2 - ra)), { tint: 0xc8c8c8 });
  T.add('dark', box(0.2, 0.025, 0.03, 0, 0.42, 0.43, -(Math.PI / 2 - ra)));
  for (const s of [-1, 1]) T.add('dark', rod(V(s * (CW + 0.015), 0.2, 0.42), V(s * (CW + 0.015), 0.45, 0.27), 0.012, 5));
  // post up to the trunnion with a louvred panel on its face, trunnion head
  T.add('camo', box(0.48, 0.5, 0.36, 0, 0.98, 0.0));
  T.add('camo', rbox(0.38, 0.26, 0.02, 0.02, 0, 0.98, -0.185), { tint: 0xc8c8c8 });
  for (const y of [0.94, 1.0]) T.add('steel', box(0.26, 0.012, 0.012, 0, y, -0.198)); // louvres
  T.add('camo', rbox(0.56, 0.28, 0.34, 0.04, 0, EY, 0.0));
  for (const s of [-1, 1]) T.add('dark', xTube(s * 0.28, s * 0.32, 0.1, 0.1, 14, EY, 0));
  // elevation drive: sectors and an actuator behind the post
  for (const s of [-1, 1]) T.add('dark', box(0.03, 0.3, 0.2, s * 0.12, 0.92, 0.22, 0.5));
  T.add('dark', rod(V(0, 0.7, 0.3), V(0, 1.02, 0.17), 0.05, 8));
  // equipment box on the right of the windscreen with its round cover, a cable loom down the post
  T.add('camo', rbox(0.22, 0.34, 0.4, 0.03, CW + 0.11, 0.26, -0.42));
  T.add('camo', xTube(CW + 0.22, CW + 0.25, 0.11, 0.11, 16, 0.28, -0.42));
  T.add('dark', rod(V(-0.2, 0.7, 0.19), V(-0.2, 1.0, 0.19), 0.025, 6));
  T.build(tur, { dirt: 0.3, y0: TY });

  // ---- launcher: elevates on the trunnion; containers, dish, top box
  const el = pivotAt(rig, tur, 'elevation', 0, EY, 0);
  const E = new Parts(mats);
  // the four containers in their own group, so the reload scene can hide them while its stand-ins move
  const cans = new THREE.Group();
  cans.name = 'containers';
  el.add(cans);
  const K = new Parts(mats);
  for (const x of XS) container(K, x);
  K.build(cans, { dirt: 0, y0: TY + EY });
  rig.containers = cans;
  for (const s of [-1, 1]) rack(E, s * (GAP + 0.02), s * (GAP + 2 * C - 0.02));
  for (const s of [-1, 1]) {
    E.add('camo', box(0.03, C - 0.04, 0.6, s * (GAP - 0.02), 0, -0.05)); // trunnion brackets on the inner wings
    E.add('dark', xTube(s * 0.28, s * GAP, 0.05, 0.05, 12, 0, 0));
    const xo = s * (GAP + 2 * C + 0.03);
    E.add('camo', box(0.035, 0.1, 1.2, xo, 0.02, -0.45)); // channel along the outer face
    E.add('dark', box(0.02, 0.025, 2.0, xo, -0.09, -0.07));
  }
  E.add('camo', rbox(C - 0.02, 0.15, 1.02, 0.03, XS[2], C / 2 + 0.013 + 0.075, -0.35)); // box on the right wing
  E.add('dark', box(0.2, 0.05, 0.3, XS[2], C / 2 + 0.1 + 0.07, -0.25));
  for (const z of [0.25, 0.75]) E.add('camo', box(0.1, 0.08, 0.12, XS[2], C / 2 + 0.05, z), { tint: 0x9a9a9a });
  // the beam between the wings that carries the radar rangefinder dish
  const dz = -0.82;
  E.add('camo', box(0.44, C - 0.03, 0.5, 0, 0, -0.38));
  E.add('camo', box(0.38, 0.03, 0.44, 0, C / 2 - 0.005, -0.38), { tint: 0xc8c8c8 });
  E.add('dark', box(0.16, 0.1, 0.22, 0, 0, dz + 0.2));
  E.build(el, { dirt: 0, y0: TY + EY });

  // The dish: a flat, faintly domed disc (lathe about Y turned to face -Z) with a rolled rim, a tripod
  // of feed struts and a hub. It faces ahead when the launcher is stowed (strela_08) but tilts back
  // against it as the launcher rises, about half its elevation (strela_09 to _11), so it is set from
  // the elevation just before each draw.
  const dg = new THREE.Group();
  dg.name = 'dish';
  dg.position.set(0, 0, dz);
  el.add(dg);
  const D = new Parts(mats), DT = 0xb8bcb0;
  D.add('camo', lathe([[0.001, -0.02], [0.285, -0.02], [0.3, 0.0], [0.3, 0.035], [0.28, 0.045], [0.2, 0.052], [0.1, 0.057], [0.001, 0.058]], 32).rotateX(-Math.PI / 2), { tint: DT });
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + Math.PI / 2;
    D.add('dark', rod(V(Math.cos(a) * 0.28, Math.sin(a) * 0.28, -0.05), V(0, 0, -0.2), 0.008, 4));
  }
  D.add('camo', zTube(-0.18, -0.23, 0.03, 0.02, 10), { tint: DT });
  D.add('dark', zTube(0.0, 0.12, 0.06, 0.06, 10));
  const sync = () => {
    const r = -0.55 * el.rotation.x;
    if (dg.rotation.x !== r) { dg.rotation.x = r; dg.updateMatrixWorld(true); }
  };
  for (const m of D.build(dg, { y0: TY + EY })) m.onBeforeRender = m.onBeforeShadow = sync;

  // front lids, one group per slot so a fired round's lid can go; slot anchors at the mouths
  XS.forEach((x, i) => {
    const g = new THREE.Group();
    g.name = 'lid' + i;
    const Q = new Parts(mats);
    lid(Q, x);
    Q.build(g, { y0: TY + EY });
    el.add(g);
    rig.slots.push([g]);
    rig.anchors.missileSlots.push(node(el, 'slot' + i, x, 0, ZF - 0.02));
  });
  // the front lids come off whole when a round leaves (main throws a copy with fx.throwLid)
  rig.lids = rig.slots.map(([g]) => g);

  // the rear doors on their hinges, for the reload scene (the containers' stowage is behind the left
  // one): doorRL opens with rotation.y to about -1.75, doorRR to about +1.75
  for (const s of [-1, 1]) {
    const door = pivotAt(rig, root, s < 0 ? 'doorRL' : 'doorRR', s * REAR_DOOR.x, 0, REAR_DOOR.z);
    const Dd = new Parts(mats);
    rearDoor(Dd, s, true);
    Dd.build(door, { dirt: 0.55 });
  }

  rig.anchors.sight = node(tur, 'sight', 0, 0.42, -0.25); // operator's eye behind the windscreen
  rig.anchors.eye = node(root, 'eye', 0, 1.8, 0.3);
  hb(rig, -MTLB.W, 0, MTLB.front, MTLB.W, MTLB.roof, MTLB.rear + 0.08);
  hb(rig, -0.66, MTLB.roof, TZ - 0.8, 0.66, TY + EY, TZ + 0.66);
  hb(rig, XS[0] - C / 2, TY + EY - C / 2, TZ + ZF, XS[3] + C / 2, TY + EY + C / 2 + 0.16, TZ + ZB);
  return rig;
}
