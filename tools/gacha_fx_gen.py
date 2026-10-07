"""뽑기 연출용 이펙트 그림 생성기 (2026-10-08).
추상 빛 그림(마법진 · 소용돌이 · 햇살 · 별빛 · 유성 · 불꽃)과 등급별 캡슐을 만든다.
  - 빛 그림은 전부 흰색 + 알파(투명). 코드가 등급 색을 입히고 더하기(lighter)로 얹는다.
  - 등급별 캡슐은 기존 assets/gacha/core-capsule.png 의 색상 · 재질만 바꾼 것이다(새로 그린 것이 아니다).
  - 기체 · 문양 · 컷 같은 '그림'은 만들지 않는다 — ChatGPT 의뢰서(docs/art/gacha-art-request-2026-10-08.md).
실행: python tools/gacha_fx_gen.py   → assets/gacha/fx/*.webp|png · assets/gacha/capsule-*.png """
import math, os, random, colorsys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = os.path.join(os.path.dirname(__file__), '..')
OUT = os.path.join(ROOT, 'assets', 'gacha')
FX = os.path.join(OUT, 'fx')
os.makedirs(FX, exist_ok=True)
rng = np.random.default_rng(20261008)
random.seed(20261008)

def save_white(alpha, name, webp=True):
    """alpha(0~1 float 배열) → 흰색 RGBA"""
    a = (np.clip(alpha, 0, 1) * 255).astype(np.uint8)
    img = np.zeros(alpha.shape + (4,), np.uint8); img[..., :3] = 255; img[..., 3] = a
    im = Image.fromarray(img, 'RGBA')
    path = os.path.join(FX, name)
    if webp and name.endswith('.webp'): im.save(path, 'WEBP', quality=92, method=6)
    else: im.save(path, optimize=True)
    print(f'  {name:22s} {im.size[0]}x{im.size[1]} {os.path.getsize(path)//1024} KB')

def grid(n, h=None):
    h = h or n
    y, x = np.mgrid[0:h, 0:n].astype(np.float32)
    return (x - n / 2) / (n / 2), (y - h / 2) / (n / 2)

def polar(n):
    x, y = grid(n); return np.hypot(x, y), np.arctan2(y, x)

def fft_noise(n, beta=2.0, seed=0):
    r = np.random.default_rng(seed)
    f = np.fft.fftfreq(n)[:, None] ** 2 + np.fft.fftfreq(n)[None, :] ** 2
    f[0, 0] = 1
    spec = (r.normal(size=(n, n)) + 1j * r.normal(size=(n, n))) / (f ** (beta / 2))
    spec[0, 0] = 0
    z = np.real(np.fft.ifft2(spec)); z = (z - z.min()) / (z.max() - z.min()); return z

def glow(sharp, blur=6, k=.6):
    im = Image.fromarray((np.clip(sharp, 0, 1) * 255).astype(np.uint8))
    b = np.asarray(im.filter(ImageFilter.GaussianBlur(blur)), np.float32) / 255
    return np.clip(sharp + k * b, 0, 1)

