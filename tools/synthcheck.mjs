/* 조각 합성 자가 점검 — 규칙 분포 + **진짜 SQLite 위에서** 합성. (2026-09-25 · 할 일 20번)
 *
 *   ① 규칙   — 성공률이 6 개 base 에서 하나마다 step 씩 오른다 · 명작은 드물다 · 수량 ½ · ⅓ · ⅕ · 결과 등급 · 결과 기체가 그 등급
 *   ② 거절   — 5 개 · 11 개 · 등급 섞기 · 에픽 · 없는 조각 · 모자란 조각 · 스크랩 모자람 · 스토리 기체
 *   ③ 합성   — 재료가 빠지고 결과가 들어오고 스크랩이 나간다 · 동시에 두 번 눌러도 한 번
 *
 * node --no-warnings tools/synthcheck.mjs */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { CONST, ROBOT_TYPES } from '../data/balance.js';
import { shopRun } from '../server/shop.js';
import { synthRates, synthCheck, rollSynth, RARS } from '../js/shardsynth.js';
import { mulberry32 } from '../js/sim.js';

let bad = 0;
const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) bad++; };
const S = CONST.SHARD_SYNTH;
const of = r => Object.keys(ROBOT_TYPES).filter(t => ROBOT_TYPES[t].rarity === r && !ROBOT_TYPES[t].story && !ROBOT_TYPES[t].monster);

console.log('== ① 규칙 ==');
{
  const r6 = synthRates(6, 'R'), r10 = synthRates(10, 'R');
  ok(Math.abs(r6.up - S.base) < 1e-9 && Math.abs(r10.up - (S.base + 4 * S.step)) < 1e-9, `성공률 6개 ${(r6.up * 100).toFixed(0)}% → 10개 ${(r10.up * 100).toFixed(0)}%`);
  ok([7, 8, 9, 10].every(n => synthRates(n, 'R').up > synthRates(n - 1, 'R').up), '7개부터 하나마다 오른다');
  ok(r6.master === S.master && S.master <= 0.02, `명작 ${(S.master * 100).toFixed(1)}%(매우 낮다)`);
  const N = 200000, rnd = mulberry32(11), c = { same: 0, up: 0, master: 0 }, qty = { same: new Set(), up: new Set(), master: new Set() };
  let rarOk = true;
  for (let i = 0; i < N; i++) {
    const x = rollSynth('R', 10, rnd); c[x.grade]++; qty[x.grade].add(x.qty);
    const want = { same: 'R', up: 'UQ', master: 'EP' }[x.grade];
    if (x.rarity !== want || ROBOT_TYPES[x.type].rarity !== want) rarOk = false;
  }
  ok(Math.abs(c.up / N - r10.up) < 0.005 && Math.abs(c.master / N - S.master) < 0.002, `R 10개 실측 — 성공 ${(100 * c.up / N).toFixed(1)}% · 명작 ${(100 * c.master / N).toFixed(2)}% · 동급 ${(100 * c.same / N).toFixed(1)}%`);
  ok(rarOk, '결과 등급 · 결과 기체 등급이 맞다(동급 R · 성공 UQ · 명작 EP)');
  ok([...qty.same].join() === '5' && [...qty.up].join() === '3' && [...qty.master].join() === '2', 'R 10개 → 동급 5 · 성공 3 · 명작 2');
  const q6 = n => ['same', 'up', 'master'].map(g => Math.max(1, Math.round(n * S.qty[g])));
  ok(q6(6).join() === '3,2,1', `6개 → 동급 3 · 성공 2 · 명작 1`);
  const uq = new Set(); const r2 = mulberry32(3);
  for (let i = 0; i < 50000; i++) { const x = rollSynth('UQ', 10, r2); if (x.grade === 'master') uq.add(x.rarity); }
  ok([...uq].join() === 'EP', '유니크의 명작은 에픽에서 멈춘다');
  const seen = new Set(); const r3 = mulberry32(5);
  for (let i = 0; i < 20000; i++) { const x = rollSynth('C', 6, r3); if (x.grade === 'same') seen.add(x.type); }
  ok(seen.size === of('C').length, `목표가 없으면 결과 기체는 그 등급 전체에서 무작위(C ${seen.size}/${of('C').length})`);
  /* 개발 목표 우선(2026-09-25) — 결과 등급이 목표 등급과 같으면 늘 목표, 다르면 무작위 */
  const [gq] = of('UQ'), r4 = mulberry32(8), hitUQ = new Set(), otherR = new Set();
  for (let i = 0; i < 20000; i++) { const x = rollSynth('R', 10, r4, gq); if (x.rarity === 'UQ') hitUQ.add(x.type); if (x.rarity === 'R') otherR.add(x.type); }
  ok([...hitUQ].join() === gq && otherR.size > 5, `목표 ${gq}(UQ) — UQ 로 오르면 늘 목표 조각, 동급(R)은 무작위(${otherR.size}종)`);
}

