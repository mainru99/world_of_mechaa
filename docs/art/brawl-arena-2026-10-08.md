# 난투 무대 배경 — 2026-10-08 · opencode(GPT) 생성 · 사용자 선택

- 최종: `assets/backgrounds/brawl-arena.webp` · 2048×1152 RGB WebP q88 · 57KB
  SHA-256 `de1709ad777e4692a4e5581ac984eec5b9122b71a8cdf8162e35ec57e36a869b`
- 원본: `docs/art/review/brawl-arena/pixel/px-1.png` (SHA-256 `a208487f82e13eac9f29cac8cd0b6614862a3a2ea1a8048e08866a7df20c7543`) · 시드 810081
- 생성: opencode `factchat-openai/gpt-6-astra` 가 Hugging Face `z_image_turbo` 로 그렸다. 프롬프트 전문 · 다른 후보의 기록은 `docs/art/review/brawl-arena/pixel/notes.md`
- 연결: `themes/brawl-v2.css` `.bs-stage` — `center 92%/cover`(아래 기준이라야 뒷줄 기체도 바닥을 딛는다)

## 고른 과정 (사용자 결정)

1. 1차 — 매끈한 3D 렌더 후보 3장. 구도는 맞았지만 사용자 판정 **"기체들과 배경이 너무 따로 논다"** — 기체는 도트 그림이라서.
   임시 시험으로 렌더를 뭉개 보니 더 붙었지만, **배경도 도트로 다시 그리기**로 했다.
2. 2차 — 도트 후보 4장(프롬프트는 `review/brawl-arena/pixel/notes.md`).
   - 1번 채택. 2층 난간이 둘러싼 어두운 경기장, 앞줄 아래에 청록 · 주황 바닥 조명, 홀이 좁아 기체가 작아 보이지 않는다.
   - 2번은 바닥 전체를 진영색으로 칠해 시끄럽고, 3번은 조명이 형광 얼룩, 4번은 금지한 사람 캐릭터가 들어가서 버렸다.
3. 같이 넣은 화면 처리(배경과 무관하게 유지) — 발밑 그림자 · 기체 밝기 한 단계 낮춤 · 진영색 테두리빛(`.bs-u::before` · `.bs-u img`).

**저장소에는 채택한 1번 원본만 올렸다**(사용자 결정 — 나머지 후보 · 비교 그림은 올리지 않음).

## 남은 아쉬움 — 다듬을 사람이 볼 것

- 픽셀 한 칸이 기체보다 조금 굵고, 뒷벽이 밋밋하다. 같은 이름 · 같은 비율(16:9)로 덮어쓰면 바로 바뀐다(CSS 의 `?v=` 를 올릴 것).
- 이 그림은 ChatGPT 내장 ImageGen 이 아니라 무료 Z-Image 로 그렸다(사용자 결정 '일단 1번으로').
