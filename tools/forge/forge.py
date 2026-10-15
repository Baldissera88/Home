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
import models as M  # noqa: E402
import textures as T  # noqa: E402
from sdf import norm, render  # noqa: E402

OUT = os.path.join(os.path.dirname(__file__), "..", "..", "rpg", "src", "main", "res", "drawable-nodpi")

# name: (builder(frame) -> prims, cell px, world width, foot fraction)
DIRECTIONAL = {
    "spr_hero": (lambda f: M.humanoid(f, M.HERO), 128, 1.7, 0.86),
    "spr_skeleton": (lambda f: M.humanoid(f, M.SKELETON), 128, 1.7, 0.86),
    "spr_skelking": (lambda f: M.humanoid(f, M.SKELETON_KING), 128, 1.8, 0.86),
    "spr_brute": (lambda f: M.humanoid(f, M.BRUTE), 160, 2.3, 0.86),
    "spr_cultist": (M.cultist, 128, 1.7, 0.86),
    "spr_spider": (M.spider, 128, 1.7, 0.8),
    "spr_demon": (M.demon, 256, 3.4, 0.86),
}
STRIPS = {
    "spr_slime": (M.slime, 96, 1.1, 0.82),
    "spr_bat": (M.bat, 96, 1.3, 0.9),
    "spr_merchant": (M.merchant, 128, 1.7, 0.86),
}


def _render_cell(job):
    kind, name, a, b = job
    if kind == "dir":
        builder, cell, width, foot = DIRECTIONAL[name]
        frame = M.FRAMES[a]
        return job, render(builder(frame), cell, width, foot, yaw=b * math.pi / 4)
    if kind == "strip":
        builder, cell, width, foot = STRIPS[name]
        return job, render(builder(a), cell, width, foot)
    if kind == "prop":
        return job, render(M.PROPS[a][1](), 128, 1.3, 0.8)
    if kind == "icon":
        e = math.radians(25)
        view = norm((0, -math.sin(e), -math.cos(e)))
        up = norm((0, math.cos(e), -math.sin(e)))
        return job, render(M.ICONS[a][1](), 96, 0.95, 0.5, yaw=0.0, view=view, up=up)
    raise ValueError(kind)


def textures():
    for biome, (floor, wall, top) in T.BIOMES.items():
        floors = np.concatenate([floor(100 + i) for i in range(4)], axis=1)
        Image.fromarray(T.to_img(floors)).save(f"{OUT}/tex_{biome}_floor.png", optimize=True)
        walls = np.concatenate([wall(200 + i) for i in range(2)], axis=1)
        Image.fromarray(T.to_img(walls)).save(f"{OUT}/tex_{biome}_wall.png", optimize=True)
        Image.fromarray(T.to_img(top(300))).save(f"{OUT}/tex_{biome}_top.png", optimize=True)
        print("textures", biome, flush=True)
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
    if not only or "props" in only:
        jobs += [("prop", "props", i, 0) for i in range(len(M.PROPS))]
    if not only or "icons" in only:
        jobs += [("icon", "icons", i, 0) for i in range(len(M.ICONS))]

    results = {}
    with Pool(os.cpu_count()) as pool:
        for n, (job, img) in enumerate(pool.imap_unordered(_render_cell, jobs, chunksize=1)):
            results[job] = img
            if n % 20 == 0:
                print(f"{n}/{len(jobs)} {time.time() - start:.0f}s", flush=True)

    for name, (_, cell, _, _) in DIRECTIONAL.items():
        if only and name not in only:
            continue
        sheet = np.zeros((cell * 8, cell * 8, 4), dtype=np.uint8)
        for d in range(8):
            src = d if d <= 4 else 8 - d
            for f in range(8):
                img = results[("dir", name, f, src)]
                if d > 4:
                    img = img[:, ::-1]
                sheet[d * cell:(d + 1) * cell, f * cell:(f + 1) * cell] = img
        Image.fromarray(sheet).save(f"{OUT}/{name}.png", optimize=True)
    for name, (_, cell, _, _) in STRIPS.items():
        if only and name not in only:
            continue
        strip = np.concatenate([results[("strip", name, i, 0)] for i in range(4)], axis=1)
        Image.fromarray(strip).save(f"{OUT}/{name}.png", optimize=True)
    if not only or "props" in only:
        strip = np.concatenate([results[("prop", "props", i, 0)] for i in range(len(M.PROPS))], axis=1)
        Image.fromarray(strip).save(f"{OUT}/spr_props.png", optimize=True)
    if not only or "icons" in only:
        strip = np.concatenate([results[("icon", "icons", i, 0)] for i in range(len(M.ICONS))], axis=1)
        Image.fromarray(strip).save(f"{OUT}/spr_icons.png", optimize=True)
    print(f"done in {time.time() - start:.0f}s", flush=True)


if __name__ == "__main__":
    main()
