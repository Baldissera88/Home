package com.baldissera.lommepenge

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.animateIntAsState
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

@Composable
fun HomeScreen(store: Store, fx: Feedback, onKid: (String) -> Unit, onParent: () -> Unit) {
    val fam = store.family
    Box(Modifier.fillMaxSize()) {
        Backdrop(NightSky)
        Column(
            Modifier.fillMaxSize().systemBarsPadding().verticalScroll(rememberScrollState()).padding(horizontal = 20.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Spacer(Modifier.height(20.dp))
            Box(contentAlignment = Alignment.Center) {
                PiggyBank(Modifier.size(150.dp, 120.dp))
                Coin(38.dp, Modifier.padding(bottom = 118.dp, end = 6.dp))
            }
            Text(
                "Pligter & Lommepenge", color = Color.White, fontSize = 32.sp, fontWeight = FontWeight.Black,
                textAlign = TextAlign.Center, lineHeight = 36.sp,
            )
            Spacer(Modifier.height(6.dp))
            Text("Hvem er du?", color = Color.White.copy(alpha = 0.8f), fontSize = 20.sp, fontWeight = FontWeight.SemiBold)
            Spacer(Modifier.height(24.dp))
            for (kid in fam.kids) {
                val (done, total) = store.progress(kid.id)
                val waiting = fam.marks.count { it.kid == kid.id && !it.approved } + fam.nights.count { it.kid == kid.id && !it.approved }
                KidCard(kid, done, total, waiting) { fx.tap(); onKid(kid.id) }
                Spacer(Modifier.height(16.dp))
            }
            if (fam.kids.isEmpty()) {
                Text(
                    "Ingen børn endnu.\nTryk på Forældre for at komme i gang.", color = Color.White,
                    textAlign = TextAlign.Center, fontSize = 18.sp,
                )
            }
            Spacer(Modifier.height(20.dp))
            Row(
                Modifier.glass(0.14f, 30.dp).bouncy { fx.tap(); onParent() }.padding(horizontal = 22.dp, vertical = 12.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text("🔒", fontSize = 18.sp)
                Spacer(Modifier.width(8.dp))
                Text("Forældre", color = Color.White, fontSize = 17.sp, fontWeight = FontWeight.Bold)
            }
            Spacer(Modifier.height(16.dp))
            Text(appVersion(LocalContext.current), color = Color.White.copy(alpha = 0.45f), fontSize = 12.sp)
            Spacer(Modifier.height(16.dp))
        }
    }
}

@Composable
private fun KidCard(kid: Kid, done: Int, total: Int, waiting: Int, onClick: () -> Unit) {
    val colors = palette(kid.color)
    Row(
        Modifier.fillMaxWidth()
            .shadow(14.dp, RoundedCornerShape(30.dp), ambientColor = colors[1], spotColor = colors[1])
            .background(Brush.linearGradient(colors), RoundedCornerShape(30.dp))
            .bouncy(onClick = onClick)
            .padding(16.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Avatar(kid, 84.dp)
        Spacer(Modifier.width(14.dp))
        Column(Modifier.weight(1f)) {
            Text(kid.name, color = Color.White, fontSize = 28.sp, fontWeight = FontWeight.Black,
                maxLines = 1, overflow = TextOverflow.Ellipsis)
            Row(verticalAlignment = Alignment.CenterVertically) {
                Coin(22.dp)
                Spacer(Modifier.width(6.dp))
                Text(kr(kid.balance), color = Color.White, fontSize = 20.sp, fontWeight = FontWeight.Bold)
            }
            Spacer(Modifier.height(4.dp))
            Text(
                when {
                    total == 0 -> "Ingen pligter i dag"
                    done == total -> "Alt klaret i dag! 🌟"
                    else -> "$done af $total pligter i dag"
                },
                color = Color.White.copy(alpha = 0.9f), fontSize = 15.sp,
            )
        }
        Box(contentAlignment = Alignment.TopEnd) {
            ProgressRing(done, total, 58.dp, Color.White.copy(alpha = 0.25f), Color.White) {
                Text(if (total > 0 && done == total) "⭐" else "$done/$total", color = Color.White,
                    fontWeight = FontWeight.Black, fontSize = 15.sp)
            }
            if (waiting > 0) {
                Box(
                    Modifier.size(22.dp).background(Gold, CircleShape),
                    contentAlignment = Alignment.Center,
                ) { Text("⏳", fontSize = 11.sp) }
            }
        }
    }
}

@Composable
fun Avatar(kid: Kid, size: Dp, modifier: Modifier = Modifier) {
    Box(
        modifier.size(size).background(Color.White.copy(alpha = 0.28f), CircleShape)
            .border(3.dp, Color.White.copy(alpha = 0.6f), CircleShape),
        contentAlignment = Alignment.Center,
    ) { Text(kid.avatar, fontSize = (size.value * 0.55f).sp) }
}

private val Cheers = listOf("Godt klaret", "Super flot", "Sejt", "Wauv", "Fantastisk", "Du er en stjerne")

@Composable
fun KidScreen(store: Store, kidId: String, fx: Feedback, onBack: () -> Unit) {
    val kid = store.kid(kidId)
    if (kid == null) {
        LaunchedEffect(Unit) { onBack() }
        return
    }
    val colors = palette(kid.color)
    var party by remember { mutableIntStateOf(0) }
    val daily = store.choresFor(kid.id, Repeat.DAILY)
    val weekly = store.choresFor(kid.id, Repeat.WEEKLY)
    val extra = store.choresFor(kid.id, Repeat.ONCE)
    val (done, total) = store.progress(kid.id)

    fun tick(c: Chore) {
        if (store.status(c, kid.id) != Status.TODO) return
        store.tick(c, kid.id)
        party++
        val (d, t) = store.progress(kid.id)
        if (c.repeat == Repeat.DAILY && d == t) {
            fx.fanfare()
            fx.say("Hurra ${kid.name}! Du har klaret alle dine pligter i dag!")
        } else {
            fx.coin()
            fx.say("${Cheers.random()}, ${kid.name}!")
        }
    }

    Box(Modifier.fillMaxSize()) {
        Backdrop(listOf(colors[0], colors[1], colors[1].darker(0.35f)), stars = false)
        LazyColumn(
            Modifier.fillMaxSize().systemBarsPadding(),
            contentPadding = androidx.compose.foundation.layout.PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            item {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Box(
                        Modifier.size(48.dp).glass(0.25f, 24.dp).bouncy { fx.tap(); onBack() },
                        contentAlignment = Alignment.Center,
                    ) { Text("←", color = Color.White, fontSize = 24.sp, fontWeight = FontWeight.Black) }
                    Spacer(Modifier.width(12.dp))
                    Text("Hej ${kid.name}!", color = Color.White, fontSize = 28.sp, fontWeight = FontWeight.Black,
                        modifier = Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Avatar(kid, 52.dp)
                }
            }
            item { BankCard(kid, party) }
            if (kid.sleep) item { SleepCard(store, kid, fx) { party++ } }
            if (kid.goalAmount > 0) item { GoalCard(kid, colors) }
            item {
                SectionTitle("I dag", if (total > 0) "$done af $total" else null)
            }
            if (daily.isEmpty()) item { EmptyNote("Ingen daglige pligter – nyd dagen! ☀️") }
            if (total > 0 && done == total) item { AllDone(daily.any { store.status(it, kid.id) == Status.PENDING }) }
            items(daily, key = { "d" + it.id }) { c -> ChoreCard(c, store.status(c, kid.id)) { tick(c) } }
            if (weekly.isNotEmpty()) {
                item { SectionTitle("Denne uge", null) }
                items(weekly, key = { "w" + it.id }) { c -> ChoreCard(c, store.status(c, kid.id)) { tick(c) } }
            }
            if (extra.isNotEmpty()) {
                item { SectionTitle("Ekstra opgaver", "tjen lidt ekstra") }
                items(extra, key = { "x" + it.id }) { c -> ChoreCard(c, store.status(c, kid.id)) { tick(c) } }
            }
            val history = store.history(kid.id).take(8)
            if (history.isNotEmpty()) {
                item { SectionTitle("Sparegrisens dagbog", null) }
                item { HistoryCard(history) }
            }
            item { Spacer(Modifier.height(24.dp)) }
        }
        ConfettiLayer(party)
    }
}

@Composable
private fun BankCard(kid: Kid, wiggle: Int) {
    val shown by animateIntAsState(kid.balance, tween(1100), label = "balance")
    Row(
        Modifier.fillMaxWidth().glass(0.2f, 30.dp).padding(16.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        PiggyBank(Modifier.size(130.dp, 110.dp), wiggle)
        Spacer(Modifier.width(10.dp))
        Column {
            Text("I sparegrisen", color = Color.White.copy(alpha = 0.85f), fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
            Text(kr(shown), color = Color.White, fontSize = if (shown % 100 == 0) 40.sp else 32.sp, fontWeight = FontWeight.Black,
                lineHeight = 44.sp, maxLines = 1, softWrap = false)
            if (kid.weekly > 0) {
                Text("+${kr(kid.weekly)} hver mandag", color = Color.White.copy(alpha = 0.85f), fontSize = 13.sp)
            }
        }
    }
}

@Composable
private fun GoalCard(kid: Kid, colors: List<Color>) {
    val frac = (kid.balance.toFloat() / kid.goalAmount).coerceIn(0f, 1f)
    val anim by animateFloatAsState(frac, tween(1200), label = "goal")
    val left = kid.goalAmount - kid.balance
    Column(Modifier.fillMaxWidth().background(Color.White, RoundedCornerShape(26.dp)).padding(16.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(kid.goalEmoji, fontSize = 34.sp)
            Spacer(Modifier.width(10.dp))
            Column(Modifier.weight(1f)) {
                Text("Jeg sparer op til", color = Ink.copy(alpha = 0.6f), fontSize = 13.sp)
                Text(kid.goalName.ifBlank { "noget godt" }, color = Ink, fontSize = 20.sp, fontWeight = FontWeight.Black,
                    maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            Text("${(frac * 100).toInt()}%", color = colors[1], fontSize = 22.sp, fontWeight = FontWeight.Black)
        }
        Spacer(Modifier.height(12.dp))
        Box(Modifier.fillMaxWidth().height(22.dp).clip(RoundedCornerShape(11.dp)).background(Color(0xFFEDE8F5))) {
            Box(
                Modifier.fillMaxHeight().fillMaxWidth(anim.coerceAtLeast(0.04f))
                    .background(Brush.horizontalGradient(listOf(Gold, Color(0xFFFF8C1A))), RoundedCornerShape(11.dp))
            )
        }
        Spacer(Modifier.height(8.dp))
        Text(
            if (left <= 0) "Du har sparet nok! 🎉 Spørg mor eller far."
            else "${kr(kid.balance.coerceAtLeast(0))} af ${kr(kid.goalAmount)} · ${kr(left)} tilbage",
            color = Ink.copy(alpha = 0.7f), fontSize = 14.sp, fontWeight = FontWeight.SemiBold,
        )
    }
}

@Composable
private fun SectionTitle(text: String, aside: String?) {
    Row(Modifier.fillMaxWidth().padding(top = 8.dp, start = 4.dp, end = 4.dp), verticalAlignment = Alignment.Bottom) {
        Text(text, color = Color.White, fontSize = 22.sp, fontWeight = FontWeight.Black, modifier = Modifier.weight(1f))
        if (aside != null) Text(aside, color = Color.White.copy(alpha = 0.85f), fontSize = 15.sp, fontWeight = FontWeight.Bold)
    }
}

@Composable
private fun EmptyNote(text: String) {
    Text(text, color = Color.White, fontSize = 16.sp, modifier = Modifier.fillMaxWidth().glass(0.15f, 20.dp).padding(16.dp))
}

@Composable
private fun AllDone(waiting: Boolean) {
    Row(
        Modifier.fillMaxWidth()
            .background(Brush.horizontalGradient(listOf(Color(0xFFFFE57F), Gold)), RoundedCornerShape(24.dp))
            .padding(16.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text("🏆", fontSize = 40.sp)
        Spacer(Modifier.width(12.dp))
        Column {
            Text("Alle dagens pligter klaret!", color = Ink, fontSize = 18.sp, fontWeight = FontWeight.Black)
            Text(if (waiting) "Mor eller far godkender, så kommer pengene i grisen." else "Pengene er i sparegrisen.",
                color = Ink.copy(alpha = 0.75f), fontSize = 14.sp)
        }
    }
}

@Composable
private fun ChoreCard(c: Chore, status: Status, onTick: () -> Unit) {
    val bg by animateColorAsState(
        when (status) {
            Status.TODO -> Color.White
            Status.PENDING -> Color(0xFFFFF6D6)
            Status.DONE -> Color(0xFFE3F9EC)
        }, label = "chore",
    )
    Row(
        Modifier.fillMaxWidth()
            .shadow(6.dp, RoundedCornerShape(24.dp))
            .background(bg, RoundedCornerShape(24.dp))
            .bouncy(enabled = status == Status.TODO, onClick = onTick)
            .padding(14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            Modifier.size(58.dp).background(Color(0xFFF1ECFA), RoundedCornerShape(18.dp)),
            contentAlignment = Alignment.Center,
        ) { Text(c.emoji, fontSize = 32.sp) }
        Spacer(Modifier.width(14.dp))
        Column(Modifier.weight(1f)) {
            Text(c.title, color = Ink, fontSize = 19.sp, fontWeight = FontWeight.Bold, maxLines = 2,
                overflow = TextOverflow.Ellipsis)
            Spacer(Modifier.height(4.dp))
            when (status) {
                Status.TODO -> Row(
                    Modifier.background(Color(0xFFFFF1C2), RoundedCornerShape(12.dp)).padding(horizontal = 8.dp, vertical = 2.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Coin(16.dp)
                    Spacer(Modifier.width(4.dp))
                    Text("+${kr(c.reward)}", color = Color(0xFF9A6200), fontSize = 14.sp, fontWeight = FontWeight.Black)
                }
                Status.PENDING -> Text("⏳ Venter på godkendelse", color = Color(0xFF9A6200), fontSize = 14.sp,
                    fontWeight = FontWeight.Bold)
                Status.DONE -> Text("✓ ${kr(c.reward)} i grisen", color = Color(0xFF1E8C4E), fontSize = 14.sp,
                    fontWeight = FontWeight.Bold)
            }
        }
        Spacer(Modifier.width(10.dp))
        CheckBubble(status)
    }
}

@Composable
private fun CheckBubble(status: Status) {
    val scale by animateFloatAsState(if (status == Status.TODO) 1f else 1.12f, spring(dampingRatio = 0.35f), label = "check")
    val mod = Modifier.size(52.dp).graphicsLayer { scaleX = scale; scaleY = scale }
    when (status) {
        Status.TODO -> Box(mod.border(4.dp, Color(0xFFD9D1EA), CircleShape))
        Status.PENDING -> Box(mod.background(Gold, CircleShape), contentAlignment = Alignment.Center) {
            Text("⏳", fontSize = 24.sp)
        }
        Status.DONE -> Box(mod.background(Color(0xFF2ECC71), CircleShape), contentAlignment = Alignment.Center) {
            Text("✓", color = Color.White, fontSize = 28.sp, fontWeight = FontWeight.Black)
        }
    }
}

@Composable
private fun HistoryCard(list: List<Txn>) {
    Column(Modifier.fillMaxWidth().background(Color.White, RoundedCornerShape(24.dp)).padding(vertical = 6.dp)) {
        list.forEachIndexed { i, t ->
            Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(t.emoji, fontSize = 22.sp)
                Spacer(Modifier.width(12.dp))
                Column(Modifier.weight(1f)) {
                    Text(t.text, color = Ink, fontSize = 16.sp, fontWeight = FontWeight.SemiBold, maxLines = 1,
                        overflow = TextOverflow.Ellipsis)
                    Text(dayLabel(t.time), color = Ink.copy(alpha = 0.5f), fontSize = 12.sp)
                }
                Text(
                    (if (t.amount > 0) "+" else "") + kr(t.amount),
                    color = if (t.amount > 0) Color(0xFF1E8C4E) else Color(0xFFD64545),
                    fontSize = 16.sp, fontWeight = FontWeight.Black,
                )
            }
            if (i < list.lastIndex) Box(Modifier.fillMaxWidth().padding(horizontal = 16.dp).height(1.dp).background(Color(0xFFF0ECF6)))
        }
    }
}

fun dayLabel(time: Long): String {
    val d = java.time.Instant.ofEpochMilli(time).atZone(java.time.ZoneId.systemDefault()).toLocalDate()
    val today = java.time.LocalDate.now()
    return when (d) {
        today -> "I dag"
        today.minusDays(1) -> "I går"
        else -> "${d.dayOfMonth}/${d.monthValue}"
    }
}

fun Color.darker(f: Float) = Color(red * (1 - f), green * (1 - f), blue * (1 - f), alpha)
