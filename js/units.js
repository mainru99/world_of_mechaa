/* 유닛 조회 — 밸런스 데이터에서 파생되는 색인만 둔다.
 * data/balance.js 는 순수 데이터라 이런 파생 표를 담지 않는다(CONTRACT.md).
 * 기체/몬스터가 늘어도 이 파일은 고칠 필요가 없다 — 전부 데이터에서 뽑는다. */
import { ROBOT_TYPES, MONSTER_TYPES, ROBOT_RARITY } from '../data/balance.js';

/* 등급 색인 */
export const RR = {};
ROBOT_RARITY.forEach(r => RR[r.k] = r);
export const RIDX = { C:0, UC:1, R:2, UQ:3, EP:4 };

/* id 목록 — 스프라이트·검증이 이 값을 쓴다 */
export const ROBOT_IDS   = Object.keys(ROBOT_TYPES);
/* 스토리 기체(story:true)는 뽑기 · 상점 · 상대 · 도감 · 시작 기체에 나오지 않는다(2026-09-21).
   전투 · 스프라이트 · 스탯은 그대로 ROBOT_IDS 를 쓴다 — 나중에 얻게 되면 그대로 싸운다 */
export const isStory = id => !!(ROBOT_TYPES[id] && ROBOT_TYPES[id].story);
export const GACHA_IDS  = ROBOT_IDS.filter(id => !isStory(id));
export const MONSTER_IDS = Object.keys(MONSTER_TYPES);

/* 전투에서는 기체와 몬스터를 같은 규칙으로 다룬다.
   반대로 뽑기·격납고·소유는 ROBOT_TYPES 만 읽는다 — 그래서 몬스터가 샐 경로가 없다. */
export const COMBAT_TYPES = { ...ROBOT_TYPES, ...MONSTER_TYPES };

/* 등급별 id 목록 */
export const BY_RARITY = {};
for (const k in ROBOT_TYPES) {
  if (ROBOT_TYPES[k].story) continue;            // 스토리 기체는 등급 풀에 안 넣는다
  const r = ROBOT_TYPES[k].rarity;
  (BY_RARITY[r] = BY_RARITY[r] || []).push(k);
}
export const MONSTER_BY_RARITY = {};
for (const m of Object.values(MONSTER_TYPES)) {
  (MONSTER_BY_RARITY[m.rarity] = MONSTER_BY_RARITY[m.rarity] || []).push(m.id);
}

export const isMonster = type => !!MONSTER_TYPES[type];
export const rarOf     = type => (COMBAT_TYPES[type] || ROBOT_TYPES.mule).rarity;

/* id 가 두 표에 겹치면 에셋 경로가 갈려 조용히 잘못된 그림이 뜬다. 개발 중에만 경고. */
const dup = MONSTER_IDS.filter(id => id in ROBOT_TYPES);
if (dup.length) console.warn('[units] 기체/몬스터 id 충돌:', dup);
