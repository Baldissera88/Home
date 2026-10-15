"""Tiny vectorised signed-distance-field ray marcher used to pre-render sprites.

Models are lists of primitives (dicts) built in model space: x right, y up, z forward.
Sprites are rendered with an orthographic camera tilted down like the in-game view.
"""
import math

import numpy as np

# ---------------------------------------------------------------- materials

MATERIALS = {
    # name: (rgb, metal, emissive, grain)
    "steel": ((0.62, 0.65, 0.70), 1.0, 0.0, 0.05),
    "darksteel": ((0.30, 0.32, 0.36), 1.0, 0.0, 0.06),
    "gold": ((0.95, 0.72, 0.28), 1.0, 0.0, 0.04),
    "leather": ((0.33, 0.20, 0.11), 0.0, 0.0, 0.15),
    "darkleather": ((0.18, 0.11, 0.07), 0.0, 0.0, 0.15),
    "cloth_red": ((0.55, 0.07, 0.06), 0.0, 0.0, 0.12),
    "cloth_blue": ((0.10, 0.18, 0.45), 0.0, 0.0, 0.12),
    "skin": ((0.86, 0.64, 0.50), 0.0, 0.0, 0.05),
    "bone": ((0.86, 0.83, 0.72), 0.0, 0.0, 0.10),
    "bone_dark": ((0.45, 0.40, 0.32), 0.0, 0.0, 0.10),
    "rust": ((0.45, 0.27, 0.16), 0.5, 0.0, 0.25),
    "wood": ((0.42, 0.27, 0.14), 0.0, 0.0, 0.30),
    "darkwood": ((0.24, 0.15, 0.08), 0.0, 0.0, 0.30),
    "orc": ((0.33, 0.47, 0.22), 0.0, 0.0, 0.10),
    "orc_dark": ((0.20, 0.30, 0.13), 0.0, 0.0, 0.10),
    "demon": ((0.55, 0.07, 0.05), 0.0, 0.0, 0.12),
    "demon_dark": ((0.22, 0.03, 0.03), 0.0, 0.0, 0.12),
    "horn": ((0.82, 0.77, 0.66), 0.0, 0.0, 0.10),
    "black": ((0.04, 0.03, 0.03), 0.0, 0.0, 0.0),
    "eye_yellow": ((1.0, 0.85, 0.2), 0.0, 1.6, 0.0),
    "eye_red": ((1.0, 0.15, 0.08), 0.0, 1.8, 0.0),
    "eye_green": ((0.5, 1.0, 0.3), 0.0, 1.6, 0.0),
    "chitin": ((0.13, 0.11, 0.12), 0.6, 0.0, 0.08),
    "chitin_red": ((0.6, 0.06, 0.05), 0.3, 0.3, 0.08),
    "robe": ((0.24, 0.07, 0.28), 0.0, 0.0, 0.14),
    "robe_dark": ((0.10, 0.03, 0.12), 0.0, 0.0, 0.14),
    "slime": ((0.30, 0.85, 0.35), 0.3, 0.35, 0.05),
    "slime_core": ((0.75, 1.0, 0.5), 0.0, 1.2, 0.0),
    "bat": ((0.20, 0.14, 0.22), 0.0, 0.0, 0.10),
    "bat_wing": ((0.30, 0.18, 0.28), 0.0, 0.0, 0.10),
    "stone": ((0.50, 0.48, 0.45), 0.0, 0.0, 0.25),
    "darkstone": ((0.28, 0.26, 0.25), 0.0, 0.0, 0.25),
    "clay": ((0.62, 0.36, 0.22), 0.0, 0.0, 0.18),
    "crystal": ((0.35, 0.85, 1.0), 0.5, 1.2, 0.0),
    "crystal_red": ((1.0, 0.35, 0.25), 0.5, 1.2, 0.0),
    "coins": ((1.0, 0.80, 0.30), 1.0, 0.35, 0.0),
    "glass_red": ((0.85, 0.08, 0.10), 0.6, 0.55, 0.0),
    "glass": ((0.75, 0.85, 0.90), 1.0, 0.1, 0.0),
    "cork": ((0.55, 0.40, 0.22), 0.0, 0.0, 0.2),
    "lantern": ((1.0, 0.75, 0.35), 0.0, 1.8, 0.0),
    "hair": ((0.70, 0.70, 0.68), 0.0, 0.0, 0.25),
    "emerald": ((0.2, 0.9, 0.5), 0.6, 0.8, 0.0),
    "ruby": ((0.95, 0.1, 0.2), 0.6, 0.8, 0.0),
    "leaf": ((0.20, 0.40, 0.12), 0.0, 0.0, 0.45),
    "leaf_dark": ((0.11, 0.27, 0.09), 0.0, 0.0, 0.45),
    "pine": ((0.08, 0.27, 0.14), 0.0, 0.0, 0.40),
    "bark": ((0.30, 0.21, 0.14), 0.0, 0.0, 0.40),
    "moss": ((0.24, 0.38, 0.12), 0.0, 0.0, 0.35),
    "fur": ((0.47, 0.45, 0.42), 0.0, 0.0, 0.30),
    "fur_dark": ((0.24, 0.22, 0.21), 0.0, 0.0, 0.30),
    "parchment": ((0.86, 0.78, 0.58), 0.0, 0.0, 0.15),
    "rune_blue": ((0.3, 0.7, 1.0), 0.0, 1.5, 0.0),
    "portal": ((1.0, 0.25, 0.08), 0.0, 1.9, 0.0),
    "plaster": ((0.84, 0.78, 0.66), 0.0, 0.0, 0.18),
    "thatch": ((0.62, 0.49, 0.26), 0.0, 0.0, 0.55),
    "slate": ((0.28, 0.30, 0.35), 0.2, 0.0, 0.25),
    "coal": ((1.0, 0.42, 0.1), 0.0, 1.3, 0.3),
    "cloth_white": ((0.88, 0.86, 0.80), 0.0, 0.0, 0.12),
    "cloth_green": ((0.16, 0.36, 0.18), 0.0, 0.0, 0.12),
    "beard": ((0.92, 0.92, 0.9), 0.0, 0.0, 0.3),
    "beard_brown": ((0.32, 0.2, 0.12), 0.0, 0.0, 0.3),
    "candle": ((1.0, 0.85, 0.5), 0.0, 1.6, 0.0),
    "book_red": ((0.55, 0.1, 0.08), 0.0, 0.0, 0.1),
    "book_blue": ((0.12, 0.2, 0.5), 0.0, 0.0, 0.1),
    "book_green": ((0.12, 0.38, 0.16), 0.0, 0.0, 0.1),
    "mushroom": ((0.4, 0.9, 1.0), 0.0, 1.0, 0.0),
    "blood": ((0.4, 0.02, 0.02), 0.3, 0.0, 0.1),
}
MAT_NAMES = list(MATERIALS)
MAT_INDEX = {n: i for i, n in enumerate(MAT_NAMES)}
MAT_RGB = np.array([MATERIALS[n][0] for n in MAT_NAMES], dtype=np.float32)
MAT_METAL = np.array([MATERIALS[n][1] for n in MAT_NAMES], dtype=np.float32)
MAT_EMIT = np.array([MATERIALS[n][2] for n in MAT_NAMES], dtype=np.float32)
MAT_GRAIN = np.array([MATERIALS[n][3] for n in MAT_NAMES], dtype=np.float32)

