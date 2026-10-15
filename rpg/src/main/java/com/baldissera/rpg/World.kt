package com.baldissera.rpg

import androidx.compose.ui.graphics.Color
import kotlin.math.abs
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min
import kotlin.random.Random

const val WALL = 0
const val FLOOR = 1
const val STAIRS = 2
const val TREE = 3
const val ROCK = 4
const val WATER = 5
const val ENTRANCE = 6

/** Cells in the overworld ground texture strip. */
object Ground {
    const val DIRT = 4
    const val SAND = 6
    const val FLOWERS = 7
}

fun floorInt(f: Float): Int = kotlin.math.floor(f).toInt()

enum class Biome(
    val title: String,
    val tex: String,
    val darkness: Color,
    val darknessAlpha: Float,
    val torchChance: Float,
) {
    OVERWORLD("Landet", "camp", Color(0xFF040A1C), 0.7f, 0f),
    CRYPT("Krypten", "crypt", Color.Black, 0.94f, 0.08f),
    CAVE("Hulerne", "cave", Color(0xFF020302), 0.93f, 0.05f),
    HELL("Helvede", "hell", Color(0xFF1C0400), 0.86f, 0.06f),
    ;

    companion object {
        fun forFloor(floor: Int) = when {
            floor <= 0 -> OVERWORLD
            floor <= 3 -> CRYPT
            floor <= 6 -> CAVE
            else -> HELL
        }
    }
}

/** A dungeon entrance in the overworld. [quest] is the number of story bosses needed to enter. */
enum class Region(val title: String, val firstFloor: Int, val quest: Int, val sprite: Int, val lockText: String) {
    CRYPT("Krypten", 1, 0, 10, ""),
    CAVE("Hulerne", 4, 1, 11, "Besejr Knoglekongen i Krypten først"),
    HELL("Helvedes port", 7, 2, 12, "Besejr Edderkoppedronningen i Hulerne først"),
}

class Entrance(val x: Int, val y: Int, val region: Region)

class Room(val x: Int, val y: Int, val w: Int, val h: Int) {
    val cx: Int get() = x + w / 2
    val cy: Int get() = y + h / 2

    fun intersects(o: Room, pad: Int) =
        x - pad < o.x + o.w && x + w + pad > o.x && y - pad < o.y + o.h && y + h + pad > o.y

    fun contains(px: Float, py: Float) = px >= x && px < x + w && py >= y && py < y + h
}

