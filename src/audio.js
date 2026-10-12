// Procedural audio for Echelon: every sound is synthesized at runtime; a few real recordings in
// public/audio (sources and licenses in public/audio/CREDITS.md) are laid over the synthesized
// banks once they decode, and the game sounds right without them. Launches, guns, blasts and
// threat engines are pre-rendered into sample banks (see the offline synthesis section) and
// played back with per-shot variation; positional one-shots get air absorption, a
// sound-travel delay and direction-only panning (distance gain is computed here). World events
// are queued per frame and only the loudest few become voices; the rest feed a low battle
// rumble. Threat engines are a small pool of looping voices with Doppler, nearest first.
//
// The engine core (routing, delay, absorption, voice stealing, bank building) comes from the
// maxgfx framework. `new AudioEngine({ context })` takes an OfflineAudioContext for tests.
const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);
const clamp = (x, a, b) => Math.min(Math.max(x, a), b);
const pick = (list) => (list && list.length ? list[Math.floor(Math.random() * list.length)] : null);
// callers often pass scratch vectors they reuse at once: keep a copy of where the sound began
const here = (p) => ({ x: p.x, y: p.y, z: p.z });

const SOUND_SPEED = 343;
const MAX_DELAY = 20; // a launch 7 km away is heard 20 s late
const MAX_VOICES = 64; // positional one-shots (buffer playback is cheap)
const DIRECT_VOICES = 24; // UI cues and ambience one-shots
const ENGINE_VOICES = 8; // looping threat engines, nearest first
const GUN_VOICES = 8; // continuous gun loops (every unit with guns)
const AUDIBLE = 0.002;

// per-frame caps and minimum spacing (s) for queued world events; close events get triple caps
const CAPS = { launch: 3, burst: 4, explosion: 3, impact: 3, crack: 2, casing: 2 };
const GAPS = { launch: 0.05, burst: 0.04, explosion: 0, impact: 0.03, crack: 0.1, casing: 0.08 };

// Real recordings in public/audio, cut into slices [start, length] (seconds, found by onset
// analysis) that replace or layer into the synthesized banks once both are ready; anything
// missing or undecodable leaves the synthesized sound in place.
const RECORDINGS = {
  blast: { file: 'explosion-182429.mp3', slices: [[0, 3]] }, // US government video (CC0)
  distant: { file: 'distant-explosions-438693.mp3', slices: [[1.35, 2.4], [6.2, 2.6], [14.1, 2.6], [29.0, 2.6], [34.35, 2.6], [48.1, 2.6], [53.6, 2.6], [72.4, 2.6], [76.15, 2.6], [87.4, 2.6]] }, // (CC0)
  cannon: { file: 'cannon-shot-187767.mp3', slices: [[0.1, 2.4], [6.36, 2.4]] }, // a gun's crack, laid under the 57E6 booster
  brass: { file: 'shell-casings-318964.mp3', slices: [[8.49, 0.4], [13.04, 0.25], [16.8, 0.2], [18.95, 0.5], [20.92, 0.25], [23.17, 0.5], [25.9, 0.3], [27.83, 0.5], [39.2, 0.5]] }, // (CC0)
};

const LEVELS_GUN = 0.9;

// Interceptors. ref: distance (m) inside which the launch is at full level; level: loudness at
// ref; near / mid: distance bands (m) for the near, mid and far renderings; close: distance
// inside which the launch is loud enough to duck the rest of the mix.
const LAUNCH = {
  '48N6': { ref: 260, level: 1.25, reverb: 0.3, near: 500, mid: 2500, close: 400 },
  '9M96': { ref: 150, level: 1.0, reverb: 0.25, near: 400, mid: 2000, close: 250 },
  '57E6': { ref: 110, level: 1.0, reverb: 0.2, near: 300, mid: 1500, close: 200 },
  '9M33': { ref: 90, level: 0.9, reverb: 0.2, near: 300, mid: 1500, close: 150 },
  '9M37': { ref: 55, level: 0.8, reverb: 0.15, near: 200, mid: 1000, close: 80 },
  '9M317': { ref: 200, level: 1.15, reverb: 0.25, near: 450, mid: 2200, close: 350 }, // Buk: hot launch off the rails
  '9M338': { ref: 130, level: 1.0, reverb: 0.25, near: 400, mid: 2000, close: 250 }, // Tor: cold vertical launch
  '9M311': { ref: 100, level: 0.95, reverb: 0.2, near: 300, mid: 1500, close: 180 }, // Tunguska: short booster burn
};

// Gun loops by shell type (the sim gives every gun a `shell`): bank group, distance at full level, level.
// '30mm-tunguska' is the 2A38M of the Tunguska (a slower, deeper rendering of the Pantsir's 30 mm).
const GUNS = {
  '30mm': { bank: 'gun', ref: 90, level: LEVELS_GUN, casing: [0.09, 0.1, 0.9, 0.25] },
  '30mm-tunguska': { bank: 'gun_30t', ref: 90, level: LEVELS_GUN, casing: [0.1, 0.1, 0.85, 0.25] },
  '23mm': { bank: 'gun_23', ref: 70, level: LEVELS_GUN * 0.85, casing: [0.05, 0.06, 1.2, 0.18] },
};

// Looping threat engines. loop: bank key; ref / level: as for launches; rate: playback rate at
// rest (the pitch of the loop); low: lowest audible distance gain before the voice is dropped.
const THREATS = {
  fighter: { loop: 'fighter', ref: 300, level: 1.0, rate: 1 },
  cruise: { loop: 'cruise', ref: 130, level: 0.8, rate: 1 },
  decoy: { loop: 'cruise', ref: 90, level: 0.55, rate: 1.22 },
  drone: { loop: 'drone', ref: 70, level: 0.8, rate: 1 },
  helo: { loop: 'helo', ref: 200, level: 1.0, rate: 1 },
  tbm: { loop: 'tbm', ref: 500, level: 1.1, rate: 1, shriek: true },
  glide: { loop: 'whoosh', ref: 60, level: 0.5, rate: 1 },
  atgm: { loop: 'whoosh', ref: 40, level: 0.4, rate: 1.3 },
};

// Loudness of the non-bank sounds (the banks are normalized, these scale them in the mix).
export const LEVELS = { gun: LEVELS_GUN, ui: 0.3, seeker: 0.12, vehicle: 0.07, wind: 0.07 };

// Phrygian on D for the lull score: low drones and sparse bell notes
const DRONES = [[26, 33, 38], [26, 33, 39], [24, 31, 36], [26, 32, 38]];
const BELLS = [62, 63, 65, 67, 69, 70, 74, 75, 77];

// ================================================================== offline synthesis

const TAU = Math.PI * 2;

function mulberry(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** RBJ biquad run in place: 'lp', 'hp' or 'bp' (0 dB peak). */
function biquad(x, sr, type, f, q = 0.707) {
  const w = (TAU * Math.min(f, sr * 0.45)) / sr;
  const cs = Math.cos(w), a = Math.sin(w) / (2 * q);
  let b0, b1, b2;
  if (type === 'lp') {
    b0 = (1 - cs) / 2;
    b1 = 1 - cs;
    b2 = b0;
  } else if (type === 'hp') {
    b0 = (1 + cs) / 2;
    b1 = -(1 + cs);
    b2 = b0;
  } else {
    b0 = a;
    b1 = 0;
    b2 = -a;
  }
  const a0 = 1 + a;
  b0 /= a0;
  b1 /= a0;
  b2 /= a0;
  const c1 = (-2 * cs) / a0, c2 = (1 - a) / a0;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = x[i];
    const y = b0 * v + b1 * x1 + b2 * x2 - c1 * y1 - c2 * y2;
    x2 = x1;
    x1 = v;
    y2 = y1;
    y1 = y;
    x[i] = y;
  }
  return x;
}

/** Low-pass whose cutoff follows f(t), updated every 32 samples. */
function sweepLp(x, sr, f) {
  let y1 = 0, y2 = 0, x1 = 0, x2 = 0, b0 = 0, b1 = 0, b2 = 0, c1 = 0, c2 = 0;
  for (let i = 0; i < x.length; i++) {
    if ((i & 31) === 0) {
      const w = (TAU * Math.min(f(i / sr), sr * 0.45)) / sr;
      const cs = Math.cos(w), a = Math.sin(w) / 1.414;
      const a0 = 1 + a;
      b0 = (1 - cs) / 2 / a0;
      b1 = (1 - cs) / a0;
      b2 = b0;
      c1 = (-2 * cs) / a0;
      c2 = (1 - a) / a0;
    }
    const v = x[i];
    const y = b0 * v + b1 * x1 + b2 * x2 - c1 * y1 - c2 * y2;
    x2 = x1;
    x1 = v;
    y2 = y1;
    y1 = y;
    x[i] = y;
  }
  return x;
}

function onePole(x, sr, f) {
  const k = 1 - Math.exp((-TAU * f) / sr);
  let y = 0;
  for (let i = 0; i < x.length; i++) {
    y += k * (x[i] - y);
    x[i] = y;
  }
  return x;
}

function peak(x) {
  let p = 0;
  for (let i = 0; i < x.length; i++) {
    const v = Math.abs(x[i]);
    if (v > p) p = v;
  }
  return p;
}

function normalize(x, to = 1) {
  const p = peak(x);
  if (p > 0) {
    const k = to / p;
    for (let i = 0; i < x.length; i++) x[i] *= k;
  }
  return x;
}

/** White noise shaped by an attack/decay envelope, `dur` seconds long. */
function burst(sr, r, dur, attack, decay) {
  const n = Math.ceil(dur * sr);
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    x[i] = (r() * 2 - 1) * (1 - Math.exp(-t / attack)) * Math.exp(-t / decay);
  }
  return x;
}

/** A filtered noise layer at unit peak. */
function layer(sr, r, { dur, attack = 0.001, decay, type = 'lp', f, q = 0.707, sweep = null }) {
  const x = burst(sr, r, dur, attack, decay);
  if (sweep) sweepLp(x, sr, sweep);
  else biquad(x, sr, type, f, q);
  if (type === 'bp' || type === 'lp') biquad(x, sr, 'hp', 18);
  return normalize(x);
}

function mixInto(dst, src, at, gain, sr) {
  const i0 = Math.round(at * sr);
  const n = Math.min(src.length, dst.length - i0);
  for (let i = 0; i < n; i++) dst[i0 + i] += src[i] * gain;
}

/** Friedlander blast wave: instant (or `rise`) overpressure, positive phase T, then the suction phase. */
function blast(x, sr, at, amp, T, b = 1.6, rise = 0.00006) {
  const i0 = Math.round(at * sr), n = Math.ceil(T * 7 * sr), nr = Math.max(1, Math.round(rise * sr));
  for (let i = 0; i < n && i0 + i < x.length; i++) {
    const t = i / sr;
    let p = (1 - t / T) * Math.exp((-b * t) / T);
    if (i < nr) p *= i / nr;
    x[i0 + i] += amp * p;
  }
}

/** Supersonic N-wave of a passing round. */
function nWave(x, sr, at, amp, T) {
  const i0 = Math.round(at * sr), n = Math.max(2, Math.round(T * sr));
  for (let i = 0; i <= n && i0 + i < x.length; i++) x[i0 + i] += amp * (1 - (2 * i) / n);
}

/** Damped sine whose pitch falls from f0 toward f1 with time constant tau. */
function thump(x, sr, at, f0, f1, tau, amp, decay, attack = 0.0015) {
  const i0 = Math.round(at * sr);
  const n = Math.min(Math.ceil(decay * 7 * sr), x.length - i0);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    ph += (TAU * (f1 + (f0 - f1) * Math.exp(-t / tau))) / sr;
    x[i0 + i] += amp * (1 - Math.exp(-t / attack)) * Math.exp(-t / decay) * Math.sin(ph);
  }
}

/** Struck metal: damped inharmonic modes [freq, amp, decay]. */
function modes(x, sr, at, list, r, gain = 1) {
  const i0 = Math.round(at * sr);
  for (const [f, a, d] of list) {
    const n = Math.min(Math.ceil(d * 6 * sr), x.length - i0);
    const ph = r() * TAU, w = (TAU * f) / sr;
    for (let i = 0; i < n; i++) x[i0 + i] += gain * a * Math.exp(-i / sr / d) * Math.sin(ph + w * i);
  }
}

/** Early reflections: low-passed, delayed copies [delay, gain, cutoff]. */
function reflect(dst, src, sr, taps) {
  for (const [d, g, f] of taps) mixInto(dst, onePole(Float32Array.from(src), sr, f), d, g, sr);
}

/** Rolling echo of a distant report off the ground, tree lines and the haze. */
function roll(dst, src, sr, r, { count = 16, t0 = 0.15, t1 = 2, gain = 0.5, f = 600 }) {
  const dark = onePole(Float32Array.from(src), sr, f);
  onePole(dark, sr, f * 0.8);
  for (let k = 0; k < count; k++) {
    const u = Math.pow((k + r()) / count, 1.4);
    const d = t0 + (t1 - t0) * u;
    mixInto(dst, dark, d, gain * Math.exp(-2.6 * u) * (0.45 + 0.55 * r()), sr);
  }
}

