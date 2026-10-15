package com.baldissera.rpg

import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.BlendMode
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.text.TextMeasurer
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.drawText
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sin

/** Tiles visible across the screen width. */
private const val TILES_ACROSS = 9f
private const val WALL_HEIGHT = 0.6f

class Camera(val ox: Float, val oy: Float, val t: Float) {
    fun sx(x: Float) = x * t - ox
    fun sy(y: Float) = y * t - oy
}

fun DrawScope.cameraFor(g: Game): Camera {
    val t = size.width / TILES_ACROSS
    return Camera(
        (g.player.x + g.shakeX) * t - size.width / 2f,
        (g.player.y + g.shakeY) * t - size.height * 0.45f,
        t,
    )
}

private fun frac(f: Float) = f - kotlin.math.floor(f)
private fun Color.darker(f: Float) = Color(red * f, green * f, blue * f, alpha)
private fun Color.lighter(f: Float) = lerp(this, Color.White, f)

private fun flicker(time: Float, seed: Float) =
    0.88f + 0.07f * sin(time * 11f + seed * 7f) + 0.05f * sin(time * 23f + seed * 3f)

class TextStyles(val small: TextStyle, val big: TextStyle, val label: TextStyle)

// ---------------------------------------------------------------- world

fun DrawScope.drawWorld(g: Game, measurer: TextMeasurer, styles: TextStyles) {
    val cam = cameraFor(g)
    val t = cam.t
    val d = g.dungeon
    drawRect(Color(0xFF0A0908))

    val x0 = max(0, floorInt(cam.ox / t) - 1)
    val x1 = min(d.w - 1, floorInt((cam.ox + size.width) / t) + 1)
    val y0 = max(0, floorInt(cam.oy / t) - 1)
    val y1 = min(d.h - 1, floorInt((cam.oy + size.height) / t) + 2)

    for (y in y0..y1) for (x in x0..x1) {
        val tile = d.tile(x, y)
        if (tile != WALL) drawFloorTile(d, x, y, tile, cam, g.time)
    }

    for (l in g.loot) drawLoot(l, cam, g.time, measurer, styles)

    // Row by row so walls hide whatever stands behind them.
    for (y in y0..y1) {
        for (x in x0..x1) if (d.tile(x, y) == WALL) drawWallTile(d, x, y, cam, g.time)
        for (e in g.enemies) if (floorInt(e.y) == y) drawEnemy(e, g, cam)
        if (floorInt(g.player.y) == y) drawPlayer(g, cam)
    }

    for (pr in g.projectiles) {
        val c = Offset(cam.sx(pr.x), cam.sy(pr.y) - t * 0.35f)
        val r = pr.radius * t
        drawCircle(Brush.radialGradient(listOf(pr.color.copy(alpha = 0.6f), Color.Transparent), c, r * 3f), r * 3f, c)
        drawCircle(pr.color.lighter(0.4f), r, c)
        drawCircle(Color.White.copy(alpha = 0.9f), r * 0.45f, c)
    }

    for (pt in g.particles) {
        val fade = 1f - pt.age / pt.life
        val c = Offset(cam.sx(pt.x), cam.sy(pt.y) - t * 0.3f)
        val r = pt.size * t
        if (pt.glow) {
            drawCircle(pt.color.copy(alpha = 0.3f * fade), r * 2.5f, c)
            drawCircle(pt.color.lighter(0.5f).copy(alpha = fade), r, c)
        } else {
            drawCircle(pt.color.copy(alpha = fade), r, c)
        }
    }

    // Warm light spill from torches and fire on top of the scene.
    for (i in d.torches) {
        val tx = i % d.w
        val ty = i / d.w
        if (tx < x0 - 3 || tx > x1 + 3 || ty < y0 - 3 || ty > y1 + 3) continue
        val c = Offset(cam.sx(tx + 0.5f), cam.sy(ty + 1f) - t * WALL_HEIGHT * 0.4f)
        val r = t * 3.2f * flicker(g.time, i.toFloat())
        drawCircle(Brush.radialGradient(listOf(Color(0x40FF9A3C), Color.Transparent), c, r), r, c)
    }
    for (pr in g.projectiles) {
        val c = Offset(cam.sx(pr.x), cam.sy(pr.y))
        drawCircle(Brush.radialGradient(listOf(pr.color.copy(alpha = 0.3f), Color.Transparent), c, t * 2f), t * 2f, c)
    }

    for (ft in g.texts) {
        val layout = ft.layout ?: measurer.measure(ft.text, if (ft.big) styles.big else styles.small).also { ft.layout = it }
        val maxAge = if (ft.big) 1.3f else 1f
        val alpha = (1f - ft.age / maxAge).coerceIn(0f, 1f)
        val color = ft.color
        drawText(
            layout,
            color = color,
            topLeft = Offset(cam.sx(ft.x) - layout.size.width / 2f, cam.sy(ft.y) - layout.size.height / 2f),
            alpha = alpha,
        )
    }
}

