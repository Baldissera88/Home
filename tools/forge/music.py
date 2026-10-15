"""Procedurally composed, seamlessly looping soundtrack for Skyggernes Dyb.

Run from the repo root:  python3 tools/forge/music.py
Writes rpg/src/main/res/raw/mus_*.ogg (needs: numpy, soundfile).
"""
import math
import os

import numpy as np
import soundfile as sf

SR = 32000
OUT = os.path.join(os.path.dirname(__file__), "..", "..", "rpg", "src", "main", "res", "raw")


def hz(m):
    return 440.0 * 2 ** ((m - 69) / 12)


class Track:
    def __init__(self, seconds):
        self.n = int(seconds * SR)
        self.tail = int(4 * SR)
        self.buf = np.zeros((self.n + self.tail, 2), dtype=np.float64)

    def add(self, start, sig, pan=0.0, gain=1.0):
        i = int(start * SR)
        if i >= self.n + self.tail:
            return
        sig = sig[: self.n + self.tail - i] * gain
        l = math.cos((pan + 1) * math.pi / 4)
        r = math.sin((pan + 1) * math.pi / 4)
        self.buf[i:i + len(sig), 0] += sig * l
        self.buf[i:i + len(sig), 1] += sig * r

    def finish(self, reverb=0.35, room=1.0):
        wet = np.stack([reverb_mono(self.buf[:, c], room, seed=c) for c in range(2)], axis=1)
        mix = self.buf * (1 - reverb * 0.5) + wet * reverb
        out = mix[: self.n].copy()
        out[: self.tail] += mix[self.n:]  # fold the ringing tail back onto the start for a seamless loop
        peak = np.max(np.abs(out)) + 1e-9
        out = np.tanh(out / peak * 1.3) / math.tanh(1.3) * 0.85
        return out.astype(np.float32)


# ---------------------------------------------------------------- dsp


def _comb(x, d, g):
    y = x.copy()
    for k in range(d, len(y), d):
        e = min(k + d, len(y))
        y[k:e] += g * y[k - d:e - d]
    return y


def _allpass(x, d, g):
    y = np.zeros_like(x)
    y[:d] = -g * x[:d]
    for k in range(d, len(x), d):
        e = min(k + d, len(x))
        y[k:e] = -g * x[k:e] + x[k - d:e - d] + g * y[k - d:e - d]
    return y


def reverb_mono(x, room=1.0, seed=0):
    rng = np.random.default_rng(seed)
    combs = [int(SR * t * room) + int(rng.integers(0, 40)) for t in (0.0297, 0.0371, 0.0411, 0.0437)]
    out = sum(_comb(x, d, 0.78) for d in combs) * 0.25
    for d in (int(SR * 0.005), int(SR * 0.0017)):
        out = _allpass(out, d, 0.7)
    # gentle low-pass so the tail is warm
    k = 4
    out = np.convolve(out, np.ones(k) / k, mode="same")
    return out


def env(n, a, d_rate, release=0.05):
    t = np.arange(n) / SR
    e = np.minimum(1.0, t / max(a, 1e-4)) * np.exp(-t * d_rate)
    r = int(release * SR)
    if r > 0 and n > r:
        e[-r:] *= np.linspace(1, 0, r)
    return e


def pluck(f, dur, bright=1.0):
    n = int(dur * SR)
    t = np.arange(n) / SR
    s = np.zeros(n)
    for k in range(1, 10):
        if f * k > SR / 2.2:
            break
        s += np.sin(2 * math.pi * f * k * t + k) * (bright ** (k - 1)) / k * np.exp(-t * (2.2 + k * 1.6))
    return s * env(n, 0.003, 0.0, 0.05)


def marimba(f, dur):
    n = int(dur * SR)
    t = np.arange(n) / SR
    s = np.sin(2 * math.pi * f * t) * np.exp(-t * 4) + 0.3 * np.sin(2 * math.pi * f * 4 * t) * np.exp(-t * 14)
    return s * env(n, 0.002, 0.0, 0.05)


