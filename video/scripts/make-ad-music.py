"""Original, synthesised 60-second ENERGETIC track for the 1-minute ad (no samples, no licences).

    python3 -I video/scripts/make-ad-music.py   ->  video/public/audio/ad-music.mp3

125 BPM (one beat = 0.48 s, so the ad's cuts land on beats):
  0.00 - 4.80  intro: filtered chords + hats, noise riser
  4.80         DROP: impact, four-on-the-floor kick, clap, offbeat open hats,
               pumping (side-chained) bass and chord stabs, plucked arpeggio lead
  ~27 s        short 1-bar breakdown + fill, then back in
  53.76        ending hit on the closing card; ring-out to 60 s
"""
import os
import subprocess
import wave

import numpy as np

SR = 48_000
BPM = 125
BEAT = 60 / BPM  # 0.48 s
LEN = float(os.environ.get("MUSIC_LEN", "60"))  # 70 for the 1:10 demo (MUSIC_LEN=70 MUSIC_END_BEAT=134 MUSIC_NAME=demo70-music)
N = int(SR * LEN)
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "public", "audio")
rng = np.random.default_rng(125)
t_all = np.arange(N) / SR


def hz(m):
    return 440.0 * 2 ** ((m - 69) / 12)


def fft_filter(x, lo=None, hi=None, order=2):
    """Zero-phase Butterworth-shaped band filter applied in the frequency domain."""
    X = np.fft.rfft(x)
    f = np.fft.rfftfreq(len(x), 1 / SR)
    g = np.ones_like(f)
    if hi:
        g *= 1 / np.sqrt(1 + (f / hi) ** (2 * order))
    if lo:
        g *= 1 / np.sqrt(1 + (lo / np.maximum(f, 1e-3)) ** (2 * order))
    return np.fft.irfft(X * g, len(x))


def place(buf, sig, start, gain=1.0):
    i = int(start * SR)
    if i >= len(buf):
        return
    seg = sig[: len(buf) - i]
    buf[i : i + len(seg)] += seg * gain


def saw(f, t):
    return 2 * ((f * t) % 1.0) - 1


# ------------------------------------------------------------------ drums
def kick():
    t = np.arange(int(0.45 * SR)) / SR
    f = 48 + 110 * np.exp(-t * 32)
    body = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 7.5)
    click = rng.standard_normal(len(t)) * np.exp(-t * 600) * 0.25
    return np.tanh((body + click) * 1.6)


def clap():
    t = np.arange(int(0.35 * SR)) / SR
    n = rng.standard_normal(len(t))
    env = np.zeros_like(t)
    for d in (0, 0.011, 0.022):
        env += np.where(t >= d, np.exp(-(t - d) * 60), 0)
    env += np.exp(-t * 14) * 0.35
    return fft_filter(n * env, lo=900, hi=7000)


def hat(open_=False):
    t = np.arange(int((0.22 if open_ else 0.06) * SR)) / SR
    n = rng.standard_normal(len(t))
    return fft_filter(n, lo=7000) * np.exp(-t * (18 if open_ else 90))


# ------------------------------------------------------------------ tonal
PROG = [  # A minor energy: Am - F - C - G   (root, chord tones)
    (45, [57, 60, 64, 69]),
    (41, [53, 57, 60, 65]),
    (48, [55, 60, 64, 67]),
    (43, [55, 59, 62, 67]),
]


def stab(notes, dur):
    t = np.arange(int(dur * SR)) / SR
    x = sum(saw(hz(m) * d, t) for m in notes for d in (0.994, 1.0, 1.006))
    x = fft_filter(x, hi=3200)
    return x * np.exp(-t * 6.0) * np.minimum(1, t / 0.004) / (len(notes) * 3)


def bass_note(m, dur):
    t = np.arange(int(dur * SR)) / SR
    x = saw(hz(m), t) * 0.7 + np.sin(2 * np.pi * hz(m) * t)
    x = fft_filter(x, hi=520)
    return x * np.minimum(1, t / 0.006) * np.minimum(1, (dur - t) / 0.03)


def pluck(m, dur=0.4):
    t = np.arange(int(dur * SR)) / SR
    x = (np.sign(np.sin(2 * np.pi * hz(m) * t)) * 0.5 + np.sin(2 * np.pi * hz(m) * 2 * t) * 0.5)
    return fft_filter(x, hi=4500) * np.exp(-t * 11) * np.minimum(1, t / 0.002)


def riser(dur):
    n = int(dur * SR)
    t = np.arange(n) / SR
    noise = rng.standard_normal(n)
    out = np.zeros(n)
    y = 0.0
    for i in range(n):  # time-varying low-pass sweep 300 Hz -> 9 kHz (short, so a loop is fine)
        f = 300 * (30 ** (t[i] / dur))
        a = 1 - np.exp(-2 * np.pi * f / SR)
        y += a * (noise[i] - y)
        out[i] = y
    tone = np.sin(2 * np.pi * np.cumsum(220 * 4 ** (t / dur)) / SR) * 0.25
    return (out + tone) * (t / dur) ** 2


def impact():
    t = np.arange(int(1.6 * SR)) / SR
    boom = np.sin(2 * np.pi * np.cumsum(70 * np.exp(-t * 3) + 30) / SR) * np.exp(-t * 3.2)
    air = fft_filter(rng.standard_normal(len(t)), lo=2000) * np.exp(-t * 5) * 0.25
    return boom + air


