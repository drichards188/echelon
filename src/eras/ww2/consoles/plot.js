// The air picture at the gun position: a plotting board in the style of the aircraft reporting service's
// (Flugmeldedienst) glass boards with their grid (refs/ww2/battery 2.3: the Gefechtsstand's plotting board
// with the fighter grid): cream paper under the glass, a lettered grid of squares, north up, centred on the
// unit; the airfield (runway, buildings) and the other gun positions; the aircraft in red grease pencil,
// a symbol by class and a course stroke, its number beside it. Filled: this unit's own observers (or its
// Wuerzburg) hold it; hollow: only the reporting service's plot, by telephone through the Flak command post
// (sim/sensors.js plot, `source: 'link'`). The guns' reach is drawn round the position. Click a symbol to
// designate the aircraft (the console's `select`).
import { hw } from '../../../ui/widgets.js';
import { TAU, clamp, pad3, courseOf } from './kit.js';

const FONT = '"DejaVu Sans Condensed", "Liberation Sans Narrow", "Arial Narrow", sans-serif';
const RED = '#b3241a', INK = '#2a2620', BLUE = 'rgba(60,90,140,';

export class Plot44 {
  // size: css px (square); ranges: half-widths (m) the scale knob offers; reach: [m, ...] rings round the unit
  constructor({ size = 200, range = 20000, onPick }) {
    this.S = size;
    this.range = range;
    this.el = document.createElement('div');
    this.el.className = 'plot44';
    this.el.style.width = this.el.style.height = size + 'px';
    this.cv = document.createElement('canvas');
    this.cv.className = 'plotcv';
    this.el.append(this.cv);
    this.c = this.cv.getContext('2d');
    this.k = 0;
    this.acc = 1;
    this.pts = [];
    this.cv.addEventListener('pointerdown', (e) => {
      const r = this.cv.getBoundingClientRect();
      if (!r.width) return;
      const x = ((e.clientX - r.left) / r.width) * this.S, y = ((e.clientY - r.top) / r.height) * this.S;
      let best = null, bd = 16 * 16;
      for (const [id, px, py] of this.pts) {
        const d = (px - x) ** 2 + (py - y) ** 2;
        if (d < bd) {
          bd = d;
          best = id;
        }
      }
      if (best != null) {
        e.preventDefault();
        onPick?.(best);
      }
    });
  }

  setRange(m) {
    this.range = m;
  }

  resize() {
    const k = clamp(hw.scale * Math.min(window.devicePixelRatio || 1, 2), 1, 2.2);
    if (Math.abs(k - this.k) < 0.01) return;
    this.k = k;
    this.cv.width = this.cv.height = Math.round(this.S * k);
  }

