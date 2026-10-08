# ROWAR 실전 효과음

- 출처: Claude의 `proto/juice/sfx/*.wav`, Stable Audio 3 생성·사용자 선택. 상세 인계: `docs/handoff/2026-10-08-juice-to-ui.md`.
- **2026-10-08 용량 정리** — 게임에는 원본 WAV 를 **MP3 128kbps(44.1kHz 스테레오)** 로 바꿔 싣는다(5.1MB → 0.55MB · 길이 같음). 원본 WAV 와 raw 는 `proto/juice/sfx/` 에 그대로 둔다.
- 새 소리를 넣을 때 — `proto/juice/sfx/<이름>.wav` 를 두고 `sh tools/sfx_encode.sh` 를 돌리면 이 폴더의 MP3 를 다시 만든다(ffmpeg 필요).
- 재생: `js/audio.js`, 전투 표시 사건 매핑: `js/audio-events.js`. 상단 **소리**에서 음량/음소거/시험 재생. 기본 음량45%, 첫 사용자 입력 전 다운로드·자동 재생 없음.
- `node tools/audio-check.mjs`가 31개 이름 · MP3 헤더 · 원본 WAV 보존을 검사한다. 수치·판정·재화·API에는 영향이 없다.
