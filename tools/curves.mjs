/* 기체 성장 곡선 — 파츠 없음 · 스킬 +0 · 피로도 0 으로 Lv.1~MAXLV 스펙을 뽑는다.

   게임의 computeStats · powerOf 를 그대로 부른다. 결과 JSON 은
   docs/balance/robot-curves-2026-09-22.html 의 DATA 자리에 들어간 것과 같은 모양이다.

   node tools/curves.mjs            JSON (기체마다 hp/atk/def/spd/pow 배열)
   node tools/curves.mjs --gaps     등급 사이 간격 요약(Lv.1 · 30 · MAX, 스토리 기체 제외) */
import { CONST, ROBOT_TYPES } from '../data/balance.js';
import { computeStats, powerOf } from '../js/stats.js';

const MAXLV = CONST.MAXLV || 60;
const SPECIAL = ['shield', 'repair', 'mark', 'shred', 'jam', 'execute'];
const empty = { WEAPON: null, FRAME: null, BOOSTER: null, CORE: null };

const rows = Object.entries(ROBOT_TYPES).map(([id, T]) => {
  const r = { id, name: T.name, rar: T.rarity, role: T.role || '', story: !!T.story,
              skill: T.skill?.name || '', fx: Object.keys(T.skill?.fx || {}).filter(k => SPECIAL.includes(k)),
              crit: T.base.crit, eva: T.base.eva, hp: [], atk: [], def: [], spd: [], pow: [] };
  for (let lv = 1; lv <= MAXLV; lv++) {
    const s = computeStats({ type: id, level: lv, skillLv: 0, fat: 0, slots: empty }, []);
    r.hp.push(s.hp); r.atk.push(s.atk); r.def.push(s.def); r.spd.push(s.spd); r.pow.push(powerOf(s));
  }
  return r;
});

if (process.argv.includes('--gaps')) {
  const R = ['C', 'UC', 'R', 'UQ', 'EP'], pool = rows.filter(r => !r.story);
  for (const i of [0, 29, MAXLV - 1]) {
    const T = {};
    for (const k of R) { const a = pool.filter(x => x.rar === k).map(x => x.pow[i]);
      T[k] = { min: Math.min(...a), max: Math.max(...a), avg: a.reduce((s, x) => s + x, 0) / a.length }; }
    console.log(`Lv.${i + 1}\t` + R.slice(1).map((h, j) => { const l = R[j];
      return `${l}→${h} ×${(T[h].avg / T[l].avg).toFixed(3)} 겹침 ${Math.round(T[l].max - T[h].min)}`; }).join(' · '));
  }
} else {
  console.log(JSON.stringify(rows));
}
