/* 숙련 조각 — 순수 규칙. DOM 도 전역 상태도 없다. 서버와 화면이 같이 import 한다.
 *
 * 2026-09-23 사용자 결정 — **기체를 키우면 개발 목표의 조각이 쌓인다.**
 * 하위 등급 기체를 굴릴 이유를 만들려고 넣었다. 기체를 녹이지 않는다(키운 것은 그대로 남는다).
 *
 *   · 쌓이는 양은 **레벨에서 나온다** — 5레벨마다 1 · 만렙에 2 더 = Lv.60 에 14 (CONST.MASTERY.shard)
 *   · 조각은 **계정의 개발 목표 하나**로 모인다. 어느 기체를 키우든 같은 목표로 들어간다
 *   · 이미 정산한 레벨(robot.m_lv)까지는 다시 주지 않는다. 레벨이 내려가는 길은 없다
 *   · 목표를 바꾸면 **앞으로 쌓일 곳만** 바뀐다 — 이미 받은 조각은 그 기체의 조각으로 남는다
 *
 * 왜 '기체마다 제 다음 칸' 이 아니라 목표 하나인가 — 90일 경제(tools/play.mjs)로 재 보니
 * 플레이어는 주력 한 기만 만렙으로 키우고 나머지는 Lv.1 근처에 둔다. 기체마다 다른 칸에 쌓으면
 * 90일에 조각 23~34개가 흩어져 **한 기체도 열리지 않았다**(mOpen 0). 목표 하나로 모으면 열린다.
 *
 * 목표를 고르는 화면은 UI 개편에서 나온다(main 은 화면 동결). 그때까지는 서버가 autoGoal 로 고른다.
 */
import { CONST, ROBOT_TYPES } from '../data/balance.js';
import { canDevelop } from './lineage.js';
import { shardKey } from './shop.js';

const RARS = ['C', 'UC', 'R', 'UQ', 'EP'];
const conf = () => (CONST.MASTERY || {}).shard || { every: [[5, 1]], maxBonus: 2 };

/* 그 레벨까지 쌓인 조각 총수 */
export function shardsAt(level) {
  const M = conf(), MAX = CONST.MAXLV || 60;
  const lv = Math.max(0, Math.min(MAX, level | 0));
  let n = 0;
  for (const [step, k] of M.every) n += Math.floor(lv / step) * k;
  if (lv >= MAX) n += M.maxBonus | 0;
  return n;
}

/* from 레벨까지 이미 받았을 때, to 레벨에서 새로 나오는 조각 */
export const shardGain = (from, to) => Math.max(0, shardsAt(to) - shardsAt(from));

/* 이 기체를 개발 목표로 삼을 수 있나 — 계보가 열어 준 것, 아직 없는 것, 스토리가 아닌 것 */
export function goalOk(type, owned) {
  const T = ROBOT_TYPES[type];
  if (!T || T.story) return false;
  const have = owned instanceof Set ? owned : new Set(owned || []);
  if (have.has(type)) return false;
  return canDevelop(type, have).ok;
}

/* 목표가 없을 때 서버가 고르는 기본 목표 — 열 수 있는 것 중 **가장 등급이 높은 것**,
   같으면 기체 id 순. 화면이 생기면 플레이어가 고른다. */
export function autoGoal(owned) {
  const have = owned instanceof Set ? owned : new Set(owned || []);
  const cands = Object.keys(ROBOT_TYPES).filter(t => goalOk(t, have));
  cands.sort((a, b) => (RARS.indexOf(ROBOT_TYPES[b].rarity) - RARS.indexOf(ROBOT_TYPES[a].rarity)) || (a < b ? -1 : 1));
  return cands[0] || null;
}

/* 정산 — 레벨이 오른 만큼 목표 조각을 준다. 서버가 상태를 읽을 때 한 번 부른다.
   robots: [{ id, uid, type, level, mLv }] · owned: 가진 기체 type · items: 보관함({ 'shard:<id>': n })
   돌려주는 것 { goal, items, grants, total, changed } — changed 가 false 면 쓸 것이 없다.
   items 는 **새 객체**다(받은 것을 고치지 않는다). */
export function settleMastery(robots, owned, items, goal) {
  const have = owned instanceof Set ? owned : new Set(owned || []);
  const use = goalOk(goal, have) ? goal : autoGoal(have);
  const out = { ...(items || {}) };
  const grants = [];
  let total = 0;
  for (const r of robots || []) {
    const lv = r.level | 0;
    /* m_lv 가 비었으면 **Lv.1 부터** — 새로 만든 기체는 항상 Lv.1 이다(뽑기 · 조립 · 첫 기체).
       이관 022 가 그전 행을 지금 레벨로 채웠으므로 옛 기체에 소급되지 않는다.
       동기화로 들어오는 행은 서버가 넣을 때 m_lv 를 그 레벨로 박는다(클라가 적은 레벨로 조각을 못 만든다). */
    const from = r.mLv == null ? 1 : Math.min(lv, Math.max(1, r.mLv | 0));
    const n = use ? shardGain(from, lv) : 0;
    if (n > 0) { total += n; grants.push({ id: r.id, uid: r.uid, type: r.type, from, to: lv, n }); }
    /* 목표가 없으면 정산하지 않고 둔다 — 다음에 목표가 생겼을 때 그대로 받는다 */
    if (use && from !== lv) r.mLvNext = lv;
  }
  if (use && total) out[shardKey(use)] = (out[shardKey(use)] | 0) + total;
  return { goal: use, items: out, grants, total, changed: !!use && (total > 0 || use !== goal) };
}

/* 화면용 한 장 — 목표 · 그 기체에 모인 조각 · 필요한 수 · 기체마다 다음 조각까지 남은 레벨 */
export function masteryView(robots, items, goal) {
  const need = (CONST.SHARD_NEED || {})[(ROBOT_TYPES[goal] || {}).rarity] || 0;
  const MAX = CONST.MAXLV || 60;
  return {
    goal: goal || null,
    have: goal ? ((items || {})[shardKey(goal)] | 0) : 0,
    need,
    robots: (robots || []).map(r => {
      const lv = r.level | 0;
      let next = null;
      for (let l = lv + 1; l <= MAX; l++) if (shardsAt(l) > shardsAt(lv)) { next = l; break; }
      return { uid: r.uid, type: r.type, level: lv, got: shardsAt(lv), nextAt: next };
    }),
  };
}
