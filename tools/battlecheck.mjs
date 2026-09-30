/* 대전 서버 경로 자가 점검 — **진짜 SQLite 위에서** findMatch → startBattle 을 끝까지 돌린다.
 *
 * 왜 따로 두나: 이 게임에서 가장 자주 난 사고는 **서버 응답의 모양**이었다.
 *   · 레이드 — 응답의 `boss` 가 뒤에서 퍼진 필드에 덮여 재생이 죽었다
 *   · 전선 1장 — 응답에서 `stats` 를 빼서 1장이 통째로 안 열렸다
 * 둘 다 순수 함수 검사는 전부 통과했다. 서버 함수를 **실제로 부른** 검사가 없었기 때문이다.
 * 대전(`server/battle.js`)은 가장 많이 도는 경로인데 지금까지 그런 검사가 하나도 없었다.
 *
 * 무엇을 보나 — 몬스터 구간(2026-09-18)이 서버에서 약속대로 도는가.
 *   ① 구간 칸이 빈 계정은 첫 몬스터 판에서 레이팅으로 자리를 잡는다
 *   ② 몬스터 판마다 DB 의 구간·점수가 bandStep 과 같게 움직인다
 *   ③ 로봇·사람 판, 비상 출격에서는 구간이 안 움직인다
 *   ④ 응답의 band 와 다음 상대 카드의 bandGoal 이 DB 와 맞다
 *   ⑤ 다음 몬스터가 **새 구간**에서 나온다 (승급한 바로 다음 판부터)
 *   ⑥ /api/state 가 구간을 내려 준다
 *   ⑦ 응답만으로 전투를 다시 돌리면 서버 판정과 같다 (재생이 갈리지 않는다)
 *   ⑧ 토벌 주간 한도 — 한도만큼 들어가고 · 넘으면 찾기·시작 둘 다 막고 · 입장료는 막힌 판에 안 걷고 ·
 *      마지막 판 뒤 다음 상대를 안 잡고 · 한도 없는 등급은 안 세고 · 일요일 0시(KST)에 풀린다 (2026-09-19)
 *   ⑨ 합동전 토벌 보스 — 편성 두 기 · 요청한 자리와 전술 · 걸러 받기 · 두 기 모두 정산 ·
 *      기준 기체(높은 레벨)로 보스 레벨과 출격비 · 응답만으로 재생 (2026-09-21)
 *
 * node --no-warnings tools/battlecheck.mjs */
import { DatabaseSync } from 'node:sqlite';
import {sqliteD1} from './sqlite-d1.mjs';
import { readFileSync } from 'node:fs';
import { CONST, ROBOT_TYPES } from '../data/balance.js';
import { findMatch, startBattle } from '../server/battle.js';
import { loadState } from '../server/state.js';
import { bandStart, bandStep, bandRow, readHuntWeek, huntCap, huntResetAt } from '../js/rewards.js';
import { makeUnit, simulate } from '../js/sim.js';
import { runJoint } from '../js/joint.js';

let bad = 0;
const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) bad++; };

/* ── D1 흉내 — prepare().bind().first()/all()/run() 과 batch() 만 있으면 된다 ── */
const db = new DatabaseSync(':memory:');
db.exec(readFileSync(new URL('../server/schema.sql', import.meta.url), 'utf8'));

const env = sqliteD1(db);
const q = (sql, ...a) => db.prepare(sql).get(...a);

/* ── 계정 하나 — Lv.30 AZURE, 레이팅 1500, 구간 칸은 비어 있다(이 기능 전의 계정) ── */
const T0 = 1_760_000_000_000;
db.prepare('INSERT INTO account (id, device_key, created_at, last_seen) VALUES (1, ?, ?, ?)').run('dev-1', T0, T0);
db.prepare(`INSERT INTO player (account_id, nickname, credits, rating, updated_at) VALUES (1, 'TESTER', 999999, 1500, ?)`).run(T0);
db.prepare(`INSERT INTO robot (id, account_id, type, level, uid, created_at) VALUES (1, 1, 'azure', 30, 'r1', ?)`).run(T0);
db.prepare('UPDATE player SET sel_robot = 1 WHERE account_id = 1').run();
const hasLevel = db.prepare("SELECT 1 FROM pragma_table_info('player') WHERE name='level'").get();
if (hasLevel) db.prepare('UPDATE player SET level = 30 WHERE account_id = 1').run();

