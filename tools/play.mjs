/* 3계정 플레이 시뮬레이션 — node tools/play.mjs [일수] [반복] [출력폴더]
 *
 * 밸런스를 '수치가 이렇다'가 아니라 **'사람이 며칠 하면 어디까지 가는가'** 로 잰다.
 * 다른 도구들은 한 판의 승률을 재지만, 이건 경제 전체를 며칠씩 굴려서
 * 재화가 어디서 들어와 어디로 나가는지, 무엇이 막히는지, 무엇이 남아도는지를 본다.
 *
 * ── 무엇을 그대로 쓰는가 ────────────────────────────────
 * 판정은 전부 게임이 실제로 쓰는 순수 모듈이다. 여기서 다시 구현한 규칙은 없다.
 *   js/sim.js            전투 한 판
 *   js/stats.js          스탯·전투력·경험치·피로도·비용
 *   js/gacha.js          뽑기·파츠 생성
 *   js/rewards.js        상대 생성·보상
 *   js/breach.js         점령전 돌파
 *   server/territory.js  칸의 방어선과 세계 난이도(effLevel)
 * 그래서 data/balance.js 를 고치면 이 결과도 같이 움직인다. 어긋날 수가 없다.
 *
 * ── 무엇을 가정하는가 (여기가 이 도구의 한계다) ──────────
 *   · 하루 2세션(아침·저녁). 세션 사이에 12시간이 흐르므로 피로도 회복·원정 귀환·
 *     점령지 수입이 실제와 같은 방식으로 쌓인다.
 *   · 조작 시간 = 전투 재생 시간 + 12초(고르고 확인하는 시간).
 *     재생 시간은 이벤트 수에서 나온다 — tools/verify.mjs 와 같은 식이다.
 *   · 사람을 완벽하게 두지 않았다. 장착은 전투력이 오르는 쪽으로만 고르고(최적해를
 *     찾지 않는다), 토벌 등급은 '이길 만한 것 중 위'를 고른다.
 *   · 아레나 상대는 생성 상대다. 실제로는 등록된 사람이 우선이지만 사람이 적을 때는
 *     생성 상대가 대부분이라, 초·중반 감각에는 이쪽이 가깝다.
 *   · 세계 평균 전투력(점령전 난이도)은 그 계정의 전투력으로 본다. 혼자 도는
 *     시뮬이라 그것이 가장 보수적인 가정이다.
 */
import fs from 'node:fs';
import path from 'node:path';
import { ROBOT_TYPES, MONSTER_TYPES, TERRITORY, RARITY, ROBOT_RARITY, ROBOT_RARITY_CR,
         PULL_TABLE, PULL_TABLE_CR, SLOTS, CONST } from '../data/balance.js';
import { computeStats, power, powerOf, gainExp, addFat, fatOf, decayFat,
         sortieCost, serviceCost, lvCost, enhCost, findPart } from '../js/stats.js';
import { rollPull, genPart, BY_RARITY, PULL_CUR, scrapValue } from '../js/gacha.js';
import { makeOpponent, makeHuntTarget, rollBattleRewards, rollHuntRewards } from '../js/rewards.js';
import { ratingDelta } from '../server/arena.js';
import { makeUnit, simulate, mulberry32 } from '../js/sim.js';
import { applyTerrain, runBreach, regenLines, maxRounds, rarAllowed } from '../js/breach.js';
import { monsterLine, effLevel, unlockedBy } from '../server/territory.js';

/* 밸런스 상수를 바꿔 보고 싶을 때 — 파일을 고치지 않고 환경변수로 덮어쓴다.
   ChatGPT 가 '이 값이면 어떻게 되나'를 파일 수정 없이 재 볼 수 있게 하려는 것이다.
     ROWAR_PART_LV=1,3,7,11   → CONST.PART_LV 를 C,R,SR,SSR 순으로 덮어쓴다
     ROWAR_ATK_SCALE=1.4      → CONST.ATK_SCALE
   CONST 는 객체라 속성 수정이 되고, 모든 모듈이 같은 객체를 본다. */
if (process.env.ROWAR_PART_LV) {
  const [C, R, SR, SSR] = process.env.ROWAR_PART_LV.split(',').map(Number);
  Object.assign(CONST.PART_LV, { C, R, SR, SSR });
}
if (process.env.ROWAR_ATK_SCALE) CONST.ATK_SCALE = Number(process.env.ROWAR_ATK_SCALE);

const DAYS = parseInt(process.argv[2] || '30', 10);
const RUNS = parseInt(process.argv[3] || '5', 10);   // 같은 정책을 몇 번 돌려 평균낼 것인가
const OUT  = process.argv[4] || path.join(process.cwd(), 'tools', 'out');

const HOUR = 3600000;
const RARS  = ['C', 'UC', 'R', 'UQ', 'EP'];
const PRARS = ['C', 'R', 'SR', 'SSR'];
const NODE_BY = Object.fromEntries(TERRITORY.map(n => [n.id, n]));
const COMBAT = { ...ROBOT_TYPES, ...MONSTER_TYPES };
const rarOf = t => (COMBAT[t] || {}).rarity || 'C';

/* ── 정책 ────────────────────────────────────────────────
   같은 게임을 세 사람이 다르게 논다. 정책이 다르면 경제가 어떻게 달라지는지 보려는 것이다.
     acts       하루에 하는 전투 수 (아레나 + 토벌)
     huntShare  그중 토벌 비율
     pullAt     코어가 이만큼 모이면 10연차를 돌린다
     crPull     크레딧이 이만큼 남아 있을 때만 크레딧 뽑기 (0 이면 안 돌린다)
     lvKeep     레벨업·정비에 쓰고도 남겨 둘 크레딧 (출격비가 마르지 않게)
     terr/exped 점령전·원정을 하는가 */
