# -*- coding: utf-8 -*-
"""대기모션 시트에서 배경을 지운다 — python tools/cut_motion.py <시트.png> <가로칸> <세로칸> [출력폴더]

  예) python tools/cut_motion.py "...\\sheet.png" 6 6 .look/frames

이 시트는 **프레임마다 배경색이 다르다**(첫 장은 흰색, 나머지는 검정). 그래서 한 가지
색으로 지울 수 없다. 칸마다 테두리를 보고 그 칸의 배경색을 정한 뒤, 거기서 흘려보낸다.

**밝기로 자르지 않고 테두리에서 흘려보내는(flood fill) 이유**
  이 기체는 흰색 장갑과 검은 외곽선을 둘 다 가지고 있다. '흰색이면 지운다'로 하면
  장갑에 구멍이 뚫리고, '검은색이면 지운다'로 하면 외곽선이 사라진다.
  실제로 예전 검은 배경 시트에서 기체의 검은 부분이 같이 지워졌다.
  테두리와 이어진 것만 지우면 기체 안쪽은 무슨 색이든 살아남는다.

경계에 안티에일리어싱이 없는 그림이라(실측: 흰색에서 곧바로 색으로 점프) 가장자리를
부드럽게 다듬을 필요가 없다. 그래서 알파는 0 아니면 255 다.
"""
import os
import sys
from collections import deque
from PIL import Image

TOL = 26        # 배경색에서 이만큼 안쪽이면 배경으로 본다 (검은 배경에 잡티가 있다)


def bg_color(px, w, h):
    """테두리 픽셀의 최빈값 = 그 칸의 배경색."""
    from collections import Counter
    c = Counter()
    for x in range(w):
        c[px[x, 0]] += 1; c[px[x, h - 1]] += 1
    for y in range(h):
        c[px[0, y]] += 1; c[px[w - 1, y]] += 1
    return c.most_common(1)[0][0]


def key(cell):
    """테두리에서 배경색을 흘려보내 지운다. 안쪽은 건드리지 않는다."""
    w, h = cell.size
    px = cell.load()
    bg = bg_color(px, w, h)
    near = lambda p: abs(p[0] - bg[0]) + abs(p[1] - bg[1]) + abs(p[2] - bg[2]) <= TOL * 3

    seen = bytearray(w * h)
    q = deque()

    def seed(x, y):
        if not seen[y * w + x] and near(px[x, y]):
            seen[y * w + x] = 1; q.append((x, y))
    for x in range(w): seed(x, 0); seed(x, h - 1)
    for y in range(h): seed(0, y); seed(w - 1, y)
    while q:
        x, y = q.popleft()
        for nx, ny in ((x+1, y), (x-1, y), (x, y+1), (x, y-1)):
            if 0 <= nx < w and 0 <= ny < h: seed(nx, ny)

    out = Image.new('RGBA', (w, h)); op = out.load()
    for y in range(h):
        row = y * w
        for x in range(w):
            r, g, b = px[x, y]
            op[x, y] = (r, g, b, 0 if seen[row + x] else 255)
    return out, bg


def main():
    if len(sys.argv) < 4:
        raise SystemExit(__doc__)
    src, ncol, nrow = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
    outdir = sys.argv[4] if len(sys.argv) > 4 else '.look/frames'
    os.makedirs(outdir, exist_ok=True)

    im = Image.open(src).convert('RGB')
    W, H = im.size
    cw, ch = W // ncol, H // nrow
    print('시트 %dx%d · 칸 %dx%d · 프레임 %d장' % (W, H, cw, ch, ncol * nrow))

    for i in range(ncol * nrow):
        c, r = i % ncol, i // ncol
        cell, bg = key(im.crop((c * cw, r * ch, (c + 1) * cw, (r + 1) * ch)))
        bb = cell.getbbox()
        cell.save(os.path.join(outdir, 'f%02d.png' % i))
        print('  %2d 배경 %-16s 남은 그림 %s' % (i, str(bg), bb))


if __name__ == '__main__':
    main()
