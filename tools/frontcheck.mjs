/* 전선 1장이 **처음 하는 사람에게** 굴러가는가.
 *
 * 이 다섯 판은 이 게임에서 사람이 하는 첫 다섯 판이다. 운영 32계정 중 21계정이
 * 한 판도 안 싸우고 떠났고(DESIGN.md F장 §0), 그 자리를 이 칸들이 가져간다.
 * 그래서 다른 검사보다 기준이 **한쪽으로 쏠려 있다** — 어려워서 막히는 쪽이
 * 쉬워서 시시한 쪽보다 훨씬 나쁘다.
 *
 * 보는 것.
 *   ① 맨몸 신병   — 기체 1기 · Lv.1 · 파츠 없음. 새 계정이 정확히 이 상태다.
 *                   1-1 은 여기서 **거의 다 이겨야** 한다
 *   ② 권장 레벨   — 칸의 lv 로 키운 기체. 각 칸이 승산 있게 붙는가
 *   ③ 오르막      — 뒤로 갈수록 어려워지는가. 중간에 쉬워지면 순서가 잘못된 것이다
 *   ④ 판 길이     — 첫 판이 길면 무슨 일이 일어나는지 못 읽는다
 *   ⑤ 규칙        — 칸 배치가 규칙과 맞는가(진행·해금·재현성)
 *
 * node tools/frontcheck.mjs          기본 400판
 * node tools/frontcheck.mjs 2000     더 정밀하게
 */
import { ROBOT_TYPES, SLOTS } from '../data/balance.js';
import { computeStats } from '../js/stats.js';
import { applyTerrain, runBreach, maxRounds } from '../js/breach.js';
import { mulberry32 } from '../js/sim.js';
import { frontRun } from '../server/front.js';
import { FRONT_CELLS, buildLines, readProgress, writeProgress,
         cellOpen, gateOpen, clearedCount, unlockedBy, rewardOf } from '../js/front.js';

const N = Math.max(50, parseInt(process.argv[2] || '400', 10));
const G = s => '\x1b[32m' + s + '\x1b[0m', R = s => '\x1b[31m' + s + '\x1b[0m',
      Y = s => '\x1b[33m' + s + '\x1b[0m';
let fail = 0;
const is = (c, m) => { console.log('  ' + (c ? G('✓') : R('✗')) + ' ' + m); if (!c) fail++; };

/* 새 계정은 **C 등급 중 무작위**를 받는다(js/game.js `pick(BY_RARITY.C)`).
   그래서 하나로 재면 안 된다 — 여섯 중 무엇을 받아도 1-1 은 넘어야 한다.
   평균과 함께 **최저**를 본다. 가장 나쁜 기체를 받은 사람이 진짜 신규다. */
const STARTERS = Object.keys(ROBOT_TYPES).filter(k => ROBOT_TYPES[k].rarity === 'C');

function mech(type, lv) {
  const slots = {}; for (const s of SLOTS) slots[s] = null;
  return { robot: { uid: 'me', type, level: lv, exp: 0, fat: 0, skillLv: 0, slots }, parts: [] };
}
function one(cell, type, lv, n) {
  const lines = buildLines(cell);
  const m = mech(type, lv);
  const mechs = [{ name: ROBOT_TYPES[type].name, type, uid: 'me', level: lv,
                   stats: applyTerrain(computeStats(m.robot, m.parts), cell.terrain) }];
  let win = 0, turns = 0;
  const rnd = mulberry32(0x5eed);
  for (let i = 0; i < n; i++) {
    const seeds = Array.from({ length: maxRounds(lines.length, 1) },
                             () => Math.floor(rnd() * 4294967296) >>> 0);
    const r = runBreach({ mechs, lines, seeds });
    if (r.win) win++;
    /* rec 에 turns 는 없다. 재생 이벤트 중 타격 수로 센다. */
    turns += r.rounds.reduce((t, x) => t + (x.events || []).filter(e => e.t === 'hit').length, 0);
  }
  return { rate: win / n * 100, turns: turns / n };
}
/* C 여섯 종 전부. 평균·최저·최저를 낸 기체를 함께 돌려준다. */
function play(cell, lv, n) {
  const rs = STARTERS.map(t => ({ t, ...one(cell, t, lv, Math.max(40, Math.round(n / STARTERS.length))) }));
  rs.sort((a, b) => a.rate - b.rate);
  const avg = rs.reduce((s, x) => s + x.rate, 0) / rs.length;
  return { rate: avg, low: rs[0].rate, lowT: ROBOT_TYPES[rs[0].t].name,
           turns: rs.reduce((s, x) => s + x.turns, 0) / rs.length };
}

