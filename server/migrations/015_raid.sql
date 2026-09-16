-- 보스 레이드 — 서버 전체가 하나의 체력 막대를 같이 깎는다.
--
-- 막대는 raid.dealt 한 칸에만 있고, 늘리는 문장은 `dealt = dealt + ?` 하나다.
-- SQLite 에서 그 문장은 원자적이라 두 사람이 동시에 쳐도 피해가 사라지지 않는다.
-- (전투는 매번 보스를 꽉 찬 체력으로 만난다 — js/raid.js 머리말 참고)
CREATE TABLE IF NOT EXISTS raid (
  week       INTEGER PRIMARY KEY,
  boss       TEXT    NOT NULL,
  level      INTEGER NOT NULL,
  max_hp     INTEGER NOT NULL,
  dealt      INTEGER NOT NULL DEFAULT 0,
  killed_at  INTEGER,                        -- 격파 시각. NULL 이면 아직 살아 있다
  killer     TEXT,                           -- 마지막 일격을 넣은 사람(표시용)
  updated_at INTEGER NOT NULL
);

-- 한 주·한 계정에 한 줄. 누적 피해와 하루 남은 횟수를 같이 들고 있다.
-- day/today 를 한 줄에 둔 이유: 날짜가 바뀌면 today 를 0 으로 되돌리는 판단을
-- 그 줄만 읽고 할 수 있다. 따로 표를 두면 도전마다 읽을 행이 하나 는다.
CREATE TABLE IF NOT EXISTS raid_hit (
  week       INTEGER NOT NULL,
  account_id INTEGER NOT NULL REFERENCES account(id) ON DELETE CASCADE,
  nickname   TEXT    NOT NULL,               -- 표시용 복사본. 조인 없이 순위표를 읽는다
  damage     INTEGER NOT NULL DEFAULT 0,     -- 이번 주 누적
  best       INTEGER NOT NULL DEFAULT 0,     -- 한 번에 넣은 최고 피해
  tries      INTEGER NOT NULL DEFAULT 0,
  day        INTEGER NOT NULL DEFAULT 0,     -- UTC 일 번호
  today      INTEGER NOT NULL DEFAULT 0,     -- 그날 도전 횟수
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (week, account_id)
);
CREATE INDEX IF NOT EXISTS ix_raid_hit ON raid_hit(week, damage DESC);

UPDATE meta SET v = '15' WHERE k = 'schema_version';
