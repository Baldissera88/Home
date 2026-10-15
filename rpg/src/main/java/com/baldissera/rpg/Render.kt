package com.baldissera.rpg

import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.BlendMode
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.graphics.ColorMatrix
import androidx.compose.ui.graphics.FilterQuality
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.graphics.drawscope.withTransform
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.text.TextMeasurer
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.drawText
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.IntSize
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.atan2
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt
import kotlin.math.sin

/** Tiles visible across the screen width. */
private const val TILES_ACROSS = 7f
private const val WALL_HEIGHT = 0.75f
/** Characters are drawn a little larger than their model scale so they read well on a phone. */
private const val CHAR_SCALE = 1.3f

class Camera(val ox: Float, val oy: Float, val t: Float) {
    fun sx(x: Float) = x * t - ox
    fun sy(y: Float) = y * t - oy
    fun px(x: Float) = (x * t - ox).roundToInt()
    fun py(y: Float) = (y * t - oy).roundToInt()
}

fun DrawScope.cameraFor(g: Game): Camera {
    val t = size.width / TILES_ACROSS
    return Camera((g.camX + g.shakeX) * t - size.width / 2f, (g.camY + g.shakeY) * t - size.height * 0.48f, t)
}

class TextStyles(val small: TextStyle, val big: TextStyle, val label: TextStyle)

private fun Color.lighter(f: Float) = lerp(this, Color.White, f)

private fun flicker(time: Float, seed: Float) =
    0.88f + 0.07f * sin(time * 11f + seed * 7f) + 0.05f * sin(time * 23f + seed * 3f)

private val grayscale = ColorFilter.colorMatrix(ColorMatrix().apply { setToSaturation(0.15f) })
private val frozenTint = ColorFilter.tint(Color(0xFF9FD8FF), BlendMode.Modulate)
private val queenTint = ColorFilter.tint(Color(0xFFC9A0FF), BlendMode.Modulate)
private val shadowTint = ColorFilter.tint(Color(0xFF8E7CC3), BlendMode.Modulate)
private val trollTint = ColorFilter.tint(Color(0xFFA5D6A7), BlendMode.Modulate)
private val ghostEnemyTint = ColorFilter.tint(Color(0xFFB3E5FC), BlendMode.Modulate)
private val whiteFlash = ColorFilter.tint(Color.White, BlendMode.SrcAtop)
private val redFlash = ColorFilter.tint(Color(0xFFFF1744), BlendMode.SrcAtop)
private val corpseTint = ColorFilter.tint(Color(0xFF5A4A44), BlendMode.Modulate)
private val ghostTint = ColorFilter.tint(Color(0xFF90CAF9), BlendMode.SrcAtop)

/** Row in a directional sheet for a facing vector (x right, y down/south). */
fun dirRow(fx: Float, fy: Float): Int {
    val a = atan2(fx, fy)
    val i = (a / (PI / 4)).roundToInt()
    return ((i % 8) + 8) % 8
}

fun DrawScope.drawSprite(
    s: SpriteSheet, col: Int, row: Int, x: Float, y: Float, t: Float,
    scale: Float = 1f, alpha: Float = 1f, filter: ColorFilter? = null, squash: Float = 1f,
) {
    val w = s.worldW * t * scale
    val left = (x - w / 2f).roundToInt()
    val h = w * squash
    val top = (y - s.foot * h).roundToInt()
    drawImage(
        s.image, IntOffset(col * s.cell, row * s.cell), IntSize(s.cell, s.cell),
        IntOffset(left, top), IntSize(w.roundToInt(), h.roundToInt()), alpha = alpha, colorFilter = filter, filterQuality = FilterQuality.Medium,
    )
}

// ---------------------------------------------------------------- world

private sealed interface Billboard {
    val y: Float
}

private class PlayerBB(override val y: Float) : Billboard
private class EnemyBB(val e: Enemy) : Billboard {
    override val y = e.y
}
private class PropBB(val p: Prop) : Billboard {
    override val y = p.y
}
private class MerchantBB(override val y: Float) : Billboard
private class NpcBB(val n: Npc) : Billboard {
    override val y = n.y
}

