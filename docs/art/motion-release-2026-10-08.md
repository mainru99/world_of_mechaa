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

## 완료 기록 — GitHub와 운영

- 코드 커밋 **6856fbc**까지 main에 명시적으로 푸시했다. 생성 원본 보존26ca717 → 어제13커밋 병합1b69bad → 공개 시범 빌드899e8ac → CSP 경로 보완6856fbc.
- 서버 런타임/DB/판정/수치/기능 스위치는 불변. 빌드 목록과 모션 그림 URL 해석만 배포 호환성을 위해 보완했다. **CSP base-uri none을 유지**하고 두 페이지의 base를 제거, js/motion.js는 import.meta.url 기준으로 manifest 그림 경로를 해석한다. 자세 교체·복구 비교에도 같은 URL을 사용한다.
- 통합 회귀36종과 서킷 규칙·빌드20판 측정 통과. 기존 release-check 기본160판 승률 측정은60초 제한으로 종료됐으므로 전체 기본측정 완료로 표시하지 않는다. 판수20 옵션 재실행은76기/별2736 규칙 전부와29빌드 측정을 완료했다. 검사/수치 자체를 약화하거나 고치지 않았다.
- 별도 난투 UI/전송/시뮬레이터/규칙, 자세 재생204개, 그림5종, 6프레임 PNG/시트/WebP, 모듈 기준 URL 경로 검사 통과. 원본/승인 에셋 해시 보존.
- 깨끗한 `C:/Users/user/Desktop/dev/rowar/.tmp/motion-release-20261008` checkout(6856fbc)에서 npm run deploy 성공. 정적20파일 신규 업로드,384파일 재사용. Worker **10089967-a809-443b-b2e1-a4deaec5f568**. D1 연결·스마트 배치·크론2개 유지, DB 이관 없음.
- 운영 검증137파일 일치·오류0. 공개3페이지/PNG/WebP/manifest·자세 모듈/뽑기 출력 포함. 비공개8경로404, 보호 API8경로401. health200 /DB connected /schema25 /16tables /35accounts /35arena /balance o282jp. bind=true /lineage=true, 난투 off 유지.
- 실제 운영 브라우저0.5배속에서 **1→2→3→4→5→6 · 접촉1회** 확인. 이미지 실패0/가로 넘침0/콘솔 경고·오류0. 접촉 프레임 화면을 저장했다. 실기기 모바일/OS 모션 줄이기/효과음 실전 연결 검수는 수행하지 않았다.
- 배포 후 최신 origin/main과 로컬 main이0/0임을 확인했다. 아래 보고서/상태/증빙만 보태는 후속 문서 커밋은 배포 앱 소스를 바꾸지 않으므로 다시 배포하지 않는다.
- 사용자 PNG 복사본5개·Python 캐시는 미추적 상태로 그대로 보존하며 이번 커밋/배포 대상이 아니다.

[공개 단검6프레임](https://rowar.hun7539.workers.dev/docs/art/azure-dagger-sequence-preview.html) · [공개 원본 비교](https://rowar.hun7539.workers.dev/docs/art/attack-motion-review.html) · [기존 단일 자세 재생](https://rowar.hun7539.workers.dev/docs/art/attack-motion-preview.html)

검수 원자료: [파일/API 보고서](../ui/previews/release-verification-2026-10-08-motion.json), [운영 시범 화면](../ui/previews/motion-release-2026-10-08.png).
