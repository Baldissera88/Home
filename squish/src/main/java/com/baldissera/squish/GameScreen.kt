package com.baldissera.squish

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.animateIntAsState
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.scaleOut
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.clipRect
import androidx.compose.ui.graphics.drawscope.translate
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.boundsInRoot
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.exp
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sin
import kotlin.math.sqrt
import kotlin.random.Random

// ---------------------------------------------------------------------------------------------- texts

private val comboWords = listOf("Lækkert!", "Squishy!", "Mega squish!", "Slim-tastisk!", "UTROLIGT!")

internal fun goalText(goal: Goal): String = when (goal) {
    is Goal.Collect -> "Saml ${goal.count} ${goal.kind.title}"
    Goal.ClearGoo -> "Fjern al glimmer-slim"
    Goal.PopWrap -> "Pop al bobleplast"
    is Goal.Score -> "Nå ${fmt(goal.target)} point"
}

// ---------------------------------------------------------------------------------------------- board view model

/** A piece sliding from (fromR, fromC) to its cell in the current snapshot. */
private class Move(
    val fromR: Float,
    val fromC: Float,
    val start: Float,
    val dur: Float,
    val style: Int,
    /** Row above which a falling new piece is hidden (it slides in from under the top edge / a wrap); -1 = none. */
    val clipTop: Int = -1,
)

private const val MOVE_SWAP = 0
private const val MOVE_FALL = 1
private const val MOVE_SHUFFLE = 2

private class Pop(val piece: Piece, val pos: Pos, val start: Float)

/**
 * Everything the board Canvas draws, as plain (non-state) fields: the board is redrawn every frame anyway,
 * so none of this needs to trigger recomposition. Times are seconds on [time], the frame clock.
 */
private class BoardView(var snap: Snapshot) {
    var time = 0f
    var moves: Map<Long, Move> = emptyMap()
    val pops = ArrayList<Pop>()
    /** id -> time the piece landed after a fall (for the squash bounce). */
    val landed = HashMap<Long, Float>()
    /** id -> time a piece appeared in place (special created, finale bonus). */
    val appeared = HashMap<Long, Float>()
    /** id -> time of the "no match" wobble. */
    val wobble = HashMap<Long, Float>()
    val flashes = ArrayList<Pair<Pos, Float>>()
    var selected: Pos? = null
    var pressed: Pos? = null
    var drag = Offset.Zero
    var hint: Pair<Pos, Pos>? = null
    var lastInput = 0f
    var animating = false

    /** Board placement inside the Canvas, set while drawing. */
    var origin = Offset.Zero
    var cell = 1f
    /** Board placement inside the input box (local coordinates of the pointerInput). */
    var inputOrigin = Offset.Zero

    fun center(r: Float, c: Float) = Offset((c + 0.5f) * cell, (r + 0.5f) * cell)
    fun center(p: Pos) = center(p.r.toFloat(), p.c.toFloat())
}

private enum class Overlay { INTRO, NONE, PAUSE, WIN, LOST }

private class Callout(val text: String, val id: Int, val color: Color)