private fun DrawScope.drawFloorTile(d: Dungeon, x: Int, y: Int, tile: Int, cam: Camera, time: Float) {
    val t = cam.t
    val left = cam.sx(x.toFloat())
    val top = cam.sy(y.toFloat())
    val v = d.variant[y * d.w + x]
    drawRect(Color(0xFF1C1916), Offset(left, top), Size(t + 1f, t + 1f))

    // Four worn flagstones per tile.
    val half = t / 2f
    val gap = t * 0.03f
    for (i in 0..3) {
        val sx = left + (i % 2) * half
        val sy = top + (i / 2) * half
        val vv = frac(v * (7.3f + i * 3.1f))
        val base = lerp(Color(0xFF3A342E), Color(0xFF51493F), vv)
        drawRoundRect(base, Offset(sx + gap, sy + gap), Size(half - 2 * gap, half - 2 * gap), CornerRadius(t * 0.04f))
        drawRect(base.lighter(0.08f), Offset(sx + gap * 2, sy + gap), Size(half - 4 * gap, t * 0.025f))
        drawRect(base.darker(0.75f), Offset(sx + gap * 2, sy + half - gap - t * 0.03f), Size(half - 4 * gap, t * 0.03f))
    }

    when (d.decor[y * d.w + x]) {
        DECOR_CRACK -> {
            val c = Color(0xFF15120F)
            drawLine(c, Offset(left + t * 0.2f, top + t * 0.3f), Offset(left + t * 0.45f, top + t * 0.52f), t * 0.02f)
            drawLine(c, Offset(left + t * 0.45f, top + t * 0.52f), Offset(left + t * 0.72f, top + t * 0.48f), t * 0.018f)
            drawLine(c, Offset(left + t * 0.45f, top + t * 0.52f), Offset(left + t * 0.5f, top + t * 0.78f), t * 0.015f)
        }
        DECOR_BONES -> {
            val bone = Color(0xFFCFC6B0)
            drawLine(bone, Offset(left + t * 0.25f, top + t * 0.6f), Offset(left + t * 0.65f, top + t * 0.45f), t * 0.04f, StrokeCap.Round)
            drawLine(bone, Offset(left + t * 0.35f, top + t * 0.4f), Offset(left + t * 0.6f, top + t * 0.7f), t * 0.035f, StrokeCap.Round)
            drawCircle(bone, t * 0.07f, Offset(left + t * 0.72f, top + t * 0.66f))
            drawCircle(Color(0xFF1A1714), t * 0.018f, Offset(left + t * 0.7f, top + t * 0.65f))
        }
        DECOR_MOSS -> {
            val moss = Color(0x664E7D32)
            drawCircle(moss, t * 0.16f, Offset(left + t * 0.3f, top + t * 0.7f))
            drawCircle(moss, t * 0.11f, Offset(left + t * 0.45f, top + t * 0.78f))
            drawCircle(Color(0x446B8E23), t * 0.09f, Offset(left + t * 0.22f, top + t * 0.82f))
        }
        DECOR_PUDDLE -> {
            drawOval(Color(0x88101820), Offset(left + t * 0.2f, top + t * 0.45f), Size(t * 0.55f, t * 0.28f))
            val shimmer = 0.15f + 0.1f * sin(time * 2f + x + y)
            drawOval(Color.White.copy(alpha = shimmer), Offset(left + t * 0.3f, top + t * 0.5f), Size(t * 0.2f, t * 0.06f))
        }
    }

    if (tile == STAIRS) {
        drawRect(Color(0xFF050404), Offset(left + t * 0.08f, top + t * 0.08f), Size(t * 0.84f, t * 0.84f))
        for (s in 0..3) {
            val shade = lerp(Color(0xFF4A433C), Color(0xFF0E0C0A), s / 3f)
            drawRect(shade, Offset(left + t * 0.12f, top + t * (0.12f + s * 0.2f)), Size(t * 0.76f, t * 0.16f))
        }
        val pulse = 0.5f + 0.5f * sin(time * 2.5f)
        val c = Offset(left + t / 2f, top + t / 2f)
        drawCircle(Color(0xFF4FC3F7).copy(alpha = 0.25f + 0.35f * pulse), t * 0.55f, c, style = Stroke(t * 0.05f))
        drawCircle(Brush.radialGradient(listOf(Color(0x664FC3F7), Color.Transparent), c, t), t, c)
    }

    // Soft shadows cast by walls to the north and west.
    if (d.tile(x, y - 1) == WALL) {
        drawRect(
            Brush.verticalGradient(listOf(Color.Black.copy(alpha = 0.6f), Color.Transparent), startY = top, endY = top + t * 0.5f),
            Offset(left, top), Size(t + 1f, t * 0.5f),
        )
    }
    if (d.tile(x - 1, y) == WALL) {
        drawRect(
            Brush.horizontalGradient(listOf(Color.Black.copy(alpha = 0.35f), Color.Transparent), startX = left, endX = left + t * 0.3f),
            Offset(left, top), Size(t * 0.3f, t + 1f),
        )
    }
}

