"""Parametric 3D models for the RPG sprites. Units: one floor tile = 1.0, model faces +z."""
import math

import numpy as np

from sdf import (box, capsule, cylinder, ellipsoid, frame_from, group, norm, octa, rot_x, rot_y, rot_z,
                 sphere, torus, v)

# Animation frames used by every directional sprite sheet (columns of the atlas).
FRAMES = [("idle", 0), ("walk", 0), ("walk", 1), ("walk", 2), ("walk", 3), ("atk", 0), ("atk", 1), ("atk", 2)]


# Hero sheets use smoother cycles: idle x2 (breathing), walk x8 and attack x6.
HERO_FRAMES = [("idle", 0, 2), ("idle", 1, 2)] + [("walk", i, 8) for i in range(8)] + [("atk", i, 6) for i in range(6)]


def _frame(frame):
    """(kind, index, count): frames are (kind, i) for the classic 8-column sheets or (kind, i, n)."""
    if len(frame) > 2:
        return frame[0], frame[1], frame[2]
    return frame[0], frame[1], {"walk": 4, "atk": 3}.get(frame[0], 1)


def _walk(frame):
    kind, i, n = _frame(frame)
    if kind == "walk":
        ph = i * 2 * math.pi / n + math.pi / n
        return math.sin(ph), abs(math.cos(ph))
    return 0.0, 1.0


def _keys(frame, keys):
    """Sample a list of keyframes (vectors or floats) at the attack frame, blending linearly between keys."""
    kind, i, n = _frame(frame)
    t = i / max(1, n - 1) * (len(keys) - 1)
    k = min(int(t), len(keys) - 2)
    f = t - k
    a, b = keys[k], keys[k + 1]
    if isinstance(a, (int, float)):
        return a * (1 - f) + b * f
    return tuple(norm(np.asarray(x) * (1 - f) + np.asarray(y) * f) for x, y in zip(a, b))


def blade(hand, direction, length, width, mat="steel", guard="gold", grip="leather"):
    d = norm(direction)
    f = frame_from(d, (0, 0, 1))
    c = hand + d * (0.06 + length / 2)
    return [
        box(c, (width, length / 2, 0.008), mat, rot=f, rnd=0.004),
        box(hand + d * 0.045, (width * 3.2, 0.012, 0.022), guard, rot=f, rnd=0.006),
        capsule(hand - d * 0.07, hand + d * 0.03, 0.018, grip),
        sphere(hand - d * 0.085, 0.026, guard),
    ]


SWORD_SLASH = [
    (v(0.35, 0.75, -0.55), v(0.15, 0.95, -0.25), v(0.05, 0.9, -0.45)),
    (v(0.45, 0.05, 0.9), v(0.15, 0.0, 1.0), v(-0.25, 0.05, 1.0)),
    (v(-0.05, -0.45, 0.8), v(-0.55, -0.3, 0.7), v(-0.95, -0.25, 0.35)),
]


def arm_pose(frame, side, swing, spec=None):
    """Upper-arm, forearm and weapon directions. side=+1 right (weapon) arm, -1 left."""
    kind = frame[0]
    spec = spec or {}
    if kind == "atk":
        keys = spec.get("atk_right", SWORD_SLASH) if side > 0 else spec.get("atk_left")
        if keys:
            return _keys(frame, keys)
    up = v(0.18 * side, -math.cos(swing * 0.7), math.sin(swing * 0.7))
    fore = v(0.08 * side, -math.cos(swing * 0.7 + 0.5), math.sin(swing * 0.7 + 0.5))
    weapon = spec.get("rest_weapon", v(0.05, 0.15, 1.0)) * v(side, 1, 1)
    return up, fore, weapon


def humanoid(frame, spec):
    """Generic biped. `spec` controls proportions, materials and gear."""
    s = spec.get("scale", 1.0)
    swing, lift = _walk(frame)
    kind, ai, an = _frame(frame)
    attacking = kind == "atk"
    twist = _keys(frame, spec.get("atk_twist", [-0.35, 0.15, 0.45])) if attacking else 0.0
    lunge = _keys(frame, spec.get("atk_lunge", [0.0, 0.0])) * s if attacking else 0.0
    tw = rot_y(twist)
    bob = -0.015 * (1 - lift) * s
    if kind == "idle" and ai == 1:
        bob += 0.008 * s  # breathing in
    hip_y = spec.get("hip", 0.48) * s + bob
    lean = rot_x(spec.get("lean", 0.0) + (_keys(frame, spec.get("atk_lean", [0.0, 0.0])) if attacking else 0.0))
    prims = []
    if spec.get("under"):
        prims.extend(spec["under"](s, swing, frame))

    # Legs.
    for side in (1, -1):
        a = swing * 0.55 * side
        hip = v(0.085 * side * spec.get("width", 1.0) * s, hip_y, 0)
        thigh_dir = v(0, -math.cos(a), math.sin(a))
        knee = hip + thigh_dir * 0.22 * s
        bend = 0.35 if a < 0 else 0.05
        shin_dir = v(0, -math.cos(a - bend), math.sin(a - bend))
        foot = knee + shin_dir * 0.22 * s
        foot[1] = max(foot[1], 0.03 * s)
        tr = spec.get("thigh_r", 0.06) * s
        sr = spec.get("shin_r", 0.05) * s
        # Tapered limbs that blend softly at the joints read as bodies rather than stacked tubes.
        prims.append(capsule(hip, knee, tr, spec["thigh"], rb=tr * 0.8, op="smooth", k=0.02 * s))
        prims.append(capsule(knee, foot, sr * 1.05, spec["shin"], rb=sr * 0.72, op="smooth", k=0.02 * s))
        if spec.get("boot"):
            prims.append(ellipsoid(foot + v(0, 0.01, 0.04) * s, v(0.055, 0.04, 0.09) * s, spec["boot"]))

    # Torso, built around the hips and twisted for attacks.
    pivot = v(0, hip_y, 0)

    def T(p):
        q = lean @ (np.asarray(p, dtype=np.float32) - pivot) + pivot
        return tw @ q + v(0, bob, lunge)

    torso_c = T(v(0, spec.get("chest", 0.66), 0) * s)
    tr3 = v(*spec.get("torso_r", (0.17, 0.2, 0.12))) * s
    # Chest broader than the waist, merged into the hips.
    prims.append(ellipsoid(torso_c + T(v(0, 0.035, 0) * s) - T(v(0, 0, 0)), tr3 * v(1.0, 0.82, 1.0), spec["torso"], rot=tw.T, op="smooth", k=0.03 * s))
    prims.append(ellipsoid(T(v(0, hip_y / s * 0.5 + spec.get("chest", 0.66) * 0.5 - 0.02, 0) * s), tr3 * v(0.78, 0.6, 0.9), spec["torso"], rot=tw.T, op="smooth", k=0.05 * s))
    prims.extend(spec.get("torso_extra", lambda T, s, swing: [])(T, s, swing))

    sh_y = spec.get("shoulder", 0.78)
    for side in (1, -1):
        shoulder = T(v(0.18 * side * spec.get("width", 1.0), sh_y, 0) * s)
        up, fore, weapon = arm_pose(frame, side, -swing * side, spec)
        up = tw @ (lean @ norm(up))
        fore = tw @ (lean @ norm(fore))
        weapon = tw @ (lean @ norm(weapon))
        elbow = shoulder + up * 0.2 * s
        hand = elbow + fore * 0.19 * s
        ar = spec.get("arm_r", 0.05) * s
        fr = spec.get("fore_r", 0.045) * s
        prims.append(capsule(shoulder, elbow, ar, spec["upper_arm"], rb=ar * 0.82, op="smooth", k=0.02 * s))
        prims.append(capsule(elbow, hand, fr * 1.05, spec["forearm"], rb=fr * 0.75, op="smooth", k=0.015 * s))
        prims.append(sphere(hand, spec.get("hand_r", 0.045) * s, spec["hand"]))
        if spec.get("pauldron"):
            prims.append(sphere(shoulder + v(0, 0.02, 0) * s, 0.085 * s * spec.get("pauldron_s", 1.0), spec["pauldron"]))
        gear = spec.get("right" if side > 0 else "left")
        if gear:
            prims.extend(gear(hand, weapon, fore, s, frame))

    neck_base = T(v(0, sh_y + 0.02, 0) * s)
    head_c = T(v(0, spec.get("head_y", 0.92), spec.get("head_z", 0.0)) * s)
    prims.append(capsule(neck_base, head_c, 0.045 * s, spec.get("neck", spec["torso"])))
    prims.extend(spec["head"](head_c, s * spec.get("head_scale", 0.9), tw, swing))
    return prims


# ---------------------------------------------------------------- hero


def _hero_torso(T, s, swing):
    return [
        box(T(v(0, 0.6, 0.11) * s), v(0.11, 0.17, 0.02) * s, "cloth_red", rnd=0.01),
        box(T(v(0, 0.41, 0.1) * s), v(0.1, 0.08, 0.018) * s, "cloth_red", rot=rot_x(0.1 * swing), rnd=0.01),
        cylinder(T(v(0, 0.49, 0) * s), 0.15 * s, 0.03 * s, "leather", rnd=0.01),
        sphere(T(v(0, 0.49, 0.15) * s), 0.025 * s, "gold"),
        box(T(v(0, 0.58, -0.15) * s), v(0.16, 0.26, 0.015) * s, "cloth_red", rot=rot_x(-0.2 - 0.15 * abs(swing)), rnd=0.01),
        box(T(v(0, 0.7, 0.125) * s), v(0.035, 0.035, 0.005) * s, "gold", rot=rot_z(0.785)),
    ]


def _hero_head(c, s, tw, swing):
    return [
        sphere(c, 0.11 * s, "steel"),
        cylinder(c + v(0, -0.03, 0) * s, 0.118 * s, 0.035 * s, "steel", rnd=0.01),
        box(c + v(0, 0.0, 0.1) * s, v(0.065, 0.012, 0.05) * s, "black", op="sub"),
        box(c + v(0, -0.04, 0.1) * s, v(0.008, 0.035, 0.05) * s, "black", op="sub"),
        capsule(c + v(0, 0.1, 0.02) * s, c + v(0, 0.12, -0.14) * s, 0.03 * s, "cloth_red", rb=0.015 * s),
        torus(c + v(0, 0.02, 0) * s, 0.11 * s, 0.012 * s, "gold"),
    ]


def _hero_sword(hand, weapon, fore, s, frame):
    return blade(hand, weapon, 0.5 * s, 0.028 * s)


def _hero_shield(hand, weapon, fore, s, frame):
    c = hand + v(-0.04, 0.06, 0.07) * s
    f = frame_from(v(-0.35, 0.1, 1.0))
    return [
        cylinder(c, 0.17 * s, 0.022 * s, "cloth_blue", rot=f, rnd=0.008),
        torus(c, 0.165 * s, 0.018 * s, "darksteel", rot=f),
        sphere(c + f[:, 1] * 0.02 * s, 0.04 * s, "gold"),
        box(c + f[:, 1] * 0.025 * s, v(0.12, 0.02, 0.012) * s, "gold", rot=f, rnd=0.004),
    ]


HERO = dict(
    torso="steel", torso_r=(0.17, 0.2, 0.12), thigh="leather", shin="darksteel", boot="darkleather",
    upper_arm="darksteel", forearm="steel", hand="leather", pauldron="steel",
    torso_extra=_hero_torso, head=_hero_head, right=_hero_sword, left=_hero_shield, neck="leather",
)

# ---------------------------------------------------------------- skeleton


def _skel_torso(T, s, swing):
    out = [capsule(T(v(0, 0.48, -0.01) * s), T(v(0, 0.8, -0.02) * s), 0.025 * s, "bone_dark")]
    for i, (y, r) in enumerate([(0.74, 0.1), (0.67, 0.11), (0.6, 0.1)]):
        out.append(torus(T(v(0, y, 0) * s), r * s, 0.016 * s, "bone"))
    out.append(ellipsoid(T(v(0, 0.47, 0) * s), v(0.11, 0.05, 0.07) * s, "bone"))
    out.append(box(T(v(0, 0.42, 0.06) * s), v(0.09, 0.06, 0.012) * s, "darkleather", rnd=0.01))
    return out


