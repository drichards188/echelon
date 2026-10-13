import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { PART, V, D2R, lerp, clamp, loft, sectionAt, pathTube, strut, box, sphere, wingAt, wingPair, finSurface, wingSurfaceY, bladeSet, spinner, cowl, engineFace, cowlFlaps, norm } from './kit.js';
import { createLivery, propDiscMaterial } from './livery.js';

// Assembles one aircraft into Echelon's flyer model (models/threats.js): every piece merged into one
// non-indexed geometry with per-vertex aPart, aSurf, aPivot and aVar, drawn with the type's livery
// material, and the prop discs as a second, transparent part. Each type is two draw calls (plus its
// shadow pass), however many are in the air: render/entities.js draws each part as an InstancedMesh
// and fills the per-instance aState from the model's `state(threat, array, offset)`.

export class Assembly {
  constructor() {
    this.out = [];
    this.props = [];
    this.engines = [];
    this.partTris = {};
  }

  /** Add a geometry as `part`; `flat` facets it, `pivot` [a, b, c, d] and `variant` (bit mask) as in livery.js. */
  add(g, part, { flat = false, pivot = null, variant = 0 } = {}) {
    let geo = g;
    if (geo.attributes.uv) geo.deleteAttribute('uv');
    if (!geo.attributes.aSurf) {
      const n = geo.attributes.position.count;
      const s = new Float32Array(n * 2);
      for (let i = 0; i < n; i++) s[i * 2 + 1] = -1;
      geo.setAttribute('aSurf', new THREE.Float32BufferAttribute(s, 2));
    }
    if (flat) {
      if (geo.index) geo = geo.toNonIndexed();
      geo.computeVertexNormals();
    } else if (!geo.attributes.normal || geo.index) {
      geo.computeVertexNormals();
    }
    // everything stays indexed (faceted pieces with their own vertices), so a loft's shared vertices
    // are shaded once per instance rather than once per triangle
    if (!geo.index) geo.setIndex([...Array(geo.attributes.position.count).keys()]);
    for (const k of Object.keys(geo.attributes)) if (!KEEP.has(k)) geo.deleteAttribute(k);
    const n = geo.attributes.position.count;
    geo.setAttribute('aPart', new THREE.Float32BufferAttribute(new Float32Array(n).fill(part), 1));
    const pv = new Float32Array(n * 4);
    if (pivot) for (let i = 0; i < n; i++) pv.set(pivot, i * 4);
    geo.setAttribute('aPivot', new THREE.Float32BufferAttribute(pv, 4));
    geo.setAttribute('aVar', new THREE.Float32BufferAttribute(new Float32Array(n).fill(variant), 1));
    this.out.push(geo);
    this.partTris[part] = (this.partTris[part] ?? 0) + geo.index.count / 3;
    return geo;
  }

  /** A loft (stations as kit.js `loft`) as `part`. */
  body(stations, part = PART.FUSELAGE, opts = {}) {
    const { n = 24, count = 0, xc = 0, capStart = true, capEnd = true, ...rest } = opts;
    return this.add(loft(stations, { n, count, xc, capStart, capEnd }), part, rest);
  }

  /** The canopy glazing and its frames: hoops at `frames` (z) round the glass and a rail along its top. */
  canopy(stations, { frames = [], rail = true, n = 22, count = 14, frameR = 0.02 } = {}) {
    this.add(loft(stations, { n, count }), PART.GLASS);
    const at = (z) => sectionAt(stations, z);
    for (const z of frames) {
      const [, w, hT, , yc] = at(z);
      const pts = [];
      for (let k = 0; k <= 12; k++) {
        const a = lerp(-0.12, Math.PI + 0.12, k / 12);
        pts.push(V(Math.cos(a) * (w + 0.012), yc + Math.sin(a) * (hT + 0.012), z));
      }
      this.add(pathTube(pts, frameR, 4, frameR * 0.8), PART.FUSELAGE);
    }
    if (rail && frames.length > 1) {
      const pts = [];
      const z0 = frames[0], z1 = frames[frames.length - 1];
      for (let k = 0; k <= 10; k++) {
        const z = lerp(z0, z1, k / 10);
        const [, , hT, , yc] = at(z);
        pts.push(V(0, yc + hT + 0.012, z));
      }
      this.add(pathTube(pts, frameR, 4, frameR * 0.75), PART.FUSELAGE);
    }
  }

