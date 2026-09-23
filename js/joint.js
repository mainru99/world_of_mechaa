/* 합동전 — 편성 두 기가 **한꺼번에** 보스 하나와 싸운다. 순수 함수. (2026-09-21)
 *
 * 브라우저와 Worker 가 같이 import 한다. DOM 도 Math.random 도 쓰지 않는다.
 *
 * ── 왜 따로 두나 ────────────────────────────────────────
 * 1:1(js/sim.js)은 **한 글자도 건드리지 않는다.** 대전·토벌·점령·전선이 전부 그 위에 있고,
 * 거기 한 줄이 흔들리면 옛 전투 재생이 전부 갈린다. 합동전은 토벌 보스와 레이드에만 쓴다.
 * 판정 식(dmgCalc · 관통 · 치명 · 흡혈 · 전술)은 sim.js 와 같다 — 그 위에 둘이 더해졌다.
 *
 *   ① 자리 — 전위(F)와 후위(B)
 *      보스의 평타는 **전위만** 노린다. 후위는 맞지 않는 대신 공격력이 오른다(JOINT.backAtk).
 *      전위가 쓰러지면 후위가 모든 공격을 받는다. 그래서 '누구를 앞에 세우나' 가 판단이 된다.
 *   ② 보스의 스킬 조준(aim) — 보스마다 다르다
 *      front 강타(전위) · back 저격(후위) · all 광역(둘 다, JOINT.aoe 배)
 *   ③ 요구 조건 특성(traits) — 보스에 붙어 **이기는 조합**을 바꾼다. 표는 CONST.TRAIT
 *
 * ── 이벤트 ──────────────────────────────────────────────
 * sim.js 와 같은 모양에 **누가(i)** 가 붙는다. 보스는 side 'E' · i 0.
 *   {t:'turn', side, i, sp} {t:'skill', side, i, name, aim}
 *   {t:'hit', side, i, dside, di, miss, dmg, crit, thp, cut?}   cut = 역장이 깎은 양
 *   {t:'heal', side, i, hp, amt, src?}                           src 'regen' = 보스 재생
 *   {t:'down', side:'P', i}  {t:'trait', k:'enrage'}  {t:'end', winner, bossHp, turns}
 */
import { CONST } from '../data/balance.js';
import { COMBAT_TYPES } from './units.js';
import { makeUnit, dmgCalc, mulberry32, afterSkill, SPECIAL, PARRY, tryParry } from './sim.js';

const { CRIT_MULT, DEF_PEN } = CONST;
export const JOINT = () => CONST.JOINT || { backAtk: 1.15, aoe: 0.6, boss: { hp: 1, atk: 1 } };
export const TRAIT = () => CONST.TRAIT || {};

/* 보스마다 합동전에서 쓰는 조준과 특성. 몬스터 표에 없으면 강타 · 특성 없음 */
export function jointOf(type) {
  const j = (COMBAT_TYPES[type] || {}).joint || {};
  return { aim: j.aim || 'front', traits: (j.traits || []).filter(k => TRAIT()[k]),
           hp: j.hp || 1, atk: j.atk || 1 };
}

/* 특성 중 **스탯으로 끝나는 것**(중장갑 · 위상 회피)은 여기서 미리 반영한다.
   서버가 이 결과를 응답에 실어 보내므로 클라는 다시 계산하지 않는다. */
export function traitStats(st, traits) {
  const o = { ...st }, T = TRAIT();
  for (const k of traits || []) {
    const t = T[k]; if (!t) continue;
    if (t.def) o.def = Math.round(o.def * t.def);
    if (t.eva) o.eva = Math.min(0.6, (o.eva || 0) + t.eva);
  }
  return o;
}

/* 합동전 보스의 스탯 — 두 기가 동시에 치므로 1:1 보스 그대로면 너무 약하다.
   JOINT.boss 배수 × 보스별 배수(joint.hp · atk)를 건 뒤 특성을 얹는다. 레이드는 여기에 RAID.bossX 가 한 번 더 걸린다. */
