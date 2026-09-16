/* 주간 시련 자가 점검.

   이 기능의 약속은 하나다 — **결정적이다.** 같은 빌드로 다시 눌러도 같은 점수가
   나와야 하고, 그래야 '점수를 올리는 유일한 길이 빌드를 바꾸는 것' 이 된다.
   그 약속이 깨지면 다시 굴려서 운으로 올리는 파밍이 되어 기능이 통째로 뜻을 잃는다.
   여기서 그것부터 본다.

   node tools/trialcheck.mjs */
import { CONST, MONSTER_TYPES, TERRAIN, ROBOT_TYPES } from '../data/balance.js';
import { computeStats } from '../js/stats.js';
import { rollPart } from '../js/gacha.js';
import { weekOf, weekStart, weekEnd, trialOf, foeStats, runTrial,
         trialWon, TRIAL_WIN_BASE, WEEK_MS } from '../js/trial.js';
import { trialView, trialRun } from '../server/trial.js';

let bad = 0;
const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) bad++; };
const EMPTY = { WEAPON: null, FRAME: null, BOOSTER: null, CORE: null };
let sd = 4242;
const rnd = () => { sd = (Math.imul(sd, 1664525) + 1013904223) >>> 0; return sd / 4294967296; };

function build(type, lv, rar) {
  const slots = { ...EMPTY }, parts = [];
  if (rar) { let i = 0; for (const sl of ['WEAPON', 'FRAME', 'BOOSTER', 'CORE']) {
    const p = rollPart(lv, rnd, 'p' + (i++), rar, sl); parts.push(p); slots[sl] = p.uid; } }
  return { robot: { uid: 'r1', type, level: lv, fat: 0, skillLv: 0, slots }, parts };
}

console.log('== ① 주 번호와 경계 ==');
{
  const w = weekOf(Date.now());
  ok(Number.isInteger(w), `이번 주 ${w}`);
  ok(weekEnd(w) - weekStart(w) === WEEK_MS, '한 주가 정확히 7일');
  ok(weekOf(weekStart(w)) === w && weekOf(weekEnd(w) - 1) === w, '주 안의 어느 시각이든 같은 주 번호');
  ok(weekOf(weekEnd(w)) === w + 1, '주가 끝나는 순간 다음 주로 넘어간다');
  ok(new Date(weekStart(w)).getUTCDay() === 1, '주는 월요일에 시작한다');
}

console.log('\n== ② 이번 주 시련이 모두에게 같은가 ==');
{
  const w = weekOf(Date.now());
  const a = JSON.stringify(trialOf(w)), b = JSON.stringify(trialOf(w));
  ok(a === b, '같은 주 → 같은 시련');
  ok(JSON.stringify(trialOf(w + 1)) !== a, '다음 주 → 다른 시련');
  /* 12주를 훑어 지형·상대가 한쪽으로 쏠리지 않는지 본다 */
  const terr = new Set(), foe = new Set();
  for (let i = 0; i < 24; i++) { const t = trialOf(w + i); terr.add(t.terrain); foe.add(t.type); }
  ok(terr.size >= 4, `24주에 지형 ${terr.size}종 (전체 ${Object.keys(TERRAIN).length}종)`);
  ok(foe.size >= 8, `24주에 상대 ${foe.size}종`);
  /* 보스는 파견에서 이름을 감추고 있다(???). 여기 나오면 그 감춤이 뜻을 잃는다. */
  let boss = 0;
  for (let i = 0; i < 200; i++) if ((MONSTER_TYPES[trialOf(w + i).type] || {}).rarity === 'BOSS') boss++;
  ok(boss === 0, '200주 동안 보스가 상대로 나오지 않는다');
  /* 레벨이 만렙을 넘으면 안 된다 */
  let over = 0;
  for (let i = 0; i < 200; i++) { const L = trialOf(w + i).level; if (L < 1 || L > CONST.MAXLV) over++; }
  ok(over === 0, `레벨이 1~${CONST.MAXLV} 안에 있다`);
}

console.log('\n== ③ 결정적인가 — 이 기능의 약속 ==');
{
  const w = weekOf(Date.now()), t = trialOf(w);
  const { robot, parts } = build('azure', 60, 'SR');
  const st = computeStats(robot, parts);
  const runs = [];
  for (let i = 0; i < 20; i++) runs.push(runTrial(st, t, 'none').score);
  ok(new Set(runs).size === 1, `같은 빌드 20번 → 전부 ${runs[0]}`);
  /* 빌드를 바꾸면 점수가 달라져야 한다. 안 달라지면 시험대가 아니다. */
  const b2 = build('azure', 60, 'SSR');
  const s2 = runTrial(computeStats(b2.robot, b2.parts), t, 'none').score;
  ok(s2 !== runs[0], `장비를 바꾸면 점수가 달라진다 (SR ${runs[0]} → SSR ${s2})`);
}

