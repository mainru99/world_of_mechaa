/* 전투 — 서버 판정.
 *
 * 두 단계로 나눈다.
 *   ① /battle/find   서버가 상대를 고르고 시드를 정해 player.pending_match 에 저장한다.
 *                    클라는 상대 정보만 받아 화면에 띄운다.
 *   ② /battle/start  저장해 둔 상대로 서버가 시뮬을 돌려 승패와 보상을 확정한다.
 *                    클라는 같은 시드로 애니메이션만 재생한다.
 *
 * 상대를 서버가 고르는 이유: 상대 레벨이 보상에 들어가므로, 클라가 고르게 두면
 * 만렙 상대만 잡아 경험치를 부풀릴 수 있다.
 * 시드를 서버가 정하는 이유: 결정적 시뮬이라 시드가 곧 결과다.
 */
import { ROBOT_TYPES, MONSTER_TYPES, CONST } from '../data/balance.js';
import { computeStats, gainExp, addFat, fatOf, decayFat } from '../js/stats.js';
import { makeOpponent, rollBattleRewards } from '../js/rewards.js';
import { makeUnit, simulate } from '../js/sim.js';

function cryptoRnd() {
  const buf = new Uint32Array(1);
  return () => { crypto.getRandomValues(buf); return buf[0] / 4294967296; };
}
const COMBAT = { ...ROBOT_TYPES, ...MONSTER_TYPES };

/* 출전 기체를 DB 에서 읽어 클라 저장본과 같은 모양으로 만든다 */
async function loadFighter(env, accountId) {
  const p = await env.DB.prepare('SELECT sel_robot FROM player WHERE account_id = ?1').bind(accountId).first();
  const robots = (await env.DB.prepare(
    'SELECT id, uid, type, level, exp, fat, fat_at, s_weapon, s_frame, s_booster, s_core FROM robot WHERE account_id = ?1 ORDER BY id')
    .bind(accountId).all()).results || [];
  if (!robots.length) return null;
  const row = robots.find(r => r.id === (p && p.sel_robot)) || robots[0];

  const parts = (await env.DB.prepare('SELECT id, uid, slot, stats, enh FROM part WHERE account_id = ?1')
    .bind(accountId).all()).results || [];
  const byId = new Map(parts.map(x => [x.id, x]));
  const col = { WEAPON: 's_weapon', FRAME: 's_frame', BOOSTER: 's_booster', CORE: 's_core' };

  const slots = {}, used = [];
  for (const sl of Object.keys(col)) {
    const p2 = byId.get(row[col[sl]]);
    slots[sl] = p2 ? p2.uid : null;
    if (p2) used.push({ uid: p2.uid, slot: p2.slot, stats: JSON.parse(p2.stats || '{}'), enh: p2.enh });
  }
  return {
    row,
    robot: { uid: row.uid, type: row.type, level: row.level, exp: row.exp, fat: row.fat, fatAt: row.fat_at, slots },
    parts: used,
    allRarities: robots.map(r => (COMBAT[r.type] || ROBOT_TYPES.mule).rarity),
  };
}

export async function findMatch(env, accountId, now) {
  const me = await loadFighter(env, accountId);
  if (!me) return { ok: false, status: 400, error: 'no robot' };

  const rnd = cryptoRnd();
  let seq = 0;
  const uid = () => 'o' + now.toString(36) + (seq++).toString(36);
  const opp = makeOpponent(me.allRarities, me.robot.level, rnd, uid);
  const seed = (Math.floor(rnd() * 0xffffffff)) >>> 0;

  /* 다음 요청에서 그대로 쓰기 위해 저장한다. 클라가 보낸 상대는 받지 않는다. */
  const pending = JSON.stringify({ opp, seed, at: now });
  await env.DB.prepare('UPDATE player SET pending_match = ?1 WHERE account_id = ?2')
    .bind(pending, accountId).run();

  const T = COMBAT[opp.type];
  return {
    ok: true,
    opponent: {
      kind: opp.kind, type: opp.type, level: opp.level, callsign: opp.callsign,
      name: T.name, role: T.role, rarity: T.rarity,
      skill: T.skill, parts: opp.parts, slots: opp.slots,
    },
  };
}

const PENDING_TTL = 10 * 60 * 1000;   // 상대를 찾아 놓고 10분 넘게 방치하면 무효

