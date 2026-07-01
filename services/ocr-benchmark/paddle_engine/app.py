import os
import traceback
import cv2
import numpy as np
from typing import List
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.responses import JSONResponse
from paddleocr import PaddleOCR

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


def parse_paddle_rec_result(res) -> tuple:
    if not res:
        return "", 0.0
    try:
        first = res[0]
        if isinstance(first, list) and len(first) > 0:
            item = first[0]
            if isinstance(item, list) or isinstance(item, tuple):
                return str(item[0]), float(item[1])
            elif isinstance(item, str):
                return item, float(first[1]) if len(first) > 1 else 0.0
        elif isinstance(first, tuple) or isinstance(first, list):
            return str(first[0]), float(first[1])
    except Exception:
        pass
    return "", 0.0


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
                    "error": "Failed to decode crop image."
                })
                continue
                
            try:
                res_ocr = engine.ocr(img, det=False, rec=True)
                text, conf = parse_paddle_rec_result(res_ocr)
                results.append({
                    "text": text,
                    "confidence": conf,
                    "error": None
                })
            except Exception as e:
                results.append({
                    "text": "",
                    "confidence": 0.0,
                    "error": f"{str(e)}: {traceback.format_exc()}"
                })
                
        return {"results": results}
    except Exception as e:
        return JSONResponse(
            status_code=500,
            content={
                "results": [],
                "error": f"General recognition failure: {str(e)}"
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
