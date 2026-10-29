package com.baldissera.lommepenge

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import kotlinx.coroutines.launch
import kotlin.math.sin

private val Purple = Color(0xFF6A3FD0)
private val Green = Color(0xFF22B566)
private val Red = Color(0xFFE04F5F)
private val Paper = Color(0xFFF5F2FB)

val ChoreEmojis = listOf(
    "🛏️", "🦷", "🍽️", "🧸", "🗑️", "🧹", "🧺", "👕", "🐶", "🐱", "🌱", "📚",
    "🎒", "🚿", "🧽", "🥕", "🍳", "🚲", "🎹", "⚽", "🚗", "🪴", "🧦", "⭐",
)
val AvatarEmojis = listOf("🦁", "🦄", "🐯", "🐼", "🐸", "🦊", "🐵", "🐰", "🐻", "🐨", "🐙", "🦖", "🐲", "🦋", "🐬", "🚀", "👑", "🌈")
val GoalEmojis = listOf("🎁", "🧱", "🎮", "🚲", "⚽", "🧸", "📱", "🎨", "🎧", "🛹", "🎢", "🍦")

@Composable
fun PinScreen(store: Store, fx: Feedback, onOk: () -> Unit, onBack: () -> Unit) {
    var entered by remember { mutableStateOf("") }
    var wrong by remember { mutableStateOf(false) }
    val shake = remember { Animatable(0f) }
    val scope = rememberCoroutineScope()

    fun press(d: String) {
        fx.tap()
        wrong = false
        if (entered.length >= 4) return
        entered += d
        if (entered.length == 4) {
            if (entered == store.family.pin) onOk()
            else scope.launch {
                wrong = true
                shake.snapTo(1f)
                shake.animateTo(0f, tween(450))
                entered = ""
            }
        }
    }

    Box(Modifier.fillMaxSize()) {
        Backdrop(NightSky)
        Column(
            Modifier.fillMaxSize().systemBarsPadding().padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Row(Modifier.fillMaxWidth()) {
                Box(
                    Modifier.size(48.dp).glass(0.2f, 24.dp).bouncy { fx.tap(); onBack() },
                    contentAlignment = Alignment.Center,
                ) { Text("←", color = Color.White, fontSize = 24.sp, fontWeight = FontWeight.Black) }
            }
            Spacer(Modifier.height(24.dp))
            Text("🔒", fontSize = 48.sp)
            Text("Kun for forældre", color = Color.White, fontSize = 28.sp, fontWeight = FontWeight.Black)
            Spacer(Modifier.height(6.dp))
            Text(if (wrong) "Forkert kode – prøv igen" else "Indtast koden",
                color = if (wrong) Color(0xFFFFB4BC) else Color.White.copy(alpha = 0.8f), fontSize = 17.sp)
            Spacer(Modifier.height(24.dp))
            Row(
                Modifier.offset(x = (sin(shake.value * 18f) * 14f * shake.value).dp),
                horizontalArrangement = Arrangement.spacedBy(18.dp),
            ) {
                repeat(4) { i ->
                    Box(
                        Modifier.size(22.dp)
                            .background(if (i < entered.length) (if (wrong) Color(0xFFFFB4BC) else Color.White) else Color.Transparent, CircleShape)
                            .border(2.5.dp, Color.White.copy(alpha = 0.8f), CircleShape)
                    )
                }
            }
            Spacer(Modifier.weight(1f))
            val keys = listOf(listOf("1", "2", "3"), listOf("4", "5", "6"), listOf("7", "8", "9"), listOf("", "0", "⌫"))
            for (row in keys) {
                Row(horizontalArrangement = Arrangement.spacedBy(22.dp)) {
                    for (k in row) {
                        if (k.isEmpty()) {
                            Spacer(Modifier.size(78.dp))
                        } else {
                            Box(
                                Modifier.size(78.dp).glass(0.16f, 39.dp).bouncy {
                                    if (k == "⌫") { fx.tap(); entered = entered.dropLast(1) } else press(k)
                                },
                                contentAlignment = Alignment.Center,
                            ) { Text(k, color = Color.White, fontSize = 30.sp, fontWeight = FontWeight.Bold) }
                        }
                    }
                }
                Spacer(Modifier.height(16.dp))
            }
            if (!store.family.pinChanged) {
                Text("Standardkoden er 1234. Skift den under Indstillinger.",
                    color = Color.White.copy(alpha = 0.6f), fontSize = 13.sp, textAlign = TextAlign.Center)
            }
            Spacer(Modifier.height(12.dp))
        }
    }
}

