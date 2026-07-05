# MangaLens synthetic multilingual benchmark dataset

These three pages were created specifically for MangaLens and are dedicated to
the public domain under CC0-1.0. They contain no third-party artwork, characters,
logos, or commercial manga material.

- `japanese_manga_page.png`: monochrome right-to-left manga-style panels.
- `korean_webtoon_page.png`: tall color webtoon-style panels.
- `english_comic_page.png`: color western-comic-style panels.

`manifest.json` records the language, expected text, and ground-truth text
polygons. Regenerate the images and manifest with:

```bash
python generate_benchmark_samples.py
```

The samples are deliberately synthetic. They test genuine detector and OCR
execution reproducibly, but they are not a substitute for a later, separately
licensed corpus of real published pages.
