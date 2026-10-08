"""Mechanical split/binary-alpha/nearest-neighbor packing only. Never redraw sprites.
All six cells use ONE scale; per-cell offsets align feet without size pumping.
Usage: python tools/export-azure-sequence.py SOURCE [--check]
"""
import hashlib, json, sys
from pathlib import Path
from PIL import Image
from spritecheck import opaque_bbox, feet_x, checker_ratio

ROOT = Path(__file__).resolve().parents[1]
DEST = ROOT / "assets/motions/sequence/azure-dagger-v1"
LABELS = ["준비", "당기기", "베기 시작", "접촉", "후속", "복귀"]
DURATIONS = [70, 70, 40, 50, 80, 90]
def sha(p): return hashlib.sha256(p.read_bytes()).hexdigest()
def inspect(source):
    im = Image.open(source).convert("RGBA")
    if im.width % 3 or im.height % 2: raise ValueError("Unequal 3x2 cells")
    w, h = im.width // 3, im.height // 2
    cells = [im.crop(((i%3)*w, (i//3)*h, (i%3+1)*w, (i//3+1)*h)) for i in range(6)]
    for i, cell in enumerate(cells):
        bb, _ = opaque_bbox(cell)
        if not bb: raise ValueError(f"Empty frame {i}")
        # The source must already have real transparent margins. No removal here.
        alpha = cell.getchannel("A")
        edges = [alpha.crop((0,0,w,4)),alpha.crop((0,h-4,w,h)),
                 alpha.crop((0,0,4,h)),alpha.crop((w-4,0,w,h))]
        if any(e.getextrema()[1] > 32 for e in edges):
            raise ValueError(f"Frame {i} reaches cell boundary; regenerate")
    return im, cells

def export(source):
    im, cells = inspect(source)
    org = Image.open(ROOT/"assets/azure.png").convert("RGBA")
    obb, om = opaque_bbox(org)
    # Same production alpha quantization as the existing atlas export tool.
    # Remove sub-threshold sampling fringes only; RGB artwork is never repainted.
    for tile in cells:
        tile.putalpha(tile.getchannel('A').point(lambda v: 255 if v >= 128 else 0))
    bb0, _ = opaque_bbox(cells[0])
    factor = (obb[3]-obb[1]) / (bb0[3]-bb0[1])
    tiles = [t.resize((round(t.width*factor),round(t.height*factor)),Image.Resampling.NEAREST) for t in cells]
    # One shared feet anchor, chosen to contain every frame. Never individually
    # clamp frames (causes foot sliding) or change the scale (causes size pumping).
    measurements = [opaque_bbox(t) for t in tiles]
    lower = max(8 + feet_x(m,b) - b[0] for b,m in measurements)
    upper = min(432 + feet_x(m,b) - b[2] for b,m in measurements)
    if lower > upper: raise ValueError('No common anchor fits; regenerate')
    anchor = round(max(lower,min(feet_x(om,obb),upper)))
    DEST.mkdir(parents=True,exist_ok=True)
    frames = []
    atlas = Image.new("RGBA",(1320,840))
    for i, tile in enumerate(tiles):
        # Scaling entire cell by one factor preserves cross-frame proportions.
        bb, mask = opaque_bbox(tile)
        x = round(anchor-feet_x(mask,bb))
        y = obb[3]-bb[3]
        # Check complete nonzero alpha, not only the opaque measurement.
        full = tile.getchannel("A").getbbox()
        if x+full[0] < 0 or x+full[2] > 440 or y+full[1] < 0 or y+full[3] > 420:
            raise ValueError(f"Frame {i} clipped; regenerate, do not squash")
        art = tile.crop(full)
        out = Image.new("RGBA",(440,420))
        out.paste(art,(x+full[0],y+full[1]))
        out.putdata([(r,g,b,a) if a else (0,0,0,0) for r,g,b,a in out.getdata()])
        path = DEST/f"frame-{i+1:02}.png"
        out.save(path)
        atlas.paste(out,((i%3)*440,(i//3)*420))
        frames.append({"src":str(path.relative_to(ROOT)).replace("\\","/"),
                       "duration":DURATIONS[i],"label":LABELS[i],"packing":[x,y],
                       "sha256":sha(path)})
    atlas.save(DEST/"atlas.png")
    animated = [Image.open(DEST/f'frame-{i+1:02}.png').convert('RGBA') for i in range(6)]
    animated[0].save(DEST/'preview.webp',save_all=True,append_images=animated[1:],
                     duration=[d*2 for d in DURATIONS],loop=0,lossless=True,method=6)
    data = {"version":1,"candidate":True,"approval":"pending",
            "source":str(source.relative_to(ROOT)).replace("\\","/"),
            "sourceSha256":sha(source),"originalSha256":sha(ROOT/"assets/azure.png"),
            "grid":[3,2],"cell":[440,420],"scale":factor,"feetAnchor":anchor,
            "anchorDeltaFromOriginal":round(anchor-feet_x(om,obb),3),
            "total":sum(DURATIONS),"effectAt":110,"impactAt":180,
            "frames":frames,"atlas":"assets/motions/sequence/azure-dagger-v1/atlas.png",
            "atlasSha256":sha(DEST/"atlas.png"),
            "animatedPreview":"assets/motions/sequence/azure-dagger-v1/preview.webp",
            "animatedPreviewSpeed":0.5,
            "notes":["Built-in image_gen edit; mechanical nearest-neighbor packing only.",
                     "Common scale/shared feet anchor; binary alpha threshold128, no recoloring.",
                     "Armed ready frame is preview idle; original unarmed idle unchanged.",
                     "Identity/detail continuity still requires visual approval."]}
    (DEST/"sequence.json").write_text(json.dumps(data,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    return check(data)

def check(data=None):
    data = data or json.loads((DEST/"sequence.json").read_text(encoding="utf-8"))
    frames = data["frames"]
    assert len(frames)==6 and sum(f["duration"] for f in frames)==400
    assert sha(ROOT/data["source"])==data["sourceSha256"]
    assert sha(ROOT/"assets/azure.png")==data["originalSha256"]
    atlas=Image.open(ROOT/data["atlas"])
    assert atlas.size==(1320,840) and sha(ROOT/data["atlas"])==data["atlasSha256"]
    reports=[]
    for i, f in enumerate(frames):
        p=ROOT/f["src"]; im=Image.open(p)
        assert im.mode=="RGBA" and im.size==(440,420) and sha(p)==f["sha256"]
        bb,mask=opaque_bbox(im)
        assert bb and bb[3]-1==407
        assert set(im.getchannel('A').getdata())=={0,255}
        assert abs(feet_x(mask,bb)-data['feetAnchor'])<=1
        assert all(im.getpixel(pt)[3]==0 for pt in [(0,0),(439,0),(0,419),(439,419)])
        assert checker_ratio(im)<0.08
        assert atlas.crop(((i%3)*440,(i//3)*420,(i%3+1)*440,(i//3+1)*420)).tobytes()==im.tobytes()
        reports.append({"frame":i,"bbox":bb,"footY":bb[3]-1,"checker":round(checker_ratio(im),4)})
    assert len({f["sha256"] for f in frames}) >= 5, "Frames are duplicate poses"
    preview=Image.open(ROOT/data['animatedPreview'])
    assert preview.size==(440,420) and preview.n_frames==6 and preview.info.get('loop')==0
    for i, f in enumerate(frames):
        preview.seek(i); preview.load()
        assert preview.info['duration']==f['duration']*2
        decoded=preview.convert('RGBA'); original=Image.open(ROOT/f['src']).convert('RGBA')
        assert decoded.getchannel('A').tobytes()==original.getchannel('A').tobytes()
        # WebP may discard invisible RGB; compare visible pixels, not alpha0 RGB.
        background=Image.new('RGBA',(440,420),(0,0,0,255))
        assert Image.alpha_composite(background,decoded).tobytes()==Image.alpha_composite(background,original).tobytes()
    print(json.dumps({"ok":True,"frames":reports,"commonScale":data["scale"],
                      "total":data["total"],"impactAt":data["impactAt"]},ensure_ascii=False,indent=2))
    return data
if __name__=="__main__":
    if "--check" in sys.argv: check()
    else: export(Path(sys.argv[1]).resolve())
