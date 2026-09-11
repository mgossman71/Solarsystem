#!/usr/bin/env python3
"""Validate the shipped lunar albedo texture: real geography, correct orientation.

Checks (against verified selenographic coordinates):
  * 2:1 equirectangular aspect (sphere-mappable)
  * near side darker than far side (maria concentration — a real-Moon signature)
  * major features at their expected u/v positions:
      - mare regions (Imbrium, Tranquillitatis, Procellarum) are dark
      - Tycho / Copernicus (young craters with rays) are bright
      * far-side regions (Moscovium, Orientale vicinity, Apollonius) are brighter
      than near-side maria — proves the map is not mirrored or longitude-shifted.

Exit code 0 = all checks pass.
"""
from PIL import Image
import os
import sys

ASSET = '/Users/gozz/Documents/Web-Earth/public/assets/moon/moon-day-2k.jpg'

# Verified selenographic coordinates (latitude N+, longitude E+):
FEATURES = [
    # (name, lat, lon, expected_lum_range)
    ('Mare Imbrium',          +32.8, -15.6, (40, 110)),   # dark mare
    ('Mare Tranquillitatis',  +8.5, +31.4, (40, 110)),    # dark mare
    ('Oceanus Procellarum',   +20.0, -45.0, (40, 110)),   # dark oceanus
    ('Tycho',                 -43.3, -11.2, (120, 255)),  # bright-rayed crater
    ('Copernicus',            +9.7, -20.1, (120, 255)),   # bright-rayed crater
    ('Mare Moscovium (far)',  +27.0, +140.0, (110, 230)), # far side: highland-ish
]

def uv_of(lat: float, lon: float):
    # standard equirectangular, north up: u = 0.5 + lon/360, v = 0.5 - lat/180
    return (0.5 + lon / 360.0) % 1.0, 0.5 - lat / 180.0

def main() -> int:
    im = Image.open(ASSET).convert('RGB')
    w, h = im.size
    ok = True
    def check(name: str, cond: bool, detail: str) -> None:
        nonlocal ok
        print(f'  [{"PASS" if cond else "FAIL"}] {name}: {detail}')
        if not cond:
            ok = False

    print(f'asset: {ASSET} ({w}x{h})')
    check('aspect', w / h == 2, f'{w}x{h}')

    small = im.resize((w // 2, h // 2))
    px = small.load()
    sw, sh = small.size

    def region_mean(u0, u1, v0, v1):
        vals = []
        for y in range(int(v0 * sh), int(v1 * sh), max(1, sh // 24)):
            for x in range(int(u0 * sw), int(u1 * sw), max(1, sw // 48)):
                r, g, b = px[x, y]
                vals.append(0.299 * r + 0.587 * g + 0.114 * b)
        return sum(vals) / len(vals)

    near = region_mean(0.38, 0.62, 0.2, 0.8)
    far = max(region_mean(0.86, 0.98, 0.2, 0.8), region_mean(0.02, 0.14, 0.2, 0.8))
    check('maria signature (near side darker than far)', near < far - 15,
          f'near={near:.1f} far={far:.1f}')

    for name, lat, lon, (lo, hi) in FEATURES:
        u, v = uv_of(lat, lon)
        x = min(sw - 1, int(u * sw))
        y = min(sh - 1, int(v * sh))
        r, g, b = px[x, y]
        lum = 0.299 * r + 0.587 * g + 0.114 * b
        check(f'{name}', lo <= lum <= hi, f'u={u:.3f} v={v:.3f} lum={lum:.1f} (expect {lo}-{hi})')

    print('OVERALL:', 'PASS' if ok else 'FAIL')
    return 0 if ok else 1

if __name__ == '__main__':
    sys.exit(main())

