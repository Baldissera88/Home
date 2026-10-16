"""High-detail, tileable overworld terrain materials and ground clutter.

Every material is a 512x512 texture covering 4x4 tiles plus a height map. The game bakes
terrain chunks from these at runtime, blending neighbouring materials by height so grass
blades poke over paths and pebbles stand out of sand.
"""
import math

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

from textures import fbm, value_noise

SIZE = 512
SS = 2  # supersampling for stroke-drawn materials
LIGHT2 = np.array([-0.6, -0.55])  # light comes from the upper left (image space)
LIGHT2 = LIGHT2 / np.linalg.norm(LIGHT2)


# ---------------------------------------------------------------- shared helpers

def _wrap_blur(a, radius):
    """Gaussian blur that wraps around the edges (keeps textures tileable), via FFT."""
    h, w = a.shape[:2]
    fy = np.fft.fftfreq(h)[:, None]
    fx = np.fft.fftfreq(w)[None, :]
    g = np.exp(-2 * (math.pi * radius) ** 2 * (fx ** 2 + fy ** 2))
    if a.ndim == 2:
        return np.real(np.fft.ifft2(np.fft.fft2(a) * g))
    return np.stack([np.real(np.fft.ifft2(np.fft.fft2(a[..., c]) * g)) for c in range(a.shape[2])], -1)


