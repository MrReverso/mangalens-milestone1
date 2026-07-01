#!/usr/bin/env python3
import sys
import traceback

def main():
    print("Executing strict import-closure verification test...")
    try:
        # Import the exact modules used in app.py
        import manga_translator
        import manga_translator.config
        import manga_translator.utils
        import manga_translator.detection
        import manga_translator.ocr
        
        # Verify no forbidden modules are in sys.modules
        forbidden_keywords = [
            "translation_provider", "translator.translators", 
            "inpainting", "upscaling", "rendering", "renderer",
            "rusty_manga_image_translator", "paddle_rust"
        ]
        
        failed = False
        loaded_forbidden = []
        for mod_name in list(sys.modules.keys()):
            for keyword in forbidden_keywords:
                if keyword in mod_name:
                    loaded_forbidden.append((mod_name, sys.modules[mod_name]))
                    failed = True
                    
        if failed:
            print("\nCRITICAL FAILURE: Forbidden modules were loaded in import closure:")
            for name, mod in loaded_forbidden:
                path = getattr(mod, "__file__", "builtin")
                print(f"  Forbidden: {name:<35} Path: {path}")
            sys.exit(1)
            
        print("\nImport closure is completely clean!")
        sys.exit(0)
    except Exception as e:
        print(f"\nCRITICAL: Import closure test failed with exception: {e}")
        traceback.print_exc()
        sys.exit(1)

if __name__ == "__main__":
    main()
