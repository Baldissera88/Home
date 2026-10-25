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
    STORM("Storm", "Sweeping Blow and Whirlwind cost no mana"),
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
    // Knight.
    WHIRL("Sweeping Blow", "🌀", 20f, 1.0f, Color(0xFF90CAF9), { l -> "Swing your weapon all the way around. ${130 + (l - 1) * 30}% damage." }),
    SHIELD_CHARGE("Shield Charge", "🛡️", 15f, 4f, Color(0xFFB0BEC5), { l ->
        "Charge forward, bashing aside and stunning everything in your path for ${"%.1f".format(1f + 0.25f * l)} s. ${150 + (l - 1) * 30}% damage."
    }),
    CONSECRATE("Consecration", "☀️", 30f, 10f, Color(0xFFFFE082), { l ->
        "Hallow the ground for 6 s: enemies on it burn for ${40 + (l - 1) * 10}% damage a second, and you heal ${2 + l}% life a second."
    }),
    HOLY_SHIELD("Holy Shield", "🔆", 25f, 16f, Color(0xFFFFF59D), { l -> "A blessing blocks 40% of all damage for ${6 + 2 * l} s and heals ${15 + 5 * l}% life." }),

    // Barbarian.
    LEAP("Leap", "💥", 15f, 3f, Color(0xFFFFAB40), { l -> "Leap onto the nearest foe and crash down, stunning everything around. ${180 + (l - 1) * 40}% damage." }),
    WAR_CRY("War Cry", "📯", 20f, 14f, Color(0xFFFF7043), { l -> "A terrifying roar: +50% damage for ${8 + 2 * l} s, and nearby enemies flee in fear." }),
    BERSERK("Whirlwind", "🌪️", 28f, 6f, Color(0xFFCFD8DC), { l ->
        "Spin into a storm of steel for ${"%.1f".format(1.5f + 0.25f * l)} s, hitting everything near you. ${70 + (l - 1) * 15}% damage per hit."
    }),
    EARTHQUAKE("Earthquake", "⛰️", 35f, 8f, Color(0xFFBCAAA4), { l -> "Slam the ground: a quake ripples out, stunning and hurling enemies back. ${220 + (l - 1) * 50}% damage." }),

    // Assassin.
    SHADOW_STEP("Shadow Step", "👤", 12f, 3f, Color(0xFFB388FF), { l -> "Vanish and strike from behind the nearest foe with a certain critical hit. ${200 + (l - 1) * 40}% damage." }),
    FAN_OF_KNIVES("Fan of Knives", "🗡️", 18f, 1.5f, Color(0xFFE0E0E0), { l -> "Hurl ${8 + 2 * l} knives in every direction. ${90 + (l - 1) * 20}% damage each." }),
    SMOKE_BOMB("Smoke Bomb", "🌫️", 20f, 12f, Color(0xFF90A4AE), { l -> "Vanish in smoke for ${3 + l} s: enemies lose sight of you, you run 30% faster and your next strike is critical." }),
    VENOM("Venom Blades", "☠️", 20f, 14f, Color(0xFF9CCC65), { l -> "Coat your blades for ${8 + 2 * l} s: hits poison for ${50 + (l - 1) * 15}% damage over 3 s and you strike 20% faster." }),

    // Sorceress.
    FIREBALL("Fireball", "🔥", 12f, 0.35f, Color(0xFFFF7A1A), { l -> "Hurls an exploding ball of fire. ${160 + (l - 1) * 40}% damage." }),
    NOVA("Frost Nova", "❄️", 25f, 6f, Color(0xFF80DEEA), { l -> "Freezes every nearby enemy for ${"%.1f".format(2f + l * 0.5f)} s. ${100 + (l - 1) * 25}% damage." }),
    CHAIN("Chain Lightning", "⚡", 16f, 0.7f, Color(0xFF9FE7FF), { l -> "A bolt leaps between up to ${2 + l} enemies. ${110 + (l - 1) * 30}% damage." }),
    METEOR("Meteor", "☄️", 35f, 5f, Color(0xFFFF7043), { l -> "Call a meteor down on the nearest foe: a huge blast that leaves the ground burning. ${300 + (l - 1) * 60}% damage." }),

    // Learned deeper in the skill tree (SkillTree.kt), four per class in the order of HeroClass.allSkills.
    // Knight.
    JUDGMENT("Hammer of Judgment", "🔨", 30f, 8f, Color(0xFFFFD54F), { l ->
        "A giant hammer of light crashes down on the nearest foe, stunning everything around it. ${250 + (l - 1) * 50}% damage."
    }),
    LIGHT_LANCE("Lance of Light", "🌠", 22f, 4f, Color(0xFFFFF9C4), { l -> "A beam of holy light pierces everything in a line before you. ${180 + (l - 1) * 40}% damage." }),
    BULWARK("Iron Bulwark", "🏰", 25f, 18f, Color(0xFF90A4AE), { l ->
        "Brace behind your shield for ${3 + l} s: take ${50 + 4 * l}% less damage, taunt nearby enemies and reflect melee blows."
    }),
    HEAVENS_FURY("Heaven's Fury", "🌟", 50f, 30f, Color(0xFFFFF176), { l -> "For 4 s pillars of light strike the enemies around you. ${150 + (l - 1) * 35}% damage per strike." }),

    // Barbarian.
    HARPOON("Ancient Spear", "🔱", 15f, 5f, Color(0xFFBCAAA4), { l -> "Hurl a spear that drags the first enemy hit to you and stuns it. ${150 + (l - 1) * 30}% damage." }),
    REND("Rend", "💢", 20f, 3f, Color(0xFFE53935), { l ->
        "A wide cleave that makes enemies bleed for ${120 + (l - 1) * 30}% damage over 4 s. You heal a little for every bleeding foe."
    }),
    SEISMIC_SLAM("Seismic Slam", "🌋", 25f, 2.5f, Color(0xFFA1887F), { l -> "Send a shockwave rolling forward that knocks enemies back. ${170 + (l - 1) * 35}% damage." }),
    AVALANCHE("Avalanche", "🏔️", 55f, 28f, Color(0xFFD7CCC8), { l -> "Boulders crash down in a wide cone in front of you. ${200 + (l - 1) * 40}% damage per boulder." }),

    // Assassin.
    BLADE_DANCE("Blade Dance", "🔪", 22f, 6f, Color(0xFFCE93D8), { l ->
        "Dash between up to 5 enemies near you, striking each one. Nothing can hurt you while you dance. ${140 + (l - 1) * 30}% damage per strike."
    }),
    DEATH_TRAP("Death Trap", "💣", 20f, 3f, Color(0xFFFFB74D), { l ->
        "Plant a trap (up to 3) that arms in half a second and bursts into shrapnel when an enemy comes near. ${220 + (l - 1) * 45}% damage around it."
    }),
    MARK_FOR_DEATH("Mark for Death", "🎯", 15f, 10f, Color(0xFFFF5252), { l ->
        "Mark the nearest foe for 8 s: it takes +${40 + 5 * (l - 1)}% damage from everything. Killing it restores ${15 + 3 * l}% mana and readies the mark again."
    }),
    DEATH_BLOSSOM("Death Blossom", "🌸", 50f, 28f, Color(0xFFF48FB1), { l ->
        "For 3 s a whirling ring of blades follows you and shreds everything near you while you fight on. ${75 + (l - 1) * 20}% damage, 4 hits a second."
    }),

    // Sorceress.
    FROZEN_ORB("Frozen Orb", "💠", 22f, 2.5f, Color(0xFF81D4FA), { l ->
        "A slow orb sprays ice shards in every direction, then bursts. ${45 + (l - 1) * 10}% damage per shard and ${100 + (l - 1) * 25}% for the burst; its ice slows enemies by half."
    }),
    BLIZZARD("Blizzard", "🌨️", 32f, 8f, Color(0xFFB3E5FC), { l ->
        "Ice rains down on the target area for 5 s, slowing enemies in it by half. ${70 + (l - 1) * 18}% damage a second."
    }),
    TELEPORT("Teleport", "💫", 12f, 3f, Color(0xFFB388FF), { l ->
        "Blink up to ${"%.1f".format(4.5f + 0.5f * l)} tiles ahead (walls stop you), with an arcane burst where you leave and where you land. ${80 + (l - 1) * 20}% damage."
    }),
    BLACK_HOLE("Black Hole", "🕳️", 60f, 30f, Color(0xFF7C4DFF), { l ->
        "Open a vortex that drags enemies in for 3 s, tearing at them for ${40 + (l - 1) * 10}% damage twice a second, then implodes, stunning them. ${400 + (l - 1) * 100}% damage."
    }),
}