const POLICIES = [
  { id: 'light',  ko: '라이트',   acts:  6, huntShare: 0.2, pullAt: 10, crPull: 0,     lvKeep: 1500, terr: false, exped: true },
  { id: 'steady', ko: '꾸준',     acts: 14, huntShare: 0.4, pullAt: 10, crPull: 0,     lvKeep: 2500, terr: true,  exped: true },
  { id: 'hard',   ko: '집중',     acts: 28, huntShare: 0.5, pullAt: 10, crPull: 20000, lvKeep: 4000, terr: true,  exped: true },
];

let _uid = 0;
const uid = () => 'x' + (_uid++).toString(36);

function newAccount(pol, rnd) {
  const type = BY_RARITY.C[Math.floor(rnd() * BY_RARITY.C.length)];
  const rb = { uid: uid(), type, level: 1, exp: 0, fat: 0, fatAt: 0,
               slots: { WEAPON: null, FRAME: null, BOOSTER: null, CORE: null } };
  return { pol, credits: 600, cores: 12, scrap: 30,
           robots: [rb], parts: [], sel: rb.uid, squad: [rb.uid],
           rating: 1000,        // 아레나 성적. 상대 장비가 이 값을 따라온다
           expd: null,          // { uid, tier, lv, endsAt }
           terr: {},            // nodeId -> { hp, hpAt, takenAt, claimedAt }
           ev: [], pulls: [], firstRar: {}, firstLv: {},
           blocked: 0, rescued: 0 };
}

const rbOf   = (P, u) => P.robots.find(r => r.uid === u);
const selRb  = P => rbOf(P, P.sel) || P.robots[0];
const pwOf   = (P, rb) => power(rb, P.parts);
const wornOf = (P, rb) => SLOTS.map(s => rb.slots[s]).filter(Boolean)
                               .map(u => findPart(u, P.parts)).filter(Boolean);
const ownedRars = P => [...new Set(P.robots.map(r => rarOf(r.type)))];
const overallLv = P => Math.max(1, ...P.robots.map(r => r.level));

/* 장착 — 전투력이 오르는 쪽으로만 바꾼다. 최적해를 찾지 않는다(사람도 안 한다).
   파츠는 계정 공용이라 선봉부터 채운다. */
function reequip(P) {
  const used = new Set();
  const order = P.squad.concat(P.robots.map(r => r.uid).filter(u => !P.squad.includes(u)));
  for (const u of order) {
    const rb = rbOf(P, u); if (!rb) continue;
    for (const sl of SLOTS) {
      const cand = P.parts.filter(p => p.slot === sl && !used.has(p.uid));
      let best = null, bestPw = -1;
      for (const c of [null, ...cand]) {
        const keep = rb.slots[sl];
        rb.slots[sl] = c ? c.uid : null;
        const v = pwOf(P, rb);
        if (v > bestPw) { bestPw = v; best = c; }
        rb.slots[sl] = keep;
      }
      rb.slots[sl] = best ? best.uid : null;
      if (best) used.add(best.uid);
    }
  }
  const sorted = [...P.robots].sort((a, b) => pwOf(P, b) - pwOf(P, a));
  P.squad = sorted.slice(0, CONST.SQUAD_MAX).map(r => r.uid);
  P.sel = P.squad[0];
}

/* 파츠를 받는다. 슬롯당 셋만 남기고 나머지는 분해한다 —
   인벤토리를 무한히 쌓아 두는 사람은 없다. 뽑기가 더 이상 자동 분해하지 않으므로
   '치우는 판단'이 실제로 플레이의 일부가 됐다. */
function takePart(P, p) {
  P.parts.push(p);
  const equipped = new Set(P.robots.flatMap(r => SLOTS.map(s => r.slots[s])));
  let same = P.parts.filter(x => x.slot === p.slot);
  while (same.length > 3) {
    const junk = same.filter(x => !equipped.has(x.uid))
                     .sort((a, b) => PRARS.indexOf(a.rarity) - PRARS.indexOf(b.rarity));
    if (!junk.length) break;
    const x = junk[0];
    P.parts = P.parts.filter(y => y.uid !== x.uid);
    P.scrap += Math.round(scrapValue(x.rarity) * (1 + (x.enh || 0) * 0.25));
    same = P.parts.filter(y => y.slot === p.slot);
  }
}

function applyPull(P, r) {
  if (r.kind === 'robot') {
    P.robots.push({ uid: uid(), type: r.type, level: 1, exp: 0, fat: 0, fatAt: 0,
                    slots: { WEAPON: null, FRAME: null, BOOSTER: null, CORE: null } });
  } else if (r.kind === 'dupe') { P.credits += r.gain.cr; P.scrap += r.gain.sc; P.cores += r.gain.co; }
  else if (r.kind === 'core')   P.cores += r.n;
  else if (r.kind === 'credit') P.credits += r.cr;
  else if (r.kind === 'part')   takePart(P, r.part);
}

function doPull(P, n, cur, rnd, day) {
  const C = PULL_CUR[cur];
  const have = cur === 'credit' ? P.credits : P.cores;
  if (have < C.cost * n) return 0;
  if (cur === 'credit') P.credits -= C.cost * n; else P.cores -= C.cost * n;
  const owned = new Set(P.robots.map(r => r.type));
  for (let i = 0; i < n; i++) {
    const r = rollPull(owned, overallLv(P), rnd, uid, cur);
    if (r.kind === 'robot') owned.add(r.type);
    applyPull(P, r);
    P.pulls.push({ day, cur, kind: r.kind,
                   rar: (r.kind === 'robot' || r.kind === 'dupe') ? rarOf(r.type)
                      : r.kind === 'part' ? r.part.rarity : null });
    if (r.kind === 'robot' && !P.firstRar[rarOf(r.type)]) P.firstRar[rarOf(r.type)] = day;
  }
  reequip(P);
  return n;
}

