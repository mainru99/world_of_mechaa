/* 난투 — 런 규칙. 순수 함수. DOM · Math.random 없음. 서버(검증 · 저장)와 화면(미리 보기)이 같은 함수를 부른다.
 * (2026-10-07 · docs/plan/brawl-2026-10-07.md ②) 수치는 전부 CONST.BRAWL — 여기에는 규칙만 있다.
 *
 * ── 런 상태 ─────────────────────────────────────────────
 *   { v, seed, day, round, gold, lives, wins, losses, streak, hist, pool, rent,
 *     board:[u|null ×4], bench:[u|null ×BRAWL.bench(7)], shop:[type|null ×5], rerolls, locked, done }
 *   u = { type, star }. board 칸 번호가 곧 팀전 자리다(0 · 1 앞줄, 2 · 3 뒷줄 — js/brawl-sim.js).
 *   streak 은 연승이면 +n, 연패면 −n. hist 는 라운드마다 'W' | 'L'.
 *
 * ── 흐름 ────────────────────────────────────────────────
 *   newRun → (act 여러 번 → 전투 → settle) 반복 → done
 *   act 는 상태를 고치지 않고 **새 상태**를 돌려준다({ run } 또는 { error }). 서버는 받은 동작을 그대로 다시 돌려 검증한다.
 *
 * ── 나오는 기체 ─────────────────────────────────────────
 *   C 는 누구나 · UC 이상은 보유한 것만 · 그날의 대여(오늘의 6기 중 최대 3) · 스토리 기체는 없음.
 *   C 아닌 기체는 대여를 합쳐 출전 목록 BRAWL.deck 까지 — 무엇을 데려갈지는 플레이어가 고른다. 상점 가중치는 기체 하나당.
 *   상점은 (seed, 라운드, 새로 굴린 횟수)로 정해진다 — 같은 런을 다시 돌리면 같은 상점이 나온다.
 *
 * ── 시너지 ──────────────────────────────────────────────
 *   보드(대기석 아님)에 있는 **서로 다른 기체**의 수로 센다. 같은 기체 둘은 하나다. 2기 · 3기 이상 두 단계.
 *   딱지는 이미 있는 스킬 효과에서 읽는다(새 특성을 만들지 않는다):
 *     방벽 shield · 수리 repair · 표적 mark · 돌파(ignoreDef | shred) · 교란 jam · 처형 execute · 흡혈 drain
 *     정밀(alwaysCrit) · 연타(hits ≥ 3) · 공명(같은 family 아종)
 *   효과는 **팀 전체**에 걸린다(공명만 그 집안 기체에게):
 *     방벽 시작 방벽(최대 내구 비율) · 수리 내 턴마다 회복 · 표적 공격력 · 돌파 타격 관통 확률(관통량 0.4) · 교란 속도
 *     처형 치명 %p · 흡혈 방어력 · 정밀 스킬 위력 · 연타 회피 %p · 공명 공격력 · 최대 내구
 *   (정밀은 처음에 SP 충전 배수였는데 30 × 3 = 90 < 100 의 문턱 때문에 ×1.11 아래는 아무 일도 없고 위는 스킬이 ⅓ 잦아졌다 — ③ 에서 바꿈)
 */
import { ROBOT_TYPES, CONST } from '../data/balance.js';
import { computeStats } from './stats.js';
import { mulberry32 } from './sim.js';

export const BRAWL = () => CONST.BRAWL || {};
export const RARITIES = ['C', 'UC', 'R', 'UQ', 'EP'];
const RUN_V = 1;

