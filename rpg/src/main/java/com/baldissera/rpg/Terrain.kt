package com.baldissera.rpg

import android.content.res.Resources
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.BitmapShader
import android.graphics.Matrix
import android.graphics.Shader
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.ShaderBrush
import androidx.compose.ui.graphics.asImageBitmap
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import kotlin.math.abs
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.min

/** Ground materials of the overworld; the first [TEXTURED] are the strips of tex_terrain. */
object Mat {
    const val GRASS = 0
    const val DRY = 1
    const val FOREST = 2
    const val DIRT = 3
    const val SAND = 4
    const val COBBLE = 5
    const val MUD = 6
    const val TEXTURED = 7
    const val WATER = 7
}

/** Dungeon floor materials, in the order of the strips in each tex_floorset. */
object DMat {
    const val FLOOR = 0
    const val RUBBLE = 1
    const val LOOSE = 2
    const val DAMP = 3
}

/** The texture set a level's ground is baked from. */
enum class FloorSet(val tex: Int, val height: Int, val clutter: Int, val count: Int) {
    WILDS(R.drawable.tex_terrain, R.drawable.tex_terrain_h, R.drawable.tex_clutter, Mat.TEXTURED),
    CRYPT(R.drawable.tex_floorset_crypt, R.drawable.tex_floorset_crypt_h, R.drawable.tex_clutter_dungeon, 4),
    CAVE(R.drawable.tex_floorset_cave, R.drawable.tex_floorset_cave_h, R.drawable.tex_clutter_dungeon, 4),
    HELL(R.drawable.tex_floorset_hell, R.drawable.tex_floorset_hell_h, R.drawable.tex_clutter_dungeon, 4),
    ;

    companion object {
        fun of(d: Dungeon) = when {
            d.ground != null -> WILDS
            d.biome == Biome.CAVE -> CAVE
            d.biome == Biome.HELL -> HELL
            else -> CRYPT
        }
    }
}

// Dungeon clutter sprites, in the order of tex_clutter_dungeon.
private const val D_BONES = 0
private const val D_SKULL = 1
private const val D_RUBBLE = 2
private const val D_RUBBLE_DARK = 3
private const val D_SHROOMS = 4
private const val D_CRYSTALS = 5
private const val D_EMBERS = 6
private const val D_SHARDS = 7

/** Pixels per tile in baked terrain. */
const val TERRAIN_PX = 128
/** Tiles per side of a baked chunk. */
const val TERRAIN_CHUNK = 8
const val CHUNK_PX = TERRAIN_PX * TERRAIN_CHUNK

private const val TEX = 512
private const val CLUTTER = 64
private const val NOISE = 512
/** How strongly material height decides which material wins where two meet. */
private const val HEIGHT_BLEND = 0.6f
/** Width of the soft band between two blended materials, in blend-score units. */
private const val BAND = 0.09f
private const val MAX_CHUNKS = 12

// Clutter sprites, in the order of tex_clutter.
private const val C_TUFT = 0
private const val C_TUFT2 = 1
private const val C_TUFT_DRY = 2
private const val C_DAISIES = 3
private const val C_PEBBLES = 7
private const val C_PEBBLES_SAND = 8
private const val C_LEAVES = 9
private const val C_MUSHROOMS = 10
private const val C_MUSHROOMS_BROWN = 11
private const val C_FERN = 12
private const val C_TWIGS = 13
private const val C_REEDS = 14
private const val C_TUFT3 = 15

/** Tileable smooth value noise in [0, 1], [size]x[size] samples. */
private fun tileableNoise(size: Int, cells: Int, octaves: Int, seed: Int): FloatArray {
    val out = FloatArray(size * size)
    var amp = 1f
    var norm = 0f
    var c = cells
    for (o in 0 until octaves) {
        val rnd = java.util.Random(seed * 7919L + o)
        val g = FloatArray(c * c) { rnd.nextFloat() }
        for (y in 0 until size) {
            val fy = y.toFloat() / size * c
            val y0 = fy.toInt()
            var ty = fy - y0
            ty = ty * ty * (3 - 2 * ty)
            val r0 = (y0 % c) * c
            val r1 = ((y0 + 1) % c) * c
            for (x in 0 until size) {
                val fx = x.toFloat() / size * c
                val x0 = fx.toInt()
                var tx = fx - x0
                tx = tx * tx * (3 - 2 * tx)
                val xa = x0 % c
                val xb = (x0 + 1) % c
                val a = g[r0 + xa] + (g[r0 + xb] - g[r0 + xa]) * tx
                val b = g[r1 + xa] + (g[r1 + xb] - g[r1 + xa]) * tx
                out[y * size + x] += (a + (b - a) * ty) * amp
            }
        }
        norm += amp
        amp *= 0.5f
        c *= 2
    }
    for (i in out.indices) out[i] /= norm
    return out
}

