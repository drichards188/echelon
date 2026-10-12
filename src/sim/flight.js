import * as THREE from 'three';

// Shared kinematics for threats and interceptors: velocity turns toward a desired direction at a
// limited rate (maxgfx air.js style), banking from the yaw rate.
export const G = 9.81;
export const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
export const wrapPi = (a) => {
  a = (a + Math.PI) % (Math.PI * 2);
  return (a < 0 ? a + Math.PI * 2 : a) - Math.PI;
};
export const TAU = Math.PI * 2;

const _w = new THREE.Vector3();
const _r = new THREE.Vector3(1, 0, 0);

/** Turn unit vector `f` toward unit vector `dir` by at most `turn * dt` radians. Returns the yaw rate. */
export function turnToward(f, dir, turn, dt) {
  const prevH = Math.atan2(f.x, -f.z);
  const dot = clamp(f.dot(dir), -1, 1);
  const ang = Math.acos(dot);
  if (ang > 1e-5) {
    const step = Math.min(ang, turn * dt);
    _w.crossVectors(f, dir);
    if (_w.lengthSq() < 1e-10) _w.copy(_r);
    f.applyAxisAngle(_w.normalize(), step).normalize();
  }
  return wrapPi(Math.atan2(f.x, -f.z) - prevH) / Math.max(dt, 1e-4);
}

/** Moves a flying body: o has { pos, vel, fwd, speed, bank }. */
export function fly(o, dir, dt, turn, speedTarget, accel = 0.7) {
  const yaw = turnToward(o.fwd, dir, turn, dt);
  const horiz = Math.sqrt(Math.max(0, 1 - o.fwd.y * o.fwd.y));
  const bankT = clamp(Math.atan((o.speed * yaw) / G), -1.3, 1.3) * horiz;
  o.bank += (bankT - o.bank) * (1 - Math.exp(-dt * 3));
  o.speed += (speedTarget - o.speed) * (1 - Math.exp(-dt * accel));
  o.vel.copy(o.fwd).multiplyScalar(o.speed);
  o.pos.addScaledVector(o.vel, dt);
}

const _d = new THREE.Vector3();

/**
 * Direction toward (x, z) holding `alt` (absolute), with a gentle climb/descent limit. `reach` is the
 * distance (m) over which a height error is taken out; by default a quarter of the way to (x, z), which
 * suits cruising aircraft, but terrain following needs a short fixed reach to clear the next ridge.
 */
export function levelToward(pos, x, z, alt, out = _d, slope = 0.35, reach = 0) {
  out.set(x - pos.x, 0, z - pos.z);
  const h = out.length() || 1;
  out.y = clamp((alt - pos.y) / Math.max(reach || h * 0.25, 150), -slope, slope) * h;
  return out.normalize();
}

/** Bearing in radians (clockwise from north) and horizontal range from a to b. */
export function bearingRange(ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  return [((Math.atan2(dx, -dz) % TAU) + TAU) % TAU, Math.sqrt(dx * dx + dz * dz)];
}

// Line of sight over the earth's curvature (the usual 4/3-earth form), metres.
export const horizon = (h1, h2) => 4120 * (Math.sqrt(Math.max(h1, 0)) + Math.sqrt(Math.max(h2, 0)));

/** World point at a bearing (degrees) and range, as a Vector3 on y = 0. */
export function fromBearingVec(bearingDeg, range, out) {
  const b = (bearingDeg * Math.PI) / 180;
  return out.set(range * Math.sin(b), 0, -range * Math.cos(b));
}
