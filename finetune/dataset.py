#!/usr/bin/env python3
"""Build a JSONL fine-tuning dataset from SnapClaim's own fixtures.

Reads fixtures/expected/*.json (receipt-cited findings) plus fixtures/masks
for scale context and emits chat-format rows:

  {"messages": [{"role": "system", ...}, {"role": "user", ...}, {"role": "assistant", ...}],
   "target": "muse-glimmer" | "muse-spark-open"}

Stdlib only — runs anywhere, including CI without torch. Deterministic output
(sorted keys, fixed order) so re-runs are diffable.

Usage:
  python3 finetune/dataset.py --fixtures fixtures --out finetune/data/train.jsonl --target muse-glimmer
"""
import argparse
import glob
import json
import os
import sys

SYSTEM = (
    "Write claim findings. Every finding must contain at least one number that "
    "exactly matches a cited receipt output. Cite only receipts from one mask "
    "per finding. Reply with JSON only."
)


def load_expected(path):
    with open(path) as f:
        return json.load(f)


def mask_labels(fixtures_dir, stem):
    """Label lookup from fixtures/masks/<stem>.json keyed by mask id."""
    p = os.path.join(fixtures_dir, "masks", stem + ".json")
    try:
        with open(p) as f:
            masks = json.load(f).get("masks", [])
    except (OSError, ValueError):
        return {}
    return {m.get("id"): m.get("label") for m in masks if isinstance(m, dict)}


def row_for(case_name, expected, target, labels):
    cases = expected.get("cases", expected if isinstance(expected, list) else [])
    if isinstance(cases, dict):
        cases = [cases]
    facts, statements = [], []
    for i, f in enumerate(cases):
        if not isinstance(f, dict):
            continue
        rid = f"R{i + 1:03d}"
        label = f.get("label") or labels.get(f.get("maskId"))
        facts.append(
            {
                "label": label,
                "percent": f.get("percent"),
                "crackLengthMm": f.get("crackLengthMm"),
                "severity": f.get("severity"),
            }
        )
        parts = [f"{label} covers {f.get('percent')}%"]
        if f.get("crackLengthMm") is not None:
            parts.append(f"measures {f.get('crackLengthMm')} mm")
        parts.append(f"classified {f.get('severity')}")
        statements.append({"statement": "; ".join(parts) + ".", "citations": [rid]})
    if not statements or any(f["label"] is None for f in facts):
        return None
    user = {"transcript": expected.get("transcript", "") or "", "facts": facts}
    return {
        "messages": [
            {"role": "system", "content": SYSTEM},
            {"role": "user", "content": json.dumps(user, sort_keys=True)},
            {"role": "assistant", "content": json.dumps(statements)},
        ],
        "target": target,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--fixtures", default="fixtures")
    ap.add_argument("--out", default="finetune/data/train.jsonl")
    ap.add_argument("--target", default="muse-glimmer", choices=["muse-glimmer", "muse-spark-open"])
    ap.add_argument("--max-rows", type=int, default=0)
    args = ap.parse_args()

    paths = sorted(glob.glob(os.path.join(args.fixtures, "expected", "*.json")))
    if not paths:
        print(f"no expected fixtures under {args.fixtures}/expected", file=sys.stderr)
        return 1
    rows = []
    for p in paths:
        try:
            expected = load_expected(p)
        except (OSError, ValueError) as e:
            print(f"skip {p}: {e}", file=sys.stderr)
            continue
        stem = os.path.splitext(os.path.basename(p))[0]
        r = row_for(os.path.basename(p), expected, args.target, mask_labels(args.fixtures, stem))
        if r:
            rows.append(r)
            if args.max_rows and len(rows) >= args.max_rows:
                break
    os.makedirs(os.path.dirname(args.out) or ".", exist_ok=True)
    with open(args.out, "w") as f:
        for r in rows:
            f.write(json.dumps(r, sort_keys=True) + "\n")
    print(f"wrote {len(rows)} rows from {len(paths)} fixtures -> {args.out}")
    return 0 if rows else 1


if __name__ == "__main__":
    raise SystemExit(main())
