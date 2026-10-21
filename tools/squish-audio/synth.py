"""Synthesised sound effects and a looping background track for Squishy Crush.

Run from the repo root:  python3 tools/squish-audio/synth.py
Writes squish/src/main/res/raw/*.wav (22.05 kHz mono PCM16). Needs only python3 + numpy.
Everything is seeded, so the output is identical on every run.
"""
import math
import os
import wave

import numpy as np

SR = 22050
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "squish", "src", "main", "res", "raw")
TAU = 2 * math.pi


# ---------------------------------------------------------------- helpers


def hz(m):
    return 440.0 * 2 ** ((m - 69) / 12)


NOTE = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}


def midi(name):
    """'C5' -> 72, 'F#4' -> 66."""
    base = NOTE[name[0]]
    rest = name[1:]
    if rest.startswith("#"):
        base += 1
        rest = rest[1:]
    elif rest.startswith("b"):
        base -= 1
        rest = rest[1:]
    return 12 * (int(rest) + 1) + base


def tt(dur):
    return np.arange(int(dur * SR)) / SR


def phase_of(freq):
    """Integrate an instantaneous frequency array into phase (radians)."""
    return TAU * np.cumsum(freq) / SR


def fades(x, fin=0.002, fout=0.012):
    x = x.copy()
    a = max(1, int(fin * SR))
    b = max(1, int(fout * SR))
    x[:a] *= np.linspace(0, 1, a) ** 2
    x[-b:] *= np.linspace(1, 0, b) ** 2
    return x


def svf(x, fc, q=0.707, mode="low"):
    """TPT state-variable filter with a per-sample cutoff (array or scalar)."""
    n = len(x)
    fc = np.broadcast_to(np.asarray(fc, dtype=np.float64), (n,))
    g = np.tan(np.pi * np.clip(fc, 20, SR * 0.45) / SR)
    k = 1.0 / q
    a1 = 1.0 / (1.0 + g * (g + k))
    a2 = g * a1
    a3 = g * a2
    ic1 = ic2 = 0.0
    out = np.empty(n)
    xs = x.tolist()
    a1l, a2l, a3l = a1.tolist(), a2.tolist(), a3.tolist()
    for i in range(n):
        v0 = xs[i]
        v3 = v0 - ic2
        v1 = a1l[i] * ic1 + a2l[i] * v3
        v2 = ic2 + a2l[i] * ic1 + a3l[i] * v3
        ic1 = 2 * v1 - ic1
        ic2 = 2 * v2 - ic2
        if mode == "low":
            out[i] = v2
        elif mode == "band":
            out[i] = v1
        else:
            out[i] = v0 - k * v1 - v2
    return out


def place(buf, start, sig, gain=1.0):
    i = int(round(start * SR))
    if i >= len(buf):
        return
    sig = sig[: len(buf) - i]
    buf[i:i + len(sig)] += sig * gain


def norm(x, peak=0.9):
    return x / (np.max(np.abs(x)) + 1e-12) * peak


def soft_clip(x, drive=1.5):
    return np.tanh(x * drive) / math.tanh(drive)


def write_wav(name, x):
    x = np.clip(x, -1, 1)
    pcm = (x * 32767).astype("<i2")
    path = os.path.join(OUT, name + ".wav")
    with wave.open(path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())
    return path


def bell_tone(f, dur, decay=3.0, bright=1.0):
    """Glassy bell: inharmonic partials with faster-decaying highs."""
    t = tt(dur)
    s = np.zeros_like(t)
    for ratio, amp, d in ((1.0, 1.0, 1.0), (2.0, 0.45 * bright, 1.6), (3.01, 0.25 * bright, 2.4),
                          (4.17, 0.15 * bright, 3.5), (5.43, 0.08 * bright, 5.0)):
        if f * ratio < SR * 0.45:
            s += amp * np.sin(TAU * f * ratio * t + ratio) * np.exp(-t * decay * d)
    return s * np.minimum(1, t / 0.0015)


