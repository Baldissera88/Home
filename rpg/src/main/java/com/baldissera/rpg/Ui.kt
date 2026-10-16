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
import androidx.compose.foundation.layout.BoxScope
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
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
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
import androidx.compose.ui.graphics.Paint
import androidx.compose.ui.graphics.drawscope.drawIntoCanvas
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.Shadow
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.clipPath
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlin.math.cos
import kotlin.math.max
import kotlin.math.sin

private val panel = Color(0xCC120D0B)
private val bronze = Color(0xFF8C6A3F)
private val parchment = Color(0xFFE8D9B5)
private val textShadow = Shadow(Color.Black, Offset(2f, 2f), 4f)
private val serifBold = TextStyle(fontFamily = FontFamily.Serif, fontWeight = FontWeight.Bold, shadow = textShadow)

private enum class Overlay { NONE, INVENTORY, SKILLS, QUESTS, SHOP, MAP, SMITH, ELDER, SETTINGS, STASH }

@Composable
fun RpgScreen(
    game: Game, assets: Assets, music: Music, sfx: Sfx, settings: android.content.SharedPreferences,
    autoStart: Boolean = false, debugOverlay: Int = -1, animate: Boolean = true,
) {
    var frame by remember { mutableLongStateOf(0L) }
    var hudTick by remember { mutableIntStateOf(0) }
    var started by remember { mutableStateOf(autoStart) }
    var overlay by remember { mutableStateOf(if (debugOverlay >= 0) Overlay.entries[debugOverlay] else Overlay.NONE) }

    LaunchedEffect(Unit) {
        if (!animate) return@LaunchedEffect
        var last = withFrameNanos { it }
        var n = 0
        while (true) {
            withFrameNanos { now ->
                val dt = ((now - last) / 1_000_000_000f).coerceAtMost(0.05f)
                last = now
                if (started && overlay == Overlay.NONE) game.update(dt)
                if (started) music.play(game.musicTrack)
                music.tick(dt)
                frame++
                if (++n % 5 == 0) hudTick++
            }
        }
    }

    val measurer = rememberTextMeasurer()
    val styles = remember {
        TextStyles(
            small = TextStyle(fontSize = 15.sp, fontWeight = FontWeight.Bold, shadow = textShadow),
            big = TextStyle(fontSize = 22.sp, fontWeight = FontWeight.Black, shadow = textShadow),
            label = TextStyle(fontSize = 11.sp, fontWeight = FontWeight.Bold),
        )
    }

    Box(Modifier.fillMaxSize().background(Color.Black)) {
        Canvas(Modifier.fillMaxSize()) {
            frame.let { }
            drawWorld(game, assets, measurer, styles)
        }
        Canvas(Modifier.fillMaxSize()) {
            frame.let { }
            // Darkness and its light holes need a layer of their own, or the holes would erase the world below.
            drawIntoCanvas { it.saveLayer(Rect(Offset.Zero, size), Paint()) }
            drawLighting(game)
            drawIntoCanvas { it.restore() }
        }

        hudTick.let { }
        if (started) {
            Hud(game, assets, onOpen = { overlay = it })
            Controls(game, Modifier.align(Alignment.BottomCenter))
            if (overlay == Overlay.NONE) {
                val npc = game.nearNpc
                when {
                    game.nearMerchant -> GothicButton("💰 Handl med købmanden", { overlay = Overlay.SHOP }, Modifier.align(Alignment.Center).offset(y = 90.dp))
                    game.nearStash -> GothicButton("🗝 Åbn din kiste", { overlay = Overlay.STASH }, Modifier.align(Alignment.Center).offset(y = 90.dp))
                    npc?.kind == NpcKind.SMITH -> GothicButton("⚒ Tal med smeden", { overlay = Overlay.SMITH }, Modifier.align(Alignment.Center).offset(y = 90.dp))
                    npc?.kind == NpcKind.ELDER -> GothicButton("📜 Tal med Den Ældste", { overlay = Overlay.ELDER }, Modifier.align(Alignment.Center).offset(y = 90.dp))
                }
            }
            game.bossIntro?.let { name ->
                val k = game.bossIntroTime
                Column(
                    Modifier.align(Alignment.Center).offset(y = (-40).dp).graphicsLayer { alpha = (k / 0.6f).coerceIn(0f, 1f) },
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    Text(name.uppercase(), color = Color(0xFFFF5252), fontSize = 34.sp, textAlign = TextAlign.Center,
                        style = serifBold.copy(fontWeight = FontWeight.Black, shadow = Shadow(Color(0xFF7F0000), Offset.Zero, 24f)))
                    Text("— forbereder sig på kamp —", color = parchment.copy(alpha = 0.8f), fontSize = 14.sp, fontFamily = FontFamily.Serif)
                }
            }
            game.message?.let { msg ->
                Text(
                    msg,
                    color = game.messageColor,
                    fontSize = 19.sp,
                    textAlign = TextAlign.Center,
                    style = serifBold,
                    modifier = Modifier
                        .align(Alignment.Center)
                        .offset(y = (-130).dp)
                        .padding(horizontal = 24.dp)
                        .graphicsLayer { alpha = game.messageTimer.coerceIn(0f, 1f) },
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
            game.victory -> VictoryScreen(game, onContinue = { game.victory = false; game.save() })
            overlay == Overlay.INVENTORY -> InventoryScreen(game, assets, hudTick, onClose = { overlay = Overlay.NONE })
            overlay == Overlay.SKILLS -> SkillsScreen(game, hudTick, onClose = { overlay = Overlay.NONE })
            overlay == Overlay.QUESTS -> QuestScreen(game, onClose = { overlay = Overlay.NONE })
            overlay == Overlay.SHOP -> ShopScreen(game, assets, hudTick, onClose = { overlay = Overlay.NONE })
            overlay == Overlay.MAP -> MapScreen(game, onClose = { overlay = Overlay.NONE })
            overlay == Overlay.SMITH -> SmithScreen(game, assets, hudTick, onClose = { overlay = Overlay.NONE })
            overlay == Overlay.STASH -> StashScreen(game, assets, onClose = { overlay = Overlay.NONE })
            overlay == Overlay.ELDER -> ElderScreen(game, hudTick, onClose = { overlay = Overlay.NONE })
            overlay == Overlay.SETTINGS -> SettingsScreen(music, sfx, settings, onClose = { overlay = Overlay.NONE })
        }
    }
}

// ---------------------------------------------------------------- HUD

@Composable
private fun Hud(game: Game, assets: Assets, onOpen: (Overlay) -> Unit) {
    val p = game.player
    Column(Modifier.fillMaxSize().systemBarsPadding().padding(10.dp)) {
        Row(verticalAlignment = Alignment.Top, modifier = Modifier.fillMaxWidth()) {
            Orb(p.hp / p.maxHp, Color(0xFFC62828), "${p.hp.toInt()}")
            Column(
                modifier = Modifier.weight(1f).padding(horizontal = 8.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Text(game.areaTitle, color = parchment, fontSize = 16.sp, style = serifBold, textAlign = TextAlign.Center)
                Text("Niveau ${p.level}", color = GOLD, fontSize = 13.sp, fontWeight = FontWeight.Bold, style = TextStyle(shadow = textShadow))
                Box(
                    Modifier.padding(top = 3.dp).fillMaxWidth(0.85f).height(6.dp)
                        .background(Color(0xAA000000), RoundedCornerShape(3.dp))
                ) {
                    Box(
                        Modifier.fillMaxWidth((p.xp / p.xpToNext.toFloat()).coerceIn(0f, 1f)).height(6.dp)
                            .background(Brush.horizontalGradient(listOf(Color(0xFF7C4DFF), Color(0xFFB388FF))), RoundedCornerShape(3.dp))
                    )
                }
                Text("🪙 ${p.gold}", color = GOLD, fontSize = 13.sp, modifier = Modifier.padding(top = 2.dp), style = TextStyle(shadow = textShadow))
                p.buff?.let {
                    Text("${it.label} (${p.buffTime.toInt()}s)", color = it.color, fontSize = 11.sp, style = TextStyle(shadow = textShadow))
                }
                game.bounty?.let { b ->
                    Text(
                        if (b.done) "📜 Dusør klar — gå til Den Ældste" else "📜 ${b.type.label}: ${b.got}/${b.need}",
                        color = if (b.done) GOLD else parchment, fontSize = 11.sp, style = TextStyle(shadow = textShadow),
                    )
                }
            }
            Orb(p.mana / p.maxMana, Color(0xFF1E5BD8), "${p.mana.toInt()}")
        }

        Row(Modifier.fillMaxWidth().padding(top = 8.dp), verticalAlignment = Alignment.Top) {
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                MenuButton("🎒", p.inventory.any { game.isUpgrade(it) }) { onOpen(Overlay.INVENTORY) }
                MenuButton("✨", p.skillPoints > 0) { onOpen(Overlay.SKILLS) }
                MenuButton("📜", false) { onOpen(Overlay.QUESTS) }
                MenuButton("⚙️", false) { onOpen(Overlay.SETTINGS) }
                if (!game.inVillage) MenuButton("🏕️", false) { game.townPortal() }
            }
            Spacer(Modifier.weight(1f))
            game.target?.let { boss ->
                Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.padding(horizontal = 6.dp)) {
                    Text(boss.name, color = if (boss.type.boss) Color(0xFFFF5252) else Color(0xFF82B1FF), fontSize = 15.sp, style = serifBold)
                    if (boss.affixes.isNotEmpty()) {
                        Row {
                            boss.affixes.forEachIndexed { i, a ->
                                if (i > 0) Text(" · ", color = parchment.copy(alpha = 0.5f), fontSize = 11.sp)
                                Text(a.label, color = a.color, fontSize = 11.sp, fontWeight = FontWeight.Bold)
                            }
                        }
                    }
                    Box(Modifier.width(160.dp).height(12.dp).background(Color(0xAA000000), RoundedCornerShape(3.dp)).border(1.dp, bronze, RoundedCornerShape(3.dp))) {
                        Box(
                            Modifier.fillMaxWidth((boss.hp / boss.maxHp).coerceIn(0f, 1f)).height(12.dp)
                                .background(Brush.verticalGradient(listOf(Color(0xFFE53935), Color(0xFF7F0000))), RoundedCornerShape(3.dp))
                        )
                    }
                }
                Spacer(Modifier.weight(1f))
            }
            Box(Modifier.clickable { onOpen(Overlay.MAP) }) { Minimap(game) }
        }
    }
}

@Composable
private fun MenuButton(icon: String, badge: Boolean, onClick: () -> Unit) {
    Box {
        Text(
            icon, fontSize = 24.sp,
            modifier = Modifier
                .background(panel, RoundedCornerShape(10.dp))
                .border(1.dp, bronze, RoundedCornerShape(10.dp))
                .clickable(onClick = onClick)
                .padding(6.dp)
        )
        if (badge) {
            Box(Modifier.align(Alignment.TopEnd).offset(x = 4.dp, y = (-4).dp).size(12.dp).background(Color(0xFFFF5252), CircleShape))
        }
    }
}

@Composable
private fun Orb(fraction: Float, color: Color, label: String) {
    Box(Modifier.size(70.dp), contentAlignment = Alignment.Center) {
        Canvas(Modifier.fillMaxSize()) {
            val r = size.minDimension / 2f
            val c = Offset(size.width / 2f, size.height / 2f)
            drawCircle(Color(0xFF0D0A0A), r, c)
            val f = fraction.coerceIn(0f, 1f)
            val clip = Path().apply { addOval(Rect(c, r * 0.9f)) }
            clipPath(clip) {
                drawRect(
                    Brush.verticalGradient(listOf(color.copy(red = (color.red + 0.25f).coerceAtMost(1f)), color, Color(color.red * 0.35f, color.green * 0.35f, color.blue * 0.35f))),
                    topLeft = Offset(0f, size.height * (1f - f)), size = Size(size.width, size.height * f),
                )
                drawRect(Color.White.copy(alpha = 0.15f), topLeft = Offset(0f, size.height * (1f - f)), size = Size(size.width, size.height * 0.03f))
            }
            drawOval(Color.White.copy(alpha = 0.22f), Offset(c.x - r * 0.5f, c.y - r * 0.75f), Size(r * 0.7f, r * 0.35f))
            drawCircle(Brush.sweepGradient(listOf(Color(0xFFB08A55), Color(0xFF5A3E1E), Color(0xFFD9B77A), Color(0xFF5A3E1E), Color(0xFFB08A55)), c), r * 0.95f, c, style = Stroke(r * 0.13f))
        }
        Text(label, color = Color.White, fontSize = 15.sp, fontWeight = FontWeight.Bold, style = TextStyle(shadow = textShadow))
    }
}

@Composable
private fun Minimap(game: Game) {
    Canvas(
        Modifier.size(104.dp).background(panel, RoundedCornerShape(8.dp)).border(1.dp, bronze, RoundedCornerShape(8.dp)).padding(4.dp)
    ) {
        val d = game.dungeon
        val cell = size.width / max(d.w, d.h)
        for (y in 0 until d.h) for (x in 0 until d.w) {
            val i = y * d.w + x
            if (!game.explored[i]) continue
            val color = when (d.tiles[i]) {
                WALL -> if (game.inWorld) Color(0xFF8D6E63) else continue
                STAIRS, ENTRANCE -> Color(0xFF4FC3F7)
                TREE -> Color(0xFF2E5E1E)
                ROCK -> Color(0xFF7A7570)
                WATER -> Color(0xFF2B6C8F)
                BLOCK -> Color(0xFF6D4C41)
                else -> if (game.inWorld) Color(0xFF5E7A3A) else Color(0xFF6D625A)
            }
            drawRect(color, Offset(x * cell, y * cell), Size(cell + 0.5f, cell + 0.5f))
        }
        val st = d.exit
        if (!game.inWorld && game.explored[st.cy * d.w + st.cx]) drawCircle(Color(0xFF4FC3F7), cell * 2f, Offset((st.cx + 0.5f) * cell, (st.cy + 0.5f) * cell))
        for (e in d.entrances) {
            val c = if (e.region == Region.HELL) Color(0xFFFF3D00) else Color(0xFF4FC3F7)
            drawCircle(c, cell * 2.4f, Offset((e.x + 0.5f) * cell, (e.y + 0.5f) * cell))
        }
        d.village?.let { v ->
            drawRect(GOLD.copy(alpha = 0.6f), Offset(v.x * cell, v.y * cell), Size(v.w * cell, v.h * cell), style = Stroke(cell * 0.8f))
        }
        for (e in game.enemies) {
            val i = floorInt(e.y) * d.w + floorInt(e.x)
            if (e.aggro || (i in game.explored.indices && game.explored[i])) {
                drawCircle(if (e.type.boss) Color(0xFFFF1744) else if (e.elite) Color(0xFF64B5F6) else Color(0xFFE53935),
                    cell * (if (e.type.boss) 2.4f else 1.1f), Offset(e.x * cell, e.y * cell))
            }
        }
        drawCircle(GOLD, cell * 1.7f, Offset(game.player.x * cell, game.player.y * cell))
    }
}

// ---------------------------------------------------------------- controls

@Composable
private fun Controls(game: Game, modifier: Modifier) {
    Box(modifier.fillMaxWidth().systemBarsPadding().padding(14.dp).height(210.dp)) {
        Joystick(game, Modifier.align(Alignment.BottomStart))
        val dodgeReady = game.player.dodgeCd <= 0f
        ActionButton(
            "💨", Color(0xFF90A4AE), 54.dp,
            Modifier.align(Alignment.BottomStart).offset(x = 104.dp, y = (-142).dp).graphicsLayer { alpha = if (dodgeReady) 1f else 0.45f },
            onPress = { game.dodge() },
        )
        ActionButton(
            "🧪", Color(0xFFFF5370), 50.dp,
            Modifier.align(Alignment.BottomStart).offset(x = 30.dp, y = (-150).dp),
            sub = "${game.player.potions}",
            onPress = { game.drinkPotion() },
        )
        Box(Modifier.align(Alignment.BottomEnd).size(236.dp, 210.dp)) {
            val attackC = Offset(236f - 48f, 210f - 48f)
            ActionButton(
                "⚔️", Color(0xFFB0BEC5), 96.dp, Modifier.at(attackC, 96f),
                onPress = {
                    game.attackHeld = true
                    game.attack()
                },
                onRelease = { game.attackHeld = false },
            )
            // Four skills on an arc around the attack button, the potion at its foot.
            val skills = listOf(Skill.FIREBALL, Skill.WHIRL, Skill.NOVA, Skill.CHAIN)
            val angles = listOf(280f, 245f, 210f, 175f)
            for ((i, s) in skills.withIndex()) {
                val a = Math.toRadians(angles[i].toDouble())
                val c = Offset(attackC.x + cos(a).toFloat() * 104f, attackC.y + sin(a).toFloat() * 104f)
                SkillButton(game, s, Modifier.at(c, 58f))
            }
        }
    }
}

private fun Modifier.at(center: Offset, sizeDp: Float) =
    this.offset(x = (center.x - sizeDp / 2f).dp, y = (center.y - sizeDp / 2f).dp)

@Composable
private fun SkillButton(game: Game, skill: Skill, modifier: Modifier) {
    val level = game.player.skills[skill] ?: 0
    val cd = game.player.cooldowns[skill] ?: 0f
    Box(modifier) {
        ActionButton(
            if (level > 0) skill.icon else "🔒", skill.color, 58.dp, Modifier,
            sub = if (level > 0) "${skill.mana.toInt()}" else null,
            onPress = { game.cast(skill) },
        )
        if (cd > 0f && skill.cooldown > 0.5f) {
            Canvas(Modifier.size(58.dp)) {
                drawArc(Color(0xAA000000), -90f, 360f * (cd / skill.cooldown), useCenter = true)
            }
        }
    }
}

@Composable
private fun Joystick(game: Game, modifier: Modifier) {
    var knob by remember { mutableStateOf(Offset.Zero) }
    Box(
        modifier.size(150.dp).pointerInput(Unit) {
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
            drawCircle(Brush.radialGradient(listOf(Color(0x33000000), Color(0x88000000)), c, r), r, c)
            drawCircle(bronze.copy(alpha = 0.7f), r, c, style = Stroke(r * 0.05f))
            val k = c + knob
            drawCircle(Brush.radialGradient(listOf(Color(0xFFC9A46A), Color(0xFF4A3520)), Offset(k.x - r * 0.1f, k.y - r * 0.1f), r * 0.45f), r * 0.36f, k)
        }
    }
}

@Composable
private fun ActionButton(
    icon: String, color: Color, size: Dp, modifier: Modifier,
    sub: String? = null, onPress: () -> Unit, onRelease: () -> Unit = {},
) {
    Box(
        modifier
            .size(size)
            .background(Brush.radialGradient(listOf(color.copy(alpha = 0.35f), Color(0xDD120D0B))), CircleShape)
            .border(2.dp, Brush.sweepGradient(listOf(color, bronze, color, bronze, color)), CircleShape)
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
                sub, color = Color.White, fontSize = 11.sp, fontWeight = FontWeight.Bold, style = TextStyle(shadow = textShadow),
                modifier = Modifier.align(Alignment.BottomCenter).padding(bottom = 3.dp),
            )
        }
    }
}

