/* 파츠 귀속 자가 점검 — **진짜 SQLite 위에서** 격납고 서버 경로를 돌린다. (2026-09-28)
 *
 *   ⓪ 꺼짐 — 스위치가 꺼져 있으면 예전과 똑같다(귀속을 적지 않는다 · 다른 기체로 옮겨 낀다 · 계정 프리셋)
 *   ① 처음 끼면 귀속 · 다른 기체는 못 낀다 · 떼었다 다시 끼는 것은 된다
 *   ② 귀속 풀기 — 정제 코어가 모자라면 막는다 · 치르면 풀리고 다른 기체가 끼면 그쪽에 귀속
 *   ③ 프리셋은 기체마다 — 다른 기체에 귀속된 칸은 건너뛴다 · 계정 프리셋과 섞이지 않는다
 *   ④ 합성 — 서로 다른 기체 귀속은 막는다 · 같은 기체면 결과가 귀속을 이어받는다 · 모두 풀렸으면 풀린 결과
 *   ⑤ /api/state 가 귀속과 기체마다 프리셋을 내린다
 *   ⑥ 켜는 날 스크립트(tools/bindnow.sql) — 끼고 있는 것만 귀속 · 계정 프리셋은 선봉 기체로
 *
 * node --no-warnings tools/bindcheck.mjs */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { CONST } from '../data/balance.js';
import { hangarAction } from '../server/hangar.js';
import { loadState } from '../server/state.js';
import { insertPart } from '../server/parts.js';
import { rollPart } from '../js/gacha.js';

let bad = 0;
const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) bad++; };

function makeDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../server/schema.sql', import.meta.url), 'utf8'));
  const stmt = (sql, args = []) => ({
    bind: (...a) => stmt(sql, a),
    first: async () => db.prepare(sql).get(...args) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...args) }),
    run: async () => { const r = db.prepare(sql).run(...args); return { meta: { changes: Number(r.changes) } }; },
  });
  /* D1 batch 는 한 트랜잭션이고 문장마다 결과를 돌려준다(changes() 가 바로 앞 문장을 본다) */
  const env = { DB: { prepare: sql => stmt(sql), batch: async list => {
    db.exec('BEGIN'); const out = [];
    try { for (const s of list) out.push(await s.run()); db.exec('COMMIT'); } catch (e) { db.exec('ROLLBACK'); throw e; }
    return out; } } };
  return { db, env };
}
const T0 = 1_760_000_000_000;
let sd = 7; const rnd = () => { sd = (Math.imul(sd, 1664525) + 1013904223) >>> 0; return sd / 4294967296; };

function world() {
  const w = makeDb(), { db, env } = w;
  db.prepare('INSERT INTO account (id, device_key, created_at, last_seen) VALUES (1, ?, ?, ?)').run('dev-1', T0, T0);
  db.prepare('INSERT INTO player (account_id, nickname, updated_at, scrap, rcores) VALUES (1, ?, ?, 5000, 0)').run('P1', T0);
  db.prepare(`INSERT INTO robot (id, account_id, type, level, uid, created_at) VALUES (1, 1, 'azure', 20, 'rA', ?)`).run(T0);
  db.prepare(`INSERT INTO robot (id, account_id, type, level, uid, created_at) VALUES (2, 1, 'grit', 20, 'rB', ?)`).run(T0);
  db.prepare('UPDATE player SET sel_robot = 1 WHERE account_id = 1').run();
  w.mk = async (uid, slot, rar) => { const p = rollPart(20, rnd, uid, rar, slot); await insertPart(env.DB, 1, p, T0, 0).run();
                                     return db.prepare('SELECT id FROM part WHERE uid=?').get(uid).id; };
  w.q = (sql, ...a) => db.prepare(sql).get(...a);
  w.H = body => hangarAction(env, 1, body, T0 + 1000);
  w.bound = uid => w.q('SELECT bound FROM part WHERE uid=?', uid).bound;
  w.slot = (id, c) => w.q(`SELECT ${c} AS v FROM robot WHERE id=?`, id).v;
  return w;
}
const setOn = v => { CONST.PART_BIND.on = v; };

