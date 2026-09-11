# 재화 아이콘 3종 — 중단 작업 복구 · 2026-09-11

사용자 요청으로 남은 게임 이미지를 제작하던 중 이미 생성된 재화 아이콘 3개를 복구했다.
기존 원본을 각각 직접 확인해 금화·청록 결정·회색 고철로 식별했으며, **이번 재개에서
재생성하거나 배경을 다시 제거하지 않았다.** 원래 제작 수단은 내장 ImageGen이다.

## 최종 파일

| 재화 | 프로젝트 경로 | 규격 | 용량 | 알파가 0보다 큰 영역의 경계 상자 |
|---|---|---|---:|---|
| 크레딧 | `assets/ui/coin-credit.png` | 128×128 RGBA PNG | 18,536 bytes | (17, 13, 110, 113) |
| 코어 | `assets/ui/coin-core.png` | 128×128 RGBA PNG | 12,854 bytes | (33, 10, 95, 120) |
| 스크랩 | `assets/ui/coin-scrap.png` | 128×128 RGBA PNG | 20,566 bytes | (12, 14, 117, 118) |

경계 상자의 오른쪽·아래 좌표는 Pillow 방식의 배타적 끝 좌표다.
파일 제작·로컬 저장 완료이며 **게임 화면 연결·배포 완료를 뜻하지 않는다.**
`CONTRACT.md`의 협업 절차에 따라 Claude가 지갑·보상 화면의 CSS 원형 그라디언트를
이 경로의 PNG로 연결한다. 프론트엔드·서버·밸런스 데이터는 수정하지 않았다.

## 원본과 처리 방식

원본 폴더:

`C:\Users\user\.codex\generated_images\01a08e83-fb0c-7080-b859-8cced7efe411`

| 재화 | 원본 PNG 파일명 | 원본 규격 | 원본 용량 |
|---|---|---|---:|
| 크레딧 | `exec-cd95e682-615f-4adc-b2bc-69744018e14d.png` | 1254×1254 RGBA | 1,364,660 bytes |
| 코어 | `exec-50c7ebf7-4001-4e03-875c-f246a6a905d3.png` | 1254×1254 RGBA | 821,158 bytes |
| 스크랩 | `exec-fa658aad-f3c8-4118-acfc-a4e6bce7178d.png` | 1254×1254 RGBA | 1,562,029 bytes |

- 세 원본 모두 실제 알파 채널이 있고 알파 범위는 0~255다. 검정 배경을 그린 이미지가 아니다.
- 원본 전체를 Pillow 12.3.0의 LANCZOS로 124×124에 축소하고, 128×128 투명 캔버스의
  (2, 2)에 **마스크 없는 RGBA paste**로 배치했다. 이중 알파 적용은 하지 않았다.
- 고철 원본 테두리의 알파 1 잔여 픽셀 36개를 확인했다. 이 때문에 세 아이콘 모두 같은
  2px 외부 여백을 적용했다. 알파 임계값 삭제·색 키 제거·피사체 잘라내기는 하지 않았다.
- 생성 원본은 그대로 보존했고, 기존 프로젝트 파일을 덮어쓰지 않고 새 경로로 저장했다.
- 원래 프롬프트는 1024×1024 원본을 요청했지만 실제 반환 파일은 1254×1254였다.

## 검수

- 원본 3개를 직접 확인했다. 금화 1개, 청록 결정 1개, 회색 장갑 파편·너트 묶음이 맞다.
- 최종 128px PNG를 직접 확인해 전체 실루엣, 재화별 색상과 질감, 투명 여백을 확인했다.
- 최종 PNG 3개 모두 정상 디코딩, 128×128 RGBA, 알파 최솟값 0·최댓값 255다.
- 위·아래·좌·우 테두리 전 픽셀의 알파가 0임을 수치 검사했다.
- 글자·숫자·로고·배경 패널이 없다. 기체 원본이나 대기모션 시트와 무관한 별도 자산이다.
- 실사용 24px 렌더링, 실제 지갑·보상 화면 및 모바일 연결 검수는 Claude 연결 시 수행한다.

### SHA-256

| 재화 | 원본 | 최종 |
|---|---|---|
| 크레딧 | `188af8a3a823b2c523a35f4f7911e6b8c474ed6837c96a9cfa008037ecc32cc4` | `75a51801e28b3dc3b208483c6c965e3d7141359cf557219e77cd7f5eab8cc758` |
| 코어 | `7cae9d2fbd630d5ca1f1270cdb0fbebf2e73faeb8fab4d52ac304c4163a65c61` | `920c2651d06d50f8d68c729e4f3f77e26440a3eaa95daf9339cda4f19275264f` |
| 스크랩 | `3a9200798e60f6d9cf320d3fec5cd72c743d8287060bcb510a0133eed7a2a35c` | `408a0a6f56428a50e743bc562dd3bdc187c207db78a404292982d097eb76b5fe` |

