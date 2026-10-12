import * as THREE from 'three';
import { fromBearingVec } from './sim/flight.js';
import { ERA } from './deploy.js';
import { eraById } from './eras/index.js';
import { setHighlight } from './ui/highlight.js';

// Tutorials: one lesson per vehicle plus the basics, each a list of steps run on a scripted range
// (main.js host.enter: sim.newGame({ scripted: true, loadout: def.loadout ?? DEFAULT_LOADOUT }): the
// director spawns nothing, nothing is damaged). A lesson runs on the default units, or on the default
// units with its own vehicle swapped in (`loadout`, see swap()); leaving goes back to the player's loadout. A step shows an
// instruction card over the 3D view, pulses the console controls it is about (data-tut names, see
// src/ui/highlight.js) and completes when its `done(T)` reads true from the sim state; steps without
// `done` only explain and advance with Next. The script places its own threats with `T.spawn`.
//
// Step fields: id, title, text, goal (the objective line), hi (data-tut names to pulse), enter(T), tick(T),
// done(T). Time compression is left to the player.

const STORE = 'echelon.tutorials';
const DEG = Math.PI / 180;
// The lessons below are the modern era's (eras/modern.js lists them in `tutorials`; the list shows the
// lessons of the era in play): its units, its threat axis and its default loadout.
const MODERN = eraById('modern');
const FROM = MODERN.layout.threatAxis; // the compass bearing the raids come from

// the default loadout with one slot's alternative swapped in
const swap = (slot, kind) => MODERN.defaultLoadout.map((k, i) => (i === slot ? kind : k));
const LIVE = ['aligning', 'launch', 'flying'];
const liveEngagements = (T) => T.u.engagements.filter((e) => LIVE.includes(e.state)).length;

const isGone = (t) => t.dead || (!t.alive && !t.falling);

// ---------------------------------------------------------------------------------------------------
// helpers the scripts share
const mine = (T) => T.sim.missiles.filter((m) => m.alive && m.unitId === T.u.id);
const flying = (T) => mine(T).length > 0;
const track = (T, key) => {
  const t = T.threats.get(key);
  return t ? T.u.tracks.find((x) => x.id === t.id) ?? null : null;
};
const selectedIs = (T, key) => {
  const t = T.threats.get(key);
  return !!t && T.u.selected === t.id && !!track(T, key);
};
// the angle (rad) between the Strela's sight line and a threat
const sightError = (T, key) => {
  const t = T.threats.get(key);
  const s = T.u.sight;
  if (!t || !t.alive || !s) return Infinity;
  const d = new THREE.Vector3().subVectors(t.pos, T.u.pos);
  const dir = new THREE.Vector3(Math.sin(s.az) * Math.cos(s.el), Math.sin(s.el), -Math.cos(s.az) * Math.cos(s.el));
  return Math.acos(THREE.MathUtils.clamp(d.normalize().dot(dir), -1, 1));
};
// keep a contact alive for the step; a killed one stays dead
const keeper = (key, type, o) => (T) => T.keep(key, () => T.spawn(key, type, typeof o === 'function' ? o(T) : o));
// make sure there is something to reload
const needReload = (T) => {
  const st = T.u.weapons.missiles;
  if (st.ready >= st.max && st.reserve > 0) {
    st.ready = st.max - 1;
    st.reserve++;
    T.sim.unitsAI.updateSlots(T.u);
  }
};
const reloaded = (T) => {
  const st = T.u.weapons.missiles;
  if (st.reload > 0) T.mem.started = true;
  return !!T.mem.started && st.reload === 0 && st.ready >= st.max;
};
// full ammunition and cool barrels for a gun lesson's kill
const topUp = (T) => {
  const g = T.u.weapons.gun;
  if (g) {
    g.rounds = g.max;
    g.heat = 0;
    g.overheated = false;
  }
};

