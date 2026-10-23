package com.baldissera.rpg

import androidx.compose.ui.graphics.Color

/** Highest rank of an active skill. */
const val MAX_SKILL_RANK = 5

/** Number of skill buttons on the HUD. */
const val LOADOUT_SIZE = 4

/** Hero level that opens each tier of the skill tree. */
val TIER_LEVELS = intArrayOf(1, 5, 10, 15, 20)

/**
 * One node of a class's skill tree: an active [skill] or a passive [talent] (exactly one is set).
 * Points can go here once the hero has reached the tier's level and has at least one point in [parent].
 */
class TreeNode(
    val branch: Int,
    val tier: Int,
    val skill: Skill?,
    val talent: Talent?,
    val parent: TreeNode?,
) {
    /** Place among the nodes that share this branch and tier (0 = top). */
    var slot = 0
        internal set

    val label: String get() = skill?.label ?: talent?.label ?: ""
    val icon: String get() = skill?.icon ?: talent?.icon ?: ""
    val color: Color get() = skill?.color ?: talent?.color ?: Color.White
    val maxRank: Int get() = if (skill != null) MAX_SKILL_RANK else talent?.maxRank ?: 1
    val levelReq: Int get() = TIER_LEVELS[tier]
    val keystone: Boolean get() = talent?.keystone == true

    fun rank(p: Player): Int {
        val s = skill
        if (s != null) return p.skills[s] ?: 0
        val t = talent
        return if (t != null) p.talentRank(t) else 0
    }

    /** What [rank] ranks do (rank 0 describes the first rank). */
    fun describe(rank: Int): String {
        val s = skill
        if (s != null) return s.describe(rank.coerceIn(1, MAX_SKILL_RANK))
        return talent?.describe(rank) ?: ""
    }

    /** The level and parent requirements are met (free points and the rank cap are not looked at). */
    fun unlocked(p: Player): Boolean {
        val par = parent
        return p.level >= levelReq && (par == null || par.rank(p) > 0)
    }

    /** What still stands in the way of the first point here, or null if nothing does. */
    fun requirement(p: Player): String? {
        val par = parent
        return when {
            p.level < levelReq && par != null && par.rank(p) <= 0 -> "Requires level $levelReq and ${par.label}"
            p.level < levelReq -> "Requires level $levelReq"
            par != null && par.rank(p) <= 0 -> "Requires a point in ${par.label}"
            else -> null
        }
    }
}

class Branch(val title: String, val icon: String, val color: Color, val nodes: List<TreeNode>)

/** A class's tree: three branches across five tiers. */
class ClassTree(val heroClass: HeroClass, val branches: List<Branch>) {
    val nodes: List<TreeNode> = branches.flatMap { it.nodes }
    private val cells: List<List<TreeNode>> = List(branches.size * SkillTree.TIERS) { i ->
        nodes.filter { it.branch == i / SkillTree.TIERS && it.tier == i % SkillTree.TIERS }
    }

    init {
        for (c in cells) c.forEachIndexed { i, n -> n.slot = i }
    }

    fun node(skill: Skill): TreeNode? = nodes.firstOrNull { it.skill == skill }
    fun node(talent: Talent): TreeNode? = nodes.firstOrNull { it.talent == talent }

    /** The nodes of [branch] on [tier], top to bottom. */
    fun cell(branch: Int, tier: Int): List<TreeNode> = cells[branch * SkillTree.TIERS + tier]

    /** Rows of nodes [tier] needs: as many as its busiest branch has. */
    fun rows(tier: Int): Int = branches.indices.maxOf { cell(it, tier).size }.coerceAtLeast(1)

    /** Points the hero has put into [branch] (the free first ranks of the starting skills included). */
    fun spent(p: Player, branch: Int): Int = branches[branch].nodes.sumOf { it.rank(p) }
}

/**
 * The skill trees of the four classes. Every branch has a talent and a skill at its root on tier 1,
 * then a chain down from that skill: one node on each tier from 2 to 5, each needing a point in the one above.
 * The original four skills of a class sit in tiers 1-2, the four new ones in tiers 2-5 with the ultimate last.
 */
object SkillTree {
    const val TIERS = 5

    private val trees: List<ClassTree> = HeroClass.entries.map { build(it) }

    fun of(cls: HeroClass): ClassTree = trees[cls.ordinal]

