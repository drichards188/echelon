// The WW2 era's crew voices: German callouts at the flak guns, with subtitles. The clips are Drumfire's (the sibling
// artillery game, `../threejs-drumfire`, docs/VOICES.md there): synthetic speech made offline, copied here as they are,
// only the ones a flak position can use (public/audio/voice-de/, indexed by its lines.json; credits in
// public/audio/CREDITS.md). No line was made for Echelon, so a flak fight's own moments (a kill, Window, the plot,
// guns E and F by name) have none. Page code only (DOM and Web Audio): it reads the sim and never changes it.
//
//   const voices = new CrewVoices({ audio, view, panel, radio, selectedId, active });
//   voices.load();                      while the page loads: fetch and decode every clip (offline contexts, no click needed)
//   await voices.ready();               the loading screen's wait
//   voices.attach(sim);                 chain onto sim.events (after main has wired its own handlers)
//   voices.update(sim);                 every frame: the watchers (targets, barrage, hold, platoons opening fire) and the queues
//   voices.toggle(); voices.enabled     on or off (B, the panel's VOICES button), remembered in localStorage echelon.voices
//
// Two speaker channels, each one line at a time: 'gun' (the battery officer, the gun commander and the loader of the
// voiced gun, shouted in the open: spatialised through the AudioEngine's routing, with its travel delay and distance
// filtering) and 'tel' (the Abteilung on the field telephone: band-limited, key clicks, line noise). Only the selected
// unit's crew is voiced, and the calls to every gun (the air raid warning, the raid's end). Queue rules as Drumfire's:
// priorities, a maximum wait on the wall clock, a newer line of the same kind replacing a waiting one.
//
// What is said when (the heavy battery and the flak tower's heavy guns are the "battery", the light Züge "platoons"):
//   a raid (wave)                 "Fliegeralarm!"
//   bombs falling on the unit     "Volle Deckung!" / "Feindfeuer! Volle Deckung!"
//   strafing or rockets on it     "Tiefflieger! Volle Deckung!"
//   damage without a gun lost     "Sanitäter! Verwundeter am Geschütz!"
//   a gun knocked out             "Erstes (to Viertes) Geschütz ausgefallen!", else "Geschütz ausgefallen!"
//   battery: a new target         "Achtung! Neues Ziel! Granate, Zeitzünder!", the voiced gun's "Höhe und Seite richten!"
//   battery: the first salvo      "Batterie, Feuer!" (again after 20 s without one); a single gun "Geschütz, Feuer!"
//   battery: a barrage laid       "Sperrfeuer! Ganze Batterie, auf die Sperrfeuerlinie!" with the rounds a gun will fire
//                                 in it ("Zwo Salven!", "Acht Schuss!"), then "Sperrfeuer, Feuer frei!"
//   battery: Window, rangefinder  "Verbesserung! Neu richten!" (the range source changed)
//   battery: loaded after a fight "Erstes Geschütz feuerbereit!" (A to D; E and F "Geschütz feuerbereit!"),
//                                 "Batterie feuerbereit!" when every gun is
//   battery: the voiced gun       one loading call a cycle in turn, at most one every 12 s ("Verschluss auf!", "Granate
//                                 kommt!", "Granate ansetzen!", "Verschluss zu!"; the tower's 12.8 cm "Granate am
//                                 Aufzug, hoch!", "Granate auf die Ladeschale!")
//   platoon: opening fire         the first two Züge "Erster Zug, Feuer!", "Zweiter Zug, Feuer!"; the others the gun
//                                 that opens ("Erstes Geschütz, Feuer!")
//   platoon on manual: new target "Achtung! Neues Ziel!"
//   HOLD after firing             "Batterie, halt! Feuer einstellen!"
//   the raid over (lull)          the Abteilung: "Ziel bekämpft, Auftrag ausgeführt, Feuer einstellen."
import './voices.css';
import * as THREE from 'three';
import { SYSTEMS, THREATS } from '../../sim/systems.js';