// ---------------------------------------------------------------------------------------------------
// the lessons
export const TUTORIALS = [
  {
    id: 'basics',
    name: 'The basics',
    unit: 'S400',
    free: true, // the unit keys are part of this lesson
    blurb: 'Camera, switching units, padlock, missile chase, time compression and how the layers fit together.',
    outro: 'That is the interface. The unit lessons teach each console; the layers work best when every unit does the job it was built for.',
    setup: (T) => {
      T.u.mode = 'hold';
    },
    steps: [
      {
        title: 'Two halves',
        text: 'The left half is a third person view of the unit you have selected, the right half is its console. The units you are not at fight on their own in whatever mode you left them.',
        hi: ['header'],
      },
      {
        title: 'Orbit and zoom',
        text: 'Hold the left mouse button in the 3D view and drag to look around the vehicle. The wheel zooms. C releases the camera to roam (WASD); C again returns to the unit.',
        goal: 'Drag to orbit or use the wheel to zoom',
        enter: (T) => {
          T.mem.cam = T.host.cam();
        },
        done: (T) => {
          const c = T.host.cam();
          return Math.abs(c.yaw - T.mem.cam.yaw) > 0.3 || Math.abs(c.dist - T.mem.cam.dist) > 8;
        },
      },
      {
        title: 'Switching units',
        text: 'Keys 1 to 5 select a unit: S-400, two Pantsir, Osa, Strela. The tabs above the console do the same and show each unit\'s health, ammunition, whether it is emitting (green), engaging (amber) or in danger (red).',
        goal: 'Press 2 to go to a Pantsir, then 1 to come back',
        hi: ['tabs'],
        tick: (T) => {
          if (T.host.selectedId() !== 'S400') T.mem.left = true;
        },
        done: (T) => !!T.mem.left && T.host.selectedId() === 'S400',
      },
      {
        title: 'Modes',
        text: 'Every console has a MODE switch. AUTO: the crew fights by itself, competently but wastefully. MANUAL: it fires only on your orders, and a little better. HOLD: weapons safe. Units you are not at keep the mode you left them in.',
        hi: ['mode'],
      },
      {
        id: 'padlock',
        title: 'Padlock',
        text: 'A contact has appeared far to the west-southwest. Select it with Tab (or click it on the scope), then press V. The camera swings to keep the selected track in view behind the vehicle, so you can watch an engagement. V again releases it.',
        goal: 'Select the contact (Tab), then press V',
        hi: ['scope', 'tracks'],
        enter: (T) => {
          T.clear();
          T.spawn('a', 'fighter', { bearing: FROM, range: 70000, alt: 8000, weapons: 1 });
        },
        tick: keeper('a', 'fighter', { bearing: FROM, range: 70000, alt: 8000, weapons: 1 }),
        done: (T) => T.host.padlock() && T.u.selected != null,
      },
      {
        title: 'Follow a missile',
        text: 'Press Space to launch a missile at the selected contact. The S-400 takes the mode change for you. Then press F: the camera chases the missile in flight. F again, a unit key or C returns to the vehicle.',
        goal: 'Launch with Space, then press F while the missile flies',
        hi: ['launch'],
        tick: keeper('a', 'fighter', { bearing: FROM, range: 70000, alt: 8000, weapons: 1 }),
        done: (T) => flying(T) && T.host.following(),
      },
      {
        title: 'Time compression',
        text: 'Waiting is part of the job. The + button beside the time readout at the top right of the view (or ]) speeds the world up (x2, x4, x8), the - button (or [) slows it down, and clicking the readout goes back to real time. The camera and your controls stay in real time.',
        goal: 'Press + (or ]) to speed up the game',
        hi: ['timescale'],
        enter: (T) => T.setScale(1),
        done: (T) => T.host.scale() > 1,
      },
      {
        title: 'The layers',
        text: 'The S-400 sees far and high, aircraft, ballistic missiles and decoys first. Low flyers hide behind ground and only show up close in, so they leak through to the Pantsir, the Osa and the Strela, each with a shorter reach and a faster reaction. No layer wins alone.',
        hi: ['tabs'],
        enter: (T) => {
          T.clear();
          T.setScale(1);
        },
      },
    ],
  },

  {
    id: 's400',
    name: 'S-400 battalion',
    unit: 'S400',
    blurb: 'The long layer: scope and track table, long and short missiles, decoys, radar-seeking missiles and reloading.',
    outro: 'You have run the long layer: pick the missile to suit the range, do not waste shots on decoys, go dark when an anti-radar missile comes, and reload between raids.',
    setup: (T) => {
      T.u.mode = 'hold';
    },
    steps: [
      {
        title: 'The command post',
        text: 'You command the S-400 battalion, the long-range layer. Its crew fires on its own in AUTO. Here you run it yourself, from the console on the right. In this lesson nothing is scored and nothing can be destroyed.',
        hi: ['header'],
      },
      {
        title: 'The scope',
        text: 'The round scope is a plan view from above, north up, with the battalion in the middle. The sweep line shows what the radar has just looked at; contacts appear as marks that refresh once per sweep. A contact has appeared far to the west-southwest. The buttons below the scope change its range scale.',
        hi: ['scope', 'range'],
        enter: (T) => T.spawn('a', 'fighter', { bearing: FROM, range: 95000, alt: 8000, weapons: 1 }),
        tick: keeper('a', 'fighter', { bearing: FROM, range: 95000, alt: 8000, weapons: 1 }),
      },
      {
        title: 'The track table',
        text: 'Every contact is a track. The table lists its number, class, range, bearing, altitude, speed and time to impact (TTI). The selected track is shown in the bar under the header. Click a mark on the scope, click a row, or press Tab to select.',
        goal: 'Select the aircraft track',
        hi: ['scope', 'tracks'],
        tick: keeper('a', 'fighter', { bearing: FROM, range: 95000, alt: 8000, weapons: 1 }),
        done: (T) => selectedIs(T, 'a'),
      },
      {
        title: 'Take manual control',
        text: 'AUTO: the crew picks targets and fires, often wastefully. MANUAL: it fires only on your orders. HOLD: weapons safe. Take the battalion yourself.',
        goal: 'Set MODE to MANUAL (YOU FIRE)',
        hi: ['mode'],
        tick: keeper('a', 'fighter', { bearing: FROM, range: 95000, alt: 8000, weapons: 1 }),
        done: (T) => T.u.mode === 'manual',
      },
      {
        title: 'Two missiles',
        text: 'The 48N6 is the long missile: it reaches 200 km but there are few. The 9M96 reaches 100 km, is cheaper and plentiful. The READY and RESERVE counters show what is left; a launcher can only be reloaded from reserve. Use the 48N6 for far targets and save it. Q switches the type. If a target is out of reach the unit answers "unable".',
        hi: ['type', 'stock'],
        tick: keeper('a', 'fighter', { bearing: FROM, range: 95000, alt: 8000, weapons: 1 }),
      },
      {
        title: 'Launch at the aircraft',
        text: 'With the 48N6 selected, press LAUNCH 1 MISSILE (or Space). The missile pushes out of its canister, lights its motor and steers on the radar track. LAUNCH SALVO OF 2 raises the chance but spends two. Press F to ride along, F again to return. The + button by the time readout (or ]) speeds up the wait while it flies.',
        goal: 'Shoot the aircraft down with a 48N6',
        hi: ['type', 'launch', 'salvo'],
        tick: keeper('a', 'fighter', { bearing: FROM, range: 95000, alt: 8000, weapons: 1 }),
        done: (T) => T.killedBy('a'),
      },
      {
        id: 'decoy',
        title: 'A suspicious contact',
        text: 'A new contact looks like an aircraft but it is slow and not really going anywhere. Some contacts are decoys, and a decoy costs the enemy far less than your missile costs you. Select it and watch its class: once the track has been held for a while a decoy gives itself away. Do not fire.',
        goal: 'Select the contact and wait until it reads DECOY',
        hi: ['tracks', 'selbar'],
        enter: (T) => {
          T.clear();
          T.spawn('d', 'decoy', { bearing: FROM - 6, range: 66000, alt: 6000 });
        },
        tick: keeper('d', 'decoy', { bearing: FROM - 6, range: 66000, alt: 6000 }),
        done: (T) => selectedIs(T, 'd') && track(T, 'd').cls === 'decoy',
      },
      {
        title: 'Hold fire',
        text: 'The class now reads DECOY. Leave it alone: the AI crew in AUTO would fire at it before it gives itself away, which is one reason to take over. If you ever launch at the wrong track, CEASE FIRE (X) destroys your missile in flight.',
        hi: ['tracks', 'cease'],
      },
      {
        title: 'The cheaper missile',
        text: 'Another aircraft, nearer. The 48N6 would do it, but each one counts. The 9M96 is cheaper and does the job inside 100 km. Select SHORT (9M96) and the aircraft, then launch.',
        goal: 'Shoot the aircraft down with a 9M96',
        hi: ['type', 'launch'],
        enter: (T) => {
          T.clear();
          T.spawn('b', 'fighter', { bearing: FROM - 5, range: 62000, alt: 7500, weapons: 1 });
        },
        tick: keeper('b', 'fighter', { bearing: FROM - 5, range: 62000, alt: 7500, weapons: 1 }),
        done: (T) => T.killedBy('b', '9M96'),
      },
      {
        id: 'arm-off',
        title: 'Radar-seeking missile',
        text: 'ARM INBOUND! An anti-radar missile is homing on the battalion\'s radar. It cannot hit a radar that is switched off. Lift the guard over SEARCH RADAR and flip it off (or press R) before the missile arrives.',
        goal: 'Switch the search radar off',
        hi: ['emit', 'header'],
        enter: (T) => {
          T.clear();
          T.spawnArm(34000);
        },
        tick: (T) => T.armWatch('arm-off'),
        done: (T) => !T.u.radar.search,
      },
      {
        id: 'arm-wait',
        title: 'Stay dark',
        text: 'The battalion is blind while it is silent: it sees nothing, and a 48N6 in flight would lose its guidance. Keep the emitter off until the missile has gone by.',
        goal: 'Wait for the missile to miss',
        hi: ['emit-lamps'],
        tick: (T) => T.armWatch('arm-off'),
        done: (T) => !T.threats.get('arm')?.alive && !T.u.radar.search,
      },
      {
        title: 'Back on the air',
        text: 'It missed. Switching off is a trade: the radar survives but the battalion is blind. Do it only as the missile closes, and switch back on at once.',
        goal: 'Switch the search radar back on',
        hi: ['emit'],
        done: (T) => T.u.radar.search,
      },
      {
        title: 'Reloading',
        text: 'The launchers hold only so many ready missiles; the rest wait in reserve. RELOAD LAUNCHERS (L) refills the launcher of the selected type, which takes a while and leaves it unable to fire. Watch the RELOAD bar. Between raids a supply column refills the reserves.',
        goal: 'Press RELOAD and wait until it finishes',
        hi: ['reload', 'launchers'],
        enter: (T) => {
          T.clear();
          needReload(T);
        },
        done: reloaded,
      },
    ],
  },

  {
    id: 'pantsir',
    name: 'Pantsir-S1',
    unit: 'P2',
    blurb: 'Point defence: search scope and tracking channel, missiles against guns, a drone close in and the silent EO channel.',
    outro: 'The Pantsir covers itself: missiles for the distance, guns when they get close, and the EO channel when you want to hunt without emitting.',
    setup: (T) => {
      T.u.mode = 'hold';
    },
    steps: [
      {
        title: 'Point defence',
        text: 'The Pantsir-S1 protects what is around it against drones, cruise missiles and low flyers. It has a search radar, a tracking channel, twelve missiles and twin 30 mm guns. In this lesson nothing is scored and nothing can be destroyed.',
        hi: ['header'],
      },
      {
        title: 'The search scope',
        text: 'The round scope at the lower left is the search radar, a plan view with the vehicle in the middle and north up. A drone has just appeared to the west-southwest. The table beside it lists the tracks. Both lines fade as the radar sweeps.',
        hi: ['scope', 'range'],
        enter: (T) => T.spawn('a', 'drone', { bearing: FROM, range: 13500 }),
        tick: keeper('a', 'drone', { bearing: FROM, range: 13500 }),
      },
      {
        title: 'The tracking channel',
        text: 'The big picture at the top is the tracking channel: it follows the one target you select, either with the tracking radar or with the silent TV / IR camera. The lamps show when it is LOCKED ON. The radar track and the missiles need it.',
        hi: ['sight', 'lamps', 'src'],
        tick: keeper('a', 'drone', { bearing: FROM, range: 13500 }),
      },
      {
        title: 'Select the drone',
        text: 'Click the drone on the scope, click its row in the table, or press Tab.',
        goal: 'Select the drone track',
        hi: ['scope', 'tracks'],
        tick: keeper('a', 'drone', { bearing: FROM, range: 13500 }),
        done: (T) => selectedIs(T, 'a'),
      },
      {
        title: 'Take manual control',
        text: 'AUTO lets the crew choose; MANUAL fires only on your orders; HOLD is weapons safe.',
        goal: 'Set MODE to MANUAL',
        hi: ['mode'],
        tick: keeper('a', 'drone', { bearing: FROM, range: 13500 }),
        done: (T) => T.u.mode === 'manual',
      },
      {
        title: 'Missiles or guns',
        text: 'The 57E6 missiles reach out to 20 km and are best for distant or fast targets. The twin 30 mm guns work inside about 4 km: a stream of shells for what is close. G switches between them; the counters show what is left.',
        hi: ['weapon', 'stock'],
        tick: keeper('a', 'drone', { bearing: FROM, range: 13500 }),
      },
      {
        title: 'Launch a missile',
        text: 'With MISSILES selected and the drone selected, press LAUNCH MISSILE (or Space). The vehicle turns the launcher, switches the tracking radar on and fires. The lamp must say LOCKED ON: the missile is steered by that channel until it hits.',
        goal: 'Shoot the drone down with a missile',
        hi: ['weapon', 'launch', 'lamps'],
        tick: keeper('a', 'drone', { bearing: FROM, range: 13500 }),
        done: (T) => T.killedBy('a', '57E6'),
      },
      {
        title: 'A drone close in',
        text: 'A drone is coming in low and close. Missiles need distance to turn; the guns do not. Select GUNS (or press G) and the drone. The guns are for close work: wait until it is inside about 1.5 km, then hold FIRE GUNS (or hold Space) with the tracking radar on (T) so the fire control can lead it. Farther out the shells scatter and the barrels heat up.',
        goal: 'Shoot the drone down with the guns',
        hi: ['weapon', 'trigger', 'track-radar'],
        enter: (T) => {
          T.clear();
          T.spawn('b', 'drone', { bearing: FROM + 10, range: 2600 });
          if (T.u.sight.src === 'radar') T.u.radar.track = true;
        },
        tick: keeper('b', 'drone', { bearing: FROM + 10, range: 2600 }),
        done: (T) => T.killedBy('b', '30mm'),
      },
      {
        title: 'The silent channel',
        text: 'The tracking radar emits, so it can be found and attacked. The TV / IR channel is passive: it works by sight, needs a clear line of view and reaches about 14 km. The search radar still emits; this silences the tracking.',
        goal: 'Choose TV / IR under TRACKING BY and switch the tracking radar off (T)',
        hi: ['src', 'track-radar'],
        enter: (T) => T.clear(),
        done: (T) => T.u.sight.src === 'eo' && !T.u.radar.track,
      },
      {
        title: 'Engage without emitting',
        text: 'A last drone, farther out. Select it and launch a missile with the EO channel doing the tracking. The picture in the sight is the camera view of the target.',
        goal: 'Shoot the drone down on the EO channel with the tracking radar off',
        hi: ['sight', 'launch'],
        enter: (T) => T.spawn('c', 'drone', { bearing: FROM - 8, range: 9000 }),
        tick: (T) => {
          keeper('c', 'drone', { bearing: FROM - 8, range: 9000 })(T);
          if (flying(T) && T.u.sight.src === 'eo' && !T.u.radar.track) T.mem.eo = true;
        },
        done: (T) => T.killedBy('c', '57E6') && !!T.mem.eo,
      },
    ],
  },

  {
    id: 'osa',
    name: 'Osa-AKM',
    unit: 'OSA',
    blurb: 'The scope, tracking radar acquisition, salvo launch, the one-target limit and reloading.',
    outro: 'The Osa is a one-target-at-a-time weapon: give it the most dangerous target, keep the tracking radar on it until impact, and reload when it is empty.',
    setup: (T) => {
      T.u.mode = 'hold';
    },
    steps: [
      {
        title: 'The Osa',
        text: 'The Osa-AKM is a short-range launcher with a search radar, a separate tracking radar and six ready missiles. It guards the airbase against low flyers. In this lesson nothing is scored and nothing can be destroyed.',
        hi: ['header'],
      },
      {
        title: 'The scope',
        text: 'The amber scope is the search radar: a plan view with the vehicle in the middle and north up. A drone has appeared to the west-southwest. The sweep refreshes the marks once per turn. The table beside it lists the tracks.',
        hi: ['scope', 'range'],
        enter: (T) => T.spawn('a', 'drone', { bearing: FROM - 15, range: 12500 }),
        tick: keeper('a', 'drone', { bearing: FROM - 15, range: 12500 }),
      },
      {
        title: 'Select the drone',
        text: 'Click the mark on the scope, click its row in the table, or press Tab.',
        goal: 'Select the drone track',
        hi: ['scope', 'tracks'],
        tick: keeper('a', 'drone', { bearing: FROM - 15, range: 12500 }),
        done: (T) => selectedIs(T, 'a'),
      },
      {
        title: 'Take manual control',
        text: 'AUTO lets the crew choose; MANUAL fires only on your orders; HOLD is weapons safe.',
        goal: 'Set MODE to MANUAL',
        hi: ['mode'],
        tick: keeper('a', 'drone', { bearing: FROM - 15, range: 12500 }),
        done: (T) => T.u.mode === 'manual',
      },
      {
        title: 'The tracking radar',
        text: 'The missiles are steered by radio command from the tracking radar, which must hold the target until impact. Selecting a track hands it to the tracking radar: it switches on, the turret and antenna swing onto the target and the LOCK lamp comes on; the acquisition scope shows the radar looking at it as a spike. T switches the tracking radar off and on by hand.',
        goal: 'Watch the tracking radar take the selected drone',
        hi: ['track-radar', 'ascope'],
        tick: keeper('a', 'drone', { bearing: FROM - 15, range: 12500 }),
        done: (T) => T.u.radar.track,
      },
      {
        id: 'salvo',
        title: 'Launch a salvo',
        text: 'Make sure the drone is selected. LAUNCH SALVO OF 2 (Shift+Space) fires two missiles a couple of seconds apart for a better chance; LAUNCH 1 MISSILE fires one. The TRACKING and LOCKED ON lamps light as the radar takes the target. The drone must be inside 10 km.',
        goal: 'Launch a salvo of two missiles at the drone',
        hi: ['salvo', 'lock', 'tracking'],
        tick: keeper('a', 'drone', { bearing: FROM - 15, range: 12500 }),
        done: (T) => (T.mem.launched ?? 0) >= 2 || T.killedBy('a'),
      },
      {
        title: 'Hold the target',
        text: 'The missiles fly toward where the radar says the target is. If the radar loses the target, the missiles lose their guidance and self-destruct. Wait for the result.',
        goal: 'Destroy the drone',
        hi: ['tracking', 'lock', 'eng-lamps'],
        tick: (T) => {
          keeper('a', 'drone', { bearing: FROM - 15, range: 12500 })(T);
          if (T.respawned) T.goto('salvo');
        },
        done: (T) => T.killedBy('a'),
      },
      {
        id: 'one',
        title: 'One target at a time',
        text: 'The Osa has one tracking channel. Two drones are coming. Launch at one, and while its missiles are flying select the other and press LAUNCH: the Osa answers "all channels busy". It must finish the first target before it takes the second.',
        goal: 'Try to launch at the second drone while the first is engaged',
        hi: ['launch', 'tracks', 'eng-lamps'],
        enter: (T) => {
          T.clear();
          T.spawn('b', 'drone', { bearing: FROM - 30, range: 11000 });
          T.spawn('c', 'drone', { bearing: FROM, range: 11000 });
        },
        tick: (T) => {
          keeper('b', 'drone', { bearing: FROM - 30, range: 11000 })(T);
          keeper('c', 'drone', { bearing: FROM, range: 11000 })(T);
        },
        done: (T) => !!T.mem.busy,
      },
      {
        title: 'Finish both',
        text: 'Work through them one at a time. Take the one that will reach you first (its time to impact is in the table), then the other. Cease fire (X) releases the channel if you picked wrong.',
        goal: 'Destroy both drones',
        hi: ['tracks', 'launch'],
        tick: (T) => {
          keeper('b', 'drone', { bearing: FROM - 30, range: 11000 })(T);
          keeper('c', 'drone', { bearing: FROM, range: 11000 })(T);
        },
        done: (T) => T.killedBy('b') && T.killedBy('c'),
      },
      {
        title: 'Reloading',
        text: 'The launcher holds six; more wait in reserve. RELOAD LAUNCHER (L) fills it back up, which takes a while and leaves it unable to fire. Watch the RELOAD bar.',
        goal: 'Press RELOAD and wait until it finishes',
        hi: ['reload'],
        enter: (T) => {
          T.clear();
          needReload(T);
        },
        done: reloaded,
      },
    ],
  },

  {
    id: 'strela',
    name: 'Strela-10M3',
    unit: 'STR',
    blurb: 'No radar: use the bearing cues, slew the sight onto the target, uncage, wait for the tone, fire and reload.',
    outro: 'The Strela is a hunter\'s weapon: find the target with the cues, put it in the circle, uncage, wait for the tone, fire, and forget it.',
    setup: (T) => {
      T.u.mode = 'hold';
    },
    steps: [
      {
        title: 'No radar',
        text: 'The Strela-10M3 has no radar. The crew finds the target by eye and the missile finds it by heat. You aim the optical sight, uncage the seeker, wait for it to lock and fire. In this lesson nothing is scored and nothing can be destroyed.',
        hi: ['sight'],
      },
      {
        title: 'Take manual control',
        text: 'In AUTO the crew works the sight itself; MANUAL fires only on your orders; HOLD is weapons safe.',
        goal: 'Set MODE to MANUAL',
        hi: ['mode'],
        done: (T) => T.u.mode === 'manual',
      },
      {
        id: 'slew',
        title: 'The cue strip and the sight',
        text: 'A drone is coming in from the southwest. The strip under the sight shows where the battalion\'s radars see the nearest threats, as bearings only: a marker is a threat, arrows at the ends mean off the strip. Click a marker to swing the sight there, or drag in the sight, or use the arrow keys (Shift for fast). Put the drone in the small circle.',
        goal: 'Put the drone inside the circle in the middle of the sight',
        hi: ['cues', 'sight'],
        enter: (T) => {
          T.clear();
          T.spawn('a', 'drone', { bearing: 240, range: 5600 });
        },
        tick: keeper('a', 'drone', { bearing: 240, range: 5600 }),
        done: (T) => sightError(T, 'a') < 0.035,
      },
      {
        title: 'Uncage the seeker',
        text: 'The seeker in the missile is caged until you free it. Uncaging lets it look for heat inside the circle. Hold the drone in the circle while you do it.',
        goal: 'UNCAGE the seeker (U)',
        hi: ['uncage'],
        tick: keeper('a', 'drone', { bearing: 240, range: 5600 }),
        done: (T) => T.u.sight.uncaged,
      },
      {
        title: 'Wait for the tone',
        text: 'Listen: the seeker growls, and the tone steadies and rises as it locks on. When the LOCKED lamp lights, it has the target. A target that drifts out of the circle drops the tone; nudge the sight with the arrow keys to keep it in.',
        goal: 'Keep the drone in the circle until the LOCKED lamp lights',
        hi: ['tone', 'lock'],
        tick: keeper('a', 'drone', { bearing: 240, range: 5600 }),
        done: (T) => T.u.sight.lock >= 1,
      },
      {
        title: 'Fire',
        text: 'FIRE MISSILE (or Space) launches only with a lock.',
        goal: 'Fire the missile',
        hi: ['fire'],
        tick: keeper('a', 'drone', { bearing: 240, range: 5600 }),
        done: (T) => (T.mem.launched ?? 0) >= 1,
      },
      {
        title: 'Fire and forget',
        text: 'The missile homes on its own; you do not need to do anything. If the drone breaks the lock the missile can miss, so fire only on a steady lock.',
        goal: 'Destroy the drone',
        tick: (T) => {
          keeper('a', 'drone', { bearing: 240, range: 5600 })(T);
          if (T.respawned) T.goto('slew');
        },
        done: (T) => T.killedBy('a'),
      },
      {
        title: 'Reloading',
        text: 'The launcher holds four and four more are stowed inside. RELOAD LAUNCHER (L) sends the crew out: they lower the launcher, pull the spent containers off the rails and hand the stowed ones up to the man on the roof, one at a time. A full reload takes well over a minute and the launcher cannot fire meanwhile; the + button by the time readout speeds up the wait.',
        goal: 'Press RELOAD and wait until it finishes',
        hi: ['reload', 'launcher-rack', 'stowed'],
        enter: (T) => {
          T.clear();
          needReload(T);
        },
        done: reloaded,
      },
    ],
  },

  // ------------------------------------------------------------------------------ the loadout alternatives
  {
    id: 'buk',
    name: 'Buk-M2 battery',
    unit: 'BUK',
    loadout: swap(0, 'buk'),
    blurb: 'Replaces the S-400: a battery of separate vehicles, a radar on every TELAR, choosing the firing vehicle, going dark and reloading from the loader.',
    outro: 'The Buk is a battery, not a block: every TELAR is its own fire unit and must hold its target until impact, the radars are the targets of anti-radar missiles, and the loader-launcher is the magazine.',
    setup: (T) => {
      T.u.mode = 'hold';
    },
    steps: [
      {
        title: 'A battery of vehicles',
        text: 'The Buk-M2 battery is the long layer when you swap it in for the S-400: it reaches 70 km, carries cheaper missiles and has no answer to ballistic missiles. It is five vehicles, each with its own health: two TELARs, a loader-launcher, the search radar and the command post. In this lesson nothing is scored and nothing can be destroyed.',
        hi: ['vehicles'],
      },
      {
        title: 'Each TELAR is a fire unit',
        text: 'A TELAR carries four missiles and its own tracking radar, and holds one target at a time, so two TELARs mean two targets at once; lose one and you lose a channel. The loader-launcher has four missiles on its rails and four more on its rack, and fires for a TELAR\'s engagement once that TELAR is empty. The command post keeps the data link up: without it the battery loses its shared picture.',
        hi: ['telar1', 'telar2', 'loader'],
      },
      {
        title: 'The scope and the track table',
        text: 'The green scope is the search radar, plan view, north up; contacts refresh once per sweep and the buttons below change the range scale. An aircraft has appeared far to the west-southwest. The table beside the vehicles lists every track with range, altitude and time to impact.',
        hi: ['scope', 'range', 'tracks'],
        enter: (T) => T.spawn('a', 'fighter', { bearing: FROM, range: 100000, alt: 8000, weapons: 1 }),
        tick: keeper('a', 'fighter', { bearing: FROM, range: 100000, alt: 8000, weapons: 1 }),
      },
      {
        title: 'Select the aircraft',
        text: 'Click the mark on the scope, click its row in the table, or press Tab. The selected track is shown in the bar under the header and in the ENGAGE panel.',
        goal: 'Select the aircraft track',
        hi: ['scope', 'tracks', 'sel'],
        tick: keeper('a', 'fighter', { bearing: FROM, range: 100000, alt: 8000, weapons: 1 }),
        done: (T) => selectedIs(T, 'a'),
      },
      {
        title: 'Take manual control',
        text: 'AUTO: the crew picks targets and vehicles itself, wastefully. MANUAL: it fires only on your orders. HOLD: weapons safe.',
        goal: 'Set MODE to MANUAL (YOU FIRE)',
        hi: ['mode'],
        tick: keeper('a', 'fighter', { bearing: FROM, range: 100000, alt: 8000, weapons: 1 }),
        done: (T) => T.u.mode === 'manual',
      },
      {
        id: 'telar2',
        title: 'Choose the firing vehicle',
        text: 'FIRING VEHICLE decides which TELAR takes the shot: BEST AVAILABLE picks a free one with a clear line to the target, or you name TELAR 1 or TELAR 2 (Q cycles). A new aircraft has appeared, within the 70 km reach: select it, name TELAR 2, then press LAUNCH 1 MISSILE (or Space). That TELAR switches its radar on and guides the missile.',
        goal: 'Launch a missile with TELAR 2 as the firing vehicle',
        hi: ['firing-vehicle', 'launch', 'telar2'],
        enter: (T) => {
          T.clear();
          T.spawn('a', 'fighter', { bearing: FROM, range: 62000, alt: 7500, weapons: 1 });
        },
        tick: keeper('a', 'fighter', { bearing: FROM, range: 62000, alt: 7500, weapons: 1 }),
        done: (T) => !!T.mem.guides?.has(T.u.telars[1]) || T.killedBy('a'),
      },
      {
        title: 'The radar holds it to impact',
        text: 'The 9M317 is command guided: the TELAR that fired it must keep its radar on the target until impact, and 3 s without it the round destroys itself. The lamp beside that TELAR\'s rounds shows LOCK, and its radar button shows it is emitting. Press F to ride the missile, F again to return. The + button by the time readout speeds up the wait.',
        goal: 'Shoot the aircraft down',
        hi: ['telar2', 'telar2-radar', 'selbar'],
        tick: (T) => {
          keeper('a', 'fighter', { bearing: FROM, range: 62000, alt: 7500, weapons: 1 })(T);
          if (T.respawned) T.goto('telar2');
        },
        done: (T) => T.killedBy('a', '9M317'),
      },
      {
        title: 'Two targets, two TELARs',
        text: 'Two more aircraft, from different bearings. Launch at one, then select the other and launch again while the first missile flies: with BEST AVAILABLE the battery gives the second target to the other TELAR, so both engagements run at once. A third target would have to wait for a TELAR to finish.',
        goal: 'Destroy both aircraft',
        hi: ['tracks', 'launch', 'firing-vehicle', 'telar1', 'telar2'],
        enter: (T) => {
          T.clear();
          T.spawn('b', 'fighter', { bearing: FROM - 8, range: 58000, alt: 7500, weapons: 1 });
          T.spawn('c', 'fighter', { bearing: FROM + 10, range: 62000, alt: 8500, weapons: 1 });
        },
        tick: (T) => {
          keeper('b', 'fighter', { bearing: FROM - 8, range: 58000, alt: 7500, weapons: 1 })(T);
          keeper('c', 'fighter', { bearing: FROM + 10, range: 62000, alt: 8500, weapons: 1 })(T);
        },
        done: (T) => T.killedBy('b') && T.killedBy('c'),
      },
      {
        id: 'arm-off',
        title: 'Radar-seeking missile',
        text: 'ARM INBOUND! An anti-radar missile is homing on the battery\'s radars: the search radar and every TELAR radar that is on are targets. It cannot hit a radar that is switched off. ALL RADARS OFF (or lift the guard over SEARCH RADAR and switch off, and each TELAR\'s radar button) before it arrives.',
        goal: 'Switch every radar off',
        hi: ['silence', 'emit', 'telar1-radar', 'telar2-radar'],
        enter: (T) => {
          T.clear();
          T.u.radar.search = true;
          for (const i of T.u.telars) T.u.parts[i].track = true;
          T.u.radar.track = true;
          T.spawnArm(34000);
        },
        tick: (T) => T.armWatch('arm-off'),
        done: (T) => !T.u.radar.search && !T.u.radar.track,
      },
      {
        id: 'arm-wait',
        title: 'Stay dark',
        text: 'With the radars silent the battery is blind: no new tracks, and a missile in flight would lose its guidance. Keep them off until the missile has gone by.',
        goal: 'Wait for the missile to miss',
        hi: ['emit-lamps', 'vehicles'],
        tick: (T) => T.armWatch('arm-off'),
        done: (T) => !T.threats.get('arm')?.alive && !T.u.radar.search && !T.u.radar.track,
      },
      {
        title: 'Back on the air',
        text: 'It missed. Going dark is a trade: the radars survive but the battery is blind. Switch the search radar on at once; a TELAR\'s radar comes on by itself when it takes a shot.',
        goal: 'Switch the search radar back on',
        hi: ['emit'],
        done: (T) => T.u.radar.search,
      },
      {
        title: 'Reload from the loader',
        text: 'A TELAR holds four rounds. The loader-launcher drives over to it and its crane lays the rounds on from the reserve on its rack, one vehicle at a time; that takes about a minute (time compression helps) and keeps both the loader-launcher and that vehicle from firing meanwhile. RELOAD TELAR (L reloads the emptiest) on the TELAR that is short.',
        goal: 'Reload TELAR 1 and wait until it finishes',
        hi: ['telar1-reload', 'telar1', 'loader'],
        enter: (T) => {
          T.clear();
          const p = T.u.parts[T.u.telars[0]];
          T.u.weapons.missiles.reserve += Math.max(0, p.rounds - 1);
          p.rounds = Math.min(p.rounds, 1);
          T.sim.unitsAI.updateSlots(T.u);
        },
        tick: (T) => {
          if (T.u.weapons.missiles.reload > 0) T.mem.started = true;
        },
        done: (T) => !!T.mem.started && T.u.weapons.missiles.reload === 0 && T.u.parts[T.u.telars[0]].rounds >= 4,
      },
    ],
  },

  {
    id: 'tunguska',
    name: '2S6M Tunguska',
    unit: 'T2',
    loadout: swap(2, 'tunguska'),
    blurb: 'Replaces a Pantsir: guns first, the lead, heat and ammunition, the optical-only missile channel and the search radar.',
    outro: 'The Tunguska is a gun with missiles for reach: use the guns for what is close, the silent optical missiles for what is farther, and watch the barrels.',
    setup: (T) => {
      T.u.mode = 'hold';
    },
    steps: [
      {
        title: 'Guns first',
        text: 'The 2S6M Tunguska is point defence built around two twin 30 mm guns with 2400 rounds, backed by eight short-range missiles. It protects the airbase against drones, cruise missiles and helicopters. In this lesson nothing is scored and nothing can be destroyed.',
        hi: ['header'],
      },
      {
        title: 'The search scope',
        text: 'The round scope at the lower left is the search radar (24 km), plan view, north up. A drone has appeared to the west-southwest. The table beside it lists the tracks. The big picture at the top is the optical sight: the missiles are guided through it, and it also lays the guns when the gun radar is off.',
        hi: ['scope', 'range', 'sight'],
        enter: (T) => T.spawn('a', 'drone', { bearing: FROM, range: 13500 }),
        tick: keeper('a', 'drone', { bearing: FROM, range: 13500 }),
      },
      {
        title: 'Select the drone',
        text: 'Click the mark on the scope, click its row in the table, or press Tab.',
        goal: 'Select the drone track',
        hi: ['scope', 'tracks'],
        tick: keeper('a', 'drone', { bearing: FROM, range: 13500 }),
        done: (T) => selectedIs(T, 'a'),
      },
      {
        title: 'Take manual control',
        text: 'AUTO lets the crew choose; MANUAL fires only on your orders; HOLD is weapons safe.',
        goal: 'Set MODE to MANUAL',
        hi: ['mode'],
        tick: keeper('a', 'drone', { bearing: FROM, range: 13500 }),
        done: (T) => T.u.mode === 'manual',
      },
      {
        title: 'Hold to fire the guns',
        text: 'A drone is coming in low and close: select it. GUNS is the selected weapon (G switches). The fire control computes where the target will be when the shells arrive, the lead, and swings the guns onto it, so you do not aim ahead yourself. The IN GUN RANGE lamp lights inside about 2 km; then hold FIRE GUNS (or hold Space) until it falls. Releasing stops the fire.',
        goal: 'Shoot the drone down with the guns',
        hi: ['weapon', 'trigger', 'lamps', 'track-radar'],
        enter: (T) => {
          T.clear();
          topUp(T);
          T.spawn('b', 'drone', { bearing: FROM + 10, range: 2600 });
        },
        tick: keeper('b', 'drone', { bearing: FROM + 10, range: 2600 }),
        done: (T) => T.killedBy('b', '30mm'),
      },
      {
        title: 'Heat and ammunition',
        text: 'Long bursts heat the barrels: the BARREL HEAT bar climbs while you hold the trigger and falls when you release, and a gun that overheats stops until it cools. Fire in bursts of a second or two at a target you are sure of. The ROUNDS counter shows the 2400 rounds; a supply column refills it between raids.',
        hi: ['heat', 'stock', 'trigger'],
        enter: (T) => T.clear(),
      },
      {
        title: 'The missile channel',
        text: 'The eight 9M311 missiles reach about 10 km, far past the guns. They have no radar guidance: the optical sight alone guides them, silently, so it needs a clear line of view and reaches about 12 km (less in poor visibility). The sight follows the selected target by itself; the arrow keys slew it. One target at a time, fired as a pair.',
        hi: ['weapon', 'sight', 'stock'],
      },
      {
        title: 'When to use missiles',
        text: 'Guns for what is close, missiles for what is still far. A drone is coming from 8 km, well outside the guns. Switch to MISSILES (G), select the drone and press LAUNCH MISSILES (or Space). Keep the target in the sight until it is hit; if the sight loses it, the guidance is lost.',
        goal: 'Shoot the drone down with a missile',
        hi: ['weapon', 'launch', 'sight', 'salvo'],
        enter: (T) => T.spawn('c', 'drone', { bearing: FROM - 8, range: 8000 }),
        tick: keeper('c', 'drone', { bearing: FROM - 8, range: 8000 }),
        done: (T) => T.killedBy('c', '9M311'),
      },
      {
        title: 'The search radar',
        text: 'The search radar and the gun radar both emit, so both can be found and attacked. The missiles need neither: the optical channel is passive and the guns can use it too (GUNS LAID BY, TV / IR). Switch the search radar off, then back on.',
        goal: 'Switch the SEARCH RADAR off, then on again',
        hi: ['search', 'track-radar', 'src'],
        enter: (T) => T.clear(),
        tick: (T) => {
          if (!T.u.radar.search) T.mem.off = true;
        },
        done: (T) => !!T.mem.off && T.u.radar.search,
      },
      {
        title: 'Reloading',
        text: 'The launcher holds eight missiles and 24 more are stowed. RELOAD MISSILES (L) feeds it back up; this takes a while and the missiles cannot fire meanwhile, though the guns can. Watch the RELOAD bar.',
        goal: 'Press RELOAD and wait until it finishes',
        hi: ['reload', 'stock'],
        enter: (T) => {
          T.clear();
          needReload(T);
        },
        done: reloaded,
      },
    ],
  },

  {
    id: 'tor',
    name: 'Tor-M2',
    unit: 'TOR',
    loadout: swap(3, 'tor'),
    blurb: 'Replaces the Osa: the tracking sector, four targets at once, the vertical launch, salvoes and reloading.',
    outro: 'The Tor works a sector with several channels: keep the threats inside the wedge, take them one round at a time, and keep the cells filled.',
    setup: (T) => {
      T.u.mode = 'hold';
    },
    steps: [
      {
        title: 'The Tor-M2',
        text: 'The Tor-M2 replaces the Osa as the short-range missile unit: eight missiles in vertical cells, a search radar, and a tracking array on the turret that can hold four targets at once. It is quick to react and best against small, fast targets. In this lesson nothing is scored and nothing can be destroyed.',
        hi: ['header'],
      },
      {
        title: 'The scope and the sector',
        text: 'The green scope is the search radar. The amber wedge laid over it is the tracking array\'s sector: it holds targets only inside it, to 18 km, and the turret turns to face the middle of its engagements. A drone has appeared to the west-southwest. The TARGET IN SECTOR lamp says whether the selected track is inside the wedge.',
        hi: ['scope', 'sector', 'range'],
        enter: (T) => T.spawn('a', 'drone', { bearing: FROM, range: 11000 }),
        tick: keeper('a', 'drone', { bearing: FROM, range: 11000 }),
      },
      {
        title: 'Select the drone',
        text: 'Click the mark on the scope, click its row in the table, or press Tab.',
        goal: 'Select the drone track',
        hi: ['scope', 'tracks'],
        tick: keeper('a', 'drone', { bearing: FROM, range: 11000 }),
        done: (T) => selectedIs(T, 'a'),
      },
      {
        title: 'Take manual control',
        text: 'AUTO lets the crew choose, and it fires pairs; MANUAL fires only on your orders; HOLD is weapons safe.',
        goal: 'Set MODE to MANUAL',
        hi: ['mode'],
        tick: keeper('a', 'drone', { bearing: FROM, range: 11000 }),
        done: (T) => T.u.mode === 'manual',
      },
      {
        id: 'one',
        title: 'Launch one missile',
        text: 'Press LAUNCH 1 MISSILE (or Space). The turret turns the array onto the target, the first channel takes it (see the TRACKING CHANNELS panel), and the missile is cold-launched: a gas charge ejects it straight up out of its cell, and half a second later the motor lights and it turns toward the target. The cells show which rounds are left.',
        goal: 'Shoot the drone down with one missile',
        hi: ['launch', 'channels', 'stock', 'eng-lamps'],
        tick: (T) => {
          keeper('a', 'drone', { bearing: FROM, range: 11000 })(T);
          if (T.respawned) T.goto('one');
        },
        done: (T) => T.killedBy('a', '9M338'),
      },
      {
        id: 'many',
        title: 'Several targets at once',
        text: 'Three drones, spread across the sector. The Tor has four channels: launch at one, then select another and launch while the first missile flies, and each gets its own row in TRACKING CHANNELS. Work from the one that arrives first (TTI in the table).',
        goal: 'Have two engagements running at the same time',
        hi: ['channels', 'tracks', 'launch', 'sector'],
        enter: (T) => {
          T.clear();
          T.spawn('b', 'drone', { bearing: FROM - 22, range: 10500 });
          T.spawn('c', 'drone', { bearing: FROM, range: 11500 });
          T.spawn('d', 'drone', { bearing: FROM + 22, range: 12500 });
        },
        tick: (T) => {
          keeper('b', 'drone', { bearing: FROM - 22, range: 10500 })(T);
          keeper('c', 'drone', { bearing: FROM, range: 11500 })(T);
          keeper('d', 'drone', { bearing: FROM + 22, range: 12500 })(T);
          if (liveEngagements(T) >= 2) T.mem.two = true;
        },
        done: (T) => !!T.mem.two,
      },
      {
        title: 'Finish them',
        text: 'Keep going until all three are down. A target outside the sector is refused while other engagements run (OUT: ENGAGEMENT BLOCKED), since the array cannot turn away from the ones it is holding; take what is inside first. CEASE FIRE (X) frees a channel if you picked wrong.',
        goal: 'Destroy all three drones',
        hi: ['channels', 'launch', 'sector', 'cease'],
        tick: (T) => {
          keeper('b', 'drone', { bearing: FROM - 22, range: 10500 })(T);
          keeper('c', 'drone', { bearing: FROM, range: 11500 })(T);
          keeper('d', 'drone', { bearing: FROM + 22, range: 12500 })(T);
        },
        done: (T) => T.killedBy('b') && T.killedBy('c') && T.killedBy('d'),
      },
      {
        id: 'salvo',
        title: 'A salvo',
        text: 'LAUNCH SALVO OF 2 (Shift+Space) fires two missiles at one target a moment apart for a better chance. The Tor is good enough against small targets that single rounds usually do; the pair is for a target you cannot afford to miss. Rounds cost 14 each.',
        goal: 'Launch a salvo of two missiles and destroy the drone',
        hi: ['salvo', 'stock'],
        enter: (T) => {
          T.clear();
          T.spawn('e', 'drone', { bearing: FROM - 10, range: 11000 });
        },
        tick: (T) => {
          keeper('e', 'drone', { bearing: FROM - 10, range: 11000 })(T);
          if (T.respawned) T.goto('salvo');
        },
        done: (T) => (T.mem.launched ?? 0) >= 2 && T.killedBy('e'),
      },
      {
        title: 'Reloading',
        text: 'The cells hold eight; twelve more wait in reserve. RELOAD CELLS (L) fills them back up, which takes a while and leaves the unit unable to fire. Watch the RELOAD bar.',
        goal: 'Press RELOAD and wait until it finishes',
        hi: ['reload', 'stock'],
        enter: (T) => {
          T.clear();
          needReload(T);
        },
        done: reloaded,
      },
    ],
  },

  {
    id: 'shilka',
    name: 'ZSU-23-4M4 Shilka',
    unit: 'SHK',
    loadout: swap(4, 'shilka'),
    blurb: 'Replaces the Strela: radar or optical tracking, the lead mark, bursts and heat, a very short reach, and a radar that emits.',
    outro: 'The Shilka is a gun for the last two kilometres: let the fire control lead, fire short bursts only when it is in range, and remember the dish is a target.',
    setup: (T) => {
      T.u.mode = 'hold';
    },
    steps: [
      {
        title: 'Guns only',
        text: 'The Shilka-M4 has four 23 mm barrels, 2400 rounds and no missiles. One radar dish both searches and tracks. It replaces the Strela, and unlike the Strela it emits. In this lesson nothing is scored and nothing can be destroyed.',
        hi: ['header'],
      },
      {
        title: 'The scope and the dish',
        text: 'The round scope is the dish\'s picture, plan view, north up, and the line under it says what the antenna is doing. A drone has appeared to the west-southwest. The table beside it lists the tracks.',
        hi: ['scope', 'range', 'tracks'],
        enter: (T) => T.spawn('a', 'drone', { bearing: FROM, range: 9000 }),
        tick: keeper('a', 'drone', { bearing: FROM, range: 9000 }),
      },
      {
        title: 'Take manual control',
        text: 'AUTO lets the crew choose; MANUAL fires only on your orders; HOLD is weapons safe.',
        goal: 'Set MODE to MANUAL',
        hi: ['mode'],
        tick: keeper('a', 'drone', { bearing: FROM, range: 9000 }),
        done: (T) => T.u.mode === 'manual',
      },
      {
        id: 'pick',
        title: 'Select the drone',
        text: 'Click the mark on the scope, click its row in the table, or press Tab. In MANUAL the selected track becomes the guns\' target.',
        goal: 'Select the drone track',
        hi: ['scope', 'tracks'],
        tick: keeper('a', 'drone', { bearing: FROM, range: 9000 }),
        done: (T) => selectedIs(T, 'a'),
      },
      {
        title: 'Radar tracking',
        text: 'The dish tracks one target to about 6 km; the fire control reads its range and speed from it. The drone is selected, so once it is inside that range the dish goes to TRACK on its own and swings onto it: wait for the LOCKED ON lamp. T switches TRACK off and on by hand. TRACKING BY says what is laying the guns: RADAR while the dish is tracking.',
        goal: 'Wait for the dish to lock on (LOCKED ON)',
        hi: ['track-radar', 'lamps', 'src'],
        tick: (T) => {
          keeper('a', 'drone', { bearing: FROM, range: 9000 })(T);
          if (T.respawned) T.goto('pick');
        },
        done: (T) => T.u.radar.track && !!T.u.channel?.locked,
      },
      {
        title: 'The lead mark',
        text: 'Shells take time to arrive, so the guns are not laid on the target but ahead of it. Once the target is inside the shells\' reach, about 2 km, the fire control shows that lead point in the sight as a yellow ring with the УПР label, joined to the target by a dashed line; LEAD m reads the distance. You never aim ahead yourself.',
        goal: 'Wait until the lead mark appears in the sight',
        hi: ['sight', 'lamps'],
        tick: (T) => {
          keeper('a', 'drone', { bearing: FROM, range: 9000 })(T);
          if (T.respawned) T.goto('pick');
        },
        done: (T) => !!T.u.weapons.gun?.aimOk,
      },
      {
        title: 'Open fire',
        text: 'The shells fall away fast: the 23 mm self-destructs at about 1.9 km and the fire control opens up inside about 1.4 km, so this is a very short range gun. The IN GUN RANGE lamp lights when the drone is near enough. Then hold FIRE (or hold Space) until it falls.',
        goal: 'Shoot the drone down with the guns',
        hi: ['lamps', 'trigger', 'sight'],
        tick: (T) => {
          keeper('a', 'drone', { bearing: FROM, range: 9000 })(T);
          if (T.respawned) T.goto('pick');
        },
        done: (T) => T.killedBy('a', '23mm'),
      },
      {
        title: 'Bursts and heat',
        text: 'The guns fire 75 rounds a second, so 2400 rounds last about half a minute of trigger. Fire short bursts at a target in range: the BARREL HEAT bar climbs while you hold the trigger and a gun that overheats stops until it cools. BURSTS counts your presses.',
        hi: ['heat', 'stock', 'trigger'],
        enter: (T) => T.clear(),
      },
      {
        id: 'optical',
        title: 'The optical fallback',
        text: 'With the dish off the guns are laid through the optical sight instead, with no emission to give you away; the sight follows the selected target by itself, and the arrow keys slew it if it drifts. A new drone is coming: select it, switch the dish off (T), keep the search radar on, and shoot it down.',
        goal: 'Select the drone, switch the dish off and shoot it down',
        hi: ['track-radar', 'src', 'sight', 'trigger'],
        enter: (T) => {
          T.clear();
          topUp(T);
          T.spawn('b', 'drone', { bearing: FROM + 12, range: 3000 });
        },
        tick: (T) => {
          keeper('b', 'drone', { bearing: FROM + 12, range: 3000 })(T);
          if (!T.u.radar.track && T.u.weapons.gun?.firing) T.mem.eo = true;
          if (T.respawned) T.mem.eo = false;
        },
        done: (T) => T.killedBy('b', '23mm') && !!T.mem.eo,
      },
      {
        id: 'arm-off',
        title: 'The dish emits',
        text: 'ARM INBOUND! An anti-radar missile is homing on the Shilka: a radar that is on can be found, which is the price of the dish. It cannot hit one that is switched off. Switch the search radar and the tracking radar off (R and T).',
        goal: 'Switch both radars off',
        hi: ['search', 'track-radar'],
        enter: (T) => {
          T.clear();
          T.u.radar.search = true;
          T.spawnArm(34000);
        },
        tick: (T) => T.armWatch('arm-off'),
        done: (T) => !T.u.radar.search && !T.u.radar.track,
      },
      {
        id: 'arm-wait',
        title: 'Stay dark',
        text: 'The scope shows nothing while the dish is silent. Keep it off until the missile has gone by.',
        goal: 'Wait for the missile to miss',
        hi: ['search'],
        tick: (T) => T.armWatch('arm-off'),
        done: (T) => !T.threats.get('arm')?.alive && !T.u.radar.search && !T.u.radar.track,
      },
      {
        title: 'Back on the air',
        text: 'It missed. Switch the search radar back on.',
        goal: 'Switch the search radar on',
        hi: ['search'],
        done: (T) => T.u.radar.search,
      },
    ],
  },
];

