// Mirrors of the game's enums (same order as the Kotlin ordinals) and shared helpers.

export const TILE = { WALL: 0, FLOOR: 1, STAIRS: 2, TREE: 3, ROCK: 4, WATER: 5, ENTRANCE: 6, BLOCK: 7 };

/** Biomes under the open sky: sun, sky, weather and the time of day light them, not torches in the dark. */
export const OUTDOOR = new Set(['OVERWORLD', 'DESERT']);

export const ENEMY = ['SLIME', 'BAT', 'SKELETON', 'SPIDER', 'CULTIST', 'BRUTE', 'WOLF', 'BANDIT', 'GHOST', 'IMP', 'GOBLIN',
  'TROLL', 'SKELETON_KING', 'SPIDER_QUEEN', 'DEMON_LORD', 'SHADOW_KING'];

export const PROP = ['BARREL', 'URN', 'CHEST', 'SHRINE', 'CAMPFIRE', 'SKULLS', 'CRATE', 'GRAVESTONE', 'PILLAR', 'SIGN', 'BRAZIER',
  'COLUMN', 'SARCOPHAGUS', 'BOOKSHELF', 'WEAPON_RACK', 'BANNER', 'STALAGMITES', 'CRYSTALS', 'MUSHROOMS', 'OBSIDIAN', 'BONEPILE',
  'CAGE', 'TABLE', 'ALTAR', 'STASH'];

export const HERO = ['KNIGHT', 'BARBARIAN', 'ASSASSIN', 'SORCERESS'];
export const WEAPON = ['SWORD', 'AXE', 'MACE', 'DAGGER', 'SPEAR', 'STAFF'];
export const NPC = ['SMITH', 'ELDER', 'VILLAGER_F', 'VILLAGER_M'];
export const REGION = ['CRYPT', 'CAVE', 'HELL'];
export const RARITY_COLORS = [0xd8d8d8, 0x6c8cff, 0xffe066, 0xb266ff, 0xff8c1a, 0xff3d6e];

/** Hero action codes from Wire.action. */
export const ACT = { IDLE: 0, RUN: 1, ATTACK: 2, CAST: 3, DODGE: 4, HURT: 5, DEAD: 6, WHIRLWIND: 7, LEAP: 8, CHARGE: 9, SWEEP: 10 };

// Frame array layouts (see Wire.kt).
export const P = { X: 0, Y: 1, FX: 2, FY: 3, ACT: 4, SWING: 5, SWING_TIME: 6, CLS: 7, WPN: 8, HP: 9, FLAGS: 10, LEAP_Z: 11, BUFF: 12, SPEED: 13 };
export const E = { UID: 0, TYPE: 1, X: 2, Y: 3, FX: 4, FY: 5, MOVING: 6, WIND: 7, FLASH: 8, FLAGS: 9, SIZE: 10, HP: 11, NAME: 12 };
export const EF = { FROZEN: 1, POISON: 2, STUN: 4, SHIELD: 8, ELITE: 16, BOSS: 32, AGGRO: 64, FEAR: 128 };

/** 0xAARRGGBB (as sent by Wire) to a THREE-friendly rgb number and alpha. */
export function argb(v) {
  return { rgb: v & 0xffffff, a: ((v >>> 24) & 255) / 255 };
}

export function hash(x, y, seed = 0) {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 1274126177)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1103515245);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export function damp(current, target, lambda, dt) {
  return target + (current - target) * Math.exp(-lambda * dt);
}

export function angleDamp(current, target, lambda, dt) {
  let d = target - current;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return current + d * (1 - Math.exp(-lambda * dt));
}
