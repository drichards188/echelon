import * as THREE from 'three';
import { V, box, rbox, vehicleMats, Parts } from './kit.js';
import { runningGear, frameRails, sideGear, rearEnd, mzktCab, exhaustStack, whip, snorkel, toolRack } from './trucks.js';

// Rig plumbing shared by the vehicle builders.

export function newRig(scheme) {
  const root = new THREE.Group();
  const rig = { root, mats: vehicleMats(scheme), pivots: {}, anchors: { muzzles: [], missileSlots: [] }, boxes: [], slots: [], setLoaded: null };
  rig.P = new Parts(rig.mats);
  rig.setLoaded = (i, loaded) => { const s = rig.slots[i]; if (s) for (const o of s) o.visible = loaded; };
  return rig;
}

export function node(parent, name, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  const o = new THREE.Object3D();
  o.name = name;
  o.position.set(x, y, z);
  o.rotation.set(rx, ry, rz);
  parent.add(o);
  return o;
}

export function pivotAt(rig, parent, key, x, y, z) {
  const g = new THREE.Group();
  g.name = key;
  g.position.set(x, y, z);
  parent.add(g);
  rig.pivots[key] = g;
  return g;
}

export const hb = (rig, x0, y0, z0, x1, y1, z1) => rig.boxes.push({ min: V(x0, y0, z0), max: V(x1, y1, z1) });

// MZKT-7930 8x8 chassis with cab, shared by the TEL, the engagement radar and (3 axles) the tractor.
export function mzktTruck(P, { axles = [-3.55, -2.0, 1.75, 3.3], rear = 5.0, deck = 1.35, deckFrom = -2.55, cab = true, boxes = true, bed = true } = {}) {
  const R = 0.66;
  runningGear(P, { axles, R, W: 0.46, track: 1.2, steered: 2 });
  frameRails(P, -4.7, rear, 1.1, 1.25);
  sideGear(P, -1.15, 1.0, 0.95, 1.0, boxes);
  if (cab) {
    const c = mzktCab(P, -5.0, 1.4);
    exhaustStack(P, 1.12, c.back + 0.12, 1.4, 3.7);
    whip(P, -1.0, c.top, c.back - 0.3, 2.4);
    P.add('dark', box(2.3, 0.5, 0.3, 0, 1.12, c.back + 0.05)); // cab rear mount / air tanks
    snorkel(P, -1.12, c.back + 0.12, 1.4, 3.3);
  }
  if (!bed) return { R, deck, rear };
  // rear bed deck
  const len = rear - deckFrom;
  P.add('camo', rbox(2.6, 0.12, len, 0.03, 0, deck - 0.06, (deckFrom + rear) / 2));
  for (const s of [-1, 1]) {
    P.add('camo', box(0.05, 0.3, len, s * 1.3, deck - 0.27, (deckFrom + rear) / 2)); // side skirt
    P.add('dark', box(0.06, 0.04, len, s * 1.31, deck - 0.1, (deckFrom + rear) / 2));
  }
  rearEnd(P, rear + 0.05, 2.3, 0.82);
  toolRack(P, -1.325, deck - 0.2, rear - 1.5, -1);
  return { R, deck, rear };
}