// ---------------------------------------------------------------- shared widgets

@Composable
private fun DarkPanel(title: String, onClose: () -> Unit, content: @Composable () -> Unit) {
    Box(Modifier.fillMaxSize().background(Color(0xCC000000)).systemBarsPadding(), contentAlignment = Alignment.Center) {
        Column(
            modifier = Modifier
                .padding(14.dp)
                .background(Brush.verticalGradient(listOf(Color(0xF51E1511), Color(0xF50E0A08))), RoundedCornerShape(12.dp))
                .border(2.dp, bronze, RoundedCornerShape(12.dp))
                .padding(16.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth()) {
                Text(title, color = GOLD, fontSize = 24.sp, style = serifBold, modifier = Modifier.weight(1f))
                Text("✕", color = parchment, fontSize = 24.sp, modifier = Modifier.clickable(onClick = onClose).padding(6.dp))
            }
            Spacer(Modifier.height(8.dp))
            Column(
                Modifier.verticalScroll(rememberScrollState()),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) { content() }
        }
    }
}

@Composable
private fun GothicButton(label: String, onClick: () -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true, wide: Boolean = true) {
    Box(
        modifier
            .then(if (wide) Modifier.width(250.dp) else Modifier)
            .background(
                Brush.verticalGradient(if (enabled) listOf(Color(0xFF6A1717), Color(0xFF2A0808)) else listOf(Color(0xFF3A3530), Color(0xFF1E1B18))),
                RoundedCornerShape(6.dp),
            )
            .border(2.dp, bronze, RoundedCornerShape(6.dp))
            .clickable(enabled = enabled, onClick = onClick)
            .padding(horizontal = 14.dp, vertical = 12.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(label, color = if (enabled) parchment else Color.Gray, fontSize = 17.sp, style = serifBold, textAlign = TextAlign.Center)
    }
}

@Composable
private fun ItemIcon(item: Item?, assets: Assets, size: Dp, selected: Boolean = false, upgrade: Boolean = false, placeholder: String = "", onClick: () -> Unit = {}) {
    val color = item?.rarity?.color ?: Color(0xFF4A4038)
    Box(
        Modifier
            .size(size)
            .background(Brush.radialGradient(listOf(color.copy(alpha = if (item == null) 0.05f else 0.28f), Color(0xFF0C0907))), RoundedCornerShape(6.dp))
            .border(if (selected) 3.dp else 1.dp, if (selected) Color.White else color.copy(alpha = 0.8f), RoundedCornerShape(6.dp))
            .clickable(onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        if (item != null) {
            Canvas(Modifier.fillMaxSize()) { drawIcon(assets, item.icon, this.size.width / 2f, this.size.height / 2f, this.size.width * 0.92f) }
            if (upgrade) Text("⬆", color = Color(0xFF69F0AE), fontSize = 13.sp, fontWeight = FontWeight.Black,
                modifier = Modifier.align(Alignment.TopEnd).padding(2.dp), style = TextStyle(shadow = textShadow))
        } else {
            Text(placeholder, color = Color(0xFF6D625A), fontSize = 10.sp, textAlign = TextAlign.Center)
        }
    }
}

@Composable
private fun ItemDetail(item: Item, compare: Item?) {
    Column(
        Modifier.width(300.dp).background(Color(0x66000000), RoundedCornerShape(8.dp))
            .border(1.dp, item.rarity.color.copy(alpha = 0.7f), RoundedCornerShape(8.dp)).padding(10.dp)
    ) {
        Text(item.name, color = item.rarity.color, fontSize = 18.sp, style = serifBold)
        Text("${item.rarity.label} ${item.slot.label.lowercase()} · niveau ${item.level}", color = parchment.copy(alpha = 0.7f), fontSize = 12.sp)
        item.weaponKind?.let { k -> Text("${k.label}: ${k.blurb}", color = Color(0xFFB0BEC5), fontSize = 12.sp) }
        Spacer(Modifier.height(4.dp))
        val keys = (item.stats().map { it.first } + (compare?.stats()?.map { it.first } ?: emptyList())).distinct()
        for (k in keys) {
            val mine = item.stats().firstOrNull { it.first == k }?.second ?: 0
            val theirs = compare?.stats()?.firstOrNull { it.first == k }?.second ?: 0
            Row {
                Text(if (mine > 0) "+$mine $k" else "—  $k", color = if (mine > 0) Color.White else Color.Gray, fontSize = 14.sp, modifier = Modifier.weight(1f))
                if (compare != null && mine != theirs) {
                    val diff = mine - theirs
                    Text(if (diff > 0) "▲ $diff" else "▼ ${-diff}", color = if (diff > 0) Color(0xFF69F0AE) else Color(0xFFFF5252), fontSize = 14.sp, fontWeight = FontWeight.Bold)
                }
            }
        }
        item.power?.let { pw ->
            Spacer(Modifier.height(4.dp))
            Text("✦ ${pw.label}", color = item.rarity.color, fontSize = 14.sp, style = serifBold)
            Text(pw.text, color = parchment, fontSize = 12.sp)
        }
    }
}

// ---------------------------------------------------------------- screens

@Composable
private fun InventoryScreen(game: Game, assets: Assets, tick: Int, onClose: () -> Unit) {
    tick.let { }
    val p = game.player
    var selected by remember { mutableStateOf<Item?>(null) }
    DarkPanel("Helten", onClose) {
        Row(Modifier.width(310.dp)) {
            Column(Modifier.weight(1f)) {
                StatLine("Niveau", "${p.level}")
                StatLine("Liv", "${p.hp.toInt()}/${p.maxHp.toInt()}")
                StatLine("Mana", "${p.mana.toInt()}/${p.maxMana.toInt()}")
                StatLine("Skade", "${p.damage}")
            }
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                StatLine("Rustning", "${p.armorValue}")
                StatLine("Kritisk", "${p.critChance}%")
                StatLine("Livsdræn", "${p.lifeSteal}%")
                StatLine("Magi", "+${p.spellBonus}%")
                StatLine("Angrebsfart", "+${p.attackSpeed}%")
                StatLine("Guldfund", "+${p.goldFind}%")
                StatLine("Guld", "${p.gold}")
            }
        }
        Text("Udrustning", color = parchment, fontSize = 15.sp, style = serifBold)
        Text("Våben: ${p.weaponKind.label} — ${p.weaponKind.blurb}", color = Color(0xFFB0BEC5), fontSize = 12.sp)
        for (row in Slot.entries.chunked(4)) {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                for (slot in row) {
                    val item = p.equipment[slot]
                    ItemIcon(item, assets, 62.dp, selected = item != null && item === selected, placeholder = slot.label) { selected = item }
                }
            }
        }
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("Taske (${p.inventory.size}/$INVENTORY_SIZE)", color = parchment, fontSize = 15.sp, style = serifBold)
            SmallButton("Sortér") { game.sortInventory(); selected = null }
            SmallButton("Sælg skrald") { game.sellJunk(); selected = null }
        }
        if (p.inventory.isEmpty()) Text("Tom — dræb monstre og åbn kister", color = Color.Gray, fontSize = 13.sp)
        for (row in p.inventory.chunked(6)) {
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                for (item in row) ItemIcon(item, assets, 46.dp, selected = item === selected, upgrade = game.isUpgrade(item)) { selected = item }
            }
        }
        selected?.let { item ->
            val equipped = p.equipment[item.slot]
            val isEquipped = equipped === item
            ItemDetail(item, if (isEquipped) null else equipped)
            if (!isEquipped) {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    GothicButton("Tag på", { game.equip(item); selected = item }, wide = false)
                    GothicButton("Sælg (${item.sellPrice} 🪙)", { game.sell(item); selected = null }, wide = false)
                }
            }
        }
        RarityLegend()
    }
}

