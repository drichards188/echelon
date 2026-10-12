// CRT scopes drawn with canvas 2D: a north-up PPI with range rings, bearing scale, a rotating sweep that
// paints blips into a decaying phosphor buffer (afterglow) plus bloom and glass; and an A-scope.
// Track positions come from the unit's own tracks (range m, bearing deg, vel m/s), the sweep from
// unit.radar.sweep (radians, clockwise from north).
import { el, hw, DEG, fmtKm } from './widgets.js';

const TAU = Math.PI * 2;

const THEMES = {
  green: {
    fg: [96, 255, 134], bg0: '#07290f', bg1: '#010a03', ring: 'rgba(80,235,120,0.30)', text: 'rgba(130,255,165,0.80)',
    cls: { aircraft: [96, 255, 134], cruise: [255, 224, 96], drone: [176, 255, 140], arm: [255, 100, 68], tbm: [255, 100, 68], helo: [120, 245, 235], bomb: [255, 164, 96], unknown: [150, 185, 150] },
  },
  amber: {
    fg: [255, 186, 64], bg0: '#2a1704', bg1: '#0c0600', ring: 'rgba(255,170,50,0.30)', text: 'rgba(255,200,110,0.82)',
    cls: { aircraft: [255, 186, 64], cruise: [255, 224, 120], drone: [255, 210, 110], arm: [255, 96, 64], tbm: [255, 96, 64], helo: [255, 196, 96], bomb: [255, 150, 70], unknown: [200, 160, 100] },
  },
};
const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

function symbol(c, cls, x, y, r) {
  c.beginPath();
  switch (cls) {
    case 'cruise': c.moveTo(x, y - r); c.lineTo(x + r, y + r * 0.8); c.lineTo(x - r, y + r * 0.8); c.closePath(); c.stroke(); break;
    case 'drone': c.rect(x - r * 0.7, y - r * 0.7, r * 1.4, r * 1.4); c.stroke(); break;
    case 'arm': c.moveTo(x - r, y - r * 0.8); c.lineTo(x + r, y - r * 0.8); c.lineTo(x, y + r); c.closePath(); c.fill(); break;
    case 'tbm': c.moveTo(x, y - r * 1.3); c.lineTo(x + r * 1.1, y); c.lineTo(x, y + r * 1.3); c.lineTo(x - r * 1.1, y); c.closePath(); c.fill(); break;
    case 'helo': c.arc(x, y, r, 0, TAU); c.moveTo(x - r, y); c.lineTo(x + r, y); c.moveTo(x, y - r); c.lineTo(x, y + r); c.stroke(); break;
    case 'bomb': c.moveTo(x - r, y - r); c.lineTo(x + r, y + r); c.moveTo(x + r, y - r); c.lineTo(x - r, y + r); c.stroke(); break;
    case 'unknown': c.rect(x - r, y - r, r * 2, r * 2); c.setLineDash([2, 2]); c.stroke(); c.setLineDash([]); break;
    default: c.arc(x, y, r, 0, TAU); c.stroke();
  }
}

function makeCanvas() { return document.createElement('canvas'); }

export class Scope {
  // size: CSS pixels (square). fused: draw computer symbols with velocity leaders (S-400), else raw blips.
  constructor({ size = 420, range = 100000, rings = 4, theme = 'green', fused = false, period = 5, leaders = true, title = '' } = {}) {
    this.S = size;
    this.range = range;
    this.rings = rings;
    this.T = THEMES[theme];
    this.fused = fused;
    this.period = period;
    this.leaders = leaders;
    this.title = title;
    this.el = el('div', `scope ${theme}`);
    this.el.style.width = this.el.style.height = size + 'px';
    this.canvas = makeCanvas();
    this.canvas.className = 'scv';
    this.el.append(this.canvas);
    this.ctx = this.canvas.getContext('2d');
    this.P = makeCanvas();
    this.pc = this.P.getContext('2d');
    this.G = makeCanvas();
    this.gc = this.G.getContext('2d');
    this.glow = makeCanvas();
    this.gl = this.glow.getContext('2d');
    this.k = 0;
    this.gridKey = '';
    this.sw = 0;
    this.acc = 1;
    this.fade = 0;
    this.t = 0;
    this.primed = false;
    this.pos = [];
    this.R = size / 2 - 22;
    this.cx = this.cy = size / 2;
  }

  setRange(m) { if (m !== this.range) { this.range = m; this.gridKey = ''; this.primed = false; } }

