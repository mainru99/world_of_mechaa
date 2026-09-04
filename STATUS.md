# 진행 상황 — 한 것 / 남은 것

이어서 작업할 때 여기부터 읽는다. 설치·셋업 절차는 [`server/SETUP_KO.md`](server/SETUP_KO.md),
ChatGPT(Codex) 와의 담당 분담은 [`CONTRACT.md`](CONTRACT.md) 에 있다.

- **배포 주소** — https://rowar.hun7539.workers.dev (공개, Cloudflare Workers + D1)
- **리포** — https://github.com/mainru99/world_of_mechaa (private)
- **마지막 갱신** — 2026-09-04 · 커밋 `9ec7810`
- **지금 단계** — 서버 판정 전환이 끝났다. 게임 조작은 전부 온라인 전용이고, 오프라인에서는 보기만 된다.

---

## 집에서 이어서 시작하기

```bash
git clone https://github.com/mainru99/world_of_mechaa.git
cd world_of_mechaa
npm install
npx wrangler login
```

`wrangler.jsonc` 는 커밋되어 있으므로 D1 을 다시 만들 필요는 없다. 확인:

```bash
npx wrangler d1 execute rowar --remote --command="SELECT COUNT(*) FROM account"
```

배포는 **반드시 `npm run deploy`** 로 한다. `npx wrangler deploy` 를 직접 부르면
`dist/` 빌드를 건너뛰어 고친 파일이 안 올라간다 (실제로 한 번 겪었다).

```bash
npm run deploy      # node server/build.mjs && wrangler deploy
```

---

## 한 것

### 클라이언트 (v0.5)
| | 내용 |
|---|---|
| 기체·전투 | 로봇 30종 5등급 + 몬스터, 시드 기반 결정적 전투 시뮬레이션 |
| 성장 | 레벨 전부 1부터 · 전투 경험치 + 크레딧 즉시 레벨업 (`MAXLV` 50) |
| 피로도 | 전투마다 누적, 크레딧 정비로 초기화, **시간이 지나면 자연 회복** (레벨이 높을수록 빨리) |
| 뽑기 | 기체·파츠 외에 크레딧·코어·꽝 포함 |
| 연출 | 화면별 배경 테마(격납고 A / 대전 B / 아레나 C), 좌우 반전으로 마주보게 배치 |
| 접근성 | 피격 섬광 완화 + 340ms 제한 (초당 3회 이하, WCAG 2.3.1) · `prefers-reduced-motion` 대응 |
| 대문 | 타이틀 화면에서 시작하기 / 계정·로그인 |

### 서버 (Cloudflare Workers + D1)
| 커밋 | 내용 |
|---|---|
| `929eabe` | D1 무료 한도에 맞춘 스키마 최적화 (읽기 36,887행 → 133행) |
| `8238ebc` | Worker 뼈대 배포 |
| `12e2056` | 게스트(익명) 계정 — 회원가입 없이 바로 플레이 |
| `2d33291` | 진행상황 동기화 — 기기 간 이어하기, 바뀐 행만 쓰는 차등 저장 |
| `50f09f2` | **뽑기 서버 판정** |
| `c1b50da` | **전투 서버 판정** — 상대·시드·승패·보상 전부 |
| `f7c6142` | **격납고 서버 판정** + 임의 상태 업로드 차단 |
| `2cad0f5` | 아레나 등록과 **실제 사람 상대 매칭** + Elo 레이팅 |
| `37eaf79` | 정식 계정 승계 — 게스트에 아이디·비밀번호를 붙인다 (PBKDF2-SHA256 10만 회) |
| `d97f13c` | 로그인 시도 제한 (아이디 5회 / IP 30회 → 15분 잠금) + 대문 |
| `9ec7810` | 대문에서 계정·로그인을 대문 위에서 처리 · 접속 후 화면 재렌더 |

### 신뢰 경계 — 지금 서버가 정하는 것
- 뽑기 결과, 전투 상대·시드·승패·보상, 장착·강화·레벨업·정비 비용과 가능 여부
- **피로도 정산은 서버 시각으로만** 한다. 기기 시계를 돌려도 소용없다.
- `PUT /api/state` 는 최초 이관(`rev == 0`)에만 열려 있고 그 뒤로는 403.

