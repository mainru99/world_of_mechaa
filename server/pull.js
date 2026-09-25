/* 뽑기 — 서버 판정.
 *
 * 클라가 "이런 게 나왔다"고 보내는 것을 믿지 않는다. 서버가 직접 굴리고,
 * 재화를 깎고, 결과 행을 만든 뒤 결과만 돌려준다.
 * 판정 자체는 js/gacha.js 를 클라와 공유한다 — 두 벌로 두면 반드시 어긋난다.
 */
import { CONST } from '../data/balance.js';
import { rollPull, PULL_CUR, PULL_COL } from '../js/gacha.js';
import { insertPart } from './parts.js';

/* 서버 난수. 클라가 보낸 값에 의존하지 않는다. */
function cryptoRnd() {
  const buf = new Uint32Array(1);
  return () => { crypto.getRandomValues(buf); return buf[0] / 4294967296; };
}

const MAX_PULLS = 10;

export async function serverPull(env, accountId, count, now, cur) {
  const n = Math.max(1, Math.min(MAX_PULLS, Math.round(Number(count) || 1)));
  /* 창구는 서버가 정한다. 클라가 보낸 문자열을 그대로 키로 쓰면 없는 창구를 만들어
     값이 0 인 뽑기를 돌릴 수 있다. 모르는 값은 코어로 떨어뜨린다.
     hasOwn 으로 본다 — 'toString' 같은 이름이 창구로 읽히지 않게 */
  const kind = Object.prototype.hasOwnProperty.call(PULL_CUR, cur) ? cur : 'core';
  const C = PULL_CUR[kind];

  const player = await env.DB.prepare(
    'SELECT credits, cores, rcores, scrap, pulls, rev FROM player WHERE account_id = ?1').bind(accountId).first();
  if (!player) return { ok: false, status: 404, error: 'no player' };

  const spend = n * C.cost;
  const col = PULL_COL[kind];
  if (player[col] < spend)
    return { ok: false, status: 400, error: 'not enough ' + col, [col]: player[col] };

  const robots = (await env.DB.prepare('SELECT uid, type FROM robot WHERE account_id = ?1')
    .bind(accountId).all()).results || [];
  const lvRow = await env.DB.prepare('SELECT MAX(level) AS lv FROM robot WHERE account_id = ?1')
    .bind(accountId).first();
  const level = Math.max(1, (lvRow && lvRow.lv) || 1);

  const owned = new Set(robots.map(r => r.type));
  const rnd = cryptoRnd();
  let seq = 0;
  const uid = () => 's' + now.toString(36) + (seq++).toString(36);

  let { credits, cores, rcores, scrap } = player;
  const results = [], newParts = [], newRobots = [];

  for (let i = 0; i < n; i++) {
    if (kind === 'credit') credits -= C.cost; else if (kind === 'rcore') rcores -= C.cost; else cores -= C.cost;
    const r = rollPull(owned, level, rnd, uid, kind);
    if (r.kind === 'robot') {
      owned.add(r.type);
      /* uid 는 여기서 정해 **결과에 실어 보낸다.** 클라가 따로 만들면 서버 행과 uid 가
         달라져, 그 기체로는 편성·선택·정비·원정이 전부 'robot not found' 가 된다.
         (원정 목록처럼 클라 상태만 보고 그리는 화면에는 멀쩡히 보여 더 헷갈린다) */
      r.uid = 'r' + now.toString(36) + (seq++).toString(36);
      newRobots.push(r);
    }
    else if (r.kind === 'dupe') { credits += r.gain.cr; scrap += r.gain.sc; cores += r.gain.co; }
    else if (r.kind === 'core') cores += r.n;
    else if (r.kind === 'credit') credits += r.cr;
    else if (r.kind === 'part') newParts.push(r.part);
    else if (r.kind === 'scrap') scrap += r.n;
    results.push(r);
  }

  /* 결과를 한 번에 기록한다. 파츠·기체 행 + player 한 행. */
  const stmts = [];
  for (const p of newParts) {
    stmts.push(insertPart(env.DB, accountId, p, now, 0));
  }
  for (const rb of newRobots) {
    stmts.push(env.DB.prepare(
      'INSERT INTO robot (account_id, uid, type, level, exp, fat, fat_at, created_at) VALUES (?1,?2,?3,1,0,0,?4,?4)')
      .bind(accountId, rb.uid, rb.type, now));
  }
  const rev = player.rev + 1;
  stmts.push(env.DB.prepare(
    'UPDATE player SET credits=?1, cores=?2, rcores=?3, scrap=?4, pulls=?5, rev=?6, updated_at=?7 WHERE account_id=?8')
    .bind(credits, cores, rcores, scrap, player.pulls + n, rev, now, accountId));

  await env.DB.batch(stmts);

  return { ok: true, cur: kind, spent: spend, results, rev, credits, cores, rcores, scrap, wrote: stmts.length };
}