/** Holds the game, the board view, effects and the HUD state, and plays phases. */
private class GameController(
    val level: Level,
    val audio: GameAudio,
    val progress: Progress,
    val scope: CoroutineScope,
    seed: Long,
) {
    val game = Game(level, seed)
    val view = BoardView(game.snapshot())
    val fx = Fx()
    private val rnd = Random(level.number * 31L + 5)

    var score by mutableIntStateOf(0)
    var moves by mutableIntStateOf(game.movesLeft)
    val goals = mutableStateListOf<Int>().apply { level.goals.forEach { add(game.goalProgress(it)) } }
    val targets = level.goals.map { game.goalTarget(it) }
    var overlay by mutableStateOf(Overlay.INTRO)
    var callout by mutableStateOf<Callout?>(null)
    var finale by mutableStateOf(false)
    var stars by mutableIntStateOf(0)
    var newBest by mutableStateOf(false)
    private var calloutId = 0
    private var lastSpeak = -100f

    val canInput get() = !view.animating && overlay == Overlay.NONE && game.status == Status.PLAYING

    // ------------------------------------------------------------------ input

    fun touched() {
        view.lastInput = view.time
    }

    fun tap(p: Pos) {
        touched()
        if (!canInput) return
        val snap = view.snap
        if (snap.pieces.getOrNull(p.r)?.getOrNull(p.c) == null) {
            view.selected = null
            return
        }
        val sel = view.selected
        when {
            sel == null -> view.selected = p
            sel == p -> view.selected = null
            abs(sel.r - p.r) + abs(sel.c - p.c) == 1 -> {
                view.selected = null
                trySwap(sel, p)
            }
            else -> view.selected = p
        }
    }

    fun swipe(from: Pos, to: Pos) {
        touched()
        if (!canInput) return
        view.selected = null
        trySwap(from, to)
    }

    private fun trySwap(a: Pos, b: Pos) {
        val phases = game.swap(a, b)
        if (phases.isEmpty()) return
        view.animating = true
        view.hint = null
        moves = game.movesLeft
        scope.launch {
            play(phases)
            moves = game.movesLeft
            syncGoals()
            score = game.score
            afterMove()
        }
    }

    // ------------------------------------------------------------------ flow

    private suspend fun afterMove() {
        when (game.status) {
            Status.WON -> win()
            Status.LOST -> {
                wait(0.4f)
                audio.lose()
                overlay = Overlay.LOST
                view.animating = false
            }
            Status.PLAYING -> {
                view.animating = false
                view.lastInput = view.time
                view.hint = game.hint()
            }
        }
    }

    private suspend fun win() {
        wait(0.35f)
        val bonus = game.finale()
        if (bonus.isNotEmpty()) {
            finale = true
            audio.speak("Squishy finale!")
            wait(1.1f)
            scope.launch {
                wait(0.9f)
                finale = false
            }
            play(bonus, finaleMode = true)
            finale = false
        }
        moves = 0
        score = game.score
        syncGoals()
        wait(0.3f)
        stars = game.stars().coerceIn(1, 3)
        newBest = game.score > progress.best(level.number)
        progress.recordWin(level.number, stars, game.score, Levels.all.size)
        audio.win()
        overlay = Overlay.WIN
        view.animating = false
    }

    fun start() {
        overlay = Overlay.NONE
        audio.click()
        view.lastInput = view.time
        view.hint = game.hint()
    }

    private fun syncGoals() {
        level.goals.forEachIndexed { i, g -> goals[i] = game.goalProgress(g) }
    }

    /** Waits on the frame clock, so animations and waits stay in step (and pause together). */
    private suspend fun wait(seconds: Float) {
        val end = view.time + seconds
        while (view.time < end) withFrameNanos { }
    }

    // ------------------------------------------------------------------ phases

    private suspend fun play(phases: List<Phase>, finaleMode: Boolean = false) {
        for (phase in phases) {
            val prev = view.snap
            when (phase.kind) {
                PhaseKind.SWAP -> {
                    audio.swap()
                    slide(prev, phase.after, MOVE_SWAP, 0.16f)
                    wait(0.16f)
                }
                PhaseKind.SWAP_BACK -> {
                    audio.invalid()
                    slide(prev, phase.after, MOVE_SWAP, 0.16f)
                    wait(0.16f)
                    view.moves.keys.forEach { view.wobble[it] = view.time }
                    fx.shake(view.cell * 0.06f)
                    wait(0.2f)
                }
                PhaseKind.CLEAR -> {
                    clear(prev, phase)
                    wait(if (phase.fired.isNotEmpty()) 0.34f else 0.24f)
                }
                PhaseKind.FALL -> {
                    val total = fall(prev, phase.after)
                    wait(total + 0.04f)
                }
                PhaseKind.SHUFFLE -> {
                    callout("Bland!", Color(0xFF63C7FF))
                    slide(prev, phase.after, MOVE_SHUFFLE, 0.5f)
                    wait(0.55f)
                }
                PhaseKind.BONUS -> {
                    view.snap = phase.after
                    markAppeared(prev, phase.after)
                    phase.created.forEach { fx.sparkle(view.center(it), pieceColor(phase.after, it)) }
                    if (phase.created.isNotEmpty()) audio.made()
                    if (finaleMode) moves = max(0, moves - max(1, phase.created.size))
                    score += phase.points
                    wait(0.14f)
                }
            }
        }
    }

    private fun positions(s: Snapshot): HashMap<Long, Pos> {
        val m = HashMap<Long, Pos>()
        for (r in s.pieces.indices) for (c in s.pieces[r].indices) s.pieces[r][c]?.let { m[it.id] = Pos(r, c) }
        return m
    }

    private fun pieceColor(s: Snapshot, p: Pos): Color = s.pieces.getOrNull(p.r)?.getOrNull(p.c)?.kind?.color ?: Color.White

    private fun markAppeared(prev: Snapshot, after: Snapshot) {
        val old = positions(prev)
        for (row in after.pieces) for (p in row) if (p != null && p.id !in old) view.appeared[p.id] = view.time
    }

    private fun slide(prev: Snapshot, after: Snapshot, style: Int, dur: Float) {
        val old = positions(prev)
        val m = HashMap<Long, Move>()
        for (r in after.pieces.indices) for (c in after.pieces[r].indices) {
            val p = after.pieces[r][c] ?: continue
            val o = old[p.id] ?: continue
            if (o.r != r || o.c != c) {
                m[p.id] = Move(o.r.toFloat(), o.c.toFloat(), view.time, dur * if (style == MOVE_SHUFFLE) 0.8f + rnd.nextFloat() * 0.4f else 1f, style)
            }
        }
        markAppeared(prev, after)
        view.moves = m
        view.snap = after
    }

    /** Sets up gravity moves; returns how long until the last piece has landed. */
    private fun fall(prev: Snapshot, after: Snapshot): Float {
        val old = positions(prev)
        val m = HashMap<Long, Move>()
        val now = view.time
        var total = 0f
        val rows = after.pieces.size
        val cols = after.pieces.firstOrNull()?.size ?: 0
        for (c in 0 until cols) {
            // New pieces of each wrap-separated segment stack up above the segment's top.
            var r = 0
            while (r < rows) {
                var end = r
                while (end < rows && after.wrap[end][c] == 0) end++
                var segTop = r
                while (segTop < end && after.pieces[segTop][c] == null) segTop++
                val fresh = (r until end).count { rr -> after.pieces[rr][c]?.let { it.id !in old } == true }
                for (rr in r until end) {
                    val p = after.pieces[rr][c] ?: continue
                    val o = old[p.id]
                    val fromR: Float
                    val fromC: Float
                    if (o == null) {
                        fromR = (rr - fresh).toFloat() - 0.15f
                        fromC = c.toFloat()
                    } else {
                        if (o.r == rr && o.c == c) continue
                        fromR = o.r.toFloat(); fromC = o.c.toFloat()
                    }
                    val dist = max(0.3f, sqrt((rr - fromR) * (rr - fromR) + (c - fromC) * (c - fromC)))
                    val delay = c * 0.018f + (if (o == null) 0.05f else 0f)
                    val dur = 0.11f + 0.075f * sqrt(dist * 3f)
                    m[p.id] = Move(fromR, fromC, now + delay, dur, MOVE_FALL, clipTop = if (o == null) segTop else -1)
                    view.landed[p.id] = now + delay + dur
                    total = max(total, delay + dur)
                }
                r = end + 1
            }
        }
        view.moves = m
        view.snap = after
        return total
    }

    private fun clear(prev: Snapshot, phase: Phase) {
        val now = view.time
        val after = phase.after
        view.moves = emptyMap()
        view.snap = after
        markAppeared(prev, after)
        val cell = view.cell
        val many = phase.cleared.size > 12
        for (cl in phase.cleared) {
            view.pops += Pop(cl.piece, cl.pos, now)
            fx.burst(view.center(cl.pos), cl.piece.kind.color, if (many) 5 else 9)
        }
        if (phase.cleared.isNotEmpty()) audio.pop(phase.combo)

        // Specials that went off.
        var line = false
        var bomb = false
        var rainbow = false
        val w = level.cols * cell
        val h = level.rows * cell
        for (f in phase.fired) {
            val c = view.center(f.pos)
            val col = f.kind.color
            when (f.special) {
                Special.LINE_H -> {
                    fx.beam(c, Offset(-cell * 0.5f, c.y), col); fx.beam(c, Offset(w + cell * 0.5f, c.y), col)
                    fx.shake(cell * 0.08f); line = true
                }
                Special.LINE_V -> {
                    fx.beam(c, Offset(c.x, -cell * 0.5f), col); fx.beam(c, Offset(c.x, h + cell * 0.5f), col)
                    fx.shake(cell * 0.08f); line = true
                }
                Special.BOMB -> {
                    fx.ring(c, cell * 2.4f, col)
                    fx.ring(c, cell * 1.4f, Color.White, life = 0.35f)
                    fx.burst(c, col, 18)
                    fx.shake(cell * 0.22f); bomb = true
                }
                Special.RAINBOW -> {
                    phase.cleared.take(40).forEachIndexed { i, cl ->
                        fx.beam(c, view.center(cl.pos), titleRainbow[i % titleRainbow.size], width = cell * 0.16f, life = 0.5f)
                    }
                    fx.ring(c, cell * 3f, Color(0xFFFFE066))
                    fx.sparkle(c, Color(0xFFFFE066), 16)
                    fx.shake(cell * 0.16f); rainbow = true
                }
                Special.NONE -> {}
            }
        }
        if (line) audio.line()
        if (bomb) audio.bomb()
        if (rainbow) audio.rainbow()

        if (phase.created.isNotEmpty()) {
            audio.made()
            phase.created.forEach { fx.sparkle(view.center(it), pieceColor(after, it)) }
        }

        if (phase.hits.isNotEmpty()) {
            phase.hits.forEach { view.flashes += it to now }
            val gooGone = prev.goo.sumOf { it.sum() } > after.goo.sumOf { it.sum() }
            val wrapGone = prev.wrap.sumOf { it.sum() } > after.wrap.sumOf { it.sum() }
            if (gooGone) audio.goo()
            if (wrapGone) {
                audio.wrap()
                phase.hits.filter { prev.wrap[it.r][it.c] > after.wrap[it.r][it.c] }
                    .forEach { fx.burst(view.center(it), Color(0xFFDDF4FF), 6) }
            }
            phase.hits.filter { prev.goo[it.r][it.c] > after.goo[it.r][it.c] }
                .forEach { fx.burst(view.center(it), Color(0xFFE879F9), 5) }
        }

        // Floating points at the middle of what was cleared.
        if (phase.points > 0) {
            val pts = phase.cleared.map { it.pos } + phase.hits
            val mid = if (pts.isEmpty()) Offset(w / 2f, h / 2f)
            else Offset(pts.map { view.center(it).x }.average().toFloat(), pts.map { view.center(it).y }.average().toFloat())
            val col = if (phase.combo >= 2) Color(0xFFFFE066) else Color.White
            fx.text("+${fmt(phase.points)}", mid, col, big = phase.points >= 600)
        }
        score += phase.points

        // Live goal progress (corrected from the engine after the move).
        level.goals.forEachIndexed { i, g ->
            val add = when (g) {
                is Goal.Collect -> phase.cleared.count { it.piece.kind == g.kind }
                Goal.ClearGoo -> (prev.goo.sumOf { it.sum() } - after.goo.sumOf { it.sum() }).coerceAtLeast(0)
                Goal.PopWrap -> (prev.wrap.sumOf { it.sum() } - after.wrap.sumOf { it.sum() }).coerceAtLeast(0)
                is Goal.Score -> 0
            }
            goals[i] = if (g is Goal.Score) score else min(targets[i], goals[i] + add)
        }

        if (phase.combo >= 2) {
            val word = comboWords[(phase.combo - 2).coerceIn(0, comboWords.size - 1)]
            callout(word, titleRainbow[phase.combo % titleRainbow.size])
            if (phase.combo >= 3 && view.time - lastSpeak > 5f && rnd.nextFloat() < 0.6f) {
                lastSpeak = view.time
                audio.speak(word)
            }
        }
    }

    fun callout(text: String, color: Color) {
        callout = Callout(text, ++calloutId, color)
    }
}

