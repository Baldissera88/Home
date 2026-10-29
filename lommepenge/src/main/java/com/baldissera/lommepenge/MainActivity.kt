package com.baldissera.lommepenge

import android.content.Context
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.togetherWith
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.graphics.Color

class MainActivity : ComponentActivity() {
    private lateinit var store: Store
    private lateinit var sounds: Sounds

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        store = Store(getSharedPreferences("lommepenge", Context.MODE_PRIVATE))
        store.tidy()
        sounds = Sounds(this)
        setContent { LommepengeTheme { LommepengeApp(store, sounds) } }
    }

    override fun onResume() {
        super.onResume()
        store.payAllowances()
    }

    override fun onDestroy() {
        sounds.release()
        super.onDestroy()
    }
}

@Composable
fun LommepengeTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = lightColorScheme(primary = Color(0xFF6A3FD0), secondary = Gold), content = content)
}

/** Screens are "home", "pin", "parent" or "kid:<id>". */
@Composable
fun LommepengeApp(store: Store, fx: Feedback) {
    var screen by rememberSaveable { mutableStateOf("home") }
    BackHandler(enabled = screen != "home") { screen = "home" }
    AnimatedContent(
        screen,
        transitionSpec = { (fadeIn(tween(250)) + scaleIn(tween(250), initialScale = 0.96f)) togetherWith fadeOut(tween(200)) },
        label = "screen",
    ) { s ->
        when {
            s.startsWith("kid:") -> KidScreen(store, s.removePrefix("kid:"), fx) { screen = "home" }
            s == "pin" -> PinScreen(store, fx, onOk = { screen = "parent" }, onBack = { screen = "home" })
            s == "parent" -> ParentScreen(store, fx, onClose = { screen = "home" })
            else -> HomeScreen(store, fx, onKid = { screen = "kid:$it" }, onParent = { screen = "pin" })
        }
    }
}
