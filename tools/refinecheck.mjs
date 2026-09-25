/* 정제 코어 · 정제 코어 뽑기 · 코어 서킷 비우기 · 조각 회수 작전 자가 점검 — **진짜 SQLite 위에서**. (2026-09-25 · 이관 023)
 *
 *   ① 합치기   — 코어 10 → 정제 1 · 모자라면 거절 · n 이 이상하면 거절
 *   ② 정제 뽑기 — 정제 코어로 치른다(코어는 안 나간다) · 모자라면 거절 · 확률이 코어 뽑기보다 소폭 높다
 *   ③ 서킷     — 안쪽부터 · 포인트까지 · 전문 별 잠김 · 비우기는 정제 코어 1 · 모자라면 안 비운다 · 두 번 동시에 눌러도 한 번만 치른다
 *   ④ 작전     — 하루 2번 · 이기면 개발 목표 조각 · 셋째는 거절 · 다음 날 다시 2번 · 동시에 눌러도 한 판
 *   ⑤ state    — /api/state 가 rcores · salvage · circuit 을 내린다
 *
 * node --no-warnings tools/refinecheck.mjs */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { CONST, PULL_TABLE, PULL_TABLE_RC, ROBOT_RARITY, ROBOT_RARITY_RC } from '../data/balance.js';
import { refineRun, circuitRun } from '../server/refine.js';
import { salvageView, salvageRun } from '../server/salvage.js';
import { serverPull } from '../server/pull.js';
import { loadState } from '../server/state.js';
import { traitPoints } from '../js/stats.js';
import { constellation } from '../js/circuit.js';
import { rollPull, PULL_CUR } from '../js/gacha.js';
import { mulberry32 } from '../js/sim.js';

let bad = 0;
const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) bad++; };

const db = new DatabaseSync(':memory:');
db.exec(readFileSync(new URL('../server/schema.sql', import.meta.url), 'utf8'));
const stmt = (sql, args = []) => ({
  bind: (...a) => stmt(sql, a),
  first: async () => db.prepare(sql).get(...args) ?? null,
  all: async () => ({ results: db.prepare(sql).all(...args) }),
  run: async () => { const r = db.prepare(sql).run(...args); return { meta: { changes: Number(r.changes) } }; },
  runSync: () => { const r = db.prepare(sql).run(...args); return { meta: { changes: Number(r.changes) } }; },
});
/* D1 의 batch 처럼 한 트랜잭션으로, 문장마다 결과를 돌려준다 */
const env = { DB: { prepare: sql => stmt(sql), batch: async list => {
  db.exec('BEGIN');
  try { const out = list.map(s => s.runSync()); db.exec('COMMIT'); return out; }
  catch (e) { db.exec('ROLLBACK'); throw e; } } } };
const q = (sql, ...a) => db.prepare(sql).get(...a);
const P = () => q('SELECT credits, cores, rcores, scrap, items, salv, m_goal FROM player WHERE account_id=1');

const T0 = Date.UTC(2026, 8, 25, 3, 0, 0);
db.prepare('INSERT INTO account (id, device_key, created_at, last_seen) VALUES (1, ?, ?, ?)').run('dev-1', T0, T0);
db.prepare(`INSERT INTO player (account_id, nickname, credits, cores, scrap, updated_at) VALUES (1, 'TESTER', 1000, 25, 0, ?)`).run(T0);
db.prepare(`INSERT INTO robot (id, account_id, type, level, uid, created_at) VALUES (1, 1, 'grit', 30, 'r1', ?)`).run(T0);
db.prepare('UPDATE player SET sel_robot = 1 WHERE account_id = 1').run();

console.log('== 이관 ==');
ok(q("SELECT v FROM meta WHERE k='schema_version'").v === '23', 'schema_version 23');
ok(P().rcores === 0 && P().salv === null, '새 칸 — rcores 0 · salv NULL');

console.log('== ① 합치기 ==');
{
  const r = await refineRun(env, 1, T0, { n: 2 });
  ok(r.ok && r.cores === 5 && r.rcores === 2 && r.spent === 20, `코어 25 → 정제 2 · 코어 5 (${r.cores}/${r.rcores})`);
  const r2 = await refineRun(env, 1, T0, { n: 1 });
  ok(!r2.ok && r2.error === 'not enough cores' && P().cores === 5 && P().rcores === 2, '코어 5 로는 거절 · 그대로');
  for (const n of [0, -1, 1.2e9, 'x', null]) { const r3 = await refineRun(env, 1, T0, { n }); ok(!r3.ok && r3.error === 'bad n', `n=${n} 거절`); }
}

