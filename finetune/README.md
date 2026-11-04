# SnapClaim open-weights fine-tuning

Distill the receipt-cited findings behavior into open-weights chat models so
the skeptic path (and future on-device drafts) runs without a vendor API.

## Targets

| Target | Role | Base weights |
|---|---|---|
| `muse-glimmer` | Small on-device chat model: short damage verdicts | Set `HF_MODEL_REPO` to your gated Muse mirror |
| `muse-spark-open` | Open findings model (Baseten mirror of Spark): full receipt-cited drafts | Same — `HF_MODEL_REPO` |

Model ids above are the Meta model names used across this repo
(`meta.config.json`, `src/config/config.ts`, `backend/metaApi.ts`). No
registry URL is hardcoded: weights resolve from `HF_MODEL_REPO` at train
time, and the Hugging Face Hub (`https://huggingface.co`) is used for
optional checkpoint upload via `huggingface_hub` when `--push` is passed
with `HF_TOKEN` set.

## Workflow

1. **Dataset** — `python3 finetune/dataset.py --target muse-glimmer`
   builds JSONL chat rows from `fixtures/expected/*.json` (expected
   measurements) joined with `fixtures/masks/*.json` (damage labels).
   Deterministic: re-runs are byte-identical, so data diffs are reviewable.
2. **Train** — `python3 finetune/train.py --target muse-glimmer
   --data finetune/data/train.jsonl [--smoke-test] [--out DIR] [--push]`
   LoRA adapters (`peft`, rank/alpha/dropout in `finetune/config.json`).
   `--smoke-test` validates config + dataset schema and writes a checkpoint
   manifest with zero weights touched — this is what runs without a GPU.
   Real runs need `pip install -r finetune/requirements.txt` + weights
   access, then save a Hugging Face checkpoint to `--out` (default
   `finetune/checkpoints/`), optionally pushed with `--push`.
3. **Evaluate** — point the skeptic provider at the checkpoint and run
   `npm run eval`: gate pass rate must not regress vs the API model.

Checkpoints under `finetune/checkpoints/` are gitignored build artifacts.

## Split warning (no leakage claims)

The dataset is tiny (5 fixture rows from a handful of surfaces). Any mIoU or
gate-pass number from a random row split would be inflated by near-duplicate
patches from the same surface. Split by source image or by surface, never by
random patch - and state which. No fine-tune accuracy headline ships from this
repo until that split is recorded with the run.
