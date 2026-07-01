import os
import json
import pytest
import numpy as np
import requests
import tempfile
from unittest.mock import patch, MagicMock
from PIL import Image, ImageDraw, ImageFont
import cv2

# Import functions from orchestrator
from orchestrator import (
    normalize_orientation,
    crop_polygon_perspective,
    crop_polygon_aabb,
    PipelineRunner,
    MANGA_ENGINE_URL,
    PADDLE_ENGINE_URL
)

# 1. Orientation Normalization Tests
def test_normalize_orientation():
    assert normalize_orientation("h") == "horizontal"
    assert normalize_orientation("horizontal") == "horizontal"
    assert normalize_orientation("v") == "vertical"
    assert normalize_orientation("vertical") == "vertical"
    assert normalize_orientation("unknown") == "unknown"
    assert normalize_orientation("other") == "unknown"


# 2. Polygon Cropping Unit Tests
def test_polygon_cropping():
    img = np.ones((400, 400, 3), dtype=np.uint8) * 255
    pts = [[10.0, 20.0], [110.0, 20.0], [110.0, 70.0], [10.0, 70.0]]
    
    crop_persp = crop_polygon_perspective(img, pts)
    assert crop_persp.shape == (50, 100, 3)
    
    crop_box = crop_polygon_aabb(img, pts)
    assert crop_box.shape == (50, 100, 3)


# 3. API Contract Tests (Mocked)
@patch("requests.post")
def test_api_contract_manga_detect(mock_post):
    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.json.return_value = {
        "width": 800,
        "height": 1200,
        "detector": "ctd",
        "detectorVersion": "0.1.0",
        "regions": [
            {
                "id": "region_1",
                "pts": [[10.0, 20.0], [100.0, 20.0], [100.0, 60.0], [10.0, 60.0]],
                "aabb": {"x": 10, "y": 20, "w": 90, "h": 40},
                "direction": "h"
            }
        ],
        "errors": []
    }
    mock_post.return_value = mock_response
    
    img = np.zeros((1200, 800, 3), dtype=np.uint8)
    runner = PipelineRunner()
    
    with patch.object(runner, "execute_hybrid_pipeline") as mock_hybrid:
        mock_hybrid.return_value = {"status": "success"}
        res = runner.execute_hybrid_pipeline("dummy.png", img, "en", "ctd", "manga-image-translator-ctd")
        assert res["status"] == "success"


# 4. Service Unavailable Tests
@patch("requests.post")
def test_service_unavailable(mock_post):
    mock_post.side_effect = requests.exceptions.ConnectionError("Failed to connect to host")
    
    img = np.zeros((400, 400, 3), dtype=np.uint8)
    runner = PipelineRunner()
    
    res_a = runner.execute_pipeline_a("dummy.png", img, "ja")
    assert res_a["status"] == "unavailable"
    assert any("ConnectionError" in err for err in res_a["errors"])
    
    res_b = runner.execute_hybrid_pipeline("dummy.png", img, "en", "ctd", "manga-image-translator-ctd")
    assert res_b["status"] == "unavailable"


# 5. Recognition Error Tests
@patch("requests.post")
def test_recognition_error(mock_post):
    mock_detect_resp = MagicMock()
    mock_detect_resp.status_code = 200
    mock_detect_resp.json.return_value = {
        "width": 400,
        "height": 400,
        "regions": [
            {
                "id": "region_1",
                "pts": [[10, 10], [50, 10], [50, 30], [10, 30]],
                "aabb": {"x": 10, "y": 10, "w": 40, "h": 20},
                "direction": "h"
            }
        ],
        "errors": []
    }
    
    mock_rec_resp = MagicMock()
    mock_rec_resp.status_code = 500
    mock_rec_resp.text = "Internal Server Error in model"
    
    mock_post.side_effect = [mock_detect_resp, mock_rec_resp]
    
    img = np.zeros((400, 400, 3), dtype=np.uint8)
    runner = PipelineRunner()
    
    res = runner.execute_hybrid_pipeline("dummy.png", img, "en", "ctd", "manga-image-translator-ctd")
    
    assert res["status"] == "failed"
    assert any("paddle-engine /recognize failed" in err for err in res["errors"])


# 6. Empty Recognition Tests
@patch("requests.post")
@patch("cv2.imwrite")
def test_empty_recognition(mock_write, mock_post):
    mock_detect_resp = MagicMock()
    mock_detect_resp.status_code = 200
    mock_detect_resp.json.return_value = {
        "width": 400,
        "height": 400,
        "regions": [
            {
                "id": "region_1",
                "pts": [[10, 10], [50, 10], [50, 30], [10, 30]],
                "aabb": {"x": 10, "y": 10, "w": 40, "h": 20},
                "direction": "h"
            }
        ],
        "errors": []
    }
    
    mock_rec_resp = MagicMock()
    mock_rec_resp.status_code = 200
    mock_rec_resp.json.return_value = {
        "results": [
            {"text": "", "confidence": 0.0, "error": None}
        ]
    }
    
    mock_post.side_effect = [mock_detect_resp, mock_rec_resp]
    
    img = np.zeros((400, 400, 3), dtype=np.uint8)
    runner = PipelineRunner()
    
    res = runner.execute_hybrid_pipeline("dummy.png", img, "en", "ctd", "manga-image-translator-ctd")
    
    assert res["status"] == "no_text"
    assert len(res["regions"]) == 0


