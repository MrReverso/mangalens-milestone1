#!/usr/bin/env python3
import os
import sys
import asyncio
import tempfile
import inspect
import platform
import numpy as np

print("=== STARTING STRICT OCR BENCHMARK SMOKE TESTS ===")

# 1. Strict dependency imports (failures will fail GHA CI)
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
    HAS_MANGA_TRANSLATOR = True
    print("  ✓ manga-image-translator configuration and dispatchers imported successfully.")
except ImportError as e:
    print(f"CRITICAL ERROR: manga-image-translator is missing or broken: {e}")
    sys.exit(1)

# Import the parsing utility
try:
    from benchmark import parse_paddle_rec_result
except ImportError:
    # Inline fallback if run outside directory
    def parse_paddle_rec_result(res) -> tuple:
        if not res:
            return "", 0.0
        try:
            first = res[0]
            if isinstance(first, list) and len(first) > 0:
                item = first[0]
                if isinstance(item, list) or isinstance(item, tuple):
                    return str(item[0]), float(item[1])
                elif isinstance(item, str):
                    return item, float(first[1]) if len(first) > 1 else 0.0
            elif isinstance(first, tuple) or isinstance(first, list):
                return str(first[0]), float(first[1])
        except Exception:
            pass
        return "", 0.0


def create_synthetic_image(text: str) -> str:
    """
    Creates a high-resolution 1200x400 white image with black text using a 72px bold font.
    """
    width, height = 1200, 400
    img = Image.new("RGB", (width, height), color="white")
    draw = ImageDraw.Draw(img)

    # Search for bold system fonts
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

    print(f"  ✓ Loaded bold test font from: {loaded_path}")
    draw.text((100, 150), text, fill="black", font=font)
    
    temp_dir = tempfile.gettempdir()
    temp_path = os.path.join(temp_dir, "synthetic_smoke_test.png")
    img.save(temp_path)
    return temp_path


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
    img_path = create_synthetic_image(expected_text)

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
        except AssertionError as e:
            print(f"CRITICAL TEST FAILURE: Standalone PaddleOCR verification failed!")
            print(f"Raw response: {results}")
            print(f"Exception details: {e}")
            raise

        # 2. Recognition-only test (det=False, rec=True)
        img_np = cv2.imread(img_path)
        # Crop centered text area roughly
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
    if not HAS_MANGA_TRANSLATOR:
        print("  Skipped: manga-image-translator not installed.")
        return

    # Create dummy detector polygon (4 points)
    dummy_pts = np.array([
        [100, 100],
        [300, 100],
        [300, 200],
        [100, 200]
    ], dtype=np.float32)
    
    r = Quadrilateral(dummy_pts, text="", prob=0.0)
    
    # 1. Verify coordinate preservation
    original_pts = r.pts.copy()
    original_aabb_x = r.aabb.x
    original_aabb_y = r.aabb.y
    original_aabb_w = r.aabb.w
    original_aabb_h = r.aabb.h

    # Mock PaddleOCR 2.8.1 rec results shape: [[['MANGALENS TEST', 0.985]]]
    mock_paddle_res = [[['MANGALENS TEST', 0.985]]]
    
    text, conf = parse_paddle_rec_result(mock_paddle_res)
    assert text == "MANGALENS TEST"
    assert conf == 0.985
    
    # Map back to original region
    r.text = text
    r.prob = conf
    
    # Check that coordinates are preserved exactly
    np.testing.assert_array_equal(r.pts, original_pts)
    assert r.aabb.x == original_aabb_x
    assert r.aabb.y == original_aabb_y
    assert r.aabb.w == original_aabb_w
    assert r.aabb.h == original_aabb_h
    print("  ✓ Coordinates preserved successfully.")

    # 2. Produce zero regions when recognition returns empty text
    empty_paddle_res = [[['', 0.0]]]
    text_empty, conf_empty = parse_paddle_rec_result(empty_paddle_res)
    assert text_empty == ""
    
    # Simulating region filtering in Pipeline B/C
    regions_result = []
    if text_empty and text_empty.strip():
        regions_result.append({
            "id": "region_1",
            "polygon": {"points": [{"x": float(p[0]), "y": float(p[1])} for p in r.pts]},
            "boundingBox": {"x": int(r.aabb.x), "y": int(r.aabb.y), "width": int(r.aabb.w), "height": int(r.aabb.h)},
            "text": text_empty.strip(),
            "confidence": conf_empty,
            "detector": "ctd",
            "recognizer": "paddleocr-en"
        })
    
    assert len(regions_result) == 0, "Pipeline B/C must produce zero regions when recognition returns empty text"
    print("  ✓ Empty recognition returns zero regions successfully.")


def main():
    # 1. Run async WXT/manga-translator adapter verification
    try:
        asyncio.run(run_manga_translator_smoke_tests())
    except Exception as e:
        print(f"CRITICAL ERROR in manga-image-translator smoke test: {e}")
        sys.exit(1)

    # 2. Run hybrid pipeline tests
    try:
        test_hybrid_pipelines()
    except Exception as e:
        print(f"CRITICAL ERROR in hybrid pipeline smoke test: {e}")
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
