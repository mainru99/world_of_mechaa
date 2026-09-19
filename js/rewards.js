/* 전투 보상·상대 생성 — 순수 함수. DOM 도 전역 상태도 참조하지 않는다.
 *
 * 클라이언트와 Worker 가 같은 파일을 import 한다. 서버가 판정하고 클라는 재생만 하지만,
 * 오프라인 연습 모드나 검증 도구가 같은 규칙을 쓸 수 있어야 하므로 순수하게 유지한다.
 */
import { ROBOT_TYPES, MONSTER_TYPES, ROBOT_RARITY, RARITY, CONST } from '../data/balance.js';
import { pick, ri, weighted, rollPart, autoScrapValue, BY_RARITY } from './gacha.js';
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
/* 다섯째 인자로 등급을 직접 주면 그 안에서만 고른다 — 구간표가 등급을 정할 때 쓴다.
   (구간이 'UQ·EP' 라면 내 소유 등급과 무관하게 그 둘 중에서 나와야 한다) */
export function pickOpponentType(ownedRarities, byRarity, rnd, myLevel, forceRars) {
  if (forceRars && forceRars.length) {
    const lists = forceRars.map(k => byRarity[k]).filter(l => l && l.length);
    const list = lists.length ? pick(lists, rnd) : byRarity.C;
    return pick(list, rnd);
  }
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
/* ── 대전 몬스터 구간 — **몬스터 판 승패로 오르내린다** ─────────────
   처음에는 레이팅으로 골랐다. 그런데 레이팅은 몬스터 판에서 **움직이지 않는다**
   (server/battle.js — 레이팅은 생성 로봇·사람 상대에서만 움직인다). 그래서 구간이
   몬스터를 이기든 지든 상관없이 로봇 판 성적으로만 정해졌고, 실측하니
   앞 구간은 승률 94~100%, 뒤 구간은 4~42% 였다 — 구간이 내 실력을 전혀 따라오지 않았다.

   그래서 구간을 **자기 점수**로 움직인다. 이 구간 몬스터를 이기면 +1, 지면 −1.
     +up(5)   에 닿으면 승급 — 다음 구간, 점수 0 에서 다시
     −down(3) 에 닿으면 강등 — 앞 구간, 점수 0 에서 다시
   **이겨야 오른다**는 약속은 그대로다. 그리고 구간을 올리는 것이 **그 구간의 몬스터를
   이긴 것**이 되어, 구간이 곧 '몬스터를 이길 수 있는 세기'가 된다.

   올라가는 데 5 · 내려가는 데 3 인 이유 — 들어가자마자 한 판 지고 되돌아오면
   '이길 판과 질 판이 번갈아 오는' 대기가 된다(tools/bandwalk.mjs 가 잰다).
   반대로 강등이 너무 멀면 못 이기는 구간에 갇힌다. 3 이 그 사이다. */

/* 몇 번째 구간(1부터)의 줄. 표가 없으면 null. */
export function bandRow(i) {
  const T = CONST.MON_BAND;
  if (!T || !T.length || !Number.isFinite(i)) return null;
  const k = Math.max(1, Math.min(T.length, i | 0));
  return { ...T[k - 1], i: k, total: T.length };
}

/* 레이팅 → 구간. **처음 한 번 자리를 잡을 때만** 쓴다(구간 칸이 비어 있는 계정).
   그 뒤로는 bandStep 이 움직인다. 레이팅을 모르는 호출부(배열을 넘기는 옛 도구)는 null. */
export function bandOf(rating) {
  const T = CONST.MON_BAND;
  if (!T || !T.length || !Number.isFinite(rating)) return null;
  let i = 1;
  T.forEach((row, k) => { if (rating >= (row.at || 0)) i = k + 1; });
  return bandRow(i);
}

/* 구간 칸이 비었으면 레이팅으로 자리를 잡는다 — 이 기능을 넣기 전의 계정이 어제 보던
   구간에서 그대로 시작하게 한다. 잘못 잡혀도 몇 판 안에 점수가 바로잡는다. */
export function bandStart(band, rating) {
  if (Number.isFinite(band) && band >= 1) return bandRow(band)?.i ?? 1;
  return bandOf(Number.isFinite(rating) ? rating : 1000)?.i ?? 1;
}

/* 한 판 뒤의 구간과 점수. moved: +1 승급 · −1 강등 · 0 그대로.
   끝 구간에서는 더 오를 데가 없고, 첫 구간에서는 더 내려갈 데가 없다 —
   그때 점수를 문턱 한 칸 앞에서 멈춰 둔다(무한히 쌓였다가 한 번에 쏟아지지 않게). */
export function bandStep(band, pts, win) {
  const T = CONST.MON_BAND || [];
  const S = CONST.MON_BAND_STEP || { up: 5, down: 3 };
  let b = Math.max(1, Math.min(T.length || 1, band | 0 || 1));
  let p = (pts | 0) + (win ? 1 : -1), moved = 0;
  if (p >= S.up && b < T.length) { b++; p = 0; moved = 1; }
  else if (p <= -S.down && b > 1) { b--; p = 0; moved = -1; }
  else p = Math.max(-S.down + 1, Math.min(S.up - 1, p));
  return { band: b, pts: p, moved };
}

/* 화면이 '목표'를 보여 주는 데 쓴다 — 승급까지 몇 승, 강등까지 몇 패. */
export function bandGoal(band, pts) {
  const T = CONST.MON_BAND || [];
  const S = CONST.MON_BAND_STEP || { up: 5, down: 3 };
  const b = Math.max(1, Math.min(T.length || 1, band | 0 || 1));
  return { band: b, total: T.length, pts: pts | 0,
           up: b < T.length ? S.up - (pts | 0) : null,
           down: b > 1 ? S.down + (pts | 0) : null };
}

export function gearFromRating(rating) {
  const T = CONST.RATING_GEAR;
  if (!T || !T.length) return { n: 0, rar: 'C', enh: 0, skillLv: 0 };
  const r = Number.isFinite(rating) ? rating : 1000;   // 모르면 시작 레이팅으로 본다
  let out = T[0];
  for (const row of T) if (r >= row.at) out = row;
  return { n: out.n, rar: out.rar, enh: out.enh, skillLv: out.skillLv | 0 };
}

/* 상대 한 명. 몬스터는 파츠를 갖지 않는다.
   여섯 번째 인자는 **레이팅**이다. 예전에는 '내가 낀 파츠'였는데, 그러면 장비를 갖출수록
   상대도 같이 세져 이득이 즉시 상쇄됐다(거울 대치). 배열이 들어오면 예전 방식으로
   품질을 뽑아 쓴다 — 레이팅을 모르는 호출부(오프라인 연습·옛 도구)를 위한 길이다. */
export function makeOpponent(ownedRarities, myLevel, rnd, uid, forceMonster, rating, band) {
  /* 배열이면 '내가 낀 파츠'로 본다 — 레이팅을 모르는 옛 호출부(검증 도구)를 위한 길이다.
     그 밖에는 레이팅으로 본다. 레이팅 0 이면 장비 없음이 되므로 tools/match.mjs 가
     '맨몸 플레이어'로 쓰는 0 도 그대로 맞는다. */
  const myParts = Array.isArray(rating) ? rating : gearFromRating(rating);
  /* Generated arena opponents grow their skill with the rating table. Rescue is
     deliberately +0: a recovery match must not scale up with the player. */
  const skillLv = forceMonster ? 0 : clamp(myParts.skillLv | 0, 0, CONST.SKILL_UP.max);
  const monster = forceMonster || rnd() < CONST.MONSTER_RATE;
  const type = pickOpponentType(ownedRarities, monster ? MONSTER_BY_RARITY : BY_RARITY, rnd, myLevel);
  const rar = (monster ? MONSTER_TYPES : ROBOT_TYPES)[type].rarity;
  /* 레벨 1 차이가 승률 80% 다(스탯 넷이 한꺼번에 오르니 곱으로 겹친다).
     예전의 ±2 는 그래서 '시작하기 전에 이미 정해진 판'을 절반쯤 만들어 냈다. ±1 로 줄인다.
     저레벨에서는 그 1 조차 비중이 커서 레벨에 맞춰 더 줄인다. */
  const jit = Math.round(ri(-1, 1, rnd) * Math.min(1, myLevel / 8));
  const level = clamp(myLevel + tierLevelAdjust(ownedRarities, rar, myLevel) + jit, 1, oppLvMax());

  if (monster) {
    /* ── 구간제 (CONST.MON_BAND) ──────────────────────────
       **구간 안에서 몬스터는 고정이다.** 내 레벨을 따라가지 않는다 — 그게 이 개편의
       전부다. 레이팅이 구간을 정하고, 구간 안에서 내 성장은 온전히 남는다.
       그리고 **몬스터도 파츠를 낀다.** 예전에는 못 껴서 그 몫을 전부 레벨로 갚았고
       (partLevelValue), 끝판에서 레벨 상한 90 에 부딪혀 더 세울 자리가 없었다.
       일곱째 인자 band 가 구간이다(bandStep 이 움직인다). 없으면 레이팅으로 자리를 잡는다. */
    const row = Number.isFinite(band) && band >= 1 ? bandRow(band) : bandOf(rating);
    if (row) {
      const band = row;
      const bt = pickOpponentType(ownedRarities, MONSTER_BY_RARITY, rnd, myLevel, band.rars);
      const lv = clamp(band.lv + jit, 1, oppLvMax());
      const bp = [], bs = { WEAPON: null, FRAME: null, BOOSTER: null, CORE: null };
      const g = band.gear || {};
      const freeB = SLOTS.slice();
      for (let i = 0; i < (g.n | 0) && freeB.length; i++) {
        const slot = freeB.splice(ri(0, freeB.length - 1, rnd), 1)[0];
        const p = rollPart(lv, rnd, uid(), g.rar, slot);
        p.enh = g.enh | 0;
        bp.push(p); bs[slot] = p.uid;
      }
      return { kind: 'monster', type: bt, level: lv, skillLv: 0, parts: bp, slots: bs,
               band: band.i, callsign: MONSTER_TYPES[bt].name };
    }
    /* 표가 없으면 예전 방식으로 돈다(옛 도구·오프라인 연습이 그렇다). */
    const lv = clamp(level + partLevelValue(myParts, myLevel), 1, oppLvMax());
    return { kind: 'monster', type, level: lv, skillLv, parts: [],
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
    const p = rollPart(level, rnd, uid(), q.rar, slot);
    p.enh = clamp(q.enh + ri(-1, 1, rnd), 0, 10);
    parts.push(p); slots[p.slot] = p.uid;
  }
  return { kind: 'robot', type, level, skillLv, parts, slots,
           callsign: pick(CALLSIGNS, rnd) + '-' + ri(10, 99, rnd) };
}

/* 토벌 상대. 등급을 직접 골라 그 등급의 몬스터를 낸다.
   아레나 매칭과 달리 '내가 가진 등급'에 묶이지 않는다 — 비용이 곧 관문이다.

   **내 파츠를 보지 않는다.** 예전에는 파츠만큼 상대 레벨을 얹었는데, 그러면 장비를
   갖출수록 어느 등급이든 똑같이 버거워져 '등급을 고른다'가 의미를 잃는다.
   토벌은 난이도를 내가 고르는 콘텐츠다 — 세지면 아래 등급이 밭이 되고 위로 올라간다.
   그 올라가는 것이 곧 보상이다. */
/* 생성 상대의 전술. **시드에서 결정적으로** 고른다 — 사람이 고르는 것이 아니므로
   서버와 클라가 같은 값을 얻어야 재생이 갈리지 않는다.

   기울기는 상대의 스킬 틀을 따른다(CONST.TACTIC_BIAS). 무작위로 고르면 상대가
   멍청해 보이고, 고정하면 외워 버린다. 틀에 따라 기울여 두면 플레이어가
   상대의 스킬 딱지를 보고 '저 녀석은 돌격해 오겠구나' 를 짐작할 수 있다. */
export function pickTactic(type, rnd) {
  const B = CONST.TACTIC_BIAS;
  if (!B || !CONST.TACTIC) return 'none';
  const t = ROBOT_TYPES[type] || MONSTER_TYPES[type] || {};
  const fx = (t.skill && t.skill.fx) || {};
  const key = fx.noMiss ? 'noMiss'
            : (fx.hits > 1) ? 'multiHit'
            : fx.ignoreDef ? 'ignoreDef' : 'plain';
  const w = B[key] || B.plain;
  if (!w) return 'none';
  const list = Object.keys(w).filter(k => CONST.TACTIC[k]).map(k => ({ k, w: w[k] }));
  return list.length ? weighted(list, rnd).k : 'none';
}

export function makeHuntTarget(tier, myLevel, rnd, uid) {
  const list = MONSTER_BY_RARITY[tier];
  if (!list || !list.length) return null;
  const type = pick(list, rnd);
  const off = (CONST.HUNT[tier] || {}).lv || 0;
  const level = clamp(myLevel + off, 1, oppLvMax());
  return { kind: 'monster', type, level, skillLv: 0, parts: [],
           slots: { WEAPON: null, FRAME: null, BOOSTER: null, CORE: null },
           callsign: MONSTER_TYPES[type].name };
}

/* 토벌 보상. 스크랩과 파츠가 본체다 — 크레딧은 아레나의 절반이 안 된다.
   그래야 '돈을 벌려면 아레나, 재료를 캐려면 토벌'로 갈린다. */
export function rollHuntRewards(win, tier, enemyLv, rnd, uid) {
  const H = CONST.HUNT[tier] || CONST.HUNT.C;
  const base = rollBattleRewards(win, enemyLv, rnd, uid);
  /* 경험치는 대전의 CONST.HUNT_EXP_X 배 — 파밍 자리라 레벨업 수단이 되면 안 된다 */
  const X = CONST.HUNT_EXP_X ?? 1;
  if (!win) return { ...base, cr: Math.round(base.cr * H.crX), sc: Math.round(base.sc * H.scX * 0.4),
                     expGain: Math.round(base.expGain * X), core: 0, part: null, tier };

  let sc = Math.round((18 + ri(0, 14, rnd)) * H.scX);
  let part = null;
  if (rnd() < H.partP) {
    const p = rollPart(enemyLv, rnd, uid());
    const auto = autoScrapValue(p.rarity);
    if (auto) sc += auto; else part = p;      // 잡템은 행을 만들지 않는다
  }
  return { win: true, tier,
           cr: Math.round((120 + enemyLv * 14) * H.crX),
           sc, core: rnd() < H.coreP ? 1 : 0, part,
           expGain: Math.max(1, Math.round(base.expGain * X)), fatAdd: base.fatAdd };
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
    const p = rollPart(enemyLv, rnd, uid());
    const auto = autoScrapValue(p.rarity);
    if (auto) sc += auto; else part = p;    // 잡템은 행을 만들지 않는다
  }
  return { win: true, cr, sc, core, part, expGain, fatAdd };
}

/* stats.js 의 battleExp 와 같은 식. 순환 import 를 피하려고 여기 둔다. */
export const battleExpFor = enemyLv => 26 + enemyLv * 9;

/* ── 토벌 주간 입장 한도 (2026-09-19 사용자 지시) ──────────────────────
   CONST.HUNT_WEEK 에 적힌 등급만 센다(지금 UQ · EP · BOSS). **일요일 00:00 한국 시각**에 풀린다.
   주 번호는 2026-01-04(일) 00:00 KST = 2026-01-03 15:00 UTC 를 0주로 센다.
   시련(js/trial.js)은 월요일 00:00 UTC 로 따로 센다 — 둘을 합치지 않는다(사용자가 정한 초기화 시각이 다르다).

   저장은 player.hunt_wk(021) — { w: 주 번호, n: { UQ: 3, … } }. **주가 바뀌면 읽는 순간 0 으로 본다** —
   일요일 0시에 모든 행을 지우는 일(크론)을 두지 않는다. 다음에 쓸 때 새 주 번호로 덮인다. */
export const HUNT_EPOCH = Date.UTC(2026, 0, 3, 15);
const HUNT_WEEK_MS = 7 * 24 * 3600 * 1000;
export const huntWeekOf = now => Math.floor((now - HUNT_EPOCH) / HUNT_WEEK_MS);
export const huntResetAt = now => HUNT_EPOCH + (huntWeekOf(now) + 1) * HUNT_WEEK_MS;
export const huntCap = tier => ((CONST.HUNT_WEEK || {})[tier]) | 0;          // 0 = 한도 없음

/* 저장값(문자열·객체·null) → 이번 주 기준의 { w, n }. 지난주 것이면 빈 기록이다. */
export function readHuntWeek(raw, now) {
  let o = raw;
  if (typeof raw === 'string') { try { o = JSON.parse(raw); } catch { o = null; } }
  const w = huntWeekOf(now);
  const n = {};
  if (o && typeof o === 'object' && o.w === w && o.n && typeof o.n === 'object')
    for (const t of Object.keys(CONST.HUNT_WEEK || {})) n[t] = Math.max(0, o.n[t] | 0);
  return { w, n };
}
/* 이번 주에 그 등급을 더 들어갈 수 있는 횟수. 한도가 없는 등급은 Infinity */
export function huntLeft(hw, tier) {
  const cap = huntCap(tier);
  return cap ? Math.max(0, cap - ((hw && hw.n && hw.n[tier]) | 0)) : Infinity;
}
/* 화면에 내려 보내는 모양 — 등급마다 { used, cap } 와 초기화 시각 */
export function huntWeekView(raw, now) {
  const hw = readHuntWeek(raw, now), out = {};
  for (const t of Object.keys(CONST.HUNT_WEEK || {})) out[t] = { used: hw.n[t] | 0, cap: huntCap(t) };
  return { tiers: out, resetAt: huntResetAt(now) };
}
