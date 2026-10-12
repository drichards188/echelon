import * as THREE from 'three';

const $ = (id) => document.getElementById(id);
const CARDINALS = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' };
const COMPASS_W = 360;
const COMPASS_FOV = 130;
const _v = new THREE.Vector3();
const wrap = (a) => ((((a + 180) % 360) + 360) % 360) - 180;

// The overlay inside the left (3D) view: unit name, compass strip, radio log, wave and kill toasts,
// score, time compression, a target bracket and the end screen.
export class HUD {
  constructor() {
    this.compass = $('compass-strip');
    this.ticks = [];
    for (let d = 0; d < 360; d += 15) {
      const el = document.createElement('div');
      el.className = CARDINALS[d] ? 'tick major' : 'tick';
      el.textContent = CARDINALS[d] || '';
      this.compass.appendChild(el);
      this.ticks.push({ el, deg: d });
    }
    this.markers = [];
    this.toastTimer = null;
    this.radioLines = [];
    this.killEls = [];
    this.view = $('view');
  }

  setLoading(p, msg) {
    $('load-bar-fill').style.width = `${Math.round(p * 100)}%`;
    $('status').textContent = msg;
  }

  ready() {
    document.body.classList.add('ready');
    $('status').textContent = '';
  }

  showTitle(show) {
    document.body.classList.toggle('title', show);
  }

  /** The tutorial list over the title screen. */
  showTutorialMenu(show) {
    document.body.classList.toggle('tut-menu', show);
  }

  /** A tutorial is running: the instruction card is up, the score is hidden. */
  setTutorial(on) {
    document.body.classList.toggle('tutorial', on);
  }

  /** The unit the camera is on. */
  setUnit(name, callsign = '') {
    $('unit-name').textContent = name;
    $('unit-call').textContent = callsign ? `callsign ${callsign}` : '';
    const el = $('unit');
    el.classList.remove('flash');
    void el.offsetWidth;
    el.classList.add('flash');
  }

  setScore(s) {
    $('score').textContent = Math.round(s).toLocaleString('en-US');
  }

  /** Time compression indicator (1 = real time). */
  setTimeScale(k) {
    $('ts-val').textContent = `x${k < 1 ? k.toFixed(2).replace(/0$/, '') : k}`;
    $('ts-arrows').textContent = k < 1 ? '❚❚' : k === 1 ? '▶' : k <= 2 ? '▶▶' : '▶▶▶';
    $('timescale').classList.toggle('fast', k > 1);
    $('timescale').classList.toggle('slow', k < 1);
  }

