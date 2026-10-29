package com.baldissera.lommepenge

import android.content.SharedPreferences
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import org.json.JSONArray
import org.json.JSONObject
import java.time.DayOfWeek
import java.time.LocalDate
import java.time.temporal.TemporalAdjusters
import java.time.temporal.WeekFields
import java.util.UUID
import kotlin.math.abs

enum class Repeat(val label: String) { DAILY("Hver dag"), WEEKLY("Hver uge"), ONCE("Én gang") }

enum class Status { TODO, PENDING, DONE }

/**
 * All money is in øre so 2,50 kr rewards work without rounding. The balance is never stored: it is the sum of the
 * kid's transactions, so two phones changing it at the same time can't lose money.
 */
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
    /** Weekly allowance is paid for every Monday after this one. */
    val since: String = "",
    val order: Long = 0,
)

data class Chore(
    val id: String,
    val title: String,
    val emoji: String,
    val reward: Int,
    val repeat: Repeat,
    val kids: Set<String>,
    val order: Long = 0,
)

/** A chore a kid has ticked off for one period (a day, a week, or for good). */
data class Mark(
    val chore: String,
    val kid: String,
    val period: String,
    val approved: Boolean,
    val time: Long,
) {
    val key get() = markKey(chore, kid, period)
}

data class Txn(val id: String, val kid: String, val amount: Int, val text: String, val emoji: String, val time: Long)

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

fun markKey(chore: String, kid: String, period: String) = "${chore}_${kid}_$period"

enum class SyncState { OFF, CONNECTING, ONLINE, OFFLINE, ERROR }

/**
 * The family's data, kept as one JSON tree in the same shape as the online database (see web/README.md):
 * settings, kids, chores, marks and txns. Every change is a set of path → value writes; they apply locally at once
 * and, when the family is shared online, are queued and sent to the server, which streams everyone's changes back.
 */
