"""기체 그림을 게임 규격으로 옮긴다 — 배경 제거 · 크기 맞춤 · 발끝 정렬. (2026-09-21)

    python tools/robot_art.py <원화 폴더> <목록.json> [--dry] [--sheet 미리보기.png]

목록.json = { "원화 파일 이름": ["기체 id", "등급"], ... }

규격(js/sprites.js 머리말) — 440x420 투명 캔버스 · 바닥 그림자 없음 · 발끝 y=408 · 가로 가운데.
키는 **등급마다 기존 기체의 평균**에 맞춘다(C 290 · UC 302 · R 320 · UQ 338 · EP 382). 넓으면 가로 430 에서 멈춘다.

배경은 세 가지로 온다.
  ① 투명(RGBA)          — 알파를 그대로 쓴다. 8 미만 0 · 240 이상 255 로 턴다(제거 도구의 옅은 막)
  ② 완전한 검정          — 테두리에서 검정(각 채널 ≤ 10)만 따라 번진다
  ③ 어두운 회색 그라데이션 — 테두리에서 '배경색에 가깝고(±T) · 이웃과 매끄러운(기울기 < G)' 칸만 따라 번진다.
     외곽선은 배경보다 확 어두워서 번짐이 거기서 멈춘다. 발밑 그림자는 매끄러운 어둠이라 같이 걷힌다.
numpy 와 PIL 만 쓴다(rembg · opencv 가 이 PC 에 없다).
"""
import json, os, sys
import numpy as np
from PIL import Image

H_BY_RAR = {'C': 290, 'UC': 302, 'R': 320, 'UQ': 338, 'EP': 382}
CANVAS = (440, 420)
FOOT_Y = 408
MAX_W = 430


def grow(seed, ok):
    """seed 에서 ok 안으로만 4방향으로 번진다(반복 팽창 · 수렴할 때까지)."""
    m = seed & ok
    while True:
        n = m.copy()
        n[1:] |= m[:-1]; n[:-1] |= m[1:]; n[:, 1:] |= m[:, :-1]; n[:, :-1] |= m[:, 1:]
        n &= ok
        if (n == m).all():
            return m
        m = n


def border(shape):
    b = np.zeros(shape, bool)
    b[0] = b[-1] = True; b[:, 0] = b[:, -1] = True
    return b


def dilate(m, k=1):
    for _ in range(k):
        n = m.copy()
        n[1:] |= m[:-1]; n[:-1] |= m[1:]; n[:, 1:] |= m[:, :-1]; n[:, :-1] |= m[:, 1:]
        m = n
    return m


def components(m):
    """4방향 연결 조각에 번호를 붙인다. (라벨 배열, {번호: 크기})"""
    lab = np.zeros(m.shape, np.int32)
    cur, sizes = 0, {}
    ys, xs = np.nonzero(m)
    for y0, x0 in zip(ys, xs):
        if lab[y0, x0]:
            continue
        cur += 1
        st = [(y0, x0)]; lab[y0, x0] = cur; n = 0
        while st:
            y, x = st.pop(); n += 1
            for yy, xx in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)):
                if 0 <= yy < m.shape[0] and 0 <= xx < m.shape[1] and m[yy, xx] and not lab[yy, xx]:
                    lab[yy, xx] = cur; st.append((yy, xx))
        sizes[cur] = n
    return lab, sizes


def keep_biggest(fg):
    """떨어져 있는 작은 조각(티끌 · 남은 그림자 점)을 버린다. 본체와 크게 떨어진 부품이
    있을 수 있어 **본체의 2% 넘는 조각은 남긴다.**"""
    lab = np.zeros(fg.shape, np.int32)
    cur = 0
    ys, xs = np.nonzero(fg)
    sizes = {}
    # 스캔라인 채우기 — 조각 수가 적어서 충분히 빠르다
    for y0, x0 in zip(ys, xs):
        if lab[y0, x0]:
            continue
        cur += 1
        st = [(y0, x0)]; lab[y0, x0] = cur; n = 0
        while st:
            y, x = st.pop(); n += 1
            for yy, xx in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)):
                if 0 <= yy < fg.shape[0] and 0 <= xx < fg.shape[1] and fg[yy, xx] and not lab[yy, xx]:
                    lab[yy, xx] = cur; st.append((yy, xx))
        sizes[cur] = n
    if not sizes:
        return fg
    big = max(sizes.values())
    keep = [k for k, v in sizes.items() if v >= big * 0.02]
    return np.isin(lab, keep)


