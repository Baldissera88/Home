package com.baldissera.squish

import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Paint
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathOperation
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.clipPath
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.graphics.drawscope.translate
import androidx.compose.ui.graphics.drawscope.withTransform
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.floor
import kotlin.math.min
import kotlin.math.pow
import kotlin.math.sign
import kotlin.math.sin

/*
 * Piece art for Squishy Crush. Everything is drawn with plain DrawScope primitives.
 *
 * Performance: every static Path and Brush lives in a per-kind [Style] built once, in a normalised
 * "unit" space (the piece spans roughly -1..1). Each frame only applies translate/scale transforms,
 * so drawing 81 pieces allocates no Paths and no gradient shaders (ShaderBrush caches its shader
 * because the canvas size does not change between frames).
 */

// ---------------------------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------------------------

/** Main colour of each toy (particles, HUD). */
val Kind.color: Color
    get() = when (this) {
        Kind.NEEDOH -> Color(0xFFFF4FB0)
        Kind.PLUSH -> Color(0xFFFFA04F)
        Kind.SLIME -> Color(0xFF7FDB2E)
        Kind.POPIT -> Color(0xFF45B4F5)
        Kind.MOCHI -> Color(0xFFB98CF2)
        Kind.LABUBU -> Color(0xFFFFC93C)
    }

/** Draws one piece centred at [center] inside a cell of side [cell] px. */
fun DrawScope.drawSquishy(
    piece: Piece,
    center: Offset,
    cell: Float,
    squash: Float = 0f,
    time: Float = 0f,
    alpha: Float = 1f,
    selected: Boolean = false,
) {
    if (alpha <= 0.003f || cell <= 0f) return
    val a = alpha.coerceIn(0f, 1f)
    val layered = a < 0.999f
    if (layered) {
        val half = cell * 0.75f
        drawContext.canvas.saveLayer(
            Rect(center.x - half, center.y - half, center.x + half, center.y + half),
            Paint().apply { this.alpha = a },
        )
    }
    val st = style(piece.kind)
    val r = cell * PIECE_RADIUS
    val ph = phase(piece.id)
    val sq = squash.coerceIn(-0.6f, 0.8f)

    // Idle breathing: area preserving, slightly different tempo per piece.
    val breath = 0.022f * sin(time * (2.0f + 0.35f * frac(ph * 3.1f)) + ph * 6.283f)
    val sx = (1f + sq) * (1f + breath)
    val sy = 1f / ((1f + sq) * (1f + breath))
    val pulse = if (selected) 1.07f + 0.035f * sin(time * 7.5f) else 1f
    val wobble = if (selected) 3.5f * sin(time * 9f) else 1.2f * sin(time * 1.3f + ph * 11f)
    val bottom = 0.97f // unit y of the piece's foot (squash anchor)

    withTransform({
        translate(center.x, center.y)
        scale(r, r, Offset.Zero)
    }) {
        // Soft drop shadow (only widens with squash, it stays on the floor).
        withTransform({ scale(sx * pulse, 1f, Offset(0f, bottom)) }) {
            drawOval(SHADOW_BRUSH, topLeft = Offset(-0.86f, bottom - 0.16f), size = Size(1.72f, 0.36f))
        }
        withTransform({
            scale(pulse, pulse, Offset.Zero)
            scale(sx, sy, Offset(0f, bottom))
            rotate(wobble, Offset(0f, bottom))
        }) {
            if (piece.special == Special.BOMB) drawBombGlow(time, ph)
            if (piece.special == Special.RAINBOW) {
                drawDiscoBall(time, ph, selected)
            } else {
                drawBody(st, piece, time, ph, selected)
            }
        }
    }
    if (layered) drawContext.canvas.restore()
}

/** Small, static version of a toy for the goal HUD. [size] is the icon's side in px. */
fun DrawScope.drawKindIcon(kind: Kind, center: Offset, size: Float) {
    drawSquishy(Piece(-1L, kind), center, size, time = 0f)
}

/** Soft rounded pastel board tile. */
fun DrawScope.drawCellTile(topLeft: Offset, cell: Float, dark: Boolean) {
    withTransform({
        translate(topLeft.x, topLeft.y)
        scale(cell, cell, Offset.Zero)
    }) {
        drawRoundRect(
            if (dark) TILE_DARK else TILE_LIGHT,
            topLeft = Offset(0.035f, 0.035f), size = Size(0.93f, 0.93f),
            cornerRadius = androidx.compose.ui.geometry.CornerRadius(0.2f, 0.2f),
        )
        drawRoundRect(
            Color.White.copy(alpha = if (dark) 0.22f else 0.38f),
            topLeft = Offset(0.035f, 0.035f), size = Size(0.93f, 0.93f),
            cornerRadius = androidx.compose.ui.geometry.CornerRadius(0.2f, 0.2f),
            style = TILE_RIM,
        )
    }
}

/** Pink glitter goo puddle under a piece. 2 layers is thicker and darker than 1. */
fun DrawScope.drawGoo(topLeft: Offset, cell: Float, layers: Int, time: Float) {
    if (layers <= 0) return
    val thick = layers >= 2
    val seed = frac(sin(topLeft.x * 0.0131f + topLeft.y * 0.0173f) * 4375.85f)
    withTransform({
        translate(topLeft.x + cell * 0.5f, topLeft.y + cell * 0.5f)
        scale(cell * 0.5f, cell * 0.5f, Offset.Zero)
    }) {
        val wob = 1f + 0.025f * sin(time * 1.6f + seed * 6.28f)
        withTransform({ scale(wob, 2f - wob, Offset.Zero) }) {
            if (thick) {
                drawPath(GOO_PATH, GOO2_EDGE_BRUSH)
                withTransform({ scale(0.9f, 0.9f, Offset(0f, -0.06f)) }) {
                    drawPath(GOO_PATH, GOO2_BRUSH)
                }
                drawPath(GOO_PATH, GOO2_RIM, style = GOO_STROKE_THICK)
            } else {
                drawPath(GOO_PATH, GOO1_BRUSH)
                drawPath(GOO_PATH, GOO1_RIM, style = GOO_STROKE)
            }
            // Slow shimmer: a glossy streak that slides around the rim.
            val sa = time * 0.6f + seed * 6.28f
            val gx = cos(sa) * 0.55f
            val gy = sin(sa) * 0.55f
            drawCircle(Color.White.copy(alpha = if (thick) 0.42f else 0.35f), 0.11f, Offset(gx, gy))
            drawCircle(Color.White.copy(alpha = 0.55f), 0.045f, Offset(-0.58f, -0.62f))
            // Glitter specks.
            for (i in GLITTER.indices) {
                val g = GLITTER[i]
                val tw = 0.5f + 0.5f * sin(time * 3.1f + i * 1.7f + seed * 20f)
                val c = if (i % 3 == 0) GOLD else Color.White
                drawCircle(c.copy(alpha = 0.35f + 0.6f * tw), g.z * (0.6f + 0.5f * tw), Offset(g.x, g.y))
            }
            if (thick) {
                val tw = 0.5f + 0.5f * sin(time * 2.3f + seed * 9f)
                drawSparkle(Offset(0.62f, 0.58f), 0.16f + 0.06f * tw, Color.White.copy(alpha = 0.5f + 0.5f * tw))
            }
        }
    }
}

