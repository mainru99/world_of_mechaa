/* 상점 · 기체 조각 자가 점검 — **진짜 SQLite 위에서** 사고, 굴리고, 조립한다.
 *
 *   ① 진열   — 같은 계정·주기·횟수면 같은 진열 · 계정마다 다르다 · 확률 분포가 설정대로다
 *   ② 사기   — 값이 빠지고 물건이 들어온다(파츠 행·조각·스크랩·코어) · 파츠는 도감 트리거까지
 *              · 두 번 못 산다 · 모자라면 거절 · 화면이 본 것과 다르면 409
 *   ③ 굴리기 — 값이 빠지고 진열이 바뀐다 · 굴릴수록 비싸진다 · 주기가 넘어가면 처음부터
 *   ④ 조립   — 조각이 모자라면 거절 · 새 기체는 행이 생긴다(도감 트리거) · 가진 기체면 자원
 *   ⑤ state  — /api/state 가 보관함을 내린다
 *
 * node --no-warnings tools/shopcheck.mjs */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { CONST, ROBOT_TYPES } from '../data/balance.js';
import { shopView, shopRun } from '../server/shop.js';
import { loadState } from '../server/state.js';
import { rollShop, shopState, refreshCost, shardNeed, PERIOD_MS, priceMult } from '../js/shop.js';

let bad = 0;
const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) bad++; };

const db = new DatabaseSync(':memory:');
db.exec(readFileSync(new URL('../server/schema.sql', import.meta.url), 'utf8'));
const stmt = (sql, args = []) => ({
  bind: (...a) => stmt(sql, a),
  first: async () => db.prepare(sql).get(...args) ?? null,
  all: async () => ({ results: db.prepare(sql).all(...args) }),
  run: async () => { const r = db.prepare(sql).run(...args); return { meta: { changes: Number(r.changes) } }; },
});
const env = { DB: { prepare: sql => stmt(sql), batch: async list => { for (const s of list) await s.run(); return []; } } };
const q = (sql, ...a) => db.prepare(sql).get(...a);
const P = () => q('SELECT credits, cores, scrap, items, shop, codex FROM player WHERE account_id=1');

const T0 = Math.floor(1_760_000_000_000 / PERIOD_MS()) * PERIOD_MS() + 1000;   // 주기 시작 직후
db.prepare('INSERT INTO account (id, device_key, created_at, last_seen) VALUES (1, ?, ?, ?)').run('dev-1', T0, T0);
db.prepare(`INSERT INTO player (account_id, nickname, credits, cores, scrap, updated_at) VALUES (1, 'TESTER', 5000000, 0, 0, ?)`).run(T0);
db.prepare(`INSERT INTO robot (id, account_id, type, level, uid, created_at) VALUES (1, 1, 'grit', 30, 'r1', ?)`).run(T0);

console.log('== ① 진열 ==');
{
  const v1 = await shopView(env, 1, T0), v2 = await shopView(env, 1, T0 + 5000);
  ok(v1.ok && v1.stock.length === CONST.SHOP.slots, `진열 ${v1.stock.length}칸 · 레벨 ${v1.lv} · 값 배율 ×${priceMult(v1.lv)}`);
  ok(JSON.stringify(v1.stock) === JSON.stringify(v2.stock), '같은 주기 안에서는 다시 열어도 같은 진열');
  const other = rollShop(2, shopState(null, T0, 30));
  ok(JSON.stringify(other) !== JSON.stringify(rollShop(1, shopState(null, T0, 30))), '계정마다 진열이 다르다');
  const cnt = {}; let N = 0;
  for (let n = 0; n < 2000; n++) for (const x of rollShop(1, { p: 1, n, lv: 30, b: [] })) { cnt[x.kind] = (cnt[x.kind] || 0) + 1; N++; }
  const pct = k => (cnt[k] || 0) / N * 100;
  ok(Math.abs(pct('core') - CONST.SHOP.kind.core) < 1, `코어는 드물다 — ${pct('core').toFixed(1)}% (설정 ${CONST.SHOP.kind.core}%)`);
  ok(Math.abs(pct('part') - CONST.SHOP.kind.part) < 2.5, `파츠 ${pct('part').toFixed(1)}% (설정 ${CONST.SHOP.kind.part}%)`);
}

