# main 변경 확인 및 UI 통합 준비 · 2026-09-26

## 확인한 기준

- `git fetch origin` 후 운영 `main`/`origin/main`: `0ed5a54`.
- 직전 확인 `5c3ceff` 이후 main에 40개 커밋. 기존 읽기 전용 `rowar-main-20260921`은 당시 스냅샷이며 최신으로 오인하지 않는다.
- 작업 시작 시 UI `HEAD`/`origin/codex/ui-rebuild`: `57deeaa`, ahead/behind 0/0. 미커밋 파일은 이 대전 UI 작업의 9개 파일이었다.
- 원래 main 폴더에는 circuit 아트 문서/작업 폴더 5개가 untracked 상태다. 수정·삭제·스테이징하지 않았다.
- 읽기 전용 참고: `origin/main:docs/handoff/2026-09-23-main-to-ui.md`, `origin/main:docs/handoff/2026-09-25-main-to-ui.md`, main의 AGENTS/프론트 변경 diff.
- main과 UI 간 merge/rebase/cherry-pick/파일 반입 없음. 새 코드와 검수 도구는 UI 브랜치 안에서 작성했다.

## 지금 UI에서 보완한 것

1. `js/ui/recruitment.js`의 기체별 목록과 확률 분모에서 `story:true`를 제외한다. 현재 데이터의 결과는 그대로이고, 스토리 전용 기체가 추가돼도 획득 가능 목록/확률을 오염시키지 않는다. 검수 도구에서 가상 story 기체를 주입해 기존 기체별 확률이 유지됨을 확인한다.
2. 대전 시작 요청이 늦어질 때 버튼을 즉시 비활성화하고 '전투 준비 중…'을 표시한다. 실패하면 복구하며, 다른 화면의 새 버튼을 건드리지 않는다. 기존 공통 guard와 서버 판정을 유지한다.
3. 대전 표시는 별도 `js/ui/battle.js`와 `.bv-*` CSS에 둔다. main 소유 server/data/sim/stats에는 변경하지 않는다.

## 통합 전에 반드시 해야 할 것

**현재 UI 브랜치의 1:1 전투 코드를 최신 운영 API에 바로 연결하면 안 된다.** Git 텍스트 충돌이 없어도 런타임 호환성을 보장하지 않는다. 이 목록은 UI 완성 후 사용자가 통합을 지시했을 때의 필수 검수표다.

| 우선순위 | main 변경 | 영향을 받는 UI / 통합 때 확인할 것 |
|---|---|---|
| P0 | 일반·비상·친선의 교대 전투 활성화 | `startBattle`의 `r.relay`→신규 simulate bench 인자, `playBattle`의 swap 사건, 그림/이름/HP 최대치/SP 갱신, 건너뛰기 초기화, 둘째 경험치·피로도를 UID로 반영. 결과 두 줄. 준비 화면 `opponent.bench` 표시. 둘 다 2기일 때 교대이며 보스 합동전과 다름 |
| P0 | 보스 합동전·실시간 재생·전투 분석 | 현재 2:1 준비 배열을 실제 전위/후위 편성과 연결. 세 기 재생 HUD, 흘려내기·후위 사격, 전투 분석/공명. 지금의 2:1 fixture는 화면 배치만 검수 |
| P0 | 서버/공유 모듈 계약 | main의 서버·sim·stats·net를 같은 기준으로 연결. UI의 새 비동기 응답 격리/보상 한 번 반영을 함께 보존. 이탈/계정 변경/실패/건너뛰기 포함 검수 |
| P1 | 로그인 시 1장 도입 반복 수정 | `frontAfterState`, `_frontReady`, `playedAccount`, `syncOnConnectInner`, `afterLogin`, `openGate`. UI 첫 화면은 main의 hangar가 아닌 **home**. 대문 뒤 잘못된 스토리 재생 방지 |
| P1 | 코어 서킷 | 기체 객체의 circuit 필드 보존, 공유 computeStats 사용. 별 36개/전문 별/포인트, main의 좌표와 hand:true 보존. reset은 정제 코어1, 경고 후 확인. 현재 미구현 |
| P1 | 정제 코어 | `/api/state`의 state 밖 rcores, 합치기 API, 뽑기 세 번째 창구/확률/지갑. 현재 UI의 코어·크레딧 2종은 통합 전 기준 |
| P1 | 조각 회수·조각 합성·개발 목표 | 파견/지휘실의 일일 횟수, 작전 보상 목표와 개발 목표 구분, 보관함 합성 미리보기, 계보도 목표 설정·숙련 조각 |
| P2 | 기체 76종/긴 이름/새 원화/성장 곡선 | 목록 크기·확률·스토리 제외·성장 바·정지 PNG. IGNIS 대기 모션은 교체 예정이므로 임의 재생성 금지 |

