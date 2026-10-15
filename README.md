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

A third app in the `rpg/` module: a top-down dark-fantasy action RPG in the spirit of Diablo and classic Zelda. Procedurally generated dungeon floors with torch lighting, dynamic darkness and particles; a virtual joystick, sword swings, fireball and whirlwind skills; skeletons, slimes, bats, orc brutes and a demon boss every third floor; randomised loot in four rarities that auto-equips when it is better; XP and levels; a minimap; and a saved hero. All graphics are drawn in code and all sounds are synthesised, so the app has no external assets. Download `skyggernes-dyb-apk` from the CI run.
