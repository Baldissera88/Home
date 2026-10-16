"""Renders every RPG sprite sheet and texture into rpg/src/main/res/drawable-nodpi.

Run from the repo root:  python3 tools/forge/forge.py
Directional sheets: 8 columns (idle, walk x4, attack x3) by 8 rows (S, SE, E, NE, N, NW, W, SW).
"""
import math
import os
import sys
import time
from multiprocessing import Pool

import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(__file__))
import flora as F  # noqa: E402
import heroes as H  # noqa: E402
import models as M  # noqa: E402
import textures as T  # noqa: E402
from sdf import norm, render  # noqa: E402

OUT = os.path.join(os.path.dirname(__file__), "..", "..", "rpg", "src", "main", "res", "drawable-nodpi")

# name: (builder(frame) -> prims, cell px, world width, foot fraction)
DIRECTIONAL = {
    "spr_skeleton": (lambda f: M.humanoid(f, M.SKELETON), 128, 1.7, 0.86),
    "spr_skelking": (lambda f: M.humanoid(f, M.SKELETON_KING), 128, 1.8, 0.86),
    "spr_brute": (lambda f: M.humanoid(f, M.BRUTE), 160, 2.3, 0.86),
    "spr_cultist": (M.cultist, 192, 1.7, 0.86),
    "spr_spider": (M.spider, 192, 1.7, 0.8),
    "spr_demon": (M.demon, 384, 3.4, 0.86),
    "spr_bandit": (lambda f: M.humanoid(f, M.BANDIT), 128, 1.7, 0.86),
    "spr_wolf": (M.wolf, 192, 1.7, 0.8),
    "spr_villager_f": (lambda f: M.humanoid(f, M.VILLAGER_F), 128, 1.7, 0.86),
    "spr_villager_m": (lambda f: M.humanoid(f, M.VILLAGER_M), 128, 1.7, 0.86),
    "spr_ghost": (M.ghost, 192, 1.7, 0.86),
    "spr_imp": (M.imp, 144, 1.2, 0.86),
    "spr_goblin": (lambda f: M.humanoid(f, M.GOBLIN), 96, 1.3, 0.86),
}
# Humanoid monsters and villagers rendered with the smooth 16-frame layout (idle x2, walk x8, attack x6).
SMOOTH = {
    "spr_skeleton": (lambda f: M.humanoid(f, M.SKELETON), 192, 1.7, 0.86),
    "spr_skelking": (lambda f: M.humanoid(f, M.SKELETON_KING), 216, 2.05, 0.86),
    "spr_brute": (lambda f: M.humanoid(f, M.BRUTE), 240, 2.3, 0.86),
    "spr_bandit": (lambda f: M.humanoid(f, M.BANDIT), 192, 1.7, 0.86),
    "spr_goblin": (lambda f: M.humanoid(f, M.GOBLIN), 144, 1.3, 0.86),
    "spr_villager_f": (lambda f: M.humanoid(f, M.VILLAGER_F), 192, 1.7, 0.86),
    "spr_villager_m": (lambda f: M.humanoid(f, M.VILLAGER_M), 192, 1.7, 0.86),
}
for _name in SMOOTH:
    DIRECTIONAL.pop(_name, None)

STRIPS = {
    "spr_slime": (M.slime, 144, 1.1, 0.82),
    "spr_bat": (M.bat, 144, 1.3, 0.9),
    "spr_merchant": (M.merchant, 192, 1.7, 0.86),
    "spr_elder": (M.elder, 192, 1.7, 0.86),
    "spr_smith": (lambda i: M.humanoid(M.FRAMES[[0, 5, 6, 7][i]], M.BLACKSMITH), 192, 1.7, 0.86),
}


HERO_CELL = 216
PROP_CELL = 192
PROPS_PER_ROW = 16
WORLD_CELL = 240
VILLAGE_CELL = 384
# Sheets keep five facings (S, SE, E, NE, N); the game mirrors them for the other three.
FACINGS = 5


def _portrait_view():
    e = math.radians(28)
    return norm((0, -math.sin(e), -math.cos(e))), norm((0, math.cos(e), -math.sin(e)))


