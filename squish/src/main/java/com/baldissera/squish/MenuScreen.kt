package com.baldissera.squish

import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.State
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.snapshotFlow
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.flow.first
import kotlin.math.PI
import kotlin.math.roundToInt
import kotlin.math.sin

internal val Ink = Color(0xFF5A1E5C)
internal val Bubblegum = Color(0xFFFF5FA2)
internal val CardWhite = Color(0xFFFFF7FB)
private val titleColors = listOf(
    Color(0xFFFF6FB5), Color(0xFFFFB648), Color(0xFF7BE07E), Color(0xFF5EC8FF), Color(0xFFB98CFF), Color(0xFFFF8A7A),
)
private val bubbleColors = listOf(
    Color(0xFFFF7EB9), Color(0xFFB58CFF), Color(0xFF6FD6A3), Color(0xFFFFB84D), Color(0xFF63C7FF), Color(0xFFFF8F70),
)

/** Seconds since this composable appeared, advanced every frame. Read it only inside draw/layer lambdas. */
@Composable
internal fun rememberClock(): State<Float> {
    val t = remember { mutableFloatStateOf(0f) }
    LaunchedEffect(Unit) {
        val start = withFrameNanos { it }
        while (true) withFrameNanos { t.floatValue = (it - start) / 1_000_000_000f }
    }
    return t
}

/** Thick outlined "candy" text: soft drop shadow, dark outline, coloured fill and a glossy highlight. */
@Composable
internal fun BubblyText(
    text: String,
    fontSize: TextUnit,
    fill: Color,
    modifier: Modifier = Modifier,
    outline: Color = Ink,
) {
    val px = with(LocalDensity.current) { fontSize.toPx() }
    val base = TextStyle(fontSize = fontSize, fontWeight = FontWeight.Black, textAlign = TextAlign.Center, lineHeight = fontSize * 1.05f)
    Box(modifier, contentAlignment = Alignment.Center) {
        Text(
            text,
            style = base.copy(color = Color(0x55000000), drawStyle = Stroke(px * 0.26f, join = StrokeJoin.Round)),
            modifier = Modifier.offset(y = with(LocalDensity.current) { (px * 0.09f).toDp() }),
        )
        Text(text, style = base.copy(color = outline, drawStyle = Stroke(px * 0.22f, join = StrokeJoin.Round)))
        Text(text, style = base.copy(color = Color.White, drawStyle = Stroke(px * 0.07f, join = StrokeJoin.Round)))
        Text(text, style = base.copy(color = fill))
    }
}

/** "Squishy Crush" with every letter wobbling like jelly. */
@Composable
fun SquishTitle(modifier: Modifier = Modifier, size: TextUnit = 46.sp) {
    val wobble = rememberInfiniteTransition(label = "title")
    val t by wobble.animateFloat(0f, 2f * PI.toFloat(), infiniteRepeatable(tween(2400, easing = LinearEasing)), label = "t")
    Column(modifier, horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy((-14).dp)) {
        var i = 0
        listOf("Squishy", "Crush").forEach { word ->
            Row {
                word.forEach { ch ->
                    val k = i++
                    BubblyText(
                        ch.toString(),
                        if (word == "Crush") size * 1.15f else size,
                        titleColors[k % titleColors.size],
                        Modifier.graphicsLayer {
                            val ph = t + k * 0.7f
                            rotationZ = sin(ph) * 7f
                            translationY = sin(ph * 1f + 1f) * 5.dp.toPx()
                            scaleX = 1f + sin(ph * 2f) * 0.06f
                            scaleY = 1f - sin(ph * 2f) * 0.06f
                        },
                    )
                }
            }
        }
    }
}

