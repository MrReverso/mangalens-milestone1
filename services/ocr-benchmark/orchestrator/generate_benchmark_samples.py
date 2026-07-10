#!/usr/bin/env python3
import json
import os
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


OUTPUT_DIR = Path(os.environ.get("OCR_BENCHMARK_SAMPLE_DIR", "/app/samples/benchmark_dataset"))
FONT_CANDIDATES = {
    "ja": (
        "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
        "/System/Library/Fonts/ヒラギノ角ゴシック W3.ttc",
        "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
    ),
    "ko": (
        "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
        "/System/Library/Fonts/AppleSDGothicNeo.ttc",
        "/System/Library/Fonts/Supplemental/AppleGothic.ttf",
    ),
    "en": (
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
    ),
}

SAMPLES = (
    {
        "filename": "japanese_manga_page.png",
        "language": "ja",
        "layout": "manga",
        "texts": ("こんにちは", "行こう！"),
    },
    {
        "filename": "korean_webtoon_page.png",
        "language": "ko",
        "layout": "webtoon",
        "texts": ("안녕하세요", "같이 가자!"),
    },
    {
        "filename": "english_comic_page.png",
        "language": "en",
        "layout": "comic",
        "texts": ("HELLO THERE", "LET'S GO!"),
    },
)


def find_font(language: str) -> str:
    for candidate in FONT_CANDIDATES[language]:
        if Path(candidate).is_file():
            return candidate
    raise RuntimeError(
        f"No benchmark font found for {language}; checked: {FONT_CANDIDATES[language]}"
    )


def polygon_for_text(draw: ImageDraw.ImageDraw, position, text, font):
    left, top, right, bottom = draw.textbbox(position, text, font=font)
    padding_x, padding_y = 18, 12
    return [
        [left - padding_x, top - padding_y],
        [right + padding_x, top - padding_y],
        [right + padding_x, bottom + padding_y],
        [left - padding_x, bottom + padding_y],
    ]


def create_sample(spec):
    font_path = find_font(spec["language"])
    print(f"Generating {spec['filename']} with font: {font_path}")
    width = 1000
    height = 1600 if spec["layout"] == "webtoon" else 1400
    background = (247, 247, 244) if spec["layout"] == "manga" else (235, 242, 247)
    image = Image.new("RGB", (width, height), background)
    draw = ImageDraw.Draw(image)

    if spec["layout"] == "manga":
        panels = ((40, 40, 480, 670), (520, 40, 960, 670), (40, 710, 960, 1360))
        fills = ((215, 215, 215), (190, 190, 190), (225, 225, 225))
    elif spec["layout"] == "webtoon":
        panels = ((70, 40, 930, 760), (70, 820, 930, 1560))
        fills = ((194, 220, 235), (231, 203, 190))
    else:
        panels = ((40, 40, 480, 670), (520, 40, 960, 670), (40, 710, 960, 1360))
        fills = ((194, 215, 238), (244, 211, 168), (204, 230, 198))

    for panel, fill in zip(panels, fills):
        draw.rectangle(panel, fill=fill, outline=(30, 30, 30), width=8)
        x1, y1, x2, y2 = panel
        draw.line((x1 + 40, y2 - 70, x2 - 40, y1 + 100), fill=(90, 90, 90), width=9)
        draw.ellipse((x1 + 70, y1 + 260, x1 + 230, y1 + 450), outline=(50, 50, 50), width=7)

    font = ImageFont.truetype(font_path, 66)
    bubble_specs = (
        ((80, 105, 700, 310), (145, 160), spec["texts"][0]),
        ((480, 760 if spec["layout"] != "webtoon" else 900, 960, 1050 if spec["layout"] != "webtoon" else 1200),
         (535, 825 if spec["layout"] != "webtoon" else 980), spec["texts"][1]),
    )
    regions = []
    for index, (bubble, position, text) in enumerate(bubble_specs, start=1):
        draw.ellipse(bubble, fill="white", outline=(20, 20, 20), width=6)
        draw.text(position, text, font=font, fill=(0, 0, 0))
        polygon = polygon_for_text(draw, position, text, font)
        regions.append({"id": f"ground_truth_{index}", "text": text, "polygon": polygon})

    output_path = OUTPUT_DIR / spec["filename"]
    image.save(output_path, format="PNG")
    return {
        "filename": spec["filename"],
        "language": spec["language"],
        "sampleType": "self-created-synthetic-page",
        "license": "CC0-1.0",
        "source": "Created by the MangaLens project; no third-party artwork",
        "groundTruthRegions": regions,
    }


def main():
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    manifest = {"datasetVersion": 1, "samples": [create_sample(spec) for spec in SAMPLES]}
    with open(OUTPUT_DIR / "manifest.json", "w", encoding="utf-8") as output:
        json.dump(manifest, output, ensure_ascii=False, indent=2)
        output.write("\n")
    print(f"Generated {len(manifest['samples'])} CC0 benchmark pages in {OUTPUT_DIR}")


if __name__ == "__main__":
    main()
