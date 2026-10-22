package com.baldissera.squish

import android.content.Context
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue

class MainActivity : ComponentActivity() {
    private lateinit var audio: GameAudio
    private lateinit var progress: Progress

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        progress = Progress(getSharedPreferences("squish", Context.MODE_PRIVATE))
        audio = GameAudio(this)
        audio.soundOn = progress.soundOn
        audio.musicOn = progress.musicOn
        setContent {
            MaterialTheme(colorScheme = lightColorScheme(primary = Bubblegum)) {
                SquishApp(audio, progress)
            }
        }
    }

    override fun onResume() {
        super.onResume()
        // Plays only if music is switched on (GameAudio remembers the wish otherwise).
        audio.startMusic()
    }

    override fun onPause() {
        audio.pauseMusic()
        super.onPause()
    }

    override fun onDestroy() {
        audio.release()
        super.onDestroy()
    }
}

/** Level map <-> game. [levelNumber] 0 means the map is showing. */
@Composable
fun SquishApp(audio: GameAudio, progress: Progress) {
    val levels = Levels.all
    var levelNumber by rememberSaveable { mutableIntStateOf(0) }
    var attempt by rememberSaveable { mutableIntStateOf(0) }
    val level = levels.firstOrNull { it.number == levelNumber }

    if (level == null) {
        MenuScreen(levels, progress, audio, onPlay = {
            levelNumber = it.number
            attempt++
        })
    } else {
        BackHandler { levelNumber = 0 }
        val next = levels.firstOrNull { it.number == level.number + 1 }
        key(level.number, attempt) {
            GameScreen(
                level = level,
                audio = audio,
                progress = progress,
                onNext = next?.let { n -> { levelNumber = n.number; attempt++ } },
                onRetry = { attempt++ },
                onMap = { levelNumber = 0 },
            )
        }
    }
}
