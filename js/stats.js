/* 스탯 계산 — 순수 함수. DOM 도 전역 상태도 참조하지 않는다.
 * 서버가 파츠·전투력을 검증할 때 클라이언트와 같은 값을 얻어야 하므로
 * 여기에 들어오는 값은 전부 인자로 받는다. */
import { CONST, SLOT_COST, RARITY, PART_BASES, AFFIXES, AFFIX_TIER, AFFIX_ROLL }
  from '../data/balance.js';
import { COMBAT_TYPES, rarOf } from './units.js';
/* 인챈트의 티어 안 굴림을 seed 에서 재현하는 데만 쓴다. sim.js 는 stats.js 를
   부르지 않으므로 순환이 아니다. */
import { mulberry32 } from './sim.js';

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
/* 비상 출격 보상은 출격비에 연동한다. 패배해도 다음 정상 출격 한 번은 보장한다. */
export const rescueCredits = (rb, win) =>
  Math.ceil(sortieCost(rb) * (win ? CONST.RESCUE.winX : CONST.RESCUE.loseX));

export const serviceCost = rb =>
  Math.ceil(fatOf(rb) * SERVICE_RATE[rarOf(rb.type)] * (1 + rb.level * 0.03));

export const findPart = (u, parts) => parts.find(p => p.uid === u);

/* 강화 배수는 **상승에만** 건다. 대가(SLOT_COST)는 굴린 값 그대로 둔다.

   예전에는 p.stats 전체에 곱해서 강화할수록 페널티가 같이 커졌다. SSR 무장의
   spd 대가는 평균 -56.9 인데 +10 에서 -125.1 이 됐다(x2.20). 무장과 코어가 둘 다
   spd 를 깎으므로 그 둘만 SSR+10 으로 껴도 VANGUARD 252 -> 21 (-92%),
   MULE 263 -> 27 (-90%), NEMESIS 325 -> 75 (-77%) 이 됐다. 한 벌을 무작위로
   2,000번 씌우면 67% 가 맨몸보다 느려지고 7.5% 는 spd 가 0 밑으로 내려가
   아래 Math.max(1, ...) 바닥에 닿았다.

   그리고 그 바닥은 게임을 끝낸다 — 상대 spd 252 기준으로 내 spd 가 10 이하면
   한 번도 행동하지 못하고 진다(실측 승률 0.0%). 좋은 파츠를 껴서 움직이지 못하게
   되는 것은 대가가 아니라 고장이다.

   대가는 굴릴 때 이미 등급 배수(rar.mul)를 타므로 좋은 파츠일수록 여전히 아프다.
   강화가 더 얹지 않을 뿐이다.

   spread 는 대가가 아니라 '성향' 이라 음수여도 그대로 강화를 탄다
   (SLOT_SPREAD — 프레임·부스터는 구간을 좁히는 쪽이 이득이다). */
function legacyStat(p) {
  // 저장된 구형 장비의 강화값은 운영 v12 그대로다. 새 베이스용 ENH_SCALE을 소급하지 않는다.
  const o = {}, e = p.enh || 0, cost = SLOT_COST[p.slot];
  for (const k in p.stats)
    o[k] = k === cost ? p.stats[k] : p.stats[k] * (1 + e * (isPct(k) ? 0.08 : 0.12));
  /* ── ATK_SCALE 은 **옛 파츠에만** 건다 ──────────────────────────────
     옛 파츠의 공격력은 STAT_ROLL.atk = [6,16] 에서 굴린 '배율 전' 값이다.
     기체 기본 공격력도 배율 전 값이라(computeStats 가 거기서 곱한다) 둘의 단위를
     맞추려면 파츠도 같이 곱해야 했다.

     새 파츠(PART_BASES)의 수치는 단위가 다르다 — tools/budget.mjs 가 **최종 공격력
     위에서** 재서 맞춘 값이라 이미 '배율 후' 다. 여기에 1.65 를 또 곱하면 공격을
     주는 베이스가 전부 예산 위로 튄다. 실제로 그랬다(4단계에서 실측):
       포톤 랜스 59.4→67.0% · 채프 런처 59.8→66.8% · 빔 세이버 59.2→66.4%
       그리고 공격을 **깎는** 둘은 벌이 1.65배가 되어 밑으로 빠졌다
       (AMBAC 59.6→57.7% · 제너레이터 60.6→57.3%).
     그래서 곱하는 자리를 옛 파츠 쪽으로 옮겼다. 수치는 하나도 안 건드렸다. */
  if (o.atk) o.atk *= ATK_SCALE;
  return o;
}