    private fun build(cls: HeroClass): ClassTree = when (cls) {
        HeroClass.KNIGHT -> ClassTree(
            cls,
            listOf(
                branch(0, "Valor", "⚔️", Color(0xFF90CAF9), Talent.MIGHT, Skill.WHIRL,
                    Talent.PRECISION, Skill.LIGHT_LANCE, Talent.CRIT_DAMAGE, Talent.RELENTLESS),
                branch(1, "Protection", "🛡️", Color(0xFFB0BEC5), Talent.VITALITY, Skill.SHIELD_CHARGE,
                    Skill.HOLY_SHIELD, Talent.THORNS, Skill.BULWARK, Talent.LAST_STAND),
                branch(2, "Devotion", "☀️", Color(0xFFFFE082), Talent.WISDOM, Skill.CONSECRATE,
                    Talent.ALACRITY, Skill.JUDGMENT, Talent.POTENCY, Skill.HEAVENS_FURY),
            ),
        )
        HeroClass.BARBARIAN -> ClassTree(
            cls,
            listOf(
                branch(0, "Slaughter", "💥", Color(0xFFFF7043), Talent.MIGHT, Skill.LEAP,
                    Talent.FEROCITY, Skill.REND, Talent.LEECH, Talent.BLOODLUST),
                branch(1, "Warlord", "📯", Color(0xFFFFAB40), Talent.VITALITY, Skill.WAR_CRY,
                    Skill.BERSERK, Skill.HARPOON, Talent.THORNS, Talent.UNDYING),
                branch(2, "Earthshaker", "⛰️", Color(0xFFBCAAA4), Talent.IRON_SKIN, Skill.EARTHQUAKE,
                    Talent.ALACRITY, Skill.SEISMIC_SLAM, Talent.GREED, Skill.AVALANCHE),
            ),
        )
        HeroClass.ASSASSIN -> ClassTree(
            cls,
            listOf(
                branch(0, "Shadows", "👤", Color(0xFFB388FF), Talent.SWIFTNESS, Skill.SHADOW_STEP,
                    Skill.SMOKE_BOMB, Skill.MARK_FOR_DEATH, Talent.VITALITY, Talent.EXECUTIONER),
                branch(1, "Blades", "🗡️", Color(0xFFE0E0E0), Talent.MIGHT, Skill.FAN_OF_KNIVES,
                    Talent.FEROCITY, Skill.BLADE_DANCE, Talent.CRIT_DAMAGE, Skill.DEATH_BLOSSOM),
                branch(2, "Venom", "☠️", Color(0xFF9CCC65), Talent.PRECISION, Skill.VENOM,
                    Talent.ALACRITY, Skill.DEATH_TRAP, Talent.LEECH, Talent.RELENTLESS),
            ),
        )
        HeroClass.SORCERESS -> ClassTree(
            cls,
            listOf(
                branch(0, "Fire", "🔥", Color(0xFFFF7A1A), Talent.SPELL_POWER, Skill.FIREBALL,
                    Skill.METEOR, Talent.PRECISION, Talent.CRIT_DAMAGE, Talent.PYRO_PACT),
                branch(1, "Frost", "❄️", Color(0xFF80DEEA), Talent.VITALITY, Skill.NOVA,
                    Talent.IRON_SKIN, Skill.FROZEN_ORB, Skill.BLIZZARD, Talent.MANA_SHIELD),
                branch(2, "Arcane", "⚡", Color(0xFFB388FF), Talent.WISDOM, Skill.CHAIN,
                    Skill.TELEPORT, Talent.ALACRITY, Talent.SOUL_HARVEST, Skill.BLACK_HOLE),
            ),
        )
    }

    /** A branch: [rootTalent] and [rootSkill] on tier 1, then [chain] (a Skill or Talent per tier from 2 to 5) hanging from the skill. */
    private fun branch(index: Int, title: String, icon: String, color: Color, rootTalent: Talent, rootSkill: Skill, vararg chain: Any): Branch {
        val nodes = mutableListOf(TreeNode(index, 0, null, rootTalent, null))
        var parent = TreeNode(index, 0, rootSkill, null, null)
        nodes += parent
        chain.forEachIndexed { i, entry ->
            val node = when (entry) {
                is Skill -> TreeNode(index, i + 1, entry, null, parent)
                is Talent -> TreeNode(index, i + 1, null, entry, parent)
                else -> error("Not a skill or talent: $entry")
            }
            nodes += node
            parent = node
        }
        return Branch(title, icon, color, nodes)
    }
}
