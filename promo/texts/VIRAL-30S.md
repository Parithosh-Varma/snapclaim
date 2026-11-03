# 30 s viral cut: resume point (2026-11-02)

Tariq asked for a 30 s SnapClaim video in a viral format, researched first. Research is done and
the format is picked. **Nothing is built or rendered yet.**

## Format: landlord text-thread storytime, ending unresolved

Why this one:
- It is the only format with a large niche-specific result: joel.jamzz's landlord text thread (8.9M
  views, 371K likes, 71 s, from the 2026-11-01 TikTok scroll, see `_ref/tt_joel.jamzz.mp4`).
- Tariq rejected synthetic motion graphics (07, 08, 09). This one uses the real crack photo and the
  real measurement.
- Most Viral counts X engagement through Nov 8, not views. A fight with no ending asks for replies.
- The 2026 sources are mostly vendor blogs, so their numbers are directional only. They do agree on
  deciding in the first 1 to 2 seconds, working on mute, and comments driving reach.

Video 10 (`make.py`, 56 s) is the base. Its problems: too long, a soft opening line, and it resolves
("I'll send the deposit tomorrow"), which gives nobody a reason to reply.

## Script (about 50 spoken words, 2.5 words/s, speed 0.9 to 0.95)

Title: "My landlord wants $1,400 for this crack"

| Who | Text | Attachment |
|---|---|---|
| L | That crack is coming out of your deposit. $1,400. | |
| T | It was there when I moved in. | |
| L | It's huge now. | |
| T | Same crack. Coin for scale. | real photo |
| L | A photo proves nothing. | |
| T | 186.1 mm long. 2.3 mm wide. | outline + numbers, with a reveal |
| L | An app made that up. | |
| T | Every number has a receipt. Measure it yourself. If it's still 186, it didn't grow. | |
| L | typing dots start, stop, start, stop (no reply) | |

End card, about 3 s: "Who pays?", logo, snapclaim.pages.dev, and "Story dramatized. The crack, the
coin and the 186.1 mm measurement are real."

Post copy: ask for replies with "Reply with your crack and a coin, I'll measure it" (launch kit section 2).

## Steps

1. Copy `make.py` to `promo/viral30/make.py`. Swap `MSGS` and `TITLE`, and make the first bubble land
   by 0.5 s. Add the two-stage result reveal and the stop/start typing ending.
2. Voices: the cache is keyed on text, so new lines need `--revoice` with `ELEVENLABS_API_KEY`. The key
   is not in this shell's env or in the `.env` files checked (snapclaim, snapclaim-site). Find it first
   and do not print it.
3. `--sheet` to check layout, then render. Must be 30 s or under, and end cleanly into frame 0 if possible.
4. Watch the first 3 s on mute, then hand to Tariq. Do not post anything.

## Facts to keep straight

- 186.1 mm, 2.3 mm, 0.64% are real: photo DSC_0682, Rs 2 coin (2011 series, 25 mm), measured in the PWA.
- $1,400 and the whole conversation are invented, which the end card must say.
- No AI attribution anywhere in SnapClaim.