def _skull(c, s, tw, swing, crown=False):
    out = [
        sphere(c, 0.09 * s, "bone"),
        box(c + v(0, -0.07, 0.03) * s, v(0.05, 0.03, 0.045) * s, "bone", rnd=0.015),
        sphere(c + v(0.035, 0.0, 0.075) * s, 0.028 * s, "black", op="sub"),
        sphere(c + v(-0.035, 0.0, 0.075) * s, 0.028 * s, "black", op="sub"),
        sphere(c + v(0.035, 0.0, 0.06) * s, 0.012 * s, "eye_red"),
        sphere(c + v(-0.035, 0.0, 0.06) * s, 0.012 * s, "eye_red"),
        box(c + v(0, -0.035, 0.085) * s, v(0.01, 0.012, 0.02) * s, "black", op="sub"),
    ]
    if crown:
        out.append(cylinder(c + v(0, 0.07, 0) * s, 0.085 * s, 0.03 * s, "gold"))
        for k in range(6):
            a = k * math.pi / 3
            out.append(capsule(c + v(math.sin(a) * 0.08, 0.09, math.cos(a) * 0.08) * s,
                               c + v(math.sin(a) * 0.085, 0.15, math.cos(a) * 0.085) * s, 0.012 * s, "gold", rb=0.002 * s))
        out.append(sphere(c + v(0, 0.08, 0.085) * s, 0.018 * s, "ruby"))
    return out


def _rusty_sword(hand, weapon, fore, s, frame):
    return blade(hand, weapon, 0.42 * s, 0.026 * s, mat="rust", guard="darksteel", grip="darkleather")


def _old_shield(hand, weapon, fore, s, frame):
    c = hand + v(-0.03, 0.05, 0.06) * s
    f = frame_from(v(-0.4, 0.1, 1.0))
    return [
        cylinder(c, 0.14 * s, 0.02 * s, "darkwood", rot=f, rnd=0.006),
        sphere(c + f[:, 1] * 0.02 * s, 0.03 * s, "rust"),
        box(c + f[:, 0] * 0.08 * s, v(0.05, 0.05, 0.05) * s, "black", rot=f, op="sub"),
    ]


SKELETON = dict(
    torso="bone_dark", torso_r=(0.02, 0.02, 0.02), thigh="bone", shin="bone", thigh_r=0.028, shin_r=0.025,
    upper_arm="bone", forearm="bone", hand="bone", arm_r=0.025, fore_r=0.022, hand_r=0.03, neck="bone",
    torso_extra=_skel_torso, head=_skull, right=_rusty_sword, left=_old_shield,
)


def _king_torso(T, s, swing):
    return _skel_torso(T, s, swing) + [
        box(T(v(0, 0.6, -0.14) * s), v(0.17, 0.27, 0.015) * s, "robe", rot=rot_x(-0.2 - 0.15 * abs(swing)), rnd=0.01),
        sphere(T(v(0.16, 0.8, 0) * s), 0.07 * s, "gold"),
        sphere(T(v(-0.16, 0.8, 0) * s), 0.07 * s, "gold"),
    ]


def _king_sword(hand, weapon, fore, s, frame):
    return blade(hand, weapon, 0.62 * s, 0.035 * s, mat="darksteel", guard="gold", grip="gold")


SKELETON_KING = dict(SKELETON, torso_extra=_king_torso, head=lambda c, s, tw, sw: _skull(c, s, tw, sw, crown=True),
                     right=_king_sword, left=None, pauldron=None)

# ---------------------------------------------------------------- orc brute


def _orc_torso(T, s, swing):
    return [
        ellipsoid(T(v(0, 0.56, 0.07) * s), v(0.2, 0.17, 0.16) * s, "orc"),
        cylinder(T(v(0, 0.47, 0) * s), 0.2 * s, 0.035 * s, "leather", rnd=0.01),
        box(T(v(0, 0.36, 0.13) * s), v(0.12, 0.1, 0.02) * s, "darkleather", rot=rot_x(0.12 * swing), rnd=0.01),
        ellipsoid(T(v(-0.22, 0.86, 0) * s), v(0.12, 0.07, 0.11) * s, "darksteel"),
        capsule(T(v(-0.25, 0.9, 0) * s), T(v(-0.3, 1.02, 0) * s), 0.025 * s, "steel", rb=0.002 * s),
        capsule(T(v(-0.18, 0.91, 0.04) * s), T(v(-0.2, 1.0, 0.06) * s), 0.02 * s, "steel", rb=0.002 * s),
        capsule(T(v(0.2, 0.84, 0.0) * s), T(v(-0.18, 0.5, 0.12) * s), 0.02 * s, "leather"),
    ]


def _orc_head(c, s, tw, swing):
    return [
        ellipsoid(c, v(0.12, 0.11, 0.12) * s, "orc"),
        box(c + v(0, -0.07, 0.05) * s, v(0.09, 0.04, 0.07) * s, "orc_dark", rnd=0.02),
        capsule(c + v(0.05, -0.07, 0.11) * s, c + v(0.06, 0.0, 0.13) * s, 0.016 * s, "horn", rb=0.004 * s),
        capsule(c + v(-0.05, -0.07, 0.11) * s, c + v(-0.06, 0.0, 0.13) * s, 0.016 * s, "horn", rb=0.004 * s),
        sphere(c + v(0.045, 0.02, 0.1) * s, 0.016 * s, "eye_yellow"),
        sphere(c + v(-0.045, 0.02, 0.1) * s, 0.016 * s, "eye_yellow"),
        box(c + v(0, 0.045, 0.09) * s, v(0.08, 0.015, 0.03) * s, "orc_dark", rnd=0.01),
        capsule(c + v(0.11, 0.02, 0) * s, c + v(0.19, 0.06, -0.03) * s, 0.025 * s, "orc", rb=0.005 * s),
        capsule(c + v(-0.11, 0.02, 0) * s, c + v(-0.19, 0.06, -0.03) * s, 0.025 * s, "orc", rb=0.005 * s),
    ]


def _club(hand, weapon, fore, s, frame):
    d = norm(weapon)
    tip = hand + d * 0.6 * s
    out = [capsule(hand - d * 0.06 * s, tip, 0.035 * s, "wood", rb=0.085 * s)]
    f = frame_from(d)
    for k in range(5):
        a = k * 2 * math.pi / 5
        o = (f[:, 0] * math.cos(a) + f[:, 2] * math.sin(a))
        base = hand + d * (0.4 + 0.04 * k) * s + o * 0.06 * s
        out.append(capsule(base, base + o * 0.06 * s, 0.014 * s, "darksteel", rb=0.002 * s))
    return out


BRUTE = dict(
    torso="orc", torso_r=(0.25, 0.24, 0.19), width=1.35, thigh="orc_dark", shin="orc", boot="darkleather",
    thigh_r=0.085, shin_r=0.07, upper_arm="orc", forearm="orc", hand="orc_dark", arm_r=0.08, fore_r=0.07,
    hand_r=0.065, chest=0.72, shoulder=0.86, head_y=1.02, head_z=0.06, neck="orc",
    torso_extra=_orc_torso, head=_orc_head, right=_club, left=None,
)

# ---------------------------------------------------------------- cultist


def cultist(frame):
    swing, lift = _walk(frame)
    kind, i = frame
    sway = swing * 0.08
    prims = [
        capsule(v(0, 0.74, 0), v(sway * 0.3, 0.05, -sway * 0.2), 0.13, "robe", rb=0.27),
        capsule(v(0, 0.5, 0.0), v(0, 0.2, 0.05), 0.05, "robe_dark", rb=0.1),
        cylinder(v(0, 0.52, 0), 0.155, 0.02, "gold", rnd=0.005),
        sphere(v(0, 0.9, 0), 0.12, "robe"),
        sphere(v(0, 0.89, 0.07), 0.08, "black", op="sub"),
        sphere(v(0.03, 0.89, 0.05), 0.013, "eye_red"),
        sphere(v(-0.03, 0.89, 0.05), 0.013, "eye_red"),
        capsule(v(0, 0.97, -0.06), v(0, 1.08, -0.16), 0.06, "robe", rb=0.01),
        box(v(0, 0.66, 0.15), v(0.03, 0.12, 0.01), "robe_dark", rnd=0.005),
        octa(v(0, 0.7, 0.16), 0.03, "crystal_red"),
    ]
    if kind == "atk":
        raise_amt = [0.4, 1.0, 0.7][i]
        hand = v(0.18, 0.62 + 0.3 * raise_amt, 0.12 + 0.12 * raise_amt)
    else:
        hand = v(0.2, 0.55, 0.06 + sway)
    prims.append(capsule(v(0.15, 0.78, 0), hand, 0.05, "robe", rb=0.065))
    prims.append(sphere(hand + v(0, 0, 0.03), 0.035, "bone"))
    staff_top = hand + v(0.02, 0.45, 0.05)
    prims.append(capsule(hand + v(-0.01, -0.45, -0.02), staff_top, 0.018, "darkwood"))
    prims.append(octa(staff_top + v(0, 0.06, 0), 0.06, "crystal_red", rot=rot_y(0.5)))
    for k in range(3):
        a = k * 2 * math.pi / 3
        prims.append(capsule(staff_top, staff_top + v(math.cos(a) * 0.05, 0.1, math.sin(a) * 0.05), 0.008, "gold"))
    other = v(-0.19, 0.55, 0.08 - sway)
    prims.append(capsule(v(-0.15, 0.78, 0), other, 0.05, "robe", rb=0.065))
    prims.append(sphere(other + v(0, -0.02, 0.02), 0.032, "bone"))
    return prims


# ---------------------------------------------------------------- spider


def spider(frame, s=1.0):
    kind, i = frame
    swing, lift = _walk(frame)
    prims = [
        ellipsoid(v(0, 0.24, -0.2) * s, v(0.2, 0.17, 0.25) * s, "chitin"),
        ellipsoid(v(0, 0.35, -0.2) * s, v(0.06, 0.05, 0.12) * s, "chitin_red"),
        ellipsoid(v(0, 0.2, 0.09) * s, v(0.12, 0.09, 0.12) * s, "chitin"),
    ]
    for k, (x, y) in enumerate([(0.03, 0.25), (-0.03, 0.25), (0.06, 0.23), (-0.06, 0.23), (0.015, 0.27), (-0.015, 0.27)]):
        prims.append(sphere(v(x, y, 0.19) * s, (0.018 if k < 2 else 0.012) * s, "eye_red"))
    bite = 0.6 if kind == "atk" and i == 1 else 0.0
    for side in (1, -1):
        prims.append(capsule(v(0.04 * side, 0.15, 0.19) * s, v(0.03 * side, 0.08 - bite * 0.05, 0.24 + bite * 0.06) * s, 0.018 * s, "horn", rb=0.004 * s))
    for side in (1, -1):
        for k in range(4):
            ang = (-0.9 + k * 0.55)
            phase = (k % 2 == 0) == (side > 0)
            step = swing * (0.25 if phase else -0.25)
            raise_leg = kind == "atk" and k == 0
            hip = v(0.1 * side, 0.22, 0.08 - k * 0.07) * s
            outward = v(side * math.cos(ang + step), 0, math.sin(-ang - step) * -1)
            knee = hip + (outward * 0.22 + v(0, 0.16 + (0.15 if raise_leg else 0), 0)) * s
            foot = hip + (outward * 0.42 + v(0, -0.2 + (0.25 if raise_leg else 0), 0.05 if raise_leg else 0)) * s
            foot[1] = max(foot[1], 0.01 * s)
            prims.append(capsule(hip, knee, 0.025 * s, "chitin", rb=0.02 * s))
            prims.append(capsule(knee, foot, 0.02 * s, "chitin", rb=0.008 * s))
    return prims


# ---------------------------------------------------------------- demon boss


