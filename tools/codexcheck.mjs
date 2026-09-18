/* 도감 자가 점검 — **진짜 SQLite 위에서** 기록 · 보상 · 칭호를 끝까지 돌린다.
 *
 * 도감은 기록하는 곳이 흩어져 있다(트리거 둘 + 전투 정산 다섯 곳). 한 곳이 빠져도
 * 화면은 멀쩡히 뜨고 '그 몬스터만 영영 안 채워지는' 식으로 조용히 망가진다.
 * 그래서 각 경로를 실제로 한 번씩 지나가게 한다.
 *
 *   ① 트리거 — 파츠·기체가 들어오면 도감에 적힌다 (옛 파츠는 안 적힌다)
 *   ② 몬스터 — 대전 · 전선 · 시련 · 레이드 · 점령 정산이 만난 수·처치 수를 적는다
 *   ③ 보상   — 서버가 js/codex.js 로 다시 세서 준다 · 두 번 못 받는다 · 100칸 넘게 한 번에
 *   ④ 칭호   — 잠긴 것·없는 것은 거절 · 단 것은 순위표에 뜬다
 *   ⑤ state  — /api/state 가 도감 원본을 내린다
 *
 * node --no-warnings tools/codexcheck.mjs */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { CONST, MONSTER_TYPES, PART_BASES } from '../data/balance.js';
import { findMatch, startBattle } from '../server/battle.js';
import { frontRun } from '../server/front.js';
import { trialRun } from '../server/trial.js';
import { raidRun } from '../server/raid.js';
import { attackNode } from '../server/territory.js';
import { codexRun, codexGet } from '../server/codex.js';
import { loadState } from '../server/state.js';
import { ranking } from '../server/ranking.js';
import { insertPart } from '../server/parts.js';
import { codexView, codexRewards, PART_KEYS } from '../js/codex.js';
import { rollPart } from '../js/gacha.js';

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
const env = { DB: { prepare: sql => stmt(sql), batch: async list => { for (const s of list) await s.run(); return []; } } };
const q = (sql, ...a) => db.prepare(sql).get(...a);
const cx = () => JSON.parse(q('SELECT codex FROM player WHERE account_id=1').codex || '{}');

const T0 = 1_760_000_000_000;
db.prepare('INSERT INTO account (id, device_key, created_at, last_seen) VALUES (1, ?, ?, ?)').run('dev-1', T0, T0);
db.prepare(`INSERT INTO player (account_id, nickname, credits, cores, scrap, rating, updated_at, level)
            VALUES (1, 'TESTER', 999999, 0, 0, 1500, ?, 40)`).run(T0);

console.log('== ① 트리거 — 들어오는 순간 DB 가 적는다 ==');
db.prepare(`INSERT INTO robot (id, account_id, type, level, uid, created_at) VALUES (1, 1, 'azure', 40, 'r1', ?)`).run(T0);
db.prepare(`INSERT INTO robot (id, account_id, type, level, uid, created_at) VALUES (2, 1, 'grit', 40, 'r2', ?)`).run(T0);
db.prepare('UPDATE player SET sel_robot = 1, squad1 = 1, squad2 = 2 WHERE account_id = 1').run();
ok(cx().r && cx().r.azure === 1 && cx().r.grit === 1, `기체 트리거 — ${JSON.stringify(cx().r)}`);
let sd = 7; const rnd = () => { sd = (Math.imul(sd, 1664525) + 1013904223) >>> 0; return sd / 4294967296; };
const p1 = rollPart(30, rnd, 'p1', 'SSR', 'WEAPON');
await insertPart(env.DB, 1, p1, T0, 0).run();
ok(cx().p && cx().p[p1.base + ':SSR'] === 1, `파츠 트리거 — ${p1.base}:SSR`);
db.prepare(`INSERT INTO part (account_id, slot, name, rarity, stats, uid, created_at) VALUES (1,'CORE','옛 파츠','C','{}','old1',?)`).run(T0);
ok(Object.keys(cx().p).length === 1, '옛 파츠(base 없음)는 칸이 없어 안 적힌다');

