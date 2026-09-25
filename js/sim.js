/* 전투 시뮬레이션 — 순수 함수. DOM 도 Math.random 도 쓰지 않는다.
 *
 * 같은 (양측 스탯 + 시드) 면 항상 같은 이벤트 목록이 나온다.
 * 서버가 결과를 계산하고 클라이언트는 같은 시드로 애니메이션만 재생하므로,
 * 이 파일이 조금이라도 갈리면 서버와 클라가 다른 전투를 보게 된다. */
import { CONST } from '../data/balance.js';
import { COMBAT_TYPES } from './units.js';

const { CRIT_MULT, DEF_PEN } = CONST;
/* 특화기술 기준값(2026-09-21). 표가 없으면 기본값 — 특화기술을 가진 기체가 없으면 아예 쓰이지 않는다 */
export const SPECIAL = () => CONST.SPECIAL || { execHp: 0.35, shredFloor: 0.7, decay: 0.2 };

/* ── 흘려내기 (2026-09-21 · 사용자 결정) ─────────────────────────
   평타가 **동시에** 오갈 때 — 맞는 쪽도 막 치려던 참이거나 막 친 참일 때 — 확률로 흘려낸다.
   '동시' 는 맞는 쪽 **자기 한 턴의 win 비율** 안이다(아래 tryParry 주석).
   흘려낸 쪽은 피해가 0, 친 쪽은 게이지가 delay 만큼 밀린다. 확률은 속도가 빠를수록 높다.
   **스킬은 흘려낼 수 없다** — 모아서 쓰는 한 방의 무게를 지킨다.
   난수는 '동시' 일 때만 굴린다. CONST.PARRY 가 없으면 한 번도 안 굴린다. */
export const PARRY = () => CONST.PARRY || null;
export function tryParry(A, D, gD, T, rnd) {
  const R = PARRY();
  if (!R || D.hp <= 0) return false;
  /* 구간은 **맞는 쪽 자신의 한 턴** 비율이다. 짧은 쪽 턴으로 잡았더니 느린 기체는 그 구간에 거의 못 들어가
     중장갑이 크게 손해를 봤다(GLACIER −13%p · MULE −10%p). 이렇게 두면 누구나 같은 비율로 '동시' 에 선다 */
  const W = R.win * 100 / Math.max(1, D.spd);
  const soon = (100 - gD) / Math.max(1, D.spd) <= W;          // 맞는 쪽이 곧 친다
  const just = D.lastAt != null && T - D.lastAt <= W;           // 맞는 쪽이 방금 쳤다
  if (!soon && !just) return false;
  const pr = Math.min(R.pMax, Math.max(R.pMin, R.p * Math.pow(Math.max(1, D.spd) / Math.max(1, A.spd), R.spdK ?? 0.5)));
  return rnd() < pr;
}

/* 공격력 구간 — 같은 스탯이라도 매 타격의 실제 위력이 이 폭 안에서 흔들린다.
   기체마다 다르다: 저격형은 거의 같은 수로 맞히고(±12%), 포격형은 크게 흔들린다(±34%).
   폭이 넓을수록 약자가 뒤집을 여지가 커지고, 좁을수록 우세한 쪽이 확실히 이긴다.
   구형 아레나 스냅샷에는 이 값이 없으므로 기체 표에서 되찾는다. */
export const spreadOf = type =>
  (COMBAT_TYPES[type] && COMBAT_TYPES[type].spread != null) ? COMBAT_TYPES[type].spread : CONST.SPREAD;

/* 시드 난수 — 전투 안의 모든 판정은 이것만 쓴다 */
export function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

/* 전술 — 출격 전에 고른 한 수. 전투 규칙 위에 곱해지는 얇은 한 겹이다.
   여기서 스탯에 미리 반영해 두면 아래 전투 루프는 두 줄만 알면 된다(spGain·taken).
   모르는 이름이나 빈 값이면 none 이라 **예전과 완전히 같게 돈다.** */