fun DrawScope.drawWorld(g: Game, a: Assets, measurer: TextMeasurer, styles: TextStyles) {
    val cam = cameraFor(g)
    val t = cam.t
    val d = g.dungeon
    drawRect(Color(0xFF050404))

    val x0 = max(0, floorInt(cam.ox / t) - 1)
    val x1 = min(d.w - 1, floorInt((cam.ox + size.width) / t) + 1)
    val y0 = max(0, floorInt(cam.oy / t) - 1)
    val y1 = min(d.h - 1, floorInt((cam.oy + size.height) / t) + 2)

    // Floor: dungeon flagstones, or grass, paths, sand and water outside.
    val floorImg = a.floor(d.biome)
    val ground = d.ground
    val waterFrame = (g.time * 1.2f).toInt() % 2
    for (y in y0..y1) for (x in x0..x1) {
        val tile = d.tile(x, y)
        if (tile == WALL) continue
        val l = cam.px(x.toFloat())
        val tp = cam.py(y.toFloat())
        val sz = IntSize(cam.px(x + 1f) - l, cam.py(y + 1f) - tp)
        val i = y * d.w + x
        if (tile == WATER) {
            drawImage(a.water, IntOffset(waterFrame * 128, 0), IntSize(128, 128), IntOffset(l, tp), sz, filterQuality = FilterQuality.Medium)
            if (d.tile(x, y - 1) != WATER) {
                drawRect(
                    Brush.verticalGradient(listOf(Color(0x88000000), Color.Transparent), startY = tp.toFloat(), endY = tp + t * 0.3f),
                    Offset(l.toFloat(), tp.toFloat()), Size(sz.width.toFloat(), t * 0.3f),
                )
            }
            continue
        }
        if (ground != null) {
            drawImage(a.ground, IntOffset(ground[i] * 128, 0), IntSize(128, 128), IntOffset(l, tp), sz, filterQuality = FilterQuality.Medium)
        } else {
            // Dungeon floors are one large texture covering 4x4 tiles, sampled by position.
            drawImage(floorImg, IntOffset((x and 3) * 128, (y and 3) * 128), IntSize(128, 128), IntOffset(l, tp), sz, filterQuality = FilterQuality.Medium)
        }
        if (tile == TREE || tile == ROCK) {
            drawOval(Color.Black.copy(alpha = 0.35f), Offset(l + t * 0.08f, tp + t * 0.5f), Size(t * 0.84f, t * 0.42f))
        }
        if (tile == STAIRS) drawStairs(l.toFloat(), tp.toFloat(), t, g.time)
        if (d.tile(x, y - 1) == WALL) {
            drawRect(
                Brush.verticalGradient(listOf(Color.Black.copy(alpha = 0.65f), Color.Transparent), startY = tp.toFloat(), endY = tp + t * 0.55f),
                Offset(l.toFloat(), tp.toFloat()), Size(sz.width.toFloat(), t * 0.55f),
            )
        }
        if (d.tile(x - 1, y) == WALL) {
            drawRect(
                Brush.horizontalGradient(listOf(Color.Black.copy(alpha = 0.4f), Color.Transparent), startX = l.toFloat(), endX = l + t * 0.3f),
                Offset(l.toFloat(), tp.toFloat()), Size(t * 0.3f, sz.height.toFloat()),
            )
        }
    }

    // Decals: blood and scorch marks.
    for (dc in g.decals) {
        val cx = cam.sx(dc.x)
        val cy = cam.sy(dc.y)
        if (cx < -t * 2 || cy < -t * 2 || cx > size.width + t * 2 || cy > size.height + t * 2) continue
        val s = (t * 1.1f * dc.scale).roundToInt()
        rotate(dc.rotation, Offset(cx, cy)) {
            drawImage(a.decals, IntOffset(dc.kind * 128, 0), IntSize(128, 128), IntOffset(cx.roundToInt() - s / 2, cy.roundToInt() - s / 2), IntSize(s, s))
        }
    }

    // Fallen enemies collapse and fade.
    for (c in g.corpses) {
        val (sheet, scale0, directional) = a.enemySprite(c.type)
        val k = c.age / 1.2f
        drawSprite(
            sheet, 0, if (directional) dirRow(c.faceX, c.faceY) else 0, cam.sx(c.x), cam.sy(c.y), t,
            scale = scale0 * c.size * CHAR_SCALE, alpha = (1f - k).coerceIn(0f, 1f) * 0.85f, filter = corpseTint,
            squash = (1f - k * 0.7f).coerceAtLeast(0.2f),
        )
    }

    // Billboards sorted by depth.
    val bbs = ArrayList<Billboard>(g.enemies.size + d.props.size + 2)
    bbs += PlayerBB(g.player.y)
    for (e in g.enemies) if (e.y > y0 - 2 && e.y < y1 + 3) bbs += EnemyBB(e)
    for (p in d.props) if (p.y > y0 - 2 && p.y < y1 + 3) bbs += PropBB(p)
    if (d.hasMerchant) bbs += MerchantBB(g.merchantY)
    for (n in d.npcs) if (n.y > y0 - 2 && n.y < y1 + 3) bbs += NpcBB(n)
    bbs.sortBy { it.y }

    // Contact shadows go under everything.
    for (b in bbs) {
        val (sx, sy, r) = when (b) {
            is PlayerBB -> Triple(g.player.x, g.player.y, 0.32f)
            is EnemyBB -> Triple(b.e.x, b.e.y, b.e.type.radius * b.e.size * (if (b.e.type.boss) 1.4f else 1.1f))
            is PropBB -> Triple(b.p.x, b.p.y, if (b.p.type == PropType.SKULLS) 0f else 0.3f)
            is MerchantBB -> Triple(g.merchantX, g.merchantY, 0.3f)
            is NpcBB -> Triple(b.n.x, b.n.y, 0.28f)
        }
        if (r <= 0f) continue
        val cx = cam.sx(sx)
        val cy = cam.sy(sy)
        drawOval(Color.Black.copy(alpha = 0.45f), Offset(cx - r * t, cy - r * t * 0.4f), Size(r * t * 2f, r * t * 0.8f))
    }

    for (l in g.loot) {
        val dx = l.x - g.player.x
        val dy = l.y - g.player.y
        drawLoot(l, cam, g.time, a, measurer, styles, dx * dx + dy * dy < 6.25f)
    }

    // Rows: walls hide what stands behind them.
    var bi = 0
    val wallImg = a.wall(d.biome)
    val topImg = a.top(d.biome)
    fun drawBillboard(b: Billboard) {
        when (b) {
            is PlayerBB -> drawPlayer(g, cam, a)
            is EnemyBB -> drawEnemy(b.e, g, cam, a, measurer, styles)
            is PropBB -> drawProp(b.p, g, cam, a)
            is MerchantBB -> drawMerchant(g, cam, a, measurer, styles)
            is NpcBB -> drawNpc(b.n, g, cam, a, measurer, styles)
        }
    }
    for (y in y0..y1) {
        for (x in x0..x1) if (d.tile(x, y) == WALL) drawWallTile(d, x, y, cam, g.time, wallImg, topImg)
        while (bi < bbs.size && bbs[bi].y < y + 0.8f) drawBillboard(bbs[bi++])
        for (x in x0..x1) drawWorldTile(g, x, y, cam, a, measurer, styles)
        for (b in d.buildings) if (b.y + b.h - 1 == y) drawBuilding(b, g, cam, a)
        while (bi < bbs.size && bbs[bi].y < y + 1f) drawBillboard(bbs[bi++])
    }

    for (pr in g.projectiles) {
        val c = Offset(cam.sx(pr.x), cam.sy(pr.y) - t * 0.4f)
        val r = pr.radius * t
        drawCircle(Brush.radialGradient(listOf(pr.color.copy(alpha = 0.6f), Color.Transparent), c, r * 3.2f), r * 3.2f, c)
        drawCircle(pr.color.lighter(0.35f), r, c)
        drawCircle(Color.White.copy(alpha = 0.9f), r * 0.45f, c)
    }

    for (pt in g.particles) {
        val fade = 1f - pt.age / pt.life
        val c = Offset(cam.sx(pt.x), cam.sy(pt.y) - t * pt.z)
        val r = pt.size * t
        if (pt.glow) {
            drawCircle(pt.color.copy(alpha = 0.3f * fade), r * 2.5f, c)
            drawCircle(pt.color.lighter(0.5f).copy(alpha = fade), r, c)
        } else {
            drawCircle(pt.color.copy(alpha = pt.color.alpha * fade), r, c)
        }
    }

    drawFog(g, a, cam)
    if (g.rain > 0.02f) drawRain(g)

    // Coloured light spill on top of the scene.
    fun spill(x: Float, y: Float, radius: Float, color: Color) {
        val c = Offset(cam.sx(x), cam.sy(y))
        if (c.x < -radius || c.y < -radius || c.x > size.width + radius || c.y > size.height + radius) return
        drawCircle(Brush.radialGradient(listOf(color, Color.Transparent), c, radius), radius, c)
    }
    for (i in d.torches) {
        spill(i % d.w + 0.5f, i / d.w + 1f - WALL_HEIGHT * 0.4f, t * 3.2f * flicker(g.time, i.toFloat()), Color(0x40FF9A3C))
    }
    for (p in d.props) {
        when {
            p.type == PropType.CAMPFIRE -> spill(p.x, p.y - 0.3f, t * 5f * flicker(g.time, 1f), Color(0x55FF8F00))
            p.type == PropType.SHRINE && !p.used -> spill(p.x, p.y - 0.6f, t * 1.8f, Color(0x4000E5FF))
            p.type.light != 0L -> spill(p.x, p.y - 0.5f, t * 2.6f * flicker(g.time, p.x), Color(p.type.light))
        }
    }
    for (b in d.buildings) if (b.light != 0L) {
        spill(b.x + b.w / 2f + b.lightX, b.y + b.h + b.lightY - 0.5f, t * 2.2f * flicker(g.time, b.x.toFloat()), Color(b.light))
    }
    for (pr in g.projectiles) spill(pr.x, pr.y, t * 2f, pr.color.copy(alpha = 0.3f))
    for (e in d.entrances) if (e.region == Region.HELL) spill(e.x + 0.5f, e.y + 0.2f, t * 3f * flicker(g.time, 5f), Color(0x55FF3D00))

    for (ft in g.texts) {
        val layout = ft.layout ?: measurer.measure(ft.text, if (ft.big) styles.big else styles.small).also { ft.layout = it }
        val maxAge = if (ft.big) 1.3f else 1f
        val pop = if (ft.big) 1f + 0.6f * max(0f, 1f - ft.age * 6f) else 1f
        val center = Offset(cam.sx(ft.x), cam.sy(ft.y))
        withTransform({ scale(pop, pop, center) }) {
            drawText(
                layout, color = ft.color,
                topLeft = Offset(center.x - layout.size.width / 2f, center.y - layout.size.height / 2f),
                alpha = (1f - ft.age / maxAge).coerceIn(0f, 1f),
            )
        }
    }
}

