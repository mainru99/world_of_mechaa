/* 전투 보상·상대 생성 — 순수 함수. DOM 도 전역 상태도 참조하지 않는다.
 *
 * 클라이언트와 Worker 가 같은 파일을 import 한다. 서버가 판정하고 클라는 재생만 하지만,
 * 오프라인 연습 모드나 검증 도구가 같은 규칙을 쓸 수 있어야 하므로 순수하게 유지한다.
 */
import { ROBOT_TYPES, MONSTER_TYPES, ROBOT_RARITY, RARITY, CONST } from '../data/balance.js';
import { pick, ri, weighted, genPart, autoScrapValue, BY_RARITY } from './gacha.js';
import { SLOTS } from '../data/balance.js';

export const RIDX = { C: 0, UC: 1, R: 2, UQ: 3, EP: 4 };

export const MONSTER_BY_RARITY = (() => {
  const m = {};
  for (const k in MONSTER_TYPES) { const r = MONSTER_TYPES[k].rarity; (m[r] = m[r] || []).push(k); }
  return m;
})();

const CALLSIGNS = ['NOVA','RAZE','ORCA','KITE','VULT','ZERO','ONYX','HELM','SABLE','ARC','GEIST','ROOK'];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/* 등급 하나가 레벨 몇 개 값인가. 등급이 위인 상대는 그만큼 낮은 레벨로,
   아래인 상대는 높은 레벨로 내보내 등급이 달라도 해볼 만한 판을 만든다.
   위로 얹을 때는 내 레벨을 넘지 않게 묶는다 — Lv.1 이 Lv.17 커먼을 만나면 안 된다. */
/* 등급 격차를 레벨로 환산할 때 쓰는 배수.
   TIER_LV 는 Lv.30 에서 잰 값인데, 격차가 레벨에 따라 조금씩 벌어진다 —
   커먼이 에픽과 대등해지는 지점이 Lv.10 에서 +11, Lv.30 에서 +16, Lv.50 에서 +20 이었다.
   비례(lv/30)로 두면 저레벨에서 턱없이 덜 갚아 준다. 그 실측선에 맞춘 1차식이다. */
const tierScale = lv => Math.max(0.5, Math.min(1.4, 0.55 + 0.015 * lv));

/* 생성 상대의 레벨 상한. 플레이어의 최대 레벨보다 위에 있다 — 위 주석(OPP_LV_OVER) 참조. */
const oppLvMax = () => CONST.MAXLV + (CONST.OPP_LV_OVER || 0);

export function tierLevelAdjust(myRarities, oppRarity, myLevel) {
  const T = CONST.TIER_LV || {};
  const mine = Math.max(0, ...myRarities.map(r => T[r] || 0));
  /* 위 등급 상대는 격차를 다 깎아 주고(안 그러면 아래 등급이 계속 진다),
     아래 등급 상대는 7할만 얹는다(다 얹으면 좋은 기체를 가진 이유가 없어진다). */
  const gap = mine - (T[oppRarity] || 0);
  const adj = Math.round((gap < 0 ? gap : gap * 0.7) * tierScale(myLevel));
  return adj < 0 ? Math.max(adj, 1 - myLevel) : Math.min(adj, Math.max(0, myLevel - 1));
}

/* 상대 등급 — 내가 가진 최고 등급보다 한 단계 위까지만 만난다.
   다만 '레벨로 갚을 수 있는' 등급까지만이다. 등급이 무거워진 뒤로는 이 단서가 필요하다:
   Lv.1 은 언커먼의 레벨을 3 깎아 줄 수 없어(1 밑으로 못 간다) 그냥 승률 11% 짜리 판이 된다.
   그래서 새 플레이어는 한동안 자기 등급만 만나고, 레벨이 쌓이면 위 등급이 열린다.
   후보가 없는 등급이 걸리면(BOSS 처럼 봉인된 것) 커먼으로 떨어뜨린다. */
export function pickOpponentType(ownedRarities, byRarity, rnd, myLevel) {
  const T = CONST.TIER_LV || {};
  const mine = Math.max(0, ...ownedRarities.map(r => T[r] || 0));
  const lv = myLevel == null ? CONST.MAXLV : myLevel;
  const best = Math.max(0, ...ownedRarities.map(r => RIDX[r] ?? 0));
  let pool = ROBOT_RARITY.filter(r => RIDX[r.k] <= Math.min(4, best + 1)
                                   && lv + tierLevelAdjust(ownedRarities, r.k, lv) >= 1
                                   && lv >= (T[r.k] || 0) - mine);
  if (!pool.length) pool = ROBOT_RARITY.filter(r => RIDX[r.k] === 0);
  const k = weighted(pool, rnd).k;
  const list = byRarity[k] && byRarity[k].length ? byRarity[k] : byRarity.C;
  return pick(list, rnd);
}