  /** Wave title card. */
  toast(msg, sub = '', ms = 3600) {
    const el = $('toast');
    $('toast-main').textContent = msg;
    $('toast-sub').textContent = sub;
    el.style.animationDuration = `${ms}ms`;
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => el.classList.remove('show'), ms);
  }

  hint(msg, ms = 4000) {
    const el = $('hint');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(this.hintTimer);
    this.hintTimer = setTimeout(() => el.classList.remove('show'), ms);
  }

  /** A line in the radio log. kind: info | warn | alert | kill */
  radio(text, kind = 'info') {
    const log = $('radio');
    const el = document.createElement('div');
    el.className = `line ${kind}`;
    el.textContent = text;
    log.appendChild(el);
    this.radioLines.push({ el });
    while (this.radioLines.length > 4) this.radioLines.shift().el.remove();
    requestAnimationFrame(() => el.classList.add('in'));
    setTimeout(() => {
      el.remove();
      this.radioLines = this.radioLines.filter((l) => l.el !== el);
    }, 9500);
  }

  /** A kill toast: "text  +pts". Stacks briefly at the right. */
  kill(text, pts, assist = false) {
    const box = $('kills');
    const el = document.createElement('div');
    el.className = `kill${assist ? ' assist' : ''}`;
    el.innerHTML = '<span class="k-main"></span><b class="k-pts"></b>';
    el.querySelector('.k-main').textContent = text;
    el.querySelector('.k-pts').textContent = `+${pts}`;
    box.prepend(el);
    while (box.children.length > 4) box.lastChild.remove();
    setTimeout(() => el.remove(), 4200);
  }

  /** Compass strip: markers are { pos: {x, z}, kind: 'enemy' | 'friend' | 'unit', label }. */
  updateCompass(camera, markers = []) {
    const f = camera.getWorldDirection(_v);
    const heading = (Math.atan2(f.x, -f.z) * 180) / Math.PI;
    $('heading').textContent = String(Math.round((heading + 360) % 360)).padStart(3, '0');
    const px = COMPASS_W / COMPASS_FOV;
    for (const t of this.ticks) {
      const d = wrap(t.deg - heading);
      const vis = Math.abs(d) < COMPASS_FOV / 2;
      t.el.style.display = vis ? '' : 'none';
      if (vis) {
        t.el.style.transform = `translateX(${COMPASS_W / 2 + d * px}px)`;
        t.el.style.opacity = String(1 - Math.pow(Math.abs(d) / (COMPASS_FOV / 2), 3));
      }
    }
    while (this.markers.length < markers.length) {
      const el = document.createElement('div');
      el.className = 'marker';
      el.innerHTML = '<i></i><span></span>';
      this.compass.appendChild(el);
      this.markers.push(el);
    }
    this.markers.forEach((el, i) => {
      const m = markers[i];
      if (!m) {
        el.style.display = 'none';
        return;
      }
      const dx = m.pos.x - camera.position.x, dz = m.pos.z - camera.position.z;
      const bearing = (Math.atan2(dx, -dz) * 180) / Math.PI;
      const d = wrap(bearing - heading);
      const clamped = Math.max(-COMPASS_FOV / 2, Math.min(COMPASS_FOV / 2, d));
      el.style.display = '';
      el.style.transform = `translateX(${COMPASS_W / 2 + clamped * px}px)`;
      el.className = `marker ${m.kind || ''}${Math.abs(d) > COMPASS_FOV / 2 ? ' edge' : ''}`;
      el.querySelector('span').textContent = m.label || '';
    });
  }

  /** A bracket round a world point (the padlocked or selected track); null hides it. */
  bracket(camera, point, label = '') {
    const el = $('bracket');
    if (!point) {
      el.style.display = 'none';
      return;
    }
    _v.copy(point).project(camera);
    const w = this.view.clientWidth, h = this.view.clientHeight;
    let x = (_v.x * 0.5 + 0.5) * w, y = (-_v.y * 0.5 + 0.5) * h;
    const behind = _v.z > 1 || _v.z < -1;
    const off = behind || x < 0 || x > w || y < 0 || y > h;
    const d = camera.position.distanceTo(point);
    let size = THREE.MathUtils.clamp((60 * 400) / Math.max(d, 1), 22, 70);
    el.classList.toggle('off', off);
    if (off) {
      // pin a chevron to the edge in the direction of the track (flipped when it is behind the camera)
      let dx = x - w / 2, dy = y - h / 2;
      if (behind) (dx = -dx), (dy = -dy);
      const m = 34, hw = w / 2 - m, hh = h / 2 - m;
      const k = Math.min(hw / Math.max(Math.abs(dx), 1e-3), hh / Math.max(Math.abs(dy), 1e-3));
      x = w / 2 + dx * k;
      y = h / 2 + dy * k;
      el.style.setProperty('--a', `${(Math.atan2(dx, -dy) * 180) / Math.PI}deg`);
      size = 30;
    }
    el.style.display = 'block';
    el.style.transform = `translate(${x - size / 2}px, ${y - size / 2}px)`;
    el.style.width = el.style.height = `${size}px`;
    el.firstChild.textContent = label;
  }

  /** End screen. report: { title, sub, score, stats: [[label, value, small?]...], victory } */
  showEnd(r, { onRestart } = {}) {
    $('end-title').textContent = r.title || 'Airbase held';
    $('end-sub').textContent = r.sub || '';
    const rows = r.stats || [['Score', (r.score ?? 0).toLocaleString('en-US')]];
    $('end-stats').innerHTML = rows.map(([k, v, s]) => `<div><span>${k}</span><b>${v}</b>${s ? `<small>${s}</small>` : ''}</div>`).join('');
    $('end').classList.toggle('victory', !!r.victory);
    $('end-restart').onclick = onRestart || null;
    document.body.classList.add('ended');
  }

  hideEnd() {
    document.body.classList.remove('ended');
  }

  debug(text) {
    $('debug').textContent = text;
  }
}
