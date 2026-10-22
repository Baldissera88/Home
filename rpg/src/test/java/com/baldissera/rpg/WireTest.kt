package com.baldissera.rpg

import android.content.Context
import androidx.compose.ui.graphics.Color
import androidx.test.core.app.ApplicationProvider
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/** The JSON the 3D page reads: it parses, carries fine time and positions, counts frames and caps particles. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class WireTest {
    private val ctx: Context = ApplicationProvider.getApplicationContext()

    init {
        Terrain.synchronous = true
    }

    @Test
    fun levelAndFramesParse() {
        val prefs = ctx.getSharedPreferences("wire${System.nanoTime()}", Context.MODE_PRIVATE)
        val g = Game(Sfx(ctx), prefs).also { it.newGame(HeroClass.KNIGHT) }
        repeat(30) { g.update(1f / 60f) }

        val level = JSONObject(Wire.level(g))
        assertEquals("level", level.getString("k"))
        assertEquals(level.getInt("w") * level.getInt("h"), level.getString("tiles").length)

        g.time = 12.3456f
        g.player.x = 10.125f
        val text = Wire.frame(g, 0.5f)
        assertTrue(text, text.contains("\"t\":12.3456,"))
        val a = JSONObject(text)
        assertEquals("f", a.getString("k"))
        assertEquals(12.3456, a.getDouble("t"), 1e-9)
        assertEquals(10.125, a.getJSONArray("p").getDouble(0), 1e-9)
        assertEquals(0.5, a.getDouble("cy"), 1e-9)
        assertTrue(a.getLong("ts") >= 0L)

        repeat(400) { g.particles += Particle(1f, 2f, 0f, 0f, Color.White, 0.1f, 5f) }
        val b = JSONObject(Wire.frame(g, -1.2346f))
        assertTrue(b.getInt("fs") > a.getInt("fs"))
        assertEquals(350 * 7, b.getJSONArray("pa").length())
        assertEquals(-1.235, b.getDouble("cy"), 1e-9)
        for (key in listOf("dl", "rn", "fg", "fd", "sh", "lf", "e", "n", "pr", "lo", "tx", "zo", "me", "bo", "wa", "dc", "gh", "pu")) {
            assertTrue(key, b.has(key))
        }
    }
}