const BASE = `${import.meta.env?.BASE_URL ?? '/'}audio/voice-de/`;
const STORE = 'echelon.voices'; // localStorage: '0' off
const MAX_AGE = { 0: 2.5, 1: 6, 2: 8, 3: 10 }; // seconds a queued line may wait, by priority
const GAP = 0.07; // between the clips of one utterance
const AFTER = 0.25; // between utterances on a channel
const RATE = { gun: 22050, phone: 11025, radio: 11025 }; // decoded rates: the telephone lines are band-limited anyway
const REF = 45, LEVEL = 0.85; // a shout: full level within 45 m, falling off as 1/d beyond
const TAU = Math.PI * 2;
const now = () => performance.now() / 1000;
// the voiced heavy gun's loading calls, in turn, one a cycle: the step and where in the cycle it is said (1: when the
// round is in, the feed's 'round')
const DRILL = {
  '88mm': [['s_open', 0.05], ['s_shell', 0.3], ['s_ram', 0.7], ['s_close', 1]],
  '128mm': [['s_shell_hoist', 0.15], ['s_shell_tray', 0.45], ['s_ram', 0.75], ['s_close', 1]],
};
// the rounds a gun fires in a barrage, as the recorded counts say them (two or three are salvos)
const COUNTS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 15, 18];
const countLine = (n) => {
  if (n < 2) return null;
  const c = COUNTS.reduce((a, b) => (Math.abs(b - n) < Math.abs(a - n) ? b : a));
  return c <= 3 ? `f_s${c}` : `f_n${c}`;
};
const _v = new THREE.Vector3();

export class CrewVoices {
  constructor({ audio, view = null, panel = null, radio = null, selectedId = () => null, active = () => true } = {}) {
    this.audio = audio;
    this.radio = radio;
    this.selectedId = selectedId;
    this.active = active;
    this.lines = {};
    this.buffers = {};
    this.queue = { gun: [], tel: [] };
    this.busy = { gun: 0, tel: 0 };
    this.timer = { gun: 0, tel: 0 };
    this.playing = []; // telephone sources still sounding (stopped when the voices are switched off)
    this.cur = { gun: null, tel: null }; // the utterance each channel is speaking
    this.last = {};
    this.seen = new Map(); // unit id -> what the watchers saw last frame
    this.sel = null;
    this.raidFired = false; // a gun of ours fired during this raid (the Abteilung's call at its end)
    this.log = []; // [{ t, sim, ch, ids, de, en }] every utterance as it starts (the tests read it)
    this.fx = null;
    try { this.enabled = localStorage.getItem(STORE) !== '0'; } catch { this.enabled = true; }
    this.sub = view ? this.mountSubtitles(view) : null;
    this.btn = panel ? this.mountButton(panel) : null;
  }

  // ---------------------------------------------------------------- loading

  /** Fetch every clip and decode it with an offline context (no audio context or click needed), six at a time. */
  load() {
    return (this.loading ||= (async () => {
      try {
        const r = await fetch(`${BASE}lines.json`);
        if (!r.ok) return;
        this.lines = await r.json();
        const dec = {};
        const ctx = (rate) => (dec[rate] ||= new OfflineAudioContext(1, 1, rate));
        const ids = Object.keys(this.lines);
        let i = 0;
        const next = async () => {
          while (i < ids.length) {
            const id = ids[i++], line = this.lines[id];
            try {
              const res = await fetch(`${BASE}${line.file}`);
              if (res.ok) this.buffers[id] = await ctx(RATE[line.ch] ?? 22050).decodeAudioData(await res.arrayBuffer());
            } catch { /* a clip that fails is not spoken */ }
          }
        };
        await Promise.all(Array.from({ length: 6 }, next));
      } catch { /* no voice pack: the game plays without voices */ }
    })());
  }

  ready() {
    return this.load();
  }

  has(id) {
    return !!this.buffers[id];
  }

  // ---------------------------------------------------------------- the page

  mountSubtitles(view) {
    const box = document.createElement('div');
    box.id = 'voice-sub';
    const row = (cls) => {
      const el = document.createElement('div');
      el.className = `vs ${cls}`;
      box.append(el);
      return { el, t: 0 };
    };
    view.append(box);
    return { tel: row('tel'), gun: row('gun') };
  }

