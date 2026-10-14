package com.baldissera.filucca

import android.content.SharedPreferences
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.gestures.waitForUpOrCancellation
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

internal val background = Color(0xFF1B2A41)
internal val boardColor = Color(0xFF263850)
internal val pink = Color(0xFFEC407A)

internal val cheers = listOf(
    "Flot, Filucca!", "Sejt, Filucca!", "Super, Filucca!", "Wow, Filucca!", "Du er vild, Filucca!",
)

private const val RECORD_KEY = "record"

@Composable
fun GameScreen(game: BlockGame, audio: GameAudio, prefs: SharedPreferences, onHome: () -> Unit) {
    var record by remember { mutableIntStateOf(prefs.getInt(RECORD_KEY, 0)) }
    var newRecord by remember { mutableStateOf(false) }
    var cheer by remember { mutableStateOf<String?>(null) }
    var cheerId by remember { mutableIntStateOf(0) }

    fun showCheer(text: String) {
        cheer = text
        cheerId++
    }

    remember(game) {
        game.listener = { e ->
            when (e) {
                GameEvent.Locked -> audio.click()
                is GameEvent.Cleared -> if (e.lines >= 4) {
                    audio.big()
                    showCheer("4 linjer! 🎉")
                    audio.speak("Fire linjer! Fantastisk, Filucca!")
                } else {
                    audio.clear()
                    if (e.lines >= 2) {
                        val c = cheers.random()
                        showCheer(c)
                        audio.speak(c)
                    }
                }
                is GameEvent.LevelUp -> {
                    showCheer("Niveau ${e.level}! 🚀")
                    audio.speak("Niveau ${e.level}!", queue = true)
                }
                GameEvent.GameOver -> {
                    audio.over()
                    newRecord = game.score > record
                    if (newRecord) {
                        record = game.score
                        prefs.edit().putInt(RECORD_KEY, record).apply()
                        audio.speak("Ny rekord! Fantastisk, Filucca!")
                    } else {
                        audio.speak("Godt spillet, Filucca!")
                    }
                }
            }
        }
        true
    }

    // Gravity: restarts whenever the game starts, pauses or ends.
    LaunchedEffect(game.started, game.paused, game.gameOver) {
        while (game.started && !game.paused && !game.gameOver) {
            delay(game.gravityMs)
            game.tick()
        }
    }

    LaunchedEffect(cheerId) {
        if (cheer != null) {
            delay(1500)
            cheer = null
        }
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(background)
            .systemBarsPadding()
            .padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        TopBar(game, record)

        Box(
            modifier = Modifier.weight(1f).fillMaxWidth(),
            contentAlignment = Alignment.Center,
        ) {
            Board(
                game,
                Modifier
                    .fillMaxHeight()
                    .aspectRatio(COLS / ROWS.toFloat(), matchHeightConstraintsFirst = true)
            )

            when {
                !game.started -> Overlay {
                    Title()
                    Text("Rekord: $record", color = Color.White, fontSize = 22.sp)
                    Text(
                        "Tryk på brættet eller ↻ for at dreje.\n⏬ smider klodsen helt ned.",
                        color = Color.White.copy(alpha = 0.8f),
                        fontSize = 16.sp,
                        textAlign = TextAlign.Center,
                    )
                    BigButton("Start") {
                        game.start()
                        audio.speak("Held og lykke, Filucca!")
                    }
                }
                game.gameOver -> Overlay {
                    Text("Spillet er slut!", color = Color.White, fontSize = 32.sp, fontWeight = FontWeight.Black)
                    Text("Point: ${game.score}", color = Color.White, fontSize = 24.sp)
                    if (newRecord) {
                        Text("🎉 Ny rekord, Filucca!", color = Color(0xFFF2CD37), fontSize = 24.sp, fontWeight = FontWeight.Bold)
                    } else {
                        Text("Rekord: $record", color = Color.White.copy(alpha = 0.8f), fontSize = 20.sp)
                    }
                    BigButton("Spil igen") { game.start() }
                    BigButton("Menu", color = Color(0xFF546E7A), onClick = onHome)
                }
                game.paused -> Overlay {
                    Text("Pause", color = Color.White, fontSize = 36.sp, fontWeight = FontWeight.Black)
                    BigButton("Fortsæt") { game.paused = false }
                    BigButton("Start forfra", color = Color(0xFF546E7A)) { game.start() }
                    BigButton("Menu", color = Color(0xFF546E7A), onClick = onHome)
                }
            }

            CheerBubble(cheer)
        }

        Controls(game)
    }
}

@Composable
internal fun CheerBubble(cheer: String?) {
    AnimatedVisibility(
        visible = cheer != null,
        enter = fadeIn() + scaleIn(),
        exit = fadeOut(),
    ) {
        Text(
            text = cheer ?: "",
            fontSize = 34.sp,
            fontWeight = FontWeight.ExtraBold,
            color = pink,
            textAlign = TextAlign.Center,
            modifier = Modifier
                .background(Color.White.copy(alpha = 0.92f), RoundedCornerShape(20.dp))
                .padding(horizontal = 20.dp, vertical = 10.dp)
        )
    }
}

