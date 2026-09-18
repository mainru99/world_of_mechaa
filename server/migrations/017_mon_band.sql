-- 대전 몬스터 구간 — 구간과 승급 점수를 담을 칸 둘.
--
-- 구간은 원래 레이팅으로 골랐다. 그런데 레이팅은 몬스터 판에서 움직이지 않아서
-- 구간이 몬스터 성적과 무관하게 올라갔다(앞 구간 94~100% · 뒤 구간 4~42%).
-- 이제 몬스터 판 승패로 움직인다 — 그러려면 '지금 몇 구간, 점수 몇' 을 들고 있어야 한다.
--
-- `player` 에 둔다. 모든 요청이 이미 이 한 행을 읽으므로 읽기가 늘지 않는다(016 과 같은 이유).
--
--   mband      지금 구간(1부터). NULL = 아직 안 잡혔다 → 첫 대전에서 레이팅으로 자리를 잡는다
--              (이 기능 전의 계정이 어제 보던 구간에서 그대로 시작한다)
--   mband_pts  승급 점수. 이기면 +1 · 지면 −1. +5 승급 · −3 강등 (CONST.MON_BAND_STEP)
ALTER TABLE player ADD COLUMN mband INTEGER;
ALTER TABLE player ADD COLUMN mband_pts INTEGER NOT NULL DEFAULT 0;

UPDATE meta SET v = '17' WHERE k = 'schema_version';
