"""SnapClaim promo: 30 s landlord text thread that ends unresolved (9:16, 30 fps, voiced).

Cut down from ../texts/make.py (video 10). Plan and reasoning: ../texts/VIRAL-30S.md.
The conversation and the $1,400 are invented, and the end card says so. The crack photo and
its measurement are real: photo DSC_0682 with a taped Indian Rs 2 coin (2011 series, 25 mm),
outlined and measured in the SnapClaim PWA at 186.1 mm long, 2.3 mm wide.

Usage:
  ELEVENLABS_API_KEY=... python make.py --revoice   # fetch voices (cached in out/voice/)
  python make.py [out.mp4] [--still SECONDS] [--sheet]
A missing voice file renders as silence, so layout and timing can be checked without a key.
"""
import hashlib
import json
import math
import os
import subprocess
import sys
import urllib.request
import wave
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont, ImageOps

HERE = Path(__file__).resolve().parent
OUT = HERE / "out"
W, H, FPS, SR = 1080, 1920, 30, 48000
VOICES = {"L": "pNInz6obpgDQGcFmaJgB", "T": "cgSgspJ2msm6clMCkdW9"}  # Adam (landlord), Jessica (tenant)
PHOTO = HERE.parent / "texts" / "crack-0682.jpg"          # the real photo
OUTLINE = HERE.parent / "texts" / "crack-0682-outline.jpg"  # the app's outline of it (PWA mark canvas)

TITLE = "My landlord wants $1,400\nfor this crack"
# (who, text, attachment, spoken) - attachment: None | "photo" | "result"
MSGS = [
    ("L", "That crack is coming out of your deposit. $1,400.", None,
     "That crack is coming out of your deposit. Fourteen hundred dollars."),
    ("T", "It was there when I moved in.", None, None),
    ("L", "It's huge now.", None, None),
    ("T", "Same crack. Coin for scale.", "photo", None),
    ("L", "A photo proves nothing.", None, None),
    ("T", "186.1 mm long. 2.3 mm wide.", "result",
     "One eighty six point one millimetres long. Two point three wide."),
    ("L", "An app made that up.", None, None),
    ("T", "Every number has a receipt. Measure it yourself. If it's still 186, it didn't grow.", None,
     "Every number has a receipt. Measure it yourself. If it's still one eighty six, it didn't grow."),
]
REVEAL_WIPE, REVEAL_COUNT = 0.5, 0.5  # photo wipes to the app's outline, then the number counts up

# ---------------------------------------------------------------- voice

def vkey(i):
    who, text, _, spoken = MSGS[i]
    s = spoken if spoken is not None else text
    return s, OUT / "voice" / f"{i:02d}-{hashlib.md5((who + s).encode()).hexdigest()[:8]}.wav"


def revoice():
    key = os.environ.get("ELEVENLABS_API_KEY") or sys.exit("set ELEVENLABS_API_KEY")
    (OUT / "voice").mkdir(parents=True, exist_ok=True)
    for i, (who, *_rest) in enumerate(MSGS):
        s, path = vkey(i)
        if not s or path.exists():
            continue
        body = {"text": s, "model_id": "eleven_multilingual_v2",
                "voice_settings": {"stability": 0.4 if who == "L" else 0.45, "similarity_boost": 0.8,
                                   "style": 0.35, "speed": 0.95}}
        req = urllib.request.Request(
            f"https://api.elevenlabs.io/v1/text-to-speech/{VOICES[who]}?output_format=pcm_24000",
            data=json.dumps(body).encode(), headers={"xi-api-key": key, "Content-Type": "application/json"})
        with urllib.request.urlopen(req) as r:
            pcm = r.read()
        # trim leading/trailing silence
        a = np.frombuffer(pcm, np.int16)
        loud = np.where(np.abs(a) > 500)[0]
        if len(loud):
            a = a[max(0, loud[0] - 1200):loud[-1] + 2400]
        with wave.open(str(path), "wb") as f:
            f.setnchannels(1), f.setsampwidth(2), f.setframerate(24000), f.writeframes(a.tobytes())
        print(f"{i:02d} {who} {len(a) / 24000:.1f}s  {s[:50]}")