def main():
    drums = np.zeros(N)
    bass = np.zeros(N)
    chords = np.zeros(N)
    lead = np.zeros(N)
    fx = np.zeros(N)
    K, C, H, HO = kick(), clap(), hat(), hat(True)

    drop = 10 * BEAT  # 4.80 s
    ending = int(os.environ.get("MUSIC_END_BEAT", "112")) * BEAT  # 53.76 s by default
    _bb = int(os.environ.get("MUSIC_BREAK_BEAT", "56"))
    breakdown = (_bb * BEAT, (_bb + 4) * BEAT)  # one bar; 26.9 - 28.8 s by default
    beats = int(LEN / BEAT) + 1

    for b in range(beats):
        tb = b * BEAT
        bar = int((tb - drop) // (4 * BEAT)) if tb >= drop else -1
        root, chord = PROG[bar % 4] if bar >= 0 else PROG[0]
        in_break = breakdown[0] <= tb < breakdown[1]
        if tb < drop:
            # intro: closed hats on 8ths, softly filtered chord pad
            place(drums, H, tb, 0.25)
            place(drums, H, tb + BEAT / 2, 0.18)
            if b % 4 == 0:
                place(chords, stab(chord, 4 * BEAT) * 0.6, tb, 0.55)
            continue
        if tb >= ending:
            continue
        if not in_break:
            place(drums, K, tb, 1.0)
            place(drums, HO, tb + BEAT / 2, 0.32)
            place(drums, H, tb + BEAT / 4, 0.16)
            place(drums, H, tb + 3 * BEAT / 4, 0.16)
            if b % 2 == 1:
                place(drums, C, tb, 0.75)
            # bass: offbeat 8ths (pumps against the kick)
            place(bass, bass_note(root, BEAT / 2 * 0.9), tb + BEAT / 2, 0.9)
            place(bass, bass_note(root + 12 if b % 4 == 3 else root, BEAT / 2 * 0.9), tb, 0.35)
        else:
            place(drums, H, tb, 0.2)
            place(drums, C, tb + BEAT * 0.75, 0.25 + 0.1 * (b % 4))  # fill
        # chord stabs on the "and" of 2 and on 4
        if (b % 4) in (1, 3):
            place(chords, stab(chord, 0.42), tb + (BEAT / 2 if b % 4 == 1 else 0), 0.8)
        # arpeggio lead (16ths) from the second section on
        if tb >= drop + 8 * 4 * BEAT and not in_break:
            arp = [chord[0] + 12, chord[2] + 12, chord[1] + 12, chord[3] + 12]
            for k in range(4):
                place(lead, pluck(arp[(b * 4 + k) % 4]), tb + k * BEAT / 4, 0.22)

    # side-chain pump: duck bass + chords right after every kick in the groove
    pump = np.ones(N)
    for b in range(beats):
        tb = b * BEAT
        if drop <= tb < ending and not (breakdown[0] <= tb < breakdown[1]):
            i = int(tb * SR)
            seg = np.arange(int(BEAT * SR)) / SR
            curve = 1 - 0.75 * np.exp(-seg * 14)
            pump[i : i + len(curve)] = np.minimum(pump[i : i + len(curve)], curve[: len(pump[i : i + len(curve)])])
    bass *= pump
    chords *= pump

    # FX: riser into the drop and into the ending, impacts on both
    place(fx, riser(drop - 0.2), 0.2, 0.35)
    place(fx, riser(3.6), ending - 3.6, 0.3)
    place(fx, impact(), drop, 0.9)
    place(fx, impact(), ending, 1.0)
    # ending: one big chord ringing out
    tr = np.arange(int(5.5 * SR)) / SR
    ring = sum(saw(hz(m) * d, tr) for m in PROG[0][1] + [81] for d in (0.994, 1.0, 1.006))
    ring = fft_filter(ring, hi=2600) * np.exp(-tr * 0.9) * np.minimum(1, tr / 0.005) / 5
    place(chords, ring, ending, 1.0)

    # intro chords sit behind a low-pass that opens toward the drop
    intro = int(drop * SR)
    chords[:intro] = fft_filter(chords[:intro], hi=900)

    mixL = drums * 0.9 + bass * 0.8 + chords * 0.75 + lead * 0.9 + fx * 0.7
    mixR = drums * 0.9 + bass * 0.8 + np.roll(chords, 240) * 0.75 + np.roll(lead, 480) * 0.9 + fx * 0.7
    mix = np.stack([mixL, mixR], axis=1)
    mix = np.tanh(mix / np.max(np.abs(mix)) * 1.8) / np.tanh(1.8)  # gentle glue / loudness
    fade = np.minimum(1, t_all / 0.05) * np.minimum(1, np.maximum(0, (LEN - t_all) / 1.2))
    mix *= fade[:, None]
    mix = mix / np.max(np.abs(mix)) * 10 ** (-1 / 20)

    os.makedirs(OUT, exist_ok=True)
    wav = os.path.join(OUT, os.environ.get("MUSIC_NAME", "ad-music") + ".wav")
    with wave.open(wav, "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes((mix * 32767).astype("<i2").tobytes())
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", wav, "-c:a", "libmp3lame", "-b:a", "256k", os.path.join(OUT, os.environ.get("MUSIC_NAME", "ad-music") + ".mp3")], check=True)
    os.remove(wav)
    print(f"{os.environ.get('MUSIC_NAME', 'ad-music')}.mp3: {LEN:g} s @ 125 BPM")


if __name__ == "__main__":
    main()
