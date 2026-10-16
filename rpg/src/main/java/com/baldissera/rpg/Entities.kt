package com.baldissera.rpg

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextLayoutResult
import org.json.JSONObject
import kotlin.random.Random

// ---------------------------------------------------------------- items

enum class Slot(val label: String) {
    WEAPON("Weapon"), OFFHAND("Off-hand"), HELM("Helm"), ARMOR("Armor"),
    GLOVES("Gloves"), BOOTS("Boots"), AMULET("Amulet"), RING("Ring"),
}

enum class Rarity(val label: String, val color: Color, val mult: Float) {
    COMMON("Normal", Color(0xFFD8D8D8), 1f),
    MAGIC("Magic", Color(0xFF6C8CFF), 1.4f),
    RARE("Rare", Color(0xFFFFE066), 1.9f),
    EPIC("Epic", Color(0xFFB266FF), 2.5f),
    LEGENDARY("Legendary", Color(0xFFFF8C1A), 3.2f),
    MYTHIC("Mythic", Color(0xFFFF3D6E), 4.0f),
}

/** Column in the item icon strip. The first nine keep their original positions. */
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
    const val DAGGER = 9
    const val SPEAR = 10
    const val STAFF = 11
    const val SHIELD = 12
    const val GLOVES = 13
    const val HOOD = 14
    const val LEATHER = 15
    const val SCROLL = 16
}

/** How a weapon plays. Picked from the weapon's icon so saved items keep their type. */
enum class WeaponKind(
    val label: String,
    val cooldown: Float,
    val reach: Float,
    val dmgMult: Float,
    val critBonus: Int,
    val spellBonus: Int,
    val knock: Float,
    val arc: Float,
    val blurb: String,
) {
    SWORD("Sword", 0.42f, 1.35f, 1.0f, 0, 0, 4f, 0.3f, "Balanced"),
    AXE("Axe", 0.56f, 1.4f, 1.3f, 0, 0, 4f, 0.2f, "Slow, +30% damage, wide swing"),
    MACE("Mace", 0.5f, 1.3f, 1.2f, 0, 0, 8f, 0.3f, "+20% damage, knocks enemies far back"),
    DAGGER("Dagger", 0.28f, 1.15f, 0.75f, 12, 0, 2f, 0.4f, "Lightning fast, +12% critical"),
    SPEAR("Spear", 0.5f, 1.95f, 1.05f, 0, 0, 5f, 0.6f, "Long reach, narrow thrust"),
    STAFF("Staff", 0.5f, 1.4f, 0.7f, 0, 40, 4f, 0.3f, "Weak blow, +40% spell damage"),
    ;

    companion object {
        fun ofIcon(icon: Int?) = when (icon) {
            Icons.AXE -> AXE
            Icons.MACE -> MACE
            Icons.DAGGER -> DAGGER
            Icons.SPEAR -> SPEAR
            Icons.STAFF -> STAFF
            else -> SWORD
        }
    }
}

/** Special powers on legendary and mythic items. */
enum class Power(val label: String, val text: String) {
    THUNDER("Thunderstrike", "20% chance to call lightning that strikes up to 3 enemies"),
    FROSTBITE("Frostbite", "15% chance to freeze the enemy you hit"),
    PHOENIX("Phoenix", "Rise again with half your life once per area"),
    INFERNO("Inferno", "Fireballs split into three"),
    VAMPIRE("Bloodthirst", "Every kill restores 5% life"),
    GREED("Greed", "Twice as much gold from monsters"),
    STORM("Storm", "Whirlwind costs no mana"),
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
    val spell: Int = 0,
    val atkSpeed: Int = 0,
    val goldFind: Int = 0,
    val power: Power? = null,
) {
    /** Rough overall strength, used for upgrade arrows and prices. */
    val score: Int get() = damage * 3 + armor * 2 + life / 2 + crit * 3 + mana / 2 + lifeSteal * 4 + speed * 2 +
        spell + atkSpeed * 2 + goldFind / 3 + (if (power != null) 40 else 0)
    val sellPrice: Int get() = maxOf(1, score * 2 * (rarity.ordinal + 1) / 2)
    val buyPrice: Int get() = maxOf(10, score * 9)
    val weaponKind: WeaponKind? get() = if (slot == Slot.WEAPON) WeaponKind.ofIcon(icon) else null

    fun stats(): List<Pair<String, Int>> = listOf(
        "damage" to damage, "armor" to armor, "life" to life, "% critical" to crit,
        "mana" to mana, "% life steal" to lifeSteal, "% speed" to speed, "% spell damage" to spell,
        "% attack speed" to atkSpeed, "% more gold" to goldFind,
    ).filter { it.second != 0 }

    fun statLine(): String = stats().joinToString(", ") { "+${it.second} ${it.first}" }

    fun toJson(): JSONObject = JSONObject()
        .put("slot", slot.name).put("name", name).put("rarity", rarity.name).put("icon", icon).put("level", level)
        .put("damage", damage).put("armor", armor).put("life", life).put("crit", crit)
        .put("mana", mana).put("lifeSteal", lifeSteal).put("speed", speed)
        .put("spell", spell).put("atkSpeed", atkSpeed).put("goldFind", goldFind)
        .put("power", power?.name ?: "")

    companion object {
        fun fromJson(o: JSONObject?): Item? = runCatching {
            o!!
            Item(
                Slot.valueOf(o.getString("slot")), englishName(o.getString("name")), Rarity.valueOf(o.getString("rarity")),
                o.getInt("icon"), o.optInt("level", 1),
                o.optInt("damage"), o.optInt("armor"), o.optInt("life"), o.optInt("crit"),
                o.optInt("mana"), o.optInt("lifeSteal"), o.optInt("speed"),
                o.optInt("spell"), o.optInt("atkSpeed"), o.optInt("goldFind"),
                Power.entries.firstOrNull { it.name == o.optString("power") },
            )
        }.getOrNull()
    }
}

