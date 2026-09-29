-- 파츠 귀속 · 기체별 프리셋 — 칸 둘. (2026-09-28 사용자 결정)
--
-- part.bound     이 파츠가 귀속된 기체(robot.id). NULL 은 풀린 파츠. 처음 끼는 순간 채운다 — js/bind.js.
--                **지금은 채우지 않는다**(CONST.PART_BIND.on = false). 켤 때 tools/bindnow.sql 이
--                '그때 끼고 있는 파츠 = 그 기체에 귀속' 을 한 번 채운다(사용자 결정 · 인벤토리 것은 풀린 채).
--                지금 채우면 스위치가 꺼진 동안 파츠를 옮겨 끼는 사이에 값이 낡는다.
-- robot.presets  기체마다 빌드 프리셋(JSON — js/preset.js 와 같은 모양). 켜진 뒤에 쓴다.
--                player.presets(계정 프리셋)는 그대로 둔다 — bindnow.sql 이 선봉 기체로 옮겨 적는다.
--
-- 기존 행은 건드리지 않는다.
ALTER TABLE part  ADD COLUMN bound   INTEGER REFERENCES robot(id) ON DELETE SET NULL;
ALTER TABLE robot ADD COLUMN presets TEXT;

UPDATE meta SET v = '24' WHERE k = 'schema_version';