private fun DrawScope.drawStairs(l: Float, tp: Float, t: Float, time: Float) {
    drawRect(Color(0xFF030202), Offset(l + t * 0.08f, tp + t * 0.08f), Size(t * 0.84f, t * 0.84f))
    for (s in 0..3) {
        val shade = lerp(Color(0xFF5A524A), Color(0xFF0E0C0A), s / 3f)
        drawRect(shade, Offset(l + t * 0.12f, tp + t * (0.12f + s * 0.2f)), Size(t * 0.76f, t * 0.15f))
        drawRect(shade.lighter(0.15f), Offset(l + t * 0.12f, tp + t * (0.12f + s * 0.2f)), Size(t * 0.76f, t * 0.02f))
    }
    val pulse = 0.5f + 0.5f * sin(time * 2.5f)
    val c = Offset(l + t / 2f, tp + t / 2f)
    drawCircle(Color(0xFF4FC3F7).copy(alpha = 0.25f + 0.35f * pulse), t * 0.55f, c, style = Stroke(t * 0.05f))
    drawCircle(Brush.radialGradient(listOf(Color(0x664FC3F7), Color.Transparent), c, t), t, c)
}

private fun DrawScope.drawWallTile(
    d: Dungeon, x: Int, y: Int, cam: Camera, time: Float,
    wallImg: androidx.compose.ui.graphics.ImageBitmap, topImg: androidx.compose.ui.graphics.ImageBitmap,
) {
    val t = cam.t
    val h = (t * WALL_HEIGHT).roundToInt()
    val l = cam.px(x.toFloat())
    val r = cam.px(x + 1f)
    val tp = cam.py(y.toFloat())
    val bt = cam.py(y + 1f)
    val frontVisible = d.tile(x, y + 1) != WALL
    val nearFloor = frontVisible || d.tile(x, y - 1) != WALL || d.tile(x - 1, y) != WALL || d.tile(x + 1, y) != WALL ||
        d.tile(x - 1, y + 1) != WALL || d.tile(x + 1, y + 1) != WALL

    if (nearFloor) {
        drawImage(topImg, IntOffset(0, 0), IntSize(128, 128), IntOffset(l, tp - h), IntSize(r - l, bt - tp), filterQuality = FilterQuality.Medium)
        if (d.tile(x, y - 1) != WALL) drawRect(Color.Black.copy(alpha = 0.5f), Offset(l.toFloat(), (tp - h).toFloat()), Size((r - l).toFloat(), t * 0.04f))
        if (d.tile(x - 1, y) != WALL) drawRect(Color.Black.copy(alpha = 0.35f), Offset(l.toFloat(), (tp - h).toFloat()), Size(t * 0.04f, (bt - tp).toFloat()))
        if (d.tile(x + 1, y) != WALL) drawRect(Color.Black.copy(alpha = 0.35f), Offset(r - t * 0.04f, (tp - h).toFloat()), Size(t * 0.04f, (bt - tp).toFloat()))
    } else {
        drawRect(Color(0xFF050404), Offset(l.toFloat(), (tp - h).toFloat()), Size((r - l).toFloat(), (bt - tp).toFloat()))
    }
    if (!frontVisible) return

    val variant = ((d.variant[y * d.w + x] * 2).toInt()).coerceIn(0, 1)
    drawImage(wallImg, IntOffset(variant * 128, 0), IntSize(128, 96), IntOffset(l, bt - h), IntSize(r - l, h), filterQuality = FilterQuality.Medium)
    drawRect(Color.White.copy(alpha = 0.08f), Offset(l.toFloat(), (bt - h).toFloat()), Size((r - l).toFloat(), t * 0.025f))

    if (y * d.w + x in d.torches) {
        val cx = (l + r) / 2f
        val cy = bt - h * 0.55f
        drawRect(Color(0xFF2B2018), Offset(cx - t * 0.035f, cy), Size(t * 0.07f, h * 0.32f))
        drawRect(Color(0xFF5D4632), Offset(cx - t * 0.08f, cy - t * 0.02f), Size(t * 0.16f, t * 0.05f))
        drawFlame(cx, cy, t * 0.3f, time, (x * 31 + y).toFloat())
    }
}

