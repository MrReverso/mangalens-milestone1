#!/usr/bin/env python3
import os
import sys
import time
import json
import asyncio
import argparse
import traceback
import platform
import subprocess
import importlib.metadata
from abc import ABC, abstractmethod
from typing import List, Dict, Any, Tuple, Optional

# Attempt imports for deep learning and OCR libraries
try:
    import cv2
    import numpy as np
    from PIL import Image, ImageDraw, ImageFont
except ImportError:
    cv2 = None
    np = None
    Image = None
    ImageDraw = None
    ImageFont = None

try:
    import torch
except ImportError:
    torch = None

try:
    import psutil
except ImportError:
    psutil = None

try:
    from paddleocr import PaddleOCR
except ImportError:
    PaddleOCR = None

try:
    import manga_ocr
except ImportError:
    manga_ocr = None

# Attempt manga-image-translator imports
try:
    from manga_translator.config import Detector, Ocr, DetectorConfig, OcrConfig
    from manga_translator.detection import dispatch as dispatch_detection, DETECTORS
    from manga_translator.ocr import dispatch as dispatch_ocr, OCRS
    from manga_translator.utils import Quadrilateral
    HAS_MANGA_TRANSLATOR = True
except ImportError:
    Detector = None
    Ocr = None
    DetectorConfig = None
    OcrConfig = None
    dispatch_detection = None
    dispatch_ocr = None
    Quadrilateral = None
    DETECTORS = {}
    OCRS = {}
    HAS_MANGA_TRANSLATOR = False


# Caching recognizer engines to avoid re-initialization overhead
paddle_recognizers = {}

def get_paddle_recognizer(language: str) -> Optional[PaddleOCR]:
    if not PaddleOCR:
        return None
    
    paddle_lang = "en"
    if language == "ko":
        paddle_lang = "korean"
    elif language == "ja":
        paddle_lang = "japan"
    elif language == "en":
        paddle_lang = "en"
        
    cache_key = (paddle_lang, "rec")
    if cache_key not in paddle_recognizers:
        paddle_recognizers[cache_key] = PaddleOCR(
            use_angle_cls=True, 
            lang=paddle_lang, 
            show_log=False, 
            det=False,  # Recognition only!
            rec=True
        )
    return paddle_recognizers[cache_key]


def parse_paddle_rec_result(res) -> Tuple[str, float]:
    if not res:
        return "", 0.0
    try:
        first = res[0]
        if isinstance(first, list) and len(first) > 0:
            item = first[0]
            if isinstance(item, list) or isinstance(item, tuple):
                text = str(item[0])
                conf = float(item[1])
                return text, conf
            elif isinstance(item, str):
                text = item
                conf = float(first[1]) if len(first) > 1 else 0.0
                return text, conf
        elif isinstance(first, tuple) or isinstance(first, list):
            text = str(first[0])
            conf = float(first[1])
            return text, conf
    except Exception:
        pass
    return "", 0.0


class OcrEngine(ABC):
    @property
    @abstractmethod
    def name(self) -> str:
        pass

    @abstractmethod
    async def process(self, image_path: str, language: str) -> Dict[str, Any]:
        pass


def get_package_version(name: str) -> str:
    try:
        return importlib.metadata.version(name)
    except importlib.metadata.PackageNotFoundError:
        return "Not installed"


def get_cpu_brand() -> str:
    try:
        if platform.system() == "Darwin":
            return subprocess.check_output(["sysctl", "-n", "machdep.cpu.brand_string"]).decode("utf-8").strip()
        elif platform.system() == "Linux":
            with open("/proc/cpuinfo", "r") as f:
                for line in f:
                    if "model name" in line:
                        return line.split(":")[1].strip()
        return platform.processor()
    except Exception:
        return platform.processor() or "Unknown CPU"


def get_model_sizes_on_disk() -> Dict[str, str]:
    paths = {
        "paddleocr": os.path.expanduser("~/.paddleocr"),
        "manga-ocr": os.path.expanduser("~/.cache/huggingface/hub/models--kha-white--manga-ocr"),
        "manga-image-translator": os.path.expanduser("~/.manga_translator/models"),
    }
    sizes = {}
    for name, path_dir in paths.items():
        if os.path.exists(path_dir):
            total_size = 0
            for dirpath, dirnames, filenames in os.walk(path_dir):
                for f in filenames:
                    fp = os.path.join(dirpath, f)
                    if os.path.exists(fp):
                        total_size += os.path.getsize(fp)
            sizes[name] = f"{total_size / (1024 * 1024):.1f} MB"
        else:
            sizes[name] = "0 MB (not cached)"
    return sizes


def get_memory_usage() -> Tuple[float, float]:
    cpu_mem = 0.0
    gpu_mem = 0.0
    if psutil:
        process = psutil.Process(os.getpid())
        cpu_mem = process.memory_info().rss / (1024 * 1024)
    if torch and torch.cuda.is_available():
        gpu_mem = torch.cuda.memory_allocated() / (1024 * 1024)
    return cpu_mem, gpu_mem


def get_optimal_device() -> str:
    if torch and torch.cuda.is_available():
        return "cuda"
    elif torch and hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
        return "mps"
    return "cpu"


def check_engines(engines_str: str):
    print("=== STARTING STRICT ENGINE INSTALLATION CHECKS ===")
    requested = [e.strip() for e in engines_str.split(",")]
    
    missing_deps = []
    
    for req in requested:
        if req == "paddle":
            print("Checking Standalone PaddleOCR requirements...")
            try:
                import paddle
                print(f"  ✓ paddlepaddle imported successfully. Version: {get_package_version('paddlepaddle')}")
            except ImportError as e:
                print(f"  ✗ Failed to import paddlepaddle: {e}")
                missing_deps.append("paddlepaddle")
            try:
                import paddleocr
                print(f"  ✓ paddleocr imported successfully. Version: {get_package_version('paddleocr')}")
            except ImportError as e:
                print(f"  ✗ Failed to import paddleocr: {e}")
                missing_deps.append("paddleocr")
                
        elif req in ["ctd", "dbconvnext", "default"]:
            print(f"Checking manga-image-translator ({req}) requirements...")
            if not HAS_MANGA_TRANSLATOR:
                print("  ✗ Failed to import manga_translator package.")
                missing_deps.append("manga-image-translator")
            else:
                print(f"  ✓ manga_translator imported successfully. Version: {get_package_version('manga-image-translator')}")
                if Detector.default not in DETECTORS:
                    print("  ✗ Registry does not contain Detector.default")
                    missing_deps.append("manga_translator.DETECTORS[default]")
                if Detector.ctd not in DETECTORS:
                    print("  ✗ Registry does not contain Detector.ctd")
                    missing_deps.append("manga_translator.DETECTORS[ctd]")
                if Detector.dbconvnext not in DETECTORS:
                    print("  ✗ Registry does not contain Detector.dbconvnext")
                    missing_deps.append("manga_translator.DETECTORS[dbconvnext]")
                print("  ✓ manga_translator detector registries verified.")
                
            try:
                import manga_ocr
                print(f"  ✓ manga-ocr imported successfully. Version: {get_package_version('manga-ocr')}")
            except ImportError as e:
                print(f"  ✗ Failed to import manga-ocr: {e}")
                missing_deps.append("manga-ocr")

    if missing_deps:
        print("\nCRITICAL: One or more requested engines failed strict installation checks.")
        print(f"Missing or broken dependencies: {', '.join(missing_deps)}")
        sys.exit(1)
        
    print("\n=== ALL STRICT ENGINE CHECKS COMPLETED SUCCESSFULY ===")
    sys.exit(0)


