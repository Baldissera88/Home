package com.baldissera.home.game

import android.media.AudioManager
import android.media.ToneGenerator
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
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
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.min
import kotlin.math.sin
import kotlin.random.Random

private val balloonColors = listOf(
    Color(0xFFE53935), // red
    Color(0xFFFB8C00), // orange
    Color(0xFFFDD835), // yellow
    Color(0xFF43A047), // green
    Color(0xFF1E88E5), // blue
    Color(0xFF8E24AA), // purple
    Color(0xFFEC407A), // pink
)

private val cheers = listOf("Great job! 🎉", "Awesome! ⭐", "Super! 🚀", "Wow! 🌈", "You rock! 🦖")

private data class Balloon(
    val baseX: Float,
    val y: Float,
    val radius: Float,
    val color: Color,
    val speed: Float,
    val age: Float = 0f,
    val wobblePhase: Float = Random.nextFloat() * 2f * PI.toFloat(),
) {
    val x: Float get() = baseX + sin(age * 2f + wobblePhase) * radius * 0.3f
}

private data class Pop(val x: Float, val y: Float, val radius: Float, val color: Color, val startNanos: Long)

private const val POP_DURATION_NANOS = 500_000_000L

@Composable
fun BalloonGame(modifier: Modifier = Modifier) {
    val balloons = remember { mutableStateListOf<Balloon>() }
    val pops = remember { mutableStateListOf<Pop>() }
    var score by remember { mutableIntStateOf(0) }
    var frameTime by remember { mutableLongStateOf(0L) }
    var canvasSize by remember { mutableStateOf(IntSize.Zero) }
    var cheer by remember { mutableStateOf<String?>(null) }

    val tone = remember { runCatching { ToneGenerator(AudioManager.STREAM_MUSIC, 70) }.getOrNull() }
    DisposableEffect(Unit) { onDispose { tone?.release() } }

    // Game loop: move balloons up, spawn new ones, clean up finished pops.
    LaunchedEffect(canvasSize) {
        if (canvasSize == IntSize.Zero) return@LaunchedEffect
        val w = canvasSize.width.toFloat()
        val h = canvasSize.height.toFloat()
        var last = withFrameNanos { it }
        var untilSpawn = 0f
        while (true) {
            withFrameNanos { now ->
                val dt = ((now - last) / 1_000_000_000f).coerceAtMost(0.05f)
                last = now
                frameTime = now

                for (i in balloons.indices.reversed()) {
                    val b = balloons[i]
                    val ny = b.y - b.speed * dt
                    if (ny < -b.radius * 3f) balloons.removeAt(i)
                    else balloons[i] = b.copy(y = ny, age = b.age + dt)
                }

                untilSpawn -= dt
                if (untilSpawn <= 0f && balloons.size < 8) {
                    val radius = min(w, h) * Random.nextDouble(0.09, 0.13).toFloat()
                    // Gets a little faster as the score grows, but stays gentle.
                    val speedFactor = 0.12f + min(score, 60) * 0.002f
                    balloons += Balloon(
                        baseX = Random.nextFloat() * (w - 2.6f * radius) + 1.3f * radius,
                        y = h + radius * 1.5f,
                        radius = radius,
                        color = balloonColors.random(),
                        speed = h * speedFactor * Random.nextDouble(0.8, 1.2).toFloat(),
                    )
                    untilSpawn = Random.nextDouble(0.6, 1.2).toFloat()
                }

                pops.removeAll { now - it.startNanos > POP_DURATION_NANOS }
            }
        }
    }

    LaunchedEffect(cheer) {
        if (cheer != null) {
            kotlinx.coroutines.delay(1500)
            cheer = null
        }
    }

    Box(
        modifier = modifier
            .fillMaxSize()
            .background(Brush.verticalGradient(listOf(Color(0xFF81D4FA), Color(0xFFE1F5FE))))
    ) {
        Canvas(
            modifier = Modifier
                .fillMaxSize()
                .onSizeChanged { canvasSize = it }
                .pointerInput(Unit) {
                    detectTapGestures { tap ->
                        // Check the front-most balloon first; generous hit area for small fingers.
                        val hit = balloons.indices.reversed().firstOrNull { i ->
                            val b = balloons[i]
                            val dx = tap.x - b.x
                            val dy = (tap.y - b.y) / 1.2f
                            dx * dx + dy * dy <= (b.radius * 1.25f) * (b.radius * 1.25f)
                        }
                        if (hit != null) {
                            val b = balloons.removeAt(hit)
                            pops += Pop(b.x, b.y, b.radius, b.color, frameTime)
                            score++
                            tone?.startTone(ToneGenerator.TONE_PROP_BEEP, 60)
                            if (score % 10 == 0) cheer = cheers.random()
                        }
                    }
                }
        ) {
            drawSun()
            balloons.forEach { drawBalloon(it) }
            pops.forEach { drawPop(it, frameTime) }
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
                .background(Color.White.copy(alpha = 0.7f), RoundedCornerShape(16.dp))
                .padding(horizontal = 16.dp, vertical = 4.dp)
        )

        AnimatedVisibility(
            visible = score == 0,
            enter = fadeIn(),
            exit = fadeOut(),
            modifier = Modifier.align(Alignment.Center),
        ) {
            BigLabel("Pop the balloons! 🎈")
        }

        AnimatedVisibility(
            visible = cheer != null,
            enter = fadeIn() + scaleIn(),
            exit = fadeOut(),
            modifier = Modifier.align(Alignment.Center),
        ) {
            BigLabel(cheer ?: "")
        }
    }
}

