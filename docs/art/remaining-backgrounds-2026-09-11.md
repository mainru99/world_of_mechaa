# 대문·뽑기 배경 제작 기록 · 2026-09-11

내장 ImageGen으로 개별 원화를 생성했다. 중단 전 저장된 두 WebP는 이후 `8270720`에 포함됐으므로 이번 재개에서 덮어쓰거나 다시 생성하지 않고 디코딩·치수·해시를 확인했다.
1672×941 PNG 원본을 보존하고, Pillow LANCZOS 중앙 fit으로 1920×1080 WebP(q88/method6)를 만들었다. 배경과 UI는 분리했다.

대문은 좌우 기지 구조물과 중앙의 어두운 성문, 뽑기는 좌우 사출 장치와 중앙의 빈 캡슐 공간이다. 원화 육안 검수와 최종 파일 규격 검사는 완료했다. 실제 화면 연결·PC/모바일 크롭·운영 배포 검증은 아직 하지 않았다.

- Claude 연결 대상: `#gate`, `.gacha-stage`. 중앙 cover를 출발점으로 실제 화면을 확인한다.
- 뽑기 기존 `--gc` 등급/크레딧 테마와 캡슐 충전·개방 연출을 보존한다. 불투명한 기존 그라디언트가 새 배경을 완전히 덮지 않도록 레이어를 조정한다.
- 생성 프롬프트는 이 작업의 이전 도구 호출에서 정확히 복구했다. CLI/API fallback은 사용하지 않았다.

## 대문 · gate

- 최종: `assets/backgrounds/gate.webp` · 1920×1080 RGB WEBP · 246,098 bytes
- SHA-256: `a95ef7c6dc78d7483757a74011552077f45c9026700d2bc8935edb89079fa565`
- 생성 원본: `C:/Users/user/.codex/generated_images/01a069a5-db19-72f0-ab06-e9a1258197ef/exec-62af9bf9-bd39-4dbe-9ffb-732bc4b1ab24.png`

### 최종 생성 프롬프트

```text
Use case: stylized-concept. Create one premium finished raster background for ROWAR, a dark science-fiction mech battle web game. Full-bleed opaque 16:9 landscape illustration, target 1920x1080 pixels. Sophisticated hand-painted hard-surface game environment art: believable industrial structures, crisp forms, rich but restrained material textures, deep midnight navy #0b0f1a to steel navy #1a2b4e, cool cyan #7bf0ff and very sparse warm amber gold #ffd24a. Match a serious mechanical sci-fi setting, not flat geometric placeholders or a stock-photo warehouse. Environment only: no characters, robots, mechs, vehicles, logos, readable text, letters, numbers, watermarks, HUD, UI panels, buttons or borders. Real interface will be overlaid separately. Controlled highlights and atmosphere; do not bury every surface in black.
Scene: imposing armored entrance to a vast fortified mech base at night, viewed from outside at human eye-level, wide cinematic architectural establishing shot. Enormous steel buttresses and layered gate towers frame the far LEFT and far RIGHT edges, recessed maintenance galleries and armored shutter details, a little low drifting mist, damp slate approach paving and restrained cyan edge beacons. The actual distant central gate is CLOSED and dark, not a bright open portal. Make the metal believable and lightly weathered, a functioning intimidating headquarters rather than a ruined battlefield. Strong peripheral silhouette and depth. UI composition is essential: reserve the entire central vertical strip x=34%-66%, y=10%-92% as a quiet, low-contrast deep navy area for a logo and login/start buttons. This area should show only very subdued distant door planes and faint floor perspective, not an actual graphic panel and not a blank pasted rectangle. Keep bright lamps, gold accents, hard lines and all detailed structures outside this central strip. Low level small lights at far edges only; no beam, sign, emblem or central vanishing-point glare. Upper center a dark architectural recess, bottom center empty shadowed approach. A narrow center crop must remain calm and readable.
```

## 뽑기 · gacha

- 최종: `assets/backgrounds/gacha.webp` · 1920×1080 RGB WEBP · 261,558 bytes
- SHA-256: `b28df975288fe38fcd48457e5412028a0a46227f6fb41813f17e746d9a975b08`
- 생성 원본: `C:/Users/user/.codex/generated_images/01a069a5-db19-72f0-ab06-e9a1258197ef/exec-71721a3f-8cc1-48fe-9a40-f5840ab0569d.png`

### 최종 생성 프롬프트

```text
Use case: stylized-concept. Create one premium finished raster background for ROWAR, a dark science-fiction mech battle web game. Full-bleed opaque 16:9 landscape illustration, target 1920x1080 pixels. Sophisticated hand-painted hard-surface game environment art: believable industrial structures, crisp forms, rich but restrained material textures, deep midnight navy #0b0f1a to steel navy #1a2b4e, cool cyan #7bf0ff and very sparse warm amber gold #ffd24a. Match a serious mechanical sci-fi setting, not flat geometric placeholders or a stock-photo warehouse. Environment only: no characters, robots, mechs, vehicles, logos, readable text, letters, numbers, watermarks, HUD, UI panels, buttons or borders. Real interface will be overlaid separately. Controlled highlights and atmosphere; do not bury every surface in black.
Scene: a dedicated futuristic core-capsule fabrication and extraction chamber deep inside a mech base, distinct from a large garage. A precise sophisticated industrial machine room. Polished dark navy armored housings edged in dark titanium and small brass-gold trims; symmetrical segmented curved extraction arms and mechanical rail assemblies located at the FAR LEFT and FAR RIGHT sides, detailed pneumatic fittings and conduits near the edges, recessed side storage sockets. A broad quiet empty receiving well and flush floor platform in the lower third. The machine is idle. A separate spherical navy/gold/cyan capsule sprite will animate in the CENTER. Therefore leave x=30%-70%, y=18%-77% COMPLETELY EMPTY OF OBJECTS: a dark recessed chamber back wall, subtle ambient blue gradients and almost no hard lines. No central capsule, sphere, crystal, reactor, beam, spindle, gantry, ring crossing the center, or bright central light. Side rails can suggest a circular assembly around this empty region but must not intrude across it. Small cyan emitter lights confined to outer edges; sparse amber instrument glints at far sides, no monitor screens or labels. Frame a front-facing near-symmetrical wide view, gentle shallow floor perspective, visually legible industrial depth, controlled polished painterly detail. Center must remain uncluttered when the landscape is cropped to square or tall stage on mobile. Only environment, do NOT bake in the capsule animation or any floating energy effects.
```