export function jointBossStats(raw, traits, type) {
  const B = JOINT().boss || {}, j = type ? jointOf(type) : { hp: 1, atk: 1 };
  const s = { ...raw,
    hp:  Math.max(1, Math.round(raw.hp  * (B.hp  || 1) * j.hp)),
    atk: Math.max(1, Math.round(raw.atk * (B.atk || 1) * j.atk)) };
  /* 재생량은 **여기서 한 번** 정해 스탯에 싣는다. 레이드는 이 뒤에 체력을 12배로 키우는데,
     비율로 두면 재생도 12배가 되어 아무도 못 깎는다(실측: 한 판 피해 0%). */
  const rg = (traits || []).includes('regen') && TRAIT().regen;
  if (rg) s.regenHp = Math.max(1, Math.round(s.hp * (rg.pct || 0)));
  return traitStats(s, traits);
}

/* 편성 — 배열 순서가 곧 자리다(0 전위 · 1 후위). 한 기뿐이면 전위 하나로 싸운다. */
/* 공명 — 두 기가 같은 집안(family) 아종이면 그 집안 이름, 아니면 null. 서버 · 재생 · 분석이 같은 함수를 쓴다 */
export function resonanceOf(list) {
  const f = (list || []).slice(0, 2).map(m => COMBAT_TYPES[m && m.type] && COMBAT_TYPES[m.type].family);
  return f.length === 2 && f[0] && f[0] === f[1] && (JOINT().resonance || 0) > 0 ? f[0] : null;
}

export function makeTeam(list) {
  const J = JOINT(), res = resonanceOf(list) ? 1 + J.resonance : 1;
  return list.slice(0, 2).map((m, i) => {
    const u = makeUnit(m.name, m.type, m.stats, m.tactic);
    u.side = 'P'; u.i = i; u.pos = i === 0 ? 'F' : 'B';
    if (i === 1) u.atk = Math.max(1, Math.round(u.atk * (J.backAtk || 1)));
    /* 공명 — 난수를 더 뽑지 않는다. 같은 집안이 아니면 이 줄은 아무것도 안 한다(예전 전투 그대로) */
    if (res !== 1) u.atk = Math.max(1, Math.round(u.atk * res));
    return u;
  });
}

export function makeBoss(name, type, stats, tactic, traits) {
  const u = makeUnit(name, type, stats, tactic), T = TRAIT();
  u.side = 'E'; u.i = 0;
  u.tr = {};
  for (const k of traits || []) if (T[k]) u.tr[k] = T[k];
  if (u.tr.overcharge) u.spGain *= (u.tr.overcharge.sp || 1);
  u.regenHp = stats.regenHp || 0;
  u.turns = 0;
  return u;
}

/* 한 타. sim.js 의 doHit 과 **난수를 뽑는 순서가 같다**(회피 → 치명 → 파츠 관통 → 구간).
   특성은 난수를 더 뽑지 않는다 — 치명 무효도 치명 판정은 굴린 뒤 배수만 뺀다. */
