package com.baldissera.lommepenge

import android.content.SharedPreferences
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import org.json.JSONArray
import org.json.JSONObject
import java.time.DayOfWeek
import java.time.LocalDate
import java.time.temporal.ChronoUnit
import java.time.temporal.TemporalAdjusters
import java.time.temporal.WeekFields
import java.util.UUID
import kotlin.math.abs

enum class Repeat(val label: String) { DAILY("Hver dag"), WEEKLY("Hver uge"), ONCE("Én gang") }

enum class Status { TODO, PENDING, DONE }

/** All money is in øre so 2,50 kr rewards work without rounding. */
data class Kid(
    val id: String,
    val name: String,
    val avatar: String,
    val color: Int,
    val balance: Int = 0,
    val weekly: Int = 0,
    val goalName: String = "",
    val goalEmoji: String = "🎁",
    val goalAmount: Int = 0,
    /** Monday of the last week whose weekly allowance was paid. */
    val allowanceFrom: String = "",
)

data class Chore(
    val id: String,
    val title: String,
    val emoji: String,
    val reward: Int,
    val repeat: Repeat,
    val kids: Set<String>,
)

/** A chore a kid has ticked off for one period (a day, a week, or for good). */
data class Mark(
    val chore: String,
    val kid: String,
    val period: String,
    val approved: Boolean,
    val time: Long,
)

data class Txn(val kid: String, val amount: Int, val text: String, val emoji: String, val time: Long)

data class Family(
    val kids: List<Kid> = emptyList(),
    val chores: List<Chore> = emptyList(),
    val marks: List<Mark> = emptyList(),
    val txns: List<Txn> = emptyList(),
    val pin: String = "1234",
    val pinChanged: Boolean = false,
    val approval: Boolean = true,
)

fun kr(ore: Int): String {
    val sign = if (ore < 0) "-" else ""
    val a = abs(ore)
    return if (a % 100 == 0) "$sign${a / 100} kr" else "$sign${a / 100},%02d kr".format(a % 100)
}

/** Parses "12", "2,5" or "2.50 kr" into øre; null if it isn't a number. */
fun parseKr(text: String): Int? {
    val clean = text.replace("kr", "").trim().replace(',', '.')
    if (clean.isEmpty()) return 0
    val v = clean.toDoubleOrNull() ?: return null
    return Math.round(v * 100).toInt()
}

fun newId(): String = UUID.randomUUID().toString().take(8)

fun weekKey(d: LocalDate): String =
    "%d-W%02d".format(d.get(WeekFields.ISO.weekBasedYear()), d.get(WeekFields.ISO.weekOfWeekBasedYear()))

fun periodOf(r: Repeat, d: LocalDate): String = when (r) {
    Repeat.DAILY -> d.toString()
    Repeat.WEEKLY -> weekKey(d)
    Repeat.ONCE -> "once"
}

fun mondayOf(d: LocalDate): LocalDate = d.with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY))

