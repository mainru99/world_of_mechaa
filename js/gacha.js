/* 뽑기 판정 — 순수 함수. DOM 도 전역 상태도 참조하지 않는다.
 *
 * 클라이언트와 Worker 가 **같은 파일**을 import 한다. 두 벌로 두면 반드시 어긋나고,
 * 어긋나는 순간 서버가 정상 결과를 위조로 판정하거나 위조를 통과시킨다.
 *
 * 난수는 인자로 받는다. 클라는 Math.random, 서버는 crypto 기반을 넣는다.
 * 그래야 서버가 판정할 때 클라의 난수에 의존하지 않는다.
 */
import { ROBOT_TYPES, ROBOT_RARITY, ROBOT_RARITY_CR, PULL_TABLE, PULL_TABLE_CR,
         RARITY, SLOTS, PART_BASES, AFFIXES, AFFIX_GROUPS, CONST } from '../data/balance.js';

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

/* 파츠 하나를 분해했을 때 실제로 받는 양. **강화한 만큼 값을 더 쳐 준다** —
   안 그러면 잘못 강화한 파츠를 버리는 값이 강화에 쓴 스크랩보다 훨씬 적어
   실수 한 번이 그대로 손실로 굳는다.

   화면(js/game.js)·서버(server/hangar.js)·일괄 분해가 **전부 이 함수를 쓴다.**
   세 곳에 같은 식을 적어 두면 한쪽만 고쳐지는 날이 반드시 오고, 그때 화면에
   적힌 값과 실제로 들어오는 값이 달라진다. */
export const scrapGain = (rarity, enh) => Math.round(scrapValue(rarity) * (1 + (enh || 0) * 0.25));

/* 뽑기 창구. 코어와 크레딧이 표를 따로 쓴다 — 같은 표에 배수만 걸면
   '크레딧으로도 에픽이 코어와 같은 비율로 나오는' 상태가 되어 코어를 쓸 이유가 없어진다. */
export const PULL_CUR = {
  core:   { cost: CONST.PULL_COST,    table: PULL_TABLE,    rar: ROBOT_RARITY,    ko: '코어'   },
  credit: { cost: CONST.PULL_CR_COST, table: PULL_TABLE_CR, rar: ROBOT_RARITY_CR, ko: '크레딧' },
};

/* ── 파츠 생성 (2026-09-11 개편, 4단계) ────────────────────────────────
   슬롯 → 베이스 → 등급 → 인챈트 순으로 정한다. **이름이 곧 성능이다.**
   옛 rollPart 는 스탯을 다 굴린 뒤 마지막에 이름을 균등 추첨했다. 그래서 같은
   슬롯·같은 등급이면 빔 세이버와 발칸포가 통계적으로 같은 물건이었고, 파밍의
   실질 종류가 16종(4슬롯 × 4등급)뿐이었다.

   **스탯은 저장하지 않는다.** base·rarity·affixes·seed·lv 면 값이 완전히 결정되므로
   js/stats.js 의 partStat 이 그대로 다시 만든다. 위조할 여지가 없고, 나중에 수치를
   고치면 이미 가진 파츠에도 소급된다.

   name 은 베이스의 한글 이름을 그대로 넣는다 — 세트 판정이 아직 '슬롯|이름' 이라
   (6단계에서 base 로 바꾼다) 그때까지 계열이 끊기지 않는다.

   forceRar / forceSlot 은 옛 서명 그대로다. 생성 상대의 파츠 품질과 슬롯을
   플레이어에 맞출 때 쓴다 — 뽑기는 두 인자를 쓰지 않으므로 드랍 확률과 슬롯
   분포는 그대로다. */

/* 슬롯별 베이스 목록. balance.js 에서 파생시키므로 베이스를 늘려도 여기는 안 고친다. */
export const BASES_BY_SLOT = (() => {
  const m = {};
  for (const k in PART_BASES) (m[PART_BASES[k].slot] = m[PART_BASES[k].slot] || []).push(k);
  return m;
})();

/* 인챈트 id → 그룹. 같은 그룹은 한 파츠에 하나만 붙는다 — 뜻이 충돌하거나
   (무게를 동시에 늘리고 줄임) 과하게 겹치는(구간을 두 번 좁힘) 조합을 구조로 막는다. */
const GROUP_OF = (() => {
  const m = {};
  for (const g in AFFIX_GROUPS) for (const id of AFFIX_GROUPS[g]) m[id] = g;
  return m;
})();

const affixFits = (a, slot) => a.slots === '*' || a.slots.includes(slot);

/* 인챈트 n개를 겹치지 않게 고른다. 그룹이 막혀 후보가 마르면 n보다 적게 돌려준다 —
   조용히 한 칸 비우는 편이 같은 그룹을 두 번 붙이는 것보다 낫다. */
function pickAffixes(slot, n, tiers, rnd) {
  const pool = Object.keys(AFFIXES).filter(id => affixFits(AFFIXES[id], slot));
  const out = [], usedId = new Set(), usedGroup = new Set();
  for (let i = 0; i < n; i++) {
    const cand = pool.filter(id => !usedId.has(id) &&
                                   !(GROUP_OF[id] && usedGroup.has(GROUP_OF[id])));
    if (!cand.length) break;
    const id = weighted(cand.map(x => ({ k: x, w: AFFIXES[x].w })), rnd).k;
    usedId.add(id); if (GROUP_OF[id]) usedGroup.add(GROUP_OF[id]);
    out.push({ id, tier: weighted(tiers, rnd).k });
  }
  return out;
}

/* 슬롯·등급만 보고 인챈트를 뽑는다. rollPart 가 쓰고, 옛 파츠를 새 모양으로 옮길 때도
   쓴다(tools/partmigrate.mjs). 두 곳이 같은 규칙을 쓰게 하려고 밖으로 뺐다 —
   옮기기가 자기 규칙을 따로 들고 있으면 이관된 파츠만 규칙이 다른 물건이 된다. */
export function rollAffixes(slot, rar, rnd) {
  const tiers = Object.keys(rar.tiers).map(k => ({ k, w: rar.tiers[k] }));
  return pickAffixes(slot, ri(rar.affixes[0], rar.affixes[1], rnd), tiers, rnd);
}

export function rollPart(level, rnd, uid, forceRar, forceSlot) {
  const slot = (forceSlot && SLOTS.includes(forceSlot)) ? forceSlot : pick(SLOTS, rnd);
  const rar = (forceRar && RARITY.find(r => r.k === forceRar)) || weighted(RARITY, rnd);
  const base = pick(BASES_BY_SLOT[slot], rnd);
  const affixes = rollAffixes(slot, rar, rnd);
  /* 티어 안 +-12% 굴림을 재현하는 씨앗. 값을 저장하지 않으므로 이것이 파츠의 몸이다. */
  const seed = Math.floor(rnd() * 4294967296) >>> 0;
  return { uid, slot, base, rarity: rar.k, ko: rar.ko, name: PART_BASES[base].ko,
           affixes, seed, lv: Math.max(1, level | 0 || 1), enh: 0 };
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
    return { kind: 'part', part: rollPart(level, rnd, uid()) };
  }
  return { kind: 'bust' };
}
