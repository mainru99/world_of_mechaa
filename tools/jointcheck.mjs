/* 합동전 측정 — 수치를 정하는 도구이자 회귀 검사. (2026-09-21)
 *
 *   ① 1:1 기준선   지금 토벌 보스(1:1)의 승률. 합동전이 이 난이도를 이어받는다
 *   ② 합동전       뽑을 수 있는 기체의 모든 짝(43종 · 1806 순서쌍) × 보스 셋. 평균 승률과 퍼짐
 *   ③ 자리         같은 짝의 전위·후위를 바꾸면 승률이 얼마나 움직이나 — 15%p 이상인 짝의 비율
 *   ④ 요구 조건    특성의 답을 가진 짝과 없는 짝의 승률 차 · 특성을 끈 판과의 차
 *   ⑤ 결정성       같은 입력 = 같은 이벤트 · 1:1 sim 은 그대로
 *
 * node --no-warnings tools/jointcheck.mjs [레벨=55] [시드수=16] [파츠등급=SR]
 * 판정이 아니라 측정이 목적인 칸(①~④)은 숫자만 찍는다. ⑤만 실패로 센다. */
import { ROBOT_TYPES, MONSTER_TYPES, CONST, SLOTS } from '../data/balance.js';
import { computeStats } from '../js/stats.js';
import { makeUnit, simulate, mulberry32 } from '../js/sim.js';
import { rollPart } from '../js/gacha.js';
import { pickTactic } from '../js/rewards.js';
import { runJoint, jointOf, jointBossStats } from '../js/joint.js';

/* 수치 실험 — JB="hp,atk" 로 합동전 보스 배수를 바꿔 잰다(파일은 안 고친다) */
if (process.env.JB) { const [h, a] = process.env.JB.split(',').map(Number); CONST.JOINT.boss = { hp: h, atk: a }; }
const LV = +(process.argv[2] || 55), N = +(process.argv[3] || 16), RAR = process.argv[4] || 'SR';
const BOSSES = Object.keys(MONSTER_TYPES).filter(k => MONSTER_TYPES[k].rarity === 'BOSS');
const ROBOTS = Object.keys(ROBOT_TYPES).filter(t => !ROBOT_TYPES[t].story);   // 뽑을 수 있는 기체만(스토리 기체 제외)
const bossLv = Math.min(CONST.MAXLV + (CONST.OPP_LV_OVER || 0), LV + (CONST.HUNT.BOSS.lv || 0));
let bad = 0;
const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) bad++; };
const pct = x => (x * 100).toFixed(1).padStart(5) + '%';

/* 기체마다 같은 등급 파츠 네 개. 파츠 베이스는 기체마다 고정 시드로 뽑는다 */
function kit(type) {
  let sd = [...type].reduce((a, c) => a * 31 + c.charCodeAt(0) >>> 0, 7);
  const rnd = () => { sd = (Math.imul(sd, 1664525) + 1013904223) >>> 0; return sd / 4294967296; };
  const parts = SLOTS.map((sl, i) => rollPart(LV, rnd, type + i, RAR, sl));
  const slots = {}; SLOTS.forEach((sl, i) => slots[sl] = parts[i].uid);
  return computeStats({ type, level: LV, skillLv: 0, fat: 0, slots }, parts);
}
const ST = Object.fromEntries(ROBOTS.map(t => [t, kit(t)]));
const bossRaw = b => computeStats({ type: b, level: bossLv, skillLv: 0, fat: 0,
  slots: { WEAPON: null, FRAME: null, BOOSTER: null, CORE: null } }, []);
const seedOf = (k, a, b, c) => (Math.imul(k + 1, 2654435761) ^ Math.imul(a + 7, 40503) ^ Math.imul(b + 3, 97) ^ c) >>> 0;

console.log(`기체 Lv.${LV} · 파츠 ${RAR}×4 · 보스 Lv.${bossLv} · 시드 ${N} · JOINT ${JSON.stringify(CONST.JOINT)}`);