console.log(`전선 1장 — C 등급 ${STARTERS.length}종 · 파츠 없음 · 종당 ${Math.max(40, Math.round(N / STARTERS.length))}판\n`);

console.log('== ① 맨몸 신병 (Lv.1 · 새 계정이 정확히 이 상태) ==');
{
  const r = play(FRONT_CELLS[0], 1, N);
  console.log(`  1-1 평균 ${r.rate.toFixed(1)}%  ·  최저 ${r.low.toFixed(1)}% (${r.lowT})  ·  ${r.turns.toFixed(1)}턴`);
  is(r.rate >= 85, `첫 판은 거의 이긴다 (평균 85% 이상, 실측 ${r.rate.toFixed(1)}%)`);
  is(r.low >= 70, `가장 나쁜 기체를 받아도 넘는다 (70% 이상, ${r.lowT} ${r.low.toFixed(1)}%)`);
  is(r.turns <= 24, `첫 판이 짧다 (24턴 이하, 실측 ${r.turns.toFixed(1)}) — 길면 뭘 하는지 못 읽는다`);
}

console.log('\n== ② 권장 레벨에서 각 칸 ==');
const rates = [];
for (const c of FRONT_CELLS) {
  const r = play(c, c.lv, N);
  rates.push(r.rate);
  const mark = r.rate < 25 ? R('막힘') : r.rate > 97 ? Y('시시함') : G('ok');
  console.log(`  ${c.id}  ${c.ko.padEnd(12)} Lv.${String(c.lv).padStart(2)} ${c.lines}겹 foe ${(c.foe ?? 1).toFixed(2)}  ` +
              `평균 ${r.rate.toFixed(1).padStart(5)}%  최저 ${r.low.toFixed(1).padStart(5)}%  ${r.turns.toFixed(1).padStart(5)}턴  ${mark}`);
}
is(rates.every(v => v >= 25), '권장 레벨에서 막히는 칸이 없다 (25% 이상)');
is(rates[0] >= 85, '1-1 은 권장 레벨에서도 거의 이긴다');

console.log('\n== ③ 오르막인가 ==');
{
  /* 같은 레벨로 전 칸을 돌려 난이도만 견준다. 칸마다 lv 가 다르면 뭐가 어려운지 안 갈린다. */
  const flat = FRONT_CELLS.map(c => play(c, 6, Math.min(N, 300)).rate);
  console.log('  Lv.6 고정 승률 — ' + flat.map(v => v.toFixed(0) + '%').join(' → '));
  let bad = 0;
  for (let i = 1; i < flat.length; i++) if (flat[i] > flat[i - 1] + 8) bad++;
  is(!bad, `뒤로 갈수록 어려워진다 (뒤집힌 곳 ${bad})`);
  is(flat[0] - flat[flat.length - 1] >= 10, `첫 칸과 끝 칸의 차이가 있다 (${(flat[0] - flat[flat.length - 1]).toFixed(0)}%p)`);
}