private val titleRainbow = listOf(
    Color(0xFFFF6FB5), Color(0xFFFFB648), Color(0xFF7BE07E), Color(0xFF5EC8FF), Color(0xFFB98CFF), Color(0xFFFFE066),
)

// ---------------------------------------------------------------------------------------------- screen

/** Test hook: told where the board is (root px of the top-left cell corner, and the cell size) after layout. */
internal var boardLayoutProbe: ((origin: Offset, cell: Float) -> Unit)? = null

/**
 * One level. [onNext], [onRetry] and [onMap] are called from the end/pause cards; progress is saved here on a win.
 * Restart by recomposing with a new key (the caller wraps this in `key(level, attempt)`).
 */
@Composable
fun GameScreen(
    level: Level,
    audio: GameAudio,
    progress: Progress,
    onNext: (() -> Unit)?,
    onRetry: () -> Unit,
    onMap: () -> Unit,
    seed: Long = System.nanoTime(),
) {
    val scope = rememberCoroutineScope()
    val ctl = remember(level) { GameController(level, audio, progress, scope, seed) }
    val view = ctl.view
    val fx = ctl.fx
    val frame = remember { mutableLongStateOf(0L) }
    val measurer = rememberTextMeasurer()
    var rootTopLeft by remember { mutableStateOf(Offset.Zero) }

    LaunchedEffect(ctl) {
        var last = withFrameNanos { it }
        while (true) {
            withFrameNanos { now ->
                val dt = ((now - last) / 1_000_000_000f).coerceIn(0f, 0.05f)
                last = now
                view.time += dt
                fx.update(dt)
                frame.longValue = now
            }
        }
    }

    Box(
        Modifier
            .fillMaxSize()
            .background(Color(0xFFFFE6F2))
            .onGloballyPositioned { rootTopLeft = it.boundsInRoot().topLeft },
    ) {
        // One Canvas for backdrop, board and effects. Reading `frame` here only invalidates drawing.
        Canvas(Modifier.fillMaxSize()) {
            frame.longValue
            drawBackdrop(view.time)
            drawBoard(ctl)
            translate(view.origin.x, view.origin.y) {
                val s = fx.shakeOffset()
                translate(s.x, s.y) { fx.draw(this, measurer) }
            }
        }

        Column(Modifier.fillMaxSize().systemBarsPadding().padding(horizontal = 10.dp, vertical = 6.dp)) {
            Hud(ctl, onPause = {
                audio.click()
                if (ctl.overlay == Overlay.NONE) ctl.overlay = Overlay.PAUSE
            })
            Spacer(Modifier.height(6.dp))
            Box(
                Modifier
                    .fillMaxWidth()
                    .weight(1f)
                    .onGloballyPositioned { lc ->
                        val b = lc.boundsInRoot()
                        val cell = min(b.width / level.cols, b.height / level.rows)
                        view.cell = cell
                        fx.cell = cell
                        view.inputOrigin = Offset((b.width - cell * level.cols) / 2f, (b.height - cell * level.rows) / 2f)
                        view.origin = b.topLeft - rootTopLeft + view.inputOrigin
                        boardLayoutProbe?.invoke(b.topLeft + view.inputOrigin, cell)
                    }
                    .pointerInput(ctl) { boardInput(ctl) },
            )
            Spacer(Modifier.height(10.dp))
        }

        CalloutView(ctl.callout)
        FinaleBanner(ctl.finale)

        when (ctl.overlay) {
            Overlay.INTRO -> Scrim { IntroCard(level, ctl) }
            Overlay.PAUSE -> Scrim {
                SquishCard {
                    BubblyText("Pause", 40.sp, Bubblegum)
                    SoundToggles(progress, audio)
                    PillButton("Fortsæt", Color(0xFF4CC38A)) { audio.click(); ctl.overlay = Overlay.NONE }
                    PillButton("Start forfra", Color(0xFFFFA84D)) { audio.click(); onRetry() }
                    PillButton("Kort", Color(0xFF8C7BFF)) { audio.click(); onMap() }
                }
            }
            Overlay.WIN -> Scrim { WinCard(ctl, onNext, onRetry, onMap) }
            Overlay.LOST -> Scrim {
                SquishCard {
                    BubblyText("Ingen træk\ntilbage!", 36.sp, Color(0xFF8C7BFF))
                    GoalRow(ctl, Modifier)
                    Text("Point: ${fmt(ctl.score)}", color = Ink, fontWeight = FontWeight.Bold, fontSize = 20.sp)
                    PillButton("Prøv igen", Bubblegum) { audio.click(); onRetry() }
                    PillButton("Kort", Color(0xFF8C7BFF)) { audio.click(); onMap() }
                }
            }
            Overlay.NONE -> {}
        }
    }
}

