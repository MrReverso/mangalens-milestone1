import os
import json
import traceback
import cv2
import numpy as np
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.responses import JSONResponse
import importlib.metadata

# Import manga-image-translator modules
from manga_translator.config import Detector, Ocr, DetectorConfig, OcrConfig
from manga_translator.detection import dispatch as dispatch_detection, DETECTORS
from manga_translator.ocr import dispatch as dispatch_ocr, OCRS
from manga_translator.utils import Quadrilateral

app = FastAPI(title="MangaLens OCR - Manga Engine Service")

def get_optimal_device() -> str:
    import torch
    if torch.cuda.is_available():
        return "cuda"
    elif hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
        return "mps"
    return "cpu"

@app.get("/health")
def health():
    return {"status": "healthy"}

@app.post("/detect")
async def detect(
    image: UploadFile = File(...),
    detector: str = Form("default")
):
    try:
        contents = await image.read()
        np_arr = np.frombuffer(contents, np.uint8)
        img = cv2.imdecode(np_arr, cv2.IMREAD_COLOR)
        if img is None:
            raise HTTPException(status_code=400, detail="Uploaded file is not a valid image.")
            
        height, width, _ = img.shape
        
        if detector == "default":
            det_key = Detector.default
        elif detector == "ctd":
            det_key = Detector.ctd
        elif detector == "dbconvnext":
            det_key = Detector.dbconvnext
        else:
            raise HTTPException(status_code=400, detail=f"Unsupported detector: {detector}")
            
        device = get_optimal_device()
        
        # Run detection
        detected_regions, raw_mask, mask = await dispatch_detection(
            detector_key=det_key,
            image=img,
            detect_size=2048,
            text_threshold=0.5,
            box_threshold=0.7,
            unclip_ratio=2.3,
            invert=False,
            gamma_correct=False,
            rotate=False,
            auto_rotate=False,
            device=device,
            verbose=False
        )
        
        regions_list = []
        for idx, r in enumerate(detected_regions):
            regions_list.append({
                "id": f"region_{idx + 1}",
                "pts": r.pts.tolist(),
                "aabb": {
                    "x": int(r.aabb.x),
                    "y": int(r.aabb.y),
                    "w": int(r.aabb.w),
                    "h": int(r.aabb.h)
                },
                "direction": r.direction
            })
            
        version_str = importlib.metadata.version("manga-image-translator")
        return {
            "width": width,
            "height": height,
            "detector": detector,
            "detectorVersion": version_str,
            "regions": regions_list,
            "errors": []
        }
    except Exception as e:
        return JSONResponse(
            status_code=500,
            content={
                "width": 0,
                "height": 0,
                "detector": detector,
                "detectorVersion": "",
                "regions": [],
                "errors": [str(e), traceback.format_exc()]
            }
        )

@app.post("/recognize-japanese")
async def recognize_japanese(
    image: UploadFile = File(...),
    regions: str = Form(...),
    recognizer: str = Form("manga-ocr")
):
    try:
        contents = await image.read()
        np_arr = np.frombuffer(contents, np.uint8)
        img = cv2.imdecode(np_arr, cv2.IMREAD_COLOR)
        if img is None:
            raise HTTPException(status_code=400, detail="Uploaded file is not a valid image.")
            
        regions_data = json.loads(regions)
        quadrilaterals = []
        
        for r_dict in regions_data:
            pts = np.array(r_dict["pts"], dtype=np.float32)
            q = Quadrilateral(pts, text="", prob=0.0)
            q.direction = r_dict.get("direction", "h")
            quadrilaterals.append(q)
            
        if recognizer == "manga-ocr":
            ocr_key = Ocr.mocr
            config = OcrConfig(ocr=Ocr.mocr)
        elif recognizer == "ocr48px":
            ocr_key = Ocr.ocr48px
            config = OcrConfig(ocr=Ocr.ocr48px)
        else:
            raise HTTPException(status_code=400, detail=f"Unsupported recognizer: {recognizer}")
            
        device = get_optimal_device()
        
        ocr_regions = await dispatch_ocr(
            ocr_key=ocr_key,
            image=img,
            regions=quadrilaterals,
            config=config,
            device=device,
            verbose=False
        )
        
        result_regions = []
        for idx, r in enumerate(ocr_regions):
            result_regions.append({
                "id": f"region_{idx + 1}",
                "pts": r.pts.tolist(),
                "aabb": {
                    "x": int(r.aabb.x),
                    "y": int(r.aabb.y),
                    "w": int(r.aabb.w),
                    "h": int(r.aabb.h)
                },
                "text": r.text.strip() if r.text else "",
                "confidence": float(r.prob) if getattr(r, "prob", None) is not None else 1.0,
                "direction": r.direction
            })
            
        return {
            "regions": result_regions,
            "errors": []
        }
    except Exception as e:
        return JSONResponse(
            status_code=500,
            content={
                "regions": [],
                "errors": [str(e), traceback.format_exc()]
            }
        )
