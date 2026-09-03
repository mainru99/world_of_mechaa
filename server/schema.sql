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
-- =========================================================

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
  status      TEXT NOT NULL DEFAULT 'active'   -- active | banned
);
CREATE INDEX IF NOT EXISTS ix_account_email ON account(email);

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
CREATE TABLE IF NOT EXISTS part (
  id          INTEGER PRIMARY KEY,
  account_id  INTEGER NOT NULL REFERENCES account(id) ON DELETE CASCADE,
  slot        TEXT NOT NULL,                   -- WEAPON | FRAME | BOOSTER | CORE
  name        TEXT NOT NULL,
  rarity      TEXT NOT NULL,                   -- C | R | SR | SSR
  stats       TEXT NOT NULL,                   -- JSON {hp,atk,def,spd,crit,eva} 중 일부
  enh         INTEGER NOT NULL DEFAULT 0,      -- 강화 0~10
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_part_account ON part(account_id);

-- ── 기체 ────────────────────────────────────────────────
-- 슬롯은 정확히 넷으로 고정이라 조인 테이블 대신 컬럼 넷으로 둔다.
-- 각 슬롯 컬럼에 UNIQUE 를 걸면 "파츠 하나가 두 기체에 장착"이 DB 차원에서 막힌다.
-- (클라 코드도 장착 시 다른 기체에서 빼지만, 서버가 믿을 이유는 없다)
CREATE TABLE IF NOT EXISTS robot (
  id          INTEGER PRIMARY KEY,
  account_id  INTEGER NOT NULL REFERENCES account(id) ON DELETE CASCADE,
  type        TEXT NOT NULL,                   -- ROBOT_TYPES 키 (seraph, nemesis …)
  level       INTEGER NOT NULL DEFAULT 1,
  exp         INTEGER NOT NULL DEFAULT 0,
  fat         INTEGER NOT NULL DEFAULT 0,      -- 피로도 0~45
  s_weapon    INTEGER UNIQUE REFERENCES part(id) ON DELETE SET NULL,
  s_frame     INTEGER UNIQUE REFERENCES part(id) ON DELETE SET NULL,
  s_booster   INTEGER UNIQUE REFERENCES part(id) ON DELETE SET NULL,
  s_core      INTEGER UNIQUE REFERENCES part(id) ON DELETE SET NULL,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_robot_account ON robot(account_id);

-- ── 진행 상태 ───────────────────────────────────────────
-- 인증(account)과 게임 진행(player)을 나눈다. 진행만 초기화하는 일이 생긴다.
CREATE TABLE IF NOT EXISTS player (
  account_id  INTEGER PRIMARY KEY REFERENCES account(id) ON DELETE CASCADE,
  nickname    TEXT NOT NULL,                   -- 표시용 콜사인
  credits     INTEGER NOT NULL DEFAULT 600,
  cores       INTEGER NOT NULL DEFAULT 12,
  scrap       INTEGER NOT NULL DEFAULT 30,
  wins        INTEGER NOT NULL DEFAULT 0,
  losses      INTEGER NOT NULL DEFAULT 0,
  pulls       INTEGER NOT NULL DEFAULT 0,
  rating      INTEGER NOT NULL DEFAULT 1000,   -- 랭킹 기준
  sel_robot   INTEGER REFERENCES robot(id) ON DELETE SET NULL,
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
CREATE TABLE IF NOT EXISTS arena_entry (
  account_id  INTEGER PRIMARY KEY REFERENCES account(id) ON DELETE CASCADE,
  nickname    TEXT NOT NULL,
  robot_type  TEXT NOT NULL,
  level       INTEGER NOT NULL,
  power       INTEGER NOT NULL,                -- power() 결과 — 매칭 기준
  rating      INTEGER NOT NULL,
  snapshot    TEXT NOT NULL,                   -- JSON {type,level,fat,stats:{...},skill}
  updated_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_arena_power  ON arena_entry(power);
CREATE INDEX IF NOT EXISTS ix_arena_rating ON arena_entry(rating DESC);

-- ── 전투 기록 ───────────────────────────────────────────
-- 시드와 양쪽 스냅샷을 남기면 언제든 같은 전투를 다시 재생할 수 있다.
-- 결정적 시뮬이라 가능한 일이고, 분쟁·버그 추적에 그대로 쓰인다.
CREATE TABLE IF NOT EXISTS battle (
  id           INTEGER PRIMARY KEY,
  attacker_id  INTEGER NOT NULL REFERENCES account(id) ON DELETE CASCADE,
  -- 상대는 사람일 수도 몬스터일 수도 있다 (몬스터 매칭 40%).
  -- 몬스터는 '소유'되지 않으므로 account 도 robot 도 없다 — balance.js 에서 읽어 만든다.
  def_kind     TEXT NOT NULL DEFAULT 'player',  -- player | monster
  def_type     TEXT,                            -- 몬스터일 때 MONSTER_TYPES 키
  defender_id  INTEGER REFERENCES account(id) ON DELETE SET NULL,
  seed         TEXT NOT NULL,
  atk_snap     TEXT NOT NULL,                  -- JSON
  def_snap     TEXT NOT NULL,                  -- JSON
  winner_id    INTEGER,                        -- account.id (무승부면 NULL)
  atk_delta    INTEGER NOT NULL DEFAULT 0,     -- 공격자 레이팅 변동
  created_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_battle_atk ON battle(attacker_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_battle_def ON battle(defender_id, created_at DESC);
-- 주의: 전투마다 스냅샷 두 벌이 쌓인다. 한 판에 2~4KB 정도.
-- 5GB 라 한참 여유지만, 플레이어당 최근 50판만 남기는 정리를 나중에 넣을 것.

-- ── 메타 ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL);
INSERT OR IGNORE INTO meta (k, v) VALUES ('schema_version', '1');


-- =========================================================
--  주요 질의 — 인덱스가 실제로 먹는지 확인용
-- =========================================================
--
-- 랭킹 상위 100
--   SELECT p.account_id, p.nickname, p.rating, p.wins, p.losses
--     FROM player p ORDER BY p.rating DESC, p.account_id LIMIT 100;
--
-- 내 순위 (전체를 세지 않는다)
--   SELECT COUNT(*) + 1 AS rank FROM player WHERE rating > ?1;
--
-- 상대 찾기 — 전투력 ±15% 안에서 하나
--   SELECT * FROM arena_entry
--    WHERE account_id != ?1 AND power BETWEEN ?2 AND ?3
--    ORDER BY RANDOM() LIMIT 1;
--   (RANDOM() 정렬은 인덱스를 못 쓴다. 등록자가 만 명을 넘으면
--    무작위 offset 방식으로 바꿀 것. 그전까진 이게 가장 단순하다.)
--
-- 만료 세션 청소 (하루 한 번)
--   DELETE FROM session WHERE expires_at < ?1;
