"""게임 그림 PNG → WebP 변환 (2026-10-08 용량 정리 · 사용자 결정).

  python tools/webp_assets.py          assets 아래 대상 PNG 를 WebP 로 바꾸고 PNG 를 지운다(이미 바뀐 것은 건너뛴다)
  python tools/webp_assets.py --dry    무엇을 바꿀지만 보여 준다

규칙 — 새 그림은 지금처럼 PNG 로 받아(robot_art.py · story_art.py · 이미지 생성) assets 에 두고 이 도구를 돌린다.
  · 무손실(보이는 픽셀이 원본과 1:1 · exact) — 기체 assets/<id> · 몬스터 · 파츠 · 재화 아이콘 · 이그니스 레인 아틀라스 · 유성 그림
  · 손실 q90(알파는 무손실) — 뽑기 캡슐(core-capsule · capsule-*) · 영토 지도. 픽셀아트가 아니고 크기가 커서
  · 건드리지 않음 — assets/motions/** · assets/effects/motion-*(공격 모션 매니페스트 · spritecheck 가 PNG 로 관리) ·
    이름에 공백이 든 파일('… - 복사본.png' 같은 사용자 사본)
무손실은 변환 뒤 다시 읽어 RGBA 가 원본과 같은지 확인하고, 다르면 PNG 를 지우지 않고 멈춘다.
"""
import sys
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
A = ROOT / 'assets'
LOSSY = {'core-capsule.png', 'territory-map-v2.png'}
SKIP_DIRS = {A / 'motions', A / 'models'}


def lossy(p: Path) -> bool:
    return p.name in LOSSY or (p.parent == A / 'gacha' and p.name.startswith('capsule-'))


def targets():
    for p in sorted(A.rglob('*.png')):
        if ' ' in p.name or any(d in p.parents for d in SKIP_DIRS): continue
        if p.parent == A / 'effects' and p.name.startswith('motion-'): continue
        yield p


def main(argv):
    dry = '--dry' in argv
    before = after = 0
    for p in targets():
        out = p.with_suffix('.webp')
        im = Image.open(p); im.load()
        mode = 'RGBA' if im.mode in ('RGBA', 'LA', 'P') else 'RGB'
        im = im.convert(mode)
        kind = 'q90' if lossy(p) else 'lossless'
        if dry:
            print(f'{kind:8} {p.relative_to(ROOT)}'); continue
        if kind == 'q90': im.save(out, 'WEBP', quality=90, alpha_quality=100, method=6)
        else: im.save(out, 'WEBP', lossless=True, quality=100, method=5, exact=True)
        if kind == 'lossless':
            back = Image.open(out).convert(mode)
            if back.tobytes() != im.tobytes():
                out.unlink(); sys.exit(f'무손실 검증 실패 — {p} (PNG 는 그대로 둔다)')
        before += p.stat().st_size; after += out.stat().st_size
        print(f'{kind:8} {p.relative_to(ROOT)}  {p.stat().st_size // 1024}K → {out.stat().st_size // 1024}K')
        p.unlink()
    if not dry and before:
        print(f'합계 {before / 1e6:.2f}MB → {after / 1e6:.2f}MB ({after / before * 100:.0f}%)')


if __name__ == '__main__':
    main(sys.argv)
