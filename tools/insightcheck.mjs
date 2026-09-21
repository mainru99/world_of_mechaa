/* 전투 분석(js/insight.js) 자가 점검 (2026-09-21)
 *
 *   ① 딜표가 맞다 — 받은 피해 − 방벽이 막은 양 = 잃은 체력 + 회복한 양 (1:1 · 합동전, 여러 판)
 *   ② 평타 · 스킬을 제대로 가른다 — 스킬 타격 수 = 'skill' 사건 뒤에 이어진 타격 수
 *   ③ 승패 요인이 약속대로 — 추정 승률이 0~1 · 같은 입력이면 같은 분석 · 운 문장이 결과와 맞는다
 *   ④ 시간 — 결과 창을 막지 않을 만큼 빠르다(1:1 · 합동전 · 레이드)
 *
 * node --no-warnings tools/insightcheck.mjs */
import { ROBOT_TYPES, MONSTER_TYPES, CONST } from '../data/balance.js';
import { computeStats } from '../js/stats.js';
import { makeUnit, simulate } from '../js/sim.js';
import { runJoint, jointOf, jointBossStats } from '../js/joint.js';
import { raidOf, runRaid } from '../js/raid.js';
import { damageTable, insight1, insightJoint, eventLines } from '../js/insight.js';

let bad = 0;
const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) bad++; };
const E0 = { WEAPON: null, FRAME: null, BOOSTER: null, CORE: null };
const st = (t, lv = 30) => computeStats({ type: t, level: lv, skillLv: 0, fat: 0, slots: E0 }, []);

console.log('== ① 딜표 — 피해 합계가 체력 변화와 맞는다 ==');
{
  let fails = 0, n = 0;
  const ids = Object.keys(ROBOT_TYPES);
  for (let s = 1; s <= 300; s++) {
    const a = ids[s % ids.length], b = ids[(s * 7) % ids.length];
    const P = makeUnit('P', a, st(a)), E = makeUnit('E', b, st(b));
    const ev = simulate(P, E, s * 131);
    const T = damageTable(ev);
    for (const [u, side] of [[P, 'P'], [E, 'E']]) {
      const foe = T[(side === 'P' ? 'E' : 'P') + '0'], me = T[side + '0'];
      const lost = u.maxhp - u.hp + (me ? me.heal : 0);
      /* 딜표는 화면에 뜬 피해 숫자를 센다 — 쓰러진 쪽은 마지막 일격이 남은 체력보다 컸던 만큼(초과분) 더 크다 */
      const diff = (foe ? foe.total : 0) - (me ? me.absorbed : 0) - lost;
      if (u.hp > 0 ? diff !== 0 : (diff < 0 || diff >= maxHit(ev, side))) fails++;
      n++;
    }
  }
  ok(fails === 0, `1:1 ${n}번 대조 — 어긋남 ${fails}`);
  /* 합동전 */
  let jf = 0, jn = 0;
  for (let s = 1; s <= 40; s++) {
    const b = 'boss_nihil', J = jointOf(b), bs = jointBossStats(st(b, 70), J.traits, b);
    const r = runJoint({ seed: s * 17, aim: J.aim, team: [{ name: 'F', type: 'patch', stats: st('patch', 60), tactic: 'none' },
      { name: 'B', type: 'husk', stats: st('husk', 60), tactic: 'none' }], boss: { name: 'X', type: b, stats: bs, tactic: 'none', traits: J.traits } });
    const T = damageTable(r.events);
    const dealt = (T.P0 ? T.P0.total : 0) + (T.P1 ? T.P1.total : 0);
    const bd = dealt - (T.E0 ? T.E0.absorbed : 0) - (r.boss.maxhp - r.boss.hp + (T.E0 ? T.E0.heal : 0));
    if (r.boss.hp > 0 ? bd !== 0 : (bd < 0 || bd >= maxHit(r.events, 'E', 0))) jf++;
    for (const i of [0, 1]) { const u = r.team[i], me = T['P' + i]; if (!me) continue;
      const d = receivedBy(r.events, 'P', i) - me.absorbed - (u.maxhp - u.hp + me.heal);
      if (u.hp > 0 ? d !== 0 : (d < 0 || d >= maxHit(r.events, 'P', i))) jf++; }
    jn++;
  }
  ok(jf === 0, `합동전 ${jn}판 — 보스 · 두 기 모두 어긋남 ${jf}`);
}
/* 이 쪽이 받은 타격 중 가장 큰 것 — 초과분의 상한 */
function maxHit(ev, side, i = 0) { let m = 0; for (const e of ev) if (e.t === 'hit' && !e.miss && e.dside === side && (e.di | 0) === i) m = Math.max(m, e.dmg); return m + 1; }
function receivedBy(ev, side, i) { let s = 0; for (const e of ev) if (e.t === 'hit' && !e.miss && e.dside === side && (e.di | 0) === i) s += e.dmg; return s; }