def _render_cell(job):
    kind, name, a, b = job
    if kind == "smooth":
        builder, cell, width, foot = SMOOTH[name]
        return job, render(builder(M.HERO_FRAMES[a]), cell, width, foot, yaw=b * math.pi / 4)
    if kind == "hero":
        frame = M.HERO_FRAMES[a]
        return job, render(M.humanoid(frame, H.SHEETS[name]), HERO_CELL, 1.9, 0.9, yaw=b * math.pi / 4)
    if kind == "portrait":
        view, up = _portrait_view()
        return job, render(M.humanoid(M.HERO_FRAMES[0], H.PORTRAITS[name]), 320, 1.25, 0.94, yaw=0.45, view=view, up=up)
    if kind == "dir":
        builder, cell, width, foot = DIRECTIONAL[name]
        frame = M.FRAMES[a]
        return job, render(builder(frame), cell, width, foot, yaw=b * math.pi / 4)
    if kind == "strip":
        builder, cell, width, foot = STRIPS[name]
        return job, render(builder(a), cell, width, foot)
    if kind == "prop":
        return job, render(M.PROPS[a][1](), PROP_CELL, 1.3, 0.8)
    if kind == "village":
        return job, render(M.VILLAGE[a][1](), VILLAGE_CELL, 4.4, 0.86)
    if kind == "tree":
        return job, render(F.TREES[a][1](), F.TREE_CELL, F.TREE_WIDTH, F.TREE_FOOT, step=0.6, iters=160)
    if kind == "world":
        return job, render(M.WORLD[a][1](), WORLD_CELL, 2.6, 0.88)
    if kind == "icon":
        e = math.radians(25)
        view = norm((0, -math.sin(e), -math.cos(e)))
        up = norm((0, math.cos(e), -math.sin(e)))
        return job, render(M.ICONS[a][1](), 96, 0.95, 0.5, yaw=0.0, view=view, up=up)
    raise ValueError(kind)


def textures():
    for biome, (floor, wall, top) in T.BIOMES.items():
        if biome in T.BIG_FLOORS:
            floors = T.BIG_FLOORS[biome](100)
        else:
            floors = np.concatenate([floor(100 + i) for i in range(4)], axis=1)
        Image.fromarray(T.to_img(floors)).save(f"{OUT}/tex_{biome}_floor.png", optimize=True)
        walls = np.concatenate([wall(200 + i) for i in range(2)], axis=1)
        Image.fromarray(T.to_img(walls)).save(f"{OUT}/tex_{biome}_wall.png", optimize=True)
        tex_top = T.top_generic(300, T.DARK_TOPS[biome]) if biome in T.DARK_TOPS else top(300)
        Image.fromarray(T.to_img(tex_top)).save(f"{OUT}/tex_{biome}_top.png", optimize=True)
        print("textures", biome, flush=True)
    Image.fromarray(T.to_img(T.world_ground())).save(f"{OUT}/tex_world_ground.png", optimize=True)
    waters = np.concatenate([T.water(600, f) for f in range(2)], axis=1)
    Image.fromarray(T.to_img(waters)).save(f"{OUT}/tex_water.png", optimize=True)
    Image.fromarray(T.fog(900)).save(f"{OUT}/tex_fog.png", optimize=True)
    Image.fromarray(T.ground_edges()).save(f"{OUT}/tex_ground_edges.png", optimize=True)
    Image.fromarray(T.wall_skirts()).save(f"{OUT}/tex_wall_skirts.png", optimize=True)
    decals = [T.decal_blood(400 + i) for i in range(4)] + [T.decal_scorch(500)]
    Image.fromarray(np.concatenate(decals, axis=1)).save(f"{OUT}/tex_decals.png", optimize=True)


