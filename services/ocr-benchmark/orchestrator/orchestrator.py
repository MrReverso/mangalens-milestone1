#!/usr/bin/env python3
import os
import sys
import time
import json
import argparse
import traceback
import platform
import cv2
import numpy as np
import requests
from typing import List, Dict, Any, Tuple, Optional
from PIL import Image, ImageDraw, ImageFont

MANGA_ENGINE_URL = os.environ.get("MANGA_ENGINE_URL", "http://localhost:8002")
PADDLE_ENGINE_URL = os.environ.get("PADDLE_ENGINE_URL", "http://localhost:8003")


def normalize_orientation(direction: str) -> str:
    direction_clean = str(direction).lower().strip()
    if direction_clean in ["h", "horizontal"]:
        return "horizontal"
    elif direction_clean in ["v", "vertical"]:
        return "vertical"
    return "unknown"


def crop_polygon_perspective(img: np.ndarray, pts: List[List[float]]) -> np.ndarray:
    if len(pts) != 4:
        raise ValueError(f"Perspective crop requires 4 vertices. Got: {len(pts)}")
    
    pts_np = np.array(pts, dtype=np.float32)
    # Sort points: top-left, top-right, bottom-right, bottom-left
    s = pts_np.sum(axis=1)
    diff = np.diff(pts_np, axis=1).flatten()
    
    tl = pts_np[np.argmin(s)]
    br = pts_np[np.argmax(s)]
    tr = pts_np[np.argmin(diff)]
    bl = pts_np[np.argmax(diff)]
    
    width_a = np.sqrt(((br[0] - bl[0]) ** 2) + ((br[1] - bl[1]) ** 2))
    width_b = np.sqrt(((tr[0] - tl[0]) ** 2) + ((tr[1] - tl[1]) ** 2))
    max_width = max(int(width_a), int(width_b), 1)
    
    height_a = np.sqrt(((tr[0] - br[0]) ** 2) + ((tr[1] - br[1]) ** 2))
    height_b = np.sqrt(((tl[0] - bl[0]) ** 2) + ((tl[1] - bl[1]) ** 2))
    max_height = max(int(height_a), int(height_b), 1)
    
    dst = np.array([
        [0, 0],
        [max_width - 1, 0],
        [max_width - 1, max_height - 1],
        [0, max_height - 1]
    ], dtype="float32")
    
    src = np.array([tl, tr, br, bl], dtype="float32")
    M = cv2.getPerspectiveTransform(src, dst)
    warped = cv2.warpPerspective(img, M, (max_width, max_height))
    return warped


def crop_polygon_aabb(img: np.ndarray, pts: List[List[float]]) -> np.ndarray:
    pts_np = np.array(pts, dtype=np.int32)
    x, y, w, h = cv2.boundingRect(pts_np)
    x = max(0, min(x, img.shape[1] - 1))
    y = max(0, min(y, img.shape[0] - 1))
    w = max(1, min(w, img.shape[1] - x))
    h = max(1, min(h, img.shape[0] - y))
    return img[y:y+h, x:x+w]


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

    pil_img = Image.fromarray(cv2.cvtColor(img, cv2.COLOR_BGR2RGB))
    draw_pil = ImageDraw.Draw(pil_img)
    
    font_label = load_cjk_font(cjk_font_path, size=11)
    font_text = load_cjk_font(cjk_font_path, size=15)
    
    for r in result["regions"]:
        bbox = r["boundingBox"]
        conf_percent = f"{round((r['confidence'] or 0.0)*100)}%" if r['confidence'] is not None else 'N/A'
        lbl = f"{r['id']} ({r['orientation']}) [Conf: {conf_percent}]"
        
        draw_pil.text((bbox["x"], bbox["y"] - 14), lbl, font=font_label, fill=(255, 255, 255))
        draw_pil.text((bbox["x"], bbox["y"] + bbox["height"] + 2), r["text"], font=font_text, fill=(255, 255, 255))
        
    img = cv2.cvtColor(np.array(pil_img), cv2.COLOR_RGB2BGR)

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
            html_lines.append(f"          Detector: {res.get('detector', 'N/A')}<br>")
            html_lines.append(f"          Recognizer: {res.get('recognizer', 'N/A')}<br>")
            
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
        
    cv2.imwrite(dummy_path, dummy_img)
    
    # Generate mock regions matching structural rules
    mock_regions = [
        {
            "id": "region_1",
            "polygon": {
                "points": [
                    {"x": 100, "y": 100},
                    {"x": 300, "y": 100},
                    {"x": 300, "y": 200},
                    {"x": 100, "y": 200}
                ]
            },
            "boundingBox": {"x": 100, "y": 100, "width": 200, "height": 100},
            "text": "만화 패널 1" if language == "ko" else "MANGA PANEL 1",
            "confidence": 0.95,
            "orientation": "horizontal",
            "detector": "mock-detector",
            "recognizer": "mock-recognizer",
            "detectorVersion": "0.1.0",
            "recognizerVersion": "0.1.0"
        }
    ]
    
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
    
    with open(os.path.join(demo_dir, "report.json"), "w", encoding="utf-8") as f:
        json.dump(demo_results, f, indent=2)
        
    res_engine = demo_results["dummy_manga_page.png"]["manga-image-translator-default"]
    annotated_img = draw_annotations(dummy_path, res_engine, (0, 200, 0), cjk_font_path)
    cv2.imwrite(res_engine["annotatedPath"], annotated_img)
    
    generate_comparison_html(demo_dir, demo_results, dummy_path)
    print(f"Demo run completed successfully. Outputs saved to: {demo_dir}")