private fun DrawScope.drawFlame(cx: Float, cy: Float, size: Float, time: Float, seed: Float) {
    val f = flicker(time, seed)
    val fh = size * f
    val fw = size * 0.55f * (2f - f)
    drawCircle(Brush.radialGradient(listOf(Color(0x99FF8F00), Color.Transparent), Offset(cx, cy - fh * 0.5f), size * 1.7f), size * 1.7f, Offset(cx, cy - fh * 0.5f))
    drawOval(Color(0xFFFF6D00), Offset(cx - fw / 2f, cy - fh), Size(fw, fh))
    drawOval(Color(0xFFFFC400), Offset(cx - fw * 0.3f, cy - fh * 0.78f), Size(fw * 0.6f, fh * 0.68f))
    drawOval(Color(0xFFFFF8E1), Offset(cx - fw * 0.15f, cy - fh * 0.45f), Size(fw * 0.3f, fh * 0.35f))
}

// ---------------------------------------------------------------- billboards

private fun DrawScope.drawPlayer(g: Game, cam: Camera, a: Assets) {
    val p = g.player
    val t = cam.t
    val cx = cam.sx(p.x)
    val cy = cam.sy(p.y)

    p.buff?.let { b ->
        val pulse = 0.5f + 0.5f * sin(g.time * 4f)
        drawCircle(b.color.copy(alpha = 0.25f + 0.2f * pulse), t * 0.42f, Offset(cx, cy), style = Stroke(t * 0.05f))
    }
    if (g.levelFlash > 0f) {
        val k = 1f - g.levelFlash / 1.2f
        drawCircle(GOLD.copy(alpha = 1f - k), t * (0.4f + k * 1.8f), Offset(cx, cy - t * 0.3f), style = Stroke(t * 0.08f))
    }

    var row = dirRow(p.faceX, p.faceY)
    val col = when {
        p.whirl > 0f -> {
            row = (row + ((1f - p.whirl / 0.45f) * 16f).toInt()) % 8
            6
        }
        p.swing > 0f -> 5 + ((1f - p.swing / p.swingTime) * 3f).toInt().coerceIn(0, 2)
        p.cast > 0f -> 6
        p.moving -> 1 + (p.walk.toInt() % 4)
        else -> 0
    }

    if (p.swing > 0f || p.whirl > 0f) {
        val r = t * 0.8f
        val face = atan2(p.faceY, p.faceX)
        val body = Offset(cx, cy - t * 0.4f)
        val (start, sweep) = if (p.whirl > 0f) 0f to 360f else
            Math.toDegrees((face - 1.2).toDouble()).toFloat() to Math.toDegrees(((1f - p.swing / p.swingTime) * 2.4f).toDouble()).toFloat()
        drawArc(
            Color.White.copy(alpha = 0.3f), start, sweep, useCenter = false,
            topLeft = Offset(body.x - r, body.y - r * 0.6f), size = Size(r * 2f, r * 1.2f), style = Stroke(t * 0.12f, cap = StrokeCap.Round),
        )
    }

    for (gh in g.ghosts) {
        drawSprite(a.hero(gh.kind), 1, gh.row, cam.sx(gh.x), cam.sy(gh.y), t, scale = CHAR_SCALE, alpha = (1f - gh.age / 0.3f) * 0.35f, filter = ghostTint)
    }
    val sheet = a.hero(p.weaponKind)
    drawSprite(sheet, col, row, cx, cy, t, scale = CHAR_SCALE)
    if (p.hurt > 0f) drawSprite(sheet, col, row, cx, cy, t, scale = CHAR_SCALE, alpha = p.hurt * 2f, filter = redFlash)
}

