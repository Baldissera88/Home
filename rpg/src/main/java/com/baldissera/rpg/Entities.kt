package com.baldissera.rpg

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextLayoutResult
import org.json.JSONObject
import kotlin.random.Random

// ---------------------------------------------------------------- items

enum class Slot(val label: String) {
    WEAPON("Våben"), HELM("Hjelm"), ARMOR("Rustning"), BOOTS("Støvler"), AMULET("Amulet"), RING("Ring")
}

enum class Rarity(val label: String, val color: Color, val mult: Float) {
    COMMON("Almindelig", Color(0xFFD8D8D8), 1f),
    MAGIC("Magisk", Color(0xFF6C8CFF), 1.5f),
    RARE("Sjælden", Color(0xFFFFE066), 2.2f),
    LEGENDARY("Legendarisk", Color(0xFFFF8C1A), 3.2f),
}

/** Column in the item icon strip. */
object Icons {
    const val SWORD = 0
    const val AXE = 1
    const val MACE = 2
    const val HELM = 3
    const val ARMOR = 4
    const val BOOTS = 5
    const val AMULET = 6
    const val RING = 7
    const val POTION = 8
}

class Item(
    val slot: Slot,
    val name: String,
    val rarity: Rarity,
    val icon: Int,
    val level: Int,
    val damage: Int = 0,
    val armor: Int = 0,
    val life: Int = 0,
    val crit: Int = 0,
    val mana: Int = 0,
    val lifeSteal: Int = 0,
    val speed: Int = 0,
) {
    val power: Int get() = damage * 3 + armor * 2 + life / 2 + crit * 3 + mana / 2 + lifeSteal * 4 + speed * 2
    val sellPrice: Int get() = maxOf(1, power * 2)
    val buyPrice: Int get() = maxOf(10, power * 9)

    fun stats(): List<Pair<String, Int>> = listOf(
        "skade" to damage, "rustning" to armor, "liv" to life, "% kritisk" to crit,
        "mana" to mana, "% livsdræn" to lifeSteal, "% fart" to speed,
    ).filter { it.second != 0 }

    fun statLine(): String = stats().joinToString(", ") { "+${it.second} ${it.first}" }

    fun toJson(): JSONObject = JSONObject()
        .put("slot", slot.name).put("name", name).put("rarity", rarity.name).put("icon", icon).put("level", level)
        .put("damage", damage).put("armor", armor).put("life", life).put("crit", crit)
        .put("mana", mana).put("lifeSteal", lifeSteal).put("speed", speed)

    companion object {
        fun fromJson(o: JSONObject?): Item? = runCatching {
            o!!
            Item(
                Slot.valueOf(o.getString("slot")), o.getString("name"), Rarity.valueOf(o.getString("rarity")),
                o.getInt("icon"), o.optInt("level", 1),
                o.optInt("damage"), o.optInt("armor"), o.optInt("life"), o.optInt("crit"),
                o.optInt("mana"), o.optInt("lifeSteal"), o.optInt("speed"),
            )
        }.getOrNull()
    }
}

// ---------------------------------------------------------------- skills

enum class Skill(val label: String, val icon: String, val mana: Float, val cooldown: Float, val color: Color, val describe: (Int) -> String) {
    FIREBALL("Ildkugle", "🔥", 12f, 0.35f, Color(0xFFFF7A1A), { l -> "Kaster en eksploderende ildkugle. ${160 + (l - 1) * 40}% skade." }),
    WHIRL("Hvirvelslag", "🌀", 20f, 1.0f, Color(0xFF90CAF9), { l -> "Svinger sværdet hele vejen rundt. ${130 + (l - 1) * 30}% skade." }),
    NOVA("Frostnova", "❄️", 25f, 6f, Color(0xFF80DEEA), { l -> "Fryser alle fjender tæt på i ${"%.1f".format(2f + l * 0.5f)} sek. ${100 + (l - 1) * 25}% skade." }),
}

enum class Buff(val label: String, val color: Color) {
    MIGHT("Styrke: +50% skade", Color(0xFFFF7043)),
    SWIFT("Hurtighed: +35% fart", Color(0xFF81C784)),
    WARD("Beskyttelse: −40% skade", Color(0xFF64B5F6)),
}

// ---------------------------------------------------------------- bodies

interface Body {
    var x: Float
    var y: Float
}

class Player : Body {
    override var x = 0f
    override var y = 0f
    var faceX = 0f
    var faceY = 1f
    var level = 1
    var xp = 0
    var gold = 0
    var potions = 3
    var hp = 0f
    var mana = 0f
    val equipment = mutableMapOf<Slot, Item>()
    val inventory = mutableListOf<Item>()
    val skills = mutableMapOf(Skill.FIREBALL to 1, Skill.WHIRL to 1, Skill.NOVA to 0)
    val cooldowns = mutableMapOf<Skill, Float>()
    var skillPoints = 0
    var swing = 0f
    var whirl = 0f
    var cast = 0f
    var attackCd = 0f
    var hurt = 0f
    var sinceHurt = 10f
    var walk = 0f
    var moving = false
    var buff: Buff? = null
    var buffTime = 0f