function hit(A, D, ev, rnd, o) {
  if (!o.noMiss && rnd() < D.eva) {
    D.dodged = true;
    ev.push({ t: 'hit', side: A.side, i: A.i, dside: D.side, di: D.i, miss: true, dmg: 0, crit: false, thp: D.hp });
    return;
  }
  D.dodged = false;
  const dt = D.tr || {};
  let crit = o.alwaysCrit || (!o.noCrit && rnd() < A.crit);
  if (dt.critnull) crit = false;                         // 굴린 뒤에 지운다 — 난수열은 그대로
  let pen = o.ignoreDef ? (o.ignoreDef === true ? DEF_PEN : o.ignoreDef) : 0;
  if (A.pen > 0 && rnd() < A.pen) pen = Math.max(pen, A.penAmt);
  const def = Math.max(0, D.def) * (1 - pen);
  let m = (o.mult || 1) * (crit ? CRIT_MULT : 1);
  if (o.execute && D.hp < D.maxhp * SPECIAL().execHp) m *= 1 + o.execute;     // 특화기술 — sim.js doHit 과 같다
  let tk = (D.taken != null ? D.taken : 1) * (o.skill ? (D.takenSkill != null ? D.takenSkill : 1) : 1);
  if (D.mark) tk *= 1 + D.mark;
  let dmg = Math.max(1, Math.round(dmgCalc(A.atk, def, rnd, m, A.spread) * tk));
  /* 역장 — 타격마다 '평타 한 대 기댓값의 flat 배' 를 깎는다. 배수와 무관한 고정량이라
     여러 번 약하게 치는 연타가 크게 손해를 보고, 한 방이 큰 공격은 거의 그대로다. */
  let cut = 0;
  if (dt.field) {
    const one = A.atk * 100 / (100 + def);
    cut = Math.min(dmg - 1, Math.round(one * (dt.field.flat || 0)));
    dmg -= cut;
  }
  let absorb = 0;
  if (D.shield > 0) { absorb = Math.min(D.shield, dmg); D.shield -= absorb; }
  D.hp = Math.max(0, D.hp - (dmg - absorb));
  const e = { t: 'hit', side: A.side, i: A.i, dside: D.side, di: D.i, miss: false, dmg, crit, thp: D.hp };
  if (cut > 0) e.cut = cut;
  if (absorb) e.absorb = absorb;
  ev.push(e);
  if (o.shred && D.hp > 0) {
    if (D.def0 == null) D.def0 = D.def;
    D.def = Math.max(Math.round(D.def0 * SPECIAL().shredFloor), Math.round(D.def * (1 - o.shred)));
  }
  /* 흡수 차단 — 이 상대를 때려서는 회복하지 못한다 */
  if (o.drain && !dt.antiheal) {
    const hl = Math.max(1, Math.round(dmg * o.drain));
    const got = Math.min(A.maxhp, A.hp + hl) - A.hp;    // 실제로 찬 양(sim.js 와 같다)
    A.hp += got;
    if (got > 0) ev.push({ t: 'heal', side: A.side, i: A.i, hp: A.hp, amt: got });
  }
}

const alive = u => u.hp > 0;
/* 보스가 노리는 대상. 평타와 강타는 전위, 저격은 후위, 광역은 살아 있는 전부 */
function targets(team, aim) {
  const [F, B] = team;
  if (aim === 'all') return team.filter(alive);
  if (aim === 'back') return [B && alive(B) ? B : F].filter(u => u && alive(u));
  return [F && alive(F) ? F : B].filter(u => u && alive(u));
}

function skill(A, foes, ev, rnd, aim, allies) {
  const sk = (COMBAT_TYPES[A.type] || COMBAT_TYPES.mule).skill, fx = sk.fx || { mult: 1.8 };
  ev.push({ t: 'skill', side: A.side, i: A.i, name: sk.name, aim: A.side === 'E' ? aim : undefined });
  const up = { ...fx, mult: (fx.mult || 1) * (A.skillMul || 1), skill: true };
  if (A.side === 'E' && aim === 'all') up.mult *= (JOINT().aoe || 1);
  const first = foes()[0];
  if (fx.mark && first) { first.mark = Math.max(first.mark || 0, fx.mark);
    ev.push({ t: 'mark', side: A.side, i: A.i, dside: first.side, di: first.i, amt: fx.mark }); }
  const hits = fx.hits || 1;
  for (let h = 0; h < hits; h++) {
    const list = foes();
    if (!list.length) break;
    for (const D of list) if (alive(D)) hit(A, D, ev, rnd, up);
  }
  /* 방벽 · 수리는 **체력 비율이 가장 낮은 아군**에게 — 후위 지원기가 전위를 받친다.
     동률이면 앞 자리(전위)가 먼저. 재밍은 스킬이 노린 상대에게 */
  const to = (allies || [A]).filter(alive).reduce((a, b) => (b.hp / b.maxhp < a.hp / a.maxhp ? b : a), A);
  const D = first && alive(first) ? first : foes()[0];
  if (D) afterSkill(A, D, A.side, D.side, ev, fx, to);
  else afterSkill(A, { hp: 0 }, A.side, null, ev, fx, to);
}

/* team  makeTeam 의 결과(자리 순)  ·  boss  makeBoss 의 결과
   opts  { aim, maxTurns }  — 제한에 걸리면 보스가 버틴 것이라 **패배**다(1:1 과 다르다:
   1:1 은 점령이 막히지 않게 P 승으로 두었지만, 보스를 못 쓰러뜨렸는데 이긴 것이 되면 안 된다) */
