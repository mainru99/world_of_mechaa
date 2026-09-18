/* 빌드 프리셋 자가 점검 — **진짜 SQLite 위에서** 저장 · 적용 · 삭제를 돌린다.
 *
 *   ① 저장 — 이 기체가 **지금 끼고 있는 것**을 서버가 읽어 적는다 · 이름을 다듬는다
 *   ② 적용 — 다른 기체가 끼고 있던 파츠를 떼어 온다 · 비워 둔 칸은 뗀다
 *   ③ 분해 — 저장 뒤 분해한 파츠는 건너뛰고, **그 칸의 지금 파츠는 벗기지 않는다**
 *   ④ 막기 — 빈 칸 적용 · 칸 번호 밖 · 남의 기체
 *   ⑤ state — /api/state 가 프리셋을 내린다
 *
 * node --no-warnings tools/presetcheck.mjs */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { hangarAction } from '../server/hangar.js';
import { loadState } from '../server/state.js';
import { insertPart } from '../server/parts.js';
import { rollPart } from '../js/gacha.js';
import { PRESET_MAX } from '../js/preset.js';

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
const T0 = 1_760_000_000_000;

for (const id of [1, 2]) {
  db.prepare('INSERT INTO account (id, device_key, created_at, last_seen) VALUES (?, ?, ?, ?)').run(id, 'dev-' + id, T0, T0);
  db.prepare(`INSERT INTO player (account_id, nickname, updated_at) VALUES (?, ?, ?)`).run(id, 'P' + id, T0);
}
db.prepare(`INSERT INTO robot (id, account_id, type, level, uid, created_at) VALUES (1, 1, 'azure', 20, 'rA', ?)`).run(T0);
db.prepare(`INSERT INTO robot (id, account_id, type, level, uid, created_at) VALUES (2, 1, 'grit', 20, 'rB', ?)`).run(T0);
db.prepare(`INSERT INTO robot (id, account_id, type, level, uid, created_at) VALUES (3, 2, 'grit', 20, 'rX', ?)`).run(T0);
let sd = 3; const rnd = () => { sd = (Math.imul(sd, 1664525) + 1013904223) >>> 0; return sd / 4294967296; };
const mk = async (uid, slot, rar) => { const p = rollPart(20, rnd, uid, rar, slot); await insertPart(env.DB, 1, p, T0, 0).run(); return q('SELECT id FROM part WHERE uid=?', uid).id; };
const W = await mk('pW', 'WEAPON', 'SR'), F = await mk('pF', 'FRAME', 'R'), C = await mk('pC', 'CORE', 'C');
const W2 = await mk('pW2', 'WEAPON', 'C');
db.prepare('UPDATE robot SET s_weapon=?, s_frame=?, s_core=? WHERE id=1').run(W, F, C);
db.prepare('UPDATE robot SET s_weapon=? WHERE id=2').run(W2);
const R = id => q('SELECT s_weapon, s_frame, s_booster, s_core FROM robot WHERE id=?', id);
const H = (body, acc = 1) => hangarAction(env, acc, body, T0 + 1000);

console.log('== ① 저장 ==');
{
  const r = await H({ action: 'presetSave', i: 0, robotUid: 'rA', name: '  <b>보스용 한 벌</b>  ' });
  ok(r.ok && r.presets[0].s.WEAPON === 'pW' && r.presets[0].s.FRAME === 'pF' && r.presets[0].s.CORE === 'pC' && r.presets[0].s.BOOSTER === null,
     `AZURE 가 끼고 있는 셋을 적었다 — ${JSON.stringify(r.presets[0].s)}`);
  ok(r.presets[0].n === 'b보스용 한 벌/b', `이름에서 꺾쇠를 걷고 앞뒤 공백을 지웠다 — "${r.presets[0].n}"`);
  ok(r.presets.length === PRESET_MAX, `칸은 ${PRESET_MAX}개`);
  const r2 = await H({ action: 'presetSave', i: 1, robotUid: 'rB', name: '' });
  ok(r2.ok && r2.presets[1].n === '프리셋 2', '이름을 비우면 "프리셋 N"');
}

console.log('\n== ② 적용 — 다른 기체에서 떼어 온다 ==');
{
  const r = await H({ action: 'presetApply', i: 0, robotUid: 'rB' });
  const a = R(1), b = R(2);
  ok(r.ok && b.s_weapon === W && b.s_frame === F && b.s_core === C, 'GRIT 이 세 파츠를 입었다');
  ok(a.s_weapon === null && a.s_frame === null && a.s_core === null, 'AZURE 에서 그 셋이 빠졌다(한 파츠를 두 기체가 못 낀다)');
  ok(q('SELECT COUNT(*) n FROM part WHERE uid=?', 'pW2').n === 1 && b.s_weapon !== W2, 'GRIT 이 끼던 무장(pW2)은 벗겨져 보관함으로');
  ok(b.s_booster === null && (r.emptied || []).includes('BOOSTER'), '프리셋에서 비워 둔 칸(부스터)은 뗀다');
}

console.log('\n== ③ 분해한 파츠는 건너뛴다 ==');
{
  /* 프리셋 0 을 다시 AZURE 에 — 그 전에 무장(pW)을 분해하고 AZURE 에는 pW2 를 끼워 둔다 */
  db.prepare('UPDATE robot SET s_weapon=NULL WHERE s_weapon=?').run(W);
  db.prepare('DELETE FROM part WHERE id=?').run(W);
  db.prepare('UPDATE robot SET s_weapon=? WHERE id=1').run(W2);
  const r = await H({ action: 'presetApply', i: 0, robotUid: 'rA' });
  const a = R(1);
  ok(r.ok && (r.missing || []).includes('WEAPON'), '무장은 분해되어 missing 으로 돌아온다');
  ok(a.s_weapon === W2, '**지금 끼고 있던 무장(pW2)을 벗기지 않는다** — 적용 한 번에 맨몸이 되지 않게');
  ok(a.s_frame === F && a.s_core === C, '나머지 칸은 적용된다');
}

console.log('\n== ④ 막기 ==');
{
  const e = await H({ action: 'presetApply', i: 3, robotUid: 'rA' });
  ok(!e.ok && e.error === 'empty preset', '빈 칸은 적용할 수 없다');
  const b = await H({ action: 'presetSave', i: PRESET_MAX, robotUid: 'rA' });
  ok(!b.ok && b.error === 'bad preset slot', '칸 번호 밖은 거절');
  const o = await H({ action: 'presetApply', i: 0, robotUid: 'rX' });
  ok(!o.ok && o.error === 'robot not found', '남의 기체에는 못 입힌다');
  const d = await H({ action: 'presetDelete', i: 1 });
  ok(d.ok && d.presets[1] === null, '삭제');
}

console.log('\n== ⑤ state ==');
{
  const s = await loadState(env, 1);
  ok(s && Array.isArray(s.presets) && s.presets[0] && s.presets[0].s.FRAME === 'pF' && s.presets[1] === null, 'state.presets');
}

console.log(bad ? `\n✗ ${bad}건 실패` : '\n전부 통과');
process.exitCode = bad ? 1 : 0;
