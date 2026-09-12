#!/usr/bin/env python3
"""Generate the mobile (lower-resolution) texture set from the shipped full-res
assets. These are REAL downscalings of the same NASA/SDO imagery — never
procedural substitutes — so mobile keeps correct geography while shipping
less bytes and GPU memory.

Outputs (next to the sources):
  public/assets/earth/earth-night-1k.jpg   1024x512  (from 4096x2048)
  public/assets/earth/earth-clouds-1k.png  1024x512  (from 2048x1024, alpha preserved)
  public/assets/moon/moon-day-1k.jpg       1024x512  (from 2048x1024)
  public/assets/sun/sun-2k.jpg             2048x1024 (from 4096x2048)

Usage: python3 scripts/generate_mobile_textures.py [--check]
  --check  validate existing outputs (dims + cloud alpha) and exit.
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ASSETS = ROOT / "public" / "assets"

JOBS = [
    # (source, output, size, format, quality)
    (ASSETS / "earth/earth-night.jpg", ASSETS / "earth/earth-night-1k.jpg", (1024, 512), "JPEG", 85),
    (ASSETS / "moon/moon-day-2k.jpg", ASSETS / "moon/moon-day-1k.jpg", (1024, 512), "JPEG", 85),
    (ASSETS / "sun/sun-4k.jpg", ASSETS / "sun/sun-2k.jpg", (2048, 1024), "JPEG", 85),
    # Clouds: the shader samples the ALPHA channel (256-level tRNS density
    # map), so the downscale must keep a real 8-bit alpha channel.
    (ASSETS / "earth/earth-clouds.png", ASSETS / "earth/earth-clouds-1k.png", (1024, 512), "PNG", None),
]


def validate(src: Path, dst: Path, size: tuple[int, int], fmt: str, quality: int | None) -> bool:
    from PIL import Image

    ok = True
    if not dst.exists():
        print(f"MISSING {dst}")
        return False
    im = Image.open(dst)
    if im.size != size:
        print(f"FAIL {dst.name}: size {im.size} != {size}")
        ok = False
    im_src = Image.open(src)
    if abs(im_src.size[0] / im_src.size[1] - im.size[0] / im.size[1]) > 0.01:
        print(f"FAIL {dst.name}: aspect mismatch vs source")
        ok = False
    if fmt == "PNG":
        rgba = im.convert("RGBA")
        hist = rgba.getchannel("A").histogram()
        levels = sum(1 for v in hist if v)
        if levels < 64:
            print(f"FAIL {dst.name}: alpha collapsed to {levels} levels (need gradient density)")
            ok = False
        else:
            print(f"PASS {dst.name}: {im.size} {im.mode}, alpha {levels} levels")
    else:
        print(f"PASS {dst.name}: {im.size} {im.mode}")
    return ok


def main() -> int:
    from PIL import Image  # noqa: F401  (early fail with a clear message)

    if "--check" in sys.argv:
        return 0 if all(validate(*job) for job in JOBS) else 1

    from PIL import Image

    for src, dst, size, fmt, quality in JOBS:
        if not src.exists():
            print(f"ERROR: source missing: {src}")
            return 1
        im = Image.open(src)
        if fmt == "PNG":
            out = im.convert("RGBA").resize(size, Image.LANCZOS)
            out.save(dst, format="PNG", optimize=True)
        else:
            out = im.convert("RGB").resize(size, Image.LANCZOS)
            out.save(dst, format="JPEG", quality=quality, optimize=True)
        print(f"WRITE {dst} ({size[0]}x{size[1]}, {fmt}) {dst.stat().st_size // 1024} KB")
    print("Generating done — validating:")
    return 0 if all(validate(*job) for job in JOBS) else 1


if __name__ == "__main__":
    sys.exit(main())