def grains(dur, count, lo, hi, rng, decay_rate=3.0, grain_len=0.05):
    """Random tiny high sine pings - glitter."""
    n = int(dur * SR)
    buf = np.zeros(n + int(grain_len * SR) + 2)
    for _ in range(count):
        st = rng.random() ** 1.6 * dur
        f = math.exp(rng.uniform(math.log(lo), math.log(hi)))
        g = tt(grain_len)
        ping = np.sin(TAU * f * g) * np.exp(-g * 90) * np.minimum(1, g / 0.001)
        place(buf, st, ping, math.exp(-st * decay_rate) * rng.uniform(0.4, 1.0))
    return buf[:n]


def blob(f0, f1, dur, bend=18.0, harm=0.35):
    """A rounded low 'blob' with an exponential pitch bend f0 -> f1."""
    t = tt(dur)
    f = f1 + (f0 - f1) * np.exp(-t * bend)
    ph = phase_of(f)
    return np.sin(ph) + harm * np.sin(2 * ph) + harm * 0.3 * np.sin(3 * ph)


# ---------------------------------------------------------------- effects


def sfx_swap():
    rng = np.random.default_rng(1)
    dur = 0.24
    t = tt(dur)
    body = blob(210, 120, dur, bend=16) * np.exp(-t * 14) * np.minimum(1, t / 0.006)
    noise = rng.standard_normal(len(t))
    cutoff = 300 + 2600 * np.exp(-t * 22) * (1 + 0.4 * np.sin(TAU * 38 * t))
    squelch = svf(noise, cutoff, q=2.2, mode="band") * np.exp(-t * 16) * np.minimum(1, t / 0.004)
    sig = body * 0.75 + norm(squelch, 0.6)
    return fades(norm(soft_clip(sig, 1.2), 0.85))


def sfx_invalid():
    dur = 0.42
    t = tt(dur)
    wob = 1 + 0.22 * np.sin(TAU * 13 * t) * np.exp(-t * 5)
    f = (300 - 110 * np.minimum(1, t / 0.35)) * wob
    ph = phase_of(f)
    tone = np.sin(ph) + 0.35 * np.sin(2 * ph) + 0.12 * np.sin(3 * ph)
    e = np.minimum(1, t / 0.008) * np.exp(-t * 4.5)
    # little second "nope" thump
    t2 = tt(0.16)
    nope = blob(170, 110, 0.16, bend=12) * np.exp(-t2 * 18) * np.minimum(1, t2 / 0.005)
    sig = tone * e
    place(sig, 0.21, nope, 0.7)
    return fades(norm(svf(sig, 2400), 0.8))


def sfx_pop(variant):
    rng = np.random.default_rng(10 + variant)
    base = (520, 640, 780)[variant]
    dur = 0.16
    t = tt(dur)
    # Pop-it bubble: a fast upward pitch "bloop" with a quick decay.
    f = base * (1.9 - 0.9 * np.exp(-t * 70))
    ph = phase_of(f)
    bloop = (np.sin(ph) + 0.2 * np.sin(2 * ph)) * np.exp(-t * 34) * np.minimum(1, t / 0.0015)
    # Click transient: a few ms of bright noise.
    n = rng.standard_normal(len(t))
    click = svf(n, 3500, q=1.2, mode="high") * np.exp(-t * 900)
    # Soft low thump body.
    thump = np.sin(phase_of(180 * np.exp(-t * 30) + 90)) * np.exp(-t * 45)
    sig = bloop * 0.9 + click * 0.5 + thump * 0.45
    return fades(norm(sig, 0.9), 0.0008, 0.02)


def sfx_made():
    rng = np.random.default_rng(3)
    dur = 0.85
    sig = np.zeros(int(dur * SR))
    place(sig, 0.0, bell_tone(hz(84), 0.85, decay=3.2), 0.7)     # C7-ish ding
    place(sig, 0.07, bell_tone(hz(91), 0.75, decay=3.8), 0.5)    # G7 answer
    sig += grains(dur, 26, 3000, 8000, rng, decay_rate=3.2) * 0.35
    return fades(norm(sig, 0.85), 0.001, 0.08)


