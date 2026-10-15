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

    private fun newGame(): Game {
        val prefs = ctx.getSharedPreferences("test${System.nanoTime()}", Context.MODE_PRIVATE)
        return Game(Sfx(ctx), prefs).also { it.newGame() }
    }

    private fun step(g: Game, frames: Int) = repeat(frames) { g.update(1f / 60f) }

    private fun render(g: Game, a: Assets, name: String, w: Int = 720, h: Int = 1280) {
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
        scope.draw(density, LayoutDirection.Ltr, canvas, size) { drawWorld(g, a, measurer, styles) }
        canvas.saveLayer(Rect(0f, 0f, w.toFloat(), h.toFloat()), Paint())
        scope.draw(density, LayoutDirection.Ltr, canvas, size) { drawLighting(g) }
        canvas.restore()
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
        g.cast(Skill.FIREBALL)
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
        g.player.skills[Skill.CHAIN] = 3
        g.player.mana = g.player.maxMana
        g.cast(Skill.CHAIN)
        step(g, 2)
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
        g.loot += Loot(g.player.x - 1.2f, g.player.y - 0.6f, LootKind.Shard("test"))
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
    }

    @Test
    fun simulateManyFloors() {
        val g = newGame()
        val r = Random(7)
        g.player.level = 25
        g.player.skills[Skill.NOVA] = 3
        g.player.skills[Skill.CHAIN] = 4
        for (floor in listOf(0, 1, 2, 3, 4, 6, 7, 9, 10, 12)) {
            g.enterFloor(floor)
            g.enemies += Enemy(EnemyType.BANDIT, g.player.x + 3f, g.player.y, floor + 1, elite = true, affixes = Affix.entries, title = "Test")
            repeat(1800) { i ->
                if (i % 30 == 0) {
                    g.joyX = r.nextFloat() * 2f - 1f
                    g.joyY = r.nextFloat() * 2f - 1f
                }
                g.attackHeld = i % 90 < 50
                if (i % 120 == 0) g.cast(Skill.FIREBALL)
                if (i % 200 == 0) g.cast(Skill.WHIRL)
                if (i % 400 == 0) g.cast(Skill.NOVA)
                if (i % 150 == 75) g.cast(Skill.CHAIN)
                if (i % 500 == 0) g.drinkPotion()
                if (i == 900 && floor > 0) g.townPortal()
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
        val before = g.player.maxHp
        for (s in worldShards.take(4)) {
            g.player.x = s.x
            g.player.y = s.y
            step(g, 3)
        }
        check(g.shardsFound.size == 4) { "collected ${g.shardsFound.size} fragments" }
        check(g.player.maxHp > before) { "no extra heart" }
        g.enterFloor(0)
        check(g.loot.count { it.kind is LootKind.Shard } == worldShards.size - 4)
        g.enterFloor(2)
        check(g.loot.any { (it.kind as? LootKind.Shard)?.key == "f2" }) { "no fragment on depth 2" }

        // Blacksmith and elder services.
        g.enterFloor(0)
        val item = g.makeItem(5, Rarity.RARE, false)
        g.player.inventory += item
        val reforged = g.reforge(item)!!
        check(reforged.rarity == Rarity.RARE && reforged.slot == item.slot)
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
        }
        val r = Random(3)
        for (b in listOf(Biome.CRYPT, Biome.CAVE, Biome.HELL)) repeat(40) {
            val d = Dungeon.generate(r, b)
            check(d.walkable(d.start.cx, d.start.cy))
            check(d.tile(d.exit.cx, d.exit.cy) == STAIRS)
        }
    }
}