console.log('== 대전 50판 — 몬스터 판마다 구간을 따라간다 ==');
const want0 = bandStart(null, 1500);
ok(q('SELECT mband FROM player WHERE account_id=1').mband === null, '시작할 때 구간 칸은 비어 있다');

let now = T0 + 1000;
const f = await findMatch(env, 1, now, null);
ok(f.ok !== false && f.opponent, '상대를 찾는다');

let seenMon = 0, seenOther = 0, moveErr = 0, stayErr = 0, goalErr = 0, nextErr = 0, replayErr = 0, promoted = 0;
let first = true, promoteNextOk = null;
for (let n = 0; n < 50; n++) {
  now += 60_000;
  db.prepare('UPDATE player SET credits = 999999 WHERE account_id = 1').run();
  db.prepare('UPDATE robot SET fat = 0 WHERE id = 1').run();
  const before = q('SELECT mband, mband_pts, pending_match FROM player WHERE account_id=1');
  const pend = JSON.parse(before.pending_match);
  const r = await startBattle(env, 1, now, { tactic: 'bal' });
  if (!r.ok) { ok(false, `전투 ${n + 1}판이 실패했다: ${r.error}`); break; }
  const after = q('SELECT mband, mband_pts FROM player WHERE account_id=1');

  /* ⑦ 재생 — 클라가 하는 그대로, 응답의 스탯과 시드만으로 다시 돌린다 */
  /* js/game.js 의 재생과 같은 인자다(기체 종류가 스킬을 정하므로 종류까지 같아야 한다) */
  const ev = simulate(makeUnit(r.nameP, 'azure', r.statP, r.tacticP),
                      makeUnit(r.opponent.callsign, r.opponent.type, r.statE, r.tacticE), r.seed);
  if ((ev[ev.length - 1].winner === 'P') !== r.win) replayErr++;

  const monster = pend.opp.kind === 'monster' && !pend.rescue && (pend.mode || 'arena') === 'arena';
  if (monster) {
    seenMon++;
    const from = before.mband ?? bandStart(null, 1500);
    if (first) { ok(pend.opp.band === want0, `① 첫 몬스터가 레이팅 1500 의 자리(구간 ${want0})에서 나온다 — 나온 구간 ${pend.opp.band}`); first = false; }
    if (pend.opp.band !== from) goalErr++;
    const st = bandStep(from, before.mband_pts, r.win);
    if (after.mband !== st.band || after.mband_pts !== st.pts) moveErr++;
    if (!r.band || r.band.to !== st.band || r.band.pts !== st.pts || r.band.moved !== st.moved) goalErr++;
    if (st.moved === 1) { promoted++; promoteNextOk = { to: st.band }; }
  } else {
    seenOther++;
    if (after.mband !== before.mband && before.mband !== null) stayErr++;
    if (after.mband_pts !== before.mband_pts) stayErr++;
    if (r.band) goalErr++;
  }
  /* ④⑤ 다음 상대 카드 — 몬스터면 지금 DB 의 구간에서 나오고 목표도 DB 와 같다 */
  const no = r.next.opponent;
  if (no.kind === 'monster' && !r.next.rescue && r.next.mode === 'arena') {
    const cur = after.mband ?? bandStart(null, 1500);
    if (no.band !== cur) nextErr++;
    if (!no.bandGoal || no.bandGoal.band !== cur || no.bandGoal.pts !== after.mband_pts) nextErr++;
    if (promoteNextOk && no.band === promoteNextOk.to) promoteNextOk.seen = true;
  }
  /* 승급을 보려면 이기는 판이 쌓여야 한다. 구간 1 은 Lv.30 에게 쉬운 판이라,
     일부러 점수를 문턱 앞에 놓아 승급 경로를 반드시 한 번은 지나게 한다. */
  if (n === 20 && !promoted) {
    db.prepare('UPDATE player SET mband = 1, mband_pts = ? WHERE account_id=1').run(CONST.MON_BAND_STEP.up - 1);
    await findMatch(env, 1, now, null);          // 잡아 둔 상대는 옛 구간이라 다시 잡는다
  }
}
console.log(`  (몬스터 판 ${seenMon} · 그 밖의 판 ${seenOther} · 승급 ${promoted}번)`);
ok(seenMon >= 5 && seenOther >= 5, '몬스터 판과 그 밖의 판이 둘 다 나왔다');
ok(moveErr === 0, `② 몬스터 판마다 DB 의 구간·점수가 bandStep 과 같다 (어긋남 ${moveErr})`);
ok(stayErr === 0, `③ 몬스터가 아닌 판에서는 구간·점수가 안 움직인다 (어긋남 ${stayErr})`);
ok(goalErr === 0, `④ 응답의 band 가 DB 와 같고, 몬스터가 지금 구간에서 나온다 (어긋남 ${goalErr})`);
ok(nextErr === 0, `④ 다음 상대 카드의 구간·목표가 DB 와 같다 (어긋남 ${nextErr})`);
ok(promoted >= 1, `승급 경로를 지났다 (${promoted}번)`);
ok(!promoteNextOk || promoteNextOk.seen !== false, '⑤ 승급 뒤 몬스터가 새 구간에서 나온다');
ok(replayErr === 0, `⑦ 응답만으로 다시 돌린 전투가 서버 판정과 같다 (어긋남 ${replayErr})`);