@Composable
private fun SmallButton(label: String, onClick: () -> Unit) {
    Text(
        label, color = parchment, fontSize = 12.sp, fontWeight = FontWeight.Bold,
        modifier = Modifier.background(Color(0xFF3A2A1E), RoundedCornerShape(6.dp)).border(1.dp, bronze, RoundedCornerShape(6.dp))
            .clickable(onClick = onClick).padding(horizontal = 8.dp, vertical = 4.dp),
    )
}

@Composable
private fun RarityLegend() {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Text("Sjældenhed", color = parchment.copy(alpha = 0.6f), fontSize = 11.sp)
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            for (r in Rarity.entries) Text(r.label, color = r.color, fontSize = 11.sp, fontWeight = FontWeight.Bold)
        }
    }
}

@Composable
private fun StatLine(label: String, value: String) {
    Row(Modifier.fillMaxWidth()) {
        Text(label, color = parchment.copy(alpha = 0.7f), fontSize = 13.sp, modifier = Modifier.weight(1f))
        Text(value, color = Color.White, fontSize = 13.sp, fontWeight = FontWeight.Bold)
    }
}

@Composable
private fun SkillsScreen(game: Game, tick: Int, onClose: () -> Unit) {
    tick.let { }
    val p = game.player
    DarkPanel("Færdigheder", onClose) {
        Text(
            if (p.skillPoints > 0) "Du har ${p.skillPoints} point at bruge" else "Du får et point for hvert nyt niveau",
            color = if (p.skillPoints > 0) GOLD else parchment.copy(alpha = 0.7f), fontSize = 14.sp,
        )
        for (s in Skill.entries) {
            val lvl = p.skills[s] ?: 0
            Row(
                Modifier.width(310.dp).background(Color(0x55000000), RoundedCornerShape(8.dp))
                    .border(1.dp, s.color.copy(alpha = 0.6f), RoundedCornerShape(8.dp)).padding(10.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(s.icon, fontSize = 30.sp)
                Spacer(Modifier.width(10.dp))
                Column(Modifier.weight(1f)) {
                    Text("${s.label}  ${"★".repeat(lvl)}${"☆".repeat(5 - lvl)}", color = s.color, fontSize = 16.sp, style = serifBold)
                    Text(if (lvl > 0) s.describe(lvl) else "Ikke lært endnu. ${s.describe(1)}", color = parchment, fontSize = 12.sp)
                    if (lvl in 1..4) Text("Næste: ${s.describe(lvl + 1)}", color = Color.Gray, fontSize = 11.sp)
                    Text("Mana: ${s.mana.toInt()} · Ventetid: ${s.cooldown}s", color = Color(0xFF64B5F6), fontSize = 11.sp)
                }
                if (p.skillPoints > 0 && lvl < 5) {
                    Text(
                        "+", color = Color.Black, fontSize = 22.sp, fontWeight = FontWeight.Black,
                        modifier = Modifier.background(GOLD, CircleShape).clickable { game.learn(s) }.padding(horizontal = 12.dp, vertical = 2.dp),
                    )
                }
            }
        }
    }
}

@Composable
private fun QuestScreen(game: Game, onClose: () -> Unit) {
    DarkPanel("Opgaver", onClose) {
        Text(
            "Et mørke stiger op fra dybet under lejren. Fire herskere vogter vejen til Skyggekongens trone.",
            color = parchment.copy(alpha = 0.85f), fontSize = 13.sp, fontFamily = FontFamily.Serif, modifier = Modifier.width(300.dp),
        )
        for ((i, q) in QUESTS.withIndex()) {
            val done = i < game.questStage
            val current = i == game.questStage
            Row(
                Modifier.width(300.dp).background(if (current) Color(0x332E7D32) else Color(0x33000000), RoundedCornerShape(6.dp)).padding(8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(if (done) "✅" else if (current) "⚔️" else "🔒", fontSize = 20.sp)
                Spacer(Modifier.width(8.dp))
                Column {
                    Text(q.first, color = if (done) Color(0xFF81C784) else if (current) GOLD else Color.Gray, fontSize = 15.sp, style = serifBold)
                    Text(q.second, color = parchment.copy(alpha = if (current) 0.9f else 0.5f), fontSize = 12.sp)
                }
            }
        }
        val shards = game.shardsFound.size
        Row(
            Modifier.width(300.dp).background(Color(0x33000000), RoundedCornerShape(6.dp)).padding(8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text("❤", color = HEART, fontSize = 22.sp)
            Spacer(Modifier.width(8.dp))
            Column {
                Text("Livsfragmenter ${shards % 4}/4", color = HEART, fontSize = 15.sp, style = serifBold)
                Text(
                    "Fire fragmenter giver et nyt hjerte (+${HEART_LIFE.toInt()} liv). Ekstra hjerter: ${game.player.hearts}. " +
                        "Der gemmer sig ét på hver dybde og flere ude i vildmarken.",
                    color = parchment.copy(alpha = 0.8f), fontSize = 12.sp,
                )
            }
        }
        Text("Dybeste: ${game.deepest}", color = parchment.copy(alpha = 0.6f), fontSize = 12.sp)
    }
}

@Composable
private fun StashGrid(game: Game, assets: Assets, title: String, items: List<Item>, capacity: Int, selected: Item?, onSelect: (Item?) -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text("$title  ${items.size}/$capacity", color = GOLD, fontSize = 14.sp, style = serifBold)
        for (row in 0 until (capacity + 7) / 8) {
            Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                for (c in 0 until 8) {
                    val item = items.getOrNull(row * 8 + c)
                    ItemIcon(item, assets, 36.dp, selected = item != null && item === selected,
                        upgrade = item != null && game.isUpgrade(item)) { onSelect(item) }
                }
            }
        }
    }
}

@Composable
private fun StashScreen(game: Game, assets: Assets, onClose: () -> Unit) {
    val p = game.player
    var selected by remember { mutableStateOf<Item?>(null) }
    var refresh by remember { mutableIntStateOf(0) }
    refresh.let { }
    DarkPanel("Din kiste", onClose) {
        Text("Det du lægger her, er i sikkerhed.", color = parchment.copy(alpha = 0.8f), fontSize = 13.sp, fontFamily = FontFamily.Serif)
        StashGrid(game, assets, "🗝 Kisten", game.stash, STASH_SIZE, selected) { selected = it }
        StashGrid(game, assets, "🎒 Tasken", p.inventory, INVENTORY_SIZE, selected) { selected = it }
        selected?.let { item ->
            val inStash = item in game.stash
            ItemDetail(item, p.equipment[item.slot])
            if (inStash) {
                GothicButton("Tag med", {
                    if (game.fromStash(item)) selected = null
                    refresh++
                }, enabled = p.inventory.size < INVENTORY_SIZE)
            } else if (item in p.inventory) {
                GothicButton("Læg i kisten", {
                    if (game.toStash(item)) selected = null
                    refresh++
                }, enabled = game.stash.size < STASH_SIZE)
            }
        }
    }
}

@Composable
private fun ShopScreen(game: Game, assets: Assets, tick: Int, onClose: () -> Unit) {
    tick.let { }
    val p = game.player
    var tab by remember { mutableIntStateOf(0) }
    var lastGamble by remember { mutableStateOf<Item?>(null) }
    var refresh by remember { mutableIntStateOf(0) }
    refresh.let { }
    DarkPanel("Købmanden", onClose) {
        Text("\"Hvad må det være, eventyrer?\"", color = parchment, fontFamily = FontFamily.Serif, fontSize = 14.sp)
        Text("Du har 🪙 ${p.gold}", color = GOLD, fontSize = 15.sp, fontWeight = FontWeight.Bold)
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            GothicButton("Køb", { tab = 0 }, wide = false, enabled = tab != 0)
            GothicButton("Sælg", { tab = 1 }, wide = false, enabled = tab != 1)
            GothicButton("🎲 Hasard", { tab = 2 }, wide = false, enabled = tab != 2)
        }
        if (tab == 2) {
            Text(
                "Køb en ukendt genstand. Måske skrald… måske legendarisk!",
                color = parchment.copy(alpha = 0.8f), fontSize = 13.sp, textAlign = TextAlign.Center, modifier = Modifier.width(300.dp),
            )
            Text("Pris: ${game.gamblePrice()} 🪙 pr. genstand", color = GOLD, fontSize = 14.sp, fontWeight = FontWeight.Bold)
            for (row in Slot.entries.chunked(2)) {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    for (slot in row) {
                        GothicButton(slot.label, {
                            lastGamble = game.gamble(slot)
                            refresh++
                        }, wide = false, enabled = p.gold >= game.gamblePrice() && p.inventory.size < INVENTORY_SIZE)
                    }
                }
            }
            lastGamble?.let { item ->
                Text("Du fik:", color = parchment, fontSize = 13.sp)
                Row(verticalAlignment = Alignment.CenterVertically) {
                    ItemIcon(item, assets, 56.dp, upgrade = game.isUpgrade(item))
                    Spacer(Modifier.width(8.dp))
                    ItemDetail(item, p.equipment[item.slot])
                }
            }
        } else if (tab == 0) {
            ShopRow(assets, null, "Livseliksir", "Helbreder halvdelen af dit liv", "${game.potionPrice} 🪙", p.gold >= game.potionPrice) {
                game.buyPotion(); refresh++
            }
            for (item in game.stock.toList()) {
                ShopRow(assets, item, item.name, item.statLine(), "${item.buyPrice} 🪙", p.gold >= item.buyPrice && p.inventory.size < INVENTORY_SIZE,
                    upgrade = game.isUpgrade(item)) { game.buy(item); refresh++ }
            }
        } else {
            if (p.inventory.isEmpty()) Text("Din taske er tom", color = Color.Gray, fontSize = 13.sp)
            for (item in p.inventory.toList()) {
                ShopRow(assets, item, item.name, item.statLine(), "+${item.sellPrice} 🪙", true, upgrade = game.isUpgrade(item), action = "Sælg") {
                    game.sell(item); refresh++
                }
            }
        }
    }
}

