"""Diagnose whether the day texture contains baked directional lighting.

Samples geographic regions in equirectangular space (u = (lon+180)/360,
v = (90-lat)/180) and reports mean RGB / luminance. If regions on one side
of the map are systematically darker, the texture has baked lighting.
"""
from PIL import Image

img = Image.open('public/assets/earth/earth-blue-marble.jpg').convert('RGB')
W, H = img.size
print('texture size', (W, H))


def region(lon, lat, halfdeg=4):
    u = (lon + 180) / 360.0
    v = (90 - lat) / 180.0
    x0, x1 = int((u - halfdeg / 360) * W), int((u + halfdeg / 360) * W)
    y0, y1 = int((v - halfdeg / 180) * H), int((v + halfdeg / 180) * H)
    crop = img.crop((x0, y0, x1, y1))
    px = list(crop.getdata())
    n = len(px)
    mr = sum(p[0] for p in px) / n
    mg = sum(p[1] for p in px) / n
    mb = sum(p[2] for p in px) / n
    ml = sum(0.299 * p[0] + 0.587 * p[1] + 0.114 * p[2] for p in px) / n
    return mr, mg, mb, ml


regions = [
    ('W North America (lon -120, lat 40)', -120, 40),
    ('E North America (lon -80, lat 40)', -80, 40),
    ('Pacific ocean (lon -160, lat 10)', -160, 10),
    ('Atlantic ocean (lon -40, lat 10)', -40, 10),
    ('W Africa (lon -10, lat 15)', -10, 15),
    ('C Africa (lon 20, lat 0)', 20, 0),
    ('E Africa (lon 40, lat 5)', 40, 5),
    ('C Asia (lon 90, lat 45)', 90, 45),
    ('India (lon 80, lat 20)', 80, 20),
    ('SE Asia (lon 110, lat 15)', 110, 15),
    ('Australia (lon 135, lat -25)', 135, -25),
    ('S. America (lon -60, lat -15)', -60, -15),
    ('Greenland (lon -40, lat 75)', -40, 75),
]
print()
for name, lon, lat in regions:
    r, g, b, l = region(lon, lat)
    print(f'{name:40s} R={r:5.1f} G={g:5.1f} B={b:5.1f} lum={l:5.1f}')

# Longitude sweep at a fixed latitude (40N): land+ocean brightness as a
# function of longitude. Baked lighting shows a strong monotonic trend.
print()
print('Sweep at lat 40N:')
for lon in range(-180, 181, 30):
    r, g, b, l = region(lon, 40, halfdeg=2)
    print(f'  lon {lon:5d}  R={r:5.1f} G={g:5.1f} B={b:5.1f} lum={l:5.1f}')
