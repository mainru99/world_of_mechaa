# 협업 작업 안내

## 2026-09-29 사용자 지시 — 리빌드 기준 통합

- 리빌드 화면을 기준으로 main의 최신 기능을 연결하는 통합 작업을 시작한다. `codex/ui-integration`과 별도 작업 폴더에서 수행하며 원래 `codex/ui-rebuild`와 운영 `main`은 보존한다.
- 화면은 ChatGPT 주도, 서버/DB/판정은 main의 최신 구현을 유지한다. 상대 담당 로직 변경이 필요하면 CONTRACT에 요청/범위를 기록한다.
- 과거의 브랜치 분리/반입 금지는 원본 두 브랜치에 계속 적용한다. 이번 통합 브랜치에서의 승인된 병합에는 적용하지 않는다. 운영 main 반영과 배포는 이번 통합본 검수 후 별도 지시를 따른다.

작업 전에 `CONTRACT.md`의 담당 범위와 최신 요청/완료 상태를 읽는다. 사용자 지시가 우선한다.

## 브랜치별 작업 원칙 — 2026-09-21 사용자 확정

- `codex/ui-rebuild`: ChatGPT가 메인, Claude가 서브. UI 개편 작업은 이 브랜치와 전용 작업 폴더에서 진행한다.
- 운영 `main`: Claude가 메인, ChatGPT가 서브. 아래 파일별 담당은 이 브랜치의 협업 참고이며 main의 주도권을 바꾸지 않는다.
- UI 개편이 완성되기 전에는 main과 합치지 않는다. 양방향 merge/rebase/cherry-pick 또는 다른 브랜치 파일의 수동 덮어쓰기로 자료를 섞지 않는다. 향후 통합은 사용자의 별도 지시에 따른다.
- 회사/집에서 내려받기 전에 경로·현재 브랜치·미커밋 변경·upstream을 확인한다. 각 브랜치는 같은 이름의 원격 브랜치에서만 갱신하고, 푸시는 대상 브랜치를 명시한다. 다른 브랜치의 변경은 읽기 전용 참고만 한다.
- main의 새 기능·기체를 UI 브랜치에 자동 반입하지 않는다. 기능과 시안이 충돌하거나 변경 결정이 필요하면 사용자에게 묻는다.

- ChatGPT: 이번 UI 개편의 기획·프론트 디자인·프론트 구현·시각 검수 담당. `index.html`, `style.css`, `themes/`, `js/game.js`, 신규 UI 모듈과 에셋을 맡는다. 기존 캐릭터/밸런스 담당도 유지하되 완료된 밸런스는 이번 개편에서 변경하지 않는다.
- Claude: 백엔드·DB·인증·서버 판정·API 호환성 담당. 프론트 지원이 필요하면 `CONTRACT.md`에 파일 단위로 조율한다.
- 2026-09-20 사용자 지시: UI 개편은 `codex/ui-rebuild` 브랜치와 별도 작업 공간에서 한다. 기본 브랜치(main/master)에 직접 적용하거나 운영 배포하지 않는다.
- 이어받기: `docs/ui/IMPLEMENTATION.md`를 먼저 읽고 작업/검수/남은 사항을 갱신한다. 프론트 제작은 ultra 유지 요청이며 이후 high 전환에도 같은 품질 기준과 검수 항목을 적용한다. 실행 설정을 실제로 바꾸지 않았다면 바꿨다고 보고하지 않는다.
- 상대 담당 파일을 수정해야 하면 먼저 `CONTRACT.md`에 요청하고 조율한다.
- 같은 체크아웃에서 상대 변경을 되돌리거나 섞어 커밋하지 않는다. 커밋할 파일을 명시한다.
- 몬스터는 대전 전용이며 뽑기/소유 기체 목록에는 포함하지 않는다. 기존 기체 ID와 저장 호환성을 보존한다.

밸런스 수치는 ChatGPT 담당이다. 작업 지시와 측정 절차는 `BALANCE.md` 에 있다.

## main 작업 원칙 — 2026-09-21 사용자 결정

- **주도권** — 운영 `main` 은 Claude 메인 · ChatGPT 서브, UI 개편 브랜치 `codex/ui-rebuild` 는 ChatGPT 메인 · Claude 서브.
  위 파일별 담당은 main 안의 협업 참고이며 이 주도권을 바꾸지 않는다.
- **UI 개편이 끝날 때까지 두 브랜치를 합치지 않는다** — 어느 방향이든 merge · rebase · cherry-pick · 파일 복사 금지. 통합은 사용자 지시로 따로 한다.
- **화면 파일 동결** — 그동안 main 에서 `index.html` · `style.css` · `themes/` · `js/game.js` 를 고치지 않고 `js/ui/` 를 만들지 않는다.
  UI 브랜치가 같은 파일을 새로 짜고 있어서, main 이 보탠 화면은 통합 때 충돌하거나 새 화면에 다시 만들어야 한다.
  - 예외는 사용자가 지시한 급한 버그뿐이다. 가장 적은 줄로 고치고 `CONTRACT.md` '화면 파일 동결' 절에 파일 · 함수 · 고친 줄을 적는다 — 통합 때 UI 브랜치에 다시 넣어야 한다.
- **main 에서 계속 하는 것** — `server/*` · DB 이관 · `data/balance.js` · `assets/` · DOM 없는 공용 모듈(`js/sim.js` · `js/joint.js` 등) · `tools/` · 문서.
  공용 모듈의 인자나 API 응답 모양을 바꾸면 `CONTRACT.md` 에 입출력을 적는다 — UI 브랜치 화면이 그것을 읽는다.
- **화면이 필요한 새 기능**은 서버 · 로직까지만 main 에 넣고 화면은 UI 개편 뒤로 미룬다. 플레이어에게 보이는 것은 그다음이다.
- **내려받기 · 올리기** — 먼저 폴더 경로 · 현재 브랜치 · 미커밋 변경 · upstream 을 확인한다.
  각 브랜치는 같은 이름의 원격 브랜치에서만 받고, 푸시할 때는 대상 브랜치를 적는다(`git push origin main`).

## Web ChatGPT Git writer

When the Web ChatGPT Git writer app is selected, Web ChatGPT is the primary autonomous coding agent.
It must translate the user's natural-language request into a complete implementation without waiting
for another orchestrator. It must read this file, investigate and reproduce material findings, change
every required source and directly related test, critically inspect the complete diff, run all applicable
checks, fix failures, commit and push only chatgpt/*, create or update a pull request, and squash-merge it
after required checks pass. It must not impose arbitrary file-count or scope limits.
It must never push directly to main, force-push, delete branches, expose secrets, weaken tests,
or modify protected repository, workflow, credential, or writer files.