/* ── 새 파츠 — 베이스 · 인챈트 (2026-09-11 개편, 4단계) ────────────────
   새 파츠는 **스탯을 들고 있지 않다.** base·rarity·affixes·tier·seed·lv 만 저장하고
   값은 여기서 매번 만든다. 그래서 위조할 여지가 없고(서버가 같은 코드로 다시 센다),
   나중에 수치를 고치면 이미 가진 파츠에도 소급된다.

   옛 파츠는 굴린 값을 p.stats 에 들고 있다. 마이그레이션은 7단계라 그때까지
   둘이 섞여 있다 — p.stats 가 있으면 옛 것이다. */
export const isNewPart = p => !!(p && p.base && !p.stats);

const RAR_BY = (() => { const m = {}; for (const r of RARITY) m[r.k] = r; return m; })();

/* PART_BASES 의 수치는 **Lv.40 기준값**이다(tools/budget.mjs 가 그 레벨에서 쟀다).
   그래서 40에서 정확히 1.0 이 되게 나눈다 — 옛 genPart 의 lvScale 과 같은 기울기다. */
const LV_REF = 40;
const lvMul = lv => (1 + Math.max(1, lv || 1) * 0.03) / (1 + LV_REF * 0.03);

/* 고유 효과를 모은다. 여럿이 같은 것을 주면 더한다 — 브레이커에 [관통]까지 붙으면
   둘 다 살아야 한다. pierce 는 베이스가 등급별 표로 주고(브레이커) 인챈트는 숫자로 준다.
   키 이름은 sim.js 의 makeUnit 이 읽는 것과 같아야 한다. */
function mergeFx(fx, src, rarK) {
  if (!src) return;
  if (src.pierce != null) {
    fx.pen = (fx.pen || 0) + (typeof src.pierce === 'object' ? (src.pierce[rarK] || 0) : src.pierce);
    /* 관통 '폭' 은 더하지 않는다. 확률이 겹치는 것과 한 방이 더 아픈 것은 다른 얘기다. */
    if (src.pierceAmt != null) fx.penAmt = Math.max(fx.penAmt || 0, src.pierceAmt);
  }
  if (src.stackSpd != null) {
    fx.stackSpd = (fx.stackSpd || 0) + src.stackSpd;
    fx.stackMax = Math.max(fx.stackMax || 0, src.stackMax || 0);
  }
  if (src.regen != null) fx.regen = (fx.regen || 0) + src.regen;
}

function deriveNew(p) {
  const stats = {}, fx = {};
  let range = 1;
  const B = PART_BASES[p.base];
  if (!B) return { stats, range, fx };            // 모르는 베이스는 조용히 맨몸 취급
  const rar = RAR_BY[p.rarity] || RAR_BY.C;
  const lm = lvMul(p.lv), e = p.enh || 0;
  const add = (k, v) => { stats[k] = (stats[k] || 0) + (isPct(k) ? v : v * lm); };

  /* 베이스 — **등급이 크기를 정한다.** 좋은 값은 pos, 나쁜 값은 neg 로 커진다.
     등급이 높을수록 더 올리고 더 깎으므로 세지는 게 아니라 뾰족해진다.

     강화(enh)는 **좋은 값만** 키운다. 옛 구조에서 페널티까지 같이 키웠더니
     SSR 무장+코어를 끼운 기체의 속도가 90% 넘게 날아가 한 번도 행동하지 못하고
     졌다(아래 computeStats 의 바닥 주석). 좋은 파츠를 껴서 못 움직이게 되는 것은
     대가가 아니라 고장이다. 인챈트는 티어가 자기 품질이라 강화를 태우지 않는다. */
  for (const k in B.stats) {
    const raw = B.stats[k];
    add(k, raw * (raw > 0 ? rar.pos : rar.neg) * (raw > 0 ? 1 + e * (isPct(k) ? (CONST.ENH_PCT ?? 0.08) : (CONST.ENH_SCALE ?? 0.28)) : 1));
  }
  if (B.range != null) range *= B.range;
  mergeFx(fx, B.fx, p.rarity);

  /* 인챈트 — **티어가 크기를 정한다.** 여기에 등급 pos/neg 를 또 걸면 이중 계산이다
     (등급은 이미 티어 분포와 개수로 인챈트에 작용하고 있다).

     티어 안 ±12% 는 **인챈트마다 한 번만** 굴려 그 인챈트의 모든 스탯에 같이 건다.
     스탯마다 따로 굴리면 장점만 잘 나온 개체가 생겨서, 이번 개편이 지키려는
     '강한 장점에는 단점을' 이 굴림으로 새어 나간다. 하나로 걸면 잘 나온 [광폭] 은
     공격도 크고 체력 손해도 큰, 더 뾰족한 물건이 된다. */
  const rnd = mulberry32(((p.seed >>> 0) ^ 0x9e3779b9) >>> 0);
  for (const a of p.affixes || []) {
    const A = AFFIXES[a.id]; if (!A) continue;
    const T = AFFIX_TIER[a.tier] || AFFIX_TIER.I;
    const q = 1 + (rnd() * 2 - 1) * AFFIX_ROLL;
    for (const k in A.stats) {
      const raw = A.stats[k];
      add(k, raw * (raw > 0 ? T.pos : T.neg) * q);
    }
    if (A.range != null) range *= A.range;
    mergeFx(fx, A.fx, p.rarity);
  }
  if (fx.pen) fx.pen = Math.min(1, fx.pen);
  return { stats, range, fx };
}