  // closest track under a pointer, in scope pixels
  pick(clientX, clientY) {
    const r = this.canvas.getBoundingClientRect();
    if (!r.width) return null;
    const x = ((clientX - r.left) / r.width) * this.S;
    const y = ((clientY - r.top) / r.height) * this.S;
    let best = null;
    let bd = 18 * 18;
    for (const p of this.pos) {
      const d = (p[1] - x) ** 2 + (p[2] - y) ** 2;
      if (d < bd) { bd = d; best = p[0]; }
    }
    return best;
  }

  resize() {
    const k = Math.max(1, Math.min(hw.scale * Math.min(window.devicePixelRatio || 1, 2), 1.6));
    if (Math.abs(k - this.k) < 0.01) return;
    this.k = k;
    const w = Math.round(this.S * k);
    for (const c of [this.canvas, this.P, this.G]) { c.width = c.height = w; }
    this.glow.width = this.glow.height = Math.max(8, Math.round(w / 4));
    this.gridKey = '';
    this.primed = false;
  }

  drawGrid() {
    const key = `${this.range}|${this.k}|${this.rings}`;
    if (key === this.gridKey) return;
    this.gridKey = key;
    const c = this.gc;
    const { S, cx, cy, R, T } = this;
    c.setTransform(this.k, 0, 0, this.k, 0, 0);
    c.clearRect(0, 0, S, S);
    c.lineWidth = 1;
    c.strokeStyle = T.ring;
    // range rings
    for (let i = 1; i <= this.rings; i++) {
      c.beginPath();
      c.arc(cx, cy, (R * i) / this.rings, 0, TAU);
      c.stroke();
    }
    // radials every 30 degrees, faint
    c.strokeStyle = rgba(T.fg, 0.12);
    for (let b = 0; b < 360; b += 30) {
      const a = b * DEG;
      c.beginPath();
      c.moveTo(cx + Math.sin(a) * R * 0.06, cy - Math.cos(a) * R * 0.06);
      c.lineTo(cx + Math.sin(a) * R, cy - Math.cos(a) * R);
      c.stroke();
    }
    // outer bearing scale
    c.strokeStyle = rgba(T.fg, 0.55);
    c.fillStyle = T.text;
    c.font = '600 10px "DejaVu Sans Mono", monospace';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.beginPath();
    c.arc(cx, cy, R, 0, TAU);
    c.stroke();
    for (let b = 0; b < 360; b += 5) {
      const a = b * DEG;
      const len = b % 30 === 0 ? 9 : b % 10 === 0 ? 6 : 3;
      c.beginPath();
      c.moveTo(cx + Math.sin(a) * R, cy - Math.cos(a) * R);
      c.lineTo(cx + Math.sin(a) * (R + len), cy - Math.cos(a) * (R + len));
      c.stroke();
      if (b % 30 === 0) c.fillText(b === 0 ? 'N' : String(b / 10).padStart(2, '0'), cx + Math.sin(a) * (R + 17), cy - Math.cos(a) * (R + 17));
    }
    // ring labels in km
    c.textAlign = 'left';
    c.fillStyle = rgba(T.fg, 0.7);
    for (let i = 1; i <= this.rings; i++) {
      const km = (this.range * i) / this.rings / 1000;
      const a = 135 * DEG;
      c.fillText(String(Math.round(km * 10) / 10), cx + Math.sin(a) * (R * i) / this.rings + 3, cy - Math.cos(a) * (R * i) / this.rings + 9);
    }
    // centre mark
    c.strokeStyle = rgba(T.fg, 0.5);
    c.beginPath();
    c.moveTo(cx - 4, cy); c.lineTo(cx + 4, cy); c.moveTo(cx, cy - 4); c.lineTo(cx, cy + 4);
    c.stroke();
  }

  xy(t) {
    if (t.range > this.range) return null;
    const r = (t.range / this.range) * this.R;
    const b = t.bearing * DEG;
    return [this.cx + Math.sin(b) * r, this.cy - Math.cos(b) * r];
  }

