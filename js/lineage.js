/* 개발 계보 — 순수 규칙. DOM 도 전역 상태도 없다. 서버와 화면이 같이 import 한다.
 *
 * 계보는 **조립해도 되는가**를 가른다(2026-09-23 사용자 결정). 데이터는 data/lineage.js.
 *   · C 는 뿌리 — 언제나 조립할 수 있다
 *   · 앞 기체가 있으면 **모두** 가져야 한다(합류)
 *   · 아종(family)의 표준형이 아닌 형제는 표준형을 가지면 열린다(분화)
 *   · 뽑기 입구 — C 가 아닌데 앞 기체도 분화도 없는 기체. 조각으로는 조립하지 못하고 뽑기로만 얻는다
 *   · 이미 가진 기체는 막지 않는다 — 조립하면 중복 보상(DUPE_GAIN)이 나올 뿐이다
 * 숙련(특성 포인트)은 레벨에서 나온다 — js/stats.js traitPoints.
 */
import { ROBOT_TYPES } from '../data/balance.js';
import { LINEAGE, LINEAGE_SIBS } from '../data/lineage.js';

export { LINEAGE, LINEAGE_SIBS };

const PARENTS = {}, CHILDREN = {}, SIB_STD = {}, SIB_KIDS = {};
for (const [a, b] of LINEAGE) { (PARENTS[b] ||= []).push(a); (CHILDREN[a] ||= []).push(b); }
for (const [std, kid] of LINEAGE_SIBS) { SIB_STD[kid] = std; (SIB_KIDS[std] ||= []).push(kid); }

export const parentsOf  = type => PARENTS[type] || [];
export const childrenOf = type => CHILDREN[type] || [];
export const siblingStd = type => SIB_STD[type] || null;        // 분화로 열리는 아종이면 그 표준형
export const siblingsOf = type => SIB_KIDS[type] || [];         // 표준형이면 분화로 여는 아종들

const T = type => ROBOT_TYPES[type];
export const isRoot = type => !!T(type) && !T(type).story && T(type).rarity === 'C';
export const isGachaEntry = type => !!T(type) && !T(type).story && !isRoot(type)
                                    && !parentsOf(type).length && !siblingStd(type);

/* 이 기체를 조각으로 조립해도 되는가.
   owned — 가진 기체 type 의 목록이나 Set.
   돌려주는 것 { ok, why, need } — why: 'owned' · 'root' · 'sibling' · 'parents' · 'gacha' · 'story' · 'unknown'
   need 는 아직 없는 앞 기체(또는 표준형) type 목록 */
export function canDevelop(type, owned) {
  const have = owned instanceof Set ? owned : new Set(owned || []);
  if (!T(type)) return { ok: false, why: 'unknown', need: [] };
  if (T(type).story) return { ok: false, why: 'story', need: [] };
  if (have.has(type)) return { ok: true, why: 'owned', need: [] };
  if (isRoot(type)) return { ok: true, why: 'root', need: [] };
  const std = siblingStd(type);
  if (std) return have.has(std) ? { ok: true, why: 'sibling', need: [] } : { ok: false, why: 'sibling', need: [std] };
  if (isGachaEntry(type)) return { ok: false, why: 'gacha', need: [] };
  const need = parentsOf(type).filter(p => !have.has(p));
  return { ok: !need.length, why: 'parents', need };
}

/* 지금 새로 개발할 수 있는 기체(아직 없는 것). 갈림길에서 고를 '개발 목표' 후보가 된다 */
export function developable(owned) {
  const have = owned instanceof Set ? owned : new Set(owned || []);
  return Object.keys(ROBOT_TYPES).filter(t => !have.has(t) && !isRoot(t) && canDevelop(t, have).ok);
}

/* 화면이 계보도를 칠할 한 장 — 기체마다 상태 하나.
   owned 가짐 · open 조각이 차면 조립 가능 · locked 앞 기체가 모자람 · gacha 뽑기로만 */
export function lineageView(owned) {
  const have = owned instanceof Set ? owned : new Set(owned || []);
  const out = {};
  for (const t of Object.keys(ROBOT_TYPES)) {
    if (T(t).story) continue;
    const c = canDevelop(t, have);
    out[t] = { state: have.has(t) ? 'owned' : c.ok ? 'open' : c.why === 'gacha' ? 'gacha' : 'locked',
               need: c.need, parents: parentsOf(t), children: childrenOf(t),
               std: siblingStd(t), sibs: siblingsOf(t) };
  }
  return out;
}