/** Bubble-wrap blocker covering the whole cell; [hp] 2 is a doubled, thicker sheet. */
fun DrawScope.drawWrap(topLeft: Offset, cell: Float, hp: Int, time: Float) {
    if (hp <= 0) return
    val thick = hp >= 2
    val seed = frac(sin(topLeft.x * 0.0191f + topLeft.y * 0.0117f) * 3758.5f)
    withTransform({
        translate(topLeft.x, topLeft.y)
        scale(cell, cell, Offset.Zero)
    }) {
        val cr = androidx.compose.ui.geometry.CornerRadius(0.16f, 0.16f)
        if (thick) {
            // Second sheet peeking out, slightly rotated.
            rotate(-5f, Offset(0.5f, 0.5f)) {
                drawRoundRect(WRAP2_BACK, Offset(0.04f, 0.04f), Size(0.92f, 0.92f), cr)
                drawRoundRect(WRAP_EDGE2, Offset(0.04f, 0.04f), Size(0.92f, 0.92f), cr, style = WRAP_STROKE)
            }
        }
        drawRoundRect(if (thick) WRAP2_BRUSH else WRAP1_BRUSH, Offset(0.03f, 0.03f), Size(0.94f, 0.94f), cr)
        drawRoundRect(if (thick) WRAP_EDGE2 else WRAP_EDGE1, Offset(0.03f, 0.03f), Size(0.94f, 0.94f), cr,
            style = if (thick) WRAP_STROKE_THICK else WRAP_STROKE)
        // 3x3 bubbles.
        for (row in 0 until 3) for (col in 0 until 3) {
            val c = Offset(0.2f + col * 0.3f, 0.2f + row * 0.3f)
            translate(c.x, c.y) {
                drawCircle(if (thick) BUBBLE2_BRUSH else BUBBLE1_BRUSH, 0.125f, Offset.Zero)
                drawCircle(if (thick) WRAP_EDGE2 else BUBBLE_RIM, 0.125f, Offset.Zero,
                    style = if (thick) BUBBLE_STROKE_THICK else BUBBLE_STROKE)
                val tw = 0.75f + 0.25f * sin(time * 2.2f + (row * 3 + col) * 1.3f + seed * 9f)
                drawOval(Color.White.copy(alpha = 0.95f * tw), Offset(-0.075f, -0.085f), Size(0.07f, 0.05f))
            }
        }
        // Sheet gloss.
        drawRoundRect(WRAP_GLOSS, Offset(0.08f, 0.06f), Size(0.84f, 0.2f),
            androidx.compose.ui.geometry.CornerRadius(0.1f, 0.1f))
    }
}

/** Whole-canvas pastel toy-shop sky with drifting bokeh bubbles and sparkles. */
fun DrawScope.drawBackdrop(time: Float) {
    val w = size.width
    val h = size.height
    if (w <= 0f || h <= 0f) return
    drawRect(backdropBrush(h))
    val unit = min(w, h)
    // Drifting bokeh bubbles.
    for (i in 0 until BOKEH_N) {
        val k = i.toFloat()
        val speed = 0.015f + 0.025f * frac(k * 0.731f)
        val rad = unit * (0.02f + 0.05f * frac(k * 0.377f + 0.2f))
        val travel = h + rad * 4f
        val y = h + rad * 2f - frac(time * speed + k * 0.618f) * travel
        val x = w * frac(k * 0.4142f + 0.1f) + unit * 0.03f * sin(time * 0.5f + k * 1.9f)
        val tint = BOKEH_TINTS[i % BOKEH_TINTS.size]
        drawCircle(tint.copy(alpha = 0.16f), rad, Offset(x, y))
        drawCircle(Color.White.copy(alpha = 0.22f), rad, Offset(x, y), style = Stroke(width = rad * 0.12f))
        drawCircle(Color.White.copy(alpha = 0.35f), rad * 0.22f, Offset(x - rad * 0.4f, y - rad * 0.42f))
    }
    // Twinkling sparkles.
    for (i in 0 until SPARK_N) {
        val k = i.toFloat()
        val x = w * frac(k * 0.2718f + 0.05f)
        val y = h * frac(k * 0.5772f + 0.13f)
        val tw = sin(time * (1.1f + 0.5f * frac(k * 0.31f)) + k * 2.4f)
        if (tw > 0f) {
            val s = unit * (0.012f + 0.016f * frac(k * 0.83f)) * (0.4f + 0.6f * tw)
            drawSparkleAbs(Offset(x, y), s, Color.White.copy(alpha = 0.85f * tw))
        }
    }
}

// ---------------------------------------------------------------------------------------------
// Piece body
// ---------------------------------------------------------------------------------------------

private const val PIECE_RADIUS = 0.43f

private val FACE = Color(0xFF3A1D3C)
private val GOLD = Color(0xFFFFE27A)
private val CHEEK = Color(0xFFFF6F9A)

private enum class Mouth { SMILE, CAT, OPEN, TONGUE, GRIN }

private class Style(
    val shape: Path,
    val body: Brush,
    val rimBrush: Brush,
    val outline: Color,
    val faceY: Float,
    val eyeDx: Float,
    val eyeR: Float,
    val mouthY: Float,
    val mouth: Mouth,
    val cheekDx: Float,
    val cheekY: Float,
    val gloss: Rect,
    val glossBrush: Brush,
    val topY: Float,
)

private val STYLES = HashMap<Kind, Style>()
private fun style(kind: Kind): Style = STYLES.getOrPut(kind) { buildStyle(kind) }

private fun bodyBrush(light: Long, base: Long, deep: Long, alpha: Float = 1f, cy: Float = -0.38f) =
    Brush.radialGradient(
        0f to Color(light).copy(alpha = alpha),
        0.45f to Color(base).copy(alpha = alpha),
        1f to Color(deep).copy(alpha = alpha),
        center = Offset(-0.28f, cy), radius = 1.75f,
    )

private fun rimBrush(deep: Long) = Brush.radialGradient(
    0f to Color.Transparent, 0.72f to Color.Transparent, 1f to Color(deep).copy(alpha = 0.55f),
    center = Offset(0f, -0.05f), radius = 1.1f,
)

private fun glossBrush(r: Rect, a: Float = 0.9f) = Brush.verticalGradient(
    0f to Color.White.copy(alpha = a), 1f to Color.White.copy(alpha = 0f), startY = r.top, endY = r.bottom,
)