private suspend fun androidx.compose.ui.input.pointer.PointerInputScope.boardInput(ctl: GameController) {
    val view = ctl.view
    awaitEachGesture {
        val down = awaitFirstDown()
        ctl.touched()
        val cell = view.cell
        val local = down.position - view.inputOrigin
        val r = kotlin.math.floor(local.y / cell).toInt()
        val c = kotlin.math.floor(local.x / cell).toInt()
        val start = if (r in 0 until ctl.level.rows && c in 0 until ctl.level.cols) Pos(r, c) else null
        val hasPiece = start != null && view.snap.pieces[start.r][start.c] != null && ctl.canInput
        if (hasPiece) view.pressed = start
        var swiped = false
        while (true) {
            val ev = awaitPointerEvent()
            val ch = ev.changes.firstOrNull { it.id == down.id } ?: break
            if (!ch.pressed) break
            if (hasPiece && !swiped) {
                val d = ch.position - down.position
                val lim = cell * 0.3f
                view.drag = if (abs(d.x) > abs(d.y)) Offset(d.x.coerceIn(-lim, lim), 0f) else Offset(0f, d.y.coerceIn(-lim, lim))
                if (max(abs(d.x), abs(d.y)) > lim) {
                    swiped = true
                    view.drag = Offset.Zero
                    view.pressed = null
                    val to = if (abs(d.x) > abs(d.y)) Pos(start!!.r, start.c + if (d.x > 0) 1 else -1)
                    else Pos(start!!.r + if (d.y > 0) 1 else -1, start.c)
                    ctl.swipe(start, to)
                }
            }
            ch.consume()
        }
        view.drag = Offset.Zero
        view.pressed = null
        if (!swiped && start != null) ctl.tap(start)
    }
}

