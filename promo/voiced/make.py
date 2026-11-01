"""SnapClaim promo 08: "Your word against his." (9:16, 30 fps, narrated)

Voice: ElevenLabs (narrator "Mark", eleven_multilingual_v2) with per-word timings
that drive the karaoke captions and every scene change. Everything else (wall,
crack, coin, UI, music bed, sfx) is drawn or synthesized here.
Numbers match the engine's wall-crack fixture (R004 85.9 mm at 0.0941 mm/px).

Usage:
  ELEVENLABS_API_KEY=... python make.py --revoice   # fetch voice (cached in out/)
  python make.py [out.mp4] [--still SECONDS] [--sheet]
"""
import base64
import json
import math
import os
import random
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
W, H, FPS = 1080, 1920, 30
SR = 48000
VOICE_ID = "1SM7GgM6IMuvQlz2BwM3"  # Mark
LEAD = 0.25   # silence before the first word
TAIL = 1.6    # end card hold after the last word

SCENES = [
    "Your landlord wants to keep half your deposit. Because of this crack.",
    "You say it was already there. He says it got worse. Right now, it's your word against his.",
    "So put a coin next to it. Coins come in a fixed size, so you always have a ruler on you.",
    "Tap the crack, tap the coin. SnapClaim works out the scale and measures it. Eighty-five point nine millimetres.",
    "And every number in the report shows exactly how it was worked out.",
    "Move-in day: eighty-five point nine. Move-out day: eighty-five point nine. It didn't get worse.",
    "Now it's not your word against his. It's a measurement.",
]

# ---------------------------------------------------------------- voice

def revoice():
    key = os.environ.get("ELEVENLABS_API_KEY")
    if not key:
        raise SystemExit("set ELEVENLABS_API_KEY")
    text, owner = "", []
    for i, s in enumerate(SCENES):
        if text:
            text += " "
            owner.append(i)
        text += s
        owner += [i] * len(s)
    body = {"text": text, "model_id": "eleven_multilingual_v2",
            "voice_settings": {"stability": 0.45, "similarity_boost": 0.75, "style": 0.15, "speed": 1.0}}
    req = urllib.request.Request(
        f"https://api.elevenlabs.io/v1/text-to-speech/{VOICE_ID}/with-timestamps?output_format=pcm_24000",
        data=json.dumps(body).encode(), headers={"xi-api-key": key, "Content-Type": "application/json"})
    with urllib.request.urlopen(req) as r:
        res = json.loads(r.read())
    pcm = np.frombuffer(base64.b64decode(res["audio_base64"]), dtype=np.int16)
    al = res["alignment"]
    if "".join(al["characters"]) != text:
        raise SystemExit("alignment differs from script")
    st, en = al["character_start_times_seconds"], al["character_end_times_seconds"]
    words = [{"w": m.group(), "s": st[m.start()], "e": en[m.end() - 1], "scene": owner[m.start()]}
             for m in re.finditer(r"\S+", text)]
    # trim long pauses to keep pace (~0.35 s inside a scene, 0.5 s between scenes)
    keep_pcm, cur, shift = [], 0, 0.0
    for i, w in enumerate(words):
        w["s"] -= shift
        w["e"] -= shift
        if i + 1 < len(words):
            nxt = words[i + 1]
            keep = 0.5 if nxt["scene"] != w["scene"] else 0.35
            gap = (nxt["s"] - shift) - w["e"]
            if gap > keep:
                a = int((w["e"] + shift + keep / 2) * 24000)
                b = int((nxt["s"] - keep / 2) * 24000)
                keep_pcm.append(pcm[cur:a])
                cur = b
                shift += gap - keep
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


def font(size, weight="Bold", mono=False):
    k = (size, weight, mono)
    if k not in _fc:
        if mono:
            f = ImageFont.truetype(FONTS + ("consolab.ttf" if weight == "Bold" else "consola.ttf"), int(size))
        else:
            f = ImageFont.truetype(FONTS + "bahnschrift.ttf", int(size))
            try:
                f.set_variation_by_name(weight)
            except Exception:
                pass
        _fc[k] = f
    return _fc[k]


