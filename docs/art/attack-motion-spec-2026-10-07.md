# 공격 모션 — 그림 규격서 (GPT 작업 지시)

2026-10-07 사용자 결정 — **"GPT 가 스프라이트를 그리고, Claude 가 규격 · 검사 · 재생 엔진을 만든다."** 기체 1 ~ 2종으로 먼저 시험하고 넓힌다.
화면 연출만이다. 전투 판정(`js/sim.js` · `js/joint.js` · `js/brawl-sim.js`) · 서버 · 밸런스는 바뀌지 않는다.

## 0. 이미 있는 것 (Claude)

| 파일 | 하는 일 |
|---|---|
| `js/motion.js` | 재생 엔진. 기체마다 **공격 종류**(아래 1절)를 정하고, 사건(타격 · 스킬 · 상태)마다 이펙트를 그린다. 그림이 없으면 **코드로 그린 대체 연출**로 돈다 |
| `js/motion-assets.js` | 검사를 통과한 그림 목록. **손으로 고치지 않는다** — 검사 도구가 쓴다 |
| `tools/spritecheck.py` | 검사 · 정렬 · 목록 쓰기(Pillow). 크기 · 진짜 투명 · 가짜 체크무늬 · 칸 여백 · 발끝 · 방향 · 원본과 겹침 · 색 |
| `docs/art/attack-motion-preview.html` | 미리보기. 실제 1 : 1 시뮬 사건을 실제 엔진으로 재생 · 평타 · 스킬 · 상태 8종 |

그림을 넣으면 순서는 늘 같다.

```
python tools/spritecheck.py all --write
python -m http.server 8123            # 리포 루트에서
→ http://localhost:8123/docs/art/attack-motion-preview.html   사용자 검수
```

검사 통과는 '쓸 수 있다' 까지다. **보기 좋은가는 사용자가 본다.** 승인 전에는 커밋하지 않는다.

## 1. 공격 종류 7가지

기체마다 하나(`js/motion.js` KINDS — 역할 · 스킬 글에서 골랐다. 고칠 곳은 그 표 하나).

| 종류 | 파일 | 기체 예 | 칸 0 (날아가는 것) | 칸 1 (시작) | 칸 2 (맞는 순간) | 칸 3 (흩어짐) |
|---|---|---|---|---|---|---|
| 사격 shot | `assets/effects/motion-shot.png` | DUNE · RANGER · TEMPEST · VEGA … 20종 | 짧은 예광탄 | 총구 섬광 | 작은 불꽃 튐 | 불티 몇 개 |
| 포격 cannon | `motion-cannon.png` | KESTREL · VANGUARD · HOWITZER · NEMESIS … 12종 | 굵은 포탄 + 꼬리 | 큰 포구 화염 | 폭발 섬광 | 연기 · 파편 |
| 미사일 missile | `motion-missile.png` | BASTION · TRACER | 미사일 한 발(꼬리 불꽃) | 발사 불꽃 | 폭발 | 연기 고리 |
| 광선 beam | `motion-beam.png` | NIMBUS CANNON · HEX · HALO · SERAPH … 7종 | **이어 붙일 수 있는** 광선 토막(가로) | 충전 구슬 | 광선 끝 충돌 | 빛 조각 |
| 참격 slash | `motion-slash.png` | AZURE · RONIN · SHOGUN · SOLARIS … 14종 | 초승달 베기 궤적(맞는 자리에 그린다) | 칼끝 번뜩임 | 베인 자국 섬광 | 흩어지는 빛 |
| 타격 smash | `motion-smash.png` | MULE · GOLIATH · ATLAS · ZEALOT … 19종 | 충격파 원 | 휘두름 번뜩임 | 큰 타격 별 | 먼지 · 파편 |
| 찌르기 thrust | `motion-thrust.png` | LANCER · PIKE | 일직선 찌르기 잔상 | 창끝 번뜩임 | 관통 섬광 | 불티 |

상태 2장 — 스킬 효과 · 치명타에 덧붙는다.

