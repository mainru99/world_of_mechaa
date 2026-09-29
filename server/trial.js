/* 주간 시련 — 서버 판정.
 *
 * 규칙은 js/trial.js 에 있다. 여기서는 **행을 읽고 쓰는 일**만 한다.
 * 클라도 같은 규칙 파일을 import 해서 재생만 하므로, 판정과 재생이 갈릴 수 없다.
 *
 * 왜 점수를 서버가 내는가 — 클라가 점수를 보내면 아무 숫자나 보낼 수 있다.
 * 그래서 서버가 내 기체·파츠를 읽어 직접 돌린다. 시드는 주 번호에서만 나오므로
 * 클라가 고를 여지도 없다.
 *
 * 읽는 행 — player 1 + robot N + part N + trial 1. 아레나 한 판과 비슷하다.
 * 순위표는 상위 10 + 내 1 + 인원 1 이라 인원이 늘어도 그대로다.
 */
import { parseCircuit } from '../js/circuit.js';
import { codexMonsterStmt } from './codex.js';
import { computeStats, power } from '../js/stats.js';
import { weekOf, weekEnd, trialOf, runTrial, trialWon, TRIAL_WIN_BASE } from '../js/trial.js';
import { PART_COLS, partOf } from './parts.js';

const TOP_N = 10;
const err = (status, error) => ({ ok: false, status, error });
const SLOT_COL = { WEAPON: 's_weapon', FRAME: 's_frame', BOOSTER: 's_booster', CORE: 's_core' };

/* 출전 기체 한 기와 그 기체가 낀 파츠만 읽는다.
   battle.js 의 loadFighter 와 같은 규칙(편성 안에서 sel_robot, 없으면 첫 기체)이지만,
   시련은 보상도 레이팅도 없어서 credits·rating 을 안 읽는다. */
async function loadOne(env, acc) {
  const p = await env.DB.prepare(
    'SELECT nickname, sel_robot, squad1, squad2 FROM player WHERE account_id = ?1').bind(acc).first();
  if (!p) return null;
  const robots = (await env.DB.prepare(
    `SELECT id, uid, type, level, fat, skill_lv, circuit, ${Object.values(SLOT_COL).join(', ')}
       FROM robot WHERE account_id = ?1 ORDER BY id`).bind(acc).all()).results || [];
  if (!robots.length) return null;
  const squad = [p.squad1, p.squad2].filter(Boolean);
  const inSquad = id => !squad.length || squad.includes(id);
  const row = robots.find(r => r.id === p.sel_robot && inSquad(r.id))
           || robots.find(r => inSquad(r.id)) || robots[0];

  const parts = (await env.DB.prepare(`SELECT ${PART_COLS} FROM part WHERE account_id = ?1`)
    .bind(acc).all()).results || [];
  const byId = new Map(parts.map(x => [x.id, x]));
  const slots = {}, used = [];
  for (const sl in SLOT_COL) {
    const q = byId.get(row[SLOT_COL[sl]]);
    slots[sl] = q ? q.uid : null;
    if (q) used.push(partOf(q));
  }
  return { nickname: p.nickname,
           robot: { uid: row.uid, type: row.type, level: row.level, fat: row.fat,
                    skillLv: row.skill_lv, slots, circuit: parseCircuit(row.circuit) },
           parts: used };
}

async function board(env, acc, week) {
  const top = (await env.DB.prepare(
    `SELECT account_id, nickname, score, robot_type, power
       FROM trial WHERE week = ?1 ORDER BY score DESC, account_id LIMIT ?2`)
    .bind(week, TOP_N).all()).results || [];
  const me = await env.DB.prepare(
    'SELECT score, robot_type, power, tries FROM trial WHERE week = ?1 AND account_id = ?2')
    .bind(week, acc).first();
  const cnt = await env.DB.prepare('SELECT COUNT(*) AS n FROM trial WHERE week = ?1').bind(week).first();
  /* 내 순위 — 나보다 점수가 높은 사람 수 + 1. 아직 기록이 없으면 순위도 없다. */
  let rank = null;
  if (me) {
    const c = await env.DB.prepare(
      'SELECT COUNT(*) AS n FROM trial WHERE week = ?1 AND (score > ?2 OR (score = ?2 AND account_id < ?3))')
      .bind(week, me.score, acc).first();
    rank = (c ? c.n : 0) + 1;
  }
  return {
    top: top.map((r, i) => ({ rank: i + 1, nickname: r.nickname, score: r.score,
                              type: r.robot_type, power: r.power, me: r.account_id === acc })),
    me: me ? { score: me.score, rank, type: me.robot_type, power: me.power, tries: me.tries } : null,
    total: Math.max(cnt ? cnt.n : 0, top.length),
  };
}

export async function trialView(env, acc, now) {
  const week = weekOf(now);
  return { ok: true, week, endsAt: weekEnd(week), winBase: TRIAL_WIN_BASE,
           trial: trialOf(week), ...(await board(env, acc, week)), server_now: now };
}

/* 한 번의 도전. 출격비도 피로도도 보상도 없다 —
   **시험대이지 콘텐츠 소모가 아니다.** 그래서 깎는 재화가 하나도 없다. */
export async function trialRun(env, acc, now) {
  const week = weekOf(now);
  const t = trialOf(week);
  const f = await loadOne(env, acc);
  if (!f) return err(404, 'no player');

  const st = computeStats(f.robot, f.parts);
  const out = runTrial(st, t, 'none');
  const pw = power(f.robot, f.parts);

  /* 더 높을 때만 갱신한다. 낮은 점수로 자기 기록을 지우면, 빌드를 시험해 보는 것
     자체가 손해가 되어 아무도 새 조합을 안 넣어 본다. */
  await env.DB.prepare(
    `INSERT INTO trial (week, account_id, nickname, score, robot_type, power, tries, updated_at)
       VALUES (?1,?2,?3,?4,?5,?6,1,?7)
     ON CONFLICT(week, account_id) DO UPDATE SET
       nickname   = ?3,
       tries      = trial.tries + 1,
       updated_at = ?7,
       score      = MAX(trial.score, ?4),
       robot_type = CASE WHEN ?4 > trial.score THEN ?5 ELSE trial.robot_type END,
       power      = CASE WHEN ?4 > trial.score THEN ?6 ELSE trial.power END`)
    .bind(week, acc, f.nickname, out.score, f.robot.type, pw, now).run();
  /* 도감 — 이번 주 상대를 만났고, 시련을 넘었으면 처치다. */
  const cs = codexMonsterStmt(env.DB, acc, [{ type: t.type, win: trialWon(out.score) }]);
  if (cs) await cs.run();

  return { ok: true, week, trial: t, score: out.score, win: trialWon(out.score),
           robot: f.robot, parts: f.parts, stats: st, foe: out.foe,
           ...(await board(env, acc, week)) };
}