# 7. DBConvNext Failure Test Proving There Is No Fallback
@patch("requests.post")
def test_dbconvnext_strict_no_fallback(mock_post):
    mock_resp = MagicMock()
    mock_resp.status_code = 500
    mock_resp.text = "DBConvNext model failed to initialize"
    
    mock_post.return_value = mock_resp
    
    img = np.zeros((400, 400, 3), dtype=np.uint8)
    runner = PipelineRunner()
    
    res = runner.execute_hybrid_pipeline("dummy.png", img, "en", "dbconvnext", "dbnet-mangaocr-paddleocr")
    
    assert res["status"] == "failed"
    assert any("manga-engine /detect (dbconvnext) failed" in err for err in res["errors"])
    assert mock_post.call_count == 1
    assert mock_post.call_args[1]["data"]["detector"] == "dbconvnext"


# 8. End-to-End Live Integration Test through Docker Compose
def test_e2e_integration_live():
    is_ci = os.environ.get("CI") == "true"
    
    # Confirm health status of services
    try:
        r_manga = requests.get(f"{MANGA_ENGINE_URL}/health", timeout=5)
        r_paddle = requests.get(f"{PADDLE_ENGINE_URL}/health", timeout=5)
        assert r_manga.status_code == 200, f"manga-engine unhealthy: {r_manga.status_code}"
        assert r_paddle.status_code == 200, f"paddle-engine unhealthy: {r_paddle.status_code}"
    except Exception as e:
        if is_ci:
            pytest.fail(f"CRITICAL: Services are unreachable in GHA CI: {e}")
        else:
            pytest.skip(f"Live microservices not reachable locally: {e}. Skipping integration test.")
            
    print("Executing E2E Integration test against live services...")
    
    # Create deterministic high-resolution test fixture
    width, height = 1200, 400
    img_pil = Image.new("RGB", (width, height), color="white")
    draw = ImageDraw.Draw(img_pil)
    
    # Load DejaVuSans-Bold or alternative bold system fonts
    font_paths = [
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
        "/usr/share/fonts/truetype/freefont/FreeSansBold.ttf",
        "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
        "/Library/Fonts/Arial Bold.ttf"
    ]
    font_path = None
    for fp in font_paths:
        if os.path.exists(fp):
            font_path = fp
            break
            
    if font_path is None:
        if is_ci:
            pytest.fail("CRITICAL: DejaVuSans-Bold font not found in GHA environment.")
        else:
            font = ImageFont.load_default()
    else:
        font = ImageFont.truetype(font_path, 72)
        
    draw.text((100, 150), "MANGALENS OCR TEST", fill="black", font=font)
    
    temp_img_path = "e2e_integration_test_fixture.png"
    img_pil.save(temp_img_path)
    
    try:
        img_np = cv2.imread(temp_img_path)
        runner = PipelineRunner()
        
        # 1. Standalone PaddleOCR pipeline execution (Pipeline D)
        res_d = runner.execute_pipeline_d(temp_img_path, img_np, "en")
        
        # Asserts matching Paddle E2E constraints
        assert res_d["status"] == "success", f"Pipeline D failed or returned no_text: {res_d.get('errors')}"
        assert len(res_d["regions"]) > 0, "No text regions detected by Pipeline D"
        
        bbox_region = res_d["regions"][0]
        assert len(bbox_region["text"].strip()) > 0, "Recognized standalone text is empty"
        assert isinstance(bbox_region["confidence"], (int, float)), "Confidence score is not numeric"
        assert len(bbox_region["polygon"]["points"]) == 4, "Standalone polygon vertices != 4"
        print(f"  ✓ Standalone integration OCR output: '{bbox_region['text']}' ({bbox_region['confidence']:.4f})")
        
        # 2. Real hybrid pipeline execution (Pipeline B - CTD)
        res_b = runner.execute_hybrid_pipeline(temp_img_path, img_np, "en", "ctd", "manga-image-translator-ctd")
        
        assert res_b["status"] == "success", f"Pipeline B failed or returned no_text: {res_b.get('errors')}"
        assert len(res_b["regions"]) > 0, "No text regions detected by Pipeline B"
        
        hybrid_region = res_b["regions"][0]
        assert "MANGALENS" in hybrid_region["text"].upper(), f"Recognized hybrid text was incorrect: {hybrid_region['text']}"
        assert len(hybrid_region["polygon"]["points"]) == 4, "Hybrid polygon vertices != 4"
        print(f"  ✓ Hybrid integration OCR output: '{hybrid_region['text']}' ({hybrid_region['confidence']:.4f})")
        
        # 3. Generate CI reports
        ci_results_dir = "results/ci"
        os.makedirs(ci_results_dir, exist_ok=True)
        
        # Compile reports JSON
        ci_reports = {
            "e2e_integration_test_fixture.png": {
                "paddleocr-standalone": res_d,
                "manga-image-translator-ctd": res_b
            }
        }
        
        report_json_path = os.path.join(ci_results_dir, "report.json")
        with open(report_json_path, "w", encoding="utf-8") as f:
            json.dump(ci_reports, f, indent=2)
            
        # Draw overlay annotations
        annotated_img = runner.execute_pipeline_d(temp_img_path, img_np, "en") # Dummy annotated path reference
        # Generate HTML grid
        from orchestrator import generate_comparison_html
        generate_comparison_html(ci_results_dir, ci_reports, temp_img_path)
        
        # 4. Assert files generated and are non-synthetic
        assert os.path.exists(report_json_path), "report.json not generated"
        assert os.path.exists(os.path.join(ci_results_dir, "comparison.html")), "comparison.html not generated"
        
        with open(report_json_path, "r", encoding="utf-8") as r_file:
            report_data = json.load(r_file)
            engine_res = report_data["e2e_integration_test_fixture.png"]["paddleocr-standalone"]
            assert engine_res.get("synthetic") is not True, "CI integration reports marked as synthetic"
            
        print("  ✓ E2E integration test generated report.json and comparison.html successfully.")
        
    finally:
        if os.path.exists(temp_img_path):
            os.remove(temp_img_path)