console.log('\n== 비상 출격은 구간을 안 움직인다 ==');
{
  db.prepare('UPDATE player SET credits = 0, mband = 4, mband_pts = 2 WHERE account_id=1').run();
  now += 60_000;
  const g = await findMatch(env, 1, now, null);
  const pend = JSON.parse(q('SELECT pending_match FROM player WHERE account_id=1').pending_match);
  ok(pend.rescue === true, '크레딧이 0 이면 비상 출격이 잡힌다');
  ok(g.opponent && g.opponent.bandGoal == null, '비상 출격 카드에는 승급 목표를 안 띄운다');
  now += 60_000;
  const r = await startBattle(env, 1, now, { tactic: 'bal' });
  const a = q('SELECT mband, mband_pts FROM player WHERE account_id=1');
  ok(r.ok && a.mband === 4 && a.mband_pts === 2 && !r.band, `③ 비상 출격 뒤에도 구간 4 · 점수 2 그대로 (${a.mband} · ${a.mband_pts})`);
}

console.log('\n== ⑥ /api/state 가 구간을 내려 준다 ==');
{
  const s = await loadState(env, 1);
  ok(s && s.band && s.band.i === 4 && s.band.pts === 2, `state.band = ${JSON.stringify(s && s.band)}`);
  ok(bandRow(s.band.i).lv > 0, '그 구간이 표에 있다');
}

