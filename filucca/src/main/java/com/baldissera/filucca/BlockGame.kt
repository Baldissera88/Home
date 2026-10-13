package com.baldissera.filucca

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import kotlin.math.max

const val COLS = 10
const val ROWS = 20

data class Cell(val x: Int, val y: Int)

/** Shapes in their spawn rotation, inside an n×n box (I=4, O=2, others 3). Order: I O T S Z J L. */
private val shapes = listOf(
    listOf(Cell(0, 1), Cell(1, 1), Cell(2, 1), Cell(3, 1)),
    listOf(Cell(0, 0), Cell(1, 0), Cell(0, 1), Cell(1, 1)),
    listOf(Cell(1, 0), Cell(0, 1), Cell(1, 1), Cell(2, 1)),
    listOf(Cell(1, 0), Cell(2, 0), Cell(0, 1), Cell(1, 1)),
    listOf(Cell(0, 0), Cell(1, 0), Cell(1, 1), Cell(2, 1)),
    listOf(Cell(0, 0), Cell(0, 1), Cell(1, 1), Cell(2, 1)),
    listOf(Cell(2, 0), Cell(0, 1), Cell(1, 1), Cell(2, 1)),
)
private val boxSizes = listOf(4, 2, 3, 3, 3, 3, 3)
private const val TYPE_O = 1

fun shapeOf(type: Int): List<Cell> = shapes[type]

data class Piece(val type: Int, val cells: List<Cell>, val x: Int, val y: Int) {
    fun moved(dx: Int, dy: Int) = copy(x = x + dx, y = y + dy)

    /** Clockwise rotation inside the piece's box. */
    fun rotated(): Piece {
        if (type == TYPE_O) return this
        val n = boxSizes[type]
        return copy(cells = cells.map { Cell(n - 1 - it.y, it.x) })
    }

    fun absolute(): List<Cell> = cells.map { Cell(x + it.x, y + it.y) }

    companion object {
        fun spawn(type: Int) = Piece(type, shapes[type], (COLS - boxSizes[type]) / 2, if (type == 0) -1 else 0)
    }
}

sealed interface GameEvent {
    data object Locked : GameEvent
    data class Cleared(val lines: Int) : GameEvent
    data class LevelUp(val level: Int) : GameEvent
    data object GameOver : GameEvent
}

class BlockGame {
    var listener: (GameEvent) -> Unit = {}

    var board by mutableStateOf(IntArray(COLS * ROWS)) // 0 = empty, otherwise piece type + 1
        private set
    var piece by mutableStateOf<Piece?>(null)
        private set
    var next by mutableIntStateOf(0)
        private set
    var score by mutableIntStateOf(0)
        private set
    var lines by mutableIntStateOf(0)
        private set
    var started by mutableStateOf(false)
        private set
    var gameOver by mutableStateOf(false)
        private set
    var paused by mutableStateOf(false)

    val level: Int get() = lines / 10 + 1
    val gravityMs: Long get() = max(90, 800 - (level - 1) * 70).toLong()
    private val canPlay: Boolean get() = started && !gameOver && !paused

    // "7-bag": every piece shows up once per seven, so no long droughts of the long piece.
    private val bag = mutableListOf<Int>()
    private fun drawFromBag(): Int {
        if (bag.isEmpty()) bag.addAll((0 until 7).shuffled())
        return bag.removeAt(0)
    }

    fun start() {
        board = IntArray(COLS * ROWS)
        score = 0
        lines = 0
        gameOver = false
        paused = false
        bag.clear()
        next = drawFromBag()
        started = true
        spawn()
    }

    private fun spawn() {
        val p = Piece.spawn(next)
        next = drawFromBag()
        piece = p
        if (!fits(p)) endGame()
    }

    private fun endGame() {
        gameOver = true
        listener(GameEvent.GameOver)
    }

    private fun fits(p: Piece): Boolean = p.absolute().all { c ->
        c.x in 0 until COLS && c.y < ROWS && (c.y < 0 || board[c.y * COLS + c.x] == 0)
    }

    fun move(dx: Int) {
        val p = piece ?: return
        if (!canPlay) return
        val m = p.moved(dx, 0)
        if (fits(m)) piece = m
    }

    fun rotate() {
        val p = piece ?: return
        if (!canPlay) return
        val r = p.rotated()
        // Simple wall kicks so turning next to a wall or the stack still works.
        for (kick in listOf(Cell(0, 0), Cell(-1, 0), Cell(1, 0), Cell(-2, 0), Cell(2, 0), Cell(0, -1))) {
            val k = r.moved(kick.x, kick.y)
            if (fits(k)) {
                piece = k
                return
            }
        }
    }

    fun tick() {
        val p = piece ?: return
        if (!canPlay) return
        val d = p.moved(0, 1)
        if (fits(d)) piece = d else lock(p)
    }

    fun softDrop() {
        val p = piece ?: return
        if (!canPlay) return
        val d = p.moved(0, 1)
        if (fits(d)) {
            piece = d
            score += 1
        } else {
            lock(p)
        }
    }

    fun hardDrop() {
        if (!canPlay) return
        val p = ghost() ?: return
        score += 2 * (p.y - (piece?.y ?: p.y))
        lock(p)
    }

    /** Where the current piece would land. */
    fun ghost(): Piece? {
        var p = piece ?: return null
        while (fits(p.moved(0, 1))) p = p.moved(0, 1)
        return p
    }

    private fun lock(p: Piece) {
        var b = board.copyOf()
        var overflow = false
        for (c in p.absolute()) {
            if (c.y < 0) overflow = true else b[c.y * COLS + c.x] = p.type + 1
        }

        val full = (0 until ROWS).filter { r -> (0 until COLS).all { b[r * COLS + it] != 0 } }
        if (full.isNotEmpty()) {
            val kept = (0 until ROWS).filter { it !in full }
            val nb = IntArray(COLS * ROWS)
            kept.reversed().forEachIndexed { i, r ->
                val dest = ROWS - 1 - i
                for (x in 0 until COLS) nb[dest * COLS + x] = b[r * COLS + x]
            }
            b = nb
            val oldLevel = level
            lines += full.size
            score += listOf(0, 100, 300, 500, 800)[full.size] * oldLevel
            board = b
            listener(GameEvent.Cleared(full.size))
            if (level > oldLevel) listener(GameEvent.LevelUp(level))
        } else {
            board = b
            listener(GameEvent.Locked)
        }

        if (overflow) {
            piece = null
            endGame()
        } else {
            spawn()
        }
    }
}