def check_services(engines_str: str) -> bool:
    print("=== HTTP SERVICE DIAGNOSTICS & STATUS CHECKS ===")
    requested = [e.strip() for e in engines_str.split(",")]
    all_healthy = True
    
    if "paddle" in requested:
        url = f"{PADDLE_ENGINE_URL}/health"
        print(f"Checking paddle-engine status on: {url} ...")
        try:
            r = requests.get(url, timeout=5)
            if r.status_code == 200 and r.json().get("status") == "healthy":
                print("  ✓ paddle-engine is healthy!")
            else:
                print(f"  ✗ paddle-engine returned unhealthy status: {r.status_code} - {r.text}")
                all_healthy = False
        except Exception as e:
            print(f"  ✗ Failed to connect to paddle-engine: {e}")
            all_healthy = False
            
    if any(m in requested for m in ["ctd", "dbconvnext", "default"]):
        url = f"{MANGA_ENGINE_URL}/health"
        print(f"Checking manga-engine status on: {url} ...")
        try:
            r = requests.get(url, timeout=5)
            if r.status_code == 200 and r.json().get("status") == "healthy":
                print("  ✓ manga-engine is healthy!")
            else:
                print(f"  ✗ manga-engine returned unhealthy status: {r.status_code} - {r.text}")
                all_healthy = False
        except Exception as e:
            print(f"  ✗ Failed to connect to manga-engine: {e}")
            all_healthy = False
            
    if not all_healthy:
        print("\nCRITICAL: Health check failed for one or more target microservices.")
        return False
        
    print("\n=== ALL ENGINE CONNECTIONS CONFIRMED HEALTHY ===")
    return True