/** Item names from saves made while the game was in Danish, translated when loaded. */
private val legacyNames = mapOf(
    "Mjølner" to "Mjölnir", "Dainsleif" to "Dáinsleif", "Svalins Skjold" to "Svalin's Shield", "Asgårds Mur" to "Wall of Asgard",
    "Odins Øje" to "Odin's Eye", "Tordenhjelmen" to "The Thunder Helm", "Ymers Hud" to "Ymir's Hide", "Fafners Skæl" to "Fafnir's Scales",
    "Tyrs Greb" to "Tyr's Grip", "Jarngreipr" to "Járngreipr", "Sleipners Spor" to "Sleipnir's Stride", "Vidars Sko" to "Vidar's Shoes",
    "Brisingamen" to "Brísingamen", "Nornernes Tråd" to "Thread of the Norns", "Draupner" to "Draupnir", "Ragnarok" to "Ragnarök",
    "Surts Flammesværd" to "Surtr's Flaming Sword", "Yggdrasils Bark" to "Bark of Yggdrasil", "Allfaders Krone" to "Crown of the Allfather",
    "Jormungandrs Skæl" to "Scales of Jörmungandr", "Fenrirs Lænke" to "Fenrir's Chain", "Bifrosts Skridt" to "Bifröst Stride",
    "Mimers Kilde" to "Mimir's Well", "Evighedens Ring" to "Ring of Eternity", "Rustent sværd" to "Rusty Sword",
    "Gammelt rundskjold" to "Old Round Shield",
)
private val legacyWords = mapOf(
    "sværd" to "Sword", "bredsværd" to "Broadsword", "økse" to "Axe", "stridsøkse" to "Battle Axe", "stridshammer" to "Warhammer",
    "morgenstjerne" to "Morning Star", "dolk" to "Dagger", "kniv" to "Kris", "spyd" to "Spear", "hellebard" to "Halberd",
    "stav" to "Staff", "troldmandsstav" to "Wizard Staff", "rundskjold" to "Round Shield", "tårnskjold" to "Tower Shield",
    "buckler" to "Buckler", "hjelm" to "Helm", "stormhjelm" to "Great Helm", "hætte" to "Hood", "læderhætte" to "Leather Cap",
    "ringbrynje" to "Chainmail", "pladerustning" to "Plate Armor", "læderbrynje" to "Leather Armor", "jægerdragt" to "Hunter's Garb",
    "handsker" to "Gloves", "jernhandsker" to "Gauntlets", "støvler" to "Boots", "jernstøvler" to "Iron Boots", "amulet" to "Amulet",
    "talisman" to "Talisman", "ring" to "Ring", "runering" to "Rune Ring",
    "Dragens" to "Dragon", "Skyggernes" to "Shadow", "Kongens" to "Kingly", "Ulvens" to "Wolf", "Stormens" to "Storm",
    "Blodets" to "Blood", "Ravnens" to "Raven", "Isens" to "Frost", "Ildens" to "Ember", "Jættens" to "Giant",
)
private val legacySuffixes = mapOf(
    "af Asgård" to "of Asgard", "af Nordlyset" to "of the Northern Lights", "af Midgård" to "of Midgard", "fra Udgård" to "of Utgard",
    "af Valhal" to "of Valhalla", "fra Niflheim" to "of Niflheim", "af Muspelheim" to "of Muspelheim",
)

