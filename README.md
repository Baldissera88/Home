# Victor's Bricks

A friendly tapping game for young kids, written in Kotlin with Jetpack Compose. Toy bricks with animal faces float up; tap to pop them. A voice counts the pops out loud and cheers Victor on. **Colours** mode asks for one colour at a time. Speaks Danish or English (tap the flag on the start screen). No ads, no internet, no way to lose.

## Build

- **Android Studio:** open this folder and press Run.
- **Command line:** `./gradlew assembleDebug` (requires the Android SDK). The APK is written to `app/build/outputs/apk/debug/`.
- **GitHub Actions:** every push builds a debug APK. Download it from the workflow run's **Artifacts** (`home-debug-apk`).

Requirements: JDK 17+, Android SDK 35. Min Android version: 8.0 (API 26).

## Filuccas Klodser

A second app in the `filucca/` module with two games: a falling-blocks puzzle game (Danish UI) with toy-brick styling, levels, a saved high score, a ghost piece, and spoken cheers for Filucca; and Juvel Blast, a drag-and-drop 8x8 gem puzzle where full rows and columns clear, with combos and its own high score. It installs separately from Victor's Bricks and has its own icon.

GitHub Actions builds both apps; download `victors-bricks-apk` or `filuccas-klodser-apk` from the run's Artifacts.

## Skyggernes Dyb

A third app in the `rpg/` module: a dark-fantasy action RPG in the spirit of Diablo and classic Zelda.

- **Pre-rendered 3D art.** Characters, monsters, props and item icons are 3D models ray-marched offline into sprite sheets (8 facing directions × idle/walk/attack frames), like the original Diablo. Floors and walls are procedurally generated, pre-lit textures. Everything is produced by `tools/forge` (Python + numpy + Pillow) — re-run `python3 tools/forge/forge.py` to regenerate `rpg/src/main/res/drawable-nodpi`.
- **World.** An open overworld (forests, lakes with sandy shores, rocks, ruins, winding paths, day/night cycle) around a walled village with a merchant, campfire and healing shrine. Wolves, bandits and a roaming forest troll get tougher further from the village. Three entrances lead down: the Crypt (floors 1–3), the Caves (4–6, unlocked by beating the Skeleton King) and the Hell gate (7+, unlocked by beating the Spider Queen), with dynamic torch lighting, shadows, decals, breakable barrels and urns, treasure chests and buff shrines.
- **Story.** Four bosses — the Skeleton King, the Spider Queen, the Demon Lord and the Shadow King on floor 10 — with a quest log and an ending; the dungeon then continues endlessly.
- **Combat.** Virtual joystick, hold-to-attack with auto-aim, Fireball, Whirlwind and Frost Nova skills with cooldowns and a 5-level skill tree, telegraphed enemy attacks, ranged cultists, summoning bosses and elite champions.
- **Loot.** Eight gear slots (weapon, shield, helm, armour, gloves, boots, amulet, ring) and six rarities — Normal, Magic, Rare, Epic, Legendary, Mythic — with up to five random affixes (damage, armour, life, crit, mana, life steal, speed, spell power, attack speed, gold find). Six weapon types play differently (sword, axe, mace, dagger, spear, staff) and the hero visibly holds the equipped one. Legendary and mythic items carry special powers (chain lightning, frostbite, phoenix revive, triple fireballs, …). A 24-slot bag with stat comparison, sorting and junk selling, plus a shop with buying, selling and Diablo-style gambling.
- Synthesised sound effects and ambience; the hero is saved automatically.

Download `skyggernes-dyb-apk` from the CI run.

## Pligter & Lommepenge

A fourth app in the `lommepenge/` module: a colourful chores and pocket-money app for the kids (Danish UI).

- **For the kids.** Each child taps their own card and sees today's and this week's chores as big cards with an emoji and a reward. Ticking one off sets off confetti and coins, a coin sound and a spoken cheer; finishing every chore for the day plays a fanfare. A drawn piggy bank shows the balance, a progress bar tracks the savings goal (e.g. LEGO for 300 kr), and the piggy-bank diary lists what came in and went out.
- **For parents** (behind a 4-digit code, default `1234`): approve or reject ticked-off chores, create and edit chores (daily, weekly or one-off, reward, icon, which kids), add or edit kids (name, figure, colour, weekly allowance, savings goal), give a bonus or pay money out, change the code and turn approval off.
- Weekly allowance is added automatically every Monday.
- **Online sharing and iPhone.** Parents can share the family online (Firebase Realtime Database); other phones join with the family code. The same app exists as an installable web app in `web/` for iPhones, published to GitHub Pages, and both versions share the same data. See `web/README.md` for setting up the database.

Download `lommepenge-apk` from the CI run. Screens are rendered by `./gradlew :lommepenge:testDebugUnitTest` and published to `lommepenge/screens/`.
