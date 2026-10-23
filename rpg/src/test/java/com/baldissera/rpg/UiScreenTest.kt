package com.baldissera.rpg

import android.content.Context
import android.graphics.Bitmap
import android.view.View
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.test.core.app.ApplicationProvider
import org.json.JSONObject
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import org.robolectric.shadows.ShadowChoreographer
import org.robolectric.shadows.ShadowLooper
import java.io.File
import java.io.FileOutputStream
import java.time.Duration
import java.util.concurrent.TimeUnit

/** Screenshots of the full screen (world + HUD + menus) through the real Compose UI. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], qualifiers = "w360dp-h780dp-xhdpi")
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class UiScreenTest {
    private val outDir = File("build/screens").apply { mkdirs() }

    init {
        Terrain.synchronous = true
    }

    private fun shoot(name: String, overlay: Int, setup: (Game) -> Unit = {}) {
        // Space frames like a real 60 Hz display so idling renders a handful of frames, not hundreds.
        ShadowChoreographer.setFrameDelay(Duration.ofMillis(16))
        val t0 = System.currentTimeMillis()
        fun log(step: String) = println("[ui $name] $step after ${System.currentTimeMillis() - t0} ms")
        log("start")
        // A bare activity: MainActivity's own screen runs the endless game loop, which never lets the looper go idle.
        val activity = Robolectric.buildActivity(ComponentActivity::class.java).setup().get()
        log("activity ready")
        val ctx = activity.applicationContext
        val sfx = Sfx(ctx)
        val prefs = ctx.getSharedPreferences("ui${System.nanoTime()}", Context.MODE_PRIVATE)
        val game = Game(sfx, prefs).also { it.newGame() }
        val assets = Assets(ctx.resources)
        val settings = ctx.getSharedPreferences("settings-test", Context.MODE_PRIVATE)
        val music = Music(ctx).also { it.enabled = false }
        setup(game)
        repeat(20) { game.update(1f / 60f) }
        activity.setContent {
            MaterialTheme(colorScheme = darkColorScheme()) {
                RpgScreen(game, assets, music, sfx, settings, autoStart = overlay != -2 && overlay != -3,
                    debugOverlay = if (overlay < 0) -1 else overlay, animate = false, debugChooseClass = overlay == -3)
            }
        }
        log("content set")
        repeat(4) {
            ShadowLooper.idleMainLooper(20, TimeUnit.MILLISECONDS)
            log("idle ${it + 1}")
        }
        val root: View = activity.window.decorView
        val bmp = Bitmap.createBitmap(root.width, root.height, Bitmap.Config.ARGB_8888)
        root.draw(android.graphics.Canvas(bmp))
        val small = Bitmap.createScaledBitmap(bmp, root.width * 3 / 4, root.height * 3 / 4, true)
        FileOutputStream(File(outDir, "$name.jpg")).use { small.compress(Bitmap.CompressFormat.JPEG, 72, it) }
        log("saved")
    }

    private fun loadUp(g: Game) {
        g.player.level = 9
        g.player.gold = 4321
        g.player.skillPoints = 2
        repeat(10) { g.player.inventory += g.makeItem(8, Rarity.entries.random(), false) }
        for (s in Slot.entries) g.player.equipment[s] = g.makeItem(7, Rarity.entries.random(), false, slot = s)
    }

    /** A level 12 knight with some of the tree learned, a new skill on the second button and points left over. */
    private fun treeUp(g: Game) {
        loadUp(g)
        g.player.level = 12
        g.player.skillPoints = 9
        repeat(2) { g.learnTalent(Talent.MIGHT) }
        g.learn(Skill.WHIRL)
        g.learnTalent(Talent.PRECISION)
        g.learn(Skill.LIGHT_LANCE)
        g.learn(Skill.HOLY_SHIELD)
        g.learnTalent(Talent.VITALITY)
        g.equipSkill(Skill.LIGHT_LANCE, 1)
    }

    @Test fun title() = shoot("u0_title", -2)
    @Test fun hud() = shoot("u1_hud", -1)
    @Test fun inventory() = shoot("u2_inventory", 1, ::loadUp)
    @Test fun skills() = shoot("u3_skills", 2, ::treeUp)
    @Test @Config(qualifiers = "w800dp-h360dp-xhdpi") fun skillsLandscape() = shoot("u3b_skills_landscape", 2, ::treeUp)
    @Test fun shop() = shoot("u4_shop", 4, ::loadUp)
    @Test fun smith() = shoot("u5_smith", 6, ::loadUp)
    @Test fun elder() = shoot("u6_elder", 7, ::loadUp)
    @Test fun map() = shoot("u7_map", 5) { g -> g.player.x += 10f; repeat(200) { g.update(1f / 30f) } }
    @Test fun quests() = shoot("u8_quests", 3) { g ->
        g.shardsFound += listOf("w0", "w1", "w2", "w3", "f1")
        g.player.hearts = 1
    }
    @Test fun stash() = shoot("u9_stash", 9) { g ->
        loadUp(g)
        repeat(12) { g.stash += g.makeItem(6, Rarity.entries.random(), false) }
    }
    @Test fun dead() = shoot("u10_dead", -1) { g -> g.dead = true }
    @Test fun victory() = shoot("u11_victory", -1) { g -> g.victory = true }
    @Test fun classSelect() = shoot("u12_class_select", -3)
    @Test fun sorceressHud() = shoot("u13_hud_sorceress", -1) { g ->
        g.newGame(HeroClass.SORCERESS)
        for (s in g.player.heroClass.skills) g.player.skills[s] = 1
    }

    /** The skill tree's rules: requirements, talents changing stats, equipping, a save/load round trip, a reset and old saves. */
    @Test
    fun skillTreeLogic() {
        val ctx: Context = ApplicationProvider.getApplicationContext()
        for (cls in HeroClass.entries) {
            val tree = SkillTree.of(cls)
            check(tree.branches.size == 3 && tree.nodes.all { it.tier in 0 until SkillTree.TIERS })
            check(cls.allSkills.size == 8 && cls.allSkills.take(4) == cls.skills)
            check(tree.nodes.mapNotNull { it.skill }.toSet() == cls.allSkills.toSet()) { "actives of $cls" }
            val talents = tree.nodes.mapNotNull { it.talent }
            check(talents.size >= 8 && talents.size == talents.toSet().size) { "talents of $cls" }
            for (s in cls.skills) check(tree.node(s)!!.tier <= 1) { "$s must stay in tiers 1-2" }
            check(tree.node(cls.allSkills.last())!!.tier == SkillTree.TIERS - 1) { "the ultimate of $cls goes last" }
        }

        val prefs = ctx.getSharedPreferences("tree${System.nanoTime()}", Context.MODE_PRIVATE)
        val g = Game(Sfx(ctx), prefs).also { it.newGame(HeroClass.KNIGHT) }
        val p = g.player
        check(p.loadout.toList() == HeroClass.KNIGHT.skills)
        p.skillPoints = 10
        g.learn(Skill.HOLY_SHIELD)
        check((p.skills[Skill.HOLY_SHIELD] ?: 0) == 0) { "tier 2 needs level 5" }
        p.level = 12
        g.learn(Skill.LIGHT_LANCE)
        check((p.skills[Skill.LIGHT_LANCE] ?: 0) == 0) { "needs a point in Precision first" }
        val damage = p.damage
        repeat(3) { g.learnTalent(Talent.MIGHT) }
        check(p.talentRank(Talent.MIGHT) == 3 && p.damage > damage)
        val life = p.maxHp
        g.learnTalent(Talent.VITALITY)
        check(p.maxHp > life)
        g.learnTalent(Talent.PRECISION)
        g.learn(Skill.LIGHT_LANCE)
        g.learn(Skill.HOLY_SHIELD)
        check(p.skillPoints == 3 && p.skills[Skill.LIGHT_LANCE] == 1 && p.skills[Skill.HOLY_SHIELD] == 1)

        // A learned active goes on a button, swapping with the button it already sat on.
        g.equipSkill(Skill.LIGHT_LANCE, 0)
        check(p.loadout[0] == Skill.LIGHT_LANCE)
        g.equipSkill(Skill.LIGHT_LANCE, 2)
        check(p.loadout[2] == Skill.LIGHT_LANCE && p.loadout[0] == Skill.CONSECRATE)
        g.equipSkill(Skill.HEAVENS_FURY, 1)
        check(p.loadout[1] == Skill.SHIELD_CHARGE) { "unlearned skills stay off the buttons" }
        p.mana = p.maxMana
        g.cast(Skill.LIGHT_LANCE)
        repeat(30) { g.update(1f / 30f) }

        // Save and load.
        g.save()
        val g2 = Game(Sfx(ctx), prefs)
        val p2 = g2.player
        check(p2.talentRank(Talent.MIGHT) == 3 && p2.talentRank(Talent.VITALITY) == 1 && p2.talentRank(Talent.PRECISION) == 1)
        check(p2.skills[Skill.LIGHT_LANCE] == 1 && p2.loadout.toList() == p.loadout.toList())
        check(p2.skillPoints == p.skillPoints && p2.maxHp == p.maxHp && p2.damage == p.damage)

        // A reset costs gold, gives every point back and keeps the two starting skills.
        p2.gold = 0
        check(!g2.resetSkills())
        p2.gold = g2.resetPrice
        val total = p2.skillPoints + g2.spentPoints()
        check(g2.spentPoints() == 7)
        check(g2.resetSkills())
        check(p2.gold == 0 && p2.skillPoints == total && p2.talentPoints == 0)
        check(p2.skills[Skill.WHIRL] == 1 && p2.skills[Skill.SHIELD_CHARGE] == 1 && p2.skills[Skill.LIGHT_LANCE] == 0)
        check(p2.loadout.toList() == HeroClass.KNIGHT.skills)

        // A save from before the tree: default buttons, and the points it would have earned (two fifth levels, one boss).
        val old = ctx.getSharedPreferences("old${System.nanoTime()}", Context.MODE_PRIVATE)
        val json = JSONObject().put("level", 10).put("xp", 0).put("gold", 5).put("potions", 1).put("quest", 1).put("points", 0)
            .put("class", "BARBARIAN").put("skills", JSONObject().put("LEAP", 2))
        old.edit().putString("save3", json.toString()).commit()
        val g3 = Game(Sfx(ctx), old)
        check(g3.player.heroClass == HeroClass.BARBARIAN && g3.player.skillPoints == 3)
        check(EnemyType.SKELETON_KING.name in g3.bossesSlain)
        check(g3.player.loadout.toList() == HeroClass.BARBARIAN.skills)
        check(g3.player.skills[Skill.LEAP] == 2 && g3.player.skills[Skill.WAR_CRY] == 1 && g3.player.skills[Skill.AVALANCHE] == 0)
    }
}