console.log('\n== ② 몬스터 — 전투 정산 다섯 곳 ==');
const seenBefore = () => Object.values(cx().ms || {}).reduce((a, b) => a + b, 0);
/* 대전 — 크레딧 0 이면 비상 출격(몬스터 고정)이 잡힌다 */
{
  db.prepare('UPDATE player SET credits = 0 WHERE account_id=1').run();
  await findMatch(env, 1, T0 + 1000, null);
  const pend = JSON.parse(q('SELECT pending_match FROM player WHERE account_id=1').pending_match);
  const before = cx();
  const r = await startBattle(env, 1, T0 + 2000, { tactic: 'bal' });
  const after = cx(), id = pend.opp.type;
  ok(r.ok && pend.opp.kind === 'monster', `대전(비상 출격) — 상대 ${id}`);
  ok((after.ms?.[id] | 0) === (before.ms?.[id] | 0) + 1, '대전 — 만난 수 +1');
  ok((after.mk?.[id] | 0) === (before.mk?.[id] | 0) + (r.win ? 1 : 0), `대전 — ${r.win ? '이겨서 처치 +1' : '져서 처치 그대로'}`);
  db.prepare('UPDATE player SET credits = 999999 WHERE account_id=1').run();
}
/* 전선 1-1 */
{
  const b = seenBefore();
  const r = await frontRun(env, 1, { cell: 'c1-1' }, T0 + 3000);
  ok(r.ok, `전선 1-1 ${r.ok ? (r.win ? '승' : '패') : r.error}`);
  ok(seenBefore() > b, `전선 — 닿은 방어선만큼 만난 수가 오른다 (+${seenBefore() - b})`);
}
/* 시련 */
{
  const b = seenBefore();
  const r = await trialRun(env, 1, T0 + 4000);
  ok(r.ok && seenBefore() === b + 1, `시련 — ${r.trial && r.trial.type} 만난 수 +1`);
}
/* 레이드 */
{
  const b = seenBefore();
  const r = await raidRun(env, 1, T0 + 5000);
  const boss = Object.keys(cx().ms || {}).find(k => MONSTER_TYPES[k].rarity === 'BOSS');
  ok(r.ok && seenBefore() === b + 1 && !!boss, `레이드 — 보스 ${boss} 만난 수 +1`);
}
/* 점령 — 주인 없는 칸은 몬스터가 지킨다 */
{
  const b = seenBefore();
  const node = (CONST.TERRITORY_NODES || []).map(n => n.id)[0] ||
               Object.keys((await import('../data/balance.js')).TERRITORY?.nodes || {})[0];
  const nodes = (await import('../data/balance.js')).TERRITORY;
  const nid = Array.isArray(nodes) ? nodes[0].id : (nodes.nodes ? nodes.nodes[0].id : node);
  const r = await attackNode(env, 1, T0 + 6000, nid, false);
  ok(r.ok !== false && seenBefore() > b, `점령(${nid}) — 몬스터 방어선을 적는다 (+${seenBefore() - b})${r.ok === false ? ' · ' + r.error : ''}`);
}

