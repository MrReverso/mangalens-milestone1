#!/usr/bin/env python3
import os
import sys
import importlib.metadata
import glob
import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from paddleocr import PaddleOCR
from result_parser import (
    describe_result_shape,
    is_genuine_empty_recognition_result,
    parse_recognition_result,
)

def main():
    print("Running real PaddleOCR runtime inference verification...")
    
    # 1. Assert DejaVuSans-Bold font exists exactly
    font_path = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
    assert os.path.exists(font_path), f"CRITICAL: DejaVuSans-Bold font does not exist at {font_path}"
    
    print(f"Verified font exists at: {font_path}")
    
    # Create a 1200x400 high-res image
    img = Image.new("RGB", (1200, 400), color="white")
    draw = ImageDraw.Draw(img)
    font = ImageFont.truetype(font_path, 72)
    draw.text((100, 150), "MANGALENS OCR TEST", fill="black", font=font)
    
    img_path = "/tmp/paddle_inference_fixture.png"
    img.save(img_path)
    
    # Print packages metadata
    try:
        print(f"paddleocr package version: {importlib.metadata.version('paddleocr')}")
        print(f"paddlepaddle package version: {importlib.metadata.version('paddlepaddle')}")
    except Exception as me:
        print(f"Could not load package metadata: {me}")
        
    # Default model path on linux is usually ~/.paddleocr
    model_dir = os.path.expanduser("~/.paddleocr")
    print(f"PaddleOCR active cache directory: {model_dir}")
    for label, pattern in {
        "Detector": os.path.join(model_dir, "whl", "det", "en", "*_det_infer"),
        "Recognizer": os.path.join(model_dir, "whl", "rec", "en", "*_rec_infer"),
        "Classifier": os.path.join(model_dir, "whl", "cls", "*_cls_infer"),
    }.items():
        matches = sorted(glob.glob(pattern))
        assert matches, f"{label} model cache missing: {pattern}"
        print(f"{label} model path: {matches[-1]}")
    
    # 2. Run standalone Paddle detection and recognition
    print("Before full PaddleOCR initialization", flush=True)
    ocr_det = PaddleOCR(use_angle_cls=True, lang="en", show_log=False)
    print("After full PaddleOCR initialization", flush=True)
    results = ocr_det.ocr(img_path, cls=True)
    
    print(f"Raw standalone results: {results}")
    
    assert results is not None, "PaddleOCR returned None"
    assert len(results) > 0, "PaddleOCR returned empty results"
    assert results[0] is not None, "PaddleOCR first page results is None"
    assert len(results[0]) > 0, "PaddleOCR detected 0 text regions"
    
    bbox, (text, conf) = results[0][0]
    
    # Print details as requested
    print(f"--- Standalone OCR Result ---")
    print(f"Text: {text}")
    print(f"Confidence: {conf}")
    print(f"Polygon: {bbox}")
    
    assert len(bbox) == 4, f"Returned polygon points != 4: {bbox}"
    assert len(text.strip()) > 0, "Recognized text is empty"
    assert isinstance(conf, (int, float)), f"Confidence score is not numeric: {type(conf)}"
    
    # Check text contains meaningful portion of the original text
    upper_text = text.upper()
    assert "MANGALENS" in upper_text or "OCR" in upper_text or "TEST" in upper_text, \
        f"Recognized text does not contain a meaningful portion of the expected text: '{text}'"
        
    print(f"  ✓ Standalone inference success: '{text}' ({conf:.4f})")
    
    # 3. Crop text region and run recognition-only mode
    img_cv = cv2.imread(img_path)
    crop_img = img_cv[100:300, 50:1100]
    
    print("Before recognition-only PaddleOCR initialization", flush=True)
    ocr_rec = PaddleOCR(use_angle_cls=True, lang="en", show_log=False, det=False, rec=True)
    print("After recognition-only PaddleOCR initialization", flush=True)
    res_rec = ocr_rec.ocr(crop_img, det=False, rec=True)
    
    print(f"Raw recognition-only results: {res_rec}")
    print(f"Recognition-only response shape: {describe_result_shape(res_rec)}")
    rec_text, rec_conf = parse_recognition_result(res_rec)
    
    print(f"--- Recognition-Only OCR Result ---")
    print(f"Text: {rec_text}")
    print(f"Confidence: {rec_conf}")
    print(f"Normalized text: {rec_text}")
    print(f"Normalized confidence: {rec_conf}")
    
    assert len(rec_text.strip()) > 0, "Recognition-only text is empty"
    upper_rec = rec_text.upper()
    assert "MANGALENS" in upper_rec or "OCR" in upper_rec or "TEST" in upper_rec, \
        f"Recognized text does not contain a meaningful portion of the expected text: '{rec_text}'"
        
    print(f"  ✓ Recognition-only success: '{rec_text}' ({rec_conf:.4f})")

    # Probe the pinned PaddleOCR 2.8.1 recognizer with a blank crop. CI must
    # confirm the exact sentinel before the service treats it as genuine empty
    # output; a changed shape is an explicit compatibility failure.
    blank_crop = np.full((200, 1050, 3), 255, dtype=np.uint8)
    blank_result = ocr_rec.ocr(blank_crop, det=False, rec=True)
    print(f"Raw blank recognition-only result: {blank_result}")
    print(f"Blank recognition-only response shape: {describe_result_shape(blank_result)}")
    assert is_genuine_empty_recognition_result(blank_result), (
        "PaddleOCR 2.8.1 blank-output shape changed; update the isolated "
        "empty-result helper and sentinel tests only after reviewing this "
        f"observed result: {blank_result!r}"
    )
    print("Blank probe produced PaddleOCR 2.8.1 genuine-empty sentinel")
    
    # Clean up
    if os.path.exists(img_path):
        os.remove(img_path)
        
    print("PaddleOCR runtime inference verification completed successfully!")
    sys.exit(0)

if __name__ == "__main__":
    main()