def pad(freqs, dur, attack=1.2, harmonics=10, bright=0.6):
    n = int(dur * SR)
    t = np.arange(n) / SR
    s = np.zeros(n)
    for f in freqs:
        for det in (-0.004, 0.0, 0.0045):
            ff = f * (1 + det)
            for k in range(1, harmonics + 1):
                if ff * k > SR / 2.5:
                    break
                s += np.sin(2 * math.pi * ff * k * t + det * 300 * k) * (bright ** (k - 1)) / k
    e = np.minimum(1, t / attack) * np.minimum(1, (dur - t) / min(attack, dur / 2))
    return s * np.clip(e, 0, 1) / (len(freqs) * 3)


def choir(freqs, dur, vowel=(800, 1150, 2900), attack=1.5):
    n = int(dur * SR)
    t = np.arange(n) / SR
    s = np.zeros(n)
    vib = 1 + 0.004 * np.sin(2 * math.pi * 5.2 * t)
    for f in freqs:
        for det in (-0.006, 0.0, 0.006):
            ff = f * (1 + det)
            phase = 2 * math.pi * ff * np.cumsum(vib) / SR
            for k in range(1, 30):
                hk = ff * k
                if hk > SR / 2.5:
                    break
                amp = sum(math.exp(-((hk - fm) / (fm * 0.12)) ** 2) * (1.0 / (i + 1)) for i, fm in enumerate(vowel)) + 0.02
                s += np.sin(phase * k) * amp
    e = np.minimum(1, t / attack) * np.minimum(1, (dur - t) / min(attack, dur / 2))
    return s * np.clip(e, 0, 1) / (len(freqs) * 6)


def flute(f, dur, vibrato=0.006):
    n = int(dur * SR)
    t = np.arange(n) / SR
    vib = 1 + vibrato * np.sin(2 * math.pi * 5.0 * t) * np.minimum(1, t / 0.3)
    ph = 2 * math.pi * f * np.cumsum(vib) / SR
    s = np.sin(ph) + 0.25 * np.sin(2 * ph) + 0.08 * np.sin(3 * ph)
    breath = np.convolve(np.random.default_rng(int(f)).normal(0, 1, n), np.ones(8) / 8, mode="same") * 0.06
    e = np.minimum(1, t / 0.07) * np.minimum(1, (dur - t) / 0.08)
    return (s + breath) * np.clip(e, 0, 1) * 0.5


def brass(f, dur, attack=0.06):
    n = int(dur * SR)
    t = np.arange(n) / SR
    bright = 0.55 + 0.25 * np.minimum(1, t / 0.15)
    s = np.zeros(n)
    for k in range(1, 14):
        if f * k > SR / 2.5:
            break
        s += np.sin(2 * math.pi * f * k * t) * bright ** (k - 1) / k
    e = np.minimum(1, t / attack) * np.minimum(1, (dur - t) / 0.06)
    return s * np.clip(e, 0, 1) * 0.5


def bell(f, dur):
    n = int(dur * SR)
    t = np.arange(n) / SR
    idx = 3.0 * np.exp(-t * 3)
    s = np.sin(2 * math.pi * f * t + idx * np.sin(2 * math.pi * f * 1.41 * t))
    return s * np.exp(-t * 1.6) * env(n, 0.002, 0, 0.1)


def drum(kind, dur=0.6, seed=0):
    n = int(dur * SR)
    t = np.arange(n) / SR
    rng = np.random.default_rng(seed)
    noise = rng.normal(0, 1, n)
    if kind == "frame":
        f = 150 * np.exp(-t * 18) + 85
        s = np.sin(2 * math.pi * np.cumsum(f) / SR) * np.exp(-t * 9) + noise * 0.15 * np.exp(-t * 40)
    elif kind == "taiko":
        f = 110 * np.exp(-t * 10) + 55
        s = np.sin(2 * math.pi * np.cumsum(f) / SR) * np.exp(-t * 5) * 1.3 + noise * 0.25 * np.exp(-t * 30)
    elif kind == "timpani":
        f = 70 * (1 + 0.1 * np.exp(-t * 6))
        s = (np.sin(2 * math.pi * np.cumsum(f) / SR) + 0.4 * np.sin(2 * math.pi * np.cumsum(f * 1.5) / SR)) * np.exp(-t * 2.5)
    elif kind == "shaker":
        hp = noise - np.convolve(noise, np.ones(6) / 6, mode="same")
        s = hp * np.exp(-t * 35) * 0.35
    elif kind == "tom":
        f = 180 * np.exp(-t * 12) + 100
        s = np.sin(2 * math.pi * np.cumsum(f) / SR) * np.exp(-t * 10) + noise * 0.1 * np.exp(-t * 50)
    else:
        s = noise * np.exp(-t * 60)
    return s * env(n, 0.001, 0, 0.02)