fun englishName(name: String): String {
    legacyNames[name]?.let { return it }
    var rest = name
    var suffix = ""
    for ((da, en) in legacySuffixes) if (rest.endsWith(" $da")) {
        rest = rest.removeSuffix(" $da")
        suffix = " $en"
    }
    val words = rest.split(" ")
    if (words.none { it in legacyWords }) return name
    return words.joinToString(" ") { legacyWords[it] ?: it } + suffix
}

// ---------------------------------------------------------------- skills

enum class Skill(val label: String, val icon: String, val mana: Float, val cooldown: Float, val color: Color, val describe: (Int) -> String) {
    FIREBALL("Fireball", "🔥", 12f, 0.35f, Color(0xFFFF7A1A), { l -> "Hurls an exploding ball of fire. ${160 + (l - 1) * 40}% damage." }),
    WHIRL("Whirlwind", "🌀", 20f, 1.0f, Color(0xFF90CAF9), { l -> "Swing your weapon all the way around. ${130 + (l - 1) * 30}% damage." }),
    NOVA("Frost Nova", "❄️", 25f, 6f, Color(0xFF80DEEA), { l -> "Freezes every nearby enemy for ${"%.1f".format(2f + l * 0.5f)} s. ${100 + (l - 1) * 25}% damage." }),
    CHAIN("Chain Lightning", "⚡", 16f, 0.7f, Color(0xFF9FE7FF), { l -> "A bolt leaps between up to ${2 + l} enemies. ${110 + (l - 1) * 30}% damage." }),
}

/** An expanding shockwave ring on the ground. */
class Wave(val x: Float, val y: Float, val radius: Float, val color: Color, val life: Float) {
    var age = 0f
}

/** A jagged lightning segment that fades out quickly. */
class Bolt(val x1: Float, val y1: Float, val x2: Float, val y2: Float, val seed: Int) {
    var age = 0f
}

enum class Buff(val label: String, val color: Color) {
    MIGHT("Might: +50% damage", Color(0xFFFF7043)),
    SWIFT("Haste: +35% speed", Color(0xFF81C784)),
    WARD("Ward: −40% damage taken", Color(0xFF64B5F6)),
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
    var swingTime = 0.3f
    var whirl = 0f
    var cast = 0f
    var attackCd = 0f
    var hurt = 0f
    var sinceHurt = 10f
    var walk = 0f
    var moving = false
    var buff: Buff? = null
    var buffTime = 0f
    var phoenixUsed = false
    var dodge = 0f
    var dodgeCd = 0f
    var dodgeX = 0f
    var dodgeY = 0f
    var stepTimer = 0f
    /** Seconds left of the slow from a frost champion's hit. */
    var chill = 0f
    /** Extra hearts from collected heart fragments (four fragments per heart). */
    var hearts = 0

    private fun sum(f: (Item) -> Int) = equipment.values.sumOf(f)
    fun has(p: Power) = equipment.values.any { it.power == p }
    val weaponKind: WeaponKind get() = WeaponKind.ofIcon(equipment[Slot.WEAPON]?.icon)
    val maxHp: Float get() = 70f + level * 14f + sum { it.life } + hearts * HEART_LIFE
    val maxMana: Float get() = 40f + level * 5f + sum { it.mana }
    val damage: Int get() {
        val base = 6 + level * 2 + sum { it.damage }
        return if (buff == Buff.MIGHT) (base * 1.5f).toInt() else base
    }
    val armorValue: Int get() = level + sum { it.armor }
    val critChance: Int get() = 5 + sum { it.crit } + weaponKind.critBonus
    val lifeSteal: Int get() = sum { it.lifeSteal }
    val spellBonus: Int get() = sum { it.spell } + weaponKind.spellBonus
    val attackSpeed: Int get() = sum { it.atkSpeed }
    val goldFind: Int get() = sum { it.goldFind } + (if (has(Power.GREED)) 100 else 0)
    val speed: Float get() = 3.4f * (1f + sum { it.speed } / 100f) * (if (buff == Buff.SWIFT) 1.35f else 1f) * (if (chill > 0f) 0.6f else 1f)
    val xpToNext: Int get() = 40 + level * level * 22
}

