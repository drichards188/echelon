# What's modelled

Back to the [README](../README.md).

## Rendering

- **Built in code.** Everything is built in code at load: terrain, trees, vehicles, guns, aircraft, missiles, buildings, the crews and the textures.
- **Working rigs.** Vehicles are rigs with working turrets, launchers, erectors and turning radars. Every round leaves its own canister, tube, cell or rail, and its cover bursts or its lid is thrown off.
- **Terrain.** A clipmap centred on the camera, built from the same height function the simulation uses, so radar masking matches what you see.
  - **Modern:** rolling steppe and farmland with tree windbreaks along the field edges, a river valley and low ridges 9 to 18 km out that hide low flyers.
  - **WW2:** Hopsten and the country round it from real elevation data, with the Dortmund-Ems canal, the Ems and the brooks, small fields with hedgebanks, farmsteads, pine plantations, heath and bog, in late winter.
- **Trees and grass.** Instanced trees with leafy crowns close up and cards for the far rows; GPU grass that follows the crop and the wind, drawn only where the camera looks and thinned when it is high over the ground.
- **Post-processing.** One HDR scene pass shared by the post-processing: ambient occlusion (GTAO, off on the Low preset), auto exposure that adapts like the eye, bloom, god rays and lens flare from the sun's actual brightness on screen, chromatic aberration, tone mapping, SMAA and a colour grade (Natural by default, Newsreel for black and white) with vignette, grain and sharpening.
- **Frame rate.** Each quality preset renders at most a set number of pixels (Medium about what a 1080p screen shows), so a 4K screen costs no more than a 1080p one and the picture is scaled up; when the frame rate drops, the landscape gives up detail first (thinner grass, fewer trees, then no tree shadows) and only then the resolution, so the guns stay sharp longest.
- **Sky.** A physical sky with image-based light baked from it, a shadow map that follows the camera, height fog lit by the sun, drifting cumulus and cloud shadows crossing the ground.
- **Weather.** Four weathers (Clear, Cloudy, Rain, Storm) with rain, lightning, wind and wet surfaces.
- **Sun and night.** The sun's height and bearing can be changed in the settings; below the horizon the sky shows the twilight afterglow, stars and the moon.
- **Effects.** Launch blasts and cold launches, motor plumes and smoke trails, airbursts and flak bursts, bomb craters, strafing runs, spent cases, burning wrecks falling and ground fires.
- **Reload scenes.** The support vehicles drive up and their crews reload: the S-400's 22T6 and 5T58-2, the Buk loader-launcher's crane, the Osa's 9T217, the Tor's 9T244, the Pantsir's transport-loader, the Tunguska's 2F77M, the Strela's crew by hand, the Shilka's ammunition truck.
- **WW2 crews and jets.** The WW2 guns have their crews posed at every station, and parked Me 262s stand in the blast bays. The men's bodies follow their hands through springs (the torso trails, the head settles last), they step as they turn, and their uniforms carry wrinkles and their faces shading.
- **Baked occlusion.** The WW2 guns, instruments and towers darken in their crevices and under their parts from occlusion worked out on the GPU when they are built, at no cost per frame.
- **The flak towers.** The gun tower and its fire control tower are built after the first type's photos (the Zoo and Humboldthain towers in Berlin, Hamburg's Heiligengeistfeld): corner towers with round gun pits, light-flak nests hung on brackets, shuttered window rows, a crowded roof. The 12.8 cm twin follows the surviving mount at Aberdeen, and the Wuerzburg-Riese on the fire control tower the museum sets.
- **Loading drills.** The crews work their guns in time with the sim's loading: at the 8.8 cm a round goes from the ready rack to the fuze setter's cup, to the loader and home by hand; at the 12.8 cm twin each ammunition number takes the next round as it comes up the hoist and hands it to his loader, who lays it in the gun's loading tray, which swings it in behind the breech for the rollers to ram, while the layers sit at their handwheels; the 3.7 cm's loader lays clips on the table as his ammunition numbers bring them; the 2 cm loaders change magazines. The men flinch at each heavy gun's shot. A round is always either in someone's hands or resting in something (a rack, a tray, a hoist), and a man whose work is low or far bends down to it.
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
- **The 8.8 cm in layers.** No recording of a firing 8.8 cm is free to use, so its report is built as a game's gun usually is: a field gun's close crack and body over a 76 mm gun's shots, a synthesized sub thump and the rolling echo off the field. The 12.8 cm is the same, pitched down.
- **Deafened.** A heavy gun fired right beside you dulls everything but the console for a second or two.
- **Where they come from.** All are from Freesound (details in [public/audio/CREDITS.md](../public/audio/CREDITS.md)): by qubodup (two from US government video and one of US Army training), craigsmith, GryffDavid and InMotionAudio under CC0 1.0, and "Tykki, laukaus / Big gun, cannon, 76 mm, single shots, gunshots" by YleArkisto (https://freesound.org/s/332935/), licensed under CC BY 4.0.
