import { ERA, THREAT_AXIS, WAVES } from '../deploy.js';
import { THREATS } from './systems.js';

// The battle: the era in play's waves (eras/<era>.js `waves`: groups of threats with their bearing
// offset from the threat axis, spawn range, delay and what they go for), lulls between them, win and loss.
// WAVES is deploy.js's live binding, exported here as before.
export { WAVES };

const BRIEF = 15;
// between raids (s): the reload jobs (30 to 120 s in SYSTEMS) start as the supply column arrives, so with
// this much quiet the scenes mostly play before the next raid's threats arrive and the slow serial reloads
// (the Buk's loader-launcher, the Strela's hand reload) are well along when it starts
const LULL = 40;

export class Director {
  constructor(sim) {
    this.sim = sim;
    this.reset();
  }

  reset() {
    this.state = 'brief';
    this.t = 0;
    this.wave = 0;
    this.pending = [];
    this.group = 1;
  }

  setState(s) {
    this.state = s;
    this.t = 0;
    this.sim.state = s;
    this.sim.events.state?.(s);
  }

  startWave() {
    const sim = this.sim;
    const w = WAVES[this.wave];
    sim.wave = this.wave + 1;
    sim.stats.beginWave(sim.wave);
    // later waves come from a wider arc
    const swing = (sim.rng() - 0.5) * Math.min(this.wave * 8, 40);
    const scale = sim.difficulty.enemy;
    this.pending = w.groups.map((g) => ({
      ...g,
      count: Math.max(1, Math.round(g.count * (g.type === 'tbm' || g.type === 'fighter' ? sim.difficulty.air ?? 1 : scale))),
      bearing: THREAT_AXIS + g.bearing + swing,
      group: this.group++,
    }));
    this.setState('wave');
    sim.events.wave?.(sim.wave, w.title, w.sub);
    // (an era's wave may carry its own call, `radio`)
    sim.radio(w.radio ?? `Command: ${w.sub.toLowerCase()}. Stand by.`, 'alert');
  }

  update(dt) {
    const sim = this.sim;
    if (sim.scripted) return; // a tutorial range: its script spawns the threats
    this.t += dt;
    switch (this.state) {
      case 'brief':
        if (this.t > BRIEF) this.startWave();
        break;
      case 'wave': {
        for (let i = this.pending.length - 1; i >= 0; i--) {
          const g = this.pending[i];
          if (this.t < g.delay) continue;
          sim.threatAI.spawnGroup(g);
          this.pending.splice(i, 1);
        }
        // decoys and aircraft on their way home (or out of their formation, going home) do not hold the raid
        // open, nor does chaff
        const busy = sim.threats.some((t) => !t.dead && (t.alive || t.falling) && t.type !== 'decoy' && !THREATS[t.type].chaff &&
          !((t.type === 'fighter' || t.type === 'helo' || THREATS[t.type].plane) && (t.phase === 'egress' || t.phase === 'straggle')));
        if (!this.pending.length && !busy && this.t > 10) {
          sim.stats.endWave();
          if (this.wave + 1 >= WAVES.length) {
            if (sim.attract) {
              // the demonstration battle starts over, with the supply column up
              this.wave = 0;
              this.setState('lull');
              sim.unitsAI.resupply();
            } else this.setState('victory');
          } else {
            this.wave++;
            this.setState('lull');
            sim.unitsAI.resupply();
            this.repair();
            sim.radio(ERA.text.lull, 'info');
          }
        }
        break;
      }
      case 'lull':
        if (this.t > LULL) this.startWave();
        break;
    }
    if (!sim.attract && (this.state === 'wave' || this.state === 'lull') && this.lost()) {
      sim.stats.endWave();
      this.setState('defeat');
    }
  }

  // between raids the era's repairs (layout.repair: asset id -> share of its hit points) go on the assets
  // still standing
  repair() {
    const rep = ERA.layout.repair;
    if (!rep) return;
    for (const a of this.sim.assets) if (a.alive && rep[a.id]) a.hp = Math.min(a.maxHp, a.hp + a.maxHp * rep[a.id]);
  }

  // the base is lost with all its vital assets (the modern era's runway and command post), or when no
  // fire unit is left
  lost() {
    const sim = this.sim;
    const a = (id) => sim.assets.find((x) => x.id === id)?.alive;
    const vital = ERA.layout.vital;
    return (vital.length > 0 && vital.every((id) => !a(id))) || sim.units.every((u) => !u.alive);
  }
}
