#!/usr/bin/env python3
import glob
import os

from paddleocr import PaddleOCR


PaddleOCR(use_angle_cls=True, lang="en", show_log=False)
PaddleOCR(use_angle_cls=True, lang="en", show_log=False, det=False, rec=True)

cache_root = os.path.expanduser("~/.paddleocr/whl")
patterns = {
    "Detector": os.path.join(cache_root, "det", "en", "*_det_infer"),
    "Recognizer": os.path.join(cache_root, "rec", "en", "*_rec_infer"),
    "Classifier": os.path.join(cache_root, "cls", "*_cls_infer"),
}
for label, pattern in patterns.items():
    matches = sorted(path for path in glob.glob(pattern) if os.path.isdir(path))
    if not matches:
        raise RuntimeError(f"{label} model directory missing for pattern: {pattern}")
    print(f"{label} model path: {matches[-1]}")