/* 파츠 '품질' 하나로 뭉친 값. 상대를 여기에 맞춰 만든다.
   배열(낀 파츠)·숫자(개수)·품질 객체를 모두 받아 준다. */
const PART_RAR = RARITY.map(r => r.k);          // ['C','R','SR','SSR']
export function partQuality(myParts) {
  if (myParts == null) return { n: 1, rar: 'C', enh: 0 };
  if (typeof myParts === 'number') return { n: clamp(myParts | 0, 0, 4), rar: 'C', enh: 0 };
  if (!Array.isArray(myParts)) return { n: clamp(myParts.n | 0, 0, 4),
                                        rar: myParts.rar || 'C', enh: myParts.enh | 0 };
  const list = myParts.filter(Boolean);
  if (!list.length) return { n: 0, rar: 'C', enh: 0 };
  const ri_ = list.reduce((s, p) => s + Math.max(0, PART_RAR.indexOf(p.rarity)), 0) / list.length;
  const eh = list.reduce((s, p) => s + (p.enh || 0), 0) / list.length;
  return { n: clamp(list.length, 0, 4), rar: PART_RAR[Math.round(ri_)] || 'C', enh: Math.round(eh) };
}

/* 내 파츠가 레벨 몇 개 값인가. 몬스터는 파츠를 낄 수 없어 이걸 레벨로 갚아 준다. */
export function partLevelValue(myParts, myLevel) {
  const q = partQuality(myParts);
  const per = (CONST.PART_LV || {})[q.rar];
  if (!per || !q.n) return 0;
  /* 등급 격차와 같은 이유로 레벨을 탄다 — 실측 SR 네 개가 Lv.15 에서 +10, Lv.30 에서 +14 였다.
     PART_LV 은 Lv.30 기준값이므로 같은 보정선을 쓴다. */
  return Math.round(per * (q.n / 4) * (1 + q.enh * (CONST.PART_ENH_LV || 0)) * tierScale(myLevel));
}

/* 레이팅 → 상대가 낄 장비. **내 장비를 보지 않는다.**
   왜 이렇게 바꿨는지는 data/balance.js 의 RATING_GEAR 주석에 적었다. */
export function gearFromRating(rating) {
  const T = CONST.RATING_GEAR;
  if (!T || !T.length) return { n: 0, rar: 'C', enh: 0 };
  const r = Number.isFinite(rating) ? rating : 1000;   // 모르면 시작 레이팅으로 본다
  let out = T[0];
  for (const row of T) if (r >= row.at) out = row;
  return { n: out.n, rar: out.rar, enh: out.enh };
}

/* 상대 한 명. 몬스터는 파츠를 갖지 않는다.
   여섯 번째 인자는 **레이팅**이다. 예전에는 '내가 낀 파츠'였는데, 그러면 장비를 갖출수록
   상대도 같이 세져 이득이 즉시 상쇄됐다(거울 대치). 배열이 들어오면 예전 방식으로
   품질을 뽑아 쓴다 — 레이팅을 모르는 호출부(오프라인 연습·옛 도구)를 위한 길이다. */