class Store(
    private val prefs: SharedPreferences,
    private val today: () -> LocalDate = { LocalDate.now() },
    private val clock: () -> Long = { System.currentTimeMillis() },
    private val remote: Remote? = null,
) {
    /** The server's copy (or the only copy while not shared online). */
    private var base: JSONObject = JSONObject()
    /** Writes not yet confirmed by the server, oldest first. */
    private val pending = ArrayList<JSONObject>()

    var family by mutableStateOf(Family())
        private set
    var sync by mutableStateOf(SyncState.OFF)
        private set
    var code by mutableStateOf(prefs.getString(CODE, "") ?: "")
        private set

    init {
        val saved = prefs.getString(TREE, null)
        val old = prefs.getString(OLD_KEY, null)
        base = when {
            saved != null -> runCatching { JSONObject(saved) }.getOrElse { starterTree() }
            old != null -> runCatching { migrate(JSONObject(old)) }.getOrElse { starterTree() }
            else -> starterTree()
        }
        prefs.getString(PENDING, null)?.let { s ->
            runCatching { JSONArray(s) }.getOrNull()?.let { a -> for (i in 0 until a.length()) pending += a.getJSONObject(i) }
        }
        refresh()
        save()
        if (old != null) prefs.edit().remove(OLD_KEY).apply()
    }

    val online get() = code.isNotEmpty() && remote != null

    /** Starts streaming from the server and resends anything written while offline. */
    fun connect() {
        val r = remote ?: return
        if (code.isEmpty()) return
        r.start(code, ::onServer, { sync = it })
        for (u in pending) r.send(code, u, ::onAck)
    }

    fun disconnect() {
        remote?.stop()
        sync = SyncState.OFF
    }

    /** Shares this phone's family online under a new code. */
    fun createOnline(): String {
        val newCode = familyCode()
        val all = JSONObject()
        val tree = display()
        for (k in listOf("settings", "kids", "chores", "marks", "txns")) all.put(k, tree.opt(k) ?: JSONObject.NULL)
        base = tree
        pending.clear()
        pending += all
        rememberCode(newCode)
        save()
        connect()
        return newCode
    }

    /** Joins a family another phone already shares; this phone's own data is replaced by theirs. */
    fun join(raw: String): Boolean {
        val c = normalizeCode(raw) ?: return false
        disconnect()
        base = JSONObject()
        pending.clear()
        rememberCode(c)
        refresh()
        save()
        connect()
        return true
    }

    /** Stops sharing; the phone keeps its current copy and works on its own again. */
    fun leave() {
        disconnect()
        base = display()
        pending.clear()
        rememberCode("")
        refresh()
        save()
    }

    private fun rememberCode(c: String) {
        code = c
        prefs.edit().putString(CODE, c).apply()
    }

    private fun onServer(path: String, data: Any?) {
        base = applyAt(base, path, data)
        refresh()
        save()
    }

    private fun onAck(u: JSONObject) {
        pending.remove(u)
        save()
    }

    private fun write(u: JSONObject) {
        if (u.length() == 0) return
        if (online) {
            pending += u
            remote?.send(code, u, ::onAck)
        } else {
            for (k in u.keys()) base = applyAt(base, k, u.get(k))
        }
        refresh()
        save()
    }

    private fun display(): JSONObject {
        var t = JSONObject(base.toString())
        for (u in pending) for (k in u.keys()) t = applyAt(t, k, u.get(k))
        return t
    }

    private fun refresh() {
        family = familyOf(display())
    }

    private fun save() {
        prefs.edit()
            .putString(TREE, base.toString())
            .putString(PENDING, JSONArray(pending).toString())
            .apply()
    }

    fun kid(id: String): Kid? = family.kids.firstOrNull { it.id == id }

    fun chore(id: String): Chore? = family.chores.firstOrNull { it.id == id }

    private fun markOf(chore: Chore, kid: String): Mark? {
        val key = markKey(chore.id, kid, periodOf(chore.repeat, today()))
        return family.marks.firstOrNull { it.key == key }
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
        val u = upd("marks/${m.key}" to m.json())
        if (m.approved) u.put("txns/m_${m.key}", txnJson(kid, chore.reward, chore.title, chore.emoji))
        write(u)
    }

    fun pending(): List<Mark> = family.marks.filter { !it.approved && chore(it.chore) != null && kid(it.kid) != null }

    fun approve(m: Mark) = approveAll(listOf(m))

    fun approveAll(list: List<Mark> = pending()) {
        val u = JSONObject()
        for (m in list) {
            val c = chore(m.chore) ?: continue
            u.put("marks/${m.key}/approved", true)
            u.put("txns/m_${m.key}", txnJson(m.kid, c.reward, c.title, c.emoji))
        }
        write(u)
    }

    fun reject(m: Mark) = write(upd("marks/${m.key}" to null))

    /** Adds (or with a negative amount, takes out) money and writes it in the kid's piggy-bank diary. */
    fun credit(kid: String, amount: Int, text: String, emoji: String) {
        if (amount == 0) return
        write(upd("txns/${newId()}" to txnJson(kid, amount, text, emoji)))
    }

    fun history(kid: String): List<Txn> = family.txns.filter { it.kid == kid }.asReversed()

    /**
     * Pays each kid's weekly allowance for every Monday since they were added (at most 12 weeks back). Each payment
     * has a fixed id per kid and Monday, so two phones paying at once still pay only once.
     */
    fun payAllowances() {
        val monday = mondayOf(today())
        val have = family.txns.map { it.id }.toSet()
        val u = JSONObject()
        for (k in family.kids) {
            if (k.weekly <= 0) continue
            val since = runCatching { LocalDate.parse(k.since) }.getOrNull() ?: continue
            var m = maxOf(since.plusWeeks(1), monday.minusWeeks(11))
            while (!m.isAfter(monday)) {
                val id = "a_${k.id}_$m"
                if (id !in have) {
                    u.put("txns/$id", txnJson(k.id, k.weekly, "Ugepenge", "📅", m.atTime(7, 0)
                        .atZone(java.time.ZoneId.systemDefault()).toInstant().toEpochMilli()))
                }
                m = m.plusWeeks(1)
            }
        }
        write(u)
    }

    /** Forgets old daily and weekly ticks (and ticks of deleted chores) so the data stays small. */
    fun tidy() {
        val day = today().minusDays(45).toString()
        val week = weekKey(today().minusDays(45))
        val u = JSONObject()
        for (m in family.marks) {
            val c = chore(m.chore)
            val old = when (c?.repeat) {
                null -> true
                Repeat.DAILY -> m.period < day
                Repeat.WEEKLY -> m.period < week
                Repeat.ONCE -> false
            }
            if (old || kid(m.kid) == null) u.put("marks/${m.key}", JSONObject.NULL)
        }
        write(u)
    }

    fun saveKid(k: Kid) {
        val old = kid(k.id)
        val monday = mondayOf(today()).toString()
        if (old == null) {
            val id = k.id.ifEmpty { newId() }
            val u = upd("kids/$id" to k.copy(id = id, since = monday, order = clock()).json())
            for (c in family.chores) if (c.repeat != Repeat.ONCE) u.put("chores/${c.id}/kids/$id", true)
            write(u)
        } else {
            // A changed allowance starts next Monday rather than being paid for weeks gone by.
            val since = if (old.weekly != k.weekly) monday else old.since
            write(upd("kids/${k.id}" to k.copy(since = since, order = old.order).json()))
        }
    }

    fun removeKid(id: String) {
        val u = upd("kids/$id" to null)
        for (m in family.marks) if (m.kid == id) u.put("marks/${m.key}", JSONObject.NULL)
        for (t in family.txns) if (t.kid == id) u.put("txns/${t.id}", JSONObject.NULL)
        for (c in family.chores) if (id in c.kids) u.put("chores/${c.id}/kids/$id", JSONObject.NULL)
        write(u)
    }

    fun saveChore(c: Chore) {
        val old = chore(c.id)
        val id = c.id.ifEmpty { newId() }
        write(upd("chores/$id" to c.copy(id = id, order = old?.order ?: clock()).json()))
    }

    fun removeChore(id: String) {
        val u = upd("chores/$id" to null)
        for (m in family.marks) if (m.chore == id) u.put("marks/${m.key}", JSONObject.NULL)
        write(u)
    }

    fun setPin(pin: String) = write(upd("settings/pin" to pin, "settings/pinChanged" to true))

    fun setApproval(on: Boolean) = write(upd("settings/approval" to on))

    private fun txnJson(kid: String, amount: Int, text: String, emoji: String, time: Long = clock()) =
        JSONObject().put("kid", kid).put("amount", amount).put("text", text).put("emoji", emoji).put("time", time)

    private fun starterTree(): JSONObject {
        val monday = mondayOf(today()).toString()
        val t = clock()
        val kids = listOf(
            Kid("victor", "Victor", "🦁", 0, weekly = 2000, goalName = "LEGO", goalEmoji = "🧱", goalAmount = 30000, since = monday, order = t),
            Kid("filucca", "Filucca", "🦄", 1, weekly = 2000, goalName = "Nyt spil", goalEmoji = "🎮", goalAmount = 25000, since = monday, order = t + 1),
        )
        val all = kids.map { it.id }.toSet()
        val chores = listOf(
            Chore(newId(), "Red sengen", "🛏️", 200, Repeat.DAILY, all, t),
            Chore(newId(), "Børst tænder", "🦷", 100, Repeat.DAILY, all, t + 1),
            Chore(newId(), "Dæk bord", "🍽️", 300, Repeat.DAILY, all, t + 2),
            Chore(newId(), "Ryd op på værelset", "🧸", 1000, Repeat.WEEKLY, all, t + 3),
            Chore(newId(), "Gå ud med skraldet", "🗑️", 500, Repeat.WEEKLY, all, t + 4),
            Chore(newId(), "Hjælp med at støvsuge", "🧹", 1500, Repeat.WEEKLY, all, t + 5),
        )
        return JSONObject()
            .put("settings", JSONObject().put("pin", "1234").put("pinChanged", false).put("approval", true))
            .put("kids", JSONObject().apply { kids.forEach { put(it.id, it.json()) } })
            .put("chores", JSONObject().apply { chores.forEach { put(it.id, it.json()) } })
    }

    /** Converts data saved by the first version of the app (balances stored on each kid). */
    private fun migrate(o: JSONObject): JSONObject {
        val tree = JSONObject()
        tree.put("settings", JSONObject().put("pin", o.optString("pin", "1234"))
            .put("pinChanged", o.optBoolean("pinChanged")).put("approval", o.optBoolean("approval", true)))
        val txns = JSONObject()
        val sums = HashMap<String, Int>()
        o.optJSONArray("txns").objects().forEach { t ->
            val kid = t.getString("kid")
            sums[kid] = (sums[kid] ?: 0) + t.getInt("amount")
            txns.put(newId(), JSONObject().put("kid", kid).put("amount", t.getInt("amount")).put("text", t.optString("text"))
                .put("emoji", t.optString("emoji", "💰")).put("time", t.optLong("time")))
        }
        val kids = JSONObject()
        o.optJSONArray("kids").objects().forEachIndexed { i, k ->
            val id = k.getString("id")
            val diff = k.optInt("balance") - (sums[id] ?: 0)
            if (diff != 0) {
                txns.put(newId(), JSONObject().put("kid", id).put("amount", diff).put("text", "Startsaldo")
                    .put("emoji", "🐷").put("time", 0))
            }
            kids.put(id, Kid(id, k.getString("name"), k.optString("avatar", "🙂"), k.optInt("color"),
                weekly = k.optInt("weekly"), goalName = k.optString("goalName"), goalEmoji = k.optString("goalEmoji", "🎁"),
                goalAmount = k.optInt("goalAmount"),
                since = k.optString("allowanceFrom").ifEmpty { mondayOf(today()).toString() }, order = i.toLong()).json())
        }
        val chores = JSONObject()
        o.optJSONArray("chores").objects().forEachIndexed { i, c ->
            val ids = c.optJSONArray("kids")
            val map = JSONObject()
            if (ids != null) for (j in 0 until ids.length()) map.put(ids.getString(j), true)
            chores.put(c.getString("id"), JSONObject().put("title", c.getString("title")).put("emoji", c.optString("emoji", "⭐"))
                .put("reward", c.optInt("reward")).put("repeat", c.optString("repeat", "DAILY")).put("kids", map).put("order", i))
        }
        val marks = JSONObject()
        o.optJSONArray("marks").objects().forEach { m ->
            val mk = Mark(m.getString("chore"), m.getString("kid"), m.getString("period"), m.optBoolean("approved"), m.optLong("time"))
            marks.put(mk.key, mk.json())
        }
        return tree.put("kids", kids).put("chores", chores).put("marks", marks).put("txns", txns)
    }

    companion object {
        private const val TREE = "tree"
        private const val PENDING = "pending"
        private const val CODE = "familyCode"
        private const val OLD_KEY = "family"
    }
}