def generate_mock_regions(width: int, height: int, language: str) -> List[Dict[str, Any]]:
    regions = []
    
    if language == "ko":
        texts = ["무엇을요?", "지금 출발해야 합니다.", "저기 보이는 것이 무엇인가요?"]
    elif language == "ja":
        texts = ["本当に大丈夫？", "何か用ですか？", "여기서 기다려 주세요."]
    else:
        texts = ["Where are we going?", "We need to leave before sunset.", "Let's check that direction!"]

    r1_x, r1_y = int(width * 0.15), int(height * 0.1)
    r1_w, r1_h = int(width * 0.3), int(height * 0.15)
    regions.append({
        "id": "region_1",
        "polygon": {
            "points": [
                {"x": r1_x, "y": r1_y},
                {"x": r1_x + r1_w, "y": r1_y},
                {"x": r1_x + r1_w, "y": r1_y + r1_h},
                {"x": r1_x, "y": r1_y + r1_h}
            ]
        },
        "boundingBox": {"x": r1_x, "y": r1_y, "width": r1_w, "height": r1_h},
        "text": texts[0],
        "confidence": 0.95,
        "orientation": "horizontal",
        "detector": "mock-detector",
        "recognizer": "mock-recognizer",
        "detectorVersion": "0.1.0",
        "recognizerVersion": "0.1.0"
    })

    r2_x, r2_y = int(width * 0.55), int(height * 0.5)
    r2_w, r2_h = int(width * 0.25), int(height * 0.25)
    regions.append({
        "id": "region_2",
        "polygon": {
            "points": [
                {"x": r2_x + int(r2_w / 2), "y": r2_y},
                {"x": r2_x + r2_w, "y": r2_y + int(r2_h / 2)},
                {"x": r2_x + int(r2_w / 2), "y": r2_y + r2_h},
                {"x": r2_x, "y": r2_y + int(r2_h / 2)}
            ]
        },
        "boundingBox": {"x": r2_x, "y": r2_y, "width": r2_w, "height": r2_h},
        "text": texts[1],
        "confidence": 0.88,
        "orientation": "vertical" if language in ["ja", "ko"] else "horizontal",
        "detector": "mock-detector",
        "recognizer": "mock-recognizer",
        "detectorVersion": "0.1.0",
        "recognizerVersion": "0.1.0"
    })

    return regions


# Pipeline A: manga-image-translator default detector + default OCR (ocr48px)
class PipelineAEngine(OcrEngine):
    @property
    def name(self) -> str:
        return "manga-image-translator-default"

    async def process(self, image_path: str, language: str) -> Dict[str, Any]:
        start_time = time.time()
        errors = []
        regions_result = []
        
        commit_sha = "efdc229de8aa0f3d4051ad97664adc62dd5ac605"
        version_str = get_package_version("manga-image-translator")
        device_str = get_optimal_device()

        if not HAS_MANGA_TRANSLATOR or not cv2:
            return {
                "engine": self.name,
                "status": "unavailable",
                "synthetic": False,
                "engineVersion": version_str,
                "engineCommit": commit_sha,
                "device": device_str,
                "regions": [],
                "errors": ["manga-image-translator is not installed in the environment."],
                "processingTimeMs": 0,
                "imageWidth": 0,
                "imageHeight": 0
            }

        try:
            img = cv2.imread(image_path)
            if img is None:
                raise ValueError(f"Image could not be loaded: {image_path}")
            height, width, _ = img.shape

            detected_regions, raw_mask, mask = await dispatch_detection(
                detector_key=Detector.default,
                image=img,
                detect_size=2048,
                text_threshold=0.5,
                box_threshold=0.7,
                unclip_ratio=2.3,
                invert=False,
                gamma_correct=False,
                rotate=False,
                auto_rotate=False,
                device=device_str,
                verbose=False
            )

            config = OcrConfig(ocr=Ocr.ocr48px)
            ocr_regions = await dispatch_ocr(
                ocr_key=Ocr.ocr48px,
                image=img,
                regions=detected_regions,
                config=config,
                device=device_str,
                verbose=False
            )

            for idx, r in enumerate(ocr_regions):
                if not r.text or not r.text.strip():
                    continue

                pts = [{"x": float(p[0]), "y": float(p[1])} for p in r.pts]
                x = int(r.aabb.x)
                y = int(r.aabb.y)
                w_box = int(r.aabb.w)
                h_box = int(r.aabb.h)

                regions_result.append({
                    "id": f"region_{idx + 1}",
                    "polygon": {"points": pts},
                    "boundingBox": {"x": x, "y": y, "width": w_box, "height": h_box},
                    "text": r.text.strip(),
                    "confidence": float(r.prob) if getattr(r, "prob", None) is not None else None,
                    "orientation": r.direction if getattr(r, "direction", None) in ["horizontal", "vertical", "unknown"] else "unknown",
                    "detector": "default",
                    "recognizer": "ocr48px",
                    "detectorVersion": version_str,
                    "recognizerVersion": version_str
                })

            status = "success" if regions_result else "no_text"
        except Exception as e:
            errors.append(f"Runtime error: {str(e)}")
            errors.append(traceback.format_exc())
            status = "failed"

        processing_time_ms = int((time.time() - start_time) * 1000)
        return {
            "engine": self.name,
            "status": status,
            "synthetic": False,
            "engineVersion": version_str,
            "engineCommit": commit_sha,
            "device": device_str,
            "regions": regions_result,
            "errors": errors,
            "processingTimeMs": processing_time_ms,
            "imageWidth": width if cv2 and img is not None else 0,
            "imageHeight": height if cv2 and img is not None else 0
        }


