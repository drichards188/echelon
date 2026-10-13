// The WW2 sight windows: the scene picture (main's SightRenderer, posed by the sight poses of
// consoles.js through sight.js registerSightPose) under the console's own overlay, after the instruments:
//   'kdo'    the Kommandogeraet 40's telescope (refs/ww2/battery 1: the 4 m rangefinder's 12x and 24x
//            eyepiece, the trackers' telescopes beside it): a round field, a fine graticule in mils, the
//            predictor's target bracketed; the battery's bursts show round the target in the picture.
//   'visier' the Flakvisier 38/40 (refs/ww2/flak38 10, refs/ww2/flakvierling 10): an electric computing
//            reflector sight on the gun. Through its tilted glass the layer sees the sky and a lit ring on
//            lit cross wires; the tachometer dynamos on the handwheels move the wires against the target's
//            course by the lead, so the layer keeps the aircraft in the ring and the guns point ahead of it.
//            The picture looks along the bore; the ring sits where the target should be (the bore minus the
//            fire control's lead), so the aircraft wanders round it by the layer's own error.
//   'dorn'   the Schwebedornvisier 43 of the 3.7 cm Flak 43 (refs/ww2/flak43 10): a small square backsight
//            near the eye and, in front of it on the pendulum, the floating pin. The sight setter turns the
//            pin along the aircraft's course and picks its colour by speed (blue 50 to 100 m/s, yellow 90
//            to 140, white 120 to 170, red 150 to 200); range marks at 1, 2 and 3 km (4 km on all but the
//            blue). The layer holds the aircraft on the mark for its range, flying along the pin toward the
//            centre, and the gun then points ahead of it by the lead.
// When no picture comes (the sight is not fed: main has no pose hook yet, or /ui.html), a plain sky and
// ground with the aircraft as marks is drawn instead, so the sight still shows its targets.
import { SHELLS, timeOfFlight } from '../../../ballistics.js';
import { el } from '../../../ui/widgets.js';
import { SIGHT_W, SIGHT_H } from '../../../ui/sightview.js';
import { SightCam, line2, TAU, DEG, clamp, dec, pad3, km } from './kit.js';

const W = SIGHT_W, H = SIGHT_H;
const OV = 1.5;
const FONT = '"DejaVu Sans Condensed", "Liberation Sans Narrow", "Arial Narrow", sans-serif';
const MONO = '"DejaVu Sans Mono", "Liberation Mono", monospace';

// the floating pin's colour by the target speed (m/s)
const PIN = [[95, '#4f8cff', 'BLAU'], [130, '#ffd23c', 'GELB'], [160, '#f4f1e6', 'WEISS'], [Infinity, '#ff4b38', 'ROT']];
export const pinOf = (speed) => PIN.find((p) => speed < p[0]);

const _a = [0, 0], _b = [0, 0], _m = [0, 0], _p = { x: 0, y: 0, z: 0 };

