-- 파츠 귀속을 켜는 날 한 번 돌린다(스위치 CONST.PART_BIND.on 을 켜는 배포 **바로 앞**). 이관 024 뒤여야 한다.
--   npx wrangler d1 execute rowar --remote --file tools/bindnow.sql
--
-- ① 지금 끼고 있는 파츠 → 끼고 있는 기체에 귀속(사용자 결정). 인벤토리에 있는 파츠는 풀린 채로 둔다
UPDATE part SET bound = (
  SELECT r.id FROM robot r
   WHERE r.account_id = part.account_id
     AND part.id IN (r.s_weapon, r.s_frame, r.s_booster, r.s_core)
) WHERE bound IS NULL;
-- ② 계정 프리셋 → 선봉 기체(sel_robot)의 프리셋으로 옮겨 적는다. 다른 기체에 귀속된 칸은 적용할 때 건너뛴다(js/bind.js)
UPDATE robot SET presets = (SELECT p.presets FROM player p WHERE p.account_id = robot.account_id)
 WHERE presets IS NULL
   AND id = (SELECT p.sel_robot FROM player p WHERE p.account_id = robot.account_id)
   AND (SELECT p.presets FROM player p WHERE p.account_id = robot.account_id) IS NOT NULL;