// ---------------------------------------------------------------------------------------------- board drawing

private fun easeInOut(t: Float) = if (t < 0.5f) 2f * t * t else 1f - (-2f * t + 2f).let { it * it } / 2f

private fun DrawScope.drawBoard(ctl: GameController) {
    val view = ctl.view
    val snap = view.snap
    val game = ctl.game
    val cell = view.cell
    val now = view.time
    val rows = game.rows
    val cols = game.cols
    if (cell <= 1f) return
    val shake = ctl.fx.shakeOffset()

    translate(view.origin.x + shake.x, view.origin.y + shake.y) {
        // Frosting border around the playable cells, then the checker tiles.
        val pad = cell * 0.12f
        for (r in 0 until rows) for (c in 0 until cols) if (!game.isHole(Pos(r, c))) {
            drawRoundRect(
                Color(0x30000000), Offset(c * cell - pad, r * cell - pad + cell * 0.06f), Size(cell + 2 * pad, cell + 2 * pad),
                CornerRadius(cell * 0.3f),
            )
        }
        for (r in 0 until rows) for (c in 0 until cols) if (!game.isHole(Pos(r, c))) {
            drawRoundRect(Color.White.copy(alpha = 0.85f), Offset(c * cell - pad, r * cell - pad), Size(cell + 2 * pad, cell + 2 * pad), CornerRadius(cell * 0.3f))
        }
        for (r in 0 until rows) for (c in 0 until cols) if (!game.isHole(Pos(r, c))) {
            drawCellTile(Offset(c * cell, r * cell), cell, (r + c) % 2 == 1)
        }
        for (r in 0 until rows) for (c in 0 until cols) {
            val g = snap.goo[r][c]
            if (g > 0) drawGoo(Offset(c * cell, r * cell), cell, g, now)
        }

        // Hint wiggle after 5 s idle.
        val hint = view.hint?.takeIf { !view.animating && ctl.overlay == Overlay.NONE && now - view.lastInput > 5f }

        // Pieces, clipped to the board so new ones slide in from the top edge.
        clipRect(0f, 0f, cols * cell, rows * cell) {
            for (r in 0 until rows) for (c in 0 until cols) {
                val p = snap.pieces[r][c] ?: continue
                var rr = r.toFloat()
                var cc = c.toFloat()
                var squash = 0f
                var scale = 1f
                val mv = view.moves[p.id]
                if (mv != null) {
                    val t = ((now - mv.start) / mv.dur).coerceIn(0f, 1f)
                    when (mv.style) {
                        MOVE_SWAP -> {
                            val e = easeInOut(t)
                            rr = mv.fromR + (r - mv.fromR) * e
                            cc = mv.fromC + (c - mv.fromC) * e
                            val horizontal = abs(c - mv.fromC) > abs(r - mv.fromR)
                            squash = sin(t * PI.toFloat()) * 0.22f * if (horizontal) 1f else -1f
                        }
                        MOVE_FALL -> {
                            val e = t * t
                            rr = mv.fromR + (r - mv.fromR) * e
                            cc = mv.fromC + (c - mv.fromC) * e
                            if (t < 1f) squash = -0.18f * t
                        }
                        else -> {
                            val e = easeInOut(t)
                            rr = mv.fromR + (r - mv.fromR) * e
                            cc = mv.fromC + (c - mv.fromC) * e
                            val arc = sin(t * PI.toFloat())
                            rr -= arc * 0.6f
                            scale = 1f - arc * 0.25f
                        }
                    }
                }
                // Signature squish landing: a damped squash bounce.
                view.landed[p.id]?.let { land ->
                    val dt = now - land
                    if (dt >= 0f && dt < 0.55f && (mv == null || now >= mv.start + mv.dur)) {
                        squash = 0.34f * exp(-dt * 7f) * kotlin.math.cos(dt * 26f)
                    } else if (dt >= 0.55f) {
                        view.landed.remove(p.id)
                    }
                }
                view.appeared[p.id]?.let { a ->
                    val dt = now - a
                    if (dt < 0.45f) {
                        val k = dt / 0.45f
                        scale *= 0.3f + 0.7f * k + sin(k * PI.toFloat()) * 0.35f
                    } else view.appeared.remove(p.id)
                }
                view.wobble[p.id]?.let { w ->
                    val dt = now - w
                    if (dt < 0.4f) {
                        cc += sin(dt * 45f) * 0.07f * (1f - dt / 0.4f)
                        squash += sin(dt * 30f) * 0.12f * (1f - dt / 0.4f)
                    } else view.wobble.remove(p.id)
                }
                val pos = Pos(r, c)
                val selected = view.selected == pos
                if (selected) squash += sin(now * 9f) * 0.08f
                var center = view.center(rr, cc)
                if (view.pressed == pos) center += view.drag
                if (hint != null && (hint.first == pos || hint.second == pos)) {
                    val other = if (hint.first == pos) hint.second else hint.first
                    val k = sin(now * 10f) * 0.5f + 0.5f
                    val pulse = (sin(now * 3f) * 0.5f + 0.5f)
                    center += Offset((other.c - c) * cell * 0.1f * k * pulse, (other.r - r) * cell * 0.1f * k * pulse)
                    squash += sin(now * 10f) * 0.1f * pulse
                }
                val clipTop = mv?.clipTop ?: -1
                if (clipTop >= 0 && rr < clipTop) {
                    clipRect(0f, clipTop * cell, cols * cell, rows * cell) {
                        drawSquishy(p, center, cell * scale, squash.coerceIn(-0.4f, 0.4f), now)
                    }
                } else {
                    drawSquishy(p, center, cell * scale, squash.coerceIn(-0.4f, 0.4f), now, selected = selected)
                }
            }

            // Cleared pieces: squash flat, puff up, then vanish.
            val it = view.pops.iterator()
            while (it.hasNext()) {
                val pop = it.next()
                val k = (now - pop.start) / 0.26f
                if (k >= 1f) {
                    it.remove(); continue
                }
                val squash = if (k < 0.35f) 0.38f * (k / 0.35f) else 0.38f * (1f - (k - 0.35f) / 0.65f) - 0.2f * (k - 0.35f)
                val scale = if (k < 0.35f) 1f + 0.12f * k / 0.35f else 1.12f * (1f - (k - 0.35f) / 0.65f)
                drawSquishy(pop.piece, view.center(pop.pos), cell * max(0.05f, scale), squash.coerceIn(-0.4f, 0.4f), now, alpha = (1.6f - k * 1.6f).coerceIn(0f, 1f))
            }
        }

        // Bubble wrap sits on top (fresh pieces below a wrap appear to come out from under it).
        for (r in 0 until rows) for (c in 0 until cols) {
            val w = snap.wrap[r][c]
            if (w > 0) drawWrap(Offset(c * cell, r * cell), cell, w, now)
        }

        // Goo / wrap hit flashes.
        val fl = view.flashes.iterator()
        while (fl.hasNext()) {
            val (p, t0) = fl.next()
            val k = (now - t0) / 0.3f
            if (k >= 1f) {
                fl.remove(); continue
            }
            drawRoundRect(
                Color.White.copy(alpha = 0.8f * (1f - k)), Offset(p.c * cell, p.r * cell), Size(cell, cell), CornerRadius(cell * 0.25f),
            )
        }
    }
}

