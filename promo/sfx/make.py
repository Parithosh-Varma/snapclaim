"""Build the audio for a rendered promo video and mux it.

    python sfx/make.py 01-pov-landlord [--music song.mp3 [--music-start 10.5]]

Reads videos/<name>/cues.json and out/<name>.mp4, writes:
  out/<name>-sfx.mp4    sound effects only (add a trending sound in the app)
  out/<name>-beat.mp4   sound effects over an original 120 BPM beat
  out/<name>-music.mp4  sound effects over your own track (only with --music)

Every sound is synthesized here, so nothing needs licensing.

cues.json:
  {"duration": 28, "bpm": 120, "drop": 10, "breaks": [[14.5, 18.5]],
   "cues": [{"t": 0.5, "s": "pop", "g": 0.8}, ...]}
Sound names: click, pop, tick, type, whoosh, rise, shutter, buzz, hit, chime, ding, thud.
"""
import argparse
import json
import subprocess
import sys
import wave
from pathlib import Path

import numpy as np

SR = 48000
ROOT = Path(__file__).resolve().parent.parent
rng = np.random.default_rng(7)


def env(n, a=0.002, d=0.1):
    t = np.arange(n) / SR
    att = np.clip(t / max(a, 1e-4), 0, 1)
    return att * np.exp(-t / d)


def tone(f, dur, d=0.1, a=0.002, sweep=None):
    n = int(dur * SR)
    t = np.arange(n) / SR
    if sweep is None:
        ph = 2 * np.pi * f * t
    else:
        fs = np.linspace(f, sweep, n)
        ph = 2 * np.pi * np.cumsum(fs) / SR
    return (np.sin(ph) * env(n, a, d)).view(S)


def noise(dur, d=0.05, a=0.001):
    n = int(dur * SR)
    return (rng.standard_normal(n) * env(n, a, d)).view(S)


def hp(x, k=0.95):
    y = np.empty_like(x)
    prev_x = prev_y = 0.0
    for i, v in enumerate(x):
        prev_y = k * (prev_y + v - prev_x)
        prev_x = v
        y[i] = prev_y
    return y.view(S)


def lp(x, k=0.2):
    y = np.empty_like(x)
    acc = 0.0
    for i, v in enumerate(x):
        acc += k * (v - acc)
        y[i] = acc
    return y.view(S)


class S(np.ndarray):
    """Sample buffer whose + pads the shorter side, so layered sounds can differ in length."""
    def __add__(self, o):
        o = np.asarray(o)
        if o.ndim == 0:
            return np.asarray(self) + o
        n = max(len(self), len(o))
        out = np.zeros(n)
        out[: len(self)] += np.asarray(self)
        out[: len(o)] += o
        return out.view(S)
    __radd__ = __add__


def sound(name):
    return np.asarray(_sound(name))


def _sound(name):
    if name == "click":
        return 0.6 * hp(noise(0.03, 0.004)) + 0.3 * tone(2400, 0.03, 0.006)
    if name == "tick":
        return 0.35 * tone(3200, 0.02, 0.004)
    if name == "type":
        return 0.4 * hp(noise(0.04, 0.008)) + 0.15 * tone(900 + rng.integers(0, 300), 0.03, 0.01)
    if name == "pop":
        return 0.7 * tone(520, 0.18, 0.05, sweep=980) + 0.2 * tone(1500, 0.06, 0.02)
    if name == "whoosh":
        n = int(0.45 * SR)
        x = lp(rng.standard_normal(n), 0.12)
        shape = np.sin(np.linspace(0, np.pi, n)) ** 2
        return 1.6 * x * shape
    if name == "rise":
        n = int(0.9 * SR)
        x = hp(rng.standard_normal(n), 0.9)
        shape = np.linspace(0, 1, n) ** 3
        return 0.35 * x * shape + 0.25 * tone(200, 0.9, 2.0, a=0.6, sweep=900) * shape
    if name == "shutter":
        a = hp(noise(0.05, 0.01))
        b = np.concatenate([np.zeros(int(0.06 * SR)), hp(noise(0.06, 0.012))])
        out = np.zeros(len(b))
        out[: len(a)] += a
        return 0.9 * (out + b)
    if name == "buzz":
        n = int(0.32 * SR)
        t = np.arange(n) / SR
        sq = np.sign(np.sin(2 * np.pi * 110 * t)) * 0.5 + np.sign(np.sin(2 * np.pi * 116 * t)) * 0.5
        return 0.22 * lp(sq, 0.3) * env(n, 0.005, 0.25)
    if name == "hit":
        body = tone(70, 0.7, 0.28, sweep=38)
        return 1.0 * body + 0.5 * hp(noise(0.08, 0.02))
    if name == "thud":
        return 0.9 * tone(110, 0.25, 0.07, sweep=60)
    if name == "chime":
        return sum(0.25 * tone(f, 1.6, 0.6, a=0.004) for f in (784, 1175, 1568))
    if name == "ding":
        return 0.4 * tone(1318, 0.8, 0.25) + 0.2 * tone(2637, 0.5, 0.12)
    raise SystemExit(f"unknown sound: {name}")


