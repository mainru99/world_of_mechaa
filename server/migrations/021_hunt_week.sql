-- 토벌 주간 입장 한도 — 칸 하나. (2026-09-19 사용자 지시)
--
-- hunt_wk  JSON. { w: 주 번호, n: { UQ: 3, EP: 1, BOSS: 0 } } — 모양과 규칙은 js/rewards.js '토벌 주간 입장 한도'.
--          주 번호는 일요일 00:00 한국 시각에 바뀐다. **지난주 값은 읽는 순간 0 으로 본다** — 지우는 일이 없다.
-- player 에 둔다 — 전투 시작이 이미 이 한 행을 읽으므로 읽기가 늘지 않는다(016 과 같은 이유).
-- NULL 이면 이번 주에 한 번도 안 들어간 것이다. 기존 행을 채우지 않는다.
ALTER TABLE player ADD COLUMN hunt_wk TEXT;

UPDATE meta SET v = '21' WHERE k = 'schema_version';
