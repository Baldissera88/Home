package com.baldissera.lommepenge

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.time.LocalDate

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class StoreTest {
    private var day = LocalDate.of(2026, 10, 28) // a Wednesday
    private val prefs = ApplicationProvider.getApplicationContext<Context>()
        .getSharedPreferences("store${System.nanoTime()}", Context.MODE_PRIVATE)

    private fun store() = Store(prefs, today = { day })

    @Test
    fun approvedChorePaysOnce() {
        val s = store()
        val c = s.choresFor("victor", Repeat.DAILY).first()
        s.tick(c, "victor")
        s.tick(c, "victor")
        assertEquals(Status.PENDING, s.status(c, "victor"))
        assertEquals(0, s.kid("victor")!!.balance)
        s.approveAll()
        assertEquals(Status.DONE, s.status(c, "victor"))
        assertEquals(c.reward, s.kid("victor")!!.balance)
        day = day.plusDays(1)
        assertEquals(Status.TODO, s.status(c, "victor"))
    }

    @Test
    fun rejectLetsTheKidTryAgain() {
        val s = store()
        val c = s.choresFor("filucca", Repeat.WEEKLY).first()
        s.tick(c, "filucca")
        s.reject(s.pending().single())
        assertEquals(Status.TODO, s.status(c, "filucca"))
        assertEquals(0, s.kid("filucca")!!.balance)
    }

    @Test
    fun withoutApprovalMoneyArrivesAtOnce() {
        val s = store()
        s.setApproval(false)
        val c = s.choresFor("victor", Repeat.DAILY).first()
        s.tick(c, "victor")
        assertEquals(Status.DONE, s.status(c, "victor"))
        assertEquals(c.reward, s.kid("victor")!!.balance)
    }

    @Test
    fun weeklyAllowanceIsPaidEachMonday() {
        val s = store()
        s.payAllowances()
        assertEquals(0, s.kid("victor")!!.balance)
        day = LocalDate.of(2026, 11, 2) // next Monday
        s.payAllowances()
        s.payAllowances()
        assertEquals(2000, s.kid("victor")!!.balance)
        day = LocalDate.of(2026, 11, 18) // two more Mondays
        s.payAllowances()
        assertEquals(6000, s.kid("victor")!!.balance)
    }

    @Test
    fun dataSurvivesARestart() {
        val s = store()
        s.credit("victor", 1250, "Bonus", "🎁")
        s.saveChore(Chore("x", "Vask bil", "🚗", 2500, Repeat.ONCE, setOf("victor")))
        val again = store()
        assertEquals(1250, again.kid("victor")!!.balance)
        assertEquals("Vask bil", again.chore("x")!!.title)
        assertEquals("Bonus", again.history("victor").first().text)
    }

    @Test
    fun oneOffJobsDisappearOnceDone() {
        val s = store()
        s.setApproval(false)
        val job = Chore("x", "Vask bil", "🚗", 2500, Repeat.ONCE, setOf("victor"))
        s.saveChore(job)
        s.tick(job, "victor")
        assertEquals(emptyList<Chore>(), s.choresFor("victor", Repeat.ONCE))
    }

    @Test
    fun moneyFormatting() {
        assertEquals("12 kr", kr(1200))
        assertEquals("2,50 kr", kr(250))
        assertEquals("-0,50 kr", kr(-50))
        assertEquals(250, parseKr("2,5"))
        assertEquals(1000, parseKr("10 kr"))
        assertNull(parseKr("abc"))
    }
}
