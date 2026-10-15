package com.baldissera.rpg

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.waitForUpOrCancellation
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.CompositingStrategy
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.Shadow
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.clipPath
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlin.math.max

private val panel = Color(0xCC120D0B)
private val bronze = Color(0xFF8C6A3F)
private val parchment = Color(0xFFE8D9B5)
private val textShadow = Shadow(Color.Black, Offset(2f, 2f), 4f)

@Composable
fun RpgScreen(game: Game) {
    var frame by remember { mutableLongStateOf(0L) }
    var hudTick by remember { mutableIntStateOf(0) }
    var started by remember { mutableStateOf(false) }
    var sheetOpen by remember { mutableStateOf(false) }

    LaunchedEffect(Unit) {
        var last = withFrameNanos { it }
        var n = 0
        while (true) {
            withFrameNanos { now ->
                val dt = ((now - last) / 1_000_000_000f).coerceAtMost(0.05f)
                last = now
                if (started && !sheetOpen) game.update(dt)
                frame++
                if (++n % 6 == 0) hudTick++
            }
        }
    }

    val measurer = rememberTextMeasurer()
    val density = LocalDensity.current
    val styles = remember(density) {
        TextStyles(
            small = TextStyle(fontSize = 15.sp, fontWeight = FontWeight.Bold, shadow = textShadow),
            big = TextStyle(fontSize = 22.sp, fontWeight = FontWeight.Black, shadow = textShadow),
            label = TextStyle(fontSize = 11.sp, fontWeight = FontWeight.Bold),
        )
    }

    Box(Modifier.fillMaxSize().background(Color.Black)) {
        Canvas(Modifier.fillMaxSize()) {
            frame.let { }
            drawWorld(game, measurer, styles)
        }
        Canvas(
            Modifier
                .fillMaxSize()
                .graphicsLayer { compositingStrategy = CompositingStrategy.Offscreen }
        ) {
            frame.let { }
            drawLighting(game)
        }

        if (started) {
            hudTick.let { }
            Hud(game, onSheet = { sheetOpen = true })
            Controls(game, Modifier.align(Alignment.BottomCenter))
            game.message?.let { msg ->
                Text(
                    msg,
                    color = game.messageColor,
                    fontSize = 20.sp,
                    fontFamily = FontFamily.Serif,
                    fontWeight = FontWeight.Bold,
                    textAlign = TextAlign.Center,
                    style = TextStyle(shadow = textShadow),
                    modifier = Modifier
                        .align(Alignment.Center)
                        .offset(y = (-140).dp)
                        .padding(horizontal = 24.dp)
                        .alpha(game.messageTimer.coerceIn(0f, 1f)),
                )
            }
        }

        when {
            !started -> TitleScreen(
                game,
                onContinue = { started = true },
                onNew = {
                    game.newGame()
                    started = true
                },
            )
            game.dead -> DeathScreen(onRespawn = { game.respawn() })
            sheetOpen -> CharacterSheet(game, onClose = { sheetOpen = false })
        }
    }
}

private fun Modifier.alpha(a: Float) = this.graphicsLayer { alpha = a }

// ---------------------------------------------------------------- HUD

