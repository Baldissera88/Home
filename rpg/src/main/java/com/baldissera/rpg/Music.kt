package com.baldissera.rpg

import android.content.Context
import android.media.MediaPlayer
import kotlin.math.min

/** Looping background music that crossfades when the area changes. */
class Music(private val context: Context) {
    private var current = 0
    private var player: MediaPlayer? = null
    private var fading: MediaPlayer? = null
    private var fade = 1f
    private var paused = false
    var volume = 0.55f
    var enabled = true
        set(value) {
            field = value
            if (!value) {
                player?.release()
                fading?.release()
                player = null
                fading = null
                current = 0
            }
        }

    fun play(resId: Int) {
        if (!enabled || resId == current || paused) return
        current = resId
        fading?.release()
        fading = player
        player = runCatching {
            MediaPlayer.create(context, resId)?.apply {
                isLooping = true
                setVolume(0f, 0f)
                start()
            }
        }.getOrNull()
        fade = 0f
    }

    /** Advances the crossfade; call once per frame. */
    fun tick(dt: Float) {
        if (fade >= 1f && fading == null) return
        fade = min(1f, fade + dt / 1.8f)
        player?.setVolume(volume * fade, volume * fade)
        fading?.let {
            val v = volume * (1f - fade)
            if (v <= 0.01f) {
                it.release()
                fading = null
            } else {
                it.setVolume(v, v)
            }
        }
    }

    fun pause() {
        paused = true
        player?.pause()
        fading?.release()
        fading = null
    }

    fun resume() {
        paused = false
        if (enabled) player?.start()
    }

    fun release() {
        player?.release()
        fading?.release()
        player = null
        fading = null
    }
}
