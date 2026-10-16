package com.baldissera.rpg

import android.content.res.Resources
import android.graphics.BitmapFactory
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap

/** A sheet of pre-rendered frames. Directional sheets have 8 rows (S, SE, E, NE, N, NW, W, SW). */
class SpriteSheet(
    val image: ImageBitmap,
    val cell: Int,
    /** Width of one cell in world tiles. */
    val worldW: Float,
    /** Where the ground line sits in the cell, as a fraction from the top. */
    val foot: Float,
    /** 16 columns (idle x2, walk x8, attack x6) instead of the classic 8 (idle, walk x4, attack x3). */
    val smooth: Boolean = false,
)

class Assets(private val res: Resources) {
    private val opts = BitmapFactory.Options().apply { inScaled = false }
    private fun load(id: Int): ImageBitmap = BitmapFactory.decodeResource(res, id, opts).asImageBitmap()

    // Hero sheets are 16 columns of 144 px cells (idle x2, walk x8, attack x6) and are loaded only when a class needs them.
    private val heroSheets = HashMap<Int, SpriteSheet>()
    private val portraits = HashMap<HeroClass, ImageBitmap>()

    fun hero(cls: HeroClass, kind: WeaponKind): SpriteSheet {
        val id = when (cls) {
            HeroClass.KNIGHT -> when (kind) {
                WeaponKind.MACE -> R.drawable.spr_hero_knight_mace
                WeaponKind.SPEAR -> R.drawable.spr_hero_knight_spear
                else -> R.drawable.spr_hero_knight_sword
            }
            HeroClass.BARBARIAN -> when (kind) {
                WeaponKind.SWORD -> R.drawable.spr_hero_barbarian_sword
                WeaponKind.MACE -> R.drawable.spr_hero_barbarian_mace
                else -> R.drawable.spr_hero_barbarian_axe
            }
            HeroClass.ASSASSIN -> R.drawable.spr_hero_assassin
            HeroClass.SORCERESS -> R.drawable.spr_hero_sorceress
        }
        return heroSheets.getOrPut(id) { SpriteSheet(load(id), 144, 1.9f, 0.9f) }
    }

    fun portrait(cls: HeroClass): ImageBitmap = portraits.getOrPut(cls) {
        load(
            when (cls) {
                HeroClass.KNIGHT -> R.drawable.portrait_knight
                HeroClass.BARBARIAN -> R.drawable.portrait_barbarian
                HeroClass.ASSASSIN -> R.drawable.portrait_assassin
                HeroClass.SORCERESS -> R.drawable.portrait_sorceress
            }
        )
    }
    val wolf = SpriteSheet(load(R.drawable.spr_wolf), 128, 1.7f, 0.8f)
    val bandit = SpriteSheet(load(R.drawable.spr_bandit), 128, 1.7f, 0.86f, smooth = true)
    val world = SpriteSheet(load(R.drawable.spr_world), 160, 2.6f, 0.88f)
    val ground = load(R.drawable.tex_world_ground)
    val fog = load(R.drawable.tex_fog)
    val groundEdges = load(R.drawable.tex_ground_edges)
    val wallSkirts = load(R.drawable.tex_wall_skirts)
    val ghost = SpriteSheet(load(R.drawable.spr_ghost), 128, 1.7f, 0.86f)
    val imp = SpriteSheet(load(R.drawable.spr_imp), 96, 1.2f, 0.86f)
    val goblin = SpriteSheet(load(R.drawable.spr_goblin), 96, 1.3f, 0.86f, smooth = true)
    val village = SpriteSheet(load(R.drawable.spr_village), 256, 4.4f, 0.86f)
    val smith = SpriteSheet(load(R.drawable.spr_smith), 128, 1.7f, 0.86f)
    val elder = SpriteSheet(load(R.drawable.spr_elder), 128, 1.7f, 0.86f)
    val villagerF = SpriteSheet(load(R.drawable.spr_villager_f), 128, 1.7f, 0.86f, smooth = true)
    val villagerM = SpriteSheet(load(R.drawable.spr_villager_m), 128, 1.7f, 0.86f, smooth = true)
    val water = load(R.drawable.tex_water)
    val terrain = Terrain(res)
    val waterShaders by lazy {
        WaterShaders(BitmapFactory.decodeResource(res, R.drawable.tex_water_base, opts), BitmapFactory.decodeResource(res, R.drawable.tex_water_ripples, opts))
    }
    val skeleton = SpriteSheet(load(R.drawable.spr_skeleton), 128, 1.7f, 0.86f, smooth = true)
    val skelKing = SpriteSheet(load(R.drawable.spr_skelking), 144, 2.05f, 0.86f, smooth = true)
    val brute = SpriteSheet(load(R.drawable.spr_brute), 160, 2.3f, 0.86f, smooth = true)
    val cultist = SpriteSheet(load(R.drawable.spr_cultist), 128, 1.7f, 0.86f)
    val spider = SpriteSheet(load(R.drawable.spr_spider), 128, 1.7f, 0.8f)
    val demon = SpriteSheet(load(R.drawable.spr_demon), 256, 3.4f, 0.86f)
    val slime = SpriteSheet(load(R.drawable.spr_slime), 96, 1.1f, 0.82f)
    val bat = SpriteSheet(load(R.drawable.spr_bat), 96, 1.3f, 0.9f)
    val merchant = SpriteSheet(load(R.drawable.spr_merchant), 128, 1.7f, 0.86f)
    val props = SpriteSheet(load(R.drawable.spr_props), 128, 1.3f, 0.8f)
    val icons = load(R.drawable.spr_icons)
    val decals = load(R.drawable.tex_decals)