/* 파츠 넷의 고유 효과를 합친다. mergeFx 와 규칙이 같다 — 확률은 더하고 폭은 큰 쪽. */
function addFx(dst, src) {
  for (const k in src) {
    if (k === 'penAmt' || k === 'stackMax') dst[k] = Math.max(dst[k] || 0, src[k]);
    else dst[k] = (dst[k] || 0) + src[k];
  }
  if (dst.pen) dst.pen = Math.min(1, dst.pen);
}

/* 파츠 하나가 내는 것 전부. 옛 파츠는 구간 배수도 고유 효과도 없다. */
function derive(p) {
  if (!p) return { stats: {}, range: 1, fx: {} };
  return isNewPart(p) ? deriveNew(p) : { stats: legacyStat(p), range: 1, fx: {} };
}

/* 더해지는 스탯만. 표시(partStatLine)와 옛 도구들이 이 모양을 쓴다.
   두 모양 다 여기서 나오는 값이 **그대로 최종 기여**다 (표시값 = 실제 기여). */
export function partStat(p) { return derive(p).stats; }

/* 더할 수 없는 것 — 구간은 곱하고 고유 효과는 규칙이다. */
export function partMods(p) { const d = derive(p); return { range: d.range, fx: d.fx }; }

/* ── 파츠 세트 (2026-09-12 개편, 6단계) ──────────────────────────────
   **계열은 베이스가 직접 들고 있다** — `PART_BASES[...].set`. 이름을 거치지 않는다.

   왜 바꿨나 — 이름으로 찾으면 한글 이름이 계열의 열쇠가 된다. '빔 세이버' 를
   '빔 사벨' 로 고치는 순간 강습 계열이 조용히 끊기는데, 이름은 ChatGPT 담당이라
   그런 수정이 언제든 올 수 있다. 계열은 그 파츠가 무엇인지의 일부이지
   뭐라고 부르는지의 일부가 아니다.

   옛 파츠는 `base` 가 없어서 여전히 이름으로 찾는다. 이름은 `PART_NAMES` 안의
   것으로 제한되므로(server/state.js 의 흰 목록) 이미 가진 파츠가 그대로 계열을
   얻는다 — 마이그레이션이 없다. 같은 이름이 슬롯마다 다른 계열일 수 있어
   열쇠는 '슬롯|이름' 이다.

   **두 표는 반드시 같은 답을 내야 한다.** 어긋나면 같은 물건인데 옛 파츠와 새
   파츠가 다른 계열이 된다. tools/set.mjs 가 매번 대조한다.
   7단계 마이그레이션이 끝나면 아래 이름 표는 지울 수 있다. */
