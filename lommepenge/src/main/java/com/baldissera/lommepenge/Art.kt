package com.baldissera.lommepenge

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.composed
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.graphics.drawscope.translate
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.sin
import kotlin.random.Random

/** Each kid picks one of these as their colour. */
val Palettes = listOf(
    listOf(Color(0xFF36B9FF), Color(0xFF3A6FF7)), // ocean
    listOf(Color(0xFFFF7EB3), Color(0xFFB548F0)), // berry
    listOf(Color(0xFF3EDC8A), Color(0xFF0FA3B1)), // lagoon
    listOf(Color(0xFFFFB347), Color(0xFFFF5E62)), // sunset
    listOf(Color(0xFF8E7BFF), Color(0xFF5B3CC4)), // grape
    listOf(Color(0xFFFFD93D), Color(0xFFFF8C1A)), // sun
)

fun palette(i: Int) = Palettes[Math.floorMod(i, Palettes.size)]

val Gold = Color(0xFFFFC107)
val Ink = Color(0xFF2B2140)
val NightSky = listOf(Color(0xFF1E1352), Color(0xFF4A2DB0), Color(0xFF8A5CF0))

/** When false, endless decorative motion stops (used by the screenshot tests). */
object Motion {
    var enabled = true
}

/** Gradient backdrop with slowly rising bubbles and twinkling stars. */
@Composable
fun Backdrop(colors: List<Color>, modifier: Modifier = Modifier, stars: Boolean = true) {
    val t = if (Motion.enabled) {
        rememberInfiniteTransition(label = "sky").animateFloat(
            0f, 1f, infiniteRepeatable(tween(30000, easing = LinearEasing)), label = "drift"
        ).value
    } else 0.3f
    Canvas(modifier.fillMaxSize()) {
        drawRect(Brush.verticalGradient(colors))
        val rnd = Random(7)
        repeat(16) {
            val x = rnd.nextFloat() * size.width
            val speed = 0.5f + rnd.nextFloat()
            val y = (rnd.nextFloat() - t * speed).mod(1f) * (size.height + 200f) - 100f
            val r = 18f + rnd.nextFloat() * 70f
            drawCircle(Color.White.copy(alpha = 0.05f + rnd.nextFloat() * 0.07f), r, Offset(x, y))
        }
        if (stars) repeat(28) {
            val x = rnd.nextFloat() * size.width
            val y = rnd.nextFloat() * size.height * 0.6f
            val tw = (sin((t * 40f + rnd.nextFloat() * 6f) * PI.toFloat()) + 1f) / 2f
            star(Offset(x, y), 4f + rnd.nextFloat() * 6f, Color.White.copy(alpha = 0.25f + 0.6f * tw))
        }
    }
}

private fun androidx.compose.ui.graphics.drawscope.DrawScope.star(c: Offset, r: Float, color: Color) {
    val p = Path()
    for (i in 0 until 8) {
        val a = i * PI.toFloat() / 4f - PI.toFloat() / 2f
        val rr = if (i % 2 == 0) r else r * 0.3f
        val pt = Offset(c.x + cos(a) * rr, c.y + sin(a) * rr)
        if (i == 0) p.moveTo(pt.x, pt.y) else p.lineTo(pt.x, pt.y)
    }
    p.close()
    drawPath(p, color)
}

