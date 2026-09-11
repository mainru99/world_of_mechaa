# 위험 지형 3종 제작 기록 · 2026-09-11

폐허·자기폭풍은 중단 전 내장 ImageGen으로 만든 원화를 복구했고, 생성 결과 파일이 남아 있지 않은 용광로만 이번 재개에서 내장 ImageGen으로 새로 제작했다. 모든 원본 PNG는 보존했다.
1254×1254 원본을 Pillow LANCZOS로 512×512 RGB WebP(q88/method6)로 변환했다. 재도색·배경 제거·합성 없이 규격만 맞췄다.

폐허는 부서진 산업시설과 중앙 광장, 자기폭풍은 침수 지면과 가장자리 청보라 전기 아크, 용광로는 검은 철판과 주황 용융금속으로 구분했다. 지평선 없는 높은 시점과 중앙의 낮은 대비를 공통으로 삼았다. 원본 또는 최종 그림의 육안 확인과 최종 파일 디코딩·규격·해시 검사를 마쳤다.

실제 지도 카드에는 어두운 오버레이가 필요하다. 소유·적대·잠김·보호 상태 색과 글자 대비를 보존하고, 실제 144px 전후 카드에서 밝기를 확인할 것. 화면 연결·게임 크롭·배포는 아직 하지 않았다.

폐허·자기폭풍 프롬프트는 지정된 이전 작업의 도구 호출에서 정확히 복구했고, 용광로는 이번에 실제 사용한 프롬프트다. CLI/API fallback은 사용하지 않았다.

## 폐허 · ruins

- 최종: `assets/terrain/ruins.webp` · 512×512 RGB WEBP · 75,934 bytes
- SHA-256: `dc8ef2fff7029554c696166522bd555681d2465d51c663b4d1fa2c8b75b55e6a`
- 생성 원본: `C:/Users/user/.codex/generated_images/01a08e84-d42d-72a0-97da-ad2cc003fb31/exec-ae23e12f-fed4-4004-bfd8-fbfd8af2063a.png`

### 최종 생성 프롬프트

```text
Use case: stylized-concept
Asset type: production environment painting for the ROWAR sci-fi mech game's territory map card, square 512 by 512 final use.
Primary request: an abandoned ruined industrial city block seen from steep aerial top-down near-orthographic view. Broken factory rooftops, collapsed walls, exposed steel skeletal structures and cracked deserted streets surround a low-contrast empty ruined central plaza.
Style/medium: premium polished hand-painted industrial science-fiction game environment illustration, believable weathered material texture and architectural scale, detailed artistic finish rather than flat geometric blocks.
Composition/framing: full-bleed square, steep top-down view with no horizon and no sky; district-overview scale showing a small neighborhood, not a vast panorama or a close-up. Main recognizable rubble and building silhouettes toward outer edges. Central 45 percent is dark unobtrusive cracked paving, sparse scattered rubble, no bright centerpiece, suitable behind overlaid card text. The ruined neighborhood must remain recognizable at 144-pixel thumbnail size.
Lighting/mood: ominous deserted post-war military-industrial ruins, soft dim blue-gray light, rich but readable shadow depth, subtle dusty haze that does not hide the layout.
Color palette: dark navy #0b0f1a to #1a2b4e and blue-gray concrete/steel, very sparse restrained cyan remnant utility lights, subdued rust brown accents. Keep the overall image dark without becoming featureless.
Constraints: opaque environmental background only. No UI, no letters or numbers, no labels, no markers, no map grid, no borders, no watermark, no people, no robots or mechs, no vehicles, no logos, no foreground props. Not isometric floating terrain and not a toy diorama. No bright lights or high-contrast subjects in the center.
```

## 자기폭풍 · storm

- 최종: `assets/terrain/storm.webp` · 512×512 RGB WEBP · 70,548 bytes
- SHA-256: `d59118411a0303a12b7a7427d7f38d78108f6f1d8b4d45d53f7faf1c1d27546a`
- 생성 원본: `C:/Users/user/.codex/generated_images/01a08e84-d42d-72a0-97da-ad2cc003fb31/exec-43a94d6b-064b-4b77-9738-c1a994451cca.png`

