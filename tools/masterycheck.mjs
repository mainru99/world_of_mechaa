/* 숙련 조각 자가 점검 — 순수 규칙 + **진짜 SQLite 위에서** 서버 정산(022).
 *
 *   ① 쌓이는 양 — 5레벨마다 1 · 만렙에 2 더 = Lv.60 에 14. 내려가지 않는다
 *   ② 목표 — 계보가 열어 준 것 · 아직 없는 것만. 없으면 autoGoal 이 고른다
 *   ③ 정산 — 레벨이 오른 만큼만 주고, 두 번 부르면 두 번 주지 않는다
 *   ④ 서버 — /api/state 가 정산하고 DB 에 적는다(items · m_goal · m_lv)
 *   ⑤ 소급 없음 — 이관 022 를 거친 행(m_lv = 지금 레벨)은 과거 레벨로 조각을 주지 않는다
 *   ⑥ 목표 바꾸기 — /api/shop { action:'goal' } · 이미 받은 조각은 그 기체에 남는다
 *   ⑦ 조립 — 모인 조각으로 목표 기체를 만든다(계보 문이 꺼져 있어도 조각 수는 맞아야 한다)
 *
 * node --no-warnings tools/masterycheck.mjs */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { CONST, ROBOT_TYPES } from '../data/balance.js';
import { shardsAt, shardGain, goalOk, autoGoal, settleMastery } from '../js/mastery.js';
import { shardKey, shardNeed } from '../js/shop.js';
import { canDevelop } from '../js/lineage.js';
import { loadState } from '../server/state.js';
import { shopRun } from '../server/shop.js';

let bad = 0;
const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) bad++; };

const db = new DatabaseSync(':memory:');
db.exec(readFileSync(new URL('../server/schema.sql', import.meta.url), 'utf8'));
const stmt = (sql, args = []) => ({
  sql, args,
  bind: (...a) => stmt(sql, a),
  first: async () => db.prepare(sql).get(...args) ?? null,
  all: async () => ({ results: db.prepare(sql).all(...args) }),
  run: async () => { const r = db.prepare(sql).run(...args); return { meta: { changes: Number(r.changes) } }; },
});
const env = { DB: { prepare: sql => stmt(sql), batch: async list => { for (const s of list) await s.run(); return []; } } };
const q = (sql, ...a) => db.prepare(sql).get(...a);
const MAX = CONST.MAXLV || 60;
const T0 = 1758600000000;

console.log('== ① 쌓이는 양 ==');
{
  ok(shardsAt(1) === 0 && shardsAt(4) === 0, 'Lv.4 까지는 0');
  ok(shardsAt(5) === 1 && shardsAt(10) === 2 && shardsAt(30) === 6, 'Lv.5 · 10 · 30 → 1 · 2 · 6');
  ok(shardsAt(MAX) === 14, `만렙에 14 (지금 ${shardsAt(MAX)})`);
  ok(shardsAt(MAX + 50) === shardsAt(MAX), '만렙을 넘겨도 더 주지 않는다');
  let down = false;
  for (let l = 1; l < MAX; l++) if (shardsAt(l + 1) < shardsAt(l)) down = true;
  ok(!down, '레벨이 오르면 줄지 않는다');
  ok(shardGain(30, 60) === shardsAt(60) - shardsAt(30) && shardGain(60, 30) === 0, '구간 지급은 차이만큼 · 거꾸로는 0');
}

console.log('\n== ② 목표 고르기 ==');
{
  const owned = ['mule'];
  ok(goalOk('bastion', owned), 'MULE 을 가지면 BASTION 이 목표가 된다');
  ok(!goalOk('mule', owned), '이미 가진 기체는 목표가 아니다');
  ok(!goalOk('atlas', owned), '앞 기체가 모자란 기체는 목표가 아니다');
  const story = Object.keys(ROBOT_TYPES).find(t => ROBOT_TYPES[t].story);
  ok(!goalOk(story, owned), '스토리 기체는 목표가 아니다');
  const g = autoGoal(owned);
  ok(g && canDevelop(g, owned).ok, `목표가 없으면 서버가 고른다 — ${g}`);
  ok(autoGoal(owned) === g, '같은 상태면 같은 목표를 고른다');
}

console.log('\n== ③ 정산(순수) ==');
{
  const rb = [{ id: 1, uid: 'a', type: 'mule', level: 10, mLv: 1 }];
  const r1 = settleMastery(rb, ['mule'], {}, 'bastion');
  ok(r1.total === shardsAt(10) - shardsAt(1) && r1.items[shardKey('bastion')] === r1.total,
     `Lv.1 → 10 에 조각 ${r1.total} 개가 목표로 들어간다`);
  const rb2 = [{ id: 1, uid: 'a', type: 'mule', level: 10, mLv: 10 }];
  const r2 = settleMastery(rb2, ['mule'], r1.items, 'bastion');
  ok(r2.total === 0 && r2.items[shardKey('bastion')] === r1.total, '정산한 레벨까지는 다시 주지 않는다');
  const r3 = settleMastery([{ id: 1, uid: 'a', type: 'mule', level: 7, mLv: null }], ['mule'], {}, 'bastion');
  ok(r3.total === shardsAt(7), 'm_lv 가 비었으면 Lv.1 부터 (새로 만든 기체)');
  const r4 = settleMastery([{ id: 1, uid: 'a', type: 'mule', level: 60, mLv: 1 }], ['mule'], {}, null);
  ok(r4.goal && r4.total === 14, '목표를 안 정했어도 서버가 골라 정산한다');
}

