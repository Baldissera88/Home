package com.baldissera.squish

import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.BlendMode
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.text.TextMeasurer
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.sp
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.sin
import kotlin.random.Random

/**
 * Board effects: particles, floating score texts, special-piece beams, shockwave rings and screen shake.
 * Everything lives in plain lists (not Compose state); [update] runs once per frame and the board Canvas
 * calls [draw] from its draw lambda, so effects never cause recomposition.
 * All coordinates are in board pixels (origin = board top-left).
 */
class Fx {
    private class Particle(
        var x: Float, var y: Float, var vx: Float, var vy: Float,
        val color: Color, val size: Float, val life: Float, val shape: Int, var spin: Float,
    ) {
        var age = 0f
    }

    private class FloatText(val text: String, val x: Float, var y: Float, val color: Color, val big: Boolean) {
        var age = 0f
    }

    private class Beam(val from: Offset, val to: Offset, val color: Color, val width: Float, val life: Float) {
        var age = 0f
    }

    private class Ring(val center: Offset, val maxRadius: Float, val color: Color, val life: Float) {
        var age = 0f
    }

    private val particles = ArrayList<Particle>(MAX_PARTICLES)
    private val texts = ArrayList<FloatText>()
    private val beams = ArrayList<Beam>()
    private val rings = ArrayList<Ring>()
    private var shake = 0f
    private var shakeTime = 0f
    private val rnd = Random(7)

    /** Size of one board cell in pixels, used to scale gravity and particle speed. */
    var cell = 60f

    val busy: Boolean get() = particles.isNotEmpty() || texts.isNotEmpty() || beams.isNotEmpty() || rings.isNotEmpty()

    fun update(dt: Float) {
        val g = cell * 16f
        var i = particles.size - 1
        while (i >= 0) {
            val p = particles[i]
            p.age += dt
            if (p.age >= p.life) {
                particles.removeAt(i)
            } else {
                p.vy += g * dt
                p.vx *= 1f - 1.5f * dt
                p.x += p.vx * dt
                p.y += p.vy * dt
                p.spin += dt * 6f
            }
            i--
        }
        texts.removeAll { it.age += dt; it.age > TEXT_LIFE }
        beams.removeAll { it.age += dt; it.age > it.life }
        rings.removeAll { it.age += dt; it.age > it.life }
        shakeTime += dt
        shake = (shake - dt * cell * 1.6f).coerceAtLeast(0f)
    }

    /** Current screen-shake translation. */
    fun shakeOffset(): Offset =
        if (shake <= 0f) Offset.Zero
        else Offset(sin(shakeTime * 71f) * shake, cos(shakeTime * 53f) * shake * 0.7f)

    fun shake(amount: Float) {
        shake = maxOf(shake, amount)
    }

    private fun add(p: Particle) {
        if (particles.size >= MAX_PARTICLES) particles.removeAt(0)
        particles += p
    }

    /** A juicy splat of goo droplets and a few sparkles in [color]. */
    fun burst(center: Offset, color: Color, count: Int = 10) {
        repeat(count) {
            val a = rnd.nextFloat() * 2f * PI.toFloat()
            val speed = cell * (1.8f + rnd.nextFloat() * 4.5f)
            add(
                Particle(
                    center.x, center.y, cos(a) * speed, sin(a) * speed - cell * 3f,
                    if (it % 4 == 3) Color.White else color,
                    cell * (0.05f + rnd.nextFloat() * 0.09f),
                    0.45f + rnd.nextFloat() * 0.45f,
                    if (it % 4 == 3) SHAPE_STAR else SHAPE_BLOB,
                    rnd.nextFloat() * 6f,
                )
            )
        }
    }

    /** Twinkling stars, e.g. where a special piece was just formed. */
    fun sparkle(center: Offset, color: Color = Color.White, count: Int = 12) {
        repeat(count) {
            val a = it * 2f * PI.toFloat() / count + rnd.nextFloat() * 0.4f
            val speed = cell * (1.2f + rnd.nextFloat() * 2.2f)
            add(
                Particle(
                    center.x, center.y, cos(a) * speed, sin(a) * speed - cell * 1.5f,
                    if (it % 2 == 0) Color.White else color,
                    cell * (0.07f + rnd.nextFloat() * 0.07f),
                    0.6f + rnd.nextFloat() * 0.3f,
                    SHAPE_STAR,
                    rnd.nextFloat() * 6f,
                )
            )
        }
    }

    fun text(text: String, center: Offset, color: Color, big: Boolean = false) {
        if (texts.size > 12) texts.removeAt(0)
        texts += FloatText(text, center.x, center.y, color, big)
    }

    fun beam(from: Offset, to: Offset, color: Color, width: Float = cell * 0.55f, life: Float = 0.45f) {
        beams += Beam(from, to, color, width, life)
    }

    fun ring(center: Offset, maxRadius: Float, color: Color, life: Float = 0.5f) {
        rings += Ring(center, maxRadius, color, life)
    }

    fun clear() {
        particles.clear(); texts.clear(); beams.clear(); rings.clear(); shake = 0f
    }