  mountButton(panel) {
    const b = document.createElement('button');
    b.id = 'voice-btn';
    b.type = 'button';
    b.title = 'Crew voices (B): the German callouts of the guns and the telephone, with subtitles';
    b.addEventListener('pointerdown', (e) => e.stopPropagation());
    b.addEventListener('click', () => { this.toggle(); this.audio?.ui?.('click'); });
    panel.append(b);
    this.btn = b;
    this.paintButton();
    return b;
  }

  paintButton() {
    if (!this.btn) return;
    this.btn.textContent = `VOICES ${this.enabled ? 'ON' : 'OFF'}`;
    this.btn.classList.toggle('off', !this.enabled);
  }

  toggle(on = !this.enabled) {
    this.enabled = on;
    try { localStorage.setItem(STORE, on ? '1' : '0'); } catch { /* this session only */ }
    if (!on) {
      this.queue.gun.length = this.queue.tel.length = 0;
      this.cut(this.cur.gun);
      for (const s of this.playing) try { s.stop(); } catch { /* ended */ }
      this.playing.length = 0;
      this.busy.gun = this.busy.tel = 0;
      for (const k of ['gun', 'tel']) this.sub?.[k].el.classList.remove('show');
    }
    this.paintButton();
    return on;
  }

  subtitle(ch, text, kind, seconds) {
    const row = this.sub?.[ch];
    if (!row) return;
    row.el.className = `vs ${ch} ${kind}`;
    row.el.replaceChildren();
    const de = document.createElement('b'), en = document.createElement('i');
    de.textContent = `«${text.de}»`;
    en.textContent = ` ${text.en}`;
    row.el.append(de, en);
    row.el.classList.add('show');
    clearTimeout(row.t);
    row.t = setTimeout(() => row.el.classList.remove('show'), (seconds + 1.2) * 1000);
  }

  // ---------------------------------------------------------------- the sim's events

  /** Chain onto the sim's events (call after main has wired its handlers: those it re-assigns would drop ours). */
  attach(sim) {
    this.sim = sim;
    const ev = sim.events;
    for (const name of ['wave', 'state', 'salvo', 'muzzle', 'feed', 'partDestroyed', 'unitDamaged', 'strafe', 'threatLaunch']) {
      const prev = ev[name];
      ev[name] = (...a) => {
        prev?.(...a);
        try {
          if (this.live()) this[`on_${name}`](...a);
        } catch (e) {
          console.warn(`voices ${name}: ${e.message}`);
        }
      };
    }
  }

  live() {
    const s = this.sim;
    return this.enabled && !!s && !s.attract && this.active() && Object.keys(this.lines).length > 0;
  }

  unit() {
    const id = this.selectedId();
    return id == null ? null : this.sim?.unitById.get(id) ?? null;
  }

  // a battery has a predictor (the 8.8 cm battery, the flak tower); its heavy guns are the parts of its heavy kind
  // (kept per battle: the parts do not change)
  heavy(u) {
    const s = this.state(u);
    return (s.heavy ??= u.predictor ? u.parts.map((p, i) => (p.kind === u.heavyKind ? i : -1)).filter((i) => i >= 0) : []);
  }

  // the gun whose crew speaks: the battery's lowest heavy gun standing
  voicedGun(u) {
    return this.heavy(u).find((i) => u.parts[i].alive) ?? -1;
  }

  // a gun's number in its unit (0 the first): the battery's heavy guns A to F, a platoon's guns in order; -1 for the
  // battery's own 2 cm and every part that is not a gun
  gunNo(u, i) {
    const p = u.parts[i];
    if (!p?.gun) return -1;
    if (u.predictor) return this.heavy(u).indexOf(i);
    return u.parts.filter((q) => q.gun).indexOf(p);
  }

  // which Zug a platoon is (0 the first of the battle's platoons): the first two have their own fire order
  zug(u) {
    return this.sim.units.filter((v) => SYSTEMS[v.kind].mounts === 'platoon').indexOf(u);
  }

  near(u, point, r) {
    return u.parts.some((p) => p.alive && Math.hypot(p.pos.x - point.x, p.pos.z - point.z) < r);
  }

  shoutAt(u, i = -1) {
    return (i >= 0 ? u.parts[i]?.pos : null) ?? u.pos;
  }