private fun buildStyle(kind: Kind): Style = when (kind) {
    Kind.NEEDOH -> {
        val g = Rect(-0.62f, -0.78f, 0.25f, -0.38f)
        Style(
            shape = superellipse(0.93f, 0.88f, 4.2f, 0.08f),
            body = bodyBrush(0xFFFFB8E3, 0xFFFF4FB0, 0xFFC0117A, 0.94f),
            rimBrush = rimBrush(0xFF9C0A63),
            outline = Color(0xFF8E0E5C),
            faceY = 0.12f, eyeDx = 0.33f, eyeR = 0.115f, mouthY = 0.3f, mouth = Mouth.OPEN,
            cheekDx = 0.56f, cheekY = 0.33f, gloss = g, glossBrush = glossBrush(g), topY = -0.8f,
        )
    }
    Kind.PLUSH -> {
        val g = Rect(-0.6f, -0.62f, 0.15f, -0.3f)
        Style(
            shape = plushPath(),
            body = bodyBrush(0xFFFFE2C2, 0xFFFFA45C, 0xFFE0702C, cy = -0.3f),
            rimBrush = rimBrush(0xFFB8521C),
            outline = Color(0xFFA8481A),
            faceY = 0.0f, eyeDx = 0.34f, eyeR = 0.1f, mouthY = 0.13f, mouth = Mouth.CAT,
            cheekDx = 0.58f, cheekY = 0.16f, gloss = g, glossBrush = glossBrush(g, 0.75f), topY = -0.92f,
        )
    }
    Kind.SLIME -> {
        val g = Rect(-0.58f, -0.82f, 0.2f, -0.42f)
        Style(
            shape = slimePath(),
            body = bodyBrush(0xFFE4FF8F, 0xFF86E03A, 0xFF3F9E18, 0.96f),
            rimBrush = rimBrush(0xFF2F7A10),
            outline = Color(0xFF2E7312),
            faceY = -0.05f, eyeDx = 0.32f, eyeR = 0.11f, mouthY = 0.15f, mouth = Mouth.TONGUE,
            cheekDx = 0.56f, cheekY = 0.17f, gloss = g, glossBrush = glossBrush(g), topY = -0.9f,
        )
    }
    Kind.POPIT -> {
        val g = Rect(-0.8f, -0.82f, -0.25f, -0.5f)
        Style(
            shape = heartPath(),
            body = bodyBrush(0xFFC4F0FF, 0xFF52B9F5, 0xFF2478CC, cy = -0.5f),
            rimBrush = rimBrush(0xFF1A5BA8),
            outline = Color(0xFF1A5596),
            faceY = -0.12f, eyeDx = 0.27f, eyeR = 0.1f, mouthY = 0.06f, mouth = Mouth.SMILE,
            cheekDx = 0.47f, cheekY = 0.08f, gloss = g, glossBrush = glossBrush(g, 0.8f), topY = -0.85f,
        )
    }
    Kind.MOCHI -> {
        val g = Rect(-0.62f, -0.6f, 0.1f, -0.3f)
        Style(
            shape = mochiPath(),
            body = bodyBrush(0xFFF6EAFF, 0xFFC39CF5, 0xFF8A5CD6, cy = -0.25f),
            rimBrush = rimBrush(0xFF6A3FB8),
            outline = Color(0xFF5F3A9E),
            faceY = 0.24f, eyeDx = 0.32f, eyeR = 0.1f, mouthY = 0.38f, mouth = Mouth.CAT,
            cheekDx = 0.58f, cheekY = 0.42f, gloss = g, glossBrush = glossBrush(g, 0.85f), topY = -0.75f,
        )
    }
    Kind.LABUBU -> {
        val g = Rect(-0.52f, -0.42f, 0.1f, -0.18f)
        Style(
            shape = labubuPath(),
            body = bodyBrush(0xFFFFF2B8, 0xFFFFCB3D, 0xFFE0901A, cy = -0.25f),
            rimBrush = rimBrush(0xFFB86E0C),
            outline = Color(0xFFA06010),
            faceY = 0.2f, eyeDx = 0.29f, eyeR = 0.135f, mouthY = 0.48f, mouth = Mouth.GRIN,
            cheekDx = 0.55f, cheekY = 0.46f, gloss = g, glossBrush = glossBrush(g, 0.7f), topY = -1.05f,
        )
    }
}

private fun DrawScope.drawBody(st: Style, piece: Piece, time: Float, ph: Float, selected: Boolean) {
    if (selected) {
        val glow = 0.55f + 0.25f * sin(time * 7.5f)
        drawPath(st.shape, Color.White.copy(alpha = 0.35f * glow), style = SEL_GLOW_WIDE)
        drawPath(st.shape, Color.White.copy(alpha = 0.6f * glow), style = SEL_GLOW_MID)
        drawPath(st.shape, Color.White, style = SEL_GLOW_THIN)
    }
    drawPath(st.shape, st.body)
    drawKindDetails(piece.kind, time, ph)
    drawPath(st.shape, st.rimBrush)
    when (piece.special) {
        Special.LINE_H, Special.LINE_V -> drawStripes(st, piece.special == Special.LINE_H, time)
        Special.BOMB -> drawRibbon(st)
        else -> {}
    }
    drawPath(st.shape, st.outline.copy(alpha = 0.9f), style = OUTLINE)
    drawOval(st.glossBrush, Offset(st.gloss.left, st.gloss.top), st.gloss.size)
    drawCircle(Color.White.copy(alpha = 0.9f), 0.055f, Offset(st.gloss.right + 0.07f, st.gloss.top + 0.1f))
    drawFace(st, time, ph)
    when (piece.special) {
        Special.LINE_H, Special.LINE_V -> drawArrows(piece.special == Special.LINE_H, time)
        Special.BOMB -> drawBow(st, time, ph)
        else -> {}
    }
}

