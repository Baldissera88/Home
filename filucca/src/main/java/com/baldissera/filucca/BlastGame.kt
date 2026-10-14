package com.baldissera.filucca

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue

const val BLAST_SIZE = 8

/** Rows separated by '/', 'X' = brick, '.' = gap. */
private val blastShapes = listOf(
    "X", "XX", "XXX", "XXXX", "XXXXX",
    "X/X", "X/X/X", "X/X/X/X", "X/X/X/X/X",
    "XX/XX", "XXX/XXX/XXX", "XXX/XXX", "XX/XX/XX",
    "X./XX", ".X/XX", "XX/X.", "XX/.X",
    "X../X../XXX", "..X/..X/XXX", "XXX/X../X..", "XXX/..X/..X",
    "X./X./XX", ".X/.X/XX", "XX/X./X.", "XX/.X/.X",
    "XXX/X..", "XXX/..X", "X../XXX", "..X/XXX",
    "XXX/.X.", ".X./XXX", "X./XX/X.", ".X/XX/.X",
    "XX./.XX", ".XX/XX.", "X./XX/.X", ".X/XX/X.",
).map { def ->
    def.split("/").flatMapIndexed { y, row -> row.mapIndexedNotNull { x, ch -> if (ch == 'X') Cell(x, y) else null } }
}

data class BlastPiece(val cells: List<Cell>, val color: Int) {
    val w = cells.maxOf { it.x } + 1
    val h = cells.maxOf { it.y } + 1
}

sealed interface BlastEvent {
    data class Placed(
        val placed: Set<Int>,
        val cleared: Map<Int, Int>, // board index -> colour of the cleared cell
        val lines: Int,
        val combo: Int,
        val boardClear: Boolean,
    ) : BlastEvent
    data object GameOver : BlastEvent
}

class BlastGame {
    var listener: (BlastEvent) -> Unit = {}

    var board by mutableStateOf(IntArray(BLAST_SIZE * BLAST_SIZE)) // 0 = empty, otherwise colour + 1
        private set
    val tray = mutableStateListOf<BlastPiece?>(null, null, null)
    var score by mutableIntStateOf(0)
        private set
    var combo by mutableIntStateOf(0)
        private set
    var started by mutableStateOf(false)
        private set
    var gameOver by mutableStateOf(false)
        private set

    fun newGame() {
        board = IntArray(BLAST_SIZE * BLAST_SIZE)
        score = 0
        combo = 0
        gameOver = false
        started = true
        refill()
    }

    private fun randomPiece() = BlastPiece(blastShapes.random(), gemColors.indices.random())

    /** Deal three new pieces, preferring a set where at least one can be placed. */
    private fun refill() {
        var set = List(3) { randomPiece() }
        repeat(30) {
            if (set.any { fitsAnywhere(it) }) return@repeat
            set = List(3) { randomPiece() }
        }
        set.forEachIndexed { i, p -> tray[i] = p }
    }

    fun fits(p: BlastPiece, gx: Int, gy: Int): Boolean = p.cells.all {
        val x = gx + it.x
        val y = gy + it.y
        x in 0 until BLAST_SIZE && y in 0 until BLAST_SIZE && board[y * BLAST_SIZE + x] == 0
    }

    fun fitsAnywhere(p: BlastPiece): Boolean =
        (0..BLAST_SIZE - p.w).any { x -> (0..BLAST_SIZE - p.h).any { y -> fits(p, x, y) } }

    private fun fullLines(b: IntArray): Pair<List<Int>, List<Int>> {
        val rows = (0 until BLAST_SIZE).filter { r -> (0 until BLAST_SIZE).all { b[r * BLAST_SIZE + it] != 0 } }
        val cols = (0 until BLAST_SIZE).filter { c -> (0 until BLAST_SIZE).all { b[it * BLAST_SIZE + c] != 0 } }
        return rows to cols
    }

    private fun cellsOf(rows: List<Int>, cols: List<Int>): Set<Int> = buildSet {
        rows.forEach { r -> (0 until BLAST_SIZE).forEach { add(r * BLAST_SIZE + it) } }
        cols.forEach { c -> (0 until BLAST_SIZE).forEach { add(it * BLAST_SIZE + c) } }
    }

    private fun withPiece(p: BlastPiece, gx: Int, gy: Int): IntArray {
        val b = board.copyOf()
        p.cells.forEach { b[(gy + it.y) * BLAST_SIZE + gx + it.x] = p.color + 1 }
        return b
    }

    /** Board cells that would disappear if [p] were placed at (gx, gy). */
    fun wouldClear(p: BlastPiece, gx: Int, gy: Int): Set<Int> {
        val (rows, cols) = fullLines(withPiece(p, gx, gy))
        return cellsOf(rows, cols)
    }

    fun place(index: Int, gx: Int, gy: Int): Boolean {
        val p = tray[index] ?: return false
        if (gameOver || !fits(p, gx, gy)) return false

        val b = withPiece(p, gx, gy)
        val (rows, cols) = fullLines(b)
        val cleared = cellsOf(rows, cols).associateWith { b[it] - 1 }
        cleared.keys.forEach { b[it] = 0 }
        val placed = p.cells.map { (gy + it.y) * BLAST_SIZE + gx + it.x }.toSet()
        board = b
        tray[index] = null

        val lines = rows.size + cols.size
        score += p.cells.size
        val boardClear = lines > 0 && b.all { it == 0 }
        if (lines > 0) {
            combo++
            score += 10 * lines * (lines + 1) / 2 * combo
            if (boardClear) score += 300
        } else {
            combo = 0
        }
        listener(BlastEvent.Placed(placed, cleared, lines, combo, boardClear))

        if (tray.all { it == null }) refill()
        if (tray.filterNotNull().none { fitsAnywhere(it) }) {
            gameOver = true
            listener(BlastEvent.GameOver)
        }
        return true
    }
}