@Composable
private fun BigLabel(text: String) {
    Text(
        text = text,
        fontSize = 40.sp,
        fontWeight = FontWeight.ExtraBold,
        color = Color(0xFF6A1B9A),
        modifier = Modifier
            .background(Color.White.copy(alpha = 0.85f), RoundedCornerShape(24.dp))
            .padding(horizontal = 24.dp, vertical = 12.dp)
    )
}

private fun DrawScope.drawSun() {
    val r = size.minDimension * 0.12f
    val center = Offset(size.width - r * 1.4f, r * 2.2f)
    drawCircle(Color(0x55FFEB3B), radius = r * 1.5f, center = center)
    drawCircle(Color(0xFFFFEB3B), radius = r, center = center)
}

private fun DrawScope.drawBalloon(b: Balloon) {
    val w = b.radius * 2f
    val h = b.radius * 2.4f
    val top = Offset(b.x - b.radius, b.y - h / 2f)
    // String
    drawLine(
        color = Color(0xFF616161),
        start = Offset(b.x, b.y + h / 2f),
        end = Offset(b.x + sin(b.age * 3f) * b.radius * 0.2f, b.y + h / 2f + b.radius * 1.6f),
        strokeWidth = 3f,
    )
    // Knot
    drawCircle(b.color, radius = b.radius * 0.12f, center = Offset(b.x, b.y + h / 2f))
    // Body and shine
    drawOval(b.color, topLeft = top, size = Size(w, h))
    drawOval(
        Color.White.copy(alpha = 0.45f),
        topLeft = Offset(b.x - b.radius * 0.6f, b.y - h * 0.35f),
        size = Size(b.radius * 0.45f, b.radius * 0.7f),
    )
}

private fun DrawScope.drawPop(p: Pop, now: Long) {
    val t = ((now - p.startNanos).toFloat() / POP_DURATION_NANOS).coerceIn(0f, 1f)
    val alpha = 1f - t
    val spread = p.radius * (0.5f + t * 1.5f)
    for (i in 0 until 10) {
        val angle = i * (2f * PI.toFloat() / 10f)
        val color = if (i % 2 == 0) p.color else Color(0xFFFFD54F)
        drawCircle(
            color.copy(alpha = alpha),
            radius = p.radius * 0.18f * (1f - t * 0.5f),
            center = Offset(p.x + cos(angle) * spread, p.y + sin(angle) * spread),
        )
    }
}
