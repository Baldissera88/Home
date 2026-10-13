# Home

Balloon Pop — a simple, friendly tapping game for young kids, written in Kotlin with Jetpack Compose. Balloons float up; tap to pop them and collect stars. No ads, no internet, no way to lose.

## Build

- **Android Studio:** open this folder and press Run.
- **Command line:** `./gradlew assembleDebug` (requires the Android SDK). The APK is written to `app/build/outputs/apk/debug/`.
- **GitHub Actions:** every push builds a debug APK. Download it from the workflow run's **Artifacts** (`home-debug-apk`).

Requirements: JDK 17+, Android SDK 35. Min Android version: 8.0 (API 26).
