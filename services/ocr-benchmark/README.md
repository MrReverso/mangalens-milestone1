# Manga/Manhwa Text Detection and OCR Engine Benchmark Spike

This service implements a research spike to compare manga and manhwa text detection and OCR pipelines using authentic, local-first execution.

---

## 1. Benchmarked Pipelines

### Pipeline A
- **Detector**: `manga-image-translator` default detector (`dbnet`).
- **OCR**: `manga-image-translator` default `ocr48px` OCR.

### Pipeline B
- **Detector**: `manga-image-translator` Comic Text Detector (`ctd`).
- **OCR**: `manga-ocr` for Japanese; standalone `PaddleOCR` recognition (via crop-warped segments) for Korean and English.

### Pipeline C
- **Detector**: `DBConvNext` detector (falls back to `dbnet` if unavailable).
- **OCR**: `manga-ocr` for Japanese; standalone `PaddleOCR` recognition (via crop-warped segments) for Korean and English.

### Pipeline D
- **Detector/OCR**: `PaddleOCR` standalone (performs both text detection and character recognition).

---

## 2. Setup and Installation

### A. Local Setup (Virtual Environment)
1. **Create and activate environment**:
   ```bash
   python3 -m venv venv
   source venv/bin/activate
   ```
2. **Install requirements**:
   ```bash
   pip install -r requirements.txt
   ```

### B. Strict Installation and Engine Verification
To verify that all deep learning modules, dependencies, and adapter schemas are successfully loaded without running a full image batch:
```bash
python benchmark.py --check-engines paddle,ctd,dbconvnext,default
```
This command checks imports for `paddleocr`, `paddlepaddle`, `manga-ocr`, and `manga-image-translator`, and verifies that their detector/OCR registries match our adapter contract. It exits with code `0` on success, or a non-zero code printing the exact missing dependency on failure.

### C. Docker Setup
To avoid version conflicts and bloated images, build the two separate, isolated target Docker images:

```bash
# Build PaddleOCR execution image
docker build -f Dockerfile.paddle -t mangalens-ocr-paddle .

# Build manga-image-translator execution image
docker build -f Dockerfile.manga-translator -t mangalens-ocr-manga .
```

### D. Running with Docker Compose
Run the separate compose services:
```bash
# Execute standalone PaddleOCR benchmarks
docker compose run ocr-paddle

# Execute manga-image-translator and CTD/DBConvNext benchmarks
docker compose run ocr-manga-translator
```

---

## 3. How to Run the Benchmark Locally

### A. Run in Mock/Demo Mode (Generates synthetic test reports under results/demo/)
To verify script parsing and overlay rendering without download overhead:
```bash
python benchmark.py --input ./samples --output ./results --language ko --engines all --demo
```

### B. Run Authentic Benchmark Executions
Run the benchmark on real manga/webtoon images separated by language:
```bash
# Run Korean webtoon pages benchmark
python benchmark.py --input ./samples/korean --output ./results/korean --language ko --engines all

# Run Japanese manga pages benchmark
python benchmark.py --input ./samples/japanese --output ./results/japanese --language ja --engines all

# Run English comic pages benchmark
python benchmark.py --input ./samples/english --output ./results/english --language en --engines all
```

---

## 4. CJK Font Configuration
Drawing Japanese and Korean text labels on the output annotated images requires a CJK-capable font. 

Pass the local path of a CJK TrueType/OpenType font using the `--cjk-font` parameter:
```bash
python benchmark.py --input ./samples/korean --output ./results/korean --language ko --engines all --cjk-font "/Library/Fonts/Arial Unicode.ttf"
```
Or for Linux (Noto Sans CJK):
```bash
python benchmark.py --input ./samples/japanese --output ./results/japanese --language ja --engines all --cjk-font "/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc"
```

If no `--cjk-font` is provided, the script will automatically check common macOS and Linux system CJK fonts, falling back to basic default fonts (with a CJK drawing warning) if none are found.

---

## 5. Reports and Annotated Overlays
Upon successful execution, the output directory contains:
- `report.json`: JSON output mapping all authentic region coordinates, text, confidence, detectors, and recognizers.
- `report.md`: Main Markdown report comparing duration, memory usage, and region counts.
- `comparison.html`: HTML side-by-side view comparing original images with Pipeline A/B/C/D annotations, showing exact recognized texts and metadata.
- `annotated_<engine>_<image>`: Distinguishable annotated overlays.