# ───────────────────────── 마법진 ─────────────────────────
def rune_layer(kind, N=1024):
    S = 2; M = N * S; cx = M / 2; R = M * .49
    im = Image.new('L', (M, M), 0); d = ImageDraw.Draw(im)
    ring = lambda r, w: d.ellipse([cx - r, cx - r, cx + r, cx + r], outline=255, width=int(w * S))
    pt = lambda r, a: (cx + math.cos(a) * r, cx + math.sin(a) * r)
    rr = random.Random(7 + ord(kind))
    if kind == 'a':                                         # 바깥 문자 고리
        ring(R, 7); ring(R * .965, 2); ring(R * .80, 4); ring(R * .785, 1.5)
        n = 72
        for i in range(n):                                  # 룬 비슷한 획 — 칸마다 3~4획
            a0 = i * 2 * math.pi / n; a1 = a0 + 2 * math.pi / n * .7; rin, rout = R * .815, R * .945
            pts = []
            for _ in range(rr.randint(3, 5)):
                aa = rr.uniform(a0, a1); rad = rr.uniform(rin, rout); pts.append(pt(rad, aa))
            d.line(pts, fill=255, width=int(3 * S), joint='curve')
            if rr.random() < .4: d.line([pt(rin, (a0 + a1) / 2), pt(rout, (a0 + a1) / 2)], fill=255, width=int(2 * S))
        for i in range(12):                                 # 열두 곳 마름모
            a = i * math.pi / 6; c = pt(R * .88, a); s = 15 * S
            d.polygon([(c[0], c[1] - s * 1.6), (c[0] + s, c[1]), (c[0], c[1] + s * 1.6), (c[0] - s, c[1])], outline=255, width=int(2 * S))
    elif kind == 'b':                                       # 눈금 · 톱니
        ring(R * .93, 3); ring(R * .62, 3); ring(R * .6, 1.5)
        for i in range(144):
            a = i * 2 * math.pi / 144; L = 26 if i % 12 == 0 else 15 if i % 4 == 0 else 8
            d.line([pt(R * .93, a), pt(R * .93 - L * S * 1.6, a)], fill=255, width=int((4 if i % 12 == 0 else 2) * S))
        for i in range(24):                                 # 안쪽을 향한 삼각 톱니
            a = i * 2 * math.pi / 24; w = .05
            d.polygon([pt(R * .87, a - w), pt(R * .87, a + w), pt(R * .7, a)], outline=255, width=int(2.5 * S))
        for i in range(24):
            a = (i + .5) * 2 * math.pi / 24; c = pt(R * .64, a); s = 6 * S
            d.ellipse([c[0] - s, c[1] - s, c[0] + s, c[1] + s], fill=255)
    elif kind == 'c':                                       # 육각 별 + 정삼각 두 개
        ring(R * .86, 5); ring(R * .56, 2)
        for off in (-math.pi / 2, math.pi / 2):
            pts = [pt(R * .86, off + i * 2 * math.pi / 3) for i in range(3)]
            d.polygon(pts, outline=255, width=int(4 * S))
            for p in pts:
                s = 24 * S; d.ellipse([p[0] - s, p[1] - s, p[0] + s, p[1] + s], outline=255, width=int(3 * S))
                s2 = 8 * S; d.ellipse([p[0] - s2, p[1] - s2, p[0] + s2, p[1] + s2], fill=255)
        for i in range(6):
            a = i * math.pi / 3; d.line([pt(R * .2, a), pt(R * .55, a)], fill=255, width=int(2 * S))
        ring(R * .2, 3)
        for i in range(36):
            a = i * 2 * math.pi / 36; d.line([pt(R * .58, a), pt(R * .64, a)], fill=255, width=int(2 * S))
    else:                                                   # d — 점선 · 작은 고리
        for r, w, dash in ((R * .78, 5, 28), (R * .66, 2, 16), (R * .5, 3, 12)):
            n = int(2 * math.pi * r / (dash * S * 1.6))
            for i in range(n):
                a0 = i * 2 * math.pi / n; a1 = a0 + 2 * math.pi / n * .55
                d.arc([cx - r, cx - r, cx + r, cx + r], math.degrees(a0), math.degrees(a1), fill=255, width=int(w * S))
        ring(R * .38, 4)
        for i in range(8):
            a = i * math.pi / 4; c = pt(R * .38, a); s = 10 * S
            d.ellipse([c[0] - s, c[1] - s, c[0] + s, c[1] + s], fill=255)
            d.line([pt(R * .38, a), pt(R * .22, a)], fill=255, width=int(3 * S))
        ring(R * .22, 3); ring(R * .1, 6)
    im = im.resize((N, N), Image.LANCZOS)
    return glow(np.asarray(im, np.float32) / 255, 5, .55)

def make_runes():
    layers = {}
    for k in 'abcd':
        layers[k] = rune_layer(k); save_white(layers[k], f'rune-{k}.webp')
    # 바닥용 — 겹쳐서 세로로 납작하게(원근을 미리 넣는다)
    comp = np.clip(layers['a'] + layers['b'] * .9 + layers['c'] * .8 + layers['d'] * .7, 0, 1)
    im = Image.fromarray((comp * 255).astype(np.uint8)).resize((1536, 1536), Image.LANCZOS).resize((1536, 512), Image.LANCZOS)
    save_white(np.asarray(im, np.float32) / 255, 'rune-floor.webp')

# ───────────────────────── 소용돌이 · 햇살 ─────────────────────────
def make_swirl_energy(N=1536):
    r, th = polar(N); r = np.clip(r, 1e-4, None)
    out = np.zeros_like(r)
    arms = 7
    for k in range(arms):
        a0 = k * 2 * math.pi / arms
        tw = a0 + 4.6 * r ** .85
        dth = np.angle(np.exp(1j * (th - tw)))
        wid = .035 + .13 * r
        out += np.exp(-(dth / wid) ** 2) * (.55 + .45 * np.exp(-(dth / (wid * .25)) ** 2))
    nz = fft_noise(512, 2.4, 3); nzi = np.asarray(Image.fromarray((nz * 255).astype(np.uint8)).resize((N, N), Image.BICUBIC), np.float32) / 255
    out *= (.6 + .6 * nzi)
    prof = np.clip((r - .04) / .12, 0, 1) * np.clip((1 - r) / .25, 0, 1) ** .8
    save_white(glow(np.clip(out * prof, 0, 1), 8, .7), 'swirl-energy.webp')