class PipelineRunner:
    def __init__(self, cjk_font: Optional[str] = None):
        self.cjk_font = cjk_font

    def execute_pipeline_a(self, img_path: str, img: np.ndarray, language: str) -> Dict[str, Any]:
        """
        Pipeline A: manga-engine default detector + manga-engine ocr48px (for Japanese/or similar)
        """
        start_time = time.time()
        errors = []
        regions_result = []
        
        try:
            # 1. POST /detect
            with open(img_path, "rb") as f:
                r_det = requests.post(
                    f"{MANGA_ENGINE_URL}/detect",
                    files={"image": f},
                    data={"detector": "default"},
                    timeout=60
                )
            if r_det.status_code != 200:
                raise RuntimeError(f"manga-engine /detect failed: {r_det.status_code} - {r_det.text}")
                
            det_res = r_det.json()
            if det_res.get("errors"):
                errors.extend(det_res["errors"])
                raise RuntimeError(f"Detector reported internal errors: {det_res['errors']}")
                
            detected_regions = det_res.get("regions", [])
            
            # 2. POST /recognize-japanese (Pipeline A uses ocr48px)
            if detected_regions:
                with open(img_path, "rb") as f:
                    r_ocr = requests.post(
                        f"{MANGA_ENGINE_URL}/recognize-japanese",
                        files={"image": f},
                        data={
                            "regions": json.dumps(detected_regions),
                            "recognizer": "ocr48px"
                        },
                        timeout=60
                    )
                if r_ocr.status_code != 200:
                    raise RuntimeError(f"manga-engine /recognize-japanese failed: {r_ocr.status_code} - {r_ocr.text}")
                    
                ocr_res = r_ocr.json()
                if ocr_res.get("errors"):
                    errors.extend(ocr_res["errors"])
                else:
                    for r in ocr_res.get("regions", []):
                        regions_result.append({
                            "id": r["id"],
                            "polygon": {"points": [{"x": float(p[0]), "y": float(p[1])} for p in r["pts"]]},
                            "boundingBox": {
                                "x": r["aabb"]["x"],
                                "y": r["aabb"]["y"],
                                "width": r["aabb"]["w"],
                                "height": r["aabb"]["h"]
                            },
                            "text": r["text"],
                            "confidence": r["confidence"],
                            "orientation": normalize_orientation(r["direction"]),
                            "detector": "default",
                            "recognizer": "ocr48px"
                        })
                        
            status = "success" if regions_result else "no_text"
        except requests.exceptions.ConnectionError as ce:
            errors.append(f"ConnectionError: manga-engine is unavailable. Details: {ce}")
            status = "unavailable"
        except Exception as e:
            errors.append(f"Pipeline error: {str(e)}")
            errors.append(traceback.format_exc())
            status = "failed"
            
        return {
            "engine": "manga-image-translator-default",
            "status": status,
            "regions": regions_result,
            "errors": errors,
            "processingTimeMs": int((time.time() - start_time) * 1000),
            "detector": "default",
            "recognizer": "ocr48px"
        }

    def execute_hybrid_pipeline(
        self,
        img_path: str,
        img: np.ndarray,
        language: str,
        detector_name: str,
        pipeline_label: str
    ) -> Dict[str, Any]:
        """
        Pipeline B/C: manga-engine detector + manga-ocr for Japanese / paddle-engine recognize for EN/KO.
        """
        start_time = time.time()
        errors = []
        regions_result = []
        status = "no_text"
        
        try:
            # 1. Get detector polygons
            with open(img_path, "rb") as f:
                r_det = requests.post(
                    f"{MANGA_ENGINE_URL}/detect",
                    files={"image": f},
                    data={"detector": detector_name},
                    timeout=60
                )
            if r_det.status_code != 200:
                raise RuntimeError(f"manga-engine /detect ({detector_name}) failed: {r_det.status_code} - {r_det.text}")
                
            det_res = r_det.json()
            if det_res.get("errors"):
                errors.extend(det_res["errors"])
                raise RuntimeError(f"Detector reported internal errors: {det_res['errors']}")
                
            detected_regions = det_res.get("regions", [])
            
            if detected_regions:
                if language == "ja":
                    # Japanese recognition using manga-ocr inside manga-engine
                    with open(img_path, "rb") as f:
                        r_ocr = requests.post(
                            f"{MANGA_ENGINE_URL}/recognize-japanese",
                            files={"image": f},
                            data={
                                "regions": json.dumps(detected_regions),
                                "recognizer": "manga-ocr"
                            },
                            timeout=60
                        )
                    if r_ocr.status_code != 200:
                        raise RuntimeError(f"manga-engine /recognize-japanese failed: {r_ocr.status_code} - {r_ocr.text}")
                        
                    ocr_res = r_ocr.json()
                    if ocr_res.get("errors"):
                        errors.extend(ocr_res["errors"])
                        status = "failed"
                    else:
                        for r in ocr_res.get("regions", []):
                            regions_result.append({
                                "id": r["id"],
                                "polygon": {"points": [{"x": float(p[0]), "y": float(p[1])} for p in r["pts"]]},
                                "boundingBox": {
                                    "x": r["aabb"]["x"],
                                    "y": r["aabb"]["y"],
                                    "width": r["aabb"]["w"],
                                    "height": r["aabb"]["h"]
                                },
                                "text": r["text"],
                                "confidence": r["confidence"],
                                "orientation": normalize_orientation(r["direction"]),
                                "detector": detector_name,
                                "recognizer": "manga-ocr"
                            })
                        status = "success" if regions_result else "no_text"
                else:
                    # English/Korean recognition: orchestrator crops region and sends to paddle-engine
                    crop_files = []
                    valid_indices = []
                    failed_crops = 0
                    empty_crops = 0
                    successful_crops = 0
                    
                    # Create temporary crop image files to send via multipart
                    temp_files_to_cleanup = []
                    try:
                        for idx, r in enumerate(detected_regions):
                            crop_img = None
                            crop_success = False
                            
                            # Try perspective warp crop first
                            try:
                                crop_img = crop_polygon_perspective(img, r["pts"])
                                crop_success = True
                            except Exception as ex:
                                # Fallback to bounded AABB crop
                                try:
                                    crop_img = crop_polygon_aabb(img, r["pts"])
                                    crop_success = True
                                except Exception as aabb_ex:
                                    errors.append(f"Crop failure on region_{idx + 1}: perspective: {ex}; AABB: {aabb_ex}")
                                    failed_crops += 1
                                    
                            if crop_success and crop_img is not None and crop_img.size > 0:
                                temp_fd, temp_path = tempfile.mkstemp(suffix=".png")
                                os.close(temp_fd)
                                cv2.imwrite(temp_path, crop_img)
                                temp_files_to_cleanup.append(temp_path)
                                
                                crop_files.append(("files", open(temp_path, "rb")))
                                valid_indices.append(idx)
                            else:
                                if crop_success:
                                    errors.append(f"Crop on region_{idx + 1} produced empty image.")
                                    failed_crops += 1
                                
                        # Call paddle-engine /recognize
                        if crop_files:
                            r_paddle = requests.post(
                                f"{PADDLE_ENGINE_URL}/recognize",
                                files=crop_files,
                                data={"language": language},
                                timeout=60
                            )
                            
                            # Close the files so we can delete them
                            for name, f_obj in crop_files:
                                f_obj.close()
                                
                            if r_paddle.status_code != 200:
                                raise RuntimeError(f"paddle-engine /recognize failed: {r_paddle.status_code} - {r_paddle.text}")
                                
                            paddle_res = r_paddle.json()
                            if paddle_res.get("error"):
                                raise RuntimeError(f"paddle-engine reported error: {paddle_res['error']}")
                                
                            results = paddle_res.get("results", [])
                            
                            for loop_idx, res_item in enumerate(results):
                                original_idx = valid_indices[loop_idx]
                                orig_region = detected_regions[original_idx]
                                
                                if res_item.get("error"):
                                    errors.append(f"Crop {original_idx + 1} recognition error: {res_item['error']}")
                                    failed_crops += 1
                                    continue
                                    
                                recognized_text = res_item.get("text", "").strip()
                                # Empty recognition yields no region
                                if not recognized_text:
                                    empty_crops += 1
                                    continue
                                    
                                successful_crops += 1
                                regions_result.append({
                                    "id": orig_region["id"],
                                    "polygon": {"points": [{"x": float(p[0]), "y": float(p[1])} for p in orig_region["pts"]]},
                                    "boundingBox": {
                                        "x": orig_region["aabb"]["x"],
                                        "y": orig_region["aabb"]["y"],
                                        "width": orig_region["aabb"]["w"],
                                        "height": orig_region["aabb"]["h"]
                                    },
                                    "text": recognized_text,
                                    "confidence": res_item.get("confidence", 1.0),
                                    "orientation": normalize_orientation(orig_region["direction"]),
                                    "detector": detector_name,
                                    "recognizer": f"paddleocr-{language}"
                                })
                        else:
                            # All crops failed to generate
                            pass
                    finally:
                        # Clean up crops
                        for tp in temp_files_to_cleanup:
                            if os.path.exists(tp):
                                os.remove(tp)
                                
                    if successful_crops > 0:
                        status = "success"
                    elif failed_crops > 0:
                        status = "failed"
                    else:
                        status = "no_text"
            else:
                status = "no_text"
        except requests.exceptions.ConnectionError as ce:
            errors.append(f"ConnectionError: Services unavailable. Details: {ce}")
            status = "unavailable"
        except Exception as e:
            errors.append(f"Pipeline error: {str(e)}")
            errors.append(traceback.format_exc())
            status = "failed"
            
        return {
            "engine": pipeline_label,
            "status": status,
            "regions": regions_result,
            "errors": errors,
            "processingTimeMs": int((time.time() - start_time) * 1000),
            "detector": detector_name,
            "recognizer": f"manga-ocr" if language == "ja" else f"paddleocr-{language}"
        }

    def execute_pipeline_d(self, img_path: str, img: np.ndarray, language: str) -> Dict[str, Any]:
        """
        Pipeline D: paddle-engine standalone detection and recognition.
        """
        start_time = time.time()
        errors = []
        regions_result = []
        
        try:
            with open(img_path, "rb") as f:
                r_paddle = requests.post(
                    f"{PADDLE_ENGINE_URL}/detect-recognize",
                    files={"image": f},
                    data={"language": language},
                    timeout=60
                )
            if r_paddle.status_code != 200:
                raise RuntimeError(f"paddle-engine /detect-recognize failed: {r_paddle.status_code} - {r_paddle.text}")
                
            paddle_res = r_paddle.json()
            if paddle_res.get("errors"):
                errors.extend(paddle_res["errors"])
                raise RuntimeError(f"paddle-engine reported error: {paddle_res['errors']}")
                
            for idx, r in enumerate(paddle_res.get("regions", [])):
                pts = r["pts"]
                pts_np = np.array(pts)
                x_min, y_min = pts_np.min(axis=0)
                x_max, y_max = pts_np.max(axis=0)
                w_box = x_max - x_min
                h_box = y_max - y_min
                
                regions_result.append({
                    "id": f"region_{idx + 1}",
                    "polygon": {"points": [{"x": float(pt[0]), "y": float(pt[1])} for pt in pts]},
                    "boundingBox": {
                        "x": int(x_min),
                        "y": int(y_min),
                        "width": int(w_box),
                        "height": int(h_box)
                    },
                    "text": r["text"],
                    "confidence": r["confidence"],
                    "orientation": "vertical" if h_box > w_box * 1.5 else "horizontal",
                    "detector": "paddleocr",
                    "recognizer": f"paddleocr-{language}"
                })
                
            status = "success" if regions_result else "no_text"
        except requests.exceptions.ConnectionError as ce:
            errors.append(f"ConnectionError: paddle-engine is unavailable. Details: {ce}")
            status = "unavailable"
        except Exception as e:
            errors.append(f"Pipeline error: {str(e)}")
            errors.append(traceback.format_exc())
            status = "failed"
            
        return {
            "engine": "paddleocr-standalone",
            "status": status,
            "regions": regions_result,
            "errors": errors,
            "processingTimeMs": int((time.time() - start_time) * 1000),
            "detector": "paddleocr",
            "recognizer": f"paddleocr-{language}"
        }