    private val floorTex = mapOf(
        Biome.OVERWORLD to load(R.drawable.tex_camp_floor), Biome.CRYPT to load(R.drawable.tex_crypt_floor),
        Biome.CAVE to load(R.drawable.tex_cave_floor), Biome.HELL to load(R.drawable.tex_hell_floor),
    )
    private val wallTex = mapOf(
        Biome.OVERWORLD to load(R.drawable.tex_camp_wall), Biome.CRYPT to load(R.drawable.tex_crypt_wall),
        Biome.CAVE to load(R.drawable.tex_cave_wall), Biome.HELL to load(R.drawable.tex_hell_wall),
    )
    private val topTex = mapOf(
        Biome.OVERWORLD to load(R.drawable.tex_camp_top), Biome.CRYPT to load(R.drawable.tex_crypt_top),
        Biome.CAVE to load(R.drawable.tex_cave_top), Biome.HELL to load(R.drawable.tex_hell_top),
    )

    fun floor(b: Biome) = floorTex.getValue(b)
    fun wall(b: Biome) = wallTex.getValue(b)
    fun top(b: Biome) = topTex.getValue(b)

    /** Sprite sheet, extra scale and whether the sheet has 8 facing rows. */
    fun enemySprite(t: EnemyType): Triple<SpriteSheet, Float, Boolean> = when (t) {
        EnemyType.SLIME -> Triple(slime, 1f, false)
        EnemyType.BAT -> Triple(bat, 1f, false)
        EnemyType.SKELETON -> Triple(skeleton, 1f, true)
        EnemyType.SPIDER -> Triple(spider, 1f, true)
        EnemyType.CULTIST -> Triple(cultist, 1f, true)
        EnemyType.BRUTE -> Triple(brute, 1f, true)
        EnemyType.WOLF -> Triple(wolf, 1f, true)
        EnemyType.BANDIT -> Triple(bandit, 1f, true)
        EnemyType.GHOST -> Triple(ghost, 1f, true)
        EnemyType.IMP -> Triple(imp, 1f, true)
        EnemyType.GOBLIN -> Triple(goblin, 1f, true)
        EnemyType.TROLL -> Triple(brute, 1.7f, true)
        EnemyType.SKELETON_KING -> Triple(skelKing, 1.55f, true)
        EnemyType.SPIDER_QUEEN -> Triple(spider, 2.1f, true)
        EnemyType.DEMON_LORD -> Triple(demon, 1f, true)
        EnemyType.SHADOW_KING -> Triple(demon, 1.2f, true)
    }
}