/** The playable classes. Each has its own look, weapons, strengths and four skills. */
enum class HeroClass(
    val label: String,
    val tagline: String,
    val blurb: String,
    val color: Color,
    val weapons: List<WeaponKind>,
    val skills: List<Skill>,
    val baseLife: Float,
    val lifePerLevel: Float,
    val baseMana: Float,
    val manaPerLevel: Float,
    val damageMult: Float,
    val critBonus: Int,
    val speedMult: Float,
    val spellBonus: Int,
    val manaRegen: Float,
    val armorBonus: Int,
    /** 1..5 ratings shown on the class select screen: might, toughness, speed, magic. */
    val ratings: List<Int>,
    /** Icon on the attack button. */
    val attackIcon: String = "⚔️",
) {
    KNIGHT(
        "Knight", "Sword, shield and holy light",
        "A steadfast warrior. Charges into the fray behind a shield and calls on holy power to heal and protect.",
        Color(0xFF90CAF9), listOf(WeaponKind.SWORD, WeaponKind.MACE, WeaponKind.SPEAR),
        listOf(Skill.WHIRL, Skill.SHIELD_CHARGE, Skill.CONSECRATE, Skill.HOLY_SHIELD),
        80f, 15f, 40f, 5f, 1f, 0, 1f, 0, 1f, 6, listOf(3, 5, 3, 2),
    ),
    BARBARIAN(
        "Barbarian", "Great axes and raw fury",
        "A towering berserker. Leaps into packs of monsters, spins through them and shakes the earth itself.",
        Color(0xFFFF8A65), listOf(WeaponKind.AXE, WeaponKind.SWORD, WeaponKind.MACE),
        listOf(Skill.LEAP, Skill.WAR_CRY, Skill.BERSERK, Skill.EARTHQUAKE),
        95f, 18f, 30f, 3f, 1.2f, 0, 1f, 0, 0.85f, 2, listOf(5, 4, 3, 1),
    ),
    ASSASSIN(
        "Assassin", "Twin daggers from the shadows",
        "A deadly shadow. Strikes fast and from behind, poisons foes and vanishes in smoke before they can answer.",
        Color(0xFFB388FF), listOf(WeaponKind.DAGGER),
        listOf(Skill.SHADOW_STEP, Skill.FAN_OF_KNIVES, Skill.SMOKE_BOMB, Skill.VENOM),
        70f, 12f, 40f, 4f, 1f, 10, 1.12f, 0, 1f, 0, listOf(4, 2, 5, 2), "🗡️",
    ),
    SORCERESS(
        "Sorceress", "Fire, frost and lightning",
        "A master of the elements. Keeps her distance with arcane bolts and burns, freezes and shatters whole hordes.",
        Color(0xFFCE93D8), listOf(WeaponKind.STAFF),
        listOf(Skill.FIREBALL, Skill.CHAIN, Skill.NOVA, Skill.METEOR),
        60f, 10f, 70f, 8f, 1f, 0, 1f, 25, 1.7f, 0, listOf(2, 1, 3, 5), "🔮",
    ),
    ;

    /**
     * All eight actives of the class: the four original [skills] (the first two are known from the start),
     * then the four learned deeper in the skill tree.
     */
    val allSkills: List<Skill> by lazy {
        skills + when (this) {
            KNIGHT -> listOf(Skill.JUDGMENT, Skill.LIGHT_LANCE, Skill.BULWARK, Skill.HEAVENS_FURY)
            BARBARIAN -> listOf(Skill.HARPOON, Skill.REND, Skill.SEISMIC_SLAM, Skill.AVALANCHE)
            ASSASSIN -> listOf(Skill.BLADE_DANCE, Skill.DEATH_TRAP, Skill.MARK_FOR_DEATH, Skill.DEATH_BLOSSOM)
            SORCERESS -> listOf(Skill.FROZEN_ORB, Skill.BLIZZARD, Skill.TELEPORT, Skill.BLACK_HOLE)
        }
    }
}

