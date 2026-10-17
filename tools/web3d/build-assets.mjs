// Builds the 3D renderer's models from the CC0 KayKit packs (www.kaylousberg.com).
//
//   node build-assets.mjs            (clones the packs into .cache on first run)
//
// Characters lose their animations, which all share one rig and live once in anims.glb.
// Static kits (dungeon, village, weapons) are merged into one file each with a node per model.
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions';
import { dedup, meshopt, prune, resample, quantize, weld, mergeDocuments, unpartition } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer';

const CACHE = new URL('./.cache/', import.meta.url).pathname;
const OUT = new URL('../../rpg/src/main/assets/web/models/', import.meta.url).pathname;
const PACKS = {
  adv: 'KayKit-Character-Pack-Adventures-1.0',
  skel: 'KayKit-Character-Pack-Skeletons-1.0',
  dungeon: 'KayKit-Dungeon-Remastered-1.0',
  hex: 'KayKit-Medieval-Hexagon-Pack-1.0',
};
mkdirSync(CACHE, { recursive: true });
mkdirSync(OUT, { recursive: true });
for (const [dir, repo] of Object.entries(PACKS)) {
  if (!existsSync(CACHE + dir)) execSync(`git clone -q --depth 1 https://github.com/KayKit-Game-Assets/${repo} ${CACHE + dir}`, { stdio: 'inherit' });
}
const ADV = CACHE + 'adv/addons/kaykit_character_pack_adventures/';
const SKEL = CACHE + 'skel/addons/kaykit_character_pack_skeletons/';
const DUN = CACHE + 'dungeon/addons/kaykit_dungeon_remastered/Assets/gltf/';
const HEX = CACHE + 'hex/addons/kaykit_medieval_hexagon_pack/Assets/gltf/';

await MeshoptEncoder.ready;
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  'meshopt.encoder': MeshoptEncoder,
  'meshopt.decoder': MeshoptDecoder,
});

/** Removes an animation with its samplers and keyframe data (disposing the animation alone leaves them behind). */
function dropAnimation(a) {
  for (const s of a.listSamplers()) {
    const i = s.getInput(), o = s.getOutput();
    s.dispose();
    if (i && i.listParents().length <= 1) i.dispose();
    if (o && o.listParents().length <= 1) o.dispose();
  }
  for (const c of a.listChannels()) c.dispose();
  a.dispose();
}

