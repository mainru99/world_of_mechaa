/* 뽑기 — 서버 판정.
 *
 * 클라가 "이런 게 나왔다"고 보내는 것을 믿지 않는다. 서버가 직접 굴리고,
 * 재화를 깎고, 결과 행을 만든 뒤 결과만 돌려준다.
 * 판정 자체는 js/gacha.js 를 클라와 공유한다 — 두 벌로 두면 반드시 어긋난다.
 */
import { CONST } from '../data/balance.js';
import { rollPull } from '../js/gacha.js';

/* 서버 난수. 클라가 보낸 값에 의존하지 않는다. */
function cryptoRnd() {
  const buf = new Uint32Array(1);
  return () => { crypto.getRandomValues(buf); return buf[0] / 4294967296; };
}

const MAX_PULLS = 10;

export async function serverPull(env, accountId, count, now) {
  const n = Math.max(1, Math.min(MAX_PULLS, Math.round(Number(count) || 1)));

  const player = await env.DB.prepare(
    'SELECT credits, cores, scrap, pulls, rev FROM player WHERE account_id = ?1').bind(accountId).first();
  if (!player) return { ok: false, status: 404, error: 'no player' };
  if (player.cores < n * CONST.PULL_COST)
    return { ok: false, status: 400, error: 'not enough cores', cores: player.cores };

  const robots = (await env.DB.prepare('SELECT uid, type FROM robot WHERE account_id = ?1')
    .bind(accountId).all()).results || [];
  const lvRow = await env.DB.prepare('SELECT MAX(level) AS lv FROM robot WHERE account_id = ?1')
    .bind(accountId).first();
  const level = Math.max(1, (lvRow && lvRow.lv) || 1);

  const owned = new Set(robots.map(r => r.type));
  const rnd = cryptoRnd();
  let seq = 0;
  const uid = () => 's' + now.toString(36) + (seq++).toString(36);

  let { credits, cores, scrap } = player;
  const results = [], newParts = [], newRobots = [];

  for (let i = 0; i < n; i++) {
    cores -= CONST.PULL_COST;
    const r = rollPull(owned, level, rnd, uid);
    if (r.kind === 'robot') { owned.add(r.type); newRobots.push(r.type); }
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
    stmts.push(env.DB.prepare(
      'INSERT INTO part (account_id, uid, slot, name, rarity, stats, enh, created_at) VALUES (?1,?2,?3,?4,?5,?6,0,?7)')
      .bind(accountId, p.uid, p.slot, p.name, p.rarity, JSON.stringify(p.stats), now));
  }
  for (const t of newRobots) {
    stmts.push(env.DB.prepare(
      'INSERT INTO robot (account_id, uid, type, level, exp, fat, fat_at, created_at) VALUES (?1,?2,?3,1,0,0,?4,?4)')
      .bind(accountId, 'r' + now.toString(36) + (seq++).toString(36), t, now));
  }
  const rev = player.rev + 1;
  stmts.push(env.DB.prepare(
    'UPDATE player SET credits=?1, cores=?2, scrap=?3, pulls=?4, rev=?5, updated_at=?6 WHERE account_id=?7')
    .bind(credits, cores, scrap, player.pulls + n, rev, now, accountId));

  await env.DB.batch(stmts);

  return { ok: true, results, rev, credits, cores, scrap, wrote: stmts.length };
}