@Composable
fun ParentScreen(store: Store, fx: Feedback, onClose: () -> Unit, startTab: Int = -1) {
    val pending = store.pending()
    var tab by rememberSaveable { mutableIntStateOf(if (startTab >= 0) startTab else if (pending.isNotEmpty()) 0 else 1) }
    var editChore by remember { mutableStateOf<Chore?>(null) }
    var editKid by remember { mutableStateOf<Kid?>(null) }
    var money by remember { mutableStateOf<Pair<Kid, Boolean>?>(null) }

    Column(Modifier.fillMaxSize().background(Paper)) {
        Column(
            Modifier.fillMaxWidth().background(Brush.verticalGradient(NightSky))
                .statusBarsPadding().padding(start = 20.dp, end = 20.dp, top = 12.dp, bottom = 14.dp)
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("Forældre", color = Color.White, fontSize = 28.sp, fontWeight = FontWeight.Black, modifier = Modifier.weight(1f))
                Text("Luk ✕", color = Color.White, fontSize = 16.sp, fontWeight = FontWeight.Bold,
                    modifier = Modifier.glass(0.18f, 20.dp).bouncy { fx.tap(); onClose() }.padding(horizontal = 14.dp, vertical = 8.dp))
            }
            Spacer(Modifier.height(14.dp))
            Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                val names = listOf(
                    if (pending.isEmpty()) "Godkend" else "Godkend (${pending.size})", "Pligter", "Børn", "Indstillinger",
                )
                names.forEachIndexed { i, n ->
                    Text(
                        n, color = if (tab == i) Purple else Color.White, fontSize = 15.sp, fontWeight = FontWeight.Bold,
                        modifier = Modifier
                            .background(if (tab == i) Color.White else Color.White.copy(alpha = 0.15f), RoundedCornerShape(20.dp))
                            .bouncy { fx.tap(); tab = i }
                            .padding(horizontal = 16.dp, vertical = 9.dp),
                    )
                }
            }
        }
        LazyColumn(
            Modifier.fillMaxSize().navigationBarsPadding(),
            contentPadding = PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            when (tab) {
                0 -> approveTab(store, fx, pending)
                1 -> choresTab(store, fx) { editChore = it }
                2 -> kidsTab(store, fx, onEdit = { editKid = it }, onMoney = { k, plus -> money = k to plus })
                else -> item { SettingsTab(store, fx) }
            }
            item { Spacer(Modifier.height(30.dp)) }
        }
    }

    editChore?.let { c -> ChoreEditor(store, c) { editChore = null } }
    editKid?.let { k -> KidEditor(store, k) { editKid = null } }
    money?.let { (k, plus) -> MoneyDialog(store, fx, k, plus) { money = null } }
}

