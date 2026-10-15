package com.baldissera.rpg

import android.content.SharedPreferences
import androidx.compose.ui.graphics.Color
import org.json.JSONArray
import org.json.JSONObject
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt
import kotlin.math.sin
import kotlin.random.Random

val GOLD = Color(0xFFFFC94D)
private val XP_COLOR = Color(0xFFB388FF)
val HURT_COLOR = Color(0xFFFF5252)
private val FIRE = Color(0xFFFF7A1A)
private val FROST = Color(0xFF80DEEA)
private val LIGHTNING = Color(0xFF9FE7FF)
const val INVENTORY_SIZE = 24

/** Base items per slot: name and icon (which also decides the weapon type). */
private val bases = mapOf(
    Slot.WEAPON to listOf(
        "Sværd" to Icons.SWORD, "Bredsværd" to Icons.SWORD, "Økse" to Icons.AXE, "Stridsøkse" to Icons.AXE,
        "Stridshammer" to Icons.MACE, "Morgenstjerne" to Icons.MACE, "Dolk" to Icons.DAGGER, "Kniv" to Icons.DAGGER,
        "Spyd" to Icons.SPEAR, "Hellebard" to Icons.SPEAR, "Stav" to Icons.STAFF, "Troldmandsstav" to Icons.STAFF,
    ),
    Slot.OFFHAND to listOf("Rundskjold" to Icons.SHIELD, "Tårnskjold" to Icons.SHIELD, "Buckler" to Icons.SHIELD),
    Slot.HELM to listOf("Hjelm" to Icons.HELM, "Stormhjelm" to Icons.HELM, "Hætte" to Icons.HOOD, "Læderhætte" to Icons.HOOD),
    Slot.ARMOR to listOf("Ringbrynje" to Icons.ARMOR, "Pladerustning" to Icons.ARMOR, "Læderbrynje" to Icons.LEATHER, "Jægerdragt" to Icons.LEATHER),
    Slot.GLOVES to listOf("Handsker" to Icons.GLOVES, "Jernhandsker" to Icons.GLOVES),
    Slot.BOOTS to listOf("Støvler" to Icons.BOOTS, "Jernstøvler" to Icons.BOOTS),
    Slot.AMULET to listOf("Amulet" to Icons.AMULET, "Talisman" to Icons.AMULET),
    Slot.RING to listOf("Ring" to Icons.RING, "Runering" to Icons.RING),
)
private val legendaryNames = mapOf(
    Slot.WEAPON to listOf("Mjølner", "Gram", "Tyrfing", "Dainsleif", "Hofud"),
    Slot.OFFHAND to listOf("Svalins Skjold", "Asgårds Mur"),
    Slot.HELM to listOf("Odins Øje", "Tordenhjelmen"),
    Slot.ARMOR to listOf("Ymers Hud", "Fafners Skæl"),
    Slot.GLOVES to listOf("Tyrs Greb", "Jarngreipr"),
    Slot.BOOTS to listOf("Sleipners Spor", "Vidars Sko"),
    Slot.AMULET to listOf("Brisingamen", "Nornernes Tråd"),
    Slot.RING to listOf("Draupner", "Andvaranaut"),
)
private val mythicNames = mapOf(
    Slot.WEAPON to listOf("Gungnir", "Ragnarok", "Surts Flammesværd"),
    Slot.OFFHAND to listOf("Yggdrasils Bark"),
    Slot.HELM to listOf("Allfaders Krone"),
    Slot.ARMOR to listOf("Jormungandrs Skæl"),
    Slot.GLOVES to listOf("Fenrirs Lænke"),
    Slot.BOOTS to listOf("Bifrosts Skridt"),
    Slot.AMULET to listOf("Mimers Kilde"),
    Slot.RING to listOf("Evighedens Ring"),
)
private val prefixes = listOf("Dragens", "Skyggernes", "Kongens", "Ulvens", "Stormens", "Blodets", "Ravnens", "Isens", "Ildens", "Jættens")
private val suffixes = listOf("af Asgård", "af Nordlyset", "af Midgård", "fra Udgård", "af Valhal", "fra Niflheim", "af Muspelheim")

val QUESTS = listOf(
    "Rens Krypten" to "Besejr Knoglekongen på dybde 3 (Krypten, nordvest for landsbyen)",
    "Hulernes dronning" to "Besejr Edderkoppedronningen på dybde 6 (Hulerne, mod øst)",
    "Helvedes port" to "Besejr Dæmonherren på dybde 9 (Helvedes port, mod syd)",
    "Bryd mørket" to "Besejr Skyggekongen på dybde 10",
)
private val questBosses = listOf(EnemyType.SKELETON_KING, EnemyType.SPIDER_QUEEN, EnemyType.DEMON_LORD, EnemyType.SHADOW_KING)

class Game(private val sfx: Sfx, private val prefs: SharedPreferences) {
    private val rnd = Random(System.nanoTime())
    private var worldSeed = 0L

    var dungeon: Dungeon = Dungeon.overworld(1L)
        private set
    val player = Player()
    val enemies = mutableListOf<Enemy>()
    val projectiles = mutableListOf<Projectile>()
    val loot = mutableListOf<Loot>()
    val texts = mutableListOf<FloatText>()
    val particles = mutableListOf<Particle>()
    val decals = ArrayDeque<Decal>()
    val stock = mutableListOf<Item>()
    var explored = BooleanArray(dungeon.w * dungeon.h)
        private set
    var floor = 0
        private set
    var deepest = 0
        private set
    var questStage = 0
        private set
    var victory = false
    var time = 0f
        internal set
    var shake = 0f
        private set
    var shakeX = 0f
        private set
    var shakeY = 0f
        private set
    var message: String? = null
        private set
    var messageColor = Color.White
        private set
    var messageTimer = 0f
        private set
    var dead = false
        private set
    var levelFlash = 0f
        private set

    var joyX = 0f
    var joyY = 0f
    var attackHeld = false

    val inWorld: Boolean get() = floor == 0
    val inVillage: Boolean get() = inWorld && (dungeon.village?.contains(player.x, player.y) == true)
    val merchantX: Float get() = dungeon.merchantX
    val merchantY: Float get() = dungeon.merchantY
    val boss: Enemy? get() = enemies.firstOrNull { it.type.boss }
    val nearMerchant: Boolean get() = dungeon.hasMerchant && hypot(player.x - merchantX, player.y - merchantY) < 1.6f
    val areaTitle: String get() = when {
        inVillage -> "Landsbyen"
        inWorld -> "Landet — område ${zoneLevel(player.x, player.y)}"
        else -> "${dungeon.biome.title} — dybde $floor"
    }
    val potionPrice: Int get() = 20 + max(1, deepest) * 6
    fun gamblePrice(): Int = 60 + max(1, deepest) * 30

    /** 0 = midnight, 1 = noon. A full day lasts six minutes. */
    val daylight: Float get() = 0.5f + 0.5f * cos(time * 2f * PI.toFloat() / 360f)
    val darknessAlpha: Float get() = if (inWorld) 0.08f + (1f - daylight) * 0.62f else dungeon.biome.darknessAlpha

    /** Whether a hero existed when the app started (decides if the title screen offers "continue"). */
    val hasSave: Boolean = prefs.contains("save3")

    init {
        if (!load()) resetHero()
        enterFloor(0)
    }

