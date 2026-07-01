#!/usr/bin/env python3
import os
import sys
import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from paddleocr import PaddleOCR

def main():
    print("Running real PaddleOCR runtime inference verification...")
    # 1. Create a 1200x400 high-res image
    img = Image.new("RGB", (1200, 400), color="white")
    draw = ImageDraw.Draw(img)
    
    # Try DejaVuSans-Bold font
    font_paths = [
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
        "/usr/share/fonts/truetype/freefont/FreeSansBold.ttf"
    ]
    font_path = None
    for fp in font_paths:
        if os.path.exists(fp):
            font_path = fp
            break
            
    if font_path is None:
        print("CRITICAL: DejaVuSans-Bold or alternative bold font not found in standard paths.")
        sys.exit(1)
        
    print(f"Loading bold font from: {font_path}")
    font = ImageFont.truetype(font_path, 72)
    draw.text((100, 150), "MANGALENS OCR TEST", fill="black", font=font)
    
    img_path = "/tmp/paddle_inference_fixture.png"
    img.save(img_path)
    
    # 2. Run standalone Paddle detection and recognition
    ocr_det = PaddleOCR(use_angle_cls=True, lang="en", show_log=False)
    results = ocr_det.ocr(img_path, cls=True)
    
    print(f"Raw standalone results: {results}")
    
    assert results is not None, "PaddleOCR returned None"
    assert len(results) > 0, "PaddleOCR returned empty results"
    assert results[0] is not None, "PaddleOCR first page results is None"
    assert len(results[0]) > 0, "PaddleOCR detected 0 text regions"
    
    bbox, (text, conf) = results[0][0]
    assert len(bbox) == 4, f"Returned polygon points != 4: {bbox}"
    assert len(text.strip()) > 0, "Recognized text is empty"
    assert isinstance(conf, (int, float)), f"Confidence score is not numeric: {type(conf)}"
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
    assert len(rec_text.strip()) > 0, "Recognition-only text is empty"
    print(f"  ✓ Recognition-only success: '{rec_text}' ({rec_conf:.4f})")
    
    # Clean up
    if os.path.exists(img_path):
        os.remove(img_path)
        
    print("PaddleOCR runtime inference verification completed successfully!")
    sys.exit(0)

if __name__ == "__main__":
    main()
