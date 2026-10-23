package com.baldissera.rpg

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.detectTransformGestures
import androidx.compose.foundation.gestures.waitForUpOrCancellation
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.shape.CutCornerShape
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.text.style.TextOverflow
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
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.key
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.compose.ui.viewinterop.AndroidView
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
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.graphics.FilterQuality
import kotlin.math.roundToInt
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.text.font.Font
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.material3.LocalTextStyle
import androidx.compose.runtime.CompositionLocalProvider
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
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.max
import kotlin.math.sin

private val panel = Color(0xCC120D0B)
private val bronze = Color(0xFF8C6A3F)
private val parchment = Color(0xFFE8D9B5)
private val textShadow = Shadow(Color.Black, Offset(2f, 2f), 4f)
/** Cinzel for titles, names and buttons; Alegreya Sans for everything else. Both are SIL OFL fonts (see rpg/third_party/fonts). */
val Cinzel = FontFamily(Font(R.font.cinzel_bold, FontWeight.Bold), Font(R.font.cinzel_black, FontWeight.Black))
val Alegreya = FontFamily(Font(R.font.alegreya_sans_medium, FontWeight.Medium), Font(R.font.alegreya_sans_bold, FontWeight.Bold))
private val serifBold = TextStyle(fontFamily = Cinzel, fontWeight = FontWeight.Bold, shadow = textShadow)
private val titleStyle = TextStyle(fontFamily = Cinzel, fontWeight = FontWeight.Black, shadow = textShadow)

/** The sound player, for button clicks anywhere in the menus. */
private var uiSfx: Sfx? = null

private enum class Overlay { NONE, INVENTORY, SKILLS, QUESTS, SHOP, MAP, SMITH, ELDER, SETTINGS, STASH }

