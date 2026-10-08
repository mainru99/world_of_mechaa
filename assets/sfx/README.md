# ROWAR 실전 효과음

- 출처: Claude의 `proto/juice/sfx/*.wav`, Stable Audio 3 생성·사용자 선택. 상세 인계: `docs/handoff/2026-10-08-juice-to-ui.md`.
- 이 폴더는 게임 배포용으로 복사한 31개 trimmed WAV다. 원본과 바이트 동일하며 합성음 대체는 없다. raw 및 시험대는 원래 경로에 보존한다.
- 재생: `js/audio.js`, 전투 표시 사건 매핑: `js/audio-events.js`. 상단 **소리**에서 음량/음소거/시험 재생. 기본 음량45%, 첫 사용자 입력 전 다운로드·자동 재생 없음.
- `node tools/audio-check.mjs`가 31개 이름·WAV 헤더·원본 SHA256 일치를 검사한다. 수치·판정·재화·API에는 영향이 없다.