console.log('== ② 거절 ==');
{
  const [a, b] = of('R'), [u] = of('UQ'), [e] = of('EP');
  const story = Object.keys(ROBOT_TYPES).find(t => ROBOT_TYPES[t].story);
  const items = { ['shard:' + a]: 20, ['shard:' + b]: 5, ['shard:' + u]: 10, ['shard:' + e]: 10, ['shard:' + story]: 10 };
  const why = m => synthCheck(m, items).error || '';
  ok(/6개부터/.test(why({ [a]: 5 })), '5개는 거절');
  ok(/10개까지/.test(why({ [a]: 11 })), '11개는 거절');
  ok(/같은 등급/.test(why({ [a]: 4, [u]: 4 })), '등급 섞기 거절');
  ok(/에픽/.test(why({ [e]: 8 })), '에픽 조각은 거절');
  ok(/모자랍니다/.test(why({ [b]: 7 })), '가진 것보다 많이는 거절');
  ok(/알 수 없는/.test(why({ [story]: 7 })) && /알 수 없는/.test(why({ nope: 7 })), '스토리 · 없는 기체 거절');
  ok(/개수/.test(why({ [a]: -3, [b]: 9 })) && /개수/.test(why({ [a]: 'x' })), '음수 · 숫자 아님 거절');
  const okk = synthCheck({ [a]: 4, [b]: 3 }, items);
  ok(!okk.error && okk.n === 7 && okk.rar === 'R' && okk.cost === S.scrap.R, '같은 등급 두 기체 섞어 7개는 된다');
}

console.log('== ③ 합성 (SQLite) ==');
{
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../server/schema.sql', import.meta.url), 'utf8'));
  const stmt = (sql, args = []) => ({
    bind: (...x) => stmt(sql, x),
    first: async () => db.prepare(sql).get(...args) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...args) }),
    run: async () => { const r = db.prepare(sql).run(...args); return { meta: { changes: Number(r.changes) } }; },
  });
  const env = { DB: { prepare: sql => stmt(sql), batch: async l => { const o = []; for (const s of l) o.push(await s.run()); return o; } } };
  const T0 = Date.UTC(2026, 8, 25, 3);
  const [a, b] = of('R');
  db.prepare('INSERT INTO account (id, device_key, created_at, last_seen) VALUES (1, ?, ?, ?)').run('d', T0, T0);
  db.prepare(`INSERT INTO player (account_id, nickname, credits, cores, scrap, items, updated_at) VALUES (1, 'T', 0, 0, ?, ?, ?)`)
    .run(S.scrap.R * 2 + 10, JSON.stringify({ ['shard:' + a]: 9, ['shard:' + b]: 6 }), T0);
  db.prepare(`INSERT INTO robot (id, account_id, type, level, uid, created_at) VALUES (1, 1, 'grit', 30, 'r1', ?)`).run(T0);
  const P = () => db.prepare('SELECT scrap, items FROM player WHERE account_id = 1').get();

  const r = await shopRun(env, 1, T0, { action: 'synth', mats: { [a]: 5, [b]: 3 } });
  const it = JSON.parse(P().items);
  ok(r.ok && r.synth && r.synth.used === 8, `합성 — ${r.synth && r.synth.grade} → ${r.synth && r.synth.type} ×${r.synth && r.synth.qty}`);
  const expA = 4 + (r.synth.type === a ? r.synth.qty : 0), expB = 3 + (r.synth.type === b ? r.synth.qty : 0);
  ok((it['shard:' + a] | 0) === expA && (it['shard:' + b] | 0) === expB, `재료가 빠졌다(${a} 9 → ${it['shard:' + a] | 0} · ${b} 6 → ${it['shard:' + b] | 0})`);
  ok((it['shard:' + r.synth.type] | 0) >= r.synth.qty, '결과 조각이 들어왔다');
  ok(P().scrap === S.scrap.R + 10, `스크랩 ${S.scrap.R} 나감`);
  ok(r.bag && r.bag.some(x => x.type === r.synth.type), '보관함 목록에 보인다');

  db.prepare('UPDATE player SET items = ?1 WHERE account_id = 1').run(JSON.stringify({ ['shard:' + a]: 20 }));
  const [x, y] = await Promise.all([shopRun(env, 1, T0, { action: 'synth', mats: { [a]: 10 } }),
                                    shopRun(env, 1, T0, { action: 'synth', mats: { [a]: 10 } })]);
  ok([x, y].filter(z => z.ok).length === 1 && P().scrap === 10, '동시에 두 번 눌러도 한 번(스크랩도 한 번)');
  const z = await shopRun(env, 1, T0, { action: 'synth', mats: { [a]: 6 } });
  ok(!z.ok && z.error === 'not enough scrap', '스크랩 모자라면 거절');
  const w = await shopRun(env, 1, T0, { action: 'synth', mats: { [a]: 5 } });
  ok(!w.ok && w.error === 'bad synth' && /6개부터/.test(w.why), '규칙 위반은 이유를 돌려준다');
}

console.log(bad ? `\n실패 ${bad}` : '\n전부 통과');
process.exitCode = bad ? 1 : 0;