console.log('\n== ④ 점수 눈금 ==');
{
  const w = weekOf(Date.now()), t = trialOf(w);
  console.log(`  이번 주 — ${TERRAIN[t.terrain].ko} · ${MONSTER_TYPES[t.type].name} Lv.${t.level}`);
  const rows = [];
  for (const [ty, lv, rar] of [['mule', 20, null], ['mule', 40, 'C'], ['ranger', 60, 'R'],
                               ['azure', 60, 'SR'], ['seraph', 60, 'SSR']]) {
    if (!ROBOT_TYPES[ty]) continue;
    const { robot, parts } = build(ty, lv, rar);
    const r = runTrial(computeStats(robot, parts), t, 'none');
    rows.push({ ty, lv, rar, score: r.score, win: trialWon(r.score) });
    console.log(`  ${ty.padEnd(8)} Lv.${String(lv).padStart(2)} ${(rar || '맨몸').padEnd(5)} → ${String(r.score).padStart(7)} ${r.score >= TRIAL_WIN_BASE ? '승' : '패'}`);
  }
  /* 이긴 판은 언제나 진 판보다 높아야 한다. 예전에 턴 페널티가 체력 보너스를 넘어
     '이겼는데 승리 기준선 아래' 가 나온 적이 있다(499,991). */
  const wins = rows.filter(r => r.win).map(r => r.score);
  const loss = rows.filter(r => !r.win).map(r => r.score);
  ok(!wins.length || !loss.length || Math.min(...wins) > Math.max(...loss),
     '이긴 점수가 언제나 진 점수보다 높다');
  ok(loss.every(s => s >= 0 && s < TRIAL_WIN_BASE), '진 점수는 0 이상 · 기준선 미만');
  ok(rows.every(r => Number.isInteger(r.score)), '점수는 정수');
}

console.log('\n== ⑤ 서버 — 가짜 env.DB ==');
{
  const now = Date.now(), w = weekOf(now);
  const { robot, parts } = build('seraph', 60, 'SSR');
  const state = { trial: [], writes: 0 };
  const run = (sql, args) => {
    if (/SELECT nickname, sel_robot/.test(sql)) return { nickname: 'TESTER', sel_robot: 1, squad1: 1, squad2: null };
    if (/FROM robot WHERE account_id/.test(sql)) return { results: [{ id: 1, uid: robot.uid, type: robot.type,
      level: robot.level, fat: 0, skill_lv: 0, s_weapon: 11, s_frame: 12, s_booster: 13, s_core: 14 }] };
    if (/FROM part WHERE account_id/.test(sql)) return { results: parts.map((p, i) => ({
      id: 11 + i, uid: p.uid, slot: p.slot, name: p.name, rarity: p.rarity, stats: '{}', enh: 0,
      base: p.base, affixes: JSON.stringify(p.affixes), seed: p.seed, lv: p.lv })) };
    if (/ORDER BY score DESC/.test(sql)) return { results: state.trial };
    if (/SELECT score, robot_type, power, tries FROM trial/.test(sql))
      return state.trial.find(r => r.account_id === args[1]) || null;
    if (/COUNT\(\*\) AS n FROM trial WHERE week = \?1 AND/.test(sql))
      return { n: state.trial.filter(r => r.score > args[1]).length };
    if (/COUNT\(\*\) AS n FROM trial/.test(sql)) return { n: state.trial.length };
    if (/INSERT INTO trial/.test(sql)) {
      state.writes++;
      const [, acc, nick, score, type, pw] = args;
      const cur = state.trial.find(r => r.account_id === acc);
      if (!cur) state.trial.push({ account_id: acc, nickname: nick, score, robot_type: type, power: pw, tries: 1 });
      else { cur.tries++; if (score > cur.score) { cur.score = score; cur.robot_type = type; cur.power = pw; } }
      return {};
    }
    return null;
  };
  const env = { DB: { prepare: sql => ({ bind: (...a) => ({
    first: async () => run(sql, a), all: async () => run(sql, a) || { results: [] }, run: async () => run(sql, a) }) }) } };

  const v = await trialView(env, 1, now);
  ok(v.ok && v.week === w, `view — 주 ${v.week}`);
  ok(v.me === null, '기록이 없으면 me 는 null');
  ok(v.trial && v.trial.terrain && v.trial.type, 'view 가 이번 주 상대를 함께 준다');

  const a = await trialRun(env, 1, now);
  ok(a.ok && Number.isInteger(a.score), `run — 점수 ${a.score}`);
  ok(state.trial.length === 1 && state.trial[0].score === a.score, '기록이 한 줄 생겼다');

  /* 같은 빌드로 또 돌려도 점수가 같고, 기록이 나빠지지 않아야 한다 */
  const b = await trialRun(env, 1, now);
  ok(b.score === a.score, '두 번째도 같은 점수 (결정적)');
  ok(state.trial[0].tries === 2, '도전 횟수만 늘어난다');

  /* 더 낮은 점수로 기록이 지워지면 안 된다 — 지워지면 새 조합을 시험하는 것이 손해가 된다 */
  const high = state.trial[0].score;
  state.trial[0].score = high + 999999;
  await trialRun(env, 1, now);
  ok(state.trial[0].score === high + 999999, '낮은 점수로는 최고 기록이 지워지지 않는다');
}

console.log(bad ? `\n✗ ${bad}건 실패` : '\n전부 통과');
process.exitCode = bad ? 1 : 0;
