/* 주간 시련 — 순수 규칙.
 *
 * 무엇을 푸는가 — 파츠 개편으로 37,000종짜리 파밍이 생겼는데, **만든 빌드를 시험할
 * 자리가 없다.** 아레나는 매번 상대가 다르고 보상이 걸려 있어서 '이 조합이 나은가'를
 * 견줄 수 없다. 여기서는 상대가 일주일 내내 고정이다.
 *
 * 핵심 규칙 하나 — **결정적이다.**
 *   시드가 주(週)에서만 나오므로 같은 빌드로 다시 눌러도 점수가 똑같다.
 *   그래서 점수를 올리는 유일한 길이 **빌드를 바꾸는 것**이다. 다시 굴려서 운으로
 *   올리는 길을 아예 없애려고 이렇게 잡았다. 그 대신 횟수 제한도, 출격비도, 피로도도
 *   없다 — 시험대이지 콘텐츠 소모가 아니다.
 *
 * 브라우저와 Worker 가 같이 import 한다. DOM 을 참조하지 않는다.
 */
import { CONST, TERRAIN, MONSTER_TYPES } from '../data/balance.js';
import { makeUnit, simulate, mulberry32 } from './sim.js';
import { applyTerrain } from './breach.js';

/* 주 번호 — 2026-01-05(월) 00:00 UTC 를 0주로 센다.
   월요일을 고른 이유: 주가 바뀌는 순간이 사람들이 가장 덜 하는 때다. */
export const TRIAL_EPOCH = Date.UTC(2026, 0, 5);
export const WEEK_MS = 7 * 24 * 3600 * 1000;
export const weekOf = now => Math.floor((now - TRIAL_EPOCH) / WEEK_MS);
export const weekStart = w => TRIAL_EPOCH + w * WEEK_MS;
export const weekEnd = w => weekStart(w + 1);

/* 주 번호 하나에서 시드를 뽑는다. 곱셈 해시라 이웃한 주가 비슷한 값이 되지 않는다. */
function weekSeed(week) {
  let h = 2166136261 ^ (week | 0);
  h = Math.imul(h ^ (h >>> 13), 2246822519);
  h = Math.imul(h ^ (h >>> 16), 3266489917);
  return (h ^ (h >>> 16)) >>> 0;
}

/* 이번 주 상대는 '보스가 아닌 몬스터' 중에서 고른다.
   보스는 파견의 마지막 관문이라 이름을 감추고 있다(renderHunt 의 ???). 여기서
   이름과 수치를 그대로 보여 주면 그 감춤이 뜻을 잃는다. */
const FOES = Object.keys(MONSTER_TYPES)
  .filter(k => MONSTER_TYPES[k].rarity !== 'BOSS').sort();
const TERRS = Object.keys(TERRAIN).sort();

/* 이번 주 시련. 주 번호만 있으면 누구나 같은 값을 얻는다 —
   서버가 정해서 내려 주지 않고 양쪽이 각자 계산한다. */
export function trialOf(week) {
  const rnd = mulberry32(weekSeed(week));
  const terrain = TERRS[Math.floor(rnd() * TERRS.length)];
  const type = FOES[Math.floor(rnd() * FOES.length)];
  /* 레벨은 만렙 근처에서 흔들린다. 낮은 레벨 계정도 들어올 수는 있지만 점수가 낮을
     뿐이다 — 잠그지 않는 이유는 '지금 내 빌드가 어디쯤인가'를 보는 자리이기 때문이다. */
  const level = Math.max(1, Math.min(CONST.MAXLV, Math.round(CONST.MAXLV * (0.8 + rnd() * 0.2))));
  return { week, terrain, type, level, seed: weekSeed(week) };
}

/* 상대 능력치. 몬스터 표에서 그대로 자란다 — 기체와 같은 곡선을 쓴다. */
export function foeStats(t) {
  const M = MONSTER_TYPES[t.type];
  const lv = t.level;
  const s = {};
  for (const k of ['hp', 'atk', 'def', 'spd']) s[k] = M.base[k] + (M.grow[k] || 0) * (lv - 1);
  s.atk *= CONST.ATK_SCALE;
  s.crit = M.base.crit; s.eva = M.base.eva;
  s.spread = M.spread != null ? M.spread : CONST.SPREAD;
  for (const k of ['hp', 'atk', 'def', 'spd']) s[k] = Math.round(s[k]);
  s.skillMul = 1;
  return s;
}

/* ── 점수 ─────────────────────────────────────────────────
   진 판도 점수가 나와야 한다. 0 이면 '아직 못 이기는 사람' 은 빌드를 고쳐도 나아진
   것이 안 보이고, 그러면 두 번째로 안 들어온다.

     짐   상대에게 준 피해 비율                0 ~  99,999
     이김 500,000 + 남은 체력(0~100,000) + 속공(0~60,000)

   그래서 이긴 판은 **언제나** 진 판보다 높고, 이긴 사람끼리는 덜 맞고 빨리 끝낸 쪽이
   높다. 둘 다 빌드가 정하는 값이다.

   두 항을 모두 '더하는 값' 으로 잡은 이유 — 처음에는 턴수를 빼는 식으로 썼는데,
   간신히 이긴 판(남은 체력 0.9% · 19턴)에서 뺀 값이 더한 값을 넘어 **499,991**,
   즉 승리 기준선 아래가 나왔다. 이긴 판이 패배로 읽혔다. 빼는 항이 있으면 언제나
   이 구멍이 생기므로 아예 두지 않는다. */
export const TRIAL_WIN_BASE = 500000;
export function trialScore(ev, P, E, maxP, maxE) {
  let turns = 0;
  for (const e of ev) if (e.t === 'turn') turns++;
  const win = P.hp > 0 && E.hp <= 0;
  if (!win) {
    const dealt = Math.max(0, 1 - Math.max(0, E.hp) / Math.max(1, maxE));
    return Math.min(99999, Math.round(dealt * 99999));
  }
  const left = Math.max(0, P.hp) / Math.max(1, maxP);
  const fast = Math.max(0, 60000 - turns * 500);        // 빨리 끝낼수록. 0 밑으로는 안 간다
  return TRIAL_WIN_BASE + Math.round(left * 100000) + fast;
}
export const trialWon = score => score >= TRIAL_WIN_BASE;

/* 한 번의 도전. 스탯을 받아 점수만 돌려준다 — 재화를 만지거나 행을 쓰는 것은
   부르는 쪽(서버)의 일이다. 클라는 같은 함수로 재생만 한다. */
export function runTrial(myStats, t, tactic) {
  const foe = applyTerrain(foeStats(t), t.terrain);
  const mine = applyTerrain(myStats, t.terrain);
  const P = makeUnit('나', null, mine, tactic);
  const E = makeUnit(MONSTER_TYPES[t.type].name, t.type, foe);
  /* 기체 고유 구간은 makeUnit 이 type 으로 찾는다. 내 쪽은 type 을 안 넘기므로
     applyTerrain 이 실어 준 spread 가 그대로 쓰인다. */
  const ev = simulate(P, E, t.seed);
  return { ev, P, E, score: trialScore(ev, P, E, mine.hp, foe.hp), foe, mine };
}
