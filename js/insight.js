/* 전투 분석 — 딜표와 승패 요인. 순수 함수. DOM 없음 (2026-09-21 · 사용자 결정)
 *
 * ① 딜표(damageTable) — 전투 사건에서 **정확히** 센다. 기체마다
 *      평타 피해 · 횟수 / 스킬 피해 · 횟수 / 치명 · 빗나감 / 흘려내기 성공 · 당함 / 회복(흡혈 · 수리 · 재생) / 방벽이 막은 양
 *    평타인지 스킬인지는 사건 순서로 가른다 — 'skill' 이 나온 행동 안의 타격이 스킬 타격이다.
 *
 * ② 승패 요인(insight1 · insightJoint) — 같은 전투를 **조건 하나만 바꿔** 여러 시드로 다시 돌려 추정한다.
 *      추정 승률 · 전술이 준 몫 · 더 나았을 전술 · (합동전) 자리를 바꿨다면 · 요구 조건이 깎은 몫 · 운
 *    상대의 전술은 이번 판의 것으로 고정한다(보이지 않는 정보라 바꾸는 것이 뜻이 없다).
 *    시드는 이번 판 시드에서 파생한다 — 같은 판을 다시 봐도 같은 분석이 나온다.
 *
 * 서버는 이것을 쓰지 않는다. 화면이 결과 창을 그린 뒤에 돌린다(재생과 같은 입력 · 같은 규칙이라 서버 판정과 어긋나지 않는다). */
import { CONST } from '../data/balance.js';
import { makeUnit, simulate } from './sim.js';
import { runJoint } from './joint.js';

export const TACTICS = () => Object.keys(CONST.TACTIC || { none: 1 });
const key = (side, i) => side + (i | 0);

/* ── ① 딜표 ───────────────────────────────────────────── */
export function damageTable(events) {
  const T = {};
  const u = (side, i) => (T[key(side, i)] ||= { side, i: i | 0, normal: 0, nHits: 0, skill: 0, sHits: 0,
    crit: 0, miss: 0, parry: 0, parried: 0, heal: 0, absorbed: 0 });
  let cur = null;                       // 지금 행동 중인 쪽과, 그 행동이 스킬인지
  for (const e of events) {
    if (e.t === 'turn') { cur = { k: key(e.side, e.i), skill: false }; u(e.side, e.i); }
    else if (e.t === 'skill') { if (cur && cur.k === key(e.side, e.i)) cur.skill = true; }
    else if (e.t === 'hit') {
      const a = u(e.side, e.i); u(e.dside, e.di);
      const sk = !!(cur && cur.k === key(e.side, e.i) && cur.skill);
      if (e.miss) { a.miss++; continue; }
      if (sk) { a.skill += e.dmg; a.sHits++; } else { a.normal += e.dmg; a.nHits++; }
      if (e.crit) a.crit++;
      if (e.absorb) u(e.dside, e.di).absorbed += e.absorb;
    }
    else if (e.t === 'parry') { u(e.side, e.i).parry++; u(e.dside, e.di).parried++; }
    else if (e.t === 'heal') u(e.side, e.i).heal += e.amt || 0;
  }
  for (const k in T) T[k].total = T[k].normal + T[k].skill;
  return T;
}

/* 이번 판 시드에서 k 번째 다시 돌릴 시드 */
const reseed = (seed, k) => ((seed >>> 0) ^ Math.imul(k + 1, 0x9E3779B1)) >>> 0;

/* ── ② 1:1 ────────────────────────────────────────────
   spec = { P:{name,type,stats,tactic}, E:{name,type,stats,tactic}, seed, win } */
export function estimate1(spec, n = 40, tacP) {
  let w = 0;
  for (let k = 0; k < n; k++) {
    const P = makeUnit(spec.P.name, spec.P.type, spec.P.stats, tacP != null ? tacP : spec.P.tactic);
    const E = makeUnit(spec.E.name, spec.E.type, spec.E.stats, spec.E.tactic);
    if (simulate(P, E, reseed(spec.seed, k)).at(-1).winner === 'P') w++;
  }
  return w / n;
}

const TKO = k => ((CONST.TACTIC || {})[k] || {}).ko || '균형';
const pp = x => `${x >= 0 ? '+' : '−'}${Math.round(Math.abs(x) * 100)}%p`;
const pc = x => `${Math.round(x * 100)}%`;
const luckLine = (win, base) =>
  win && base < 0.35 ? { k: 'luck', text: `추정 승률 ${pc(base)}에서 이겼다 — 운이 따른 판` }
  : !win && base > 0.65 ? { k: 'luck', text: `추정 승률 ${pc(base)}였는데 졌다 — 운이 없었던 판` }
  : { k: 'base', text: `이 조건의 추정 승률 ${pc(base)}` };

