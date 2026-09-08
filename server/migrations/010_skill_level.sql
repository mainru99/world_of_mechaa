-- 010 · 스킬 강화 (schema_version 9 → 10)
--
-- 기체의 스킬을 크레딧+스크랩으로 올린다. **첫 강화부터 실패한다** —
-- 실패해도 재화는 나간다. 쉽게 세지면 안 되기 때문이다(사용자 요구).
--
-- 성공 판정은 서버가 한다. 클라가 굴리면 될 때까지 다시 보내면 그만이다.
-- 스킬 배수는 js/sim.js 가 그대로 쓰되, computeStats 가 내보내는 skillMul 을 곱한다 —
-- 전투 규칙 자체는 건드리지 않는다.
--
--   npx wrangler d1 execute rowar --local  --file=./server/migrations/010_skill_level.sql
--   npx wrangler d1 execute rowar --remote --file=./server/migrations/010_skill_level.sql

ALTER TABLE robot ADD COLUMN skill_lv INTEGER NOT NULL DEFAULT 0;

UPDATE meta SET v = '10' WHERE k = 'schema_version';