def place(bus, x, t, g):
    i = int(t * SR)
    if i >= len(bus):
        return
    j = min(len(bus), i + len(x))
    bus[i:j] += g * x[: j - i]


def beat_bed(dur, bpm, drop, breaks):
    """An original four-on-the-floor pattern: soft before the drop, full after,
    nearly silent inside breakdowns."""
    bus = np.zeros(int(dur * SR) + SR)
    spb = 60.0 / bpm
    kick = tone(55, 0.35, 0.12, sweep=42) + 0.4 * tone(160, 0.05, 0.015, sweep=60)
    hat = 0.5 * hp(noise(0.05, 0.012))
    clap = 0.6 * hp(noise(0.14, 0.04)) + 0.4 * hp(noise(0.03, 0.01))
    bass_notes = [55.0, 55.0, 65.41, 49.0]
    n_beats = int(dur / spb)
    for b in range(n_beats):
        t = b * spb
        if any(a <= t < z for a, z in breaks):
            if b % 4 == 0:
                place(bus, tone(220, 1.6, 0.9, a=0.05), t, 0.08)
            continue
        after = drop is not None and t >= drop
        place(bus, kick, t, 0.9 if after else 0.55)
        place(bus, hat, t + spb / 2, 0.35 if after else 0.18)
        if after and b % 2 == 1:
            place(bus, clap, t, 0.45)
        if after:
            f = bass_notes[(b // 4) % 4]
            place(bus, tone(f, spb * 0.9, 0.3, a=0.01), t + spb / 2, 0.35)
    return bus


def write_wav(path, x):
    peak = np.max(np.abs(x)) or 1.0
    x = x / peak * 0.89
    pcm = (x * 32767).astype(np.int16)
    stereo = np.repeat(pcm[:, None], 2, axis=1)
    with wave.open(str(path), "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(stereo.tobytes())


def ffmpeg(*args):
    r = subprocess.run(["ffmpeg", "-y", "-loglevel", "error", *args])
    if r.returncode:
        sys.exit(r.returncode)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("name")
    ap.add_argument("--music")
    ap.add_argument("--music-start", type=float, default=0.0,
                    help="seconds into the track to start, so its chorus lands on the drop")
    a = ap.parse_args()
    spec = json.loads((ROOT / "videos" / a.name / "cues.json").read_text())
    video = ROOT / "out" / f"{a.name}.mp4"
    dur = spec["duration"]
    sfx = np.zeros(int(dur * SR) + SR)
    cache = {}
    for c in spec["cues"]:
        s = c["s"]
        x = sound(s) if s == "type" else cache.setdefault(s, sound(s))
        place(sfx, x, c["t"], c.get("g", 0.7))
    sfx = sfx[: int(dur * SR)]
    tmp = ROOT / "out" / ".audio"
    tmp.mkdir(parents=True, exist_ok=True)
    write_wav(tmp / f"{a.name}-sfx.wav", sfx)
    bed = beat_bed(dur, spec.get("bpm", 120), spec.get("drop"), spec.get("breaks", []))[: len(sfx)]
    bed_peak = np.max(np.abs(bed)) or 1.0
    sfx_peak = np.max(np.abs(sfx)) or 1.0
    write_wav(tmp / f"{a.name}-beat.wav", 0.55 * bed / bed_peak + 0.75 * sfx / sfx_peak)
    loud = "loudnorm=I=-14:TP=-1.0:LRA=11"
    for kind in ("sfx", "beat"):
        ffmpeg("-i", str(video), "-i", str(tmp / f"{a.name}-{kind}.wav"),
               "-map", "0:v", "-map", "1:a", "-c:v", "copy", "-af", loud,
               "-c:a", "aac", "-b:a", "192k", "-shortest",
               str(ROOT / "out" / f"{a.name}-{kind}.mp4"))
    if a.music:
        ffmpeg("-i", str(video), "-i", a.music, "-i", str(tmp / f"{a.name}-sfx.wav"),
               "-filter_complex",
               f"[1:a]atrim={a.music_start}:{a.music_start + dur},asetpts=PTS-STARTPTS,afade=t=out:st={dur - 1}:d=1,volume=0.8[m];[2:a]volume=0.9[s];[m][s]amix=inputs=2:normalize=0,{loud}[a]",
               "-map", "0:v", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-shortest",
               str(ROOT / "out" / f"{a.name}-music.mp4"))
    print("wrote", a.name, "sfx + beat" + (" + music" if a.music else ""))


if __name__ == "__main__":
    main()
