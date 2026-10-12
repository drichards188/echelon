import { THREAT_AXIS } from '../deploy.js';

// The battle: escalating waves, lulls between them, win and loss. Groups: type, count, bearing offset
// from the threat axis (deg), spawn range (m), delay after the wave starts (s), what they go for, and
// per type extras (role, weapons and release range for aircraft, altitude, standoff for helicopters:
// 5.5 km from their target, close enough for the short-range units and the airbase's cover to meet
// them, so the raids do not hang on the battalion cover's 20 km 57E6, which a Tunguska there lacks).
// Each wave runs about three to five minutes at x1 from the call to the last threat.
export const WAVES = [
  {
    title: 'Wave 1: drones', sub: 'One-way attack drones, low and slow, from the west',
    groups: [
      { type: 'drone', count: 6, bearing: 0, range: 9000, spread: 14, delay: 0, target: 'assets' },
      { type: 'drone', count: 4, bearing: 28, range: 9000, spread: 8, delay: 40, target: 'short' },
      { type: 'drone', count: 4, bearing: -25, range: 9000, spread: 10, delay: 70, target: 'any' },
    ],
  },
  {
    title: 'Wave 2: cruise missiles', sub: 'Terrain-hugging cruise missiles with drones in support',
    groups: [
      { type: 'cruise', count: 4, bearing: -8, range: 30000, spread: 10, delay: 0, target: 'any' },
      { type: 'drone', count: 5, bearing: 32, range: 9000, spread: 10, delay: 10, target: 'assets' },
      { type: 'cruise', count: 4, bearing: 18, range: 30000, spread: 8, delay: 60, target: 'radar' },
      { type: 'drone', count: 4, bearing: -30, range: 9000, spread: 10, delay: 80, target: 'short' },
    ],
  },
  {
    title: 'Wave 3: suppression strike', sub: 'Fighters hunting radars, decoys and cruise missiles',
    groups: [
      { type: 'fighter', count: 4, bearing: 0, range: 85000, spread: 14, delay: 0, role: 'sead', weapons: 2, target: 'assets' },
      { type: 'decoy', count: 6, bearing: 5, range: 80000, spread: 20, delay: 5, target: 'radar' },
      { type: 'drone', count: 4, bearing: -20, range: 9000, spread: 10, delay: 20, target: 'short' },
      { type: 'cruise', count: 4, bearing: 15, range: 30000, spread: 8, delay: 60, target: 'radar' },
    ],
  },
  {
    title: 'Wave 4: standoff bombing', sub: 'Glide bombers behind decoys, drones from the south',
    groups: [
      { type: 'fighter', count: 4, bearing: -5, range: 70000, spread: 12, delay: 0, role: 'glide', weapons: 2, target: 'assets' },
      { type: 'decoy', count: 3, bearing: 0, range: 75000, spread: 16, delay: 0, target: 'radar' },
      { type: 'drone', count: 8, bearing: -65, range: 9000, spread: 14, delay: 15, target: 'any' },
      { type: 'cruise', count: 3, bearing: 10, range: 30000, spread: 6, delay: 70, target: 'assets' },
    ],
  },
  {
    title: 'Wave 5: helicopters', sub: 'Radar hunters and cruise missiles, then attack helicopters against the short-range units',
    groups: [
      { type: 'fighter', count: 2, bearing: 0, range: 85000, spread: 8, delay: 0, role: 'sead', weapons: 2, target: 'assets' },
      { type: 'cruise', count: 6, bearing: 5, range: 30000, spread: 14, delay: 0, target: 'any' },
      { type: 'drone', count: 4, bearing: 40, range: 9000, spread: 10, delay: 20, target: 'short' },
      { type: 'helo', count: 4, bearing: -20, range: 9500, spread: 24, delay: 50, target: 'short', weapons: 4, standoff: 5500 },
      { type: 'cruise', count: 3, bearing: -35, range: 30000, spread: 8, delay: 100, target: 'radar' },
    ],
  },
  {
    title: 'Wave 6: ballistic missiles', sub: 'Ballistic missiles at the battalion and the airbase, behind cruise missiles and drones',
    groups: [
      { type: 'cruise', count: 8, bearing: -15, range: 30000, spread: 20, delay: 0, target: 'any' },
      { type: 'drone', count: 10, bearing: 40, range: 9000, spread: 20, delay: 10, target: 'any' },
      { type: 'tbm', count: 2, bearing: 10, range: 120000, spread: 6, delay: 60, target: 'radar' },
      { type: 'cruise', count: 4, bearing: 20, range: 30000, spread: 10, delay: 90, target: 'radar' },
      { type: 'tbm', count: 2, bearing: -10, range: 120000, spread: 6, delay: 110, target: 'assets' },
    ],
  },
  {
    title: 'Wave 7: saturation', sub: 'Everything at once, from three directions',
    groups: [
      { type: 'fighter', count: 4, bearing: 0, range: 85000, spread: 16, delay: 0, role: 'sead', weapons: 2, target: 'assets' },
      { type: 'decoy', count: 6, bearing: -10, range: 80000, spread: 24, delay: 0, target: 'radar' },
      { type: 'drone', count: 6, bearing: 0, range: 9000, spread: 20, delay: 0, target: 'any' },
      { type: 'fighter', count: 4, bearing: 20, range: 70000, spread: 12, delay: 20, role: 'glide', weapons: 2, target: 'assets' },
      { type: 'cruise', count: 6, bearing: -25, range: 30000, spread: 10, delay: 30, target: 'any' },
      { type: 'helo', count: 2, bearing: 30, range: 10000, spread: 12, delay: 40, target: 'short', weapons: 4, standoff: 5500 },
      { type: 'cruise', count: 4, bearing: 45, range: 30000, spread: 10, delay: 60, target: 'assets' },
      { type: 'drone', count: 6, bearing: -80, range: 9000, spread: 16, delay: 60, target: 'short' },
      { type: 'tbm', count: 2, bearing: 5, range: 120000, spread: 6, delay: 80, target: 'radar' },
    ],
  },
];

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
    sim.radio(`Command: ${w.sub.toLowerCase()}. Stand by.`, 'alert');
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
        // decoys and aircraft on their way home do not hold the raid open
        const busy = sim.threats.some((t) => !t.dead && (t.alive || t.falling) && t.type !== 'decoy' && !((t.type === 'fighter' || t.type === 'helo') && t.phase === 'egress'));
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
            sim.radio('Command: raid over. Supply column is up, reload and stand by.', 'info');
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

  // the base is lost with its runway and command post, or when no fire unit is left
  lost() {
    const sim = this.sim;
    const a = (id) => sim.assets.find((x) => x.id === id)?.alive;
    return (!a('runway') && !a('cp')) || sim.units.every((u) => !u.alive);
  }
}
