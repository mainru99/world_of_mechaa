# 협업 작업 안내

작업 전에 `CONTRACT.md`의 담당 범위와 최신 요청/완료 상태를 읽는다. 사용자 지시가 우선한다.

- ChatGPT: 이번 UI 개편의 기획·프론트 디자인·프론트 구현·시각 검수 담당. `index.html`, `style.css`, `themes/`, `js/game.js`, 신규 UI 모듈과 에셋을 맡는다. 기존 캐릭터/밸런스 담당도 유지하되 완료된 밸런스는 이번 개편에서 변경하지 않는다.
- Claude: 백엔드·DB·인증·서버 판정·API 호환성 담당. 프론트 지원이 필요하면 `CONTRACT.md`에 파일 단위로 조율한다.
- 2026-09-20 사용자 지시: UI 개편은 `codex/ui-rebuild` 브랜치와 별도 작업 공간에서 한다. 기본 브랜치(main/master)에 직접 적용하거나 운영 배포하지 않는다.
- 이어받기: `docs/ui/IMPLEMENTATION.md`를 먼저 읽고 작업/검수/남은 사항을 갱신한다. 프론트 제작은 ultra 유지 요청이며 이후 high 전환에도 같은 품질 기준과 검수 항목을 적용한다. 실행 설정을 실제로 바꾸지 않았다면 바꿨다고 보고하지 않는다.
- 상대 담당 파일을 수정해야 하면 먼저 `CONTRACT.md`에 요청하고 조율한다.
- 같은 체크아웃에서 상대 변경을 되돌리거나 섞어 커밋하지 않는다. 커밋할 파일을 명시한다.
- 몬스터는 대전 전용이며 뽑기/소유 기체 목록에는 포함하지 않는다. 기존 기체 ID와 저장 호환성을 보존한다.

밸런스 수치는 ChatGPT 담당이다. 작업 지시와 측정 절차는 `BALANCE.md` 에 있다.

## Web ChatGPT Git writer

When the Web ChatGPT Git writer app is selected, Web ChatGPT is the primary autonomous coding agent.
It must translate the user's natural-language request into a complete implementation without waiting
for another orchestrator. It must read this file, investigate and reproduce material findings, change
every required source and directly related test, critically inspect the complete diff, run all applicable
checks, fix failures, commit and push only chatgpt/*, create or update a pull request, and squash-merge it
after required checks pass. It must not impose arbitrary file-count or scope limits.
It must never push directly to main, force-push, delete branches, expose secrets, weaken tests,
or modify protected repository, workflow, credential, or writer files.
