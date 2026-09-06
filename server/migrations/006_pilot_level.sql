-- 006 · 파일럿 레벨과 출격 편성 (schema_version 5 → 6)
--
-- 왜: 경험치가 '출전한 기체'에만 들어가서, 기체 하나를 Lv.30 으로 올리는 데
-- 84판(경험치) 또는 53,940 크레딧이 들었다. 두 번째 기체는 0에서 다시 시작이라
-- 사실상 평생 한 기체만 쓴다. 그 결과 기체 30종과 그 대항 스킬(noMiss 12기가
-- 회피를 잡고, ignoreDef 12기가 장갑을 뚫는다)이 통째로 죽은 콘텐츠였고,
-- 상대를 미리 보여 주는 화면도 손쓸 수단이 없어 장식이었다.
--
-- 그래서 레벨을 기체가 아니라 **파일럿**에게 둔다. 보유한 기체는 전부 내 레벨로 싸운다.
-- 다만 한 번에 데려갈 수 있는 것은 두 기뿐이다 — '무엇을 만날지에 대한 베팅'이 되도록.
-- 피로도는 기체별로 남긴다. 그래야 둘을 번갈아 쓰는 이유가 생긴다.
--
--   npx wrangler d1 execute rowar --local  --file=./server/migrations/006_pilot_level.sql
--   npx wrangler d1 execute rowar --remote --file=./server/migrations/006_pilot_level.sql

ALTER TABLE player ADD COLUMN level  INTEGER NOT NULL DEFAULT 1;
ALTER TABLE player ADD COLUMN exp    INTEGER NOT NULL DEFAULT 0;
ALTER TABLE player ADD COLUMN squad1 INTEGER REFERENCES robot(id) ON DELETE SET NULL;
ALTER TABLE player ADD COLUMN squad2 INTEGER REFERENCES robot(id) ON DELETE SET NULL;

-- 파일럿 레벨 = 그 계정에서 가장 높이 키운 기체의 레벨. 아무도 손해 보지 않는다.
UPDATE player SET level = COALESCE(
  (SELECT MAX(r.level) FROM robot r WHERE r.account_id = player.account_id), 1);
UPDATE player SET exp = COALESCE(
  (SELECT r.exp FROM robot r WHERE r.account_id = player.account_id
    ORDER BY r.level DESC, r.id LIMIT 1), 0);

-- 편성: 쓰던 기체를 1번에, 그다음으로 높이 키운 기체를 2번에.
UPDATE player SET squad1 = COALESCE(sel_robot,
  (SELECT r.id FROM robot r WHERE r.account_id = player.account_id
    ORDER BY r.level DESC, r.id LIMIT 1));
UPDATE player SET squad2 = (
  SELECT r.id FROM robot r WHERE r.account_id = player.account_id
     AND r.id IS NOT player.squad1 ORDER BY r.level DESC, r.id LIMIT 1);
UPDATE player SET sel_robot = squad1
 WHERE sel_robot IS NULL
    OR sel_robot NOT IN (COALESCE(squad1, -1), COALESCE(squad2, -1));

-- robot.level / robot.exp 는 남겨 둔다. 더 이상 읽지 않지만, SQLite 에서 컬럼을 지우는
-- 것은 표를 다시 만드는 일이고, 되돌릴 여지도 남겨 두는 편이 낫다.

UPDATE meta SET v = '6' WHERE k = 'schema_version';
