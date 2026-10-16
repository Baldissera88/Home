"""Playable hero classes: models, weapons and attack animations for the 16-frame hero sheets."""
import math

import numpy as np

import models as M
from models import blade
from sdf import box, capsule, cylinder, ellipsoid, frame_from, norm, octa, rot_x, rot_y, rot_z, sphere, torus, v

# ---------------------------------------------------------------- knight (the original hero)

KNIGHT_SWORD = dict(M.HERO, atk_lunge=[0.0, 0.08, 0.04], atk_lean=[-0.08, 0.12, 0.18])
KNIGHT_MACE = dict(M.HERO_MACE, atk_lunge=[0.0, 0.08, 0.04], atk_lean=[-0.08, 0.12, 0.18])
KNIGHT_SPEAR = dict(
    M.HERO_SPEAR,
    atk_right=[
        (v(0.3, -0.6, -0.6), v(0.1, -0.1, 1.0), v(0.05, 0.05, 1.0)),
        (v(0.15, -0.15, 1.0), v(0.0, 0.0, 1.0), v(0.0, 0.0, 1.0)),
        (v(0.3, -0.5, 0.2), v(0.1, -0.2, 1.0), v(0.05, 0.1, 1.0)),
    ],
    atk_twist=[0.35, -0.15, 0.0], atk_lunge=[-0.03, 0.12, 0.02], atk_lean=[0.0, 0.15, 0.05],
)

# ---------------------------------------------------------------- barbarian


def _barb_torso(T, s, swing):
    return [
        # Bare, broad chest with a fur mantle over the shoulders and a crossing strap.
        ellipsoid(T(v(0, 0.66, 0.02) * s), v(0.185, 0.17, 0.12) * s, "skin_tan"),
        ellipsoid(T(v(0, 0.79, -0.02) * s), v(0.24, 0.07, 0.15) * s, "fur"),
        box(T(v(0, 0.64, 0.115) * s), v(0.02, 0.17, 0.012) * s, "darkleather", rot=rot_z(0.6), rnd=0.006),
        cylinder(T(v(0, 0.5, 0) * s), 0.16 * s, 0.045 * s, "darkleather", rnd=0.01),
        sphere(T(v(0, 0.5, 0.155) * s), 0.03 * s, "steel"),
        # Fur kilt.
        capsule(T(v(0, 0.47, 0) * s), T(v(0, 0.36, 0.02 * swing) * s), 0.15 * s, "fur_light", rb=0.17 * s),
    ]


def _barb_head(c, s, tw, swing):
    out = [
        # Iron cap with curved horns (cut open first, then the face goes in).
        sphere(c + v(0, 0.03, -0.005) * s, 0.108 * s, "darksteel"),
        box(c + v(0, -0.04, 0.0) * s, v(0.13, 0.07, 0.13) * s, "black", op="sub"),
        sphere(c, 0.1 * s, "skin_tan"),
        torus(c + v(0, 0.035, 0) * s, 0.103 * s, 0.014 * s, "steel"),
        # Braided beard.
        ellipsoid(c + v(0, -0.07, 0.07) * s, v(0.07, 0.07, 0.05) * s, "hair_red"),
        capsule(c + v(0, -0.11, 0.08) * s, c + v(0, -0.2, 0.09) * s, 0.025 * s, "hair_red", rb=0.012 * s),
        sphere(c + v(0.035, 0.0, 0.088) * s, 0.012 * s, "black"),
        sphere(c + v(-0.035, 0.0, 0.088) * s, 0.012 * s, "black"),
        box(c + v(0, 0.022, 0.09) * s, v(0.06, 0.008, 0.012) * s, "hair_red", rot=rot_x(0.2)),
    ]
    for side in (1, -1):
        root = c + v(0.09 * side, 0.06, 0) * s
        mid = root + v(0.09 * side, 0.03, 0.01) * s
        tip = mid + v(0.03 * side, 0.09, 0.03) * s
        out += [capsule(root, mid, 0.026 * s, "horn", rb=0.02 * s), capsule(mid, tip, 0.02 * s, "horn", rb=0.006 * s)]
    return out


