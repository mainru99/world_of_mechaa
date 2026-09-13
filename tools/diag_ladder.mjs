import { PART_BASES, AFFIXES, AFFIX_GROUPS, AFFIX_TIER, RARITY, SLOTS, CONST } from '../data/balance.js';
import { computeStats, powerOf } from '../js/stats.js';
import { makeUnit, simulate, mulberry32 } from '../js/sim.js';
import { rollPart } from '../js/gacha.js';

const GROUP = {};
for (const g in AFFIX_GROUPS) for (const id of AFFIX_GROUPS[g]) GROUP[id] = g;
const BY = {};
for (const id in PART_BASES) (BY[PART_BASES[id].slot] = BY[PART_BASES[id].slot] || []).push(id);
const rar = RARITY.find(r => r.k === 'SSR');
const T = 'ranger', LV60 = 60;
const rb = { type: T, level: LV60, exp: 0, fat: 0, skillLv: 0 };
const COMBO_N = 70;

const combo = r => {
  const ps = [], slots = {};
  for (const s of SLOTS) {
    const base = BY[s][Math.floor(r() * BY[s].length)];
    const pool = Object.keys(AFFIXES).filter(id => {
      const A = AFFIXES[id]; return A.slots === '*' || A.slots.includes(s); });
    const aff = [], used = new Set(), gs = new Set();
    let guard = 0;
    while (aff.length < 2 && guard++ < 200) {
      const id = pool[Math.floor(r() * pool.length)];
      if (used.has(id) || (GROUP[id] && gs.has(GROUP[id]))) continue;
      used.add(id); if (GROUP[id]) gs.add(GROUP[id]);
      aff.push({ id, tier: ['II','III','IV'][Math.floor(r() * 3)] });
    }
    ps.push({ uid: s, slot: s, base, rarity: 'SSR', ko: rar.ko, name: PART_BASES[base].ko,
              affixes: aff, seed: Math.floor(r() * 4e9), lv: LV60, enh: 10 });
    slots[s] = s;
  }
  return { ps, slots };
};

const r = mulberry32(4242), list = [];
for (let i = 0; i < COMBO_N; i++) {
  const c = combo(r);
  const st = computeStats({ ...rb, slots: c.slots }, c.ps);
  list.push({ st, pw: powerOf(st), c });
}
list.sort((a, b) => b.pw - a.pw);

// 상위 3개와 하위 3개 출력
console.log('== 상위 3개 조합 ==');
for (let i = 0; i < 3; i++) {
  const x = list[i];
  const bases = x.c.ps.map(p => p.base + '[' + p.slot + ']').join(' ');
  console.log('  #' + (i+1) + ' pw=' + Math.round(x.pw) + ' | ' + bases);
  const st = x.st;
  console.log('  stats: hp=' + Math.round(st.hp) + ' atk=' + Math.round(st.atk) + ' def=' + Math.round(st.def) + ' spd=' + Math.round(st.spd) + ' eva=' + (st.eva*100).toFixed(1) + '% crit=' + (st.crit*100).toFixed(1) + '%');
}
console.log('\\n== 하위 3개 조합 ==');
for (let i = list.length - 3; i < list.length; i++) {
  const x = list[i];
  const bases = x.c.ps.map(p => p.base + '[' + p.slot + ']').join(' ');
  console.log('  #' + (i+1) + ' pw=' + Math.round(x.pw) + ' | ' + bases);
}
console.log('\\n전투력 폭: x' + (list[0].pw / list[list.length-1].pw).toFixed(2));
console.log('상위 pw=' + Math.round(list[0].pw) + ' 하위 pw=' + Math.round(list[list.length-1].pw));
