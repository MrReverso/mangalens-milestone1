#!/usr/bin/env python3
import sys
import traceback

def main():
    print("Verifying that all manga_translator modules import from the source checkout...")
    try:
        import manga_translator
        import manga_translator.config
        import manga_translator.utils
        import manga_translator.detection
        import manga_translator.ocr
        
        modules = [
            manga_translator,
            manga_translator.config,
            manga_translator.utils,
            manga_translator.detection,
            manga_translator.ocr,
        ]
        
        expected_prefix = "/opt/manga-image-translator/"
        
        print("\n=== Resolved Modules ===")
        for module in modules:
            name = module.__name__
            path = getattr(module, "__file__", "None")
            print(f"Module: {name:<25} Path: {path}")
            
            assert path.startswith(expected_prefix), \
                f"CRITICAL: Module {name} resolved to {path}, which does not begin with expected prefix: {expected_prefix}"
                
        print("\nAll source imports verified successfully!")
        sys.exit(0)
    except Exception as e:
        print(f"\nCRITICAL: Source import verification failed: {e}")
        print("Traceback:")
        traceback.print_exc()
        sys.exit(1)

if __name__ == "__main__":
    main()
