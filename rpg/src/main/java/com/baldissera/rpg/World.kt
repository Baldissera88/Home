package com.baldissera.rpg

import kotlin.math.abs
import kotlin.random.Random

const val WALL = 0
const val FLOOR = 1
const val STAIRS = 2

const val DECOR_NONE = 0
const val DECOR_CRACK = 1
const val DECOR_BONES = 2
const val DECOR_MOSS = 3
const val DECOR_PUDDLE = 4

fun floorInt(f: Float): Int = kotlin.math.floor(f).toInt()

class Room(val x: Int, val y: Int, val w: Int, val h: Int) {
    val cx: Int get() = x + w / 2
    val cy: Int get() = y + h / 2

    fun intersects(o: Room, pad: Int) =
        x - pad < o.x + o.w && x + w + pad > o.x && y - pad < o.y + o.h && y + h + pad > o.y
}

class Dungeon(
    val w: Int,
    val h: Int,
    val tiles: IntArray,
    val rooms: List<Room>,
    val start: Room,
    val exit: Room,
    /** Wall tiles with a torch on their visible front face. */
    val torches: List<Int>,
    /** Per-tile random value used for stone colour variation. */
    val variant: FloatArray,
    val decor: IntArray,
) {
    fun tile(x: Int, y: Int): Int = if (x < 0 || y < 0 || x >= w || y >= h) WALL else tiles[y * w + x]
    fun walkable(x: Int, y: Int) = tile(x, y) != WALL
    fun walkableAt(fx: Float, fy: Float) = walkable(floorInt(fx), floorInt(fy))

    companion object {
        fun generate(rnd: Random, w: Int = 56, h: Int = 56): Dungeon {
            val tiles = IntArray(w * h)
            val rooms = mutableListOf<Room>()
            var attempts = 0
            while (rooms.size < 12 && attempts < 400) {
                attempts++
                val rw = rnd.nextInt(5, 11)
                val rh = rnd.nextInt(5, 10)
                val r = Room(rnd.nextInt(2, w - rw - 2), rnd.nextInt(2, h - rh - 2), rw, rh)
                if (rooms.none { it.intersects(r, 2) }) rooms += r
            }

            fun carve(x: Int, y: Int) {
                if (x in 1 until w - 1 && y in 1 until h - 1) tiles[y * w + x] = FLOOR
            }

            for (r in rooms) for (yy in r.y until r.y + r.h) for (xx in r.x until r.x + r.w) carve(xx, yy)

            // Two-wide L-shaped corridors; each room links to the nearest room already connected.
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
                val nearest = connected.minBy { abs(it.cx - r.cx) + abs(it.cy - r.cy) }
                corridor(r, nearest)
                connected += r
            }

            val start = rooms[0]
            val exit = rooms.maxBy { abs(it.cx - start.cx) + abs(it.cy - start.cy) }
            tiles[exit.cy * w + exit.cx] = STAIRS

            val torches = mutableListOf<Int>()
            for (y in 0 until h - 1) for (x in 0 until w) {
                val i = y * w + x
                if (tiles[i] == WALL && tiles[i + w] != WALL && rnd.nextFloat() < 0.08f) torches += i
            }

            val variant = FloatArray(w * h) { rnd.nextFloat() }
            val decor = IntArray(w * h) { i ->
                if (tiles[i] == FLOOR && rnd.nextFloat() < 0.1f) rnd.nextInt(1, 5) else DECOR_NONE
            }
            return Dungeon(w, h, tiles, rooms, start, exit, torches, variant, decor)
        }
    }
}