/**
 * Passive talents bought with skill points in the skill tree (SkillTree.kt). Each rank adds [per]
 * (a percentage) to one bonus; keystones have a single rank and a special effect instead.
 * The effects are applied by Player's stat getters and by the combat code in Game.
 */
enum class Talent(val label: String, val icon: String, val maxRank: Int, val per: Float, val color: Color, private val text: String) {
    MIGHT("Weapon Mastery", "💪", 5, 5f, Color(0xFFFF8A65), "+#% damage with attacks and skills"),
    PRECISION("Precision", "👁️", 5, 2f, Color(0xFFFFE082), "+#% critical hit chance"),
    CRIT_DAMAGE("Deadly Strikes", "💀", 5, 15f, Color(0xFFFFD54F), "Critical hits deal +#% damage"),
    VITALITY("Vitality", "❤️", 5, 6f, Color(0xFFFF5370), "+#% maximum life"),
    WISDOM("Wisdom", "🔷", 5, 8f, Color(0xFF64B5F6), "+#% maximum mana and mana regeneration"),
    SWIFTNESS("Fleet Foot", "👟", 5, 4f, Color(0xFF81C784), "+#% movement speed"),
    ALACRITY("Alacrity", "⏳", 5, 4f, Color(0xFF80DEEA), "Skill cooldowns are #% shorter"),
    LEECH("Vampirism", "🦇", 5, 1f, Color(0xFFE53935), "#% of the damage you deal heals you"),
    THORNS("Thorns", "🌵", 5, 20f, Color(0xFF9CCC65), "Monsters that strike you in melee take #% of the damage back"),
    IRON_SKIN("Iron Skin", "⛓️", 5, 10f, Color(0xFFB0BEC5), "+#% armor"),
    POTENCY("Blessed Draughts", "⚗️", 3, 20f, Color(0xFFFF80AB), "Potions heal #% more"),
    GREED("Plunder", "💰", 3, 15f, Color(0xFFFFC94D), "+#% gold from monsters and chests"),
    FEROCITY("Ferocity", "🐺", 5, 6f, Color(0xFFFFAB40), "+#% attack speed"),
    SPELL_POWER("Spellcraft", "📖", 5, 8f, Color(0xFFCE93D8), "+#% spell damage"),
    SOUL_HARVEST("Soul Harvest", "👻", 3, 2f, Color(0xFFB39DDB), "Every kill restores #% of your life and mana"),

