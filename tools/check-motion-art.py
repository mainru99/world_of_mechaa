"""Additional export checks; never changes artwork or Claude's checker."""
import hashlib,json,sys
from pathlib import Path
from PIL import Image
from spritecheck import ROOT,check_fx,check_pose
def sha(path): return hashlib.sha256(path.read_bytes()).hexdigest()
result=[]
for kind in ['slash','cannon','status-a']:
    path=ROOT/'assets'/'effects'/f'motion-{kind}.png'
    im=Image.open(path); check=check_fx(path)
    assert check['ok'] and im.size==(1024,1024)
    assert set(im.getchannel('A').getdata())=={0,255}
    assert len({(r,g,b) for r,g,b,a in im.getdata() if a})<=8
    logical=im.resize((128,128),Image.Resampling.NEAREST)
    assert logical.resize(im.size,Image.Resampling.NEAREST).tobytes()==im.tobytes(), 'Nonuniform pixel grid'
    counts=[]
    for i in range(4):
        tile=logical.crop(((i%2)*64,(i//2)*64,(i%2+1)*64,(i//2+1)*64))
        colors={(r,g,b) for r,g,b,a in tile.getdata() if a}
        assert 0<len(colors)<=8
        counts.append(len(colors))
    source=ROOT/'docs'/'art'/'attack-motion-sources'/f'{kind}.png'
    result.append({'id':kind,'sha256':sha(path),'sourceSha256':sha(source),'check':check,'colorsPerCell':counts})
for rid in ['azure','kestrel']:
    path=ROOT/'assets'/'motions'/'attack'/f'{rid}.png'
    check=check_pose(rid); assert check['ok']
    source=ROOT/'docs'/'art'/'attack-motion-sources'/f'{rid}.png'
    result.append({'id':rid,'sha256':sha(path),'sourceSha256':sha(source),'originalSha256':sha(ROOT/'assets'/f'{rid}.png'),'check':check})
print(json.dumps(result,ensure_ascii=False,indent=2))