console.log('== ② 정제 뽑기 ==');
{
  const before = P();
  const r = await serverPull(env, 1, 2, T0, 'rcore');
  ok(r.ok && r.cur === 'rcore' && r.spent === 2 && r.results.length === 2, '정제 코어 2 로 2회');
  const after = P();
  const coreGain = r.results.reduce((s, x) => s + (x.kind === 'core' ? x.n : 0) + (x.kind === 'dupe' ? x.gain.co : 0), 0);
  ok(after.rcores === 0 && after.cores === before.cores + coreGain, `정제 코어만 나갔다(코어 ${before.cores} → ${after.cores}, 결과로 +${coreGain})`);
  const r2 = await serverPull(env, 1, 1, T0 + 1, 'rcore');
  ok(!r2.ok && r2.error === 'not enough rcores' && r2.rcores === 0, '정제 코어 0 이면 거절');
  const r3 = await serverPull(env, 1, 1, T0 + 2, 'toString');
  ok(r3.ok ? r3.cur === 'core' : r3.error === 'not enough cores', "모르는 창구('toString')는 코어로 떨어진다");
  /* 확률 — 같은 난수로 10만 번씩 굴려 코어 창구와 견준다 */
  const roll = (cur, n) => { const rnd = mulberry32(7), c = { robot: 0, EP: 0, UQ: 0, bust: 0 };
    for (let i = 0; i < n; i++) { const x = rollPull(new Set(), 30, rnd, () => 'u', cur);
      if (x.kind === 'robot') { c.robot++; const R = x.type && (x.rar || null); }
      if (x.kind === 'bust') c.bust++; }
    return c; };
  const N = 100000, a = roll('core', N), b = roll('rcore', N);
  const w = (t, k) => t.find(x => x.k === k).w / t.reduce((s, x) => s + x.w, 0);
  ok(Math.abs(a.robot / N - w(PULL_TABLE, 'robot')) < 0.005 && Math.abs(b.robot / N - w(PULL_TABLE_RC, 'robot')) < 0.005,
     `기체 확률 — 코어 ${(100 * a.robot / N).toFixed(1)}% · 정제 ${(100 * b.robot / N).toFixed(1)}%`);
  const hi = t => w(t, 'UQ') + w(t, 'EP');
  ok(w(PULL_TABLE_RC, 'robot') > w(PULL_TABLE, 'robot') && w(PULL_TABLE_RC, 'robot') - w(PULL_TABLE, 'robot') <= 0.05,
     '기체 칸은 코어보다 높되 5%p 이내(소폭)');
  ok(hi(ROBOT_RARITY_RC) > hi(ROBOT_RARITY) && hi(ROBOT_RARITY_RC) - hi(ROBOT_RARITY) <= 0.05,
     `유니크 · 에픽 몫 ${(100 * hi(ROBOT_RARITY)).toFixed(1)}% → ${(100 * hi(ROBOT_RARITY_RC)).toFixed(1)}%(소폭)`);
  ok(w(PULL_TABLE_RC, 'bust') < w(PULL_TABLE, 'bust'), '꽝은 코어보다 적다');
  ok(PULL_CUR.rcore.cost === CONST.REFINE.pull, '1회 값 = CONST.REFINE.pull');
}

