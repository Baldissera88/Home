package com.baldissera.squish

import kotlin.random.Random

/**
 * The match-3 rules. Pure Kotlin, deterministic for a given seed.
 *
 * Rules chosen:
 * - BOMB uses the classic double explosion: when it fires it blasts 3x3, stays on the board "armed",
 *   falls with gravity and blasts 3x3 again in the next CLEAR phase (then it is removed).
 *   A Fired entry is emitted for each of the two blasts.
 * - Gravity: holes are not cells, pieces fall straight down through them to the next playable cell of the column.
 *   Bubble wrap acts as a floor: pieces above a wrap pile up on it, the cells below a wrap are a separate
 *   segment that compacts downward and gets new pieces spawned directly into its empty top cells,
 *   so no playable cell ever stays empty.
 * - Swaps with a rainbow, or of two specials, are always valid (special combos). Rainbow pieces never match by colour.
 * - Points: 60 per piece removed, 60 per goo/wrap layer removed, +120 for making a LINE, +200 BOMB, +300 RAINBOW;
 *   the phase total is multiplied by the combo (1 for the player's match, 2, 3, ... for cascades).
 */
class Game(val level: Level, seed: Long = System.nanoTime()) {
    val rows: Int = level.rows
    val cols: Int = level.cols

    private val rng = Random(seed)
    private val palette: List<Kind> = Kind.entries.take(level.kinds.coerceIn(3, Kind.entries.size))
    private val hole = Array(rows) { r -> BooleanArray(cols) { c -> level.layout[r][c] == ' ' } }
    private val board = Array(rows) { arrayOfNulls<Piece>(cols) }
    private val goo = Array(rows) { r ->
        IntArray(cols) { c -> when (level.layout[r][c]) { 'g' -> 1; 'G' -> 2; else -> 0 } }
    }
    private val wrap = Array(rows) { r ->
        IntArray(cols) { c -> when (level.layout[r][c]) { 'w' -> 1; 'W' -> 2; else -> 0 } }
    }
    private val gooTotal = goo.sumOf { it.sum() }
    private val wrapTotal = wrap.sumOf { it.sum() }
    private var gooRemoved = 0
    private var wrapRemoved = 0
    private val collected = IntArray(Kind.entries.size)
    private val armed = HashSet<Long>()
    private var nextId = 1L
    private var finaleDone = false

    var score: Int = 0
        private set
    var movesLeft: Int = level.moves
        private set
    var status: Status = Status.PLAYING
        private set

    init {
        fillInitial()
    }

    // ---------------------------------------------------------------- public API

    fun isHole(p: Pos): Boolean = p.r !in 0 until rows || p.c !in 0 until cols || hole[p.r][p.c]

    fun snapshot(): Snapshot = Snapshot(
        Array(rows) { board[it].copyOf() },
        Array(rows) { goo[it].copyOf() },
        Array(rows) { wrap[it].copyOf() },
    )

    fun goalProgress(goal: Goal): Int = when (goal) {
        is Goal.Score -> score
        is Goal.Collect -> minOf(collected[goal.kind.ordinal], goal.count)
        Goal.ClearGoo -> gooRemoved
        Goal.PopWrap -> wrapRemoved
    }

    fun goalTarget(goal: Goal): Int = when (goal) {
        is Goal.Score -> goal.target
        is Goal.Collect -> goal.count
        Goal.ClearGoo -> gooTotal
        Goal.PopWrap -> wrapTotal
    }