@Composable
fun RpgScreen(
    game: Game, assets: Assets, music: Music, sfx: Sfx, settings: android.content.SharedPreferences,
    autoStart: Boolean = false, debugOverlay: Int = -1, animate: Boolean = true, debugChooseClass: Boolean = false,
) {
    var frame by remember { mutableLongStateOf(0L) }
    // Bumped only on frames the scene canvas below has something to draw, so it is not redrawn every frame under the 3D view.
    var sceneTick by remember { mutableLongStateOf(0L) }
    var hudTick by remember { mutableIntStateOf(0) }
    var started by remember { mutableStateOf(autoStart) }
    var choosing by remember { mutableStateOf(debugChooseClass) }
    uiSfx = sfx
    var overlay by remember { mutableStateOf(if (debugOverlay >= 0) Overlay.entries[debugOverlay] else Overlay.NONE) }

    // The 3D third-person view (a WebView under the HUD) unless the player chose the classic 2D view.
    // Screenshot tests run without the frame loop and keep to the 2D renderer.
    val context = LocalContext.current
    var use3d by remember { mutableStateOf(animate && settings.getBoolean("render3d", true)) }
    remember { game.camFollow = settings.getBoolean("camFollow", true) }
    var quality3d by remember { mutableStateOf(settings.getString("quality3d", "high") ?: "high") }
    var failed3d by remember { mutableStateOf<String?>(null) }
    val scene3d = remember(use3d, quality3d) {
        if (use3d) Scene3D(context, quality3d) {
            failed3d = it
            game.camYaw = 0f
        } else null
    }
    DisposableEffect(scene3d) { onDispose { scene3d?.destroy() } }
    // The WebView stops its rendering while the activity is paused and picks up again on resume.
    @Suppress("DEPRECATION")
    val lifecycleOwner = LocalLifecycleOwner.current
    DisposableEffect(lifecycleOwner, scene3d) {
        val s3d = scene3d
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_PAUSE) s3d?.pause()
            else if (event == Lifecycle.Event.ON_RESUME) s3d?.resume()
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose { lifecycleOwner.lifecycle.removeObserver(observer) }
    }
    val live3d = rememberUpdatedState(if (failed3d == null) scene3d else null)

    LaunchedEffect(Unit) {
        if (!animate) return@LaunchedEffect
        var last = withFrameNanos { it }
        var n = 0
        var canvasDrew = true
        // One callback for every frame instead of a new lambda each time round the loop.
        val onFrame: (Long) -> Unit = { now ->
            val dt = ((now - last) / 1_000_000_000f).coerceAtMost(0.05f)
            last = now
            val s3d = live3d.value
            val shown3d = s3d != null && s3d.ready && !s3d.failed
            game.render3d = shown3d
            if (s3d != null) game.steer()
            if (started && overlay == Overlay.NONE) game.update(dt)
            s3d?.push(game)
            if (started) music.play(game.musicTrack)
            music.tick(dt)
            // The scene canvas draws the 2D scene until the 3D view is up, and the fade from black over either.
            // Once neither shows it is redrawn one last time, empty, and then left alone.
            val canvasDraws = !shown3d || game.fade > 0f
            if (canvasDraws || canvasDrew) sceneTick++
            canvasDrew = canvasDraws
            // Only the title screen's embers animate by frame count.
            if (!started) frame++
            if (++n % 5 == 0) hudTick++
        }
        while (true) withFrameNanos(onFrame)
    }

    val measurer = rememberTextMeasurer()
    val styles = remember {
        TextStyles(
            small = TextStyle(fontFamily = Alegreya, fontSize = 16.sp, fontWeight = FontWeight.Bold, shadow = textShadow),
            big = TextStyle(fontFamily = Cinzel, fontSize = 22.sp, fontWeight = FontWeight.Black, shadow = textShadow),
            label = TextStyle(fontFamily = Alegreya, fontSize = 12.sp, fontWeight = FontWeight.Bold),
        )
    }

    CompositionLocalProvider(LocalTextStyle provides TextStyle(fontFamily = Alegreya, fontWeight = FontWeight.Medium)) {
    Box(Modifier.fillMaxSize().background(Color.Black)) {
        val view3d = if (failed3d == null) scene3d else null
        if (view3d != null) key(view3d) { AndroidView(factory = { view3d.view }, modifier = Modifier.fillMaxSize()) }
        Canvas(Modifier.fillMaxSize()) {
            sceneTick.let { }
            // Until the 3D view has loaded its models, the 2D renderer fills in.
            if (view3d == null || !view3d.ready) drawScene(game, assets, measurer, styles)
            if (game.fade > 0f) drawRect(Color.Black.copy(alpha = game.fade * game.fade))
        }
        if (view3d != null && started && overlay == Overlay.NONE) CameraDrag(game)

        hudTick.let { }
        if (started) {
            Hud(game, assets, onOpen = { overlay = it })
            Controls(game, Modifier.align(Alignment.BottomCenter))
            if (overlay == Overlay.NONE) {
                val npc = game.nearNpc
                when {
                    game.nearMerchant -> GothicButton("💰 Trade with the merchant", { overlay = Overlay.SHOP }, Modifier.align(Alignment.Center).offset(y = 90.dp))
                    game.nearStash -> GothicButton("🗝 Open your stash", { overlay = Overlay.STASH }, Modifier.align(Alignment.Center).offset(y = 90.dp))
                    npc?.kind == NpcKind.SMITH -> GothicButton("⚒ Talk to the blacksmith", { overlay = Overlay.SMITH }, Modifier.align(Alignment.Center).offset(y = 90.dp))
                    npc?.kind == NpcKind.ELDER -> GothicButton("📜 Talk to the Elder", { overlay = Overlay.ELDER }, Modifier.align(Alignment.Center).offset(y = 90.dp))
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
                    Text("— prepares for battle —", color = parchment.copy(alpha = 0.8f), fontSize = 14.sp, fontFamily = Alegreya)
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
            !started && choosing -> ClassSelectScreen(
                assets,
                onPick = { cls ->
                    game.newGame(cls)
                    choosing = false
                    started = true
                },
                onBack = { choosing = false },
            )
            !started -> TitleScreen(
                game, { frame },
                onContinue = { started = true },
                onNew = { choosing = true },
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
            overlay == Overlay.SETTINGS -> SettingsScreen(
                game, music, sfx, settings,
                graphics = GraphicsChoice(use3d, quality3d == "high", failed3d),
                onGraphics = { on, high ->
                    if (on != use3d) failed3d = null
                    if (!on) game.camYaw = 0f
                    use3d = on
                    quality3d = if (high) "high" else "low"
                    settings.edit().putBoolean("render3d", on).putString("quality3d", quality3d).apply()
                },
                onClose = { overlay = Overlay.NONE },
            )
        }
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
                Text("Level ${p.level} ${p.heroClass.label}", color = GOLD, fontSize = 13.sp, fontWeight = FontWeight.Bold, style = TextStyle(shadow = textShadow))
                Box(
                    Modifier.padding(top = 3.dp).fillMaxWidth(0.85f).height(6.dp)
                        .background(Color(0xAA000000), RoundedCornerShape(3.dp))
                ) {
                    Box(
                        Modifier.fillMaxWidth((p.xp / p.xpToNext.toFloat()).coerceIn(0f, 1f)).height(6.dp)
                            .background(Brush.horizontalGradient(listOf(Color(0xFF7C4DFF), Color(0xFFB388FF))), RoundedCornerShape(3.dp))
                    )
                }
                Text("💰 ${p.gold}", color = GOLD, fontSize = 13.sp, modifier = Modifier.padding(top = 2.dp), style = TextStyle(shadow = textShadow))
                p.buff?.let {
                    Text("${it.label} (${p.buffTime.toInt()}s)", color = it.color, fontSize = 11.sp, style = TextStyle(shadow = textShadow))
                }
                game.bounty?.let { b ->
                    Text(
                        if (b.done) "📜 Bounty done — see the Elder" else "📜 ${b.type.label}: ${b.got}/${b.need}",
                        color = if (b.done) GOLD else parchment, fontSize = 11.sp, style = TextStyle(shadow = textShadow),
                    )
                }
                if (game.streak >= 3) {
                    Text(
                        "×${game.streak} streak", color = if (game.streak >= 5) Color(0xFFFF8A65) else parchment,
                        fontSize = (14 + minOf(game.streak, 12)).sp, style = titleStyle,
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
                .clickable { uiSfx?.click(); onClick() }
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

/** The explored part of the area as one pixel per tile, rebuilt only when more of it is revealed. */
private object MapCache {
    var dungeon: Dungeon? = null
    var version = -1
    var image: ImageBitmap? = null
}

private fun mapImage(game: Game): ImageBitmap {
    val d = game.dungeon
    MapCache.image?.let { if (MapCache.dungeon === d && MapCache.version == game.exploredVersion) return it }
    val px = IntArray(d.w * d.h)
    for (i in px.indices) {
        if (!game.explored[i]) continue
        px[i] = when (d.tiles[i]) {
            WALL -> if (game.inWorld) 0xFF8D6E63.toInt() else 0xFF3A332D.toInt()
            STAIRS, ENTRANCE -> 0xFF4FC3F7.toInt()
            TREE -> 0xFF2E5E1E.toInt()
            ROCK -> 0xFF7A7570.toInt()
            WATER -> 0xFF2B6C8F.toInt()
            BLOCK -> 0xFF6D4C41.toInt()
            else -> if (game.inWorld) 0xFF5E7A3A.toInt() else 0xFF7A6E64.toInt()
        }
    }
    val image = android.graphics.Bitmap.createBitmap(px, d.w, d.h, android.graphics.Bitmap.Config.ARGB_8888).asImageBitmap()
    MapCache.dungeon = d
    MapCache.version = game.exploredVersion
    MapCache.image = image
    return image
}

@Composable
private fun Minimap(game: Game) {
    Canvas(
        Modifier.size(104.dp).background(Color(0xEB100C0A), RoundedCornerShape(8.dp)).border(1.dp, bronze, RoundedCornerShape(8.dp)).padding(4.dp)
    ) {
        val d = game.dungeon
        val cell = size.width / max(d.w, d.h)
        drawImage(
            mapImage(game), IntOffset.Zero, IntSize(d.w, d.h), IntOffset.Zero,
            IntSize((d.w * cell).roundToInt(), (d.h * cell).roundToInt()), filterQuality = FilterQuality.None,
        )
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
                game.player.heroClass.attackIcon, Color(0xFFB0BEC5), 96.dp, Modifier.at(attackC, 96f),
                onPress = {
                    game.attackHeld = true
                    game.attack()
                },
                onRelease = { game.attackHeld = false },
            )
            // The four loadout skills (chosen in the skill tree) on an arc around the attack button.
            treeVersion.intValue.let { }
            val p = game.player
            for (i in 0 until LOADOUT_SIZE) {
                val a = Math.toRadians(SKILL_ANGLES[i].toDouble())
                val c = Offset(attackC.x + cos(a).toFloat() * 104f, attackC.y + sin(a).toFloat() * 104f)
                val s = p.loadout[i]
                // Keyed by skill and rank, so a re-equipped or newly learned button is built afresh, press handler included.
                key(i, s, if (s != null) p.skills[s] ?: 0 else -1) {
                    if (s != null) SkillButton(game, s, Modifier.at(c, 58f)) else EmptySkillSlot(Modifier.at(c, 58f))
                }
            }
        }
    }
}

/** Where the four skill buttons sit on the arc around the attack button, in degrees. */
private val SKILL_ANGLES = floatArrayOf(280f, 245f, 210f, 175f)

/** Bumped whenever the skill tree changes, so the HUD's skill buttons pick up new ranks and loadout changes. */
private val treeVersion = mutableIntStateOf(0)

/** A skill button with nothing equipped on it. */
@Composable
private fun EmptySkillSlot(modifier: Modifier) {
    Box(
        modifier.size(58.dp).background(Color(0x66120D0B), CircleShape).border(1.dp, bronze.copy(alpha = 0.5f), CircleShape),
        contentAlignment = Alignment.Center,
    ) {
        Text("+", color = parchment.copy(alpha = 0.4f), fontSize = 20.sp)
    }
}

/** Graphics settings as the settings screen shows them. */
private class GraphicsChoice(val use3d: Boolean, val high: Boolean, val error: String?)

/** Swipes on the open screen turn the 3D camera around the hero and tilt it; a pinch zooms. */
@Composable
private fun CameraDrag(game: Game) {
    Box(
        Modifier.fillMaxSize().pointerInput(Unit) {
            detectTransformGestures { _, pan, zoom, _ ->
                var yaw = game.camYaw - pan.x * 0.0065f
                if (yaw > PI.toFloat()) yaw -= 2f * PI.toFloat()
                if (yaw < -PI.toFloat()) yaw += 2f * PI.toFloat()
                game.camYaw = yaw
                if (abs(pan.x) > 0.5f) game.camManualHold = 2.5f
                game.camPitch = (game.camPitch + pan.y * 0.004f).coerceIn(0.2f, 1.2f)
                game.camDist = (game.camDist / zoom).coerceIn(3.5f, 11f)
            }
        }
    )
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
                    game.stickX = v.x / reach
                    game.stickY = v.y / reach
                    game.steer()
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
                game.stickX = 0f
                game.stickY = 0f
                game.steer()
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
            .clickable(enabled = enabled) {
                uiSfx?.click()
                onClick()
            }
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
        Text("${item.rarity.label} ${item.slot.label.lowercase()} · level ${item.level}", color = parchment.copy(alpha = 0.7f), fontSize = 12.sp)
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
    DarkPanel("Hero", onClose) {
        Row(Modifier.width(310.dp)) {
            Column(Modifier.weight(1f)) {
                StatLine("Level", "${p.level}")
                StatLine("Life", "${p.hp.toInt()}/${p.maxHp.toInt()}")
                StatLine("Mana", "${p.mana.toInt()}/${p.maxMana.toInt()}")
                StatLine("Damage", "${p.damage}")
            }
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                StatLine("Armor", "${p.armorValue}")
                StatLine("Critical", "${p.critChance}%")
                StatLine("Life steal", "${p.lifeSteal}%")
                StatLine("Spell", "+${p.spellBonus}%")
                StatLine("Attack speed", "+${p.attackSpeed}%")
                StatLine("Gold find", "+${p.goldFind}%")
                StatLine("Gold", "${p.gold}")
            }
        }
        Text("Equipment", color = parchment, fontSize = 15.sp, style = serifBold)
        Text("Weapon: ${p.weaponKind.label} — ${p.weaponKind.blurb}", color = Color(0xFFB0BEC5), fontSize = 12.sp)
        for (row in Slot.entries.chunked(4)) {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                for (slot in row) {
                    val item = p.equipment[slot]
                    ItemIcon(item, assets, 62.dp, selected = item != null && item === selected, placeholder = slot.label) { selected = item }
                }
            }
        }
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("Bag (${p.inventory.size}/$INVENTORY_SIZE)", color = parchment, fontSize = 15.sp, style = serifBold)
            SmallButton("Sort") { game.sortInventory(); selected = null }
            SmallButton("Sell junk") { game.sellJunk(); selected = null }
        }
        if (p.inventory.isEmpty()) Text("Empty — slay monsters and open chests", color = Color.Gray, fontSize = 13.sp)
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
                    GothicButton("Equip", { game.equip(item); selected = item }, wide = false)
                    GothicButton("Sell (${item.sellPrice} 💰)", { game.sell(item); selected = null }, wide = false)
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
        Text("Rarity", color = parchment.copy(alpha = 0.6f), fontSize = 11.sp)
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

// ---------------------------------------------------------------- skill tree

/** Fixed sizes of the tree, so the connecting lines are drawn from the same arithmetic as the layout. */
private val NODE_H = 62.dp
private val NODE_GAP = 8.dp
private val TIER_GAP = 16.dp
private val TIER_GUTTER = 40.dp

private enum class NodeLook { LOCKED, OPEN, LEARNED, MAXED }

private fun nodeLook(p: Player, node: TreeNode): NodeLook {
    val rank = node.rank(p)
    return when {
        rank >= node.maxRank -> NodeLook.MAXED
        rank > 0 -> NodeLook.LEARNED
        node.unlocked(p) -> NodeLook.OPEN
        else -> NodeLook.LOCKED
    }
}

/** The skill tree: three branches of skills and talents across five tiers, with the chosen node's details beside or below. */
@Composable
private fun SkillsScreen(game: Game, tick: Int, onClose: () -> Unit) {
    tick.let { }
    val p = game.player
    val tree = SkillTree.of(p.heroClass)
    var refresh by remember { mutableIntStateOf(0) }
    refresh.let { }
    // Opens on something worth a point, a skill if possible.
    var selected by remember {
        mutableStateOf(
            tree.nodes.firstOrNull { it.skill != null && game.canLearn(it) } ?: tree.nodes.firstOrNull { game.canLearn(it) }
                ?: tree.node(p.heroClass.skills[0])
        )
    }
    var confirmReset by remember { mutableStateOf(false) }
    fun changed() {
        refresh++
        treeVersion.intValue++
    }
    val version = refresh + tick
    BoxWithConstraints(Modifier.fillMaxSize().background(Color(0xCC000000)).systemBarsPadding()) {
        val wide = maxWidth > maxHeight && maxWidth >= 560.dp
        Column(
            Modifier.fillMaxSize().padding(6.dp)
                .background(Brush.verticalGradient(listOf(Color(0xF51E1511), Color(0xF50E0A08))), RoundedCornerShape(12.dp))
                .border(2.dp, bronze, RoundedCornerShape(12.dp))
                .padding(horizontal = 10.dp, vertical = 8.dp),
        ) {
            // Header: free points, the reset and the close button.
            Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth()) {
                Column(Modifier.weight(1f)) {
                    Text("Skill Tree", color = GOLD, fontSize = 20.sp, style = serifBold)
                    Text("${p.heroClass.label} · level ${p.level}", color = parchment.copy(alpha = 0.7f), fontSize = 11.sp)
                }
                val hasPoints = p.skillPoints > 0
                Column(
                    Modifier.background(if (hasPoints) Color(0x44FFC94D) else Color(0x33000000), RoundedCornerShape(8.dp))
                        .border(1.dp, if (hasPoints) GOLD else bronze, RoundedCornerShape(8.dp))
                        .padding(horizontal = 10.dp, vertical = 2.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    Text("✨ ${p.skillPoints}", color = if (hasPoints) GOLD else parchment, fontSize = 16.sp, style = serifBold)
                    Text(if (p.skillPoints == 1) "point" else "points", color = parchment.copy(alpha = 0.7f), fontSize = 9.sp)
                }
                Spacer(Modifier.width(6.dp))
                val spent = game.spentPoints()
                TreeButton(
                    if (confirmReset) "Sure? ${game.resetPrice} 💰" else "↺ Reset\n${game.resetPrice} 💰",
                    enabled = spent > 0 && p.gold >= game.resetPrice,
                ) {
                    if (!confirmReset) {
                        confirmReset = true
                    } else {
                        game.resetSkills()
                        confirmReset = false
                        changed()
                    }
                }
                Text("✕", color = parchment, fontSize = 22.sp, modifier = Modifier.clickable(onClick = onClose).padding(start = 8.dp, end = 2.dp, top = 4.dp, bottom = 4.dp))
            }
            Text(
                "1 point every level · +1 bonus every 5th level · +1 for each boss's first defeat",
                color = Color.Gray, fontSize = 10.sp, modifier = Modifier.padding(top = 2.dp, bottom = 6.dp),
            )
            val onSelect: (TreeNode) -> Unit = {
                selected = it
                confirmReset = false
            }
            if (wide) {
                Row(Modifier.fillMaxWidth().weight(1f), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    TreeView(game, tree, selected, version, onSelect, Modifier.weight(1.3f).fillMaxHeight())
                    Column(Modifier.weight(1f).fillMaxHeight().verticalScroll(rememberScrollState())) {
                        NodeDetail(game, tree, selected) { changed() }
                    }
                }
            } else {
                TreeView(game, tree, selected, version, onSelect, Modifier.fillMaxWidth().weight(1f))
                Spacer(Modifier.height(6.dp))
                Column(Modifier.fillMaxWidth().heightIn(max = 250.dp).verticalScroll(rememberScrollState())) {
                    NodeDetail(game, tree, selected) { changed() }
                }
            }
        }
    }
}

/** Branch titles above a scrolling grid of tiers. */
@Composable
private fun TreeView(game: Game, tree: ClassTree, selected: TreeNode?, version: Int, onSelect: (TreeNode) -> Unit, modifier: Modifier) {
    val p = game.player
    Column(modifier) {
        Row(Modifier.fillMaxWidth().padding(bottom = 4.dp), verticalAlignment = Alignment.Bottom) {
            Spacer(Modifier.width(TIER_GUTTER))
            tree.branches.forEachIndexed { b, branch ->
                Column(Modifier.weight(1f), horizontalAlignment = Alignment.CenterHorizontally) {
                    Text(branch.icon, fontSize = 15.sp)
                    Text(branch.title, color = branch.color, fontSize = 11.sp, style = serifBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    val points = tree.spent(p, b)
                    Text(if (points == 1) "1 rank" else "$points ranks", color = parchment.copy(alpha = 0.55f), fontSize = 9.sp)
                }
            }
        }
        Box(Modifier.fillMaxWidth().height(1.dp).background(bronze.copy(alpha = 0.6f)))
        Column(Modifier.fillMaxWidth().weight(1f).verticalScroll(rememberScrollState()).padding(vertical = 8.dp)) {
            TreeGrid(game, tree, selected, version, onSelect)
        }
    }
}

/** The tiers as rows (level label on the left, one column per branch), with lines from each node to its children behind. */
@Composable
private fun TreeGrid(game: Game, tree: ClassTree, selected: TreeNode?, version: Int, onSelect: (TreeNode) -> Unit) {
    val p = game.player
    val tiers = SkillTree.TIERS
    val rows = IntArray(tiers) { tree.rows(it) }
    fun rowsHeight(t: Int): Dp = NODE_H * rows[t] + NODE_GAP * (rows[t] - 1)
    var total = 0.dp
    for (t in 0 until tiers) total += rowsHeight(t) + (if (t < tiers - 1) TIER_GAP else 0.dp)
    Box(Modifier.fillMaxWidth().height(total)) {
        Canvas(Modifier.matchParentSize()) {
            version.let { }
            val gutter = TIER_GUTTER.toPx()
            val colW = (size.width - gutter) / tree.branches.size
            val nodeH = NODE_H.toPx()
            val gap = NODE_GAP.toPx()
            val tierGap = TIER_GAP.toPx()
            fun top(tier: Int, slot: Int): Float {
                var y = 0f
                for (k in 0 until tier) y += rows[k] * nodeH + (rows[k] - 1) * gap + tierGap
                return y + slot * (nodeH + gap)
            }
            // Faint rules between the tiers.
            for (t in 1 until tiers) {
                val y = top(t, 0) - tierGap / 2f
                drawLine(bronze.copy(alpha = 0.22f), Offset(0f, y), Offset(size.width, y), strokeWidth = 1.dp.toPx())
            }
            // A line from every node down to each child: lit in the branch colour once the parent has a point.
            for (n in tree.nodes) {
                val par = n.parent ?: continue
                val from = Offset(gutter + (par.branch + 0.5f) * colW, top(par.tier, par.slot) + nodeH)
                val to = Offset(gutter + (n.branch + 0.5f) * colW, top(n.tier, n.slot))
                if (par.rank(p) > 0) {
                    val c = tree.branches[n.branch].color
                    drawLine(c.copy(alpha = 0.22f), from, to, strokeWidth = 8.dp.toPx(), cap = StrokeCap.Round)
                    drawLine(c.copy(alpha = if (n.rank(p) > 0) 0.95f else 0.6f), from, to, strokeWidth = 2.5f.dp.toPx(), cap = StrokeCap.Round)
                } else {
                    drawLine(Color(0x40FFFFFF), from, to, strokeWidth = 2.dp.toPx(), cap = StrokeCap.Round)
                }
            }
        }
        Column(Modifier.fillMaxWidth()) {
            for (t in 0 until tiers) {
                val open = p.level >= TIER_LEVELS[t]
                Row(Modifier.fillMaxWidth().height(rowsHeight(t))) {
                    Column(
                        Modifier.width(TIER_GUTTER).fillMaxHeight(),
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.Center,
                    ) {
                        Text("Level", color = if (open) parchment.copy(alpha = 0.75f) else Color.Gray, fontSize = 9.sp)
                        Text("${TIER_LEVELS[t]}", color = if (open) GOLD else Color.Gray, fontSize = 16.sp, style = serifBold)
                        if (!open) Text("🔒", fontSize = 10.sp)
                    }
                    for (b in tree.branches.indices) {
                        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(NODE_GAP)) {
                            for (n in tree.cell(b, t)) {
                                val s = n.skill
                                NodeCard(
                                    n, n.rank(p), nodeLook(p, n), game.canLearn(n), n === selected,
                                    if (s != null) p.loadout.indexOf(s) else -1,
                                ) { onSelect(n) }
                            }
                        }
                    }
                }
                if (t < tiers - 1) Spacer(Modifier.height(TIER_GAP))
            }
        }
    }
}

/** A node of the tree: icon, name and rank. Actives have rounded corners, talents cut ones; the HUD slot shows top left. */
@Composable
private fun NodeCard(node: TreeNode, rank: Int, look: NodeLook, canLearn: Boolean, selected: Boolean, slot: Int, onClick: () -> Unit) {
    val shape = if (node.skill != null) RoundedCornerShape(10.dp) else CutCornerShape(9.dp)
    val c = node.color
    val fill = when (look) {
        NodeLook.LOCKED -> listOf(Color(0xFF16110E), Color(0xFF0C0907))
        NodeLook.OPEN -> listOf(c.copy(alpha = 0.12f), Color(0xFF0C0907))
        else -> listOf(c.copy(alpha = 0.4f), Color(0xFF140E0B))
    }
    val edge = when {
        selected -> Color.White
        look == NodeLook.MAXED -> GOLD
        look == NodeLook.LEARNED -> c
        look == NodeLook.OPEN -> bronze
        else -> Color(0xFF3A3530)
    }
    Box(
        Modifier.fillMaxWidth().padding(horizontal = 3.dp).height(NODE_H)
            .background(Brush.verticalGradient(fill), shape)
            .border(if (selected) 2.dp else 1.dp, edge, shape)
            .clickable {
                uiSfx?.click()
                onClick()
            },
    ) {
        Column(
            Modifier.fillMaxSize().padding(horizontal = 4.dp, vertical = 3.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center,
        ) {
            Text(node.icon, fontSize = 19.sp, modifier = Modifier.graphicsLayer { alpha = if (look == NodeLook.LOCKED) 0.35f else 1f })
            Text(
                node.label, color = if (look == NodeLook.LOCKED) Color.Gray else if (look == NodeLook.OPEN) parchment else Color.White,
                fontSize = 11.sp, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis, textAlign = TextAlign.Center,
            )
            Text(
                "$rank/${node.maxRank}", color = if (look == NodeLook.MAXED) GOLD else if (rank > 0) c else Color.Gray,
                fontSize = 10.sp, fontWeight = FontWeight.Bold,
            )
        }
        if (canLearn) {
            Text(
                "+", color = Color.Black, fontSize = 11.sp, fontWeight = FontWeight.Black,
                modifier = Modifier.align(Alignment.TopEnd).padding(3.dp).background(GOLD, CircleShape).padding(horizontal = 4.dp),
            )
        } else if (look == NodeLook.LOCKED) {
            Text("🔒", fontSize = 9.sp, modifier = Modifier.align(Alignment.TopEnd).padding(3.dp))
        }
        if (slot >= 0) {
            Text(
                "${slot + 1}", color = Color.Black, fontSize = 9.sp, fontWeight = FontWeight.Black,
                modifier = Modifier.align(Alignment.TopStart).padding(3.dp).background(c, CircleShape).padding(horizontal = 4.dp),
            )
        } else if (node.keystone) {
            Text("★", color = GOLD, fontSize = 10.sp, modifier = Modifier.align(Alignment.TopStart).padding(horizontal = 5.dp, vertical = 2.dp))
        }
    }
}

/** Everything about the chosen node: what each rank does, what it needs, Learn, and for actives the HUD button to put it on. */
@Composable
private fun NodeDetail(game: Game, tree: ClassTree, node: TreeNode?, onChange: () -> Unit) {
    val p = game.player
    if (node == null) {
        Text("Tap a skill or talent to see what it does.", color = parchment.copy(alpha = 0.7f), fontSize = 12.sp)
    } else {
        val rank = node.rank(p)
        val s = node.skill
        Column(
            Modifier.fillMaxWidth().background(Color(0x66000000), RoundedCornerShape(8.dp))
                .border(1.dp, node.color.copy(alpha = 0.7f), RoundedCornerShape(8.dp)).padding(10.dp),
            verticalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(node.icon, fontSize = 28.sp)
                Spacer(Modifier.width(8.dp))
                Column(Modifier.weight(1f)) {
                    Text(node.label, color = node.color, fontSize = 16.sp, style = serifBold)
                    val kind = when {
                        s != null -> "Active skill"
                        node.keystone -> "Keystone talent"
                        else -> "Passive talent"
                    }
                    Text("$kind · ${tree.branches[node.branch].title} · rank $rank/${node.maxRank}", color = parchment.copy(alpha = 0.7f), fontSize = 11.sp)
                }
            }
            Text(if (rank > 0) "Now: ${node.describe(rank)}" else node.describe(1), color = parchment, fontSize = 12.sp)
            if (rank in 1 until node.maxRank) Text("Next rank: ${node.describe(rank + 1)}", color = Color(0xFFB0BEC5), fontSize = 11.sp)
            if (s != null) {
                val cd = if (s.cooldown == s.cooldown.toInt().toFloat()) "${s.cooldown.toInt()}" else "${s.cooldown}"
                Text("Mana ${s.mana.toInt()} · Cooldown $cd s", color = Color(0xFF64B5F6), fontSize = 11.sp)
            }
            val need = node.requirement(p)
            val par = node.parent
            Text(
                need ?: ("Level ${node.levelReq} tier" + (if (par != null) " · after ${par.label}" else "") + " ✓"),
                color = if (need != null) Color(0xFFFF8A65) else Color(0xFF81C784), fontSize = 11.sp,
            )
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                TreeButton(
                    when {
                        rank >= node.maxRank -> "Mastered"
                        rank > 0 -> "Learn rank ${rank + 1} · 1 ✨"
                        else -> "Learn · 1 ✨"
                    },
                    enabled = game.canLearn(node),
                ) { if (game.learnNode(node)) onChange() }
                if (p.skillPoints <= 0 && rank < node.maxRank) {
                    Text("No points left. Level up or slay a new boss.", color = Color.Gray, fontSize = 11.sp, modifier = Modifier.weight(1f))
                }
            }
            if (s != null && rank > 0) {
                Text("Put it on a skill button:", color = parchment.copy(alpha = 0.8f), fontSize = 11.sp)
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    for (i in 0 until LOADOUT_SIZE) {
                        val there = p.loadout[i]
                        val on = there == s
                        Column(
                            Modifier.width(56.dp)
                                .background(if (on) s.color.copy(alpha = 0.3f) else Color(0x44000000), RoundedCornerShape(8.dp))
                                .border(if (on) 2.dp else 1.dp, if (on) s.color else bronze, RoundedCornerShape(8.dp))
                                .clickable {
                                    uiSfx?.click()
                                    game.equipSkill(s, i)
                                    onChange()
                                }
                                .padding(vertical = 4.dp),
                            horizontalAlignment = Alignment.CenterHorizontally,
                        ) {
                            Text("Slot ${i + 1}", color = if (on) Color.White else parchment.copy(alpha = 0.7f), fontSize = 10.sp, fontWeight = FontWeight.Bold)
                            Text(there?.icon ?: "·", fontSize = 18.sp, color = parchment)
                        }
                    }
                }
            } else if (s != null) {
                Text("Learn it to put it on one of your four skill buttons.", color = Color.Gray, fontSize = 11.sp)
            }
        }
    }
}

/** A small version of the gothic button, for the tree's header and details. */
@Composable
private fun TreeButton(label: String, enabled: Boolean = true, onClick: () -> Unit) {
    Box(
        Modifier
            .background(
                Brush.verticalGradient(if (enabled) listOf(Color(0xFF6A1717), Color(0xFF2A0808)) else listOf(Color(0xFF3A3530), Color(0xFF1E1B18))),
                RoundedCornerShape(6.dp),
            )
            .border(1.dp, bronze, RoundedCornerShape(6.dp))
            .clickable(enabled = enabled) {
                uiSfx?.click()
                onClick()
            }
            .padding(horizontal = 10.dp, vertical = 6.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(label, color = if (enabled) parchment else Color.Gray, fontSize = 12.sp, style = serifBold, textAlign = TextAlign.Center)
    }
}

@Composable
private fun QuestScreen(game: Game, onClose: () -> Unit) {
    DarkPanel("Quests", onClose) {
        Text(
            "A darkness rises from the depths beneath the village. Four rulers guard the path to the Shadow King's throne.",
            color = parchment.copy(alpha = 0.85f), fontSize = 13.sp, fontFamily = Alegreya, modifier = Modifier.width(300.dp),
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
                Text("Heart Fragments ${shards % 4}/4", color = HEART, fontSize = 15.sp, style = serifBold)
                Text(
                    "Four fragments grant a new heart (+${HEART_LIFE.toInt()} life). Extra hearts: ${game.player.hearts}. " +
                        "One hides on every depth, and more out in the wilds.",
                    color = parchment.copy(alpha = 0.8f), fontSize = 12.sp,
                )
            }
        }
        Text("Deepest: ${game.deepest}", color = parchment.copy(alpha = 0.6f), fontSize = 12.sp)
    }
}

@Composable
private fun StashGrid(game: Game, assets: Assets, title: String, items: List<Item>, capacity: Int, selected: Item?, onSelect: (Item?) -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text("$title  ${items.size}/$capacity", color = GOLD, fontSize = 14.sp, style = serifBold)
        // Eight 32 dp slots with 3 dp gaps fit the 300 dp panel on the narrowest phones.
        for (row in 0 until (capacity + 7) / 8) {
            Row(horizontalArrangement = Arrangement.spacedBy(3.dp)) {
                for (c in 0 until 8) {
                    val item = items.getOrNull(row * 8 + c)
                    ItemIcon(item, assets, 32.dp, selected = item != null && item === selected,
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
    DarkPanel("Your Stash", onClose) {
        Text("Whatever you leave here stays safe.", color = parchment.copy(alpha = 0.8f), fontSize = 13.sp, fontFamily = Alegreya)
        StashGrid(game, assets, "🗝 Stash", game.stash, STASH_SIZE, selected) { selected = it }
        StashGrid(game, assets, "🎒 Bag", p.inventory, INVENTORY_SIZE, selected) { selected = it }
        selected?.let { item ->
            val inStash = item in game.stash
            ItemDetail(item, p.equipment[item.slot])
            if (inStash) {
                GothicButton("Take", {
                    if (game.fromStash(item)) selected = null
                    refresh++
                }, enabled = p.inventory.size < INVENTORY_SIZE)
            } else if (item in p.inventory) {
                GothicButton("Store", {
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
    DarkPanel("The Merchant", onClose) {
        Text("\"What'll it be, adventurer?\"", color = parchment, fontFamily = Alegreya, fontSize = 14.sp)
        Text("You have 💰 ${p.gold}", color = GOLD, fontSize = 15.sp, fontWeight = FontWeight.Bold)
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            GothicButton("Buy", { tab = 0 }, wide = false, enabled = tab != 0)
            GothicButton("Sell", { tab = 1 }, wide = false, enabled = tab != 1)
            GothicButton("🎲 Gamble", { tab = 2 }, wide = false, enabled = tab != 2)
        }
        if (tab == 2) {
            Text(
                "Buy an unknown item. Maybe junk… maybe legendary!",
                color = parchment.copy(alpha = 0.8f), fontSize = 13.sp, textAlign = TextAlign.Center, modifier = Modifier.width(300.dp),
            )
            Text("Price: ${game.gamblePrice()} 💰 per item", color = GOLD, fontSize = 14.sp, fontWeight = FontWeight.Bold)
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
                Text("You got:", color = parchment, fontSize = 13.sp)
                Row(verticalAlignment = Alignment.CenterVertically) {
                    ItemIcon(item, assets, 56.dp, upgrade = game.isUpgrade(item))
                    Spacer(Modifier.width(8.dp))
                    ItemDetail(item, p.equipment[item.slot])
                }
            }
        } else if (tab == 0) {
            ShopRow(assets, null, "Healing Potion", "Restores half your life", "${game.potionPrice} 💰", p.gold >= game.potionPrice) {
                game.buyPotion(); refresh++
            }
            for (item in game.stock.toList()) {
                ShopRow(assets, item, item.name, item.statLine(), "${item.buyPrice} 💰", p.gold >= item.buyPrice && p.inventory.size < INVENTORY_SIZE,
                    upgrade = game.isUpgrade(item)) { game.buy(item); refresh++ }
            }
        } else {
            if (p.inventory.isEmpty()) Text("Your bag is empty", color = Color.Gray, fontSize = 13.sp)
            for (item in p.inventory.toList()) {
                ShopRow(assets, item, item.name, item.statLine(), "+${item.sellPrice} 💰", true, upgrade = game.isUpgrade(item), action = "Sell") {
                    game.sell(item); refresh++
                }
            }
        }
    }
}

@Composable
private fun ShopRow(
    assets: Assets, item: Item?, name: String, desc: String, price: String, enabled: Boolean,
    upgrade: Boolean = false, action: String = "Buy", onClick: () -> Unit,
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

/** Choose a hero: portraits, strengths and skills of each class. */
@Composable
private fun ClassSelectScreen(assets: Assets, onPick: (HeroClass) -> Unit, onBack: () -> Unit) {
    var selected by remember { mutableStateOf(HeroClass.KNIGHT) }
    Column(
        Modifier.fillMaxSize().background(Brush.verticalGradient(listOf(Color(0xF2100A08), Color(0xFA050303)))).systemBarsPadding(),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Column(
            Modifier.weight(1f).fillMaxWidth().verticalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 12.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Text("‹", color = parchment, fontSize = 30.sp, modifier = Modifier.clickable(onClick = onBack).padding(horizontal = 8.dp))
                Text("CHOOSE YOUR HERO", color = GOLD, fontSize = 22.sp, style = titleStyle, textAlign = TextAlign.Center, modifier = Modifier.weight(1f))
                Spacer(Modifier.width(30.dp))
            }
            for (row in HeroClass.entries.chunked(2)) {
                Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    for (cls in row) {
                        val on = cls == selected
                        Column(
                            Modifier.weight(1f)
                                .background(
                                    Brush.verticalGradient(listOf(cls.color.copy(alpha = if (on) 0.32f else 0.12f), Color(0xFF0C0907))),
                                    RoundedCornerShape(10.dp),
                                )
                                .border(if (on) 2.dp else 1.dp, if (on) cls.color else bronze.copy(alpha = 0.6f), RoundedCornerShape(10.dp))
                                .clickable { selected = cls }
                                .padding(8.dp),
                            horizontalAlignment = Alignment.CenterHorizontally,
                        ) {
                            Image(assets.portrait(cls), cls.label, Modifier.fillMaxWidth().aspectRatio(1f))
                            Text(cls.label.uppercase(), color = if (on) cls.color else parchment, fontSize = 16.sp, style = titleStyle)
                            Text(cls.tagline, color = parchment.copy(alpha = 0.7f), fontSize = 11.sp, textAlign = TextAlign.Center)
                        }
                    }
                }
            }
            // Details of the chosen class.
            Column(
                Modifier.fillMaxWidth().background(Color(0x66000000), RoundedCornerShape(10.dp))
                    .border(1.dp, selected.color.copy(alpha = 0.6f), RoundedCornerShape(10.dp)).padding(12.dp),
                verticalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                Text(selected.blurb, color = parchment, fontSize = 13.sp, fontFamily = Alegreya)
                for ((label, value) in listOf("Might", "Toughness", "Speed", "Magic").zip(selected.ratings)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(label, color = parchment.copy(alpha = 0.75f), fontSize = 12.sp, modifier = Modifier.width(80.dp))
                        for (i in 1..5) {
                            Box(
                                Modifier.padding(end = 4.dp).size(width = 28.dp, height = 8.dp)
                                    .background(if (i <= value) selected.color else Color(0x33FFFFFF), RoundedCornerShape(2.dp))
                            )
                        }
                    }
                }
                Spacer(Modifier.height(2.dp))
                for (sk in selected.skills) {
                    Row(verticalAlignment = Alignment.Top) {
                        Text(sk.icon, fontSize = 20.sp, modifier = Modifier.width(32.dp))
                        Column {
                            Text(sk.label, color = sk.color, fontSize = 14.sp, style = serifBold)
                            Text(sk.describe(1), color = parchment.copy(alpha = 0.75f), fontSize = 11.sp)
                        }
                    }
                }
            }
        }
        GothicButton("Begin as ${selected.label}", { onPick(selected) }, Modifier.padding(vertical = 10.dp))
    }
}

@Composable
private fun TitleScreen(game: Game, frame: () -> Long, onContinue: () -> Unit, onNew: () -> Unit) {
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        // The village glows through a vignette while embers drift up from below.
        Canvas(Modifier.fillMaxSize()) {
            drawRect(
                Brush.radialGradient(
                    listOf(Color(0x77000000), Color(0xC0080202), Color(0xF2000000)),
                    center = Offset(size.width / 2f, size.height * 0.42f), radius = size.maxDimension * 0.62f,
                ),
            )
            // Read while drawing, so the embers redraw each frame without recomposing the screen.
            val t = frame() / 60f
            for (i in 0 until 46) {
                val seed = i * 7919
                val fx = ((seed * 31) % 1000) / 1000f
                val speed = 0.04f + ((seed / 7) % 100) / 1000f
                val k = ((t * speed + ((seed / 13) % 1000) / 1000f) % 1f)
                val x = size.width * fx + sin(t * 0.8f + i) * size.width * 0.03f
                val y = size.height * (1.05f - k * 1.1f)
                val a = (1f - k) * (0.35f + 0.65f * (((seed / 3) % 10) / 10f))
                val r = size.width * (0.003f + ((seed / 11) % 5) * 0.0012f)
                drawCircle(Color(0xFFFF8A3D).copy(alpha = a * 0.35f), r * 3.5f, Offset(x, y))
                drawCircle(Color(0xFFFFD08A).copy(alpha = a), r, Offset(x, y))
            }
        }
        Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(16.dp)) {
            Text(
                "SHADOW\nDEPTHS",
                textAlign = TextAlign.Center,
                style = TextStyle(
                    color = Color(0xFFE0B25A), fontSize = 46.sp, lineHeight = 52.sp, fontFamily = Cinzel,
                    fontWeight = FontWeight.Black, shadow = Shadow(Color(0xFFFF3D00), Offset(0f, 0f), 28f),
                ),
            )
            Text("─── ✦ ───", color = bronze, fontSize = 16.sp)
            Text("Descend into darkness. Claim the treasure. Survive.", color = parchment.copy(alpha = 0.8f), fontFamily = Alegreya, fontSize = 15.sp)
            Spacer(Modifier.height(10.dp))
            if (game.hasSave) GothicButton("Continue — level ${game.player.level} ${game.player.heroClass.label}", onContinue)
            GothicButton("New Adventure", onNew)
            Spacer(Modifier.height(6.dp))
            Text(
                "Joystick: move · ⚔️ hold to attack · 💨 dodge\n🧪 potion · 🎒 gear · ✨ skills · 📜 quests · 🏕️ home",
                color = Color.White.copy(alpha = 0.65f), fontSize = 13.sp, textAlign = TextAlign.Center,
            )
        }
    }
}

@Composable
private fun DeathScreen(onRespawn: () -> Unit) {
    Box(Modifier.fillMaxSize().background(Color(0xAA200000)), contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(14.dp)) {
            Text("YOU HAVE FALLEN", color = Color(0xFFD32F2F), fontSize = 38.sp, style = serifBold.copy(fontWeight = FontWeight.Black))
            Text("The darkness claimed you this time.", color = parchment, fontFamily = Alegreya)
            GothicButton("Wake in the village (−20% gold)", onRespawn)
        }
    }
}

@Composable
private fun VictoryScreen(game: Game, onContinue: () -> Unit) {
    Box(Modifier.fillMaxSize().background(Color(0xCC000000)), contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(14.dp), modifier = Modifier.padding(24.dp)) {
            Text("THE DARKNESS IS BROKEN", color = GOLD, fontSize = 34.sp, textAlign = TextAlign.Center,
                style = serifBold.copy(fontWeight = FontWeight.Black, shadow = Shadow(Color(0xFFFFD54F), Offset.Zero, 24f)))
            Text(
                "The Shadow King has fallen and light returns to the land. Songs of your deeds will be sung for generations.",
                color = parchment, fontFamily = Alegreya, fontSize = 15.sp, textAlign = TextAlign.Center,
            )
            Text("Level ${game.player.level} · ${game.player.gold} gold", color = GOLD, fontSize = 15.sp)
            Text("Yet the depths go on… and the monsters only grow stronger.", color = Color.Gray, fontSize = 13.sp, textAlign = TextAlign.Center)
            GothicButton("Continue the adventure", onContinue)
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
                drawImage(
                    mapImage(game), IntOffset.Zero, IntSize(d.w, d.h), IntOffset.Zero,
                    IntSize((d.w * cell).roundToInt(), (d.h * cell).roundToInt()), filterQuality = FilterQuality.None,
                )
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
                        "you" to GOLD, "entrance/stairs" to Color(0xFF4FC3F7), "chest" to GOLD,
                        "shrine" to Color(0xFF00E5FF), "boss" to Color(0xFFFF1744),
                    )) {
                        withStyle(SpanStyle(color = color)) { append("● ") }
                        append(label)
                        append("   ")
                    }
                },
                color = parchment.copy(alpha = 0.7f), fontSize = 12.sp,
            )
            Text("Tap to close", color = Color.Gray, fontSize = 12.sp)
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
    DarkPanel("The Blacksmith", onClose) {
        Text("\"Show me your gear. I can reforge it or make it stronger.\"", color = parchment, fontFamily = Alegreya, fontSize = 14.sp,
            textAlign = TextAlign.Center, modifier = Modifier.width(300.dp))
        Text("You have 💰 ${p.gold}", color = GOLD, fontSize = 15.sp, fontWeight = FontWeight.Bold)
        Text("Equipment", color = parchment, fontSize = 14.sp, style = serifBold)
        for (row in Slot.entries.chunked(4)) {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                for (slot in row) {
                    val item = p.equipment[slot]
                    ItemIcon(item, assets, 58.dp, selected = item != null && item === selected, placeholder = slot.label) { selected = item }
                }
            }
        }
        if (p.inventory.isNotEmpty()) Text("Bag", color = parchment, fontSize = 14.sp, style = serifBold)
        for (row in p.inventory.chunked(6)) {
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                for (item in row) ItemIcon(item, assets, 44.dp, selected = item === selected, upgrade = game.isUpgrade(item)) { selected = item }
            }
        }
        selected?.let { item ->
            ItemDetail(item, null)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                GothicButton("Reforge (${game.reforgePrice(item)} 💰)", {
                    game.reforge(item)?.let { selected = it }
                    refresh++
                }, wide = false, enabled = p.gold >= game.reforgePrice(item))
                GothicButton("Upgrade (${game.upgradePrice(item)} 💰)", {
                    game.upgrade(item)?.let { selected = it }
                    refresh++
                }, wide = false, enabled = p.gold >= game.upgradePrice(item) && game.canUpgrade(item))
            }
            Text("Reforge: new random properties, same rarity.\nUpgrade: +2 levels and 15% stronger properties.",
                color = Color.Gray, fontSize = 11.sp, textAlign = TextAlign.Center)
        } ?: Text("Choose an item", color = Color.Gray, fontSize = 13.sp)
    }
}