def sfx_line():
    rng = np.random.default_rng(4)
    dur = 0.45
    t = tt(dur)
    x = t / dur
    noise = rng.standard_normal(len(t))
    centre = 350 * (6500 / 350) ** (x ** 0.8)
    whoosh = svf(noise, centre, q=3.0, mode="band")
    e = np.sin(np.pi * np.minimum(1, x * 1.05)) ** 1.5
    zip_f = 500 * (3000 / 500) ** x
    zipt = np.sin(phase_of(zip_f)) * (0.5 + 0.5 * np.sign(np.sin(TAU * 45 * t))) * 0.25
    sig = norm(whoosh, 0.8) * e + zipt * e
    return fades(norm(sig, 0.85), 0.003, 0.03)


def sfx_bomb():
    rng = np.random.default_rng(5)
    dur = 0.9
    t = tt(dur)
    boom = np.sin(phase_of(40 + 110 * np.exp(-t * 14))) * np.exp(-t * 5) * np.minimum(1, t / 0.003)
    noise = rng.standard_normal(len(t))
    rumble = svf(noise, 180 + 1800 * np.exp(-t * 20), q=0.9) * np.exp(-t * 7)
    sig = boom * 1.0 + norm(rumble, 0.6)
    # gooey splats after the hit
    for st, f0, f1, g in ((0.07, 260, 120, 0.45), (0.15, 330, 150, 0.32), (0.24, 220, 100, 0.25)):
        d = 0.18
        tb = tt(d)
        sp = blob(f0, f1, d, bend=20) * np.exp(-tb * 20) * np.minimum(1, tb / 0.004)
        sq = svf(rng.standard_normal(len(tb)), 900 + 1500 * np.exp(-tb * 30), q=2.5, mode="band")
        place(sig, st, sp + norm(sq, 0.4) * np.exp(-tb * 25), g)
    return fades(norm(soft_clip(sig, 1.8), 0.9), 0.001, 0.1)


def sfx_rainbow():
    rng = np.random.default_rng(6)
    dur = 1.25
    sig = np.zeros(int(dur * SR))
    # Rising C-major pentatonic cascade, two octaves and a bit.
    steps = [72, 74, 76, 79, 81, 84, 86, 88, 91, 93, 96]
    for i, m in enumerate(steps):
        place(sig, i * 0.055, bell_tone(hz(m), 0.6, decay=4.0, bright=0.8), 0.55 * (0.8 + 0.2 * i / len(steps)))
    # sparkly glitter shower
    sig += grains(dur, 70, 2500, 9000, rng, decay_rate=1.8) * 0.3
    # gentle echo for "magic"
    d = int(0.11 * SR)
    sig[d:] += sig[:-d] * 0.35
    return fades(norm(sig, 0.85), 0.001, 0.15)


def sfx_goo():
    rng = np.random.default_rng(7)
    dur = 0.38
    t = tt(dur)
    noise = rng.standard_normal(len(t))
    wob = 700 + 900 * np.abs(np.sin(TAU * 9 * t)) * np.exp(-t * 4)
    wet = svf(noise, wob, q=5.0, mode="band") * np.exp(-t * 8) * np.minimum(1, t / 0.01)
    sig = norm(wet, 0.6)
    sig += blob(150, 95, dur, bend=10) * np.exp(-t * 10) * np.minimum(1, t / 0.008) * 0.5
    # bubbly blips on top
    for st, f in ((0.05, 900), (0.13, 1250), (0.22, 1050)):
        tb = tt(0.06)
        b = np.sin(phase_of(f * (1.6 - 0.6 * np.exp(-tb * 80)))) * np.exp(-tb * 60)
        place(sig, st, b, 0.3)
    return fades(norm(sig, 0.85), 0.002, 0.04)


