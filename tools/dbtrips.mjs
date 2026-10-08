/* DB 왕복 횟수 측정 — 실제 워커(server/worker.js)를 메모리 SQLite 위에서 돌려 API 마다 D1 을 몇 번 오가는지 센다. (2026-10-08)
 *
 * 운영에서는 Worker 가 LAX, D1 이 APAC 에 있어 **한 번 오갈 때마다 ~115ms** 가 든다(STATUS 2026-09-25 (7)).
 * 그래서 응답 속도는 거의 '왕복 횟수 × 115ms' 다. prepare().first/all/run 하나 = 1회, batch([...]) 하나 = 1회.
 *
 *   node --no-warnings tools/dbtrips.mjs          표
 *   node --no-warnings tools/dbtrips.mjs --json   기계용 */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import worker from '../server/worker.js';

const db = new DatabaseSync(':memory:');
db.exec(readFileSync(new URL('../server/schema.sql', import.meta.url), 'utf8'));
let trips = 0, stmts = 0;
const stmt = (sql, args = []) => ({
  bind: (...x) => stmt(sql, x),
  _run: () => { const r = db.prepare(sql).run(...args); return { meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) }, results: [] }; },
  _all: () => ({ results: db.prepare(sql).all(...args) }),
  first: async (col) => { trips++; stmts++; const r = db.prepare(sql).get(...args) ?? null; return col && r ? r[col] : r; },
  all: async () => { trips++; stmts++; return { results: db.prepare(sql).all(...args) }; },
  run: async () => { trips++; stmts++; const r = db.prepare(sql).run(...args); return { meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }; },
});
/* D1 batch — 한 번 오가며 문장을 차례로 돌린다(트랜잭션). 읽기 문장은 results 를 돌려준다 */
const batch = async list => {
  trips++; const out = [];
  db.exec('BEGIN');
  try {
    for (const s of list) { stmts++; const isRead = /^\s*(SELECT|WITH)/i.test(s._sql()); out.push(isRead ? s._all() : s._run()); }
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  return out;
};
const mk = (sql, args = []) => { const s = stmt(sql, args); s._sql = () => sql; s.bind = (...x) => mk(sql, x); return s; };
const env = { DB: { prepare: sql => mk(sql), batch } };

const call = async (method, path, body, token) => {
  const h = { 'content-type': 'application/json' }; if (token) h.authorization = 'Bearer ' + token;
  const req = new Request('https://x.test/api' + path, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
  const t0 = trips, s0 = stmts, pend = [];
  const res = await worker.fetch(req, env, { waitUntil: p => pend.push(p) });   // 응답 뒤로 미룬 일은 사용자가 기다리지 않는다 — 따로 센다
  const j = await res.json().catch(() => ({}));
  const userTrips = trips - t0, userStmts = stmts - s0;
  await Promise.all(pend);
  return { status: res.status, j, trips: userTrips, stmts: userStmts, later: trips - t0 - userTrips };
};

const rows = [];
const run = async (name, method, path, body, token) => { const r = await call(method, path, body, token); rows.push({ name, ...r }); return r; };

const g = await call('POST', '/auth/guest', { device_key: 'a'.repeat(32) });
const tok = g.j.token;
if (!tok) { console.error('게스트 로그인 실패', g); process.exit(1); }
/* 기체 · 파츠가 있는 계정처럼 — 뽑기 몇 번 */
db.prepare('UPDATE player SET cores = 999, credits = 999999, scrap = 99999 WHERE account_id = ?').run(g.j.account_id);
await run('뽑기 10연', 'POST', '/pull', { count: 10, cur: 'core' }, tok);
await run('상태 읽기', 'GET', '/state', null, tok);
const f = await run('대전 상대 찾기', 'POST', '/battle/find', {}, tok);
await run('대전 시작', 'POST', '/battle/start', { tactic: 'none' }, tok);
await run('상태 읽기(대전 뒤)', 'GET', '/state', null, tok);
const st = (await call('GET', '/state', null, tok)).j;
const uid = st.state && st.state.robots[0] && st.state.robots[0].uid;
await run('기체 레벨업', 'POST', '/hangar', { action: 'levelup', robotUid: uid }, tok);
await run('상점 보기', 'GET', '/shop', null, tok);
await run('전선 보기', 'GET', '/front', null, tok);
await run('도감 보기', 'GET', '/codex', null, tok);
await run('순위 보기', 'GET', '/ranking', null, tok);
await run('조각 회수 보기', 'GET', '/salvage', null, tok);
await run('시련 보기', 'GET', '/trial', null, tok);
await run('레이드 보기', 'GET', '/raid', null, tok);
await run('점령 지도', 'POST', '/territory', { action: 'view' }, tok);
await run('내 정보', 'GET', '/me', null, tok);

if (process.argv.includes('--json')) { console.log(JSON.stringify(rows.map(({ name, status, trips, stmts, later }) => ({ name, status, trips, stmts, later })))); process.exit(0); }
console.log('API                     상태  왕복  문장   (운영 추정: 왕복 × 115ms) · 응답 뒤');
for (const r of rows) console.log(`${r.name.padEnd(22)} ${String(r.status).padStart(4)}  ${String(r.trips).padStart(4)}  ${String(r.stmts).padStart(4)}   ~${r.trips * 115}ms${r.later ? ' · +' + r.later : ''}`);
const bad = rows.filter(r => r.status >= 500);
if (bad.length) { console.log('\n오류:', bad.map(b => b.name + ' ' + JSON.stringify(b.j).slice(0, 120))); process.exitCode = 1; }
