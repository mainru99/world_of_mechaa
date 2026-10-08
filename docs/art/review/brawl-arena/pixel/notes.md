# 난투 무대 도트 배경 후보 — 2026-10-08

- 기준: `docs/art/brawl-stage-bg-request-2026-10-08.md` 마지막 「추가 결정 — 도트 그림으로」 및 이번 사용자 지시.
- 생성 도구: `huggingface_gr1_z_image_turbo_generate`. 총 4회 시도, 4회 성공. 추가 시도 없음.
- 공통 설정: `resolution="2048x1152 ( 16:9 )"`(도구의 최대 16:9), `steps=9`, `shift=3`, `random_seed=false`.
- 네 결과 모두 curl로 받아 메모리에서 PIL로 RGB PNG 변환. 실제 크기 2048×1152 확인. 리사이즈·색상 양자화·픽셀화 후처리는 하지 않았다.
- 사용자 지시에 따라 이미지 파일을 별도로 열어 시각 검수하지 않았다. 아래 자기평가는 **프롬프트 설계에 대한 한 줄 평가**이며, 결과 그림의 요구 충족을 보증하거나 최종 채택하는 평가는 아니다.

## 후보 1 — 정면 연속 난간

- 파일: `px-1.png`
- 시드: 요청 및 도구 반환값 `810081`
- 크기: 요청 및 저장값 **2048×1152**, 16:9, RGB PNG
- 원본 URL: https://mcp-tools-z-image-turbo.hf.space/--replicas/24cnm/gradio_api/file=/tmp/gradio/9c69ed0f4dd605ed20ffdee5726269fcddd67890aa0e70d7d39b941618f36d10/image.webp
- 자기평가: 정면 대칭과 연속 2층 난간을 기본안으로 설계했으며, 실제 바닥 60% 확보와 도트 선명도는 시각 미검수다.

### 정확한 전송 프롬프트

```text
Genuine hand-pixeled 16-bit PIXEL ART background for a classic SNES / 1990s arcade fighting game. Widescreen 16:9, 2048x1152. Coherent coarse pixel grid: imagine a 512x288 pixel canvas enlarged exactly 4x with nearest-neighbor; crisp chunky square pixels, stair-stepped edges, deliberate pixel clusters, restricted 32-color palette, flat stepped shading. Absolutely no anti-aliasing, smooth gradients, blur, photorealism, 3D rendering, PBR gloss, painterly brushwork or photographic texture. Environment only, no fighters, robots, people, vehicles, text, letters, numbers, logos, HUD or borders. A compact underground steel arena hall viewed side-on like a 2D fighting-game stage, very shallow perspective revealing a broad floor. Close back wall, low ceiling, large architectural scale cues so future fighters one-third of the image height feel large, not toy-sized in a cathedral. Composition A: straight-on roughly symmetrical hall, a continuous second-floor balcony railing across the close rear wall with short wraparound side railings, two thick support columns only at the extreme edges, simple low ceiling beams. All architecture is confined above y=38%, with small dim fixtures in the upper corners. The back wall meets the floor at y=38%. EVERYTHING below y=40% down to the bottom edge is one uninterrupted wide dark steel-plate fighting floor, including the lower corners, no foreground barriers. Sparse broad plate seams, low contrast, calm matte surface, no tile grid, circles, symbols or marked character slots. Subtle desaturated teal light pool across the LEFT floor half and subtle desaturated red-orange pool across the RIGHT half, expressed only as a few dark flat pixel-color bands, no bloom or bright hotspots. Deep midnight navy #0b0f1a to steel navy #1a2b4e dominates. Central x=40%-60% strip is empty, dark and quiet, with no central door, object, glare or vanishing-point flare. Keep interesting detail in the upper third and far lateral edges; preserve a readable empty floor when cropped to a central square or a wide horizontal band. Authentic restrained pixel-art stage, not a pixel filter on a render.
```

## 후보 2 — 얕은 말굽형 회랑