    fun swap(a: Pos, b: Pos): List<Phase> {
        if (status != Status.PLAYING) return emptyList()
        if (kotlin.math.abs(a.r - b.r) + kotlin.math.abs(a.c - b.c) != 1) return emptyList()
        if (!open(a.r, a.c) || !open(b.r, b.c)) return emptyList()
        if (board[a.r][a.c] == null || board[b.r][b.c] == null) return emptyList()

        val phases = ArrayList<Phase>()
        exchange(a, b)
        phases += Phase(PhaseKind.SWAP, snapshot())
        val atB = board[b.r][b.c]!!
        val atA = board[a.r][a.c]!!
        val comboCase = isComboPair(atA, atB)
        if (!comboCase && !matchAt(a.r, a.c) && !matchAt(b.r, b.c)) {
            exchange(a, b)
            phases += Phase(PhaseKind.SWAP_BACK, snapshot())
            return phases
        }
        if (comboCase) {
            val cl = Clear(1)
            cl.comboSwap(a, b)
            cl.run()
            phases += cl.finish()
            phases += fall(1)
            cascade(phases, 2, emptySet(), false)
        } else {
            cascade(phases, 1, setOf(b, a), false)
        }
        movesLeft--
        updateStatus()
        if (status == Status.PLAYING && !hasMove()) phases += shuffle()
        return phases
    }

    fun hint(): Pair<Pos, Pos>? {
        if (status != Status.PLAYING) return null
        var best: Pair<Pos, Pos>? = null
        var bestScore = Int.MIN_VALUE
        for (r in 0 until rows) for (c in 0 until cols) {
            if (board[r][c] == null) continue
            for ((dr, dc) in RIGHT_DOWN) {
                val r2 = r + dr
                val c2 = c + dc
                if (r2 >= rows || c2 >= cols || board[r2][c2] == null) continue
                val s = evaluate(Pos(r, c), Pos(r2, c2))
                if (s > bestScore) {
                    bestScore = s
                    best = Pos(r, c) to Pos(r2, c2)
                }
            }
        }
        return if (bestScore >= 0) best else null
    }

    fun stars(): Int {
        if (status != Status.WON) return 0
        val n = level.stars.count { score >= it }
        return n.coerceIn(1, 3)
    }

    fun finale(): List<Phase> {
        if (status != Status.WON || finaleDone) return emptyList()
        finaleDone = true
        val phases = ArrayList<Phase>()
        while (movesLeft > 0) {
            val candidates = ArrayList<Pos>()
            for (r in 0 until rows) for (c in 0 until cols) {
                val p = board[r][c]
                if (p != null && p.special == Special.NONE) candidates += Pos(r, c)
            }
            if (candidates.isEmpty()) break
            val pos = candidates[rng.nextInt(candidates.size)]
            val piece = board[pos.r][pos.c]!!
            board[pos.r][pos.c] = piece.copy(special = if (rng.nextBoolean()) Special.LINE_H else Special.LINE_V)
            movesLeft--
            phases += Phase(PhaseKind.BONUS, snapshot(), created = listOf(pos))
        }
        movesLeft = 0
        cascade(phases, 1, emptySet(), true)
        return phases
    }

    // ---------------------------------------------------------------- test hooks (internal, used by EngineTest)

    /** Puts a fresh piece on an open cell. Only for tests. */
    internal fun setPiece(p: Pos, kind: Kind, special: Special = Special.NONE): Piece {
        require(open(p.r, p.c))
        return Piece(nextId++, kind, special).also { board[p.r][p.c] = it }
    }

    /** Runs the shuffle step directly. Only for tests. */
    internal fun shuffleNow(): Phase = shuffle()

    // ---------------------------------------------------------------- board helpers

    private fun playable(r: Int, c: Int) = r in 0 until rows && c in 0 until cols && !hole[r][c]
    private fun open(r: Int, c: Int) = playable(r, c) && wrap[r][c] == 0

    private fun exchange(a: Pos, b: Pos) {
        val t = board[a.r][a.c]
        board[a.r][a.c] = board[b.r][b.c]
        board[b.r][b.c] = t
    }

    private fun newPiece(kind: Kind = palette[rng.nextInt(palette.size)]) = Piece(nextId++, kind)

    /** Kind usable for colour matching at r,c, or null. */
    private fun kindAt(r: Int, c: Int): Kind? {
        if (r !in 0 until rows || c !in 0 until cols) return null
        val p = board[r][c] ?: return null
        return if (p.special == Special.RAINBOW) null else p.kind
    }

    private fun extent(r: Int, c: Int, dr: Int, dc: Int, k: Kind): Int {
        var n = 0
        var rr = r + dr
        var cc = c + dc
        while (kindAt(rr, cc) == k) { n++; rr += dr; cc += dc }
        return n
    }