class Store(
    private val prefs: SharedPreferences,
    private val today: () -> LocalDate = { LocalDate.now() },
    private val clock: () -> Long = { System.currentTimeMillis() },
) {
    var family by mutableStateOf(load())
        private set

    private fun load(): Family {
        val raw = prefs.getString(KEY, null) ?: return starter(today())
        return runCatching { familyFromJson(JSONObject(raw)) }.getOrElse { starter(today()) }
    }

    private fun update(f: (Family) -> Family) {
        family = f(family)
        prefs.edit().putString(KEY, family.toJson().toString()).apply()
    }

    fun kid(id: String): Kid? = family.kids.firstOrNull { it.id == id }

    fun chore(id: String): Chore? = family.chores.firstOrNull { it.id == id }

    private fun markOf(chore: Chore, kid: String): Mark? {
        val p = periodOf(chore.repeat, today())
        return family.marks.firstOrNull { it.chore == chore.id && it.kid == kid && it.period == p }
    }

    fun status(chore: Chore, kid: String): Status {
        val m = markOf(chore, kid) ?: return Status.TODO
        return if (m.approved) Status.DONE else Status.PENDING
    }

    /** Chores the kid sees; one-off jobs disappear once they're approved. */
    fun choresFor(kid: String, repeat: Repeat): List<Chore> = family.chores.filter {
        kid in it.kids && it.repeat == repeat && !(it.repeat == Repeat.ONCE && status(it, kid) == Status.DONE)
    }

    /** Ticked-off and total chores for today (daily ones). */
    fun progress(kid: String): Pair<Int, Int> {
        val list = choresFor(kid, Repeat.DAILY)
        return list.count { status(it, kid) != Status.TODO } to list.size
    }

    fun tick(chore: Chore, kid: String) {
        if (markOf(chore, kid) != null) return
        val m = Mark(chore.id, kid, periodOf(chore.repeat, today()), approved = !family.approval, time = clock())
        update { it.copy(marks = it.marks + m) }
        if (m.approved) credit(kid, chore.reward, chore.title, chore.emoji)
    }

    fun pending(): List<Mark> = family.marks.filter { !it.approved && chore(it.chore) != null && kid(it.kid) != null }

    fun approve(m: Mark) {
        val c = chore(m.chore) ?: return
        update { f -> f.copy(marks = f.marks.map { if (it == m) it.copy(approved = true) else it }) }
        credit(m.kid, c.reward, c.title, c.emoji)
    }

    fun approveAll() = pending().forEach { approve(it) }

    fun reject(m: Mark) = update { f -> f.copy(marks = f.marks - m) }

    /** Adds (or with a negative amount, takes out) money and writes it in the kid's piggy-bank diary. */
    fun credit(kid: String, amount: Int, text: String, emoji: String) {
        if (amount == 0) return
        update { f ->
            f.copy(
                kids = f.kids.map { if (it.id == kid) it.copy(balance = it.balance + amount) else it },
                txns = (f.txns + Txn(kid, amount, text, emoji, clock())).takeLast(MAX_TXNS),
            )
        }
    }

    fun history(kid: String): List<Txn> = family.txns.filter { it.kid == kid }.asReversed()

    /** Pays each kid's weekly allowance for every Monday since the last payment. */
    fun payAllowances() {
        val monday = mondayOf(today())
        for (k in family.kids) {
            val last = runCatching { LocalDate.parse(k.allowanceFrom) }.getOrNull()
            if (last == null) {
                saveKid(k.copy(allowanceFrom = monday.toString()))
                continue
            }
            val weeks = ChronoUnit.WEEKS.between(last, monday).toInt().coerceIn(0, 12)
            if (weeks == 0) continue
            update { f -> f.copy(kids = f.kids.map { if (it.id == k.id) it.copy(allowanceFrom = monday.toString()) else it }) }
            if (k.weekly > 0) {
                credit(k.id, k.weekly * weeks, if (weeks == 1) "Ugepenge" else "Ugepenge ($weeks uger)", "📅")
            }
        }
    }

    /** Forgets ticks from long ago so the saved data stays small. */
    fun tidy() {
        val cutoff = today().minusDays(45).toString()
        update { f ->
            f.copy(marks = f.marks.filter { m ->
                val c = f.chores.firstOrNull { it.id == m.chore } ?: return@filter false
                when (c.repeat) {
                    Repeat.DAILY -> m.period >= cutoff
                    Repeat.WEEKLY -> m.period >= weekKey(today().minusDays(45))
                    Repeat.ONCE -> true
                }
            })
        }
    }

    fun saveKid(k: Kid) = update { f ->
        if (f.kids.any { it.id == k.id }) f.copy(kids = f.kids.map { if (it.id == k.id) k else it })
        else f.copy(
            kids = f.kids + k.copy(allowanceFrom = mondayOf(today()).toString()),
            chores = f.chores.map { if (it.repeat != Repeat.ONCE) it.copy(kids = it.kids + k.id) else it },
        )
    }

    fun removeKid(id: String) = update { f ->
        f.copy(
            kids = f.kids.filter { it.id != id },
            chores = f.chores.map { it.copy(kids = it.kids - id) },
            marks = f.marks.filter { it.kid != id },
            txns = f.txns.filter { it.kid != id },
        )
    }

    fun saveChore(c: Chore) = update { f ->
        if (f.chores.any { it.id == c.id }) f.copy(chores = f.chores.map { if (it.id == c.id) c else it })
        else f.copy(chores = f.chores + c)
    }

    fun removeChore(id: String) = update { f ->
        f.copy(chores = f.chores.filter { it.id != id }, marks = f.marks.filter { it.chore != id })
    }

    fun setPin(pin: String) = update { it.copy(pin = pin, pinChanged = true) }

    fun setApproval(on: Boolean) = update { it.copy(approval = on) }

    companion object {
        const val KEY = "family"
        private const val MAX_TXNS = 400
    }
}

