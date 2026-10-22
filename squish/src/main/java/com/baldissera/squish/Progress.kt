package com.baldissera.squish

import android.content.SharedPreferences
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue

/**
 * Saved progress: best stars and best score per level, the highest unlocked level and the sound toggles.
 * Values the screens read are backed by Compose state, so the level map updates as soon as a level is won.
 */
class Progress(private val prefs: SharedPreferences) {
    /** Bumped on every change so composables that read [stars]/[best] recompose. */
    private var version by mutableIntStateOf(0)

    /** Highest level number the player may start (1-based). */
    var unlocked by mutableIntStateOf(prefs.getInt(KEY_UNLOCKED, 1).coerceAtLeast(1))
        private set

    var soundOn by mutableStateOf(prefs.getBoolean(KEY_SOUND, true))
        private set
    var musicOn by mutableStateOf(prefs.getBoolean(KEY_MUSIC, true))
        private set

    fun stars(level: Int): Int {
        version
        return prefs.getInt("stars_$level", 0)
    }

    fun best(level: Int): Int {
        version
        return prefs.getInt("best_$level", 0)
    }

    val totalStars: Int
        get() {
            version
            return (1..unlocked).sumOf { prefs.getInt("stars_$it", 0) }
        }

    /** Records a won level; keeps the best stars/score and unlocks the next level (up to [maxLevel]). */
    fun recordWin(level: Int, stars: Int, score: Int, maxLevel: Int) {
        val e = prefs.edit()
        if (stars > prefs.getInt("stars_$level", 0)) e.putInt("stars_$level", stars)
        if (score > prefs.getInt("best_$level", 0)) e.putInt("best_$level", score)
        val next = (level + 1).coerceAtMost(maxLevel)
        if (next > unlocked) {
            unlocked = next
            e.putInt(KEY_UNLOCKED, next)
        }
        e.apply()
        version++
    }

    fun updateSound(on: Boolean) {
        soundOn = on
        prefs.edit().putBoolean(KEY_SOUND, on).apply()
    }

    fun updateMusic(on: Boolean) {
        musicOn = on
        prefs.edit().putBoolean(KEY_MUSIC, on).apply()
    }

    private companion object {
        const val KEY_UNLOCKED = "unlocked"
        const val KEY_SOUND = "sound"
        const val KEY_MUSIC = "music"
    }
}