    fun draw(scope: DrawScope, measurer: TextMeasurer) = with(scope) {
        for (b in beams) {
            val t = b.age / b.life
            val fade = 1f - t
            // Beam grows from the special out to the edge quickly, then fades and thins.
            val reach = (t * 4f).coerceAtMost(1f)
            val end = b.from + (b.to - b.from) * reach
            val w = b.width * (1f - t * 0.6f)
            drawLine(b.color.copy(alpha = 0.35f * fade), b.from, end, strokeWidth = w * 1.8f, cap = StrokeCap.Round)
            drawLine(b.color.copy(alpha = 0.85f * fade), b.from, end, strokeWidth = w, cap = StrokeCap.Round)
            drawLine(Color.White.copy(alpha = fade), b.from, end, strokeWidth = w * 0.35f, cap = StrokeCap.Round)
        }
        for (r in rings) {
            val t = r.age / r.life
            val radius = r.maxRadius * (1f - (1f - t) * (1f - t))
            val fade = 1f - t
            drawCircle(r.color.copy(alpha = 0.25f * fade), radius, r.center)
            drawCircle(r.color.copy(alpha = 0.9f * fade), radius, r.center, style = Stroke(cell * 0.22f * fade + 2f))
            drawCircle(Color.White.copy(alpha = 0.8f * fade), radius * 0.92f, r.center, style = Stroke(cell * 0.06f * fade + 1f))
        }
        for (p in particles) {
            val fade = (1f - p.age / p.life).coerceIn(0f, 1f)
            val c = Offset(p.x, p.y)
            if (p.shape == SHAPE_STAR) {
                rotate(p.spin * 30f, c) { drawPath(starPath(c, p.size * 1.6f), p.color.copy(alpha = fade)) }
            } else {
                val r = p.size * (0.6f + 0.4f * fade)
                drawCircle(p.color.copy(alpha = fade), r, c)
                drawCircle(Color.White.copy(alpha = 0.55f * fade), r * 0.35f, c + Offset(-r * 0.3f, -r * 0.3f))
            }
        }
        for (t in texts) {
            val k = t.age / TEXT_LIFE
            val rise = cell * 1.1f * (1f - (1f - k) * (1f - k))
            val pop = if (k < 0.15f) 0.6f + k / 0.15f * 0.5f else 1.1f - (k - 0.15f) * 0.15f
            val fade = if (k < 0.7f) 1f else 1f - (k - 0.7f) / 0.3f
            val fs = (cell * (if (t.big) 0.72f else 0.5f) * pop).coerceAtLeast(6f)
            val style = TextStyle(
                fontSize = (fs / density).sp,
                fontWeight = FontWeight.Black,
                textAlign = TextAlign.Center,
            )
            val layout = measurer.measure(t.text, style)
            val topLeft = Offset(t.x - layout.size.width / 2f, t.y - rise - layout.size.height / 2f)
            // Outline: draw the text a few times offset in a dark colour, then the fill.
            val o = fs * 0.07f
            for ((dx, dy) in OUTLINE) {
                drawText(layout, color = Color(0xFF5A1E5C).copy(alpha = fade), topLeft = topLeft + Offset(dx * o, dy * o))
            }
            drawText(layout, color = t.color.copy(alpha = fade), topLeft = topLeft)
        }
    }

    companion object {
        const val MAX_PARTICLES = 300
        private const val TEXT_LIFE = 0.9f
        private const val SHAPE_BLOB = 0
        private const val SHAPE_STAR = 1
        private val OUTLINE = listOf(-1f to 0f, 1f to 0f, 0f to -1f, 0f to 1.4f, -0.7f to 0.9f, 0.7f to 0.9f)

        /** A four-pointed twinkle star. */
        fun starPath(c: Offset, r: Float): Path = Path().apply {
            val inner = r * 0.32f
            for (i in 0 until 8) {
                val a = i * PI.toFloat() / 4f - PI.toFloat() / 2f
                val rr = if (i % 2 == 0) r else inner
                val x = c.x + cos(a) * rr
                val y = c.y + sin(a) * rr
                if (i == 0) moveTo(x, y) else lineTo(x, y)
            }
            close()
        }

        /** A five-pointed star, for the HUD and win card. */
        fun star5Path(c: Offset, r: Float): Path = Path().apply {
            val inner = r * 0.48f
            for (i in 0 until 10) {
                val a = i * PI.toFloat() / 5f - PI.toFloat() / 2f
                val rr = if (i % 2 == 0) r else inner
                val x = c.x + cos(a) * rr
                val y = c.y + sin(a) * rr
                if (i == 0) moveTo(x, y) else lineTo(x, y)
            }
            close()
        }
    }
}

/** A glossy five-pointed star (filled gold, or a dim socket when [on] is false). */
fun DrawScope.drawStar(center: Offset, radius: Float, on: Boolean, alpha: Float = 1f) {
    val path = Fx.star5Path(center, radius)
    if (on) {
        drawPath(Fx.star5Path(center + Offset(0f, radius * 0.12f), radius), Color(0xFFC77800).copy(alpha = alpha))
        drawPath(
            path,
            Brush.verticalGradient(
                listOf(Color(0xFFFFF59D), Color(0xFFFFC107), Color(0xFFFF9800)),
                startY = center.y - radius, endY = center.y + radius,
            ),
            alpha = alpha,
        )
        drawPath(path, Color.White.copy(alpha = 0.9f * alpha), style = Stroke(radius * 0.1f))
        drawCircle(Color.White.copy(alpha = 0.7f * alpha), radius * 0.14f, center + Offset(-radius * 0.25f, -radius * 0.25f))
    } else {
        drawPath(path, Color(0x33000000).copy(alpha = 0.2f * alpha), blendMode = BlendMode.SrcOver)
        drawPath(path, Color.White.copy(alpha = 0.6f * alpha), style = Stroke(radius * 0.1f))
    }
}