class Dungeon(
    val biome: Biome,
    val w: Int,
    val h: Int,
    val tiles: IntArray,
    val rooms: List<Room>,
    val start: Room,
    val exit: Room,
    val torches: List<Int>,
    val variant: FloatArray,
    val props: MutableList<Prop>,
    /** Overworld only: ground texture cell per tile. */
    val ground: IntArray? = null,
    val entrances: List<Entrance> = emptyList(),
    /** Overworld only: the walled village (safe area). */
    val village: Room? = null,
    val merchantX: Float = 0f,
    val merchantY: Float = 0f,
) {
    fun tile(x: Int, y: Int): Int = if (x < 0 || y < 0 || x >= w || y >= h) WALL else tiles[y * w + x]
    fun walkable(x: Int, y: Int): Boolean {
        val t = tile(x, y)
        return t == FLOOR || t == STAIRS || t == ENTRANCE
    }
    fun walkableAt(fx: Float, fy: Float) = walkable(floorInt(fx), floorInt(fy))
    val hasMerchant: Boolean get() = village != null

    companion object {
        fun generate(rnd: Random, biome: Biome, w: Int = 58, h: Int = 58): Dungeon {
            val tiles = IntArray(w * h)
            val rooms = mutableListOf<Room>()
            var attempts = 0
            while (rooms.size < 13 && attempts < 500) {
                attempts++
                val rw = rnd.nextInt(5, 12)
                val rh = rnd.nextInt(5, 10)
                val r = Room(rnd.nextInt(2, w - rw - 2), rnd.nextInt(2, h - rh - 2), rw, rh)
                if (rooms.none { it.intersects(r, 2) }) rooms += r
            }

            fun carve(x: Int, y: Int) {
                if (x in 1 until w - 1 && y in 1 until h - 1) tiles[y * w + x] = FLOOR
            }

            for (r in rooms) for (yy in r.y until r.y + r.h) for (xx in r.x until r.x + r.w) carve(xx, yy)
            if (biome == Biome.CAVE) {
                for (r in rooms) repeat(r.w + r.h) {
                    carve(r.x - 1 + rnd.nextInt(r.w + 2), r.y - 1 + rnd.nextInt(r.h + 2))
                }
            }

            fun corridor(a: Room, b: Room) {
                var x = a.cx
                var y = a.cy
                fun stepX() {
                    while (x != b.cx) {
                        carve(x, y); carve(x, y + 1)
                        x += if (b.cx > x) 1 else -1
                    }
                }
                fun stepY() {
                    while (y != b.cy) {
                        carve(x, y); carve(x + 1, y)
                        y += if (b.cy > y) 1 else -1
                    }
                }
                if (rnd.nextBoolean()) { stepX(); stepY() } else { stepY(); stepX() }
                carve(x, y)
            }

            val connected = mutableListOf(rooms[0])
            for (r in rooms.drop(1)) {
                corridor(r, connected.minBy { abs(it.cx - r.cx) + abs(it.cy - r.cy) })
                connected += r
            }
            repeat(2) { corridor(rooms.random(rnd), rooms.random(rnd)) }

            val start = rooms[0]
            val exit = rooms.maxBy { abs(it.cx - start.cx) + abs(it.cy - start.cy) }
            tiles[exit.cy * w + exit.cx] = STAIRS

            val torches = mutableListOf<Int>()
            for (y in 0 until h - 1) for (x in 0 until w) {
                val i = y * w + x
                if (tiles[i] == WALL && tiles[i + w] != WALL && rnd.nextFloat() < biome.torchChance) torches += i
            }

            val props = mutableListOf<Prop>()
            fun freeSpot(r: Room): Pair<Float, Float>? {
                repeat(10) {
                    val px = r.x + 1 + rnd.nextInt(max(1, r.w - 2))
                    val py = r.y + 1 + rnd.nextInt(max(1, r.h - 2))
                    if (tiles[py * w + px] == FLOOR && props.none { abs(it.x - px - 0.5f) < 1f && abs(it.y - py - 0.5f) < 1f } &&
                        !(px == r.cx && py == r.cy)
                    ) return px + 0.5f to py + 0.5f
                }
                return null
            }
            for (r in rooms) {
                if (r === start) continue
                repeat(rnd.nextInt(1, 4)) {
                    freeSpot(r)?.let { (px, py) ->
                        val t = when (rnd.nextInt(10)) {
                            in 0..3 -> PropType.BARREL
                            in 4..6 -> PropType.URN
                            7 -> PropType.CRATE
                            else -> PropType.SKULLS
                        }
                        props += Prop(t, px, py)
                    }
                }
                if (rnd.nextFloat() < 0.22f) freeSpot(r)?.let { (px, py) -> props += Prop(PropType.CHEST, px, py) }
                if (rnd.nextFloat() < 0.12f) freeSpot(r)?.let { (px, py) -> props += Prop(PropType.SHRINE, px, py) }
            }

            val variant = FloatArray(w * h) { rnd.nextFloat() }
            return Dungeon(biome, w, h, tiles, rooms, start, exit, torches, variant, props)
        }

        /** Tileable smooth value noise in 0..1 over a w*h grid. */
        private fun noise(w: Int, h: Int, cells: Int, rnd: Random): FloatArray {
            val g = FloatArray((cells + 1) * (cells + 1)) { rnd.nextFloat() }
            fun at(cx: Int, cy: Int) = g[cy * (cells + 1) + cx]
            return FloatArray(w * h) { i ->
                val fx = (i % w).toFloat() / w * cells
                val fy = (i / w).toFloat() / h * cells
                val x0 = fx.toInt()
                val y0 = fy.toInt()
                var tx = fx - x0
                var ty = fy - y0
                tx = tx * tx * (3 - 2 * tx)
                ty = ty * ty * (3 - 2 * ty)
                val a = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * tx
                val b = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * tx
                a + (b - a) * ty
            }
        }

        /** The open world above the dungeons: forests, lakes, paths, a walled village and three entrances. */
        fun overworld(seed: Long): Dungeon {
            val rnd = Random(seed)
            val w = 84
            val h = 84
            val tiles = IntArray(w * h) { FLOOR }
            val ground = IntArray(w * h) { rnd.nextInt(4) }
            val forest = noise(w, h, 9, rnd)
            val detail = noise(w, h, 21, rnd)
            val lake = noise(w, h, 6, rnd)
            val meadow = noise(w, h, 12, rnd)
            val keep = BooleanArray(w * h)

            fun idx(x: Int, y: Int) = y * w + x
            fun inside(x: Int, y: Int) = x in 0 until w && y in 0 until h
            fun clear(x: Int, y: Int, r: Int) {
                for (yy in y - r..y + r) for (xx in x - r..x + r) if (inside(xx, yy)) keep[idx(xx, yy)] = true
            }

            // Village in the middle.
            val vx = 34
            val vy = 36
            val vw = 17
            val vh = 13
            val village = Room(vx, vy, vw, vh)
            clear(vx + vw / 2, vy + vh / 2, 11)

            val entrances = listOf(
                Entrance(14, 15, Region.CRYPT),
                Entrance(70, 29, Region.CAVE),
                Entrance(44, 73, Region.HELL),
            )
            for (e in entrances) clear(e.x, e.y, 3)

            // Winding dirt paths from the village gates to each entrance.
            fun path(fromX: Int, fromY: Int, toX: Int, toY: Int) {
                var x = fromX.toFloat()
                var y = fromY.toFloat()
                var guard = 0
                while (hypot(toX - x, toY - y) > 1f && guard++ < 400) {
                    val d = hypot(toX - x, toY - y)
                    val wob = (detail[idx(x.toInt().coerceIn(0, w - 1), y.toInt().coerceIn(0, h - 1))] - 0.5f) * 1.6f
                    val dx = (toX - x) / d
                    val dy = (toY - y) / d
                    x += dx - dy * wob * 0.6f
                    y += dy + dx * wob * 0.6f
                    for (oy in 0..1) for (ox in 0..1) {
                        val px = x.toInt() + ox
                        val py = y.toInt() + oy
                        if (inside(px, py)) {
                            ground[idx(px, py)] = Ground.DIRT + rnd.nextInt(2)
                            keep[idx(px, py)] = true
                        }
                    }
                }
            }
            path(vx + vw / 2, vy - 1, entrances[0].x, entrances[0].y + 1)
            path(vx + vw, vy + vh / 2, entrances[1].x, entrances[1].y + 1)
            path(vx + vw / 2, vy + vh, entrances[2].x, entrances[2].y + 1)
            path(vx - 1, vy + vh / 2, 6, vy + vh / 2)

            // Lakes with sandy shores, then forest.
            for (y in 0 until h) for (x in 0 until w) {
                val i = idx(x, y)
                val edge = min(min(x, y), min(w - 1 - x, h - 1 - y))
                if (edge < 3) {
                    tiles[i] = TREE
                    continue
                }
                if (keep[i]) continue
                val l = lake[i] + (detail[i] - 0.5f) * 0.12f
                if (l > 0.72f) {
                    tiles[i] = WATER
                } else if (l > 0.66f) {
                    ground[i] = Ground.SAND
                } else {
                    val f = forest[i] + (detail[i] - 0.5f) * 0.25f
                    if (f > 0.55f && rnd.nextFloat() < (f - 0.5f) * 2.6f) tiles[i] = TREE
                    else if (rnd.nextFloat() < 0.012f) tiles[i] = ROCK
                    else if (meadow[i] > 0.68f) ground[i] = Ground.FLOWERS
                }
            }

            // Village palisade with four gates.
            for (x in vx until vx + vw) for (y in vy until vy + vh) {
                val i = idx(x, y)
                tiles[i] = FLOOR
                if (ground[i] >= Ground.DIRT && ground[i] != Ground.FLOWERS) ground[i] = rnd.nextInt(4)
            }
            for (x in vx - 1..vx + vw) {
                tiles[idx(x, vy - 1)] = WALL
                tiles[idx(x, vy + vh)] = WALL
            }
            for (y in vy - 1..vy + vh) {
                tiles[idx(vx - 1, y)] = WALL
                tiles[idx(vx + vw, y)] = WALL
            }
            for (k in 0..1) {
                tiles[idx(vx + vw / 2 + k - 1, vy - 1)] = FLOOR
                tiles[idx(vx + vw / 2 + k - 1, vy + vh)] = FLOOR
                tiles[idx(vx - 1, vy + vh / 2 + k)] = FLOOR
                tiles[idx(vx + vw, vy + vh / 2 + k)] = FLOOR
            }
            // Dirt square around the fire.
            for (y in vy + 4..vy + 8) for (x in vx + 6..vx + 10) ground[idx(x, y)] = Ground.DIRT + rnd.nextInt(2)

            for (e in entrances) tiles[idx(e.x, e.y)] = ENTRANCE

            val cx = vx + vw / 2
            val cy = vy + vh / 2
            val props = mutableListOf(
                Prop(PropType.CAMPFIRE, cx + 0.5f, cy + 0.5f),
                Prop(PropType.SHRINE, vx + 2.5f, vy + vh - 2.5f),
                Prop(PropType.GRAVESTONE, vx + 1.5f, vy + 1.5f), Prop(PropType.GRAVESTONE, vx + 3.5f, vy + 1.5f),
                Prop(PropType.GRAVESTONE, vx + 1.5f, vy + 3.5f),
                Prop(PropType.CRATE, vx + vw - 2.5f, vy + 1.5f), Prop(PropType.BARREL, vx + vw - 3.5f, vy + 1.5f),
                Prop(PropType.BARREL, vx + vw - 2.5f, vy + 2.7f),
                Prop(PropType.SIGN, vx + vw / 2 + 1.8f, vy - 2.5f),
            )
            props.forEach { it.used = false }

            // Ruins, treasure and shrines out in the wild.
            fun wildSpot(minDist: Float): Pair<Float, Float>? {
                repeat(60) {
                    val x = rnd.nextInt(4, w - 4)
                    val y = rnd.nextInt(4, h - 4)
                    if (tiles[idx(x, y)] == FLOOR && !village.contains(x.toFloat(), y.toFloat()) &&
                        hypot((x - cx).toFloat(), (y - cy).toFloat()) > minDist &&
                        props.none { abs(it.x - x - 0.5f) < 2f && abs(it.y - y - 0.5f) < 2f }
                    ) return x + 0.5f to y + 0.5f
                }
                return null
            }
            repeat(6) {
                wildSpot(12f)?.let { (x, y) ->
                    props += Prop(PropType.PILLAR, x, y)
                    if (rnd.nextBoolean()) props += Prop(PropType.URN, x + 1f, y + 0.3f)
                    if (rnd.nextBoolean()) props += Prop(PropType.SKULLS, x - 0.8f, y + 0.6f)
                }
            }
            repeat(8) { wildSpot(14f)?.let { (x, y) -> props += Prop(PropType.CHEST, x, y) } }
            repeat(3) { wildSpot(16f)?.let { (x, y) -> props += Prop(PropType.SHRINE, x, y) } }
            repeat(10) { wildSpot(10f)?.let { (x, y) -> props += Prop(if (rnd.nextBoolean()) PropType.BARREL else PropType.CRATE, x, y) } }

            val variant = FloatArray(w * h) { rnd.nextFloat() }
            val start = Room(cx - 2, cy + 2, 4, 3)
            val exit = Room(entrances[0].x, entrances[0].y, 1, 1)
            return Dungeon(
                Biome.OVERWORLD, w, h, tiles, listOf(village), start, exit, emptyList(), variant, props,
                ground = ground, entrances = entrances, village = village,
                merchantX = cx + 3.5f, merchantY = cy - 0.5f,
            )
        }
    }
}