@Composable
private fun Hud(game: Game, onSheet: () -> Unit) {
    val p = game.player
    Column(Modifier.fillMaxSize().systemBarsPadding().padding(10.dp)) {
        Row(verticalAlignment = Alignment.Top, modifier = Modifier.fillMaxWidth()) {
            Orb(p.hp / p.maxHp, Color(0xFFC62828), "${p.hp.toInt()}")
            Column(
                modifier = Modifier.weight(1f).padding(horizontal = 8.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Text(
                    "Dybde ${game.floor}",
                    color = parchment, fontSize = 18.sp, fontFamily = FontFamily.Serif, fontWeight = FontWeight.Bold,
                    style = TextStyle(shadow = textShadow),
                )
                Text("Niveau ${p.level}", color = GOLD, fontSize = 14.sp, fontWeight = FontWeight.Bold, style = TextStyle(shadow = textShadow))
                Box(
                    Modifier
                        .padding(top = 4.dp)
                        .fillMaxWidth(0.85f)
                        .height(6.dp)
                        .background(Color(0xAA000000), RoundedCornerShape(3.dp))
                ) {
                    Box(
                        Modifier
                            .fillMaxWidth((p.xp / p.xpToNext.toFloat()).coerceIn(0f, 1f))
                            .height(6.dp)
                            .background(Color(0xFFB388FF), RoundedCornerShape(3.dp))
                    )
                }
                Text("🪙 ${p.gold}", color = GOLD, fontSize = 13.sp, modifier = Modifier.padding(top = 2.dp), style = TextStyle(shadow = textShadow))
            }
            Orb(p.mana / p.maxMana, Color(0xFF1E5BD8), "${p.mana.toInt()}")
        }

        Row(Modifier.fillMaxWidth().padding(top = 8.dp), verticalAlignment = Alignment.Top) {
            Text(
                "🎒",
                fontSize = 26.sp,
                modifier = Modifier
                    .background(panel, RoundedCornerShape(10.dp))
                    .border(1.dp, bronze, RoundedCornerShape(10.dp))
                    .clickable(onClick = onSheet)
                    .padding(6.dp)
            )
            Spacer(Modifier.weight(1f))
            game.boss?.takeIf { it.aggro }?.let { boss ->
                Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.padding(horizontal = 8.dp)) {
                    Text(boss.type.label, color = Color(0xFFFF5252), fontFamily = FontFamily.Serif, fontWeight = FontWeight.Bold, fontSize = 15.sp)
                    Box(Modifier.width(150.dp).height(10.dp).background(Color(0xAA000000), RoundedCornerShape(3.dp))) {
                        Box(
                            Modifier
                                .fillMaxWidth((boss.hp / boss.maxHp).coerceIn(0f, 1f))
                                .height(10.dp)
                                .background(Color(0xFFB71C1C), RoundedCornerShape(3.dp))
                        )
                    }
                }
                Spacer(Modifier.weight(1f))
            }
            Minimap(game)
        }
    }
}

@Composable
private fun Orb(fraction: Float, color: Color, label: String) {
    Box(Modifier.size(68.dp), contentAlignment = Alignment.Center) {
        Canvas(Modifier.fillMaxSize()) {
            val r = size.minDimension / 2f
            val c = Offset(size.width / 2f, size.height / 2f)
            drawCircle(Color(0xFF0D0A0A), r, c)
            val f = fraction.coerceIn(0f, 1f)
            val clip = Path().apply { addOval(Rect(c, r * 0.9f)) }
            clipPath(clip) {
                drawRect(
                    Brush.verticalGradient(listOf(color.copy(red = (color.red + 0.2f).coerceAtMost(1f)), color, Color(color.red * 0.4f, color.green * 0.4f, color.blue * 0.4f))),
                    topLeft = Offset(0f, size.height * (1f - f)),
                    size = Size(size.width, size.height * f),
                )
            }
            drawOval(Color.White.copy(alpha = 0.25f), Offset(c.x - r * 0.5f, c.y - r * 0.75f), Size(r * 0.7f, r * 0.35f))
            drawCircle(bronze, r * 0.95f, c, style = Stroke(r * 0.12f))
            drawCircle(Color(0xFF3B2A17), r, c, style = Stroke(r * 0.04f))
        }
        Text(label, color = Color.White, fontSize = 15.sp, fontWeight = FontWeight.Bold, style = TextStyle(shadow = textShadow))
    }
}

@Composable
private fun Minimap(game: Game) {
    Canvas(
        Modifier
            .size(100.dp)
            .background(panel, RoundedCornerShape(8.dp))
            .border(1.dp, bronze, RoundedCornerShape(8.dp))
            .padding(4.dp)
    ) {
        val d = game.dungeon
        val cell = size.width / max(d.w, d.h)
        for (y in 0 until d.h) for (x in 0 until d.w) {
            val i = y * d.w + x
            if (!game.explored[i] || d.tiles[i] == WALL) continue
            val color = if (d.tiles[i] == STAIRS) Color(0xFF4FC3F7) else Color(0xFF6D625A)
            drawRect(color, Offset(x * cell, y * cell), Size(cell + 0.5f, cell + 0.5f))
        }
        val st = d.exit
        if (game.explored[st.cy * d.w + st.cx]) drawCircle(Color(0xFF4FC3F7), cell * 2f, Offset((st.cx + 0.5f) * cell, (st.cy + 0.5f) * cell))
        for (e in game.enemies) {
            if (e.aggro || game.explored[floorInt(e.y) * d.w + floorInt(e.x)]) {
                drawCircle(if (e.type == EnemyType.BOSS) Color(0xFFFF1744) else Color(0xFFE53935), cell * (if (e.type == EnemyType.BOSS) 2.2f else 1.1f), Offset(e.x * cell, e.y * cell))
            }
        }
        drawCircle(GOLD, cell * 1.6f, Offset(game.player.x * cell, game.player.y * cell))
    }
}

// ---------------------------------------------------------------- controls