def voice_len(i):
    s, path = vkey(i)
    if not s:
        return 0.0
    if not path.exists():
        return len(s.split()) / 3.3  # measured on video 10's voices
    with wave.open(str(path)) as f:
        return f.getnframes() / f.getframerate()


# ---------------------------------------------------------------- type

FONT = "C:/Windows/Fonts/SegUIVar.ttf"
_fc = {}


def font(size, weight="Regular"):
    k = (int(size), weight)
    if k not in _fc:
        f = ImageFont.truetype(FONT, max(1, int(size)))
        wt = {"Regular": 400, "Semibold": 600, "Bold": 700}.get(weight, 400)
        f.set_variation_by_axes([wt, 36 if size >= 40 else 10])
        _fc[k] = f
    return _fc[k]


def clamp(x, a=0.0, b=1.0):
    return max(a, min(b, x))


def ease(x):
    return 1 - (1 - clamp(x)) ** 3


def back(x):
    x = clamp(x)
    return 1 + 2.2 * (x - 1) ** 3 + 1.2 * (x - 1) ** 2


GRAY, BLUE, WHITE, MUTED = (38, 38, 41), (10, 132, 255), (255, 255, 255), (142, 142, 147)
LIME = (216, 242, 138)

# ---------------------------------------------------------------- bubbles (pre-rendered RGBA)

BW_MAX, FS, LH, PADX, PADY, RAD = 740, 50, 64, 38, 24, 46


def wrap(text, f, maxw):
    d = ImageDraw.Draw(Image.new("L", (1, 1)))
    lines, cur = [], ""
    for word in text.split():
        t = (cur + " " + word).strip()
        if d.textlength(t, font=f) <= maxw:
            cur = t
        else:
            lines.append(cur)
            cur = word
    if cur:
        lines.append(cur)
    return lines