# Pipeline B: CTD detector + Japanese OCR (mocr) / standalone PaddleOCR recognition (KO / EN)
class PipelineBEngine(OcrEngine):
    @property
    def name(self) -> str:
        return "manga-image-translator-ctd"

    async def process(self, image_path: str, language: str) -> Dict[str, Any]:
        start_time = time.time()
        errors = []
        regions_result = []
        
        commit_sha = "efdc229de8aa0f3d4051ad97664adc62dd5ac605"
        version_str = get_package_version("manga-image-translator")
        device_str = get_optimal_device()

        if not HAS_MANGA_TRANSLATOR or not cv2:
            return {
                "engine": self.name,
                "status": "unavailable",
                "synthetic": False,
                "engineVersion": version_str,
                "engineCommit": commit_sha,
                "device": device_str,
                "regions": [],
                "errors": ["manga-image-translator is not installed in the environment."],
                "processingTimeMs": 0,
                "imageWidth": 0,
                "imageHeight": 0
            }

        try:
            img = cv2.imread(image_path)
            if img is None:
                raise ValueError(f"Image could not be loaded: {image_path}")
            height, width, _ = img.shape

            detected_regions, raw_mask, mask = await dispatch_detection(
                detector_key=Detector.ctd,
                image=img,
                detect_size=2048,
                text_threshold=0.5,
                box_threshold=0.7,
                unclip_ratio=2.3,
                invert=False,
                gamma_correct=False,
                rotate=False,
                auto_rotate=False,
                device=device_str,
                verbose=False
            )

            if language == "ja":
                # Use manga-ocr (mocr) for Japanese
                config = OcrConfig(ocr=Ocr.mocr)
                ocr_regions = await dispatch_ocr(
                    ocr_key=Ocr.mocr,
                    image=img,
                    regions=detected_regions,
                    config=config,
                    device=device_str,
                    verbose=False
                )

                for idx, r in enumerate(ocr_regions):
                    if not r.text or not r.text.strip():
                        continue

                    pts = [{"x": float(p[0]), "y": float(p[1])} for p in r.pts]
                    x = int(r.aabb.x)
                    y = int(r.aabb.y)
                    w_box = int(r.aabb.w)
                    h_box = int(r.aabb.h)

                    regions_result.append({
                        "id": f"region_{idx + 1}",
                        "polygon": {"points": pts},
                        "boundingBox": {"x": x, "y": y, "width": w_box, "height": h_box},
                        "text": r.text.strip(),
                        "confidence": float(r.prob) if getattr(r, "prob", None) is not None else None,
                        "orientation": r.direction if getattr(r, "direction", None) in ["horizontal", "vertical", "unknown"] else "unknown",
                        "detector": "ctd",
                        "recognizer": "manga-ocr",
                        "detectorVersion": version_str,
                        "recognizerVersion": get_package_version("manga-ocr")
                    })
            else:
                # Use PaddleOCR recognition for non-Japanese
                paddle_ocr_engine = get_paddle_recognizer(language)
                if paddle_ocr_engine is None:
                    raise ImportError("paddleocr package is not available for recognition-only execution.")

                for idx, r in enumerate(detected_regions):
                    try:
                        crop_img = r.get_transformed_region(img, r.direction, 48)
                    except Exception:
                        x, y, w, h = int(r.aabb.x), int(r.aabb.y), int(r.aabb.w), int(r.aabb.h)
                        x = max(0, min(x, img.shape[1] - 1))
                        y = max(0, min(y, img.shape[0] - 1))
                        w = max(1, min(w, img.shape[1] - x))
                        h = max(1, min(h, img.shape[0] - y))
                        crop_img = img[y:y+h, x:x+w]

                    # Standalone PaddleOCR recognition-only API
                    res_ocr = paddle_ocr_engine.ocr(crop_img, det=False, rec=True)
                    text, conf = parse_paddle_rec_result(res_ocr)

                    if not text or not text.strip():
                        continue

                    pts = [{"x": float(p[0]), "y": float(p[1])} for p in r.pts]
                    x = int(r.aabb.x)
                    y = int(r.aabb.y)
                    w_box = int(r.aabb.w)
                    h_box = int(r.aabb.h)

                    regions_result.append({
                        "id": f"region_{idx + 1}",
                        "polygon": {"points": pts},
                        "boundingBox": {"x": x, "y": y, "width": w_box, "height": h_box},
                        "text": text.strip(),
                        "confidence": conf,
                        "orientation": r.direction if getattr(r, "direction", None) in ["horizontal", "vertical", "unknown"] else "unknown",
                        "detector": "ctd",
                        "recognizer": f"paddleocr-{language}",
                        "detectorVersion": version_str,
                        "recognizerVersion": get_package_version("paddleocr")
                    })

            status = "success" if regions_result else "no_text"
        except Exception as e:
            errors.append(f"Runtime error: {str(e)}")
            errors.append(traceback.format_exc())
            status = "failed"

        processing_time_ms = int((time.time() - start_time) * 1000)
        return {
            "engine": self.name,
            "status": status,
            "synthetic": False,
            "engineVersion": version_str,
            "engineCommit": commit_sha,
            "device": device_str,
            "regions": regions_result,
            "errors": errors,
            "processingTimeMs": processing_time_ms,
            "imageWidth": width if cv2 and img is not None else 0,
            "imageHeight": height if cv2 and img is not None else 0
        }


