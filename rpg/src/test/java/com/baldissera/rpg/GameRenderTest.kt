package com.baldissera.rpg

import android.content.Context
import android.graphics.Bitmap
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Canvas
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.Paint
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.graphics.drawscope.CanvasDrawScope
import androidx.compose.ui.text.TextMeasurer
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.font.createFontFamilyResolver
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.sp
import androidx.test.core.app.ApplicationProvider
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import java.io.File
import java.io.FileOutputStream
import kotlin.math.hypot
import kotlin.random.Random

/**
 * Renders a set of scenes to JPEG files (printed into the CI log so they can be inspected)
 * and plays the game headlessly across many floors to catch crashes.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class GameRenderTest {
    private val ctx: Context = ApplicationProvider.getApplicationContext()
    private val outDir = File("build/screens").apply { mkdirs() }

    init {
        Terrain.synchronous = true
    }

    private fun newGame(cls: HeroClass = HeroClass.KNIGHT): Game {
        val prefs = ctx.getSharedPreferences("test${System.nanoTime()}", Context.MODE_PRIVATE)
        return Game(Sfx(ctx), prefs).also { it.newGame(cls) }
    }

    private fun learnAll(g: Game, level: Int = 3) {
        for (s in g.player.heroClass.skills) g.player.skills[s] = level
        g.player.mana = g.player.maxMana
    }

    private fun step(g: Game, frames: Int) = repeat(frames) { g.update(1f / 60f) }

    private val wireDir = File("build/screens3d").apply { mkdirs() }

    private fun render(g: Game, a: Assets, name: String, w: Int = 720, h: Int = 1280) {
        // The same scene as data for the 3D renderer, rendered offline by tools/web3d.
        File(wireDir, "$name.json").writeText("{\"level\":${Wire.level(g)},\"frame\":${Wire.frame(g, 0f)}}")
        val image = ImageBitmap(w, h)
        val canvas = Canvas(image)
        val density = Density(2f)
        val measurer = TextMeasurer(createFontFamilyResolver(ctx), density, LayoutDirection.Ltr)
        val styles = TextStyles(
            small = TextStyle(fontSize = 15.sp, fontWeight = FontWeight.Bold),
            big = TextStyle(fontSize = 22.sp, fontWeight = FontWeight.Black),
            label = TextStyle(fontSize = 11.sp, fontWeight = FontWeight.Bold),
        )
        val scope = CanvasDrawScope()
        val size = Size(w.toFloat(), h.toFloat())
        scope.draw(density, LayoutDirection.Ltr, canvas, size) { drawScene(g, a, measurer, styles) }
        val small = Bitmap.createScaledBitmap(image.asAndroidBitmap(), w * 3 / 4, h * 3 / 4, true)
        FileOutputStream(File(outDir, "$name.jpg")).use { small.compress(Bitmap.CompressFormat.JPEG, 70, it) }
    }

    /** Puts the hero a couple of tiles from [e], on a walkable tile. */
    private fun approach(g: Game, e: Enemy) {
        for ((dx, dy) in listOf(0f to 2.2f, -2.2f to 0f, 2.2f to 0f, 0f to -2.2f, 1.5f to 1.5f)) {
            if (g.dungeon.walkableAt(e.x + dx, e.y + dy)) {
                g.player.x = e.x + dx
                g.player.y = e.y + dy
                return
            }
        }
    }

    private fun nearest(g: Game, pred: (Enemy) -> Boolean) =
        g.enemies.filter(pred).minByOrNull { hypot(it.x - g.player.x, it.y - g.player.y) }

    @Test
    fun screenshots() {
        val a = Assets(ctx.resources)
        val g = newGame()

        step(g, 20)
        render(g, a, "01_village_day")

        nearest(g) { it.type == EnemyType.WOLF || it.type == EnemyType.BANDIT }?.let { approach(g, it) }
        step(g, 50)
        g.attackHeld = true
        step(g, 20)
        g.attackHeld = false
        render(g, a, "02_world_fight_day")

        g.time = 180f
        val crypt = g.dungeon.entrances.first { it.region == Region.CRYPT }
        g.player.x = crypt.x + 0.5f
        g.player.y = crypt.y + 3.5f
        step(g, 10)
        render(g, a, "03_world_night_crypt")

        g.enterFloor(1)
        nearest(g) { !it.type.boss }?.let { approach(g, it) }
        step(g, 45)
        learnAll(g)
        g.cast(Skill.SHIELD_CHARGE)
        step(g, 8)
        render(g, a, "04_crypt_fight")

        g.enterFloor(1)
        val p = g.player
        val rarities = Rarity.entries
        for ((i, r) in rarities.withIndex()) {
            val angle = i / rarities.size.toFloat() * 6.28f
            val lx = p.x + kotlin.math.cos(angle) * 1.6f
            val ly = p.y + kotlin.math.sin(angle) * 1.2f
            g.loot += Loot(lx, ly, LootKind.Gear(g.makeItem(5, r, false, exact = true)))
        }
        g.loot += Loot(p.x + 0.4f, p.y + 0.9f, LootKind.Gold(120))
        g.loot += Loot(p.x - 0.5f, p.y + 0.9f, LootKind.Potion)
        step(g, 5)
        render(g, a, "05_loot_rarities")

        g.enterFloor(3)
        g.boss?.let { approach(g, it) }
        step(g, 60)
        render(g, a, "06_skeleton_king")

        if (g.dead) g.respawn()
        g.enterFloor(5)
        nearest(g) { true }?.let { approach(g, it) }
        step(g, 40)
        render(g, a, "07_caves")

        if (g.dead) g.respawn()
        g.enterFloor(8)
        nearest(g) { true }?.let { approach(g, it) }
        step(g, 40)
        g.cast(Skill.WHIRL)
        step(g, 6)
        learnAll(g)
        g.cast(Skill.CONSECRATE)
        step(g, 10)
        render(g, a, "08_hell")

        if (g.dead) g.respawn()
        g.player.level = 20
        g.player.hp = g.player.maxHp
        g.enterFloor(9)
        g.boss?.let { approach(g, it) }
        step(g, 90)
        render(g, a, "09_demon_lord")

        if (g.dead) g.respawn()
        g.player.hp = g.player.maxHp
        g.enterFloor(0)
        g.time = 0f
        g.player.x = g.merchantX - 1.5f
        g.player.y = g.merchantY + 1.5f
        step(g, 5)
        render(g, a, "10_merchant")

        g.time = 175f
        g.player.x = g.dungeon.village!!.x + 5.5f
        g.player.y = g.dungeon.village!!.y + 8.5f
        step(g, 5)
        render(g, a, "11_village_night")

        // A themed crypt room: find a room with a sarcophagus or altar.
        g.time = 0f
        if (g.dead) g.respawn()
        for (attempt in 0 until 10) {
            g.enterFloor(2)
            val deco = g.dungeon.props.firstOrNull { it.type == PropType.ALTAR || it.type == PropType.SARCOPHAGUS || it.type == PropType.BOOKSHELF }
            if (deco != null) {
                g.enemies.clear()
                g.player.x = deco.x
                g.player.y = deco.y + 2.5f
                if (!g.dungeon.walkableAt(g.player.x, g.player.y)) g.player.y = deco.y + 1.5f
                break
            }
        }
        step(g, 30)
        render(g, a, "12_crypt_room")

        g.enterFloor(4)
        val crystal = g.dungeon.props.firstOrNull { it.type == PropType.CRYSTALS || it.type == PropType.MUSHROOMS }
        if (crystal != null) {
            g.enemies.clear()
            g.player.x = crystal.x + 1.2f
            g.player.y = crystal.y + 1.5f
        }
        g.loot += Loot(g.player.x - 2.8f, g.player.y - 0.4f, LootKind.Shard("test"))
        step(g, 30)
        render(g, a, "13_cave_grotto")

        g.enterFloor(0)
        g.enemies.clear()
        g.time = 60f
        g.rain = 1f
        g.player.x = g.dungeon.village!!.x + 8.5f
        g.player.y = g.dungeon.village!!.y + 15.5f
        step(g, 5)
        render(g, a, "14_world_rain")

        // A champion with affixes, its shield up and an eruption about to go off.
        g.rain = 0f
        g.enterFloor(6)
        g.enemies.clear()
        val champ = Enemy(EnemyType.BRUTE, g.player.x + 1.8f, g.player.y - 0.4f, 6, elite = true,
            affixes = listOf(Affix.BURNING, Affix.SHIELDED, Affix.FROST), title = "Grumtand")
        g.enemies += champ
        step(g, 20)
        champ.shield = 1.5f
        champ.burnCd = 0.35f
        g.player.chill = 1f
        render(g, a, "15_champion")

        // One scene per class, mid-skill.
        fun showcase(cls: HeroClass, name: String, floor: Int, act: (Game) -> Unit) {
            val h = newGame(cls)
            h.player.level = 8
            h.player.hp = h.player.maxHp
            learnAll(h)
            h.enterFloor(floor)
            h.enemies.clear()
            val types = listOf(EnemyType.SKELETON, EnemyType.SKELETON, EnemyType.GHOST, EnemyType.SKELETON)
            for ((i, t) in types.withIndex()) {
                val ang = i * 1.57f + 0.4f
                val ex = h.player.x + kotlin.math.cos(ang) * 2.2f
                val ey = h.player.y + kotlin.math.sin(ang) * 1.8f
                if (h.dungeon.walkableAt(ex, ey)) h.enemies += Enemy(t, ex, ey, floor)
            }
            step(h, 30)
            act(h)
            render(h, a, name)
        }
        showcase(HeroClass.KNIGHT, "16_knight", 2) { h ->
            h.cast(Skill.CONSECRATE)
            h.cast(Skill.HOLY_SHIELD)
            step(h, 20)
            h.attack()
            step(h, 4)
        }
        showcase(HeroClass.BARBARIAN, "17_barbarian", 5) { h ->
            h.cast(Skill.WAR_CRY)
            step(h, 10)
            h.cast(Skill.BERSERK)
            step(h, 14)
        }
        showcase(HeroClass.ASSASSIN, "18_assassin", 2) { h ->
            h.cast(Skill.VENOM)
            step(h, 4)
            h.cast(Skill.FAN_OF_KNIVES)
            step(h, 6)
        }
        showcase(HeroClass.SORCERESS, "19_sorceress", 8) { h ->
            h.cast(Skill.METEOR)
            step(h, 20)
            h.attack()
            step(h, 4)
        }
        showcase(HeroClass.BARBARIAN, "20_barbarian_leap", 2) { h ->
            h.cast(Skill.LEAP)
            step(h, 14)
        }

        // The Scorched Sands: arriving under the midday sun with desert monsters about.
        fun desertHero(level: Int): Game = newGame().also { s ->
            s.player.level = level
            s.player.hp = s.player.maxHp
            learnAll(s)
        }
        val s = desertHero(10)
        s.time = 0f
        s.enterFloor(DESERT_FIRST)
        s.enemies.clear()
        for ((i, t) in listOf(EnemyType.SCORPION, EnemyType.MUMMY, EnemyType.DJINN, EnemyType.SCORPION, EnemyType.WOLF).withIndex()) {
            val ang = i * 1.26f + 0.5f
            val ex = s.player.x + kotlin.math.cos(ang) * 2.8f
            val ey = s.player.y + kotlin.math.sin(ang) * 2.2f
            if (s.dungeon.walkableAt(ex, ey)) s.enemies += Enemy(t, ex, ey, DESERT_LEVEL)
        }
        step(s, 30)
        render(s, a, "21_desert")

        // The oasis: the hero on the southern shore of the pool.
        s.time = 40f
        s.enemies.clear()
        s.player.hp = s.player.maxHp
        val od = s.dungeon
        val pool = od.tiles.indices.filter { od.tiles[it] == WATER }
        if (pool.isNotEmpty()) {
            val wx = pool.map { it % od.w }.average().toFloat() + 0.5f
            val wy = pool.maxOf { it / od.w } + 2.5f
            val spot = od.tiles.indices.filter { od.walkable(it % od.w, it / od.w) }
                .minByOrNull { hypot(it % od.w + 0.5f - wx, it / od.w + 0.5f - wy) }
            if (spot != null) {
                s.player.x = spot % od.w + 0.5f
                s.player.y = spot / od.w + 0.5f
                s.player.faceX = 0f
                s.player.faceY = -1f
            }
        }
        step(s, 20)
        render(s, a, "22_desert_oasis")

        // The Sand Pharaoh in his court, his sandstorm raging around the hero.
        val b = desertHero(18)
        b.time = 20f
        b.enterFloor(DESERT_LAST)
        b.boss?.let { pharaoh ->
            b.enemies.retainAll { it === pharaoh || hypot(it.x - pharaoh.x, it.y - pharaoh.y) > 12f }
            approach(b, pharaoh)
            step(b, 30)
            // Call the storm now and let it gather.
            pharaoh.blinkCd = 0f
            var wait = 0
            while (b.zones.none { it.kind == ZoneKind.SANDSTORM } && wait++ < 120) step(b, 1)
            b.player.hp = b.player.maxHp
            step(b, 50)
        }
        if (b.zones.none { it.kind == ZoneKind.SANDSTORM }) b.zones += Zone(b.player.x, b.player.y, SANDSTORM_RADIUS, 5f, ZoneKind.SANDSTORM, 0f)
        if (b.dead) b.dead = false
        render(b, a, "23_sand_pharaoh")
    }

    @Test
    fun simulateManyFloors() {
        val r = Random(7)
        for ((ci, cls) in HeroClass.entries.withIndex()) {
            val h = newGame(cls)
            h.player.level = 20
            learnAll(h, 4)
            // The main dungeon, all three depths of the Scorched Sands, then the wilds.
            for (floor in listOf(1, 5, 8) + (1..DESERT_FLOORS).map { desertFloor(it) } + 0) {
                h.enterFloor(floor)
                repeat(900) { i ->
                    if (i % 30 == 0) {
                        h.joyX = r.nextFloat() * 2f - 1f
                        h.joyY = r.nextFloat() * 2f - 1f
                    }
                    h.attackHeld = i % 90 < 50
                    val skill = cls.skills[(i / 60 + ci) % 4]
                    if (i % 60 == 0) h.cast(skill)
                    if (i % 300 == 0) h.dodge()
                    if (i % 400 == 0) h.drinkPotion()
                    if (h.dead) h.respawn()
                    if (h.victory) h.victory = false
                    h.update(1f / 30f)
                }
            }
            repeat(200) { check(h.makeItem(10, Rarity.RARE, false, slot = Slot.WEAPON).weaponKind!! in cls.weapons) }
        }
        val g = newGame()
        g.player.level = 25
        learnAll(g, 4)
        for (floor in listOf(0, 1, 2, 3, 4, 6, 7, 9, 10, 12, DESERT_FIRST, DESERT_LAST)) {
            g.enterFloor(floor)
            g.enemies += Enemy(EnemyType.BANDIT, g.player.x + 3f, g.player.y, g.dangerLevel + 1, elite = true, affixes = Affix.entries, title = "Test")
            repeat(1800) { i ->
                if (i % 30 == 0) {
                    g.joyX = r.nextFloat() * 2f - 1f
                    g.joyY = r.nextFloat() * 2f - 1f
                }
                g.attackHeld = i % 90 < 50
                if (i % 120 == 0) g.cast(Skill.SHIELD_CHARGE)
                if (i % 200 == 0) g.cast(Skill.WHIRL)
                if (i % 400 == 0) g.cast(Skill.CONSECRATE)
                if (i % 150 == 75) g.cast(Skill.HOLY_SHIELD)
                if (i % 500 == 0) g.drinkPotion()
                if (i == 900 && floor != 0) g.townPortal()
                if (g.dead) g.respawn()
                if (g.victory) g.victory = false
                g.update(1f / 30f)
            }
        }
        repeat(3000) { g.makeItem(r.nextInt(1, 20), Rarity.entries.random(r), r.nextBoolean()) }
        g.player.gold = 1_000_000
        repeat(20) {
            for (s in Slot.entries) g.gamble(s)?.let { if (g.isUpgrade(it)) g.equip(it) }
            g.sortInventory()
            g.sellJunk()
            g.player.inventory.toList().forEach { g.sell(it) }
        }
        // Heart fragments: found once, and four make a heart.
        g.enterFloor(0)
        val worldShards = g.loot.filter { it.kind is LootKind.Shard }
        check(worldShards.size >= 4) { "only ${worldShards.size} heart fragments in the world" }
        // The random walk above may already have picked some up.
        val found0 = g.shardsFound.size
        g.shardsFound.clear()
        g.player.hearts = 0
        val before = g.player.maxHp
        for (s in worldShards.take(4)) {
            g.player.x = s.x
            g.player.y = s.y
            step(g, 3)
        }
        val got = g.shardsFound.size
        check(got >= 4) { "collected $got fragments (had $found0)" }
        check(g.player.maxHp > before) { "no extra heart" }
        // The four collected fragments never come back, whatever the random walk found earlier.
        val taken = worldShards.take(4).map { (it.kind as LootKind.Shard).key }.toSet()
        g.enterFloor(0)
        check(g.loot.none { (it.kind as? LootKind.Shard)?.key in taken }) { "collected fragment respawned" }
        g.enterFloor(2)
        check(g.loot.any { (it.kind as? LootKind.Shard)?.key == "f2" }) { "no fragment on depth 2" }

        // Blacksmith and elder services.
        g.enterFloor(0)
        val item = g.makeItem(5, Rarity.RARE, false)
        g.player.inventory += item
        val reforged = g.reforge(item)!!
        check(reforged.rarity == item.rarity && reforged.slot == item.slot)
        var up = reforged
        repeat(4) { up = g.upgrade(up) ?: up }
        check(up.level > item.level)
        val offer = g.bountyOffers.first()
        g.acceptBounty(offer)
        val b = g.bounty!!
        b.got = b.need
        check(g.claimBounty() != null)
        g.save()
    }

    @Test
    fun worldsGenerate() {
        repeat(40) { seed ->
            val d = Dungeon.overworld(seed * 7919L)
            check(d.walkable(d.start.cx, d.start.cy)) { "village start blocked for seed $seed" }
            for (e in d.entrances) check(d.tile(e.x, e.y) == ENTRANCE)
            // The way to the desert is always open from the village.
            val sands = d.entrances.first { it.region == Region.DESERT }
            check(Dungeon.flood(d.tiles, d.w, d.h, d.start.cx, d.start.cy)[sands.y * d.w + sands.x]) { "desert entrance unreachable for seed $seed" }
        }
        val r = Random(3)
        for (b in listOf(Biome.CRYPT, Biome.CAVE, Biome.HELL)) repeat(40) {
            val d = Dungeon.generate(r, b)
            check(d.walkable(d.start.cx, d.start.cy))
            check(d.tile(d.exit.cx, d.exit.cy) == STAIRS)
        }
        // Desert depths: one connected stretch of sand with the stairs, an oasis, ruins and the desert's materials.
        val codes = setOf(SMat.SAND, SMat.DUNE, SMat.HARDPAN, SMat.PAVING, SMat.GRASS, SMat.WATER)
        repeat(60) { k ->
            val d = Dungeon.desert(r, 1 + k % DESERT_FLOORS)
            check(d.biome == Biome.DESERT && d.walkable(d.start.cx, d.start.cy))
            check(d.tile(d.exit.cx, d.exit.cy) == STAIRS)
            val reach = Dungeon.flood(d.tiles, d.w, d.h, d.start.cx, d.start.cy)
            for (i in d.tiles.indices) if (d.walkable(i % d.w, i / d.w)) check(reach[i]) { "cut-off sand at ${i % d.w},${i / d.w}" }
            check(d.tiles.any { it == WATER }) { "no oasis" }
            check(d.rooms.size >= 6) { "only ${d.rooms.size} rooms" }
            val mat = TerrainMap(d).mat.map { it.toInt() }.toSet()
            check(mat.all { it in codes }) { "unexpected desert materials $mat" }
            check(SMat.PAVING in mat && SMat.GRASS in mat) { "no ruins or oasis grass in $mat" }
        }
    }

    @Test
    fun desertRegion() {
        // Sealed until the Skeleton King falls.
        val s = newGame()
        val gate = s.dungeon.entrances.first { it.region == Region.DESERT }
        s.player.x = gate.x + 0.5f
        s.player.y = gate.y + 0.5f
        step(s, 3)
        check(s.inWorld) { "the sands opened before the Skeleton King fell" }

        // Desert floors never count as the deepest floor, and the stairs lead on through the sands.
        val g = newGame()
        g.player.level = 30
        g.player.hp = g.player.maxHp
        g.enterFloor(DESERT_FIRST)
        check(g.inDesert && g.outdoors && g.depth == 1 && g.dungeon.biome == Biome.DESERT)
        check(g.deepest == 0) { "desert counted as deepest" }
        check(g.areaTitle.startsWith("The Scorched Sands")) { g.areaTitle }
        check(g.enemies.isNotEmpty() && g.enemies.all { it.level == g.monsterLevel(DESERT_LEVEL) })
        g.enemies.clear()
        g.player.x = g.dungeon.exit.cx + 0.5f
        g.player.y = g.dungeon.exit.cy + 0.5f
        step(g, 40)
        check(g.floor == desertFloor(2)) { "stairs on depth 1 led to ${g.floor}" }

        // The pharaoh: sandstorms, summons and volleys, then his hoard, then the stairs lead home.
        g.enterFloor(DESERT_LAST)
        val boss = g.boss ?: error("no boss on the last desert depth")
        check(boss.type == EnemyType.SAND_PHARAOH) { "the boss is ${boss.type}" }
        check(g.dungeon.walkableAt(boss.x, boss.y))
        g.enemies.retainAll { it === boss }
        g.player.x = boss.x
        g.player.y = boss.y + 2.2f
        var storms = 0
        var onWire = false
        repeat(60 * 25) {
            g.player.hp = g.player.maxHp
            val before = g.zones.count { it.kind == ZoneKind.SANDSTORM }
            g.update(1f / 60f)
            if (g.zones.count { it.kind == ZoneKind.SANDSTORM } > before) {
                storms++
                // Zones go out as [x, y, radius, kind, progress].
                val zones = Wire.frame(g, 0f).substringAfter("\"zo\":").substringBefore(",\"me\":")
                onWire = onWire || zones.contains(",${ZoneKind.SANDSTORM.ordinal},")
            }
            g.dead = false
        }
        check(storms >= 2) { "only $storms sandstorms" }
        check(onWire) { "sandstorm missing from the wire" }
        g.enemies.retainAll { it === boss }
        g.player.hp = g.player.maxHp
        boss.hp = 0f
        g.update(1f / 60f)
        check(g.boss == null)
        val gear = g.loot.mapNotNull { (it.kind as? LootKind.Gear)?.item }
        check(gear.any { it.rarity >= Rarity.LEGENDARY }) { "no legendary in ${gear.map { it.rarity }}" }
        val gold = g.loot.sumOf { (it.kind as? LootKind.Gold)?.amount ?: 0 }
        check(gold >= 1500) { "only $gold gold" }
        check(g.questStage == 0 && !g.victory) { "the desert touched the main quest" }
        g.player.x = g.dungeon.exit.cx + 0.5f
        g.player.y = g.dungeon.exit.cy + 0.5f
        step(g, 40)
        check(g.floor == 0) { "stairs on the last depth led to ${g.floor}" }
        check(g.deepest == 0)
    }

    @Test
    fun knightBarbarianTreeSkills() {
        val knight = listOf(Skill.JUDGMENT, Skill.LIGHT_LANCE, Skill.BULWARK, Skill.HEAVENS_FURY)
        val barbarian = listOf(Skill.HARPOON, Skill.REND, Skill.SEISMIC_SLAM, Skill.AVALANCHE)

        /** Puts the hero on open ground facing east, alone with a tough mummy [d] tiles ahead. */
        fun dummy(g: Game, d: Float): Enemy {
            g.enemies.clear()
            val p = g.player
            val cx = floorInt(p.x)
            val cy = floorInt(p.y)
            val spot = (0 until 41 * 41).asSequence().map { i -> (cx + i % 41 - 20) to (cy + i / 41 - 20) }
                .firstOrNull { (x, y) -> (0..6).all { k -> g.dungeon.walkable(x + k, y) && g.dungeon.walkable(x + k, y + 1) && g.dungeon.walkable(x + k, y - 1) } }
                ?: error("no open ground on floor ${g.floor}")
            p.x = spot.first + 0.5f
            p.y = spot.second + 0.5f
            p.faceX = 1f
            p.faceY = 0f
            return Enemy(EnemyType.MUMMY, p.x + d, p.y, 10, elite = true).also { g.enemies += it }
        }

        // Each skill does what it says against a lone dummy, at ranks 1, 3 and 5, in a dungeon and in the desert.
        for (floor in listOf(1, desertFloor(1))) for (s in knight + barbarian) for (rank in listOf(1, 3, 5)) {
            val g = newGame(if (s in knight) HeroClass.KNIGHT else HeroClass.BARBARIAN)
            g.player.level = 15
            g.player.skills[s] = rank
            g.enterFloor(floor)
            g.player.hp = g.player.maxHp
            val e = dummy(g, if (s == Skill.REND) 1.5f else 3f)
            g.player.mana = g.player.maxMana
            g.cast(s)
            check((g.player.cooldowns[s] ?: 0f) > 0f) { "$s rank $rank was not cast" }
            var cue = false
            val frames = when (s) {
                Skill.BULWARK, Skill.HEAVENS_FURY -> 260
                Skill.AVALANCHE -> 120
                else -> 40
            }
            repeat(frames) {
                g.update(1f / 60f)
                cue = cue || g.skillFx.any { it.skill == s }
                if (s == Skill.BULWARK) g.player.hp = g.player.maxHp
            }
            check(cue) { "$s sent no visual cue" }
            // Bulwark hurts only through the blows it sends back.
            check(e.hp < e.maxHp) { "$s rank $rank did no damage on floor $floor" }
            when (s) {
                Skill.HARPOON -> check(hypot(e.x - g.player.x, e.y - g.player.y) < 1.8f) { "the spear did not drag its target" }
                Skill.REND -> check(e.bleed > 0f) { "Rend left no bleeding" }
                else -> {}
            }
            Wire.frame(g, 0f)
        }

        // Bulwark cuts the damage of a blow.
        run {
            val g = newGame()
            g.player.level = 10
            g.player.skills[Skill.BULWARK] = 5
            g.enterFloor(1)
            val e = dummy(g, 0.9f)
            fun blow(): Float {
                g.player.hp = g.player.maxHp
                e.cooldown = 0f
                e.windup = 0f
                var lost = 0f
                repeat(90) {
                    val before = g.player.hp
                    g.update(1f / 60f)
                    lost += (before - g.player.hp).coerceAtLeast(0f)
                }
                return lost
            }
            val plain = blow()
            g.player.mana = g.player.maxMana
            g.cast(Skill.BULWARK)
            val braced = blow()
            check(plain > 0f && braced < plain * 0.6f) { "Bulwark took $plain down to $braced" }
        }

        // All eight at ranks 1, 3 and 5, over and over, on dungeon, desert and wilderness floors.
        val r = Random(5)
        for ((cls, skills) in listOf(HeroClass.KNIGHT to knight, HeroClass.BARBARIAN to barbarian)) for (rank in listOf(1, 3, 5)) {
            val g = newGame(cls)
            g.player.level = 20
            for (s in skills) g.player.skills[s] = rank
            skills.forEachIndexed { i, s -> g.player.loadout[i] = s }
            for (floor in listOf(2, 7, desertFloor(1), desertFloor(3), 0)) {
                g.enterFloor(floor)
                repeat(600) { i ->
                    if (i % 30 == 0) {
                        g.joyX = r.nextFloat() * 2f - 1f
                        g.joyY = r.nextFloat() * 2f - 1f
                    }
                    g.attackHeld = i % 90 < 30
                    if (i % 15 == 0) {
                        val s = skills[(i / 15) % 4]
                        g.player.cooldowns[s] = 0f
                        g.player.mana = g.player.maxMana
                        g.cast(s)
                    }
                    if (g.dead) g.respawn()
                    if (g.victory) g.victory = false
                    g.update(1f / 30f)
                    if (i % 50 == 0) Wire.frame(g, 0f)
                }
            }
        }

        // Mid-skill scenes for the 2D fallback and the 3D renderer.
        val a = Assets(ctx.resources)
        for ((cls, skills) in listOf(HeroClass.KNIGHT to knight, HeroClass.BARBARIAN to barbarian)) {
            val g = newGame(cls)
            g.player.level = 12
            for (s in skills) g.player.skills[s] = 3
            g.enterFloor(2)
            g.player.hp = g.player.maxHp
            dummy(g, 3f)
            for (i in 0 until 4) {
                val ex = g.player.x + 2f + i * 0.9f
                val ey = g.player.y + (if (i % 2 == 0) 0.8f else -0.8f)
                if (g.dungeon.walkableAt(ex, ey)) g.enemies += Enemy(EnemyType.SKELETON, ex, ey, 2)
            }
            for (s in skills) {
                g.player.mana = g.player.maxMana
                g.cast(s)
                step(g, 6)
            }
            render(g, a, if (cls == HeroClass.KNIGHT) "40_knight_tree_skills" else "41_barbarian_tree_skills")
        }
    }

    @Test
    fun assassinSorceressSkills() {
        val r = Random(23)
        // The hero's corners stay off walls and water (his radius is 0.28 tiles, as in Game.blocked).
        fun clear(g: Game, x: Float, y: Float) = listOf(-0.28f to -0.28f, 0.28f to -0.28f, -0.28f to 0.28f, 0.28f to 0.28f)
            .all { (dx, dy) -> g.dungeon.walkableAt(x + dx, y + dy) }
        fun ready(g: Game) {
            g.player.mana = g.player.maxMana
            g.player.cooldowns.clear()
        }
        // Whether the frame's skill cues ("sf", entries [ordinal, ...]) hold one for [s].
        fun cue(g: Game, s: Skill) = Wire.frame(g, 0f).substringAfter("\"sf\":[").substringBefore("],\"dc\":").contains("[${s.ordinal},")
        // Puts the hero on a tile with [len] open tiles ahead of him, facing that way; returns the direction.
        fun placeOpen(g: Game, len: Float): Pair<Float, Float> {
            val d = g.dungeon
            for (y in 2 until d.h - 2) for (x in 2 until d.w - 2) {
                if (!d.walkable(x, y)) continue
                for (k in 0 until 8) {
                    val a = k * (Math.PI.toFloat() / 4f)
                    val dx = kotlin.math.cos(a)
                    val dy = kotlin.math.sin(a)
                    val cx = x + 0.5f
                    val cy = y + 0.5f
                    if ((0..(len * 4).toInt()).all { i -> clear(g, cx + dx * i / 4f, cy + dy * i / 4f) }) {
                        g.player.x = cx
                        g.player.y = cy
                        g.player.faceX = dx
                        g.player.faceY = dy
                        return dx to dy
                    }
                }
            }
            error("no open ground on floor ${g.floor}")
        }

        // Every new Assassin and Sorceress skill, cast over and over at ranks 1, 3 and 5 in the crypt, the caves,
        // the Scorched Sands and the wilds, with monsters around.
        for (cls in listOf(HeroClass.ASSASSIN, HeroClass.SORCERESS)) {
            val mine = cls.allSkills.drop(4)
            check(mine.size == 4)
            for (rank in listOf(1, 3, 5)) {
                val g = newGame(cls)
                g.player.level = 20
                for (s in mine) {
                    g.player.skills[s] = rank
                    check(s.describe(rank).isNotBlank())
                }
                mine.forEachIndexed { i, s -> g.player.loadout[i] = s }
                for (floor in listOf(1, 5, DESERT_FIRST, 0)) {
                    g.enterFloor(floor)
                    repeat(6) { k ->
                        val ex = g.player.x + kotlin.math.cos(k * 1.05f) * 2.5f
                        val ey = g.player.y + kotlin.math.sin(k * 1.05f) * 2.5f
                        if (g.dungeon.walkableAt(ex, ey)) g.enemies += Enemy(EnemyType.SKELETON, ex, ey, g.dangerLevel)
                    }
                    repeat(720) { i ->
                        if (i % 25 == 0) {
                            g.joyX = r.nextFloat() * 2f - 1f
                            g.joyY = r.nextFloat() * 2f - 1f
                        }
                        g.attackHeld = i % 90 < 40
                        if (i % 15 == 0) {
                            ready(g)
                            g.cast(mine[(i / 15 + rank) % 4])
                        }
                        g.player.hp = g.player.maxHp
                        if (g.dead) g.respawn()
                        if (g.victory) g.victory = false
                        g.update(1f / 30f)
                        check(g.dungeon.walkableAt(g.player.x, g.player.y)) { "$cls rank $rank: hero in a wall at ${g.player.x},${g.player.y} on floor ${g.floor}" }
                        if (i % 45 == 0) Wire.frame(g, 0f)
                    }
                    Wire.level(g)
                    Wire.frame(g, 0f)
                }
            }
        }

        // Teleport in the crypt's narrow halls: never into or through a wall, at most 7 tiles, and a wall right ahead stops it.
        val t = newGame(HeroClass.SORCERESS)
        t.player.level = 20
        t.player.skills[Skill.TELEPORT] = 5
        t.enterFloor(1)
        t.enemies.clear()
        val d = t.dungeon
        var far = 0
        var short = 0
        var walls = 0
        for (y in 1 until d.h - 1) for (x in 1 until d.w - 1) {
            if (!d.walkable(x, y)) continue
            val cx = x + 0.5f
            val cy = y + 0.5f
            val dirs = if ((x * 7 + y * 13) % 3 == 0) listOf(r.nextFloat() * 6.283f) else emptyList()
            // Straight at a neighbouring wall.
            val wall = listOf(0f to 1f, 1f to 0f, 0f to -1f, -1f to 0f).firstOrNull { (dx, dy) -> !d.walkable(x + dx.toInt(), y + dy.toInt()) }
            for (a in dirs + (if (wall != null) listOf(Float.NaN) else emptyList())) {
                t.player.x = cx
                t.player.y = cy
                t.joyX = if (a.isNaN()) wall!!.first else kotlin.math.cos(a)
                t.joyY = if (a.isNaN()) wall!!.second else kotlin.math.sin(a)
                ready(t)
                t.cast(Skill.TELEPORT)
                val moved = hypot(t.player.x - cx, t.player.y - cy)
                check(clear(t, t.player.x, t.player.y)) { "teleported into a wall at ${t.player.x},${t.player.y}" }
                check(moved <= 7.01f) { "teleported $moved tiles" }
                for (i in 1..28) check(d.walkableAt(cx + (t.player.x - cx) * i / 28f, cy + (t.player.y - cy) * i / 28f)) { "teleported through a wall" }
                if (a.isNaN()) {
                    check(moved < 0.3f) { "blinked $moved tiles into a wall" }
                    walls++
                } else if (moved > 6.9f) far++ else short++
            }
        }
        t.joyX = 0f
        t.joyY = 0f
        step(t, 30)
        check(far > 0 && short > 0 && walls > 0) { "teleports: $far far, $short cut short, $walls into walls" }

        // The other skills on the open sands, against frozen monsters placed around the hero.
        fun arena(cls: HeroClass): Game {
            val g = newGame(cls)
            g.player.level = 20
            for (s in cls.allSkills) g.player.skills[s] = 3
            g.enterFloor(DESERT_FIRST)
            g.enemies.clear()
            g.player.hp = g.player.maxHp
            return g
        }
        fun foe(g: Game, dir: Pair<Float, Float>, dist: Float): Enemy =
            Enemy(EnemyType.MUMMY, g.player.x + dir.first * dist, g.player.y + dir.second * dist, 30).also {
                it.frozen = 60f
                g.enemies += it
            }

        // Blade Dance strikes every enemy in reach, and nothing hurts the hero meanwhile.
        val bd = arena(HeroClass.ASSASSIN)
        val bdDir = placeOpen(bd, 5f)
        val dancers = listOf(1.5f, 3f, 4.5f).map { foe(bd, bdDir, it) }
        ready(bd)
        bd.cast(Skill.BLADE_DANCE)
        check(bd.player.dance > 0f) { "no blade dance" }
        bd.projectiles += Projectile(bd.player.x, bd.player.y, 0f, 0f, 500f, hostile = true, color = androidx.compose.ui.graphics.Color.Red)
        val hp0 = bd.player.hp
        step(bd, 1)
        check(bd.player.hp == hp0) { "hurt while dancing" }
        check(bd.ghosts.isNotEmpty() && cue(bd, Skill.BLADE_DANCE)) { "no afterimages or dance cue" }
        step(bd, 60)
        check(bd.player.dance == 0f) { "the dance never ended" }
        check(dancers.all { it.hp < it.maxHp }) { "the dance struck ${dancers.count { it.hp < it.maxHp }} of 3" }

        // Mark for Death: more damage taken, and the kill gives mana back and readies the mark again.
        val mk = arena(HeroClass.ASSASSIN)
        val mkDir = placeOpen(mk, 3f)
        val marked = foe(mk, mkDir, 2f)
        ready(mk)
        mk.cast(Skill.MARK_FOR_DEATH)
        check(marked.damageTakenMult > 1.4f && cue(mk, Skill.MARK_FOR_DEATH)) { "no mark" }
        check(!mk.skillReady(Skill.MARK_FOR_DEATH))
        step(mk, 30)
        mk.player.mana = 0f
        marked.hp = 0f
        step(mk, 2)
        check(marked !in mk.enemies && mk.player.mana > mk.player.maxMana * 0.2f) { "no mana back: ${mk.player.mana}" }
        check(mk.skillReady(Skill.MARK_FOR_DEATH)) { "the mark is not ready again" }

        // Death Traps: three at most, quiet with no one near, and they go off when an enemy steps up.
        val tr = arena(HeroClass.ASSASSIN)
        placeOpen(tr, 3f)
        repeat(4) {
            ready(tr)
            tr.cast(Skill.DEATH_TRAP)
        }
        check(tr.zones.count { it.kind == ZoneKind.TRAP } == 3) { "${tr.zones.count { it.kind == ZoneKind.TRAP }} traps" }
        step(tr, 45)
        check(tr.zones.count { it.kind == ZoneKind.TRAP } == 3) { "a trap went off with no one near" }
        val trap = tr.zones.first { it.kind == ZoneKind.TRAP }
        val victim = Enemy(EnemyType.MUMMY, trap.x + 0.3f, trap.y, 30).also {
            it.frozen = 60f
            tr.enemies += it
        }
        step(tr, 3)
        check(tr.zones.none { it.kind == ZoneKind.TRAP } && victim.hp < victim.maxHp) { "the traps did not go off" }

        // Death Blossom shreds what is close and spares what is out of reach.
        val db = arena(HeroClass.ASSASSIN)
        val dbDir = placeOpen(db, 3.5f)
        val close = foe(db, dbDir, 1.5f)
        val away = foe(db, dbDir, 3.4f)
        ready(db)
        db.cast(Skill.DEATH_BLOSSOM)
        step(db, 30)
        check(cue(db, Skill.DEATH_BLOSSOM) && close.hp < close.maxHp && away.hp == away.maxHp) { "blossom: ${close.hp}/${close.maxHp}, ${away.hp}" }
        step(db, 200)
        check(db.player.blossom == 0f && db.skillFx.none { it.skill == Skill.DEATH_BLOSSOM }) { "the blossom never ended" }

        // Frozen Orb: its shards hurt and chill (half speed), then it bursts and is gone.
        val fo = arena(HeroClass.SORCERESS)
        val foDir = placeOpen(fo, 4f)
        val iced = foe(fo, foDir, 3f)
        ready(fo)
        fo.cast(Skill.FROZEN_ORB)
        var slowed = false
        var orb = false
        repeat(130) {
            fo.update(1f / 60f)
            slowed = slowed || (iced.chill > 0f && iced.speed < iced.type.speed * 0.6f)
            orb = orb || cue(fo, Skill.FROZEN_ORB)
        }
        check(slowed && orb && iced.hp < iced.maxHp) { "orb: slowed=$slowed cue=$orb hp=${iced.hp}" }
        check(fo.skillFx.none { it.skill == Skill.FROZEN_ORB }) { "the orb never burst" }

        // Blizzard: a zone that hurts and chills, gone after 5 s.
        val bz = arena(HeroClass.SORCERESS)
        val bzDir = placeOpen(bz, 4f)
        val snowed = foe(bz, bzDir, 3f)
        ready(bz)
        bz.cast(Skill.BLIZZARD)
        check(bz.zones.any { it.kind == ZoneKind.BLIZZARD }) { "no blizzard" }
        step(bz, 60)
        check(snowed.chill > 0f && snowed.hp < snowed.maxHp) { "the blizzard missed" }
        step(bz, 300)
        check(bz.zones.none { it.kind == ZoneKind.BLIZZARD }) { "the blizzard never ended" }

        // Black Hole: drags enemies to its centre, then implodes and stuns them.
        val bh = arena(HeroClass.SORCERESS)
        val bhDir = placeOpen(bh, 6f)
        val core = foe(bh, bhDir, 2.5f)
        val drifter = foe(bh, bhDir, 5f)
        ready(bh)
        bh.cast(Skill.BLACK_HOLE)
        val hole = bh.zones.first { it.kind == ZoneKind.BLACK_HOLE }
        val gap = hypot(drifter.x - hole.x, drifter.y - hole.y)
        step(bh, 60)
        check(hypot(drifter.x - hole.x, drifter.y - hole.y) < gap - 0.5f) { "the black hole pulled nothing" }
        check(cue(bh, Skill.BLACK_HOLE) && bh.dungeon.walkableAt(drifter.x, drifter.y))
        step(bh, 150)
        check(bh.zones.none { it.kind == ZoneKind.BLACK_HOLE }) { "the black hole never imploded" }
        check(core.stun > 0f && core.hp < core.maxHp) { "the implosion missed" }
    }
}