const SET_BY_NAME = (() => {
  const m = {}, P = CONST.PART_SET || {};
  for (const k in P) for (const slot in (P[k].names || {})) m[slot + '|' + P[k].names[slot]] = k;
  return m;
})();
export function setKeyOf(p) {
  if (!p) return null;
  if (p.base) return (PART_BASES[p.base] && PART_BASES[p.base].set) || null;
  return SET_BY_NAME[p.slot + '|' + p.name] || null;
}
/* 옛 이름 표가 내는 답. 위 둘을 대조하는 도구만 쓴다. */
export const setKeyByName = (slot, name) => SET_BY_NAME[slot + '|' + name] || null;

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
  /* 성장은 기본이 직선이다. `curve` 가 있는 기체만 2차 항이 붙는다(2026-09-23 세트 04) —
     같은 등급 안에서도 '조숙형(-)' 과 '대기만성(+)' 이 생긴다. 단위는 grow 와 같고
     Lv.MAXLV 에서 정확히 grow + curve 만큼 오른 값이 된다. curve 가 없으면 예전과 한 자리도 다르지 않다. */
  const q = (lv - 1) * (lv - 1) / ((CONST.MAXLV || 60) - 1);
  for (const k of ['hp', 'atk', 'def', 'spd'])
    s[k] = T.base[k] + (T.grow[k] || 0) * (lv - 1) + (T.curve ? (T.curve[k] || 0) * q : 0);
  s.atk *= ATK_SCALE;                     // 기체 공격력 배율
  s.crit = T.base.crit; s.eva = T.base.eva;
  /* 기체 고유 구간을 먼저 깔아 두면 아래 파츠 합산이 그대로 얹힌다 */
  s.spread = T.spread != null ? T.spread : CONST.SPREAD;
  /* 구간은 더하지 않고 **곱한다.** 기체 고유 구간이 +-8% 부터 +-42% 까지인데 파츠가
     절대값으로 얹히면 같은 파츠가 좁은 기체에겐 바닥을 뚫고 넓은 기체에겐 거의 안
     보였다. 곱하면 기체 성격이 보존된다 — 이번 개편의 요지다.
     옛 파츠는 range 가 1 이고 spread 를 p.stats 로 더하므로 예전과 똑같이 돈다. */
  let range = 1; const fx = {};
  for (const slot of SLOT_ORDER) {
    const u = robot.slots[slot]; if (!u) continue;
    const p = findPart(u, parts); if (!p) continue;
    const d = derive(p);
    for (const k in d.stats) s[k] = (s[k] || 0) + d.stats[k];
    range *= d.range; addFx(fx, d.fx);
  }
  s.spread *= range;
  /* 고유 효과는 스탯이 아니라 전투 규칙이라 여기 실어서 makeUnit 까지 그대로 보낸다.
     하나도 없으면 키 자체가 안 생기고, sim.js 가 기본값으로 예전과 똑같이 돈다. */
  Object.assign(s, fx);
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
     여기서 바닥을 깔아 둔다. 대가를 무르게 하는 것이 아니라 계산을 성립시키는 것이다.
     partStat 이 대가에 강화 배수를 안 태우게 된 뒤로 여기 닿는 일은 사실상 없어졌지만,
     COST_ROLL 이 커지면 다시 닿을 수 있으므로 그대로 둔다. */
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
  /* Skill upgrades affect a periodic skill, not every hit. Count only the skill's
     average share of offense. Old snapshots without skillMul keep the old power. */
  const sm = Number.isFinite(s.skillMul) ? Math.max(1, s.skillMul) : 1;
  const skillOff = 1 + CONST.SKILL_POWER_SHARE * (sm - 1);
  // Chaff never resets its five-shot slowdown. Use its sustained speed for the
  // display estimate; opening turns can be faster. No-FX/legacy power is identical.
  const sustainedSpd = s.stackSpd < 0 && s.stackMax > 0
    ? Math.max(1, s.spd * (1 + s.stackSpd * s.stackMax)) : s.spd;
  const off = s.atk * (1 + s.crit * (CONST.CRIT_MULT - 1)) * sustainedSpd * skillOff;
  const sur = s.hp * (1 + s.def / 100) / Math.max(0.4, 1 - s.eva);
  return Math.round(Math.sqrt(off * sur) * POWER_K);
}
export const power = (robot, parts) => powerOf(computeStats(robot, parts));

/* 육성 곡선 */
export const expNeed   = lv => Math.round(60 + lv * lv * 1.6 + lv * 22);  // lv → lv+1 에 필요한 경험치
export const battleExp = enemyLv => 26 + enemyLv * 9;                     // 승리 시 획득(패배는 35%)
export const lvCost    = lv => Math.round(80 + lv * lv * 4 + lv * 40);
/* 파츠 강화 — 비용과 성공 확률. 화면(표시)·서버(판정)·검사가 같은 함수를 쓴다.
   수치는 `CONST.PART_ENH` 에 있다. 없으면 예전 값(18·36·54… · 100%)으로 돈다. */
export const enhMax    = () => (CONST.PART_ENH && CONST.PART_ENH.max) || 10;
export const enhCost   = e => {
  const P = CONST.PART_ENH;
  return P ? Math.round(P.base + (e | 0) * P.step) : (e + 1) * 18;
};
export const enhRate   = e => {
  const r = CONST.PART_ENH && CONST.PART_ENH.rate;
  if (!r) return 1;
  return e >= r.length ? 0 : r[e];
};

/* 스킬 강화 — 비용과 성공 확률. 서버(판정)와 클라(표시)가 같은 함수를 쓴다.
   두 벌로 두면 화면에 적힌 확률과 실제로 굴리는 확률이 갈린다. */
export const skillMax  = () => CONST.SKILL_UP.max;
/* 값은 **강화 단계만** 본다. 기체 레벨은 보지 않는다.
   예전에는 크레딧에 (1 + 기체레벨 × 0.02)를 곱했는데, 그러면 같은 +10 이
   Lv.1 에서 45,130 · Lv.60 에서 97,338 이었다 — **먼저 강화하고 나중에 키우면 54% 싸다.**
   육성 순서가 곧 정답이 되어 버리는 구조였다(ChatGPT 가 잡아냈다).
   배수를 빼고 그만큼을 단계 값(crBase·crLv)으로 옮겼다. */
export const skillCost = lv => {
  const S = CONST.SKILL_UP;
  return {
    cr: Math.round(S.crBase + lv * S.crLv),
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