def demon(frame):
    swing, lift = _walk(frame)
    kind, i = frame
    s = 1.9
    prims = []
    bob = -0.02 * (1 - lift)
    for side in (1, -1):
        a = swing * 0.4 * side
        hip = v(0.16 * side, 0.5 + bob, -0.02) * s
        knee = hip + v(0.03 * side, -0.24 * math.cos(a), 0.12 + 0.24 * math.sin(a)) * s
        ankle = knee + v(0, -0.18, -0.12) * s
        foot = ankle + v(0, -0.07, 0.1) * s
        foot[1] = max(foot[1], 0.02 * s)
        prims += [
            capsule(hip, knee, 0.085 * s, "demon", rb=0.065 * s),
            capsule(knee, ankle, 0.055 * s, "demon_dark"),
            capsule(ankle, foot, 0.045 * s, "demon_dark"),
        ]
        for c in range(3):
            prims.append(capsule(foot, foot + v((c - 1) * 0.04, -0.02, 0.07) * s, 0.015 * s, "horn", rb=0.003 * s))
    twist = {0: -0.4, 1: 0.2, 2: 0.5}[i] if kind == "atk" else 0.0
    tw = rot_y(twist)

    def T(p):
        return tw @ np.asarray(p, dtype=np.float32) + v(0, bob, 0) * s

    prims += [
        ellipsoid(T(v(0, 0.78, 0) * s), v(0.27, 0.27, 0.19) * s, "demon", rot=tw.T),
        ellipsoid(T(v(0, 0.6, 0.04) * s), v(0.18, 0.14, 0.13) * s, "demon_dark", rot=tw.T),
        capsule(T(v(0, 0.55, -0.1) * s), T(v(0.05 * swing, 0.25, -0.55) * s), 0.06 * s, "demon_dark", rb=0.012 * s),
    ]
    for k in range(4):
        prims.append(capsule(T(v(0, 0.6 + k * 0.09, -0.15) * s), T(v(0, 0.63 + k * 0.09, -0.24) * s), 0.025 * s, "horn", rb=0.003 * s))
    # Wings.
    flap = 0.15 * math.sin(i * 1.3 + (0.5 if kind == "atk" else 0)) + 0.1 * swing
    for side in (1, -1):
        root = T(v(0.12 * side, 0.92, -0.14) * s)
        tip = T(v((0.75 + flap) * side, 1.45 + flap, -0.45) * s)
        mid = T(v(0.5 * side, 1.25, -0.3) * s)
        low = T(v(0.62 * side, 0.7, -0.35) * s)
        prims += [capsule(root, mid, 0.03 * s, "demon_dark"), capsule(mid, tip, 0.02 * s, "demon_dark", rb=0.004 * s)]
        prims.append(capsule(mid, low, 0.012 * s, "demon_dark"))
        center = (root + tip + low) / 3
        f = frame_from(np.cross(tip - root, low - root), (0, 1, 0))
        prims.append(ellipsoid(center, v(0.32, 0.01, 0.26) * s, "bat_wing", rot=frame_from(np.cross(tip - root, low - root))))
    # Arms with claws.
    for side in (1, -1):
        shoulder = T(v(0.29 * side, 0.92, 0) * s)
        if kind == "atk" and side > 0:
            up, fore = [(v(0.3, 0.8, -0.5), v(0.1, 0.9, 0.2)), (v(0.4, 0.1, 0.9), v(0.0, -0.1, 1.0)), (v(-0.2, -0.4, 0.8), v(-0.8, -0.3, 0.5))][i]
        else:
            up, fore = v(0.3 * side, -0.9, 0.15 - swing * side * 0.3), v(0.05 * side, -0.8, 0.5)
        up, fore = tw @ norm(up), tw @ norm(fore)
        elbow = shoulder + up * 0.3 * s
        hand = elbow + fore * 0.28 * s
        prims += [
            sphere(shoulder, 0.11 * s, "demon"),
            capsule(shoulder, elbow, 0.08 * s, "demon", rb=0.065 * s),
            capsule(elbow, hand, 0.065 * s, "demon_dark", rb=0.05 * s),
            sphere(hand, 0.06 * s, "demon_dark"),
        ]
        for c in range(3):
            o = v((c - 1) * 0.04, 0, 0)
            prims.append(capsule(hand + o * s, hand + (o + fore * 0.13) * s, 0.016 * s, "horn", rb=0.002 * s))
    head = T(v(0, 1.1, 0.08) * s)
    prims += [
        capsule(T(v(0, 0.98, 0) * s), head, 0.08 * s, "demon"),
        ellipsoid(head, v(0.13, 0.12, 0.13) * s, "demon"),
        box(head + v(0, -0.07, 0.07) * s, v(0.08, 0.035, 0.06) * s, "demon_dark", rnd=0.02),
        sphere(head + v(0.05, 0.02, 0.11) * s, 0.02 * s, "eye_yellow"),
        sphere(head + v(-0.05, 0.02, 0.11) * s, 0.02 * s, "eye_yellow"),
        box(head + v(0, 0.05, 0.1) * s, v(0.09, 0.015, 0.03) * s, "demon_dark", rnd=0.01),
    ]
    for side in (1, -1):
        p0 = head + v(0.08 * side, 0.08, 0) * s
        p1 = p0 + v(0.1 * side, 0.1, -0.02) * s
        p2 = p1 + v(0.06 * side, 0.12, -0.08) * s
        p3 = p2 + v(-0.02 * side, 0.08, -0.1) * s
        prims += [capsule(p0, p1, 0.035 * s, "horn", rb=0.028 * s), capsule(p1, p2, 0.028 * s, "horn", rb=0.018 * s),
                  capsule(p2, p3, 0.018 * s, "horn", rb=0.004 * s)]
    return prims


# ---------------------------------------------------------------- small creatures


def slime(i):
    sq = 1 + 0.12 * math.sin(i * math.pi / 2)
    h = 0.26 / sq
    return [
        ellipsoid(v(0, h * 0.9, 0), v(0.3 * sq, h, 0.28 * sq), "slime", op="smooth", k=0.05),
        sphere(v(0.12 * sq, 0.05, 0.15), 0.07, "slime", op="smooth", k=0.06),
        sphere(v(-0.14 * sq, 0.04, 0.05), 0.06, "slime", op="smooth", k=0.06),
        sphere(v(0, h * 0.85, -0.02), 0.09, "slime_core"),
        sphere(v(0.08, h * 1.25, 0.25 * sq), 0.04, "black"),
        sphere(v(-0.08, h * 1.25, 0.25 * sq), 0.04, "black"),
        sphere(v(0.09, h * 1.3, 0.285 * sq), 0.012, "glass"),
        sphere(v(-0.07, h * 1.3, 0.285 * sq), 0.012, "glass"),
    ]


def bat(i):
    flap = math.sin(i * math.pi / 2) * 0.9
    y = 0.62
    prims = [
        ellipsoid(v(0, y, 0), v(0.08, 0.1, 0.08), "bat"),
        sphere(v(0, y + 0.1, 0.03), 0.065, "bat"),
        capsule(v(0.035, y + 0.14, 0.02), v(0.06, y + 0.22, 0.0), 0.02, "bat", rb=0.003),
        capsule(v(-0.035, y + 0.14, 0.02), v(-0.06, y + 0.22, 0.0), 0.02, "bat", rb=0.003),
        sphere(v(0.025, y + 0.11, 0.085), 0.013, "eye_red"),
        sphere(v(-0.025, y + 0.11, 0.085), 0.013, "eye_red"),
        capsule(v(0.01, y + 0.07, 0.08), v(0.012, y + 0.04, 0.085), 0.006, "horn", rb=0.001),
        capsule(v(-0.01, y + 0.07, 0.08), v(-0.012, y + 0.04, 0.085), 0.006, "horn", rb=0.001),
    ]
    for side in (1, -1):
        root = v(0.06 * side, y + 0.03, 0)
        elbow = root + v(0.2 * side, 0.15 * flap + 0.05, -0.02)
        tip = elbow + v(0.18 * side, 0.12 * flap - 0.06, -0.04)
        prims += [capsule(root, elbow, 0.012, "bat"), capsule(elbow, tip, 0.008, "bat", rb=0.002)]
        f = frame_from(np.cross(tip - root, v(0, 0, 1)))
        prims.append(ellipsoid((root + elbow + tip) / 3 + v(0, -0.03, 0), v(0.17, 0.006, 0.1), "bat_wing",
                               rot=rot_z(math.atan2(tip[1] - root[1], tip[0] - root[0]))))
    return prims


def merchant(i):
    sway = math.sin(i * math.pi / 2) * 0.03
    lantern = v(0.24, 0.42 + sway * 0.3, 0.14)
    return [
        capsule(v(0, 0.72, 0), v(0, 0.05, 0), 0.14, "cloth_blue", rb=0.26),
        cylinder(v(0, 0.5, 0), 0.165, 0.025, "leather", rnd=0.006),
        box(v(0, 0.62, -0.2), v(0.15, 0.17, 0.08), "leather", rnd=0.03),
        cylinder(v(0, 0.82, -0.2), 0.06, 0.15, "cloth_red", rot=rot_z(math.pi / 2), rnd=0.03),
        sphere(v(0, 0.86, 0.02), 0.1, "skin"),
        ellipsoid(v(0, 0.78, 0.08), v(0.08, 0.1, 0.05), "hair"),
        sphere(v(0.035, 0.89, 0.09), 0.012, "black"),
        sphere(v(-0.035, 0.89, 0.09), 0.012, "black"),
        sphere(v(0, 0.86, 0.11), 0.022, "skin"),
        cylinder(v(0, 0.96, 0.0), 0.2, 0.012, "darkleather", rnd=0.005),
        capsule(v(0, 0.96, 0), v(0, 1.12, -0.03), 0.09, "darkleather", rb=0.03),
        capsule(v(0.15, 0.72, 0), v(0.22, 0.5, 0.12), 0.05, "cloth_blue", rb=0.06),
        sphere(v(0.22, 0.49, 0.13), 0.035, "skin"),
        capsule(v(0.22, 0.48, 0.13), lantern + v(0, 0.08, 0), 0.006, "darksteel"),
        cylinder(lantern, 0.045, 0.06, "lantern"),
        cylinder(lantern + v(0, 0.07, 0), 0.05, 0.01, "darksteel"),
        cylinder(lantern - v(0, 0.07, 0), 0.05, 0.01, "darksteel"),
        capsule(v(-0.15, 0.72, 0), v(-0.2, 0.25, 0.05), 0.05, "cloth_blue", rb=0.06),
        capsule(v(-0.2, 0.0, 0.05), v(-0.2, 1.05, 0.05), 0.02, "wood"),
        sphere(v(-0.2, 0.25, 0.08), 0.035, "skin"),
    ]


# ---------------------------------------------------------------- props


def prop_barrel(broken=False):
    if broken:
        out = [cylinder(v(0, 0.1, 0), 0.24, 0.1, "wood", rnd=0.01), torus(v(0, 0.17, 0), 0.25, 0.015, "darksteel"),
               cylinder(v(0, 0.19, 0), 0.2, 0.02, "black", op="sub")]
        for k in range(5):
            a = k * 1.3
            out.append(box(v(math.cos(a) * 0.35, 0.02, math.sin(a) * 0.3), v(0.035, 0.012, 0.13), "wood", rot=rot_y(a * 2.1), rnd=0.008))
        return out
    return [
        ellipsoid(v(0, 0.3, 0), v(0.27, 0.36, 0.27), "wood"),
        cylinder(v(0, 0.3, 0), 0.4, 0.28, "wood", op="sub") if False else cylinder(v(0, 0.3, 0), 0.26, 0.29, "wood", rnd=0.03),
        torus(v(0, 0.12, 0), 0.255, 0.015, "darksteel"),
        torus(v(0, 0.48, 0), 0.255, 0.015, "darksteel"),
        cylinder(v(0, 0.59, 0), 0.22, 0.008, "darkwood"),
    ]


def prop_urn(broken=False):
    if broken:
        out = [cylinder(v(0, 0.06, 0), 0.14, 0.06, "clay", rnd=0.02), cylinder(v(0, 0.1, 0), 0.11, 0.06, "black", op="sub")]
        for k in range(6):
            a = k * 1.1
            out.append(box(v(math.cos(a) * 0.25, 0.015, math.sin(a) * 0.22), v(0.05, 0.01, 0.04), "clay", rot=rot_y(a * 3), rnd=0.008))
        return out
    return [
        sphere(v(0, 0.24, 0), 0.19, "clay", op="smooth", k=0.05),
        cylinder(v(0, 0.47, 0), 0.07, 0.07, "clay", op="smooth", k=0.05),
        torus(v(0, 0.54, 0), 0.08, 0.025, "clay"),
        torus(v(0, 0.3, 0), 0.19, 0.012, "gold"),
        cylinder(v(0, 0.06, 0), 0.12, 0.05, "clay"),
    ]


def prop_chest(opened=False):
    out = [
        box(v(0, 0.17, 0), v(0.3, 0.17, 0.2), "wood", rnd=0.015),
        box(v(0, 0.17, 0), v(0.31, 0.03, 0.21), "darksteel", rnd=0.01),
        box(v(0.2, 0.17, 0), v(0.025, 0.175, 0.21), "darksteel", rnd=0.005),
        box(v(-0.2, 0.17, 0), v(0.025, 0.175, 0.21), "darksteel", rnd=0.005),
    ]
    if opened:
        out.append(box(v(0, 0.3, 0), v(0.27, 0.03, 0.17), "black", op="sub"))
        out.append(sphere(v(0, 0.28, 0), 0.2, "coins"))
        out.append(box(v(0, 0.38, -0.25), v(0.3, 0.17, 0.04), "wood", rot=rot_x(-0.3), rnd=0.015))
    else:
        out.append(cylinder(v(0, 0.34, 0), 0.2, 0.3, "wood", rot=rot_z(math.pi / 2), rnd=0.02))
        out.append(box(v(0, 0.34, 0.0), v(0.3, 0.0, 0.2), "wood", rnd=0.0))
        out.append(box(v(0, 0.27, 0.21), v(0.04, 0.05, 0.015), "gold", rnd=0.006))
        out.append(torus(v(0.2, 0.34, 0), 0.2, 0.015, "darksteel", rot=rot_z(math.pi / 2)))
        out.append(torus(v(-0.2, 0.34, 0), 0.2, 0.015, "darksteel", rot=rot_z(math.pi / 2)))
    return out