  /** A helmeted head with shoulders and the armoured headrest behind, at (x, y, z) (the head's centre). */
  pilot(x, y, z, { headrest = true } = {}) {
    this.add(sphere(x, y, z, 0.115, 1, 1.08, 1.05), PART.DARK);
    this.add(sphere(x, y - 0.2, z + 0.05, 0.2, 1.1, 0.5, 0.75, 8, 5), PART.DARK);
    if (headrest) this.add(box(0.3, 0.34, 0.05, x, y - 0.02, z + 0.22), PART.DARK, { flat: true });
  }

  /**
   * A propeller and its spinner. e: { x, y, z (blade plane), r (radius), blades, chord, paddle, dir,
   * spinner: [zTip, zBase, radius, point] or null, hub: radius of a bare hub }.
   */
  prop(e) {
    const idx = this.props.length;
    const c = V(e.x, e.y, e.z);
    const pivot = [e.x, e.y, e.dir ?? 1, idx];
    for (const b of bladeSet(c, e.r, e.blades, e.chord, { paddle: e.paddle ?? 0, hub: e.hubR ?? 0.17, dir: e.dir ?? 1, segs: e.segs ?? 10, sides: e.sides ?? 8 })) this.add(b, PART.PROP, { flat: true, pivot });
    if (e.spinner) {
      const [zt, zb, sr, point] = e.spinner;
      this.add(spinner(e.x, e.y, zt, zb, sr, { point: point ?? 0.3 }), PART.SPINNER, { pivot });
    }
    if (e.hub) this.add(sphere(e.x, e.y, e.z + 0.04, e.hub, 1, 1, 0.9, 10, 7), PART.METAL);
    this.props.push({ center: c, radius: e.r });
  }

  /** A radial engine: cowling, cylinders behind the mouth and cowl flaps (kit.js). */
  radial(e, { rows = 2, perRow = 7, flaps = 16, gap = 0 } = {}) {
    this.add(cowl(e), PART.COWL);
    const extra = [];
    engineFace(e, extra, { rows, perRow });
    if (flaps) cowlFlaps(e, extra, { count: flaps, gap });
    for (const [g, part, flat] of extra) this.add(g, part, { flat: !!flat });
    this.engines.push(V(e.x, e.y, (e.zF + e.zB) * 0.5 + 0.4));
  }

  /** Wing pair, tail and fin(s); `fillet` blends the wing root into the fuselage stations. */
  surfaces(s) {
    for (const g of wingPair(s.wing)) this.add(g, PART.WING);
    for (const g of wingPair(s.htail)) this.add(g, PART.TAIL);
    for (const fin of [].concat(s.fin)) this.add(finSurface(fin, fin.base), PART.TAIL);
  }

  /** Wing root fillets between z0 and z1 (fractions of the root chord), bulging w, hTop, hBottom. */
  fillets(fus, wing, { x = 0.5, z0 = -0.1, z1 = 0.25, w = 0.24, hT = 0.17, hB = 0.08, xs = 0.86 } = {}) {
    const r0 = wingAt(wing, x);
    const za = r0.le + z0 * r0.c, zb = r0.le + r0.c * (1 + z1);
    for (const side of [-1, 1]) {
      const st = [];
      for (let k = 0; k <= 8; k++) {
        const t = k / 8;
        const z = lerp(za, zb, t);
        const fs = sectionAt(fus, z);
        const bulge = Math.sin(Math.PI * Math.pow(t, 0.75));
        const wy = wingSurfaceY(wing, fs[1] * 0.9, clamp((z - r0.le) / r0.c, 0, 1));
        st.push([z, 0.05 + w * bulge, 0.03 + hT * bulge, 0.05 + hB * bulge, wy, 2]);
      }
      const fs = sectionAt(fus, (za + zb) / 2);
      this.add(loft(st, { n: 12, xc: side * fs[1] * xs }), PART.FUSELAGE);
    }
  }

  /** A store (bomb, rocket, tank) geometry in load set `set` (10: drop tanks), dropped in order `index`. */
  store(g, set, index, flat = false) {
    return this.add(g, PART.STORE, { flat, pivot: [set, index, 0, 0] });
  }