export function insight1(spec, n = 40) {
  const base = estimate1(spec, n);
  const lines = [luckLine(!!spec.win, base)];
  const cur = spec.P.tactic || 'none';
  const alt = {};
  for (const k of TACTICS()) alt[k] = k === cur ? base : estimate1(spec, n, k);
  if (cur !== 'none') {
    const d = base - alt.none;
    if (Math.abs(d) >= 0.06) lines.push({ k: 'tactic', v: d, text: `전술 '${TKO(cur)}'가 승률을 ${pp(d)} ${d > 0 ? '올렸다' : '깎았다'}` });
  }
  const best = Object.keys(alt).reduce((a, b) => (alt[b] > alt[a] ? b : a), cur);
  if (best !== cur && alt[best] - base >= 0.08)
    lines.push({ k: 'tip', v: alt[best] - base, text: `전술 '${TKO(best)}'였다면 ${pp(alt[best] - base)} — 상대의 스킬 틀을 다시 볼 것` });
  return { base, alt, lines };
}

/* ── ② 합동전 · 레이드 ───────────────────────────────
   spec = { team:[{name,type,stats,tactic}], boss:{name,type,stats,tactic,traits}, aim, seed, win, maxTurns, raid }
   레이드는 승패가 아니라 **깎은 양**으로 잰다(보스를 못 쓰러뜨리는 것이 보통이다) */
export function estimateJoint(spec, n = 24, over = {}) {
  let w = 0, dmg = 0;
  const team = over.team || spec.team, traits = over.traits || spec.boss.traits;
  for (let k = 0; k < n; k++) {
    const r = runJoint({ seed: reseed(spec.seed, k), aim: spec.aim, maxTurns: spec.maxTurns,
      team, boss: { ...spec.boss, traits } });
    if (r.win) w++;
    dmg += spec.boss.stats.hp - r.bossHp;
  }
  return { win: w / n, dmg: dmg / n };
}

export function insightJoint(spec, n = 24) {
  const base = estimateJoint(spec, n);
  const val = x => (spec.raid ? x.dmg : x.win);
  const rel = (a, b) => (spec.raid ? (a - b) / Math.max(1, b) : a - b);     // 레이드는 피해의 몇 %
  const fmtD = d => (spec.raid ? `피해 ${d >= 0 ? '+' : '−'}${Math.round(Math.abs(d) * 100)}%` : pp(d));
  const lines = [spec.raid
    ? { k: 'base', text: `이 편성의 한 판 평균 피해 ${Math.round(base.dmg).toLocaleString('ko-KR')}` }
    : luckLine(!!spec.win, base.win)];
  const out = { base, lines, swap: null, tac: null, traits: null };
  if (spec.team.length > 1) {
    const s = estimateJoint(spec, n, { team: [spec.team[1], spec.team[0]] });
    const d = rel(val(s), val(base)); out.swap = d;
    if (Math.abs(d) >= (spec.raid ? 0.08 : 0.06))
      lines.push({ k: 'swap', v: d, text: `전위 · 후위를 바꿨다면 ${fmtD(d)}` + (d < 0 ? ' — 지금 자리가 맞았다' : ' — 자리를 바꿔 볼 것') });
  }
  if (spec.team.some(m => (m.tactic || 'none') !== 'none')) {
    const t = estimateJoint(spec, n, { team: spec.team.map(m => ({ ...m, tactic: 'none' })) });
    const d = rel(val(base), val(t)); out.tac = d;
    if (Math.abs(d) >= (spec.raid ? 0.08 : 0.06)) lines.push({ k: 'tactic', v: d, text: `고른 전술이 ${fmtD(d)} ${d > 0 ? '보탰다' : '깎았다'}` });
  }
  if ((spec.boss.traits || []).length) {
    const f = estimateJoint(spec, n, { traits: [] });
    const d = rel(val(base), val(f)); out.traits = d;
    if (d <= -0.06) lines.push({ k: 'traits', v: d, text: `보스의 요구 조건이 ${fmtD(d)} — 답을 가진 기체를 넣으면 줄어든다` });
  }
  return out;
}

/* 흘려내기 · 치명 같은 사건을 한 줄로 — 딜표를 읽기 전에 눈에 들어오게 */
export function eventLines(table, mine) {
  const lines = [];
  const my = Object.values(table).filter(r => mine(r)), foe = Object.values(table).filter(r => !mine(r));
  const sum = (rs, f) => rs.reduce((s, r) => s + r[f], 0);
  const pOk = sum(my, 'parry'), pBad = sum(foe, 'parry');
  if (pOk || pBad) lines.push({ k: 'parry', text: `흘려내기 — 내가 ${pOk}번 흘렸고 ${pBad}번 흘려졌다` });
  const mt = sum(my, 'total'), ms = sum(my, 'skill');
  if (mt > 0) lines.push({ k: 'share', text: `내 피해의 ${Math.round(ms / mt * 100)}%가 스킬, ${Math.round((mt - ms) / mt * 100)}%가 평타` });
  return lines;
}
