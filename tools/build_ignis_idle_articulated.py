"""Reproduce Ignis hangar idle: original pixel cutouts, nearest-neighbor articulation.

Requires Python 3 and Pillow. No generated/repainted imagery, smoothing or blur.
Source is read-only; output defaults to ignored dist/art-review.
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter, ImageChops
import argparse
import hashlib
import json
import math

parser = argparse.ArgumentParser()
parser.add_argument('--source', type=Path, default=Path(__file__).resolve().parents[1]/'assets'/'ignis.png')
parser.add_argument('--out', type=Path, default=Path(__file__).resolve().parents[1]/'dist'/'art-review'/'ignis-idle-36-articulated')
args=parser.parse_args()
SOURCE, OUT=args.source.resolve(), args.out.resolve()
OUT.mkdir(parents=True,exist_ok=True)
(OUT/'frames').mkdir(exist_ok=True)
(OUT/'inspection').mkdir(exist_ok=True)
source_hash=hashlib.sha256(SOURCE.read_bytes()).hexdigest()
original=Image.open(SOURCE).convert('RGBA')
assert original.size==(440,420)
W,H=original.size
opaque=original.getchannel('A')
assert set(opaque.get_flattened_data())=={0,255}
source_data=list(original.get_flattened_data())
source_pixels=original.load()

WING_REGIONS=[
    [(408,30),(389,69),(351,109),(317,119),(310,104),(330,76)],
    [(323,118),(409,116),(375,139),(331,148),(305,147)],
    [(303,153),(326,149),(393,185),(353,188),(312,171)],
    [(299,179),(312,181),(340,211),(332,214),(314,200),(300,188)],
    [(51,67),(87,98),(94,118),(90,129),(74,121),(62,95)],
    [(48,113),(70,119),(83,137),(84,149),(74,143),(60,132)],
    [(58,150),(80,151),(88,169),(86,180),(73,170)],
    [(55,207),(70,186),(83,176),(94,180),(86,192),(70,201)],
]
regions=Image.new('L',(W,H),0)
for polygon in WING_REGIONS:
    ImageDraw.Draw(regions).polygon(polygon,fill=255)
mask=Image.new('L',(W,H),0)
mp,rp=mask.load(),regions.load()
wing=[]
for y in range(H):
    for x in range(W):
        r,g,b,a=source_pixels[x,y]
        if rp[x,y] and a==255 and r>=140 and g>=65 and r-g>=8 and g-b>=18:
            mp[x,y]=255
            wing.append((x,y))
assert len(wing)==8223

# Hard pixel rings, not blurred or resized imagery. Clip all glow away from
# every opaque source pixel so the armor/body/weapon cannot be overpainted.
rings=[]
last=mask
for distance in range(1,4):
    grown=last.filter(ImageFilter.MaxFilter(3))
    ring=ImageChops.subtract(grown,last)
    ring=ImageChops.multiply(ring,ImageChops.invert(opaque))
    rings.append([(x,y) for y in range(H) for x in range(W) if ring.getpixel((x,y))])
    last=grown
allowed_effect=set(p for ring in rings for p in ring)
assert all(source_pixels[p][3]==0 for p in allowed_effect)
mask.save(OUT/'inspection'/'wing-mask.png')

def interpolate(a,b,t):
    return round(a+(b-a)*max(0,min(1,t)))

def frame_for(index):
    phase=index/36
    height=(1-math.cos(2*math.pi*phase))/2
    charge=height**.85
    # One short energy crest per 3-second loop, positioned at hover maximum.
    flash=math.exp(-((phase-.505)/.055)**2)
    dy=-math.floor(10*height+.5+1e-9)
    frame=original.copy()
    fp=frame.load()
    luma_gain=0
    for x,y in wing:
        r,g,b,a=source_pixels[x,y]
        # Stronger gold with source facet contrast retained at every level.
        gold=(interpolate(r,255,.75*charge),
              interpolate(g,max(g,240),.71*charge),
              interpolate(b,max(b,157),.57*charge))
        # The flash accents existing brighter clusters rather than flattening
        # the entire orange panel into a white silhouette.
        highlight=max(0,min(1,(g-95)/125))
        pulse=flash*(.16+.45*highlight)
        rgb=(interpolate(gold[0],255,pulse),
             interpolate(gold[1],max(gold[1],253),pulse),
             interpolate(gold[2],max(gold[2],218),pulse))
        fp[x,y]=(*rgb,a)
        luma_gain+=(rgb[0]-r)*.2126+(rgb[1]-g)*.7152+(rgb[2]-b)*.0722
    halo_strength=min(1,charge**1.25*(.70+.30*flash))
    added=0
    for ring_index,coordinates in enumerate(rings):
        max_alpha=(168,88,32)[ring_index]
        alpha=round(max_alpha*halo_strength/4)*4
        if alpha==0:
            continue
        warm=[(255,193,73),(255,142,34),(255,106,22)][ring_index]
        bright=[(255,236,159),(255,192,84),(255,150,48)][ring_index]
        color=tuple(interpolate(warm[c],bright[c],flash*.8) for c in range(3))
        for x,y in coordinates:
            fp[x,y]=(*color,alpha)
            added+=1
    frame, articulation=articulate(frame,height)
    moved=Image.new('RGBA',(W,H),(0,0,0,0))
    moved.paste(frame,(0,dy))
    return moved,{'index':index+1,'offsetX':0,'offsetY':dy,'charge':round(charge,6),
                  'flash':round(flash,6),'addedGlowPixels':added,
                  'averageWingLuminanceGain':round(luma_gain/len(wing),3), 'articulation':articulation}

def smoothstep(t):
    t=max(0,min(1,t))
    return t*t*(3-2*t)

PARTS=[
    ('right_wing',(283,138),-1.8,[[(262,114),(269,96),(361,37),(328,81),(413,26),(391,78),(350,113),(414,114),(376,143),(401,179),(354,166),(430,289),(366,253),(338,243),(317,212),(293,184),(270,177),(271,158),(289,153),(299,145),(299,130),(288,119),(274,121)]]),
    ('left_wing',(101,153),2.0,[[(48,63),(70,77),(88,96),(105,122),(94,134),(81,145),(60,129),(46,110),(77,124),(65,100)],[(80,146),(93,149),(88,162),(94,174),(75,193),(53,209),(67,184),(80,173),(67,173),(54,162),(52,155),(69,151)]]),
    ('left_calf',(133,315),-2.6,[[(119,304),(135,297),(153,306),(153,335),(145,344),(148,384),(129,391),(106,388),(91,395),(58,395),(58,380),(71,365),(78,354),(81,340),(93,326),(101,317)]]),
    ('right_calf',(213,322),2.6,[[(197,305),(219,302),(235,317),(242,345),(248,365),(245,389),(234,409),(207,409),(193,395),(188,366),(189,348),(184,328)]])
]
parts=[]
claimed=Image.new('L',(W,H),0)
pinned_seams=set()
for name,pivot,angle,polygons in PARTS:
    geometry=Image.new('L',(W,H),0)
    for polygon in polygons:
        ImageDraw.Draw(geometry).polygon(polygon,fill=255)
    body_mask=ImageChops.multiply(geometry,opaque)
    # Include only attached glow on transparent pixels. No opaque neighbors
    # are grabbed by mask dilation; shoulder hubs/arms remain in front.
    ownership=ImageChops.lighter(body_mask,ImageChops.multiply(body_mask.filter(ImageFilter.MaxFilter(7)),ImageChops.invert(opaque)))
    ownership=ImageChops.subtract(ownership,claimed)
    claimed=ImageChops.lighter(claimed,ownership)
    fixed_neighbors=ImageChops.subtract(opaque,body_mask)
    seams=ImageChops.multiply(body_mask,fixed_neighbors.filter(ImageFilter.MaxFilter(3)))
    near=seams
    # Zero displacement at every cut through an opaque armor cluster, with a
    # smooth influence ramp away from joints. Outer silhouette is not pinned.
    weights=[1.0]*(W*H)
    for distance in range(16):
        data=list(near.get_flattened_data())
        amount=smoothstep((distance-2)/12)
        for pos,value in enumerate(data):
            if value and weights[pos]==1.0:
                weights[pos]=amount
        near=near.filter(ImageFilter.MaxFilter(3))
    for y in range(H):
        for x in range(W):
            if name.endswith('calf'):
                root=smoothstep((y-pivot[1]-7)/42)
            else:
                root=smoothstep((math.hypot(x-pivot[0],y-pivot[1])-14)/30)
            weights[y*W+x]*=root
            if body_mask.getpixel((x,y)) and weights[y*W+x]==0:
                pinned_seams.add((x,y))
    bbox=ownership.getbbox()
    bounds=(max(0,bbox[0]-7),max(0,bbox[1]-7),min(W,bbox[2]+7),min(H,bbox[3]+7))
    parts.append({'name':name,'pivot':pivot,'angle':angle,'mask':ownership,'bodyMask':body_mask,'weights':weights,'bounds':bounds})
    body_mask.save(OUT/'inspection'/f'{name}-mask.png')
fixed=ImageChops.multiply(opaque,ImageChops.invert(claimed))
fixed_data=list(fixed.get_flattened_data())

def articulate(lit,height):
    if height<.001:
        return lit.copy(),{p['name']:{'angleDegrees':0,'maxPixelDisplacement':0} for p in parts}
    base=lit.copy()
    bp=base.load()
    original_lit=lit.load()
    for pos,value in enumerate(claimed.get_flattened_data()):
        if value:
            bp[pos%W,pos//W]=(0,0,0,0)
    foreground=base.copy()
    result=Image.new('RGBA',(W,H),(0,0,0,0))
    stats={}
    for part in parts:
        angle=math.radians(part['angle']*height)
        sine,cosine=math.sin(angle),math.cos(angle)
        px,py=part['pivot']
        weights=part['weights']
        own=part['mask'].load()
        layer=Image.new('RGBA',(W,H),(0,0,0,0))
        lp=layer.load()
        max_displacement=0
        x0,y0,x1,y1=part['bounds']
        for y in range(y0,y1):
            for x in range(x0,x1):
                # Invert the pinned joint field, then pick one source pixel.
                # No interpolation, blended edge, generated fill or rescaling.
                sx,sy=float(x),float(y)
                for _ in range(4):
                    ix,iy=max(0,min(W-1,round(sx))),max(0,min(H-1,round(sy)))
                    weight=weights[iy*W+ix]
                    dx,dy=sx-px,sy-py
                    sx=x-((cosine-1)*dx-sine*dy)*weight
                    sy=y-(sine*dx+(cosine-1)*dy)*weight
                ix,iy=round(sx),round(sy)
                if 0<=ix<W and 0<=iy<H and own[ix,iy]:
                    pixel=original_lit[ix,iy]
                    lp[x,y]=pixel
                    if pixel[3]:
                        max_displacement=max(max_displacement,abs(ix-x),abs(iy-y))
        result=Image.alpha_composite(result,layer)
        stats[part['name']]={'angleDegrees':round(part['angle']*height,4),'maxPixelDisplacement':max_displacement}
    # The fixed source pixels occlude moving layers exactly as in the source.
    result=Image.alpha_composite(result,foreground)
    return result,stats

frames=[]
entries=[]
durations=[83,83,84]*12
source_opaque=sum(1 for p in source_data if p[3])
mask_data=list(mask.get_flattened_data())
for i,duration in enumerate(durations):
    frame,entry=frame_for(i)
    dy=entry['offsetY']
    restored=Image.new('RGBA',(W,H),(0,0,0,0))
    restored.paste(frame,(0,-dy))
    rp=restored.load()
    restored_data=list(restored.get_flattened_data())
    # Fixed head, torso, upper legs, arms, weapon and shoulder hubs are an
    # immutable foreground layer. Only wing energy is permitted to change RGB.
    changed_body=sum(1 for p,q,m,k in zip(source_data,restored_data,mask_data,fixed_data) if k and not m and p!=q)
    assert changed_body==0
    assert all(rp[x,y]==source_pixels[x,y] for x,y in pinned_seams if not mp[x,y])
    assert not any(frame.getpixel((x,y))[3] for x in range(W) for y in (0,H-1))
    assert not any(frame.getpixel((x,y))[3] for y in range(H) for x in (0,W-1))
    entry.update({'durationMs':duration,'fixedBodyPixelDifferences':changed_body,
                  'opaquePixels':sum(p[3]==255 for p in restored_data)})
    frames.append(frame)
    entries.append(entry)
    frame.save(OUT/'frames'/f'ignis-idle-{i+1:02d}.png',optimize=True)
    print(f'frame {i+1:02d}/36: dy {dy:3d}, glow {entry["charge"]:.3f}, fixed body unchanged; joints articulated',flush=True)

assert frames[0].tobytes()==original.tobytes()
assert all(a.tobytes()!=b.tobytes() for a,b in zip(frames,frames[1:]))
assert entries[-1]['offsetY']==entries[0]['offsetY']==0
seam_delta=max(abs(a[c]-b[c]) for a,b in zip(frames[-1].get_flattened_data(),frames[0].get_flattened_data()) if a[3] or b[3] for c in range(4))
assert seam_delta<=4, f'Loop seam too large: {seam_delta}'

webp=OUT/'ignis-idle-36f-articulated.webp'
print('Encoding 36 lossless WebP frames...',flush=True)
frames[0].save(webp,'WEBP',save_all=True,append_images=frames[1:],duration=durations,loop=0,
               lossless=True,quality=100,method=4,minimize_size=True,background=(0,0,0,0),exact=True)
decoded=Image.open(webp)
assert decoded.n_frames==36, f'Unexpected frame count: {decoded.n_frames}'
assert decoded.info.get('loop')==0
for i,expected in enumerate(frames):
    decoded.seek(i)
    actual=decoded.convert('RGBA')
    assert decoded.info['duration']==durations[i]
    assert actual.getchannel('A').tobytes()==expected.getchannel('A').tobytes()
    assert all(a==b for a,b in zip(actual.get_flattened_data(),expected.get_flattened_data()) if a[3] or b[3]),f'WebP roundtrip {i+1}'
assert hashlib.sha256(SOURCE.read_bytes()).hexdigest()==source_hash

# A contact sheet for game-tool imports; no guide lines or background.
sheet=Image.new('RGBA',(W*6,H*6),(0,0,0,0))
for i,frame in enumerate(frames):
    sheet.paste(frame,((i%6)*W,(i//6)*H))
sheet.save(OUT/'ignis-idle-36f-articulated-sheet.png',optimize=True)

# Diagnostic panels are separate from the actual transparent game asset.
for title,bg in [('dark','#101c2b'),('light','#f1f2f4')]:
    contact=Image.new('RGB',(W*4,H+40),bg)
    draw=ImageDraw.Draw(contact)
    for j,i in enumerate([0,10,18,28]):
        contact.paste(frames[i],(j*W,0),frames[i])
        draw.text((j*W+12,H+12),f'Frame {i+1:02d}  |  dy {entries[i]["offsetY"]}  |  glow {entries[i]["charge"]:.2f}',fill='#91a6be' if title=='dark' else '#263749')
    contact.save(OUT/'inspection'/f'keyframes-{title}.png')

metadata={'name':'Ignis hangar idle 36 — enhanced emission and articulation',
          'source':'assets/ignis.png','sourceSha256':source_hash,'size':[W,H],'frameCount':36,
          'durationMs':sum(durations),'loop':True,'maxHoverPixels':10,'maxGlowRadiusPixels':3,
          'method':'Original pixel layers; nearest-neighbor joint deformation with pinned cut seams; integer hover; wing RGB and attached hard pixel glow only',
          'parts':[{'name':p['name'],'pivot':p['pivot'],'maxAngleDegrees':p['angle']} for p in parts],
          'files':{'animated':webp.name,'sheet':'ignis-idle-36f-articulated-sheet.png'},
          'grid':{'columns':6,'rows':6,'frameWidth':W,'frameHeight':H},'anchor':{'x':220,'y':408},
          'frames':entries,'verification':{'decodedFrames':36,'durationMs':3000,'fixedBodyPixelDifferences':0,
          'fixedOpaquePixels':sum(bool(v) for v in fixed_data),'pinnedSeamPixels':len(pinned_seams),
          'webpRoundtripVisibleDifferences':0,'webpRoundtripAlphaDifferences':0,
          'firstFrameEqualsSource':True,'loopSeamMaxChannelDifference':seam_delta,
          'loopSeamVerticalDifference':0,'canvasEdgesTransparent':True},
          'bytes':webp.stat().st_size,'sha256':hashlib.sha256(webp.read_bytes()).hexdigest()}
(OUT/'ignis-idle-36f-articulated.json').write_text(json.dumps(metadata,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({'out':str(OUT),'bytes':metadata['bytes'],'peakWingLuminanceGain':max(e['averageWingLuminanceGain'] for e in entries),'verification':metadata['verification']},indent=2),flush=True)