/** What a fresh install starts with; every bit of it can be edited in the parent area. */
fun starter(today: LocalDate): Family {
    val monday = mondayOf(today).toString()
    val kids = listOf(
        Kid("victor", "Victor", "🦁", 0, weekly = 2000, goalName = "LEGO", goalEmoji = "🧱", goalAmount = 30000, allowanceFrom = monday),
        Kid("filucca", "Filucca", "🦄", 1, weekly = 2000, goalName = "Nyt spil", goalEmoji = "🎮", goalAmount = 25000, allowanceFrom = monday),
    )
    val all = kids.map { it.id }.toSet()
    val chores = listOf(
        Chore(newId(), "Red sengen", "🛏️", 200, Repeat.DAILY, all),
        Chore(newId(), "Børst tænder", "🦷", 100, Repeat.DAILY, all),
        Chore(newId(), "Dæk bord", "🍽️", 300, Repeat.DAILY, all),
        Chore(newId(), "Ryd op på værelset", "🧸", 1000, Repeat.WEEKLY, all),
        Chore(newId(), "Gå ud med skraldet", "🗑️", 500, Repeat.WEEKLY, all),
        Chore(newId(), "Hjælp med at støvsuge", "🧹", 1500, Repeat.WEEKLY, all),
    )
    return Family(kids = kids, chores = chores)
}

private fun Family.toJson() = JSONObject().apply {
    put("pin", pin)
    put("pinChanged", pinChanged)
    put("approval", approval)
    put("kids", JSONArray(kids.map { k ->
        JSONObject().put("id", k.id).put("name", k.name).put("avatar", k.avatar).put("color", k.color)
            .put("balance", k.balance).put("weekly", k.weekly).put("goalName", k.goalName)
            .put("goalEmoji", k.goalEmoji).put("goalAmount", k.goalAmount).put("allowanceFrom", k.allowanceFrom)
    }))
    put("chores", JSONArray(chores.map { c ->
        JSONObject().put("id", c.id).put("title", c.title).put("emoji", c.emoji).put("reward", c.reward)
            .put("repeat", c.repeat.name).put("kids", JSONArray(c.kids.toList()))
    }))
    put("marks", JSONArray(marks.map { m ->
        JSONObject().put("chore", m.chore).put("kid", m.kid).put("period", m.period)
            .put("approved", m.approved).put("time", m.time)
    }))
    put("txns", JSONArray(txns.map { t ->
        JSONObject().put("kid", t.kid).put("amount", t.amount).put("text", t.text).put("emoji", t.emoji).put("time", t.time)
    }))
}

private fun JSONArray?.objects(): List<JSONObject> =
    if (this == null) emptyList() else (0 until length()).map { getJSONObject(it) }

private fun familyFromJson(o: JSONObject) = Family(
    pin = o.optString("pin", "1234"),
    pinChanged = o.optBoolean("pinChanged", false),
    approval = o.optBoolean("approval", true),
    kids = o.optJSONArray("kids").objects().map { k ->
        Kid(
            id = k.getString("id"), name = k.getString("name"), avatar = k.optString("avatar", "🙂"),
            color = k.optInt("color"), balance = k.optInt("balance"), weekly = k.optInt("weekly"),
            goalName = k.optString("goalName"), goalEmoji = k.optString("goalEmoji", "🎁"),
            goalAmount = k.optInt("goalAmount"), allowanceFrom = k.optString("allowanceFrom"),
        )
    },
    chores = o.optJSONArray("chores").objects().map { c ->
        val ids = c.optJSONArray("kids")
        Chore(
            id = c.getString("id"), title = c.getString("title"), emoji = c.optString("emoji", "⭐"),
            reward = c.optInt("reward"),
            repeat = runCatching { Repeat.valueOf(c.getString("repeat")) }.getOrDefault(Repeat.DAILY),
            kids = if (ids == null) emptySet() else (0 until ids.length()).map { ids.getString(it) }.toSet(),
        )
    },
    marks = o.optJSONArray("marks").objects().map { m ->
        Mark(m.getString("chore"), m.getString("kid"), m.getString("period"), m.optBoolean("approved"), m.optLong("time"))
    },
    txns = o.optJSONArray("txns").objects().map { t ->
        Txn(t.getString("kid"), t.getInt("amount"), t.optString("text"), t.optString("emoji", "💰"), t.optLong("time"))
    },
)
