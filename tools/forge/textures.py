"""Procedural, pre-lit tile textures and floor decals for the RPG."""
import math

import numpy as np

rng = np.random.default_rng(1234)
LIGHT = np.array([-0.55, -0.6, 0.6])  # x right, y down (image space), z out of the surface
LIGHT = LIGHT / np.linalg.norm(LIGHT)


def value_noise(w, h, cells, seed):
    """Tileable smooth value noise in [0,1]."""
    r = np.random.default_rng(seed)
    g = r.random((cells, cells))
    ys = np.arange(h) / h * cells
    xs = np.arange(w) / w * cells
    x0 = np.floor(xs).astype(int)
    y0 = np.floor(ys).astype(int)
    fx = xs - x0
    fy = ys - y0
    fx = fx * fx * (3 - 2 * fx)
    fy = fy * fy * (3 - 2 * fy)
    x1 = (x0 + 1) % cells
    y1 = (y0 + 1) % cells
    x0 %= cells
    y0 %= cells
    a = g[np.ix_(y0, x0)]
    b = g[np.ix_(y0, x1)]
    c = g[np.ix_(y1, x0)]
    d = g[np.ix_(y1, x1)]
    top = a + (b - a) * fx[None, :]
    bot = c + (d - c) * fx[None, :]
    return top + (bot - top) * fy[:, None]


def fbm(w, h, base, octaves, seed, gain=0.5):
    total = np.zeros((h, w))
    amp = 1.0
    norm_ = 0.0
    for o in range(octaves):
        total += amp * value_noise(w, h, base * 2 ** o, seed + o * 17)
        norm_ += amp
        amp *= gain
    return total / norm_


def voronoi(w, h, points, seed):
    """Tileable F1/F2 distances and nearest-cell id (points in unit square)."""
    r = np.random.default_rng(seed)
    pts = r.random((points, 2))
    offs = [(dx, dy) for dx in (-1, 0, 1) for dy in (-1, 0, 1)]
    allp = np.concatenate([pts + np.array(o) for o in offs])
    ids = np.tile(np.arange(points), len(offs))
    yy, xx = np.mgrid[0:h, 0:w]
    uv = np.stack([(xx + 0.5) / w, (yy + 0.5) / h], axis=-1)
    d = np.linalg.norm(uv[:, :, None, :] - allp[None, None, :, :], axis=-1)
    order = np.argsort(d, axis=-1)
    f1 = np.take_along_axis(d, order[..., :1], -1)[..., 0]
    f2 = np.take_along_axis(d, order[..., 1:2], -1)[..., 0]
    cell = ids[order[..., 0]]
    return f1, f2, cell


def shade(height, albedo, strength=6.0, ambient=0.5, ao=None):
    gx = (np.roll(height, -1, axis=1) - np.roll(height, 1, axis=1)) * strength
    gy = (np.roll(height, -1, axis=0) - np.roll(height, 1, axis=0)) * strength
    n = np.stack([-gx, -gy, np.ones_like(height)], axis=-1)
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    diff = np.clip(n @ LIGHT, 0, 1)
    light = ambient + (1 - ambient) * 1.25 * diff
    if ao is not None:
        light *= ao
    return np.clip(albedo * light[..., None], 0, 1)


def to_img(rgb, alpha=None):
    a = np.ones(rgb.shape[:2]) if alpha is None else alpha
    out = np.concatenate([rgb, a[..., None]], axis=-1)
    return (np.clip(out, 0, 1) * 255 + 0.5).astype(np.uint8)


def mix(a, b, t):
    t = np.asarray(t)[..., None] if np.ndim(t) else t
    return np.asarray(a) * (1 - t) + np.asarray(b) * t


# ---------------------------------------------------------------- floors

