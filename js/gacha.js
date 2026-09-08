/* 뽑기 판정 — 순수 함수. DOM 도 전역 상태도 참조하지 않는다.
 *
 * 클라이언트와 Worker 가 **같은 파일**을 import 한다. 두 벌로 두면 반드시 어긋나고,
 * 어긋나는 순간 서버가 정상 결과를 위조로 판정하거나 위조를 통과시킨다.
 *
 * 난수는 인자로 받는다. 클라는 Math.random, 서버는 crypto 기반을 넣는다.
 * 그래야 서버가 판정할 때 클라의 난수에 의존하지 않는다.
 */
import { ROBOT_TYPES, ROBOT_RARITY, ROBOT_RARITY_CR, PULL_TABLE, PULL_TABLE_CR, RARITY, SLOTS, SLOT_STATS, SLOT_COST, COST_ROLL, SLOT_SPREAD, SPREAD_ROLL, PART_NAMES, STAT_ROLL, CONST } from '../data/balance.js';

/* 0~1 비율로 다루는 스탯. 레벨 배수를 타지 않고, 강화 배수도 다르게 먹는다. */
export const isPct = s => s === 'crit' || s === 'eva' || s === 'spread';

export const pick = (a, rnd) => a[Math.floor(rnd() * a.length)];
export const rf = (a, b, rnd) => a + rnd() * (b - a);
export const ri = (a, b, rnd) => Math.floor(a + rnd() * (b - a + 1));

export function weighted(list, rnd) {
  let t = list.reduce((s, x) => s + x.w, 0), r = rnd() * t;
  for (const x of list) { if ((r -= x.w) <= 0) return x; }
  return list[list.length - 1];
}

/* 등급별 기체 목록. balance.js 에서 파생시키므로 기체를 추가해도 여기는 안 고쳐도 된다. */
export const BY_RARITY = (() => {
  const m = {};
  for (const k in ROBOT_TYPES) { const r = ROBOT_TYPES[k].rarity; (m[r] = m[r] || []).push(k); }
  return m;
})();

/* 자동 분해 대상이면 바꿔 줄 스크랩 양, 아니면 0. **대전·토벌 드랍에만 쓴다.** */
export const autoScrapValue = rarity => (CONST.AUTO_SCRAP && CONST.AUTO_SCRAP[rarity]) || 0;

/* 손으로 분해했을 때 받는 스크랩. 뽑기로 얻은 파츠는 자동으로 없애지 않고
   플레이어가 이 값을 보고 분해할지 정한다. */
export const scrapValue = rarity => (CONST.SCRAP_VALUE && CONST.SCRAP_VALUE[rarity]) || 0;

/* 뽑기 창구. 코어와 크레딧이 표를 따로 쓴다 — 같은 표에 배수만 걸면
   '크레딧으로도 에픽이 코어와 같은 비율로 나오는' 상태가 되어 코어를 쓸 이유가 없어진다. */
export const PULL_CUR = {
  core:   { cost: CONST.PULL_COST,    table: PULL_TABLE,    rar: ROBOT_RARITY,    ko: '코어'   },
  credit: { cost: CONST.PULL_CR_COST, table: PULL_TABLE_CR, rar: ROBOT_RARITY_CR, ko: '크레딧' },
};

/* forceRar / forceSlot 을 주면 그 등급·그 슬롯으로 만든다.
   생성 상대의 파츠 품질과 슬롯을 플레이어에 맞출 때 쓴다 —
   뽑기는 두 인자를 쓰지 않으므로 드랍 확률과 슬롯 분포는 그대로다. */
export function genPart(level, rnd, uid, forceRar, forceSlot) {
  const slot = (forceSlot && SLOTS.includes(forceSlot)) ? forceSlot : pick(SLOTS, rnd);
  const rar = (forceRar && RARITY.find(r => r.k === forceRar)) || weighted(RARITY, rnd);
  const lvScale = 1 + (level || 1) * 0.03, stats = {};
  for (let i = 0; i < rar.n; i++) {
    const st = pick(SLOT_STATS[slot], rnd), [a, b] = STAT_ROLL[st];
    let v = rf(a, b, rnd) * rar.mul;
    if (!isPct(st)) v = Math.round(v * lvScale);
    stats[st] = (stats[st] || 0) + v;
  }
  /* 대가 — 슬롯마다 정해진 스탯 하나를 반드시 깎는다. 상승분과 같은 배수를 타므로
     등급이 높을수록 더 크게 올리고 더 크게 깎는다. 세지는 게 아니라 뾰족해진다. */
  const cst = SLOT_COST[slot], cr = cst && COST_ROLL[cst];
  if (cr) {
    /* costMul 은 대가에만 걸린다. 일반(C)은 상승을 한 번만 굴리므로 대가를 같은 폭으로
       물리면 끼는 쪽이 손해가 된다(실측 −2.4%). RARITY 의 주석 참고. */
    let c = rf(cr[0], cr[1], rnd) * rar.mul * (rar.costMul != null ? rar.costMul : 1);
    if (!isPct(cst)) c = Math.round(c * lvScale);
    stats[cst] = (stats[cst] || 0) - c;
  }
  /* 성향 — 무장은 구간을 넓히고 부스터는 좁힌다. 좋고 나쁨이 아니라 축이다. */
  const sgn = SLOT_SPREAD[slot];
  if (sgn) stats.spread = sgn * rf(SPREAD_ROLL[0], SPREAD_ROLL[1], rnd) * rar.mul;
  for (const k in stats) if (isPct(k)) stats[k] = Math.round(stats[k] * 1000) / 1000;
  return { uid, slot, name: pick(PART_NAMES[slot], rnd), rarity: rar.k, ko: rar.ko, stats, enh: 0 };
}

/* 뽑기 1회. 소유 상태(ownedTypes)와 평균 레벨을 받아 '무엇이 나왔는지'만 돌려준다.
   재화를 깎거나 상태를 바꾸는 것은 부르는 쪽의 일이다 — 그래야 서버와 클라가
   같은 판정을 쓰면서 저장 방식은 각자 다르게 갈 수 있다. */
export function rollPull(ownedTypes, level, rnd, uid, cur) {
  const C = PULL_CUR[cur] || PULL_CUR.core;
  const kind = weighted(C.table, rnd).k;

  if (kind === 'robot') {
    const type = pick(BY_RARITY[weighted(C.rar, rnd).k], rnd);
    if (ownedTypes.has(type)) return { kind: 'dupe', type, gain: CONST.DUPE_GAIN[ROBOT_TYPES[type].rarity] };
    return { kind: 'robot', type };
  }
  if (kind === 'core')   return { kind: 'core', n: 1 };
  if (kind === 'credit') return { kind: 'credit', cr: 47 + level * 4 + ri(0, 30, rnd) };
  if (kind === 'part') {
    /* 뽑은 파츠는 등급이 낮아도 **그대로 준다.** 예전에는 일반 등급을 즉시 스크랩으로
       바꿨는데, 뽑아 놓고 한 번 껴 보지도 못하는 것이 아깝다는 지적을 받았다.
       분해는 인벤토리에서 플레이어가 고른다(scrapValue). */
    return { kind: 'part', part: genPart(level, rnd, uid()) };
  }
  return { kind: 'bust' };
}