def prop_shrine():
    return [
        box(v(0, 0.06, 0), v(0.3, 0.06, 0.3), "darkstone", rnd=0.02),
        box(v(0, 0.16, 0), v(0.22, 0.05, 0.22), "stone", rnd=0.02),
        cylinder(v(0, 0.42, 0), 0.08, 0.22, "stone", rnd=0.02),
        cylinder(v(0, 0.66, 0), 0.13, 0.03, "stone", rnd=0.01),
        octa(v(0, 0.86, 0), 0.13, "crystal", rot=rot_y(0.6) @ rot_x(0.5)),
        torus(v(0, 0.68, 0), 0.12, 0.012, "gold"),
    ]


def prop_campfire():
    out = []
    for k in range(9):
        a = k * 2 * math.pi / 9
        out.append(ellipsoid(v(math.cos(a) * 0.3, 0.05, math.sin(a) * 0.3), v(0.08, 0.06, 0.07), "darkstone"))
    for k in range(4):
        a = k * math.pi / 4 + 0.3
        out.append(capsule(v(math.cos(a) * 0.22, 0.04, math.sin(a) * 0.22), v(-math.cos(a) * 0.22, 0.1, -math.sin(a) * 0.22), 0.04, "darkwood"))
    out.append(sphere(v(0, 0.02, 0), 0.12, "crystal_red"))
    return out


def prop_skulls():
    out = []
    for k, (x, y, z) in enumerate([(0, 0.07, 0), (0.12, 0.06, 0.05), (-0.11, 0.06, 0.06), (0.03, 0.18, 0.02), (-0.05, 0.06, -0.1)]):
        c = v(x, y, z)
        out += [sphere(c, 0.07, "bone"), sphere(c + v(0.025, 0, 0.055), 0.02, "black", op="sub"),
                sphere(c + v(-0.025, 0, 0.055), 0.02, "black", op="sub")]
    out.append(capsule(v(-0.25, 0.03, 0.1), v(0.2, 0.03, 0.2), 0.022, "bone"))
    out.append(capsule(v(0.25, 0.03, -0.05), v(0.05, 0.03, 0.22), 0.02, "bone"))
    return out


def prop_crate():
    out = [box(v(0, 0.22, 0), v(0.22, 0.22, 0.22), "wood", rnd=0.01)]
    for x in (-0.2, 0.2):
        for z in (-0.2, 0.2):
            out.append(box(v(x, 0.22, z), v(0.025, 0.225, 0.025), "darkwood", rnd=0.005))
    out.append(box(v(0, 0.22, 0.215), v(0.2, 0.025, 0.012), "darkwood", rot=rot_z(0.78), rnd=0.004))
    return out


def prop_gravestone():
    return [
        box(v(0, 0.3, 0), v(0.18, 0.3, 0.05), "stone", rnd=0.04),
        cylinder(v(0, 0.58, 0), 0.18, 0.05, "stone", rot=rot_x(math.pi / 2), rnd=0.02),
        box(v(0, 0.4, 0.05), v(0.02, 0.12, 0.01), "darkstone", op="sub"),
        box(v(0, 0.45, 0.05), v(0.07, 0.02, 0.01), "darkstone", op="sub"),
        box(v(0, 0.03, 0.1), v(0.24, 0.03, 0.18), "darkstone", rnd=0.02),
    ]


PROPS = [
    ("barrel", lambda: prop_barrel()),
    ("barrel_broken", lambda: prop_barrel(True)),
    ("urn", lambda: prop_urn()),
    ("urn_broken", lambda: prop_urn(True)),
    ("chest", lambda: prop_chest()),
    ("chest_open", lambda: prop_chest(True)),
    ("shrine", prop_shrine),
    ("campfire", prop_campfire),
    ("skulls", prop_skulls),
    ("crate", prop_crate),
    ("gravestone", prop_gravestone),
]

# ---------------------------------------------------------------- item icons


def icon_sword():
    return blade(v(-0.25, -0.25, 0), v(1, 1, 0.0), 0.62, 0.04)


def icon_axe():
    d = norm(v(1, 1, 0))
    return [capsule(v(-0.3, -0.3, 0), v(0.25, 0.25, 0), 0.03, "wood"),
            ellipsoid(v(0.2, 0.32, 0), v(0.16, 0.1, 0.02), "steel", rot=rot_z(-0.6)),
            box(v(0.18, 0.2, 0), v(0.04, 0.06, 0.03), "darksteel", rot=rot_z(0.78), rnd=0.01)]


def icon_mace():
    out = [capsule(v(-0.3, -0.3, 0), v(0.15, 0.15, 0), 0.03, "leather"), sphere(v(0.2, 0.2, 0), 0.12, "darksteel")]
    for k in range(8):
        a = k * math.pi / 4
        o = v(math.cos(a), math.sin(a), 0.4 * ((k % 2) * 2 - 1))
        out.append(capsule(v(0.2, 0.2, 0) + norm(o) * 0.1, v(0.2, 0.2, 0) + norm(o) * 0.18, 0.025, "steel", rb=0.003))
    return out


def icon_helm():
    return [sphere(v(0, 0, 0), 0.24, "steel"), cylinder(v(0, -0.08, 0), 0.25, 0.06, "steel", rnd=0.02),
            box(v(0, 0, 0.22), v(0.14, 0.025, 0.06), "black", op="sub"), torus(v(0, 0.02, 0), 0.24, 0.02, "gold"),
            capsule(v(0, 0.22, 0), v(0, 0.3, -0.2), 0.05, "cloth_red", rb=0.02)]


def icon_armor():
    return [ellipsoid(v(0, 0, 0), v(0.24, 0.28, 0.14), "steel"), sphere(v(0.22, 0.2, 0), 0.1, "steel"),
            sphere(v(-0.22, 0.2, 0), 0.1, "steel"), box(v(0, -0.02, 0.13), v(0.11, 0.2, 0.02), "cloth_red", rnd=0.01),
            cylinder(v(0, -0.2, 0), 0.22, 0.03, "leather")]


def icon_boots():
    out = []
    for x in (-0.14, 0.14):
        out += [capsule(v(x, 0.2, 0), v(x, -0.12, 0), 0.08, "leather"), ellipsoid(v(x, -0.15, 0.08), v(0.09, 0.06, 0.16), "darkleather"),
                torus(v(x, 0.15, 0), 0.085, 0.015, "darksteel")]
    return out


def icon_amulet():
    return [torus(v(0, 0.12, 0), 0.2, 0.012, "gold", rot=rot_x(math.pi / 2)), octa(v(0, -0.15, 0), 0.12, "emerald", rot=rot_z(0.0)),
            torus(v(0, -0.15, 0), 0.1, 0.018, "gold", rot=rot_x(math.pi / 2))]


def icon_ring():
    return [torus(v(0, -0.02, 0), 0.17, 0.045, "gold", rot=rot_x(1.2)), octa(v(0, 0.17, 0.04), 0.08, "ruby")]


def icon_potion():
    return [sphere(v(0, -0.08, 0), 0.2, "glass_red"), cylinder(v(0, 0.17, 0), 0.06, 0.08, "glass"),
            cylinder(v(0, 0.27, 0), 0.07, 0.035, "cork", rnd=0.01), torus(v(0, 0.12, 0), 0.07, 0.015, "gold")]


ICONS = [
    ("sword", icon_sword), ("axe", icon_axe), ("mace", icon_mace), ("helm", icon_helm), ("armor", icon_armor),
    ("boots", icon_boots), ("amulet", icon_amulet), ("ring", icon_ring), ("potion", icon_potion),
]


# ================================================================ v3: weapons, outdoor creatures, world


def _axe(hand, weapon, fore, s, frame):
    d = norm(weapon)
    f = frame_from(d, (0, 0, 1))
    head_c = hand + d * 0.5 * s
    return [
        capsule(hand - d * 0.08 * s, hand + d * 0.56 * s, 0.02 * s, "wood"),
        ellipsoid(head_c + f[:, 0] * 0.07 * s, v(0.09, 0.06, 0.014) * s, "steel", rot=f),
        box(head_c, v(0.03, 0.04, 0.025) * s, "darksteel", rot=f, rnd=0.008),
    ]


def _mace(hand, weapon, fore, s, frame):
    d = norm(weapon)
    f = frame_from(d)
    head = hand + d * 0.42 * s
    out = [capsule(hand - d * 0.07 * s, head, 0.02 * s, "leather"), sphere(head, 0.075 * s, "darksteel")]
    for k in range(6):
        a = k * math.pi / 3
        o = f[:, 0] * math.cos(a) + f[:, 2] * math.sin(a)
        out.append(capsule(head + o * 0.05 * s, head + o * 0.11 * s, 0.018 * s, "steel", rb=0.002 * s))
    out.append(capsule(head + d * 0.05 * s, head + d * 0.12 * s, 0.018 * s, "steel", rb=0.002 * s))
    return out


def _dagger(hand, weapon, fore, s, frame):
    return blade(hand, weapon, 0.24 * s, 0.022 * s, guard="darksteel")


def _spear(hand, weapon, fore, s, frame):
    d = norm(weapon)
    tip = hand + d * 0.78 * s
    return [
        capsule(hand - d * 0.35 * s, tip, 0.016 * s, "wood"),
        capsule(tip, tip + d * 0.15 * s, 0.035 * s, "steel", rb=0.002 * s),
        torus(tip, 0.022 * s, 0.008 * s, "gold", rot=frame_from(d)),
    ]


def _staff(hand, weapon, fore, s, frame):
    d = norm(v(weapon[0] * 0.3, 1.0, weapon[2] * 0.3))
    top = hand + d * 0.55 * s
    return [
        capsule(hand - d * 0.45 * s, top, 0.018 * s, "darkwood"),
        octa(top + d * 0.07 * s, 0.06 * s, "rune_blue", rot=rot_y(0.5)),
        torus(top, 0.035 * s, 0.01 * s, "gold", rot=frame_from(d)),
    ]


HERO_AXE = dict(HERO, right=_axe)
HERO_MACE = dict(HERO, right=_mace)
HERO_DAGGER = dict(HERO, right=_dagger)
HERO_SPEAR = dict(HERO, right=_spear)
HERO_STAFF = dict(HERO, right=_staff, left=None)


def _bandit_torso(T, s, swing):
    return [
        cylinder(T(v(0, 0.49, 0) * s), 0.15 * s, 0.03 * s, "darkleather", rnd=0.01),
        box(T(v(0, 0.41, 0.09) * s), v(0.1, 0.08, 0.018) * s, "leather", rot=rot_x(0.1 * swing), rnd=0.01),
        capsule(T(v(0.15, 0.78, 0.05) * s), T(v(-0.14, 0.5, 0.11) * s), 0.02 * s, "darkleather"),
        box(T(v(0, 0.58, -0.14) * s), v(0.15, 0.22, 0.015) * s, "darkleather", rot=rot_x(-0.25 - 0.15 * abs(swing)), rnd=0.01),
    ]


def _bandit_head(c, s, tw, swing):
    return [
        sphere(c, 0.115 * s, "darkleather"),
        capsule(c + v(0, 0.06, -0.04) * s, c + v(0, 0.02, -0.16) * s, 0.05 * s, "darkleather", rb=0.02 * s),
        sphere(c + v(0, -0.01, 0.07) * s, 0.075 * s, "black", op="sub"),
        sphere(c + v(0, -0.01, 0.02) * s, 0.075 * s, "skin"),
        box(c + v(0, -0.05, 0.08) * s, v(0.07, 0.03, 0.02) * s, "cloth_red", rnd=0.01),
        sphere(c + v(0.03, 0.01, 0.085) * s, 0.012 * s, "black"),
        sphere(c + v(-0.03, 0.01, 0.085) * s, 0.012 * s, "black"),
    ]


BANDIT = dict(
    torso="leather", torso_r=(0.16, 0.19, 0.11), thigh="darkleather", shin="leather", boot="darkleather",
    upper_arm="leather", forearm="darkleather", hand="skin", pauldron=None, neck="skin",
    torso_extra=_bandit_torso, head=_bandit_head, right=_dagger, left=None,
)


