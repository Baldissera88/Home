package com.baldissera.lommepenge

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.time.LocalDate

/** An in-memory stand-in for the online database that, like the real one, streams every change to every phone. */
private class FakeServer {
    var tree = JSONObject()
    var up = true
    private val listeners = mutableListOf<(String, Any?) -> Unit>()

    fun remote(): Remote = object : Remote {
        var mine: ((String, Any?) -> Unit)? = null
        override fun start(code: String, onData: (String, Any?) -> Unit, onState: (SyncState) -> Unit) {
            mine = onData
            listeners += onData
            onState(SyncState.ONLINE)
            onData("/", JSONObject(tree.toString()))
        }

        override fun send(code: String, update: JSONObject, done: (JSONObject) -> Unit) {
            if (!up) return
            for (k in update.keys()) tree = applyAt(tree, k, update.get(k))
            for (l in listeners.toList()) l("/", JSONObject(tree.toString()))
            done(update)
        }

        override fun stop() {
            mine?.let { listeners.remove(it) }
        }
    }
}

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class SyncTest {
    private var day = LocalDate.of(2026, 10, 28)
    private val server = FakeServer()

    private fun prefs() = ApplicationProvider.getApplicationContext<Context>()
        .getSharedPreferences("sync${System.nanoTime()}", Context.MODE_PRIVATE)

    private fun phone(p: android.content.SharedPreferences = prefs()) = Store(p, today = { day }, remote = server.remote())

    @Test
    fun twoPhonesShareOneFamily() {
        val android = phone()
        val code = android.createOnline()
        val iphone = phone()
        assertTrue(iphone.join(prettyCode(code)))
        assertEquals(android.family.chores.map { it.id }, iphone.family.chores.map { it.id })

        val chore = iphone.choresFor("victor", Repeat.DAILY).first()
        iphone.tick(chore, "victor")
        assertEquals(1, android.pending().size)
        android.approve(android.pending().single())
        assertEquals(chore.reward, iphone.kid("victor")!!.balance)
        assertEquals(Status.DONE, iphone.status(chore, "victor"))
    }

    @Test
    fun bothPhonesPayingAllowanceStillPaysOnce() {
        val a = phone()
        val code = a.createOnline()
        val b = phone().also { it.join(code) }
        day = LocalDate.of(2026, 11, 2)
        a.payAllowances()
        b.payAllowances()
        assertEquals(2000, a.kid("victor")!!.balance)
        assertEquals(2000, b.kid("victor")!!.balance)
    }

    @Test
    fun changesMadeOfflineAreSentLater() {
        val p = prefs()
        val a = phone(p)
        a.createOnline()
        server.up = false
        a.credit("filucca", 1500, "Bonus", "🎁")
        assertEquals(1500, a.kid("filucca")!!.balance)
        assertNull(server.tree.optJSONObject("txns"))
        // The app is closed and opened again later, with the internet back.
        server.up = true
        val again = phone(p)
        again.connect()
        assertEquals(1500, familyOf(server.tree).kids.first { it.id == "filucca" }.balance)
        assertEquals(1500, again.kid("filucca")!!.balance)
    }

    @Test
    fun oldSavedDataIsKept() {
        val p = prefs()
        p.edit().putString("family", """{"pin":"4321","pinChanged":true,"approval":false,
            "kids":[{"id":"v","name":"Victor","avatar":"🦁","color":0,"balance":5000,"weekly":2000,"allowanceFrom":"2026-10-26"}],
            "chores":[{"id":"c","title":"Red seng","emoji":"🛏️","reward":200,"repeat":"DAILY","kids":["v"]}],
            "marks":[],"txns":[{"kid":"v","amount":2000,"text":"Ugepenge","emoji":"📅","time":1}]}""").apply()
        val s = Store(p, today = { day })
        assertEquals("4321", s.family.pin)
        assertEquals(5000, s.kid("v")!!.balance)
        assertEquals(setOf("v"), s.chore("c")!!.kids)
    }
}
