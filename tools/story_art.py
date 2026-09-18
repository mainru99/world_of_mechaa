"""대사 삽화를 규격으로 옮긴다 — 원화 PNG 폴더 → assets/story/<키>.webp

    python tools/story_art.py <원화 폴더>            # assets/story 로
    python tools/story_art.py <원화 폴더> --dry      # 쓰지 않고 결과만 본다

규격은 assets/story/README.md 와 같다.
  - 1600×900 (LANCZOS). 원화는 지금까지 전부 1672×941 이었다 — 비율 차이 0.06% 라 자르지 않고 줄인다
  - webp · 250KB 이하. 품질 86 에서 2씩 내려가며 처음 들어가는 값을 쓴다(1장은 78~86 에 들었다)
  - 파일 이름이 곧 삽화 키다. `ch2-hive.png` → `ch2-hive.webp`

1장 16장 · 4장, 2장 24장을 이 규칙으로 옮겼다. 세 번째라 도구로 남긴다.
옮긴 뒤 data/story.js 가 부르는 키가 전부 있는지는 README 의 '넣은 뒤 확인하는 법' 으로 본다.
"""
import io
import os
import sys

from PIL import Image

W, H = 1600, 900
LIMIT = 250 * 1024
Q_TOP, Q_FLOOR = 86, 70

def encode(im, q):
    buf = io.BytesIO()
    im.save(buf, 'WEBP', quality=q, method=6)
    return buf.getvalue()

def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    if not args:
        print(__doc__)
        sys.exit(2)
    src = args[0]
    here = os.path.dirname(os.path.abspath(__file__))
    out = os.path.join(here, '..', 'assets', 'story')
    dry = '--dry' in sys.argv

    names = sorted(f for f in os.listdir(src) if f.lower().endswith('.png'))
    if not names:
        print('PNG 가 없다:', src)
        sys.exit(1)

    total, worst = 0, None
    for f in names:
        key = f[:-4]
        im = Image.open(os.path.join(src, f)).convert('RGB')
        ratio = abs((im.width / im.height) / (W / H) - 1)
        if ratio > 0.02:
            # 비율이 크게 다르면 줄이기만 해서는 찌그러진다. 사람이 보고 정할 일이다
            print(f'  ✗ {key}: {im.width}×{im.height} 는 16:9 에서 {ratio*100:.1f}% 벗어난다 — 건너뜀')
            continue
        im = im.resize((W, H), Image.LANCZOS)
        q = Q_TOP
        data = encode(im, q)
        while len(data) > LIMIT and q > Q_FLOOR:
            q -= 2
            data = encode(im, q)
        flag = '' if len(data) <= LIMIT else '  ← 상한 초과'
        print(f'  {key:<16} q{q}  {len(data)//1024:>4}KB{flag}')
        total += len(data)
        if worst is None or q < worst[1]:
            worst = (key, q)
        if not dry:
            with open(os.path.join(out, key + '.webp'), 'wb') as fp:
                fp.write(data)

    n = len(names)
    print(f'\n  {n}장 · 합계 {total/1024/1024:.2f}MB · 평균 {total/n/1024:.0f}KB'
          + (f' · 가장 낮은 품질 {worst[0]} q{worst[1]}' if worst else '')
          + (' · (--dry: 쓰지 않았다)' if dry else ''))

if __name__ == '__main__':
    main()