private fun DrawScope.drawKindDetails(kind: Kind, time: Float, ph: Float) {
    when (kind) {
        Kind.NEEDOH -> {
            // Jelly depth: darker core and an inner refraction line.
            drawOval(NEEDOH_CORE, Offset(-0.62f, -0.4f), Size(1.24f, 1.1f))
            withTransform({ scale(0.8f, 0.8f, Offset(0f, 0.1f)) }) {
                drawPath(style(Kind.NEEDOH).shape, Color.White.copy(alpha = 0.22f), style = INNER_LINE)
            }
            for (i in NEEDOH_GLITTER.indices) {
                val g = NEEDOH_GLITTER[i]
                val tw = 0.5f + 0.5f * sin(time * 2.7f + i * 2.1f + ph * 13f)
                drawCircle((if (i % 2 == 0) GOLD else Color.White).copy(alpha = 0.4f + 0.55f * tw), g.z, Offset(g.x, g.y))
            }
        }
        Kind.PLUSH -> {
            drawOval(PLUSH_EAR_IN, Offset(-0.76f, -0.84f), Size(0.24f, 0.24f))
            drawOval(PLUSH_EAR_IN, Offset(0.52f, -0.84f), Size(0.24f, 0.24f))
            drawOval(PLUSH_BELLY, Offset(-0.46f, 0.32f), Size(0.92f, 0.6f))
            // Tiny fluff tuft on top.
            drawPath(PLUSH_TUFT, Color(0xFFE0702C).copy(alpha = 0.8f), style = THIN_LINE)
        }
        Kind.SLIME -> {
            for (i in SLIME_BUBBLES.indices) {
                val b = SLIME_BUBBLES[i]
                val bob = 0.03f * sin(time * 1.8f + i * 1.9f + ph * 7f)
                drawCircle(Color(0xFFF4FFD0).copy(alpha = 0.32f), b.z, Offset(b.x, b.y + bob))
                drawCircle(Color.White.copy(alpha = 0.7f), b.z * 0.35f, Offset(b.x - b.z * 0.35f, b.y + bob - b.z * 0.35f))
            }
        }
        Kind.POPIT -> {
            for (i in POPIT_BUBBLES.indices) {
                val b = POPIT_BUBBLES[i]
                translate(b.x, b.y) {
                    drawCircle(POPIT_BUBBLE_BRUSH, b.z, Offset.Zero)
                    drawCircle(Color.White.copy(alpha = 0.85f), b.z * 0.32f, Offset(-b.z * 0.35f, -b.z * 0.38f))
                }
            }
        }
        Kind.MOCHI -> {
            // Squishy dimple on top and a dusting of starch.
            drawOval(MOCHI_DIMPLE, Offset(-0.24f, -0.42f), Size(0.48f, 0.2f))
            drawArc(Color(0xFF8A5CD6).copy(alpha = 0.55f), 20f, 140f, false,
                Offset(-0.2f, -0.44f), Size(0.4f, 0.2f), style = THIN_LINE)
            for (i in MOCHI_DUST.indices) {
                val d = MOCHI_DUST[i]
                drawCircle(Color.White.copy(alpha = 0.55f), d.z, Offset(d.x, d.y))
            }
            val tw = 0.5f + 0.5f * sin(time * 2.4f + ph * 9f)
            drawSparkle(Offset(0.6f, -0.5f), 0.13f + 0.06f * tw, Color.White.copy(alpha = 0.6f + 0.4f * tw))
        }
        Kind.LABUBU -> {
            drawPath(LABUBU_EAR_IN, LABUBU_EAR_BRUSH)
            drawOval(LABUBU_PATCH, Offset(-0.62f, -0.12f), Size(1.24f, 0.92f))
            // Fur tufts.
            drawPath(LABUBU_FUR, Color(0xFFD08A16).copy(alpha = 0.75f), style = THIN_LINE)
        }
    }
}

private fun DrawScope.drawFace(st: Style, time: Float, ph: Float) {
    // Blink: about 0.14 s every ~4.3 s, offset per piece. Never blinking at time 0 (icons).
    val period = 4.3f + 1.4f * frac(ph * 7.7f)
    val bt = (time + ph * 13f) % period
    val open = when {
        time <= 0f -> 1f
        bt < period - 0.16f -> 1f
        else -> abs((bt - (period - 0.08f)) / 0.08f)
    }
    val y = st.faceY
    eye(-st.eyeDx, y, st.eyeR, open)
    eye(st.eyeDx, y, st.eyeR, open)
    drawOval(CHEEK.copy(alpha = 0.5f), Offset(-st.cheekDx - 0.12f, st.cheekY - 0.06f), Size(0.24f, 0.13f))
    drawOval(CHEEK.copy(alpha = 0.5f), Offset(st.cheekDx - 0.12f, st.cheekY - 0.06f), Size(0.24f, 0.13f))
    translate(0f, st.mouthY) {
        when (st.mouth) {
            Mouth.SMILE -> drawPath(MOUTH_SMILE, FACE, style = MOUTH_STROKE)
            Mouth.CAT -> drawPath(MOUTH_CAT, FACE, style = MOUTH_STROKE)
            Mouth.OPEN -> {
                drawPath(MOUTH_OPEN, FACE)
                drawOval(TONGUE, Offset(-0.065f, 0.055f), Size(0.13f, 0.075f))
            }
            Mouth.TONGUE -> {
                drawPath(MOUTH_SMILE, FACE, style = MOUTH_STROKE)
                drawPath(TONGUE_PATH, TONGUE)
                drawPath(TONGUE_PATH, FACE, style = THIN_LINE)
            }
            Mouth.GRIN -> {
                drawPath(MOUTH_GRIN, FACE)
                drawPath(GRIN_TEETH, Color.White)
            }
        }
    }
}

private fun DrawScope.eye(x: Float, y: Float, r: Float, open: Float) {
    if (open < 0.35f) {
        drawArc(FACE, 200f, 140f, false, Offset(x - r, y - r * 0.4f), Size(2 * r, r * 1.3f), style = EYE_CLOSED)
    } else {
        val h = r * 2.3f * open
        drawOval(FACE, Offset(x - r, y - h * 0.5f), Size(2 * r, h))
        drawCircle(Color.White, r * 0.42f, Offset(x - r * 0.3f, y - h * 0.18f))
        drawCircle(Color.White.copy(alpha = 0.85f), r * 0.18f, Offset(x + r * 0.38f, y + h * 0.2f))
    }
}

// ---------------------------------------------------------------------------------------------
// Specials
// ---------------------------------------------------------------------------------------------

private fun DrawScope.drawStripes(st: Style, horizontal: Boolean, time: Float) {
    clipPath(st.shape) {
        val c = if (horizontal) st.faceY else 0f
        val offs = floatArrayOf(-0.5f, 0f, 0.5f)
        for (i in offs.indices) {
            val o = c + offs[i] + if (horizontal) 0.08f else 0f
            val w = if (i == 1) 0.13f else 0.2f
            if (horizontal) {
                drawRect(STRIPE_WHITE, Offset(-1.3f, o - w * 0.5f), Size(2.6f, w))
                drawRect(STRIPE_EDGE, Offset(-1.3f, o + w * 0.5f - 0.035f), Size(2.6f, 0.035f))
            } else {
                drawRect(STRIPE_WHITE, Offset(o - w * 0.5f, -1.3f), Size(w, 2.6f))
                drawRect(STRIPE_EDGE, Offset(o + w * 0.5f - 0.035f, -1.3f), Size(0.035f, 2.6f))
            }
        }
    }
}

private fun DrawScope.drawArrows(horizontal: Boolean, time: Float) {
    val push = 0.93f + 0.07f * (0.5f + 0.5f * sin(time * 6f))
    val base = if (horizontal) 0f else 90f
    for (k in 0 until 2) {
        rotate(base + 180f * k, Offset.Zero) {
            withTransform({
                translate(push, 0f)
                scale(1.35f, 1.35f, Offset.Zero)
            }) {
                drawPath(ARROW, Color(0xFFFF4FA0), style = ARROW_STROKE)
                drawPath(ARROW, Color.White)
            }
        }
    }
}