console.log('\n== ④ ~ ⑦ 서버 ==');
{
  db.prepare('INSERT INTO account (id, device_key, created_at, last_seen) VALUES (1, ?, ?, ?)').run('dev-1', T0, T0);
  db.prepare(`INSERT INTO player (account_id, nickname, credits, rating, updated_at) VALUES (1, 'TESTER', 999999, 1500, ?)`).run(T0);
  const add = (uid, type, level, mLv) => db.prepare(
    `INSERT INTO robot (account_id, uid, type, level, exp, fat, fat_at, created_at, m_lv)
     VALUES (1,?,?,?,0,0,${T0},${T0},?)`).run(uid, type, level, mLv);
  add('r1', 'mule', 1, 1);
  add('r2', 'dune', 30, 30);          // 이관을 거친 옛 기체 — 소급 없음
  db.prepare('UPDATE player SET sel_robot = (SELECT id FROM robot WHERE uid=?)').run('r1');

  let s = await loadState(env, 1);
  const p1 = q('SELECT items, m_goal FROM player WHERE account_id=1');
  ok(!!p1.m_goal && s.mastery.goal === p1.m_goal, `목표가 정해져 DB 에 적혔다 — ${p1.m_goal}`);
  ok(s.mastery.got === 0 && !Object.keys(JSON.parse(p1.items || '{}')).length,
     '⑤ 소급 없음 — Lv.30 기체가 있어도 첫 정산은 0 (보관함이 비어 있다)');

  db.prepare("UPDATE robot SET level = 12 WHERE uid = 'r1'").run();
  s = await loadState(env, 1);
  const goal = s.mastery.goal, key = shardKey(goal);
  const p2 = q('SELECT items FROM player WHERE account_id=1');
  const want = shardsAt(12) - shardsAt(1);
  ok(s.mastery.got === want && JSON.parse(p2.items)[key] === want, `④ Lv.1 → 12 로 조각 ${want} 개 · DB 에 적혔다`);
  ok(q("SELECT m_lv FROM robot WHERE uid='r1'").m_lv === 12, 'm_lv 가 정산한 레벨로 올라갔다');
  s = await loadState(env, 1);
  ok(s.mastery.got === 0 && JSON.parse(q('SELECT items FROM player WHERE account_id=1').items)[key] === want,
     '다시 읽어도 두 번 주지 않는다');

  /* ⑥ 목표 바꾸기 */
  const owned = ['mule', 'dune'];
  const other = Object.keys(ROBOT_TYPES).find(t => t !== goal && goalOk(t, owned));
  const r = await shopRun(env, 1, T0 + 1000, { action: 'goal', type: other });
  ok(r.ok && q('SELECT m_goal FROM player WHERE account_id=1').m_goal === other, `⑥ 목표를 ${other} 로 바꿨다`);
  const nope = await shopRun(env, 1, T0 + 2000, { action: 'goal', type: 'mule' });
  ok(!nope.ok && nope.error === 'bad goal', '이미 가진 기체로는 못 바꾼다');
  db.prepare("UPDATE robot SET level = 20 WHERE uid = 'r1'").run();
  s = await loadState(env, 1);
  const items = JSON.parse(q('SELECT items FROM player WHERE account_id=1').items);
  ok(items[key] === want && items[shardKey(other)] === shardsAt(20) - shardsAt(12),
     '바꾸기 전 조각은 그대로 남고, 새 조각만 새 목표로 간다');

  /* ⑦ 조립 — 목표 기체의 조각을 채워 만든다 */
  const need = shardNeed(other);
  db.prepare("UPDATE player SET items = ? WHERE account_id=1").run(JSON.stringify({ [shardKey(other)]: need }));
  const asm = await shopRun(env, 1, T0 + 3000, { action: 'assemble', type: other });
  ok(asm.ok && asm.assembled && asm.assembled.type === other, `⑦ 조각 ${need} 개로 ${other} 를 조립했다`);
  ok(!!q('SELECT id FROM robot WHERE type=? AND account_id=1', other), '기체 행이 생겼다');
  const after = await loadState(env, 1);
  ok(after.mastery.goal !== other, '이미 가진 기체는 목표에서 내려가고 다음 목표가 잡힌다');
}

console.log(bad ? `\n${bad} 개 실패` : '\n전부 통과');
process.exit(bad ? 1 : 0);
