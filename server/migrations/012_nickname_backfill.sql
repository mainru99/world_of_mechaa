-- 게스트를 정식 계정으로 바꿀 때 닉네임을 안 따라가게 두던 것을 메운다.
--
-- /auth/register 가 account.login_id 만 쓰고 player.nickname 을 그대로 뒀다.
-- 그래서 가입한 뒤에도 랭킹·아레나·점령 지도가 GUEST-0015 를 보여 줬다.
-- 코드는 고쳤지만(renameTo), 이미 바뀐 계정은 여기서 한 번 메워야 한다.
--
-- 조건을 'GUEST-%' 로 좁힌다. 나중에 닉네임을 따로 정하는 기능이 생기면
-- 그때 직접 지은 이름을 이 문장이 덮어쓰면 안 된다.

UPDATE player SET nickname = (SELECT a.login_id FROM account a WHERE a.id = player.account_id)
 WHERE nickname LIKE 'GUEST-%'
   AND (SELECT a.login_id FROM account a WHERE a.id = player.account_id) IS NOT NULL;

UPDATE arena_entry SET nickname = (SELECT p.nickname FROM player p WHERE p.account_id = arena_entry.account_id)
 WHERE nickname LIKE 'GUEST-%'
   AND (SELECT p.nickname FROM player p WHERE p.account_id = arena_entry.account_id) NOT LIKE 'GUEST-%';

UPDATE territory SET owner_name = (SELECT p.nickname FROM player p WHERE p.account_id = territory.owner_id)
 WHERE owner_id IS NOT NULL
   AND owner_name LIKE 'GUEST-%'
   AND (SELECT p.nickname FROM player p WHERE p.account_id = territory.owner_id) NOT LIKE 'GUEST-%';

UPDATE meta SET v = '12' WHERE k = 'schema_version';
