package com.baldissera.home

import android.content.Context
import android.content.SharedPreferences
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import com.baldissera.home.game.BrickGame
import com.baldissera.home.game.GameAudio
import com.baldissera.home.game.Lang
import com.baldissera.home.game.MenuScreen
import com.baldissera.home.game.Mode
import com.baldissera.home.ui.theme.HomeTheme

class MainActivity : ComponentActivity() {
    private lateinit var audio: GameAudio

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        audio = GameAudio(this)
        val prefs = getSharedPreferences("settings", Context.MODE_PRIVATE)
        setContent {
            HomeTheme {
                VictorApp(audio, prefs)
            }
        }
    }

    override fun onDestroy() {
        audio.release()
        super.onDestroy()
    }
}

@Composable
fun VictorApp(audio: GameAudio, prefs: SharedPreferences) {
    var lang by remember {
        mutableStateOf(Lang.entries.firstOrNull { it.name == prefs.getString("lang", null) } ?: Lang.DA)
    }
    var mode by rememberSaveable { mutableStateOf<Mode?>(null) }

    LaunchedEffect(lang) {
        audio.setLocale(lang.locale)
        prefs.edit().putString("lang", lang.name).apply()
    }

    val current = mode
    if (current == null) {
        MenuScreen(
            lang = lang,
            onToggleLang = {
                lang = lang.next()
                audio.setLocale(lang.locale)
                audio.speak(lang.texts.title)
            },
            onPlay = { mode = it },
        )
    } else {
        BackHandler { mode = null }
        BrickGame(mode = current, lang = lang, audio = audio, onHome = { mode = null })
    }
}
