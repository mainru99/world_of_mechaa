/* 기체 성장 곡선 — 파츠 없음 · 스킬 +0 · 피로도 0 으로 Lv.1~MAXLV 스펙을 뽑는다.

   게임의 computeStats · powerOf 를 그대로 부른다. 결과 JSON 은
   docs/balance/robot-curves-2026-09-22.html 의 DATA 자리에 들어간 것과 같은 모양이다.

   node tools/curves.mjs            JSON (기체마다 hp/atk/def/spd/pow 배열)
   node tools/curves.mjs --wr       위에 더해 wr(같은 등급 상대 승률, %) 배열 — 몇 분 걸린다
   node tools/curves.mjs --gaps     등급 사이 간격 요약(Lv.1 · 30 · MAX, 스토리 기체 제외)

   wr — 표시 전투력은 특화기술(방벽 · 수리 · 교란 …)을 세지 않아 지원형 기체를 실제보다 세게 보인다.
   그래서 **실제로 싸운 결과**를 따로 싣는다. 같은 등급의 뽑을 수 있는 기체 전부(자기 빼고)와
   선후공을 바꿔 가며 붙인 승률이고, Lv.1 · 5 · 10 · … · MAX 에서 재고 사이는 직선으로 잇는다. */
import { CONST, ROBOT_TYPES } from '../data/balance.js';
import { computeStats, powerOf } from '../js/stats.js';
import { makeUnit, simulate } from '../js/sim.js';

const MAXLV = CONST.MAXLV || 60;
const SPECIAL = ['shield', 'repair', 'mark', 'shred', 'jam', 'execute'];
const empty = { WEAPON: null, FRAME: null, BOOSTER: null, CORE: null };

const rows = Object.entries(ROBOT_TYPES).map(([id, T]) => {
  const r = { id, name: T.name, rar: T.rarity, role: T.role || '', story: !!T.story, curved: !!T.curve,
              skill: T.skill?.name || '', fx: Object.keys(T.skill?.fx || {}).filter(k => SPECIAL.includes(k)),
              crit: T.base.crit, eva: T.base.eva, hp: [], atk: [], def: [], spd: [], pow: [] };
  for (let lv = 1; lv <= MAXLV; lv++) {
    const s = computeStats({ type: id, level: lv, skillLv: 0, fat: 0, slots: empty }, []);
    r.hp.push(s.hp); r.atk.push(s.atk); r.def.push(s.def); r.spd.push(s.spd); r.pow.push(powerOf(s));
  }
  return r;
});

if (process.argv.includes('--wr')) {
  const N = 60, LVS = [1]; for (let l = 5; l <= MAXLV; l += 5) LVS.push(l);
  const st = (id, lv) => computeStats({ uid: 'x', type: id, level: lv, skillLv: 0, fat: 0, slots: empty }, []);
  for (const r of rows) {
    const pool = rows.filter(o => o.rar === r.rar && !o.story && o.id !== r.id).map(o => o.id);
    const at = LVS.map(lv => {
      let w = 0, t = 0;
      for (const o of pool) for (let s = 0; s < N; s++) {
        const seed = ((s + 1) * 2654435761) >>> 0;
        let ev = simulate(makeUnit('P', r.id, st(r.id, lv)), makeUnit('E', o, st(o, lv)), seed);
        if (ev[ev.length - 1].winner === 'P') w++;
        ev = simulate(makeUnit('P', o, st(o, lv)), makeUnit('E', r.id, st(r.id, lv)), seed);
        if (ev[ev.length - 1].winner === 'E') w++;
        t += 2;
      }
      return w / t * 100;
    });
    r.wr = [];
    for (let lv = 1; lv <= MAXLV; lv++) {
      const j = LVS.findIndex(x => x >= lv);
      if (LVS[j] === lv) { r.wr.push(+at[j].toFixed(1)); continue; }
      const a = LVS[j - 1], b = LVS[j], f = (lv - a) / (b - a);
      r.wr.push(+(at[j - 1] + (at[j] - at[j - 1]) * f).toFixed(1));
    }
    process.stderr.write('.');
  }
  process.stderr.write('\n');
  console.log(JSON.stringify(rows));
} else if (process.argv.includes('--gaps')) {
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