  blip(t, bright) {
    const p = this.xy(t);
    if (!p) return;
    const c = this.pc;
    const col = this.T.cls[t.cls] || this.T.fg;
    const size = t.cls === 'tbm' ? 3.2 : t.cls === 'cruise' || t.cls === 'arm' ? 2 : t.cls === 'drone' ? 1.7 : 2.6;
    const jx = (Math.random() - 0.5) * 1.2;
    const jy = (Math.random() - 0.5) * 1.2;
    c.globalCompositeOperation = 'lighter';
    c.fillStyle = rgba(col, 0.28 * bright);
    c.beginPath(); c.arc(p[0] + jx, p[1] + jy, size + 2.5, 0, TAU); c.fill();
    c.fillStyle = rgba(col, 0.95 * bright);
    c.beginPath(); c.arc(p[0] + jx, p[1] + jy, size, 0, TAU); c.fill();
    c.globalCompositeOperation = 'source-over';
  }

  // u: unit, view: { tracks, selected, engaged:Set }
  update(dt, u, view) {
    this.t += dt;
    this.acc += dt;
    this.fade += dt;
    const radar = u.radar || {};
    const on = radar.search !== false;
    let sw = this.sw;
    if (on) sw = radar.sweep != null && isFinite(radar.sweep) ? radar.sweep : this.sw + (TAU * dt) / this.period;
    if (this.acc < 1 / 30) return;
    const step = this.acc;
    this.acc = 0;
    this.resize();
    this.drawGrid();
    const { S, cx, cy, R, T, pc, ctx: c } = this;
    const k = this.k;
    const tracks = view.tracks || [];

    // phosphor decay in coarse steps (8-bit alpha would leave ghosts with tiny per-frame fades)
    pc.setTransform(k, 0, 0, k, 0, 0);
    if (this.fade >= 0.1) {
      pc.globalCompositeOperation = 'destination-out';
      pc.fillStyle = `rgba(0,0,0,${1 - Math.exp(-this.fade / (this.period * 0.55))})`;
      pc.fillRect(0, 0, S, S);
      pc.globalCompositeOperation = 'source-over';
      this.fade = 0;
    }
    if (on) {
      const a0 = this.sw;
      let da = (((sw - a0) % TAU) + TAU) % TAU;
      if (da > Math.PI) da = 0.02;
      // trailing beam wedge
      const wedge = Math.max(da, 0.02);
      pc.fillStyle = rgba(T.fg, 0.055);
      pc.beginPath();
      pc.moveTo(cx, cy);
      pc.arc(cx, cy, R, a0 - Math.PI / 2, a0 - Math.PI / 2 + wedge);
      pc.closePath();
      pc.fill();
      // ground clutter and receiver noise inside the wedge
      for (let i = 0; i < 7; i++) {
        const a = a0 + Math.random() * wedge;
        const r = R * Math.pow(Math.random(), i < 4 ? 2.4 : 1.1);
        pc.fillStyle = rgba(T.fg, 0.10 + Math.random() * 0.22);
        pc.fillRect(cx + Math.sin(a) * r, cy - Math.cos(a) * r, 1.2, 1.2);
      }
      // blips of whatever the beam crossed
      if (!this.primed) {
        this.primed = true;
        for (const t of tracks) this.blip(t, 0.55);
      } else {
        for (const t of tracks) {
          const rel = (((t.bearing * DEG - a0) % TAU) + TAU) % TAU;
          if (rel <= da) this.blip(t, 1);
        }
      }
    }
    this.sw = sw;

    // composite
    c.setTransform(k, 0, 0, k, 0, 0);
    c.globalCompositeOperation = 'source-over';
    c.clearRect(0, 0, S, S);
    c.save();
    c.beginPath();
    c.arc(cx, cy, S / 2 - 2, 0, TAU);
    c.clip();
    const g = c.createRadialGradient(cx, cy, 0, cx, cy, S / 2);
    g.addColorStop(0, T.bg0);
    g.addColorStop(1, T.bg1);
    c.fillStyle = g;
    c.fillRect(0, 0, S, S);
    c.drawImage(this.G, 0, 0, S, S);
    c.globalCompositeOperation = 'lighter';
    c.drawImage(this.P, 0, 0, S, S);
    // bloom: a quarter-resolution copy stretched back up is a cheap blur
    const gl = this.gl;
    gl.clearRect(0, 0, this.glow.width, this.glow.height);
    gl.drawImage(this.P, 0, 0, this.glow.width, this.glow.height);
    c.globalAlpha = 0.9;
    c.drawImage(this.glow, 0, 0, S, S);
    c.globalAlpha = 1;
    c.globalCompositeOperation = 'source-over';

    // computer symbology, selection and engagement marks
    this.pos.length = 0;
    const stale = on ? 1 : 0.3;
    c.lineWidth = 1.3;
    for (const t of tracks) {
      const p = this.xy(t);
      if (!p) continue;
      this.pos.push([t.id, p[0], p[1]]);
      const col = T.cls[t.cls] || T.fg;
      const hostile = t.iff !== 'unknown';
      if (this.fused) {
        c.strokeStyle = rgba(col, (hostile ? 0.95 : 0.6) * stale);
        c.fillStyle = rgba(col, 0.9 * stale);
        symbol(c, t.cls, p[0], p[1], t.cls === 'drone' ? 3.6 : 4.6);
        if (this.leaders && t.vel) {
          const lx = (t.vel.x * 40) / this.range * R;
          const ly = (t.vel.z * 40) / this.range * R;
          const len = Math.hypot(lx, ly);
          if (len > 2) {
            const m = Math.min(1, 44 / len);
            c.strokeStyle = rgba(col, 0.55 * stale);
            c.beginPath(); c.moveTo(p[0], p[1]); c.lineTo(p[0] + lx * m, p[1] + ly * m); c.stroke();
          }
        }
      }
      const eng = view.engaged && view.engaged.has(t.id);
      if (eng) {
        c.strokeStyle = `rgba(255,190,60,${0.65 + 0.35 * Math.sin(this.t * 9)})`;
        c.setLineDash([3, 3]);
        c.beginPath(); c.arc(p[0], p[1], 9, 0, TAU); c.stroke();
        c.setLineDash([]);
        c.strokeStyle = 'rgba(255,190,60,0.28)';
        c.beginPath(); c.moveTo(cx, cy); c.lineTo(p[0], p[1]); c.stroke();
      }
      if (t.id === view.selected) {
        c.strokeStyle = '#fff6c8';
        c.lineWidth = 1.6;
        const q = 11;
        c.beginPath();
        c.moveTo(p[0] - q, p[1] - q + 5); c.lineTo(p[0] - q, p[1] - q); c.lineTo(p[0] - q + 5, p[1] - q);
        c.moveTo(p[0] + q - 5, p[1] - q); c.lineTo(p[0] + q, p[1] - q); c.lineTo(p[0] + q, p[1] - q + 5);
        c.moveTo(p[0] + q, p[1] + q - 5); c.lineTo(p[0] + q, p[1] + q); c.lineTo(p[0] + q - 5, p[1] + q);
        c.moveTo(p[0] - q + 5, p[1] + q); c.lineTo(p[0] - q, p[1] + q); c.lineTo(p[0] - q, p[1] + q - 5);
        c.stroke();
        c.lineWidth = 1.3;
        c.fillStyle = '#fff6c8';
        c.font = '600 10px "DejaVu Sans Mono", monospace';
        c.textAlign = p[0] > cx ? 'right' : 'left';
        c.fillText(String(t.id).padStart(3, '0'), p[0] + (p[0] > cx ? -q - 3 : q + 3), p[1] - q + 3);
      }
    }

    // sweep line
    if (on) {
      const sx = cx + Math.sin(sw) * R;
      const sy = cy - Math.cos(sw) * R;
      const lg = c.createLinearGradient(cx, cy, sx, sy);
      lg.addColorStop(0, rgba(T.fg, 0.15));
      lg.addColorStop(1, rgba(T.fg, 0.95));
      c.strokeStyle = lg;
      c.lineWidth = 1.6;
      c.shadowColor = rgba(T.fg, 1);
      c.shadowBlur = 7;
      c.beginPath(); c.moveTo(cx, cy); c.lineTo(sx, sy); c.stroke();
      c.shadowBlur = 0;
    }

    // legends
    c.font = '600 10px "DejaVu Sans Mono", monospace';
    c.textAlign = 'left';
    c.fillStyle = T.text;
    c.fillText(`${this.title}${fmtKm(this.range)} КМ`, 14, 18);
    c.textAlign = 'right';
    c.fillText(`ЦЕЛЕЙ ${tracks.length}`, S - 14, 18);
    if (!on) {
      c.fillStyle = 'rgba(0,0,0,0.5)';
      c.fillRect(0, 0, S, S);
      if (Math.floor(this.t * 2) % 2 === 0) {
        c.textAlign = 'center';
        c.fillStyle = '#ff6a4a';
        c.font = '700 14px "DejaVu Sans Condensed", sans-serif';
        c.fillText('ИЗЛУЧЕНИЕ ОТКЛЮЧЕНО', cx, cy - 4);
        c.font = '600 10px "DejaVu Sans Mono", monospace';
        c.fillText('NO EMISSION: SCOPE BLIND', cx, cy + 12);
      }
    }
    c.restore();
    void step;
  }
}