private fun DrawScope.drawWallTile(d: Dungeon, x: Int, y: Int, cam: Camera, time: Float) {
    val t = cam.t
    val left = cam.sx(x.toFloat())
    val top = cam.sy(y.toFloat())
    val h = t * WALL_HEIGHT
    val frontVisible = d.tile(x, y + 1) != WALL
    val nearFloor = frontVisible || d.tile(x, y - 1) != WALL || d.tile(x - 1, y) != WALL || d.tile(x + 1, y) != WALL
    val v = d.variant[y * d.w + x]

    // Top surface.
    val topColor = if (nearFloor) lerp(Color(0xFF2A2521), Color(0xFF332D27), v) else Color(0xFF0E0C0B)
    drawRect(topColor, Offset(left, top - h), Size(t + 1f, t + 1f))
    if (!frontVisible) return

    // Front face: courses of irregular stone blocks.
    val faceTop = top - h + t
    drawRect(Color(0xFF1E1A17), Offset(left, faceTop), Size(t + 1f, h + 1f))
    val rows = 3
    val rowH = h / rows
    for (r in 0 until rows) {
        val shift = if ((r + y) % 2 == 0) 0f else t * 0.25f
        var bx = left - shift
        var k = 0
        while (bx < left + t) {
            val bw = t * 0.5f
            val sx = max(bx, left)
            val ex = min(bx + bw, left + t)
            if (ex - sx > 1f) {
                val vv = frac(v * (5.1f + r * 2.3f + k * 1.7f))
                val c = lerp(Color(0xFF5B4F45), Color(0xFF75665A), vv)
                val by = faceTop + r * rowH
                drawRoundRect(c, Offset(sx + t * 0.02f, by + t * 0.02f), Size(ex - sx - t * 0.04f, rowH - t * 0.04f), CornerRadius(t * 0.025f))
                drawRect(c.lighter(0.12f), Offset(sx + t * 0.03f, by + t * 0.025f), Size(ex - sx - t * 0.06f, t * 0.02f))
            }
            bx += bw
            k++
        }
    }
    // Ambient occlusion towards the floor and a rim along the top edge.
    drawRect(
        Brush.verticalGradient(listOf(Color.Transparent, Color.Black.copy(alpha = 0.55f)), startY = faceTop, endY = faceTop + h),
        Offset(left, faceTop), Size(t + 1f, h),
    )
    drawRect(Color(0xFF4A423A), Offset(left, faceTop - t * 0.03f), Size(t + 1f, t * 0.04f))

    if (y * d.w + x in d.torches) {
        val cx = left + t / 2f
        val cy = faceTop + h * 0.45f
        drawRect(Color(0xFF2B2018), Offset(cx - t * 0.04f, cy), Size(t * 0.08f, h * 0.35f))
        drawRect(Color(0xFF4E3A28), Offset(cx - t * 0.08f, cy - t * 0.02f), Size(t * 0.16f, t * 0.05f))
        val f = flicker(time, (x * 31 + y).toFloat())
        val flameH = t * 0.3f * f
        val flameW = t * 0.16f * (2f - f)
        drawCircle(Brush.radialGradient(listOf(Color(0x99FF8F00), Color.Transparent), Offset(cx, cy - flameH * 0.5f), t * 0.5f), t * 0.5f, Offset(cx, cy - flameH * 0.5f))
        drawOval(Color(0xFFFF6D00), Offset(cx - flameW / 2f, cy - flameH), Size(flameW, flameH))
        drawOval(Color(0xFFFFC400), Offset(cx - flameW * 0.3f, cy - flameH * 0.75f), Size(flameW * 0.6f, flameH * 0.65f))
        drawOval(Color(0xFFFFF8E1), Offset(cx - flameW * 0.15f, cy - flameH * 0.45f), Size(flameW * 0.3f, flameH * 0.35f))
    }
}

