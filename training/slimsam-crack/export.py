"""Export the tuned decoder to ONNX in Xenova's layout, quantize it the same way,
and score both ONNX files on the held-out split with the PWA rule.

  python export.py      # writes hf/ (ready to upload) and out/onnx_result.json
"""
import json, random, shutil
from pathlib import Path
import numpy as np
import torch
import torch.nn.functional as F
import onnxruntime as ort
from onnxruntime.quantization import quantize_dynamic, QuantType
from transformers import SamModel

import ft

ROOT = Path(__file__).parent
EXP = ROOT / "export"
HF = ROOT / "hf"
XEN = ROOT / "xenova"
DEC = "prompt_encoder_mask_decoder"


class Decoder(torch.nn.Module):
    """Same graph optimum exports for SAM: prompt encoder + mask decoder, PE as an input."""

    def __init__(self, model):
        super().__init__()
        self.m = model

    def forward(self, input_points, input_labels, image_embeddings, image_positional_embeddings):
        sparse, dense = self.m.prompt_encoder(input_points=input_points, input_labels=input_labels,
                                              input_boxes=None, input_masks=None)
        masks, iou = self.m.mask_decoder(image_embeddings=image_embeddings,
                                         image_positional_embeddings=image_positional_embeddings,
                                         sparse_prompt_embeddings=sparse, dense_prompt_embeddings=dense,
                                         multimask_output=True)
        return iou, masks


def export():
    shutil.rmtree(EXP, ignore_errors=True)
    EXP.mkdir()
    model = SamModel.from_pretrained(ft.OUT / "best", attn_implementation="eager").eval()
    pe = model.get_image_wide_positional_embeddings()
    args = (torch.tensor([[[[400.0, 300.0]]]]), torch.ones((1, 1, 1), dtype=torch.long),
            torch.randn(1, 256, 64, 64), pe)
    b, pb, n = "batch_size", "point_batch_size", "nb_points_per_image"
    torch.onnx.export(Decoder(model), args, str(EXP / f"{DEC}.onnx"), opset_version=13, dynamo=False,
                      input_names=["input_points", "input_labels", "image_embeddings", "image_positional_embeddings"],
                      output_names=["iou_scores", "pred_masks"],
                      dynamic_axes={"input_points": {0: b, 1: pb, 2: n}, "input_labels": {0: b, 1: pb, 2: n},
                                    "image_embeddings": {0: b}, "image_positional_embeddings": {0: b},
                                    "iou_scores": {0: b, 1: pb}, "pred_masks": {0: b, 1: pb}})
    print("exported", sorted(p.name for p in EXP.glob("*.onnx")))


def quantize(src, dst):
    cfg = json.loads((XEN / "quantize_config.json").read_text())
    q = cfg["per_model_config"][DEC]
    quantize_dynamic(str(src), str(dst), op_types_to_quantize=q["op_types"], per_channel=cfg["per_channel"],
                     reduce_range=cfg["reduce_range"], weight_type=getattr(QuantType, q["weight_type"]))


def assemble():
    shutil.rmtree(HF, ignore_errors=True)
    (HF / "onnx").mkdir(parents=True)
    for f in ("config.json", "preprocessor_config.json"):
        shutil.copy(XEN / f, HF / f)
    shutil.copy(XEN / "quantize_config.json", HF / "quantize_config.json")
    # encoder is frozen, so Xenova's encoder files are byte-for-byte what we would export
    for f in ("vision_encoder.onnx", "vision_encoder_quantized.onnx"):
        shutil.copy(XEN / "onnx" / f, HF / "onnx" / f)
    shutil.copy(EXP / f"{DEC}.onnx", HF / "onnx" / f"{DEC}.onnx")
    quantize(HF / "onnx" / f"{DEC}.onnx", HF / "onnx" / f"{DEC}_quantized.onnx")


def onnx_eval(path, data, idx, pe, taps=5):
    sess = ort.InferenceSession(str(path), providers=["CPUExecutionProvider"])
    rng = random.Random(123)  # same taps as ft.evaluate
    picked, oracle = [], []
    for i in idx:
        d = data[i]
        gt = d["gt"].bool()
        emb = d["emb"][0][None].float().numpy()
        for pt in ft.tap_points(d["gt"], taps, rng):
            scores, masks = sess.run(["iou_scores", "pred_masks"], {
                "input_points": np.array([[[pt]]], np.float32),
                "input_labels": np.ones((1, 1, 1), np.int64),
                "image_embeddings": emb,
                "image_positional_embeddings": pe,
            })
            logits = F.interpolate(torch.from_numpy(masks[0, 0])[None], (ft.SIDE, ft.SIDE), mode="bilinear",
                                   align_corners=False)[0]
            s = torch.from_numpy(scores[0, 0])
            m = logits > 0
            areas = m.flatten(1).sum(1)
            best, fa = int(s.argmax()), None
            for c in range(3):
                if s[c] >= ft.MIN_FINE_SCORE and areas[c] > 0 and (fa is None or areas[c] < fa):
                    best, fa = c, areas[c]
            picked.append(ft.iou(m[best], gt))
            oracle.append(max(ft.iou(m[c], gt) for c in range(3)))
    return {"taps": len(picked), "miou_pwa_rule": float(np.mean(picked)), "miou_oracle": float(np.mean(oracle))}


def parity(path, pe, data):
    """Raw logits: ONNX vs PyTorch on a few taps."""
    sess = ort.InferenceSession(str(path), providers=["CPUExecutionProvider"])
    model = SamModel.from_pretrained(ft.OUT / "best", attn_implementation="eager").eval()
    worst = 0.0
    for d in data[:5]:
        pt = ft.tap_points(d["gt"], 1, random.Random(0))[0]
        emb = d["emb"][0][None].float()
        with torch.no_grad():
            o = model(image_embeddings=emb, input_points=torch.tensor([[[pt]]]), input_labels=torch.ones((1, 1, 1), dtype=torch.long),
                      multimask_output=True)
        _, masks = sess.run(None, {"input_points": np.array([[[pt]]], np.float32), "input_labels": np.ones((1, 1, 1), np.int64),
                                   "image_embeddings": emb.numpy(), "image_positional_embeddings": pe})
        worst = max(worst, float(np.abs(masks - o.pred_masks.numpy()).max()))
    return worst


def main():
    export()
    assemble()
    model = SamModel.from_pretrained(ft.OUT / "best", attn_implementation="eager").eval()
    with torch.no_grad():
        pe = model.get_image_wide_positional_embeddings().numpy()  # [1,256,64,64]
    data = ft.load_all()
    _, te = ft.split(len(data))
    res = {"max_abs_logit_diff_fp32_vs_torch": parity(HF / "onnx" / f"{DEC}.onnx", pe, data)}
    for name in (f"{DEC}.onnx", f"{DEC}_quantized.onnx"):
        res[name] = onnx_eval(HF / "onnx" / name, data, te, pe)
        res[name]["bytes"] = (HF / "onnx" / name).stat().st_size
    print(json.dumps(res, indent=1))
    (ft.OUT / "onnx_result.json").write_text(json.dumps(res, indent=1))


if __name__ == "__main__":
    main()