@Composable
private fun ShopRow(
    assets: Assets, item: Item?, name: String, desc: String, price: String, enabled: Boolean,
    upgrade: Boolean = false, action: String = "Køb", onClick: () -> Unit,
) {
    Row(
        Modifier.width(320.dp).background(Color(0x44000000), RoundedCornerShape(8.dp)).padding(6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (item != null) {
            ItemIcon(item, assets, 48.dp, upgrade = upgrade)
        } else {
            Box(Modifier.size(48.dp), contentAlignment = Alignment.Center) {
                Canvas(Modifier.fillMaxSize()) { drawIcon(assets, Icons.POTION, size.width / 2f, size.height / 2f, size.width) }
            }
        }
        Spacer(Modifier.width(8.dp))
        Column(Modifier.weight(1f)) {
            Text(name, color = item?.rarity?.color ?: Color(0xFFFF8A80), fontSize = 14.sp, style = serifBold)
            Text(desc, color = parchment.copy(alpha = 0.8f), fontSize = 11.sp)
            Text(price, color = GOLD, fontSize = 12.sp, fontWeight = FontWeight.Bold)
        }
        GothicButton(action, onClick, wide = false, enabled = enabled)
    }
}

@Composable
private fun BoxScope.Backdrop() {
    Box(Modifier.matchParentSizeCompat().background(Brush.verticalGradient(listOf(Color(0xCC000000), Color(0x88200606), Color(0xEE000000)))))
}

private fun Modifier.matchParentSizeCompat() = this.fillMaxSize()

@Composable
private fun TitleScreen(game: Game, onContinue: () -> Unit, onNew: () -> Unit) {
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Backdrop()
        Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(16.dp)) {
            Text(
                "SKYGGERNES\nDYB",
                textAlign = TextAlign.Center,
                style = TextStyle(
                    color = Color(0xFFE0B25A), fontSize = 50.sp, lineHeight = 54.sp, fontFamily = FontFamily.Serif,
                    fontWeight = FontWeight.Black, shadow = Shadow(Color(0xFFFF3D00), Offset(0f, 0f), 28f),
                ),
            )
            Text("Stig ned i mørket. Find skattene. Overlev.", color = parchment.copy(alpha = 0.8f), fontFamily = FontFamily.Serif, fontSize = 15.sp)
            Spacer(Modifier.height(10.dp))
            if (game.hasSave) GothicButton("Fortsæt — niveau ${game.player.level}, dybde ${game.deepest}", onContinue)
            GothicButton("Nyt eventyr", onNew)
            Spacer(Modifier.height(6.dp))
            Text(
                "Joystick: gå · ⚔️ hold for at angribe · 💨 undvig\n🔥 ildkugle · 🌀 hvirvelslag · ❄️ frostnova · ⚡ kædelyn\n🧪 eliksir · 🎒 udstyr · ✨ færdigheder · 📜 opgaver · 🏕️ hjem",
                color = Color.White.copy(alpha = 0.65f), fontSize = 13.sp, textAlign = TextAlign.Center,
            )
        }
    }
}

