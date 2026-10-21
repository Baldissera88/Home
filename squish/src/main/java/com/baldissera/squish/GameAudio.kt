package com.baldissera.squish

import android.content.Context
import android.media.AudioAttributes
import android.media.MediaPlayer
import android.media.SoundPool
import android.speech.tts.TextToSpeech
import java.util.Locale
import kotlin.random.Random

/**
 * Sound effects (SoundPool), looping background music (MediaPlayer) and a cheerful Danish voice (TextToSpeech).
 * All sounds are synthesised by tools/squish-audio/synth.py into res/raw.
 * Every method is safe to call before the sounds have finished loading and after [release].
 */
class GameAudio(context: Context) {
    private val appContext = context.applicationContext

    @Volatile private var released = false

    /** Effects and speech. */
    var soundOn: Boolean = true
        set(value) {
            field = value
            if (!value && ttsReady && !released) runCatching { tts.stop() }
        }

    /** Background music. Turning it on resumes the music if [startMusic] was called and not paused since. */
    var musicOn: Boolean = true
        set(value) {
            field = value
            if (value) {
                if (musicWanted) playMusicNow()
            } else {
                pausePlayer()
            }
        }

    // ------------------------------------------------------------------ effects

    private val soundPool: SoundPool = SoundPool.Builder()
        .setMaxStreams(8)
        .setAudioAttributes(
            AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_GAME)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build()
        )
        .build()

    private val loaded = java.util.Collections.synchronizedSet(HashSet<Int>())

    init {
        soundPool.setOnLoadCompleteListener { _, sampleId, status ->
            if (status == 0) loaded.add(sampleId)
        }
    }

    private fun load(res: Int): Int = runCatching { soundPool.load(appContext, res, 1) }.getOrDefault(0)

    private val swapId = load(R.raw.sfx_swap)
    private val invalidId = load(R.raw.sfx_invalid)
    private val popIds = intArrayOf(load(R.raw.sfx_pop1), load(R.raw.sfx_pop2), load(R.raw.sfx_pop3))
    private val madeId = load(R.raw.sfx_made)
    private val lineId = load(R.raw.sfx_line)
    private val bombId = load(R.raw.sfx_bomb)
    private val rainbowId = load(R.raw.sfx_rainbow)
    private val gooId = load(R.raw.sfx_goo)
    private val wrapId = load(R.raw.sfx_wrap)
    private val starId = load(R.raw.sfx_star)
    private val winId = load(R.raw.sfx_win)
    private val loseId = load(R.raw.sfx_lose)
    private val clickId = load(R.raw.sfx_click)

    private var lastPop = 0

    private fun play(id: Int, volume: Float = 1f, rate: Float = 1f, priority: Int = 1) {
        if (released || !soundOn || id == 0 || id !in loaded) return
        runCatching { soundPool.play(id, volume, volume, priority, 0, rate.coerceIn(0.5f, 2.0f)) }
    }

    fun swap() = play(swapId, 0.8f)
    fun invalid() = play(invalidId, 0.8f)

    /** One pop per cleared group; pitch rises with the cascade [combo] (1 = first clear), capped at 2x. */
    fun pop(combo: Int) {
        // Rotate through the variants (never the same twice in a row) with a tiny random detune.
        lastPop = (lastPop + 1 + Random.nextInt(popIds.size - 1)) % popIds.size
        val step = (combo - 1).coerceAtLeast(0)
        val rate = (1f + 0.1f * step) * (0.97f + Random.nextFloat() * 0.06f)
        play(popIds[lastPop], 0.85f, rate.coerceAtMost(2.0f))
    }

    fun made() = play(madeId, 0.9f, priority = 2)
    fun line() = play(lineId, 0.85f, priority = 2)
    fun bomb() = play(bombId, 1f, priority = 3)
    fun rainbow() = play(rainbowId, 0.95f, priority = 3)
    fun goo() = play(gooId, 0.8f)
    fun wrap() = play(wrapId, 0.85f)

    /** Star [n] (1..3) of the result; each one rings a little higher. */
    fun star(n: Int) = play(starId, 0.9f, 1f + 0.12f * (n - 1).coerceIn(0, 4), priority = 2)
    fun win() = play(winId, 1f, priority = 4)
    fun lose() = play(loseId, 0.9f, priority = 4)
    fun click() = play(clickId, 0.7f)

    // ------------------------------------------------------------------ speech

    @Volatile private var ttsReady = false
    private val tts: TextToSpeech = TextToSpeech(appContext) { status ->
        if (status == TextToSpeech.SUCCESS && !released) {
            runCatching { setupVoice() }
            ttsReady = true
        }
    }

    private fun setupVoice() {
        val result = tts.setLanguage(Locale.forLanguageTag("da-DK"))
        if (result == TextToSpeech.LANG_MISSING_DATA || result == TextToSpeech.LANG_NOT_SUPPORTED) {
            val en = tts.setLanguage(Locale.UK)
            if (en == TextToSpeech.LANG_MISSING_DATA || en == TextToSpeech.LANG_NOT_SUPPORTED) tts.setLanguage(Locale.US)
        }
        tts.setPitch(1.3f)
        tts.setSpeechRate(1.05f)
    }

    /** Short cheer like "Lækkert!" or "Squishy!". Interrupts any cheer still being spoken. */
    fun speak(text: String) {
        if (released || !soundOn || !ttsReady || text.isBlank()) return
        runCatching { tts.speak(text, TextToSpeech.QUEUE_FLUSH, null, "squish") }
    }

    // ------------------------------------------------------------------ music

    private var player: MediaPlayer? = null
    private var musicWanted = false

    /** Start (or resume) the looping music. Plays only while [musicOn]; remembers the wish otherwise. */
    fun startMusic() {
        if (released) return
        musicWanted = true
        if (musicOn) playMusicNow()
    }

    /** Pause the music (e.g. when the activity goes to the background). */
    fun pauseMusic() {
        musicWanted = false
        pausePlayer()
    }

    private fun playMusicNow() {
        if (released) return
        val p = player ?: createPlayer() ?: return
        runCatching { if (!p.isPlaying) p.start() }.onFailure { dropPlayer() }
    }

    private fun createPlayer(): MediaPlayer? {
        // MediaPlayer.create returns an already prepared player, or null if the resource cannot be opened.
        val p = runCatching { MediaPlayer.create(appContext, R.raw.music_loop) }.getOrNull() ?: return null
        runCatching {
            p.isLooping = true
            p.setVolume(MUSIC_VOLUME, MUSIC_VOLUME)
            p.setOnErrorListener { _, _, _ ->
                dropPlayer()
                true
            }
        }
        player = p
        return p
    }

    private fun pausePlayer() {
        val p = player ?: return
        runCatching { if (p.isPlaying) p.pause() }.onFailure { dropPlayer() }
    }

    private fun dropPlayer() {
        val p = player ?: return
        player = null
        runCatching { p.release() }
    }

    // ------------------------------------------------------------------ lifecycle

    fun release() {
        if (released) return
        released = true
        musicWanted = false
        ttsReady = false
        dropPlayer()
        runCatching { tts.stop() }
        runCatching { tts.shutdown() }
        loaded.clear()
        runCatching { soundPool.release() }
    }

    private companion object {
        const val MUSIC_VOLUME = 0.5f
    }
}
