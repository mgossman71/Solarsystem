from PIL import Image


def stats(path):
    img = Image.open(path)
    rgba = img.convert('RGBA')
    hist = rgba.histogram()
    total = rgba.width * rgba.height

    def frac_gt(ch, t):
        h = hist[ch * 256:(ch + 1) * 256]
        return sum(h[t + 1:]) / total

    def mean(ch):
        h = hist[ch * 256:(ch + 1) * 256]
        return sum(i * v for i, v in enumerate(h)) / total / 255

    print(path, 'size', rgba.size)
    print('  alpha mean %.3f' % mean(3))
    for t in [0, 20, 60, 128, 200, 255]:
        print('  alpha>%d: %.3f' % (t, frac_gt(3, t)))
    print('  R mean %.3f  R frac>128: %.3f' % (mean(0), frac_gt(0, 128)))


stats('public/assets/earth/earth-clouds.png')
for p in ['public/assets/earth/earth-blue-marble.jpg', 'public/assets/earth/earth-night.jpg']:
    img = Image.open(p).convert('RGB')
    h = img.histogram()
    total = img.width * img.height
    meanl = sum(i * v for ch in range(3) for i, v in enumerate(h[ch * 256:(ch + 1) * 256])) / total / 255 / 3
    frgb = [sum(h[ch * 256:(ch + 1) * 256][129:]) / total for ch in range(3)]
    print(p, 'mean lum %.3f  frac>128 (r,g,b): %.3f %.3f %.3f' % (meanl, *frgb))

