/* 정제 코어 · 코어 서킷 — 서버 판정. (2026-09-25 사용자 지시 · 이관 023)
 *
 *   POST /api/refine   { n }                        코어 CONST.REFINE.need(10) × n 개 → 정제 코어 n 개
 *   POST /api/circuit  { action: 'take',  uid, stars: ['A1', …] }   별을 찍는다(값 없음 · 포인트만)
 *                      { action: 'reset', uid }                     서킷을 비운다 — 정제 코어 circuitResetCost()(1) 개
 *
 * 정제 코어는 **지금은 합치기 말고 얻을 길이 없다.** 쓰는 곳은 정제 코어 뽑기(server/pull.js 'rcore')와 서킷 비우기.
 * 규칙(찍는 순서 · 포인트)은 js/circuit.js 를 서버와 화면이 같이 쓴다. 서킷은 **전투에 아직 안 붙었다**(STATUS 할 일 3번).
 * 쓰는 문장은 모두 '읽을 때의 값 그대로' 를 조건으로 건다 — 두 번 눌러도 두 번 치르지 않는다.
 */
import { CONST, ROBOT_TYPES } from '../data/balance.js';
import { traitPoints } from '../js/stats.js';
import { parseCircuit, circuitKey, checkTaken, circuitResetCost } from '../js/circuit.js';

const err = (status, error, extra) => ({ ok: false, status, error, ...(extra || {}) });
const NEED = () => (CONST.REFINE || {}).need || 10;
const MAX_N = 999;

export async function refineRun(env, acc, now, body) {
  const n = Math.round(Number(body && body.n));
  if (!Number.isFinite(n) || n < 1 || n > MAX_N) return err(400, 'bad n');
  const cost = n * NEED();
  const r = await env.DB.prepare(
    `UPDATE player SET cores = cores - ?2, rcores = rcores + ?3, rev = rev + 1, updated_at = ?4
      WHERE account_id = ?1 AND cores >= ?2`).bind(acc, cost, n, now).run();
  const p = await env.DB.prepare('SELECT cores, rcores, rev FROM player WHERE account_id = ?1').bind(acc).first();
  if (!p) return err(404, 'no player');
  if ((r.meta?.changes ?? 0) !== 1) return err(400, 'not enough cores', { need: cost, cores: p.cores, rcores: p.rcores });
  return { ok: true, made: n, spent: cost, cores: p.cores, rcores: p.rcores, rev: p.rev };
}

/* 기체 한 기의 서킷 — 화면이 그대로 그린다 */
function view(row, rcores) {
  const taken = parseCircuit(row.circuit), points = traitPoints(row.level);
  return { uid: row.uid, type: row.type, level: row.level, points, taken, left: Math.max(0, points - taken.length),
           resetCost: circuitResetCost(), rcores };
}

export async function circuitRun(env, acc, now, body) {
  const a = body && body.action, uid = String((body && body.uid) || '');
  const row = await env.DB.prepare('SELECT id, uid, type, level, circuit FROM robot WHERE account_id = ?1 AND uid = ?2')
    .bind(acc, uid).first();
  if (!row || !ROBOT_TYPES[row.type]) return err(404, 'robot not found');
  const p = await env.DB.prepare('SELECT rcores FROM player WHERE account_id = ?1').bind(acc).first();
  if (!p) return err(404, 'no player');
  const cur = parseCircuit(row.circuit);

  if (a === 'take') {
    const add = Array.isArray(body.stars) ? body.stars.map(String) : [];
    if (!add.length || add.length > 40) return err(400, 'no stars');
    const next = [...new Set([...cur, ...add])];
    if (next.length === cur.length) return err(400, 'already taken');
    const why = checkTaken(row.type, next, traitPoints(row.level));
    if (why) return err(400, 'bad stars', { why });
    const res = await env.DB.prepare('UPDATE robot SET circuit = ?3 WHERE id = ?1 AND circuit IS ?2')
      .bind(row.id, row.circuit, circuitKey(next)).run();
    if ((res.meta?.changes ?? 0) !== 1) return err(409, 'circuit changed, retry');
    return { ok: true, ...view({ ...row, circuit: circuitKey(next) }, p.rcores) };
  }

  if (a === 'reset') {
    if (!cur.length) return err(400, 'nothing to reset');
    const cost = circuitResetCost();
    if (p.rcores < cost) return err(400, 'not enough rcores', { need: cost, rcores: p.rcores });
    /* 한 묶음(한 트랜잭션)으로 — 서킷을 비우는 문장이 **잔액까지** 조건으로 보고,
       값을 치르는 문장은 바로 앞 문장이 한 행을 바꿨을 때만(changes() = 1) 치른다.
       그래서 '비웠는데 안 치름' · '치렀는데 안 비움' 이 둘 다 없다. 두 번 눌러도 둘째는 서킷이 이미 달라 0 행이다 */
    const out = await env.DB.batch([
      env.DB.prepare(`UPDATE robot SET circuit = NULL WHERE id = ?1 AND circuit IS ?2
                        AND (SELECT rcores FROM player WHERE account_id = ?3) >= ?4`).bind(row.id, row.circuit, acc, cost),
      env.DB.prepare(`UPDATE player SET rcores = rcores - ?2, rev = rev + 1, updated_at = ?3
                       WHERE account_id = ?1 AND rcores >= ?2 AND changes() = 1`).bind(acc, cost, now),
    ]);
    if (((out && out[1] && out[1].meta && out[1].meta.changes) ?? 0) !== 1) return err(409, 'circuit changed, retry');
    return { ok: true, spent: cost, ...view({ ...row, circuit: null }, p.rcores - cost) };
  }

  return err(400, 'unknown action');
}