# ---------------------------------------------------------------- helpers


def v(*a):
    return np.array(a, dtype=np.float32)


def norm(a):
    a = np.asarray(a, dtype=np.float32)
    return a / (np.linalg.norm(a) + 1e-9)


def rot_x(a):
    c, s = math.cos(a), math.sin(a)
    return np.array([[1, 0, 0], [0, c, -s], [0, s, c]], dtype=np.float32)


def rot_y(a):
    c, s = math.cos(a), math.sin(a)
    return np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]], dtype=np.float32)


def rot_z(a):
    c, s = math.cos(a), math.sin(a)
    return np.array([[c, -s, 0], [s, c, 0], [0, 0, 1]], dtype=np.float32)


def frame_from(direction, up_hint=(0, 1, 0)):
    """Rotation whose local +y axis points along `direction`."""
    y = norm(direction)
    hint = norm(up_hint)
    if abs(float(np.dot(hint, y))) > 0.95:
        hint = norm((0, 0, 1))
    x = norm(np.cross(y, hint))
    z = np.cross(x, y)
    return np.stack([x, y, z], axis=1).astype(np.float32)


# ---------------------------------------------------------------- primitives
# Each primitive: dict(kind=..., mat=name, op='add'|'sub'|'smooth', k=blend)


def sphere(c, r, mat, **kw):
    return dict(kind="sphere", c=v(*c), r=r, mat=mat, **kw)


def capsule(a, b, r, mat, rb=None, **kw):
    return dict(kind="capsule", a=v(*a), b=v(*b), r=r, rb=r if rb is None else rb, mat=mat, **kw)


