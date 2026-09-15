# 협업 작업 안내

작업 전에 `CONTRACT.md`의 담당 범위와 최신 요청/완료 상태를 읽는다. 사용자 지시가 우선한다.

- ChatGPT: 캐릭터 이미지, 기체/몬스터 데이터, 전투 밸런스. 데이터 분리 후 `data/balance.js` 및 `assets/` 담당.
- Claude: 프론트엔드, 백엔드, 모듈 분리와 데이터 소비 로직.
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