// ---------------------------------------------------------------------------------------------------
export class Tutorials {
  /**
   * sim: the Sim. hud: the HUD. host: what only main can do: enter(def) (starts the scripted game and
   * selects the unit), leave() (back to the demonstration battle), cam(), scale(), setScale(k),
   * selectedId(), padlock(), following(), hint(text).
   */
  constructor({ sim, hud, host }) {
    this.sim = sim;
    this.hud = hud;
    this.host = host;
    this.run = null; // the lesson in progress
    this.defs = []; // the era's lessons (buildMenu)
    this.done = this.load();
    this.card = document.getElementById('tut-card');
    this.menu = document.getElementById('tut-menu');
    this.q = (s) => this.card.querySelector(s);
    this.buildMenu();
    document.getElementById('tut-back').addEventListener('click', () => this.closeMenu());
    // the card's buttons must not take keyboard focus, or Space would press them instead of the console
    for (const b of this.card.querySelectorAll('button')) b.addEventListener('pointerdown', (e) => e.preventDefault());
    this.q('#tc-next').addEventListener('click', () => this.next());
    this.q('#tc-skip').addEventListener('click', () => (this.run?.finished ? this.start(this.run.def.id) : this.next(true)));
    this.q('#tc-exit').addEventListener('click', () => this.exit());
  }