| 파일 | 칸 0 | 칸 1 | 칸 2 | 칸 3 |
|---|---|---|---|---|
| `motion-status-a.png` | 방벽(육각 막) | 수리(초록 빛 · 십자) | 표적(붉은 조준선) | 재밍(보라 잡음 줄) |
| `motion-status-b.png` | 흡혈(핏빛 구슬 하나 — 상대 → 나로 여러 개를 띄운다) | 치명(노란 별 폭발) | 관통(장갑 금 · 파편) | 처형(큰 X 베기) |

이그니스 스킬은 지금의 이그니스 레인(`assets/effects/ignis-rain-atlas.png`)을 그대로 쓴다.

## 2. 이펙트 아틀라스 규격

이그니스 레인이 통과한 방식 그대로다(`docs/art/ignis-rain.md` · `ignis-rain-prompts.json`).

- **정사각 · 2 × 2 칸**(구분선 없음). 1024 이상(이그니스 레인은 1254). 가로가 짝수
- **RGBA 진짜 투명** — 빈 곳 알파 0. 네 귀퉁이 투명 · 투명한 곳 40% 이상
- **가짜 체크무늬 금지** — 이미지 생성이 회색 · 흰색 바둑판을 '투명처럼' 칠해 올 때가 있다(이그니스 레인 2 · 3차가 그랬다). 검사가 걸러낸다
- 칸마다 **가장자리에서 4% 이상 떨어진다**(권장 12.5% — 이그니스 레인과 같다). 한 칸이라도 비면 안 된다
- **방향 — 왼쪽으로.** 기체 그림이 전부 왼쪽을 본다(`js/sprites.js`). 그래서 탄 · 광선은 **오른쪽에서 왼쪽으로** 날아가는 모양, 베기는 왼쪽의 상대를 베는 모양으로 그린다. 아군 쪽은 엔진이 뒤집는다
- 결 — 이그니스 레인과 같은 **도트 VFX**(논리 64 × 64 칸 · 균일한 정사각 격자 · 최근접 확대 · 종류마다 8색 이내 · 부드러운 번짐 없음). 게임에서 논리 1px = 화면 2px 로 찍는다
- 색 — 종류가 한눈에 갈리게. 권장: 사격 크림 · 금 / 포격 주황 · 적 / 미사일 주황 · 회색 연기 / 광선 하늘 · 흰 / 참격 은 · 청백 / 타격 황토 · 금 / 찌르기 청백. 상태는 1절 표의 색

### 프롬프트 틀 (이그니스 레인에서 통한 것을 줄였다)

```
Asset type: production VFX sprite atlas for a 2D pixel-art robot battle game. One square image, exactly 2 columns by 2 rows,
four equal square cells, no dividing lines. Draw only four isolated VFX sprites on a genuinely fully transparent alpha background.
No robot, no scene.
Primary request: <종류 이름> effect, travelling / facing from RIGHT to LEFT.
Top-left cell: <칸 0>. Top-right cell: <칸 1>. Bottom-left cell: <칸 2>. Bottom-right cell: <칸 3>.
Style: STRICT hand-placed arcade pixel art, logical 64x64 per cell, nearest-neighbor enlargement, one uniform square pixel grid,
max 8 colors (<색>), crisp stepped edges, binary alpha.
Composition: each sprite inside its own cell with 8 logical pixels of clear margin on every edge.
Avoid: checkerboard pattern, black/white/solid backgrounds, text, borders, grid lines, floor, shadows, smoke clouds filling the cell,
gradients, soft glow, blur, anti-aliasing, robot characters.
```

체크무늬가 나오면 '배경 지우기' 수정을 시키지 말고 **새로 생성**한다(이그니스 레인 기록 — 수정본도 체크무늬였다).

## 3. 공격 자세 규격 (기체마다)

때리는 순간 원본 그림을 이 그림으로 잠깐 바꾼다(엔진이 원본 자리에 맞춘다). 없으면 원본 그대로 + 돌진/반동.