/* ── 전투 한 판 ────────────────────────────────────────
   아레나와 토벌은 상대를 고르는 방식만 다르고 나머지는 같다. */
/* 누가 나갈 것인가 — 편성 두 기 중 **지금** 가장 센 기체.
   power() 는 computeStats 를 거치므로 피로도가 이미 반영돼 있다. 그래서 이 한 줄이
   곧 '지친 기체를 쉬게 하고 번갈아 쓴다'가 된다 — 사람이 실제로 하는 판단이다.
   (이걸 안 넣고 늘 최강기만 내보냈더니 피로도가 45로 굳어 승률이 20%대로 주저앉았다.
    피로도 45 는 최대 체력 −45% 다. 실측: 피로 0 에서 37% 인 판이 45 에서 3.4% 가 된다) */
function pickFighter(P, now) {
  const cand = P.squad.map(u => rbOf(P, u)).filter(Boolean)
                      .filter(r => r.uid !== (P.expd && P.expd.uid));
  if (!cand.length) return selRb(P);
  for (const r of cand) decayFat(r, now);
  cand.sort((a, b) => pwOf(P, b) - pwOf(P, a));
  P.sel = cand[0].uid;
  return cand[0];
}

function fight(P, now, rnd, mode, tier, day) {
  const rb = pickFighter(P, now);
  decayFat(rb, now);
  const worn = wornOf(P, rb);
  const base = sortieCost(rb);
  const cost = mode === 'hunt' ? Math.ceil(base * CONST.HUNT[tier].costX) : base;

  /* 아레나는 크레딧이 없으면 비상 출격으로 구제된다(비용 0·몬스터 고정·크레딧만).
     토벌은 사용자가 고른 것이라 구제가 없다 — 못 내면 그냥 못 한다. */
  let rescue = false;
  if (P.credits < cost) {
    if (mode === 'hunt') { P.blocked++; return null; }
    rescue = true; P.rescued++;
  }
  if (!rescue) P.credits -= cost;

  const opp = mode === 'hunt'
    ? makeHuntTarget(tier, rb.level, rnd, uid)                       // 내 파츠를 보지 않는다
    : makeOpponent(ownedRars(P), rb.level, rnd, uid, rescue, P.rating);
  if (!opp) { P.blocked++; return null; }

  const seed = (Math.floor(rnd() * 0xffffffff)) >>> 0;
  const statP = computeStats(rb, P.parts);
  const statE = computeStats({ type: opp.type, level: opp.level, fat: 0, slots: opp.slots }, opp.parts);
  const ev = simulate(makeUnit('P', rb.type, statP), makeUnit('E', opp.type, statE), seed);
  const win = ev[ev.length - 1].winner === 'P';
  const hits = ev.reduce((s, e) => s + (e.t === 'hit' ? 1 : 0), 0);
  const sk   = ev.reduce((s, e) => s + (e.t === 'skill' ? 1 : 0), 0);
  const secs = (hits * 300 + sk * 520 + 700) / 1000 + 12;   // 재생 + 조작

  let rw;
  if (rescue) rw = { win, cr: win ? CONST.RESCUE.crWin : CONST.RESCUE.crLose,
                     sc: 0, core: 0, part: null, expGain: 0, fatAdd: win ? 4 : 8 };
  else if (mode === 'hunt') rw = rollHuntRewards(win, tier, opp.level, rnd, uid);
  else rw = rollBattleRewards(win, opp.level, rnd, uid);

  /* 레이팅은 아레나에서만, 그리고 몬스터·비상 출격을 뺀 판에서만 움직인다.
     서버(server/battle.js)와 같은 규칙이어야 시뮬이 실제와 같은 곡선을 그린다. */
  let dRating = 0;
  if (mode === 'arena' && !rescue && opp.kind !== 'monster') {
    dRating = ratingDelta(P.rating, P.rating, win, CONST.RATING_K.pve);
    P.rating = Math.max(0, P.rating + dRating);
  }

  P.credits += rw.cr; P.scrap += rw.sc; P.cores += rw.core || 0;
  if (rw.part) takePart(P, rw.part);
  const lv = gainExp(rb, rw.expGain || 0);
  addFat(rb, rw.fatAdd || 0);
  if (lv.to > lv.from) {
    for (let L = lv.from + 1; L <= lv.to; L++) if (!P.firstLv[L]) P.firstLv[L] = day;
    reequip(P);
  }

  P.ev.push({ day, mode: rescue ? 'rescue' : mode, tier: tier || null, win,
              cost: rescue ? 0 : cost, cr: rw.cr, sc: rw.sc, core: rw.core || 0,
              part: rw.part ? rw.part.rarity : null, secs,
              myLv: rb.level, oppLv: opp.level, fat: fatOf(rb), rating: P.rating,
              myPw: Math.round(powerOf(statP)), oppPw: Math.round(powerOf(statE)) });
  return { win, secs };
}

