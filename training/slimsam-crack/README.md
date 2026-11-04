# SlimSAM crack decoder

SnapClaim outlines damage with SlimSAM (`Xenova/slimsam-77-uniform`) in the browser. On thin
cracks the stock model usually returns the wall, not the crack. This folder fine-tunes only
the mask decoder on cracks. The encoder stays frozen, so the app computes one embedding per
photo with the stock encoder and gives damage taps to the tuned decoder.

Published model: [`tariqkhalif/slimsam-77-crack`](https://huggingface.co/tariqkhalif/slimsam-77-crack)
(Apache-2.0). Training data: the Özgenel Concrete Crack Segmentation Dataset (CC BY 4.0).

## Results

Held-out split: 92 images, scored the way the app scores a tap (one positive tap, three
candidates, keep the smallest one above the score floor).

| Run | Stock | Tuned | File |
|---|---|---|---|
| PyTorch, 460 taps, 1024 frame | 0.131 | 0.459 mIoU | `out/stock_result.json`, `out/train_result.json` |
| ONNX export (fp32 / q8) | | 0.459 / 0.457 | `out/onnx_result.json` |
| transformers.js 3.0.2 q8, stock embeddings, app rules (0.3 / 20 px / 0.5 wall), 276 taps | 0.174 | **0.697** | `out/browser_two_decoder.json` |

The last row is what the app ships: `pwa/sam-worker.js` and `react/public/sam-worker.js`.

**Why coins stay on stock:** `browser-check/coins.mjs` taps the coin in the 16 team samples
(`react/public/samples/dsc_06xx.jpg`). The tuned decoder grows coin masks 1.2-3.3x wider by
taking in the tape around the coin. The stock decoder scores 0.85-0.98 on those coins, so
the scale reference keeps using it.

## Reproduce

```
python ft.py cache     # embed every image once with the frozen encoder
python ft.py eval      # stock model on the held-out split
python ft.py train     # train the decoder, eval the best checkpoint
python export.py       # ONNX export (opset 13), q8 quantization, ONNX eval
cd browser-check && npm install
SLIMSAM_FT=../ node hybrid.mjs   # the shipped two-decoder setup
node coins.mjs                   # coin regression
```

`ft.py` needs a CUDA GPU and the dataset under `data/`. The browser checks read the exported
models from `xenova/` (stock) and `hf/` (tuned) under `SLIMSAM_FT`.