  get active() {
    return !!this.run;
  }

  // ---------------------------------------------------------------- the list
  load() {
    try {
      return JSON.parse(localStorage.getItem(STORE)) ?? {};
    } catch (e) {
      return {};
    }
  }

  save() {
    try {
      localStorage.setItem(STORE, JSON.stringify(this.done));
    } catch (e) { /* private mode */ }
  }

  // the lessons the era in play offers (its `tutorials`); built again when the era changes
  buildMenu() {
    this.defs = ERA.tutorials.map((id) => TUTORIALS.find((d) => d.id === id)).filter(Boolean);
    const list = document.getElementById('tut-list');
    list.replaceChildren();
    this.items = new Map();
    for (const d of this.defs) {
      const b = document.createElement('button');
      b.className = 'tut-item';
      b.type = 'button';
      b.dataset.id = d.id;
      b.innerHTML = '<span class="ti-mark">✓</span><b></b><i></i>';
      b.querySelector('b').textContent = d.name;
      b.querySelector('b').insertAdjacentHTML('beforeend', `<small>${d.steps.length} steps</small>`);
      b.querySelector('i').textContent = d.blurb;
      b.addEventListener('click', () => this.start(d.id));
      list.append(b);
      this.items.set(d.id, b);
    }
    this.refreshMenu();
  }

