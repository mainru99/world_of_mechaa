/* 교대 전투 자가 점검 — 엔진 + **진짜 SQLite 위에서** findMatch → startBattle. (2026-09-25 · CONST.RELAY)
 *
 *   ① 엔진   — bench 가 없으면 예전과 같다 · 앞 기체가 쓰러지면 swap 사건과 함께 다음 기체 · 승자는 마지막까지 선 쪽 · 결정적
 *   ② 꺼짐   — CONST.RELAY.on 이 false 면 응답에 relay 가 없고 사건에 swap 이 없다(지금 운영)
 *   ③ 켜짐   — (이 검사 안에서만 켠다) 두 기 대 두 기 · 경험치 60 / 40 · 나온 기체만 피로도 · 두 기체 행이 바뀐다
 *   ④ 한 기  — 편성이 한 기면 켜져 있어도 1:1
 *
 * node --no-warnings tools/relaycheck.mjs */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { CONST } from '../data/balance.js';
import { findMatch, startBattle } from '../server/battle.js';
import { registerArena } from '../server/arena.js';
import { makeUnit, simulate, relayOut } from '../js/sim.js';
import { computeStats } from '../js/stats.js';

let bad = 0;
const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) bad++; };
const E0 = { WEAPON: null, FRAME: null, BOOSTER: null, CORE: null };
const st = (t, lv) => computeStats({ type: t, level: lv, fat: 0, skillLv: 0, slots: E0 }, []);

console.log('== ① 엔진 ==');
{
  const a = simulate(makeUnit('A', 'mule', st('mule', 30)), makeUnit('B', 'dune', st('dune', 30)), 77);
  const b = simulate(makeUnit('A', 'mule', st('mule', 30)), makeUnit('B', 'dune', st('dune', 30)), 77, { P: [], E: [] });
  ok(JSON.stringify(a) === JSON.stringify(b), 'bench 가 비었으면 예전 전투와 사건까지 같다');
  let swaps = 0, both = 0, consistent = 0, det = 0;
  for (let s = 1; s <= 200; s++) {
    const mk = () => [makeUnit('A', 'mule', st('mule', 30)), makeUnit('B', 'dune', st('dune', 30)),
                      makeUnit('A2', 'rust', st('rust', 30)), makeUnit('B2', 'scarab', st('scarab', 30))];
    const [P, E, P2, E2] = mk();
    const ev = simulate(P, E, s, { P: [P2], E: [E2] });
    const n = relayOut(ev), end = ev[ev.length - 1];
    if (ev.some(e => e.t === 'swap')) swaps++;
    if (n.P === 2 && n.E === 2) both++;
    /* 이긴 쪽의 마지막 기체는 살아 있고, 진 쪽은 두 기가 다 나왔고 둘째도 쓰러졌다 */
    const lastP = n.P === 2 ? P2 : P, lastE = n.E === 2 ? E2 : E;
    if ((end.winner === 'P' && lastP.hp > 0 && n.E === 2 && lastE.hp <= 0) || (end.winner === 'E' && lastE.hp > 0 && n.P === 2 && lastP.hp <= 0)) consistent++;
    const [p, e, p2, e2] = mk();
    if (JSON.stringify(simulate(p, e, s, { P: [p2], E: [e2] })) === JSON.stringify(ev)) det++;
  }
  ok(swaps === 200 && both > 100, `200판 모두 교대가 일어난다 · 양쪽 다 둘째가 나온 판 ${both}`);
  ok(consistent === 200, `승자는 마지막까지 선 쪽 · 진 쪽은 두 기 다 쓰러졌다(${consistent}/200)`);
  ok(det === 200, '같은 시드면 같은 전투(서버 판정 = 화면 재생)');
  const ev = simulate(makeUnit('A', 'mule', st('mule', 30)), makeUnit('B', 'dune', st('dune', 30)), 5,
                      { P: [makeUnit('A2', 'rust', st('rust', 30))], E: [makeUnit('B2', 'scarab', st('scarab', 30))] });
  const sw = ev.find(e => e.t === 'swap');
  ok(sw && sw.i === 1 && sw.hp === sw.maxhp && sw.name && sw.type, `swap 사건 — ${JSON.stringify(sw)}`);
}