def drip(f):
    n = int(0.25 * SR)
    t = np.arange(n) / SR
    ff = f * (1 + 0.6 * np.exp(-t * 40))
    return np.sin(2 * math.pi * np.cumsum(ff) / SR) * np.exp(-t * 22) * 0.6


# ---------------------------------------------------------------- composition helpers

SCALES = {
    "dorian": [0, 2, 3, 5, 7, 9, 10],
    "minor": [0, 2, 3, 5, 7, 8, 10],
    "phrygian": [0, 1, 3, 5, 7, 8, 10],
    "penta": [0, 3, 5, 7, 10],
}


def scale_notes(root, mode, lo, hi):
    out = []
    for m in range(lo, hi + 1):
        if (m - root) % 12 in SCALES[mode]:
            out.append(m)
    return out


def melody(rng, chord_tones, scale, beats, start_note, rhythm):
    """Random-walk melody: chord tones on strong beats, stepwise motion otherwise."""
    notes = []
    cur = start_note
    t = 0.0
    for dur in rhythm:
        if t >= beats:
            break
        strong = abs(t - round(t)) < 1e-6 and int(round(t)) % 2 == 0
        if strong:
            cands = [m for m in scale if (m % 12) in chord_tones]
        else:
            cands = scale
        cands = sorted(cands, key=lambda m: abs(m - cur) + rng.random() * 2.5)
        cur = cands[0] if rng.random() < 0.7 else cands[min(1, len(cands) - 1)]
        if rng.random() < 0.12:
            notes.append((t, None, dur))
        else:
            notes.append((t, cur, dur))
        t += dur
    return notes


def chord_midi(root, quality):
    return [root, root + (3 if quality == "m" else 4), root + 7]


# ---------------------------------------------------------------- tracks


def village():
    bpm = 84
    beat = 60 / bpm
    prog = [(62, "m"), (60, ""), (58, ""), (60, "")] * 4  # Dm C Bb C (dorian-folk)
    tr = Track(len(prog) * 4 * beat)
    rng = np.random.default_rng(11)
    scale = scale_notes(62, "dorian", 69, 86)
    for bar, (root, q) in enumerate(prog):
        t0 = bar * 4 * beat
        chord = chord_midi(root, q)
        tr.add(t0, pad([hz(m - 12) for m in chord], 4 * beat, attack=0.8, harmonics=6, bright=0.45), gain=0.35)
        pattern = [chord[0], chord[2], chord[0] + 12, chord[1] + 12, chord[2] + 12, chord[1] + 12, chord[0] + 12, chord[2]]
        for i, m in enumerate(pattern):
            tr.add(t0 + i * beat / 2, pluck(hz(m - 12), 1.2, bright=0.6), pan=-0.35 + 0.1 * (i % 2), gain=0.32)
        for b in range(4):
            if b in (0, 2):
                tr.add(t0 + b * beat, drum("frame", seed=bar * 4 + b), pan=0.1, gain=0.35)
            tr.add(t0 + b * beat + beat / 2, drum("shaker", 0.15, seed=bar * 9 + b), pan=0.4, gain=0.25)
        if bar >= 4:
            rhythm = [1, 0.5, 0.5, 1.5, 0.5] if bar % 2 == 0 else [0.5, 0.5, 1, 2]
            for (bt, m, d) in melody(rng, [x % 12 for x in chord], scale, 4, 74 if bar == 4 else 74, rhythm):
                if m is not None:
                    tr.add(t0 + bt * beat, flute(hz(m), d * beat * 0.95), pan=0.25, gain=0.3)
    return tr.finish(reverb=0.3)