private fun hash(x: Int, y: Int, seed: Int): Int {
    var h = x * 374761393 + y * 668265263 + seed * 1274126177
    h = (h xor (h ushr 13)) * 1103515245
    return h xor (h ushr 16)
}

/** Smooth noise in [0, 1] over tile coordinates with features about [scale] tiles across. */
private fun tileNoise(x: Float, y: Float, scale: Float, seed: Int): Float {
    val fx = x / scale
    val fy = y / scale
    val x0 = floor(fx).toInt()
    val y0 = floor(fy).toInt()
    var tx = fx - x0
    var ty = fy - y0
    tx = tx * tx * (3 - 2 * tx)
    ty = ty * ty * (3 - 2 * ty)
    fun v(i: Int, j: Int) = (hash(i, j, seed) and 0xFFFF) / 65535f
    val a = v(x0, y0) + (v(x0 + 1, y0) - v(x0, y0)) * tx
    val b = v(x0, y0 + 1) + (v(x0 + 1, y0 + 1) - v(x0, y0 + 1)) * tx
    return a + (b - a) * ty
}

/** Pixel data the terrain baker samples: material textures with height maps, clutter sprites and noise. */
class TerrainSource(res: Resources, val set: FloorSet) {
    val color: Array<IntArray>
    val height: Array<FloatArray>
    val clutter: Array<IntArray>
    /** Domain-warp offsets in tiles, one sample per 4 px, wrapping every 16 tiles. */
    val warpX = FloatArray(NOISE * NOISE)
    val warpY = FloatArray(NOISE * NOISE)
    /** Large-scale brightness, one sample per 8 px, wrapping every 32 tiles. */
    val macro = FloatArray(NOISE * NOISE)

    init {
        val opts = BitmapFactory.Options().apply {
            inScaled = false
            inPreferredConfig = Bitmap.Config.ARGB_8888
        }
        val tex = BitmapFactory.decodeResource(res, set.tex, opts)
        color = Array(set.count) { m -> IntArray(TEX * TEX).also { tex.getPixels(it, 0, TEX, m * TEX, 0, TEX, TEX) } }
        tex.recycle()
        val hb = BitmapFactory.decodeResource(res, set.height, opts)
        val row = IntArray(TEX * TEX)
        height = Array(set.count) { m ->
            hb.getPixels(row, 0, TEX, m * TEX, 0, TEX, TEX)
            // Centred on the material's mean so every material competes evenly at a border.
            var mean = 0f
            val h = FloatArray(TEX * TEX) { i -> ((row[i] shr 16) and 255) / 255f }
            for (v in h) mean += v
            mean /= h.size
            for (i in h.indices) h[i] -= mean
            h
        }
        hb.recycle()
        val cb = BitmapFactory.decodeResource(res, set.clutter, opts)
        clutter = Array(cb.width / CLUTTER) { k -> IntArray(CLUTTER * CLUTTER).also { cb.getPixels(it, 0, CLUTTER, k * CLUTTER, 0, CLUTTER, CLUTTER) } }
        cb.recycle()
        val nx = tileableNoise(NOISE, 8, 3, 11)
        val ny = tileableNoise(NOISE, 8, 3, 23)
        val nm = tileableNoise(NOISE, 6, 3, 37)
        for (i in 0 until NOISE * NOISE) {
            warpX[i] = ((nx[i] - 0.5f) * 1.1f).coerceIn(-0.45f, 0.45f)
            warpY[i] = ((ny[i] - 0.5f) * 1.1f).coerceIn(-0.45f, 0.45f)
            macro[i] = 1f + (nm[i] - 0.5f) * 0.28f
        }
    }
}

/** Which material covers each overworld tile, and where water lies. */
class TerrainMap(val d: Dungeon) {
    val w = d.w
    val h = d.h
    val set = FloorSet.of(d)
    val mat = ByteArray(w * h)
    /** Water, or land touching water: the animated water surface is drawn beneath these tiles. */
    val wet = BooleanArray(w * h)
    val signature: Int