// Range-amplitude trace of the tracking channel: noise floor, range strobe, and the target pulse.
export class AScope {
  constructor({ w = 360, h = 120, range = 30000, theme = 'amber' } = {}) {
    this.W = w; this.H = h; this.range = range;
    this.T = THEMES[theme];
    this.el = el('div', `scope ascope ${theme}`);
    this.el.style.width = w + 'px';
    this.el.style.height = h + 'px';
    this.canvas = makeCanvas();
    this.canvas.className = 'scv';
    this.el.append(this.canvas);
    this.ctx = this.canvas.getContext('2d');
    this.k = 0;
    this.acc = 1;
    this.t = 0;
    this.amp = 0;
  }
  // st: { on, target: range m | null, locked: bool, quality: 0..1 }
  update(dt, st) {
    this.t += dt;
    this.acc += dt;
    if (this.acc < 1 / 24) return;
    this.acc = 0;
    const k = Math.max(1, Math.min(hw.scale * Math.min(window.devicePixelRatio || 1, 2), 1.6));
    if (Math.abs(k - this.k) > 0.01) { this.k = k; this.canvas.width = Math.round(this.W * k); this.canvas.height = Math.round(this.H * k); }
    const c = this.ctx;
    const { W, H, T } = this;
    c.setTransform(this.k, 0, 0, this.k, 0, 0);
    // persistence: fade previous trace instead of clearing
    c.globalCompositeOperation = 'source-over';
    c.fillStyle = 'rgba(8,4,0,0.42)';
    c.fillRect(0, 0, W, H);
    // graticule
    c.strokeStyle = rgba(T.fg, 0.14);
    c.lineWidth = 1;
    c.beginPath();
    for (let i = 1; i < 10; i++) { c.moveTo((W * i) / 10, 0); c.lineTo((W * i) / 10, H); }
    for (let j = 1; j < 4; j++) { c.moveTo(0, (H * j) / 4); c.lineTo(W, (H * j) / 4); }
    c.stroke();
    c.fillStyle = rgba(T.fg, 0.6);
    c.font = '600 9px "DejaVu Sans Mono", monospace';
    c.textAlign = 'left';
    for (let i = 0; i <= 5; i++) c.fillText(String((this.range / 1000 / 5) * i), (W * i) / 5 + 3, H - 3);
    // trace
    const base = H * 0.82;
    const tgt = st.on && st.target != null ? st.target / this.range : -1;
    const want = st.on && tgt >= 0 && tgt <= 1 ? (st.locked ? 0.6 : 0.25) + 0.3 * (st.quality == null ? 0.6 : st.quality) : 0;
    this.amp += (want - this.amp) * Math.min(1, dt * 8);
    c.beginPath();
    c.strokeStyle = rgba(T.fg, 0.95);
    c.shadowColor = rgba(T.fg, 1);
    c.shadowBlur = 5;
    c.lineWidth = 1.4;
    const n = 180;
    for (let i = 0; i <= n; i++) {
      const x = (i / n) * W;
      const f = i / n;
      let y = base - (st.on ? Math.random() * 7 + Math.max(0, 14 * Math.exp(-f * 18)) * Math.random() : 1);
      if (this.amp > 0.01) {
        const d = (f - tgt) / 0.012;
        y -= this.amp * H * 0.7 * Math.exp(-d * d) * (0.88 + Math.random() * 0.2);
      }
      if (i) c.lineTo(x, y); else c.moveTo(x, y);
    }
    c.stroke();
    c.shadowBlur = 0;
    // range strobe
    if (st.on && tgt >= 0 && tgt <= 1) {
      c.strokeStyle = st.locked ? 'rgba(255,90,60,0.9)' : rgba(T.fg, 0.7);
      c.setLineDash([4, 3]);
      c.beginPath(); c.moveTo(tgt * W, 4); c.lineTo(tgt * W, H - 14); c.stroke();
      c.setLineDash([]);
    }
    if (!st.on) {
      c.fillStyle = rgba(T.fg, 0.55);
      c.font = '700 11px "DejaVu Sans Condensed", sans-serif';
      c.textAlign = 'center';
      c.fillText('СОПРОВОЖДЕНИЕ ОТКЛЮЧЕНО', W / 2, H / 2 - 8);
    }
  }
}