enum class EnemyType(
    val label: String,
    val plural: String,
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
    SLIME("Slime", "slimes", 22, 6, 1.1f, 0.3f, 8, 0.85f, 0.45f, 1.1f, 5f),
    BAT("Bat", "bats", 14, 4, 2.8f, 0.24f, 7, 0.75f, 0.25f, 0.9f, 6f),
    SKELETON("Skeleton", "skeletons", 32, 8, 1.7f, 0.3f, 12, 1.0f, 0.45f, 1.2f, 6f),
    SPIDER("Spider", "spiders", 26, 7, 2.3f, 0.32f, 11, 0.9f, 0.35f, 1.0f, 6f),
    CULTIST("Cultist", "cultists", 28, 9, 1.5f, 0.3f, 16, 5.5f, 0.6f, 2.2f, 7f, ranged = true),
    BRUTE("Orc Brute", "orc brutes", 85, 16, 1.25f, 0.42f, 30, 1.2f, 0.7f, 1.8f, 6f),
    WOLF("Wolf", "wolves", 30, 7, 2.7f, 0.3f, 10, 0.95f, 0.3f, 1.0f, 7f),
    BANDIT("Bandit", "bandits", 38, 9, 2.0f, 0.3f, 14, 1.0f, 0.4f, 1.1f, 7f),
    GHOST("Wraith", "wraiths", 30, 9, 1.9f, 0.3f, 15, 1.0f, 0.45f, 1.2f, 7f),
    IMP("Imp", "imps", 24, 8, 2.4f, 0.25f, 14, 5.0f, 0.5f, 1.8f, 7f, ranged = true),
    GOBLIN("Goblin", "goblins", 26, 7, 2.9f, 0.26f, 12, 0.9f, 0.3f, 0.9f, 7f),
    TROLL("The Forest Troll", "forest trolls", 950, 26, 1.4f, 0.6f, 420, 1.7f, 0.75f, 1.7f, 8f, boss = true),
    SKELETON_KING("The Skeleton King", "skeleton kings", 520, 22, 1.6f, 0.5f, 260, 1.4f, 0.6f, 1.4f, 8f, boss = true),
    SPIDER_QUEEN("The Spider Queen", "spider queens", 700, 24, 1.8f, 0.6f, 360, 1.4f, 0.5f, 1.3f, 8f, boss = true),
    DEMON_LORD("The Demon Lord", "demon lords", 900, 28, 1.5f, 0.7f, 480, 1.6f, 0.6f, 1.4f, 9f, boss = true),
    SHADOW_KING("The Shadow King", "shadow kings", 1300, 34, 1.7f, 0.75f, 900, 1.7f, 0.55f, 1.3f, 10f, boss = true),
}

const val HEART_LIFE = 20f

/** Champion modifiers, Diablo style: every elite rolls one or more. */
enum class Affix(val label: String, val color: Color) {
    FAST("Fast", Color(0xFF9CCC65)),
    BURNING("Burning", Color(0xFFFF7043)),
    FROST("Frozen", Color(0xFF80D8FF)),
    VAMPIRIC("Vampiric", Color(0xFFFF1744)),
    SHIELDED("Shielding", Color(0xFFFFD54F)),
    TELEPORT("Teleporter", Color(0xFFB388FF)),
}

class Enemy(
    val type: EnemyType,
    override var x: Float,
    override var y: Float,
    val level: Int,
    val elite: Boolean = false,
    val affixes: List<Affix> = emptyList(),
    val title: String? = null,
) : Body {
    private val scale = (1f + 0.3f * (level - 1)) * (if (elite) 3f else 1f)
    val speed = type.speed * (if (Affix.FAST in affixes) 1.45f else 1f)
    val attackCooldown = type.cooldown * (if (Affix.FAST in affixes) 0.65f else 1f)
    val maxHp = type.hp * scale
    var hp = maxHp
    val dmg = type.dmg * (1f + 0.17f * (level - 1)) * (if (elite) 1.5f else 1f)
    val xp = (type.xp * (1f + 0.22f * (level - 1)) * (if (elite) 3f else 1f)).toInt()
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
    var affixLabel: TextLayoutResult? = null
    /** Seconds left of a shielded champion's invulnerability, and time until the next one. */
    var shield = 0f
    var shieldCd = 3f + Random.nextFloat() * 3f
    var blinkCd = 4f + Random.nextFloat() * 2f
    /** Burning champions erupt in flames when this reaches zero (the last 0.8 s are telegraphed). */
    var burnCd = 3f + Random.nextFloat() * 2f
    val name: String get() = title ?: if (elite) "Champion ${type.label.removePrefix("The ")}" else type.label
    val affixText: String get() = affixes.joinToString(" · ") { it.label }
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
    /** A hidden heart fragment; [key] identifies where it was found so it is only found once. */
    data class Shard(val key: String) : LootKind
}

