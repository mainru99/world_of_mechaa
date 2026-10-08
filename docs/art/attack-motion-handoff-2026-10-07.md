# 공격 모션 시범 인계 — 2026-10-07

상태(2026-10-08): **이펙트3종·KESTREL 승인 / AZURE 단검 후보 선택·최종 자세 승인 대기**.
CONTRACT의 최신 Claude 인계대로 1단계만 제작했다. 커밋·푸시·배포·게임 화면 연결은 하지 않았다.

## 파일

- 이펙트: `assets/effects/motion-slash.png`, `motion-cannon.png`, `motion-status-a.png` — 각 1024×1024 RGBA, 정사각 2×2.
- 자세: `assets/motions/attack/azure.png`, `kestrel.png` — 440×420 RGBA, 원본 키100%, 발끝 y407, dx0/dy0.
- 생성 원본5장: `docs/art/attack-motion-sources/`. 기존 기체 원본 PNG는 덮어쓰지 않았다.
- 초기 전체 프롬프트/단검 수정 지시 요약/생성 방식/참고 원본/출력 변환/SHA-256/검사 값: [attack-motion-assets.json](attack-motion-assets.json). 검 수정2회의 정확한 프롬프트 원문은 이 기록에 남지 않아 요약과 구분했다.
- [원본 비교](attack-motion-review.html) · [실제 엔진 재생](attack-motion-preview.html).
- `tools/export-motion-art.py`: 생성 대체가 아닌 규격 출력 도구. 이펙트 칸별 균일 축소, 64픽셀 격자, 8논리픽셀 여백, 시트 전체 최대8색, 이진 알파, 최근접 확대. 상태는 파랑/초록/빨강/보라 2색씩 유지한다. 자세는 원본 높이에 맞춘 균일 최근접 축소와 투명 캔버스 배치만 한다.
- `tools/check-motion-art.py`: 기존 검사에 더해 시트 전체8색·이진 알파·정확한 격자를 검증.
- `js/motion-assets.js`는 `spritecheck.py all --write`로만 생성했다.

## 원본 보존 / 승인 항목

내장 image_gen(imagegen 스킬)로 이펙트는 신규 생성, 자세는 **각 원본 PNG를 참고 입력으로 넣은 편집**으로 만들었다.
AI 편집이므로 관절/장갑의 모든 픽셀이 원본과 동일하다고 주장하지 않는다. 이펙트3종과 KESTREL 자세는 승인되었다.
AZURE의 맨손 자세는 품새처럼 보인다는 이유로 반려되었다. 사용자 지시로 검을 추가했고, 긴 검 대신 단검 후보가 선택되었다. 최종 자세 승인은 별도 대기. 참격 분류/판정 불변.
반려된 맨손 출력/생성 원본은 `docs/art/attack-motion-rejected/azure-unarmed.png`, `azure-unarmed-source.png`로 보존했다. 기본 `assets/azure.png`는 그대로다.
KESTREL과 이펙트3종은 승인본에서 수정하지 않았으며 해시가 일치한다.

## 검사 결과

`python tools/spritecheck.py all --write`: 이펙트3장 + 자세2장 모두 통과, 아트 경고 없음.
`python tools/check-motion-art.py`: 전체 통과. 투명 영역 참격87.7% / 포격81.6% / 상태82.1%, 반투명0%, 최소 여백12.5%.
단검 교체 후 자세 겹침/색 분포 겹침: AZURE0.560/83.0%, KESTREL0.640/94.0%. 동일 디자인이나 사용자 승인 증거는 아니다. 원본 키100%, dx0/dy0, 발끝 y407, 경고0.
Pillow12.3의 getdata 폐기 예정 경고는 실행 실패가 아니다. Claude 검사 도구는 수정하지 않았다.

초기 시범 당시 1200px PC / 390px viewport에서 실제1:1 사건 재생 종료(1/2/4배속), 0.5배속 스킬 자세·참격·포격, 좌우 기체 교체, 상태 A 연출 확인. 이는 단검 교체 이전 기록이다.
새 자세 src와 naturalWidth440을 DOM으로, 새 도트 이펙트를 화면으로 확인했다. 가로 넘침/로드 실패/브라우저 warn·error 없음.
실제 휴대전화·운영 계정 검사나 모든 전투 사건 자동 검증을 뜻하지 않는다.

2026-10-08 단검 교체 후 재확인: 비교 화면의 단검과 승인본 표시, 이미지 실패0/가로 넘침 없음. 실제 재생 미리보기 0.5배속 스킬에서 `assets/motions/attack/azure.png?v=1791415679` 자세 전환을 DOM으로 확인했고 브라우저 warn/error0. 초기 전 범위 PC/모바일 검사를 다시 실행했다는 뜻은 아니다.

## 미리보기 경로 보정

기존 문서에서 manifest의 `assets/...`가 `docs/art/assets/...`로 해석돼 그림 대신 대체 연출로 돌았다.
CONTRACT에 범위를 먼저 기록하고 `attack-motion-preview.html`에 `<base href="../../">` 한 줄만 추가했다.
엔진 `js/motion.js`, Claude 검사, sim/joint/brawl 판정, 서버/DB/밸런스, 기존 기체 원본은 수정하지 않았다.

## 재개 / 다음 담당

리포 루트에서:
```powershell
$env:PYTHONDONTWRITEBYTECODE='1'
python tools/spritecheck.py all --write
python tools/check-motion-art.py
node tools/motion-art-preview.mjs 8124
```
로컬 비교: http://127.0.0.1:8124/docs/art/attack-motion-review.html
재생: http://127.0.0.1:8124/docs/art/attack-motion-preview.html
제한된 정적 파일만 127.0.0.1에서 제공하며 API/운영 DB에 연결하지 않는다. node 미리보기는 켜 두었다.
규격서의 Python HTTP 서버는 연결 대기로 확인되지 않아 중지하고 위 대체 서버를 썼다.

1. 사용자: AZURE 단검 자세 최종 승인 또는 추가 수정 지시. 이펙트3종·KESTREL은 이미 승인.
2. 승인 뒤 GPT: 범위 파일만 명시해 커밋, 규격서5절 전투 화면 연결. 원격 반영/운영 배포 권한은 별도 확인.
3. Claude: 엔진/검사 기준 유지. 위 경로 보정과 결과 참고.
4. 후속: shot/missile/beam/smash/thrust/status-b 이펙트6종, 사용자 선택 기체부터 자세 확대.

사용자 미추적 기체 복사본 PNG5개는 보존하고 스테이징하지 않았다.

## 이후 사용자 승인 — 2026-10-08

단검6프레임 시범과 어제 효과음 자료를 보존하여 커밋·푸시·배포하도록 승인했다. [새 연속 자세](azure-dagger-sequence-handoff-2026-10-08.md), [원격 통합·공개 시범 배포 기록](motion-release-2026-10-08.md)을 따른다. 위 승인/커밋/배포 대기는 당시 상태이며 실전 화면 연결과 후속 품질 보정은 별도다.
