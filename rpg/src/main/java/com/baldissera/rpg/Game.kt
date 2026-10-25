package com.baldissera.rpg

import android.content.SharedPreferences
import androidx.compose.ui.graphics.Color
import org.json.JSONArray
import org.json.JSONObject
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.atan2
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
val HEART = Color(0xFFFF4F7B)
const val WORLD_SHARDS = 8
const val INVENTORY_SIZE = 24
const val STASH_SIZE = 40
/** Reach of a burning champion's eruption, in tiles. */
const val BURN_RADIUS = 2.3f
private val CHAMPION_FIRST = listOf("Grim", "Blood", "Ash", "Rust", "Shadow", "Gore", "Frost", "Bile", "Dusk", "Bone")
private val CHAMPION_LAST = listOf("fang", "claw", "brand", "heart", "cleaver", "maw", "hide", "eye", "hack", "wrath")

/** Base items per slot: name and icon (which also decides the weapon type). */
private val bases = mapOf(
    Slot.WEAPON to listOf(
        "Sword" to Icons.SWORD, "Broadsword" to Icons.SWORD, "Axe" to Icons.AXE, "Battle Axe" to Icons.AXE,
        "Warhammer" to Icons.MACE, "Morning Star" to Icons.MACE, "Dagger" to Icons.DAGGER, "Kris" to Icons.DAGGER,
        "Spear" to Icons.SPEAR, "Halberd" to Icons.SPEAR, "Staff" to Icons.STAFF, "Wizard Staff" to Icons.STAFF,
    ),
    Slot.OFFHAND to listOf("Round Shield" to Icons.SHIELD, "Tower Shield" to Icons.SHIELD, "Buckler" to Icons.SHIELD),
    Slot.HELM to listOf("Helm" to Icons.HELM, "Great Helm" to Icons.HELM, "Hood" to Icons.HOOD, "Leather Cap" to Icons.HOOD),
    Slot.ARMOR to listOf("Chainmail" to Icons.ARMOR, "Plate Armor" to Icons.ARMOR, "Leather Armor" to Icons.LEATHER, "Hunter's Garb" to Icons.LEATHER),
    Slot.GLOVES to listOf("Gloves" to Icons.GLOVES, "Gauntlets" to Icons.GLOVES),
    Slot.BOOTS to listOf("Boots" to Icons.BOOTS, "Iron Boots" to Icons.BOOTS),
    Slot.AMULET to listOf("Amulet" to Icons.AMULET, "Talisman" to Icons.AMULET),
    Slot.RING to listOf("Ring" to Icons.RING, "Rune Ring" to Icons.RING),
)
private val legendaryNames = mapOf(
    Slot.WEAPON to listOf("Mjölnir", "Gram", "Tyrfing", "Dáinsleif", "Hofud"),
    Slot.OFFHAND to listOf("Svalin's Shield", "Wall of Asgard"),
    Slot.HELM to listOf("Odin's Eye", "The Thunder Helm"),
    Slot.ARMOR to listOf("Ymir's Hide", "Fafnir's Scales"),
    Slot.GLOVES to listOf("Tyr's Grip", "Járngreipr"),
    Slot.BOOTS to listOf("Sleipnir's Stride", "Vidar's Shoes"),
    Slot.AMULET to listOf("Brísingamen", "Thread of the Norns"),
    Slot.RING to listOf("Draupnir", "Andvaranaut"),
)
private val mythicNames = mapOf(
    Slot.WEAPON to listOf("Gungnir", "Ragnarök", "Surtr's Flaming Sword"),
    Slot.OFFHAND to listOf("Bark of Yggdrasil"),
    Slot.HELM to listOf("Crown of the Allfather"),
    Slot.ARMOR to listOf("Scales of Jörmungandr"),
    Slot.GLOVES to listOf("Fenrir's Chain"),
    Slot.BOOTS to listOf("Bifröst Stride"),
    Slot.AMULET to listOf("Mimir's Well"),
    Slot.RING to listOf("Ring of Eternity"),
)
private val prefixes = listOf("Dragon", "Shadow", "Kingly", "Wolf", "Storm", "Blood", "Raven", "Frost", "Ember", "Giant")
private val suffixes = listOf("of Asgard", "of the Northern Lights", "of Midgard", "of Utgard", "of Valhalla", "of Niflheim", "of Muspelheim")

private val villagerLines = listOf(
    "Beware the wolves by the lake!", "Good to see you, hero.", "The blacksmith can make your weapon stronger.",
    "The Elder has work for you.", "The crypt is crawling with skeletons…", "I heard a troll in the forest to the south-east.",
    "The merchant has new wares.", "More monsters come out at night.", "Have you seen the Gate of Hell to the south?",
    "My husband went down into the caves and never came home.",
    "Caravans speak of a pharaoh's tomb in the Scorched Sands, south-west of here.",
)

/** Reach of the Sand Pharaoh's sandstorm, in tiles, and how long it gathers before it starts to hurt. */
const val SANDSTORM_RADIUS = 2.6f
const val SANDSTORM_WARN = 0.7f
private val SAND_DUST = Color(0xFFE6C17A)
private val STING_GREEN = Color(0xFF9CCC65)