// ---------------------------------------------------------------------------------------------- HUD

@Composable
private fun Hud(ctl: GameController, onPause: () -> Unit) {
    val level = ctl.level
    val shownScore by animateIntAsState(ctl.score, tween(450), label = "score")
    Column(
        Modifier
            .fillMaxWidth()
            .shadow(8.dp, RoundedCornerShape(24.dp))
            .background(Brush.verticalGradient(listOf(Color(0xFFFFFFFF), Color(0xFFFFE9F4))), RoundedCornerShape(24.dp))
            .padding(horizontal = 10.dp, vertical = 8.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            RoundIconButton(color = Color(0xFFFFD6EC), onClick = onPause) {
                val w = size.width
                drawRoundRect(Ink, Offset(w * 0.18f, w * 0.1f), Size(w * 0.22f, w * 0.8f), CornerRadius(w * 0.08f))
                drawRoundRect(Ink, Offset(w * 0.6f, w * 0.1f), Size(w * 0.22f, w * 0.8f), CornerRadius(w * 0.08f))
            }
            Spacer(Modifier.width(8.dp))
            Column(Modifier.weight(1f)) {
                Text("Bane ${level.number}", color = Ink.copy(alpha = 0.7f), fontWeight = FontWeight.Bold, fontSize = 14.sp)
                Text(fmt(shownScore), color = Ink, fontWeight = FontWeight.Black, fontSize = 26.sp)
            }
            MovesBubble(ctl.moves)
        }
        StarBar(shownScore, level.stars)
        GoalRow(ctl, Modifier.fillMaxWidth())
    }
}