  refreshMenu() {
    for (const [id, b] of this.items) b.classList.toggle('done', !!this.done[id]);
  }

  openMenu() {
    this.refreshMenu();
    this.hud.showTutorialMenu(true);
  }

  closeMenu() {
    this.hud.showTutorialMenu(false);
  }

  get menuOpen() {
    return document.body.classList.contains('tut-menu');
  }

  // Esc: a lesson goes back to the list, the list back to the title. True when it was used.
  escape() {
    if (this.run) {
      this.exit();
      return true;
    }
    if (this.menuOpen && document.body.classList.contains('title')) {
      this.closeMenu();
      return true;
    }
    return false;
  }

  // ---------------------------------------------------------------- running a lesson
  start(id) {
    const def = this.defs.find((d) => d.id === id);
    if (!def) return;
    if (this.run) this.stopRun();
    this.hud.showTutorialMenu(false);
    this.host.enter(def);
    this.u = this.sim.unitById.get(def.unit);
    this.threats = new Map();
    this.killed = new Map();
    this.group = 1;
    this.mem = {};
    this.respawned = false;
    this.baseScale = 1;
    this.run = { def, i: -1, finished: false, ok: false, doneT: 0, lastWant: undefined };
    // everything else stands down and stays out of the way
    for (const o of this.sim.units) if (o !== this.u) o.mode = 'hold';
    def.setup?.(this);
    this.hud.setTutorial(true);
    this.goto(0);
  }