# Pipeline C: DBConvNext detector + Japanese OCR (mocr) / standalone PaddleOCR recognition (KO / EN)
class PipelineCEngine(OcrEngine):
    @property
    def name(self) -> str:
        return "dbnet-mangaocr-paddleocr"

    async def process(self, image_path: str, language: str) -> Dict[str, Any]:
        start_time = time.time()
        errors = []
        regions_result = []
        
        commit_sha = "efdc229de8aa0f3d4051ad97664adc62dd5ac605"
        version_str = get_package_version("manga-image-translator")
        device_str = get_optimal_device()

        if not HAS_MANGA_TRANSLATOR or not cv2:
            return {
                "engine": self.name,
                "status": "unavailable",
                "synthetic": False,
                "engineVersion": version_str,
                "engineCommit": commit_sha,
                "device": device_str,
                "regions": [],
                "errors": ["manga-image-translator is not installed in the environment."],
                "processingTimeMs": 0,
                "imageWidth": 0,
                "imageHeight": 0
            }

        try:
            img = cv2.imread(image_path)
            if img is None:
                raise ValueError(f"Image could not be loaded: {image_path}")
            height, width, _ = img.shape

            detector_key = Detector.dbconvnext
            try:
                detected_regions, raw_mask, mask = await dispatch_detection(
                    detector_key=detector_key,
                    image=img,
                    detect_size=2048,
                    text_threshold=0.5,
                    box_threshold=0.7,
                    unclip_ratio=2.3,
                    invert=False,
                    gamma_correct=False,
                    rotate=False,
                    auto_rotate=False,
                    device=device_str,
                    verbose=False
                )
            except Exception:
                detector_key = Detector.default
                detected_regions, raw_mask, mask = await dispatch_detection(
                    detector_key=detector_key,
                    image=img,
                    detect_size=2048,
                    text_threshold=0.5,
                    box_threshold=0.7,
                    unclip_ratio=2.3,
                    invert=False,
                    gamma_correct=False,
                    rotate=False,
                    auto_rotate=False,
                    device=device_str,
                    verbose=False
                )

            if language == "ja":
                config = OcrConfig(ocr=Ocr.mocr)
                ocr_regions = await dispatch_ocr(
                    ocr_key=Ocr.mocr,
                    image=img,
                    regions=detected_regions,
                    config=config,
                    device=device_str,
                    verbose=False
                )

                for idx, r in enumerate(ocr_regions):
                    if not r.text or not r.text.strip():
                        continue

                    pts = [{"x": float(p[0]), "y": float(p[1])} for p in r.pts]
                    x = int(r.aabb.x)
                    y = int(r.aabb.y)
                    w_box = int(r.aabb.w)
                    h_box = int(r.aabb.h)

                    regions_result.append({
                        "id": f"region_{idx + 1}",
                        "polygon": {"points": pts},
                        "boundingBox": {"x": x, "y": y, "width": w_box, "height": h_box},
                        "text": r.text.strip(),
                        "confidence": float(r.prob) if getattr(r, "prob", None) is not None else None,
                        "orientation": r.direction if getattr(r, "direction", None) in ["horizontal", "vertical", "unknown"] else "unknown",
                        "detector": "dbconvnext" if detector_key == Detector.dbconvnext else "default",
                        "recognizer": "manga-ocr",
                        "detectorVersion": version_str,
                        "recognizerVersion": get_package_version("manga-ocr")
                    })
            else:
                paddle_ocr_engine = get_paddle_recognizer(language)
                if paddle_ocr_engine is None:
                    raise ImportError("paddleocr package is not available for recognition-only execution.")

                for idx, r in enumerate(detected_regions):
                    try:
                        crop_img = r.get_transformed_region(img, r.direction, 48)
                    except Exception:
                        x, y, w, h = int(r.aabb.x), int(r.aabb.y), int(r.aabb.w), int(r.aabb.h)
                        x = max(0, min(x, img.shape[1] - 1))
                        y = max(0, min(y, img.shape[0] - 1))
                        w = max(1, min(w, img.shape[1] - x))
                        h = max(1, min(h, img.shape[0] - y))
                        crop_img = img[y:y+h, x:x+w]

                    res_ocr = paddle_ocr_engine.ocr(crop_img, det=False, rec=True)
                    text, conf = parse_paddle_rec_result(res_ocr)

                    if not text or not text.strip():
                        continue

                    pts = [{"x": float(p[0]), "y": float(p[1])} for p in r.pts]
                    x = int(r.aabb.x)
                    y = int(r.aabb.y)
                    w_box = int(r.aabb.w)
                    h_box = int(r.aabb.h)

                    regions_result.append({
                        "id": f"region_{idx + 1}",
                        "polygon": {"points": pts},
                        "boundingBox": {"x": x, "y": y, "width": w_box, "height": h_box},
                        "text": text.strip(),
                        "confidence": conf,
                        "orientation": r.direction if getattr(r, "direction", None) in ["horizontal", "vertical", "unknown"] else "unknown",
                        "detector": "dbconvnext" if detector_key == Detector.dbconvnext else "default",
                        "recognizer": f"paddleocr-{language}",
                        "detectorVersion": version_str,
                        "recognizerVersion": get_package_version("paddleocr")
                    })

            status = "success" if regions_result else "no_text"
        except Exception as e:
            errors.append(f"Runtime error: {str(e)}")
            errors.append(traceback.format_exc())
            status = "failed"

        processing_time_ms = int((time.time() - start_time) * 1000)
        return {
            "engine": self.name,
            "status": status,
            "synthetic": False,
            "engineVersion": version_str,
            "engineCommit": commit_sha,
            "device": device_str,
            "regions": regions_result,
            "errors": errors,
            "processingTimeMs": processing_time_ms,
            "imageWidth": width if cv2 and img is not None else 0,
            "imageHeight": height if cv2 and img is not None else 0
        }