private fun DrawScope.drawBombGlow(time: Float, ph: Float) {
    val p = 0.5f + 0.5f * sin(time * 4.2f + ph * 6f)
    val s = 1f + 0.1f * p
    withTransform({ scale(s, s, Offset(0f, 0.05f)) }) {
        drawCircle(BOMB_GLOW, 1.35f, Offset(0f, 0.05f))
        rotate(time * 40f + ph * 360f, Offset(0f, 0.05f)) {
            drawCircle(GOLD.copy(alpha = 0.55f + 0.45f * p), 1.06f, Offset(0f, 0.05f), style = BOMB_RING)
        }
    }
    // Orbiting sparkles.
    for (i in 0 until 3) {
        val ang = time * 1.6f + i * 2.094f + ph * 6f
        val tw = 0.5f + 0.5f * sin(time * 5f + i * 2f)
        drawSparkle(Offset(cos(ang) * 1.12f, 0.05f + sin(ang) * 1.05f), 0.12f + 0.08f * tw,
            Color.White.copy(alpha = 0.6f + 0.4f * tw))
    }
}

private fun DrawScope.drawRibbon(st: Style) {
    clipPath(st.shape) {
        val y = 0.7f
        drawRect(RIBBON, Offset(-1.3f, y - 0.13f), Size(2.6f, 0.26f))
        drawRect(RIBBON_DARK, Offset(-1.3f, y + 0.09f), Size(2.6f, 0.04f))
        drawRect(Color.White.copy(alpha = 0.6f), Offset(-1.3f, y - 0.1f), Size(2.6f, 0.04f))
        for (i in 0 until 7) {
            drawCircle(Color.White.copy(alpha = 0.85f), 0.025f, Offset(-0.75f + i * 0.25f, y))
        }
    }
}

private fun DrawScope.drawBow(st: Style, time: Float, ph: Float) {
    val wig = 6f * sin(time * 3.2f + ph * 5f)
    withTransform({
        translate(0f, 0.7f)
        scale(1.3f, 1.3f, Offset.Zero)
        rotate(wig, Offset.Zero)
    }) {
        run {
            drawPath(BOW, RIBBON)
            drawPath(BOW, RIBBON_DARK, style = THIN_LINE)
            drawCircle(RIBBON, 0.08f, Offset.Zero)
            drawCircle(RIBBON_DARK, 0.08f, Offset.Zero, style = THIN_LINE)
            drawCircle(Color.White.copy(alpha = 0.8f), 0.03f, Offset(-0.025f, -0.03f))
        }
    }
}

private fun DrawScope.drawDiscoBall(time: Float, ph: Float, selected: Boolean) {
    if (selected) {
        val glow = 0.55f + 0.25f * sin(time * 7.5f)
        drawCircle(Color.White.copy(alpha = 0.35f * glow), 0.95f, Offset(0f, 0.05f), style = SEL_GLOW_WIDE)
        drawCircle(Color.White, 0.95f, Offset(0f, 0.05f), style = SEL_GLOW_THIN)
    }
    val c = Offset(0f, 0.05f)
    // Rainbow halo.
    drawCircle(DISCO_HALO, 1.3f, c)
    rotate(time * 70f + ph * 360f, c) {
        drawCircle(DISCO_SWEEP, 0.95f, c)
    }
    clipPath(DISCO_CIRCLE) {
        // Mirror tiles: latitude bands + rotating meridians.
        for (k in -3..3) {
            val yy = c.y + k * 0.27f
            drawLine(DISCO_LINE, Offset(-1f, yy), Offset(1f, yy), strokeWidth = 0.035f)
        }
        val spin = (time * 0.9f + ph * 3f) % (PI.toFloat() / 4f)
        for (j in 0 until 4) {
            val a = spin + j * PI.toFloat() / 4f
            val rx = abs(cos(a)) * 0.95f
            drawOval(DISCO_LINE, Offset(-rx, c.y - 0.95f), Size(2 * rx, 1.9f), style = DISCO_STROKE)
        }
        // Twinkling tiles.
        for (i in 0 until 7) {
            val tw = sin(time * 4f + i * 1.9f + ph * 17f)
            if (tw > 0.2f) {
                val tx = -0.6f + frac(i * 0.381f) * 1.2f
                val ty = -0.6f + frac(i * 0.613f + 0.2f) * 1.2f
                drawRect(Color.White.copy(alpha = 0.75f * tw), Offset(tx, ty), Size(0.13f, 0.13f))
            }
        }
        drawCircle(DISCO_SHADE, 0.95f, c)
    }
    drawCircle(Color(0xFF7A3FB0).copy(alpha = 0.9f), 0.95f, c, style = OUTLINE)
    drawOval(DISCO_GLOSS, Offset(-0.6f, -0.72f), Size(0.75f, 0.42f))
    // Cute face.
    eye(-0.3f, 0.06f, 0.11f, 1f)
    eye(0.3f, 0.06f, 0.11f, 1f)
    drawOval(CHEEK.copy(alpha = 0.6f), Offset(-0.66f, 0.18f), Size(0.24f, 0.13f))
    drawOval(CHEEK.copy(alpha = 0.6f), Offset(0.42f, 0.18f), Size(0.24f, 0.13f))
    translate(0f, 0.24f) { drawPath(MOUTH_OPEN, FACE) }
    // Sparkles around.
    for (i in 0 until 4) {
        val tw = sin(time * 3.3f + i * 1.6f + ph * 9f)
        if (tw > 0f) {
            val ang = i * 1.5708f + 0.6f
            drawSparkle(Offset(cos(ang) * 0.98f, 0.05f + sin(ang) * 0.98f), 0.1f + 0.12f * tw, Color.White.copy(alpha = tw))
        }
    }
}

// ---------------------------------------------------------------------------------------------
// Sparkles
// ---------------------------------------------------------------------------------------------

private fun DrawScope.drawSparkle(c: Offset, s: Float, color: Color) {
    withTransform({
        translate(c.x, c.y)
        scale(s, s, Offset.Zero)
    }) { drawPath(SPARKLE, color) }
}

private fun DrawScope.drawSparkleAbs(c: Offset, s: Float, color: Color) = drawSparkle(c, s, color)

// ---------------------------------------------------------------------------------------------
// Cached geometry (unit space)
// ---------------------------------------------------------------------------------------------

private class P3(val x: Float, val y: Float, val z: Float)

private fun superellipse(a: Float, b: Float, n: Float, cy: Float, steps: Int = 72): Path {
    val p = Path()
    for (i in 0 until steps) {
        val t = 2.0 * PI * i / steps
        val c = cos(t).toFloat()
        val s = sin(t).toFloat()
        val x = a * sign(c) * abs(c).pow(2f / n)
        val y = cy + b * sign(s) * abs(s).pow(2f / n)
        if (i == 0) p.moveTo(x, y) else p.lineTo(x, y)
    }
    p.close()
    return p
}

