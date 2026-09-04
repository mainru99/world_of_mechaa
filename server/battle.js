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
import { computeStats, power, gainExp, addFat, fatOf, decayFat, sortieCost } from '../js/stats.js';
import { makeOpponent, makeHuntTarget, rollBattleRewards, rollHuntRewards } from '../js/rewards.js';
import { registerArena, pickOpponentFromArena, ratingDelta } from './arena.js';
import { makeUnit, simulate } from '../js/sim.js';

function cryptoRnd() {
  const buf = new Uint32Array(1);
  return () => { crypto.getRandomValues(buf); return buf[0] / 4294967296; };
}
const COMBAT = { ...ROBOT_TYPES, ...MONSTER_TYPES };

/* 출전 기체를 DB 에서 읽어 클라 저장본과 같은 모양으로 만든다 */
async function loadFighter(env, accountId) {
  const p = await env.DB.prepare('SELECT sel_robot, credits FROM player WHERE account_id = ?1').bind(accountId).first();
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
    credits: p ? p.credits : 0,
    robot: { uid: row.uid, type: row.type, level: row.level, exp: row.exp, fat: row.fat, fatAt: row.fat_at, slots },
    parts: used,
    allRarities: robots.map(r => (COMBAT[r.type] || ROBOT_TYPES.mule).rarity),
  };
}

/* 상대를 하나 골라 pending_match 에 넣을 문자열과 화면에 띄울 정보를 만든다.
   findMatch 와 startBattle 이 같이 쓴다.

   startBattle 이 끝나면서 '다음 상대'까지 미리 잡아 두는 것이 핵심이다.
   예전에는 한 판마다 find + start 로 왕복을 두 번 썼다. 이제 처음 한 번만 find 고
   그 뒤로는 start 하나로 이어진다 — 8판이면 16요청이 9요청이 된다.
   진짜 천장은 D1 행 수가 아니라 **Workers 요청 10만/일** 이라 왕복 한 번이
   그대로 하루 접속 상한이 된다.

   '다시 찾기'는 그대로 find 를 부르면 되므로 기능이 죽지 않는다.
   (find 와 start 를 한 요청으로 아예 합치면 상대를 보기 전에 승패가 확정되어
    다시 찾기가 성립하지 않는다. 그래서 합치지 않고 미리 잡는 쪽을 택했다.) */
/* 토벌 한 판의 출격비. 등급이 오를수록 비싸다. */
export const huntCost = (robot, tier) =>
  Math.ceil(sortieCost(robot) * (CONST.HUNT[tier] || CONST.HUNT.C).costX);

async function preparePending(env, accountId, me, now, credits, opts) {
  const rnd = cryptoRnd();
  let seq = 0;
  const uid = () => 'o' + now.toString(36) + (seq++).toString(36);
  const have = credits ?? me.credits;

  /* ── 토벌 ── 등급을 골라 몬스터를 사냥한다. 레이팅은 움직이지 않는다.
     비용을 못 내면 조용히 아레나로 되돌린다 — 이 경로는 '다음 판 미리 잡기'에서만
     닿는다. 사용자가 직접 고른 경우는 findMatch 가 먼저 거절한다. */
  const tier = opts && opts.mode === 'hunt' && CONST.HUNT[opts.tier] ? opts.tier : null;
  if (tier) {
    const hcost = huntCost(me.robot, tier);
    if (have >= hcost) {
      const hopp = makeHuntTarget(tier, me.robot.level, rnd, uid);
      const hseed = (Math.floor(rnd() * 0xffffffff)) >>> 0;
      const HT = COMBAT[hopp.type];
      return {
        json: JSON.stringify({ opp: hopp, seed: hseed, at: now, rescue: false, cost: hcost, mode: 'hunt', tier }),
        cost: hcost, rescue: false, mode: 'hunt', tier,
        opponent: {
          kind: hopp.kind, type: hopp.type, level: hopp.level, callsign: hopp.callsign,
          rating: null, name: HT.name, role: HT.role, rarity: HT.rarity,
          skill: HT.skill, parts: hopp.parts, slots: hopp.slots,
        },
      };
    }
  }

  /* ── 아레나 ──
     출격비를 낼 수 없으면 '비상 출격'으로 돌린다.
     막힌 판을 만들지 않기 위한 구제 장치다 — 크레딧이 0이면 벌 방법도 없어지므로.
     상대는 몬스터로 고정한다. 레이팅이 걸리면 구제가 아니라 벌이 된다. */
  const cost = sortieCost(me.robot);
  const rescue = have < cost;

  /* 먼저 아레나에 등록된 '진짜 사람'을 찾는다. 없으면(초기라 등록자가 적을 때)
     예전처럼 서버가 상대를 만들어 낸다 — 혼자여도 게임이 돌아가야 하므로. */
  let opp = null;
  if (!rescue && rnd() >= CONST.MONSTER_RATE) {
    const found = await pickOpponentFromArena(env, accountId, power(me.robot, me.parts));
    if (found) opp = found;
  }
  if (!opp) opp = makeOpponent(me.allRarities, me.robot.level, rnd, uid, rescue);
  const seed = (Math.floor(rnd() * 0xffffffff)) >>> 0;

  const T = COMBAT[opp.type];
  return {
    json: JSON.stringify({ opp, seed, at: now, rescue, cost: rescue ? 0 : cost, mode: 'arena' }),
    cost: rescue ? 0 : cost,
    rescue, mode: 'arena', tier: null,
    opponent: {
      kind: opp.kind, type: opp.type, level: opp.level, callsign: opp.callsign,
      rating: opp.rating ?? null,
      name: T.name, role: T.role, rarity: T.rarity,
      skill: T.skill, parts: opp.parts, slots: opp.slots,
    },
  };
}