def ellipsoid(c, r, mat, rot=None, **kw):
    return dict(kind="ellipsoid", c=v(*c), rr=v(*r), rot=rot, mat=mat, **kw)


def box(c, half, mat, rot=None, rnd=0.0, **kw):
    return dict(kind="box", c=v(*c), h=v(*half), rot=rot, rnd=rnd, mat=mat, **kw)


def cylinder(c, r, h, mat, rot=None, rnd=0.0, **kw):
    return dict(kind="cyl", c=v(*c), r=r, h=h, rot=rot, rnd=rnd, mat=mat, **kw)


def torus(c, R, r, mat, rot=None, **kw):
    return dict(kind="torus", c=v(*c), R=R, r=r, rot=rot, mat=mat, **kw)


def octa(c, s, mat, rot=None, **kw):
    return dict(kind="octa", c=v(*c), s=s, rot=rot, mat=mat, **kw)


def _local(p, prim):
    q = p - prim["c"]
    if prim.get("rot") is not None:
        q = q @ prim["rot"]
    return q


def prim_dist(p, prim):
    k = prim["kind"]
    if k == "sphere":
        return np.linalg.norm(p - prim["c"], axis=1) - prim["r"]
    if k == "capsule":
        a, b = prim["a"], prim["b"]
        pa = p - a
        ba = b - a
        h = np.clip((pa @ ba) / max(float(ba @ ba), 1e-9), 0.0, 1.0)
        r = prim["r"] + (prim["rb"] - prim["r"]) * h
        return np.linalg.norm(pa - h[:, None] * ba, axis=1) - r
    if k == "ellipsoid":
        q = _local(p, prim) / prim["rr"]
        k0 = np.linalg.norm(q, axis=1)
        k1 = np.linalg.norm(q / prim["rr"], axis=1)
        return k0 * (k0 - 1.0) / np.maximum(k1, 1e-6)
    if k == "box":
        q = np.abs(_local(p, prim)) - prim["h"] + prim["rnd"]
        outside = np.linalg.norm(np.maximum(q, 0.0), axis=1)
        inside = np.minimum(q.max(axis=1), 0.0)
        return outside + inside - prim["rnd"]
    if k == "cyl":
        q = _local(p, prim)
        dxz = np.sqrt(q[:, 0] ** 2 + q[:, 2] ** 2) - prim["r"] + prim["rnd"]
        dy = np.abs(q[:, 1]) - prim["h"] + prim["rnd"]
        outside = np.sqrt(np.maximum(dxz, 0) ** 2 + np.maximum(dy, 0) ** 2)
        return np.minimum(np.maximum(dxz, dy), 0.0) + outside - prim["rnd"]
    if k == "torus":
        q = _local(p, prim)
        qx = np.sqrt(q[:, 0] ** 2 + q[:, 2] ** 2) - prim["R"]
        return np.sqrt(qx ** 2 + q[:, 1] ** 2) - prim["r"]
    if k == "octa":
        q = np.abs(_local(p, prim))
        return (q.sum(axis=1) - prim["s"]) * 0.57735027
    raise ValueError(k)


def smin(a, b, k):
    h = np.clip(0.5 + 0.5 * (b - a) / k, 0.0, 1.0)
    return b * (1 - h) + a * h - k * h * (1 - h)


def scene(p, prims):
    """Returns (distance, material index) for points p (N,3)."""
    d = np.full(p.shape[0], 1e3, dtype=np.float32)
    m = np.zeros(p.shape[0], dtype=np.int32)
    for prim in prims:
        di = prim_dist(p, prim).astype(np.float32)
        mi = MAT_INDEX[prim["mat"]]
        op = prim.get("op", "add")
        if op == "sub":
            carved = -di > d
            d = np.maximum(d, -di)
            m = np.where(carved, mi, m)
        elif op == "smooth":
            closer = di < d
            d = smin(d, di, prim.get("k", 0.04))
            m = np.where(closer, mi, m)
        else:
            closer = di < d
            d = np.where(closer, di, d)
            m = np.where(closer, mi, m)
    return d, m


# ---------------------------------------------------------------- rendering

ELEVATION = math.radians(52)
VIEW = norm((0, -math.sin(ELEVATION), -math.cos(ELEVATION)))
UP = norm((0, math.cos(ELEVATION), -math.sin(ELEVATION)))
RIGHT = v(1, 0, 0)
KEY = norm((-0.55, 1.0, 0.55))
FILL = norm((0.8, 0.35, -0.6))


def _hash_noise(p):
    q = np.floor(p * 37.0)
    n = np.sin(q[:, 0] * 12.9898 + q[:, 1] * 78.233 + q[:, 2] * 37.719) * 43758.5453
    return n - np.floor(n)