export async function startBattle(env, accountId, now) {
  const prow = await env.DB.prepare('SELECT pending_match, credits, cores, scrap, wins, losses, rev FROM player WHERE account_id = ?1')
    .bind(accountId).first();
  if (!prow || !prow.pending_match) return { ok: false, status: 400, error: 'no pending match' };

  let pend;
  try { pend = JSON.parse(prow.pending_match); } catch { pend = null; }
  if (!pend || !pend.opp) return { ok: false, status: 400, error: 'bad pending match' };
  if (now - pend.at > PENDING_TTL) {
    await env.DB.prepare('UPDATE player SET pending_match = NULL WHERE account_id = ?1').bind(accountId).run();
    return { ok: false, status: 400, error: 'match expired' };
  }

  const me = await loadFighter(env, accountId);
  if (!me) return { ok: false, status: 400, error: 'no robot' };

  /* 피로도 자연 회복을 서버 시각으로 먼저 정산한다. 클라 시계는 믿지 않는다. */
  decayFat(me.robot, now);

  const { opp, seed } = pend;
  /* 클라가 같은 전투를 재생하려면 '서버가 쓴 스탯 그대로'가 필요하다.
     각자 계산하면 피로도 정산 시점 차이 같은 것으로 결과가 어긋나, 화면에는 이겼는데
     결과창은 졌다고 나오는 일이 생긴다. 그래서 아래 statP/statE 를 응답에 실어 보낸다. */
  const statP = computeStats(me.robot, me.parts);
  const statE = computeStats({ type: opp.type, level: opp.level, fat: 0, slots: opp.slots }, opp.parts);
  const P = makeUnit(ROBOT_TYPES[me.robot.type].name, me.robot.type, statP);
  const E = makeUnit(opp.callsign, opp.type, statE);
  const events = simulate(P, E, seed);
  const win = events[events.length - 1].winner === 'P';

  /* 보상 확정 */
  const rnd = cryptoRnd();
  let seq = 0;
  const uid = () => 'b' + now.toString(36) + (seq++).toString(36);
  const rw = rollBattleRewards(win, opp.level, rnd, uid);

  const lv = gainExp(me.robot, rw.expGain);
  const fatAdd = addFat(me.robot, rw.fatAdd);

  const credits = prow.credits + rw.cr;
  const scrap = prow.scrap + rw.sc;
  const cores = prow.cores + rw.core;
  const wins = prow.wins + (win ? 1 : 0);
  const losses = prow.losses + (win ? 0 : 1);
  const rev = prow.rev + 1;

  const stmts = [];
  if (rw.part) {
    stmts.push(env.DB.prepare(
      'INSERT INTO part (account_id, uid, slot, name, rarity, stats, enh, created_at) VALUES (?1,?2,?3,?4,?5,?6,0,?7)')
      .bind(accountId, rw.part.uid, rw.part.slot, rw.part.name, rw.part.rarity, JSON.stringify(rw.part.stats), now));
  }
  stmts.push(env.DB.prepare('UPDATE robot SET level=?1, exp=?2, fat=?3, fat_at=?4 WHERE id=?5')
    .bind(me.robot.level, me.robot.exp, me.robot.fat, me.robot.fatAt, me.row.id));
  stmts.push(env.DB.prepare(
    `UPDATE player SET credits=?1, cores=?2, scrap=?3, wins=?4, losses=?5, rev=?6,
       pending_match=NULL, updated_at=?7 WHERE account_id=?8`)
    .bind(credits, cores, scrap, wins, losses, rev, now, accountId));

  /* 사람 상대 전투만 기록한다. 몬스터는 다툴 상대가 없고 전투의 40%라 쓰기가 아깝다. */
  await env.DB.batch(stmts);

  return {
    ok: true,
    seed,                                  // 클라는 이 시드와 아래 스탯으로 같은 전투를 재생한다
    statP, statE,
    nameP: ROBOT_TYPES[me.robot.type].name,
    win,
    opponent: { kind: opp.kind, type: opp.type, level: opp.level, callsign: opp.callsign, parts: opp.parts, slots: opp.slots },
    reward: { cr: rw.cr, sc: rw.sc, core: rw.core, part: rw.part,
              lv: { amt: lv.amt, from: lv.from, to: lv.to }, fat: { add: fatAdd, now: fatOf(me.robot) } },
    player: { credits, cores, scrap, wins, losses },
    robot: { uid: me.robot.uid, level: me.robot.level, exp: me.robot.exp, fat: me.robot.fat, fatAt: me.robot.fatAt },
    rev,
  };
}