@Composable
private fun MovesBubble(moves: Int) {
    val bump = remember { Animatable(1f) }
    LaunchedEffect(moves) {
        bump.snapTo(1.25f)
        bump.animateTo(1f, spring(dampingRatio = Spring.DampingRatioMediumBouncy, stiffness = Spring.StiffnessMedium))
    }
    val color = if (moves <= 3) Color(0xFFFF5A6E) else Color(0xFF8C7BFF)
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Box(
            Modifier
                .size(64.dp)
                .graphicsLayer { scaleX = bump.value; scaleY = 2f - bump.value }
                .shadow(5.dp, RoundedCornerShape(32.dp))
                .background(Brush.verticalGradient(listOf(color.lighten(0.35f), color)), RoundedCornerShape(32.dp)),
            contentAlignment = Alignment.Center,
        ) {
            BubblyText("$moves", 30.sp, Color.White, outline = color.darken(0.45f))
        }
        Text("træk", color = Ink.copy(alpha = 0.7f), fontWeight = FontWeight.Bold, fontSize = 12.sp)
    }
}

@Composable
private fun StarBar(score: Int, thresholds: IntArray) {
    val max = (thresholds.lastOrNull() ?: 1).coerceAtLeast(1) * 1.08f
    val fill by animateFloatAsState((score / max).coerceIn(0f, 1f), tween(300), label = "bar")
    Canvas(Modifier.fillMaxWidth().height(26.dp)) {
        val h = size.height
        val barH = h * 0.46f
        val top = (h - barH) / 2f
        val rad = CornerRadius(barH / 2f)
        drawRoundRect(Color(0x22000000), Offset(0f, top), Size(size.width, barH), rad)
        if (fill > 0f) {
            drawRoundRect(
                Brush.horizontalGradient(listOf(Color(0xFFFF9CCB), Color(0xFFFF5FA2), Color(0xFFFFB648))),
                Offset(0f, top), Size(max(barH, size.width * fill), barH), rad,
            )
            drawRoundRect(Color.White.copy(alpha = 0.45f), Offset(barH * 0.4f, top + barH * 0.15f), Size(max(0f, size.width * fill - barH * 0.8f), barH * 0.25f), rad)
        }
        thresholds.forEachIndexed { i, t ->
            val x = (t / max * size.width).coerceIn(h / 2f, size.width - h / 2f)
            drawStar(Offset(x, h / 2f), h * if (i == 2) 0.55f else 0.48f, on = score >= t)
        }
    }
}

@Composable
private fun GoalRow(ctl: GameController, modifier: Modifier) {
    Row(modifier, horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.CenterHorizontally)) {
        ctl.level.goals.forEachIndexed { i, goal ->
            GoalChip(goal, ctl.goals.getOrElse(i) { 0 }, ctl.targets[i])
        }
    }
}

