package com.baldissera.filucca

import android.content.Context
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme

class MainActivity : ComponentActivity() {
    private val game = BlockGame()
    private lateinit var audio: GameAudio

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        audio = GameAudio(this)
        val prefs = getSharedPreferences("scores", Context.MODE_PRIVATE)
        setContent {
            MaterialTheme(colorScheme = darkColorScheme()) {
                GameScreen(game, audio, prefs)
            }
        }
    }

    override fun onPause() {
        super.onPause()
        if (game.started && !game.gameOver) game.paused = true
    }

    override fun onDestroy() {
        audio.release()
        super.onDestroy()
    }
}