def _great_axe(hand, weapon, fore, s, frame):
    d = norm(weapon)
    f = frame_from(d, (0, 0, 1))
    head_c = hand + d * 0.62 * s
    out = [capsule(hand - d * 0.22 * s, hand + d * 0.7 * s, 0.022 * s, "darkwood")]
    for side in (1, -1):
        out.append(ellipsoid(head_c + f[:, 0] * 0.085 * side * s, v(0.1, 0.085, 0.014) * s, "steel", rot=f))
    out += [box(head_c, v(0.035, 0.05, 0.028) * s, "darksteel", rot=f, rnd=0.008),
            torus(hand + d * 0.1 * s, 0.026 * s, 0.008 * s, "leather", rot=f)]
    return out


def _great_sword(hand, weapon, fore, s, frame):
    return blade(hand, weapon, 0.72 * s, 0.036 * s, guard="darksteel")


def _maul(hand, weapon, fore, s, frame):
    d = norm(weapon)
    f = frame_from(d, (0, 0, 1))
    head = hand + d * 0.6 * s
    return [
        capsule(hand - d * 0.2 * s, head, 0.022 * s, "darkwood"),
        box(head, v(0.12, 0.07, 0.07) * s, "darksteel", rot=f, rnd=0.02),
        box(head, v(0.125, 0.02, 0.075) * s, "steel", rot=f, rnd=0.006),
    ]


CHOP = [
    (v(0.22, 0.62, -0.55), v(0.05, 0.6, -0.8), v(0.0, 0.15, -0.99)),
    (v(0.12, 0.25, 0.95), v(0.0, -0.15, 1.0), v(0.0, -0.3, 0.95)),
    (v(0.1, -0.5, 0.8), v(0.0, -0.75, 0.6), v(0.0, -0.95, 0.25)),
]
CHOP_LEFT = [
    (v(-0.15, 0.62, -0.5), v(0.1, 0.6, -0.75), v(0.0, 1.0, 0.0)),
    (v(-0.1, 0.25, 0.95), v(0.1, -0.15, 1.0), v(0.0, 1.0, 0.0)),
    (v(-0.1, -0.5, 0.8), v(0.08, -0.7, 0.65), v(0.0, 1.0, 0.0)),
]
BARBARIAN = dict(
    scale=1.1, width=1.12, torso="skin_tan", torso_r=(0.19, 0.2, 0.13), thigh="leather", shin="fur_dark", boot="darkleather",
    upper_arm="skin_tan", forearm="skin_tan", hand="darkleather", arm_r=0.062, fore_r=0.054, hand_r=0.05,
    pauldron="fur", pauldron_s=1.15, torso_extra=_barb_torso, head=_barb_head, right=_great_axe, left=None, neck="skin_tan",
    rest_weapon=v(0.3, -0.45, 0.85), atk_right=CHOP, atk_left=CHOP_LEFT, atk_twist=[0.1, -0.05, -0.12], atk_lunge=[-0.04, 0.1, 0.12], atk_lean=[-0.15, 0.2, 0.35],
)
BARBARIAN_SWORD = dict(BARBARIAN, right=_great_sword)
BARBARIAN_MACE = dict(BARBARIAN, right=_maul)

# ---------------------------------------------------------------- assassin


def _assassin_torso(T, s, swing):
    return [
        box(T(v(0, 0.62, 0.1) * s), v(0.12, 0.15, 0.025) * s, "darkleather", rnd=0.02),
        box(T(v(0, 0.62, 0.118) * s), v(0.02, 0.15, 0.01) * s, "cloth_red", rot=rot_z(-0.55), rnd=0.004),
        cylinder(T(v(0, 0.49, 0) * s), 0.135 * s, 0.03 * s, "darkleather", rnd=0.01),
        box(T(v(0.1, 0.47, 0.08) * s), v(0.03, 0.035, 0.025) * s, "leather", rnd=0.01),
        box(T(v(-0.1, 0.47, 0.08) * s), v(0.03, 0.035, 0.025) * s, "leather", rnd=0.01),
        # Short cloak trailing behind.
        box(T(v(0, 0.56, -0.13) * s), v(0.13, 0.22, 0.012) * s, "cloth_dark", rot=rot_x(-0.25 - 0.2 * abs(swing)), rnd=0.01),
        # Scarf tail.
        capsule(T(v(0.03, 0.8, -0.08) * s), T(v(0.08, 0.66, -0.26 - 0.04 * swing) * s), 0.028 * s, "cloth_red", rb=0.012 * s),
    ]


