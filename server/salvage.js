/* 조각 회수 작전 — 서버 판정. (2026-09-25 사용자 지시 · 이관 023)
 *
 *   GET  /api/salvage                      오늘 남은 횟수 · 난이도별 상대 · 개발 목표와 모인 조각
 *   POST /api/salvage { tier, uid? }       한 판. uid 가 없으면 고른 기체(sel_robot)
 *
 * 규칙은 js/salvage.js. 여기서는 행을 읽고 쓰는 일만 한다. 시드는 서버가 굴리고 결과에 실어 보낸다 —
 * 화면은 같은 함수 · 같은 시드로 재생만 한다(시련과 같은 방식).
 * 조각은 **C ~ R 기체만** 받는다(사용자 결정) — 개발 목표가 C ~ R 이면 목표로, 아니면 열 수 있는 C ~ R 중 가장 높은 등급(js/salvage.js salvTarget).
 * 받을 기체가 없으면(C ~ R 을 다 가졌다) 싸우지 않는다. 목표(m_goal)는 건드리지 않는다.
 * 쓰는 문장은 횟수 칸(salv)과 보관함(items)이 읽을 때 그대로일 것을 조건으로 건다 — 두 번 눌러도 한 판만 된다.
 */
import { parseCircuit } from '../js/circuit.js';
import { computeStats } from '../js/stats.js';
import { shardKey, parseItems, shardNeed } from '../js/shop.js';
import { salvView, salvLeft, salvNext, salvFoe, runSalvage, dayOf, salvTarget } from '../js/salvage.js';
import { PART_COLS, partOf } from './parts.js';
import { codexMonsterStmt } from './codex.js';

const err = (status, error, extra) => ({ ok: false, status, error, ...(extra || {}) });
const SLOT_COL = { WEAPON: 's_weapon', FRAME: 's_frame', BOOSTER: 's_booster', CORE: 's_core' };

async function load(env, acc) {
  const p = await env.DB.prepare('SELECT sel_robot, items, m_goal, salv FROM player WHERE account_id = ?1').bind(acc).first();
  if (!p) return null;
  const robots = (await env.DB.prepare(
    `SELECT id, uid, type, level, fat, skill_lv, circuit, ${Object.values(SLOT_COL).join(', ')} FROM robot WHERE account_id = ?1 ORDER BY id`)
    .bind(acc).all()).results || [];
  const owned = robots.map(r => r.type);
  return { p, robots, owned, goal: salvTarget(p.m_goal, owned) };
}

function goalView(L, items) {
  return L.goal ? { type: L.goal, have: (items[shardKey(L.goal)] | 0), need: shardNeed(L.goal) } : null;
}

export async function salvageView(env, acc, now) {
  const L = await load(env, acc);
  if (!L) return err(404, 'no player');
  const sel = L.robots.find(r => r.id === L.p.sel_robot) || L.robots[0];
  return { ok: true, server_now: now, ...salvView(L.p.salv, now, sel ? sel.level : 1),
           goal: goalView(L, parseItems(L.p.items)) };
}

export async function salvageRun(env, acc, now, body) {
  const tier = Number(body && body.tier);
  const L = await load(env, acc);
  if (!L) return err(404, 'no player');
  if (!Number.isInteger(tier)) return err(400, 'bad tier');
  if (salvLeft(L.p.salv, now) <= 0) return err(400, 'no tries left', { endsAt: (dayOf(now) + 1) * 86400000 });
  if (!L.goal) return err(400, 'no goal');
  const uid = body && body.uid != null ? String(body.uid) : null;
  const row = uid ? L.robots.find(r => r.uid === uid) : (L.robots.find(r => r.id === L.p.sel_robot) || L.robots[0]);
  if (!row) return err(404, 'robot not found');
  const foe = salvFoe(dayOf(now), tier, row.level);
  if (!foe) return err(400, 'bad tier');

  const ids = Object.values(SLOT_COL).map(c => row[c]).filter(Boolean);
  const parts = ids.length ? ((await env.DB.prepare(
    `SELECT ${PART_COLS} FROM part WHERE account_id = ?1 AND id IN (${ids.map((_, i) => '?' + (i + 2)).join(',')})`)
    .bind(acc, ...ids).all()).results || []) : [];
  const byId = new Map(parts.map(x => [x.id, x]));
  const slots = {};
  for (const sl in SLOT_COL) { const q = byId.get(row[SLOT_COL[sl]]); slots[sl] = q ? q.uid : null; }
  const robot = { uid: row.uid, type: row.type, level: row.level, fat: row.fat, skillLv: row.skill_lv, slots, circuit: parseCircuit(row.circuit) };
  const used = parts.map(partOf);
  const stats = computeStats(robot, used);
  const seed = crypto.getRandomValues(new Uint32Array(1))[0] >>> 0;
  const out = runSalvage(stats, foe, seed);

  const items = parseItems(L.p.items);
  const got = out.win ? foe.shard : 0;
  if (got) items[shardKey(L.goal)] = (items[shardKey(L.goal)] | 0) + got;
  const res = await env.DB.prepare(
    `UPDATE player SET salv = ?4, items = ?5, rev = rev + 1, updated_at = ?6
      WHERE account_id = ?1 AND salv IS ?2 AND items IS ?3`)
    .bind(acc, L.p.salv, L.p.items, salvNext(L.p.salv, now), JSON.stringify(items), now).run();
  if ((res.meta?.changes ?? 0) !== 1) return err(409, 'state changed, retry');
  /* 도감 — 만났고, 이겼으면 처치 */
  const cs = codexMonsterStmt(env.DB, acc, [{ type: foe.type, win: out.win }]);
  if (cs) await cs.run();

  const nextSalv = salvNext(L.p.salv, now);
  return { ok: true, win: out.win, got, tier, foe: { ...foe, stats: out.foe }, seed,
           robot, parts: used, stats, left: salvLeft(nextSalv, now),
           goal: goalView(L, items) };
}
