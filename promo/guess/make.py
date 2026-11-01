"""SnapClaim promo 09: "Guess how long this crack is." (9:16, 30 fps, narrated)

A trick-question episode built for replies. The photo is real (Nolan Issac, CC0,
Wikimedia Commons "Cracked Cream Walls (Unsplash)") and is the held-out bench case
public-interior-wall-cracks-03, where SnapClaim found the crack and refused to
give millimetres because nothing in frame has a known size (crackLengthMm: null).

Usage:
  ELEVENLABS_API_KEY=... python make.py --revoice   # fetch voice (cached in out/)
  python make.py [out.mp4] [--still SECONDS] [--sheet]
Photo: room-cc0.jpg (same file as the bench held-4-wall.jpg), or SNAP_PHOTO env
"""
import base64
import json
import math
import os
import re
import subprocess
import sys
import urllib.request
import wave
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

HERE = Path(__file__).resolve().parent
OUT = HERE / "out"
W, H, FPS, SR = 1080, 1920, 30, 48000
VOICE_ID = "1SM7GgM6IMuvQlz2BwM3"  # Mark
LEAD, TAIL = 0.15, 1.8
PHOTO = Path(os.environ.get("SNAP_PHOTO", HERE / "room-cc0.jpg"))

SCENES = [
    "Guess how long this crack is.",
    "Drop your guess in the comments.",
    "We asked our AI.",
    "It refused. No coin, no number.",
    "Without something of known size in the photo, nobody can tell. Not you. Not AI. Not your landlord.",
    "Put a coin next to your crack, reply with the photo, and we'll measure it.",
]

# the ceiling crack, in photo pixels (1280x853)
CRACK = [(703.3, 0), (701.7, 13.3), (700, 33.3), (696.7, 46.7), (691.7, 63.3), (688.3, 76.7),
         (683.3, 96.7), (680, 116.7), (675, 133.3), (670, 153.3), (666, 173.3)]

# ---------------------------------------------------------------- voice

def revoice():
    key = os.environ.get("ELEVENLABS_API_KEY") or sys.exit("set ELEVENLABS_API_KEY")
    text, owner = "", []
    for i, s in enumerate(SCENES):
        if text:
            text += " "
            owner.append(i)
        text += s
        owner += [i] * len(s)
    body = {"text": text, "model_id": "eleven_multilingual_v2",
            "voice_settings": {"stability": 0.5, "similarity_boost": 0.75, "style": 0.2, "speed": 0.9}}
    req = urllib.request.Request(
        f"https://api.elevenlabs.io/v1/text-to-speech/{VOICE_ID}/with-timestamps?output_format=pcm_24000",
        data=json.dumps(body).encode(), headers={"xi-api-key": key, "Content-Type": "application/json"})
    with urllib.request.urlopen(req) as r:
        res = json.loads(r.read())
    pcm = np.frombuffer(base64.b64decode(res["audio_base64"]), dtype=np.int16)
    al = res["alignment"]
    if "".join(al["characters"]) != text:
        sys.exit("alignment differs from script")
    st, en = al["character_start_times_seconds"], al["character_end_times_seconds"]
    words = [{"w": m.group(), "s": st[m.start()], "e": en[m.end() - 1], "scene": owner[m.start()]}
             for m in re.finditer(r"\S+", text)]
    # only trim pauses that drag: keep up to 0.45 s in a scene, 0.6 s between scenes
    keep_pcm, cur, shift = [], 0, 0.0
    for i, w in enumerate(words):
        w["s"] -= shift
        w["e"] -= shift
        if i + 1 < len(words):
            nxt = words[i + 1]
            keep = 0.6 if nxt["scene"] != w["scene"] else 0.45
            gap = (nxt["s"] - shift) - w["e"]
            if gap > keep:
                a = int((w["e"] + shift + keep / 2) * 24000)
                b = int((nxt["s"] - keep / 2) * 24000)
                keep_pcm.append(pcm[cur:a])
                cur, shift = b, shift + gap - keep
    keep_pcm.append(pcm[cur:int((words[-1]["e"] + shift + 0.4) * 24000)])
    pcm = np.concatenate(keep_pcm)
    OUT.mkdir(exist_ok=True)
    with wave.open(str(OUT / "voice.wav"), "wb") as f:
        f.setnchannels(1), f.setsampwidth(2), f.setframerate(24000), f.writeframes(pcm.tobytes())
    for w in words:
        w["s"], w["e"] = round(w["s"], 3), round(w["e"], 3)
    dur = len(pcm) / 24000
    (OUT / "words.json").write_text(json.dumps({"words": words, "dur": dur}))
    print(f"voice: {len(words)} words, {dur:.1f}s, {len(words) / dur:.2f} w/s")


