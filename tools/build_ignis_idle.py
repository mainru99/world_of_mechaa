"""Original-pixel idle animation. No synthesis, resampling, or geometry edits.

Requested and explicitly authorized by the user on 2026-09-12.
Reproduction output only under ignored dist/art-review; never overwrites source assets.
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageChops
from collections import Counter
import hashlib
import json

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'dist' / 'art-review' / 'ignis-idle'
WORK = OUT
SOURCE = ROOT / 'assets' / 'ignis.png'
SOURCE_SHA = hashlib.sha256(SOURCE.read_bytes()).hexdigest()
OUT.mkdir(parents=True, exist_ok=True)
(OUT / 'frames').mkdir(exist_ok=True)
original = Image.open(SOURCE).convert('RGBA')
assert original.size == (440, 420)
W, H = original.size

# Polygons select only existing wing-energy panels; the color predicate below
# excludes neutral armor, outlines and empty pixels inside those polygons.
WING_REGIONS = [
    [(408,30),(389,69),(351,109),(317,119),(310,104),(330,76)],
    [(323,118),(409,116),(375,139),(331,148),(305,147)],
    [(303,153),(326,149),(393,185),(353,188),(312,171)],
    [(299,179),(312,181),(340,211),(332,214),(314,200),(300,188)],
    [(51,67),(87,98),(94,118),(90,129),(74,121),(62,95)],
    [(48,113),(70,119),(83,137),(84,149),(74,143),(60,132)],
    [(58,150),(80,151),(88,169),(86,180),(73,170)],
    [(55,207),(70,186),(83,176),(94,180),(86,192),(70,201)],
]
region = Image.new('L', original.size, 0)
pen = ImageDraw.Draw(region)
for polygon in WING_REGIONS:
    pen.polygon(polygon, fill=255)
mask = Image.new('L', original.size, 0)
source_pixels = original.load()
region_pixels, mask_pixels = region.load(), mask.load()
wing_pixels = []
for y in range(H):
    for x in range(W):
        r, g, b, a = source_pixels[x, y]
        if region_pixels[x, y] and a == 255 and r >= 140 and g >= 65 and r-g >= 8 and g-b >= 18:
            mask_pixels[x, y] = 255
            wing_pixels.append((x, y))
assert len(wing_pixels) > 1000
mask.save(WORK / 'wing-energy-mask.png')

OFFSETS = [0, 0, -1, -3, -6, -8, -8, -6, -3, 0]
GLOW = [0, .06, .22, .48, .78, 1, .96, .65, .28, 0]
DURATIONS = [200, 200, 230, 240, 240, 260, 260, 240, 230, 200]
frames, entries = [], []
source_opaque = original.getchannel('A').histogram()[255]

def visible_delta(a, b):
    """Ignore RGB under fully transparent pixels; alpha is checked separately."""
    return sum(1 for pa, pb in zip(a.get_flattened_data(), b.get_flattened_data()) if (pa[3] or pb[3]) and pa != pb)

for i, (dy, strength, duration) in enumerate(zip(OFFSETS, GLOW, DURATIONS)):
    lit = original.copy()
    lp = lit.load()
    for x, y in wing_pixels:
        r, g, b, a = source_pixels[x, y]
        # Brighten existing energy toward warm gold without adding a halo or
        # washing out already-bright highlights. Alpha and shape never change.
        lp[x, y] = (
            round(r + (255-r) * .50 * strength),
            round(g + max(0, 240-g) * .52 * strength),
            round(b + max(0, 155-b) * .36 * strength),
            a,
        )
    frame = Image.new('RGBA', original.size, (0, 0, 0, 0))
    frame.paste(lit, (0, dy))  # Integer translation, no mask, no resampling.
    expected_alpha = Image.new('L', original.size, 0)
    expected_alpha.paste(original.getchannel('A'), (0, dy))
    assert frame.getchannel('A').tobytes() == expected_alpha.tobytes()
    assert frame.getchannel('A').histogram()[255] == source_opaque
    restored = Image.new('RGBA', original.size, (0, 0, 0, 0))
    restored.paste(frame, (0, -dy))
    assert restored.getchannel('A').tobytes() == original.getchannel('A').tobytes()
    restored_px = restored.load()
    changed_outside_wings = sum(
        1 for y in range(H) for x in range(W)
        if not mask_pixels[x,y] and source_pixels[x,y][3] and restored_px[x,y] != source_pixels[x,y]
    )
    assert changed_outside_wings == 0
    bbox = frame.getbbox()
    assert bbox == (11, 22+dy, 428, 408+dy)
    assert set(frame.getchannel('A').get_flattened_data()) == {0, 255}
    frame.save(OUT / 'frames' / f'ignis-idle-{i+1:02d}.png', optimize=True)
    frames.append(frame)
    entries.append({'index': i+1, 'durationMs': duration, 'offsetX': 0, 'offsetY': dy,
                    'wingIntensity': strength, 'bbox': bbox,
                    'changedPixelsOutsideWings': changed_outside_wings})

assert frames[0].tobytes() == frames[-1].tobytes() == original.tobytes()
webp_path = OUT / 'ignis-idle-10f.webp'
frames[0].save(webp_path, 'WEBP', save_all=True, append_images=frames[1:],
               duration=DURATIONS, loop=0, lossless=True, quality=100,
               method=6, minimize_size=False, kmin=1, kmax=1,
               background=(0,0,0,0), exact=True)

# Verify the decoded deliverable, not just the pre-encoding frames.
decoded = Image.open(webp_path)
assert decoded.n_frames == 10, f'Encoder merged frames: {decoded.n_frames}'
assert decoded.info.get('loop') == 0
decoded_durations = []
for i, expected in enumerate(frames):
    decoded.seek(i)
    actual = decoded.convert('RGBA')
    decoded_durations.append(decoded.info['duration'])
    assert actual.getchannel('A').tobytes() == expected.getchannel('A').tobytes()
    assert visible_delta(actual, expected) == 0, f'Lossless roundtrip failed: {i+1}'
assert decoded_durations == DURATIONS

sheet = Image.new('RGBA', (W*5, H*2), (0,0,0,0))
for i, frame in enumerate(frames):
    sheet.paste(frame, ((i%5)*W, (i//5)*H))
sheet.save(OUT / 'ignis-idle-10f-sheet.png', optimize=True)
for i, frame in enumerate(frames):
    x,y = (i%5)*W, (i//5)*H
    assert sheet.crop((x,y,x+W,y+H)).tobytes() == frame.tobytes()

metadata = {
    'name': 'Ignis idle — original pixels', 'status': 'preview-only; not integrated',
    'method': 'User-authorized deterministic pixel copying; integer y translation and wing RGB adjustment only',
    'source': str(SOURCE), 'sourceSha256': SOURCE_SHA,
    'animatedFile': webp_path.name, 'frameWidth': W, 'frameHeight': H,
    'frameCount': 10, 'loop': True, 'durationMs': sum(DURATIONS),
    'anchor': {'x':220, 'y':408}, 'maxHoverPixels': 8,
    'sheetFile': 'ignis-idle-10f-sheet.png', 'columns':5, 'rows':2,
    'playbackOrder': 'row-major, left to right then top to bottom',
    'wingMaskPixels': len(wing_pixels), 'opaquePixelsPerFrame': source_opaque,
    'frames': entries,
    'verification': {'decodedWebpFrames': 10, 'visiblePixelRoundtripDifferences': 0,
                     'alphaRoundtripDifferences': 0, 'bodyChangesOutsideWings': 0,
                     'firstAndLastEqualSource': True, 'clippedPixels': 0,
                     'alphaValues': [0,255], 'scaleChanges': False, 'horizontalDrift': False},
    'files': {p.name: {'bytes':p.stat().st_size, 'sha256':hashlib.sha256(p.read_bytes()).hexdigest()}
              for p in [webp_path, OUT/'ignis-idle-10f-sheet.png']},
}
assert hashlib.sha256(SOURCE.read_bytes()).hexdigest() == SOURCE_SHA
(OUT/'ignis-idle-10f.json').write_text(json.dumps(metadata, ensure_ascii=False, indent=2), encoding='utf-8')

# Diagnostic preview: only this image has a checkerboard and labels.
diagnostic = Image.new('RGB', (W*3, H+40), '#15202b')
for yy in range(0,H,16):
    for xx in range(0,W*3,16):
        if (xx//16+yy//16)%2:
            ImageDraw.Draw(diagnostic).rectangle((xx,yy,xx+15,yy+15), fill='#22313c')
for j, i in enumerate([0,5,9]):
    diagnostic.paste(frames[i], (j*W,0), frames[i])
    ImageDraw.Draw(diagnostic).text((j*W+12,H+12), f'Frame {i+1:02d} / dy {OFFSETS[i]} px / glow {GLOW[i]}', fill='white')
diagnostic.save(WORK/'calm-peak-return.png')

print(json.dumps({'output': str(OUT), 'webpBytes':webp_path.stat().st_size,
                  'frameCount':10, 'size':[W,H], 'loopMs':sum(DURATIONS),
                  'wingMaskPixels':len(wing_pixels), 'verification':metadata['verification']}, indent=2))
