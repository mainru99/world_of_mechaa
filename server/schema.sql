-- =========================================================
--  ROWAR 서버 스키마  (Cloudflare D1 / SQLite)
--
--  적용:  npx wrangler d1 execute rowar --local --file=server/schema.sql
--  배포:  npx wrangler d1 execute rowar --remote --file=server/schema.sql
--
--  설계 기준 세 가지
--  ① 클라의 localStorage 덩어리를 그대로 옮기지 않는다. 나중에 서버가
--     뽑기·강화·전투를 직접 판정해야 하므로 기체와 파츠는 각각 행이어야 한다.
--  ② 자주 질의하는 값(rating, power)만 컬럼으로 꺼내고, 나머지는 JSON 으로 둔다.
--     파츠 스탯은 6종 중 1~3개만 굴려지는 희소 구조라 컬럼으로 펴면 낭비다.
--  ③ 아레나는 조인 없이 한 행만 읽고 끝낸다. D1 무료 한도가 '행 읽기' 기준이라
--     매칭 한 번에 테이블 세 개를 훑으면 안 된다.
--
--  무료 한도: 읽기 500만 / 쓰기 10만 / 저장 5GB (일 기준)
--  2026-09-04 실측으로 잡은 예산은 파일 끝 '비용' 절 참고.
-- =========================================================

-- 주의: 이 PRAGMA 는 '이 연결에만' 적용된다. 스키마 파일에 적어도 런타임에
-- 켜지지 않으므로, ON DELETE CASCADE 가 도는 것은 D1 이 기본으로 FK 를
-- 켜 두기 때문이지 아래 한 줄 때문이 아니다. 보장으로 믿지 말 것.
PRAGMA foreign_keys = ON;

-- ── 계정 ────────────────────────────────────────────────
-- 익명으로 먼저 놀게 하고, 원할 때 아이디·비번을 붙여 정식 계정으로 승격한다.
-- 회원가입을 강요하면 웹게임은 첫 화면에서 사람을 잃는다.
--   device_key 만 있음  → 익명 (그 브라우저에서만)
--   login_id 채워짐     → 정식 (어느 기기에서든)
-- SQLite 의 UNIQUE 는 NULL 을 여럿 허용하므로 둘 다 선택적으로 둘 수 있다.
CREATE TABLE IF NOT EXISTS account (
  id          INTEGER PRIMARY KEY,
  device_key  TEXT UNIQUE,                     -- 클라가 만든 UUID (익명 플레이)
  login_id    TEXT UNIQUE,                     -- 회원가입 시 채워짐
  pw_hash     TEXT,                            -- pbkdf2$<반복>$<salt_b64>$<hash_b64>
  email       TEXT,                            -- 나중 (비번 찾기용)
  created_at  INTEGER NOT NULL,                -- epoch ms
  last_seen   INTEGER NOT NULL,
  status      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','banned'))
);
-- email 인덱스는 비번 찾기를 붙일 때 만든다. 지금은 쓰는 질의가 없어
-- 쓰기 비용만 늘리므로 두지 않는다.

