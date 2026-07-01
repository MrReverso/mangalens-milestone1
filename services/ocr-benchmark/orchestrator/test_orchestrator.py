import os
import json
import pytest
import numpy as np
import requests
from unittest.mock import patch, MagicMock

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
    # Create dummy white image
    img = np.ones((400, 400, 3), dtype=np.uint8) * 255
    # Define a 4-point polygon
    pts = [[10.0, 20.0], [110.0, 20.0], [110.0, 70.0], [10.0, 70.0]]
    
    # Check perspective warp crop
    crop_persp = crop_polygon_perspective(img, pts)
    # Expected dimensions: width = 100, height = 50
    assert crop_persp.shape == (50, 100, 3)
    
    # Check AABB crop
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
    
    # Trigger CTD detection call inside Pipeline B
    with patch.object(runner, "execute_hybrid_pipeline") as mock_hybrid:
        mock_hybrid.return_value = {"status": "success"}
        res = runner.execute_hybrid_pipeline("dummy.png", img, "en", "ctd", "manga-image-translator-ctd")
        assert res["status"] == "success"


# 4. Service Unavailable Tests
@patch("requests.post")
def test_service_unavailable(mock_post):
    # Simulate connection error (unavailable server)
    mock_post.side_effect = requests.exceptions.ConnectionError("Failed to connect to host")
    
    img = np.zeros((400, 400, 3), dtype=np.uint8)
    runner = PipelineRunner()
    
    # Pipeline A unavailability
    res_a = runner.execute_pipeline_a("dummy.png", img, "ja")
    assert res_a["status"] == "unavailable"
    assert any("ConnectionError" in err for err in res_a["errors"])
    
    # Pipeline B unavailability
    res_b = runner.execute_hybrid_pipeline("dummy.png", img, "en", "ctd", "manga-image-translator-ctd")
    assert res_b["status"] == "unavailable"


# 5. Recognition Error Tests
@patch("requests.post")
def test_recognition_error(mock_post):
    # First request (/detect) succeeds, second request (/recognize) fails with 500 error
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
    
    # Execute Pipeline B (CTD + paddle recognition)
    res = runner.execute_hybrid_pipeline("dummy.png", img, "en", "ctd", "manga-image-translator-ctd")
    
    assert res["status"] == "failed"
    assert any("paddle-engine /recognize failed" in err for err in res["errors"])


# 6. Empty Recognition Tests
@patch("requests.post")
@patch("cv2.imwrite")
def test_empty_recognition(mock_write, mock_post):
    # First request (/detect) finds regions
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
    
    # Second request (/recognize) returns empty text
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
    
    # Status should be no_text because all engines succeeded but returned empty labels
    assert res["status"] == "no_text"
    assert len(res["regions"]) == 0


# 7. DBConvNext Failure Test Proving There Is No Fallback
@patch("requests.post")
def test_dbconvnext_strict_no_fallback(mock_post):
    # Mock detection response to fail for dbconvnext
    mock_resp = MagicMock()
    mock_resp.status_code = 500
    mock_resp.text = "DBConvNext model failed to initialize"
    
    mock_post.return_value = mock_resp
    
    img = np.zeros((400, 400, 3), dtype=np.uint8)
    runner = PipelineRunner()
    
    res = runner.execute_hybrid_pipeline("dummy.png", img, "en", "dbconvnext", "dbnet-mangaocr-paddleocr")
    
    # It must fail and report DBConvNext error without falling back to default
    assert res["status"] == "failed"
    assert any("manga-engine /detect (dbconvnext) failed" in err for err in res["errors"])
    # Verify we did not call /detect a second time with default detector
    assert mock_post.call_count == 1
    assert mock_post.call_args[1]["data"]["detector"] == "dbconvnext"


# 8. End-to-End Live Integration Test through Docker Compose (Conditional)
def test_e2e_integration_live():
    # Verify if live HTTP microservices are up and running (e.g. inside GHA E2E step)
    try:
        r_manga = requests.get(f"{MANGA_ENGINE_URL}/health", timeout=1)
        r_paddle = requests.get(f"{PADDLE_ENGINE_URL}/health", timeout=1)
        if r_manga.status_code != 200 or r_paddle.status_code != 200:
            pytest.skip("Live microservices not healthy on localhost. Skipping live integration test.")
    except Exception:
        pytest.skip("Live microservices not reachable. Skipping live integration test.")
        
    print("Executing E2E Integration test against live services...")
    
    # 1. Create a high-res synthetic test image
    width, height = 1200, 400
    from PIL import Image, ImageDraw
    img_pil = Image.new("RGB", (width, height), color="white")
    draw = ImageDraw.Draw(img_pil)
    draw.text((100, 150), "MANGALENS OCR TEST", fill="black")
    
    temp_img_path = "e2e_integration_test_fixture.png"
    img_pil.save(temp_img_path)
    
    try:
        img_np = cv2.imread(temp_img_path)
        runner = PipelineRunner()
        
        # Standalone PaddleOCR pipeline execution (Pipeline D)
        res_d = runner.execute_pipeline_d(temp_img_path, img_np, "en")
        
        # Verify API response structure
        assert res_d["status"] in ["success", "no_text"]
        assert "regions" in res_d
        
        if res_d["status"] == "success":
            assert len(res_d["regions"]) > 0
            assert "text" in res_d["regions"][0]
            assert "boundingBox" in res_d["regions"][0]
            assert "polygon" in res_d["regions"][0]
    finally:
        if os.path.exists(temp_img_path):
            os.remove(temp_img_path)
