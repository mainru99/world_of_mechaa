/* 코어 서킷 검사 — 규칙이 맞나, 빌드끼리 공평한가.
 *
 *   node tools/circuitcheck.mjs [판수=160] [레벨=60]
 *
 * ① 규칙 — 모든 뽑기 기체의 별자리 모양 · 찍기 판정 · 효과 합이 맞는지(단언)
 * ② 0점 상대 — 대표 빌드 29개(한 갈래 끝까지 둘 + 반 갈래 · 네 갈래 고르게 · 한 갈래 + 나머지 반)가
 *    같은 기체 0점을 몇 % 로 이기나. 계획서의 첫 목표는 55~65%
 * ③ 빌드끼리 — 같은 기체 안에서 대표 빌드 29개를 서로 붙여, 가장 센 빌드와 가장 약한 빌드의 평균 승률 차.
 *    이게 크면 '정답 빌드' 가 있다는 뜻이다(2026-09-23 계획서 수치 그대로는 22%p)
 */
import { ROBOT_TYPES } from '../data/balance.js';
import { CIRCUIT, CIRCUIT_FIT } from '../data/circuit.js';
import { computeStats, traitPoints } from '../js/stats.js';
import { makeUnit, simulate } from '../js/sim.js';
import { constellation, themesOf, blockOf, checkTaken, circuitFx, applyCircuit } from '../js/circuit.js';

const N = Math.max(20, Number(process.argv[2]) || 160);
const LV = Math.max(1, Math.min(60, Number(process.argv[3]) || 60));
const PTS = traitPoints(LV);
const ids = Object.keys(ROBOT_TYPES).filter(i => !ROBOT_TYPES[i].story && !ROBOT_TYPES[i].monster);
const BR = 'ABCD'.slice(0, CIRCUIT.branches), K = CIRCUIT.stars;

/* ── ① 규칙 ─────────────────────────────── */
let fail = 0;
const ok = (c, m) => { if (!c) { fail++; console.log('  실패 —', m); } };
for (const t of ids) {
  const s = constellation(t);
  ok(s.length === BR.length * (K + 1), `${t} 별 수 ${s.length}`);
  ok(new Set(themesOf(t)).size === BR.length, `${t} 갈래가 겹친다`);
  ok(s.filter(x => x.locked).length === BR.length, `${t} 전문 별 수`);
  ok(blockOf(t, [], 'A2', PTS) !== null, `${t} A1 없이 A2 가 찍힌다`);
  ok(blockOf(t, ['A1'], 'A2', PTS) === null, `${t} A1 뒤에 A2 가 안 찍힌다`);
  ok(blockOf(t, [], 'A*', PTS) !== null, `${t} 전문 별이 찍힌다`);
  ok(checkTaken(t, ['A1', 'A3'], PTS) !== null, `${t} 건너뛴 목록이 통과한다`);
  ok(checkTaken(t, BR.split('').flatMap(b => [1, 2, 3, 4, 5].map(i => b + i)), PTS) === null, `${t} 네 갈래 5칸씩이 막힌다`);
  /* 별 하나의 값어치는 어느 모양이든 1u — 효과 값을 단위로 나눈 합 */
  for (const x of s.filter(x => !x.locked)) {
    const g = (CIRCUIT_FIT[t] || {})[x.theme] || 1;
    const v = Object.entries(x.fx).reduce((a, [k, n]) => a + n / (CIRCUIT.unit[k] * CIRCUIT.scale * g), 0);
    ok(Math.abs(v - 1) < 1e-9 || CIRCUIT.upOnly.some(k => k in x.fx), `${t} ${x.id} 값어치 ${v}`);
  }
}
const all = [...BR].flatMap(b => Array.from({ length: K }, (_, i) => b + (i + 1)));
ok(checkTaken('ignis', all, PTS) !== null, '포인트보다 많이 찍었는데 통과한다');
console.log(`① 규칙 — 기체 ${ids.length} · 별 ${ids.length * BR.length * (K + 1)} · ${fail ? '실패 ' + fail : '통과'}`);

