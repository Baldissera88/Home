package com.baldissera.home.game

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.min
import kotlin.math.sin
import kotlin.random.Random

enum class Mode { FREE, COLOURS }

val skyBrush = Brush.verticalGradient(listOf(Color(0xFF81D4FA), Color(0xFFE1F5FE)))

private val faces = listOf("🐶", "🐱", "🦖", "🐷", "🐸", "🦁", "🐵", "🐰", "🐼", "🐯")

private const val SHAKE_NANOS = 400_000_000L
private const val PIECE_LIFE = 0.9f
private const val ROUND_LENGTH = 5

private data class Brick(
    val baseX: Float,
    val y: Float,
    val color: BrickColor,
    val face: String,
    val speed: Float,
    val age: Float = 0f,
    val phase: Float = Random.nextFloat() * 2f * PI.toFloat(),
    val shakeStart: Long = 0L,
) {
    fun x(s: Float) = baseX + sin(age * 1.5f + phase) * s * 0.15f
}

private data class Piece(
    val x: Float,
    val y: Float,
    val vx: Float,
    val vy: Float,
    val rot: Float,
    val vrot: Float,
    val color: Color,
    val size: Float,
    val age: Float = 0f,
)

private fun brickSizeFor(width: Int, height: Int) = min(width, height) * 0.22f

private fun rand(from: Double, to: Double) = Random.nextDouble(from, to).toFloat()

