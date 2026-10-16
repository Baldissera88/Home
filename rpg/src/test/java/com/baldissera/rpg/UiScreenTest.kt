package com.baldissera.rpg

import android.content.Context
import android.graphics.Bitmap
import android.view.View
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import org.robolectric.shadows.ShadowChoreographer
import org.robolectric.shadows.ShadowLooper
import java.io.File
import java.io.FileOutputStream
import java.time.Duration
import java.util.concurrent.TimeUnit

/** Screenshots of the full screen (world + HUD + menus) through the real Compose UI. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], qualifiers = "w360dp-h780dp-xhdpi")
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class UiScreenTest {
    private val outDir = File("build/screens").apply { mkdirs() }

    init {
        Terrain.synchronous = true
    }

    private fun shoot(name: String, overlay: Int, setup: (Game) -> Unit = {}) {
        // Space frames like a real 60 Hz display so idling renders a handful of frames, not hundreds.
        ShadowChoreographer.setFrameDelay(Duration.ofMillis(16))
        val t0 = System.currentTimeMillis()
        fun log(step: String) = println("[ui $name] $step after ${System.currentTimeMillis() - t0} ms")
        log("start")
        // A bare activity: MainActivity's own screen runs the endless game loop, which never lets the looper go idle.
        val activity = Robolectric.buildActivity(ComponentActivity::class.java).setup().get()
        log("activity ready")
        val ctx = activity.applicationContext
        val sfx = Sfx(ctx)
        val prefs = ctx.getSharedPreferences("ui${System.nanoTime()}", Context.MODE_PRIVATE)
        val game = Game(sfx, prefs).also { it.newGame() }
        val assets = Assets(ctx.resources)
        val settings = ctx.getSharedPreferences("settings-test", Context.MODE_PRIVATE)
        val music = Music(ctx).also { it.enabled = false }
        setup(game)
        repeat(20) { game.update(1f / 60f) }
        activity.setContent {
            MaterialTheme(colorScheme = darkColorScheme()) {
                RpgScreen(game, assets, music, sfx, settings, autoStart = overlay != -2 && overlay != -3,
                    debugOverlay = if (overlay < 0) -1 else overlay, animate = false, debugChooseClass = overlay == -3)
            }
        }
        log("content set")
        repeat(4) {
            ShadowLooper.idleMainLooper(20, TimeUnit.MILLISECONDS)
            log("idle ${it + 1}")
        }
        val root: View = activity.window.decorView
        val bmp = Bitmap.createBitmap(root.width, root.height, Bitmap.Config.ARGB_8888)
        root.draw(android.graphics.Canvas(bmp))
        val small = Bitmap.createScaledBitmap(bmp, root.width * 3 / 4, root.height * 3 / 4, true)
        FileOutputStream(File(outDir, "$name.jpg")).use { small.compress(Bitmap.CompressFormat.JPEG, 72, it) }
        log("saved")
    }

    private fun loadUp(g: Game) {
        g.player.level = 9
        g.player.gold = 4321
        g.player.skillPoints = 2
        repeat(10) { g.player.inventory += g.makeItem(8, Rarity.entries.random(), false) }
        for (s in Slot.entries) g.player.equipment[s] = g.makeItem(7, Rarity.entries.random(), false, slot = s)
    }

    @Test fun title() = shoot("u0_title", -2)
    @Test fun hud() = shoot("u1_hud", -1)
    @Test fun inventory() = shoot("u2_inventory", 1, ::loadUp)
    @Test fun skills() = shoot("u3_skills", 2, ::loadUp)
    @Test fun shop() = shoot("u4_shop", 4, ::loadUp)
    @Test fun smith() = shoot("u5_smith", 6, ::loadUp)
    @Test fun elder() = shoot("u6_elder", 7, ::loadUp)
    @Test fun map() = shoot("u7_map", 5) { g -> g.player.x += 10f; repeat(200) { g.update(1f / 30f) } }
    @Test fun quests() = shoot("u8_quests", 3) { g ->
        g.shardsFound += listOf("w0", "w1", "w2", "w3", "f1")
        g.player.hearts = 1
    }
    @Test fun stash() = shoot("u9_stash", 9) { g ->
        loadUp(g)
        repeat(12) { g.stash += g.makeItem(6, Rarity.entries.random(), false) }
    }
    @Test fun dead() = shoot("u10_dead", -1) { g -> g.dead = true }
    @Test fun victory() = shoot("u11_victory", -1) { g -> g.victory = true }
    @Test fun classSelect() = shoot("u12_class_select", -3)
    @Test fun sorceressHud() = shoot("u13_hud_sorceress", -1) { g ->
        g.newGame(HeroClass.SORCERESS)
        for (s in g.player.heroClass.skills) g.player.skills[s] = 1
    }
}