private fun androidx.compose.foundation.lazy.LazyListScope.approveTab(store: Store, fx: Feedback, pending: List<Mark>) {
    if (pending.isEmpty()) {
        item { Note("🎉", "Intet at godkende lige nu", "Når børnene krydser en pligt af, dukker den op her.") }
        return
    }
    item {
        WideButton("✓  Godkend alle (${pending.size})", Green) { fx.coin(); store.approveAll() }
    }
    items(pending, key = { "${it.chore}-${it.kid}-${it.period}" }) { m ->
        val kid = store.kid(m.kid) ?: return@items
        val c = store.chore(m.chore) ?: return@items
        Column(Modifier.fillMaxWidth().card().padding(14.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(46.dp).background(Brush.linearGradient(palette(kid.color)), CircleShape),
                    contentAlignment = Alignment.Center) { Text(kid.avatar, fontSize = 24.sp) }
                Spacer(Modifier.width(12.dp))
                Column(Modifier.weight(1f)) {
                    Text("${kid.name} · ${dayLabel(m.time)}", color = Ink.copy(alpha = 0.6f), fontSize = 13.sp)
                    Text("${c.emoji} ${c.title}", color = Ink, fontSize = 18.sp, fontWeight = FontWeight.Bold,
                        maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
                Text("+${kr(c.reward)}", color = Color(0xFF9A6200), fontSize = 16.sp, fontWeight = FontWeight.Black)
            }
            Spacer(Modifier.height(12.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                SmallButton("✓ Godkend", Green, Modifier.weight(1f)) { fx.coin(); store.approve(m) }
                SmallButton("✕ Ikke klaret", Red, Modifier.weight(1f), outline = true) { fx.tap(); store.reject(m) }
            }
        }
    }
}

private fun androidx.compose.foundation.lazy.LazyListScope.choresTab(store: Store, fx: Feedback, onEdit: (Chore) -> Unit) {
    item {
        WideButton("＋  Ny pligt", Purple) {
            fx.tap()
            onEdit(Chore("", "", "⭐", 500, Repeat.DAILY, store.family.kids.map { it.id }.toSet()))
        }
    }
    for (r in Repeat.entries) {
        val list = store.family.chores.filter { it.repeat == r }
        if (list.isEmpty()) continue
        item { GroupTitle(r.label) }
        items(list, key = { it.id }) { c ->
            Row(Modifier.fillMaxWidth().card().bouncy { fx.tap(); onEdit(c) }.padding(14.dp),
                verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(50.dp).background(Paper, RoundedCornerShape(16.dp)), contentAlignment = Alignment.Center) {
                    Text(c.emoji, fontSize = 28.sp)
                }
                Spacer(Modifier.width(12.dp))
                Column(Modifier.weight(1f)) {
                    Text(c.title, color = Ink, fontSize = 17.sp, fontWeight = FontWeight.Bold, maxLines = 1,
                        overflow = TextOverflow.Ellipsis)
                    val who = store.family.kids.filter { it.id in c.kids }
                    Text(if (who.isEmpty()) "Ingen børn valgt" else who.joinToString("  ") { it.avatar + " " + it.name },
                        color = Ink.copy(alpha = 0.55f), fontSize = 13.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
                Text(kr(c.reward), color = Color(0xFF9A6200), fontSize = 16.sp, fontWeight = FontWeight.Black)
                Spacer(Modifier.width(6.dp))
                Text("›", color = Ink.copy(alpha = 0.35f), fontSize = 26.sp)
            }
        }
    }
}

private fun androidx.compose.foundation.lazy.LazyListScope.kidsTab(
    store: Store, fx: Feedback, onEdit: (Kid) -> Unit, onMoney: (Kid, Boolean) -> Unit,
) {
    items(store.family.kids, key = { it.id }) { kid ->
        Column(Modifier.fillMaxWidth().card()) {
            Row(
                Modifier.fillMaxWidth()
                    .background(Brush.linearGradient(palette(kid.color)), RoundedCornerShape(topStart = 22.dp, topEnd = 22.dp))
                    .padding(14.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Avatar(kid, 56.dp)
                Spacer(Modifier.width(12.dp))
                Column(Modifier.weight(1f)) {
                    Text(kid.name, color = Color.White, fontSize = 22.sp, fontWeight = FontWeight.Black)
                    Text("Ugepenge: ${kr(kid.weekly)}", color = Color.White.copy(alpha = 0.9f), fontSize = 13.sp)
                }
                Text(kr(kid.balance), color = Color.White, fontSize = 24.sp, fontWeight = FontWeight.Black)
            }
            Row(Modifier.padding(12.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                SmallButton("＋ Bonus", Green, Modifier.weight(1f)) { fx.tap(); onMoney(kid, true) }
                SmallButton("− Udbetal", Red, Modifier.weight(1f)) { fx.tap(); onMoney(kid, false) }
                SmallButton("Ret", Purple, Modifier.weight(0.7f), outline = true) { fx.tap(); onEdit(kid) }
            }
            val last = store.history(kid.id).take(3)
            for (t in last) {
                Row(Modifier.padding(horizontal = 16.dp, vertical = 4.dp)) {
                    Text("${t.emoji} ${t.text}", color = Ink.copy(alpha = 0.7f), fontSize = 13.sp, modifier = Modifier.weight(1f),
                        maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Text((if (t.amount > 0) "+" else "") + kr(t.amount), color = if (t.amount > 0) Green else Red,
                        fontSize = 13.sp, fontWeight = FontWeight.Bold)
                }
            }
            if (last.isNotEmpty()) Spacer(Modifier.height(10.dp))
        }
    }
    item {
        WideButton("＋  Tilføj barn", Purple) {
            fx.tap()
            val used = store.family.kids.map { it.color }.toSet()
            onEdit(Kid("", "", AvatarEmojis.firstOrNull { a -> store.family.kids.none { it.avatar == a } } ?: "🙂",
                Palettes.indices.firstOrNull { it !in used } ?: 0, weekly = 2000))
        }
    }
}

@Composable
private fun SettingsTab(store: Store, fx: Feedback) {
    var newPin by remember { mutableStateOf("") }
    var saved by remember { mutableStateOf(false) }
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Row(Modifier.fillMaxWidth().card().padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text("Forældre godkender pligter", color = Ink, fontSize = 17.sp, fontWeight = FontWeight.Bold)
                Text(
                    if (store.family.approval) "Pengene kommer først i grisen, når I har godkendt."
                    else "Pengene kommer i grisen, så snart barnet krydser af.",
                    color = Ink.copy(alpha = 0.6f), fontSize = 13.sp,
                )
            }
            Spacer(Modifier.width(8.dp))
            Switch(store.family.approval, onCheckedChange = { fx.tap(); store.setApproval(it) })
        }
        Column(Modifier.fillMaxWidth().card().padding(16.dp)) {
            Text("Skift forældrekode", color = Ink, fontSize = 17.sp, fontWeight = FontWeight.Bold)
            Spacer(Modifier.height(8.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                OutlinedTextField(
                    newPin, { v -> newPin = v.filter { it.isDigit() }.take(4); saved = false },
                    label = { Text("Ny kode (4 cifre)") }, singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword),
                    modifier = Modifier.weight(1f),
                )
                Spacer(Modifier.width(10.dp))
                SmallButton("Gem", Purple, enabled = newPin.length == 4) {
                    fx.coin(); store.setPin(newPin); newPin = ""; saved = true
                }
            }
            if (saved) Text("✓ Koden er gemt", color = Green, fontSize = 14.sp, fontWeight = FontWeight.Bold,
                modifier = Modifier.padding(top = 6.dp))
        }
        Note("💡", "Sådan virker det",
            "Ugepenge lægges automatisk i grisen hver mandag. Daglige pligter nulstilles hver morgen, ugentlige hver mandag. " +
                "Alt gemmes kun på denne enhed.")
    }
}

@Composable
private fun EditorDialog(title: String, onDismiss: () -> Unit, content: @Composable () -> Unit) {
    Dialog(onDismissRequest = onDismiss, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Column(
            Modifier.fillMaxWidth().padding(14.dp).imePadding()
                .background(Color.White, RoundedCornerShape(28.dp))
                .verticalScroll(rememberScrollState())
                .padding(20.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text(title, color = Ink, fontSize = 24.sp, fontWeight = FontWeight.Black)
            content()
        }
    }
}

@Composable
private fun ChoreEditor(store: Store, start: Chore, onDone: () -> Unit) {
    var title by remember { mutableStateOf(start.title) }
    var emoji by remember { mutableStateOf(start.emoji) }
    var reward by remember { mutableStateOf(krText(start.reward)) }
    var repeat by remember { mutableStateOf(start.repeat) }
    var kids by remember { mutableStateOf(start.kids) }
    var confirmDelete by remember { mutableStateOf(false) }
    val amount = parseKr(reward)
    val ok = title.isNotBlank() && amount != null && amount >= 0

    EditorDialog(if (start.id.isEmpty()) "Ny pligt" else "Ret pligt", onDone) {
        OutlinedTextField(title, { title = it.take(40) }, label = { Text("Hvad skal laves?") }, singleLine = true,
            modifier = Modifier.fillMaxWidth())
        Label("Ikon")
        EmojiGrid(ChoreEmojis, emoji) { emoji = it }
        Label("Belønning")
        OutlinedTextField(reward, { reward = it.take(8) }, label = { Text("Kroner") }, singleLine = true,
            isError = amount == null || amount < 0,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal), modifier = Modifier.fillMaxWidth())
        Choices(listOf("1", "2", "5", "10", "20"), reward) { reward = it }
        Label("Hvor tit?")
        Choices(Repeat.entries.map { it.label }, repeat.label) { l -> repeat = Repeat.entries.first { it.label == l } }
        Label("Hvem?")
        Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            for (k in store.family.kids) {
                Pill("${k.avatar} ${k.name}", k.id in kids) { kids = if (k.id in kids) kids - k.id else kids + k.id }
            }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
            if (start.id.isNotEmpty()) {
                SmallButton(if (confirmDelete) "Sikker?" else "Slet", Red, outline = !confirmDelete) {
                    if (confirmDelete) { store.removeChore(start.id); onDone() } else confirmDelete = true
                }
            }
            Spacer(Modifier.weight(1f))
            SmallButton("Annuller", Ink.copy(alpha = 0.6f), outline = true) { onDone() }
            SmallButton("Gem", Purple, enabled = ok) {
                store.saveChore(Chore(start.id.ifEmpty { newId() }, title.trim(), emoji, amount ?: 0, repeat, kids))
                onDone()
            }
        }
    }
}

@Composable
private fun KidEditor(store: Store, start: Kid, onDone: () -> Unit) {
    var name by remember { mutableStateOf(start.name) }
    var avatar by remember { mutableStateOf(start.avatar) }
    var color by remember { mutableIntStateOf(start.color) }
    var weekly by remember { mutableStateOf(krText(start.weekly)) }
    var goalName by remember { mutableStateOf(start.goalName) }
    var goalEmoji by remember { mutableStateOf(start.goalEmoji) }
    var goal by remember { mutableStateOf(if (start.goalAmount == 0) "" else krText(start.goalAmount)) }
    var confirmDelete by remember { mutableStateOf(false) }
    val weeklyOre = parseKr(weekly)
    val goalOre = parseKr(goal)
    val ok = name.isNotBlank() && weeklyOre != null && weeklyOre >= 0 && goalOre != null && goalOre >= 0

    EditorDialog(if (start.id.isEmpty()) "Nyt barn" else "Ret ${start.name}", onDone) {
        Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
            Box(Modifier.size(84.dp).background(Brush.linearGradient(palette(color)), CircleShape),
                contentAlignment = Alignment.Center) { Text(avatar, fontSize = 44.sp) }
        }
        OutlinedTextField(name, { name = it.take(20) }, label = { Text("Navn") }, singleLine = true, modifier = Modifier.fillMaxWidth())
        Label("Figur")
        EmojiGrid(AvatarEmojis, avatar) { avatar = it }
        Label("Farve")
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Palettes.forEachIndexed { i, p ->
                Box(
                    Modifier.size(40.dp).background(Brush.linearGradient(p), CircleShape)
                        .ring(i == color, 4.dp, Ink, CircleShape)
                        .bouncy { color = i }
                )
            }
        }
        OutlinedTextField(weekly, { weekly = it.take(8) }, label = { Text("Ugepenge (kr hver mandag)") }, singleLine = true,
            isError = weeklyOre == null, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
            modifier = Modifier.fillMaxWidth())
        Label("Sparemål")
        EmojiGrid(GoalEmojis, goalEmoji) { goalEmoji = it }
        OutlinedTextField(goalName, { goalName = it.take(30) }, label = { Text("Hvad sparer ${name.ifBlank { "barnet" }} op til?") },
            singleLine = true, modifier = Modifier.fillMaxWidth())
        OutlinedTextField(goal, { goal = it.take(8) }, label = { Text("Koster (kr) – tom = intet mål") }, singleLine = true,
            isError = goalOre == null, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
            modifier = Modifier.fillMaxWidth())
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
            if (start.id.isNotEmpty()) {
                SmallButton(if (confirmDelete) "Slet alt?" else "Slet", Red, outline = !confirmDelete) {
                    if (confirmDelete) { store.removeKid(start.id); onDone() } else confirmDelete = true
                }
            }
            Spacer(Modifier.weight(1f))
            SmallButton("Annuller", Ink.copy(alpha = 0.6f), outline = true) { onDone() }
            SmallButton("Gem", Purple, enabled = ok) {
                store.saveKid(start.copy(
                    id = start.id.ifEmpty { newId() }, name = name.trim(), avatar = avatar, color = color,
                    weekly = weeklyOre ?: 0, goalName = goalName.trim(), goalEmoji = goalEmoji, goalAmount = goalOre ?: 0,
                ))
                onDone()
            }
        }
    }
}