def clamp(x, a=0.0, b=1.0):
    return max(a, min(b, x))


def ease(x):
    x = clamp(x)
    return 1 - (1 - x) ** 3


def back(x):
    x = clamp(x)
    c = 1.9
    return 1 + (c + 1) * (x - 1) ** 3 + c * (x - 1) ** 2


PAPER = (243, 238, 230)
INK = (24, 22, 28)
MUTED = (150, 142, 132)
RED = (226, 58, 46)
GREEN = (36, 160, 92)
BLUE = (46, 108, 210)

CARD = 860
CX0, CY0 = (W - CARD) // 2, 210


def rr(d, box, r, **kw):
    d.rounded_rectangle(box, r, **kw)


def text_c(d, xy, s, f, fill, anchor="mm"):
    d.text(xy, s, font=f, fill=fill, anchor=anchor)


def chip(d, cx, cy, s, f, bg, fg, pad=(26, 14), anchor="mm"):
    l, t, r, b = d.textbbox((0, 0), s, font=f, anchor="lt")
    w, h = r - l + pad[0] * 2, b - t + pad[1] * 2
    if anchor == "mm":
        x0, y0 = cx - w / 2, cy - h / 2
    else:  # right-top
        x0, y0 = cx - w, cy
    rr(d, (x0, y0, x0 + w, y0 + h), h / 2, fill=bg)
    d.text((x0 + pad[0] - l, y0 + pad[1] - t), s, font=f, fill=fg)
    return (x0, y0, x0 + w, y0 + h)


# ---------------------------------------------------------------- the wall