  /**
   * Finish the type: merge, make the livery and the disc part, and return the flyer model.
   * opts: { type, length, livery, propW, smoke (engine points), well, exh, liveryPick(threat), stores
   * (the full count per load set), storeField (the threat's count of them left: 'bombs', 'rockets'),
   * doors (it has bomb doors) }
   */
  finish(opts) {
    const geometry = mergeGeometries(this.out);
    let radius = 0;
    const p = geometry.attributes.position;
    for (let i = 0; i < p.count; i++) radius = Math.max(radius, Math.hypot(p.getX(i), p.getY(i), p.getZ(i)));
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), radius);
    const sh = { exh: opts.exh, well: opts.well, propW: opts.propW, propR: this.props[0]?.radius };
    const { material, depthMaterial } = createLivery(opts.type, sh, opts.livery);
    const parts = [{ geometry, material, depthMaterial }];
    if (this.props.length) {
      const discs = this.props.map((pr) => new THREE.CircleGeometry(pr.radius, 40).translate(pr.center.x, pr.center.y, pr.center.z - 0.03));
      const dg = discs.length > 1 ? mergeGeometries(discs) : discs[0];
      dg.boundingSphere = new THREE.Sphere(new THREE.Vector3(), radius);
      parts.push({ geometry: dg, material: propDiscMaterial(), castShadow: false });
    }
    const livs = opts.livery.liveries.length;
    const engines = opts.smoke ?? this.engines;
    const doors = new WeakMap();
    let tris = 0, verts = 0;
    for (const pt of parts) {
      tris += pt.geometry.index ? pt.geometry.index.count / 3 : pt.geometry.attributes.position.count / 3;
      verts += pt.geometry.attributes.position.count;
    }
    return {
      parts,
      length: opts.length,
      radius,
      tris: Math.round(tris),
      verts,
      partTris: this.partTris,
      cap: opts.cap ?? 48,
      smoke: engines,
      // per instance: damage, livery, stores, bomb doors and the stopped engine (livery.js aState)
      state(th, a, o) {
        const frac = clamp((th.hp ?? 1) / (th.maxHp || 1), 0, 1);
        const dmg = th.falling || th.alive === false ? 0.85 : (1 - frac) * 0.6;
        const lv = Number.isInteger(th.livery) ? th.livery % livs : opts.liveryPick ? opts.liveryPick(th) : hash(th.id) % livs;
        // stores still on: the sim's count (threat.bombs or .rockets, as the type says), its load set
        const set = th.load ?? 0;
        const full = opts.stores?.[set] ?? 0;
        const left = opts.storeField ? th[opts.storeField] : undefined;
        const count = Math.min(15, Math.max(0, Math.round(left ?? full)));
        a[o] = dmg;
        a[o + 1] = lv;
        a[o + 2] = count + 16 * set + (th.tanks ? 64 : 0);
        // bomb doors open on the run, swinging over about 2 s: threat.doors if the sim sets it, else from
        // the IP (18 km out) until the stick has gone, or in a bombing phase
        let d = 0;
        if (opts.doors) {
          const tp = th.target?.pos;
          const run = th.phase === 'ingress' && tp && Math.hypot(tp.x - th.pos.x, tp.z - th.pos.z) < 18000 && (!th.released || th.stick > 0);
          const want = typeof th.doors === 'number' ? th.doors : run || DOOR_PHASES.has(th.phase) ? 1 : 0;
          const now = performance.now() * 0.001;
          const prev = doors.get(th) ?? { v: want, t: now };
          prev.v += clamp(want - prev.v, -(now - prev.t) * 0.5, (now - prev.t) * 0.5);
          prev.t = now;
          doors.set(th, prev);
          d = Math.min(prev.v, 0.999);
        }
        // below half its hit points one engine is out, its prop feathered (the one entities.js smokes)
        const dead = frac < 0.5 && engines.length > 1 ? 1 + (th.id % engines.length) : 0;
        a[o + 3] = d + 2 * dead;
      },
    };
  }
}

const DOOR_PHASES = new Set(['run', 'bombrun', 'release', 'bombing']);
const KEEP = new Set(['position', 'normal', 'aSurf']);
const hash = (n) => {
  let x = (n | 0) * 2654435761;
  x ^= x >>> 15;
  return (x >>> 0) % 1000003;
};

export { PART, V, D2R, lerp, clamp, loft, sectionAt, pathTube, strut, box, sphere, wingAt, wingSurfaceY, norm };
