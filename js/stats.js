/* 스탯 계산 — 순수 함수. DOM 도 전역 상태도 참조하지 않는다.
 * 서버가 파츠·전투력을 검증할 때 클라이언트와 같은 값을 얻어야 하므로
 * 여기에 들어오는 값은 전부 인자로 받는다. */
import { CONST } from '../data/balance.js';
import { COMBAT_TYPES, rarOf } from './units.js';

const { ATK_SCALE, FAT_MAX, MAXLV, SERVICE_RATE } = CONST;

/* 0~1 비율로 다루는 스탯. 레벨 배수를 타지 않고, 강화 배수도 다르게 먹는다. */
export const isPct = s => s === 'crit' || s === 'eva' || s === 'spread';
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export const SLOT_ORDER = ['WEAPON', 'FRAME', 'BOOSTER', 'CORE'];

/* 피로도: 쌓인 만큼 최대 체력이 줄어든다 */
export const fatOf = rb => clamp(rb.fat | 0, 0, FAT_MAX);

/* ── 피로도 자연 회복 ────────────────────────────────────────
   rb.fatAt = '마지막으로 회복을 정산한 시각'. 경과 시간을 회복 주기로 나눠
   떨어진 만큼만 깎고, fatAt 을 그만큼만 앞당긴다(now 로 당기면 우수리가 날아간다). */
export const fatRecoverMs = rb =>
  (CONST.FAT_RECOVER_MIN + rb.level * CONST.FAT_RECOVER_LV) * 60000;

export function decayFat(rb, now){
  now = now || Date.now();
  if(rb.fatAt == null){ rb.fatAt = now; return 0; }
  if(fatOf(rb) === 0){ rb.fatAt = now; return 0; }
  const elapsed = now - rb.fatAt;
  if(elapsed < 0){ rb.fatAt = now; return 0; }      // 시계가 뒤로 간 경우
  const per = fatRecoverMs(rb);
  const pts = Math.floor(elapsed / per);
  if(pts <= 0) return 0;
  const before = fatOf(rb);
  rb.fat = clamp(before - pts, 0, FAT_MAX);
  rb.fatAt = rb.fat > 0 ? rb.fatAt + pts * per : now;
  return before - rb.fat;
}
/* 다음 1 회복까지 남은 ms. 피로도가 0이면 null */
export function fatNextMs(rb, now){
  now = now || Date.now();
  if(fatOf(rb) === 0) return null;
  if(rb.fatAt == null) return fatRecoverMs(rb);
  return Math.max(0, rb.fatAt + fatRecoverMs(rb) - now);
}
/* 출격비. 클라는 보여 주고 서버는 실제로 깎는다 — 같은 함수를 쓴다. */
export const sortieCost = rb =>
  Math.ceil(CONST.SORTIE.base + (rb.level | 0) * CONST.SORTIE.perLv);

export const serviceCost = rb =>
  Math.ceil(fatOf(rb) * SERVICE_RATE[rarOf(rb.type)] * (1 + rb.level * 0.03));

export const findPart = (u, parts) => parts.find(p => p.uid === u);

export function partStat(p) {
  const o = {}, e = p.enh || 0;
  for (const k in p.stats) o[k] = isPct(k) ? p.stats[k] * (1 + e * 0.08) : p.stats[k] * (1 + e * 0.12);
  if (o.atk) o.atk *= ATK_SCALE;          // 파츠 공격력도 같은 배율로 (표시값 = 실제 기여)
  return o;
}

/* ── 파츠 세트 ────────────────────────────────────────────
   계열은 파츠 '이름' 에서 나온다. 이름은 이미 DB 에 있고 PART_NAMES 안의 것으로
   제한되므로, 표만 두면 이미 가진 파츠가 그대로 계열을 얻는다 — 마이그레이션이 없다.
   같은 이름이 슬롯마다 다른 계열일 수 있으므로 열쇠는 '슬롯|이름' 이다. */
const SET_BY_NAME = (() => {
  const m = {}, P = CONST.PART_SET || {};
  for (const k in P) for (const slot in (P[k].names || {})) m[slot + '|' + P[k].names[slot]] = k;
  return m;
})();
export const setKeyOf = p => (p && SET_BY_NAME[p.slot + '|' + p.name]) || null;

