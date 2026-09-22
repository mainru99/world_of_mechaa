# 개발 계보 · 숙련 — 계획 초안

작성: 2026-09-22 · Claude (main). 상태: **초안. 사용자 결정 전 — 구현 · 수치 · DB · 배포 없음.**
계보도: [`lineage-draft-2026-09-22.html`](lineage-draft-2026-09-22.html) (브라우저로 열면 기체를 눌러 앞뒤 계보와 잇는 이유를 본다).
성장 곡선: [`robot-curves-2026-09-22.html`](robot-curves-2026-09-22.html) · 다시 뽑기 `node tools/curves.mjs` (`--gaps` 는 등급 간격 요약).

## 왜

- 최대 레벨(60) 뒤에 쫓을 목표가 없다. 파일럿 레벨이 계정 공용이라 **기체 하나를 오래 키우는 축**도 없다.
- 약한 기체를 쓸 이유, 도감을 뽑기 말고 노력으로 채우는 길을 만든다.

## 구조 (제안)

- **숙련은 기체마다 따로.** 그 기체로 싸우면 오르고, 이기면 더 오른다.
- 숙련 단계를 넘을 때마다 **다음 기체의 조각**을 준다. 조각 · 조립은 지금 기능(보관함 · `SHARD_NEED`)을 그대로 쓴다.
  이미 가진 기체의 조각은 지금처럼 `DUPE_GAIN` 으로 바뀐다.
- 계보는 격자가 아니라 나무 — 뽑을 수 있는 43종(C 10 · UC 9 · R 8 · UQ 8 · EP 8)을 8갈래 37연결로 이었다.
  스토리 기체 4종은 넣지 않는다(당분간 얻을 수 없다 — 2026-09-22 사용자 결정).

| 갈래 | 흐름 |
|---|---|
| 치명 | DUNE → RANGER → AZURE → ORACLE → AURIC |
| 회피 연격 | CHALK → TRACER → TEMPEST → SPECTER → IGNIS |
| 표적 · 제압 | LENS → TRACER → ORBIT → ZEALOT → TYRANT |
| 관통 · 결전 | GRIT → KESTREL → COBALT → HALO → ATLAS / STATIC → SWIFT → VEGA → HALO |
| 폭발 화력 | RUST → VANGUARD → HOWITZER → HEX → NEMESIS |
| 요새 · 방벽 | MULE → BASTION → GLACIER → NEBULA → BEHEMOTH / HUSK → PATCH → GLACIER |
| 흡혈 | GLACIER → WRAITH → SERAPH |
| 파쇄 연격 | SCARAB → SHRIKE → LANCER → UMBRA → SOVEREIGN / MORTAR → MANTIS → LANCER |

갈림 2곳(TRACER · GLACIER) · 합류 4곳(TRACER · GLACIER · HALO · LANCER).

## 약점 — 트리가 단조롭다

기체 수가 위로 갈수록 줄거나 같아서(10 → 9 → 8 → 8 → 8) 길이 모이기만 한다. 특화기술도 등급마다 끊겨,
약한 연결 5곳(STATIC→SWIFT · ZEALOT→TYRANT · LANCER→UMBRA · UMBRA→SOVEREIGN · GLACIER→WRAITH) 중 4곳이 여기서 생겼다.

| 특화기술 | C | UC | R | UQ | EP |
|---|---|---|---|---|---|
| 교란 | STATIC | — | **—** | ZEALOT | — |
| 수리 | — | PATCH | **—** | **—** | — |
| 파쇄 | MORTAR | SHRIKE | **—** | **—** | SOVEREIGN |
| 처형 | — | SWIFT | VEGA | **—** | SOVEREIGN |
| 표적 | LENS | — | ORBIT | **—** | BEHEMOTH |
| 방벽 | HUSK | — | **—** | NEBULA | BEHEMOTH |

**제안 — R · UQ 에 3기씩 추가**(그림 부담이 크면 R 교란 · R 파쇄 · UQ 수리 · UQ 처단 4기).
C 10 · UC 9 · R 11 · UQ 11 · EP 8 이 되어 중간이 넓어지고 갈림이 7~8곳으로 는다(추정).
높은 등급 지원기(수리 · 방벽 · 표적)가 생겨 합동전 · 레이드 편성도 산다. EP 확률은 그대로다.