def make_swirl_cloud(N=1536):
    r, th = polar(N)
    z = fft_noise(1024, 2.6, 11)
    u = ((th + 5.4 * (1 - np.clip(r, 0, 1)) ** 1.2) / (2 * math.pi) % 1) * 1024
    v = np.clip(r, 0, 1) * 1023
    iu = (u.astype(np.int32)) % 1024; iv = v.astype(np.int32)
    cl = z[iv, iu]
    cl = np.clip((cl - .38) * 2.2, 0, 1)
    z2 = fft_noise(1024, 3.2, 12); cl2 = z2[iv, (iu * 2) % 1024]; cl = np.clip(cl * (.55 + .8 * cl2), 0, 1)
    prof = np.clip((r - .1) / .18, 0, 1) * np.clip((1 - r) / .4, 0, 1)
    save_white(np.clip(cl * prof * 1.15, 0, 1), 'swirl-cloud.webp')

def make_ray_burst(N=1536):
    r, th = polar(N); out = np.zeros_like(r)
    for _ in range(110):
        a = rng.uniform(-math.pi, math.pi); w = rng.uniform(.004, .03); L = rng.uniform(.35, 1.0); amp = rng.uniform(.35, 1)
        dth = np.angle(np.exp(1j * (th - a)))
        out += amp * np.exp(-(dth / (w * (1 + 1.5 * (1 - np.clip(r, 0, 1))))) ** 2) * np.clip(1 - r / L, 0, 1) ** 1.4
    core = np.exp(-(r / .09) ** 2) * 1.2
    save_white(glow(np.clip(out * .85 + core, 0, 1), 4, .5), 'ray-burst.webp')

def make_flare(N=1024):
    x, y = grid(N); r = np.hypot(x, y)
    h = np.exp(-np.abs(x) * 3.2) * np.exp(-(y / .012) ** 2)
    v = np.exp(-np.abs(y) * 4.2) * np.exp(-(x / .012) ** 2) * .8
    dg = sum(np.exp(-np.abs(a) * 5) * np.exp(-(b / .01) ** 2) * .35 for a, b in (((x + y) / 1.414, (x - y) / 1.414), ((x - y) / 1.414, (x + y) / 1.414)))
    ringp = np.exp(-((r - .55) / .006) ** 2) * .4
    core = np.exp(-(r / .07) ** 2) * 1.3 + np.exp(-(r / .22) ** 2) * .35
    save_white(glow(np.clip(h + v + dg + ringp + core, 0, 1), 3, .6), 'flare-star.webp')
    W_, H_ = 2048, 128
    y2, x2 = np.mgrid[0:H_, 0:W_].astype(np.float32); xn = (x2 - W_ / 2) / (W_ / 2); yn = (y2 - H_ / 2) / (H_ / 2)
    st = np.exp(-(yn / .09) ** 2) * np.exp(-np.abs(xn) * 2.2) + np.exp(-(yn / .45) ** 2) * np.exp(-np.abs(xn) * 5) * .35
    save_white(np.clip(st * 1.1, 0, 1), 'flare-streak.webp')

def make_meteor():
    N = 256; x, y = grid(N); r = np.hypot(x, y)
    save_white(np.clip(np.exp(-(r / .12) ** 2) * 1.4 + np.exp(-(r / .4) ** 2) * .55 + np.exp(-r * 3) * .25, 0, 1), 'meteor-head.png')
    W_, H_ = 1024, 96
    y2, x2 = np.mgrid[0:H_, 0:W_].astype(np.float32); xn = x2 / W_; yn = (y2 - H_ / 2) / (H_ / 2)
    wid = .06 + .5 * xn
    tr = np.exp(-(yn / wid) ** 2) * xn ** 1.6 + np.exp(-(yn / (wid * .3)) ** 2) * xn ** 2 * .8
    save_white(np.clip(tr, 0, 1), 'meteor-trail.png')

