// The Wuerzburg D's range display (FuMG 62 D, refs/ww2/battery 3.1 and 3.5, photo battery_window_25): a
// round cathode-ray tube with a circular time base: the trace runs once round the circle for the set's
// range (here 40 km from the top, clockwise) and every echo in the dish's beam kicks it outward at its range.
// The range operator holds the marker on the predictor's target, and the strip under the tube is the fine
// range round that marker (+-1.5 km). Window (Dueppel) in the beam breaks the trace up into a crowd of
// spikes round the target's range, as in the photo: the range can no longer be read and the predictor's
// solution goes wrong (the WINDOW lamp), until the rangefinder takes over.
// Echoes: what the battery holds in its tracks (the sim's own Window echoes among them) inside the dish's
// beam (SYSTEMS radar.beam, about 6 degrees round where the dish points), at its game range for the echo's
// size; Window clutter grows with the predictor's `window` (0..1).
import { SYSTEMS } from '../../../sim/systems.js';
import { hw } from '../../../ui/widgets.js';
import { TAU, clamp, compassOf, dec, km } from './kit.js';

const FONT = '"DejaVu Sans Mono", "Liberation Mono", monospace';
const SPAN = 40000; // the circle's range (m)
const FINE = 1500; // the fine range strip's half-width (m)
const SIZE = { bomber: 1, fighter: 0.45, recon: 0.4, unknown: 0.6, window: 0.6 };

export class Wurzburg44 {
  constructor({ size = 168, strip = 30 }) {
    this.S = size;
    this.SH = strip;
    this.el = document.createElement('div');
    this.el.className = 'wz44';
    this.tube = document.createElement('div');
    this.tube.className = 'wztube';
    this.tube.style.width = this.tube.style.height = size + 'px';
    this.cv = document.createElement('canvas');
    this.cv.className = 'wzcv';
    this.tube.append(this.cv);
    this.fine = document.createElement('div');
    this.fine.className = 'wzfine';
    this.fine.style.width = size + 'px';
    this.fine.style.height = strip + 'px';
    this.fcv = document.createElement('canvas');
    this.fcv.className = 'wzcv';
    this.fine.append(this.fcv);
    this.el.append(this.tube, this.fine);
    this.c = this.cv.getContext('2d');
    this.fc = this.fcv.getContext('2d');
    this.k = 0;
    this.acc = 1;
    this.t = 0;
    this.seed = 1;
    this.echoes = [];
  }

  resize() {
    const k = clamp(hw.scale * Math.min(window.devicePixelRatio || 1, 2), 1, 2.2);
    if (Math.abs(k - this.k) < 0.01) return;
    this.k = k;
    this.cv.width = this.cv.height = Math.round(this.S * k);
    this.fcv.width = Math.round(this.S * k);
    this.fcv.height = Math.round(this.SH * k);
  }

  rnd() {
    this.seed = (this.seed * 16807) % 2147483647;
    return this.seed / 2147483647;
  }

  // the echoes in the dish's beam: [range, strength, isWindow]
  gather(u, tracks) {
    const out = this.echoes;
    out.length = 0;
    const i = u.parts.findIndex((p) => p.role === 'radar');
    const p = u.parts[i];
    if (!p?.alive || !u.radar?.track) return null;
    const R = SYSTEMS[u.kind].radar;
    const az = compassOf(u, p.turret), el = p.turret.el;
    const ce = Math.cos(el);
    const fx = Math.sin(az) * ce, fy = Math.sin(el), fz = -Math.cos(az) * ce;
    const beam = Math.cos(R.beam * 1.4);
    for (const t of tracks) {
      const dx = t.pos.x - p.pos.x, dy = t.pos.y - (p.pos.y + 4), dz = t.pos.z - p.pos.z;
      const d = Math.hypot(dx, dy, dz);
      if (d < 200 || (dx * fx + dy * fy + dz * fz) < d * beam) continue;
      const size = SIZE[t.cls] ?? 0.5;
      if (d > R.range * (0.35 + 0.65 * size)) continue;
      out.push([d, size, t.cls === 'window']);
    }
    return p;
  }