# Pipeline D: PaddleOCR by itself
class PipelineDEngine(OcrEngine):
    @property
    def name(self) -> str:
        return "paddleocr-standalone"

    async def process(self, image_path: str, language: str) -> Dict[str, Any]:
        start_time = time.time()
        errors = []
        regions_result = []
        
        version_str = get_package_version("paddleocr")
        device_str = "cpu"
        if torch and torch.cuda.is_available():
            device_str = "cuda"

        if not PaddleOCR or not cv2:
            return {
                "engine": self.name,
                "status": "unavailable",
                "synthetic": False,
                "engineVersion": version_str,
                "engineCommit": "N/A",
                "device": device_str,
                "regions": [],
                "errors": ["paddleocr is not installed in the environment."],
                "processingTimeMs": 0,
                "imageWidth": 0,
                "imageHeight": 0
            }

        try:
            img = cv2.imread(image_path)
            if img is None:
                raise ValueError(f"Image could not be loaded: {image_path}")
            height, width, _ = img.shape

            paddle_lang = "ch"
            if language == "ko":
                paddle_lang = "korean"
            elif language == "ja":
                paddle_lang = "japan"
            elif language == "en":
                paddle_lang = "en"

            ocr = PaddleOCR(use_angle_cls=True, lang=paddle_lang, show_log=False)
            results = ocr.ocr(image_path, cls=True)

            if results and results[0]:
                for idx, line in enumerate(results[0]):
                    bbox, (text, conf) = line
                    if not text or not text.strip():
                        continue

                    pts = [{"x": float(pt[0]), "y": float(pt[1])} for pt in bbox]
                    xs = [pt[0] for pt in bbox]
                    ys = [pt[1] for pt in bbox]
                    x_min, x_max = min(xs), max(xs)
                    y_min, y_max = min(ys), max(ys)
                    w_box = x_max - x_min
                    h_box = y_max - y_min

                    regions_result.append({
                        "id": f"region_{idx + 1}",
                        "polygon": {"points": pts},
                        "boundingBox": {
                            "x": int(x_min),
                            "y": int(y_min),
                            "width": int(w_box),
                            "height": int(h_box)
                        },
                        "text": text.strip(),
                        "confidence": float(conf),
                        "orientation": "vertical" if h_box > w_box * 1.5 else "horizontal",
                        "detector": "paddleocr",
                        "recognizer": f"paddleocr-{language}",
                        "detectorVersion": version_str,
                        "recognizerVersion": version_str
                    })

            status = "success" if regions_result else "no_text"
        except Exception as e:
            errors.append(f"Runtime error: {str(e)}")
            errors.append(traceback.format_exc())
            status = "failed"

        processing_time_ms = int((time.time() - start_time) * 1000)
        return {
            "engine": self.name,
            "status": status,
            "synthetic": False,
            "engineVersion": version_str,
            "engineCommit": "N/A",
            "device": device_str,
            "regions": regions_result,
            "errors": errors,
            "processingTimeMs": processing_time_ms,
            "imageWidth": width if cv2 and img is not None else 0,
            "imageHeight": height if cv2 and img is not None else 0
        }


def load_cjk_font(font_path_arg: Optional[str] = None, size: int = 15) -> ImageFont.ImageFont:
    if font_path_arg and os.path.exists(font_path_arg):
        try:
            return ImageFont.truetype(font_path_arg, size)
        except Exception as e:
            print(f"Warning: Failed to load specified CJK font at {font_path_arg}: {e}")

    system_font_paths = []
    if platform.system() == "Darwin":
        system_font_paths = [
            "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
            "/System/Library/Fonts/PingFang.ttc",
            "/System/Library/Fonts/AppleGothic.ttf",
            "/Library/Fonts/Arial Unicode.ttf"
        ]
    elif platform.system() == "Linux":
        system_font_paths = [
            "/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc",
            "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
            "/usr/share/fonts/truetype/noto/NotoSerifCJK-Regular.ttc",
            "/usr/share/fonts/truetype/droid/DroidSansFallback.ttf"
        ]
    elif platform.system() == "Windows":
        system_font_paths = [
            "C:\\Windows\\Fonts\\msmincho.ttc",
            "C:\\Windows\\Fonts\\malgun.ttf",
            "C:\\Windows\\Fonts\\msgothic.ttc"
        ]

    for fp in system_font_paths:
        if os.path.exists(fp):
            try:
                return ImageFont.truetype(fp, size)
            except Exception:
                pass

    return ImageFont.load_default()


def draw_annotations(image_path: str, result: Dict[str, Any], color: Tuple[int, int, int], cjk_font_path: Optional[str] = None) -> np.ndarray:
    img = cv2.imread(image_path)
    if img is None:
        img = np.zeros((1200, 800, 3), dtype=np.uint8)
        cv2.putText(img, "Image not found", (50, 50), cv2.FONT_HERSHEY_SIMPLEX, 1, (0, 0, 255), 2)

    overlay = img.copy()

    for r in result["regions"]:
        pts = np.array([[pt["x"], pt["y"]] for pt in r["polygon"]["points"]], dtype=np.int32)
        cv2.fillPoly(overlay, [pts], color)
        bbox = r["boundingBox"]
        cv2.rectangle(img, (bbox["x"], bbox["y"]), (bbox["x"] + bbox["width"], bbox["y"] + bbox["height"]), color, 2)
        cv2.polylines(img, [pts], True, color, 1)

    cv2.addWeighted(overlay, 0.15, img, 0.85, 0, img)

    # Render CJK Unicode text labels using PIL/Pillow
    if ImageDraw:
        pil_img = Image.fromarray(cv2.cvtColor(img, cv2.COLOR_BGR2RGB))
        draw_pil = ImageDraw.Draw(pil_img)
        
        font_label = load_cjk_font(cjk_font_path, size=11)
        font_text = load_cjk_font(cjk_font_path, size=15)
        
        for r in result["regions"]:
            bbox = r["boundingBox"]
            conf_percent = f"{round((r['confidence'] or 0.0)*100)}%" if r['confidence'] is not None else 'N/A'
            lbl = f"{r['id']} ({r['orientation']}) [Conf: {conf_percent}]"
            
            # Label background & text
            draw_pil.text((bbox["x"], bbox["y"] - 14), lbl, font=font_label, fill=(255, 255, 255))
            # Recognized CJK text output
            draw_pil.text((bbox["x"], bbox["y"] + bbox["height"] + 2), r["text"], font=font_text, fill=(255, 255, 255))
            
        img = cv2.cvtColor(np.array(pil_img), cv2.COLOR_RGB2BGR)

    # Footer
    footer_text = f"Engine: {result['engine']} | Time: {result['processingTimeMs']}ms | Status: {result['status']}"
    cv2.putText(img, footer_text, (10, img.shape[0] - 20), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 0, 0), 3, cv2.LINE_AA)
    cv2.putText(img, footer_text, (10, img.shape[0] - 20), cv2.FONT_HERSHEY_SIMPLEX, 0.5, color, 1, cv2.LINE_AA)

    return img