/* ── 점령전 한 칸 ─────────────────────────────────────── */
function terrAttack(P, node, now, rnd, day, avgPower) {
  const squad = P.squad.map(u => rbOf(P, u)).filter(Boolean)
                       .filter(r => r.uid !== (P.expd && P.expd.uid));
  const ok = squad.filter(r => rarAllowed(rarOf(r.type), node.maxRar));
  if (!ok.length) return null;
  const cost = Math.ceil(sortieCost(ok[0]) * CONST.TERR.COST_X);
  if (P.credits < cost) { P.blocked++; return null; }

  const lv = effLevel(node, avgPower);
  const lines = node.mon.map((_, i) => monsterLine(node, i, lv)).filter(Boolean);
  const st = P.terr[node.id] || {};
  const hours = st.hpAt != null ? Math.max(0, (now - st.hpAt) / HOUR) : 1e6;
  const hp0 = regenLines(Array.from({ length: lines.length },
                                    (_, i) => (st.hp && st.hp[i] != null) ? st.hp[i] : 1), hours);

  for (const r of ok) decayFat(r, now);
  const mechs = ok.map(r => ({ name: ROBOT_TYPES[r.type].name, type: r.type,
                               stats: applyTerrain(computeStats(r, P.parts), node.terrain) }));
  const seeds = Array.from({ length: maxRounds(lines.length, mechs.length) },
                           () => (Math.floor(rnd() * 0xffffffff)) >>> 0);
  const r = runBreach({ mechs, lines, seeds, hpLeft: hp0 });

  P.credits -= cost;
  const T = CONST.TERR;
  const perLine = Math.max(1, Math.round((26 + lv * 9) * T.EXP_LINE));
  const fought = new Set(r.rounds.map(x => x.mi));
  for (let i = 0; i < ok.length; i++) {
    if (!fought.has(i)) continue;
    const won = r.rounds.filter(x => x.mi === i && x.win).length;
    const tried = r.rounds.filter(x => x.mi === i).length;
    const g = gainExp(ok[i], perLine * won + Math.round(perLine * 0.30) * (tried - won));
    addFat(ok[i], i < r.downed ? T.FAT_DOWN : T.FAT_LIVE);
    if (g.to > g.from) for (let L = g.from + 1; L <= g.to; L++) if (!P.firstLv[L]) P.firstLv[L] = day;
  }
  let bonus = { cr: 0, sc: 0 };
  if (r.win) {
    bonus = { cr: Math.round(node.crH * T.CAPTURE_H), sc: Math.round(node.scH * T.CAPTURE_H) };
    P.credits += bonus.cr; P.scrap += bonus.sc;
    P.terr[node.id] = { hp: null, hpAt: now, takenAt: now, claimedAt: now };
  } else {
    P.terr[node.id] = { ...st, hp: r.hpLeft, hpAt: now };
  }
  P.ev.push({ day, mode: 'terr', tier: node.id, win: r.win, cost,
              cr: bonus.cr, sc: bonus.sc, core: 0, part: null,
              secs: r.rounds.length * 9 + 15, myLv: ok[0].level, oppLv: lv, fat: fatOf(ok[0]),
              myPw: Math.round(powerOf(mechs[0].stats)),
              oppPw: Math.round(Math.max(...lines.map(l => powerOf(l.stats)))) });
  reequip(P);
  return r.win;
}

/* 점령지 수입 — 실제와 같이 12시간치까지만 쌓인다 */
function terrClaim(P, now, day) {
  let cr = 0, sc = 0, core = 0;
  for (const id in P.terr) {
    const t = P.terr[id]; if (!t.takenAt || t.claimedAt == null) continue;
    const node = NODE_BY[id];
    const h = Math.min(CONST.TERR.INCOME_CAP_H, Math.max(0, (now - t.claimedAt) / HOUR));
    const a = Math.floor(node.crH * h), b = Math.floor(node.scH * h), c = Math.floor((node.coreH || 0) * h);
    if (a || b || c) { cr += a; sc += b; core += c; t.claimedAt = now; }
  }
  if (cr || sc || core) {
    P.credits += cr; P.scrap += sc; P.cores += core;
    P.ev.push({ day, mode: 'terr-income', tier: null, win: true, cost: 0,
                cr, sc, core, part: null, secs: 5, myLv: 0, oppLv: 0, fat: 0, myPw: 0, oppPw: 0 });
  }
}

/* ── 원정 ────────────────────────────────────────────── */
function expedTick(P, now, rnd, day) {
  if (P.expd && now >= P.expd.endsAt) {
    const T = CONST.EXPED[P.expd.tier], L = Math.max(1, P.expd.lv);
    const cr = Math.round(T.crH * T.h * L), sc = Math.round(T.scH * T.h * L);
    const core = rnd() < T.coreP ? 1 : 0;
    P.credits += cr; P.scrap += sc; P.cores += core;
    if (T.partP && rnd() < T.partP) takePart(P, genPart(L, rnd, uid()));
    P.ev.push({ day, mode: 'exped', tier: P.expd.tier, win: true, cost: 0,
                cr, sc, core, part: null, secs: 5, myLv: L, oppLv: 0, fat: 0, myPw: 0, oppPw: 0 });
    P.expd = null;
  }
  if (!P.expd && P.pol.exped) {
    /* 편성 밖의 기체를 보낸다. 편성에 든 기체를 보내면 전투를 못 한다. */
    const spare = P.robots.filter(r => !P.squad.includes(r.uid))
                          .sort((a, b) => pwOf(P, b) - pwOf(P, a))[0];
    if (spare) P.expd = { uid: spare.uid, tier: 'DEEP', lv: spare.level,
                          endsAt: now + CONST.EXPED.DEEP.h * HOUR };
  }
}

/* ── 육성 ────────────────────────────────────────────── */
/* day 를 받는 이유 — 크레딧으로 올린 레벨도 마일스톤에 남겨야 한다.
   예전에는 경험치로 오른 것만 기록해서 'Lv.20 이 Lv.10 보다 먼저'가 나왔다. */
