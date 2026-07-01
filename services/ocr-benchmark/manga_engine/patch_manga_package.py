#!/usr/bin/env python3
import os
import sys
import importlib.metadata

def main():
    print("Executing package patch to remove full-application imports for the OCR-only service...")
    try:
        import manga_translator
        init_path = manga_translator.__file__
        print(f"Located manga_translator package root: {init_path}")
    except ImportError as ie:
        print(f"CRITICAL: Failed to import manga_translator: {ie}")
        sys.exit(1)
        
    try:
        version = importlib.metadata.version("manga-image-translator")
        print(f"Installed manga-image-translator version: {version}")
    except Exception as e:
        print(f"Could not load package version metadata: {e}")
        
    if not os.path.exists(init_path):
        print(f"CRITICAL: File {init_path} does not exist.")
        sys.exit(1)
        
    with open(init_path, "r", encoding="utf-8") as f:
        lines = f.readlines()
        
    target_line = "from .manga_translator import *\n"
    found = False
    new_lines = []
    for line in lines:
        if line == target_line:
            found = True
            print("Found target wildcard import line: 'from .manga_translator import *'")
        else:
            new_lines.append(line)
            
    if not found:
        print(f"CRITICAL: Expected wildcard import line '{target_line.strip()}' not found in {init_path}.")
        sys.exit(1)
        
    with open(init_path, "w", encoding="utf-8") as f:
        f.writelines(new_lines)
        
    print(f"Successfully patched {init_path}. Removed wildcard imports to prevent loading full-application dependencies.")
    sys.exit(0)

if __name__ == "__main__":
    main()
