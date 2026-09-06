-- 007 · 레벨을 다시 기체에게 (schema_version 6 → 7)
--
-- 006 에서 레벨을 파일럿에게 옮겼다. 로스터는 살아났지만 대신 **뽑는 맛이 죽었다** —
-- 새로 뽑은 기체가 즉시 만렙으로 나오니 '얻어서 키운다'는 보상이 통째로 사라진다.
-- 키우는 과정 자체가 이 게임의 재미이므로 되돌린다.
--
-- 006 때 걱정했던 '새 기체는 약해서 못 큰다'는 기우였다. 상대는 출전한 기체의
-- 레벨에 맞춰 생성되므로(makeOpponent 의 myLevel), Lv.1 기체는 Lv.1 상대를 만난다.
-- 정상적으로 이기고 벌 수 있다. 그래서 따로 보정을 두지 않는다.
--
-- 출격 편성(squad1/squad2, 최대 2기)은 그대로 둔다. 그쪽은 '어떤 둘을 데려갈까'라는
-- 판단을 만드는 장치라 레벨을 어디에 두는가와 무관하다.
--
--   npx wrangler d1 execute rowar --local  --file=./server/migrations/007_robot_level_back.sql
--   npx wrangler d1 execute rowar --remote --file=./server/migrations/007_robot_level_back.sql

-- 아무도 손해 보지 않게: 기체가 이미 가진 레벨과 파일럿 레벨 중 높은 쪽을 준다.
-- (006 이 도는 동안 파일럿 레벨로 싸운 기체가 도로 낮아지면 안 된다)
UPDATE robot SET level = MAX(
  level,
  COALESCE((SELECT p.level FROM player p WHERE p.account_id = robot.account_id), 1));

-- 쌓아 둔 경험치는 지금 나가는 기체에게 준다. 나눠 줄 근거가 없다.
UPDATE robot SET exp = COALESCE(
  (SELECT p.exp FROM player p WHERE p.account_id = robot.account_id AND p.sel_robot = robot.id), exp);

-- player.level / player.exp 는 남겨 두되 더 이상 읽지 않는다.
-- (SQLite 에서 컬럼을 지우려면 표를 다시 만들어야 한다. 되돌릴 여지도 남는다)

UPDATE meta SET v = '7' WHERE k = 'schema_version';
