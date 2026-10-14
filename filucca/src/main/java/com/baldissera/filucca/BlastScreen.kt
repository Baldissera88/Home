package com.baldissera.filucca

import android.content.SharedPreferences
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateIntAsState
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectDragGestures
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
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shadow
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.positionInRoot
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.min
import kotlin.math.roundToInt
import kotlin.math.sin
import kotlin.random.Random

private const val BLAST_RECORD_KEY = "blast_record"
private const val SPARK_LIFE = 0.7f
private val gold = Color(0xFFFFD166)
private val panel = Color(0x33000000)

/** Where the board sits on screen, updated on layout; read while dragging. */
private class BoardGeometry {
    var origin = Offset.Zero
    var cell = 0f
}

/** A sparkle flying out of a cleared cell, in board pixels. */
private data class Spark(
    val x: Float,
    val y: Float,
    val vx: Float,
    val vy: Float,
    val color: Color,
    val size: Float,
    val age: Float = 0f,
)

@Composable
fun BlastScreen(game: BlastGame, audio: GameAudio, prefs: SharedPreferences, onHome: () -> Unit) {
    var record by remember { mutableIntStateOf(prefs.getInt(BLAST_RECORD_KEY, 0)) }
    var newRecord by remember { mutableStateOf(false) }
    var cheer by remember { mutableStateOf<String?>(null) }
    var cheerId by remember { mutableIntStateOf(0) }
    var flashCells by remember { mutableStateOf<Set<Int>>(emptySet()) }
    val flash = remember { Animatable(0f) }
    var placedCells by remember { mutableStateOf<Set<Int>>(emptySet()) }
    val placeAnim = remember { Animatable(1f) }
    val sparks = remember { mutableStateListOf<Spark>() }
    var sparkBurst by remember { mutableIntStateOf(0) }
    val scope = rememberCoroutineScope()

    var dragIndex by remember { mutableStateOf<Int?>(null) }
    var finger by remember { mutableStateOf(Offset.Zero) }
    var rootOrigin by remember { mutableStateOf(Offset.Zero) }
    val geo = remember { BoardGeometry() }
    val slotOrigins = remember { Array(3) { Offset.Zero } }

    val shownScore by animateIntAsState(game.score, tween(500), label = "score")

    fun showCheer(text: String) {
        cheer = text
        cheerId++
    }

    remember(game) {
        game.listener = { e ->
            when (e) {
                is BlastEvent.Placed -> {
                    placedCells = e.placed
                    scope.launch {
                        placeAnim.snapTo(0f)
                        placeAnim.animateTo(1f, spring(dampingRatio = Spring.DampingRatioMediumBouncy))
                    }
                    if (e.lines == 0) {
                        audio.click()
                    } else {
                        flashCells = e.cleared.keys
                        scope.launch {
                            flash.snapTo(1f)
                            flash.animateTo(0f, tween(450))
                        }
                        val c = geo.cell
                        e.cleared.forEach { (idx, color) ->
                            repeat(3) {
                                val angle = Random.nextFloat() * 2f * PI.toFloat()
                                val speed = c * (2f + Random.nextFloat() * 4f)
                                sparks += Spark(
                                    x = (idx % BLAST_SIZE + 0.5f) * c,
                                    y = (idx / BLAST_SIZE + 0.5f) * c,
                                    vx = cos(angle) * speed,
                                    vy = sin(angle) * speed - c * 2f,
                                    color = gemColors[color.coerceIn(gemColors.indices)],
                                    size = c * (0.08f + Random.nextFloat() * 0.1f),
                                )
                            }
                        }
                        sparkBurst++
                        when {
                            e.boardClear -> {
                                audio.big()
                                showCheer("Tomt bræt! 🌟")
                                audio.speak("Wow! Helt tomt, Filucca!")
                            }
                            e.lines >= 3 || e.combo >= 3 -> {
                                audio.big()
                                val text = cheers.random()
                                showCheer(if (e.combo >= 2) "Combo x${e.combo}! 🔥" else text)
                                audio.speak(text)
                            }
                            else -> {
                                audio.clear()
                                if (e.lines >= 2) {
                                    val text = cheers.random()
                                    showCheer(text)
                                    audio.speak(text)
                                } else if (e.combo >= 2) {
                                    showCheer("Combo x${e.combo}! 🔥")
                                }
                            }
                        }
                    }
                }
                BlastEvent.GameOver -> {
                    audio.over()
                    newRecord = game.score > record
                    if (newRecord) {
                        record = game.score
                        prefs.edit().putInt(BLAST_RECORD_KEY, record).apply()
                        audio.speak("Ny rekord! Fantastisk, Filucca!")
                    } else {
                        audio.speak("Godt spillet, Filucca!")
                    }
                }
            }
        }
        true
    }

    LaunchedEffect(Unit) {
        if (!game.started) game.newGame()
    }

    LaunchedEffect(cheerId) {
        if (cheer != null) {
            delay(1500)
            cheer = null
        }
    }

    // Move sparkles until they have all faded.
    LaunchedEffect(sparkBurst) {
        var last = withFrameNanos { it }
        while (sparks.isNotEmpty()) {
            withFrameNanos { now ->
                val dt = ((now - last) / 1_000_000_000f).coerceAtMost(0.05f)
                last = now
                val gravity = geo.cell * 14f
                for (i in sparks.indices.reversed()) {
                    val s = sparks[i]
                    val age = s.age + dt
                    if (age > SPARK_LIFE) sparks.removeAt(i)
                    else sparks[i] = s.copy(x = s.x + s.vx * dt, y = s.y + s.vy * dt, vy = s.vy + gravity * dt, age = age)
                }
            }
        }
    }

    // The piece is drawn above the finger so it stays visible while dragging.
    fun targetFor(p: BlastPiece): Pair<Int, Int> {
        val c = geo.cell
        val topLeft = finger - Offset(p.w * c / 2f, p.h * c + c * 1.2f)
        return ((topLeft.x - geo.origin.x) / c).roundToInt() to ((topLeft.y - geo.origin.y) / c).roundToInt()
    }

    fun drop() {
        val i = dragIndex ?: return
        dragIndex = null
        val p = game.tray[i] ?: return
        val (gx, gy) = targetFor(p)
        game.place(i, gx, gy)
    }

    val dragged = dragIndex?.let { game.tray.getOrNull(it) }
    val target = dragged?.let { targetFor(it) }
    val valid = dragged != null && target != null && game.fits(dragged, target.first, target.second)
    val willClear = if (valid) game.wouldClear(dragged!!, target!!.first, target.second) else emptySet()

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(gemBackground)
            .onGloballyPositioned { rootOrigin = it.positionInRoot() }
    ) {
        Column(
            modifier = Modifier.fillMaxSize().systemBarsPadding().padding(12.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth()) {
                Text("💎", fontSize = 28.sp)
                Column(modifier = Modifier.weight(1f), horizontalAlignment = Alignment.CenterHorizontally) {
                    Text(
                        "$shownScore",
                        style = TextStyle(
                            color = gold,
                            fontSize = 40.sp,
                            fontWeight = FontWeight.Black,
                            shadow = Shadow(Color(0xAA000000), Offset(0f, 4f), 8f),
                        ),
                    )
                    Text("👑 $record", color = Color.White.copy(alpha = 0.8f), fontSize = 16.sp, fontWeight = FontWeight.Bold)
                }
                Text(
                    text = "🏠",
                    fontSize = 28.sp,
                    modifier = Modifier
                        .background(panel, RoundedCornerShape(12.dp))
                        .clickable(onClick = onHome)
                        .padding(8.dp)
                )
            }

            Box(
                modifier = Modifier.weight(1f).fillMaxWidth(),
                contentAlignment = Alignment.Center,
            ) {
                Canvas(
                    modifier = Modifier
                        .fillMaxWidth()
                        .aspectRatio(1f)
                        .background(panel, RoundedCornerShape(18.dp))
                        .padding(6.dp)
                        .onGloballyPositioned {
                            geo.origin = it.positionInRoot()
                            geo.cell = it.size.width / BLAST_SIZE.toFloat()
                        }
                ) {
                    val c = size.width / BLAST_SIZE
                    val board = game.board
                    val pop = placeAnim.value
                    for (y in 0 until BLAST_SIZE) for (x in 0 until BLAST_SIZE) {
                        val idx = y * BLAST_SIZE + x
                        val v = board[idx]
                        val topLeft = Offset(x * c, y * c)
                        drawRoundRect(
                            Color.White.copy(alpha = 0.06f),
                            topLeft = Offset(topLeft.x + c * 0.05f, topLeft.y + c * 0.05f),
                            size = Size(c * 0.9f, c * 0.9f),
                            cornerRadius = CornerRadius(c * 0.18f),
                        )
                        if (v != 0) {
                            // Lines about to be cleared light up in the colour of the piece being dragged.
                            val color = if (idx in willClear) gemColors[dragged!!.color].lighter(0.15f) else gemColors[v - 1]
                            val scale = if (idx in placedCells) 0.75f + 0.25f * pop else 1f
                            drawGemCell(topLeft, c, color, scale = scale)
                        }
                    }
                    if (valid) {
                        dragged!!.cells.forEach {
                            drawGemCell(Offset((target!!.first + it.x) * c, (target.second + it.y) * c), c, gemColors[dragged.color], alpha = 0.35f)
                        }
                    }
                    val a = flash.value
                    if (a > 0f) {
                        flashCells.forEach { idx ->
                            drawRoundRect(
                                Color.White.copy(alpha = a * 0.85f),
                                topLeft = Offset((idx % BLAST_SIZE) * c, (idx / BLAST_SIZE) * c),
                                size = Size(c, c),
                                cornerRadius = CornerRadius(c * 0.18f),
                            )
                        }
                    }
                    sparks.forEach { s ->
                        val fade = 1f - s.age / SPARK_LIFE
                        drawCircle(s.color.copy(alpha = 0.35f * fade), radius = s.size * 2f, center = Offset(s.x, s.y))
                        drawCircle(s.color.lighter(0.5f).copy(alpha = fade), radius = s.size, center = Offset(s.x, s.y))
                    }
                }

                if (game.gameOver) {
                    Overlay {
                        Text("Ingen plads!", color = Color.White, fontSize = 32.sp, fontWeight = FontWeight.Black)
                        Text("Point: ${game.score}", color = gold, fontSize = 26.sp, fontWeight = FontWeight.Bold)
                        if (newRecord) {
                            Text("👑 Ny rekord, Filucca!", color = gold, fontSize = 24.sp, fontWeight = FontWeight.Bold)
                        } else {
                            Text("Rekord: $record", color = Color.White.copy(alpha = 0.8f), fontSize = 20.sp)
                        }
                        BigButton("Spil igen") {
                            newRecord = false
                            game.newGame()
                        }
                        BigButton("Menu", color = Color(0xFF546E7A), onClick = onHome)
                    }
                }

                CheerBubble(cheer)
            }

            Row(
                modifier = Modifier.fillMaxWidth().height(130.dp),
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                for (i in 0 until 3) {
                    val p = game.tray[i]
                    Box(
                        modifier = Modifier
                            .weight(1f)
                            .fillMaxHeight()
                            .background(panel, RoundedCornerShape(16.dp))
                            .onGloballyPositioned { slotOrigins[i] = it.positionInRoot() }
                            .pointerInput(i) {
                                detectDragGestures(
                                    onDragStart = { off ->
                                        if (game.tray[i] != null && !game.gameOver) {
                                            dragIndex = i
                                            finger = slotOrigins[i] + off
                                        }
                                    },
                                    onDragEnd = { drop() },
                                    onDragCancel = { dragIndex = null },
                                    onDrag = { change, amount ->
                                        change.consume()
                                        if (dragIndex == i) finger += amount
                                    },
                                )
                            }
                    ) {
                        if (p != null && dragIndex != i) {
                            val usable = game.fitsAnywhere(p)
                            Canvas(Modifier.fillMaxSize()) {
                                val c = min(size.width, size.height) / 5.5f
                                val ox = (size.width - p.w * c) / 2f
                                val oy = (size.height - p.h * c) / 2f
                                p.cells.forEach {
                                    drawGemCell(Offset(ox + it.x * c, oy + it.y * c), c, gemColors[p.color], alpha = if (usable) 1f else 0.25f)
                                }
                            }
                        }
                    }
                }
            }
        }

        if (dragged != null) {
            Canvas(Modifier.fillMaxSize()) {
                val c = geo.cell
                val topLeft = finger - rootOrigin - Offset(dragged.w * c / 2f, dragged.h * c + c * 1.2f)
                dragged.cells.forEach {
                    // Soft shadow, then the gem itself.
                    drawRoundRect(
                        Color.Black.copy(alpha = 0.25f),
                        topLeft = Offset(topLeft.x + it.x * c + c * 0.08f, topLeft.y + it.y * c + c * 0.14f),
                        size = Size(c * 0.92f, c * 0.92f),
                        cornerRadius = CornerRadius(c * 0.2f),
                    )
                }
                dragged.cells.forEach {
                    drawGemCell(Offset(topLeft.x + it.x * c, topLeft.y + it.y * c), c, gemColors[dragged.color])
                }
            }
        }
    }
}