    /** Monster level out in the open grows with the distance from the village. */
    fun zoneLevel(x: Float, y: Float): Int {
        val v = dungeon.village ?: return floor
        return (1 + hypot(x - v.cx, y - v.cy) / 11f).toInt().coerceIn(1, 5)
    }

    private fun levelHere(x: Float = player.x, y: Float = player.y) = if (inWorld) zoneLevel(x, y) else floor

    // ---------------------------------------------------------------- floors & saving

    fun enterFloor(target: Int) {
        floor = target
        if (floor > deepest) deepest = floor
        dungeon = if (floor == 0) Dungeon.overworld(worldSeed) else Dungeon.generate(rnd, Biome.forFloor(floor))
        explored = BooleanArray(dungeon.w * dungeon.h)
        enemies.clear()
        projectiles.clear()
        loot.clear()
        texts.clear()
        particles.clear()
        decals.clear()
        player.phoenixUsed = false
        player.x = dungeon.start.cx + 0.5f
        player.y = dungeon.start.cy + 0.5f
        player.hp = player.hp.coerceIn(1f, player.maxHp)

        if (floor == 0) {
            player.hp = player.maxHp
            player.mana = player.maxMana
            restock()
            populateWorld()
            showMessage("Landsbyen — et øjebliks fred", Color(0xFFFFE0A3))
        } else {
            val pool = spawnPool()
            for (room in dungeon.rooms) {
                if (room === dungeon.start) continue
                repeat(rnd.nextInt(2, 5) + floor / 3) {
                    val ex = room.x + 0.5f + rnd.nextInt(room.w)
                    val ey = room.y + 0.5f + rnd.nextInt(room.h)
                    if (dungeon.walkableAt(ex, ey)) {
                        enemies += Enemy(pool.random(rnd), ex, ey, floor, elite = floor >= 2 && rnd.nextFloat() < 0.07f)
                    }
                }
            }
            val bossType = bossFor(floor)
            if (bossType != null) {
                enemies += Enemy(bossType, dungeon.exit.cx + 0.5f, dungeon.exit.cy - 0.5f, floor)
                showMessage("${dungeon.biome.title} — dybde $floor\n${bossType.label} venter…", HURT_COLOR)
            } else {
                showMessage("${dungeon.biome.title} — dybde $floor", Color.White)
            }
        }
        save()
    }

    /** Packs of monsters out in the wild, tougher the further from the village. */
    private fun populateWorld() {
        val d = dungeon
        val v = d.village ?: return
        var groups = 0
        var tries = 0
        while (groups < 34 && tries++ < 600) {
            val x = rnd.nextInt(4, d.w - 4)
            val y = rnd.nextInt(4, d.h - 4)
            if (!d.walkable(x, y) || d.tile(x, y) == ENTRANCE) continue
            if (hypot((x - v.cx).toFloat(), (y - v.cy).toFloat()) < 13f) continue
            val lvl = zoneLevel(x.toFloat(), y.toFloat())
            val nearWater = (-2..2).any { dy -> (-2..2).any { dx -> d.tile(x + dx, y + dy) == WATER } }
            val nearTrees = (-2..2).count { dy -> (-2..2).count { dx -> d.tile(x + dx, y + dy) == TREE } > 0 } >= 3
            val nearCrypt = hypot(x - 14f, y - 15f) < 12f
            val type = when {
                nearCrypt -> EnemyType.SKELETON
                nearWater -> EnemyType.SLIME
                nearTrees && rnd.nextBoolean() -> EnemyType.WOLF
                nearTrees -> EnemyType.SPIDER
                lvl >= 3 && rnd.nextFloat() < 0.3f -> EnemyType.BRUTE
                else -> EnemyType.BANDIT
            }
            val count = if (type == EnemyType.WOLF) rnd.nextInt(3, 5) else rnd.nextInt(2, 4)
            repeat(count) {
                val ex = x + 0.5f + (rnd.nextFloat() - 0.5f) * 2f
                val ey = y + 0.5f + (rnd.nextFloat() - 0.5f) * 2f
                if (d.walkableAt(ex, ey)) enemies += Enemy(type, ex, ey, lvl, elite = rnd.nextFloat() < 0.06f)
            }
            groups++
        }
        // The forest troll roams the far south-east.
        for (k in 0 until 200) {
            val x = rnd.nextInt(d.w - 22, d.w - 6)
            val y = rnd.nextInt(d.h - 26, d.h - 8)
            if (d.walkable(x, y)) {
                enemies += Enemy(EnemyType.TROLL, x + 0.5f, y + 0.5f, 5)
                break
            }
        }
    }

    private fun spawnPool(): List<EnemyType> = when (dungeon.biome) {
        Biome.CRYPT -> buildList {
            addAll(listOf(EnemyType.SLIME, EnemyType.BAT, EnemyType.SKELETON, EnemyType.SKELETON))
            if (floor >= 2) add(EnemyType.CULTIST)
            if (floor >= 3) add(EnemyType.BRUTE)
        }
        Biome.CAVE -> listOf(EnemyType.SPIDER, EnemyType.SPIDER, EnemyType.BAT, EnemyType.SLIME, EnemyType.BRUTE, EnemyType.WOLF)
        Biome.HELL -> listOf(EnemyType.CULTIST, EnemyType.CULTIST, EnemyType.BRUTE, EnemyType.SKELETON, EnemyType.SPIDER, EnemyType.BAT)
        Biome.OVERWORLD -> listOf(EnemyType.BANDIT)
    }

    private fun bossFor(f: Int): EnemyType? = when {
        f == 3 -> EnemyType.SKELETON_KING
        f == 6 -> EnemyType.SPIDER_QUEEN
        f == 9 -> EnemyType.DEMON_LORD
        f == 10 -> EnemyType.SHADOW_KING
        f > 10 && f % 3 == 0 -> questBosses.random(rnd)
        else -> null
    }

    fun save() {
        val o = JSONObject()
            .put("level", player.level).put("xp", player.xp).put("gold", player.gold).put("potions", player.potions)
            .put("deepest", deepest).put("quest", questStage).put("points", player.skillPoints).put("victory", victory)
            .put("seed", worldSeed)
        val eq = JSONObject()
        player.equipment.forEach { (slot, item) -> eq.put(slot.name, item.toJson()) }
        o.put("equipment", eq)
        o.put("inventory", JSONArray().apply { player.inventory.forEach { put(it.toJson()) } })
        o.put("skills", JSONObject().apply { player.skills.forEach { (s, l) -> put(s.name, l) } })
        prefs.edit().putString("save3", o.toString()).apply()
    }

    private fun load(): Boolean {
        val raw = prefs.getString("save3", null) ?: prefs.getString("save", null) ?: return false
        return runCatching {
            val o = JSONObject(raw)
            player.level = o.getInt("level")
            player.xp = o.getInt("xp")
            player.gold = o.getInt("gold")
            player.potions = o.getInt("potions")
            deepest = o.optInt("deepest", 0)
            questStage = o.optInt("quest", 0)
            player.skillPoints = o.optInt("points", 0)
            victory = o.optBoolean("victory", false)
            worldSeed = o.optLong("seed", System.nanoTime())
            val eq = o.optJSONObject("equipment")
            player.equipment.clear()
            Slot.entries.forEach { s -> Item.fromJson(eq?.optJSONObject(s.name))?.let { player.equipment[s] = it } }
            player.inventory.clear()
            val inv = o.optJSONArray("inventory")
            if (inv != null) for (i in 0 until inv.length()) Item.fromJson(inv.optJSONObject(i))?.let { player.inventory += it }
            val sk = o.optJSONObject("skills")
            Skill.entries.forEach { s -> if (sk != null && sk.has(s.name)) player.skills[s] = sk.getInt(s.name) }
            player.hp = player.maxHp
            player.mana = player.maxMana
            true
        }.getOrDefault(false)
    }

