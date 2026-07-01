#!/usr/bin/env python3
import sys
import traceback

def import_module_safe(module_name: str):
    print(f"Importing stage: {module_name}...")
    try:
        __import__(module_name)
    except Exception as e:
        print(f"\nCRITICAL: Import failure for module '{module_name}'")
        print("Traceback:")
        traceback.print_exc()
        sys.exit(1)

def main():
    print("Verifying that all manga_translator modules import from the source checkout...")
    
    # Import each module separately to capture distinct tracebacks
    import_module_safe("manga_translator")
    import_module_safe("manga_translator.config")
    import_module_safe("manga_translator.utils")
    import_module_safe("manga_translator.detection")
    import_module_safe("manga_translator.ocr")
    
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

if __name__ == "__main__":
    main()
