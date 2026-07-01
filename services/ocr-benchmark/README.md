# Manga/Manhwa Text Detection and OCR Engine Benchmark Spike

This directory implements a research spike to compare manga and manhwa text detection and OCR pipelines using isolated microservices running under Docker Compose.

---

## 1. Benchmarked Pipelines

*   **Pipeline A**:
    *   *Detector*: `manga-engine` default detector (`dbnet`).
    *   *OCR*: `manga-engine` `ocr48px` OCR.
*   **Pipeline B (Hybrid)**:
    *   *Detector*: `manga-engine` Comic Text Detector (`ctd`).
    *   *OCR*: `manga-engine` `manga-ocr` for Japanese; `paddle-engine` recognition (via crop-warped segments) for Korean and English.
*   **Pipeline C (Hybrid - Strict)**:
    *   *Detector*: `manga-engine` DBConvNext detector (fails-fast; **no** silent fallbacks).
    *   *OCR*: `manga-engine` `manga-ocr` for Japanese; `paddle-engine` recognition (via crop-warped segments) for Korean and English.
*   **Pipeline D**:
    *   *Detector/OCR*: `paddle-engine` standalone PaddleOCR detection + recognition.

---

## 2. Microservice Architecture Design

To resolve Python package and binary/version conflicts (like `protobuf` and `numpy` clashing between PyTorch and PaddleOCR), the runner is divided into three isolated nodes:

1.  **manga-engine** (`manga_engine/`): Exposes FastAPI endpoints on port `8002` for text detection (default, ctd, dbconvnext) and Japanese recognition (manga-ocr, ocr48px).
2.  **paddle-engine** (`paddle_engine/`): Exposes FastAPI endpoints on port `8003` for crop recognition (EN/KO) and standalone PaddleOCR detection + recognition.
3.  **benchmark-orchestrator** (`orchestrator/`): A lightweight orchestrator client that handles image loading, perspective warping/cropping of polygons, service coordination, and report generation.

---

## 3. Setup and Orchestration

### A. Build Containers
Build all three isolated services from their respective directories:
```bash
docker compose build --no-cache
```
*Note: During build, each container runs `python -m pip check` to verify zero packaging conflicts.*

### B. Boot Services and Execute Integration Tests
To boot the engines, perform health checks, and run the `pytest` orchestrator test suite:
```bash
docker compose up --build --exit-code-from benchmark-orchestrator
```
This command automatically exits with the orchestrator container's return code, making it suitable for CI validation.

### C. Shutdown Services
To stop and clean up containers:
```bash
docker compose down
```

---

## 4. Running Benchmarks Locally

### A. Run in Demo Mode (Generates synthetic test reports under results/demo/)
To verify HTTP calls, script parsing, and HTML rendering without downloading heavy deep learning weights:
```bash
python orchestrator/orchestrator.py --input ./samples --output ./results --language ko --engines all --demo
```

### B. Run Authentic Benchmark Executions
Place your clean test images under the target directories and execute requests:
```bash
# Run Korean webtoon pages benchmark
python orchestrator/orchestrator.py --input ./samples/korean --output ./results/korean --language ko --engines all

# Run Japanese manga pages benchmark
python orchestrator/orchestrator.py --input ./samples/japanese --output ./results/japanese --language ja --engines all

# Run English comic pages benchmark
python orchestrator/orchestrator.py --input ./samples/english --output ./results/english --language en --engines all
```

---

## 5. Output Reports and Manual Review
Upon completion, the orchestrator produces:
-   `report.json`: JSON output mapping all authentic region coordinates, text labels, and confidence metrics.
-   `comparison.html`: Dark-themed grid comparison view showing side-by-side annotations, text snippets, and the manual review JSON template.
-   `annotated_<engine>_<image>.png`: Result overlay images.