    fun newGame() {
        prefs.edit().remove("save3").remove("save").apply()
        resetHero()
        dead = false
        enterFloor(0)
    }

    private fun resetHero() {
        player.level = 1
        player.xp = 0
        player.gold = 0
        player.potions = 3
        player.skillPoints = 0
        player.equipment.clear()
        player.inventory.clear()
        player.skills.clear()
        player.skills.putAll(mapOf(Skill.FIREBALL to 1, Skill.WHIRL to 1, Skill.NOVA to 0))
        player.equipment[Slot.WEAPON] = Item(Slot.WEAPON, "Rustent sværd", Rarity.COMMON, Icons.SWORD, 1, damage = 2)
        player.equipment[Slot.OFFHAND] = Item(Slot.OFFHAND, "Gammelt rundskjold", Rarity.COMMON, Icons.SHIELD, 1, armor = 2)
        player.hp = player.maxHp
        player.mana = player.maxMana
        deepest = 0
        questStage = 0
        victory = false
        worldSeed = System.nanoTime()
    }

    fun respawn() {
        val lost = player.gold / 5
        player.gold -= lost
        dead = false
        player.hp = player.maxHp
        enterFloor(0)
        showMessage("Du vågner ved lejrbålet… (−$lost guld)", GOLD)
    }

    fun townPortal() {
        if (dead || inVillage) return
        sfx.portal()
        burst(player.x, player.y, Color(0xFF64B5F6), 40, glow = true)
        if (inWorld) {
            player.x = dungeon.start.cx + 0.5f
            player.y = dungeon.start.cy + 0.5f
            burst(player.x, player.y, Color(0xFF64B5F6), 40, glow = true)
        } else {
            enterFloor(0)
        }
    }

    private fun enterRegion(e: Entrance) {
        if (questStage < e.region.quest) {
            if (messageTimer <= 0f) showMessage("${e.region.title} er låst — ${e.region.lockText}", HURT_COLOR)
            return
        }
        val target = if (deepest >= e.region.firstFloor) {
            val last = if (e.region == Region.HELL) Int.MAX_VALUE else e.region.firstFloor + 2
            min(deepest, last)
        } else {
            e.region.firstFloor
        }
        sfx.stairs()
        enterFloor(target)
    }

    private fun showMessage(text: String, color: Color) {
        message = text
        messageColor = color
        messageTimer = 3f
    }

    // ---------------------------------------------------------------- update

    fun update(dt: Float) {
        time += dt
        if (messageTimer > 0f) {
            messageTimer -= dt
            if (messageTimer <= 0f) message = null
        }
        shake = max(0f, shake - dt * 2.5f)
        shakeX = if (shake > 0f) (rnd.nextFloat() - 0.5f) * shake * 0.3f else 0f
        shakeY = if (shake > 0f) (rnd.nextFloat() - 0.5f) * shake * 0.3f else 0f
        levelFlash = max(0f, levelFlash - dt)
        updateParticles(dt)
        updateTexts(dt)
        ambientParticles()
        if (dead || victory) return
        updatePlayer(dt)
        updateEnemies(dt)
        updateProjectiles(dt)
        updateLoot()
        reveal()
    }

    private fun blocked(x: Float, y: Float, r: Float) =
        !dungeon.walkableAt(x - r, y - r) || !dungeon.walkableAt(x + r, y - r) ||
            !dungeon.walkableAt(x - r, y + r) || !dungeon.walkableAt(x + r, y + r)

    private fun move(b: Body, dx: Float, dy: Float, r: Float) {
        if (!blocked(b.x + dx, b.y, r)) b.x += dx
        if (!blocked(b.x, b.y + dy, r)) b.y += dy
    }

    private fun solid(p: Prop) = p.type.solid && !(p.type.breakable && p.used)

    private fun pushOutOfProps(b: Body, r: Float) {
        for (pr in dungeon.props) {
            if (!solid(pr) || abs(pr.x - b.x) > 1f || abs(pr.y - b.y) > 1f) continue
            pushFrom(b, r, pr.x, pr.y, 0.3f)
        }
        if (dungeon.hasMerchant) pushFrom(b, r, merchantX, merchantY, 0.3f)
    }

    private fun pushFrom(b: Body, r: Float, ox: Float, oy: Float, otherR: Float) {
        val dx = b.x - ox
        val dy = b.y - oy
        val d = hypot(dx, dy)
        val minD = r + otherR
        if (d < minD && d > 0.001f) move(b, dx / d * (minD - d), dy / d * (minD - d), r)
    }

    private fun updatePlayer(dt: Float) {
        val p = player
        p.attackCd -= dt
        p.swing = max(0f, p.swing - dt)
        p.whirl = max(0f, p.whirl - dt)
        p.cast = max(0f, p.cast - dt)
        p.hurt = max(0f, p.hurt - dt)
        p.sinceHurt += dt
        for (e in p.cooldowns.entries) e.setValue(max(0f, e.value - dt))
        if (p.buffTime > 0f) {
            p.buffTime -= dt
            if (p.buffTime <= 0f) p.buff = null
        }
        p.mana = min(p.maxMana, p.mana + (5f + p.level * 0.3f) * dt)
        if (p.sinceHurt > 4f || inVillage) p.hp = min(p.maxHp, p.hp + p.maxHp * (if (inVillage) 0.1f else 0.012f) * dt)

        val len = hypot(joyX, joyY)
        p.moving = len > 0.15f
        if (p.moving) {
            val speed = p.speed * min(1f, len)
            val nx = joyX / len
            val ny = joyY / len
            if (p.swing <= 0f && p.whirl <= 0f && p.cast <= 0f) {
                p.faceX = nx
                p.faceY = ny
            }
            move(p, nx * speed * dt, ny * speed * dt, 0.28f)
            p.walk += dt * speed * 2.2f
        }
        pushOutOfProps(p, 0.28f)

        if (attackHeld && p.attackCd <= 0f) attack()

        for (pr in dungeon.props) {
            if (pr.used || abs(pr.x - p.x) > 1f || abs(pr.y - p.y) > 1f || hypot(pr.x - p.x, pr.y - p.y) > 0.9f) continue
            when (pr.type) {
                PropType.CHEST -> openChest(pr)
                PropType.SHRINE -> useShrine(pr)
                else -> {}
            }
        }

        val tx = floorInt(p.x)
        val ty = floorInt(p.y)
        when (dungeon.tile(tx, ty)) {
            ENTRANCE -> dungeon.entrances.firstOrNull { it.x == tx && it.y == ty }?.let { enterRegion(it) }
            STAIRS -> if (boss != null) {
                if (messageTimer <= 0f) showMessage("Besejr ${boss!!.type.label} først!", HURT_COLOR)
            } else {
                sfx.stairs()
                enterFloor(floor + 1)
            }
        }
    }

    private fun dist(e: Enemy) = hypot(e.x - player.x, e.y - player.y)

    private fun nearestEnemy(range: Float): Enemy? = enemies.filter { dist(it) < range }.minByOrNull { dist(it) }