/* ── 대표 빌드 ──────────────────────────── */
const chain = (b, n) => Array.from({ length: n }, (_, i) => b + (i + 1));
const BUILDS = [];
for (const i of BR) for (const j of BR) for (const k of BR) {
  if (i === j || j === k || i === k) continue;
  BUILDS.push({ name: `${i}8 ${j}8 ${k}4`, taken: [...chain(i, 8), ...chain(j, 8), ...chain(k, 4)] });
}
BUILDS.push({ name: '고르게 5·5·5·5', taken: [...BR].flatMap(b => chain(b, 5)) });
for (const i of BR) { const rest = [...BR].filter(b => b !== i);
  BUILDS.push({ name: `${i}8 나머지 4`, taken: [...chain(i, 8), ...rest.flatMap(b => chain(b, 4))] }); }
for (const b of BUILDS) b.taken = b.taken.slice(0, PTS);

const EMPTY = { WEAPON: null, FRAME: null, BOOSTER: null, CORE: null };
const BASE = Object.fromEntries(ids.map(t => [t, computeStats({ uid: 'x', type: t, level: LV, exp: 0, fat: 0, skillLv: 0, slots: EMPTY }, [])]));
const ST = (t, taken) => applyCircuit(BASE[t], circuitFx(t, taken));
let S = 23; const ns = () => ((S = Math.imul(S, 1103515245) + 12345 | 0) >>> 0);
function wr(t, A, B, n) { let k = 0;
  for (let i = 0; i < n; i++) {
    const ev = i % 2 ? simulate(makeUnit('P', t, A), makeUnit('E', t, B), ns()) : simulate(makeUnit('E', t, B), makeUnit('P', t, A), ns());
    if (ev[ev.length - 1].winner === (i % 2 ? 'P' : 'E')) k++;              // winner 는 자리(첫 인자 = P)다
  } return k / n; }
const avg = a => a.reduce((x, y) => x + y, 0) / a.length;
const pct = v => (v * 100).toFixed(1) + '%';

/* ── ② 0점 상대 · ③ 빌드끼리 ───────────── */
console.log(`\n② · ③ — Lv.${LV} · 포인트 ${PTS} · 맨몸 · 같은 기체끼리 · 대표 빌드 ${BUILDS.length} · 판수 ${N}(빌드끼리는 ${Math.round(N / 2)})`);
const rows = [];
for (const t of ids) {
  const st = BUILDS.map(b => ST(t, b.taken));
  const vs0 = st.map(s => wr(t, s, BASE[t], N));
  const rr = BUILDS.map(() => []);
  for (let a = 0; a < BUILDS.length; a++) for (let b = a + 1; b < BUILDS.length; b++) {
    const w = wr(t, st[a], st[b], Math.round(N / 2)); rr[a].push(w); rr[b].push(1 - w);
  }
  const rrAvg = rr.map(avg);
  const best = rrAvg.indexOf(Math.max(...rrAvg)), worst = rrAvg.indexOf(Math.min(...rrAvg));
  rows.push({ t, r: ROBOT_TYPES[t].rarity, lo: Math.min(...vs0), hi: Math.max(...vs0), mean: avg(vs0),
              gap: rrAvg[best] - rrAvg[worst], best: BUILDS[best].name, worst: BUILDS[worst].name, th: themesOf(t) });
}
rows.sort((a, b) => b.gap - a.gap);
console.log('기체\t\t등급\t0점 상대(최저~최고 · 평균)\t빌드 차\t가장 센 빌드 / 가장 약한 빌드');
for (const x of rows) console.log(`${x.t.padEnd(10)}\t${x.r}\t${pct(x.lo)} ~ ${pct(x.hi)} · ${pct(x.mean)}\t\t${(x.gap * 100).toFixed(1)}%p\t${x.best} / ${x.worst}`);
const gaps = rows.map(x => x.gap).sort((a, b) => a - b), q = p => gaps[Math.floor((gaps.length - 1) * p)];
console.log(`\n요약 — 0점 상대 평균 ${pct(avg(rows.map(x => x.mean)))} · 최저 ${pct(Math.min(...rows.map(x => x.lo)))} · 최고 ${pct(Math.max(...rows.map(x => x.hi)))}`);
console.log(`      빌드 차 중앙 ${(q(.5) * 100).toFixed(1)}%p · 상위 10% ${(q(.9) * 100).toFixed(1)}%p · 최대 ${(gaps[gaps.length - 1] * 100).toFixed(1)}%p`);
process.exitCode = fail ? 1 : 0;