def floor_crypt(seed, size=128):
    """Four worn flagstones with dark grout, cracks and grime."""
    n = fbm(size, size, 4, 5, seed)
    fine = fbm(size, size, 16, 3, seed + 5)
    yy, xx = np.mgrid[0:size, 0:size]
    half = size // 2
    sx = xx % half
    sy = yy % half
    edge = np.minimum(np.minimum(sx, half - 1 - sx), np.minimum(sy, half - 1 - sy)).astype(float)
    stone_id = (yy // half) * 2 + (xx // half)
    r = np.random.default_rng(seed)
    tints = r.uniform(0.8, 1.15, 4)
    tilt = r.uniform(-0.4, 0.4, (4, 2))
    bevel = np.clip(edge / 5.0, 0, 1)
    height = bevel * 0.8 + n * 0.35 + fine * 0.12
    height += (tilt[stone_id, 0] * (sx / half - 0.5) + tilt[stone_id, 1] * (sy / half - 0.5)) * 0.15
    base = np.array([0.36, 0.33, 0.30])
    albedo = base * (0.75 + 0.5 * n)[..., None] * tints[stone_id][..., None]
    albedo = mix(albedo, np.array([0.22, 0.2, 0.17]), np.clip((fine - 0.55) * 3, 0, 0.6))
    grout = edge < 1.5
    albedo[grout] = [0.10, 0.09, 0.08]
    height[grout] = 0.0
    # Cracks: random walks inside some stones.
    crack = np.zeros((size, size))
    for _ in range(r.integers(1, 4)):
        x, y = r.uniform(4, size - 4), r.uniform(4, size - 4)
        ang = r.uniform(0, 2 * math.pi)
        for _ in range(r.integers(10, 28)):
            ang += r.normal(0, 0.5)
            x = (x + math.cos(ang) * 1.6) % size
            y = (y + math.sin(ang) * 1.6) % size
            crack[int(y), int(x)] = 1
    height -= crack * 0.6
    albedo[crack > 0] *= 0.35
    ao = np.clip(0.55 + bevel * 0.45, 0, 1)
    return shade(height, albedo, 5.0, 0.45, ao)


def floor_cave(seed, size=128):
    f1, f2, cell = voronoi(size, size, 14, seed)
    n = fbm(size, size, 4, 5, seed + 3)
    edge = np.clip((f2 - f1) * 14, 0, 1)
    r = np.random.default_rng(seed)
    tint = r.uniform(0.75, 1.2, 14)[cell]
    height = edge ** 0.6 * 0.7 + n * 0.5
    albedo = np.array([0.36, 0.27, 0.18]) * (0.7 + 0.5 * n)[..., None] * tint[..., None]
    dirt = fbm(size, size, 3, 4, seed + 9)
    albedo = mix(albedo, np.array([0.22, 0.17, 0.11]), np.clip((dirt - 0.5) * 2.5, 0, 0.8) * (1 - edge * 0.5))
    moss = fbm(size, size, 5, 4, seed + 21)
    albedo = mix(albedo, np.array([0.17, 0.27, 0.10]), np.clip((moss - 0.62) * 4, 0, 0.7))
    return shade(height, albedo, 6.0, 0.45, 0.6 + 0.4 * edge)


def floor_hell(seed, size=128):
    f1, f2, cell = voronoi(size, size, 11, seed)
    n = fbm(size, size, 4, 5, seed + 7)
    gap = f2 - f1
    edge = np.clip(gap * 16, 0, 1)
    height = edge ** 0.5 * 0.8 + n * 0.3
    albedo = np.array([0.16, 0.10, 0.10]) * (0.6 + 0.6 * n)[..., None]
    lit = shade(height, albedo, 6.0, 0.45, 0.5 + 0.5 * edge)
    lava = np.clip(1 - gap * 30, 0, 1) ** 1.5
    glow = mix(np.array([0.9, 0.18, 0.02]), np.array([1.0, 0.75, 0.25]), lava)
    return np.clip(lit * (1 - lava[..., None]) + glow * lava[..., None] * (0.7 + 0.5 * n[..., None]), 0, 1)


def floor_camp(seed, size=128):
    n = fbm(size, size, 4, 5, seed)
    blades = fbm(size, size, 32, 2, seed + 4)
    streak = value_noise(size, size, 64, seed + 8)
    albedo = mix(np.array([0.16, 0.28, 0.09]), np.array([0.32, 0.42, 0.15]), n * 0.8 + streak * 0.3)
    dirt = fbm(size, size, 3, 4, seed + 13)
    path = np.clip((dirt - 0.58) * 4, 0, 1)
    albedo = mix(albedo, np.array([0.36, 0.28, 0.18]) * (0.8 + 0.4 * blades[..., None]), path)
    r = np.random.default_rng(seed)
    for _ in range(10):
        x, y = r.integers(0, size), r.integers(0, size)
        col = [np.array([0.9, 0.85, 0.3]), np.array([0.85, 0.85, 0.95]), np.array([0.7, 0.35, 0.8])][r.integers(0, 3)]
        albedo[max(0, y - 1):y + 2, max(0, x - 1):x + 2] = col * (1 - path[y, x])
    height = blades * 0.6 + n * 0.4
    return shade(height, albedo, 4.0, 0.55)


# ---------------------------------------------------------------- walls (front faces)

def wall_crypt(seed, w=128, h=96):
    n = fbm(w, h, 4, 5, seed)
    fine = fbm(w, h, 16, 3, seed + 3)
    r = np.random.default_rng(seed)
    rows = 3
    rh = h // rows
    height = np.zeros((h, w))
    albedo = np.zeros((h, w, 3))
    yy, xx = np.mgrid[0:h, 0:w]
    for row in range(rows):
        y0 = row * rh
        offset = r.integers(0, 48) if row % 2 else 0
        x = -offset
        while x < w:
            bw = int(r.integers(40, 72))
            x0, x1 = max(x, 0), min(x + bw, w)
            if x1 - x0 > 2:
                sub = (slice(y0, y0 + rh), slice(x0, x1))
                ly = yy[sub] - y0
                lx = xx[sub] - x
                e = np.minimum(np.minimum(lx, bw - 1 - lx), np.minimum(ly, rh - 1 - ly)).astype(float)
                bev = np.clip(e / 4.0, 0, 1)
                height[sub] = bev * 0.8 + n[sub] * 0.3
                tint = r.uniform(0.8, 1.2)
                albedo[sub] = np.array([0.42, 0.37, 0.32]) * tint * (0.7 + 0.5 * n[sub])[..., None]
                mortar = e < 1.5
                albedo[sub][mortar] = [0.12, 0.1, 0.09]
                height[sub][mortar] = 0
            x += bw
    albedo = mix(albedo, np.array([0.18, 0.2, 0.12]), np.clip((fine - 0.6) * 3, 0, 0.5))
    lit = shade(height, albedo, 5.0, 0.45)
    grad = np.linspace(1.05, 0.55, h)[:, None, None]
    return np.clip(lit * grad, 0, 1)


def wall_cave(seed, w=128, h=96):
    yy, xx = np.mgrid[0:h, 0:w]
    n = fbm(w, h, 4, 6, seed)
    strata = np.sin(yy / h * 9 + n * 6) * 0.5 + 0.5
    height = n * 0.8 + strata * 0.3
    albedo = np.array([0.33, 0.25, 0.17]) * (0.65 + 0.6 * n)[..., None]
    albedo = mix(albedo, np.array([0.45, 0.36, 0.24]), strata * 0.4)
    lit = shade(height, albedo, 7.0, 0.4)
    grad = np.linspace(1.05, 0.5, h)[:, None, None]
    return np.clip(lit * grad, 0, 1)


def wall_hell(seed, w=128, h=96):
    base = wall_crypt(seed, w, h)
    dark = base * np.array([0.55, 0.32, 0.3])
    lum = base.mean(axis=-1)
    seams = np.clip((0.13 - lum) * 8, 0, 1)
    glow = np.array([1.0, 0.35, 0.05]) * seams[..., None]
    return np.clip(dark + glow * 0.6, 0, 1)


def wall_camp(seed, w=128, h=96):
    """Palisade of vertical logs."""
    yy, xx = np.mgrid[0:h, 0:w]
    logs = 5
    lw = w / logs
    lx = (xx % lw) / lw
    bark = fbm(w, h, 8, 4, seed)
    grain = value_noise(w, h, 32, seed + 2)
    round_ = np.sqrt(np.clip(1 - (lx * 2 - 1) ** 2, 0, 1))
    height = round_ * 0.8 + bark * 0.25
    albedo = np.array([0.36, 0.24, 0.13]) * (0.6 + 0.5 * bark + 0.15 * grain)[..., None]
    gap = (lx < 0.05) | (lx > 0.95)
    albedo[gap] = [0.06, 0.05, 0.04]
    lit = shade(height, albedo, 4.0, 0.4)
    rope = (np.abs(yy - h * 0.3) < 3)
    lit[rope] = lit[rope] * 0.5 + np.array([0.45, 0.38, 0.22]) * 0.5
    grad = np.linspace(1.05, 0.55, h)[:, None, None]
    return np.clip(lit * grad, 0, 1)


# ---------------------------------------------------------------- wall tops

def top_generic(seed, base, size=128):
    n = fbm(size, size, 4, 5, seed)
    f1, f2, _ = voronoi(size, size, 9, seed + 1)
    edge = np.clip((f2 - f1) * 10, 0, 1)
    height = n * 0.6 + edge * 0.4
    albedo = np.array(base) * (0.6 + 0.6 * n)[..., None]
    return shade(height, albedo, 5.0, 0.5, 0.6 + 0.4 * edge)


def top_camp(seed, size=128):
    yy, xx = np.mgrid[0:size, 0:size]
    logs = 5
    lw = size / logs
    cx = (xx // lw + 0.5) * lw
    d = np.abs(xx - cx) / (lw / 2)
    n = fbm(size, size, 6, 3, seed)
    rings = np.sin(d * 14 + n * 3) * 0.5 + 0.5
    albedo = mix(np.array([0.45, 0.33, 0.2]), np.array([0.3, 0.2, 0.11]), rings * 0.6)
    albedo[d > 0.92] = [0.05, 0.04, 0.03]
    return shade(rings * 0.2 + n * 0.3, albedo, 3.0, 0.6)


# ---------------------------------------------------------------- decals

def decal_blood(seed, size=128):
    r = np.random.default_rng(seed)
    yy, xx = np.mgrid[0:size, 0:size].astype(float)
    alpha = np.zeros((size, size))
    c = size / 2
    for _ in range(r.integers(6, 12)):
        ang = r.uniform(0, 2 * math.pi)
        dist = abs(r.normal(0, size * 0.15))
        x, y = c + math.cos(ang) * dist, c + math.sin(ang) * dist
        rad = r.uniform(4, 16) * (1.4 - dist / size * 2)
        alpha = np.maximum(alpha, np.clip(1 - np.hypot(xx - x, yy - y) / max(rad, 2), 0, 1) * 3)
    for _ in range(r.integers(5, 10)):
        ang = r.uniform(0, 2 * math.pi)
        for k in range(14):
            x, y = c + math.cos(ang) * k * 3.5, c + math.sin(ang) * k * 3.5
            alpha = np.maximum(alpha, np.clip(1 - np.hypot(xx - x, yy - y) / (3 - k * 0.15), 0, 1) * 3)
    n = fbm(size, size, 8, 3, seed)
    alpha = np.clip(alpha, 0, 1) * (0.7 + 0.3 * n)
    rgb = np.zeros((size, size, 3)) + np.array([0.32, 0.02, 0.02])
    rgb *= (0.6 + 0.6 * n)[..., None]
    return to_img(rgb, alpha * 0.9)


def decal_scorch(seed, size=128):
    yy, xx = np.mgrid[0:size, 0:size].astype(float)
    n = fbm(size, size, 6, 4, seed)
    d = np.hypot(xx - size / 2, yy - size / 2) / (size / 2)
    alpha = np.clip(1 - d - (n - 0.5) * 0.6, 0, 1) ** 0.8
    rgb = np.zeros((size, size, 3)) + np.array([0.05, 0.03, 0.02])
    return to_img(rgb, alpha * 0.85)


BIOMES = {
    "camp": (floor_camp, wall_camp, lambda s: top_camp(s)),
    "crypt": (floor_crypt, wall_crypt, lambda s: top_generic(s, [0.24, 0.21, 0.19])),
    "cave": (floor_cave, wall_cave, lambda s: top_generic(s, [0.25, 0.19, 0.13])),
    "hell": (floor_hell, wall_hell, lambda s: top_generic(s, [0.17, 0.08, 0.07])),
}


# ---------------------------------------------------------------- overworld ground

def ground_grass(seed, size=128, flowers=6):
    n = fbm(size, size, 4, 5, seed)
    blades = fbm(size, size, 32, 2, seed + 4)
    streak = value_noise(size, size, 64, seed + 8)
    albedo = mix(np.array([0.17, 0.30, 0.09]), np.array([0.34, 0.45, 0.15]), n * 0.8 + streak * 0.3)
    dry = fbm(size, size, 3, 3, seed + 31)
    albedo = mix(albedo, np.array([0.42, 0.42, 0.2]), np.clip((dry - 0.62) * 3, 0, 0.5))
    r = np.random.default_rng(seed)
    for _ in range(flowers):
        x, y = r.integers(1, size - 1), r.integers(1, size - 1)
        col = [np.array([0.95, 0.85, 0.3]), np.array([0.9, 0.9, 0.95]), np.array([0.75, 0.4, 0.85]), np.array([0.9, 0.3, 0.3])][r.integers(0, 4)]
        albedo[y - 1:y + 2, x - 1:x + 2] = col
    return shade(blades * 0.6 + n * 0.4, albedo, 4.0, 0.55)


def ground_dirt(seed, size=128):
    n = fbm(size, size, 4, 5, seed)
    fine = fbm(size, size, 24, 2, seed + 2)
    albedo = mix(np.array([0.33, 0.25, 0.16]), np.array([0.48, 0.38, 0.25]), n)
    yy, xx = np.mgrid[0:size, 0:size]
    ruts = (np.abs(((xx + n * 10) % 64) - 20) < 4) * 0.12
    albedo = albedo * (1 - ruts[..., None])
    r = np.random.default_rng(seed)
    height = n * 0.5 + fine * 0.3 - ruts
    for _ in range(40):
        x, y = r.integers(2, size - 2), r.integers(2, size - 2)
        rad = r.uniform(1.2, 3)
        m = (xx - x) ** 2 + (yy - y) ** 2 < rad * rad
        albedo[m] = np.array([0.45, 0.42, 0.38]) * r.uniform(0.7, 1.2)
        height[m] += 0.6
    return shade(height, albedo, 5.0, 0.5)


def ground_sand(seed, size=128):
    n = fbm(size, size, 6, 4, seed)
    yy, xx = np.mgrid[0:size, 0:size]
    ripples = np.sin((yy + n * 20) / size * 2 * math.pi * 8) * 0.5 + 0.5
    albedo = mix(np.array([0.62, 0.55, 0.38]), np.array([0.78, 0.7, 0.5]), n * 0.7 + ripples * 0.2)
    return shade(ripples * 0.3 + n * 0.3, albedo, 3.0, 0.6)


def water(seed, frame, size=128):
    yy, xx = np.mgrid[0:size, 0:size]
    n = fbm(size, size, 4, 4, seed)
    phase = frame * math.pi
    waves = np.sin((xx + yy * 0.5) / size * 2 * math.pi * 3 + n * 6 + phase) * 0.5 + 0.5
    waves2 = np.sin((xx * 0.3 - yy) / size * 2 * math.pi * 4 + n * 4 - phase) * 0.5 + 0.5
    base = mix(np.array([0.04, 0.14, 0.19]), np.array([0.09, 0.27, 0.33]), n * 0.7 + waves * 0.3)
    spec = np.clip((waves * waves2 - 0.6) * 2.5, 0, 1) ** 2
    col = base + spec[..., None] * np.array([0.22, 0.3, 0.32])
    return np.clip(col, 0, 1)


def world_ground():
    cells = [ground_grass(700 + i) for i in range(4)] + [ground_dirt(710), ground_dirt(711), ground_sand(720),
                                                           ground_grass(730, flowers=60)]
    return np.concatenate(cells, axis=1)


# ---------------------------------------------------------------- v4: large-period dungeon floors (4x4 tiles)

def jitter_voronoi(size, cells, seed):
    """Tileable F1/F2/cell-id using one jittered point per grid cell (fast for big textures)."""
    r = np.random.default_rng(seed)
    pts = r.random((cells, cells, 2))
    cs = size / cells
    yy, xx = np.mgrid[0:size, 0:size].astype(float)
    gx = (xx // cs).astype(int)
    gy = (yy // cs).astype(int)
    best1 = np.full((size, size), 1e9)
    best2 = np.full((size, size), 1e9)
    bid = np.zeros((size, size), dtype=int)
    for oy in (-1, 0, 1):
        for ox in (-1, 0, 1):
            cx = gx + ox
            cy = gy + oy
            px = ((cx % cells) + pts[cy % cells, cx % cells, 0]) * cs + (cx - cx % cells) * cs
            py = ((cy % cells) + pts[cy % cells, cx % cells, 1]) * cs + (cy - cy % cells) * cs
            d = np.hypot(xx - px, yy - py)
            cid = (cy % cells) * cells + (cx % cells)
            closer = d < best1
            best2 = np.where(closer, best1, np.minimum(best2, d))
            bid = np.where(closer, cid, bid)
            best1 = np.where(closer, d, best1)
    return best1 / size, best2 / size, bid


def floor_crypt_big(seed, size=512):
    """Irregular ashlar flagstones that span tile borders, so no grid is visible."""
    r = np.random.default_rng(seed)
    n = fbm(size, size, 8, 5, seed)
    fine = fbm(size, size, 48, 3, seed + 5)
    height = np.zeros((size, size))
    albedo = np.zeros((size, size, 3))
    edge_all = np.zeros((size, size))
    yy, xx = np.mgrid[0:size, 0:size]
    y = 0
    sid = 0
    while y < size:
        h = int(r.integers(56, 104))
        if size - (y + h) < 56:
            h = size - y
        widths = []
        while sum(widths) < size:
            widths.append(int(r.integers(72, 184)))
        widths[-1] -= sum(widths) - size
        if widths[-1] < 30 and len(widths) > 1:
            widths[-2] += widths[-1]
            widths.pop()
        cum = np.concatenate([[0], np.cumsum(widths)])
        off = int(r.integers(0, size))
        rows = slice(y, y + h)
        u = (xx[rows] - off) % size
        idx = np.searchsorted(cum, u, side="right") - 1
        lx = u - cum[idx]
        w = np.array(widths)[idx]
        ly = yy[rows] - y
        e = np.minimum(np.minimum(lx, w - 1 - lx), np.minimum(ly, h - 1 - ly)).astype(float)
        tint = r.uniform(0.86, 1.1, len(widths))[idx]
        warm = r.uniform(-0.015, 0.015, len(widths))[idx]
        tilt_x = r.uniform(-0.5, 0.5, len(widths))[idx]
        tilt_y = r.uniform(-0.5, 0.5, len(widths))[idx]
        bev = np.clip(e / 6.0, 0, 1)
        height[rows] = bev * 0.85 + (tilt_x * (lx / w - 0.5) + tilt_y * (ly / h - 0.5)) * 0.18
        base = np.stack([0.37 + warm, 0.34 + warm * 0.5, 0.31 - warm], axis=-1)
        albedo[rows] = base * tint[..., None]
        edge_all[rows] = e
        y += h
        sid += 1
    height += n * 0.3 + fine * 0.1
    albedo *= (0.75 + 0.5 * n)[..., None]
    albedo = mix(albedo, np.array([0.2, 0.18, 0.15]), np.clip((fine - 0.55) * 3, 0, 0.55))
    grout = edge_all < 2
    albedo[grout] = [0.11, 0.1, 0.09]
    height[grout] = 0
    crack = np.zeros((size, size))
    for _ in range(14):
        x, y = r.uniform(0, size), r.uniform(0, size)
        ang = r.uniform(0, 2 * math.pi)
        for _ in range(r.integers(14, 40)):
            ang += r.normal(0, 0.45)
            x = (x + math.cos(ang) * 2) % size
            y = (y + math.sin(ang) * 2) % size
            crack[int(y), int(x)] = 1
    height -= crack * 0.6
    albedo[crack > 0] *= 0.35
    ao = np.clip(0.5 + np.clip(edge_all / 8.0, 0, 1) * 0.5, 0, 1)
    return shade(height, albedo, 5.0, 0.45, ao)


def floor_cave_big(seed, size=512):
    f1, f2, cell = jitter_voronoi(size, 14, seed)
    n = fbm(size, size, 8, 5, seed + 3)
    edge = np.clip((f2 - f1) * 60, 0, 1)
    r = np.random.default_rng(seed)
    tint = r.uniform(0.75, 1.2, 14 * 14)[cell]
    height = edge ** 0.6 * 0.7 + n * 0.5
    albedo = np.array([0.36, 0.27, 0.18]) * (0.7 + 0.5 * n)[..., None] * tint[..., None]
    dirt = fbm(size, size, 6, 4, seed + 9)
    albedo = mix(albedo, np.array([0.22, 0.17, 0.11]), np.clip((dirt - 0.5) * 2.5, 0, 0.8) * (1 - edge * 0.5))
    moss = fbm(size, size, 10, 4, seed + 21)
    albedo = mix(albedo, np.array([0.17, 0.27, 0.10]), np.clip((moss - 0.62) * 4, 0, 0.7))
    return shade(height, albedo, 6.0, 0.45, 0.6 + 0.4 * edge)


def floor_hell_big(seed, size=512):
    f1, f2, cell = jitter_voronoi(size, 11, seed)
    n = fbm(size, size, 8, 5, seed + 7)
    gap = f2 - f1
    edge = np.clip(gap * 64, 0, 1)
    height = edge ** 0.5 * 0.8 + n * 0.3
    albedo = np.array([0.17, 0.10, 0.10]) * (0.6 + 0.6 * n)[..., None]
    lit = shade(height, albedo, 6.0, 0.45, 0.5 + 0.5 * edge)
    lava = np.clip(1 - gap * 120, 0, 1) ** 1.5
    glow = mix(np.array([0.9, 0.18, 0.02]), np.array([1.0, 0.75, 0.25]), lava)
    return np.clip(lit * (1 - lava[..., None]) + glow * lava[..., None] * (0.7 + 0.5 * n[..., None]), 0, 1)


BIG_FLOORS = {"crypt": floor_crypt_big, "cave": floor_cave_big, "hell": floor_hell_big}
DARK_TOPS = {"crypt": [0.15, 0.14, 0.13], "cave": [0.16, 0.12, 0.09], "hell": [0.13, 0.06, 0.05]}
