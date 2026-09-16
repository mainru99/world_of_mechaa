-- 주간 시련 기록.
--
-- 한 주·한 계정에 한 줄이고, 그 줄에는 **그 주의 최고 점수**만 남는다.
-- 도전 횟수를 세지 않는 이유는 점수가 결정적이기 때문이다 — 같은 빌드로 다시
-- 눌러도 같은 점수라, 여러 번 눌러서 이득을 볼 길이 없다.
--
-- nickname 을 복사해 둔다. 순위표를 조인 없이 한 번에 읽으려는 것이고,
-- arena_entry·territory 와 같은 규칙이다(이름을 바꾸면 renameTo 가 세 곳을 같이 고친다).
CREATE TABLE IF NOT EXISTS trial (
  week        INTEGER NOT NULL,
  account_id  INTEGER NOT NULL REFERENCES account(id) ON DELETE CASCADE,
  nickname    TEXT NOT NULL,
  score       INTEGER NOT NULL DEFAULT 0,
  robot_type  TEXT,
  power       INTEGER NOT NULL DEFAULT 0,
  tries       INTEGER NOT NULL DEFAULT 0,
  updated_at  INTEGER NOT NULL,
  PRIMARY KEY (week, account_id)
);
-- 순위표는 '이번 주, 점수 높은 순' 만 읽는다. 그 한 가지를 위한 색인이다.
CREATE INDEX IF NOT EXISTS ix_trial_rank ON trial(week, score DESC);

UPDATE meta SET v = '14' WHERE k = 'schema_version';
