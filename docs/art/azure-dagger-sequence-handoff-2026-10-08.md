# AZURE 단검 6프레임 베기 — 시범 인계 · 2026-10-08

## 완료 범위와 승인 상태

사용자 지시 “실제 휘두르는 애니메이션을 시험하고 필요하면 다른 AI와 협의”에 따라 제작한 **독립 시범**이다. 준비 → 당기기 → 베기 시작 → 접촉 → 후속 → 복귀의 다른 자세 6장을 재생한다. 단일 자세를 흔들거나 참격 이펙트만 움직이는 방식이 아니다.

- 사용자 디자인 승인 대기. 게임 화면 연결·커밋·푸시·배포하지 않았다.
- 기존 AZURE 원본, 선택한 단검 단일 자세, KESTREL 승인 자세, 승인 이펙트 3종과 반려 기록을 보존했다.
- 기존 엔진 `js/motion.js`, 검사 도구 `tools/spritecheck.py`, 생성 manifest는 이번 시범에서 수정하지 않았다. 판정·시뮬레이터·서버·DB·밸런스 불변.
- 사용자 PNG 복사본 5장 및 다른 작업의 미커밋 변경은 보존했다.

## 파일

- [독립 재생 페이지](azure-dagger-sequence-preview.html): 한 번/3연속/반복/정지, 0.5·1·2·4배속, 좌우 방향, 이펙트 선택, 개별 프레임/슬라이더.
- [출력 시트](../../assets/motions/sequence/azure-dagger-v1/atlas.png): 1320×840, 3×2칸.
- [애니메이션](../../assets/motions/sequence/azure-dagger-v1/preview.webp): 0.5배속 무손실 WebP, 6프레임/800ms 반복.
- `assets/motions/sequence/azure-dagger-v1/frame-01.png`~`frame-06.png`: 각각 440×420 RGBA.
- [데이터·SHA256](../../assets/motions/sequence/azure-dagger-v1/sequence.json): 원본/생성 원본/각 프레임/시트 해시.
- [정확한 생성 프롬프트·참고 역할·내보내기 기록](azure-dagger-sequence-prompts-2026-10-08.json).
- 생성 원본 `docs/art/attack-motion-sources/azure-dagger-sequence-v1.png`.
- `js/pose-sequence.js`: 독립 캔버스 자세 재생, 로딩/취소/배속/좌우/모션 줄이기/dispose.
- `tools/pose-sequence-check.mjs`: 가짜 시계·RAF·이미지로 재생 상태 회귀 검사.
- `tools/export-azure-sequence.py`: 시트 분리·공통 정렬·PNG/WebP 출력 및 검사.
- `tools/motion-art-preview.mjs`: API/DB 없는 loopback 미리보기, 새 페이지·JSON·WebP 지원.

## 제작과 타이밍

imagegen 스킬을 따라 **내장 image_gen 편집 모드**를 사용했다. 원본 AZURE와 사용자가 고른 단검을 참고하여 6프레임을 만들고 투명도 정리 편집을 수행했다. 출력 도구는 그림을 새로 그리지 않는다.

공통 최근접 축척 0.774818401937046, 알파128 기준 이진화, 투명 픽셀 RGB0 정리. 프레임마다 크기를 따로 조절하지 않았다. 모든 발끝 y407, 공통 발 중심 x234. 칼끝 여백 때문에 원본보다 +18.197px 옮겼고 단검/안테나는 잘리지 않았다. 이 정렬이 장갑·발 디자인 자체의 일치까지 보장하지는 않는다.

| 프레임 | 자세 | 시작 ms | 길이 ms |
|---|---|---:|---:|
| 1 | 준비 | 0 | 70 |
| 2 | 당기기 | 70 | 70 |
| 3 | 베기 시작 | 140 | 40 |
| 4 | 접촉 | 180 | 50 |
| 5 | 후속 | 230 | 80 |
| 6 | 복귀 | 310 | 90 |

총400ms/1배속. 기존 참격 이펙트는 호출 뒤70ms에 접촉하므로 시범은110ms에 호출,180ms 접촉으로 맞춘다. 숨긴 브라우저/느린 RAF/4배속에서는 중간 프레임이 생략될 수 있다. 접촉 keyframe을 늦은 tick에서도 먼저 표시하도록 보완하고, 실제 판정과는 연결하지 않았다. 극심한 브라우저 지연까지 벽시계 기준 이펙트 동기화를 보장하는 구조는 아니며 실전 통합 시 사건 타임라인을 단일화해야 한다.