export async function findMatch(env, accountId, now, opts) {
  const me = await loadFighter(env, accountId);
  if (!me) return { ok: false, status: 400, error: 'no robot' };

  /* 토벌은 사용자가 등급을 직접 고른 것이라, 비용을 못 내면 조용히 바꾸지 않고 알려 준다.
     (아레나는 고른 게 아니라 기본 경로라서 비상 출격으로 알아서 구제한다) */
  if (opts && opts.mode === 'hunt') {
    if (!CONST.HUNT[opts.tier]) return { ok: false, status: 400, error: 'unknown tier' };
    const need = huntCost(me.robot, opts.tier);
    if (me.credits < need)
      return { ok: false, status: 400, error: 'not enough credits for hunt', need, have: me.credits };
  }

  const next = await preparePending(env, accountId, me, now, me.credits, opts);
  await env.DB.prepare('UPDATE player SET pending_match = ?1 WHERE account_id = ?2')
    .bind(next.json, accountId).run();
  return { ok: true, opponent: next.opponent, cost: next.cost, rescue: next.rescue,
           mode: next.mode, tier: next.tier };
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

  /* 출격비. 비상 출격이면 0 이다.
     find 이후에 정비·레벨업으로 크레딧을 써서 모자라졌을 수 있으므로 여기서 다시 본다.
     그때는 잡아 둔 상대를 버리고 다시 찾게 한다 — 다시 찾으면 비상 출격이 잡힌다. */
  const mode = pend.mode === 'hunt' ? 'hunt' : 'arena';
  const tier = mode === 'hunt' ? pend.tier : null;
  const rescue = !!pend.rescue;
  const cost = rescue ? 0
             : mode === 'hunt' ? huntCost(me.robot, tier)
             : sortieCost(me.robot);
  if (!rescue && prow.credits < cost) {
    await env.DB.prepare('UPDATE player SET pending_match = NULL WHERE account_id = ?1')
      .bind(accountId).run();
    return { ok: false, status: 400, error: 'not enough credits' };
  }

  /* 피로도 자연 회복을 서버 시각으로 먼저 정산한다. 클라 시계는 믿지 않는다. */
  decayFat(me.robot, now);

  const { opp, seed } = pend;
  /* 클라가 같은 전투를 재생하려면 '서버가 쓴 스탯 그대로'가 필요하다.
     각자 계산하면 피로도 정산 시점 차이 같은 것으로 결과가 어긋나, 화면에는 이겼는데
     결과창은 졌다고 나오는 일이 생긴다. 그래서 아래 statP/statE 를 응답에 실어 보낸다. */
  const statP = computeStats(me.robot, me.parts);
  /* 사람 상대는 등록 당시 스냅샷의 스탯을 쓴다. 다시 계산하면 그 사이 상대가
     장비를 바꿨을 때 이미 성사된 전투의 입력이 달라진다. */
  const statE = opp.stats || computeStats({ type: opp.type, level: opp.level, fat: 0, slots: opp.slots }, opp.parts);
  const P = makeUnit(ROBOT_TYPES[me.robot.type].name, me.robot.type, statP);
  const E = makeUnit(opp.callsign, opp.type, statE);
  const events = simulate(P, E, seed);
  const win = events[events.length - 1].winner === 'P';

  /* 보상 확정 */
  const rnd = cryptoRnd();
  let seq = 0;
  const uid = () => 'b' + now.toString(36) + (seq++).toString(36);
  /* 토벌은 스크랩·파츠가 본체이고 크레딧은 아레나의 절반이 안 된다.
     그래야 '돈은 아레나, 재료는 토벌'로 갈려 양쪽 다 할 이유가 생긴다. */
  let rw = mode === 'hunt'
    ? rollHuntRewards(win, tier, opp.level, rnd, uid)
    : rollBattleRewards(win, opp.level, rnd, uid);
  /* 비상 출격의 보상은 크레딧뿐이다. 파츠·코어·경험치가 없어 정상 출격보다 확실히 나쁘고,
     크레딧이 회복되면 조건이 풀려 더 쓸 수 없다 — 그래서 이걸로 파밍할 수는 없다.
     피로도는 정상으로 쌓는다. 무한히 돌릴 수 없어야 한다. */
  if (rescue) rw = { win, sc: 0, core: 0, part: null, expGain: 0, fatAdd: rw.fatAdd,
                     cr: win ? CONST.RESCUE.crWin : CONST.RESCUE.crLose };

  const lv = gainExp(me.robot, rw.expGain);
  const fatAdd = addFat(me.robot, rw.fatAdd);

  const credits = prow.credits - cost + rw.cr;
  const scrap = prow.scrap + rw.sc;
  const cores = prow.cores + rw.core;
  const wins = prow.wins + (win ? 1 : 0);
  const losses = prow.losses + (win ? 0 : 1);
  const rev = prow.rev + 1;

  /* 다음 상대를 지금 잡아 둔다. 레벨이 올랐을 수 있으니 정산 뒤에 고른다.
     pending_match 는 어차피 이 UPDATE 에서 건드리므로 쓰기가 늘지 않는다. */
  /* '한 판 더' 는 같은 등급을 계속 사냥한다. 돈이 떨어지면 조용히 아레나로 되돌아간다. */
  const next = await preparePending(env, accountId, me, now, credits,
                                    mode === 'hunt' ? { mode, tier } : null);

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
       pending_match=?7, updated_at=?8 WHERE account_id=?9`)
    .bind(credits, cores, scrap, wins, losses, rev, next.json, now, accountId));

  /* 사람 상대 전투만 기록한다. 몬스터·생성 상대는 다툴 상대가 없고, 쓰기 예산도 아낀다. */
  let delta = 0;
  if (opp.kind === 'player') {
    const myRating = (await env.DB.prepare('SELECT rating FROM player WHERE account_id = ?1')
      .bind(accountId).first())?.rating ?? 1000;
    delta = ratingDelta(myRating, opp.rating ?? 1000, win);
    stmts.push(env.DB.prepare('UPDATE player SET rating = MAX(0, rating + ?1) WHERE account_id = ?2')
      .bind(delta, accountId));
    stmts.push(env.DB.prepare(
      `INSERT INTO battle (attacker_id, def_kind, defender_id, seed, atk_snap, def_snap, winner_id, atk_delta, created_at)
       VALUES (?1,'player',?2,?3,?4,?5,?6,?7,?8)`)
      .bind(accountId, opp.accountId, String(seed),
            JSON.stringify(statP), JSON.stringify(statE),
            win ? accountId : opp.accountId, delta, now));
  }

  await env.DB.batch(stmts);

  /* 내 편성은 그대로지만 레벨이 올랐을 수 있다. 올랐을 때만 아레나를 갱신한다. */
  if (lv.to > lv.from) await registerArena(env, accountId, now);

  return {
    ok: true,
    seed,                                  // 클라는 이 시드와 아래 스탯으로 같은 전투를 재생한다
    statP, statE,
    nameP: ROBOT_TYPES[me.robot.type].name,
    win,
    opponent: { kind: opp.kind, type: opp.type, level: opp.level, callsign: opp.callsign, parts: opp.parts, slots: opp.slots },
    ratingDelta: delta,
    reward: { cr: rw.cr, sc: rw.sc, core: rw.core, part: rw.part,
              lv: { amt: lv.amt, from: lv.from, to: lv.to }, fat: { add: fatAdd, now: fatOf(me.robot) } },
    cost, rescue, mode, tier,              // 이번 판에 실제로 낸 출격비와 모드
    next: { opponent: next.opponent, cost: next.cost, rescue: next.rescue,
            mode: next.mode, tier: next.tier },
    player: { credits, cores, scrap, wins, losses },
    robot: { uid: me.robot.uid, level: me.robot.level, exp: me.robot.exp, fat: me.robot.fat, fatAt: me.robot.fatAt },
    rev,
  };
}
