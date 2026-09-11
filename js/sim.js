/* 전투 시뮬레이션 — 순수 함수. DOM 도 Math.random 도 쓰지 않는다.
 *
 * 같은 (양측 스탯 + 시드) 면 항상 같은 이벤트 목록이 나온다.
 * 서버가 결과를 계산하고 클라이언트는 같은 시드로 애니메이션만 재생하므로,
 * 이 파일이 조금이라도 갈리면 서버와 클라가 다른 전투를 보게 된다. */
import { CONST } from '../data/balance.js';
import { COMBAT_TYPES } from './units.js';

const { CRIT_MULT, DEF_PEN } = CONST;

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
  return { name, type, maxhp: st.hp, hp: st.hp,
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
           stack: 0, spd0: st.spd, dodged: false };
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
    ev.push({ t:'hit', side, dside, miss:true, dmg:0, crit:false, thp:D.hp }); return;
  }
  D.dodged = false;
  const crit = o.alwaysCrit || (!o.noCrit && rnd() < A.crit);
  let pen = o.ignoreDef ? (o.ignoreDef === true ? DEF_PEN : o.ignoreDef) : 0;  // 완전 무시가 아니라 부분 관통
  /* 파츠 관통(브레이커·관통 인챈트)은 **확률**이다. 스킬 관통과 겹치면 큰 쪽을 쓴다 —
     더하면 전탄 관통이 되어 방어 스탯이 통째로 의미를 잃는다.
     A.pen 이 0 이면 난수를 아예 뽑지 않는다(위 주석 참고). */
  if (A.pen > 0 && rnd() < A.pen) pen = Math.max(pen, A.penAmt);
  const m = (o.mult || 1) * (crit ? CRIT_MULT : 1), def = Math.max(0, D.def) * (1 - pen);
  /* taken 은 **최종 피해**에 건다. 방어력에 걸면 관통 스킬 앞에서 방어 전술이 무력해진다.
     스킬로 맞은 것이면 takenSkill 이 한 번 더 걸린다(o.skill 은 doSkill 이 넣어 준다). */
  const tk = (D.taken != null ? D.taken : 1) * (o.skill ? (D.takenSkill != null ? D.takenSkill : 1) : 1);
  const dmg = Math.max(1, Math.round(dmgCalc(A.atk, def, rnd, m, A.spread) * tk));
  D.hp = Math.max(0, D.hp - dmg);
  ev.push({ t:'hit', side, dside, miss:false, dmg, crit, thp:D.hp });
  if (o.drain) {
    const hl = Math.max(1, Math.round(dmg * o.drain));
    A.hp = Math.min(A.maxhp, A.hp + hl);
    ev.push({ t:'heal', side, hp:A.hp, amt:hl });
  }
}

export function doSkill(A, D, side, dside, ev, rnd) {   // 기체와 몬스터의 고유 스킬을 같은 규칙으로 실행한다
  const sk = (COMBAT_TYPES[A.type] || COMBAT_TYPES.mule).skill, fx = sk.fx || { mult: 1.8 };
  ev.push({ t:'skill', side, name: sk.name });
  const hits = fx.hits || 1;
  /* 강화한 스킬은 **배수만** 커진다. 타격 수나 판정(관통·확정치명·흡혈)은 그대로다 —
     거기까지 건드리면 강화가 스킬을 다른 스킬로 바꿔 버린다. */
  const up = { ...fx, mult: (fx.mult || 1) * (A.skillMul || 1), skill: true };
  for (let i = 0; i < hits; i++) { if (D.hp <= 0) break; doHit(A, D, side, dside, ev, rnd, up); }
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
  let guard = 0;
  while (P.hp > 0 && E.hp > 0 && guard < 600) {
    guard++;
    const tP = (100 - g.P) / P.spd, tE = (100 - g.E) / E.spd, dt = Math.min(tP, tE);
    g.P += P.spd * dt; g.E += E.spd * dt;
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
      A.sp = Math.min(100, A.sp + (A.spGain != null ? A.spGain : 30)); ev.push({ t:'turn', side, sp:A.sp });
      /* 재생 — **직전 상대 공격을 피했으면** 내 턴 시작에 회복한다.
         원안은 '5초간 피해를 받지 않으면' 이었는데, 1:1 에서 그건 15연속 회피를
         뜻해서 사실상 안 터진다(20% 회피 기준 10의 -11승). 조건을 회피에 묶으면
         회피 빌드에서만 살아나는 옵션이라는 정체성이 생긴다. */
      if (A.regen > 0 && A.dodged && A.hp > 0) {
        const hl = Math.max(1, Math.round(A.maxhp * A.regen));
        A.hp = Math.min(A.maxhp, A.hp + hl);
        A.dodged = false;
        ev.push({ t:'heal', side, hp:A.hp, amt:hl });
      }
      if (A.sp >= 100) { A.sp = 0; doSkill(A, D, side, dside, ev, rnd); }
      else doHit(A, D, side, dside, ev, rnd, {});
      /* 스택 — 쏠수록 느려진다(채프 런처). **초기화가 없다.**
         원안은 '2초간 공격하지 않으면 초기화' 였는데 1:1 에서는 자기 턴마다 반드시
         공격하므로 그 조건이 영원히 성립하지 않는다. 초기화를 빼면 오히려 원안의
         컨셉대로다 — 처음엔 가장 빠른 중화기, 끝엔 가장 느린. */
      if (A.stackMax > 0 && A.stack < A.stackMax) {
        A.stack++;
        A.spd = Math.max(1, A.spd0 * (1 + A.stack * A.stackSpd));
      }
    }
  }
  ev.push({ t:'end', winner: P.hp > 0 ? 'P' : (E.hp > 0 ? 'E' : 'P') });
  return ev;
}
