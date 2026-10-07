/* 난투 서버 자가 점검 — **진짜 SQLite 위에서** server/brawl.js 를 돌린다. (2026-10-07 · 계획 ④)
 *
 *   ① 스위치 — 꺼져 있으면 GET { on:false } · POST 403
 *   ② 보기 — 오늘의 대여 6기 · 대여 3장 · 첫 런 보상 남음 · 출전 목록 후보
 *   ③ 시작 — 대여는 오늘의 후보 안 · 장 수 · 출전 목록은 보유 C 아닌 것 · 대여 합쳐 상한 · 진행 중이면 409
 *   ④ 동작 — rev 가 어긋나면 409 · 틀린 동작은 아무것도 저장 안 함 · 서버가 같은 규칙으로 다시 돌린다
 *   ⑤ 전투 — 빈 보드 거절 · 같은 시드로 재생하면 같은 사건 · 내 보드가 유령으로 남는다 · 남의 유령과 붙는다 · 없으면 봇
 *   ⑥ 두 번 누름 — 같은 rev 로 두 번 싸우면 두 번째는 409, 유령 · 보상이 한 번만
 *   ⑦ 마감 — 첫 런만 보상(크레딧 · 스크랩 · 정제 코어 · 목표 조각) · 주간 기록 · 런 행 삭제 · 두 번째 런은 보상 없음 · 포기
 *   ⑧ 날짜 — 다음 날이면 대여 · 첫 런 보상이 다시 생긴다
 *   ⑨ 순위 · 청소
 *
 * node --no-warnings tools/brawlservercheck.mjs */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { CONST, ROBOT_TYPES } from '../data/balance.js';
import { brawlView, brawlRank, brawlRun, brawlCleanup } from '../server/brawl.js';
import { runBrawl } from '../js/brawl-sim.js';
import { teamOf, rewardOf, dailyRentals, act as brawlAct } from '../js/brawl.js';
import { dayOf } from '../js/raid.js';

let bad = 0;
const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) bad++; };

const db = new DatabaseSync(':memory:');
db.exec(readFileSync(new URL('../server/schema.sql', import.meta.url), 'utf8'));
const stmt = (sql, args = []) => ({
  bind: (...a) => stmt(sql, a),
  first: async () => db.prepare(sql).get(...args) ?? null,
  all: async () => ({ results: db.prepare(sql).all(...args) }),
  run: async () => { const r = db.prepare(sql).run(...args); return { meta: { changes: Number(r.changes) } }; },
});
/* D1 의 batch 는 한 트랜잭션이다 — 동시에 온 두 batch 가 섞이지 않게 차례로 돌린다 */
let chain = Promise.resolve();
const env = { DB: { prepare: sql => stmt(sql), batch: list => (chain = chain.then(async () => {
  db.exec('BEGIN'); const out = [];
  try { for (const s of list) out.push(await s.run()); db.exec('COMMIT'); } catch (e) { db.exec('ROLLBACK'); throw e; }
  return out; }, () => {})) } };
const q = (sql, ...a) => db.prepare(sql).get(...a);
const T0 = Date.UTC(2026, 9, 7, 3);                    // 2026-10-07 03:00 UTC
const DAY = 86400000;