def wolf(frame):
    kind, i = frame
    swing, lift = _walk(frame)
    lunge = [0.0, 0.14, 0.06][i] if kind == "atk" else 0.0
    bite = kind == "atk" and i == 1
    prims = [
        ellipsoid(v(0, 0.37, 0.0 + lunge), v(0.12, 0.13, 0.3), "fur"),
        ellipsoid(v(0, 0.42, 0.18 + lunge), v(0.13, 0.15, 0.13), "fur"),
        ellipsoid(v(0, 0.44, 0.08 + lunge), v(0.08, 0.07, 0.2), "fur_dark"),
    ]
    head = v(0, 0.5 - (0.07 if bite else 0), 0.36 + lunge * 1.4)
    prims += [
        ellipsoid(head, v(0.085, 0.08, 0.09), "fur"),
        capsule(head + v(0, -0.02, 0.05), head + v(0, -0.035, 0.18), 0.045, "fur", rb=0.028),
        sphere(head + v(0, -0.03, 0.2), 0.02, "black"),
        capsule(head + v(0.05, 0.05, -0.02), head + v(0.06, 0.13, -0.03), 0.028, "fur_dark", rb=0.004),
        capsule(head + v(-0.05, 0.05, -0.02), head + v(-0.06, 0.13, -0.03), 0.028, "fur_dark", rb=0.004),
        sphere(head + v(0.04, 0.02, 0.07), 0.013, "eye_yellow"),
        sphere(head + v(-0.04, 0.02, 0.07), 0.013, "eye_yellow"),
    ]
    if bite:
        prims.append(capsule(head + v(0, -0.06, 0.04), head + v(0, -0.1, 0.15), 0.025, "fur_dark", rb=0.015))
        prims.append(capsule(head + v(0.015, -0.05, 0.16), head + v(0.015, -0.08, 0.16), 0.006, "bone", rb=0.002))
        prims.append(capsule(head + v(-0.015, -0.05, 0.16), head + v(-0.015, -0.08, 0.16), 0.006, "bone", rb=0.002))
    prims.append(capsule(v(0, 0.42, -0.28), v(0, 0.33 + 0.06 * swing, -0.55), 0.045, "fur", rb=0.02))
    for front in (True, False):
        for side in (1, -1):
            phase = (side > 0) == front
            step = swing * (0.35 if phase else -0.35)
            hip = v(0.08 * side, 0.33, (0.2 if front else -0.18) + (lunge if front else 0))
            knee = hip + v(0.01 * side, -0.16, 0.06 * step / 0.35 + (0.03 if front else -0.04))
            foot = knee + v(0, -0.16, (0.02 if front else 0.05) + 0.05 * step)
            foot[1] = max(foot[1], 0.02)
            prims += [capsule(hip, knee, 0.04, "fur", rb=0.03), capsule(knee, foot, 0.025, "fur_dark", rb=0.022)]
    return prims


# ---------------------------------------------------------------- world sprites


def tree_pine(tall=1.0, seed=0):
    out = [cylinder(v(0, 0.3, 0), 0.07, 0.3, "bark", rnd=0.02)]
    layers = 4
    for k in range(layers):
        y0 = (0.35 + k * 0.38) * tall
        w = (0.62 - k * 0.12) * (1 + 0.05 * math.sin(seed + k))
        out.append(capsule(v(0, y0 + 0.55 * tall, 0), v(0, y0, 0), 0.03, "pine", rb=w))
        out.append(capsule(v(0.02, y0 + 0.5 * tall, 0.03), v(0.02, y0 + 0.02, 0.03), 0.03, "leaf_dark", rb=w * 0.92))
    return out


def tree_oak(seed=0):
    out = [capsule(v(0, 0, 0), v(0, 0.95, 0), 0.13, "bark", rb=0.09),
           capsule(v(0, 0.75, 0), v(0.3, 1.1, 0.1), 0.05, "bark", rb=0.03),
           capsule(v(0, 0.8, 0), v(-0.28, 1.15, -0.05), 0.05, "bark", rb=0.03),
           ellipsoid(v(0, 0.06, 0), v(0.22, 0.06, 0.22), "bark")]
    blobs = [(0, 1.45, 0, 0.48), (0.35, 1.3, 0.1, 0.38), (-0.36, 1.32, -0.05, 0.38), (0.1, 1.25, 0.32, 0.36),
             (-0.12, 1.28, -0.32, 0.36), (0.05, 1.75, 0.05, 0.32)]
    for k, (x, y, z, r) in enumerate(blobs):
        j = math.sin(seed * 3.1 + k) * 0.06
        out.append(sphere(v(x + j, y, z - j), r, "leaf" if k % 2 == 0 else "leaf_dark", op="smooth", k=0.12))
    return out


def tree_dead():
    out = [capsule(v(0, 0, 0), v(0.05, 1.2, 0), 0.1, "darkwood", rb=0.04),
           ellipsoid(v(0, 0.05, 0), v(0.18, 0.05, 0.18), "darkwood")]
    for (a, y, l) in [(0.6, 0.7, 0.45), (2.4, 0.9, 0.4), (4.2, 1.05, 0.35), (1.3, 1.15, 0.3)]:
        base = v(0.03, y, 0)
        tip = base + v(math.cos(a) * l, 0.25, math.sin(a) * l)
        out.append(capsule(base, tip, 0.04, "darkwood", rb=0.01))
    return out


def bush():
    out = []
    for k, (x, y, z, r) in enumerate([(0, 0.22, 0, 0.26), (0.2, 0.16, 0.08, 0.2), (-0.2, 0.17, -0.05, 0.2), (0.05, 0.15, 0.22, 0.18)]):
        out.append(sphere(v(x, y, z), r, "leaf" if k % 2 else "leaf_dark", op="smooth", k=0.08))
    for (x, z) in [(0.1, 0.25), (-0.15, 0.15), (0.2, -0.05)]:
        out.append(sphere(v(x, 0.3, z), 0.03, "ruby"))
    return out


def rock(seed=0):
    out = []
    for k, (x, y, z, rx, ry, rz) in enumerate([(0, 0.2, 0, 0.42, 0.3, 0.36), (0.25, 0.12, 0.15, 0.25, 0.18, 0.22),
                                                (-0.22, 0.1, 0.1, 0.22, 0.15, 0.2)]):
        j = math.sin(seed + k) * 0.05
        out.append(ellipsoid(v(x + j, y, z), v(rx, ry, rz), "stone", rot=rot_y(seed + k), op="smooth", k=0.06))
    out.append(ellipsoid(v(0, 0.42, -0.02), v(0.28, 0.08, 0.24), "moss", op="smooth", k=0.04))
    return out


def stump():
    return [cylinder(v(0, 0.14, 0), 0.2, 0.14, "bark", rnd=0.03), cylinder(v(0, 0.29, 0), 0.17, 0.01, "wood"),
            torus(v(0, 0.29, 0), 0.1, 0.01, "darkwood"), capsule(v(0.15, 0.03, 0.1), v(0.32, 0.01, 0.2), 0.04, "bark", rb=0.015),
            capsule(v(-0.15, 0.03, 0.05), v(-0.3, 0.01, 0.12), 0.04, "bark", rb=0.015)]


def ruin_pillar():
    return [box(v(0, 0.06, 0), v(0.22, 0.06, 0.22), "darkstone", rnd=0.02),
            cylinder(v(0, 0.55, 0), 0.14, 0.5, "stone", rnd=0.02),
            box(v(0, 1.04, 0.02), v(0.13, 0.04, 0.12), "stone", rot=rot_z(0.3), op="sub"),
            ellipsoid(v(0.05, 0.3, 0.12), v(0.1, 0.18, 0.04), "moss"),
            box(v(0.35, 0.06, 0.2), v(0.12, 0.06, 0.09), "stone", rot=rot_y(0.6), rnd=0.02)]


def entrance_crypt():
    out = [box(v(0, 0.04, 0), v(0.75, 0.04, 0.6), "darkstone", rnd=0.02)]
    for side in (1, -1):
        out += [box(v(0.55 * side, 0.55, 0), v(0.13, 0.55, 0.13), "stone", rnd=0.02),
                box(v(0.55 * side, 1.13, 0), v(0.16, 0.05, 0.16), "stone", rnd=0.01)]
    out += [box(v(0, 1.25, 0), v(0.75, 0.1, 0.18), "stone", rnd=0.02),
            box(v(0, 1.42, 0), v(0.2, 0.08, 0.1), "stone", rnd=0.02),
            sphere(v(0, 1.25, 0.17), 0.08, "bone"),
            sphere(v(0.025, 1.26, 0.235), 0.022, "black", op="sub"),
            sphere(v(-0.025, 1.26, 0.235), 0.022, "black", op="sub"),
            box(v(0, 0.02, 0.05), v(0.4, 0.2, 0.45), "black", op="sub")]
    for k in range(4):
        out.append(box(v(0, 0.02 - k * 0.04, 0.35 - k * 0.12), v(0.38, 0.015, 0.06), "darkstone"))
    out.append(ellipsoid(v(0.5, 0.95, 0.1), v(0.1, 0.2, 0.05), "moss"))
    return out


def entrance_cave():
    out = []
    for k, (x, y, z, rx, ry, rz) in enumerate([(0, 0.45, -0.1, 0.9, 0.6, 0.55), (0.7, 0.3, 0.05, 0.45, 0.35, 0.4),
                                                (-0.75, 0.32, 0.0, 0.45, 0.38, 0.4), (0.2, 0.85, -0.2, 0.5, 0.3, 0.4)]):
        out.append(ellipsoid(v(x, y, z), v(rx, ry, rz), "stone" if k % 2 == 0 else "darkstone", rot=rot_y(k * 0.7), op="smooth", k=0.1))
    out.append(ellipsoid(v(0, 0.3, 0.38), v(0.42, 0.42, 0.4), "black", op="sub"))
    out.append(ellipsoid(v(0, 1.0, -0.1), v(0.5, 0.08, 0.3), "moss"))
    for x in (-0.25, 0.0, 0.22):
        out.append(capsule(v(x, 0.68, 0.32), v(x, 0.55 - abs(x) * 0.2, 0.36), 0.03, "stone", rb=0.003))
    return out


def entrance_portal():
    out = [cylinder(v(0, 0.05, 0), 0.75, 0.05, "darkstone", rnd=0.02)]
    for k in range(8):
        a = k * math.pi / 4
        out.append(capsule(v(math.cos(a) * 0.7, 0.05, math.sin(a) * 0.7), v(math.cos(a) * 0.68, 0.45 + 0.1 * (k % 2), math.sin(a) * 0.68),
                           0.06, "demon_dark", rb=0.01))
    out += [torus(v(0, 0.9, 0), 0.5, 0.07, "darkstone", rot=rot_x(math.pi / 2)),
            cylinder(v(0, 0.9, 0), 0.46, 0.015, "portal", rot=rot_x(math.pi / 2)),
            sphere(v(0, 1.43, 0), 0.07, "crystal_red")]
    for side in (1, -1):
        out.append(capsule(v(0.45 * side, 0.05, 0), v(0.45 * side, 0.7, 0), 0.07, "darkstone"))
    return out


def signpost():
    return [capsule(v(0, 0, 0), v(0, 0.9, 0), 0.035, "wood"),
            box(v(0.15, 0.78, 0.0), v(0.18, 0.05, 0.015), "wood", rot=rot_y(0.3), rnd=0.01),
            box(v(-0.12, 0.62, 0.0), v(0.16, 0.045, 0.015), "wood", rot=rot_y(-0.5), rnd=0.01)]


WORLD = [
    ("pine", lambda: tree_pine(1.0, 0)), ("pine_tall", lambda: tree_pine(1.18, 2)), ("oak", lambda: tree_oak(0)),
    ("oak2", lambda: tree_oak(4)), ("dead", tree_dead), ("bush", bush), ("rock", lambda: rock(0)), ("rock2", lambda: rock(2.5)),
    ("stump", stump), ("pillar", ruin_pillar), ("crypt", entrance_crypt), ("cave", entrance_cave), ("portal", entrance_portal),
    ("sign", signpost),
]


# ---------------------------------------------------------------- extra icons (appended after the original nine)


def icon_dagger():
    return blade(v(-0.15, -0.15, 0), v(1, 1, 0.0), 0.36, 0.035, guard="darksteel")


def icon_spear():
    d = norm(v(1, 1, 0))
    tip = v(0.25, 0.25, 0)
    return [capsule(v(-0.35, -0.35, 0), tip, 0.022, "wood"), capsule(tip, tip + d * 0.16, 0.05, "steel", rb=0.003),
            torus(tip, 0.03, 0.01, "gold", rot=frame_from(d))]


def icon_staff():
    return [capsule(v(-0.3, -0.38, 0), v(0.18, 0.25, 0), 0.025, "darkwood"), octa(v(0.24, 0.33, 0), 0.09, "rune_blue", rot=rot_y(0.5)),
            torus(v(0.18, 0.25, 0), 0.05, 0.014, "gold", rot=frame_from(v(1, 1.3, 0)))]


