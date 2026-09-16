"""나르(NHAR) 몬스터 스프라이트를 만든다 — 전선 1장.

시나리오(docs/story/chapter1.txt)가 적어 둔 생김새를 그대로 따른다.

    키는 약 열두 미터.
    팔과 다리는 지나치게 길었고, 관절은 생물의 뼈처럼 안쪽으로 휘어 있었다.
    금속 표면은 장갑판으로 조립된 것이 아니라 검은 결정이 성장해 형체를 이룬 것처럼 보였다.
    머리라고 부를 만한 부분에는 얼굴이 없었다.
    대신 세 개의 붉은 점이 삼각형으로 빛나고 있었다.

그래서 넷을 지킨다.
  ① 각진 결정 면으로만 만든다 — 곡선을 쓰지 않는다. 장갑판 조립이 아니다
  ② 무릎이 **뒤로** 접힌다. 사람이 아니라 새·곤충의 다리다
  ③ 얼굴이 없다. 붉은 점 셋이 삼각형
  ④ 팔다리가 몸통보다 길다

── 어떻게 그리나 ──────────────────────────────────────
**실루엣을 먼저 하나의 덩어리로 만들고, 면은 그 안에서만 칠한다.**
처음에는 조각마다 색을 주며 그렸는데 팔다리가 몸통에서 떨어져 나가 흩어진 파편으로
보였다. 마스크를 먼저 만들면 연결이 보장되고, 면을 아무리 잘못 그려도 실루엣은 안 깨진다.

기존 몬스터 그림의 규격을 그대로 맞춘다(js/sprites.js).
  · 440x420 투명 캔버스 · 발끝 y=408 · 왼쪽을 본다 · 높이 296~310
  · **이진 알파**(0 아니면 255). 기존 13장이 전부 그렇고, 안티앨리어싱이 섞이면
    좌우 반전·확대 때 가장자리가 지저분해진다. 결정체라 각진 편이 오히려 맞다.

    python tools/build_nhar.py              assets/monsters/ 에 쓴다
    python tools/build_nhar.py --out DIR    다른 곳에 써서 먼저 본다

Pillow 만 있으면 된다. 난수를 쓰지 않으므로 몇 번 돌려도 같은 그림이 나온다.
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageChops
import argparse

W, H = 440, 420
GROUND = 408
CX = 220

# 결정 색. 검은 몸에 푸른 기가 도는 면을 얹는다 — 금속이 아니라 광물로 보이게.
# 어두운 UI 위에 놓이므로 바탕색을 너무 어둡게 잡으면 형체가 안 보인다(처음에 그랬다).
DARK  = (26, 30, 46, 255)
BODY  = (44, 52, 78, 255)
FACET = (72, 86, 124, 255)
LIT   = (108, 128, 176, 255)
EDGE  = (150, 172, 222, 255)
EYE   = (255, 58, 48, 255)
GLOW  = (120, 26, 24, 255)
BEAM  = (86, 180, 255, 255)
BEAMD = (30, 92, 164, 255)


def P(pts):
    return [(int(round(x)), int(round(y))) for x, y in pts]


def bar(pts, w):
    """중심선을 폭 w 의 각진 기둥으로 편다. 마디마다 사각형이고 관절에서 겹친다 —
    겹치게 두는 것이 관절을 따로 그리는 것보다 튼튼하다(틈이 안 생긴다)."""
    out = []
    for i in range(len(pts) - 1):
        (x1, y1), (x2, y2) = pts[i], pts[i + 1]
        dx, dy = x2 - x1, y2 - y1
        n = max(1e-6, (dx * dx + dy * dy) ** 0.5)
        px, py = -dy / n * w / 2, dx / n * w / 2
        out.append([(x1 + px, y1 + py), (x2 + px, y2 + py),
                    (x2 - px, y2 - py), (x1 - px, y1 - py)])
        # 관절을 결정 마름모로 메운다
        out.append([(x2, y2 - w * .62), (x2 + w * .62, y2),
                    (x2, y2 + w * .62), (x2 - w * .62, y2)])
    return out


def build(kind):
    """한 마리. kind 마다 비율과 앞팔이 다르다."""
    # 셋을 **한눈에 구별되게** 벌린다. 1장 내내 같은 적으로 보이면 다섯 칸이 한 칸이 된다.
    # 실루엣만으로 갈려야 한다 — 색은 셋 다 같은 결정이라 색으로는 못 가른다.
    if kind == 'scout':        # 척후체 — 거미처럼 가늘고 다리가 길다. 머리가 작다
        tw, lw, aw, hr = 30, 18, 15, 16
        hip, sh, hd = GROUND - 178, GROUND - 252, GROUND - 296
        spikes, backs, stoop = .7, ((20, -34, .8), (34, 12, .6)), 0
    elif kind == 'lance':      # 천공체 — 몸을 뒤로 젖히고 포신이 앞으로 길게 나온다
        tw, lw, aw, hr = 44, 26, 30, 21
        hip, sh, hd = GROUND - 150, GROUND - 240, GROUND - 296
        spikes, backs, stoop = 1.0, ((28, -52, 1.35), (48, 2, 1.0), (36, 50, .7)), -10
    else:                      # warden 파수체 — 두껍고 낮고 어깨가 넓다
        tw, lw, aw, hr = 74, 44, 36, 26
        hip, sh, hd = GROUND - 126, GROUND - 210, GROUND - 278
        spikes, backs, stoop = 1.7, ((30, -58, 1.7), (56, 4, 1.3), (40, 58, .9)), 6

    mass, lit, dim, hot, beam = [], [], [], [], []

    # ── 다리 둘. 무릎이 **뒤로**(오른쪽으로) 꺾인다 — 왼쪽을 보고 있으므로.
    for side, back in ((-1, 0), (1, 1)):
        hx = CX + side * tw * .52
        knee = (hx + 34 + back * 10, hip + 58)
        ankle = (hx - 6 - back * 8, GROUND - 46)
        toe = (hx - 34 - back * 12, GROUND - 4)
        seg = bar([(hx, hip - 6), knee, ankle, toe], lw - back * 4)
        mass += seg
        (dim if back else lit).append(seg[0])
        # 발 — 앞으로 뻗은 결정 발톱
        claw = [toe, (toe[0] + 40, GROUND - 2), (toe[0] + 30, GROUND - 16)]
        mass.append(claw)
        dim.append(claw)

    # ── 골반 → 가슴. 아래가 넓고 위가 좁은 결정 덩어리.
    pelvis = [(CX - tw, hip + 16), (CX + tw, hip + 16),
              (CX + tw * .8, hip - 34), (CX - tw * .8, hip - 34)]
    waist = [(CX - tw * .8, hip - 34), (CX + tw * .8, hip - 34),
             (CX + tw * .92, sh + 40), (CX - tw * .92, sh + 40)]
    chest = [(CX - tw * 1.18 + stoop, sh + 44), (CX + tw * .98 + stoop, sh + 40),
             (CX + tw * .72 + stoop * 2, sh - 12), (CX - tw * .96 + stoop * 2, sh - 6)]
    mass += [pelvis, waist, chest]
    dim.append(pelvis)
    lit.append(chest)
    # 가슴 앞면 — 빛을 받는 큰 면 하나. 이게 있어야 덩어리로 읽힌다
    lit.append([(CX - tw * 1.14, sh + 40), (CX - tw * .24, sh + 4),
                (CX - tw * .1, sh + 46), (CX - tw * .86, sh + 70)])

    # ── 어깨 결정 가시
    for side in (-1, 1):
        sx = CX + side * tw * .95
        spike = [(sx, sh + 6), (sx + side * 40 * spikes, sh - 42 * spikes), (sx + side * 16, sh + 30)]
        mass.append(spike)
        (lit if side < 0 else dim).append(spike)

    # ── 팔 둘. 몸통보다 길다. 앞(왼쪽) 팔이 주역이다.
    lsh = (CX - tw * .78, sh + 12)
    if kind == 'lance':
        elb = (lsh[0] - 56, lsh[1] + 62)
        muz = (elb[0] - 66, elb[1] - 16)
        seg = bar([lsh, elb, muz], aw + 6)
        mass += seg
        lit.append(seg[0])
        barrel = [(muz[0] - 26, muz[1] - 20), (muz[0] + 10, muz[1] - 26),
                  (muz[0] + 10, muz[1] + 26), (muz[0] - 26, muz[1] + 20)]
        mass.append(barrel)
        dim.append(barrel)
        beam.append([(muz[0] - 21, muz[1] - 11), (muz[0] + 2, muz[1] - 15),
                     (muz[0] + 2, muz[1] + 15), (muz[0] - 21, muz[1] + 11)])
    else:
        elb = (lsh[0] - 52, lsh[1] + 66)
        hand = (elb[0] - 24, elb[1] + 70)
        seg = bar([lsh, elb, hand], aw)
        mass += seg
        lit.append(seg[0])
        blade = [hand, (hand[0] - 30, hand[1] + 34), (hand[0] + 12, hand[1] + 22)]
        mass.append(blade)
        hot.append(blade)                      # 칼날만 밝게 — 무엇으로 때리는지 보이게
    # 뒷팔은 짧고 어둡게. 앞팔과 같은 밝기면 실루엣이 뭉갠다
    rsh = (CX + tw * .78, sh + 16)
    relb = (rsh[0] + 44, rsh[1] + 58)
    seg = bar([rsh, relb, (relb[0] + 12, relb[1] + 62)], aw - 6)
    mass += seg
    dim.append(seg[0])

    # ── 등에서 자란 결정. 뒤쪽이 비어 보이지 않게.
    for i, (ox, oy, s) in enumerate(backs):
        bx, by = CX + tw * .7 + ox, sh + oy
        sp = [(bx, by - 34 * s), (bx + 24 * s, by - 4 * s),
              (bx + 6 * s, by + 30 * s), (bx - 12 * s, by + 6 * s)]
        mass.append(sp)
        (lit if i == 1 else dim).append(sp)

    # ── 목과 머리. 얼굴이 없다.
    neck = [(CX - 15, sh - 2), (CX + 15, sh - 2), (CX + 11, hd + hr), (CX - 11, hd + hr)]
    mass.append(neck)
    dim.append(neck)
    head = [(CX, hd - hr), (CX + hr * 1.02, hd - hr * .06),
            (CX + hr * .66, hd + hr), (CX - hr * .66, hd + hr),
            (CX - hr * 1.02, hd - hr * .06)]
    mass.append(head)
    lit.append([(CX, hd - hr), (CX - hr * 1.02, hd - hr * .06), (CX - hr * .66, hd + hr)])
    return mass, lit, dim, hot, beam, (CX - hr * .16, hd + hr * .06, hr * .5)


def render(kind):
    mass, lit, dim, hot, beam, eye = build(kind)

    mask = Image.new('L', (W, H), 0)
    md = ImageDraw.Draw(mask)
    for p in mass:
        md.polygon(P(p), fill=255)
    # 발끝 줄 아래는 잘라 낸다 — 기둥을 폭으로 그리므로 반 폭만큼 넘어간다
    md.rectangle([0, GROUND + 1, W - 1, H - 1], fill=0)

    im = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.bitmap((0, 0), mask, fill=BODY)          # 덩어리 전체를 바탕색으로
    for p in dim:
        d.polygon(P(p), fill=DARK)
    for p in lit:
        d.polygon(P(p), fill=FACET)
    for p in hot:
        d.polygon(P(p), fill=LIT)
    for p in beam:
        d.polygon(P(p), fill=BEAMD)
        d.polygon(P([(x + 3, y) for x, y in p[:2]] + [(x + 3, y) for x, y in p[2:]]), fill=BEAM)

    # 면을 마스크 안으로 가둔다. 실루엣은 마스크가 정한다.
    im.putalpha(ImageChops.multiply(im.getchannel('A'), mask))

    # ── 붉은 점 셋. 마스크 밖에도 빛나야 하므로 마지막에 얹는다.
    cx, cy, r = eye
    d2 = ImageDraw.Draw(im)
    for ox, oy in ((0, -r), (-r * .95, r * .62), (r * .95, r * .62)):
        x, y = cx + ox, cy + oy
        d2.polygon(P([(x, y - r * .62), (x + r * .62, y), (x, y + r * .62), (x - r * .62, y)]), fill=GLOW)
        d2.polygon(P([(x, y - r * .34), (x + r * .34, y), (x, y + r * .34), (x - r * .34, y)]), fill=EYE)

    a = im.getchannel('A').point(lambda v: 255 if v >= 128 else 0)
    im.putalpha(a)
    return im


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', type=Path,
                    default=Path(__file__).resolve().parents[1] / 'assets' / 'monsters')
    a = ap.parse_args()
    a.out.mkdir(parents=True, exist_ok=True)
    for kind, name in (('scout', 'nhar_scout'), ('lance', 'nhar_lance'), ('warden', 'nhar_warden')):
        im = render(kind)
        bb = im.getchannel('A').getbbox()
        assert bb and bb[3] <= GROUND + 1, (name, bb)
        assert 285 <= bb[3] - bb[1] <= 345, ('높이가 기존(296~310) 과 크게 다르다', name, bb[3] - bb[1])
        im.save(a.out / (name + '.png'))
        print('%-12s bbox=%s  h=%d w=%d' % (name, bb, bb[3] - bb[1], bb[2] - bb[0]))