def generate_comparison_html(output_dir: str, benchmark_results: Dict[str, Any], input_source: str):
    html_lines = [
        "<!DOCTYPE html>",
        "<html lang='en'>",
        "<head>",
        "  <meta charset='UTF-8'>",
        "  <title>Manga Lens OCR Benchmark Comparison View</title>",
        "  <style>",
        "    body { font-family: 'Inter', -apple-system, sans-serif; background: #0f172a; color: #f8fafc; margin: 0; padding: 20px; }",
        "    h1 { color: #38bdf8; text-align: center; margin-bottom: 30px; }",
        "    .comparison-grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 15px; margin-bottom: 40px; border-bottom: 2px solid #334155; padding-bottom: 45px; }",
        "    .column-header { font-weight: bold; font-size: 1.1rem; text-align: center; background: #1e293b; padding: 10px; border-radius: 8px; border: 1px solid #475569; }",
        "    .image-card { background: #1e293b; border-radius: 12px; border: 1px solid #334155; padding: 10px; display: flex; flex-direction: column; }",
        "    .image-card img { width: 100%; border-radius: 8px; cursor: pointer; object-fit: contain; max-height: 500px; }",
        "    .meta-box { margin-top: 10px; font-size: 0.85rem; line-height: 1.4; }",
        "    .text-list { background: #0f172a; padding: 8px; border-radius: 6px; margin-top: 8px; max-height: 150px; overflow-y: auto; font-family: monospace; font-size: 0.8rem; }",
        "    .status-badge { display: inline-block; padding: 2px 6px; border-radius: 4px; font-size: 0.75rem; font-weight: bold; }",
        "    .status-success { background: #15803d; color: #bbf7d0; }",
        "    .status-no_text { background: #b45309; color: #fef3c7; }",
        "    .status-failed { background: #b91c1c; color: #fee2e2; }",
        "    .status-unavailable { background: #475569; color: #f1f5f9; }",
        "    .review-template-container { background: #1e293b; border: 1px dashed #38bdf8; border-radius: 12px; padding: 20px; margin-top: 40px; }",
        "    .review-template-title { font-size: 1.2rem; color: #38bdf8; margin-bottom: 10px; }",
        "    pre { background: #0f172a; padding: 15px; border-radius: 8px; overflow-x: auto; font-size: 0.9rem; border: 1px solid #334155; }",
        "  </style>",
        "</head>",
        "<body>",
        "  <h1>Manga Lens OCR Benchmark Comparison View</h1>"
    ]

    for img_name, engines_data in benchmark_results.items():
        html_lines.append(f"  <h2>Image: {img_name}</h2>")
        html_lines.append("  <div class='comparison-grid'>")
        
        # Original column
        if os.path.isdir(input_source):
            orig_full = os.path.join(input_source, img_name)
        else:
            orig_full = input_source
            
        rel_orig = os.path.relpath(orig_full, output_dir)
        html_lines.append("    <div>")
        html_lines.append("      <div class='column-header'>Original Image</div>")
        html_lines.append("      <div class='image-card'>")
        html_lines.append(f"        <img src='{rel_orig}' alt='Original Image'>")
        html_lines.append("      </div>")
        html_lines.append("    </div>")

        # Pipelines columns
        for engine_name in ["manga-image-translator-default", "manga-image-translator-ctd", "dbnet-mangaocr-paddleocr", "paddleocr-standalone"]:
            html_lines.append("    <div>")
            html_lines.append(f"      <div class='column-header'>{engine_name}</div>")
            
            res = engines_data.get(engine_name)
            if not res:
                html_lines.append("      <div class='image-card'><p>Engine not executed</p></div>")
                html_lines.append("    </div>")
                continue

            html_lines.append("      <div class='image-card'>")
            
            if res["status"] in ["success", "no_text"] and res.get("annotatedPath") and os.path.exists(res["annotatedPath"]):
                rel_annotated = os.path.relpath(res["annotatedPath"], output_dir)
                html_lines.append(f"        <img src='{rel_annotated}' alt='{engine_name} annotated'>")
            else:
                html_lines.append("        <div style='height:200px; display:flex; justify-content:center; align-items:center; background:#0f172a; border-radius:8px; color:#64748b;'>No annotation available</div>")

            status = res["status"]
            status_class = f"status-{status}"
            html_lines.append("        <div class='meta-box'>")
            html_lines.append(f"          Status: <span class='status-badge {status_class}'>{status}</span><br>")
            html_lines.append(f"          Time: {res.get('processingTimeMs', 0)}ms<br>")
            html_lines.append(f"          Regions: {len(res.get('regions', []))}<br>")
            html_lines.append(f"          CPU memory: {res.get('cpu_memory_usage_mb', 0)} MB<br>")
            html_lines.append(f"          GPU memory: {res.get('gpu_memory_usage_mb', 0)} MB<br>")
            html_lines.append(f"          Detector: {res.get('detector', 'N/A')} ({res.get('detectorVersion', 'N/A')})<br>")
            html_lines.append(f"          Recognizer: {res.get('recognizer', 'N/A')} ({res.get('recognizerVersion', 'N/A')})<br>")
            
            if res.get("errors"):
                errors_str = "; ".join(res["errors"])
                html_lines.append(f"          <span style='color:#ef4444;'>Errors: {errors_str}</span><br>")
            
            html_lines.append("        </div>")
            
            if res.get("regions"):
                html_lines.append("        <div class='text-list'>")
                for r in res["regions"]:
                    snippet = r["text"][:30] + ("..." if len(r["text"]) > 30 else "")
                    html_lines.append(f"[{r['id']}] {snippet} ({round((r.get('confidence') or 0.0)*100)}%)<br>")
                html_lines.append("        </div>")

            html_lines.append("      </div>")
            html_lines.append("    </div>")

        html_lines.append("  </div>")

    # Add manual review JSON template at the bottom
    review_template = {
        "manualReview": [
            {
                "imageName": "example_page.png",
                "pipeline": "manga-image-translator-ctd",
                "expectedTextRegionCount": 0,
                "detectedTruePositives": 0,
                "falsePositives": 0,
                "missedRegions": 0,
                "unreadableRegions": 0,
                "notes": ""
            }
        ]
    }
    json_template_str = json.dumps(review_template, indent=2)

    html_lines.extend([
        "  <div class='review-template-container'>",
        "    <div class='review-template-title'>Manual Review JSON Template</div>",
        "    <p>Please copy the template below, fill out the metrics for each image and pipeline based on visual inspection, and save it as a manual review report:</p>",
        f"    <pre>{json_template_str}</pre>",
        "  </div>",
        "</body>",
        "</html>"
    ])

    report_html_path = os.path.join(output_dir, "comparison.html")
    with open(report_html_path, "w", encoding="utf-8") as f:
        f.write("\n".join(html_lines))
    print(f"Comparison HTML generated at: {report_html_path}")