  on_wave() {
    const u = this.unit();
    this.raidFired = false;
    if (u?.alive) this.say(['al_air'], { ch: 'gun', priority: 3, key: 'alarm', pos: u.pos, unit: u.id });
  }

  on_state(s) {
    // the raid is over: the Abteilung stands the guns down, if they fought
    if (s === 'lull' && this.raidFired) this.say(['m_done'], { ch: 'tel', priority: 1, key: 'mdone' });
    if (s === 'lull' || s === 'victory' || s === 'defeat') this.raidFired = false;
  }

  on_salvo(u) {
    this.raidFired = true;
    if (u.id !== this.selectedId()) return;
    const s = this.state(u), pr = u.predictor, t = this.sim.time;
    this.drop('gun', (q) => q.unit === u.id && (q.key === 'ready' || q.key === 'step'));
    s.firedSince = true;
    if (pr?.barrage) {
      if (s.sperrSaid === pr.barrage) return;
      s.sperrSaid = pr.barrage;
      this.say(['f_sperr'], { ch: 'gun', pos: u.pos, unit: u.id, priority: 3, key: 'fire' });
      return;
    }
    if (s.fireTarget === pr?.target && t - (s.fireAt ?? -1e9) < 20) return;
    s.fireTarget = pr?.target;
    s.fireAt = t;
    // a new target's fire command still waiting goes out first, with the order
    const kdo = this.queue.gun.find((q) => q.unit === u.id && q.key === 'kdo');
    if (kdo) this.drop('gun', (q) => q === kdo);
    this.say(kdo ? [...kdo.ids, 'f_bty'] : ['f_bty'], { ch: 'gun', pos: u.pos, unit: u.id, priority: 3, key: 'fire' });
  }

  on_muzzle(u, i) {
    this.raidFired = true;
    if (u.id !== this.selectedId()) return;
    const s = this.state(u);
    if (u.predictor) {
      s.firedSince = true;
      // the voiced gun's loading: one call a cycle, in turn, at its moment in the reload just begun
      if (i !== this.voicedGun(u) || !this.throttle(`drill${u.id}`, 12)) return;
      const drill = DRILL[u.heavyShell];
      if (!drill) return;
      s.rot = ((s.rot ?? -1) + 1) % drill.length;
      const [id, k] = drill[s.rot], g = u.parts[i].gun;
      s.drill = { i, id, at: this.sim.time + k * (g.load ?? 0), onLoad: k >= 1 };
    }
  }

  on_feed(u, i, what) {
    if (what !== 'round' || u.id !== this.selectedId() || !u.predictor) return;
    const s = this.state(u);
    // the voiced gun's "Verschluss zu!" when its round is in
    if (s.drill?.onLoad && s.drill.i === i) {
      this.say([s.drill.id], { ch: 'gun', priority: 0, key: 'step', pos: this.shoutAt(u, i), unit: u.id });
      s.drill = null;
    }
    // after a fight, each gun reports as its round goes in (the whole battery's report follows in update)
    const n = this.gunNo(u, i);
    if (n < 0 || !s.firedSince || u.predictor.state !== 'idle') return;
    this.say([n < 4 ? `r_${n + 1}` : 'r_single'], { ch: 'gun', priority: 2, key: 'ready', pos: this.shoutAt(u, i), unit: u.id, hold: 0.4 });
  }

  on_partDestroyed(u, i) {
    if (u.id !== this.selectedId()) return;
    const n = this.gunNo(u, i);
    if (!u.parts[i]?.gun) return; // (the predictor or the Wuerzburg: no line for them)
    this.state(u).downAt = this.sim.time;
    this.say([n >= 0 && n < 4 ? `al_down_${n + 1}` : 'al_down'], { ch: 'gun', priority: 2, key: `down${i}`, pos: this.shoutAt(u, i), unit: u.id });
  }

  on_unitDamaged(u) {
    if (u.id !== this.selectedId() || !u.alive) return;
    const s = this.state(u), hp = s.hp ?? u.maxHp ?? u.hp;
    s.hp = u.hp;
    // a hit that cost men, not a gun (a gun knocked out has its own call)
    if (hp - u.hp < 5 || this.sim.time - (s.downAt ?? -1e9) < 2 || !this.throttle(`medic${u.id}`, 25)) return;
    this.say(['al_medic'], { ch: 'gun', priority: 2, key: 'medic', pos: u.pos, unit: u.id });
  }

