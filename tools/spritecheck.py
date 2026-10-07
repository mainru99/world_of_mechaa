"""공격 모션 그림 검사 · 정렬 · 목록 만들기 (2026-10-07 · docs/art/attack-motion-spec-2026-10-07.md)

  python tools/spritecheck.py fx   assets/effects/motion-slash.png     이펙트 아틀라스 하나
  python tools/spritecheck.py pose azure                               공격 자세 하나(assets/motions/attack/azure.png 를 원본과 비교)
  python tools/spritecheck.py all  [--write]                           전부 · --write 면 통과한 것만 js/motion-assets.js 에 적는다

판정은 '쓸 수 있나' 까지다(크기 · 진짜 투명 · 가짜 체크무늬 · 칸 여백 · 발끝 · 방향 · 원본과 겹침).
**보기 좋은가는 사람이 본다** — 통과가 곧 승인이 아니다. 자세 그림은 기체마다 사용자 승인을 받는다(원본 재해석 금지 규칙의 예외라서).
"""
import json, sys, re
from pathlib import Path
from PIL import Image

try: sys.stdout.reconfigure(encoding='utf-8')     # 윈도 콘솔(cp949)에서도 ✓ · 한글이 찍히게
except Exception: pass

ROOT = Path(__file__).resolve().parents[1]
FX_DIR = ROOT / 'assets' / 'effects'
POSE_DIR = ROOT / 'assets' / 'motions' / 'attack'
OUT = ROOT / 'js' / 'motion-assets.js'
KINDS = ['shot', 'cannon', 'missile', 'beam', 'slash', 'smash', 'thrust', 'status-a', 'status-b']
W, H, FOOT = 440, 420, 408          # 원본 캔버스 · 발끝(js/sprites.js)
A_ON = 32                           # 이 알파 넘으면 '그려진 픽셀'


def rel(p):
    p = Path(p)
    try: return p.resolve().relative_to(ROOT).as_posix()
    except ValueError: return p.as_posix()


def opaque_bbox(img, thr=A_ON):
    a = img.getchannel('A').point(lambda v: 255 if v > thr else 0)
    return a.getbbox(), a


def checker_ratio(img):
    """가짜 체크무늬 — 불투명한데 채도가 거의 없는 밝은 회색 · 흰색이 두 무리로 많이 깔려 있으면 의심"""
    px = img.convert('RGBA').resize((min(256, img.width), min(256, img.height)), Image.NEAREST).getdata()
    grey = [r for r, g, b, a in px if a > 200 and max(r, g, b) - min(r, g, b) < 10 and r > 150]
    if not px: return 0.0
    if not grey: return 0.0
    hi = sum(1 for v in grey if v > 235); lo = len(grey) - hi
    two = min(hi, lo) / max(1, len(grey))          # 두 톤이 고루 섞였나
    return (len(grey) / len(px)) * (1 if two > 0.25 else 0.3)