/* 원하는 종류가 진열에 나올 때까지 굴린다(굴리기 값은 넉넉히 줬다) */
async function until(kind, pred = () => true) {
  for (let k = 0; k < 60; k++) {
    const v = await shopView(env, 1, T0);
    const x = v.stock.find(s => s.kind === kind && !s.sold && pred(s));
    if (x) return { v, x };
    await shopRun(env, 1, T0, { action: 'refresh' });
  }
  return {};
}

console.log('\n== ② 사기 ==');
{
  const { x } = await until('part');
  const b = P();
  const r = await shopRun(env, 1, T0, { action: 'buy', slot: x.i, sig: x.sig });
  const a = P();
  ok(r.ok && b.credits - a.credits === x.price, `파츠 ${x.part.name}(${x.rarity}) — 크레딧 −${b.credits - a.credits}`);
  const row = q('SELECT base, rarity, uid FROM part WHERE account_id=1 AND uid=?', x.part.uid);
  ok(row && row.base === x.part.base && row.rarity === x.rarity, '파츠 행이 진열에 보인 그대로 생겼다');
  ok(JSON.parse(a.codex || '{}').p?.[x.part.base + ':' + x.rarity] === 1, '도감 트리거가 그 파츠를 적었다');
  const again = await shopRun(env, 1, T0, { action: 'buy', slot: x.i, sig: x.sig });
  ok(!again.ok && again.error === 'sold out', '같은 칸은 두 번 못 산다');
  ok(r.stock.find(s => s.i === x.i).sold === true, '응답 진열에 판매 완료로 뜬다');
}
{
  const { x } = await until('shard');
  const r = await shopRun(env, 1, T0, { action: 'buy', slot: x.i, sig: x.sig });
  const items = JSON.parse(P().items || '{}');
  ok(r.ok && items['shard:' + x.type] >= x.qty, `조각 ${ROBOT_TYPES[x.type].name} ×${x.qty} → 보관함 ${items['shard:' + x.type]}`);
}
{
  const { x } = await until('scrap');
  const b = P(); const r = await shopRun(env, 1, T0, { action: 'buy', slot: x.i, sig: x.sig }); const a = P();
  ok(r.ok && a.scrap - b.scrap === x.qty, `스크랩 +${a.scrap - b.scrap}`);
}
{
  const { x } = await until('core');
  if (x) {
    const b = P(); const r = await shopRun(env, 1, T0, { action: 'buy', slot: x.i, sig: x.sig }); const a = P();
    ok(r.ok && a.cores - b.cores === x.qty, `코어 +${a.cores - b.cores} · 값 ${x.price} 크레딧 (드물고 비싸다)`);
  } else ok(true, '코어는 60번 굴려도 안 나올 수 있다 — 넘어간다');
}
{
  const { x } = await until('part');
  const wrong = await shopRun(env, 1, T0, { action: 'buy', slot: x.i, sig: x.sig + 'x' });
  ok(!wrong.ok && wrong.status === 409, '화면이 본 칸과 다르면 409 (진열이 바뀐 뒤 옛 화면)');
  db.prepare('UPDATE player SET credits = 10 WHERE account_id=1').run();
  const poor = await shopRun(env, 1, T0, { action: 'buy', slot: x.i, sig: x.sig });
  ok(!poor.ok && poor.error === 'not enough credits', '크레딧이 모자라면 거절');
  db.prepare('UPDATE player SET credits = 5000000 WHERE account_id=1').run();
  /* 낙관적 잠금 — 읽은 뒤 상태가 바뀌면 0행 */
  const real = env.DB.prepare; let fired = false;
  env.DB.prepare = sql => {
    if (!fired && /UPDATE player SET shop/.test(sql)) { fired = true; db.prepare(`UPDATE player SET items = '{"x":1}' WHERE account_id=1`).run(); }
    return real(sql);
  };
  const race = await shopRun(env, 1, T0, { action: 'buy', slot: x.i, sig: x.sig });
  env.DB.prepare = real;
  ok(!race.ok && race.status === 409, '읽은 뒤 상태가 바뀌면 409 — 두 번 팔 틈이 없다');
}

