"""SnapClaim promo: "We caught our AI making up a number." (9:16, 22 s, 30 fps)

Everything is drawn here: plaster wall, crack, coin, UI and the sound.
Numbers match the engine's wall-crack fixture (R004 85.9 mm at 0.0941 mm/px).
Usage: python make.py [out.mp4] [--still SECONDS]   (needs ffmpeg on PATH)
"""
import math
import random
import subprocess
import sys
import wave
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

W, H, FPS, DUR = 1080, 1920, 30, 22.0
HERE = Path(__file__).parent
OUT = Path(sys.argv[1]) if len(sys.argv) > 1 and not sys.argv[1].startswith("--") else HERE / "out" / "07-ai-caught.mp4"

BG = (11, 13, 16)
INK = (244, 242, 236)
DIM = (150, 154, 162)
RED = (255, 59, 48)
GREEN = (52, 199, 89)
YELLOW = (255, 214, 10)
CARD = (28, 31, 36)

FONTS = "C:/Windows/Fonts/"
_fc = {}


def font(name, size):
    key = (name, int(size))
    if key not in _fc:
        _fc[key] = ImageFont.truetype(FONTS + name, int(size))
    return _fc[key]


BLACK, BOLD, REG, MONO, MONOB = "seguibl.ttf", "segoeuib.ttf", "segoeui.ttf", "consola.ttf", "consolab.ttf"


# ---------- easing ----------
def clamp(x, a=0.0, b=1.0):
    return max(a, min(b, x))


def prog(t, start, dur):
    return clamp((t - start) / dur)


def out_cubic(x):
    return 1 - (1 - x) ** 3


def out_back(x, s=2.2):
    x -= 1
    return 1 + (s + 1) * x ** 3 + s * x ** 2


# ---------- text ----------
def text_w(d, s, f):
    return d.textlength(s, font=f)


def center_text(d, y, s, f, fill, x=W / 2):
    d.text((x - text_w(d, s, f) / 2, y), s, font=f, fill=fill)


# ---------- static art ----------
rng = random.Random(7)
WALL_X, WALL_Y, WALL_W, WALL_H = 60, 420, 960, 900