def world():
    bpm = 96
    beat = 60 / bpm
    prog = [(57, "m"), (53, ""), (60, ""), (55, "")] * 4  # Am F C G
    tr = Track(len(prog) * 4 * beat)
    rng = np.random.default_rng(21)
    scale = scale_notes(57, "minor", 69, 88)
    for bar, (root, q) in enumerate(prog):
        t0 = bar * 4 * beat
        chord = chord_midi(root, q)
        tr.add(t0, pad([hz(m - 12) for m in chord], 4 * beat, attack=1.0, harmonics=8, bright=0.5), gain=0.4)
        tr.add(t0, pluck(hz(chord[0] - 24), 2.0, bright=0.4), gain=0.45)
        for i in range(8):
            m = [chord[0], chord[1], chord[2], chord[1] + 12][i % 4]
            tr.add(t0 + i * beat / 2, pluck(hz(m), 0.8, bright=0.7), pan=0.3 - 0.15 * (i % 2), gain=0.22)
        tr.add(t0, drum("taiko", 1.0, seed=bar), gain=0.3)
        tr.add(t0 + 2.5 * beat, drum("tom", 0.6, seed=bar + 50), pan=-0.2, gain=0.22)
        if bar % 8 >= 4:
            rhythm = [1.5, 0.5, 1, 1] if bar % 2 == 0 else [2, 1, 1]
            for (bt, m, d) in melody(rng, [x % 12 for x in chord], scale, 4, 76, rhythm):
                if m is not None:
                    tr.add(t0 + bt * beat, brass(hz(m - 12), d * beat * 0.9), pan=-0.2, gain=0.25)
        elif bar >= 2:
            for (bt, m, d) in melody(rng, [x % 12 for x in chord], scale, 4, 81, [1, 1, 0.5, 0.5, 1]):
                if m is not None:
                    tr.add(t0 + bt * beat, flute(hz(m), d * beat * 0.9), pan=0.3, gain=0.22)
    return tr.finish(reverb=0.35)


def crypt():
    bpm = 60
    beat = 60 / bpm
    prog = [(50, "m"), (46, ""), (43, "m"), (45, "")] * 3  # Dm Bb Gm A
    tr = Track(len(prog) * 4 * beat)
    rng = np.random.default_rng(31)
    pent = scale_notes(62, "minor", 74, 93)
    for bar, (root, q) in enumerate(prog):
        t0 = bar * 4 * beat
        chord = chord_midi(root, q)
        tr.add(t0, pad([hz(38), hz(45)], 4 * beat, attack=2.0, harmonics=6, bright=0.5), gain=0.4)
        tr.add(t0, choir([hz(m) for m in chord], 4 * beat, attack=1.8), gain=0.55 if bar % 2 == 0 else 0.35)
        for _ in range(rng.integers(1, 3)):
            tr.add(t0 + rng.integers(0, 8) * beat / 2, bell(hz(rng.choice(pent)), 3.5), pan=float(rng.uniform(-0.6, 0.6)), gain=0.18)
        if bar % 4 == 0:
            tr.add(t0, drum("timpani", 2.5, seed=bar), gain=0.3)
    return tr.finish(reverb=0.55, room=1.6)