@Composable
private fun Controls(game: Game, modifier: Modifier) {
    Box(
        modifier
            .fillMaxWidth()
            .systemBarsPadding()
            .padding(16.dp)
            .height(190.dp)
    ) {
        Joystick(game, Modifier.align(Alignment.BottomStart))
        Box(Modifier.align(Alignment.BottomEnd).size(200.dp, 190.dp)) {
            ActionButton(
                "⚔️", null, Color(0xFFB0BEC5), 92.dp,
                Modifier.align(Alignment.BottomEnd),
                onPress = {
                    game.attackHeld = true
                    game.attack()
                },
                onRelease = { game.attackHeld = false },
            )
            ActionButton("🔥", "12", Color(0xFFFF7A1A), 60.dp, Modifier.align(Alignment.TopEnd).offset(x = (-6).dp), onPress = { game.fireball() })
            ActionButton("🌀", "20", Color(0xFF90CAF9), 60.dp, Modifier.align(Alignment.CenterStart).offset(x = 18.dp, y = 6.dp), onPress = { game.whirlwind() })
            ActionButton("🧪", "${game.player.potions}", Color(0xFFFF5370), 52.dp, Modifier.align(Alignment.BottomStart), onPress = { game.drinkPotion() })
        }
    }
}

@Composable
private fun Joystick(game: Game, modifier: Modifier) {
    var knob by remember { mutableStateOf(Offset.Zero) }
    Box(
        modifier
            .size(150.dp)
            .pointerInput(Unit) {
                val radius = size.width / 2f
                val reach = radius * 0.75f
                awaitEachGesture {
                    val down = awaitFirstDown()
                    fun update(pos: Offset) {
                        var v = pos - Offset(radius, radius)
                        val len = v.getDistance()
                        if (len > reach) v = v * (reach / len)
                        knob = v
                        game.joyX = v.x / reach
                        game.joyY = v.y / reach
                    }
                    update(down.position)
                    while (true) {
                        val event = awaitPointerEvent()
                        val change = event.changes.firstOrNull { it.id == down.id } ?: break
                        if (!change.pressed) break
                        update(change.position)
                        change.consume()
                    }
                    knob = Offset.Zero
                    game.joyX = 0f
                    game.joyY = 0f
                }
            }
    ) {
        Canvas(Modifier.fillMaxSize()) {
            val c = Offset(size.width / 2f, size.height / 2f)
            val r = size.minDimension / 2f
            drawCircle(Color(0x55000000), r, c)
            drawCircle(bronze.copy(alpha = 0.7f), r, c, style = Stroke(r * 0.05f))
            val k = c + knob
            drawCircle(
                Brush.radialGradient(listOf(Color(0xFFB08A55), Color(0xFF4A3520)), Offset(k.x - r * 0.1f, k.y - r * 0.1f), r * 0.45f),
                r * 0.36f, k,
            )
        }
    }
}

@Composable
private fun ActionButton(
    icon: String,
    sub: String?,
    color: Color,
    size: Dp,
    modifier: Modifier,
    onPress: () -> Unit,
    onRelease: () -> Unit = {},
) {
    Box(
        modifier
            .size(size)
            .background(Brush.radialGradient(listOf(color.copy(alpha = 0.35f), Color(0xDD120D0B))), CircleShape)
            .border(2.dp, color.copy(alpha = 0.85f), CircleShape)
            .pointerInput(Unit) {
                awaitEachGesture {
                    awaitFirstDown()
                    onPress()
                    waitForUpOrCancellation()
                    onRelease()
                }
            },
        contentAlignment = Alignment.Center,
    ) {
        Text(icon, fontSize = (size.value * 0.4f).sp)
        if (sub != null) {
            Text(
                sub,
                color = Color.White,
                fontSize = 11.sp,
                fontWeight = FontWeight.Bold,
                style = TextStyle(shadow = textShadow),
                modifier = Modifier.align(Alignment.BottomCenter).padding(bottom = 3.dp),
            )
        }
    }
}

// ---------------------------------------------------------------- screens

@Composable
private fun DarkPanel(content: @Composable () -> Unit) {
    Box(Modifier.fillMaxSize().background(Color(0xB3000000)), contentAlignment = Alignment.Center) {
        Column(
            modifier = Modifier
                .padding(24.dp)
                .background(Color(0xF0140E0B), RoundedCornerShape(12.dp))
                .border(2.dp, bronze, RoundedCornerShape(12.dp))
                .padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) { content() }
    }
}