### API
| 메서드 | 경로 | 용도 |
|---|---|---|
| GET | `/api/health` | 상태 확인 (계정 수·아레나 등록 수·밸런스 버전) |
| POST | `/api/auth/guest` | 게스트 계정 생성·복귀 |
| POST | `/api/auth/register` | 지금 계정에 아이디·비밀번호를 붙인다 |
| POST | `/api/auth/login` `/logout` | 로그인 / 로그아웃 |
| GET | `/api/me` | 내 계정 정보 |
| GET/PUT | `/api/state` | 상태 조회 / 최초 이관 |
| POST | `/api/pull` | 뽑기 |
| POST | `/api/battle/find` `/start` | 상대 찾기 / 전투 실행 |
| POST | `/api/hangar` | 장착·해제·강화·레벨업·정비·출전선택 |

DB 는 테이블 9개, `schema_version 5`. 마이그레이션은 `server/migrations/` 에 있다.

---

## 남은 것

우선순위 순. 괄호 안은 손댈 파일이다.

1. **랭킹 화면** — `player.rank_cached` 를 Cron 으로 주기 갱신한다.
   실시간 계산은 하위권이 2만 행을 읽어서 무료 한도가 바로 마른다.
   (`wrangler.jsonc` 의 `triggers.crons` 주석 해제 → `server/worker.js` 에 `scheduled` 핸들러)
2. **비밀번호 찾기** — `account.email` 컬럼만 만들어 두고 안 쓰고 있다.
   지금은 비밀번호를 잊으면 복구 수단이 없다. (`server/auth.js`, `js/game.js` 계정 화면)
3. **정리 작업 Cron** — 오래된 `login_attempt` · `arena_entry` 삭제, 전투 기록을 플레이어당 50판으로 유지.
   (`server/` 에 새 모듈)
4. **요청 수 줄이기** — 진짜 천장은 D1 이 아니라 **Workers 요청 10만/일** 이다.
   접속당 21요청이면 4,761 접속이 상한. `battle/find` 와 `battle/start` 를 한 요청으로 합치면
   21→13 이 되어 7,692 접속까지 간다. (`server/battle.js`, `js/net.js`)
5. **오프라인 연습 모드** — 보상 없는 전투. `js/rewards.js` 가 순수 함수라 어렵지 않다.
   지금은 서버가 없으면 아무것도 못 해서 첫인상이 나쁘다.
6. **최초 이관 막기** — 아래 '남아 있는 구멍' 참조.

---

## 알아 둘 것

### 남아 있는 구멍
`PUT /api/state` 의 최초 이관(`rev == 0`)은 클라가 보낸 값을 그대로 받는다.
새 게스트 계정을 만들어 강한 상태를 한 번 심을 수 있다.
localStorage 저장본을 가진 기존 플레이어를 위해 열어 둔 문이므로,
**이관이 더 필요 없어지면 아예 닫는 것**이 가장 깔끔하다. 당장 닫기 어려우면 값에 상한을 둔다.

### 밸런스를 고칠 때
`data/balance.js` 는 클라와 Worker 가 **같이** import 한다. 그래서

- 한쪽만 배포하면 서버가 클라의 전투를 위조로 판정한다. **반드시 같이 배포한다.**
- `arena_entry.snapshot.stats` 는 계산이 끝난 값을 캐시한다. `balance_ver` 가 자동으로 달라져
  옛 스냅샷은 매칭에서 걸러지지만, 그만큼 매칭 후보가 줄어드는 것은 감안해야 한다.

### 이 PC 의 `wrangler dev` 문제
`wrangler dev` 가 15초쯤 뒤 빈 `[ERROR]` 를 뱉고 죽는다 (요청은 정상 처리되다가
miniflare ProxyController 에서 종료). 그래서 이렇게 나눠서 확인했다.

- 클라이언트만 볼 때 → `python -m http.server 8123` (서버가 없으니 오프라인 표시가 된다)
- 서버까지 볼 때 → `npm run deploy` 후 배포 주소에서 확인

집 PC 에서는 정상일 수 있으니 먼저 `npx wrangler dev` 를 시도해 볼 것.

### 무료 한도 (2026-09-04 실측)
접속 1회 = 전투 8판 + 10연차 2번 + 순위 조회 1회 기준으로 읽기 133행 / 쓰기 30.3행.
쓰기 기준 하루 **3,300 접속**, Workers 요청 기준 **4,761 접속**이 상한이다.