-- ── 세션 ────────────────────────────────────────────────
-- JWT 대신 서버 세션을 쓴다. 밴·강제 로그아웃이 한 줄로 되고,
-- D1 에서 토큰 한 행 읽는 비용이 무시할 만하다.
CREATE TABLE IF NOT EXISTS session (
  token       TEXT PRIMARY KEY,                -- 랜덤 32바이트 hex
  account_id  INTEGER NOT NULL REFERENCES account(id) ON DELETE CASCADE,
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_session_account ON session(account_id);
CREATE INDEX IF NOT EXISTS ix_session_expires ON session(expires_at);

-- ── 파츠 ────────────────────────────────────────────────
-- genPart() 가 만드는 것과 같은 모양. stats 는 굴려진 것만 들어간 희소 객체라
-- JSON 으로 둔다. 서버가 어차피 JS 로 읽어 계산하므로 컬럼으로 펴도 이득이 없다.
--
-- 낮은 등급 파츠는 행을 만들지 않는다 — 클라/서버가 뽑는 즉시 스크랩으로
-- 환산한다(자동 분해). 파츠의 52%가 일반 등급이라 이것만으로 쓰기가 눈에 띄게 준다.
CREATE TABLE IF NOT EXISTS part (
  id          INTEGER PRIMARY KEY,
  account_id  INTEGER NOT NULL REFERENCES account(id) ON DELETE CASCADE,
  slot        TEXT NOT NULL CHECK (slot IN ('WEAPON','FRAME','BOOSTER','CORE')),
  name        TEXT NOT NULL,
  rarity      TEXT NOT NULL CHECK (rarity IN ('C','R','SR','SSR')),
  stats       TEXT NOT NULL,                   -- JSON {hp,atk,def,spd,crit,eva} 중 일부
  enh         INTEGER NOT NULL DEFAULT 0 CHECK (enh BETWEEN 0 AND 10),
  uid         TEXT,                            -- 클라이언트가 쓰는 식별자. 동기화 때 행을 짝짓는다
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_part_account ON part(account_id);
CREATE UNIQUE INDEX IF NOT EXISTS ux_part_uid ON part(account_id, uid);

-- ── 기체 ────────────────────────────────────────────────
-- 슬롯은 정확히 넷으로 고정이라 조인 테이블 대신 컬럼 넷으로 둔다.
--
-- 각 슬롯 컬럼의 UNIQUE 는 '같은 파츠가 두 기체의 같은 슬롯에' 들어가는 것만 막는다.
-- A.s_weapon 과 B.s_frame 에 같은 파츠를 넣는 것은 막지 못한다(컬럼별 인덱스라서).
-- 소유자 확인도 FK 로는 안 된다 — 다른 계정의 파츠도 참조된다.
-- 따라서 장착 API 는 서버에서 반드시 두 가지를 확인해야 한다:
--   ① part.account_id == robot.account_id
--   ② part.slot 이 장착하려는 슬롯과 같음
-- (레벨/피로도 상한은 balance.js 값이라 CHECK 로 박지 않는다. 밸런스를 바꾸면
--  DB 가 거부해 버린다. 하한만 건다.)
CREATE TABLE IF NOT EXISTS robot (
  id          INTEGER PRIMARY KEY,
  account_id  INTEGER NOT NULL REFERENCES account(id) ON DELETE CASCADE,
  type        TEXT NOT NULL,                   -- ROBOT_TYPES 키 (seraph, nemesis …)
  -- 아래 두 값은 006 이후 쓰이지 않는다. 레벨은 player 로 옮겼다(파일럿 레벨).
  -- SQLite 에서 컬럼을 지우려면 표를 다시 만들어야 해서 남겨 둔다.
  level       INTEGER NOT NULL DEFAULT 1 CHECK (level >= 1),
  exp         INTEGER NOT NULL DEFAULT 0 CHECK (exp >= 0),
  /* 스킬 강화 단계. 배수는 CONST.SKILL_UP.mult 만큼 곱으로 붙는다.
     첫 강화부터 실패할 수 있고, 실패해도 재화는 나간다. */
  skill_lv    INTEGER NOT NULL DEFAULT 0 CHECK (skill_lv >= 0),
  fat         INTEGER NOT NULL DEFAULT 0 CHECK (fat >= 0),
  fat_at      INTEGER NOT NULL DEFAULT 0,      -- 피로도 자연 회복 정산 시각(서버 시각)
  uid         TEXT,                            -- 클라이언트가 쓰는 식별자. 동기화 때 행을 짝짓는다
  s_weapon    INTEGER UNIQUE REFERENCES part(id) ON DELETE SET NULL,
  s_frame     INTEGER UNIQUE REFERENCES part(id) ON DELETE SET NULL,
  s_booster   INTEGER UNIQUE REFERENCES part(id) ON DELETE SET NULL,
  s_core      INTEGER UNIQUE REFERENCES part(id) ON DELETE SET NULL,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_robot_account ON robot(account_id);
CREATE UNIQUE INDEX IF NOT EXISTS ux_robot_uid ON robot(account_id, uid);

-- ── 진행 상태 ───────────────────────────────────────────
-- 인증(account)과 게임 진행(player)을 나눈다. 진행만 초기화하는 일이 생긴다.
--
-- rank_cached: 순위를 그때그때 세면 안 된다.
--   SELECT COUNT(*)+1 FROM player WHERE rating > ?  는 하위권 플레이어일수록
--   위쪽을 통째로 읽는다(2만 명 기준 19,209행). 무료 한도가 행 읽기 기준이라
--   이 질의 하나가 예산을 다 쓴다. 주기 작업으로 채워 두고 화면은 이 값을 읽는다.
CREATE TABLE IF NOT EXISTS player (
  account_id  INTEGER PRIMARY KEY REFERENCES account(id) ON DELETE CASCADE,
  nickname    TEXT NOT NULL,                   -- 표시용 콜사인
  credits     INTEGER NOT NULL DEFAULT 600  CHECK (credits >= 0),
  cores       INTEGER NOT NULL DEFAULT 12   CHECK (cores   >= 0),
  scrap       INTEGER NOT NULL DEFAULT 30   CHECK (scrap   >= 0),
  wins        INTEGER NOT NULL DEFAULT 0,
  losses      INTEGER NOT NULL DEFAULT 0,
  pulls       INTEGER NOT NULL DEFAULT 0,
  rating      INTEGER NOT NULL DEFAULT 1000,   -- 랭킹 기준
  rev         INTEGER NOT NULL DEFAULT 0,      -- 동기화 리비전. 저장될 때마다 1 오른다
  pending_match TEXT,                        -- /battle/find 가 고른 상대와 시드 (서버가 정한다)
  rank_cached INTEGER,                         -- 주기 계산된 순위 (NULL = 아직 없음)
  rank_at     INTEGER,                         -- 그 순위를 계산한 시각

  -- 레벨은 기체가 아니라 **파일럿**의 것이다. 보유한 기체는 전부 이 레벨로 싸운다.
  -- 예전에는 기체별이었는데, 경험치가 출전한 기체에만 들어가 두 번째 기체를 키울 수가
  -- 없었다(Lv.30 하나에 84판). 그래서 기체 30종과 그 대항 스킬이 전부 죽어 있었다.
  level       INTEGER NOT NULL DEFAULT 1,
  exp         INTEGER NOT NULL DEFAULT 0,

  -- 출격 편성. 데려갈 수 있는 것은 두 기뿐이라, '무엇을 만날지에 대한 베팅'이 된다.
  -- (피로도는 기체별로 남는다 — 그래야 둘을 번갈아 쓸 이유가 생긴다)
  squad1      INTEGER REFERENCES robot(id) ON DELETE SET NULL,
  squad2      INTEGER REFERENCES robot(id) ON DELETE SET NULL,

  -- 원정. 한 번에 하나만 나간다 — 여럿이면 '누구를 보낼까'가 판단이 아니게 된다.
  -- expd_lv 는 보낼 때의 레벨을 박아 둔다(보내 놓고 키운 뒤 받는 이득을 막는다).
  -- expd_end 는 서버 시각. 남은 시간은 클라가 이 값으로 계산하므로 폴링이 없다.
  expd_robot  INTEGER REFERENCES robot(id) ON DELETE SET NULL,
  expd_tier   TEXT,
  expd_lv     INTEGER,
  expd_end    INTEGER,
  sel_robot   INTEGER REFERENCES robot(id) ON DELETE SET NULL,   -- 이번에 나갈 기체(편성 안)
  updated_at  INTEGER NOT NULL
);
-- 랭킹 정렬용. account_id 를 뒤에 붙여 동점 순서를 고정한다.
CREATE INDEX IF NOT EXISTS ix_player_rating ON player(rating DESC, account_id);

-- ── 아레나 등록 (방어 편성 스냅샷) ──────────────────────
-- 상대는 접속해 있지 않다. 그래서 '싸울 수 있는 상태'를 통째로 박아 둔다.
-- snapshot 을 따로 두는 이유 셋:
--   ① 매칭이 조인 없이 한 행 읽기로 끝난다 (무료 한도가 행 읽기 기준)
--   ② 상대가 그 사이 기체를 바꿔도 이미 성사된 전투의 입력이 안 변한다
--   ③ 전투 시뮬은 확정된 스탯 덩어리만 필요하지 파츠 원본이 필요 없다
--
-- rnd: 무작위 상대를 '한 행만 읽고' 고르기 위한 열쇠.
--   ORDER BY RANDOM() 은 조건에 걸린 후보를 전부 읽어 임시 B-트리에 정렬한다
--   (2만 명 기준 2,187행). rnd 를 두고 (power,rnd) 로 찾으면 1행이면 끝난다.
--   등록·갱신할 때마다 새 난수를 넣는다.
--
-- balance_ver: 밸런스를 고치면 snapshot 의 계산된 스탯이 옛 값이 된다.
--   현재 버전과 다른 행은 매칭에서 빼거나 다시 계산해야 한다.
--
-- 갱신 시점: 전투마다 쓰지 않는다. 편성·레벨이 바뀔 때만 갱신한다.
--   피로도는 방어 편성에 반영하지 않는다(쉬고 있는 기체가 지쳐 있을 이유가 없다).
CREATE TABLE IF NOT EXISTS arena_entry (
  account_id  INTEGER PRIMARY KEY REFERENCES account(id) ON DELETE CASCADE,
  nickname    TEXT NOT NULL,
  robot_type  TEXT NOT NULL,
  level       INTEGER NOT NULL,
  power       INTEGER NOT NULL,                -- power() 결과 — 매칭 기준
  rating      INTEGER NOT NULL,
  rnd         INTEGER NOT NULL,                -- 0 ~ 2^30, 등록/갱신 때마다 새로 뽑는다
  balance_ver TEXT NOT NULL DEFAULT '1',       -- snapshot 을 만든 밸런스 버전
  snapshot    TEXT NOT NULL,                   -- JSON {type,level,stats:{...}}
  updated_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_arena_pick   ON arena_entry(power, rnd);
CREATE INDEX IF NOT EXISTS ix_arena_rating ON arena_entry(rating DESC);

-- ── 전투 기록 ───────────────────────────────────────────
-- 시드와 양쪽 스냅샷을 남기면 언제든 같은 전투를 다시 재생할 수 있다.
-- 결정적 시뮬이라 가능한 일이고, 분쟁·버그 추적에 그대로 쓰인다.
--
-- 몬스터 전투는 기록하지 않는다. 상대가 사람이 아니라 다툴 일이 없고,
-- 전투의 40%가 몬스터라 그만큼 쓰기가 준다. (def_kind 는 남겨 둔다 —
-- 나중에 보스전 같은 걸 기록하고 싶어질 수 있다)
CREATE TABLE IF NOT EXISTS battle (
  id           INTEGER PRIMARY KEY,
  attacker_id  INTEGER NOT NULL REFERENCES account(id) ON DELETE CASCADE,
  def_kind     TEXT NOT NULL DEFAULT 'player' CHECK (def_kind IN ('player','monster')),
  def_type     TEXT,                            -- 몬스터일 때 MONSTER_TYPES 키
  defender_id  INTEGER REFERENCES account(id) ON DELETE SET NULL,
  seed         TEXT NOT NULL,
  atk_snap     TEXT NOT NULL,                  -- JSON
  def_snap     TEXT NOT NULL,                  -- JSON
  winner_id    INTEGER REFERENCES account(id) ON DELETE SET NULL,  -- 무승부면 NULL
  atk_delta    INTEGER NOT NULL DEFAULT 0,     -- 공격자 레이팅 변동
  created_at   INTEGER NOT NULL,
  -- 사람 전투면 def_type 이 없고, 몬스터 전투면 상대 계정이 없다.
  -- (defender_id 는 계정이 지워지면 NULL 이 되므로 NOT NULL 을 요구할 수 없다)
  CHECK ((def_kind = 'player'  AND def_type IS NULL)
      OR (def_kind = 'monster' AND def_type IS NOT NULL AND defender_id IS NULL))
);
CREATE INDEX IF NOT EXISTS ix_battle_atk ON battle(attacker_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_battle_def ON battle(defender_id, created_at DESC);
-- 정리: 플레이어당 최근 50판만 남긴다. 5GB 에는 여유가 많지만 무한히 쌓을 이유도 없다.
--   DELETE FROM battle WHERE attacker_id = ?1 AND id NOT IN (
--     SELECT id FROM battle WHERE attacker_id = ?1 ORDER BY created_at DESC LIMIT 50);

-- ── 점령전 지도 ─────────────────────────────────────────
-- 지도는 서버에 하나뿐이다. 계정마다 사본을 두지 않는다 — 그래야 사람이 늘면
-- 같은 칸을 두고 다투게 되고, 지금처럼 혼자일 때는 몬스터가 그 자리를 대신 지킨다.
-- 행은 칸 수(12)로 고정이라 표가 커지지 않는다.
--
-- 칸의 정의(이름·등급·레벨·방어선·지형·수입)는 data/balance.js 의 TERRITORY 에 있다.
-- 여기에는 '지금 누가 들고 있고 얼마나 깎였는가'만 둔다. 정의를 DB 에 넣으면
-- 밸런스를 고칠 때마다 마이그레이션을 써야 한다.
--
-- hp_left  방어선별 남은 체력 비율 JSON. 실패해도 깎아 둔 만큼은 남는다.
--          hp_at 이후 흐른 시간만큼 스스로 회복한다(TERR.LINE_REGEN) — 계산은 읽을 때 한다.
--          매 시간 표를 훑어 회복시키면 쓰기만 쓰고 얻는 것이 없다.
CREATE TABLE IF NOT EXISTS territory (
  node        TEXT PRIMARY KEY,                -- data/balance.js TERRITORY[].id
  owner_id    INTEGER REFERENCES account(id) ON DELETE SET NULL,
  owner_name  TEXT,                            -- 표시용. 조인 없이 지도를 그리려고 둔다
  hp_left     TEXT,                            -- JSON [0~1, ...] 방어선별 남은 체력
  hp_at       INTEGER,                         -- hp_left 를 적은 시각(서버 시각)
  taken_at    INTEGER,                         -- 점령한 시각. 되찾기가 오래된 순으로 고른다
  claimed_at  INTEGER,                         -- 마지막 수입 수령 시각
  updated_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_territory_owner ON territory(owner_id, taken_at);


-- ── 로그인 시도 제한 ────────────────────────────────────
-- 비밀번호를 무한히 시도할 수 있으면 PBKDF2 로 늦추는 것만으로는 부족하다.
-- 아이디별·IP별로 실패를 세고 일정 횟수를 넘으면 잠시 막는다.
-- 성공하면 그 아이디의 기록은 지운다. 쓰기는 '실패했을 때만' 일어난다.
CREATE TABLE IF NOT EXISTS login_attempt (
  k             TEXT PRIMARY KEY,          -- 'id:<login_id>' 또는 'ip:<주소>'
  fails         INTEGER NOT NULL DEFAULT 0,
  first_at      INTEGER NOT NULL,
  blocked_until INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS ix_login_attempt_blocked ON login_attempt(blocked_until);

-- ── 메타 ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL);
-- 이 숫자는 이 파일이 만들어 내는 스키마의 버전이다. **마이그레이션을 추가하면 같이 올린다.**
-- 006~008 의 모양은 이미 위 정의에 반영되어 있는데 이 값만 '6' 으로 남아 있었다.
-- 새로 클론한 PC 가 v8 짜리 DB 를 만들어 놓고 '6' 이라고 말해, 마이그레이션이 필요한지
-- 판단할 수 없었다(`/api/health` 의 schema_version 도 이 값을 읽는다).
INSERT OR IGNORE INTO meta (k, v) VALUES ('schema_version', '10');


-- =========================================================
--  주요 질의 — 인덱스가 실제로 먹는지 확인용
--  (숫자는 계정 2만 명 기준 2026-09-04 실측)
-- =========================================================
--
-- 랭킹 상위 100                                              읽기 100행
--   SELECT p.account_id, p.nickname, p.rating, p.wins, p.losses
--     FROM player p ORDER BY p.rating DESC, p.account_id LIMIT 100;
--
-- 내 순위 — 캐시된 값을 읽는다                                읽기 1행
--   SELECT rank_cached, rank_at FROM player WHERE account_id = ?1;
--   갱신(주기 작업, 전체 1회):
--     UPDATE player SET rank_cached = (
--       SELECT COUNT(*)+1 FROM player x WHERE x.rating > player.rating), rank_at = ?1;
--
-- 상대 찾기 — 전투력 ±15% 안에서 무작위 하나                   읽기 1행
--   SELECT * FROM arena_entry
--    WHERE power BETWEEN ?2 AND ?3 AND rnd >= ?4
--      AND account_id != ?1 AND balance_ver = ?5
--    ORDER BY power, rnd LIMIT 1;
--   못 찾으면 rnd 를 감싸서 한 번 더:
--   SELECT * FROM arena_entry
--    WHERE power BETWEEN ?2 AND ?3 AND rnd < ?4
--      AND account_id != ?1 AND balance_ver = ?5
--    ORDER BY power, rnd DESC LIMIT 1;
--
-- 내 최근 전투 20판 — 목록엔 스냅샷을 읽지 않는다              읽기 20행
--   SELECT id, def_kind, winner_id, atk_delta, created_at
--     FROM battle WHERE attacker_id = ?1 ORDER BY created_at DESC LIMIT 20;
--
-- 만료 세션 청소 (하루 한 번)
--   DELETE FROM session WHERE expires_at < ?1;
--
-- =========================================================
--  비용 (무료 한도: 읽기 500만 / 쓰기 10만 / 5GB)
-- =========================================================
-- 접속 1회 = 전투 8판 + 10연차 2번 + 순위 조회 1회 기준 (2026-09-04 실측)
--   읽기 133행 · 쓰기 30.3행  →  읽기로는 하루 37,000 접속, 쓰기로는 3,300 접속
--   (자동 분해로 보유 파츠가 117 → 59개로 줄어 격납고 로드 읽기도 함께 줄었다)
--   Workers 요청이 접속당 21회라 실제 천장은 하루 4,761 접속이다.
--   더 늘리려면 요청 수를 줄여야 한다(매칭+결과를 한 요청으로 합치면 21→13).
--
-- 저장: 전투 1행 ≈ 456B. 100만 판이 0.46GB, 계정 1만 명이 272MB. 여유가 많다.