private fun ellipsePath(cx: Float, cy: Float, rx: Float, ry: Float, rotDeg: Float = 0f, steps: Int = 48): Path {
    val p = Path()
    val ra = rotDeg * PI.toFloat() / 180f
    val cr = cos(ra)
    val sr = sin(ra)
    for (i in 0 until steps) {
        val t = 2.0 * PI * i / steps
        val ex = rx * cos(t).toFloat()
        val ey = ry * sin(t).toFloat()
        val x = cx + ex * cr - ey * sr
        val y = cy + ex * sr + ey * cr
        if (i == 0) p.moveTo(x, y) else p.lineTo(x, y)
    }
    p.close()
    return p
}

private fun union(a: Path, b: Path): Path = Path().apply { op(a, b, PathOperation.Union) }

private fun plushPath(): Path {
    var p = ellipsePath(0f, 0.08f, 0.98f, 0.86f)
    p = union(p, ellipsePath(-0.64f, -0.68f, 0.21f, 0.21f))
    p = union(p, ellipsePath(0.64f, -0.68f, 0.21f, 0.21f))
    return p
}

private fun slimePath(): Path = Path().apply {
    moveTo(-0.96f, 0.42f)
    cubicTo(-1.02f, -0.4f, -0.55f, -0.92f, 0f, -0.92f)
    cubicTo(0.55f, -0.92f, 1.02f, -0.4f, 0.96f, 0.42f)
    cubicTo(0.94f, 0.62f, 0.86f, 0.66f, 0.76f, 0.66f)
    // right drip
    cubicTo(0.7f, 0.66f, 0.7f, 0.86f, 0.6f, 0.88f)
    cubicTo(0.5f, 0.9f, 0.48f, 0.72f, 0.42f, 0.7f)
    lineTo(0.2f, 0.7f)
    // big middle drip
    cubicTo(0.12f, 0.7f, 0.12f, 1.0f, -0.02f, 1.0f)
    cubicTo(-0.16f, 1.0f, -0.14f, 0.72f, -0.24f, 0.7f)
    lineTo(-0.42f, 0.7f)
    // small left drip
    cubicTo(-0.5f, 0.7f, -0.52f, 0.84f, -0.6f, 0.84f)
    cubicTo(-0.68f, 0.84f, -0.68f, 0.68f, -0.78f, 0.66f)
    cubicTo(-0.88f, 0.64f, -0.95f, 0.58f, -0.96f, 0.42f)
    close()
}

private fun heartPath(): Path = Path().apply {
    moveTo(0f, 0.95f)
    cubicTo(-0.5f, 0.62f, -1.04f, 0.22f, -1.02f, -0.3f)
    cubicTo(-1.0f, -0.72f, -0.68f, -0.94f, -0.44f, -0.92f)
    cubicTo(-0.22f, -0.9f, -0.06f, -0.78f, 0f, -0.6f)
    cubicTo(0.06f, -0.78f, 0.22f, -0.9f, 0.44f, -0.92f)
    cubicTo(0.68f, -0.94f, 1.0f, -0.72f, 1.02f, -0.3f)
    cubicTo(1.04f, 0.22f, 0.5f, 0.62f, 0f, 0.95f)
    close()
}

private fun mochiPath(): Path {
    val p = Path()
    val steps = 72
    for (i in 0 until steps) {
        val t = 2.0 * PI * i / steps
        val c = cos(t).toFloat()
        val s = sin(t).toFloat()
        val x = 1.0f * sign(c) * abs(c).pow(2f / 2.6f)
        val y = if (s < 0f) 0.3f - 0.98f * abs(s).pow(2f / 2.1f) else 0.3f + 0.62f * s.pow(2f / 3.2f)
        if (i == 0) p.moveTo(x, y) else p.lineTo(x, y)
    }
    p.close()
    return p
}

private fun labubuPath(): Path {
    var p = ellipsePath(0f, 0.22f, 0.9f, 0.76f)
    p = union(p, ellipsePath(-0.4f, -0.58f, 0.2f, 0.5f, -14f))
    p = union(p, ellipsePath(0.4f, -0.58f, 0.2f, 0.5f, 14f))
    return p
}

private val SPARKLE: Path = Path().apply {
    moveTo(0f, -1f)
    quadraticBezierTo(0.12f, -0.12f, 1f, 0f)
    quadraticBezierTo(0.12f, 0.12f, 0f, 1f)
    quadraticBezierTo(-0.12f, 0.12f, -1f, 0f)
    quadraticBezierTo(-0.12f, -0.12f, 0f, -1f)
    close()
}

private val MOUTH_SMILE = Path().apply {
    moveTo(-0.11f, -0.02f)
    quadraticBezierTo(0f, 0.12f, 0.11f, -0.02f)
}
private val MOUTH_CAT = Path().apply {
    moveTo(-0.15f, -0.02f)
    quadraticBezierTo(-0.075f, 0.1f, 0f, -0.01f)
    quadraticBezierTo(0.075f, 0.1f, 0.15f, -0.02f)
}
private val MOUTH_OPEN = Path().apply {
    moveTo(-0.13f, -0.03f)
    quadraticBezierTo(0f, 0.0f, 0.13f, -0.03f)
    cubicTo(0.12f, 0.2f, -0.12f, 0.2f, -0.13f, -0.03f)
    close()
}
private val TONGUE_PATH = Path().apply {
    moveTo(-0.06f, 0.04f)
    lineTo(0.06f, 0.04f)
    cubicTo(0.07f, 0.17f, -0.07f, 0.17f, -0.06f, 0.04f)
    close()
}
private val MOUTH_GRIN = Path().apply {
    moveTo(-0.3f, -0.04f)
    quadraticBezierTo(0f, 0.06f, 0.3f, -0.04f)
    cubicTo(0.24f, 0.24f, -0.24f, 0.24f, -0.3f, -0.04f)
    close()
}
private val GRIN_TEETH = Path().apply {
    val n = 7
    fun topY(x: Float): Float {
        val u = (x + 0.3f) / 0.6f
        return -0.04f + 0.1f * u * (1f - u) * 2f + 0.005f
    }
    for (i in 0 until n) {
        val x0 = -0.26f + i * (0.52f / n)
        val x1 = x0 + 0.52f / n
        val xm = (x0 + x1) * 0.5f
        val bump = if (i == 0 || i == n - 1) 0.05f else 0.08f
        moveTo(x0, topY(x0) - 0.01f)
        lineTo(x1, topY(x1) - 0.01f)
        lineTo(xm, topY(xm) + bump)
        close()
    }
}

private val ARROW = Path().apply {
    moveTo(0.16f, 0f)
    lineTo(-0.02f, -0.16f)
    lineTo(-0.02f, -0.07f)
    lineTo(-0.12f, -0.07f)
    lineTo(-0.12f, 0.07f)
    lineTo(-0.02f, 0.07f)
    lineTo(-0.02f, 0.16f)
    close()
}