def _down(img_arr):
    """Box-downsample a supersampled array by SS."""
    h, w = img_arr.shape[:2]
    return img_arr.reshape(h // SS, SS, w // SS, SS, *img_arr.shape[2:]).mean(axis=(1, 3))


def light_up(albedo, height, bump=3.0, ao_radius=3.0, ao_strength=1.6, shadow=0.9, shadow_len=10, ambient=0.48):
    """Directional light, cavity AO and short cast shadows from a height field (all wrap-around)."""
    gx = (np.roll(height, -1, axis=1) - np.roll(height, 1, axis=1)) * bump
    gy = (np.roll(height, -1, axis=0) - np.roll(height, 1, axis=0)) * bump
    n = np.stack([-gx, -gy, np.ones_like(height)], axis=-1)
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    L = np.array([LIGHT2[0] * 0.75, LIGHT2[1] * 0.75, 0.66])
    L /= np.linalg.norm(L)
    diff = np.clip(n @ L, 0, 1)
    cav = np.clip(1.0 - (_wrap_blur(height, ao_radius) - height) * ao_strength, 0.35, 1.0)
    # Height-field shadows: a texel is shadowed if something towards the light stands taller than the ray.
    occ = np.zeros_like(height)
    for k in range(1, shadow_len + 1):
        sx = int(round(-LIGHT2[0] * k))
        sy = int(round(-LIGHT2[1] * k))
        h_k = np.roll(np.roll(height, sy, axis=0), sx, axis=1)
        occ = np.maximum(occ, h_k - height - k * 0.018)
    sh = 1.0 - np.clip(occ * 6.0, 0, 1) * shadow
    light = (ambient + (1 - ambient) * 1.3 * diff * (0.35 + 0.65 * sh)) * cav
    return np.clip(albedo * light[..., None], 0, 1)


def _palette(t, stops):
    """Piecewise-linear colour ramp; t in [0,1], stops = [(pos, (r,g,b)), ...]."""
    t = np.clip(t, 0, 1)
    out = np.zeros(t.shape + (3,))
    for (p0, c0), (p1, c1) in zip(stops, stops[1:]):
        m = (t >= p0) & (t <= p1)
        k = ((t - p0) / max(p1 - p0, 1e-6))[m][:, None]
        out[m] = np.array(c0) * (1 - k) + np.array(c1) * k
    return out


class Canvas:
    """Supersampled RGB + height canvas for drawing strokes that wrap around the edges."""

    def __init__(self, base_rgb, base_h):
        n = SIZE * SS
        self.n = n
        self.rgb = Image.fromarray((np.clip(np.repeat(np.repeat(base_rgb, SS, 0), SS, 1), 0, 1) * 255).astype(np.uint8))
        self.h = Image.fromarray((np.clip(np.repeat(np.repeat(base_h, SS, 0), SS, 1), 0, 1) * 255).astype(np.uint8), "L")
        self.d_rgb = ImageDraw.Draw(self.rgb)
        self.d_h = ImageDraw.Draw(self.h)

    def poly(self, pts, color, hval):
        pts = np.asarray(pts, dtype=np.float64)
        minx, miny = pts.min(0)
        maxx, maxy = pts.max(0)
        offs_x = [0] + ([self.n] if minx < 0 else []) + ([-self.n] if maxx >= self.n else [])
        offs_y = [0] + ([self.n] if miny < 0 else []) + ([-self.n] if maxy >= self.n else [])
        col = tuple(int(np.clip(c, 0, 1) * 255) for c in color)
        hv = int(np.clip(hval, 0, 1) * 255)
        for ox in offs_x:
            for oy in offs_y:
                q = [(x + ox, y + oy) for x, y in pts]
                self.d_rgb.polygon(q, fill=col)
                if hv >= 0:
                    self.d_h.polygon(q, fill=hv)

    def ellipse(self, cx, cy, rx, ry, angle, color, hval, segs=10):
        a = np.linspace(0, 2 * math.pi, segs, endpoint=False)
        ca, sa = math.cos(angle), math.sin(angle)
        xs = np.cos(a) * rx
        ys = np.sin(a) * ry
        self.poly(np.stack([cx + xs * ca - ys * sa, cy + xs * sa + ys * ca], 1), color, hval)

    def result(self):
        rgb = np.asarray(self.rgb).astype(np.float32) / 255
        h = np.asarray(self.h).astype(np.float32) / 255
        return _down(rgb), _down(h)


def blade(cv, x, y, length, width, angle, base_col, tip_col, h0, h1, bend=0.0, segs=3):
    """A tapered grass blade from (x, y) towards `angle` (0 = straight up the screen)."""
    pts_l, pts_r, cols, hs = [], [], [], []
    for i in range(segs + 1):
        f = i / segs
        a = angle + bend * f * f
        # Position along a gently curving spine.
        px = x + math.sin(angle) * length * f + math.sin(a) * length * 0.15 * f
        py = y - math.cos(angle) * length * f - math.cos(a) * length * 0.05 * f
        wdt = width * (1 - f) ** 0.8 * 0.5 + 0.15
        nx, ny = math.cos(a), math.sin(a)
        pts_l.append((px - nx * wdt, py - ny * wdt))
        pts_r.append((px + nx * wdt, py + ny * wdt))
    for i in range(segs):
        f = (i + 0.5) / segs
        c = np.array(base_col) * (1 - f) + np.array(tip_col) * f
        q = [pts_l[i], pts_l[i + 1], pts_r[i + 1], pts_r[i]]
        cv.poly(q, c, h0 + (h1 - h0) * f)


def _grass_field(seed, palette_lo, palette_hi, soil, density, len_range, dry=0.0, tufts=0.0):
    r = np.random.default_rng(seed)
    n = SIZE * SS
    clump = fbm(SIZE, SIZE, 6, 4, seed + 1)
    tone = fbm(SIZE, SIZE, 3, 4, seed + 2)
    soil_rgb = _palette(fbm(SIZE, SIZE, 16, 3, seed + 3), [(0, soil[0]), (1, soil[1])])
    cv = Canvas(soil_rgb, fbm(SIZE, SIZE, 16, 2, seed + 4) * 0.15)
    count = int(density * SIZE * SIZE / 64)
    xs = r.random(count) * n
    ys = r.random(count) * n
    order = np.argsort(ys)  # draw back to front so nearer blades overlap
    for i in order:
        x, y = xs[i], ys[i]
        ci = clump[int(y / SS) % SIZE, int(x / SS) % SIZE]
        if r.random() > 0.35 + ci * 0.9:
            continue
        ti = tone[int(y / SS) % SIZE, int(x / SS) % SIZE]
        length = r.uniform(*len_range) * SS * (0.7 + ci * 0.6)
        width = r.uniform(1.6, 2.8) * SS
        angle = r.normal(0, 0.45)
        shade_k = r.random()
        lo = np.array(palette_lo[0]) * (1 - ti) + np.array(palette_lo[1]) * ti
        hi = np.array(palette_hi[0]) * (1 - ti) + np.array(palette_hi[1]) * ti
        jitter = 0.85 + 0.3 * shade_k
        if dry and r.random() < dry:
            lo = lo * 0.6 + np.array([0.42, 0.37, 0.2]) * 0.4
            hi = hi * 0.5 + np.array([0.66, 0.6, 0.38]) * 0.5
        blade(cv, x, y, length, width, angle, lo * jitter, hi * jitter, 0.25 + ci * 0.15, 0.55 + ci * 0.4 + r.random() * 0.1,
              bend=r.normal(0, 0.5))
    return cv


# ---------------------------------------------------------------- materials

def grass_lush(seed=1):
    cv = _grass_field(
        seed,
        palette_lo=[(0.15, 0.27, 0.08), (0.21, 0.33, 0.09)],
        palette_hi=[(0.44, 0.62, 0.20), (0.60, 0.68, 0.27)],
        soil=[(0.16, 0.15, 0.08), (0.24, 0.22, 0.12)],
        density=5.5, len_range=(7, 14), dry=0.05,
    )
    r = np.random.default_rng(seed + 9)
    # Clover and tiny leaves in a few patches.
    patch = fbm(SIZE, SIZE, 5, 3, seed + 11)
    for _ in range(900):
        x, y = r.random() * SIZE * SS, r.random() * SIZE * SS
        if patch[int(y / SS) % SIZE, int(x / SS) % SIZE] < 0.62:
            continue
        for k in range(3):
            a = k * 2.1 + r.random()
            col = np.array([0.26, 0.42, 0.15]) * r.uniform(0.85, 1.1)
            cv.ellipse(x + math.cos(a) * 2.2 * SS, y + math.sin(a) * 2.2 * SS, 2.2 * SS, 1.7 * SS, a, col, 0.6)
    rgb, h = cv.result()
    out = light_up(rgb, h, bump=4.0, ao_radius=2.0, ao_strength=2.0, shadow_len=7)
    return _macro(out, seed, 0.06), h


def grass_dry(seed=2):
    cv = _grass_field(
        seed,
        palette_lo=[(0.26, 0.29, 0.11), (0.33, 0.30, 0.13)],
        palette_hi=[(0.64, 0.64, 0.32), (0.76, 0.68, 0.40)],
        soil=[(0.36, 0.31, 0.19), (0.46, 0.39, 0.25)],
        density=7.0, len_range=(8, 15), dry=0.35,
    )
    rgb, h = cv.result()
    out = light_up(rgb, h, bump=4.0, ao_radius=2.0, ao_strength=2.0, shadow_len=8)
    return _macro(out, seed, 0.07), h


def forest_floor(seed=3):
    r = np.random.default_rng(seed)
    n = SIZE * SS
    soil = _palette(fbm(SIZE, SIZE, 8, 5, seed), [(0, (0.10, 0.07, 0.04)), (0.6, (0.20, 0.14, 0.08)), (1, (0.27, 0.20, 0.12))])
    moss = fbm(SIZE, SIZE, 5, 4, seed + 1)
    soil = soil * (1 - np.clip((moss - 0.58) * 4, 0, 1)[..., None] * 0.7) + \
        np.clip((moss - 0.58) * 4, 0, 1)[..., None] * 0.7 * np.array([0.16, 0.26, 0.07])
    cv = Canvas(soil, fbm(SIZE, SIZE, 24, 3, seed + 2) * 0.2 + np.clip((moss - 0.58) * 2, 0, 0.3))
    leaf_cols = [(0.34, 0.20, 0.09), (0.42, 0.27, 0.11), (0.30, 0.25, 0.12), (0.47, 0.33, 0.14), (0.24, 0.15, 0.08), (0.26, 0.29, 0.11)]
    litter = fbm(SIZE, SIZE, 6, 3, seed + 5)
    items = []
    for _ in range(6000):
        x, y = r.random() * n, r.random() * n
        if r.random() < litter[int(y / SS) % SIZE, int(x / SS) % SIZE] * 1.4 - 0.2:
            items.append(("leaf", x, y))
    for _ in range(3200):
        items.append(("needle", r.random() * n, r.random() * n))
    for _ in range(90):
        items.append(("twig", r.random() * n, r.random() * n))
    for _ in range(140):
        items.append(("stone", r.random() * n, r.random() * n))
    r.shuffle(items)
    for kind, x, y in items:
        if kind == "leaf":
            a = r.random() * math.pi * 2
            s = r.uniform(3, 6) * SS
            col = np.array(leaf_cols[r.integers(0, len(leaf_cols))]) * r.uniform(0.75, 1.1)
            hv = r.uniform(0.4, 0.75)
            cv.ellipse(x, y, s, s * 0.45, a, col, hv, segs=12)
            # Midrib.
            cv.poly([(x - math.cos(a) * s * 0.8, y - math.sin(a) * s * 0.8), (x + math.cos(a) * s * 0.8, y + math.sin(a) * s * 0.8),
                     (x + math.cos(a) * s * 0.8 + 0.6, y + math.sin(a) * s * 0.8 + 0.6)], col * 0.6, hv + 0.02)
        elif kind == "needle":
            a = r.random() * math.pi * 2
            s = r.uniform(5, 10) * SS
            col = np.array((0.36, 0.24, 0.12)) * r.uniform(0.6, 1.2)
            cv.poly([(x, y), (x + math.cos(a) * s, y + math.sin(a) * s), (x + math.cos(a) * s + 1.2, y + math.sin(a) * s + 1.2), (x + 1.2, y + 1.2)],
                    col, r.uniform(0.35, 0.5))
        elif kind == "twig":
            a = r.random() * math.pi * 2
            s = r.uniform(18, 40) * SS
            col = np.array((0.22, 0.15, 0.09)) * r.uniform(0.8, 1.2)
            w = r.uniform(1.4, 2.4) * SS
            px, py = x, y
            for seg in range(4):
                a += r.normal(0, 0.25)
                qx, qy = px + math.cos(a) * s / 4, py + math.sin(a) * s / 4
                nx, ny = -math.sin(a) * w / 2, math.cos(a) * w / 2
                cv.poly([(px + nx, py + ny), (qx + nx, qy + ny), (qx - nx, qy - ny), (px - nx, py - ny)], col, 0.7)
                px, py = qx, qy
        else:
            s = r.uniform(3, 6) * SS
            col = np.array((0.30, 0.29, 0.25)) * r.uniform(0.7, 1.1)
            cv.ellipse(x, y, s, s * r.uniform(0.6, 0.9), r.random() * 3, col, 0.85, segs=9)
    rgb, h = cv.result()
    out = light_up(rgb, h, bump=5.0, ao_radius=2.5, ao_strength=2.2, shadow_len=8)
    return _macro(out, seed, 0.08), h


def _pebbles(cv, r, count, size_range, tint, hbase=0.7, mask=None):
    n = SIZE * SS
    for _ in range(count):
        x, y = r.random() * n, r.random() * n
        if mask is not None and r.random() > mask[int(y / SS) % SIZE, int(x / SS) % SIZE]:
            continue
        s = r.uniform(*size_range) * SS
        col = np.array(tint) * r.uniform(0.75, 1.15) * np.array([r.uniform(0.95, 1.06), 1, r.uniform(0.92, 1.06)])
        a = r.random() * 3
        asp = r.uniform(0.55, 0.9)
        k = r.integers(6, 10)
        ang = np.linspace(0, 2 * math.pi, k, endpoint=False) + r.uniform(-0.25, 0.25, k)
        rad = s * r.uniform(0.75, 1.15, k)
        px = np.cos(ang) * rad
        py = np.sin(ang) * rad * asp
        ca, sa = math.cos(a), math.sin(a)
        pts = np.stack([x + px * ca - py * sa, y + px * sa + py * ca], 1)
        cv.poly(pts + np.array([s * 0.3, s * 0.35]), col * 0.72, hbase * 0.45)  # soft contact shadow
        cv.poly(pts, col, hbase * r.uniform(0.85, 1.1))


def dirt_path(seed=4):
    r = np.random.default_rng(seed)
    big = fbm(SIZE, SIZE, 4, 5, seed)
    fine = fbm(SIZE, SIZE, 48, 2, seed + 1)
    albedo = _palette(big * 0.8 + fine * 0.2, [(0, (0.26, 0.19, 0.12)), (0.45, (0.38, 0.29, 0.18)), (0.75, (0.47, 0.37, 0.24)), (1, (0.55, 0.45, 0.30))])
    # Hairline cracks in the dry crust.
    crack = fbm(SIZE, SIZE, 10, 4, seed + 7)
    lines = np.exp(-((crack - 0.5) ** 2) / 0.0004) * np.clip((fbm(SIZE, SIZE, 3, 2, seed + 8) - 0.45) * 4, 0, 1)
    albedo *= (1 - lines * 0.3)[..., None]
    height = big * 0.25 + fine * 0.12 - lines * 0.08
    cv = Canvas(albedo, height)
    _pebbles(cv, r, 700, (0.9, 1.8), (0.50, 0.43, 0.33), 0.45)
    _pebbles(cv, r, 110, (2.2, 4.2), (0.52, 0.47, 0.40), 0.6, mask=fbm(SIZE, SIZE, 4, 2, seed + 9))
    rgb, h = cv.result()
    out = light_up(rgb, h, bump=5.0, ao_radius=2.0, ao_strength=2.0, shadow_len=6)
    return _macro(out, seed, 0.06), h


def sand(seed=5):
    r = np.random.default_rng(seed)
    big = fbm(SIZE, SIZE, 4, 4, seed)
    yy, xx = np.mgrid[0:SIZE, 0:SIZE].astype(np.float64)
    warp = fbm(SIZE, SIZE, 3, 3, seed + 2)
    # Integer wave numbers keep the ripples tileable.
    ripple = np.sin((yy * 13 + xx * 4) / SIZE * 2 * math.pi + warp * 9) * 0.5 + 0.5
    ripple = ripple ** 1.6
    grain = np.random.default_rng(seed + 3).random((SIZE, SIZE))
    albedo = _palette(big * 0.7 + ripple * 0.2 + grain * 0.1, [(0, (0.55, 0.47, 0.32)), (0.5, (0.69, 0.60, 0.42)), (1, (0.80, 0.72, 0.54))])
    height = ripple * 0.18 + big * 0.1 + grain * 0.04
    cv = Canvas(albedo, height)
    _pebbles(cv, r, 140, (0.9, 2.0), (0.64, 0.58, 0.50), 0.4)
    for _ in range(40):  # little shells
        x, y = r.random() * SIZE * SS, r.random() * SIZE * SS
        cv.ellipse(x, y, 2.6 * SS, 2.0 * SS, r.random() * 3, np.array((0.92, 0.86, 0.78)) * r.uniform(0.85, 1.05), 0.5)
    rgb, h = cv.result()
    out = light_up(rgb, h, bump=3.0, ao_radius=1.5, ao_strength=1.2, shadow_len=4, ambient=0.55)
    return _macro(out, seed, 0.05), h


def cobbles(seed=6):
    """Rounded cobblestones in packed dirt with grass in the joints."""
    r = np.random.default_rng(seed)
    n = SIZE
    cells = 22  # cobbles per texture side (5.5 per tile)
    pts = (np.stack(np.meshgrid(np.arange(cells), np.arange(cells)), -1).reshape(-1, 2) + 0.5 + r.uniform(-0.3, 0.3, (cells * cells, 2))) / cells
    yy, xx = np.mgrid[0:n, 0:n]
    uv = np.stack([(xx + 0.5) / n, (yy + 0.5) / n], -1)
    best = np.full((n, n), 9.0)
    second = np.full((n, n), 9.0)
    cid = np.zeros((n, n), dtype=int)
    for i, p in enumerate(pts):
        for ox in (-1, 0, 1):
            for oy in (-1, 0, 1):
                d = np.linalg.norm(uv - (p + np.array([ox, oy])), axis=-1)
                closer = d < best
                second = np.where(closer, best, np.minimum(second, d))
                cid = np.where(closer, i, cid)
                best = np.where(closer, d, best)
    edge = (second - best) * cells  # 0 at the joint
    dome = np.clip(edge / 0.45, 0, 1)
    dome = np.sqrt(dome) * (1 - 0.15 * fbm(n, n, 24, 2, seed + 1))
    stone_tint = r.uniform(0.82, 1.1, len(pts))[cid]
    stone_hue = r.uniform(-0.04, 0.04, len(pts))[cid]
    base = np.stack([0.47 + stone_hue, np.full_like(stone_hue, 0.44), 0.40 - stone_hue], -1) * stone_tint[..., None]
    wear = fbm(n, n, 20, 3, seed + 2)
    base = base * (0.85 + 0.3 * wear[..., None])
    joint = np.clip(1 - edge / 0.08, 0, 1) ** 1.5
    speck = np.random.default_rng(seed + 5).random((n, n))
    base = base * (0.93 + 0.14 * speck[..., None])
    dirt = _palette(fbm(n, n, 30, 2, seed + 3), [(0, (0.22, 0.18, 0.12)), (1, (0.34, 0.28, 0.19))])
    mossy = np.clip((fbm(n, n, 6, 3, seed + 4) - 0.5) * 3, 0, 1)
    dirt = dirt * (1 - mossy[..., None] * 0.6) + mossy[..., None] * 0.6 * np.array([0.18, 0.30, 0.09])
    albedo = base * (1 - joint[..., None]) + dirt * joint[..., None]
    height = dome * 0.7 * (1 - joint) + joint * 0.1
    cv = Canvas(albedo, height)
    # Tufts of grass in some joints.
    for _ in range(900):
        x, y = r.random() * n, r.random() * n
        if joint[int(y) % n, int(x) % n] < 0.5 or mossy[int(y) % n, int(x) % n] < 0.25:
            continue
        blade(cv, x * SS, y * SS, r.uniform(5, 10) * SS, 2 * SS, r.normal(0, 0.5), (0.12, 0.22, 0.06), (0.35, 0.48, 0.16), 0.2, 0.75)
    rgb, h = cv.result()
    out = light_up(rgb, h, bump=6.0, ao_radius=3.0, ao_strength=1.8, shadow_len=8, ambient=0.45)
    return _macro(out, seed, 0.05), h


def mud(seed=7):
    """Dark wet earth with puddles; used along lake shores."""
    big = fbm(SIZE, SIZE, 5, 5, seed)
    fine = fbm(SIZE, SIZE, 40, 2, seed + 1)
    albedo = _palette(big * 0.8 + fine * 0.2, [(0, (0.12, 0.10, 0.07)), (0.6, (0.22, 0.18, 0.12)), (1, (0.30, 0.25, 0.17))])
    pf = fbm(SIZE, SIZE, 6, 4, seed + 2)
    puddle = np.clip((pf - 0.66) * 14, 0, 1)
    rim = np.clip(1 - np.abs(pf - 0.64) * 30, 0, 1)
    sky = np.array([0.17, 0.20, 0.22])
    albedo = albedo * (1 - rim[..., None] * 0.35)
    albedo = albedo * (1 - puddle[..., None] * 0.85) + sky * puddle[..., None] * 0.85
    height = (big * 0.3 + fine * 0.1) * (1 - puddle) + puddle * 0.08
    r = np.random.default_rng(seed)
    cv = Canvas(albedo, height)
    _pebbles(cv, r, 160, (0.9, 2.2), (0.36, 0.32, 0.26), 0.45, mask=1 - puddle)
    rgb, h = cv.result()
    out = light_up(rgb, h, bump=4.0, ao_radius=2.0, ao_strength=1.6, shadow_len=5)
    # Glossy glints on wet patches.
    gl = np.clip((fbm(SIZE, SIZE, 30, 2, seed + 5) - 0.6) * 5, 0, 1) * (0.3 + puddle * 0.7)
    out = np.clip(out + gl[..., None] * 0.12, 0, 1)
    return _macro(out, seed, 0.05), h


def _macro(rgb, seed, amount):
    """Gentle large-scale tonal variation inside one texture."""
    m = fbm(SIZE, SIZE, 2, 3, seed + 99)
    return np.clip(rgb * (1 + (m[..., None] - 0.5) * 2 * amount), 0, 1)


MATERIALS = [
    ("grass_lush", grass_lush),
    ("grass_dry", grass_dry),
    ("forest", forest_floor),
    ("dirt", dirt_path),
    ("sand", sand),
    ("cobbles", cobbles),
    ("mud", mud),
]


# ---------------------------------------------------------------- clutter

CLUTTER_CELL = 64


class Sprite:
    """Supersampled RGBA canvas for clutter sprites, with a baked soft shadow."""

    def __init__(self):
        self.n = CLUTTER_CELL * 4
        self.img = Image.new("RGBA", (self.n, self.n), (0, 0, 0, 0))
        self.shadow = Image.new("L", (self.n, self.n), 0)
        self.d = ImageDraw.Draw(self.img)
        self.ds = ImageDraw.Draw(self.shadow)

    def poly(self, pts, color, shadow=True, sh_off=(5, 4)):
        q = [(float(x), float(y)) for x, y in pts]
        col = tuple(int(np.clip(c, 0, 1) * 255) for c in color[:3]) + (255,)
        self.d.polygon(q, fill=col)
        if shadow:
            self.ds.polygon([(x + sh_off[0], y + sh_off[1]) for x, y in q], fill=255)

    def ellipse(self, cx, cy, rx, ry, angle, color, shadow=True, segs=14, sh_off=(5, 4)):
        a = np.linspace(0, 2 * math.pi, segs, endpoint=False)
        ca, sa = math.cos(angle), math.sin(angle)
        xs, ys = np.cos(a) * rx, np.sin(a) * ry
        self.poly(list(zip(cx + xs * ca - ys * sa, cy + xs * sa + ys * ca)), color, shadow, sh_off)

    def blade(self, x, y, length, width, angle, base, tip, bend=0.0, shadow=True):
        segs = 4
        pl, pr = [], []
        for i in range(segs + 1):
            f = i / segs
            a = angle + bend * f * f
            px = x + math.sin(a) * length * f
            py = y - math.cos(a) * length * f
            w = width * (1 - f) ** 0.8 * 0.5 + 0.4
            pl.append((px - math.cos(a) * w, py - math.sin(a) * w))
            pr.append((px + math.cos(a) * w, py + math.sin(a) * w))
        for i in range(segs):
            f = (i + 0.5) / segs
            c = np.array(base) * (1 - f) + np.array(tip) * f
            self.poly([pl[i], pl[i + 1], pr[i + 1], pr[i]], c, shadow, sh_off=(length * 0.25 * f + 3, 3))

    def result(self):
        sh = np.asarray(self.shadow.filter(ImageFilter.GaussianBlur(5))).astype(np.float32) / 255 * 0.45
        img = np.asarray(self.img).astype(np.float32) / 255
        a = img[..., 3]
        out_a = a + sh * (1 - a)
        out_rgb = (img[..., :3] * a[..., None]) / np.maximum(out_a[..., None], 1e-4)
        out = np.concatenate([out_rgb, out_a[..., None]], -1)
        # Premultiplied downsample.
        pm = out.copy()
        pm[..., :3] *= pm[..., 3:4]
        k = 4
        pm = pm.reshape(CLUTTER_CELL, k, CLUTTER_CELL, k, 4).mean(axis=(1, 3))
        a2 = pm[..., 3:4]
        pm[..., :3] = np.where(a2 > 1e-4, pm[..., :3] / np.maximum(a2, 1e-4), 0)
        return (np.clip(pm, 0, 1) * 255 + 0.5).astype(np.uint8)


def clutter_tuft(seed, dry=False, tall=1.0):
    r = np.random.default_rng(seed)
    s = Sprite()
    c = s.n / 2
    base = (0.10, 0.20, 0.05) if not dry else (0.30, 0.28, 0.12)
    tips = [(0.40, 0.56, 0.18), (0.50, 0.60, 0.22), (0.32, 0.48, 0.14)] if not dry else [(0.72, 0.66, 0.40), (0.62, 0.58, 0.32)]
    for i in range(int(40 * tall)):
        a = r.normal(0, 0.55)
        x = c + r.normal(0, 14)
        y = c + 40 + r.normal(0, 7)
        s.blade(x, y, r.uniform(40, 85) * tall, r.uniform(5, 8), a, base, tips[r.integers(0, len(tips))], bend=r.normal(0, 0.5))
    return s.result()


def clutter_flowers(seed, petal, centre=(0.95, 0.78, 0.2), count=5):
    r = np.random.default_rng(seed)
    s = Sprite()
    c = s.n / 2
    for i in range(18):
        s.blade(c + r.normal(0, 16), c + 44 + r.normal(0, 6), r.uniform(25, 50), 6, r.normal(0, 0.6), (0.12, 0.22, 0.06), (0.32, 0.48, 0.15))
    for i in range(count):
        x = c + r.normal(0, 20)
        y = c + r.normal(0, 14) - 6
        rad = r.uniform(9, 13)
        for k in range(6):
            a = k / 6 * math.pi * 2 + r.random() * 0.3
            col = np.array(petal) * r.uniform(0.9, 1.05)
            s.ellipse(x + math.cos(a) * rad * 0.7, y + math.sin(a) * rad * 0.55, rad * 0.55, rad * 0.32, a, col)
        s.ellipse(x, y, rad * 0.33, rad * 0.3, 0, centre)
    return s.result()


def clutter_pebbles(seed, tint=(0.48, 0.45, 0.41)):
    r = np.random.default_rng(seed)
    s = Sprite()
    c = s.n / 2
    for i in range(r.integers(3, 6)):
        x = c + r.normal(0, 24)
        y = c + r.normal(0, 16)
        rad = r.uniform(10, 22)
        col = np.array(tint) * r.uniform(0.75, 1.15)
        a = r.random() * 3
        s.ellipse(x, y, rad, rad * 0.7, a, col * 0.82, sh_off=(8, 7))
        s.ellipse(x - rad * 0.12, y - rad * 0.18, rad * 0.85, rad * 0.5, a, col, shadow=False)
        s.ellipse(x - rad * 0.35, y - rad * 0.3, rad * 0.35, rad * 0.2, a, np.minimum(col * 1.35, 1), shadow=False)
    return s.result()


def clutter_leaves(seed):
    r = np.random.default_rng(seed)
    s = Sprite()
    c = s.n / 2
    cols = [(0.62, 0.30, 0.08), (0.75, 0.48, 0.12), (0.45, 0.20, 0.07), (0.55, 0.42, 0.12)]
    for i in range(12):
        x = c + r.normal(0, 28)
        y = c + r.normal(0, 20)
        a = r.random() * 6.28
        col = np.array(cols[r.integers(0, 4)]) * r.uniform(0.85, 1.1)
        s.ellipse(x, y, 16, 8, a, col, sh_off=(3, 3))
        s.poly([(x - math.cos(a) * 14, y - math.sin(a) * 14), (x + math.cos(a) * 14, y + math.sin(a) * 14),
                (x + math.cos(a) * 14 + 1.5, y + math.sin(a) * 14 + 1.5)], col * 0.6, shadow=False)
    return s.result()


def clutter_mushrooms(seed, cap=(0.70, 0.12, 0.08), dots=True):
    r = np.random.default_rng(seed)
    s = Sprite()
    c = s.n / 2
    for i in range(r.integers(2, 5)):
        x = c + r.normal(0, 20)
        y = c + 20 + r.normal(0, 10)
        h = r.uniform(18, 34)
        rad = r.uniform(12, 20)
        s.poly([(x - 4, y), (x + 4, y), (x + 3, y - h), (x - 3, y - h)], (0.85, 0.80, 0.70), sh_off=(10, 6))
        s.ellipse(x, y - h, rad, rad * 0.62, 0, np.array(cap) * 0.75, sh_off=(12, 8))
        s.ellipse(x - rad * 0.12, y - h - rad * 0.12, rad * 0.86, rad * 0.48, 0, cap, shadow=False)
        if dots:
            for k in range(4):
                s.ellipse(x + r.normal(0, rad * 0.4), y - h - rad * 0.15 + r.normal(0, rad * 0.2), 2.5, 2, 0, (0.95, 0.92, 0.85), shadow=False)
    return s.result()


def clutter_fern(seed):
    r = np.random.default_rng(seed)
    s = Sprite()
    c = s.n / 2
    for f in range(6):
        a = f / 6 * math.pi * 2 + r.random() * 0.4
        length = r.uniform(70, 100)
        for k in range(14):
            t = k / 14
            px = c + math.cos(a) * length * t
            py = c + 10 + math.sin(a) * length * t * 0.65
            lw = (1 - t) * 18 + 4
            col = np.array((0.16, 0.36, 0.10)) * (0.8 + 0.5 * t) * r.uniform(0.9, 1.1)
            for side in (-1, 1):
                b = a + side * 1.2
                s.ellipse(px + math.cos(b) * lw * 0.6, py + math.sin(b) * lw * 0.4, lw * 0.6, 3.5, b, col, sh_off=(6, 6))
    return s.result()


def clutter_twigs(seed):
    r = np.random.default_rng(seed)
    s = Sprite()
    c = s.n / 2
    for i in range(3):
        a = r.random() * 6.28
        x, y = c + r.normal(0, 14) - math.cos(a) * 40, c + r.normal(0, 10) - math.sin(a) * 40
        w = r.uniform(4, 7)
        for seg in range(5):
            a += r.normal(0, 0.3)
            qx, qy = x + math.cos(a) * 16, y + math.sin(a) * 16
            nx, ny = -math.sin(a) * w / 2, math.cos(a) * w / 2
            col = np.array((0.30, 0.20, 0.12)) * r.uniform(0.85, 1.1)
            s.poly([(x + nx, y + ny), (qx + nx, qy + ny), (qx - nx, qy - ny), (x - nx, y - ny)], col, sh_off=(4, 4))
            s.poly([(x + nx * 0.2, y + ny * 0.2 - 1), (qx + nx * 0.2, qy + ny * 0.2 - 1), (qx - nx * 0.4, qy - ny * 0.4), (x - nx * 0.4, y - ny * 0.4)],
                   np.minimum(col * 1.5, 1), shadow=False)
            x, y = qx, qy
    return s.result()


def clutter_reeds(seed):
    r = np.random.default_rng(seed)
    s = Sprite()
    c = s.n / 2
    for i in range(26):
        x = c + r.normal(0, 18)
        y = c + 60 + r.normal(0, 6)
        s.blade(x, y, r.uniform(90, 125), r.uniform(5, 7), r.normal(0, 0.25), (0.16, 0.24, 0.08), (0.48, 0.52, 0.24), bend=r.normal(0, 0.3))
    for i in range(5):  # cattail heads
        x = c + r.normal(0, 14)
        y = c + 60 - r.uniform(80, 110)
        s.ellipse(x, y, 4, 13, 0, (0.30, 0.18, 0.08))
    return s.result()


CLUTTER = [
    ("tuft", lambda: clutter_tuft(1)),
    ("tuft2", lambda: clutter_tuft(2, tall=0.8)),
    ("tuft_dry", lambda: clutter_tuft(3, dry=True)),
    ("daisies", lambda: clutter_flowers(4, (0.96, 0.95, 0.92))),
    ("buttercups", lambda: clutter_flowers(5, (0.98, 0.82, 0.15), centre=(0.9, 0.6, 0.1))),
    ("bluebells", lambda: clutter_flowers(6, (0.45, 0.42, 0.88), centre=(0.95, 0.9, 0.6))),
    ("poppies", lambda: clutter_flowers(7, (0.86, 0.12, 0.08), centre=(0.1, 0.08, 0.06), count=4)),
    ("pebbles", lambda: clutter_pebbles(8)),
    ("pebbles_sand", lambda: clutter_pebbles(9, (0.62, 0.58, 0.52))),
    ("leaves", lambda: clutter_leaves(10)),
    ("mushrooms", lambda: clutter_mushrooms(11)),
    ("mushrooms_brown", lambda: clutter_mushrooms(12, (0.45, 0.30, 0.16), dots=False)),
    ("fern", lambda: clutter_fern(13)),
    ("twigs", lambda: clutter_twigs(14)),
    ("reeds", lambda: clutter_reeds(15)),
    ("tuft3", lambda: clutter_tuft(16, tall=1.2)),
]


# ---------------------------------------------------------------- dungeon floor sets
# Each biome gets four materials: its main floor, rubble along the walls, loose ground and a damp/exotic patch.


def _from_texture(rgb, blur=1.5):
    """Height for an existing pre-lit floor texture: its blurred luminance."""
    lum = rgb @ np.array([0.3, 0.55, 0.15])
    h = _wrap_blur(lum, blur)
    return (h - h.min()) / max(h.max() - h.min(), 1e-6)


def _angular_stones(cv, r, count, size_range, tint, hbase=0.7, mask=None):
    """Broken, angular chunks of stone (fewer vertices than pebbles)."""
    n = SIZE * SS
    for _ in range(count):
        x, y = r.random() * n, r.random() * n
        if mask is not None and r.random() > mask[int(y / SS) % SIZE, int(x / SS) % SIZE]:
            continue
        s_ = r.uniform(*size_range) * SS
        k = r.integers(4, 7)
        ang = np.sort(r.uniform(0, 2 * math.pi, k))
        rad = s_ * r.uniform(0.6, 1.2, k)
        pts = np.stack([x + np.cos(ang) * rad, y + np.sin(ang) * rad * 0.8], 1)
        col = np.array(tint) * r.uniform(0.7, 1.15)
        cv.poly(pts + np.array([s_ * 0.3, s_ * 0.35]), col * 0.5, hbase * 0.4)
        cv.poly(pts, col, hbase * r.uniform(0.85, 1.15))


def crypt_rubble(seed=30):
    r = np.random.default_rng(seed)
    base = _palette(fbm(SIZE, SIZE, 8, 4, seed), [(0, (0.17, 0.16, 0.14)), (1, (0.30, 0.28, 0.25))])
    cv = Canvas(base, fbm(SIZE, SIZE, 24, 2, seed + 1) * 0.15)
    _pebbles(cv, r, 900, (0.8, 1.8), (0.36, 0.34, 0.31), 0.35)
    _angular_stones(cv, r, 260, (3, 9), (0.42, 0.40, 0.37), 0.7)
    _angular_stones(cv, r, 40, (10, 18), (0.40, 0.38, 0.35), 0.9)
    rgb, h = cv.result()
    return _macro(light_up(rgb, h, bump=5.0, ao_radius=3.0, ao_strength=2.2, shadow_len=10, ambient=0.42), seed, 0.06), h


def _bone_bits(cv, r, count, scale=1.0):
    n = SIZE * SS
    for _ in range(count):
        x, y = r.random() * n, r.random() * n
        a = r.random() * math.pi
        L = r.uniform(5, 14) * SS * scale
        w = r.uniform(1.4, 2.4) * SS * scale
        col = np.array((0.74, 0.70, 0.60)) * r.uniform(0.75, 1.05)
        dx, dy = math.cos(a) * L / 2, math.sin(a) * L / 2
        nx, ny = -math.sin(a) * w / 2, math.cos(a) * w / 2
        cv.poly([(x - dx + nx, y - dy + ny), (x + dx + nx, y + dy + ny), (x + dx - nx, y + dy - ny), (x - dx - nx, y - dy - ny)], col, 0.6)
        cv.ellipse(x - dx, y - dy, w * 0.9, w * 0.8, a, col, 0.62, segs=8)
        cv.ellipse(x + dx, y + dy, w * 0.9, w * 0.8, a, col, 0.62, segs=8)


def crypt_dirt(seed=31):
    r = np.random.default_rng(seed)
    base = _palette(fbm(SIZE, SIZE, 6, 5, seed), [(0, (0.14, 0.11, 0.08)), (0.6, (0.24, 0.19, 0.13)), (1, (0.31, 0.25, 0.18))])
    cv = Canvas(base, fbm(SIZE, SIZE, 20, 3, seed + 1) * 0.25)
    _pebbles(cv, r, 500, (0.8, 2.0), (0.34, 0.30, 0.25), 0.45)
    _bone_bits(cv, r, 60)
    rgb, h = cv.result()
    return _macro(light_up(rgb, h, bump=4.0, ao_radius=2.0, ao_strength=1.8, shadow_len=6, ambient=0.45), seed, 0.06), h


def crypt_moss(seed=32, flag=None):
    """Damp flagstones taken over by moss, with dark puddles."""
    rgb0 = flag
    moss = fbm(SIZE, SIZE, 7, 4, seed)
    m = np.clip((moss - 0.45) * 3.5, 0, 1)
    tuft = fbm(SIZE, SIZE, 60, 2, seed + 1)
    moss_col = _palette(tuft, [(0, (0.10, 0.17, 0.06)), (1, (0.25, 0.36, 0.11))])
    rgb = rgb0 * (1 - m[..., None] * 0.85) + moss_col * m[..., None] * 0.85
    pud = np.clip((fbm(SIZE, SIZE, 5, 3, seed + 2) - 0.66) * 12, 0, 1)
    rgb = rgb * (1 - pud[..., None] * 0.7) + np.array([0.08, 0.09, 0.10]) * pud[..., None] * 0.7
    h = _from_texture(rgb0) * (1 - m) * 0.6 + (m * 0.5 + tuft * 0.3 * m) - pud * 0.3
    return np.clip(rgb, 0, 1), np.clip(h, 0, 1)


def cave_gravel(seed=40):
    r = np.random.default_rng(seed)
    base = _palette(fbm(SIZE, SIZE, 10, 4, seed), [(0, (0.15, 0.12, 0.09)), (1, (0.27, 0.22, 0.16))])
    cv = Canvas(base, fbm(SIZE, SIZE, 30, 2, seed + 1) * 0.15)
    _pebbles(cv, r, 2600, (0.8, 2.2), (0.40, 0.34, 0.27), 0.5)
    _pebbles(cv, r, 260, (2.5, 5.5), (0.44, 0.38, 0.30), 0.75)
    rgb, h = cv.result()
    return _macro(light_up(rgb, h, bump=5.0, ao_radius=2.0, ao_strength=2.2, shadow_len=7, ambient=0.42), seed, 0.06), h


def cave_mud(seed=41):
    rgb, h = mud(seed)
    return np.clip(rgb * np.array([0.92, 0.9, 0.95]), 0, 1), h


def cave_lichen(seed=42, rock=None):
    lich = fbm(SIZE, SIZE, 8, 4, seed)
    m = np.clip((lich - 0.42) * 3.0, 0, 1)
    spots = fbm(SIZE, SIZE, 70, 2, seed + 1)
    col = _palette(spots, [(0, (0.09, 0.20, 0.17)), (1, (0.22, 0.42, 0.33))])
    rgb = rock * (1 - m[..., None] * 0.8) + col * m[..., None] * 0.8
    glow = (np.random.default_rng(seed).random((SIZE, SIZE)) > 0.9985) * m
    glow = np.clip(_wrap_blur(glow.astype(float), 1.2) * 9, 0, 1)
    rgb = rgb + glow[..., None] * np.array([0.35, 0.95, 0.85])
    h = _from_texture(rock) * 0.7 + m * 0.3
    return np.clip(rgb, 0, 1), np.clip(h, 0, 1)


def hell_ash(seed=50):
    r = np.random.default_rng(seed)
    base = _palette(fbm(SIZE, SIZE, 7, 5, seed), [(0, (0.08, 0.07, 0.07)), (0.6, (0.20, 0.18, 0.17)), (1, (0.32, 0.29, 0.27))])
    cv = Canvas(base, fbm(SIZE, SIZE, 20, 3, seed + 1) * 0.3)
    _pebbles(cv, r, 700, (0.8, 2.0), (0.12, 0.10, 0.10), 0.5)
    rgb, h = cv.result()
    rgb = light_up(rgb, h, bump=3.0, ao_radius=2.0, ao_strength=1.5, shadow_len=5, ambient=0.5)
    ember = (np.random.default_rng(seed + 2).random((SIZE, SIZE)) > 0.996).astype(float)
    ember = np.clip(_wrap_blur(ember, 1.0) * 6, 0, 1)
    rgb = rgb * (1 - ember[..., None]) + ember[..., None] * np.array([1.0, 0.45, 0.08])
    return np.clip(rgb, 0, 1), h


def hell_obsidian(seed=51):
    """Glassy black rock in frozen flows: smooth swells with sharp glints and the red of lava reflected in them."""
    flow = fbm(SIZE, SIZE, 4, 4, seed)
    ridge = 1 - np.abs(fbm(SIZE, SIZE, 4, 3, seed + 1) - 0.5) * 2
    height = flow * 0.8 + ridge ** 6 * 0.35
    albedo = np.ones((SIZE, SIZE, 3)) * np.array([0.05, 0.045, 0.055])
    lit = light_up(albedo, height, bump=9.0, ao_radius=3.0, ao_strength=1.5, shadow_len=6, ambient=0.6)
    gx = np.roll(height, -1, axis=1) - np.roll(height, 1, axis=1)
    gy = np.roll(height, -1, axis=0) - np.roll(height, 1, axis=0)
    glint = np.clip((-gx * 0.6 - gy * 0.55) * 40, 0, 1) ** 3
    red = np.clip((gx * 0.7 + gy * 0.6) * 30, 0, 1) ** 2
    rgb = lit + glint[..., None] * np.array([0.17, 0.17, 0.20]) + red[..., None] * np.array([0.14, 0.025, 0.01])
    return np.clip(rgb, 0, 1), np.clip(height, 0, 1)


def hell_scorched(seed=52):
    big = fbm(SIZE, SIZE, 5, 5, seed)
    fine = fbm(SIZE, SIZE, 40, 2, seed + 1)
    rgb = _palette(big * 0.8 + fine * 0.2, [(0, (0.16, 0.07, 0.05)), (0.6, (0.30, 0.14, 0.09)), (1, (0.40, 0.20, 0.12))])
    crack = fbm(SIZE, SIZE, 12, 4, seed + 2)
    lines = np.exp(-((crack - 0.5) ** 2) / 0.0005)
    rgb *= (1 - lines * 0.75)[..., None]
    h = big * 0.4 + fine * 0.1 - lines * 0.3
    rgb = light_up(rgb, h, bump=5.0, ao_radius=2.0, ao_strength=1.6, shadow_len=5, ambient=0.45)
    rgb += (lines * np.clip((fbm(SIZE, SIZE, 4, 2, seed + 3) - 0.55) * 4, 0, 1))[..., None] * np.array([0.6, 0.15, 0.02])
    return np.clip(rgb, 0, 1), np.clip(h, 0, 1)


def dungeon_sets():
    """{biome: [(rgb, height) x 4]}: main floor, rubble, loose ground, damp or exotic patches."""
    import textures as T
    flag = np.clip(T.floor_crypt_big(100), 0, 1)
    cave = np.clip(T.floor_cave_natural(100), 0, 1)
    hell = np.clip(T.floor_hell_big(100), 0, 1)
    return {
        "crypt": [(flag, _from_texture(flag)), crypt_rubble(), crypt_dirt(), crypt_moss(flag=flag)],
        "cave": [(cave, _from_texture(cave)), cave_gravel(), cave_mud(), cave_lichen(rock=cave)],
        "hell": [(hell, _from_texture(hell)), hell_scorched(), hell_ash(), hell_obsidian()],
    }


def dungeon_clutter_bones(seed):
    r = np.random.default_rng(seed)
    sp = Sprite()
    c = sp.n / 2
    col = (0.80, 0.76, 0.66)
    for _ in range(5):
        x, y = c + r.normal(0, 26), c + r.normal(0, 18)
        a = r.random() * math.pi
        L, w = r.uniform(30, 60), r.uniform(6, 9)
        dx, dy = math.cos(a) * L / 2, math.sin(a) * L / 2
        nx, ny = -math.sin(a) * w / 2, math.cos(a) * w / 2
        sh = np.array(col) * r.uniform(0.8, 1.0)
        sp.poly([(x - dx + nx, y - dy + ny), (x + dx + nx, y + dy + ny), (x + dx - nx, y + dy - ny), (x - dx - nx, y - dy - ny)], sh, sh_off=(4, 4))
        for ex, ey in ((x - dx, y - dy), (x + dx, y + dy)):
            sp.ellipse(ex + nx * 0.6, ey + ny * 0.6, w * 0.75, w * 0.65, a, sh, sh_off=(4, 4))
            sp.ellipse(ex - nx * 0.6, ey - ny * 0.6, w * 0.75, w * 0.65, a, sh, sh_off=(4, 4))
    return sp.result()


def dungeon_clutter_skull(seed):
    r = np.random.default_rng(seed)
    sp = Sprite()
    c = sp.n / 2
    col = np.array((0.82, 0.78, 0.68))
    sp.ellipse(c, c, 34, 28, 0, col * 0.9, sh_off=(9, 8))
    sp.ellipse(c, c - 6, 30, 22, 0, col, shadow=False)
    sp.ellipse(c - 12, c + 4, 8, 7, 0, (0.08, 0.06, 0.05), shadow=False)
    sp.ellipse(c + 12, c + 4, 8, 7, 0, (0.08, 0.06, 0.05), shadow=False)
    sp.poly([(c - 3, c + 14), (c + 3, c + 14), (c, c + 8)], (0.1, 0.08, 0.06), shadow=False)
    sp.ellipse(c, c + 26, 18, 7, 0, col * 0.85, shadow=False)
    for k in range(5):
        sp.poly([(c - 12 + k * 6, c + 22), (c - 9 + k * 6, c + 22), (c - 9 + k * 6, c + 30), (c - 12 + k * 6, c + 30)], col * 1.05, shadow=False)
    return sp.result()


def dungeon_clutter_rubble(seed, tint=(0.42, 0.40, 0.37)):
    r = np.random.default_rng(seed)
    sp = Sprite()
    c = sp.n / 2
    for _ in range(r.integers(5, 9)):
        x, y = c + r.normal(0, 30), c + r.normal(0, 20)
        k = r.integers(4, 7)
        ang = np.sort(r.uniform(0, 2 * math.pi, k))
        rad = r.uniform(10, 26) * r.uniform(0.7, 1.2, k)
        pts = list(zip(x + np.cos(ang) * rad, y + np.sin(ang) * rad * 0.75))
        col = np.array(tint) * r.uniform(0.75, 1.15)
        sp.poly(pts, col * 0.8, sh_off=(8, 7))
        top = [(px - (px - x) * 0.25 - 3, py - (py - y) * 0.25 - 4) for px, py in pts]
        sp.poly(top, np.minimum(col * 1.15, 1), shadow=False)
    return sp.result()


def dungeon_clutter_glowshrooms(seed):
    r = np.random.default_rng(seed)
    sp = Sprite()
    c = sp.n / 2
    for _ in range(r.integers(4, 7)):
        x, y = c + r.normal(0, 24), c + 18 + r.normal(0, 12)
        h = r.uniform(14, 34)
        rad = r.uniform(9, 16)
        sp.poly([(x - 3, y), (x + 3, y), (x + 2, y - h), (x - 2, y - h)], (0.6, 0.85, 0.9), sh_off=(8, 5))
        sp.ellipse(x, y - h, rad, rad * 0.6, 0, (0.25, 0.85, 0.95), sh_off=(10, 6))
        sp.ellipse(x - rad * 0.2, y - h - rad * 0.15, rad * 0.6, rad * 0.32, 0, (0.75, 1.0, 1.0), shadow=False)
    return sp.result()


def dungeon_clutter_crystals(seed):
    r = np.random.default_rng(seed)
    sp = Sprite()
    c = sp.n / 2
    for _ in range(r.integers(3, 6)):
        x, y = c + r.normal(0, 20), c + 30 + r.normal(0, 8)
        h = r.uniform(30, 70)
        w = r.uniform(8, 14)
        lean = r.normal(0, 10)
        col = np.array((0.35, 0.75, 1.0)) * r.uniform(0.8, 1.1)
        sp.poly([(x - w, y), (x + w, y), (x + w * 0.6 + lean, y - h * 0.8), (x + lean, y - h), (x - w * 0.6 + lean, y - h * 0.8)], col * 0.7, sh_off=(14, 6))
        sp.poly([(x, y), (x + w, y), (x + w * 0.6 + lean, y - h * 0.8), (x + lean, y - h)], np.minimum(col * 1.3, 1), shadow=False)
    return sp.result()


def dungeon_clutter_embers(seed):
    r = np.random.default_rng(seed)
    sp = Sprite()
    c = sp.n / 2
    for _ in range(9):
        x, y = c + r.normal(0, 30), c + r.normal(0, 20)
        rad = r.uniform(6, 16)
        sp.ellipse(x, y, rad, rad * 0.7, r.random() * 3, (0.10, 0.08, 0.08), sh_off=(5, 4))
        sp.ellipse(x - rad * 0.2, y - rad * 0.15, rad * 0.45, rad * 0.3, 0, (1.0, 0.45, 0.08), shadow=False)
    return sp.result()


def dungeon_clutter_shards(seed):
    r = np.random.default_rng(seed)
    sp = Sprite()
    c = sp.n / 2
    for _ in range(7):
        x, y = c + r.normal(0, 28), c + r.normal(0, 20)
        a = r.random() * 6.28
        rad = r.uniform(8, 18)
        pts = [(x + math.cos(a + k * 2.1) * rad * r.uniform(0.6, 1.1), y + math.sin(a + k * 2.1) * rad * 0.7) for k in range(3)]
        col = np.array((0.55, 0.32, 0.20)) * r.uniform(0.8, 1.1)
        sp.poly(pts, col, sh_off=(4, 4))
    return sp.result()


DUNGEON_CLUTTER = [
    ("bones", lambda: dungeon_clutter_bones(60)),
    ("skull", lambda: dungeon_clutter_skull(61)),
    ("rubble", lambda: dungeon_clutter_rubble(62)),
    ("rubble_dark", lambda: dungeon_clutter_rubble(63, (0.20, 0.15, 0.13))),
    ("glowshrooms", lambda: dungeon_clutter_glowshrooms(64)),
    ("crystals", lambda: dungeon_clutter_crystals(65)),
    ("embers", lambda: dungeon_clutter_embers(66)),
    ("shards", lambda: dungeon_clutter_shards(67)),
]


def wall_top(seed, base):
    """The top of a wall seen from above: an uneven mass of dark rock, a few deep fissures (512 px, 4x4 tiles)."""
    n = SIZE
    big = fbm(n, n, 4, 5, seed)
    mid = fbm(n, n, 12, 4, seed + 1)
    ridged = 1 - np.abs(fbm(n, n, 8, 4, seed + 2) - 0.5) * 2
    height = big * 0.5 + mid * 0.3 + ridged ** 3 * 0.35
    crack_n = fbm(n, n, 6, 4, seed + 3)
    fissure = np.exp(-((crack_n - 0.5) ** 2) / 0.0007) * np.clip((fbm(n, n, 3, 2, seed + 4) - 0.4) * 3, 0, 1)
    height -= fissure * 0.35
    albedo = np.array(base) * (0.65 + 0.7 * mid)[..., None] * (1 - fissure * 0.8)[..., None]
    rgb = light_up(albedo, height, bump=7.0, ao_radius=4.0, ao_strength=1.8, shadow_len=12, ambient=0.38)
    return np.clip(rgb, 0, 1)


def build_dungeons(out_dir):
    for biome, base in (("crypt", (0.19, 0.18, 0.17)), ("cave", (0.21, 0.16, 0.12)), ("hell", (0.18, 0.10, 0.08))):
        top = (wall_top(70 + len(biome), base) * 255 + 0.5).astype(np.uint8)
        Image.fromarray(top).save(f"{out_dir}/tex_{biome}_top.png", optimize=True)
    for biome, mats in dungeon_sets().items():
        strip = (np.clip(np.concatenate([m[0] for m in mats], axis=1), 0, 1) * 255 + 0.5).astype(np.uint8)
        Image.fromarray(strip).save(f"{out_dir}/tex_floorset_{biome}.jpg", quality=92, subsampling=0)
        hstrip = (np.clip(np.concatenate([m[1] for m in mats], axis=1), 0, 1) * 255 + 0.5).astype(np.uint8)
        Image.fromarray(hstrip, "L").save(f"{out_dir}/tex_floorset_{biome}_h.png", optimize=True)
        print("floorset", biome, flush=True)
    atlas = np.concatenate([fn() for _, fn in DUNGEON_CLUTTER], axis=1)
    Image.fromarray(atlas).save(f"{out_dir}/tex_clutter_dungeon.png", optimize=True)


def water_base(seed=20):
    """Deep water colour with broad, slow swells (tileable)."""
    big = fbm(SIZE, SIZE, 3, 4, seed)
    yy, xx = np.mgrid[0:SIZE, 0:SIZE].astype(np.float64)
    warp = fbm(SIZE, SIZE, 4, 3, seed + 1)
    swell = np.sin((xx * 0.8 + yy * 0.6) / SIZE * 2 * math.pi * 5 + warp * 7) * 0.5 + 0.5
    t = big * 0.65 + swell * 0.35
    rgb = _palette(t, [(0, (0.03, 0.12, 0.16)), (0.5, (0.06, 0.21, 0.26)), (1, (0.12, 0.33, 0.38))])
    return np.clip(rgb, 0, 1)


def water_ripples(seed=21):
    """Bright caustic-like ripple lines on transparency (tileable)."""
    w1 = fbm(SIZE, SIZE, 6, 3, seed)
    w2 = fbm(SIZE, SIZE, 6, 3, seed + 1)
    yy, xx = np.mgrid[0:SIZE, 0:SIZE].astype(np.float64)
    v = np.sin((xx / SIZE * 12 + w1 * 6) * 2 * math.pi / 2) * np.sin((yy / SIZE * 12 + w2 * 6) * 2 * math.pi / 2)
    lines = np.exp(-(v ** 2) / 0.004)
    mask = np.clip((fbm(SIZE, SIZE, 4, 3, seed + 2) - 0.3) * 2.2, 0, 1)
    alpha = np.clip(lines * mask * 0.75, 0, 1)
    rgb = np.ones((SIZE, SIZE, 3)) * np.array([0.80, 0.93, 0.98])
    return np.concatenate([rgb, alpha[..., None]], -1)


def build(out_dir):
    cols, hs = [], []
    for name, fn in MATERIALS:
        rgb, h = fn()
        cols.append(rgb)
        hs.append(h)
        print("terrain", name, flush=True)
    strip = (np.clip(np.concatenate(cols, axis=1), 0, 1) * 255 + 0.5).astype(np.uint8)
    Image.fromarray(strip).save(f"{out_dir}/tex_terrain.jpg", quality=93, subsampling=0)
    hstrip = (np.clip(np.concatenate(hs, axis=1), 0, 1) * 255 + 0.5).astype(np.uint8)
    Image.fromarray(hstrip, "L").save(f"{out_dir}/tex_terrain_h.png", optimize=True)
    clutter = np.concatenate([fn() for _, fn in CLUTTER], axis=1)
    Image.fromarray(clutter).save(f"{out_dir}/tex_clutter.png", optimize=True)
    print("clutter", len(CLUTTER), flush=True)
    Image.fromarray((water_base() * 255 + 0.5).astype(np.uint8)).save(f"{out_dir}/tex_water_base.jpg", quality=92)
    Image.fromarray((water_ripples() * 255 + 0.5).astype(np.uint8)).save(f"{out_dir}/tex_water_ripples.png", optimize=True)


if __name__ == "__main__":
    import sys
    if len(sys.argv) > 2 and sys.argv[2] == "dungeons":
        build_dungeons(sys.argv[1])
    else:
        build(sys.argv[1] if len(sys.argv) > 1 else ".")
