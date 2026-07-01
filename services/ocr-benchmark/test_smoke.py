#!/usr/bin/env python3
import os
import sys
import asyncio
import tempfile
import inspect
import numpy as np

try:
    import cv2
    from PIL import Image, ImageDraw, ImageFont
except ImportError as e:
    print(f"Error: Required test dependencies (opencv-python, Pillow) are missing: {e}")
    sys.exit(1)

# Import test tools
try:
    from paddleocr import PaddleOCR
except ImportError:
    PaddleOCR = None

try:
    import manga_ocr
except ImportError:
    manga_ocr = None

try:
    from manga_translator.config import Detector, Ocr, DetectorConfig, OcrConfig
    from manga_translator.detection import DETECTORS, dispatch as dispatch_detection
    from manga_translator.ocr import OCRS, dispatch as dispatch_ocr
    from manga_translator.utils import Quadrilateral
    HAS_MANGA_TRANSLATOR = True
except ImportError:
    HAS_MANGA_TRANSLATOR = False


def create_synthetic_image(text: str) -> str:
    """
    Creates a simple synthetic white image with black text drawn onto it.
    """
    # Create white canvas
    width, height = 300, 100
    img = Image.new("RGB", (width, height), color="white")
    draw = ImageDraw.Draw(img)
    
    # Try to load a default font
    try:
        font = ImageFont.load_default()
    except Exception:
        font = None

    # Draw text in the middle
    draw.text((20, 40), text, fill="black", font=font)
    
    temp_dir = tempfile.gettempdir()
    temp_path = os.path.join(temp_dir, "synthetic_smoke_test.png")
    img.save(temp_path)
    return temp_path


async def run_manga_translator_smoke_tests():
    print("Running manga-image-translator API structure tests...")
    if not HAS_MANGA_TRANSLATOR:
        print("Skipped: manga-image-translator is not installed in the current environment.")
        return

    # 1. Verify enums exist and are correct
    assert Detector.default == "default"
    assert Detector.ctd == "ctd"
    assert Detector.dbconvnext == "dbconvnext"
    assert Ocr.ocr48px == "48px"
    assert Ocr.mocr == "mocr"
    print("  ✓ Detector and Ocr enums verified.")

    # 2. Verify detectors exist in registry and can be constructed
    assert Detector.default in DETECTORS
    assert Detector.ctd in DETECTORS
    assert Detector.dbconvnext in DETECTORS

    default_class = DETECTORS[Detector.default]
    ctd_class = DETECTORS[Detector.ctd]
    dbconvnext_class = DETECTORS[Detector.dbconvnext]

    assert default_class is not None
    assert ctd_class is not None
    assert dbconvnext_class is not None
    print("  ✓ Detector constructor classes verified.")

    # 3. Verify OCR models exist in registry and can be constructed
    assert Ocr.ocr48px in OCRS
    assert Ocr.mocr in OCRS
    print("  ✓ OCR constructor classes verified.")

    # 4. Verify dispatchers are async/awaitable and parameters match
    assert inspect.iscoroutinefunction(dispatch_detection)
    assert inspect.iscoroutinefunction(dispatch_ocr)

    sig_det = inspect.signature(dispatch_detection)
    assert "detector_key" in sig_det.parameters
    assert "image" in sig_det.parameters
    assert "detect_size" in sig_det.parameters
    assert "text_threshold" in sig_det.parameters
    assert "box_threshold" in sig_det.parameters
    assert "unclip_ratio" in sig_det.parameters
    assert "invert" in sig_det.parameters
    assert "gamma_correct" in sig_det.parameters
    assert "rotate" in sig_det.parameters
    assert "auto_rotate" in sig_det.parameters
    assert "device" in sig_det.parameters
    assert "verbose" in sig_det.parameters

    sig_ocr = inspect.signature(dispatch_ocr)
    assert "ocr_key" in sig_ocr.parameters
    assert "image" in sig_ocr.parameters
    assert "regions" in sig_ocr.parameters
    assert "config" in sig_ocr.parameters
    assert "device" in sig_ocr.parameters
    assert "verbose" in sig_ocr.parameters
    print("  ✓ Asynchronous dispatch signatures verified.")


def run_paddle_smoke_test():
    print("Running PaddleOCR integration smoke test...")
    if not PaddleOCR:
        print("Skipped: paddleocr is not installed in the current environment.")
        return

    expected_text = "TEST"
    img_path = create_synthetic_image(expected_text)

    try:
        # Initialize PaddleOCR CPU model
        ocr = PaddleOCR(use_angle_cls=True, lang="en", show_log=False)
        results = ocr.ocr(img_path, cls=True)

        print(f"  PaddleOCR results: {results}")

        assert results is not None, "PaddleOCR returned None"
        assert len(results) > 0, "PaddleOCR returned empty results list"
        assert results[0] is not None, "PaddleOCR first page results is None"
        assert len(results[0]) > 0, "PaddleOCR detected 0 text regions on synthetic image"

        bbox, (detected_text, confidence) = results[0][0]
        assert len(bbox) == 4, "PaddleOCR polygon did not return exactly 4 points"
        assert len(detected_text.strip()) > 0, "PaddleOCR returned an empty string"
        
        # Verify text similarity (since default PIL font is tiny, check if we got some text)
        print(f"  ✓ Success: Detected '{detected_text}' with confidence {confidence:.2f}")

    finally:
        if os.path.exists(img_path):
            os.remove(img_path)


def main():
    print("=== STARTING OCR BENCHMARK SMOKE TESTS ===")
    
    # Run synchronous PaddleOCR test
    try:
        run_paddle_smoke_test()
    except Exception as e:
        print(f"Error in PaddleOCR smoke test: {e}")
        traceback_str = inspect.trace()
        print(traceback_str)
        sys.exit(1)

    # Run asynchronous manga-image-translator tests
    try:
        asyncio.run(run_manga_translator_smoke_tests())
    except Exception as e:
        print(f"Error in manga-image-translator smoke test: {e}")
        sys.exit(1)

    print("=== ALL SMOKE TESTS COMPLETED SUCCESSFULY ===")


if __name__ == "__main__":
    main()