    init {
        signature = if (d.ground != null) wilds() else dungeon()
    }

    /** Dungeons: the main floor broken up by rubble along the walls, patches of loose ground and damp spots. */
    private fun dungeon(): Int {
        var sig = 23 + set.ordinal * 7919
        for (y in 0 until h) for (x in 0 until w) {
            val i = y * w + x
            val t = d.tiles[i]
            sig = sig * 31 + t
            var walls = 0
            for (dy in -1..1) for (dx in -1..1) if (d.tile(x + dx, y + dy) == WALL) walls++
            mat[i] = when {
                t == WALL -> DMat.RUBBLE
                walls > 0 && (hash(x, y, 77) and 0xFF) < 110 -> DMat.RUBBLE
                tileNoise(x.toFloat(), y.toFloat(), 4.5f, 17 + set.ordinal) > 0.62f -> DMat.LOOSE
                tileNoise(x.toFloat(), y.toFloat(), 3.5f, 29 + set.ordinal) > 0.65f -> DMat.DAMP
                else -> DMat.FLOOR
            }.toByte()
        }
        return sig
    }

    private fun wilds(): Int {
        val gr = d.ground ?: IntArray(w * h)
        val village = d.village
        val vcx = village?.cx ?: -100
        val vcy = village?.cy ?: -100
        var sig = 17
        for (y in 0 until h) for (x in 0 until w) {
            val i = y * w + x
            val t = d.tiles[i]
            val g = gr[i]
            sig = sig * 31 + t * 11 + g
            val inVillage = village?.contains(x + 0.5f, y + 0.5f) == true
            val dirt = g == Ground.DIRT || g == Ground.DIRT + 1
            mat[i] = when {
                t == WATER -> Mat.WATER
                inVillage && (dirt || x == vcx - 1 || x == vcx || y == vcy || y == vcy + 1) -> Mat.COBBLE
                t == TREE -> Mat.FOREST
                t == ENTRANCE -> Mat.DIRT
                g == Ground.SAND -> Mat.SAND
                dirt -> Mat.DIRT
                tileNoise(x.toFloat(), y.toFloat(), 7f, 5) > 0.58f -> Mat.DRY
                else -> Mat.GRASS
            }.toByte()
        }
        // Forest litter spreads under the canopy; banks without sand turn to mud.
        val copy = mat.copyOf()
        for (y in 0 until h) for (x in 0 until w) {
            val i = y * w + x
            val m = copy[i].toInt()
            if (m == Mat.WATER) continue
            var trees = 0
            var water = false
            for (dy in -1..1) for (dx in -1..1) {
                val t = d.tile(x + dx, y + dy)
                if (t == TREE) trees++
                if (t == WATER && x + dx in 0 until w && y + dy in 0 until h) water = true
            }
            if ((m == Mat.GRASS || m == Mat.DRY) && trees >= 3) mat[i] = Mat.FOREST.toByte()
            if (water) {
                wet[i] = true
                if (m != Mat.SAND && m != Mat.COBBLE && (dxWater(d, x, y))) mat[i] = Mat.MUD.toByte()
            }
        }
        for (i in 0 until w * h) if (mat[i].toInt() == Mat.WATER) wet[i] = true
        return sig
    }

    private fun dxWater(d: Dungeon, x: Int, y: Int) =
        d.tile(x - 1, y) == WATER || d.tile(x + 1, y) == WATER || d.tile(x, y - 1) == WATER || d.tile(x, y + 1) == WATER

    fun at(x: Int, y: Int): Int = mat[y.coerceIn(0, h - 1) * w + x.coerceIn(0, w - 1)].toInt()

    /** True when a tile and all eight neighbours share one material. */
    fun pure(x: Int, y: Int): Boolean {
        val m = at(x, y)
        for (dy in -1..1) for (dx in -1..1) if (at(x + dx, y + dy) != m) return false
        return true
    }
}

/** Bakes one chunk: height-blended materials, wet banks and shallows, ambient occlusion and clutter. */
private class TerrainBaker(private val src: TerrainSource, private val m: TerrainMap) {
    private val out = IntArray(CHUNK_PX * CHUNK_PX)
    private val mats = IntArray(4)
    private val ws = FloatArray(4)

