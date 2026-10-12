// Renders every synthesized sound bank offline and reports duration, peak, RMS and problems.
//   node tools/audiotest.mjs
import { bankTasks } from '../src/audio.js';

const make = (chans, sr) => ({ chans, sr });
const rows = [];
const keep = {}; // first buffer of every bank, for the analysis below
let bad = 0;
const t0 = performance.now();
for (const task of bankTasks(48000, make)) {
  if (!task) continue;
  const [group, key, fn] = task;
  const t = performance.now();
  const out = fn();
  const ms = performance.now() - t;
  for (const [i, b] of out.entries()) {
    let peak = 0, sum = 0, nan = 0, n = 0;
    for (const c of b.chans) for (let k = 0; k < c.length; k++) {
      const v = c[k];
      if (!Number.isFinite(v)) nan++;
      else {
        peak = Math.max(peak, Math.abs(v));
        sum += v * v;
        n++;
      }
    }
    const rms = Math.sqrt(sum / Math.max(n, 1));
    const issue = nan ? `NaN x${nan}` : peak < 0.05 ? 'SILENT' : peak > 1.0001 ? 'CLIPS' : '';
    if (issue) bad++;
    if (i === 0) keep[group + '.' + key] = b;
    if (i === 0 || issue) rows.push(`${(group + '.' + key + '[' + i + ']').padEnd(22)} ${(b.chans[0].length / b.sr).toFixed(2).padStart(6)} s  peak ${peak.toFixed(2)}  rms ${rms.toFixed(3)}  ${ms.toFixed(0).padStart(5)} ms ${issue}`);
  }
}
console.log(rows.join('\n'));

