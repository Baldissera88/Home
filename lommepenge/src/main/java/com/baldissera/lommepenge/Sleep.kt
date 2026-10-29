package com.baldissera.lommepenge

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import java.time.LocalDate
import java.time.YearMonth
import java.time.format.TextStyle
import java.util.Locale

private val NightSkyCard = listOf(Color(0xFF151A45), Color(0xFF332A78))

fun monthName(m: YearMonth): String =
    m.month.getDisplayName(TextStyle.FULL_STANDALONE, Locale("da")).replaceFirstChar { it.uppercase() }

/** The month as a grid of nights: a star for their own bed, a cloud for a night in the big bed. */
@Composable
fun NightCalendar(
    month: YearMonth, nights: Map<String, Night>, today: LocalDate, dark: Boolean,
    onDay: ((LocalDate) -> Unit)? = null,
) {
    val fg = if (dark) Color.White else Ink
    Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Row {
            for (d in listOf("M", "T", "O", "T", "F", "L", "S")) {
                Text(d, Modifier.weight(1f), color = fg.copy(alpha = 0.5f), fontSize = 12.sp, fontWeight = FontWeight.Bold,
                    textAlign = TextAlign.Center)
            }
        }
        val lead = month.atDay(1).dayOfWeek.value - 1
        val cells = List<LocalDate?>(lead) { null } + (1..month.lengthOfMonth()).map { month.atDay(it) }
        for (week in cells.chunked(7)) {
            Row {
                for (i in 0 until 7) {
                    val d = week.getOrNull(i)
                    Box(Modifier.weight(1f).aspectRatio(1f).padding(2.dp), contentAlignment = Alignment.Center) {
                        if (d != null) DayCell(d, nights[d.toString()], today, fg, onDay)
                    }
                }
            }
        }
    }
}

@Composable
private fun DayCell(d: LocalDate, n: Night?, today: LocalDate, fg: Color, onDay: ((LocalDate) -> Unit)?) {
    val future = d.isAfter(today)
    val base = Modifier.fillMaxSize().clip(CircleShape)
    val mod = if (onDay != null && !future) base.bouncy { onDay(d) } else base
    when {
        n != null && n.ok && n.approved -> Box(
            mod.background(Brush.radialGradient(listOf(Color(0x8CFFD640), Color(0x38FFC107), Color(0x14FFC107)))),
            contentAlignment = Alignment.Center,
        ) { Text("⭐", fontSize = 18.sp) }
        n != null && n.ok -> Box(mod.background(Gold.copy(alpha = 0.35f)), contentAlignment = Alignment.Center) {
            Text("⏳", fontSize = 13.sp)
        }
        n != null -> Box(mod.background(fg.copy(alpha = 0.1f)), contentAlignment = Alignment.Center) {
            Text("☁️", fontSize = 14.sp)
        }
        else -> Box(
            mod.border(if (d == today) 2.dp else 1.dp, if (d == today) Gold else fg.copy(alpha = if (future) 0.08f else 0.25f), CircleShape),
            contentAlignment = Alignment.Center,
        ) {
            Text("${d.dayOfMonth}", color = fg.copy(alpha = if (future) 0.3f else 0.7f), fontSize = 12.sp, fontWeight = FontWeight.Bold)
        }
    }
}

/** The kid's own-bed month: stars so far, how close the bonus is, and the morning button. */
@Composable
fun SleepCard(store: Store, kid: Kid, fx: Feedback, onParty: () -> Unit) {
    val today = store.todayDate()
    val month = YearMonth.from(today)
    val rules = store.family.sleep
    val good = store.goodNights(kid.id, month)
    val streak = store.streak(kid.id)
    val tonight = store.night(kid.id, today)
    val frac by animateFloatAsState(if (rules.goal > 0) (good.toFloat() / rules.goal).coerceIn(0f, 1f) else 0f, tween(1000), label = "sleep")
    Column(
        Modifier.fillMaxWidth().background(Brush.verticalGradient(NightSkyCard), RoundedCornerShape(26.dp)).padding(16.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("🌙", fontSize = 30.sp)
            Spacer(Modifier.width(10.dp))
            Column(Modifier.weight(1f)) {
                Text("Min egen seng", color = Color.White, fontSize = 20.sp, fontWeight = FontWeight.Black)
                Text(
                    monthName(month) + if (streak > 1) " · $streak nætter i træk 🔥" else "",
                    color = Color.White.copy(alpha = 0.75f), fontSize = 13.sp,
                )
            }
            Text("$good/${rules.goal}", color = Gold, fontSize = 22.sp, fontWeight = FontWeight.Black)
        }
        Spacer(Modifier.height(10.dp))
        Box(Modifier.fillMaxWidth().height(14.dp).clip(RoundedCornerShape(7.dp)).background(Color.White.copy(alpha = 0.15f))) {
            Box(Modifier.fillMaxHeight().fillMaxWidth(frac.coerceAtLeast(0.03f))
                .background(Brush.horizontalGradient(listOf(Gold, Color(0xFFFF8C1A))), RoundedCornerShape(7.dp)))
        }
        Spacer(Modifier.height(6.dp))
        Text(
            when {
                good >= rules.goal -> "🏆 Månedens bonus på ${kr(rules.bonus)} er i grisen!"
                else -> "${rules.goal - good} ${if (rules.goal - good == 1) "nat" else "nætter"} mere giver ${kr(rules.bonus)} i bonus" +
                    if (rules.nightly > 0) " · +${kr(rules.nightly)} pr. nat" else ""
            },
            color = Color.White.copy(alpha = 0.85f), fontSize = 13.sp, fontWeight = FontWeight.SemiBold,
        )
        Spacer(Modifier.height(10.dp))
        NightCalendar(month, store.nightsIn(kid.id, month).associateBy { it.date }, today, dark = true)
        Spacer(Modifier.height(10.dp))
        when {
            tonight == null -> Box(
                Modifier.fillMaxWidth()
                    .background(Brush.horizontalGradient(listOf(Color(0xFFFFE57F), Gold)), RoundedCornerShape(20.dp))
                    .bouncy {
                        store.sleptInOwnBed(kid.id)
                        onParty()
                        val now = store.goodNights(kid.id, month)
                        if (good < rules.goal && now >= rules.goal) {
                            fx.fanfare()
                            fx.say("Hurra ${kid.name}! Du har sovet i din egen seng ${now} nætter og får månedens bonus!")
                        } else {
                            fx.coin()
                            fx.say("Hvor er du sej, ${kid.name}! Du sov i din egen seng.")
                        }
                    }
                    .padding(16.dp),
                contentAlignment = Alignment.Center,
            ) { Text("Jeg sov i min egen seng i nat! 🌟", color = Ink, fontSize = 17.sp, fontWeight = FontWeight.Black) }
            !tonight.approved -> SleepNote("⏳ Mor eller far skal lige se det")
            tonight.ok -> SleepNote("⭐ Flot! Du sov i din egen seng i nat")
            else -> SleepNote("☁️ I nat gik det ikke – i aften prøver vi igen!")
        }
    }
}

@Composable
private fun SleepNote(text: String) {
    Text(text, color = Color.White, fontSize = 15.sp, fontWeight = FontWeight.Bold, textAlign = TextAlign.Center,
        modifier = Modifier.fillMaxWidth().background(Color.White.copy(alpha = 0.12f), RoundedCornerShape(20.dp)).padding(14.dp))
}
