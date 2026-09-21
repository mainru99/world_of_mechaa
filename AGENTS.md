# 협업 작업 안내

작업 전에 `CONTRACT.md`의 담당 범위와 최신 요청/완료 상태를 읽는다. 사용자 지시가 우선한다.

- ChatGPT: 캐릭터 이미지, 기체/몬스터 데이터, 전투 밸런스. 데이터 분리 후 `data/balance.js` 및 `assets/` 담당.
- Claude: 프론트엔드, 백엔드, 모듈 분리와 데이터 소비 로직.
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