const TAC = k => (CONST.TACTIC && (CONST.TACTIC[k] || CONST.TACTIC.none)) ||
                 { sp: 1, taken: 1, eva: 0, atk: 1 };

export function makeUnit(name, type, st, tactic) {
  const T = TAC(tactic);
  const u = { name, type, maxhp: st.hp, hp: st.hp,
           atk: Math.max(1, Math.round(st.atk * (T.atk != null ? T.atk : 1))),
           def: st.def, spd: st.spd,
           crit: st.crit,
           /* 회피 상한 60% 는 그대로다. 전술로 그 위를 넘지 못한다 */
           eva: Math.min(0.6, st.eva + (T.eva || 0)),
           sp: 0,
           tactic: tactic || 'none',
           spGain: 30 * (T.sp != null ? T.sp : 1),      // 턴마다 차는 SP
           taken: T.taken != null ? T.taken : 1,        // 받는 피해 배수 (평타·스킬 모두)
           /* 스킬로 받는 피해에만 더 걸리는 배수. taken 만으로는 상성이 생기지 않는다 —
              상대가 무엇을 하든 똑같이 깎기 때문이다. 스킬에만 걸어야 '스킬을 자주 쓰는
              상대(돌격)를 겨냥한다'는 뜻이 생긴다. */
           takenSkill: T.takenSkill != null ? T.takenSkill : 1,
           /* 스킬 강화 배수. computeStats 가 넣어 준다. 없으면 1 이라 예전과 같다 */
           skillMul: st.skillMul != null ? st.skillMul : 1,
           spread: st.spread != null ? st.spread : spreadOf(type),
           /* ── 파츠 고유 효과 ──────────────────────────────────
              전부 **없으면 0/undefined 라 예전과 완전히 같게 돈다.** 특히 pen 은
              0 일 때 난수를 뽑지 않는다 — 뽑으면 파츠와 무관한 전투까지 난수열이
              밀려서 예전 재생과 어긋난다.
              값은 computeStats 가 파츠에서 모아 실어 준다(js/stats.js). */
           pen: st.pen || 0,                      // 타격마다 방어를 관통할 확률
           penAmt: st.penAmt != null ? st.penAmt : 0.5,   // 관통했을 때 깎는 비율
           regen: st.regen || 0,                  // 직전 공격을 피했으면 최대 내구의 이만큼 회복
           stackSpd: st.stackSpd || 0,            // 공격할 때마다 속도가 이 비율씩 (음수)
           stackMax: st.stackMax || 0,
           stack: 0, spd0: st.spd, dodged: false,
           /* ── 코어 서킷(2026-09-25) — 전부 **없으면 0/null 이라 예전과 완전히 같게 돈다**(난수도 안 뽑는다).
              regenT  내 턴마다 최대 내구의 이만큼 회복(서킷 '재생 장갑'. 파츠의 regen 은 회피 직후라 다르다)
              nb      찍은 전문 별 { 갈래 종류: 값 } — 갈래 8칸을 다 찍은 뒤 포인트 1 로 찍는다(js/circuit.js circuitNotables) */
           regenT: st.regenT || 0,
           nb: st.nb || null };
  if (u.nb) u.nbCounter = true;                          // 회피 기동 반격은 첫 턴 전에도 한 번 된다
  return u;
}