    private fun matchAt(r: Int, c: Int): Boolean {
        val k = kindAt(r, c) ?: return false
        return extent(r, c, 0, -1, k) + extent(r, c, 0, 1, k) >= 2 ||
            extent(r, c, -1, 0, k) + extent(r, c, 1, 0, k) >= 2
    }

    private fun isComboPair(x: Piece, y: Piece) =
        x.special == Special.RAINBOW || y.special == Special.RAINBOW ||
            (x.special != Special.NONE && y.special != Special.NONE)

    private fun validSwap(a: Pos, b: Pos): Boolean {
        val pa = board[a.r][a.c] ?: return false
        val pb = board[b.r][b.c] ?: return false
        if (isComboPair(pa, pb)) return true
        if (pa.kind == pb.kind) return false
        exchange(a, b)
        val ok = matchAt(a.r, a.c) || matchAt(b.r, b.c)
        exchange(a, b)
        return ok
    }

    private fun hasMove(): Boolean {
        for (r in 0 until rows) for (c in 0 until cols) {
            if (board[r][c] == null) continue
            if (c + 1 < cols && validSwap(Pos(r, c), Pos(r, c + 1))) return true
            if (r + 1 < rows && validSwap(Pos(r, c), Pos(r + 1, c))) return true
        }
        return false
    }

    private fun anyMatch(): Boolean {
        for (r in 0 until rows) for (c in 0 until cols) if (matchAt(r, c)) return true
        return false
    }

    private fun goalsMet(): Boolean = level.goals.all { goalProgress(it) >= goalTarget(it) }

    private fun updateStatus() {
        status = when {
            goalsMet() -> Status.WON
            movesLeft <= 0 -> Status.LOST
            else -> Status.PLAYING
        }
    }

    // ---------------------------------------------------------------- filling and shuffling

    /** Picks kinds for the given cells (row-major) so that no line of 3 forms with what is already placed. */
    private fun safeKind(r: Int, c: Int, fixed: (Int, Int) -> Kind?): Kind {
        val allowed = palette.filter { k ->
            !(fixed(r, c - 1) == k && fixed(r, c - 2) == k) && !(fixed(r - 1, c) == k && fixed(r - 2, c) == k)
        }
        val from = allowed.ifEmpty { palette }
        return from[rng.nextInt(from.size)]
    }

    private fun fillInitial() {
        val cells = ArrayList<Pos>()
        for (r in 0 until rows) for (c in 0 until cols) if (open(r, c)) cells += Pos(r, c)
        for (attempt in 0 until 200) {
            val grid = Array(rows) { arrayOfNulls<Kind>(cols) }
            val get = { r: Int, c: Int -> if (r in 0 until rows && c in 0 until cols) grid[r][c] else null }
            for (p in cells) grid[p.r][p.c] = safeKind(p.r, p.c, get)
            for (p in cells) board[p.r][p.c] = Piece(0, grid[p.r][p.c]!!)
            if (!anyMatch() && hasMove()) break
        }
        for (p in cells) board[p.r][p.c] = Piece(nextId++, board[p.r][p.c]!!.kind)
    }

    private fun shuffle(): Phase {
        val cells = ArrayList<Pos>()
        for (r in 0 until rows) for (c in 0 until cols) if (board[r][c] != null) cells += Pos(r, c)
        val pieces = cells.map { board[it.r][it.c]!! }.toMutableList()
        var done = false
        for (attempt in 0 until 100) {
            pieces.shuffle(rng)
            cells.forEachIndexed { i, p -> board[p.r][p.c] = pieces[i] }
            if (!anyMatch() && hasMove()) { done = true; break }
        }
        var tries = 0
        while (!done && tries++ < 100) {
            // Re-colour the normal pieces (ids kept) so that the board is playable again.
            for (p in cells) {
                val piece = board[p.r][p.c]!!
                if (piece.special == Special.NONE) board[p.r][p.c] = piece.copy(kind = safeKind(p.r, p.c, ::kindAt))
            }
            done = !anyMatch() && hasMove()
        }
        return Phase(PhaseKind.SHUFFLE, snapshot())
    }