console.log('== ③ 서킷 ==');
{
  const pts = traitPoints(30);
  const star = constellation('grit');
  ok(pts > 0, `Lv.30 포인트 ${pts}`);
  let r = await circuitRun(env, 1, T0, { action: 'take', uid: 'r1', stars: ['A1', 'A2'] });
  ok(r.ok && r.taken.join() === 'A1,A2' && r.left === pts - 2, '안쪽부터 A1 · A2');
  r = await circuitRun(env, 1, T0, { action: 'take', uid: 'r1', stars: ['B3'] });
  ok(!r.ok && r.error === 'bad stars', 'B1 없이 B3 은 거절');
  r = await circuitRun(env, 1, T0, { action: 'take', uid: 'r1', stars: ['A*'] });
  ok(!r.ok && r.error === 'bad stars', '전문 별은 잠김');
  r = await circuitRun(env, 1, T0, { action: 'take', uid: 'r1', stars: ['Z9'] });
  ok(!r.ok, '없는 별 거절');
  const many = [];
  for (const b of 'BCD') for (let i = 1; i <= 8; i++) many.push(b + i);
  r = await circuitRun(env, 1, T0, { action: 'take', uid: 'r1', stars: many });
  ok(!r.ok && r.error === 'bad stars' && /포인트/.test(r.why), `포인트(${pts})보다 많이는 거절`);
  r = await circuitRun(env, 1, T0, { action: 'take', uid: 'nope', stars: ['A3'] });
  ok(!r.ok && r.status === 404, '남의 · 없는 기체 거절');
  ok(star.filter(s => s.locked).length === 4, '전문 별 넷');

  ok(P().rcores === 0, '정제 코어 0');
  r = await circuitRun(env, 1, T0, { action: 'reset', uid: 'r1' });
  ok(!r.ok && r.error === 'not enough rcores' && q('SELECT circuit FROM robot WHERE id=1').circuit !== null, '정제 코어 없으면 비우지 않는다');
  db.prepare('UPDATE player SET rcores = 5 WHERE account_id = 1').run();
  const [x, y] = await Promise.all([circuitRun(env, 1, T0, { action: 'reset', uid: 'r1' }),
                                    circuitRun(env, 1, T0, { action: 'reset', uid: 'r1' })]);
  ok([x, y].filter(z => z.ok).length === 1 && P().rcores === 4 && q('SELECT circuit FROM robot WHERE id=1').circuit === null,
     `동시에 두 번 비워도 한 번만 치른다(정제 5 → ${P().rcores})`);
  r = await circuitRun(env, 1, T0, { action: 'reset', uid: 'r1' });
  ok(!r.ok && r.error === 'nothing to reset' && P().rcores === 4, '빈 서킷은 비우지 않는다(값 안 나감)');
  r = await circuitRun(env, 1, T0, { action: 'take', uid: 'r1', stars: ['C1'] });
  ok(r.ok && r.taken.join() === 'C1', '비운 뒤 다시 찍는다');
}

console.log('== ④ 작전 ==');
{
  let v = await salvageView(env, 1, T0);
  ok(v.ok && v.left === 2 && v.daily === 2 && v.tiers.length === 3 && v.goal && v.goal.have === 0, `하루 2번 · 난이도 셋 · 목표 ${v.goal && v.goal.type}`);
  ok(v.tiers.every(t => t.level === 30), '상대 레벨 = 고른 기체 레벨');
  const goal = v.goal.type;
  let r = await salvageRun(env, 1, T0, { tier: 5 });
  ok(!r.ok && r.error === 'bad tier' && P().salv === null, '없는 난이도는 거절 · 횟수 안 씀');
  const [x, y] = await Promise.all([salvageRun(env, 1, T0, { tier: 0 }), salvageRun(env, 1, T0, { tier: 0 })]);
  ok([x, y].filter(z => z.ok).length === 1, '동시에 두 번 눌러도 한 판');
  const one = x.ok ? x : y;
  ok(one.left === 1 && JSON.parse(P().salv).n === 1, '남은 횟수 1');
  const have1 = JSON.parse(P().items || '{}')['shard:' + goal] | 0;
  ok(have1 === (one.win ? CONST.SALVAGE.tiers[0].shard : 0), `${one.win ? '이김' : '짐'} → 목표 조각 ${have1}`);
  ok(P().m_goal === goal, '목표가 박힌다');
  r = await salvageRun(env, 1, T0 + 1000, { tier: 2, uid: 'r1' });
  ok(r.ok && r.left === 0, `둘째 판(강습 · ${r.win ? '이김' : '짐'})`);
  r = await salvageRun(env, 1, T0 + 2000, { tier: 0 });
  ok(!r.ok && r.error === 'no tries left', '셋째 판은 거절');
  v = await salvageView(env, 1, T0 + 86400000);
  ok(v.left === 2, '다음 날(UTC) 다시 2번');
  /* 이긴 판의 조각 — 약한 상대가 나오도록 레벨을 올려 여러 날 돌려 본다 */
  db.prepare('UPDATE robot SET level = 60 WHERE id = 1').run();
  let wins = 0, got = 0;
  for (let d = 2; d < 12; d++) { const z = await salvageRun(env, 1, T0 + d * 86400000, { tier: 0 }); if (z.win) { wins++; got += z.got; } }
  ok(wins > 0 && got === wins * CONST.SALVAGE.tiers[0].shard, `정찰 10판 중 ${wins}승 · 조각 ${got}`);
}

console.log('== ⑤ state ==');
{
  const st = await loadState(env, 1);
  ok(st.rcores === P().rcores, `rcores ${st.rcores}`);
  ok(st.salvage && st.salvage.daily === 2, 'salvage 남은 횟수');
  ok(st.circuit && st.circuit.r1 && st.circuit.r1.join() === 'C1', 'circuit { r1: [C1] }');
  ok(!('rcores' in st.state) && !('circuit' in st.state.robots[0]), 'state(저장본) 모양은 그대로');
}

console.log(bad ? `\n실패 ${bad}` : '\n전부 통과');
process.exitCode = bad ? 1 : 0;
