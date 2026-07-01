#!/usr/bin/env python3
import os
import sys
import hashlib
import tempfile

TARGET_LINE = "from .manga_translator import *\n"

def patch_init_file(init_path: str) -> tuple[str, str, str]:
    if not os.path.exists(init_path):
        raise FileNotFoundError(f"File {init_path} does not exist.")
        
    # Calculate sha256 before patching
    sha_before = hashlib.sha256()
    with open(init_path, "rb") as f:
        content_bytes = f.read()
        sha_before.update(content_bytes)
    sha_before_hex = sha_before.hexdigest()
    
    # Read text content
    with open(init_path, "r", encoding="utf-8") as f:
        lines = f.readlines()
        
    # Verify exact occurrence count of target wildcard import line
    occurrences = sum(1 for line in lines if line == TARGET_LINE)
    if occurrences == 0:
        raise ValueError(f"Wildcard import line '{TARGET_LINE.strip()}' not found in {init_path}.")
    if occurrences > 1:
        raise ValueError(f"Wildcard import line '{TARGET_LINE.strip()}' occurs {occurrences} times (expected exactly 1) in {init_path}.")
        
    # Filter out target line
    new_lines = [line for line in lines if line != TARGET_LINE]
    
    # Write back patched content
    with open(init_path, "w", encoding="utf-8") as f:
        f.writelines(new_lines)
        
    # Calculate sha256 after patching
    sha_after = hashlib.sha256()
    with open(init_path, "rb") as f:
        content_bytes_after = f.read()
        sha_after.update(content_bytes_after)
    sha_after_hex = sha_after.hexdigest()
    
    # Read back and assert wildcard line is gone
    with open(init_path, "r", encoding="utf-8") as f:
        reread_content = f.read()
    assert TARGET_LINE not in reread_content, "Assertion failed: Wildcard import line still present after patching."
    
    return sha_before_hex, sha_after_hex, TARGET_LINE

def test_patch_init_file():
    print("Running patch script tests on temporary fake package...")
    
    fake_content = (
        "import colorama\n"
        "from .manga_translator import *\n"
        "import dotenv\n"
    )
    
    # Test successful patch
    with tempfile.NamedTemporaryFile(mode="w+", suffix=".py", delete=False) as tmp:
        tmp.write(fake_content)
        tmp_path = tmp.name
        
    try:
        sha_b, sha_a, removed = patch_init_file(tmp_path)
        assert sha_b != sha_a, "Hash did not change after patching"
        assert removed == TARGET_LINE
        
        with open(tmp_path, "r", encoding="utf-8") as f:
            content = f.read()
        assert "import colorama\n" in content
        assert "import dotenv\n" in content
        assert TARGET_LINE not in content
        print("  ✓ Test success case OK")
    finally:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)
            
    # Test zero occurrences failure
    fake_content_zero = (
        "import colorama\n"
        "import dotenv\n"
    )
    with tempfile.NamedTemporaryFile(mode="w+", suffix=".py", delete=False) as tmp:
        tmp.write(fake_content_zero)
        tmp_path = tmp.name
        
    try:
        with pytest_raises(ValueError):
            patch_init_file(tmp_path)
        print("  ✓ Test zero occurrences fails OK")
    finally:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)
            
    # Test duplicate occurrences failure
    fake_content_dup = (
        "import colorama\n"
        "from .manga_translator import *\n"
        "import dotenv\n"
        "from .manga_translator import *\n"
    )
    with tempfile.NamedTemporaryFile(mode="w+", suffix=".py", delete=False) as tmp:
        tmp.write(fake_content_dup)
        tmp_path = tmp.name
        
    try:
        with pytest_raises(ValueError):
            patch_init_file(tmp_path)
        print("  ✓ Test duplicate occurrences fails OK")
    finally:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)
            
    print("All lightweight tests passed successfully.")

# Custom context manager to mimic pytest.raises
class pytest_raises:
    def __init__(self, expected_exception):
        self.expected_exception = expected_exception
    def __enter__(self):
        return self
    def __exit__(self, exc_type, exc_val, exc_tb):
        if exc_type is None:
            raise AssertionError(f"Expected exception {self.expected_exception.__name__} not raised.")
        if not issubclass(exc_type, self.expected_exception):
            raise AssertionError(f"Expected exception {self.expected_exception.__name__}, got {exc_type.__name__}.")
        return True

def main():
    # 1. Run local tests
    test_patch_init_file()
    
    # 2. Parse command line target path
    if len(sys.argv) < 2:
        print("CRITICAL: Target path to __init__.py must be provided as an argument.")
        sys.exit(1)
        
    init_path_str = os.path.abspath(sys.argv[1])
    print(f"Target path for patching: {init_path_str}")
    
    if not os.path.exists(init_path_str):
        print(f"CRITICAL: File {init_path_str} does not exist on disk.")
        sys.exit(1)
        
    try:
        sha_b, sha_a, removed = patch_init_file(init_path_str)
        print("\n=== PATCH SUCCESSFUL ===")
        print(f"Target Path:       {init_path_str}")
        print(f"SHA-256 Before:    {sha_b}")
        print(f"SHA-256 After:     {sha_a}")
        print(f"Exact Removed Line: {repr(removed)}")
    except Exception as e:
        print(f"CRITICAL: Patch execution failed: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()