@Composable
private fun DeathScreen(onRespawn: () -> Unit) {
    Box(Modifier.fillMaxSize().background(Color(0xAA200000)), contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(14.dp)) {
            Text("DU ER FALDET", color = Color(0xFFD32F2F), fontSize = 38.sp, style = serifBold.copy(fontWeight = FontWeight.Black))
            Text("Mørket tog dig denne gang.", color = parchment, fontFamily = FontFamily.Serif)
            GothicButton("Vågn op i lejren (−20% guld)", onRespawn)
        }
    }
}

@Composable
private fun VictoryScreen(game: Game, onContinue: () -> Unit) {
    Box(Modifier.fillMaxSize().background(Color(0xCC000000)), contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(14.dp), modifier = Modifier.padding(24.dp)) {
            Text("MØRKET ER BRUDT", color = GOLD, fontSize = 34.sp, textAlign = TextAlign.Center,
                style = serifBold.copy(fontWeight = FontWeight.Black, shadow = Shadow(Color(0xFFFFD54F), Offset.Zero, 24f)))
            Text(
                "Skyggekongen er faldet, og lyset vender tilbage til landet. Sangene om din bedrift vil blive sunget i generationer.",
                color = parchment, fontFamily = FontFamily.Serif, fontSize = 15.sp, textAlign = TextAlign.Center,
            )
            Text("Niveau ${game.player.level} · ${game.player.gold} guld", color = GOLD, fontSize = 15.sp)
            Text("Dybet fortsætter dog… og monstrene bliver kun stærkere.", color = Color.Gray, fontSize = 13.sp, textAlign = TextAlign.Center)
            GothicButton("Fortsæt eventyret", onContinue)
        }
    }
}