### 최종 생성 프롬프트

```text
Use case: stylized-concept
Asset type: production environment painting for the ROWAR sci-fi mech game's territory map card, square 512 by 512 final use.
Primary request: a dangerous magnetic-storm industrial wasteland seen from steep aerial top-down near-orthographic view. Inky flooded industrial ground, drowned cracked service roads, weathered remnants of power infrastructure and broken conductive pylons around the outside. A few small elegant blue-violet electrical arcs bend between broken structures near the outer edges, showing magnetic energy rather than ordinary rainy weather. The middle is dark irregular ground and black-blue shallow floodwater.
Style/medium: premium polished hand-painted industrial science-fiction game environment illustration, believable weathered material texture and architectural scale, detailed artistic finish rather than flat geometric blocks.
Composition/framing: full-bleed square, steep top-down view with no horizon and no sky; district-overview scale showing a compact industrial site, not a vast panorama or a close-up. Main recognizable pylon shapes and arcs toward outer edges. Central 45 percent remains dim low-contrast irregular terrain without bright electricity, suitable behind overlaid card text. At 144-pixel thumbnail size distinguish this terrain by dark wet surfaces and restrained violet-blue arcs. Arcs must not blanket the scene.
Lighting/mood: eerie magnetic disturbance, dim navy blue ambient light, faint localized electrical reflection in water, ominous stillness rather than a cinematic lightning sky.
Color palette: dark navy #0b0f1a to #1a2b4e, blue-gray metal and charcoal earth, restrained cyan and violet electrical accent along the perimeter. Keep overall image dark without becoming featureless.
Constraints: opaque environmental background only. No UI, no letters or numbers, no labels, no markers, no map grid, no borders, no watermark, no people, no robots or mechs, no vehicles, no logos. No horizon or clouds or sky; no ordinary rainstorm or huge lightning bolt; not isometric floating terrain and not a toy diorama. No bright lights or high-contrast subjects in the center.
```

## 용광로 · furnace

- 최종: `assets/terrain/furnace.webp` · 512×512 RGB WEBP · 88,806 bytes
- SHA-256: `1992e905a8f64253978c3e8f84318a138e4e1f2d4088155ee5caa5ba3c3fc44c`
- 생성 원본: `C:/Users/user/.codex/generated_images/01a069a5-db19-72f0-ab06-e9a1258197ef/exec-a1133905-2aa3-47f6-97fd-75168c9d9102.png`

### 최종 생성 프롬프트

```text
Use case: stylized-concept. Asset: one finished square top-down terrain background for a territory map card in ROWAR, a dark industrial science-fiction mech game. Terrain type: FURNACE, the heart of a gigantic steel foundry. Target 512 x 512 px final asset; full-bleed square opaque illustration. Use premium polished hand-painted hard-surface game environment art with believable steelwork, rich worn material detail and crisp designed silhouettes. Steep aerial near-orthographic view looking almost straight DOWN at a district-sized foundry complex, no horizon, no visible sky, not an eye-level cinematic interior. A large quiet dark heat-blackened iron service deck and subtle floor seams occupy the central 45% for overlaid game text. Along the perimeter show enormous ribbed smelting vessels, gantries, industrial platforms, pipework and recessed channels carrying glowing orange molten metal. Restrained hot orange and amber glow comes mostly from the edges and corner channels; center remains dark low contrast blue-charcoal steel, not orange lava covering everything. Deep navy and desaturated steel gray base palette, vivid but limited molten amber as the terrain identifier. Subtle smoke wisps only around the outer machinery; do not obscure the architecture. Same district-overview scale and high-angle composition as a top-down ruined industrial city tile, fully readable as a furnace when reduced to a 144px map card. Do not draw a UI or map grid: no borders, card frames, text, letters, numbers, logos, labels, symbols, markers, people, mechs, robots, vehicles, watermarks. One coherent continuous environment, not a collage or sprite sheet.
```

