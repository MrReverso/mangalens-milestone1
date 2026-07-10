#!/usr/bin/env python3
import tarfile
import tempfile
import urllib.request
from pathlib import Path


MODEL_SPECS = {
    "English detector": (
        "det/en/en_PP-OCRv3_det_infer",
        "https://paddleocr.bj.bcebos.com/PP-OCRv3/english/en_PP-OCRv3_det_infer.tar",
    ),
    "English recognizer": (
        "rec/en/en_PP-OCRv4_rec_infer",
        "https://paddleocr.bj.bcebos.com/PP-OCRv4/english/en_PP-OCRv4_rec_infer.tar",
    ),
    "Classifier": (
        "cls/ch_ppocr_mobile_v2.0_cls_infer",
        "https://paddleocr.bj.bcebos.com/dygraph_v2.0/ch/ch_ppocr_mobile_v2.0_cls_infer.tar",
    ),
}
REQUIRED_MODEL_FILES = (
    "inference.pdiparams",
    "inference.pdiparams.info",
    "inference.pdmodel",
)


def model_cache_root() -> Path:
    return Path.home() / ".paddleocr" / "whl"


def missing_model_files(model_directory: Path) -> list[str]:
    return [
        filename
        for filename in REQUIRED_MODEL_FILES
        if not (model_directory / filename).is_file()
    ]


def download_model(label: str, model_directory: Path, url: str) -> None:
    missing = missing_model_files(model_directory)
    if not missing:
        print(f"{label} cache already complete: {model_directory}", flush=True)
        return

    model_directory.mkdir(parents=True, exist_ok=True)
    print(f"Downloading {label} once from: {url}", flush=True)
    archive_path: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(suffix=".tar", delete=False) as archive:
            archive_path = Path(archive.name)
            with urllib.request.urlopen(url, timeout=120) as response:
                while chunk := response.read(1024 * 1024):
                    archive.write(chunk)

        extracted = set()
        with tarfile.open(archive_path, "r") as model_archive:
            for member in model_archive.getmembers():
                for filename in REQUIRED_MODEL_FILES:
                    if member.isfile() and member.name.endswith(filename):
                        source = model_archive.extractfile(member)
                        if source is None:
                            raise RuntimeError(
                                f"Could not read {filename} from {label} archive"
                            )
                        with source, open(model_directory / filename, "wb") as output:
                            output.write(source.read())
                        extracted.add(filename)

        missing = missing_model_files(model_directory)
        if missing:
            raise RuntimeError(
                f"{label} archive did not provide required files: {missing}; "
                f"extracted={sorted(extracted)}"
            )
    finally:
        if archive_path is not None:
            archive_path.unlink(missing_ok=True)

    print(f"Prepared {label} cache: {model_directory}", flush=True)


def main() -> None:
    home = Path.home()
    cache_root = model_cache_root()
    print(f"Resolved home directory: {home}", flush=True)
    print(f"Resolved Paddle cache root: {cache_root}", flush=True)
    print(
        "Preparing pinned PaddleOCR 2.8.1 model artifacts without loading the "
        "native Paddle runtime during the Docker build",
        flush=True,
    )

    for label, (relative_directory, url) in MODEL_SPECS.items():
        directory = cache_root / relative_directory
        print(f"Expected {label} model directory: {directory}", flush=True)
        download_model(label, directory, url)

    discovered = sorted(
        path
        for path in cache_root.rglob("*_infer")
        if path.is_dir()
    )
    print("Discovered Paddle model directories:", flush=True)
    for path in discovered:
        print(f"  - {path}", flush=True)

    expected = {
        cache_root / relative_directory
        for relative_directory, _url in MODEL_SPECS.values()
    }
    missing_directories = sorted(str(path) for path in expected if not path.is_dir())
    incomplete = {
        str(path): missing_model_files(path)
        for path in expected
        if missing_model_files(path)
    }
    if missing_directories or incomplete:
        raise RuntimeError(
            "Paddle model cache verification failed: "
            f"missingDirectories={missing_directories}, incomplete={incomplete}"
        )

    print("Paddle model cache verification complete", flush=True)


if __name__ == "__main__":
    main()
