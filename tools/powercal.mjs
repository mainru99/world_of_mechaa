/* 전투력 보정 — 기체마다 '실제로 싸운 강함'에 맞춘 배수를 잰다 (2026-09-23 · 할 일 3번)
 *
 * 왜 — 전투력(js/stats.js powerOf)은 스탯만 본다. 스킬 · 특화기술은 못 본다. 그래서
 *   · QUAKE · CIPHER 같은 지원형은 스킬 손해를 스탯으로 메워 설계해서 **실제보다 세게** 표시되고
 *   · AURIC 은 치명 · 체력 · 방어가 다 높아 EP 1위로 표시되지만 EP 끼리는 가장 약하다
 *   매칭이 전투력 ±15% 를 보므로 표시만의 문제가 아니다 — 그런 기체는 늘 더 센 상대를 만난다.
 *
 * 어떻게 — 09-21 에 특화기술 계수로 고치려다 실패했다(tools/specialpow.mjs 머리말). 이번에는 **기체마다 배수 하나**를 둔다.
 *   ① 환산 기울기 β — 기체의 체력 · 공격 · 방어를 ±6% 로 흔들어 '전투력 로그 1 당 승률 로짓' 을 잰다
 *   ② 기체마다 같은 등급 상대 승률 w 를 잰다(Lv.30 · Lv.60, 선후공 바꿔 가며)
 *   ③ 그 승률이 나오려면 전투력이 등급 평균의 몇 배여야 하나 = exp(logit(w) / β) — 그것과 실제 전투력의 비가 배수
 *   ④ 두 레벨의 로그 평균 · 등급마다 기하평균이 1 이 되게 맞춘다(등급 사이의 크기는 건드리지 않는다)
 *   ⑤ 검증 — **맞출 때 쓰지 않은 Lv.20 · Lv.45** 에서 '전투력이 예측한 승률 − 실제' 의 흩어짐을 전 · 후로 비교
 * 배수는 표시 · 매칭에만 쓰인다. 전투(sim.js)는 스탯만 본다 — **승패는 한 판도 바뀌지 않는다.**
 *
 * node tools/powercal.mjs            재기만 한다
 * node tools/powercal.mjs --write    data/powercal.js 를 새로 쓴다(기체를 더하거나 밸런스를 고친 뒤) */
import { writeFileSync } from 'node:fs';
import { ROBOT_TYPES } from '../data/balance.js';
import { POWER_K } from '../data/powercal.js';
import { computeStats, powerOf } from '../js/stats.js';
import { makeUnit, simulate } from '../js/sim.js';

const N = 40, FIT = [30, 60], HOLD = [20, 45];
const E0 = { WEAPON: null, FRAME: null, BOOSTER: null, CORE: null };
const K3 = ['hp', 'atk', 'def'];
const ids = Object.keys(ROBOT_TYPES);
const pool = r => ids.filter(t => ROBOT_TYPES[t].rarity === r && !ROBOT_TYPES[t].story);
const logit = p => Math.log(Math.max(0.01, Math.min(0.99, p)) / (1 - Math.max(0.01, Math.min(0.99, p))));

/* 배수를 끈 상태로 잰다 — 이미 있는 배수가 섞이면 제 꼬리를 문다 */
for (const k of Object.keys(POWER_K)) delete POWER_K[k];
const st = (t, lv, sc) => {
  const s = computeStats({ type: t, level: lv, skillLv: 0, fat: 0, slots: E0 }, []);
  if (sc && sc !== 1) for (const k of K3) s[k] = Math.round(s[k] * sc);
  return s;
};
function win(t, lv, sc = 1, n = N) {
  let w = 0, c = 0;
  for (const o of pool(ROBOT_TYPES[t].rarity)) {
    if (o === t) continue;
    for (let s = 0; s < n; s++) {
      const seed = ((s + 1) * 2654435761) >>> 0;
      if (simulate(makeUnit('P', t, st(t, lv, sc)), makeUnit('E', o, st(o, lv)), seed).at(-1).winner === 'P') w++;
      if (simulate(makeUnit('P', o, st(o, lv)), makeUnit('E', t, st(t, lv, sc)), seed).at(-1).winner === 'E') w++;
      c += 2;
    }
  }
  return w / c;
}
const gmean = a => Math.exp(a.reduce((s, x) => s + Math.log(x), 0) / a.length);

/* ① β — 등급마다 셋씩, 두 레벨 */
console.log('== ① 환산 기울기 β (전투력 로그 1 당 승률 로짓) ==');
const bs = [];
for (const r of ['C', 'UC', 'R', 'UQ', 'EP']) for (const t of pool(r).slice(0, 3)) for (const lv of FIT) {
  const lo = win(t, lv, 0.94, 20), hi = win(t, lv, 1.06, 20);
  const dp = Math.log(powerOf(st(t, lv, 1.06)) / powerOf(st(t, lv, 0.94)));
  bs.push((logit(hi) - logit(lo)) / dp);
}
bs.sort((a, b) => a - b);
const BETA = bs[Math.floor(bs.length / 2)];          // 중앙값 — 승률이 0 · 100% 에 붙은 몇 개에 끌려가지 않게
console.log(`  β = ${BETA.toFixed(2)} (중앙값 · 표본 ${bs.length}개 · 사분위 ${bs[Math.floor(bs.length / 4)].toFixed(2)} ~ ${bs[Math.floor(bs.length * 3 / 4)].toFixed(2)})`);

