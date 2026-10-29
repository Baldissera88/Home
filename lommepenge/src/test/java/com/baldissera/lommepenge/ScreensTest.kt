package com.baldissera.lommepenge

import android.content.Context
import android.graphics.Bitmap
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.runtime.Composable
import androidx.test.core.app.ApplicationProvider
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import org.robolectric.shadows.ShadowLooper
import java.io.File
import java.io.FileOutputStream
import java.time.LocalDate
import java.util.concurrent.TimeUnit

/** Renders each screen to lommepenge/build/screens so CI can publish them for review. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], qualifiers = "w380dp-h820dp-xhdpi")
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class ScreensTest {
    private val outDir = File("build/screens").apply { mkdirs() }

    init {
        Motion.enabled = false
    }

    private fun demo(): Store {
        val ctx = ApplicationProvider.getApplicationContext<Context>()
        val prefs = ctx.getSharedPreferences("shot${System.nanoTime()}", Context.MODE_PRIVATE)
        val s = Store(prefs, today = { LocalDate.of(2026, 10, 28) })
        s.credit("victor", 12850, "Ugepenge", "📅")
        s.credit("victor", 500, "Hjalp mormor", "🎁")
        s.credit("victor", -2000, "Slik", "🛍️")
        s.credit("filucca", 18200, "Ugepenge", "📅")
        val daily = s.choresFor("victor", Repeat.DAILY)
        s.setApproval(false)
        s.tick(daily[0], "victor")
        s.setApproval(true)
        s.tick(daily[1], "victor")
        s.tick(s.choresFor("filucca", Repeat.DAILY)[2], "filucca")
        s.saveChore(Chore("car", "Vask bilen med far", "🚗", 2500, Repeat.ONCE, setOf("victor")))
        val day = LocalDate.of(2026, 10, 28)
        for (d in listOf(1, 2, 3, 5, 6, 7, 8, 9, 12, 13, 14, 15, 16, 17, 19, 20, 22, 23, 24, 25, 26)) {
            s.setNight("victor", day.withDayOfMonth(d), d != 9 && d != 16)
        }
        s.sleptInOwnBed("filucca")
        return s
    }

    private fun shoot(name: String, content: @Composable () -> Unit) {
        val activity = Robolectric.buildActivity(ComponentActivity::class.java).setup().get()
        activity.setContent { LommepengeTheme(content) }
        repeat(6) { ShadowLooper.idleMainLooper(250, TimeUnit.MILLISECONDS) }
        val root = activity.window.decorView
        val bmp = Bitmap.createBitmap(root.width, root.height, Bitmap.Config.ARGB_8888)
        root.draw(android.graphics.Canvas(bmp))
        FileOutputStream(File(outDir, "$name.jpg")).use { bmp.compress(Bitmap.CompressFormat.JPEG, 80, it) }
    }

    @Test
    fun home() {
        val s = demo()
        shoot("1-home") { HomeScreen(s, Feedback.Silent, {}, {}) }
    }

    @Test
    fun kid() {
        val s = demo()
        shoot("2-kid") { KidScreen(s, "victor", Feedback.Silent) {} }
    }

    @Test
    fun kidSleep() {
        val s = demo()
        shoot("2b-kid-sleep") { KidScreen(s, "filucca", Feedback.Silent) {} }
    }

    @Test
    fun pin() {
        val s = demo()
        shoot("3-pin") { PinScreen(s, Feedback.Silent, {}, {}) }
    }

    @Test
    fun parentApprove() {
        val s = demo()
        shoot("4-parent-approve") { ParentScreen(s, Feedback.Silent, {}, startTab = 0) }
    }

    @Test
    fun parentChores() {
        val s = demo()
        shoot("5-parent-chores") { ParentScreen(s, Feedback.Silent, {}, startTab = 1) }
    }

    @Test
    fun parentKids() {
        val s = demo()
        shoot("6-parent-kids") { ParentScreen(s, Feedback.Silent, {}, startTab = 2) }
    }
}
