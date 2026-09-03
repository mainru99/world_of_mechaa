/* 스탯 계산 — 순수 함수. DOM 도 전역 상태도 참조하지 않는다.
 * 서버가 파츠·전투력을 검증할 때 클라이언트와 같은 값을 얻어야 하므로
 * 여기에 들어오는 값은 전부 인자로 받는다. */
import { CONST } from '../data/balance.js';
import { COMBAT_TYPES, rarOf } from './units.js';

const { ATK_SCALE, FAT_MAX, MAXLV, SERVICE_RATE } = CONST;

export const isPct = s => s === 'crit' || s === 'eva';
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export const SLOT_ORDER = ['WEAPON', 'FRAME', 'BOOSTER', 'CORE'];

/* 피로도: 쌓인 만큼 최대 체력이 줄어든다 */
export const fatOf = rb => clamp(rb.fat | 0, 0, FAT_MAX);
export const serviceCost = rb =>
  Math.ceil(fatOf(rb) * SERVICE_RATE[rarOf(rb.type)] * (1 + rb.level * 0.03));

export const findPart = (u, parts) => parts.find(p => p.uid === u);

export function partStat(p) {
  const o = {}, e = p.enh || 0;
  for (const k in p.stats) o[k] = isPct(k) ? p.stats[k] * (1 + e * 0.08) : p.stats[k] * (1 + e * 0.12);
  if (o.atk) o.atk *= ATK_SCALE;          // 파츠 공격력도 같은 배율로 (표시값 = 실제 기여)
  return o;
}

export function computeStats(robot, parts) {
  parts = parts || [];
  const T = COMBAT_TYPES[robot.type], lv = robot.level, s = {};
  for (const k of ['hp', 'atk', 'def', 'spd']) s[k] = T.base[k] + (T.grow[k] || 0) * (lv - 1);
  s.atk *= ATK_SCALE;                     // 기체 공격력 배율
  s.crit = T.base.crit; s.eva = T.base.eva;
  for (const slot of SLOT_ORDER) {
    const u = robot.slots[slot]; if (!u) continue;
    const p = findPart(u, parts); if (!p) continue;
    const ps = partStat(p); for (const k in ps) s[k] = (s[k] || 0) + ps[k];
  }
  for (const k of ['hp', 'atk', 'def', 'spd']) s[k] = Math.round(s[k]);
  s.hpFull = s.hp;                                                  // 피로도 0 일 때의 최대 체력
  s.hp = Math.max(1, Math.round(s.hp * (100 - fatOf(robot)) / 100)); // 피로도만큼 최대 체력이 줄어든다
  s.crit = clamp(s.crit, 0, .75); s.eva = clamp(s.eva, 0, .6);
  return s;
}

export function power(robot, parts) {
  const s = computeStats(robot, parts);
  return Math.round(s.hp * 0.5 + s.atk * (3 / ATK_SCALE) + s.def * 2.6 + s.spd * 2.2 + s.crit * 320 + s.eva * 280);
}

/* 육성 곡선 */
export const expNeed   = lv => Math.round(60 + lv * lv * 1.6 + lv * 22);  // lv → lv+1 에 필요한 경험치
export const battleExp = enemyLv => 26 + enemyLv * 9;                     // 승리 시 획득(패배는 35%)
export const lvCost    = lv => Math.round(80 + lv * lv * 4 + lv * 40);
export const enhCost   = e => (e + 1) * 18;

export function gainExp(rb, amt) {        // 경험치를 넣고, 차면 자동으로 레벨업
  const from = rb.level;
  if (rb.level >= MAXLV) { rb.exp = 0; return { amt: 0, from, to: from }; }
  rb.exp = (rb.exp || 0) + amt;
  while (rb.level < MAXLV && rb.exp >= expNeed(rb.level)) { rb.exp -= expNeed(rb.level); rb.level++; }
  if (rb.level >= MAXLV) rb.exp = 0;
  return { amt, from, to: rb.level };
}

export function addFat(rb, amt) {         // 대전 결과에 따라 피로도가 쌓인다
  const before = fatOf(rb);
  rb.fat = clamp(before + amt, 0, FAT_MAX);
  return rb.fat - before;
}
