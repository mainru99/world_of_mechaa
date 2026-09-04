# Cloudflare D1 + Worker 셋업 체크리스트

집에서 이어서 작업하기 위한 순서표. 명령어는 2026-09-04 기준 Cloudflare 공식 문서로 확인했다.
버전이 올라가면 플래그가 바뀔 수 있으니, 막히면 `npx wrangler d1 --help` 로 먼저 확인할 것.

> **현재 상태** (2026-09-04 갱신)
> - Cloudflare 계정 `hun7539@naver.com`, D1 `rowar` 생성 완료, 스키마 원격 적용 완료(테이블 8개)
> - Worker 뼈대 배포 완료 → **https://rowar.hun7539.workers.dev**
> - 게스트(익명) 계정 + **진행상황 동기화**까지 완료
>   `POST /api/auth/guest` · `GET /api/me` · `GET/PUT /api/state`
> - 기기 간 이어하기 확인됨. 브라우저 저장본을 지워도 서버에서 복원된다.
> - **뽑기는 서버가 판정한다** (`POST /api/pull`). 클라가 보낸 결과는 받지 않는다.
>   그래서 뽑기는 온라인 전용이다 — 오프라인에서 굴리게 두면 끊고 굴린 뒤 올리면 그만이다.
> - **전투도 서버가 판정한다** (`POST /api/battle/find` → `/battle/start`).
>   서버가 상대·시드·승패·보상을 정하고, 클라는 같은 시드로 애니메이션만 재생한다.
> - **격납고 조작도 서버가 판정한다** (`POST /api/hangar`) — 장착·해제·강화·레벨업·정비·출전선택.
>   비용 계산과 가능 여부를 서버가 하므로 크레딧을 쓰지 않고 레벨을 올릴 수 없다.
> - `PUT /api/state` 는 **최초 이관(rev 0)에만** 열려 있다. 그 뒤 임의 상태 업로드는 403.
> - 그래서 게임 조작은 전부 온라인 전용이다. 오프라인에서는 보기만 된다.

---

## 0. 준비물

| 항목 | 확인 |
|---|---|
| Node.js | 이 PC 는 v24.11.1 (18 이상이면 된다) |
| npm | 11.7.0 |
| Cloudflare 계정 | **필요** — 무료로 가입 |
| wrangler | 아직 미설치 (아래 1번) |

---

## 1. wrangler 설치와 로그인

리포 안에 개발 의존성으로 넣는다. 전역 설치는 버전이 섞여서 권하지 않는다.

```bash
cd rowar
npm init -y
npm install --save-dev wrangler
npx wrangler --version
```

```bash
npx wrangler login
```

브라우저가 열리고 계정 권한을 묻는다. 끝나면 `npx wrangler whoami` 로 확인.

---

## 2. D1 데이터베이스 만들기

```bash
npx wrangler d1 create rowar
```

출력에 `database_id` 가 나온다. **이 값을 설정 파일에 넣어야 한다.**
"Would you like Wrangler to add it on your behalf?" 를 물으면 **Yes** 를 고르면 자동으로 적어 준다.

---

## 3. 설정 파일

`server/wrangler.jsonc.example` 을 리포 루트에 `wrangler.jsonc` 로 복사하고 `database_id` 를 채운다.

```bash
cp server/wrangler.jsonc.example wrangler.jsonc
```

> `wrangler.jsonc` 는 **커밋한다.** `database_id` 는 비밀값이 아니고(그것만으로는 접근할 수 없다,
> 계정 인증이 따로 필요하다), 커밋해 두어야 다른 PC 에서 클론했을 때 설정을 다시 만들지 않는다.

---

## 4. 스키마 적용

로컬 먼저, 확인되면 원격.

```bash
# 로컬 (내 PC 안의 SQLite 파일)
npx wrangler d1 execute rowar --local --file=./server/schema.sql

# 원격 (진짜 D1)
npx wrangler d1 execute rowar --remote --file=./server/schema.sql
```

확인:

```bash
npx wrangler d1 execute rowar --local --command="SELECT name FROM sqlite_master WHERE type='table'"
```

`account · session · part · robot · player · arena_entry · battle · meta` 여덟 개가 나오면 된다.

---

## 5. 정적 파일 서빙 — `dist/` 를 만들어서 올린다

Worker 하나가 게임 파일과 API 를 같이 서빙한다. 다만 **리포 루트를 그대로 올리면
`server/schema.sql`, `CONTRACT.md` 같은 내부 문서까지 공개된다.** 그래서 클라이언트 파일만
`dist/` 로 모아서 올린다.

```bash
node server/build.mjs      # index.html·style.css·js·data·assets·themes 만 dist/ 로 복사
```

라우팅 규칙은 이렇게 된다.

1. 요청 경로에 맞는 정적 파일이 있으면 → 그 파일을 그냥 준다 (Worker 코드는 안 탄다)
2. 없으면 → Worker 스크립트가 처리한다
3. `run_worker_first` 에 적힌 경로(`/api/*`)는 **정적 파일보다 Worker 가 먼저** 본다

---

## 6. 개발 서버와 배포

```bash
npx wrangler dev          # http://localhost:8787
npx wrangler deploy
```

`wrangler dev` 는 기본이 로컬 D1 이다. 원격 DB 를 보게 하려면 `--remote` 를 붙인다.

---

## 7. Worker 가 반드시 해야 하는 것

스키마 검토(2026-09-04)에서 **DB 제약으로는 막을 수 없다고 확인된** 항목들이다.
빠뜨리면 조용히 뚫린다.