function grow(P, day) {
  const rb = selRb(P);
  /* 레벨업은 '남겨 둘 크레딧' 위로만 쓴다. 다 쓰면 출격비가 없어 다음 판을 못 한다. */
  let n = 0;
  while (rb.level < CONST.MAXLV && P.credits - lvCost(rb.level) >= P.pol.lvKeep && n < 5) {
    P.credits -= lvCost(rb.level); rb.level++; rb.exp = 0; n++;
    if (!P.firstLv[rb.level]) P.firstLv[rb.level] = day;
  }
  /* 강화는 낀 파츠에만. 스크랩은 다른 쓸 곳이 없다. */
  for (const u of P.squad) {
    const r = rbOf(P, u); if (!r) continue;
    for (const sl of SLOTS) {
      const p = r.slots[sl] && findPart(r.slots[sl], P.parts); if (!p) continue;
      let g = 0;
      while ((p.enh || 0) < 10 && P.scrap >= enhCost(p.enh || 0) * 2 && g < 3) {
        P.scrap -= enhCost(p.enh || 0); p.enh = (p.enh || 0) + 1; g++;
      }
    }
  }
  /* 정비는 피로가 절반을 넘고 크레딧이 넉넉할 때만 — 시간이 지나면 공짜로 풀리므로.
     편성 두 기를 다 본다. 한 기만 고치면 교대가 반쪽이 된다. */
  for (const u of P.squad) {
    const r = rbOf(P, u); if (!r) continue;
    if (fatOf(r) <= CONST.FAT_MAX * 0.55) continue;
    const c = serviceCost(r);
    if (c > 0 && P.credits - c >= P.pol.lvKeep) { P.credits -= c; r.fat = 0; }
  }
  if (n) reequip(P);
}

/* 토벌 등급 — **최근 성적을 보고 오르내린다.** 사람은 벽에 계속 부딪치지 않는다.
   고정 규칙(레벨 몇 이상이면 무슨 등급)으로 뒀더니 승률 6% 짜리 등급을 30일 내내
   두들기는 결과가 나왔다. 그건 게임의 난이도가 아니라 봇이 멍청한 것이다.
   최근 10판에서 40% 밑이면 한 단계 내리고, 75% 위면 한 단계 올린다. */
function huntTier(P) {
  if (P.hTier == null) { P.hTier = 0; P.hRecent = []; }
  const recent = P.hRecent.slice(-10);
  if (recent.length >= 6) {
    const wr = recent.filter(Boolean).length / recent.length;
    if (wr < 0.40 && P.hTier > 0) { P.hTier--; P.hRecent = []; }
    else if (wr > 0.75 && P.hTier < RARS.length - 1) { P.hTier++; P.hRecent = []; }
  }
  return RARS[P.hTier];
}

let _npw = {}, _npwAvg = -1;
function nodePw(node, avgPower) {
  if (_npwAvg !== avgPower) { _npw = {}; _npwAvg = avgPower; }
  if (_npw[node.id] == null) {
    const lv = effLevel(node, avgPower);
    _npw[node.id] = Math.max(...node.mon.map((_, i) => {
      const l = monsterLine(node, i, lv); return l ? powerOf(l.stats) : 0; }));
  }
  return _npw[node.id];
}

/* ── 하루 ────────────────────────────────────────────── */
function playDay(P, day, dayStart, rnd, avgPower) {
  const pol = P.pol;
  for (const session of [0, 1]) {
    const t = dayStart + (session ? 12 * HOUR : 0);
    expedTick(P, t, rnd, day);
    terrClaim(P, t, day);
    grow(P, day);

    /* 점령전은 세션마다 한 칸. 지금 전력으로 될 만한 칸 중 값진 것부터 고른다. */
    if (pol.terr) {
      const mine = new Set(Object.keys(P.terr).filter(id => P.terr[id].takenAt));
      const myPw = Math.max(...P.squad.map(u => pwOf(P, rbOf(P, u) || P.robots[0])));
      const worth = n => n.crH + n.scH * 5 + (n.coreH || 0) * CONST.PULL_CR_COST;
      const myTop = Math.max(1, ...P.squad.map(u => (rbOf(P, u) || {}).level || 1));
      const cand = TERRITORY
        .filter(n => !mine.has(n.id))
        .filter(n => unlockedBy(n, myTop))          // 해금 레벨을 넘겨야 들어간다
        .filter(n => P.squad.some(u => rarAllowed(rarOf((rbOf(P, u) || {}).type), n.maxRar)))
        .filter(n => nodePw(n, avgPower) < myPw * 0.95)   // 이길 가망이 있는 칸만
        .sort((a, b) => worth(b) - worth(a));
      if (cand.length) terrAttack(P, cand[0], t, rnd, day, avgPower);
    }

    const acts = Math.round(pol.acts / 2);
    for (let i = 0; i < acts; i++) {
      if (rnd() < pol.huntShare) {
        const tier = huntTier(P);
        const r = fight(P, t, rnd, 'hunt', tier, day);
        if (r) P.hRecent.push(r.win);
      } else fight(P, t, rnd, 'arena', null, day);
    }

    while (P.cores >= pol.pullAt) doPull(P, 10, 'core', rnd, day);
    if (pol.crPull) while (P.credits >= pol.crPull + CONST.PULL_CR_COST * 10) doPull(P, 10, 'credit', rnd, day);
    grow(P, day);
  }
}

function snapshot(P, day) {
  const rb = selRb(P);
  const todays = P.ev.filter(e => e.day === day);
  const bat = todays.filter(e => ['arena', 'hunt', 'rescue', 'terr'].includes(e.mode));
  const o = { day, lv: rb.level, pw: Math.round(pwOf(P, rb)), rating: Math.round(P.rating),
              credits: P.credits, cores: P.cores, scrap: P.scrap,
              robots: P.robots.length, parts: P.parts.length,
              nodes: Object.values(P.terr).filter(t => t.takenAt).length,
              fat: fatOf(rb), battles: bat.length, wins: bat.filter(e => e.win).length,
              mins: Math.round(todays.reduce((s, e) => s + e.secs, 0) / 60),
              crIn: todays.reduce((s, e) => s + e.cr, 0),
              crOut: todays.reduce((s, e) => s + e.cost, 0) };
  for (const r of RARS)  o['rob' + r] = P.robots.filter(x => rarOf(x.type) === r).length;
  for (const r of PRARS) o['prt' + r] = P.parts.filter(x => x.rarity === r).length;
  return o;
}