export function simulateJoint(team, boss, seed, opts) {
  opts = opts || {};
  const aim = opts.aim || 'front', maxTurns = opts.maxTurns || 600;
  const rnd = mulberry32(seed >>> 0);
  const ev = [{ t: 'start', n: team.length }];
  const all = [...team, boss];
  const g = all.map(() => rnd() * 100);          // 게이지 시작값을 흩뿌린다(sim.js 머리말과 같은 이유)
  const teamUp = () => team.some(alive);
  const dead = new Set();
  let guard = 0, T = 0;                         // T — 흐른 시간(실시간 재생 · 흘려내기). sim.js 와 같다

  while (alive(boss) && teamUp() && guard < maxTurns) {
    guard++;
    let dt = Infinity;
    for (let k = 0; k < all.length; k++) if (alive(all[k])) dt = Math.min(dt, (100 - g[k]) / all[k].spd);
    for (let k = 0; k < all.length; k++) if (alive(all[k])) g[k] += all[k].spd * dt;
    T += dt;
    const act = [];
    for (let k = 0; k < all.length; k++) if (alive(all[k]) && g[k] >= 99.999) act.push(k);
    /* 같은 틱이면 빠른 쪽이 먼저. 속도까지 같으면 시드 난수로 가른다 */
    act.sort((a, b) => all[b].spd - all[a].spd);
    for (let x = 0; x + 1 < act.length; x++)
      if (all[act[x]].spd === all[act[x + 1]].spd && rnd() < 0.5) [act[x], act[x + 1]] = [act[x + 1], act[x]];

    for (const k of act) {
      const A = all[k];
      if (!alive(A) || !alive(boss) || !teamUp()) continue;
      g[k] -= 100;
      A.sp = Math.min(100, A.sp + (A.spGain != null ? A.spGain : 30));
      ev.push({ t: 'turn', side: A.side, i: A.i, sp: A.sp, at: Math.round(T * 1e4) / 1e4 });

      if (A === boss) {
        A.turns++;
        const tr = A.tr;
        /* 재생 — 보스 턴 시작마다 최대 내구의 일부를 되찾는다. 흡혈과 달리 막을 수 없다 */
        if (tr.regen && A.hp < A.maxhp) {
          const hl = A.regenHp || Math.max(1, Math.round(A.maxhp * (tr.regen.pct || 0)));
          const got = Math.min(A.maxhp, A.hp + hl) - A.hp;
          A.hp += got;
          if (got > 0) ev.push({ t: 'heal', side: 'E', i: 0, hp: A.hp, amt: got, src: 'regen' });
        }
        /* 광폭화 — 정해진 턴이 지나면 공격력이 한 번 크게 오른다. 오래 끌수록 불리하다 */
        if (tr.enrage && A.turns === (tr.enrage.turn | 0)) {
          A.atk = Math.max(1, Math.round(A.atk * (tr.enrage.atk || 1)));
          ev.push({ t: 'trait', k: 'enrage' });
        }
      } else if (A.regen > 0 && A.dodged) {        // 파츠 재생(회피 직후) — sim.js 와 같다
        const hl = Math.max(1, Math.round(A.maxhp * A.regen));
        const got = Math.min(A.maxhp, A.hp + hl) - A.hp;
        A.hp += got;
        A.dodged = false;
        if (got > 0) ev.push({ t: 'heal', side: 'P', i: A.i, hp: A.hp, amt: got });
      }

      const foes = A === boss ? (a => () => targets(team, a)) : (() => () => [boss].filter(alive));
      if (A.sp >= 100) { A.sp = 0; skill(A, A === boss ? foes(aim) : foes(), ev, rnd, aim, A === boss ? [boss] : team); }
      else {
        const D = (A === boss ? targets(team, 'front') : [boss])[0];
        /* 흘려내기 — 평타만. 맞는 쪽의 게이지는 all 에서의 자리로 찾는다 */
        if (D && tryParry(A, D, g[all.indexOf(D)], T, rnd)) {
          g[k] -= PARRY().delay || 0;
          ev.push({ t: 'parry', side: D.side, i: D.i, dside: A.side, di: A.i });
        } else if (D) hit(A, D, ev, rnd, {});
      }
      A.lastAt = T;
      if (A.stackMax > 0 && A.stack < A.stackMax) {
        A.stack++;
        A.spd = Math.max(1, A.spd0 * (1 + A.stack * A.stackSpd));
      }
      /* 재밍으로 밀린 게이지(특화기술) */
      for (let q = 0; q < all.length; q++) if (all[q].push) { g[q] -= all[q].push; all[q].push = 0; }
      for (const u of team) if (!alive(u) && !dead.has(u)) { dead.add(u); ev.push({ t: 'down', side: 'P', i: u.i }); }
    }
  }
  const winner = alive(boss) ? 'E' : 'P';
  ev.push({ t: 'end', winner, bossHp: boss.hp, turns: guard });
  return ev;
}

