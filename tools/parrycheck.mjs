/* 흘려내기 자가 점검 · 측정 (2026-09-21)
 *
 *   ① 빈도   평타 중 몇 %가 흘려지나 — 목표 5~10% (더 잦으면 운 게임이다)
 *   ② 속도   빠른 쪽이 더 잘 흘리나 — 등급 안에서 속도 상위 절반 대 하위 절반
 *   ③ 거울   완전히 같은 기체끼리 붙이면 여전히 50% 인가(선공 편향이 새로 생기지 않았나)
 *   ④ 흔들림 등급 안 승률이 흘려내기 전후로 얼마나 움직였나(CONST.PARRY 를 잠깐 끄고 대조)
 *   ⑤ 규칙   스킬은 흘려지지 않는다 · 흘려진 평타는 피해 0 · 친 쪽 게이지가 밀린다(다음 행동이 늦다)
 *   ⑥ 시각   'turn' 이벤트의 at 은 줄지 않는다(실시간 재생이 이 값을 쓴다)
 *
 * node --no-warnings tools/parrycheck.mjs [판수=120] [레벨=30] */
import { ROBOT_TYPES, CONST } from '../data/balance.js';
import { computeStats } from '../js/stats.js';
import { makeUnit, simulate } from '../js/sim.js';

let bad = 0;
const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) bad++; };
const N = +(process.argv[2] || 120), LV = +(process.argv[3] || 30);
const E0 = { WEAPON: null, FRAME: null, BOOSTER: null, CORE: null };
const ST = {};
const st = t => ST[t] || (ST[t] = computeStats({ type: t, level: LV, skillLv: 0, fat: 0, slots: E0 }, []));
const ids = Object.keys(ROBOT_TYPES).filter(t => !ROBOT_TYPES[t].story);
const byRar = {};
for (const t of ids) (byRar[ROBOT_TYPES[t].rarity] ||= []).push(t);
const fight = (a, b, s) => simulate(makeUnit('P', a, st(a)), makeUnit('E', b, st(b)), s);

console.log(`== ① 빈도 (Lv.${LV} · 등급 안 모든 짝 · 한 쌍 ${N}판 · PARRY ${JSON.stringify(CONST.PARRY)}) ==`);
let normal = 0, parried = 0;
/* 받은 평타 대비 비율로 센다. 횟수로 세면 느린 쪽이 더 자주 맞으니 더 많이 흘린 것처럼 보인다 */
const tries = { fast: 0, slow: 0 }, parries = { fast: 0, slow: 0 };
for (const list of Object.values(byRar)) for (const a of list) for (const b of list) if (a !== b)
  for (let s = 1; s <= N; s++) {
    const ev = fight(a, b, s * 7919 + 17);
    let inSkill = false;
    const cls = side => { const me = side === 'P' ? a : b, him = side === 'P' ? b : a;
      return st(me).spd > st(him).spd ? 'fast' : st(me).spd < st(him).spd ? 'slow' : null; };
    for (const e of ev) {
      if (e.t === 'turn') inSkill = false;
      else if (e.t === 'skill') inSkill = true;
      else if (e.t === 'hit' && !inSkill) { normal++; const c = cls(e.dside); if (c) tries[c]++; }
      else if (e.t === 'parry') { parried++; const c = cls(e.side); if (c) { tries[c]++; parries[c]++; } }
    }
  }
const rate = parried / (normal + parried);
ok(rate >= 0.05 && rate <= 0.10, `평타의 ${(rate * 100).toFixed(1)}% 가 흘려진다 (${parried} / ${normal + parried})`);

console.log('\n== ② 속도 ==');
{
  const f = parries.fast / tries.fast, sl = parries.slow / tries.slow;
  ok(f > sl, `받은 평타 중 흘려낸 비율 — 더 빠른 쪽 ${(f * 100).toFixed(1)}% · 더 느린 쪽 ${(sl * 100).toFixed(1)}%`);
}

console.log('\n== ③ 거울 대결 ==');
{
  let w = 0, n = 0;
  /* 판수가 적으면 ±2%p 가 그냥 잡음이다 — 흘려내기를 끈 판도 48~50% 로 흔들렸다. 300판씩 */
  for (const t of ids) for (let s = 1; s <= 300; s++) { if (fight(t, t, s * 104729 + 3).at(-1).winner === 'P') w++; n++; }
  const r = w / n;
  ok(Math.abs(r - 0.5) < 0.025, `같은 기체끼리 선공측 ${(r * 100).toFixed(1)}% (${n}판)`);
}