@Composable
private fun MoneyDialog(store: Store, fx: Feedback, kid: Kid, plus: Boolean, onDone: () -> Unit) {
    var amount by remember { mutableStateOf("") }
    var note by remember { mutableStateOf("") }
    val ore = parseKr(amount)
    val tooMuch = !plus && ore != null && ore > kid.balance
    val ok = ore != null && ore > 0 && !tooMuch

    EditorDialog(if (plus) "Bonus til ${kid.name}" else "Udbetal fra ${kid.name}s gris", onDone) {
        Text(
            if (plus) "Ekstra penge for noget særligt – de lægges direkte i sparegrisen."
            else "Når ${kid.name} bruger penge, trækker I dem ud her. Der er ${kr(kid.balance)} i grisen.",
            color = Ink.copy(alpha = 0.7f), fontSize = 15.sp,
        )
        OutlinedTextField(amount, { amount = it.take(8) }, label = { Text("Beløb i kr") }, singleLine = true,
            isError = ore == null || tooMuch, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
            supportingText = { if (tooMuch) Text("Der er kun ${kr(kid.balance)} i grisen") },
            modifier = Modifier.fillMaxWidth())
        Choices(listOf("5", "10", "20", "50", "100"), amount) { amount = it }
        OutlinedTextField(note, { note = it.take(40) }, label = { Text(if (plus) "Hvorfor? (fx Hjalp mormor)" else "Til hvad? (fx Slik)") },
            singleLine = true, modifier = Modifier.fillMaxWidth())
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Spacer(Modifier.weight(1f))
            SmallButton("Annuller", Ink.copy(alpha = 0.6f), outline = true) { onDone() }
            SmallButton(if (plus) "Giv bonus" else "Udbetal", if (plus) Green else Red, enabled = ok) {
                val v = ore ?: 0
                if (plus) {
                    fx.coin()
                    store.credit(kid.id, v, note.trim().ifEmpty { "Bonus" }, "🎁")
                } else {
                    fx.tap()
                    store.credit(kid.id, -v, note.trim().ifEmpty { "Udbetalt" }, "🛍️")
                }
                onDone()
            }
        }
    }
}

