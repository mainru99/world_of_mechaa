-- 003 · 동기화용 컬럼 추가 (schema_version 2 → 3)
--
-- schema.sql 은 CREATE TABLE IF NOT EXISTS 라 이미 만들어진 테이블에는 컬럼을 못 붙인다.
-- 이미 배포된 DB 에는 이 파일을 한 번 실행한다. 새로 만드는 DB 는 schema.sql 만으로 충분하다.
--
--   npx wrangler d1 execute rowar --local  --file=./server/migrations/003_sync.sql
--   npx wrangler d1 execute rowar --remote --file=./server/migrations/003_sync.sql
--
-- SQLite 는 ADD COLUMN 이 이미 있으면 오류를 낸다. 두 번 실행하지 말 것.

ALTER TABLE robot  ADD COLUMN uid TEXT;
ALTER TABLE part   ADD COLUMN uid TEXT;
ALTER TABLE player ADD COLUMN rev INTEGER NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX IF NOT EXISTS ux_robot_uid ON robot(account_id, uid);
CREATE UNIQUE INDEX IF NOT EXISTS ux_part_uid  ON part(account_id, uid);

UPDATE meta SET v = '3' WHERE k = 'schema_version';