/* ── 코어 서킷 전문 별(2026-09-25) ─────────────────────────────
   1:1(simulate)과 합동전(js/joint.js)이 **같은 함수**를 부른다. 난수를 뽑는 것은 '회피 기동'의 반격 한 타뿐이고,
   그것도 그 전문 별이 있을 때만이다. 전문 별이 없으면 아래 함수들은 1 을 돌려주거나 아무것도 안 한다.
     armor     내구 50% 이하일 때 받는 피해 ×(1−v)           fortress  받는 스킬 피해 ×(1−v)
     absorb    치명타로 받는 추가 피해 ×(1−v)                 overdrive 평타 피해 ×(1+v)
     heavy     전투 첫 명중 ×(1+v)                             light     행동 게이지를 v 만큼 앞서 시작(gaugeStart)
     accel     가속이 다 차면 치명 +v(stackStep)               aim       치명 배수 +v
     target    같은 상대를 연속으로 맞히면 한 번마다 +v(5번까지)  evade     피한 직후 반격 한 타(피해 ×v · 내 턴 사이 한 번)
     regen     턴마다 회복이 내구가 낮을수록 커진다 ×(1+v×잃은 비율)
     amp       스킬 첫 타 방어 관통 v                          cool      스킬을 쓴 뒤 내 다음 턴까지 받는 피해 ×(1−v)
     pierce    파츠 관통이 터지면 상대 방어 ×(1−v) — 상대의 턴이 세 번 올 때까지(NB_PIERCE_TURNS) */
export const NB_PIERCE_TURNS = 3;
export const NB_TARGET_MAX = 5;
/* 행동 게이지 시작값 — 경량 프레임 전문 별이 있으면 v 만큼 앞선다. 난수는 이미 뽑은 뒤라 난수열은 그대로다.
   (스킬 게이지로 했더니 턴마다 30 씩 차서 10 · 40 · 70 에서만 효과가 계단처럼 바뀌어 세기를 맞출 수 없었다) */
export const gaugeStart = (u, g) => (u.nb && u.nb.light ? Math.min(99.99, g + u.nb.light) : g);
export function nbOut(A, D, o, crit) {
  const n = A.nb; if (!n) return 1;
  let m = 1;
  if (n.overdrive && !o.skill && !o.counter) m *= 1 + n.overdrive;
  if (n.heavy && !A.nbHit) m *= 1 + n.heavy;
  A.nbHit = true;
  if (n.aim && crit) m *= (CRIT_MULT + n.aim) / CRIT_MULT;
  if (n.target) {
    if (A.nbTgt === D) A.nbRun = Math.min(NB_TARGET_MAX, (A.nbRun || 0) + 1); else { A.nbTgt = D; A.nbRun = 0; }
    m *= 1 + n.target * A.nbRun;
  }
  return m;
}
export function nbIn(D, o, crit) {
  const n = D.nb; if (!n) return 1;
  let k = 1;
  if (n.armor && D.hp < D.maxhp * 0.5) k *= 1 - n.armor;
  if (n.fortress && o.skill) k *= 1 - n.fortress;
  if (n.absorb && crit) k *= (1 + (CRIT_MULT - 1) * (1 - n.absorb)) / CRIT_MULT;
  if (n.cool && D.nbCool) k *= 1 - n.cool;
  return k;
}
/* 내 턴 시작 — 한 턴짜리 표시를 지우고, 서킷 재생을 한다. 찬 양(0 이면 사건 없음)을 돌려준다 */
export function turnStart(A) {
  if (A.defDown && --A.defDownN <= 0) A.defDown = 0;
  if (!A.nb && !(A.regenT > 0)) return 0;
  if (A.nb) { A.nbCool = false; A.nbCounter = true; }
  if (!(A.regenT > 0) || A.hp <= 0 || A.hp >= A.maxhp) return 0;
  const low = 1 - A.hp / A.maxhp, boost = A.nb && A.nb.regen ? 1 + A.nb.regen * low : 1;
  const got = Math.min(A.maxhp, A.hp + Math.max(1, Math.round(A.maxhp * A.regenT * boost))) - A.hp;
  A.hp += got;
  return got;
}
/* 스택 — 공격할 때마다 속도가 바뀐다(파츠 채프 런처는 느려지고 서킷 가속 회로는 빨라진다). 다 차면 가속 회로 전문 별 */
export function stackStep(A) {
  if (!(A.stackMax > 0) || A.stack >= A.stackMax) return;
  A.stack++;
  A.spd = Math.max(1, A.spd0 * (1 + A.stack * A.stackSpd));
  if (A.stack === A.stackMax && A.nb && A.nb.accel) A.crit = Math.min(0.75, A.crit + A.nb.accel);
}