@Composable
private fun GoalChip(goal: Goal, progress: Int, target: Int) {
    val done = progress >= target
    val bump = remember { Animatable(1f) }
    LaunchedEffect(progress) {
        if (progress > 0) {
            bump.snapTo(1.18f)
            bump.animateTo(1f, spring(dampingRatio = Spring.DampingRatioMediumBouncy))
        }
    }
    Row(
        Modifier
            .graphicsLayer { scaleX = bump.value; scaleY = bump.value }
            .background(if (done) Color(0xFFD8F7E5) else Color(0xFFFFFFFF), RoundedCornerShape(16.dp))
            .padding(horizontal = 8.dp, vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        GoalIcon(goal, Modifier.size(28.dp))
        Spacer(Modifier.width(5.dp))
        if (done) {
            Canvas(Modifier.size(22.dp)) {
                val w = size.width
                drawCircle(Color(0xFF34C77B))
                val path = androidx.compose.ui.graphics.Path().apply {
                    moveTo(w * 0.27f, w * 0.52f); lineTo(w * 0.44f, w * 0.69f); lineTo(w * 0.75f, w * 0.34f)
                }
                drawPath(path, Color.White, style = Stroke(w * 0.13f, cap = androidx.compose.ui.graphics.StrokeCap.Round))
            }
        } else {
            val text = if (goal is Goal.Score) "${fmt(progress)}/${fmt(target)}" else "$progress/$target"
            Text(text, color = Ink, fontWeight = FontWeight.Black, fontSize = 15.sp)
        }
    }
}

@Composable
private fun GoalIcon(goal: Goal, modifier: Modifier) {
    Canvas(modifier) {
        val s = size.minDimension
        when (goal) {
            is Goal.Collect -> drawKindIcon(goal.kind, center, s)
            Goal.ClearGoo -> drawGoo(Offset.Zero, s, 2, 0f)
            Goal.PopWrap -> drawWrap(Offset.Zero, s, 1, 0f)
            is Goal.Score -> drawStar(center, s * 0.48f, on = true)
        }
    }
}

// ---------------------------------------------------------------------------------------------- overlays

@Composable
private fun Scrim(content: @Composable () -> Unit) {
    Box(
        Modifier
            .fillMaxSize()
            .background(Color(0x66401040))
            .clickable(interactionSource = remember { MutableInteractionSource() }, indication = null) {},
        contentAlignment = Alignment.Center,
    ) { content() }
}

@Composable
private fun IntroCard(level: Level, ctl: GameController) {
    SquishCard {
        BubblyText("Bane ${level.number}", 42.sp, Bubblegum)
        level.goals.forEach { goal ->
            Row(verticalAlignment = Alignment.CenterVertically) {
                GoalIcon(goal, Modifier.size(34.dp))
                Spacer(Modifier.width(10.dp))
                Text(goalText(goal), color = Ink, fontWeight = FontWeight.Bold, fontSize = 20.sp)
            }
        }
        Text("${level.moves} træk", color = Color(0xFF8C7BFF), fontWeight = FontWeight.Black, fontSize = 22.sp)
        PillButton("Spil!", Color(0xFF4CC38A)) { ctl.start() }
    }
}

@Composable
private fun WinCard(ctl: GameController, onNext: (() -> Unit)?, onRetry: () -> Unit, onMap: () -> Unit) {
    var shown by remember { mutableIntStateOf(0) }
    LaunchedEffect(Unit) {
        delay(350)
        for (i in 1..ctl.stars) {
            shown = i
            ctl.audio.star(i)
            delay(420)
        }
        if (ctl.stars == 3) ctl.audio.speak("Squishy!")
    }
    val audio = ctl.audio
    SquishCard {
        BubblyText("Bane klaret!", 38.sp, Color(0xFF4CC38A))
        Row(horizontalArrangement = Arrangement.spacedBy(4.dp), verticalAlignment = Alignment.Bottom) {
            for (i in 1..3) PoppingStar(on = i <= shown, big = i == 2)
        }
        Text("Point: ${fmt(ctl.score)}", color = Ink, fontWeight = FontWeight.Black, fontSize = 24.sp)
        if (ctl.newBest) Text("Ny rekord!", color = Bubblegum, fontWeight = FontWeight.Black, fontSize = 18.sp)
        if (onNext != null) PillButton("Næste bane", Color(0xFF4CC38A)) { audio.click(); onNext() }
        PillButton("Prøv igen", Color(0xFFFFA84D)) { audio.click(); onRetry() }
        PillButton("Kort", Color(0xFF8C7BFF)) { audio.click(); onMap() }
    }
}

@Composable
private fun PoppingStar(on: Boolean, big: Boolean) {
    val scale = remember { Animatable(1f) }
    LaunchedEffect(on) {
        if (on) {
            scale.snapTo(0.2f)
            scale.animateTo(1f, spring(dampingRatio = 0.35f, stiffness = Spring.StiffnessMediumLow))
        }
    }
    Canvas(
        Modifier
            .size(if (big) 76.dp else 60.dp)
            .graphicsLayer { scaleX = scale.value; scaleY = scale.value; rotationZ = (1f - scale.value) * 40f },
    ) {
        drawStar(center, size.minDimension * 0.47f, on = on)
    }
}

@Composable
private fun CalloutView(callout: Callout?) {
    if (callout == null) return
    val anim = remember(callout.id) { Animatable(0f) }
    LaunchedEffect(callout.id) { anim.animateTo(1f, tween(1300)) }
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        BubblyText(
            callout.text, 50.sp, callout.color,
            Modifier.graphicsLayer {
                val k = anim.value
                val appear = if (k < 0.18f) k / 0.18f else 1f
                val s = 0.4f + appear * 0.75f - (if (k > 0.18f) (k - 0.18f) * 0.15f else 0f)
                scaleX = s * (1f + sin(k * 30f) * 0.06f * (1f - k))
                scaleY = s * (1f - sin(k * 30f) * 0.06f * (1f - k))
                rotationZ = sin(k * 22f) * 8f * (1f - k)
                translationY = -k * 60.dp.toPx()
                alpha = if (k > 0.75f) (1f - k) / 0.25f else 1f
            },
        )
    }
}

@Composable
private fun FinaleBanner(visible: Boolean) {
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        AnimatedVisibility(
            visible,
            enter = scaleIn(spring(dampingRatio = 0.4f)) + fadeIn(),
            exit = scaleOut() + fadeOut(),
        ) {
            Box(
                Modifier
                    .shadow(10.dp, RoundedCornerShape(28.dp))
                    .background(Brush.horizontalGradient(listOf(Color(0xFFFF7EB9), Color(0xFFB58CFF), Color(0xFF63C7FF))), RoundedCornerShape(28.dp))
                    .padding(horizontal = 22.dp, vertical = 12.dp),
            ) {
                BubblyText("Squishy Finale!", 40.sp, Color(0xFFFFF59D))
            }
        }
    }
}