def icon_shield():
    f = frame_from(v(0, 0.2, 1))
    return [cylinder(v(0, 0, 0), 0.3, 0.035, "cloth_blue", rot=f, rnd=0.01), torus(v(0, 0, 0), 0.29, 0.03, "darksteel", rot=f),
            sphere(v(0, 0.01, 0.04), 0.07, "gold"), box(v(0, 0, 0.04), v(0.2, 0.03, 0.015), "gold", rot=f)]


def icon_gloves():
    out = []
    for x, a in ((-0.15, 0.25), (0.15, -0.25)):
        out += [ellipsoid(v(x, 0.0, 0), v(0.1, 0.14, 0.06), "leather", rot=rot_z(a)),
                cylinder(v(x - a * 0.3, -0.17, 0), 0.09, 0.05, "darksteel", rot=rot_z(a), rnd=0.01)]
        for k in range(4):
            out.append(capsule(v(x + (k - 1.5) * 0.045, 0.1, 0.0), v(x + (k - 1.5) * 0.05 - a * 0.2, 0.22, 0.0), 0.022, "leather"))
    return out


def icon_hood():
    return [sphere(v(0, 0, 0), 0.24, "darkleather"), capsule(v(0, 0.1, -0.12), v(0, -0.02, -0.32), 0.1, "darkleather", rb=0.04),
            sphere(v(0, -0.03, 0.15), 0.17, "black", op="sub"), cylinder(v(0, -0.2, 0), 0.24, 0.04, "leather", rnd=0.02)]


def icon_leather():
    return [ellipsoid(v(0, 0, 0), v(0.24, 0.28, 0.14), "leather"), cylinder(v(0, -0.17, 0), 0.22, 0.035, "darkleather"),
            capsule(v(0.18, 0.22, 0.08), v(-0.16, -0.08, 0.13), 0.022, "darkleather"), sphere(v(0, -0.17, 0.14), 0.03, "gold")]


def icon_scroll():
    return [cylinder(v(0, 0, 0), 0.08, 0.26, "parchment", rot=rot_z(0.9)), cylinder(v(0.2, 0.15, 0), 0.09, 0.03, "darkwood", rot=rot_z(0.9)),
            cylinder(v(-0.2, -0.15, 0), 0.09, 0.03, "darkwood", rot=rot_z(0.9)), torus(v(0, 0, 0), 0.085, 0.012, "cloth_red", rot=rot_z(0.9))]


ICONS += [("dagger", icon_dagger), ("spear", icon_spear), ("staff", icon_staff), ("shield", icon_shield),
          ("gloves", icon_gloves), ("hood", icon_hood), ("leather", icon_leather), ("scroll", icon_scroll)]


# ================================================================ v4: dungeon decor, village, villagers


def prop_brazier():
    out = [capsule(v(0, 0.0, 0), v(0, 0.55, 0), 0.03, "darksteel")]
    for k in range(3):
        a = k * 2 * math.pi / 3
        out.append(capsule(v(math.cos(a) * 0.22, 0.0, math.sin(a) * 0.22), v(0, 0.45, 0), 0.025, "darksteel"))
    out += [cylinder(v(0, 0.6, 0), 0.22, 0.07, "darksteel", rnd=0.02), cylinder(v(0, 0.66, 0), 0.18, 0.03, "coal"),
            torus(v(0, 0.67, 0), 0.21, 0.02, "rust")]
    return out


def prop_column():
    return [box(v(0, 0.08, 0), v(0.28, 0.08, 0.28), "stone", rnd=0.02), cylinder(v(0, 0.9, 0), 0.18, 0.78, "stone", rnd=0.02),
            box(v(0, 1.7, 0), v(0.27, 0.07, 0.27), "stone", rnd=0.02), torus(v(0, 0.2, 0), 0.19, 0.03, "stone"),
            torus(v(0, 1.6, 0), 0.19, 0.03, "stone"), ellipsoid(v(0.1, 0.5, 0.16), v(0.08, 0.2, 0.03), "moss")]


def prop_sarcophagus():
    return [box(v(0, 0.22, 0), v(0.28, 0.22, 0.55), "stone", rnd=0.03), box(v(0, 0.47, 0), v(0.3, 0.05, 0.57), "darkstone", rnd=0.02),
            ellipsoid(v(0, 0.53, -0.32), v(0.1, 0.05, 0.1), "stone"), box(v(0, 0.52, 0.05), v(0.1, 0.03, 0.28), "stone", rnd=0.02),
            box(v(0, 0.55, 0.0), v(0.025, 0.02, 0.18), "gold"), box(v(0, 0.55, 0.0), v(0.1, 0.02, 0.025), "gold")]


def prop_bookshelf():
    out = [box(v(0, 0.55, 0), v(0.45, 0.55, 0.14), "darkwood", rnd=0.01), box(v(0, 0.55, 0.06), v(0.4, 0.5, 0.1), "black", op="sub")]
    mats = ["book_red", "book_blue", "book_green", "leather", "book_red", "parchment"]
    for row, y in enumerate([0.22, 0.55, 0.88]):
        out.append(box(v(0, y - 0.13, 0.02), v(0.41, 0.015, 0.11), "darkwood"))
        x = -0.38
        k = row
        while x < 0.36:
            w = 0.035 + 0.02 * ((k * 7) % 3) / 2
            h = 0.11 + 0.02 * ((k * 5) % 3)
            out.append(box(v(x + w, y - 0.12 + h, 0.03), v(w * 0.9, h, 0.08), mats[k % len(mats)], rnd=0.005))
            x += w * 2 + 0.006
            k += 1
    return out


def prop_weapon_rack():
    out = [box(v(0, 0.06, 0), v(0.42, 0.04, 0.12), "darkwood", rnd=0.01), box(v(0, 0.7, -0.05), v(0.42, 0.03, 0.03), "darkwood"),
           box(v(-0.42, 0.4, -0.05), v(0.03, 0.4, 0.03), "darkwood"), box(v(0.42, 0.4, -0.05), v(0.03, 0.4, 0.03), "darkwood")]
    out += blade(v(-0.22, 0.12, 0.0), v(0, 1, -0.1), 0.6, 0.025)
    out += [capsule(v(0.0, 0.1, 0.0), v(0.02, 0.95, -0.07), 0.015, "wood"), capsule(v(0.02, 0.95, -0.07), v(0.02, 1.08, -0.08), 0.03, "steel", rb=0.002)]
    out += [capsule(v(0.24, 0.1, 0.0), v(0.24, 0.78, -0.05), 0.017, "wood"), ellipsoid(v(0.3, 0.72, -0.05), v(0.08, 0.06, 0.012), "steel")]
    return out


def prop_banner():
    return [capsule(v(0, 0, 0), v(0, 1.35, 0), 0.025, "darkwood"), capsule(v(-0.25, 1.3, 0), v(0.25, 1.3, 0), 0.02, "darkwood"),
            box(v(0, 0.95, 0.01), v(0.23, 0.35, 0.01), "cloth_red", rnd=0.005), box(v(0, 0.6, 0.01), v(0.23, 0.04, 0.01), "cloth_red", rot=rot_z(0.0)),
            octa(v(0, 1.0, 0.03), 0.09, "gold"), sphere(v(0, 1.38, 0), 0.04, "gold"),
            box(v(0, 0.04, 0), v(0.18, 0.04, 0.18), "darkstone", rnd=0.01)]


def prop_stalagmites():
    out = []
    for k, (x, z, h, r) in enumerate([(0, 0, 0.9, 0.16), (0.22, 0.1, 0.55, 0.11), (-0.2, 0.08, 0.6, 0.12), (0.08, -0.18, 0.45, 0.1)]):
        out.append(capsule(v(x, 0, z), v(x * 1.1, h, z), r, "stone" if k % 2 else "darkstone", rb=0.01, op="smooth", k=0.05))
    return out


def prop_crystals():
    out = [ellipsoid(v(0, 0.06, 0), v(0.3, 0.08, 0.25), "darkstone")]
    for k, (x, z, h, a) in enumerate([(0, 0, 0.75, 0.0), (0.16, 0.08, 0.45, 0.4), (-0.15, 0.05, 0.5, -0.4), (0.05, -0.15, 0.4, 0.2)]):
        d = norm(v(math.sin(a), 1, 0.1 * k))
        out.append(capsule(v(x, 0.05, z), v(x, 0.05, z) + d * h, 0.07, "crystal", rb=0.005))
    return out


def prop_mushrooms():
    out = []
    for k, (x, z, h, r) in enumerate([(0, 0, 0.32, 0.14), (0.2, 0.12, 0.22, 0.1), (-0.17, 0.1, 0.18, 0.09), (0.08, -0.16, 0.14, 0.07)]):
        out += [capsule(v(x, 0, z), v(x, h, z), 0.03, "cloth_white"), ellipsoid(v(x, h, z), v(r, r * 0.45, r), "mushroom")]
    return out


def prop_obsidian():
    out = []
    for k, (x, z, h, lean) in enumerate([(0, 0, 0.85, 0.1), (0.2, 0.1, 0.5, 0.35), (-0.22, 0.05, 0.6, -0.3), (0.05, -0.18, 0.4, 0.2)]):
        out.append(capsule(v(x, 0, z), v(x + lean * 0.3, h, z), 0.09, "demon_dark", rb=0.005))
    out.append(ellipsoid(v(0, 0.02, 0), v(0.35, 0.03, 0.3), "coal"))
    return out


def prop_bonepile():
    out = [ellipsoid(v(0, 0.06, 0), v(0.38, 0.08, 0.3), "bone_dark")]
    for k in range(9):
        a = k * 0.7
        x, z = math.cos(a) * 0.22 * (k % 3) / 2, math.sin(a) * 0.18 * (k % 3) / 2
        out.append(capsule(v(x - 0.12, 0.1 + 0.03 * (k % 2), z), v(x + 0.12, 0.12, z + 0.05), 0.02, "bone", rot=None))
    for (x, z) in [(0.0, 0.05), (0.15, -0.08), (-0.14, 0.0)]:
        c = v(x, 0.17, z)
        out += [sphere(c, 0.065, "bone"), sphere(c + v(0.022, 0, 0.05), 0.018, "black", op="sub"), sphere(c + v(-0.022, 0, 0.05), 0.018, "black", op="sub")]
    return out


def prop_cage():
    out = [cylinder(v(0, 0.04, 0), 0.32, 0.04, "darksteel"), cylinder(v(0, 1.0, 0), 0.32, 0.03, "darksteel"),
           capsule(v(0, 1.0, 0), v(0, 1.3, 0), 0.015, "darksteel")]
    for k in range(10):
        a = k * 2 * math.pi / 10
        out.append(capsule(v(math.cos(a) * 0.3, 0.04, math.sin(a) * 0.3), v(math.cos(a) * 0.3, 1.0, math.sin(a) * 0.3), 0.012, "rust"))
    out += [sphere(v(0.05, 0.25, -0.05), 0.07, "bone"), capsule(v(0, 0.08, 0), v(0.05, 0.2, -0.05), 0.03, "bone_dark"),
            capsule(v(-0.1, 0.06, 0.05), v(0.12, 0.06, 0.1), 0.015, "bone")]
    return out


def prop_table():
    out = [box(v(0, 0.42, 0), v(0.45, 0.03, 0.28), "wood", rnd=0.01)]
    for x in (-0.38, 0.38):
        for z in (-0.22, 0.22):
            out.append(box(v(x, 0.2, z), v(0.03, 0.2, 0.03), "darkwood"))
    for (x, z, h) in [(-0.2, 0.05, 0.12), (0.15, -0.08, 0.18), (0.28, 0.1, 0.09)]:
        out += [cylinder(v(x, 0.45 + h / 2, z), 0.025, h / 2, "cloth_white"), sphere(v(x, 0.47 + h, z), 0.018, "candle")]
    out += [box(v(-0.05, 0.47, 0.1), v(0.12, 0.02, 0.09), "parchment", rot=rot_y(0.3)), sphere(v(0.1, 0.5, 0.12), 0.05, "glass_red")]
    return out


def prop_altar():
    out = [box(v(0, 0.06, 0), v(0.5, 0.06, 0.35), "darkstone", rnd=0.02), box(v(0, 0.35, 0), v(0.4, 0.25, 0.25), "stone", rnd=0.02),
           box(v(0, 0.62, 0), v(0.44, 0.03, 0.29), "darkstone", rnd=0.01), ellipsoid(v(0, 0.64, 0.05), v(0.2, 0.01, 0.12), "blood"),
           octa(v(0, 0.8, -0.1), 0.08, "crystal_red", rot=rot_y(0.5))]
    for x in (-0.35, 0.35):
        out += [cylinder(v(x, 0.72, 0.18), 0.03, 0.08, "cloth_white"), sphere(v(x, 0.82, 0.18), 0.02, "candle")]
    return out


