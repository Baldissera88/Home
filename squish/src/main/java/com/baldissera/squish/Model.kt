package com.baldissera.squish

/**
 * Shared vocabulary between the match-3 engine (Engine.kt, Levels.kt), the piece art (Squishies.kt)
 * and the screens. Pure Kotlin, no Android imports, so the engine can be tested on a plain JVM.
 */

/** The six collectible toys. Each kind is one "colour" for matching. */
enum class Kind(val title: String) {
    NEEDOH("NeeDoh"),
    PLUSH("Squishmallow"),
    SLIME("Slim"),
    POPIT("Pop-it"),
    MOCHI("Mochi"),
    LABUBU("Labubu"),
}

/**
 * Power-ups made by big matches:
 * 4 in a row -> LINE (stripe across the direction the player swiped: a horizontal 4 makes LINE_V, a vertical 4 makes LINE_H),
 * L/T shape -> BOMB (clears 3x3, twice), 5 in a row -> RAINBOW ("glitter-bombe": clears every piece of the swapped kind).
 */
enum class Special { NONE, LINE_H, LINE_V, BOMB, RAINBOW }

data class Pos(val r: Int, val c: Int)

/** A piece on the board. [id] is unique for the whole game and stable while the piece moves, so screens can animate by id. */
data class Piece(val id: Long, val kind: Kind, val special: Special = Special.NONE)

/** The board after a phase. [pieces] is null on holes and on cells blocked by bubble wrap. */
class Snapshot(
    val pieces: Array<Array<Piece?>>,
    /** Glitter goo under the cell: 0 none, 1 or 2 layers. Cleared one layer per match on that cell. */
    val goo: Array<IntArray>,
    /** Bubble-wrap blocker: 0 none, 1 or 2 hit points. Popped by matches or specials next to / on it. Does not fall. */
    val wrap: Array<IntArray>,
)

enum class PhaseKind { SWAP, SWAP_BACK, CLEAR, FALL, SHUFFLE, BONUS }

/** A piece that left the board in this phase, and where it was. */
data class Cleared(val pos: Pos, val piece: Piece)

/** A special that went off in this phase (screens draw beams / shockwaves / rainbow rays from it). */
data class Fired(val pos: Pos, val special: Special, val kind: Kind)

/**
 * One animation step. Screens animate from the previous snapshot to [after]:
 * pieces with the same id slide to their new cell, pieces missing from [after] pop (see [cleared]),
 * new ids drop in from above the board.
 */
data class Phase(
    val kind: PhaseKind,
    val after: Snapshot,
    val cleared: List<Cleared> = emptyList(),
    val fired: List<Fired> = emptyList(),
    /** Cells where a special piece was just formed. */
    val created: List<Pos> = emptyList(),
    /** Cells whose goo or wrap lost a layer. */
    val hits: List<Pos> = emptyList(),
    val points: Int = 0,
    /** 1 for the player's own match, 2+ for each cascade after it. */
    val combo: Int = 0,
)

sealed interface Goal {
    data class Score(val target: Int) : Goal
    data class Collect(val kind: Kind, val count: Int) : Goal
    /** Clear every goo layer on the board. */
    data object ClearGoo : Goal
    /** Pop every bubble wrap on the board. */
    data object PopWrap : Goal
}

/**
 * A level. [layout] has one string per row, all the same length (max 9x9):
 * '.' normal cell, ' ' hole, 'g' goo 1, 'G' goo 2, 'w' wrap 1, 'W' wrap 2.
 */
data class Level(
    val number: Int,
    val moves: Int,
    /** How many of the [Kind]s appear, 4..6 (fewer kinds = easier). */
    val kinds: Int,
    val layout: List<String>,
    val goals: List<Goal>,
    /** Scores for 1, 2 and 3 stars. Reaching the goals is required to win at all. */
    val stars: IntArray,
) {
    val rows get() = layout.size
    val cols get() = layout[0].length
}

enum class Status { PLAYING, WON, LOST }