function saturate(x, drive) {
  const k = 1 / Math.tanh(drive);
  for (let i = 0; i < x.length; i++) x[i] = Math.tanh(drive * x[i]) * k;
  return x;
}

/** Fade the last `sec` out so a buffer never ends on a click. */
function tail(x, sr, sec = 0.05) {
  const n = Math.min(x.length, Math.round(sec * sr));
  for (let i = 0; i < n; i++) x[x.length - 1 - i] *= i / n;
  return x;
}

/** Distant versions: slower rise, highs gone, a ground reflection and a rolling echo. */
function distant(sr, r, dry, band, { len, roll: rl }) {
  const n = Math.ceil(len * sr);
  const x = new Float32Array(n);
  mixInto(x, dry, 0, 1, sr);
  mixInto(x, dry, 0.004 + r() * 0.008, 0.7, sr);
  roll(x, dry, sr, r, rl);
  if (band === 'far') {
    biquad(x, sr, 'lp', 700, 0.6);
    onePole(x, sr, 1100);
  } else biquad(x, sr, 'lp', 3600, 0.6);
  biquad(x, sr, 'hp', 25);
  return [tail(normalize(x, 0.95), sr, 0.2)];
}

/** Explosions: a warhead or an aircraft blowing up (air), a bomb or missile on the ground, a big one. */
function boom(sr, r, kind) {
  const big = kind === 'huge', bomb = kind === 'bomb';
  const len = big ? 4.5 : bomb ? 3.4 : 2.2;
  const x = new Float32Array(Math.ceil(len * sr));
  const T = (big ? 0.026 : bomb ? 0.016 : 0.005) * (0.9 + 0.2 * r());
  blast(x, sr, 0, 1, T, 1.3, 0.0001);
  thump(x, sr, 0, big ? 40 : bomb ? 52 : 90, big ? 15 : bomb ? 19 : 34, big ? 0.15 : 0.09, 0.95, big ? 0.7 : bomb ? 0.5 : 0.22);
  mixInto(x, layer(sr, r, { dur: len, attack: 0.003, decay: big ? 0.9 : bomb ? 0.6 : 0.3, f: big ? 260 : 400 }), 0, 0.9, sr);
  // burning fuel and the fireball rolling up
  mixInto(x, layer(sr, r, { dur: 1.6, attack: 0.04, decay: 0.45, sweep: (t) => 2200 * Math.exp(-t * 2.2) + 250 }), 0.02, bomb || big ? 0.45 : 0.6, sr);
  // metal debris raining down
  const n = big ? 22 : bomb ? 16 : 7;
  for (let i = 0; i < n; i++) {
    const t = 0.2 + Math.pow(r(), 0.7) * (big ? 3 : bomb ? 2.4 : 1.4);
    const f = 500 + r() * 2600;
    modes(x, sr, t, [[f, 0.06, 0.07 + r() * 0.1], [f * 2.31, 0.03, 0.05]], r, 0.5 + r());
    mixInto(x, layer(sr, r, { dur: 0.03, attack: 0.0002, decay: 0.006, type: 'hp', f: 1500 }), t, 0.05 + 0.05 * r(), sr);
  }
  if (bomb || big) {
    mixInto(x, layer(sr, r, { dur: len - 0.3, attack: 0.25, decay: big ? 1.6 : 1.1, f: 140 }), 0.25, 0.5, sr);
    roll(x, x.slice(0, Math.round(0.5 * sr)), sr, r, { count: 14, t0: 0.2, t1: big ? 3.4 : 2.4, gain: 0.3, f: 380 });
  }
  return x;
}


// ------------------------------------------------------------------ loop helpers

/** Crossfade the last (length - n) samples of x into its head (equal power) so n samples loop without a seam. */
function seamless(x, n) {
  const m = x.length - n;
  const o = Float32Array.from(x.subarray(0, n));
  for (let i = 0; i < m; i++) {
    const w = (i / m) * Math.PI * 0.5;
    o[i] = x[i] * Math.sin(w) + x[n + i] * Math.cos(w);
  }
  return o;
}

/** n samples of looping noise shaped by `shape` (which filters its argument in place). */
function loopNoise(sr, r, n, shape) {
  const m = Math.round(0.05 * sr), warm = Math.round(0.1 * sr);
  const x = new Float32Array(warm + n + m);
  for (let i = 0; i < x.length; i++) x[i] = r() * 2 - 1;
  shape(x);
  return normalize(seamless(x.subarray(warm), n));
}

/** A sine added to a loop of `sec` seconds, its frequency snapped to a whole number of cycles. */
function addTone(x, sr, f, amp, sec, ph = 0) {
  const w = (TAU * Math.max(1, Math.round(f * sec))) / sec / sr;
  for (let i = 0; i < x.length; i++) x[i] += amp * Math.sin(ph + w * i);
}

// ---------------------------------------------------------------- threat engine loops

/** Turbofan fighter: broadband roar, hiss, a deep rumble and the compressor whine. */
function jetLoop(sr, r) {
  const T = 4, n = Math.round(T * sr), x = new Float32Array(n);
  const roar = loopNoise(sr, r, n, (b) => biquad(b, sr, 'bp', 650, 0.45));
  const hiss = loopNoise(sr, r, n, (b) => biquad(biquad(b, sr, 'hp', 3200), sr, 'lp', 9000));
  const rumble = loopNoise(sr, r, n, (b) => biquad(b, sr, 'lp', 160));
  for (let i = 0; i < n; i++) x[i] = roar[i] * 0.8 + hiss[i] * 0.28 + rumble[i] * 0.7;
  addTone(x, sr, 2150, 0.1, T);
  addTone(x, sr, 2160, 0.08, T, 1.3);
  addTone(x, sr, 4300, 0.05, T);
  addTone(x, sr, 1075, 0.06, T);
  for (let i = 0; i < n; i++) x[i] *= 1 + 0.1 * Math.sin((TAU * 2 * i) / n);
  biquad(x, sr, 'hp', 30);
  return normalize(x, 0.9);
}

/** Cruise missile turbojet: a thin, bright whine over a dry hiss, with the combustor's buzz. */
function turbojetLoop(sr, r) {
  const T = 3, n = Math.round(T * sr), x = new Float32Array(n);
  const band = loopNoise(sr, r, n, (b) => biquad(b, sr, 'bp', 2600, 0.7));
  const rumble = loopNoise(sr, r, n, (b) => biquad(b, sr, 'lp', 240));
  for (let i = 0; i < n; i++) x[i] = band[i] * 0.22 + rumble[i] * 0.25;
  [[1180, 0.5], [2360, 0.3], [3540, 0.18], [4720, 0.1], [1194, 0.3]].forEach(([f, a], k) => addTone(x, sr, f, a, T, k));
  for (let i = 0; i < n; i++) x[i] *= 1 + 0.07 * Math.sin((TAU * 90 * i) / sr);
  biquad(x, sr, 'hp', 60);
  return normalize(x, 0.9);
}

/** One-way attack drone: a small two-stroke twin popping at about 95 Hz, the moped buzz, and a pusher prop. */
function droneLoop(sr, r) {
  const T = 2, n = Math.round(T * sr), x = new Float32Array(n);
  const pulses = Math.round(95 * T), len = Math.round(0.016 * sr);
  for (let k = 0; k < pulses; k++) {
    const i0 = Math.round(((k + (r() - 0.5) * 0.12) / (95 * T)) * n);
    const a = (k % 2 ? 1 : 0.62) * (0.8 + 0.4 * r());
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      const v = Math.sin(TAU * 880 * t) * Math.exp(-t / 0.004) * 0.8 + Math.sin(TAU * 1760 * t) * Math.exp(-t / 0.0025) * 0.35 + (r() * 2 - 1) * Math.exp(-t / 0.002) * 0.4 + Math.sin(TAU * 140 * t) * Math.exp(-t / 0.01) * 0.5;
      x[(((i0 + i) % n) + n) % n] += v * a;
    }
  }
  for (const [f, a] of [[47.5, 0.35], [95, 0.25], [142.5, 0.12]]) addTone(x, sr, f, a, T);
  biquad(x, sr, 'hp', 55);
  biquad(x, sr, 'lp', 6000);
  return normalize(x, 0.9);
}

/** Helicopter: the main rotor's blade slap at 16 Hz, the tail rotor, and the turbine whining behind. */
function heloLoop(sr, r) {
  const bpf = 16, T = 3.125, n = Math.round(T * sr), x = new Float32Array(n);
  const slap = new Float32Array(Math.round(0.04 * sr));
  thump(slap, sr, 0, 90, 45, 0.015, 1, 0.014);
  mixInto(slap, layer(sr, r, { dur: 0.03, attack: 0.0004, decay: 0.007, type: 'bp', f: 750, q: 0.9 }), 0, 0.7, sr);
  mixInto(slap, layer(sr, r, { dur: 0.01, attack: 0.0001, decay: 0.002, type: 'hp', f: 2500 }), 0, 0.3, sr);
  const count = Math.round(bpf * T);
  for (let k = 0; k < count; k++) {
    const i0 = Math.round(((k + (r() - 0.5) * 0.05) / count) * n);
    // blade-vortex interaction makes some slaps much harder than others
    const a = (0.55 + 0.45 * r()) * (k % 5 === 0 ? 1.15 : 1);
    for (let i = 0; i < slap.length; i++) x[(i0 + i) % n] += slap[i] * a;
  }
  addTone(x, sr, 62.5, 0.18, T);
  addTone(x, sr, 1620, 0.1, T);
  addTone(x, sr, 3240, 0.05, T);
  addTone(x, sr, 810, 0.05, T);
  const hiss = loopNoise(sr, r, n, (b) => biquad(b, sr, 'lp', 3000));
  for (let i = 0; i < n; i++) x[i] += hiss[i] * 0.12;
  biquad(x, sr, 'hp', 30);
  return normalize(x, 0.9);
}

/** Terminal shriek of a ballistic missile: a shimmering hot-wire scream over a roar. */
function shriekLoop(sr, r) {
  const T = 2.5, n = Math.round(T * sr), x = new Float32Array(n);
  const scream = loopNoise(sr, r, n, (b) => biquad(b, sr, 'bp', 2900, 0.9));
  const roar = loopNoise(sr, r, n, (b) => biquad(b, sr, 'lp', 500));
  for (let i = 0; i < n; i++) x[i] = scream[i] * (0.75 + 0.25 * Math.sin((TAU * 40 * i) / sr)) * (0.85 + 0.15 * Math.sin((TAU * 91 * i) / sr)) + roar[i] * 0.5;
  addTone(x, sr, 3100, 0.12, T);
  addTone(x, sr, 6200, 0.06, T);
  saturate(x, 1.5);
  biquad(x, sr, 'hp', 40);
  return normalize(x, 0.9);
}

/** Air rushing past a glide bomb or small missile. */
function whooshLoop(sr, r) {
  const T = 3, n = Math.round(T * sr), x = new Float32Array(n);
  const air = loopNoise(sr, r, n, (b) => biquad(biquad(b, sr, 'bp', 1100, 0.35), sr, 'lp', 3500));
  const low = loopNoise(sr, r, n, (b) => biquad(b, sr, 'lp', 120));
  for (let i = 0; i < n; i++) x[i] = air[i] * 0.9 + low[i] * 0.2;
  return normalize(x, 0.9);
}

/** A diesel at idle: lumpy low pulses in firing order, valve clatter, intake and exhaust, looping on whole engine cycles. */
function dieselLoop(sr, r, { cyl, rpm, rough = 0.3, f = 95, clatter = 0.25 }) {
  const T = 3, cycles = Math.max(1, Math.round((rpm / 120) * T)), n = Math.round(T * sr), x = new Float32Array(n);
  const total = cyl * cycles, len = Math.round(0.035 * sr);
  const amps = Array.from({ length: cyl }, () => 1 + rough * (r() - 0.5) * 2);
  const pulse = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    const t = i / sr;
    pulse[i] = Math.exp(-t / 0.009) * Math.sin(TAU * f * t * (1 - 8 * t)) + clatter * Math.exp(-t / 0.0008) * (r() * 2 - 1);
  }
  for (let k = 0; k < total; k++) {
    const i0 = Math.round(((k + (r() - 0.5) * 0.08) / total) * n);
    const a = amps[k % cyl] * (0.85 + 0.3 * r());
    for (let i = 0; i < len; i++) x[(i0 + i) % n] += pulse[i] * a;
  }
  const valves = loopNoise(sr, r, n, (b) => biquad(b, sr, 'bp', 2200, 0.8));
  const intake = loopNoise(sr, r, n, (b) => biquad(b, sr, 'lp', 200));
  for (let i = 0; i < n; i++) x[i] = x[i] / total * cyl * 0.6 + valves[i] * 0.05 + intake[i] * 0.2;
  biquad(x, sr, 'hp', 22);
  return normalize(x, 0.9);
}

