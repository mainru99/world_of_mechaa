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
import { makeOpponent, makeHuntTarget, rollBattleRewards, rollHuntRewards, pickTactic } from '../js/rewards.js';
import { registerArena, pickOpponentFromArena, ratingDelta } from './arena.js';
import { makeUnit, simulate, mulberry32 } from '../js/sim.js';

function cryptoRnd() {
  const buf = new Uint32Array(1);
  return () => { crypto.getRandomValues(buf); return buf[0] / 4294967296; };
}
const COMBAT = { ...ROBOT_TYPES, ...MONSTER_TYPES };

/* 출전 기체를 DB 에서 읽어 클라 저장본과 같은 모양으로 만든다.
   레벨과 경험치는 기체마다 따로다(007) — 뽑아서 키우는 것이 이 게임의 보상이라
   새로 얻은 기체는 Lv.1 부터 시작한다. 상대는 출전한 기체의 레벨에 맞춰 생성되므로
   저레벨 기체도 제 또래를 만나 정상적으로 벌 수 있다.
   나갈 수 있는 것은 편성(squad1/squad2)에 든 두 기뿐이다. */
async function loadFighter(env, accountId) {
  const p = await env.DB.prepare(
    'SELECT sel_robot, credits, rating, squad1, squad2 FROM player WHERE account_id = ?1')
    .bind(accountId).first();
  const robots = (await env.DB.prepare(
    'SELECT id, uid, type, level, exp, fat, fat_at, skill_lv, s_weapon, s_frame, s_booster, s_core FROM robot WHERE account_id = ?1 ORDER BY id')
    .bind(accountId).all()).results || [];
  if (!robots.length) return null;
  const squad = [p && p.squad1, p && p.squad2].filter(Boolean);
  const inSquad = id => !squad.length || squad.includes(id);
  const row = robots.find(r => r.id === (p && p.sel_robot) && inSquad(r.id))
           || robots.find(r => inSquad(r.id))
           || robots[0];

  const parts = (await env.DB.prepare('SELECT id, uid, slot, name, stats, enh FROM part WHERE account_id = ?1')
    .bind(accountId).all()).results || [];
  const byId = new Map(parts.map(x => [x.id, x]));
  const col = { WEAPON: 's_weapon', FRAME: 's_frame', BOOSTER: 's_booster', CORE: 's_core' };

  const slots = {}, used = [];
  for (const sl of Object.keys(col)) {
    const p2 = byId.get(row[col[sl]]);
    slots[sl] = p2 ? p2.uid : null;
    if (p2) used.push({ uid: p2.uid, slot: p2.slot, name: p2.name, stats: JSON.parse(p2.stats || '{}'), enh: p2.enh });
  }
  return {
    row,
    credits: p ? p.credits : 0,
    rating: p && p.rating != null ? p.rating : 1000,   // 상대 장비를 여기에 맞춘다
    robot: { uid: row.uid, type: row.type, level: row.level, exp: row.exp, fat: row.fat, fatAt: row.fat_at, skillLv: row.skill_lv, slots },
    parts: used,
    /* 상대 등급 보정은 '보유한' 기체 전부를 본다 — 편성에 없어도 내 전력이다 */
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
  /* 지금 '낀' 파츠만 센다. 인벤토리에 쌓아 둔 것은 전투에 안 나오므로 세면 안 된다.
     상대를 여기에 맞춰 만든다 — 아레나는 같은 품질의 파츠로, 몬스터는 레벨로. */
  const wornUids = Object.values(me.robot.slots || {}).filter(Boolean);
  const worn = (me.parts || []).filter(p => wornUids.includes(p.uid));

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
  /* 상대 장비는 **내 레이팅**에 맞춘다. 내가 낀 파츠를 따라가면 좋은 파츠를 껴도
     상대가 같이 세져 이득이 즉시 상쇄된다(data/balance.js 의 RATING_GEAR 주석 참고). */
  if (!opp) opp = makeOpponent(me.allRarities, me.robot.level, rnd, uid, rescue, me.rating);
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

/* 전술은 클라가 고르지만 **믿지 않는다.** 표에 없는 이름이면 균형(none)으로 떨어뜨린다.
   전술은 재화를 만들지 않으므로 최악의 조작이라 해도 자기 승률을 스스로 낮추는 것뿐이다.
   그래도 흰 목록으로 받는 이유는, 모르는 값이 시뮬까지 흘러 들어가지 않게 하기 위해서다. */
const validTactic = t => (typeof t === 'string' && CONST.TACTIC && CONST.TACTIC[t]) ? t : 'none';

export async function startBattle(env, accountId, now, body) {
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

  /* ── 잡아 둔 상대를 '선점'한다 ──────────────────────────
     전투 시작을 여러 번 누르면 요청도 그만큼 온다. 그대로 두면 셋 다 같은 pending_match 를
     읽어 **같은 전투를 세 번 치르고 보상도 세 번** 준다(실제로 제보된 버그다).

     그래서 여기서 조건부로 비운다. D1 은 문장 하나가 원자적이므로, 동시에 와도
     changes=1 은 한 번뿐이다 — 나머지는 0 을 받고 물러난다.
     클라에도 문지기를 두었지만(js/game.js 의 guard) 그것만으로는 손댄 클라이언트에
     그대로 뚫린다. 값을 지키는 쪽은 여기다. */
  const claim = await env.DB.prepare(
    'UPDATE player SET pending_match = NULL WHERE account_id = ?1 AND pending_match = ?2')
    .bind(accountId, prow.pending_match).run();
  if ((claim.meta?.changes ?? 0) !== 1)
    return { ok: false, status: 409, error: 'battle already started' };

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
  /* 여기 오면 pending 은 이미 비워 둔 상태다(위 선점). 다시 비울 필요가 없다.
     클라는 이 오류를 받으면 상대를 새로 찾는다 — 그때 비상 출격이 잡힌다. */
  if (!rescue && prow.credits < cost)
    return { ok: false, status: 400, error: 'not enough credits' };

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
  /* 전술 — 내 것은 요청에서 받고, 상대 것은 **시드에서** 뽑는다.
     상대 전술을 별도 난수(시드를 한 번 섞은 것)로 뽑는 이유는 전투 난수열을 건드리지
     않기 위해서다. 이 줄이 전투 rnd 를 한 칸 당기면 예전 전투가 전부 다른 결과가 된다.
     상대 전술은 응답에만 싣고 상대 카드에는 내보내지 않는다 — 미리 보이면
     가위바위보의 답을 보고 내는 것이 된다. 스킬 딱지로 짐작하는 것이 이 기능의 재미다. */
  const tacP = validTactic(body && body.tactic);
  const tacE = pickTactic(opp.type, mulberry32((seed ^ 0x9e3779b9) >>> 0));
  const P = makeUnit(ROBOT_TYPES[me.robot.type].name, me.robot.type, statP, tacP);
  const E = makeUnit(opp.callsign, opp.type, statE, tacE);
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

  /* 경험치는 싸운 기체가 받는다. 키우는 과정이 곧 보상이다. */
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

  /* 레이팅은 **아레나에서만** 움직인다.
       · 사람 상대      — 겨루기의 본체라 폭이 크다 (K = RATING_K.pvp)
       · 생성 로봇 상대 — 이쪽도 움직여야 한다. 안 그러면 사람이 적은 지금 레이팅이
                          영영 1000 에 머물고, 상대 장비도 바닥에 굳는다 (K = pve)
       · 몬스터·비상 출격·토벌·점령 — 움직이지 않는다. 구제 장치가 벌이 되면 안 되고,
                          토벌·점령은 난이도를 내가 고르는 콘텐츠라 성적으로 볼 수 없다.
     기록(battle 표)은 사람 상대만 남긴다 — 다툴 상대가 있는 것만 남기면 되고 쓰기도 아낀다. */
  let delta = 0;
  const ranked = mode === 'arena' && !rescue && opp.kind !== 'monster';
  if (ranked) {
    const myRating = (await env.DB.prepare('SELECT rating FROM player WHERE account_id = ?1')
      .bind(accountId).first())?.rating ?? 1000;
    const K = opp.kind === 'player' ? CONST.RATING_K.pvp : CONST.RATING_K.pve;
    delta = ratingDelta(myRating, opp.rating ?? myRating, win, K);
    stmts.push(env.DB.prepare('UPDATE player SET rating = MAX(0, rating + ?1) WHERE account_id = ?2')
      .bind(delta, accountId));
  }
  if (opp.kind === 'player') {
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
    tacticP: tacP, tacticE: tacE,          // 재생은 **서버가 확정한 전술**로 한다. 클라가 고른 값을 그대로 쓰지 않는다
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
