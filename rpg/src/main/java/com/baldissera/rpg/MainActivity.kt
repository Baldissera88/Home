package com.baldissera.rpg

import android.content.Context
import android.os.Bundle
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat

class MainActivity : ComponentActivity() {
    private lateinit var sfx: Sfx
    private lateinit var game: Game
    private lateinit var assets: Assets
    private lateinit var music: Music

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        WindowCompat.getInsetsController(window, window.decorView).apply {
            hide(WindowInsetsCompat.Type.systemBars())
            systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        }
        sfx = Sfx(this)
        assets = Assets(resources)
        music = Music(this)
        val settings = getSharedPreferences("settings", Context.MODE_PRIVATE)
        music.enabled = settings.getBoolean("music", true)
        sfx.enabled = settings.getBoolean("sfx", true)
        sfx.haptics = settings.getBoolean("haptics", true)
        game = Game(sfx, getSharedPreferences("hero", Context.MODE_PRIVATE))
        setContent {
            MaterialTheme(colorScheme = darkColorScheme()) {
                RpgScreen(game, assets, music, sfx, settings)
            }
        }
    }

    override fun onPause() {
        super.onPause()
        game.save()
        sfx.pause()
        music.pause()
    }

    override fun onResume() {
        super.onResume()
        sfx.resume()
        music.resume()
    }

    override fun onDestroy() {
        sfx.release()
        music.release()
        super.onDestroy()
    }
}