class Loot(var x: Float, var y: Float, val kind: LootKind) {
    val phase = Random.nextFloat() * 6.28f
    var label: TextLayoutResult? = null
    /** Height and velocity while it flies out of a monster or chest. */
    var z = 0f
    var vz = 0f
    var vx = 0f
    var vy = 0f
    val flying: Boolean get() = z > 0f || vz != 0f
}

/**
 * [sprite]/[brokenSprite] index the props sheet, or the world sheet when [world] is set.
 * [light] is the colour of light the prop gives off, if any.
 */
enum class PropType(
    val sprite: Int,
    val brokenSprite: Int,
    val solid: Boolean,
    val breakable: Boolean,
    val world: Boolean = false,
    val light: Long = 0,
) {
    BARREL(0, 1, true, true),
    URN(2, 3, true, true),
    CHEST(4, 5, true, false),
    SHRINE(6, 6, true, false),
    CAMPFIRE(7, 7, true, false),
    SKULLS(8, 8, false, false),
    CRATE(9, 1, true, true),
    GRAVESTONE(10, 10, true, false),
    PILLAR(9, 9, true, false, world = true),
    SIGN(13, 13, true, false, world = true),
    BRAZIER(11, 11, true, false, light = 0x66FF9A3C),
    COLUMN(12, 12, true, false),
    SARCOPHAGUS(13, 13, true, false),
    BOOKSHELF(14, 14, true, false),
    WEAPON_RACK(15, 15, true, false),
    BANNER(16, 16, true, false),
    STALAGMITES(17, 17, true, false),
    CRYSTALS(18, 18, true, false, light = 0x5540C4FF),
    MUSHROOMS(19, 19, false, false, light = 0x4466E0FF),
    OBSIDIAN(20, 20, true, false, light = 0x44FF5722),
    BONEPILE(21, 21, false, false),
    CAGE(22, 22, true, false),
    TABLE(23, 23, true, false, light = 0x44FFC46B),
    ALTAR(24, 24, true, false, light = 0x55FF1744),
    /** The hero's own chest in the village: items put here are kept safe. */
    STASH(4, 4, true, false, light = 0x33FFD54F),
}

/** A building or large fixture from the village sheet occupying a block of tiles. */
class Building(val sprite: Int, val x: Int, val y: Int, val w: Int, val h: Int, val light: Long = 0, val lightX: Float = 0.5f, val lightY: Float = 0.5f)

enum class NpcKind(val title: String) {
    SMITH("The Blacksmith"), ELDER("The Elder"), VILLAGER_F("Villager"), VILLAGER_M("Farmer"),
}

class Npc(val kind: NpcKind, override var x: Float, override var y: Float) : Body {
    var tx = x
    var ty = y
    var faceX = 0f
    var faceY = 1f
    var moving = false
    var wait = 0f
    var anim = Random.nextFloat() * 4f
    var say: String? = null
    var sayTime = 0f
    var label: TextLayoutResult? = null
}

/** A kill contract from the village elder. */
class Bounty(val type: EnemyType, val need: Int, var got: Int, val gold: Int, val rarity: Rarity) {
    val done: Boolean get() = got >= need
    fun toJson(): JSONObject = JSONObject().put("type", type.name).put("need", need).put("got", got).put("gold", gold).put("rarity", rarity.name)

    companion object {
        fun fromJson(o: JSONObject?): Bounty? = runCatching {
            o!!
            Bounty(EnemyType.valueOf(o.getString("type")), o.getInt("need"), o.getInt("got"), o.getInt("gold"), Rarity.valueOf(o.getString("rarity")))
        }.getOrNull()
    }
}

class Prop(val type: PropType, val x: Float, val y: Float) {
    var used = false
}

class Decal(val x: Float, val y: Float, val kind: Int, val rotation: Float, val scale: Float)

/** A slain enemy collapsing and fading out. */
class Corpse(val type: EnemyType, val x: Float, val y: Float, val faceX: Float, val faceY: Float, val size: Float) {
    var age = 0f
}

/** Afterimage left behind by a dodge roll. */
class Ghost(val x: Float, val y: Float, val row: Int, val kind: WeaponKind) {
    var age = 0f
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
    var z: Float = 0.3f,
) {
    var age = 0f
}