console.log('\n== ④ 등급 안 승률이 얼마나 움직였나 ==');
{
  const winRates = () => {
    const out = {};
    for (const list of Object.values(byRar)) {
      const w = Object.fromEntries(list.map(i => [i, 0])), n = Object.fromEntries(list.map(i => [i, 0]));
      for (const a of list) for (const b of list) if (a !== b) for (let s = 1; s <= N; s++) {
        const pw = fight(a, b, s * 7919 + 17).at(-1).winner === 'P';
        w[pw ? a : b]++; n[a]++; n[b]++;
      }
      for (const i of list) out[i] = w[i] / n[i];
    }
    return out;
  };
  const on = winRates();
  const saved = CONST.PARRY; CONST.PARRY = null;
  const off = winRates();
  CONST.PARRY = saved;
  const d = ids.map(i => [i, on[i] - off[i]]).sort((x, y) => Math.abs(y[1]) - Math.abs(x[1]));
  const mx = Math.abs(d[0][1]);
  console.log('  가장 많이 움직인 기체 ' + d.slice(0, 6).map(([i, v]) => `${ROBOT_TYPES[i].name} ${v > 0 ? '+' : ''}${(v * 100).toFixed(1)}`).join(' · '));
  const outOn = ids.filter(i => on[i] < 0.35 || on[i] > 0.65), outOff = ids.filter(i => off[i] < 0.35 || off[i] > 0.65);
  console.log('  35~65% 밖 — 켠 판: ' + (outOn.map(i => `${ROBOT_TYPES[i].name} ${(on[i] * 100).toFixed(0)}%`).join(' · ') || '없음')
            + ' / 끈 판: ' + (outOff.map(i => `${ROBOT_TYPES[i].name} ${(off[i] * 100).toFixed(0)}%`).join(' · ') || '없음'));
  /* 흘려낼 수 없는 것이 스킬뿐이라 스킬에 기대는 기체가 조금 이득을 본다 — 성격이 갈리는 것은 의도다.
     막을 것은 크게 쏠리는 것과, 기준 밖 기체가 늘어나는 것 */
  ok(mx <= 0.08, `어떤 기체도 8%p 넘게 움직이지 않는다 (최대 ${(mx * 100).toFixed(1)}%p)`);
  ok(outOn.length <= outOff.length + 1, `기준 밖 기체가 크게 늘지 않는다 (끈 판 ${outOff.length} → 켠 판 ${outOn.length})`);
}

console.log('\n== ⑤ 규칙 ==');
{
  let skillParried = 0, dmgAfter = 0, found = null;
  for (let s = 1; s <= 400 && !found; s++) {
    const ev = fight('scarab', 'chalk', s * 31);
    let inSkill = false;
    for (let i = 0; i < ev.length; i++) {
      const e = ev[i];
      if (e.t === 'turn') inSkill = false;
      if (e.t === 'skill') inSkill = true;
      if (e.t === 'parry') {
        if (inSkill) skillParried++;
        /* 흘려내기 뒤 같은 행동 안에 피해 이벤트가 없다 */
        for (let j = i + 1; j < ev.length && ev[j].t !== 'turn' && ev[j].t !== 'end'; j++) if (ev[j].t === 'hit') dmgAfter++;
        found = found || { s, i };
      }
    }
  }
  ok(found, '흘려내기가 실제 전투에서 나온다');
  ok(skillParried === 0, '스킬은 흘려지지 않는다');
  ok(dmgAfter === 0, '흘려진 평타는 피해가 없다');
}

console.log('\n== ⑥ 시각 ==');
{
  let bad2 = 0;
  for (let s = 1; s <= 200; s++) {
    let last = -1;
    for (const e of fight('ignis', 'mule', s)) if (e.t === 'turn') { if (!(e.at >= last)) bad2++; last = e.at; }
  }
  ok(bad2 === 0, "'turn' 의 at 이 줄지 않는다(200판)");
}

console.log(bad ? `\n✗ ${bad}건 실패` : '\n전부 통과');
process.exitCode = bad ? 1 : 0;
