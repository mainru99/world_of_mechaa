"""Mechanical PNG export only; artwork must come from image_gen.
FX: cell-local fit to 48 of 64 logical pixels, 8 colors/atlas, binary alpha,
nearest-neighbor enlargement. Pose: uniform nearest-neighbor resize and
transparent 440x420 packing; never recolor or redraw the robot.
Usage: python tools/export-motion-art.py fx SOURCE DEST
       python tools/export-motion-art.py pose SOURCE DEST ORIGINAL
"""
import sys
from pathlib import Path
from PIL import Image
from spritecheck import opaque_bbox, feet_x

def occupied(im):
    return im.getchannel('A').point(lambda v: 255 if v >= 128 else 0)

def export_fx(src, dst):
    im = Image.open(src).convert('RGBA')
    if im.width != im.height or im.width % 2:
        raise ValueError('Source must be an even square 2x2 atlas')
    sheet = Image.new('RGBA', (128, 128))
    side = im.width // 2
    for i in range(4):
        tile = im.crop(((i % 2) * side, (i // 2) * side,
                        (i % 2 + 1) * side, (i // 2 + 1) * side))
        mask = occupied(tile)
        bb = mask.getbbox()
        if not bb: raise ValueError(f'Empty cell {i}')
        art = tile.crop(bb)
        art.putalpha(mask.crop(bb))
        factor = 48 / max(art.size)
        size = tuple(max(1, round(n * factor)) for n in art.size)
        art = art.resize(size, Image.Resampling.NEAREST)
        if Path(src).stem == 'status-a':
            # Eight colors total, but separate hue pairs prevent global palette
            # averaging from turning blue shields green or red targets purple.
            pairs = [((57,181,244),(215,245,255)), ((43,231,91),(189,255,147)),
                     ((243,68,73),(255,209,185)), ((156,85,220),(239,156,255))]
            alpha = art.getchannel('A')
            pal = Image.new('P', (1, 1))
            pal.putpalette(list(sum(pairs[i], ())) * 128)
            art = art.convert('RGB').quantize(palette=pal, dither=Image.Dither.NONE).convert('RGBA')
            art.putalpha(alpha)
        x = (i % 2) * 64 + (64 - size[0]) // 2
        y = (i // 2) * 64 + (64 - size[1]) // 2
        sheet.paste(art, (x, y))
    # One shared 8-color palette for the whole atlas, not eight per cell.
    mask = sheet.getchannel('A')
    colors = [rgb for rgb, alpha in zip(sheet.convert('RGB').getdata(), mask.getdata()) if alpha]
    strip = Image.new('RGB', (len(colors), 1)); strip.putdata(colors)
    palette = strip.quantize(colors=8, method=Image.Quantize.MEDIANCUT)
    sheet = sheet.convert('RGB').quantize(palette=palette, dither=Image.Dither.NONE).convert('RGBA')
    sheet.putalpha(mask)
    sheet.putdata([(r, g, b, a) if a else (0, 0, 0, 0)
                   for r, g, b, a in sheet.getdata()])
    sheet.resize((1024, 1024), Image.Resampling.NEAREST).save(dst)

def export_pose(src, dst, original):
    im = Image.open(src).convert('RGBA')
    org = Image.open(original).convert('RGBA')
    bb, mask = opaque_bbox(im); obb, om = opaque_bbox(org)
    if not bb or not obb: raise ValueError('Empty sprite')
    art = im.crop(bb)
    height = obb[3] - obb[1]
    width = round(art.width * height / art.height)
    if width > 420: raise ValueError('Pose too wide; regenerate, do not squash')
    art = art.resize((width, height), Image.Resampling.NEAREST)
    abb, am = opaque_bbox(art)
    x = round(feet_x(om, obb) - feet_x(am, abb))
    # Weapon-reaching poses may need horizontal packing. Preserve scale and
    # full silhouette; spritecheck emits dx to restore the original anchor.
    x = max(8, min(x, 440 - width - 8))
    y = (obb[3] - 1) - (abb[3] - 1)
    if x < 0 or x + width > 440 or y < 0 or y + height > 420:
        raise ValueError('Pose would be clipped; regenerate')
    canvas = Image.new('RGBA', (440, 420))
    canvas.paste(art, (x, y))
    canvas.save(dst)

if __name__ == '__main__':
    kind, src, dst, *args = sys.argv[1:]
    Path(dst).parent.mkdir(parents=True, exist_ok=True)
    if kind == 'fx': export_fx(src, dst)
    elif kind == 'pose': export_pose(src, dst, args[0])
    else: raise ValueError('fx or pose required')