def make_particles():
    N = 64; x, y = grid(N); r = np.hypot(x, y)
    save_white(np.clip(np.exp(-(r / .18) ** 2) * 1.5 + np.exp(-(np.abs(x) / .04) ** 2) * np.exp(-np.abs(y) * 2) * .5 + np.exp(-(np.abs(y) / .04) ** 2) * np.exp(-np.abs(x) * 2) * .5, 0, 1), 'spark.png')
    save_white(np.clip(np.exp(-(r / .35) ** 2) * 1.1, 0, 1), 'ember.png')
    N = 256; z = fft_noise(N, 2.8, 31); x, y = grid(N); r = np.hypot(x, y)
    save_white(np.clip(np.clip((z - .4) * 2.4, 0, 1) * np.clip(1 - r, 0, 1) ** 1.3 * 1.5, 0, 1), 'smoke.png')

# ───────────────────────── 등급별 캡슐 ─────────────────────────
TIER = {   # 색조(도) · 채도 · 밝기 · 금속 틴트
    'c':  dict(hue=None, sat=.22, val=.82, metal=0.0),
    'uc': dict(hue=150, sat=1.0, val=1.0, metal=.06),
    'r':  dict(hue=None, sat=1.12, val=1.06, metal=.0),
    'uq': dict(hue=272, sat=1.1, val=1.05, metal=.1),
    'ep': dict(hue=38, sat=1.15, val=1.12, metal=.28, armor=(24, .55, 1.15)),   # 어두운 장갑은 청동 · 금(황록으로 번지지 않게 색조를 고정)
}
def rgb_to_hsv(a):
    r, g, b = a[..., 0], a[..., 1], a[..., 2]; mx = a.max(-1); mn = a.min(-1); d = mx - mn
    h = np.zeros_like(mx); m = d > 1e-6
    rc = m & (mx == r); gc = m & (mx == g) & ~rc; bc = m & ~rc & ~gc
    h[rc] = ((g - b)[rc] / d[rc]) % 6; h[gc] = (b - r)[gc] / d[gc] + 2; h[bc] = (r - g)[bc] / d[bc] + 4
    return h * 60, np.where(mx > 0, d / np.maximum(mx, 1e-6), 0), mx
def hsv_to_rgb(h, s, v):
    h = (h % 360) / 60; i = np.floor(h).astype(int) % 6; f = h - np.floor(h)
    p = v * (1 - s); q = v * (1 - s * f); t = v * (1 - s * (1 - f))
    out = np.zeros(h.shape + (3,), np.float32)
    for k, (a, b, c) in enumerate(((v, t, p), (q, v, p), (p, v, t), (p, q, v), (t, p, v), (v, p, q))):
        m = i == k; out[..., 0][m] = a[m]; out[..., 1][m] = b[m]; out[..., 2][m] = c[m]
    return out

def make_capsules():
    src = Image.open(os.path.join(OUT, 'core-capsule.png')).convert('RGBA'); arr = np.asarray(src, np.float32) / 255
    rgb, a = arr[..., :3], arr[..., 3]
    h, s, v = rgb_to_hsv(rgb)
    for k, t in TIER.items():
        hh = h.copy(); ss = s.copy(); vv = v.copy()
        if t['hue'] is not None:
            glowmask = (s > .28)                                        # 발광(청록) 부분만 색을 돌린다
            hh = np.where(glowmask, (h + (t['hue'] - 195)) % 360, h)
            mt = t['metal']
            if mt:                                                      # 금속 부분도 조금 물들인다
                low = ~glowmask
                hh = np.where(low, t['hue'], hh); ss = np.where(low, np.clip(s + mt * (1 - s), 0, 1), ss)
        if t.get('armor'):                                              # 어두운 장갑 — 색조 · 채도를 고정한다
            ah, asat, aval = t['armor']; arm = (v < .55) & (s > .28)
            hh = np.where(arm, ah, hh); ss = np.where(arm, np.minimum(s, asat), ss); v = np.where(arm, np.clip(v * aval, 0, 1), v)
        ss = np.clip(ss * t['sat'], 0, 1)
        vv = np.clip(v * t['val'], 0, 1)
        out = hsv_to_rgb(hh, ss, vv)
        img = np.dstack([out, a])
        Image.fromarray((img * 255).astype(np.uint8), 'RGBA').save(os.path.join(OUT, f'capsule-{k}.png'), optimize=True)
        print(f'  capsule-{k}.png')
    return arr