export function makeOpponent(ownedRarities, myLevel, rnd, uid, forceMonster, rating) {
  /* 배열이면 '내가 낀 파츠'로 본다 — 레이팅을 모르는 옛 호출부(검증 도구)를 위한 길이다.
     그 밖에는 레이팅으로 본다. 레이팅 0 이면 장비 없음이 되므로 tools/match.mjs 가
     '맨몸 플레이어'로 쓰는 0 도 그대로 맞는다. */
  const myParts = Array.isArray(rating) ? rating : gearFromRating(rating);
  const monster = forceMonster || rnd() < CONST.MONSTER_RATE;
  const type = pickOpponentType(ownedRarities, monster ? MONSTER_BY_RARITY : BY_RARITY, rnd, myLevel);
  const rar = (monster ? MONSTER_TYPES : ROBOT_TYPES)[type].rarity;
  /* 레벨 1 차이가 승률 80% 다(스탯 넷이 한꺼번에 오르니 곱으로 겹친다).
     예전의 ±2 는 그래서 '시작하기 전에 이미 정해진 판'을 절반쯤 만들어 냈다. ±1 로 줄인다.
     저레벨에서는 그 1 조차 비중이 커서 레벨에 맞춰 더 줄인다. */
  const jit = Math.round(ri(-1, 1, rnd) * Math.min(1, myLevel / 8));
  const level = clamp(myLevel + tierLevelAdjust(ownedRarities, rar, myLevel) + jit, 1, oppLvMax());

  if (monster) {
    /* 몬스터는 파츠를 못 낀다. 내가 낀 만큼을 레벨로 얹어 준다.
       (최대 레벨에서는 더 얹을 자리가 없어 그대로 쉬워진다 — 그건 감수한다) */
    const lv = clamp(level + partLevelValue(myParts, myLevel), 1, oppLvMax());
    return { kind: 'monster', type, level: lv, parts: [],
             slots: { WEAPON: null, FRAME: null, BOOSTER: null, CORE: null },
             callsign: MONSTER_TYPES[type].name };
  }
  const parts = [], slots = { WEAPON: null, FRAME: null, BOOSTER: null, CORE: null };
  /* 상대의 파츠는 내가 낀 것을 따라간다 — 개수도, 등급도, 강화 수치도.
     파츠는 이 게임에서 가장 무거운 변수다. 실측(Lv.30, 같은 기체·같은 레벨):
       파츠 없음 vs 자연분포 4%  ·  자연분포 vs SR 8%  ·  SR vs SSR 8%
     기체 등급 하나(3~7레벨)보다 파츠 등급 하나가 더 크다. 그래서 여기를 맞추지 않으면
     초반엔 맨몸으로 장비병을 만나 계속 지고, 후반엔 풀강 SSR 로 맨몸을 두들기게 된다. */
  const q = partQuality(myParts);
  const np = clamp(q.n + ri(-1, 1, rnd), 0, 4);
  /* 슬롯은 겹치지 않게 고른다. 예전에는 슬롯을 매번 무작위로 뽑아서, 4개를 만들어도
     같은 슬롯이 겹쳐 덮이는 바람에 실제로 붙는 건 평균 2.7개뿐이었다. */
  const free = SLOTS.slice();
  for (let i = 0; i < np && free.length; i++) {
    const slot = free.splice(ri(0, free.length - 1, rnd), 1)[0];
    const p = genPart(level, rnd, uid(), q.rar, slot);
    p.enh = clamp(q.enh + ri(-1, 1, rnd), 0, 10);
    parts.push(p); slots[p.slot] = p.uid;
  }
  return { kind: 'robot', type, level, parts, slots,
           callsign: pick(CALLSIGNS, rnd) + '-' + ri(10, 99, rnd) };
}

/* 토벌 상대. 등급을 직접 골라 그 등급의 몬스터를 낸다.
   아레나 매칭과 달리 '내가 가진 등급'에 묶이지 않는다 — 비용이 곧 관문이다.

   **내 파츠를 보지 않는다.** 예전에는 파츠만큼 상대 레벨을 얹었는데, 그러면 장비를
   갖출수록 어느 등급이든 똑같이 버거워져 '등급을 고른다'가 의미를 잃는다.
   토벌은 난이도를 내가 고르는 콘텐츠다 — 세지면 아래 등급이 밭이 되고 위로 올라간다.
   그 올라가는 것이 곧 보상이다. */
export function makeHuntTarget(tier, myLevel, rnd, uid) {
  const list = MONSTER_BY_RARITY[tier];
  if (!list || !list.length) return null;
  const type = pick(list, rnd);
  const off = (CONST.HUNT[tier] || {}).lv || 0;
  const level = clamp(myLevel + off, 1, oppLvMax());
  return { kind: 'monster', type, level, parts: [],
           slots: { WEAPON: null, FRAME: null, BOOSTER: null, CORE: null },
           callsign: MONSTER_TYPES[type].name };
}

/* 토벌 보상. 스크랩과 파츠가 본체다 — 크레딧은 아레나의 절반이 안 된다.
   그래야 '돈을 벌려면 아레나, 재료를 캐려면 토벌'로 갈린다. */
export function rollHuntRewards(win, tier, enemyLv, rnd, uid) {
  const H = CONST.HUNT[tier] || CONST.HUNT.C;
  const base = rollBattleRewards(win, enemyLv, rnd, uid);
  if (!win) return { ...base, cr: Math.round(base.cr * H.crX), sc: Math.round(base.sc * H.scX * 0.4),
                     core: 0, part: null, tier };

  let sc = Math.round((18 + ri(0, 14, rnd)) * H.scX);
  let part = null;
  if (rnd() < H.partP) {
    const p = genPart(enemyLv, rnd, uid());
    const auto = autoScrapValue(p.rarity);
    if (auto) sc += auto; else part = p;      // 잡템은 행을 만들지 않는다
  }
  return { win: true, tier,
           cr: Math.round((120 + enemyLv * 14) * H.crX),
           sc, core: rnd() < H.coreP ? 1 : 0, part,
           expGain: base.expGain, fatAdd: base.fatAdd };
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
