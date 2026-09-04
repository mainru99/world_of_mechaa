-- 005 · 로그인 시도 제한 (schema_version 4 → 5)
--
-- 비밀번호를 무한히 시도할 수 있으면 PBKDF2 로 늦추는 것만으로는 부족하다.
-- 아이디별·IP별로 실패를 세고, 일정 횟수를 넘으면 잠시 막는다.
--
--   npx wrangler d1 execute rowar --local  --file=./server/migrations/005_login_limit.sql
--   npx wrangler d1 execute rowar --remote --file=./server/migrations/005_login_limit.sql

CREATE TABLE IF NOT EXISTS login_attempt (
  k             TEXT PRIMARY KEY,          -- 'id:<login_id>' 또는 'ip:<주소>'
  fails         INTEGER NOT NULL DEFAULT 0,
  first_at      INTEGER NOT NULL,          -- 이번 창(window)이 시작된 시각
  blocked_until INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS ix_login_attempt_blocked ON login_attempt(blocked_until);

UPDATE meta SET v = '5' WHERE k = 'schema_version';
