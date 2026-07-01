#!/usr/bin/env python3
import os
import sys
import asyncio
import tempfile
import inspect
import platform
import numpy as np
from typing import Tuple, List, Any

print("=== STARTING STRICT OCR BENCHMARK SMOKE TESTS ===")

# 1. Basic dependency imports (must always be present)
try:
    import cv2
    from PIL import Image, ImageDraw, ImageFont
    print("  ✓ Basic image processing libraries (cv2, PIL) imported successfully.")
except ImportError as e:
    print(f"CRITICAL ERROR: Basic dependencies are missing: {e}")
    sys.exit(1)

# 2. Optional top-level imports for deep learning packages (failures captured for lazy validation)
PADDLE_IMPORT_ERROR = None
try:
    import paddle
except Exception as e:
    PADDLE_IMPORT_ERROR = e

PADDLEOCR_IMPORT_ERROR = None
try:
    from paddleocr import PaddleOCR
except Exception as e:
    PADDLEOCR_IMPORT_ERROR = e
    PaddleOCR = None

MANGA_OCR_IMPORT_ERROR = None
try:
    import manga_ocr
except Exception as e:
    MANGA_OCR_IMPORT_ERROR = e
    manga_ocr = None

HAS_MANGA_TRANSLATOR = False
MANGA_TRANSLATOR_IMPORT_ERROR = None
try:
    from manga_translator.config import Detector, Ocr, DetectorConfig, OcrConfig
    from manga_translator.detection import DETECTORS, dispatch as dispatch_detection
    from manga_translator.ocr import OCRS, dispatch as dispatch_ocr
    from manga_translator.utils import Quadrilateral
    HAS_MANGA_TRANSLATOR = True
except Exception as e:
    MANGA_TRANSLATOR_IMPORT_ERROR = e
    Detector = None
    Ocr = None
    DetectorConfig = None
    OcrConfig = None
    DETECTORS = {}
    OCRS = {}
    dispatch_detection = None
    dispatch_ocr = None
    Quadrilateral = None

# Import helper functions from benchmark.py
try:
    from benchmark import recognize_detected_regions_with_paddle, parse_paddle_rec_result
except ImportError as e:
    print(f"CRITICAL ERROR: Failed to import helpers from benchmark.py: {e}")
    sys.exit(1)


# Mocks for testing hybrid pipelines without loading heavy detector models
class MockPaddleOCR:
    def __init__(self, return_val=None):
        self.return_val = return_val
        self.last_img = None

    def ocr(self, img, det=False, rec=True):
        self.last_img = img
        return self.return_val


class MockRegionWithWarp:
    def __init__(self, pts, direction="h", fail_warp=False):
        self.pts = pts
        self.direction = direction
        self.fail_warp = fail_warp
        self.get_transformed_called = False
        
        xs = [p[0] for p in pts]
        ys = [p[1] for p in pts]
        
        class MockBBox:
            def __init__(self, x, y, w, h):
                self.x = x
                self.y = y
                self.w = w
                self.h = h
                
        self.aabb = MockBBox(min(xs), min(ys), max(xs) - min(xs), max(ys) - min(ys))

    def get_transformed_region(self, img, direction, textheight):
        self.get_transformed_called = True
        if self.fail_warp:
            raise RuntimeError("Warp failed simulation")
        # Return a dummy small cropped array (48px height)
        return np.ones((48, 100, 3), dtype=np.uint8)


def create_synthetic_image(text: str) -> Tuple[str, str]:
    width, height = 1200, 400
    img = Image.new("RGB", (width, height), color="white")
    draw = ImageDraw.Draw(img)

    font_paths = []
    if platform.system() == "Linux":
        font_paths = [
            "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
            "/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf",
            "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
            "/usr/share/fonts/truetype/freefont/FreeSansBold.ttf"
        ]
    elif platform.system() == "Darwin":  # macOS
        font_paths = [
            "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
            "/Library/Fonts/Arial Bold.ttf",
            "/System/Library/Fonts/Supplemental/Courier New Bold.ttf"
        ]
    elif platform.system() == "Windows":
        font_paths = [
            "C:\\Windows\\Fonts\\arialbd.ttf",
            "C:\\Windows\\Fonts\\courbd.ttf"
        ]

    font = None
    loaded_path = ""
    for fp in font_paths:
        if os.path.exists(fp):
            try:
                font = ImageFont.truetype(fp, 72)
                loaded_path = fp
                break
            except Exception:
                pass

    if font is None:
        raise ValueError(
            "CRITICAL: No suitable bold system font (DejaVuSans-Bold, Arial Bold, etc.) could be loaded. "
            f"Paths checked: {font_paths}"
        )

    draw.text((100, 150), text, fill="black", font=font)
    
    temp_dir = tempfile.gettempdir()
    temp_path = os.path.join(temp_dir, "synthetic_smoke_test.png")
    img.save(temp_path)
    return temp_path, loaded_path


