#!/usr/bin/env python3
"""SnapClaim phone stress via scrcpy + adb, using fixtures/photos.

What it does:
  1. (optional) pushes fixtures/photos/*.JPG|jpeg|png to /sdcard/Download/snapclaim-stress/
  2. Backend stress (mock mode, $0): /v1/measure + /v1/report + /v1/render
     per photo, with latencies + gate pass rate. Same backend the phone hits
     via `adb reverse tcp:8787 tcp:8787`.
  3. On-phone UI automation via adb (scrcpy is the mirror, adb is the hands):
     opens Chrome to the PWA (via `adb reverse tcp:8080 tcp:8080`), finds
     "Use sample measurement" via uiautomator dump, taps it in a loop,
     screencaps each iteration, watches logcat for crashes.
  4. Writes JSON + screenshots to bench/runs/phone-stress-<ts>/.

Requires: adb, scrcpy (for live view only), backend on :8787, pwa on :8080.
  scrcpy live view (run in another terminal):  /Users/varma/bin/scrcpy --select-usb
  backend:  npm run backend:start
  pwa:      python3 -m http.server 8080 --directory pwa

Usage:
  python3 bench/phone_stress.py --push --iterations 20
  python3 bench/phone_stress.py --no-ui --iterations 50   # backend only
"""
import argparse, json, os, re, subprocess, sys, time, urllib.request, urllib.error
from datetime import datetime, timezone

DEVICE = "RFCRC0QMDYT"
BACKEND_URL = "http://127.0.0.1:8787"
PWA_URL = "http://127.0.0.1:8080/"
PHOTOS = "fixtures/photos"
OUTBASE = "bench/runs"

def sh(*a, timeout=60):
    r = subprocess.run(a, capture_output=True, text=True, timeout=timeout)
    return r

def adb(*args, timeout=60):
    return sh("adb", "-s", DEVICE, *args, timeout=timeout)

def post(path, body, timeout=30):
    req = urllib.request.Request(BACKEND_URL + path,
        data=json.dumps(body).encode(), headers={"content-type": "application/json"})
    t0 = time.monotonic()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            j = json.loads(r.read().decode())
            return True, (time.monotonic() - t0) * 1000, r.status, j
    except Exception as e:
        # try to extract HTTP error body
        try:
            if isinstance(e, urllib.error.HTTPError):
                j = json.loads(e.read().decode() or "{}")
                return False, (time.monotonic() - t0) * 1000, e.code, j
        except Exception:
            pass
        return False, (time.monotonic() - t0) * 1000, -1, {"error": str(e)}

def pct(xs, p):
    if not xs: return 0
    xs = sorted(xs)
    return xs[min(len(xs) - 1, int(p / 100 * len(xs)))]

def dump_ui():
    adb("shell", "uiautomator", "dump", "/sdcard/window_dump.xml")
    r = adb("shell", "cat", "/sdcard/window_dump.xml")
    return r.stdout