    private fun faceToward(x: Float, y: Float) {
        val d = hypot(x - player.x, y - player.y).coerceAtLeast(0.001f)
        player.faceX = (x - player.x) / d
        player.faceY = (y - player.y) / d
    }

    private fun spellMult() = 1f + player.spellBonus / 100f

    // ---------------------------------------------------------------- player actions

    fun attack() {
        val p = player
        if (dead || p.attackCd > 0f) return
        val kind = p.weaponKind
        val target = nearestEnemy(kind.reach + 1.3f)
        if (target != null) {
            faceToward(target.x, target.y)
        } else {
            dungeon.props.filter { it.type.breakable && !it.used && hypot(it.x - p.x, it.y - p.y) < 1.6f }
                .minByOrNull { hypot(it.x - p.x, it.y - p.y) }?.let { faceToward(it.x, it.y) }
        }
        p.attackCd = kind.cooldown / (1f + p.attackSpeed / 100f)
        p.swingTime = min(0.3f, p.attackCd * 0.8f)
        p.swing = p.swingTime
        sfx.swing()
        var hitAny = false
        for (e in enemies.toList()) {
            if (inArc(e.x, e.y, kind.reach + e.type.radius * e.size, kind.arc)) {
                damageEnemy(e, p.damage * kind.dmgMult, kind.knock)
                onHitPowers(e)
                hitAny = true
            }
        }
        for (pr in dungeon.props) {
            if (pr.type.breakable && !pr.used && inArc(pr.x, pr.y, kind.reach + 0.2f, 0.2f)) {
                breakProp(pr)
                hitAny = true
            }
        }
        if (hitAny) sfx.hit()
    }

    private fun onHitPowers(e: Enemy) {
        val p = player
        if (p.has(Power.FROSTBITE) && rnd.nextFloat() < 0.15f) {
            e.frozen = if (e.type.boss) 0.4f else 1.2f
            e.windup = 0f
            burst(e.x, e.y, FROST, 10, glow = true)
        }
        if (p.has(Power.THUNDER) && rnd.nextFloat() < 0.2f) {
            val targets = enemies.filter { it !== e && hypot(it.x - e.x, it.y - e.y) < 3.5f }.sortedBy { hypot(it.x - e.x, it.y - e.y) }.take(3)
            var fromX = e.x
            var fromY = e.y
            for (t in listOf(e) + targets) {
                val steps = 8
                for (k in 0..steps) {
                    val f = k / steps.toFloat()
                    particles += Particle(fromX + (t.x - fromX) * f + (rnd.nextFloat() - 0.5f) * 0.2f, fromY + (t.y - fromY) * f,
                        0f, 0f, LIGHTNING, 0.05f, 0.25f, glow = true, z = 0.6f)
                }
                damageEnemy(t, p.damage * 0.8f, 1f)
                fromX = t.x
                fromY = t.y
            }
            sfx.explode()
        }
    }

    private fun inArc(x: Float, y: Float, reach: Float, arc: Float): Boolean {
        val dx = x - player.x
        val dy = y - player.y
        val d = hypot(dx, dy)
        if (d > reach) return false
        return d < 0.01f || (dx * player.faceX + dy * player.faceY) / d > arc
    }

    fun skillReady(s: Skill) = (player.cooldowns[s] ?: 0f) <= 0f

    fun cast(skill: Skill) {
        val p = player
        if (dead) return
        val lvl = p.skills[skill] ?: 0
        if (lvl <= 0) {
            showMessage("Lær ${skill.label} under ✨ Færdigheder", skill.color)
            return
        }
        if (!skillReady(skill)) return
        val cost = if (skill == Skill.WHIRL && p.has(Power.STORM)) 0f else skill.mana
        if (p.mana < cost) {
            showMessage("Ikke nok mana", Color(0xFF64B5F6))
            return
        }
        p.mana -= cost
        p.cooldowns[skill] = skill.cooldown
        when (skill) {
            Skill.FIREBALL -> {
                nearestEnemy(7f)?.let { faceToward(it.x, it.y) }
                p.cast = 0.3f
                val angles = if (p.has(Power.INFERNO)) listOf(-0.28f, 0f, 0.28f) else listOf(0f)
                val base = kotlin.math.atan2(p.faceY, p.faceX)
                for (a in angles) {
                    val dx = cos(base + a)
                    val dy = sin(base + a)
                    projectiles += Projectile(
                        p.x + dx * 0.4f, p.y + dy * 0.4f, dx * 8f, dy * 8f,
                        p.damage * (1.6f + 0.4f * (lvl - 1)) * spellMult(), hostile = false, color = FIRE, life = 1.5f, radius = 0.2f,
                        aoe = 1.1f + 0.15f * lvl,
                    )
                }
                sfx.fireball()
            }
            Skill.WHIRL -> {
                p.whirl = 0.45f
                p.attackCd = 0.45f
                sfx.swing()
                var hitAny = false
                for (e in enemies.toList()) {
                    if (dist(e) < 1.9f + e.type.radius * e.size) {
                        damageEnemy(e, p.damage * (1.3f + 0.3f * (lvl - 1)), 6f)
                        onHitPowers(e)
                        hitAny = true
                    }
                }
                for (pr in dungeon.props) {
                    if (pr.type.breakable && !pr.used && hypot(pr.x - p.x, pr.y - p.y) < 2f) breakProp(pr)
                }
                if (hitAny) sfx.hit()
                ring(p.x, p.y, 1.3f, Color(0xFFCFD8DC), 26, 2.2f)
            }
            Skill.NOVA -> {
                p.cast = 0.35f
                sfx.frost()
                val freeze = 2f + lvl * 0.5f
                for (e in enemies) {
                    if (dist(e) < 3.3f) {
                        damageEnemy(e, p.damage * (1f + 0.25f * (lvl - 1)) * spellMult(), 2f)
                        e.frozen = if (e.type.boss) freeze * 0.4f else freeze
                        e.windup = 0f
                    }
                }
                ring(p.x, p.y, 0.4f, FROST, 48, 7f)
                shake = max(shake, 0.3f)
            }
        }
    }

    fun drinkPotion() {
        val p = player
        if (dead) return
        when {
            p.potions <= 0 -> showMessage("Ingen eliksirer — køb flere i landsbyen", HURT_COLOR)
            p.hp >= p.maxHp -> showMessage("Du har fuldt liv", Color.White)
            else -> {
                p.potions--
                p.hp = min(p.maxHp, p.hp + p.maxHp * 0.5f)
                sfx.potion()
                burst(p.x, p.y, Color(0xFFFF5370), 22, glow = true)
                save()
            }
        }
    }

    // ---------------------------------------------------------------- inventory, shop, skills

    fun equip(item: Item) {
        val p = player
        p.inventory.remove(item)
        p.equipment.put(item.slot, item)?.let { p.inventory.add(it) }
        p.hp = min(p.hp, p.maxHp)
        sfx.equip()
        save()
    }

    fun sell(item: Item) {
        if (player.inventory.remove(item)) {
            player.gold += item.sellPrice
            sfx.coin()
            save()
        }
    }

    /** Sells every normal and magic item that is not an upgrade. Returns the gold earned. */
    fun sellJunk(): Int {
        val junk = player.inventory.filter { it.rarity <= Rarity.MAGIC && !isUpgrade(it) }
        val gold = junk.sumOf { it.sellPrice }
        player.inventory.removeAll(junk)
        player.gold += gold
        if (gold > 0) sfx.coin()
        save()
        return gold
    }

