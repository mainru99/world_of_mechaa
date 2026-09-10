-- 011 · 지목 대전을 위한 닉네임 색인 (schema_version 10 → 11)
--
-- 닉네임으로 특정 상대를 불러 붙는 기능을 붙였다(친선전 — 출격비·보상·레이팅 없음).
-- 색인이 없으면 이름 하나를 찾는 데 arena_entry 를 통째로 훑는다. 무료 한도가
-- '행 읽기' 기준이라 그대로 두면 지목 한 번이 매칭 수백 번만큼 든다.
--
-- UNIQUE 로 두지 않는다 — 지금 닉네임은 `GUEST-0002` 처럼 계정 번호가 박혀 있어
-- 사실상 유일하지만, 나중에 '이름 바꾸기'가 붙으면 겹칠 수 있다. 조회는 LIMIT 1 이다.
--
--   npx wrangler d1 execute rowar --local  --file=./server/migrations/011_arena_nickname.sql
--   npx wrangler d1 execute rowar --remote --file=./server/migrations/011_arena_nickname.sql

CREATE INDEX IF NOT EXISTS ix_arena_nick ON arena_entry(nickname);

UPDATE meta SET v = '11' WHERE k = 'schema_version';