export class Sight44 {
  constructor({ canvas, style, onPick, cls = '' }) {
    this.style = style;
    this.el = el('div', `sightwrap sight44 s-${style} ${cls}`);
    this.base = canvas ?? document.createElement('canvas');
    if (!canvas) {
      this.base.width = W;
      this.base.height = H;
    }
    this.base.className = 'sightcv';
    this.ov = document.createElement('canvas');
    this.ov.className = 'sightov';
    this.ov.width = W * OV;
    this.ov.height = H * OV;
    this.c = this.ov.getContext('2d');
    this.glass = el('div', 'sightglass');
    this.el.append(this.base, this.ov, this.glass);
    this.cam = new SightCam(W, H);
    this.acc = 1;
    this.t = 0;
    this.pts = [];
    this.ov.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const r = this.ov.getBoundingClientRect();
      if (!r.width) return;
      const x = ((e.clientX - r.left) / r.width) * W, y = ((e.clientY - r.top) / r.height) * H;
      let best = null, bd = 26 * 26;
      for (const [id, px, py] of this.pts) {
        const d = (px - x) ** 2 + (py - y) ** 2;
        if (d < bd) {
          bd = d;
          best = id;
        }
      }
      if (best != null) onPick?.(best);
    });
  }

  // f: { eye, az, el, fov, tracks, target (track or null), aim (lead point or null), sel, mark, info: {...} }
  update(dt, f) {
    this.t += dt;
    this.acc += dt;
    if (this.acc < 1 / 30) return;
    this.acc = 0;
    const c = this.c;
    c.setTransform(OV, 0, 0, OV, 0, 0);
    c.clearRect(0, 0, W, H);
    if (!f) {
      this.dark(c, 'KEIN BILD', 'NO SIGHT');
      return;
    }
    const cam = this.cam.set(f.eye, f.az, f.el, f.fov);
    // the projected aircraft, for picking with a click
    this.pts.length = 0;
    for (const t of f.tracks) {
      if (cam.project(t.pos, _a) > 0 && _a[0] > -20 && _a[0] < W + 20 && _a[1] > -20 && _a[1] < H + 20) this.pts.push([t.id, _a[0], _a[1]]);
    }
    const fed = performance.now() - (this.base._fedAt ?? -1e9) < 1200;
    if (!fed) this.schematic(c, cam, f);
    if (this.style === 'kdo') this.drawKdo(c, cam, f);
    else if (this.style === 'dorn') this.drawDorn(c, cam, f);
    else this.drawVisier(c, cam, f);
  }

  dark(c, de, en) {
    c.fillStyle = '#080807';
    c.fillRect(0, 0, W, H);
    c.fillStyle = 'rgba(230,224,200,0.55)';
    c.font = `700 28px ${FONT}`;
    c.textAlign = 'center';
    c.fillText(de, W / 2, H / 2 - 4);
    c.font = `600 16px ${FONT}`;
    c.fillText(en, W / 2, H / 2 + 20);
  }

  // a plain picture when no rendered one comes: sky, the horizon, the ground, the aircraft as marks
  schematic(c, cam, f) {
    const hz = H / 2 + (cam.el / (cam.fov * (H / W))) * H;
    const sky = c.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#9fb0bd');
    sky.addColorStop(1, '#d9dcd6');
    c.fillStyle = sky;
    c.fillRect(0, 0, W, H);
    if (hz < H) {
      c.fillStyle = '#4b5243';
      c.fillRect(0, Math.max(0, hz), W, H - Math.max(0, hz));
      c.fillStyle = '#6d7464';
      c.fillRect(0, Math.max(0, hz) - 1, W, 3);
    }
    for (const t of f.tracks) {
      if (cam.project(t.pos, _a) <= 0) continue;
      const s = clamp((t.cls === 'bomber' ? 30 : 12) / Math.max(200, t.range) * cam.ppr, 1.5, 14);
      c.strokeStyle = '#1d1f1c';
      c.lineWidth = Math.max(1, s * 0.25);
      c.beginPath();
      c.moveTo(_a[0] - s, _a[1]); c.lineTo(_a[0] + s, _a[1]);
      c.moveTo(_a[0], _a[1] - s * 0.3); c.lineTo(_a[0], _a[1] + s * 0.5);
      c.stroke();
    }
  }

  // ---------------------------------------------------------------- the predictor's telescope
  drawKdo(c, cam, f) {
    const cx = W / 2, cy = H / 2, R = 186;
    // the round field and the dark eyepiece round it
    c.save();
    c.fillStyle = '#050505';
    c.beginPath();
    c.rect(0, 0, W, H);
    c.arc(cx, cy, R, 0, TAU, true);
    c.fill();
    const vg = c.createRadialGradient(cx, cy, R * 0.7, cx, cy, R);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,0.6)');
    c.fillStyle = vg;
    c.beginPath(); c.arc(cx, cy, R, 0, TAU); c.fill();
    c.restore();
    // the graticule: fine black lines with a gap, mil marks (1 mil = 1/6400 of a circle)
    const ink = 'rgba(12,12,10,0.85)';
    const mil = TAU / 6400;
    const pp = cam.ppr * mil;
    const step = pp * 5 < 9 ? 10 : 5;
    c.lineWidth = 1;
    c.strokeStyle = ink;
    c.beginPath();
    c.moveTo(cx - R, cy); c.lineTo(cx - 10, cy);
    c.moveTo(cx + 10, cy); c.lineTo(cx + R, cy);
    c.moveTo(cx, cy + 10); c.lineTo(cx, cy + R);
    c.stroke();
    c.beginPath();
    c.moveTo(cx, cy - R); c.lineTo(cx, cy - 10);
    c.lineWidth = 0.7;
    c.stroke();
    c.font = `600 12px ${MONO}`;
    c.fillStyle = ink;
    c.textAlign = 'center';
    for (let m = step; m * pp < R - 8; m += step) {
      const d = m * pp, big = m % (step * 2) === 0;
      const l = big ? 6 : 3.5;
      c.beginPath();
      c.moveTo(cx - d, cy - l); c.lineTo(cx - d, cy + l);
      c.moveTo(cx + d, cy - l); c.lineTo(cx + d, cy + l);
      c.moveTo(cx - l, cy + d); c.lineTo(cx + l, cy + d);
      c.moveTo(cx - l, cy - d); c.lineTo(cx + l, cy - d);
      c.lineWidth = 0.9;
      c.stroke();
      if (big) {
        c.fillText(String(m), cx + d, cy + 20);
        c.fillText(String(m), cx - d, cy + 20);
      }
    }
    // the predictor's target, bracketed (an aid: the trackers keep it on the cross)
    const t = f.target;
    if (t && cam.project(t.pos, _a) > 0) {
      const x = _a[0], y = _a[1];
      const inside = (x - cx) ** 2 + (y - cy) ** 2 < (R - 6) ** 2;
      if (inside) {
        const q = 14;
        const col = f.info.held ? 'rgba(20,20,16,0.85)' : 'rgba(150,40,20,0.85)';
        c.strokeStyle = col;
        c.lineWidth = 1.2;
        c.beginPath();
        for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
          c.moveTo(x + sx * q, y + sy * (q - 5)); c.lineTo(x + sx * q, y + sy * q); c.lineTo(x + sx * (q - 5), y + sy * q);
        }
        c.stroke();
        c.fillStyle = col;
        c.font = `700 14px ${MONO}`;
        c.textAlign = 'left';
        c.fillText(pad3(t.id), x + q + 4, y - q + 10);
      }
    }
    // the instrument's legends round the field
    const i = f.info;
    c.font = `700 17px ${FONT}`;
    c.fillStyle = 'rgba(232,226,200,0.9)';
    c.textAlign = 'left';
    c.fillText(`${i.mag}×`, 12, 24);
    c.font = `600 13px ${FONT}`;
    c.fillStyle = 'rgba(232,226,200,0.6)';
    c.fillText('KdO 40', 12, 42);
    c.textAlign = 'right';
    c.font = `700 16px ${MONO}`;
    c.fillStyle = 'rgba(232,226,200,0.9)';
    c.fillText(t ? `ZIEL ${pad3(t.id)}` : 'KEIN ZIEL', W - 12, 24);
    c.font = `700 14px ${MONO}`;
    c.fillText(`S ${pad3(Math.round(((cam.az / DEG) % 360 + 360) % 360))}°`, W - 12, 42);
    c.fillText(`H ${dec(cam.el / DEG, 1)}°`, W - 12, 59);
    c.textAlign = 'left';
    c.font = `700 15px ${MONO}`;
    c.fillText(`${i.range ? km(i.range) + ' km' : '-- km'}`, 12, H - 32);
    c.fillText(`Z ${i.fuze ? dec(i.fuze, 1) + ' s' : '--'}`, 12, H - 13);
    c.textAlign = 'right';
    c.fillStyle = i.stateCol;
    c.fillText(i.state, W - 12, H - 13);
    if (i.down) this.over(c, 'AUSGEFALLEN', 'PREDICTOR KNOCKED OUT');
  }

  over(c, de, en) {
    c.fillStyle = 'rgba(6,6,5,0.72)';
    c.fillRect(0, 0, W, H);
    c.fillStyle = '#ff6a4a';
    c.textAlign = 'center';
    c.font = `800 30px ${FONT}`;
    c.fillText(de, W / 2, H / 2);
    c.font = `600 16px ${FONT}`;
    c.fillText(en, W / 2, H / 2 + 24);
  }

  // where the sight says the target is: the bore minus the fire control's lead (the bore is the picture's
  // centre; the lead is the angle from the lead point to the target as the gun sees them, taken in angles
  // so a gun still swinging onto its target, far off the picture's axis, does not stretch it)
  leadMark(cam, f, out) {
    out[0] = W / 2;
    out[1] = H / 2;
    if (!f.target || !f.aim) return false;
    offset(cam, f.eye, f.target.pos, f.aim, out);
    return true;
  }

  // ---------------------------------------------------------------- Flakvisier 38 / 40
  drawVisier(c, cam, f) {
    const cx = W / 2, cy = H / 2;
    // the sight head round the tilted glass: dark housing, the glass a rounded oblong
    const gx = 62, gy = 22, gw = W - 124, gh = H - 44, rr = 46;
    c.save();
    c.fillStyle = 'rgba(16,17,15,0.88)';
    c.beginPath();
    c.rect(0, 0, W, H);
    roundRect(c, gx, gy, gw, gh, rr);
    c.fill('evenodd');
    c.strokeStyle = '#5b5e57';
    c.lineWidth = 3;
    c.beginPath(); roundRect(c, gx, gy, gw, gh, rr); c.stroke();
    c.strokeStyle = 'rgba(0,0,0,0.7)';
    c.lineWidth = 1;
    c.beginPath(); roundRect(c, gx - 3, gy - 3, gw + 6, gh + 6, rr + 3); c.stroke();
    // the glass's faint tint
    c.fillStyle = 'rgba(190,200,170,0.07)';
    c.beginPath(); roundRect(c, gx, gy, gw, gh, rr); c.fill();
    // screws on the frame
    c.fillStyle = '#7d7f77';
    for (const [x, y] of [[gx + 14, gy - 10], [gx + gw - 14, gy - 10], [gx + 14, gy + gh + 10], [gx + gw - 14, gy + gh + 10]]) {
      c.beginPath(); c.arc(x, y, 3, 0, TAU); c.fill();
    }
    c.restore();
    // the lit cross wires and the ring, moved by the computing sight against the target's course
    const m = _m;
    const has = this.leadMark(cam, f, m);
    const x = clamp(m[0], gx + 14, gx + gw - 14), y = clamp(m[1], gy + 14, gy + gh - 14);
    const lit = f.info.lamp !== false;
    const col = lit ? 'rgba(255,140,60,0.92)' : 'rgba(120,90,60,0.5)';
    const glow = lit ? 'rgba(255,120,40,0.25)' : null;
    c.save();
    c.beginPath(); roundRect(c, gx, gy, gw, gh, rr); c.clip();
    if (glow) {
      c.strokeStyle = glow;
      c.lineWidth = 5;
      c.beginPath();
      c.moveTo(gx, y); c.lineTo(gx + gw, y); c.moveTo(x, gy); c.lineTo(x, gy + gh);
      c.stroke();
    }
    c.strokeStyle = col;
    c.lineWidth = 1.2;
    c.beginPath();
    c.moveTo(gx, y); c.lineTo(x - 22, y); c.moveTo(x + 22, y); c.lineTo(gx + gw, y);
    c.moveTo(x, gy); c.lineTo(x, y - 22); c.moveTo(x, y + 22); c.lineTo(x, gy + gh);
    c.stroke();
    // the ring (its radius a fixed angle: about 25 mils) and the centre dot
    const ring = clamp(cam.ppr * 0.025, 14, 34);
    c.lineWidth = 1.6;
    c.beginPath(); c.arc(x, y, ring, 0, TAU); c.stroke();
    c.fillStyle = col;
    c.beginPath(); c.arc(x, y, 1.6, 0, TAU); c.fill();
    // the zero mark etched on the glass (the bore with no lead)
    c.strokeStyle = 'rgba(230,230,210,0.35)';
    c.lineWidth = 1;
    c.beginPath();
    c.moveTo(cx - 6, cy); c.lineTo(cx + 6, cy); c.moveTo(cx, cy - 6); c.lineTo(cx, cy + 6);
    c.stroke();
    c.restore();
    this.legends(c, f, !f.target ? '' : has ? 'VORHALT' : 'OHNE VORHALT', has);
    if (f.info.down) this.over(c, 'AUSGEFALLEN', 'GUN KNOCKED OUT');
    else if (f.target && !this.inView(cam, f.target)) this.arrow(c, cam, f.target, '#ffb060');
  }

  // ---------------------------------------------------------------- Schwebedornvisier 43
  drawDorn(c, cam, f) {
    const cx = W / 2, cy = H / 2;
    // the square backsight close to the eye: its frame dark and soft, the view round it dimmed
    const s = 150;
    c.save();
    c.fillStyle = 'rgba(10,10,9,0.5)';
    c.beginPath();
    c.rect(0, 0, W, H);
    c.rect(cx - s, cy - s, s * 2, s * 2);
    c.fill('evenodd');
    for (let k = 0; k < 4; k++) {
      c.strokeStyle = `rgba(20,21,19,${0.55 - k * 0.12})`;
      c.lineWidth = 16 - k * 3;
      c.strokeRect(cx - s - 6 + k, cy - s - 6 + k, (s + 6 - k) * 2, (s + 6 - k) * 2);
    }
    c.restore();
    // the pendulum's arm up to the pin holder, the holder at the centre
    line2(c, [[cx, H], [cx, cy + 9]], 3, '#2a2b27', 'rgba(0,0,0,0.4)');
    c.fillStyle = '#33342f';
    c.fillRect(cx - 6, cy - 3, 12, 12);
    c.strokeStyle = '#6e7067';
    c.lineWidth = 1;
    c.strokeRect(cx - 6, cy - 3, 12, 12);
    // the floating pin along the course, its range marks; the aircraft rides on the mark for its range
    const t = f.target;
    let pin = null;
    if (t && t.speed > 20) {
      pin = pinOf(t.speed);
      const shell = SHELLS[f.shell ?? '37mm'];
      const marks = [];
      for (const r of [1000, 2000, 3000, 4000]) {
        if (r === 4000 && pin[2] === 'BLAU') continue;
        const tof = timeOfFlight(shell, r);
        _p.x = t.pos.x + t.vel.x * tof;
        _p.y = t.pos.y + t.vel.y * tof;
        _p.z = t.pos.z + t.vel.z * tof;
        const m = [cx, cy, r];
        offset(cam, f.eye, t.pos, _p, m);
        marks.push(m);
      }
      if (marks.length) {
        const end = marks[marks.length - 1];
        const len = Math.hypot(end[0] - cx, end[1] - cy);
        const ux = len > 1 ? (end[0] - cx) / len : 0, uy = len > 1 ? (end[1] - cy) / len : -1;
        const tip = [cx + ux * (len + 14), cy + uy * (len + 14)];
        line2(c, [[cx, cy + 3], tip], 2, pin[1], 'rgba(0,0,0,0.65)');
        c.font = `700 14px ${MONO}`;
        c.fillStyle = pin[1];
        c.textAlign = 'center';
        for (const [mx, my, r] of marks) {
          const nx = -uy * 6, ny = ux * 6;
          line2(c, [[mx - nx, my - ny], [mx + nx, my + ny]], 1.6, pin[1], 'rgba(0,0,0,0.65)');
          c.fillText(String(r / 1000), mx + nx * 2.2, my + ny * 2.2 + 3);
        }
      }
    }
    this.legends(c, f, pin ? `DORN ${pin[2]}` : '', !!pin, pin?.[1]);
    if (f.info.down) this.over(c, 'AUSGEFALLEN', 'GUN KNOCKED OUT');
    else if (t && !this.inView(cam, t)) this.arrow(c, cam, t, '#ffb060');
  }

  legends(c, f, state, ok, col = null) {
    const i = f.info;
    c.font = `700 15px ${FONT}`;
    c.textAlign = 'left';
    c.fillStyle = 'rgba(236,230,206,0.92)';
    c.fillText(i.gun, 12, 19);
    c.textAlign = 'right';
    c.font = `700 15px ${MONO}`;
    const t = f.target;
    c.fillText(t ? `ZIEL ${pad3(t.id)}  ${km(t.range)} km` : 'KEIN ZIEL', W - 12, 19);
    c.fillStyle = col ?? (ok ? '#ffb060' : 'rgba(236,230,206,0.55)');
    c.font = `700 14px ${MONO}`;
    c.fillText(state, W - 12, 37);
    c.textAlign = 'left';
    c.font = `700 15px ${MONO}`;
    c.fillStyle = i.firing ? '#ff6a4a' : 'rgba(236,230,206,0.85)';
    c.fillText(i.line, 12, H - 10);
    c.textAlign = 'right';
    c.fillStyle = 'rgba(236,230,206,0.85)';
    c.fillText(i.tof ? `FLUGZEIT ${dec(i.tof, 1)} s` : '', W - 12, H - 10);
  }

  inView(cam, t) {
    return cam.project(t.pos, _a) > 0 && _a[0] > 0 && _a[0] < W && _a[1] > 0 && _a[1] < H;
  }

  // a cue at the edge toward a target outside the field
  arrow(c, cam, t, col) {
    const z = cam.project(t.pos, _a);
    let dx = _a[0] - W / 2, dy = _a[1] - H / 2;
    if (z <= 0) {
      dx = -dx;
      dy = -dy;
    }
    const a = Math.atan2(dy, dx);
    const x = W / 2 + Math.cos(a) * 170, y = H / 2 + Math.sin(a) * 150;
    c.save();
    c.translate(x, y);
    c.rotate(a);
    line2(c, [[-9, -8], [8, 0], [-9, 8], [-9, -8]], 1.8, col);
    c.restore();
  }
}

// the screen offset of point a from point b (both seen from eye), added to out: their difference in
// bearing (scaled by the cosine of the elevation) and in elevation, at the picture's pixels per radian
function offset(cam, eye, a, b, out) {
  const ax = a.x - eye.x, ay = a.y - eye.y, az = a.z - eye.z;
  const bx = b.x - eye.x, by = b.y - eye.y, bz = b.z - eye.z;
  const ea = Math.atan2(ay, Math.hypot(ax, az)), eb = Math.atan2(by, Math.hypot(bx, bz));
  let d = Math.atan2(ax, -az) - Math.atan2(bx, -bz);
  d = ((d + Math.PI) % TAU + TAU) % TAU - Math.PI;
  out[0] += d * Math.cos((ea + eb) / 2) * cam.ppr;
  out[1] -= (ea - eb) * cam.ppr;
  return out;
}

function roundRect(c, x, y, w, h, r) {
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}