console.log('== ⓪ 스위치가 꺼져 있으면 예전과 같다 ==');
{
  setOn(false);
  const w = world(); const W = await w.mk('pW', 'WEAPON', 'R');
  const a = await w.H({ action: 'equip', robotUid: 'rA', partUid: 'pW', slot: 'WEAPON' });
  ok(a.ok && w.bound('pW') == null, '끼어도 귀속을 적지 않는다');
  const b = await w.H({ action: 'equip', robotUid: 'rB', partUid: 'pW', slot: 'WEAPON' });
  ok(b.ok && w.slot(2, 's_weapon') === W && w.slot(1, 's_weapon') == null, '다른 기체가 떼어 간다(예전 규칙)');
  const s = await w.H({ action: 'presetSave', i: 0, robotUid: 'rB', name: 'x' });
  ok(s.ok && w.q('SELECT presets FROM player WHERE account_id=1').presets && w.q('SELECT presets FROM robot WHERE id=2').presets == null, '프리셋은 계정에 적힌다');
  const u = await w.H({ action: 'unbind', partUid: 'pW' });
  ok(!u.ok && u.error === 'bind off', '귀속 풀기는 꺼져 있다');
}

setOn(true);
console.log('\n== ① 처음 끼면 귀속 ==');
const w1 = world();
{
  const W = await w1.mk('pW', 'WEAPON', 'R');
  const a = await w1.H({ action: 'equip', robotUid: 'rA', partUid: 'pW', slot: 'WEAPON' });
  ok(a.ok && w1.bound('pW') === 1 && a.bound === 'rA', `AZURE 에 끼자 귀속 — bound ${w1.bound('pW')}`);
  const b = await w1.H({ action: 'equip', robotUid: 'rB', partUid: 'pW', slot: 'WEAPON' });
  ok(!b.ok && b.error === 'part bound' && b.boundTo === 'rA' && w1.slot(1, 's_weapon') === W, `GRIT 은 못 낀다 — ${b.error} · ${b.boundTo} · AZURE 가 그대로 끼고 있다`);
  await w1.H({ action: 'unequip', robotUid: 'rA', slot: 'WEAPON' });
  ok(w1.bound('pW') === 1, '떼어도 AZURE 것으로 남는다');
  const c = await w1.H({ action: 'equip', robotUid: 'rB', partUid: 'pW', slot: 'WEAPON' });
  ok(!c.ok, '벗겨 둔 뒤에도 GRIT 은 못 낀다');
  const d = await w1.H({ action: 'equip', robotUid: 'rA', partUid: 'pW', slot: 'WEAPON' });
  ok(d.ok && w1.slot(1, 's_weapon') === W, 'AZURE 는 다시 낄 수 있다');
}

console.log('\n== ② 귀속 풀기 — 정제 코어 ==');
{
  const cost = CONST.PART_BIND.unbind;
  const a = await w1.H({ action: 'unbind', partUid: 'pW' });
  ok(!a.ok && a.error === 'not enough rcores' && w1.bound('pW') === 1, `정제 코어 0 — 막힌다(${a.need} 필요) · 귀속 그대로`);
  w1.db.prepare('UPDATE player SET rcores = 3 WHERE account_id = 1').run();
  const b = await w1.H({ action: 'unbind', partUid: 'pW' });
  ok(b.ok && w1.bound('pW') == null && w1.q('SELECT rcores FROM player').rcores === 3 - cost, `치르면 풀린다 — 정제 코어 3 → ${w1.q('SELECT rcores FROM player').rcores}`);
  const b2 = await w1.H({ action: 'unbind', partUid: 'pW' });
  ok(!b2.ok && b2.error === 'not bound' && w1.q('SELECT rcores FROM player').rcores === 3 - cost, '두 번 눌러도 두 번 치르지 않는다');
  const c = await w1.H({ action: 'equip', robotUid: 'rB', partUid: 'pW', slot: 'WEAPON' });
  ok(c.ok && w1.bound('pW') === 2 && w1.slot(1, 's_weapon') == null, '풀린 파츠를 GRIT 이 끼면 AZURE 에서 떼고 GRIT 에 귀속');
}

console.log('\n== ③ 프리셋은 기체마다 ==');
{
  const F = await w1.mk('pF', 'FRAME', 'R');
  await w1.H({ action: 'equip', robotUid: 'rB', partUid: 'pF', slot: 'FRAME' });
  const s = await w1.H({ action: 'presetSave', i: 0, robotUid: 'rB', name: 'GRIT 한 벌' });
  ok(s.ok && s.robotUid === 'rB' && JSON.parse(w1.q('SELECT presets FROM robot WHERE id=2').presets)[0].s.WEAPON === 'pW',
     'GRIT 의 프리셋에 적혔다(기체 칸)');
  ok(w1.q('SELECT presets FROM player WHERE account_id=1').presets == null, '계정 프리셋은 건드리지 않는다');
  /* AZURE 에 같은 한 벌을 적용하려 해도 GRIT 귀속 칸은 건너뛴다 — AZURE 쪽 프리셋에 GRIT 파츠를 억지로 적어 본다 */
  w1.db.prepare('UPDATE robot SET presets = ? WHERE id = 1').run(JSON.stringify([{ n: '훔치기', s: { WEAPON: 'pW', FRAME: 'pF', BOOSTER: null, CORE: null } }]));
  const a = await w1.H({ action: 'presetApply', i: 0, robotUid: 'rA' });
  ok(a.ok && a.bound.length === 2 && w1.slot(2, 's_weapon') != null && w1.slot(1, 's_weapon') == null,
     `다른 기체에 귀속된 칸은 건너뛴다 — 건너뜀 ${a.bound.join(',')} · GRIT 은 그대로 끼고 있다`);
}