- 파일 `assets/motions/attack/<기체 id>.png` (예 `azure.png`)
- **원본과 같은 440 × 420 RGBA 캔버스** · 진짜 투명 · **왼쪽을 본다** · 발끝 y = 408 근처(어긋나면 검사가 dx · dy 로 맞춘다)
- **같은 기체다** — 머리 · 장갑 · 도장 · 비율 · 무기는 원본 그대로, **자세만** 바뀐다. 키는 원본의 85 ~ 120%
- 반드시 **원본 PNG 를 참고 이미지로 넣은 편집**으로 만든다(새로 그리게 하지 않는다)
- 자세 — 종류마다: 사격 = 총을 앞으로 겨누고 반동 / 포격 = 버티고 포를 쏜 직후 / 미사일 = 포드가 열려 발사 / 광선 = 무기를 앞으로 내밀어 충전 /
  참격 = 칼을 휘두른 직후(몸이 앞으로) / 타격 = 해머 · 주먹이 내려찍힌 순간 / 찌르기 = 창을 끝까지 뻗음
- **원본 재해석 금지 규칙**(`docs/art/ignis-animation-rules.md`)의 예외다. 그래서 **기체마다 사용자 승인**을 받는다. 승인 전에는 목록에 올라도 커밋하지 않는다

검사가 거르는 것 — 크기 · 귀퉁이 투명 · 체크무늬 · 키 85 ~ 120% · **방향 반대**(좌우 뒤집은 원본과 더 겹치면 불합격).
경고만 하는 것 — 발 위치 40px 넘게 어긋남 · 원본과 겹침 0.35 미만(다른 기체처럼 보일 수 있다) · 색이 원본과 50% 미만으로 겹침.

### 프롬프트 틀

```
Edit the attached robot image. Keep EXACTLY the same robot: same head, armor plates, paint colors, markings, proportions,
weapon design and pixel-art rendering. Keep facing LEFT. Keep the same canvas size (440x420), same scale, feet on the same ground line.
Change ONLY the pose: <자세 한 줄>.
Real transparent background (alpha), no checkerboard, no floor, no shadow, no effects, no text.
```

## 4. 순서

| 단계 | 그림 | 확인 |
|---|---|---|
| **1 시범** | `motion-slash.png` · `motion-cannon.png` · `motion-status-a.png` + 자세 `azure.png`(참격) · `kestrel.png`(포격) | 미리보기에서 AZURE vs KESTREL 실전 재생 → 사용자 승인 |
| 2 이펙트 마저 | shot · missile · beam · smash · thrust · status-b | 종류마다 기체 하나씩 미리보기 |
| 3 자세 넓히기 | 사용자가 고른 기체부터(EP · 인기 기체) | 기체마다 승인 |

그림마다 생성 방식 · 프롬프트 · SHA-256 을 `docs/art/attack-motion-assets.json` 에 남긴다(이그니스 레인과 같다).

## 5. 화면에 붙이기 (시범 승인 뒤 · GPT)

`createMotion(arena, { speed, anchor })` — `js/ignis-rain.js` 의 `createIgnisRain` 과 같은 모양(아레나 위 캔버스 한 장 · 체력 막대 아래로 자른다 · 화면을 떠나면 정리).

- `skill` 사건 → `m.skill(key, type)` · `hit` 사건 → `await m.hit({ a, d, type, miss, crit, index, low })`(맞는 순간에 풀린다 — 피해 숫자를 그때 띄우면 맞는다)
- `heal`(수리) · `shield` · `mark` · `jam` → `m.status(kind, key)`. 흡혈은 엔진이 스킬 타격에 붙인다
- 1 : 1 은 `key` = `'p'` · `'e'`(`#fighter-p` · `#fighter-e`). 합동전 · 난투는 `anchor: key => 그 칸의 요소` 를 넘긴다
- 지금의 돌진(`lunge`) · 흔들림(`shakeF`) · 피해 숫자는 그대로 둔다. 이그니스 스킬 타격은 이그니스 레인이 맡는다(motion 은 건너뛴다)
- 모션 줄이기 설정이면 엔진이 흩어짐 한 칸만 그리고 자세를 바꾸지 않는다