@Composable
private fun MapScreen(game: Game, onClose: () -> Unit) {
    Box(Modifier.fillMaxSize().background(Color(0xE6000000)).systemBarsPadding().clickable(onClick = onClose), contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text(game.areaTitle, color = GOLD, fontSize = 22.sp, style = serifBold)
            Canvas(
                Modifier.size(340.dp).background(Color(0xFF14100D), RoundedCornerShape(8.dp)).border(2.dp, bronze, RoundedCornerShape(8.dp)).padding(6.dp)
            ) {
                val d = game.dungeon
                val cell = size.width / max(d.w, d.h)
                for (y in 0 until d.h) for (x in 0 until d.w) {
                    val i = y * d.w + x
                    if (!game.explored[i]) continue
                    val color = when (d.tiles[i]) {
                        WALL -> if (game.inWorld) Color(0xFF8D6E63) else Color(0xFF3A332D)
                        STAIRS, ENTRANCE -> Color(0xFF4FC3F7)
                        TREE -> Color(0xFF2E5E1E)
                        ROCK -> Color(0xFF7A7570)
                        WATER -> Color(0xFF2B6C8F)
                        BLOCK -> Color(0xFF6D4C41)
                        else -> if (game.inWorld) Color(0xFF5E7A3A) else Color(0xFF7A6E64)
                    }
                    drawRect(color, Offset(x * cell, y * cell), Size(cell + 0.6f, cell + 0.6f))
                }
                for (e in d.entrances) {
                    drawCircle(if (e.region == Region.HELL) Color(0xFFFF3D00) else Color(0xFF4FC3F7), cell * 2.2f, Offset((e.x + 0.5f) * cell, (e.y + 0.5f) * cell))
                }
                for (pr in d.props) {
                    val i = floorInt(pr.y) * d.w + floorInt(pr.x)
                    if (i !in game.explored.indices || !game.explored[i]) continue
                    when {
                        pr.type == PropType.CHEST && !pr.used -> drawCircle(GOLD, cell * 1.2f, Offset(pr.x * cell, pr.y * cell))
                        pr.type == PropType.SHRINE && !pr.used -> drawCircle(Color(0xFF00E5FF), cell * 1.2f, Offset(pr.x * cell, pr.y * cell))
                        else -> {}
                    }
                }
                if (!game.inWorld && game.explored[d.exit.cy * d.w + d.exit.cx]) {
                    drawCircle(Color(0xFF4FC3F7), cell * 1.8f, Offset((d.exit.cx + 0.5f) * cell, (d.exit.cy + 0.5f) * cell))
                }
                for (e in game.enemies) {
                    val i = floorInt(e.y) * d.w + floorInt(e.x)
                    if (i in game.explored.indices && game.explored[i] && (e.type.boss || e.elite)) {
                        drawCircle(if (e.type.boss) Color(0xFFFF1744) else Color(0xFF64B5F6), cell * 1.8f, Offset(e.x * cell, e.y * cell))
                    }
                }
                drawCircle(Color.White, cell * 2.2f, Offset(game.player.x * cell, game.player.y * cell))
                drawCircle(GOLD, cell * 1.5f, Offset(game.player.x * cell, game.player.y * cell))
            }
            Text(
                buildAnnotatedString {
                    for ((label, color) in listOf(
                        "dig" to GOLD, "indgang/trappe" to Color(0xFF4FC3F7), "kiste" to GOLD,
                        "helligdom" to Color(0xFF00E5FF), "boss" to Color(0xFFFF1744),
                    )) {
                        withStyle(SpanStyle(color = color)) { append("● ") }
                        append(label)
                        append("   ")
                    }
                },
                color = parchment.copy(alpha = 0.7f), fontSize = 12.sp,
            )
            Text("Tryk for at lukke", color = Color.Gray, fontSize = 12.sp)
        }
    }
}