async function finish(doc, file) {
  await doc.transform(dedup(), prune(), weld(), quantize(), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
  await io.write(OUT + file, doc);
  console.log('wrote', file);
}

// ---- characters: meshes and rig only
const CHARS = {
  knight: ADV + 'Characters/gltf/Knight.glb',
  barbarian: ADV + 'Characters/gltf/Barbarian.glb',
  mage: ADV + 'Characters/gltf/Mage.glb',
  rogue: ADV + 'Characters/gltf/Rogue_Hooded.glb',
  bandit: ADV + 'Characters/gltf/Rogue.glb',
  skeleton_warrior: SKEL + 'Characters/gltf/Skeleton_Warrior.glb',
  skeleton_minion: SKEL + 'Characters/gltf/Skeleton_Minion.glb',
  skeleton_mage: SKEL + 'Characters/gltf/Skeleton_Mage.glb',
  skeleton_rogue: SKEL + 'Characters/gltf/Skeleton_Rogue.glb',
};
for (const [name, file] of Object.entries(CHARS)) {
  const doc = await io.read(file);
  for (const a of doc.getRoot().listAnimations()) dropAnimation(a);
  await finish(doc, `${name}.glb`);
}

// ---- one shared animation library (the skeleton pack has every clip of the adventurers plus its own)
const CLIPS = [
  'Idle', 'Idle_Combat', 'Walking_A', 'Walking_D_Skeletons', 'Running_A', 'Running_B', 'Running_C',
  '1H_Melee_Attack_Chop', '1H_Melee_Attack_Slice_Diagonal', '1H_Melee_Attack_Slice_Horizontal', '1H_Melee_Attack_Stab',
  '2H_Melee_Attack_Chop', '2H_Melee_Attack_Slice', '2H_Melee_Attack_Spin', '2H_Melee_Attack_Spinning', '2H_Melee_Idle',
  'Dualwield_Melee_Attack_Chop', 'Dualwield_Melee_Attack_Slice', 'Dualwield_Melee_Attack_Stab',
  'Spellcast_Shoot', 'Spellcast_Long', 'Spellcast_Raise', 'Spellcasting', 'Spellcast_Summon', 'Throw',
  'Dodge_Forward', 'Hit_A', 'Hit_B', 'Death_A', 'Death_B', 'Death_C_Skeletons', 'Block', 'Blocking', 'Cheer',
  'Jump_Full_Short', 'Jump_Idle', 'Jump_Land', 'Interact', 'PickUp', 'Taunt', 'Spawn_Ground_Skeletons',
  'Unarmed_Idle', 'Sit_Floor_Idle',
];
{
  const doc = await io.read(SKEL + 'Characters/gltf/Skeleton_Warrior.glb');
  const root = doc.getRoot();
  for (const a of root.listAnimations()) if (!CLIPS.includes(a.getName())) dropAnimation(a);
  for (const node of root.listNodes()) {
    if (node.getMesh()) node.setMesh(null);
    if (node.getSkin()) node.setSkin(null);
  }
  for (const m of root.listMeshes()) m.dispose();
  for (const s of root.listSkins()) s.dispose();
  await doc.transform(resample(), prune({ keepLeaves: true }));
  await finish(doc, 'anims.glb');
  console.log('clips', root.listAnimations().length);
}

// ---- static kits: one document per kit, a named node per model
async function kit(name, entries) {
  const doc = new (await import('@gltf-transform/core')).Document();
  doc.createBuffer();
  const scene = doc.createScene(name);
  for (const [key, file] of entries) {
    const src = await io.read(file);
    for (const a of src.getRoot().listAnimations()) dropAnimation(a);
    const map = mergeDocuments(doc, src);
    const srcScene = src.getRoot().listScenes()[0];
    const holder = doc.createNode(key);
    for (const child of srcScene.listChildren()) holder.addChild(map.get(child));
    scene.addChild(holder);
  }
  for (const s of doc.getRoot().listScenes()) if (s !== scene) s.dispose();
  await doc.transform(unpartition());
  await finish(doc, `${name}.glb`);
}

const dun = (n) => {
  for (const ext of ['.gltf.glb', '.glb']) if (existsSync(DUN + n + ext)) return [n, DUN + n + ext];
  throw new Error('missing dungeon model ' + n);
};
await kit('dungeon', [
  'barrel_large', 'barrel_small', 'barrel_small_stack', 'box_small', 'box_large', 'box_stacked', 'crates_stacked', 'chest', 'chest_gold',
  'table_medium', 'table_long_decorated_A', 'table_small_decorated_A', 'chair', 'stool', 'shelf_small_candles', 'shelves', 'shelf_large',
  'banner_red', 'banner_patternA_red', 'banner_thin_red', 'banner_triple_red', 'column', 'pillar', 'pillar_decorated',
  'candle_lit', 'candle_triple', 'torch_mounted', 'torch_lit', 'keg', 'keg_decorated', 'trunk_large_A', 'trunk_medium_A',
  'coin_stack_large', 'coin_stack_medium', 'coin_stack_small', 'coin', 'bottle_A_green', 'bottle_B_brown', 'bottle_A_labeled_green',
  'rubble_large', 'rubble_half', 'sword_shield', 'sword_shield_gold', 'sword_shield_broken', 'plate_food_A', 'bed_frame',
  'stairs', 'floor_tile_large', 'floor_tile_small', 'floor_tile_small_broken_A', 'floor_tile_small_broken_B', 'floor_tile_large_rocks',
  'floor_dirt_large', 'floor_dirt_large_rocky', 'floor_tile_small_weeds_A', 'wall', 'wall_cracked', 'wall_broken', 'wall_pillar',
  'wall_corner', 'wall_endcap', 'wall_half', 'wall_shelves', 'wall_arched', 'wall_window_closed', 'wall_doorway', 'barrier', 'barrier_column',
].map(dun));

const hexFind = (n) => {
  const out = execSync(`find ${HEX} -name "${n}.gltf"`).toString().trim().split('\n')[0];
  if (!out) throw new Error('missing hex model ' + n);
  return [n.replace(/_(blue|red|green|yellow)$/, ''), out];
};
await kit('village', [
  'building_home_A_red', 'building_home_B_red', 'building_blacksmith_red', 'building_market_red', 'building_well_red',
  'building_tavern_red', 'building_windmill_red', 'building_church_red', 'building_tower_A_red', 'building_grain',
  'tent', 'target', 'weaponrack', 'wheelbarrow', 'sack', 'resource_lumber', 'resource_stone', 'barrel', 'crate_A_big', 'crate_long_A',
  'fence_wood_straight', 'fence_wood_straight_gate', 'wall_straight', 'wall_straight_gate', 'wall_corner_A_outside',
  'rock_single_A', 'rock_single_B', 'rock_single_C', 'rock_single_D', 'rock_single_E', 'waterlily_A', 'waterlily_B',
  'waterplant_A', 'waterplant_B', 'waterplant_C', 'flag_red', 'haybale', 'trough', 'bucket_water', 'ladder', 'pallet',
].filter(n => execSync(`find ${HEX} -name "${n}.gltf"`).toString().trim()).map(hexFind));

await kit('weapons', [
  ['skel_blade', SKEL + 'Assets/gltf/Skeleton_Blade.gltf'],
  ['skel_axe', SKEL + 'Assets/gltf/Skeleton_Axe.gltf'],
  ['skel_staff', SKEL + 'Assets/gltf/Skeleton_Staff.gltf'],
  ['skel_shield_small', SKEL + 'Assets/gltf/Skeleton_Shield_Small_A.gltf'],
  ['skel_shield_large', SKEL + 'Assets/gltf/Skeleton_Shield_Large_A.gltf'],
  ['skel_crossbow', SKEL + 'Assets/gltf/Skeleton_Crossbow.gltf'],
  ['sword_1h', ADV + 'Assets/gltf/sword_1handed.gltf'],
  ['sword_2h', ADV + 'Assets/gltf/sword_2handed.gltf'],
  ['axe_1h', ADV + 'Assets/gltf/axe_1handed.gltf'],
  ['axe_2h', ADV + 'Assets/gltf/axe_2handed.gltf'],
  ['dagger', ADV + 'Assets/gltf/dagger.gltf'],
  ['staff', ADV + 'Assets/gltf/staff.gltf'],
  ['wand', ADV + 'Assets/gltf/wand.gltf'],
  ['shield_round', ADV + 'Assets/gltf/shield_round.gltf'],
  ['shield_square', ADV + 'Assets/gltf/shield_square.gltf'],
  ['shield_badge', ADV + 'Assets/gltf/shield_badge_color.gltf'],
  ['spellbook', ADV + 'Assets/gltf/spellbook_closed.gltf'],
  ['smokebomb', ADV + 'Assets/gltf/smokebomb.gltf'],
  ['mug', ADV + 'Assets/gltf/mug_full.gltf'],
].filter(([, f]) => existsSync(f)));