/** A tracked vehicle at idle: a tank diesel with the loose track and sprocket ticking over it and the hull shuddering. */
function trackedLoop(sr, r, { cyl, rpm, rough, f, clatter, ticks = 12, tick = 900 }) {
  const x = dieselLoop(sr, r, { cyl, rpm, rough, f, clatter }), n = x.length, T = n / sr;
  const count = Math.round(ticks * T), len = Math.round(0.03 * sr);
  for (let k = 0; k < count; k++) {
    const i0 = Math.round(((k + (r() - 0.5) * 0.9) / count) * n);
    const a = 0.05 + 0.07 * r(), w = (TAU * tick * (0.8 + 0.5 * r())) / sr;
    for (let i = 0; i < len; i++) x[(((i0 + i) % n) + n) % n] += a * Math.exp(-i / (0.006 * sr)) * Math.sin(w * i + 1);
  }
  const shake = loopNoise(sr, r, n, (b) => biquad(b, sr, 'lp', 70));
  for (let i = 0; i < n; i++) x[i] += shake[i] * 0.2;
  return normalize(x, 0.9);
}

// ---------------------------------------------------------------- launches

/**
 * A rocket motor's roar: a gas jet whose spectrum darkens as it recedes, crackled by
 * turbulence, over a low rumble. Mixed into `x` at `at` seconds.
 */
function roar(x, sr, r, at, dur, { attack = 0.15, decay = 1.5, f0 = 5000, f1 = 900, rumble = 200, crackle = 0.4, level = 1 }) {
  const n = Math.min(Math.ceil(dur * sr), x.length - Math.round(at * sr));
  if (n <= 0) return;
  const g = new Float32Array(n), mod = new Float32Array(n), rb = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    g[i] = r() * 2 - 1;
    mod[i] = r() * 2 - 1;
    rb[i] = r() * 2 - 1;
  }
  sweepLp(g, sr, (t) => f1 + (f0 - f1) * Math.exp(-t / (decay * 0.9)));
  biquad(g, sr, 'hp', 60);
  normalize(g);
  normalize(onePole(mod, sr, 70));
  normalize(onePole(onePole(rb, sr, rumble), sr, rumble));
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const env = (1 - Math.exp(-t / attack)) * Math.exp(-t / decay) * Math.min(1, (dur - t) / 0.3);
    g[i] = (g[i] * (1 + crackle * mod[i]) + rb[i] * 0.9 * (1 - Math.exp(-t / (attack * 2)))) * env;
  }
  mixInto(x, normalize(g), at, level, sr);
}

/** 48N6: a gas-generator thump and the canister's cough, a beat of quiet, then the motor lights and tears away. */
function launch48N6(sr, r) {
  const x = new Float32Array(Math.ceil(10 * sr));
  blast(x, sr, 0, 0.55, 0.02, 1.4, 0.002);
  blast(x, sr, 0, 0.3, 0.003, 1.6, 0.0005); // the lid
  thump(x, sr, 0, 58, 26, 0.09, 0.9, 0.35);
  thump(x, sr, 0, 110, 50, 0.05, 0.5, 0.12);
  mixInto(x, layer(sr, r, { dur: 0.7, attack: 0.004, decay: 0.18, f: 140 }), 0, 0.8, sr);
  mixInto(x, layer(sr, r, { dur: 0.4, decay: 0.08, type: 'bp', f: 380, q: 0.7 }), 0.03, 0.55, sr); // the cough
  mixInto(x, layer(sr, r, { dur: 0.9, attack: 0.15, decay: 0.3, sweep: (t) => 600 + 1800 * t }), 0.05, 0.13, sr); // the round sliding out
  mixInto(x, layer(sr, r, { dur: 1, attack: 0.3, decay: 0.3, f: 110 }), 0.3, 0.07, sr); // the quiet: it climbs in silence
  const t0 = 1.2;
  blast(x, sr, t0, 0.55, 0.006, 1.5, 0.0004);
  mixInto(x, layer(sr, r, { dur: 0.15, attack: 0.001, decay: 0.03, type: 'hp', f: 1800 }), t0, 0.4, sr);
  thump(x, sr, t0 + 0.02, 45, 28, 0.2, 0.5, 0.4);
  roar(x, sr, r, t0, 8.5, { attack: 0.25, decay: 2.3, f0: 6500, f1: 650, rumble: 150, crackle: 0.6 });
  return x;
}

/** 9M96: a smaller cold launch, then a sharper, higher motor. */
function launch9M96(sr, r) {
  const x = new Float32Array(Math.ceil(6.4 * sr));
  blast(x, sr, 0, 0.5, 0.008, 1.5, 0.0008);
  thump(x, sr, 0, 90, 45, 0.06, 0.7, 0.14);
  mixInto(x, layer(sr, r, { dur: 0.3, decay: 0.06, type: 'bp', f: 700, q: 0.8 }), 0.01, 0.6, sr); // the pop
  mixInto(x, layer(sr, r, { dur: 0.5, attack: 0.08, decay: 0.15, sweep: (t) => 900 + 3000 * t }), 0.03, 0.12, sr);
  const t0 = 0.55;
  blast(x, sr, t0, 0.5, 0.004, 1.5, 0.0003);
  roar(x, sr, r, t0, 5.5, { attack: 0.08, decay: 1.2, f0: 9000, f1: 1400, rumble: 260, crackle: 0.5 });
  roar(x, sr, r, t0, 4, { attack: 0.06, decay: 0.9, f0: 5000, f1: 3000, rumble: 600, crackle: 0.3, level: 0.3 }); // the shriek
  return x;
}

/** 57E6: a violent crack, a booster roar of a second or so, then the dart goes silent. */
function launch57E6(sr, r) {
  const x = new Float32Array(Math.ceil(4.5 * sr));
  blast(x, sr, 0, 1, 0.0035 * (0.9 + 0.2 * r()), 1.5, 0.00004);
  nWave(x, sr, 0.0002, 0.5, 0.0005);
  thump(x, sr, 0, 120, 50, 0.04, 0.8, 0.1);
  mixInto(x, layer(sr, r, { dur: 0.05, attack: 0.0002, decay: 0.01, type: 'hp', f: 3000 }), 0, 0.4, sr);
  roar(x, sr, r, 0.005, 1.7, { attack: 0.01, decay: 0.45, f0: 9000, f1: 1800, rumble: 300, crackle: 0.5, level: 1.1 });
  roll(x, x.slice(0, Math.round(0.6 * sr)), sr, r, { count: 10, t0: 0.3, t1: 2.8, gain: 0.25, f: 500 });
  return x;
}

/** 9M33: ignition and a rushing roar. */
function launch9M33(sr, r) {
  const x = new Float32Array(Math.ceil(5.5 * sr));
  blast(x, sr, 0, 0.4, 0.006, 1.5, 0.0006);
  thump(x, sr, 0, 80, 40, 0.05, 0.5, 0.12);
  mixInto(x, layer(sr, r, { dur: 0.25, decay: 0.05, type: 'bp', f: 500, q: 0.7 }), 0, 0.5, sr);
  roar(x, sr, r, 0.1, 4.8, { attack: 0.1, decay: 1.6, f0: 6000, f1: 1200, rumble: 200, crackle: 0.45 });
  return x;
}

/** 9M37: the ejection pop, then a whoosh as the motor lights clear of the tube. */
function launch9M37(sr, r) {
  const x = new Float32Array(Math.ceil(3.6 * sr));
  blast(x, sr, 0, 0.6, 0.003, 1.6, 0.0004);
  thump(x, sr, 0, 150, 70, 0.03, 0.5, 0.05);
  mixInto(x, layer(sr, r, { dur: 0.1, attack: 0.0004, decay: 0.02, type: 'bp', f: 900, q: 0.8 }), 0, 0.5, sr);
  roar(x, sr, r, 0.12, 3.2, { attack: 0.1, decay: 0.8, f0: 7000, f1: 1600, rumble: 250, crackle: 0.4, level: 0.8 });
  return x;
}

/** 9M317 (Buk): a hot launch off the rails; the motor lights on the rail with a whoomph and a clank, and a long heavy roar follows at once. */
function launch9M317(sr, r) {
  const x = new Float32Array(Math.ceil(8.5 * sr));
  blast(x, sr, 0, 0.5, 0.007, 1.5, 0.0006);
  thump(x, sr, 0, 72, 34, 0.09, 0.7, 0.28);
  mixInto(x, layer(sr, r, { dur: 0.35, attack: 0.004, decay: 0.07, type: 'bp', f: 850, q: 0.7 }), 0, 0.6, sr); // the whoomph
  mixInto(x, layer(sr, r, { dur: 0.1, attack: 0.0003, decay: 0.02, type: 'hp', f: 2500 }), 0, 0.3, sr);
  modes(x, sr, 0.03, [[1650, 0.1, 0.06], [3900, 0.05, 0.035], [640, 0.1, 0.09]], r); // the shoe leaving the rail
  roar(x, sr, r, 0.04, 8, { attack: 0.12, decay: 2.7, f0: 7500, f1: 800, rumble: 170, crackle: 0.5 });
  roar(x, sr, r, 0.1, 6, { attack: 0.3, decay: 2, f0: 1800, f1: 500, rumble: 90, crackle: 0.2, level: 0.45 });
  return x;
}

/** 9M338 (Tor): a gas-generator thump and the cell's cough, 0.9 s later (the sim's `eject`) the motor lights; a short, hard roar as it pitches over. */
function launch9M338(sr, r) {
  const x = new Float32Array(Math.ceil(6 * sr));
  blast(x, sr, 0, 0.5, 0.012, 1.4, 0.0012);
  thump(x, sr, 0, 78, 36, 0.07, 0.9, 0.3);
  thump(x, sr, 0, 140, 60, 0.04, 0.45, 0.1);
  mixInto(x, layer(sr, r, { dur: 0.5, attack: 0.004, decay: 0.12, f: 160 }), 0, 0.75, sr);
  mixInto(x, layer(sr, r, { dur: 0.3, decay: 0.07, type: 'bp', f: 420, q: 0.7 }), 0.02, 0.5, sr); // the cough
  mixInto(x, layer(sr, r, { dur: 0.5, attack: 0.1, decay: 0.15, sweep: (t) => 700 + 1800 * t }), 0.04, 0.1, sr);
  const t0 = 0.9; // MISSILES['9M338'].eject: the catapult throws it 16 to 21 m up before the motor lights
  blast(x, sr, t0, 0.55, 0.005, 1.5, 0.0004);
  mixInto(x, layer(sr, r, { dur: 0.12, attack: 0.001, decay: 0.025, type: 'hp', f: 2000 }), t0, 0.4, sr);
  thump(x, sr, t0 + 0.01, 52, 30, 0.12, 0.45, 0.28);
  roar(x, sr, r, t0, 4.6, { attack: 0.06, decay: 1.25, f0: 8500, f1: 1000, rumble: 230, crackle: 0.55 });
  mixInto(x, layer(sr, r, { dur: 1.6, attack: 0.25, decay: 0.45, sweep: (t) => 3800 * Math.exp(-t * 1.4) + 900 }), t0 + 0.7, 0.12, sr); // pitching over
  return x;
}

/** 9M311 (Tunguska): a sharp rail launch, a booster that burns for little more than a second and a thin sustainer hiss behind it. */
function launch9M311(sr, r) {
  const x = new Float32Array(Math.ceil(4.2 * sr));
  blast(x, sr, 0, 0.8, 0.004, 1.5, 0.0003);
  nWave(x, sr, 0.0002, 0.3, 0.0005);
  thump(x, sr, 0, 105, 50, 0.05, 0.7, 0.12);
  mixInto(x, layer(sr, r, { dur: 0.1, attack: 0.0003, decay: 0.02, type: 'hp', f: 2800 }), 0, 0.35, sr);
  modes(x, sr, 0.02, [[1900, 0.08, 0.04], [4100, 0.04, 0.025]], r);
  roar(x, sr, r, 0.01, 1.5, { attack: 0.02, decay: 0.42, f0: 9500, f1: 2000, rumble: 280, crackle: 0.5, level: 1.1 });
  roar(x, sr, r, 1.1, 3, { attack: 0.35, decay: 1.1, f0: 4200, f1: 1500, rumble: 500, crackle: 0.2, level: 0.22 });
  return x;
}

const LAUNCH_RECIPES = { '48N6': [launch48N6, 10], '9M96': [launch9M96, 6.4], '57E6': [launch57E6, 4.5], '9M33': [launch9M33, 5.5], '9M37': [launch9M37, 3.6], '9M317': [launch9M317, 8.5], '9M338': [launch9M338, 6], '9M311': [launch9M311, 4.2] };

// ---------------------------------------------------------------- Pantsir 2A38M