private val BOW = Path().apply {
    moveTo(0f, 0f)
    cubicTo(-0.12f, -0.22f, -0.36f, -0.2f, -0.3f, 0f)
    cubicTo(-0.36f, 0.2f, -0.12f, 0.22f, 0f, 0f)
    cubicTo(0.12f, -0.22f, 0.36f, -0.2f, 0.3f, 0f)
    cubicTo(0.36f, 0.2f, 0.12f, 0.22f, 0f, 0f)
    close()
    moveTo(-0.04f, 0.04f); lineTo(-0.16f, 0.3f); lineTo(-0.06f, 0.26f); lineTo(0f, 0.06f); close()
    moveTo(0.04f, 0.04f); lineTo(0.16f, 0.3f); lineTo(0.06f, 0.26f); lineTo(0f, 0.06f); close()
}

private val PLUSH_TUFT = Path().apply {
    moveTo(-0.08f, -0.76f)
    quadraticBezierTo(-0.02f, -0.92f, 0.04f, -0.78f)
    quadraticBezierTo(0.1f, -0.9f, 0.14f, -0.76f)
}

private val LABUBU_EAR_IN: Path = union(
    ellipsePath(-0.4f, -0.6f, 0.1f, 0.34f, -14f),
    ellipsePath(0.4f, -0.6f, 0.1f, 0.34f, 14f),
)

private val LABUBU_FUR = Path().apply {
    moveTo(-0.86f, 0.42f); quadraticBezierTo(-0.74f, 0.5f, -0.78f, 0.62f)
    moveTo(0.86f, 0.42f); quadraticBezierTo(0.74f, 0.5f, 0.78f, 0.62f)
    moveTo(-0.12f, -0.46f); quadraticBezierTo(0f, -0.36f, 0.12f, -0.46f)
}

private val DISCO_CIRCLE = ellipsePath(0f, 0.05f, 0.95f, 0.95f, steps = 64)

private val GOO_PATH: Path = Path().apply {
    // Wobbly rounded-square puddle filling most of the cell (unit -1..1 = cell).
    val steps = 64
    for (i in 0 until steps) {
        val t = 2.0 * PI * i / steps
        val c = cos(t).toFloat()
        val s = sin(t).toFloat()
        val n = 3.4f
        val bump = 1f + 0.045f * sin(t * 5 + 0.7).toFloat() + 0.025f * sin(t * 9 + 2.0).toFloat()
        val x = 0.9f * bump * sign(c) * abs(c).pow(2f / n)
        val y = 0.9f * bump * sign(s) * abs(s).pow(2f / n)
        if (i == 0) moveTo(x, y) else lineTo(x, y)
    }
    close()
}

private val GLITTER = arrayOf(
    P3(-0.7f, -0.2f, 0.035f), P3(-0.45f, 0.72f, 0.03f), P3(0.72f, -0.35f, 0.04f), P3(0.3f, -0.75f, 0.03f),
    P3(0.7f, 0.3f, 0.03f), P3(-0.75f, 0.45f, 0.028f), P3(0.05f, 0.78f, 0.035f), P3(-0.3f, -0.74f, 0.03f),
)
private val NEEDOH_GLITTER = arrayOf(
    P3(-0.55f, 0.62f, 0.035f), P3(0.6f, 0.58f, 0.03f), P3(0.7f, -0.2f, 0.028f), P3(-0.72f, -0.05f, 0.03f),
    P3(0.35f, -0.55f, 0.025f), P3(0.05f, 0.7f, 0.03f), P3(-0.2f, -0.35f, 0.022f),
)
private val SLIME_BUBBLES = arrayOf(
    P3(0.55f, -0.45f, 0.1f), P3(0.72f, -0.12f, 0.06f), P3(-0.62f, 0.42f, 0.07f), P3(0.45f, 0.5f, 0.05f),
)
private val POPIT_BUBBLES: Array<P3> = run {
    val list = ArrayList<P3>()
    val r = 0.13f
    val rows = floatArrayOf(-0.58f, 0.26f, 0.58f)
    for ((ri, y) in rows.withIndex()) {
        val xs = when (ri) {
            0 -> floatArrayOf(-0.62f, -0.32f, 0.32f, 0.62f)
            1 -> floatArrayOf(-0.6f, -0.3f, 0f, 0.3f, 0.6f)
            else -> floatArrayOf(-0.27f, 0f, 0.27f)
        }
        for (x in xs) list += P3(x, y, r)
    }
    list.toTypedArray()
}
private val MOCHI_DUST = arrayOf(
    P3(-0.6f, -0.1f, 0.025f), P3(0.5f, -0.2f, 0.02f), P3(0.72f, 0.2f, 0.022f), P3(-0.35f, -0.52f, 0.02f),
    P3(0.15f, -0.6f, 0.018f),
)

// ---------------------------------------------------------------------------------------------
// Cached brushes, colours and strokes
// ---------------------------------------------------------------------------------------------

private val SHADOW_BRUSH = Brush.radialGradient(
    0f to Color(0x553A1D3C), 1f to Color(0x003A1D3C), center = Offset(0f, 1.03f), radius = 0.86f,
)
private val NEEDOH_CORE = Brush.radialGradient(
    0f to Color(0x55A0005C), 1f to Color(0x00A0005C), center = Offset(0f, 0.15f), radius = 0.62f,
)
private val PLUSH_EAR_IN = Color(0xFFFF9BB0)
private val PLUSH_BELLY = Brush.radialGradient(
    0f to Color(0xFFFFF6EA), 0.8f to Color(0xFFFFE7CC), 1f to Color(0x00FFE0C0),
    center = Offset(0f, 0.6f), radius = 0.48f,
)
private val POPIT_BUBBLE_BRUSH = Brush.radialGradient(
    0f to Color(0xFFD6F5FF), 0.6f to Color(0xFF6EC8F8), 1f to Color(0xFF2E86D8),
    center = Offset(-0.04f, -0.05f), radius = 0.15f,
)
private val MOCHI_DIMPLE = Brush.radialGradient(
    0f to Color(0x558A5CD6), 1f to Color(0x008A5CD6), center = Offset(0f, -0.32f), radius = 0.24f,
)
private val LABUBU_EAR_BRUSH = Brush.verticalGradient(
    0f to Color(0xFFFF9FC0), 1f to Color(0xFFFFC2D4), startY = -0.95f, endY = -0.3f,
)
private val LABUBU_PATCH = Brush.radialGradient(
    0f to Color(0xFFFFFBEA), 0.82f to Color(0xFFFFF0C8), 1f to Color(0x00FFE9B0),
    center = Offset(0f, 0.34f), radius = 0.62f,
)
private val TONGUE = Color(0xFFFF7A9C)

private val STRIPE_WHITE = Color.White.copy(alpha = 0.82f)
private val STRIPE_EDGE = Color(0x40FF2E8A)
private val BOMB_GLOW = Brush.radialGradient(
    0f to Color(0x00FFF2A0), 0.55f to Color(0x00FFF2A0), 0.72f to Color(0xAAFFE066),
    0.82f to Color(0x66FF9AD5), 1f to Color(0x00FF9AD5),
    center = Offset(0f, 0.05f), radius = 1.35f,
)
private val RIBBON = Color(0xFFFF3D8B)
private val BOMB_RING = Stroke(
    width = 0.08f, cap = StrokeCap.Round,
    pathEffect = androidx.compose.ui.graphics.PathEffect.dashPathEffect(floatArrayOf(0.001f, 0.185f)),
)
private val RIBBON_DARK = Color(0xFFB0145A)

