/* 전선 — 서버 판정.
 *
 * 규칙은 js/front.js 에 있다. 여기서는 **행을 읽고 쓰는 일**만 한다.
 * 클라도 같은 규칙 파일을 import 해서 재생만 하므로, 판정과 재생이 갈릴 수 없다.
 *
 * 점령전(server/territory.js)과 닮았지만 셋이 다르다.
 *   ① 출격비가 없다 — 진행을 막는 자리가 아니다. 새 계정의 첫 다섯 판이다
 *   ② 깎아 둔 방어선을 남기지 않는다 — 도전은 늘 가득 찬 방어선에서 시작한다
 *   ③ 보상은 **첫 클리어만** — 다시 깨면 0 이다. 파밍은 파견이 한다
 *
 * 읽는 행 — player 1 + robot N + part N. 점령전 한 번과 같다.
 * 진행은 `player.campaign` 한 칸이라 **표가 늘지 않는다**(마이그레이션 016).
 */
import { codexMonsterStmt } from './codex.js';
import { codexLines } from '../js/breach.js';
import { CONST, ROBOT_TYPES, SLOTS } from '../data/balance.js';
import { computeStats, fatOf, decayFat, gainExp, addFat, battleExp } from '../js/stats.js';
import { applyTerrain, runBreach, maxRounds } from '../js/breach.js';
import { readProgress, writeProgress, cellIndex, cellOpen, buildLines,
         rewardOf, unlockedBy, frontView, FRONT_CELLS } from '../js/front.js';
import { rollPart } from '../js/gacha.js';
import { PART_COLS, partOf, insertPart } from './parts.js';

const err = (status, error) => ({ ok: false, status, error });
const SLOT_COL = { WEAPON: 's_weapon', FRAME: 's_frame', BOOSTER: 's_booster', CORE: 's_core' };
const T = CONST.TERR || {};

/* 편성과 파츠를 읽는다. territory.js 의 loadSquad 와 같은 규칙이다 —
   선봉은 격납고에서 '출격' 으로 고른 기체이고, 원정 나간 기체는 못 나간다.
   전선만 다른 규칙을 쓰면 격납고에 'B 출격' 이라고 떠 있는데 A 가 싸운다. */
async function loadSquad(env, acc) {
  const p = await env.DB.prepare(
    `SELECT nickname, credits, scrap, rev, level, sel_robot, squad1, squad2, expd_robot, campaign
       FROM player WHERE account_id = ?1`).bind(acc).first();
  if (!p) return null;
  const robots = (await env.DB.prepare(
    `SELECT id, uid, type, level, exp, fat, fat_at, skill_lv, ${Object.values(SLOT_COL).join(', ')}
       FROM robot WHERE account_id = ?1 ORDER BY id`).bind(acc).all()).results || [];
  if (!robots.length) return { p, mechs: [], robots: [] };
  const parts = (await env.DB.prepare(`SELECT ${PART_COLS} FROM part WHERE account_id = ?1`)
    .bind(acc).all()).results || [];
  const byId = new Map(parts.map(x => [x.id, x]));

  const order = [p.squad1, p.squad2].filter(Boolean);
  let picked = order.map(id => robots.find(r => r.id === id)).filter(Boolean);
  if (!picked.length) picked = [robots.find(r => r.id === p.sel_robot) || robots[0]];
  picked = picked.filter(r => r.id !== p.expd_robot);
  const si = picked.findIndex(r => r.id === p.sel_robot);
  if (si > 0) picked = [picked[si], ...picked.filter((_, i) => i !== si)];

  const mechs = picked.map(row => {
    const slots = {}, used = [];
    for (const sl of SLOTS) {
      const q = byId.get(row[SLOT_COL[sl]]);
      slots[sl] = q ? q.uid : null;
      if (q) used.push(partOf(q));
    }
    return { row, robot: { uid: row.uid, type: row.type, level: row.level, exp: row.exp,
                           fat: row.fat, fatAt: row.fat_at, skillLv: row.skill_lv, slots }, parts: used };
  });
  return { p, mechs, robots };
}

/* 보유 기체 중 최고 레벨. 해금의 '다른 문' 이 이 값을 본다 —
   전선을 한 칸도 안 깬 기존 계정이 잠기지 않게 하는 장치다(js/front.js gateOpen). */
const maxLvOf = robots => Math.max(1, ...robots.map(r => r.level | 0), 1);

export async function frontState(env, acc) {
  const p = await env.DB.prepare(
    'SELECT campaign, wins, losses FROM player WHERE account_id = ?1').bind(acc).first();
  if (!p) return err(404, 'no player');
  const robots = (await env.DB.prepare(
    'SELECT level FROM robot WHERE account_id = ?1').bind(acc).all()).results || [];
  const prog = readProgress(p.campaign);
  const maxLv = maxLvOf(robots);
  return { ok: true, chapters: frontView(prog, maxLv), maxLv,
           /* 전투를 한 번도 안 했으면 첫 화면이 전선이다(DESIGN.md F장 §3).
              판단 기준이 wins+losses 하나라 새 컬럼이 필요 없고, 기존 계정은 전부 격납고다. */
           firstRun: ((p.wins | 0) + (p.losses | 0)) === 0 };
}

