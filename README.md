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
- **World.** A camp with a merchant, campfire and healing shrine, then randomly generated floors through the Crypt (1–3), Caves (4–6) and Hell (7+), with dynamic torch lighting, shadows, blood and scorch decals, breakable barrels and urns, treasure chests and buff shrines.
- **Story.** Four bosses — the Skeleton King, the Spider Queen, the Demon Lord and the Shadow King on floor 10 — with a quest log and an ending; the dungeon then continues endlessly.
- **Combat.** Virtual joystick, hold-to-attack with auto-aim, Fireball, Whirlwind and Frost Nova skills with cooldowns and a 5-level skill tree, telegraphed enemy attacks, ranged cultists, summoning bosses and elite champions.
- **Loot.** Six gear slots, four rarities with random affixes (damage, armour, life, crit, mana, life steal, speed), named legendaries, a 24-slot bag with stat comparison, and a shop to buy and sell.
- Synthesised sound effects and ambience; the hero is saved automatically.

Download `skyggernes-dyb-apk` from the CI run.