export function dmgCalc(atk, def, rnd, mult, spread) {
  const sp = spread != null ? spread : CONST.SPREAD;
  let b = atk * 100 / (100 + Math.max(0, def));
  b *= mult; b *= 1 - sp + rnd() * 2 * sp;      // 구간 안에서 균등하게 — 기댓값은 그대로 1배
  return Math.max(1, Math.round(b));
}

export function doHit(A, D, side, dside, ev, rnd, o) {
  o = o || {};
  if (!o.noMiss && rnd() < D.eva) {
    D.dodged = true;                       // 재생 인챈트가 이걸 본다
    ev.push({ t:'hit', side, dside, miss:true, dmg:0, crit:false, thp:D.hp });
    /* 회피 기동 전문 별 — 피한 직후 반격 한 타. 반격은 반격을 부르지 않는다 */
    if (D.nb && D.nb.evade && D.nbCounter && !o.counter && D.hp > 0 && A.hp > 0) {
      D.nbCounter = false;
      doHit(D, A, dside, side, ev, rnd, { mult: D.nb.evade, counter: true });
    }
    return;
  }
  D.dodged = false;
  const crit = o.alwaysCrit || (!o.noCrit && rnd() < A.crit);
  let pen = o.ignoreDef ? (o.ignoreDef === true ? DEF_PEN : o.ignoreDef) : 0;  // 완전 무시가 아니라 부분 관통
  /* 파츠 관통(브레이커·관통 인챈트)은 **확률**이다. 스킬 관통과 겹치면 큰 쪽을 쓴다 —
     더하면 전탄 관통이 되어 방어 스탯이 통째로 의미를 잃는다.
     A.pen 이 0 이면 난수를 아예 뽑지 않는다(위 주석 참고). */
  let pr = false;
  if (A.pen > 0 && rnd() < A.pen) { pen = Math.max(pen, A.penAmt); pr = true; }
  if (o.first && A.nb && A.nb.amp) pen = Math.max(pen, A.nb.amp);          // 스킬 증폭 전문 별 — 스킬 첫 타
  let m = (o.mult || 1) * (crit ? CRIT_MULT : 1) * nbOut(A, D, o, crit);
  const def = Math.max(0, D.def) * (1 - pen) * (1 - (D.defDown || 0));
  /* ── 특화기술(2026-09-21) — **전부 난수를 뽑지 않는다.** 값이 없으면 한 줄도 안 돈다.
     그래서 특화기술이 없는 기체끼리의 전투는 예전과 이벤트까지 같다(tools/regress.mjs).
       execute  마무리 — 상대 체력이 SPECIAL.execHp 밑이면 이 타격이 (1+x) 배
       mark     표적   — 표적이 된 쪽은 모든 피해를 (1+x) 배로 받는다(D.mark)
       shield   방벽   — 받는 피해를 방벽이 먼저 먹는다(D.shield)
       shred    장갑 파쇄 — 맞힐 때마다 상대 방어를 x 비율 깎는다. 원래의 SPECIAL.shredFloor 밑으로는 안 간다 */
  if (o.execute && D.hp < D.maxhp * SPECIAL().execHp) m *= 1 + o.execute;
  /* taken 은 **최종 피해**에 건다. 방어력에 걸면 관통 스킬 앞에서 방어 전술이 무력해진다.
     스킬로 맞은 것이면 takenSkill 이 한 번 더 걸린다(o.skill 은 doSkill 이 넣어 준다). */
  let tk = (D.taken != null ? D.taken : 1) * (o.skill ? (D.takenSkill != null ? D.takenSkill : 1) : 1);
  if (D.mark) tk *= 1 + D.mark;
  tk *= nbIn(D, o, crit);
  const dmg = Math.max(1, Math.round(dmgCalc(A.atk, def, rnd, m, A.spread) * tk));
  let absorb = 0;
  if (D.shield > 0) { absorb = Math.min(D.shield, dmg); D.shield -= absorb; }
  D.hp = Math.max(0, D.hp - (dmg - absorb));
  const he = { t:'hit', side, dside, miss:false, dmg, crit, thp:D.hp };
  if (absorb) he.absorb = absorb;
  if (o.counter) he.counter = true;
  if (pr && A.nb && A.nb.pierce && D.hp > 0) { D.defDown = A.nb.pierce; D.defDownN = NB_PIERCE_TURNS; }   // 관통탄 전문 별
  ev.push(he);
  if (o.shred && D.hp > 0) {
    if (D.def0 == null) D.def0 = D.def;
    D.def = Math.max(Math.round(D.def0 * SPECIAL().shredFloor), Math.round(D.def * (1 - o.shred)));
  }
  if (o.drain) {
    const hl = Math.max(1, Math.round(dmg * o.drain));
    /* 사건의 amt 는 **실제로 찬 양**이다(2026-09-21). 가득 찬 채로 회복하면 0 이라 사건을 남기지 않는다 — 딜표 · 화면이 거짓 '+536' 을 보이지 않게 */
    const got = Math.min(A.maxhp, A.hp + hl) - A.hp;
    A.hp += got;
    if (got > 0) ev.push({ t:'heal', side, hp:A.hp, amt:got });
  }
}

