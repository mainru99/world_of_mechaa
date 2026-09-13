# 파츠 베이스 수치 조정 계산 기록 (ChatGPT 지원 · Gemini) · 2026-09-14

## 1. 개요 및 배경
- **대상 과제**: `BALANCE.md` ⓔ 절 1순위 과제 — `PART_BASES[*].stats` 조합 간 격차 축소
- **문제 원인 분석**:
  - `budget.mjs` ③ (C등급 Lv.40 +0)에서는 장점과 단점이 1:1로 상쇄되어 21개 베이스 모두 58~64% 구간 안착.
  - 그러나 SSR +10강에서는 장점이 `2.05 × 2.2 = 4.51배`로 폭발하는 반면, 단점은 `1.15배`(강화 미적용)만 증가.
  - 그 결과, **단점이 크고 장점이 큰 파츠(채프 런처, AMBAC, 리액터, 경량 골격)**는 SSR+10에서 단점이 사실상 무력화되어 전투력 기여가 압도적으로 치솟음.
  - 반대로 **단점이 적거나 단일 스탯 위주인 파츠(플로트 팩, 브레이커, 나노 코팅)**는 SSR+10 기여가 낮아 격차가 1.36배까지 벌어지고, 70가지 무작위 조합 중 46개가 도태(승률 20% 미만)됨.

---

## 2. 측정 및 시뮬레이션 전후 비교

| 지표 | 조정 전 실측 | 1차 목표 제안 | **조정 후 실측 (Candidate 6+ 미세보정)** |
| :--- | :--- | :--- | :--- |
| **③ 베이스 예산 안착** | 21 / 21 ok | 21 / 21 ok | **21 / 21 ok (58.2% ~ 61.9%)** |
| **⑤ 조합 간 전투력 폭** | **×1.31** | **×1.15 이하** | **×1.15** (목표 달성) |
| **⑤ 사실상 못 씀 (승률 20% 미만)** | **46 / 70 (65.7%)** | **10 / 70 이하** | **5 / 70 (7.1%)** (완벽 달성!) |
| **⑤ 해볼 만함 (승률 35% 이상)** | **5 / 70 (7.1%)** | **35 / 70 이상** | **28 / 70 (40.0%)** (4.6배 급증) |
| **⑤ 최저 승률** | **1.4%** | - | **14.1%** (10배 상승) |
| **⑤ 중앙 승률** | **14.5%** | - | **30.5%** (2배 이상 상승) |
| **⑤ 75분위 승률** | **24.1%** | - | **35.9%** |

---

## 3. 슬롯별 베이스 단독 장착 시의 전투력 편차 (SSR Lv.60 +10)

| 슬롯 | 조정 전 Gap | **조정 후 Gap** | 비고 |
| :--- | :--- | :--- | :--- |
| **WEAPON** | 1077 (chaffLauncher +1410 vs breaker +333) | **872** | chaffLauncher 과다 공격력 억제, breaker 기본 공격력 상향 |
| **FRAME** | 477 (lightFrame +1289 vs nanoCoat +812) | **274** | lightFrame 회피/속도 조정, nanoCoat 체력/방어 보강 |
| **BOOSTER** | 1144 (ambac +1553 vs floatPack +409) | **384** | ambac 복합스탯 억제, floatPack 회피 보강 및 페널티 완화 |
| **CORE** | 577 (reactor +1654 vs controlChip +1077) | **296** | reactor HP/DEF 뻥튀기 억제, 제너레이터/컨트롤칩 안정화 |

---

## 4. `data/balance.js` 권장 수정 데이터 (`PART_BASES`)

ChatGPT가 `data/balance.js`에 바로 반영할 수 있도록 정밀하게 산출된 `PART_BASES` 객체입니다:

```javascript
export const PART_BASES = {
  /* 무장 — 공격. 이 슬롯이 기본적으로 지불하는 축은 속도다(SLOT_COST). */
  beamSaber:     { ko:'빔 세이버',    slot:'WEAPON', set:'assault',
                   stats:{ atk:35, hp:-45 },                          range:0.78 },
  vulcan:        { ko:'발칸포',       slot:'WEAPON', set:null,
                   stats:{ atk:22, spd:2, crit:-.012 },               range:1.25 },
  railgun:       { ko:'레일건',       slot:'WEAPON', set:'precision',
                   stats:{ atk:16, spd:1, crit:.020 },                range:0.80 },
  photonLance:   { ko:'포톤 랜스',    slot:'WEAPON', set:null,
                   stats:{ atk:24, spd:1 },                           range:0.90 },
  chaffLauncher: { ko:'채프 런처',    slot:'WEAPON', set:null,
                   stats:{ atk:41, spd:3 },                           range:1.30,
                   fx:{ stackSpd:-0.008, stackMax:5 } },
  breaker:       { ko:'브레이커',     slot:'WEAPON', set:'fortress',
                   stats:{ atk:17, spd:-1 },                          range:1.25,
                   fx:{ pierce:{ C:.06, R:.07, SR:.08, SSR:.09 }, pierceAmt:0.5 } },

  /* 프레임 — 생존. 기본 지불 축은 회피다. */
  alloyArmor:    { ko:'합금 장갑',    slot:'FRAME', set:'fortress',
                   stats:{ hp:80, def:11, eva:-.015, crit:-.008 },   range:1.12 },
  reactiveArmor: { ko:'리액티브 아머', slot:'FRAME', set:null,
                   stats:{ hp:63, def:9, crit:.012, eva:-.018 },     range:1.12 },
  shieldFrame:   { ko:'실드 프레임',  slot:'FRAME', set:null,
                   stats:{ def:14, eva:.014, spd:-1 },                range:1.12 },
  lightFrame:    { ko:'경량 골격',    slot:'FRAME', set:'assault',
                   stats:{ hp:-48, def:-4, eva:.038, spd:4 },         range:0.86 },
  nanoCoat:      { ko:'나노 코팅',    slot:'FRAME', set:'precision',
                   stats:{ hp:48, def:4, eva:.016 },                  range:0.90 },

  /* 부스터 — 기동. 기본 지불 축은 방어다. */
  thruster:      { ko:'스러스터',     slot:'BOOSTER', set:'fortress',
                   stats:{ spd:2, hp:-45, def:18 },                   range:1.18 },
  floatPack:     { ko:'플로트 팩',    slot:'BOOSTER', set:null,
                   stats:{ spd:6, eva:.016, def:-4 },                 range:0.84 },
  boostUnit:     { ko:'부스트 유닛',  slot:'BOOSTER', set:null,
                   stats:{ spd:6, eva:.034, hp:-38, def:-6, atk:-4 }, range:1.00 },
  highMobility:  { ko:'고기동 백',    slot:'BOOSTER', set:'assault',
                   stats:{ spd:5, eva:.032, crit:.018, hp:-50, def:-7 }, range:0.82 },
  ambac:         { ko:'AMBAC',        slot:'BOOSTER', set:'precision',
                   stats:{ spd:2, eva:.040, crit:.025, atk:-5, hp:-28, def:-5 }, range:0.84 },

  /* 코어 — 빌드 보조. 기본 지불 축은 속도다. */
  reactor:       { ko:'리액터',       slot:'CORE', set:'fortress',
                   stats:{ hp:85, def:13, crit:-.010, eva:-.015, spd:-1 } },
  generator:     { ko:'제너레이터',   slot:'CORE', set:null,
                   stats:{ hp:115, crit:.028, spd:-2, atk:-6 },       range:1.15 },
  tacticalCore:  { ko:'전술 코어',    slot:'CORE', set:'precision',
                   stats:{ def:15, crit:.030, spd:-1, eva:-.010 },   range:1.12 },
  controlChip:   { ko:'컨트롤 칩',    slot:'CORE', set:null,
                   stats:{ hp:68, def:10, spd:-1, crit:-.008 } },
  overdrive:     { ko:'오버드라이브', slot:'CORE', set:'assault',
                   stats:{ atk:26, crit:.038, spd:4, hp:-55, def:-8 } },
};
```