def alpha_of(path):
    im = Image.open(path)
    a = np.asarray(im.convert('RGBA')).astype(np.int16)
    rgb, al = a[..., :3], a[..., 3]
    if im.mode == 'RGBA' and (al == 0).mean() > 0.2:                 # ① 투명
        al = np.where(al < 8, 0, np.where(al >= 240, 255, al))
        return rgb.astype(np.uint8), al.astype(np.uint8), 'alpha'
    mx = rgb.max(2)
    edge = np.concatenate([rgb[0], rgb[-1], rgb[:, 0], rgb[:, -1]])
    if edge.max() <= 4:                                                # ② 검정
        bg = grow(border(mx.shape), mx <= 10)
        kind = 'black'
    else:                                                              # ③ 회색 그라데이션
        ref = np.median(edge, 0)
        d = np.abs(rgb - ref).max(2)
        g = np.zeros(mx.shape, np.int16)
        f = rgb.astype(np.int16)
        for dy, dx in ((1, 0), (0, 1)):
            diff = np.abs(f[dy:, dx:] - f[:f.shape[0] - dy, :f.shape[1] - dx]).max(2)
            g[dy:, dx:] = np.maximum(g[dy:, dx:], diff)
            g[:g.shape[0] - dy, :g.shape[1] - dx] = np.maximum(g[:g.shape[0] - dy, :g.shape[1] - dx], diff)
        lum = rgb.mean(2)
        sat = rgb.max(2) - rgb.min(2)
        # 배경 · 발밑 그림자: 배경색 근처이거나(±16), 배경보다 어둡고 무채색인 매끄러운 칸
        bgish = ((d <= 16) | ((lum < ref.mean()) & (lum > 6) & (sat <= 12))) & (g <= 5)
        bg = grow(border(mx.shape), bgish)
        # 갇힌 배경 — 다리 사이 · 후광 아래처럼 몸에 둘러싸여 테두리에서 닿지 않는 빈틈.
        # 배경색이고 매끄러운 덩어리가 **원화 기준 300칸 이상**이면 배경으로 본다(작은 것은 도색일 수 있다)
        lab, sizes = components(bgish & ~bg)
        # 크기만 보면 몸의 어두운 금속판까지 뚫린다 — **평균 색이 배경과 ±8 안**인 덩어리만
        holes = [k for k, v in sizes.items() if v >= 300]
        if holes:
            md = np.bincount(lab.ravel(), weights=d.ravel(), minlength=lab.max() + 1)
            holes = [k for k in holes if md[k] / sizes[k] <= 8]
        if holes:
            bg |= np.isin(lab, holes)
        # 가장자리 한 겹 — 기울기 때문에 남은 배경색 테두리를 한 번 더 걷는다
        rim = dilate(bg, 2) & ~bg & (d <= 12)
        bg |= rim
        kind = 'gray'
    fg = keep_biggest(~bg)
    return rgb.astype(np.uint8), (fg * 255).astype(np.uint8), kind


def fit(rgb, al, rar):
    ys, xs = np.nonzero(al > 0)
    y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    crop = np.dstack([rgb[y0:y1, x0:x1], al[y0:y1, x0:x1]])
    h, w = crop.shape[:2]
    s = H_BY_RAR[rar] / h
    if w * s > MAX_W:
        s = MAX_W / w
    nw, nh = max(1, round(w * s)), max(1, round(h * s))
    # 프리멀티플라이 LANCZOS — 투명한 칸의 색이 가장자리로 번져 나오지 않게
    a = crop[..., 3:4].astype(np.float32) / 255
    pm = np.dstack([crop[..., :3].astype(np.float32) * a, a[..., 0] * 255])
    chans = [Image.fromarray(np.clip(pm[..., i], 0, 255).astype(np.uint8)).resize((nw, nh), Image.LANCZOS) for i in range(4)]
    arr = np.dstack([np.asarray(c).astype(np.float32) for c in chans])
    al2 = arr[..., 3]
    rgb2 = np.where(al2[..., None] > 0, arr[..., :3] * 255 / np.maximum(al2[..., None], 1), 0)
    al2 = np.where(al2 < 8, 0, np.where(al2 >= 240, 255, al2))
    out = np.zeros((CANVAS[1], CANVAS[0], 4), np.uint8)
    ox = (CANVAS[0] - nw) // 2
    oy = FOOT_Y - nh
    out[oy:oy + nh, ox:ox + nw, :3] = np.clip(rgb2, 0, 255).astype(np.uint8)
    out[oy:oy + nh, ox:ox + nw, 3] = al2.astype(np.uint8)
    return Image.fromarray(out, 'RGBA'), s, (nw, nh)


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    dry = '--dry' in sys.argv
    sheet_path = sys.argv[sys.argv.index('--sheet') + 1] if '--sheet' in sys.argv else None
    if sheet_path in args:
        args.remove(sheet_path)
    src, listing = args[0], json.load(open(args[1], encoding='utf-8'))
    here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    outs = []
    for fn, (rid, rar) in listing.items():
        rgb, al, kind = alpha_of(os.path.join(src, fn))
        img, s, size = fit(rgb, al, rar)
        outs.append((rid, img))
        dst = os.path.join(here, 'assets', rid + '.png')
        print(f'{fn:24s} → assets/{rid}.png  {rar:2s} · 배경 {kind:5s} · 배율 {s:.4f} · {size[0]}x{size[1]}')
        if not dry:
            img.save(dst, optimize=True)
    if sheet_path:
        cell = 220
        sh = Image.new('RGBA', (cell * 6 * 2, ((len(outs) + 5) // 6) * cell), (0, 0, 0, 255))
        for i, (rid, img) in enumerate(outs):
            t = img.copy(); t.thumbnail((cell, cell))
            x, y = (i % 6) * cell * 2, (i // 6) * cell
            for j, bgc in enumerate(((236, 236, 236, 255), (40, 60, 110, 255))):
                bgi = Image.new('RGBA', (cell, cell), bgc); bgi.alpha_composite(t)
                sh.paste(bgi, (x + j * cell, y))
        sh.convert('RGB').save(sheet_path)


if __name__ == '__main__':
    main()