private fun krText(ore: Int): String =
    if (ore % 100 == 0) (ore / 100).toString() else "%d,%02d".format(ore / 100, ore % 100)

@Composable
private fun Label(text: String) {
    Text(text, color = Ink.copy(alpha = 0.7f), fontSize = 14.sp, fontWeight = FontWeight.Bold)
}

@Composable
private fun EmojiGrid(options: List<String>, selected: String, onPick: (String) -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        for (row in options.chunked(6)) {
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                for (e in row) {
                    Box(
                        Modifier.size(44.dp)
                            .background(if (e == selected) Purple.copy(alpha = 0.18f) else Paper, RoundedCornerShape(12.dp))
                            .ring(e == selected, 2.dp, Purple, RoundedCornerShape(12.dp))
                            .bouncy { onPick(e) },
                        contentAlignment = Alignment.Center,
                    ) { Text(e, fontSize = 24.sp) }
                }
            }
        }
    }
}

@Composable
private fun Choices(options: List<String>, selected: String, onPick: (String) -> Unit) {
    Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        for (o in options) Pill(o, o == selected) { onPick(o) }
    }
}

@Composable
private fun Pill(text: String, on: Boolean, onClick: () -> Unit) {
    Text(
        text, color = if (on) Color.White else Ink, fontSize = 15.sp, fontWeight = FontWeight.Bold,
        modifier = Modifier.background(if (on) Purple else Paper, RoundedCornerShape(18.dp))
            .bouncy(onClick = onClick).padding(horizontal = 14.dp, vertical = 8.dp),
    )
}

