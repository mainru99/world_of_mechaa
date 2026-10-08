# 공격 자료 저장·원격 통합·공개 시범 배포 — 2026-10-08

사용자 승인: “어제 효과음 작업 자료와 움직임 자료를 잘 저장하고 커밋, 푸시, 배포”.

## 자료 구분과 보존

- 출발 로컬 main80beea0, 어제 원격 main6d5ab77(13개 새 커밋).
- 공격 생성 원본·반려본·프롬프트·출력·6프레임 재생/검사를 **26ca717**에 먼저 저장했다. 원격13개는 **1b69bad**로 충돌 없이 병합했다. 강제 푸시·재작성·자료 덮어쓰기 없음.
- `proto/juice/`와 `assets/gacha/`, 효과음/뽑기 인계, 코어 서킷 전문 별·전선 단추는 원격6d5ab77과 내용 동일. 다듬은 효과음31종과 원본31종 모두 보존.
- 공격 출력은 `assets/effects/motion-*.png`, `assets/motions/attack/`, `assets/motions/sequence/azure-dagger-v1/`.
- 공격 생성 원본/반려본/프롬프트는 `docs/art/attack-motion-sources/`, `attack-motion-rejected/`, `*-prompts-2026-10-08.json`; 엔진/미리보기/인계는 각각 `js/pose-sequence.js`, `docs/art/`에 보존.
- 사용자 미추적 기체 복사 PNG5개와 Python 캐시는 건드리거나 커밋/배포하지 않는다.

## 배포 범위

공개 공격 시범 HTML3개만 빌드 목록에 명시한다. docs 전체·인계서·프롬프트·생성 원본·반려 기록·proto/juice 및 효과음 원본은 배포하지 않는다. 공격/뽑기 출력 에셋은 기존 assets 빌드 범위로 포함된다.

공개 경로:
- `/docs/art/azure-dagger-sequence-preview.html`
- `/docs/art/attack-motion-preview.html`
- `/docs/art/attack-motion-review.html`

**실제 전투 화면에는 새 모션·Juice·소리를 연결하지 않는다.** 효과음 설정, 성장 연출 통합, 전투 타임라인/판 길이, 캡슐/유성·건너뛰기, 프레임 정밀 보정은 별도 후속 과제다. 기존 운영 수정(전문 별·전선 단추)은 원격대로 함께 유지한다. DB/서버/판정/수치/스위치 변경 없음.

## 배포 전 운영 기준과 검사

운영 직전 Worker **cd3fcb5d-b388-4c37-a719-15dc249b6281**(100%). health200 /DB connected /schema25 /16tables /35accounts /35arena /balance o282jp. 운영 DB 쓰기/이관은 하지 않는다.

검사:
- `node tools/release-check.mjs`: 통합 UI/도메인37종 순차 검사.
- 난투 UI/전송/시뮬레이터/규칙, `pose-sequence-check`204개, `spritecheck all`, `check-motion-art`, `export-azure-sequence --check`.
- 깨끗한 검수 checkout에서 `npm run build`와 `node tools/motion-release-check.mjs`: 공개3페이지/공격 출력 내용 일치·내부자료 제외·효과음31+31 보존 검사.
- `tools/release-smoke.mjs`는 공개3페이지/움직임 PNG/WebP/데이터/뽑기 출력까지 내용·해시를 비교하고 비공개 경로404·보호 API401·health를 확인하도록 확대했다. 운영 계정 생성/소비/보상/전투는 실행하지 않는다.

검사·푸시·배포의 최종 결과는 아래 완료 기록을 추가한다. 검사 실패 시 배포하지 않는다.

## 복구와 이어받기

코드/정적 자산 문제가 발생하면 확인 후 직전 Worker cd3fcb5d-b388-4c37-a719-15dc249b6281로 복구할 수 있다. 이번 작업에 DB 이관이 없으므로 DB 역이관을 하지 않는다. 복구 명령은 정상 배포에서 실행하지 않는다.

```powershell
node node_modules/wrangler/bin/wrangler.js rollback cd3fcb5d-b388-4c37-a719-15dc249b6281 --message "Restore pre motion preview release" --yes
```

다음 작업 기준: [공격 인계](azure-dagger-sequence-handoff-2026-10-08.md), [Claude Juice 인계](../handoff/2026-10-08-juice-to-ui.md). 두 시스템의 공격 예비동작/원거리 연출을 실전에 중복 연결하지 말 것.
