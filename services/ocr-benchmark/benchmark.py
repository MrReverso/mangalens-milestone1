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
    from PIL import Image
except ImportError:
    cv2 = None
    np = None
    Image = None

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
    from manga_translator.detection import dispatch as dispatch_detection
    from manga_translator.ocr import dispatch as dispatch_ocr
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
    HAS_MANGA_TRANSLATOR = False


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


def generate_mock_regions(width: int, height: int, language: str) -> List[Dict[str, Any]]:
    """
    Generates realistic mockup coordinates and text regions for test/demo mode.
    """
    regions = []
    
    # Dialogues based on requested language
    if language == "ko":
        texts = ["무엇을요?", "지금 출발해야 합니다.", "저기 보이는 것이 무엇인가요?"]
    elif language == "ja":
        texts = ["本当に大丈夫？", "何か用ですか？", "여기서 기다려 주세요."]
    else:
        texts = ["Where are we going?", "We need to leave before sunset.", "Let's check that direction!"]

    # Region 1: Speech bubble top left
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
        "orientation": "horizontal"
    })

    # Region 2: Speech bubble bottom right (vertical-ish or normal)
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
        "orientation": "vertical" if language in ["ja", "ko"] else "horizontal"
    })

    return regions


# Pipeline A: manga-image-translator default detector + default OCR
class PipelineAEngine(OcrEngine):
    @property
    def name(self) -> str:
        return "manga-image-translator-default"

    async def process(self, image_path: str, language: str) -> Dict[str, Any]:
        start_time = time.time()
        errors = []
        regions_result = []
        
        # Setup basic metadata
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

            # Run detection using explicit parameters
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

            # Run OCR using explicit parameters
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
                    "orientation": r.direction if getattr(r, "direction", None) in ["horizontal", "vertical", "unknown"] else "unknown"
                })

            status = "success"
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


# Pipeline B: manga-image-translator CTD + Japanese OCR / PaddleOCR
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

            # Run detection using explicit parameters
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

            # Determine OCR engine
            ocr_key = Ocr.mocr if language == "ja" else Ocr.ocr48px
            config = OcrConfig(ocr=ocr_key)
            
            ocr_regions = await dispatch_ocr(
                ocr_key=ocr_key,
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
                    "orientation": r.direction if getattr(r, "direction", None) in ["horizontal", "vertical", "unknown"] else "unknown"
                })

            status = "success"
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


# Pipeline C: DBNet/DBConvNext detector + manga-ocr (JA) / PaddleOCR (KO)
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

            # Try dbconvnext first, fallback to default (dbnet)
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

            # Choose manga-ocr (mocr) for Japanese
            ocr_key = Ocr.mocr if language == "ja" else Ocr.ocr48px
            config = OcrConfig(ocr=ocr_key)
            
            ocr_regions = await dispatch_ocr(
                ocr_key=ocr_key,
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
                    "orientation": r.direction if getattr(r, "direction", None) in ["horizontal", "vertical", "unknown"] else "unknown"
                })

            status = "success"
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

            # Map lang to paddleocr values
            paddle_lang = "ch"
            if language == "ko":
                paddle_lang = "korean"
            elif language == "ja":
                paddle_lang = "japan"
            elif language == "en":
                paddle_lang = "en"

            # Init model (Adapter targets PaddleOCR 2.8.1 explicitly)
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
                        "orientation": "vertical" if h_box > w_box * 1.5 else "horizontal"
                    })

            status = "success"
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