/* SQLite 위의 계정 */
const db = new DatabaseSync(':memory:');
db.exec(readFileSync(new URL('../server/schema.sql', import.meta.url), 'utf8'));
const stmt = (sql, args = []) => ({
  bind: (...x) => stmt(sql, x),
  first: async () => db.prepare(sql).get(...args) ?? null,
  all: async () => ({ results: db.prepare(sql).all(...args) }),
  run: async () => { const r = db.prepare(sql).run(...args); return { meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }; },
});
const env = { DB: { prepare: sql => stmt(sql), batch: async l => { const o = []; for (const s of l) o.push(await s.run()); return o; } } };
const T0 = Date.UTC(2026, 8, 25, 3);
db.prepare('INSERT INTO account (id, device_key, created_at, last_seen) VALUES (1, ?, ?, ?)').run('d', T0, T0);
db.prepare(`INSERT INTO player (account_id, nickname, credits, rating, updated_at) VALUES (1, 'T', 999999, 1100, ?)`).run(T0);
db.prepare(`INSERT INTO robot (id, account_id, type, level, uid, created_at) VALUES (1, 1, 'azure', 30, 'r1', ?)`).run(T0);
db.prepare(`INSERT INTO robot (id, account_id, type, level, uid, created_at) VALUES (2, 1, 'mule', 30, 'r2', ?)`).run(T0);
db.prepare('UPDATE player SET sel_robot = 1, squad1 = 1, squad2 = 2 WHERE account_id = 1').run();
const R = id => db.prepare('SELECT level, exp, fat FROM robot WHERE id = ?').get(id);
const play = async (t, tactic2) => { const f = await findMatch(env, 1, t, null); const r = await startBattle(env, 1, t + 1, { tactic: 'none', tactic2 }); return { f, r }; };

console.log('== ② 꺼짐 ==');
const ON = CONST.RELAY.on;
CONST.RELAY.on = false;
{
  const { f, r } = await play(T0);
  ok(r.ok && r.relay === null && f.opponent.bench === undefined, '응답에 relay 없음 · 상대 카드에 bench 없음');
}