private fun DrawScope.drawEnemy(e: Enemy, g: Game, cam: Camera, a: Assets, measurer: TextMeasurer, styles: TextStyles) {
    val t = cam.t
    val cx = cam.sx(e.x)
    val cy = cam.sy(e.y)
    if (cx < -t * 3 || cx > size.width + t * 3) return

    if (e.windup > 0f) {
        val k = 1f - e.windup / e.type.windup
        if (e.type.ranged) {
            drawCircle(Color(0xFFD500F9).copy(alpha = 0.5f * k), t * 0.25f * (1 + k), Offset(cx, cy - t * 0.9f))
        } else {
            val reach = (e.type.range * e.size + 0.2f) * t
            drawOval(Color.Red.copy(alpha = 0.12f + 0.15f * k), Offset(cx - reach * k, cy - reach * k * 0.6f), Size(reach * k * 2, reach * k * 1.2f))
            drawOval(Color.Red.copy(alpha = 0.35f + 0.4f * k), Offset(cx - reach * k, cy - reach * k * 0.6f), Size(reach * k * 2, reach * k * 1.2f), style = Stroke(t * 0.04f))
        }
    }
    if (e.elite || e.type.boss) {
        val color = if (e.type.boss) Color(0x66FF1744) else Color(0x664FC3F7)
        val pulse = 0.85f + 0.15f * sin(e.anim * 3f)
        val r = t * (if (e.type.boss) 1.6f else 0.7f) * pulse
        drawOval(Brush.radialGradient(listOf(color, Color.Transparent), Offset(cx, cy), r), Offset(cx - r, cy - r * 0.6f), Size(r * 2, r * 1.2f))
    }

    val (sheet, scale0, directional) = a.enemySprite(e.type)
    val scale = scale0 * e.size * CHAR_SCALE
    val row = if (directional) dirRow(e.faceX, e.faceY) else 0
    val col = when {
        !directional -> (e.anim * 7f).toInt() % 4
        e.windup > 0f -> 5 + ((1f - e.windup / e.type.windup) * 3f).toInt().coerceIn(0, 2)
        e.moving -> 1 + ((e.anim * 7f).toInt() % 4)
        else -> 0
    }
    val filter = when {
        e.frozen > 0f -> frozenTint
        e.type == EnemyType.SPIDER_QUEEN -> queenTint
        e.type == EnemyType.SHADOW_KING -> shadowTint
        e.type == EnemyType.TROLL -> trollTint
        e.type == EnemyType.GHOST -> ghostEnemyTint
        else -> null
    }
    val ghostly = e.type == EnemyType.GHOST
    drawSprite(sheet, col, row, cx, cy - (if (ghostly) t * 0.08f * sin(e.anim * 3f + e.phase) else 0f), t, scale = scale,
        alpha = if (ghostly) 0.72f else 1f, filter = filter)
    if (e.flash > 0f) drawSprite(sheet, col, row, cx, cy, t, scale = scale, alpha = e.flash / 0.12f * 0.75f, filter = whiteFlash)

    val headY = cy - sheet.worldW * t * scale * (sheet.foot - 0.25f)
    if (e.elite) {
        val label = e.label ?: measurer.measure(e.name, styles.label.copy(color = Color(0xFF82B1FF))).also { e.label = it }
        drawText(label, topLeft = Offset(cx - label.size.width / 2f, headY - label.size.height - t * 0.15f))
    }
    if (e.hp < e.maxHp && !e.type.boss) {
        val w = t * 0.8f
        drawRect(Color.Black.copy(alpha = 0.7f), Offset(cx - w / 2f - 2f, headY - 2f), Size(w + 4f, t * 0.07f + 4f))
        drawRect(Color(0xFFD32F2F), Offset(cx - w / 2f, headY), Size(w * (e.hp / e.maxHp).coerceIn(0f, 1f), t * 0.07f))
    }
}

