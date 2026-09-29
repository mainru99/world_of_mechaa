/* 전투력 보정 — 특화기술이 전투력에 안 잡히는 몫을 재서 계수를 정한다 (2026-09-21)
 *
 * 전투력(js/stats.js powerOf)은 스탯만 본다. 특화기술(방벽 · 수리 · 표적 · 파쇄 · 재밍 · 마무리)은 스탯이 아니다.
 *
 * **켬/뗌 차이로 재면 틀린다** — 처음에 그렇게 쟀다가 보정을 넣으니 오히려 승패를 덜 맞혔다(65 → 55%).
 * 특화기술 기체는 스탯이 기술을 전제로 설계돼 있어서(방벽 기체는 공격이 낮다) 켬/뗌 차이가
 * '전투력이 놓친 몫' 이 아니다. 재야 할 것은 **전투력이 예측한 승률과 실제 승률의 차(잔차)** 다.
 *
 *   ① 환산 비율 — 등급 안에서 전투력 로그 1 당 승률이 몇 %p 인가(전 기체 회귀)
 *   ② 잔차 — 기체마다 실제 승률 − 전투력이 예측한 승률. 일반 기체의 잔차는 공식의 원래 오차다
 *   ③ 계수 — 특화기술 기체의 잔차(일반 기체 평균을 뺀 것)를 fx 값으로 최소제곱 → CONST.SPECIAL_POW
 *   ④ 검증 — 계수를 넣은 전투력이 등급 안 승패를 얼마나 맞히나(넣기 전과 비교)
 *
 * ── 결론 (2026-09-21 실측 · 60×2판) — **보정을 넣지 않는다** ──────────────
 *   특화기술 기체의 평균 잔차 Lv.30 −1.9%p · Lv.60 −0.7%p — 일반 기체의 원래 오차(±6.7%p) 안이고 오히려 약간 과대 표시다.
 *   계수를 맞추면 레벨마다 부호가 뒤집힌다(방벽 Lv.30 −1.08 · Lv.60 +2.69). 넣으면 Lv.60 적중률이 52 → 42% 로 나빠진다.
 *   더 근본적인 것 — **같은 등급 안에서는 전투력이 승패를 거의 못 맞힌다**(Lv.60 52%). 같은 등급끼리는 상성이 가른다.
 *   매칭(전투력 ±15%)이 기대는 것은 등급 · 레벨 · 파츠 차이이고, 거기서는 전투력이 제 몫을 한다.
 *   새 특화기술을 더하면 이 도구를 다시 돌려 잔차가 ±6.7%p 밖으로 나가는지만 볼 것.
 *
 * node --no-warnings tools/specialpow.mjs [판수=80] [레벨=30] */
import { ROBOT_TYPES } from '../data/balance.js';
import { computeStats, powerOf } from '../js/stats.js';
import { makeUnit, simulate } from '../js/sim.js';

const N = +(process.argv[2] || 80), LV = +(process.argv[3] || 30);
const KEYS = ['shield', 'repair', 'mark', 'shred', 'jam', 'execute'];
const E0 = { WEAPON: null, FRAME: null, BOOSTER: null, CORE: null };
const ids = Object.keys(ROBOT_TYPES);
const byRar = {};
for (const t of ids) (byRar[ROBOT_TYPES[t].rarity] ||= []).push(t);
const ST = {}; const st = t => ST[t] || (ST[t] = computeStats({ type: t, level: LV, skillLv: 0, fat: 0, slots: E0 }, []));
const isSp = t => KEYS.some(k => ROBOT_TYPES[t].skill.fx[k]);

/* 짝마다 승률(양쪽 자리를 번갈아) */
const pair = {};
for (const list of Object.values(byRar)) for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
  const a = list[i], b = list[j]; let w = 0;
  for (let k = 1; k <= N; k++) {
    w += simulate(makeUnit('P', a, st(a)), makeUnit('E', b, st(b)), k * 7919 + 1).at(-1).winner === 'P';
    w += simulate(makeUnit('P', b, st(b)), makeUnit('E', a, st(a)), k * 7919 + 2).at(-1).winner === 'E';
  }
  pair[a + '|' + b] = w / (2 * N); pair[b + '|' + a] = 1 - w / (2 * N);
}

