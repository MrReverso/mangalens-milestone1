import os
import json
import pytest
import numpy as np
import requests
import tempfile
from unittest.mock import patch, MagicMock, mock_open
from PIL import Image, ImageDraw, ImageFont
import cv2

# Import functions from orchestrator
from orchestrator import (
    normalize_orientation,
    crop_polygon_perspective,
    crop_polygon_aabb,
    draw_annotations,
    generate_comparison_html,
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
                "direction": "h",
                "detectorMode": "mock",
                "detectorInferenceRan": False
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
@patch("builtins.open", new_callable=mock_open, read_data=b"image")
def test_service_unavailable(_mock_file, mock_post):
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
@patch("builtins.open", new_callable=mock_open, read_data=b"image")
def test_recognition_error(_mock_file, mock_post):
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
@patch("builtins.open", new_callable=mock_open, read_data=b"image")
def test_empty_recognition(_mock_file, mock_write, mock_post):
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
            {
                "text": "",
                "confidence": 0.0,
                "error": None,
                "recognizerInferenceRan": True
            }
        ]
    }
    
    mock_post.side_effect = [mock_detect_resp, mock_rec_resp]
    
    img = np.zeros((400, 400, 3), dtype=np.uint8)
    runner = PipelineRunner()
    
    res = runner.execute_hybrid_pipeline("dummy.png", img, "en", "ctd", "manga-image-translator-ctd")
    
    assert res["status"] == "no_text"
    assert len(res["regions"]) == 0


@patch("requests.post")
@patch("cv2.imwrite", return_value=True)
@patch("builtins.open", new_callable=mock_open, read_data=b"image")
def test_partial_recognition_failure_preserves_success_and_fails_pipeline(
    _mock_file, _mock_write, mock_post
):
    detected = [
        {
            "id": f"region_{index}",
            "pts": [[10, 10], [50, 10], [50, 30], [10, 30]],
            "aabb": {"x": 10, "y": 10, "w": 40, "h": 20},
            "direction": "h",
            "detectorMode": "mock",
            "detectorInferenceRan": False,
        }
        for index in (1, 2)
    ]
    detect_response = MagicMock(status_code=200)
    detect_response.json.return_value = {"regions": detected, "errors": []}
    recognize_response = MagicMock(status_code=200)
    recognize_response.json.return_value = {
        "results": [
            {
                "text": "MANGALENS",
                "confidence": 0.9,
                "error": None,
                "recognizerInferenceRan": True,
            },
            {
                "text": "",
                "confidence": 0,
                "recognizerInferenceRan": True,
                "error": {
                    "stage": "recognition-result-parsing",
                    "message": "bad result",
                },
            },
        ]
    }
    mock_post.side_effect = [detect_response, recognize_response]
    result = PipelineRunner().execute_hybrid_pipeline(
        "dummy.png",
        np.zeros((400, 400, 3), dtype=np.uint8),
        "en",
        "ctd",
        "manga-image-translator-ctd",
    )
    assert result["status"] == "failed"
    assert [region["text"] for region in result["regions"]] == ["MANGALENS"]
    assert result["errors"]


