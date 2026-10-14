package com.baldissera.filucca

import android.content.Context
import android.content.SharedPreferences
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

private enum class Screen { MENU, FALLING, BLAST }

class MainActivity : ComponentActivity() {
    private val falling = BlockGame()
    private val blast = BlastGame()
    private lateinit var audio: GameAudio

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        audio = GameAudio(this)
        val prefs = getSharedPreferences("scores", Context.MODE_PRIVATE)
        setContent {
            MaterialTheme(colorScheme = darkColorScheme()) {
                FiluccaApp(falling, blast, audio, prefs)
            }
        }
    }

    override fun onPause() {
        super.onPause()
        falling.pauseIfRunning()
    }

    override fun onDestroy() {
        audio.release()
        super.onDestroy()
    }
}

private fun BlockGame.pauseIfRunning() {
    if (started && !gameOver) paused = true
}

@Composable
private fun FiluccaApp(falling: BlockGame, blast: BlastGame, audio: GameAudio, prefs: SharedPreferences) {
    var screen by rememberSaveable { mutableStateOf(Screen.MENU) }
    val toMenu = {
        falling.pauseIfRunning()
        screen = Screen.MENU
    }

    when (screen) {
        Screen.MENU -> MenuScreen(
            onFalling = { screen = Screen.FALLING },
            onBlast = { screen = Screen.BLAST },
        )
        Screen.FALLING -> {
            BackHandler(onBack = toMenu)
            GameScreen(falling, audio, prefs, onHome = toMenu)
        }
        Screen.BLAST -> {
            BackHandler(onBack = toMenu)
            BlastScreen(blast, audio, prefs, onHome = toMenu)
        }
    }
}

@Composable
private fun MenuScreen(onFalling: () -> Unit, onBlast: () -> Unit) {
    Column(
        modifier = Modifier.fillMaxSize().background(background),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(24.dp, Alignment.CenterVertically),
    ) {
        Title()
        Text("Hej Filucca! Hvad vil du spille?", color = Color.White, fontSize = 20.sp)
        BigButton("Faldende klodser", color = Color(0xFF8E44AD), onClick = onFalling)
        BigButton("Klods-Blast", color = pink, onClick = onBlast)
    }
}