캔버스 기체에는 img 요소가 없어서 기존 엔진의 단일 자세 교체를 우회한다. 준비 자세를 시범 idle로 사용해 단검이 갑자기 사라지지 않도록 했다. 무장 준비와 기존 비무장 idle 사이 전환은 후속 과제다.

## AI 검토와 Claude 인계

별도 AI 2곳에 엔진/아트 검토를 요청했다. 엔진 검토는 독립 모듈·회귀 검사를 구현하고 지연 접촉 순서를 보완했다. 아트 검토는 날의 위→전방→아래 이동과 팔의 회전을 실제 베기 시범으로 판단했으나 아래 세부 불일치를 지적했다.

Claude와 직접 통신할 연결은 없으므로 `CONTRACT.md`에 요청/결과를 남겼다. **Claude가 읽거나 승인했다는 뜻은 아니다.**

### 디자인 검수에서 남은 것

1. 발 간격/장화 모양 고정: 정렬은 같지만 형태가 프레임마다 약간 다르다.
2. 프레임1과6의 정확한 일치: 반복 경계에서 미세한 점프.
3. 헬멧·가슴 패널과 장갑의 픽셀/색 블록 고정.
4. 단검 길이와 원근의 세부 일관성.

이 후보는 “6프레임 공격 동작 시범, 사용자 검수 필요”이지 최종 양산 에셋이 아니다. 사용자 반응을 보고 아트 정밀 보정을 진행한다.

### Claude 검토 요청

- 사용자 승인 후 연속 자세 데이터를 기존 엔진/manifest에 통합할지 결정.
- 실전 사건 타임라인에서 자세·VFX·타격을 같은 시계에 맞추기.
- 취소/교대/dispose/배속/접근성/다단 공격 처리와 준비→기본 idle 전환.
- 현재 독립 시범을 그대로 실전 판정으로 사용하지 말 것.

## 검수 및 재현

검사 실행:
```powershell
node tools/pose-sequence-check.mjs
node --check js/pose-sequence.js
node --check tools/motion-art-preview.mjs
python tools/export-azure-sequence.py --check
python tools/check-motion-art.py
git diff --check
```

- 출력 검사: 6 PNG/시트 해시·칸 일치, 440×420, 발끝407/공통x234, 이진 알파, 잘림·빈 칸·중복 자세, WebP6프레임/800ms와 표시 픽셀/알파 원본 일치 통과.
- 기존5종 검사 통과. 승인본4종 및 원본 해시 불변.
- 재생 회귀 **204개 통과**: 0.5·1·2·4배속, 프레임 경계, callbacks exactly once, 로딩 실패, 취소/교체/재시작, dispose/비동기 로딩 완료, 좌우, 모션 줄이기, 늦은 RAF/빠른 배속의 접촉 keyframe 보존·역행 방지.
- 브라우저: PC와390×844 viewport, 좌우, 프레임별 선택·반복·정지 후 재시작·3연속 완료 확인. 0.5배속에서6장 전체 관찰. 빠른 배속/숨긴 탭에서는 중간 자세 생략 가능.
- 수동 “자세 모션 줄이기”는 자세만 줄인다. 실제 OS reduced-motion 및 실기기 모바일 검수는 하지 않았다.
- 이미지 실패/가로 넘침/콘솔 오류 없이 표시. 정적 자동 검사는 프레임 간 디자인 일치를 판정하지 않는다.
- Pillow getdata 폐기 예고와 기존 manifest CRLF 변환 경고는 기능 실패가 아니다.

재출력:
```powershell
python tools/export-azure-sequence.py docs/art/attack-motion-sources/azure-dagger-sequence-v1.png
node tools/motion-art-preview.mjs 8124
```
로컬 URL: http://127.0.0.1:8124/docs/art/azure-dagger-sequence-preview.html

## 이후 사용자 승인 — 자료 저장·공개 시범 배포

2026-10-08 사용자가 어제 효과음 작업과 함께 보존·커밋·푸시·배포를 지시했다. 위 미커밋·미배포는 시범 제작 당시 상태다. [원격 통합·배포 최신 기록](motion-release-2026-10-08.md)을 따른다. 공개 승인과 프레임 정밀 보정/실전 엔진 통합 완료를 구별한다.
