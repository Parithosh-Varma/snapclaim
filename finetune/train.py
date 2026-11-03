#!/usr/bin/env python3
"""LoRA fine-tuning entry point for SnapClaim open-weights targets.

Targets (see finetune/config.json):
  muse-glimmer      small on-device chat model — distill short verdicts
  muse-spark-open   open-weights findings model — distill receipt-cited drafts

Two modes:
  --smoke-test   stdlib only: validates config + dataset, writes a checkpoint
                 manifest WITHOUT touching torch/HF. This is what CI runs.
  (default)      real training: requires torch, transformers, datasets, peft,
                 huggingface_hub (see requirements.txt) plus weights access.
                 Trains LoRA adapters, saves a HF checkpoint to --out, and
                 optionally pushes to the Hub when HF_MODEL_REPO is set and
                 --push is passed.

Usage:
  python3 finetune/train.py --target muse-glimmer --data finetune/data/train.jsonl --smoke-test
  python3 finetune/train.py --target muse-spark-open --data finetune/data/train.jsonl --out finetune/checkpoints/spark-open-lora
"""
import argparse
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))


def load_config():
    with open(os.path.join(HERE, "config.json")) as f:
        return json.load(f)


def load_rows(path):
    rows = []
    with open(path) as f:
        for line in f:
            line = line.strip()
            if line:
                rows.append(json.loads(line))
    return rows


def smoke_test(target, cfg, rows):
    """Validate everything a real run needs, without weights or network."""
    if target not in cfg["targets"]:
        raise SystemExit(f"unknown target {target!r}; choices: {sorted(cfg['targets'])}")
    t = cfg["targets"][target]
    assert isinstance(t["max_tokens"], int) and t["max_tokens"] > 0
    assert t["chat_template"] in ("glimmer", "spark-open")
    assert t["lora"]["r"] > 0 and t["optim"]["lr"] > 0 and t["optim"]["epochs"] > 0
    assert rows, "empty dataset"
    for r in rows:
        assert [m["role"] for m in r["messages"]] == ["system", "user", "assistant"], r
        assert r["target"] == target, r
    total_chars = sum(len(m["content"]) for r in rows for m in r["messages"])
    manifest = {
        "mode": "smoke-test",
        "target": target,
        "rows": len(rows),
        "total_chars": total_chars,
        "lora": t["lora"],
        "optim": t["optim"],
        "checkpoint": None,
        "note": "smoke validation only: config + dataset schema OK, no weights touched",
    }
    return manifest


def real_train(target, cfg, rows, out, push):
    """Real LoRA SFT. Imports heavy deps lazily so --help/--smoke-test stay light."""
    import torch  # noqa: F401
    from datasets import Dataset
    from transformers import AutoModelForCausalLM, AutoTokenizer, TrainingArguments
    from peft import LoraConfig, get_peft_model
    try:
        from trl import SFTTrainer
        has_trl = True
    except ImportError:
        has_trl = False

    t = cfg["targets"][target]
    repo = os.environ.get(cfg["defaults"]["hub_repo_env"], "")
    if not repo:
        raise SystemExit(
            f"set {cfg['defaults']['hub_repo_env']} to the base weights repo "
            "(e.g. your gated Muse mirror) to run real training"
        )
    texts = ["\n".join(f"{m['role'].upper()}: {m['content']}" for m in r["messages"]) for r in rows]
    ds = Dataset.from_dict({"text": texts})
    tok = AutoTokenizer.from_pretrained(repo, trust_remote_code=True)
    if tok.pad_token is None:
        tok.pad_token = tok.eos_token
    model = AutoModelForCausalLM.from_pretrained(repo, trust_remote_code=True, torch_dtype="auto")
    lora = t["lora"]
    model = get_peft_model(model, LoraConfig(r=lora["r"], lora_alpha=lora["alpha"], lora_dropout=lora["dropout"], target_modules=lora["target_modules"], task_type="CAUSAL_LM"))
    os.makedirs(out, exist_ok=True)
    if has_trl:
        args = TrainingArguments(
            output_dir=out, num_train_epochs=t["optim"]["epochs"],
            per_device_train_batch_size=t["optim"]["batch_size"],
            gradient_accumulation_steps=t["optim"]["grad_accum"],
            learning_rate=t["optim"]["lr"], max_seq_length=t["optim"]["max_seq_len"],
            seed=cfg["defaults"]["seed"], save_total_limit=2, logging_steps=10,
        )
        SFTTrainer(model=model, tokenizer=tok, train_dataset=ds, dataset_text_field="text", args=args).train()
    else:
        # Minimal manual loop (no TRL): single-epoch next-token loss, CPU-safe micro-batch.
        model.train()
        opt = torch.optim.AdamW(model.parameters(), lr=t["optim"]["lr"])
        for epoch in range(t["optim"]["epochs"]):
            for text in texts:
                ids = tok(text, return_tensors="pt", truncation=True, max_length=t["optim"]["max_seq_len"])["input_ids"]
                out_ = model(input_ids=ids, labels=ids)
                out_.loss.backward()
                opt.step()
                opt.zero_grad()
    model.save_pretrained(out)
    tok.save_pretrained(out)
    pushed = None
    if push:
        if not os.environ.get("HF_TOKEN"):
            raise SystemExit("set HF_TOKEN to push the checkpoint to the Hub")
        from huggingface_hub import HfApi
        dest = os.environ.get("HF_DEST_REPO", f"snapclaim-{target}-lora")
        HfApi().create_repo(dest, exist_ok=True)
        HfApi().upload_folder(repo_id=dest, folder_path=out)
        pushed = dest
    return {"mode": "train", "target": target, "rows": len(rows), "checkpoint": out, "pushed_to": pushed}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--target", default="muse-glimmer", choices=["muse-glimmer", "muse-spark-open"])
    ap.add_argument("--data", default="finetune/data/train.jsonl")
    ap.add_argument("--out", default="finetune/checkpoints")
    ap.add_argument("--push", action="store_true")
    ap.add_argument("--smoke-test", action="store_true")
    ap.add_argument("--manifest-out", default="")
    args = ap.parse_args()

    cfg = load_config()
    rows = load_rows(args.data)
    if args.smoke_test:
        manifest = smoke_test(args.target, cfg, rows)
    else:
        manifest = real_train(args.target, cfg, rows, args.out, args.push)
    text = json.dumps(manifest, indent=2, sort_keys=True)
    if args.manifest_out:
        with open(args.manifest_out, "w") as f:
            f.write(text + "\n")
    print(text)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
