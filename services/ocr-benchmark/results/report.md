# Manga/Manhwa Text Detection and OCR Engine Benchmark Report

This document contains a structured analysis comparing multiple manga/manhwa text detection and OCR pipelines.

## Summary table

| Image Name | Engine Name | Regions | Non-Empty | Avg Conf | Duration (ms) | CPU Mem (MB) | GPU Mem (MB) | Errors |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| dummy_manga_page.png | manga-image-translator-default | 2 | 2 | 91.5% | 12ms | 2.94 MB | 0.0 MB | 1 |
| dummy_manga_page.png | manga-image-translator-ctd | 2 | 2 | 91.5% | 8ms | 2.78 MB | 0.0 MB | 1 |
| dummy_manga_page.png | dbnet-mangaocr-paddleocr | 2 | 2 | 91.5% | 6ms | 0.0 MB | 0.0 MB | 1 |
| dummy_manga_page.png | paddleocr-standalone | 2 | 2 | 91.5% | 5ms | 0.0 MB | 0.0 MB | 1 |

## Model & Production Specifications

| Engine Name | Model Download Size | License | Estimated Production Requirements |
| --- | --- | --- | --- |
| manga-image-translator-default | ~120 MB (DBNet detector + standard text OCR models) | Apache-2.0 / Custom | 1 CPU core, >= 1 GB RAM (GPU optional but recommended) |
| manga-image-translator-ctd | ~250 MB (Comic Text Detector + manga-ocr / PaddleOCR models) | Apache-2.0 / MIT | 2 CPU cores, >= 2 GB RAM, CUDA-capable GPU recommended |
| dbnet-mangaocr-paddleocr | ~380 MB (DBNet / DBConvNext + manga-ocr + PaddleOCR) | MIT / Apache-2.0 | 2 CPU cores, >= 4 GB RAM, VRAM >= 2 GB |
| paddleocr-standalone | ~50 MB (Mobile Net models) | Apache-2.0 | 1 CPU core, >= 500 MB RAM (highly lightweight) |

## Human Review Status & Missed Regions

> [!IMPORTANT]
> Accuracy assessment currently requires manual visual inspection of the generated annotated output images, as there is no pre-labeled ground truth dataset. Do not declare a winning pipeline until these images have been manually reviewed.

## Limitations of the Benchmark
1. **Environment Variation**: Real-world performance (processing time, memory usage) will vary depending on CUDA version, GPU specifications, and host machine disk speed during first-load model caching.
2. **OCR Confidence Metrics**: Confidence scores are engine-specific (PaddleOCR vs. manga-ocr calculate confidence metrics differently) and cannot be directly compared mathematically.
3. **Mock Fallback**: If libraries are missing on the execution host, mock fallback mode generates synthetic coordinates to prove API alignment, which does not represent model accuracy.