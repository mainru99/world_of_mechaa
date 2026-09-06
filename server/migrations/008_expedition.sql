-- 008 · 원정 (schema_version 7 → 8)
--
-- 기체를 얼마간 내보내 두고 재화를 받아 오는 방치형 파밍.
-- 한 번에 하나만 나간다 — 여럿을 동시에 보낼 수 있으면 '누구를 보낼까'가 판단이 아니게 된다.
-- 그래서 표를 새로 만들지 않고 player 에 컬럼으로 붙인다.
--
-- expd_lv 는 보낼 때의 기체 레벨을 박아 둔다. 받을 때 다시 읽으면 그 사이 레벨업으로
-- 보상이 달라져, 보내 놓고 키운 뒤 받는 것이 이득이 된다. 보낸 시점의 값으로 고정한다.
-- expd_end 는 서버 시각이다. 남은 시간은 클라가 이 값으로 계산하므로 폴링이 필요 없다.
--
--   npx wrangler d1 execute rowar --local  --file=./server/migrations/008_expedition.sql
--   npx wrangler d1 execute rowar --remote --file=./server/migrations/008_expedition.sql

ALTER TABLE player ADD COLUMN expd_robot INTEGER REFERENCES robot(id) ON DELETE SET NULL;
ALTER TABLE player ADD COLUMN expd_tier  TEXT;
ALTER TABLE player ADD COLUMN expd_lv    INTEGER;
ALTER TABLE player ADD COLUMN expd_end   INTEGER;

UPDATE meta SET v = '8' WHERE k = 'schema_version';