def render(prims, size=128, width=1.6, foot=0.82, yaw=0.0, ss=2, view=None, up=None):
    """Render a model to an RGBA uint8 image. `foot` is where y=0 lands, as a fraction from the top."""
    view = VIEW if view is None else view
    up = UP if up is None else up
    n = size * ss
    ys, xs = np.mgrid[0:n, 0:n].astype(np.float32)
    u = ((xs + 0.5) / n - 0.5) * width
    w = (foot - (ys + 0.5) / n) * width
    origins = (u.reshape(-1, 1) * RIGHT + w.reshape(-1, 1) * up - view * 6.0).astype(np.float32)
    ry = rot_y(yaw)

    def sdf(p):
        return scene(p @ ry, prims)

    count = origins.shape[0]
    t = np.zeros(count, dtype=np.float32)
    hit = np.zeros(count, dtype=bool)
    alive = np.ones(count, dtype=bool)
    for _ in range(90):
        idx = np.nonzero(alive)[0]
        if idx.size == 0:
            break
        p = origins[idx] + t[idx, None] * view
        d, _ = sdf(p)
        t[idx] += d * 0.85
        done = d < 0.0015
        hit[idx[done]] = True
        far = t[idx] > 12.0
        alive[idx[done | far]] = False

    rgba = np.zeros((count, 4), dtype=np.float32)
    hi = np.nonzero(hit)[0]
    if hi.size:
        p = origins[hi] + t[hi, None] * view
        e = 0.0015
        ks = [v(1, -1, -1), v(-1, -1, 1), v(-1, 1, -1), v(1, 1, 1)]
        nrm = np.zeros_like(p)
        for k in ks:
            dk, _ = sdf(p + k * e)
            nrm += k * dk[:, None]
        nrm /= np.linalg.norm(nrm, axis=1, keepdims=True) + 1e-9
        _, mat = sdf(p)
        # Normals are in world space already because sdf rotates the sample points.
        ao = np.ones(hi.size, dtype=np.float32)
        for i in range(1, 5):
            h = 0.02 * i
            dh, _ = sdf(p + nrm * h)
            ao -= (h - dh) * (1.6 / i)
        ao = np.clip(ao, 0.25, 1.0)
        # Soft self-shadow towards the key light.
        sh = np.ones(hi.size, dtype=np.float32)
        ts = np.full(hi.size, 0.02, dtype=np.float32)
        for _ in range(18):
            dh, _ = sdf(p + KEY * ts[:, None])
            sh = np.minimum(sh, 8.0 * dh / ts)
            ts += np.clip(dh, 0.01, 0.08)
        sh = np.clip(sh, 0.0, 1.0)

        base = MAT_RGB[mat]
        grain = MAT_GRAIN[mat]
        noise = _hash_noise(p @ ry)
        base = base * (1.0 + grain[:, None] * (noise[:, None] - 0.5) * 2.0)
        metal = MAT_METAL[mat][:, None]
        emit = MAT_EMIT[mat][:, None]

        diff = np.clip(nrm @ KEY, 0, 1)[:, None] * sh[:, None]
        fill = np.clip(nrm @ FILL, 0, 1)[:, None]
        sky = (0.55 + 0.45 * nrm[:, 1:2])
        half = norm(KEY - view)
        spec = np.clip(nrm @ half, 0, 1)[:, None] ** 40 * sh[:, None]
        rim = np.clip(1.0 - np.abs(nrm @ view), 0, 1)[:, None] ** 3

        col = base * (0.30 * sky * ao[:, None] + 1.05 * diff * (1 - 0.45 * metal)) \
            + base * fill * v(0.25, 0.30, 0.45) \
            + spec * (0.25 + 0.9 * metal) * (0.6 + 0.4 * base) \
            + rim * 0.12 * ao[:, None]
        col = np.where(emit > 0, base * (0.6 + emit * 0.6) + col * 0.3, col)
        col = 1.0 - np.exp(-col * 1.35)
        rgba[hi, :3] = col
        rgba[hi, 3] = 1.0

    img = rgba.reshape(n, n, 4)
    # Supersample down with premultiplied alpha.
    img[..., :3] *= img[..., 3:4]
    img = img.reshape(size, ss, size, ss, 4).mean(axis=(1, 3))
    a = img[..., 3:4]
    img[..., :3] = np.where(a > 1e-4, img[..., :3] / np.maximum(a, 1e-4), 0)
    return (np.clip(img, 0, 1) * 255 + 0.5).astype(np.uint8)
