-- 004 · 서버 판정 전투용 (schema_version 3 → 4)
--
-- pending_match: /battle/find 가 고른 상대와 시드를 저장한다.
--   클라가 상대를 골라 보내게 두면 만렙 상대만 잡아 경험치를 부풀릴 수 있다.
--   시드도 서버가 정한다 — 결정적 시뮬이라 시드가 곧 결과다.
--
--   npx wrangler d1 execute rowar --local  --file=./server/migrations/004_battle.sql
--   npx wrangler d1 execute rowar --remote --file=./server/migrations/004_battle.sql

ALTER TABLE player ADD COLUMN pending_match TEXT;

UPDATE meta SET v = '4' WHERE k = 'schema_version';