def cave():
    bpm = 70
    beat = 60 / bpm
    bars = 14
    tr = Track(bars * 4 * beat)
    rng = np.random.default_rng(41)
    pent = scale_notes(52, "penta", 64, 84)
    for bar in range(bars):
        t0 = bar * 4 * beat
        tr.add(t0, pad([hz(40), hz(47)], 4 * beat, attack=2.0, harmonics=4, bright=0.4), gain=0.45)
        n_notes = rng.integers(2, 6)
        cur = int(rng.choice(pent))
        for _ in range(n_notes):
            cur = int(sorted(pent, key=lambda m: abs(m - cur) + rng.random() * 6)[1])
            at = t0 + rng.integers(0, 16) * beat / 4
            tr.add(at, marimba(hz(cur), 1.5), pan=float(rng.uniform(-0.5, 0.5)), gain=0.28)
            tr.add(at + beat * 0.75, marimba(hz(cur), 1.5), pan=float(rng.uniform(-0.8, 0.8)), gain=0.1)
        for _ in range(rng.integers(1, 4)):
            tr.add(t0 + rng.random() * 4 * beat, drip(float(rng.uniform(1400, 2600))), pan=float(rng.uniform(-0.9, 0.9)), gain=0.25)
    return tr.finish(reverb=0.6, room=1.8)


def hell():
    bpm = 72
    beat = 60 / bpm
    prog = [(48, "m"), (49, ""), (48, "m"), (46, "")] * 3  # Cm Db Cm Bb (phrygian)
    tr = Track(len(prog) * 4 * beat)
    rng = np.random.default_rng(51)
    for bar, (root, q) in enumerate(prog):
        t0 = bar * 4 * beat
        chord = chord_midi(root, q)
        tr.add(t0, choir([hz(m + 12) for m in chord], 4 * beat, vowel=(500, 900, 2500), attack=1.2), gain=0.5)
        ost = [0, 0, 3, 0, 1, 0, 3, 1]
        for i, o in enumerate(ost):
            tr.add(t0 + i * beat / 2, brass(hz(36 + o + (root - 48)), beat * 0.42, attack=0.02), gain=0.32)
        tr.add(t0, drum("timpani", 2.0, seed=bar), gain=0.45)
        tr.add(t0 + 2 * beat, drum("taiko", 1.0, seed=bar + 7), gain=0.35)
        if rng.random() < 0.5:
            tr.add(t0 + 3.5 * beat, drum("taiko", 1.0, seed=bar + 9), pan=0.3, gain=0.25)
    return tr.finish(reverb=0.45, room=1.4)


def boss():
    bpm = 126
    beat = 60 / bpm
    prog = [(50, "m"), (50, "m"), (46, ""), (45, "")] * 4
    tr = Track(len(prog) * 4 * beat)
    for bar, (root, q) in enumerate(prog):
        t0 = bar * 4 * beat
        chord = chord_midi(root, q)
        for i in range(8):
            tr.add(t0 + i * beat / 2, brass(hz(root - 12 + (12 if i % 4 == 3 else 0)), beat * 0.35, attack=0.01), gain=0.32)
        pattern = [0, 1.5, 2, 3, 3.5] if bar % 2 == 0 else [0, 1, 1.5, 2.5, 3, 3.25, 3.5, 3.75]
        for k, b in enumerate(pattern):
            tr.add(t0 + b * beat, drum("taiko" if b in (0, 2) else "tom", 0.7, seed=bar * 10 + k), pan=0.2 * (k % 2 * 2 - 1), gain=0.42)
        if bar % 2 == 0:
            tr.add(t0, brass(hz(chord[2]), 2 * beat), pan=-0.3, gain=0.25)
            tr.add(t0, brass(hz(chord[1] + 12), 2 * beat), pan=0.3, gain=0.2)
        tr.add(t0, choir([hz(m + 12) for m in chord], 4 * beat, attack=0.4), gain=0.3)
    return tr.finish(reverb=0.3, room=1.2)


TRACKS = {"mus_village": village, "mus_world": world, "mus_crypt": crypt, "mus_cave": cave, "mus_hell": hell, "mus_boss": boss}

if __name__ == "__main__":
    import sys

    only = set(sys.argv[1:])
    for name, fn in TRACKS.items():
        if only and name not in only:
            continue
        audio = fn()
        path = os.path.join(OUT, f"{name}.ogg")
        sf.write(path, audio, SR, format="OGG", subtype="VORBIS")
        print(name, f"{len(audio) / SR:.1f}s", os.path.getsize(path) // 1024, "KB", flush=True)
