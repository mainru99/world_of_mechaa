/* 조각 회수 작전 — 순수 규칙. (2026-09-25 사용자 지시)
 *
 * 개발 목표의 조각이 들어오는 **두 번째 길**이다. 첫째는 레벨(js/mastery.js).
 * 하루 CONST.SALVAGE.daily(2) 번. 난이도 셋 중 하나를 골라 몬스터 하나와 싸우고, 이기면 그 난이도의 조각을 받는다.
 * 지면 횟수만 쓴다 — '어디까지 올려 볼까' 가 이 작전의 결정이다.
 *
 * 상대는 **날짜 · 난이도에서만** 나온다. 같은 날 같은 난이도면 누구에게나 같은 몬스터다(레벨만 내 기체를 따른다).
 * 싸움의 시드는 서버가 굴린다 — 같은 판을 다시 눌러 운을 고르는 길이 없도록 횟수가 곧 값이다.
 *
 * 브라우저와 Worker 가 같이 import 한다. DOM 을 참조하지 않는다.
 */
import { CONST, MONSTER_TYPES } from '../data/balance.js';
import { makeUnit, simulate } from './sim.js';
import { foeStats } from './trial.js';
import { dayOf } from './raid.js';

export { dayOf };
export const SALV = () => CONST.SALVAGE || { daily: 2, tiers: [] };
export const salvDaily = () => SALV().daily | 0;

/* 보스가 아닌 몬스터 — 시련과 같은 이유(보스는 이름을 감춘다) */
const FOES = Object.keys(MONSTER_TYPES).filter(k => MONSTER_TYPES[k].rarity !== 'BOSS').sort();

function hash(a, b) {
  let h = 2166136261 ^ (a | 0);
  h = Math.imul(h ^ (b | 0), 16777619);
  h = Math.imul(h ^ (h >>> 13), 2246822519);
  h = Math.imul(h ^ (h >>> 16), 3266489917);
  return (h ^ (h >>> 16)) >>> 0;
}

/* 저장된 칸 → 오늘 한 횟수. 날이 바뀌었으면 0 */
export function salvUsed(raw, now) {
  let o = raw;
  if (typeof raw === 'string') { try { o = JSON.parse(raw); } catch { o = null; } }
  if (!o || typeof o !== 'object') return 0;
  return (o.d | 0) === dayOf(now) ? Math.max(0, o.n | 0) : 0;
}
export const salvLeft = (raw, now) => Math.max(0, salvDaily() - salvUsed(raw, now));
export const salvNext = (raw, now) => JSON.stringify({ d: dayOf(now), n: salvUsed(raw, now) + 1 });

/* 오늘 그 난이도의 상대. level 은 내 기체 레벨 — 상대는 **같은 레벨**이고 난이도는 배수(mul)로 건다.
   레벨로 걸면 만렙(60)에서 더 올릴 수 없어 윗 난이도가 아랫 난이도와 같아진다 */
export function salvFoe(day, tier, level) {
  const T = SALV().tiers[tier];
  if (!T) return null;
  const type = FOES[hash(day, tier + 1) % FOES.length];
  const lv = Math.max(1, Math.min(CONST.MAXLV, level | 0));
  return { tier, ko: T.ko, shard: T.shard | 0, type, level: lv, mul: T.mul || 1 };
}

/* 화면용 — 오늘 남은 횟수와 난이도별 상대 */
export function salvView(raw, now, level) {
  const day = dayOf(now);
  return { day, endsAt: (day + 1) * 86400000, daily: salvDaily(), left: salvLeft(raw, now),
           tiers: SALV().tiers.map((_, i) => salvFoe(day, i, level)) };
}

/* 한 판. 스탯을 받아 결과만 돌려준다 — 조각을 넣거나 횟수를 쓰는 것은 부르는 쪽(서버)의 일이다.
   클라는 같은 함수 · 같은 시드로 재생만 한다 */
export function runSalvage(myStats, foe, seed) {
  const fs = foeStats({ type: foe.type, level: foe.level });
  const m = foe.mul || 1;                                // 체력 · 공격에만 — 방어 · 속도까지 걸면 배수보다 훨씬 세진다
  fs.hp = Math.round(fs.hp * m); fs.atk = Math.round(fs.atk * m);
  const P = makeUnit('나', null, myStats, 'none');
  const E = makeUnit(MONSTER_TYPES[foe.type].name, foe.type, fs);
  const ev = simulate(P, E, seed >>> 0);
  return { ev, win: P.hp > 0 && E.hp <= 0, foe: fs };
}