/* 낀 네 칸에서 계열별로 몇 개인지 센다. { assault:2, fortress:1 } 같은 모양 */
export function setCounts(robot, parts) {
  const n = {};
  for (const slot of SLOT_ORDER) {
    const u = robot.slots && robot.slots[slot]; if (!u) continue;
    const p = findPart(u, parts || []); if (!p) continue;
    const k = setKeyOf(p); if (k) n[k] = (n[k] || 0) + 1;
  }
  return n;
}
/* 실제로 걸린 단계만. 4세트를 채우면 2세트도 함께 걸린다 */
export function setActive(counts) {
  const out = [], P = CONST.PART_SET || {};
  for (const k in counts) { const S = P[k]; if (!S) continue;
    for (const t of [2, 4]) if (counts[k] >= t && S['p' + t]) out.push({ key: k, ko: S.ko, tier: t, bonus: S['p' + t] });
  }
  return out;
}

export function computeStats(robot, parts) {
  parts = parts || [];
  const T = COMBAT_TYPES[robot.type], lv = robot.level, s = {};
  for (const k of ['hp', 'atk', 'def', 'spd']) s[k] = T.base[k] + (T.grow[k] || 0) * (lv - 1);
  s.atk *= ATK_SCALE;                     // 기체 공격력 배율
  s.crit = T.base.crit; s.eva = T.base.eva;
  /* 기체 고유 구간을 먼저 깔아 두면 아래 파츠 합산이 그대로 얹힌다 */
  s.spread = T.spread != null ? T.spread : CONST.SPREAD;
  for (const slot of SLOT_ORDER) {
    const u = robot.slots[slot]; if (!u) continue;
    const p = findPart(u, parts); if (!p) continue;
    const ps = partStat(p); for (const k in ps) s[k] = (s[k] || 0) + ps[k];
  }
  /* 세트 보너스는 파츠 합산이 끝난 **뒤에** 곱한다. 먼저 곱하면 파츠를 많이 낀 쪽이
     세트 이득까지 더 크게 먹어 두 번 보상받는다. 전투 규칙은 건드리지 않는다 —
     여기서 끝나므로 sim.js 도 서버 코드도 손댈 것이 없다. */
  s.sets = setCounts(robot, parts);
  for (const a of setActive(s.sets)) {
    if (a.bonus.mul) for (const k in a.bonus.mul) s[k] = (s[k] || 0) * a.bonus.mul[k];
    if (a.bonus.add) for (const k in a.bonus.add) s[k] = (s[k] || 0) + a.bonus.add[k];
  }
  for (const k of ['hp', 'atk', 'def', 'spd']) s[k] = Math.round(s[k]);
  /* 파츠의 대가(SLOT_COST)가 겹치면 스탯이 0 밑으로 내려간다 —
     무장과 코어가 둘 다 속도를 깎으므로 느린 기체에 둘을 끼우면 실제로 음수가 된다.
     그때 simulate 의 게이지 계산 (100 - g) / spd 가 뒤집혀 전투가 성립하지 않고,
     powerOf 는 음수의 제곱근이라 NaN 을 낸다(실측: 생성 상대 4만 중 133건).
     여기서 바닥을 깔아 둔다. 대가를 무르게 하는 것이 아니라 계산을 성립시키는 것이다. */
  s.spd = Math.max(1, s.spd);
  s.def = Math.max(0, s.def);
  s.atk = Math.max(1, s.atk);
  s.hpFull = s.hp;                                                  // 피로도 0 일 때의 최대 체력
  s.hp = Math.max(1, Math.round(s.hp * (100 - fatOf(robot)) / 100)); // 피로도만큼 최대 체력이 줄어든다
  s.crit = clamp(s.crit, 0, .75); s.eva = clamp(s.eva, 0, .6);
  s.spread = clamp(s.spread, CONST.SPREAD_MIN, CONST.SPREAD_MAX);
  /* 스킬 강화는 스탯이 아니라 **스킬 배수**에 붙는다. 여기에 실어 두면
     makeUnit → doSkill 로 그대로 따라가므로 sim 의 전투 규칙은 손대지 않아도 된다. */
  s.skillMul = skillMul(robot.skillLv);
  return s;
}

/* 표시용 공격력 구간. 피해는 최종적으로 (1±spread) 배가 되므로
   공격력을 그 폭으로 늘려 보여 주는 것이 실제 위력과 정확히 같다. */
