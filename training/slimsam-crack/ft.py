"""Fine-tune SlimSAM's mask decoder on the Ozgenel Concrete Crack Segmentation
Dataset (CC BY 4.0) and score it the way the SnapClaim PWA uses it: one positive
tap on the crack, three candidates, keep the smallest candidate scoring >= 0.5.

  python ft.py cache   # embed every image once with the frozen encoder
  python ft.py eval    # stock model on the held-out split
  python ft.py train   # train the decoder, then eval the best checkpoint
"""
import json, random, sys, glob, os
from pathlib import Path
import numpy as np
import torch
import torch.nn.functional as F
from PIL import Image
from transformers import SamModel, SamProcessor

BASE = "nielsr/slimsam-77-uniform"  # PyTorch weights behind Xenova/slimsam-77-uniform
ROOT = Path(__file__).parent
CACHE = ROOT / "cache"
OUT = ROOT / "out"
SIDE = 1024
MIN_FINE_SCORE = 0.5  # pwa/sam-worker.js
SEED = 7
dev = "cuda"


def pairs():
    imgs = sorted(glob.glob(str(ROOT / "data/raw/rgb/*")))
    out = []
    for p in imgs:
        stem = Path(p).stem
        m = glob.glob(str(ROOT / "data/raw/BW" / (stem + ".*")))
        if m:
            out.append((p, m[0]))
    return out


def split(n):
    idx = list(range(n))
    random.Random(SEED).shuffle(idx)
    k = round(n * 0.2)
    return sorted(idx[k:]), sorted(idx[:k])  # train, held-out


def gt_frame(mask_path, size):
    """Mask in the 1024 padded frame. Box-downsample then >0.2 keeps thin cracks."""
    m = (np.array(Image.open(mask_path).convert("L")) > 127).astype(np.float32)
    h, w = m.shape
    s = SIDE / max(h, w)
    nh, nw = round(h * s), round(w * s)
    small = np.array(Image.fromarray(m).resize((nw, nh), Image.BOX)) > 0.2
    out = np.zeros((SIDE, SIDE), np.uint8)
    out[:nh, :nw] = small
    return out, (nh, nw)


def cache():
    CACHE.mkdir(exist_ok=True)
    proc = SamProcessor.from_pretrained(BASE)
    model = SamModel.from_pretrained(BASE).to(dev).eval()
    ps = pairs()
    print("pairs", len(ps))
    for i, (ip, mp) in enumerate(ps):
        f = CACHE / f"{i:04d}.pt"
        if f.exists():
            continue
        img = Image.open(ip).convert("RGB")
        gt, valid = gt_frame(mp, img.size)
        embs = []
        for flip in (False, True):
            im = img.transpose(Image.FLIP_LEFT_RIGHT) if flip else img
            px = proc(images=im, return_tensors="pt")["pixel_values"].to(dev)
            with torch.no_grad():
                embs.append(model.get_image_embeddings(px)[0].half().cpu())
        torch.save({"emb": embs, "gt": torch.from_numpy(gt), "valid": valid, "src": Path(ip).name}, f)
        if i % 50 == 0:
            print("cached", i)


def load_all():
    files = sorted(CACHE.glob("*.pt"))
    return [torch.load(f) for f in files]


def flip_gt(gt, valid):
    nh, nw = valid
    g = gt.clone()
    g[:nh, :nw] = torch.flip(gt[:nh, :nw], dims=[1])
    return g


def tap_points(gt, k, rng):
    ys, xs = torch.nonzero(gt, as_tuple=True)
    if len(ys) == 0:
        return []
    sel = rng.sample(range(len(ys)), min(k, len(ys)))
    return [(float(xs[j]) + 0.5, float(ys[j]) + 0.5) for j in sel]


def decode(model, emb, point):
    pts = torch.tensor([[[point]]], dtype=torch.float32, device=dev)  # [1,1,1,2] in 1024 frame
    lbl = torch.ones((1, 1, 1), dtype=torch.long, device=dev)
    o = model(image_embeddings=emb[None].float().to(dev), input_points=pts, input_labels=lbl, multimask_output=True)
    logits = F.interpolate(o.pred_masks[0, 0][None], (SIDE, SIDE), mode="bilinear", align_corners=False)[0]
    return logits, o.iou_scores[0, 0]  # [3,1024,1024], [3]


def iou(a, b):
    inter = (a & b).sum().item()
    union = (a | b).sum().item()
    return inter / union if union else 0.0


