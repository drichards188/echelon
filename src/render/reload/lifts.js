import { CREW_GAITS } from '../../models/v/crew.js';
import { ease } from '../reload.js';

// Pieces shared by the crane scenes of the Osa (osa.js) and the Tor (tor.js): crane keyframes laid on
// a time line and read back as a pose, angle unwrapping, and a crew route (walking, climbing, rising
// through a hatch) walked out at one time and back at another, a pure function of the scene time.

export const wrapPi = (a) => {
  a = (a + Math.PI) % (Math.PI * 2);
  return (a < 0 ? a + Math.PI * 2 : a) - Math.PI;
};

/** The angle equal to a (mod 2 pi) nearest to b. */
export const unwrap = (a, b) => a + Math.round((b - a) / (Math.PI * 2)) * Math.PI * 2;

/** Lay keys [{ dt, pose }] end to end between t0 and t1 (stretched or squeezed to fit): sets key.t. */
export function layKeys(keys, t0, t1) {
  const total = keys.reduce((s, k) => s + k.dt, 0) || 1;
  const k = (t1 - t0) / total;
  let t = t0;
  for (const key of keys) {
    t += key.dt * k;
    key.t = t;
  }
  keys.scale = k;
}

/** The joints at time t between the keys around it (eased), into out (every numeric field of the poses). */
export function keyPose(keys, t, out = {}) {
  let i = 0;
  while (i < keys.length - 1 && keys[i + 1].t <= t) i++;
  const a = keys[i], b = keys[Math.min(i + 1, keys.length - 1)];
  const k = b === a || t <= a.t ? 0 : ease(Math.min(1, (t - a.t) / (b.t - a.t)));
  for (const n in a.pose) out[n] = a.pose[n] + (b.pose[n] - a.pose[n]) * k;
  return out;
}

const WALK = 1.25, CLIMB = 0.5; // m/s along the ground, up or down a vehicle's side

/**
 * A crew member's way from a start to his place: legs [{ to: { x, y, z } (world), mode: 'walk' |
 * 'climb' | 'rise', face }] (the first leg's `to` is the start; 'climb' faces `face`, the wall in front
 * of him; 'rise' moves him straight up or down, standing, as through a hatch). He sets out at t0 and comes
 * back the same way from tBack; pose(crew, t) poses him on the way and returns null, or returns his
 * place (he stands there; the caller poses him), or hides him before t0 and once he is back. speed: m/s
 * walking and climbing (defaults 1.25 and 0.5).
 */
export class CrewRoute {
  constructor(legs, t0, tBack, { walk = WALK, climb = CLIMB } = {}) {
    this.pts = legs.map((l) => l.to);
    this.legs = legs.slice(1).map((l, i) => {
      const a = this.pts[i], b = l.to;
      const h = Math.hypot(b.x - a.x, b.z - a.z), v = Math.abs(b.y - a.y);
      const d = l.mode === 'walk' ? Math.max(0.3, h / walk) : l.mode === 'climb' ? Math.max(0.5, v / climb + h / 1.5) : Math.max(0.4, v / 0.9);
      return { a, b, mode: l.mode, face: l.face, d };
    });
    this.total = this.legs.reduce((s, l) => s + l.d, 0);
    this.t0 = t0;
    this.tBack = Math.max(t0 + this.total, tBack);
    this.backEnd = this.tBack + this.total;
    this.end = this.pts[this.pts.length - 1];
  }

  pose(c, t) {
    if (t < this.t0 || t >= this.backEnd) {
      c.hide();
      return null;
    }
    const back = t >= this.tBack;
    let tt = back ? this.total - (t - this.tBack) : t - this.t0;
    if (!back && tt >= this.total) return this.end;
    for (const l of this.legs) {
      if (tt > l.d) {
        tt -= l.d;
        continue;
      }
      const k = Math.max(0, tt / l.d);
      if (l.mode === 'walk') {
        // walking back he faces the way he goes
        if (back) c.walk(l.b, l.a, 1 - k, 'walk', l.b.y, l.a.y);
        else c.walk(l.a, l.b, k, 'walk', l.a.y, l.b.y);
      } else {
        const x = l.a.x + (l.b.x - l.a.x) * k, z = l.a.z + (l.b.z - l.a.z) * k, y = l.a.y + (l.b.y - l.a.y) * k;
        if (l.mode === 'climb') c.at(x, z, l.face, 'climb', (y - l.a.y) / CREW_GAITS.climb.rise, y);
        else c.at(x, z, l.face ?? c.root.rotation.y, 'stand', 0, y);
      }
      return null;
    }
    return this.end;
  }
}