  on_strafe(t, point) {
    const u = this.unit();
    if (!u?.alive || !this.near(u, point, 150) || !this.throttle('jabo', 20)) return;
    this.say(['al_jabo'], { ch: 'gun', priority: 3, key: 'alarm', pos: u.pos, unit: u.id });
  }

  on_threatLaunch(t) {
    const u = this.unit(), planes = this.sim.threatAI?.planes;
    if (!u?.alive || !planes) return;
    if (t.type === 'gpbomb') {
      // a bomb falling on the unit: where it will strike (the planes' own fall, without its drag error)
      const at = planes.bombImpact(t.pos, t.vel, _v, THREATS.gpbomb.c);
      if (!this.near(u, at, 350) || !this.throttle('cover', 20)) return;
      this.say([(this.last.cover2 = !this.last.cover2) ? 'al_cover2' : 'al_cover'], { ch: 'gun', priority: 3, key: 'alarm', pos: u.pos, unit: u.id });
    } else if (t.type === 'rp3') {
      if (!this.near(u, planes.rocketImpact(t, _v), 200) || !this.throttle('jabo', 20)) return;
      this.say(['al_jabo'], { ch: 'gun', priority: 3, key: 'alarm', pos: u.pos, unit: u.id });
    }
  }

  // ---------------------------------------------------------------- the watchers (every frame, the selected unit)

  state(u) {
    if (!u) return null;
    let s = this.seen.get(u.id);
    if (!s) this.seen.set(u.id, (s = {}));
    return s;
  }

  watch(u) {
    const s = this.state(u), sim = this.sim, at = { ch: 'gun', pos: u.pos, unit: u.id };
    const pr = u.predictor;
    const was = s.now;
    // a platoon's guns firing now, and when they last were before this frame
    const firing = !pr && u.parts.some((p) => p.alive && p.gun?.firing), quiet = sim.time - (s.lastFiring ?? -1e9);
    if (firing) s.lastFiring = sim.time;
    s.now = { mode: u.mode, target: pr?.target ?? null, barrage: pr?.barrage ?? null, ranging: pr?.ranging ?? null, single: pr?.lastSingle ?? null, selected: u.selected ?? null };
    if (!was) return;
    // cease fire: HOLD after the guns have been firing
    if (u.mode === 'hold' && was.mode !== 'hold' && (s.firedSince || quiet < 30)) this.say(['cease'], { ...at, priority: 2, key: 'cease' });
    if (pr) {
      // a new target held for a moment (the crew's pick can flicker): the fire command, the layers on the pointers
      if (pr.target != null && !pr.barrage && pr.target !== s.target) {
        if (s.cand !== pr.target) { s.cand = pr.target; s.candT = sim.time; }
        else if (sim.time - s.candT >= 1 && sim.threatById.get(pr.target)?.alive) {
          s.target = pr.target;
          this.say(['kdo_new', 'fz_time'], { ...at, priority: 1, key: 'kdo' });
          const vg = this.voicedGun(u);
          if (vg >= 0) this.say(['s_lay'], { ch: 'gun', priority: 0, key: 'lay', pos: this.shoutAt(u, vg), unit: u.id });
        }
      }
      // a barrage laid: the box and the rounds each gun will fire in it (the time it stands over the load time)
      if (pr.barrage && pr.barrage !== was.barrage) {
        const load = SYSTEMS[u.kind].guns[u.heavyKind]?.feed?.load ?? 4;
        const n = Math.round((pr.barrage.until - Math.max(sim.time, pr.barrage.from ?? sim.time)) / load);
        this.say(['kdo_sperr', countLine(n)].filter(Boolean), { ...at, priority: 1, key: 'kdo' });
      }
      // the range source changed (Window on the Wuerzburg, the rangefinder): new data at the guns
      if (pr.target != null && pr.ranging !== was.ranging && this.throttle(`verb${u.id}`, 10)) this.say(['kdo_verb'], { ...at, priority: 1, key: 'kdo' });
      // one gun fired on its own (manual)
      if (pr.lastSingle !== was.single && pr.lastSingle > 0) this.say(['f_single'], { ...at, priority: 3, key: 'fire' });
      // the voiced gun's loading call at its moment
      if (s.drill && !s.drill.onLoad && sim.time >= s.drill.at) {
        this.say([s.drill.id], { ch: 'gun', priority: 0, key: 'step', pos: this.shoutAt(u, s.drill.i), unit: u.id });
        s.drill = null;
      }
      // after a fight, the battery loaded and laid again: its report
      const heavy = this.heavy(u).filter((i) => u.parts[i].alive);
      if (s.firedSince && pr.state === 'idle' && heavy.length > 1 && heavy.every((i) => u.parts[i].gun.loaded)) {
        s.firedSince = false;
        s.target = null;
        this.drop('gun', (q) => q.unit === u.id && q.key === 'ready');
        this.say(['bty_ready'], { ...at, priority: 2, key: 'ready', hold: 0.4 });
      }
    } else {
      // a platoon opening fire after 12 s quiet: the Zug's order, or the gun's that opened
      if (firing && quiet >= 12) {
        const z = this.zug(u);
        let id = z === 0 ? 'f_zug1' : z === 1 ? 'f_zug2' : null;
        if (!id) {
          const p = u.parts.find((q) => q.alive && q.gun?.firing), n = p ? u.parts.filter((q) => q.gun).indexOf(p) : -1;
          id = n >= 0 && n < 4 ? `f_${n + 1}` : 'f_single';
        }
        this.say([id], { ...at, priority: 3, key: 'fire' });
      }
      // on manual every gun takes the selection: a new one is the platoon's new target
      if (u.mode === 'manual' && u.selected != null && u.selected !== was.selected && this.throttle(`kdo${u.id}`, 4)) this.say(['kdo_new'], { ...at, priority: 1, key: 'kdo' });
    }
  }