    fun bake(cx: Int, cy: Int): IntArray {
        val tx0 = cx * TERRAIN_CHUNK
        val ty0 = cy * TERRAIN_CHUNK
        for (ty in 0 until TERRAIN_CHUNK) for (tx in 0 until TERRAIN_CHUNK) {
            val x = tx0 + tx
            val y = ty0 + ty
            val pure = m.pure(x, y)
            val mm = m.at(x, y)
            for (py in 0 until TERRAIN_PX) {
                val wy = y * TERRAIN_PX + py
                val oRow = (ty * TERRAIN_PX + py) * CHUNK_PX + tx * TERRAIN_PX
                val tRow = (wy and (TEX - 1)) * TEX
                val macroRow = ((wy shr 3) and (NOISE - 1)) * NOISE
                for (px in 0 until TERRAIN_PX) {
                    val wx = x * TERRAIN_PX + px
                    val ti = tRow + (wx and (TEX - 1))
                    val argb = if (pure) {
                        if (mm == Mat.WATER) 0 else src.color[mm][ti]
                    } else {
                        blend(wx, wy, ti)
                    }
                    out[oRow + px] = if (argb ushr 24 == 0) 0 else scale(argb, src.macro[macroRow + ((wx shr 3) and (NOISE - 1))])
                }
            }
        }
        occlusion(tx0, ty0)
        clutter(tx0, ty0)
        return out
    }

    private fun scale(c: Int, k: Float): Int {
        val r = min(255, (((c shr 16) and 255) * k).toInt())
        val g = min(255, (((c shr 8) and 255) * k).toInt())
        val b = min(255, ((c and 255) * k).toInt())
        return (c and 0xFF000000.toInt()) or (r shl 16) or (g shl 8) or b
    }

    private fun blend(wx: Int, wy: Int, ti: Int): Int {
        val wi = ((wy shr 2) and (NOISE - 1)) * NOISE + ((wx shr 2) and (NOISE - 1))
        val u = (wx + 0.5f) / TERRAIN_PX + src.warpX[wi] - 0.5f
        val v = (wy + 0.5f) / TERRAIN_PX + src.warpY[wi] - 0.5f
        val i0 = floor(u).toInt()
        val j0 = floor(v).toInt()
        val fx = u - i0
        val fy = v - j0
        var n = 0
        fun add(mat: Int, w: Float) {
            for (k in 0 until n) if (mats[k] == mat) {
                ws[k] += w
                return
            }
            mats[n] = mat
            ws[n] = w
            n++
        }
        add(m.at(i0, j0), (1 - fx) * (1 - fy))
        add(m.at(i0 + 1, j0), fx * (1 - fy))
        add(m.at(i0, j0 + 1), (1 - fx) * fy)
        add(m.at(i0 + 1, j0 + 1), fx * fy)

        // Land: the materials compete by weight plus height, within a soft band of the winner.
        var best = -9f
        var waterW = 0f
        for (k in 0 until n) {
            if (mats[k] == Mat.WATER) {
                waterW = ws[k]
                continue
            }
            val s = ws[k] + src.height[mats[k]][ti] * HEIGHT_BLEND
            if (s > best) best = s
        }
        if (best < -8f) return 0
        var sum = 0f
        var r = 0f
        var g = 0f
        var b = 0f
        for (k in 0 until n) {
            val mat = mats[k]
            if (mat == Mat.WATER) continue
            val s = ws[k] + src.height[mat][ti] * HEIGHT_BLEND
            val wgt = s - (best - BAND)
            if (wgt <= 0f) continue
            val c = src.color[mat][ti]
            r += ((c shr 16) and 255) * wgt
            g += ((c shr 8) and 255) * wgt
            b += (c and 255) * wgt
            sum += wgt
        }
        r /= sum
        g /= sum
        b /= sum
        if (waterW <= 0f) return pack(255f, r, g, b)

        // Banks darken as they get wet; the shoreline follows the winning material's bumps.
        val wet = 1f - 0.38f * min(1f, waterW * 2.2f)
        r *= wet
        g *= wet
        b *= wet
        val shore = waterW - (1f - waterW) - best * 0.6f + 0.02f
        val submerged = ((shore + 0.06f) / 0.12f).coerceIn(0f, 1f)
        if (submerged <= 0f) return pack(255f, r, g, b)
        // Under the surface the bottom tints blue-green and fades into the depths.
        val depth = ((waterW - 0.5f) / 0.38f).coerceIn(0f, 1f)
        val tint = 1f - submerged
        r *= tint + submerged * 0.55f
        g *= tint + submerged * 0.78f
        b *= tint + submerged * 0.82f
        var a = 255f * (1f - submerged * (0.35f + 0.65f * depth))
        // A thin line of foam where the water laps the bank.
        val foam = (1f - abs(submerged - 0.35f) / 0.25f).coerceIn(0f, 1f) * (1f - depth)
        if (foam > 0f) {
            r += (235f - r) * foam * 0.55f
            g += (242f - g) * foam * 0.55f
            b += (240f - b) * foam * 0.55f
            a = max(a, 255f * foam * 0.7f)
        }
        return pack(a, r, g, b)
    }