private fun DrawScope.drawProp(p: Prop, g: Game, cam: Camera, a: Assets) {
    val t = cam.t
    val cx = cam.sx(p.x)
    val cy = cam.sy(p.y)
    val col = if (p.used && p.type != PropType.SHRINE) p.type.brokenSprite else p.type.sprite
    val filter = if (p.type == PropType.SHRINE && p.used) grayscale else null
    drawSprite(if (p.type.world) a.world else a.props, col, 0, cx, cy, t, filter = filter)
    when (p.type) {
        PropType.CAMPFIRE -> {
            drawFlame(cx - t * 0.1f, cy - t * 0.05f, t * 0.45f, g.time, 3f)
            drawFlame(cx + t * 0.12f, cy, t * 0.38f, g.time * 1.1f, 7f)
            drawFlame(cx, cy + t * 0.02f, t * 0.55f, g.time * 0.9f, 11f)
        }
        PropType.BRAZIER -> drawFlame(cx, cy - t * 0.66f, t * 0.32f, g.time, p.x * 3f)
        PropType.SHRINE -> if (!p.used) {
            val pulse = 0.5f + 0.5f * sin(g.time * 3f)
            val c = Offset(cx, cy - t * 0.85f)
            drawCircle(Brush.radialGradient(listOf(Color(0x8800E5FF), Color.Transparent), c, t * (0.5f + 0.15f * pulse)), t * (0.5f + 0.15f * pulse), c)
        }
        else -> {}
    }
}

private fun DrawScope.drawMerchant(g: Game, cam: Camera, a: Assets, measurer: TextMeasurer, styles: TextStyles) {
    val t = cam.t
    val cx = cam.sx(g.merchantX)
    val cy = cam.sy(g.merchantY)
    drawSprite(a.merchant, (g.time * 2f).toInt() % 4, 0, cx, cy, t, scale = CHAR_SCALE)
    val c = Offset(cx + t * 0.24f, cy - t * 0.5f)
    drawCircle(Brush.radialGradient(listOf(Color(0x66FFB74D), Color.Transparent), c, t * 0.8f), t * 0.8f, c)
    val label = measurer.measure("Købmanden", styles.label.copy(color = GOLD))
    drawText(label, topLeft = Offset(cx - label.size.width / 2f, cy - t * 1.35f))
}

private fun DrawScope.drawLoot(l: Loot, cam: Camera, time: Float, a: Assets, measurer: TextMeasurer, styles: TextStyles, near: Boolean) {
    val t = cam.t
    val bob = sin(time * 3f + l.phase) * t * 0.04f
    val cx = cam.sx(l.x)
    val cy = cam.sy(l.y)
    if (cx < -t * 2 || cy < -t * 3 || cx > size.width + t * 2 || cy > size.height + t * 2) return
    drawOval(Color.Black.copy(alpha = 0.4f), Offset(cx - t * 0.18f, cy - t * 0.05f), Size(t * 0.36f, t * 0.12f))
    when (val k = l.kind) {
        is LootKind.Gold -> {
            for ((i, o) in listOf(Offset(-0.08f, 0f), Offset(0.08f, 0.02f), Offset(0f, -0.07f), Offset(0.03f, 0.05f)).withIndex()) {
                val c = Offset(cx + o.x * t, cy + o.y * t - t * 0.06f + bob * (i % 2))
                drawCircle(Color(0xFF8D6E00), t * 0.075f, c)
                drawCircle(Color(0xFFFFC107), t * 0.062f, c)
                drawCircle(Color(0xFFFFF59D), t * 0.022f, Offset(c.x - t * 0.02f, c.y - t * 0.02f))
            }
        }
        LootKind.Potion -> drawIcon(a, Icons.POTION, cx, cy - t * 0.25f + bob, t * 0.55f)
        is LootKind.Gear -> {
            val item = k.item
            val rc = item.rarity.color
            if (item.rarity >= Rarity.RARE) {
                // Pillars of light grow taller and brighter with rarity.
                val tier = item.rarity.ordinal - Rarity.RARE.ordinal
                val hgt = t * (2.2f + tier * 0.9f)
                val wid = t * (0.12f + tier * 0.05f)
                val pulse = if (item.rarity == Rarity.MYTHIC) 0.75f + 0.25f * sin(time * 5f) else 1f
                drawRect(
                    Brush.verticalGradient(listOf(Color.Transparent, rc.copy(alpha = 0.55f * pulse)), startY = cy - hgt, endY = cy),
                    Offset(cx - wid / 2f, cy - hgt), Size(wid, hgt),
                )
                if (tier >= 1) {
                    for (k in 0 until tier * 2) {
                        val ph = (time * 0.7f + k * 0.37f + l.phase) % 1f
                        drawCircle(rc.copy(alpha = 1f - ph), t * 0.03f, Offset(cx + sin(k * 2.1f + time * 2f) * t * 0.15f, cy - ph * hgt))
                    }
                }
            }
            drawCircle(Brush.radialGradient(listOf(rc.copy(alpha = 0.45f), Color.Transparent), Offset(cx, cy - t * 0.15f), t * 0.5f), t * 0.5f, Offset(cx, cy - t * 0.15f))
            drawIcon(a, item.icon, cx, cy - t * 0.25f + bob, t * 0.62f)
            if (item.rarity == Rarity.COMMON && !near) return
            val label = l.label ?: measurer.measure(item.name, styles.label).also { l.label = it }
            val lx = cx - label.size.width / 2f
            val ly = cy - t * 0.72f - label.size.height
            drawRoundRect(Color.Black.copy(alpha = 0.65f), Offset(lx - 6f, ly - 2f), Size(label.size.width + 12f, label.size.height + 4f), CornerRadius(6f))
            drawText(label, color = rc, topLeft = Offset(lx, ly))
        }
    }
}

fun DrawScope.drawIcon(a: Assets, icon: Int, cx: Float, cy: Float, size: Float, alpha: Float = 1f) {
    val s = size.roundToInt()
    drawImage(
        a.icons, IntOffset(icon * 96, 0), IntSize(96, 96), IntOffset((cx - size / 2f).roundToInt(), (cy - size / 2f).roundToInt()),
        IntSize(s, s), alpha = alpha, filterQuality = FilterQuality.Medium,
    )
}

