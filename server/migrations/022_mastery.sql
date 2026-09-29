-- 숙련 조각 — 칸 둘. (2026-09-23 사용자 결정)
--
-- 기체를 키우면 **개발 목표의 조각**이 쌓인다. 규칙은 js/mastery.js, 값은 CONST.MASTERY.shard
-- (5레벨마다 1 · 만렙에 2 더 = Lv.60 에 14). 목표는 계정에 하나 — 어느 기체를 키우든 그리로 모인다.
--
-- player.m_goal  개발 목표 기체 type. NULL 이면 서버가 autoGoal 로 고른다(고르는 화면은 UI 개편 뒤).
-- robot.m_lv     조각을 정산한 레벨. 여기까지는 이미 줬다는 뜻이다.
--
-- **소급하지 않는다**(사용자 결정) — 기존 행의 m_lv 를 지금 레벨로 채운다.
-- 그래서 이미 Lv.60 인 기체도 조각 0 에서 시작하고, 앞으로 올리는 레벨만 쌓인다.
-- 새로 만드는 기체는 m_lv 가 NULL 인데, js/mastery.js 가 NULL 을 **Lv.1** 로 읽는다 —
-- 뽑기 · 조립 · 첫 기체는 언제나 Lv.1 로 만들어지므로 첫 레벨업부터 조각을 준다.
-- 동기화로 들어오는 행(server/state.js)은 그 레벨을 m_lv 에 박는다. 클라가 적은 레벨로 조각을 만들 수 없다.
ALTER TABLE player ADD COLUMN m_goal TEXT;
ALTER TABLE robot  ADD COLUMN m_lv   INTEGER;

UPDATE robot SET m_lv = level WHERE m_lv IS NULL;

UPDATE meta SET v = '22' WHERE k = 'schema_version';