export async function frontRun(env, acc, body, now) {
  const i = cellIndex(body && body.cell);
  if (i < 0) return err(400, 'no such cell');
  const cell = FRONT_CELLS[i];

  const me = await loadSquad(env, acc);
  if (!me) return err(404, 'no player');
  if (!me.mechs.length) return err(400, 'no robot');

  const prog = readProgress(me.p.campaign);
  if (!cellOpen(prog, i)) return err(400, 'cell locked');
  const already = prog[i] > 0;
  const maxLv = maxLvOf(me.robots);

  /* 피로도는 서버 시각으로 먼저 정산한다. 깎인 체력 그대로 싸운다. */
  for (const m of me.mechs) decayFat(m.robot, now);

  const lines = buildLines(cell);
  if (!lines.length) return err(500, 'cell has no defense');

  const mechs = me.mechs.map(m => ({
    name: ROBOT_TYPES[m.robot.type].name, type: m.robot.type, uid: m.robot.uid,
    level: m.robot.level, fat: fatOf(m.robot),
    stats: applyTerrain(computeStats(m.robot, m.parts), cell.terrain),
  }));

  const buf = new Uint32Array(maxRounds(lines.length, mechs.length));
  crypto.getRandomValues(buf);
  const seeds = [...buf];
  /* hpLeft 를 안 넘긴다 — 전선은 깎아 둔 방어선을 남기지 않는다(js/front.js FRESH_LINES). */
  const r = runBreach({ mechs, lines, seeds });

  /* ── 정산 ── 경험치는 붙은 기체가, 피로도는 쓰러진 쪽에 크게. 점령전과 같은 식이다.
     **출격비는 없다.** 여기서 크레딧을 받으면 진행을 막는 자리가 된다. */
  const perLine = Math.max(1, Math.round(battleExp(cell.lv) * (T.EXP_LINE || 0.5)));
  const fought = new Set(r.rounds.map(x => x.mi));
  const expOut = [], fatOut = [], stmts = [];
  for (let k = 0; k < me.mechs.length; k++) {
    if (!fought.has(k)) continue;
    const rb = me.mechs[k].robot;
    const won = r.rounds.filter(x => x.mi === k && x.win).length;
    const tried = r.rounds.filter(x => x.mi === k).length;
    const amt = perLine * won + Math.round(perLine * 0.30) * (tried - won);
    const lv = gainExp(rb, amt);
    const add = addFat(rb, k < r.downed ? (T.FAT_DOWN || 12) : (T.FAT_LIVE || 4));
    expOut.push({ uid: rb.uid, amt, from: lv.from, to: lv.to, exp: rb.exp });
    fatOut.push({ uid: rb.uid, add, now: fatOf(rb), fatAt: rb.fatAt });
    stmts.push(env.DB.prepare('UPDATE robot SET level=?1, exp=?2, fat=?3, fat_at=?4 WHERE id=?5')
      .bind(rb.level, rb.exp, rb.fat, rb.fatAt, me.mechs[k].row.id));
  }

  /* 첫 클리어만 보상하고 진행을 적는다. 다시 깬 것이면 **쓰기가 아예 없다.** */
  const gain = r.win ? rewardOf(cell, already) : null;
  const unlocked = r.win ? unlockedBy(cell, prog, maxLv) : null;
  let part = null;
  let credits = me.p.credits, scrap = me.p.scrap, campaign = me.p.campaign;

  if (gain) {
    credits += gain.credits;
    scrap += gain.scrap;
    if (gain.part) {
      const rnd = () => crypto.getRandomValues(new Uint32Array(1))[0] / 4294967296;
      part = rollPart(Math.max(1, me.p.level | 0), rnd, 'f' + now.toString(36) + i, gain.part);
      stmts.push(insertPart(env.DB, acc, part, now));
    }
    const next = prog.slice(); next[i] = 1;
    campaign = writeProgress(next);
  }

  const rev = me.p.rev + 1;
  stmts.push(env.DB.prepare(
    'UPDATE player SET credits=?1, scrap=?2, campaign=?3, rev=?4, updated_at=?5 WHERE account_id=?6')
    .bind(credits, scrap, campaign, rev, now, acc));
  /* 도감 — 닿은 방어선마다 한 번 만났고, 뚫은 방어선은 처치다. */
  const cs = codexMonsterStmt(env.DB, acc, codexLines(lines, r.rounds));
  if (cs) stmts.push(cs);
  await env.DB.batch(stmts);

  return { ok: true, rev, win: r.win, cell: cell.id, first: !!gain,
           rounds: r.rounds, downed: r.downed, cleared: r.cleared,
           /* 클라는 이 셋으로 **같은 돌파를 다시 돌려** 애니메이션만 재생한다.
              그래서 `stats` 를 빼면 안 된다 — 빼고 보냈더니 재생이
              `makeUnit(name, type, undefined)` 에서 죽었다(피로도·보상은 이미 적힌 뒤라
              '횟수만 늘고 화면은 안 뜨는' 증상이 됐다). 점령전과 같은 모양으로 보낸다. */
           lines, mechs,
           seeds, exp: expOut, fat: fatOut,
           gain: gain ? { ...gain, part: part || null } : null,
           unlocked, credits, scrap, campaign };
}
