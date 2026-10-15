"""Parametric 3D models for the RPG sprites. Units: one floor tile = 1.0, model faces +z."""
import math

import numpy as np

from sdf import (box, capsule, cylinder, ellipsoid, frame_from, norm, octa, rot_x, rot_y, rot_z,
                 sphere, torus, v)

# Animation frames used by every directional sprite sheet (columns of the atlas).
FRAMES = [("idle", 0), ("walk", 0), ("walk", 1), ("walk", 2), ("walk", 3), ("atk", 0), ("atk", 1), ("atk", 2)]


def _walk(frame):
    kind, i = frame
    if kind == "walk":
        ph = i * math.pi / 2 + math.pi / 4
        return math.sin(ph), abs(math.cos(ph))
    return 0.0, 1.0


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


def arm_pose(frame, side, swing):
    """Upper-arm and forearm directions. side=+1 right (weapon) arm, -1 left."""
    kind, i = frame
    if side > 0 and kind == "atk":
        return [
            (v(0.35, 0.75, -0.55), v(0.15, 0.95, -0.25), v(0.05, 0.9, -0.45)),
            (v(0.45, 0.05, 0.9), v(0.15, 0.0, 1.0), v(-0.25, 0.05, 1.0)),
            (v(-0.05, -0.45, 0.8), v(-0.55, -0.3, 0.7), v(-0.95, -0.25, 0.35)),
        ][i]
    up = v(0.18 * side, -math.cos(swing * 0.7), math.sin(swing * 0.7))
    fore = v(0.08 * side, -math.cos(swing * 0.7 + 0.5), math.sin(swing * 0.7 + 0.5))
    weapon = v(0.05 * side, 0.15, 1.0)
    return up, fore, weapon


def humanoid(frame, spec):
    """Generic biped. `spec` controls proportions, materials and gear."""
    s = spec.get("scale", 1.0)
    swing, lift = _walk(frame)
    kind, ai = frame
    twist = {0: -0.35, 1: 0.15, 2: 0.45}[ai] if kind == "atk" else 0.0
    tw = rot_y(twist)
    bob = -0.015 * (1 - lift) * s
    hip_y = spec.get("hip", 0.48) * s + bob
    prims = []

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
        prims.append(capsule(hip, knee, spec.get("thigh_r", 0.06) * s, spec["thigh"]))
        prims.append(capsule(knee, foot, spec.get("shin_r", 0.05) * s, spec["shin"]))
        if spec.get("boot"):
            prims.append(ellipsoid(foot + v(0, 0.01, 0.04) * s, v(0.055, 0.04, 0.09) * s, spec["boot"]))

    # Torso, built around the hips and twisted for attacks.
    def T(p):
        return tw @ (np.asarray(p, dtype=np.float32)) + v(0, bob, 0)

    torso_c = T(v(0, spec.get("chest", 0.66), 0) * s)
    prims.append(ellipsoid(torso_c, v(*spec.get("torso_r", (0.17, 0.2, 0.12))) * s, spec["torso"], rot=tw.T))
    prims.extend(spec.get("torso_extra", lambda T, s, swing: [])(T, s, swing))

    sh_y = spec.get("shoulder", 0.78)
    for side in (1, -1):
        shoulder = T(v(0.18 * side * spec.get("width", 1.0), sh_y, 0) * s)
        up, fore, weapon = arm_pose(frame, side, -swing * side)
        up = tw @ norm(up)
        fore = tw @ norm(fore)
        weapon = tw @ norm(weapon)
        elbow = shoulder + up * 0.2 * s
        hand = elbow + fore * 0.19 * s
        prims.append(capsule(shoulder, elbow, spec.get("arm_r", 0.05) * s, spec["upper_arm"]))
        prims.append(capsule(elbow, hand, spec.get("fore_r", 0.045) * s, spec["forearm"]))
        prims.append(sphere(hand, spec.get("hand_r", 0.045) * s, spec["hand"]))
        if spec.get("pauldron"):
            prims.append(sphere(shoulder + v(0, 0.02, 0) * s, 0.085 * s * spec.get("pauldron_s", 1.0), spec["pauldron"]))
        gear = spec.get("right" if side > 0 else "left")
        if gear:
            prims.extend(gear(hand, weapon, fore, s, frame))

    neck_base = T(v(0, sh_y + 0.02, 0) * s)
    head_c = T(v(0, spec.get("head_y", 0.92), spec.get("head_z", 0.0)) * s)
    prims.append(capsule(neck_base, head_c, 0.045 * s, spec.get("neck", spec["torso"])))
    prims.extend(spec["head"](head_c, s, tw, swing))
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