  stopRun() {
    setHighlight([]);
    this.run = null;
    this.threats = new Map();
  }

  exit() {
    if (!this.run) return;
    this.stopRun();
    this.hud.setTutorial(false);
    this.host.leave();
    this.openMenu();
  }

  goto(i) {
    const run = this.run;
    if (typeof i === 'string') i = run.def.steps.findIndex((s) => s.id === i);
    if (i < 0) return;
    if (i >= run.def.steps.length) return this.finish();
    run.i = i;
    run.ok = false;
    run.doneT = 0;
    run.lastWant = undefined;
    this.mem = {};
    this.respawned = false;
    const step = run.def.steps[i];
    step.enter?.(this);
    setHighlight(step.hi ?? []);
    this.render();
  }

  next(skip = false) {
    const run = this.run;
    if (!run || run.finished) return;
    const step = run.def.steps[run.i];
    if (step.done && !run.ok && !skip) return;
    this.goto(run.i + 1);
  }

  finish() {
    const run = this.run;
    run.finished = true;
    this.done[run.def.id] = true;
    this.save();
    this.refreshMenu();
    this.clear();
    setHighlight([]);
    this.setScale(this.baseScale);
    this.render();
  }

  // per frame, after the sim has stepped
  update(rawDt) {
    const run = this.run;
    if (!run || run.finished) return;
    const step = run.def.steps[run.i];
    this.respawned = false;
    step.tick?.(this, rawDt);
    // time compression is the player's (the buttons by the readout, or [ ]); the lessons never change it
    if (!step.done) return;
    if (!run.ok && step.done(this)) {
      run.ok = true;
      run.doneT = 0;
      this.render();
    }
    if (run.ok) {
      run.doneT += rawDt;
      if (run.doneT > 1.3) this.next();
    }
  }