console.log(`== ③ 켜짐(운영 값 ${ON}) ==`);
CONST.RELAY.on = true;
{
  let twoOut = 0, oneOut = 0, n = 0;
  for (let k = 0; k < 30; k++) {
    const b1 = R(1), b2 = R(2);
    const { f, r } = await play(T0 + 100000 * (k + 1), 'guard');
    if (!r.ok) { ok(false, 'startBattle 실패 ' + r.error); break; }
    if (k === 0) ok(f.opponent.bench && f.opponent.bench.length === 1, `상대 카드에 둘째 기체 — ${JSON.stringify(f.opponent.bench)}`);
    if (!r.relay) continue;
    n++;
    const a1 = R(1), a2 = R(2);
    if (r.relay.out.P === 2) {
      twoOut++;
      const [e1, e2] = r.relay.share, tot = e1 + e2;
      if (tot > 0 && Math.abs(e1 / tot - 0.6) > 0.02) ok(false, `경험치 몫 ${e1}/${e2}`);
      /* 피로도는 응답의 '이번 판에 쌓인 양' 으로 본다 — addFat 은 실제 시계로 자연 회복을 먼저 정산해서 행 값은 테스트 시각과 어긋난다 */
      if (!r.relay.robot2 || !(r.relay.robot2.fatGain.add > 0 || r.relay.robot2.fatGain.now === 45)) ok(false, '둘째가 나왔는데 피로도가 안 쌓였다');
      if (typeof r.relay.robot2.fat !== 'number') ok(false, 'robot2.fat 은 숫자(피로도)여야 한다');
      if (a2.exp === b2.exp && a2.level === b2.level && e2 > 0) ok(false, '둘째 행의 경험치가 안 바뀌었다');
    } else {
      oneOut++;
      if (a2.fat !== b2.fat || a2.exp !== b2.exp) ok(false, '둘째가 안 나왔는데 둘째 행이 바뀌었다');
      if (r.relay.share[1] !== 0) ok(false, '둘째가 안 나왔는데 몫이 있다');
    }
    if (r.relay.tacticP2 !== 'guard') ok(false, 'tactic2 가 안 들어갔다');
    /* 화면이 할 재생 — 응답만으로 같은 전투가 나오는가 */
    const P = makeUnit(r.nameP, 'azure', r.statP, r.tacticP), E = makeUnit(r.opponent.callsign, r.opponent.type, r.statE, r.tacticE);
    const ev = simulate(P, E, r.seed, { P: [makeUnit(r.relay.nameP2, r.relay.typeP2, r.relay.statP2, r.relay.tacticP2)],
                                         E: [makeUnit(r.relay.nameE2, r.relay.typeE2, r.relay.statE2, r.relay.tacticE2)] });
    if ((ev[ev.length - 1].winner === 'P') !== r.win) ok(false, '응답으로 재생한 전투의 승패가 서버와 다르다');
  }
  ok(n === 30, `30판 모두 교대 전투(${n})`);
  ok(twoOut > 0, `둘째가 나온 판 ${twoOut} · 첫째만으로 끝난 판 ${oneOut} — 경험치 60/40 · 피로도 · 재생 일치`);
}

console.log('== ④ 한 기 ==');
{
  db.prepare('UPDATE player SET squad2 = NULL WHERE account_id = 1').run();
  const { r } = await play(T0 + 9e7);
  ok(r.ok && r.relay === null, '편성이 한 기면 켜져 있어도 1:1');
}
console.log('== ⑤ 사람 상대(지목 대전) ==');
{
  db.prepare('UPDATE player SET squad2 = 2 WHERE account_id = 1').run();
  db.prepare('INSERT INTO account (id, device_key, created_at, last_seen) VALUES (2, ?, ?, ?)').run('d2', T0, T0);
  db.prepare(`INSERT INTO player (account_id, nickname, credits, rating, updated_at) VALUES (2, 'RIVAL', 1000, 1100, ?)`).run(T0);
  db.prepare(`INSERT INTO robot (id, account_id, type, level, uid, created_at) VALUES (3, 2, 'dune', 30, 'q1', ?)`).run(T0);
  db.prepare(`INSERT INTO robot (id, account_id, type, level, uid, created_at, circuit) VALUES (4, 2, 'grit', 30, 'q2', ?, '["A1","A2"]')`).run(T0);
  db.prepare('UPDATE player SET sel_robot = 3, squad1 = 3, squad2 = 4 WHERE account_id = 2').run();
  await registerArena(env, 2, T0);
  const f = await findMatch(env, 1, T0 + 2e8, { mode: 'duel', target: 'RIVAL' });
  ok(f.ok && f.opponent.bench && f.opponent.bench[0].type === 'grit', `상대 편성의 다른 기체가 둘째로 — ${JSON.stringify(f.opponent.bench)}`);
  const r = await startBattle(env, 1, T0 + 2e8 + 1, { tactic: 'none' });
  ok(r.ok && r.relay && r.relay.typeE2 === 'grit' && r.relay.statE2.hp > 0, '친선전도 교대 전투 · 상대 둘째 능력치(찍은 별 포함)');
  ok(r.reward.cr === 0 && (!r.relay.robot2 || r.relay.share.join() === '0,0'), '친선전은 여전히 아무것도 안 준다');
}
CONST.RELAY.on = ON;

console.log(bad ? `\n실패 ${bad}` : '\n전부 통과');
process.exitCode = bad ? 1 : 0;