PROPS += [
    ("brazier", prop_brazier), ("column", prop_column), ("sarcophagus", prop_sarcophagus), ("bookshelf", prop_bookshelf),
    ("weapon_rack", prop_weapon_rack), ("banner", prop_banner), ("stalagmites", prop_stalagmites), ("crystals", prop_crystals),
    ("mushrooms", prop_mushrooms), ("obsidian", prop_obsidian), ("bonepile", prop_bonepile), ("cage", prop_cage),
    ("table", prop_table), ("altar", prop_altar),
]


# ---------------------------------------------------------------- village buildings (footprint centred on x, front at +z)


def _gable_roof(width, depth, base_y, rise, mat, overhang=0.15):
    """A pitched roof laid in overlapping courses: bundled straw for thatch, rows of split tiles for slate."""
    half_w = width / 2 + overhang
    slope = math.atan2(rise, depth / 2)
    length = math.hypot(rise, depth / 2) + overhang
    rows = 5 if mat == "thatch" else 9
    out = []
    for side in (1, -1):
        c = v(0, base_y + rise / 2, side * depth / 4)
        R = rot_x(side * slope)
        courses = []
        for r in range(rows):
            z = (-0.5 + (r + 0.5) / rows) * length
            lift = 0.035 if mat == "thatch" else 0.018
            # Courses step outwards towards the eaves so each overlaps the one below it.
            local = v(0, lift * (r % 2), z)
            courses.append(box(c + R @ local, v(half_w, 0.06, length / rows * 0.62), mat, rot=R, rnd=0.025 if mat == "thatch" else 0.01))
        if mat == "thatch":
            out.append(group(courses, mat, k=0.03, disp=(26.0, 0.022, 2, 41 + side), scale=(1.0, 0.12, 0.12)))
        else:
            out.append(group(courses, mat, k=0.004, disp=(13.0, 0.012, 1, 43 + side), scale=(1.0, 0.04, 0.04)))
    out.append(capsule(v(-half_w, base_y + rise + 0.02, 0), v(half_w, base_y + rise + 0.02, 0), 0.07, mat))
    return out


def house_timber():
    out = [box(v(0, 0.1, 0), v(1.45, 0.1, 0.95), "darkstone", rnd=0.03), box(v(0, 0.75, 0), v(1.38, 0.62, 0.88), "plaster", rnd=0.01)]
    for x in (-1.38, -0.45, 0.45, 1.38):
        out.append(box(v(x, 0.75, 0.89), v(0.06, 0.62, 0.03), "darkwood"))
    out += [box(v(0, 1.33, 0.89), v(1.42, 0.06, 0.035), "darkwood"), box(v(0, 0.75, 0.89), v(1.42, 0.05, 0.03), "darkwood"),
            box(v(-0.9, 1.05, 0.9), v(0.03, 0.4, 0.02), "darkwood", rot=rot_z(0.6))]
    for x in (-1.38, 1.38):
        out.append(box(v(x, 1.35, 0), v(0.03, 0.7, 0.7), "plaster", rot=rot_x(math.pi / 4)))
    out += _gable_roof(2.8, 1.8, 1.35, 0.95, "thatch", 0.25)
    out += [box(v(0.75, 0.48, 0.9), v(0.24, 0.42, 0.04), "darkwood", rnd=0.01), sphere(v(0.58, 0.48, 0.95), 0.03, "gold"),
            box(v(-0.85, 0.95, 0.9), v(0.26, 0.2, 0.03), "lantern"), box(v(-0.85, 0.95, 0.93), v(0.27, 0.025, 0.02), "darkwood"),
            box(v(-0.85, 0.95, 0.93), v(0.025, 0.21, 0.02), "darkwood"), box(v(0.8, 2.25, -0.35), v(0.16, 0.42, 0.16), "stone", rnd=0.02),
            box(v(-0.3, 0.2, 1.05), v(0.25, 0.12, 0.08), "leaf", rnd=0.05)]
    return out


def house_stone():
    out = [group([box(v(0, 0.55, 0), v(1.4, 0.55, 0.9), "stone", rnd=0.02)], "stone", disp=(9.0, 0.02, 3, 51)),
           box(v(0, 1.35, 0), v(1.35, 0.3, 0.86), "wood", rnd=0.01)]
    for k in range(7):
        out.append(box(v(-1.2 + k * 0.4, 1.35, 0.87), v(0.03, 0.3, 0.02), "darkwood"))
    for x in (-1.36, 1.36):
        out.append(box(v(x, 1.65, 0), v(0.03, 0.62, 0.62), "wood", rot=rot_x(math.pi / 4)))
    out += _gable_roof(2.8, 1.8, 1.65, 0.8, "slate", 0.22)
    out += [box(v(-0.6, 0.5, 0.91), v(0.26, 0.45, 0.04), "darkwood", rnd=0.01), box(v(-0.6, 0.98, 0.91), v(0.3, 0.06, 0.05), "stone"),
            box(v(0.65, 0.6, 0.91), v(0.22, 0.2, 0.03), "lantern"), box(v(0.65, 0.6, 0.94), v(0.24, 0.025, 0.02), "darkwood"),
            box(v(0.1, 1.4, 0.88), v(0.2, 0.15, 0.03), "lantern"), cylinder(v(1.2, 0.25, 1.05), 0.16, 0.25, "wood", rnd=0.02)]
    return out


def smithy():
    out = [box(v(0, 0.06, 0), v(1.45, 0.06, 0.95), "darkstone", rnd=0.02), box(v(0, 0.85, -0.85), v(1.4, 0.8, 0.08), "stone", rnd=0.02)]
    for x in (-1.35, 1.35):
        out.append(box(v(x, 0.85, 0.75), v(0.08, 0.8, 0.08), "darkwood"))
    out.append(box(v(0, 1.75, 0.0), v(1.6, 0.06, 1.05), "slate", rot=rot_x(0.25), rnd=0.02))
    out += [box(v(-0.8, 0.45, -0.55), v(0.45, 0.42, 0.3), "stone", rnd=0.03), box(v(-0.8, 0.55, -0.24), v(0.25, 0.2, 0.05), "coal"),
            box(v(-0.8, 1.5, -0.6), v(0.18, 0.7, 0.18), "stone", rnd=0.02),
            box(v(0.35, 0.3, 0.2), v(0.12, 0.3, 0.12), "darkwood", rnd=0.01), box(v(0.35, 0.65, 0.2), v(0.25, 0.06, 0.1), "darksteel", rnd=0.01),
            capsule(v(0.6, 0.65, 0.2), v(0.75, 0.68, 0.2), 0.05, "darksteel", rb=0.01),
            cylinder(v(1.05, 0.3, 0.45), 0.2, 0.3, "wood", rnd=0.02), cylinder(v(1.05, 0.58, 0.45), 0.17, 0.02, "glass")]
    out += blade(v(0.6, 1.2, -0.75), v(0, -1, 0.05), 0.5, 0.025)
    out += blade(v(0.9, 1.2, -0.75), v(0, -1, 0.05), 0.45, 0.03, mat="darksteel")
    return out


def well():
    return [cylinder(v(0, 0.3, 0), 0.45, 0.3, "stone", rnd=0.03), cylinder(v(0, 0.35, 0), 0.34, 0.3, "black", op="sub"),
            cylinder(v(0, 0.2, 0), 0.34, 0.01, "glass"), box(v(-0.42, 0.85, 0), v(0.05, 0.55, 0.05), "darkwood"),
            box(v(0.42, 0.85, 0), v(0.05, 0.55, 0.05), "darkwood"), capsule(v(-0.42, 1.1, 0), v(0.42, 1.1, 0), 0.04, "wood"),
            box(v(0, 1.45, 0), v(0.55, 0.04, 0.4), "thatch", rot=rot_x(0.0), rnd=0.02), cylinder(v(0.05, 0.85, 0), 0.08, 0.08, "wood")]


def market_stall():
    out = [box(v(0, 0.4, 0), v(0.9, 0.05, 0.4), "wood", rnd=0.01)]
    for x in (-0.85, 0.85):
        for z in (-0.35, 0.35):
            out.append(box(v(x, 0.65 if z < 0 else 0.55, z), v(0.04, 0.65 if z < 0 else 0.55, 0.04), "darkwood"))
    for k in range(6):
        out.append(box(v(-0.8 + k * 0.32, 1.25, 0.05), v(0.16, 0.03, 0.55), "cloth_red" if k % 2 == 0 else "cloth_white", rot=rot_x(0.25), rnd=0.01))
    for k, (x, z, m) in enumerate([(-0.6, 0.1, "ruby"), (-0.45, 0.15, "ruby"), (-0.52, -0.05, "ruby"), (0.0, 0.1, "book_green"),
                                    (0.1, 0.0, "book_green"), (0.5, 0.05, "gold")]):
        out.append(sphere(v(x, 0.5, z), 0.07, m))
    out += [box(v(0.35, 0.55, -0.1), v(0.15, 0.1, 0.12), "parchment", rnd=0.01), box(v(-0.9, 0.2, 0.55), v(0.18, 0.18, 0.18), "wood", rnd=0.01)]
    return out


def hay_cart():
    return [box(v(0, 0.55, 0), v(0.75, 0.08, 0.45), "wood", rnd=0.01), box(v(0, 0.75, 0.42), v(0.75, 0.15, 0.03), "darkwood"),
            box(v(0, 0.75, -0.42), v(0.75, 0.15, 0.03), "darkwood"), ellipsoid(v(0, 0.85, 0), v(0.7, 0.32, 0.42), "thatch"),
            torus(v(-0.4, 0.32, 0.5), 0.3, 0.04, "darkwood", rot=rot_x(math.pi / 2)), torus(v(0.4, 0.32, 0.5), 0.3, 0.04, "darkwood", rot=rot_x(math.pi / 2)),
            capsule(v(0.75, 0.55, 0.1), v(1.3, 0.3, 0.1), 0.03, "wood"), capsule(v(0.75, 0.55, -0.1), v(1.3, 0.3, -0.1), 0.03, "wood")]


def lamp_post():
    return [box(v(0, 0.05, 0), v(0.15, 0.05, 0.15), "darkstone"), capsule(v(0, 0, 0), v(0, 1.5, 0), 0.035, "darksteel"),
            capsule(v(0, 1.5, 0), v(0.25, 1.5, 0), 0.025, "darksteel"), cylinder(v(0.25, 1.35, 0), 0.07, 0.09, "lantern"),
            cylinder(v(0.25, 1.46, 0), 0.09, 0.02, "darksteel")]


def haystack():
    return [ellipsoid(v(0, 0.35, 0), v(0.55, 0.4, 0.5), "thatch"), ellipsoid(v(0.3, 0.2, 0.25), v(0.25, 0.2, 0.22), "thatch"),
            capsule(v(-0.2, 0.5, 0.4), v(0.4, 0.95, -0.1), 0.02, "wood")]


def dummy():
    return [capsule(v(0, 0, 0), v(0, 1.2, 0), 0.04, "wood"), capsule(v(-0.35, 0.95, 0), v(0.35, 0.95, 0), 0.035, "wood"),
            ellipsoid(v(0, 0.85, 0), v(0.2, 0.3, 0.16), "parchment"), sphere(v(0, 1.3, 0), 0.13, "parchment"),
            box(v(0, 0.85, 0.15), v(0.08, 0.08, 0.01), "cloth_red", rot=rot_z(0.78)), box(v(0, 0.05, 0), v(0.2, 0.05, 0.2), "darkwood")]


def tent():
    out = []
    for side in (1, -1):
        out.append(box(v(0, 0.75, side * 0.48), v(1.0, 0.04, 0.72), "cloth_green" if side > 0 else "cloth_white", rot=rot_x(side * 1.0), rnd=0.02))
    out += [capsule(v(-1.0, 0, 0), v(-1.0, 1.35, 0), 0.04, "wood"), capsule(v(1.0, 0, 0), v(1.0, 1.35, 0), 0.04, "wood"),
            capsule(v(-1.05, 1.33, 0), v(1.05, 1.33, 0), 0.04, "wood"), box(v(0, 0.55, 0.62), v(0.3, 0.5, 0.02), "black"),
            box(v(-0.6, 0.18, 1.0), v(0.18, 0.18, 0.18), "wood", rnd=0.01), cylinder(v(0.65, 0.22, 1.0), 0.16, 0.22, "wood", rnd=0.02),
            octa(v(0, 1.45, 0), 0.08, "gold")]
    return out


VILLAGE = [
    ("house_timber", house_timber), ("house_stone", house_stone), ("smithy", smithy), ("well", well),
    ("stall", market_stall), ("cart", hay_cart), ("lamp", lamp_post), ("haystack", haystack), ("dummy", dummy), ("tent", tent),
]


# ---------------------------------------------------------------- villagers