let rid = 1;
function addPlayer(id, types, level) {
  db.prepare('INSERT INTO account (id, device_key, created_at, last_seen) VALUES (?, ?, ?, ?)').run(id, 'dev-' + id, T0, T0);
  db.prepare('INSERT INTO player (account_id, nickname, credits, level, updated_at) VALUES (?, ?, 1000, ?, ?)').run(id, 'PILOT-' + id, level, T0);
  for (const t of types) { db.prepare('INSERT INTO robot (id, account_id, type, level, uid, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(rid, id, t, level, 'r' + rid, T0); rid++; }
}
addPlayer(1, ['mule'], 30);                                                    // 새 계정
addPlayer(2, ['mule', 'ranger', 'azure', 'wraith', 'seraph', 'kestrel', 'glacier', 'nemesis'], 40);   // 고참
addPlayer(3, ['dune'], 20);

/* 상점에서 살 수 있는 것을 사서 보드부터 채우는 간단한 손 — 클라가 보낼 동작 목록을 만든다 */
function plan(run) {
  const acts = []; let r = run;
  for (let k = 0; k < 12; k++) {
    const i = r.shop.findIndex(t => t && CONST.BRAWL.price[ROBOT_TYPES[t].rarity] <= r.gold);
    if (i < 0) break;
    const x = brawlAct(r, { t: 'buy', i }); if (x.error) break;
    acts.push({ t: 'buy', i }); r = x.run;
  }
  for (let b = 0; b < r.bench.length; b++) {
    const to = r.board.indexOf(null); if (to < 0 || !r.bench[b]) continue;
    const a = { t: 'move', from: { where: 'bench', i: b }, to: { where: 'board', i: to } };
    const x = brawlAct(r, a); if (!x.error) { acts.push(a); r = x.run; }
  }
  return acts;
}

console.log('== ① 스위치 ==');
{
  CONST.BRAWL.on = false;
  const v = await brawlView(env, 1, T0), p = await brawlRun(env, 1, T0, { action: 'start' });
  ok(v.ok && v.on === false && Object.keys(v).length === 2, '꺼져 있으면 보기는 { on:false } 만');
  ok(!p.ok && p.status === 403 && p.error === 'brawl off', 'POST 는 403 brawl off');
  CONST.BRAWL.on = true;
}

console.log('\n== ② 보기 ==');
let offers1;
{
  const v = await brawlView(env, 1, T0);
  offers1 = v.offers;
  ok(v.on && v.offers.length === CONST.BRAWL.rent.offers && v.tickets === CONST.BRAWL.rent.daily && v.rewardLeft && v.run === null,
     `오늘의 대여 ${v.offers.length}기 · 대여 ${v.tickets}장 · 첫 런 보상 남음 · 진행 중인 런 없음`);
  ok(JSON.stringify(v.offers) === JSON.stringify(dailyRentals(dayOf(T0), ['mule'])), '대여 후보는 js/brawl.js dailyRentals 그대로');
  const v2 = await brawlView(env, 2, T0);
  ok(v2.deckFrom.length === 7 && !v2.deckFrom.includes('mule') && !v2.offers.some(t => v2.deckFrom.includes(t)), '출전 목록 후보 = 보유 C 아닌 7종 · 대여 후보에 보유 기체 없음');
}

console.log('\n== ③ 시작 ==');
{
  const e1 = await brawlRun(env, 1, T0, { action: 'start', rentals: ['seraph'] });
  ok(e1.error === 'bad rental' || offers1.includes('seraph'), '오늘의 후보가 아닌 대여 거절');
  const e2 = await brawlRun(env, 1, T0, { action: 'start', rentals: [offers1[0], offers1[0]] });
  ok(e2.error === 'bad rental', '같은 대여 두 장 거절');
  const e3 = await brawlRun(env, 1, T0, { action: 'start', rentals: offers1.slice(0, 4) });
  ok(e3.error === 'no tickets' && e3.tickets === 3, '장 수보다 많으면 no tickets');
  const e4 = await brawlRun(env, 2, T0, { action: 'start', deck: ['seraph', 'grit'] });
  ok(e4.error === 'bad deck', '보유하지 않은 기체는 출전 목록에 못 넣는다');
  const e5 = await brawlRun(env, 2, T0, { action: 'start', deck: ['mule'] });
  ok(e5.error === 'bad deck', 'C 기체는 출전 목록에 넣지 않는다(언제나 나온다)');
  const v2 = await brawlView(env, 2, T0);
  const e6 = await brawlRun(env, 2, T0, { action: 'start', rentals: v2.offers.slice(0, 2), deck: ['seraph', 'nemesis', 'wraith', 'azure', 'ranger'] });
  ok(e6.error === 'deck too big' && e6.cap === CONST.BRAWL.deck, `대여 + 출전 목록이 ${CONST.BRAWL.deck} 를 넘으면 거절`);
  ok(q('SELECT COUNT(*) n FROM brawl_run').n === 0 && q('SELECT brawl FROM player WHERE account_id=1').brawl === null, '거절된 시작은 아무것도 안 남긴다');

  const s1 = await brawlRun(env, 1, T0, { action: 'start', rentals: offers1.slice(0, 2) });
  ok(s1.ok && s1.run.rev === 0 && s1.run.first && s1.tickets === 1, '시작 — rev 0 · 첫 런 · 대여 1장 남음');
  ok(offers1.slice(0, 2).every(t => s1.run.run.pool.includes(t)) && s1.run.run.pool.filter(t => ROBOT_TYPES[t].rarity !== 'C').length === 2, '풀 = C + 고른 대여');
  ok(s1.run.syn && s1.run.odds && s1.run.income, '화면용 시너지 · 등급 몫 · 수입 미리 보기');
  const s1b = await brawlRun(env, 1, T0, { action: 'start' });
  ok(s1b.status === 409 && s1b.error === 'run active', '진행 중이면 409');
  const s2 = await brawlRun(env, 2, T0, { action: 'start', deck: ['seraph', 'nemesis', 'glacier'] });
  ok(s2.ok && ['seraph', 'nemesis', 'glacier'].every(t => s2.run.run.pool.includes(t)) && !s2.run.run.pool.includes('azure'), '출전 목록에 고른 것만 풀에 든다');
}

console.log('\n== ④ 동작 ==');
{
  const row = () => q('SELECT run, rev FROM brawl_run WHERE account_id=1');
  const r0 = JSON.parse(row().run);
  const st = await brawlRun(env, 1, T0, { action: 'act', rev: 5, actions: [{ t: 'reroll' }] });
  ok(st.status === 409 && st.error === 'stale rev' && st.rev === 0, 'rev 가 어긋나면 409 와 지금 rev');
  const bad1 = await brawlRun(env, 1, T0, { action: 'act', rev: 0, actions: [{ t: 'buy', i: 0 }, { t: 'sell', where: 'bench', i: 5 }] });
  ok(bad1.status === 400 && bad1.error === 'empty slot' && bad1.at === 1 && row().rev === 0 && JSON.parse(row().run).gold === r0.gold, '틀린 동작이 하나라도 있으면 앞의 것도 저장 안 함(몇 번째인지 알려 준다)');
  const forged = await brawlRun(env, 1, T0, { action: 'act', rev: 0, actions: [{ t: 'buy', i: 0 }], run: { ...r0, gold: 999 } });
  const after = JSON.parse(row().run);
  ok(forged.ok && after.gold === r0.gold - CONST.BRAWL.price[ROBOT_TYPES[r0.shop[0]].rarity] && row().rev === 1, '클라가 보낸 런 상태는 무시 — 서버가 같은 규칙으로 다시 돌린다');
  ok(forged.run.rev === 1 && forged.run.run.bench[0].type === r0.shop[0], '응답의 런 = 저장된 런');
  const big = await brawlRun(env, 1, T0, { action: 'act', rev: 1, actions: Array(201).fill({ t: 'lock' }) });
  ok(big.error === 'bad actions', '동작은 한 번에 200 까지');
}

console.log('\n== ⑤ 전투 ==');
let fought;
{
  const cur = q('SELECT run, rev FROM brawl_run WHERE account_id=3');
  ok(!cur, '(계정 3 은 아직 런 없음)');
  await brawlRun(env, 3, T0, { action: 'start' });
  const e = await brawlRun(env, 3, T0, { action: 'fight', rev: 0, actions: [] });
  ok(e.error === 'empty board', '빈 보드로는 못 싸운다');
  const r3 = JSON.parse(q('SELECT run FROM brawl_run WHERE account_id=3').run);
  const f3 = await brawlRun(env, 3, T0, { action: 'fight', rev: 0, actions: plan(r3) });
  ok(f3.ok && f3.opponent.bot && f3.opponent.nickname === '훈련 봇', '유령이 없으면 봇과 붙는다');
  const replay = runBrawl({ p: teamOf(f3.me.board), e: teamOf(f3.opponent.board), seed: f3.seed });
  ok(JSON.stringify(replay.events) === JSON.stringify(f3.events) && replay.win === f3.win, '같은 보드 · 같은 시드로 재생하면 같은 사건 · 같은 승패');
  ok(q('SELECT COUNT(*) n FROM brawl_ghost WHERE round=1 AND account_id=3').n === 1, '내 1라운드 보드가 유령으로 남는다');
  ok(f3.run.rev === 1 && f3.run.run.round === 2 && f3.round === 1 && (f3.win ? f3.lost === 0 : f3.lost === 1), '라운드가 넘어가고 승패가 반영된다');

  const r1 = JSON.parse(q('SELECT run FROM brawl_run WHERE account_id=1').run);
  const f1 = await brawlRun(env, 1, T0, { action: 'fight', rev: 1, actions: plan(r1) });
  ok(f1.ok && !f1.opponent.bot && f1.opponent.nickname === 'PILOT-3', '같은 라운드의 다른 사람 유령과 붙는다');
  const met = JSON.parse(q('SELECT met FROM brawl_run WHERE account_id=1').met);
  ok(met.length === 1, '만난 유령을 적어 둔다(다시 만나지 않는다)');
  fought = f1;
}

console.log('\n== ⑥ 두 번 누름 ==');
{
  const ghosts0 = q('SELECT COUNT(*) n FROM brawl_ghost').n;
  const r1 = JSON.parse(q('SELECT run FROM brawl_run WHERE account_id=1').run);
  const a = plan(r1);
  const [x, y] = await Promise.all([brawlRun(env, 1, T0, { action: 'fight', rev: 2, actions: a }), brawlRun(env, 1, T0, { action: 'fight', rev: 2, actions: a })]);
  ok([x, y].filter(r => r.ok).length === 1 && [x, y].some(r => r.status === 409), '같은 rev 로 두 번 → 한 번만 싸운다');
  ok(q('SELECT COUNT(*) n FROM brawl_ghost').n === ghosts0 + 1, '유령도 하나만 남는다');
}

console.log('\n== ⑦ 마감 · 보상 ==');
{
  const p0 = q('SELECT credits, scrap, rcores, items, m_goal, level FROM player WHERE account_id=2');
  let last, n = 0;
  while (n++ < 30) {
    const row = q('SELECT run, rev FROM brawl_run WHERE account_id=2');
    if (!row) break;
    last = await brawlRun(env, 2, T0, { action: 'fight', rev: row.rev, actions: plan(JSON.parse(row.run)) });
    if (!last.ok) { ok(false, '전투 실패 ' + last.error); break; }
  }
  ok(last && last.done && last.result && last.run === null && !q('SELECT 1 x FROM brawl_run WHERE account_id=2'), `런이 끝나면 행을 지운다 — ${last.result.wins}승 ${last.result.losses}패 · ${last.result.rounds}라운드`);
  const p1 = q('SELECT credits, scrap, rcores, items FROM player WHERE account_id=2');
  const want = rewardOf(last.result.wins, p0.level);
  ok(last.reward && p1.credits - p0.credits === want.cr && p1.scrap - p0.scrap === want.sc && p1.rcores - p0.rcores === want.refined,
     `첫 런 보상 — 크레딧 +${want.cr} · 스크랩 +${want.sc} · 정제 코어 +${want.refined}`);
  const items = JSON.parse(p1.items || '{}');
  ok(!want.shard || (last.reward.shardTo && items['shard:' + last.reward.shardTo] === want.shard), want.shard ? `목표 조각 +${want.shard} → ${last.reward.shardTo}` : '(이 런은 조각 승수에 못 미쳤다)');
  const wk = q('SELECT best, lives, runs FROM brawl_week WHERE account_id=2');
  ok(wk && wk.best === last.result.wins && wk.runs === 1, `주간 기록 — 최고 ${wk && wk.best}승`);

  /* 보상 묶음이 승수별로 맞게 들어가는지 — 10승 보상(조각 · 정제 코어)을 직접 확인한다 */
  db.prepare('INSERT INTO brawl_run (account_id, run, first, met, rev, started_at, updated_at) VALUES (2, ?, 1, ?, 7, ?, ?)')
    .run(JSON.stringify({ ...JSON.parse(JSON.stringify(fought.run.run)), wins: 10, lives: 4, losses: 3, done: false }), '[]', T0, T0);
  const pq = q('SELECT credits, rcores, items FROM player WHERE account_id=2');
  const qt = await brawlRun(env, 2, T0, { action: 'quit', rev: 7 });
  const pq1 = q('SELECT credits, rcores, items FROM player WHERE account_id=2');
  const w10 = rewardOf(10, 40), it = JSON.parse(pq1.items || '{}'), it0 = JSON.parse(pq.items || '{}');
  ok(qt.ok && qt.reward.refined === 1 && pq1.rcores - pq.rcores === 1 && pq1.credits - pq.credits === w10.cr, `10승 마감 → 정제 코어 1 · 크레딧 +${w10.cr}`);
  ok(qt.reward.shardTo && (it['shard:' + qt.reward.shardTo] | 0) - (it0['shard:' + qt.reward.shardTo] | 0) === w10.shard, `목표 조각 +${w10.shard} (개발 목표가 없으면 열 수 있는 가장 높은 등급 — ${qt.reward.shardTo})`);
  ok(q('SELECT best, runs FROM brawl_week WHERE account_id=2').best === 10, '주간 최고 승수가 오른다');

  const v = await brawlView(env, 2, T0);
  ok(!v.rewardLeft && v.runsToday === 1, '오늘 첫 런을 썼다');
  const s = await brawlRun(env, 2, T0, { action: 'start' });
  ok(s.ok && !s.run.first, '두 번째 런은 보상 대상이 아니다');
  const pr0 = q('SELECT credits FROM player WHERE account_id=2');
  const quit = await brawlRun(env, 2, T0, { action: 'quit', rev: 0 });
  ok(quit.ok && quit.reward === null && q('SELECT credits FROM player WHERE account_id=2').credits === pr0.credits, '두 번째 런을 끝내도 보상 없음');
  ok(q('SELECT best, runs FROM brawl_week WHERE account_id=2').runs === 3 && q('SELECT best FROM brawl_week WHERE account_id=2').best === 10, '순위에는 런 수만 오르고 최고 기록은 그대로');
}

console.log('\n== ⑧ 날짜 ==');
{
  await brawlRun(env, 1, T0, { action: 'quit', rev: q('SELECT rev FROM brawl_run WHERE account_id=1').rev });
  const used = await brawlRun(env, 1, T0, { action: 'start', rentals: offers1.slice(2, 4) });
  ok(used.error === 'no tickets' && used.tickets === 1, '오늘 대여를 다 쓰면(2장 + 2장 > 3) 거절');
  const v = await brawlView(env, 1, T0 + DAY);
  ok(v.tickets === CONST.BRAWL.rent.daily && v.rewardLeft && v.day === dayOf(T0) + 1, '다음 날(UTC) — 대여 3장 · 첫 런 보상이 다시 생긴다');
  ok(JSON.stringify(v.offers) !== JSON.stringify(offers1), '오늘의 대여도 바뀐다');
}

console.log('\n== ⑨ 순위 · 청소 ==');
{
  const r = await brawlRank(env, 2, T0);
  ok(r.ok && r.top[0].nickname === 'PILOT-2' && r.top[0].best === 10 && r.top[0].me && r.me.rank === 1, '이번 주 1위 — 최고 승수 순');
  const r3 = await brawlRank(env, 3, T0);
  ok(r3.me === null || r3.me.rank >= 2, '아직 런을 끝내지 않았으면 내 자리 없음 · 끝냈으면 그 아래');
  db.prepare('INSERT INTO brawl_ghost (round, account_id, nickname, board, created_at) VALUES (1, 3, ?, ?, ?)').run('OLD', '[]', T0 - 20 * DAY);
  const c = await brawlCleanup(env, T0, 500);
  ok(c.ghosts === 1 && !q("SELECT 1 x FROM brawl_ghost WHERE nickname='OLD'"), '14일 넘은 유령만 지운다');
}

CONST.BRAWL.on = false;
console.log(bad ? `\n✗ ${bad}건 실패` : '\n전부 통과');
if (bad) process.exitCode = 1;
