# History and sources

Back to the [README](../README.md).

The systems keep their real names, look and place in the layering, and the WW2 setting is researched from period sources. The mechanics are game rules with gameplay values (`DESIGN.md`, "Simulation fidelity").

## What is real

- **The systems:** their names, their look and their place in the layering.
- **The WW2 setting:** Fliegerhorst Hopsten, a jet airfield in north-west Germany and the Me 262 base of KG 51, against the Allied day raids of February and March 1945. The guns, the Kommandogeraet 40, the Wuerzburg D and Window, the aircraft types and the landscape are real too.
- **"Black X."** The jet in blast bay 1 is the one Me 262 that survives in its original paint, W.Nr. 500200 "Black X" of KG 51.
- **The modern era** has no real date or place: Russian-built systems in Ukrainian markings defend an airbase on the steppe.

## What is game

- **Values.** Every range, rate, hit chance and reload time is a game value tuned for play. The modern alternatives' values are set relative to the defaults, not taken from real figures.
- **Raids.** The raids are scripted and much smaller than the real ones.
- **The flak towers** at Hopsten are a what-if; the real pairs stood in Berlin, Hamburg and Vienna. The pair is built after the first type (the three Berlin towers and Hamburg's Heiligengeistfeld): the gun tower at the Zoo tower's size, 70.5 m square and 39 m, its fire control tower 420 m away (the real pairs stood 385 to 480 m apart). The sources disagree on the light guns in the nests by 1945 (2 cm only, or 3.7 cm as well), so the game mixes them.
- **The runway.** The shared runway lies on 070 where Hopsten's lay about 085.

## The long version

The long version is in `DESIGN.md`:

- **"Simulation fidelity"** (in "Simulation"): the approach.
- **"Loadout":** the alternatives.
- **"WW2 era":** its layout and values, each tied to its source.
- **"Reload scenes":** what is reconstructed.

## Period sources

The code comments cite the period sources, among them:

- the US War Department's TM-E 30-451 *Handbook on German Military Forces*
- TM E9-369A on the 88 mm gun
- TM 9-228 on the 2 cm
- MIS Special Series No. 10 *German Antiaircraft Artillery*
- *Tactical and Technical Trends*
- deZeng's *Luftwaffe Airfields 1935-45*

## Landscape data

- **Heights** (`src/eras/ww2/terrain.js`) are from EU-DEM v1.1 (Copernicus Land Monitoring Service, funded by the European Union) through the opentopodata.org API.
- **The canals, rivers, brooks, lakes and villages** are from © OpenStreetMap contributors (ODbL).

## Research sheets and photos

- **The sheets** (`refs/`, one per vehicle, gun and aircraft, with `refs/ww2/README.md` for the setting, order of battle, raids and sources) are kept locally and are not in the repository.
- **Reference photos and drawings** (mostly Wikimedia Commons, with their licences in each sheet's photo index) are used locally only, in `refs/` (gitignored), to measure the models. Nothing from them ships with the game.
- **Drawings.** The model files name the drawings they were read from.