def load_words():
    d = json.loads((OUT / "words.json").read_text())
    for w in d["words"]:
        w["s"] += LEAD
        w["e"] += LEAD
    return d["words"], d["dur"] + LEAD


# ---------------------------------------------------------------- helpers

FONTS = "C:/Windows/Fonts/"
_fc = {}


def font(size, name="seguibl.ttf"):
    k = (int(size), name)
    if k not in _fc:
        _fc[k] = ImageFont.truetype(FONTS + name, max(1, int(size)))
    return _fc[k]


BOLD, MONO = "segoeuib.ttf", "consolab.ttf"


def clamp(x, a=0.0, b=1.0):
    return max(a, min(b, x))


def ease(x):
    return 1 - (1 - clamp(x)) ** 3


def back(x):
    x = clamp(x)
    return 1 + 2.9 * (x - 1) ** 3 + 1.9 * (x - 1) ** 2


WHITE, BLACK, YEL, RED, GREEN = (255, 255, 255), (0, 0, 0), (255, 221, 51), (240, 60, 48), (40, 190, 100)


def stroke_text(d, xy, s, f, fill=WHITE, sw=None, anchor="mm"):
    d.text(xy, s, font=f, fill=fill, anchor=anchor, stroke_width=sw or max(3, f.size // 11), stroke_fill=BLACK)


PH = Image.open(PHOTO).convert("RGB")
PW, PHh = PH.size


def view(cx, cy, hs):
    """9:16 window of the photo centred near (cx, cy), hs photo pixels tall, as a full frame."""
    hs = min(hs, PHh)
    ws = hs * 9 / 16
    x0 = clamp(cx - ws / 2, 0, PW - ws)
    y0 = clamp(cy - hs / 2, 0, PHh - hs)
    img = PH.resize((W, H), Image.BICUBIC, box=(x0, y0, x0 + ws, y0 + hs))
    if hs < 500:
        img = img.filter(ImageFilter.UnsharpMask(2, 60, 2))
    return img, (x0, y0, W / ws)


def to_screen(p, m):
    x0, y0, s = m
    return ((p[0] - x0) * s, (p[1] - y0) * s)


def lerp(a, b, k):
    return a + (b - a) * k


# camera keyframes: wide (whole room), crack (tight)
WIDE = (690, 260, 540)
TIGHT = (686, 110, 260)
MID = (686, 200, 480)


def cam(a, b, k):
    k = ease(k)
    return tuple(lerp(a[i], b[i], k) for i in range(3))


def trace(d, m, frac, col=RED, width=14, glow=True):
    total = sum(math.dist(a, b) for a, b in zip(CRACK, CRACK[1:]))
    target, acc, pts = total * clamp(frac), 0.0, [CRACK[0]]
    for a, b in zip(CRACK, CRACK[1:]):
        seg = math.dist(a, b)
        if acc + seg <= target:
            pts.append(b)
            acc += seg
        else:
            k = (target - acc) / seg
            pts.append((lerp(a[0], b[0], k), lerp(a[1], b[1], k)))
            break
    P = [to_screen(p, m) for p in pts]
    if len(P) > 1:
        if glow:
            d.line(P, fill=col + (90,), width=width * 3, joint="curve")
        d.line(P, fill=col + (255,), width=width, joint="curve")


def darken(img, a):
    return Image.blend(img, Image.new("RGB", img.size, (0, 0, 0)), a)


# ---------------------------------------------------------------- timeline

class TL:
    def __init__(self, words, dur):
        self.words, self.dur, self.end = words, dur, dur + TAIL
        st = {}
        for w in words:
            st.setdefault(w["scene"], w["s"])
        self.st = [st[i] for i in range(len(SCENES))]

    def w(self, sc, needle, k=0):
        hits = [w for w in self.words if w["scene"] == sc and w["w"].lower().strip(".,?!").startswith(needle)]
        return hits[min(k, len(hits) - 1)]["s"]


def captions(img, tl, t):
    """TikTok style: 1-3 word chunks, white with black stroke; key words in yellow."""
    d = ImageDraw.Draw(img)
    f = font(92)
    chunks, cur = [], []
    for w in tl.words:
        if cur and d.textlength(" ".join(x["w"].upper() for x in cur + [w]), font=f) > 940:
            chunks.append(cur)
            cur = []
        cur.append(w)
        if w["w"][-1] in ".,?!" or len(cur) == 4:
            chunks.append(cur)
            cur = []
    if cur:
        chunks.append(cur)
    live = None
    for c in chunks:
        if c[0]["s"] - 0.05 <= t < c[-1]["e"] + 0.15:
            live = c
    if not live:
        return
    keys = {"guess", "crack", "comments.", "ai.", "refused.", "coin,", "number.", "nobody", "you.", "landlord.",
            "coin", "reply", "measure"}
    parts = [w["w"].upper() for w in live]
    y = 1440
    k = back((t - live[0]["s"] + 0.05) / 0.18)
    f2 = font(92 * (0.8 + 0.2 * k))
    widths = [d.textlength(p + " ", font=f2) for p in parts]
    x = (W - sum(widths) + d.textlength(" ", font=f2)) / 2
    for w, p, wd in zip(live, parts, widths):
        col = YEL if w["w"].lower() in keys else WHITE
        stroke_text(d, (x, y), p, f2, col, sw=9, anchor="lm")
        x += wd


def frame(tl, t):
    S = tl.st
    sc = max([i for i, s in enumerate(S) if t >= s - 0.1] or [0])
    # ---- scene 0-1: the guess
    if sc <= 1:
        if t < S[0] + 0.9:
            img, m = view(*cam(WIDE, WIDE, 0))
            z = 1 + 0.08 * (1 - ease(t / 0.4))  # punch in
            if z > 1.001:
                img = img.resize((int(W * z), int(H * z)), Image.BICUBIC).crop(
                    (int((W * z - W) / 2), int((H * z - H) / 2), int((W * z - W) / 2) + W, int((H * z - H) / 2) + H))
        else:
            k = (t - S[0] - 0.9) / 0.5
            img, m = view(*cam(WIDE, MID, k)) if k < 1 else view(*cam(MID, TIGHT, (t - S[0] - 1.4) / 2.5))
        img = img.convert("RGBA")
        ov = Image.new("RGBA", img.size, (0, 0, 0, 0))
        d = ImageDraw.Draw(ov)
        if True:
            pulse = 0.5 + 0.5 * math.sin(t * 9)
            P = [to_screen(p, m) for p in CRACK]
            d.line(P, fill=(255, 221, 51, int(90 + 120 * pulse)), width=34, joint="curve")
        # header
        rr_box = (90, 1620, W - 90, 1800)
        d.rounded_rectangle(rr_box, 36, fill=(255, 255, 255, 240))
        d.text((W / 2, 1675), "GUESS THE LENGTH", font=font(86), fill=BLACK, anchor="mm")
        d.text((W / 2, 1755), "of this crack", font=font(46, BOLD), fill=(90, 90, 90), anchor="mm")
        if sc == 1:
            # countdown 3-2-1 across scene 1
            span = max(1.2, S[2] - S[1] - 0.2)
            n = 3 - int(clamp((t - S[1]) / span, 0, 0.999) * 3)
            local = ((t - S[1]) / span * 3) % 1
            r = 120 * back(local / 0.25)
            cx, cy = W - 190, 560
            d.ellipse((cx - r, cy - r, cx + r, cy + r), fill=(240, 60, 48, 235))
            d.text((cx, cy), str(n), font=font(150 * clamp(r / 120)), fill=WHITE, anchor="mm")
            d.text((W / 2, 1180), "COMMENT YOUR GUESS", font=font(60), fill=WHITE, anchor="mm",
                   stroke_width=6, stroke_fill=BLACK)
            ay = 1240 + 18 * math.sin(t * 10)
            d.polygon([(W / 2 - 50, ay), (W / 2 + 50, ay), (W / 2, ay + 60)], fill=YEL)
        img.alpha_composite(ov)
    # ---- scene 2-3: the AI looks, then refuses
    elif sc <= 3:
        base, m = view(*MID)
        base = darken(base, 0.55)
        img = base.convert("RGBA")
        d = ImageDraw.Draw(img)
        # phone card
        px0, py0, px1, py1 = 150, 300, W - 150, 1250
        d.rounded_rectangle((px0 - 14, py0 - 14, px1 + 14, py1 + 14), 64, fill=(16, 16, 20))
        inner, m2 = view(*TIGHT)
        inner = inner.resize((px1 - px0, py1 - py0), Image.BICUBIC)
        k = (px1 - px0) / W
        m2 = (m2[0], m2[1], m2[2] * k)
        mask = Image.new("L", inner.size, 0)
        ImageDraw.Draw(mask).rounded_rectangle((0, 0, inner.width, inner.height), 52, fill=255)
        layer = inner.convert("RGBA")
        ld = ImageDraw.Draw(layer)
        if sc == 2:
            sy = (t - S[2]) / 0.9 % 1 * inner.height
            ld.rectangle((0, sy - 3, inner.width, sy + 3), fill=(80, 220, 255, 220))
            ld.rectangle((0, sy - 40, inner.width, sy), fill=(80, 220, 255, 50))
            stroke_text(d, (W / 2, 220), "Asking SnapClaim...", font(54, BOLD), WHITE, sw=4)
        else:
            trace(ld, m2, 1.0, RED, 10)
        img.paste(layer, (px0, py0), mask)
        if sc == 3:
            p = back((t - S[3]) / 0.3)
            ry = 880
            card = (px0 + 30, ry, px1 - 30, ry + 340)
            d.rounded_rectangle(card, 34, fill=(255, 255, 255))
            d.text((card[0] + 40, ry + 50), "Crack found", font=font(48, BOLD), fill=BLACK, anchor="lm")
            gx = card[2] - 70
            d.ellipse((gx - 30, ry + 20, gx + 30, ry + 80), fill=GREEN)
            d.line([(gx - 14, ry + 50), (gx - 3, ry + 62), (gx + 16, ry + 38)], fill=WHITE, width=7, joint="curve")
            d.text((card[0] + 40, ry + 130), "Length:", font=font(48, BOLD), fill=BLACK, anchor="lm")
            if t >= tl.w(3, "no") - 0.05:
                d.text((card[0] + 230, ry + 130), "REFUSED", font=font(60), fill=RED, anchor="lm")
                d.text((card[0] + 40, ry + 225), "no coin = no scale", font=font(40, MONO), fill=(90, 90, 90), anchor="lm")
                d.text((card[0] + 40, ry + 280), "won't invent mm", font=font(40, MONO), fill=(90, 90, 90), anchor="lm")
            if p < 1:  # stamp-in flash
                d.rectangle((0, 0, W, H), outline=None)
            stroke_text(d, (W / 2, 220), "It found the crack.", font(54, BOLD), WHITE, sw=4)
    # ---- scene 4: nobody can tell
    elif sc == 4:
        beats = [(S[4], "NO KNOWN SIZE", 0), (tl.w(4, "nobody"), "NOBODY CAN TELL", 4), (tl.w(4, "you"), "NOT YOU", 1),
                 (tl.w(4, "ai"), "NOT AI", 2), (tl.w(4, "landlord") - 0.25, "NOT YOUR LANDLORD", 3)]
        cur = ([b for b in beats if t >= b[0] - 0.05] or beats[:1])[-1]
        shots = [MID, (560, 420, 560), TIGHT, (900, 430, 700), (690, 300, 640)]
        a = shots[cur[2]]
        zk = clamp((t - cur[0]) / 2.5)
        img, m = view(a[0], a[1], a[2] * (1 - 0.12 * zk))
        img = darken(img, 0.45).convert("RGBA")
        d = ImageDraw.Draw(img)
        k = back((t - cur[0]) / 0.2)
        fs = 120 if len(cur[1]) < 12 else 84
        stroke_text(d, (W / 2, 820), cur[1], font(fs * (0.7 + 0.3 * k)), YEL if cur[2] == 3 else WHITE, sw=10)
        if cur[2] == 0:
            stroke_text(d, (W / 2, 960), "nothing in the photo has a size you know", font(44, BOLD), WHITE, sw=4)
    # ---- scene 5 + tail: the ask
    else:
        img, m = view(*cam(TIGHT, MID, (t - S[5]) / 3))
        img = darken(img, 0.25).convert("RGBA")
        ov = Image.new("RGBA", img.size, (0, 0, 0, 0))
        d = ImageDraw.Draw(ov)
        trace(d, m, 1.0, RED, 10, glow=False)
        tc = tl.w(5, "coin")
        if t >= tc - 0.1:
            p = (t - tc + 0.1) / 0.45
            end = to_screen(CRACK[-1], m)
            cx, cy = end[0] + 150, end[1] + 40
            y = cy - 700 * (1 - back(p))
            r = 78
            d.ellipse((cx - r + 6, y - r + 10, cx + r + 6, y + r + 10), fill=(0, 0, 0, 90))
            d.ellipse((cx - r, y - r, cx + r, y + r), fill=(205, 170, 80), outline=(140, 110, 40), width=6)
            d.ellipse((cx - r * .72, y - r * .72, cx + r * .72, y + r * .72), outline=(160, 128, 55), width=4)
            if p > 1:
                stroke_text(d, (cx, cy + r + 50), "+ coin", font(54, BOLD), WHITE, sw=5)
        tm = tl.w(5, "measure")
        if t >= tm - 0.2:
            q = ease((t - tm + 0.2) / 0.4)
            y0 = int(1700 - 560 * q)
            d.rounded_rectangle((70, y0, W - 70, y0 + 470), 44, fill=(255, 255, 255, 245))
            d.text((W / 2, y0 + 90), "Reply with your crack", font=font(64), fill=BLACK, anchor="mm")
            d.text((W / 2, y0 + 170), "+ a coin. We'll measure it.", font=font(56, BOLD), fill=BLACK, anchor="mm")
            f = font(70)
            wl = d.textlength("Snap", font=f)
            wr = d.textlength("Claim", font=f)
            x = (W - wl - wr) / 2
            d.text((x, y0 + 290), "Snap", font=f, fill=BLACK, anchor="lm")
            d.text((x + wl, y0 + 290), "Claim", font=f, fill=RED, anchor="lm")
            d.text((W / 2, y0 + 385), "snapclaim.pages.dev", font=font(44, MONO), fill=(60, 60, 60), anchor="mm")
        img.alpha_composite(ov)
    if t < tl.dur + 0.1:
        tm5 = tl.w(5, "measure")
        if not (sc == 5 and t >= tm5 - 0.2) and sc != 4:
            captions(img, tl, t)
    d = ImageDraw.Draw(img)
    d.text((W - 24, H - 24), "photo: Nolan Issac, CC0", font=font(24, BOLD), fill=(255, 255, 255, 160), anchor="rd")
    return img.convert("RGB")


# ---------------------------------------------------------------- audio

def tone(f, dur, amp, decay=8.0, noise=False):
    n = int(SR * dur)
    tt = np.arange(n) / SR
    s = np.random.default_rng(int(f * 7)).normal(0, 1, n) if noise else np.sin(2 * np.pi * f * tt)
    s = s * amp * np.exp(-tt * decay)
    return np.pad(s, (0, max(0, SR - n)))


def mix(buf, sig, t):
    i = int(t * SR)
    if 0 <= i < len(buf):
        j = min(len(buf), i + len(sig))
        buf[i:j] += sig[:j - i]


def audio(tl, path):
    n = int((tl.end + 1) * SR)
    out = np.zeros(n)
    with wave.open(str(OUT / "voice.wav")) as f:
        v = np.frombuffer(f.readframes(f.getnframes()), np.int16).astype(np.float64) / 32768
    mix(out, np.interp(np.arange(len(v) * 2) / 2, np.arange(len(v)), v), LEAD)
    # low tension bed: 95 BPM plucks, minor
    beat = 60 / 95
    notes = [110.0, 130.8, 164.8, 130.8]
    for k in range(int(tl.end / beat)):
        tb = k * beat
        mix(out, tone(55, 0.3, 0.13, 14), tb) if k % 2 == 0 else mix(out, tone(1, 0.06, 0.03, 60, True), tb)
        mix(out, tone(notes[k % 4] * 2, 0.4, 0.035, 7), tb)
    S = tl.st
    mix(out, tone(60, 0.4, 0.45, 9) + tone(1, 0.1, 0.1, 40, True), 0.02)          # hook hit
    mix(out, tone(1, 0.4, 0.06, 6, True), S[0] + 0.85)                              # whoosh into zoom
    span = max(1.2, S[2] - S[1] - 0.2)
    for k in range(3):
        mix(out, tone(1000 if k < 2 else 1500, 0.08, 0.12, 40), S[1] + k * span / 3)  # countdown ticks
    for k in range(6):
        mix(out, tone(2200 + 120 * (k % 2), 0.05, 0.03, 50), S[2] + 0.2 + k * 0.15)  # scanning blips
    mix(out, tone(90, 0.3, 0.4, 12) + tone(1, 0.12, 0.12, 30, True), tl.w(3, "no"))  # refused stamp
    for key in ("you", "ai"):
        mix(out, tone(70, 0.25, 0.3, 14), tl.w(4, key))
    mix(out, tone(70, 0.25, 0.3, 14), S[4]); mix(out, tone(70, 0.25, 0.3, 14), tl.w(4, "nobody"))
    mix(out, tone(60, 0.4, 0.4, 9), tl.w(4, "landlord") - 0.25)
    mix(out, tone(2400, 0.4, 0.1, 10) + tone(3600, 0.3, 0.05, 12), tl.w(5, "coin") + 0.32)
    mix(out, tone(1046.5, 0.7, 0.1, 5) + tone(1568, 0.7, 0.07, 5), tl.w(5, "measure"))
    out = np.tanh(out * 1.1) * 0.9
    with wave.open(str(path), "wb") as f:
        f.setnchannels(1), f.setsampwidth(2), f.setframerate(SR), f.writeframes((out * 32767).astype(np.int16).tobytes())


# ---------------------------------------------------------------- main

def main():
    args = sys.argv[1:]
    OUT.mkdir(exist_ok=True)
    if "--revoice" in args:
        return revoice()
    tl = TL(*load_words())
    if "--still" in args:
        t = float(args[args.index("--still") + 1])
        return frame(tl, t).save(OUT / f"still-{t:05.2f}.png")
    if "--sheet" in args:
        S = tl.st
        ts = sorted([0.05, S[0] + 0.6, S[0] + 2.0, S[1] + 0.3, S[1] + 1.2, S[2] + 0.4, S[3] + 0.2,
                     tl.w(3, "number") + 0.2, S[4] + 0.3, tl.w(4, "you") + 0.1, tl.w(4, "landlord"),
                     tl.w(5, "coin") + 0.7, tl.w(5, "measure") + 0.6, tl.end - 0.1])
        cols = 7
        sheet = Image.new("RGB", (cols * 216, math.ceil(len(ts) / cols) * 384))
        for i, t in enumerate(ts):
            sheet.paste(frame(tl, t).resize((216, 384), Image.LANCZOS), ((i % cols) * 216, (i // cols) * 384))
        sheet.save(OUT / "sheet.png")
        return print("times:", [round(t, 2) for t in ts])
    dst = Path(args[0]) if args and not args[0].startswith("--") else OUT / "09-guess-the-length.mp4"
    wav = OUT / "mix.wav"
    audio(tl, wav)
    nf = int(tl.end * FPS)
    ff = subprocess.Popen(
        ["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS),
         "-i", "-", "-i", str(wav), "-c:v", "libx264", "-preset", "medium", "-crf", "19", "-pix_fmt", "yuv420p",
         "-af", "loudnorm=I=-14:TP=-1.5:LRA=11", "-c:a", "aac", "-b:a", "192k", "-ar", "48000",
         "-shortest", "-movflags", "+faststart", str(dst)], stdin=subprocess.PIPE)
    for i in range(nf):
        ff.stdin.write(frame(tl, i / FPS).tobytes())
    ff.stdin.close()
    ff.wait()
    print(f"wrote {dst} ({nf / FPS:.1f}s)")


if __name__ == "__main__":
    main()