export function doSkill(A, D, side, dside, ev, rnd) {   // 기체와 몬스터의 고유 스킬을 같은 규칙으로 실행한다
  const sk = (COMBAT_TYPES[A.type] || COMBAT_TYPES.mule).skill, fx = sk.fx || { mult: 1.8 };
  ev.push({ t:'skill', side, name: sk.name });
  const hits = fx.hits || 1;
  /* 강화한 스킬은 **배수만** 커진다. 타격 수나 판정(관통·확정치명·흡혈)은 그대로다 —
     거기까지 건드리면 강화가 스킬을 다른 스킬로 바꿔 버린다. */
  const up = { ...fx, mult: (fx.mult || 1) * (A.skillMul || 1), skill: true };
  /* 표적은 **맞히기 전에** 건다 — 이번 스킬의 타격부터 더 들어간다 */
  if (fx.mark && D.hp > 0) { D.mark = Math.max(D.mark || 0, fx.mark); ev.push({ t:'mark', side, dside, amt: fx.mark }); }
  for (let i = 0; i < hits; i++) { if (D.hp <= 0) break; doHit(A, D, side, dside, ev, rnd, i === 0 && A.nb ? { ...up, first: true } : up); }
  afterSkill(A, D, side, dside, ev, fx, A);
  if (A.nb && A.nb.cool) A.nbCool = true;                                 // 냉각 코어 전문 별
}

/* 스킬을 다 쏜 뒤에 붙는 특화기술 — 방벽 · 수리 · 재밍. to 는 방벽과 수리를 받을 쪽이다
   (1:1 은 자기 자신, 합동전은 체력 비율이 가장 낮은 아군 — js/joint.js).
     shield  최대 내구의 x 만큼 방벽. 쌓이지 않고 **큰 쪽**으로 갈아 끼운다
     repair  최대 내구의 x 만큼 수리
     jam     재밍 — 상대의 SP 를 x 깎고 게이지를 x 만큼 뒤로 민다(D.push · 전투 루프가 반영) */