    // Keystones: one rank, at the end of a branch.
    RELENTLESS("Relentless", "🔁", 1, 0f, Color(0xFFFFC94D), "Every 5th hit is a guaranteed critical hit"),
    LAST_STAND("Last Stand", "⚓", 1, 0f, Color(0xFF90CAF9), "Below 35% life you take 40% less damage"),
    BLOODLUST("Berserker's Blood", "👹", 1, 0f, Color(0xFFFF7043), "Up to +50% damage the more life you are missing"),
    UNDYING("Undying Rage", "😡", 1, 0f, Color(0xFFFF5252), "A killing blow leaves you at 1 life and enraged for 4 s instead (once every 90 s)"),
    EXECUTIONER("Executioner", "⚰️", 1, 0f, Color(0xFFB388FF), "+50% damage to enemies below 30% life"),
    PYRO_PACT("Pyromancer's Pact", "💔", 1, 0f, Color(0xFFFF7A1A), "+35% spell damage, but 20% less maximum life"),
    MANA_SHIELD("Mana Shield", "💎", 1, 0f, Color(0xFF80DEEA), "30% of the damage you take drains mana instead of life"),
    ;

    /** A one-rank talent with a special effect, at the end of a branch. */
    val keystone: Boolean get() = per == 0f

    /** What [rank] ranks give (rank 0 describes the first rank). */
    fun describe(rank: Int): String = text.replace("#", Math.round(per * rank.coerceAtLeast(1)).toString())

    /** The bonus of [rank] ranks as a fraction (three ranks of +5% give 0.15). */
    fun bonus(rank: Int): Float = per * rank / 100f
}

/**
 * Lasting ground effects: hallowed ground, the burning crater a meteor leaves, the new skills' areas and the Sand
 * Pharaoh's sandstorm (the only one that hurts the hero instead of monsters). The wire sends the ordinal.
 */