/* 한 번에 — 서버·클라·도구가 같은 입력으로 같은 전투를 얻는다.
   spec = { team:[{name,type,stats,tactic}], boss:{name,type,stats,tactic,traits}, seed, aim, maxTurns } */
export function runJoint(spec) {
  const team = makeTeam(spec.team);
  const boss = makeBoss(spec.boss.name, spec.boss.type, spec.boss.stats, spec.boss.tactic, spec.boss.traits);
  const events = simulateJoint(team, boss, spec.seed, { aim: spec.aim, maxTurns: spec.maxTurns });
  const end = events[events.length - 1];
  return { events, team, boss, win: end.winner === 'P', bossHp: end.bossHp, turns: end.turns };
}

/* 요구 조건 한 줄씩 — 화면의 딱지와 도구의 표가 같이 쓴다 */
export function traitLines(traits) {
  const T = TRAIT();
  return (traits || []).filter(k => T[k]).map(k => ({ k, ko: T[k].ko, desc: T[k].desc, answer: T[k].answer }));
}
export const AIM_KO = { front: '전위 강타', back: '후위 저격', all: '광역' };

/* ── 편성 — 자리와 전술은 전투 직전에 고른다(사용자 결정) ─────────────
   클라가 보낸 값은 **믿지 않고 걸러서** 받는다. 자리는 편성(두 기) 안의 uid 만,
   전술은 표에 있는 이름만. 모자라면 편성 순서로 채운다 — 이상한 값이 와도 싸움은 선다. */
export const validTactic = t => (typeof t === 'string' && CONST.TACTIC && CONST.TACTIC[t]) ? t : 'none';
export function jointOrder(squadUids, want) {
  const sq = (squadUids || []).filter(Boolean);
  const out = [];
  for (const u of Array.isArray(want) ? want : []) if (typeof u === 'string' && sq.includes(u) && !out.includes(u)) out.push(u);
  for (const u of sq) if (!out.includes(u)) out.push(u);
  return out.slice(0, 2);
}
export function jointTactics(order, want) {
  const w = want && typeof want === 'object' ? want : {};
  return order.map(u => validTactic(w[u]));
}

/* ── 이 기체가 이 특성의 답인가 ─────────────────────────
   화면이 편성 칸에 ✓/✗ 로 띄우고, 도구(tools/jointcheck.mjs)가 같은 기준으로 잰다.
   true 답 · false 약점 · null 기체와 상관없음(전술로 푸는 특성 등).
   **판정에는 안 쓴다** — 안내일 뿐이다. 파츠 관통 같은 것은 여기서 안 센다. */
export function traitFit(type, k, tactic) {
  const fx = ((COMBAT_TYPES[type] || {}).skill || {}).fx || {};
  const hits = fx.hits || 1, mult = fx.mult || 1;
  switch (k) {
    case 'armor':      return !!(fx.ignoreDef || fx.shred);
    case 'field':      return hits === 1 && mult >= 1.6 ? true : hits >= 3 ? false : null;
    case 'phase':      return !!fx.noMiss;
    case 'critnull':   return fx.alwaysCrit ? false : null;
    case 'antiheal':   return fx.drain ? false : null;
    case 'regen':      return mult * hits >= 2.0 || fx.execute ? true : null;
    case 'overcharge': return fx.jam || tactic === 'guard' ? true : tactic === 'rush' ? false : null;
    case 'enrage':     return fx.jam || fx.execute ? true : null;
    default:           return null;
  }
}
