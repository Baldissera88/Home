package com.baldissera.rpg

import android.content.Context
import android.media.AudioAttributes
import android.media.SoundPool
import kotlin.random.Random

class Sfx(context: Context) {
    private val pool = SoundPool.Builder()
        .setMaxStreams(8)
        .setAudioAttributes(
            AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_GAME)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build()
        )
        .build()
    private val ids = mutableMapOf<String, Int>()
    private var ambientId = 0
    private var ambientStream = 0

    init {
        pool.setOnLoadCompleteListener { p, sampleId, status ->
            if (status == 0 && sampleId == ambientId && ambientStream == 0) {
                ambientStream = p.play(sampleId, 0.4f, 0.4f, 0, -1, 1f)
            }
        }
        val sounds = listOf(
            "swing" to R.raw.swing, "hit" to R.raw.hit, "kill" to R.raw.kill, "coin" to R.raw.coin,
            "equip" to R.raw.equip, "potion" to R.raw.potion, "fireball" to R.raw.fireball,
            "explode" to R.raw.explode, "hurt" to R.raw.hurt, "levelup" to R.raw.levelup, "stairs" to R.raw.stairs,
        )
        for ((name, res) in sounds) ids[name] = pool.load(context, res, 1)
        ambientId = pool.load(context, R.raw.ambient, 1)
    }

    private fun play(name: String, volume: Float = 1f, varyPitch: Boolean = true) {
        val id = ids[name] ?: return
        val rate = if (varyPitch) 0.9f + Random.nextFloat() * 0.2f else 1f
        pool.play(id, volume, volume, 1, 0, rate)
    }

    fun swing() = play("swing", 0.5f)
    fun hit() = play("hit", 0.9f)
    fun kill() = play("kill", 0.9f)
    fun coin() = play("coin", 0.6f)
    fun equip() = play("equip", 0.8f)
    fun potion() = play("potion", 0.8f)
    fun fireball() = play("fireball", 0.8f)
    fun explode() = play("explode", 0.9f)
    fun hurt() = play("hurt", 0.9f)
    fun levelUp() = play("levelup", 0.9f, varyPitch = false)
    fun stairs() = play("stairs", 0.9f, varyPitch = false)

    fun pause() = pool.autoPause()
    fun resume() = pool.autoResume()
    fun release() = pool.release()
}
