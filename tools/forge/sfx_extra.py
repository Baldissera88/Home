"""Extra synthesized sound effects (22.05 kHz mono PCM16), written to rpg/src/main/res/raw."""
import os

import numpy as np
import soundfile as sf

SR = 22050
OUT = os.path.join(os.path.dirname(__file__), "..", "..", "rpg", "src", "main", "res", "raw")


def zap(seed=4):
    """Electric crackle: band-limited noise bursts gated by a fast random envelope plus a falling buzz."""
    rng = np.random.default_rng(seed)
    n = int(SR * 0.55)
    t = np.arange(n) / SR
    noise = rng.standard_normal(n)
    # Crackle: random on/off gating at ~2 ms resolution.
    gate = np.repeat(rng.random(n // 44 + 1) < 0.55, 44)[:n].astype(float)
    crackle = noise * gate
    # Simple high-pass by differencing, then soften.
    crackle = np.diff(crackle, prepend=0.0) * 0.5
    freq = 180 * np.exp(-t * 3.0) + 60
    phase = 2 * np.pi * np.cumsum(freq) / SR
    buzz = np.sign(np.sin(phase)) * 0.35 + np.sin(phase * 3.01) * 0.2
    env = np.exp(-t * 7.0) * np.minimum(1.0, t * 400)
    sig = (crackle * 0.8 + buzz) * env
    # Short slap echo for space.
    d = int(SR * 0.045)
    sig[d:] += sig[:-d] * 0.3
    sig /= np.max(np.abs(sig)) + 1e-9
    return (sig * 0.85).astype(np.float32)


def main():
    sf.write(os.path.join(OUT, "zap.wav"), zap(), SR, subtype="PCM_16")


if __name__ == "__main__":
    main()