async def run_manga_translator_smoke_tests():
    print("Verifying manga-image-translator registries and signatures...")
    
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
    assert Ocr.mocr in OCRS, "OCR registry missing 'mocr'"
    print("  ✓ Detector and OCR registers successfully populated.")

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
    expected_text = "MANGALENS OCR TEST"
    img_path, font_path = create_synthetic_image(expected_text)

    try:
        # 1. Standalone test
        ocr = PaddleOCR(use_angle_cls=True, lang="en", show_log=False)
        results = ocr.ocr(img_path, cls=True)

        print(f"  PaddleOCR standalone raw results: {results}")
        
        try:
            assert results is not None, "PaddleOCR returned None"
            assert len(results) > 0, "PaddleOCR returned empty result list"
            assert results[0] is not None, "PaddleOCR first page results are None"
            assert len(results[0]) > 0, "PaddleOCR detected 0 text regions on synthetic image"

            bbox, (detected_text, confidence) = results[0][0]
            assert len(bbox) == 4, "PaddleOCR standalone did not return 4-point polygon"
            assert isinstance(confidence, (int, float)), "Confidence score is not numeric"
            assert len(detected_text.strip()) > 0, "PaddleOCR returned empty string label"
            
            print(f"  ✓ Standalone PaddleOCR verified: '{detected_text}' ({confidence:.2f})")
            print(f"  ✓ Fixture Font Path: {font_path}")
            print(f"  ✓ Model Cache Path: {os.path.expanduser('~/.paddleocr')}")
        except AssertionError as e:
            print(f"CRITICAL TEST FAILURE: Standalone PaddleOCR verification failed!")
            print(f"Raw response: {results}")
            print(f"Exception details: {e}")
            raise

        # 2. Recognition-only test (det=False, rec=True)
        img_np = cv2.imread(img_path)
        crop_img = img_np[100:300, 50:1100]
        
        ocr_rec = PaddleOCR(use_angle_cls=True, lang="en", show_log=False, det=False, rec=True)
        res_rec = ocr_rec.ocr(crop_img, det=False, rec=True)
        
        print(f"  PaddleOCR recognition-only raw results: {res_rec}")
        
        try:
            assert res_rec is not None, "PaddleOCR recognition-only returned None"
            assert len(res_rec) > 0, "PaddleOCR recognition-only returned empty results list"
            assert isinstance(res_rec[0], list), "PaddleOCR rec-only result is not a list of lists"
            assert len(res_rec[0]) > 0, "PaddleOCR rec-only result has empty inner list"
            
            text, conf = parse_paddle_rec_result(res_rec)
            assert len(text.strip()) > 0, "PaddleOCR recognition-only returned empty string"
            print(f"  ✓ PaddleOCR recognition-only (det=False) verified: '{text}' ({conf:.2f})")
        except AssertionError as e:
            print(f"CRITICAL TEST FAILURE: PaddleOCR recognition-only response shape is invalid!")
            print(f"Raw response: {res_rec}")
            print(f"Exception details: {e}")
            raise

    finally:
        if os.path.exists(img_path):
            os.remove(img_path)


