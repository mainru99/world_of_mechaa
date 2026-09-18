-- 빌드 프리셋 — 칸 하나.
--
-- presets  JSON 배열 · 다섯 칸. [ { n: 이름, s: { WEAPON: 파츠uid, … } } | null, … ]
--          모양은 js/preset.js 머리말. 파츠 uid 로 적는다(행 id 는 이관 때 바뀔 수 있다).
-- player 에 둔다 — 모든 요청이 이미 이 한 행을 읽으므로 읽기가 늘지 않는다(016 과 같은 이유).
ALTER TABLE player ADD COLUMN presets TEXT;

UPDATE meta SET v = '20' WHERE k = 'schema_version';