console.log('\n== ④ 합성 ==');
{
  const w = world();
  const mk3 = async pre => { const ids = []; for (let k = 0; k < 3; k++) ids.push(await w.mk(pre + k, 'CORE', 'C')); return ids; };
  const A = await mk3('a'), B = await mk3('b'), C = await mk3('c');
  for (const id of A) w.db.prepare('UPDATE part SET bound = 1 WHERE id = ?').run(id);
  w.db.prepare('UPDATE part SET bound = 1 WHERE id = ?').run(B[0]);
  w.db.prepare('UPDATE part SET bound = 2 WHERE id = ?').run(B[1]);
  const x = await w.H({ action: 'fuse', uids: ['b0', 'b1', 'b2'] });
  ok(!x.ok && x.error === 'bound mismatch', '서로 다른 기체에 귀속된 재료는 못 합친다');
  const y = await w.H({ action: 'fuse', uids: ['a0', 'a1', 'a2'] });
  ok(y.ok && w.bound(y.part.uid) === 1, '같은 기체 귀속 재료 → 결과도 그 기체에 귀속(합성으로 풀리지 않는다)');
  const z = await w.H({ action: 'fuse', uids: ['c0', 'c1', 'c2'] });
  ok(z.ok && w.bound(z.part.uid) == null, '모두 풀린 재료 → 풀린 결과');
}

console.log('\n== ⑤ /api/state ==');
{
  const st = await loadState(w1.env, 1);
  ok(st.bind && st.bind.on === true && st.bind.parts.pW === 'rB' && st.bind.parts.pF === 'rB' && st.bind.unbind === CONST.PART_BIND.unbind,
     `bind — ${JSON.stringify(st.bind.parts)} · 풀기 ${st.bind.unbind}`);
  ok(st.bind.presets && st.bind.presets.rB[0] && st.bind.presets.rB[0].n === 'GRIT 한 벌' && st.bind.presets.rA[0].n === '훔치기', '기체마다 프리셋이 내려온다');
  setOn(false);
  const st2 = await loadState(w1.env, 1);
  ok(st2.bind.on === false && !st2.bind.presets, '꺼져 있으면 기체 프리셋을 안 내린다');
  setOn(true);
}

console.log('\n== ⑥ 켜는 날 — tools/bindnow.sql ==');
{
  setOn(false);
  const w = world();
  const W = await w.mk('pW', 'WEAPON', 'R'), F = await w.mk('pF', 'FRAME', 'R'), X = await w.mk('pX', 'CORE', 'C');
  await w.H({ action: 'equip', robotUid: 'rA', partUid: 'pW', slot: 'WEAPON' });
  await w.H({ action: 'equip', robotUid: 'rB', partUid: 'pF', slot: 'FRAME' });
  await w.H({ action: 'presetSave', i: 0, robotUid: 'rA', name: '계정 한 벌' });
  w.db.exec(readFileSync(new URL('./bindnow.sql', import.meta.url), 'utf8'));
  ok(w.bound('pW') === 1 && w.bound('pF') === 2 && w.bound('pX') == null, '끼고 있는 것만 그 기체에 귀속 · 인벤토리 것은 풀린 채');
  const rp = w.q('SELECT presets FROM robot WHERE id = 1').presets;
  ok(rp && JSON.parse(rp)[0].n === '계정 한 벌' && w.q('SELECT presets FROM robot WHERE id = 2').presets == null, '계정 프리셋은 선봉(AZURE)으로 옮겨 적혔다');
  w.db.exec(readFileSync(new URL('./bindnow.sql', import.meta.url), 'utf8'));
  ok(w.bound('pW') === 1 && w.bound('pF') === 2, '두 번 돌려도 같다');
}
setOn(false);

console.log(bad ? `\n✗ ${bad}건 실패` : '\n전부 통과');
if (bad) process.exitCode = 1;
