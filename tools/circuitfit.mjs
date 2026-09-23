/* 코어 서킷 — 기체마다 갈래 14종의 값어치를 잰다.
 *
 *   node tools/circuitfit.mjs [판수=400] [--write]
 *
 * 가격표(CIRCUIT.unit)는 뽑기 76종 평균이라, 같은 갈래라도 기체에 따라 값어치가 다르다
 * (재생 장갑은 회피가 높은 기체에게만, 스킬 증폭은 스킬이 센 기체에게만 쓸모 있다 — 2026-09-23 circuitcheck).
 *
 * 기체 · 갈래마다 g 를 찾는다 — **그 갈래 8칸을 20점어치로 늘렸을 때(×2.5) 같은 기체 0점을 60% 로 이기는 배수.**
 * 그리고 그 기체의 14종 중앙값으로 나눈다. 기체 사이의 크기는 가격표 하나로 같게 두고, 기체 안의 갈래끼리만 맞춘다 —
 * 같은 기체끼리 붙이는 측정은 탱커일수록 판이 길어 작은 차이가 크게 번지므로(실측: HUSK · MULE 은 모든 갈래가 ×0.4 밑)
 * 기체 사이 비교에 쓰면 탱커가 특성을 못 받는다.
 *
 * --write 면 data/circuit.js 의 CIRCUIT_FIT 을 다시 쓴다. 배수가 FIT_BAND 밖인 갈래는 js/circuit.js 가 고르지 않는다.
 */
import fs from 'node:fs';
import { ROBOT_TYPES } from '../data/balance.js';
import { CIRCUIT_THEMES } from '../data/circuit.js';
import { computeStats } from '../js/stats.js';
import { makeUnit, simulate } from '../js/sim.js';
import { branchFx, applyCircuit, FIT_BAND } from '../js/circuit.js';

const N = Math.max(100, Number(process.argv[2]) || 400);
const WRITE = process.argv.includes('--write');
const GOAL = .60, LO = .15, HI = 6;
const ids = Object.keys(ROBOT_TYPES).filter(i => !ROBOT_TYPES[i].story && !ROBOT_TYPES[i].monster);
const THEMES = Object.keys(CIRCUIT_THEMES);
const EMPTY = { WEAPON: null, FRAME: null, BOOSTER: null, CORE: null };
const BR = Object.fromEntries(THEMES.map(th => [th, branchFx(th)]));

let S = 29; const ns = () => ((S = Math.imul(S, 1103515245) + 12345 | 0) >>> 0);
function wr(t, A, B, n) { let k = 0;
  for (let i = 0; i < n; i++) {
    const ev = i % 2 ? simulate(makeUnit('P', t, A), makeUnit('E', t, B), ns()) : simulate(makeUnit('E', t, B), makeUnit('P', t, A), ns());
    if (ev[ev.length - 1].winner === (i % 2 ? 'P' : 'E')) k++;              // winner 는 자리(첫 인자 = P)다
  } return k / n; }
const median = a => { const b = a.slice().sort((x, y) => x - y), m = b.length >> 1; return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2; };

const out = {};
let outside = 0;
for (const t of ids) {
  const base = computeStats({ uid: 'x', type: t, level: 60, exp: 0, fat: 0, skillLv: 0, slots: EMPTY }, []);
  const g = {};
  for (const th of THEMES) {
    const at = m => { const fx = {}; for (const k in BR[th]) fx[k] = BR[th][k] * 2.5 * m; return wr(t, applyCircuit(base, fx), base, N); };
    let lo = LO, hi = HI;
    if (at(HI) < GOAL) { g[th] = HI; continue; }
    if (at(LO) > GOAL) { g[th] = LO; continue; }
    for (let i = 0; i < 8; i++) { const m = Math.sqrt(lo * hi); if (at(m) < GOAL) lo = m; else hi = m; }   // 배수라 기하 중앙으로 자른다
    g[th] = Math.sqrt(lo * hi);
  }
  const md = median(Object.values(g));
  out[t] = Object.fromEntries(THEMES.map(th => [th, Math.round(g[th] / md * 100) / 100]));
  const bad = THEMES.filter(th => out[t][th] < FIT_BAND[0] || out[t][th] > FIT_BAND[1]);
  outside += bad.length;
  console.log(`${t.padEnd(10)} ${ROBOT_TYPES[t].rarity.padEnd(3)} 중앙 ×${md.toFixed(2)}  안 맞는 갈래 ${bad.length ? bad.map(th => `${CIRCUIT_THEMES[th].ko}×${out[t][th]}`).join(' · ') : '없음'}`);
}
console.log(`\n안 맞는 갈래 합계 ${outside} / ${ids.length * THEMES.length} (범위 ${FIT_BAND.join(' ~ ')})`);

if (WRITE) {
  const p = new URL('../data/circuit.js', import.meta.url);
  const src = fs.readFileSync(p, 'utf8');
  const body = 'export const CIRCUIT_FIT = {\n' + ids.map(t => `  ${t}: { ${THEMES.map(th => `${th}: ${out[t][th]}`).join(', ')} },`).join('\n') + '\n};';
  const next = src.replace(/export const CIRCUIT_FIT = \{[\s\S]*?\n\};/, body);
  if (next === src) throw new Error('CIRCUIT_FIT 자리를 못 찾았다');
  fs.writeFileSync(p, next);
  console.log(`data/circuit.js CIRCUIT_FIT 을 다시 썼다 — 기체 ${ids.length} × 갈래 ${THEMES.length}`);
}