/** A pink piggy bank that gently bobs and wiggles when [wiggle] changes. */
@Composable
fun PiggyBank(modifier: Modifier = Modifier, wiggle: Int = 0) {
    val bob = if (Motion.enabled) {
        rememberInfiniteTransition(label = "pig").animateFloat(
            0f, 1f, infiniteRepeatable(tween(1600, easing = FastOutSlowInEasing), RepeatMode.Reverse), label = "bob"
        ).value
    } else 0.5f
    val shake = remember { Animatable(0f) }
    LaunchedEffect(wiggle) {
        if (wiggle > 0) {
            shake.snapTo(1f)
            shake.animateTo(0f, tween(700))
        }
    }
    Canvas(modifier) {
        val w = size.width
        val h = size.height
        drawOval(Color.Black.copy(alpha = 0.16f), Offset(w * 0.2f, h * 0.88f), Size(w * 0.62f, h * 0.08f))
        val tilt = sin(shake.value * 6f * PI.toFloat()) * 8f * shake.value
        translate(top = -bob * h * 0.035f) {
            rotate(tilt, Offset(w * 0.5f, h * 0.8f)) {
                val dark = Color(0xFFE0619A)
                val body = Color(0xFFF79CC4)
                // Legs
                for (x in listOf(0.24f, 0.37f, 0.6f, 0.73f)) {
                    drawRoundRect(dark, Offset(w * x, h * 0.68f), Size(w * 0.1f, h * 0.2f), CornerRadius(w * 0.03f))
                }
                // Curly tail
                drawArc(dark, 100f, 260f, false, Offset(w * 0.02f, h * 0.42f), Size(w * 0.11f, w * 0.11f),
                    style = Stroke(w * 0.022f, cap = StrokeCap.Round))
                // Back ear
                val ear2 = Path().apply {
                    moveTo(w * 0.44f, h * 0.31f); lineTo(w * 0.5f, h * 0.12f); lineTo(w * 0.58f, h * 0.3f); close()
                }
                drawPath(ear2, dark)
                // Body
                drawOval(
                    Brush.radialGradient(listOf(Color(0xFFFFD3E6), body, dark), Offset(w * 0.42f, h * 0.4f), w * 0.55f),
                    Offset(w * 0.1f, h * 0.24f), Size(w * 0.8f, h * 0.56f)
                )
                // Front ear
                val ear = Path().apply {
                    moveTo(w * 0.56f, h * 0.32f); lineTo(w * 0.66f, h * 0.11f); lineTo(w * 0.74f, h * 0.35f); close()
                }
                drawPath(ear, body)
                drawPath(Path().apply {
                    moveTo(w * 0.6f, h * 0.31f); lineTo(w * 0.66f, h * 0.18f); lineTo(w * 0.7f, h * 0.33f); close()
                }, dark.copy(alpha = 0.6f))
                // Snout
                drawOval(Color(0xFFF06FA6), Offset(w * 0.8f, h * 0.43f), Size(w * 0.16f, h * 0.18f))
                drawOval(Color(0xFFB83E74), Offset(w * 0.84f, h * 0.49f), Size(w * 0.03f, h * 0.06f))
                drawOval(Color(0xFFB83E74), Offset(w * 0.9f, h * 0.49f), Size(w * 0.03f, h * 0.06f))
                // Eye with a sparkle
                drawCircle(Ink, w * 0.032f, Offset(w * 0.7f, h * 0.43f))
                drawCircle(Color.White, w * 0.011f, Offset(w * 0.71f, h * 0.42f))
                // Cheek
                drawCircle(Color(0xFFFF6F9F).copy(alpha = 0.45f), w * 0.045f, Offset(w * 0.72f, h * 0.56f))
                // Coin slot
                drawRoundRect(Color(0xFF9C2F5E), Offset(w * 0.38f, h * 0.265f), Size(w * 0.2f, h * 0.035f), CornerRadius(w * 0.02f))
                // Shine
                drawOval(Color.White.copy(alpha = 0.35f), Offset(w * 0.2f, h * 0.32f), Size(w * 0.18f, h * 0.09f))
            }
        }
    }
}

/** A shiny gold coin. */
@Composable
fun Coin(size: Dp, modifier: Modifier = Modifier) {
    Box(modifier.size(size), contentAlignment = Alignment.Center) {
        Canvas(Modifier.fillMaxSize()) {
            val r = this.size.minDimension / 2
            drawCircle(Color(0xFFE09B00), r, center.copy(y = center.y + r * 0.08f))
            drawCircle(Brush.radialGradient(listOf(Color(0xFFFFF3B0), Gold, Color(0xFFF2A900)),
                Offset(center.x - r * 0.3f, center.y - r * 0.3f), r * 1.4f), r * 0.94f)
            drawCircle(Color(0xFFE6A100), r * 0.72f, style = Stroke(r * 0.08f))
        }
        Text("kr", color = Color(0xFFA86A00), fontWeight = FontWeight.Black, fontSize = (size.value * 0.32f).sp)
    }
}