// ---------------------------------------------------------------- lighting

/** Darkness with light holes punched out; drawn into an offscreen layer. */
fun DrawScope.drawLighting(g: Game) {
    val cam = cameraFor(g)
    val t = cam.t
    val d = g.dungeon
    drawRect(d.biome.darkness.copy(alpha = g.darknessAlpha))

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
    light(p.x, p.y - 0.3f, t * (if (g.inWorld) 7f else 6.2f) * flicker(g.time, 0.3f), 1f)
    for (e in d.entrances) light(e.x + 0.5f, e.y + 0.3f, t * (if (e.region == Region.HELL) 3.4f else 1.6f), 0.8f)
    for (i in d.torches) light(i % d.w + 0.5f, i / d.w + 1f - WALL_HEIGHT * 0.4f, t * 3.6f * flicker(g.time, i.toFloat()), 0.95f)
    for (pr in g.projectiles) light(pr.x, pr.y, t * 2.4f, 0.85f)
    light(d.exit.cx + 0.5f, d.exit.cy + 0.5f, t * 2.2f, 0.75f)
    for (pr in d.props) {
        when {
            pr.type == PropType.CAMPFIRE -> light(pr.x, pr.y - 0.3f, t * 8f * flicker(g.time, 1f), 1f)
            pr.type == PropType.SHRINE && !pr.used -> light(pr.x, pr.y - 0.6f, t * 2.2f, 0.7f)
        }
    }
    if (d.hasMerchant) light(g.merchantX + 0.25f, g.merchantY - 0.4f, t * 3f, 0.8f)
    for (pr in d.props) if (pr.type.light != 0L) light(pr.x, pr.y - 0.4f, t * 3.2f * flicker(g.time, pr.x), 0.85f)
    for (b in d.buildings) if (b.light != 0L) light(b.x + b.w / 2f + b.lightX, b.y + b.h + b.lightY - 0.5f, t * 2.8f, 0.8f)
    for (l in g.loot) {
        val k = l.kind
        if (k is LootKind.Gear && k.item.rarity >= Rarity.RARE) light(l.x, l.y, t * 1.3f, 0.6f)
    }
    g.boss?.let { light(it.x, it.y - 0.5f, t * 2.8f, 0.6f) }

    drawRect(
        Brush.radialGradient(
            listOf(Color.Transparent, Color.Black.copy(alpha = 0.2f + 0.45f * g.darknessAlpha)),
            center = Offset(size.width / 2f, size.height * 0.48f),
            radius = size.maxDimension * 0.75f,
        )
    )
    val hpFrac = p.hp / p.maxHp
    if (hpFrac < 0.3f && !g.dead) {
        // Heartbeat warning when close to death.
        val beat = (0.5f + 0.5f * sin(g.time * 7f)) * (0.3f - hpFrac) / 0.3f
        drawRect(
            Brush.radialGradient(
                listOf(Color.Transparent, Color(0xFF8B0000).copy(alpha = 0.55f * beat)),
                center = Offset(size.width / 2f, size.height / 2f),
                radius = size.maxDimension * 0.65f,
            )
        )
    }
    if (p.hurt > 0f) {
        drawRect(
            Brush.radialGradient(
                listOf(Color.Transparent, Color.Transparent, Color(0xFFB71C1C).copy(alpha = p.hurt * 0.9f)),
                center = Offset(size.width / 2f, size.height / 2f),
                radius = size.maxDimension * 0.75f,
            )
        )
    }
}

// ---------------------------------------------------------------- overworld

/** Trees, rocks and dungeon entrances that stand on a tile, depth-sorted with the row. */
private fun DrawScope.drawWorldTile(g: Game, x: Int, y: Int, cam: Camera, a: Assets, measurer: TextMeasurer, styles: TextStyles) {
    val d = g.dungeon
    val tile = d.tile(x, y)
    if (tile != TREE && tile != ROCK && tile != ENTRANCE) return
    val t = cam.t
    val cx = cam.sx(x + 0.5f)
    if (cx < -t * 2 || cx > size.width + t * 2) return
    val cy = cam.sy(y + 0.8f)
    val v = d.variant[y * d.w + x]
    when (tile) {
        TREE -> {
            val idx = when {
                v < 0.05f -> 4
                v < 0.13f -> 5
                else -> (v * 1000f).toInt() % 4
            }
            val p = g.player
            val behind = y + 0.8f > p.y && y + 0.8f - p.y < 2.6f && abs(x + 0.5f - p.x) < 1.4f
            val scale = 0.9f + ((v * 7f) % 1f) * 0.25f
            drawSprite(a.world, idx, 0, cx, cy, t, scale = scale, alpha = if (behind && idx < 5) 0.45f else 1f)
        }
        ROCK -> drawSprite(a.world, if (v < 0.4f) 6 else if (v < 0.8f) 7 else 8, 0, cx, cy, t, scale = 0.8f)
        ENTRANCE -> {
            val e = d.entrances.firstOrNull { it.x == x && it.y == y } ?: return
            val foot = cam.sy(y + 0.95f)
            drawSprite(a.world, e.region.sprite, 0, cx, foot, t)
            if (e.region == Region.HELL) {
                val c = Offset(cx, foot - t * 1.25f)
                val pulse = 0.8f + 0.2f * sin(g.time * 4f)
                drawCircle(Brush.radialGradient(listOf(Color(0xAAFF6D00), Color.Transparent), c, t * 0.9f * pulse), t * 0.9f * pulse, c)
            }
            val locked = g.questStage < e.region.quest
            val label = measurer.measure(
                (if (locked) "🔒 " else "") + e.region.title,
                styles.label.copy(color = if (locked) Color(0xFFBDBDBD) else GOLD),
            )
            val lx = cx - label.size.width / 2f
            val ly = foot - t * 2.15f
            drawRoundRect(Color.Black.copy(alpha = 0.6f), Offset(lx - 6f, ly - 2f), Size(label.size.width + 12f, label.size.height + 4f), CornerRadius(6f))
            drawText(label, topLeft = Offset(lx, ly))
        }
    }
}

