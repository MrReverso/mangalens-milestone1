import os
import traceback
import cv2
import numpy as np
from typing import List
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.responses import JSONResponse
from paddleocr import PaddleOCR
from result_parser import (
    is_genuine_empty_recognition_result,
    parse_recognition_result,
)

app = FastAPI(title="MangaLens OCR - Paddle Engine Service")

# Cache PaddleOCR recognizer instances (lang, det, rec) to avoid re-init overhead
ocr_cache = {}

def get_paddle_ocr_engine(language: str, det: bool, rec: bool) -> PaddleOCR:
    paddle_lang = "en"
    if language == "ko":
        paddle_lang = "korean"
    elif language == "ja":
        paddle_lang = "japan"
    elif language == "en":
        paddle_lang = "en"
        
    cache_key = (paddle_lang, det, rec)
    if cache_key not in ocr_cache:
        ocr_cache[cache_key] = PaddleOCR(
            use_angle_cls=True,
            lang=paddle_lang,
            show_log=False,
            det=det,
            rec=rec
        )
    return ocr_cache[cache_key]


@app.get("/health")
def health():
    return {"status": "healthy"}


@app.post("/recognize")
async def recognize(
    files: List[UploadFile] = File(...),
    language: str = Form("en")
):
    try:
        engine = get_paddle_ocr_engine(language, det=False, rec=True)
        results = []
        
        for file in files:
            contents = await file.read()
            np_arr = np.frombuffer(contents, np.uint8)
            img = cv2.imdecode(np_arr, cv2.IMREAD_COLOR)
            
            if img is None or img.size == 0:
                results.append({
                    "text": "",
                    "confidence": 0.0,
                    "recognizerInferenceRan": False,
                    "error": {
                        "stage": "recognition-inference",
                        "message": "Failed to decode crop image."
                    }
                })
                continue
            inference_started = False
            try:
                inference_started = True
                res_ocr = engine.ocr(img, det=False, rec=True)
                if is_genuine_empty_recognition_result(res_ocr):
                    results.append({
                        "text": "", "confidence": 0.0, "error": None,
                        "recognizerInferenceRan": True
                    })
                else:
                    try:
                        text, conf = parse_recognition_result(res_ocr)
                        results.append({
                            "text": text, "confidence": conf, "error": None,
                            "recognizerInferenceRan": True
                        })
                    except ValueError as parse_error:
                        results.append({
                            "text": "", "confidence": 0.0,
                            "recognizerInferenceRan": True,
                            "error": {
                                "stage": "recognition-result-parsing",
                                "message": str(parse_error),
                                "rawResult": repr(res_ocr)[:2000]
                            }
                        })
            except Exception as e:
                traceback.print_exc()
                results.append({
                    "text": "",
                    "confidence": 0.0,
                    "recognizerInferenceRan": inference_started,
                    "error": {
                        "stage": "recognition-inference",
                        "message": str(e)
                    }
                })
                
        return {"results": results}
    except Exception as e:
        traceback.print_exc()
        return JSONResponse(
            status_code=500,
            content={
                "results": [],
                "recognizerInferenceRan": False,
                "error": {
                    "stage": "recognition-inference",
                    "message": str(e)
                }
            }
        )


@app.post("/detect-recognize")
async def detect_recognize(
    image: UploadFile = File(...),
    language: str = Form("en")
):
    try:
        contents = await image.read()
        np_arr = np.frombuffer(contents, np.uint8)
        img = cv2.imdecode(np_arr, cv2.IMREAD_COLOR)
        if img is None:
            raise HTTPException(status_code=400, detail="Uploaded file is not a valid image.")
            
        engine = get_paddle_ocr_engine(language, det=True, rec=True)
        raw_res = engine.ocr(img, cls=True)
        
        regions = []
        if raw_res and raw_res[0]:
            for line in raw_res[0]:
                bbox, (text, conf) = line
                regions.append({
                    "pts": [[float(pt[0]), float(pt[1])] for pt in bbox],
                    "text": text,
                    "confidence": float(conf)
                })
                
        return {"regions": regions, "errors": []}
    except Exception as e:
        return JSONResponse(
            status_code=500,
            content={
                "regions": [],
                "errors": [str(e), traceback.format_exc()]
            }
        )
