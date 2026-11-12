# Sound credits

Real recordings used by the game's audio engine (`src/audio.js`, `RECORDINGS`). They are cut into
slices at load time and either replace or layer over the procedurally synthesized sounds; without
them the synthesized sounds play. The files are Freesound's 128 kbps preview encodings of the
originals; the licenses apply the same. The last five are the WW2 era's (four copied from MaxGFX: Battle
Stations, which uses them for the same kinds of guns), fetched only while that era is in play.

| File | Source | Author | License |
|---|---|---|---|
| `cannon-shot-187767.mp3` | [Cannon Shot](https://freesound.org/s/187767/) (from US government video) | qubodup | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) |
| `distant-explosions-438693.mp3` | [G43-14-25 Distant Explosions](https://freesound.org/s/438693/) | craigsmith | CC0 1.0 |
| `explosion-182429.mp3` | [Explosion](https://freesound.org/s/182429/) (from US government video) | qubodup | CC0 1.0 |
| `shell-casings-318964.mp3` | [Bouncing Shell Casings (Various Sizes)](https://freesound.org/s/318964/) | GryffDavid | CC0 1.0 |
| `field-artillery-702245.mp3` | [GUNArtl_69thFieldArtilleryGun01](https://freesound.org/s/702245/) | InMotionAudio | CC0 1.0 |
| `gun76-shots-332935.mp3` | [Tykki, laukaus / Big gun, cannon, 76 mm, single shots, gunshots](https://freesound.org/s/332935/) | YleArkisto | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |
| `bofors-burst-486028.mp3` | [R12-33 Large Automatic Artillery](https://freesound.org/s/486028/) | craigsmith | CC0 1.0 |
| `avenger50-160355.mp3` | [Air Defense Artillery Avenger Training .50cal](https://freesound.org/s/160355/) (US Army) | qubodup | CC0 1.0 |
| `rapidfire-486053.mp3` | [R30-43-Rapid-Fire Machine Gun](https://freesound.org/s/486053/) | craigsmith | CC0 1.0 |

In the WW2 era the field gun's close report laid over the 76 mm's shots, with a synthesized sub thump and
rolling echo, is the 8.8 cm's report (close up, and through the distance filters; `heavyShots` in
`src/audio.js`), and the 12.8 cm's pitched down; the automatic artillery is laid over the 3.7 cm's synthesized report; the .50 cal's
single rounds over the 2 cm's; its bursts, three copies out of step, and the machine gun's bursts are the
fighters' strafing; the distant explosions are the 8.8 cm's bursts heard from the ground.

Of these, only the Yle archive recording requires attribution: "Tykki, laukaus / Big gun, cannon, 76 mm, single
shots, gunshots" by YleArkisto (https://freesound.org/s/332935/), licensed under CC BY 4.0. The rest are
CC0 and credited as a courtesy.

## The modern era's launches and guns

Every modern launch and gun is built from these (`recordedTasks`, `REC_LAUNCH` and `REC_GUN` in `src/audio.js`,
in a worker, `src/audioWorker.js`). The files are excerpts cut from the soundtracks of the videos and recordings
below: mixed to mono, high-passed at 20 Hz, some with one gain change, and re-encoded to mp3 (LAME VBR, quality 2).
At load time they are cut into slices, pitched, filtered and layered with synthesized parts.

- **Launches:** each is split where the motor lights, so a cold launch's recorded pop plays at once and its recorded
  motor at the moment the game shows it.
- **Guns:** each is rebuilt round by round from real bursts at the game's rate of fire.

Without the files the synthesized sounds play.

| File | Source | Author | License |
|---|---|---|---|
| `s400-launch-mil94169488.mp3`, `s400-flight-mil94169488.mp3` | [S-400 firing at the Ashuluk Training Ground (2020-09-15)](https://commons.wikimedia.org/?curid=94169488) | Ministry of Defence of the Russian Federation (mil.ru) | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |
| `s400-launch-mil89106996.mp3` | [2nd Air Defense Division's S-400 SAMs firing at the Ashuluk Training Ground](https://commons.wikimedia.org/?curid=89106996) | mil.ru | CC BY 4.0 |
| `s300-recede-mil57807729.mp3` | [S-300, all-army stage of the Keys to the Sky contest](https://commons.wikimedia.org/?curid=57807729) | mil.ru | CC BY 4.0 |
| `tor-launch-mil163275622.mp3` | [A Tor-M1 crew of the Centre group of forces destroys a reconnaissance drone](https://commons.wikimedia.org/?curid=163275622) | mil.ru | CC BY 4.0 |
| `tor-launch-mil163275761.mp3` | [A Tor-M2 crew covers the artillery's positions](https://commons.wikimedia.org/?curid=163275761) | mil.ru | CC BY 4.0 |
| `buk-launch-mil145076957.mp3` | [A Buk-M1 at work](https://commons.wikimedia.org/?curid=145076957) | mil.ru | CC BY 4.0 |
| `shtil-launch-mil116841072.mp3` | [9M317M surface-to-air missiles (3S90M Shtil, frigate Admiral Essen)](https://commons.wikimedia.org/?curid=116841072) | mil.ru | CC BY 4.0 |
| `pantsir-launch-mil57987235.mp3` | [Pantsir-S1, third stage of the Keys to the Sky contest](https://commons.wikimedia.org/?curid=57987235) | mil.ru | CC BY 4.0 |
| `strela10-launch-mil119124134.mp3` | [Airborne Troops air defence combat crews destroy a drone](https://commons.wikimedia.org/?curid=119124134) | mil.ru | CC BY 4.0 |
| `shilka-burst-mil57988260.mp3` | [Eastern Military District air defence troops repel a massed missile and air strike in an exercise in Buryatia](https://commons.wikimedia.org/?curid=57988260) | mil.ru | CC BY 4.0 |
| `zu23-burst-mil149149050.mp3` | [A ZU-23 fireteam of the Southern Grouping of Forces (2024-06-06)](https://commons.wikimedia.org/?curid=149149050) | mil.ru | CC BY 4.0 |
| `gau8-burst-c131797331.mp3` | [A-10 Thunderbolt (Warthog) 30mm GAU cannon](https://commons.wikimedia.org/?curid=131797331) | nicStage | CC BY 4.0 |
| `stinger-launch-dvids563495.mp3` | [B-roll of SHORAD live fire at Artemis Strike](https://commons.wikimedia.org/?curid=188954773) (DVIDS 563495) | US Army, Sgt. 1st Class Jason Epperson | public domain |
| `stinger-launch-dvids533527.mp3` | [2d LAAD Stinger live-fire](https://commons.wikimedia.org/?curid=60535549) (DVIDS 533527) | US Marine Corps, Lance Cpl. Zachary M. Ford | public domain |
| `stinger-launch-dvids834385.mp3` | [Marines fire Stinger missiles in Norway](https://commons.wikimedia.org/?curid=147437753) (DVIDS 834385) | US Marine Corps, Adam Henke | public domain |
| `phalanx-burst-us195837326.mp3` | [Phalanx weapon system firing exercise at Al-Tanf Garrison](https://commons.wikimedia.org/?curid=195837326) (DVIDS 957064) | US Army, Staff Sgt. Fred Brown | public domain |
| `cram-burst-us123700451.mp3` | [C-RAM test fire](https://commons.wikimedia.org/?curid=123700451) (DVIDS 580796) | US Air Force, Senior Airman Ryan Green | public domain |
| `gepard-burst-us137606083.mp3` | [Flakpanzer Gepards and Strykers engage simulated targets (Griffin Shock 23)](https://commons.wikimedia.org/?curid=137606083) (DVIDS 883743) | US Army National Guard, Staff Sgt. Matthew Foster | public domain |
| `hellfire-launch-162368.mp3` | [AGM-114 Hellfire Rocket Missile Launch](https://freesound.org/s/162368/) (from US government video) | qubodup | CC0 1.0 |
| `hawk-launch-67544.mp3`, `hawk-launch-67545.mp3` | [MIM-23 Hawk missile launch 1](https://freesound.org/s/67544/) and [2](https://freesound.org/s/67545/) (from US government video) | qubodup | CC0 1.0 |
| `tow-launch-67541.mp3` | [BGM-71 TOW missile launch 1](https://freesound.org/s/67541/) (from US government video) | qubodup | CC0 1.0 |
| `tomahawk-recede-162379.mp3`, `tomahawk-recede-162380.mp3` | [Tomahawk Missile Rocket Launch 2](https://freesound.org/s/162379/) and [1](https://freesound.org/s/162380/) (from US government video) | qubodup | CC0 1.0 |
| `hobbyrocket-roar-730041.mp3` | [hobby rocket blastoff](https://freesound.org/s/730041/) | reg7783 | CC0 1.0 |

**What each one is.**
- **S-400 (48N6, 9M96):** the S-400's own launches, cut where the motor lights. The 9M96's are pitched up.
- **Tor:** the Tor-M1's and Tor-M2's own, over the Shtil's gas-generator thump.
- **Buk:** the Buk-M1's own, with the Shtil's 9M317M motor laid in.
- **Pantsir:**
  - The 57E6 near is a Hellfire, the Shtil motor and a Stinger. From farther off it is the Pantsir's own.
  - Its 30 mm is the Phalanx and the C-RAM pitched down; from far off it is the GAU-8.
- **Strela-10 (9M37):** a Stinger's pop and motor, with the Strela-10's own under them.
- **Osa (9M33):** the Hawk.
- **Tunguska (9M311):** the Hellfire and the TOW.
- **Shilka:** the ZU-23's 23 mm doubled; from far off, the Shilka's own.
- **Gepard:** the Gepard's own.
- **The motors going away:** the S-400's, the S-300's, the Tomahawks', the Tor's and the Stingers'.

**Attribution (CC BY 4.0).**
- **mil.ru:** the files marked mil.ru are excerpts from videos by the Ministry of Defence of the Russian Federation
  (mil.ru), licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Each is linked above to its
  Wikimedia Commons page, which names the mil.ru original. They are cut, mixed to mono, filtered and re-encoded here.
- **nicStage:** "A-10 Thunderbolt (Warthog) 30mm GAU cannon" by nicStage
  (https://commons.wikimedia.org/?curid=131797331), licensed under CC BY 4.0. It was recorded at the Hardwood Range,
  Volk Field, Wisconsin, in 2011, and is cut and re-encoded here.

**The rest.**
- The US Army, Marine Corps, Air Force and National Guard videos are works of the US federal government, in the
  public domain, and are credited as a courtesy. No endorsement is implied.
- The Freesound recordings are CC0.

**Licence note.** Commons lists the author of the ZU-23 video (149149050) as unknown and gives no licence review on
its page. It carries the Mil.ru template, and the mil.ru portal it comes from (z.mil.ru) states that all of its
material is CC BY 4.0.

## WW2 crew voices (`voice-de/`)

The WW2 era's German callouts (`voice-de/*.mp3`, indexed by `voice-de/lines.json`; played by
`src/eras/ww2/voices.js`) are synthetic speech, not recordings of people: 53 of the clips made for the sibling game
Drumfire, copied unchanged (the ones a flak position can use). They were generated offline with
[Piper](https://github.com/OHF-Voice/piper1-gpl) and two German voices from
[rhasspy/piper-voices](https://huggingface.co/rhasspy/piper-voices); the game adds the field telephone and the open
air at runtime.

| Voice | Speakers used | Who speaks | Dataset licence |
|---|---|---|---|
| `de_DE-mls-medium` (trained from scratch) | MLS speaker ids 194, 159, 101 | the gun commander (194), the loader (159), the Abteilung on the telephone (101) | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |
| `de_DE-thorsten_emotional-medium` | its "angry" speaker (id 1) | the battery officer's shouted commands and alarms | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) |

**Attribution (CC BY 4.0).** The `de_DE-mls-medium` voice was trained on the German part of Multilingual LibriSpeech:
"MLS: A Large-Scale Multilingual Dataset for Speech Research" by Vineel Pratap, Qiantong Xu, Anuroop Sriram, Gabriel
Synnaeve and Ronan Collobert (2020), [openslr.org/94](https://www.openslr.org/94/), licensed under
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) (its audio comes from LibriVox's public-domain audiobooks). The
speech here is new synthesized speech from a model trained on that data, cut, filtered and encoded; it does not reproduce
the dataset's recordings.

**Licence note on the Thorsten voice.** The Thorsten-Voice dataset (Thorsten Müller) is CC0. The `thorsten_emotional`
voice was fine-tuned from Piper's German `thorsten` voice, which was itself fine-tuned from the English `lessac` voice,
whose training data (Blizzard 2013, Lessac Technologies) is under a research licence. That is acceptable for this
source-available, non-commercial project; a commercial release should replace the battery officer's lines with an MLS
speaker, a commercially licensed TTS service or recorded actors.
