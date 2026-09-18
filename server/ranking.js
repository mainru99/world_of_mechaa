/* 랭킹.
 *
 * 순위는 주기적으로 한 번에 계산해 player.rank_cached 에 넣어 둔다.
 * 양쪽으로 함정이 있어서 이렇게 한다.
 *
 *   실시간 계산 → 읽기가 터진다.
 *     "나보다 rating 높은 사람 수"를 셀 때 하위권일수록 거의 전원을 읽는다.
 *     2만 명이면 조회 한 번에 2만 행. D1 무료 한도(하루 500만 행)가 조회 250번에 마른다.
 *
 *   크론이 매번 전원을 다시 쓰기 → 이번엔 쓰기가 터진다.
 *     2만 명 × 30분마다 = 하루 96만 행. 무료 한도는 10만 행이다.
 *
 * 그래서 **순위가 실제로 바뀐 행만** 쓴다. 아무도 안 싸운 30분 동안에는 쓰기가 0이다.
 * (실측: 순위 변동이 없는 재실행에서 rows_written 0)
 *
 * 전체 인원 수도 크론 때 재어 meta 에 넣어 둔다. COUNT(*) 는 인덱스를 훑어도
 * 결국 전원을 읽으므로, 조회할 때마다 세면 실시간 계산과 같은 문제가 된다.
 */

const TOP_N = 50;
const STATS_KEY = 'rank_stats';

/* 크론이 부른다. 한 문장으로 전원의 순위를 다시 매기되 바뀐 행만 쓴다. */
export async function refreshRanks(env, now) {
  const upd = await env.DB.prepare(
    `UPDATE player AS p
        SET rank_cached = r.rk, rank_at = ?1
       FROM (SELECT account_id,
                    ROW_NUMBER() OVER (ORDER BY rating DESC, account_id) AS rk
               FROM player) AS r
      WHERE p.account_id = r.account_id
        AND p.rank_cached IS NOT r.rk`).bind(now).run();

  const c = await env.DB.prepare('SELECT COUNT(*) AS n FROM player').first();
  /* 전체 평균 전투력 — 점령전이 지도 난이도를 여기에 맞춘다(server/territory.js).
     여기서 한 번 재서 meta 에 적어 두면, 지도를 볼 때마다 1행만 읽으면 된다.
     집계라도 arena_entry 전체를 훑는다. 위 ROW_NUMBER 가 이미 player 전체를 훑으므로
     자릿수가 달라지지는 않지만, 등록자가 수천을 넘으면 최근 접속자 표본으로 바꿀 것. */
  const w = await env.DB.prepare('SELECT AVG(power) AS p, COUNT(*) AS n FROM arena_entry').first();
  const stats = { count: c ? c.n : 0, at: now,
                  avgPower: Math.round((w && w.p) || 0), avgOf: (w && w.n) || 0 };
  await env.DB.prepare('INSERT OR REPLACE INTO meta (k, v) VALUES (?1, ?2)')
    .bind(STATS_KEY, JSON.stringify(stats)).run();

  return { changed: upd.meta?.changes ?? 0, count: stats.count, avgPower: stats.avgPower };
}

async function loadStats(env) {
  const row = await env.DB.prepare('SELECT v FROM meta WHERE k = ?1').bind(STATS_KEY).first();
  if (!row) return { count: 0, at: 0 };
  try { return JSON.parse(row.v); } catch { return { count: 0, at: 0 }; }
}

/* 조회 비용을 상수로 묶는다 — 상위 50행 + 내 1행 + 통계 1행. 인원이 늘어도 그대로다. */
export async function ranking(env, accountId) {
  const top = (await env.DB.prepare(
    `SELECT account_id, nickname, rating, wins, losses, json_extract(codex, '$.t') AS title
       FROM player ORDER BY rating DESC, account_id LIMIT ?1`).bind(TOP_N).all()).results || [];

  const me = await env.DB.prepare(
    `SELECT nickname, rating, wins, losses, rank_cached, rank_at, json_extract(codex, '$.t') AS title
       FROM player WHERE account_id = ?1`).bind(accountId).first();
  if (!me) return { ok: false, status: 404, error: 'no player' };

  let stats = await loadStats(env);
  /* 크론이 아직 한 번도 안 돈 상태(배포 직후·새 DB)면 인원 수가 0으로 보인다.
     그때만 그 자리에서 센다. 크론이 한 번 돌면 다시는 여기 오지 않는다. */
  if (!stats.at) {
    const c = await env.DB.prepare('SELECT COUNT(*) AS n FROM player').first();
    stats = { count: c ? c.n : 0, at: 0 };
  }

  /* 아직 집계된 적 없는 계정(가입 직후)은 크론을 기다리게 두면 '—' 만 보인다.
     인원이 적을 때만 그 자리에서 세어 준다. 많아지면 세는 비용이 곧 문제라 포기한다. */
  let rank = me.rank_cached, live = false;
  if (rank == null && stats.count > 0 && stats.count <= 3000) {
    const c = await env.DB.prepare(
      'SELECT COUNT(*) AS n FROM player WHERE rating > ?1 OR (rating = ?1 AND account_id < ?2)')
      .bind(me.rating, accountId).first();
    rank = (c ? c.n : 0) + 1;
    live = true;
  }

  return {
    ok: true,
    top: top.map((r, i) => ({
      rank: i + 1, nickname: r.nickname, rating: r.rating,
      wins: r.wins, losses: r.losses, me: r.account_id === accountId,
      /* 도감 칭호. 이름이 아니라 키를 내린다 — 이름은 화면이 CONST.CODEX.titles 에서 찾는다
         (이름을 고쳐도 저장값이 안 바뀌게). 없는 키면 titleName 이 null 이라 안 뜬다. */
      title: r.title || null,
    })),
    me: {
      nickname: me.nickname, rating: me.rating, wins: me.wins, losses: me.losses, title: me.title || null,
      rank, live,                      // live = 캐시가 아니라 지금 센 값
      rank_at: me.rank_at || null,
    },
    /* 인원 수는 30분 크론이 세어 둔 값이라, 그 사이 들어온 계정만큼 모자란다.
       그런데 top 목록은 지금 읽은 것이라 표에 보이는 줄이 더 많아지는 일이 생겼다
       (표에는 11명이 있는데 '전체 10명'). 적어도 보이는 것보다 작지는 않게 맞춘다. */
    total: Math.max(stats.count, top.length),
    ranked_at: stats.at || null,
  };
}