/** One 30 mm round: a sharp, hard report. */
function shot30(sr, r, f = 210) {
  const x = new Float32Array(Math.ceil(0.03 * sr));
  blast(x, sr, 0, 1, 0.0013 * (0.9 + 0.2 * r()), 1.6, 0.00004);
  nWave(x, sr, 0.0002, 0.3, 0.00035);
  thump(x, sr, 0, f * (0.94 + 0.12 * r()), 85, 0.012, 0.65, 0.012);
  mixInto(x, layer(sr, r, { dur: 0.02, decay: 0.006, type: 'bp', f: 1100, q: 0.8 }), 0, 0.5, sr);
  mixInto(x, layer(sr, r, { dur: 0.008, attack: 0.0001, decay: 0.002, type: 'hp', f: 3000 }), 0, 0.35, sr);
  return x;
}

const GUN_RATE = 5000 / 60; // both barrels together
// a 30 mm pair: rounds a second, rounds in the loop, the two barrels' pitches
const GUN30 = { rate: GUN_RATE, shots: 50, f: [198, 218] };
const GUN30T = { rate: 4400 / 60, shots: 44, f: [172, 190] }; // Tunguska's 2A38M cycles slower and sounds deeper

/** Shape a gun rendering for its distance band. */
function gunBand(x, sr, band) {
  if (band === 'mid') biquad(x, sr, 'lp', 3200, 0.6);
  else if (band === 'far') {
    biquad(x, sr, 'lp', 900, 0.6);
    onePole(x, sr, 1400);
  }
  biquad(x, sr, 'hp', band === 'far' ? 40 : 30);
  return normalize(x, 0.9);
}

/** Both barrels alternating at 83 rounds a second, looping on 50 rounds: a ripping, chainsaw-like roar with link and case noise. */
function gunLoop(sr, r, band, spec = GUN30) {
  const shots = spec.shots, n = Math.round((shots / spec.rate) * sr), x = new Float32Array(n);
  const pool = [0, 1, 2, 3, 4, 5].map((k) => shot30(sr, r, k % 2 ? spec.f[0] : spec.f[1]));
  const gap = n / shots;
  for (let k = 0; k < shots; k++) {
    const i0 = Math.round(k * gap + (r() - 0.5) * 0.14 * gap);
    const a = (k % 2 ? 0.92 : 1) * (0.85 + 0.3 * r());
    const s = pool[2 * Math.floor(r() * 3) + (k % 2)];
    for (let i = 0; i < s.length; i++) x[(((i0 + i) % n) + n) % n] += s[i] * a;
    if (band === 'near') {
      // the belt link snapping off, and now and then a case ringing off the carriage
      const il = i0 + Math.round((0.002 + 0.003 * r()) * sr);
      for (let i = 0; i < 0.0015 * sr; i++) x[(il + i) % n] += (r() * 2 - 1) * 0.13 * Math.exp(-i / (0.0004 * sr));
      if (k % 6 === 2) {
        const f = 1500 + 900 * r(), ph = r() * TAU, w = (TAU * f) / sr;
        for (let i = 0; i < 0.04 * sr; i++) x[(il + i) % n] += 0.07 * Math.exp(-i / (0.012 * sr)) * Math.sin(ph + w * i);
      }
    }
  }
  const gas = loopNoise(sr, r, n, (b) => biquad(b, sr, 'bp', 520, 0.6));
  for (let i = 0; i < n; i++) x[i] += gas[i] * 0.3;
  saturate(x, 1.3);
  return gunBand(x, sr, band);
}

/** The guns spinning up (up) or winding down (not), 0.55 and 0.75 s of rounds speeding or slowing and the echo behind. */
function gunSpin(sr, r, band, up, spec = GUN30) {
  const T = up ? 0.55 : 0.75, x = new Float32Array(Math.ceil((up ? 0.55 : 1.25) * sr));
  const pool = [0, 1, 2, 3].map((k) => shot30(sr, r, k % 2 ? spec.f[0] : spec.f[1]));
  let t = 0, k = 0;
  while (t < T) {
    const p = t / T;
    const rate = up ? spec.rate * (0.1 + 0.9 * p * p * (3 - 2 * p)) : Math.max(6, spec.rate * Math.pow(1 - p, 1.4));
    const a = up ? 0.5 + 0.5 * p : 1 - 0.5 * p;
    mixInto(x, pool[2 * Math.floor(r() * 2) + (k % 2)], t, a * (0.85 + 0.3 * r()), sr);
    t += 1 / rate;
    k++;
  }
  const gas = layer(sr, r, { dur: up ? 0.55 : 0.9, attack: up ? 0.2 : 0.01, decay: up ? 0.3 : 0.2, type: 'bp', f: 520, q: 0.6 });
  mixInto(x, gas, 0, 0.3, sr);
  if (!up) roll(x, x.slice(0, Math.round(0.12 * sr)), sr, r, { count: 9, t0: 0.08, t1: 0.9, gain: 0.3, f: 700 });
  saturate(x, 1.3);
  return tail(gunBand(x, sr, band), sr, 0.05);
}

/** A 30 mm case hitting the ground and bouncing. */
function brass30(sr, r) {
  const x = new Float32Array(Math.ceil(0.6 * sr));
  let t = 0.02 + r() * 0.03, a = 0.6;
  const f0 = 1500 + r() * 600;
  for (let b = 0; b < 3; b++) {
    modes(x, sr, t, [[f0, a, 0.1], [f0 * 2.73, a * 0.5, 0.06], [f0 * 5.1, a * 0.25, 0.04]], r);
    mixInto(x, layer(sr, r, { dur: 0.01, attack: 0.0001, decay: 0.002, type: 'hp', f: 2000 }), t, a * 0.3, sr);
    t += 0.07 * Math.pow(0.7, b) + r() * 0.03;
    a *= 0.5;
  }
  return x;
}

// ---------------------------------------------------------------- Shilka AZP-23

// Four barrels firing in turn at the real combined rate of about 3400 rounds a minute; the 23 mm
// reads lighter and brighter than the 30 mm, not faster.
const SHILKA_RATE = 57;

/** One 23 mm round: a short, light, cracking report with little body. */
function shot23(sr, r, f = 330) {
  const x = new Float32Array(Math.ceil(0.022 * sr));
  blast(x, sr, 0, 1, 0.0007 * (0.9 + 0.2 * r()), 1.6, 0.00003);
  nWave(x, sr, 0.0001, 0.25, 0.0003);
  thump(x, sr, 0, f * (0.95 + 0.1 * r()), 130, 0.006, 0.45, 0.007);
  mixInto(x, layer(sr, r, { dur: 0.012, decay: 0.0035, type: 'bp', f: 2100, q: 0.9 }), 0, 0.55, sr);
  mixInto(x, layer(sr, r, { dur: 0.006, attack: 0.0001, decay: 0.0013, type: 'hp', f: 4500 }), 0, 0.4, sr);
  return x;
}

/** Four barrels in turn at 100 rounds a second (25 a barrel): a tight, regular, buzzing ripple, the barrels' own pitch and level giving it a 25 Hz grain. */
function gunLoop23(sr, r, band) {
  const shots = 100, n = Math.round((shots / SHILKA_RATE) * sr), x = new Float32Array(n);
  const fs = [345, 310, 330, 295], amps = [1, 0.74, 0.9, 0.66];
  const pool = fs.map((f) => [0, 1, 2].map(() => shot23(sr, r, f)));
  const gap = n / shots;
  for (let k = 0; k < shots; k++) {
    const b = k % 4;
    const i0 = Math.round(k * gap + (r() - 0.5) * 0.05 * gap);
    const a = amps[b] * (0.9 + 0.2 * r());
    const s = pool[b][Math.floor(r() * 3)];
    for (let i = 0; i < s.length; i++) x[(((i0 + i) % n) + n) % n] += s[i] * a;
    if (band === 'near') {
      const il = i0 + Math.round((0.0015 + 0.002 * r()) * sr);
      for (let i = 0; i < 0.001 * sr; i++) x[(il + i) % n] += (r() * 2 - 1) * 0.09 * Math.exp(-i / (0.0003 * sr));
      if (k % 9 === 4) {
        const f = 2400 + 900 * r(), ph = r() * TAU, w = (TAU * f) / sr;
        for (let i = 0; i < 0.03 * sr; i++) x[(il + i) % n] += 0.05 * Math.exp(-i / (0.008 * sr)) * Math.sin(ph + w * i);
      }
    }
  }
  const gas = loopNoise(sr, r, n, (b) => biquad(b, sr, 'bp', 800, 0.7));
  for (let i = 0; i < n; i++) x[i] += gas[i] * 0.22;
  saturate(x, 1.25);
  return gunBand(x, sr, band);
}

/** The four barrels winding up (0.4 s) or down (0.55 s). */
function gunSpin23(sr, r, band, up) {
  const T = up ? 0.4 : 0.55, x = new Float32Array(Math.ceil((up ? 0.4 : 1.0) * sr));
  const fs = [345, 310, 330, 295], amps = [1, 0.74, 0.9, 0.66];
  const pool = fs.map((f) => [0, 1].map(() => shot23(sr, r, f)));
  let t = 0, k = 0;
  while (t < T) {
    const p = t / T;
    const rate = up ? SHILKA_RATE * (0.12 + 0.88 * p * p * (3 - 2 * p)) : Math.max(8, SHILKA_RATE * Math.pow(1 - p, 1.3));
    mixInto(x, pool[k % 4][Math.floor(r() * 2)], t, amps[k % 4] * (up ? 0.5 + 0.5 * p : 1 - 0.5 * p) * (0.9 + 0.2 * r()), sr);
    t += 1 / rate;
    k++;
  }
  mixInto(x, layer(sr, r, { dur: up ? 0.4 : 0.7, attack: up ? 0.15 : 0.01, decay: up ? 0.25 : 0.15, type: 'bp', f: 800, q: 0.7 }), 0, 0.25, sr);
  if (!up) roll(x, x.slice(0, Math.round(0.08 * sr)), sr, r, { count: 8, t0: 0.06, t1: 0.7, gain: 0.25, f: 800 });
  saturate(x, 1.25);
  return tail(gunBand(x, sr, band), sr, 0.05);
}

// ---------------------------------------------------------------- warheads and impacts

/** A proximity-fused burst: a hard crack, a hollow whump and fragments whirring away. */
function burstRecipe(sr, r) {
  const x = new Float32Array(Math.ceil(0.8 * sr));
  blast(x, sr, 0, 1, 0.0025 * (0.9 + 0.2 * r()), 1.5, 0.00004);
  nWave(x, sr, 0.0002, 0.45, 0.0004);
  thump(x, sr, 0, 150, 62, 0.04, 0.32, 0.14);
  mixInto(x, layer(sr, r, { dur: 0.5, decay: 0.08, type: 'bp', f: 700, q: 0.7 }), 0, 0.45, sr);
  mixInto(x, layer(sr, r, { dur: 0.08, attack: 0.0002, decay: 0.012, type: 'hp', f: 3000 }), 0, 0.4, sr);
  for (let i = 0; i < 8; i++) {
    const t = 0.02 + r() * 0.45;
    const f0 = 2200 + r() * 3000;
    mixInto(x, layer(sr, r, { dur: 0.3, attack: 0.02, decay: 0.07, sweep: (tt) => f0 * Math.exp(-tt * 4.5) + 350 }), t, 0.05 + 0.07 * r(), sr);
  }
  return x;
}

/** The shock of a close blast: arrives ahead of the sound, a short hard slap and a thud. */
function slapRecipe(sr, r) {
  const x = new Float32Array(Math.ceil(0.4 * sr));
  blast(x, sr, 0, 1, 0.004, 1.2, 0.00005);
  nWave(x, sr, 0, 0.5, 0.003);
  thump(x, sr, 0, 100, 40, 0.04, 0.8, 0.08);
  mixInto(x, layer(sr, r, { dur: 0.2, attack: 0.001, decay: 0.05, f: 500 }), 0, 0.6, sr);
  return saturate(x, 1.4);
}

/** A bomb or missile hitting the ground: a deep crump, dirt thrown up and debris pattering down. */
function impactRecipe(sr, r, big) {
  const len = big ? 4.4 : 2.8;
  const x = new Float32Array(Math.ceil(len * sr));
  blast(x, sr, 0, big ? 0.7 : 0.4, big ? 0.02 : 0.008, 1.5, 0.0004);
  thump(x, sr, 0, big ? 48 : 70, big ? 20 : 34, 0.1, 1, big ? 0.55 : 0.25);
  mixInto(x, layer(sr, r, { dur: big ? 1.6 : 0.9, attack: 0.003, decay: big ? 0.5 : 0.3, f: 300 }), 0, 0.85, sr);
  mixInto(x, layer(sr, r, { dur: 1, attack: 0.02, decay: 0.25, type: 'bp', f: 700, q: 0.5 }), 0.02, 0.4, sr); // dirt
  mixInto(x, layer(sr, r, { dur: len - 0.2, attack: 0.1, decay: big ? 1 : 0.6, f: 60 }), 0.05, 0.5, sr); // the ground shaking
  const n = big ? 42 : 18;
  for (let i = 0; i < n; i++) {
    const t = 0.25 + Math.pow(r(), 0.8) * (big ? 2.6 : 1.6);
    mixInto(x, layer(sr, r, { dur: 0.05, attack: 0.0004, decay: 0.012, type: 'bp', f: 300 + r() * 1300, q: 0.8 }), t, (0.05 + 0.07 * r()) * Math.exp(-t / 1.5), sr);
  }
  return x;
}