def _apron(T, s, swing):
    return [box(T(v(0, 0.52, 0.12) * s), v(0.13, 0.22, 0.015) * s, "leather", rnd=0.01),
            cylinder(T(v(0, 0.5, 0) * s), 0.16 * s, 0.025 * s, "darkleather", rnd=0.01)]


def _smith_head(c, s, tw, swing):
    return [sphere(c, 0.105 * s, "skin"), ellipsoid(c + v(0, -0.08, 0.06) * s, v(0.08, 0.1, 0.05) * s, "beard_brown"),
            sphere(c + v(0.035, 0.01, 0.09) * s, 0.012 * s, "black"), sphere(c + v(-0.035, 0.01, 0.09) * s, 0.012 * s, "black"),
            sphere(c + v(0, -0.01, 0.105) * s, 0.02 * s, "skin")]


def _hammer(hand, weapon, fore, s, frame):
    d = norm(weapon)
    f = frame_from(d, (0, 0, 1))
    head = hand + d * 0.32 * s
    return [capsule(hand - d * 0.05 * s, head, 0.018 * s, "wood"), box(head, v(0.09, 0.045, 0.045) * s, "darksteel", rot=f, rnd=0.01)]


BLACKSMITH = dict(
    torso="cloth_white", torso_r=(0.18, 0.21, 0.13), width=1.1, thigh="darkleather", shin="leather", boot="darkleather",
    upper_arm="skin", forearm="skin", hand="skin", arm_r=0.055, fore_r=0.05, neck="skin",
    torso_extra=_apron, head=_smith_head, right=_hammer, left=None,
)


def _dress(T, s, swing):
    return [capsule(T(v(0, 0.55, 0) * s), T(v(swing * 0.03, 0.06, 0) * s), 0.15 * s, "cloth_red", rb=0.26 * s),
            cylinder(T(v(0, 0.56, 0) * s), 0.155 * s, 0.02 * s, "leather"),
            box(T(v(0, 0.4, 0.17) * s), v(0.1, 0.16, 0.012) * s, "cloth_white", rnd=0.01)]


def _woman_head(c, s, tw, swing):
    return [sphere(c, 0.1 * s, "skin"), sphere(c + v(0, 0.035, -0.02) * s, 0.105 * s, "cloth_white"),
            sphere(c + v(0, 0.0, 0.05) * s, 0.085 * s, "skin"),
            capsule(c + v(0, -0.02, -0.08) * s, c + v(0, -0.15, -0.1) * s, 0.04 * s, "beard_brown", rb=0.02 * s),
            sphere(c + v(0.032, 0.01, 0.09) * s, 0.011 * s, "black"), sphere(c + v(-0.032, 0.01, 0.09) * s, 0.011 * s, "black")]


def _basket(hand, weapon, fore, s, frame):
    c = hand + v(0, -0.08, 0.02) * s
    return [cylinder(c, 0.09 * s, 0.05 * s, "wood", rnd=0.01), torus(c + v(0, 0.06, 0) * s, 0.08 * s, 0.01 * s, "darkwood", rot=rot_z(math.pi / 2)),
            sphere(c + v(0.02, 0.05, 0) * s, 0.035 * s, "ruby"), sphere(c + v(-0.03, 0.05, 0.02) * s, 0.03 * s, "book_green")]


VILLAGER_F = dict(
    torso="cloth_red", torso_r=(0.15, 0.19, 0.11), thigh="skin", shin="skin", boot="darkleather", thigh_r=0.05, shin_r=0.045,
    upper_arm="cloth_white", forearm="skin", hand="skin", arm_r=0.045, fore_r=0.04, neck="skin",
    torso_extra=_dress, head=_woman_head, right=None, left=_basket,
)


def _tunic(T, s, swing):
    return [box(T(v(0, 0.42, 0.06) * s), v(0.15, 0.1, 0.08) * s, "cloth_green", rot=rot_x(0.1 * swing), rnd=0.03),
            cylinder(T(v(0, 0.5, 0) * s), 0.16 * s, 0.025 * s, "leather")]


def _man_head(c, s, tw, swing):
    return [sphere(c, 0.1 * s, "skin"), cylinder(c + v(0, 0.06, 0) * s, 0.105 * s, 0.04 * s, "leather", rnd=0.02),
            capsule(c + v(0, 0.09, -0.02) * s, c + v(0, 0.12, -0.12) * s, 0.04 * s, "leather", rb=0.01 * s),
            ellipsoid(c + v(0, -0.07, 0.05) * s, v(0.07, 0.06, 0.04) * s, "beard_brown"),
            sphere(c + v(0.032, 0.01, 0.09) * s, 0.011 * s, "black"), sphere(c + v(-0.032, 0.01, 0.09) * s, 0.011 * s, "black")]


VILLAGER_M = dict(
    torso="cloth_green", torso_r=(0.16, 0.2, 0.12), thigh="darkleather", shin="leather", boot="darkleather",
    upper_arm="cloth_green", forearm="skin", hand="skin", neck="skin",
    torso_extra=_tunic, head=_man_head, right=None, left=None,
)


def elder(i):
    sway = math.sin(i * math.pi / 2) * 0.02
    staff_top = v(0.26, 1.22 + sway, 0.12)
    return [
        capsule(v(0, 0.75, 0), v(0, 0.05, 0), 0.14, "cloth_white", rb=0.27),
        cylinder(v(0, 0.52, 0), 0.165, 0.02, "gold", rnd=0.005),
        sphere(v(0, 0.88, 0.02), 0.1, "skin"),
        ellipsoid(v(0, 0.72, 0.09), v(0.08, 0.17, 0.05), "beard"),
        sphere(v(0, 0.93, -0.02), 0.1, "beard"),
        sphere(v(0.035, 0.9, 0.09), 0.012, "black"), sphere(v(-0.035, 0.9, 0.09), 0.012, "black"),
        capsule(v(0.15, 0.75, 0), v(0.25, 0.62, 0.12), 0.05, "cloth_white", rb=0.06),
        sphere(v(0.26, 0.6, 0.13), 0.035, "skin"),
        capsule(v(0.26, 0.0, 0.12), staff_top, 0.02, "darkwood"),
        octa(staff_top + v(0, 0.06, 0), 0.06, "rune_blue", rot=rot_y(0.4)),
        capsule(v(-0.15, 0.75, 0), v(-0.12, 0.45, 0.12), 0.05, "cloth_white", rb=0.06),
        box(v(0, 0.6, 0.16), v(0.03, 0.15, 0.01), "cloth_blue"),
    ]


# ================================================================ v5: more monsters


def ghost(frame):
    kind, i = frame
    swing, lift = _walk(frame)
    hover = 0.25 + 0.04 * math.sin((i + (4 if kind == "atk" else 0)) * math.pi / 2)
    reach = [0.0, 0.3, 0.15][i] if kind == "atk" else 0.0
    out = [
        capsule(v(0, 0.95 + hover, 0), v(swing * 0.05, 0.12 + hover, -0.06), 0.13, "cloth_white", rb=0.24),
        sphere(v(0, 1.05 + hover, 0.0), 0.13, "cloth_white"),
        sphere(v(0, 1.03 + hover, 0.07), 0.095, "black", op="sub"),
        sphere(v(0.035, 1.04 + hover, 0.06), 0.017, "rune_blue"),
        sphere(v(-0.035, 1.04 + hover, 0.06), 0.017, "rune_blue"),
    ]
    for k in range(6):
        a = k * math.pi / 3 + swing * 0.3
        out.append(capsule(v(math.cos(a) * 0.2, 0.18 + hover, math.sin(a) * 0.2), v(math.cos(a) * 0.24, 0.0 + hover * 0.6, math.sin(a) * 0.24),
                           0.05, "cloth_white", rb=0.01))
    for side in (1, -1):
        sh = v(0.15 * side, 0.85 + hover, 0)
        hand = sh + v(0.08 * side, -0.25 + reach, 0.12 + reach * 1.2)
        out += [capsule(sh, hand, 0.05, "cloth_white", rb=0.035), capsule(hand, hand + v(0.02 * side, -0.02, 0.08), 0.015, "bone_dark", rb=0.004)]
    return out


def imp(frame):
    kind, i = frame
    swing, lift = _walk(frame)
    s = 0.62
    b = -0.02 * (1 - lift)
    throw = [0.2, 1.0, 0.5][i] if kind == "atk" else 0.0
    out = [
        ellipsoid(v(0, 0.62 + b, 0) * s, v(0.18, 0.2, 0.15) * s, "demon"),
        ellipsoid(v(0, 0.42 + b, 0.02) * s, v(0.14, 0.12, 0.12) * s, "demon_dark"),
        sphere(v(0, 0.92 + b, 0.04) * s, 0.15 * s, "demon"),
        sphere(v(0.05, 0.95 + b, 0.17) * s, 0.025 * s, "eye_yellow"),
        sphere(v(-0.05, 0.95 + b, 0.17) * s, 0.025 * s, "eye_yellow"),
        box(v(0, 0.85 + b, 0.15) * s, v(0.06, 0.015, 0.02) * s, "black"),
        capsule(v(0, 0.45, -0.12) * s, v(0.1 * swing, 0.3, -0.45) * s, 0.03 * s, "demon_dark", rb=0.01 * s),
        octa(v(0.1 * swing, 0.3, -0.48) * s, 0.05 * s, "demon_dark"),
    ]
    for side in (1, -1):
        h0 = v(0.08 * side, 1.02 + b, 0.02) * s
        out.append(capsule(h0, h0 + v(0.08 * side, 0.14, -0.05) * s, 0.03 * s, "horn", rb=0.005 * s))
        root = v(0.1 * side, 0.7 + b, -0.12) * s
        tip = root + v(0.35 * side, 0.25 + 0.1 * swing, -0.15) * s
        out += [capsule(root, tip, 0.02 * s, "demon_dark"), ellipsoid((root + tip) / 2 + v(0, -0.06, 0) * s, v(0.16, 0.01, 0.1) * s, "bat_wing",
                                                                     rot=rot_z(0.6 * side))]
        a = swing * 0.5 * side
        hip = v(0.08 * side, 0.4 + b, 0) * s
        foot = hip + v(0, -0.38 * math.cos(a), 0.38 * math.sin(a)) * s
        foot[1] = max(foot[1], 0.02)
        out.append(capsule(hip, foot, 0.04 * s, "demon_dark"))
    hand_r = v(0.2, 0.62 + 0.4 * throw, 0.1 + 0.15 * throw) * s
    out += [capsule(v(0.16, 0.72, 0) * s, hand_r, 0.035 * s, "demon"), capsule(v(-0.16, 0.72, 0) * s, v(-0.22, 0.48, 0.06) * s, 0.035 * s, "demon")]
    if kind == "atk":
        out.append(sphere(hand_r + v(0, 0.06, 0.02) * s, 0.06 * s, "coal"))
    return out


def _goblin_head(c, s, tw, swing):
    return [
        sphere(c, 0.12 * s, "orc"),
        capsule(c + v(0, 0.0, 0.1) * s, c + v(0, -0.04, 0.17) * s, 0.03 * s, "orc_dark", rb=0.015 * s),
        capsule(c + v(0.1, 0.02, 0) * s, c + v(0.24, 0.07, -0.04) * s, 0.04 * s, "orc", rb=0.006 * s),
        capsule(c + v(-0.1, 0.02, 0) * s, c + v(-0.24, 0.07, -0.04) * s, 0.04 * s, "orc", rb=0.006 * s),
        sphere(c + v(0.045, 0.03, 0.1) * s, 0.02 * s, "eye_yellow"),
        sphere(c + v(-0.045, 0.03, 0.1) * s, 0.02 * s, "eye_yellow"),
        box(c + v(0, -0.06, 0.1) * s, v(0.05, 0.01, 0.01) * s, "black"),
        cylinder(c + v(0, 0.09, 0) * s, 0.09 * s, 0.03 * s, "darkleather", rnd=0.02),
    ]


def _goblin_vest(T, s, swing):
    return [box(T(v(0, 0.6, 0.06) * s), v(0.15, 0.17, 0.06) * s, "darkleather", rnd=0.04),
            cylinder(T(v(0, 0.47, 0) * s), 0.15 * s, 0.03 * s, "leather"),
            ellipsoid(T(v(-0.12, 0.45, -0.1) * s), v(0.08, 0.1, 0.06) * s, "parchment")]


GOBLIN = dict(
    scale=0.74, torso="orc", torso_r=(0.15, 0.18, 0.11), thigh="orc_dark", shin="orc", boot=None,
    upper_arm="orc", forearm="orc", hand="orc_dark", neck="orc", head_y=0.9,
    torso_extra=_goblin_vest, head=_goblin_head, right=_dagger, left=None,
)