- 파일: `px-2.png`
- 시드: 요청 및 도구 반환값 `810082`
- 크기: 요청 및 저장값 **2048×1152**, 16:9, RGB PNG
- 원본 URL: https://mcp-tools-z-image-turbo.hf.space/--replicas/24cnm/gradio_api/file=/tmp/gradio/7dbde4fc9f764535e90abcbd8fbbb72b0078fe5e2d54c5ec8031283b80ad10ad/image.webp
- 자기평가: 잘린 모서리 회랑과 상단 사선 보강대로 기본안에 얕은 깊이를 더하도록 설계했으며, 바닥 침범과 조명 대비는 시각 미검수다.

### 정확한 전송 프롬프트

```text
16-BIT PIXEL ART. A real old-school arcade fighting-game stage background, carefully drawn chunky pixel clusters, crisp square pixels and staircase diagonals on a consistent 512x288 logical pixel grid enlarged 4x without smoothing. Limited 24-32 color palette, large flat dark color shapes, only 3 shades per material, restrained ordered pixel dithering. 2048x1152 landscape 16:9. Not a realistic scene, not 3D, not concept painting, no anti-aliasing, no blur, no gradients, no glossy reflections. Empty compact industrial arena interior in dark midnight navy and blue-black steel. Composition B: shallow horseshoe-shaped second-floor gallery with wraparound steel railings, clipped corner balconies and two short overhead diagonal braces at the far upper corners; nearby rear wall, low roof, broad oversized rail posts for intimate human-scale fighting-stage proportions. Side-view game camera with a slight downward view of the fighting surface, not isometric. The entire hall architecture fits into the TOP 38 percent; the rear wall-floor junction is a horizontal line at 38 percent from the top. The remaining LOWER 62 percent is entirely an expansive uninterrupted flat dark steel-plate floor reaching all four lower edges. Make the floor dominant and the wall a short narrow upper band. Large plain plates with very few barely visible seams, no repeating square grid. Very muted teal light colors on the left floor half and very muted rusty red-orange light colors on the right floor half, using flat stepped pixel bands darker than medium brightness. No dramatic lighting or light beams. Empty low-contrast center strip from x40 to x60 across the entire picture, no bright central point, no doors in the middle. All small lights and structural detail restricted to the top third and outermost side edges. Almost symmetrical and close, never a vast hangar; future fighters occupying one third of the stage height must look imposing. Leave both the back-row floor at y45-58 percent and front-row floor at y75-92 percent completely clear. No people, robots, mechs, vehicles, weapons, boxes, debris, floor symbols, rings, slot markers, text, logos, numbers or UI. Authentic SNES-era pixel-art background with visible coarse pixels, suitable for square center cropping and a wide fighting-game viewport.
```

## 후보 3 — 낮은 수평 보와 단순 벽면

- 파일: `px-3.png`
- 시드: 요청 및 도구 반환값 `810083`
- 크기: 요청 및 저장값 **2048×1152**, 16:9, RGB PNG
- 원본 URL: https://mcp-tools-z-image-turbo.hf.space/--replicas/24cnm/gradio_api/file=/tmp/gradio/324483dc2426874a4968dedf262fda22e5b0056dff19eb7fdd8bc2de94912ca2/image.webp
- 자기평가: 낮은 수평 보와 상부 환기판의 미세한 비대칭으로 가까운 홀을 의도했으며, 중앙 비움과 두 줄 배치 적합성은 시각 미검수다.

### 정확한 전송 프롬프트

