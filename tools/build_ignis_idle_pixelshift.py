"""Reproduce Ignis hangar idle: exact original pixel cutouts, integer translations only.

Requires Python 3 and Pillow. No generated/repainted imagery, smoothing or blur.
Source is read-only; output defaults to ignored dist/art-review.
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter, ImageChops
import argparse
import hashlib
import json
import math
from io import BytesIO
import struct

parser = argparse.ArgumentParser()
parser.add_argument('--source', type=Path, default=Path(__file__).resolve().parents[1]/'assets'/'ignis.png')
parser.add_argument('--out', type=Path, default=Path(__file__).resolve().parents[1]/'dist'/'art-review'/'ignis-idle-36-pixelshift')
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

PARTS=[
    ('right_wing',(283,138),-1.8,[[(262,114),(269,96),(361,37),(328,81),(413,26),(391,78),(350,113),(414,114),(376,143),(401,179),(354,166),(430,295),(396,282),(368,263),(344,256),(326,244),(309,221),(296,201),(287,180),(270,177),(271,158),(289,153),(299,145),(299,130),(288,119),(274,121)]]),
    ('left_wing',(101,153),2.0,[[(48,63),(70,77),(88,96),(105,122),(94,134),(81,145),(60,129),(46,110),(77,124),(65,100)],[(80,146),(93,149),(88,162),(94,174),(75,193),(53,209),(67,184),(80,173),(67,173),(54,162),(52,155),(69,151)]]),
    ('left_calf',(133,315),-2.6,[[(119,304),(135,297),(153,306),(153,335),(145,344),(148,384),(129,391),(106,388),(91,395),(58,395),(58,380),(71,365),(78,354),(81,340),(93,326),(101,317)]]),
    ('right_calf',(213,322),2.6,[[(197,305),(219,302),(235,317),(242,345),(248,365),(245,389),(234,409),(207,409),(193,395),(188,366),(189,348),(184,328)]])
]
parts=[]
body_claimed=Image.new('L',(W,H),0)
for name,pivot,_unused_angle,polygons in PARTS:
    geometry=Image.new('L',(W,H),0)
    for polygon in polygons:
        ImageDraw.Draw(geometry).polygon(polygon,fill=255)
    body_mask=ImageChops.subtract(ImageChops.multiply(geometry,opaque),body_claimed)
    body_claimed=ImageChops.lighter(body_claimed,body_mask)
    coords=[(x,y) for y in range(H) for x in range(W) if body_mask.getpixel((x,y))]
    parts.append({'name':name,'mask':body_mask,'coords':coords,'direction':1 if name in ('right_wing','left_calf') else -1})

fixed=ImageChops.subtract(opaque,body_claimed)
guards=Image.new('L',(W,H),0)
fixed_neighbors=fixed.filter(ImageFilter.MaxFilter(3))
for part in parts:
    seam=ImageChops.multiply(part['mask'],fixed_neighbors)
    guard=ImageChops.multiply(seam.filter(ImageFilter.MaxFilter(7)),part['mask'])
    guards=ImageChops.lighter(guards,guard)
    part['guard']=guard
    part['mask'].save(OUT/'inspection'/f'{part["name"]}-mask.png')
    guard.save(OUT/'inspection'/f'{part["name"]}-guard.png')
fixed=ImageChops.lighter(fixed,guards)
fixed_data=list(fixed.get_flattened_data())
fixed_coords=[(x,y) for y in range(H) for x in range(W) if fixed.getpixel((x,y))]
guard_coords=[(x,y) for y in range(H) for x in range(W) if guards.getpixel((x,y))]
fixed.save(OUT/'inspection'/'fixed-with-guards.png')

# Assign every halo pixel to exactly one nearest wing layer, if attached to it.
# The original body colors/alpha and halo colors/alpha are never mixed.
halo_owner={}
for x,y in allowed_effect:
    candidates=[]
    for n,part in enumerate(parts):
        if not part['name'].endswith('wing'):
            continue
        near=min((abs(xx-x)+abs(yy-y) for yy in range(max(0,y-3),min(H,y+4))
                  for xx in range(max(0,x-3),min(W,x+4)) if part['mask'].getpixel((xx,yy))),default=99)
        if near<99:
            candidates.append((near,n))
    halo_owner[x,y]=min(candidates)[1] if candidates else None

def articulate(lit,height):
    litp=lit.load()
    result=Image.new('RGBA',(W,H),(0,0,0,0))
    rp=result.load()
    origin={}
    offsets=[]
    stats={}
    horizontal=math.floor(2*height+.5+1e-9)
    vertical=-math.floor(height+.5+1e-9)
    for n,part in enumerate(parts):
        dx,dy=part['direction']*horizontal,vertical
        offsets.append((dx,dy))
        for x,y in part['coords']:
            tx,ty=x+dx,y+dy
            assert 0<tx<W-1 and 0<ty<H-1
            rp[tx,ty]=litp[x,y]
            origin[tx,ty]=(x,y,part['name'])
        stats[part['name']]={'offsetX':dx,'offsetY':dy,'maxPixelDisplacement':max(abs(dx),abs(dy)),
                             'sourcePixels':len(part['coords'])}
    # Original foreground and a 3px guard across each opaque cut occlude the
    # translated cutouts. Every visible opaque value is a direct source copy.
    for x,y in fixed_coords:
        rp[x,y]=litp[x,y]
        origin[x,y]=(x,y,'fixed')
    assert all(rp[x,y]==litp[x,y] for x,y in guard_coords)
    assert all(rp[x,y]==litp[sx,sy] and rp[x,y][3]==255 for (x,y),(sx,sy,_) in origin.items())
    assert all(rp[x,y][3]==255 for x,y in fixed_coords)
    # Only guard pixels can deliberately occur twice (the stationary joint
    # cover and the cutout beneath it); exposed moving silhouettes occur once.
    destinations={}
    for dest,(sx,sy,owner) in origin.items():
        destinations.setdefault((sx,sy),[]).append((dest,owner))
    duplicated=[(source,places) for source,places in destinations.items() if len(places)>1]
    assert all(guards.getpixel(source) for source,_ in duplicated)
    for x,y in allowed_effect:
        pixel=litp[x,y]
        if not pixel[3]:
            continue
        owner=halo_owner[x,y]
        dx,dy=offsets[owner] if owner is not None else (0,0)
        tx,ty=x+dx,y+dy
        if (tx,ty) in origin:
            continue
        # Overlapping halo rings select a whole source pixel, never blend.
        if pixel[3]>rp[tx,ty][3]:
            rp[tx,ty]=pixel
    # Every solid output pixel must have source+offset ownership; no halo is
    # allowed to produce a partially transparent hole in the opaque body.
    solid={(x,y) for y in range(H) for x in range(W) if rp[x,y][3]==255}
    assert solid==set(origin)
    stats['verification']={'opaqueOwnershipPixels':len(origin),'unownedOpaquePixels':0,
                           'copiedPixelDifferences':0,'guardPixelDifferences':0,
                           'repeatedSourcePixelsUnderJointGuards':len(duplicated)}
    return result,stats

frames=[]
entries=[]
durations=[83,83,84]*12
mask_data=list(mask.get_flattened_data())
source_inside=opaque.filter(ImageFilter.MinFilter(7))
# Only joint-adjacent pixels at least 3px inside the original silhouette are
# required to stay covered. This excludes the intentional 2px outer movement;
# the original guard itself is checked pixel-for-pixel inside articulate().
joint_interior=ImageChops.multiply(source_inside,guards.filter(ImageFilter.MaxFilter(3)))
joint_coords=[(x,y) for y in range(H) for x in range(W) if joint_interior.getpixel((x,y))]
for i,duration in enumerate(durations):
    frame,entry=frame_for(i)
    dy=entry['offsetY']
    restored=Image.new('RGBA',(W,H),(0,0,0,0))
    restored.paste(frame,(0,-dy))
    rp=restored.load()
    restored_data=list(restored.get_flattened_data())
    changed_body=sum(1 for p,q,m,k in zip(source_data,restored_data,mask_data,fixed_data) if k and not m and p!=q)
    assert changed_body==0
    holes=[(x,y) for x,y in joint_coords if rp[x,y][3]!=255]
    if holes:
        debug=restored.copy(); dp=debug.load()
        for xy in holes:dp[xy]=(255,0,255,255)
        debug.save(OUT/'inspection'/f'joint-holes-{i+1:02d}.png')
    assert not holes,f'Exposed internal cut at frame {i+1}: {holes[:20]}'
    assert not any(frame.getpixel((x,y))[3] for x in range(W) for y in (0,H-1))
    assert not any(frame.getpixel((x,y))[3] for y in range(H) for x in (0,W-1))
    entry.update({'durationMs':duration,'fixedBodyPixelDifferences':changed_body,'jointInteriorHoles':0,
                  'opaquePixels':sum(p[3]==255 for p in restored_data)})
    frames.append(frame); entries.append(entry)
    frame.save(OUT/'frames'/f'ignis-idle-{i+1:02d}.png',optimize=True)
    print(f'frame {i+1:02d}/36: dy {dy:3d}, glow {entry["charge"]:.3f}, fixed body and integer pixel ownership verified',flush=True)

assert frames[0].tobytes()==original.tobytes()
assert all(a.tobytes()!=b.tobytes() for a,b in zip(frames,frames[1:]))
assert entries[-1]['offsetY']==entries[0]['offsetY']==0
seam_delta=max(abs(a[c]-b[c]) for a,b in zip(frames[-1].get_flattened_data(),frames[0].get_flattened_data()) if a[3] or b[3] for c in range(4))
assert seam_delta<=4
webp=OUT/'ignis-idle-36f-pixelshift.webp'
print('Encoding full-keyframe lossless WebP...',flush=True)
frames[0].save(webp,'WEBP',save_all=True,append_images=frames[1:],duration=durations,loop=0,
               lossless=True,quality=100,method=4,minimize_size=False,kmin=1,kmax=1,
               background=(0,0,0,0),exact=True)
# libwebp may trim transparent margins from the initial keyframe even with
# kmin=kmax=1. Replace that first ANMF with a full-canvas static VP8L encoding
# of exactly the same pixels, so all 36 records independently replace 440x420.
def riff_chunks(blob):
    pos=12
    while pos+8<=len(blob):
        tag=blob[pos:pos+4]; length=struct.unpack_from('<I',blob,pos+4)[0]
        yield tag,blob[pos+8:pos+8+length]
        pos+=8+length+(length&1)

def riff_chunk(tag,payload):
    return tag+struct.pack('<I',len(payload))+payload+(b'\0' if len(payload)&1 else b'')

first_bytes=BytesIO()
frames[0].save(first_bytes,'WEBP',lossless=True,quality=100,method=4,exact=True)
first_image=b''.join(riff_chunk(tag,payload) for tag,payload in riff_chunks(first_bytes.getvalue()) if tag in (b'VP8L',b'ALPH',b'VP8 '))
assert first_image[:4]==b'VP8L'
first_header=b'\0'*6+(W-1).to_bytes(3,'little')+(H-1).to_bytes(3,'little')+durations[0].to_bytes(3,'little')+b'\2'
replaced=False;chunks=[]
for tag,payload in riff_chunks(webp.read_bytes()):
    if tag==b'ANMF' and not replaced:
        payload=first_header+first_image;replaced=True
    chunks.append(riff_chunk(tag,payload))
payload=b'WEBP'+b''.join(chunks)
webp.write_bytes(b'RIFF'+struct.pack('<I',len(payload))+payload)
records=[]
for tag,payload in riff_chunks(webp.read_bytes()):
    if tag==b'ANMF':
        record={'x':int.from_bytes(payload[0:3],'little')*2,'y':int.from_bytes(payload[3:6],'little')*2,
                'width':int.from_bytes(payload[6:9],'little')+1,'height':int.from_bytes(payload[9:12],'little')+1,
                'duration':int.from_bytes(payload[12:15],'little'),'flags':payload[15]}
        assert (record['x'],record['y'],record['width'],record['height'],record['flags'])==(0,0,W,H,2)
        records.append(record)
assert len(records)==36 and sum(r['duration'] for r in records)==3000
(OUT/'inspection'/'encoding-keyframes.json').write_text(json.dumps(records,indent=2),encoding='utf-8')
decoded=Image.open(webp)
assert decoded.n_frames==36 and decoded.info.get('loop')==0
for i,expected in enumerate(frames):
    decoded.seek(i);actual=decoded.convert('RGBA')
    assert decoded.info['duration']==durations[i]
    assert actual.getchannel('A').tobytes()==expected.getchannel('A').tobytes()
    assert all(a==b for a,b in zip(actual.get_flattened_data(),expected.get_flattened_data()) if a[3] or b[3]),f'WebP roundtrip {i+1}'
assert hashlib.sha256(SOURCE.read_bytes()).hexdigest()==source_hash
sheet=Image.new('RGBA',(W*6,H*6),(0,0,0,0))
for i,frame in enumerate(frames):sheet.paste(frame,((i%6)*W,(i//6)*H))
sheet.save(OUT/'ignis-idle-36f-pixelshift-sheet.png',optimize=True)
for title,bg in [('dark','#101c2b'),('light','#f1f2f4')]:
    contact=Image.new('RGB',(W*6,(H+30)*6),bg);draw=ImageDraw.Draw(contact)
    for i,frame in enumerate(frames):
        x=(i%6)*W;y=(i//6)*(H+30)
        contact.paste(frame,(x,y),frame)
        draw.text((x+10,y+H+6),f'Frame {i+1:02d} | dy {entries[i]["offsetY"]}',fill='#91a6be' if title=='dark' else '#263749')
    contact.save(OUT/'inspection'/f'allframes-{title}.png')
    key=Image.new('RGB',(W*4,H+30),bg);draw=ImageDraw.Draw(key)
    for j,i in enumerate([0,9,18,27]):
        key.paste(frames[i],(j*W,0),frames[i]);draw.text((j*W+10,H+6),f'Frame {i+1}',fill='white' if title=='dark' else 'black')
    key.save(OUT/'inspection'/f'keyframes-{title}.png')
metadata={'name':'Ignis idle 36 — exact pixel translation candidate','source':'assets/ignis.png',
          'sourceSha256':source_hash,'size':[W,H],'frameCount':36,'durationMs':sum(durations),'loop':True,
          'maxHoverPixels':10,'maxPartTranslationPixels':2,'guardRadiusPixels':3,'maxGlowRadiusPixels':3,
          'method':'Whole original pixel cutouts translated only by integer coordinates; immutable source joint guards; no resampling, rotation, warp, scaling, smoothing or alpha blending',
          'encoding':{'lossless':True,'minimize_size':False,'kmin':1,'kmax':1,'method':4,
                      'fullCanvasNoBlendFrames':36,'initialFrameRepackedWithoutTransparentMarginCrop':True},
          'files':{'animated':webp.name,'sheet':'ignis-idle-36f-pixelshift-sheet.png'},
          'grid':{'columns':6,'rows':6,'frameWidth':W,'frameHeight':H},'anchor':{'x':220,'y':408},
          'frames':entries,'verification':{'decodedFrames':36,'durationMs':3000,'fixedBodyPixelDifferences':0,
          'fixedOpaquePixels':len(fixed_coords),'guardPixels':len(guard_coords),'jointInteriorPixels':len(joint_coords),
          'jointInteriorHoles':0,'unownedOpaquePixels':0,'copiedPixelDifferences':0,
          'webpRoundtripVisibleDifferences':0,'webpRoundtripAlphaDifferences':0,'firstFrameEqualsSource':True,
          'loopSeamMaxChannelDifference':seam_delta,'loopSeamVerticalDifference':0,'canvasEdgesTransparent':True},
          'bytes':webp.stat().st_size,'sha256':hashlib.sha256(webp.read_bytes()).hexdigest()}
(OUT/'ignis-idle-36f-pixelshift.json').write_text(json.dumps(metadata,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({'out':str(OUT),'bytes':metadata['bytes'],'verification':metadata['verification']},indent=2),flush=True)