def find_bounds(xml, text):
    # find node containing text, return center (x,y)
    for m in re.finditer(r'<node[^>]*text="([^"]*)"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"[^>]*>', xml):
        if text.lower() in m.group(1).lower():
            x1, y1, x2, y2 = map(int, m.groups()[1:])
            return ((x1 + x2) // 2, (y1 + y2) // 2, m.group(1))
    # content-desc fallback
    for m in re.finditer(r'<node[^>]*content-desc="([^"]*)"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"[^>]*>', xml):
        if text.lower() in m.group(1).lower():
            x1, y1, x2, y2 = map(int, m.groups()[1:])
            return ((x1 + x2) // 2, (y1 + y2) // 2, m.group(1))
    return None

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--push", action="store_true", help="push fixtures/photos to phone")
    ap.add_argument("--iterations", type=int, default=20)
    ap.add_argument("--no-ui", action="store_true", help="skip phone UI loop")
    ap.add_argument("--backend", default=BACKEND_URL)
    ap.add_argument("--pwa", default=PWA_URL)
    args = ap.parse_args()
    globals()["BACKEND_URL"] = args.backend

    ts = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    outdir = os.path.join(OUTBASE, f"phone-stress-{ts}")
    shotdir = os.path.join(outdir, "shots")
    os.makedirs(shotdir, exist_ok=True)

    photos = sorted([os.path.join(PHOTOS, f) for f in os.listdir(PHOTOS)
                     if f.lower().endswith((".jpg", ".jpeg", ".png"))])
    print(f"photos: {len(photos)}")
    for p in photos:
        print(f"  {os.path.basename(p)} {os.path.getsize(p)//1024}KB")

    if args.push:
        print("pushing photos to /sdcard/Download/snapclaim-stress/ ...")
        adb("shell", "mkdir", "-p", "/sdcard/Download/snapclaim-stress")
        for p in photos:
            r = sh("adb", "-s", DEVICE, "push", p, "/sdcard/Download/snapclaim-stress/", timeout=300)
            ok = r.returncode == 0
            print(f"  {'OK ' if ok else 'FAIL'} {os.path.basename(p)}")
        print(adb("shell", "ls", "/sdcard/Download/snapclaim-stress").stdout)

    # --- backend health ---
    hb = urllib.request.urlopen(BACKEND_URL + "/v1/health", timeout=10).read().decode()
    print("health:", hb)

    # --- backend stress: one measure+report+render per photo per iteration ---
    lat_m, lat_r, lat_ren = [], [], []
    fails = []
    gate_ok = 0
    total = 0
    iters = args.iterations
    print(f"backend stress: {iters} iterations x {len(photos)} photos (measure+report+render) ...")
    # base payload from fixtures/masks/wall-crack.json, component id varies per photo
    with open("fixtures/masks/wall-crack.json") as f:
        base = json.load(f)
    for i in range(iters):
        photo = photos[i % len(photos)]
        stem = os.path.splitext(os.path.basename(photo))[0]
        payload = {
            "component": {"id": f"stress-{stem}-{i}", "areaPx": base["component"]["areaPx"], "confidence": 0.93},
            "masks": base["masks"],
            "scaleReference": base["scaleReference"],
        }
        ok, ms, code, j = post("/v1/measure", payload)
        lat_m.append(ms); total += 1
        if not ok:
            fails.append({"iter": i, "photo": stem, "ep": "measure", "code": code, "err": str(j)[:200]})
            continue
        ok2, ms2, code2, j2 = post("/v1/report", {**payload, "transcript": f"crack in {stem} iteration {i}"})
        lat_r.append(ms2)
        if not ok2:
            fails.append({"iter": i, "photo": stem, "ep": "report", "code": code2, "err": str(j2)[:200]})
            continue
        if j2.get("ok") and j2.get("result", {}).get("gate", {}).get("ok"):
            gate_ok += 1
        ok3, ms3, code3, j3 = post("/v1/render", {**payload, "transcript": f"crack in {stem} iteration {i}"})
        lat_ren.append(ms3)
        if not ok3:
            fails.append({"iter": i, "photo": stem, "ep": "render", "code": code3, "err": str(j3)[:200]})
        if (i + 1) % 5 == 0:
            print(f"  {i+1}/{iters} p50 measure={pct(lat_m,50):.0f}ms report={pct(lat_r,50):.0f}ms render={pct(lat_ren,50):.0f}ms fails={len(fails)}")

    backend_summary = {
        "iterations": iters, "photos": len(photos), "total_measure_calls": total,
        "measure_ms": {"p50": round(pct(lat_m,50),1), "p95": round(pct(lat_m,95),1), "max": round(max(lat_m, default=0),1)},
        "report_ms": {"p50": round(pct(lat_r,50),1), "p95": round(pct(lat_r,95),1), "max": round(max(lat_r, default=0),1)},
        "render_ms": {"p50": round(pct(lat_ren,50),1), "p95": round(pct(lat_ren,95),1), "max": round(max(lat_ren, default=0),1)},
        "gate_pass": gate_ok, "failures": fails[:20], "failure_count": len(fails),
    }
    print(json.dumps(backend_summary, indent=2))

    # --- phone UI loop ---
    ui = {"attempted": False}
    if not args.no_ui:
        ui["attempted"] = True
        print(f"phone UI: opening Chrome to {args.pwa}")
        adb("shell", "am", "start", "-a", "android.intent.action.VIEW", "-d", args.pwa, "com.android.chrome")
        time.sleep(4)
        crash_watch = adb("shell", "logcat", "-c")
        taps = 0; found_sample = 0; measured_ok = 0
        for i in range(min(iters, 20)):
            adb("shell", "am", "start", "-a", "android.intent.action.VIEW", "-d", args.pwa, "com.android.chrome")
            time.sleep(3)
            xml = dump_ui()
            hit = find_bounds(xml, "Use sample measurement") or find_bounds(xml, "sample") or find_bounds(xml, "New claim")
            shot = os.path.join(shotdir, f"iter{i:02d}.png")
            adb("shell", "screencap", "-p", f"/sdcard/shot{i:02d}.png")
            sh("adb", "-s", DEVICE, "pull", f"/sdcard/shot{i:02d}.png", shot)
            if hit:
                x, y, label = hit
                found_sample += 1 if "sample" in label.lower() else 0
                adb("shell", "input", "tap", str(x), str(y))
                taps += 1
                print(f"  ui {i}: tapped '{label[:40]}' @ {x},{y}")
                time.sleep(4)
                # success = Say/Numbers screen appears (mic or measured)
                xml3 = dump_ui()
                if find_bounds(xml3, "Say what happened") or find_bounds(xml3, "Get the numbers") or find_bounds(xml3, "MEASURED"):
                    measured_ok += 1
                    print(f"  ui {i}: sample flow OK (reached say/numbers)")
                else:
                    print(f"  ui {i}: sample flow state unclear")
            else:
                # fallback: tap where sample button usually is (lower third) + back
                print(f"  ui {i}: sample button not in dump, fallback tap 360,1150")
                adb("shell", "input", "tap", "360", "1150")
                taps += 1
                time.sleep(3)
            # dismiss mic permission dialogs if they appear
            xml2 = dump_ui()
            for btn in ("Allow", "While using the app", "OK", "Got it"):
                h = find_bounds(xml2, btn)
                if h:
                    adb("shell", "input", "tap", str(h[0]), str(h[1]))
                    print(f"  ui {i}: dismissed dialog '{btn}'")
                    time.sleep(1)
                    break
        # final screenshot + device stats
        adb("shell", "screencap", "-p", "/sdcard/shot-final.png")
        sh("adb", "-s", DEVICE, "pull", "/sdcard/shot-final.png", os.path.join(shotdir, "final.png"))
        mem = adb("shell", "dumpsys", "meminfo", "com.android.chrome").stdout[:2000]
        bat = adb("shell", "dumpsys", "battery").stdout
        log = adb("shell", "logcat", "-d", "*:E").stdout[-4000:]
        ui.update({"taps": taps, "sample_found": found_sample, "sample_flow_ok": measured_ok,
                   "battery": bat, "chrome_mem_head": mem, "logcat_errors_tail": log})
        # crash keywords
        crash_kw = [l for l in log.splitlines() if re.search(r"FATAL|AndroidRuntime|NotResponding|crash", l, re.I)][:10]
        ui["crash_lines"] = crash_kw
        print(f"phone UI done: taps={taps} sample_found={found_sample} crash_lines={len(crash_kw)}")
        for l in crash_kw: print("  !!", l[:220])

    result = {"ts": ts, "device": DEVICE, "backend": BACKEND_URL, "pwa": args.pwa,
              "photos": [os.path.basename(p) for p in photos],
              "backend_stress": backend_summary, "phone_ui": ui}
    with open(os.path.join(outdir, "summary.json"), "w") as f:
        json.dump(result, f, indent=2)
    print("wrote", outdir + "/summary.json", "+", len(os.listdir(shotdir)), "screenshots")

if __name__ == "__main__":
    main()