    // ---------------------------------------------------------------- matching

    private class Run(val cells: List<Pos>, val horizontal: Boolean)
    private class Group(val kind: Kind, val runs: List<Run>) {
        val cells: Set<Pos> = runs.flatMapTo(LinkedHashSet()) { it.cells }
    }

    private fun findGroups(): List<Group> {
        val runs = ArrayList<Run>()
        for (r in 0 until rows) {
            var c = 0
            while (c < cols) {
                val k = kindAt(r, c)
                if (k == null) { c++; continue }
                var e = c
                while (kindAt(r, e + 1) == k) e++
                if (e - c + 1 >= 3) runs += Run((c..e).map { Pos(r, it) }, true)
                c = e + 1
            }
        }
        for (c in 0 until cols) {
            var r = 0
            while (r < rows) {
                val k = kindAt(r, c)
                if (k == null) { r++; continue }
                var e = r
                while (kindAt(e + 1, c) == k) e++
                if (e - r + 1 >= 3) runs += Run((r..e).map { Pos(it, c) }, false)
                r = e + 1
            }
        }
        if (runs.isEmpty()) return emptyList()
        // union runs that share a cell
        val parent = IntArray(runs.size) { it }
        fun find(x: Int): Int { var y = x; while (parent[y] != y) y = parent[y]; return y }
        val owner = HashMap<Pos, Int>()
        runs.forEachIndexed { i, run ->
            for (p in run.cells) {
                val o = owner[p]
                if (o == null) owner[p] = i else parent[find(i)] = find(o)
            }
        }
        val byRoot = LinkedHashMap<Int, MutableList<Run>>()
        runs.forEachIndexed { i, run -> byRoot.getOrPut(find(i)) { ArrayList() } += run }
        return byRoot.values.map { rs -> Group(board[rs[0].cells[0].r][rs[0].cells[0].c]!!.kind, rs) }
    }

    private fun groupSpecial(g: Group): Special {
        val longest = g.runs.maxOf { it.cells.size }
        val hasH = g.runs.any { it.horizontal }
        val hasV = g.runs.any { !it.horizontal }
        return when {
            longest >= 5 -> Special.RAINBOW
            hasH && hasV -> Special.BOMB
            longest == 4 -> if (g.runs.first { it.cells.size == 4 }.horizontal) Special.LINE_V else Special.LINE_H
            else -> Special.NONE
        }
    }

    private fun isNormal(p: Pos) = board[p.r][p.c]?.special == Special.NONE

    private fun creationCell(g: Group, special: Special, preferred: Set<Pos>): Pos? {
        val main: List<Pos> = when (special) {
            Special.RAINBOW -> g.runs.maxBy { it.cells.size }.cells
            Special.LINE_H, Special.LINE_V -> g.runs.first { it.cells.size == 4 }.cells
            else -> g.cells.toList()
        }
        preferred.firstOrNull { it in g.cells && isNormal(it) }?.let { return it }
        val default: Pos? = when (special) {
            Special.RAINBOW -> main[main.size / 2]
            Special.LINE_H, Special.LINE_V -> main[1]
            Special.BOMB -> g.cells.firstOrNull { p -> g.runs.count { p in it.cells } >= 2 }
            else -> null
        }
        if (default != null && isNormal(default)) return default
        return main.firstOrNull { isNormal(it) } ?: g.cells.firstOrNull { isNormal(it) }
    }

    /** Resolves matches (and armed bombs, and in the finale every special) until the board is calm. */
    private fun cascade(phases: MutableList<Phase>, startCombo: Int, preferred: Set<Pos>, fireAllSpecials: Boolean) {
        var combo = startCombo
        var pref = preferred
        var guard = 0
        while (guard++ < 200) {
            val groups = findGroups()
            val extra = ArrayList<Pos>()
            for (r in 0 until rows) for (c in 0 until cols) {
                val p = board[r][c] ?: continue
                if (p.id in armed || (fireAllSpecials && p.special != Special.NONE)) extra += Pos(r, c)
            }
            if (groups.isEmpty() && extra.isEmpty()) break
            val cl = Clear(combo)
            cl.matches(groups, pref)
            extra.forEach { cl.enqueue(it) }
            cl.run()
            phases += cl.finish()
            phases += fall(combo)
            combo++
            pref = emptySet()
        }
    }