@Composable
private fun SmithScreen(game: Game, assets: Assets, tick: Int, onClose: () -> Unit) {
    tick.let { }
    val p = game.player
    var selected by remember { mutableStateOf<Item?>(null) }
    var refresh by remember { mutableIntStateOf(0) }
    refresh.let { }
    DarkPanel("Smeden", onClose) {
        Text("\"Vis mig dit grej. Jeg kan smede det om eller gøre det stærkere.\"", color = parchment, fontFamily = FontFamily.Serif, fontSize = 14.sp,
            textAlign = TextAlign.Center, modifier = Modifier.width(300.dp))
        Text("Du har 🪙 ${p.gold}", color = GOLD, fontSize = 15.sp, fontWeight = FontWeight.Bold)
        Text("Udrustning", color = parchment, fontSize = 14.sp, style = serifBold)
        for (row in Slot.entries.chunked(4)) {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                for (slot in row) {
                    val item = p.equipment[slot]
                    ItemIcon(item, assets, 58.dp, selected = item != null && item === selected, placeholder = slot.label) { selected = item }
                }
            }
        }
        if (p.inventory.isNotEmpty()) Text("Taske", color = parchment, fontSize = 14.sp, style = serifBold)
        for (row in p.inventory.chunked(6)) {
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                for (item in row) ItemIcon(item, assets, 44.dp, selected = item === selected, upgrade = game.isUpgrade(item)) { selected = item }
            }
        }
        selected?.let { item ->
            ItemDetail(item, null)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                GothicButton("Smed om (${game.reforgePrice(item)} 🪙)", {
                    game.reforge(item)?.let { selected = it }
                    refresh++
                }, wide = false, enabled = p.gold >= game.reforgePrice(item))
                GothicButton("Forbedr (${game.upgradePrice(item)} 🪙)", {
                    game.upgrade(item)?.let { selected = it }
                    refresh++
                }, wide = false, enabled = p.gold >= game.upgradePrice(item) && game.canUpgrade(item))
            }
            Text("Smed om: nye tilfældige egenskaber, samme sjældenhed.\nForbedr: +2 niveau og 15% stærkere egenskaber.",
                color = Color.Gray, fontSize = 11.sp, textAlign = TextAlign.Center)
        } ?: Text("Vælg en genstand", color = Color.Gray, fontSize = 13.sp)
    }
}