export function afterSkill(A, D, side, dside, ev, fx, to) {
  /* 방벽 · 수리는 **쓸 때마다 SPECIAL.decay 씩 약해진다**(1 · 0.8 · 0.64 …). 안 그러면 버티는 기체끼리
     만났을 때 끝없이 버텨 한쪽이 0% 가 됐다(수리 대 요새 0% · 방벽 대 흡혈 2%). 합이 첫 값의 약 5배에서 멈춘다 */
  const fade = (fx.shield || fx.repair) ? Math.pow(1 - (SPECIAL().decay || 0), A.susN || 0) : 1;
  if (fx.shield || fx.repair) A.susN = (A.susN || 0) + 1;
  if (fx.shield && A.hp > 0 && to && to.hp > 0) {
    const amt = Math.max(1, Math.round(to.maxhp * fx.shield * fade));
    to.shield = Math.max(to.shield || 0, amt);
    ev.push({ t:'shield', side: to.side || side, i: to.i, amt, now: to.shield });
  }
  if (fx.repair && A.hp > 0 && to && to.hp > 0) {
    const hl = Math.max(1, Math.round(to.maxhp * fx.repair * fade));
    const got = Math.min(to.maxhp, to.hp + hl) - to.hp;
    to.hp += got;
    if (got > 0) ev.push({ t:'heal', side: to.side || side, i: to.i, hp: to.hp, amt: got, src: 'repair' });
  }
  if (fx.jam && D.hp > 0) {
    D.sp = Math.max(0, (D.sp || 0) - fx.jam);
    D.push = (D.push || 0) + fx.jam;
    ev.push({ t:'jam', side, dside, di: D.i, amt: fx.jam, sp: D.sp });
  }
}

/* 게이지 시작값은 **흩뿌린다.** 둘 다 0 에서 출발시키면 안 된다.

   예전에는 { P:0, E:0 } 이었다. 그러면 첫 틱에 0.001 이라도 빠른 쪽이 혼자 100 에 닿아
   공짜로 한 대 치고, 게이지는 `-= 100` 으로 나머지를 이어받으므로 **그 한 대 차이가
   판이 끝날 때까지 유지된다.** 0.3% 짜리 속도 우위가 0.3% 가 아니라 '영원히 한 대
   앞선다' 로 환전됐다. 실측(거울 대결 · spd 만 +0.001):

     같음  50.0%   +0.7%  66.9%   +2%  66.9%   +5%  66.9%   +10%  86.9%
                   └─────── 0.7% 도 5% 도 같은 값. 연속이 아니라 계단이었다 ───────┘

   그래서 속도는 '더 많이 때린다' 가 아니라 '먼저 때린다' 로만 작동했고, 화면에는
   한 대씩 주고받는 것으로 보이는데 승패는 이미 기울어 있었다. 표시 전투력이 spd 를
   선형으로 세는데 실제로는 계단이라, 같은 등급 안에서 전투력이 승패를 맞힌 비율이
   56% 밖에 안 됐다(tools/intra.mjs).

   시작값을 0~100 난수로 흩뿌리면 계단이 곡선이 된다:

     같음  50.0%   +0.7%  53.1%   +2%  59.2%   +5%  72.4%   +10%  85.6%
     전투력 적중률 56% → 88%

   시드에서 뽑으므로 서버와 클라의 재생은 그대로 일치한다. 난수 두 번을 앞에서
   먹으므로 예전 전투와 이벤트열이 달라진다 — 저장된 것은 스탯뿐이고 전투는 매번
   다시 계산하므로 재생이 깨지지는 않는다. */