@Composable
fun BrickGame(mode: Mode, lang: Lang, audio: GameAudio, onHome: () -> Unit, modifier: Modifier = Modifier) {
    val texts = lang.texts
    val bricks = remember { mutableStateListOf<Brick>() }
    val pieces = remember { mutableStateListOf<Piece>() }
    var score by remember { mutableIntStateOf(0) }
    var roundHits by remember { mutableIntStateOf(0) }
    var target by remember { mutableStateOf(BrickColor.entries.random()) }
    var frameTime by remember { mutableLongStateOf(0L) }
    var canvasSize by remember { mutableStateOf(IntSize.Zero) }
    var cheer by remember { mutableStateOf<String?>(null) }

    val density = LocalDensity.current
    val measurer = rememberTextMeasurer()
    val brickSize = brickSizeFor(canvasSize.width, canvasSize.height)
    val faceLayouts = remember(brickSize) {
        val style = TextStyle(fontSize = with(density) { (brickSize * 0.4f).toSp() })
        faces.associateWith { measurer.measure(AnnotatedString(it), style = style) }
    }

    LaunchedEffect(Unit) {
        audio.speak(if (mode == Mode.FREE) texts.intro else texts.find(target))
    }

    // Game loop: move bricks and flying pieces, spawn new bricks.
    LaunchedEffect(canvasSize) {
        if (canvasSize == IntSize.Zero) return@LaunchedEffect
        val w = canvasSize.width.toFloat()
        val h = canvasSize.height.toFloat()
        val s = brickSizeFor(canvasSize.width, canvasSize.height)
        var last = withFrameNanos { it }
        var untilSpawn = 0f
        while (true) {
            withFrameNanos { now ->
                val dt = ((now - last) / 1_000_000_000f).coerceAtMost(0.05f)
                last = now
                frameTime = now

                for (i in bricks.indices.reversed()) {
                    val b = bricks[i]
                    val ny = b.y - b.speed * dt
                    if (ny < -s * 2f) bricks.removeAt(i)
                    else bricks[i] = b.copy(y = ny, age = b.age + dt)
                }

                for (i in pieces.indices.reversed()) {
                    val p = pieces[i]
                    val age = p.age + dt
                    if (age > PIECE_LIFE) pieces.removeAt(i)
                    else pieces[i] = p.copy(
                        x = p.x + p.vx * dt,
                        y = p.y + p.vy * dt,
                        vy = p.vy + h * 1.5f * dt,
                        rot = p.rot + p.vrot * dt,
                        age = age,
                    )
                }

                untilSpawn -= dt
                if (untilSpawn <= 0f && bricks.size < 7) {
                    // In colour mode make sure the colour Victor is looking for keeps showing up.
                    val color = if (mode == Mode.COLOURS &&
                        (bricks.none { it.color == target } || Random.nextFloat() < 0.4f)
                    ) target else BrickColor.entries.random()
                    val speedFactor = 0.10f + min(score, 40) * 0.002f
                    bricks += Brick(
                        baseX = Random.nextFloat() * (w - 1.6f * s) + 0.8f * s,
                        y = h + s,
                        color = color,
                        face = faces.random(),
                        speed = h * speedFactor * rand(0.85, 1.15),
                    )
                    untilSpawn = rand(0.7, 1.3)
                }
            }
        }
    }

    LaunchedEffect(cheer) {
        if (cheer != null) {
            delay(1800)
            cheer = null
        }
    }

    Box(modifier = modifier.fillMaxSize().background(skyBrush)) {
        Canvas(
            modifier = Modifier
                .fillMaxSize()
                .onSizeChanged { canvasSize = it }
                .pointerInput(mode) {
                    detectTapGestures { tap ->
                        val s = brickSizeFor(size.width, size.height)
                        // Front-most brick first; generous hit area for small fingers.
                        val i = bricks.indices.reversed().firstOrNull { idx ->
                            val b = bricks[idx]
                            abs(tap.x - b.x(s)) <= s * 0.65f && (tap.y - b.y) in -s * 0.6f..s * 0.55f
                        } ?: return@detectTapGestures
                        val b = bricks[i]

                        if (mode == Mode.COLOURS && b.color != target) {
                            bricks[i] = b.copy(shakeStart = frameTime)
                            audio.boop()
                            audio.speak(texts.thatIs(b.color))
                            return@detectTapGestures
                        }

                        bricks.removeAt(i)
                        val cx = b.x(s)
                        repeat(12) {
                            val angle = Random.nextFloat() * 2f * PI.toFloat()
                            val speed = s * rand(2.0, 4.5)
                            pieces += Piece(
                                x = cx, y = b.y,
                                vx = cos(angle) * speed, vy = sin(angle) * speed - s * 2f,
                                rot = Random.nextFloat() * 360f, vrot = rand(-540.0, 540.0),
                                color = if (it % 3 == 0) Color(0xFFFFD54F) else b.color.color,
                                size = s * rand(0.14, 0.24),
                            )
                        }
                        audio.pop()
                        score++

                        if (mode == Mode.FREE) {
                            if (score % 10 == 0) {
                                val c = texts.cheers.random()
                                cheer = c
                                audio.speak(c)
                            } else {
                                audio.speak(score.toString())
                            }
                        } else {
                            roundHits++
                            if (roundHits >= ROUND_LENGTH) {
                                roundHits = 0
                                target = BrickColor.entries.filter { it != target }.random()
                                val c = texts.cheers.random()
                                cheer = c
                                audio.speak("$c ${texts.nowFind(target)}")
                            } else {
                                audio.speak(roundHits.toString())
                            }
                        }
                    }
                }
        ) {
            drawSun()
            val s = brickSizeFor(size.width.toInt(), size.height.toInt())
            bricks.forEach { b ->
                val t = (frameTime - b.shakeStart).toFloat() / SHAKE_NANOS
                val shake = if (b.shakeStart > 0L && t in 0f..1f) sin(t * 40f) * s * 0.08f * (1f - t) else 0f
                drawBrick(Offset(b.x(s) + shake, b.y), s, b.color.color, faceLayouts[b.face])
            }
            pieces.forEach { p ->
                val alpha = 1f - p.age / PIECE_LIFE
                rotate(p.rot, pivot = Offset(p.x, p.y)) {
                    drawRoundRect(
                        p.color.copy(alpha = alpha),
                        topLeft = Offset(p.x - p.size / 2f, p.y - p.size * 0.35f),
                        size = Size(p.size, p.size * 0.7f),
                        cornerRadius = CornerRadius(p.size * 0.12f),
                    )
                }
            }
            drawBaseplate(s)
        }

        Text(
            text = "⭐ $score",
            fontSize = 36.sp,
            fontWeight = FontWeight.Bold,
            color = Color(0xFF37474F),
            modifier = Modifier
                .align(Alignment.TopStart)
                .statusBarsPadding()
                .padding(16.dp)
                .background(Color.White.copy(alpha = 0.75f), RoundedCornerShape(16.dp))
                .padding(horizontal = 16.dp, vertical = 4.dp)
        )

        Text(
            text = "🏠",
            fontSize = 36.sp,
            modifier = Modifier
                .align(Alignment.TopEnd)
                .statusBarsPadding()
                .padding(16.dp)
                .background(Color.White.copy(alpha = 0.75f), RoundedCornerShape(16.dp))
                .clickable(onClick = onHome)
                .padding(horizontal = 12.dp, vertical = 4.dp)
        )

        if (mode == Mode.COLOURS) {
            // The brick to look for; tapping it repeats the instruction.
            Canvas(
                modifier = Modifier
                    .align(Alignment.TopCenter)
                    .statusBarsPadding()
                    .padding(top = 16.dp)
                    .size(96.dp, 72.dp)
                    .background(Color.White.copy(alpha = 0.75f), RoundedCornerShape(16.dp))
                    .clickable { audio.speak(texts.find(target)) }
            ) {
                drawBrick(Offset(size.width / 2f, size.height * 0.58f), size.width * 0.6f, target.color)
            }
        }

        AnimatedVisibility(
            visible = cheer != null,
            enter = fadeIn() + scaleIn(),
            exit = fadeOut(),
            modifier = Modifier.align(Alignment.Center),
        ) {
            Text(
                text = "🎉 ${cheer ?: ""}",
                fontSize = 40.sp,
                fontWeight = FontWeight.ExtraBold,
                textAlign = TextAlign.Center,
                color = Color(0xFFD01012),
                modifier = Modifier
                    .padding(24.dp)
                    .background(Color.White.copy(alpha = 0.9f), RoundedCornerShape(24.dp))
                    .padding(horizontal = 24.dp, vertical = 12.dp)
            )
        }
    }
}