/* ① 1:1 기준선 */
console.log('\n== ① 지금의 토벌 보스(1:1) ==');
for (const b of (process.env.SKIP1 ? [] : BOSSES)) {
  const raw = bossRaw(b);
  let w = 0, n = 0, best = 0;
  ROBOTS.forEach((t, a) => {
    let ww = 0;
    for (let k = 0; k < N; k++) {
      const s = seedOf(k, a, 0, 11);
      const P = makeUnit(t, t, ST[t], 'none');
      const E = makeUnit(b, b, raw, pickTactic(b, mulberry32((s ^ 0x9e3779b9) >>> 0)));
      if (simulate(P, E, s).at(-1).winner === 'P') ww++;
    }
    w += ww; n += N; best = Math.max(best, ww / N);
  });
  console.log(`  ${MONSTER_TYPES[b].name.padEnd(12)} 평균 ${pct(w / n)} · 가장 센 기체 ${pct(best)}`);
}

/* ② ~ ④ 합동전 */
function jointRate(b, F, B, traitsOn = true, n = N, tac = ['none', 'none']) {
  const j = jointOf(b), traits = traitsOn ? j.traits : [];
  const stats = jointBossStats(bossRaw(b), traits, b);
  let w = 0;
  for (let k = 0; k < n; k++) {
    const s = seedOf(k, ROBOTS.indexOf(F), ROBOTS.indexOf(B), 29);
    const r = runJoint({ seed: s, aim: j.aim,
      team: [{ name: F, type: F, stats: ST[F], tactic: tac[0] }, { name: B, type: B, stats: ST[B], tactic: tac[1] }],
      boss: { name: b, type: b, stats, tactic: pickTactic(b, mulberry32((s ^ 0x9e3779b9) >>> 0)), traits } });
    if (r.win) w++;
  }
  return w / n;
}

/* 답을 가졌나 — 특성마다 스킬 틀로 가른다 */
const fxOf = t => ROBOT_TYPES[t].skill.fx || {};
const HAS = {
  armor:    t => !!(fxOf(t).ignoreDef || fxOf(t).shred),
  field:    t => (fxOf(t).hits || 1) === 1 && (fxOf(t).mult || 1) >= 1.6,
  phase:    t => !!fxOf(t).noMiss,
  critnull: t => !fxOf(t).alwaysCrit,
  antiheal: t => !fxOf(t).drain,
  overcharge: t => !!fxOf(t).jam, regen: t => !!fxOf(t).execute, enrage: () => true,
};