/** The sonic crack of a supersonic round passing: an N-wave, a thud of the shock and a little after-rumble. */
function crackRecipe(sr, r) {
  const x = new Float32Array(Math.ceil(0.9 * sr));
  nWave(x, sr, 0, 1, 0.0006);
  blast(x, sr, 0, 0.7, 0.002, 1.5, 0.00005);
  thump(x, sr, 0, 160, 70, 0.03, 0.4, 0.06);
  mixInto(x, layer(sr, r, { dur: 0.15, decay: 0.05, type: 'bp', f: 2500, q: 0.8 }), 0, 0.4, sr);
  roll(x, x.slice(0, Math.round(0.15 * sr)), sr, r, { count: 6, t0: 0.1, t1: 0.7, gain: 0.2, f: 500 });
  return x;
}

/**
 * Every bank as a list of build tasks [group, key, fn], so start() can render the
 * essentials at once and spread the rest over a few frames. `make(channels, sampleRate)`
 * turns sample arrays into an AudioBuffer. Distances: 'near' / 'mid' / 'far'.
 */
export function bankTasks(SR, make) {
  const midSR = Math.min(SR, 32000), farSR = 16000, loopSR = Math.min(SR, 24000);
  const set = (n, seed, fn) => () => Array.from({ length: n }, (_, i) => fn(mulberry(seed + i * 7919)));
  const mono = (sr) => (x) => make([tail(normalize(x, 0.95), sr)], sr);
  const rolls = {
    small: { count: 14, t0: 0.12, t1: 1.6, gain: 0.45, f: 700 },
    big: { count: 18, t0: 0.25, t1: 3.2, gain: 0.55, f: 380 },
  };
  const far = (sr, recipe, len, rl) => (r) => make(distant(sr, r, recipe(r), 'far', { len, roll: rl }), sr);
  const mid = (sr, recipe, len, rl) => (r) => make(distant(sr, r, recipe(r), 'mid', { len, roll: rl }), sr);
  const loopOf = (sr, fn) => (r) => make([fn(sr, r)], sr);
  const gunSet = (seed, fn) => () => ['near', 'mid', 'far'].map((band, i) => { const sr = [loopSR, midSR, farSR][i]; return make([fn(sr, mulberry(seed + i * 31), band)], sr); });
  const tasks = [
    // the essentials, rendered on the first click
    ['engine', 'fighter', set(1, 211, loopOf(loopSR, jetLoop))],
    ['engine', 'cruise', set(1, 223, loopOf(loopSR, turbojetLoop))],
    ['engine', 'drone', set(1, 227, loopOf(loopSR, droneLoop))],
    ['engine', 'helo', set(1, 229, loopOf(loopSR, heloLoop))],
    ['engine', 'tbm', set(1, 233, loopOf(loopSR, shriekLoop))],
    ['engine', 'whoosh', set(1, 239, loopOf(loopSR, whooshLoop))],
    ['idle', 'v8', set(1, 241, loopOf(22050, (sr, r) => dieselLoop(sr, r, { cyl: 8, rpm: 650, rough: 0.35 })))],
    ['idle', 'v12', set(1, 243, loopOf(22050, (sr, r) => dieselLoop(sr, r, { cyl: 12, rpm: 620, rough: 0.25, f: 80 })))],
    ['idle', 'genset', set(1, 247, loopOf(22050, (sr, r) => dieselLoop(sr, r, { cyl: 6, rpm: 1500, rough: 0.2, f: 120, clatter: 0.35 })))],
    ['idle', 'trk_buk', set(1, 271, loopOf(22050, (sr, r) => trackedLoop(sr, r, { cyl: 12, rpm: 600, rough: 0.3, f: 70, clatter: 0.2, ticks: 9, tick: 700 })))],
    ['idle', 'trk_tor', set(1, 273, loopOf(22050, (sr, r) => trackedLoop(sr, r, { cyl: 8, rpm: 720, rough: 0.35, f: 92, clatter: 0.28, ticks: 13, tick: 950 })))],
    ['idle', 'trk_tun', set(1, 277, loopOf(22050, (sr, r) => trackedLoop(sr, r, { cyl: 12, rpm: 640, rough: 0.28, f: 78, clatter: 0.32, ticks: 11, tick: 800 })))],
    ['idle', 'trk_shk', set(1, 281, loopOf(22050, (sr, r) => trackedLoop(sr, r, { cyl: 6, rpm: 840, rough: 0.45, f: 118, clatter: 0.5, ticks: 16, tick: 1100 })))],
    ['gun', 'loop', gunSet(251, gunLoop)],
    ['gun', 'up', gunSet(257, (sr, r, band) => gunSpin(sr, r, band, true))],
    ['gun', 'down', gunSet(263, (sr, r, band) => gunSpin(sr, r, band, false))],
    ['casing', 'gun', set(5, 269, (r) => mono(midSR)(brass30(midSR, r)))],
    null, // everything after this is rendered over the following frames
    ['gun_30t', 'loop', gunSet(283, (sr, r, band) => gunLoop(sr, r, band, GUN30T))],
    ['gun_30t', 'up', gunSet(289, (sr, r, band) => gunSpin(sr, r, band, true, GUN30T))],
    ['gun_30t', 'down', gunSet(293, (sr, r, band) => gunSpin(sr, r, band, false, GUN30T))],
    ['gun_23', 'loop', gunSet(307, gunLoop23)],
    ['gun_23', 'up', gunSet(311, (sr, r, band) => gunSpin23(sr, r, band, true))],
    ['gun_23', 'down', gunSet(313, (sr, r, band) => gunSpin23(sr, r, band, false))],
  ];
  for (const [kind, [recipe, len]] of Object.entries(LAUNCH_RECIPES)) {
    const g = 'launch_' + kind, seed = 300 + kind.charCodeAt(1) * 13;
    tasks.push(
      [g, 'near', set(2, seed, (r) => mono(midSR)(saturate(normalize(recipe(midSR, r)), 1.2)))],
      [g, 'mid', set(2, seed + 5, mid(midSR, (r) => recipe(midSR, r), len + 1.5, rolls.big))],
      [g, 'far', set(2, seed + 9, far(farSR, (r) => recipe(farSR, r), len + 3, { ...rolls.big, t1: 5 }))]
    );
  }
  tasks.push(
    ['burst', 'near', set(4, 401, (r) => mono(midSR)(burstRecipe(midSR, r)))],
    ['burst', 'mid', set(3, 405, mid(midSR, (r) => burstRecipe(midSR, r), 1.8, rolls.small))],
    ['burst', 'far', set(3, 409, far(farSR, (r) => burstRecipe(farSR, r), 2.6, rolls.small))],
    ['boom', 'air', set(3, 149, (r) => mono(midSR)(boom(midSR, r, 'air')))],
    ['boom', 'bomb', set(3, 151, (r) => mono(midSR)(boom(midSR, r, 'bomb')))],
    ['boom', 'huge', set(2, 157, (r) => mono(24000)(boom(24000, r, 'huge')))],
    ['boom', 'mid', set(3, 161, mid(midSR, (r) => boom(midSR, r, 'bomb'), 4.5, rolls.big))],
    ['boom', 'far', set(3, 163, far(farSR, (r) => boom(farSR, r, 'bomb'), 6, rolls.big))],
    ['slap', 'near', set(3, 421, (r) => mono(midSR)(slapRecipe(midSR, r)))],
    ['impact', 'small', set(3, 431, (r) => mono(midSR)(impactRecipe(midSR, r, false)))],
    ['impact', 'big', set(2, 437, (r) => mono(24000)(impactRecipe(24000, r, true)))],
    ['impact', 'far', set(3, 441, far(farSR, (r) => impactRecipe(farSR, r, true), 5, rolls.big))],
    ['crack', 'near', set(3, 451, (r) => mono(SR)(crackRecipe(SR, r)))],
    ['crack', 'far', set(2, 457, far(farSR, (r) => crackRecipe(farSR, r), 2, rolls.small))]
  );
  return tasks;
}

// ================================================================== the engine

const MIN_GAIN = { burst: 0.004, casing: 0.02 };
const IDLE = { s400: 'genset', pantsir: 'v8', osa: 'v8', strela: 'v8', buk: 'trk_buk', tor: 'trk_tor', tunguska: 'trk_tun', shilka: 'trk_shk' };
// What the tracked vehicles add to the idle: the electronics hum, a gas turbine (the auxiliary
// power unit) as [Hz, level], and the hydraulic pump cycling as [Hz, level, cycles a second].
const VEHICLE = {
  buk: { hum: [[400, 0.05], [800, 0.025], [1600, 0.008]], hydro: [620, 0.1, 0.13] },
  tor: { hum: [[400, 0.04], [1200, 0.015]], turbine: [1750, 0.05], hydro: [760, 0.08, 0.22] },
  tunguska: { hum: [[400, 0.05], [800, 0.025], [1200, 0.012]], turbine: [2350, 0.055], hydro: [540, 0.07, 0.17] },
  shilka: { hum: [[400, 0.045], [600, 0.02], [1000, 0.01]], hydro: [880, 0.06, 0.3] },
};

export class AudioEngine {
  constructor({ context = null } = {}) {
    this.ctx = null;
    this.given = context;
    this.volume = 0.8;
    this.musicVolume = 0.5;
    this.muted = false;
    this.listenerPos = { x: 0, y: 0, z: 0 };
    this.queue = [];
    this.inFlight = []; // sounds still travelling to the listener
    this.voices = [];
    this.posVoices = 0;
    this.directVoices = 0;
    this.lastPlay = {};
    this.used = {};
    this.bank = {};
    this.pending = [];
    this.bedEnergy = 0;
    this.combat = 0;
    this.throttle = {};
    this.engines = [];
    this.guns = new Map();
    this.idleKind = null;
    this.moodState = 'brief';
    this.nextPad = 0;
    this.padIndex = 0;
    this.nextBell = 0;
  }

  start() {
    if (this.ctx) {
      this.ctx.resume?.();
      return;
    }
    let ctx = this.given;
    if (!ctx) {
      const AC = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
      if (!AC) return;
      ctx = new AC();
    }
    this.ctx = ctx;

    // mix -> master volume -> compressor -> brickwall -> soft clip -> out
    this.mix = ctx.createGain();
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : this.volume;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -10;
    comp.knee.value = 6;
    comp.ratio.value = 4;
    comp.attack.value = 0.006;
    comp.release.value = 0.12;
    const wall = ctx.createDynamicsCompressor();
    wall.threshold.value = -1.5;
    wall.knee.value = 0;
    wall.ratio.value = 20;
    wall.attack.value = 0.001;
    wall.release.value = 0.05;
    const soft = ctx.createWaveShaper();
    const sc = new Float32Array(2049);
    for (let k = 0; k < sc.length; k++) {
      const x = (k / (sc.length - 1)) * 2 - 1;
      const a = Math.abs(x);
      sc[k] = Math.sign(x) * (a < 0.8 ? a : 0.8 + 0.2 * Math.tanh((a - 0.8) / 0.2));
    }
    soft.curve = sc;
    this.mix.connect(this.master).connect(comp).connect(wall).connect(soft).connect(ctx.destination);

    // open country: a short, sparse tail
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.impulse(2, 3);
    this.reverbSend = ctx.createGain();
    this.reverbSend.gain.value = 0.6;
    this.reverbSend.connect(this.reverb).connect(this.mix);

    // ambience, engines and music duck under close launches and blasts
    this.duckBus = ctx.createGain();
    this.duckBus.connect(this.mix);
    this.sfxDuck = ctx.createGain();
    this.sfxDuck.connect(this.mix);
    const bus = (g, dest = this.mix) => {
      const b = ctx.createGain();
      b.gain.value = g;
      b.connect(dest);
      return b;
    };
    this.amb = bus(1, this.duckBus);
    this.engineBus = bus(0.85, this.duckBus);
    this.music = bus(this.musicVolume * 0.45, this.duckBus);
    this.sfx = bus(1, this.sfxDuck);
    this.blastBus = bus(1);
    this.uiBus = bus(1);
    // gun loops get a limiter so sustained fire never clips the mix
    this.gunBus = ctx.createGain();
    const lim = ctx.createDynamicsCompressor();
    lim.threshold.value = -4;
    lim.knee.value = 0;
    lim.ratio.value = 20;
    lim.attack.value = 0.001;
    lim.release.value = 0.06;
    this.gunBus.connect(lim).connect(this.sfxDuck);
    const musicVerb = ctx.createGain();
    musicVerb.gain.value = 0.7;
    this.music.connect(musicVerb).connect(this.reverbSend);

    this.white = this.noiseBuffer('white');
    this.brown = this.noiseBuffer('brown');
    this.pink = this.noiseBuffer('pink');

    // render the essential sample banks now, the rest over the next frames
    const make = (chans, sr) => {
      const b = ctx.createBuffer(chans.length, chans[0].length, sr);
      chans.forEach((c, i) => b.copyToChannel(c, i));
      return b;
    };
    const tasks = bankTasks(ctx.sampleRate, make);
    const split = tasks.indexOf(null);
    for (const t of tasks.slice(0, split)) this.runTask(t);
    this.pending = tasks.slice(split + 1);
    if (this.given) while (this.pending.length) this.runTask(this.pending.shift());
    else {
      this.pump();
      this.loadRecordings();
    }

    this.buildAmbience();
    for (let i = 0; i < ENGINE_VOICES; i++) this.engines.push(this.buildEngineVoice());
    this.buildSeeker();
    this.nextPad = ctx.currentTime + 2;
    if (this.idleKind) this.vehicle(this.idleKind);
  }