    // ---------------------------------------------------------------- clearing

    private inner class Clear(val combo: Int) {
        private val visited = HashSet<Pos>()
        private val queue = ArrayDeque<Pos>()
        private val cleared = ArrayList<Cleared>()
        private val fired = ArrayList<Fired>()
        private val created = ArrayList<Pos>()
        private val creations = ArrayList<Pair<Pos, Piece>>()
        private val hits = ArrayList<Pos>()
        private val wrapHit = HashSet<Pos>()
        private val protectedCells = HashSet<Pos>()
        private var raw = 0

        fun enqueue(p: Pos) {
            if (p in protectedCells || p in visited) return
            if (!playable(p.r, p.c) || board[p.r][p.c] == null) return
            visited += p
            queue += p
        }

        fun blast(p: Pos) {
            if (!playable(p.r, p.c)) return
            if (wrap[p.r][p.c] > 0) hitWrap(p) else enqueue(p)
        }

        private fun hitWrap(p: Pos) {
            if (wrap[p.r][p.c] <= 0 || !wrapHit.add(p)) return
            wrap[p.r][p.c]--
            wrapRemoved++
            hits += p
            raw += 60
        }

        private fun hitGoo(p: Pos) {
            if (goo[p.r][p.c] > 0) {
                goo[p.r][p.c]--
                gooRemoved++
                hits += p
                raw += 60
            }
        }

        private fun remove(p: Pos) {
            val piece = board[p.r][p.c] ?: return
            board[p.r][p.c] = null
            armed.remove(piece.id)
            cleared += Cleared(p, piece)
            hitGoo(p)
            if (piece.special != Special.RAINBOW) collected[piece.kind.ordinal]++
            raw += 60
        }

        fun matches(groups: List<Group>, preferred: Set<Pos>) {
            for (g in groups) {
                val special = groupSpecial(g)
                if (special == Special.NONE) continue
                val at = creationCell(g, special, preferred) ?: continue
                protectedCells += at
                created += at
                val old = board[at.r][at.c]!!
                creations += at to Piece(old.id, g.kind, special)
                hitGoo(at)
                collected[g.kind.ordinal]++
                raw += 60 + when (special) { Special.RAINBOW -> 300; Special.BOMB -> 200; else -> 120 }
            }
            for (g in groups) {
                for (p in g.cells) {
                    enqueue(p)
                    for ((dr, dc) in NEIGHBOURS) {
                        val r = p.r + dr
                        val c = p.c + dc
                        if (playable(r, c) && wrap[r][c] > 0) hitWrap(Pos(r, c))
                    }
                }
            }
        }

        private fun removeAll(kind: Kind) {
            for (r in 0 until rows) for (c in 0 until cols) {
                val p = board[r][c] ?: continue
                if (p.kind == kind && p.special != Special.RAINBOW) enqueue(Pos(r, c))
            }
        }

        private fun presentKind(): Kind? {
            val present = LinkedHashSet<Kind>()
            for (r in 0 until rows) for (c in 0 until cols) {
                val p = board[r][c] ?: continue
                if (p.special != Special.RAINBOW && Pos(r, c) !in visited) present += p.kind
            }
            if (present.isEmpty()) return null
            val list = present.toList()
            return list[rng.nextInt(list.size)]
        }

        private fun bombArea(center: Pos, radius: Int) {
            for (r in center.r - radius..center.r + radius) for (c in center.c - radius..center.c + radius) blast(Pos(r, c))
        }

        private fun row(r: Int) { for (c in 0 until cols) blast(Pos(r, c)) }
        private fun col(c: Int) { for (r in 0 until rows) blast(Pos(r, c)) }

        /** Player swapped two pieces where at least one is a rainbow, or both are specials. [b] is the target cell. */
        fun comboSwap(a: Pos, b: Pos) {
            val pa = board[a.r][a.c]!!
            val pb = board[b.r][b.c]!!
            visited += a
            visited += b
            if (pa.special == Special.RAINBOW && pb.special == Special.RAINBOW) {
                fired += Fired(b, Special.RAINBOW, pb.kind)
                fired += Fired(a, Special.RAINBOW, pa.kind)
                remove(a); remove(b)
                for (r in 0 until rows) for (c in 0 until cols) blast(Pos(r, c))
                return
            }
            if (pa.special == Special.RAINBOW || pb.special == Special.RAINBOW) {
                val rp = if (pa.special == Special.RAINBOW) a else b
                val op = if (rp == a) b else a
                val other = board[op.r][op.c]!!
                val k = other.kind
                fired += Fired(rp, Special.RAINBOW, k)
                remove(rp)
                visited -= op
                if (other.special != Special.NONE) {
                    for (r in 0 until rows) for (c in 0 until cols) {
                        val p = board[r][c] ?: continue
                        if (p.kind == k && p.special == Special.NONE) {
                            val s = when (other.special) {
                                Special.BOMB -> Special.BOMB
                                else -> if (rng.nextBoolean()) Special.LINE_H else Special.LINE_V
                            }
                            board[r][c] = p.copy(special = s)
                        }
                    }
                }
                removeAll(k)
                return
            }
            // two specials among LINE_H, LINE_V, BOMB
            val lines = listOf(pa, pb).count { it.special == Special.LINE_H || it.special == Special.LINE_V }
            remove(a); remove(b)
            when (lines) {
                2 -> {
                    fired += Fired(b, Special.LINE_H, pb.kind)
                    fired += Fired(b, Special.LINE_V, pa.kind)
                    row(b.r); col(b.c)
                }
                1 -> {
                    for (d in -1..1) {
                        if (b.r + d in 0 until rows) fired += Fired(Pos(b.r + d, b.c), Special.LINE_H, pb.kind)
                        if (b.c + d in 0 until cols) fired += Fired(Pos(b.r, b.c + d), Special.LINE_V, pa.kind)
                    }
                    for (d in -1..1) {
                        if (b.r + d in 0 until rows) row(b.r + d)
                        if (b.c + d in 0 until cols) col(b.c + d)
                    }
                }
                else -> {
                    fired += Fired(a, Special.BOMB, pa.kind)
                    fired += Fired(b, Special.BOMB, pb.kind)
                    bombArea(b, 2)
                }
            }
        }

        fun run() {
            while (queue.isNotEmpty()) {
                val p = queue.removeFirst()
                val piece = board[p.r][p.c] ?: continue
                when (piece.special) {
                    Special.NONE -> remove(p)
                    Special.LINE_H -> {
                        fired += Fired(p, Special.LINE_H, piece.kind)
                        remove(p)
                        row(p.r)
                    }
                    Special.LINE_V -> {
                        fired += Fired(p, Special.LINE_V, piece.kind)
                        remove(p)
                        col(p.c)
                    }
                    Special.BOMB -> {
                        fired += Fired(p, Special.BOMB, piece.kind)
                        if (piece.id in armed) remove(p) else armed += piece.id
                        bombArea(p, 1)
                    }
                    Special.RAINBOW -> {
                        val k = presentKind()
                        fired += Fired(p, Special.RAINBOW, k ?: piece.kind)
                        remove(p)
                        if (k != null) removeAll(k)
                    }
                }
            }
        }

        fun finish(): Phase {
            for ((p, piece) in creations) board[p.r][p.c] = piece
            val points = raw * combo
            score += points
            return Phase(
                PhaseKind.CLEAR, snapshot(), cleared = cleared, fired = fired, created = created,
                hits = hits, points = points, combo = combo,
            )
        }
    }