// ---------------------------------------------------------------- loot

private fun DrawScope.drawLoot(l: Loot, cam: Camera, time: Float, measurer: TextMeasurer, styles: TextStyles) {
    val t = cam.t
    val bob = sin(time * 3f + l.phase) * t * 0.04f
    val cx = cam.sx(l.x)
    val cy = cam.sy(l.y)
    drawOval(Color.Black.copy(alpha = 0.4f), Offset(cx - t * 0.18f, cy - t * 0.04f), Size(t * 0.36f, t * 0.12f))
    when (val k = l.kind) {
        is LootKind.Gold -> {
            for ((i, o) in listOf(Offset(-0.08f, 0f), Offset(0.08f, 0.02f), Offset(0f, -0.07f)).withIndex()) {
                val c = Offset(cx + o.x * t, cy + o.y * t - t * 0.08f + bob * (i % 2))
                drawCircle(Color(0xFF8D6E00), t * 0.085f, c)
                drawCircle(Color(0xFFFFC107), t * 0.07f, c)
                drawCircle(Color(0xFFFFF59D), t * 0.025f, Offset(c.x - t * 0.02f, c.y - t * 0.02f))
            }
        }
        LootKind.Potion -> {
            val c = Offset(cx, cy - t * 0.15f + bob)
            drawCircle(Color(0xFFB71C1C), t * 0.11f, c)
            drawCircle(Color(0xFFFF5252), t * 0.07f, Offset(c.x - t * 0.02f, c.y + t * 0.01f))
            drawRect(Color(0xFFB0BEC5), Offset(c.x - t * 0.03f, c.y - t * 0.17f), Size(t * 0.06f, t * 0.08f))
            drawRect(Color(0xFF6D4C41), Offset(c.x - t * 0.035f, c.y - t * 0.2f), Size(t * 0.07f, t * 0.04f))
            drawCircle(Color.White.copy(alpha = 0.6f), t * 0.025f, Offset(c.x - t * 0.04f, c.y - t * 0.04f))
        }
        is LootKind.Gear -> {
            val item = k.item
            val rc = item.rarity.color
            if (item.rarity >= Rarity.RARE) {
                // Pillar of light, like the good drops in the games you know.
                drawRect(
                    Brush.verticalGradient(listOf(Color.Transparent, rc.copy(alpha = 0.45f)), startY = cy - t * 2.2f, endY = cy),
                    Offset(cx - t * 0.06f, cy - t * 2.2f), Size(t * 0.12f, t * 2.2f),
                )
            }
            drawCircle(Brush.radialGradient(listOf(rc.copy(alpha = 0.5f), Color.Transparent), Offset(cx, cy - t * 0.1f), t * 0.45f), t * 0.45f, Offset(cx, cy - t * 0.1f))
            val c = Offset(cx, cy - t * 0.15f + bob)
            when (item.slot) {
                Slot.WEAPON -> {
                    drawLine(Color(0xFFCFD8DC), Offset(c.x - t * 0.18f, c.y + t * 0.12f), Offset(c.x + t * 0.16f, c.y - t * 0.18f), t * 0.06f, StrokeCap.Round)
                    drawLine(GOLD, Offset(c.x - t * 0.16f, c.y - t * 0.0f), Offset(c.x - t * 0.02f, c.y + t * 0.14f), t * 0.05f, StrokeCap.Round)
                    drawLine(Color(0xFF5D4037), Offset(c.x - t * 0.18f, c.y + t * 0.12f), Offset(c.x - t * 0.25f, c.y + t * 0.19f), t * 0.05f, StrokeCap.Round)
                }
                Slot.ARMOR -> {
                    drawRoundRect(Color(0xFF78909C), Offset(c.x - t * 0.15f, c.y - t * 0.15f), Size(t * 0.3f, t * 0.3f), CornerRadius(t * 0.08f))
                    drawRoundRect(rc.copy(alpha = 0.6f), Offset(c.x - t * 0.06f, c.y - t * 0.12f), Size(t * 0.12f, t * 0.24f), CornerRadius(t * 0.04f))
                }
                Slot.RING -> {
                    drawCircle(GOLD, t * 0.11f, c, style = Stroke(t * 0.045f))
                    drawCircle(rc, t * 0.05f, Offset(c.x, c.y - t * 0.11f))
                }
            }
            val label = l.label ?: measurer.measure(item.name, styles.label).also { l.label = it }
            val lx = cx - label.size.width / 2f
            val ly = cy - t * 0.62f - label.size.height
            drawRoundRect(Color.Black.copy(alpha = 0.6f), Offset(lx - 6f, ly - 2f), Size(label.size.width + 12f, label.size.height + 4f), CornerRadius(6f))
            drawText(label, color = rc, topLeft = Offset(lx, ly))
        }
    }
}