private const val CODE_CHARS = "abcdefghjkmnpqrstuvwxyz23456789"

/** A long random code: anyone who has it can see and change the family's data, so it must not be guessable. */
fun familyCode(): String {
    val r = java.security.SecureRandom()
    return (1..20).map { CODE_CHARS[r.nextInt(CODE_CHARS.length)] }.joinToString("")
}

/** Accepts a typed code ("abcd-efgh-…") or a shared link ("…#familie=abcd…"). */
fun normalizeCode(raw: String): String? {
    val c = raw.substringAfter("familie=").lowercase().filter { it in CODE_CHARS }
    return if (c.length >= 16) c else null
}

fun prettyCode(c: String) = c.chunked(4).joinToString("-")

fun upd(vararg pairs: Pair<String, Any?>): JSONObject {
    val o = JSONObject()
    for ((k, v) in pairs) o.put(k, v ?: JSONObject.NULL)
    return o
}

/** Writes [value] at a slash-separated [path] of the tree (null deletes), like the online database does. */
fun applyAt(root: JSONObject, path: String, value: Any?): JSONObject {
    val parts = path.split('/').filter { it.isNotEmpty() }
    val isNull = value == null || value == JSONObject.NULL
    if (parts.isEmpty()) return if (value is JSONObject) JSONObject(value.toString()) else JSONObject()
    var node = root
    for (p in parts.dropLast(1)) {
        node = node.optJSONObject(p) ?: JSONObject().also { node.put(p, it) }
    }
    val last = parts.last()
    if (isNull) node.remove(last)
    else node.put(last, if (value is JSONObject) JSONObject(value.toString()) else value)
    return root
}