  update(sim) {
    this.sim ??= sim;
    if (!sim) return;
    // a new battle (the sim's clock went back): forget what the units were doing
    if (sim.time < (this.simT ?? 0)) { this.seen.clear(); this.raidFired = false; }
    this.simT = sim.time;
    const u = this.live() ? this.unit() : null;
    if (u?.alive) {
      // a unit newly selected starts from what it is doing, silently; the last one's lines still waiting go
      if (this.sel !== u.id) {
        this.sel = u.id;
        this.state(u).now = null;
        for (const ch of ['gun', 'tel']) this.drop(ch, (q) => q.unit != null && q.unit !== u.id);
      }
      this.watch(u);
    } else this.sel = null;
    if (!this.enabled) return;
    for (const ch of ['gun', 'tel']) if (now() >= this.busy[ch]) this.speakNext(ch);
  }

  // ---------------------------------------------------------------- the queues

  /** Queue an utterance: ids played back to back on a channel. opts: { ch, priority, key, pos (gun), unit, hold } */
  say(ids, { ch = 'tel', priority = 1, key = null, pos = null, unit = null, hold = 0 } = {}) {
    if (!this.live() || !ids.length || !ids.every((id) => this.lines[id])) return;
    const q = this.queue[ch], t = now();
    // a newer line of the same kind replaces one still waiting
    if (key) for (let i = q.length - 1; i >= 0; i--) if (q[i].key === key && (q[i].unit === unit || unit == null)) q.splice(i, 1);
    q.push({ ids, priority, key, pos: pos ? { x: pos.x, y: (pos.y ?? 0) + 1.7, z: pos.z } : null, unit, at: t, due: t + hold });
    q.sort((a, b) => b.priority - a.priority || a.at - b.at);
    if (q.length > 6) q.length = 6;
    // an order at the guns cuts a lesser callout short (the officer's "Feuer!" over the loader's "Verschluss zu!")
    const c = this.cur[ch];
    if (ch === 'gun' && priority >= 3 && c && c.priority < priority && t < this.busy.gun) {
      this.cut(c);
      this.busy.gun = 0;
      clearTimeout(this.timer.gun);
    }
    // spoken from update(), after the sim's step: the lines of one frame are ordered by priority before the first plays
  }