private val RAINBOW = listOf(
    Color(0xFFFF5E8A), Color(0xFFFFB347), Color(0xFFFFF06A), Color(0xFF6EEB83),
    Color(0xFF4FC3F7), Color(0xFF9B7BFF), Color(0xFFFF6EDB), Color(0xFFFF5E8A),
)
private val DISCO_SWEEP = Brush.sweepGradient(RAINBOW, center = Offset(0f, 0.05f))
private val DISCO_HALO = Brush.radialGradient(
    0f to Color(0x00FFFFFF), 0.66f to Color(0x00FFFFFF), 0.74f to Color(0x99FFFFFF),
    0.85f to Color(0x55D59BFF), 1f to Color(0x00D59BFF),
    center = Offset(0f, 0.05f), radius = 1.3f,
)
private val DISCO_SHADE = Brush.radialGradient(
    0f to Color(0x55FFFFFF), 0.5f to Color(0x00FFFFFF), 0.8f to Color(0x00000000), 1f to Color(0x55400070),
    center = Offset(-0.3f, -0.3f), radius = 1.35f,
)
private val DISCO_LINE = Color(0x88FFFFFF)
private val DISCO_GLOSS = Brush.verticalGradient(
    0f to Color(0xEEFFFFFF), 1f to Color(0x00FFFFFF), startY = -0.72f, endY = -0.3f,
)

private val OUTLINE = Stroke(width = 0.06f, join = StrokeJoin.Round)
private val INNER_LINE = Stroke(width = 0.05f, join = StrokeJoin.Round)
private val THIN_LINE = Stroke(width = 0.035f, cap = StrokeCap.Round, join = StrokeJoin.Round)
private val MOUTH_STROKE = Stroke(width = 0.055f, cap = StrokeCap.Round, join = StrokeJoin.Round)
private val EYE_CLOSED = Stroke(width = 0.055f, cap = StrokeCap.Round)
private val ARROW_STROKE = Stroke(width = 0.075f, join = StrokeJoin.Round)
private val DISCO_STROKE = Stroke(width = 0.035f)
private val SEL_GLOW_WIDE = Stroke(width = 0.42f, join = StrokeJoin.Round)
private val SEL_GLOW_MID = Stroke(width = 0.24f, join = StrokeJoin.Round)
private val SEL_GLOW_THIN = Stroke(width = 0.11f, join = StrokeJoin.Round)

// Tiles (cell space 0..1).
private val TILE_LIGHT = Color(0x8CFFFFFF)
private val TILE_DARK = Color(0x73F3DDFF)
private val TILE_RIM = Stroke(width = 0.025f)

// Goo (cell space -1..1).
private val GOO1_BRUSH = Brush.radialGradient(
    0f to Color(0x99FFB0E0), 0.65f to Color(0xC0FF7CC8), 1f to Color(0xDDF555B4),
    center = Offset(-0.2f, -0.25f), radius = 1.3f,
)
private val GOO1_RIM = Color(0xCCD9358F)
private val GOO2_EDGE_BRUSH = Brush.radialGradient(
    0f to Color(0xDDC21C86), 1f to Color(0xEE9C0E6A), center = Offset(0f, 0.2f), radius = 1.2f,
)
private val GOO2_BRUSH = Brush.radialGradient(
    0f to Color(0xEEFF8FD4), 0.6f to Color(0xEEF04AAE), 1f to Color(0xEED42A92),
    center = Offset(-0.25f, -0.3f), radius = 1.25f,
)
private val GOO2_RIM = Color(0xFF8A0B5E)
private val GOO_STROKE = Stroke(width = 0.05f, join = StrokeJoin.Round)
private val GOO_STROKE_THICK = Stroke(width = 0.09f, join = StrokeJoin.Round)

// Bubble wrap (cell space 0..1).
private val WRAP1_BRUSH = Brush.verticalGradient(
    0f to Color(0xB8F4FBFF), 1f to Color(0xA0CDE8FF), startY = 0.03f, endY = 0.97f,
)
private val WRAP2_BRUSH = Brush.verticalGradient(
    0f to Color(0xE8E2F2FF), 1f to Color(0xE0A9CFF5), startY = 0.03f, endY = 0.97f,
)
private val WRAP2_BACK = Color(0xCC9FC4EE)
private val WRAP_EDGE1 = Color(0xFFFFFFFF)
private val WRAP_EDGE2 = Color(0xFF6E9FD6)
private val WRAP_STROKE = Stroke(width = 0.03f)
private val WRAP_STROKE_THICK = Stroke(width = 0.055f)
private val BUBBLE1_BRUSH = Brush.radialGradient(
    0f to Color(0xEEFFFFFF), 0.7f to Color(0x99E6F4FF), 1f to Color(0xCCB4D8F5),
    center = Offset(-0.04f, -0.05f), radius = 0.15f,
)
private val BUBBLE2_BRUSH = Brush.radialGradient(
    0f to Color(0xFFFFFFFF), 0.6f to Color(0xEED0E8FF), 1f to Color(0xFF8DB8E8),
    center = Offset(-0.04f, -0.05f), radius = 0.15f,
)
private val BUBBLE_RIM = Color(0xCC9CC6EE)
private val BUBBLE_STROKE = Stroke(width = 0.02f, cap = StrokeCap.Round)
private val BUBBLE_STROKE_THICK = Stroke(width = 0.035f)
private val WRAP_GLOSS = Brush.verticalGradient(
    0f to Color(0x88FFFFFF), 1f to Color(0x00FFFFFF), startY = 0.06f, endY = 0.26f,
)

// Backdrop.
private const val BOKEH_N = 16
private const val SPARK_N = 14
private val BOKEH_TINTS = arrayOf(
    Color(0xFFFFFFFF), Color(0xFFFFD6EC), Color(0xFFE5D6FF), Color(0xFFFFE6C9), Color(0xFFD3F1FF),
)
private var backdropCacheH = -1f
private var backdropCache: Brush? = null
private fun backdropBrush(h: Float): Brush {
    val c = backdropCache
    if (c != null && backdropCacheH == h) return c
    val b = Brush.verticalGradient(
        0f to Color(0xFFFFC7E6), 0.45f to Color(0xFFE2CCFF), 1f to Color(0xFFFFDCC2),
        startY = 0f, endY = h,
    )
    backdropCache = b
    backdropCacheH = h
    return b
}

// ---------------------------------------------------------------------------------------------
// Small maths helpers
// ---------------------------------------------------------------------------------------------

private fun frac(x: Float): Float = x - floor(x)

/** Stable 0..1 phase per piece id. */
private fun phase(id: Long): Float {
    var h = id * -0x61c8864680b583ebL
    h = h xor (h ushr 29)
    return ((h ushr 40).toInt() and 0xFFFF) / 65535f
}