def sfx_wrap():
    rng = np.random.default_rng(8)
    dur = 0.36
    sig = np.zeros(int(dur * SR))
    times = [0.0, 0.045, 0.08, 0.14, 0.19, 0.26]
    for i, st in enumerate(times):
        tb = tt(0.05)
        crack = svf(rng.standard_normal(len(tb)), rng.uniform(1800, 3200), q=2.0, mode="band")
        crack = norm(crack, 1.0) * np.exp(-tb * rng.uniform(80, 140))
        knock = np.sin(TAU * rng.uniform(380, 520) * tb) * np.exp(-tb * 90) * 0.5
        place(sig, st + rng.uniform(-0.006, 0.006) * (i > 0), crack + knock, 0.6 + 0.4 * (i == 0) - 0.05 * i)
    return fades(norm(soft_clip(norm(sig, 1.0), 1.6), 0.85), 0.0008, 0.03)


def sfx_star():
    dur = 0.7
    sig = bell_tone(hz(88), dur, decay=2.6, bright=1.0) * 0.8   # E7
    sig += bell_tone(hz(100), dur, decay=4.0, bright=0.6) * 0.25  # E8 shimmer
    return fades(norm(sig, 0.85), 0.001, 0.08)


def marimba(f, dur, bright=1.0):
    t = tt(dur)
    s = (np.sin(TAU * f * t) * np.exp(-t * 5.0)
         + 0.35 * bright * np.sin(TAU * f * 3.93 * t) * np.exp(-t * 18)
         + 0.12 * bright * np.sin(TAU * f * 9.2 * t) * np.exp(-t * 40))
    a = int(0.002 * SR)
    s[:a] *= np.linspace(0, 1, a)
    r = min(len(s) // 3, int(0.02 * SR))
    s[-r:] *= np.linspace(1, 0, r)
    return s


def kalimba(f, dur):
    t = tt(dur)
    s = (np.sin(TAU * f * t) * np.exp(-t * 3.2)
         + 0.25 * np.sin(TAU * f * 5.95 * t) * np.exp(-t * 22)
         + 0.08 * np.sin(TAU * f * 2.0 * t) * np.exp(-t * 6))
    a = int(0.0015 * SR)
    s[:a] *= np.linspace(0, 1, a)
    r = min(len(s) // 3, int(0.03 * SR))
    s[-r:] *= np.linspace(1, 0, r)
    return s


def soft_lead(f, dur, wah=True):
    """Rounded square-ish toy horn for the jingles."""
    t = tt(dur)
    vib = 1 + 0.006 * np.sin(TAU * 5.5 * t) * np.minimum(1, t / 0.15)
    ph = phase_of(f * vib)
    s = sum(np.sin(k * ph) / k * (0.7 ** (k // 2)) for k in (1, 2, 3, 5, 7) if f * k < 5000) if wah else np.sin(ph)
    e = np.minimum(1, t / 0.012) * np.minimum(1, np.maximum(0, dur - t) / 0.04)
    return s * e


def sfx_win():
    dur = 2.1
    sig = np.zeros(int(dur * SR))
    beat = 0.13
    melody = [("C5", 0, 1), ("E5", 1, 1), ("G5", 2, 1), ("C6", 3, 2), ("G5", 5, 1), ("C6", 6, 2),
              ("A5", 8, 1), ("B5", 9, 1), ("C6", 10, 1), ("D6", 11, 1), ("E6", 12, 5)]
    for name, st, ln in melody:
        f = hz(midi(name))
        place(sig, st * beat, soft_lead(f, ln * beat + 0.06) * 0.35, 1.0)
        place(sig, st * beat, marimba(f, 0.6), 0.45)
    # final chord bell + bass
    for m in (72, 76, 79, 84):
        place(sig, 12 * beat, bell_tone(hz(m), 1.0, decay=2.2, bright=0.6), 0.22)
    for name, st in (("C3", 0), ("G3", 3), ("F3", 6), ("G3", 8), ("C3", 12)):
        place(sig, st * beat, marimba(hz(midi(name)), 0.45, bright=0.3), 0.5)
    rng = np.random.default_rng(9)
    tail = grains(0.8, 30, 3000, 8000, rng, decay_rate=3.0) * 0.25
    place(sig, 12 * beat, tail)
    sig = soft_clip(norm(sig, 1.0), 1.1)
    return fades(norm(sig - sig.mean(), 0.72), 0.002, 0.2)


def sfx_lose():
    dur = 1.45
    sig = np.zeros(int(dur * SR))
    notes = [("G4", 0.0, 0.26), ("F#4", 0.28, 0.26), ("F4", 0.56, 0.26), ("E4", 0.84, 0.6)]
    for i, (name, st, ln) in enumerate(notes):
        f0 = hz(midi(name))
        t = tt(ln)
        if i == 3:
            f = f0 * (1 - 0.06 * np.minimum(1, t / ln) ** 2) * (1 + 0.025 * np.sin(TAU * 6 * t) * np.minimum(1, t / 0.15))
        else:
            f = f0 * (1 - 0.01 * t / ln)
        ph = phase_of(f)
        # muted "wah": brightness opens then closes within each note
        bright = 0.25 + 0.45 * np.sin(np.pi * np.minimum(1, t / ln)) ** 0.7
        s = np.sin(ph) + bright * 0.6 * np.sin(2 * ph) + bright ** 2 * 0.4 * np.sin(3 * ph) + bright ** 3 * 0.25 * np.sin(4 * ph)
        e = np.minimum(1, t / 0.03) * np.minimum(1, np.maximum(0, ln - t) / 0.06)
        place(sig, st, s * e, 0.8)
    return fades(norm(svf(sig, 1800, q=0.8), 0.6), 0.003, 0.08)


def sfx_click():
    rng = np.random.default_rng(12)
    dur = 0.05
    t = tt(dur)
    knock = np.sin(TAU * 1250 * t) * np.exp(-t * 120) + 0.4 * np.sin(TAU * 2500 * t) * np.exp(-t * 200)
    noise = svf(rng.standard_normal(len(t)), 4000, q=1.0, mode="band") * np.exp(-t * 400)
    sig = knock + norm(noise, 0.4)
    return fades(norm(sig, 0.6), 0.0005, 0.01)


# ---------------------------------------------------------------- music

BPM = 120
BEAT = 60.0 / BPM          # 0.5 s
BAR = 4 * BEAT             # 2 s
BARS = 16                  # 32 s loop
SWING = 0.58               # fraction of a beat where the off-beat 8th lands (0.5 = straight)

CHORDS = [  # I - V - vi - IV in C major, four times
    ("C", [48, 60, 64, 67]), ("G", [43, 59, 62, 67]), ("Am", [45, 60, 64, 69]), ("F", [41, 60, 65, 69]),
] * 4

MELODY = [  # one string per bar, eight swung 8ths; '-' holds the previous note, '.' is a rest
    "E5 . G5 E5 C5 . D5 E5",
    "D5 . B4 D5 G5 . F5 E5",
    "C5 . E5 A5 G5 . E5 C5",
    "D5 . C5 A4 C5 - . .",
    "E5 . G5 E5 C6 . B5 G5",
    "D6 . B5 G5 D5 . E5 F5",
    "E5 . C5 E5 A5 . G5 E5",
    "F5 . E5 D5 G5 - - .",
    "G5 G5 . E5 G5 . C6 .",
    "B5 B5 . G5 B5 . D6 .",
    "C6 . B5 A5 E5 . A5 B5",
    "C6 . A5 F5 A5 . G5 .",
    "E5 G5 C6 G5 E5 G5 C6 D6",
    "D6 . B5 G5 B5 . D6 .",
    "C6 . A5 E5 F5 . E5 D5",
    "C5 - - . D5 . E5 G5",
]


def eighth_time(bar, i):
    beat, off = divmod(i, 2)
    return bar * BAR + (beat + (SWING if off else 0.0)) * BEAT


def parse_bar(s):
    """-> list of (eighth index, length in eighths, midi)"""
    toks = s.split()
    assert len(toks) == 8, s
    notes = []
    for i, tok in enumerate(toks):
        if tok == "-":
            if notes:
                notes[-1][1] += 1
        elif tok != ".":
            notes.append([i, 1, midi(tok)])
    return notes


def pad_chord(freqs, dur):
    t = tt(dur)
    s = np.zeros_like(t)
    for j, f in enumerate(freqs):
        for det in (-0.005, 0.0, 0.005):
            ff = f * (1 + det)
            for k in range(1, 7):
                if ff * k > SR * 0.4:
                    break
                s += np.sin(TAU * ff * k * t + det * 400 * k + j) * (0.5 ** (k - 1)) / k
    trem = 1 + 0.08 * np.sin(TAU * 2.0 * t)          # gentle 4-per-bar breathing
    e = np.minimum(1, t / 0.35) * np.minimum(1, np.maximum(0, dur - t) / 0.35)
    return s * e * trem / (len(freqs) * 3)


def bass_note(f, dur):
    t = tt(dur)
    ph = TAU * f * t
    s = np.sin(ph) + 0.5 * np.sin(2 * ph) + 0.25 * np.sin(3 * ph) + 0.1 * np.sin(4 * ph)
    e = np.minimum(1, t / 0.006) * np.exp(-t * 3.5) * np.minimum(1, np.maximum(0, dur - t) / 0.03)
    return s * e


def kick():
    t = tt(0.3)
    s = np.sin(phase_of(50 + 110 * np.exp(-t * 30))) * np.exp(-t * 11)
    s += 0.3 * np.sin(phase_of(50 + 110 * np.exp(-t * 30)) * 2) * np.exp(-t * 25)  # audible on phone speakers
    return fades(s, 0.001, 0.02)


def clap(seed):
    rng = np.random.default_rng(seed)
    t = tt(0.22)
    n = svf(rng.standard_normal(len(t)), 1500, q=1.1, mode="band")
    n = norm(n, 1.0)
    e = np.zeros_like(t)
    for d in (0.0, 0.01, 0.02):  # three quick slaps
        e += (t >= d) * np.exp(-np.maximum(0, t - d) * 70)
    e += (t >= 0.02) * np.exp(-np.maximum(0, t - 0.02) * 18) * 0.5
    return fades(n * e * 0.6, 0.0005, 0.02)


def shaker(seed):
    rng = np.random.default_rng(seed)
    t = tt(0.08)
    n = svf(rng.standard_normal(len(t)), 7000, q=0.9, mode="high")
    e = np.minimum(1, t / 0.006) * np.exp(-t * 55)
    return fades(norm(n, 1.0) * e, 0.0005, 0.01)


def circ_add(buf, start, sig, gain=1.0):
    """Add with wrap-around so ringing tails continue at the loop start (seamless loop)."""
    n = len(buf)
    i = int(round(start * SR)) % n
    sig = sig * gain
    while len(sig):
        take = min(len(sig), n - i)
        buf[i:i + take] += sig[:take]
        sig = sig[take:]
        i = 0


def circ_reverb(x, seconds=1.4, seed=21):
    """Circular convolution with a decaying-noise impulse response (loop-seamless)."""
    rng = np.random.default_rng(seed)
    t = tt(seconds)
    ir = rng.standard_normal(len(t)) * np.exp(-t * 4.0)
    ir = np.convolve(ir, np.ones(5) / 5, mode="same")      # warm it up
    ir[: int(0.012 * SR)] = 0                                 # pre-delay
    ir /= np.sqrt(np.sum(ir ** 2))
    h = np.zeros(len(x))
    h[: len(ir)] = ir
    return np.fft.irfft(np.fft.rfft(x) * np.fft.rfft(h), n=len(x))


def music():
    n = int(BARS * BAR * SR)
    lead = np.zeros(n)
    kal = np.zeros(n)
    pads = np.zeros(n)
    bass = np.zeros(n)
    drums = np.zeros(n)
    sparkle = np.zeros(n)
    rng = np.random.default_rng(42)

    k = kick()
    claps = [clap(s) for s in (31, 32)]
    shakers = [shaker(s) for s in (41, 42, 43)]

    for bar in range(BARS):
        name, chord = CHORDS[bar]
        root, tones = chord[0], chord[1:]
        t0 = bar * BAR
        # pad: whole bar, chord tones
        circ_add(pads, t0, pad_chord([hz(m) for m in tones], BAR + 0.3))
        # bouncy bass: 1, and-of-2, 3, and-of-4 (octave)
        for i, m, ln in ((0, root, 0.6), (3, root + 7, 0.3), (4, root, 0.6), (7, root + 12, 0.3)):
            circ_add(bass, eighth_time(bar, i), bass_note(hz(m), ln))
        # drums
        for beat in range(4):
            if beat in (0, 2) or (beat == 3 and bar % 4 == 3):
                circ_add(drums, t0 + beat * BEAT, k, 0.9)
            if beat in (1, 3):
                circ_add(drums, t0 + beat * BEAT, claps[(bar + beat) % 2], 0.45)
        for i in range(8):
            g = 0.26 if i % 2 == 0 else 0.38
            circ_add(drums, eighth_time(bar, i), shakers[(bar * 8 + i) % 3], g)
        # kalimba broken chord (up-down) on 8ths, an octave around C4-C5
        arp = [tones[0], tones[1], tones[2], tones[1] + 12 if tones[1] + 12 < 80 else tones[0] + 12]
        pattern = arp + [arp[2], arp[1], arp[2], arp[1]]
        quiet = 0.5 if bar < 8 else 0.7
        for i, m in enumerate(pattern):
            circ_add(kal, eighth_time(bar, i), kalimba(hz(m), 0.6), quiet * (1.0 if i % 2 == 0 else 0.75))
        # lead melody
        for i, ln, m in parse_bar(MELODY[bar]):
            st = eighth_time(bar, i)
            accent = 1.0 if i % 2 == 0 else 0.85
            circ_add(lead, st, marimba(hz(m), max(0.35, ln * BEAT * 0.5 + 0.25)), accent)
        # sprinkle a soft bell on the first beat of every second bar
        if bar % 2 == 1:
            circ_add(sparkle, t0 + rng.choice([0.0, 2 * BEAT]), bell_tone(hz(tones[-1] + 24), 1.2, decay=2.0, bright=0.5), 0.5)

    # dotted-8th echo on the lead (circular, so the loop stays seamless)
    d = int(round(0.75 * BEAT * SR))
    lead_fx = lead + np.roll(lead, d) * 0.28 + np.roll(lead, 2 * d) * 0.1

    dry = (lead_fx * 0.55 + kal * 0.22 + pads * 0.55 + bass * 0.42 + drums * 0.5 + sparkle * 0.12)
    send = lead_fx * 0.3 + kal * 0.25 + pads * 0.4 + drums * 0.08 + sparkle * 0.3
    wet = circ_reverb(send)
    mix = dry + wet * 0.22
    mix = mix / (np.max(np.abs(mix)) + 1e-12)
    mix = soft_clip(mix * 1.1, 1.3)
    return mix * 0.62  # leave headroom so effects sit on top


# ---------------------------------------------------------------- main


def main():
    os.makedirs(OUT, exist_ok=True)
    sounds = {
        "sfx_swap": sfx_swap(),
        "sfx_invalid": sfx_invalid(),
        "sfx_pop1": sfx_pop(0),
        "sfx_pop2": sfx_pop(1),
        "sfx_pop3": sfx_pop(2),
        "sfx_made": sfx_made(),
        "sfx_line": sfx_line(),
        "sfx_bomb": sfx_bomb(),
        "sfx_rainbow": sfx_rainbow(),
        "sfx_goo": sfx_goo(),
        "sfx_wrap": sfx_wrap(),
        "sfx_star": sfx_star(),
        "sfx_win": sfx_win(),
        "sfx_lose": sfx_lose(),
        "sfx_click": sfx_click(),
        "music_loop": music(),
    }
    for name, x in sounds.items():
        p = write_wav(name, x)
        print(f"{name:12s} {len(x) / SR:6.2f}s  {os.path.getsize(p) / 1024:7.1f} KB")


if __name__ == "__main__":
    main()