    fun sortInventory() {
        player.inventory.sortWith(compareByDescending<Item> { it.rarity.ordinal }.thenBy { it.slot.ordinal }.thenByDescending { it.score })
    }

    fun buy(item: Item): Boolean {
        val p = player
        if (p.gold < item.buyPrice || p.inventory.size >= INVENTORY_SIZE) return false
        p.gold -= item.buyPrice
        stock.remove(item)
        p.inventory += item
        sfx.coin()
        save()
        return true
    }

    fun buyPotion(): Boolean {
        if (player.gold < potionPrice) return false
        player.gold -= potionPrice
        player.potions++
        sfx.coin()
        save()
        return true
    }

    /** Diablo-style gambling: pay for an unidentified item of a chosen slot. */
    fun gamble(slot: Slot): Item? {
        val p = player
        val price = gamblePrice()
        if (p.gold < price || p.inventory.size >= INVENTORY_SIZE) return null
        p.gold -= price
        val roll = rnd.nextFloat()
        val rarity = when {
            roll < 0.012f -> Rarity.MYTHIC
            roll < 0.07f -> Rarity.LEGENDARY
            roll < 0.19f -> Rarity.EPIC
            roll < 0.45f -> Rarity.RARE
            else -> Rarity.MAGIC
        }
        val item = makeItem(max(1, deepest) + 1, rarity, false, slot = slot, exact = true)
        p.inventory += item
        if (item.rarity >= Rarity.EPIC) sfx.levelUp() else sfx.coin()
        save()
        return item
    }

    fun learn(skill: Skill) {
        val p = player
        val lvl = p.skills[skill] ?: 0
        if (p.skillPoints <= 0 || lvl >= 5) return
        p.skills[skill] = lvl + 1
        p.skillPoints--
        sfx.levelUp()
        save()
    }

    fun isUpgrade(item: Item): Boolean = item.score > (player.equipment[item.slot]?.score ?: -1)

    private fun restock() {
        stock.clear()
        repeat(5) { stock += makeItem(max(1, deepest) + 1, minRarity = Rarity.MAGIC, bossDrop = false) }
    }

    // ---------------------------------------------------------------- props

    private fun breakProp(pr: Prop) {
        pr.used = true
        val wood = pr.type != PropType.URN
        burst(pr.x, pr.y, if (wood) Color(0xFF8D6E63) else Color(0xFFBF7A50), 16)
        if (inVillage) return
        val lvl = levelHere(pr.x, pr.y)
        when {
            rnd.nextFloat() < 0.55f -> loot += Loot(pr.x, pr.y + 0.1f, LootKind.Gold(goldAmount(rnd.nextInt(2, 8) * lvl)))
            rnd.nextFloat() < 0.15f -> loot += Loot(pr.x, pr.y + 0.1f, LootKind.Potion)
            rnd.nextFloat() < 0.08f -> dropGear(pr.x, pr.y + 0.1f, makeItem(ilvl(), Rarity.COMMON, false))
        }
    }

    private fun openChest(pr: Prop) {
        pr.used = true
        sfx.equip()
        burst(pr.x, pr.y - 0.2f, GOLD, 30, glow = true)
        val lvl = levelHere(pr.x, pr.y)
        loot += Loot(pr.x - 0.4f, pr.y + 0.5f, LootKind.Gold(goldAmount(rnd.nextInt(8, 20) * lvl)))
        repeat(rnd.nextInt(1, 3)) {
            dropGear(pr.x + (it - 0.5f) * 0.7f, pr.y + 0.6f, makeItem(ilvl(), Rarity.MAGIC, false))
        }
        if (rnd.nextFloat() < 0.4f) loot += Loot(pr.x + 0.4f, pr.y + 0.5f, LootKind.Potion)
        showMessage("Skattekiste!", GOLD)
    }

    private fun useShrine(pr: Prop) {
        if (inVillage) {
            if (player.hp < player.maxHp) {
                player.hp = player.maxHp
                player.mana = player.maxMana
                sfx.levelUp()
                showMessage("Helligdommen helbreder dig", Color(0xFF80DEEA))
            }
            return
        }
        pr.used = true
        val b = Buff.entries.random(rnd)
        player.buff = b
        player.buffTime = 60f
        sfx.levelUp()
        ring(pr.x, pr.y, 0.3f, b.color, 36, 4f)
        showMessage("Helligdom — ${b.label} i 60 sek.", b.color)
    }

    // ---------------------------------------------------------------- combat

    private fun bloodColor(t: EnemyType) = when (t) {
        EnemyType.SLIME -> Color(0xFF66BB6A)
        EnemyType.SKELETON, EnemyType.SKELETON_KING -> Color(0xFFE0D8C3)
        EnemyType.BAT -> Color(0xFF7B1FA2)
        EnemyType.SPIDER, EnemyType.SPIDER_QUEEN -> Color(0xFF9CCC65)
        EnemyType.CULTIST, EnemyType.BRUTE, EnemyType.WOLF, EnemyType.BANDIT, EnemyType.TROLL -> Color(0xFF8E1B1B)
        EnemyType.DEMON_LORD, EnemyType.SHADOW_KING -> Color(0xFFFF5722)
    }

    private fun bleeds(t: EnemyType) = t != EnemyType.SKELETON && t != EnemyType.SKELETON_KING && t != EnemyType.SLIME

    private fun damageEnemy(e: Enemy, base: Float, knock: Float) {
        val crit = rnd.nextInt(100) < player.critChance
        val dmg = base * (0.85f + rnd.nextFloat() * 0.3f) * (if (crit) 2f else 1f)
        e.hp -= dmg
        e.flash = 0.12f
        e.aggro = true
        if (player.lifeSteal > 0) player.hp = min(player.maxHp, player.hp + dmg * player.lifeSteal / 100f)
        val dx = e.x - player.x
        val dy = e.y - player.y
        val d = hypot(dx, dy).coerceAtLeast(0.01f)
        val k = if (e.type.boss) knock * 0.12f else knock / e.size
        e.kx += dx / d * k
        e.ky += dy / d * k
        texts += FloatText(e.x, e.y - 1f, dmg.roundToInt().toString(), if (crit) GOLD else Color.White, big = crit)
        burst(e.x, e.y, bloodColor(e.type), 7)
        if (crit) shake = max(shake, 0.3f)
    }

    private fun hurtPlayer(raw: Float) {
        var dmg = raw * 100f / (100f + player.armorValue * 4f)
        if (player.buff == Buff.WARD) dmg *= 0.6f
        player.hp -= dmg
        player.hurt = 0.3f
        player.sinceHurt = 0f
        shake = max(shake, 0.4f)
        sfx.hurt()
        texts += FloatText(player.x, player.y - 1.2f, "-${dmg.roundToInt()}", HURT_COLOR)
        burst(player.x, player.y, Color(0xFFB71C1C), 8)
        if (player.hp <= 0f) {
            if (player.has(Power.PHOENIX) && !player.phoenixUsed) {
                player.phoenixUsed = true
                player.hp = player.maxHp * 0.5f
                ring(player.x, player.y, 0.3f, Color(0xFFFF9100), 50, 5f)
                sfx.levelUp()
                showMessage("Føniks! Du rejser dig af asken", Color(0xFFFF9100))
                return
            }
            player.hp = 0f
            dead = true
            attackHeld = false
        }
    }

