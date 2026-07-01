#!/usr/bin/env python3
import os
import sys
import asyncio
import tempfile
import inspect
import numpy as np

print("=== STARTING STRICT OCR BENCHMARK SMOKE TESTS ===")

# 1. Strict dependency imports (failures will fail CI)
try:
    import cv2
    from PIL import Image, ImageDraw, ImageFont
    print("  ✓ Basic image processing libraries (cv2, PIL) imported successfully.")
except ImportError as e:
    print(f"CRITICAL ERROR: Basic dependencies are missing: {e}")
    sys.exit(1)

try:
    import paddle
    print("  ✓ paddlepaddle imported successfully.")
except ImportError as e:
    print(f"CRITICAL ERROR: paddlepaddle is missing: {e}")
    sys.exit(1)

try:
    from paddleocr import PaddleOCR
    print("  ✓ paddleocr imported successfully.")
except ImportError as e:
    print(f"CRITICAL ERROR: paddleocr is missing: {e}")
    sys.exit(1)

try:
    import manga_ocr
    print("  ✓ manga-ocr imported successfully.")
except ImportError as e:
    print(f"CRITICAL ERROR: manga-ocr is missing: {e}")
    sys.exit(1)

try:
    from manga_translator.config import Detector, Ocr, DetectorConfig, OcrConfig
    from manga_translator.detection import DETECTORS, dispatch as dispatch_detection
    from manga_translator.ocr import OCRS, dispatch as dispatch_ocr
    from manga_translator.utils import Quadrilateral
    print("  ✓ manga-image-translator configuration and dispatchers imported successfully.")
except ImportError as e:
    print(f"CRITICAL ERROR: manga-image-translator is missing or broken: {e}")
    sys.exit(1)


def create_synthetic_image(text: str) -> str:
    width, height = 300, 100
    img = Image.new("RGB", (width, height), color="white")
    draw = ImageDraw.Draw(img)
    try:
        font = ImageFont.load_default()
    except Exception:
        font = None
    draw.text((20, 40), text, fill="black", font=font)
    
    temp_dir = tempfile.gettempdir()
    temp_path = os.path.join(temp_dir, "synthetic_smoke_test.png")
    img.save(temp_path)
    return temp_path


async def run_manga_translator_smoke_tests():
    print("Verifying manga-image-translator registries and signatures...")
    
    # Verify registries contain target keys
    assert Detector.default == "default"
    assert Detector.ctd == "ctd"
    assert Detector.dbconvnext == "dbconvnext"
    assert Ocr.ocr48px == "48px"
    assert Ocr.mocr == "mocr"
    print("  ✓ Detector and Ocr enum definitions match expected strings.")

    assert Detector.default in DETECTORS, "Detector registry missing 'default'"
    assert Detector.ctd in DETECTORS, "Detector registry missing 'ctd'"
    assert Detector.dbconvnext in DETECTORS, "Detector registry missing 'dbconvnext'"
    
    assert Ocr.ocr48px in OCRS, "OCR registry missing 'ocr48px'"
    assert Ocr.mocr in OCRS, "OCR registry missing 'ocr48px'"
    print("  ✓ Detector and OCR registers successfully populated.")

    # Verify dispatch function signatures
    assert inspect.iscoroutinefunction(dispatch_detection), "dispatch_detection must be a coroutine function"
    assert inspect.iscoroutinefunction(dispatch_ocr), "dispatch_ocr must be a coroutine function"

    sig_det = inspect.signature(dispatch_detection)
    expected_det_params = [
        "detector_key", "image", "detect_size", "text_threshold", 
        "box_threshold", "unclip_ratio", "invert", "gamma_correct", 
        "rotate", "auto_rotate"
    ]
    for param in expected_det_params:
        assert param in sig_det.parameters, f"dispatch_detection signature missing parameter: {param}"

    sig_ocr = inspect.signature(dispatch_ocr)
    expected_ocr_params = [
        "ocr_key", "image", "regions", "config", "device", "verbose"
    ]
    for param in expected_ocr_params:
        assert param in sig_ocr.parameters, f"dispatch_ocr signature missing parameter: {param}"
        
    print("  ✓ Asynchronous dispatch signatures match expected adapter signatures.")


def run_paddle_smoke_test():
    print("Verifying PaddleOCR standalone and recognition-only integration...")
    expected_text = "TEST"
    img_path = create_synthetic_image(expected_text)

    try:
        # 1. Standalone test
        ocr = PaddleOCR(use_angle_cls=True, lang="en", show_log=False)
        results = ocr.ocr(img_path, cls=True)

        print(f"  PaddleOCR standalone raw results: {results}")
        assert results is not None, "PaddleOCR returned None"
        assert len(results) > 0, "PaddleOCR returned empty result list"
        assert results[0] is not None, "PaddleOCR first page results are None"
        assert len(results[0]) > 0, "PaddleOCR detected 0 text regions on synthetic image"

        bbox, (detected_text, confidence) = results[0][0]
        assert len(bbox) == 4, "PaddleOCR standalone did not return 4-point polygon"
        assert len(detected_text.strip()) > 0, "PaddleOCR returned empty string label"
        print(f"  ✓ Standalone PaddleOCR verified: '{detected_text}' ({confidence:.2f})")

        # 2. Recognition-only test (det=False, rec=True)
        # Crop synthetic image
        img_np = cv2.imread(img_path)
        crop_img = img_np[10:90, 10:290]
        
        ocr_rec = PaddleOCR(use_angle_cls=True, lang="en", show_log=False, det=False, rec=True)
        res_rec = ocr_rec.ocr(crop_img, det=False, rec=True)
        
        print(f"  PaddleOCR recognition-only raw results: {res_rec}")
        assert res_rec is not None, "PaddleOCR recognition-only returned None"
        assert len(res_rec) > 0, "PaddleOCR recognition-only returned empty results list"
        
        # Parse text
        from benchmark import parse_paddle_rec_result
        text, conf = parse_paddle_rec_result(res_rec)
        assert len(text.strip()) > 0, "PaddleOCR recognition-only returned empty string"
        print(f"  ✓ PaddleOCR recognition-only (det=False) verified: '{text}' ({conf:.2f})")

    finally:
        if os.path.exists(img_path):
            os.remove(img_path)


def main():
    # 1. Run async WXT/manga-translator adapter verification
    try:
        asyncio.run(run_manga_translator_smoke_tests())
    except Exception as e:
        print(f"CRITICAL ERROR in manga-image-translator smoke test: {e}")
        sys.exit(1)

    # 2. Run sync PaddleOCR standalone/rec-only validation
    try:
        run_paddle_smoke_test()
    except Exception as e:
        print(f"CRITICAL ERROR in PaddleOCR smoke test: {e}")
        sys.exit(1)

    print("=== ALL STRICT SMOKE TESTS COMPLETED SUCCESSFULY ===")
    sys.exit(0)


if __name__ == "__main__":
    main()
