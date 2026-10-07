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
import { retakeOne } from './territory.js';
import { brawlCleanup } from './brawl.js';

const CAP = 500;                 // 표 하나당 한 번에 지우는 상한
const DAY = 24 * 60 * 60 * 1000;
const KEEP_BATTLES = 50;         // 플레이어당 남길 전투 기록
const ARENA_STALE = 14 * DAY;    // 옛 밸런스 스냅샷을 이만큼 묵히고 지운다

const INACTIVE_DAYS = 60;        // 이만큼 접속이 없으면 계정을 지운다
/* 한 번에 지우는 계정 수. 계정 하나가 파츠 300 + 기체 30 + 전투 50 까지 될 수 있어,
   최악이면 계정당 약 400행이다. 50개면 2만행 — 하루 10만행 한도의 5분의 1이다.
   밀린 것은 다음 날 이어서 지운다. */
const ACCOUNT_CAP = 50;

async function run(env, sql, binds) {
  const r = await env.DB.prepare(sql).bind(...binds).run();
  return r.meta?.changes ?? 0;
}

/* 미접속 계정 삭제를 끌 수 있는 스위치. meta 에 '0' 을 넣으면 멈춘다.
   되돌릴 수 없는 작업이라 재배포 없이 끌 수 있어야 한다. */
export async function purgeEnabled(env) {
  const row = await env.DB.prepare("SELECT v FROM meta WHERE k = 'purge_inactive'").first();
  return !row || row.v === '1';
}

/* 두 달 넘게 접속이 없는 계정을 통째로 지운다.
 *
 * 되돌릴 수 없다. 그래서 조건을 좁게 잡았다.
 *   · last_seen 이 0 이거나 없는 행은 건드리지 않는다 (값이 깨진 경우를 지우지 않는다)
 *   · 밴 계정은 남긴다. 기록이 사라지면 같은 사람이 새 계정으로 그냥 돌아온다
 *   · meta 스위치로 끌 수 있다
 *
 * last_seen 은 이제 요청마다(하루 한 번으로 묶어) 갱신된다 — server/worker.js 의 auth().
 * 예전처럼 로그인 때만 찍으면 세션이 90일이라 매일 노는 사람도 여기 걸린다.
 *
 * 지우는 순서는 자식 표부터다. 스키마에 ON DELETE CASCADE 가 걸려 있지만
 * D1 의 외래키 강제 여부에 기대지 않는다 — 명시적으로 지워야 몇 행을 썼는지도 셀 수 있다.
 */
async function purgeInactive(env, now) {
  if (!(await purgeEnabled(env))) return { off: true, accounts: 0 };

  const cutoff = now - INACTIVE_DAYS * DAY;
  const rows = (await env.DB.prepare(
    `SELECT id FROM account
      WHERE status = 'active' AND last_seen > 0 AND last_seen < ?1
      ORDER BY last_seen LIMIT ${ACCOUNT_CAP}`).bind(cutoff).all()).results || [];
  if (!rows.length) return { accounts: 0 };

  const ids = rows.map(r => r.id);
  /* 목록을 먼저 확정해 두고 그 id 로만 지운다. 매 문장마다 조건을 다시 고르면,
     지우는 도중에 누가 접속해 last_seen 이 갱신될 때 반쪽만 지워진 계정이 남는다. */
  const ph = ids.map((_, i) => '?' + (i + 1)).join(',');
  const stmt = sql => env.DB.prepare(sql).bind(...ids);

  const res = await env.DB.batch([
    stmt(`DELETE FROM battle      WHERE attacker_id IN (${ph})`),
    /* 남의 전투 기록에 남은 참조는 NULL 로 끊는다.
       def_kind='player' 행은 CHECK 가 defender_id 를 제한하지 않아 NULL 이 허용된다. */
    stmt(`UPDATE battle SET defender_id = NULL WHERE defender_id IN (${ph})`),
    stmt(`UPDATE battle SET winner_id   = NULL WHERE winner_id   IN (${ph})`),
    stmt(`DELETE FROM arena_entry WHERE account_id IN (${ph})`),
    stmt(`DELETE FROM part        WHERE account_id IN (${ph})`),
    stmt(`DELETE FROM robot       WHERE account_id IN (${ph})`),
    stmt(`DELETE FROM player      WHERE account_id IN (${ph})`),
    stmt(`DELETE FROM session     WHERE account_id IN (${ph})`),
    env.DB.prepare(`DELETE FROM meta WHERE k IN (${ids.map((_, i) => '?' + (i + 1)).join(',')})`)
      .bind(...ids.map(i => 'migrated:' + i)),
    stmt(`DELETE FROM account     WHERE id IN (${ph})`),
  ]);

  const wrote = res.reduce((s, r) => s + (r.meta?.changes ?? 0), 0);
  /* 무엇을 지웠는지 한 줄 남긴다. 되돌릴 수 없는 작업이라 흔적은 있어야 한다. */
  await env.DB.prepare('INSERT OR REPLACE INTO meta (k, v) VALUES (?1, ?2)')
    .bind('purge_log', JSON.stringify({ at: now, accounts: ids.length, rows: wrote,
                                        oldest: rows[0].id, capped: ids.length >= ACCOUNT_CAP })).run();

  return { accounts: ids.length, rows: wrote, capped: ids.length >= ACCOUNT_CAP };
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

  /* ⑤-2 난투(025) — 14일 넘은 라운드 보드(유령) · 8주 넘은 주간 기록 */
  const bw = await brawlCleanup(env, now, CAP);
  out.brawl_ghost = bw.ghosts; out.brawl_week = bw.weeks;

  out.total = out.session + out.login_attempt + out.arena_entry + out.battle + out.meta + out.brawl_ghost + out.brawl_week;
  out.capped = Object.entries(out).some(([k, v]) => k !== 'total' && v >= CAP);

  /* ⑥ 두 달 넘게 접속이 없는 계정.
     맨 마지막에 둔다 — 위의 정리로 이 계정들의 전투·세션이 이미 줄어 있으면
     여기서 지울 행도 그만큼 적어진다. */
  out.purged = await purgeInactive(env, now);

  /* ⑦ 점령전 되찾기. 한 사람이 지도의 절반을 넘게 들고 있을 때만,
     가장 오래 들고 있던 칸 하나를 몬스터가 되찾는다.
     혼자 노는 동안 지도를 다 먹으면 그걸로 끝이라, 다시 나갈 이유를 하루에 하나씩 만든다.
     절반을 넘기 전에는 아무 일도 일어나지 않는다 — 초반부터 뺏지는 않는다. */
  out.territory = await retakeOne(env, now);
  return out;
}