  // ---------------------------------------------------------------- the card
  render() {
    const run = this.run;
    if (!run) return;
    const def = run.def;
    const n = def.steps.length;
    const card = this.card;
    card.classList.toggle('ok', run.ok);
    card.classList.toggle('finish', run.finished);
    this.q('.tc-name').textContent = def.name;
    const bar = this.q('.tc-bar i');
    if (run.finished) {
      this.q('.tc-step').textContent = 'complete';
      bar.style.width = '100%';
      this.q('.tc-title').textContent = 'Lesson complete';
      this.q('.tc-text').textContent = def.outro;
      this.q('.tc-goal').hidden = true;
      this.q('#tc-exit').textContent = 'Back to tutorials';
      this.q('#tc-skip').textContent = 'Replay';
      this.q('#tc-skip').hidden = false;
      this.q('#tc-skip').disabled = false;
      this.q('#tc-next').hidden = true;
      return;
    }
    const step = def.steps[run.i];
    this.q('.tc-step').textContent = `step ${run.i + 1} / ${n}`;
    bar.style.width = `${(run.i / n) * 100}%`;
    this.q('.tc-title').textContent = step.title;
    this.q('.tc-text').textContent = step.text;
    const goal = this.q('.tc-goal');
    goal.hidden = !step.goal;
    goal.querySelector('span').textContent = step.goal ?? '';
    this.q('#tc-exit').textContent = 'Exit';
    const skip = this.q('#tc-skip');
    skip.textContent = 'Skip step';
    skip.hidden = !step.done;
    skip.disabled = false;
    const next = this.q('#tc-next');
    next.hidden = false;
    next.textContent = run.i === n - 1 && !step.done ? 'Finish' : 'Next';
    next.disabled = !!step.done && !run.ok;
  }

