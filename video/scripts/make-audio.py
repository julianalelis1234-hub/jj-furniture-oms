"""Synthesize the pitch video's ORIGINAL music bed and sound effects (no samples, no licences needed).

    python3 -I video/scripts/make-audio.py

Writes 48 kHz WAVs to video/public/audio/:
  music-bed.mp3  ~212 s calm acoustic-guitar (Karplus-Strong) + warm pad loop, peak -1 dBFS
  whoosh.wav     soft "wooden" whoosh for scene transitions
  pop.wav        warm bubble pop for the role reveals
  click.wav      crisp mouse click
  chime.wav      resonant warm chime / ding for stage advances
  swell.wav      soft ambient swell under the title reveal
Levels (-12 dB, -10 dB, ...) are applied in the Remotion mix, so every file is peak-normalised here.
"""
import os
import wave

import numpy as np

SR = 48_000
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "public", "audio")
rng = np.random.default_rng(2026)


def write(name, x):
    x = np.asarray(x, dtype=np.float64)
    if x.ndim == 1:
        x = np.stack([x, x], axis=1)
    peak = np.max(np.abs(x)) or 1.0
    x = x / peak * 10 ** (-1 / 20)  # peak -1 dBFS
    pcm = (np.clip(x, -1, 1) * 32767).astype("<i2")
    with wave.open(os.path.join(OUT, name), "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())
    print(f"{name}: {len(x) / SR:.2f}s")


def fft_conv(x, ir):
    n = len(x) + len(ir) - 1
    N = 1 << (n - 1).bit_length()
    return np.fft.irfft(np.fft.rfft(x, N) * np.fft.rfft(ir, N), N)[:n]


def reverb_ir(seconds=2.2, decay=3.2, bright=0.35):
    t = np.arange(int(SR * seconds)) / SR
    noise = rng.standard_normal(len(t))
    # darken the tail: one-pole low-pass whose cutoff falls over time
    out = np.empty_like(noise)
    y = 0.0
    for i in range(len(noise)):
        a = bright * np.exp(-t[i] * 1.5) + 0.02
        y += a * (noise[i] - y)
        out[i] = y
    return out * np.exp(-decay * t)


def lowpass(x, cutoff):
    a = 1 - np.exp(-2 * np.pi * cutoff / SR)
    y = np.empty_like(x)
    acc = 0.0
    for i, v in enumerate(x):
        acc += a * (v - acc)
        y[i] = acc
    return y


def hz(note):  # MIDI -> Hz
    return 440.0 * 2 ** ((note - 69) / 12)


# ------------------------------------------------------------------ guitar
def pluck(freq, dur, bright=0.5, damp=0.996):
    """Karplus-Strong plucked string with a soft pick (nylon-ish)."""
    n = int(SR * dur)
    p = max(2, int(round(SR / freq)))
    buf = lowpass(rng.uniform(-1, 1, p), 2500 + 6000 * bright)
    out = np.zeros(n)
    idx = 0
    for i in range(n):
        v = buf[idx]
        nxt = buf[(idx + 1) % p]
        buf[idx] = damp * 0.5 * (v + nxt)
        out[i] = v
        idx = (idx + 1) % p
    env = np.minimum(1, np.arange(n) / (0.004 * SR))
    return out * env


def music_bed(seconds=212.0, bpm=78):
    beat = 60 / bpm
    n = int(SR * seconds)
    L = np.zeros(n)
    R = np.zeros(n)
    # D major, warm: Dmaj9 - Bm7 - Gmaj7 - A6sus (2 bars each)
    prog = [
        (50, [62, 66, 69, 73, 76]),
        (47, [59, 62, 66, 69, 74]),
        (43, [59, 62, 66, 71, 74]),
        (45, [57, 61, 64, 66, 71]),
    ]
    pattern = [0, 2, 1, 3, 4, 3, 2, 1]  # gentle travis-like arpeggio, eighth notes
    bar = 4 * beat
    t = 0.0
    k = 0
    cache = {}
    while t < seconds - 0.5:
        bass, chord = prog[(k // 2) % len(prog)]
        for step in range(8):
            st = t + step * beat / 2
            if st >= seconds:
                break
            note = chord[pattern[step]]
            key = (note, "m")
            if key not in cache:
                cache[key] = pluck(hz(note), 3.2, bright=0.35)
            s = cache[key] * (0.55 if step % 2 else 0.75) * (0.9 + 0.2 * rng.random())
            i0 = int(st * SR)
            seg = s[: n - i0]
            pan = 0.35 + 0.3 * (pattern[step] / 4)
            L[i0 : i0 + len(seg)] += seg * (1 - pan)
            R[i0 : i0 + len(seg)] += seg * pan
        # bass on beats 1 and 3
        for b in (0, 2):
            st = t + b * beat
            if st < seconds:
                key = (bass, "b")
                if key not in cache:
                    cache[key] = pluck(hz(bass), 3.5, bright=0.15, damp=0.997)
                s = cache[key] * 0.8
                i0 = int(st * SR)
                seg = s[: n - i0]
                L[i0 : i0 + len(seg)] += seg * 0.5
                R[i0 : i0 + len(seg)] += seg * 0.5
        t += bar
        k += 1

    # warm pad: detuned sines + slow breathing, following the chord roots
    tt = np.arange(n) / SR
    pad = np.zeros(n)
    for ci, (bass, chord) in enumerate(prog):
        pass
    chord_len = 2 * bar
    for i in range(int(np.ceil(seconds / chord_len))):
        bass, chord = prog[i % len(prog)]
        a = int(i * chord_len * SR)
        b = min(n, int((i + 1) * chord_len * SR) + int(0.8 * SR))
        seg_t = tt[: b - a]
        env = np.minimum(1, seg_t / 1.2) * np.minimum(1, np.maximum(0, (len(seg_t) / SR - seg_t) / 0.8))
        s = np.zeros(b - a)
        for note in (chord[0], chord[2], chord[3]):
            f = hz(note - 12)
            s += np.sin(2 * np.pi * f * seg_t) + 0.6 * np.sin(2 * np.pi * f * 1.003 * seg_t + 1.0)
        pad[a:b] += s * env * 0.09
    pad *= 0.85 + 0.15 * np.sin(2 * np.pi * 0.11 * tt)

    # room
    ir = reverb_ir(2.4, 2.6, 0.3)
    wetL = fft_conv(L + pad, ir)[:n]
    wetR = fft_conv(R + pad, np.roll(ir, 211))[:n]
    mixL = L + pad + 0.06 * wetL / (np.max(np.abs(wetL)) or 1) * np.max(np.abs(L))
    mixR = R + pad + 0.06 * wetR / (np.max(np.abs(wetR)) or 1) * np.max(np.abs(R))
    fade = np.minimum(1, tt / 2.0) * np.minimum(1, np.maximum(0, (seconds - tt) / 2.0))
    return np.stack([mixL * fade, mixR * fade], axis=1)


# --------------------------------------------------------------------- sfx
def whoosh(dur=0.9):
    n = int(SR * dur)
    t = np.arange(n) / SR
    noise = rng.standard_normal(n)
    # sweeping band-pass via two one-pole filters with a moving cutoff
    out = np.zeros(n)
    lo = hi = 0.0
    for i in range(n):
        f = 280 + 2200 * np.sin(np.pi * t[i] / dur) ** 2
        a = 1 - np.exp(-2 * np.pi * f / SR)
        b = 1 - np.exp(-2 * np.pi * (f * 0.35) / SR)
        lo += a * (noise[i] - lo)
        hi += b * (lo - hi)
        out[i] = lo - hi
    env = np.sin(np.pi * np.clip(t / dur, 0, 1)) ** 1.6
    body = np.sin(2 * np.pi * (95 + 40 * t) * t) * np.exp(-((t - dur * 0.55) ** 2) / 0.02) * 0.35  # woody low thump
    x = out * env + body
    return fft_conv(x, reverb_ir(0.6, 7, 0.25) * 0.15)[: n + int(0.3 * SR)] + np.pad(x, (0, int(0.3 * SR)))


def pop(dur=0.22):
    n = int(SR * dur)
    t = np.arange(n) / SR
    f = 620 * np.exp(-t * 9) + 210
    ph = 2 * np.pi * np.cumsum(f) / SR
    x = np.sin(ph) * np.exp(-t * 26) * np.minimum(1, t / 0.002)
    x += 0.25 * rng.standard_normal(n) * np.exp(-t * 400)
    return lowpass(x, 3200)


def click(dur=0.06):
    n = int(SR * dur)
    t = np.arange(n) / SR
    x = rng.standard_normal(n) * np.exp(-t * 900)
    x = x - lowpass(x, 1500)
    x += 0.5 * np.sin(2 * np.pi * 2300 * t) * np.exp(-t * 300)
    return x


def chime(dur=2.8):
    n = int(SR * dur)
    t = np.arange(n) / SR
    x = np.zeros(n)
    for f0, delay, amp in ((784.0, 0.0, 1.0), (1174.66, 0.085, 0.7)):  # G5 then D6
        tt = np.clip(t - delay, 0, None)
        on = (t >= delay).astype(float)
        for ratio, a, d in ((1, 1, 2.2), (2.0, 0.35, 3.2), (2.76, 0.22, 4.8), (5.4, 0.08, 8)):
            x += on * amp * a * np.sin(2 * np.pi * f0 * ratio * tt) * np.exp(-tt * d)
        x *= 1
    x *= np.minimum(1, t / 0.003)
    return x + 0.25 * fft_conv(x, reverb_ir(1.6, 3.5, 0.4))[:n] / 40


def swell(dur=2.6):
    n = int(SR * dur)
    t = np.arange(n) / SR
    x = np.zeros(n)
    for note in (50, 57, 62, 66, 69):
        f = hz(note)
        x += np.sin(2 * np.pi * f * t) + 0.5 * np.sin(2 * np.pi * f * 1.004 * t)
    env = (t / dur) ** 2 * np.minimum(1, (dur - t) / 0.5)
    air = lowpass(rng.standard_normal(n), 1800) * 0.4
    return (x * 0.2 + air) * env


if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    write("whoosh.wav", whoosh())
    write("pop.wav", pop())
    write("click.wav", click())
    write("chime.wav", chime())
    write("swell.wav", swell())
    write("music-bed.wav", music_bed())
    # keep the repo small: 256 kbps MP3 is what the video uses
    import subprocess
    wav = os.path.join(OUT, "music-bed.wav")
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", wav, "-c:a", "libmp3lame", "-b:a", "256k", os.path.join(OUT, "music-bed.mp3")], check=True)
    os.remove(wav)
