# Cloudflare D1 + Worker 셋업 체크리스트

집에서 이어서 작업하기 위한 순서표. 명령어는 2026-09-04 기준 Cloudflare 공식 문서로 확인했다.
버전이 올라가면 플래그가 바뀔 수 있으니, 막히면 `npx wrangler d1 --help` 로 먼저 확인할 것.

> **진행 상황은 [`STATUS.md`](../STATUS.md) 에 있다.** 한 것 · 남은 것 · 알려진 문제를
> 거기 한 곳에만 적는다. 이 문서는 '어떻게 설치하고 배포하는가' 만 다룬다.

---

## 0. 준비물

| 항목 | 확인 |
|---|---|
| Node.js | 이 PC 는 v24.11.1 (18 이상이면 된다) |
| npm | 11.7.0 |
| Cloudflare 계정 | **필요** — 무료로 가입 |
| wrangler | 설치됨 (`package.json` 의 devDependencies). 새 PC 는 `npm install` |

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

`account · session · part · robot · player · arena_entry · battle · login_attempt · meta`
아홉 개가 나오면 된다. 스키마를 고친 뒤에는 `server/migrations/` 의 마이그레이션도 같은 방식으로 적용한다.

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
npm run dev               # 빌드 + wrangler dev (http://localhost:8787)
npm run deploy            # 빌드 + wrangler deploy
```

> `npx wrangler deploy` 를 직접 부르면 **`dist/` 빌드를 건너뛴다.** 고친 파일이 안 올라가므로
> 반드시 `npm run deploy` 를 쓴다.

`wrangler dev` 는 기본이 로컬 D1 이다. 원격 DB 를 보게 하려면 `--remote` 를 붙인다.

---

## 7. Worker 가 반드시 해야 하는 것 — **전부 반영됨**

스키마 검토(2026-09-04)에서 DB 제약으로는 막을 수 없다고 확인했던 항목들이다.
지금은 모두 Worker 에 들어가 있고, 아래는 고칠 때 깨뜨리지 말아야 할 목록으로 남긴다.

- [x] **파츠 장착 검증** — 소유자와 슬롯 일치를 서버가 본다 (`server/hangar.js`)
- [x] **피로도는 서버 시각으로 정산** (`server/battle.js` · `hangar.js` 의 `decayFat`)
- [x] **arena_entry 는 편성·레벨이 바뀔 때만 쓴다** (`server/arena.js`)
- [x] **arena_entry.rnd 갱신** — 등록할 때마다 새 난수. 없으면 늘 같은 상대가 나온다
- [x] **balance_ver 확인** — 옛 밸런스로 만든 스냅샷은 매칭에서 걸러진다
- [x] **몬스터 전투는 기록하지 않는다** — 전투의 40%다
- [x] **뽑기·전투 판정은 서버가** — `data/balance.js` 와 `js/sim.js` 를 Worker 가 그대로 import 한다

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

## 9. 다음에 만들 것

[`STATUS.md`](../STATUS.md) 의 '남은 것' 을 본다.

---

## 참고 명령어

```bash
npx wrangler d1 list                                   # DB 목록
npx wrangler d1 info rowar                             # 크기·행 수
npx wrangler d1 execute rowar --remote --command="SELECT COUNT(*) FROM player"
npx wrangler tail                                      # 배포된 Worker 실시간 로그
npx wrangler d1 --help                                 # 플래그가 바뀌었을 때
```
