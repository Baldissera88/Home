# Victor's Bricks

A friendly tapping game for young kids, written in Kotlin with Jetpack Compose. Toy bricks with animal faces float up; tap to pop them. A voice counts the pops out loud and cheers Victor on. **Colours** mode asks for one colour at a time. Speaks Danish or English (tap the flag on the start screen). No ads, no internet, no way to lose.

## Build

- **Android Studio:** open this folder and press Run.
- **Command line:** `./gradlew assembleDebug` (requires the Android SDK). The APK is written to `app/build/outputs/apk/debug/`.
- **GitHub Actions:** every push builds a debug APK. Download it from the workflow run's **Artifacts** (`home-debug-apk`).

Requirements: JDK 17+, Android SDK 35. Min Android version: 8.0 (API 26).

## Filuccas Klodser

A second app in the `filucca/` module with two games: a falling-blocks puzzle game (Danish UI) with toy-brick styling, levels, a saved high score, a ghost piece, and spoken cheers for Filucca; and Klods-Blast, a drag-and-drop 8x8 block puzzle where full rows and columns clear, with combos and its own high score. It installs separately from Victor's Bricks and has its own icon.

GitHub Actions builds both apps; download `victors-bricks-apk` or `filuccas-klodser-apk` from the run's Artifacts.