| 등급 | 역할 | 자리 | 풀리는 곳 |
|---|---|---|---|
| R | 교란 | STATIC → **R 교란** → ZEALOT | STATIC→SWIFT |
| R | 수리 | PATCH → **R 수리** → UQ 수리 | 수리 줄이 UC 에서 끊김 |
| R | 파쇄 | MORTAR · SHRIKE → **R 파쇄** → UQ 처단 | LANCER→UMBRA |
| UQ | 수리 | R 수리 → **UQ 수리** → SERAPH | GLACIER→WRAITH 억지 갈림 |
| UQ | 처형 · 파쇄 | R 파쇄 · VEGA → **UQ 처단** → SOVEREIGN | UMBRA→SOVEREIGN |
| UQ | 표적 | ORBIT → **UQ 표적** → TYRANT · BEHEMOTH | ZEALOT→TYRANT |

그림 없이 더하는 길 — **설계 연결**: 두 기체의 숙련을 모두 채우면 열리는 EP(예: HALO + HEX → ATLAS). 위와 함께 쓸 수 있다.

## 뽑기와의 관계 — 뽑기의 이유를 지킨다

1. **속도 차이** — 계보는 느리지만 확실, 뽑기는 빠르지만 운. 목표 예: 원하는 EP 하나를 계보로 얻는 기간 ≥ 뽑기로 아무 EP 하나를 얻는 기대 기간의 3배.
   피로도가 기체별이라 한 기체만 종일 돌릴 수도 없다. 수치는 `play.mjs` 30일 경제로 정한다.
2. **뽑기 = 계보의 지름길** (핵심) — 계보는 가진 기체에서 이어지므로, 뽑은 UQ 는 곧 EP 한 칸 앞이다.
3. (선택) **중복 기체 → 그 기체 숙련** — 다 모은 뒤에도 뽑기를 돌릴 이유가 남는다. 경제 측정 뒤 정한다.
4. (보류) 계보는 UQ 까지만 · EP 조립에 코어 요구 — 1~3 으로 모자랄 때만.

## GPT 코어 서킷 계획과의 관계 — 정할 것

같은 날 ChatGPT 가 [기체별 선택 특성 — 코어 서킷](mech-traits-plan-2026-09-22.md)을 올렸다(기체마다 6노드, 포인트 = `floor(level/2)`, 최대 30).
둘 다 '기체마다의 성장' 이다. 코어 서킷의 포인트는 파일럿 레벨에서 나와 **모든 기체가 같은 포인트**를 받는다.
합칠 수 있는 길 — 숙련이 조각(계보)과 함께 **그 기체의 특성 포인트 일부**도 주면, 오래 쓴 기체가 더 깊어진다.
다만 능력치가 붙으면 매칭 · 성장 곡선이 흔들리므로 두 계획을 같이 놓고 한 번에 정한다.

## 정할 것

1. 약한 연결 5곳 — 그대로 · 짝 바꾸기 · 새 기체로 풀기(위 제안)
2. 새 기체 — R · UQ 6기 / 4기 / 없이 설계 연결만
3. 갈림길 조각 — 플레이어가 고른다(추천) · 번갈아
4. 숙련이 능력치도 올리나 — 조각만(추천) · 코어 서킷 포인트와 연결
5. 적립 대상 — 연습전 빼고 전부 · 합동전은 두 기 모두(추천)
6. 화면 없는 동안 — 서버 먼저 배포해 숙련만 쌓고 조각은 화면이 생기면 소급(추천) · 화면까지 보류
7. EP 최대 숙련 보상 — 칭호 · 칭호 + 코어 · 다른 갈래 EP 조각
8. 뽑기 관계 — 위 1 · 2 기본, 3 은 측정 뒤

## 순서 (결정 뒤)

| 단계 | 내용 | 비고 |
|---|---|---|
| ① | 계보표 확정(+ 새 기체면 그림 → 이름 · 수치 · 스킬) | 사용자 결정 |
| ② | `tools/play.mjs` 최신화 — 전선 · 구간 · 도감 · 상점 · 합동전 · 숙련 | 수치의 바탕 |
| ③ | 수치 — 판당 숙련 · 단계 수 · 단계별 조각 | 30일에 계보로 2~4기 · 뽑기 가치 유지 |
| ④ | 이관(스키마 번호는 구현 직전 최신 다음) · 서버 정산 5곳 · `masterycheck` | main 에서 배포 가능 |
| ⑤ | 화면 — 격납고 숙련 막대 · 계보도 | **UI 개편 뒤.** API 모양을 CONTRACT 에 적어 넘긴다(화면 동결) |
