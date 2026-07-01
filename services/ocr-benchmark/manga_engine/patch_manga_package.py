#!/usr/bin/env python3
import os
import sys
import hashlib
import tempfile

def get_file_sha256(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        h.update(f.read())
    return h.hexdigest()

def patch_package_root(init_path: str) -> tuple[str, str, str]:
    sha_before = get_file_sha256(init_path)
    
    with open(init_path, "r", encoding="utf-8") as f:
        lines = f.readlines()
        
    target_line = "from .manga_translator import *\n"
    occurrences = sum(1 for line in lines if line == target_line)
    if occurrences == 0:
        raise ValueError(f"Wildcard import line '{target_line.strip()}' not found in {init_path}.")
    if occurrences > 1:
        raise ValueError(f"Wildcard import line '{target_line.strip()}' occurs {occurrences} times (expected exactly 1).")
        
    new_lines = [line for line in lines if line != target_line]
    
    with open(init_path, "w", encoding="utf-8") as f:
        f.writelines(new_lines)
        
    sha_after = get_file_sha256(init_path)
    
    # Assert wildcard line is gone
    with open(init_path, "r", encoding="utf-8") as f:
        content = f.read()
    assert target_line not in content, "Wildcard line still present after patch."
    
    return sha_before, sha_after, target_line

def patch_detection_init(detection_path: str) -> tuple[str, str, str]:
    sha_before = get_file_sha256(detection_path)
    
    with open(detection_path, "r", encoding="utf-8") as f:
        lines = f.readlines()
        
    target_import = "from .paddle_rust import PaddleDetector"
    target_registry = "Detector.paddle: PaddleDetector,"
    
    import_occurrences = sum(1 for line in lines if target_import in line)
    registry_occurrences = sum(1 for line in lines if target_registry in line)
    
    if import_occurrences != 1:
        raise ValueError(f"Target import '{target_import}' occurs {import_occurrences} times (expected exactly 1) in {detection_path}.")
    if registry_occurrences != 1:
        raise ValueError(f"Target registry '{target_registry}' occurs {registry_occurrences} times (expected exactly 1) in {detection_path}.")
        
    new_lines = []
    removed_lines = []
    for line in lines:
        if target_import in line or target_registry in line:
            removed_lines.append(line.strip())
        else:
            new_lines.append(line)
            
    with open(detection_path, "w", encoding="utf-8") as f:
        f.writelines(new_lines)
        
    sha_after = get_file_sha256(detection_path)
    
    # Assert lines are gone
    with open(detection_path, "r", encoding="utf-8") as f:
        content = f.read()
    assert target_import not in content, "Target import still present after patch."
    assert target_registry not in content, "Target registry still present after patch."
    
    return sha_before, sha_after, " | ".join(removed_lines)

# Lightweight unit tests
def run_unit_tests():
    print("Running patch script tests on temporary fake package...")
    
    # Test Root Init patch
    fake_init_content = "import colorama\nfrom .manga_translator import *\nimport dotenv\n"
    with tempfile.NamedTemporaryFile(mode="w+", suffix=".py", delete=False) as tmp:
        tmp.write(fake_init_content)
        tmp_path = tmp.name
    try:
        sb, sa, removed = patch_package_root(tmp_path)
        assert sb != sa
        with open(tmp_path, "r", encoding="utf-8") as f:
            content = f.read()
        assert "from .manga_translator import *" not in content
        assert "import colorama\n" in content
        print("  ✓ Fake package root init patch OK")
    finally:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)
            
    # Test Detection Init patch
    fake_det_content = (
        "from .ctd import ComicTextDetector\n"
        "from .paddle_rust import PaddleDetector\n"
        "class Detector:\n"
        "    Detector.ctd: ComicTextDetector,\n"
        "    Detector.paddle: PaddleDetector,\n"
    )
    with tempfile.NamedTemporaryFile(mode="w+", suffix=".py", delete=False) as tmp:
        tmp.write(fake_det_content)
        tmp_path = tmp.name
    try:
        sb, sa, removed = patch_detection_init(tmp_path)
        assert sb != sa
        with open(tmp_path, "r", encoding="utf-8") as f:
            content = f.read()
        assert "from .paddle_rust import PaddleDetector" not in content
        assert "Detector.paddle: PaddleDetector," not in content
        assert "from .ctd import ComicTextDetector\n" in content
        print("  ✓ Fake detection init patch OK")
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
    run_unit_tests()
    
    if len(sys.argv) < 2:
        print("CRITICAL: Target file path to patch must be provided as an argument.")
        sys.exit(1)
        
    target_path = os.path.abspath(sys.argv[1])
    print(f"Target path: {target_path}")
    
    if not os.path.exists(target_path):
        print(f"CRITICAL: File {target_path} does not exist.")
        sys.exit(1)
        
    # Decide patch function based on filename/path content
    try:
        if target_path.endswith("detection/__init__.py") or target_path.endswith("detection/init.py"):
            print("Applying detection/__init__.py patch (excluding Paddle Rust)...")
            sb, sa, removed = patch_detection_init(target_path)
        elif target_path.endswith("__init__.py") or target_path.endswith("init.py"):
            print("Applying package root __init__.py patch (wildcard import removal)...")
            sb, sa, removed = patch_package_root(target_path)
        else:
            print(f"CRITICAL: Unknown target path structure for patching: {target_path}")
            sys.exit(1)
            
        print("\n=== PATCH SUCCESSFUL ===")
        print(f"Target Path:       {target_path}")
        print(f"SHA-256 Before:    {sb}")
        print(f"SHA-256 After:     {sa}")
        print(f"Exact Removed:     {removed}")
    except Exception as e:
        print(f"CRITICAL: Patch execution failed: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()