  // u: the unit; tracks: its own and its link tracks; data: the panel's data (units, assets, picture);
  // reach: [[m, label]] rings round the unit's position
  update(dt, u, tracks, data, reach = []) {
    this.acc += dt;
    if (this.acc < 1 / 12) return;
    this.acc = 0;
    this.resize();
    const c = this.c, S = this.S, k = this.k, R = this.range;
    const cx = S / 2, cy = S / 2, sc = (S / 2 - 4) / R;
    const ox = u.pos.x, oz = u.pos.z;
    const X = (x) => cx + (x - ox) * sc, Y = (z) => cy + (z - oz) * sc;
    c.setTransform(k, 0, 0, k, 0, 0);
    // paper
    c.fillStyle = '#e4dcc0';
    c.fillRect(0, 0, S, S);
    // the grid: squares of a round size for the scale, lettered across and numbered down
    const sq = R > 30000 ? 10000 : R > 12000 ? 5000 : 2000;
    c.lineWidth = 0.6;
    c.strokeStyle = BLUE + '0.45)';
    c.font = `600 7px ${FONT}`;
    c.fillStyle = BLUE + '0.75)';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    const x0 = Math.floor((ox - R) / sq) * sq, z0 = Math.floor((oz - R) / sq) * sq;
    for (let x = x0, i = 0; x <= ox + R + sq; x += sq, i++) {
      const px = X(x);
      c.beginPath(); c.moveTo(px, 0); c.lineTo(px, S); c.stroke();
      const col = Math.round(x / sq) + 20;
      if (px + (sq * sc) / 2 < S - 4 && px > -sq * sc) c.fillText(String.fromCharCode(65 + (((col % 26) + 26) % 26)), px + (sq * sc) / 2, 5);
    }
    for (let z = z0; z <= oz + R + sq; z += sq) {
      const py = Y(z);
      c.beginPath(); c.moveTo(0, py); c.lineTo(S, py); c.stroke();
      const row = Math.round(z / sq) + 50;
      if (py + (sq * sc) / 2 < S - 4 && py > -sq * sc) c.fillText(String(((row % 99) + 99) % 99), 6, py + (sq * sc) / 2);
    }
    // the airfield: the runway and the defended buildings
    for (const a of data.assets || []) {
      if (a.kind === 'runway') {
        const b = ((a.bearing ?? 70) * Math.PI) / 180, L = (a.length ?? 2800) / 2;
        c.strokeStyle = a.alive === false ? 'rgba(80,70,60,0.5)' : '#5d5a52';
        c.lineWidth = Math.max(2, (a.width ?? 45) * sc);
        c.beginPath();
        c.moveTo(X(a.pos.x - Math.sin(b) * L), Y(a.pos.z + Math.cos(b) * L));
        c.lineTo(X(a.pos.x + Math.sin(b) * L), Y(a.pos.z - Math.cos(b) * L));
        c.stroke();
      } else {
        c.fillStyle = a.alive === false ? 'rgba(80,70,60,0.4)' : '#5d5a52';
        c.fillRect(X(a.pos.x) - 1.6, Y(a.pos.z) - 1.6, 3.2, 3.2);
      }
    }
    // the other gun positions, this one in the middle with its guns' reach
    c.textAlign = 'left';
    for (const o of data.units) {
      if (o.id === u.id) continue;
      const px = X(o.pos.x), py = Y(o.pos.z);
      if (px < -4 || px > S + 4 || py < -4 || py > S + 4) continue;
      c.strokeStyle = o.alive === false ? 'rgba(42,38,32,0.35)' : INK;
      c.lineWidth = 1;
      c.beginPath(); c.arc(px, py, 2.6, 0, TAU); c.stroke();
      c.fillStyle = INK;
      c.font = `600 6.5px ${FONT}`;
      c.fillText((o.callsign || o.id).slice(0, 1).toUpperCase(), px + 3.5, py + 3.5);
    }
    c.setLineDash([3, 3]);
    c.strokeStyle = 'rgba(42,38,32,0.55)';
    c.lineWidth = 0.8;
    c.font = `600 6.5px ${FONT}`;
    c.fillStyle = 'rgba(42,38,32,0.7)';
    reach.forEach(([m, lab], i) => {
      const r = m * sc;
      if (r < 3 || r > S) return;
      c.beginPath(); c.arc(cx, cy, r, 0, TAU); c.stroke();
      // the labels on alternate sides, so two rings close together stay readable
      const s = i % 2 ? -1 : 1;
      c.textAlign = s > 0 ? 'left' : 'right';
      if (lab) c.fillText(lab, cx + s * (r * 0.71 + 2), cy - r * 0.71 - 2);
    });
    c.textAlign = 'left';
    c.setLineDash([]);
    c.fillStyle = INK;
    c.beginPath(); c.arc(cx, cy, 3.4, 0, TAU); c.fill();
    c.strokeStyle = INK;
    c.lineWidth = 1;
    c.beginPath(); c.arc(cx, cy, 6, 0, TAU); c.stroke();
    // the aircraft
    this.pts.length = 0;
    const sel = u.selected;
    // a box of bombers is a cluster of symbols: one number for it (the nearest to the selection first)
    const used = [];
    const free = (x, y) => !used.some(([a, b]) => Math.abs(a - x) < 18 && Math.abs(b - y) < 9);
    const order = sel != null ? [...tracks.filter((t) => t.id === sel), ...tracks.filter((t) => t.id !== sel)] : tracks;
    for (const t of order) {
      if (t.cls === 'bomb' || t.cls === 'rocket') continue;
      const px = X(t.pos.x), py = Y(t.pos.z);
      if (px < -6 || px > S + 6 || py < -6 || py > S + 6) continue;
      this.pts.push([t.id, px, py]);
      const own = t.source !== 'link';
      if (t.cls === 'window') {
        // Window: a smudge of crosses, the radar's false echo
        c.strokeStyle = 'rgba(90,80,70,0.7)';
        c.lineWidth = 0.8;
        c.beginPath();
        for (const [dx, dy] of [[-2, -1], [2, 1], [0, 2.5]]) {
          c.moveTo(px + dx - 1.5, py + dy - 1.5); c.lineTo(px + dx + 1.5, py + dy + 1.5);
          c.moveTo(px + dx + 1.5, py + dy - 1.5); c.lineTo(px + dx - 1.5, py + dy + 1.5);
        }
        c.stroke();
        continue;
      }
      // the course stroke: where it will be in a minute (bombers) or half a minute (the rest)
      const lead = t.cls === 'bomber' ? 60 : 30;
      const v = Math.hypot(t.vel.x, t.vel.z);
      if (v > 5) {
        const a = courseOf(t);
        const L = clamp(v * lead * sc, 6, 40);
        c.strokeStyle = RED;
        c.lineWidth = 1;
        c.beginPath();
        c.moveTo(px, py);
        c.lineTo(px + Math.sin(a) * L, py - Math.cos(a) * L);
        c.stroke();
      }
      c.strokeStyle = RED;
      c.fillStyle = own ? RED : 'rgba(0,0,0,0)';
      c.lineWidth = 1.3;
      c.beginPath();
      const r = t.cls === 'bomber' ? 4 : 3.4;
      if (t.cls === 'bomber') c.rect(px - r, py - r, r * 2, r * 2);
      else if (t.cls === 'fighter') {
        c.moveTo(px, py - r * 1.2); c.lineTo(px + r, py + r * 0.8); c.lineTo(px - r, py + r * 0.8); c.closePath();
      } else c.arc(px, py, r, 0, TAU);
      if (own) c.fill();
      c.stroke();
      if (t.cls === 'unknown') {
        c.fillStyle = RED;
        c.font = `700 7px ${FONT}`;
        c.fillText('?', px + 4, py - 3);
      }
      if (t.id === sel || free(px, py)) {
        used.push([px, py]);
        c.fillStyle = RED;
        c.font = `700 7px ${FONT}`;
        c.fillText(pad3(t.id), px + 5, py + 7);
      }
      if (t.id === sel) {
        c.strokeStyle = INK;
        c.lineWidth = 1.2;
        const q = 8;
        c.beginPath();
        for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
          c.moveTo(px + sx * q, py + sy * (q - 3)); c.lineTo(px + sx * q, py + sy * q); c.lineTo(px + sx * (q - 3), py + sy * q);
        }
        c.stroke();
      }
    }
    // north arrow and the scale
    c.fillStyle = INK;
    c.font = `700 8px ${FONT}`;
    c.textAlign = 'center';
    c.fillText('N', S - 9, 13);
    c.beginPath(); c.moveTo(S - 9, 16); c.lineTo(S - 12, 24); c.lineTo(S - 6, 24); c.closePath(); c.fill();
    const bar = sq * sc;
    c.strokeStyle = INK;
    c.lineWidth = 1.2;
    c.beginPath(); c.moveTo(S - 8 - bar, S - 8); c.lineTo(S - 8, S - 8); c.stroke();
    c.font = `600 6.5px ${FONT}`;
    c.fillText(`${sq / 1000} km`, S - 8 - bar / 2, S - 12);
    // the glass over the board
    const gl = c.createLinearGradient(0, 0, S, S);
    gl.addColorStop(0, 'rgba(255,255,255,0.16)');
    gl.addColorStop(0.35, 'rgba(255,255,255,0)');
    c.fillStyle = gl;
    c.fillRect(0, 0, S, S);
  }
}
