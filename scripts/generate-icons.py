#!/usr/bin/env python3
"""Generate MangaLens extension icons at all required sizes."""

import os
import cairosvg

SVG = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="128" height="128">
  <rect width="128" height="128" rx="20" ry="20" fill="#0a1628"/>
  <!-- Stylized M letter integrated with a lens -->
  <g transform="translate(12, 18) scale(0.875)">
    <!-- Left stroke of M -->
    <path d="M12 90 L12 38 L64 78 L116 38 L116 90"
          stroke="#00d4aa" stroke-width="14" stroke-linecap="round"
          stroke-linejoin="round" fill="none"/>
  </g>
  <!-- Magnifying glass circle at top-right -->
  <circle cx="100" cy="32" r="20" fill="none" stroke="#00d4aa" stroke-width="8"/>
  <!-- Magnifying glass handle -->
  <line x1="114" y1="46" x2="122" y2="54" stroke="#00d4aa" stroke-width="8"
        stroke-linecap="round"/>
  <!-- Small comic-panel lines inside the lens -->
  <line x1="88" y1="24" x2="88" y2="40" stroke="#00d4aa" stroke-width="2.5"
        stroke-linecap="round" opacity="0.6"/>
  <line x1="82" y1="32" x2="98" y2="32" stroke="#00d4aa" stroke-width="2.5"
        stroke-linecap="round" opacity="0.6"/>
</svg>"""

OUT_DIR = os.path.join(os.path.dirname(__file__), "..", "public", "icon")
OUT_DIR = os.path.abspath(OUT_DIR)
SIZES = [16, 32, 48, 96, 128]

def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    for size in SIZES:
        out_path = os.path.join(OUT_DIR, f"{size}.png")
        cairosvg.svg2png(bytestring=SVG.encode(), write_to=out_path,
                         output_width=size, output_height=size)
        print(f"  {size}.png  ({os.path.getsize(out_path)} bytes)")
    print(f"Done – {len(SIZES)} icons written to {OUT_DIR}")

if __name__ == "__main__":
    main()