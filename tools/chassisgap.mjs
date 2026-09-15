/* 파츠가 기체를 얼마나 흔드나 — 맨몸 대비 비중을 기체별로 잰다.
 *
 *   node tools/chassisgap.mjs           전 기체
 *   node tools/chassisgap.mjs mule      한 기체만
 *
 * 왜 이걸 재나 — `tools/partdiversity.mjs` 의 확장 검사에서 `mule` 만 5/70 으로
 * 무너진다. 파츠 수치를 의심해서 한참 헤맸는데 아니었다(DESIGN.md §7-10).
 *
 * `crit`·`eva` 는 **기체가 무엇이든 같은 퍼센트포인트가 더해진다.** 맨몸 치명 4% 인
 * mule 과 18% 인 ranger 에게 파츠가 똑같이 +42%p 를 얹는다. 그래서 저스펙 축을
 * 정체성으로 삼은 기체일수록 장비 선택이 전투 성격을 통째로 갈아엎는다.
 *
 * 이 도구는 **판정하지 않는다.** 30종 기체 설계를 건드릴지 말지는 사람이 정할 일이고,
 * 여기서는 그 판단에 쓸 숫자만 찍는다. 종료 코드는 언제나 0 이다.
 */
import { SLOTS, PART_BASES as B, AFFIXES as A, AFFIX_GROUPS, ROBOT_TYPES } from '../data/balance.js';
import { computeStats } from '../js/stats.js';
import { mulberry32 } from '../js/sim.js';

const GROUP = Object.fromEntries(Object.entries(AFFIX_GROUPS).flatMap(([g, ids]) => ids.map(id => [id, g])));
const BY = Object.fromEntries(SLOTS.map(s => [s, Object.keys(B).filter(k => B[k].slot === s)]));
const PCT = new Set(['crit', 'eva']);
const KEYS = ['hp', 'atk', 'def', 'spd', 'crit', 'eva'];
const N = 70, SEED = 4242;   /* partdiversity 와 같은 표본을 쓴다 */

/* partdiversity.mjs 와 같은 규칙으로 뽑는다 — 두 도구가 다른 표본을 보면 견줄 수 없다 */
function loadouts(type) {
  const r = mulberry32(SEED);
  return Array.from({ length: N }, () => {
    const ps = SLOTS.map(slot => {
      const base = BY[slot][Math.floor(r() * BY[slot].length)];
      const pool = Object.keys(A).filter(k => A[k].slots === '*' || A[k].slots.includes(slot));
      const af = [], used = new Set(), gs = new Set();
      let guard = 0;
      while (af.length < 2 && guard++ < 200) {
        const k = pool[Math.floor(r() * pool.length)];
        if (used.has(k) || (GROUP[k] && gs.has(GROUP[k]))) continue;
        used.add(k); if (GROUP[k]) gs.add(GROUP[k]);
        af.push({ id: k, tier: ['II', 'III', 'IV'][Math.floor(r() * 3)] });
      }
      return { uid: slot, slot, base, rarity: 'SSR', affixes: af, seed: Math.floor(r() * 4e9), lv: 60, enh: 10 };
    });
    return computeStats({ type, level: 60, fat: 0, skillLv: 0, slots: Object.fromEntries(SLOTS.map(s => [s, s])) }, ps);
  });
}

const fmt = (k, v) => v.toFixed(PCT.has(k) ? 3 : 0);
const only = process.argv[2];
const types = only ? [only] : Object.keys(ROBOT_TYPES);
if (only && !ROBOT_TYPES[only]) { console.error(`그런 기체가 없다: ${only}`); process.exit(2); }

console.log(`맨몸(Lv.60 · 파츠 없음) 대비 파츠가 흔드는 폭 — SSR 4개 · +10 · 무작위 ${N}조합 (시드 ${SEED})\n`);
const worst = [];
for (const type of types) {
  const bare = computeStats({ type, level: 60, fat: 0, skillLv: 0, slots: {} }, []);
  const list = loadouts(type);
  const row = {};
  for (const k of KEYS) {
    const vs = list.map(s => s[k]);
    row[k] = (Math.max(...vs) - Math.min(...vs)) / Math.max(bare[k], 1e-9);
  }
  worst.push({ type, role: ROBOT_TYPES[type].role, swing: Math.max(row.crit, row.eva) });
  if (types.length <= 3) {
    console.log(`${type} — ${ROBOT_TYPES[type].role}`);
    for (const k of KEYS) {
      const vs = list.map(s => s[k]);
      console.log(`  ${k.padEnd(5)} 맨몸 ${fmt(k, bare[k]).padStart(7)}   조합 ${fmt(k, Math.min(...vs)).padStart(7)} ~ ${fmt(k, Math.max(...vs)).padStart(7)}   맨몸의 ${(row[k] * 100).toFixed(0).padStart(5)}%`);
    }
    console.log('');
  } else {
    console.log(`${type.padEnd(12)} ` + KEYS.map(k => `${k} ${(row[k] * 100).toFixed(0).padStart(5)}%`).join('  '));
  }
}
if (types.length > 3) {
  worst.sort((a, b) => b.swing - a.swing);
  console.log('\n퍼센트 스탯(crit·eva)이 맨몸 대비 가장 크게 흔들리는 기체 — 장비를 가장 가린다');
  for (const w of worst.slice(0, 5)) console.log(`  ${w.type.padEnd(12)} ${(w.swing * 100).toFixed(0).padStart(5)}%   ${w.role}`);
  console.log('\n가장 덜 흔들리는 기체');
  for (const w of worst.slice(-3)) console.log(`  ${w.type.padEnd(12)} ${(w.swing * 100).toFixed(0).padStart(5)}%   ${w.role}`);
}