def _assassin_head(c, s, tw, swing):
    return [
        sphere(c, 0.095 * s, "skin"),
        # Deep hood.
        ellipsoid(c + v(0, 0.02, -0.015) * s, v(0.125, 0.13, 0.13) * s, "cloth_dark"),
        ellipsoid(c + v(0, -0.01, 0.1) * s, v(0.075, 0.085, 0.07) * s, "black", op="sub"),
        capsule(c + v(0, 0.08, -0.08) * s, c + v(0, 0.02, -0.2) * s, 0.04 * s, "cloth_dark", rb=0.015 * s),
        # Mask over the lower face and two glinting eyes.
        ellipsoid(c + v(0, -0.045, 0.06) * s, v(0.075, 0.045, 0.055) * s, "cloth_red"),
        sphere(c + v(0.032, 0.012, 0.085) * s, 0.012 * s, "eye_yellow"),
        sphere(c + v(-0.032, 0.012, 0.085) * s, 0.012 * s, "eye_yellow"),
    ]


def _curved_dagger(hand, weapon, fore, s, frame):
    return blade(hand, weapon, 0.3 * s, 0.024 * s, mat="steel", guard="darksteel", grip="darkleather")


STAB_RIGHT = [
    (v(0.3, -0.8, -0.4), v(0.1, -0.15, 1.0), v(0.05, 0.05, 1.0)),
    (v(0.12, -0.05, 1.0), v(0.0, 0.05, 1.0), v(0.0, 0.0, 1.0)),
    (v(0.3, -0.8, -0.4), v(0.1, -0.15, 1.0), v(0.05, 0.05, 1.0)),
]
STAB_LEFT = [
    (v(-0.12, -0.05, 1.0), v(0.0, 0.05, 1.0), v(0.0, 0.0, 1.0)),
    (v(-0.3, -0.8, -0.4), v(-0.1, -0.15, 1.0), v(-0.05, 0.05, 1.0)),
    (v(-0.12, -0.05, 1.0), v(0.0, 0.05, 1.0), v(0.0, 0.0, 1.0)),
]
ASSASSIN = dict(
    scale=0.97, width=0.92, hip=0.46, lean=0.12, torso="darkleather", torso_r=(0.15, 0.19, 0.11), thigh="cloth_dark", shin="darkleather",
    boot="black", upper_arm="cloth_dark", forearm="darkleather", hand="black", arm_r=0.045, fore_r=0.042, hand_r=0.04,
    torso_extra=_assassin_torso, head=_assassin_head, right=_curved_dagger, left=_curved_dagger, neck="cloth_dark",
    rest_weapon=v(0.15, -0.35, 0.95), atk_right=STAB_RIGHT, atk_left=STAB_LEFT, atk_twist=[-0.35, 0.35, -0.35], atk_lunge=[0.04, 0.1, 0.04], atk_lean=[0.1, 0.15, 0.1],
)

# ---------------------------------------------------------------- sorceress


def _robe_skirt(s, swing, frame):
    sway = 0.04 * swing
    return [
        capsule(v(0, 0.5, 0) * s, v(sway * 0.5, 0.07, 0.02 + sway) * s, 0.125 * s, "cloth_violet", rb=0.165 * s),
        torus(v(sway * 0.5, 0.09, 0.02 + sway) * s, 0.155 * s, 0.016 * s, "gold", rot=rot_x(0.0)),
    ]


def _sorc_torso(T, s, swing):
    return [
        ellipsoid(T(v(0, 0.64, 0.01) * s), v(0.14, 0.16, 0.1) * s, "cloth_violet"),
        box(T(v(0, 0.62, 0.09) * s), v(0.05, 0.13, 0.012) * s, "gold", rnd=0.01),
        sphere(T(v(0, 0.7, 0.1) * s), 0.025 * s, "arcane"),
        cylinder(T(v(0, 0.51, 0) * s), 0.13 * s, 0.025 * s, "gold", rnd=0.01),
        # Mantle over the shoulders and a long cape.
        ellipsoid(T(v(0, 0.77, -0.02) * s), v(0.2, 0.06, 0.13) * s, "cloth_teal"),
        box(T(v(0, 0.5, -0.12) * s), v(0.15, 0.32, 0.012) * s, "cloth_teal", rot=rot_x(-0.12 - 0.12 * abs(swing)), rnd=0.01),
    ]