private fun DrawScope.drawBuilding(b: Building, g: Game, cam: Camera, a: Assets) {
    val t = cam.t
    val cx = cam.sx(b.x + b.w / 2f)
    if (cx < -t * 4 || cx > size.width + t * 4) return
    val p = g.player
    val behind = p.y < b.y + b.h - 0.1f && p.y > b.y - 2.6f && p.x > b.x - 0.4f && p.x < b.x + b.w + 0.4f
    drawSprite(a.village, b.sprite, 0, cx, cam.sy((b.y + b.h).toFloat()), t, alpha = if (behind && b.w >= 2) 0.5f else 1f)
}

private fun DrawScope.drawNpc(n: Npc, g: Game, cam: Camera, a: Assets, measurer: TextMeasurer, styles: TextStyles) {
    val t = cam.t
    val cx = cam.sx(n.x)
    val cy = cam.sy(n.y)
    when (n.kind) {
        NpcKind.SMITH -> drawSprite(a.smith, if (n.say != null) 0 else (n.anim * 5f).toInt() % 4, 0, cx, cy, t, scale = 1.3f)
        NpcKind.ELDER -> drawSprite(a.elder, (n.anim * 1.5f).toInt() % 4, 0, cx, cy, t, scale = 1.3f)
        NpcKind.VILLAGER_F, NpcKind.VILLAGER_M -> {
            val sheet = if (n.kind == NpcKind.VILLAGER_F) a.villagerF else a.villagerM
            val col = if (n.moving) 1 + (n.anim * 6f).toInt() % 4 else 0
            drawSprite(sheet, col, dirRow(n.faceX, n.faceY), cx, cy, t, scale = 1.25f)
        }
    }
    if (n.kind == NpcKind.SMITH || n.kind == NpcKind.ELDER) {
        val label = n.label ?: measurer.measure(n.kind.title, styles.label.copy(color = GOLD)).also { n.label = it }
        drawText(label, topLeft = Offset(cx - label.size.width / 2f, cy - t * 1.45f))
    }
    n.say?.let { text ->
        val layout = measurer.measure(text, styles.label.copy(color = Color(0xFF2B1D14)), constraints = androidx.compose.ui.unit.Constraints(maxWidth = (t * 3.2f).toInt()))
        val bx = cx - layout.size.width / 2f
        val by = cy - t * 1.75f - layout.size.height
        drawRoundRect(Color(0xF0F3E9D2), Offset(bx - 8f, by - 5f), Size(layout.size.width + 16f, layout.size.height + 10f), CornerRadius(10f))
        drawText(layout, topLeft = Offset(bx, by))
    }
}

// ---------------------------------------------------------------- weather

private val hellFog = ColorFilter.tint(Color(0xFFFF8A65), BlendMode.Modulate)
private val caveFog = ColorFilter.tint(Color(0xFFB2DFDB), BlendMode.Modulate)

/** Two layers of soft fog drifting at different speeds, locked to the world. */
private fun DrawScope.drawFog(g: Game, a: Assets, cam: Camera) {
    val amount = g.fogAmount
    if (amount <= 0.01f) return
    val t = cam.t
    val filter = when (g.dungeon.biome) {
        Biome.HELL -> hellFog
        Biome.CAVE -> caveFog
        else -> null
    }
    for (layer in 0..1) {
        val span = t * (if (layer == 0) 5f else 3.2f)
        val ox = cam.ox + g.time * t * (if (layer == 0) 0.25f else -0.4f)
        val oy = cam.oy + g.time * t * (if (layer == 0) 0.08f else 0.15f)
        val startX = -((ox % span) + span) % span
        val startY = -((oy % span) + span) % span
        var y = startY
        while (y < size.height) {
            var x = startX
            while (x < size.width) {
                drawImage(
                    a.fog, IntOffset(0, 0), IntSize(256, 256), IntOffset(x.roundToInt(), y.roundToInt()),
                    IntSize(span.roundToInt() + 1, span.roundToInt() + 1), alpha = amount * (if (layer == 0) 1f else 0.7f), colorFilter = filter,
                )
                x += span
            }
            y += span
        }
    }
}

private fun DrawScope.drawRain(g: Game) {
    val n = (160 * g.rain).toInt()
    val c = Color(0xFFB3C7D9).copy(alpha = 0.35f * g.rain)
    val len = size.height * 0.03f
    for (i in 0 until n) {
        val x = ((i * 97.31f + g.time * 140f) % size.width + size.width) % size.width
        val y = ((i * 53.77f + g.time * size.height * 1.3f + (i % 7) * 113f) % size.height + size.height) % size.height
        drawLine(c, Offset(x, y), Offset(x - len * 0.25f, y + len), strokeWidth = 2f)
    }
}