def main():
    os.makedirs(OUT, exist_ok=True)
    only = set(sys.argv[1:])
    start = time.time()
    if not only or "textures" in only:
        textures()

    jobs = []
    for name in DIRECTIONAL:
        if only and name not in only:
            continue
        for d in range(5):
            for f in range(len(M.FRAMES)):
                jobs.append(("dir", name, f, d))
    for name in STRIPS:
        if only and name not in only:
            continue
        for i in range(4):
            jobs.append(("strip", name, i, 0))
    for name in SMOOTH:
        if only and name not in only and "smooth" not in only:
            continue
        for d in range(5):
            for f in range(len(M.HERO_FRAMES)):
                jobs.append(("smooth", name, f, d))
    if not only or "heroes" in only:
        for name in H.SHEETS:
            if os.environ.get("HEROES") and name not in os.environ["HEROES"].split(","):
                continue
            for d in range(5):
                for f in range(len(M.HERO_FRAMES)):
                    jobs.append(("hero", name, f, d))
        for name in H.PORTRAITS:
            jobs.append(("portrait", name, 0, 0))
    if not only or "props" in only:
        jobs += [("prop", "props", i, 0) for i in range(len(M.PROPS))]
    if not only or "icons" in only:
        jobs += [("icon", "icons", i, 0) for i in range(len(M.ICONS))]
    if not only or "world" in only:
        jobs += [("world", "world", i, 0) for i in range(len(M.WORLD))]
    if not only or "trees" in only:
        jobs += [("tree", "trees", i, 0) for i in range(len(F.TREES))]
    if not only or "village" in only:
        jobs += [("village", "village", i, 0) for i in range(len(M.VILLAGE))]

    results = {}
    with Pool(os.cpu_count()) as pool:
        for n, (job, img) in enumerate(pool.imap_unordered(_render_cell, jobs, chunksize=1)):
            results[job] = img
            if n % 20 == 0:
                print(f"{n}/{len(jobs)} {time.time() - start:.0f}s", flush=True)

    for name, (_, cell, _, _) in DIRECTIONAL.items():
        if only and name not in only:
            continue
        sheet = np.zeros((cell * FACINGS, cell * 8, 4), dtype=np.uint8)
        for d in range(FACINGS):
            for f in range(8):
                sheet[d * cell:(d + 1) * cell, f * cell:(f + 1) * cell] = results[("dir", name, f, d)]
        Image.fromarray(sheet).save(f"{OUT}/{name}.png", optimize=True)
    for name, (_, cell, _, _) in SMOOTH.items():
        if ("smooth", name, 0, 0) not in results:
            continue
        n = len(M.HERO_FRAMES)
        sheet = np.zeros((cell * FACINGS, cell * n, 4), dtype=np.uint8)
        for d in range(FACINGS):
            for f in range(n):
                sheet[d * cell:(d + 1) * cell, f * cell:(f + 1) * cell] = results[("smooth", name, f, d)]
        Image.fromarray(sheet).save(f"{OUT}/{name}.png", optimize=True)
    if not only or "heroes" in only:
        n = len(M.HERO_FRAMES)
        for name in H.SHEETS:
            if ("hero", name, 0, 0) not in results:
                continue
            sheet = np.zeros((HERO_CELL * FACINGS, HERO_CELL * n, 4), dtype=np.uint8)
            for d in range(FACINGS):
                for f in range(n):
                    sheet[d * HERO_CELL:(d + 1) * HERO_CELL, f * HERO_CELL:(f + 1) * HERO_CELL] = results[("hero", name, f, d)]
            Image.fromarray(sheet).save(f"{OUT}/spr_{name}.png", optimize=True)
        for name in H.PORTRAITS:
            Image.fromarray(results[("portrait", name, 0, 0)]).save(f"{OUT}/portrait_{name}.png", optimize=True)
    for name, (_, cell, _, _) in STRIPS.items():
        if only and name not in only:
            continue
        strip = np.concatenate([results[("strip", name, i, 0)] for i in range(4)], axis=1)
        Image.fromarray(strip).save(f"{OUT}/{name}.png", optimize=True)
    if not only or "props" in only:
        cells = [results[("prop", "props", i, 0)] for i in range(len(M.PROPS))]
        rows = (len(cells) + PROPS_PER_ROW - 1) // PROPS_PER_ROW
        grid = np.zeros((PROP_CELL * rows, PROP_CELL * PROPS_PER_ROW, 4), dtype=np.uint8)
        for i, c in enumerate(cells):
            r, k = divmod(i, PROPS_PER_ROW)
            grid[r * PROP_CELL:(r + 1) * PROP_CELL, k * PROP_CELL:(k + 1) * PROP_CELL] = c
        Image.fromarray(grid).save(f"{OUT}/spr_props.png", optimize=True)
    if not only or "icons" in only:
        strip = np.concatenate([results[("icon", "icons", i, 0)] for i in range(len(M.ICONS))], axis=1)
        Image.fromarray(strip).save(f"{OUT}/spr_icons.png", optimize=True)
    if not only or "world" in only:
        strip = np.concatenate([results[("world", "world", i, 0)] for i in range(len(M.WORLD))], axis=1)
        Image.fromarray(strip).save(f"{OUT}/spr_world.png", optimize=True)
    if not only or "trees" in only:
        cells = [results[("tree", "trees", i, 0)] for i in range(len(F.TREES))]
        grid = np.concatenate([np.concatenate(cells[:4], axis=1), np.concatenate(cells[4:8], axis=1)], axis=0)
        Image.fromarray(grid).save(f"{OUT}/spr_trees.png", optimize=True)
    if not only or "village" in only:
        strip = np.concatenate([results[("village", "village", i, 0)] for i in range(len(M.VILLAGE))], axis=1)
        Image.fromarray(strip).save(f"{OUT}/spr_village.png", optimize=True)
    print(f"done in {time.time() - start:.0f}s", flush=True)


if __name__ == "__main__":
    main()
