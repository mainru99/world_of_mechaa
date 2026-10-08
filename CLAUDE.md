# Claude 협업 안내

작업 전에 `AGENTS.md`와 `CONTRACT.md`를 읽는다. 밸런스 관련 요청이 오면 `BALANCE.md`(ChatGPT 작업 지시서)를 먼저 보고, 수치는 그쪽으로 넘긴다. Claude는 프론트엔드·백엔드와 모듈 통합, ChatGPT는 캐릭터 이미지·기체/몬스터 스펙·밸런스를 담당한다. 최신 요청과 완료 커밋은 `CONTRACT.md`에 남긴다.

**화면 파일 동결은 2026-10-08 사용자 결정으로 끝났다.** UI 개편 브랜치를 main 에 합친 뒤(09-30)라 더 지킬 이유가 없다 — main 에서 화면(`index.html` · `style.css` · `themes/` · `js/game.js` · `js/ui/`)도 고친다.
작업 시작 전과 푸시 전에는 늘 `git pull --ff-only` 로 GitHub 과 맞춘다(집 · 회사 두 PC 를 오간다). 규칙 전문은 `AGENTS.md` 'main 작업 원칙'.