export function atkRange(st) {
  const sp = st.spread != null ? st.spread : CONST.SPREAD;
  return [Math.round(st.atk * (1 - sp)), Math.round(st.atk * (1 + sp))];
}

/* 전투력.
 *
 * 예전에는 스탯을 가중합했다. 그런데 실제 전투에서 스탯 우위는 더해지지 않고 **곱해진다** —
 * 공격력이 5% 높고 속도가 5% 높고 내구가 5% 높으면 실질 우위는 15% 가 아니라 16% 를 넘는다.
 * 그래서 가중합은 격차를 심하게 줄여 보여 줬다. Lv.60 커먼과 언커먼의 표시 차이가 1.7% 인데
 * 실제 승률은 32:68 이었다 — 숫자가 플레이어에게 거짓말을 하고 있었다.
 *
 * 지금은 공격력(공격 × 속도 × 치명타 기대치)과 생존력(내구 × 방어 × 회피)을 각각 곱으로 묶고
 * 그 기하평균을 쓴다. 전투의 구조와 같은 모양이라, 표시된 격차가 체감 격차와 맞는다.
 * 매칭도 이 값의 ±15% 로 상대를 찾으므로 이게 맞아야 대전이 공정해진다.
 *
 * K 는 눈금일 뿐이다 — 커먼 Lv.30 이 대략 3100 으로 보이게 맞춰 두었다. */
const POWER_K = 0.115;
/* 계산된 스탯 하나로 전투력. 점령전 방어자처럼 robot+parts 원본이 없는 쪽이 쓴다. */
export function powerOf(s) {
  const off = s.atk * (1 + s.crit * (CONST.CRIT_MULT - 1)) * s.spd;
  const sur = s.hp * (1 + s.def / 100) / Math.max(0.4, 1 - s.eva);
  return Math.round(Math.sqrt(off * sur) * POWER_K);
}
export const power = (robot, parts) => powerOf(computeStats(robot, parts));

/* 육성 곡선 */
export const expNeed   = lv => Math.round(60 + lv * lv * 1.6 + lv * 22);  // lv → lv+1 에 필요한 경험치
export const battleExp = enemyLv => 26 + enemyLv * 9;                     // 승리 시 획득(패배는 35%)
export const lvCost    = lv => Math.round(80 + lv * lv * 4 + lv * 40);
export const enhCost   = e => (e + 1) * 18;

/* 스킬 강화 — 비용과 성공 확률. 서버(판정)와 클라(표시)가 같은 함수를 쓴다.
   두 벌로 두면 화면에 적힌 확률과 실제로 굴리는 확률이 갈린다. */
export const skillMax  = () => CONST.SKILL_UP.max;
export const skillCost = (lv, robotLevel) => {
  const S = CONST.SKILL_UP;
  return {
    cr: Math.round((S.crBase + lv * S.crLv) * (1 + (robotLevel || 1) * 0.02)),
    sc: Math.round(S.scBase + lv * S.scLv),
  };
};
export const skillRate = lv => {
  const r = CONST.SKILL_UP.rate;
  return lv >= r.length ? 0 : r[lv];
};
/* 스킬 배수에 곱해지는 값. 0강이면 1 이다. */
export const skillMul = lv => 1 + Math.max(0, lv | 0) * CONST.SKILL_UP.mult;

export function gainExp(rb, amt) {        // 경험치를 넣고, 차면 자동으로 레벨업
  const from = rb.level;
  if (rb.level >= MAXLV) { rb.exp = 0; return { amt: 0, from, to: from }; }
  rb.exp = Math.max(0, (rb.exp || 0) + amt);   // 음수로 내려가지 않게
  while (rb.level < MAXLV && rb.exp >= expNeed(rb.level)) { rb.exp -= expNeed(rb.level); rb.level++; }
  if (rb.level >= MAXLV) rb.exp = 0;
  return { amt, from, to: rb.level };
}

export function addFat(rb, amt) {         // 대전 결과에 따라 피로도가 쌓인다
  decayFat(rb);                            // 쌓기 전에 그동안의 자연 회복을 먼저 반영
  if (fatOf(rb) === 0) rb.fatAt = Date.now();   // 0에서 다시 쌓이면 타이머도 지금부터
  const before = fatOf(rb);
  rb.fat = clamp(before + amt, 0, FAT_MAX);
  return rb.fat - before;
}