    private fun sum(f: (Item) -> Int) = equipment.values.sumOf(f)
    val maxHp: Float get() = 70f + level * 14f + sum { it.life }
    val maxMana: Float get() = 40f + level * 5f + sum { it.mana }
    val damage: Int get() {
        val base = 6 + level * 2 + sum { it.damage }
        return if (buff == Buff.MIGHT) (base * 1.5f).toInt() else base
    }
    val armorValue: Int get() = level + sum { it.armor }
    val critChance: Int get() = 5 + sum { it.crit }
    val lifeSteal: Int get() = sum { it.lifeSteal }
    val speed: Float get() = 3.4f * (1f + sum { it.speed } / 100f) * (if (buff == Buff.SWIFT) 1.35f else 1f)
    val xpToNext: Int get() = 40 + level * level * 22
}

enum class EnemyType(
    val label: String,
    val hp: Int,
    val dmg: Int,
    val speed: Float,
    val radius: Float,
    val xp: Int,
    val range: Float,
    val windup: Float,
    val cooldown: Float,
    val aggro: Float,
    val boss: Boolean = false,
    val ranged: Boolean = false,
) {
    SLIME("Slim", 22, 6, 1.1f, 0.3f, 8, 0.85f, 0.45f, 1.1f, 5f),
    BAT("Flagermus", 14, 4, 2.8f, 0.24f, 7, 0.75f, 0.25f, 0.9f, 6f),
    SKELETON("Skelet", 32, 8, 1.7f, 0.3f, 12, 1.0f, 0.45f, 1.2f, 6f),
    SPIDER("Edderkop", 26, 7, 2.3f, 0.32f, 11, 0.9f, 0.35f, 1.0f, 6f),
    CULTIST("Kultist", 28, 9, 1.5f, 0.3f, 16, 5.5f, 0.6f, 2.2f, 7f, ranged = true),
    BRUTE("Ork-brute", 85, 16, 1.25f, 0.42f, 30, 1.2f, 0.7f, 1.8f, 6f),
    SKELETON_KING("Knoglekongen", 520, 22, 1.6f, 0.5f, 260, 1.4f, 0.6f, 1.4f, 8f, boss = true),
    SPIDER_QUEEN("Edderkoppedronningen", 700, 24, 1.8f, 0.6f, 360, 1.4f, 0.5f, 1.3f, 8f, boss = true),
    DEMON_LORD("Dæmonherren", 900, 28, 1.5f, 0.7f, 480, 1.6f, 0.6f, 1.4f, 9f, boss = true),
    SHADOW_KING("Skyggekongen", 1300, 34, 1.7f, 0.75f, 900, 1.7f, 0.55f, 1.3f, 10f, boss = true),
}

class Enemy(val type: EnemyType, override var x: Float, override var y: Float, floor: Int, val elite: Boolean = false) : Body {
    private val scale = (1f + 0.3f * (floor - 1)) * (if (elite) 3f else 1f)
    val maxHp = type.hp * scale
    var hp = maxHp
    val dmg = type.dmg * (1f + 0.17f * (floor - 1)) * (if (elite) 1.5f else 1f)
    val xp = (type.xp * (1f + 0.22f * (floor - 1)) * (if (elite) 3f else 1f)).toInt()
    val size = if (elite) 1.25f else 1f
    var windup = 0f
    var cooldown = 0.5f
    var flash = 0f
    var frozen = 0f
    var kx = 0f
    var ky = 0f
    var faceX = 0f
    var faceY = 1f
    var moving = false
    var aggro = false
    var anim = 0f
    var special = 4f
    var summon = 7f
    val phase = Random.nextFloat() * 6.28f
    var label: TextLayoutResult? = null
    val name: String get() = if (elite) "Champion ${type.label.lowercase()}" else type.label
}

class Projectile(
    var x: Float,
    var y: Float,
    val vx: Float,
    val vy: Float,
    val dmg: Float,
    val hostile: Boolean,
    val color: Color,
    var life: Float = 2f,
    val radius: Float = 0.18f,
    val aoe: Float = 0f,
)

sealed interface LootKind {
    data class Gold(val amount: Int) : LootKind
    data object Potion : LootKind
    data class Gear(val item: Item) : LootKind
}

class Loot(val x: Float, val y: Float, val kind: LootKind) {
    val phase = Random.nextFloat() * 6.28f
    var label: TextLayoutResult? = null
}

enum class PropType(val sprite: Int, val brokenSprite: Int, val solid: Boolean, val breakable: Boolean) {
    BARREL(0, 1, true, true),
    URN(2, 3, true, true),
    CHEST(4, 5, true, false),
    SHRINE(6, 6, true, false),
    CAMPFIRE(7, 7, true, false),
    SKULLS(8, 8, false, false),
    CRATE(9, 1, true, true),
    GRAVESTONE(10, 10, true, false),
}

class Prop(val type: PropType, val x: Float, val y: Float) {
    var used = false
}

class Decal(val x: Float, val y: Float, val kind: Int, val rotation: Float, val scale: Float)

class FloatText(var x: Float, var y: Float, val text: String, val color: Color, val big: Boolean = false) {
    var age = 0f
    var layout: TextLayoutResult? = null
}

class Particle(
    var x: Float,
    var y: Float,
    var vx: Float,
    var vy: Float,
    val color: Color,
    val size: Float,
    val life: Float,
    val glow: Boolean = false,
    val gravity: Float = 0f,
    var z: Float = 0.3f,
) {
    var age = 0f
}