def check_fx(path):
    p = Path(path); out = {'file': rel(p), 'ok': True, 'errors': [], 'warn': [], 'info': {}}
    def bad(m): out['ok'] = False; out['errors'].append(m)
    if not p.exists(): bad('파일 없음'); return out
    img = Image.open(p)
    out['info']['size'] = img.size; out['info']['mode'] = img.mode
    if img.mode != 'RGBA': bad(f'RGBA 가 아니다({img.mode}) — 진짜 투명이 필요하다'); img = img.convert('RGBA')
    if img.width != img.height: bad(f'정사각이 아니다 {img.size}')
    if img.width < 512: bad(f'너무 작다 {img.width}px (512 이상)')
    if img.width % 2: bad('가로가 홀수 — 2 × 2 칸이 고르게 안 나뉜다')
    a = img.getchannel('A')
    corners = [a.getpixel((x, y)) for x in (0, img.width - 1) for y in (0, img.height - 1)]
    if max(corners) > 8: bad(f'네 귀퉁이가 투명하지 않다 {corners}')
    hist = a.histogram(); clear = hist[0] / (img.width * img.height)
    out['info']['transparent'] = round(clear, 3)
    if clear < 0.4: bad(f'투명한 곳이 {clear:.0%} — 배경이 칠해진 것 같다(40% 이상)')
    cr = checker_ratio(img); out['info']['checker'] = round(cr, 3)
    if cr > 0.08: bad(f'가짜 체크무늬 의심 {cr:.0%} — 회색 · 흰색 바둑판이 그려져 있다')
    semi = sum(hist[A_ON:224]) / max(1, sum(hist[A_ON:]))
    out['info']['semi'] = round(semi, 3)
    if semi > 0.35: out['warn'].append(f'반투명 픽셀이 많다 {semi:.0%} — 어두운 배경에서 뿌옇게 보일 수 있다')
    cw = img.width // 2; margin = int(cw * 0.04)
    for k in range(4):
        cx, cy = (k % 2) * cw, (k // 2) * cw
        cell = img.crop((cx, cy, cx + cw, cy + cw))
        bb, _ = opaque_bbox(cell)
        if not bb: bad(f'칸 {k} 이 비었다'); continue
        l, t, r, b = bb
        if l < margin or t < margin or r > cw - margin or b > cw - margin:
            bad(f'칸 {k} 이 가장자리에 닿는다 {bb} (여백 {margin}px 이상)')
        out['info'][f'cell{k}'] = bb
    return out


def feet_x(alpha, bb):
    """발 — 아래 15% 줄의 그려진 픽셀 가로 중심"""
    l, t, r, b = bb; top = b - max(4, int((b - t) * 0.15))
    xs = []
    for y in range(top, b):
        for x in range(l, r):
            if alpha.getpixel((x, y)): xs.append(x)
    return sum(xs) / len(xs) if xs else (l + r) / 2


def iou(a, b):
    from PIL import ImageChops
    inter = ImageChops.multiply(a, b).histogram()[255]
    uni = ImageChops.lighter(a, b).histogram()[255]
    return inter / max(1, uni)


def check_pose(rid):
    p = POSE_DIR / f'{rid}.png'; base = ROOT / 'assets' / f'{rid}.png'
    out = {'file': rel(p), 'id': rid, 'ok': True, 'errors': [], 'warn': [], 'info': {}}
    def bad(m): out['ok'] = False; out['errors'].append(m)
    if not p.exists(): bad('파일 없음'); return out
    if not base.exists(): bad(f'원본 없음 assets/{rid}.png'); return out
    img = Image.open(p); org = Image.open(base).convert('RGBA')
    out['info']['size'] = img.size
    if img.mode != 'RGBA': bad(f'RGBA 가 아니다({img.mode})'); img = img.convert('RGBA')
    if img.size != (W, H): bad(f'캔버스가 {img.size} — 원본과 같은 {W}×{H} 이어야 한다'); img = img.resize((W, H))
    a = img.getchannel('A')
    corners = [a.getpixel((x, y)) for x in (0, W - 1) for y in (0, H - 1)]
    if max(corners) > 8: bad(f'네 귀퉁이가 투명하지 않다 {corners}')
    cr = checker_ratio(img); out['info']['checker'] = round(cr, 3)
    if cr > 0.08: bad(f'가짜 체크무늬 의심 {cr:.0%}')
    bb, am = opaque_bbox(img); obb, om = opaque_bbox(org)
    if not bb: bad('비어 있다'); return out
    out['info']['bbox'] = bb; out['info']['orig_bbox'] = obb
    foot = bb[3] - 1; out['info']['foot_y'] = foot
    if abs(foot - FOOT) > 6: out['warn'].append(f'발끝 y={foot} (원본 기준 {FOOT}) — dy 로 맞춘다')
    hr = (bb[3] - bb[1]) / max(1, obb[3] - obb[1]); out['info']['height_ratio'] = round(hr, 3)
    if not 0.85 <= hr <= 1.2: bad(f'키가 원본의 {hr:.0%} — 85 ~ 120% 여야 같은 기체로 보인다')
    fx, ofx = feet_x(am, bb), feet_x(om, obb)
    dx, dy = round(ofx - fx), (obb[3] - 1) - foot
    out['info']['dx'], out['info']['dy'] = dx, dy
    if abs(dx) > 40: out['warn'].append(f'발 위치가 원본과 {dx}px 어긋난다 — dx 로 맞추지만 그림을 다시 보는 게 좋다')
    shifted = Image.new('L', (W, H)); shifted.paste(am, (dx, dy))
    same, mirror = iou(shifted, om), iou(shifted, om.transpose(Image.FLIP_LEFT_RIGHT))
    out['info']['iou'] = round(same, 3); out['info']['iou_mirror'] = round(mirror, 3)
    if mirror > same + 0.08: bad(f'방향이 반대인 것 같다(겹침 {same:.2f} · 뒤집으면 {mirror:.2f}) — 원본처럼 왼쪽을 봐야 한다')
    if same < 0.35: out['warn'].append(f'원본과 겹침 {same:.2f} — 자세가 크게 달라졌거나 다른 기체로 그렸을 수 있다. 사람이 볼 것')
    # 색 — 원본과 같은 칠인가(거칠게 4단계 양자화 · 히스토그램 교집합)
    def hist(im):
        c = {}
        for (r, g, b, al) in im.resize((110, 105)).getdata():
            if al > 128: k = (r >> 6, g >> 6, b >> 6); c[k] = c.get(k, 0) + 1
        n = sum(c.values()) or 1
        return {k: v / n for k, v in c.items()}
    h1, h2 = hist(img), hist(org)
    col = sum(min(h1.get(k, 0), h2.get(k, 0)) for k in set(h1) | set(h2)); out['info']['color'] = round(col, 3)
    if col < 0.5: out['warn'].append(f'색이 원본과 {col:.0%} 만 겹친다 — 도장이 바뀌었을 수 있다')
    return out


def show(r):
    mark = '✓' if r['ok'] else '✗'
    print(f"  {mark} {r['file']}  {json.dumps(r['info'], ensure_ascii=False)}")
    for m in r['errors']: print(f'      ✗ {m}')
    for m in r['warn']: print(f'      △ {m}')


def write_manifest(atlas, pose):
    body = ['/* 공격 모션 그림 목록 — **tools/spritecheck.py all --write 가 만든다. 손으로 고치지 않는다.**',
            ' * 검사를 통과한 그림만 오른다. 없는 종류 · 기체는 js/motion.js 가 코드로 그린 대체 연출을 쓴다.',
            ' *   atlas  { 종류 | \'status-a\' | \'status-b\': 경로 }      assets/effects/motion-<이름>.png',
            ' *   pose   { 기체 id: { src, dx, dy } }                  assets/motions/attack/<id>.png · dx · dy = 원본(440×420)에 맞추는 이동(px)',
            ' */',
            'export const MOTION_ASSETS = {',
            '  atlas: ' + json.dumps(atlas, ensure_ascii=False) + ',',
            '  pose: ' + json.dumps(pose, ensure_ascii=False) + ',',
            '};', '']
    OUT.write_text('\n'.join(body), encoding='utf-8')


def main(argv):
    if len(argv) < 2: print(__doc__); return 2
    cmd = argv[1]
    if cmd == 'fx':
        r = check_fx(ROOT / argv[2] if not Path(argv[2]).is_absolute() else argv[2]); show(r); return 0 if r['ok'] else 1
    if cmd == 'pose':
        r = check_pose(argv[2]); show(r); return 0 if r['ok'] else 1
    if cmd == 'all':
        atlas, pose, fails = {}, {}, 0
        print('== 이펙트 아틀라스 ==')
        for k in KINDS:
            f = FX_DIR / f'motion-{k}.png'
            if not f.exists(): print(f'  · motion-{k}.png 없음(대체 연출)'); continue
            r = check_fx(f); show(r)
            if r['ok']: atlas[k] = f'assets/effects/motion-{k}.png?v={int(f.stat().st_mtime)}'
            else: fails += 1
        print('== 공격 자세 ==')
        for f in sorted(POSE_DIR.glob('*.png')) if POSE_DIR.exists() else []:
            rid = f.stem
            if not re.fullmatch(r'[a-z0-9_]+', rid): continue
            r = check_pose(rid); show(r)
            if r['ok']: pose[rid] = {'src': f'assets/motions/attack/{rid}.png?v={int(f.stat().st_mtime)}', 'dx': r['info']['dx'], 'dy': r['info']['dy']}
            else: fails += 1
        if not pose: print('  · 아직 없음')
        if '--write' in argv:
            write_manifest(atlas, pose); print(f'\njs/motion-assets.js — 아틀라스 {len(atlas)} · 자세 {len(pose)}')
        print('\n전부 통과' if not fails else f'\n✗ {fails}개 불합격 — 목록에 넣지 않았다')
        return 0 if not fails else 1
    print(__doc__); return 2


if __name__ == '__main__':
    sys.exit(main(sys.argv))