def _sorc_head(c, s, tw, swing):
    return [
        # Long red hair falling down the back, opened at the front for the face.
        ellipsoid(c + v(0, 0.025, -0.02) * s, v(0.1, 0.1, 0.1) * s, "hair_red"),
        ellipsoid(c + v(0, -0.025, 0.08) * s, v(0.08, 0.08, 0.06) * s, "black", op="sub"),
        sphere(c, 0.09 * s, "skin"),
        sphere(c + v(0.03, 0.0, 0.08) * s, 0.01 * s, "black"),
        sphere(c + v(-0.03, 0.0, 0.08) * s, 0.01 * s, "black"),
        capsule(c + v(0, 0.0, -0.07) * s, c + v(0, -0.25, -0.1) * s, 0.065 * s, "hair_red", rb=0.035 * s),
        # Golden circlet with a glowing gem.
        torus(c + v(0, 0.035, 0) * s, 0.095 * s, 0.01 * s, "gold", rot=rot_x(0.15)),
        sphere(c + v(0, 0.05, 0.095) * s, 0.018 * s, "arcane"),
    ]


def _sorc_staff(hand, weapon, fore, s, frame):
    d = norm(v(weapon[0] * 0.6, max(0.35, weapon[1]), weapon[2] * 0.6))
    top = hand + d * 0.62 * s
    f = frame_from(d)
    return [
        capsule(hand - d * 0.42 * s, top, 0.017 * s, "darkwood"),
        torus(top + d * 0.03 * s, 0.05 * s, 0.012 * s, "gold", rot=f),
        capsule(top, top + d * 0.12 * s + f[:, 0] * 0.05 * s, 0.01 * s, "gold"),
        capsule(top, top + d * 0.12 * s - f[:, 0] * 0.05 * s, 0.01 * s, "gold"),
        sphere(top + d * 0.08 * s, 0.045 * s, "arcane"),
    ]


def _tome(hand, weapon, fore, s, frame):
    c = hand + v(0, 0.02, 0.06) * s
    f = frame_from(v(0.2, 0.3, 1.0))
    return [box(c, v(0.06, 0.08, 0.02) * s, "book_blue", rot=f, rnd=0.006), box(c + f[:, 2] * 0.012 * s, v(0.05, 0.07, 0.012) * s, "parchment", rot=f)]


CAST_RIGHT = [
    (v(0.3, 0.55, 0.4), v(0.1, 0.9, 0.4), v(0.0, 1.0, 0.15)),
    (v(0.25, 0.15, 0.95), v(0.05, 0.25, 1.0), v(0.0, 0.55, 0.85)),
    (v(0.2, -0.6, 0.4), v(0.05, -0.2, 0.95), v(0.0, 1.0, 0.2)),
]
CAST_LEFT = [
    (v(-0.3, -0.5, 0.5), v(-0.1, 0.2, 0.95), v(0.0, 1.0, 0.0)),
    (v(-0.25, 0.15, 1.0), v(-0.05, 0.25, 1.0), v(0.0, 1.0, 0.0)),
    (v(-0.25, -0.75, 0.3), v(-0.1, -0.4, 0.9), v(0.0, 1.0, 0.0)),
]
SORCERESS = dict(
    scale=0.96, width=0.9, torso="cloth_violet", torso_r=(0.14, 0.17, 0.1), thigh="cloth_violet", shin="cloth_violet",
    boot="darkleather", upper_arm="cloth_violet", forearm="skin", hand="skin", arm_r=0.045, fore_r=0.037, hand_r=0.038,
    under=_robe_skirt, torso_extra=_sorc_torso, head=_sorc_head, right=_sorc_staff, left=None, neck="skin",
    atk_right=CAST_RIGHT, atk_left=CAST_LEFT, atk_twist=[-0.2, 0.1, 0.0], atk_lunge=[0.0, 0.04, 0.0], atk_lean=[-0.08, 0.08, 0.0],
)

# Sheet name -> spec. Each is rendered with the 16-frame hero layout.
SHEETS = {
    "hero_knight_sword": KNIGHT_SWORD,
    "hero_knight_mace": KNIGHT_MACE,
    "hero_knight_spear": KNIGHT_SPEAR,
    "hero_barbarian_axe": BARBARIAN,
    "hero_barbarian_sword": BARBARIAN_SWORD,
    "hero_barbarian_mace": BARBARIAN_MACE,
    "hero_assassin": ASSASSIN,
    "hero_sorceress": SORCERESS,
}
PORTRAITS = {"knight": KNIGHT_SWORD, "barbarian": BARBARIAN, "assassin": ASSASSIN, "sorceress": SORCERESS}
