package com.baldissera.filucca

import android.content.Context
import android.media.AudioAttributes
import android.media.SoundPool
import android.speech.tts.TextToSpeech
import java.util.Locale

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
    private val clickId = soundPool.load(context, R.raw.click, 1)
    private val clearId = soundPool.load(context, R.raw.clear, 1)
    private val bigId = soundPool.load(context, R.raw.big, 1)
    private val overId = soundPool.load(context, R.raw.over, 1)

    @Volatile private var ttsReady = false
    private val tts = TextToSpeech(context.applicationContext) { status ->
        if (status == TextToSpeech.SUCCESS) {
            ttsReady = true
            setupVoice()
        }
    }

    private fun setupVoice() {
        val result = tts.setLanguage(Locale.forLanguageTag("da-DK"))
        if (result == TextToSpeech.LANG_MISSING_DATA || result == TextToSpeech.LANG_NOT_SUPPORTED) {
            tts.setLanguage(Locale.UK)
        }
        tts.setPitch(1.1f)
    }

    fun speak(text: String, queue: Boolean = false) {
        if (ttsReady) tts.speak(text, if (queue) TextToSpeech.QUEUE_ADD else TextToSpeech.QUEUE_FLUSH, null, "game")
    }

    private fun play(id: Int, volume: Float = 1f) {
        soundPool.play(id, volume, volume, 1, 0, 1f)
    }

    fun click() = play(clickId, 0.7f)
    fun clear() = play(clearId)
    fun big() = play(bigId)
    fun over() = play(overId)

    fun release() {
        tts.stop()
        tts.shutdown()
        soundPool.release()
    }
}