private fun Kid.json() = JSONObject().put("name", name).put("avatar", avatar).put("color", color).put("weekly", weekly)
    .put("goalName", goalName).put("goalEmoji", goalEmoji).put("goalAmount", goalAmount).put("since", since).put("order", order)

private fun Chore.json() = JSONObject().put("title", title).put("emoji", emoji).put("reward", reward)
    .put("repeat", repeat.name).put("kids", JSONObject().apply { kids.forEach { put(it, true) } }).put("order", order)

private fun Mark.json() = JSONObject().put("chore", chore).put("kid", kid).put("period", period)
    .put("approved", approved).put("time", time)

private fun JSONArray?.objects(): List<JSONObject> =
    if (this == null) emptyList() else (0 until length()).map { getJSONObject(it) }

private fun JSONObject?.entries(): List<Pair<String, JSONObject>> {
    if (this == null) return emptyList()
    return keys().asSequence().mapNotNull { k -> optJSONObject(k)?.let { k to it } }.toList()
}

fun familyOf(t: JSONObject): Family {
    val s = t.optJSONObject("settings")
    val txns = t.optJSONObject("txns").entries().map { (id, o) ->
        Txn(id, o.optString("kid"), o.optInt("amount"), o.optString("text"), o.optString("emoji", "💰"), o.optLong("time"))
    }.sortedWith(compareBy({ it.time }, { it.id }))
    val sums = txns.groupBy { it.kid }.mapValues { (_, l) -> l.sumOf { it.amount } }
    val kids = t.optJSONObject("kids").entries().map { (id, k) ->
        Kid(
            id = id, name = k.optString("name"), avatar = k.optString("avatar", "🙂"), color = k.optInt("color"),
            balance = sums[id] ?: 0, weekly = k.optInt("weekly"), goalName = k.optString("goalName"),
            goalEmoji = k.optString("goalEmoji", "🎁"), goalAmount = k.optInt("goalAmount"),
            since = k.optString("since"), order = k.optLong("order"),
        )
    }.sortedWith(compareBy({ it.order }, { it.id }))
    val chores = t.optJSONObject("chores").entries().map { (id, c) ->
        Chore(
            id = id, title = c.optString("title"), emoji = c.optString("emoji", "⭐"), reward = c.optInt("reward"),
            repeat = runCatching { Repeat.valueOf(c.optString("repeat")) }.getOrDefault(Repeat.DAILY),
            kids = c.optJSONObject("kids")?.keys()?.asSequence()?.filter { c.optJSONObject("kids")!!.optBoolean(it) }?.toSet()
                ?: emptySet(),
            order = c.optLong("order"),
        )
    }.sortedWith(compareBy({ it.order }, { it.id }))
    val marks = t.optJSONObject("marks").entries().map { (_, m) ->
        Mark(m.optString("chore"), m.optString("kid"), m.optString("period"), m.optBoolean("approved"), m.optLong("time"))
    }
    return Family(
        kids = kids, chores = chores, marks = marks, txns = txns,
        pin = s?.optString("pin", "1234") ?: "1234",
        pinChanged = s?.optBoolean("pinChanged") ?: false,
        approval = s?.optBoolean("approval", true) ?: true,
    )
}
