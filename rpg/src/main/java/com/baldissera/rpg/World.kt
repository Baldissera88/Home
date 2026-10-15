package com.baldissera.rpg

import androidx.compose.ui.graphics.Color
import kotlin.math.abs
import kotlin.random.Random

const val WALL = 0
const val FLOOR = 1
const val STAIRS = 2

fun floorInt(f: Float): Int = kotlin.math.floor(f).toInt()

enum class Biome(
    val title: String,
    val tex: String,
    val darkness: Color,
    val darknessAlpha: Float,
    val torchChance: Float,
) {
    CAMP("Lejren", "camp", Color(0xFF040814), 0.62f, 0f),
    CRYPT("Krypten", "crypt", Color.Black, 0.94f, 0.08f),
    CAVE("Hulerne", "cave", Color(0xFF020302), 0.93f, 0.05f),
    HELL("Helvede", "hell", Color(0xFF1C0400), 0.86f, 0.06f),
    ;

    companion object {
        fun forFloor(floor: Int) = when {
            floor <= 0 -> CAMP
            floor <= 3 -> CRYPT
            floor <= 6 -> CAVE
            else -> HELL
        }
    }
}

class Room(val x: Int, val y: Int, val w: Int, val h: Int) {
    val cx: Int get() = x + w / 2
    val cy: Int get() = y + h / 2

    fun intersects(o: Room, pad: Int) =
        x - pad < o.x + o.w && x + w + pad > o.x && y - pad < o.y + o.h && y + h + pad > o.y
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
) {
    fun tile(x: Int, y: Int): Int = if (x < 0 || y < 0 || x >= w || y >= h) WALL else tiles[y * w + x]
    fun walkable(x: Int, y: Int) = tile(x, y) != WALL
    fun walkableAt(fx: Float, fy: Float) = walkable(floorInt(fx), floorInt(fy))

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
            // Caves get ragged room edges.
            if (biome == Biome.CAVE) {
                for (r in rooms) repeat(r.w + r.h) {
                    val ex = r.x - 1 + rnd.nextInt(r.w + 2)
                    val ey = r.y - 1 + rnd.nextInt(r.h + 2)
                    carve(ex, ey)
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
            // A couple of extra loops so the map is not a pure tree.
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
                    val px = r.x + 1 + rnd.nextInt(maxOf(1, r.w - 2))
                    val py = r.y + 1 + rnd.nextInt(maxOf(1, r.h - 2))
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

        /** The safe camp above the dungeon: a palisade around a clearing with a campfire and the merchant. */
        fun camp(rnd: Random): Dungeon {
            val w = 26
            val h = 24
            val tiles = IntArray(w * h)
            for (y in 2 until h - 2) for (x in 2 until w - 2) tiles[y * w + x] = FLOOR
            // A gate in the north wall leading to the dungeon entrance.
            for (y in 0..2) for (x in 12..13) tiles[y * w + x] = FLOOR
            val exit = Room(11, 0, 2, 2)
            tiles[0 * w + 12] = WALL
            tiles[1 * w + 12] = STAIRS
            tiles[0 * w + 13] = WALL
            val start = Room(10, 14, 6, 4)
            val props = mutableListOf(
                Prop(PropType.CAMPFIRE, 13f, 12f),
                Prop(PropType.GRAVESTONE, 4.5f, 4.5f), Prop(PropType.GRAVESTONE, 6.5f, 4.5f), Prop(PropType.GRAVESTONE, 4.5f, 6.5f),
                Prop(PropType.CRATE, 19.5f, 8.5f), Prop(PropType.BARREL, 20.5f, 8.5f), Prop(PropType.BARREL, 19.5f, 9.7f),
                Prop(PropType.SHRINE, 21.5f, 18.5f), Prop(PropType.SKULLS, 3.5f, 20.5f), Prop(PropType.CRATE, 4.5f, 20.5f),
            )
            props.forEach { if (it.type.breakable) it.used = false }
            val variant = FloatArray(w * h) { rnd.nextFloat() }
            return Dungeon(Biome.CAMP, w, h, tiles, listOf(start, exit), start, exit, emptyList(), variant, props)
        }
    }
}
