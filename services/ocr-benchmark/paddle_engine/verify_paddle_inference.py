#!/usr/bin/env python3
import os
import sys
import importlib.metadata
import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from paddleocr import PaddleOCR

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
    
    # 2. Run standalone Paddle detection and recognition
    ocr_det = PaddleOCR(use_angle_cls=True, lang="en", show_log=False)
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
    
    ocr_rec = PaddleOCR(use_angle_cls=True, lang="en", show_log=False, det=False, rec=True)
    res_rec = ocr_rec.ocr(crop_img, det=False, rec=True)
    
    print(f"Raw recognition-only results: {res_rec}")
    assert res_rec is not None, "PaddleOCR rec-only returned None"
    assert len(res_rec) > 0, "PaddleOCR rec-only returned empty results"
    
    # Parse text
    first_res = res_rec[0]
    assert len(first_res) > 0, "PaddleOCR rec-only result has empty inner list"
    rec_text, rec_conf = first_res[0], first_res[1]
    
    print(f"--- Recognition-Only OCR Result ---")
    print(f"Text: {rec_text}")
    print(f"Confidence: {rec_conf}")
    
    assert len(rec_text.strip()) > 0, "Recognition-only text is empty"
    upper_rec = rec_text.upper()
    assert "MANGALENS" in upper_rec or "OCR" in upper_rec or "TEST" in upper_rec, \
        f"Recognized text does not contain a meaningful portion of the expected text: '{rec_text}'"
        
    print(f"  ✓ Recognition-only success: '{rec_text}' ({rec_conf:.4f})")
    
    # Clean up
    if os.path.exists(img_path):
        os.remove(img_path)
        
    print("PaddleOCR runtime inference verification completed successfully!")
    sys.exit(0)

if __name__ == "__main__":
    main()