def main():
    parser = argparse.ArgumentParser(description="MangaLens OCR Benchmark Lightweight HTTP Orchestrator")
    parser.add_argument("--input", help="Path to input samples folder or single image file")
    parser.add_argument("--output", help="Path to results directory")
    parser.add_argument("--language", default="ko", choices=["ko", "ja", "en"], help="Target language (ko, ja, en)")
    parser.add_argument("--engines", default="all", help="Comma-separated list of engines (ctd, paddle, dbconvnext, default, all)")
    parser.add_argument("--demo", action="store_true", help="Run in mock/demo fallback mode without backend service queries")
    parser.add_argument("--check-engines", help="Comma-separated list of services to strictly check (e.g. paddle,ctd,dbconvnext,default)")
    parser.add_argument("--cjk-font", help="Path to local CJK-capable TrueType/OpenType font")

    args = parser.parse_args()

    if args.check_engines:
        success = check_services(args.check_engines)
        sys.exit(0 if success else 1)

    if not args.input or not args.output:
        parser.print_help()
        print("\nError: --input and --output are required.", file=sys.stderr)
        sys.exit(1)

    if args.demo:
        run_demo_mode(args.output, args.language, args.cjk_font)
        sys.exit(0)

    images_to_process = []
    if os.path.isfile(args.input):
        images_to_process.append(args.input)
    elif os.path.isdir(args.input):
        for f in os.listdir(args.input):
            if f.lower().endswith((".png", ".jpg", ".jpeg", ".webp", ".bmp")):
                images_to_process.append(os.path.join(args.input, f))
    else:
        try:
            os.makedirs(args.input, exist_ok=True)
            print(f"Created input directory: {args.input}. Please place your clean manga images here and rerun the benchmark.", file=sys.stderr)
        except Exception as e:
            print(f"CRITICAL: Input path '{args.input}' does not exist and could not be created: {e}", file=sys.stderr)
        sys.exit(1)
        
    if not images_to_process:
        print(f"CRITICAL: No image files found to process at: {args.input}", file=sys.stderr)
        sys.exit(1)

    os.makedirs(args.output, exist_ok=True)

    engine_list = [e.strip() for e in args.engines.split(",")]
    
    # Define pipelines to run
    pipelines_to_run = []
    if "all" in engine_list:
        pipelines_to_run = ["default", "ctd", "dbconvnext", "paddle"]
    else:
        for el in engine_list:
            if el in ["default", "ctd", "dbconvnext", "paddle"]:
                pipelines_to_run.append(el)

    runner = PipelineRunner(args.cjk_font)
    colors = {
        "manga-image-translator-default": (0, 200, 0),
        "manga-image-translator-ctd": (200, 200, 0),
        "dbnet-mangaocr-paddleocr": (200, 0, 200),
        "paddleocr-standalone": (0, 128, 255)
    }

    benchmark_results = {}
    any_pipeline_failed = False

    for img_path in images_to_process:
        img_name = os.path.basename(img_path)
        benchmark_results[img_name] = {}
        
        img = cv2.imread(img_path)
        if img is None:
            print(f"Error: Could not load image {img_path}", file=sys.stderr)
            continue
            
        print(f"\nProcessing image: {img_name}")
        
        # Pipeline A
        if "default" in pipelines_to_run:
            print("  Running Pipeline A (default)...")
            res = runner.execute_pipeline_a(img_path, img, args.language)
            if res["status"] in ["failed", "unavailable"]:
                any_pipeline_failed = True
            if res["status"] in ["success", "no_text"]:
                color = colors["manga-image-translator-default"]
                annotated_img = draw_annotations(img_path, res, color, args.cjk_font)
                annotated_path = os.path.join(args.output, f"annotated_manga-image-translator-default_{img_name}")
                cv2.imwrite(annotated_path, annotated_img)
                res["annotatedPath"] = annotated_path
            benchmark_results[img_name][res["engine"]] = res

        # Pipeline B
        if "ctd" in pipelines_to_run:
            print("  Running Pipeline B (ctd)...")
            res = runner.execute_hybrid_pipeline(img_path, img, args.language, "ctd", "manga-image-translator-ctd")
            if res["status"] in ["failed", "unavailable"]:
                any_pipeline_failed = True
            if res["status"] in ["success", "no_text"]:
                color = colors["manga-image-translator-ctd"]
                annotated_img = draw_annotations(img_path, res, color, args.cjk_font)
                annotated_path = os.path.join(args.output, f"annotated_manga-image-translator-ctd_{img_name}")
                cv2.imwrite(annotated_path, annotated_img)
                res["annotatedPath"] = annotated_path
            benchmark_results[img_name][res["engine"]] = res

        # Pipeline C (Strict DBConvNext, no silent fallback!)
        if "dbconvnext" in pipelines_to_run:
            print("  Running Pipeline C (dbconvnext)...")
            res = runner.execute_hybrid_pipeline(img_path, img, args.language, "dbconvnext", "dbnet-mangaocr-paddleocr")
            if res["status"] in ["failed", "unavailable"]:
                any_pipeline_failed = True
            if res["status"] in ["success", "no_text"]:
                color = colors["dbnet-mangaocr-paddleocr"]
                annotated_img = draw_annotations(img_path, res, color, args.cjk_font)
                annotated_path = os.path.join(args.output, f"annotated_dbnet-mangaocr-paddleocr_{img_name}")
                cv2.imwrite(annotated_path, annotated_img)
                res["annotatedPath"] = annotated_path
            benchmark_results[img_name][res["engine"]] = res

        # Pipeline D
        if "paddle" in pipelines_to_run:
            print("  Running Pipeline D (paddle standalone)...")
            res = runner.execute_pipeline_d(img_path, img, args.language)
            if res["status"] in ["failed", "unavailable"]:
                any_pipeline_failed = True
            if res["status"] in ["success", "no_text"]:
                color = colors["paddleocr-standalone"]
                annotated_img = draw_annotations(img_path, res, color, args.cjk_font)
                annotated_path = os.path.join(args.output, f"annotated_paddleocr-standalone_{img_name}")
                cv2.imwrite(annotated_path, annotated_img)
                res["annotatedPath"] = annotated_path
            benchmark_results[img_name][res["engine"]] = res

    # Write output files
    report_json_path = os.path.join(args.output, "report.json")
    with open(report_json_path, "w", encoding="utf-8") as f:
        json.dump(benchmark_results, f, indent=2, ensure_ascii=False)
        
    # Generate HTML grid
    generate_comparison_html(args.output, benchmark_results, args.input)
    print(f"\nOrchestrator run finished. Results saved at: {args.output}")

    if any_pipeline_failed:
        print("\nCRITICAL: One or more pipelines reported status failed or unavailable.", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
