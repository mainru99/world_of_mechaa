# 용량 정리 — 그림 WebP · 효과음 MP3 · 안 쓰는 파일 · 캐시 · 2026-10-08 · Claude

사용자: "최적화가 필요한 시점" → 조사 보고 → **"전부 진행하고 ffmpeg 설치, 그림도 네 추천대로."**

## 결과

| 항목 | 전 | 후 |
|---|---|---|
| 배포본 `dist/` | 68MB | **45MB** |
| 그림 PNG 163장(기체 84 · 몬스터 19 · 파츠 25 · 캡슐 9 · 아이콘 · 지도 · 아틀라스) | 26.0MB | WebP **13.2MB** |
| 효과음 31종 | WAV 5.1MB | MP3 **0.5MB** |
| 첫 전투에서 받는 소리(21종 + UI) | 약 3.5MB | **337KB** |
| 안 쓰던 배포 파일 | 6.2MB | 0 |
| 이 PC — `.tmp` 지난 배포 checkout · `.git` | 160MB · 123MB | 0 · 92MB(`git gc`) |

## 그림

- `tools/webp_assets.py` — 대상 PNG 를 WebP 로 바꾸고 PNG 를 지운다. 다시 돌려도 안전하다(남은 PNG 만)
  - **무손실**(exact) — 기체 · 몬스터 · 파츠 · 재화 아이콘 · 이그니스 레인 아틀라스 · 유성 그림. 변환 뒤 다시 읽어 **RGBA 가 원본과 1:1** 인지 확인한다(163장 모두 통과). 평균 −33~50%
  - **손실 q90**(알파 무손실) — 뽑기 캡슐 9장 · 영토 지도. 픽셀아트가 아니고 크다(캡슐 장당 500K → 90K · 지도 3.3MB → 516K). PSNR 30.5~42.7dB. 2배 확대하면 EP 캡슐 파란 띠 가장자리가 살짝 번진다(WebP 손실의 색 해상도 절반 처리 — q98 도 같다). 화면에서는 원본보다 작게 그려져 구분되지 않고, 캡슐은 Codex 아트로 바뀔 임시 그림이다
  - **그대로 PNG** — `assets/motions/**` · `assets/effects/motion-*`(공격 모션 매니페스트 · spritecheck) · 사용자 '복사본' PNG
- 코드 — `sprites.js`(`assetPath` · `CACHE_BUST`) · `game.js`(파츠 · 캡슐 · 뽑기 공개 · 재화) · `gacha-fx.js`(`GACHA_ART_V`) · `dispatch.js` · `recruitment.js` · `territory.js` · `ignis-rain.js` · `style.css` · `themes/ui-v2.css` · 공개 공격 시안 페이지 4장의 기체 그림
- 도구 — `spritecheck.py`(자세를 `assets/<id>.webp` 와 비교) · `specialcheck`(VP8L 헤더로 440×420 · 알파) · 정지 그림 검사 3종은 '`.webp` 없음' 대신 '대기 애니메이션(`ignis-idle` · `assets/motions/`) 없음'을 본다(원래 뜻)

## 효과음

- ffmpeg 9.0.2(winget `Gyan.FFmpeg`) 설치. `sh tools/sfx_encode.sh` — `proto/juice/sfx/*.wav` → `assets/sfx/*.mp3`(libmp3lame 128kbps · 44.1kHz 스테레오 · 길이 같음). MP3 를 고른 이유: 아이폰 사파리까지 `decodeAudioData` 가 확실하다
- 원본 WAV(트림본 31 + raw 31)는 `proto/juice/sfx/` 에 그대로. `audio-check` 는 MP3 헤더 · 원본 WAV 보존 · 압축 여부를 본다

## 지운 · 옮긴 것

- `assets/motions/ignis-idle-36f-articulated.webp`(5.2MB) — 게임은 10프레임판만 쓴다. `tools/build_ignis_idle_articulated.py` 로 다시 만들 수 있다
- `assets/gacha/fx/` 의 `shard-1~8` · `spark` · `ember` · `smoke` · `rune-floor` — 연출이 쓰지 않는다(`tools/gacha_fx_gen.py` 로 다시 만들 수 있다)
- `assets/models/ignis/`(.blend · .glb · 미리보기) → `docs/art/models/ignis/` — 원본 소스가 공개 배포되고 있었다. `.blend1`(블렌더 자동 백업)은 지우고 `.gitignore`. `tools/ignis_blender_build.py` 출력 경로도 옮겼다
- `.tmp/motion-release-20261008`(지난 배포 checkout · 남은 파일 하나는 main 에 같은 내용으로 커밋돼 있음) · `tools/__pycache__`(`.gitignore`)

## 캐시

- `_headers` — `/assets/*` 에 `Cache-Control: public, max-age=86400`. 예전엔 접속마다 그림을 하나하나 304 로 확인했다
- 같은 이름으로 그림을 덮어쓰면 쓰는 쪽의 `?v=` 를 올린다(`sprites.js` CACHE_BUST · `game.js` PART_ICON_V · `gacha-fx.js` GACHA_ART_V · `ignis-rain.js`). 이번에 바꾼 그림은 이름(확장자)이 달라 옛 캐시와 섞이지 않는다

## 하지 않은 것

- JS 압축(minify) — Cloudflare 가 이미 brotli 로 보내고, 번들러 없는 정적 웹 원칙 · 소스를 직접 읽는 검사들과 맞지 않는다
- `proto/juice`(16MB) · `docs/art`(12MB) — 배포되지 않는 비교 · 원본 자료라 둔다. git 이력은 다시 쓰지 않았다

## 확인

- `release-check` 38종 통과(`circuitcheck` 는 이 PC 에서 약 2분이라 제한을 5분으로) · `specialcheck` · `spritecheck all` · `motion-path-check` · `pose-sequence-check` · `check_ignis_rain_renderer`
- 로컬 검수 서버 — 격납고 · 뽑기(10연차) · 점령 지도 · 순위 · 시련 전투를 돌며 **깨진 그림 0 · PNG 요청 0**, 소리 시험 · 전투 소리 23개 200 · 디코딩 실패 안내 없음
