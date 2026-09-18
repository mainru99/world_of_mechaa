-- 상점 · 보관함 — 칸 둘.
--
-- player 에 둔다. 모든 요청이 이미 이 한 행을 읽으므로 읽기가 늘지 않는다(016 과 같은 이유).
--
--   items  보관함(JSON). { '<종류>:<id>': 개수 } — 지금은 기체 조각(shard:<기체id>) 뿐.
--          아이템이 늘면 같은 칸에 새 접두어로 넣는다. 표를 새로 만들지 않는다.
--   shop   상점 상태(JSON). { p: 주기 번호, n: 새로 굴린 횟수, lv: 진열 레벨, b: [산 칸] }
--          **진열 자체는 저장하지 않는다** — 계정·주기·횟수·레벨로 다시 굴리면 같은 것이 나온다(js/shop.js).
ALTER TABLE player ADD COLUMN items TEXT;
ALTER TABLE player ADD COLUMN shop TEXT;

UPDATE meta SET v = '19' WHERE k = 'schema_version';