function runOnce(pol, seed) {
  const rnd = mulberry32(seed >>> 0);
  const P = newAccount(pol, rnd);
  const snaps = [];
  for (let day = 1; day <= DAYS; day++) {
    /* 세계 평균 전투력 — 실제 서버는 등록자 전체의 평균을 쓴다.
       혼자 도는 시뮬에서는 이 계정의 전투력으로 본다. */
    playDay(P, day, (day - 1) * 24 * HOUR, rnd, Math.round(pwOf(P, selRb(P))));
    snaps.push(snapshot(P, day));
  }
  return { P, snaps };
}

/* ── 집계와 출력 ─────────────────────────────────────── */
const mean = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0;
const r1 = v => Math.round(v * 10) / 10;
const csv = rows => rows.map(r => r.join(',')).join('\n') + '\n';

function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const runs = {};
  for (const pol of POLICIES) {
    runs[pol.id] = [];
    for (let i = 0; i < RUNS; i++) runs[pol.id].push(runOnce(pol, 0x9e37 + i * 7919 + pol.id.length * 131));
  }

  /* ① 하루별 진행 — 반복의 평균 */
  const keys = Object.keys(runs.light[0].snaps[0]);
  const prog = [['policy', ...keys]];
  for (const pol of POLICIES)
    for (let d = 0; d < DAYS; d++)
      prog.push([pol.id, ...keys.map(k => r1(mean(runs[pol.id].map(r => r.snaps[d][k]))))]);
  fs.writeFileSync(path.join(OUT, 'progress.csv'), csv(prog));

  /* ② 콘텐츠별 — 시도·승률·재화·시간 */
  const cont = [['policy', 'content', 'attempts_per_run', 'winrate', 'cr_in', 'cr_out', 'cr_net',
                 'scrap', 'cores', 'parts', 'minutes', 'cr_per_min', 'sec_per_try']];
  const MODES = ['arena', 'hunt', 'rescue', 'terr', 'terr-income', 'exped'];
  for (const pol of POLICIES) {
    for (const m of MODES) {
      const per = runs[pol.id].map(r => r.P.ev.filter(e => e.mode === m));
      const n = mean(per.map(x => x.length));
      if (!n) { cont.push([pol.id, m, 0, '', 0, 0, 0, 0, 0, 0, 0, 0, 0]); continue; }
      const f = fn => mean(per.map(x => x.reduce((s, e) => s + fn(e), 0)));
      const crIn = f(e => e.cr), crOut = f(e => e.cost), secs = f(e => e.secs);
      const wr = mean(per.map(x => x.length ? x.filter(e => e.win).length / x.length : 0));
      cont.push([pol.id, m, r1(n), r1(wr * 100), r1(crIn), r1(crOut), r1(crIn - crOut),
                 r1(f(e => e.sc)), r1(f(e => e.core)), r1(f(e => e.part ? 1 : 0)),
                 r1(secs / 60), r1(secs > 0 ? (crIn - crOut) / (secs / 60) : 0), r1(secs / n)]);
    }
  }
  fs.writeFileSync(path.join(OUT, 'content.csv'), csv(cont));

  /* ③ 난이도 — 10일 구간별 승률과 전력비 */
  const band = [['policy', 'days', 'content', 'attempts', 'winrate', 'my_pw', 'opp_pw', 'pw_ratio', 'avg_fatigue', 'avg_rating']];
  const BANDS = [];
  for (let s = 1; s <= DAYS; s += 10) BANDS.push([s, Math.min(DAYS, s + 9)]);
  for (const pol of POLICIES)
    for (const [a, b] of BANDS)
      for (const m of ['arena', 'hunt', 'terr']) {
        const per = runs[pol.id].map(r => r.P.ev.filter(e => e.mode === m && e.day >= a && e.day <= b));
        const n = mean(per.map(x => x.length)); if (!n) continue;
        const wr = mean(per.map(x => x.length ? x.filter(e => e.win).length / x.length : 0));
        const mp = mean(per.flatMap(x => x.map(e => e.myPw)));
        const op = mean(per.flatMap(x => x.map(e => e.oppPw)));
        const ft = mean(per.flatMap(x => x.map(e => e.fat || 0)));
        const rt = mean(per.flatMap(x => x.map(e => e.rating || 0)));
        band.push([pol.id, `${a}-${b}`, m, r1(n), r1(wr * 100), Math.round(mp), Math.round(op),
                   r1(op ? mp / op : 0), r1(ft), Math.round(rt)]);
      }
  fs.writeFileSync(path.join(OUT, 'difficulty.csv'), csv(band));

  /* ④ 뽑기 — 실측 대비 이론값 */
  const g = [['policy', 'currency', 'pulls', 'robot_pct', 'dupe_pct', 'part_pct', 'core_pct',
              'credit_pct', 'bust_pct', ...RARS.map(r => 'rob_' + r), 'theory_robot_pct', 'max_dry_streak']];
  for (const pol of POLICIES)
    for (const cur of ['core', 'credit']) {
      const per = runs[pol.id].map(r => r.P.pulls.filter(p => p.cur === cur));
      const n = mean(per.map(x => x.length)); if (!n) continue;
      const share = k => r1(mean(per.map(x => x.length ? x.filter(p => p.kind === k).length / x.length * 100 : 0)));
      const rob = r => r1(mean(per.map(x => x.filter(p => (p.kind === 'robot' || p.kind === 'dupe') && p.rar === r).length)));
      const table = cur === 'credit' ? PULL_TABLE_CR : PULL_TABLE;
      const dry = mean(per.map(x => { let mx = 0, c = 0;
        for (const p of x) { if (p.kind === 'robot' || p.kind === 'dupe') { mx = Math.max(mx, c); c = 0; } else c++; }
        return Math.max(mx, c); }));
      g.push([pol.id, cur, r1(n), share('robot'), share('dupe'), share('part'), share('core'),
              share('credit'), share('bust'), ...RARS.map(rob),
              (table.find(t => t.k === 'robot') || { w: 0 }).w, Math.round(dry)]);
    }
  fs.writeFileSync(path.join(OUT, 'gacha.csv'), csv(g));

  /* ⑤ 마일스톤 — 며칠 만에 도달하는가 */
  const ms = [['policy', 'milestone', 'day_avg', 'reached_runs', 'of_runs']];
  for (const pol of POLICIES) {
    for (const L of [10, 20, 30, 40, 50, 60]) {
      /* 한 판에 두 레벨이 오르면 중간 레벨의 기록이 비는데, 그걸 '도달 못 함'으로
         세면 안 된다. 'L 이상에 처음 닿은 날'로 본다. */
      const d = runs[pol.id].map(r => {
        const days = Object.keys(r.P.firstLv).filter(k => +k >= L).map(k => r.P.firstLv[k]);
        return days.length ? Math.min(...days) : null;
      }).filter(Boolean);
      ms.push([pol.id, 'Lv.' + L + ' 도달', d.length ? r1(mean(d)) : '', d.length, RUNS]);
    }
    for (const r of ['UC', 'R', 'UQ', 'EP']) {
      const d = runs[pol.id].map(x => x.P.firstRar[r]).filter(Boolean);
      ms.push([pol.id, r + ' 기체 첫 획득', d.length ? r1(mean(d)) : '', d.length, RUNS]);
    }
    const nd = runs[pol.id].map(r => Object.values(r.P.terr).filter(t => t.takenAt).length);
    ms.push([pol.id, '점령 칸 수(마지막 날)', r1(mean(nd)), RUNS, RUNS]);
  }
  fs.writeFileSync(path.join(OUT, 'milestones.csv'), csv(ms));

  writeReport(runs);
  console.log(`${DAYS}일 × ${RUNS}회 × ${POLICIES.length}정책 → ${OUT}`);
  for (const f of ['progress.csv', 'content.csv', 'difficulty.csv', 'gacha.csv', 'milestones.csv', 'REPORT.md'])
    console.log('  ' + path.join('tools', 'out', f));
}