@Composable
private fun GothicButton(label: String, onClick: () -> Unit) {
    Box(
        Modifier
            .width(240.dp)
            .background(Brush.verticalGradient(listOf(Color(0xFF5A1414), Color(0xFF2A0808))), RoundedCornerShape(6.dp))
            .border(2.dp, bronze, RoundedCornerShape(6.dp))
            .clickable(onClick = onClick)
            .padding(vertical = 14.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(label, color = parchment, fontSize = 20.sp, fontFamily = FontFamily.Serif, fontWeight = FontWeight.Bold)
    }
}

@Composable
private fun TitleScreen(game: Game, onContinue: () -> Unit, onNew: () -> Unit) {
    Box(
        Modifier
            .fillMaxSize()
            .background(Brush.verticalGradient(listOf(Color(0xCC000000), Color(0x88200606), Color(0xEE000000)))),
        contentAlignment = Alignment.Center,
    ) {
        Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(18.dp)) {
            Text(
                "SKYGGERNES\nDYB",
                textAlign = TextAlign.Center,
                style = TextStyle(
                    color = Color(0xFFE0B25A),
                    fontSize = 48.sp,
                    lineHeight = 52.sp,
                    fontFamily = FontFamily.Serif,
                    fontWeight = FontWeight.Black,
                    shadow = Shadow(Color(0xFFFF3D00), Offset(0f, 0f), 24f),
                ),
            )
            Text("Stig ned i mørket. Find skattene. Overlev.", color = parchment.copy(alpha = 0.8f), fontFamily = FontFamily.Serif, fontSize = 15.sp)
            Spacer(Modifier.height(12.dp))
            if (game.hasSave) {
                GothicButton("Fortsæt — Dybde ${game.floor}, Niv. ${game.player.level}", onContinue)
            }
            GothicButton("Nyt eventyr", onNew)
            Spacer(Modifier.height(8.dp))
            Text(
                "Joystick: gå · ⚔️ hold for at angribe\n🔥 ildkugle · 🌀 hvirvelslag · 🧪 eliksir\nFind trappen ned for at gå dybere",
                color = Color.White.copy(alpha = 0.6f), fontSize = 13.sp, textAlign = TextAlign.Center,
            )
        }
    }
}

@Composable
private fun DeathScreen(onRespawn: () -> Unit) {
    DarkPanel {
        Text("DU ER FALDET", color = Color(0xFFD32F2F), fontSize = 34.sp, fontFamily = FontFamily.Serif, fontWeight = FontWeight.Black)
        Text("Mørket tog dig denne gang.", color = parchment, fontFamily = FontFamily.Serif)
        GothicButton("Rejs dig (−20% guld)", onRespawn)
    }
}

@Composable
private fun CharacterSheet(game: Game, onClose: () -> Unit) {
    val p = game.player
    DarkPanel {
        Text("Helten", color = GOLD, fontSize = 28.sp, fontFamily = FontFamily.Serif, fontWeight = FontWeight.Black)
        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
            StatRow("Niveau", "${p.level}  (${p.xp}/${p.xpToNext} XP)")
            StatRow("Liv", "${p.hp.toInt()} / ${p.maxHp.toInt()}")
            StatRow("Skade", "${p.damage}")
            StatRow("Rustning", "${p.armorValue}")
            StatRow("Kritisk chance", "${p.critChance}%")
            StatRow("Guld", "${p.gold}")
            StatRow("Eliksirer", "${p.potions}")
        }
        for (slot in Slot.entries) {
            val item = game.equipped(slot)
            Column(
                Modifier
                    .width(280.dp)
                    .background(Color(0x66000000), RoundedCornerShape(6.dp))
                    .border(1.dp, (item?.rarity?.color ?: Color.Gray).copy(alpha = 0.6f), RoundedCornerShape(6.dp))
                    .padding(10.dp)
            ) {
                Text(slot.label, color = Color.White.copy(alpha = 0.5f), fontSize = 11.sp)
                if (item == null) {
                    Text("Intet", color = Color.Gray, fontSize = 16.sp)
                } else {
                    Text(item.name, color = item.rarity.color, fontSize = 17.sp, fontFamily = FontFamily.Serif, fontWeight = FontWeight.Bold)
                    Text("${item.rarity.label} · ${item.statLine()}", color = parchment, fontSize = 12.sp)
                }
            }
        }
        GothicButton("Luk", onClose)
    }
}

@Composable
private fun StatRow(label: String, value: String) {
    Row(Modifier.width(260.dp)) {
        Text(label, color = parchment.copy(alpha = 0.75f), fontSize = 15.sp, modifier = Modifier.weight(1f))
        Text(value, color = Color.White, fontSize = 15.sp, fontWeight = FontWeight.Bold)
    }
}
