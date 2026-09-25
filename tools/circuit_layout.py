"""코어 서킷 별자리 — 그림에서 별 자리를 뽑는다.

    python tools/circuit_layout.py <그림 폴더> [--write] [--art] [--force]

  --write  data/circuit_layout.js 를 쓴다
  --art    assets/circuit/<id>.webp 도 다시 만든다(그림이 바뀌었을 때만 — 70장 저장에 몇 분 걸린다)
  --force  편집기(tools/circuit_editor.mjs)로 손으로 고친 기체(hand)도 다시 뽑는다. 없으면 그 기체는 건너뛴다

ChatGPT 가 기체마다 별자리 그림(형상)을 그려 왔다(2026-09-25 · 좌표 파일은 없었다).
그래서 별 자리를 **그림의 실루엣에서** 뽑는다 — 그러면 별자리가 그 그림의 모양을 그대로 따라간다.

  1. 그림을 규격(1040 x 860, 좌표계 520 x 430 의 2배)에 맞춰 가운데 놓고 → assets/circuit/<id>.webp
  2. 알파로 몸을 가르고(가장 큰 덩어리), 테두리까지의 거리를 잰다
  3. 코어 = 몸이 가장 두꺼운 곳(몸통 한가운데)
  4. 몸 안쪽 길(가운데 선을 선호)로 코어에서 퍼져 나가며 거리를 잰다
  5. 갈래 끝 네 곳 = 코어에서 가장 멀리 뻗은 끝(귀 · 집게 · 꼬리 · 다리 · 포신). 앞의 끝과 길을 오래 같이 쓰면 빼고,
     방향이 너무 붙은 것도 뺀다. **가장 긴 줄기가 A** — A 가 그 기체에게 가장 어울리는 갈래라서(지시서 §2)
  6. 갈래마다 다른 갈래와 갈라지는 곳 너머부터 끝까지 별 8 개를 고르게, 끝에 전문 별(★)
  7. data/circuit_layout.js 에 쓴다 — 검사는 node tools/circuitlayoutcheck.mjs

numpy 와 Pillow 만 쓴다(scipy 없음).
"""
import heapq, io, json, math, os, sys
import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BOX = (1040, 860)            # 그림 규격 — 좌표계(520 x 430)의 2배
G = 8                        # 격자 한 칸 = 그림 8px = 좌표 4
STARS = 8
INSET = (64, 80)             # 그림을 판 가장자리에서 들여 놓는 폭(그림 px, 가로 · 세로) — 파일럿(GPT prepare.py)의 틀 (40, 80) 에
                             # 가로만 64 로 더 들였다. 별이 가장자리 24(좌표) 안에 들어와야 해서. 비율은 지킨다(파일럿은 늘렸다)
TONE = (112, 154, 157)       # 파일럿과 같은 청록 은빛 — 사용자가 승인한 파일럿 톤
CORE_PULL = float(os.environ.get("CIRCUIT_CORE_PULL", ".08"))   # 코어가 무게중심 쪽으로 끌리는 정도(두께와 저울질)
GAP = 22 / 4                 # 다른 갈래 별끼리 22(좌표) = 격자 5.5 칸
NEIGHBOR = 14 / 4            # 같은 갈래 이웃 별 14 — 팔다리 길이의 한계(한 줄로 이어져 헷갈리지 않는다)
PUSH = 12 / 4                # 붙은 별을 원래 자리에서 밀어낼 수 있는 한도 — 그림에서 너무 벗어나지 않게

