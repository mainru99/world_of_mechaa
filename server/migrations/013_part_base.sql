-- 파츠 개편 7단계 — 파츠가 스탯을 들고 있지 않게 한다.
--
-- 지금까지 파츠는 굴린 스탯을 JSON 으로 들고 있었고, 서버는 등급별 상한으로
-- **자르기만** 했다(정확한 검증이 아니다). 앞으로는 base·rarity·affixes·seed·lv 만
-- 저장하고 값은 서버가 매번 다시 만든다 — 위조할 여지가 0 이 되고, 나중에 수치를
-- 고치면 이미 가진 파츠에도 소급된다.
--
-- 이 문장은 **칸을 만들고 확정적인 것만 채운다.** 인챈트는 슬롯 제약·그룹 배제·
-- 등급별 티어 분포를 봐야 해서 SQL 로 굴리기에 맞지 않는다.
-- 그쪽은 tools/partmigrate.mjs 가 seed 에서 뽑아 SQL 을 만들어 준다 (STATUS.md 참고).
--
-- stats 칸은 지우지 않는다. 옮긴 결과가 이상하면 되돌아볼 자리가 있어야 한다.
-- 코드는 base 가 있으면 stats 를 안 본다(js/stats.js 의 isNewPart).

ALTER TABLE part ADD COLUMN base    TEXT;
ALTER TABLE part ADD COLUMN affixes TEXT;
ALTER TABLE part ADD COLUMN seed    INTEGER;
ALTER TABLE part ADD COLUMN lv      INTEGER;

-- 이름 → 베이스. 개편이 한글 이름을 하나도 바꾸지 않았으므로 1:1 이다.
-- (data/balance.js 의 PART_BASES 에서 뽑아 만들었다 — 손으로 적지 않았다)
UPDATE part SET base = CASE name
       WHEN '빔 세이버' THEN 'beamSaber'
       WHEN '발칸포' THEN 'vulcan'
       WHEN '레일건' THEN 'railgun'
       WHEN '포톤 랜스' THEN 'photonLance'
       WHEN '채프 런처' THEN 'chaffLauncher'
       WHEN '브레이커' THEN 'breaker'
       WHEN '합금 장갑' THEN 'alloyArmor'
       WHEN '리액티브 아머' THEN 'reactiveArmor'
       WHEN '실드 프레임' THEN 'shieldFrame'
       WHEN '경량 골격' THEN 'lightFrame'
       WHEN '나노 코팅' THEN 'nanoCoat'
       WHEN '스러스터' THEN 'thruster'
       WHEN '플로트 팩' THEN 'floatPack'
       WHEN '부스트 유닛' THEN 'boostUnit'
       WHEN '고기동 백' THEN 'highMobility'
       WHEN 'AMBAC' THEN 'ambac'
       WHEN '리액터' THEN 'reactor'
       WHEN '제너레이터' THEN 'generator'
       WHEN '전술 코어' THEN 'tacticalCore'
       WHEN '컨트롤 칩' THEN 'controlChip'
       WHEN '오버드라이브' THEN 'overdrive'
       ELSE NULL END
 WHERE base IS NULL;

-- 파츠 레벨. 옛 파츠는 주운 레벨을 따로 안 들고 있고 스탯에 녹아 있었다.
-- genPart 가 받던 level 은 '그때 그 플레이어의 기체 레벨' 이므로, 가장 가까운
-- 근사는 주인의 최고 기체 레벨이다. 기체가 없으면 1.
UPDATE part SET lv = COALESCE(
       (SELECT MAX(r.level) FROM robot r WHERE r.account_id = part.account_id), 1)
 WHERE lv IS NULL;

-- 티어 안 ±12% 굴림의 씨앗. ABS(RANDOM()) 은 64비트 최솟값에서 넘치므로 비트 AND 를 쓴다.
UPDATE part SET seed = (RANDOM() & 4294967295) WHERE seed IS NULL;

UPDATE meta SET v = '13' WHERE k = 'schema_version';