- [ ] **파츠 장착 검증** — `part.account_id == robot.account_id` 이고 `part.slot` 이 슬롯과 같은지.
      슬롯 컬럼의 `UNIQUE` 는 '같은 슬롯 중복'만 막고 `A.s_weapon` / `B.s_frame` 교차는 못 막는다.
- [ ] **피로도는 서버 시각으로 정산** — 지금 클라는 `Date.now()` 를 쓴다. 기기 시계를 돌리면
      피로도가 공짜로 사라진다. `robot.fat_at` 을 서버에서만 갱신할 것.
- [ ] **arena_entry 는 전투마다 쓰지 않는다** — 편성·레벨이 바뀔 때만. 피로도는 반영하지 않는다.
- [ ] **arena_entry.rnd 갱신** — 등록·갱신할 때마다 새 난수. 안 넣으면 매칭이 늘 같은 상대를 준다.
- [ ] **balance_ver 확인** — 밸런스를 고치면 옛 스냅샷은 매칭에서 빼거나 다시 계산.
- [ ] **몬스터 전투는 기록하지 않는다** — 전투의 40%다. 쓰기 예산이 여기서 갈린다.
- [ ] **뽑기·전투 판정은 서버가** — 클라가 보낸 결과를 믿지 않는다.
      `data/balance.js` 와 `js/sim.js` 는 DOM 을 안 쓰는 순수 모듈이라 Worker 가 그대로 import 한다.

---

## 8. 무료 한도와 예산

사용자 확인 기준: **읽기 500만 / 쓰기 10만 / 저장 5GB (하루)**, Workers 요청 10만/일.
(요금제는 바뀌니 실제 붙이기 전에 Cloudflare 요금 페이지에서 다시 확인할 것)

2026-09-04 실측 — 접속 1회 = 전투 8판 + 10연차 2번 + 순위 조회 1회 기준

| | 읽기 | 쓰기 | 하루 접속 |
|---|---|---|---|
| 최적화 전 스키마 | 36,887행 | 45.2행 | 135 |
| **현재 스키마** | **133행** | **30.3행** | **3,300** |

- 병목은 **쓰기**(하루 3,300 접속). 저장 용량은 전투 100만 판이 0.46GB 라 여유가 많다.
- 진짜 천장은 **Workers 요청 10만/일**. 접속당 21요청이면 4,761 접속이 상한이다.
  더 늘리려면 요청을 합쳐야 한다 — 예: '상대 찾기'+'전투 결과'를 한 요청으로 하면 21→13,
  그러면 7,692 접속까지 간다. API 설계할 때 정할 것.

---

## 8-1. 회사에서 만들고 집에서 이어갈 때

**서버에 남는 것 — 한 번만 하면 된다**

- Cloudflare 계정
- D1 데이터베이스와 `--remote` 로 적용한 스키마

**PC 마다 다시 해야 하는 것**

- `npx wrangler login` — 인증은 그 PC 사용자 폴더에 저장된다
- `npm install` — `node_modules/` 는 커밋하지 않는다

**커밋해서 들고 가는 것**

- `wrangler.jsonc` (database_id 포함), `package.json`, `package-lock.json`

그래서 회사에서는 4번의 `--remote` 까지 끝내고 `wrangler.jsonc` 를 커밋·푸시해 두면,
집에서는 `git clone` → `npm install` → `npx wrangler login` 세 줄이면 이어서 작업할 수 있다.

---

## 9. 다음에 만들 것 (순서 제안)

1. ~~`server/worker.js` — 라우팅 뼈대 + `/api/health`~~ **완료**
2. ~~익명 계정: `device_key` 로 `account` + `player` + 시작 기체 1기 생성, `session` 토큰 발급~~ **완료**
3. ~~`js/net.js` — 클라 통신 계층~~ **완료** (오프라인 폴백 확인). 다음은 이걸로 상태를 실제로 주고받는 것
4. ~~상태 동기화: localStorage 저장본을 서버로 올리는 이관~~ **완료** (양방향 + 차등 쓰기)
5. ~~서버 판정: 뽑기 → 전투~~ **완료**

> - **실제 사람 상대와 싸운다.** 편성이 바뀔 때마다 `arena_entry` 에 방어 스냅샷을 등록하고,
>   매칭은 전투력 ±15% 안에서 `rnd` 인덱스로 **한 행만 읽어** 고른다.
>   등록자가 없으면 서버가 상대를 만들어 낸다 — 혼자여도 게임이 돌아가야 하므로.
> - 사람 상대 전투만 `battle` 에 기록하고 Elo 로 레이팅을 조정한다.

### 그 다음 후보
- 랭킹 화면 (`rank_cached` 를 Cron 으로 주기 갱신 — 실시간 계산은 하위권이 2만 행을 읽는다)
- 정식 계정 승격(아이디·비번) — 지금은 device_key 를 잃으면 계정도 잃는다
- 오래된 `arena_entry` 정리, 전투 기록 플레이어당 50판 유지
- 오프라인 연습 모드(보상 없는 전투). `js/rewards.js` 가 순수 함수라 어렵지 않다.

### 남아 있는 신뢰 지점
- 최초 이관(`PUT /api/state`, rev 0)은 클라가 보낸 값을 그대로 받는다.
  새 게스트 계정을 만들어 강한 상태를 한 번 심을 수 있다. 이관을 아예 없애거나
  값 상한을 두는 것이 다음 방어선이다.

---

## 참고 명령어

```bash
npx wrangler d1 list                                   # DB 목록
npx wrangler d1 info rowar                             # 크기·행 수
npx wrangler d1 execute rowar --remote --command="SELECT COUNT(*) FROM player"
npx wrangler tail                                      # 배포된 Worker 실시간 로그
npx wrangler d1 --help                                 # 플래그가 바뀌었을 때
```
