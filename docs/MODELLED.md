# What's modelled

Back to the [README](../README.md).

## Rendering

- **Built in code.** Everything is built in code at load: terrain, trees, vehicles, guns, aircraft, missiles, buildings, the crews and the textures.
- **Working rigs.** Vehicles are rigs with working turrets, launchers, erectors and turning radars. Every round leaves its own canister, tube, cell or rail, and its cover bursts or its lid is thrown off.
- **Terrain.** A clipmap centred on the camera, built from the same height function the simulation uses, so radar masking matches what you see.
  - **Modern:** rolling steppe and farmland with tree windbreaks along the field edges, a river valley and low ridges 9 to 18 km out that hide low flyers.
  - **WW2:** Hopsten and the country round it from real elevation data, with the Dortmund-Ems canal, the Ems and the brooks, small fields with hedgebanks, farmsteads, pine plantations, heath and bog, in late winter.
- **Trees and grass.** Instanced trees with leafy crowns close up and cards for the far rows; GPU grass that follows the crop and the wind.
- **Post-processing.** One HDR scene pass shared by the post-processing: ambient occlusion (GTAO, off on the Low preset), auto exposure that adapts like the eye, bloom, god rays and lens flare from the sun's actual brightness on screen, chromatic aberration, tone mapping, SMAA and a colour grade (Natural by default, Newsreel for black and white) with vignette, grain and sharpening.
- **Frame rate.** Dynamic resolution keeps the frame rate up.
- **Sky.** A physical sky with image-based light baked from it, a shadow map that follows the camera, height fog lit by the sun, drifting cumulus and cloud shadows crossing the ground.
- **Weather.** Four weathers (Clear, Cloudy, Rain, Storm) with rain, lightning, wind and wet surfaces.
- **Sun and night.** The sun's height and bearing can be changed in the settings; below the horizon the sky shows the twilight afterglow, stars and the moon.
- **Effects.** Launch blasts and cold launches, motor plumes and smoke trails, airbursts and flak bursts, bomb craters, strafing runs, spent cases, burning wrecks falling and ground fires.
- **Reload scenes.** The support vehicles drive up and their crews reload: the S-400's 22T6 and 5T58-2, the Buk loader-launcher's crane, the Osa's 9T217, the Tor's 9T244, the Pantsir's transport-loader, the Tunguska's 2F77M, the Strela's crew by hand, the Shilka's ammunition truck.
- **WW2 crews and jets.** The WW2 guns have their crews posed at every station, and parked Me 262s stand in the blast bays.
- **Sight pictures.** The consoles' sight pictures are the scene rendered a second time from the sight, small, about 15 times a second: a monochrome TV picture for the Pantsir, Tunguska and Shilka, direct optics for the Strela, the WW2 gun sights and the predictor's telescope.

## Simulation

The simulation lives in `src/sim/`: plain logic that also runs headless in Node.

- **Fixed step.** A fixed 0.05 s step; a battle plays out the same way every time from the same seed.
- **Search radars** find a target when the sweeping beam passes it, inside a game range scaled by the target's size, above the earth's curvature and with terrain line of sight.
- **Tracks** coast between sweeps and drop after a few misses.
- **Radar-seeking missiles** can hunt emitting units; they miss when the emitter goes silent in time.
- **Missile flight.** Missiles boost and then slow, turn at a limited rate toward where the target will be, and hit by a game chance.
- **Guidance.** Command-guided rounds need their unit to hold the target and destroy themselves after 3 s without it; the 9M96 and the Strela's 9M37 home on their own seekers.
- **Channels.** A unit engages only as many targets as it has channels, and the Pantsir, Tunguska and Tor take on a new one only every few seconds.
- **Shells** fly with drag and gravity. The guns' fire control leads the target by flying a shell through the same integrator, the scatter grows with the range, and every round bursts or destroys itself when its fuze runs out.
- **Modern threats** fly scripted paths: standoff aircraft that launch and turn back, terrain-hugging cruise missiles on dogleg routes, drone swarms, helicopters popping up from cover with anti-tank missiles, and ballistic arcs. Every weapon in flight can be shot down.
- **WW2 aircraft** fly scripted attack roles (a photo run, strafing passes, dive bombing, rockets, level bombing in squadron boxes, escort). Flak spoils their aim, a damaged bomber falls out of its box, and the bombers throw Window.
- **WW2 guns.** The predictor's solution settles over time, the 8.8 cm and 12.8 cm shells carry time fuzes, each gun traverses and elevates at its own laying speed, and the feeds (hand loading, clips, magazines) set the practical rate of fire.
- **Damage.** Units and the defended buildings have hit points; a unit of several vehicles or guns loses them one at a time.

## Sound

- **Synthesized at load:** launches, guns, blasts, threat engines, the selected vehicle's idling engine and electronics, the Strela's seeker tone, console clicks and alarms, and a sparse score in the briefing and lulls that fades in combat.
- **Distance.** Far sounds arrive late (sound travel) and dull (air absorption); threat engines have Doppler.
- **Voices.** Only the loudest sounds of a frame get a voice, and the rest feed a battle rumble.
- **Recordings.** A few real recordings are cut up and laid over the synthesized sounds; without them the synthesized sounds play.
- **Where they come from.** All are from Freesound (details in [public/audio/CREDITS.md](../public/audio/CREDITS.md)): by qubodup (two from US government video and one of US Army training), craigsmith and GryffDavid under CC0 1.0, and "Tykki, laukaus / Big gun, cannon, 76 mm, single shots, gunshots" by YleArkisto (https://freesound.org/s/332935/), licensed under CC BY 4.0.