  // stop an utterance at the guns: still in the air (its sound travelling), or already sounding (a quick fade)
  cut(item) {
    if (!item) return;
    item.cancelled = true;
    if (item.log) item.log.cut = now();
    const c = this.audio?.ctx;
    if (item.out && c) {
      item.out.gain.setTargetAtTime(0, c.currentTime, 0.02);
      for (const s of item.sources) try { s.stop(c.currentTime + 0.1); } catch { /* ended */ }
    }
    this.sub?.gun.el.classList.remove('show');
  }

  drop(ch, fn) {
    const q = this.queue[ch];
    for (let i = q.length - 1; i >= 0; i--) if (fn(q[i])) q.splice(i, 1);
  }

  throttle(key, seconds) {
    const t = now();
    if (t - (this.last[key] ?? -1e9) < seconds) return false;
    this.last[key] = t;
    return true;
  }

  speakNext(ch) {
    const a = this.audio, t = now();
    if (!a?.ctx || !this.ensure() || t < this.busy[ch] - 0.01) return;
    const q = this.queue[ch];
    for (let i = q.length - 1; i >= 0; i--) if (t - q[i].at > MAX_AGE[q[i].priority]) q.splice(i, 1);
    while (q.length) {
      // the first line due (one held back a moment waits in its place)
      const k = q.findIndex((x) => t >= x.due);
      if (k < 0) return;
      const item = q.splice(k, 1)[0];
      const bufs = item.ids.map((id) => this.buffers[id]);
      if (bufs.some((b) => !b)) continue;
      const dur = bufs.reduce((s, b) => s + b.duration, 0) + GAP * (bufs.length - 1);
      const lines = item.ids.map((id) => this.lines[id]);
      const text = { de: lines.map((l) => l.de).join(' '), en: lines.map((l) => l.en).join(' ') };
      const kind = lines[0].ch;
      item.log = { t, sim: Math.round((this.sim?.time ?? 0) * 10) / 10, ch, ids: item.ids, de: text.de, en: text.en };
      this.log.push(item.log);
      if (this.log.length > 300) this.log.shift();
      this.cur[ch] = item;
      if (ch === 'gun') this.shout(item, bufs, text, dur);
      else this.phone(kind, bufs, text, dur, lines.some((l) => l.log));
      this.busy[ch] = t + dur + AFTER;
      clearTimeout(this.timer[ch]);
      // the next line follows as soon as this one ends, not on the next frame
      this.timer[ch] = setTimeout(() => this.speakNext(ch), (dur + AFTER) * 1000 + 5);
      return;
    }
  }

  // At the guns: a shout in the open, heard from where it is shouted, after its travel time, through the distance filters.
  shout(item, bufs, text, dur) {
    const a = this.audio, c = a.ctx;
    a.enqueue('voice', item.pos, REF, LEVEL, (p) => {
      if (item.cancelled) return;
      const r = a.route(p, { ref: REF, level: LEVEL, reverb: 0.22 });
      if (!r) return;
      item.out = r.out;
      item.sources = [];
      // a raised voice: little chest, a hard presence around 2 kHz, a touch of drive
      const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 150;
      const pk = c.createBiquadFilter(); pk.type = 'peaking'; pk.frequency.value = 2100; pk.Q.value = 0.9; pk.gain.value = 4;
      const sh = c.createWaveShaper(); sh.curve = this.fx.shout;
      hp.connect(pk).connect(sh).connect(r.dest);
      r.nodes.push(hp, pk, sh);
      let t = r.t0;
      for (const b of bufs) {
        const s = c.createBufferSource();
        s.buffer = b;
        s.connect(hp);
        s.start(t);
        r.nodes.push(s);
        item.sources.push(s);
        t += b.duration + GAP;
      }
      r.end = t + 0.05;
      a.finish(r);
      this.subtitle('gun', text, 'gun', dur);
    });
  }