// ---------------------------------------------------------------- characters

private fun DrawScope.shadow(cx: Float, cy: Float, w: Float, alpha: Float = 0.45f) {
    drawOval(Color.Black.copy(alpha = alpha), Offset(cx - w / 2f, cy - w * 0.18f), Size(w, w * 0.36f))
}

private fun DrawScope.drawPlayer(g: Game, cam: Camera) {
    val p = g.player
    val t = cam.t
    val cx = cam.sx(p.x)
    val cy = cam.sy(p.y)
    val bob = if (p.moving) abs(sin(p.walk)) * t * 0.03f else 0f
    val face = atan2(p.faceY, p.faceX)
    val perpX = -p.faceY
    val perpY = p.faceX

    shadow(cx, cy, t * 0.62f)

    if (g.levelFlash > 0f) {
        val k = 1f - g.levelFlash / 1.2f
        drawCircle(GOLD.copy(alpha = 1f - k), t * (0.4f + k * 1.6f), Offset(cx, cy), style = Stroke(t * 0.08f))
    }

    // Feet.
    val stride = if (p.moving) sin(p.walk) * t * 0.1f else 0f
    drawCircle(Color(0xFF2B1D14), t * 0.075f, Offset(cx + perpX * t * 0.1f + p.faceX * stride, cy + perpY * t * 0.1f + p.faceY * stride))
    drawCircle(Color(0xFF2B1D14), t * 0.075f, Offset(cx - perpX * t * 0.1f - p.faceX * stride, cy - perpY * t * 0.1f - p.faceY * stride))

    val body = Offset(cx, cy - t * 0.28f - bob)

    // Sword angle: resting at the side, sweeping during a swing, spinning in a whirlwind.
    val swordAngle = when {
        p.whirl > 0f -> face + (1f - p.whirl / 0.45f) * 2f * PI.toFloat() * 1.5f
        p.swing > 0f -> face - 1.2f + (1f - p.swing / 0.25f) * 2.4f
        else -> face + 0.9f
    }
    val swordBehind = p.faceY < -0.2f && p.swing <= 0f && p.whirl <= 0f
    if (swordBehind) drawSword(body, swordAngle, t)

    if (p.swing > 0f || p.whirl > 0f) {
        val r = t * 0.75f
        val (start, sweep) = if (p.whirl > 0f) 0f to 360f else
            Math.toDegrees((face - 1.2f).toDouble()).toFloat() to Math.toDegrees(((1f - p.swing / 0.25f) * 2.4f).toDouble()).toFloat()
        drawArc(
            Color.White.copy(alpha = 0.35f), start, sweep, useCenter = false,
            topLeft = Offset(body.x - r, body.y - r), size = Size(r * 2f, r * 2f), style = Stroke(t * 0.14f, cap = StrokeCap.Round),
        )
    }

    // Cloak and armour.
    drawCircle(
        Brush.radialGradient(listOf(Color(0xFF9E2B2B), Color(0xFF3E0F0F)), Offset(body.x - t * 0.08f, body.y - t * 0.08f), t * 0.38f),
        t * 0.27f, body,
    )
    drawCircle(Color(0xFF263238), t * 0.18f, Offset(body.x + p.faceX * t * 0.04f, body.y + p.faceY * t * 0.04f))
    for (s in listOf(1f, -1f)) {
        val sh = Offset(body.x + perpX * t * 0.2f * s, body.y + perpY * t * 0.2f * s - t * 0.02f)
        drawCircle(Brush.radialGradient(listOf(Color(0xFFB0BEC5), Color(0xFF455A64)), Offset(sh.x - t * 0.03f, sh.y - t * 0.03f), t * 0.12f), t * 0.1f, sh)
    }
    // Helmet.
    val head = Offset(body.x + p.faceX * t * 0.05f, body.y - t * 0.12f + p.faceY * t * 0.04f)
    drawCircle(Brush.radialGradient(listOf(Color(0xFF90A4AE), Color(0xFF37474F)), Offset(head.x - t * 0.04f, head.y - t * 0.05f), t * 0.18f), t * 0.13f, head)
    if (p.faceY > -0.3f) {
        drawLine(Color(0xFF101418), Offset(head.x - perpX * t * 0.07f + p.faceX * t * 0.06f, head.y - perpY * t * 0.07f + p.faceY * t * 0.06f + t * 0.02f),
            Offset(head.x + perpX * t * 0.07f + p.faceX * t * 0.06f, head.y + perpY * t * 0.07f + p.faceY * t * 0.06f + t * 0.02f), t * 0.03f)
    }

    if (!swordBehind) drawSword(body, swordAngle, t)

    if (p.hurt > 0f) drawCircle(Color.Red.copy(alpha = p.hurt * 1.5f), t * 0.3f, body)
}

