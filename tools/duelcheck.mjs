/* 친선 대전 자가 점검 — **진짜 SQLite 위에서** 상대 찾기 · 시작을 돌린다. (2026-10-07)
 *
 *   ① 무작위 — 등록된 다른 플레이어가 잡힌다 · 나는 안 잡힌다 · 응답에 random · target(그 사람 이름)
 *   ② 무작위로 잡은 상대도 친선전이다 — 출격비 · 보상 · 경험치 · 레이팅 · 전적이 안 움직인다
 *   ③ 받아 줄 사람이 없으면 'no opponent'(아레나 상대로 몰래 바꾸지 않는다)
 *   ④ 이름으로 부르기는 예전 그대로
 *
 * node --no-warnings tools/duelcheck.mjs */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { findMatch, startBattle } from '../server/battle.js';
import { registerArena } from '../server/arena.js';

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
const env = { DB: { prepare: sql => stmt(sql), batch: async list => {
  db.exec('BEGIN'); const out = [];
  try { for (const s of list) out.push(await s.run()); db.exec('COMMIT'); } catch (e) { db.exec('ROLLBACK'); throw e; }
  return out; } } };
const q = (sql, ...a) => db.prepare(sql).get(...a);
const T0 = 1_760_000_000_000;

function addPlayer(id, type, level) {
  db.prepare('INSERT INTO account (id, device_key, created_at, last_seen) VALUES (?, ?, ?, ?)').run(id, 'dev-' + id, T0, T0);
  db.prepare('INSERT INTO player (account_id, nickname, credits, updated_at) VALUES (?, ?, 5000, ?)').run(id, 'GUEST-000' + id, T0);
  db.prepare('INSERT INTO robot (id, account_id, type, level, uid, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(id, id, type, level, 'r' + id, T0);
  db.prepare('UPDATE player SET sel_robot = ? WHERE account_id = ?').run(id, id);
}
addPlayer(1, 'azure', 30);

console.log('== ③ 받아 줄 사람이 없으면 ==');
{
  const r = await findMatch(env, 1, T0, { mode: 'duel', random: true });
  ok(!r.ok && r.error === 'no opponent', `등록된 다른 사람이 없다 — ${r.error}`);
  await registerArena(env, 1, T0);
  const r2 = await findMatch(env, 1, T0, { mode: 'duel', random: true });
  ok(!r2.ok && r2.error === 'no opponent', '나만 등록돼 있어도 나를 잡지 않는다');
}

addPlayer(2, 'grit', 30); addPlayer(3, 'ignis', 60);
await registerArena(env, 2, T0); await registerArena(env, 3, T0);

console.log('\n== ① 무작위 ==');
{
  const seen = new Set();
  for (let i = 0; i < 12; i++) {
    const r = await findMatch(env, 1, T0 + i, { mode: 'duel', random: true });
    if (!r.ok) { ok(false, '찾기 실패 ' + r.error); break; }
    seen.add(r.target);
    if (i === 0) ok(r.mode === 'duel' && r.random === true && r.cost === 0 && r.opponent.kind === 'player',
                    `친선 · 무작위 · 출격비 0 · 플레이어 — ${r.target}`);
  }
  ok(!seen.has('GUEST-0001') && seen.size >= 1 && [...seen].every(n => n === 'GUEST-0002' || n === 'GUEST-0003'),
     `잡힌 상대 ${[...seen].join(' · ')} — 나는 없다`);
  /* 전투력이 비슷한 쪽(GRIT Lv.30)이 먼저다 — IGNIS Lv.60 은 ±15% 밖이라 첫 창에서 안 잡힌다 */
  ok(seen.has('GUEST-0002') && !seen.has('GUEST-0003'), '전투력이 비슷한 상대부터 — 먼 상대는 창을 넓혀야 잡힌다');
}

console.log('\n== ② 무작위 친선도 아무것도 안 움직인다 ==');
{
  const before = q('SELECT credits, scrap, cores, wins, losses, rating FROM player WHERE account_id=1');
  const rb0 = q('SELECT level, exp, fat FROM robot WHERE id=1');
  await findMatch(env, 1, T0 + 100, { mode: 'duel', random: true });
  const s = await startBattle(env, 1, T0 + 200, { tactic: 'none' });
  const after = q('SELECT credits, scrap, cores, wins, losses, rating FROM player WHERE account_id=1');
  const rb1 = q('SELECT level, exp, fat FROM robot WHERE id=1');
  ok(s.ok && s.mode === 'duel', `전투가 돈다 — ${s.ok ? (s.win ? '승' : '패') : s.error}`);
  ok(JSON.stringify(before) === JSON.stringify(after) && JSON.stringify(rb0) === JSON.stringify(rb1),
     '크레딧 · 스크랩 · 코어 · 전적 · 레이팅 · 경험치 · 피로도 그대로');
}

console.log('\n== ④ 이름으로 부르기 ==');
{
  const r = await findMatch(env, 1, T0 + 300, { mode: 'duel', target: 'GUEST-0003', pick: 0 });
  ok(r.ok && r.target === 'GUEST-0003' && !r.random, '이름으로 부른 사람이 그대로 잡힌다(전투력 창 없음)');
  const n = await findMatch(env, 1, T0 + 301, { mode: 'duel', target: 'NOBODY' });
  ok(!n.ok && n.error === 'target not found', '없는 이름은 target not found');
  const e = await findMatch(env, 1, T0 + 302, { mode: 'duel' });
  ok(!e.ok && e.error === 'no target', '이름도 무작위도 아니면 no target');
}

console.log(bad ? `\n✗ ${bad}건 실패` : '\n전부 통과');
if (bad) process.exitCode = 1;