def draw_annotations(image_path: str, result: Dict[str, Any], color: Tuple[int, int, int]) -> np.ndarray:
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

        lbl = f"{r['id']} ({r['orientation']}) [Conf: {r['confidence'] or 'N/A'}]"
        cv2.putText(img, lbl, (bbox["x"], bbox["y"] - 5), cv2.FONT_HERSHEY_SIMPLEX, 0.4, (0, 0, 0), 2, cv2.LINE_AA)
        cv2.putText(img, lbl, (bbox["x"], bbox["y"] - 5), cv2.FONT_HERSHEY_SIMPLEX, 0.4, (255, 255, 255), 1, cv2.LINE_AA)

        text_y = bbox["y"] + bbox["height"] + 15
        cv2.putText(img, r["text"], (bbox["x"], text_y), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 0, 0), 3, cv2.LINE_AA)
        cv2.putText(img, r["text"], (bbox["x"], text_y), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 1, cv2.LINE_AA)

    cv2.addWeighted(overlay, 0.15, img, 0.85, 0, img)

    footer_text = f"Engine: {result['engine']} | Time: {result['processingTimeMs']}ms | Status: {result['status']}"
    cv2.putText(img, footer_text, (10, img.shape[0] - 20), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 0, 0), 3, cv2.LINE_AA)
    cv2.putText(img, footer_text, (10, img.shape[0] - 20), cv2.FONT_HERSHEY_SIMPLEX, 0.5, color, 1, cv2.LINE_AA)

    return img


def run_demo_mode(output_dir: str, language: str):
    """
    Separate, isolated demo execution path.
    Generates synthetic dummy page and outputs mock metadata marked as synthetic under results/demo/.
    """
    demo_dir = os.path.join(output_dir, "demo")
    os.makedirs(demo_dir, exist_ok=True)
    
    print("\nRunning in synthetic demo mode...")
    
    dummy_path = os.path.join(demo_dir, "dummy_manga_page.png")
    dummy_img = np.ones((1200, 800, 3), dtype=np.uint8) * 240
    cv2.circle(dummy_img, (200, 200), 100, (255, 255, 255), -1)
    cv2.circle(dummy_img, (200, 200), 100, (0, 0, 0), 2)
    cv2.ellipse(dummy_img, (600, 800), (120, 180), 0, 0, 360, (255, 255, 255), -1)
    cv2.ellipse(dummy_img, (600, 800), (120, 180), 0, 0, 360, (0, 0, 0), 2)
    cv2.putText(dummy_img, "MANGA PANEL 1", (50, 450), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 0, 0), 2)
    cv2.putText(dummy_img, "MANGA PANEL 2", (450, 450), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 0, 0), 2)
    cv2.imwrite(dummy_path, dummy_img)
    
    # Generate mock regions
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
                "annotatedPath": os.path.join(demo_dir, "annotated_manga-image-translator-default_dummy_manga_page.png")
            }
        }
    }
    
    # Save demo reports
    with open(os.path.join(demo_dir, "report.json"), "w", encoding="utf-8") as f:
        json.dump(demo_results, f, indent=2)
        
    # Draw annotations
    res_engine = demo_results["dummy_manga_page.png"]["manga-image-translator-default"]
    annotated_img = draw_annotations(dummy_path, res_engine, (0, 200, 0))
    cv2.imwrite(res_engine["annotatedPath"], annotated_img)
    
    # Save demo Markdown report
    with open(os.path.join(demo_dir, "report.md"), "w", encoding="utf-8") as f:
        f.write("# Demo Synthetic Benchmark Report\n\nGenerated for testing visualization overlay styles. Marked as synthetic: true.\n")
        
    print(f"Demo run completed successfully. Outputs saved to: {demo_dir}")


