package com.baldissera.rpg

import androidx.compose.ui.graphics.Color
import kotlin.math.abs
import kotlin.math.atan2
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sin
import kotlin.random.Random

const val WALL = 0
const val FLOOR = 1
const val STAIRS = 2
const val TREE = 3
const val ROCK = 4
const val WATER = 5
const val ENTRANCE = 6
/** Occupied by a building; not walkable, draws ground underneath. */
const val BLOCK = 7

/** Cells in the overworld ground texture strip. */
object Ground {
    const val DIRT = 4
    const val SAND = 6
    const val FLOWERS = 7
}

fun floorInt(f: Float): Int = kotlin.math.floor(f).toInt()

/** Chance a desert tile starts out as open sand, and how strongly the large-scale noise pushes it either way. */
private const val DESERT_OPEN = 0.6f
private const val DESERT_BIAS = 0.6f

enum class Biome(
    val title: String,
    val tex: String,
    val darkness: Color,
    val darknessAlpha: Float,
    val torchChance: Float,
) {
    OVERWORLD("The Wilds", "camp", Color(0xFF040A1C), 0.7f, 0f),
    CRYPT("The Crypt", "crypt", Color(0xFF020104), 0.88f, 0.12f),
    CAVE("The Caves", "cave", Color(0xFF010303), 0.88f, 0.08f),
    HELL("Hell", "hell", Color(0xFF1C0400), 0.8f, 0.08f),
    /** Outdoors under the sun; the 2D fallback draws its cliffs with the cave textures. */
    DESERT("The Scorched Sands", "cave", Color(0xFF2A1A08), 0.12f, 0f),
    ;

    companion object {
        fun forFloor(floor: Int) = when {
            floor < 0 -> DESERT
            floor == 0 -> OVERWORLD
            floor <= 3 -> CRYPT
            floor <= 6 -> CAVE
            else -> HELL
        }
    }
}

/**
 * The Scorched Sands, an optional side region, number their floors below zero: the stairs of the main dungeon
 * always lead to floor + 1, so its endless depths never run into the desert, and the desert never counts towards
 * `deepest` (prices, merchant stock and the dungeon entrances stay as they were). Desert depth 1 is floor -1,
 * depth 2 is -2, and the Sand Pharaoh holds court on depth 3 (-3).
 */
const val DESERT_FLOORS = 3
const val DESERT_FIRST = -1
const val DESERT_LAST = -DESERT_FLOORS
/** Monster level on desert depth 1; each depth adds one, a match for dungeon floors 5 to 8. */
const val DESERT_LEVEL = 5

fun isDesertFloor(floor: Int) = floor in DESERT_LAST..DESERT_FIRST
fun desertDepth(floor: Int) = -floor
fun desertFloor(depth: Int) = -depth

/** A dungeon entrance in the overworld. [quest] is the number of story bosses needed to enter. */
enum class Region(val title: String, val firstFloor: Int, val quest: Int, val sprite: Int, val lockText: String) {
    CRYPT("The Crypt", 1, 0, 10, ""),
    CAVE("The Caves", 4, 1, 11, "Defeat the Skeleton King in the Crypt first"),
    HELL("The Gate of Hell", 7, 2, 12, "Defeat the Spider Queen in the Caves first"),
    /** A side region off the main quest; opens with the caves, after the Skeleton King. */
    DESERT("The Scorched Sands", DESERT_FIRST, 1, 11, "a sandstorm bars the way until the Skeleton King falls"),
}

/** Ground cells of a desert level (its Dungeon.ground); TerrainMap turns them into desert materials. */
object DesertGround {
    /** Oasis grass. Any cell below [HARDPAN] counts as grass, like the overworld's four grass cells. */
    const val GRASS = 0
    /** Rocky hardpan at the foot of the cliffs. */
    const val HARDPAN = Ground.DIRT
    /** Sandstone paving in the ruins. */
    const val PAVING = Ground.DIRT + 1
    /** Open sand; TerrainMap splits it into fine sand and rippled dunes. */
    const val SAND = Ground.SAND
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
    val buildings: List<Building> = emptyList(),
    val npcs: MutableList<Npc> = mutableListOf(),
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
            for (r in rooms) decorate(r, biome, tiles, w, props, rnd, r === start, r === exit)