/* ── 작은 도구 ─────────────────────────────────────────── */
/* 문자열 · 숫자 묶음 → 32비트. 상점 · 대여 · 봇의 시드를 만든다 */
export function h32(...xs) {
  let h = 2166136261;
  const s = xs.join('|');
  for (let k = 0; k < s.length; k++) { h ^= s.charCodeAt(k); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
const clone = r => JSON.parse(JSON.stringify(r));
const rarityOf = t => (ROBOT_TYPES[t] || {}).rarity;
const priceOf = t => BRAWL().price[rarityOf(t)] || 1;
const copiesIn = star => Math.pow(3, (star || 1) - 1);          // ★2 = 기체 셋, ★3 = 아홉
const units = run => [...run.board, ...run.bench].filter(Boolean);
const table = (rows, n) => { let v = 0; for (const [at, x] of rows || []) if (n >= at) v = x; return v; };

/* 난투에 나올 수 있는 기체 전체(스토리 기체 제외) */
export const brawlTypes = () => Object.keys(ROBOT_TYPES).filter(t => !ROBOT_TYPES[t].story && ROBOT_TYPES[t].rarity && BRAWL().price[ROBOT_TYPES[t].rarity]);

/* ── 대여 ─────────────────────────────────────────────── */
/* 오늘의 대여 6기 — C 가 아니고 · 스토리가 아니고 · 내가 갖지 않은 기체. 날짜로 정해진다(모두 같은 순서에서 내 보유만 뺀다) */
export function dailyRentals(day, owned) {
  const have = new Set(owned || []);
  const all = brawlTypes().filter(t => rarityOf(t) !== 'C').sort();
  const rnd = mulberry32(h32('rent', day));
  for (let k = all.length - 1; k > 0; k--) { const j = Math.floor(rnd() * (k + 1)); [all[k], all[j]] = [all[j], all[k]]; }
  return all.filter(t => !have.has(t)).slice(0, BRAWL().rent.offers);
}

/* 이 런의 기체 풀 — C 전부 + 대여 + 출전 목록(보유한 C 아닌 기체). C 아닌 기체는 **대여 포함 BRAWL.deck 까지**.
   deck 을 안 주면 보유 기체를 등급 높은 순 · id 순으로 채운다. 정렬해서 돌려준다(상점이 순서에 기대므로) */
export function eligiblePool(owned, rentals, deck) {
  const ok = new Set(brawlTypes()), have = new Set(owned || []);
  const out = new Set(), cap = BRAWL().deck || Infinity;
  for (const t of ok) if (rarityOf(t) === 'C') out.add(t);
  let n = 0;
  for (const t of rentals || []) if (ok.has(t) && rarityOf(t) !== 'C' && !out.has(t) && n < cap) { out.add(t); n++; }
  const pick = deck ? [...deck] : [...have].sort((a, b) => RARITIES.indexOf(rarityOf(b)) - RARITIES.indexOf(rarityOf(a)) || (a < b ? -1 : 1));
  for (const t of pick) if (ok.has(t) && have.has(t) && rarityOf(t) !== 'C' && !out.has(t) && n < cap) { out.add(t); n++; }
  return [...out].sort();
}

/* ── 상점 ─────────────────────────────────────────────── */
/* 한 런 안에서 그 기체를 몇 개 가졌나(★2 = 3 · ★3 = 9). extra 는 이미 굴린 상점 칸 */
export function copiesOf(run, type, extra) {
  let n = 0;
  for (const u of units(run)) if (u.type === type) n += copiesIn(u.star);
  for (const t of extra || []) if (t === type) n++;
  return n;
}
const atLimit = (run, t, extra) => copiesOf(run, t, extra) >= (BRAWL().copies[rarityOf(t)] || 99);

/* 라운드의 기체 하나당 가중치 — 표의 끝을 넘으면 마지막 줄 */
export function weightAt(round) {
  const W = BRAWL().weight;
  return W[Math.max(0, Math.min(W.length - 1, (round || 1) - 1))];
}
/* 이 런의 그 라운드 상점에서 등급별로 나올 몫(%) — 화면이 '확률' 로 보여 줄 값 */
export function oddsOf(run, round) {
  const w = weightAt(round != null ? round : run.round), sum = {}, out = {};
  let all = 0;
  for (const t of run.pool) { const r = rarityOf(t); sum[r] = (sum[r] || 0) + (w[r] || 0); all += w[r] || 0; }
  for (const r of RARITIES) out[r] = all ? Math.round((sum[r] || 0) / all * 1000) / 10 : 0;
  return out;
}

/* 상점 5칸을 굴린다. 풀의 기체마다 그 라운드 가중치로 하나를 뽑는다 — 풀이 작아도 한 기체가 더 자주 나오지 않는다.
   복사본 한도에 닿은 기체는 나오지 않는다(이번에 굴린 칸까지 센다). 가중치가 다 0 이면 남은 기체에서 고르게 */
export function rollShop(run) {
  const B = BRAWL(), rnd = mulberry32(h32('shop', run.seed, run.round, run.rerolls));
  const w = weightAt(run.round), out = [];
  for (let s = 0; s < B.shop.slots; s++) {
    const cand = run.pool.filter(t => !atLimit(run, t, out));
    if (!cand.length) { out.push(null); continue; }
    let ws = cand.map(t => w[rarityOf(t)] || 0), sum = ws.reduce((a, b) => a + b, 0);
    if (!sum) { ws = cand.map(() => 1); sum = cand.length; }
    let x = rnd() * sum, pick = cand[cand.length - 1];
    for (let k = 0; k < cand.length; k++) { if ((x -= ws[k]) < 0) { pick = cand[k]; break; } }
    out.push(pick);
  }
  return out;
}

/* ── 런 시작 ──────────────────────────────────────────── */
/* owned = 보유 기체 type 목록 · rentals = 고른 대여(오늘의 6기 안 · 최대 3) · deck = 출전 목록(보유 중에서, 대여와 합쳐 BRAWL.deck 까지).
   대여 검증은 day 가 있을 때만 */
export function newRun({ seed, day, owned, rentals, deck }) {
  const B = BRAWL();
  const offers = day != null ? new Set(dailyRentals(day, owned)) : null;
  const rent = [...new Set(rentals || [])].filter(t => !offers || offers.has(t)).slice(0, B.rent.daily);
  const run = {
    v: RUN_V, seed: seed >>> 0, day: day != null ? day : null,
    round: 1, gold: B.startGold, lives: B.lives, wins: 0, losses: 0, streak: 0, hist: [],
    pool: eligiblePool(owned, rent, deck), rent,
    board: Array(B.board).fill(null), bench: Array(B.bench).fill(null),
    shop: [], rerolls: 0, locked: false, done: false,
  };
  run.shop = rollShop(run);
  return run;
}

/* ── 합성 ─────────────────────────────────────────────── */
/* 같은 기체 · 같은 별 셋 → 별 하나 위. 새 기체는 셋 중 **보드에 있던 가장 앞 칸**(없으면 대기석 가장 앞 칸)에 선다.
   ★2 가 생겨 ★2 가 셋이 되면 이어서 ★3. 합성마다 보급품(mergeGold[새 별]) */
export function autoMerge(run) {
  const B = BRAWL(), merged = [];
  for (let again = true; again;) {
    again = false;
    const spots = [];
    run.board.forEach((u, i) => u && spots.push({ where: 'board', i, u }));
    run.bench.forEach((u, i) => u && spots.push({ where: 'bench', i, u }));
    const groups = {};
    for (const s of spots) if (s.u.star < 3) (groups[s.u.type + '|' + s.u.star] = groups[s.u.type + '|' + s.u.star] || []).push(s);
    for (const key of Object.keys(groups).sort()) {
      const g = groups[key];
      if (g.length < 3) continue;
      const three = g.slice(0, 3), star = three[0].u.star + 1;
      for (const s of three) run[s.where][s.i] = null;
      run[three[0].where][three[0].i] = { type: three[0].u.type, star };
      run.gold += B.mergeGold[star] || 0;
      merged.push({ type: three[0].u.type, star, where: three[0].where, i: three[0].i });
      again = true;
      break;
    }
  }
  return merged;
}

/* ── 동작 ─────────────────────────────────────────────── */
/* a = { t:'buy', i } | { t:'sell', where, i } | { t:'move', from:{where,i}, to:{where,i} } | { t:'reroll' } | { t:'lock' }
   → { run, merged? } 또는 { error }. 받은 run 은 고치지 않는다 */
export function act(run0, a) {
  if (!run0 || run0.done) return { error: 'run over' };
  if (!a || typeof a.t !== 'string') return { error: 'bad action' };
  const B = BRAWL(), run = clone(run0);
  const slot = (where, i) => (where === 'board' || where === 'bench') && Number.isInteger(i) && i >= 0 && i < run[where].length;

  if (a.t === 'buy') {
    if (!Number.isInteger(a.i) || a.i < 0 || a.i >= run.shop.length || !run.shop[a.i]) return { error: 'empty slot' };
    const t = run.shop[a.i], cost = priceOf(t);
    if (run.gold < cost) return { error: 'gold' };
    if (atLimit(run, t)) return { error: 'limit' };
    /* 자리 — 대기석 빈칸 → 보드 빈칸. 둘 다 차 있어도 사자마자 합성되면(같은 ★1 둘이 이미 있으면) 살 수 있다 */
    let where = 'bench', i = run.bench.indexOf(null);
    if (i < 0) { where = 'board'; i = run.board.indexOf(null); }
    if (i < 0) {
      if (units(run).filter(u => u.type === t && u.star === 1).length < 2) return { error: 'full' };
      run.gold -= cost; run.shop[a.i] = null;
      const two = [];
      run.board.forEach((u, k) => u && u.type === t && u.star === 1 && two.length < 2 && two.push(['board', k]));
      run.bench.forEach((u, k) => u && u.type === t && u.star === 1 && two.length < 2 && two.push(['bench', k]));
      run[two[1][0]][two[1][1]] = null;
      run[two[0][0]][two[0][1]] = { type: t, star: 2 };
      run.gold += B.mergeGold[2] || 0;
      const merged = [{ type: t, star: 2, where: two[0][0], i: two[0][1] }, ...autoMerge(run)];
      return { run, merged };
    }
    run.gold -= cost; run.shop[a.i] = null;
    run[where][i] = { type: t, star: 1 };
    return { run, merged: autoMerge(run) };
  }

  if (a.t === 'sell') {
    if (!slot(a.where, a.i) || !run[a.where][a.i]) return { error: 'empty slot' };
    const u = run[a.where][a.i];
    run.gold += priceOf(u.type) * copiesIn(u.star);               // 판매는 산 값
    run[a.where][a.i] = null;
    return { run };
  }

  if (a.t === 'move') {
    const f = a.from || {}, to = a.to || {};
    if (!slot(f.where, f.i) || !slot(to.where, to.i)) return { error: 'bad slot' };
    if (!run[f.where][f.i]) return { error: 'empty slot' };
    const x = run[f.where][f.i];
    run[f.where][f.i] = run[to.where][to.i];
    run[to.where][to.i] = x;
    return { run };
  }

  if (a.t === 'reroll') {
    if (run.gold < B.shop.reroll) return { error: 'gold' };
    run.gold -= B.shop.reroll; run.rerolls++; run.locked = false;
    run.shop = rollShop(run);
    return { run };
  }

  if (a.t === 'lock') { run.locked = !run.locked; return { run }; }
  return { error: 'bad action' };
}

/* ── 라운드 끝 ────────────────────────────────────────── */
/* 수입 = 기본 + 이자(보유 interestPer 당 1, 최대 interestMax) + 연승 · 연패 보너스. 이자는 **전투 전에 가진 골드**로 센다 */
export function incomeOf(run) {
  const I = BRAWL().income;
  const interest = Math.min(I.interestMax, Math.floor(Math.max(0, run.gold) / I.interestPer));
  const streak = table(I.streak, Math.abs(run.streak));
  return { base: I.base, interest, streak, total: I.base + interest + streak };
}
export const livesLostAt = round => table(BRAWL().lossLives, round);

/* 전투 결과를 반영하고 다음 라운드를 연다. → { run, lost, income } */
export function settle(run0, win) {
  if (!run0 || run0.done) return { error: 'run over' };
  const B = BRAWL(), run = clone(run0);
  let lost = 0;
  if (win) { run.wins++; run.streak = run.streak > 0 ? run.streak + 1 : 1; }
  else { lost = livesLostAt(run.round); run.lives = Math.max(0, run.lives - lost); run.losses++; run.streak = run.streak < 0 ? run.streak - 1 : -1; }
  run.hist.push(win ? 'W' : 'L');
  if (run.wins >= B.winGoal || run.lives <= 0) { run.done = true; return { run, lost, income: null }; }
  const income = incomeOf(run);
  run.gold += income.total;
  run.round++; run.rerolls = 0;
  if (run.locked) run.locked = false;                              // 잠근 상점은 한 라운드 그대로 — 산 칸은 빈 채로
  else run.shop = rollShop(run);
  return { run, lost, income };
}

/* ── 보상 ─────────────────────────────────────────────── */
/* 아레나 승리 한 판의 평균 크레딧 — js/rewards.js rollBattleRewards 의 120 + 상대 Lv × 14 + (0 ~ 40) 와 같은 식 */
export const arenaWinCr = lv => 140 + Math.max(1, lv | 0) * 14;
/* 하루 첫 런의 보상 — { cr, sc, shard(개발 목표 조각), refined(정제 코어) }. 두 번째 런부터는 부르지 않는다(서버가 가린다) */
export function rewardOf(wins, level) {
  const R = BRAWL().reward, w = Math.max(0, Math.min(BRAWL().winGoal, wins | 0));
  return {
    cr: Math.round(arenaWinCr(level) * (R.cr.base + R.cr.per * w)),
    sc: w >= R.sc.from ? R.sc.base + R.sc.per * w : 0,
    shard: table(R.shard, w),
    refined: table(R.refined, w),
  };
}

/* ── 시너지 ───────────────────────────────────────────── */
/* 기체 하나가 가진 딱지 */
export function tagsOf(type) {
  const R = ROBOT_TYPES[type];
  if (!R) return [];
  const fx = (R.skill && R.skill.fx) || {}, out = [];
  if (fx.shield) out.push('shield');
  if (fx.repair) out.push('repair');
  if (fx.mark) out.push('mark');
  if (fx.ignoreDef || fx.shred) out.push('breach');
  if (fx.jam) out.push('jam');
  if (fx.execute) out.push('execute');
  if (fx.drain) out.push('drain');
  if (fx.alwaysCrit) out.push('precise');
  if ((fx.hits || 1) >= 3) out.push('flurry');
  return out;
}

/* 보드의 시너지 — [{ key, ko, n, tier(1|2), v, types, fam? }] (켜진 것만, 정해진 순서).
   공명은 집안마다 하나씩 나온다(fam = 집안 이름) */
export function synergiesOf(board) {
  const S = BRAWL().syn, seen = [...new Set((board || []).filter(Boolean).map(u => u.type))];
  const by = {}, fam = {};
  for (const t of seen) {
    for (const k of tagsOf(t)) (by[k] = by[k] || []).push(t);
    const f = (ROBOT_TYPES[t] || {}).family;
    if (f) (fam[f] = fam[f] || []).push(t);
  }
  const tierOf = n => n >= 3 ? 2 : n >= 2 ? 1 : 0, out = [];
  for (const key of Object.keys(S)) {
    if (key === 'family') continue;
    const types = by[key] || [], tier = tierOf(types.length);
    if (tier) out.push({ key, ko: S[key].ko, n: types.length, tier, v: S[key].v[tier - 1], types });
  }
  if (S.family) for (const f of Object.keys(fam).sort()) {
    const types = fam[f], tier = tierOf(types.length);
    if (tier) out.push({ key: 'family', ko: S.family.ko, n: types.length, tier, v: S.family.v[tier - 1], types, fam: f });
  }
  return out;
}

/* ── 팀 ───────────────────────────────────────────────── */
const E0 = { WEAPON: null, FRAME: null, BOOSTER: null, CORE: null };
const baseCache = new Map();
/* 기준 능력치 — Lv.BRAWL.level · 파츠 · 서킷 없음 · 스킬 +0 · 피로 0. 보유와 무관하게 모두 같다 */
export function baseStats(type) {
  const key = type + '@' + BRAWL().level;
  if (!baseCache.has(key)) baseCache.set(key, computeStats({ type, level: BRAWL().level, skillLv: 0, fat: 0, slots: E0 }, []));
  return { ...baseCache.get(key) };
}

/* 보드 → 팀전 명세(js/brawl-sim.js runBrawl 의 p · e). 칸 번호를 그대로 둔다(빈칸 null).
   opts.off = 끌 시너지 key 목록 — 밸런스 도구가 '그 시너지가 없었다면' 을 다시 싸워 본다(운영은 안 쓴다) */
export function teamOf(board, opts) {
  const B = BRAWL(), off = (opts && opts.off) || [], syn = synergiesOf(board).filter(s => !off.includes(s.key));
  const all = {}; for (const s of syn) if (s.key !== 'family') all[s.key] = s.v;
  return (board || []).slice(0, B.board).map(u => {
    if (!u || !ROBOT_TYPES[u.type]) return null;
    const st = baseStats(u.type), k = Math.max(1, Math.min(3, u.star || 1)) - 1;
    const nm = (B.norm && B.norm[rarityOf(u.type)]) || 1;          // 등급 보정(③) — 등급 사이 체급을 가격에 맞춘다
    st.hp = st.hp * nm * B.star.hp[k]; st.atk = st.atk * nm * B.star.atk[k];
    for (const s of syn) if (s.key === 'family' && s.types.includes(u.type)) { st.hp *= 1 + s.v; st.atk *= 1 + s.v; }
    if (all.mark) st.atk *= 1 + all.mark;
    if (all.drain) st.def *= 1 + all.drain;
    if (all.jam) st.spd *= 1 + all.jam;
    if (all.execute) st.crit = (st.crit || 0) + all.execute;
    if (all.flurry) st.eva = (st.eva || 0) + all.flurry;
    if (all.repair) st.regenT = (st.regenT || 0) + all.repair;
    if (all.breach) { st.pen = Math.max(st.pen || 0, all.breach); st.penAmt = Math.max(st.penAmt || 0, 0.4); }
    if (all.precise) st.skillMul = (st.skillMul || 1) * (1 + all.precise);
    st.hp = Math.round(st.hp); st.atk = Math.round(st.atk); st.def = Math.round(st.def); st.spd = Math.round(st.spd * 100) / 100;
    const m = { name: ROBOT_TYPES[u.type].name, type: u.type, star: u.star || 1, stats: st, tactic: 'none' };
    if (all.shield) m.shield = st.hp * all.shield;
    return m;
  });
}

/* ── 봇 ───────────────────────────────────────────────── */
/* 기체 하나의 값어치(봇이 고르고 세우는 기준) — 산 값 × 별 */
function worth(u) { return priceOf(u.type) * copiesIn(u.star) * (u.star === 3 ? 1.5 : 1); }

/* 봇 전략 — 사람의 몇 가지 버릇을 흉내 낸다. ③ 밸런스 도구가 전략끼리 붙여 한쪽이 독주하지 않는지 본다.
     value  합성 → 가진 기체 → 비싼 기체. 이자 10 을 남긴다
     syn    value 에 '보드 시너지를 켜거나 올리는 기체' 를 얹고, 시너지가 많이 켜지게 세운다
     econ   이자를 20 까지 모으고 거의 굴리지 않는다
     roll   골드를 남기지 않고 짝을 찾아 굴린다 */
export const BOT_STYLES = {
  value: { keep: 1, syn: 0, roll: 0.6, pairOnly: false },
  syn:   { keep: 1, syn: 3, roll: 0.6, pairOnly: false },
  econ:  { keep: 2, syn: 0, roll: 0.15, pairOnly: false },
  roll:  { keep: 0, syn: 0, roll: 1, pairOnly: false },
};

/* 봇 배치 — 가진 기체 중 넷을 고른다(값어치 합 + 켜지는 시너지 × synW). 그중 내구가 큰 둘을 앞줄로. 나머지는 대기석 */
export function botArrange(run0, synW = 0) {
  const run = clone(run0), all = units(run).sort((a, b) => worth(b) - worth(a) || (a.type < b.type ? -1 : 1));
  const n = run.board.length;
  let top = all.slice(0, n);
  if (synW > 0 && all.length > n) {
    const score = g => g.reduce((s, u) => s + worth(u), 0) + synW * synergiesOf(g).reduce((s, x) => s + x.tier, 0);
    let best = score(top);
    const pick = (from, g) => {
      if (g.length === n) { const v = score(g); if (v > best) { best = v; top = g.slice(); } return; }
      for (let k = from; k <= all.length - (n - g.length); k++) { g.push(all[k]); pick(k + 1, g); g.pop(); }
    };
    pick(0, []);
  }
  const rest = all.filter(u => !top.includes(u));
  const hp = u => baseStats(u.type).hp * BRAWL().star.hp[u.star - 1];
  top = top.slice().sort((a, b) => hp(b) - hp(a) || (a.type < b.type ? -1 : 1));
  run.board = Array(n).fill(null).map((_, i) => top[i] || null);
  run.bench = Array(run.bench.length).fill(null).map((_, i) => rest[i] || null);
  return run;
}

/* 봇 한 라운드 — 전략(style)대로 사고 · 굴리고 · 대기석이 차면 가장 싼 기체를 판다. 마지막에 다시 세운다 */
export function botTurn(run0, rnd, style = 'value') {
  let run = run0;
  const ST = BOT_STYLES[style] || BOT_STYLES.value;
  const I = BRAWL().income, keep = run.round >= 3 ? I.interestPer * ST.keep : 0;
  for (let guard = 0; guard < 40; guard++) {
    const have = {}; for (const u of units(run)) have[u.type + '|' + u.star] = (have[u.type + '|' + u.star] || 0) + 1;
    const tagsNow = {}; for (const u of run.board) if (u) for (const k of tagsOf(u.type)) tagsNow[k] = 1;
    const onBoard = new Set(run.board.filter(Boolean).map(u => u.type));
    const synBonus = t => ST.syn && !onBoard.has(t) ? tagsOf(t).filter(k => tagsNow[k]).length * 12 * ST.syn : 0;
    const pairScore = t => have[t + '|1'] >= 2 ? 100 : have[t + '|1'] ? 50 : 0;
    const score = t => pairScore(t) + priceOf(t) * 10 + synBonus(t) + rnd();
    const opts = run.shop.map((t, i) => ({ t, i })).filter(o => o.t && priceOf(o.t) <= run.gold)
      .filter(o => !ST.pairOnly || pairScore(o.t) >= 50 || units(run).length < run.board.length)
      .sort((a, b) => score(b.t) - score(a.t));
    let done = false;
    for (const o of opts) {
      const spare = run.gold - priceOf(o.t) >= keep || pairScore(o.t) >= 100;
      if (!spare) continue;
      let r = act(run, { t: 'buy', i: o.i });
      if (r.error === 'full') {
        const cheap = run.bench.map((u, i) => ({ u, i })).filter(x => x.u).sort((a, b) => worth(a.u) - worth(b.u))[0];
        if (cheap && worth(cheap.u) < priceOf(o.t) + (pairScore(o.t) >= 50 ? 2 : 0)) {
          run = act(run, { t: 'sell', where: 'bench', i: cheap.i }).run; r = act(run, { t: 'buy', i: o.i });
        }
      }
      if (r.run) { run = r.run; done = true; break; }
    }
    if (done) continue;
    if (run.gold - BRAWL().shop.reroll >= keep + (ST.keep ? 2 : 0) && rnd() < ST.roll) { const r = act(run, { t: 'reroll' }); if (r.run) { run = r.run; continue; } }
    break;
  }
  return botArrange(run, ST.syn);
}

/* 봇 보드 — 그 라운드까지 봇이 런을 돈 결과. 전투 결과는 이길 확률 winP 로 정한다(유령 보드를 채우는 용도).
   pool 이 없으면 C 전부 + 무작위 대여 3 → 봇마다 조합이 다르다 */
export function botRun({ seed, round, pool, winP = 0.5, style = 'value' }) {
  const rnd = mulberry32(h32('bot', seed));
  let rentals = pool;
  if (!rentals) {
    const cand = brawlTypes().filter(t => rarityOf(t) !== 'C').sort();
    rentals = []; while (rentals.length < BRAWL().deck) { const t = cand[Math.floor(rnd() * cand.length)]; if (!rentals.includes(t)) rentals.push(t); }
  }
  let run = newRun({ seed, owned: rentals, rentals: [], deck: rentals });
  while (!run.done && run.round < round) {
    run = botTurn(run, rnd, style);
    run = settle(run, rnd() < winP).run;
  }
  if (!run.done) run = botTurn(run, rnd, style);
  return run;
}