/** Ring that fills up as chores get done. */
@Composable
fun ProgressRing(done: Int, total: Int, size: Dp, track: Color, fill: Color, modifier: Modifier = Modifier,
                 content: @Composable () -> Unit = {}) {
    val frac by animateFloatAsState(if (total == 0) 0f else done.toFloat() / total, tween(800), label = "ring")
    Box(modifier.size(size), contentAlignment = Alignment.Center) {
        Canvas(Modifier.fillMaxSize()) {
            val sw = this.size.minDimension * 0.12f
            val inset = Offset(sw / 2, sw / 2)
            val s = Size(this.size.width - sw, this.size.height - sw)
            drawArc(track, 0f, 360f, false, inset, s, style = Stroke(sw))
            drawArc(fill, -90f, 360f * frac, false, inset, s, style = Stroke(sw, cap = StrokeCap.Round))
        }
        content()
    }
}

private val ConfettiColors = listOf(
    Color(0xFFFF5E62), Color(0xFFFFC107), Color(0xFF3EDC8A), Color(0xFF36B9FF), Color(0xFFB548F0), Color(0xFFFF7EB3)
)

/** Bursts confetti and coins from the top third of the screen each time [trigger] goes up. */
@Composable
fun ConfettiLayer(trigger: Int, modifier: Modifier = Modifier) {
    val t = remember { Animatable(1f) }
    LaunchedEffect(trigger) {
        if (trigger > 0) {
            t.snapTo(0f)
            t.animateTo(1f, tween(2400, easing = LinearEasing))
        }
    }
    if (t.value >= 1f) return
    Canvas(modifier.fillMaxSize()) {
        val rnd = Random(trigger)
        val time = t.value * 2.4f
        val g = size.height * 1.4f
        val fade = 1f - t.value * t.value * t.value
        repeat(110) { i ->
            val ang = -PI.toFloat() * (0.08f + rnd.nextFloat() * 0.84f)
            val sp = size.height * (0.55f + rnd.nextFloat() * 0.75f)
            val x = size.width * 0.5f + cos(ang) * sp * time
            val y = size.height * 0.32f + sin(ang) * sp * time + 0.5f * g * time * time
            val spin = (rnd.nextFloat() - 0.5f) * 1400f * time
            if (i % 9 == 0) {
                val r = 16f
                drawCircle(Color(0xFFE09B00).copy(alpha = fade), r, Offset(x, y + 2f))
                drawCircle(Gold.copy(alpha = fade), r * 0.9f, Offset(x, y))
                drawCircle(Color(0xFFFFF3B0).copy(alpha = fade * 0.8f), r * 0.35f, Offset(x - 4f, y - 4f))
            } else {
                rotate(spin, Offset(x, y)) {
                    drawRect(ConfettiColors[i % ConfettiColors.size].copy(alpha = fade),
                        Offset(x - 9f, y - 5f), Size(18f, 10f))
                }
            }
        }
    }
}

/** Click with a springy squash instead of a ripple. */
fun Modifier.bouncy(enabled: Boolean = true, onClick: () -> Unit): Modifier = composed {
    val src = remember { MutableInteractionSource() }
    val pressed by src.collectIsPressedAsState()
    val s by animateFloatAsState(if (pressed) 0.93f else 1f, spring(dampingRatio = 0.4f, stiffness = 600f), label = "press")
    graphicsLayer { scaleX = s; scaleY = s }
        .clickable(interactionSource = src, indication = null, enabled = enabled, onClick = onClick)
}

fun Modifier.glass(alpha: Float = 0.18f, radius: Dp = 24.dp) =
    background(Color.White.copy(alpha = alpha), androidx.compose.foundation.shape.RoundedCornerShape(radius))
