-- 정제 코어 · 코어 서킷 저장 · 조각 회수 작전 — 칸 셋. (2026-09-25 사용자 지시)
--
-- player.rcores  정제 코어. 코어 CONST.REFINE.need(10)개를 합쳐 1개 — server/refine.js.
--                지금은 합치기 말고 얻을 길이 없다. 정제 코어 뽑기(server/pull.js 'rcore')와 서킷 비우기에 쓴다.
-- player.salv    조각 회수 작전의 오늘 횟수(JSON). { d: UTC 날짜 번호, n: 오늘 한 횟수 } — js/salvage.js.
--                NULL 은 '오늘 아직 안 했다' 와 같다.
-- robot.circuit  코어 서킷에 찍은 별(JSON 배열). [ 'A1', 'A2', 'B1', … ] — js/circuit.js 가 규칙을 본다.
--                NULL 은 빈 서킷이다. **전투에는 아직 안 붙었다**(STATUS 할 일 3번).
--
-- 기존 행은 건드리지 않는다 — 셋 다 0 · NULL 에서 시작한다.
ALTER TABLE player ADD COLUMN rcores INTEGER NOT NULL DEFAULT 0 CHECK (rcores >= 0);
ALTER TABLE player ADD COLUMN salv   TEXT;
ALTER TABLE robot  ADD COLUMN circuit TEXT;

UPDATE meta SET v = '23' WHERE k = 'schema_version';
