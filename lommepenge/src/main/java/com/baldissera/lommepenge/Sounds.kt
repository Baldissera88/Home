package com.baldissera.lommepenge

import android.content.Context
import android.media.AudioAttributes
import android.media.SoundPool
import android.speech.tts.TextToSpeech
import java.util.Locale

/** Sounds and the cheering voice; screens only see this interface so tests can stay silent. */
interface Feedback {
    fun tap() {}
    fun coin() {}
    fun fanfare() {}
    fun say(text: String) {}

    companion object {
        val Silent = object : Feedback {}
    }
}

class Sounds(context: Context) : Feedback {
    private val pool = SoundPool.Builder()
        .setMaxStreams(4)
        .setAudioAttributes(
            AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_GAME)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build()
        )
        .build()
    private val popId = pool.load(context, R.raw.pop, 1)
    private val coinId = pool.load(context, R.raw.coin, 1)
    private val fanfareId = pool.load(context, R.raw.fanfare, 1)

    @Volatile private var ttsReady = false
    private val tts = TextToSpeech(context.applicationContext) { status ->
        if (status == TextToSpeech.SUCCESS) {
            ttsReady = true
            applyVoice()
        }
    }

    private fun applyVoice() {
        val result = tts.setLanguage(Locale("da", "DK"))
        if (result == TextToSpeech.LANG_MISSING_DATA || result == TextToSpeech.LANG_NOT_SUPPORTED) {
            tts.setLanguage(Locale.UK)
        }
        tts.setSpeechRate(0.95f)
        tts.setPitch(1.15f)
    }

    override fun tap() {
        pool.play(popId, 0.7f, 0.7f, 1, 0, 1f)
    }

    override fun coin() {
        pool.play(coinId, 1f, 1f, 2, 0, 1f)
    }

    override fun fanfare() {
        pool.play(fanfareId, 1f, 1f, 3, 0, 1f)
    }

    override fun say(text: String) {
        if (ttsReady) tts.speak(text, TextToSpeech.QUEUE_FLUSH, null, "cheer")
    }

    fun release() {
        tts.stop()
        tts.shutdown()
        pool.release()
    }
}