    private fun pack(a: Float, r: Float, g: Float, b: Float): Int =
        (a.toInt().coerceIn(0, 255) shl 24) or (r.toInt().coerceIn(0, 255) shl 16) or (g.toInt().coerceIn(0, 255) shl 8) or b.toInt().coerceIn(0, 255)

    /** Darkens the ground under trees, rocks, buildings and cave mouths. */
    private fun occlusion(tx0: Int, ty0: Int) {
        val d = m.d
        if (m.set != FloorSet.WILDS) {
            // Soft contact shadow where floor meets wall; corners come out darker, as they should.
            for (y in ty0 - 1..ty0 + TERRAIN_CHUNK) for (x in tx0 - 1..tx0 + TERRAIN_CHUNK) {
                if (d.tile(x, y) != WALL) continue
                var open = false
                for (dy in -1..1) for (dx in -1..1) if (d.tile(x + dx, y + dy) != WALL) open = true
                if (open) rect(tx0, ty0, x.toFloat(), y.toFloat(), x + 1f, y + 1f, 0.55f, 0.5f)
            }
            return
        }
        for (y in ty0 - 2..ty0 + TERRAIN_CHUNK + 1) for (x in tx0 - 2..tx0 + TERRAIN_CHUNK + 1) {
            when (d.tile(x, y)) {
                TREE -> ellipse(tx0, ty0, x + 0.5f, y + 0.78f, 0.75f, 0.42f, 0.42f)
                ROCK -> ellipse(tx0, ty0, x + 0.5f, y + 0.72f, 0.48f, 0.3f, 0.4f)
                ENTRANCE -> ellipse(tx0, ty0, x + 0.5f, y + 0.85f, 1.1f, 0.55f, 0.45f)
            }
        }
        for (b in d.buildings) rect(tx0, ty0, b.x.toFloat(), b.y.toFloat(), (b.x + b.w).toFloat(), (b.y + b.h).toFloat(), 0.4f, 0.45f)
    }

    private fun ellipse(tx0: Int, ty0: Int, cx: Float, cy: Float, rx: Float, ry: Float, strength: Float) {
        val ox = tx0 * TERRAIN_PX
        val oy = ty0 * TERRAIN_PX
        val x0 = max(0, ((cx - rx) * TERRAIN_PX).toInt() - ox)
        val x1 = min(CHUNK_PX - 1, ((cx + rx) * TERRAIN_PX).toInt() - ox)
        val y0 = max(0, ((cy - ry) * TERRAIN_PX).toInt() - oy)
        val y1 = min(CHUNK_PX - 1, ((cy + ry) * TERRAIN_PX).toInt() - oy)
        for (py in y0..y1) {
            val dy = ((py + oy + 0.5f) / TERRAIN_PX - cy) / ry
            for (px in x0..x1) {
                val dx = ((px + ox + 0.5f) / TERRAIN_PX - cx) / rx
                val q = 1f - (dx * dx + dy * dy)
                if (q <= 0f) continue
                val i = py * CHUNK_PX + px
                out[i] = scale(out[i], 1f - strength * q * q)
            }
        }
    }

    private fun rect(tx0: Int, ty0: Int, l: Float, t: Float, r: Float, b: Float, soft: Float, strength: Float) {
        val ox = tx0 * TERRAIN_PX
        val oy = ty0 * TERRAIN_PX
        val x0 = max(0, ((l - soft) * TERRAIN_PX).toInt() - ox)
        val x1 = min(CHUNK_PX - 1, ((r + soft) * TERRAIN_PX).toInt() - ox)
        val y0 = max(0, ((t - soft) * TERRAIN_PX).toInt() - oy)
        val y1 = min(CHUNK_PX - 1, ((b + soft) * TERRAIN_PX).toInt() - oy)
        for (py in y0..y1) {
            val wy = (py + oy + 0.5f) / TERRAIN_PX
            val ey = max(0f, max(t - wy, wy - b)) / soft
            for (px in x0..x1) {
                val wx = (px + ox + 0.5f) / TERRAIN_PX
                val ex = max(0f, max(l - wx, wx - r)) / soft
                val q = 1f - min(1f, kotlin.math.sqrt(ex * ex + ey * ey))
                if (q <= 0f) continue
                val i = py * CHUNK_PX + px
                out[i] = scale(out[i], 1f - strength * q * q)
            }
        }
    }

