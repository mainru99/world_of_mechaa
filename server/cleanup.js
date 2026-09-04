/* 청소 — 하루 한 번.
 *
 * 핵심 제약 하나: **지우는 것도 '쓴 행'으로 센다.** D1 무료 한도가 하루 10만 행이라
 * 밀린 것을 한 번에 다 지우면 그날 게임이 멈춘다. 그래서 표마다 상한을 두고,
 * 남은 것은 다음 날 이어서 지운다. 급할 것이 없다.
 *
 * SQLite 의 `DELETE ... LIMIT` 은 컴파일 옵션이라 D1 에서 보장되지 않는다.
 * 그래서 `WHERE <키> IN (SELECT <키> ... LIMIT n)` 으로 돌려 쓴다.
 */
import { balanceVersion } from './arena.js';

const CAP = 500;                 // 표 하나당 한 번에 지우는 상한
const DAY = 24 * 60 * 60 * 1000;
const KEEP_BATTLES = 50;         // 플레이어당 남길 전투 기록
const ARENA_STALE = 14 * DAY;    // 옛 밸런스 스냅샷을 이만큼 묵히고 지운다

async function run(env, sql, binds) {
  const r = await env.DB.prepare(sql).bind(...binds).run();
  return r.meta?.changes ?? 0;
}

export async function cleanup(env, now) {
  const out = {};

  /* ① 만료된 세션.
     로그인할 때마다 한 행씩 쌓이는데 지우는 곳이 없었다. 조용한 누수였다. */
  out.session = await run(env,
    `DELETE FROM session WHERE token IN (
       SELECT token FROM session WHERE expires_at < ?1 LIMIT ${CAP})`, [now]);

  /* ② 로그인 시도 기록.
     잠금이 이미 풀렸고 창(window)도 하루 넘게 지난 것은 아무 판단에도 안 쓰인다. */
  out.login_attempt = await run(env,
    `DELETE FROM login_attempt WHERE k IN (
       SELECT k FROM login_attempt
        WHERE blocked_until < ?1 AND first_at < ?2 LIMIT ${CAP})`, [now, now - DAY]);

  /* ③ 옛 밸런스로 만든 아레나 스냅샷.
     매칭이 balance_ver 로 거르므로 이미 아무에게도 안 보인다 — 순수한 짐이다.
     다만 밸런스를 되돌릴 수도 있으니 2주는 묵혔다 지운다.
     현재 버전 것은 절대 건드리지 않는다. 지우면 매칭 후보가 그만큼 사라진다. */
  out.arena_entry = await run(env,
    `DELETE FROM arena_entry WHERE account_id IN (
       SELECT account_id FROM arena_entry
        WHERE balance_ver != ?1 AND updated_at < ?2 LIMIT ${CAP})`,
    [balanceVersion(), now - ARENA_STALE]);

  /* ④ 전투 기록은 플레이어당 최근 50판만 남긴다.
     창(window) 함수가 표 전체를 훑으므로 30분마다가 아니라 하루 한 번만 돈다. */
  out.battle = await run(env,
    `DELETE FROM battle WHERE id IN (
       SELECT id FROM (
         SELECT id, ROW_NUMBER() OVER (
                  PARTITION BY attacker_id ORDER BY created_at DESC, id DESC) AS rn
           FROM battle)
        WHERE rn > ${KEEP_BATTLES} LIMIT ${CAP})`, []);

  /* ⑤ 이관 기록 메타. 계정이 지워져도 meta 의 migrated:<id> 는 남는다. */
  out.meta = await run(env,
    `DELETE FROM meta WHERE k IN (
       SELECT k FROM meta
        WHERE k LIKE 'migrated:%'
          AND CAST(substr(k, 10) AS INTEGER) NOT IN (SELECT id FROM account)
        LIMIT ${CAP})`, []);

  out.total = out.session + out.login_attempt + out.arena_entry + out.battle + out.meta;
  out.capped = Object.entries(out).some(([k, v]) => k !== 'total' && v >= CAP);
  return out;
}