    private fun addDecal(x: Float, y: Float, kind: Int, scale: Float) {
        decals.addLast(Decal(x, y, kind, rnd.nextFloat() * 360f, scale))
        if (decals.size > 160) decals.removeFirst()
    }

    private fun kill(e: Enemy) {
        sfx.kill()
        burst(e.x, e.y, bloodColor(e.type), 20)
        if (bleeds(e.type)) addDecal(e.x, e.y, rnd.nextInt(4), 0.9f * e.size * (if (e.type.boss) 2f else 1f))
        if (player.has(Power.VAMPIRE)) player.hp = min(player.maxHp, player.hp + player.maxHp * 0.05f)
        gainXp(e.xp)
        dropLoot(e)
        if (e.type.boss) {
            val idx = questBosses.indexOf(e.type)
            if (idx >= 0 && idx == questStage) {
                questStage++
                showMessage("${e.type.label} er besejret!\nOpgave fuldført: ${QUESTS[idx].first}", GOLD)
                if (questStage == QUESTS.size) victory = true
            } else {
                showMessage("${e.type.label} er besejret!", GOLD)
            }
            shake = 1f
            burst(e.x, e.y, GOLD, 70, glow = true)
            save()
        }
    }

    private fun gainXp(amount: Int) {
        val p = player
        p.xp += amount
        texts += FloatText(p.x, p.y - 1.5f, "+$amount XP", XP_COLOR)
        while (p.xp >= p.xpToNext) {
            p.xp -= p.xpToNext
            p.level++
            p.skillPoints++
            p.hp = p.maxHp
            p.mana = p.maxMana
            levelFlash = 1.2f
            sfx.levelUp()
            showMessage("Niveau ${p.level}! +1 færdighedspoint ✨", GOLD)
            ring(p.x, p.y, 0.3f, GOLD, 40, 4f)
            save()
        }
    }

    private fun jitter() = (rnd.nextFloat() - 0.5f) * 0.6f

    private fun ilvl() = levelHere() + player.level / 2

    private fun goldAmount(base: Int) = max(1, (base * (1f + player.goldFind / 100f)).toInt())

    private fun dropGear(x: Float, y: Float, item: Item) {
        loot += Loot(x, y, LootKind.Gear(item))
        if (item.rarity >= Rarity.EPIC) {
            sfx.levelUp()
            ring(x, y, 0.2f, item.rarity.color, 24, 2.5f)
        }
    }

    private fun dropLoot(e: Enemy) {
        val boss = e.type.boss
        val lvl = e.level
        if (boss || rnd.nextFloat() < 0.6f) {
            val amount = rnd.nextInt(3, 11) * lvl * (if (boss) 12 else if (e.elite) 3 else 1)
            loot += Loot(e.x + jitter(), e.y + jitter(), LootKind.Gold(goldAmount(amount)))
        }
        if (rnd.nextFloat() < (if (boss) 1f else 0.1f)) loot += Loot(e.x + jitter(), e.y + jitter(), LootKind.Potion)
        val gearChance = when {
            boss -> 1f
            e.elite -> 1f
            e.type == EnemyType.BRUTE -> 0.4f
            else -> 0.16f
        }
        repeat(if (boss) 3 else 1) {
            if (rnd.nextFloat() < gearChance) {
                val min = if (boss || e.elite) Rarity.MAGIC else Rarity.COMMON
                dropGear(e.x + jitter(), e.y + jitter(), makeItem(lvl + player.level / 2, min, boss))
            }
        }
    }

    /**
     * Rolls an item. Rarity: normal 50%, magic 30%, rare 13%, epic 5%, legendary 1.7%, mythic 0.3%
     * (bosses roll much better). With [exact] the given rarity is used as is.
     */
    fun makeItem(level: Int, minRarity: Rarity, bossDrop: Boolean, slot: Slot? = null, exact: Boolean = false): Item {
        val roll = rnd.nextFloat()
        var rarity = if (exact) minRarity else when {
            roll < (if (bossDrop) 0.04f else 0.003f) -> Rarity.MYTHIC
            roll < (if (bossDrop) 0.25f else 0.02f) -> Rarity.LEGENDARY
            roll < (if (bossDrop) 0.55f else 0.07f) -> Rarity.EPIC
            roll < (if (bossDrop) 0.9f else 0.2f) -> Rarity.RARE
            roll < 0.5f -> Rarity.MAGIC
            else -> Rarity.COMMON
        }
        if (rarity < minRarity) rarity = minRarity
        val s = slot ?: Slot.entries.random(rnd)
        val (base, icon) = bases.getValue(s).random(rnd)
        val name = when (rarity) {
            Rarity.MYTHIC -> mythicNames.getValue(s).random(rnd)
            Rarity.LEGENDARY -> legendaryNames.getValue(s).random(rnd)
            Rarity.EPIC -> "${prefixes.random(rnd)} ${base.lowercase()} ${suffixes.random(rnd)}"
            Rarity.COMMON -> base
            else -> "${prefixes.random(rnd)} ${base.lowercase()}"
        }
        val m = rarity.mult
        fun v(b: Float) = (b * m * (0.8f + rnd.nextFloat() * 0.4f)).roundToInt().coerceAtLeast(1)
        val stats = mutableMapOf<String, Int>()
        val leather = icon == Icons.LEATHER || icon == Icons.HOOD
        when (s) {
            Slot.WEAPON -> {
                stats["damage"] = v(2f + level * 1.7f)
                if (icon == Icons.STAFF) stats["spell"] = v(8f + level * 1.5f).coerceAtMost(90)
            }
            Slot.OFFHAND -> { stats["armor"] = v(2f + level * 1.2f); stats["life"] = v(3f + level * 1.5f) }
            Slot.HELM -> { stats["armor"] = v((if (leather) 0.6f else 1f) + level * 0.8f); stats["life"] = v(3f + level * 2f) }
            Slot.ARMOR -> {
                stats["armor"] = v((if (leather) 1.2f else 2f) + level * (if (leather) 1f else 1.5f))
                stats["life"] = v(5f + level * 3f)
                if (leather) stats["speed"] = v(2f).coerceAtMost(15)
            }
            Slot.GLOVES -> { stats["armor"] = v(1f + level * 0.5f); stats["atkSpeed"] = v(3f).coerceAtMost(20) }
            Slot.BOOTS -> { stats["armor"] = v(1f + level * 0.6f); stats["speed"] = v(3f).coerceAtMost(15) }
            Slot.AMULET -> { stats["life"] = v(4f + level * 2.5f); stats["mana"] = v(5f + level * 2f) }
            Slot.RING -> stats["crit"] = v(2f).coerceAtMost(15)
        }
        val extras = listOf("damage", "crit", "lifeSteal", "mana", "life", "speed", "armor", "spell", "atkSpeed", "goldFind").shuffled(rnd)
        for (key in extras.filter { it !in stats }.take(rarity.ordinal)) {
            stats[key] = when (key) {
                "damage" -> v(1f + level * 0.6f)
                "crit" -> v(1.5f).coerceAtMost(15)
                "lifeSteal" -> v(1f).coerceAtMost(8)
                "mana" -> v(3f + level)
                "life" -> v(3f + level * 1.5f)
                "speed" -> v(2f).coerceAtMost(15)
                "spell" -> v(4f + level).coerceAtMost(60)
                "atkSpeed" -> v(2f).coerceAtMost(20)
                "goldFind" -> v(8f).coerceAtMost(80)
                else -> v(1f + level * 0.5f)
            }
        }
        val power = when {
            rarity == Rarity.MYTHIC -> Power.entries.random(rnd)
            rarity == Rarity.LEGENDARY && rnd.nextFloat() < 0.7f -> Power.entries.random(rnd)
            else -> null
        }
        return Item(
            s, name, rarity, icon, level,
            damage = stats["damage"] ?: 0, armor = stats["armor"] ?: 0, life = stats["life"] ?: 0,
            crit = stats["crit"] ?: 0, mana = stats["mana"] ?: 0, lifeSteal = stats["lifeSteal"] ?: 0, speed = stats["speed"] ?: 0,
            spell = stats["spell"] ?: 0, atkSpeed = stats["atkSpeed"] ?: 0, goldFind = stats["goldFind"] ?: 0, power = power,
        )
    }