console.log('\n== ② 평타 · 스킬 ==');
{
  let mis = 0;
  for (let s = 1; s <= 100; s++) {
    const ev = simulate(makeUnit('P', 'ignis', st('ignis')), makeUnit('E', 'scarab', st('scarab')), s);
    let inSk = null, skHits = 0;
    for (const e of ev) { if (e.t === 'turn') inSk = null; else if (e.t === 'skill') inSk = e.side; else if (e.t === 'hit' && !e.miss && inSk === e.side && e.side === 'P') skHits++; }
    if (damageTable(ev).P0.sHits !== skHits) mis++;
  }
  ok(mis === 0, `스킬 타격 수가 사건 순서와 같다(100판 · 어긋남 ${mis})`);
}

console.log('\n== ③ 승패 요인 ==');
const spec1 = { P: { name: 'a', type: 'glacier', stats: st('glacier'), tactic: 'rush' },
                E: { name: 'b', type: 'oracle', stats: st('oracle'), tactic: 'none' }, seed: 12345 };
spec1.win = simulate(makeUnit('a', 'glacier', spec1.P.stats, 'rush'), makeUnit('b', 'oracle', spec1.E.stats), 12345).at(-1).winner === 'P';
{
  const a = insight1(spec1), b = insight1(spec1);
  ok(a.base >= 0 && a.base <= 1 && JSON.stringify(a) === JSON.stringify(b), `추정 승률 ${Math.round(a.base * 100)}% · 같은 입력 같은 분석`);
  ok(Object.keys(a.alt).length === Object.keys(CONST.TACTIC).length, '전술마다 추정 승률이 있다');
  console.log('    ' + a.lines.map(l => l.text).join(' / '));
  const lucky = insight1({ ...spec1, win: true }), unlucky = insight1({ ...spec1, win: false });
  ok(!(lucky.base >= 0.35 && lucky.lines[0].k === 'luck' && lucky.lines[0].text.includes('졌다')), '이긴 판에 "졌다" 가 뜨지 않는다');
  ok(!unlucky.lines.some(l => l.text.includes('이겼다')), '진 판에 "이겼다" 가 뜨지 않는다');
  const T = damageTable(simulate(makeUnit('a', 'glacier', spec1.P.stats, 'rush'), makeUnit('b', 'oracle', spec1.E.stats), 12345));
  console.log('    ' + eventLines(T, r => r.side === 'P').map(l => l.text).join(' / '));
}

console.log('\n== ④ 시간 ==');
{
  let t = Date.now(); insight1(spec1); const t1 = Date.now() - t;
  const b = 'boss_bael_fortress', J = jointOf(b);
  const js = { team: [{ name: 'G', type: 'glacier', stats: st('glacier', 55), tactic: 'guard' }, { name: 'H', type: 'howitzer', stats: st('howitzer', 55), tactic: 'rush' }],
    boss: { name: 'B', type: b, stats: jointBossStats(st(b, 85), J.traits, b), tactic: 'none', traits: J.traits }, aim: J.aim, seed: 777, win: false };
  t = Date.now(); const jr = insightJoint(js); const t2 = Date.now() - t;
  console.log('    합동전: ' + jr.lines.map(l => l.text).join(' / '));
  const r = raidOf(3000);
  const rs = { team: js.team, boss: { name: 'R', type: r.boss, stats: r.stats, tactic: 'none', traits: r.traits }, aim: r.aim, seed: 99, raid: true, maxTurns: (CONST.RAID || {}).turns || 600 };
  t = Date.now(); const rr = insightJoint(rs); const t3 = Date.now() - t;
  console.log('    레이드: ' + rr.lines.map(l => l.text).join(' / '));
  ok(t1 < 400 && t2 < 1500 && t3 < 3000, `1:1 ${t1}ms · 합동전 ${t2}ms · 레이드 ${t3}ms (node 기준)`);
}

console.log(bad ? `\n✗ ${bad}건 실패` : '\n전부 통과');
process.exitCode = bad ? 1 : 0;