async def run_benchmark():
    parser = argparse.ArgumentParser(description="Manga/Manhwa Local OCR & Text Detection Benchmark Spike")
    parser.add_argument("--input", required=True, help="Path to input samples folder or single image file")
    parser.add_argument("--output", required=True, help="Path to results directory")
    parser.add_argument("--language", default="ko", choices=["ko", "ja", "en"], help="Target language (ko, ja, en)")
    parser.add_argument("--engines", default="ctd,paddle,dbconvnext,all", help="Comma-separated list of engines (ctd, paddle, dbconvnext, default, all)")
    parser.add_argument("--demo", action="store_true", help="Run in mock/demo fallback mode without loading heavy models")

    args = parser.parse_args()

    if not cv2 or not np:
        print("CRITICAL: opencv-python and numpy are required to run this benchmark. Please install requirements.", file=sys.stderr)
        sys.exit(1)

    # If demo mode explicitly requested, route to isolated demo path
    if args.demo:
        run_demo_mode(args.output, args.language)
        return

    # Find sample images in normal mode
    images_to_process = []
    if os.path.isfile(args.input):
        images_to_process.append(args.input)
    elif os.path.isdir(args.input):
        for f in os.listdir(args.input):
            if f.lower().endswith((".png", ".jpg", ".jpeg", ".webp", ".bmp")):
                images_to_process.append(os.path.join(args.input, f))
    
    if not images_to_process:
        print(f"CRITICAL: No image files found to process at: {args.input}", file=sys.stderr)
        sys.exit(1)

    os.makedirs(args.output, exist_ok=True)

    # Resolve engines to execute
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
    
    # Query system details
    cpu_model = get_cpu_brand()
    gpu_model = torch.cuda.get_device_name(0) if torch and torch.cuda.is_available() else "N/A (CPU execution)"
    model_sizes = get_model_sizes_on_disk()

    for img_path in images_to_process:
        img_name = os.path.basename(img_path)
        benchmark_results[img_name] = {}
        
        print(f"\nProcessing image: {img_name}")
        for engine in selected_engines:
            print(f"  Running {engine.name}...")
            
            # Record memory before processing
            cpu_before, gpu_before = get_memory_usage()
            
            # Process OCR
            res = await engine.process(img_path, args.language)
            
            # Record memory after processing
            cpu_after, gpu_after = get_memory_usage()
            
            # Compute difference and record
            res["cpu_memory_usage_mb"] = round(max(0.0, cpu_after - cpu_before), 2)
            res["gpu_memory_usage_mb"] = round(max(0.0, gpu_after - gpu_before), 2)
            
            # Draw annotations only for successful runs
            if res["status"] == "success":
                color = colors.get(engine.name, (128, 128, 128))
                annotated_img = draw_annotations(img_path, res, color)
                annotated_path = os.path.join(args.output, f"annotated_{engine.name}_{img_name}")
                cv2.imwrite(annotated_path, annotated_img)
                res["annotatedPath"] = annotated_path
            else:
                res["annotatedPath"] = "N/A"
                
            benchmark_results[img_name][engine.name] = res

    # Generate Markdown Report & JSON Report
    report_json_path = os.path.join(args.output, "report.json")
    report_md_path = os.path.join(args.output, "report.md")

    # Save JSON report
    with open(report_json_path, "w", encoding="utf-8") as f:
        json.dump(benchmark_results, f, indent=2, ensure_ascii=False)

    # Save Markdown Report
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
            if res["status"] != "success":
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
        "| `manga-image-translator` | GPL-3.0 | **Requires Legal Review**: GPL-3.0 has viral licensing requirements that may restrict closed-source commercial integrations. |",
        "| `manga-ocr` | MIT | Permissive, allowed for commercial use. |",
        "| `PaddleOCR` | Apache-2.0 | Permissive, allowed for commercial use. |",
        "",
        "## Human Review Status",
        "",
        "> [!IMPORTANT]",
        "> Accuracy assessment currently requires manual visual inspection of the generated annotated output images, as there is no pre-labeled ground truth dataset. Do not declare a winning pipeline until these images have been manually reviewed.",
        "",
        "## Limitations of the Benchmark",
        "1. **Environment Variation**: Real-world performance (processing time, memory usage) will vary depending on CUDA version, GPU specifications, and host machine disk speed during first-load model caching.",
        "2. **OCR Confidence Metrics**: Confidence scores are engine-specific (PaddleOCR vs. manga-ocr calculate confidence metrics differently) and cannot be directly compared mathematically."
    ])

    with open(report_md_path, "w", encoding="utf-8") as f:
        f.write("\n".join(md_lines))

    print(f"\nBenchmark completed successfully!")
    print(f"JSON Report: {report_json_path}")
    print(f"Markdown Report: {report_md_path}")


def main_sync():
    asyncio.run(run_benchmark())


if __name__ == "__main__":
    main_sync()