@torch.no_grad()
def evaluate(model, data, idx, taps=5):
    model.eval()
    rng = random.Random(123)
    picked, oracle, n = [], [], 0
    for i in idx:
        d = data[i]
        gt = d["gt"].bool().to(dev)
        for pt in tap_points(d["gt"], taps, rng):
            logits, scores = decode(model, d["emb"][0], pt)
            masks = logits > 0
            areas = masks.flatten(1).sum(1)
            best = int(scores.argmax())
            fine, fa = -1, None
            for c in range(3):  # PWA rule: smallest candidate that still scores MIN_FINE_SCORE
                if scores[c] >= MIN_FINE_SCORE and areas[c] > 0 and (fa is None or areas[c] < fa):
                    fine, fa = c, areas[c]
            if fine >= 0:
                best = fine
            picked.append(iou(masks[best], gt))
            oracle.append(max(iou(masks[c], gt) for c in range(3)))
    return {"images": len(idx), "taps": len(picked), "miou_pwa_rule": float(np.mean(picked)),
            "miou_oracle": float(np.mean(oracle))}


def seg_loss(logits, gt):
    """Focal(20) + dice per candidate, as in SAM. logits [3,H,W], gt [H,W] float."""
    g = gt[None].expand_as(logits)
    p = torch.sigmoid(logits)
    ce = F.binary_cross_entropy_with_logits(logits, g, reduction="none")
    pt = p * g + (1 - p) * (1 - g)
    focal = (ce * (1 - pt) ** 2 * (0.25 * g + 0.75 * (1 - g))).flatten(1).mean(1)
    inter = (p * g).flatten(1).sum(1)
    dice = 1 - (2 * inter + 1) / (p.flatten(1).sum(1) + g.flatten(1).sum(1) + 1)
    return 20 * focal + dice


def train():
    OUT.mkdir(exist_ok=True)
    data = load_all()
    tr, te = split(len(data))
    # validation for checkpoint choice comes out of train only; held-out stays untouched
    rng = random.Random(SEED)
    va = rng.sample(tr, max(1, len(tr) // 8))
    tr = [i for i in tr if i not in va]
    model = SamModel.from_pretrained(BASE).to(dev)
    for p in model.parameters():
        p.requires_grad = False
    for p in model.mask_decoder.parameters():
        p.requires_grad = True
    opt = torch.optim.AdamW([p for p in model.parameters() if p.requires_grad], lr=1e-4, weight_decay=1e-4)
    epochs = int(os.environ.get("EPOCHS", 12))
    sched = torch.optim.lr_scheduler.CosineAnnealingLR(opt, epochs * len(tr))
    best = evaluate(model, data, va, taps=3)["miou_pwa_rule"]
    print("val stock", round(best, 4))
    model.save_pretrained(OUT / "best")
    for ep in range(epochs):
        model.train()
        rng.shuffle(tr)
        tot = 0.0
        for i in tr:
            d = data[i]
            flip = rng.random() < 0.5
            emb = d["emb"][1 if flip else 0]
            gt = flip_gt(d["gt"], d["valid"]) if flip else d["gt"]
            pts = tap_points(gt, 1, rng)
            if not pts:
                continue
            logits, scores = decode(model, emb, pts[0])
            g = gt.float().to(dev)
            l = seg_loss(logits, g)
            k = int(l.argmin())  # train the best candidate, like SAM's multimask loss
            with torch.no_grad():
                true_iou = torch.tensor([iou(logits[c] > 0, g.bool()) for c in range(3)], device=dev)
            loss = l[k] + F.mse_loss(scores, true_iou)
            opt.zero_grad()
            loss.backward()
            opt.step()
            sched.step()
            tot += loss.item()
        v = evaluate(model, data, va, taps=3)["miou_pwa_rule"]
        print(f"epoch {ep + 1} loss {tot / len(tr):.4f} val {v:.4f}")
        if v > best:
            best = v
            model.save_pretrained(OUT / "best")
    tuned = SamModel.from_pretrained(OUT / "best").to(dev)
    res = {"heldout_tuned": evaluate(tuned, data, te), "val_best": best}
    print(json.dumps(res, indent=1))
    (OUT / "train_result.json").write_text(json.dumps(res, indent=1))


def eval_stock():
    data = load_all()
    _, te = split(len(data))
    model = SamModel.from_pretrained(BASE).to(dev)
    res = evaluate(model, data, te)
    print(json.dumps(res, indent=1))
    OUT.mkdir(exist_ok=True)
    (OUT / "stock_result.json").write_text(json.dumps(res, indent=1))


if __name__ == "__main__":
    {"cache": cache, "eval": eval_stock, "train": train}[sys.argv[1]]()
