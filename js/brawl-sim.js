/* 난투 — 팀 대 팀 전투. 순수 함수. DOM · Math.random 없음. (2026-10-07 · docs/plan/brawl-2026-10-07.md ①)
 *
 * 합동전(js/joint.js)을 **양쪽 모두 팀**으로 넓힌 것이다. 한 타 · 스킬 판정은 합동전의 것을 그대로 부른다
 * (jointHit · jointSkill — 관통 · 치명 · 흡혈 · 특화기술 · 코어 서킷 · 흘려내기가 1 : 1 · 합동전과 같은 규칙).
 * 1 : 1(sim.js) · 합동전(joint.js) · 교대 전투는 **한 글자도 바뀌지 않는다**.
 *
 * ── 자리 ────────────────────────────────────────────────
 *   한 팀 4칸 — 0 · 1 앞줄, 2 · 3 뒷줄. 칸 번호가 곧 열이다(0 · 2 왼쪽 열, 1 · 3 오른쪽 열).
 *   · 공격은 **상대 앞줄**을 노린다. 같은 열이 살아 있으면 그쪽, 없으면 다른 앞줄, 앞줄이 다 쓰러지면 뒷줄(같은 열 먼저)
 *   · 뒷줄은 앞줄이 서 있는 동안 맞지 않는 대신 공격력이 오른다(합동전 후위와 같은 JOINT.backAtk)
 *   · 연타 스킬은 타마다 대상을 다시 고른다 — 앞을 쓰러뜨리면 다음 타가 뒤로 간다
 *   · 방벽 · 수리는 **체력 비율이 가장 낮은 아군**에게(합동전과 같다) — 지원기가 앞줄을 받친다
 *   팀이 4기보다 적으면 남은 칸은 비어 있다(앞줄부터 채운다).
 *
 * ── 끝 ──────────────────────────────────────────────────
 *   한쪽이 다 쓰러지면 끝. 시간이 길어지면 **과열**(BRAWL.heat)이 양쪽 모두를 깎는다 — 바토몬의 서든 데스와 같은 장치로,
 *   방벽 · 수리끼리 끝없이 버티는 판을 끝낸다. 그래도 제한(maxTurns)에 닿으면 **남은 체력 비율 합**이 큰 쪽이 이긴다.
 *
 * ── 이벤트 ──────────────────────────────────────────────
 *   합동전과 같은 모양에 양쪽 다 i 가 붙는다(P 0 ~ 3 · E 0 ~ 3).
 *   {t:'start', p:n, e:n} {t:'turn', side, i, sp, at} {t:'skill', side, i, name} {t:'hit', side, i, dside, di, …}
 *   {t:'heal', side, i, hp, amt} {t:'parry', …} {t:'shield'|'mark'|'jam', …} {t:'heat', dmgPct}
 *   {t:'down', side, i} {t:'end', winner, by:'ko'|'time', hp:{P,E}, turns}
 */
import { CONST } from '../data/balance.js';
import { makeUnit, mulberry32, PARRY, tryParry, turnStart, stackStep, gaugeStart } from './sim.js';
import { JOINT, jointHit, jointSkill } from './joint.js';

export const BRAWL_SIM = () => ({ maxTurns: 1200, heat: { at: 15, step: 0.03, every: 1 }, ...((CONST.BRAWL || {}).sim || {}) });

const alive = u => u && u.hp > 0;
const front = slot => slot < 2;
const col = slot => slot % 2;

/* 한 팀을 만든다. list[k] = { name, type, stats, tactic } 이고 **배열의 칸 번호가 자리다**(빈칸은 null) */
export function makeSide(list, side) {
  const J = JOINT();
  const out = [];
  (list || []).slice(0, 4).forEach((m, slot) => {
    if (!m) return;
    const u = makeUnit(m.name, m.type, m.stats, m.tactic);
    u.side = side; u.i = slot; u.slot = slot; u.pos = front(slot) ? 'F' : 'B';
    if (!front(slot)) u.atk = Math.max(1, Math.round(u.atk * (J.backAtk || 1)));
    out.push(u);
  });
  return out;
}

/* A 가 노릴 상대 하나 — 앞줄 같은 열 → 다른 앞줄 → 뒷줄 같은 열 → 다른 뒷줄 */
export function pickTarget(A, foes) {
  const live = foes.filter(alive);
  if (!live.length) return null;
  const fr = live.filter(u => front(u.slot)), pool = fr.length ? fr : live;
  return pool.find(u => col(u.slot) === col(A.slot)) || pool[0];
}