```text
Authentic 1990s 16-bit arcade PIXEL ART fighting-stage background. Visible chunky square pixels approximately 4x4 output pixels, consistent low-resolution pixel grid, hand-placed pixel clusters, hard stair-step silhouettes, limited 32-color navy palette, flat cel-like pixel shading with no smoothing. Native pixel-art aesthetic, never photorealistic, never a 3D render or a painted illustration, no anti-aliasing, no bloom, no smooth gradients, no lens effects. Output 2048x1152, 16:9 full-bleed opaque scene. Composition C: compact close-range steel fighting hall, straight-on side-view with shallow floor perspective, second-floor railings wrapping the back and both short sides. A low heavy horizontal ceiling beam and paired chunky balcony supports at the extreme left and right, an unadorned dark central wall panel; small off-center vent panels only in the upper side sections. Nearby back wall and oversized simple architectural details keep future fighters visually large, no cavernous hall or distant tunnel. Compress ALL rear architecture and wraparound balconies into the upper 38 percent of the frame. At y38 percent the wall ends and the fighting floor begins. Below y40 percent the whole picture is wide flat dark steel-plate floor with nothing on it, no columns, rails, steps or obstacles intruding into that lower region. Floor takes at least 60 percent of the image. Sparse oversized rectangular steel plates, barely visible seams and extremely low contrast. Deep midnight navy #0b0f1a with muted steel blue #1a2b4e. A broad faint TEAL pixel-shaded light pool sits on the left half of the floor, a broad faint RED-ORANGE pixel-shaded light pool on the right half, both very dark and desaturated, only two or three discrete color steps, no bright reflections. The center vertical strip x40-60 percent is open quiet negative space, no center doorway, no central spotlight, no objects or focal flare. Keep the upper corner lamps tiny and dim. Rough bilateral balance with slight upper-wall asymmetry. Completely empty environment: no robots, people, spectators, vehicles, props, words, letters, numbers, logos, signs, HUD, border, circular floor markings or placement grid. Back-row and front-row standing areas both clear. Designed for classic SNES / arcade sprite fighters and central-square cropping.
```

## 후보 4 — 단순한 직사각 회랑과 넓은 여백

- 파일: `px-4.png`
- 시드: 요청 및 도구 반환값 `810084`
- 크기: 요청 및 저장값 **2048×1152**, 16:9, RGB PNG
- 원본 URL: https://mcp-tools-z-image-turbo.hf.space/--replicas/24cnm/gradio_api/file=/tmp/gradio/fbb8b6353a88e44bfa2899e02829b536e52879ea91d768259b8302c8e86dccf1/image.webp
- 자기평가: 24색과 단순한 직사각 회랑으로 바닥 여백을 가장 강하게 강조했으며, 인물 배제·낮은 대비·픽셀 규격의 실제 충족은 시각 미검수다.

### 정확한 전송 프롬프트

```text
PIXEL ART BACKGROUND, 16-bit SNES fighting game, authentic low-resolution arcade stage. 2048x1152 16:9 image built visually from 512x288 chunky pixel cells enlarged 4 times, sharply defined square pixels, hand-crafted clusters, staircase contours, restricted 24-color palette, minimal flat pixel shading. No anti-aliasing, no smooth gradients, no photoreal textures, no 3D render, no painting, no glossy metal, no blur. Composition D: an intimate enclosed navy-black steel arena with a close rear wall and a shallow wraparound second-floor railing, squat rectangular balcony architecture, cropped heavy ceiling crossbeams in the upper corners, two small dim wall fixtures set toward the outer edges. A side-view 2D fighting stage with only slight floor perspective, balanced left and right, very short spatial depth, large rail posts and nearby walls so sprite fighters look large. Critical layout: the hall and balcony occupy ONLY the upper 35-38 percent of the canvas; the floor begins at y38 percent. A wide plain steel floor fills EVERYTHING beneath y40 percent, all the way to the bottom and lateral edges, no raised stage lip, foreground railing, pit, stairs or obstacles. The lower sixty percent is almost empty navy negative space, a few broad steel plates with extremely faint seams rather than a grid. Quiet dark floor for two rows of large fighters. A subtle low-intensity desaturated teal patch across the left floor half and a subtle low-intensity desaturated burnt orange-red patch across the right floor half, rendered as broad dark stepped color clusters, never vivid glowing circles. Deep midnight navy #0b0f1a and dark steel blue #1a2b4e dominate the entire image. Keep the center x40-60 percent dark and empty; no central door, pillar, spotlight, emblem, markings or vanishing point flash. Structure and detail only across the upper third and extreme upper side edges. Restrained classic arcade environmental pixel art, readable after central square or ultrawide cropping. No characters, humans, robots, mechs, vehicles, crowd, machinery on the floor, words, text, logos, numerals, UI, borders, character shadows or floor placement symbols.
```