console.log('\n== ⑧ 토벌 주간 입장 한도 (2026-09-19) ==');
{
  const cap = huntCap('BOSS');
  ok(cap > 0 && huntCap('C') === 0, `보스는 주 ${cap}번 · C 는 한도 없음`);
  db.prepare('UPDATE player SET credits = 99999999, hunt_wk = NULL, pending_match = NULL WHERE account_id=1').run();
  let t = T0 + 5_000_000, last = null, errs = 0;
  for (let i = 0; i < cap; i++) {
    const fm = await findMatch(env, 1, t, { mode: 'hunt', tier: 'BOSS' }); t += 1000;
    if (!fm.ok || fm.mode !== 'hunt') { errs++; continue; }
    last = await startBattle(env, 1, t, { tactic: 'bal' }); t += 1000;
    if (!last.ok) errs++;
  }
  ok(!errs, `${cap}번은 들어간다${errs ? ` — 실패 ${errs}` : ''}`);
  const hw = readHuntWeek(q('SELECT hunt_wk FROM player WHERE account_id=1').hunt_wk, t);
  ok(hw.n.BOSS === cap, `DB 에 이번 주 ${hw.n.BOSS} 번으로 적혔다`);
  ok(last && last.huntDone === true && last.next.opponent === null, '마지막 판 — huntDone · 다음 상대를 잡지 않는다(아레나로 새지 않는다)');
  ok(last && last.hunt && last.hunt.tiers.BOSS.used === cap && last.hunt.tiers.BOSS.cap === cap, '응답이 이번 주 입장 수를 싣는다');
  ok(q('SELECT pending_match FROM player WHERE account_id=1').pending_match === null, '잡아 둔 판이 없다');
  const no = await findMatch(env, 1, t, { mode: 'hunt', tier: 'BOSS' });
  ok(!no.ok && no.error === 'hunt limit' && no.resetAt > t, `${cap + 1}번째는 찾기에서 막힌다 — ${no.error}`);

  /* 찾기를 건너뛰고 시작을 부르는 손댄 클라 — 한도를 넘기기 직전에 잡아 둔 판을 되살려 본다 */
  db.prepare('UPDATE player SET hunt_wk = ? WHERE account_id=1').run(JSON.stringify({ w: hw.w, n: { BOSS: cap - 1 } }));
  const fm2 = await findMatch(env, 1, t, { mode: 'hunt', tier: 'BOSS' }); t += 1000;
  db.prepare('UPDATE player SET hunt_wk = ? WHERE account_id=1').run(JSON.stringify({ w: hw.w, n: { BOSS: cap } }));
  const crB = q('SELECT credits FROM player WHERE account_id=1').credits;
  const st2 = await startBattle(env, 1, t, { tactic: 'bal' }); t += 1000;
  ok(fm2.ok && !st2.ok && st2.error === 'hunt limit', '찾은 뒤 한도가 찼으면 시작에서 막힌다 — 값을 지키는 자리는 시작이다');
  ok(q('SELECT credits FROM player WHERE account_id=1').credits === crB, '막힌 판은 입장료를 안 걷는다');

  /* 한도 없는 등급은 기록하지 않는다 */
  const before = q('SELECT hunt_wk FROM player WHERE account_id=1').hunt_wk;
  const fc = await findMatch(env, 1, t, { mode: 'hunt', tier: 'C' }); t += 1000;
  const sc = await startBattle(env, 1, t, { tactic: 'bal' }); t += 1000;
  ok(fc.ok && sc.ok && q('SELECT hunt_wk FROM player WHERE account_id=1').hunt_wk === before, 'C 토벌은 한도에 안 센다');

  /* 일요일 00:00 KST 를 넘기면 풀린다 */
  const nextWeek = huntResetAt(t) + 1000;
  const fw = await findMatch(env, 1, nextWeek, { mode: 'hunt', tier: 'BOSS' });
  ok(fw.ok && fw.mode === 'hunt', '초기화 시각(일요일 0시)을 넘기면 다시 들어간다');
  const sw = await startBattle(env, 1, nextWeek + 1000, { tactic: 'bal' });
  ok(sw.ok && sw.hunt.tiers.BOSS.used === 1, `새 주는 1번부터 센다 (${sw.hunt && sw.hunt.tiers.BOSS.used})`);
  const kst = new Date(huntResetAt(t) + 9 * 3600e3);
  ok(kst.getUTCDay() === 0 && kst.getUTCHours() === 0 && kst.getUTCMinutes() === 0, `초기화는 일요일 00:00 한국 시각 (${kst.toISOString().slice(0, 16)} KST)`);

  const s = await loadState(env, 1);
  ok(s.hunt && s.hunt.tiers.BOSS && s.hunt.tiers.UQ && s.hunt.resetAt > 0, '/api/state 가 이번 주 입장 수를 내린다');
}