def run_demo_mode(output_dir: str, language: str, cjk_font_path: Optional[str] = None):
    demo_dir = os.path.join(output_dir, "demo")
    os.makedirs(demo_dir, exist_ok=True)
    
    print("\nRunning in synthetic demo mode...")
    
    dummy_path = os.path.join(demo_dir, "dummy_manga_page.png")
    dummy_img = np.ones((1200, 800, 3), dtype=np.uint8) * 240
    cv2.circle(dummy_img, (200, 200), 100, (255, 255, 255), -1)
    cv2.circle(dummy_img, (200, 200), 100, (0, 0, 0), 2)
    cv2.ellipse(dummy_img, (600, 800), (120, 180), 0, 0, 360, (255, 255, 255), -1)
    cv2.ellipse(dummy_img, (600, 800), (120, 180), 0, 0, 360, (0, 0, 0), 2)
    
    # Render CJK text inside demo images using Pillow if possible
    if ImageDraw:
        pil_img = Image.fromarray(dummy_img)
        draw = ImageDraw.Draw(pil_img)
        font = load_cjk_font(cjk_font_path, size=24)
        if language == "ko":
            draw.text((50, 450), "만화 패널 1", font=font, fill=(0, 0, 0))
            draw.text((450, 450), "만화 패널 2", font=font, fill=(0, 0, 0))
        elif language == "ja":
            draw.text((50, 450), "漫画パネル 1", font=font, fill=(0, 0, 0))
            draw.text((450, 450), "漫画パネル 2", font=font, fill=(0, 0, 0))
        else:
            draw.text((50, 450), "MANGA PANEL 1", font=font, fill=(0, 0, 0))
            draw.text((450, 450), "MANGA PANEL 2", font=font, fill=(0, 0, 0))
        dummy_img = cv2.cvtColor(np.array(pil_img), cv2.COLOR_RGB2BGR)
    else:
        cv2.putText(dummy_img, "PANEL 1", (50, 450), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 0, 0), 2)
        cv2.putText(dummy_img, "PANEL 2", (450, 450), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 0, 0), 2)
        
    cv2.imwrite(dummy_path, dummy_img)
    
    mock_regions = generate_mock_regions(800, 1200, language)
    
    demo_results = {
        "dummy_manga_page.png": {
            "manga-image-translator-default": {
                "engine": "manga-image-translator-default",
                "status": "success",
                "synthetic": True,
                "engineVersion": "0.1.0",
                "engineCommit": "efdc229de8aa0f3d4051ad97664adc62dd5ac605",
                "device": "cpu",
                "regions": mock_regions,
                "errors": [],
                "processingTimeMs": 15,
                "imageWidth": 800,
                "imageHeight": 1200,
                "annotatedPath": os.path.join(demo_dir, "annotated_manga-image-translator-default_dummy_manga_page.png"),
                "detector": "mock-detector",
                "recognizer": "mock-recognizer",
                "detectorVersion": "0.1.0",
                "recognizerVersion": "0.1.0"
            }
        }
    }
    
    # Save demo reports
    with open(os.path.join(demo_dir, "report.json"), "w", encoding="utf-8") as f:
        json.dump(demo_results, f, indent=2)
        
    res_engine = demo_results["dummy_manga_page.png"]["manga-image-translator-default"]
    annotated_img = draw_annotations(dummy_path, res_engine, (0, 200, 0), cjk_font_path)
    cv2.imwrite(res_engine["annotatedPath"], annotated_img)
    
    with open(os.path.join(demo_dir, "report.md"), "w", encoding="utf-8") as f:
        f.write("# Demo Synthetic Benchmark Report\n\nGenerated for testing visualization overlay styles. Marked as synthetic: true.\n")
        
    generate_comparison_html(demo_dir, demo_results, dummy_path)
    print(f"Demo run completed successfully. Outputs saved to: {demo_dir}")