console.log('\n== ③ 보상 — 서버가 다시 센다 · 두 번 못 받는다 ==');
{
  const before = q('SELECT cores, scrap FROM player WHERE account_id=1');
  const expect = codexRewards(codexView(q('SELECT codex FROM player WHERE account_id=1').codex,
    db.prepare('SELECT type FROM robot WHERE account_id=1').all(),
    db.prepare('SELECT base, rarity FROM part WHERE account_id=1 AND base IS NOT NULL').all()));
  const r = await codexRun(env, 1, T0 + 7000, { action: 'claim' });
  const after = q('SELECT cores, scrap FROM player WHERE account_id=1');
  ok(r.ok && r.claimed.length === expect.items.length, `받기 — ${r.ok ? r.claimed.length : r.error}건`);
  ok(after.scrap - before.scrap === expect.total.sc && after.cores - before.cores === expect.total.co,
     `재화가 계산과 같다 — 스크랩 +${after.scrap - before.scrap} · 코어 +${after.cores - before.cores}`);
  const again = await codexRun(env, 1, T0 + 7001, { action: 'claim' });
  ok(!again.ok && again.error === 'nothing to claim', '두 번째 받기는 거절된다');
  const snap = q('SELECT scrap FROM player WHERE account_id=1').scrap;
  ok(snap === after.scrap, '두 번째 받기로 재화가 안 늘었다');
}
{
  /* 낙관적 잠금 — 읽은 뒤 도감이 바뀌면(그 사이 전투가 적으면) 0행이 되어 409 */
  const real = env.DB.prepare;
  let fired = false;
  env.DB.prepare = sql => {
    if (!fired && /json_patch/.test(sql)) {
      fired = true;
      db.prepare(`UPDATE player SET codex = json_set(codex, '$.ms.enemy_jackal', 99) WHERE account_id=1`).run();
    }
    return real(sql);
  };
  await insertPart(env.DB, 1, rollPart(30, rnd, 'p2', 'C', 'FRAME'), T0, 0).run();   // 받을 것 하나 만든다
  const r = await codexRun(env, 1, T0 + 7100, { action: 'claim' });
  env.DB.prepare = real;
  ok(!r.ok && r.status === 409, '읽은 뒤 도감이 바뀌면 409 — 보상이 두 번 나갈 틈이 없다');
  const r2 = await codexRun(env, 1, T0 + 7200, { action: 'claim' });
  ok(r2.ok, '다시 누르면 받는다');
}
{
  /* 오래 한 계정 — 한 번에 100칸이 넘어도 받는다 (D1 바인딩 한도 100) */
  let k = 0;
  for (const key of PART_KEYS) {
    const [base, rar] = key.split(':');
    const p = rollPart(30, rnd, 'm' + (k++), rar, PART_BASES[base].slot);
    if (p.base !== base) { p.base = base; p.slot = PART_BASES[base].slot; }
    await insertPart(env.DB, 1, p, T0, 0).run();
  }
  const { ROBOT_TYPES } = await import('../data/balance.js');
  let rid = 10;
  for (const type of Object.keys(ROBOT_TYPES))
    db.prepare(`INSERT INTO robot (id, account_id, type, level, uid, created_at) VALUES (?, 1, ?, 1, ?, ?)`).run(rid++, type, 'rx' + rid, T0);
  const r = await codexRun(env, 1, T0 + 8000, { action: 'claim' });
  ok(r.ok && r.claimed.length > 100, `한 번에 ${r.ok ? r.claimed.length : r.error}건 — 바인딩 한도에 안 걸린다`);
  const v = await codexGet(env, 1);
  ok(Object.keys(v.codex.c).length > 100, `받은 표시 ${Object.keys(v.codex.c).length}개가 남았다`);
}

console.log('\n== ④ 칭호 ==');
{
  const locked = await codexRun(env, 1, T0 + 9000, { action: 'title', id: 'legend' });
  ok(!locked.ok && locked.error === 'title locked', '못 연 칭호는 거절');
  const unknown = await codexRun(env, 1, T0 + 9001, { action: 'title', id: 'nope' });
  ok(!unknown.ok && unknown.error === 'unknown title', '없는 칭호는 거절');
  const r = await codexRun(env, 1, T0 + 9002, { action: 'title', id: 'forgemaster' });
  ok(r.ok && r.title === 'forgemaster', '파츠 84칸을 채웠으니 「공방장」 을 단다');
  const rk = await ranking(env, 1);
  ok(rk.ok && rk.top.find(t => t.me)?.title === 'forgemaster' && rk.me.title === 'forgemaster', '순위표에 칭호가 뜬다');
  const off = await codexRun(env, 1, T0 + 9003, { action: 'title', id: null });
  ok(off.ok && off.title === null && cx().t === null, '뗄 수 있다');
}

console.log('\n== ⑤ /api/state 가 도감을 내린다 ==');
{
  const s = await loadState(env, 1);
  ok(s && s.codex && s.codex.r && s.codex.r.azure === 1 && Object.keys(s.codex.c).length > 100, 'state.codex');
}

console.log(bad ? `\n✗ ${bad}건 실패` : '\n전부 통과');
process.exitCode = bad ? 1 : 0;
