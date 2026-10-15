package com.baldissera.rpg

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextLayoutResult
import kotlin.random.Random

enum class Slot(val label: String) { WEAPON("Våben"), ARMOR("Rustning"), RING("Ring") }

enum class Rarity(val label: String, val color: Color, val mult: Float) {
    COMMON("Almindelig", Color(0xFFD8D8D8), 1f),
    MAGIC("Magisk", Color(0xFF6C8CFF), 1.5f),
    RARE("Sjælden", Color(0xFFFFE066), 2.2f),
    LEGENDARY("Legendarisk", Color(0xFFFF8C1A), 3.2f),
}

class Item(
    val slot: Slot,
    val name: String,
    val rarity: Rarity,
    val damage: Int,
    val armor: Int,
    val life: Int,
    val crit: Int,
) {
    val power: Int get() = damage * 3 + armor * 2 + life / 2 + crit * 3

    fun statLine(): String = listOfNotNull(
        if (damage > 0) "+$damage skade" else null,
        if (armor > 0) "+$armor rustning" else null,
        if (life > 0) "+$life liv" else null,
        if (crit > 0) "+$crit% kritisk" else null,
    ).joinToString(", ")

    fun serialize(): String = listOf(slot.name, name, rarity.name, damage, armor, life, crit).joinToString("|")

    companion object {
        fun parse(s: String?): Item? = runCatching {
            val p = s!!.split("|")
            Item(Slot.valueOf(p[0]), p[1], Rarity.valueOf(p[2]), p[3].toInt(), p[4].toInt(), p[5].toInt(), p[6].toInt())
        }.getOrNull()
    }
}

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
    var weapon: Item? = null
    var armor: Item? = null
    var ring: Item? = null
    var swing = 0f
    var whirl = 0f
    var attackCd = 0f
    var hurt = 0f
    var sinceHurt = 10f
    var walk = 0f
    var moving = false

    val gear: List<Item> get() = listOfNotNull(weapon, armor, ring)
    val maxHp: Float get() = 60f + level * 12f + gear.sumOf { it.life }
    val maxMana: Float get() = 40f + level * 4f
    val damage: Int get() = 6 + level * 2 + gear.sumOf { it.damage }
    val armorValue: Int get() = level + gear.sumOf { it.armor }
    val critChance: Int get() = 5 + gear.sumOf { it.crit }
    val xpToNext: Int get() = 40 + level * level * 20
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
) {
    SLIME("Slim", 22, 6, 1.1f, 0.34f, 8, 0.85f, 0.45f, 1.1f, 5f),
    BAT("Flagermus", 14, 4, 2.8f, 0.24f, 7, 0.75f, 0.25f, 0.9f, 6f),
    SKELETON("Skelet", 32, 8, 1.7f, 0.32f, 12, 1.0f, 0.45f, 1.2f, 6f),
    BRUTE("Ork-brute", 85, 16, 1.25f, 0.45f, 30, 1.2f, 0.7f, 1.8f, 6f),
    BOSS("Dæmonherren", 420, 24, 1.5f, 0.7f, 220, 1.6f, 0.6f, 1.4f, 9f),
}

class Enemy(val type: EnemyType, override var x: Float, override var y: Float, floor: Int) : Body {
    private val scale = 1f + 0.28f * (floor - 1)
    val maxHp = type.hp * scale
    var hp = maxHp
    val dmg = type.dmg * (1f + 0.16f * (floor - 1))
    val xp = (type.xp * (1f + 0.2f * (floor - 1))).toInt()
    var windup = 0f
    var cooldown = 0.5f
    var flash = 0f
    var kx = 0f
    var ky = 0f
    var aggro = false
    var anim = 0f
    var special = 3f
    val phase = Random.nextFloat() * 6.28f
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
) {
    var age = 0f
}
