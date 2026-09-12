#!/usr/bin/env python3
"""Validate the shipped solar photosphere texture (public/assets/sun/sun-4k.jpg).

Checks:
  1. File exists and is a valid image
  2. Equirectangular 2:1 aspect ratio
  3. Solar color signature: yellow-white, R >= G > B (not a solid flat color)
  4. Surface structure: spatial variance (granulation / active regions / sunspots)
  5. No huge uniform dead regions
Prints OVERALL PASS / FAIL.
"""
import os
import sys

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PATH = os.path.join(ROOT, "public", "assets", "sun", "sun-4k.jpg")

failures = []


def check(name, ok, detail=""):
    status = "PASS" if ok else "FAIL"
    print(f"[{status}] {name}" + (f" — {detail}" if detail else ""))
    if not ok:
        failures.append(name)


# 1. Exists + valid image
if not os.path.exists(PATH):
    print(f"[FAIL] file missing at {PATH}")
    sys.exit(1)
try:
    im = Image.open(PATH)
    im.load()
except Exception as exc:  # corrupt / unreadable image → clean FAIL, not a traceback
    print(f"[FAIL] valid image — could not decode: {exc}")
    sys.exit(1)
check("valid image", True, f"{im.format} {im.size[0]}x{im.size[1]}")

px = im.convert("RGB")
w, h = px.size

# 2. Aspect
aspect_ok = abs(w / h - 2.0) < 0.05
check("equirectangular 2:1 aspect", aspect_ok, f"w/h = {w / h:.3f}")

# Full-image statistics via numpy-free subsampled scan of the grayscale map
gray = px.convert("L")
step = max(1, w // 512)
vals = [gray.getpixel((x, y)) for x in range(0, w, step) for y in range(0, h, step)]
mean = sum(vals) / len(vals)
stdev = (sum((v - mean) ** 2 for v in vals) / len(vals)) ** 0.5
mn = min(vals)
mx = max(vals)

# 3. Solar color signature: bright, warm — R >= G >= B with high overall level.
#    (Real SDO white-light imagery is near white-yellow; a "painted" texture
#    would be a flat saturated orange. The key signal is brightness + structure.)
def channel_avg(chan):
    c = px.getchannel(chan)
    cstep = max(1, w // 256)
    # Collect the samples first so the divisor is the ACTUAL count. The range
    # yields ceil(w/cstep) * ceil(h/cstep) samples, which the old floored
    # (w // cstep) * (h // cstep) undercounted whenever w/h were not exact
    # multiples of cstep — that inflated the averages and could flip the gate.
    samples = [c.getpixel((x, y)) for x in range(0, w, cstep) for y in range(0, h, cstep)]
    return sum(samples) / len(samples)


nr, ng, nb = channel_avg("R"), channel_avg("G"), channel_avg("B")
color_ok = nr > 200 and nb < nr and nr >= ng >= nb - 5
check("solar warm-white signature (bright, R-led)", color_ok, f"avg R={nr:.0f} G={ng:.0f} B={nb:.0f}")

# 4. Surface structure: meaningful spatial variance (granulation/plasma)
check("surface structure (spatial variance)", stdev > 18, f"grey stdev={stdev:.1f} (mean {mean:.0f})")

# 5. Dark active regions / sunspots: some pixels well below the mean
check("dark active regions present", mn < 0.6 * mean, f"min grey={mn}, 0.6*mean={0.6 * mean:.0f}")

# 6. No giant dead regions: 8x4 grid, no cell far below global mean
grid_ok = True
grid_detail = []
for gx in range(8):
    row = []
    for gy in range(4):
        x = int((gx + 0.5) * w / 8)
        y = int((gy + 0.5) * h / 4)
        r = gray.getpixel((x, y))
        row.append(r)
        if r < 0.4 * mean:
            grid_ok = False
    grid_detail.append(" ".join(f"{v:3d}" for v in row))
check("no dead grid cells (8x4)", grid_ok)
print("  grey grid (8 cols x 4 rows):")
for row in grid_detail:
    print("  ", row)
print(f"  dynamic range: min={mn} max={mx}")

print()
if failures:
    print(f"OVERALL FAIL ({len(failures)}): {', '.join(failures)}")
    sys.exit(1)
print("OVERALL PASS")