    /** Grass tufts, flowers, pebbles, leaves and reeds, scattered by a hash of each tile. */
    private fun clutter(tx0: Int, ty0: Int) {
        if (m.set != FloorSet.WILDS) {
            dungeonClutter(tx0, ty0)
            return
        }
        val d = m.d
        val ground = d.ground
        for (y in ty0 - 1..ty0 + TERRAIN_CHUNK) for (x in tx0 - 1..tx0 + TERRAIN_CHUNK) {
            if (x < 0 || y < 0 || x >= m.w || y >= m.h) continue
            val t = d.tile(x, y)
            if (t == WATER || t == BLOCK || t == ENTRANCE || t == WALL) continue
            var h = hash(x, y, m.signature)
            fun next(): Float {
                h = h * 1664525 + 1013904223
                return ((h ushr 8) and 0xFFFF) / 65535f
            }
            fun put(sprite: Int) {
                val px = ((x + 0.1f + next() * 0.8f) * TERRAIN_PX).toInt() - CLUTTER / 2
                val py = ((y + 0.1f + next() * 0.8f) * TERRAIN_PX).toInt() - CLUTTER / 2
                stamp(src.clutter[sprite], px - tx0 * TERRAIN_PX, py - ty0 * TERRAIN_PX, next() < 0.5f)
            }
            val nearWater = m.wet[y * m.w + x]
            val flowers = ground != null && ground[y * m.w + x] == Ground.FLOWERS
            when (m.at(x, y)) {
                Mat.GRASS -> {
                    if (flowers) {
                        val species = C_DAISIES + (tileNoise(x.toFloat(), y.toFloat(), 4f, 9) * 3.99f).toInt()
                        repeat(2 + (next() * 3).toInt()) { put(if (next() < 0.8f) species else C_DAISIES + (next() * 3.99f).toInt()) }
                    } else if (next() < 0.06f) put(C_DAISIES + (next() * 3.99f).toInt())
                    repeat((next() * 2.6f).toInt()) { put(if (next() < 0.5f) C_TUFT else if (next() < 0.5f) C_TUFT2 else C_TUFT3) }
                    if (next() < 0.05f) put(C_PEBBLES)
                }
                Mat.DRY -> {
                    repeat((next() * 2.8f).toInt()) { put(if (next() < 0.7f) C_TUFT_DRY else C_TUFT2) }
                    if (flowers || next() < 0.05f) put(C_DAISIES + 3)
                }
                Mat.FOREST -> {
                    if (next() < 0.45f) put(C_LEAVES)
                    if (next() < 0.3f) put(C_FERN)
                    if (next() < 0.14f) put(C_TWIGS)
                    if (next() < 0.07f) put(if (next() < 0.5f) C_MUSHROOMS else C_MUSHROOMS_BROWN)
                }
                Mat.DIRT -> {
                    if (next() < 0.3f) put(C_PEBBLES)
                    if (next() < 0.25f && !m.pure(x, y)) put(C_TUFT2)
                }
                Mat.SAND -> {
                    if (next() < 0.18f) put(C_PEBBLES_SAND)
                    if (nearWater && next() < 0.3f) put(C_REEDS)
                }
                Mat.MUD -> if (nearWater && next() < 0.5f) put(C_REEDS)
                Mat.COBBLE -> if (next() < 0.06f) put(C_TUFT2)
            }
        }
    }