def fit(im):
    s = min((BOX[0] - 2 * INSET[0]) / im.width, (BOX[1] - 2 * INSET[1]) / im.height)
    w, h = round(im.width * s), round(im.height * s)
    c = Image.new('RGBA', BOX, (0, 0, 0, 0))
    c.paste(im.resize((w, h), Image.LANCZOS), ((BOX[0] - w) // 2, (BOX[1] - h) // 2))
    return c

def tone(img):
    """파일럿(docs/art/circuit-pilot-2026-09-24/prepare.py)과 같은 처리 — 원화의 선 · 긁힘(명도 고역 성분)을 알파로,
    색은 TONE 한 가지, 알파 0 ~ 100. 밝은 면이 판을 덮지 않고 별이 먼저 읽힌다. 모양은 그대로(새 도형 없음)"""
    from PIL import ImageFilter
    bg = Image.new('RGBA', img.size, (0, 0, 0, 255)); bg.alpha_composite(img)
    ink = bg.convert('L')
    lum = np.asarray(ink, dtype=np.float32)
    blur = np.asarray(ink.filter(ImageFilter.GaussianBlur(2)), dtype=np.float32)
    support = (np.asarray(img.split()[3]) > 8) & (lum > 8)
    alpha = np.clip(np.abs(lum - blur) * 1.7 + lum * 0.08, 0, 100) * support
    out = Image.new('RGBA', img.size, TONE + (0,))
    out.putalpha(Image.fromarray(alpha.astype(np.uint8)))
    return out

def mask_of(img):
    a = np.asarray(img.split()[3], dtype=np.uint8)
    H, W = a.shape[0] // G, a.shape[1] // G
    cells = a[:H * G, :W * G].reshape(H, G, W, G).mean(axis=(1, 3))
    m = cells > 70
    # 가장 큰 덩어리만(떨어진 장식 조각은 버린다)
    lab = np.zeros(m.shape, int); best, bestn, k = 0, 0, 0
    for y in range(H):
        for x in range(W):
            if m[y, x] and not lab[y, x]:
                k += 1; st = [(y, x)]; lab[y, x] = k; n = 0
                while st:
                    cy, cx = st.pop(); n += 1
                    for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                        ny, nx = cy + dy, cx + dx
                        if 0 <= ny < H and 0 <= nx < W and m[ny, nx] and not lab[ny, nx]:
                            lab[ny, nx] = k; st.append((ny, nx))
                if n > bestn: best, bestn = k, n
    return lab == best

def dist_in(m):
    """테두리까지 거리(체스판 두 번 훑기)."""
    H, W = m.shape; INF = 10 ** 6
    d = np.where(m, INF, 0).astype(float)
    for y in range(H):
        for x in range(W):
            if d[y, x]:
                for dy, dx, w in ((-1, 0, 1), (0, -1, 1), (-1, -1, 1.4), (-1, 1, 1.4)):
                    ny, nx = y + dy, x + dx
                    v = d[ny, nx] + w if 0 <= ny < H and 0 <= nx < W else w
                    if v < d[y, x]: d[y, x] = v
    for y in range(H - 1, -1, -1):
        for x in range(W - 1, -1, -1):
            if d[y, x]:
                for dy, dx, w in ((1, 0, 1), (0, 1, 1), (1, 1, 1.4), (1, -1, 1.4)):
                    ny, nx = y + dy, x + dx
                    v = d[ny, nx] + w if 0 <= ny < H and 0 <= nx < W else w
                    if v < d[y, x]: d[y, x] = v
    return d

def geodesic(m, dt, core):
    """코어에서 몸 안쪽 길로 — 가운데 선을 선호하도록 테두리 가까운 칸을 비싸게. 거리 · 부모 · 실제 길이."""
    H, W = m.shape
    cost = np.full(m.shape, np.inf); par = {}; arc = np.zeros(m.shape)
    cost[core] = 0; pq = [(0.0, core)]
    N8 = [(dy, dx) for dy in (-1, 0, 1) for dx in (-1, 0, 1) if dy or dx]
    while pq:
        c, (y, x) = heapq.heappop(pq)
        if c > cost[y, x]: continue
        for dy, dx in N8:
            ny, nx = y + dy, x + dx
            if not (0 <= ny < H and 0 <= nx < W and m[ny, nx]): continue
            step = math.hypot(dy, dx)
            nc = c + step * (1 + 3.0 / max(dt[ny, nx], 1))
            if nc < cost[ny, nx]:
                cost[ny, nx] = nc; par[(ny, nx)] = (y, x); arc[ny, nx] = arc[y, x] + step
                heapq.heappush(pq, (nc, (ny, nx)))
    return cost, par, arc

def path_to(par, core, t):
    p = [t]
    while p[-1] != core: p.append(par[p[-1]])
    return p[::-1]                                        # 코어 → 끝

def shared(pa, pb):
    n = 0
    for a, b in zip(pa, pb):
        if a != b: break
        n += 1
    return n

def layout(img, pull=None):
    pull = CORE_PULL if pull is None else pull
    m = mask_of(img)
    dt = dist_in(m)
    ys, xs = np.nonzero(m)
    # 코어 — 가장 두꺼운 곳. 두께가 비슷하면 무게중심에 가까운 쪽
    cy, cx = ys.mean(), xs.mean()
    score = dt - pull * np.hypot(np.indices(m.shape)[0] - cy, np.indices(m.shape)[1] - cx)
    score[~m] = -1e9
    core = tuple(int(v) for v in np.unravel_index(np.argmax(score), m.shape))
    cost, par, arc = geodesic(m, dt, core)
    # 끝 후보 — 코어에서 먼 쪽으로 더 갈 데가 없는 칸(주변 3칸 안에서 가장 먼 칸)
    cand = []
    H, W = m.shape
    for y, x in zip(ys, xs):
        a = arc[y, x]
        if a < 6: continue
        y0, y1, x0, x1 = max(0, y - 3), min(H, y + 4), max(0, x - 3), min(W, x + 4)
        if a >= arc[y0:y1, x0:x1][m[y0:y1, x0:x1]].max() - 1e-9: cand.append((a, (int(y), int(x))))
    cand.sort(reverse=True)
    top = cand[0][0] if cand else 0

    def resample(p, s0frac_start):
        L = [0.0]
        for a, b in zip(p, p[1:]): L.append(L[-1] + math.hypot(a[0] - b[0], a[1] - b[1]))
        s0 = max(L[min(s0frac_start, len(L) - 1)] + 2.5, L[-1] * .16)
        s0 = min(s0, L[-1] * .45)
        pts = []
        for k in range(STARS + 1):
            s_ = s0 + (L[-1] - s0) * (k + .5) / (STARS + .5) if k < STARS else L[-1]
            j = next(j for j in range(len(L)) if L[j] >= s_ - 1e-9)
            if j == 0: y, x = p[0]
            else:
                f = (s_ - L[j - 1]) / max(L[j] - L[j - 1], 1e-9)
                y = p[j - 1][0] + (p[j][0] - p[j - 1][0]) * f; x = p[j - 1][1] + (p[j][1] - p[j - 1][1]) * f
            pts.append((y, x))
        return pts

    def build(paths):
        out = []
        for i, p in enumerate(paths):
            start = max([shared(p, q) for j, q in enumerate(paths) if j != i] or [0])
            out.append(resample(p, start))
        return out

    def score(paths):
        """낮을수록 좋다 — 선 교차와 붙은 별을 크게 벌하고, 갈래가 길고 고르게 길수록 좋다."""
        brs = build(paths)
        P = np.array([core] + [q for b in brs for q in b], float)
        D = np.sqrt(((P[:, None, :] - P[None, :, :]) ** 2).sum(-1)); np.fill_diagonal(D, 1e9)
        need = np.full(D.shape, GAP)
        for bi in range(4):                                          # 같은 갈래 이웃(코어 → 1 포함)은 NEIGHBOR
            idx = [0] + [1 + bi * 9 + k for k in range(9)]
            for u, v in zip(idx, idx[1:]): need[u, v] = need[v, u] = NEIGHBOR
        near = float(np.clip(need - D, 0, None).sum()) / 2         # 간격이 모자란 만큼
        seg = []
        for b in brs:
            prev = core
            for q in b: seg.append((prev, q)); prev = q
        S = np.array(seg, float)                                     # (n, 2, 2) — (y, x)
        a, b_ = S[:, 0], S[:, 1]
        def orient(p, q, r): return (q[..., 1] - p[..., 1]) * (r[..., 0] - p[..., 0]) - (q[..., 0] - p[..., 0]) * (r[..., 1] - p[..., 1])
        A1, B1, A2, B2 = a[:, None], b_[:, None], a[None, :], b_[None, :]
        o1, o2, o3, o4 = orient(A1, B1, A2), orient(A1, B1, B2), orient(A2, B2, A1), orient(A2, B2, B1)
        touch = (np.linalg.norm(A1 - A2, axis=-1) < 1e-6) | (np.linalg.norm(A1 - B2, axis=-1) < 1e-6) |                 (np.linalg.norm(B1 - A2, axis=-1) < 1e-6) | (np.linalg.norm(B1 - B2, axis=-1) < 1e-6)
        X = (o1 * o2 < 0) & (o3 * o4 < 0) & ~touch
        xs = int(np.triu(X, 1).sum())
        lens = [math.dist(b[0], b[-1]) + sum(math.dist(u, v) for u, v in zip(b, b[1:])) for b in brs]
        return xs * 1000 + near * 20 - min(lens) * 2 - sum(lens) * .3, brs

    # 끝 후보를 추린다 — 가까운 끝끼리는 하나로(같은 부위의 끝이 여럿 잡힌다), 너무 짧은 것은 뺀다
    tipc = []
    for a, t in cand:
        if a < .2 * top: break
        if all(math.dist(t, u) > 7 for _, u in tipc): tipc.append((a, t))
        if len(tipc) == 12: break
    if len(tipc) < 4: raise ValueError(f'갈래 끝 후보가 {len(tipc)} 곳뿐이다')
    P_ = {t: path_to(par, core, t) for _, t in tipc}
    from itertools import combinations
    best = None
    for combo in combinations([t for _, t in tipc], 4):
        ps = [P_[t] for t in combo]
        if any(shared(ps[i], ps[j]) > .8 * min(len(ps[i]), len(ps[j])) for i in range(4) for j in range(i + 1, 4)): continue
        sc, brs = score(ps)
        if best is None or sc < best[0]: best = (sc, combo, ps)
    if best is None: raise ValueError('갈래 넷을 고르지 못했다')
    _, tips, paths = best
    order = sorted(range(4), key=lambda i: -arc[tips[i]])       # 가장 긴 줄기가 A
    paths = [paths[i] for i in order]
    brs = build(paths)
    # 다른 갈래 별끼리 붙은 것을 조금씩 밀어낸다 — 원래 자리에서 PUSH 이내로만
    P = np.array([[list(q) for q in b] for b in brs], float)          # (4, 9, 2)
    O = P.copy(); C = np.array(core, float)
    for _ in range(80):
        moved = False
        for i in range(4):
            for k in range(9):
                p = P[i, k]
                others = [(j, m) for j in range(4) for m in range(9) if j != i]
                for j, m in others:
                    v = p - P[j, m]; d = np.hypot(*v)
                    if d < GAP + .08 and d > 1e-6:                     # 반올림 뒤에도 22 가 되게 조금 더
                        step = (GAP + .08 - d) / 2 * v / d * .5
                        P[i, k] += step; P[j, m] -= step; moved = True
                v = p - C; d = np.hypot(*v)
                if k > 0 and d < GAP + .08 and d > 1e-6: P[i, k] += (GAP + .08 - d) * v / d * .5; moved = True
        off = P - O; n = np.hypot(off[..., 0], off[..., 1])[..., None]
        P = np.where(n > PUSH, O + off / np.maximum(n, 1e-9) * PUSH, P)
        if not moved: break
    branches = [[[round((x + .5) * G / 2, 1), round((y + .5) * G / 2, 1)] for y, x in b] for b in P.tolist()]
    return {'core': [round((core[1] + .5) * G / 2, 1), round((core[0] + .5) * G / 2, 1)], 'A': branches[0],
            'B': branches[1], 'C': branches[2], 'D': branches[3]}

PULLS = (.08, .2, .35, .5)

def quality(lay):
    """검사(tools/circuitlayoutcheck.mjs)와 같은 잣대 — 선 교차 수, 다른 갈래 최소 간격, 이웃 최소 간격."""
    BR = 'ABCD'; pts = [('core', -1, lay['core'])] + [(b, k, p) for b in BR for k, p in enumerate(lay[b])]
    nb = lambda x, y: (x[0] == y[0] and abs(x[1] - y[1]) == 1) or (x[0] == 'core' and y[1] == 0) or (y[0] == 'core' and x[1] == 0)
    mi = mn = 1e9
    for i in range(len(pts)):
        for j in range(i + 1, len(pts)):
            d = math.dist(pts[i][2], pts[j][2])
            if nb(pts[i], pts[j]): mn = min(mn, d)
            else: mi = min(mi, d)
    seg = []
    for b in BR:
        prev = lay['core']
        for q in lay[b]: seg.append((prev, q)); prev = q
    o = lambda p, q, r: (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])
    xs = 0
    for i in range(len(seg)):
        for j in range(i + 1, len(seg)):
            a, b_ = seg[i]; c, d_ = seg[j]
            if min(math.dist(a, c), math.dist(a, d_), math.dist(b_, c), math.dist(b_, d_)) < 1e-6: continue
            if o(a, b_, c) * o(a, b_, d_) < 0 and o(c, d_, a) * o(c, d_, b_) < 0: xs += 1
    return xs, mi, mn

def label_ok(lay, b):
    return all(label_boxes(lay).values()) if b == 'ALL' else label_boxes(lay)[b] is not None

def label_boxes(lay):
    """A ~ D 차례로 — 앞 칸들을 피해 자리를 잡는다(js/circuitlayout.js checkLayout 과 같은 순서)"""
    taken, out = [], {}
    for b in 'ABCD':
        out[b] = label_box(lay, b, taken)
        if out[b]: taken.append(out[b])
    return out

def label_box(lay, b, taken=()):
    """★ 둘레에 이름 칸(90 x 20)을 놓을 자리 [왼쪽, 위, 90, 20] — tools/circuitlayoutcheck.mjs labelSpot 과 같은 규칙. 없으면 None"""
    st, s8 = lay[b][8], lay[b][7]; out = math.atan2(st[1] - s8[1], st[0] - s8[0])
    pts = [lay['core']] + [q for x in 'ABCD' for q in lay[x]]
    for r in (16, 28, 40):
        for k in (0, 1, -1, 2, -2, 3, -3, 4, -4, 5, -5, 6):
            a = out + k * math.pi / 6; cx, cy = st[0] + math.cos(a) * r, st[1] + math.sin(a) * r
            x0 = cx if math.cos(a) > .3 else cx - 90 if math.cos(a) < -.3 else cx - 45
            y0 = cy if math.sin(a) > .3 else cy - 20 if math.sin(a) < -.3 else cy - 10
            if x0 < 2 or x0 + 90 > 518 or y0 < 2 or y0 + 20 > 428: continue
            if any(x0 - 6 < p[0] < x0 + 96 and y0 - 6 < p[1] < y0 + 26 for p in pts): continue
            if any(x0 < t[0] + t[2] + 2 and t[0] < x0 + 92 and y0 < t[1] + t[3] + 2 and t[1] < y0 + 22 for t in taken): continue
            return [round(x0, 1), round(y0, 1), 90, 20]
    return None

def best_layout(img):
    """코어를 무게중심 쪽으로 끄는 정도를 몇 가지로 시도해 가장 좋은 것 — 그림마다 몸통 모양이 달라 한 값으로 안 맞는다
    (가장 두꺼운 곳이 가장자리의 큰 구체인 그림이 있다 · 2026-09-25 QUASAR)."""
    best = None
    for pull in PULLS:
        try: lay = layout(img, pull)
        except ValueError: continue
        xs, mi, mn = quality(lay)
        nolbl = sum(v is None for v in label_boxes(lay).values())
        key = (xs, nolbl, -min(mi / 22, mn / 14, 1.0), -(mi + mn))
        if best is None or key < best[0]: best = (key, lay, pull)
    if best is None: raise ValueError('어느 끌림 값으로도 갈래 넷을 못 골랐다')
    best[1]['pull'] = best[2]
    return best[1]

# ── 촘촘한 갈래를 휘어 늘린다(2026-09-25 사용자 제안) ─────────────────────────
# 팔다리가 짧은 그림은 별 9 개를 넉넉히 띄울 길이가 없다. 첫 별과 ★ 은 제자리에 두고 그 사이를 옆으로 출렁이게 휘면
# 같은 두 점 사이 길이가 늘어 간격이 벌어진다. 반 물결 수(2 = S 자, 3, 4, 1 = 활, 5)와 방향(좌 · 우)을 시도해, 교차 · 붙은 별 · 판 밖이
# 생기지 않는 것 가운데 가장 작게 휜 것을 쓴다. 휘는 폭은 필요한 길이가 나오는 만큼만(최대 WIGGLE_MAX).
TARGET_NB = 16.0             # 휘어서 맞추려는 이웃 별 간격(검사 기준 14 에 여유)
WIGGLE_MAX = 40.0            # 옆으로 휘는 최대 폭(좌표) — 그림에서 너무 멀어지지 않게
EDGE = 24.0

def _nb_min(br, core=None):
    pts = ([core] if core else []) + br
    return min(math.dist(a, b) for a, b in zip(pts, pts[1:]))

def _wiggle(br, waves, amp):
    """br[0](첫 별) ~ br[8](★) 사이를 휜 곡선 위에 별 1 ~ 8 을 같은 길이로 다시 놓는다. 첫 별 · ★ 은 그대로"""
    base = np.array(br, float)
    seg = np.r_[0, np.cumsum(np.hypot(*np.diff(base, axis=0).T))]
    t = np.linspace(0, seg[-1], 200)
    xy = np.c_[np.interp(t, seg, base[:, 0]), np.interp(t, seg, base[:, 1])]
    d = np.gradient(xy, axis=0); n = np.c_[-d[:, 1], d[:, 0]]; n /= np.maximum(np.hypot(*n.T), 1e-9)[:, None]
    u = t / t[-1]
    cur = xy + n * (amp * np.sin(np.pi * waves * u))[:, None]
    L = np.r_[0, np.cumsum(np.hypot(*np.diff(cur, axis=0).T))]
    want = np.linspace(0, L[-1], 9)
    out = np.c_[np.interp(want, L, cur[:, 0]), np.interp(want, L, cur[:, 1])]
    return [[round(float(x), 1), round(float(y), 1)] for x, y in out], float(L[-1])

def _repel(lay, push=12.0, gap=22.3):
    """다른 갈래 별끼리 gap 보다 가까우면 서로 조금씩 민다 — 원래 자리에서 push 이내로만(좌표 단위). 새 lay 를 돌려준다"""
    P = np.array([lay[b] for b in 'ABCD'], float); O = P.copy(); C = np.array(lay['core'], float)
    for _ in range(80):
        moved = False
        for i in range(4):
            for k in range(9):
                for j in range(4):
                    if j == i: continue
                    for m in range(9):
                        v = P[i, k] - P[j, m]; d = float(np.hypot(*v))
                        if 1e-6 < d < gap:
                            step = (gap - d) / 4 * v / d; P[i, k] += step; P[j, m] -= step; moved = True
                v = P[i, k] - C; d = float(np.hypot(*v))
                if k > 0 and 1e-6 < d < gap: P[i, k] += (gap - d) * v / d * .5; moved = True
        off = P - O; n = np.hypot(off[..., 0], off[..., 1])[..., None]
        P = np.where(n > push, O + off / np.maximum(n, 1e-9) * push, P)
        if not moved: break
    out = dict(lay)
    for i, b in enumerate('ABCD'): out[b] = [[round(float(x), 1), round(float(y), 1)] for x, y in P[i]]
    return out

def loosen(lay):
    """촘촘한 갈래를 휜다. 바꾼 갈래 이름 목록을 lay['bent'] 에 남긴다"""
    bent = []
    for b in sorted('ABCD', key=lambda b: _nb_min(lay[b])):
        br = lay[b]
        if _nb_min(br, lay['core']) >= 14 and _nb_min(br) >= 14: continue
        best = None
        base_q = quality(lay)
        opts = [(0, 1, 1)] + [(t * 8, w, sg) for t in (TARGET_NB, 14.2) for w in (2, 3, 4, 1, 5) for sg in (1, -1)]
        for need, waves, sign in opts:
            if need == 0: amp = 0.0                              # 휘지 않고 같은 길 위에 별만 고르게
            else:
                lo, hi = 0.0, WIGGLE_MAX
                if _wiggle(br, waves, sign * hi)[1] < need: amp = hi
                else:
                    for _ in range(18):
                        m = (lo + hi) / 2
                        if _wiggle(br, waves, sign * m)[1] < need: lo = m
                        else: hi = m
                    amp = hi
            new, _ = _wiggle(br, waves, sign * amp)
            for trial in ({**lay, b: new}, _repel({**lay, b: new})):     # 그대로, 또는 옆 갈래를 조금 밀고
                if any(not (EDGE <= x <= 520 - EDGE and EDGE <= y <= 430 - EDGE) for c in 'ABCD' for x, y in trial[c]): continue
                xs, mi, mn = quality(trial)
                if xs > base_q[0] or mi < min(22, base_q[1]): continue
                worst = min(_nb_min(trial[c], trial['core']) for c in 'ABCD')
                key = (-min(worst, 14), -min(_nb_min(trial[b]), 16), amp)
                if best is None or key < best[0]: best = (key, trial, waves if amp else 0, amp)
        if best and min(_nb_min(best[1][c], best[1]['core']) for c in 'ABCD') > min(_nb_min(lay[c], lay['core']) for c in 'ABCD'):
            for c in 'ABCD': lay[c] = best[1][c]
            bent.append(f'{b}:{best[2]}x{best[3]:.0f}')
    if bent: lay['bent'] = bent
    return lay

def main():
    src = sys.argv[1]; write = '--write' in sys.argv; art = '--art' in sys.argv; force = '--force' in sys.argv
    hand = set()
    dpath = os.path.join(ROOT, 'data', 'circuit_layout.js')
    if os.path.exists(dpath) and not force:
        import re as _re
        part = io.open(dpath, encoding='utf-8').read().split('export const CIRCUIT_LABEL_BOXES')[0]
        hand = {m.group(1) for m in _re.finditer(r'^  (\w+): (\{.*\}),$', part, _re.M) if json.loads(m.group(2)).get('hand')}
    import csv
    rows = list(csv.DictReader(io.open(os.path.join(src, 'manifest.csv'), encoding='utf-8-sig')))
    out, log = {}, []
    os.makedirs(os.path.join(ROOT, 'assets', 'circuit'), exist_ok=True)
    for r in rows:
        rid = r['id']
        if rid in hand:
            print(f'  {rid:10s} 손으로 고친 기체 — 건너뜀(--force 면 다시 뽑는다)'); continue
        img = fit(Image.open(os.path.join(src, r['final_filename'])).convert('RGBA'))
        try:
            lay = loosen(best_layout(img))
        except ValueError as e:
            print(f'  {rid}: {e}'); continue
        lay['art'] = f'assets/circuit/{rid}.webp'
        lay['ref'] = None
        out[rid] = lay
        p = os.path.join(ROOT, 'assets', 'circuit', rid + '.webp')
        if art or (write and not os.path.exists(p)):
            tone(img).save(p, 'WEBP', lossless=True, method=6)
        if write:
            log.append((rid, r['source_filename'], r['sha256'], os.path.getsize(p)))
        print(f'  {rid:10s} 끌림 {lay["pull"]:.2f} 휨 {",".join(lay.get("bent", [])) or "-":14s} 코어 {lay["core"]}  끝 A{lay["A"][-1]} B{lay["B"][-1]} C{lay["C"][-1]} D{lay["D"][-1]}')
    if write:
        # 이 폴더에 없는 기체는 **건드리지 않는다** — 파일럿 6기는 GPT 가 손으로 놓은 좌표다(2026-09-24).
        # 2026-09-25 에 이 도구의 첫 판이 그 파일을 통째로 덮어써서 docs/art/circuit-pilot-2026-09-24/layout.json 에서 되살렸다
        path = os.path.join(ROOT, 'data', 'circuit_layout.js')
        keep, keep_lbl = {}, {}
        if os.path.exists(path):
            import re
            old = io.open(path, encoding='utf-8').read()
            lay_part = old.split('export const CIRCUIT_LABEL_BOXES')[0]
            lbl_part = old.split('export const CIRCUIT_LABEL_BOXES')[1] if 'export const CIRCUIT_LABEL_BOXES' in old else ''
            for m in re.finditer(r'^  (\w+): (\{.*\}),$', lay_part, re.M):
                if m.group(1) not in out: keep[m.group(1)] = json.loads(m.group(2))
            for m in re.finditer(r'^  (\w+): (\{.*\}),$', lbl_part, re.M):
                if m.group(1) not in out: keep_lbl[m.group(1)] = json.loads(m.group(2))
        allv = {**keep, **out}
        labels = {**keep_lbl, **{k: {b: box for b, box in label_boxes(v).items() if box} for k, v in out.items()}}
        dump = lambda d: ''.join(f'  {k}: {json.dumps(v, ensure_ascii=False, separators=(",", ":"))},\n' for k, v in d.items())
        head = [
            '/* 코어 서킷 별자리 좌표 — 좌표계 520 x 430, 왼쪽 위가 0,0. 갈래마다 9 점(별 1 ~ 8 · 전문 별 ★), 연결은 코드가 그린다.',
            '   그림은 사용자가 ChatGPT 로 그려 왔다(70기 2026-09-25 오전, 파일럿 자리 6기 같은 날) — 톤은 모두 같게 입혔다(tools/circuit_layout.py tone).',
            '   **별 자리는 그림의 실루엣에서 뽑았다** — 코어 = 몸통 한가운데, 갈래 끝 = 가장 멀리 뻗은 부위 넷, 가장 긴 줄기가 A.',
            '   pull 은 코어를 무게중심 쪽으로 끈 정도(도구가 기체마다 고른 값). 도구는 입력 폴더에 있는 기체만 다시 쓰고 나머지는 그대로 둔다.',
            '   ChatGPT 의 첫 파일럿(그림 · 손으로 놓은 좌표)은 docs/art/circuit-pilot-2026-09-24/ 에 보존했다.',
            '   검사는 node tools/circuitlayoutcheck.mjs */',        ]
        js = ('\n'.join(head) + '\n' + 'export const CIRCUIT_LAYOUT = {\n' + dump(allv) + '};\n\n'
              + '/* 갈래 이름 칸 [왼쪽, 위, 90, 20] — 도구가 ★ 둘레에서 판 안 · 별을 덮지 않는 첫 자리를 골랐다. 없으면 화면이 고른다 */\n'
              + 'export const CIRCUIT_LABEL_BOXES = {\n' + dump(labels) + '};\n')
        io.open(path, 'w', encoding='utf-8', newline='\n').write(js)
        # 파일 기록 — 이번에 안 돌린 기체의 줄은 남긴다(6기만 다시 돌려도 70기 기록이 사라지지 않게)
        csvp = os.path.join(ROOT, 'docs', 'art', 'circuit-constellations-files.csv')
        rows_old = {}
        if os.path.exists(csvp):
            for line in io.open(csvp, encoding='utf-8').read().splitlines()[1:]:
                if line: rows_old[line.split(',')[0]] = line
        for rid, sname, sha, n in log: rows_old[rid] = f'{rid},assets/circuit/{rid}.webp,{n},{sname},{sha}'
        io.open(csvp, 'w', encoding='utf-8', newline='\n').write('id,webp,webp_bytes,source_filename,source_sha256\n' + ''.join(v + '\n' for v in rows_old.values()))
        print(f'\n기체 {len(out)}(+ 그대로 둔 기체 {len(keep)}) · data/circuit_layout.js · assets/circuit/*.webp · docs/art/circuit-constellations-files.csv')

if __name__ == '__main__':
    main()