    private fun collect(kind: LootKind): Boolean {
        val p = player
        when (kind) {
            is LootKind.Gold -> {
                p.gold += kind.amount
                sfx.coin()
                texts += FloatText(p.x, p.y - 1.3f, "+${kind.amount} guld", GOLD)
            }
            LootKind.Potion -> {
                p.potions++
                sfx.coin()
                texts += FloatText(p.x, p.y - 1.3f, "+1 eliksir", Color(0xFFFF5370))
            }
            is LootKind.Gear -> {
                val item = kind.item
                if (p.equipment[item.slot] == null) {
                    p.equipment[item.slot] = item
                    sfx.equip()
                    showMessage("Udstyret: ${item.name}", item.rarity.color)
                } else if (p.inventory.size < INVENTORY_SIZE) {
                    p.inventory += item
                    sfx.coin()
                    showMessage("${item.rarity.label}: ${item.name}${if (isUpgrade(item)) "  ⬆" else ""}", item.rarity.color)
                } else {
                    if (messageTimer <= 0f) showMessage("Tasken er fuld — sælg noget", HURT_COLOR)
                    return false
                }
                save()
            }
        }
        return true
    }

    // ---------------------------------------------------------------- world simulation

    private fun updateEnemies(dt: Float) {
        val spawned = mutableListOf<Enemy>()
        val iter = enemies.iterator()
        while (iter.hasNext()) {
            val e = iter.next()
            if (e.hp <= 0f) {
                iter.remove()
                kill(e)
                continue
            }
            e.flash = max(0f, e.flash - dt)
            e.moving = false
            // Monsters far away out in the world sleep to save battery.
            if (inWorld && !e.aggro && (abs(e.x - player.x) > 14f || abs(e.y - player.y) > 16f)) continue
            if (e.kx != 0f || e.ky != 0f) {
                move(e, (e.kx * dt).coerceIn(-0.25f, 0.25f), (e.ky * dt).coerceIn(-0.25f, 0.25f), e.type.radius)
                val damp = 1f - min(1f, dt * 8f)
                e.kx *= damp
                e.ky *= damp
                if (abs(e.kx) < 0.05f && abs(e.ky) < 0.05f) {
                    e.kx = 0f
                    e.ky = 0f
                }
            }
            if (e.frozen > 0f) {
                e.frozen -= dt
                continue
            }
            e.anim += dt

            val dx = player.x - e.x
            val dy = player.y - e.y
            val d = hypot(dx, dy).coerceAtLeast(0.001f)
            if (!e.aggro && d < e.type.aggro && !inVillage) e.aggro = true
            if (e.aggro && inVillage && d > 4f) e.aggro = false
            if (!e.aggro) continue
            e.faceX = dx / d
            e.faceY = dy / d
            e.cooldown -= dt

            if (e.windup > 0f) {
                e.windup -= dt
                if (e.windup <= 0f) {
                    if (e.type.ranged) {
                        projectiles += Projectile(e.x, e.y, e.faceX * 6f, e.faceY * 6f, e.dmg, hostile = true,
                            color = Color(0xFFD500F9), life = 2.5f, radius = 0.16f)
                        sfx.fireball()
                    } else if (d <= e.type.range * e.size + 0.5f) {
                        hurtPlayer(e.dmg)
                    }
                    e.cooldown = e.type.cooldown
                }
                continue
            }

            if (e.type.boss) bossAbilities(e, dt, spawned)

            if (e.type.ranged) {
                if (d < 7f && e.cooldown <= 0f) {
                    e.windup = e.type.windup
                    continue
                }
                val dir = if (d < 3f) -1f else if (d > 5f) 1f else 0f
                if (dir != 0f) {
                    move(e, dx / d * e.type.speed * dt * dir, dy / d * e.type.speed * dt * dir, e.type.radius)
                    e.moving = true
                }
                continue
            }

            if (d <= e.type.range * e.size + 0.3f && e.cooldown <= 0f) {
                e.windup = e.type.windup
                continue
            }
            if (d > e.type.range * 0.7f) {
                var mx = dx / d
                var my = dy / d
                if (e.type == EnemyType.BAT) {
                    val wob = sin(time * 6f + e.phase)
                    val px = -my
                    val py = mx
                    mx += px * wob * 0.8f
                    my += py * wob * 0.8f
                }
                move(e, mx * e.type.speed * dt, my * e.type.speed * dt, e.type.radius)
                e.moving = true
            }
        }
        enemies += spawned

        for (i in enemies.indices) {
            val a = enemies[i]
            if (abs(a.x - player.x) > 12f || abs(a.y - player.y) > 14f) continue
            for (j in i + 1 until enemies.size) {
                val b = enemies[j]
                val dx = b.x - a.x
                val dy = b.y - a.y
                if (abs(dx) > 1.5f || abs(dy) > 1.5f) continue
                val d = hypot(dx, dy)
                val minD = a.type.radius * a.size + b.type.radius * b.size
                if (d < minD && d > 0.001f) {
                    val push = (minD - d) / 2f
                    move(a, -dx / d * push, -dy / d * push, a.type.radius)
                    move(b, dx / d * push, dy / d * push, b.type.radius)
                }
            }
        }
    }

    private fun bossAbilities(e: Enemy, dt: Float, spawned: MutableList<Enemy>) {
        e.special -= dt
        e.summon -= dt
        val volley = when (e.type) {
            EnemyType.SPIDER_QUEEN -> Triple(8, Color(0xFF76FF03), 4.2f)
            EnemyType.DEMON_LORD -> Triple(10, Color(0xFFFF3D00), 3.5f)
            EnemyType.SHADOW_KING -> Triple(14, Color(0xFFAA00FF), 3f)
            else -> null
        }
        if (volley != null && e.special <= 0f) {
            e.special = volley.third
            sfx.fireball()
            repeat(volley.first) {
                val a = it / volley.first.toFloat() * 2f * PI.toFloat() + time
                projectiles += Projectile(e.x, e.y, cos(a) * 4.5f, sin(a) * 4.5f, e.dmg * 0.55f, hostile = true, color = volley.second, life = 3f)
            }
        }
        // The troll stomps the ground instead.
        if (e.type == EnemyType.TROLL && e.special <= 0f) {
            e.special = 5f
            ring(e.x, e.y, 0.5f, Color(0xFF8D6E63), 36, 5f)
            shake = max(shake, 0.6f)
            if (hypot(player.x - e.x, player.y - e.y) < 3f) hurtPlayer(e.dmg * 0.8f)
        }
        val minion = when (e.type) {
            EnemyType.SKELETON_KING -> EnemyType.SKELETON
            EnemyType.SPIDER_QUEEN -> EnemyType.SPIDER
            EnemyType.SHADOW_KING -> EnemyType.CULTIST
            else -> null
        }
        if (minion != null && e.summon <= 0f && enemies.size + spawned.size < 90) {
            e.summon = 8f
            repeat(if (e.type == EnemyType.SPIDER_QUEEN) 3 else 2) {
                val a = rnd.nextFloat() * 2f * PI.toFloat()
                val sx = e.x + cos(a) * 1.2f
                val sy = e.y + sin(a) * 1.2f
                if (dungeon.walkableAt(sx, sy)) {
                    spawned += Enemy(minion, sx, sy, e.level).also { it.aggro = true }
                    burst(sx, sy, Color(0xFF7C4DFF), 14, glow = true)
                }
            }
        }
    }