def crack_overlay(base_name, n_main, glow_rgb, bright, seed):
    r = random.Random(seed)
    N = 640; S = 2; M = N * S
    base = Image.open(os.path.join(OUT, base_name)).convert('RGBA')
    mask = Image.new('L', (M, M), 0); d = ImageDraw.Draw(mask)
    cx = cy = M / 2
    def branch(x, y, ang, L, w, depth):
        pts = [(x, y)]
        for _ in range(int(L / (14 * S))):
            ang += r.uniform(-.55, .55); x += math.cos(ang) * 14 * S; y += math.sin(ang) * 14 * S; pts.append((x, y))
        d.line(pts, fill=255, width=max(2, int(w * S)), joint='curve')
        if depth < 2 and len(pts) > 4:
            for _ in range(r.randint(1, 2)):
                p = pts[r.randint(2, len(pts) - 2)]; branch(p[0], p[1], ang + r.choice((-1, 1)) * r.uniform(.5, 1.1), L * .5, w * .6, depth + 1)
    for i in range(n_main):
        branch(cx, cy, i * 2 * math.pi / n_main + r.uniform(-.3, .3), M * .26, 4.2, 0)
    # 캡슐 모양 안에서만 보이게 — 원본 알파로 자른다
    cap_a = base.split()[3].resize((M, M), Image.LANCZOS)
    m = np.minimum(np.asarray(mask, np.float32) / 255, np.asarray(cap_a, np.float32) / 255)
    core = Image.fromarray((m * 255).astype(np.uint8)).resize((N, N), Image.LANCZOS)
    c = np.asarray(core, np.float32) / 255
    halo = np.asarray(core.filter(ImageFilter.GaussianBlur(7)), np.float32) / 255
    halo2 = np.asarray(core.filter(ImageFilter.GaussianBlur(18)), np.float32) / 255
    bar = np.asarray(base, np.float32) / 255
    rgbv = bar[..., :3].copy(); aa = bar[..., 3]
    g = np.array(glow_rgb, np.float32) / 255
    rgbv = np.clip(rgbv + g * (halo * bright + halo2 * .5 * bright)[..., None] + (c * 1.0)[..., None], 0, 1)    # 틈에서 빛이 샌다
    rgbv = np.clip(rgbv + np.array([1, 1, 1], np.float32) * (c ** 2 * bright * .6)[..., None], 0, 1)
    out = np.dstack([rgbv, aa])
    return out

def make_cracks():
    for src, name, n, rgb, br, seed in (('capsule-uq.png', 'capsule-uq-crack1.png', 5, (200, 150, 255), .9, 1),
                                         ('capsule-ep.png', 'capsule-ep-crack1.png', 5, (255, 190, 90), 1.0, 2),
                                         ('capsule-ep.png', 'capsule-ep-crack2.png', 9, (255, 215, 130), 1.5, 3)):
        out = crack_overlay(src, n, rgb, br, seed)
        Image.fromarray((out * 255).astype(np.uint8), 'RGBA').save(os.path.join(OUT, name), optimize=True); print(f'  {name}')

def make_shards():
    base = Image.open(os.path.join(OUT, 'capsule-r.png')).convert('RGBA')                      # 재질 샘플(등급 색은 코드가 바꾼다)
    for i in range(1, 9):
        r = random.Random(100 + i); S = 128
        n = r.choice((3, 3, 4, 5)); cxs = r.uniform(.3, .7) * 640; cys = r.uniform(.3, .7) * 640
        crop = base.crop((int(cxs - 80), int(cys - 80), int(cxs + 80), int(cys + 80))).resize((S * 2, S * 2), Image.LANCZOS)
        m = Image.new('L', (S * 2, S * 2), 0); d = ImageDraw.Draw(m)
        pts = []
        for k in range(n):
            a = k * 2 * math.pi / n + r.uniform(-.4, .4); rad = r.uniform(.28, .48) * S * 2; pts.append((S + math.cos(a) * rad, S + math.sin(a) * rad))
        d.polygon(pts, fill=255)
        edge = m.filter(ImageFilter.MaxFilter(5)); edge = np.asarray(edge, np.float32) / 255 - np.asarray(m, np.float32) / 255
        arr = np.asarray(crop, np.float32) / 255
        arr[..., :3] = np.clip(arr[..., :3] * 1.1 + edge[..., None] * 1.0, 0, 1)
        arr[..., 3] = np.maximum(np.asarray(m, np.float32) / 255 * arr[..., 3].clip(.9, 1), edge * .9)
        Image.fromarray((arr * 255).astype(np.uint8), 'RGBA').resize((S, S), Image.LANCZOS).save(os.path.join(FX, f'shard-{i}.png'), optimize=True)
    print('  shard-1..8.png')

if __name__ == '__main__':
    print('마법진'); make_runes()
    print('소용돌이 · 햇살'); make_swirl_energy(); make_swirl_cloud(); make_ray_burst()
    print('빛'); make_flare(); make_meteor(); make_particles()
    print('캡슐'); make_capsules(); make_cracks(); make_shards()
