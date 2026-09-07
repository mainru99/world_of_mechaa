-- 009 · 점령전 (schema_version 8 → 9)
--
-- 지도는 서버에 하나뿐이다. 계정마다 사본을 두지 않는다 —
-- 그래야 사람이 늘면 같은 칸을 두고 다투게 되고, 지금처럼 혼자일 때는
-- 몬스터가 그 자리를 대신 지킨다. 행은 칸 수(12)로 고정이라 표가 커지지 않는다.
--
-- 칸의 정의(이름·등급·레벨·방어선·지형·수입)는 data/balance.js 의 TERRITORY 에 있다.
-- 여기에는 '지금 누가 들고 있고 얼마나 깎였는가'만 둔다. 정의를 DB 에 넣으면
-- 밸런스를 고칠 때마다 마이그레이션을 써야 한다.
--
-- hp_left  방어선별 남은 체력 비율 JSON. 실패해도 깎아 둔 만큼은 남는다.
--          hp_at 이후 흐른 시간만큼 스스로 회복한다(TERR.LINE_REGEN) — 계산은 읽을 때 한다.
--          매 시간 표를 훑어 회복시키면 쓰기만 쓰고 얻는 게 없다.
-- claimed_at  수입 정산 기준 시각. 남은 것은 클라가 이 값으로 세므로 물으러 오지 않는다.
--
--   npx wrangler d1 execute rowar --local  --file=./server/migrations/009_territory.sql
--   npx wrangler d1 execute rowar --remote --file=./server/migrations/009_territory.sql

CREATE TABLE IF NOT EXISTS territory (
  node        TEXT PRIMARY KEY,                -- data/balance.js TERRITORY[].id
  owner_id    INTEGER REFERENCES account(id) ON DELETE SET NULL,
  owner_name  TEXT,                            -- 표시용. 조인 없이 지도를 그리려고 둔다
  hp_left     TEXT,                            -- JSON [0~1, ...] 방어선별 남은 체력
  hp_at       INTEGER,                         -- hp_left 를 적은 시각(서버 시각)
  taken_at    INTEGER,                         -- 점령한 시각. 되찾기가 오래된 순으로 고른다
  claimed_at  INTEGER,                         -- 마지막 수입 수령 시각
  updated_at  INTEGER NOT NULL
);
-- 내 칸 목록·되찾기가 이 인덱스로 끝난다
CREATE INDEX IF NOT EXISTS ix_territory_owner ON territory(owner_id, taken_at);

UPDATE meta SET v = '9' WHERE k = 'schema_version';