            val variant = FloatArray(w * h) { rnd.nextFloat() }
            return Dungeon(biome, w, h, tiles, rooms, start, exit, torches, variant, props)
        }

        /**
         * Gives a room a theme: tombs, chapels, libraries and armouries in the crypt, crystal grottos in the caves,
         * altars and obsidian in hell. Solid pieces stay off the centre lines where corridors enter.
         */
        private fun decorate(r: Room, biome: Biome, tiles: IntArray, w: Int, props: MutableList<Prop>, rnd: Random, isStart: Boolean, isExit: Boolean) {
            fun free(x: Int, y: Int, solid: Boolean): Boolean {
                if (x < r.x || y < r.y || x >= r.x + r.w || y >= r.y + r.h) return false
                if (tiles[y * w + x] != FLOOR) return false
                if (solid && (x == r.cx || x == r.cx + 1 || x == r.cx - 1 || y == r.cy || y == r.cy + 1 || y == r.cy - 1)) return false
                return props.none { abs(it.x - x - 0.5f) < 0.9f && abs(it.y - y - 0.5f) < 0.9f }
            }
            fun put(t: PropType, x: Int, y: Int) {
                if (free(x, y, t.solid)) props += Prop(t, x + 0.5f, y + 0.5f)
            }
            val top = r.y
            val left = r.x
            val right = r.x + r.w - 1
            val bottom = r.y + r.h - 1
            fun corners(t: PropType) {
                put(t, left + 1, top + 1); put(t, right - 1, top + 1); put(t, left + 1, bottom - 1); put(t, right - 1, bottom - 1)
            }
            fun alongTop(t: PropType, step: Int) {
                var x = left + 1
                while (x <= right - 1) { put(t, x, top); x += step }
            }
            when (biome) {
                Biome.CRYPT -> when (if (isStart) 4 else if (isExit) 1 else rnd.nextInt(5)) {
                    0 -> { // tomb
                        var x = left + 1
                        while (x < right) { put(PropType.SARCOPHAGUS, x, top + 1); put(PropType.SARCOPHAGUS, x, bottom - 1); x += 2 }
                        put(PropType.TABLE, left, r.cy + 2)
                    }
                    1 -> { // chapel
                        put(PropType.ALTAR, r.cx, top)
                        put(PropType.BANNER, r.cx - 2, top); put(PropType.BANNER, r.cx + 2, top)
                        corners(PropType.BRAZIER)
                        var y = top + 2
                        while (y < bottom) { put(PropType.COLUMN, left + 1, y); put(PropType.COLUMN, right - 1, y); y += 2 }
                    }
                    2 -> { // library
                        alongTop(PropType.BOOKSHELF, 1)
                        put(PropType.TABLE, r.cx + 2, r.cy + 2); put(PropType.BRAZIER, left, bottom)
                    }
                    3 -> { // armoury
                        alongTop(PropType.WEAPON_RACK, 2)
                        put(PropType.BARREL, left, bottom); put(PropType.CRATE, right, bottom); put(PropType.BANNER, left, top + 2)
                    }
                    else -> { corners(PropType.BRAZIER); put(PropType.BONEPILE, r.cx + 2, r.cy + 2) }
                }
                Biome.CAVE -> {
                    repeat(r.w * r.h / 9) {
                        val t = listOf(PropType.STALAGMITES, PropType.STALAGMITES, PropType.CRYSTALS, PropType.MUSHROOMS, PropType.BONEPILE).random(rnd)
                        put(t, left + rnd.nextInt(r.w), top + rnd.nextInt(r.h))
                    }
                    if (rnd.nextFloat() < 0.25f) put(PropType.CAGE, right - 1, top + 1)
                }
                Biome.HELL -> {
                    corners(PropType.BRAZIER)
                    repeat(r.w * r.h / 12) {
                        val t = listOf(PropType.OBSIDIAN, PropType.OBSIDIAN, PropType.BONEPILE, PropType.CAGE).random(rnd)
                        put(t, left + rnd.nextInt(r.w), top + rnd.nextInt(r.h))
                    }
                    if (isExit || rnd.nextFloat() < 0.3f) { put(PropType.ALTAR, r.cx, top); put(PropType.BANNER, r.cx - 2, top); put(PropType.BANNER, r.cx + 2, top) }
                }
                Biome.OVERWORLD, Biome.DESERT -> {}
            }
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

        private val DX4 = intArrayOf(1, -1, 0, 0)
        private val DY4 = intArrayOf(0, 0, 1, -1)

        private fun passable(t: Int) = t == FLOOR || t == STAIRS || t == ENTRANCE

        /**
         * Steps on foot from ([sx], [sy]) to every tile, moving in four directions (-1 where it cannot be reached).
         * Entrances are reached but not walked through.
         */
        fun walkDistances(tiles: IntArray, w: Int, h: Int, sx: Int, sy: Int): IntArray {
            val dist = IntArray(w * h) { -1 }
            if (sx !in 0 until w || sy !in 0 until h || !passable(tiles[sy * w + sx])) return dist
            val queue = IntArray(w * h)
            var head = 0
            var tail = 0
            dist[sy * w + sx] = 0
            queue[tail++] = sy * w + sx
            while (head < tail) {
                val i = queue[head++]
                if (tiles[i] == ENTRANCE && dist[i] > 0) continue
                val x = i % w
                val y = i / w
                for (k in 0..3) {
                    val nx = x + DX4[k]
                    val ny = y + DY4[k]
                    if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue
                    val j = ny * w + nx
                    if (dist[j] >= 0 || !passable(tiles[j])) continue
                    dist[j] = dist[i] + 1
                    queue[tail++] = j
                }
            }
            return dist
        }

        /** Which tiles can be reached on foot from ([sx], [sy]). */
        fun flood(tiles: IntArray, w: Int, h: Int, sx: Int, sy: Int): BooleanArray {
            val d = walkDistances(tiles, w, h, sx, sy)
            return BooleanArray(w * h) { d[it] >= 0 }
        }

        /**
         * Cuts a lane two tiles wide from ([x0], [y0]) to ([x1], [y1]), turning the tiles [cut] accepts into floor and
         * staying [margin] tiles clear of the map's edges.
         */
        private inline fun carveLine(tiles: IntArray, w: Int, h: Int, x0: Int, y0: Int, x1: Int, y1: Int, margin: Int, cut: (Int) -> Boolean) {
            val steps = max(abs(x1 - x0), abs(y1 - y0)).coerceAtLeast(1)
            for (s in 0..steps) {
                val x = x0 + (x1 - x0) * s / steps
                val y = y0 + (y1 - y0) * s / steps
                for (oy in 0..1) for (ox in 0..1) {
                    val px = x + ox
                    val py = y + oy
                    if (px < margin || py < margin || px >= w - margin || py >= h - margin) continue
                    val i = py * w + px
                    if (cut(tiles[i])) tiles[i] = FLOOR
                }
            }
        }

        /**
         * A level of the Scorched Sands, out under the sky: wide basins of sand walled in by sandstone cliffs and dune
         * ridges (WALL), two or three ruined temples, an oasis, and, as far from the arrival as walking goes, the stairs
         * on to the next depth or, on the last depth, the Sand Pharaoh's court. [Dungeon.ground] holds [DesertGround]
         * cells, which TerrainMap turns into the desert's ground materials.
         */
        fun desert(rnd: Random, depth: Int, w: Int = 64, h: Int = 64): Dungeon {
            val last = depth >= DESERT_FLOORS
            val tiles = IntArray(w * h) { WALL }
            val ground = IntArray(w * h) { DesertGround.SAND }
            fun idx(x: Int, y: Int) = y * w + x
            fun inner(x: Int, y: Int) = x >= 2 && y >= 2 && x < w - 2 && y < h - 2
            fun free(x: Int, y: Int) = x in 0 until w && y in 0 until h && tiles[idx(x, y)] == FLOOR

            // Open sand: a cellular automaton over large-scale noise grows wide basins between rocky ridges.
            val basin = noise(w, h, 5, rnd)
            for (y in 2 until h - 2) for (x in 2 until w - 2) {
                if (rnd.nextFloat() < DESERT_OPEN + (basin[idx(x, y)] - 0.5f) * DESERT_BIAS) tiles[idx(x, y)] = FLOOR
            }
            val next = IntArray(w * h)
            repeat(5) {
                for (y in 0 until h) for (x in 0 until w) {
                    var walls = 0
                    for (dy in -1..1) for (dx in -1..1) if (!free(x + dx, y + dy)) walls++
                    next[idx(x, y)] = if (inner(x, y) && walls < 5) FLOOR else WALL
                }
                next.copyInto(tiles)
            }

            // One connected desert: small pockets fill with rock, bigger basins get a pass cut to the biggest one.
            fun connect() {
                repeat(12) {
                    val label = IntArray(w * h) { -1 }
                    val sizes = mutableListOf<Int>()
                    for (i in 0 until w * h) {
                        val t = tiles[i]
                        if (label[i] >= 0 || (t != FLOOR && t != STAIRS)) continue
                        val d = walkDistances(tiles, w, h, i % w, i / w)
                        var n = 0
                        for (j in d.indices) if (d[j] >= 0) {
                            label[j] = sizes.size
                            n++
                        }
                        sizes += n
                    }
                    if (sizes.size <= 1) return
                    val main = sizes.indices.maxBy { sizes[it] }
                    // Distance through the rock from the main basin finds each other basin's shortest pass.
                    val far = IntArray(w * h) { -1 }
                    val from = IntArray(w * h)
                    val queue = IntArray(w * h)
                    var head = 0
                    var tail = 0
                    for (i in label.indices) if (label[i] == main) {
                        far[i] = 0
                        from[i] = i
                        queue[tail++] = i
                    }
                    while (head < tail) {
                        val i = queue[head++]
                        val x = i % w
                        val y = i / w
                        for (k in 0..3) {
                            val nx = x + DX4[k]
                            val ny = y + DY4[k]
                            if (!inner(nx, ny)) continue
                            val j = idx(nx, ny)
                            if (far[j] >= 0) continue
                            far[j] = far[i] + 1
                            from[j] = from[i]
                            queue[tail++] = j
                        }
                    }
                    for (c in sizes.indices) {
                        if (c == main) continue
                        if (sizes[c] < 14) {
                            for (j in label.indices) if (label[j] == c) tiles[j] = WALL
                            continue
                        }
                        var best = -1
                        for (j in label.indices) if (label[j] == c && far[j] >= 0 && (best < 0 || far[j] < far[best])) best = j
                        if (best < 0) continue
                        val to = from[best]
                        carveLine(tiles, w, h, best % w, best / w, to % w, to / w, 2) { it == WALL || it == WATER }
                    }
                }
            }
            connect()

            // Arrive in one corner; the way on lies wherever the walk there is longest.
            val corner = rnd.nextInt(4)
            val aimX = if (corner % 2 == 0) 9 else w - 10
            val aimY = if (corner < 2) 9 else h - 10
            var startI = -1
            var startD = Int.MAX_VALUE
            for (y in 3 until h - 3) for (x in 3 until w - 3) {
                var clear = true
                for (dy in -1..1) for (dx in -1..1) if (!free(x + dx, y + dy)) clear = false
                val dd = abs(x - aimX) + abs(y - aimY)
                if (clear && dd < startD) {
                    startD = dd
                    startI = idx(x, y)
                }
            }
            if (startI < 0) {
                for (y in aimY - 2..aimY + 2) for (x in aimX - 2..aimX + 2) tiles[idx(x, y)] = FLOOR
                startI = idx(aimX, aimY)
                connect()
            }
            val sx = startI % w
            val sy = startI / w
            val reach = walkDistances(tiles, w, h, sx, sy)
            val farthest = reach.indices.maxBy { reach[it] }
            // The way on: stairs on a small paved landing, or a wide paved court for the pharaoh.
            val pr = if (last) 6 else 2
            val ex = (farthest % w).coerceIn(2 + pr, w - 3 - pr)
            val ey = (farthest / w).coerceIn(2 + pr, h - 3 - pr)
            val plaza = Room(ex - pr, ey - pr, 2 * pr + 1, 2 * pr + 1)
            for (y in plaza.y until plaza.y + plaza.h) for (x in plaza.x until plaza.x + plaza.w) {
                tiles[idx(x, y)] = FLOOR
                ground[idx(x, y)] = DesertGround.PAVING
            }
            tiles[idx(ex, ey)] = STAIRS

            // Ruined sandstone temples with broken walls, standing in the open sand.
            val ruins = mutableListOf<Room>()
            val wantRuins = 2 + rnd.nextInt(2)
            var tries = 0
            while (ruins.size < wantRuins && tries++ < 400) {
                val rw = rnd.nextInt(7, 12)
                val rh = rnd.nextInt(6, 10)
                val ruin = Room(rnd.nextInt(3, w - rw - 3), rnd.nextInt(3, h - rh - 3), rw, rh)
                if (ruin.intersects(plaza, 3) || ruins.any { it.intersects(ruin, 3) }) continue
                if (hypot((ruin.cx - sx).toFloat(), (ruin.cy - sy).toFloat()) < 11f) continue
                var n = 0
                for (y in ruin.y until ruin.y + ruin.h) for (x in ruin.x until ruin.x + ruin.w) if (free(x, y)) n++
                if (n < rw * rh * (if (tries < 250) 0.55f else 0.3f)) continue
                ruins += ruin
            }
            for (ru in ruins) {
                for (y in ru.y - 1..ru.y + ru.h) for (x in ru.x - 1..ru.x + ru.w) {
                    val i = idx(x, y)
                    // A ring of open sand around the walls, so every doorway leads somewhere.
                    if (x == ru.x - 1 || y == ru.y - 1 || x == ru.x + ru.w || y == ru.y + ru.h) {
                        if (tiles[i] == WALL) tiles[i] = FLOOR
                        continue
                    }
                    ground[i] = DesertGround.PAVING
                    val wallX = x == ru.x || x == ru.x + ru.w - 1
                    val wallY = y == ru.y || y == ru.y + ru.h - 1
                    val door = (wallY && abs(x - ru.cx) <= 1) || (wallX && abs(y - ru.cy) <= 1)
                    tiles[i] = when {
                        !wallX && !wallY -> FLOOR
                        wallX && wallY -> WALL
                        door -> FLOOR
                        rnd.nextFloat() < 0.68f -> WALL
                        else -> FLOOR
                    }
                }
            }

            // The oasis: a pool ringed with grass in the widest stretch of open sand.
            var oasis: Room? = null
            run {
                var best = -1
                var bestScore = -1f
                for (y in 8 until h - 8 step 2) for (x in 8 until w - 8 step 2) {
                    if (hypot((x - sx).toFloat(), (y - sy).toFloat()) < 10f) continue
                    if (abs(x - ex) < pr + 8 && abs(y - ey) < pr + 8) continue
                    val area = Room(x - 6, y - 6, 13, 13)
                    if (ruins.any { it.intersects(area, 0) }) continue
                    var n = 0
                    for (dy in -6..6) for (dx in -6..6) if (dx * dx + dy * dy <= 36 && free(x + dx, y + dy)) n++
                    val score = n + rnd.nextFloat() * 6f
                    if (score > bestScore) {
                        bestScore = score
                        best = idx(x, y)
                    }
                }
                if (best < 0) return@run
                val ox = best % w
                val oy = best / w
                val pool = 2.1f + rnd.nextFloat() * 0.9f
                val ph = rnd.nextFloat() * 6.28f
                for (dy in -6..6) for (dx in -6..6) {
                    val x = ox + dx
                    val y = oy + dy
                    if (!inner(x, y)) continue
                    val i = idx(x, y)
                    val dd = hypot(dx.toFloat(), dy.toFloat())
                    val a = atan2(dy.toFloat(), dx.toFloat())
                    val edge = pool + 0.5f * sin(a * 3f + ph) + 0.3f * sin(a * 5f + ph * 2f)
                    when {
                        dd <= edge -> {
                            tiles[i] = WATER
                            ground[i] = DesertGround.GRASS
                        }
                        dd <= edge + 2.3f -> {
                            tiles[i] = FLOOR
                            ground[i] = DesertGround.GRASS
                        }
                        dd <= 5.8f -> if (tiles[i] == WALL) tiles[i] = FLOOR
                    }
                }
                oasis = Room(ox - 5, oy - 5, 11, 11)
            }

            // Everything joined up and reachable from the arrival; anything still cut off turns to rock.
            connect()
            if (walkDistances(tiles, w, h, sx, sy)[idx(ex, ey)] < 0) carveLine(tiles, w, h, sx, sy, ex, ey, 2) { it == WALL || it == WATER }
            val walk = walkDistances(tiles, w, h, sx, sy)
            for (i in tiles.indices) if ((tiles[i] == FLOOR || tiles[i] == STAIRS) && walk[i] < 0) tiles[i] = WALL

            // Rocky hardpan at the foot of the cliffs and in scattered flats; the cliffs themselves are rock.
            val flats = noise(w, h, 9, rnd)
            for (y in 0 until h) for (x in 0 until w) {
                val i = idx(x, y)
                if (ground[i] != DesertGround.SAND) continue
                if (tiles[i] == WALL) {
                    ground[i] = DesertGround.HARDPAN
                    continue
                }
                var cliff = 0
                for (dy in -2..2) for (dx in -2..2) {
                    val nx = x + dx
                    val ny = y + dy
                    if (nx < 0 || ny < 0 || nx >= w || ny >= h) {
                        cliff = max(cliff, 3 - max(abs(dx), abs(dy)))
                    } else if (tiles[idx(nx, ny)] == WALL && ground[idx(nx, ny)] != DesertGround.PAVING) {
                        cliff = max(cliff, 3 - max(abs(dx), abs(dy)))
                    }
                }
                val k = rnd.nextFloat()
                if ((cliff == 2 && k < 0.7f) || (cliff == 1 && k < 0.25f) || flats[i] > 0.72f) ground[i] = DesertGround.HARDPAN
            }

            // Props: temple furnishings, lone pillars, bones bleaching in the sun, urns and the odd chest.
            val props = mutableListOf<Prop>()
            fun put(t: PropType, x: Int, y: Int, strict: Boolean): Boolean {
                if (!free(x, y)) return false
                if (abs(x - sx) <= 1 && abs(y - sy) <= 1) return false
                if (abs(x - ex) <= 1 && abs(y - ey) <= 1) return false
                if (t.solid && strict) for (dy in -1..1) for (dx in -1..1) if (!free(x + dx, y + dy)) return false
                if (props.any { abs(it.x - x - 0.5f) < 1f && abs(it.y - y - 0.5f) < 1f }) return false
                props += Prop(t, x + 0.5f, y + 0.5f)
                return true
            }
            fun ruinProp(ru: Room, t: PropType, x: Int, y: Int) {
                if (x <= ru.x || y <= ru.y || x >= ru.x + ru.w - 1 || y >= ru.y + ru.h - 1) return
                // Solid pieces stay off the lines between the doorways.
                if (t.solid && (abs(x - ru.cx) <= 1 || abs(y - ru.cy) <= 1)) return
                put(t, x, y, strict = false)
            }
            for ((k, ru) in ruins.withIndex()) {
                val left = ru.x + 1
                val right = ru.x + ru.w - 2
                val top = ru.y + 1
                val bottom = ru.y + ru.h - 2
                when (if (k == 0) 0 else rnd.nextInt(3)) {
                    0 -> { // temple: an altar between braziers, columns down the nave
                        put(PropType.ALTAR, ru.cx, top, strict = false)
                        ruinProp(ru, PropType.BRAZIER, left, top)
                        ruinProp(ru, PropType.BRAZIER, right, top)
                        var y = top + 2
                        while (y < bottom) {
                            ruinProp(ru, PropType.COLUMN, left + 1, y)
                            ruinProp(ru, PropType.COLUMN, right - 1, y)
                            y += 2
                        }
                        ruinProp(ru, PropType.BONEPILE, left, bottom)
                    }
                    1 -> { // tomb: sarcophagi in rows, urns in the corners
                        var x = left + 1
                        while (x < right) {
                            ruinProp(ru, PropType.SARCOPHAGUS, x, top)
                            ruinProp(ru, PropType.SARCOPHAGUS, x, bottom)
                            x += 2
                        }
                        ruinProp(ru, PropType.URN, left, top)
                        ruinProp(ru, PropType.URN, right, bottom)
                        ruinProp(ru, PropType.SKULLS, ru.cx + 1, ru.cy + 1)
                        if (rnd.nextFloat() < 0.45f) ruinProp(ru, PropType.CHEST, right, top)
                    }
                    else -> { // storeroom: urns and crates along the walls
                        for (y in top..bottom) {
                            if (rnd.nextFloat() < 0.6f) ruinProp(ru, PropType.URN, left, y)
                            if (rnd.nextFloat() < 0.6f) ruinProp(ru, if (rnd.nextFloat() < 0.3f) PropType.CRATE else PropType.URN, right, y)
                        }
                        ruinProp(ru, PropType.BONEPILE, ru.cx + 2, bottom)
                        if (rnd.nextFloat() < 0.35f) ruinProp(ru, PropType.CHEST, left + 1, top)
                    }
                }
            }
            if (last) {
                // The pharaoh's court: a ring of columns, braziers in the corners and his altar to the north.
                for ((dx, dy) in listOf(-5 to -2, 5 to -2, -5 to 2, 5 to 2, -2 to -5, 2 to -5, -2 to 5, 2 to 5)) put(PropType.COLUMN, ex + dx, ey + dy, strict = false)
                for ((dx, dy) in listOf(-5 to -5, 5 to -5, -5 to 5, 5 to 5)) put(PropType.BRAZIER, ex + dx, ey + dy, strict = false)
                put(PropType.ALTAR, ex, ey - 4, strict = false)
                put(PropType.URN, ex - 4, ey + 4, strict = false)
                put(PropType.URN, ex + 4, ey + 4, strict = false)
            } else {
                put(PropType.COLUMN, ex - 2, ey - 2, strict = false)
                put(PropType.COLUMN, ex + 2, ey - 2, strict = false)
                put(PropType.URN, ex + 2, ey + 2, strict = false)
            }
            fun sandSpot(minFromStart: Float): Pair<Int, Int>? {
                repeat(80) {
                    val x = rnd.nextInt(3, w - 3)
                    val y = rnd.nextInt(3, h - 3)
                    val g = ground[idx(x, y)]
                    if (free(x, y) && (g == DesertGround.SAND || g == DesertGround.HARDPAN) &&
                        hypot((x - sx).toFloat(), (y - sy).toFloat()) >= minFromStart
                    ) return x to y
                }
                return null
            }
            repeat(4) {
                sandSpot(8f)?.let { (x, y) ->
                    if (put(PropType.PILLAR, x, y, strict = true)) {
                        if (rnd.nextBoolean()) put(PropType.URN, x + 1, y, strict = false)
                        if (rnd.nextBoolean()) put(PropType.SKULLS, x - 1, y + 1, strict = false)
                    }
                }
            }
            repeat(12) { sandSpot(4f)?.let { (x, y) -> put(if (rnd.nextFloat() < 0.6f) PropType.SKULLS else PropType.BONEPILE, x, y, strict = false) } }
            repeat(3) {
                sandSpot(6f)?.let { (x, y) ->
                    put(PropType.URN, x, y, strict = true)
                    if (rnd.nextBoolean()) put(PropType.URN, x + 1, y, strict = true)
                    if (rnd.nextBoolean()) put(PropType.URN, x, y + 1, strict = true)
                }
            }
            repeat(1 + depth / 2) { sandSpot(14f)?.let { (x, y) -> put(PropType.CHEST, x, y, strict = true) } }
            if (rnd.nextFloat() < 0.4f) sandSpot(10f)?.let { (x, y) -> put(PropType.SHRINE, x, y, strict = true) }

            // Torches only on the temple walls, where a wall faces open ground.
            val torches = mutableListOf<Int>()
            for (ru in ruins) for (y in ru.y until ru.y + ru.h) for (x in ru.x until ru.x + ru.w) {
                val onWall = x == ru.x || y == ru.y || x == ru.x + ru.w - 1 || y == ru.y + ru.h - 1
                val i = idx(x, y)
                if (onWall && tiles[i] == WALL && y + 1 < h && tiles[i + w] != WALL && rnd.nextFloat() < 0.3f) torches += i
            }

            // Hunting grounds: the court, the temples, the oasis and cells of open sand away from the arrival.
            val startRoom = Room(sx - 1, sy - 1, 3, 3)
            val rooms = mutableListOf(startRoom, plaza)
            rooms += ruins
            oasis?.let { rooms += it }
            val cells = mutableListOf<Room>()
            for (cy in 0 until (h - 4) / 10) for (cx in 0 until (w - 4) / 10) {
                val cell = Room(2 + cx * 10, 2 + cy * 10, 10, 10)
                if (rooms.any { it.intersects(cell, 0) }) continue
                if (hypot((cell.cx - sx).toFloat(), (cell.cy - sy).toFloat()) < 12f) continue
                var n = 0
                for (y in cell.y until cell.y + cell.h) for (x in cell.x until cell.x + cell.w) if (free(x, y)) n++
                if (n >= 40) cells += cell
            }
            rooms += cells.shuffled(rnd).take(10)

            val variant = FloatArray(w * h) { rnd.nextFloat() }
            return Dungeon(Biome.DESERT, w, h, tiles, rooms, startRoom, plaza, torches, variant, props, ground = ground)
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
                // Out in the open south-west, away from the other entrances and the troll's south-east.
                Entrance(13, 63, Region.DESERT),
            )
            for (e in entrances) clear(e.x, e.y, 3)

            // Winding dirt paths from the village gates to each entrance.
            fun path(fromX: Int, fromY: Int, toX: Int, toY: Int, r: Random = rnd) {
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
                            ground[idx(px, py)] = Ground.DIRT + r.nextInt(2)
                            keep[idx(px, py)] = true
                        }
                    }
                }
            }
            path(vx + vw / 2, vy - 1, entrances[0].x, entrances[0].y + 1)
            path(vx + vw, vy + vh / 2, entrances[1].x, entrances[1].y + 1)
            path(vx + vw / 2, vy + vh, entrances[2].x, entrances[2].y + 1)
            path(vx - 1, vy + vh / 2, 6, vy + vh / 2)
            // Its own random stream, so the rest of a saved world comes out as it always did.
            path(vx - 1, vy + vh / 2 + 1, entrances[3].x, entrances[3].y + 1, Random(seed xor 0x5A4D5L))

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

            // Sand blows in around the way down to the Scorched Sands.
            val dune = entrances[3]
            for (y in dune.y - 7..dune.y + 7) for (x in dune.x - 7..dune.x + 7) {
                if (!inside(x, y)) continue
                val i = idx(x, y)
                val dd = hypot((x - dune.x).toFloat(), (y - dune.y).toFloat()) + (detail[i] - 0.5f) * 3f
                if (dd < 5.5f && tiles[i] == FLOOR) ground[i] = Ground.SAND
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
                Prop(PropType.CRATE, vx + vw - 6.5f, vy + vh - 1.5f), Prop(PropType.BARREL, vx + vw - 5.5f, vy + vh - 1.5f),
                Prop(PropType.BARREL, vx + vw - 1.5f, vy + 5.5f), Prop(PropType.CRATE, vx + vw - 1.5f, vy + 4.5f),
                Prop(PropType.SIGN, vx + vw / 2 + 1.8f, vy - 2.5f),
                Prop(PropType.STASH, vx + 4.5f, vy + 2.6f),
                Prop(PropType.GRAVESTONE, vx - 5.5f, vy - 4.5f), Prop(PropType.GRAVESTONE, vx - 3.5f, vy - 4.5f),
                Prop(PropType.GRAVESTONE, vx - 5.5f, vy - 2.5f), Prop(PropType.SKULLS, vx - 4.5f, vy - 3f),
            )
            for (p in props) {
                val i = idx(floorInt(p.x), floorInt(p.y))
                tiles[i] = FLOOR
            }

            // Houses, smithy, well and market. Footprints become BLOCK tiles.
            val buildings = listOf(
                Building(0, vx + 1, vy + 1, 3, 2, light = 0x66FFB74D, lightX = -0.9f, lightY = 0.9f),
                Building(1, vx + vw - 4, vy + 1, 3, 2, light = 0x66FFB74D, lightX = 0.7f, lightY = 0.9f),
                Building(2, vx + vw - 4, vy + 8, 3, 2, light = 0x88FF6D00, lightX = -0.8f, lightY = 0.2f),
                Building(0, vx + 1, vy + 8, 3, 2, light = 0x66FFB74D, lightX = -0.9f, lightY = 0.9f),
                Building(3, vx + 5, vy + 4, 1, 1),
                Building(4, vx + 10, vy + 4, 2, 1),
                Building(5, vx + 1, vy + vh - 2, 2, 1),
                Building(6, vx + 4, vy + 6, 1, 1, light = 0x88FFC46B, lightX = 0.25f, lightY = -1.2f),
                Building(6, vx + 12, vy + 7, 1, 1, light = 0x88FFC46B, lightX = 0.25f, lightY = -1.2f),
                Building(6, vx + vw / 2 - 2, vy, 1, 1, light = 0x88FFC46B, lightX = 0.25f, lightY = -1.2f),
                Building(7, vx + vw - 2, vy + vh - 2, 1, 1),
                Building(8, vx + 6, vy + vh - 2, 1, 1),
            )
            for (b in buildings) for (yy in b.y until b.y + b.h) for (xx in b.x until b.x + b.w) tiles[idx(xx, yy)] = BLOCK

            // The path keeps the way to the desert open; should the forest still close it, cut a lane through.
            val reach = flood(tiles, w, h, vx + vw / 2, vy + vh / 2 + 3)
            if (!reach[idx(dune.x, dune.y)]) {
                var best = -1
                var bestD = Float.MAX_VALUE
                for (i in reach.indices) if (reach[i]) {
                    val dd = hypot((i % w - dune.x).toFloat(), (i / w - dune.y).toFloat())
                    if (dd < bestD) { bestD = dd; best = i }
                }
                if (best >= 0) carveLine(tiles, w, h, best % w, best / w, dune.x, dune.y + 1, 3) { it == TREE || it == ROCK || it == WATER }
            }

            val npcs = mutableListOf(
                Npc(NpcKind.SMITH, vx + vw - 2.5f, vy + 10.6f),
                Npc(NpcKind.ELDER, vx + 6.5f, vy + 3.6f),
            )
            repeat(4) { k -> npcs += Npc(if (k % 2 == 0) NpcKind.VILLAGER_F else NpcKind.VILLAGER_M, cx - 3f + k * 2f, cy + 2.5f) }

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
                merchantX = vx + 10.5f, merchantY = vy + 5.6f, buildings = buildings, npcs = npcs,
            )
        }
    }
}