enum class ZoneKind { CONSECRATE, FIRE, BLIZZARD, BLACK_HOLE, TRAP, HOLY_LIGHT, BLEED, SANDSTORM }

class Zone(val x: Float, val y: Float, val radius: Float, val life: Float, val kind: ZoneKind, val dps: Float) {
    var age = 0f
    var tick = 0f
}

/** A meteor on its way down; it lands when [t] reaches zero. */
class Meteor(val x: Float, val y: Float, val dmg: Float, var t: Float = 0.75f)

/** An expanding shockwave ring on the ground. */
class Wave(val x: Float, val y: Float, val radius: Float, val color: Color, val life: Float) {
    var age = 0f
}

/**
 * A visual cue the 3D view draws for [skill] (a falling hammer, a lance of light, a harpoon chain...), sent as "sf".
 * It starts at (x, y), aims at (tx, ty) and faces (dx, dy); [value] is a free per-skill number such as a radius.
 * Skills that move their cue (an orb in flight, a spear pulling a monster) update the fields every frame.
 */
class SkillFx(
    val skill: Skill,
    var x: Float,
    var y: Float,
    var tx: Float,
    var ty: Float,
    var dx: Float,
    var dy: Float,
    val life: Float,
    var value: Float = 0f,
) {
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
    var heroClass = HeroClass.KNIGHT
    val skills = mutableMapOf<Skill, Int>()
    val cooldowns = mutableMapOf<Skill, Float>()
    var skillPoints = 0
    /** The skills on the HUD's four buttons (null leaves a button empty); set from the skill tree. */
    val loadout = arrayOfNulls<Skill>(LOADOUT_SIZE)
    /** Hits dealt since the last guaranteed critical of the Relentless keystone. */
    var hitCount = 0
    /** Seconds until the Undying Rage keystone can save the hero again. */
    var undyingCd = 0f
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
    /** Smoothed walking velocity, tiles per second. */
    var vx = 0f
    var vy = 0f
    /** Seconds left of the slow from a frost champion's hit. */
    var chill = 0f
    /** Extra hearts from collected heart fragments (four fragments per heart). */
    var hearts = 0

    // Class skills in progress.
    var spin = 0f
    var spinTick = 0f
    var charge = 0f
    var chargeX = 0f
    var chargeY = 1f
    val chargeHit = mutableSetOf<Enemy>()
    var leap = 0f
    var leapDur = 0.5f
    var leapFromX = 0f
    var leapFromY = 0f
    var leapToX = 0f
    var leapToY = 0f
    var leapPower = 1.8f
    var spinPower = 0.7f
    var holy = 0f
    var fury = 0f
    var stealth = 0f
    var venom = 0f
    var venomPct = 0.5f
    /** Seconds left of a Blade Dance (the hero hops between enemies and can't be hurt), and of a Death Blossom's ring of blades. */
    var dance = 0f
    var blossom = 0f
    /** Height of a leap above the ground, in tiles. */
    val leapZ: Float get() = if (leap > 0f) kotlin.math.sin((1f - leap / leapDur) * Math.PI.toFloat()) * 1.2f else 0f
    val busy: Boolean get() = spin > 0f || charge > 0f || leap > 0f || dance > 0f

    // ---- talents from the skill tree

    /** Ranks of the passive talents by ordinal. Changed only through [setTalent] and [clearTalents], which refresh the bonuses below. */
    private val talentRanks = IntArray(Talent.entries.size)
    fun talentRank(t: Talent): Int = talentRanks[t.ordinal]
    /** Points spent on talents. */
    val talentPoints: Int get() = talentRanks.sum()

    fun setTalent(t: Talent, rank: Int) {
        talentRanks[t.ordinal] = rank.coerceIn(0, t.maxRank)
        updateTalents()
    }

    fun clearTalents() {
        talentRanks.fill(0)
        updateTalents()
    }

    /** Puts the class's four original skills back on the HUD buttons. */
    fun resetLoadout() {
        for (i in 0 until LOADOUT_SIZE) loadout[i] = heroClass.skills.getOrNull(i)
    }

    // Talent bonuses, worked out once whenever a rank changes so the stat getters (read every frame) stay cheap.
    var talentDamage = 1f
        private set
    var talentCrit = 0
        private set
    /** Damage multiplier of a critical hit. */
    var critMult = 2f
        private set
    private var talentLife = 1f
    private var talentMana = 1f
    private var talentSpeed = 1f
    private var talentArmor = 1f
    private var talentLeech = 0
    private var talentAtkSpeed = 0
    private var talentGold = 0
    private var talentSpell = 0
    /** How much faster skill cooldowns run out (1 = normal). */
    var cooldownRate = 1f
        private set
    /** Share of a melee blow sent back to the attacker. */
    var thorns = 0f
        private set
    /** Potion healing multiplier. */
    var potionMult = 1f
        private set
    /** Share of life and mana restored by each kill. */
    var soulHarvest = 0f
        private set
    var relentless = false
        private set
    var lastStand = false
        private set
    var bloodlust = false
        private set
    var undying = false
        private set
    var executioner = false
        private set
    var manaShield = false
        private set

    private fun updateTalents() {
        fun owns(t: Talent) = talentRanks[t.ordinal] > 0
        fun frac(t: Talent) = t.bonus(talentRanks[t.ordinal])
        fun pts(t: Talent) = Math.round(t.per * talentRanks[t.ordinal])
        talentDamage = 1f + frac(Talent.MIGHT)
        talentCrit = pts(Talent.PRECISION)
        critMult = 2f + frac(Talent.CRIT_DAMAGE)
        talentLife = 1f + frac(Talent.VITALITY) - (if (owns(Talent.PYRO_PACT)) 0.2f else 0f)
        talentMana = 1f + frac(Talent.WISDOM)
        talentSpeed = 1f + frac(Talent.SWIFTNESS)
        talentArmor = 1f + frac(Talent.IRON_SKIN)
        talentLeech = pts(Talent.LEECH)
        talentAtkSpeed = pts(Talent.FEROCITY)
        talentGold = pts(Talent.GREED)
        talentSpell = pts(Talent.SPELL_POWER) + (if (owns(Talent.PYRO_PACT)) 35 else 0)
        cooldownRate = 1f / (1f - frac(Talent.ALACRITY)).coerceAtLeast(0.5f)
        thorns = frac(Talent.THORNS)
        potionMult = 1f + frac(Talent.POTENCY)
        soulHarvest = frac(Talent.SOUL_HARVEST)
        relentless = owns(Talent.RELENTLESS)
        lastStand = owns(Talent.LAST_STAND)
        bloodlust = owns(Talent.BLOODLUST)
        undying = owns(Talent.UNDYING)
        executioner = owns(Talent.EXECUTIONER)
        manaShield = owns(Talent.MANA_SHIELD)
    }

    private fun sum(f: (Item) -> Int) = equipment.values.sumOf(f)
    fun has(p: Power) = equipment.values.any { it.power == p }
    val weaponKind: WeaponKind get() = WeaponKind.ofIcon(equipment[Slot.WEAPON]?.icon)
    val maxHp: Float get() = (heroClass.baseLife + level * heroClass.lifePerLevel + sum { it.life } + hearts * HEART_LIFE) * talentLife
    val maxMana: Float get() = (heroClass.baseMana + level * heroClass.manaPerLevel + sum { it.mana }) * talentMana
    val damage: Int get() {
        var base = (6 + level * 2 + sum { it.damage }) * heroClass.damageMult * talentDamage
        // Berserker's Blood: up to +50% as life runs out.
        if (bloodlust) base *= 1f + 0.5f * (1f - hp / maxHp).coerceIn(0f, 1f)
        return if (buff == Buff.MIGHT || fury > 0f) (base * 1.5f).toInt() else base.toInt()
    }
    val armorValue: Int get() = ((level + heroClass.armorBonus * (1 + level / 4) + sum { it.armor }) * talentArmor).toInt()
    val critChance: Int get() = 5 + heroClass.critBonus + sum { it.crit } + weaponKind.critBonus + talentCrit
    val lifeSteal: Int get() = sum { it.lifeSteal } + talentLeech
    val spellBonus: Int get() = heroClass.spellBonus + sum { it.spell } + weaponKind.spellBonus + talentSpell
    val attackSpeed: Int get() = sum { it.atkSpeed } + (if (venom > 0f) 20 else 0) + talentAtkSpeed
    val goldFind: Int get() = sum { it.goldFind } + (if (has(Power.GREED)) 100 else 0) + talentGold
    val manaRegen: Float get() = (5f + level * 0.3f) * heroClass.manaRegen * talentMana
    val speed: Float get() = 3.4f * heroClass.speedMult * (1f + sum { it.speed } / 100f) * (if (buff == Buff.SWIFT) 1.35f else 1f) *
        (if (chill > 0f) 0.6f else 1f) * (if (stealth > 0f) 1.3f else 1f) * talentSpeed
    /** Fraction of incoming damage that gets through blessings and wards. */
    val damageTaken: Float get() = (if (buff == Buff.WARD) 0.6f else 1f) * (if (holy > 0f) 0.6f else 1f)
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
    // The Scorched Sands.
    /** Quick on its legs; its sting poisons the hero. */
    SCORPION("Giant Scorpion", "giant scorpions", 34, 8, 2.3f, 0.34f, 15, 0.95f, 0.35f, 1.0f, 6.5f),
    /** Shambles slowly, takes a beating and hits hard. */
    MUMMY("Mummy", "mummies", 72, 13, 1.05f, 0.32f, 22, 1.05f, 0.65f, 1.7f, 6f),
    /** Floats at a distance hurling fire, and vanishes in a puff of smoke when the hero closes in. */
    DJINN("Djinn", "djinn", 36, 10, 1.9f, 0.3f, 20, 6f, 0.55f, 2.1f, 8f, ranged = true),
    SAND_PHARAOH("The Sand Pharaoh", "sand pharaohs", 760, 26, 1.5f, 0.6f, 520, 1.5f, 0.6f, 1.4f, 9f, boss = true),
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

/** Running ids so the 3D renderer can follow each actor from frame to frame. */
object Ids {
    private var n = 0
    fun next() = ++n
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
    val uid = Ids.next()
    private val scale = (1f + 0.3f * (level - 1)) * (if (elite) 3f else 1f)
    private val baseSpeed = type.speed * (if (Affix.FAST in affixes) 1.45f else 1f)
    /** Walking speed; chilled monsters (Frozen Orb, Blizzard) move at half speed. */
    val speed: Float get() = if (chill > 0f) baseSpeed * 0.5f else baseSpeed
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
    var stun = 0f
    var fear = 0f
    var poison = 0f
    var poisonDps = 0f
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
    /** Seconds left of the slow from frost spells. */
    var chill = 0f
    /** Seconds left of an assassin's Mark for Death, and the damage multiplier it puts on every hit taken. */
    var mark = 0f
    var markMult = 1f
    /** Multiplier on all damage this monster takes. */
    val damageTakenMult: Float get() = if (mark > 0f) markMult else 1f
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
    /** Small shots (knives, arcane bolts) hit one target without an explosion. */
    val small: Boolean = false,
    /** Poison damage per second applied on hit (venom-coated knives). */
    val poison: Float = 0f,
    /** Seconds of chill (half speed) applied on hit (Frozen Orb shards). */
    val chill: Float = 0f,
)

sealed interface LootKind {
    data class Gold(val amount: Int) : LootKind
    data object Potion : LootKind
    data class Gear(val item: Item) : LootKind
    /** A hidden heart fragment; [key] identifies where it was found so it is only found once. */
    data class Shard(val key: String) : LootKind
}

class Loot(var x: Float, var y: Float, val kind: LootKind) {
    val uid = Ids.next()
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
    val uid = Ids.next()
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
class Ghost(val x: Float, val y: Float, val row: Int, val col: Int = 4) {
    var age = 0f
}

class FloatText(
    var x: Float,
    var y: Float,
    val text: String,
    val color: Color,
    val big: Boolean = false,
    /** Damage numbers pop out sideways and arc down; other texts just rise. */
    var vx: Float = 0f,
    var vy: Float = -0.9f,
    val gravity: Float = 0f,
) {
    var age = 0f
    var layout: TextLayoutResult? = null
    /** Where the text appeared; the 3D view anchors it there instead of following the 2D arc. */
    val ox: Float = x
    val oy: Float = y
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
    /** A soft, swelling puff of smoke instead of a hard spark. */
    val soft: Boolean = false,
) {
    var age = 0f
}
