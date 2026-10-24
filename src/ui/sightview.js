// The sight window: the integration draws the EO/IR picture into a fixed 640x400 canvas (panel.sightCanvas);
// this stacks the console's own overlay on top (reticle, seeker circle, lock box, scales) and turns drags
// into slew commands. Target positions are projected from unit and track positions against sight.az/el.
import { el, hw, DEG, wrapPi, fmtKm } from './widgets.js';

export const SIGHT_W = 640;
export const SIGHT_H = 400;
const OV = 1.5; // overlay backing scale

export function sightFov(st) {
  let f = (st && st.fov) || 0.12;
  if (f > 1.5) f *= DEG;
  return f;
}

// Compass azimuth and elevation (radians) and range of a world point as seen from the unit's sight.
export function aimTo(u, p) {
  const o = u.pos || { x: 0, y: 0, z: 0 };
  const dx = p.x - o.x, dz = p.z - o.z, dy = p.y - ((o.y || 0) + 3);
  const h = Math.hypot(dx, dz);
  return { az: Math.atan2(dx, -dz), el: Math.atan2(dy, h), range: Math.hypot(h, dy) };
}

function line2(c, pts, w, col) {
  // dark under-stroke then bright core, so a reticle reads on sky and ground alike
  c.lineJoin = 'round';
  c.strokeStyle = 'rgba(0,0,0,0.75)';
  c.lineWidth = w + 2.2;
  c.beginPath();
  for (const p of pts) { if (p.length === 2) c.lineTo(p[0], p[1]); else { c.moveTo(p[0], p[1]); } }
  c.stroke();
  c.strokeStyle = col;
  c.lineWidth = w;
  c.stroke();
}