    // ---------------------------------------------------------------- gravity

    private fun fall(combo: Int): Phase {
        for (c in 0 until cols) {
            var segment = ArrayList<Int>()
            for (r in 0..rows) {
                val boundary = r == rows || (playable(r, c) && wrap[r][c] > 0)
                if (boundary) {
                    settle(segment, c)
                    segment = ArrayList()
                } else if (playable(r, c)) {
                    segment += r
                }
            }
        }
        return Phase(PhaseKind.FALL, snapshot(), combo = combo)
    }

    /** Compacts the pieces of one column segment (rows top to bottom) downward and spawns into the empty top. */
    private fun settle(segment: List<Int>, c: Int) {
        if (segment.isEmpty()) return
        val pieces = segment.mapNotNull { board[it][c] }
        val empty = segment.size - pieces.size
        for ((i, r) in segment.withIndex()) {
            board[r][c] = if (i < empty) null else pieces[i - empty]
        }
        // spawn bottom-up so ids grow towards the top (the screen drops them in that order)
        for (i in empty - 1 downTo 0) board[segment[i]][c] = newPiece()
    }

    // ---------------------------------------------------------------- hints

    private fun evaluate(a: Pos, b: Pos): Int {
        val pa = board[a.r][a.c]!!
        val pb = board[b.r][b.c]!!
        val lowBias = maxOf(a.r, b.r)
        if (isComboPair(pa, pb)) {
            val s = setOf(pa.special, pb.special)
            val base = when {
                pa.special == Special.RAINBOW && pb.special == Special.RAINBOW -> 1000
                Special.RAINBOW in s && Special.BOMB in s -> 900
                Special.RAINBOW in s && (Special.LINE_H in s || Special.LINE_V in s) -> 850
                s == setOf(Special.BOMB) -> 700
                Special.BOMB in s -> 650
                Special.RAINBOW in s -> {
                    val k = if (pa.special == Special.RAINBOW) pb.kind else pa.kind
                    500 + if (neededKind(k)) 200 else 0
                }
                else -> 600
            }
            return base + lowBias
        }
        if (pa.kind == pb.kind) return -1
        exchange(a, b)
        var total = 0
        var any = false
        for (p in listOf(a, b)) {
            val k = kindAt(p.r, p.c) ?: continue
            val l = extent(p.r, p.c, 0, -1, k)
            val rr = extent(p.r, p.c, 0, 1, k)
            val u = extent(p.r, p.c, -1, 0, k)
            val d = extent(p.r, p.c, 1, 0, k)
            val h = l + rr + 1
            val v = u + d + 1
            if (h < 3 && v < 3) continue
            any = true
            val cells = ArrayList<Pos>()
            cells += p
            if (h >= 3) for (cc in p.c - l..p.c + rr) if (cc != p.c) cells += Pos(p.r, cc)
            if (v >= 3) for (r2 in p.r - u..p.r + d) if (r2 != p.r) cells += Pos(r2, p.c)
            total += cells.size * 10
            total += when {
                h >= 5 || v >= 5 -> 300
                h >= 3 && v >= 3 -> 160
                h == 4 || v == 4 -> 100
                else -> 0
            }
            for (q in cells) {
                val piece = board[q.r][q.c]!!
                if (piece.special != Special.NONE) total += 60
                if (neededKind(piece.kind)) total += 15
                if (needGoo()) total += 25 * goo[q.r][q.c]
                if (needWrap()) for ((dr, dc) in NEIGHBOURS) {
                    val r2 = q.r + dr
                    val c2 = q.c + dc
                    if (playable(r2, c2) && wrap[r2][c2] > 0) total += 25
                }
            }
        }
        exchange(a, b)
        return if (any) total + lowBias else -1
    }

    private fun neededKind(k: Kind) =
        level.goals.any { it is Goal.Collect && it.kind == k && collected[k.ordinal] < it.count }

    private fun needGoo() = Goal.ClearGoo in level.goals && gooRemoved < gooTotal
    private fun needWrap() = wrapTotal > 0

    private companion object {
        val RIGHT_DOWN = listOf(0 to 1, 1 to 0)
        val NEIGHBOURS = listOf(-1 to 0, 1 to 0, 0 to -1, 0 to 1)
    }
}