@Composable
private fun ElderScreen(game: Game, tick: Int, onClose: () -> Unit) {
    tick.let { }
    var reward by remember { mutableStateOf<Item?>(null) }
    var refresh by remember { mutableIntStateOf(0) }
    refresh.let { }
    DarkPanel("The Elder", onClose) {
        val b = game.bounty
        when {
            b != null && b.done -> {
                Text("\"You kept your word. Here is your reward.\"", color = parchment, fontFamily = Alegreya, fontSize = 14.sp)
                GothicButton("Claim ${b.gold} 💰 + ${b.rarity.label.lowercase()} item", {
                    reward = game.claimBounty()
                    refresh++
                })
            }
            b != null -> {
                Text("\"Come back when the work is done.\"", color = parchment, fontFamily = Alegreya, fontSize = 14.sp)
                Text("Slay ${b.need} ${b.type.plural}: ${b.got}/${b.need}", color = GOLD, fontSize = 16.sp, style = serifBold)
                Text("Reward: ${b.gold} 💰 and a ${b.rarity.label.lowercase()} item", color = b.rarity.color, fontSize = 13.sp)
                GothicButton("Abandon bounty", { game.abandonBounty(); refresh++ }, wide = false)
            }
            else -> {
                Text("\"The land is full of dangers. Help us, and you shall be rewarded.\"", color = parchment, fontFamily = Alegreya,
                    fontSize = 14.sp, textAlign = TextAlign.Center, modifier = Modifier.width(300.dp))
                for (offer in game.bountyOffers.toList()) {
                    Row(
                        Modifier.width(310.dp).background(Color(0x44000000), RoundedCornerShape(8.dp)).padding(8.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Column(Modifier.weight(1f)) {
                            Text("Slay ${offer.need} ${offer.type.plural}", color = parchment, fontSize = 15.sp, style = serifBold)
                            Text("${offer.gold} 💰 + ${offer.rarity.label.lowercase()} item", color = offer.rarity.color, fontSize = 12.sp)
                        }
                        GothicButton("Take", { game.acceptBounty(offer); refresh++ }, wide = false)
                    }
                }
            }
        }
        reward?.let { item ->
            Text("You got:", color = parchment, fontSize = 13.sp)
            ItemDetail(item, game.player.equipment[item.slot])
        }
    }
}

@Composable
private fun SettingsScreen(
    game: Game, music: Music, sfx: Sfx, settings: android.content.SharedPreferences,
    graphics: GraphicsChoice, onGraphics: (Boolean, Boolean) -> Unit, onClose: () -> Unit,
) {
    var musicOn by remember { mutableStateOf(music.enabled) }
    var sfxOn by remember { mutableStateOf(sfx.enabled) }
    var hapticsOn by remember { mutableStateOf(sfx.haptics) }
    var followOn by remember { mutableStateOf(game.camFollow) }
    DarkPanel("Settings", onClose) {
        GothicButton(if (musicOn) "🎵 Music: on" else "🎵 Music: off", {
            musicOn = !musicOn
            music.enabled = musicOn
            settings.edit().putBoolean("music", musicOn).apply()
        })
        GothicButton(if (sfxOn) "🔊 Sound effects: on" else "🔇 Sound effects: off", {
            sfxOn = !sfxOn
            sfx.enabled = sfxOn
            settings.edit().putBoolean("sfx", sfxOn).apply()
        })
        GothicButton(if (hapticsOn) "📳 Vibration: on" else "📴 Vibration: off", {
            hapticsOn = !hapticsOn
            sfx.haptics = hapticsOn
            settings.edit().putBoolean("haptics", hapticsOn).apply()
            if (hapticsOn) sfx.rumble(40, 160)
        })
        GothicButton(if (graphics.use3d) "🎮 Graphics: 3D third person" else "🎮 Graphics: classic top-down", {
            onGraphics(!graphics.use3d, graphics.high)
        })
        if (graphics.use3d) {
            GothicButton(if (graphics.high) "✨ 3D quality: high" else "🔋 3D quality: battery saver", {
                onGraphics(true, !graphics.high)
            })
            GothicButton(if (followOn) "🎥 Camera follows you: on" else "🎥 Camera follows you: off", {
                followOn = !followOn
                game.camFollow = followOn
                settings.edit().putBoolean("camFollow", followOn).apply()
            })
        }
        graphics.error?.let {
            Text("3D is not available on this device, so the classic view is used.", color = Color(0xFFFF8A65), fontSize = 12.sp)
        }
        if (graphics.use3d) Text("Drag the screen to turn the camera, pinch to zoom.", color = Color.Gray, fontSize = 12.sp)
        Text("The game saves automatically.", color = Color.Gray, fontSize = 12.sp)
    }
}