## 충돌을 줄이는 작업 규칙

- 실행 전 현재 경로·브랜치·dirty 파일·upstream을 확인한다. UI 원격만 UI 폴더에서 갱신한다.
- main의 공용 모듈/API 변경은 계약만 읽고, UI 어댑터의 준비사항을 이 문서에 적는다. 브랜치 분리 중 없는 모듈을 무조건 import하거나 비활성 서버 기능을 작동하는 것처럼 보여 주지 않는다.
- `js/game.js`의 겹치는 고위험 자리: `startBattle`, `applyServerBattle`, `playBattle`, 결과 화면, `afterLogin`/전선 초기화. 임의 전체 파일 덮어쓰기 금지.
- 기존 기록의 '충돌 0'은 **그 시점의 커밋만** 의미한다. 이번 미커밋 대전 작업까지 포함한 진단은 체크포인트 커밋 후 별도 기록한다.
- 병합 진단에 `git merge-tree --write-tree`를 쓰는 것은 메모리/객체 수준의 시험이다. 생성 tree를 체크아웃하거나 브랜치에 적용하지 않는다. 실제 통합 승인과 구분한다.

다음 화면 작업은 파견 시안 대응이다. 새 조각 회수 기능과 합동 보스전이 들어갈 공간·진입 경로를 고려하되, 엔진/서버 연결은 위 통합 범위로 분리한다.

## 실제 Git 진단 결과

- 첫 대전 체크포인트 `02ee7fc`와 main `0ed5a54`의 `merge-tree --write-tree --name-only`: **js/game.js 충돌 1곳**. UI의 재생 이탈 보상 처리와 main의 `_fight=fight1(...)` 결과 분석 삽입이 같은 줄에 있었다.
- UI 수정 `b8f84c3`: 이탈/계정 검사를 `playBattleForAccount`로 분리했다. 정상 결과의 `applyServerBattle` 다음에는 기존처럼 main의 분석 처리가 들어갈 수 있다. main 코드나 분석 모듈을 UI에 복사하지 않았다.
- 재검사: `origin/main(0ed5a54)` + UI `b8f84c3`, **exit 0 / 텍스트 충돌 0**. 진단 tree `d4045f80cdac9391e23b056f6a0a99ce517905c2`만 생성했으며 체크아웃/실제 병합하지 않았다.
- 리팩터링 후 보상 한 번 반영·이탈·계정 변경·정상 결과·요청 로딩 회귀 검사 통과. 새 계약의 교대/합동전 런타임 검증은 여전히 통합 때 필요하다.
- 이후 UI 또는 main이 바뀌면 이 결과를 재사용하지 말고 새 커밋 쌍으로 검사한다.

## 2026-09-27 파견 체크포인트

- `origin/main`을 다시 조회한 결과 `0ed5a54` 그대로다. UI `b0440cd`와 `origin/main`의 `git merge-tree --write-tree --name-only`는 exit 0, 텍스트 충돌 0, 진단 tree `25a429f75ec04594e34cb3cca8e82bfe5dfde1dc`였다. 실제 병합이나 main 체크아웃 변경은 없다.
- [52개 커밋별 제목·경로 점검](main-commit-audit-2026-09-27.md)을 남겼다. 이 결과는 코드/그림 전체 줄 단위 검토나 운영 API 호환성 확인을 뜻하지 않는다. 특히 교대·합동 전투, 코어 서킷, 정제 코어, 조각 회수/합성은 통합 단계의 검수 항목이다.
