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
)

class Assets(private val res: Resources) {
    private val opts = BitmapFactory.Options().apply { inScaled = false }
    private fun load(id: Int): ImageBitmap = BitmapFactory.decodeResource(res, id, opts).asImageBitmap()

    private val heroes = mapOf(
        WeaponKind.SWORD to SpriteSheet(load(R.drawable.spr_hero), 128, 1.7f, 0.86f),
        WeaponKind.AXE to SpriteSheet(load(R.drawable.spr_hero_axe), 128, 1.7f, 0.86f),
        WeaponKind.MACE to SpriteSheet(load(R.drawable.spr_hero_mace), 128, 1.7f, 0.86f),
        WeaponKind.DAGGER to SpriteSheet(load(R.drawable.spr_hero_dagger), 128, 1.7f, 0.86f),
        WeaponKind.SPEAR to SpriteSheet(load(R.drawable.spr_hero_spear), 128, 1.7f, 0.86f),
        WeaponKind.STAFF to SpriteSheet(load(R.drawable.spr_hero_staff), 128, 1.7f, 0.86f),
    )
    fun hero(kind: WeaponKind) = heroes.getValue(kind)
    val wolf = SpriteSheet(load(R.drawable.spr_wolf), 128, 1.7f, 0.8f)
    val bandit = SpriteSheet(load(R.drawable.spr_bandit), 128, 1.7f, 0.86f)
    val world = SpriteSheet(load(R.drawable.spr_world), 160, 2.6f, 0.88f)
    val ground = load(R.drawable.tex_world_ground)
    val water = load(R.drawable.tex_water)
    val skeleton = SpriteSheet(load(R.drawable.spr_skeleton), 128, 1.7f, 0.86f)
    val skelKing = SpriteSheet(load(R.drawable.spr_skelking), 128, 1.8f, 0.86f)
    val brute = SpriteSheet(load(R.drawable.spr_brute), 160, 2.3f, 0.86f)
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
        EnemyType.TROLL -> Triple(brute, 1.7f, true)
        EnemyType.SKELETON_KING -> Triple(skelKing, 1.55f, true)
        EnemyType.SPIDER_QUEEN -> Triple(spider, 2.1f, true)
        EnemyType.DEMON_LORD -> Triple(demon, 1f, true)
        EnemyType.SHADOW_KING -> Triple(demon, 1.2f, true)
    }
}