  // u: the battery; tracks: its tracks; pr: its predictor
  update(dt, u, tracks, pr) {
    this.t += dt;
    this.acc += dt;
    if (this.acc < 1 / 20) return;
    const step = this.acc;
    this.acc = 0;
    this.resize();
    const c = this.c, S = this.S, k = this.k;
    const cx = S / 2, cy = S / 2, R = S / 2 - 26;
    c.setTransform(k, 0, 0, k, 0, 0);
    // the phosphor fades (an afterglow), the scale ring is engraved on the bezel
    c.fillStyle = `rgba(2,6,3,${clamp(step * 9, 0.3, 1)})`;
    c.fillRect(0, 0, S, S);
    c.strokeStyle = 'rgba(120,200,140,0.35)';
    c.fillStyle = 'rgba(150,220,165,0.7)';
    c.font = `600 7.5px ${FONT}`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.lineWidth = 0.8;
    for (let m = 0; m < SPAN; m += 2500) {
      const a = (m / SPAN) * TAU - Math.PI / 2;
      const big = m % 5000 === 0;
      c.beginPath();
      c.moveTo(cx + Math.cos(a) * (R + 16), cy + Math.sin(a) * (R + 16));
      c.lineTo(cx + Math.cos(a) * (R + (big ? 21 : 18.5)), cy + Math.sin(a) * (R + (big ? 21 : 18.5)));
      c.stroke();
      if (big && m % 10000 === 0) c.fillText(String(m / 1000), cx + Math.cos(a) * (R + 11), cy + Math.sin(a) * (R + 11));
    }
    const p = this.gather(u, tracks);
    if (!p) {
      c.fillStyle = 'rgba(150,220,165,0.45)';
      c.font = `700 11px ${FONT}`;
      c.fillText('AUS', cx, cy - 6);
      c.font = `600 7px ${FONT}`;
      c.fillText(u.parts.find((q) => q.role === 'radar')?.alive === false ? 'AUSGEFALLEN' : 'RADAR OFF', cx, cy + 7);
      this.drawFine(null, pr, []);
      return;
    }
    const gate = pr?.source === 'radar' || pr?.ranging === 'radar' ? this.gateRange(u, p, pr) : null;
    const jam = pr?.window ?? 0;
    // the trace: a circle, kicked outward at each echo's range, grass along it, Window's crowd round the gate
    const N = 360;
    const kick = new Float32Array(N);
    for (let j = 0; j < N; j++) kick[j] = this.rnd() * 1.4;
    const at = (m) => Math.floor(((m % SPAN) / SPAN) * N);
    for (const [d, size, chaff] of this.echoes) {
      const j = at(d);
      const h = (chaff ? 5 : 8) + size * 9 + this.rnd() * 3;
      for (let q = -1; q <= 1; q++) kick[(j + q + N) % N] = Math.max(kick[(j + q + N) % N], h * (q ? 0.5 : 1));
    }
    if (jam > 0.02) {
      const g = gate ?? (this.echoes[0]?.[0] ?? 8000);
      const n = Math.round(jam * 40);
      for (let q = 0; q < n; q++) {
        const j = at(g + (this.rnd() - 0.4) * 7000 * (0.4 + jam));
        kick[j] = Math.max(kick[j], 3 + this.rnd() * 13 * jam);
      }
    }
    c.strokeStyle = 'rgba(140,255,170,0.95)';
    c.shadowColor = 'rgba(90,255,140,0.8)';
    c.shadowBlur = 4;
    c.lineWidth = 1.2;
    c.beginPath();
    for (let j = 0; j <= N; j++) {
      const a = (j / N) * TAU - Math.PI / 2;
      const r = R + kick[j % N];
      if (j === 0) c.moveTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
      else c.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    }
    c.stroke();
    c.shadowBlur = 0;
    // the range marker on the predictor's target
    if (gate != null) {
      const a = (gate / SPAN) * TAU - Math.PI / 2;
      c.strokeStyle = 'rgba(255,220,120,0.9)';
      c.lineWidth = 1.4;
      c.beginPath();
      c.moveTo(cx + Math.cos(a) * (R - 10), cy + Math.sin(a) * (R - 10));
      c.lineTo(cx + Math.cos(a) * (R - 3), cy + Math.sin(a) * (R - 3));
      c.stroke();
    }
    c.fillStyle = 'rgba(150,220,165,0.75)';
    c.font = `700 9px ${FONT}`;
    c.fillText(gate != null ? `${km(gate)} km` : '--', cx, cy - 4);
    c.font = `600 6.5px ${FONT}`;
    c.fillText(jam > 0.3 ? 'DÜPPEL' : 'ENTFERNUNG', cx, cy + 8);
    this.drawFine(gate, pr, this.echoes);
  }

  // the predictor's target's range from the dish (the marker), when it has one
  gateRange(u, p, pr) {
    if (pr.target == null) return null;
    const t = u.tracks.find((x) => x.id === pr.target);
    if (!t) return null;
    return Math.hypot(t.pos.x - p.pos.x, t.pos.y - p.pos.y, t.pos.z - p.pos.z);
  }

  drawFine(gate, pr, echoes) {
    const c = this.fc, S = this.S, H = this.SH, k = this.k;
    c.setTransform(k, 0, 0, k, 0, 0);
    c.fillStyle = 'rgba(2,6,3,0.75)';
    c.fillRect(0, 0, S, H);
    const base = H - 7;
    c.strokeStyle = 'rgba(120,200,140,0.3)';
    c.lineWidth = 0.7;
    c.beginPath();
    c.moveTo(S / 2, 2); c.lineTo(S / 2, H - 2);
    c.stroke();
    if (gate == null) {
      c.strokeStyle = 'rgba(140,255,170,0.5)';
      c.beginPath(); c.moveTo(4, base); c.lineTo(S - 4, base); c.stroke();
      return;
    }
    const X = (m) => S / 2 + ((m - gate) / FINE) * (S / 2 - 6);
    const h = new Float32Array(S);
    for (let x = 0; x < S; x++) h[x] = this.rnd() * 1.2;
    for (const [d, size, chaff] of echoes) {
      const x = Math.round(X(d));
      if (x < 2 || x > S - 3) continue;
      const a = (chaff ? 6 : 9) + size * 8;
      for (let q = -2; q <= 2; q++) h[x + q] = Math.max(h[x + q], a * (1 - Math.abs(q) * 0.3));
    }
    const jam = pr?.window ?? 0;
    for (let q = 0; q < jam * 30; q++) {
      const x = Math.floor(this.rnd() * S);
      h[x] = Math.max(h[x], 2 + this.rnd() * 14 * jam);
    }
    c.strokeStyle = 'rgba(140,255,170,0.95)';
    c.lineWidth = 1.1;
    c.beginPath();
    for (let x = 4; x < S - 4; x++) {
      if (x === 4) c.moveTo(x, base - h[x]);
      else c.lineTo(x, base - Math.min(h[x], base - 2));
    }
    c.stroke();
    c.fillStyle = 'rgba(150,220,165,0.6)';
    c.font = `600 6.5px ${FONT}`;
    c.textAlign = 'left';
    c.fillText(`-${dec(FINE / 1000, 1)}`, 3, 6);
    c.textAlign = 'right';
    c.fillText(`+${dec(FINE / 1000, 1)} km`, S - 3, 6);
  }
}
