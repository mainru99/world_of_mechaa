/* 코어 서킷 전문 별 — 값 맞추기. (2026-09-25 · 갈래 8칸을 다 찍은 뒤 포인트 1 로 찍는다)
 *
 *   node tools/circuitnotable.mjs [판수=200] [--only 갈래,갈래] [--goal 0.52] [--write]
 *
 * 전문 별 14종마다, 그 갈래를 가진 기체들로 **같은 빌드(그 갈래 8 + 나머지 갈래 4씩) 에 전문 별만 켠 쪽 대 끈 쪽** 을 붙인다(Lv.60 맨몸).
 * 평균 승률이 GOAL(52% ≈ 포인트 4개어치) 이 되는 값을 찾는다 — 전문 별은 '8칸을 다 찍은 보상' 이라 포인트 하나보다 크고 빌드를 뒤집을 만큼은 아니게.
 * 값에 끝이 있는 것(경량 프레임 게이지 · 표적 연산)은 한도 안에서 찾고, 못 닿으면 한도를 쓴다.
 * --write 면 data/circuit.js 의 CIRCUIT_NOTABLE 을 다시 쓴다.
 */
import fs from 'node:fs';
import { ROBOT_TYPES } from '../data/balance.js';
import { CIRCUIT, CIRCUIT_THEMES, CIRCUIT_NOTABLE } from '../data/circuit.js';
import { computeStats } from '../js/stats.js';
import { makeUnit, simulate } from '../js/sim.js';
import { themesOf, circuitFx, applyCircuit } from '../js/circuit.js';

const N = Math.max(60, Number(process.argv[2]) || 200);
const WRITE = process.argv.includes('--write');
const ONLY = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1].split(',') : null;
/* 목표 승률 — 2026-09-25 55% 로 잡았더니 전문 별 하나가 포인트 10개어치라(포인트 하나 ≈ 0.5%p) 두 갈래를 끝까지 찍는 빌드가
   늘 이기고 고르게 찍는 빌드가 늘 꼴찌였다(빌드 차 중앙 6 → 14%p). 52% ≈ 포인트 4개어치로 낮췄다 */
const GOAL = Number(process.argv.includes('--goal') ? process.argv[process.argv.indexOf('--goal') + 1] : 0.52);
/* 찾는 범위 — [아래, 위]. 경량 프레임은 행동 게이지(0 ~ 99), 나머지는 비율 */
const RANGE = { light: [0, 99], heavy: [0, 4], evade: [0, 2], regen: [0, 6], target: [0, 0.08], aim: [0, 1.5], absorb: [0, 1],
                armor: [0, 0.6], fortress: [0, 0.8], cool: [0, 0.8], amp: [0, 1], pierce: [0, 0.6], overdrive: [0, 0.5], accel: [0, 0.4] };
const ids = Object.keys(ROBOT_TYPES).filter(i => !ROBOT_TYPES[i].story && !ROBOT_TYPES[i].monster);
const BR = 'ABCD', EMPTY = { WEAPON: null, FRAME: null, BOOSTER: null, CORE: null };
const chain = (b, n) => Array.from({ length: n }, (_, i) => b + (i + 1));

let S = 41; const ns = () => ((S = Math.imul(S, 1103515245) + 12345 | 0) >>> 0);
function wr(t, A, B, n) { let k = 0;
  for (let i = 0; i < n; i++) {
    const ev = i % 2 ? simulate(makeUnit('P', t, A), makeUnit('E', t, B), ns()) : simulate(makeUnit('E', t, B), makeUnit('P', t, A), ns());
    if (ev[ev.length - 1].winner === (i % 2 ? 'P' : 'E')) k++;
  } return k / n; }
const avg = a => a.reduce((x, y) => x + y, 0) / a.length;

const out = { ...CIRCUIT_NOTABLE };
for (const th of Object.keys(CIRCUIT_THEMES).filter(x => !ONLY || ONLY.includes(x))) {
  const cases = [];
  for (const t of ids) {
    const b = themesOf(t).indexOf(th); if (b < 0) continue;
    const base = computeStats({ type: t, level: 60, fat: 0, skillLv: 0, slots: EMPTY }, []);
    const taken = [...chain(BR[b], 8), ...[...BR].filter((_, i) => i !== b).flatMap(x => chain(x, 4))];
    const off = applyCircuit(base, circuitFx(t, taken));
    cases.push({ t, base, taken, off });
  }
  const at = v => avg(cases.map(c => wr(c.t, applyCircuit(c.base, circuitFx(c.t, c.taken), { [th]: v }), c.off, N)));
  let [lo, hi] = RANGE[th];
  const top = at(hi);
  let v;
  if (top < GOAL) v = hi;
  else { for (let i = 0; i < 9; i++) { const m = (lo + hi) / 2; if (at(m) < GOAL) lo = m; else hi = m; } v = (lo + hi) / 2; }
  v = th === 'light' ? Math.round(v * 10) / 10 : Math.round(v * 1000) / 1000;
  out[th] = v;
  const now = at(v);
  console.log(`${CIRCUIT_THEMES[th].ko.padEnd(6)} ${th.padEnd(9)} 기체 ${String(cases.length).padStart(2)} · 지금 ${CIRCUIT_NOTABLE[th]} → ${v}  (승률 ${(now * 100).toFixed(1)}%${top < GOAL ? ' · 한도에서도 목표에 못 닿음' : ''})`);
}

if (WRITE) {
  const p = new URL('../data/circuit.js', import.meta.url);
  const src = fs.readFileSync(p, 'utf8');
  const keys = Object.keys(out);
  const body = 'export const CIRCUIT_NOTABLE = {\n' + [keys.slice(0, 7), keys.slice(7)].map(k => '  ' + k.map(x => `${x}: ${out[x]}`).join(', ') + ',').join('\n') + '\n};';
  const next = src.replace(/export const CIRCUIT_NOTABLE = \{[\s\S]*?\n\};/, body);
  if (next === src) throw new Error('CIRCUIT_NOTABLE 자리를 못 찾았다');
  fs.writeFileSync(p, next);
  console.log('data/circuit.js CIRCUIT_NOTABLE 을 다시 썼다');
}
