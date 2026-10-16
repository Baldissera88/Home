package com.baldissera.rpg

import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.BlendMode
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.graphics.ColorMatrix
import androidx.compose.ui.graphics.FilterQuality
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.graphics.drawscope.withTransform
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.text.TextMeasurer
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.drawText
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.IntSize
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.atan2
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt
import kotlin.math.sin
import kotlin.random.Random

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
private val poisonTint = ColorFilter.tint(Color(0xFFB2FF59), BlendMode.Modulate)
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
            if (ground != null) drawEdges(a, x, y, l, tp, sz, 2) { cx, cy -> d.tile(cx, cy) != WATER }
            // Sun glints twinkling on open water.
            if (g.inWorld && g.daylight > 0.3f) {
                val h = cellHash(x, y)
                for (k in 0..1) {
                    val ph = sin(g.time * 2.2f + (h ushr (k * 8) and 255) * 0.05f)
                    if (ph > 0.6f) {
                        val gx = l + ((h ushr (k * 5)) and 127) / 127f * sz.width
                        val gy = tp + ((h ushr (k * 7 + 3)) and 127) / 127f * sz.height
                        val k2 = (ph - 0.6f) / 0.4f * g.daylight
                        drawLine(Color.White.copy(alpha = 0.8f * k2), Offset(gx - t * 0.06f, gy), Offset(gx + t * 0.06f, gy), strokeWidth = t * 0.018f)
                        drawLine(Color.White.copy(alpha = 0.5f * k2), Offset(gx, gy - t * 0.03f), Offset(gx, gy + t * 0.03f), strokeWidth = t * 0.012f)
                    }
                }
            }
            continue
        }
        if (ground != null) {
            drawImage(a.ground, IntOffset(ground[i] * 128, 0), IntSize(128, 128), IntOffset(l, tp), sz, filterQuality = FilterQuality.Medium)
            if (!grassy(d, x, y)) drawEdges(a, x, y, l, tp, sz, 0) { cx, cy -> grassy(d, cx, cy) }
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

    // Shockwaves from skills spread along the ground.
    for (w in g.waves) {
        val k = (w.age / w.life).coerceIn(0f, 1f)
        val ease = 1f - (1f - k) * (1f - k)
        val rx = w.radius * t * (0.25f + 0.75f * ease)
        val c = Offset(cam.sx(w.x), cam.sy(w.y))
        val fade = 1f - k
        drawOval(
            Brush.radialGradient(listOf(Color.Transparent, w.color.copy(alpha = 0.22f * fade)), c, rx),
            Offset(c.x - rx, c.y - rx * 0.6f), Size(rx * 2, rx * 1.2f),
        )
        drawOval(w.color.copy(alpha = 0.75f * fade), Offset(c.x - rx, c.y - rx * 0.6f), Size(rx * 2, rx * 1.2f), style = Stroke(t * 0.09f * fade + 1f))
        drawOval(Color.White.copy(alpha = 0.5f * fade), Offset(c.x - rx, c.y - rx * 0.6f), Size(rx * 2, rx * 1.2f), style = Stroke(t * 0.025f * fade + 1f))
    }

    drawZones(g, cam)

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

    val lootLabels = ArrayList<LootLabel>()
    for (l in g.loot) {
        val dx = l.x - g.player.x
        val dy = l.y - g.player.y
        drawLoot(l, cam, g.time, a, measurer, styles, dx * dx + dy * dy < 6.25f)?.let { lootLabels += it }
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
        for (x in x0..x1) if (d.tile(x, y) == WALL) drawWallTile(d, x, y, cam, g.time, wallImg, topImg, a.wallSkirts)
        while (bi < bbs.size && bbs[bi].y < y + 0.8f) drawBillboard(bbs[bi++])
        for (x in x0..x1) drawWorldTile(g, x, y, cam, a, measurer, styles)
        for (b in d.buildings) if (b.y + b.h - 1 == y) drawBuilding(b, g, cam, a)
        while (bi < bbs.size && bbs[bi].y < y + 1f) drawBillboard(bbs[bi++])
    }

    if (!g.dead) drawHeroSilhouette(g, cam, a)

    for (pr in g.projectiles) {
        val c = Offset(cam.sx(pr.x), cam.sy(pr.y) - t * 0.4f)
        val r = pr.radius * t
        if (pr.small && !pr.hostile) {
            // Knives and arcane bolts: a short streak along their flight.
            val sp = hypot(pr.vx, pr.vy).coerceAtLeast(0.01f)
            val tail = Offset(c.x - pr.vx / sp * t * 0.45f, c.y - pr.vy / sp * t * 0.45f)
            drawLine(pr.color.copy(alpha = 0.35f), tail, c, strokeWidth = r * 1.4f, cap = StrokeCap.Round)
            drawLine(Color.White.copy(alpha = 0.9f), Offset((tail.x + c.x) / 2f, (tail.y + c.y) / 2f), c, strokeWidth = r * 0.5f, cap = StrokeCap.Round)
            continue
        }
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

    for (b in g.bolts) drawBolt(b, cam)
    if (g.inWorld && g.daylight > 0.35f) drawButterflies(g, cam, x0, x1, y0, y1)
    if (g.inWorld) drawCloudShadows(g, a, cam)
    drawLootLabels(lootLabels)

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
    skirts: androidx.compose.ui.graphics.ImageBitmap,
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

    // Rubble piled along the foot of the wall breaks up the straight line where it meets the floor.
    val skirtRow = when (d.biome) {
        Biome.CRYPT -> 0
        Biome.CAVE -> 1
        Biome.HELL -> 2
        else -> -1
    }
    if (skirtRow >= 0) {
        val sv = (d.variant[y * d.w + x] * 7f).toInt() % 4
        val sh = ((r - l) * 0.5f).roundToInt()
        drawImage(
            skirts, IntOffset(sv * 128, skirtRow * 64), IntSize(128, 64),
            IntOffset(l, bt - (sh * 0.62f).roundToInt()), IntSize(r - l, sh), filterQuality = FilterQuality.Medium,
        )
    }

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

/** Hero sheets: columns 0-1 idle (breathing), 2-9 walk, 10-15 attack. */
private const val HERO_WALK = 2
private const val HERO_ATTACK = 10

/** Sprite column and row for the hero's current pose and facing. */
private fun heroFrame(p: Player, time: Float): Pair<Int, Int> {
    var row = dirRow(p.faceX, p.faceY)
    val col = when {
        p.spin > 0f -> {
            row = ((p.spin * 22f).toInt()) % 8
            HERO_ATTACK + 3
        }
        p.leap > 0f -> HERO_ATTACK + ((1f - p.leap / p.leapDur) * 4f).toInt().coerceIn(0, 3)
        p.charge > 0f -> HERO_ATTACK + 2
        p.whirl > 0f -> {
            row = (row + ((1f - p.whirl / 0.45f) * 16f).toInt()) % 8
            HERO_ATTACK + 3
        }
        p.swing > 0f -> HERO_ATTACK + ((1f - p.swing / p.swingTime) * 6f).toInt().coerceIn(0, 5)
        p.cast > 0f -> HERO_ATTACK + ((1f - p.cast / 0.4f) * 6f).toInt().coerceIn(0, 5)
        p.moving -> HERO_WALK + ((p.walk * 2f).toInt() % 8)
        else -> (time * 1.3f).toInt() % 2
    }
    return col to row
}

private fun heroSheet(g: Game, a: Assets) = a.hero(g.player.heroClass, g.player.weaponKind)

/** A faint outline of the hero on top of whatever stands in front, so he is never lost behind walls or a crowd. */
private fun DrawScope.drawHeroSilhouette(g: Game, cam: Camera, a: Assets) {
    val p = g.player
    val d = g.dungeon
    val behindWall = d.tile(floorInt(p.x), floorInt(p.y) + 1) == WALL && p.y - floorInt(p.y) > 0.2f
    // Only when a monster stands right in front of the hero's body, not merely nearby.
    val crowded = g.enemies.any { it.y > p.y + 0.15f && it.y - p.y < 0.9f + 0.3f * it.size && abs(it.x - p.x) < 0.5f * it.size + 0.15f }
    if (!behindWall && !crowded) return
    val (col, row) = heroFrame(p, g.time)
    drawSprite(heroSheet(g, a), col, row, cam.sx(p.x), cam.sy(p.y) - p.leapZ * cam.t, cam.t, scale = CHAR_SCALE, alpha = 0.25f, filter = ghostTint)
}

private val holyGold = Color(0xFFFFE082)
private val venomGreen = Color(0xFF9CCC65)

private fun DrawScope.drawPlayer(g: Game, cam: Camera, a: Assets) {
    val p = g.player
    val t = cam.t
    val cx = cam.sx(p.x)
    val cy = cam.sy(p.y) - p.leapZ * t

    p.buff?.let { b ->
        val pulse = 0.5f + 0.5f * sin(g.time * 4f)
        drawCircle(b.color.copy(alpha = 0.25f + 0.2f * pulse), t * 0.42f, Offset(cx, cy), style = Stroke(t * 0.05f))
    }
    if (p.fury > 0f) {
        val pulse = 0.5f + 0.5f * sin(g.time * 9f)
        drawOval(Color(0xFFFF5722).copy(alpha = 0.18f + 0.12f * pulse), Offset(cx - t * 0.5f, cy - t * 0.25f), Size(t, t * 0.5f))
    }
    if (g.levelFlash > 0f) {
        val k = 1f - g.levelFlash / 1.2f
        drawCircle(GOLD.copy(alpha = 1f - k), t * (0.4f + k * 1.8f), Offset(cx, cy - t * 0.3f), style = Stroke(t * 0.08f))
    }

    val (col, row) = heroFrame(p, g.time)

    if (p.swing > 0f || p.whirl > 0f || p.spin > 0f) {
        val r = t * (if (p.spin > 0f) 1.1f else 0.8f)
        val face = atan2(p.faceY, p.faceX)
        val body = Offset(cx, cy - t * 0.4f)
        val (start, sweep) = when {
            p.spin > 0f -> (p.spin * 1400f % 360f) to 300f
            p.whirl > 0f -> 0f to 360f
            else -> Math.toDegrees((face - 1.2).toDouble()).toFloat() to Math.toDegrees(((1f - p.swing / p.swingTime) * 2.4f).toDouble()).toFloat()
        }
        val trail = if (p.venom > 0f) venomGreen else Color.White
        drawArc(
            trail.copy(alpha = if (p.spin > 0f) 0.4f else 0.3f), start, sweep, useCenter = false,
            topLeft = Offset(body.x - r, body.y - r * 0.6f), size = Size(r * 2f, r * 1.2f), style = Stroke(t * 0.12f, cap = StrokeCap.Round),
        )
    }

    val sheet = heroSheet(g, a)
    for (gh in g.ghosts) {
        drawSprite(sheet, gh.col, gh.row, cam.sx(gh.x), cam.sy(gh.y), t, scale = CHAR_SCALE, alpha = (1f - gh.age / 0.3f) * 0.35f, filter = ghostTint)
    }
    // Stealth: a faint, shimmering shape.
    val alpha = if (p.stealth > 0f) 0.35f + 0.08f * sin(g.time * 7f) else 1f
    drawSprite(sheet, col, row, cx, cy, t, scale = CHAR_SCALE, alpha = alpha, filter = if (p.stealth > 0f) ghostTint else null)
    if (p.chill > 0f) drawSprite(sheet, col, row, cx, cy, t, scale = CHAR_SCALE, alpha = min(0.55f, p.chill), filter = frozenTint)
    if (p.hurt > 0f) drawSprite(sheet, col, row, cx, cy, t, scale = CHAR_SCALE, alpha = p.hurt * 1.1f, filter = redFlash)
    if (p.venom > 0f && (g.time * 6f).toInt() % 2 == 0) {
        drawCircle(venomGreen.copy(alpha = 0.5f), t * 0.04f, Offset(cx + t * 0.3f, cy - t * 0.45f))
        drawCircle(venomGreen.copy(alpha = 0.5f), t * 0.04f, Offset(cx - t * 0.3f, cy - t * 0.45f))
    }
    if (p.holy > 0f) {
        // A golden dome of holy light.
        val k = min(1f, p.holy)
        val r = t * 0.62f
        val c = Offset(cx, cy - t * 0.45f)
        drawCircle(Brush.radialGradient(listOf(Color.Transparent, holyGold.copy(alpha = 0.3f * k)), c, r), r, c)
        drawCircle(holyGold.copy(alpha = (0.55f + 0.2f * sin(g.time * 5f)) * k), r, c, style = Stroke(t * 0.025f))
    }
}

/** Hallowed ground, burning craters and meteors on their way down. */
private fun DrawScope.drawZones(g: Game, cam: Camera) {
    val t = cam.t
    for (z in g.zones) {
        val c = Offset(cam.sx(z.x), cam.sy(z.y))
        val fadeIn = min(1f, z.age * 4f)
        val fadeOut = min(1f, (z.life - z.age) * 2f)
        val k = fadeIn * fadeOut
        val rx = z.radius * t
        when (z.kind) {
            ZoneKind.CONSECRATE -> {
                drawOval(Brush.radialGradient(listOf(holyGold.copy(alpha = 0.35f * k), holyGold.copy(alpha = 0.08f * k)), c, rx), Offset(c.x - rx, c.y - rx * 0.6f), Size(rx * 2, rx * 1.2f))
                drawOval(holyGold.copy(alpha = 0.8f * k), Offset(c.x - rx, c.y - rx * 0.6f), Size(rx * 2, rx * 1.2f), style = Stroke(t * 0.035f))
                // Slowly turning runes around the rim.
                for (i in 0 until 12) {
                    val ang = g.time * 0.6f + i * (PI.toFloat() / 6f)
                    val px = c.x + kotlin.math.cos(ang) * rx * 0.85f
                    val py = c.y + sin(ang) * rx * 0.85f * 0.6f
                    drawCircle(Color.White.copy(alpha = 0.7f * k), t * 0.035f, Offset(px, py))
                }
            }
            ZoneKind.FIRE -> {
                drawOval(Brush.radialGradient(listOf(Color(0xFFFF6D00).copy(alpha = 0.5f * k), Color(0xFF3E0E00).copy(alpha = 0.2f * k)), c, rx), Offset(c.x - rx, c.y - rx * 0.6f), Size(rx * 2, rx * 1.2f))
                for (i in 0 until 5) drawFlame(c.x + sin(i * 2.4f) * rx * 0.55f, c.y + kotlin.math.cos(i * 1.7f) * rx * 0.3f, t * 0.3f * k, g.time, i * 3f)
            }
        }
    }
    for (m in g.meteors) {
        val c = Offset(cam.sx(m.x), cam.sy(m.y))
        val k = 1f - m.t / 0.75f
        val rx = 2.3f * t
        drawOval(Color(0xFFFF3D00).copy(alpha = 0.15f + 0.25f * k), Offset(c.x - rx, c.y - rx * 0.6f), Size(rx * 2, rx * 1.2f))
        drawOval(Color(0xFFFFAB40).copy(alpha = 0.8f), Offset(c.x - rx * k, c.y - rx * k * 0.6f), Size(rx * k * 2, rx * k * 1.2f), style = Stroke(t * 0.04f))
        // The meteor streaks in from high above.
        val hx = c.x + t * 3f * (1f - k)
        val hy = c.y - t * 9f * (1f - k)
        drawLine(Color(0xFFFF7043).copy(alpha = 0.6f), Offset(hx + t * 1.2f, hy - t * 3.6f), Offset(hx, hy), strokeWidth = t * 0.22f, cap = StrokeCap.Round)
        drawCircle(Brush.radialGradient(listOf(Color.White, Color(0xFFFFAB40), Color.Transparent), Offset(hx, hy), t * 0.5f), t * 0.5f, Offset(hx, hy))
    }
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
    if (Affix.BURNING in e.affixes && e.aggro && e.burnCd < 0.8f) {
        // Telegraph the coming eruption so the hero can dodge out of it.
        val k = 1f - (e.burnCd / 0.8f).coerceIn(0f, 1f)
        val rx = BURN_RADIUS * t
        drawOval(Color(0xFFFF6D00).copy(alpha = 0.1f + 0.2f * k), Offset(cx - rx * k, cy - rx * k * 0.6f), Size(rx * k * 2, rx * k * 1.2f))
        drawOval(Color(0xFFFFAB40).copy(alpha = 0.7f), Offset(cx - rx, cy - rx * 0.6f), Size(rx * 2, rx * 1.2f), style = Stroke(t * 0.035f))
    }
    if (e.elite || e.type.boss) {
        val color = when {
            e.type.boss -> Color(0x66FF1744)
            e.affixes.isNotEmpty() -> e.affixes[((e.anim * 0.5f).toInt()) % e.affixes.size].color.copy(alpha = 0.4f)
            else -> Color(0x664FC3F7)
        }
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
        e.poison > 0f -> poisonTint
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
    if (e.shield > 0f) {
        val r = t * 0.75f * e.size
        val body = Offset(cx, cy - r * 0.8f)
        val a0 = (e.shield / 0.3f).coerceIn(0f, 1f) * (0.75f + 0.25f * sin(e.anim * 9f))
        drawCircle(Brush.radialGradient(listOf(Color.Transparent, Affix.SHIELDED.color.copy(alpha = 0.35f * a0)), body, r), r, body)
        drawCircle(Affix.SHIELDED.color.copy(alpha = 0.8f * a0), r, body, style = Stroke(t * 0.03f))
    }

    val headY = cy - sheet.worldW * t * scale * (sheet.foot - 0.25f)
    if (e.stun > 0f) {
        // Dazed: little stars circling over the head.
        for (i in 0 until 3) {
            val ang = g.time * 5f + i * 2.094f
            val sx = cx + kotlin.math.cos(ang) * t * 0.28f * e.size
            val sy = headY + t * 0.05f + sin(ang) * t * 0.08f
            drawCircle(Color(0xFFFFEE58), t * 0.045f, Offset(sx, sy))
            drawCircle(Color.White, t * 0.02f, Offset(sx, sy))
        }
    }
    if (e.elite) {
        val label = e.label ?: measurer.measure(e.name, styles.label.copy(color = Color(0xFF82B1FF))).also { e.label = it }
        var top = headY - label.size.height - t * 0.12f
        if (e.affixes.isNotEmpty()) {
            val affix = e.affixLabel ?: measurer.measure(e.affixText, styles.label.copy(color = Color(0xFFB0BEC5), fontSize = styles.label.fontSize * 0.85f))
                .also { e.affixLabel = it }
            drawText(affix, topLeft = Offset(onScreenX(cx, affix.size.width.toFloat()), top))
            top -= affix.size.height
        }
        drawText(label, topLeft = Offset(onScreenX(cx, label.size.width.toFloat()), top))
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
        PropType.STASH -> {
            // A warm glint on the lock marks the hero's own chest.
            val pulse = 0.5f + 0.5f * sin(g.time * 2.5f)
            val c = Offset(cx, cy - t * 0.38f)
            drawCircle(Brush.radialGradient(listOf(Color(0x99FFD54F), Color.Transparent), c, t * (0.22f + 0.08f * pulse)), t * (0.22f + 0.08f * pulse), c)
        }
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
    val label = measurer.measure("Merchant", styles.label.copy(color = GOLD))
    drawText(label, topLeft = Offset(cx - label.size.width / 2f, cy - t * 1.35f))
}

private fun DrawScope.drawLoot(l: Loot, cam: Camera, time: Float, a: Assets, measurer: TextMeasurer, styles: TextStyles, near: Boolean): LootLabel? {
    val t = cam.t
    val bob = if (l.flying) 0f else sin(time * 3f + l.phase) * t * 0.04f
    val cx = cam.sx(l.x)
    val gy = cam.sy(l.y)
    if (cx < -t * 2 || gy < -t * 3 || cx > size.width + t * 2 || gy > size.height + t * 2) return null
    // The shadow stays on the ground and shrinks while the loot is in the air.
    val sh = 1f / (1f + l.z * 1.5f)
    drawOval(Color.Black.copy(alpha = 0.4f * sh), Offset(cx - t * 0.18f * sh, gy - t * 0.05f * sh), Size(t * 0.36f * sh, t * 0.12f * sh))
    val cy = gy - l.z * t
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
        is LootKind.Shard -> {
            val pulse = 0.5f + 0.5f * sin(time * 3f + l.phase)
            val c = Offset(cx, cy - t * 0.42f + bob)
            val hgt = t * 2.4f
            drawRect(
                Brush.verticalGradient(listOf(Color.Transparent, HEART.copy(alpha = 0.4f)), startY = cy - hgt, endY = cy),
                Offset(cx - t * 0.06f, cy - hgt), Size(t * 0.12f, hgt),
            )
            drawCircle(Brush.radialGradient(listOf(HEART.copy(alpha = 0.45f + 0.25f * pulse), Color.Transparent), c, t * 0.65f), t * 0.65f, c)
            val s = t * (0.3f + 0.02f * pulse)
            val heart = heartPath(c, s)
            drawPath(heart, Brush.linearGradient(listOf(Color(0xFFFFB3C1), Color(0xFFE91E63), Color(0xFF880E4F)), Offset(c.x - s, c.y - s), Offset(c.x + s, c.y + s)))
            // Crystal facets.
            drawLine(Color.White.copy(alpha = 0.35f), Offset(c.x, c.y - s * 0.45f), Offset(c.x, c.y + s * 0.9f), strokeWidth = t * 0.012f)
            drawLine(Color.White.copy(alpha = 0.25f), Offset(c.x - s * 0.75f, c.y - s * 0.2f), Offset(c.x, c.y + s * 0.2f), strokeWidth = t * 0.012f)
            drawLine(Color.White.copy(alpha = 0.25f), Offset(c.x + s * 0.75f, c.y - s * 0.2f), Offset(c.x, c.y + s * 0.2f), strokeWidth = t * 0.012f)
            drawPath(heart, Color.White.copy(alpha = 0.75f), style = Stroke(t * 0.018f))
            drawCircle(Color.White.copy(alpha = 0.6f + 0.4f * pulse), t * 0.04f, Offset(c.x - s * 0.45f, c.y - s * 0.4f))
            for (k in 0 until 4) {
                val ph = (time * 0.6f + k * 0.25f + l.phase) % 1f
                drawCircle(HEART.copy(alpha = 1f - ph), t * 0.025f, Offset(cx + sin(k * 2.3f + time * 2f) * t * 0.2f, cy - ph * hgt * 0.6f))
            }
        }
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
            if (item.rarity == Rarity.COMMON && !near) return null
            val label = l.label ?: measurer.measure(item.name, styles.label).also { l.label = it }
            return LootLabel(label, rc, cx, cy - t * 0.72f - label.size.height)
        }
    }
    return null
}

/** A name tag for an item on the ground, placed after all loot so tags can be stacked apart. */
private class LootLabel(val layout: TextLayoutResult, val color: Color, val cx: Float, val top: Float)

/** Draws loot names Diablo style: overlapping tags are pushed upwards and kept on screen. */
private fun DrawScope.drawLootLabels(labels: List<LootLabel>) {
    val placed = ArrayList<Rect>(labels.size)
    for (lb in labels.sortedByDescending { it.top }) {
        val w = lb.layout.size.width + 12f
        val h = lb.layout.size.height + 4f
        val left = (lb.cx - w / 2f).coerceIn(4f, max(4f, size.width - w - 4f))
        var top = lb.top - 2f
        var guard = 0
        while (guard++ < 16) {
            val hit = placed.firstOrNull { it.left < left + w && it.right > left && it.top < top + h && it.bottom > top } ?: break
            top = hit.top - h - 3f
        }
        placed += Rect(left, top, left + w, top + h)
        drawRoundRect(Color.Black.copy(alpha = 0.7f), Offset(left, top), Size(w, h), CornerRadius(6f))
        drawRoundRect(lb.color.copy(alpha = 0.35f), Offset(left, top), Size(w, h), CornerRadius(6f), style = Stroke(1.5f))
        drawText(lb.layout, color = lb.color, topLeft = Offset(left + 6f, top + 2f))
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
    for (b in g.bolts) light((b.x1 + b.x2) / 2f, (b.y1 + b.y2) / 2f, t * 2.6f, 0.9f * (1f - b.age / 0.28f))
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
        if (k is LootKind.Shard) light(l.x, l.y - 0.4f, t * 1.8f, 0.75f)
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

/** Left edge for a label of width [w] centred on [cx], kept inside the screen. */
private fun DrawScope.onScreenX(cx: Float, w: Float) = (cx - w / 2f).coerceIn(4f, max(4f, size.width - w - 4f))

/** A heart shape of half-width about [s] centred on [c]. */
private fun heartPath(c: Offset, s: Float) = Path().apply {
    moveTo(c.x, c.y + s * 0.9f)
    cubicTo(c.x - s * 1.35f, c.y + s * 0.05f, c.x - s * 0.95f, c.y - s * 1.05f, c.x, c.y - s * 0.42f)
    cubicTo(c.x + s * 0.95f, c.y - s * 1.05f, c.x + s * 1.35f, c.y + s * 0.05f, c.x, c.y + s * 0.9f)
    close()
}

// ---------------------------------------------------------------- ground transitions

private val EDGE_DX = intArrayOf(0, 1, 0, -1)
private val EDGE_DY = intArrayOf(-1, 0, 1, 0)
private val CORNER_DX = intArrayOf(-1, 1, 1, -1)
private val CORNER_DY = intArrayOf(-1, -1, 1, 1)

/** Whether an overworld cell is covered in grass (paths and sand get soft grass borders from these). */
private fun grassy(d: Dungeon, x: Int, y: Int): Boolean {
    val gr = d.ground ?: return false
    if (x < 0 || y < 0 || x >= d.w || y >= d.h) return true
    if (d.tile(x, y) == WATER) return false
    val v = gr[y * d.w + x]
    return v < Ground.DIRT || v == Ground.FLOWERS
}

/**
 * Overlays soft, irregular borders on a cell from the neighbours that [other] selects:
 * edge pieces for side neighbours and rounded corner pieces for diagonal ones.
 * [piece] picks the strip in tex_ground_edges (0 = grass, 2 = shore); pieces are authored for the top/top-left.
 */
private inline fun DrawScope.drawEdges(a: Assets, x: Int, y: Int, l: Int, tp: Int, sz: IntSize, piece: Int, other: (Int, Int) -> Boolean) {
    val pivot = Offset(l + sz.width / 2f, tp + sz.height / 2f)
    for (k in 0..3) {
        val side = other(x + EDGE_DX[k], y + EDGE_DY[k])
        val corner = !side && other(x + CORNER_DX[k], y + CORNER_DY[k]) &&
            !other(x + CORNER_DX[k], y) && !other(x, y + CORNER_DY[k])
        if (!side && !corner) continue
        val src = IntOffset((piece + if (side) 0 else 1) * 128, 0)
        rotate(k * 90f, pivot) {
            drawImage(a.groundEdges, src, IntSize(128, 128), IntOffset(l, tp), sz, filterQuality = FilterQuality.Medium)
        }
    }
}

// ---------------------------------------------------------------- lightning

/** A jagged, glowing bolt between two world points, re-jittered a few times while it lives. */
private fun DrawScope.drawBolt(b: Bolt, cam: Camera) {
    val t = cam.t
    val fade = (1f - b.age / 0.28f).coerceIn(0f, 1f)
    val x1 = cam.sx(b.x1)
    val y1 = cam.sy(b.y1) - t * 0.1f
    val x2 = cam.sx(b.x2)
    val y2 = cam.sy(b.y2) - t * 0.1f
    val len = hypot(x2 - x1, y2 - y1)
    if (len < 1f) return
    val nx = -(y2 - y1) / len
    val ny = (x2 - x1) / len
    val segments = (len / (t * 0.22f)).toInt().coerceIn(4, 24)
    val rnd = Random(b.seed + (b.age * 30f).toInt())
    val path = Path().apply {
        moveTo(x1, y1)
        for (i in 1 until segments) {
            val f = i / segments.toFloat()
            val off = (rnd.nextFloat() - 0.5f) * t * 0.45f * sin(f * PI.toFloat())
            lineTo(x1 + (x2 - x1) * f + nx * off, y1 + (y2 - y1) * f + ny * off)
        }
        lineTo(x2, y2)
    }
    drawPath(path, LIGHTNING_GLOW.copy(alpha = 0.35f * fade), style = Stroke(t * 0.16f, cap = StrokeCap.Round))
    drawPath(path, LIGHTNING_GLOW.copy(alpha = 0.8f * fade), style = Stroke(t * 0.06f, cap = StrokeCap.Round))
    drawPath(path, Color.White.copy(alpha = fade), style = Stroke(t * 0.022f, cap = StrokeCap.Round))
}

private val LIGHTNING_GLOW = Color(0xFF9FE7FF)

// ---------------------------------------------------------------- wildlife and sky

private fun cellHash(x: Int, y: Int): Int {
    var h = x * 73856093 xor y * 19349663
    h = h xor (h ushr 13)
    h *= 0x5bd1e995
    return h xor (h ushr 15)
}

private val BUTTERFLY_COLORS = listOf(Color(0xFFFFF176), Color(0xFFFFFFFF), Color(0xFFFFB74D), Color(0xFF81D4FA), Color(0xFFCE93D8))

/** Butterflies flutter over some of the flower meadows by day, each tied to its own patch. */
private fun DrawScope.drawButterflies(g: Game, cam: Camera, x0: Int, x1: Int, y0: Int, y1: Int) {
    val d = g.dungeon
    val ground = d.ground ?: return
    val t = cam.t
    val fade = ((g.daylight - 0.35f) / 0.2f).coerceIn(0f, 1f)
    for (y in y0..y1) for (x in x0..x1) {
        if (ground[y * d.w + x] != Ground.FLOWERS) continue
        val h = cellHash(x, y)
        if ((h and 3) != 0) continue
        val ph = (h ushr 4 and 1023) / 163f
        val bx = x + 0.5f + sin(g.time * 0.7f + ph) * 0.9f + sin(g.time * 1.9f + ph * 2f) * 0.25f
        val by = y + 0.5f + sin(g.time * 0.5f + ph * 1.3f) * 0.6f
        val lift = t * (0.45f + 0.15f * sin(g.time * 3.1f + ph))
        val c = Offset(cam.sx(bx), cam.sy(by) - lift)
        val col = BUTTERFLY_COLORS[(h ushr 12) % BUTTERFLY_COLORS.size].copy(alpha = fade)
        val flap = abs(sin(g.time * 16f + ph * 5f))
        val w = t * 0.07f * (0.25f + 0.75f * flap)
        drawOval(Color.Black.copy(alpha = 0.18f * fade), Offset(c.x - t * 0.05f, c.y + lift - t * 0.02f), Size(t * 0.1f, t * 0.04f))
        drawOval(col, Offset(c.x - w, c.y - t * 0.04f), Size(w, t * 0.07f))
        drawOval(col, Offset(c.x, c.y - t * 0.04f), Size(w, t * 0.07f))
        drawLine(Color(0xFF3E2723).copy(alpha = fade), Offset(c.x, c.y - t * 0.035f), Offset(c.x, c.y + t * 0.03f), strokeWidth = t * 0.012f)
    }
}

private val cloudShadow = ColorFilter.tint(Color(0xFF0A1A10), BlendMode.SrcIn)

/** Soft shadows of clouds drifting slowly across the land by day. */
private fun DrawScope.drawCloudShadows(g: Game, a: Assets, cam: Camera) {
    val strength = ((g.daylight - 0.3f) / 0.4f).coerceIn(0f, 1f) * (1f - g.rain * 0.6f) * 0.28f
    if (strength <= 0.01f) return
    val t = cam.t
    val span = t * 11f
    val ox = cam.ox + g.time * t * 0.55f
    val oy = cam.oy + g.time * t * 0.2f
    val startX = -((ox % span) + span) % span
    val startY = -((oy % span) + span) % span
    var y = startY
    while (y < size.height) {
        var x = startX
        while (x < size.width) {
            drawImage(
                a.fog, IntOffset(0, 0), IntSize(256, 256), IntOffset(x.roundToInt(), y.roundToInt()),
                IntSize(span.roundToInt() + 1, span.roundToInt() + 1), alpha = strength, colorFilter = cloudShadow,
            )
            x += span
        }
        y += span
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
