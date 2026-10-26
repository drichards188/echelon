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

Only the Yle archive recording requires attribution: "Tykki, laukaus / Big gun, cannon, 76 mm, single
shots, gunshots" by YleArkisto (https://freesound.org/s/332935/), licensed under CC BY 4.0. The rest are
CC0 and credited as a courtesy.

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
