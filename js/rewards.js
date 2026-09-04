/* 전투 보상·상대 생성 — 순수 함수. DOM 도 전역 상태도 참조하지 않는다.
 *
 * 클라이언트와 Worker 가 같은 파일을 import 한다. 서버가 판정하고 클라는 재생만 하지만,
 * 오프라인 연습 모드나 검증 도구가 같은 규칙을 쓸 수 있어야 하므로 순수하게 유지한다.
 */
import { ROBOT_TYPES, MONSTER_TYPES, ROBOT_RARITY, CONST } from '../data/balance.js';
import { pick, ri, weighted, genPart, autoScrapValue, BY_RARITY } from './gacha.js';

export const RIDX = { C: 0, UC: 1, R: 2, UQ: 3, EP: 4 };

export const MONSTER_BY_RARITY = (() => {
  const m = {};
  for (const k in MONSTER_TYPES) { const r = MONSTER_TYPES[k].rarity; (m[r] = m[r] || []).push(k); }
  return m;
})();

const CALLSIGNS = ['NOVA','RAZE','ORCA','KITE','VULT','ZERO','ONYX','HELM','SABLE','ARC','GEIST','ROOK'];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/* 상대 등급 — 내가 가진 최고 등급보다 한 단계 위까지만 만난다.
   후보가 없는 등급이 걸리면(BOSS 처럼 봉인된 것) 커먼으로 떨어뜨린다. */
export function pickOpponentType(ownedRarities, byRarity, rnd) {
  const best = Math.max(0, ...ownedRarities.map(r => RIDX[r] ?? 0));
  const pool = ROBOT_RARITY.filter(r => RIDX[r.k] <= Math.min(4, best + 1));
  const k = weighted(pool, rnd).k;
  const list = byRarity[k] && byRarity[k].length ? byRarity[k] : byRarity.C;
  return pick(list, rnd);
}

/* 상대 한 명. 몬스터는 파츠를 갖지 않는다. */
export function makeOpponent(ownedRarities, myLevel, rnd, uid, forceMonster) {
  const monster = forceMonster || rnd() < CONST.MONSTER_RATE;
  const type = pickOpponentType(ownedRarities, monster ? MONSTER_BY_RARITY : BY_RARITY, rnd);
  const level = clamp(myLevel + ri(-2, 2, rnd), 1, CONST.MAXLV);

  if (monster) {
    return { kind: 'monster', type, level, parts: [],
             slots: { WEAPON: null, FRAME: null, BOOSTER: null, CORE: null },
             callsign: MONSTER_TYPES[type].name };
  }
  const parts = [], slots = { WEAPON: null, FRAME: null, BOOSTER: null, CORE: null };
  const np = ri(0, 2, rnd);
  for (let i = 0; i < np; i++) {
    const p = genPart(level, rnd, uid());
    parts.push(p); slots[p.slot] = p.uid;
  }
  return { kind: 'robot', type, level, parts, slots,
           callsign: pick(CALLSIGNS, rnd) + '-' + ri(10, 99, rnd) };
}

/* 승패에 따른 보상 굴림. 상태를 바꾸지 않고 '무엇을 줄지'만 돌려준다.
   경험치·피로도는 기체 행을 직접 만져야 해서 부르는 쪽(stats.js gainExp/addFat)이 맡는다. */
export function rollBattleRewards(win, enemyLv, rnd, uid) {
  const expGain = win ? battleExpFor(enemyLv) : Math.round(battleExpFor(enemyLv) * 0.35);
  const fatAdd  = win ? 3 + ri(0, 2, rnd) : 7 + ri(0, 3, rnd);

  if (!win) return { win: false, cr: 40 + ri(0, 20, rnd), sc: 6, core: 0, part: null, expGain, fatAdd };

  const cr = 120 + enemyLv * 14 + ri(0, 40, rnd);
  let sc = 18 + ri(0, 14, rnd);
  const core = rnd() < 0.20 ? 1 : 0;
  let part = null;
  if (rnd() < 0.09) {                       // 예전 0.35 의 약 1/4
    const p = genPart(enemyLv, rnd, uid());
    const auto = autoScrapValue(p.rarity);
    if (auto) sc += auto; else part = p;    // 잡템은 행을 만들지 않는다
  }
  return { win: true, cr, sc, core, part, expGain, fatAdd };
}

/* stats.js 의 battleExp 와 같은 식. 순환 import 를 피하려고 여기 둔다. */
export const battleExpFor = enemyLv => 26 + enemyLv * 9;