@Composable
private fun TopBar(game: BlockGame, record: Int) {
    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth()) {
        Column(modifier = Modifier.weight(1f)) {
            Text("Point ${game.score}", color = Color.White, fontSize = 24.sp, fontWeight = FontWeight.Bold)
            Text(
                "Niveau ${game.level} · Linjer ${game.lines} · Rekord $record",
                color = Color.White.copy(alpha = 0.75f),
                fontSize = 14.sp,
            )
        }
        Box(
            modifier = Modifier
                .size(width = 72.dp, height = 52.dp)
                .background(boardColor, RoundedCornerShape(10.dp)),
            contentAlignment = Alignment.Center,
        ) {
            if (game.started) {
                Canvas(Modifier.size(width = 60.dp, height = 40.dp)) { drawPreview(game.next) }
            }
        }
        Text(
            text = "⏸",
            fontSize = 30.sp,
            color = Color.White,
            modifier = Modifier
                .padding(start = 12.dp)
                .clickable(enabled = game.started && !game.gameOver) { game.paused = true }
                .padding(6.dp)
        )
    }
}

@Composable
private fun Board(game: BlockGame, modifier: Modifier) {
    Canvas(
        modifier = modifier
            .background(boardColor, RoundedCornerShape(6.dp))
            .pointerInput(game) { detectTapGestures { game.rotate() } }
    ) {
        val c = size.width / COLS
        // Faint studs on the empty baseplate.
        for (y in 0 until ROWS) for (x in 0 until COLS) {
            drawCircle(Color.White.copy(alpha = 0.04f), radius = c * 0.25f, center = Offset((x + 0.5f) * c, (y + 0.45f) * c))
        }
        val board = game.board
        for (y in 0 until ROWS) for (x in 0 until COLS) {
            val v = board[y * COLS + x]
            if (v != 0) drawStudCell(Offset(x * c, y * c), c, pieceColors[v - 1])
        }
        if (!game.gameOver) {
            game.ghost()?.let { g ->
                g.absolute().filter { it.y >= 0 }.forEach {
                    drawRoundRect(
                        pieceColors[g.type].copy(alpha = 0.55f),
                        topLeft = Offset(it.x * c + c * 0.08f, it.y * c + c * 0.08f),
                        size = Size(c * 0.84f, c * 0.84f),
                        cornerRadius = CornerRadius(c * 0.12f),
                        style = Stroke(width = c * 0.07f),
                    )
                }
            }
        }
        game.piece?.let { p ->
            p.absolute().filter { it.y >= 0 }.forEach { drawStudCell(Offset(it.x * c, it.y * c), c, pieceColors[p.type]) }
        }
    }
}

private fun DrawScope.drawPreview(type: Int) {
    val cells = shapeOf(type)
    val minX = cells.minOf { it.x }
    val maxX = cells.maxOf { it.x }
    val minY = cells.minOf { it.y }
    val maxY = cells.maxOf { it.y }
    val w = maxX - minX + 1
    val h = maxY - minY + 1
    val c = minOf(size.width / 4f, size.height / 2f)
    val ox = (size.width - w * c) / 2f
    val oy = (size.height - h * c) / 2f
    cells.forEach { drawStudCell(Offset(ox + (it.x - minX) * c, oy + (it.y - minY) * c), c, pieceColors[type]) }
}

@Composable
private fun Controls(game: BlockGame) {
    Row(
        modifier = Modifier.fillMaxWidth().height(76.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        val m = Modifier.weight(1f).fillMaxHeight()
        ControlButton("◀", Color(0xFF0055BF), m, repeat = true) { game.move(-1) }
        ControlButton("▶", Color(0xFF0055BF), m, repeat = true) { game.move(1) }
        ControlButton("▼", Color(0xFF4B9F4A), m, repeat = true) { game.softDrop() }
        ControlButton("↻", Color(0xFF8E44AD), m, repeat = false) { game.rotate() }
        ControlButton("⏬", Color(0xFFD01012), m, repeat = false) { game.hardDrop() }
    }
}

/** A button that reacts on touch-down and, if [repeat], keeps firing while held. */
@Composable
private fun ControlButton(label: String, color: Color, modifier: Modifier, repeat: Boolean, onPress: () -> Unit) {
    val scope = rememberCoroutineScope()
    Box(
        modifier = modifier
            .background(color, RoundedCornerShape(16.dp))
            .pointerInput(Unit) {
                awaitEachGesture {
                    awaitFirstDown()
                    onPress()
                    val job = if (repeat) scope.launch {
                        delay(220)
                        while (true) {
                            onPress()
                            delay(60)
                        }
                    } else null
                    waitForUpOrCancellation()
                    job?.cancel()
                }
            },
        contentAlignment = Alignment.Center,
    ) {
        Text(label, fontSize = 30.sp, color = Color.White, fontWeight = FontWeight.Bold)
    }
}

@Composable
internal fun Overlay(content: @Composable () -> Unit) {
    Column(
        modifier = Modifier
            .padding(16.dp)
            .background(background.copy(alpha = 0.93f), RoundedCornerShape(20.dp))
            .padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) { content() }
}

@Composable
internal fun Title() {
    val text = buildAnnotatedString {
        var i = 0
        "Filuccas\nKlodser".forEach { ch ->
            if (ch == '\n') append(ch)
            else withStyle(SpanStyle(color = pieceColors[i++ % pieceColors.size])) { append(ch) }
        }
    }
    Text(text, fontSize = 44.sp, lineHeight = 48.sp, fontWeight = FontWeight.Black, textAlign = TextAlign.Center)
}

@Composable
internal fun BigButton(label: String, color: Color = pink, onClick: () -> Unit) {
    Box(
        modifier = Modifier
            .size(width = 270.dp, height = 64.dp)
            .background(color, RoundedCornerShape(14.dp))
            .clickable(onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        Text(label, fontSize = 26.sp, fontWeight = FontWeight.ExtraBold, color = Color.White)
    }
}