    private fun dungeonClutter(tx0: Int, ty0: Int) {
        val d = m.d
        for (y in ty0 - 1..ty0 + TERRAIN_CHUNK) for (x in tx0 - 1..tx0 + TERRAIN_CHUNK) {
            if (x < 0 || y < 0 || x >= m.w || y >= m.h) continue
            val t = d.tile(x, y)
            if (t == WALL || t == STAIRS) continue
            var h = hash(x, y, m.signature)
            fun next(): Float {
                h = h * 1664525 + 1013904223
                return ((h ushr 8) and 0xFFFF) / 65535f
            }
            fun put(sprite: Int) {
                val px = ((x + 0.15f + next() * 0.7f) * TERRAIN_PX).toInt() - CLUTTER / 2
                val py = ((y + 0.15f + next() * 0.7f) * TERRAIN_PX).toInt() - CLUTTER / 2
                stamp(src.clutter[sprite], px - tx0 * TERRAIN_PX, py - ty0 * TERRAIN_PX, next() < 0.5f)
            }
            val mat = m.at(x, y)
            when (m.set) {
                FloorSet.CRYPT -> when (mat) {
                    DMat.FLOOR -> { if (next() < 0.03f) put(D_BONES); if (next() < 0.015f) put(D_SKULL); if (next() < 0.03f) put(D_RUBBLE) }
                    DMat.RUBBLE -> { if (next() < 0.35f) put(D_RUBBLE); if (next() < 0.1f) put(D_BONES) }
                    DMat.LOOSE -> { if (next() < 0.15f) put(D_BONES); if (next() < 0.05f) put(D_SKULL); if (next() < 0.1f) put(D_SHARDS) }
                    else -> if (next() < 0.05f) put(D_RUBBLE)
                }
                FloorSet.CAVE -> when (mat) {
                    DMat.FLOOR -> if (next() < 0.05f) put(D_RUBBLE_DARK)
                    DMat.RUBBLE -> if (next() < 0.3f) put(D_RUBBLE_DARK)
                    DMat.LOOSE -> { if (next() < 0.1f) put(D_RUBBLE_DARK); if (next() < 0.04f) put(D_BONES) }
                    else -> { if (next() < 0.3f) put(D_SHROOMS); if (next() < 0.12f) put(D_CRYSTALS) }
                }
                else -> when (mat) {
                    DMat.FLOOR -> { if (next() < 0.04f) put(D_EMBERS); if (next() < 0.03f) put(D_BONES) }
                    DMat.RUBBLE -> { if (next() < 0.25f) put(D_RUBBLE_DARK); if (next() < 0.15f) put(D_EMBERS) }
                    DMat.LOOSE -> if (next() < 0.25f) put(D_EMBERS)
                    else -> if (next() < 0.04f) put(D_SKULL)
                }
            }
        }
    }

    private fun stamp(spr: IntArray, ox: Int, oy: Int, flip: Boolean) {
        if (ox <= -CLUTTER || oy <= -CLUTTER || ox >= CHUNK_PX || oy >= CHUNK_PX) return
        for (sy in 0 until CLUTTER) {
            val y = oy + sy
            if (y < 0 || y >= CHUNK_PX) continue
            for (sx in 0 until CLUTTER) {
                val x = ox + sx
                if (x < 0 || x >= CHUNK_PX) continue
                val c = spr[sy * CLUTTER + if (flip) CLUTTER - 1 - sx else sx]
                val a = c ushr 24
                if (a == 0) continue
                val i = y * CHUNK_PX + x
                val o = out[i]
                if (o ushr 24 < 200) continue
                val k = a / 255f
                val r = ((o shr 16) and 255) + ((((c shr 16) and 255) - ((o shr 16) and 255)) * k).toInt()
                val g = ((o shr 8) and 255) + ((((c shr 8) and 255) - ((o shr 8) and 255)) * k).toInt()
                val b = (o and 255) + (((c and 255) - (o and 255)) * k).toInt()
                out[i] = (o and 0xFF000000.toInt()) or (r shl 16) or (g shl 8) or b
            }
        }
    }
}

/**
 * Overworld ground baked into [TERRAIN_CHUNK]-tile bitmaps on a background thread, with a small
 * least-recently-used cache. Missing chunks return null so the caller can draw a cheap stand-in.
 */
class Terrain(private val res: Resources) {
    @Volatile private var src: TerrainSource? = null
    private var map: TerrainMap? = null
    private var mapFor: Dungeon? = null
    private val ready = ConcurrentHashMap<Int, ImageBitmap>()
    private val pending: MutableSet<Int> = ConcurrentHashMap.newKeySet()
    private val lastUse = HashMap<Int, Int>()
    private var clock = 0
    private val lock = Any()
    @Volatile private var epoch = 0
    private val worker = Executors.newSingleThreadExecutor { r -> Thread(r, "terrain").apply { isDaemon = true } }