/* ② ③ 기체마다 배수 */
function measure(lvs) {
  const out = {};
  for (const lv of lvs) {
    const P = Object.fromEntries(ids.map(t => [t, powerOf(st(t, lv))]));
    const Pbar = Object.fromEntries(['C', 'UC', 'R', 'UQ', 'EP'].map(r => [r, gmean(pool(r).map(t => P[t]))]));
    for (const t of ids) {
      const w = win(t, lv);
      (out[t] ||= []).push({ lv, w, P: P[t], Pbar: Pbar[ROBOT_TYPES[t].rarity] });
    }
  }
  return out;
}
console.log('\n== ② ③ 기체마다 승률 · 배수 (Lv.' + FIT.join(' · ') + ') ==');
const fit = measure(FIT);
const lnf = {};
for (const t of ids) lnf[t] = fit[t].reduce((s, x) => s + (logit(x.w) / BETA - Math.log(x.P / x.Pbar)), 0) / fit[t].length;
/* ④ 등급마다 기하평균 1 — 뽑을 수 있는 기체로 맞추고 스토리 기체는 같은 몫을 뺀다 */
for (const r of ['C', 'UC', 'R', 'UQ', 'EP']) {
  const m = pool(r).reduce((s, t) => s + lnf[t], 0) / pool(r).length;
  for (const t of ids) if (ROBOT_TYPES[t].rarity === r) lnf[t] -= m;
}
const K = Object.fromEntries(ids.map(t => [t, +Math.exp(lnf[t]).toFixed(3)]));
const rows = ids.map(t => ({ t, r: ROBOT_TYPES[t].rarity, k: K[t], w: fit[t].map(x => (x.w * 100).toFixed(0) + '%').join('/') }))
  .sort((a, b) => a.k - b.k);
for (const x of [...rows.slice(0, 6), ...rows.slice(-6)])
  console.log(`  ${ROBOT_TYPES[x.t].name.padEnd(15)} ${x.r.padEnd(3)} 승률 ${x.w.padEnd(8)} 배수 ×${x.k}`);
console.log(`  (전체 ${rows.length}기 · ×${rows[0].k} ~ ×${rows[rows.length - 1].k})`);

/* ⑤ 검증 — 맞출 때 안 쓴 레벨 */
console.log('\n== ⑤ 검증 — 맞출 때 안 쓴 Lv.' + HOLD.join(' · ') + ' ==');
const hold = measure(HOLD);
for (const lv of HOLD) {
  const res = (useK) => {
    const e = [];
    for (const r of ['C', 'UC', 'R', 'UQ', 'EP']) {
      const g = pool(r).map(t => { const x = hold[t].find(y => y.lv === lv); return { t, x, P: x.P * (useK ? K[t] : 1) }; });
      const Pb = gmean(g.map(y => y.P));
      for (const y of g) {
        const pred = 1 / (1 + Math.exp(-BETA * Math.log(y.P / Pb)));
        e.push({ t: y.t, d: (y.x.w - pred) * 100 });
      }
    }
    const sd = Math.sqrt(e.reduce((s, y) => s + y.d * y.d, 0) / e.length);
    const worst = e.sort((a, b) => Math.abs(b.d) - Math.abs(a.d)).slice(0, 3).map(y => `${ROBOT_TYPES[y.t].name} ${y.d > 0 ? '+' : ''}${y.d.toFixed(0)}`).join(' · ');
    return { sd, worst };
  };
  const a = res(false), b = res(true);
  console.log(`  Lv.${lv} — 예측 − 실제 흩어짐 ±${a.sd.toFixed(1)}%p → ±${b.sd.toFixed(1)}%p`);
  console.log(`          보정 전 가장 어긋난 기체 ${a.worst}`);
  console.log(`          보정 후 가장 어긋난 기체 ${b.worst}`);
}

if (process.argv.includes('--write')) {
  const body = ids.filter(t => Math.abs(K[t] - 1) >= 0.005).map(t => `  ${t}: ${K[t]},`).join('\n');
  writeFileSync(new URL('../data/powercal.js', import.meta.url), `/* 전투력 보정 배수 — tools/powercal.mjs --write 가 만든다. **손으로 고치지 않는다.**
   기체마다 '같은 등급 상대 실제 승률' 에 맞춘 배수다(Lv.${FIT.join(' · ')}, β = ${BETA.toFixed(2)}).
   전투력(powerOf)에만 곱한다 — 표시 · 매칭 · 방어 기록. 전투는 스탯만 보므로 승패는 바뀌지 않는다.
   없는 기체 · 몬스터는 1. 기체를 더하거나 수치를 고치면 다시 만든다. */
export const POWER_K = {
${body}
};
`);
  console.log('\ndata/powercal.js 를 새로 썼다');
}