// ---- analysis of the guns and launches: rate of fire, envelope timing, spectral centroid
const mono = (b) => b.chans[0];
const env = (x, sr, win = 0.001) => {
  const w = Math.max(1, Math.round(win * sr)), n = Math.floor(x.length / w), e = new Float32Array(n);
  for (let k = 0; k < n; k++) {
    let m = 0;
    for (let i = 0; i < w; i++) m = Math.max(m, Math.abs(x[k * w + i]));
    e[k] = m;
  }
  return e;
};
/** Rounds a second: the strongest periodicity (6 to 25 ms) of the loop's smoothed, rectified envelope, by circular autocorrelation. */
const rate = (b) => {
  const x = mono(b), n = x.length, w = Math.round(0.0008 * b.sr), e = new Float32Array(n);
  let acc = 0;
  for (let i = 0; i < n + w; i++) {
    acc += Math.abs(x[i % n]) - (i >= w ? Math.abs(x[(i - w) % n]) : 0);
    if (i >= w) e[i - w] = acc / w;
  }
  let mean = 0;
  for (let i = 0; i < n; i++) mean += e[i];
  mean /= n;
  const lo = Math.round(0.006 * b.sr), hi = Math.round(0.025 * b.sr), cs = [];
  for (let lag = lo - 1; lag <= hi + 1; lag++) {
    let c = 0;
    for (let i = 0; i < n; i++) c += (e[i] - mean) * (e[(i + lag) % n] - mean);
    cs.push(c);
  }
  const best = Math.max(...cs);
  let bestLag = lo; // the shortest period that is a clear peak (the barrels' alternation adds weaker, longer ones)
  for (let k = 1; k < cs.length - 1; k++) if (cs[k] >= cs[k - 1] && cs[k] > cs[k + 1] && cs[k] >= 0.6 * best) { bestLag = lo - 1 + k; break; }
  return b.sr / bestLag;
};
const fft = (re, im) => {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) (([re[i], re[j]] = [re[j], re[i]]), ([im[i], im[j]] = [im[j], im[i]]));
  }
  for (let len = 2; len <= n; len <<= 1) {
    const a = (-2 * Math.PI) / len;
    for (let i = 0; i < n; i += len) for (let k = 0; k < len / 2; k++) {
      const c = Math.cos(a * k), s = Math.sin(a * k), u = i + k, v = i + k + len / 2;
      const tr = re[v] * c - im[v] * s, ti = re[v] * s + im[v] * c;
      re[v] = re[u] - tr; im[v] = im[u] - ti; re[u] += tr; im[u] += ti;
    }
  }
};
/** Spectral centroid (Hz) and the share of energy above 2 kHz, over the first 2^15 samples from `from` s. */
const spectrum = (b, from = 0) => {
  const n = 1 << 15, re = new Float64Array(n), im = new Float64Array(n), x = mono(b), i0 = Math.round(from * b.sr);
  for (let i = 0; i < n; i++) re[i] = (x[i0 + i] || 0) * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n));
  fft(re, im);
  let m = 0, mf = 0, hi = 0;
  for (let k = 1; k < n / 2; k++) {
    const p = re[k] * re[k] + im[k] * im[k], f = (k * b.sr) / n;
    m += p; mf += p * f; if (f > 2000) hi += p;
  }
  return { centroid: mf / m, hi: hi / m };
};
const db = (v) => (20 * Math.log10(Math.max(v, 1e-5))).toFixed(0);
console.log('\nGUN LOOPS (near band): rounds/s, centroid Hz, share above 2 kHz, loop s');
for (const key of ['gun.loop', 'gun_30t.loop', 'gun_23.loop']) {
  const b = keep[key];
  if (!b) continue;
  const sp = spectrum(b);
  console.log(`${key.padEnd(14)} ${rate(b).toFixed(1).padStart(6)} /s  centroid ${sp.centroid.toFixed(0).padStart(5)}  hi ${(sp.hi * 100).toFixed(0).padStart(3)}%  ${(mono(b).length / b.sr).toFixed(2)} s`);
}
console.log('\nLAUNCHES (near): attack to 90 % ms, peak at s, -20 dB at s, 100 ms envelope dB over the first 2 s, centroid Hz');
for (const key of ['launch_48N6.near', 'launch_9M96.near', 'launch_9M317.near', 'launch_9M338.near', 'launch_9M311.near']) {
  const b = keep[key];
  if (!b) continue;
  const e = env(mono(b), b.sr, 0.01), top = Math.max(...e), kp = e.indexOf(top);
  const k90 = e.findIndex((v) => v >= 0.9 * top);
  const smooth = []; // RMS-ish per 100 ms
  for (let t = 0; t < 2; t += 0.1) {
    let s2 = 0, c = 0;
    for (let i = Math.round(t * b.sr); i < Math.round((t + 0.1) * b.sr) && i < mono(b).length; i++) (s2 += mono(b)[i] ** 2, c++);
    smooth.push(db(Math.sqrt(s2 / Math.max(c, 1))));
  }
  const body = keep[key];
  let end = kp;
  const e2 = env(mono(b), b.sr, 0.1);
  const kb = e2.indexOf(Math.max(...e2));
  for (end = kb; end < e2.length && e2[end] > 0.1 * Math.max(...e2); end++);
  console.log(`${key.padEnd(18)} attack ${((k90 + 1) * 10).toString().padStart(4)} ms  peak ${(kp * 0.01).toFixed(2)}  -20dB at ${(end * 0.1).toFixed(1)}  [${smooth.join(' ')}]  centroid ${spectrum(body, 0.3).centroid.toFixed(0)}`);
}
console.log('\nIDLES: centroid Hz, rms');
for (const key of ['idle.v8', 'idle.genset', 'idle.trk_buk', 'idle.trk_tor', 'idle.trk_tun', 'idle.trk_shk']) {
  const b = keep[key];
  if (b) console.log(`${key.padEnd(14)} centroid ${spectrum(b).centroid.toFixed(0).padStart(5)}`);
}
console.log(`\n${bad ? bad + ' problem buffers' : 'all buffers sound'}, ${(performance.now() - t0).toFixed(0)} ms total`);
