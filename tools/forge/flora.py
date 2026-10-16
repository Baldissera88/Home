"""Realistic trees and bushes: leafy canopies of displaced clumps, ridged bark and drooping conifer boughs."""
import math

import numpy as np

from sdf import capsule, ellipsoid, frame_from, group, norm, sphere, v

TREE_CELL = 320
TREE_WIDTH = 3.4
TREE_FOOT = 0.78


def _bark(parts, mat, seed, amp=0.012):
    """Trunk and limbs as one surface with vertical ridges."""
    return group(parts, mat, k=0.07, disp=(13.0, amp, 2, seed), scale=(1.0, 0.22, 1.0))


def _canopy(rng, centre, radii, count, clump, mat, seed, amp=0.075, freq=7.0, shell=(0.45, 0.88)):
    """Leaf clumps scattered through an ellipsoid (biased to its shell), merged and roughened into foliage."""
    c = np.array(centre, dtype=np.float32)
    rr = np.array(radii, dtype=np.float32)
    clumps = []
    for _ in range(count):
        u = rng.normal(size=3)
        u /= np.linalg.norm(u)
        # Fewer clumps hang under the crown; light comes from above.
        if u[1] < -0.6:
            u[1] *= 0.5
            u /= np.linalg.norm(u)
        pos = c + u * rr * rng.uniform(*shell)
        clumps.append(sphere(pos, rng.uniform(*clump), mat))
    bound = (c, float(rr.max() + clump[1] + amp * 2.5 + 0.05))
    return group(clumps, mat, k=0.09, disp=(freq, amp, 4, seed), bound=bound)


def oak(seed=0, height=1.0, spread=1.0, leaf="leaf_oak", bark="bark_oak"):
    rng = np.random.default_rng(seed)
    top = 1.05 * height
    parts = [
        capsule(v(0, 0, 0), v(0.04, top, 0.0), 0.16, bark, rb=0.11),
        ellipsoid(v(0, 0.04, 0), v(0.3, 0.09, 0.27), bark),
    ]
    for k in range(3):  # root buttresses
        a = k * 2.1 + rng.uniform(-0.3, 0.3)
        parts.append(capsule(v(0, 0.2, 0), v(math.cos(a) * 0.32, 0.0, math.sin(a) * 0.3), 0.07, bark, rb=0.03))
    for k in range(4):  # main limbs fanning into the crown
        a = k * 1.57 + rng.uniform(-0.45, 0.45)
        end = v(math.cos(a) * 0.55 * spread, top + 0.5 + rng.uniform(0, 0.25), math.sin(a) * 0.45 * spread)
        parts.append(capsule(v(0.02, top - 0.25, 0), end, 0.085, bark, rb=0.04))
    trunk = _bark(parts, bark, seed)
    crown = _canopy(rng, (0.0, top + 0.72 * height, 0.0), (0.9 * spread, 0.6 * height, 0.8 * spread), 38, (0.2, 0.33), leaf, seed + 1)
    return [trunk, crown]


def birch(seed=0):
    rng = np.random.default_rng(seed)
    parts = [capsule(v(0, 0, 0), v(-0.05, 1.9, 0.02), 0.09, "bark_birch", rb=0.05),
             capsule(v(0, 0.6, 0), v(0.28, 1.5, 0.05), 0.04, "bark_birch", rb=0.02)]
    trunk = _bark(parts, "bark_birch", seed, amp=0.008)
    crown = _canopy(rng, (0.0, 1.75, 0.0), (0.6, 0.7, 0.55), 34, (0.14, 0.24), "leaf_birch", seed + 1, amp=0.06, freq=9.0)
    return [trunk, crown]


def pine(seed=0, height=1.0, mat="needles"):
    rng = np.random.default_rng(seed)
    h = 2.5 * height
    trunk = _bark([capsule(v(0, 0, 0), v(0, h, 0), 0.1, "bark_pine", rb=0.03),
                   ellipsoid(v(0, 0.04, 0), v(0.18, 0.06, 0.18), "bark_pine")], "bark_pine", seed, amp=0.01)
    boughs = []
    layers = 11
    for k in range(layers):
        f = k / (layers - 1)
        y = (0.42 + f * 1.95) * height
        rad = 0.8 * (1 - f) ** 0.9 + 0.1
        n = 7 if f < 0.7 else 5
        for j in range(n):
            a = j * 2 * math.pi / n + k * 0.7 + rng.uniform(-0.25, 0.25)
            droop = -0.45 - 0.2 * rng.random()
            dirn = norm((math.cos(a), droop, math.sin(a)))
            centre = v(math.cos(a) * rad * 0.48, y - 0.12 * rad, math.sin(a) * rad * 0.48)
            boughs.append(ellipsoid(centre, v(0.09 + 0.07 * rad, rad * 0.55, 0.06 + 0.03 * rad), mat, rot=frame_from(dirn)))
    boughs.append(capsule(v(0, (0.42 + 1.95) * height, 0), v(0, (0.42 + 1.95) * height + 0.35, 0), 0.07, mat, rb=0.01))
    centre = v(0, (0.42 + 1.2) * height, 0)
    foliage = group(boughs, mat, k=0.05, disp=(15.0, 0.035, 2, seed + 3), bound=(centre, 1.45 * height))
    return [trunk, foliage]


def dead_tree(seed=0):
    rng = np.random.default_rng(seed)
    parts = [capsule(v(0, 0, 0), v(0.08, 1.5, 0), 0.13, "bark_dead", rb=0.05),
             ellipsoid(v(0, 0.04, 0), v(0.24, 0.07, 0.22), "bark_dead")]
    for k, (a, y, l) in enumerate([(0.5, 0.8, 0.6), (2.5, 1.05, 0.55), (4.1, 1.25, 0.45), (1.4, 1.4, 0.4), (3.4, 0.6, 0.35)]):
        base = v(0.04, y, 0)
        mid = base + v(math.cos(a) * l * 0.5, 0.22, math.sin(a) * l * 0.5)
        tip = mid + v(math.cos(a + 0.4) * l * 0.5, 0.18 + rng.uniform(0, 0.15), math.sin(a + 0.4) * l * 0.5)
        parts += [capsule(base, mid, 0.05, "bark_dead", rb=0.03), capsule(mid, tip, 0.03, "bark_dead", rb=0.01)]
    return [_bark(parts, "bark_dead", seed, amp=0.014)]


def shrub(seed=0, berries=True):
    rng = np.random.default_rng(seed)
    out = [_canopy(rng, (0.0, 0.3, 0.0), (0.42, 0.26, 0.38), 16, (0.14, 0.22), "leaf_oak", seed, amp=0.05, freq=10.0, shell=(0.2, 0.8))]
    if berries:
        for _ in range(9):
            u = rng.normal(size=3)
            u /= np.linalg.norm(u)
            if u[1] < 0:
                u[1] = -u[1]
            out.append(sphere(v(u[0] * 0.42, 0.3 + u[1] * 0.3, u[2] * 0.4), 0.035, "ruby"))
    return out


TREES = [
    ("pine", lambda: pine(1, 1.0)),
    ("pine_tall", lambda: pine(2, 1.15)),
    ("oak", lambda: oak(3, 1.0, 1.0)),
    ("oak2", lambda: oak(4, 1.1, 0.9)),
    ("birch", lambda: birch(5)),
    ("oak_autumn", lambda: oak(6, 0.95, 1.05, leaf="leaf_autumn")),
    ("dead", lambda: dead_tree(7)),
    ("shrub", lambda: shrub(8)),
]