  // On the line: the field telephone at the player's ear, with its key clicks and its noise.
  phone(kind, bufs, text, dur, log) {
    const c = this.audio.ctx, chain = kind === 'radio' ? this.fx.radio : this.fx.phone;
    const at = c.currentTime + 0.06;
    this.click(chain, c.currentTime, 0.5);
    const hiss = c.createBufferSource(), hg = c.createGain();
    hiss.buffer = this.fx.hiss;
    hiss.loop = true;
    hg.gain.value = kind === 'radio' ? 0.035 : 0.012;
    hiss.connect(hg).connect(chain.input);
    hiss.start(c.currentTime, Math.random() * 0.8);
    let t = at;
    for (const b of bufs) {
      const s = c.createBufferSource();
      s.buffer = b;
      s.connect(chain.input);
      s.start(t);
      this.playing.push(s);
      s.onended = () => { s.disconnect(); const k = this.playing.indexOf(s); if (k >= 0) this.playing.splice(k, 1); };
      t += b.duration + GAP;
    }
    hiss.stop(t + 0.04);
    hiss.onended = () => { hiss.disconnect(); hg.disconnect(); const k = this.playing.indexOf(hiss); if (k >= 0) this.playing.splice(k, 1); };
    this.click(chain, t + 0.02, 0.35);
    this.playing.push(hiss);
    this.subtitle('tel', text, kind, dur);
    // (the HUD's radio log has the plain kinds)
    if (log) this.radio?.(`«${text.de}» ${text.en}`, 'info');
  }

  click(chain, when, level) {
    const c = this.audio.ctx, s = c.createBufferSource(), g = c.createGain();
    s.buffer = this.fx.click;
    g.gain.value = level;
    s.connect(g).connect(chain.input);
    s.start(when);
    s.onended = () => { s.disconnect(); g.disconnect(); };
  }

  // the field telephone (and the radio, unused here): band-limited, a little overdriven; the radio narrower, noisier
  // and fading
  ensure() {
    if (this.fx) return true;
    const c = this.audio?.ctx;
    if (!c || !this.audio.uiBus) return false;
    const chain = ({ lo, hi, f, gain, k, level, fade }) => {
      const input = c.createGain();
      let n = input;
      for (const [type, freq, q, g] of [['highpass', lo, 0.7], ['highpass', lo, 0.7], ['peaking', f, 1.1, gain], ['shaper'], ['lowpass', hi, 0.7], ['lowpass', hi, 0.7]]) {
        let node;
        if (type === 'shaper') { node = c.createWaveShaper(); node.curve = shaper(k); node.oversample = '2x'; }
        else { node = c.createBiquadFilter(); node.type = type; node.frequency.value = freq; node.Q.value = q; if (g) node.gain.value = g; }
        n.connect(node);
        n = node;
      }
      const out = c.createGain();
      out.gain.value = level;
      if (fade) {
        // the radio's slow fading: the level breathes by a few dB
        const lfo = c.createOscillator(), depth = c.createGain();
        lfo.frequency.value = 0.55;
        depth.gain.value = level * 0.18;
        lfo.connect(depth).connect(out.gain);
        lfo.start();
      }
      n.connect(out).connect(this.audio.uiBus);
      return { input, out };
    };
    const rate = c.sampleRate;
    const render = (seconds, fn) => {
      const n = Math.floor(rate * seconds), b = c.createBuffer(1, n, rate), d = b.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = fn(i / rate);
      return b;
    };
    this.fx = {
      phone: chain({ lo: 320, hi: 3300, f: 1800, gain: 5, k: 2.2, level: 0.55 }),
      radio: chain({ lo: 420, hi: 2700, f: 1500, gain: 4, k: 3, level: 0.5, fade: true }),
      shout: shaper(1.4),
      // the handset's key: a sharp tick and a short thump of the line
      click: render(0.06, (t) => (t < 0.003 ? (Math.random() * 2 - 1) : 0) * 0.7 + Math.sin(TAU * 180 * t) * Math.exp(-t * 90) * 0.3),
      // line noise with a crackle in it
      hiss: render(1.2, () => (Math.random() * 2 - 1) * 0.5 + (Math.random() < 0.0008 ? (Math.random() * 2 - 1) * 3 : 0)),
    };
    return true;
  }
}

function shaper(k) {
  const n = 1024, curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.tanh(k * x) / Math.tanh(k);
  }
  return curve;
}