const t0 = Date.now();
for (const b of BOSSES) {
  const j = jointOf(b);
  console.log(`\n== ② ${MONSTER_TYPES[b].name} · 조준 ${j.aim} · 특성 ${j.traits.join(', ')} ==`);
  const rate = {};
  for (const F of ROBOTS) for (const B of ROBOTS) if (F !== B) rate[F + '|' + B] = jointRate(b, F, B);
  const vals = Object.values(rate).sort((x, y) => x - y);
  const q = p => vals[Math.floor(p * (vals.length - 1))];
  const mean = vals.reduce((a, c) => a + c, 0) / vals.length;
  console.log(`  평균 ${pct(mean)} · 하위10% ${pct(q(0.1))} · 중앙 ${pct(q(0.5))} · 상위10% ${pct(q(0.9))} · 최고 ${pct(vals.at(-1))}`);

  /* ③ 자리 */
  let big = 0, pairs = 0, sum = 0;
  for (let a = 0; a < ROBOTS.length; a++) for (let c = a + 1; c < ROBOTS.length; c++) {
    const d = Math.abs(rate[ROBOTS[a] + '|' + ROBOTS[c]] - rate[ROBOTS[c] + '|' + ROBOTS[a]]);
    pairs++; sum += d; if (d >= 0.15) big++;
  }
  console.log(`  ③ 자리 바꾸면 평균 ${pct(sum / pairs)}p 움직임 · 15%p 이상 ${pct(big / pairs)} 의 짝`);

  /* ④ 요구 조건 — 특성마다 '둘 다 답' · '하나만' · '둘 다 아님' */
  for (const k of j.traits) {
    const g = [[], [], []];
    for (const key in rate) { const [F, B] = key.split('|'); g[(HAS[k](F) ? 1 : 0) + (HAS[k](B) ? 1 : 0)].push(rate[key]); }
    const m = a => a.length ? pct(a.reduce((x, y) => x + y, 0) / a.length) : '   —  ';
    console.log(`  ④ ${CONST.TRAIT[k].ko.padEnd(6)} 답 0기 ${m(g[0])} · 1기 ${m(g[1])} · 2기 ${m(g[2])}`);
  }
  /* 특성을 끈 판 — 표본 짝 60 개 */
  let on = 0, off = 0, cnt = 0;
  for (let x = 0; x < 60; x++) {
    const F = ROBOTS[(x * 7) % ROBOTS.length], B = ROBOTS[(x * 11 + 3) % ROBOTS.length]; if (F === B) continue;
    on += rate[F + '|' + B]; off += jointRate(b, F, B, false); cnt++;
  }
  console.log(`  ④ 특성을 끄면 ${pct(off / cnt)} (켠 판 ${pct(on / cnt)})`);
  /* 전술 — 같은 표본에서 둘 다 방어 · 둘 다 돌격 · 전위 방어+후위 돌격 */
  const tacs = [['guard', 'guard'], ['rush', 'rush'], ['guard', 'rush']];
  const tl = tacs.map(tc => { let s = 0, c = 0;
    for (let x = 0; x < 60; x++) { const F = ROBOTS[(x * 7) % ROBOTS.length], B = ROBOTS[(x * 11 + 3) % ROBOTS.length]; if (F === B) continue;
      s += jointRate(b, F, B, true, N, tc); c++; }
    return `${tc.map(t => CONST.TACTIC[t].ko).join('+')} ${pct(s / c)}`; });
  console.log(`  ④ 전술(균형+균형 ${pct(on / cnt)}) ${tl.join(' · ')}`);
  const top = Object.entries(rate).sort((x, y) => y[1] - x[1]).slice(0, 5)
    .map(([k, v]) => k.split('|').map(t => ROBOT_TYPES[t].name).join('→') + ' ' + pct(v).trim());
  console.log(`  상위 짝(전위→후위) ${top.join(' · ')}`);
}
console.log(`\n  (측정 ${((Date.now() - t0) / 1000).toFixed(1)}초)`);

/* ⑤ 결정성 */
console.log('\n== ⑤ 결정성 ==');
{
  const b = BOSSES[0], j = jointOf(b), stats = jointBossStats(bossRaw(b), j.traits, b);
  const spec = () => ({ seed: 12345, aim: j.aim,
    team: [{ name: 'a', type: 'glacier', stats: ST.glacier, tactic: 'guard' }, { name: 'b', type: 'howitzer', stats: ST.howitzer, tactic: 'rush' }],
    boss: { name: b, type: b, stats, tactic: 'none', traits: j.traits } });
  ok(JSON.stringify(runJoint(spec()).events) === JSON.stringify(runJoint(spec()).events), '같은 입력이면 같은 이벤트');
  const r = runJoint(spec());
  const hpOk = r.events.filter(e => e.t === 'hit' && !e.miss).every(e => e.dmg >= 1);
  ok(hpOk, '모든 타격은 1 이상');
  ok(r.events.at(-1).t === 'end' && (r.win ? r.bossHp === 0 : true), '끝 이벤트 · 이기면 보스 체력 0');
  const noBack = r.events.filter(e => e.t === 'hit' && e.side === 'E' && e.di === 1);
  /* 광역 보스라 후위도 맞는다 — 평타(스킬 밖)로는 전위가 살아 있는 동안 후위를 안 친다 */
  let inSkill = false, frontDown = false, leak = 0;
  for (const e of r.events) {
    if (e.t === 'skill') inSkill = e.side === 'E';
    else if (e.t === 'turn') inSkill = false;
    else if (e.t === 'down' && e.i === 0) frontDown = true;
    else if (e.t === 'hit' && e.side === 'E' && e.di === 1 && !inSkill && !frontDown) leak++;
  }
  ok(leak === 0, `보스 평타는 전위가 살아 있는 동안 후위를 치지 않는다 (후위 피격 ${noBack.length}회 중 평타 ${leak})`);
}

console.log(bad ? `\n✗ ${bad}건 실패` : '\n전부 통과');
process.exitCode = bad ? 1 : 0;