@Composable
private fun ElderScreen(game: Game, tick: Int, onClose: () -> Unit) {
    tick.let { }
    var reward by remember { mutableStateOf<Item?>(null) }
    var refresh by remember { mutableIntStateOf(0) }
    refresh.let { }
    DarkPanel("Den Ældste", onClose) {
        val b = game.bounty
        when {
            b != null && b.done -> {
                Text("\"Du har holdt dit ord. Her er din løn.\"", color = parchment, fontFamily = FontFamily.Serif, fontSize = 14.sp)
                GothicButton("Modtag ${b.gold} 🪙 + ${b.rarity.label.lowercase()} genstand", {
                    reward = game.claimBounty()
                    refresh++
                })
            }
            b != null -> {
                Text("\"Kom tilbage, når arbejdet er gjort.\"", color = parchment, fontFamily = FontFamily.Serif, fontSize = 14.sp)
                Text("Dræb ${b.need} ${b.type.label.lowercase()}: ${b.got}/${b.need}", color = GOLD, fontSize = 16.sp, style = serifBold)
                Text("Belønning: ${b.gold} 🪙 og en ${b.rarity.label.lowercase()} genstand", color = b.rarity.color, fontSize = 13.sp)
                GothicButton("Opgiv dusøren", { game.abandonBounty(); refresh++ }, wide = false)
            }
            else -> {
                Text("\"Landet er fuld af farer. Hjælp os, og du skal blive belønnet.\"", color = parchment, fontFamily = FontFamily.Serif,
                    fontSize = 14.sp, textAlign = TextAlign.Center, modifier = Modifier.width(300.dp))
                for (offer in game.bountyOffers.toList()) {
                    Row(
                        Modifier.width(310.dp).background(Color(0x44000000), RoundedCornerShape(8.dp)).padding(8.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Column(Modifier.weight(1f)) {
                            Text("Dræb ${offer.need} ${offer.type.label.lowercase()}", color = parchment, fontSize = 15.sp, style = serifBold)
                            Text("${offer.gold} 🪙 + ${offer.rarity.label.lowercase()} genstand", color = offer.rarity.color, fontSize = 12.sp)
                        }
                        GothicButton("Tag", { game.acceptBounty(offer); refresh++ }, wide = false)
                    }
                }
            }
        }
        reward?.let { item ->
            Text("Du fik:", color = parchment, fontSize = 13.sp)
            ItemDetail(item, game.player.equipment[item.slot])
        }
    }
}

@Composable
private fun SettingsScreen(music: Music, sfx: Sfx, settings: android.content.SharedPreferences, onClose: () -> Unit) {
    var musicOn by remember { mutableStateOf(music.enabled) }
    var sfxOn by remember { mutableStateOf(sfx.enabled) }
    DarkPanel("Indstillinger", onClose) {
        GothicButton(if (musicOn) "🎵 Musik: til" else "🎵 Musik: fra", {
            musicOn = !musicOn
            music.enabled = musicOn
            settings.edit().putBoolean("music", musicOn).apply()
        })
        GothicButton(if (sfxOn) "🔊 Lydeffekter: til" else "🔇 Lydeffekter: fra", {
            sfxOn = !sfxOn
            sfx.enabled = sfxOn
            settings.edit().putBoolean("sfx", sfxOn).apply()
        })
        Text("Spillet gemmes automatisk.", color = Color.Gray, fontSize = 12.sp)
    }
}