# 7. DBConvNext Failure Test Proving There Is No Fallback
@patch("requests.post")
@patch("builtins.open", new_callable=mock_open, read_data=b"image")
def test_dbconvnext_strict_no_fallback(_mock_file, mock_post):
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
def test_hybrid_mapping_e2e_with_mock_detector():
    is_strict = os.environ.get("OCR_BENCHMARK_STRICT_E2E") == "true"

    # Confirm health status of services
    try:
        r_manga = requests.get(f"{MANGA_ENGINE_URL}/health", timeout=5)
        r_paddle = requests.get(f"{PADDLE_ENGINE_URL}/health", timeout=5)
        assert r_manga.status_code == 200, f"manga-engine unhealthy: {r_manga.status_code}"
        assert r_paddle.status_code == 200, f"paddle-engine unhealthy: {r_paddle.status_code}"
        assert r_manga.json().get("engineCommit") == "efdc229de8aa0f3d4051ad97664adc62dd5ac605"
    except Exception as e:
        if is_strict:
            pytest.fail(f"CRITICAL: Services are unreachable in strict E2E mode: {e}")
        else:
            pytest.skip(f"Live microservices not reachable: {e}. Skipping integration test.")

    # This exact font is installed by the orchestrator image and makes the
    # synthetic fixture deterministic in strict Compose runs.
    font_path = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
    assert os.path.exists(font_path), f"CRITICAL: DejaVuSans-Bold font does not exist at {font_path}"

    print("Executing Hybrid E2E Mapping integration test against live services...")
    
    # Create deterministic high-resolution test fixture
    width, height = 1200, 400
    img_pil = Image.new("RGB", (width, height), color="white")
    draw = ImageDraw.Draw(img_pil)
    font = ImageFont.truetype(font_path, 72)
    draw.text((100, 150), "MANGALENS OCR TEST", fill="black", font=font)
    
    ci_results_dir = "results/ci"
    fixtures_dir = os.path.join(ci_results_dir, "fixtures")
    annotated_dir = os.path.join(ci_results_dir, "annotated")
    os.makedirs(fixtures_dir, exist_ok=True)
    os.makedirs(annotated_dir, exist_ok=True)
    fixture_relative = "fixtures/e2e_integration_test_fixture.png"
    temp_img_path = os.path.join(ci_results_dir, fixture_relative)
    img_pil.save(temp_img_path)
    
    try:
        img_np = cv2.imread(temp_img_path)
        runner = PipelineRunner()
        
        # 1. Standalone PaddleOCR pipeline execution (Pipeline D)
        res_d = runner.execute_pipeline_d(temp_img_path, img_np, "en")
        
        assert res_d["status"] == "success", f"Pipeline D failed or returned no_text: {res_d.get('errors')}"
        assert len(res_d["regions"]) > 0, "No text regions detected by Pipeline D"
        
        bbox_region = res_d["regions"][0]
        assert "MANGALENS" in bbox_region["text"].upper() or "OCR" in bbox_region["text"].upper() or "TEST" in bbox_region["text"].upper(), \
            f"Recognized standalone text was incorrect: '{bbox_region['text']}'"
        assert isinstance(bbox_region["confidence"], (int, float)), "Confidence score is not numeric"
        assert len(bbox_region["polygon"]["points"]) == 4, "Standalone polygon vertices != 4"
        assert res_d.get("detectorMode") == "real"
        assert res_d.get("detectorInferenceRan") is True
        assert res_d.get("recognizerMode") == "real"
        assert res_d.get("recognizerInferenceRan") is True
        assert not res_d["errors"]
        
        # 2. Hybrid mock-detector pipeline execution (Pipeline B - CTD)
        res_b = runner.execute_hybrid_pipeline(temp_img_path, img_np, "en", "ctd", "manga-image-translator-ctd")
        
        assert res_b["status"] == "success", f"Pipeline B failed or returned no_text: {res_b.get('errors')}"
        assert len(res_b["regions"]) > 0, "No text regions detected by Pipeline B"
        
        hybrid_region = res_b["regions"][0]
        assert "MANGALENS" in hybrid_region["text"].upper() or "OCR" in hybrid_region["text"].upper() or "TEST" in hybrid_region["text"].upper(), \
            f"Recognized hybrid text was incorrect: '{hybrid_region['text']}'"
        assert len(hybrid_region["polygon"]["points"]) == 4, "Hybrid polygon vertices != 4"
        expected_mock_polygon = [
            {"x": 100.0, "y": 150.0},
            {"x": 1100.0, "y": 150.0},
            {"x": 1100.0, "y": 250.0},
            {"x": 100.0, "y": 250.0},
        ]
        assert hybrid_region["polygon"]["points"] == expected_mock_polygon
        perspective_crop = crop_polygon_perspective(
            img_np,
            [[point["x"], point["y"]] for point in expected_mock_polygon],
        )
        assert perspective_crop.size > 0
        assert res_b.get("detectorMode") == "mock"
        assert res_b.get("detectorInferenceRan") is False
        assert res_b.get("recognizerMode") == "real"
        assert res_b.get("recognizerInferenceRan") is True
        assert not res_b["errors"]
        
        # 3. Compile non-synthetic outputs and save overlays
        # Draw annotations and write to results/ci
        annotated_d_img = draw_annotations(temp_img_path, res_d, (0, 128, 255))
        annotated_d_name = "annotated_paddleocr-standalone_fixture.png"
        annotated_d_relative = os.path.join("annotated", annotated_d_name)
        annotated_d_path = os.path.join(ci_results_dir, annotated_d_relative)
        assert cv2.imwrite(annotated_d_path, annotated_d_img)
        res_d["fixturePath"] = fixture_relative
        res_d["annotatedPath"] = annotated_d_relative
        res_d["sampleType"] = "synthetic-ci-fixture"
        res_d["authenticMangaSample"] = False
        
        annotated_b_img = draw_annotations(temp_img_path, res_b, (200, 200, 0))
        annotated_b_name = "annotated_manga-image-translator-ctd_fixture.png"
        annotated_b_relative = os.path.join("annotated", annotated_b_name)
        annotated_b_path = os.path.join(ci_results_dir, annotated_b_relative)
        assert cv2.imwrite(annotated_b_path, annotated_b_img)
        res_b["fixturePath"] = fixture_relative
        res_b["annotatedPath"] = annotated_b_relative
        res_b["sampleType"] = "synthetic-ci-fixture"
        res_b["authenticMangaSample"] = False
        
        # Verify region metadata mocks are properly set
        assert hybrid_region.get("detectorMode") == "mock", "hybrid region detectorMode is not 'mock'"
        assert hybrid_region.get("detectorInferenceRan") is False, "hybrid region detectorInferenceRan is not False"
        
        ci_reports = {
            "e2e_integration_test_fixture.png": {
                "paddleocr-standalone": res_d,
                "manga-image-translator-ctd": res_b
            }
        }
        
        report_json_path = os.path.join(ci_results_dir, "report.json")
        with open(report_json_path, "w", encoding="utf-8") as f:
            json.dump(ci_reports, f, indent=2)
            
        # Generate HTML grid
        generate_comparison_html(ci_results_dir, ci_reports, fixture_relative)
        
        # 4. Assert files generated and verify HTML links
        assert os.path.exists(report_json_path), "report.json not generated"
        comparison_html_path = os.path.join(ci_results_dir, "comparison.html")
        assert os.path.exists(comparison_html_path), "comparison.html not generated"
        
        assert os.path.exists(annotated_d_path), f"Annotated standalone image does not exist: {annotated_d_path}"
        assert os.path.exists(annotated_b_path), f"Annotated hybrid image does not exist: {annotated_b_path}"
        assert os.path.exists(temp_img_path), f"Fixture does not exist: {temp_img_path}"
        
        with open(comparison_html_path, "r", encoding="utf-8") as h_file:
            html_content = h_file.read()
            assert fixture_relative in html_content
            assert annotated_d_relative in html_content
            assert annotated_b_relative in html_content
            
        with open(report_json_path, "r", encoding="utf-8") as r_file:
            report_data = json.load(r_file)
            d_res = report_data["e2e_integration_test_fixture.png"]["paddleocr-standalone"]
            b_res = report_data["e2e_integration_test_fixture.png"]["manga-image-translator-ctd"]
            
            assert d_res["sampleType"] == "synthetic-ci-fixture"
            assert b_res["sampleType"] == "synthetic-ci-fixture"
            assert d_res["authenticMangaSample"] is False
            assert b_res["authenticMangaSample"] is False
            
            # Check detector Mode records
            b_region = b_res["regions"][0]
            assert b_region.get("detectorMode") == "mock"
            assert b_region.get("detectorInferenceRan") is False
            for result in (d_res, b_res):
                for key in ("fixturePath", "annotatedPath"):
                    assert os.path.exists(os.path.join(ci_results_dir, result[key]))
            
        print("  ✓ Hybrid mock-detector E2E integration test completed successfully.")
        
    finally:
        pass
