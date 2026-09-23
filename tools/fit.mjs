/* 새 기체 수치 맞추기 — 같은 등급 **기존 기체 고정 풀** 상대 승률로 체력 · 공격 · 방어를 찾는다.
   (2026-09-23 세트 04 · 05 에서 쓴 방법을 도구로 옮겼다.) 파일은 고치지 않고 붙여 넣을 값을 찍는다.

   node tools/fit.mjs <spec.json>
   맞춘 값을 balance.js 에 넣은 뒤에는 **node tools/powercal.mjs --write** 로 전투력 보정 배수를 다시 만든다.

   spec.json = {
     "ref":  ["oracle", "wraith", ...],                      기준 풀 — 같은 등급 기존 기체(새 기체를 넣지 않는다). 맞추는 기체 자신은 빼고 붙인다
     "fit": {
       "salvo":  { "lv20": 0.50, "lv60": 0.50 },             직선 — 두 손잡이(전체 배율 · base 몫)
       "aquila": { "lv60": 0.46, "curve": -0.035 },          곡선 — 2차 항 몫은 손으로 정하고 배율만 찾는다
       "atlas":  { "lv60": 0.60 }                            배율만 — 모양(base 몫 · 곡선)은 그대로 두고 키운다(기존 기체 상향)
     },
     "n": 40                                                 이분법 한 번에 기준 기체 하나당 판 수(선후공 두 배)
   }

   손잡이
     k  전체 배율 — hp · atk · def 의 Lv.60 값에 곱한다 → Lv.60 승률
     t  직선 기체: base 몫(+ 면 초반이 세다, Lv.60 값은 그대로) → Lv.20 승률
        곡선 기체: 총성장 중 2차 항의 몫(음수 = 조숙형, 양수 = 대기만성)
   속도 · 치명 · 회피 · 구간은 건드리지 않는다 — 기체의 성격(아종이면 차체)이라서다.
   곡선 몫이 얼마나 먹히는지는 기체마다 다르다 — 세트 04 의 LONGBOW 는 0.06 에서 Lv.20 승률이 29% 로 떨어졌고,
   세트 05 의 GOLIATH CIEL(방벽형)은 -0.09 가 되어서야 조숙형(Lv.20 54% → Lv.60 45%)이 됐다. 한 번 돌려 보고 정한다. */
import { readFileSync } from 'node:fs';
import { ROBOT_TYPES, CONST } from '../data/balance.js';
import { computeStats } from '../js/stats.js';
import { makeUnit, simulate } from '../js/sim.js';

const spec = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const REF = spec.ref, N = spec.n || 40, L = (CONST.MAXLV || 60) - 1;
const K = ['hp', 'atk', 'def'];
const empty = { WEAPON: null, FRAME: null, BOOSTER: null, CORE: null };
const st = (id, lv) => computeStats({ uid: 'x', type: id, level: lv, skillLv: 0, fat: 0, slots: empty }, []);

function win(id, lv, n) {
  let w = 0, t = 0;
  for (const o of REF) { if (o === id) continue; for (let s = 0; s < n; s++) {
    const seed = (s * 2654435761) >>> 0;
    let ev = simulate(makeUnit('P', id, st(id, lv)), makeUnit('E', o, st(o, lv)), seed);
    if (ev[ev.length - 1].winner === 'P') w++;
    ev = simulate(makeUnit('P', o, st(o, lv)), makeUnit('E', id, st(id, lv)), seed);
    if (ev[ev.length - 1].winner === 'E') w++;
    t += 2;
  } }
  return w / t;
}

const ORIG = {};
for (const id in spec.fit) {
  const T = ROBOT_TYPES[id];
  if (!T) throw new Error('없는 기체 ' + id);
  ORIG[id] = { base: {}, tot: {}, base0: { ...T.base }, grow0: { ...T.grow }, curve0: { ...(T.curve || {}) } };
  for (const k of K) { ORIG[id].base[k] = T.base[k]; ORIG[id].tot[k] = (T.grow[k] || 0) + (T.curve?.[k] || 0); }
}
function apply(id, k, t) {
  const o = ORIG[id], T = ROBOT_TYPES[id], S = spec.fit[id], curved = S.curve != null;
  if (!curved && S.lv20 == null) {                     // 배율만 — base · grow · curve 를 같은 배율로
    for (const key of K) {
      T.base[key] = +(o.base0[key] * k).toFixed(1); T.grow[key] = +(o.grow0[key] * k).toFixed(2);
      if (T.curve) T.curve[key] = +(o.curve0[key] * k).toFixed(2);
    }
    return;
  }
  if (curved && !T.curve) T.curve = { hp: 0, atk: 0, def: 0, spd: 0 };
  for (const key of K) {
    const end = (o.base[key] + o.tot[key] * L) * k;
    if (curved) {
      const base = o.base[key] * k, tot = (end - base) / L;
      T.base[key] = +base.toFixed(1); T.grow[key] = +(tot * (1 - t)).toFixed(2); T.curve[key] = +(tot * t).toFixed(2);
    } else {
      const base = o.base[key] * k * (1 + t);
      T.base[key] = +base.toFixed(1); T.grow[key] = +((end - base) / L).toFixed(2);
    }
  }
}
function solve(id) {
  const S = spec.fit[id], curved = S.curve != null, scaleOnly = !curved && S.lv20 == null;
  let k = 1, t = curved ? S.curve : 0;
  for (let round = 0; round < (curved || scaleOnly ? 1 : 3); round++) {
    let lo = 0.7, hi = 1.6;
    for (let i = 0; i < 9; i++) { k = (lo + hi) / 2; apply(id, k, t); if (win(id, 60, N) < S.lv60) lo = k; else hi = k; }
    if (curved || scaleOnly) break;
    let a = -0.3, b = 0.3;
    for (let i = 0; i < 8; i++) { t = (a + b) / 2; apply(id, k, t); if (win(id, 20, N) < S.lv20) a = t; else b = t; }
  }
  apply(id, k, t);
}
const obj = o => '{' + Object.entries(o).map(([k, v]) => `${k}:${String(v).replace(/^0\./, '.').replace(/^-0\./, '-.')}`).join(',') + '}';
for (const id in spec.fit) {
  solve(id);
  const T = ROBOT_TYPES[id], w = [20, 30, 60].map(l => (win(id, l, N * 2) * 100).toFixed(1) + '%');
  console.log(`${id.padEnd(10)} Lv.20 ${w[0]} · Lv.30 ${w[1]} · Lv.60 ${w[2]}`);
  console.log(`    base:${obj(T.base)}, grow:${obj(T.grow)}${T.curve ? ', curve:' + obj(T.curve) : ''},`);
}