/** A puffy pill button with a glossy top and a darker "lip" underneath. */
@Composable
internal fun PillButton(
    label: String,
    color: Color = Bubblegum,
    modifier: Modifier = Modifier,
    width: Dp = 240.dp,
    onClick: () -> Unit,
) {
    Box(
        modifier = modifier
            .width(width)
            .height(60.dp)
            .shadow(6.dp, RoundedCornerShape(30.dp))
            .background(color.darken(0.25f), RoundedCornerShape(30.dp))
            .padding(bottom = 5.dp)
            .background(
                Brush.verticalGradient(listOf(color.lighten(0.35f), color, color)),
                RoundedCornerShape(30.dp),
            )
            .border(2.dp, Color.White.copy(alpha = 0.7f), RoundedCornerShape(30.dp))
            .clickable(onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        BubblyText(label, 24.sp, Color.White, outline = color.darken(0.45f))
    }
}

/** A round icon button (sound, music, pause). */
@Composable
internal fun RoundIconButton(
    modifier: Modifier = Modifier,
    color: Color = Color.White,
    onClick: () -> Unit,
    icon: DrawScope.() -> Unit,
) {
    Box(
        modifier = modifier
            .size(48.dp)
            .shadow(4.dp, CircleShape)
            .background(Brush.verticalGradient(listOf(Color.White, color)), CircleShape)
            .border(2.dp, Color.White, CircleShape)
            .clickable(onClick = onClick),
    ) {
        Canvas(Modifier.fillMaxSize().padding(11.dp)) { icon() }
    }
}

/** White rounded card used for intro, pause, win and lose. */
@Composable
internal fun SquishCard(modifier: Modifier = Modifier, content: @Composable ColumnScope.() -> Unit) {
    Column(
        modifier = modifier
            .padding(20.dp)
            .shadow(16.dp, RoundedCornerShape(32.dp))
            .background(Brush.verticalGradient(listOf(CardWhite, Color(0xFFFFE3F1))), RoundedCornerShape(32.dp))
            .border(4.dp, Color(0xFFFFB3D6), RoundedCornerShape(32.dp))
            .padding(horizontal = 24.dp, vertical = 22.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(14.dp),
        content = content,
    )
}

/** Sound and music on/off buttons; keeps [progress] and [audio] in sync. */
@Composable
internal fun SoundToggles(progress: Progress, audio: GameAudio) {
    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        val soundOn = progress.soundOn
        val musicOn = progress.musicOn
        RoundIconButton(color = if (soundOn) Color(0xFFBFE9FF) else Color(0xFFDDDDDD), onClick = {
            progress.updateSound(!soundOn)
            audio.soundOn = !soundOn
            audio.click()
        }) { drawSpeaker(soundOn) }
        RoundIconButton(color = if (musicOn) Color(0xFFFFD6EC) else Color(0xFFDDDDDD), onClick = {
            progress.updateMusic(!musicOn)
            audio.musicOn = !musicOn
            audio.click()
        }) { drawNote(musicOn) }
    }
}

private fun DrawScope.drawSpeaker(on: Boolean) {
    val w = size.width
    val h = size.height
    val body = Path().apply {
        moveTo(w * 0.08f, h * 0.36f); lineTo(w * 0.3f, h * 0.36f); lineTo(w * 0.56f, h * 0.12f)
        lineTo(w * 0.56f, h * 0.88f); lineTo(w * 0.3f, h * 0.64f); lineTo(w * 0.08f, h * 0.64f); close()
    }
    drawPath(body, Ink)
    if (on) {
        drawArc(Ink, -45f, 90f, false, Offset(w * 0.42f, h * 0.3f), Size(w * 0.4f, h * 0.4f), style = Stroke(w * 0.09f, cap = StrokeCap.Round))
        drawArc(Ink, -50f, 100f, false, Offset(w * 0.3f, h * 0.1f), Size(w * 0.72f, h * 0.8f), style = Stroke(w * 0.09f, cap = StrokeCap.Round))
    } else {
        drawOffSlash()
    }
}

private fun DrawScope.drawNote(on: Boolean) {
    val w = size.width
    val h = size.height
    drawOval(Ink, Offset(w * 0.06f, h * 0.68f), Size(w * 0.34f, h * 0.26f))
    drawOval(Ink, Offset(w * 0.56f, h * 0.58f), Size(w * 0.34f, h * 0.26f))
    drawLine(Ink, Offset(w * 0.37f, h * 0.8f), Offset(w * 0.37f, h * 0.14f), w * 0.09f)
    drawLine(Ink, Offset(w * 0.87f, h * 0.7f), Offset(w * 0.87f, h * 0.04f), w * 0.09f)
    drawLine(Ink, Offset(w * 0.37f, h * 0.14f), Offset(w * 0.87f, h * 0.04f), w * 0.16f)
    if (!on) drawOffSlash()
}

private fun DrawScope.drawOffSlash() {
    drawLine(Color.White, Offset(0f, size.height), Offset(size.width, 0f), size.width * 0.2f, cap = StrokeCap.Round)
    drawLine(Color(0xFFE53950), Offset(0f, size.height), Offset(size.width, 0f), size.width * 0.11f, cap = StrokeCap.Round)
}

internal fun Color.lighten(f: Float) = Color(red + (1f - red) * f, green + (1f - green) * f, blue + (1f - blue) * f, alpha)
internal fun Color.darken(f: Float) = Color(red * (1f - f), green * (1f - f), blue * (1f - f), alpha)

/** 5000 -> "5.000" (Danish thousands separator). */
internal fun fmt(n: Int): String {
    val s = kotlin.math.abs(n).toString()
    val sb = StringBuilder()
    s.forEachIndexed { i, ch ->
        if (i > 0 && (s.length - i) % 3 == 0) sb.append('.')
        sb.append(ch)
    }
    return if (n < 0) "-$sb" else sb.toString()
}

private val levelSpacing = 108.dp
private val bubbleSize = 74.dp

/** The level map: a winding candy path from level 1 at the bottom upwards, decorated with squishies. */
@Composable
fun MenuScreen(levels: List<Level>, progress: Progress, audio: GameAudio, onPlay: (Level) -> Unit) {
    val clock = rememberClock()
    val scroll = rememberScrollState()
    val unlocked = progress.unlocked
    val n = levels.size

    Box(Modifier.fillMaxSize().background(Color(0xFFFFE6F2))) {
        Canvas(Modifier.fillMaxSize()) { drawBackdrop(clock.value) }

        Column(Modifier.fillMaxSize().systemBarsPadding()) {
            Row(Modifier.fillMaxWidth().padding(top = 8.dp, start = 12.dp, end = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                StarTotal(progress.totalStars, n * 3, Modifier)
                Spacer(Modifier.weight(1f))
                SoundToggles(progress, audio)
            }
            SquishTitle(Modifier.align(Alignment.CenterHorizontally).padding(bottom = 4.dp), size = 44.sp)

            BoxWithConstraints(Modifier.fillMaxWidth().weight(1f)) {
                val viewH = constraints.maxHeight
                val density = LocalDensity.current
                val spacingPx = with(density) { levelSpacing.toPx() }
                val padTop = with(density) { 70.dp.toPx() }
                val padBottom = with(density) { 90.dp.toPx() }
                val widthPx = constraints.maxWidth.toFloat()
                val totalH = padTop + padBottom + (n - 1) * spacingPx
                fun center(i: Int) = Offset(
                    widthPx * (0.5f + 0.27f * sin(i * 0.85f)),
                    padTop + (n - 1 - i) * spacingPx,
                )

                // Start with the newest unlocked level in view.
                LaunchedEffect(Unit) {
                    snapshotFlow { scroll.maxValue }.first { it > 0 && it < Int.MAX_VALUE }
                    val target = center((unlocked - 1).coerceIn(0, n - 1)).y - viewH * 0.55f
                    scroll.scrollTo(target.roundToInt().coerceIn(0, scroll.maxValue))
                }

                Box(Modifier.fillMaxWidth().verticalScroll(scroll)) {
                    Box(Modifier.fillMaxWidth().height(with(density) { totalH.toDp() })) {
                        Canvas(Modifier.fillMaxSize()) {
                            drawCandyPath(n, ::center, unlocked)
                            drawDecorations(n, ::center, clock.value)
                        }
                        val half = with(density) { (bubbleSize / 2).toPx() }
                        levels.forEachIndexed { i, level ->
                            val c = center(i)
                            LevelBubble(
                                level = level,
                                stars = progress.stars(level.number),
                                locked = level.number > unlocked,
                                current = level.number == unlocked,
                                colorIndex = i,
                                modifier = Modifier.offset { IntOffset((c.x - half).roundToInt(), (c.y - half).roundToInt()) },
                                onClick = {
                                    if (level.number <= unlocked) {
                                        audio.click()
                                        onPlay(level)
                                    } else {
                                        audio.invalid()
                                    }
                                },
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun StarTotal(stars: Int, max: Int, modifier: Modifier) {
    Row(
        modifier
            .shadow(3.dp, RoundedCornerShape(20.dp))
            .background(Color.White.copy(alpha = 0.9f), RoundedCornerShape(20.dp))
            .padding(horizontal = 10.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Canvas(Modifier.size(22.dp)) { drawStar(center, size.minDimension / 2f, on = true) }
        Spacer(Modifier.width(4.dp))
        Text("$stars/$max", color = Ink, fontWeight = FontWeight.Black, fontSize = 16.sp)
    }
}

private fun DrawScope.drawCandyPath(n: Int, center: (Int) -> Offset, unlocked: Int) {
    if (n < 2) return
    fun pathFor(from: Int, to: Int) = Path().apply {
        val p0 = center(from)
        moveTo(p0.x, p0.y)
        for (i in from + 1..to) {
            val a = center(i - 1)
            val b = center(i)
            val midY = (a.y + b.y) / 2f
            cubicTo(a.x, midY, b.x, midY, b.x, b.y)
        }
    }
    val all = pathFor(0, n - 1)
    val w = 30.dp.toPx()
    drawPath(all, Color(0x33000000), style = Stroke(w + 10.dp.toPx(), cap = StrokeCap.Round, join = StrokeJoin.Round))
    drawPath(all, Color.White, style = Stroke(w + 6.dp.toPx(), cap = StrokeCap.Round, join = StrokeJoin.Round))
    drawPath(all, Color(0xFFF3D9E8), style = Stroke(w, cap = StrokeCap.Round, join = StrokeJoin.Round))
    // The part already travelled is a pink candy stripe.
    val done = (unlocked - 1).coerceIn(0, n - 1)
    if (done > 0) {
        val walked = pathFor(0, done)
        drawPath(walked, Color(0xFFFF9CCB), style = Stroke(w, cap = StrokeCap.Round, join = StrokeJoin.Round))
        drawPath(
            walked, Color.White.copy(alpha = 0.85f),
            style = Stroke(w * 0.45f, cap = StrokeCap.Butt, pathEffect = PathEffect.dashPathEffect(floatArrayOf(w * 0.5f, w * 0.7f))),
        )
    }
    drawPath(
        all, Color.White.copy(alpha = 0.5f),
        style = Stroke(4.dp.toPx(), cap = StrokeCap.Round, pathEffect = PathEffect.dashPathEffect(floatArrayOf(2f, 18.dp.toPx()))),
    )
}

private fun DrawScope.drawDecorations(n: Int, center: (Int) -> Offset, time: Float) {
    val cell = 52.dp.toPx()
    val kinds = Kind.entries
    for (i in 0 until n step 2) {
        val c = center(i)
        // Put the toy on the side of the path with the most room.
        val side = if (c.x > size.width / 2f) -1f else 1f
        val x = (c.x + side * size.width * 0.3f).coerceIn(cell * 0.6f, size.width - cell * 0.6f)
        val y = c.y + 34.dp.toPx() * if (i % 4 == 0) 1f else -1f
        val kind = kinds[(i / 2) % kinds.size]
        drawOval(Color(0x22000000), Offset(x - cell * 0.32f, y + cell * 0.3f), Size(cell * 0.64f, cell * 0.16f))
        drawSquishy(Piece(-1000L - i, kind), Offset(x, y), cell, squash = sin(time * 2.2f + i) * 0.06f, time = time)
    }
}

@Composable
private fun LevelBubble(
    level: Level,
    stars: Int,
    locked: Boolean,
    current: Boolean,
    colorIndex: Int,
    modifier: Modifier,
    onClick: () -> Unit,
) {
    val base = if (locked) Color(0xFFC9C3CC) else bubbleColors[colorIndex % bubbleColors.size]
    val pulse = if (current) {
        val tr = rememberInfiniteTransition(label = "pulse")
        tr.animateFloat(0f, 1f, infiniteRepeatable(tween(900), RepeatMode.Reverse), label = "p")
    } else null
    Box(
        modifier
            .size(bubbleSize)
            .graphicsLayer {
                val p = pulse?.value ?: 0f
                scaleX = 1f + p * 0.12f
                scaleY = 1f + p * 0.07f
                translationY = -p * 4.dp.toPx()
            }
            .clickable(onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        Canvas(Modifier.fillMaxSize()) {
            val r = size.minDimension / 2f
            if (current) drawCircle(Color.White.copy(alpha = 0.55f), r * 1.18f)
            drawCircle(Color(0x33000000), r * 0.95f, center + Offset(0f, r * 0.12f))
            drawCircle(base.darken(0.3f), r * 0.95f)
            drawCircle(
                Brush.radialGradient(listOf(base.lighten(0.45f), base, base.darken(0.08f)), center + Offset(-r * 0.3f, -r * 0.35f), r * 1.2f),
                r * 0.86f,
            )
            drawCircle(Color.White, r * 0.92f, style = Stroke(r * 0.08f))
            drawOval(Color.White.copy(alpha = 0.6f), Offset(center.x - r * 0.48f, center.y - r * 0.7f), Size(r * 0.55f, r * 0.3f))
            if (locked) drawLock(center + Offset(0f, r * 0.05f), r * 0.42f)
            if (!locked) {
                for (s in 0 until 3) {
                    val a = (-90f + (s - 1) * 32f) * PI.toFloat() / 180f
                    val sc = Offset(center.x + kotlin.math.cos(a) * r * 1.0f, center.y + sin(a) * r * 1.0f - r * 0.02f)
                    drawStar(sc, r * if (s == 1) 0.3f else 0.25f, on = s < stars)
                }
            }
        }
        if (!locked) BubblyText("${level.number}", 26.sp, Color.White, outline = base.darken(0.5f))
    }
}

private fun DrawScope.drawLock(c: Offset, s: Float) {
    drawArc(
        Color(0xFF7A6E80), 180f, 180f, false, Offset(c.x - s * 0.55f, c.y - s * 1.05f), Size(s * 1.1f, s * 1.1f),
        style = Stroke(s * 0.24f),
    )
    drawLine(Color(0xFF7A6E80), Offset(c.x - s * 0.55f, c.y - s * 0.5f), Offset(c.x - s * 0.55f, c.y - s * 0.1f), s * 0.24f)
    drawLine(Color(0xFF7A6E80), Offset(c.x + s * 0.55f, c.y - s * 0.5f), Offset(c.x + s * 0.55f, c.y - s * 0.1f), s * 0.24f)
    drawRoundRect(Color(0xFF7A6E80), Offset(c.x - s * 0.85f, c.y - s * 0.15f), Size(s * 1.7f, s * 1.2f), CornerRadius(s * 0.25f))
    drawCircle(Color(0xFFC9C3CC), s * 0.17f, c + Offset(0f, s * 0.38f))
}
