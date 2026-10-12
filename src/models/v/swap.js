// Containers a reload scene takes off a vehicle and puts back (the Pantsir's tubes, the Tunguska's
// containers, the loads on the reload trucks). They stay merged with the rest of their vehicle's parts,
// so each costs no draw call: a builder brackets every container's adds to its Parts collector with
// mark() and span() to learn which vertices it owns in each material's merged geometry, and after
// Parts.build swapper() hides a container by collapsing those vertices onto one point (its triangles
// vanish) and shows it again by putting them back.
//
//   const m = mark(P); addTheContainer(P); spans[i] = span(P, m);
//   const meshes = P.build(parent); rig.setContainer = swapper(meshes, spans).set;  // set(i, shown)

/** Vertex counts per material key collected so far. */
export function mark(P) {
  const m = {};
  for (const [key, list] of P.lists) {
    let n = 0;
    for (const g of list) n += g.attributes.position.count;
    m[key] = n;
  }
  return m;
}

/** The vertex ranges [start, end) per key added since `before` (a mark). */
export function span(P, before) {
  const now = mark(P), out = {};
  for (const key of Object.keys(now)) if (now[key] > (before[key] ?? 0)) out[key] = [before[key] ?? 0, now[key]];
  return out;
}

/**
 * Show and hide containers by their spans in the meshes Parts.build returned (named by key).
 * Returns { set(i, shown), shown(i) }.
 */
export function swapper(meshes, spans) {
  const byKey = new Map(meshes.map((m) => [m.name, m]));
  const saved = spans.map((s) => {
    const o = {};
    if (s) for (const [k, [a, b]] of Object.entries(s)) o[k] = byKey.get(k).geometry.attributes.position.array.slice(a * 3, b * 3);
    return o;
  });
  const on = spans.map(() => true);
  const set = (i, shown) => {
    if (!spans[i] || on[i] === shown) return;
    on[i] = shown;
    for (const [k, [a, b]] of Object.entries(spans[i])) {
      const attr = byKey.get(k).geometry.attributes.position, arr = attr.array, src = saved[i][k];
      if (shown) arr.set(src, a * 3);
      else for (let v = a * 3; v < b * 3; v += 3) {
        arr[v] = src[0];
        arr[v + 1] = src[1];
        arr[v + 2] = src[2];
      }
      attr.needsUpdate = true;
    }
  };
  return { set, shown: (i) => on[i] };
}
