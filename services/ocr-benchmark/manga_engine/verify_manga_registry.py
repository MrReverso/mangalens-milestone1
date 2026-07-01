#!/usr/bin/env python3
import sys
import os
import traceback

def run_stage(stage_num, description, func):
    print(f"\n--- Stage {stage_num}: {description} ---")
    try:
        func()
        print(f"  ✓ Stage {stage_num} OK")
    except Exception as e:
        print(f"CRITICAL: Stage {stage_num} failed during: {description}")
        print(f"Error class: {type(e).__name__}")
        print(f"Error message: {e}")
        print("\nTraceback:")
        traceback.print_exc()
        
        # Diagnostics
        print("\n=== DIAGNOSTICS ===")
        print(f"Python Version: {sys.version}")
        try:
            import manga_translator
            print(f"manga_translator package root: {os.path.dirname(manga_translator.__file__)}")
        except ImportError:
            print("manga_translator package could not be imported.")
        except Exception as ex:
            print(f"Failed to gather package metadata: {ex}")
        print(f"sys.path: {sys.path}")
        sys.exit(1)

def stage_package_root():
    import manga_translator
    print(f"  Resolved module: {manga_translator.__name__} at {manga_translator.__file__}")
    
def stage_config():
    import manga_translator.config
    print(f"  Resolved module: {manga_translator.config.__name__} at {manga_translator.config.__file__}")
    
def stage_utils():
    import manga_translator.utils
    print(f"  Resolved module: {manga_translator.utils.__name__} at {manga_translator.utils.__file__}")
    
def stage_detection():
    import manga_translator.detection
    print(f"  Resolved module: {manga_translator.detection.__name__} at {manga_translator.detection.__file__}")
    
def stage_ocr():
    import manga_translator.ocr
    print(f"  Resolved module: {manga_translator.ocr.__name__} at {manga_translator.ocr.__file__}")
    
def stage_detector_assertions():
    from manga_translator.config import Detector
    from manga_translator.detection import DETECTORS
    assert Detector.default in DETECTORS, "Detector.default not in DETECTORS"
    assert Detector.ctd in DETECTORS, "Detector.ctd not in DETECTORS"
    assert Detector.dbconvnext in DETECTORS, "Detector.dbconvnext not in DETECTORS"
    print(f"  Verified detectors: default, ctd, dbconvnext present in registry")

def stage_ocr_assertions():
    from manga_translator.config import Ocr
    from manga_translator.ocr import OCRS
    assert Ocr.ocr48px in OCRS, "Ocr.ocr48px not in OCRS"
    assert Ocr.mocr in OCRS, "Ocr.mocr not in OCRS"
    print(f"  Verified OCRs: ocr48px, mocr present in registry")

def main():
    print("Starting detailed Manga Engine registry verification...")
    run_stage(1, "manga_translator package-root import", stage_package_root)
    run_stage(2, "manga_translator.config import", stage_config)
    run_stage(3, "manga_translator.utils import", stage_utils)
    run_stage(4, "manga_translator.detection import", stage_detection)
    run_stage(5, "manga_translator.ocr import", stage_ocr)
    run_stage(6, "Detector registry assertions", stage_detector_assertions)
    run_stage(7, "OCR registry assertions", stage_ocr_assertions)
    print("\nAll manga registries verified successfully!")
    sys.exit(0)

if __name__ == "__main__":
    main()
