"""Verify the candidate unlit day texture.

1. Regional luminance — must be reasonably uniform (no baked directional
   lighting: oceans not near-black, no west->east land brightness collapse).
2. Geographic alignment — ocean/land classification must match the old
   texture's layout (same equirectangular UV convention), so the night
   texture stays geographically aligned.
"""
from PIL import Image

NEW = '/tmp/earth-daymap-2k.jpg'
OLD = 'public/assets/earth/earth-blue-marble.jpg'

new = Image.open(NEW).convert('RGB')
old = Image.open(OLD).convert('RGB')
W, H = new.size
print('new size', (W, H), ' old size', old.size)


def region(img, lon, lat, halfdeg=4):
    u = (lon + 180) / 360.0
    v = (90 - lat) / 180.0
    x0, x1 = int((u - halfdeg / 360) * img.width), int((u + halfdeg / 360) * img.width)
    y0, y1 = int((v - halfdeg / 180) * img.height), int((v + halfdeg / 180) * img.height)
    px = list(img.crop((x0, y0, x1, y1)).getdata())
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
print('\nNEW TEXTURE regional luminance:')
for name, lon, lat in regions:
    r, g, b, l = region(new, lon, lat)
    print(f'  {name:40s} R={r:5.1f} G={g:5.1f} B={b:5.1f} lum={l:5.1f}')

print('\nNew-texture sweep at lat 40N:')
for lon in range(-180, 181, 30):
    r, g, b, l = region(new, lon, 40, halfdeg=2)
    print(f'  lon {lon:5d}  lum={l:5.1f}')

# --- Alignment: ocean/land classification vs old texture ---
def is_ocean(px):
    # Robust for both the evenly-lit new texture and the near-black
    # baked-lighting old texture: ocean is strongly blue-dominant.
    r, g, b = px
    return (b - r) > 12

step_u, step_v = 32, 32
agree = total = 0
for i in range(step_u):
    for j in range(step_v):
        x = i * W // step_u
        y = j * H // step_v
        pn = new.getpixel((x, y))
        po = old.getpixel((int(x * old.width / W), int(y * old.height / H)))
        agree += int(is_ocean(pn) == is_ocean(po))
        total += 1
print(f'\nOcean/land agreement with old texture: {agree}/{total} = {100 * agree / total:.1f}%')

# Key geographic anchors in the NEW texture
print('\nAnchor checks (new texture):')
for name, lon, lat in [
    ('Greenland ice (expect very bright)', -40, 75),
    ('Sahara desert (expect bright tan)', 10, 22),
    ('Congo rainforest (expect green)', 22, -2),
    ('Arctic ocean (expect blue)', 90, 80),
]:
    r, g, b, l = region(new, lon, lat, halfdeg=2)
    print(f'  {name:40s} R={r:5.1f} G={g:5.1f} B={b:5.1f} lum={l:5.1f}')
