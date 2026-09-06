/* 뽑기 판정 — 순수 함수. DOM 도 전역 상태도 참조하지 않는다.
 *
 * 클라이언트와 Worker 가 **같은 파일**을 import 한다. 두 벌로 두면 반드시 어긋나고,
 * 어긋나는 순간 서버가 정상 결과를 위조로 판정하거나 위조를 통과시킨다.
 *
 * 난수는 인자로 받는다. 클라는 Math.random, 서버는 crypto 기반을 넣는다.
 * 그래야 서버가 판정할 때 클라의 난수에 의존하지 않는다.
 */
import { ROBOT_TYPES, ROBOT_RARITY, PULL_TABLE, RARITY, SLOTS, SLOT_STATS, SLOT_COST, COST_ROLL, PART_NAMES, STAT_ROLL, CONST } from '../data/balance.js';

export const isPct = s => s === 'crit' || s === 'eva';

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

/* 자동 분해 대상이면 바꿔 줄 스크랩 양, 아니면 0 */
export const autoScrapValue = rarity => (CONST.AUTO_SCRAP && CONST.AUTO_SCRAP[rarity]) || 0;

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
    let c = rf(cr[0], cr[1], rnd) * rar.mul;
    if (!isPct(cst)) c = Math.round(c * lvScale);
    stats[cst] = (stats[cst] || 0) - c;
  }
  for (const k in stats) if (isPct(k)) stats[k] = Math.round(stats[k] * 1000) / 1000;
  return { uid, slot, name: pick(PART_NAMES[slot], rnd), rarity: rar.k, ko: rar.ko, stats, enh: 0 };
}

/* 뽑기 1회. 소유 상태(ownedTypes)와 평균 레벨을 받아 '무엇이 나왔는지'만 돌려준다.
   재화를 깎거나 상태를 바꾸는 것은 부르는 쪽의 일이다 — 그래야 서버와 클라가
   같은 판정을 쓰면서 저장 방식은 각자 다르게 갈 수 있다. */
export function rollPull(ownedTypes, level, rnd, uid) {
  const kind = weighted(PULL_TABLE, rnd).k;

  if (kind === 'robot') {
    const type = pick(BY_RARITY[weighted(ROBOT_RARITY, rnd).k], rnd);
    if (ownedTypes.has(type)) return { kind: 'dupe', type, gain: CONST.DUPE_GAIN[ROBOT_TYPES[type].rarity] };
    return { kind: 'robot', type };
  }
  if (kind === 'core')   return { kind: 'core', n: 1 };
  if (kind === 'credit') return { kind: 'credit', cr: 47 + level * 4 + ri(0, 30, rnd) };
  if (kind === 'part') {
    const part = genPart(level, rnd, uid());
    const sc = autoScrapValue(part.rarity);
    return sc ? { kind: 'scrap', n: sc, part } : { kind: 'part', part };
  }
  return { kind: 'bust' };
}
