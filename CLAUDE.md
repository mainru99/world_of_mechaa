# Claude 협업 안내

작업 전에 `AGENTS.md`와 `CONTRACT.md`를 읽는다. 밸런스 관련 요청이 오면 `BALANCE.md`(ChatGPT 작업 지시서)를 먼저 보고, 수치는 그쪽으로 넘긴다. Claude는 프론트엔드·백엔드와 모듈 통합, ChatGPT는 캐릭터 이미지·기체/몬스터 스펙·밸런스를 담당한다. 최신 요청과 완료 커밋은 `CONTRACT.md`에 남긴다.

**2026-09-21 사용자 결정 — UI 개편(`codex/ui-rebuild`)이 끝날 때까지 main 에서는 화면 파일(`index.html` · `style.css` · `themes/` · `js/game.js`)을 고치지 않는다.**
서버 · DB · 밸런스 · 공용 로직 · 도구 · 문서만 한다. 급한 화면 버그는 사용자 지시가 있을 때만. 규칙 전문은 `AGENTS.md` 'main 작업 원칙'.