def bubble(text, who):
    f = font(FS)
    lines = wrap(text, f, BW_MAX - 2 * PADX)
    d0 = ImageDraw.Draw(Image.new("L", (1, 1)))
    tw = max(d0.textlength(l, font=f) for l in lines)
    w, h = int(tw + 2 * PADX), int(len(lines) * LH + 2 * PADY - (LH - FS) * 0.6)
    img = Image.new("RGBA", (w + 30, h + 6), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    col = BLUE if who == "T" else GRAY
    ox = 0 if who == "T" else 30
    d.rounded_rectangle((ox, 0, ox + w, h), RAD, fill=col)
    # tail
    if who == "T":
        d.polygon([(ox + w - 34, h - 30), (ox + w + 16, h + 2), (ox + w - 8, h - 8)], fill=col)
        d.pieslice((ox + w - 6, h - 46, ox + w + 30, h + 4), 90, 180, fill=(0, 0, 0, 0))
    else:
        d.polygon([(ox + 34, h - 30), (ox - 16, h + 2), (ox + 8, h - 8)], fill=col)
    y = PADY - 6
    for l in lines:
        d.text((ox + PADX, y), l, font=f, fill=WHITE)
        y += LH
    return img


def typing_bubble(phase):
    img = Image.new("RGBA", (200, 110), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle((30, 0, 190, 96), 48, fill=GRAY)
    d.ellipse((14, 74, 40, 100), fill=GRAY)
    d.ellipse((4, 96, 16, 108), fill=GRAY)
    for k in range(3):
        a = 0.45 + 0.55 * max(0, math.sin(phase * 7 - k * 0.9))
        c = tuple(int(90 + (200 - 90) * a) for _ in range(3))
        d.ellipse((62 + k * 36 - 11, 48 - 11, 62 + k * 36 + 11, 48 + 11), fill=c)
    return img


def rounded(img, r):
    m = Image.new("L", img.size, 0)
    ImageDraw.Draw(m).rounded_rectangle((0, 0, img.width - 1, img.height - 1), r, fill=255)
    out = img.convert("RGBA")
    out.putalpha(m)
    return out


def photo_bubble():
    im = ImageOps.exif_transpose(Image.open(PHOTO)).convert("RGB")
    w = 640
    h = int(im.height * w / im.width)
    return rounded(im.resize((w, h), Image.LANCZOS), 40)


_rv = {}


def result_bubble(lt=99.0):
    """Stage 1: the photo wipes to the app's real outline. Stage 2: its real numbers land."""
    if not _rv:
        w = 640
        for k, p in (("ol", OUTLINE), ("ph", PHOTO)):
            im = ImageOps.exif_transpose(Image.open(p)).convert("RGB")
            _rv[k] = im.resize((w, int(341 * w / 512)), Image.LANCZOS)
    done = lt >= REVEAL_WIPE + REVEAL_COUNT
    if done and "done" in _rv:
        return _rv["done"]
    ol = _rv["ol"]
    w, h = ol.size
    panel_h = 330
    img = Image.new("RGB", (w, h + panel_h), (58, 58, 60))
    wipe = ease(lt / REVEAL_WIPE)
    img.paste(_rv["ph"], (0, 0))
    edge = int(h * wipe)
    if edge > 0:
        img.paste(ol.crop((0, 0, w, edge)), (0, 0))
    d = ImageDraw.Draw(img)
    if 0 < edge < h:
        d.rectangle((0, edge - 3, w, edge), fill=LIME)
    y0 = h + 30
    d.text((36, y0), "CRACK  ·  LENGTH", font=font(28, "Semibold"), fill=(200, 200, 205))
    if lt < REVEAL_WIPE:
        d.text((36, y0 + 92), "Measuring from the coin...", font=font(40), fill=(200, 200, 205))
    else:
        v = 186.1 if done else 186.1 * ease((lt - REVEAL_WIPE) / REVEAL_COUNT)
        num = f"{v:.1f}"
        d.text((32, y0 + 34), num, font=font(120, "Bold"), fill=LIME)
        x = 32 + d.textlength(num + " ", font=font(120, "Bold"))
        d.text((x, y0 + 92), "mm", font=font(60, "Bold"), fill=LIME)
    if done:
        cx = 36
        for chip_text in ("2.3 mm wide", "0.64% of the wall"):
            tw = d.textlength(chip_text, font=font(30))
            d.rounded_rectangle((cx, y0 + 200, cx + tw + 36, y0 + 252), 26, fill=(84, 84, 88))
            d.text((cx + 18, y0 + 207), chip_text, font=font(30), fill=WHITE)
            cx += tw + 52
    # scale chip over the photo, like the app
    s = "Scale: ₹2 coin · 25 mm"
    tw = d.textlength(s, font=font(28, "Semibold"))
    d.rounded_rectangle((20, h - 66, 20 + tw + 56, h - 16), 25, fill=(40, 40, 42))
    d.ellipse((36, h - 48, 50, h - 34), fill=(232, 88, 88))
    d.text((60, h - 60), s, font=font(28, "Semibold"), fill=WHITE)
    out = rounded(img, 40)
    if done:
        _rv["done"] = out
    return out


# ---------------------------------------------------------------- timeline

class Item:
    def __init__(self, who, img, t, kind="msg", from_h=0):
        self.who, self.img, self.t, self.kind, self.from_h = who, img, t, kind, from_h


TYPING_H = 110


def build():
    items, cues = [], []
    t = 0.0
    for i, (who, text, att, _sp) in enumerate(MSGS):
        from_h = 0
        if i > 0:
            if who == "L":  # typing dots before the landlord answers
                items.append(Item("L", None, t, "typing"))
                t += 0.45
                from_h = TYPING_H
            else:
                t += 0.12
        if att == "photo":
            items.append(Item(who, photo_bubble(), t, "att", from_h))
            cues.append(("send", t))
            t += 0.4
            from_h = 0
        elif att == "result":
            items.append(Item(who, result_bubble(), t, "reveal", from_h))
            cues.append(("send", t))
            for k in range(6):
                cues.append(("tick", t + REVEAL_WIPE + k * REVEAL_COUNT / 6))
            t += REVEAL_WIPE + REVEAL_COUNT
            cues.append(("hit", t))
            from_h = 0
        items.append(Item(who, bubble(text, who), t, "msg", from_h))
        cues.append(("send" if who == "T" else "recv", t))
        cues.append(("voice", t + 0.1, i))
        t += 0.1 + voice_len(i) + 0.15
    # the ending: dots start, stop, start, stop, and no reply ever comes
    read_t = t + 0.15
    t += 0.45
    for n, (kind, dur) in enumerate((("typing", 1.2), ("gap", 0.5), ("typing", 0.8), ("gap", 0.5))):
        items.append(Item("L", None, t, kind, TYPING_H if n else 0))
        t += dur
    return items, cues, t, read_t


ITEMS, CUES, END_MSGS, READ_T = build()
LAST_T = max(i for i, it in enumerate(ITEMS) if it.who == "T" and it.kind == "msg")
CARD_LEN, LOOP_LEN = 3.0, 0.25
END = END_MSGS + CARD_LEN
TOP = 300          # chat area starts below the title
BOTTOM = 1700      # newest bubble sits here
GAP = 26


def layout(t):
    """Visible items at time t with y positions (bottom-anchored stack that scrolls up)."""
    vis = []
    for idx, it in enumerate(ITEMS):
        if it.t > t:
            break
        if it.kind in ("typing", "gap"):
            nxt = ITEMS[idx + 1].t if idx + 1 < len(ITEMS) else 1e9
            if t >= nxt:
                continue
        vis.append(it)
    # heights
    hs = [(TYPING_H if it.img is None else it.img.height) for it in vis]
    # animate the newest item's height growing in (pushes others up smoothly)
    if vis:
        k = 1.0 if vis[-1] is ITEMS[0] else ease((t - vis[-1].t) / 0.22)
        hs[-1] = vis[-1].from_h + (hs[-1] - vis[-1].from_h) * k
    # top-anchored under the title; scrolls up once the stack passes BOTTOM
    total = sum(hs) + GAP * max(0, len(hs) - 1)
    y = TOP + 10 - max(0, TOP + 10 + total - BOTTOM)
    pos = []
    for it, h in zip(vis, hs):
        pos.append((it, y))
        y += h + GAP
    return pos


_first = []


def frame(t):
    """The last LOOP_LEN seconds blend back into frame 0 so a replay does not jump."""
    if t > END - LOOP_LEN:
        if not _first:
            _first.append(draw(0.0))
        return Image.blend(draw(t), _first[0], clamp((t - END + LOOP_LEN) / LOOP_LEN))
    return draw(t)


def draw(t):
    img = Image.new("RGBA", (W, H), (0, 0, 0, 255))
    for it, y in layout(t):
        if it.kind == "gap":
            continue
        lt = 9.0 if it is ITEMS[0] else t - it.t
        a = ease(lt / 0.18)
        if it.kind == "typing":
            b = typing_bubble(t)
            x = 34
        else:
            b = result_bubble(lt) if it.kind == "reveal" else it.img
            x = W - b.width - 34 if it.who == "T" else 34 - (30 if it.kind == "msg" else 0)
        s = 0.86 + 0.14 * back(lt / 0.28)
        if s < 0.999:
            bw, bh = max(1, int(b.width * s)), max(1, int(b.height * s))
            b2 = b.resize((bw, bh), Image.BICUBIC)
            ax = x + (b.width - bw if it.who == "T" else 0)
            ay = int(y + (b.height - bh))
        else:
            b2, ax, ay = b, x, int(y)
        if a < 1:
            b2 = b2.copy()
            b2.putalpha(b2.getchannel("A").point(lambda v: int(v * a)))
        if ay + b2.height > TOP - 200:
            img.alpha_composite(b2, (int(ax), ay))
        if it is ITEMS[LAST_T] and t >= READ_T:  # the landlord has seen it
            ImageDraw.Draw(img).text((W - 44, int(y) + it.img.height + 2), "Read", font=font(30, "Semibold"),
                                     fill=MUTED, anchor="ra")
    d = ImageDraw.Draw(img)
    # title band (fades the chat under it)
    band = Image.new("RGBA", (W, TOP + 60), (0, 0, 0, 0))
    bd = ImageDraw.Draw(band)
    bd.rectangle((0, 0, W, TOP - 40), fill=(0, 0, 0, 255))
    for k in range(100):
        bd.line((0, TOP - 40 + k, W, TOP - 40 + k), fill=(0, 0, 0, int(255 * (1 - k / 100))))
    img.alpha_composite(band, (0, 0))
    y = 120
    for line in TITLE.split("\n"):
        d.text((W / 2, y), line, font=font(70, "Bold"), fill=WHITE, anchor="mm")
        y += 86
    # end card
    if t > END_MSGS:
        k = ease((t - END_MSGS) / 0.35)
        card = Image.new("RGBA", (W, 760), (0, 0, 0, 0))
        cd = ImageDraw.Draw(card)
        cd.rounded_rectangle((60, 0, W - 60, 700), 56, fill=(255, 255, 255, 250))
        cd.text((W / 2, 120), "Who pays?", font=font(120, "Bold"), fill=(0, 0, 0), anchor="mm")
        f = font(92, "Bold")
        wl, wr = cd.textlength("Snap", font=f), cd.textlength("Claim", font=f)
        x = (W - wl - wr) / 2
        cd.text((x, 300), "Snap", font=f, fill=(0, 0, 0), anchor="lm")
        cd.text((x + wl, 300), "Claim", font=f, fill=(226, 58, 46), anchor="lm")
        cd.rounded_rectangle((W / 2 - 280, 390, W / 2 + 280, 470), 40, fill=(10, 132, 255))
        cd.text((W / 2, 430), "snapclaim.pages.dev", font=font(44, "Semibold"), fill=WHITE, anchor="mm")
        cd.text((W / 2, 560), "Story dramatized. The crack, the coin and", font=font(32), fill=(110, 110, 115), anchor="mm")
        cd.text((W / 2, 605), "the 186.1 mm measurement are real.", font=font(32), fill=(110, 110, 115), anchor="mm")
        img.alpha_composite(card, (0, int(H - 820 * k + 40)))
    return img.convert("RGB")


# ---------------------------------------------------------------- audio

def env_tone(f, dur, amp, decay=8.0):
    n = int(SR * dur)
    tt = np.arange(n) / SR
    return np.sin(2 * np.pi * f * tt) * amp * np.exp(-tt * decay)


def mix(buf, sig, t):
    i = int(t * SR)
    if 0 <= i < len(buf):
        j = min(len(buf), i + len(sig))
        buf[i:j] += sig[:j - i]


def audio(path):
    n = int((END + 0.5) * SR)
    out = np.zeros(n)
    rng = np.random.default_rng(3)
    # quiet lo-fi bed: soft electric-piano chords + vinyl hiss, 80 BPM
    tt = np.arange(n) / SR
    chords = [(220.0, 277.2, 329.6), (185.0, 233.1, 277.2), (196.0, 246.9, 293.7), (164.8, 207.7, 246.9)]
    bar = 3.0
    bed = np.zeros(n)
    for k in range(int(END / bar) + 1):
        a, b = int(k * bar * SR), min(n, int((k + 1) * bar * SR))
        seg = tt[a:b] - k * bar
        envl = np.exp(-seg * 0.9) * np.minimum(1, seg / 0.02)
        for fr in chords[k % 4]:
            bed[a:b] += np.sin(2 * np.pi * fr * tt[a:b]) * envl + 0.25 * np.sin(4 * np.pi * fr * tt[a:b]) * envl
    # the bed drops out when the landlord reads the last message, so the dots play in silence
    gate = np.ones(n)
    a, b = int(READ_T * SR), int((READ_T + 0.4) * SR)
    gate[a:b] = np.linspace(1, 0, b - a)
    gate[b:] = 0
    out += (bed * 0.010 + rng.normal(0, 0.0015, n)) * gate
    for kind, t, *rest in CUES:
        if kind == "send":   # soft upward swoosh
            m = int(0.16 * SR)
            f = np.linspace(500, 1400, m)
            sig = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.hanning(m) * 0.05
            mix(out, sig, t)
        elif kind == "recv":  # two-note blip
            mix(out, env_tone(1318.5, 0.18, 0.06, 18), t)
            mix(out, env_tone(1760.0, 0.25, 0.05, 14), t + 0.07)
        elif kind == "tick":
            mix(out, env_tone(1600, 0.03, 0.05, 60), t)
        elif kind == "hit":
            mix(out, env_tone(110, 0.35, 0.22, 11), t)
            mix(out, env_tone(1760, 0.3, 0.05, 12), t)
        elif kind == "voice":
            s, p = vkey(rest[0])
            if not s or not p.exists():
                print(f"no voice yet for line {rest[0]}, rendering silence")
                continue
            with wave.open(str(p)) as f:
                v = np.frombuffer(f.readframes(f.getnframes()), np.int16).astype(np.float64) / 32768
            mix(out, np.interp(np.arange(len(v) * 2) / 2, np.arange(len(v)), v) * 0.9, t)
    mix(out, env_tone(90, 0.5, 0.25, 8), END_MSGS)
    mix(out, env_tone(880, 0.6, 0.06, 5), END_MSGS + 0.05)
    out = np.tanh(out * 1.05) * 0.92
    a, b = int((END - LOOP_LEN) * SR), int(END * SR)
    out[a:b] *= np.linspace(1, 0, b - a)
    out[b:] = 0
    with wave.open(str(path), "wb") as f:
        f.setnchannels(1), f.setsampwidth(2), f.setframerate(SR), f.writeframes((out * 32767).astype(np.int16).tobytes())


# ---------------------------------------------------------------- main

def main():
    args = sys.argv[1:]
    OUT.mkdir(exist_ok=True)
    if "--revoice" in args:
        return revoice()
    if "--still" in args:
        t = float(args[args.index("--still") + 1])
        return frame(t).save(OUT / f"still-{t:05.2f}.png")
    if "--sheet" in args:
        ts = [0.0] + [it.t + 0.6 for it in ITEMS if it.kind not in ("typing", "gap")][1:]
        rv = next(it.t for it in ITEMS if it.kind == "reveal")
        ts += [rv + 0.25, rv + 0.75] + [it.t + 0.3 for it in ITEMS if it.kind in ("typing", "gap")][-4:]
        ts += [READ_T + 0.1, END_MSGS + 1.0, END - 0.1]
        ts.sort()
        cols = 7
        sheet = Image.new("RGB", (cols * 216, math.ceil(len(ts) / cols) * 384))
        for i, t in enumerate(ts):
            sheet.paste(frame(t).resize((216, 384), Image.LANCZOS), ((i % cols) * 216, (i // cols) * 384))
        sheet.save(OUT / "sheet.png")
        return print(f"end {END:.1f}s, times:", [round(t, 1) for t in ts])
    dst = Path(args[0]) if args and not args[0].startswith("--") else OUT / "viral-30s.mp4"
    wav = OUT / "mix.wav"
    audio(wav)
    nf = int(END * FPS)
    ff = subprocess.Popen(
        ["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS),
         "-i", "-", "-i", str(wav), "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p",
         "-af", "loudnorm=I=-14:TP=-1.5:LRA=11", "-c:a", "aac", "-b:a", "192k", "-ar", "48000",
         "-shortest", "-movflags", "+faststart", str(dst)], stdin=subprocess.PIPE)
    for i in range(nf):
        ff.stdin.write(frame(i / FPS).tobytes())
    ff.stdin.close()
    ff.wait()
    print(f"wrote {dst} ({nf / FPS:.1f}s)" + ("  OVER 30 s" if END > 30 else ""))


if __name__ == "__main__":
    main()