    private fun updateProjectiles(dt: Float) {
        val iter = projectiles.iterator()
        while (iter.hasNext()) {
            val pr = iter.next()
            pr.life -= dt
            val nx = pr.x + pr.vx * dt
            val ny = pr.y + pr.vy * dt
            val tile = dungeon.tile(floorInt(nx), floorInt(ny))
            var explode = pr.life <= 0f || !(dungeon.walkableAt(nx, ny) || tile == WATER)
            if (!explode) {
                pr.x = nx
                pr.y = ny
                if (pr.hostile) {
                    if (hypot(player.x - pr.x, player.y - pr.y) < 0.35f + pr.radius) {
                        hurtPlayer(pr.dmg)
                        explode = true
                    }
                } else if (enemies.any { e -> hypot(e.x - pr.x, e.y - pr.y) < e.type.radius * e.size + pr.radius }) {
                    explode = true
                }
            }
            if (particles.size < 600) {
                particles += Particle(pr.x, pr.y, (rnd.nextFloat() - 0.5f) * 0.6f, (rnd.nextFloat() - 0.5f) * 0.6f,
                    pr.color, 0.07f, 0.3f, glow = true, z = 0.35f)
            }
            if (explode) {
                iter.remove()
                if (!pr.hostile) {
                    for (e in enemies.toList()) if (hypot(e.x - pr.x, e.y - pr.y) < pr.aoe + e.type.radius) damageEnemy(e, pr.dmg, 3f)
                    for (p in dungeon.props) if (p.type.breakable && !p.used && hypot(p.x - pr.x, p.y - pr.y) < pr.aoe) breakProp(p)
                    sfx.explode()
                    shake = max(shake, 0.35f)
                    addDecal(pr.x, pr.y, 4, 0.8f)
                }
                burst(pr.x, pr.y, pr.color, 24, glow = true)
            }
        }
    }

    private fun updateLoot() {
        val iter = loot.iterator()
        while (iter.hasNext()) {
            val l = iter.next()
            if (hypot(l.x - player.x, l.y - player.y) < 0.6f && collect(l.kind)) iter.remove()
        }
    }

    private fun reveal() {
        val px = floorInt(player.x)
        val py = floorInt(player.y)
        val r = if (inWorld) 9 else 7
        for (y in py - r..py + r) for (x in px - r..px + r) {
            if (x in 0 until dungeon.w && y in 0 until dungeon.h && (x - px) * (x - px) + (y - py) * (y - py) <= r * r) {
                explored[y * dungeon.w + x] = true
            }
        }
    }

    // ---------------------------------------------------------------- particles

    fun burst(x: Float, y: Float, color: Color, count: Int, glow: Boolean = false) {
        repeat(count) {
            if (particles.size >= 600) return
            val a = rnd.nextFloat() * 2f * PI.toFloat()
            val s = 1f + rnd.nextFloat() * 3f
            particles += Particle(
                x, y, cos(a) * s, sin(a) * s - 1f, color,
                size = 0.04f + rnd.nextFloat() * 0.07f,
                life = 0.4f + rnd.nextFloat() * 0.5f,
                glow = glow,
                gravity = if (glow) 0f else 6f,
            )
        }
    }

    private fun ring(x: Float, y: Float, r: Float, color: Color, count: Int, speed: Float) {
        repeat(count) {
            if (particles.size >= 600) return
            val a = it / count.toFloat() * 2f * PI.toFloat()
            particles += Particle(x + cos(a) * r, y + sin(a) * r, cos(a) * speed, sin(a) * speed, color, 0.06f, 0.45f, glow = true)
        }
    }

    /** Embers from the campfire / lava, fireflies at night and dust motes in torchlight. */
    private fun ambientParticles() {
        if (particles.size > 400) return
        val fire = dungeon.props.firstOrNull { it.type == PropType.CAMPFIRE }
        if (fire != null && hypot(fire.x - player.x, fire.y - player.y) < 12f && rnd.nextFloat() < 0.5f) {
            particles += Particle(fire.x + (rnd.nextFloat() - 0.5f) * 0.4f, fire.y, (rnd.nextFloat() - 0.5f) * 0.3f, -0.2f,
                Color(0xFFFFAB40), 0.03f, 1.5f, glow = true, gravity = -0.6f, z = 0.4f)
        }
        if (inWorld && daylight < 0.35f && rnd.nextFloat() < 0.2f) {
            particles += Particle(player.x + (rnd.nextFloat() - 0.5f) * 9f, player.y + (rnd.nextFloat() - 0.5f) * 12f,
                (rnd.nextFloat() - 0.5f) * 0.4f, (rnd.nextFloat() - 0.5f) * 0.4f, Color(0xFFCCFF90), 0.025f, 3f, glow = true, z = 0.7f)
        } else if (dungeon.biome == Biome.HELL && rnd.nextFloat() < 0.3f) {
            particles += Particle(player.x + (rnd.nextFloat() - 0.5f) * 9f, player.y + (rnd.nextFloat() - 0.4f) * 12f,
                (rnd.nextFloat() - 0.5f) * 0.2f, -0.3f, Color(0xFFFF6E40), 0.025f, 2.5f, glow = true, gravity = -0.1f, z = 0.2f)
        } else if (!inWorld && rnd.nextFloat() < 0.15f) {
            particles += Particle(player.x + (rnd.nextFloat() - 0.5f) * 6f, player.y + (rnd.nextFloat() - 0.5f) * 6f,
                (rnd.nextFloat() - 0.5f) * 0.15f, -0.05f, Color(0x88FFF3E0), 0.015f, 4f, glow = false, z = 0.6f)
        }
    }

    private fun updateParticles(dt: Float) {
        val iter = particles.iterator()
        while (iter.hasNext()) {
            val pt = iter.next()
            pt.age += dt
            if (pt.age >= pt.life) {
                iter.remove()
                continue
            }
            pt.x += pt.vx * dt
            pt.y += pt.vy * dt
            pt.vy += pt.gravity * dt
            val damp = 1f - min(1f, dt * 3f)
            pt.vx *= damp
            pt.vy *= damp
        }
    }

    private fun updateTexts(dt: Float) {
        val iter = texts.iterator()
        while (iter.hasNext()) {
            val t = iter.next()
            t.age += dt
            t.y -= dt * 0.9f
            if (t.age > (if (t.big) 1.3f else 1f)) iter.remove()
        }
    }
}