private fun DrawScope.drawSword(body: Offset, angle: Float, t: Float) {
    val dx = cos(angle)
    val dy = sin(angle)
    val hand = Offset(body.x + dx * t * 0.24f, body.y + dy * t * 0.24f)
    val tip = Offset(hand.x + dx * t * 0.62f, hand.y + dy * t * 0.62f)
    drawLine(Color(0xFF8D99A6), hand, tip, t * 0.075f, StrokeCap.Round)
    drawLine(Color(0xFFE8EEF3), Offset(hand.x - dy * t * 0.012f, hand.y + dx * t * 0.012f), Offset(tip.x - dy * t * 0.012f, tip.y + dx * t * 0.012f), t * 0.025f, StrokeCap.Round)
    drawLine(GOLD, Offset(hand.x - dy * t * 0.1f, hand.y + dx * t * 0.1f), Offset(hand.x + dy * t * 0.1f, hand.y - dx * t * 0.1f), t * 0.05f, StrokeCap.Round)
    drawLine(Color(0xFF4E342E), hand, Offset(hand.x - dx * t * 0.12f, hand.y - dy * t * 0.12f), t * 0.055f, StrokeCap.Round)
}

private fun DrawScope.drawEnemy(e: Enemy, g: Game, cam: Camera) {
    val t = cam.t
    val cx = cam.sx(e.x)
    val cy = cam.sy(e.y)
    val r = e.type.radius * t
    val toPlayer = atan2(g.player.y - e.y, g.player.x - e.x)

    // Red telegraph circle while winding up an attack.
    if (e.windup > 0f) {
        val k = 1f - e.windup / e.type.windup
        val reach = (e.type.range + 0.2f) * t
        drawCircle(Color.Red.copy(alpha = 0.12f + 0.15f * k), reach * k, Offset(cx, cy))
        drawCircle(Color.Red.copy(alpha = 0.35f + 0.4f * k), reach * k, Offset(cx, cy), style = Stroke(t * 0.04f))
    }

    when (e.type) {
        EnemyType.SLIME -> {
            shadow(cx, cy, r * 2.2f)
            val s = 1f + 0.1f * sin(e.anim * 5f + e.phase)
            val w = r * 2.2f * s
            val h = r * 1.8f / s
            val top = Offset(cx - w / 2f, cy - h + r * 0.15f)
            drawOval(
                Brush.radialGradient(listOf(Color(0xFF9CFF8A), Color(0xFF1E7A2E)), Offset(cx - w * 0.15f, top.y + h * 0.3f), w * 0.7f),
                top, Size(w, h), alpha = 0.9f,
            )
            drawOval(Color.White.copy(alpha = 0.5f), Offset(cx - w * 0.3f, top.y + h * 0.15f), Size(w * 0.25f, h * 0.15f))
            drawCircle(Color(0xFF0B2E12), r * 0.12f, Offset(cx - r * 0.3f, top.y + h * 0.5f))
            drawCircle(Color(0xFF0B2E12), r * 0.12f, Offset(cx + r * 0.3f, top.y + h * 0.5f))
        }
        EnemyType.BAT -> {
            shadow(cx, cy, r * 1.6f, 0.3f)
            val hover = Offset(cx, cy - t * 0.55f + sin(e.anim * 4f + e.phase) * t * 0.06f)
            val flap = sin(e.anim * 18f + e.phase)
            val span = r * (1.6f + 0.6f * abs(flap))
            for (s in listOf(1f, -1f)) {
                val wing = Path().apply {
                    moveTo(hover.x, hover.y)
                    lineTo(hover.x + s * span, hover.y - r * 0.6f * flap)
                    lineTo(hover.x + s * span * 0.7f, hover.y + r * 0.3f)
                    lineTo(hover.x + s * span * 0.4f, hover.y + r * 0.1f)
                    close()
                }
                drawPath(wing, Color(0xFF2A1F33))
            }
            drawCircle(Color(0xFF3B2E45), r * 0.55f, hover)
            drawCircle(Color(0xFFFF1744), r * 0.12f, Offset(hover.x - r * 0.2f, hover.y - r * 0.1f))
            drawCircle(Color(0xFFFF1744), r * 0.12f, Offset(hover.x + r * 0.2f, hover.y - r * 0.1f))
        }
        EnemyType.SKELETON -> {
            shadow(cx, cy, r * 2f)
            val bone = Color(0xFFE6DFCB)
            val body = Offset(cx, cy - r * 1.1f)
            drawOval(Color(0xFFBDB49C), Offset(body.x - r * 0.55f, body.y - r * 0.4f), Size(r * 1.1f, r * 1.2f))
            for (i in 0..2) {
                val yy = body.y - r * 0.15f + i * r * 0.28f
                drawLine(Color(0xFF5D5446), Offset(body.x - r * 0.4f, yy), Offset(body.x + r * 0.4f, yy), r * 0.08f)
            }
            val sx = cos(toPlayer)
            val sy = sin(toPlayer)
            val hand = Offset(body.x + sx * r * 0.7f, body.y + sy * r * 0.5f)
            drawLine(Color(0xFF8D6E63), hand, Offset(hand.x + sx * r * 1.6f, hand.y + sy * r * 1.6f), r * 0.16f, StrokeCap.Round)
            val skull = Offset(body.x, body.y - r * 0.8f)
            drawCircle(bone, r * 0.5f, skull)
            drawCircle(Color.Black, r * 0.13f, Offset(skull.x - r * 0.18f, skull.y))
            drawCircle(Color.Black, r * 0.13f, Offset(skull.x + r * 0.18f, skull.y))
            drawCircle(Color(0xFFFF6E40).copy(alpha = 0.8f), r * 0.05f, Offset(skull.x - r * 0.18f, skull.y))
            drawCircle(Color(0xFFFF6E40).copy(alpha = 0.8f), r * 0.05f, Offset(skull.x + r * 0.18f, skull.y))
            drawLine(Color(0xFF5D5446), Offset(skull.x - r * 0.15f, skull.y + r * 0.3f), Offset(skull.x + r * 0.15f, skull.y + r * 0.3f), r * 0.06f)
        }
        EnemyType.BRUTE -> {
            shadow(cx, cy, r * 2.2f)
            val body = Offset(cx, cy - r * 0.9f)
            val sx = cos(toPlayer)
            val sy = sin(toPlayer)
            val hand = Offset(body.x + sx * r * 0.9f, body.y + sy * r * 0.6f)
            drawLine(Color(0xFF5D4037), hand, Offset(hand.x + sx * r * 1.4f, hand.y + sy * r * 1.4f), r * 0.3f, StrokeCap.Round)
            drawCircle(Color(0xFF3E2723), r * 0.28f, Offset(hand.x + sx * r * 1.4f, hand.y + sy * r * 1.4f))
            drawCircle(
                Brush.radialGradient(listOf(Color(0xFF7C9A5A), Color(0xFF2E4220)), Offset(body.x - r * 0.3f, body.y - r * 0.3f), r * 1.3f),
                r, body,
            )
            drawRect(Color(0xFF4E342E), Offset(body.x - r * 0.9f, body.y + r * 0.2f), Size(r * 1.8f, r * 0.22f))
            val head = Offset(body.x, body.y - r * 0.75f)
            drawCircle(Color(0xFF6B8A4B), r * 0.42f, head)
            drawCircle(Color(0xFFFFEB3B), r * 0.07f, Offset(head.x - r * 0.15f, head.y - r * 0.05f))
            drawCircle(Color(0xFFFFEB3B), r * 0.07f, Offset(head.x + r * 0.15f, head.y - r * 0.05f))
            drawLine(Color(0xFFF5F5DC), Offset(head.x - r * 0.18f, head.y + r * 0.2f), Offset(head.x - r * 0.22f, head.y + r * 0.02f), r * 0.08f, StrokeCap.Round)
            drawLine(Color(0xFFF5F5DC), Offset(head.x + r * 0.18f, head.y + r * 0.2f), Offset(head.x + r * 0.22f, head.y + r * 0.02f), r * 0.08f, StrokeCap.Round)
        }
        EnemyType.BOSS -> {
            val pulse = 0.5f + 0.5f * sin(e.anim * 3f)
            drawCircle(
                Brush.radialGradient(listOf(Color(0x88FF1744), Color.Transparent), Offset(cx, cy), r * (2f + pulse * 0.4f)),
                r * (2f + pulse * 0.4f), Offset(cx, cy),
            )
            shadow(cx, cy, r * 2.2f, 0.6f)
            val body = Offset(cx, cy - r * 0.9f)
            for (s in listOf(1f, -1f)) {
                val wing = Path().apply {
                    moveTo(body.x + s * r * 0.5f, body.y - r * 0.2f)
                    lineTo(body.x + s * r * 2f, body.y - r * 1.2f)
                    lineTo(body.x + s * r * 1.7f, body.y + r * 0.1f)
                    lineTo(body.x + s * r * 1.2f, body.y - r * 0.1f)
                    close()
                }
                drawPath(wing, Color(0xFF3E0A0A))
            }
            drawCircle(
                Brush.radialGradient(listOf(Color(0xFFD32F2F), Color(0xFF3E0A0A)), Offset(body.x - r * 0.3f, body.y - r * 0.3f), r * 1.4f),
                r, body,
            )
            val head = Offset(body.x, body.y - r * 0.8f)
            drawCircle(Color(0xFF8E1B1B), r * 0.45f, head)
            for (s in listOf(1f, -1f)) {
                val horn = Path().apply {
                    moveTo(head.x + s * r * 0.2f, head.y - r * 0.3f)
                    lineTo(head.x + s * r * 0.75f, head.y - r * 1.0f)
                    lineTo(head.x + s * r * 0.42f, head.y - r * 0.2f)
                    close()
                }
                drawPath(horn, Color(0xFFE0D6C2))
            }
            drawCircle(Color(0xFFFFEA00), r * 0.09f, Offset(head.x - r * 0.17f, head.y))
            drawCircle(Color(0xFFFFEA00), r * 0.09f, Offset(head.x + r * 0.17f, head.y))
            drawCircle(Color(0x66FFEA00), r * 0.2f, Offset(head.x - r * 0.17f, head.y))
            drawCircle(Color(0x66FFEA00), r * 0.2f, Offset(head.x + r * 0.17f, head.y))
        }
    }

    if (e.flash > 0f) drawCircle(Color.White.copy(alpha = e.flash / 0.12f * 0.7f), r * 1.1f, Offset(cx, cy - r))

    if (e.hp < e.maxHp && e.type != EnemyType.BOSS) {
        val w = t * 0.8f
        val top = cy - r * 2.6f - t * 0.2f
        drawRect(Color.Black.copy(alpha = 0.7f), Offset(cx - w / 2f - 2f, top - 2f), Size(w + 4f, t * 0.08f + 4f))
        drawRect(Color(0xFFD32F2F), Offset(cx - w / 2f, top), Size(w * (e.hp / e.maxHp).coerceIn(0f, 1f), t * 0.08f))
    }
}