async def run_benchmark():
    parser = argparse.ArgumentParser(description="Manga/Manhwa Local OCR & Text Detection Benchmark Spike")
    parser.add_argument("--input", required=False, help="Path to input samples folder or single image file")
    parser.add_argument("--output", required=False, help="Path to results directory")
    parser.add_argument("--language", default="ko", choices=["ko", "ja", "en"], help="Target language (ko, ja, en)")
    parser.add_argument("--engines", default="ctd,paddle,dbconvnext,default,all", help="Comma-separated list of engines (ctd, paddle, dbconvnext, default, all)")
    parser.add_argument("--demo", action="store_true", help="Run in mock/demo fallback mode without loading heavy models")
    parser.add_argument("--check-engines", help="Comma-separated list of engines to strictly check (e.g. paddle,ctd,dbconvnext,default)")
    parser.add_argument("--cjk-font", help="Path to local CJK-capable TrueType/OpenType font")

    args = parser.parse_args()

    # Handle strict installation checking execution path
    if args.check_engines:
        check_engines(args.check_engines)
        return

    # Check input and output parameter requirements for normal/demo executions
    if not args.input or not args.output:
        parser.print_help()
        print("\nError: --input and --output are required to execute benchmarks.", file=sys.stderr)
        sys.exit(1)

    if not cv2 or not np:
        print("CRITICAL: opencv-python and numpy are required to run this benchmark. Please install requirements.", file=sys.stderr)
        sys.exit(1)

    if args.demo:
        run_demo_mode(args.output, args.language, args.cjk_font)
        return

    images_to_process = []
    if args.input:
        if os.path.isfile(args.input):
            images_to_process.append(args.input)
        elif os.path.isdir(args.input):
            for f in os.listdir(args.input):
                if f.lower().endswith((".png", ".jpg", ".jpeg", ".webp", ".bmp")):
                    images_to_process.append(os.path.join(args.input, f))
        else:
            try:
                os.makedirs(args.input, exist_ok=True)
                print(f"Created input directory: {args.input}. Please place your clean CJK/English manga images here and rerun the benchmark.", file=sys.stderr)
            except Exception as e:
                print(f"CRITICAL: Input path '{args.input}' does not exist and could not be created: {e}", file=sys.stderr)
            sys.exit(1)
    
    if not images_to_process:
        print(f"CRITICAL: No image files found to process at: {args.input}", file=sys.stderr)
        sys.exit(1)

    os.makedirs(args.output, exist_ok=True)

    engine_list = [e.strip() for e in args.engines.split(",")]
    all_engines = [
        PipelineAEngine(),
        PipelineBEngine(),
        PipelineCEngine(),
        PipelineDEngine()
    ]
    
    selected_engines = []
    if "all" in engine_list:
        selected_engines = all_engines
    else:
        for e in engine_list:
            if e == "default":
                selected_engines.append(all_engines[0])
            elif e == "ctd":
                selected_engines.append(all_engines[1])
            elif e == "dbconvnext":
                selected_engines.append(all_engines[2])
            elif e == "paddle":
                selected_engines.append(all_engines[3])

    if not selected_engines:
        print("Error: No valid engines specified.", file=sys.stderr)
        sys.exit(1)

    colors = {
        "manga-image-translator-default": (0, 200, 0),       # Green
        "manga-image-translator-ctd": (200, 200, 0),         # Cyan
        "dbnet-mangaocr-paddleocr": (200, 0, 200),           # Magenta
        "paddleocr-standalone": (0, 128, 255)                # Orange
    }

    benchmark_results = {}
    
    cpu_model = get_cpu_brand()
    gpu_model = torch.cuda.get_device_name(0) if torch and torch.cuda.is_available() else "N/A (CPU execution)"
    model_sizes = get_model_sizes_on_disk()

    # Track if any selected engines are failed or unavailable
    strict_exit_required = False

    for img_path in images_to_process:
        img_name = os.path.basename(img_path)
        benchmark_results[img_name] = {}
        
        print(f"\nProcessing image: {img_name}")
        for engine in selected_engines:
            print(f"  Running {engine.name}...")
            
            cpu_before, gpu_before = get_memory_usage()
            res = await engine.process(img_path, args.language)
            cpu_after, gpu_after = get_memory_usage()
            
            res["cpu_memory_usage_mb"] = round(max(0.0, cpu_after - cpu_before), 2)
            res["gpu_memory_usage_mb"] = round(max(0.0, gpu_after - gpu_before), 2)
            
            if res["status"] in ["failed", "unavailable"]:
                strict_exit_required = True
            
            if res["status"] in ["success", "no_text"]:
                color = colors.get(engine.name, (128, 128, 128))
                annotated_img = draw_annotations(img_path, res, color, args.cjk_font)
                annotated_path = os.path.join(args.output, f"annotated_{engine.name}_{img_name}")
                cv2.imwrite(annotated_path, annotated_img)
                res["annotatedPath"] = annotated_path
            else:
                res["annotatedPath"] = "N/A"
                
            benchmark_results[img_name][engine.name] = res

    # Generate Reports
    report_json_path = os.path.join(args.output, "report.json")
    report_md_path = os.path.join(args.output, "report.md")

    with open(report_json_path, "w", encoding="utf-8") as f:
        json.dump(benchmark_results, f, indent=2, ensure_ascii=False)

    md_lines = [
        "# Manga/Manhwa Text Detection and OCR Engine Benchmark Report",
        "",
        "This document contains a structured analysis comparing multiple manga/manhwa text detection and OCR pipelines.",
        "",
        "## System Environment",
        f"- **CPU Model**: `{cpu_model}`",
        f"- **GPU Model**: `{gpu_model}`",
        f"- **Cached Model Files on Disk**:",
    ]
    for name, size in model_sizes.items():
        md_lines.append(f"  - `{name}`: {size}")

    md_lines.extend([
        "",
        "## Main Comparison Table (Successful Runs)",
        ""
    ])

    headers = [
        "Image Name", "Engine Name", "Regions", "Non-Empty", "Avg Conf", 
        "Duration (ms)", "CPU Mem (MB)", "GPU Mem (MB)", "Device"
    ]
    md_lines.append("| " + " | ".join(headers) + " |")
    md_lines.append("| " + " | ".join(["---"] * len(headers)) + " |")

    failed_sections = []

    for img_name, engines_data in benchmark_results.items():
        for engine_name, res in engines_data.items():
            if res["status"] not in ["success", "no_text"]:
                failed_sections.append(res)
                continue
                
            confidences = [r["confidence"] for r in res["regions"] if r["confidence"] is not None]
            avg_conf = f"{round(sum(confidences) / len(confidences) * 100, 1)}%" if confidences else "N/A"
            non_empty = len([r for r in res["regions"] if r["text"]])
            
            row = [
                img_name,
                engine_name,
                str(len(res["regions"])),
                str(non_empty),
                avg_conf,
                f"{res['processingTimeMs']}ms",
                f"{res['cpu_memory_usage_mb']} MB",
                f"{res['gpu_memory_usage_mb']} MB",
                res["device"]
            ]
            md_lines.append("| " + " | ".join(row) + " |")

    # Failures Section
    md_lines.extend([
        "",
        "## Failures and Unavailable Engines",
        "",
        "| Engine Name | Status | Errors |",
        "| --- | --- | --- |"
    ])
    for f_res in failed_sections:
        err_msg = "; ".join(f_res["errors"]) if f_res["errors"] else "Unknown error"
        md_lines.append(f"| {f_res['engine']} | {f_res['status']} | {err_msg} |")

    md_lines.extend([
        "",
        "## Upstream Licenses and Commercial Implications",
        "",
        "| Engine / Component | Upstream License | Commercial Implications |",
        "| --- | --- | --- |",
        "| `manga-image-translator` | GPL-3.0 | **Requires Legal Review**: GPL-3.0 copyleft requirements restrict closed-source commercial integrations. |",
        "| `manga-ocr` | MIT | Permissive, allowed for commercial use. |",
        "| `PaddleOCR` | Apache-2.0 | Permissive, allowed for commercial use. |",
        "",
        "## Human Review Status",
        "",
        "> [!IMPORTANT]",
        "> Accuracy assessment requires manual visual inspection of the generated annotated output images in comparison.html. Do not declare a winning pipeline until these images have been manually reviewed.",
        "",
        "## Limitations of the Benchmark",
        "1. **Environment Variation**: Real-world performance will vary depending on CUDA versions and GPU hardware specs.",
        "2. **OCR Confidence Metrics**: Confidence scores are engine-specific (PaddleOCR and manga-ocr use different scoring matrices) and cannot be directly compared."
    ])

    with open(report_md_path, "w", encoding="utf-8") as f:
        f.write("\n".join(md_lines))

    # Generate the comparison view HTML
    generate_comparison_html(args.output, benchmark_results, args.input)

    print(f"\nBenchmark run finished!")
    print(f"JSON Report: {report_json_path}")
    print(f"Markdown Report: {report_md_path}")
    print(f"Comparison HTML: {os.path.join(args.output, 'comparison.html')}")

    if strict_exit_required:
        print("\nCRITICAL ERROR: One or more engines reported status failed/unavailable during authentic benchmark run.", file=sys.stderr)
        sys.exit(1)


def main_sync():
    asyncio.run(run_benchmark())


if __name__ == "__main__":
    main_sync()