console.log(`== ① 환산 비율 (Lv.${LV} · 한 쌍 ${N}×2판 · 등급 안 모든 짝) ==`);
/* 짝의 승률 − 0.5 를 두 기체 전투력 로그 차로 회귀한다(원점을 지나는 직선) */
let sxy = 0, sxx = 0;
for (const k in pair) { const [a, b] = k.split('|'); const x = Math.log(powerOf(st(a)) / powerOf(st(b))); sxy += x * (pair[k] - 0.5); sxx += x * x; }
const slope = sxy / sxx;
console.log(`  전투력 로그 1 당 승률 ${(slope * 100).toFixed(0)}%p (전투력 10% 차 ≈ ${(slope * Math.log(1.1) * 100).toFixed(1)}%p)`);

console.log('\n== ② 잔차 — 실제 승률 − 전투력이 예측한 승률 (같은 등급 평균) ==');
const resid = {};
for (const list of Object.values(byRar)) for (const a of list) {
  let r = 0, n = 0;
  for (const b of list) if (b !== a) { r += pair[a + '|' + b] - (0.5 + slope * Math.log(powerOf(st(a)) / powerOf(st(b)))); n++; }
  resid[a] = r / n;
}
const plain = ids.filter(t => !isSp(t)), sp = ids.filter(isSp);
const mean = a => a.reduce((s, x) => s + x, 0) / a.length;
const base = mean(plain.map(t => resid[t]));
console.log(`  일반 기체 평균 ${(base * 100).toFixed(1)}%p · 흩어짐 ±${(Math.sqrt(mean(plain.map(t => (resid[t] - base) ** 2))) * 100).toFixed(1)}%p (공식의 원래 오차)`);
console.log(`  특화기술 기체 평균 ${(mean(sp.map(t => resid[t])) * 100).toFixed(1)}%p`);
for (const t of sp) console.log(`    ${ROBOT_TYPES[t].name.padEnd(11)} ${resid[t] >= 0 ? '+' : ''}${(resid[t] * 100).toFixed(1)}%p  ` + KEYS.filter(k => ROBOT_TYPES[t].skill.fx[k]).map(k => `${k} ${ROBOT_TYPES[t].skill.fx[k]}`).join(' · '));

console.log('\n== ③ 계수 — log(보정 배수) = Σ 계수 × fx ==');
const rows = sp.map(t => ({ t, fx: ROBOT_TYPES[t].skill.fx, y: (resid[t] - base) / slope }));
const used = KEYS.filter(k => rows.some(r => r.fx[k]));
const m = used.length, A = Array.from({ length: m }, () => Array(m + 1).fill(0));
for (const r of rows) { const x = used.map(k => r.fx[k] || 0);
  for (let i = 0; i < m; i++) { for (let j = 0; j < m; j++) A[i][j] += x[i] * x[j]; A[i][m] += x[i] * r.y; } }
/* 약한 능선 회귀 — 기체가 17종뿐이라 계수가 튀지 않게 0 쪽으로 조금 당긴다 */
for (let i = 0; i < m; i++) A[i][i] += 0.002 * rows.length;
for (let i = 0; i < m; i++) { let p = i; for (let r = i + 1; r < m; r++) if (Math.abs(A[r][i]) > Math.abs(A[p][i])) p = r;
  [A[i], A[p]] = [A[p], A[i]];
  for (let r = 0; r < m; r++) if (r !== i) { const f = A[r][i] / A[i][i]; for (let c = i; c <= m; c++) A[r][c] -= f * A[i][c]; } }
const coef = {}; used.forEach((k, i) => { coef[k] = +(A[i][m] / A[i][i]).toFixed(4); });
console.log('  SPECIAL_POW: ' + JSON.stringify(coef));

console.log('\n== ④ 검증 — 등급 안에서 전투력이 승패를 맞힌 비율(대등한 짝 제외) ==');
const powWith = (t, c) => powerOf(st(t)) * Math.exp(used.reduce((s, k) => s + (c[k] || 0) * (ROBOT_TYPES[t].skill.fx[k] || 0), 0));
function accuracy(c, only) {
  let hit = 0, tot = 0;
  for (const k in pair) { const [a, b] = k.split('|'); if (a > b) continue;
    if (only && !only(a) && !only(b)) continue;
    if (Math.abs(pair[k] - 0.5) < 0.08) continue;
    tot++; if ((pair[k] > 0.5) === (powWith(a, c) > powWith(b, c))) hit++; }
  return `${(hit / tot * 100).toFixed(0)}% (${hit}/${tot})`;
}
console.log(`  특화기술 기체가 낀 짝 — 보정 전 ${accuracy({}, isSp)} · 보정 후 ${accuracy(coef, isSp)}`);
console.log(`  전체 — 보정 전 ${accuracy({})} · 보정 후 ${accuracy(coef)}`);