export class SightView {
  // legend: the top line's captions [sight, by radar, by optics, km] in the console's language
  constructor({ canvas, kind = 'strela', onSlew, cls = '', overlay = null, legend = ['ОЭС', 'РЛС', 'ТВ/ТПВ', 'КМ'] }) {
    this.kind = kind;
    this.legend = legend;
    this.overlay = overlay; // optional (c, info, st, fov) drawn over the standard reticle
    this.el = el('div', `sightwrap ${kind} ${cls}`);
    this.base = canvas;
    canvas.className = 'sightcv';
    this.ov = document.createElement('canvas');
    this.ov.className = 'sightov';
    this.ov.width = SIGHT_W * OV;
    this.ov.height = SIGHT_H * OV;
    this.c = this.ov.getContext('2d');
    this.glass = el('div', 'sightglass');
    this.el.append(canvas, this.ov, this.glass);
    this.t = 0;
    this.acc = 1;
    this.seek = { x: 0, y: 0 };
    this.lockA = 0;
    this.onSlew = onSlew;
    this.dAz = 0;
    this.dEl = 0;
    this.info = { target: null, sx: 0, sy: 0 };
    let last = null;
    this.ov.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      last = [e.clientX, e.clientY];
      try { this.ov.setPointerCapture(e.pointerId); } catch (err) { /* synthetic */ }
      this.ov.classList.add('drag');
    });
    this.ov.addEventListener('pointermove', (e) => {
      if (!last) return;
      const r = this.ov.getBoundingClientRect();
      const fov = this.fov || 0.12;
      this.dAz += ((e.clientX - last[0]) / r.width) * fov;
      this.dEl -= ((e.clientY - last[1]) / r.height) * fov * (SIGHT_H / SIGHT_W);
      last = [e.clientX, e.clientY];
    });
    const end = () => { last = null; this.ov.classList.remove('drag'); };
    this.ov.addEventListener('pointerup', end);
    this.ov.addEventListener('pointercancel', end);
  }

  // send pending drag movement (called once per frame by the console)
  flush() {
    if ((this.dAz || this.dEl) && this.onSlew) { this.onSlew(this.dAz, this.dEl); this.dAz = this.dEl = 0; }
  }

  // u: unit; tracks: candidates; selId: selected track id. Returns { target, sx, sy } in sight pixels.
  update(dt, u, tracks, selId) {
    this.t += dt;
    this.acc += dt;
    const st = u.sight || {};
    const fov = sightFov(st);
    this.fov = fov;
    // project the candidates
    const fovV = fov * (SIGHT_H / SIGHT_W);
    let best = null, bd = 1e9;
    for (const t of tracks) {
      if (!t.pos) continue;
      const a = aimTo(u, t.pos);
      const dAz = wrapPi(a.az - (st.az || 0));
      const dEl = a.el - (st.el || 0);
      const sx = SIGHT_W / 2 + (dAz / fov) * SIGHT_W;
      const sy = SIGHT_H / 2 - (dEl / fovV) * SIGHT_H;
      const inView = Math.abs(dAz) < fov * 0.5 && Math.abs(dEl) < fovV * 0.5;
      // the unit's selected track wins, otherwise the one nearest the boresight
      const score = (t.id === selId ? -1e6 : 0) + dAz * dAz + dEl * dEl + (inView ? 0 : 1e3);
      if (score < bd) { bd = score; best = { t, sx, sy, inView, dAz, dEl, range: a.range }; }
    }
    this.info = best ? { target: best.t, sx: best.sx, sy: best.sy, inView: best.inView, dAz: best.dAz, dEl: best.dEl, range: best.range } : { target: null, inView: false };
    if (this.acc < 1 / 30) return this.info;
    const step = this.acc;
    this.acc = 0;
    if (this.kind === 'strela') this.drawStrela(step, u, st, fov);
    else this.drawPantsir(step, u, st, fov);
    if (this.overlay) this.overlay(this.c, this.info, st, fov, u);
    return this.info;
  }

  drawStrela(dt, u, st, fov) {
    const c = this.c;
    const W = SIGHT_W, H = SIGHT_H, cx = W / 2, cy = H / 2;
    c.setTransform(OV, 0, 0, OV, 0, 0);
    c.clearRect(0, 0, W, H);
    const info = this.info;
    const lock = st.lock || 0;
    const locked = lock > 0.85;
    // seeker circle: caged = boresight, uncaged = wandering, pulled toward the target by the tone
    let tx = 0, ty = 0;
    if (!st.uncaged) { tx = 0; ty = 0; }
    else {
      const tone = st.tone || 0;
      const wx = Math.sin(this.t * 1.7) * 46 + Math.sin(this.t * 4.3) * 12;
      const wy = Math.cos(this.t * 1.3) * 34 + Math.sin(this.t * 3.1) * 10;
      tx = wx * (1 - tone * 0.9);
      ty = wy * (1 - tone * 0.9);
      if (info.target && info.inView && (tone > 0.08 || lock > 0)) {
        const k = locked ? 1 : Math.min(1, tone * 1.2);
        tx = tx * (1 - k) + (info.sx - cx) * k;
        ty = ty * (1 - k) + (info.sy - cy) * k;
      }
    }
    const f = locked ? 1 : Math.min(1, dt * 7);
    this.seek.x += (tx - this.seek.x) * f;
    this.seek.y += (ty - this.seek.y) * f;
    this.lockA = locked ? 1 : 0;

    // optical mask
    c.fillStyle = '#030403';
    c.beginPath();
    c.rect(0, 0, W, H);
    c.arc(cx, cy, 198, 0, Math.PI * 2, true);
    c.fill();
    const rg = c.createRadialGradient(cx, cy, 140, cx, cy, 198);
    rg.addColorStop(0, 'rgba(0,0,0,0)');
    rg.addColorStop(1, 'rgba(0,0,0,0.55)');
    c.fillStyle = rg;
    c.beginPath(); c.arc(cx, cy, 198, 0, Math.PI * 2); c.fill();

    const col = '#ff7a3c';
    // outer ring and 9Sh127-style crosshair with stadia marks
    c.setLineDash([]);
    line2(c, [[cx - 150, cy], [cx - 22, cy]], 1.3, col);
    line2(c, [[cx + 22, cy], [cx + 150, cy]], 1.3, col);
    line2(c, [[cx, cy - 150], [cx, cy - 22]], 1.3, col);
    line2(c, [[cx, cy + 22], [cx, cy + 150]], 1.3, col);
    for (let i = 1; i <= 6; i++) {
      const d = 22 + i * 21;
      const l = i % 2 ? 4 : 7;
      line2(c, [[cx - d, cy - l], [cx - d, cy + l]], 1, col);
      line2(c, [[cx + d, cy - l], [cx + d, cy + l]], 1, col);
      line2(c, [[cx - l, cy + d], [cx + l, cy + d]], 1, col);
      if (i < 5) line2(c, [[cx - l, cy - d], [cx + l, cy - d]], 1, col);
    }
    // range stadia brackets (target of 10 m span) with km figures
    c.font = '600 11px "DejaVu Sans Mono", monospace';
    c.fillStyle = col;
    c.textAlign = 'left';
    for (let i = 0; i < 4; i++) {
      const y = cy - 70 + i * 46;
      const half = 34 - i * 6;
      line2(c, [[cx + 168 - half * 0.25, y], [cx + 168 + half * 0.25, y]], 1, col);
      c.fillText(String(i + 1), cx + 168 + half * 0.25 + 6, y + 4);
    }
    c.textAlign = 'right';
    c.fillText('КМ', cx + 190, cy - 86);
    // lead scale along the bottom
    for (let i = -3; i <= 3; i++) {
      if (!i) continue;
      const x = cx + i * 48;
      line2(c, [[x, cy + 84], [x, cy + 96]], 1, col);
      c.textAlign = 'center';
      c.fillText(String(Math.abs(i) * 100), x, cy + 112);
    }
    c.fillText('Δ м/с', cx, cy + 128);

    // seeker circle
    const sx = cx + this.seek.x, sy = cy + this.seek.y;
    const sc = locked ? (Math.floor(this.t * 6) % 2 ? '#ff3a28' : '#ffd0a0') : st.uncaged ? '#ffc23c' : '#9ad06a';
    c.setLineDash(st.uncaged ? [] : [5, 4]);
    line2(c, arcPts(sx, sy, 30), 1.6, sc);
    c.setLineDash([]);
    for (let a = 0; a < 4; a++) {
      const ca = (a * Math.PI) / 2 + Math.PI / 4;
      line2(c, [[sx + Math.cos(ca) * 30, sy + Math.sin(ca) * 30], [sx + Math.cos(ca) * 38, sy + Math.sin(ca) * 38]], 1.3, sc);
    }
    if (locked) {
      const q = 24;
      line2(c, [[sx - q, sy - q + 8], [sx - q, sy - q], [sx - q + 8, sy - q]], 1.8, sc);
      line2(c, [[sx + q - 8, sy - q], [sx + q, sy - q], [sx + q, sy - q + 8]], 1.8, sc);
      line2(c, [[sx + q, sy + q - 8], [sx + q, sy + q], [sx + q - 8, sy + q]], 1.8, sc);
      line2(c, [[sx - q + 8, sy + q], [sx - q, sy + q], [sx - q, sy + q - 8]], 1.8, sc);
    }
    // status text
    c.font = '700 12px "DejaVu Sans Mono", monospace';
    c.textAlign = 'left';
    c.fillStyle = '#ffb060';
    c.fillText(`АЗ ${(((st.az || 0) / DEG) % 360 + 360) % 360 < 100 ? '0' : ''}${((((st.az || 0) / DEG) % 360 + 360) % 360).toFixed(1)}`, 128, 62);
    c.fillText(`УМ ${((st.el || 0) / DEG).toFixed(1)}`, 128, 78);
    c.textAlign = 'right';
    c.fillStyle = st.uncaged ? '#ffc23c' : '#9ad06a';
    c.fillText(st.uncaged ? 'ГСН СВОБОДНА' : 'ГСН АРРЕТИРОВАНА', W - 128, 62);
    c.fillStyle = locked ? '#ff5a3c' : '#807060';
    c.fillText(locked ? 'ЗАХВАТ' : 'ПОИСК', W - 128, 78);
    // direction cue when a designated target is off screen
    if (info.target && !info.inView) this.edgeArrow(c, info, '#ffb060');
  }

  drawPantsir(dt, u, st, fov) {
    const c = this.c;
    const W = SIGHT_W, H = SIGHT_H, cx = W / 2, cy = H / 2;
    c.setTransform(OV, 0, 0, OV, 0, 0);
    c.clearRect(0, 0, W, H);
    const info = this.info;
    const lock = st.lock || 0;
    const locked = lock > 0.6;
    const col = locked ? '#7dffa0' : '#baffc8';
    const dim = 'rgba(150,255,180,0.55)';
    c.font = '600 11px "DejaVu Sans Mono", monospace';
    // frame brackets
    const m = 14, l = 34;
    for (const [x, y, sx, sy] of [[m, m, 1, 1], [W - m, m, -1, 1], [m, H - m, 1, -1], [W - m, H - m, -1, -1]]) {
      line2(c, [[x, y + l * sy], [x, y], [x + l * sx, y]], 1.6, col);
    }
    // centre cross with a gap
    line2(c, [[cx - 30, cy], [cx - 8, cy]], 1.3, col);
    line2(c, [[cx + 8, cy], [cx + 30, cy]], 1.3, col);
    line2(c, [[cx, cy - 30], [cx, cy - 8]], 1.3, col);
    line2(c, [[cx, cy + 8], [cx, cy + 30]], 1.3, col);
    // azimuth scale along the bottom, elevation scale on the right, both scrolling with the sight
    const azd = (st.az || 0) / DEG;
    const eld = (st.el || 0) / DEG;
    const pxPerDeg = (W / fov) * DEG;
    c.textAlign = 'center';
    c.fillStyle = dim;
    const a0 = Math.floor(azd - W / 2 / pxPerDeg);
    const step = pxPerDeg < 12 ? 5 : pxPerDeg < 40 ? 1 : 0.5;
    for (let a = Math.ceil(a0 / step) * step; a < azd + W / 2 / pxPerDeg; a += step) {
      const x = cx + (a - azd) * pxPerDeg;
      if (x < 60 || x > W - 60) continue;
      const major = Math.abs(a % (step * 5)) < 1e-6;
      line2(c, [[x, H - 34], [x, H - 34 - (major ? 12 : 6)]], 1, dim);
      if (major) c.fillText(String(((Math.round(a) % 360) + 360) % 360), x, H - 14);
    }
    const ppdv = pxPerDeg;
    c.textAlign = 'left';
    for (let e = Math.floor(eld - 14); e < eld + 14; e += step) {
      const y = cy - (e - eld) * ppdv;
      if (y < 60 || y > H - 60) continue;
      const major = Math.abs(e % (step * 5)) < 1e-6;
      line2(c, [[W - 34, y], [W - 34 - (major ? 12 : 6), y]], 1, dim);
      if (major) c.fillText(String(Math.round(e)), W - 30 + 0, y + 4);
    }
    line2(c, [[cx - 6, H - 34], [cx, H - 46], [cx + 6, H - 34], [cx - 6, H - 34]], 1.2, col);
    // top legend
    c.textAlign = 'left';
    c.fillStyle = col;
    const [lSight, lRadar, lOptic, lKm] = this.legend;
    c.fillText(`${lSight}  ${st.src === 'radar' ? lRadar : lOptic}`, 24, 30);
    c.textAlign = 'right';
    c.fillText(`${fmtKm(info.range)} ${lKm}`, W - 24, 30);
    c.textAlign = 'center';
    c.fillText(`${fovDeg(fov)}°`, cx, 30);
    // lock box on the designated target
    if (info.target && info.inView) {
      const x = info.sx, y = info.sy;
      const q = locked ? 22 : 30 + Math.sin(this.t * 8) * 3;
      const bc = locked ? '#7dffa0' : '#ffd24a';
      c.setLineDash(locked ? [] : [6, 4]);
      line2(c, [[x - q, y - q], [x + q, y - q], [x + q, y + q], [x - q, y + q], [x - q, y - q]], 1.6, bc);
      c.setLineDash([]);
      c.fillStyle = bc;
      c.textAlign = 'left';
      c.fillText(`${String(info.target.id).padStart(3, '0')} ${locked ? 'ЗАХВАТ' : 'СОПР'}`, x + q + 6, y - q + 10);
      c.fillText(`${fmtKm(info.range)} км`, x + q + 6, y - q + 24);
      line2(c, [[x - 4, y], [x + 4, y]], 1, bc);
      line2(c, [[x, y - 4], [x, y + 4]], 1, bc);
    } else if (info.target) this.edgeArrow(c, info, '#ffd24a');
  }

  edgeArrow(c, info, col) {
    const a = Math.atan2(-info.dEl * 8, info.dAz);
    const cx = SIGHT_W / 2, cy = SIGHT_H / 2;
    const x = cx + Math.cos(a) * 180, y = cy + Math.sin(a) * 120;
    c.save();
    c.translate(x, y);
    c.rotate(a);
    line2(c, [[-8, -8], [8, 0], [-8, 8], [-8, -8]], 1.6, col);
    c.restore();
  }
}

function arcPts(x, y, r) {
  const pts = [];
  for (let i = 0; i <= 32; i++) {
    const a = (i / 32) * Math.PI * 2;
    pts.push(i ? [x + Math.cos(a) * r, y + Math.sin(a) * r] : [x + r, y]);
  }
  return pts;
}

function fovDeg(f) { return (f / DEG).toFixed(1); }