// ---------------------------------------------------------------- lighting

/** Darkness with light holes punched out; drawn into an offscreen layer. */
fun DrawScope.drawLighting(g: Game) {
    val cam = cameraFor(g)
    val t = cam.t
    val d = g.dungeon
    drawRect(Color.Black.copy(alpha = 0.94f))

    fun light(x: Float, y: Float, radius: Float, strength: Float) {
        val c = Offset(cam.sx(x), cam.sy(y))
        if (c.x < -radius || c.y < -radius || c.x > size.width + radius || c.y > size.height + radius) return
        drawCircle(
            Brush.radialGradient(
                0f to Color.Black.copy(alpha = strength),
                0.5f to Color.Black.copy(alpha = strength * 0.75f),
                1f to Color.Transparent,
                center = c,
                radius = radius,
            ),
            radius, c, blendMode = BlendMode.DstOut,
        )
    }

    val p = g.player
    light(p.x, p.y - 0.3f, t * 5.4f * flicker(g.time, 0.3f), 1f)
    for (i in d.torches) light(i % d.w + 0.5f, i / d.w + 1f - WALL_HEIGHT * 0.4f, t * 3.6f * flicker(g.time, i.toFloat()), 0.95f)
    for (pr in g.projectiles) light(pr.x, pr.y, t * 2.4f, 0.85f)
    light(d.exit.cx + 0.5f, d.exit.cy + 0.5f, t * 2.2f, 0.75f)
    for (l in g.loot) {
        val k = l.kind
        if (k is LootKind.Gear && k.item.rarity >= Rarity.RARE) light(l.x, l.y, t * 1.3f, 0.6f)
    }
    g.boss?.let { light(it.x, it.y - 0.5f, t * 2.5f, 0.6f) }

    // Vignette and red flash when hurt.
    drawRect(
        Brush.radialGradient(
            listOf(Color.Transparent, Color.Black.copy(alpha = 0.6f)),
            center = Offset(size.width / 2f, size.height * 0.45f),
            radius = size.maxDimension * 0.75f,
        )
    )
    if (p.hurt > 0f) {
        drawRect(
            Brush.radialGradient(
                listOf(Color.Transparent, Color(0xFFB71C1C).copy(alpha = p.hurt * 1.6f)),
                center = Offset(size.width / 2f, size.height / 2f),
                radius = size.maxDimension * 0.7f,
            )
        )
    }
}