console.log('\n== ④ 규칙 ==');
{
  const empty = readProgress(null);
  is(writeProgress(empty) === '0'.repeat(FRONT_CELLS.length), '빈 진행이 칸 수만큼의 0 이다');
  is(cellOpen(empty, 0) && !cellOpen(empty, 1), '첫 칸만 열려 있다');
  is(cellOpen(readProgress('10000'), 1), '앞 칸을 깨면 다음 칸이 열린다');
  is(readProgress('1').length === FRONT_CELLS.length, '짧은 옛 저장본도 칸 수만큼 읽힌다');
  is(clearedCount(readProgress('11111')) === 5, '다 깨면 5칸');

  is(!gateOpen('gacha', empty, 1), '새 계정은 뽑기가 잠겨 있다');
  is(gateOpen('gacha', empty, 32), '이미 키운 계정은 전선 없이도 열린다 (기존 계정 보호)');
  is(gateOpen('gacha', readProgress('11111'), 1), '1장을 깨면 뽑기가 열린다');

  const last = FRONT_CELLS[FRONT_CELLS.length - 1];
  is(!!unlockedBy(last, readProgress('11110'), 1), '마지막 칸을 깨면 해금이 뜬다');
  is(!unlockedBy(last, readProgress('11111'), 1), '이미 깬 칸은 다시 해금을 안 띄운다');

  is(!!rewardOf(FRONT_CELLS[0], false), '첫 클리어는 보상이 있다');
  is(!rewardOf(FRONT_CELLS[0], true), '다시 깨면 보상이 없다 — 파밍 자리가 아니다');

  const a = JSON.stringify(buildLines(FRONT_CELLS[2]));
  const b = JSON.stringify(buildLines(FRONT_CELLS[2]));
  is(a === b, '같은 칸은 몇 번을 불러도 같은 방어선이다');
  is(FRONT_CELLS.every(c => buildLines(c).length === c.lines), '방어선 수가 lines 와 같다');
}

console.log('\n== ⑤ 서버 응답만으로 재생할 수 있는가 — 가짜 env.DB ==');
{
  /* **이 검사가 없어서 1장이 통째로 막혔다.** 서버는 정상 판정하고 기록까지 했는데,
     응답에서 mechs·lines 의 `stats` 를 빼고 보내서 클라의 재생이
     `makeUnit(name, type, undefined)` 에서 죽었다. 피로도만 늘고 화면은 안 떴다.
     오프라인 경로는 stats 를 직접 만들어 쓰므로 여기가 안 잡혔다 —
     **서버 경로를 따로 봐야 한다.** (레이드에서 같은 모양의 버그가 한 번 더 있었다) */
  const rb = { id: 1, uid: 'r1', type: STARTERS[0], level: 3, exp: 0, fat: 0, fat_at: 0, skill_lv: 0,
               s_weapon: null, s_frame: null, s_booster: null, s_core: null };
  const st = { player: { nickname: 'T', credits: 100, scrap: 10, rev: 1, level: 3,
                         sel_robot: 1, squad1: 1, squad2: null, expd_robot: null, campaign: null } };
  const run = (sql, a) => {
    if (/FROM player WHERE account_id/.test(sql)) return { ...st.player };
    if (/FROM robot WHERE account_id/.test(sql)) return { results: [rb] };
    if (/FROM part WHERE account_id/.test(sql)) return { results: [] };
    if (/UPDATE player SET/.test(sql)) { st.player.campaign = a[2]; return {}; }
    return {};
  };
  const env = { DB: { prepare: sql => ({ bind: (...a) => ({
    first: async () => run(sql, a), all: async () => run(sql, a), run: async () => run(sql, a) }) }),
    batch: async l => { for (const x of l) await x.run(); return []; } } };

  const r = await frontRun(env, 1, { cell: FRONT_CELLS[0].id }, Date.now());
  is(r && r.ok, `1-1 판정 — ${r && r.ok ? (r.win ? '승' : '패') : 'error: ' + (r && r.error)}`);
  is(Array.isArray(r.mechs) && r.mechs.every(m => m.stats && m.stats.hp > 0), '응답의 mechs 가 stats 를 담고 있다');
  is(Array.isArray(r.lines) && r.lines.every(l => l.stats && l.stats.hp > 0), '응답의 lines 가 stats 를 담고 있다');
  /* 클라가 하는 일을 그대로 한다 — 응답만 가지고 같은 돌파를 다시 돌린다 */
  let replay = null, boom = null;
  try { replay = runBreach({ mechs: r.mechs, lines: r.lines, seeds: r.seeds, hpLeft: r.hpLeft0 }); }
  catch (e) { boom = e.message; }
  is(!boom, boom ? `재생이 죽었다 — ${boom}` : '응답만으로 재생이 돈다');
  is(replay && replay.win === r.win && replay.rounds.length === r.rounds.length,
     '재생 결과가 서버 기록과 같다 (승패·판 수)');
}

console.log(fail ? R(`\n${fail}개 실패`) : G('\n전부 통과'));
process.exitCode = fail ? 1 : 0;