  runTask([group, key, fn]) {
    (this.bank[group] ||= {})[key] = fn();
  }

  // one bank per tick so the first seconds never stall
  pump() {
    if (!this.pending.length) return;
    this.runTask(this.pending.shift());
    setTimeout(() => this.pump(), 16);
  }

  // Real recordings: fetched and decoded in the background; once the synthesized banks are done
  // as well they are cut up and take their places (see RECORDINGS).
  async loadRecordings() {
    const ctx = this.ctx;
    const base = import.meta.env?.BASE_URL ?? '/';
    const rec = {};
    await Promise.all(
      Object.entries(RECORDINGS).map(async ([key, spec]) => {
        try {
          const res = await fetch(`${base}audio/${spec.file}`);
          if (res.ok) rec[key] = await ctx.decodeAudioData(await res.arrayBuffer());
        } catch {
          // missing or undecodable: the synthesized sound stays
        }
      })
    );
    this.rec = rec;
    const apply = () => (this.pending.length ? setTimeout(apply, 100) : this.useRecordings());
    apply();
  }

  useRecordings() {
    const ctx = this.ctx, SR = ctx.sampleRate, R = this.rec, B = this.bank;
    const make = (chans) => {
      const b = ctx.createBuffer(chans.length, chans[0].length, SR);
      chans.forEach((c, i) => b.copyToChannel(c, i));
      return b;
    };
    // each slice mixed to mono, its DC removed, faded in and out, normalized
    const cut = (key) => {
      const buf = R[key];
      if (!buf) return [];
      return (RECORDINGS[key].slices || [[0, buf.duration]]).map(([t0, len]) => {
        const a = Math.floor(t0 * SR), n = Math.max(1, Math.min(Math.floor(len * SR), buf.length - a));
        const x = new Float32Array(n);
        for (let c = 0; c < buf.numberOfChannels; c++) {
          const d = buf.getChannelData(c);
          for (let i = 0; i < n; i++) x[i] += d[a + i] / buf.numberOfChannels;
        }
        let mean = 0;
        for (let i = 0; i < n; i++) mean += x[i];
        mean /= n;
        const fin = Math.min(n, Math.round(0.003 * SR)), fout = Math.round(n * 0.3);
        for (let i = 0; i < n; i++) x[i] -= mean;
        for (let i = 0; i < fin; i++) x[i] *= i / fin;
        for (let i = 0; i < fout; i++) x[n - 1 - i] *= Math.pow(i / fout, 1.5);
        return normalize(x, 0.95);
      });
    };
    // lower and longer (a bigger object), by resampling
    const pitch = (x, rate) => {
      const n = Math.floor(x.length / rate), o = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const p = i * rate, j = Math.floor(p), f = p - j;
        o[i] = (x[j] || 0) * (1 - f) + (x[j + 1] || 0) * f;
      }
      return o;
    };
    // a recording laid over a synthesized buffer, then normalized together
    const blend = (buf, x, g) => {
      if (!buf || buf.sampleRate !== SR) return buf;
      const n = Math.max(buf.length, x.length);
      const o = new Float32Array(n);
      o.set(buf.getChannelData(0));
      for (let i = 0; i < x.length; i++) o[i] += x[i] * g;
      return make([normalize(o, 0.95)]);
    };
    const rng = mulberry(4242);
    const ROLL = { count: 18, t0: 0.25, t1: 3.2, gain: 0.55, f: 380 };
    const ROLL_SMALL = { count: 14, t0: 0.12, t1: 1.6, gain: 0.45, f: 700 };