/* ── 사람이 읽는 요약 + 자동으로 잡히는 이상 ─────────── */
function writeReport(runs) {
  const L = [];
  const P0 = POLICIES;
  L.push('# 플레이 시뮬레이션 결과', '');
  L.push(`- 생성: \`node tools/play.mjs ${DAYS} ${RUNS}\``);
  L.push(`- ${DAYS}일 × 정책 ${P0.length}종 × ${RUNS}회 반복(평균)`);
  L.push(`- 판정은 전부 게임의 순수 모듈을 그대로 쓴다. 가정은 \`tools/play.mjs\` 머리말 참고.`);
  L.push(`- \`CONST.PART_LV\` = ${JSON.stringify(CONST.PART_LV)} · \`ATK_SCALE\` = ${CONST.ATK_SCALE}`
       + (process.env.ROWAR_PART_LV || process.env.ROWAR_ATK_SCALE ? '  **(환경변수로 덮어쓴 값)**' : ''), '');

  L.push('## 정책', '');
  L.push('| 정책 | 하루 전투 | 토벌 비율 | 크레딧 뽑기 | 점령전 |');
  L.push('|---|---|---|---|---|');
  for (const p of P0)
    L.push(`| ${p.ko}(${p.id}) | ${p.acts}판 | ${Math.round(p.huntShare * 100)}% | ${p.crPull ? '함' : '안 함'} | ${p.terr ? '함' : '안 함'} |`);
  L.push('');

  L.push('## 도달 지점', '');
  L.push('| 정책 | 최종 Lv | 최종 전투력 | 최종 레이팅 | 보유 기체 | 점령 칸 | 하루 평균 | 총 플레이 |');
  L.push('|---|---|---|---|---|---|---|---|');
  for (const p of P0) {
    const rs = runs[p.id], last = rs.map(r => r.snaps[DAYS - 1]);
    const mins = mean(rs.map(r => r.snaps.reduce((s, x) => s + x.mins, 0)));
    L.push(`| ${p.ko} | ${r1(mean(last.map(x => x.lv)))} | ${Math.round(mean(last.map(x => x.pw)))} | `
         + `${Math.round(mean(last.map(x => x.rating)))} | `
         + `${r1(mean(last.map(x => x.robots)))}기 | ${r1(mean(last.map(x => x.nodes)))} | `
         + `${r1(mean(rs.map(r => mean(r.snaps.map(x => x.mins)))))}분 | ${Math.round(mins / 60)}시간 |`);
  }
  L.push('');

  L.push('## 재화 (하루 평균, 마지막 10일)', '');
  L.push('| 정책 | 크레딧 수입 | 크레딧 지출 | 순증 | 보유 크레딧 | 코어 | 스크랩 |');
  L.push('|---|---|---|---|---|---|---|');
  for (const p of P0) {
    const tail = runs[p.id].map(r => r.snaps.slice(-10));
    const f = k => r1(mean(tail.map(s => mean(s.map(x => x[k])))));
    L.push(`| ${p.ko} | ${f('crIn')} | ${f('crOut')} | ${r1(f('crIn') - f('crOut'))} | `
         + `${f('credits')} | ${f('cores')} | ${f('scrap')} |`);
  }
  L.push('');

  /* 자동으로 잡히는 이상 — 사람이 표를 다 읽지 않아도 눈에 띄게 한다 */
  L.push('## 자동 점검', '');
  const issues = [];
  for (const p of P0) {
    const rs = runs[p.id];
    const tail = rs.map(r => r.snaps.slice(-10));
    /* '막힌 판' 은 평균으로 보면 안 된다 — 분포가 두 봉우리다.
       실측(집중 30일×50회): 50 run 중 43개가 **0회**인데 나머지가 최대 183회라
       평균 7.66 · 표준편차 30.32 가 나온다. 평균만 보면 '모두가 조금씩 막힌다' 로 읽히지만
       실제로는 **대부분은 멀쩡하고 몇 명이 완전히 무너진다.**
       그래서 평균이 아니라 **몇 %의 run 이 막혔는지**로 판정하고, 평균은 참고로만 적는다.
       (평균 기준으로 보던 시절, 표본 잡음만으로 경고가 켜졌다 꺼졌다 했다) */
    const bl = rs.map(r => r.P.blocked), rc = rs.map(r => r.P.rescued);
    const blocked = mean(bl), rescued = mean(rc);
    const blShare = bl.filter(x => x > 0).length / bl.length;
    const rcShare = rc.filter(x => x > 0).length / rc.length;
    const worst = Math.max(...bl);
    if (blShare > 0.05)
      issues.push(`**${p.ko}** — **${Math.round(blShare*100)}%의 run**(${bl.filter(x=>x>0).length}/${bl.length})이 비용을 못 내 막혔다. `
        + `막힌 run 의 최대 ${worst}회 · 전체 평균 ${r1(blocked)}회. **평균이 아니라 이 비율을 볼 것** — 대부분은 멀쩡하고 몇 명이 무너지는 모양이다`);
    if (rcShare > 0.10)
      issues.push(`**${p.ko}** — ${Math.round(rcShare*100)}%의 run 이 비상 출격에 기댔다(평균 ${r1(rescued)}회). 크레딧이 만성적으로 마른다`);
    const cr = mean(tail.map(s => mean(s.map(x => x.credits))));
    const sc = mean(tail.map(s => mean(s.map(x => x.scrap))));
    const co = mean(tail.map(s => mean(s.map(x => x.cores))));
    if (cr > 200000) issues.push(`**${p.ko}** — 크레딧이 ${Math.round(cr)} 로 남아돈다. 쓸 곳이 부족하다`);
    if (sc > 100000) issues.push(`**${p.ko}** — 스크랩이 ${Math.round(sc)} 로 남아돈다. 강화 말고 쓸 곳이 없다`);
    if (co > 60)     issues.push(`**${p.ko}** — 코어가 ${Math.round(co)} 로 쌓인다. 뽑기 말고 쓸 곳이 없다`);
    const lastLv = mean(rs.map(r => r.snaps[DAYS - 1].lv));
    if (lastLv >= CONST.MAXLV) {
      const d = mean(rs.map(r => r.P.firstLv[CONST.MAXLV] || DAYS));
      issues.push(`**${p.ko}** — ${r1(d)}일에 만렙(Lv.${CONST.MAXLV}) 도달. 그 뒤 육성 목표가 없다`);
    }
    /* 아레나·토벌은 판당 승률로 본다. 점령전은 **실패해도 깎아 둔 방어선이 남는**
       콘텐츠라 판당 승률이 낮은 것이 정상이다 — 대신 '한 칸 먹는 데 몇 번 걸리나'로 본다. */
    for (const m of ['arena', 'hunt']) {
      const ev = rs.flatMap(r => r.P.ev.filter(e => e.mode === m));
      if (!ev.length) continue;
      const wr = ev.filter(e => e.win).length / ev.length;
      if (wr < 0.30) issues.push(`**${p.ko}** — ${m} 승률 ${r1(wr * 100)}%. 계속 지는 콘텐츠는 안 하게 된다`);
      if (wr > 0.92) issues.push(`**${p.ko}** — ${m} 승률 ${r1(wr * 100)}%. 눌러서 이기는 버튼이다`);
    }
    if (p.terr) {
      const tries = mean(rs.map(r => r.P.ev.filter(e => e.mode === 'terr').length));
      const took  = mean(rs.map(r => r.P.ev.filter(e => e.mode === 'terr' && e.win).length));
      const per = took ? tries / took : Infinity;
      if (per > 12) issues.push(`**${p.ko}** — 점령 한 칸에 평균 ${r1(per)}회. 깎아 두는 재미보다 지루함이 앞선다`);
      if (took && per < 1.5) issues.push(`**${p.ko}** — 점령 한 칸에 평균 ${r1(per)}회. 방어선을 깎는 규칙이 의미가 없다`);
    }
    const terrN = mean(rs.map(r => Object.values(r.P.terr).filter(t => t.takenAt).length));
    if (p.terr && terrN >= TERRITORY.length) issues.push(`**${p.ko}** — ${DAYS}일에 지도 12칸을 전부 먹었다. 그 뒤 목표가 없다`);
    if (p.terr && terrN === 0) issues.push(`**${p.ko}** — 점령전을 한 칸도 못 먹었다. 입구가 너무 높다`);
  }
  if (issues.length) for (const s of [...new Set(issues)]) L.push('- ' + s);
  else L.push('- 자동 점검에서 걸린 것 없음');
  L.push('');
  L.push('## 파일', '');
  L.push('| 파일 | 무엇 |');
  L.push('|---|---|');
  L.push('| `progress.csv` | 하루별 레벨·전투력·재화·보유 기체/파츠·점령 칸·플레이 시간 |');
  L.push('| `content.csv` | 콘텐츠별 시도·승률·재화 수지·분당 크레딧·1회 소요 초 |');
  L.push('| `difficulty.csv` | 10일 구간별 승률과 내 전력/상대 전력 비 |');
  L.push('| `gacha.csv` | 창구별 실측 확률·등급별 획득 수·최장 미획득 연속 |');
  L.push('| `milestones.csv` | 레벨·등급 첫 획득까지 걸린 일수 |');
  fs.writeFileSync(path.join(OUT, 'REPORT.md'), L.join('\n') + '\n');
}

main();