@Composable
private fun WideButton(text: String, color: Color, onClick: () -> Unit) {
    Box(
        Modifier.fillMaxWidth().background(color, RoundedCornerShape(20.dp)).bouncy(onClick = onClick).padding(16.dp),
        contentAlignment = Alignment.Center,
    ) { Text(text, color = Color.White, fontSize = 17.sp, fontWeight = FontWeight.Black) }
}

@Composable
private fun SmallButton(
    text: String, color: Color, modifier: Modifier = Modifier, outline: Boolean = false, enabled: Boolean = true,
    onClick: () -> Unit,
) {
    val c = if (enabled) color else color.copy(alpha = 0.35f)
    Box(
        modifier
            .background(if (outline) Color.Transparent else c, RoundedCornerShape(16.dp))
            .ring(outline, 2.dp, c, RoundedCornerShape(16.dp))
            .bouncy(enabled = enabled, onClick = onClick)
            .padding(horizontal = 14.dp, vertical = 11.dp),
        contentAlignment = Alignment.Center,
    ) { Text(text, color = if (outline) c else Color.White, fontSize = 15.sp, fontWeight = FontWeight.Bold, maxLines = 1) }
}

@Composable
private fun GroupTitle(text: String) {
    Text(text, color = Ink.copy(alpha = 0.55f), fontSize = 14.sp, fontWeight = FontWeight.Black,
        modifier = Modifier.padding(start = 4.dp, top = 6.dp))
}

@Composable
private fun Note(emoji: String, title: String, body: String) {
    Row(Modifier.fillMaxWidth().card().padding(16.dp)) {
        Text(emoji, fontSize = 30.sp)
        Spacer(Modifier.width(12.dp))
        Column {
            Text(title, color = Ink, fontSize = 17.sp, fontWeight = FontWeight.Bold)
            Text(body, color = Ink.copy(alpha = 0.65f), fontSize = 14.sp)
        }
    }
}

private fun Modifier.card() = background(Color.White, RoundedCornerShape(22.dp))

/** A border only when [on]; a 0.dp border would still draw a hairline. */
private fun Modifier.ring(on: Boolean, width: androidx.compose.ui.unit.Dp, color: Color, shape: androidx.compose.ui.graphics.Shape) =
    if (on) border(width, color, shape) else this
