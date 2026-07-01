# Manga/Manhwa Text Detection and OCR Engine Benchmark Spike

This service implements a research spike to compare manga and manhwa text detection and OCR pipelines before deciding on the production architecture.

---

## 1. Benchmarked Pipelines

### Pipeline A
- **Detector**: `manga-image-translator` default detector (`dbnet`).
- **OCR**: `manga-image-translator` default OCR.

### Pipeline B
- **Detector**: `manga-image-translator` Comic Text Detector (`ctd`).
- **OCR**: `manga-ocr` for Japanese; `PaddleOCR` for Korean, Chinese, and English.

### Pipeline C
- **Detector**: `DBConvNext` detector (falls back to `dbnet` if unavailable).
- **OCR**: `manga-ocr` for Japanese; `PaddleOCR` for Korean.

### Pipeline D
- **Detector/OCR**: `PaddleOCR` standalone (performs both detection and character recognition).

---

## 2. Interface Contracts

Each OCR engine conforms to a unified Python class hierarchy:

```python
class OcrEngine(ABC):
    @property
    @abstractmethod
    def name(self) -> str:
        pass

    @abstractmethod
    def process(self, image_path: str, language: str, use_demo: bool = False) -> OcrPageResult:
        pass
```

### Result Schema

Results are normalized to the following standard JSON shape:

```json
{
  "engine": "paddleocr-standalone",
  "imagePath": "./samples/page1.png",
  "imageWidth": 800,
  "imageHeight": 1200,
  "processingTimeMs": 1400,
  "regions": [
    {
      "id": "region_1",
      "polygon": {
        "points": [
          {"x": 100.0, "y": 150.0},
          {"x": 300.0, "y": 150.0},
          {"x": 300.0, "y": 250.0},
          {"x": 100.0, "y": 250.0}
        ]
      },
      "boundingBox": {
        "x": 100,
        "y": 150,
        "width": 200,
        "height": 100
      },
      "text": "무엇을요?",
      "confidence": 0.965,
      "orientation": "horizontal"
    }
  ],
  "errors": []
}
```

---

## 3. Setup and Installation

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

### B. Docker Setup
Build and run the container:
```bash
docker build -t ocr-benchmark .
```

---

## 4. How to Run the Benchmark

### A. Run in Mock/Demo Mode (Recommended for testing CLI flags without large weights downloads)
If deep learning libraries are not installed or you want to verify the script quickly, use the `--demo` flag:
```bash
python benchmark.py --input ./samples --output ./results --language ko --engines all --demo
```

### B. Process one image
```bash
python benchmark.py --input ./samples/page_01.png --output ./results --language ko --engines ctd,paddle
```

### C. Process a directory
```bash
python benchmark.py --input ./samples --output ./results --language ja --engines all
```

### D. Run via Docker Compose
```bash
docker-compose up
```

---

## 5. Reports and Annotated Overlays
- **Markdown Report**: Outputted directly to `results/report.md`.
- **JSON Report**: Saved to `results/report.json`.
- **Distinguishable Overlay Colors**:
  - `manga-image-translator-default` (Pipeline A): Green
  - `manga-image-translator-ctd` (Pipeline B): Cyan
  - `dbnet-mangaocr-paddleocr` (Pipeline C): Magenta
  - `paddleocr-standalone` (Pipeline D): Orange