def make_wall():
    nrng = np.random.default_rng(3)
    base = np.array([226, 220, 208], dtype=np.float32)
    img = np.ones((WALL_H, WALL_W, 3), np.float32) * base
    for scale, amp in ((3, 10), (12, 9), (40, 7)):
        n = nrng.normal(0, 1, (WALL_H // scale + 2, WALL_W // scale + 2)).astype(np.float32)
        n = np.array(Image.fromarray(n).resize((WALL_W, WALL_H), Image.BICUBIC))
        img += n[..., None] * amp
    yy, xx = np.mgrid[0:WALL_H, 0:WALL_W]
    light = 1.0 - 0.22 * (((xx - WALL_W * 0.35) / WALL_W) ** 2 + ((yy - WALL_H * 0.3) / WALL_H) ** 2)
    img *= light[..., None]
    return Image.fromarray(np.clip(img, 0, 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.6))


def make_crack():
    pts, x, y, a = [], 170.0, 40.0, math.radians(62)
    while y < WALL_H - 160 and len(pts) < 400:
        pts.append((x, y))
        a += rng.uniform(-0.55, 0.55)
        a = 0.75 * a + 0.25 * math.radians(66)
        step = rng.uniform(9, 17)
        x += math.cos(a) * step
        y += math.sin(a) * step
    branch, bx, by = [], *pts[len(pts) * 2 // 5]
    ba = math.radians(10)
    for _ in range(14):
        branch.append((bx, by))
        ba += rng.uniform(-0.5, 0.5)
        bx += math.cos(ba) * 12
        by += math.sin(ba) * 12
    return pts, branch


def draw_crack(img, pts, branch):
    d = ImageDraw.Draw(img)
    for path, w0 in ((pts, 7), (branch, 4)):
        n = len(path)
        for i in range(n - 1):
            w = max(2, int(w0 * (1 - abs(i / n - 0.45) * 1.1)))
            (x1, y1), (x2, y2) = path[i], path[i + 1]
            d.line((x1 + 2, y1 + 2, x2 + 2, y2 + 2), fill=(250, 247, 240), width=max(1, w // 2))
            d.line((x1, y1, x2, y2), fill=(48, 42, 36), width=w)
    return img


COIN_C, COIN_R = (760, 760), 64


def draw_coin(img):
    cx, cy = COIN_C
    sh = Image.new("L", img.size, 0)
    ImageDraw.Draw(sh).ellipse((cx - COIN_R + 8, cy - COIN_R + 12, cx + COIN_R + 8, cy + COIN_R + 12), fill=110)
    img.paste((70, 62, 52), (0, 0), sh.filter(ImageFilter.GaussianBlur(9)))
    d = ImageDraw.Draw(img)
    for r in range(COIN_R, 0, -1):
        k = r / COIN_R
        c = tuple(int(v) for v in (150 + 70 * (1 - k), 152 + 66 * (1 - k), 160 + 60 * (1 - k)))
        d.ellipse((cx - r, cy - r, cx + r, cy + r), fill=c)
    d.ellipse((cx - COIN_R, cy - COIN_R, cx + COIN_R, cy + COIN_R), outline=(110, 112, 118), width=4)
    d.ellipse((cx - COIN_R + 14, cy - COIN_R + 14, cx + COIN_R - 14, cy + COIN_R - 14), outline=(175, 178, 186), width=3)
    f = font(BLACK, 46)
    d.text((cx - d.textlength("10", font=f) / 2, cy - 32), "10", font=f, fill=(120, 122, 130))
    return img


CRACK, BRANCH = make_crack()
WALL = draw_coin(draw_crack(make_wall(), CRACK, BRANCH))
SEG = [math.dist(CRACK[i], CRACK[i + 1]) for i in range(len(CRACK) - 1)]
TOTAL = sum(SEG)


def make_stamp(word, color, w=640, h=170):
    im = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.rounded_rectangle((6, 6, w - 6, h - 6), radius=22, outline=color + (255,), width=12)
    f = font(BLACK, 108)
    d.text(((w - d.textlength(word, font=f)) / 2, 8), word, font=f, fill=color + (255,))
    a = np.array(im)
    holes = np.random.default_rng(len(word)).random(a.shape[:2]) < 0.06
    a[..., 3][holes] = (a[..., 3][holes] * 0.25).astype(np.uint8)
    return Image.fromarray(a)


REJECT = make_stamp("REJECTED", RED)
SHIPPED = make_stamp("SHIPPED", GREEN, w=560)


# ---------- components ----------
def paste_stamp(img, stamp, cx, cy, scale, angle, alpha=1.0):
    if scale <= 0.01 or alpha <= 0:
        return
    s = stamp.resize((max(1, int(stamp.width * scale)), max(1, int(stamp.height * scale))), Image.BICUBIC)
    s = s.rotate(angle, resample=Image.BICUBIC, expand=True)
    if alpha < 1:
        a = s.getchannel("A").point(lambda v: int(v * alpha))
        s.putalpha(a)
    img.paste(s, (int(cx - s.width / 2), int(cy - s.height / 2)), s)


def wrap(d, s, f, maxw):
    words, lines, cur = s.split(" "), [], ""
    for wd in words:
        test = (cur + " " + wd).strip()
        if text_w(d, test, f) <= maxw:
            cur = test
        else:
            lines.append(cur)
            cur = wd
    lines.append(cur)
    return lines


def ai_bubble(img, y, typed, cursor_on, tag=None, tag_col=YELLOW):
    d = ImageDraw.Draw(img)
    x0, x1 = 70, W - 70
    f = font(BOLD, 54)
    lines = wrap(d, typed or " ", f, x1 - x0 - 80)
    h = 130 + 68 * len(lines)
    d.rounded_rectangle((x0, y, x1, y + h), radius=36, fill=CARD)
    d.ellipse((x0 + 40, y + 38, x0 + 62, y + 60), fill=YELLOW)
    d.text((x0 + 80, y + 28), "AI report writer", font=font(BOLD, 34), fill=DIM)
    yy = y + 92
    for i, ln in enumerate(lines):
        segs = [(ln, INK)]
        if tag and tag in ln:
            a, b = ln.split(tag, 1)
            segs = [(a, INK), (tag, tag_col), (b, INK)]
        xx = x0 + 40
        for s, c in segs:
            d.text((xx, yy), s, font=f, fill=c)
            xx += text_w(d, s, f)
        if i == len(lines) - 1 and cursor_on:
            d.rectangle((xx + 6, yy + 10, xx + 12, yy + 62), fill=INK)
        yy += 68
    return y + h


def typed(s, t, start, cps=22):
    n = int(clamp((t - start) * cps, 0, len(s)))
    return s[:n]


def wall_view(img, t, y_off=0, mask_p=0.0, coin_p=0.0, dim=0.0):
    w = WALL
    if dim > 0:
        w = Image.blend(WALL, Image.new("RGB", WALL.size, BG), dim)
    img.paste(w, (WALL_X, WALL_Y + y_off))
    ov = Image.new("RGBA", WALL.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(ov)
    if coin_p > 0:
        cx, cy = COIN_C
        r = COIN_R + 10
        d.arc((cx - r, cy - r, cx + r, cy + r), -90, -90 + 360 * coin_p, fill=GREEN + (255,), width=9)
    if mask_p > 0:
        goal, acc = TOTAL * mask_p, 0.0
        for i, s in enumerate(SEG):
            if acc >= goal:
                break
            (x1, y1), (x2, y2) = CRACK[i], CRACK[i + 1]
            f = min(1.0, (goal - acc) / s)
            d.line((x1, y1, x1 + (x2 - x1) * f, y1 + (y2 - y1) * f), fill=RED + (150,), width=22)
            acc += s
    img.paste(ov, (WALL_X, WALL_Y + y_off), ov)


def receipt(img, y, p):
    if p <= 0:
        return
    d = ImageDraw.Draw(img)
    yy = y + int((1 - out_cubic(p)) * 500)
    x0, x1 = 120, W - 120
    d.rounded_rectangle((x0, yy, x1, yy + 400), radius=18, fill=(250, 248, 242))
    for i in range(x0, x1, 28):  # torn edge
        d.polygon([(i, yy + 400), (i + 14, yy + 416), (i + 28, yy + 400)], fill=(250, 248, 242))
    mb, m = font(MONOB, 44), font(MONO, 40)
    d.text((x0 + 44, yy + 34), "RECEIPT  R004", font=mb, fill=(20, 20, 20))
    d.text((x0 + 44, yy + 96), "crack length", font=m, fill=(90, 90, 90))
    d.text((x0 + 44, yy + 160), "913 px", font=m, fill=(20, 20, 20))
    d.text((x0 + 44, yy + 210), "x 0.0941 mm/px", font=m, fill=(20, 20, 20))
    d.line((x0 + 44, yy + 268, x1 - 44, yy + 268), fill=(20, 20, 20), width=3)
    d.text((x0 + 44, yy + 288), "= 85.9 mm", font=font(MONOB, 56), fill=RED)
    cx, cy = x1 - 90, yy + 318
    d.ellipse((cx - 36, cy - 36, cx + 36, cy + 36), fill=GREEN)
    d.line((cx - 16, cy, cx - 4, cy + 13, cx + 18, cy - 14), fill=(255, 255, 255), width=8, joint="curve")


# ---------- scenes ----------
GUESSES = [  # (start, text)
    (2.9, "The crack is about 12 cm long."),
    (6.2, "Roughly 10 cm?"),
    (7.15, "Quite big, honestly."),
    (8.05, "Trust me."),
]
STAMP_T = [4.45, 6.85, 7.75, 8.65]
STAMP_POS = [(540, 1150, -9), (470, 600, 8), (610, 850, -5), (520, 1060, 12)]
TRUE_LINE = "The crack is 85.9 mm long [R004]."


def frame(t):
    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)
    shake = 0.0

    if t < 2.4:  # hook
        # full headline from frame 0 (it's the thumbnail); a punch-in on the red half
        fb = font(BLACK, 140)
        center_text(d, 560, "We caught", fb, INK)
        center_text(d, 720, "our AI", fb, INK)
        pop = 1 + 0.10 * (1 - out_cubic(prog(t, 0.35, 0.3))) if t >= 0.35 else 1.0
        fr = font(BLACK, 140 * pop)
        center_text(d, 930 - 20 * (pop - 1) * 10, "making up", fr, RED)
        center_text(d, 1090 - 10 * (pop - 1) * 10, "a number.", fr, RED)
        u = out_cubic(prog(t, 0.6, 0.35))
        if u > 0:
            tw = text_w(d, "a number.", fb)
            x0 = W / 2 - tw / 2
            d.rectangle((x0, 1265, x0 + tw * u, 1285), fill=RED)
        if t > 1.2:
            center_text(d, 1400, "(so we made it illegal)", font(BOLD, 58), DIM)

    elif t < 9.6:  # the AI keeps guessing
        slide = out_cubic(prog(t, 2.4, 0.45))
        d.text((70, 330 - (1 - slide) * 80), "Crack in the wall. Coin for scale.", font=font(BOLD, 48), fill=DIM)
        wall_view(img, t, y_off=int((1 - slide) * 300), dim=0.35 if t > 4.4 else 0.0)
        cur = [g for g in GUESSES if t >= g[0]]
        g_start, g_text = cur[-1] if cur else GUESSES[0]
        s = typed(g_text, t, g_start, cps=30 if g_start > 3 else 24)
        ai_bubble(img, 1400, s, int(t * 2.5) % 2 == 0 and len(s) < len(g_text))
        if t > 6.0:
            n = sum(1 for st in STAMP_T if t >= st)
            lab = f"ATTEMPT {min(n + 1, 4)}"; fa = font(BLACK, 56); aw = text_w(d, lab, fa); d.rounded_rectangle((W / 2 - aw / 2 - 30, 200, W / 2 + aw / 2 + 30, 290), radius=45, fill=YELLOW); center_text(d, 205, lab, fa, (20, 20, 20))
        for i, st in enumerate(STAMP_T):
            p = prog(t, st, 0.22)
            if p > 0:
                sc = 1.9 - 0.9 * out_back(p, 1.4) if p < 1 else 1.0
                cx, cy, ang = STAMP_POS[i]
                paste_stamp(img, REJECT, cx, cy, sc * (0.92 if i else 1.0), ang, alpha=min(1, p * 3))
                shake = max(shake, 22 * (1 - prog(t, st + 0.05, 0.3)) if t > st + 0.05 else 0)
        if t > 4.6:
            p = out_cubic(prog(t, 4.6, 0.3))
            msg = "EvidenceError: \"12 cm\" has no receipt" if t < 6.2 else "EvidenceError: no receipt"
            fm = font(MONOB, 40)
            d.text((70, 1335 - 10 * (1 - p)), msg, font=fm, fill=RED)
        if t > 4.45:  # red flash on each stamp
            for st in STAMP_T:
                fp = prog(t, st, 0.18)
                if 0 < fp < 1:
                    img = Image.blend(img, Image.new("RGB", (W, H), RED), 0.22 * (1 - fp))
                    d = ImageDraw.Draw(img)

    elif t < 10.9:  # the turn
        p = out_cubic(prog(t, 9.6, 0.25))
        fb = font(BLACK, 120)
        center_text(d, 760 + 30 * (1 - p), "No guessing", fb, INK)
        center_text(d, 900 + 30 * (1 - p), "allowed.", fb, YELLOW)
        center_text(d, 1100, "Measure it or don't say it.", font(BOLD, 48), DIM)

    elif t < 18.7:  # measure, then ship
        mp = prog(t, 12.0, 1.6)
        d.text((70, 300), "1  Coin sets the scale" if t < 12.0 else "2  Trace the crack", font=font(BOLD, 52), fill=INK)
        wall_view(img, t, mask_p=out_cubic(mp), coin_p=out_cubic(prog(t, 11.0, 0.7)))
        if t > 11.4:
            fm = font(MONOB, 40)
            lbl = "27 mm coin -> 0.0941 mm/px"
            d.rounded_rectangle((WALL_X, WALL_Y + 916, WALL_X + text_w(d, lbl, fm) + 40, WALL_Y + 980), radius=14, fill=GREEN)
            d.text((WALL_X + 20, WALL_Y + 924), lbl, font=fm, fill=(8, 30, 14))
        if t > 12.0:
            val = 85.9 * out_cubic(mp)
            fb = font(BLACK, 96)
            s = f"{val:.1f} mm"
            bw = text_w(d, "85.9 mm", fb) + 60; bx = WALL_X + WALL_W - bw - 40
            d.rounded_rectangle((bx, WALL_Y + 50, bx + bw, WALL_Y + 190), radius=24, fill=RED)
            d.text((bx + 30, WALL_Y + 50), s, font=fb, fill=(255, 255, 255))
        if t < 15.4:
            receipt(img, 1420, prog(t, 13.8, 0.5))
        else:
            ai_bubble(img, 1440, typed(TRUE_LINE, t, 15.5, cps=26), int(t * 2.5) % 2 == 0, tag="[R004]", tag_col=GREEN)
            p = prog(t, 17.05, 0.22)
            if p > 0:
                sc = 1.9 - 0.9 * out_back(p, 1.4) if p < 1 else 1.0
                paste_stamp(img, SHIPPED, 540, 1260, sc, -6, alpha=min(1, p * 3))
                shake = 12 * (1 - prog(t, 17.1, 0.3)) if t > 17.1 else 0

    else:  # end card
        p = out_cubic(prog(t, 18.7, 0.4))
        fb = font(BLACK, 116)
        center_text(d, 520 + 40 * (1 - p), "Computed,", fb, INK)
        center_text(d, 650 + 40 * (1 - p), "not generated.", fb, INK)
        q = out_cubic(prog(t, 19.3, 0.4))
        if q > 0:
            fw = font(BLACK, 88)
            tw = text_w(d, "SnapClaim", fw)
            x = W / 2 - tw / 2
            d.text((x, 900), "Snap", font=fw, fill=INK)
            d.text((x + text_w(d, "Snap", fw), 900), "Claim", font=fw, fill=RED)
            d.line((x - 10, 1030, x + (tw + 20) * q, 1030), fill=RED, width=10)
            center_text(d, 1065, "Every number has a receipt.", font(BOLD, 50), DIM)
        r = out_cubic(prog(t, 19.9, 0.4))
        if r > 0:
            fu = font(MONOB, 54)
            u = "snapclaim.pages.dev"
            uw = text_w(d, u, fu)
            d.rounded_rectangle((W / 2 - uw / 2 - 36, 1220, W / 2 + uw / 2 + 36, 1316), radius=48, fill=YELLOW)
            center_text(d, 1236, u, fu, (20, 20, 20))
            center_text(d, 1400, "Reply with your crack + a coin.", font(BOLD, 50), INK)
            center_text(d, 1468, "We'll measure it.", font(BOLD, 50), INK)

    if shake > 0.5:
        jx, jy = rng.uniform(-shake, shake), rng.uniform(-shake, shake)
        moved = Image.new("RGB", (W, H), BG)
        moved.paste(img, (int(jx), int(jy)))
        img = moved
    return img


# ---------- sound ----------
SR = 44100


def synth():
    n = int(SR * DUR)
    out = np.zeros(n, np.float32)
    nr = np.random.default_rng(11)

    def add(t, sig, g=1.0):
        i = int(t * SR)
        j = min(n, i + len(sig))
        if i < n:
            out[i:j] += sig[: j - i] * g

    def env(dur, k):
        x = np.arange(int(SR * dur)) / SR
        return np.exp(-x * k)

    def click():
        s = nr.normal(0, 1, int(SR * 0.012)).astype(np.float32)
        return np.diff(s, prepend=0) * env(0.012, 400) * 0.25

    def kick(g=1.0):
        x = np.arange(int(SR * 0.35)) / SR
        f = 45 + 90 * np.exp(-x * 30)
        return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-x * 9) * g

    def buzz():
        x = np.arange(int(SR * 0.32)) / SR
        sq = np.sign(np.sin(2 * np.pi * 98 * x)) + 0.6 * np.sign(np.sin(2 * np.pi * 147 * x))
        return sq * np.minimum(1, (0.32 - x) * 20) * 0.22

    def thud():
        return kick(1.3) + nr.normal(0, 1, int(SR * 0.35)).astype(np.float32) * env(0.35, 40) * 0.35

    def ding():
        x = np.arange(int(SR * 1.2)) / SR
        return (np.sin(2 * np.pi * 1318 * x) + 0.6 * np.sin(2 * np.pi * 1976 * x) + 0.3 * np.sin(2 * np.pi * 2637 * x)) * np.exp(-x * 3.5) * 0.35

    def tick():
        x = np.arange(int(SR * 0.03)) / SR
        return np.sin(2 * np.pi * 2400 * x) * np.exp(-x * 160) * 0.18

    def whoosh(dur=0.45):
        s = nr.normal(0, 1, int(SR * dur)).astype(np.float32)
        s = np.convolve(s, np.ones(24) / 24, mode="same")
        x = np.linspace(0, 1, len(s))
        return s * np.sin(np.pi * x) ** 2 * 0.9

    # beat: tense half-time before the turn, full after, silence on the turn
    for b in np.arange(0.0, 9.6, 1.0):
        add(b, kick(0.5))
    for b in np.arange(10.9, 18.7, 0.5):
        add(b, kick(0.75))
    for b in np.arange(18.7, DUR - 0.6, 0.5):
        add(b, kick(0.6))
    # typing
    add(0.35, thud(), 0.9)
    add(1.2, tick())
    for st, txt in GUESSES:
        cps = 30 if st > 3 else 24
        for k in range(len(txt)):
            if txt[k] != " ":
                add(st + k / cps, click())
    for k in range(len(TRUE_LINE)):
        if TRUE_LINE[k] != " ":
            add(15.5 + k / 26, click())
    add(0.6, whoosh(0.3), 0.6)
    add(2.35, whoosh(), 0.8)
    for st in STAMP_T:
        add(st, thud())
        add(st + 0.02, buzz())
    add(9.6, kick(1.6))
    add(10.75, whoosh(), 0.8)
    for k in range(16):
        add(12.0 + k * 0.1, tick())
    add(13.75, whoosh(0.35), 0.7)
    add(17.05, thud(), 0.9)
    add(17.07, ding())
    add(18.65, whoosh(), 0.8)
    add(19.3, ding(), 0.6)

    out /= max(1e-6, np.abs(out).max()) / 0.89
    return out


def write_wav(path, sig):
    pcm = (np.clip(sig, -1, 1) * 32767).astype(np.int16)
    stereo = np.repeat(pcm[:, None], 2, axis=1)
    with wave.open(str(path), "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(stereo.tobytes())


def main():
    if "--still" in sys.argv:
        ts = [float(x) for x in sys.argv[sys.argv.index("--still") + 1].split(",")]
        for t in ts:
            p = HERE / "out" / f"still-{t:05.2f}.png"
            p.parent.mkdir(exist_ok=True)
            frame(t).resize((W // 2, H // 2)).save(p)
            print(p)
        return
    OUT.parent.mkdir(parents=True, exist_ok=True)
    wav = OUT.with_suffix(".wav")
    write_wav(wav, synth())
    cmd = ["ffmpeg", "-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}",
           "-r", str(FPS), "-i", "-", "-i", str(wav), "-c:v", "libx264", "-preset", "medium", "-crf", "18",
           "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-shortest", "-movflags", "+faststart", str(OUT)]
    ff = subprocess.Popen(cmd, stdin=subprocess.PIPE)
    for i in range(int(DUR * FPS)):
        ff.stdin.write(frame(i / FPS).tobytes())
    ff.stdin.close()
    ff.wait()
    wav.unlink()
    print(OUT, "exit", ff.returncode)


if __name__ == "__main__":
    main()