export function simulate(P, E, seed) {
  const rnd = mulberry32(seed >>> 0), ev = [{ t:'start' }];
  const g = { P: rnd() * 100, E: rnd() * 100 };
  g.P = gaugeStart(P, g.P); g.E = gaugeStart(E, g.E);
  let guard = 0;
  /* T — 전투 안에서 흐른 시간. 행동마다 'turn' 이벤트에 at 으로 싣는다.
     재생이 이 시각에 맞춰 여러 기체를 **동시에** 움직인다(실시간 재생). 판정에는 흘려내기만 쓴다 */
  let T = 0;
  while (P.hp > 0 && E.hp > 0 && guard < 600) {
    guard++;
    const tP = (100 - g.P) / P.spd, tE = (100 - g.E) / E.spd, dt = Math.min(tP, tE);
    g.P += P.spd * dt; g.E += E.spd * dt;
    T += dt;
    const actors = [];
    if (g.P >= 99.999) actors.push('P');
    if (g.E >= 99.999) actors.push('E');
    /* 둘이 같은 틱에 찼을 때 누가 먼저 때리는가.
       빠른 쪽이 먼저다 — 여기까지는 의도한 대로다. 문제는 속도가 같을 때였다.
       예전에는 정렬이 안정 정렬이라 늘 P 가 먼저였고, 첫 턴은 양쪽 게이지가 0에서
       동시에 차므로 반드시 동률이다. 그래서 완전히 같은 기체끼리 붙여도
       선공측이 59.5% 를 이겼다. 아레나 수비측은 항상 E 라 늘 손해를 봤다.
       (게이지 시작값을 흩뿌린 뒤로 동률 틱 자체가 드물어졌지만, spd 가 정확히 같으면
        여전히 매 틱 동시에 차므로 이 갈림은 그대로 필요하다.)
       동률은 시드 난수로 가른다 — 결정적이라 서버와 클라의 재생은 그대로 일치한다. */
    if (actors.length === 2) {
      const d = P.spd - E.spd;
      const pFirst = d !== 0 ? d > 0 : rnd() < 0.5;
      actors[0] = pFirst ? 'P' : 'E';
      actors[1] = pFirst ? 'E' : 'P';
    }
    for (const side of actors) {
      if (P.hp <= 0 || E.hp <= 0) break;
      g[side] -= 100;
      const A = side === 'P' ? P : E, D = side === 'P' ? E : P, dside = side === 'P' ? 'E' : 'P';
      A.sp = Math.min(100, A.sp + (A.spGain != null ? A.spGain : 30));
      ev.push({ t:'turn', side, sp:A.sp, at: Math.round(T * 1e4) / 1e4 });
      /* 재생 — **직전 상대 공격을 피했으면** 내 턴 시작에 회복한다.
         원안은 '5초간 피해를 받지 않으면' 이었는데, 1:1 에서 그건 15연속 회피를
         뜻해서 사실상 안 터진다(20% 회피 기준 10의 -11승). 조건을 회피에 묶으면
         회피 빌드에서만 살아나는 옵션이라는 정체성이 생긴다. */
      if (A.regen > 0 && A.dodged && A.hp > 0) {
        const hl = Math.max(1, Math.round(A.maxhp * A.regen));
        const got = Math.min(A.maxhp, A.hp + hl) - A.hp;
        A.hp += got;
        A.dodged = false;
        if (got > 0) ev.push({ t:'heal', side, hp:A.hp, amt:got });
      }
      { const got = turnStart(A); if (got > 0) ev.push({ t:'heal', side, hp:A.hp, amt:got, src:'circuit' }); }
      if (A.sp >= 100) { A.sp = 0; doSkill(A, D, side, dside, ev, rnd); }
      else if (tryParry(A, D, g[dside], T, rnd)) {
        g[side] -= PARRY().delay || 0;
        ev.push({ t:'parry', side: dside, dside: side });
      }
      else doHit(A, D, side, dside, ev, rnd, {});
      A.lastAt = T;
      /* 재밍으로 밀린 게이지 — 특화기술이 없으면 D.push 가 없어 아무 일도 없다 */
      if (D.push) { g[dside] -= D.push; D.push = 0; }
      /* 스택 — 쏠수록 느려진다(채프 런처). **초기화가 없다.**
         원안은 '2초간 공격하지 않으면 초기화' 였는데 1:1 에서는 자기 턴마다 반드시
         공격하므로 그 조건이 영원히 성립하지 않는다. 초기화를 빼면 오히려 원안의
         컨셉대로다 — 처음엔 가장 빠른 중화기, 끝엔 가장 느린. */
      stackStep(A);
    }
  }
  ev.push({ t:'end', winner: P.hp > 0 ? 'P' : (E.hp > 0 ? 'E' : 'P') });
  return ev;
}