def make_wall():
    rng = np.random.default_rng(8)
    n = rng.normal(0, 1, (CARD // 4, CARD // 4))
    img = Image.fromarray(((n - n.min()) / (n.max() - n.min()) * 255).astype(np.uint8))
    low = np.asarray(img.resize((CARD, CARD), Image.BICUBIC).filter(ImageFilter.GaussianBlur(6)), np.float32)
    fine = rng.normal(0, 1, (CARD, CARD)).astype(np.float32)
    base = 214 + (low - 128) * 0.16 + fine * 4.5
    rgb = np.stack([base + 4, base + 1, base - 6], -1).clip(0, 255).astype(np.uint8)
    wall = Image.fromarray(rgb, "RGB")
    # soft vignette
    yy, xx = np.mgrid[0:CARD, 0:CARD]
    v = 1 - 0.18 * (((xx - CARD / 2) ** 2 + (yy - CARD / 2) ** 2) / (CARD / 2) ** 2)
    wall = Image.fromarray((np.asarray(wall, np.float32) * v[..., None]).clip(0, 255).astype(np.uint8))
    return wall


def make_crack():
    random.seed(31)
    pts = [(250.0, 120.0)]
    end = (575.0, 640.0)
    steps = 46
    for i in range(1, steps + 1):
        f = i / steps
        x = 250 + (end[0] - 250) * f + math.sin(f * 9.0) * 34 + random.uniform(-13, 13)
        y = 120 + (end[1] - 120) * f + random.uniform(-6, 6)
        pts.append((x, y))
    cum = [0.0]
    for a, b in zip(pts, pts[1:]):
        cum.append(cum[-1] + math.dist(a, b))
    branch = [pts[19]]
    for i in range(1, 9):
        p = branch[-1]
        branch.append((p[0] + 11 + random.uniform(-4, 4), p[1] - 3 + random.uniform(-5, 5)))
    return pts, cum, branch


WALL = make_wall()
CRACK, CUM, BRANCH = make_crack()
COIN = (665, 712, 62)  # card coords, radius


def draw_crack(d, ox, oy, s=1.0):
    P = [(ox + x * s, oy + y * s) for x, y in CRACK]
    d.line(P, fill=(58, 50, 44), width=max(1, int(8 * s)), joint="curve")
    d.line(P, fill=(24, 20, 18), width=max(1, int(4 * s)), joint="curve")
    B = [(ox + x * s, oy + y * s) for x, y in BRANCH]
    d.line(B, fill=(40, 34, 30), width=max(1, int(3.5 * s)), joint="curve")


def trace_points(frac, ox, oy, s=1.0):
    target = CUM[-1] * clamp(frac)
    out = [CRACK[0]]
    for i in range(1, len(CRACK)):
        if CUM[i] <= target:
            out.append(CRACK[i])
        else:
            a, b = CRACK[i - 1], CRACK[i]
            seg = CUM[i] - CUM[i - 1]
            k = (target - CUM[i - 1]) / seg if seg else 0
            out.append((a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k))
            break
    return [(ox + x * s, oy + y * s) for x, y in out]


def draw_coin(d, cx, cy, r, ring=None):
    d.ellipse((cx - r + 5, cy - r + 9, cx + r + 5, cy + r + 9), fill=(150, 140, 128))  # shadow
    d.ellipse((cx - r, cy - r, cx + r, cy + r), fill=(182, 184, 188), outline=(128, 130, 136), width=max(2, int(r * .07)))
    d.ellipse((cx - r * .78, cy - r * .78, cx + r * .78, cy + r * .78), outline=(150, 152, 158), width=max(1, int(r * .04)))
    d.ellipse((cx - r * .55, cy - r * .62, cx - r * .05, cy - r * .2), fill=(205, 207, 210))
    if ring:
        d.ellipse((cx - r - 10, cy - r - 10, cx + r + 10, cy + r + 10), outline=ring, width=7)


def ripple(d, cx, cy, p, col):
    if 0 < p < 1:
        r = 20 + 70 * ease(p)
        a = int(255 * (1 - p))
        d.ellipse((cx - r, cy - r, cx + r, cy + r), outline=col + (a,), width=6)
        d.ellipse((cx - 14, cy - 14, cx + 14, cy + 14), fill=col + (a,))


# ---------------------------------------------------------------- scenes

def scene_times(words):
    st = {}
    for w in words:
        st.setdefault(w["scene"], w["s"])
    return [st[i] for i in range(len(SCENES))]


def word_time(words, scene, needle, which=0):
    hits = [w for w in words if w["scene"] == scene and w["w"].lower().strip(".,:;!?\"'").startswith(needle.lower())]
    return hits[min(which, len(hits) - 1)]["s"]


class Timeline:
    def __init__(self, words, dur):
        self.words, self.dur = words, dur
        self.st = scene_times(words)
        self.end = dur + TAIL
        T = lambda sc, n, k=0: word_time(words, sc, n, k)
        self.t = {
            "deposit": T(0, "deposit"), "crack0": T(0, "crack"),
            "b1": T(1, "You"), "b2": T(1, "He"), "q": T(1, "word"),
            "coin": T(2, "coin"), "fixed": T(2, "fixed"), "ruler": T(2, "ruler"),
            "tapcrack": T(3, "crack"), "tapcoin": T(3, "coin"), "scale": T(3, "scale"),
            "eighty": T(3, "Eighty"), "receipt": self.st[4], "split": self.st[5],
            "in": T(5, "eighty", 0), "out": T(5, "eighty", 1), "worse": T(5, "didn't"),
            "end": self.st[6], "measure": T(6, "measurement"),
        }

    def scene(self, t):
        i = 0
        for k, s in enumerate(self.st):
            if t >= s - 0.12:
                i = k
        return i


def render_card(tl, t, sc):
    """The wall card for scenes 0-4 (RGBA overlay drawn on a copy of the wall)."""
    T = tl.t
    card = WALL.copy().convert("RGBA")
    ov = Image.new("RGBA", card.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(ov)
    draw_crack(d, 0, 0)
    cx, cy, cr = COIN
    # coin drops in during scene 2
    if t >= T["coin"] - 0.1:
        p = (t - (T["coin"] - 0.1)) / 0.45
        y = cy - 520 * (1 - back(p)) if p < 1 else cy
        ring = None
        if t >= T["tapcoin"]:
            ring = GREEN
        draw_coin(d, cx, y, cr, ring)
        if sc == 2 and t >= T["fixed"] - 0.1:
            q = ease((t - T["fixed"] + 0.1) / 0.35)
            yl = cy + cr + 34
            d.line((cx - cr, yl, cx - cr + 2 * cr * q, yl), fill=INK, width=5)
            d.line((cx - cr, yl - 14, cx - cr, yl + 14), fill=INK, width=5)
            if q >= 1:
                d.line((cx + cr, yl - 14, cx + cr, yl + 14), fill=INK, width=5)
                chip(d, cx - 150, cy - cr - 56, "fixed size = known mm", font(34), INK, (255, 255, 255))
    # trace + taps during scene 3+
    if sc >= 3:
        ripple(d, *CRACK[10], (t - T["tapcrack"]) / 0.6, RED)
        ripple(d, cx, cy, (t - T["tapcoin"]) / 0.6, GREEN)
        frac = ease((t - T["scale"]) / max(0.6, T["eighty"] + 0.9 - T["scale"]))
        if frac > 0:
            P = trace_points(frac, 0, 0)
            if len(P) > 1:
                d.line(P, fill=(226, 58, 46, 110), width=20, joint="curve")
                d.line(P, fill=RED, width=8, joint="curve")
        if t >= T["scale"] and sc == 3:
            chip(d, 40 + 230, CARD - 50, "scale from coin: 0.0941 mm/px", font(32, mono=True), GREEN, (255, 255, 255))
        if t >= T["eighty"] - 0.6:
            k = ease((t - T["eighty"] + 0.6) / 1.3)
            v = 85.9 * k
            chip(d, CARD - 36, 36, f"{v:4.1f} mm", font(76), RED, (255, 255, 255), pad=(30, 16), anchor="rt")
    card.alpha_composite(ov)
    return card


def draw_bubble(img, x, y, s, col, p, tail_left):
    if p <= 0:
        return
    k = back(p)
    f = font(54)
    tmp = Image.new("RGBA", (700, 220), (0, 0, 0, 0))
    d = ImageDraw.Draw(tmp)
    l, tt, r, b = d.textbbox((0, 0), s, font=f, anchor="lt")
    w, h = r - l + 64, b - tt + 44
    rr(d, (10, 10, 10 + w, 10 + h), 34, fill=col)
    tx = 50 if tail_left else w - 40
    d.polygon([(tx, 10 + h - 2), (tx + 34, 10 + h - 2), (tx + (0 if tail_left else 34), 10 + h + 34)], fill=col)
    d.text((10 + 32 - l, 10 + 22 - tt), s, font=f, fill=(255, 255, 255))
    tmp = tmp.crop((0, 0, w + 20, h + 56))
    sw, sh = max(1, int(tmp.width * k)), max(1, int(tmp.height * k))
    tmp = tmp.resize((sw, sh), Image.BICUBIC)
    img.alpha_composite(tmp, (int(x - sw / 2), int(y - sh / 2)))


def receipt(img, p):
    if p <= 0:
        return
    w, h = 700, 380
    rc = Image.new("RGBA", (w, h + 20), (0, 0, 0, 0))
    d = ImageDraw.Draw(rc)
    d.rectangle((0, 0, w, h), fill=(255, 253, 248))
    for x in range(0, w, 28):  # torn edge
        d.polygon([(x, h), (x + 14, h + 18), (x + 28, h)], fill=(255, 253, 248))
    m, mb = font(36, "Regular", True), font(40, "Bold", True)
    d.text((40, 34), "RECEIPT  R004", font=mb, fill=INK)
    d.text((40, 96), "crack length", font=m, fill=(120, 116, 110))
    d.text((40, 150), "913 px", font=m, fill=INK)
    d.text((40, 200), "x 0.0941 mm/px  (coin)", font=m, fill=INK)
    d.line((40, 262, w - 40, 262), fill=INK, width=3)
    d.text((40, 284), "= 85.9 mm", font=font(54, "Bold", True), fill=RED)
    gx, gy = w - 90, 312
    d.ellipse((gx - 32, gy - 32, gx + 32, gy + 32), fill=GREEN)
    d.line([(gx - 15, gy + 1), (gx - 4, gy + 13), (gx + 17, gy - 12)], fill=(255, 255, 255), width=8, joint="curve")
    k = ease(p)
    shadow = Image.new("RGBA", rc.size, (0, 0, 0, 0))
    ImageDraw.Draw(shadow).rectangle((10, 14, w + 10, h + 14), fill=(0, 0, 0, 60))
    y = int(CY0 + CARD - 300 + (1 - k) * 700)
    img.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(12)), ((W - w) // 2, y))
    img.alpha_composite(rc, ((W - w) // 2, y))


_traced_small = {}


def small_card(label, value, show_val):
    key = (label, show_val)
    if key not in _traced_small:
        c = WALL.copy().convert("RGBA")
        d = ImageDraw.Draw(c)
        draw_crack(d, 0, 0)
        d.line(trace_points(1, 0, 0), fill=RED, width=10, joint="curve")
        draw_coin(d, *COIN, ring=GREEN)
        c = c.resize((450, 450), Image.LANCZOS)
        d = ImageDraw.Draw(c)
        chip(d, 225, 44, label, font(36), INK, (255, 255, 255))
        if show_val:
            chip(d, 225, 396, value, font(56), RED, (255, 255, 255))
        _traced_small[key] = c
    return _traced_small[key]


def captions(img, tl, t):
    sc = tl.scene(t)
    ws = [w for w in tl.words if w["scene"] == sc]
    d = ImageDraw.Draw(img)
    f = font(70)
    maxw, lh = 940, 92
    lines, cur, curw = [], [], 0
    space = d.textlength(" ", font=f)
    for w in ws:
        lw = d.textlength(w["w"], font=f)
        if cur and curw + space + lw > maxw:
            lines.append((cur, curw))
            cur, curw = [], 0
        cur.append((w, lw))
        curw += (space if len(cur) > 1 else 0) + lw
    if cur:
        lines.append((cur, curw))
    top = 1220 if sc < 5 else 1240
    y = top + max(0, (4 - len(lines))) * lh / 2
    for ln, lw in lines:
        x = (W - lw) / 2
        for w, wl in ln:
            spoken = t >= w["s"]
            current = w["s"] <= t < w["e"] + 0.05
            col = INK if spoken else MUTED
            if current:
                rr(d, (x - 10, y - 4, x + wl + 10, y + lh - 14), 14, fill=(255, 214, 77))
            d.text((x, y), w["w"], font=f, fill=col)
            x += wl + space
        y += lh


def frame(tl, t):
    T = tl.t
    sc = tl.scene(t)
    img = Image.new("RGBA", (W, H), PAPER + (255,))
    d = ImageDraw.Draw(img)
    # progress bar
    d.rectangle((0, 0, W * clamp(t / tl.end), 10), fill=RED)

    if sc <= 4:
        card = render_card(tl, t, sc)
        # punch-in on the hook
        z = 1.0 + 0.06 * (1 - ease(t / 0.5)) if t < 0.5 else 1.0
        if z != 1.0:
            s = int(CARD * z)
            card = card.resize((s, s), Image.BICUBIC)
        mask = Image.new("L", card.size, 0)
        ImageDraw.Draw(mask).rounded_rectangle((0, 0, card.width - 1, card.height - 1), 36, fill=255)
        ox, oy = CX0 - (card.width - CARD) // 2, CY0 - (card.height - CARD) // 2
        sh = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        ImageDraw.Draw(sh).rounded_rectangle((ox + 6, oy + 18, ox + card.width + 6, oy + card.height + 18), 36, fill=(60, 40, 20, 70))
        img.alpha_composite(sh.filter(ImageFilter.GaussianBlur(18)))
        img.paste(card, (ox, oy), mask)
        d = ImageDraw.Draw(img)
        if sc == 0:
            p = t / 0.3 + 0.6
            k = back(p)
            fs = int(64 * max(0.01, k))
            chip(d, W / 2, CY0 + 70, "DEPOSIT  -50%", font(fs), RED, (255, 255, 255), pad=(30, 14))
        if sc == 0 and t >= T["crack0"]:
            px, py = CX0 + CRACK[24][0] + 90, CY0 + CRACK[24][1]
            q = ease((t - T["crack0"]) / 0.3)
            d.line((px + 150, py - 60, px + 150 - 120 * q, py - 60 + 48 * q), fill=RED, width=10)
            if q >= 1:
                d.polygon([(px + 18, py - 2), (px + 50, py - 34), (px + 58, py - 4)], fill=RED)
        if sc == 1:
            draw_bubble(img, W / 2 - 150, CY0 + 160, "It was already there.", BLUE, (t - T["b1"]) / 0.3, True)
            draw_bubble(img, W / 2 + 190, CY0 + 360, "It got worse.", RED, (t - T["b2"]) / 0.3, False)
            if t >= T["q"] - 0.2:
                k = back((t - T["q"] + 0.2) / 0.35)
                tf = font(int(240 * max(0.01, k)))
                text_c(d, (W / 2, CY0 + 650), "?", tf, INK)
        if sc == 4:
            receipt(img, (t - T["receipt"]) / 0.45)
    elif sc == 5:
        p = ease((t - T["split"]) / 0.45)
        a = small_card("MOVE-IN", "85.9 mm", t >= T["in"])
        b = small_card("MOVE-OUT", "85.9 mm", t >= T["out"])
        y = int(380 + (1 - p) * 60)
        img.alpha_composite(a, (int(60 - (1 - p) * 300), y))
        img.alpha_composite(b, (int(W - 60 - 450 + (1 - p) * 300), y))
        if t >= T["out"] + 0.2:
            text_c(d, (W / 2, y + 225), "=", font(90), INK)
        if t >= T["worse"] - 0.1:
            k = back((t - T["worse"] + 0.1) / 0.35)
            chip(d, W / 2, y + 590, "NO CHANGE", font(int(80 * max(0.01, k))), GREEN, (255, 255, 255), pad=(40, 18))
    else:
        p = ease((t - T["end"]) / 0.4)
        y0 = 520
        text_c(d, (W / 2, y0), "Not your word.", font(96), INK)
        if t >= T["measure"] - 0.1:
            k = back((t - T["measure"] + 0.1) / 0.35)
            text_c(d, (W / 2, y0 + 140), "A measurement.", font(int(110 * max(0.01, k))), RED)
        if t >= T["measure"] + 0.9:
            q = ease((t - T["measure"] - 0.9) / 0.4)
            yy = int(y0 + 330 + (1 - q) * 40)
            f = font(84)
            wl, wr = d.textlength("Snap", font=f), d.textlength("Claim", font=f)
            x = (W - wl - wr) / 2
            d.text((x, yy), "Snap", font=f, fill=INK, anchor="lm")
            d.text((x + wl, yy), "Claim", font=f, fill=RED, anchor="lm")
            text_c(d, (W / 2, yy + 80), "Every number has a receipt.", font(42, "Regular"), (90, 86, 80))
            chip(d, W / 2, yy + 170, "snapclaim.pages.dev", font(44, "Bold", True), (255, 214, 77), INK)
    if sc < 6 or t < tl.dur - 0.1:
        captions(img, tl, t)
    return img.convert("RGB")


# ---------------------------------------------------------------- audio

def tone(f, dur, amp, decay=8.0, kind="sine"):
    n = int(SR * dur)
    tt = np.arange(n) / SR
    if kind == "noise":
        s = np.random.default_rng(int(f)).normal(0, 1, n)
    else:
        s = np.sin(2 * np.pi * f * tt)
    s = s * amp * np.exp(-tt * decay)
    return np.pad(s, (0, max(0, int(SR * 0.8) - n)))


def mix(buf, sig, t):
    i = int(t * SR)
    if i < 0 or i >= len(buf):
        return
    j = min(len(buf), i + len(sig))
    buf[i:j] += sig[:j - i]


def audio(tl, path):
    n = int(tl.end * SR) + SR
    out = np.zeros(n)
    # voice (24k -> 48k)
    with wave.open(str(OUT / "voice.wav")) as f:
        v = np.frombuffer(f.readframes(f.getnframes()), np.int16).astype(np.float64) / 32768
    v48 = np.interp(np.arange(len(v) * 2) / 2, np.arange(len(v)), v)
    mix(out, v48 * 0.95, LEAD)
    # music bed: soft pad, Am F C G, 2 s per chord
    tt = np.arange(n) / SR
    chords = [(220.0, 261.6, 329.6), (174.6, 220.0, 261.6), (196.0, 261.6, 329.6), (196.0, 246.9, 293.7)]
    bed = np.zeros(n)
    for k in range(int(tl.end / 2) + 1):
        a, b = int(k * 2 * SR), min(n, int((k + 1) * 2 * SR))
        seg = tt[a:b] - k * 2
        env = np.minimum(1, seg / 0.3) * np.minimum(1, (2 - seg) / 0.3)
        for fr in chords[k % 4]:
            bed[a:b] += (np.sin(2 * np.pi * fr * tt[a:b]) + 0.3 * np.sin(2 * np.pi * fr * 2 * tt[a:b])) * env
    pulse = 0.75 + 0.25 * np.sin(2 * np.pi * 2.0 * tt)
    out += bed * pulse * 0.012
    # kick on each beat, quiet
    for k in range(int(tl.end * 2)):
        mix(out, tone(55, 0.25, 0.10, 18), k * 0.5)
    T = tl.t
    pop = lambda t: mix(out, tone(880, 0.12, 0.10, 30) + tone(1320, 0.08, 0.05, 40), t)
    mix(out, tone(70, 0.35, 0.35, 10) + tone(1, 0.08, 0.08, 50, "noise"), 0.0)       # hook thud
    mix(out, tone(1, 0.25, 0.12, 14, "noise") + tone(90, 0.3, 0.25, 12), 0.05)  # stamp
    pop(T["b1"]); pop(T["b2"])
    mix(out, tone(2400, 0.4, 0.10, 10) + tone(3600, 0.3, 0.05, 12), T["coin"] + 0.3)    # coin clink
    mix(out, tone(2600, 0.3, 0.07, 14), T["coin"] + 0.42)
    mix(out, tone(1200, 0.06, 0.08, 60), T["tapcrack"]); mix(out, tone(1500, 0.06, 0.08, 60), T["tapcoin"])
    for k in range(10):
        mix(out, tone(1800 + k * 60, 0.03, 0.04, 90), T["eighty"] - 0.6 + k * 0.13)
    mix(out, tone(1046.5, 0.6, 0.09, 6) + tone(1568, 0.6, 0.06, 6), T["eighty"] + 0.75)  # ding
    mix(out, tone(1, 0.3, 0.05, 10, "noise"), T["receipt"])                              # paper
    mix(out, tone(784, 0.5, 0.09, 6) + tone(1175, 0.5, 0.06, 6), T["worse"])
    mix(out, tone(60, 0.5, 0.35, 7), T["measure"])
    out = np.tanh(out * 1.1) * 0.9
    pcm = (out * 32767).astype(np.int16)
    with wave.open(str(path), "wb") as f:
        f.setnchannels(1), f.setsampwidth(2), f.setframerate(SR), f.writeframes(pcm.tobytes())


# ---------------------------------------------------------------- main

def main():
    args = sys.argv[1:]
    OUT.mkdir(exist_ok=True)
    if "--revoice" in args:
        revoice()
        return
    words, dur = load_words()
    tl = Timeline(words, dur)
    if "--still" in args:
        t = float(args[args.index("--still") + 1])
        frame(tl, t).save(OUT / f"still-{t:05.2f}.png")
        return
    if "--sheet" in args:
        ts = [0.0] + [s + 0.9 for s in tl.st] + [tl.t["eighty"] + 1.2, tl.t["worse"] + 0.5, tl.end - 0.1]
        ts = sorted(ts)
        cols = 6
        rows = math.ceil(len(ts) / cols)
        sheet = Image.new("RGB", (cols * 270, rows * 480), (0, 0, 0))
        for i, t in enumerate(ts):
            sheet.paste(frame(tl, t).resize((270, 480), Image.LANCZOS), ((i % cols) * 270, (i // cols) * 480))
        sheet.save(OUT / "sheet.png")
        print("times:", [round(t, 2) for t in ts])
        return
    dst = Path(args[0]) if args and not args[0].startswith("--") else OUT / "08-word-against-his.mp4"
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