    const dist = cut('distant');
    if (dist.length) {
      B.burst ||= {};
      B.burst.far = dist.map((x) => make(distant(SR, rng, x, 'far', { len: 2.8, roll: ROLL_SMALL })));
    }
    const blast = cut('blast');
    if (blast.length && B.boom) {
      const b = blast[0];
      B.boom.bomb = [make([Float32Array.from(b)]), make([normalize(pitch(b, 0.86), 0.95)])];
      B.boom.huge = [make([normalize(pitch(b, 0.72), 0.95)])];
      if (dist.length) B.boom.far = dist.slice(0, 4).map((x) => make(distant(SR, rng, pitch(x, 0.8), 'far', { len: 5, roll: ROLL })));
    }
    // the cannon's crack laid under the 57E6 booster up close
    const cannon = cut('cannon');
    if (cannon.length && B.launch_57E6?.near) B.launch_57E6.near = B.launch_57E6.near.map((b, i) => blend(b, cannon[i % cannon.length], 0.5));
    const brass = cut('brass');
    if (brass.length) (B.casing ||= {}).gun = brass.map((x) => make([normalize(pitch(x, 0.8), 0.9)]));
    this.recordingsInUse = Object.keys(R);
  }

  // ------------------------------------------------------------------ basics

  noiseBuffer(type) {
    const ctx = this.ctx;
    const len = ctx.sampleRate * 4;
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let last = 0;
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
      for (let i = 0; i < len; i++) {
        const w = Math.random() * 2 - 1;
        if (type === 'brown') {
          last = (last + 0.02 * w) / 1.02;
          d[i] = last * 3.5;
        } else if (type === 'pink') {
          b0 = 0.99886 * b0 + w * 0.0555179;
          b1 = 0.99332 * b1 + w * 0.0750759;
          b2 = 0.969 * b2 + w * 0.153852;
          b3 = 0.8665 * b3 + w * 0.3104856;
          b4 = 0.55 * b4 + w * 0.5329522;
          b5 = -0.7616 * b5 - w * 0.016898;
          d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
          b6 = w * 0.115926;
        } else d[i] = w;
      }
    }
    return buf;
  }

  impulse(seconds, decay) {
    const ctx = this.ctx;
    const len = Math.round(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return buf;
  }

  loop(buffer) {
    const s = this.ctx.createBufferSource();
    s.buffer = buffer;
    s.loop = true;
    s.start(0, Math.random() * buffer.duration);
    return s;
  }

  // Direction-only panner: distance attenuation is applied separately.
  panner(hrtf) {
    const p = this.ctx.createPanner();
    p.panningModel = hrtf ? 'HRTF' : 'equalpower';
    p.distanceModel = 'inverse';
    p.refDistance = 1;
    p.rolloffFactor = 0;
    return p;
  }

  setPannerPos(p, x, y, z, glide = 0) {
    if (p.positionX) {
      if (glide > 0) {
        const now = this.ctx.currentTime;
        p.positionX.setTargetAtTime(x, now, glide);
        p.positionY.setTargetAtTime(y, now, glide);
        p.positionZ.setTargetAtTime(z, now, glide);
      } else {
        p.positionX.value = x;
        p.positionY.value = y;
        p.positionZ.value = z;
      }
    } else p.setPosition(x, y, z);
  }

  setVolume(v) {
    this.volume = v;
    if (this.master) this.master.gain.value = this.muted ? 0 : v;
  }

  setMusicVolume(v) {
    this.musicVolume = v;
    if (this.music) this.music.gain.value = v * 0.45;
  }

  toggleMute() {
    this.muted = !this.muted;
    this.setVolume(this.volume);
    return this.muted;
  }

  /** Pull ambience, engines and music down for a moment (and other world sounds for big blasts). */
  duck(depth, time, sfx = false) {
    const now = this.ctx.currentTime;
    const targets = sfx ? [this.duckBus.gain, this.sfxDuck.gain] : [this.duckBus.gain];
    for (const g of targets) {
      g.cancelScheduledValues(now);
      g.setTargetAtTime(depth, now, 0.004);
      g.setTargetAtTime(1, now + time * 0.25, time * 0.45);
    }
  }

  throttled(name, gap) {
    const now = this.ctx.currentTime;
    if (now - (this.throttle[name] ?? -Infinity) < gap) return true;
    this.throttle[name] = now;
    return false;
  }

  // ------------------------------------------------------------------ routing

  dist(p) {
    const l = this.listenerPos;
    return Math.hypot(p.x - l.x, p.y - l.y, p.z - l.z);
  }

  gainAt(d, ref, level) {
    return level * Math.min(1, ref / Math.max(d, 1));
  }

  // air absorbs the highs: distant launches become a dull rumble
  absorb(d) {
    return Math.max(160, 18000 / (1 + d / 140));
  }

  // Out of voices: silence the quietest positional voice if the new sound is clearly louder.
  steal(g) {
    const now = this.ctx.currentTime;
    let quiet = null, quietG = Infinity;
    for (const v of this.voices) {
      if (v.direct || v.stolen) continue;
      const age = now - v.t0;
      const vg = age > 0 ? v.g * Math.exp(-age / 0.35) : v.g;
      if (vg < quietG) {
        quietG = vg;
        quiet = v;
      }
    }
    if (!quiet || quietG > g * 0.6) return false;
    quiet.out.gain.cancelScheduledValues(now);
    quiet.out.gain.setTargetAtTime(0, now, 0.015);
    quiet.stolen = true;
    quiet.end = now + 0.05;
    this.posVoices--;
    return true;
  }

  /** Positional voice: returns a route to connect sources to, or null when inaudible / out of voices. */
  route(pos, { ref = 20, level = 1, reverb = 0, bus = this.sfx } = {}) {
    const ctx = this.ctx;
    const d = this.dist(pos);
    const g = this.gainAt(d, ref, level);
    if (g < AUDIBLE || (this.posVoices >= MAX_VOICES && !this.steal(g))) {
      this.bedEnergy += g * 0.15;
      return null;
    }
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = this.absorb(d);
    const pan = this.panner(false);
    this.setPannerPos(pan, pos.x, pos.y, pos.z);
    const out = ctx.createGain();
    out.gain.value = g;
    lp.connect(pan).connect(out).connect(bus);
    const nodes = [lp, pan, out];
    if (reverb > 0) {
      const send = ctx.createGain();
      send.gain.value = reverb;
      out.connect(send).connect(this.reverbSend);
      nodes.push(send);
    }
    return { dest: lp, out, t0: ctx.currentTime + 0.01, d, g, end: 0, nodes, direct: false, stolen: false };
  }

  /** Non-positional voice (UI, ambience one-shots). `force` skips the cap (rare cues). */
  direct({ level = 1, pan = 0, bus = this.uiBus, filter = null, reverb = 0, force = false, at = 0 } = {}) {
    if (this.directVoices >= DIRECT_VOICES && !force) return null;
    const ctx = this.ctx;
    const out = ctx.createGain();
    out.gain.value = level;
    const sp = ctx.createStereoPanner();
    sp.pan.value = pan;
    out.connect(sp).connect(bus);
    const nodes = [out, sp];
    let dest = out;
    if (filter) {
      const f = ctx.createBiquadFilter();
      f.type = filter.type;
      f.frequency.value = filter.freq;
      f.Q.value = filter.q ?? 0.7;
      f.connect(out);
      dest = f;
      nodes.push(f);
    }
    if (reverb > 0) {
      const send = ctx.createGain();
      send.gain.value = reverb;
      out.connect(send).connect(this.reverbSend);
      nodes.push(send);
    }
    return { dest, out, t0: ctx.currentTime + 0.005 + at, d: 0, g: level, end: 0, nodes, direct: true };
  }

  finish(r) {
    if (!r) return;
    this.voices.push(r);
    if (r.direct) this.directVoices++;
    else this.posVoices++;
  }

  reap(now) {
    let j = 0;
    for (const v of this.voices) {
      if (v.end + 0.1 < now) {
        for (const n of v.nodes) n.disconnect();
        if (v.direct) this.directVoices--;
        else if (!v.stolen) this.posVoices--;
      } else this.voices[j++] = v;
    }
    this.voices.length = j;
  }

  // a world sound: it travels to the listener at the speed of sound and only takes a voice when
  // it arrives; the loudest few per kind play each frame, the rest feed the battle rumble
  enqueue(kind, pos, ref, level, play) {
    if (!this.ctx) return;
    pos = here(pos);
    const d = this.dist(pos);
    const g = this.gainAt(d, ref, level);
    if (g < (MIN_GAIN[kind] ?? AUDIBLE)) {
      this.bedEnergy += g * 0.15;
      return;
    }
    this.combat = Math.min(1, this.combat + g * 0.5);
    const delay = Math.min(d / SOUND_SPEED, MAX_DELAY);
    if (delay > 0.08) {
      if (this.inFlight.length < 512) this.inFlight.push({ at: this.ctx.currentTime + delay, kind, pos, ref, level, play, g });
      else this.bedEnergy += g * 0.15;
      return;
    }
    if (this.queue.length < 256) this.queue.push({ kind, g, play, pos });
  }

  land(now) {
    let j = 0;
    for (const e of this.inFlight) {
      if (e.at > now) {
        this.inFlight[j++] = e;
        continue;
      }
      if (this.queue.length < 256) this.queue.push({ kind: e.kind, g: this.gainAt(this.dist(e.pos), e.ref, e.level), play: e.play, pos: e.pos });
    }
    this.inFlight.length = j;
  }

  flush(now) {
    const q = this.queue;
    if (!q.length) return;
    q.sort((a, b) => b.g - a.g);
    const used = this.used;
    for (const k in used) used[k] = 0;
    for (const e of q) {
      const n = used[e.kind] || 0;
      const close = e.g > 0.15;
      const cap = (CAPS[e.kind] ?? 2) * (close ? 3 : 1);
      const spaced = close || now - (this.lastPlay[e.kind] || -1) >= (GAPS[e.kind] ?? 0.03);
      if (n >= cap || !spaced) {
        this.bedEnergy += e.g * 0.15;
        continue;
      }
      used[e.kind] = n + 1;
      this.lastPlay[e.kind] = now;
      e.play(e.pos);
    }
    q.length = 0;
  }

  /** Play a pre-rendered sample into a voice. */
  playBuf(r, buf, { at = 0, rate = 1, gain = 1 } = {}) {
    if (!buf) return;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    let node = src;
    if (gain !== 1) {
      const g = ctx.createGain();
      g.gain.value = gain;
      src.connect(g);
      node = g;
      r.nodes.push(g);
    }
    node.connect(r.dest);
    r.nodes.push(src);
    const t0 = r.t0 + at;
    src.start(t0);
    r.end = Math.max(r.end, t0 + buf.duration / rate + 0.02);
  }

  /** Near, mid or far rendering of a sample set for a distance d. */
  variant(set, d, near, mid) {
    if (!set) return null;
    const list = d < near ? set.near || set.mid || set.far : d < mid ? set.mid || set.far || set.near : set.far || set.mid || set.near;
    return list ? pick(list) : null;
  }

  tone(r, { at = 0, type = 'sine', f0 = 100, f1 = 0, sweep = 0, dur = 0.3, gain = 0.5, attack = 0.003 }) {
    const ctx = this.ctx;
    const t0 = r.t0 + at;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t0);
    if (f1) o.frequency.exponentialRampToValueAtTime(f1, t0 + (sweep || dur));
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(Math.max(gain, 0.0002), t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(r.dest);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
    r.nodes.push(o, g);
    r.end = Math.max(r.end, t0 + dur + 0.05);
    return o;
  }

  noise(r, { at = 0, dur = 0.1, freq = 1000, q = 0.7, type = 'bandpass', gain = 0.3, attack = 0.002 }) {
    const ctx = this.ctx;
    const t0 = r.t0 + at;
    const src = ctx.createBufferSource();
    src.buffer = this.white;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(Math.max(gain, 0.0002), t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f).connect(g).connect(r.dest);
    src.start(t0, Math.random() * 3);
    src.stop(t0 + dur + 0.05);
    r.nodes.push(src, f, g);
    r.end = Math.max(r.end, t0 + dur + 0.05);
  }

  // ------------------------------------------------------------------ world events

  launch(kind, pos) {
    const L = LAUNCH[kind];
    if (!L) return;
    this.enqueue('launch', pos, L.ref, L.level, (p) => {
      const r = this.route(p, { ref: L.ref, level: L.level, reverb: L.reverb });
      if (!r) return;
      this.playBuf(r, this.variant(this.bank['launch_' + kind], r.d, L.near, L.mid), { rate: 0.96 + Math.random() * 0.08 });
      this.finish(r);
      if (r.d < L.close) this.duck(0.5, 1.2);
    });
  }

  /** The Tor's motor lighting is part of its '9M338' launch sample (a gas-generator thump, then the motor 0.9 s later, at the sim's `eject`), so there is nothing to add here; kept so a caller wired to the sim's ignite event can call it. */
  ignite() {}

  explosion(pos, size = 1) {
    const ref = 120 * Math.sqrt(size);
    this.enqueue('explosion', pos, ref, 1.3, (p) => {
      const r = this.route(p, { ref, level: 1.3, reverb: 0.35, bus: this.blastBus });
      if (!r) return;
      const B = this.bank.boom;
      const set = r.d < 600 ? (size > 2 ? B?.huge : size > 0.8 ? B?.bomb : B?.air) : r.d < 3000 ? B?.mid : B?.far;
      this.playBuf(r, pick(set ?? B?.bomb), { rate: 0.95 + Math.random() * 0.1 });
      this.finish(r);
      if (r.d < 250) this.slap(r.d, size);
    });
  }

  airburst(pos) {
    this.enqueue('burst', pos, 70, 1.1, (p) => {
      const r = this.route(p, { ref: 70, level: 1.1, reverb: 0.3 });
      if (!r) return;
      this.playBuf(r, this.variant(this.bank.burst, r.d, 600, 3000), { rate: 0.94 + Math.random() * 0.12 });
      this.finish(r);
    });
  }

  impact(pos, size = 1) {
    const ref = 100 * Math.sqrt(size);
    this.enqueue('impact', pos, ref, 1.2, (p) => {
      const r = this.route(p, { ref, level: 1.2, reverb: 0.35, bus: this.blastBus });
      if (!r) return;
      const I = this.bank.impact;
      this.playBuf(r, pick(r.d > 2500 ? I?.far : size > 1 ? I?.big : I?.small), { rate: 0.95 + Math.random() * 0.1 });
      this.finish(r);
      if (r.d < 200) this.slap(r.d, size);
    });
  }

  // a supersonic missile or round passing close: the crack
  crack(pos) {
    this.enqueue('crack', pos, 60, 0.8, (p) => {
      const r = this.route(p, { ref: 60, level: 0.8, reverb: 0.2 });
      if (!r) return;
      this.playBuf(r, this.variant(this.bank.crack, r.d, 800, 800));
      this.finish(r);
    });
  }

  // the shock of a close blast: arrives with the sound, ducks everything for a moment
  slap(d, size) {
    const r = this.direct({ level: Math.min(1, (0.9 * size * 80) / Math.max(d, 40)), bus: this.blastBus, force: true });
    if (!r) return;
    this.playBuf(r, pick(this.bank.slap?.near));
    this.finish(r);
    this.duck(0.25, 1.6, true);
  }

  // ------------------------------------------------------------------ Pantsir guns

  /**
   * Continuous fire from a unit's guns while `on`; spin-up and wind-down around the loop. `shell` is
   * the unit's `weapons.gun.shell` ('30mm' Pantsir and Tunguska, '23mm' Shilka; '30mm-tunguska' for
   * the Tunguska's slower, deeper 2A38M); it is read when the burst starts. Any number of units may
   * fire at once (the most distant loops are dropped beyond GUN_VOICES).
   */
  gun(unitId, on, pos, shell = '30mm') {
    if (!this.ctx) return;
    let v = this.guns.get(unitId);
    if (on && !v) {
      const ctx = this.ctx;
      const d = this.dist(pos);
      const band = d < 300 ? 'near' : d < 2000 ? 'mid' : 'far';
      const spec = GUNS[shell] ?? GUNS['30mm'];
      // spin-up, loop and wind-down are rendered separately; until all three exist the Pantsir's stand in
      const ready = (b) => b?.loop && b.up && b.down;
      let G = this.bank[spec.bank];
      if (!ready(G)) G = this.bank.gun;
      if (!ready(G)) return;
      if (this.guns.size >= GUN_VOICES) {
        let far = null, farD = d;
        for (const [id, o] of this.guns) {
          const od = this.dist(o.pos);
          if (!o.on) {
            far = id;
            break;
          }
          if (od > farD) {
            far = id;
            farD = od;
          }
        }
        if (far === null) return;
        this.dropGun(far);
      }
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = this.absorb(d);
      const pan = this.panner(false);
      this.setPannerPos(pan, pos.x, pos.y, pos.z);
      const out = ctx.createGain();
      out.gain.value = 0;
      lp.connect(pan).connect(out).connect(this.gunBus);
      const send = ctx.createGain();
      send.gain.value = 0.25;
      out.connect(send).connect(this.reverbSend);
      const now = ctx.currentTime;
      const iBand = { near: 0, mid: 1, far: 2 }[band];
      const up = ctx.createBufferSource();
      up.buffer = G.up[iBand];
      up.connect(lp);
      up.start(now);
      const loop = ctx.createBufferSource();
      loop.buffer = G.loop[iBand];
      loop.loop = true;
      loop.connect(lp);
      loop.start(now + up.buffer.duration * 0.92);
      v = { lp, pan, out, send, loop, up, pos: here(pos), band: iBand, on: true, G, spec };
      this.guns.set(unitId, v);
      this.combat = 1;
    } else if (v && on) {
      v.pos = here(pos);
      if (!v.on) {
        // fire again before the tail ended: drop the tail and restart the loop
        v.on = true;
        v.tail?.stop();
        const loop = this.ctx.createBufferSource();
        loop.buffer = v.G.loop[v.band];
        loop.loop = true;
        loop.connect(v.lp);
        loop.start();
        v.loop = loop;
      }
    } else if (v && !on && v.on) {
      v.on = false;
      const now = this.ctx.currentTime;
      v.loop.stop(now + 0.02);
      const tail = this.ctx.createBufferSource();
      tail.buffer = v.G.down[v.band];
      tail.connect(v.lp);
      tail.start(now + 0.01);
      v.tail = tail;
      v.endAt = now + tail.buffer.duration + 0.1;
    }
  }

  dropGun(id) {
    const v = this.guns.get(id);
    if (!v) return;
    for (const s of [v.up, v.loop, v.tail]) {
      try { s?.stop(); } catch { /* already stopped */ }
    }
    for (const n of [v.lp, v.pan, v.out, v.send]) n.disconnect();
    this.guns.delete(id);
  }

  updateGuns(now) {
    for (const [id, v] of this.guns) {
      const d = this.dist(v.pos);
      v.out.gain.setTargetAtTime(this.gainAt(d, v.spec.ref, v.spec.level), now, 0.03);
      v.lp.frequency.setTargetAtTime(this.absorb(d), now, 0.05);
      this.setPannerPos(v.pan, v.pos.x, v.pos.y, v.pos.z, 0.03);
      if (!v.on && now > v.endAt) {
        for (const n of [v.lp, v.pan, v.out, v.send]) n.disconnect();
        this.guns.delete(id);
      }
      // brass rattling off the mount, close up only
      const [c0, c1, cRate, cLevel] = v.spec.casing;
      if (v.on && d < 60 && this.bank.casing?.gun && !this.throttled('casing' + id, c0 + Math.random() * c1)) {
        const r = this.route(v.pos, { ref: 8, level: cLevel });
        if (r) {
          this.playBuf(r, pick(this.bank.casing.gun), { rate: cRate * (0.9 + Math.random() * 0.2) });
          this.finish(r);
        }
      }
    }
  }

  // ------------------------------------------------------------------ threat engines

  buildEngineVoice() {
    const ctx = this.ctx;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    const pan = this.panner(false);
    const out = ctx.createGain();
    out.gain.value = 0;
    lp.connect(pan).connect(out).connect(this.engineBus);
    return { lp, pan, out, src: null, type: null, id: 0, last: null };
  }

  setEngineType(v, type) {
    if (v.type === type) return;
    v.src?.stop();
    v.src?.disconnect();
    v.src = null;
    v.type = type;
    const buf = pick(this.bank.engine?.[THREATS[type]?.loop]);
    if (!buf) return;
    v.src = this.loop(buf);
    v.src.connect(v.lp);
  }

  updateEngines(threats, now) {
    // the nearest audible threats get the voices, a voice keeps its threat while it stays in the set
    const l = this.listenerPos;
    const cand = [];
    for (const t of threats ?? []) {
      if (!t.alive && !t.falling) continue;
      const def = THREATS[t.type];
      if (!def) continue;
      const d = Math.hypot(t.pos.x - l.x, t.pos.y - l.y, t.pos.z - l.z);
      const g = this.gainAt(d, def.ref, def.level) * (t.falling ? 0.6 : 1);
      if (g < 0.004) continue;
      cand.push({ t, d, g, def });
    }
    cand.sort((a, b) => b.g - a.g);
    const keep = cand.slice(0, ENGINE_VOICES);
    const ids = new Set(keep.map((c) => c.t.id));
    for (const v of this.engines) if (v.id && !ids.has(v.id)) {
      v.id = 0;
      v.out.gain.setTargetAtTime(0, now, 0.15);
    }
    for (const c of keep) {
      let v = this.engines.find((e) => e.id === c.t.id) ?? this.engines.find((e) => !e.id);
      if (!v) break;
      if (v.id !== c.t.id) {
        v.id = c.t.id;
        this.setEngineType(v, c.t.type);
      }
      const t = c.t;
      // Doppler from the closing speed along the line of sight
      const dx = t.pos.x - l.x, dy = t.pos.y - l.y, dz = t.pos.z - l.z;
      const closing = -(t.vel.x * dx + t.vel.y * dy + t.vel.z * dz) / Math.max(c.d, 1);
      const doppler = clamp(SOUND_SPEED / Math.max(SOUND_SPEED - clamp(closing, -300, 300), 60), 0.5, 2.2);
      if (v.src) v.src.playbackRate.setTargetAtTime(c.def.rate * doppler, now, 0.08);
      // a ballistic missile is only heard screaming in on its last few kilometres
      const g = c.def.shriek ? c.g * clamp(1 - c.d / 12000, 0, 1) : c.g;
      v.out.gain.setTargetAtTime(g, now, 0.08);
      v.lp.frequency.setTargetAtTime(this.absorb(c.d), now, 0.1);
      this.setPannerPos(v.pan, t.pos.x, t.pos.y, t.pos.z, 0.05);
    }
  }

  // ------------------------------------------------------------------ ambience and vehicle

  buildAmbience() {
    const ctx = this.ctx;
    // steppe wind: pink noise through a wandering band, with gusts
    this.windF = ctx.createBiquadFilter();
    this.windF.type = 'bandpass';
    this.windF.frequency.value = 500;
    this.windF.Q.value = 0.6;
    this.windG = ctx.createGain();
    this.windG.gain.value = LEVELS.wind;
    this.loop(this.pink).connect(this.windF).connect(this.windG).connect(this.amb);
    const low = ctx.createBiquadFilter();
    low.type = 'lowpass';
    low.frequency.value = 140;
    const lowG = ctx.createGain();
    lowG.gain.value = LEVELS.wind * 1.4;
    this.loop(this.brown).connect(low).connect(lowG).connect(this.amb);
    // the distant battle: a rumble fed by everything too far or too many to play
    this.bedF = ctx.createBiquadFilter();
    this.bedF.type = 'lowpass';
    this.bedF.frequency.value = 220;
    this.bedG = ctx.createGain();
    this.bedG.gain.value = 0;
    this.loop(this.brown).connect(this.bedF).connect(this.bedG).connect(this.amb);
    this.gust = 0;
    this.gustT = 0;
  }

  /** The selected vehicle: its diesel (or generator) idling, cabin fans and the electronics hum. */
  vehicle(kind) {
    this.idleKind = kind;
    if (!this.ctx) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    if (this.idle) {
      const old = this.idle;
      old.g.gain.setTargetAtTime(0, now, 0.3);
      setTimeout(() => old.nodes.forEach((n) => (n.stop?.(), n.disconnect())), 2000);
    }
    const buf = pick(this.bank.idle?.[IDLE[kind] ?? 'v8']);
    const g = ctx.createGain();
    g.gain.value = 0;
    g.connect(this.amb);
    const nodes = [g];
    if (buf) {
      const s = this.loop(buf);
      s.playbackRate.value = 0.95 + Math.random() * 0.1;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 900;
      s.connect(lp).connect(g);
      nodes.push(s, lp);
    }
    // fans: a soft band of air; electronics: a 400 Hz power hum with its harmonics
    const fan = this.loop(this.white);
    const ff = ctx.createBiquadFilter();
    ff.type = 'bandpass';
    ff.frequency.value = 1300;
    ff.Q.value = 0.5;
    const fg = ctx.createGain();
    fg.gain.value = 0.18;
    fan.connect(ff).connect(fg).connect(g);
    nodes.push(fan, ff, fg);
    const prof = VEHICLE[kind];
    for (const [f, a] of prof?.hum ?? [[400, 0.05], [800, 0.02], [1200, 0.012]]) {
      const o = ctx.createOscillator();
      o.frequency.value = f;
      const og = ctx.createGain();
      og.gain.value = a;
      o.connect(og).connect(g);
      o.start();
      nodes.push(o, og);
    }
    if (prof?.turbine) {
      // the gas turbine: two close sines beating slowly, over a thin band of rushing air
      const [f, a] = prof.turbine;
      for (const k of [1, 1.006]) {
        const o = ctx.createOscillator();
        o.frequency.value = f * k;
        const og = ctx.createGain();
        og.gain.value = a * 0.5;
        o.connect(og).connect(g);
        o.start();
        nodes.push(o, og);
      }
      const air = this.loop(this.white);
      const af = ctx.createBiquadFilter();
      af.type = 'bandpass';
      af.frequency.value = f * 1.5;
      af.Q.value = 3;
      const ag = ctx.createGain();
      ag.gain.value = a * 1.2;
      air.connect(af).connect(ag).connect(g);
      nodes.push(air, af, ag);
    }
    if (prof?.hydro) {
      // hydraulics: a pump whine whose level breathes as it cycles
      const [f, a, rate] = prof.hydro;
      const pump = this.loop(this.pink);
      const pf = ctx.createBiquadFilter();
      pf.type = 'bandpass';
      pf.frequency.value = f;
      pf.Q.value = 4;
      const pg = ctx.createGain();
      pg.gain.value = a * 0.5;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = rate;
      const lg = ctx.createGain();
      lg.gain.value = a * 0.5;
      lfo.connect(lg).connect(pg.gain);
      lfo.start();
      pump.connect(pf).connect(pg).connect(g);
      nodes.push(pump, pf, pg, lfo, lg);
    }
    g.gain.setTargetAtTime(LEVELS.vehicle, now, 0.4);
    this.idle = { g, nodes };
  }

  // ------------------------------------------------------------------ console sounds

  /** The Strela seeker tone: a buzzing growl that rises and steadies when the seeker locks. */
  buildSeeker() {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = 900;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1000;
    bp.Q.value = 2;
    // the growl: amplitude modulation from a low, noisy oscillator
    const am = ctx.createGain();
    am.gain.value = 0.5;
    const lfo = ctx.createOscillator();
    lfo.type = 'square';
    lfo.frequency.value = 22;
    const lfoG = ctx.createGain();
    lfoG.gain.value = 0.5;
    lfo.connect(lfoG).connect(am.gain);
    const g = ctx.createGain();
    g.gain.value = 0;
    o.connect(bp).connect(am).connect(g).connect(this.uiBus);
    o.start();
    lfo.start();
    this.seek = { o, bp, lfo, lfoG, g, level: 0, locked: false };
  }

  seeker(level, locked) {
    const s = this.seek;
    if (!s) return;
    const now = this.ctx.currentTime;
    level = clamp(level ?? 0, 0, 1);
    s.g.gain.setTargetAtTime(level * LEVELS.seeker, now, 0.03);
    const f = locked ? 1250 : 820 + level * 260;
    s.o.frequency.setTargetAtTime(f, now, 0.05);
    s.bp.frequency.setTargetAtTime(f * 1.1, now, 0.05);
    // locked: the growl smooths into a steady tone
    s.lfoG.gain.setTargetAtTime(locked ? 0.08 : 0.5, now, 0.06);
    s.lfo.frequency.setTargetAtTime(locked ? 40 : 18 + level * 10, now, 0.1);
    s.locked = locked;
    s.level = level;
  }

  ui(name) {
    if (!this.ctx) return;
    const r = this.direct({ level: LEVELS.ui, force: name === 'alarm' || name === 'warning' });
    if (!r) return;
    switch (name) {
      case 'click':
        this.noise(r, { dur: 0.012, freq: 3500, type: 'highpass', gain: 0.6, attack: 0.0005 });
        break;
      case 'switch':
        // the toggle snapping over, and its spring
        this.noise(r, { dur: 0.015, freq: 2400, q: 1.2, gain: 0.8, attack: 0.0005 });
        this.noise(r, { at: 0.018, dur: 0.02, freq: 1500, q: 1.5, gain: 0.5, attack: 0.0005 });
        this.tone(r, { at: 0.018, f0: 2900, dur: 0.05, gain: 0.08 });
        break;
      case 'button':
        this.noise(r, { dur: 0.03, freq: 600, q: 0.8, gain: 0.5, attack: 0.001 });
        this.tone(r, { at: 0.01, type: 'square', f0: 1000, dur: 0.06, gain: 0.12 });
        break;
      case 'alarm':
        for (let i = 0; i < 4; i++) {
          this.tone(r, { at: i * 0.5, type: 'square', f0: 720, dur: 0.24, gain: 0.25, attack: 0.01 });
          this.tone(r, { at: i * 0.5 + 0.25, type: 'square', f0: 960, dur: 0.24, gain: 0.25, attack: 0.01 });
        }
        break;
      case 'warning':
        for (let i = 0; i < 6; i++) this.tone(r, { at: i * 0.11, type: 'square', f0: 1650, dur: 0.07, gain: 0.25, attack: 0.002 });
        break;
      case 'lock':
        this.tone(r, { type: 'triangle', f0: 900, f1: 1400, sweep: 0.12, dur: 0.14, gain: 0.35 });
        this.tone(r, { at: 0.14, type: 'triangle', f0: 1400, dur: 0.22, gain: 0.3 });
        break;
      default:
        this.noise(r, { dur: 0.012, freq: 3000, type: 'highpass', gain: 0.4 });
    }
    this.finish(r);
  }

  // ------------------------------------------------------------------ music

  /** The game state: a sparse score plays in the briefing and the lulls, and fades in combat. */
  mood(state) {
    this.moodState = state;
  }

  updateMusic(now) {
    const calm = this.moodState !== 'wave' && this.combat < 0.3;
    this.music.gain.setTargetAtTime(calm ? this.musicVolume * 0.45 : this.musicVolume * 0.12, now, 1.5);
    if (now < this.nextPad) return;
    const chord = DRONES[this.padIndex++ % DRONES.length];
    const r = this.direct({ level: 0.16, bus: this.music, force: true });
    if (r) {
      for (const n of chord) {
        for (const det of [-3, 3]) this.tone(r, { type: 'triangle', f0: midi(n) * Math.pow(2, det / 1200), dur: 11, gain: 0.25, attack: 3 });
      }
      this.finish(r);
    }
    // now and then a bell note over the drone
    if (Math.random() < 0.6) {
      const b = this.direct({ level: 0.05, bus: this.music, force: true, at: 2 + Math.random() * 5 });
      if (b) {
        const f = midi(pick(BELLS));
        this.tone(b, { f0: f, dur: 4, gain: 0.5, attack: 0.004 });
        this.tone(b, { f0: f * 2.76, dur: 1.6, gain: 0.12, attack: 0.004 });
        this.finish(b);
      }
    }
    this.nextPad = now + 9;
  }

  // ------------------------------------------------------------------ per frame

  setListener(camera) {
    const L = this.ctx.listener;
    const p = camera.position;
    const e = camera.matrixWorld.elements;
    // forward is -Z of the camera, up is +Y
    const fx = -e[8], fy = -e[9], fz = -e[10], ux = e[4], uy = e[5], uz = e[6];
    if (L.positionX) {
      L.positionX.value = p.x;
      L.positionY.value = p.y;
      L.positionZ.value = p.z;
      L.forwardX.value = fx;
      L.forwardY.value = fy;
      L.forwardZ.value = fz;
      L.upX.value = ux;
      L.upY.value = uy;
      L.upZ.value = uz;
    } else {
      L.setPosition(p.x, p.y, p.z);
      L.setOrientation(fx, fy, fz, ux, uy, uz);
    }
    this.listenerPos.x = p.x;
    this.listenerPos.y = p.y;
    this.listenerPos.z = p.z;
  }

  update(dt, camera, { threats = [], timeScale = 1 } = {}) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    if (camera) this.setListener(camera);
    this.reap(now);
    this.land(now);
    this.flush(now);
    this.updateEngines(threats, now);
    this.updateGuns(now);
    // wind gusts
    this.gustT -= dt;
    if (this.gustT <= 0) {
      this.gustT = 2 + Math.random() * 6;
      this.gust = 0.6 + Math.random() * 0.9;
      this.windF.frequency.setTargetAtTime(350 + Math.random() * 500, now, 1.2);
    }
    this.windG.gain.setTargetAtTime(LEVELS.wind * this.gust, now, 1.5);
    // the battle rumble follows what could not be played
    this.bedG.gain.setTargetAtTime(Math.min(0.35, this.bedEnergy * 0.9 + this.combat * 0.06), now, 0.4);
    this.bedEnergy *= Math.exp(-dt * 1.2);
    this.combat *= Math.exp(-dt * 0.12);
    this.updateMusic(now);
    void timeScale;
  }
}