  // ---------------------------------------------------------------- script helpers (T)
  setScale(k) {
    this.host.setScale(k);
  }

  hint(text) {
    this.host.hint(text);
  }

  // a threat `range` m from the unit on a compass bearing; `key` names it for the checks
  spawn(key, type, o = {}) {
    const sim = this.sim, u = this.u;
    const b = o.bearing ?? FROM;
    const start = fromBearingVec(b, o.range ?? 10000, new THREE.Vector3());
    start.x += u.pos.x;
    start.z += u.pos.z;
    start.y = sim.heightAt(start.x, start.z);
    // aim a little to one side so a drone that gets through lands beside the vehicle
    const side = o.side ?? 90;
    const target = { kind: 'unit', id: u.id, pos: new THREE.Vector3(u.pos.x + Math.cos(b * DEG) * side, u.pos.y + 2, u.pos.z + Math.sin(b * DEG) * side) };
    const t = sim.threatAI.spawnOne(type, start, target, { ...o, group: this.group++ }, 0);
    if (t) this.threats.set(key, t);
    return t;
  }

  // an anti-radar missile from a point `range` m out, aimed at the unit's search radar
  spawnArm(range) {
    const sim = this.sim, u = this.u;
    const start = fromBearingVec(FROM, range, new THREE.Vector3());
    start.x += u.pos.x;
    start.z += u.pos.z;
    start.y = sim.heightAt(start.x, start.z) + 2500;
    const part = u.parts[3] ?? u.parts[0];
    const target = { kind: 'unit', id: u.id, pos: part.pos.clone().setY(part.pos.y + 4) };
    const t = sim.threatAI.launchWeapon('arm', { pos: start, id: 0, group: this.group++, speed: 700, radius: 2 }, target);
    this.threats.set('arm', t);
    return t;
  }

  // retry the anti-radar missile when it reached the unit with the radar on
  armWatch() {
    const a = this.threats.get('arm');
    if (!a || !isGone(a) || this.mem.armHandled === a.id) return;
    this.mem.armHandled = a.id;
    if (this.u.radar.search) {
      this.hint('It found the radar because the emitter was on. Another is coming: switch it off in time.');
      this.goto('arm-off');
    }
  }

  // keep a contact alive: respawn it when it was lost without the unit killing it
  keep(key, make) {
    const t = this.threats.get(key);
    if (!t) {
      make();
      return true;
    }
    // a fighter that has turned for home is out of the lesson
    if (t.alive && t.phase === 'egress' && t.type === 'fighter' && !flying(this)) this.sim.remove(t);
    if (isGone(t) && !this.killed.has(t.id)) {
      make();
      this.respawned = true;
      this.hint('Another target is on the way.');
      return true;
    }
    return false;
  }

  killedBy(key, weapon) {
    const t = this.threats.get(key);
    const w = t && this.killed.get(t.id);
    return !!w && (!weapon || w === weapon);
  }

  // remove everything that is still flying
  clear() {
    for (const t of this.sim.threats) if (!t.dead && (t.alive || t.falling)) this.sim.remove(t);
    this.threats.clear();
    this.u.selected = null;
  }

  // ---------------------------------------------------------------- events from main
  onKill(t, by) {
    if (this.run && by.unitId === this.u?.id) this.killed.set(t.id, by.weapon);
  }

  onLaunch(u, m) {
    if (!this.run || u.id !== this.u.id) return;
    this.mem.launched = (this.mem.launched ?? 0) + 1;
    (this.mem.guides ??= new Set()).add(m.guide ?? m.part);
  }

  onRadio(text) {
    if (this.run && /all channels busy/.test(text)) this.mem.busy = true;
  }
}