export function simulateBrawl(teamP, teamE, seed, opts) {
  const S = { ...BRAWL_SIM(), ...(opts || {}) };
  const rnd = mulberry32(seed >>> 0);
  const ev = [{ t: 'start', p: teamP.length, e: teamE.length }];
  const all = [...teamP, ...teamE];
  const g = all.map(u => gaugeStart(u, rnd() * 100));
  const up = t => t.some(alive);
  const dead = new Set();
  let guard = 0, T = 0, heatN = 0, nextHeat = S.heat ? S.heat.at : Infinity;   // heat: null 이면 과열 없음(측정용)

  while (up(teamP) && up(teamE) && guard < S.maxTurns) {
    guard++;
    let dt = Infinity;
    for (let k = 0; k < all.length; k++) if (alive(all[k])) dt = Math.min(dt, (100 - g[k]) / all[k].spd);
    for (let k = 0; k < all.length; k++) if (alive(all[k])) g[k] += all[k].spd * dt;
    T += dt;

    /* 과열 — 흐른 시간이 at 을 넘으면 every 마다 양쪽 모두 최대 내구의 step × n 만큼 깎인다(n 은 몇 번째인지). 난수 없음 */
    while (S.heat && T >= nextHeat && up(teamP) && up(teamE)) {
      heatN++; nextHeat += S.heat.every;
      const pct = S.heat.step * heatN, hits = [];
      for (const u of all) if (alive(u)) {
        const d = Math.max(1, Math.round(u.maxhp * pct));
        u.hp = Math.max(0, u.hp - d);
        hits.push({ side: u.side, i: u.i, dmg: d, thp: u.hp });
      }
      /* 사건 하나에 맞은 기체를 다 담는다 — 'hit' 로 남기면 딜표(js/insight.js)가 과열을 누군가의 공격으로 센다 */
      ev.push({ t: 'heat', n: heatN, dmgPct: Math.round(pct * 1000) / 1000, hits });
      for (const u of all) if (!alive(u) && !dead.has(u)) { dead.add(u); ev.push({ t: 'down', side: u.side, i: u.i }); }
    }
    if (!up(teamP) || !up(teamE)) break;

    const act = [];
    for (let k = 0; k < all.length; k++) if (alive(all[k]) && g[k] >= 99.999) act.push(k);
    act.sort((a, b) => all[b].spd - all[a].spd);
    for (let x = 0; x + 1 < act.length; x++)
      if (all[act[x]].spd === all[act[x + 1]].spd && rnd() < 0.5) [act[x], act[x + 1]] = [act[x + 1], act[x]];

    for (const k of act) {
      const A = all[k];
      if (!alive(A) || !up(teamP) || !up(teamE)) continue;
      const mine = A.side === 'P' ? teamP : teamE, foes = A.side === 'P' ? teamE : teamP;
      g[k] -= 100;
      A.sp = Math.min(100, A.sp + (A.spGain != null ? A.spGain : 30));
      ev.push({ t: 'turn', side: A.side, i: A.i, sp: A.sp, at: Math.round(T * 1e4) / 1e4 });

      if (A.regen > 0 && A.dodged) {                       // 파츠 재생(회피 직후) — sim.js · joint.js 와 같다
        const hl = Math.max(1, Math.round(A.maxhp * A.regen));
        const got = Math.min(A.maxhp, A.hp + hl) - A.hp;
        A.hp += got; A.dodged = false;
        if (got > 0) ev.push({ t: 'heal', side: A.side, i: A.i, hp: A.hp, amt: got });
      }
      { const got = turnStart(A); if (got > 0) ev.push({ t: 'heal', side: A.side, i: A.i, hp: A.hp, amt: got, src: 'circuit' }); }

      const target = () => { const D = pickTarget(A, foes); return D ? [D] : []; };
      if (A.sp >= 100) { A.sp = 0; jointSkill(A, target, ev, rnd, undefined, mine); }
      else {
        const D = pickTarget(A, foes);
        if (D && tryParry(A, D, g[all.indexOf(D)], T, rnd)) {
          g[k] -= PARRY().delay || 0;
          ev.push({ t: 'parry', side: D.side, i: D.i, dside: A.side, di: A.i });
        } else if (D) jointHit(A, D, ev, rnd, {});
      }
      A.lastAt = T;
      stackStep(A);
      for (let q = 0; q < all.length; q++) if (all[q].push) { g[q] -= all[q].push; all[q].push = 0; }
      for (const u of all) if (!alive(u) && !dead.has(u)) { dead.add(u); ev.push({ t: 'down', side: u.side, i: u.i }); }
    }
  }
  const frac = t => t.reduce((s, u) => s + Math.max(0, u.hp) / u.maxhp, 0);
  const ko = !up(teamP) || !up(teamE);
  const winner = up(teamP) && !up(teamE) ? 'P' : up(teamE) && !up(teamP) ? 'E'
               : frac(teamP) >= frac(teamE) ? 'P' : 'E';
  ev.push({ t: 'end', winner, by: ko ? 'ko' : 'time', hp: { P: Math.round(frac(teamP) * 1000) / 1000, E: Math.round(frac(teamE) * 1000) / 1000 },
            turns: guard, at: Math.round(T * 100) / 100 });
  return ev;
}

/* 한 번에 — spec = { p:[{name,type,stats,tactic}|null ×4], e:[…], seed } */
export function runBrawl(spec) {
  const P = makeSide(spec.p, 'P'), E = makeSide(spec.e, 'E');
  const events = simulateBrawl(P, E, spec.seed >>> 0, spec.opts);
  return { events, win: events[events.length - 1].winner === 'P', P, E };
}
