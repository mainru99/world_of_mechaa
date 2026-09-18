-- 도감 — 기체·파츠를 '가져 본 적 있음' 으로 적는 트리거 둘.
--
-- 파츠가 들어오는 곳이 여섯(대전·원정·전선·합성·뽑기·이관), 기체가 들어오는 곳이 셋이다.
-- 곳곳에 기록 코드를 박으면 새 입수처가 생길 때 반드시 하나를 빠뜨린다.
-- **표에 행이 들어오는 순간 DB 가 적는다** — 입수처가 늘어도 빠지지 않는다.
--
-- player.codex 는 016 에서 만들어 둔 칸이다(JSON). json_set 은 없는 중간 객체를 만들어
-- 주므로 '{}' 에서 시작해도 된다. 같은 칸을 두 번 적어도 1 로 덮을 뿐이다.
--
-- 옛 파츠(base 가 없는 것)는 도감 칸이 없으므로 적지 않는다.
-- 몬스터 기록은 트리거로 못 한다(전투는 행을 만들지 않는다) — 서버 코드가 적는다(server/codex.js).
CREATE TRIGGER IF NOT EXISTS codex_part AFTER INSERT ON part
WHEN NEW.base IS NOT NULL
BEGIN
  UPDATE player
     SET codex = json_set(COALESCE(codex, '{}'), '$.p.' || json_quote(NEW.base || ':' || NEW.rarity), 1)
   WHERE account_id = NEW.account_id;
END;

CREATE TRIGGER IF NOT EXISTS codex_robot AFTER INSERT ON robot
BEGIN
  UPDATE player
     SET codex = json_set(COALESCE(codex, '{}'), '$.r.' || json_quote(NEW.type), 1)
   WHERE account_id = NEW.account_id;
END;

UPDATE meta SET v = '18' WHERE k = 'schema_version';