    fun map(d: Dungeon): TerrainMap {
        val cur = map
        if (cur != null && mapFor === d) return cur
        val nm = TerrainMap(d)
        if (cur?.signature != nm.signature) synchronized(lock) {
            epoch++
            ready.clear()
            pending.clear()
            lastUse.clear()
        }
        map = nm
        mapFor = d
        return nm
    }

    /** The baked chunk, or null while it is still being baked. */
    fun chunk(d: Dungeon, cx: Int, cy: Int): ImageBitmap? {
        val m = map(d)
        val key = cy * 4096 + cx
        lastUse[key] = clock
        ready[key]?.let { return it }
        if (synchronous) return bakeNow(m, cx, cy).also { ready[key] = it }
        request(m, key, cx, cy)
        return null
    }

    /** Bakes ahead around the view and trims the cache; call once per frame. */
    fun endFrame(d: Dungeon, cx0: Int, cy0: Int, cx1: Int, cy1: Int) {
        val m = map(d)
        clock++
        if (!synchronous) {
            val maxX = (m.w - 1) / TERRAIN_CHUNK
            val maxY = (m.h - 1) / TERRAIN_CHUNK
            for (cy in max(0, cy0 - 1)..min(maxY, cy1 + 1)) for (cx in max(0, cx0 - 1)..min(maxX, cx1 + 1)) {
                val key = cy * 4096 + cx
                if (ready.size + pending.size < MAX_CHUNKS && !ready.containsKey(key)) request(m, key, cx, cy)
            }
        }
        if (ready.size > MAX_CHUNKS) {
            val victims = ready.keys.sortedBy { lastUse[it] ?: -1 }.take(ready.size - MAX_CHUNKS)
            for (k in victims) {
                ready.remove(k)
                lastUse.remove(k)
            }
        }
    }

    private fun request(m: TerrainMap, key: Int, cx: Int, cy: Int) {
        if (!pending.add(key)) return
        val e = epoch
        worker.execute {
            try {
                if (e == epoch) {
                    val img = bakeNow(m, cx, cy)
                    synchronized(lock) { if (e == epoch) ready[key] = img }
                }
            } finally {
                pending.remove(key)
            }
        }
    }

    /** The texture set for [set], loading it (and dropping any other) on first use. */
    private fun source(set: FloorSet): TerrainSource {
        src?.let { if (it.set == set) return it }
        synchronized(this) {
            src?.let { if (it.set == set) return it }
            src = null
            return TerrainSource(res, set).also { src = it }
        }
    }

    private fun bakeNow(m: TerrainMap, cx: Int, cy: Int): ImageBitmap {
        val px = TerrainBaker(source(m.set), m).bake(cx, cy)
        return Bitmap.createBitmap(px, CHUNK_PX, CHUNK_PX, Bitmap.Config.ARGB_8888).asImageBitmap()
    }

    companion object {
        /** Bake on the calling thread (screenshot tests). */
        @Volatile var synchronous = false
    }
}

/** Repeating water textures whose shaders slide with the camera and drift with time. */
class WaterShaders(base: Bitmap, ripples: Bitmap) {
    private val baseShader = BitmapShader(base, Shader.TileMode.REPEAT, Shader.TileMode.REPEAT)
    private val rip1 = BitmapShader(ripples, Shader.TileMode.REPEAT, Shader.TileMode.REPEAT)
    private val rip2 = BitmapShader(ripples, Shader.TileMode.REPEAT, Shader.TileMode.REPEAT)
    val base = ShaderBrush(baseShader)
    val ripplesA = ShaderBrush(rip1)
    val ripplesB = ShaderBrush(rip2)
    private val mx = Matrix()

    fun update(ox: Float, oy: Float, tile: Float, time: Float) {
        val s = tile / TERRAIN_PX
        mx.setScale(s, s)
        mx.postTranslate(-ox + time * tile * 0.04f, -oy + time * tile * 0.02f)
        baseShader.setLocalMatrix(mx)
        mx.setScale(s, s)
        mx.postTranslate(-ox - time * tile * 0.16f, -oy + time * tile * 0.07f)
        rip1.setLocalMatrix(mx)
        mx.setScale(s * 1.37f, s * 1.37f)
        mx.postRotate(33f)
        mx.postTranslate(-ox + time * tile * 0.11f, -oy - time * tile * 0.09f)
        rip2.setLocalMatrix(mx)
    }
}