## 생성 프롬프트 원문

아래는 해당 작업의 세션 로그
`C:\Users\user\.codex\sessions\2026\09\11\rollout-2026-09-11T12-30-10-01a08e83-fb0c-7080-b859-8cced7efe411.jsonl`
에서 각 내장 `image_gen__imagegen` 호출에 전달한 프롬프트를 복구한 원문이다.
추정해 다시 쓴 브리프가 아니다. CLI/API 대체 경로는 사용하지 않았다.

### 크레딧

```text
Use case: stylized-concept
Asset type: polished raster game UI currency icon for ROWAR, final usage 128x128 and readable at 24px
Primary request: one single thick futuristic gold credit coin, isolated on a genuinely transparent background with real alpha channel, square PNG.
Subject: a chunky machined gold metal coin shown in a slight three-quarter angle, bold circular silhouette, beveled rim and a simple abstract inset groove on its face, no letter or currency symbol.
Style/medium: premium hand-painted hard-surface science-fiction game inventory art, clean sculptural shapes with restrained brushed-metal texture, crisp edges and strong readable value grouping.
Composition/framing: centered object with 14 percent genuinely transparent padding on all four sides; show the entire coin. Only this single item, no floor or environment, no cast shadow outside the object.
Lighting/mood: soft upper-left key light, controlled gold highlight, dark amber shaded edge; no glare, particles or bloom.
Color palette: warm metallic gold inspired by #ffd24a with deep brown-gold shading; intended for a dark navy #0b0f1a to #1a2b4e UI.
Constraints: actual transparent alpha background, no backdrop of any color, no painted checkerboard, no icon tile, no border panel, no text, letters, numbers, logo, watermark, hands, stacks or extra coins. Large simple facets and grooves remain readable when downsampled. Square 1024x1024 source.
```

### 코어

```text
Use case: stylized-concept
Asset type: polished raster game UI currency icon for ROWAR, final usage 128x128 and readable at 24px
Primary request: one single cyan energy crystal core, isolated on a genuinely transparent background with real alpha channel, square PNG.
Subject: one chunky asymmetric hexagonal energy crystal, upright and slightly tilted in three-quarter view, broad clean cyan facets, pointed top and tapered lower tip, translucent luminous center but solid crisp silhouette.
Style/medium: premium hand-painted hard-surface science-fiction game inventory art, sculptural simple shapes with restrained texture, crisp edges and strong readable value grouping; match a machined gold coin item icon in polish and lighting.
Composition/framing: centered entire object with 14 percent genuinely transparent padding on all four sides. One crystal only, no pedestal, floor, environment or cast shadow outside the object.
Lighting/mood: soft upper-left key light, controlled icy highlights and subtle internal teal glow, dark petrol-blue shaded facets; no exterior bloom, sparkle particles or lens flares.
Color palette: luminous cyan inspired by #7bf0ff, teal and deep blue shading; intended for dark navy #0b0f1a to #1a2b4e UI.
Constraints: actual transparent alpha background, no backdrop of any color, no painted checkerboard, no icon tile or border panel, no text, letters, numbers, logo, watermark, hands, duplicate crystals or fragments. Large simple facets remain readable when downsampled. Square 1024x1024 source.
```

### 스크랩

```text
Use case: stylized-concept
Asset type: polished raster game UI currency icon for ROWAR, final usage 128x128 and readable at 24px
Primary request: one compact gray scrap-metal resource bundle, isolated on a genuinely transparent background with real alpha channel, square PNG.
Subject: a simple compact cluster consisting of two thick overlapping broken gunmetal armor plates and one chunky hexagonal nut nestled against them; three elements grouped into one connected bold silhouette, no loose scattered fragments. Slight three-quarter view, unmistakably salvage from a science-fiction mech.
Style/medium: premium hand-painted hard-surface science-fiction game inventory art, simple sculptural shapes, restrained brushed-metal texture and a few broad scuffs, crisp edges and strong readable value grouping; same polish as a gold coin and cyan crystal resource icon.
Composition/framing: centered entire object with 14 percent genuinely transparent padding on all four sides. Compact stable mass with no floor, environment or cast shadow outside the object.
Lighting/mood: soft upper-left key light, pale silver beveled edges, dark charcoal-gray shaded faces, very subtle cool blue reflected light; no glows or particles.
Color palette: silver and medium neutral gunmetal gray, intended for a dark navy #0b0f1a to #1a2b4e UI; no gold or cyan crystal material.
Constraints: actual transparent alpha background, no backdrop of any color, no painted checkerboard, no icon tile or border panel, no text, letters, numbers, logo, watermark, hands, tools or extra objects. Large simple shapes remain readable when downsampled. Square 1024x1024 source.
```