val QUESTS = listOf(
    "Cleanse the Crypt" to "Defeat the Skeleton King at depth 3 (the Crypt, north-west of the village)",
    "Queen of the Caves" to "Defeat the Spider Queen at depth 6 (the Caves, to the east)",
    "The Gate of Hell" to "Defeat the Demon Lord at depth 9 (the Gate of Hell, to the south)",
    "Break the Darkness" to "Defeat the Shadow King at depth 10",
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
    val corpses = mutableListOf<Corpse>()
    val ghosts = mutableListOf<Ghost>()
    val bolts = mutableListOf<Bolt>()
    val zones = mutableListOf<Zone>()
    val meteors = mutableListOf<Meteor>()
    val waves = mutableListOf<Wave>()
    val skillFx = mutableListOf<SkillFx>()
    /** Smoothed camera centre in world tiles. */
    var camX = 0f
        private set
    var camY = 0f
        private set
    private var hitStop = 0f
    /** 0..1 strength of the current rain shower (outdoors only). */
    var rain = 0f
        internal set
    private var rainTarget = 0f
    private var weatherTimer = 90f
    /** 1 right after changing area, fading to 0: the screen fades in from black. */
    var fade = 0f
        private set
    /** Kills in quick succession; a streak of five or more pays out bonus experience. */
    var streak = 0
        private set
    private var streakTimer = 0f
    var bossIntro: String? = null
        private set
    var bossIntroTime = 0f
        private set
    val stock = mutableListOf<Item>()
    /** The elder's current offers and the accepted contract. */
    val bountyOffers = mutableListOf<Bounty>()
    var bounty: Bounty? = null
        private set
    var explored = BooleanArray(dungeon.w * dungeon.h)
        private set
    /** Bumped whenever new tiles are revealed, so the map image is only rebuilt when it changes. */
    var exploredVersion = 0
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
        internal set
    var levelFlash = 0f
        private set

    var joyX = 0f
    var joyY = 0f
    var attackHeld = false

    /** The 3D view's chase camera: yaw around the hero (radians, 0 looks north), pitch above the ground and distance in tiles. */
    var camYaw = 0f
    var camPitch = 0.5f
    var camDist = 6.4f
    /** The joystick as the player holds it, before it is turned to match the camera. */
    var stickX = 0f
    var stickY = 0f
    /**
     * True while the 3D view shows the game instead of the 2D renderer (the UI sets it every frame).
     * update() then skips work only the 2D renderer reads: its smoothed camera and enemy corpses.
     */
    var render3d = false
    /** The 2D camera was left behind while the 3D view showed; it snaps to the hero when 2D drawing resumes. */
    private var camStale = false
    /** The tile and map reveal() last ran for, so it only scans again once the hero reaches another tile. */
    private var revealedX = Int.MIN_VALUE
    private var revealedY = Int.MIN_VALUE
    private var revealedIn: BooleanArray? = null

    /** The 3D camera swings round behind the hero while they run (a setting; dragging the view pauses it). */
    var camFollow = true
    /** Seconds the camera follow stays paused after the player turned the view by hand. */
    var camManualHold = 0f
    /** Camera yaw the joystick is read against; held while the stick is held so the follow can't bend the run. */
    private var steerYaw = 0f
    private var stickHeld = false

    /** True during the brief freeze that makes heavy hits land harder. */
    val hitStopping: Boolean get() = hitStop > 0f

    /** Turns the held joystick into a walking direction on the map, relative to where the camera looks. */
    fun steer() {
        val held = stickX * stickX + stickY * stickY > 0.04f
        // While the stick is held the direction stays where the player aimed it, even as the camera swings
        // round behind them; pushing straight ahead follows the camera again.
        if (!held || !stickHeld || !camFollow || (stickY < 0f && abs(stickX) < -stickY * 0.4f)) steerYaw = camYaw
        stickHeld = held
        val c = cos(steerYaw)
        val s = sin(steerYaw)
        joyX = stickX * c + stickY * s
        joyY = -stickX * s + stickY * c
    }

    /** Swings the 3D camera round behind the way the hero runs, unless they run towards it. */
    private fun followCamera(dt: Float) {
        if (camManualHold > 0f) {
            camManualHold -= dt
            return
        }
        val p = player
        if (!camFollow || !stickHeld || !p.moving || hypot(p.vx, p.vy) < 0.5f) return
        var d = atan2(-p.vx, -p.vy) - camYaw
        while (d > PI.toFloat()) d -= 2f * PI.toFloat()
        while (d < -PI.toFloat()) d += 2f * PI.toFloat()
        if (abs(d) > 2.5f) return
        var yaw = camYaw + d * min(1f, dt * 2.4f)
        if (yaw > PI.toFloat()) yaw -= 2f * PI.toFloat()
        if (yaw < -PI.toFloat()) yaw += 2f * PI.toFloat()
        camYaw = yaw
    }

    val inWorld: Boolean get() = floor == 0
    /** On one of the Scorched Sands' depths (floors below zero, see [DESERT_FIRST]). */
    val inDesert: Boolean get() = isDesertFloor(floor)
    /** Under the open sky, with daylight and sun shadows: the wilds and the desert. */
    val outdoors: Boolean get() = inWorld || inDesert
    /** The depth shown to the player: the floor, or the desert's own 1 to 3. */
    val depth: Int get() = if (inDesert) desertDepth(floor) else floor
    /** Monster and loot level of the current dungeon floor; the desert counts as a mid-game area. */
    val dangerLevel: Int get() = if (inDesert) DESERT_LEVEL + desertDepth(floor) - 1 else floor
    /** Scorpion venom in the hero's veins: seconds left and damage per second. It wears off and never kills. */
    private var heroPoison = 0f
    private var heroPoisonDps = 0f
    private var heroPoisonTick = 0f
    val heroPoisoned: Boolean get() = heroPoison > 0f
    val inVillage: Boolean get() = inWorld && (dungeon.village?.contains(player.x, player.y) == true)
    val merchantX: Float get() = dungeon.merchantX
    val merchantY: Float get() = dungeon.merchantY
    val boss: Enemy? get() = enemies.firstOrNull { it.type.boss }
    /** The boss or the closest champion currently fighting the hero, for the health bar at the top. */
    val target: Enemy? get() = boss?.takeIf { it.aggro }
        ?: enemies.filter { it.elite && it.aggro && dist(it) < 9f }.minByOrNull { dist(it) }
    val nearMerchant: Boolean get() = dungeon.hasMerchant && hypot(player.x - merchantX, player.y - merchantY) < 1.6f
    /** Keys of the heart fragments found so far ("w3" out in the world, "f5" on dungeon depth 5). */
    val shardsFound = mutableSetOf<String>()
    /** Names of the boss types slain at least once; the first kill of each is worth a skill point. */
    val bossesSlain = mutableSetOf<String>()

    /** Items kept in the stash chest in the village. */
    val stash = mutableListOf<Item>()
    val nearStash: Boolean get() = inWorld && dungeon.props.any { it.type == PropType.STASH && hypot(player.x - it.x, player.y - it.y) < 1.5f }

    fun toStash(item: Item): Boolean {
        if (stash.size >= STASH_SIZE || !player.inventory.remove(item)) return false
        stash += item
        sfx.equip()
        save()
        return true
    }

    fun fromStash(item: Item): Boolean {
        if (player.inventory.size >= INVENTORY_SIZE || !stash.remove(item)) return false
        player.inventory += item
        sfx.equip()
        save()
        return true
    }
    val nearNpc: Npc? get() = dungeon.npcs.firstOrNull {
        (it.kind == NpcKind.SMITH || it.kind == NpcKind.ELDER) && hypot(player.x - it.x, player.y - it.y) < 1.7f
    }
    val areaTitle: String get() = when {
        inVillage -> "The Village"
        inWorld -> "The Wilds — zone ${zoneLevel(player.x, player.y)}"
        else -> "${dungeon.biome.title} — depth $depth"
    }
    val potionPrice: Int get() = 20 + max(1, deepest) * 6

    /** Which music fits the current situation. */
    val musicTrack: Int get() = when {
        boss?.aggro == true -> R.raw.mus_boss
        inVillage -> R.raw.mus_village
        inWorld || inDesert -> R.raw.mus_world
        dungeon.biome == Biome.CAVE -> R.raw.mus_cave
        dungeon.biome == Biome.HELL -> R.raw.mus_hell
        else -> R.raw.mus_crypt
    }
    fun gamblePrice(): Int = 60 + max(1, deepest) * 30

    /** 0 = midnight, 1 = noon. A full day lasts six minutes. */
    val daylight: Float get() = 0.5f + 0.5f * cos(time * 2f * PI.toFloat() / 360f)
    val darknessAlpha: Float get() = if (outdoors) min(0.85f, 0.08f + (1f - daylight) * 0.62f + rain * 0.18f) else dungeon.biome.darknessAlpha

    /** How thick the drifting fog is right now. */
    val fogAmount: Float get() = when {
        inWorld -> 0.04f + rain * 0.1f + max(0f, 0.25f - abs(daylight - 0.45f)) * 0.6f
        // A thin haze of blown sand.
        inDesert -> 0.06f
        dungeon.biome == Biome.CAVE -> 0.2f
        dungeon.biome == Biome.CRYPT -> 0.12f
        else -> 0.1f
    }

    /** Whether a hero existed when the app started (decides if the title screen offers "continue"). */
    val hasSave: Boolean = prefs.contains("save3")

    init {
        if (!load()) resetHero()
        enterFloor(0)
    }

    /** Monster level out in the open grows with the distance from the village. */
    fun zoneLevel(x: Float, y: Float): Int {
        val v = dungeon.village ?: return dangerLevel
        return (1 + hypot(x - v.cx, y - v.cy) / 11f).toInt().coerceIn(1, 5)
    }

    private fun levelHere(x: Float = player.x, y: Float = player.y) = if (inWorld) zoneLevel(x, y) else dangerLevel

    // ---------------------------------------------------------------- floors & saving

    fun enterFloor(target: Int) {
        fade = 1f
        floor = target
        // Desert floors are below zero, so they never count as the deepest dungeon floor reached.
        if (floor > deepest) deepest = floor
        dungeon = when {
            floor == 0 -> Dungeon.overworld(worldSeed)
            inDesert -> Dungeon.desert(rnd, desertDepth(floor))
            else -> Dungeon.generate(rnd, Biome.forFloor(floor))
        }
        heroPoison = 0f
        heroPoisonDps = 0f
        // The rain of the wilds does not follow the hero into the desert.
        if (inDesert) rain = 0f
        explored = BooleanArray(dungeon.w * dungeon.h)
        exploredVersion++
        enemies.clear()
        projectiles.clear()
        zones.clear()
        meteors.clear()
        loot.clear()
        texts.clear()
        particles.clear()
        decals.clear()
        corpses.clear()
        ghosts.clear()
        skillFx.clear()
        player.phoenixUsed = false
        player.x = dungeon.start.cx + 0.5f
        player.y = dungeon.start.cy + 0.5f
        snapCamera()
        player.hp = player.hp.coerceIn(1f, player.maxHp)

        if (floor == 0) {
            player.hp = player.maxHp
            player.mana = player.maxMana
            restock()
            if (bountyOffers.isEmpty()) rollBounties()
            populateWorld()
            placeWorldShards()
            showMessage("The Village — a moment of peace", Color(0xFFFFE0A3))
        } else {
            if (inDesert) populateDesert() else {
                val pool = spawnPool()
                for (room in dungeon.rooms) {
                    if (room === dungeon.start) continue
                    repeat(rnd.nextInt(2, 5) + floor / 3) {
                        val ex = room.x + 0.5f + rnd.nextInt(room.w)
                        val ey = room.y + 0.5f + rnd.nextInt(room.h)
                        if (dungeon.walkableAt(ex, ey)) {
                            enemies += spawn(pool.random(rnd), ex, ey, floor, elite = floor >= 2 && rnd.nextFloat() < 0.07f)
                        }
                    }
                }
            }
            placeFloorShard()
            val bossType = bossFor(floor)
            if (bossType != null) {
                enemies += Enemy(bossType, dungeon.exit.cx + 0.5f, dungeon.exit.cy - 0.5f, dangerLevel)
                showMessage("${dungeon.biome.title} — depth $depth\n${bossType.label} awaits…", HURT_COLOR)
            } else {
                showMessage("${dungeon.biome.title} — depth $depth", Color.White)
            }
        }
        save()
    }

    /** Hides heart fragments in out-of-the-way corners of the wilderness; the spots are fixed per world. */
    private fun placeWorldShards() {
        val d = dungeon
        val v = d.village ?: return
        val r = Random(worldSeed xor 0x5EED)
        val spots = mutableListOf<Pair<Int, Int>>()
        var tries = 0
        while (spots.size < WORLD_SHARDS && tries++ < 4000) {
            val x = r.nextInt(3, d.w - 3)
            val y = r.nextInt(3, d.h - 3)
            if (!d.walkable(x, y) || d.tile(x, y) == ENTRANCE) continue
            if (hypot((x - v.cx).toFloat(), (y - v.cy).toFloat()) < 16f) continue
            if (spots.any { hypot((it.first - x).toFloat(), (it.second - y).toFloat()) < 12f }) continue
            // Tucked away: among trees or by the water.
            val cover = (-2..2).sumOf { dy -> (-2..2).count { dx -> d.tile(x + dx, y + dy).let { it == TREE || it == WATER || it == ROCK } } }
            if (cover < 7) continue
            spots += x to y
        }
        for ((i, s) in spots.withIndex()) {
            val key = "w$i"
            if (key !in shardsFound) loot += Loot(s.first + 0.5f, s.second + 0.5f, LootKind.Shard(key))
        }
    }

    /** Every dungeon depth hides one fragment in a room far from the stairs down. */
    private fun placeFloorShard() {
        val key = if (inDesert) "s$depth" else "f$floor"
        if (key in shardsFound) return
        val start = dungeon.start
        val room = dungeon.rooms.filter { it !== start && it.w >= 3 && it.h >= 3 }
            .maxByOrNull { hypot((it.cx - start.cx).toFloat(), (it.cy - start.cy).toFloat()) } ?: return
        val corners = listOf(room.x + 1 to room.y + 1, room.x + room.w - 2 to room.y + 1, room.x + 1 to room.y + room.h - 2, room.x + room.w - 2 to room.y + room.h - 2)
        val (x, y) = corners.firstOrNull { (cx, cy) -> dungeon.walkable(cx, cy) } ?: return
        loot += Loot(x + 0.5f, y + 0.5f, LootKind.Shard(key))
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
            // Scorpions crawl out of the sands once the way to the desert is open.
            val nearDesert = questStage >= Region.DESERT.quest &&
                d.entrances.any { it.region == Region.DESERT && hypot(x - it.x.toFloat(), y - it.y.toFloat()) < 9f }
            val type = when {
                nearCrypt -> EnemyType.SKELETON
                nearDesert -> EnemyType.SCORPION
                nearWater -> EnemyType.SLIME
                nearTrees && rnd.nextFloat() < 0.4f -> EnemyType.WOLF
                nearTrees && rnd.nextBoolean() -> EnemyType.GOBLIN
                nearTrees -> EnemyType.SPIDER
                lvl >= 3 && rnd.nextFloat() < 0.3f -> EnemyType.BRUTE
                else -> EnemyType.BANDIT
            }
            val count = if (type == EnemyType.WOLF) rnd.nextInt(3, 5) else rnd.nextInt(2, 4)
            repeat(count) {
                val ex = x + 0.5f + (rnd.nextFloat() - 0.5f) * 2f
                val ey = y + 0.5f + (rnd.nextFloat() - 0.5f) * 2f
                if (d.walkableAt(ex, ey)) enemies += spawn(type, ex, ey, lvl, elite = lvl >= 2 && rnd.nextFloat() < 0.06f)
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

    /** Creates a monster; champions get a name and one to three affixes depending on the level. */
    private fun spawn(type: EnemyType, x: Float, y: Float, lvl: Int, elite: Boolean): Enemy {
        if (!elite) return Enemy(type, x, y, lvl)
        val count = when {
            lvl >= 9 -> 3
            lvl >= 5 -> 2
            else -> 1
        }
        val affixes = Affix.entries.shuffled(rnd).take(count)
        val title = CHAMPION_FIRST.random(rnd) + CHAMPION_LAST.random(rnd)
        return Enemy(type, x, y, lvl, elite = true, affixes = affixes, title = title)
    }

    private fun spawnPool(): List<EnemyType> = when (dungeon.biome) {
        Biome.CRYPT -> buildList {
            addAll(listOf(EnemyType.SLIME, EnemyType.BAT, EnemyType.SKELETON, EnemyType.SKELETON))
            if (floor >= 2) { add(EnemyType.CULTIST); add(EnemyType.GHOST); add(EnemyType.GHOST) }
            if (floor >= 3) add(EnemyType.BRUTE)
        }
        Biome.CAVE -> listOf(EnemyType.SPIDER, EnemyType.SPIDER, EnemyType.BAT, EnemyType.SLIME, EnemyType.BRUTE, EnemyType.WOLF)
        Biome.HELL -> listOf(EnemyType.CULTIST, EnemyType.IMP, EnemyType.IMP, EnemyType.BRUTE, EnemyType.SKELETON, EnemyType.GHOST, EnemyType.BAT)
        Biome.OVERWORLD -> listOf(EnemyType.BANDIT)
        // Out on the open sand; raiders are bandits and the jackals wolves.
        Biome.DESERT -> buildList {
            addAll(listOf(EnemyType.SCORPION, EnemyType.SCORPION, EnemyType.SCORPION, EnemyType.DJINN, EnemyType.MUMMY))
            addAll(listOf(EnemyType.BANDIT, EnemyType.WOLF, EnemyType.WOLF))
            if (depth >= 2) { add(EnemyType.DJINN); add(EnemyType.MUMMY) }
        }
    }

    /**
     * Packs in the Scorched Sands by where they lair: mummies in the temples, raiders and jackals at the oasis,
     * scorpions and djinn out on the open sand. None wait right where the hero arrives.
     */
    private fun populateDesert() {
        val d = dungeon
        val lvl = dangerLevel
        val pool = spawnPool()
        val ground = d.ground
        for (room in d.rooms) {
            if (room === d.start) continue
            val ruin = room !== d.exit && ground != null && ground[room.cy * d.w + room.cx] == DesertGround.PAVING
            val oasis = (room.y until room.y + room.h).any { yy -> (room.x until room.x + room.w).any { xx -> d.tile(xx, yy) == WATER } }
            val lair = when {
                ruin -> listOf(EnemyType.MUMMY, EnemyType.MUMMY, EnemyType.SCORPION, EnemyType.DJINN)
                oasis -> listOf(EnemyType.BANDIT, EnemyType.BANDIT, EnemyType.WOLF)
                else -> pool
            }
            repeat(rnd.nextInt(2, 5) + lvl / 3) {
                val ex = room.x + 0.5f + rnd.nextInt(room.w)
                val ey = room.y + 0.5f + rnd.nextInt(room.h)
                if (d.walkableAt(ex, ey) && hypot(ex - player.x, ey - player.y) > 9f) {
                    enemies += spawn(lair.random(rnd), ex, ey, lvl, elite = rnd.nextFloat() < 0.07f)
                }
            }
        }
    }

    private fun bossFor(f: Int): EnemyType? = when {
        isDesertFloor(f) -> if (f == DESERT_LAST) EnemyType.SAND_PHARAOH else null
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
            .put("seed", worldSeed).put("class", player.heroClass.name)
        val eq = JSONObject()
        player.equipment.forEach { (slot, item) -> eq.put(slot.name, item.toJson()) }
        o.put("equipment", eq)
        o.put("inventory", JSONArray().apply { player.inventory.forEach { put(it.toJson()) } })
        o.put("stash", JSONArray().apply { stash.forEach { put(it.toJson()) } })
        o.put("shards", JSONArray().apply { shardsFound.forEach { put(it) } })
        o.put("skills", JSONObject().apply { player.skills.forEach { (s, l) -> put(s.name, l) } })
        o.put("talents", JSONObject().apply { for (t in Talent.entries) if (player.talentRank(t) > 0) put(t.name, player.talentRank(t)) })
        o.put("loadout", JSONArray().apply { player.loadout.forEach { put(it?.name ?: "") } })
        o.put("bosses", JSONArray().apply { bossesSlain.forEach { put(it) } })
        bounty?.let { o.put("bounty", it.toJson()) }
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
            shardsFound.clear()
            o.optJSONArray("shards")?.let { a -> for (i in 0 until a.length()) shardsFound += a.getString(i) }
            player.hearts = shardsFound.size / 4
            stash.clear()
            val st = o.optJSONArray("stash")
            if (st != null) for (i in 0 until st.length()) Item.fromJson(st.optJSONObject(i))?.let { stash += it }
            bounty = Bounty.fromJson(o.optJSONObject("bounty"))
            val sk = o.optJSONObject("skills")
            val saved = Skill.entries.associateWith { s -> if (sk != null && sk.has(s.name)) sk.getInt(s.name) else 0 }
            val cls = HeroClass.entries.firstOrNull { it.name == o.optString("class") }
            player.heroClass = cls ?: HeroClass.KNIGHT
            player.skills.clear()
            player.heroClass.allSkills.forEachIndexed { i, s -> player.skills[s] = saved.getValue(s).coerceAtLeast(if (i < 2) 1 else 0) }
            if (cls == null) {
                // A hero from before classes: becomes a knight and gets back the points spent on spells.
                val spent = saved.filterKeys { it !in player.heroClass.allSkills }.values.sum()
                player.skillPoints += (spent - 1).coerceAtLeast(0)
            }
            // The skill tree: talents, the skills on the HUD buttons and the bosses already slain (older saves have none).
            val tree = SkillTree.of(player.heroClass)
            player.clearTalents()
            val tal = o.optJSONObject("talents")
            if (tal != null) for (t in Talent.entries) if (tal.has(t.name) && tree.node(t) != null) player.setTalent(t, tal.optInt(t.name))
            val lo = o.optJSONArray("loadout")
            for (i in 0 until LOADOUT_SIZE) {
                val name = lo?.optString(i) ?: ""
                player.loadout[i] = if (lo == null) player.heroClass.skills.getOrNull(i) else player.heroClass.allSkills.firstOrNull { it.name == name }
            }
            bossesSlain.clear()
            o.optJSONArray("bosses")?.let { a -> for (i in 0 until a.length()) bossesSlain += a.getString(i) }
            if (tal == null) {
                // A hero from before the skill tree gets the points it would have earned since: a bonus every fifth level
                // and one for each quest boss already beaten.
                player.skillPoints += player.level / 5
                for (b in questBosses.take(questStage)) if (bossesSlain.add(b.name)) player.skillPoints++
            }
            player.hp = player.maxHp
            player.mana = player.maxMana
            true
        }.getOrDefault(false)
    }

    fun newGame(heroClass: HeroClass = HeroClass.KNIGHT) {
        prefs.edit().remove("save3").remove("save").apply()
        resetHero(heroClass)
        dead = false
        enterFloor(0)
    }

    private fun resetHero(heroClass: HeroClass = HeroClass.KNIGHT) {
        player.heroClass = heroClass
        player.level = 1
        player.xp = 0
        player.gold = 0
        player.potions = 3
        player.skillPoints = 0
        player.equipment.clear()
        player.inventory.clear()
        stash.clear()
        shardsFound.clear()
        player.hearts = 0
        player.skills.clear()
        heroClass.allSkills.forEachIndexed { i, sk -> player.skills[sk] = if (i < 2) 1 else 0 }
        player.clearTalents()
        player.resetLoadout()
        player.hitCount = 0
        player.undyingCd = 0f
        bossesSlain.clear()
        when (heroClass) {
            HeroClass.KNIGHT -> {
                player.equipment[Slot.WEAPON] = Item(Slot.WEAPON, "Rusty Sword", Rarity.COMMON, Icons.SWORD, 1, damage = 2)
                player.equipment[Slot.OFFHAND] = Item(Slot.OFFHAND, "Old Round Shield", Rarity.COMMON, Icons.SHIELD, 1, armor = 2)
            }
            HeroClass.BARBARIAN -> {
                player.equipment[Slot.WEAPON] = Item(Slot.WEAPON, "Notched Axe", Rarity.COMMON, Icons.AXE, 1, damage = 3)
                player.equipment[Slot.ARMOR] = Item(Slot.ARMOR, "Wolf Pelt", Rarity.COMMON, Icons.LEATHER, 1, armor = 2, life = 4)
            }
            HeroClass.ASSASSIN -> {
                player.equipment[Slot.WEAPON] = Item(Slot.WEAPON, "Worn Dagger", Rarity.COMMON, Icons.DAGGER, 1, damage = 2)
                player.equipment[Slot.OFFHAND] = Item(Slot.OFFHAND, "Parrying Dagger", Rarity.COMMON, Icons.DAGGER, 1, crit = 2)
            }
            HeroClass.SORCERESS -> {
                player.equipment[Slot.WEAPON] = Item(Slot.WEAPON, "Apprentice Staff", Rarity.COMMON, Icons.STAFF, 1, damage = 2, spell = 8)
                player.equipment[Slot.OFFHAND] = Item(Slot.OFFHAND, "Torn Grimoire", Rarity.COMMON, Icons.SCROLL, 1, mana = 8)
            }
        }
        player.hp = player.maxHp
        player.mana = player.maxMana
        deepest = 0
        questStage = 0
        victory = false
        bounty = null
        bountyOffers.clear()
        worldSeed = System.nanoTime()
    }

    fun respawn() {
        val lost = player.gold / 5
        player.gold -= lost
        dead = false
        player.hp = player.maxHp
        enterFloor(0)
        showMessage("You wake by the campfire… (−$lost gold)", GOLD)
    }

    fun townPortal() {
        if (dead || inVillage) return
        sfx.portal()
        burst(player.x, player.y, Color(0xFF64B5F6), 40, glow = true)
        if (inWorld) {
            player.x = dungeon.start.cx + 0.5f
            player.y = dungeon.start.cy + 0.5f
            snapCamera()
            burst(player.x, player.y, Color(0xFF64B5F6), 40, glow = true)
        } else {
            enterFloor(0)
        }
    }

    private fun snapCamera() {
        camX = player.x
        camY = player.y
    }

    private fun enterRegion(e: Entrance) {
        if (questStage < e.region.quest) {
            if (messageTimer <= 0f) showMessage("${e.region.title} is sealed — ${e.region.lockText}", HURT_COLOR)
            return
        }
        val target = if (e.region == Region.DESERT) {
            // The desert keeps no record of the deepest floor, so every crossing starts at its first depth.
            DESERT_FIRST
        } else if (deepest >= e.region.firstFloor) {
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
        fade = max(0f, fade - dt * 2f)
        if (streakTimer > 0f) {
            streakTimer -= dt
            if (streakTimer <= 0f) {
                if (streak >= 5) {
                    val bonus = streak * (4 + player.level * 2)
                    showMessage("MASSACRE ×$streak!  +$bonus XP", Color(0xFFFF8A65))
                    gainXp(bonus)
                    sfx.levelUp()
                }
                streak = 0
            }
        }
        if (hitStop > 0f) {
            // A brief freeze on heavy hits makes them land harder.
            hitStop -= dt
            updateParticles(dt * 0.25f)
            return
        }
        updateParticles(dt)
        updateTexts(dt)
        ambientParticles()
        updateCamera(dt)
        updateWeather(dt)
        if (bossIntroTime > 0f) {
            bossIntroTime -= dt
            if (bossIntroTime <= 0f) bossIntro = null
        }
        if (corpses.isNotEmpty()) corpses.removeAll { it.age += dt; it.age > 1.2f }
        if (bolts.isNotEmpty()) bolts.removeAll { it.age += dt; it.age > 0.28f }
        if (waves.isNotEmpty()) waves.removeAll { it.age += dt; it.age > it.life }
        if (skillFx.isNotEmpty()) skillFx.removeAll { it.age += dt; it.age > it.life }
        if (ghosts.isNotEmpty()) ghosts.removeAll { it.age += dt; it.age > 0.3f }
        if (dead || victory) return
        updatePlayer(dt)
        updateNpcs(dt)
        updateEnemies(dt)
        updateProjectiles(dt)
        updateZones(dt)
        updateAssassinSorceressSkills(dt)
        updateLoot(dt)
        reveal()
    }

    private fun updateWeather(dt: Float) {
        weatherTimer -= dt
        if (weatherTimer <= 0f) {
            weatherTimer = 70f + rnd.nextFloat() * 120f
            rainTarget = if (rainTarget > 0f || rnd.nextFloat() < 0.6f) 0f else 0.5f + rnd.nextFloat() * 0.5f
        }
        val target = if (inWorld) rainTarget else 0f
        rain += (target - rain) * min(1f, dt * 0.4f)
    }

    private fun updateCamera(dt: Float) {
        // Only the 2D renderer looks through this camera; the 3D view follows the hero itself.
        if (render3d) {
            camStale = true
            followCamera(dt)
            return
        }
        if (camStale) {
            camStale = false
            snapCamera()
        }
        val p = player
        val lead = if (p.moving) 0.9f else 0.3f
        val tx = p.x + p.faceX * lead
        val ty = p.y + p.faceY * lead
        val k = min(1f, dt * 5f)
        camX += (tx - camX) * k
        camY += (ty - camY) * k
        if (abs(camX - p.x) > 6f || abs(camY - p.y) > 6f) snapCamera()
    }

    fun dodge() {
        val p = player
        if (dead || p.dodgeCd > 0f || p.dodge > 0f || p.busy) return
        var dx = joyX
        var dy = joyY
        val len = hypot(dx, dy)
        if (len < 0.2f) {
            dx = p.faceX
            dy = p.faceY
        } else {
            dx /= len
            dy /= len
        }
        p.dodgeX = dx
        p.dodgeY = dy
        p.faceX = dx
        p.faceY = dy
        p.dodge = 0.26f
        p.dodgeCd = 1.0f
        sfx.swing()
        burst(p.x, p.y, if (inWorld) Color(0xFF8D7B5E) else Color(0xFF6D625A), 10)
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
        for (n in dungeon.npcs) if (n !== b) pushFrom(b, r, n.x, n.y, 0.25f)
    }

    private fun updateNpcs(dt: Float) {
        val v = dungeon.village ?: return
        for (n in dungeon.npcs) {
            n.anim += dt
            if (n.sayTime > 0f) {
                n.sayTime -= dt
                if (n.sayTime <= 0f) n.say = null
            }
            val dp = hypot(player.x - n.x, player.y - n.y).coerceAtLeast(0.01f)
            if (n.kind == NpcKind.VILLAGER_F || n.kind == NpcKind.VILLAGER_M) {
                if (n.wait > 0f) {
                    n.wait -= dt
                    n.moving = false
                } else {
                    val dx = n.tx - n.x
                    val dy = n.ty - n.y
                    val d = hypot(dx, dy)
                    if (d < 0.2f) {
                        n.wait = 2f + rnd.nextFloat() * 4f
                        repeat(10) {
                            val tx = v.x + 1 + rnd.nextFloat() * (v.w - 2)
                            val ty = v.y + 1 + rnd.nextFloat() * (v.h - 2)
                            if (dungeon.walkableAt(tx, ty)) {
                                n.tx = tx
                                n.ty = ty
                                return@repeat
                            }
                        }
                    } else {
                        val ox = n.x
                        val oy = n.y
                        move(n, dx / d * 1.1f * dt, dy / d * 1.1f * dt, 0.25f)
                        n.faceX = dx / d
                        n.faceY = dy / d
                        n.moving = true
                        if (hypot(n.x - ox, n.y - oy) < 0.0005f) n.wait = 0.5f.also { n.tx = n.x; n.ty = n.y }
                    }
                }
                if (dp < 2.2f && n.say == null && rnd.nextFloat() < dt * 0.4f) {
                    n.say = villagerLines.random(rnd)
                    n.sayTime = 3.5f
                    n.wait = max(n.wait, 2f)
                    n.faceX = (player.x - n.x) / dp
                    n.faceY = (player.y - n.y) / dp
                }
            } else if (dp < 3f && n.say == null && rnd.nextFloat() < dt * 0.25f) {
                n.say = if (n.kind == NpcKind.SMITH) "Need sharper steel?" else if (bounty?.done == true) "You did it! Come and collect your reward." else "I have a task for you, adventurer."
                n.sayTime = 3f
            }
        }
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
        p.dodgeCd = max(0f, p.dodgeCd - dt)
        if (p.chill > 0f) {
            p.chill -= dt
            if (rnd.nextFloat() < dt * 12f) particles += Particle(p.x + jitter(), p.y, 0f, -0.4f, Color(0xFFB3E5FC), 0.05f, 0.6f, z = 0.6f)
        }
        p.sinceHurt += dt
        for (e in p.cooldowns.entries) e.setValue(max(0f, e.value - dt * p.cooldownRate))
        if (p.undyingCd > 0f) p.undyingCd -= dt
        if (p.buffTime > 0f) {
            p.buffTime -= dt
            if (p.buffTime <= 0f) p.buff = null
        }
        p.mana = min(p.maxMana, p.mana + p.manaRegen * dt)
        p.holy = max(0f, p.holy - dt)
        p.fury = max(0f, p.fury - dt)
        p.venom = max(0f, p.venom - dt)
        if (p.stealth > 0f) {
            p.stealth -= dt
            if (rnd.nextFloat() < dt * 10f) particles += Particle(p.x + jitter(), p.y, 0f, -0.3f, Color(0x8890A4AE), 0.08f, 0.8f, z = 0.5f)
        }
        if (updateClassMoves(dt)) {
            pushOutOfProps(p, 0.28f)
            return
        }
        if (p.sinceHurt > 4f || inVillage) p.hp = min(p.maxHp, p.hp + p.maxHp * (if (inVillage) 0.1f else 0.012f) * dt)

        val len = hypot(joyX, joyY)
        p.moving = len > 0.15f
        if (p.dodge > 0f) {
            p.dodge -= dt
            move(p, p.dodgeX * 9f * dt, p.dodgeY * 9f * dt, 0.28f)
            ghosts += Ghost(p.x, p.y, dirRow(p.faceX, p.faceY))
            p.moving = true
            p.walk += dt * 20f
        } else run {
            // Velocity eases towards the stick (quick to start, a short glide to stop) so movement feels fluid.
            val speed = p.speed * min(1f, len)
            val tx = if (p.moving) joyX / len * speed else 0f
            val ty = if (p.moving) joyY / len * speed else 0f
            val k = min(1f, dt * (if (p.moving) 16f else 11f))
            p.vx += (tx - p.vx) * k
            p.vy += (ty - p.vy) * k
            if (p.moving && p.swing <= 0f && p.whirl <= 0f && p.cast <= 0f) {
                p.faceX = joyX / len
                p.faceY = joyY / len
            }
            val v = hypot(p.vx, p.vy)
            if (v > 0.02f) move(p, p.vx * dt, p.vy * dt, 0.28f) else {
                p.vx = 0f
                p.vy = 0f
            }
            p.moving = v > 0.6f
            if (!p.moving) return@run
            p.walk += dt * v * 2.2f
            p.stepTimer -= dt
            if (p.stepTimer <= 0f) {
                p.stepTimer = 0.28f
                val dust = if (inWorld) Color(0x998D7B5E) else Color(0x776D625A)
                particles += Particle(p.x, p.y + 0.1f, (rnd.nextFloat() - 0.5f) * 0.6f, -0.2f, dust, 0.05f, 0.5f, z = 0.05f)
            }
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
                if (messageTimer <= 0f) showMessage("Defeat ${boss!!.type.label} first!", HURT_COLOR)
            } else {
                sfx.stairs()
                enterFloor(nextFloor())
            }
        }
    }

    /** Where the stairs lead: one floor deeper, deeper into the desert, or home once the pharaoh's court is cleared. */
    private fun nextFloor(): Int = when {
        !inDesert -> floor + 1
        floor == DESERT_LAST -> 0
        else -> floor - 1
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
        if (dead || p.attackCd > 0f || p.busy) return
        val kind = p.weaponKind
        if (kind == WeaponKind.STAFF) {
            arcaneBolt()
            return
        }
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
        if (p.venom > 0f) {
            e.poison = 3f
            e.poisonDps = max(e.poisonDps, p.damage * p.venomPct / 3f)
        }
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
                if (t !== e) bolts += Bolt(fromX, fromY, t.x, t.y, rnd.nextInt())
                burst(t.x, t.y - 0.5f, LIGHTNING, 5, glow = true)
                damageEnemy(t, p.damage * 0.8f, 1f)
                fromX = t.x
                fromY = t.y
            }
            bolts += Bolt(e.x, e.y - 3f, e.x, e.y, rnd.nextInt())
            sfx.zap()
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
            showMessage("Learn ${skill.label} under ✨ Skills", skill.color)
            return
        }
        if (!skillReady(skill) || p.busy) return
        val chainTarget = if (skill == Skill.CHAIN) nearestEnemy(6.5f) else null
        if (skill == Skill.CHAIN && chainTarget == null) {
            texts += FloatText(p.x, p.y - 1.4f, "No target", LIGHTNING)
            return
        }
        val cost = if ((skill == Skill.WHIRL || skill == Skill.BERSERK) && p.has(Power.STORM)) 0f else skill.mana
        if (p.mana < cost) {
            showMessage("Not enough mana", Color(0xFF64B5F6))
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
            Skill.CHAIN -> chainLightning(chainTarget!!, lvl)
            Skill.METEOR -> {
                val t = nearestEnemy(8f)
                val tx = t?.x ?: (p.x + p.faceX * 4f)
                val ty = t?.y ?: (p.y + p.faceY * 4f)
                t?.let { faceToward(it.x, it.y) }
                p.cast = 0.4f
                meteors += Meteor(tx, ty, p.damage * (3f + 0.6f * (lvl - 1)) * spellMult())
                sfx.fireball()
            }
            // ---- Assassin and Sorceress skills from the skill tree (state and per-frame logic under "Assassin and
            // Sorceress skill-tree actives" below). Each comment lists what the 3D view gets; "sf" entries are
            // [skillOrdinal, x, y, tx, ty, dx, dy, progress = age / life, value].

            // BLADE_DANCE: the hero hops between up to 5 different enemies within 6 tiles (nearest first, 0.12 s per hop,
            // only along clear paths) and strikes each once; nothing can hurt him meanwhile. No target: refunded.
            //   sf, one per hop: x, y = where the hop starts; tx, ty = the strike point next to the enemy; dx, dy = unit
            //   direction of the hop; value = hop index 0..4; life 0.35 s.
            //   Also: ghosts "gh" every frame along the path, hero action 2 (attack) restarted at every hop, violet spark
            //   particles and a 0.03 s hit-stop at each strike, a violet wave "wa" (radius 1.6) when the dance ends.
            Skill.BLADE_DANCE -> if (!bladeDance(lvl)) {
                p.mana += cost
                p.cooldowns[skill] = 0f
                texts += FloatText(p.x, p.y - 1.4f, "No target", skill.color)
            }
            // DEATH_TRAP: plants a trap 0.9 tiles ahead (underfoot next to a wall); up to 3, the oldest fizzles when a
            // fourth is planted. It arms after 0.5 s, lasts 15 s and goes off when an enemy comes within 1.3 tiles.
            //   Zone "zo" kind TRAP: [x, y, 1.3 (trigger radius), 4, progress]; armed once progress >= 0.5 / 15 = 0.033.
            //   The zone disappears when the trap goes off: then 10 shrapnel projectiles "pr" (small, color 0xFFFFCC80,
            //   speed 10, life 0.38 s), an orange wave "wa" (radius blast + 0.4), ring/burst particles, a scorch decal,
            //   shake 0.6 and a 0.05 s hit-stop. No sf. Hero action 3 (cast) while planting.
            Skill.DEATH_TRAP -> plantTrap(lvl)
            // MARK_FOR_DEATH: marks the nearest enemy within 8 tiles for 8 s: it takes +40..60% damage from every source
            // (damageEnemy and poison use Enemy.damageTakenMult). Killing it restores mana and resets this cooldown.
            // A new mark replaces the old one. No target: refunded.
            //   sf: x, y = the marked enemy (updated every frame); tx, ty = the hero (updated every frame); dx, dy = 0;
            //   value = the enemy's body radius in tiles (type radius x size), to size the sigil; life 8 s, removed early
            //   when the enemy dies or the mark is replaced.
            //   Also: red ring particles + "Marked" text on the enemy; at the kill a red ring, a blue burst and "+N mana".
            //   Hero action 3 (cast).
            Skill.MARK_FOR_DEATH -> if (!markForDeath(lvl)) {
                p.mana += cost
                p.cooldowns[skill] = 0f
                texts += FloatText(p.x, p.y - 1.4f, "No target", skill.color)
            }
            // DEATH_BLOSSOM (ultimate): for 3 s a ring of blades (radius 2.3) spins around the hero, hitting everything
            // inside 4 times a second; the hero keeps moving, attacking and casting.
            //   sf: x, y = the hero (updated every frame); tx, ty = the hero too; dx, dy = (cos, sin) of the ring's spin
            //   angle (turns at 11 rad/s); value = ring radius 2.3; life 3 s.
            //   Also: pink glow petal particles along the ring, a pink ring/wave at the start, hero action 10 (sweep)
            //   for 0.45 s at the start.
            Skill.DEATH_BLOSSOM -> deathBlossom(lvl)
            // FROZEN_ORB: a slow orb (3.4 tiles/s, 1.6 s) flies toward the nearest enemy within 8 tiles (or ahead),
            // passing through enemies and spraying an ice shard every 0.07 s, then bursts (radius 2.2, chills 3 s);
            // it bursts early against a wall. Every shard chills (half speed) for 1.5 s.
            //   sf: x, y = the orb (updated every frame); tx, ty = where it was launched; dx, dy = unit flight direction;
            //   value = orb radius 0.45; life 1.6 s (removed at the burst).
            //   Shards: small projectiles "pr" (color 0xFFB3E5FC, radius 0.1, speed 7, life 0.45 s; 12 more fly out
            //   radially at the burst). Burst: frost ring particles + wave "wa", glow burst, shake 0.35. Hero action 3.
            Skill.FROZEN_ORB -> frozenOrb(lvl)
            // BLIZZARD: ice rains on the nearest enemy within 8 tiles (or ahead) for 5 s, radius 2.5..2.9: damage every
            // 0.5 s through the zone code, and everything inside is chilled (half speed).
            //   Zone "zo" kind BLIZZARD: [x, y, radius, 2, progress]. Also a pale blue wave "wa" at the cast and frost
            //   glint particles on the ground while it lasts. No sf. Hero action 3 (cast).
            Skill.BLIZZARD -> blizzard(lvl)
            // TELEPORT: blinks 5..7 tiles along the joystick (or facing), stopping before walls and water, with an arcane
            // burst (radius 1.6, knocks back) where the hero leaves and where he lands.
            //   sf: x, y = from; tx, ty = to; dx, dy = unit direction; value = burst radius 1.6; life 0.5 s.
            //   Also: a ghost "gh" at the start point, violet ring particles + waves "wa" and glow bursts at both ends.
            //   Hero action 3 (cast).
            Skill.TELEPORT -> teleport(lvl)
            // BLACK_HOLE (ultimate): a vortex on the biggest pack within 8 tiles (or ahead) pulls enemies within 4.5 tiles
            // toward its centre for 3 s (walls still stop them; bosses resist), hurting them twice a second, then
            // implodes (radius 2.8): big damage, outward knock-back and a stun.
            //   Zone "zo" kind BLACK_HOLE: [x, y, 4.5 (pull radius), 3, progress] for the 3 s pull.
            //   sf vortex: x, y = tx, ty = centre; dx, dy = (cos, sin) of the swirl angle (turns at 6 rad/s); value = pull
            //   radius 4.5; life 3 s (removed at the implosion).
            //   sf implosion: x, y = tx, ty = centre; dx = dy = 0; value = NEGATIVE implosion radius (-2.8); life 0.5 s.
            //   Also: violet particles spiralling inward during the pull; at the implosion a violet wave "wa", ring and
            //   glow bursts, a scorch decal, shake 1 and a 0.1 s hit-stop. Hero action 3 (cast) for 0.5 s.
            Skill.BLACK_HOLE -> blackHole(lvl)
            Skill.SHIELD_CHARGE -> {
                nearestEnemy(6f)?.let { faceToward(it.x, it.y) }
                p.charge = 0.32f + 0.02f * lvl
                p.chargeX = p.faceX
                p.chargeY = p.faceY
                p.chargeHit.clear()
                sfx.swing()
                burst(p.x, p.y, Color(0xFFB0BEC5), 12)
            }
            Skill.CONSECRATE -> {
                p.cast = 0.35f
                zones += Zone(p.x, p.y, 2.7f, 6f, ZoneKind.CONSECRATE, p.damage * (0.4f + 0.1f * (lvl - 1)))
                ring(p.x, p.y, 0.4f, Color(0xFFFFE082), 30, 5f)
                sfx.levelUp()
            }
            Skill.HOLY_SHIELD -> {
                p.holy = 6f + 2f * lvl
                p.hp = min(p.maxHp, p.hp + p.maxHp * (0.15f + 0.05f * lvl))
                ring(p.x, p.y, 0.2f, Color(0xFFFFF59D), 30, 3f)
                sfx.potion()
                texts += FloatText(p.x, p.y - 1.4f, "Holy Shield", Color(0xFFFFF59D))
            }
            Skill.LEAP -> {
                val t = nearestEnemy(7f)
                var tx = t?.x ?: (p.x + p.faceX * 4f)
                var ty = t?.y ?: (p.y + p.faceY * 4f)
                if (!dungeon.walkableAt(tx, ty)) {
                    tx = p.x
                    ty = p.y
                }
                faceToward(tx, ty)
                p.leapFromX = p.x
                p.leapFromY = p.y
                p.leapToX = tx
                p.leapToY = ty
                p.leapDur = 0.5f
                p.leap = p.leapDur
                p.leapPower = 1.8f + 0.4f * (lvl - 1)
                sfx.swing()
            }
            Skill.WAR_CRY -> {
                p.fury = 8f + 2f * lvl
                for (e in enemies) if (dist(e) < 5.5f) {
                    e.fear = if (e.type.boss) 0.8f else 2.5f + 0.25f * lvl
                    e.windup = 0f
                }
                ring(p.x, p.y, 0.4f, Color(0xFFFF7043), 36, 6f)
                shake = max(shake, 0.4f)
                sfx.levelUp()
                texts += FloatText(p.x, p.y - 1.5f, "RAAAGH!", Color(0xFFFF7043), big = true)
            }
            Skill.BERSERK -> {
                p.spin = 1.5f + 0.25f * lvl
                p.spinTick = 0f
                p.spinPower = 0.7f + 0.15f * (lvl - 1)
            }
            Skill.EARTHQUAKE -> {
                p.cast = 0.35f
                val dmg = p.damage * (2.2f + 0.5f * (lvl - 1))
                for (e in enemies.toList()) if (dist(e) < 3.6f) {
                    damageEnemy(e, dmg, 9f)
                    e.stun = max(e.stun, if (e.type.boss) 0.5f else 1.2f)
                }
                for (pr in dungeon.props) if (pr.type.breakable && !pr.used && hypot(pr.x - p.x, pr.y - p.y) < 3.6f) breakProp(pr)
                ring(p.x, p.y, 0.5f, Color(0xFFBCAAA4), 40, 7f)
                waves += Wave(p.x, p.y, 4.6f, Color(0xFF8D6E63), 0.6f)
                repeat(24) {
                    val a = rnd.nextFloat() * 6.283f
                    val r = rnd.nextFloat() * 3.4f
                    particles += Particle(p.x + cos(a) * r, p.y + sin(a) * r, 0f, -1.5f, Color(0xFF8D7B5E), 0.06f + rnd.nextFloat() * 0.06f, 0.7f, gravity = 5f, z = 0.05f)
                }
                addDecal(p.x, p.y, 4, 2.4f)
                shake = 1f
                hitStop = max(hitStop, 0.08f)
                sfx.explode()
                sfx.rumble(60, 230)
            }
            Skill.SHADOW_STEP -> {
                val t = nearestEnemy(7f)
                if (t == null) {
                    p.mana += cost
                    p.cooldowns[skill] = 0f
                    texts += FloatText(p.x, p.y - 1.4f, "No target", skill.color)
                    return
                }
                val dx = t.x - p.x
                val dy = t.y - p.y
                val d = hypot(dx, dy).coerceAtLeast(0.01f)
                var nx = t.x + dx / d * 0.85f
                var ny = t.y + dy / d * 0.85f
                if (!dungeon.walkableAt(nx, ny)) {
                    nx = t.x - dx / d * 0.85f
                    ny = t.y - dy / d * 0.85f
                }
                burst(p.x, p.y - 0.4f, Color(0xFF7C4DFF), 18, glow = true)
                if (dungeon.walkableAt(nx, ny)) {
                    p.x = nx
                    p.y = ny
                }
                faceToward(t.x, t.y)
                burst(p.x, p.y - 0.4f, Color(0xFF7C4DFF), 18, glow = true)
                p.swingTime = 0.25f
                p.swing = p.swingTime
                damageEnemy(t, p.damage * (2f + 0.4f * (lvl - 1)), 5f, forceCrit = true)
                onHitPowers(t)
                sfx.portal()
            }
            Skill.FAN_OF_KNIVES -> {
                val n = 8 + 2 * lvl
                for (k in 0 until n) {
                    val a = k * 2f * PI.toFloat() / n
                    projectiles += Projectile(
                        p.x, p.y, cos(a) * 11f, sin(a) * 11f, p.damage * (0.9f + 0.2f * (lvl - 1)), hostile = false,
                        color = Color(0xFFE0E0E0), life = 0.45f, radius = 0.12f, small = true,
                        poison = if (p.venom > 0f) p.damage * p.venomPct / 3f else 0f,
                    )
                }
                p.whirl = 0.3f
                sfx.swing()
            }
            Skill.SMOKE_BOMB -> {
                p.stealth = 3f + lvl
                for (e in enemies) if (!e.type.boss) {
                    e.aggro = false
                    e.windup = 0f
                }
                repeat(22) {
                    val a = rnd.nextFloat() * 6.283f
                    val sp = 0.4f + rnd.nextFloat() * 1.2f
                    val shade = if (rnd.nextBoolean()) Color(0x8C4A4458) else Color(0x80626A78)
                    particles += Particle(p.x, p.y, cos(a) * sp, sin(a) * sp * 0.6f, shade, 0.35f + rnd.nextFloat() * 0.3f, 1.4f + rnd.nextFloat() * 0.6f, z = 0.2f + rnd.nextFloat() * 0.6f, soft = true)
                }
                sfx.portal()
            }
            Skill.VENOM -> {
                p.venom = 8f + 2f * lvl
                p.venomPct = 0.5f + 0.15f * (lvl - 1)
                burst(p.x, p.y - 0.5f, Color(0xFF9CCC65), 20, glow = true)
                sfx.potion()
            }
            else -> {} // implemented by the class skill agents
        }
    }

    /** Arcane bolt: the staff's basic attack is a seeking shot of magic. */
    private fun arcaneBolt() {
        val p = player
        val target = nearestEnemy(8f)
        target?.let { faceToward(it.x, it.y) }
        p.attackCd = WeaponKind.STAFF.cooldown / (1f + p.attackSpeed / 100f)
        p.cast = 0.25f
        val dx = target?.let { it.x - p.x } ?: p.faceX
        val dy = target?.let { it.y - p.y } ?: p.faceY
        val d = hypot(dx, dy).coerceAtLeast(0.01f)
        projectiles += Projectile(
            p.x + dx / d * 0.5f, p.y + dy / d * 0.5f, dx / d * 10f, dy / d * 10f, p.damage * 0.95f * spellMult(), hostile = false,
            color = Color(0xFFB388FF), life = 0.8f, radius = 0.13f, small = true,
        )
        sfx.zap()
    }

    /** Skills that take over the hero's movement for a moment. Returns true while one is running. */
    private fun updateClassMoves(dt: Float): Boolean {
        val p = player
        if (p.dance > 0f) {
            updateBladeDance(dt)
            return true
        }
        if (p.leap > 0f) {
            p.leap -= dt
            val k = (1f - p.leap / p.leapDur).coerceIn(0f, 1f)
            p.x = p.leapFromX + (p.leapToX - p.leapFromX) * k
            p.y = p.leapFromY + (p.leapToY - p.leapFromY) * k
            if (p.leap <= 0f) {
                val dmg = p.damage * p.leapPower
                for (e in enemies.toList()) if (dist(e) < 2.3f) {
                    damageEnemy(e, dmg, 7f)
                    e.stun = max(e.stun, if (e.type.boss) 0.4f else 1f)
                }
                for (pr in dungeon.props) if (pr.type.breakable && !pr.used && hypot(pr.x - p.x, pr.y - p.y) < 2.3f) breakProp(pr)
                ring(p.x, p.y, 0.3f, Color(0xFFFFAB40), 30, 5f)
                burst(p.x, p.y, if (inWorld) Color(0xFF8D7B5E) else Color(0xFF6D625A), 24)
                addDecal(p.x, p.y, 4, 1.3f)
                shake = max(shake, 0.8f)
                hitStop = max(hitStop, 0.06f)
                sfx.explode()
                sfx.rumble(45, 200)
            }
            return true
        }
        if (p.charge > 0f) {
            p.charge -= dt
            val bx = p.x
            val by = p.y
            move(p, p.chargeX * 13f * dt, p.chargeY * 13f * dt, 0.28f)
            if (rnd.nextFloat() < 0.7f) ghosts += Ghost(p.x, p.y, dirRow(p.faceX, p.faceY), 12)
            for (e in enemies.toList()) if (e !in p.chargeHit && dist(e) < 1.0f + e.type.radius * e.size) {
                p.chargeHit += e
                damageEnemy(e, p.damage * (1.5f + 0.3f * ((p.skills[Skill.SHIELD_CHARGE] ?: 1) - 1)), 9f)
                e.stun = max(e.stun, if (e.type.boss) 0.4f else 1f + 0.25f * (p.skills[Skill.SHIELD_CHARGE] ?: 1))
                sfx.hit()
                shake = max(shake, 0.3f)
            }
            // Stop at walls.
            if (hypot(p.x - bx, p.y - by) < 0.01f) p.charge = 0f
            return true
        }
        if (p.spin > 0f) {
            p.spin -= dt
            p.spinTick -= dt
            if (p.spinTick <= 0f) {
                p.spinTick = 0.22f
                var hit = false
                for (e in enemies.toList()) if (dist(e) < 1.9f + e.type.radius * e.size) {
                    damageEnemy(e, p.damage * p.spinPower, 2.5f)
                    onHitPowers(e)
                    hit = true
                }
                for (pr in dungeon.props) if (pr.type.breakable && !pr.used && hypot(pr.x - p.x, pr.y - p.y) < 1.9f) breakProp(pr)
                sfx.swing()
                if (hit) sfx.hit()
            }
            // The hero can steer while spinning, a little slower than walking.
            val len = hypot(joyX, joyY)
            if (len > 0.15f) move(p, joyX / len * p.speed * 0.8f * dt, joyY / len * p.speed * 0.8f * dt, 0.28f)
            if (rnd.nextFloat() < 0.6f) particles += Particle(p.x + jitter() * 2f, p.y + jitter(), 0f, -0.3f, Color(0x99CFD8DC), 0.05f, 0.35f, z = 0.4f)
            return true
        }
        return false
    }

    /** Hallowed ground and burning craters, plus meteors on their way down. */
    private fun updateZones(dt: Float) {
        val p = player
        val mi = meteors.iterator()
        while (mi.hasNext()) {
            val m = mi.next()
            m.t -= dt
            if (m.t > 0f) continue
            mi.remove()
            for (e in enemies.toList()) if (hypot(e.x - m.x, e.y - m.y) < 2.3f + e.type.radius) damageEnemy(e, m.dmg, 6f)
            zones += Zone(m.x, m.y, 1.8f, 3f, ZoneKind.FIRE, m.dmg * 0.12f)
            ring(m.x, m.y, 0.3f, Color(0xFFFF7043), 40, 6f)
            waves += Wave(m.x, m.y, 3f, Color(0xFFFF5722), 0.5f)
            burst(m.x, m.y, Color(0xFFFFAB40), 40, glow = true)
            addDecal(m.x, m.y, 4, 2.2f)
            shake = max(shake, 0.9f)
            hitStop = max(hitStop, 0.05f)
            sfx.explode()
            sfx.rumble(45, 200)
        }
        val zi = zones.iterator()
        while (zi.hasNext()) {
            val z = zi.next()
            z.age += dt
            if (z.age >= z.life) {
                zi.remove()
                continue
            }
            // The pharaoh's sandstorm hurts the hero, not monsters.
            if (z.kind == ZoneKind.SANDSTORM) {
                sandstorm(z, dt)
                continue
            }
            // Visual-only zones (Death Traps, Black Holes) do their work elsewhere.
            if (z.dps <= 0f) continue
            z.tick -= dt
            if (z.tick > 0f) continue
            z.tick = 0.5f
            for (e in enemies.toList()) if (hypot(e.x - z.x, e.y - z.y) < z.radius + e.type.radius) damageEnemy(e, z.dps * 0.5f, 0.5f)
            if (z.kind == ZoneKind.CONSECRATE && hypot(p.x - z.x, p.y - z.y) < z.radius) {
                val lvl = p.skills[Skill.CONSECRATE] ?: 1
                p.hp = min(p.maxHp, p.hp + p.maxHp * (0.02f + 0.01f * lvl) * 0.5f)
            }
        }
    }

    private fun chainLightning(first: Enemy, lvl: Int) {
        val p = player
        faceToward(first.x, first.y)
        p.cast = 0.3f
        val hit = mutableListOf<Enemy>()
        var fromX = p.x + p.faceX * 0.3f
        var fromY = p.y + p.faceY * 0.3f - 0.6f
        var next: Enemy? = first
        val dmg = p.damage * (1.1f + 0.3f * (lvl - 1)) * spellMult()
        while (next != null && hit.size < 2 + lvl) {
            val t = next
            bolts += Bolt(fromX, fromY, t.x, t.y - 0.5f, rnd.nextInt())
            burst(t.x, t.y - 0.5f, LIGHTNING, 6, glow = true)
            damageEnemy(t, dmg * (1f - 0.08f * hit.size), 1.5f)
            hit += t
            fromX = t.x
            fromY = t.y - 0.5f
            next = enemies.filter { it !in hit && it.hp > 0f && hypot(it.x - t.x, it.y - t.y) < 4f }
                .minByOrNull { hypot(it.x - t.x, it.y - t.y) }
        }
        sfx.zap()
        shake = max(shake, 0.15f)
    }

    // ---------------------------------------------------------------- Assassin and Sorceress skill-tree actives

    /** A planted Death Trap: its zone (kind TRAP), the blast damage and the blast radius. */
    private class Trap(val zone: Zone, val dmg: Float, val blast: Float)

    /** A Frozen Orb in flight on [home]: damage per shard and of the final burst, and its cue in [skillFx]. */
    private class FrozenOrb(val home: Dungeon, var x: Float, var y: Float, val dx: Float, val dy: Float, val shard: Float, val burst: Float, val fx: SkillFx) {
        var life = ORB_LIFE
        var spray = 0f
        var angle = 0f
    }

    /** A Black Hole on [home]: its zone (kind BLACK_HOLE), its vortex cue, damage per tick and of the implosion. */
    private class Vortex(val home: Dungeon, val zone: Zone, val fx: SkillFx, val tick: Float, val implode: Float) {
        var t = 0f
        var tickT = 0f
        var angle = 0f
    }

    private val traps = mutableListOf<Trap>()
    private val orbs = mutableListOf<FrozenOrb>()
    private val vortices = mutableListOf<Vortex>()
    /** Blade Dance: enemies struck so far, the one the current hop goes for, and the hop itself. */
    private val danceHit = mutableListOf<Enemy>()
    private var danceTarget: Enemy? = null
    private var danceDungeon: Dungeon? = null
    private var danceHop = 0f
    private var danceFromX = 0f
    private var danceFromY = 0f
    private var danceToX = 0f
    private var danceToY = 0f
    private var dancePower = 1.4f
    private var markTarget: Enemy? = null
    private var markFx: SkillFx? = null
    private var blossomFx: SkillFx? = null
    private var blossomTick = 0f
    private var blossomAngle = 0f
    private var blossomPower = 0.75f

    /** How far the hero gets from (x, y) going up to [range] tiles along the unit vector (dx, dy) before a wall or water stops him. */
    private fun blinkReach(x: Float, y: Float, dx: Float, dy: Float, range: Float): Float {
        val steps = kotlin.math.ceil(range / 0.1f).toInt()
        var reach = 0f
        for (i in 1..steps) {
            val s = range * i / steps
            if (blocked(x + dx * s, y + dy * s, 0.28f)) break
            reach = s
        }
        return reach
    }

    /** A spot up to [ahead] tiles in front of the hero, short of any wall. */
    private fun spotAhead(ahead: Float): Pair<Float, Float> {
        val p = player
        val r = blinkReach(p.x, p.y, p.faceX, p.faceY, ahead)
        return (p.x + p.faceX * r) to (p.y + p.faceY * r)
    }

    /** Knocks [e] away from (x, y), the way [damageEnemy] knocks it away from the hero. */
    private fun shoveFrom(e: Enemy, x: Float, y: Float, knock: Float) {
        val dx = e.x - x
        val dy = e.y - y
        val d = hypot(dx, dy).coerceAtLeast(0.01f)
        val k = if (e.type.boss) knock * 0.12f else knock / e.size
        e.kx += dx / d * k
        e.ky += dy / d * k
    }

    /** Frost slows a monster to half speed for [seconds] (half as long for bosses). */
    private fun chillEnemy(e: Enemy, seconds: Float) {
        e.chill = max(e.chill, if (e.type.boss) seconds * 0.5f else seconds)
    }

    private fun bladeDance(lvl: Int): Boolean {
        val p = player
        danceHit.clear()
        danceDungeon = dungeon
        dancePower = 1.4f + 0.3f * (lvl - 1)
        val fromX = p.x
        val fromY = p.y
        if (!nextDanceHop()) return false
        burst(fromX, fromY - 0.4f, Skill.BLADE_DANCE.color, 14, glow = true)
        sfx.swing()
        return true
    }

    /** Starts the next hop of a Blade Dance, toward the nearest reachable enemy not struck yet; false when none is left. */
    private fun nextDanceHop(): Boolean {
        val p = player
        if (danceHit.size >= DANCE_TARGETS) return false
        val candidates = enemies.filter { it.hp > 0f && it !in danceHit && dist(it) < DANCE_REACH }.sortedBy { dist(it) }
        for (t in candidates) {
            val dx = t.x - p.x
            val dy = t.y - p.y
            val d = hypot(dx, dy).coerceAtLeast(0.01f)
            // Stop just short of the enemy, and only if no wall is in the way.
            val stop = (d - t.type.radius * t.size - 0.35f).coerceAtLeast(0f)
            if (blinkReach(p.x, p.y, dx / d, dy / d, stop) < stop - 0.001f) continue
            danceHit += t
            danceTarget = t
            danceFromX = p.x
            danceFromY = p.y
            danceToX = p.x + dx / d * stop
            danceToY = p.y + dy / d * stop
            danceHop = DANCE_HOP
            p.dance = DANCE_HOP
            faceToward(t.x, t.y)
            p.swingTime = DANCE_HOP + 0.06f
            p.swing = p.swingTime
            skillFx += SkillFx(Skill.BLADE_DANCE, danceFromX, danceFromY, danceToX, danceToY, dx / d, dy / d, 0.35f, (danceHit.size - 1).toFloat())
            return true
        }
        return false
    }

    /** Carries the hero along the current hop of a Blade Dance and strikes at its end. Runs instead of walking. */
    private fun updateBladeDance(dt: Float) {
        val p = player
        if (danceDungeon !== dungeon) {
            p.dance = 0f
            danceTarget = null
            return
        }
        danceHop -= dt
        val k = (1f - danceHop / DANCE_HOP).coerceIn(0f, 1f)
        p.x = danceFromX + (danceToX - danceFromX) * k
        p.y = danceFromY + (danceToY - danceFromY) * k
        p.vx = 0f
        p.vy = 0f
        p.moving = true
        ghosts += Ghost(p.x, p.y, dirRow(p.faceX, p.faceY))
        if (danceHop > 0f) {
            p.dance = danceHop
            return
        }
        val t = danceTarget
        if (t != null && t.hp > 0f && t in enemies) {
            faceToward(t.x, t.y)
            damageEnemy(t, p.damage * dancePower, 3f)
            onHitPowers(t)
            burst(t.x, t.y - 0.4f, Skill.BLADE_DANCE.color, 8, glow = true)
            hitStop = max(hitStop, 0.03f)
            sfx.hit()
        }
        if (!nextDanceHop()) {
            p.dance = 0f
            danceTarget = null
            waves += Wave(p.x, p.y, 1.6f, Skill.BLADE_DANCE.color, 0.35f)
            sfx.swing()
        }
    }

    private fun plantTrap(lvl: Int) {
        val p = player
        var tx = p.x + p.faceX * 0.9f
        var ty = p.y + p.faceY * 0.9f
        if (blinkReach(p.x, p.y, p.faceX, p.faceY, 0.9f) < 0.899f) {
            tx = p.x
            ty = p.y
        }
        traps.removeAll { it.zone !in zones }
        if (traps.size >= MAX_TRAPS) {
            val old = traps.removeAt(0)
            zones.remove(old.zone)
            burst(old.zone.x, old.zone.y, Color(0xFF8D6E63), 8)
        }
        val z = Zone(tx, ty, TRAP_TRIGGER, TRAP_LIFE, ZoneKind.TRAP, 0f)
        zones += z
        traps += Trap(z, p.damage * (2.2f + 0.45f * (lvl - 1)), 2.1f + 0.1f * lvl)
        p.cast = 0.25f
        burst(tx, ty, Skill.DEATH_TRAP.color, 8)
        sfx.equip()
    }

    private fun trapBlast(tr: Trap) {
        val z = tr.zone
        for (e in enemies.toList()) if (e.hp > 0f && hypot(e.x - z.x, e.y - z.y) < tr.blast + e.type.radius * e.size) {
            damageEnemy(e, tr.dmg, 0f)
            shoveFrom(e, z.x, z.y, 6f)
        }
        for (pr in dungeon.props) if (pr.type.breakable && !pr.used && hypot(pr.x - z.x, pr.y - z.y) < tr.blast) breakProp(pr)
        // Shrapnel flies out in every direction.
        for (k in 0 until 10) {
            val a = (k + rnd.nextFloat() * 0.5f) * 2f * PI.toFloat() / 10f
            projectiles += Projectile(z.x, z.y, cos(a) * 10f, sin(a) * 10f, tr.dmg * 0.18f, hostile = false,
                color = Color(0xFFFFCC80), life = 0.38f, radius = 0.1f, small = true)
        }
        ring(z.x, z.y, 0.3f, Skill.DEATH_TRAP.color, 28, 5f)
        waves += Wave(z.x, z.y, tr.blast + 0.4f, Color(0xFFFF8A65), 0.45f)
        burst(z.x, z.y, Color(0xFFFFAB40), 26, glow = true)
        addDecal(z.x, z.y, 4, 1.2f)
        shake = max(shake, 0.6f)
        hitStop = max(hitStop, 0.05f)
        sfx.explode()
        sfx.rumble(35, 160)
    }

    private fun markForDeath(lvl: Int): Boolean {
        val p = player
        val t = nearestEnemy(8f) ?: return false
        clearMark()
        faceToward(t.x, t.y)
        p.cast = 0.3f
        t.mark = MARK_TIME
        t.markMult = 1.4f + 0.05f * (lvl - 1)
        markTarget = t
        val fx = SkillFx(Skill.MARK_FOR_DEATH, t.x, t.y, p.x, p.y, 0f, 0f, MARK_TIME, t.type.radius * t.size)
        skillFx += fx
        markFx = fx
        ring(t.x, t.y, 0.2f, Skill.MARK_FOR_DEATH.color, 18, 2.5f)
        texts += FloatText(t.x, t.y - 1.5f, "Marked", Skill.MARK_FOR_DEATH.color)
        sfx.zap()
        return true
    }

    private fun clearMark() {
        markTarget?.let {
            it.mark = 0f
            it.markMult = 1f
        }
        markFx?.let { skillFx.remove(it) }
        markTarget = null
        markFx = null
    }

    /** The marked monster died: mana comes back and the mark is ready again. Called by [kill]. */
    private fun markKilled(e: Enemy) {
        val p = player
        val lvl = p.skills[Skill.MARK_FOR_DEATH] ?: 1
        val gain = p.maxMana * (0.15f + 0.03f * lvl)
        p.mana = min(p.maxMana, p.mana + gain)
        p.cooldowns[Skill.MARK_FOR_DEATH] = 0f
        if (markTarget === e) {
            clearMark()
        } else {
            e.mark = 0f
        }
        ring(e.x, e.y, 0.3f, Skill.MARK_FOR_DEATH.color, 30, 4f)
        burst(e.x, e.y - 0.5f, Color(0xFF64B5F6), 16, glow = true)
        texts += FloatText(p.x, p.y - 1.6f, "+${gain.roundToInt()} mana", Color(0xFF64B5F6))
    }

    private fun deathBlossom(lvl: Int) {
        val p = player
        p.blossom = BLOSSOM_TIME
        blossomTick = 0f
        blossomPower = 0.75f + 0.2f * (lvl - 1)
        p.whirl = 0.45f
        blossomFx?.let { skillFx.remove(it) }
        val fx = SkillFx(Skill.DEATH_BLOSSOM, p.x, p.y, p.x, p.y, cos(blossomAngle), sin(blossomAngle), BLOSSOM_TIME, BLOSSOM_RADIUS)
        skillFx += fx
        blossomFx = fx
        ring(p.x, p.y, 0.4f, Skill.DEATH_BLOSSOM.color, 36, 5f)
        shake = max(shake, 0.4f)
        sfx.swing()
    }

    private fun frozenOrb(lvl: Int) {
        val p = player
        nearestEnemy(8f)?.let { faceToward(it.x, it.y) }
        p.cast = 0.3f
        val sx = p.x + p.faceX * 0.5f
        val sy = p.y + p.faceY * 0.5f
        val m = spellMult()
        val fx = SkillFx(Skill.FROZEN_ORB, sx, sy, sx, sy, p.faceX, p.faceY, ORB_LIFE + 0.1f, 0.45f)
        skillFx += fx
        orbs += FrozenOrb(dungeon, sx, sy, p.faceX, p.faceY, p.damage * (0.45f + 0.1f * (lvl - 1)) * m, p.damage * (1f + 0.25f * (lvl - 1)) * m, fx)
        burst(sx, sy - 0.3f, ORB_ICE, 10, glow = true)
        sfx.frost()
    }

    private fun orbBurst(o: FrozenOrb) {
        for (e in enemies.toList()) if (e.hp > 0f && hypot(e.x - o.x, e.y - o.y) < ORB_BURST + e.type.radius * e.size) {
            damageEnemy(e, o.burst, 0f)
            shoveFrom(e, o.x, o.y, 3f)
            chillEnemy(e, 3f)
        }
        for (k in 0 until 12) {
            val a = k * 2f * PI.toFloat() / 12f
            projectiles += Projectile(o.x, o.y, cos(a) * 8f, sin(a) * 8f, o.shard, hostile = false,
                color = ORB_ICE, life = 0.4f, radius = 0.1f, small = true, chill = 1.5f)
        }
        ring(o.x, o.y, 0.3f, FROST, 36, 5.5f)
        burst(o.x, o.y, Color(0xFFE1F5FE), 20, glow = true)
        shake = max(shake, 0.35f)
        sfx.frost()
    }

    private fun blizzard(lvl: Int) {
        val p = player
        val t = nearestEnemy(8f)
        val spot = if (t != null) (t.x to t.y) else spotAhead(4f)
        t?.let { faceToward(it.x, it.y) }
        p.cast = 0.4f
        val r = 2.4f + 0.1f * lvl
        zones += Zone(spot.first, spot.second, r, BLIZZARD_TIME, ZoneKind.BLIZZARD, p.damage * (0.7f + 0.18f * (lvl - 1)) * spellMult())
        waves += Wave(spot.first, spot.second, r, ORB_ICE, 0.5f)
        sfx.frost()
    }

    private fun teleport(lvl: Int) {
        val p = player
        var dx = joyX
        var dy = joyY
        val len = hypot(dx, dy)
        if (len < 0.2f) {
            dx = p.faceX
            dy = p.faceY
        } else {
            dx /= len
            dy /= len
        }
        p.faceX = dx
        p.faceY = dy
        val fromX = p.x
        val fromY = p.y
        val reach = blinkReach(fromX, fromY, dx, dy, 4.5f + 0.5f * lvl)
        val toX = fromX + dx * reach
        val toY = fromY + dy * reach
        val dmg = p.damage * (0.8f + 0.2f * (lvl - 1)) * spellMult()
        val hit = mutableSetOf<Enemy>()
        ghosts += Ghost(fromX, fromY, dirRow(dx, dy))
        arcaneBurst(fromX, fromY, dmg, hit)
        p.x = toX
        p.y = toY
        arcaneBurst(toX, toY, dmg, hit)
        p.cast = 0.2f
        skillFx += SkillFx(Skill.TELEPORT, fromX, fromY, toX, toY, dx, dy, 0.5f, TELEPORT_BURST)
        sfx.portal()
    }

    /** The arcane burst at either end of a Teleport; [hit] keeps an enemy from being hit by both. */
    private fun arcaneBurst(x: Float, y: Float, dmg: Float, hit: MutableSet<Enemy>) {
        for (e in enemies.toList()) if (e !in hit && e.hp > 0f && hypot(e.x - x, e.y - y) < TELEPORT_BURST + e.type.radius * e.size) {
            hit += e
            damageEnemy(e, dmg, 0f)
            shoveFrom(e, x, y, 4f)
        }
        ring(x, y, 0.3f, Skill.TELEPORT.color, 22, 4f)
        burst(x, y - 0.4f, Color(0xFF7C4DFF), 14, glow = true)
    }

    private fun blackHole(lvl: Int) {
        val p = player
        // Aim at the biggest pack in reach (the nearest of equal ones).
        val pack = enemies.filter { dist(it) < 8f }
            .maxByOrNull { e -> enemies.count { hypot(it.x - e.x, it.y - e.y) < 3f } * 10f - dist(e) }
        val spot = if (pack != null) (pack.x to pack.y) else spotAhead(4f)
        pack?.let { faceToward(it.x, it.y) }
        p.cast = 0.5f
        val m = spellMult()
        val z = Zone(spot.first, spot.second, HOLE_PULL, HOLE_TIME + 0.1f, ZoneKind.BLACK_HOLE, 0f)
        zones += z
        val fx = SkillFx(Skill.BLACK_HOLE, z.x, z.y, z.x, z.y, 1f, 0f, HOLE_TIME + 0.1f, HOLE_PULL)
        skillFx += fx
        vortices += Vortex(dungeon, z, fx, p.damage * (0.4f + 0.1f * (lvl - 1)) * m, p.damage * (4f + (lvl - 1)) * m)
        ring(z.x, z.y, 0.3f, Skill.BLACK_HOLE.color, 30, 3f)
        shake = max(shake, 0.4f)
        sfx.portal()
        sfx.rumble(40, 120)
    }

    private fun implode(v: Vortex) {
        val z = v.zone
        for (e in enemies.toList()) if (e.hp > 0f && hypot(e.x - z.x, e.y - z.y) < HOLE_IMPLODE + e.type.radius * e.size) {
            damageEnemy(e, v.implode, 0f)
            shoveFrom(e, z.x, z.y, 8f)
            e.stun = max(e.stun, if (e.type.boss) 0.4f else 1.2f)
            e.windup = 0f
        }
        for (pr in dungeon.props) if (pr.type.breakable && !pr.used && hypot(pr.x - z.x, pr.y - z.y) < HOLE_IMPLODE) breakProp(pr)
        skillFx += SkillFx(Skill.BLACK_HOLE, z.x, z.y, z.x, z.y, 0f, 0f, 0.5f, -HOLE_IMPLODE)
        waves += Wave(z.x, z.y, HOLE_IMPLODE + 1f, Skill.BLACK_HOLE.color, 0.5f)
        ring(z.x, z.y, 0.2f, Color(0xFFB388FF), 44, 7f)
        burst(z.x, z.y, Color(0xFFE1BEE7), 30, glow = true)
        addDecal(z.x, z.y, 4, 2f)
        shake = 1f
        hitStop = max(hitStop, 0.1f)
        sfx.explode()
        sfx.rumble(80, 220)
    }

    /** Per-frame work of the Assassin and Sorceress skill-tree actives (Blade Dance runs in [updateClassMoves]). */
    private fun updateAssassinSorceressSkills(dt: Float) {
        val p = player
        for (e in enemies) {
            if (e.chill > 0f) {
                e.chill -= dt
                if (particles.size < 500 && rnd.nextFloat() < dt * 6f) {
                    particles += Particle(e.x + jitter(), e.y, 0f, -0.4f, ORB_ICE, 0.05f, 0.6f, glow = true, z = 0.6f)
                }
            }
            if (e.mark > 0f) e.mark -= dt
        }
        // Blizzards chill everything under them; their damage is dealt in updateZones.
        for (z in zones) {
            if (z.kind != ZoneKind.BLIZZARD) continue
            for (e in enemies) if (hypot(e.x - z.x, e.y - z.y) < z.radius + e.type.radius * e.size) chillEnemy(e, 0.6f)
            if (particles.size < 500 && rnd.nextFloat() < dt * 25f) {
                val a = rnd.nextFloat() * 6.283f
                val r = rnd.nextFloat() * z.radius
                particles += Particle(z.x + cos(a) * r, z.y + sin(a) * r, 0f, 0f, Color.White, 0.04f, 0.35f, glow = true, z = 0.08f)
            }
        }
        // Armed Death Traps go off when an enemy comes close.
        if (traps.isNotEmpty()) {
            traps.removeAll { it.zone !in zones }
            for (tr in traps.toList()) {
                val z = tr.zone
                if (z.age < TRAP_ARM) continue
                if (enemies.none { it.hp > 0f && hypot(it.x - z.x, it.y - z.y) < z.radius + it.type.radius * it.size }) continue
                traps.remove(tr)
                zones.remove(z)
                trapBlast(tr)
            }
        }
        // The mark's sigil follows its monster.
        val marked = markTarget
        if (marked != null) {
            val fx = markFx
            if (marked.mark <= 0f || fx == null || marked !in enemies) clearMark() else {
                fx.x = marked.x
                fx.y = marked.y
                fx.tx = p.x
                fx.ty = p.y
            }
        }
        if (p.blossom > 0f) {
            p.blossom -= dt
            blossomAngle += dt * 11f
            var fx = blossomFx
            if (fx == null || fx !in skillFx) {
                // The cue was cleared with the old floor: the ring goes on spinning here.
                fx = SkillFx(Skill.DEATH_BLOSSOM, p.x, p.y, p.x, p.y, 1f, 0f, max(p.blossom, 0.05f), BLOSSOM_RADIUS)
                skillFx += fx
                blossomFx = fx
            }
            fx.x = p.x
            fx.y = p.y
            fx.tx = p.x
            fx.ty = p.y
            fx.dx = cos(blossomAngle)
            fx.dy = sin(blossomAngle)
            blossomTick -= dt
            if (blossomTick <= 0f) {
                blossomTick = BLOSSOM_TICK
                var hit = false
                for (e in enemies.toList()) if (e.hp > 0f && dist(e) < BLOSSOM_RADIUS + e.type.radius * e.size) {
                    damageEnemy(e, p.damage * blossomPower, 1.5f)
                    onHitPowers(e)
                    hit = true
                }
                for (pr in dungeon.props) if (pr.type.breakable && !pr.used && hypot(pr.x - p.x, pr.y - p.y) < BLOSSOM_RADIUS) breakProp(pr)
                sfx.swing()
                if (hit) sfx.hit()
            }
            if (particles.size < 500) repeat(2) {
                val a = blossomAngle + rnd.nextFloat() * 6.283f
                val r = BLOSSOM_RADIUS * (0.8f + rnd.nextFloat() * 0.2f)
                particles += Particle(p.x + cos(a) * r, p.y + sin(a) * r, -sin(a) * 3f, cos(a) * 3f, Color(0xFFF8BBD0), 0.04f, 0.35f, glow = true, z = 0.5f)
            }
            if (p.blossom <= 0f) {
                p.blossom = 0f
                blossomFx?.let { skillFx.remove(it) }
                blossomFx = null
            }
        }
        if (orbs.isNotEmpty()) {
            val oi = orbs.iterator()
            while (oi.hasNext()) {
                val o = oi.next()
                if (o.home !== dungeon) {
                    oi.remove()
                    continue
                }
                o.life -= dt
                val nx = o.x + o.dx * ORB_SPEED * dt
                val ny = o.y + o.dy * ORB_SPEED * dt
                val wall = !dungeon.walkableAt(nx, ny) && dungeon.tile(floorInt(nx), floorInt(ny)) != WATER
                if (!wall) {
                    o.x = nx
                    o.y = ny
                }
                o.fx.x = o.x
                o.fx.y = o.y
                o.spray -= dt
                while (o.spray <= 0f) {
                    o.spray += ORB_SPRAY
                    // The golden angle: shards fan out evenly in every direction.
                    o.angle += 2.4f
                    projectiles += Projectile(o.x, o.y, cos(o.angle) * 7f, sin(o.angle) * 7f, o.shard, hostile = false,
                        color = ORB_ICE, life = 0.45f, radius = 0.1f, small = true, chill = 1.5f)
                }
                if (o.life <= 0f || wall) {
                    oi.remove()
                    skillFx.remove(o.fx)
                    orbBurst(o)
                }
            }
        }
        if (vortices.isNotEmpty()) {
            val vi = vortices.iterator()
            while (vi.hasNext()) {
                val v = vi.next()
                if (v.home !== dungeon) {
                    vi.remove()
                    continue
                }
                val z = v.zone
                v.t += dt
                v.angle += dt * 6f
                v.fx.dx = cos(v.angle)
                v.fx.dy = sin(v.angle)
                // Drag everything in reach toward the centre, harder near it; walls still stop them, bosses resist.
                for (e in enemies) {
                    val dx = z.x - e.x
                    val dy = z.y - e.y
                    val d = hypot(dx, dy)
                    if (d > HOLE_PULL + e.type.radius * e.size || d < 0.3f) continue
                    val pull = (if (e.type.boss) 0.8f else 3f) * (0.6f + 0.6f * (1f - d / HOLE_PULL).coerceIn(0f, 1f))
                    val step = min(pull * dt, d - 0.3f)
                    move(e, dx / d * step, dy / d * step, e.type.radius)
                }
                v.tickT -= dt
                if (v.tickT <= 0f) {
                    v.tickT = HOLE_TICK
                    for (e in enemies.toList()) if (e.hp > 0f && hypot(e.x - z.x, e.y - z.y) < HOLE_PULL + e.type.radius * e.size) damageEnemy(e, v.tick, 0f)
                }
                if (particles.size < 500) repeat(2) {
                    val a = rnd.nextFloat() * 6.283f
                    val r = HOLE_PULL * (0.5f + rnd.nextFloat() * 0.5f)
                    // Inward and a little sideways, so they spiral in.
                    particles += Particle(z.x + cos(a) * r, z.y + sin(a) * r, (-cos(a) - sin(a) * 0.6f) * r * 1.6f, (-sin(a) + cos(a) * 0.6f) * r * 1.6f,
                        if (rnd.nextBoolean()) Skill.BLACK_HOLE.color else Color(0xFFB388FF), 0.045f, 0.5f, glow = true, z = 0.3f + rnd.nextFloat() * 0.5f)
                }
                if (v.t >= HOLE_TIME) {
                    vi.remove()
                    zones.remove(z)
                    skillFx.remove(v.fx)
                    implode(v)
                }
            }
        }
    }

    fun drinkPotion() {
        val p = player
        if (dead) return
        when {
            p.potions <= 0 -> showMessage("No potions — buy more in the village", HURT_COLOR)
            p.hp >= p.maxHp -> showMessage("You are at full health", Color.White)
            else -> {
                p.potions--
                p.hp = min(p.maxHp, p.hp + p.maxHp * 0.5f * p.potionMult)
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

    // ---------------------------------------------------------------- blacksmith

    fun reforgePrice(item: Item) = 40 + item.level * 15 * (item.rarity.ordinal + 1)
    fun upgradePrice(item: Item) = 70 + item.level * 25 * (item.rarity.ordinal + 1)
    fun canUpgrade(item: Item) = item.level < max(1, deepest) + 12

    /** New random stats, same slot, rarity, level, look and name. */
    fun reforge(item: Item): Item? {
        val price = reforgePrice(item)
        if (player.gold < price) return null
        player.gold -= price
        val fresh = makeItem(item.level, item.rarity, false, slot = item.slot, exact = true, keepIcon = item.icon, keepName = item.name)
        replace(item, fresh)
        sfx.equip()
        save()
        return fresh
    }

    /** Raises the item level by two and strengthens every stat by 15%. */
    fun upgrade(item: Item): Item? {
        val price = upgradePrice(item)
        if (player.gold < price || !canUpgrade(item)) return null
        player.gold -= price
        fun up(v: Int) = if (v == 0) 0 else maxOf(v + 1, (v * 1.15f).roundToInt())
        val better = Item(
            item.slot, item.name, item.rarity, item.icon, item.level + 2,
            up(item.damage), up(item.armor), up(item.life), up(item.crit).coerceAtMost(25), up(item.mana),
            up(item.lifeSteal).coerceAtMost(12), up(item.speed).coerceAtMost(25), up(item.spell).coerceAtMost(120),
            up(item.atkSpeed).coerceAtMost(35), up(item.goldFind).coerceAtMost(150), item.power,
        )
        replace(item, better)
        sfx.levelUp()
        save()
        return better
    }

    private fun replace(old: Item, new: Item) {
        val p = player
        if (p.equipment[old.slot] === old) {
            p.equipment[old.slot] = new
            p.hp = min(p.hp, p.maxHp)
        } else {
            val i = p.inventory.indexOf(old)
            if (i >= 0) p.inventory[i] = new
        }
    }

    // ---------------------------------------------------------------- elder

    private fun rollBounties() {
        bountyOffers.clear()
        val pool = buildList {
            addAll(listOf(EnemyType.WOLF, EnemyType.BANDIT, EnemyType.SLIME, EnemyType.SKELETON, EnemyType.GOBLIN))
            if (questStage >= 1 || deepest >= 3) addAll(listOf(EnemyType.SPIDER, EnemyType.CULTIST, EnemyType.BRUTE))
            if (questStage >= 1) add(EnemyType.GHOST)
            if (questStage >= 2) { add(EnemyType.BAT); add(EnemyType.IMP) }
            if (questStage >= Region.DESERT.quest) { add(EnemyType.SCORPION); add(EnemyType.MUMMY) }
        }.shuffled(rnd).take(3)
        for (t in pool) {
            val need = when (t) {
                EnemyType.BRUTE -> rnd.nextInt(4, 8)
                EnemyType.CULTIST, EnemyType.MUMMY -> rnd.nextInt(6, 11)
                else -> rnd.nextInt(10, 21)
            }
            val lvl = max(1, max(deepest, player.level / 2))
            val rarity = if (rnd.nextFloat() < 0.2f) Rarity.EPIC else Rarity.RARE
            bountyOffers += Bounty(t, need, 0, need * (15 + lvl * 6), rarity)
        }
    }

    fun acceptBounty(b: Bounty) {
        if (bounty != null) return
        bounty = b
        bountyOffers.remove(b)
        sfx.equip()
        showMessage("Bounty: slay ${b.need} ${b.type.plural}", GOLD)
        save()
    }

    fun abandonBounty() {
        bounty = null
        rollBounties()
        save()
    }

    /** Pays out a finished contract. Returns the reward item, if any. */
    fun claimBounty(): Item? {
        val b = bounty ?: return null
        if (!b.done) return null
        player.gold += b.gold
        val item = makeItem(max(1, deepest) + player.level / 2 + 1, b.rarity, false)
        if (player.inventory.size < INVENTORY_SIZE) player.inventory += item else loot += Loot(player.x, player.y + 0.6f, LootKind.Gear(item))
        bounty = null
        rollBounties()
        sfx.levelUp()
        ring(player.x, player.y, 0.3f, GOLD, 40, 4f)
        save()
        return item
    }

    /** Puts a skill point into [skill] if the skill tree allows it. */
    fun learn(skill: Skill) {
        SkillTree.of(player.heroClass).node(skill)?.let { learnNode(it) }
    }

    /** Puts a skill point into talent [t] if the skill tree allows it. */
    fun learnTalent(t: Talent) {
        SkillTree.of(player.heroClass).node(t)?.let { learnNode(it) }
    }

    /** A point can go into [node] now: one is free, the node is not maxed and its level and parent requirements are met. */
    fun canLearn(node: TreeNode): Boolean = player.skillPoints > 0 && node.rank(player) < node.maxRank && node.unlocked(player)

    fun learnNode(node: TreeNode): Boolean {
        if (!canLearn(node)) return false
        val p = player
        val rank = node.rank(p) + 1
        val s = node.skill
        val t = node.talent
        if (s != null) p.skills[s] = rank else if (t != null) p.setTalent(t, rank)
        p.skillPoints--
        sfx.levelUp()
        save()
        return true
    }

    /** Gold a skill reset costs. */
    val resetPrice: Int get() = 50 * player.level

    /** Points a reset would give back: every rank in the tree except the free first ranks of the two starting skills. */
    fun spentPoints(): Int {
        val p = player
        val free = p.heroClass.skills.take(2)
        var n = p.talentPoints
        for ((s, r) in p.skills) n += r - (if (s in free) min(r, 1) else 0)
        return n
    }

    /** Pays [resetPrice] to take every point out of the tree and give it back. */
    fun resetSkills(): Boolean {
        val p = player
        val refund = spentPoints()
        if (refund <= 0 || p.gold < resetPrice) return false
        p.gold -= resetPrice
        p.skills.clear()
        p.heroClass.allSkills.forEachIndexed { i, sk -> p.skills[sk] = if (i < 2) 1 else 0 }
        p.clearTalents()
        p.resetLoadout()
        p.skillPoints += refund
        p.hp = min(p.hp, p.maxHp)
        p.mana = min(p.mana, p.maxMana)
        sfx.portal()
        showMessage("Skills reset: $refund points to spend again ✨", GOLD)
        save()
        return true
    }

    /** Puts a learned active on HUD button [slot] (0-3); if it already sits on another button the two swap. */
    fun equipSkill(skill: Skill, slot: Int) {
        val p = player
        if (slot !in 0 until LOADOUT_SIZE || (p.skills[skill] ?: 0) <= 0 || skill !in p.heroClass.allSkills) return
        val from = p.loadout.indexOf(skill)
        if (from >= 0) p.loadout[from] = p.loadout[slot]
        p.loadout[slot] = skill
        sfx.equip()
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
            rnd.nextFloat() < 0.55f -> loot += pop(Loot(pr.x, pr.y + 0.1f, LootKind.Gold(goldAmount(rnd.nextInt(2, 8) * lvl))), 0.6f)
            rnd.nextFloat() < 0.15f -> loot += pop(Loot(pr.x, pr.y + 0.1f, LootKind.Potion), 0.6f)
            rnd.nextFloat() < 0.08f -> dropGear(pr.x, pr.y + 0.1f, makeItem(ilvl(), Rarity.COMMON, false))
        }
    }

    private fun openChest(pr: Prop) {
        pr.used = true
        sfx.equip()
        burst(pr.x, pr.y - 0.2f, GOLD, 30, glow = true)
        val lvl = levelHere(pr.x, pr.y)
        loot += pop(Loot(pr.x, pr.y + 0.3f, LootKind.Gold(goldAmount(rnd.nextInt(8, 20) * lvl))))
        repeat(rnd.nextInt(1, 3)) {
            dropGear(pr.x + (it - 0.5f) * 0.7f, pr.y + 0.6f, makeItem(ilvl(), Rarity.MAGIC, false))
        }
        if (rnd.nextFloat() < 0.4f) loot += pop(Loot(pr.x, pr.y + 0.3f, LootKind.Potion))
        showMessage("Treasure chest!", GOLD)
    }

    private fun useShrine(pr: Prop) {
        if (inVillage) {
            if (player.hp < player.maxHp) {
                player.hp = player.maxHp
                player.mana = player.maxMana
                sfx.levelUp()
                showMessage("The shrine heals you", Color(0xFF80DEEA))
            }
            return
        }
        pr.used = true
        val b = Buff.entries.random(rnd)
        player.buff = b
        player.buffTime = 60f
        sfx.levelUp()
        ring(pr.x, pr.y, 0.3f, b.color, 36, 4f)
        showMessage("Shrine — ${b.label} for 60 s", b.color)
    }

    // ---------------------------------------------------------------- combat

    private fun bloodColor(t: EnemyType) = when (t) {
        EnemyType.SLIME -> Color(0xFF66BB6A)
        EnemyType.SKELETON, EnemyType.SKELETON_KING -> Color(0xFFE0D8C3)
        EnemyType.BAT -> Color(0xFF7B1FA2)
        EnemyType.SPIDER, EnemyType.SPIDER_QUEEN -> Color(0xFF9CCC65)
        EnemyType.CULTIST, EnemyType.BRUTE, EnemyType.WOLF, EnemyType.BANDIT, EnemyType.TROLL, EnemyType.GOBLIN -> Color(0xFF8E1B1B)
        EnemyType.GHOST -> Color(0xFFB3E5FC)
        EnemyType.IMP -> Color(0xFFFF6E40)
        EnemyType.DEMON_LORD, EnemyType.SHADOW_KING -> Color(0xFFFF5722)
        EnemyType.SCORPION -> Color(0xFFC0CA33)
        EnemyType.MUMMY -> Color(0xFFD7C9A7)
        EnemyType.DJINN -> Color(0xFF4FC3F7)
        EnemyType.SAND_PHARAOH -> Color(0xFFFFD54F)
    }

    /** Whether a kill leaves blood on the ground; bones, slime, spirits and the desert's dead and dust do not. */
    private fun bleeds(t: EnemyType) = t != EnemyType.SKELETON && t != EnemyType.SKELETON_KING && t != EnemyType.SLIME && t != EnemyType.GHOST &&
        t != EnemyType.SCORPION && t != EnemyType.MUMMY && t != EnemyType.DJINN && t != EnemyType.SAND_PHARAOH

    private fun damageEnemy(e: Enemy, base: Float, knock: Float, forceCrit: Boolean = false) {
        if (e.shield > 0f) {
            e.aggro = true
            if (e.flash <= 0f) {
                texts += FloatText(e.x, e.y - 1f, "Immune", Affix.SHIELDED.color)
                burst(e.x, e.y - 0.4f, Affix.SHIELDED.color, 5, glow = true)
                e.flash = 0.12f
            }
            return
        }
        // Relentless: every fifth hit is a sure critical.
        val sure = player.relentless && ++player.hitCount >= 5
        if (sure) player.hitCount = 0
        val crit = sure || forceCrit || player.stealth > 0f || rnd.nextInt(100) < player.critChance
        if (player.stealth > 0f) player.stealth = 0f
        val execute = if (player.executioner && e.hp < e.maxHp * 0.3f) 1.5f else 1f
        val dmg = base * (0.85f + rnd.nextFloat() * 0.3f) * (if (crit) player.critMult else 1f) * execute * e.damageTakenMult
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
        texts += FloatText(
            e.x, e.y - 1f, dmg.roundToInt().toString(), if (crit) GOLD else Color.White, big = crit,
            vx = (rnd.nextFloat() - 0.5f) * 2.4f, vy = -3.2f - rnd.nextFloat(), gravity = 7.5f,
        )
        burst(e.x, e.y, bloodColor(e.type), 7)
        if (crit) {
            shake = max(shake, 0.3f)
            hitStop = max(hitStop, 0.04f)
            sfx.rumble(14, 70)
        }
    }

    private fun hurtPlayer(raw: Float, from: Enemy? = null) {
        if (player.dodge > 0f || player.leap > 0f || player.charge > 0f || player.dance > 0f) {
            texts += FloatText(player.x, player.y - 1.2f, "Dodged!", Color(0xFFB0BEC5))
            return
        }
        if (from != null) championHit(from, raw)
        var dmg = raw * 100f / (100f + player.armorValue * 4f)
        dmg *= player.damageTaken
        if (player.lastStand && player.hp < player.maxHp * 0.35f) dmg *= 0.6f
        if (player.manaShield) {
            val absorbed = min(dmg * 0.3f, player.mana)
            player.mana -= absorbed
            dmg -= absorbed
        }
        if (from != null && player.thorns > 0f && from.hp > 0f) damageEnemy(from, raw * player.thorns, 0f)
        player.hp -= dmg
        player.hurt = 0.3f
        player.sinceHurt = 0f
        shake = max(shake, 0.4f)
        sfx.hurt()
        sfx.rumble(28, 110)
        texts += FloatText(player.x, player.y - 1.2f, "-${dmg.roundToInt()}", HURT_COLOR)
        burst(player.x, player.y + 0.1f, Color(0xFF8E1B1B), 4)
        if (player.hp <= 0f) {
            if (player.undying && player.undyingCd <= 0f) {
                player.undyingCd = 90f
                player.hp = 1f
                player.fury = max(player.fury, 4f)
                ring(player.x, player.y, 0.3f, Color(0xFFFF5252), 40, 4f)
                sfx.levelUp()
                showMessage("Undying Rage!", Color(0xFFFF5252))
                return
            }
            if (player.has(Power.PHOENIX) && !player.phoenixUsed) {
                player.phoenixUsed = true
                player.hp = player.maxHp * 0.5f
                ring(player.x, player.y, 0.3f, Color(0xFFFF9100), 50, 5f)
                sfx.levelUp()
                showMessage("Phoenix! You rise from the ashes", Color(0xFFFF9100))
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
        if (e.mark > 0f) markKilled(e)
        streak++
        streakTimer = 1.6f
        // Only the 2D renderer draws corpses.
        if (!render3d) corpses += Corpse(e.type, e.x, e.y, e.faceX, e.faceY, e.size)
        hitStop = max(hitStop, if (e.type.boss) 0.35f else 0.05f)
        burst(e.x, e.y, bloodColor(e.type), 20)
        if (bleeds(e.type)) addDecal(e.x, e.y, rnd.nextInt(4), 0.9f * e.size * (if (e.type.boss) 2f else 1f))
        if (player.has(Power.VAMPIRE)) player.hp = min(player.maxHp, player.hp + player.maxHp * 0.05f)
        if (player.soulHarvest > 0f) {
            player.hp = min(player.maxHp, player.hp + player.maxHp * player.soulHarvest)
            player.mana = min(player.maxMana, player.mana + player.maxMana * player.soulHarvest)
        }
        val firstSlain = e.type.boss && bossesSlain.add(e.type.name)
        if (firstSlain) player.skillPoints++
        bounty?.let { b ->
            if (b.type == e.type && !b.done) {
                b.got++
                if (b.done) showMessage("Bounty complete! Return to the Elder in the village", GOLD)
                else texts += FloatText(player.x, player.y - 1.8f, "${b.got}/${b.need} ${b.type.plural}", GOLD)
            }
        }
        gainXp(e.xp)
        dropLoot(e)
        if (e.type.boss) {
            val idx = questBosses.indexOf(e.type)
            if (idx >= 0 && idx == questStage) {
                questStage++
                showMessage("${e.type.label} is defeated!\nQuest complete: ${QUESTS[idx].first}", GOLD)
                if (questStage == QUESTS.size) victory = true
            } else if (e.type == EnemyType.SAND_PHARAOH) {
                showMessage("${e.type.label} is defeated!\nThe treasure of his tomb is yours", GOLD)
            } else {
                showMessage("${e.type.label} is defeated!", GOLD)
            }
            shake = 1f
            sfx.rumble(160, 255)
            burst(e.x, e.y, GOLD, 70, glow = true)
            save()
        }
        if (firstSlain) {
            showMessage("${message ?: "${e.type.label} is defeated!"}\n+1 skill point ✨ for a first victory", GOLD)
            texts += FloatText(player.x, player.y - 2.1f, "+1 skill point", GOLD, big = true)
        }
    }

    private fun gainXp(amount: Int) {
        val p = player
        p.xp += amount
        texts += FloatText(p.x, p.y - 1.5f, "+$amount XP", XP_COLOR)
        while (p.xp >= p.xpToNext) {
            p.xp -= p.xpToNext
            p.level++
            // One point a level, and a bonus point every fifth level (which also opens a new tier of the skill tree).
            val bonus = p.level % 5 == 0
            p.skillPoints += if (bonus) 2 else 1
            p.hp = p.maxHp
            p.mana = p.maxMana
            levelFlash = 1.2f
            sfx.levelUp()
            showMessage(
                if (bonus) "Level ${p.level}! +2 skill points ✨\nBonus point every 5th level" +
                    (if (p.level <= TIER_LEVELS.last()) " · new skill tier open" else "")
                else "Level ${p.level}! +1 skill point ✨",
                GOLD,
            )
            ring(p.x, p.y, 0.3f, GOLD, 40, 4f)
            save()
        }
    }

    private fun jitter() = (rnd.nextFloat() - 0.5f) * 0.6f

    private fun ilvl() = levelHere() + player.level / 2

    private fun goldAmount(base: Int) = max(1, (base * (1f + player.goldFind / 100f)).toInt())

    /** Throws freshly dropped loot up and out in a little arc. */
    private fun pop(l: Loot, spread: Float = 1f): Loot {
        val a = rnd.nextFloat() * 2f * PI.toFloat()
        val s = (0.5f + rnd.nextFloat() * 1.3f) * spread
        l.vx = cos(a) * s
        l.vy = sin(a) * s * 0.8f + 0.3f
        l.vz = 4.5f + rnd.nextFloat() * 2f
        l.z = 0.01f
        return l
    }

    private fun dropGear(x: Float, y: Float, item: Item) {
        loot += pop(Loot(x, y, LootKind.Gear(item)))
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
            loot += pop(Loot(e.x, e.y, LootKind.Gold(goldAmount(amount))))
        }
        if (rnd.nextFloat() < (if (boss) 1f else 0.1f)) loot += pop(Loot(e.x, e.y, LootKind.Potion))
        val gearChance = when {
            boss -> 1f
            e.elite -> 1f
            e.type == EnemyType.BRUTE -> 0.4f
            else -> 0.16f
        }
        // Champions with more affixes are tougher and pay better.
        repeat(if (boss) 3 else if (e.affixes.size >= 2) 2 else 1) {
            if (rnd.nextFloat() < gearChance) {
                val min = when {
                    e.affixes.size >= 3 -> Rarity.RARE
                    boss || e.elite -> Rarity.MAGIC
                    else -> Rarity.COMMON
                }
                dropGear(e.x, e.y, makeItem(lvl + player.level / 2, min, boss))
            }
        }
        if (e.type == EnemyType.SAND_PHARAOH) pharaohHoard(e)
    }

    /** The Sand Pharaoh's treasure: a sure legendary (one time in five mythic) and a fortune in gold. */
    private fun pharaohHoard(e: Enemy) {
        val rarity = if (rnd.nextFloat() < 0.2f) Rarity.MYTHIC else Rarity.LEGENDARY
        dropGear(e.x, e.y, makeItem(e.level + player.level / 2 + 2, rarity, true, exact = true))
        repeat(8) { loot += pop(Loot(e.x, e.y, LootKind.Gold(goldAmount(rnd.nextInt(40, 81) * e.level))), 1.6f) }
        repeat(2) { loot += pop(Loot(e.x, e.y, LootKind.Potion)) }
        ring(e.x, e.y, 0.4f, GOLD, 48, 5f)
    }

    /**
     * Rolls an item. Rarity: normal 50%, magic 30%, rare 13%, epic 5%, legendary 1.7%, mythic 0.3%
     * (bosses roll much better). With [exact] the given rarity is used as is.
     */
    fun makeItem(
        level: Int, minRarity: Rarity, bossDrop: Boolean, slot: Slot? = null, exact: Boolean = false,
        keepIcon: Int? = null, keepName: String? = null,
    ): Item {
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
        val cls = player.heroClass
        val options = when (s) {
            Slot.WEAPON -> bases.getValue(s).filter { WeaponKind.ofIcon(it.second) in cls.weapons }
            Slot.OFFHAND -> when (cls) {
                HeroClass.ASSASSIN -> listOf("Parrying Dagger" to Icons.DAGGER, "Sai" to Icons.DAGGER, "Stiletto" to Icons.DAGGER)
                HeroClass.SORCERESS -> listOf("Grimoire" to Icons.SCROLL, "Spellbook" to Icons.SCROLL, "Tome" to Icons.SCROLL)
                else -> bases.getValue(s)
            }
            else -> bases.getValue(s)
        }
        val picked = options.ifEmpty { bases.getValue(s) }.random(rnd)
        val base = picked.first
        val icon = keepIcon ?: picked.second
        val name = keepName ?: when (rarity) {
            Rarity.MYTHIC -> mythicNames.getValue(s).random(rnd)
            Rarity.LEGENDARY -> legendaryNames.getValue(s).random(rnd)
            Rarity.EPIC -> "${prefixes.random(rnd)} $base ${suffixes.random(rnd)}"
            Rarity.COMMON -> base
            else -> "${prefixes.random(rnd)} $base"
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
            Slot.OFFHAND -> when (icon) {
                Icons.SCROLL -> { stats["mana"] = v(5f + level * 2f); stats["spell"] = v(5f + level).coerceAtMost(60) }
                Icons.DAGGER -> { stats["damage"] = v(1f + level * 0.8f); stats["crit"] = v(2f).coerceAtMost(15) }
                else -> { stats["armor"] = v(2f + level * 1.2f); stats["life"] = v(3f + level * 1.5f) }
            }
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
                texts += FloatText(p.x, p.y - 1.3f, "+${kind.amount} gold", GOLD)
            }
            LootKind.Potion -> {
                p.potions++
                sfx.coin()
                texts += FloatText(p.x, p.y - 1.3f, "+1 potion", Color(0xFFFF5370))
            }
            is LootKind.Shard -> {
                shardsFound += kind.key
                val n = shardsFound.size
                ring(p.x, p.y, 0.3f, HEART, 36, 4f)
                if (n % 4 == 0) {
                    p.hearts = n / 4
                    p.hp = p.maxHp
                    sfx.levelUp()
                    showMessage("A new heart! +${HEART_LIFE.toInt()} max life", HEART)
                } else {
                    sfx.potion()
                    showMessage("Heart fragment found (${n % 4}/4)", HEART)
                }
                save()
            }
            is LootKind.Gear -> {
                val item = kind.item
                if (p.equipment[item.slot] == null) {
                    p.equipment[item.slot] = item
                    sfx.equip()
                    showMessage("Equipped: ${item.name}", item.rarity.color)
                } else if (p.inventory.size < INVENTORY_SIZE) {
                    p.inventory += item
                    sfx.coin()
                    showMessage("${item.rarity.label}: ${item.name}${if (isUpgrade(item)) "  ⬆" else ""}", item.rarity.color)
                } else {
                    if (messageTimer <= 0f) showMessage("Your bag is full — sell something", HURT_COLOR)
                    return false
                }
                save()
            }
        }
        return true
    }

    // ---------------------------------------------------------------- world simulation

    /** A scorpion's sting: the venom lasts a few seconds; a fresh sting refreshes it and keeps the stronger dose. */
    private fun poisonHero(dps: Float) {
        if (heroPoison <= 0f) heroPoisonTick = 0.5f
        heroPoison = 3.5f
        heroPoisonDps = max(heroPoisonDps, dps)
        burst(player.x, player.y - 0.4f, STING_GREEN, 8, glow = true)
    }

    /** Venom ticks twice a second, past armour; it can bring the hero low but never kills. */
    private fun updateHeroPoison(dt: Float) {
        if (heroPoison <= 0f) return
        heroPoison -= dt
        heroPoisonTick -= dt
        if (rnd.nextFloat() < dt * 8f) particles += Particle(player.x + jitter(), player.y, 0f, -0.5f, STING_GREEN, 0.05f, 0.6f, glow = true, z = 0.6f)
        if (heroPoisonTick <= 0f) {
            heroPoisonTick = 0.5f
            val dmg = heroPoisonDps * 0.5f * player.damageTaken
            if (player.hp > 1f && dmg > 0f) {
                player.hp = max(1f, player.hp - dmg)
                player.sinceHurt = 0f
                texts += FloatText(player.x, player.y - 1.2f, "-${max(1, dmg.roundToInt())}", STING_GREEN)
            }
        }
        if (heroPoison <= 0f) {
            heroPoison = 0f
            heroPoisonDps = 0f
        }
    }

    /** A djinn the hero closes in on vanishes in smoke and reappears a few tiles away. Returns true when it blinked. */
    private fun djinnBlink(e: Enemy, d: Float, dt: Float): Boolean {
        e.blinkCd -= dt
        if (d > 2.4f || e.blinkCd > 0f) return false
        for (k in 0 until 10) {
            val ang = rnd.nextFloat() * 6.283f
            val nx = player.x + cos(ang) * 4.6f
            val ny = player.y + sin(ang) * 4.6f
            if (dungeon.walkableAt(nx, ny) && !blocked(nx, ny, e.type.radius)) {
                particles += Particle(e.x, e.y, 0f, -0.6f, Color(0x9990A4AE), 0.35f, 0.9f, z = 0.6f, soft = true)
                burst(e.x, e.y - 0.4f, Color(0xFF4FC3F7), 12, glow = true)
                e.x = nx
                e.y = ny
                burst(e.x, e.y - 0.4f, Color(0xFFFF9100), 12, glow = true)
                sfx.portal()
                e.blinkCd = 5f + rnd.nextFloat() * 2f
                e.cooldown = min(e.cooldown, 0.4f)
                return true
            }
        }
        e.blinkCd = 1f
        return false
    }

    private fun updateEnemies(dt: Float) {
        updateHeroPoison(dt)
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
            if (e.poison > 0f) {
                e.poison -= dt
                e.hp -= e.poisonDps * dt * e.damageTakenMult
                if (e.poison <= 0f) e.poisonDps = 0f
                if (rnd.nextFloat() < dt * 8f) particles += Particle(e.x + jitter(), e.y, 0f, -0.5f, Color(0xFF9CCC65), 0.05f, 0.6f, glow = true, z = 0.6f)
            }
            if (e.frozen > 0f) {
                e.frozen -= dt
                continue
            }
            if (e.stun > 0f) {
                e.stun -= dt
                e.windup = 0f
                continue
            }
            e.anim += dt
            // The hero vanished in smoke: monsters lose track of him.
            if (player.stealth > 0f && !e.type.boss) {
                e.aggro = false
                continue
            }
            if (e.fear > 0f) {
                e.fear -= dt
                val fx = e.x - player.x
                val fy = e.y - player.y
                val fd = hypot(fx, fy).coerceAtLeast(0.01f)
                move(e, fx / fd * e.speed * dt, fy / fd * e.speed * dt, e.type.radius)
                e.faceX = fx / fd
                e.faceY = fy / fd
                e.moving = true
                e.windup = 0f
                continue
            }

            val dx = player.x - e.x
            val dy = player.y - e.y
            val d = hypot(dx, dy).coerceAtLeast(0.001f)
            if (!e.aggro && d < e.type.aggro && !inVillage) {
                e.aggro = true
                if (e.type.boss) {
                    bossIntro = e.type.label
                    bossIntroTime = 3.2f
                    shake = max(shake, 0.5f)
                }
            }
            if (e.aggro && inVillage && d > 4f) e.aggro = false
            if (!e.aggro) continue
            e.faceX = dx / d
            e.faceY = dy / d
            e.cooldown -= dt

            if (e.windup > 0f) {
                e.windup -= dt
                if (e.windup <= 0f) {
                    if (e.type == EnemyType.DJINN) {
                        // A fan of three fire bolts.
                        val base = atan2(e.faceY, e.faceX)
                        for (a in listOf(-0.22f, 0f, 0.22f)) {
                            projectiles += Projectile(e.x, e.y, cos(base + a) * 6.5f, sin(base + a) * 6.5f, e.dmg * 0.55f, hostile = true,
                                color = Color(0xFFFF9100), life = 2.2f, radius = 0.15f)
                        }
                        sfx.fireball()
                    } else if (e.type.ranged) {
                        projectiles += Projectile(e.x, e.y, e.faceX * 6f, e.faceY * 6f, e.dmg, hostile = true,
                            color = if (e.type == EnemyType.IMP) Color(0xFFFF6D00) else Color(0xFFD500F9), life = 2.5f, radius = 0.16f)
                        sfx.fireball()
                    } else if (e.type == EnemyType.WOLF && d < 3f) {
                        // Wolves leap at their prey.
                        e.kx += e.faceX * 9f
                        e.ky += e.faceY * 9f
                        if (d <= e.type.range + 1.2f) hurtPlayer(e.dmg, e)
                    } else if (d <= e.type.range * e.size + 0.5f) {
                        val before = player.hp
                        hurtPlayer(e.dmg, e)
                        // A scorpion's sting poisons, unless the hero dodged it.
                        if (e.type == EnemyType.SCORPION && player.hp < before) poisonHero(e.dmg * 0.45f)
                    }
                    e.cooldown = e.attackCooldown
                }
                continue
            }

            if (e.type.boss) bossAbilities(e, dt, spawned)
            if (e.affixes.isNotEmpty() && championAbilities(e, d, dt)) continue

            // Goblins run away when they are losing.
            if (e.type == EnemyType.GOBLIN && e.hp < e.maxHp * 0.4f && d < 6f) {
                move(e, -dx / d * e.speed * dt, -dy / d * e.speed * dt, e.type.radius)
                e.faceX = -dx / d
                e.faceY = -dy / d
                e.moving = true
                continue
            }

            if (e.type.ranged) {
                if (e.type == EnemyType.DJINN && djinnBlink(e, d, dt)) continue
                if (d < 7f && e.cooldown <= 0f) {
                    e.windup = e.type.windup
                    continue
                }
                val dir = if (d < 3f) -1f else if (d > 5f) 1f else 0f
                if (dir != 0f) {
                    move(e, dx / d * e.speed * dt * dir, dy / d * e.speed * dt * dir, e.type.radius)
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
                move(e, mx * e.speed * dt, my * e.speed * dt, e.type.radius)
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
                // A little more room than the bodies need, so packs fan out around the hero instead of stacking.
                val minD = (a.type.radius * a.size + b.type.radius * b.size) * 1.35f
                if (d < minD && d > 0.001f) {
                    val push = (minD - d) / 2f
                    move(a, -dx / d * push, -dy / d * push, a.type.radius)
                    move(b, dx / d * push, dy / d * push, b.type.radius)
                }
            }
        }
    }

    /** What a champion's affixes do on a hit against the hero. */
    private fun championHit(e: Enemy, raw: Float) {
        if (Affix.FROST in e.affixes) {
            if (player.chill <= 0f) sfx.frost()
            player.chill = 2.2f
            burst(player.x, player.y - 0.5f, Affix.FROST.color, 10, glow = true)
        }
        if (Affix.VAMPIRIC in e.affixes) {
            e.hp = min(e.maxHp, e.hp + raw * 2f)
            texts += FloatText(e.x, e.y - 1.3f, "+${(raw * 2f).roundToInt()}", Affix.VAMPIRIC.color)
            for (i in 0 until 6) {
                particles += Particle(player.x, player.y - 0.5f, (e.x - player.x) * 2f + jitter(), (e.y - player.y) * 2f + jitter(),
                    Affix.VAMPIRIC.color, 0.07f, 0.5f, glow = true, z = 0.5f)
            }
        }
    }

    /** Timed champion abilities. Returns true when the monster used its turn. */
    private fun championAbilities(e: Enemy, d: Float, dt: Float): Boolean {
        if (Affix.SHIELDED in e.affixes) {
            if (e.shield > 0f) {
                e.shield -= dt
            } else {
                e.shieldCd -= dt
                if (e.shieldCd <= 0f) {
                    e.shield = 2.5f
                    e.shieldCd = 7f + rnd.nextFloat() * 3f
                    ring(e.x, e.y, 0.2f, Affix.SHIELDED.color, 20, 2.5f)
                }
            }
        }
        if (Affix.BURNING in e.affixes && d < 7f) {
            e.burnCd -= dt
            if (e.burnCd <= 0f) {
                e.burnCd = 3.5f + rnd.nextFloat() * 1.5f
                ring(e.x, e.y, 0.3f, Affix.BURNING.color, 40, 5f)
                burst(e.x, e.y, Color(0xFFFFAB40), 16, glow = true)
                sfx.explode()
                addDecal(e.x, e.y, 4, 1.6f)
                if (d < BURN_RADIUS) hurtPlayer(e.dmg * 0.7f)
            }
        }
        if (Affix.TELEPORT in e.affixes && d > 2.5f && d < 10f) {
            e.blinkCd -= dt
            if (e.blinkCd <= 0f) {
                e.blinkCd = 5f + rnd.nextFloat() * 3f
                for (k in 0 until 8) {
                    val ang = rnd.nextFloat() * 6.283f
                    val nx = player.x + cos(ang) * 1.4f
                    val ny = player.y + sin(ang) * 1.4f
                    if (dungeon.walkableAt(nx, ny) && !blocked(nx, ny, e.type.radius)) {
                        burst(e.x, e.y - 0.4f, Affix.TELEPORT.color, 14, glow = true)
                        e.x = nx
                        e.y = ny
                        burst(e.x, e.y - 0.4f, Affix.TELEPORT.color, 14, glow = true)
                        sfx.portal()
                        e.cooldown = min(e.cooldown, 0.3f)
                        return true
                    }
                }
            }
        }
        return false
    }

    private fun bossAbilities(e: Enemy, dt: Float, spawned: MutableList<Enemy>) {
        e.special -= dt
        e.summon -= dt
        val volley = when (e.type) {
            EnemyType.SPIDER_QUEEN -> Triple(8, Color(0xFF76FF03), 4.2f)
            EnemyType.DEMON_LORD -> Triple(10, Color(0xFFFF3D00), 3.5f)
            EnemyType.SHADOW_KING -> Triple(14, Color(0xFFAA00FF), 3f)
            EnemyType.SAND_PHARAOH -> Triple(12, Color(0xFFFFC400), 4.4f)
            else -> null
        }
        if (e.type == EnemyType.SAND_PHARAOH) pharaohStorm(e, dt)
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
            // The pharaoh raises his dead or calls scorpions out of the sand.
            EnemyType.SAND_PHARAOH -> if (rnd.nextBoolean()) EnemyType.MUMMY else EnemyType.SCORPION
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

    /**
     * The Sand Pharaoh's sandstorm rises where the hero stands every few seconds, and faster once he is below half
     * his life, when he also calls his volleys and minions sooner. He never has champion affixes, so the blink timer
     * paces the storms.
     */
    private fun pharaohStorm(e: Enemy, dt: Float) {
        val enraged = e.hp < e.maxHp * 0.5f
        if (enraged) {
            e.special -= dt * 0.4f
            e.summon -= dt * 0.4f
        }
        e.blinkCd -= dt
        if (e.blinkCd > 0f || hypot(player.x - e.x, player.y - e.y) > 11f) return
        e.blinkCd = if (enraged) 5f else 7.5f
        zones += Zone(player.x, player.y, SANDSTORM_RADIUS, 5f, ZoneKind.SANDSTORM, e.dmg * 0.4f)
        ring(player.x, player.y, 0.5f, SAND_DUST, 30, 3f)
        texts += FloatText(e.x, e.y - 2f, "Sandstorm!", SAND_DUST)
        shake = max(shake, 0.4f)
        sfx.rumble(60, 120)
    }

    /**
     * Sand whirls inside a sandstorm. Once it has gathered (after [SANDSTORM_WARN] s) it scours the hero twice a
     * second while he stays inside; monsters are unharmed.
     */
    private fun sandstorm(z: Zone, dt: Float) {
        if (particles.size < 500 && rnd.nextFloat() < 0.9f) {
            val a = rnd.nextFloat() * 2f * PI.toFloat()
            val r = rnd.nextFloat() * z.radius
            particles += Particle(
                z.x + cos(a) * r, z.y + sin(a) * r * 0.7f, -sin(a) * 2.6f, cos(a) * 1.8f, SAND_DUST.copy(alpha = 0.7f),
                0.06f, 0.7f, z = 0.2f + rnd.nextFloat() * 1.2f, soft = rnd.nextBoolean(),
            )
        }
        z.tick -= dt
        if (z.tick > 0f) return
        z.tick = 0.5f
        if (z.age > SANDSTORM_WARN && hypot(player.x - z.x, player.y - z.y) < z.radius) hurtPlayer(z.dps * 0.5f)
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
            if (particles.size < 600 && (!pr.small || rnd.nextFloat() < 0.25f)) {
                particles += Particle(pr.x, pr.y, (rnd.nextFloat() - 0.5f) * 0.6f, (rnd.nextFloat() - 0.5f) * 0.6f,
                    pr.color, if (pr.small) 0.03f else 0.07f, if (pr.small) 0.2f else 0.3f, glow = true, z = 0.35f)
            }
            if (explode && pr.small && !pr.hostile) {
                iter.remove()
                enemies.firstOrNull { e -> hypot(e.x - pr.x, e.y - pr.y) < e.type.radius * e.size + pr.radius }?.let { e ->
                    damageEnemy(e, pr.dmg, 1.5f)
                    if (pr.poison > 0f) {
                        e.poison = 3f
                        e.poisonDps = max(e.poisonDps, pr.poison)
                    }
                    if (pr.chill > 0f) chillEnemy(e, pr.chill)
                    sfx.hit()
                }
                burst(pr.x, pr.y, pr.color, 6, glow = true)
                continue
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

    private fun updateLoot(dt: Float) {
        val iter = loot.iterator()
        while (iter.hasNext()) {
            val l = iter.next()
            if (l.flying) {
                val nx = l.x + l.vx * dt
                val ny = l.y + l.vy * dt
                if (dungeon.walkableAt(nx, ny)) {
                    l.x = nx
                    l.y = ny
                }
                l.vz -= 24f * dt
                l.z += l.vz * dt
                if (l.z <= 0f) {
                    l.z = 0f
                    if (l.vz < -2.5f) {
                        l.vz = -l.vz * 0.35f
                        l.vx *= 0.5f
                        l.vy *= 0.5f
                    } else {
                        l.vz = 0f
                        l.vx = 0f
                        l.vy = 0f
                    }
                }
                continue
            }
            val d = hypot(l.x - player.x, l.y - player.y)
            // Gold and potions are pulled towards the hero.
            if (l.kind !is LootKind.Gear && d < 2.4f && d > 0.05f) {
                val pull = min(d, (2.6f - d) * 0.12f + 0.04f)
                l.x += (player.x - l.x) / d * pull
                l.y += (player.y - l.y) / d * pull
            }
            if (d < 0.6f && collect(l.kind)) iter.remove()
        }
    }

    private fun reveal() {
        val px = floorInt(player.x)
        val py = floorInt(player.y)
        // Nothing new can show until the hero steps onto another tile or a new map starts.
        if (px == revealedX && py == revealedY && revealedIn === explored) return
        revealedX = px
        revealedY = py
        revealedIn = explored
        val r = if (outdoors) 9 else 7
        for (y in py - r..py + r) for (x in px - r..px + r) {
            if (x in 0 until dungeon.w && y in 0 until dungeon.h && (x - px) * (x - px) + (y - py) * (y - py) <= r * r) {
                val i = y * dungeon.w + x
                if (!explored[i]) {
                    explored[i] = true
                    exploredVersion++
                }
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
        waves += Wave(x, y, r + speed * 0.4f, color, 0.42f)
        repeat(count) {
            if (particles.size >= 600) return
            val a = (it + rnd.nextFloat() * 0.9f) / count.toFloat() * 2f * PI.toFloat()
            val s = speed * (0.6f + rnd.nextFloat() * 0.6f)
            particles += Particle(x + cos(a) * r, y + sin(a) * r, cos(a) * s, sin(a) * s, color,
                0.025f + rnd.nextFloat() * 0.035f, 0.3f + rnd.nextFloat() * 0.25f, glow = true, z = 0.1f + rnd.nextFloat() * 0.5f)
        }
    }

    /** Embers rising from the campfire. Fireflies, motes and lava sparks are drawn by the renderer. */
    private fun ambientParticles() {
        if (particles.size > 400) return
        val fire = dungeon.props.firstOrNull { it.type == PropType.CAMPFIRE }
        if (fire != null && hypot(fire.x - player.x, fire.y - player.y) < 12f && rnd.nextFloat() < 0.5f) {
            particles += Particle(fire.x + (rnd.nextFloat() - 0.5f) * 0.4f, fire.y, (rnd.nextFloat() - 0.5f) * 0.3f, -0.2f,
                Color(0xFFFFAB40), 0.03f, 1.5f, glow = true, gravity = -0.6f, z = 0.4f)
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
            t.vy += t.gravity * dt
            t.x += t.vx * dt
            t.y += t.vy * dt
            if (t.age > (if (t.big) 1.3f else 1f)) iter.remove()
        }
    }
}

// Assassin and Sorceress skill-tree actives (see Game.cast).
private const val DANCE_HOP = 0.12f
private const val DANCE_TARGETS = 5
private const val DANCE_REACH = 6f
private const val MAX_TRAPS = 3
private const val TRAP_ARM = 0.5f
private const val TRAP_LIFE = 15f
private const val TRAP_TRIGGER = 1.3f
private const val MARK_TIME = 8f
private const val BLOSSOM_TIME = 3f
private const val BLOSSOM_TICK = 0.25f
private const val BLOSSOM_RADIUS = 2.3f
private const val ORB_LIFE = 1.6f
private const val ORB_SPEED = 3.4f
private const val ORB_SPRAY = 0.07f
private const val ORB_BURST = 2.2f
private const val BLIZZARD_TIME = 5f
private const val TELEPORT_BURST = 1.6f
private const val HOLE_TIME = 3f
private const val HOLE_TICK = 0.5f
private const val HOLE_PULL = 4.5f
private const val HOLE_IMPLODE = 2.8f
private val ORB_ICE = Color(0xFFB3E5FC)
