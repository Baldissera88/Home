package com.baldissera.home.game

import android.content.Context
import android.media.AudioAttributes
import android.media.SoundPool
import android.speech.tts.TextToSpeech
import com.baldissera.home.R
import java.util.Locale
import kotlin.random.Random

/** Sound effects plus a friendly voice that counts and cheers. */
class GameAudio(context: Context) {
    private val soundPool = SoundPool.Builder()
        .setMaxStreams(4)
        .setAudioAttributes(
            AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_GAME)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build()
        )
        .build()
    private val popId = soundPool.load(context, R.raw.pop, 1)
    private val boopId = soundPool.load(context, R.raw.boop, 1)

    @Volatile private var ttsReady = false
    private var locale: Locale = Locale.UK
    private val tts = TextToSpeech(context.applicationContext) { status ->
        if (status == TextToSpeech.SUCCESS) {
            ttsReady = true
            applyLocale()
        }
    }

    fun setLocale(newLocale: Locale) {
        locale = newLocale
        if (ttsReady) applyLocale()
    }

    private fun applyLocale() {
        val result = tts.setLanguage(locale)
        if (result == TextToSpeech.LANG_MISSING_DATA || result == TextToSpeech.LANG_NOT_SUPPORTED) {
            tts.setLanguage(Locale.UK)
        }
        tts.setSpeechRate(0.9f)
        tts.setPitch(1.15f)
    }

    fun speak(text: String) {
        if (ttsReady) tts.speak(text, TextToSpeech.QUEUE_FLUSH, null, "game")
    }

    fun pop() {
        soundPool.play(popId, 1f, 1f, 1, 0, Random.nextDouble(0.85, 1.25).toFloat())
    }

    fun boop() {
        soundPool.play(boopId, 0.8f, 0.8f, 1, 0, 1f)
    }

    fun release() {
        tts.stop()
        tts.shutdown()
        soundPool.release()
    }
}
