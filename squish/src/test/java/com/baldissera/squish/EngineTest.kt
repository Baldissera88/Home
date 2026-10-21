package com.baldissera.squish

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class EngineTest {

    private val square8 = List(8) { "........" }
    private fun level(layout: List<String> = square8, goals: List<Goal> = listOf(Goal.Score(1_000_000)), moves: Int = 20, kinds: Int = 5) =
        Level(99, moves, kinds, layout, goals, intArrayOf(1, 2, 3))

    /** A board with no matches: rows alternate 0123... and 2301... (kinds 0..3 only). */
    private fun base(r: Int, c: Int) = Kind.entries[((r % 2) * 2 + c) % 4]
    private val X = Kind.LABUBU

    private fun Game.paint(overrides: Map<Pos, Pair<Kind, Special>> = emptyMap()) {
        val s = snapshot()
        for (r in 0 until rows) for (c in 0 until cols) {
            val p = Pos(r, c)
            if (isHole(p) || s.wrap[r][c] > 0) continue
            val o = overrides[p]
            if (o != null) setPiece(p, o.first, o.second) else setPiece(p, base(r, c))
        }
    }

    private fun xs(vararg ps: Pos, special: Special = Special.NONE) = ps.associateWith { X to special }

    private fun hasMatch(s: Snapshot): Boolean {
        val rows = s.pieces.size
        val cols = s.pieces[0].size
        fun k(r: Int, c: Int): Kind? {
            if (r !in 0 until rows || c !in 0 until cols) return null
            val p = s.pieces[r][c] ?: return null
            return if (p.special == Special.RAINBOW) null else p.kind
        }
        for (r in 0 until rows) for (c in 0 until cols) {
            val kk = k(r, c) ?: continue
            if (k(r, c + 1) == kk && k(r, c + 2) == kk) return true
            if (k(r + 1, c) == kk && k(r + 2, c) == kk) return true
        }
        return false
    }

    private fun assertFull(g: Game, s: Snapshot = g.snapshot()) {
        for (r in 0 until g.rows) for (c in 0 until g.cols) {
            val p = Pos(r, c)
            if (g.isHole(p) || s.wrap[r][c] > 0) assertNull(s.pieces[r][c]) else assertNotNull("empty $p", s.pieces[r][c])
        }
    }

    private fun ids(s: Snapshot) = s.pieces.flatMap { row -> row.filterNotNull().map { it.id } }

    // ------------------------------------------------------------------ start of game

    @Test
    fun noInitialMatchesAndAlwaysAMove() {
        for (lv in Levels.all) for (seed in 0L until 8L) {
            val g = Game(lv, seed)
            assertFalse("level ${lv.number} seed $seed", hasMatch(g.snapshot()))
            assertNotNull(g.hint())
            assertFull(g)
            assertEquals(lv.moves, g.movesLeft)
            assertEquals(Status.PLAYING, g.status)
            val all = ids(g.snapshot())
            assertEquals(all.size, all.toSet().size)
        }
    }

    // ------------------------------------------------------------------ swaps

    @Test
    fun invalidSwapsAreIgnoredOrBounced() {
        val g = Game(level(listOf("  ......") + List(7) { "........" }), 1)
        g.paint()
        assertTrue(g.swap(Pos(1, 1), Pos(1, 3)).isEmpty()) // not adjacent
        assertTrue(g.swap(Pos(0, 1), Pos(0, 2)).isEmpty()) // hole
        assertTrue(g.swap(Pos(0, 7), Pos(0, 8)).isEmpty()) // outside
        val before = ids(g.snapshot())
        val ph = g.swap(Pos(1, 0), Pos(1, 1))
        assertEquals(listOf(PhaseKind.SWAP, PhaseKind.SWAP_BACK), ph.map { it.kind })
        assertEquals(20, g.movesLeft)
        assertEquals(before, ids(g.snapshot()))
    }

    @Test
    fun validSwapClearsThree() {
        val g = Game(level(), 2)
        g.paint(xs(Pos(0, 0), Pos(0, 1), Pos(1, 2)))
        val ph = g.swap(Pos(1, 2), Pos(0, 2))
        assertEquals(PhaseKind.SWAP, ph[0].kind)
        assertEquals(PhaseKind.CLEAR, ph[1].kind)
        assertEquals(PhaseKind.FALL, ph[2].kind)
        assertEquals(setOf(Pos(0, 0), Pos(0, 1), Pos(0, 2)), ph[1].cleared.map { it.pos }.toSet())
        assertEquals(1, ph[1].combo)
        assertEquals(180, ph[1].points)
        assertTrue(ph[1].created.isEmpty())
        assertEquals(19, g.movesLeft)
        assertTrue(g.score >= 180)
        // phase sequence: SWAP, then CLEAR/FALL pairs, optional SHUFFLE
        val rest = ph.drop(1).let { if (it.last().kind == PhaseKind.SHUFFLE) it.dropLast(1) else it }
        assertEquals(0, rest.size % 2)
        rest.chunked(2).forEachIndexed { i, pair ->
            assertEquals(PhaseKind.CLEAR, pair[0].kind)
            assertEquals(PhaseKind.FALL, pair[1].kind)
            assertEquals(i + 1, pair[0].combo)
        }
        assertFull(g)
        assertFalse(hasMatch(g.snapshot()))
    }

    @Test
    fun snapshotsAreDeepCopies() {
        val g = Game(level(), 3)
        val s = g.snapshot()
        s.pieces[0][0] = null
        s.goo[0][0] = 5
        assertNotNull(g.snapshot().pieces[0][0])
        assertEquals(0, g.snapshot().goo[0][0])
    }

    // ------------------------------------------------------------------ special formation

    @Test
    fun horizontalFourMakesVerticalLine() {
        val g = Game(level(), 4)
        g.paint(xs(Pos(0, 0), Pos(0, 1), Pos(0, 3), Pos(1, 2)))
        val clear = g.swap(Pos(1, 2), Pos(0, 2))[1]
        assertEquals(listOf(Pos(0, 2)), clear.created)
        assertEquals(Special.LINE_V, clear.after.pieces[0][2]!!.special)
        assertEquals(X, clear.after.pieces[0][2]!!.kind)
        assertEquals(3, clear.cleared.size)
    }

    @Test
    fun verticalFourMakesHorizontalLine() {
        val g = Game(level(), 5)
        g.paint(xs(Pos(0, 0), Pos(1, 0), Pos(3, 0), Pos(2, 1)))
        val clear = g.swap(Pos(2, 1), Pos(2, 0))[1]
        assertEquals(listOf(Pos(2, 0)), clear.created)
        assertEquals(Special.LINE_H, clear.after.pieces[2][0]!!.special)
    }

    @Test
    fun lShapeMakesBomb() {
        val g = Game(level(), 6)
        g.paint(xs(Pos(0, 0), Pos(0, 1), Pos(0, 3), Pos(1, 2), Pos(2, 2)))
        val clear = g.swap(Pos(0, 3), Pos(0, 2))[1]
        assertEquals(listOf(Pos(0, 2)), clear.created)
        assertEquals(Special.BOMB, clear.after.pieces[0][2]!!.special)
        assertEquals(4, clear.cleared.size)
    }

    @Test
    fun fiveMakesRainbow() {
        val g = Game(level(), 7)
        g.paint(xs(Pos(0, 0), Pos(0, 1), Pos(0, 3), Pos(0, 4), Pos(1, 2)))
        val clear = g.swap(Pos(1, 2), Pos(0, 2))[1]
        assertEquals(listOf(Pos(0, 2)), clear.created)
        assertEquals(Special.RAINBOW, clear.after.pieces[0][2]!!.special)
    }

    @Test
    fun specialKeepsIdOfSwappedPiece() {
        val g = Game(level(), 8)
        g.paint(xs(Pos(0, 0), Pos(0, 1), Pos(0, 3), Pos(1, 2)))
        val id = g.snapshot().pieces[1][2]!!.id
        val clear = g.swap(Pos(1, 2), Pos(0, 2))[1]
        assertEquals(id, clear.after.pieces[0][2]!!.id)
    }

    // ------------------------------------------------------------------ specials firing

    @Test
    fun lineInMatchClearsItsRow() {
        val g = Game(level(), 9)
        g.paint(xs(Pos(4, 0), Pos(4, 1)) + xs(Pos(5, 2), special = Special.LINE_H))
        val clear = g.swap(Pos(5, 2), Pos(4, 2))[1]
        assertEquals(Special.LINE_H, clear.fired.single().special)
        for (c in 0 until 8) assertNull(clear.after.pieces[4][c])
        assertEquals(8, clear.cleared.size)
    }

    @Test
    fun bombExplodesTwice() {
        val g = Game(level(), 10)
        g.paint(xs(Pos(4, 0), Pos(4, 1)) + xs(Pos(5, 2), special = Special.BOMB))
        val ph = g.swap(Pos(5, 2), Pos(4, 2))
        val first = ph[1]
        assertEquals(Special.BOMB, first.fired.single().special)
        val bomb = first.after.pieces[4][2]!!
        assertEquals(Special.BOMB, bomb.special) // stays armed after the first blast
        for (r in 3..5) for (c in 1..3) if (r != 4 || c != 2) assertNull(first.after.pieces[r][c])
        val bombs = ph.sumOf { p -> p.fired.count { it.special == Special.BOMB } }
        assertTrue(bombs >= 2)
        assertTrue(ph.any { p -> p.cleared.any { it.piece.id == bomb.id } })
        assertFalse(ids(g.snapshot()).contains(bomb.id))
        assertFull(g)
    }

    @Test
    fun rainbowWithNormalClearsThatKind() {
        val g = Game(level(), 11)
        g.paint(xs(Pos(3, 3), special = Special.RAINBOW))
        val kind = g.snapshot().pieces[3][4]!!.kind
        val count = g.snapshot().pieces.sumOf { row -> row.count { it?.kind == kind && it.special == Special.NONE } }
        val clear = g.swap(Pos(3, 3), Pos(3, 4))[1]
        assertEquals(count + 1, clear.cleared.size)
        assertTrue(clear.cleared.all { it.piece.kind == kind || it.piece.special == Special.RAINBOW })
        assertTrue(clear.after.pieces.all { row -> row.none { it?.kind == kind } })
        assertEquals(19, g.movesLeft)
    }

    @Test
    fun rainbowWithLineTurnsKindIntoLines() {
        val g = Game(level(), 12)
        g.paint(xs(Pos(3, 3), special = Special.RAINBOW) + mapOf(Pos(3, 4) to (Kind.NEEDOH to Special.LINE_H)))
        val count = g.snapshot().pieces.sumOf { row -> row.count { it?.kind == Kind.NEEDOH } }
        val clear = g.swap(Pos(3, 3), Pos(3, 4))[1]
        val lines = clear.fired.count { it.special == Special.LINE_H || it.special == Special.LINE_V }
        assertEquals(count, lines)
        assertTrue(clear.cleared.size > 30)
    }

    @Test
    fun rainbowWithBombTurnsKindIntoBombs() {
        val g = Game(level(), 13)
        g.paint(xs(Pos(3, 3), special = Special.RAINBOW) + mapOf(Pos(3, 4) to (Kind.SLIME to Special.BOMB)))
        val count = g.snapshot().pieces.sumOf { row -> row.count { it?.kind == Kind.SLIME } }
        val clear = g.swap(Pos(3, 3), Pos(3, 4))[1]
        assertTrue(clear.fired.count { it.special == Special.BOMB } >= count)
        assertFull(g)
    }

    @Test
    fun twoRainbowsClearEverything() {
        val g = Game(level(), 14)
        g.paint(xs(Pos(3, 3), Pos(3, 4), special = Special.RAINBOW))
        val clear = g.swap(Pos(3, 3), Pos(3, 4))[1]
        assertEquals(64, clear.cleared.size)
        assertTrue(clear.after.pieces.all { row -> row.all { it == null } })
        assertFull(g)
    }

    @Test
    fun lineAndLineMakeACross() {
        val g = Game(level(), 15)
        g.paint(xs(Pos(3, 3), special = Special.LINE_H) + xs(Pos(3, 4), special = Special.LINE_V))
        val clear = g.swap(Pos(3, 3), Pos(3, 4))[1]
        for (i in 0 until 8) {
            assertNull(clear.after.pieces[3][i])
            assertNull(clear.after.pieces[i][4])
        }
        assertEquals(15, clear.cleared.size)
    }

    @Test
    fun lineAndBombMakeThreeRowsAndColumns() {
        val g = Game(level(), 16)
        g.paint(xs(Pos(3, 3), special = Special.LINE_V) + xs(Pos(3, 4), special = Special.BOMB))
        val clear = g.swap(Pos(3, 3), Pos(3, 4))[1]
        for (i in 0 until 8) for (d in -1..1) {
            assertNull(clear.after.pieces[3 + d][i])
            assertNull(clear.after.pieces[i][4 + d])
        }
        assertEquals(8 * 3 + 8 * 3 - 9, clear.cleared.size)
    }

    @Test
    fun twoBombsBlastFiveByFive() {
        val g = Game(level(), 17)
        g.paint(xs(Pos(4, 3), Pos(4, 4), special = Special.BOMB))
        val clear = g.swap(Pos(4, 3), Pos(4, 4))[1]
        for (r in 2..6) for (c in 2..6) assertNull(clear.after.pieces[r][c])
        assertEquals(25, clear.cleared.size)
    }

    @Test
    fun specialsChainReact() {
        val g = Game(level(), 18)
        // the row 4 line hits a column line at (4,6) which clears column 6
        g.paint(xs(Pos(4, 0), Pos(4, 1)) + xs(Pos(5, 2), special = Special.LINE_H) +
            mapOf(Pos(4, 6) to (Kind.MOCHI to Special.LINE_V)))
        val clear = g.swap(Pos(5, 2), Pos(4, 2))[1]
        assertEquals(2, clear.fired.size)
        for (r in 0 until 8) assertNull(clear.after.pieces[r][6])
    }

    // ------------------------------------------------------------------ goo and wrap

    @Test
    fun gooLosesALayerWhenItsPieceIsCleared() {
        val layout = listOf("Ggg.....") + List(7) { "........" }
        val g = Game(level(layout, listOf(Goal.ClearGoo)), 19)
        assertEquals(4, g.goalTarget(Goal.ClearGoo))
        g.paint(xs(Pos(0, 0), Pos(0, 1), Pos(1, 2)))
        val clear = g.swap(Pos(1, 2), Pos(0, 2))[1]
        assertEquals(setOf(Pos(0, 0), Pos(0, 1), Pos(0, 2)), clear.hits.toSet())
        assertEquals(1, clear.after.goo[0][0])
        assertEquals(0, clear.after.goo[0][1])
        assertTrue(g.goalProgress(Goal.ClearGoo) >= 3)
    }

    @Test
    fun wrapIsPoppedByAdjacentMatchAndRefilled() {
        val layout = listOf("........", "wwW.....") + List(6) { "........" }
        val g = Game(level(layout, listOf(Goal.PopWrap)), 20)
        assertEquals(4, g.goalTarget(Goal.PopWrap))
        assertNull(g.snapshot().pieces[1][0])
        g.paint(xs(Pos(0, 3), Pos(0, 4), Pos(1, 5)))
        val ph = g.swap(Pos(1, 5), Pos(0, 5)) // row 0 cols 3..5: not next to any wrap
        assertEquals(0, ph[1].hits.size)
        val g2 = Game(level(layout, listOf(Goal.PopWrap)), 21)
        g2.paint(xs(Pos(0, 0), Pos(0, 1), Pos(0, 3)))
        val ph2 = g2.swap(Pos(0, 3), Pos(0, 2))
        val clear = ph2[1]
        assertEquals(setOf(Pos(1, 0), Pos(1, 1), Pos(1, 2)), clear.hits.toSet())
        assertEquals(0, clear.after.wrap[1][0])
        assertEquals(1, clear.after.wrap[1][2])
        assertNotNull(ph2[2].after.pieces[1][0]) // popped cell gets filled
        assertNull(ph2[2].after.pieces[1][2]) // still wrapped
        assertFull(g2)
        assertTrue(g2.goalProgress(Goal.PopWrap) >= 3)
    }

    @Test
    fun wrapIsAFloorAndCellsBelowGetFilled() {
        val layout = listOf("........", "........", "www.....") + List(5) { "........" }
        val g = Game(level(layout), 22)
        g.paint(xs(Pos(4, 0), Pos(4, 1), Pos(5, 2)))
        val above = g.snapshot().pieces[1][0]!!.id
        val ph = g.swap(Pos(5, 2), Pos(4, 2))
        val fall = ph[2]
        assertEquals(above, fall.after.pieces[1][0]!!.id) // did not fall through the wrap
        assertFull(g)
    }

    @Test
    fun collectGoalCountsClearedPieces() {
        val g = Game(level(goals = listOf(Goal.Collect(X, 3))), 23)
        g.paint(xs(Pos(0, 0), Pos(0, 1), Pos(1, 2)))
        g.swap(Pos(1, 2), Pos(0, 2))
        assertEquals(3, g.goalProgress(Goal.Collect(X, 3)))
        assertEquals(Status.WON, g.status)
        assertTrue(g.swap(Pos(5, 5), Pos(5, 6)).isEmpty())
    }

    // ------------------------------------------------------------------ ids, gravity, shuffle

    @Test
    fun idsStableAndBoardAlwaysFull() {
        for (lv in Levels.all.filterIndexed { i, _ -> i % 3 == 0 }) {
            val g = Game(lv, 42)
            var maxId = ids(g.snapshot()).max()
            repeat(10) {
                if (g.status != Status.PLAYING) return@repeat
                val before = g.snapshot()
                val h = g.hint()!!
                val ph = g.swap(h.first, h.second)
                assertTrue(ph.size >= 3)
                val gone = ph.flatMap { p -> p.cleared.map { it.piece.id } }.toSet()
                val after = ids(g.snapshot()).toSet()
                for (id in ids(before)) assertTrue("id $id lost", id in gone || id in after)
                for (id in after) assertTrue(id in ids(before) || id > maxId)
                assertEquals(ids(g.snapshot()).size, after.size)
                for (p in ph) if (p.kind == PhaseKind.FALL || p.kind == PhaseKind.SHUFFLE) assertFull(g, p.after)
                if (ph.last().kind == PhaseKind.SHUFFLE) {
                    assertEquals(ids(ph[ph.size - 2].after).toSet(), ids(ph.last().after).toSet())
                }
                maxId = maxOf(maxId, after.max())
                assertFull(g)
                assertFalse(hasMatch(g.snapshot()))
            }
        }
    }

    @Test
    fun shuffleKeepsPiecesAndLeavesAMove() {
        for (seed in 0L until 20L) {
            val g = Game(Levels.all[17], seed)
            val before = ids(g.snapshot()).sorted()
            val ph = g.shuffleNow()
            assertEquals(PhaseKind.SHUFFLE, ph.kind)
            assertEquals(before, ids(ph.after).sorted())
            assertFalse(hasMatch(ph.after))
            assertNotNull(g.hint())
        }
    }

    @Test
    fun deterministicForASeed() {
        fun play(seed: Long): List<Int> {
            val g = Game(Levels.all[11], seed)
            val out = ArrayList<Int>()
            while (g.status == Status.PLAYING) {
                val h = g.hint()!!
                g.swap(h.first, h.second)
                out += g.score
                out += ids(g.snapshot()).sum().toInt()
            }
            g.finale()
            out += g.score
            return out
        }
        assertEquals(play(77), play(77))
        assertFalse(play(77) == play(78))
        val a = Game(Levels.all[5], 5).snapshot()
        val b = Game(Levels.all[5], 5).snapshot()
        for (r in a.pieces.indices) assertEquals(a.pieces[r].toList(), b.pieces[r].toList())
    }

    // ------------------------------------------------------------------ end of game

    @Test
    fun losesWhenMovesRunOut() {
        val g = Game(level(goals = listOf(Goal.Score(1_000_000_000)), moves = 3), 24)
        repeat(3) { val h = g.hint()!!; g.swap(h.first, h.second) }
        assertEquals(0, g.movesLeft)
        assertEquals(Status.LOST, g.status)
        assertEquals(0, g.stars())
        assertNull(g.hint())
        assertTrue(g.finale().isEmpty())
    }

    @Test
    fun finaleTurnsMovesIntoLines() {
        val g = Game(level(goals = listOf(Goal.Score(1)), moves = 10), 25)
        val h = g.hint()!!
        g.swap(h.first, h.second)
        assertEquals(Status.WON, g.status)
        assertEquals(9, g.movesLeft)
        val score = g.score
        val ph = g.finale()
        assertEquals(9, ph.count { it.kind == PhaseKind.BONUS })
        assertTrue(ph.take(9).all { it.kind == PhaseKind.BONUS && it.created.size == 1 })
        assertEquals(PhaseKind.CLEAR, ph[9].kind)
        assertTrue(ph[9].fired.size >= 9)
        assertEquals(0, g.movesLeft)
        assertTrue(g.score > score)
        assertEquals(score + ph.sumOf { it.points }, g.score)
        assertTrue(g.finale().isEmpty())
        assertTrue(g.stars() in 1..3)
        assertFull(g)
        assertFalse(hasMatch(g.snapshot()))
        assertTrue(g.snapshot().pieces.all { row -> row.all { it == null || it.special == Special.NONE } })
    }

    @Test
    fun hintPrefersSpecials() {
        val g = Game(level(), 26)
        g.paint(xs(Pos(6, 0), Pos(6, 1), Pos(6, 3), Pos(6, 4), Pos(7, 2)))
        assertEquals(setOf(Pos(6, 2), Pos(7, 2)), g.hint()!!.toList().toSet())
    }

    // ------------------------------------------------------------------ levels

    @Test
    fun everyLevelParses() {
        assertEquals(30, Levels.all.size)
        Levels.all.forEachIndexed { i, lv ->
            val tag = "level ${lv.number}"
            assertEquals(tag, i + 1, lv.number)
            assertTrue(tag, lv.rows in 5..9 && lv.cols in 5..9)
            assertTrue(tag, lv.layout.all { it.length == lv.cols })
            assertTrue(tag, lv.layout.all { row -> row.all { it in ". gGwW" } })
            assertTrue(tag, lv.kinds in 4..6)
            assertTrue(tag, lv.moves in 10..40)
            assertEquals(tag, 3, lv.stars.size)
            assertTrue(tag, lv.stars[0] < lv.stars[1] && lv.stars[1] < lv.stars[2])
            val cells = lv.layout.sumOf { row -> row.count { it != ' ' } }
            val open = lv.layout.sumOf { row -> row.count { it != ' ' && it != 'w' && it != 'W' } }
            assertTrue(tag, cells >= 36 && open >= 30)
            assertTrue(tag, lv.goals.isNotEmpty())
            for (goal in lv.goals) when (goal) {
                is Goal.Collect -> assertTrue(tag, goal.kind.ordinal < lv.kinds)
                Goal.ClearGoo -> assertTrue(tag, lv.layout.any { row -> row.any { it == 'g' || it == 'G' } })
                Goal.PopWrap -> assertTrue(tag, lv.layout.any { row -> row.any { it == 'w' || it == 'W' } })
                is Goal.Score -> assertEquals(tag, goal.target, lv.stars[0])
            }
            val g = Game(lv, 1)
            for (goal in lv.goals) assertTrue(tag, g.goalTarget(goal) > 0)
        }
        // mechanics are introduced gradually
        val firstGoo = Levels.all.first { lv -> Goal.ClearGoo in lv.goals }.number
        val firstWrap = Levels.all.first { lv -> lv.layout.any { it.contains('w') || it.contains('W') } }.number
        val firstSix = Levels.all.first { it.kinds == 6 }.number
        assertTrue(Levels.all.take(3).all { lv -> lv.goals.all { it is Goal.Score } })
        assertTrue(firstGoo in 5..8 && firstWrap in 9..12 && firstSix in 12..18)
    }

    /** A greedy hint() bot must beat every level often enough (kids should not get stuck). */
    @Test
    fun botWinsEveryLevel() {
        val games = 12
        for (lv in Levels.all) {
            var wins = 0
            for (seed in 0 until games) {
                val g = Game(lv, 1000L + seed * 31)
                while (g.status == Status.PLAYING) {
                    val h = g.hint()!!
                    g.swap(h.first, h.second)
                }
                if (g.status == Status.WON) wins++
            }
            val need = when {
                lv.number <= 8 -> 11
                lv.number <= 18 -> 8
                else -> 5
            }
            println("level ${lv.number}: bot won $wins/$games")
            assertTrue("level ${lv.number} bot won only $wins/$games", wins >= need)
        }
    }
}