console.log('\n== ③ 새로 굴리기 · 주기 ==');
{
  const v = await shopView(env, 1, T0);
  const b = P(); const r = await shopRun(env, 1, T0, { action: 'refresh' }); const a = P();
  ok(r.ok && b.credits - a.credits === v.refresh, `값 ${v.refresh} 크레딧이 빠졌다`);
  ok(JSON.stringify(r.stock) !== JSON.stringify(v.stock), '진열이 바뀌었다');
  ok(r.refresh > v.refresh && r.refresh === refreshCost(r.refreshed, r.lv), `굴릴수록 비싸진다 (${v.refresh} → ${r.refresh})`);
  const next = await shopView(env, 1, T0 + PERIOD_MS());
  ok(next.refreshed === 0 && next.stock.every(s => !s.sold) && next.refresh === refreshCost(0, next.lv),
     `${CONST.SHOP.periodH}시간 뒤 — 굴린 횟수·판매 표시가 비고 값이 처음으로 돌아간다`);
}

console.log('\n== ④ 조각 조립 ==');
{
  const type = 'azure', need = shardNeed(type);
  const short = await shopRun(env, 1, T0, { action: 'assemble', type });
  ok(!short.ok && short.error === 'not enough shards', `조각이 모자라면 거절 (필요 ${need})`);
  db.prepare(`UPDATE player SET items = json_set(COALESCE(items,'{}'), '$."shard:azure"', ?) WHERE account_id=1`).run(need + 2);
  const r = await shopRun(env, 1, T0, { action: 'assemble', type });
  const row = q(`SELECT type FROM robot WHERE account_id=1 AND type='azure'`);
  ok(r.ok && !r.assembled.dupe && !!row, '새 기체가 조립되어 행이 생겼다');
  ok(JSON.parse(P().items)['shard:azure'] === 2, '조각이 필요한 만큼만 빠졌다 (남은 2)');
  ok(JSON.parse(P().codex || '{}').r?.azure === 1, '도감 트리거가 새 기체를 적었다');
  const gneed = shardNeed('grit');
  db.prepare(`UPDATE player SET items = json_set(COALESCE(items,'{}'), '$."shard:grit"', ?) WHERE account_id=1`).run(gneed);
  const b = P(); const d = await shopRun(env, 1, T0, { action: 'assemble', type: 'grit' }); const a = P();
  const g = CONST.DUPE_GAIN[ROBOT_TYPES.grit.rarity];
  ok(d.ok && d.assembled.dupe && a.credits - b.credits === g.cr && a.scrap - b.scrap === g.sc,
     `가진 기체면 뽑기 중복과 같이 자원 (크레딧 +${a.credits - b.credits} · 스크랩 +${a.scrap - b.scrap})`);
  ok(q(`SELECT COUNT(*) n FROM robot WHERE account_id=1 AND type='grit'`).n === 1, '가진 기체는 두 대가 되지 않는다');
  ok(!('shard:grit' in JSON.parse(P().items)), '다 쓴 조각은 보관함에서 지워진다');
}

console.log('\n== ⑤ /api/state 가 보관함을 내린다 ==');
{
  const s = await loadState(env, 1);
  ok(s && s.items && s.items['shard:azure'] === 2, `state.items = ${JSON.stringify(s && s.items)}`);
}

console.log(bad ? `\n✗ ${bad}건 실패` : '\n전부 통과');
process.exitCode = bad ? 1 : 0;
