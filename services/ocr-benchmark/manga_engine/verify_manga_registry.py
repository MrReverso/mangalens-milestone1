#!/usr/bin/env python3
import sys

try:
    from manga_translator.config import Detector, Ocr
    from manga_translator.detection import DETECTORS
    from manga_translator.ocr import OCRS
    
    assert Detector.default in DETECTORS, "Detector.default not in DETECTORS"
    assert Detector.ctd in DETECTORS, "Detector.ctd not in DETECTORS"
    assert Detector.dbconvnext in DETECTORS, "Detector.dbconvnext not in DETECTORS"
    assert Ocr.ocr48px in OCRS, "Ocr.ocr48px not in OCRS"
    assert Ocr.mocr in OCRS, "Ocr.mocr not in OCRS"
    
    print("All manga registries verified successfully.")
    sys.exit(0)
except Exception as e:
    print(f"Registry verification failed: {e}")
    sys.exit(1)