console.log('\n== ⑨ 합동전 토벌 보스 (2026-09-21) ==');
{
  let t = T0 + 90 * 86400e3;
  db.prepare(`INSERT INTO robot (id, account_id, type, level, uid, created_at) VALUES (2, 1, 'howitzer', 50, 'r2', ?)`).run(T0);
  db.prepare(`INSERT INTO robot (id, account_id, type, level, uid, created_at) VALUES (3, 1, 'mule', 60, 'r3', ?)`).run(T0);
  db.prepare('UPDATE player SET squad1 = 1, squad2 = 2, sel_robot = 1, hunt_wk = NULL, credits = 999999 WHERE account_id = 1').run();
  db.prepare('UPDATE robot SET fat = 0, level = 30 WHERE id = 1').run();

  const f = await findMatch(env, 1, t, { mode: 'hunt', tier: 'BOSS' }); t += 1000;
  const lv = Math.min(CONST.MAXLV + (CONST.OPP_LV_OVER || 0), 50 + CONST.HUNT.BOSS.lv);
  ok(f.ok && f.opponent.joint && f.opponent.joint.aim && Array.isArray(f.opponent.joint.traits),
     `상대 카드에 합동전 조준·요구 조건 — ${f.opponent && JSON.stringify(f.opponent.joint)}`);
  ok(f.opponent.level === lv, `보스 레벨은 편성 중 높은 쪽(HOWITZER Lv.50) 기준 — Lv.${f.opponent.level} (선봉은 Lv.30)`);

  const exp0 = q('SELECT exp, fat FROM robot WHERE id=1'), exp2 = q('SELECT exp, fat FROM robot WHERE id=2');
  const r = await startBattle(env, 1, t, { tactic: 'none', order: ['r2', 'r1'], tactics: { r1: 'guard', r2: 'rush' } }); t += 1000;
  ok(r.ok && r.joint, '합동전 응답');
  ok(r.team && r.team.map(x => x.uid).join() === 'r2,r1', `요청한 자리 그대로 — 전위 ${r.team && r.team[0].uid} · 후위 ${r.team && r.team[1].uid}`);
  ok(r.team && r.team[0].tactic === 'rush' && r.team[1].tactic === 'guard', '기체별 전술 그대로');
  const rp = runJoint({ seed: r.seed, aim: r.boss.aim, team: r.team,
    boss: { name: r.boss.callsign, type: r.boss.type, stats: r.boss.stats, tactic: r.boss.tactic, traits: r.boss.traits } });
  ok(rp.win === r.win, `응답만으로 재생한 승패가 서버와 같다 (${r.win ? '승' : '패'})`);
  const e1 = q('SELECT exp, fat FROM robot WHERE id=1'), e2 = q('SELECT exp, fat FROM robot WHERE id=2');
  ok(e1.fat > exp0.fat && e2.fat > exp2.fat, `두 기 모두 피로도가 쌓였다 (${exp0.fat}→${e1.fat} · ${exp2.fat}→${e2.fat})`);
  ok(r.robots && r.robots.length === 2 && r.reward.robots.length === 2, '응답에 두 기의 정산이 모두 있다');
  ok(q('SELECT fat FROM robot WHERE id=3').fat === 0, '편성 밖 기체(MULE)는 싸우지 않았다');
  ok(r.hunt.tiers.BOSS.used === 1, `주간 한도에 센다 (${r.hunt.tiers.BOSS.used})`);
  ok(r.next && r.next.opponent && r.next.opponent.joint, '다음 상대도 합동전 보스로 미리 잡는다');

  /* 손댄 요청 — 편성 밖 기체 · 없는 전술 */
  const r2 = await startBattle(env, 1, t, { order: ['r3', 'zzz'], tactics: { r1: 'nuke', r3: 'rush' } }); t += 1000;
  ok(r2.ok && r2.team.map(x => x.uid).join() === 'r1,r2', `편성 밖 uid 는 무시하고 편성 순서로 — ${r2.team && r2.team.map(x => x.uid).join()}`);
  ok(r2.team.every(x => x.tactic === 'none'), '표에 없는 전술은 균형으로');

  /* 한 기만 편성 — 전위 하나로 싸운다 */
  db.prepare('UPDATE player SET squad2 = NULL WHERE account_id = 1').run();
  await findMatch(env, 1, t, { mode: 'hunt', tier: 'BOSS' }); t += 1000;
  const r3 = await startBattle(env, 1, t, {}); t += 1000;
  ok(r3.ok && r3.team.length === 1, '편성이 한 기뿐이면 한 기로 싸운다');
  db.prepare('UPDATE player SET squad2 = 2, hunt_wk = NULL WHERE account_id = 1').run();

  /* 일반 토벌은 그대로 1:1 */
  await findMatch(env, 1, t, { mode: 'hunt', tier: 'EP' }); t += 1000;
  const r4 = await startBattle(env, 1, t, { tactic: 'none', order: ['r2', 'r1'] }); t += 1000;
  ok(r4.ok && !r4.joint && r4.statP && !r4.team, 'EP 토벌은 예전처럼 1:1');
}

console.log(bad ? `\n✗ ${bad}건 실패` : '\n전부 통과');
process.exitCode = bad ? 1 : 0;