def test_hybrid_pipelines():
    print("Verifying hybrid Pipeline B & C logic...")
    
    dummy_img = np.ones((400, 400, 3), dtype=np.uint8)
    dummy_pts = np.array([[10, 10], [100, 10], [100, 50], [10, 50]], dtype=np.float32)
    
    # 1. Success path (Warp succeeds)
    r1 = MockRegionWithWarp(dummy_pts.copy(), direction="h", fail_warp=False)
    mock_ocr = MockPaddleOCR([[["HELLO", 0.99]]])
    
    res1 = recognize_detected_regions_with_paddle(
        dummy_img, [r1], "ko", mock_ocr, "ctd", "1.0.0"
    )
    
    assert r1.get_transformed_called is True
    assert mock_ocr.last_img is not None
    assert len(res1) == 1
    assert res1[0]["text"] == "HELLO"
    assert res1[0]["confidence"] == 0.99
    assert res1[0]["detector"] == "ctd"
    assert res1[0]["recognizer"] == "paddleocr-ko"
    np.testing.assert_array_equal(r1.pts, dummy_pts)
    print("  ✓ Success warp path, coordinate preservation, and Korean recognizer label verified.")

    # 2. Warp fails -> Bounded AABB fallback succeeds
    r2 = MockRegionWithWarp(dummy_pts.copy(), direction="h", fail_warp=True)
    mock_ocr2 = MockPaddleOCR([[["WORLD", 0.95]]])
    
    res2 = recognize_detected_regions_with_paddle(
        dummy_img, [r2], "en", mock_ocr2, "dbconvnext", "1.0.0"
    )
    
    assert r2.get_transformed_called is True
    assert mock_ocr2.last_img is not None
    assert mock_ocr2.last_img.shape == (40, 90, 3)  # Centered crop size: y: 50-10, x: 100-10
    assert len(res2) == 1
    assert res2[0]["text"] == "WORLD"
    assert res2[0]["confidence"] == 0.95
    assert res2[0]["detector"] == "dbconvnext"
    assert res2[0]["recognizer"] == "paddleocr-en"
    print("  ✓ Warp failure with AABB fallback path and English recognizer label verified.")

    # 3. Empty recognition produces zero regions
    r3 = MockRegionWithWarp(dummy_pts.copy(), direction="h", fail_warp=False)
    mock_ocr3 = MockPaddleOCR([[["", 0.0]]])
    res3 = recognize_detected_regions_with_paddle(
        dummy_img, [r3], "ko", mock_ocr3, "ctd", "1.0.0"
    )
    assert len(res3) == 0
    print("  ✓ Empty recognition returns zero regions verified.")

    # 4. Malformed/failed recognition reported clearly
    r4 = MockRegionWithWarp(dummy_pts.copy(), direction="h", fail_warp=False)
    class BrokenPaddleOCR:
        def ocr(self, *args, **kwargs):
            raise RuntimeError("Inference failed simulation")
            
    res4 = recognize_detected_regions_with_paddle(
        dummy_img, [r4], "ko", BrokenPaddleOCR(), "ctd", "1.0.0"
    )
    assert len(res4) == 0
    print("  ✓ Malformed recognition output handled gracefully verified.")


def main():
    # 1. Run hybrid pipeline unit tests first (does not download large detector models or require heavy packages)
    print("\n--- Running Hybrid Pipeline Unit Tests ---")
    try:
        test_hybrid_pipelines()
    except Exception as e:
        print(f"CRITICAL ERROR in hybrid pipeline unit test: {e}")
        sys.exit(1)
    print("--- Hybrid Pipeline Unit Tests Passed Successfully ---\n")

    # 2. Run async WXT/manga-translator adapter verification
    print("--- Running Heavy Package Import Validations ---")
    if MANGA_TRANSLATOR_IMPORT_ERROR:
        print(f"CRITICAL ERROR: manga-image-translator failed to import: {MANGA_TRANSLATOR_IMPORT_ERROR}")
        sys.exit(1)
    if MANGA_OCR_IMPORT_ERROR:
        print(f"CRITICAL ERROR: manga-ocr failed to import: {MANGA_OCR_IMPORT_ERROR}")
        sys.exit(1)
    if PADDLE_IMPORT_ERROR:
        print(f"CRITICAL ERROR: paddlepaddle failed to import: {PADDLE_IMPORT_ERROR}")
        sys.exit(1)
    if PADDLEOCR_IMPORT_ERROR:
        print(f"CRITICAL ERROR: paddleocr failed to import: {PADDLEOCR_IMPORT_ERROR}")
        sys.exit(1)

    try:
        asyncio.run(run_manga_translator_smoke_tests())
    except Exception as e:
        print(f"CRITICAL ERROR in manga-image-translator smoke test: {e}")
        sys.exit(1)

    # 3. Run sync PaddleOCR standalone/rec-only validation
    try:
        run_paddle_smoke_test()
    except Exception as e:
        print(f"CRITICAL ERROR in PaddleOCR smoke test: {e}")
        sys.exit(1)

    print("=== ALL STRICT SMOKE TESTS COMPLETED SUCCESSFULY ===")
    sys.exit(0)


if __name__ == "__main__":
    main()
